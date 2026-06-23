# Slice Capacity and Growth — Performance Optimization

> **Format:** Each exercise includes difficulty, description, slow code, a benchmark, a hint, and the optimized solution with explanation.

---

## Overview

These exercises target the performance cost of slice growth: unnecessary allocations, memmove overhead, GC pressure, and memory waste. Each exercise has measurable before/after numbers. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard.

---

## Exercise 1 🟢 💾 — Pre-allocate Known-Size Output

**Problem:** A function that maps one slice to another allocates O(log n) times.

**Slow Code:**
```go
func mapToLengths(words []string) []int {
    var result []int
    for _, w := range words {
        result = append(result, len(w))
    }
    return result
}
```

**Benchmark:**
```go
func BenchmarkMapSlow(b *testing.B) {
    words := make([]string, 10_000)
    for i := range words { words[i] = fmt.Sprintf("word-%d", i) }
    b.ReportAllocs()
    for b.Loop() { _ = mapToLengths(words) }
}
// Typical: 14 allocs/op, ~120 µs/op
```

**Hint:** The output has exactly `len(words)` elements — pre-allocate with `make([]int, 0, len(words))`.

<details>
<summary>Optimized Solution</summary>

```go
func mapToLengths(words []string) []int {
    result := make([]int, 0, len(words)) // single allocation
    for _, w := range words {
        result = append(result, len(w))
    }
    return result
}
// Typical: 1 alloc/op, ~40 µs/op (3× faster)
```

**Why it's faster:**
- 1 allocation instead of 14
- No `memmove` during growth
- Better cache behavior: backing array never moves
</details>

---

## Exercise 2 🟢 💾 — Use Index Assignment for Known-Size Transforms

**Problem:** Even with pre-allocation, `append` has overhead — use direct indexing when size is exact.

**Slow Code (with pre-alloc but still append):**
```go
func doubleAll(nums []int) []int {
    result := make([]int, 0, len(nums))
    for _, n := range nums {
        result = append(result, n*2)
    }
    return result
}
```

**Optimized:**
```go
func doubleAll(nums []int) []int {
    result := make([]int, len(nums)) // len=n, not len=0
    for i, n := range nums {
        result[i] = n * 2 // direct index — no bounds check amortization overhead
    }
    return result
}
```

**Benchmark:**
```go
func BenchmarkDoubleAppend(b *testing.B) {
    nums := make([]int, 100_000)
    b.ReportAllocs()
    for b.Loop() { _ = doubleAll(nums) }
}
```

**Why it's faster:**
- `make([]int, n)` initializes with zeros (zeroing is fast via hardware memset)
- Direct index writes avoid the internal `append` check (`len < cap`)
- Compiler can generate tighter loop code (bounds check can be hoisted)

---

## Exercise 3 🟢 ⚡ — Avoid Appending One Element at a Time

**Problem:** Appending elements one by one in a loop has more overhead than batch append.

**Slow Code:**
```go
func buildHeader(prefix string, n int) []byte {
    var buf []byte
    for i := 0; i < n; i++ {
        buf = append(buf, prefix[i%len(prefix)])
    }
    return buf
}
```

**Optimized:**
```go
func buildHeader(prefix string, n int) []byte {
    buf := make([]byte, n)
    for i := range buf {
        buf[i] = prefix[i%len(prefix)]
    }
    return buf
}

// Or for repeated patterns, use bytes.Repeat / copy pattern:
func buildRepeating(pattern []byte, totalLen int) []byte {
    result := make([]byte, totalLen)
    for i := 0; i < totalLen; i += copy(result[i:], pattern) {
    }
    return result
}
```

**Why it's faster:**
- No reallocation events
- Direct writes to pre-sized backing array
- `copy` in the repeating version uses `memmove` (hardware-optimized)

---

## Exercise 4 🟡 ⚡ — Filter With Optimal Capacity Strategy

**Problem:** Choosing the wrong capacity strategy for a filter wastes either time (reallocations) or memory (excess capacity).

**Slow Code (reallocates many times):**
```go
func filterErrors(logs []LogEntry) []LogEntry {
    var result []LogEntry // 0 capacity, many reallocations
    for _, log := range logs {
        if log.Level == ERROR {
            result = append(result, log)
        }
    }
    return result
}
```

**Memory-Wasteful Code (over-allocates):**
```go
func filterErrors(logs []LogEntry) []LogEntry {
    result := make([]LogEntry, 0, len(logs)) // 100% pre-alloc even if 1% are errors
    for _, log := range logs {
        if log.Level == ERROR {
            result = append(result, log)
        }
    }
    return result
}
```

