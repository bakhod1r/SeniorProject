# Go for Loop (C-style) — Optimize

## Instructions

Each exercise presents a slow, incorrect, or resource-intensive use of the `for` loop. Identify the issue, write an optimized version, and explain the improvement. Always benchmark before and after for performance optimizations. Difficulty levels: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Pre-Allocate Slice

**Problem**: A function builds a result slice by appending inside a loop.

```go
func doubleAll(nums []int) []int {
    var result []int
    for i := 0; i < len(nums); i++ {
        result = append(result, nums[i]*2)
    }
    return result
}
```

**Question**: What is the performance issue? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: `append` on a nil/empty slice repeatedly reallocates and copies. For a slice of N elements, there are approximately `log2(N)` reallocations. Each reallocation is an allocation + memcopy.

**Optimized**:
```go
func doubleAllFast(nums []int) []int {
    result := make([]int, len(nums))  // allocate exact size upfront
    for i := 0; i < len(nums); i++ {
        result[i] = nums[i] * 2       // direct index write, no append
    }
    return result
}
```

**Alternative (pre-cap, use append)**:
```go
result := make([]int, 0, len(nums))  // capacity = len, no reallocs
for i := 0; i < len(nums); i++ {
    result = append(result, nums[i]*2)
}
```

**Benchmark** (1 million elements):
- Without pre-alloc: ~8 ms (multiple GC cycles)
- With pre-alloc: ~2 ms (single allocation)

**Key insight**: When you know the output size, always pre-allocate with `make([]T, size)` or `make([]T, 0, capacity)`.
</details>

---

## Exercise 2 🟢 — Cache Loop Length

**Problem**: A function calls an expensive method in the loop condition.

```go
type DataSource struct {
    data []int
}

func (d *DataSource) Size() int {
    // Simulates an expensive operation (e.g., database count query)
    return len(d.data)
}

func processSource(src *DataSource) int {
    sum := 0
    for i := 0; i < src.Size(); i++ {  // Size() called every iteration!
        sum += src.data[i]
    }
    return sum
}
```

**Question**: How many times is `Size()` called? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: `src.Size()` is called on every iteration — N+1 times total (once for each condition check, including the final failed check). If `Size()` has overhead (database query, lock, computation), this is very expensive.

**Optimized**:
```go
func processSourceFast(src *DataSource) int {
    sum := 0
    n := src.Size()  // call once, cache the result
    for i := 0; i < n; i++ {
        sum += src.data[i]
    }
    return sum
}
```

**Alternative** — init statement:
```go
for i, n := 0, src.Size(); i < n; i++ {
    sum += src.data[i]
}
```

**Key insight**: Never call functions with side effects or overhead in the loop condition. Always cache the result.

Note: For `len(slice)`, the Go compiler knows it's a struct field read and often optimizes it. But for method calls, always cache manually.
</details>

---

## Exercise 3 🟢 — Avoid Repeated String Concatenation in Loop

**Problem**: Building a large string by concatenation inside a loop.

```go
func buildCSV(rows [][]string) string {
    result := ""
    for i := 0; i < len(rows); i++ {
        for j := 0; j < len(rows[i]); j++ {
            result += rows[i][j]
            if j < len(rows[i])-1 {
                result += ","
            }
        }
        result += "\n"
    }
    return result
}
```

**Question**: Why is `+=` for strings in a loop a performance problem?

<details>
<summary>Solution</summary>

**Issue**: Strings in Go are immutable. Each `result += s` creates a **new string** by copying all existing content plus the new suffix. For N concatenations of average length L, total work is O(N×L) — quadratic!

For a 1000-row CSV: ~1000 × avg_line_length copies ≈ millions of bytes copied.

**Optimized** — Use `strings.Builder`:
```go
import "strings"

func buildCSVFast(rows [][]string) string {
    var sb strings.Builder
    for i := 0; i < len(rows); i++ {
        for j := 0; j < len(rows[i]); j++ {
            sb.WriteString(rows[i][j])
            if j < len(rows[i])-1 {
                sb.WriteByte(',')
            }
        }
        sb.WriteByte('\n')
    }
    return sb.String()
}
```

**Even better** — Estimate and pre-grow the builder:
```go
func buildCSVBetter(rows [][]string) string {
    // Estimate size to avoid internal reallocations
    estimatedSize := 0
    for _, row := range rows {
        for _, cell := range row {
            estimatedSize += len(cell) + 1
        }
    }
    var sb strings.Builder
    sb.Grow(estimatedSize)
    // ... rest of loop
}
```

**Benchmark** (1000 rows × 10 columns):
- String concat: ~15 ms
- strings.Builder: ~0.8 ms (~18x faster)
</details>

---

