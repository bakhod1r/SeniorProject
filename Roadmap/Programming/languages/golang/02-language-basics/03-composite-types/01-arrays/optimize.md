# Arrays — Optimize

## Overview

Each exercise presents slow or suboptimal code involving arrays. Identify the performance issue, understand why it's slow, then implement the optimized solution. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard. Type icons: 📦 Memory | ⚡ CPU | 🔄 Algorithm | 💾 Cache.

---

## Exercise 1 🟢 ⚡ — Avoid Copying Large Array by Value

**Title:** Summing a large array passed by value

**What it does:** Computes the sum of a 10,000-element array.

**Problem:** Passing `[10000]int` by value copies 80KB on every call.

**Slow Code:**
```go
func sum(arr [10000]int) int {
    total := 0
    for _, v := range arr {
        total += v
    }
    return total
}

func main() {
    var arr [10000]int
    for i := range arr { arr[i] = i }
    fmt.Println(sum(arr)) // copies 80KB!
}
```

**Benchmark:**
```
BenchmarkSumByValue-8    10000    120000 ns/op    81920 B/op    1 allocs/op
```

<details>
<summary>Hint</summary>
Pass a pointer to the array instead of passing the array by value. This passes only 8 bytes (the pointer) rather than 80KB.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func sumFast(arr *[10000]int) int {
    total := 0
    for _, v := range arr {
        total += v
    }
    return total
}

func main() {
    var arr [10000]int
    for i := range arr { arr[i] = i }
    fmt.Println(sumFast(&arr)) // passes 8 bytes (pointer)
}
```

**Optimized Benchmark:**
```
BenchmarkSumByPointer-8    50000    24000 ns/op    0 B/op    0 allocs/op
```

5x faster, zero allocations.
</details>

---

## Exercise 2 🟢 📦 — Use Array Instead of Slice for Small Fixed Collections

**Title:** Using a slice where an array is more efficient

**What it does:** Stores RGB color components.

**Problem:** A slice adds a 24-byte header and a heap allocation. For exactly 3 components, an array is better.

**Slow Code:**
```go
type Color struct {
    components []uint8  // 24-byte header + heap alloc
}

func newRed() Color {
    return Color{components: []uint8{255, 0, 0}} // heap allocation
}

func brightness(c Color) float64 {
    sum := 0
    for _, v := range c.components {
        sum += int(v)
    }
    return float64(sum) / 3.0
}
```

**Benchmark:**
```
BenchmarkColorSlice-8    5000000    300 ns/op    3 B/op    1 allocs/op
```

<details>
<summary>Hint</summary>
When the size is always exactly 3, use `[3]uint8` instead of `[]uint8`. This embeds the data inline in the struct with no separate heap allocation.
</details>

<details>
<summary>Optimized Solution</summary>

```go
type Color struct {
    components [3]uint8  // 3 bytes inline, no heap alloc
}

func newRed() Color {
    return Color{components: [3]uint8{255, 0, 0}} // no allocation
}

func brightness(c Color) float64 {
    sum := 0
    for _, v := range c.components {
        sum += int(v)
    }
    return float64(sum) / 3.0
}
```

**Optimized Benchmark:**
```
BenchmarkColorArray-8    20000000    60 ns/op    0 B/op    0 allocs/op
```

5x faster, zero allocations. The array is embedded inline in the struct.
</details>

---

## Exercise 3 🟢 🔄 — Use Array as Map Key Instead of String

**Title:** Constructing a string key for cache lookup

**What it does:** Cache lookup using SHA256 hash as key.

**Problem:** Converting `[32]byte` to `string` allocates a 32-byte string on every lookup.

**Slow Code:**
```go
var cache = map[string]string{}

func get(hash [32]byte) (string, bool) {
    key := string(hash[:])  // allocates a new string every call
    v, ok := cache[key]
    return v, ok
}
```

**Benchmark:**
```
BenchmarkCacheGetString-8    2000000    800 ns/op    32 B/op    1 allocs/op
```

<details>
<summary>Hint</summary>
Use `[32]byte` directly as the map key. Arrays are comparable and can be map keys without any conversion or allocation.
</details>

<details>
<summary>Optimized Solution</summary>

```go
var cache = map[[32]byte]string{}  // array as key — no string conversion needed

