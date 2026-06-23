# Slices — Senior Level

## Table of Contents
1. Introduction
2. Runtime Architecture
3. growslice Deep Dive
4. Memory Management Implications
5. Advanced Aliasing Patterns
6. Slice Operations Performance Model
7. Concurrent Slice Patterns
8. Postmortems & System Failures
9. Production Patterns
10. Benchmarking Strategy
11. Test
12. Tricky Questions
13. Summary
14. Further Reading

---

## Introduction

At the senior level, slices are a subject of system design. You must understand the runtime's growth algorithm, how slice operations interact with the garbage collector, the exact cost model of every slice operation, and when the aliasing semantics create production bugs that are hard to debug.

Senior engineers use slices to architect zero-allocation hot paths, avoid GC pressure in high-throughput systems, and design safe APIs that don't expose aliasing risks. They also know when to break slice conventions (e.g., using `unsafe` for performance-critical serialization).

---

## Runtime Architecture

### The Slice Header

```go
// runtime/slice.go representation
type slice struct {
    array unsafe.Pointer  // pointer to backing array (or nil)
    len   int             // number of elements accessible
    cap   int             // capacity from array pointer to end of backing array
}
```

This 24-byte structure is what gets copied when you pass `[]T` to a function. The backing array itself is NOT copied. Understanding this distinction is the foundation of all slice performance reasoning.

### Stack vs Heap Allocation

The slice header almost always lives on the stack (it is 24 bytes). The backing array lives on the heap when it escapes the function. For small, short-lived slices, the compiler may allocate the backing array on the stack:

```go
// Compiler may keep backing array on stack — no GC pressure
func stackBacking() int {
    s := []int{1, 2, 3, 4}  // backing array may be stack-allocated
    return len(s)             // slice doesn't escape
}

// Backing array on heap — slice is returned
func heapBacking() []int {
    s := make([]int, 100)
    return s  // slice escapes → heap
}
```

Check: `go build -gcflags="-m" ./...`

---

## growslice Deep Dive

`runtime.growslice` is called when `append` needs more capacity:

```go
// Simplified from src/runtime/slice.go
func growslice(et *_type, old slice, cap int) slice {
    newcap := old.cap
    doublecap := newcap + newcap

    if cap > doublecap {
        newcap = cap
    } else {
        const threshold = 256
        if old.cap < threshold {
            newcap = doublecap  // below threshold: 2x growth
        } else {
            for newcap < cap {
                // Smooth transition from 2x to 1.25x for large slices
                newcap += (newcap + 3*threshold) / 4
            }
        }
    }
    // Round up to memory size class — actual cap may be larger
    return slice{array: newArray, len: old.len, cap: newcap}
}
```

**Key insights:**
1. Below 256 elements: growth is approximately 2x
2. Above 256 elements: growth transitions toward 1.25x
3. Actual capacity is rounded to memory size class boundaries — may be larger than computed
4. After growth, the old slice variable still points to the old backing array

```go
// Demonstrating actual growth
func main() {
    s := make([]int, 0)
    prev := 0
    for i := 0; i < 25; i++ {
        s = append(s, i)
        if cap(s) != prev {
            fmt.Printf("len=%2d cap grew: %d → %d\n", len(s), prev, cap(s))
            prev = cap(s)
        }
    }
}
// len= 1 cap grew: 0 → 1
// len= 2 cap grew: 1 → 2
// len= 3 cap grew: 2 → 4
// len= 5 cap grew: 4 → 8
// ...
```

---

## Memory Management Implications

### GC Root Retention via Sub-slice

A slice holds a GC root pointing to its backing array. The entire backing array lives as long as any slice referencing it lives.

```go
// Memory leak: sub-slice keeps large buffer alive
func parseEvent(rawBuffer []byte) *Event {
    event := &Event{}
    // BUG: keeps 64KB rawBuffer alive via 16-byte sub-slice pointer
    event.Source = rawBuffer[100:116]
    return event
}

// Fix: copy only what you need
func parseEventSafe(rawBuffer []byte) *Event {
    event := &Event{}
    event.Source = make([]byte, 16)
    copy(event.Source, rawBuffer[100:116])
    // rawBuffer's 64KB can now be GC'd
    return event
}
```

### GC Scan Cost by Element Type