## Exercise 4 🟡 — O(n²) Search to O(n) Map Lookup

**Problem**: Finding matching users across two large slices.

```go
func findCommonUsers(listA, listB []User) []User {
    var common []User
    for i := 0; i < len(listA); i++ {
        for j := 0; j < len(listB); j++ {
            if listA[i].ID == listB[j].ID {
                common = append(common, listA[i])
                break
            }
        }
    }
    return common
}
```

**Question**: What is the time complexity? How do you reduce it?

<details>
<summary>Solution</summary>

**Issue**: O(n×m) where n = len(listA), m = len(listB). For 10,000 × 10,000 users = 100,000,000 comparisons.

**Optimized** — Build a set from listB, then single-pass through listA:
```go
func findCommonUsersFast(listA, listB []User) []User {
    // Build O(1) lookup set from the smaller list
    setB := make(map[int]struct{}, len(listB))
    for i := 0; i < len(listB); i++ {
        setB[listB[i].ID] = struct{}{}
    }

    // Single pass through listA
    common := make([]User, 0)
    for i := 0; i < len(listA); i++ {
        if _, ok := setB[listA[i].ID]; ok {
            common = append(common, listA[i])
        }
    }
    return common
}
```

**Complexity**:
- Before: O(n×m)
- After: O(n+m) — build map O(m) + search O(n)

**Benchmark** (10,000 × 10,000):
- O(n²): ~450ms
- O(n+m): ~2ms (~225x faster)
</details>

---

## Exercise 5 🟡 — Eliminate Bounds Checks

**Problem**: A tight sum loop that the compiler cannot BCE-optimize.

```go
func sumEvery3rd(s []int) int {
    total := 0
    indices := []int{}
    for i := 0; i < len(s); i += 3 {
        indices = append(indices, i)
    }
    for i := 0; i < len(indices); i++ {
        total += s[indices[i]]  // bounds check not eliminated
    }
    return total
}
```

**Question**: Why does `s[indices[i]]` have a bounds check? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: The compiler cannot prove that `indices[i]` is always a valid index for `s`. Even though we constructed `indices` to only contain valid indices, the compiler's BCE pass doesn't track that relationship. Every `s[indices[i]]` access requires a runtime bounds check.

**Optimized 1** — Eliminate the indices slice entirely:
```go
func sumEvery3rdFast(s []int) int {
    total := 0
    for i := 0; i < len(s); i += 3 {
        total += s[i]  // BCE: i < len(s) is the loop condition
    }
    return total
}
```

**Optimized 2** — If you must use indices, pre-check to enable BCE:
```go
func sumEvery3rdSafe(s []int, indices []int) int {
    // Pre-validate all indices
    for _, idx := range indices {
        if idx < 0 || idx >= len(s) {
            panic("index out of range")
        }
    }
    // After pre-check, compiler may eliminate bounds checks
    // (Note: current Go compiler doesn't always do this)
    total := 0
    for i := 0; i < len(indices); i++ {
        total += s[indices[i]]
    }
    return total
}
```

**Check BCE**:
```bash
go build -gcflags="-d=ssa/check_bce/debug=1" main.go
```

**Key insight**: BCE works best when the loop condition directly bounds the index (`i < len(s)` and `s[i]`). Indirect indexing (`s[indices[i]]`) defeats BCE.
</details>

---

## Exercise 6 🟡 — Cache-Friendly Matrix Traversal

**Problem**: A matrix sum function using column-major order.

```go
func sumMatrix(matrix [][]float64) float64 {
    rows := len(matrix)
    if rows == 0 { return 0 }
    cols := len(matrix[0])

    var sum float64
    // Column-major traversal (cache-unfriendly for row-major storage)
    for j := 0; j < cols; j++ {
        for i := 0; i < rows; i++ {
            sum += matrix[i][j]
        }
    }
    return sum
}
```

**Question**: Why is column-major traversal slower? How do you fix it?

<details>
<summary>Solution</summary>

**Issue**: Go (like C) stores 2D slices in row-major order. `matrix[0][0], matrix[0][1], matrix[0][2]...` are contiguous in memory. `matrix[0][0], matrix[1][0], matrix[2][0]...` are separated by `cols × 8` bytes.

Column-major traversal accesses `matrix[0][j], matrix[1][j], matrix[2][j]...` — each access is a stride of the entire row width. For a 1000×1000 matrix, each column access is 8000 bytes apart — well beyond the typical L1 cache line (64 bytes). Every access is a cache miss.

Row-major traversal accesses `matrix[i][0], matrix[i][1], matrix[i][2]...` — contiguous, all in the same cache lines.