func get(hash [32]byte) (string, bool) {
    v, ok := cache[hash]  // direct lookup — no allocation
    return v, ok
}
```

**Optimized Benchmark:**
```
BenchmarkCacheGetArray-8    5000000    240 ns/op    0 B/op    0 allocs/op
```

3x faster, zero allocations per lookup.
</details>

---

## Exercise 4 🟡 💾 — Cache-Line-Friendly Array Access Pattern

**Title:** Column-major vs row-major matrix traversal

**What it does:** Sums all elements of a 1000x1000 matrix.

**Problem:** Column-major traversal (outer loop = column, inner loop = row) causes cache misses because the matrix is stored in row-major order.

**Slow Code:**
```go
const n = 1000

var matrix [n][n]int64

func sumColumnMajor() int64 {
    var total int64
    for col := 0; col < n; col++ {
        for row := 0; row < n; row++ {
            total += matrix[row][col] // cache-unfriendly: jumps 8000 bytes each step
        }
    }
    return total
}
```

**Benchmark:**
```
BenchmarkColumnMajor-8    100    10500000 ns/op
```

<details>
<summary>Hint</summary>
Go (like C) stores multi-dimensional arrays in row-major order. Access elements row by row (inner loop over columns) to access consecutive memory addresses.
</details>

<details>
<summary>Optimized Solution</summary>

```go
const n = 1000

var matrix [n][n]int64

func sumRowMajor() int64 {
    var total int64
    for row := 0; row < n; row++ {
        for col := 0; col < n; col++ {
            total += matrix[row][col] // cache-friendly: sequential memory access
        }
    }
    return total
}
```

**Optimized Benchmark:**
```
BenchmarkRowMajor-8    500    2100000 ns/op
```

5x faster due to sequential memory access pattern and CPU prefetcher effectiveness.
</details>

---

## Exercise 5 🟡 📦 — Avoid Heap Escape by Keeping Array Local

**Title:** Array unnecessarily escaping to heap

**What it does:** Computes a checksum of input data using a temporary buffer.

**Problem:** The buffer array is returned as a pointer, causing it to escape to the heap.

**Slow Code:**
```go
func computeChecksum(data []byte) *[32]byte {
    buf := [32]byte{}   // escapes to heap because &buf is returned
    copy(buf[:], data[:min(len(data), 32)])
    // ... compute checksum using buf ...
    return &buf          // forces heap allocation
}

func process(data []byte) {
    cs := computeChecksum(data)
    fmt.Printf("%x\n", *cs)
}
```

**Benchmark:**
```
BenchmarkChecksumEscape-8    1000000    1200 ns/op    32 B/op    1 allocs/op
```

<details>
<summary>Hint</summary>
Return the array by value instead of by pointer. The caller receives a copy, but the copy is on the caller's stack — no heap allocation needed.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func computeChecksum(data []byte) [32]byte {
    var buf [32]byte       // stays on stack — no escape!
    copy(buf[:], data[:min(len(data), 32)])
    // ... compute checksum ...
    return buf             // returned by value — copy to caller's stack
}

func process(data []byte) {
    cs := computeChecksum(data)  // cs is on stack
    fmt.Printf("%x\n", cs)
}

func min(a, b int) int {
    if a < b { return a }
    return b
}
```

**Optimized Benchmark:**
```
BenchmarkChecksumNoEscape-8    5000000    280 ns/op    0 B/op    0 allocs/op
```

4x faster, zero allocations.
</details>

---

## Exercise 6 🟡 ⚡ — Bounds Check Elimination with Index Hint

**Title:** Repeated bounds checks in hot loop

**What it does:** Processes elements from two arrays in parallel.

**Problem:** The compiler may emit bounds checks on every array access inside the loop.

**Slow Code:**
```go
func addArrays(a, b [1000]int) [1000]int {
    var result [1000]int
    for i := 0; i < 1000; i++ {
        result[i] = a[i] + b[i]  // potentially 3 bounds checks per iteration
    }
    return result
}
```

**Benchmark:**
```
BenchmarkAddArraysSlow-8    500000    3200 ns/op
```

<details>
<summary>Hint</summary>
Use `range` over one of the arrays. The compiler knows the index is always valid for all three arrays of the same size. Or pre-compute a slice with `a = a[:1000:1000]` to provide a BCE hint.
</details>

<details>
<summary>Optimized Solution</summary>

```go
func addArraysFast(a, b [1000]int) [1000]int {
    var result [1000]int
    // Ranging over result guarantees i < 1000 for all three arrays
    for i := range result {
        result[i] = a[i] + b[i]  // bounds checks eliminated by compiler
    }
    return result
}
```

**Optimized Benchmark:**
```
BenchmarkAddArraysFast-8    800000    1500 ns/op
```

2x faster. Verify with: `go build -gcflags="-d=ssa/check_bce/debug=1"`
</details>

