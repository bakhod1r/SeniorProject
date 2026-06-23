# Slice Capacity and Growth — Middle Level

---

## 1. Introduction

At the middle level, understanding capacity and growth means knowing *why* the runtime behaves the way it does, predicting performance implications, and writing code that avoids unnecessary allocations. This file covers the internals behind `len`, `cap`, `append`, and the growth algorithm — with code you can run and benchmark.

---

## 2. The Slice Header

Every slice is represented internally as a three-word struct:

```go
type SliceHeader struct {
    Data uintptr // pointer to backing array
    Len  int     // number of accessible elements
    Cap  int     // total allocated slots
}
```

When you pass a slice to a function, Go copies this 24-byte struct (on 64-bit systems). The pointer inside still points to the same backing array. This is why:

- Modifying elements inside a function *does* affect the caller's data
- Changing `len` inside a function (via `append`) does *not* affect the caller's slice header

```go
func addElement(s []int) {
    s = append(s, 99) // modifies local copy of header
}

func main() {
    s := []int{1, 2, 3}
    addElement(s)
    fmt.Println(s) // [1 2 3] — caller not affected
    fmt.Println(len(s)) // 3
}
```

To return a modified slice, the function must return the new slice:

```go
func addElement(s []int) []int {
    return append(s, 99)
}
```

---

## 3. Why `cap` Matters

Capacity determines whether `append` can extend in place or must reallocate:

```go
s := make([]int, 3, 6)
// Backing array: [0 0 0 _ _ _]
//                len=3  cap=6

s = append(s, 10) // no reallocation, len becomes 4
s = append(s, 20) // no reallocation, len becomes 5
s = append(s, 30) // no reallocation, len becomes 6
s = append(s, 40) // cap exceeded! new array allocated
```

Each reallocation:
1. Allocates a new backing array (larger)
2. Copies existing data
3. Returns a new slice header pointing to the new array
4. The old array becomes garbage

Understanding when reallocations happen is critical for writing high-performance code.

---

## 4. Observing Capacity Growth

This program shows exactly when Go allocates new backing arrays:

```go
package main

import "fmt"

func main() {
    var s []int
    prevCap := 0

    for i := 0; i < 50; i++ {
        s = append(s, i)
        if cap(s) != prevCap {
            fmt.Printf("len=%d cap=%d (grew from %d)\n", len(s), cap(s), prevCap)
            prevCap = cap(s)
        }
    }
}
```

Sample output (Go 1.21):

```
len=1  cap=1  (grew from 0)
len=2  cap=2  (grew from 1)
len=3  cap=4  (grew from 2)
len=5  cap=8  (grew from 4)
len=9  cap=16 (grew from 8)
len=17 cap=32 (grew from 16)
len=33 cap=64 (grew from 32)
```

The doubling pattern is clear for small slices. For larger slices (above 256 elements), the growth rate decreases toward ~1.25x.

---

## 5. The Growth Algorithm (Go 1.18+)

Before Go 1.18, growth was simple:
- `cap < 1024`: double
- `cap >= 1024`: grow by 25%

This created a sharp discontinuity at 1024. Go 1.18+ introduced a smooth curve:

```
if newLen > 2*oldCap {
    newCap = newLen
} else if oldCap < 256 {
    newCap = 2 * oldCap
} else {
    newCap = oldCap
    for newCap < newLen {
        newCap += (newCap + 3*256) / 4
    }
}
```

