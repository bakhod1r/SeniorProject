# Capacity and Growth — Senior Level

## Overview

At the senior level, capacity and growth management is no longer about correctness — it is about eliminating invisible latency spikes, reducing GC pressure, designing APIs that never force callers into allocation paths, and diagnosing capacity-related regressions in production systems.

---

## 1. The True Cost of `append` Reallocation

Every time `append` exceeds capacity, three things happen:

1. `runtime.growslice` allocates a new backing array via `mallocgc`
2. All existing elements are copied via `memmove`
3. The old backing array becomes garbage (GC must eventually collect it)

For most applications, occasional reallocations are acceptable. For hot paths — per-request buffers, serialization pipelines, streaming parsers — each reallocation is a latency spike. A 10 MB slice that doubles to 20 MB creates 20 MB of short-lived garbage per growth event.

---

## 2. Go 1.18+ Growth Formula Deep Dive

Before Go 1.18, the growth strategy was a simple 2x below a threshold and then a flat 25% above. The new formula is a **smooth curve**:

```
threshold = 256

if oldCap < threshold:
    newCap = 2 * oldCap
else:
    for newCap < (oldCap + 3*threshold)/4 + threshold:
        newCap = newCap + (newCap + 3*threshold) / 4
```

This eliminates the sharp jump at the threshold, reducing fragmentation. After the mathematical computation, the result is **rounded up to the nearest memory allocator size class** (8, 16, 24, 32, 48, 64, 80, 96, 112, 128, ... bytes for small objects).

Practical implication: if you `append` to a slice of `[]int64` and the computed new capacity would use 104 bytes, the runtime rounds up to 112 bytes (the next size class), giving you 14 elements when you expected 13. This is why `cap` after `append` frequently surprises developers.

### Benchmark: Growth Steps

```go
package main

import (
    "fmt"
    "testing"
)

func BenchmarkGrowthSteps(b *testing.B) {
    sizes := []int{10, 100, 1000, 10_000, 100_000}
    for _, n := range sizes {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            b.ReportAllocs()
            for b.Loop() {
                s := make([]int, 0)
                for i := range n {
                    s = append(s, i)
                }
                _ = s
            }
        })
    }
}

func BenchmarkPreAllocated(b *testing.B) {
    sizes := []int{10, 100, 1000, 10_000, 100_000}
    for _, n := range sizes {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            b.ReportAllocs()
            for b.Loop() {
                s := make([]int, 0, n)
                for i := range n {
                    s = append(s, i)
                }
                _ = s
            }
        })
    }
}
```

Typical results on a modern machine:

| n       | No Pre-alloc (allocs) | Pre-alloc (allocs) | Speedup |
|---------|----------------------|--------------------|---------|
| 10      | 4                    | 1                  | 1.3×    |
| 100     | 8                    | 1                  | 2.1×    |
| 1,000   | 11                   | 1                  | 3.5×    |
| 10,000  | 15                   | 1                  | 4.8×    |
| 100,000 | 18                   | 1                  | 6.2×    |

---

## 3. Anatomy of a Capacity-Driven Latency Spike

### Postmortem 1: The Parser Timeout

**Symptoms:** A JSON log parser service had P99 latency of ~50ms but P999 latency of ~2s. The 99.9th percentile cases were impossible to reproduce in testing.

**Root cause:**

```go
// Production code — "works" but hides a time bomb
func parseLogs(lines []string) []LogEntry {
    var entries []LogEntry  // capacity = 0
    for _, line := range lines {
        entry, err := parseJSON(line)
        if err == nil {
            entries = append(entries, entry)  // reallocates 18 times for 100k lines
        }
    }
    return entries
}
```

For a typical batch of 100,000 log lines, this function triggered 18 reallocations. The last reallocation (from 65,536 to 131,072 entries) required copying 65,536 `LogEntry` structs. Each `LogEntry` was 128 bytes, so the copy moved 8 MB of data. Combined with GC pressure from discarded backing arrays, this caused occasional stop-the-world pauses.

**Fix:**

```go
func parseLogs(lines []string) []LogEntry {
    entries := make([]LogEntry, 0, len(lines))  // worst-case pre-allocation
    for _, line := range lines {
        entry, err := parseJSON(line)
        if err == nil {
            entries = append(entries, entry)
        }
    }
    return entries
}
```

Pre-allocating `len(lines)` is the worst case (all lines valid). In practice, some lines fail parsing, so the slice will be somewhat over-allocated. The trade-off: wasted memory is bounded and predictable; latency spikes are eliminated.

---

### Postmortem 2: The Streaming Aggregator OOM

**Symptoms:** A metrics aggregation service OOMed every 48-72 hours. Memory grew steadily from 2 GB to 12 GB before crash.

**Root cause:**