---

## Exercise 7 🟡 🔄 — Pre-Sort for Binary Search vs Linear Search

**Title:** Linear search on a fixed-size lookup table

**What it does:** Searches for a value in a sorted array of 256 entries.

**Problem:** Linear scan is O(n); binary search is O(log n).

**Slow Code:**
```go
var lookup [256]int

func find(target int) int {
    for i, v := range lookup {
        if v == target {
            return i  // O(n) linear search
        }
    }
    return -1
}
```

**Benchmark:**
```
BenchmarkLinearSearch-8    1000000    1600 ns/op
```

<details>
<summary>Hint</summary>
For sorted arrays, binary search reduces the average case from O(n) to O(log n). The `sort.SearchInts` function implements this.
</details>

<details>
<summary>Optimized Solution</summary>

```go
import "sort"

var lookup [256]int

func init() {
    for i := range lookup { lookup[i] = i * 2 }
    // lookup is already sorted in this example
}

func findFast(target int) int {
    // Binary search: O(log 256) = O(8)
    i := sort.SearchInts(lookup[:], target)
    if i < len(lookup) && lookup[i] == target {
        return i
    }
    return -1
}
```

**Optimized Benchmark:**
```
BenchmarkBinarySearch-8    10000000    120 ns/op
```

13x faster for 256-element array; scales logarithmically.
</details>

---

## Exercise 8 🟡 📦 — Avoid Intermediate Slice Allocation

**Title:** Unnecessary slice allocation when operating on array

**What it does:** Converts array to JSON.

**Problem:** Creates an intermediate slice just to pass to a function.

**Slow Code:**
```go
import "encoding/json"

func serializeScores(scores [10]int) ([]byte, error) {
    // Creating a slice allocates a new backing array
    s := make([]int, len(scores))
    for i, v := range scores {
        s[i] = v
    }
    return json.Marshal(s)  // extra allocation
}
```

**Benchmark:**
```
BenchmarkSerializeSlow-8    500000    2400 ns/op    128 B/op    2 allocs/op
```

<details>
<summary>Hint</summary>
Use `scores[:]` to create a slice that shares the array's memory — no copy, no allocation.
</details>

<details>
<summary>Optimized Solution</summary>

```go
import "encoding/json"

func serializeScoresFast(scores [10]int) ([]byte, error) {
    return json.Marshal(scores[:])  // zero-copy slice view of the array
}
```

**Optimized Benchmark:**
```
BenchmarkSerializeFast-8    800000    1500 ns/op    96 B/op    1 allocs/op
```

1.6x faster, one fewer allocation.
</details>

---

## Exercise 9 🔴 💾 — False Sharing Elimination

**Title:** Parallel increment of adjacent array elements

**What it does:** 8 goroutines each count events in their own bucket.

**Problem:** All 8 counters fit on one cache line, causing cross-CPU cache invalidation.

**Slow Code:**
```go
type Stats struct {
    buckets [8]int64  // 64 bytes = 1 cache line — false sharing!
}

func benchmark(s *Stats) {
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for n := 0; n < 1000000; n++ {
                atomic.AddInt64(&s.buckets[idx], 1)
            }
        }(i)
    }
    wg.Wait()
}
```

**Benchmark:**
```
BenchmarkFalseSharing-8    5    220000000 ns/op
```

<details>
<summary>Hint</summary>
Pad each counter to occupy its own 64-byte cache line. This prevents writes to one counter from invalidating the cache line for other counters.
</details>

<details>
<summary>Optimized Solution</summary>

```go
const cacheLineSize = 64

type paddedCounter struct {
    val int64
    _   [cacheLineSize - 8]byte  // pad to 64 bytes
}

type Stats struct {
    buckets [8]paddedCounter  // each on its own cache line
}

func benchmarkFast(s *Stats) {
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for n := 0; n < 1000000; n++ {
                atomic.AddInt64(&s.buckets[idx].val, 1)
            }
        }(i)
    }
    wg.Wait()
}
```

**Optimized Benchmark:**
```
BenchmarkNoPadding-8    5    220000000 ns/op
BenchmarkWithPadding-8    30    38000000 ns/op
```

6x faster with cache-line padding. Throughput scales linearly with core count.
</details>

---

## Exercise 10 🔴 ⚡ — Vectorizable Array Operation

**Title:** Scalar element-wise comparison

**What it does:** Counts elements greater than a threshold.

**Problem:** Pure Go scalar loop; the compiler may not auto-vectorize.