```go
// Zero GC scan cost: no pointer fields
type ID [16]byte
var ids []ID  // GC skips entirely — no pointers

// Low GC scan cost: one pointer per element
var names []string  // GC scans one pointer per string

// High GC scan cost: multiple pointers per element
type User struct {
    Name    string   // 2 words (ptr + len)
    Tags    []string // 3 words (ptr + len + cap)
    Profile *Profile // 1 word (ptr)
}
var users []User  // GC scans 6 words per User element
```

For high-throughput services with millions of elements, prefer value-type elements (no pointers) to reduce GC scan time.

### sync.Pool for Slice Reuse

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        b := make([]byte, 0, 4096)
        return &b
    },
}

func processRequest(data []byte) []byte {
    bufPtr := bufPool.Get().(*[]byte)
    buf := (*bufPtr)[:0] // reset length, keep capacity
    defer func() {
        *bufPtr = buf[:0]
        bufPool.Put(bufPtr)
    }()

    buf = append(buf, data...)
    result := make([]byte, len(buf))
    copy(result, buf)
    return result
}
```

---

## Advanced Aliasing Patterns

### The Append Trap: Sibling Slices

```go
func appendTrap() {
    base := make([]int, 3, 5) // [0 0 0], cap=5
    base[0], base[1], base[2] = 1, 2, 3

    a := base[:3] // len=3, cap=5
    b := base[:3] // len=3, cap=5 — SAME backing array

    a = append(a, 10) // writes to base[3]
    b = append(b, 20) // writes to base[3] AGAIN — overwrites a's write!

    fmt.Println(a) // [1 2 3 20] — NOT [1 2 3 10]!
    fmt.Println(b) // [1 2 3 20]
}

// Fix: three-index slicing to limit capacity
func appendSafe() {
    base := make([]int, 3, 5)
    base[0], base[1], base[2] = 1, 2, 3

    a := base[:3:3] // cap=3 — next append allocates new array
    b := base[:3:3] // cap=3 — independent after append

    a = append(a, 10) // new backing array for a
    b = append(b, 20) // new backing array for b

    fmt.Println(a) // [1 2 3 10]
    fmt.Println(b) // [1 2 3 20]
}
```

### Safe Read-Only Aliasing

```go
// Document intentional aliasing for zero-copy reads
type ByteView struct {
    data []byte // may be a sub-slice of a larger buffer
}

// No mutation methods — aliasing is safe for reads
func (v ByteView) Len() int       { return len(v.data) }
func (v ByteView) Byte(i int) byte { return v.data[i] }
func (v ByteView) SliceFrom(from int) ByteView {
    return ByteView{data: v.data[from:]}
}
```

---

## Slice Operations Performance Model

| Operation | Time | Allocs | Notes |
|-----------|------|--------|-------|
| `len(s)`, `cap(s)` | O(1) | 0 | Direct field read |
| `s[i]` | O(1) | 0 | Bounds check + load |
| `s[i:j]` | O(1) | 0 | New header, no data copy |
| `copy(dst, src)` | O(min(len,len)) | 0 | memmove |
| `append` (cap > len) | O(1) amortized | 0 | Write to existing memory |
| `append` (cap == len) | O(n) | 1 | Allocate + copy all |
| Delete at i (ordered) | O(n) | 0 | memmove tail left |
| Delete at i (unordered) | O(1) | 0 | Swap with last |
| Filter in-place | O(n) | 0 | Reuse backing array |
| Filter with allocation | O(n) | 1 | New backing array |

### Zero-Allocation Slice Operations

```go
// Shrink (stack pop)
top := s[len(s)-1]
s = s[:len(s)-1]  // O(1), 0 alloc

// Filter in-place (no allocation)
func filterInPlace(s []int, keep func(int) bool) []int {
    n := 0
    for _, v := range s {
        if keep(v) { s[n] = v; n++ }
    }
    return s[:n]
}

// Move item to front
s[0], s[i] = s[i], s[0]  // O(1), 0 alloc

// Rotate left by 1
s = append(s[1:], s[0])  // O(n) copy, 0 alloc if cap > len
```

---

## Concurrent Slice Patterns

### Append-Only Log with Mutex

```go
type AppendLog struct {
    mu      sync.Mutex
    entries []LogEntry
}