```go
type Aggregator struct {
    raw []float64  // grows unboundedly
}

func (a *Aggregator) Add(v float64) {
    a.raw = append(a.raw, v)
}

func (a *Aggregator) Percentile(p float64) float64 {
    sorted := make([]float64, len(a.raw))
    copy(sorted, a.raw)
    sort.Float64s(sorted)
    idx := int(float64(len(sorted)) * p)
    return sorted[idx]
}

// Called every minute
func (a *Aggregator) Reset() {
    a.raw = a.raw[:0]  // BUG: keeps backing array alive
}
```

The `Reset()` call used `a.raw[:0]` to clear the slice without releasing the backing array. Over time, `a.raw` grew to hold millions of float64 values during peak load. Even after a reset, the multi-GB backing array stayed allocated. The backing array never shrank because Go slice backing arrays only grow.

**Fix:**

```go
func (a *Aggregator) Reset() {
    if cap(a.raw) > 10_000 {
        a.raw = nil  // release oversized backing arrays
    } else {
        a.raw = a.raw[:0]  // reuse small backing arrays
    }
}
```

This policy: if the backing array grew beyond 10,000 elements (probably due to a traffic spike), release it. Otherwise, reuse it to avoid per-minute allocations.

---

### Postmortem 3: The Chunk Processor Regression

**Symptoms:** After a seemingly unrelated refactor, a file processing pipeline slowed by 40%. CPU profiling showed increased time in `runtime.memmove`.

**Before (fast):**

```go
func processFile(data []byte) []Record {
    results := make([]Record, 0, len(data)/avgRecordSize)
    // parse and append...
    return results
}
```

**After refactor (slow):**

```go
func processFile(data []byte) []Record {
    var results []Record  // pre-allocation accidentally removed during refactor
    // parse and append...
    return results
}
```

The refactor removed the capacity hint. The function was called thousands of times per second with files averaging 50,000 bytes. Removing pre-allocation added 12–15 reallocation events per call.

**Detection:** A simple benchmark comparison (`-benchmem`) immediately showed the regression:

```
Before: BenchmarkProcessFile 1500 ns/op   1 allocs/op   49152 B/op
After:  BenchmarkProcessFile 2100 ns/op  13 allocs/op  147456 B/op
```

---

## 4. The `sync.Pool` Pattern for Capacity Reuse

When you want to reuse a slice's backing array across requests without retaining it permanently:

```go
var bufPool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 4096)
        return &s
    },
}

func handleRequest(data []byte) []byte {
    bufPtr := bufPool.Get().(*[]byte)
    buf := (*bufPtr)[:0]  // reset length, keep capacity

    buf = append(buf, data...)
    buf = processInPlace(buf)

    result := make([]byte, len(buf))
    copy(result, buf)

    *bufPtr = buf         // update pointer (buf may have been reallocated)
    bufPool.Put(bufPtr)
    return result
}
```

Key insight: `*bufPtr = buf` before returning to pool. If `append` inside the function reallocated `buf`, the pool must store the new (larger) backing array, not the old one.

---

## 5. Capacity Budgeting

In memory-constrained systems, over-allocating capacity wastes memory. Under-allocating causes reallocations. The optimal strategy depends on the distribution of final sizes:

### Strategy 1: Worst-case allocation (safest, most memory)

```go
results := make([]T, 0, len(input))  // allocates max needed
```

Use when: transformation is 1:1 or near 1:1.

### Strategy 2: Heuristic estimation (balanced)

```go
results := make([]T, 0, len(input)/2)  // estimate 50% pass rate
```

Use when: a significant fraction of items are filtered out.

### Strategy 3: Amortized zero-allocation (for known output sizes)

```go
// When output size is computable before building
total := countItems(input)
results := make([]T, 0, total)
```

Use when: you can scan the input once cheaply.

### Strategy 4: Two-pass algorithm

```go
// Pass 1: count
count := 0
for _, item := range input {
    if predicate(item) { count++ }
}
// Pass 2: fill
results := make([]T, 0, count)
for _, item := range input {
    if predicate(item) {
        results = append(results, item)
    }
}
```

Use when: memory is tight and two passes are acceptable.

---

## 6. Detecting Capacity Issues in Production

### Using pprof

```go
import _ "net/http/pprof"
// GET /debug/pprof/heap?gc=1
```

Look for high `alloc_objects` count for `[]T` types in the heap profile. High object count with low retained size indicates frequent short-lived allocations (growth events).

### Using GODEBUG

```
GODEBUG=allocfreetrace=1 ./service 2>&1 | grep growslice
```

Logs every call to `growslice` with stack trace.

### Using benchmarks

```go
func BenchmarkCriticalPath(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        result := criticalPathFunction(testInput)
        _ = result
    }
}
```

Zero allocations per operation is the goal for inner loops. Any allocation in a hot path deserves scrutiny.

---

## 7. The Full Slice Expression as an API Contract

Three-index slicing `s[low:high:max]` is not just a defensive technique — it is an API design tool:

