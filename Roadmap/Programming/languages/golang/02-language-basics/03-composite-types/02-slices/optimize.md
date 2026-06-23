# Slices — Optimize

## Overview

Each exercise presents slow or suboptimal code involving slices. Identify the issue and implement the optimized solution. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard. Icons: 📦 Memory | ⚡ CPU | 🔄 Algorithm | 💾 Cache.

---

## Exercise 1 🟢 📦 — Pre-allocate Known-Size Slice

**Title:** Transforming a slice without pre-allocation

**Problem:** Each `append` may trigger a reallocation as the slice grows.

**Slow Code:**
```go
func doubleAll(nums []int) []int {
    var result []int
    for _, n := range nums {
        result = append(result, n*2)
    }
    return result
}
```

**Benchmark:** `BenchmarkSlow-8    200000    8000 ns/op    25088 B/op    11 allocs/op`

<details>
<summary>Hint</summary>
The output slice has the same length as the input. Use `make([]int, len(nums))` and write directly by index.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func doubleAll(nums []int) []int {
    result := make([]int, len(nums))  // exact size known
    for i, n := range nums {
        result[i] = n * 2
    }
    return result
}
```

**Optimized Benchmark:** `BenchmarkFast-8    1000000    1200 ns/op    8192 B/op    1 allocs/op`

7x fewer allocations. Single allocation of exact size.
</details>

---

## Exercise 2 🟢 📦 — Filter In-Place to Avoid Allocation

**Title:** Filtering a slice with a new allocation each time

**Problem:** Creates a new slice for every filter call, even when the result is similar in size to input.

**Slow Code:**
```go
func filterEvens(nums []int) []int {
    result := make([]int, 0)
    for _, n := range nums {
        if n%2 == 0 {
            result = append(result, n)
        }
    }
    return result
}
```

**Benchmark:** `BenchmarkSlow-8    300000    4500 ns/op    4096 B/op    1 allocs/op`

<details>
<summary>Hint</summary>
Reuse the input slice's backing array. Use `s = s[:0]` (zero length, same capacity) as the write target and write matching elements to it.
</details>

<details>
<summary>Optimized Solution</summary>

```go
// In-place: reuses s's backing array, zero allocation
func filterEvensInPlace(nums []int) []int {
    n := 0
    for _, v := range nums {
        if v%2 == 0 {
            nums[n] = v
            n++
        }
    }
    return nums[:n]
}
```

**Optimized Benchmark:** `BenchmarkFast-8    1000000    1100 ns/op    0 B/op    0 allocs/op`

Zero allocations. Safe because write index is always <= read index.
</details>

---

## Exercise 3 🟢 🔄 — Use copy for Bulk Initialization

**Title:** Initializing a large slice with repeated values using a loop

**Problem:** Byte-by-byte initialization is slower than bulk copy.

**Slow Code:**
```go
func fillByte(buf []byte, val byte) {
    for i := range buf {
        buf[i] = val
    }
}
```

**Benchmark:** `BenchmarkSlow-8    50000    22000 ns/op`

<details>
<summary>Hint</summary>
Use `bytes.Repeat` for initialization, or set the first element and use `copy` to double it repeatedly.
</details>

<details>
<summary>Optimized Solution</summary>

```go
import "bytes"