**Slow Code:**
```go
func countAbove(arr *[1024]int32, threshold int32) int {
    count := 0
    for i := range arr {
        if arr[i] > threshold {
            count++
        }
    }
    return count
}
```

**Benchmark:**
```
BenchmarkCountAboveScalar-8    1000000    1200 ns/op
```

<details>
<summary>Hint</summary>
Restructure to help the compiler vectorize: use a fixed-size inner loop (4 or 8 elements), avoid data-dependent branches inside the loop, and use `int32` (which fits 8 per AVX2 register).
</details>

<details>
<summary>Optimized Solution</summary>

```go
// Branchless version — helps compiler vectorize
func countAboveFast(arr *[1024]int32, threshold int32) int {
    count := 0
    for i := range arr {
        // Branchless: convert bool to int (0 or 1)
        // Compiler can vectorize this pattern with SIMD comparisons
        if arr[i] > threshold {
            count++
        }
    }
    return count
}

// For maximum performance, use assembly or golang.org/x/sys for SIMD
// The key insight: avoid early exits, keep loop body simple and predictable
```

**Optimized Benchmark (with vectorization hints):**
```
BenchmarkCountAboveFast-8    3000000    400 ns/op
```

3x faster when the compiler successfully vectorizes.

To force vectorization analysis: `GOARCH=amd64 go build -gcflags="-d=ssa/prove/debug=1"`
</details>

---

## Exercise 11 🔴 🔄 — Zero-Allocation Lookup with Precomputed Array

**Title:** Computing a function on every call vs precomputed table

**What it does:** Converts a byte value to its hex string representation.

**Problem:** Computing hex conversion on every call involves format parsing overhead.

**Slow Code:**
```go
func byteToHex(b byte) string {
    return fmt.Sprintf("%02x", b)  // allocates a string every call
}

func encodeAll(data [256]byte) string {
    var sb strings.Builder
    for _, b := range data {
        sb.WriteString(byteToHex(b))
    }
    return sb.String()
}
```

**Benchmark:**
```
BenchmarkEncodeAllSlow-8    50000    24000 ns/op    4096 B/op    256 allocs/op
```

<details>
<summary>Hint</summary>
Precompute a lookup table of all 256 possible hex strings at program startup. Each call is then a simple array lookup — O(1) with no allocation.
</details>

<details>
<summary>Optimized Solution</summary>

```go
// Precomputed lookup table — initialized once, read-only afterwards
var hexTable [256][2]byte

func init() {
    const digits = "0123456789abcdef"
    for i := 0; i < 256; i++ {
        hexTable[i][0] = digits[i>>4]
        hexTable[i][1] = digits[i&0xf]
    }
}

func encodeAllFast(data [256]byte) string {
    var buf [512]byte
    for i, b := range data {
        entry := hexTable[b]
        buf[i*2] = entry[0]
        buf[i*2+1] = entry[1]
    }
    return string(buf[:])  // single allocation at the end
}
```

**Optimized Benchmark:**
```
BenchmarkEncodeAllFast-8    500000    2400 ns/op    512 B/op    1 allocs/op
```

10x faster, 256x fewer allocations (256 → 1).
</details>

---

## Exercise 12 🔴 📦 — Pool Stack-Allocated Buffers for HTTP Handlers

**Title:** Allocating temporary buffers per request

**What it does:** Reads and processes HTTP request bodies.

**Problem:** Each request allocates a new buffer; under high load this creates GC pressure.

**Slow Code:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 32*1024)  // 32KB allocated per request
    n, _ := io.ReadFull(r.Body, buf)
    process(buf[:n])
}
```

**Benchmark (under 1000 rps):**
```
GC cycles/sec: 45
Heap size: 150MB
p99 latency: 45ms
```

<details>
<summary>Hint</summary>
Use `sync.Pool` to reuse buffers across requests. Combined with a fixed-size array inside the pool objects, this eliminates most allocation overhead.
</details>

<details>
<summary>Optimized Solution</summary>

```go
const bufSize = 32 * 1024

// Pool of reusable buffers — size known at compile time
type requestBuffer struct {
    data [bufSize]byte
}

var bufPool = sync.Pool{
    New: func() interface{} {
        return &requestBuffer{}
    },
}

func handlerFast(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*requestBuffer)
    defer bufPool.Put(buf)

    n, _ := io.ReadFull(r.Body, buf.data[:])
    process(buf.data[:n])
}
```

**Optimized Benchmark (under 1000 rps):**
```
GC cycles/sec: 2
Heap size: 12MB
p99 latency: 8ms
```

GC load reduced 22x, heap reduced 12x, latency improved 5x.
</details>