func (l *AppendLog) Append(e LogEntry) {
    l.mu.Lock()
    l.entries = append(l.entries, e)
    l.mu.Unlock()
}

// Safe snapshot for batch processing
func (l *AppendLog) Snapshot() []LogEntry {
    l.mu.Lock()
    defer l.mu.Unlock()
    result := make([]LogEntry, len(l.entries))
    copy(result, l.entries)
    return result
}
```

### Copy-on-Write for Read-Heavy Config

```go
type Config struct {
    data atomic.Value // stores immutable []Route
}

func (c *Config) Update(routes []Route) {
    snapshot := make([]Route, len(routes))
    copy(snapshot, routes)
    c.data.Store(snapshot) // atomic store of interface{}
}

func (c *Config) Routes() []Route {
    s, _ := c.data.Load().([]Route)
    return s // lock-free read — caller must not modify
}
```

---

## Postmortems & System Failures

### Incident 1: Memory Leak via Sub-slice Retention

**Context:** A log aggregation service OOMed after 6-8 hours.

**Root cause:**
```go
func parseEvent(rawData []byte) *Event {
    event := &Event{}
    // BUG: 16-byte sub-slice keeps 64KB network buffer alive!
    event.Source = rawData[100:116]
    return event
}
// sync.Pool buffers are never returned — memory grows unbounded
```

**Fix:** Copy the 16-byte portion. Release the 64KB buffer reference.

**Lesson:** Any sub-slice of a buffer prevents the buffer from being GC'd. Always copy when the sub-slice outlives the original.

---

### Incident 2: Data Race from Non-Atomic Slice Header Assignment

**Context:** A config service had a global `[]Route` updated every 60 seconds.

**Root cause:**
```go
var globalRoutes []Route  // shared without synchronization

// Writer (goroutine A): writes 3 words to globalRoutes
globalRoutes = newRoutes

// Reader (goroutine B): may read partial state mid-write
for _, r := range globalRoutes { ... }  // DATA RACE
```

**Fix:** Use `sync.RWMutex` around all reads and writes to `globalRoutes`.

**Lesson:** A 24-byte slice header write is NOT atomic. Concurrent access requires explicit synchronization regardless of the machine word size.

---

### Incident 3: Quadratic Prepend Pattern

**Context:** A data service reversed a large slice using repeated prepend operations. Performance degraded from milliseconds to minutes as data size grew.

**Root cause:**
```go
var result []Item
for _, item := range items {
    result = append([]Item{item}, result...) // O(n) each iteration = O(n²) total
}
```

**Fix:**
```go
result := make([]Item, len(items))
for i, item := range items {
    result[len(items)-1-i] = item // O(n) total
}
```

**Lesson:** Prepending to a slice is O(n). Doing it in a loop is O(n²). Build forward, then reverse, or index directly.

---

## Production Patterns

### Zero-Copy Parsing

```go
// Parse HTTP header without allocating
func parseContentType(header []byte) (mimeType, params []byte) {
    if i := bytes.IndexByte(header, ';'); i >= 0 {
        return bytes.TrimSpace(header[:i]), bytes.TrimSpace(header[i+1:])
    }
    return bytes.TrimSpace(header), nil
    // Returns sub-slices — zero allocation — caller must not retain
}
```

### Bounded Streaming Window

```go
func processStream(ch <-chan []byte, windowSize int) {
    window := make([]byte, 0, windowSize*2)
    for chunk := range ch {
        window = append(window, chunk...)
        for len(window) >= windowSize {
            processWindow(window[:windowSize])
            n := copy(window, window[windowSize:])
            window = window[:n]
        }
    }
}
```

---

## Benchmarking Strategy

```go
package slices_test

import "testing"

var sinkSlice []int

func BenchmarkAppendNoPrealloc(b *testing.B) {
    b.ReportAllocs()
    for n := 0; n < b.N; n++ {
        var s []int
        for i := 0; i < 1000; i++ { s = append(s, i) }
        sinkSlice = s
    }
}

func BenchmarkAppendPrealloc(b *testing.B) {
    b.ReportAllocs()
    for n := 0; n < b.N; n++ {
        s := make([]int, 0, 1000)
        for i := 0; i < 1000; i++ { s = append(s, i) }
        sinkSlice = s
    }
}