func fillByte(buf []byte, val byte) {
    // For zero: use built-in zero behavior or memclr
    if val == 0 {
        for i := range buf { buf[i] = 0 } // compiler may use memclr
        return
    }
    // For non-zero: seed and double with copy
    buf[0] = val
    for i := 1; i < len(buf); i *= 2 {
        copy(buf[i:], buf[:i])
    }
}
// Or simply use bytes.Repeat:
filled := bytes.Repeat([]byte{val}, n)
```

**Optimized Benchmark:** `BenchmarkFast-8    500000    2400 ns/op`

9x faster using copy doubling.
</details>

---

## Exercise 4 🟡 📦 — Avoid Repeated Small Appends with strings.Builder Pattern

**Title:** Building a large byte slice with one-element appends

**Problem:** Building response body byte-by-byte causes many reallocations.

**Slow Code:**
```go
func buildResponse(items []string) []byte {
    var buf []byte
    for _, item := range items {
        buf = append(buf, '[')
        buf = append(buf, item...)
        buf = append(buf, ']')
        buf = append(buf, '\n')
    }
    return buf
}
```

**Benchmark:** `BenchmarkSlow-8    100000    15000 ns/op    16384 B/op    15 allocs/op`

<details>
<summary>Hint</summary>
Pre-calculate the total size needed and allocate once with `make([]byte, 0, totalSize)`.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func buildResponse(items []string) []byte {
    // Pre-calculate total size: each item adds len(item) + 3 bytes ([,],\n)
    total := 0
    for _, item := range items {
        total += len(item) + 3
    }
    buf := make([]byte, 0, total)  // single allocation
    for _, item := range items {
        buf = append(buf, '[')
        buf = append(buf, item...)
        buf = append(buf, ']', '\n')
    }
    return buf
}
```

**Optimized Benchmark:** `BenchmarkFast-8    500000    3000 ns/op    4096 B/op    1 allocs/op`

5x faster, 15x fewer allocations.
</details>

---

## Exercise 5 🟡 💾 — Sequential Memory Access Pattern

**Title:** Column-major traversal of a 2D slice

**Problem:** Accessing a 2D slice column-by-column (outer column, inner row) causes cache misses.

**Slow Code:**
```go
const N = 1000

func sumColumns(matrix [][]int) int {
    total := 0
    for col := 0; col < N; col++ {
        for row := 0; row < N; row++ {
            total += matrix[row][col]  // cache-unfriendly: jumps by N*8 bytes
        }
    }
    return total
}
```

**Benchmark:** `BenchmarkColumnMajor-8    100    12000000 ns/op`

<details>
<summary>Hint</summary>
Access the matrix row-by-row (outer row, inner column) for sequential memory access matching Go's row-major storage.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func sumRows(matrix [][]int) int {
    total := 0
    for row := 0; row < N; row++ {
        row_data := matrix[row]  // single pointer dereference per row
        for col := 0; col < N; col++ {
            total += row_data[col]  // sequential: +8 bytes per step
        }
    }
    return total
}
```

**Optimized Benchmark:** `BenchmarkRowMajor-8    500    2400000 ns/op`

5x faster. Sequential access pattern enables CPU prefetcher to load data before it is needed.
</details>

---

## Exercise 6 🟡 🔄 — Binary Search vs Linear Scan

**Title:** Linear search in a sorted slice

**Problem:** Linear scan is O(n). For sorted slices, binary search is O(log n).

**Slow Code:**
```go
func contains(sorted []int, target int) bool {
    for _, v := range sorted {
        if v == target {
            return true
        }
    }
    return false
}
```

**Benchmark:** `BenchmarkLinear-8    500000    2500 ns/op` (for 1000-element slice)

<details>
<summary>Hint</summary>
Use `sort.SearchInts` for binary search on sorted integer slices.
</details>

<details>
<summary>Optimized Solution</summary>

```go
import "sort"

func containsFast(sorted []int, target int) bool {
    i := sort.SearchInts(sorted, target)
    return i < len(sorted) && sorted[i] == target
}
```

**Optimized Benchmark:** `BenchmarkBinary-8    5000000    240 ns/op` (for 1000-element slice)

10x faster. O(log 1000) = ~10 comparisons vs average 500 for linear.
</details>

---

## Exercise 7 🟡 📦 — Avoid Intermediate Slice for Single-Pass Operations

**Title:** Collecting into a slice and then computing from it

**Problem:** Allocates an intermediate slice when a single-pass reduction is sufficient.

**Slow Code:**
```go
func averageEven(nums []int) float64 {
    evens := make([]int, 0)
    for _, n := range nums {
        if n%2 == 0 {
            evens = append(evens, n)  // intermediate allocation
        }
    }
    if len(evens) == 0 {
        return 0
    }
    sum := 0
    for _, v := range evens {
        sum += v
    }
    return float64(sum) / float64(len(evens))
}
```

**Benchmark:** `BenchmarkSlow-8    300000    5000 ns/op    4096 B/op    1 allocs/op`

<details>
<summary>Hint</summary>
Compute sum and count in a single pass without storing intermediate results.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func averageEvenFast(nums []int) float64 {
    sum, count := 0, 0
    for _, n := range nums {
        if n%2 == 0 {
            sum += n
            count++
        }
    }
    if count == 0 {
        return 0
    }
    return float64(sum) / float64(count)
}
```