```go
// Buffer pool returns fixed-capacity slices
func getBuffer(size int) []byte {
    buf := bufferPool.Get().(*[4096]byte)
    return buf[:size:size]  // cap limited to size — callers can't see pool internals
}
```

By limiting capacity to `size`, you prevent callers from accidentally appending beyond the intended region and corrupting pool state. The backing array is still `[4096]byte`, but callers operate as if they have exactly `size` bytes.

---

## 8. Architecture Patterns

### Pattern 1: Pre-sized Response Builder

For HTTP handlers that build response bodies:

```go
type ResponseBuilder struct {
    buf []byte
}

func NewResponseBuilder(estimatedSize int) *ResponseBuilder {
    return &ResponseBuilder{buf: make([]byte, 0, estimatedSize)}
}

func (r *ResponseBuilder) WriteJSON(v any) error {
    encoded, err := json.Marshal(v)
    if err != nil { return err }
    r.buf = append(r.buf, encoded...)
    return nil
}

func (r *ResponseBuilder) Bytes() []byte { return r.buf }
```

Caller estimates final response size (based on request type, data size) and pre-allocates once.

### Pattern 2: Capacity-Bounded Buffer

Prevents unbounded growth for streaming workloads:

```go
type BoundedBuffer struct {
    data    []byte
    maxCap  int
}

func (b *BoundedBuffer) Append(p []byte) error {
    if len(b.data)+len(p) > b.maxCap {
        return ErrBufferFull
    }
    b.data = append(b.data, p...)
    return nil
}

func (b *BoundedBuffer) Reset() {
    b.data = b.data[:0]
}
```

### Pattern 3: Adaptive Pre-allocation

For services where request sizes vary:

```go
type AdaptivePreallocator struct {
    mu      sync.Mutex
    ewma    float64  // exponentially weighted moving average of sizes
    alpha   float64  // smoothing factor (0.1 = slow adaptation, 0.9 = fast)
}

func (a *AdaptivePreallocator) Estimate() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    return int(a.ewma * 1.2)  // 20% headroom
}

func (a *AdaptivePreallocator) Update(actualSize int) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.ewma = a.alpha*float64(actualSize) + (1-a.alpha)*a.ewma
}
```

---

## 9. Capacity Anti-Patterns

### Anti-Pattern 1: Returning `s[:0]` as a "cleared" slice

```go
// BUG: caller may observe stale data via cap
func clearBuffer(s []byte) []byte {
    return s[:0]  // len=0 but cap=original, backing array unchanged
}
```

The GC still holds references to any pointers in the (now "invisible") elements. For `[]byte` this is safe, but for `[]*T` this keeps `T` objects alive.

### Anti-Pattern 2: Hoarding capacity in hot structs

```go
type Request struct {
    // ... fields ...
    tempBuf []byte  // allocated to 1 MB during one request, stays 1 MB forever
}
```

If `Request` objects live in a pool, the `tempBuf` capacity can grow without bound over the lifetime of the pool.

### Anti-Pattern 3: Ignoring capacity in benchmarks

```go
// Misleading benchmark — pre-allocated once before b.Loop()
func BenchmarkBad(b *testing.B) {
    s := make([]int, 0, 1000)
    for b.Loop() {
        s = s[:0]
        for i := range 1000 { s = append(s, i) }
    }
}
```

This benchmark measures the steady-state (no allocations after first iteration). If the real code does not reuse a pre-allocated buffer, this benchmark is misleading. Use `b.ReportAllocs()` and always check the `allocs/op` column.

---

## 10. Senior Checklist

- [ ] Every hot path that builds a slice is pre-allocated or uses `sync.Pool`
- [ ] Postmortems have checked for capacity-driven latency spikes via `allocs/op`
- [ ] Bounded buffers exist for all user-controlled input sizes
- [ ] `Reset()` methods explicitly choose between `s[:0]` (reuse) and `s=nil` (release)
- [ ] Full slice expressions `s[low:high:max]` are used in buffer pool APIs
- [ ] Adaptive pre-allocation is used where request sizes vary by >10×
- [ ] All benchmarks use `b.ReportAllocs()` and check for zero allocs in hot paths
- [ ] Growth formula rounding is accounted for in capacity-sensitive calculations
- [ ] pprof heap profiles are reviewed after capacity-related changes
- [ ] `sync.Pool` users update `*bufPtr = buf` after potential reallocation

---

## Summary

Senior-level capacity management requires understanding growth as a system-wide concern — not just per-function correctness. The skills are:

1. **Measure first** — `b.ReportAllocs()`, pprof, `GODEBUG=allocfreetrace`
2. **Pre-allocate hotpaths** — based on worst-case or EWMA estimates
3. **Design APIs with capacity contracts** — full slice expressions in pool returns
4. **Handle Reset correctly** — reuse small, release large
5. **Pool backing arrays** — `sync.Pool` for request-scoped buffers
6. **Own postmortems** — capacity bugs hide as GC pauses and P999 latency spikes