**Optimized for ~5% error rate:**
```go
func filterErrors(logs []LogEntry) []LogEntry {
    // Estimate: if historically 5% are errors, allocate 6% (headroom)
    hint := len(logs)/16 + 1 // ~6.25%, rounded up, never 0
    result := make([]LogEntry, 0, hint)
    for _, log := range logs {
        if log.Level == ERROR {
            result = append(result, log)
        }
    }
    return result
    // At most 1 reallocation if error rate is < 6.25%
    // Uses 16× less memory than full pre-allocation
}
```

**For tight memory requirements — two-pass:**
```go
func filterErrors(logs []LogEntry) []LogEntry {
    count := 0
    for _, log := range logs {
        if log.Level == ERROR {
            count++
        }
    }
    result := make([]LogEntry, 0, count) // exact
    for _, log := range logs {
        if log.Level == ERROR {
            result = append(result, log)
        }
    }
    return result
}
```

**Benchmark comparison:**
```go
func BenchmarkFilterNone(b *testing.B) { /* no hint */ }
func BenchmarkFilterFull(b *testing.B) { /* full pre-alloc */ }
func BenchmarkFilterHint(b *testing.B) { /* 1/16 hint */ }
func BenchmarkFilterTwoPass(b *testing.B) { /* exact two-pass */ }
```

---

## Exercise 5 🟡 💾 — Use `slices.Clip` After Building

**Problem:** After building a slice, excess capacity wastes memory — especially when storing slices long-term.

**Slow Code (wastes memory):**
```go
func collectIDs(db []Record) []int {
    ids := make([]int, 0, 1024) // guessed capacity
    for _, r := range db {
        ids = append(ids, r.ID)
    }
    return ids
    // If len(db) == 100, cap(ids) is still 1024 — 924 slots wasted
}
```

**Optimized:**
```go
import "slices"

func collectIDs(db []Record) []int {
    ids := make([]int, 0, len(db)) // exact worst case
    for _, r := range db {
        ids = append(ids, r.ID)
    }
    return slices.Clip(ids) // cap reduced to len — no waste
}

// Or: when you can't know count upfront, clip after:
func collectIDsUnknown(db []Record) []int {
    var ids []int
    for _, r := range db {
        ids = append(ids, r.ID)
    }
    return slices.Clip(ids) // may trigger one extra allocation if cap > len
}
```

**When to use `slices.Clip`:**
- The slice will be stored long-term (cache, global state)
- Many such slices are stored simultaneously
- The excess capacity is a significant fraction of actual usage

**When NOT to use `slices.Clip`:**
- The slice is short-lived (function-local, returned and discarded)
- You're about to append more elements
- The difference is only a few elements

---

## Exercise 6 🟡 🔄 — Batch Append for Merging Slices

**Problem:** Appending elements one by one from multiple sources is slow.

**Slow Code:**
```go
func mergeSlices(slices [][]int) []int {
    var result []int
    for _, s := range slices {
        for _, v := range s { // element by element
            result = append(result, v)
        }
    }
    return result
}
```

**Optimized:**
```go
func mergeSlices(slices [][]int) []int {
    // Pre-calculate total size
    total := 0
    for _, s := range slices {
        total += len(s)
    }

    result := make([]int, 0, total)
    for _, s := range slices {
        result = append(result, s...) // batch append (single copy per slice)
    }
    return result
}
```

**Why it's faster:**
- Pre-calculation eliminates all reallocations
- `append(result, s...)` internally uses `memmove` for the entire slice at once
- A loop of element-by-element appends processes one word at a time; `memmove` uses SIMD on modern CPUs

**Benchmark:**
```go
func BenchmarkMergeSlow(b *testing.B) {
    slices := make([][]int, 100)
    for i := range slices { slices[i] = make([]int, 1000) }
    b.ReportAllocs()
    for b.Loop() { _ = mergeSlices(slices) }
}
// Expected speedup: 3-5× for large slices
```

---

## Exercise 7 🟡 💾 — In-Place Filter to Eliminate Allocation

**Problem:** Filtering creates a new slice when in-place modification would work.

**Allocating Code:**
```go
func keepLarge(nums []int, threshold int) []int {
    result := make([]int, 0, len(nums))
    for _, n := range nums {
        if n >= threshold {
            result = append(result, n)
        }
    }
    return result // new allocation
}
```

**Zero-allocation in-place:**
```go
func keepLargeInPlace(nums []int, threshold int) []int {
    n := 0
    for _, v := range nums {
        if v >= threshold {
            nums[n] = v
            n++
        }
    }
    return nums[:n]
    // No allocation! Original backing array reused.
    // The "deleted" elements are still in nums[n:cap] but inaccessible.
}
```

**Safety note:** This modifies the original slice's backing array. If the caller still has a reference to the original `nums`, those elements will be overwritten. Use in-place only when:
1. You own the slice and won't use the original after the call, OR
2. You document that the original is modified