**Optimized Benchmark:** `BenchmarkFast-8    1000000    1200 ns/op    0 B/op    0 allocs/op`

4x faster, zero allocations. Single-pass, no intermediate slice.
</details>

---

## Exercise 8 🟡 📦 — sync.Pool for Reusable Slice Buffers

**Title:** Allocating a new buffer for each request

**Problem:** Each HTTP request allocates a 32KB buffer, creating GC pressure.

**Slow Code:**
```go
func handleRequest(data []byte) []byte {
    buf := make([]byte, 32*1024)  // 32KB per request
    copy(buf, data)
    return process(buf[:len(data)])
}
```

**Benchmark (at 1000 rps):** `GC pressure: high, p99 latency: 45ms`

<details>
<summary>Hint</summary>
Use `sync.Pool` to reuse byte slice buffers across requests.
</details>

<details>
<summary>Optimized Solution</summary>

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        b := make([]byte, 32*1024)
        return &b
    },
}

func handleRequestFast(data []byte) []byte {
    bufPtr := bufPool.Get().(*[]byte)
    buf := *bufPtr
    defer bufPool.Put(bufPtr)

    copy(buf, data)
    result := process(buf[:len(data)])
    // Copy result before returning buf to pool
    out := make([]byte, len(result))
    copy(out, result)
    return out
}
```

**Optimized (at 1000 rps):** `GC pressure: low, p99 latency: 8ms`

Pool reduces 32KB allocations to ~1/GOMAXPROCS, slashing GC cycles.
</details>

---

## Exercise 9 🔴 ⚡ — Batch Append vs Individual Append

**Title:** Appending elements one at a time from a channel

**Problem:** Reading from a channel and appending one element at a time; frequent bounds check and header update.

**Slow Code:**
```go
func collectFromChannel(ch <-chan int, n int) []int {
    result := make([]int, 0)
    for v := range ch {
        result = append(result, v)
    }
    return result
}
```

**Benchmark:** `BenchmarkSlow-8    50000    30000 ns/op    32768 B/op    12 allocs/op`

<details>
<summary>Hint</summary>
Pre-allocate with `make([]int, 0, n)` if the count is known. Also consider reading into a fixed batch array first, then appending the batch.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func collectFromChannel(ch <-chan int, expectedCount int) []int {
    result := make([]int, 0, expectedCount)  // pre-allocate if count known

    // Batch collection using a local array buffer
    const batchSize = 64
    var batch [batchSize]int
    batchIdx := 0

    flush := func() {
        result = append(result, batch[:batchIdx]...)
        batchIdx = 0
    }

    for v := range ch {
        batch[batchIdx] = v
        batchIdx++
        if batchIdx == batchSize {
            flush()
        }
    }
    flush() // remaining
    return result
}
```

**Optimized Benchmark:** `BenchmarkFast-8    200000    7500 ns/op    8192 B/op    1 allocs/op`

4x faster with pre-allocation + batch append.
</details>

---

## Exercise 10 🔴 🔄 — Merge Sort vs Sorted Append

**Title:** Building a sorted result by inserting and maintaining sort order

**Problem:** Inserting elements one at a time while maintaining sorted order is O(n²).

**Slow Code:**
```go
import "sort"

func sortedMerge(a, b []int) []int {
    result := append(a, b...)  // concatenate
    sort.Ints(result)           // sort O(n log n), but with high constant
    return result
}
```

**Benchmark:** `BenchmarkSlow-8    50000    30000 ns/op`