**Optimized** — Row-major traversal:
```go
func sumMatrixFast(matrix [][]float64) float64 {
    var sum float64
    for i := 0; i < len(matrix); i++ {
        row := matrix[i]           // cache the row slice header
        for j := 0; j < len(row); j++ {
            sum += row[j]          // sequential access — cache-friendly
        }
    }
    return sum
}
```

**Benchmark** (1000x1000 float64 matrix):
- Column-major: ~12 ms (~30% L1 cache miss rate)
- Row-major: ~2.5 ms (~98% cache hit rate)
- ~5x speedup from access pattern alone
</details>

---

## Exercise 7 🟡 — Parallel Loop Optimization

**Problem**: A function processes a large slice sequentially.

```go
func processLargeSlice(items []Item) []Result {
    results := make([]Result, len(items))
    for i := 0; i < len(items); i++ {
        results[i] = expensiveProcess(items[i])
    }
    return results
}
```

**Question**: How do you parallelize this safely? What is the optimal number of workers?

<details>
<summary>Solution</summary>

**Issue**: Single-threaded — wastes available CPU cores. Each `expensiveProcess` is independent.

**Optimized** — Parallel with goroutines:
```go
import (
    "runtime"
    "sync"
)

func processLargeSliceFast(items []Item) []Result {
    numWorkers := runtime.NumCPU()
    results := make([]Result, len(items))
    var wg sync.WaitGroup

    chunkSize := (len(items) + numWorkers - 1) / numWorkers

    for w := 0; w < numWorkers; w++ {
        lo := w * chunkSize
        hi := lo + chunkSize
        if hi > len(items) { hi = len(items) }
        if lo >= hi { break }

        wg.Add(1)
        go func(lo, hi int) {
            defer wg.Done()
            for i := lo; i < hi; i++ {
                results[i] = expensiveProcess(items[i])
            }
        }(lo, hi)
    }

    wg.Wait()
    return results
}
```

**Optimal worker count**:
- CPU-bound: `runtime.NumCPU()` (or slightly less to leave room for other goroutines)
- IO-bound: 10x-100x `runtime.NumCPU()` (most goroutines are waiting on IO)
- Mixed: profile to find the sweet spot

**Benchmark** (10,000 items × 1ms each, 8 cores):
- Sequential: ~10 seconds
- 8 workers: ~1.3 seconds (~7.7x speedup)

**Key insight**: Write to `results[i]` using the goroutine's own index — no mutex needed because goroutines write to different indices.
</details>

---

## Exercise 8 🔴 — Loop Unrolling for SIMD

**Problem**: A performance-critical byte processing loop.

```go
func xorSlice(dst, src []byte, key byte) {
    for i := 0; i < len(dst); i++ {
        dst[i] = src[i] ^ key
    }
}
```

**Question**: How can this loop be written to help the compiler generate SIMD instructions?

<details>
<summary>Solution</summary>

**Issue**: The loop processes 1 byte at a time. Modern CPUs have 128-256 bit SIMD registers that can process 16-32 bytes simultaneously. The current form may not vectorize if the compiler doesn't recognize the pattern.

**Optimization 1** — Process 8 bytes at a time (manual unrolling):
```go
func xorSliceUnrolled(dst, src []byte, key byte) {
    n := len(dst)
    i := 0
    // Process 8 bytes per iteration
    key8 := uint64(key) | uint64(key)<<8 | uint64(key)<<16 | uint64(key)<<24 |
            uint64(key)<<32 | uint64(key)<<40 | uint64(key)<<48 | uint64(key)<<56
    for ; i+8 <= n; i += 8 {
        v := *(*uint64)(unsafe.Pointer(&src[i]))
        *(*uint64)(unsafe.Pointer(&dst[i])) = v ^ key8
    }
    // Handle remainder
    for ; i < n; i++ {
        dst[i] = src[i] ^ key
    }
}
```

**Optimization 2** — Use `golang.org/x/sys/cpu` + assembly for explicit SIMD:
```go
// For production: use the stdlib's internal/cpu or golang.org/x/sys
// Go's internal XOR operations in crypto/cipher use SIMD via assembly
```

**Optimization 3** — Pure Go, clean for compiler vectorization:
```go
// Some compilers detect this pattern and auto-vectorize
func xorSliceClean(dst, src []byte, key byte) {
    for i := range dst {  // simpler form — compiler may vectorize
        dst[i] = src[i] ^ key
    }
}
```

**Benchmark** (10MB, Apple M2):
- Byte-by-byte: ~8 ms
- 8-byte unroll: ~2 ms
- SIMD (assembly): ~0.5 ms

**Note**: In practice, use `bytes.Map` or `crypto/cipher` which have optimized SIMD implementations rather than writing assembly yourself.
</details>

---