**Benchmark:**
```go
func BenchmarkKeepLargeAlloc(b *testing.B) {
    nums := make([]int, 100_000)
    for i := range nums { nums[i] = i }
    b.ReportAllocs()
    for b.Loop() {
        input := make([]int, len(nums))
        copy(input, nums)
        _ = keepLarge(input, 50_000)
    }
}

func BenchmarkKeepLargeInPlace(b *testing.B) {
    nums := make([]int, 100_000)
    for i := range nums { nums[i] = i }
    b.ReportAllocs()
    for b.Loop() {
        input := make([]int, len(nums))
        copy(input, nums)
        _ = keepLargeInPlace(input, 50_000)
    }
}
// In-place: 1 alloc/op (the copy) vs 2 allocs/op (copy + filter result)
```

---

## Exercise 8 🟡 🔄 — Use `sync.Pool` for Hot-Path Buffers

**Problem:** A high-throughput request handler allocates a working buffer for every request.

**Slow Code (per-request allocation):**
```go
func handleRequest(req Request) Response {
    buf := make([]byte, 0, 4096) // allocates every request
    buf = appendRequestData(buf, req)
    buf = compress(buf)
    return Response{Data: buf}
}
```

**Optimized with `sync.Pool`:**
```go
var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 4096)
        return &b
    },
}

func handleRequest(req Request) Response {
    pBuf := bufPool.Get().(*[]byte)
    buf := (*pBuf)[:0] // reset length, preserve capacity

    buf = appendRequestData(buf, req)
    buf = compress(buf)

    result := make([]byte, len(buf))
    copy(result, buf)

    *pBuf = buf // update after potential reallocation
    bufPool.Put(pBuf)

    return Response{Data: result}
}
```

**Expected improvement at 10,000 req/s:**
- Without pool: 10,000 allocations/s, ~40MB GC pressure/s
- With pool: ~0 pool buffer allocations/s (steady state), GC pressure eliminated

**Important rules for `sync.Pool`:**
1. Always `*pBuf = buf` before `Put` — if `append` reallocated, pool must store the new buffer
2. Always `(*pBuf)[:0]` to reset length — never keep old data
3. Never store pointers from pool buffers — they may be collected between GC cycles
4. Pool items can be evicted at any GC — don't rely on them for persistence

---

## Exercise 9 🔴 ⚡ — Struct-of-Arrays for Memory Bandwidth

**Problem:** A slice of structs causes poor cache performance when only one field is accessed at a time.

**Array-of-Structs (slow for single-field access):**
```go
type Particle struct {
    X, Y, Z float64 // position
    VX, VY, VZ float64 // velocity
    Mass float64
}

// Only updates positions — must load entire struct (56 bytes) for each element
func updatePositions(particles []Particle, dt float64) {
    for i := range particles {
        particles[i].X += particles[i].VX * dt
        particles[i].Y += particles[i].VY * dt
        particles[i].Z += particles[i].VZ * dt
    }
}
```

**Struct-of-Arrays (fast — accesses contiguous memory):**
```go
type ParticleSystem struct {
    X, Y, Z   []float64 // positions — contiguous in memory
    VX, VY, VZ []float64 // velocities
    Mass       []float64
    N          int
}

func NewParticleSystem(n int) *ParticleSystem {
    return &ParticleSystem{
        X: make([]float64, n), Y: make([]float64, n), Z: make([]float64, n),
        VX: make([]float64, n), VY: make([]float64, n), VZ: make([]float64, n),
        Mass: make([]float64, n),
        N: n,
    }
}

// Only loads X, VX (128 bits per element instead of 448 bits)
// Perfect for SIMD vectorization
func updatePositions(ps *ParticleSystem, dt float64) {
    for i := 0; i < ps.N; i++ {
        ps.X[i] += ps.VX[i] * dt
        ps.Y[i] += ps.VY[i] * dt
        ps.Z[i] += ps.VZ[i] * dt
    }
}
```

**Performance:** For N=100,000 particles, SoA is typically 2-4× faster for single-field operations because:
- Cache line utilization: AoS wastes 448-128=320 bits per cache line load; SoA uses 100%
- SIMD: contiguous floats can be processed 4 or 8 at a time with AVX2

---

## Exercise 10 🔴 💾 — Adaptive Reset Policy for Long-Running Services

**Problem:** A worker struct holds a buffer that grows during load spikes and never shrinks.

**Problematic Code:**
```go
type Worker struct {
    buf []byte
}

func (w *Worker) Process(data []byte) {
    w.buf = append(w.buf[:0], data...) // reuses backing array — good
    // ... process w.buf ...
}

// Called after each batch:
func (w *Worker) Reset() {
    w.buf = w.buf[:0] // keeps backing array — BAD during spikes
}
```