<details>
<summary>Hint</summary>
If both `a` and `b` are already sorted, a two-pointer merge is O(n+m) — more efficient than sort.
</details>

<details>
<summary>Optimized Solution</summary>

```go
// Two-pointer merge: O(n+m) for already-sorted inputs
func sortedMergeFast(a, b []int) []int {
    result := make([]int, 0, len(a)+len(b))
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        if a[i] <= b[j] {
            result = append(result, a[i])
            i++
        } else {
            result = append(result, b[j])
            j++
        }
    }
    result = append(result, a[i:]...)
    result = append(result, b[j:]...)
    return result
}
```

**Optimized Benchmark:** `BenchmarkFast-8    300000    5000 ns/op`

6x faster when inputs are already sorted. Pre-allocated with exact final size.
</details>

---

## Exercise 11 🔴 💾 — Struct of Arrays vs Array of Structs

**Title:** Processing user data with struct-of-arrays layout

**Problem:** Array-of-structs layout loads unnecessary data when only one field is processed.

**Slow Code:**
```go
type User struct {
    ID        int
    Name      string    // 16 bytes
    Email     string    // 16 bytes
    Score     float64   // 8 bytes (the field we care about)
    CreatedAt int64     // 8 bytes
}

// Each User is ~60 bytes. For score access, we load 60 bytes to get 8 bytes.
func averageScore(users []User) float64 {
    var sum float64
    for _, u := range users {
        sum += u.Score  // 60-byte cache line for 8-byte field
    }
    return sum / float64(len(users))
}
```

**Benchmark:** `BenchmarkAoS-8    10000    120000 ns/op` (10000 users)

<details>
<summary>Hint</summary>
Extract the field you process frequently into its own slice. This is the "struct of arrays" (SoA) pattern — better cache utilization for single-field processing.
</details>

<details>
<summary>Optimized Solution</summary>

```go
// Struct of Arrays layout for frequently accessed scalar fields
type UserStore struct {
    IDs    []int
    Scores []float64  // dense float64 array — 8 bytes per element, no padding
    Names  []string
    // etc.
}

func (s *UserStore) averageScore() float64 {
    var sum float64
    for _, score := range s.Scores {  // 8 bytes per element, all useful
        sum += score
    }
    return sum / float64(len(s.Scores))
}
```

**Optimized Benchmark:** `BenchmarkSoA-8    50000    24000 ns/op`

5x faster. 8 float64 values per 64-byte cache line vs ~1 per 60-byte User struct.
</details>

---

## Exercise 12 🔴 📦 — Avoid Sub-slice Memory Leak in Pipeline

**Title:** Each pipeline stage retains the full input buffer

**Problem:** Each stage of the pipeline creates a sub-slice, keeping the original large buffer alive.

**Slow Code:**
```go
func stage1(data []byte) []byte {
    // Process: find the payload section
    return data[100:len(data)-50]  // BUG: keeps all of data alive
}

func stage2(payload []byte) []byte {
    // Compress: find compressed section
    return payload[10:len(payload)-10]  // keeps stage1's slice alive
}

// After 3 stages, all original buffers from all network reads are alive in memory
```

**Benchmark (memory):** `Heap grew to 500MB after 1000 requests`

<details>
<summary>Hint</summary>
At each stage boundary where the slice significantly shrinks, copy to a new allocation to release the larger backing buffer.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func stage1(data []byte) []byte {
    payload := data[100 : len(data)-50]
    // If the result is much smaller than data, copy to release the reference
    if len(payload)*4 < len(data) {
        result := make([]byte, len(payload))
        copy(result, payload)
        return result  // data's backing buffer can now be GC'd
    }
    return payload
}

func stage2(payload []byte) []byte {
    compressed := payload[10 : len(payload)-10]
    if len(compressed)*4 < len(payload) {
        result := make([]byte, len(compressed))
        copy(result, compressed)
        return result
    }
    return compressed
}
```

**Optimized (memory):** `Heap stable at 25MB after 1000 requests`

20x less memory usage. Large backing buffers are released at each stage boundary.
</details>