func BenchmarkFilterCopy(b *testing.B) {
    b.ReportAllocs()
    input := make([]int, 1000)
    b.ResetTimer()
    for n := 0; n < b.N; n++ {
        result := make([]int, 0, len(input))
        for _, v := range input {
            if v%2 == 0 { result = append(result, v) }
        }
        sinkSlice = result
    }
}

func BenchmarkFilterInPlace(b *testing.B) {
    b.ReportAllocs()
    input := make([]int, 1000)
    b.ResetTimer()
    for n := 0; n < b.N; n++ {
        s := input
        n := 0
        for _, v := range s {
            if v%2 == 0 { s[n] = v; n++ }
        }
        sinkSlice = s[:n]
    }
}
```

---

## Test

**1. What causes a memory leak when returning a sub-slice of a large buffer?**
- A) Sub-slices create copies that take extra memory
- B) The sub-slice's pointer field keeps the entire backing array alive for GC
- C) Sub-slices disable garbage collection for that memory region
- D) The GC cannot track sub-slices

**Answer: B** — The sub-slice holds a pointer into the backing array. The GC considers the entire array reachable as long as any slice points into it.

---

**2. Why is concurrent assignment to a global slice variable unsafe?**
- A) Slices cannot be global variables
- B) The 24-byte header requires three separate word writes — not atomic
- C) Go's runtime prevents concurrent slice access
- D) Global variables are always read-only

**Answer: B** — A slice header is 24 bytes (3 x 8-byte words). Three separate writes are not atomic. A concurrent reader may observe an inconsistent state.

---

**3. What is the time complexity of `append([]Item{v}, s...)` in a loop over n items?**
- A) O(n)
- B) O(n log n)
- C) O(n²)
- D) O(1) amortized

**Answer: C** — Each prepend copies all existing elements. For n items, total copies = 0+1+2+...+(n-1) = n(n-1)/2 = O(n²).

---

**4. Which sync primitive enables lock-free slice reads with occasional writes?**
- A) sync.Mutex only
- B) sync.RWMutex or atomic.Value
- C) channel
- D) sync.WaitGroup

**Answer: B** — `sync.RWMutex` allows concurrent readers. `atomic.Value` allows completely lock-free reads via Store/Load of the slice as interface{}.

---

## Tricky Questions

**Q: Can you detect if two slices share a backing array?**
A: Yes, using `reflect` and `unsafe`:
```go
import ("reflect"; "unsafe")
func sharesBacking(a, b []int) bool {
    if len(a) == 0 || len(b) == 0 { return false }
    ha := (*reflect.SliceHeader)(unsafe.Pointer(&a))
    hb := (*reflect.SliceHeader)(unsafe.Pointer(&b))
    aEnd := ha.Data + uintptr(ha.Cap)*unsafe.Sizeof(a[0])
    return hb.Data >= ha.Data && hb.Data < aEnd
}
```

**Q: After `s = s[:0]`, can the backing array be GC'd?**
A: No. The backing array is still referenced through `s.array` (the pointer field). Setting `len=0` does not release the pointer. To release the backing array, set `s = nil` or let `s` go out of scope.

**Q: How does `growslice` handle the case where `cap > 2*oldCap`?**
A: When the requested new capacity (`cap`) exceeds double the old capacity, `growslice` uses `cap` directly as the new capacity (rather than doubling). This handles cases where a single large `append(s, bigSlice...)` would otherwise require multiple doubling steps.

---

## Summary

At the senior level, slices are memory management primitives. Key insights: (1) backing array lifetime is tied to any slice pointing into it — copy sub-slices before returning from functions that own the backing buffer, (2) the append trap requires three-index slicing `s[low:high:high]` or explicit copies to isolate sibling slices, (3) slice header assignment is never atomic — all concurrent access requires explicit synchronization, (4) prepending in a loop is O(n²) — build forward and reverse instead, (5) GC scan cost grows with pointer density in elements — prefer value types for hot slices. The postmortems here are canonical Go production failure patterns.

---

## Further Reading

- [Go runtime growslice source](https://cs.opensource.google/go/go/+/main:src/runtime/slice.go)
- [Go memory model](https://go.dev/ref/mem)
- [Go blog: Slices internals](https://go.dev/blog/slices-intro)
- [sync.Pool documentation](https://pkg.go.dev/sync#Pool)
- [Go escape analysis](https://go.dev/doc/faq#stack_or_heap)