**Optimized with adaptive policy:**
```go
type Worker struct {
    buf          []byte
    highWaterMark int
    resetCount   int
}

const (
    shrinkThreshold = 4    // check every N resets
    shrinkFactor    = 4    // shrink if cap > 4× high-water mark
    minCap          = 4096 // never shrink below 4KB
)

func (w *Worker) Reset() {
    w.resetCount++
    if w.resetCount%shrinkThreshold == 0 {
        // Periodically check if we're hoarding memory
        if cap(w.buf) > w.highWaterMark*shrinkFactor && cap(w.buf) > minCap {
            // Release oversized buffer, reallocate at high-water mark + 25%
            newCap := w.highWaterMark * 5 / 4
            if newCap < minCap { newCap = minCap }
            w.buf = make([]byte, 0, newCap)
        } else {
            w.buf = w.buf[:0]
        }
        w.highWaterMark = 0 // reset high-water mark each period
    } else {
        w.highWaterMark = max(w.highWaterMark, len(w.buf))
        w.buf = w.buf[:0]
    }
}
```

**Policy analysis:**
- During stable load: buffer reused every call — 0 allocations
- After a 100MB spike: after 4 resets, policy detects `cap >> hwm`, reallocates to normal size
- Memory released: 100MB → ~(normal_size × 1.25)

---

## Exercise 11 🔴 🔄 — Concurrent Slice Population Without Locks

**Problem:** Building a large slice from parallel goroutines requires either a mutex (serializes writes) or channels (adds goroutine overhead). When indices are disjoint, neither is needed.

**Mutex approach (correct but slow):**
```go
func parallelMap(input []int, f func(int) int) []int {
    result := make([]int, len(input))
    var mu sync.Mutex
    var wg sync.WaitGroup

    chunkSize := (len(input) + 3) / 4
    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            end := min(start+chunkSize, len(input))
            local := make([]int, 0, end-start)
            for i := start; i < end; i++ {
                local = append(local, f(input[i]))
            }
            mu.Lock()
            copy(result[start:], local)
            mu.Unlock()
        }(g * chunkSize)
    }
    wg.Wait()
    return result
}
```

**Lock-free approach (fastest — disjoint indices, pre-sized result):**
```go
func parallelMap(input []int, f func(int) int) []int {
    result := make([]int, len(input)) // pre-sized — each goroutine owns its range
    var wg sync.WaitGroup

    chunkSize := (len(input) + 3) / 4
    for g := 0; g < 4; g++ {
        wg.Add(1)
        start := g * chunkSize
        end := min(start+chunkSize, len(input))
        go func(s, e int) {
            defer wg.Done()
            for i := s; i < e; i++ {
                result[i] = f(input[i]) // no lock needed: disjoint indices
            }
        }(start, end)
    }
    wg.Wait()
    return result
}
```

**Why it's safe:** Go's memory model guarantees that writes to distinct indices of a slice from concurrent goroutines are safe, as long as no goroutine writes to the same index as another. Pre-sizing with `make([]int, n)` ensures no `append` can trigger reallocation.

**Performance:** Eliminates mutex contention. For CPU-bound `f`, near-linear speedup with core count.

---

## Exercise 12 🔴 ⚡ — Two-Pass Pipeline for Zero-Waste Output

**Problem:** A multi-stage pipeline where intermediate results are unknown size causes cascading growth events.

**Naive pipeline (multiple growth events per stage):**
```go
func pipeline(input []string) []int {
    // Stage 1: parse
    var parsed []ParsedItem
    for _, s := range input {
        if item, ok := parse(s); ok {
            parsed = append(parsed, item)
        }
    }

    // Stage 2: transform
    var transformed []TransformedItem
    for _, p := range parsed {
        transformed = append(transformed, transform(p))
    }

    // Stage 3: score
    var scores []int
    for _, t := range transformed {
        scores = append(scores, score(t))
    }
    return scores
}
```

**Optimized: pre-calculate bounds, single pass through each stage:**
```go
func pipeline(input []string) []int {
    // Pass 1: count valid items
    validCount := 0
    for _, s := range input {
        if isValid(s) {
            validCount++
        }
    }

    // Pre-allocate all stages based on worst case
    parsed := make([]ParsedItem, 0, validCount)
    transformed := make([]TransformedItem, 0, validCount)
    scores := make([]int, 0, validCount)

    // Pass 2: execute full pipeline
    for _, s := range input {
        item, ok := parse(s)
        if !ok { continue }
        parsed = append(parsed, item)
        t := transform(item)
        transformed = append(transformed, t)
        scores = append(scores, score(t))
    }

    // Release intermediate allocations early
    parsed = nil
    transformed = nil

    return scores
}
```

**Trade-off analysis:**
- Two-pass: doubles input scan time; eliminates ALL growth events in all 3 stages
- Single-pass with hints: estimate `validCount ≈ len(input) * 0.8` if most pass; one reallocation possible
- Memory: `nil` the intermediates as soon as possible to allow GC