## Exercise 9 🔴 — Eliminate Unnecessary Allocations in Tight Loop

**Problem**: A hot path that creates temporary objects each iteration.

```go
type Buffer struct {
    data []byte
    size int
}

func processRequests(requests []Request) []Response {
    responses := make([]Response, len(requests))
    for i := 0; i < len(requests); i++ {
        buf := &Buffer{         // heap allocation per request!
            data: make([]byte, 1024),
            size: 0,
        }
        responses[i] = process(requests[i], buf)
    }
    return responses
}
```

**Question**: How do you eliminate the per-iteration heap allocation?

<details>
<summary>Solution</summary>

**Issue**: Each iteration allocates `*Buffer` on the heap (~50-200ns per allocation). For 1 million requests/second, that's 1 million allocations/second with GC pressure.

**Solution 1** — Reuse a single buffer (single-threaded):
```go
func processRequestsFast(requests []Request) []Response {
    responses := make([]Response, len(requests))
    buf := &Buffer{data: make([]byte, 1024)}  // allocate once

    for i := 0; i < len(requests); i++ {
        buf.size = 0  // reset, not reallocate
        responses[i] = process(requests[i], buf)
    }
    return responses
}
```

**Solution 2** — Stack allocation (small struct):
```go
func processRequestsStack(requests []Request) []Response {
    responses := make([]Response, len(requests))
    for i := 0; i < len(requests); i++ {
        var buf Buffer           // stack allocation (if it doesn't escape)
        buf.data = make([]byte, 1024)  // still heap for the slice...
        responses[i] = process(requests[i], &buf)
    }
    return responses
}
// Check with: go build -gcflags="-m" — look for "buf escapes to heap"
```

**Solution 3** — sync.Pool for concurrent access:
```go
var bufPool = sync.Pool{
    New: func() interface{} {
        return &Buffer{data: make([]byte, 1024)}
    },
}

func processRequestsPool(requests []Request) []Response {
    responses := make([]Response, len(requests))
    for i := 0; i < len(requests); i++ {
        buf := bufPool.Get().(*Buffer)
        buf.size = 0
        responses[i] = process(requests[i], buf)
        bufPool.Put(buf)
    }
    return responses
}
```

**Benchmark** (1 million requests):
- Per-iteration alloc: ~180ms (GC overhead)
- Single reuse: ~45ms
- sync.Pool: ~50ms (better for concurrent access)
</details>

---

## Exercise 10 🔴 — Optimize Nested Loop with Index Math

**Problem**: A function converts a 1D index to a 2D index with expensive division/modulo.

```go
const Cols = 1000

func flatToMatrix(flat []float64, rows, cols int) [][]float64 {
    result := make([][]float64, rows)
    for i := range result {
        result[i] = make([]float64, cols)
    }
    for i := 0; i < len(flat); i++ {
        row := i / cols    // division — expensive
        col := i % cols    // modulo — expensive
        result[row][col] = flat[i]
    }
    return result
}
```

**Question**: How do you eliminate the division and modulo operations?

<details>
<summary>Solution</summary>

**Issue**: Integer division (`/`) and modulo (`%`) are expensive — ~30 cycles each on modern CPUs. For a 1,000,000-element flat array, that's ~60 million expensive operations.

**Optimization 1** — Use row/col counters instead of division:
```go
func flatToMatrixFast(flat []float64, rows, cols int) [][]float64 {
    result := make([][]float64, rows)
    for i := range result {
        result[i] = make([]float64, cols)
    }

    row, col := 0, 0
    for i := 0; i < len(flat); i++ {
        result[row][col] = flat[i]
        col++
        if col == cols {
            col = 0
            row++
        }
    }
    return result
}
```

**Optimization 2** — Use nested loops directly (best approach):
```go
func flatToMatrixBest(flat []float64, rows, cols int) [][]float64 {
    result := make([][]float64, rows)
    for i := 0; i < rows; i++ {
        result[i] = flat[i*cols : (i+1)*cols]  // slice of flat — no copy!
    }
    return result
}
```

**Optimization 3** — Same slice, different view (zero allocation):
```go
func flatToMatrixView(flat []float64, rows, cols int) [][]float64 {
    result := make([][]float64, rows)
    for i := 0; i < rows; i++ {
        start := i * cols
        result[i] = flat[start : start+cols : start+cols]  // full slice expression
    }
    return result
}
```

**Benchmark** (1,000×1,000 matrix):
- Division/modulo: ~8 ms
- Counter-based: ~3 ms
- Slice view (zero-copy): ~0.1 ms (~80x faster!)

**Key insight**: Division and modulo operations are expensive. Use counters or clever slicing to eliminate them. In this case, the best solution avoids copying entirely.
</details>