Then `newCap` is rounded up to the nearest **memory size class** (Go's allocator works with fixed sizes: 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, ...).

This rounding is why `cap(s)` after an `append` is sometimes larger than you expect:

```go
s := make([]int64, 0)
for len(s) < 300 {
    s = append(s, 0)
}
fmt.Println(cap(s)) // likely 336, not 300 — rounded to next size class
```

---

## 6. Pre-allocation: The Core Optimization

When you know (or can estimate) the final size, pre-allocate:

```go
// Slow: many reallocations
func slowVersion(n int) []int {
    var result []int
    for i := 0; i < n; i++ {
        result = append(result, i*i)
    }
    return result
}

// Fast: single allocation
func fastVersion(n int) []int {
    result := make([]int, 0, n) // pre-allocate capacity
    for i := 0; i < n; i++ {
        result = append(result, i*i)
    }
    return result
}
```

For `n = 100,000`:
- `slowVersion`: ~17 allocations, ~800KB total allocated
- `fastVersion`: 1 allocation, ~800KB total allocated

The speedup comes not just from fewer allocations, but from eliminating `memmove` calls during growth.

---

## 7. `make([]T, n)` vs `make([]T, 0, n)`

These are different and the distinction matters:

```go
// make([]T, n) — length AND capacity set to n
s1 := make([]int, 5)
fmt.Println(len(s1), cap(s1)) // 5 5
fmt.Println(s1)               // [0 0 0 0 0]

// You use s1[i] = v, NOT append
s1[0] = 10
s1[1] = 20
// s1 = append(s1, 30) — WRONG: appends after index 4!
// Result would be [10 20 0 0 0 30]

// make([]T, 0, n) — length=0, capacity=n
s2 := make([]int, 0, 5)
fmt.Println(len(s2), cap(s2)) // 0 5
fmt.Println(s2)               // []

// You use append
s2 = append(s2, 10)
s2 = append(s2, 20)
fmt.Println(s2) // [10 20]
```

Rule of thumb:
- Use `make([]T, n)` when you know the exact final size and will fill by index
- Use `make([]T, 0, n)` when you're building incrementally with `append`

---

## 8. Capacity and the `copy` Function

`copy` copies `min(len(dst), len(src))` elements. Capacity is irrelevant:

```go
src := []int{1, 2, 3, 4, 5}
dst := make([]int, 3, 10) // len=3, cap=10

n := copy(dst, src)
fmt.Println(n, dst) // 3 [1 2 3] — only 3 copied because dst len=3
```

To copy all elements:

```go
dst := make([]int, len(src))
copy(dst, src)
```

---

## 9. The Three-Index Slice `s[low:high:max]`

The third index controls the capacity of the resulting sub-slice:

```go
base := []int{1, 2, 3, 4, 5, 6, 7, 8}

// Standard two-index slice
s1 := base[1:4]
fmt.Println(len(s1), cap(s1)) // 3 7 (cap extends to end of base)

// Three-index slice: max limits capacity
s2 := base[1:4:4]
fmt.Println(len(s2), cap(s2)) // 3 3 (cap = max - low = 4 - 1 = 3)

// Why it matters: appending to s1 overwrites base[4]!
s1 = append(s1, 99)
fmt.Println(base) // [1 2 3 4 99 6 7 8] — base[4] overwritten!

// s2 cannot do this — its cap is 3, append forces new allocation
s2 = append(s2, 99)
fmt.Println(base) // unchanged — s2 got a new backing array
```

Use three-index slices when you return sub-slices from functions and want to prevent callers from accidentally writing into adjacent memory.

---

## 10. Capacity Growth and Benchmarking

Use `-benchmem` to see allocations:

```go
package main

import "testing"

func BenchmarkAppendNoHint(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        var s []int
        for i := 0; i < 1000; i++ {
            s = append(s, i)
        }
        _ = s
    }
}

func BenchmarkAppendWithHint(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        s := make([]int, 0, 1000)
        for i := 0; i < 1000; i++ {
            s = append(s, i)
        }
        _ = s
    }
}
```

Run with:
```
go test -bench=. -benchmem
```

Expected output:
```
BenchmarkAppendNoHint-8    200000    6012 ns/op    25208 B/op    11 allocs/op
BenchmarkAppendWithHint-8  500000    2308 ns/op     8192 B/op     1 allocs/op
```

Pre-allocation is ~2.6× faster and uses ~3× less memory for 1000 elements.

---

## 11. Sub-slice Capacity Retention (Memory Leak Pattern)

```go
func getFirstItem(bigData []byte) []byte {
    return bigData[:10] // retains bigData's backing array in memory!
}

func processFile() {
    data := loadFile() // 100MB
    header := getFirstItem(data)
    // data goes out of scope, but the 100MB backing array
    // stays alive as long as header is referenced
    return header
}
```

Fix: explicitly copy when you want only a small portion:

```go
func getFirstItem(bigData []byte) []byte {
    result := make([]byte, 10)
    copy(result, bigData[:10])
    return result // original backing array can now be GC'd
}
```

---

## 12. Capacity in Filter Operations

A common pattern: filter elements, keeping only those matching a condition.

```go
// Common but potentially wasteful approach
func filterEven(nums []int) []int {
    result := make([]int, 0, len(nums)) // worst case: all elements pass
    for _, n := range nums {
        if n%2 == 0 {
            result = append(result, n)
        }
    }
    return result
}

// If only ~10% of elements pass, we allocated 10x more memory than needed.
// For most use cases, worst-case allocation is acceptable.
// For memory-tight situations, use two-pass:

func filterEvenTwoPass(nums []int) []int {
    count := 0
    for _, n := range nums {
        if n%2 == 0 {
            count++
        }
    }
    result := make([]int, 0, count) // exact allocation
    for _, n := range nums {
        if n%2 == 0 {
            result = append(result, n)
        }
    }
    return result
}
```

---

## 13. Capacity and `append` with Multiple Elements

`append` can add multiple elements at once — or append another slice:

```go
s := make([]int, 0, 3)
s = append(s, 1, 2, 3) // add 3 elements at once
fmt.Println(len(s), cap(s)) // 3 3

// If we exceed capacity with multi-element append:
s = append(s, 4, 5, 6)
// Go grows to fit at least len(s)+3 elements
// The newLen = 6 > 2*oldCap(3) is NOT true here,
// so growth algorithm applies: cap doubles from 3 to 6
fmt.Println(len(s), cap(s)) // 6 6

// Appending a slice:
a := []int{1, 2, 3}
b := []int{4, 5, 6}
a = append(a, b...)
fmt.Println(a) // [1 2 3 4 5 6]
```

---

## 14. Why `append` May Give More Capacity Than You Asked For

```go
s := make([]int, 0, 5)
s = append(s, 1, 2, 3, 4, 5, 6) // request capacity for 6

// Go asked for 6, but newLen=6 > 2*oldCap=10? No: 6 < 10.
// Actually oldCap=5, newLen=6.
// 6 > 2*5 = 10? No. oldCap < 256? Yes. So newCap = 2*5 = 10.
fmt.Println(len(s), cap(s)) // 6 10

// After rounding to size class, might be even larger.
```

The key insight: Go grows to *at least* what you need, but the actual cap depends on the growth formula AND memory class rounding.

---

## 15. Capacity Shrinking: It Never Happens Automatically

Go slice backing arrays only grow, never shrink. Once you've allocated 1 million elements:

```go
big := make([]int, 1_000_000)
// use big...

// "shrink" it
small := big[:100]
fmt.Println(cap(small)) // still 1,000,000!
```

To actually release memory:

```go
// Option 1: explicit copy
small := make([]int, 100)
copy(small, big[:100])
big = nil // allow original to be GC'd

// Option 2: nil the slice
big = nil
runtime.GC() // force collection (don't do this in production)
```

---

## 16. Capacity with Struct Types

The size of elements affects how much memory a given capacity uses:

```go
type SmallStruct struct{ A, B int32 }  // 8 bytes
type LargeStruct struct{ Data [1024]byte } // 1024 bytes

s1 := make([]SmallStruct, 0, 1000) // 8 KB backing array
s2 := make([]LargeStruct, 0, 1000) // 1 MB backing array

fmt.Printf("s1 backing: %d bytes\n", cap(s1)*8)      // 8000
fmt.Printf("s2 backing: %d bytes\n", cap(s2)*1024)    // 1024000
```

When pre-allocating slices of large structs, be mindful of total memory cost.

---

## 17. The `growslice` Function

When `append` needs more capacity, it calls `runtime.growslice`. You can see it in profiles:

```go
// To see growslice calls in a profile:
import _ "net/http/pprof"

// After running, visit:
// GET /debug/pprof/heap
// Look for runtime.growslice in the allocation stack traces
```

In performance-critical code, you want `growslice` to never appear in profiles. If it does, the affected code paths need capacity hints.

---

## 18. Practical Capacity Estimation Patterns

### Pattern 1: Known 1:1 transform
```go
func doubleAll(nums []int) []int {
    result := make([]int, len(nums)) // same count, not 0+cap
    for i, n := range nums {
        result[i] = n * 2
    }
    return result
}
```

### Pattern 2: Known fraction survives
```go
// If ~50% of items pass a filter:
result := make([]T, 0, len(input)/2)
```

### Pattern 3: Unknown, but bounded
```go
// Items from external source, max known
result := make([]T, 0, maxPossible)
```

### Pattern 4: Accumulator across multiple inputs
```go
var all []T
for _, batch := range batches {
    all = append(all, batch...) // Go amortizes growth
}
// If total count known upfront:
total := 0
for _, batch := range batches { total += len(batch) }
all := make([]T, 0, total)
for _, batch := range batches { all = append(all, batch...) }
```

---

## 19. Capacity and Garbage Collection

Understanding capacity helps you understand GC behavior:

```go
func processRequests() {
    for req := range requestChannel {
        // BAD: allocates new slice every request
        results := []Result{}

        for _, item := range req.Items {
            results = append(results, process(item))
        }
        respond(results)
        // results becomes garbage after each request
        // GC must collect hundreds of backing arrays per second
    }
}
```

Alternative with sync.Pool:

```go
var resultPool = sync.Pool{
    New: func() any { return make([]Result, 0, 100) },
}

func processRequests() {
    for req := range requestChannel {
        results := resultPool.Get().([]Result)
        results = results[:0] // reset length, keep capacity

        for _, item := range req.Items {
            results = append(results, process(item))
        }
        respond(results)

        resultPool.Put(results[:0]) // return to pool
    }
}
```

---

## 20. Capacity Anti-Patterns

### Anti-pattern 1: `append` in tight loop without pre-allocation
```go
// Creates O(log n) allocations
var results []string
for _, record := range millionRecords {
    results = append(results, record.Name)
}
```

### Anti-pattern 2: Using `len` instead of `cap` for size check
```go
if len(s) == 0 { // WRONG for "has backing array" check
    // ...
}
if cap(s) == 0 { // CORRECT for "needs allocation on first append"
    // ...
}
```

### Anti-pattern 3: Unnecessary copy when sub-slice is enough
```go
// Wasteful when you only read the sub-slice briefly
full := make([]byte, 64*1024)
copy(full, networkData)
header := make([]byte, 16)
copy(header, full[:16]) // unnecessary second copy if full stays in scope
```

### Anti-pattern 4: Growing capacity by 1
```go
// O(n²) behavior
for _, item := range items {
    results = append(results[:len(results)], item) // forces growth every time?
    // Actually append already handles this — but some people write:
    newSlice := make([]T, len(results)+1)
    copy(newSlice, results)
    newSlice[len(results)] = item
    results = newSlice // this is O(n²)!
}
```

---

## 21. Capacity in JSON Encoding

`encoding/json` uses capacity-aware buffering internally, but you can help it:

```go
type Response struct {
    Items []Item `json:"items"`
}

// If Items is nil, JSON encodes as null
// If Items is []Item{}, JSON encodes as []
// Both have len=0, but different JSON output!

func buildResponse(items []Item) Response {
    if len(items) == 0 {
        return Response{Items: []Item{}} // never nil
    }
    return Response{Items: items}
}
```

---

## 22. Detecting Growth Events in Tests

```go
func TestNoUnexpectedGrowth(t *testing.T) {
    input := makeTestInput(1000)
    result := processInput(input)

    // We expect exactly one allocation (the pre-allocated result slice)
    var allocs int
    testing.AllocsPerRun(100, func() {
        r := processInput(input)
        _ = r
    })
    // testing.AllocsPerRun returns float64
    allocs = int(testing.AllocsPerRun(100, func() {
        processInput(input)
    }))

    if allocs > 1 {
        t.Errorf("expected ≤1 allocation, got %d", allocs)
    }
}
```

---

## 23. Capacity and Interface Values

When a slice is stored in an interface, the slice header is copied:

```go
var iface interface{} = []int{1, 2, 3}

// To get it back:
s := iface.([]int)
s = append(s, 4) // modifies local copy — original in iface unchanged!

// The backing array is shared until reallocation
s[0] = 99
// iface.([]int)[0] is now 99 — they share a backing array
```

This is a subtle aliasing issue when slices flow through `interface{}` values.

---

## 24. The `slices` Package (Go 1.21+)

Go 1.21 added the `slices` package with capacity-aware helpers:

```go
import "slices"

// slices.Grow: ensure capacity for n more elements without growing length
s := make([]int, 3, 5)
s = slices.Grow(s, 10) // ensures cap >= len+10
fmt.Println(len(s), cap(s)) // 3, 13 (or more due to rounding)

// slices.Clip: reduce capacity to minimum needed
s = slices.Clip(s) // cap becomes len
fmt.Println(len(s), cap(s)) // 3, 3
```

`slices.Clip` is the standard way to "shrink" a slice when you've finished building it and want to release excess capacity.

---

## 25. Nil vs Empty Slice Capacity

```go
var nilSlice []int
emptySlice := []int{}
madeSlice := make([]int, 0)

fmt.Println(cap(nilSlice))   // 0
fmt.Println(cap(emptySlice)) // 0
fmt.Println(cap(madeSlice))  // 0

// All are "zero capacity"
// But nil check differs:
fmt.Println(nilSlice == nil)   // true
fmt.Println(emptySlice == nil) // false
fmt.Println(madeSlice == nil)  // false

// append works on all three:
nilSlice = append(nilSlice, 1)
emptySlice = append(emptySlice, 1)
madeSlice = append(madeSlice, 1)
// All result in [1] with cap=1 (or more)
```

---

## 26. Capacity Doubling and Memory Overhead

Understanding the maximum wasted capacity:

```go
// Worst case: you fill a slice to exactly 2^n + 1 elements
// After the (2^n + 1)th append, cap doubles to 2^(n+1)
// Wasted slots: 2^n - 1

// For a 1 million element slice, after last growth:
// cap might be 1,048,576 (2^20)
// if only 524,289 elements are used, 524,287 slots are wasted

// Maximum overhead: ~50% (one element over the previous capacity)
// Average overhead: ~25% (assuming uniform distribution of final sizes)
```

This is the fundamental trade-off: more growth = fewer allocations but more wasted memory.

---

## 27. When NOT to Pre-allocate

Pre-allocation is not always correct:

```go
// Case 1: Most items are filtered out
// Pre-allocating len(input) wastes memory if only 1% passes
func findErrors(logs []LogEntry) []LogEntry {
    // If 1% are errors: make([]LogEntry, 0, len(logs)) wastes 99% of allocation
    // Better: make([]LogEntry, 0) or make([]LogEntry, 0, len(logs)/100)
    var result []LogEntry
    for _, log := range logs {
        if log.Level == ERROR {
            result = append(result, log)
        }
    }
    return result
}

// Case 2: The function is called rarely and with small inputs
// Pre-allocation optimization is premature if this runs once per minute

// Case 3: You're building a small slice (< 10 elements)
// The overhead of make vs append is negligible
```

Pre-allocate when: the function is on a hot path, the input is large, and most items survive the operation.

---

## 28. Capacity in Concurrent Code

Slices are NOT safe for concurrent access. Even with pre-allocated capacity:

```go
// WRONG: concurrent writes to different indices are NOT safe
// (may be safe in practice on x86 but not guaranteed by Go memory model)
results := make([]int, 100)
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(idx int) {
        defer wg.Done()
        results[idx] = computeExpensive(idx) // data race!
    }(i)
}
wg.Wait()
```

Actually writing to distinct indices IS safe in Go's memory model IF there are no concurrent reads AND the writes don't cause reallocation. But the safe approach:

```go
// Option 1: pre-size and write per index (valid if indices are disjoint)
results := make([]int, 100) // len=100, each goroutine writes its own index
// This is safe because no two goroutines access the same index

// Option 2: channel collection
resultCh := make(chan int, 100)
for i := 0; i < 100; i++ {
    go func(idx int) { resultCh <- computeExpensive(idx) }(i)
}
for i := 0; i < 100; i++ {
    results = append(results, <-resultCh)
}
```

---

## 29. Summary Table

| Scenario | Approach | Why |
|----------|----------|-----|
| Known exact output size | `make([]T, n)` + index | No append overhead |
| Known upper bound | `make([]T, 0, n)` + append | Single allocation |
| Unknown, hot path | `make([]T, 0, estimatedN)` | Minimize reallocations |
| Unknown, cold path | `var s []T` + append | Simpler code, OK perf |
| Reusable buffer | `sync.Pool` + `s[:0]` | Avoid GC pressure |
| Return sub-slice | Three-index `s[a:b:b]` | Prevent caller overwrites |
| Release excess cap | `slices.Clip(s)` | Free unused memory |

---

## 30. Practice Questions

1. What happens to the original backing array when `append` causes a reallocation?
2. Why does `make([]int, 5)` produce `[0 0 0 0 0]` while `make([]int, 0, 5)` produces `[]`?
3. Given `s := base[2:5]`, what is `cap(s)` if `len(base) == 10`?
4. Why might `cap(s)` after an `append` be larger than `2 * cap(before)`?
5. Write a function that returns the last N elements of a slice without retaining the full backing array.
6. What is the difference between `s = s[:0]` and `s = nil` for capacity management?
7. When should you use `slices.Clip`?
