# Arrays — Senior Level

## Table of Contents
1. Introduction
2. Architecture Considerations
3. Memory Layout & Alignment
4. Escape Analysis Deep Dive
5. Compiler Optimizations (BCE, Loop Unrolling)
6. SIMD Opportunities
7. Arrays in Concurrent Systems
8. Postmortems & System Failures
9. Advanced Patterns
10. Benchmarking & Profiling
11. Trade-off Analysis
12. Integration with Unsafe Package
13. Test
14. Tricky Questions
15. Summary
16. Further Reading

---

## Introduction

At the senior level, arrays are a **performance primitive** and a **type-system tool**. You need to understand how the Go compiler transforms array operations, when arrays cause GC pressure, how alignment affects cache performance, and how fixed-size arrays enable zero-cost abstractions in production systems.

The senior engineer's relationship with arrays is shaped by questions like: Why does `crypto/sha256` return `[32]byte` instead of allocating on the heap? How does the Go compiler eliminate redundant bounds checks? When does an array escape to the heap and what does that cost? How can you use arrays to build lock-free concurrent data structures?

---

## Architecture Considerations

### Typed Domain Values with Arrays

Arrays enable **typed, fixed-size identifiers** that are comparable and hashable without allocation:

```go
package main

import (
    "crypto/subtle"
    "fmt"
)

type UserID    [16]byte
type SessionID [16]byte
type FileHash  [32]byte

// This won't compile — type safety enforced at compile time
// func badAuthenticate(user UserID, sess SessionID) bool {
//     return user == sess // ERROR: mismatched types
// }

func authenticate(user UserID, expected UserID) bool {
    return subtle.ConstantTimeCompare(user[:], expected[:]) == 1
}

func main() {
    u := UserID{1, 2, 3}
    fmt.Println(authenticate(u, u)) // true
}
```

### Zero-Allocation Cache Keys

```go
package main

import (
    "crypto/sha256"
    "sync"
)

type QueryResult struct{ Data []byte }

type QueryCache struct {
    mu    sync.RWMutex
    cache map[[32]byte]QueryResult
}

func (c *QueryCache) Get(input []byte) (QueryResult, bool) {
    key := sha256.Sum256(input) // [32]byte, stack-allocated — no heap alloc!
    c.mu.RLock()
    defer c.mu.RUnlock()
    result, ok := c.cache[key]
    return result, ok
}

func (c *QueryCache) Set(input []byte, result QueryResult) {
    key := sha256.Sum256(input)
    c.mu.Lock()
    defer c.mu.Unlock()
    c.cache[key] = result
}
```

This pattern avoids the string allocation that `map[string]...` would require when constructing a key from bytes.

---

## Memory Layout & Alignment

### Struct Field Alignment with Arrays

```go
import "unsafe"

// Poorly aligned struct — 24 bytes
type Bad struct {
    a byte      // 1 byte at offset 0
    // 7 bytes padding
    b int64     // 8 bytes at offset 8
    c [3]byte   // 3 bytes at offset 16
    // 5 bytes padding
}

// Well aligned struct — 12 bytes
type Good struct {
    b int64     // 8 bytes at offset 0
    c [3]byte   // 3 bytes at offset 8
    a byte      // 1 byte at offset 11
}

func main() {
    fmt.Println(unsafe.Sizeof(Bad{}))  // 24
    fmt.Println(unsafe.Sizeof(Good{})) // 12
}
```

### False Sharing in Concurrent Array Access

```go
// BAD: goroutines accessing adjacent elements share a cache line
// A cache line is typically 64 bytes = 8 int64 values
type Counters struct {
    data [8]int64 // 64 bytes — exactly one cache line
}
// Writing data[0] invalidates data[1..7] for other CPUs

// GOOD: pad each counter to its own cache line
type PaddedCounter struct {
    value int64
    _     [56]byte // pad to 64 bytes total
}

type Counters struct {
    data [8]PaddedCounter // each on its own cache line
}
```

---

## Escape Analysis Deep Dive

Go's escape analysis determines whether a variable stays on the stack or moves to the heap. Arrays are interesting because large ones or those whose address escapes will be heap-allocated.

```go
// Stays on stack: no address escapes
func stackExample() int {
    arr := [64]int{}
    for i := range arr { arr[i] = i }
    return arr[32]
}

// Escapes to heap: pointer returned
func heapExample() *[64]int {
    arr := [64]int{} // "arr escapes to heap" in -gcflags="-m"
    return &arr
}

// Escapes to heap: stored in interface
func interfaceEscape() {
    arr := [64]int{}
    var i interface{} = arr // arr's copy escapes
    _ = i
}
```

**To inspect:** `go build -gcflags="-m -l" ./...`

Output examples:
```
./main.go:3:6: arr does not escape
./main.go:9:6: &arr escapes to heap
```

### Benchmark: Stack vs Heap Array

```go
package main_test

import "testing"

func BenchmarkStackArray(b *testing.B) {
    for n := 0; n < b.N; n++ {
        arr := [100]int{}
        for i := range arr { arr[i] = i }
        _ = arr[50]
    }
}

func BenchmarkHeapArray(b *testing.B) {
    for n := 0; n < b.N; n++ {
        arr := new([100]int)
        for i := range arr { arr[i] = i }
        _ = arr[50]
    }
}
// Stack: ~3-10x faster — no GC involvement
```

---

## Compiler Optimizations (BCE, Loop Unrolling)

### Bounds Check Elimination (BCE)

```go
// The Go compiler eliminates redundant bounds checks
// when it can prove an index is always in range

func sumArray(arr *[100]int) int {
    sum := 0
    for i := 0; i < len(arr); i++ {
        // Compiler sees: loop condition guarantees i < 100
        // So arr[i] is always safe → bounds check eliminated
        sum += arr[i]
    }
    return sum
}

// Manual hint to help BCE with slices
func sumSlice(arr []int) int {
    if len(arr) == 0 {
        return 0
    }
    arr = arr[:len(arr):len(arr)] // BCE hint: tells compiler cap >= len
    sum := 0
    for i := range arr {
        sum += arr[i] // bounds check can be eliminated
    }
    return sum
}
```

To verify BCE: `go build -gcflags="-d=ssa/check_bce/debug=1" ./...`

### Loop Unrolling

For small fixed-size arrays, the compiler can unroll loops for better instruction-level parallelism:

```go
// Dot product of [4]float64 — compiler may unroll to 4 multiplications
func dot4(a, b [4]float64) float64 {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
}
// Generated assembly avoids loop overhead entirely
```

---

## SIMD Opportunities

While Go does not expose SIMD intrinsics in the language itself, the Go assembler enables them. The standard library uses this for performance-critical operations:

```go
// Pure Go — compiler may auto-vectorize on some platforms
func addArrays(dst, a, b *[16]float32) {
    for i := range dst {
        dst[i] = a[i] + b[i]
    }
}

// Assembly (conceptual, in _amd64.s):
// Uses AVX2 VADDPS instruction for 8 float32 at once
// TEXT ·addArraysAVX2(SB),NOSPLIT,$0
//     VMOVUPS 0(SI), Y0
//     VMOVUPS 0(DX), Y1
//     VADDPS  Y1, Y0, Y0
//     VMOVUPS Y0, 0(DI)
//     RET
```

Runtime CPU detection: use `golang.org/x/sys/cpu` for conditional SIMD paths.

---

## Arrays in Concurrent Systems

### Lock-Free Array Counter with Atomics

```go
package main

import (
    "fmt"
    "sync/atomic"
)

// Fixed-size histogram with atomic operations — no mutex needed
type Histogram struct {
    buckets [16]int64
}

func (h *Histogram) Record(bucket int) {
    if bucket >= 0 && bucket < len(h.buckets) {
        atomic.AddInt64(&h.buckets[bucket], 1)
    }
}

func (h *Histogram) Get(bucket int) int64 {
    if bucket < 0 || bucket >= len(h.buckets) {
        return 0
    }
    return atomic.LoadInt64(&h.buckets[bucket])
}

func main() {
    hist := &Histogram{}
    hist.Record(3)
    hist.Record(3)
    hist.Record(7)
    fmt.Println(hist.Get(3)) // 2
    fmt.Println(hist.Get(7)) // 1
}
```

### Safe Concurrent Read-Only Array Sharing

```go
// Arrays can be safely shared across goroutines for READ-ONLY access
// (no mutex needed when all goroutines only read)

var lookupTable = [256]int{ /* precomputed values */ }

func lookupFast(key byte) int {
    return lookupTable[key] // safe concurrent read — no sync needed
}
```

---

## Postmortems & System Failures

### Incident 1: Stack Overflow from Large Array Declaration

**What happened:** A service crashed in production under load with stack overflow panics.

**Root cause:**
```go
// BAD: allocates ~4MB on the goroutine's stack PER REQUEST
func handleRequest(w http.ResponseWriter, r *http.Request) {
    var buf [4 * 1024 * 1024]byte // 4MB on stack!
    n, _ := r.Body.Read(buf[:])
    process(buf[:n])
}
// With 100 concurrent goroutines: 400MB of stack before dynamic growth
```

**Fix:**
```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 4*1024*1024) // heap-allocated, GC managed
    n, _ := r.Body.Read(buf)
    process(buf[:n])
}
// OR use a sync.Pool to reuse buffers across requests
var bufPool = sync.Pool{
    New: func() interface{} { return make([]byte, 4*1024*1024) },
}
```

**Lesson:** Never declare megabyte-sized arrays inside functions. Go stacks start at 8KB; while they grow dynamically, large fixed arrays bypass this growth and cause immediate panics.

---

### Incident 2: False Sharing Destroying Parallel Throughput

**What happened:** Adding more cores to a parallel counter system showed near-zero improvement. CPU utilization was high but throughput was flat.

**Root cause:**
```go
type Stats struct {
    counters [8]int64 // 64 bytes = exactly one CPU cache line
}
// Goroutine 0 writes counters[0]
// Goroutine 1 writes counters[1]
// Both are on the SAME cache line
// Every write forces other CPUs to reload the entire cache line → contention
```

**Fix:**
```go
type paddedInt64 struct {
    val int64
    _   [56]byte // pad to 64-byte cache line boundary
}

type Stats struct {
    counters [8]paddedInt64 // each counter on its own cache line
}
// Result: linear throughput scaling with core count
```

**Lesson:** When multiple goroutines write to different elements of the same array, check whether those elements share a cache line. If they do, pad each element to the cache line size.

---

### Incident 3: Timing Attack via Non-Constant-Time Comparison

**What happened:** A security audit found HMAC verification was vulnerable to timing attacks.

**Root cause:**
```go
// BAD: == stops at first differing byte
// Attacker can measure response time to learn how many bytes match
func verifyHMAC(provided, expected [32]byte) bool {
    return provided == expected // timing leak!
}
```

**Fix:**
```go
import "crypto/subtle"

func verifyHMAC(provided, expected [32]byte) bool {
    // Always checks all 32 bytes regardless of where mismatch occurs
    return subtle.ConstantTimeCompare(provided[:], expected[:]) == 1
}
```

**Lesson:** For security-sensitive comparisons of fixed-size arrays (HMAC tags, tokens, hashes), always use `crypto/subtle.ConstantTimeCompare`. Never use `==` or early-exit loops.

---

### Incident 4: Data Race on Array Element

**What happened:** A service running with `-race` flag occasionally detected data races on a shared statistics array.

**Root cause:**
```go
var stats [8]int64

func worker(id int) {
    // Multiple goroutines access same element without synchronization
    stats[id%8]++ // non-atomic increment — data race!
}
```

**Fix:**
```go
var stats [8]int64

func worker(id int) {
    atomic.AddInt64(&stats[id%8], 1) // atomic operation
}
```

---

## Advanced Patterns

### Pattern: Typed Fixed-Size Identifier

```go
type AES128Key [16]byte
type AES256Key [32]byte

// Type system prevents accidental key size mismatch
func encryptAES128(key AES128Key, plaintext []byte) ([]byte, error) {
    // key is always exactly 16 bytes — no length check needed
    import "crypto/aes"
    block, err := aes.NewCipher(key[:])
    if err != nil {
        return nil, err
    }
    // ... encrypt
    return nil, nil
}
```

### Pattern: Zero-Size Array for Non-Copyable Types

```go
// [0]sync.Mutex makes the struct effectively non-copyable
// because go vet warns about copying sync.Mutex
type NonCopyable struct {
    _    [0]sync.Mutex
    data int
}

// Attempting to copy this struct will trigger go vet warning:
// var a NonCopyable
// b := a  // vet: assignment copies lock value
```

### Pattern: Fixed-Size Ring Buffer

```go
type RingBuffer[T any] struct {
    data [16]T
    head int
    tail int
    size int
}

func (r *RingBuffer[T]) Push(v T) bool {
    if r.size == len(r.data) {
        return false
    }
    r.data[r.tail] = v
    r.tail = (r.tail + 1) % len(r.data)
    r.size++
    return true
}

func (r *RingBuffer[T]) Pop() (T, bool) {
    if r.size == 0 {
        var zero T
        return zero, false
    }
    v := r.data[r.head]
    r.head = (r.head + 1) % len(r.data)
    r.size--
    return v, true
}
```

---

## Benchmarking & Profiling

```go
package arrays_bench_test

import (
    "testing"
    "unsafe"
)

var sinkInt int

func BenchmarkByValue1000(b *testing.B) {
    arr := [1000]int{}
    for i := range arr { arr[i] = i }
    b.ResetTimer()
    b.ReportAllocs()
    for n := 0; n < b.N; n++ {
        sinkInt = sumValue(arr)
    }
}

func BenchmarkByPointer1000(b *testing.B) {
    arr := [1000]int{}
    for i := range arr { arr[i] = i }
    b.ResetTimer()
    b.ReportAllocs()
    for n := 0; n < b.N; n++ {
        sinkInt = sumPointer(&arr)
    }
}

func sumValue(arr [1000]int) int {
    sum := 0
    for _, v := range arr { sum += v }
    return sum
}

func sumPointer(arr *[1000]int) int {
    sum := 0
    for _, v := range arr { sum += v }
    return sum
}

func BenchmarkCacheLinePadding(b *testing.B) {
    b.Logf("Size of [8]int64: %d bytes", unsafe.Sizeof([8]int64{}))
    b.Logf("Size of cache line: 64 bytes")
}
```

Run: `go test -bench=. -benchmem -count=5 ./...`

---

## Trade-off Analysis

| Concern | Array | Slice | When Array Wins |
|---------|-------|-------|-----------------|
| Stack allocation | Yes (small arrays) | Backing array on heap | Hot paths, small fixed data |
| GC pressure | None (stack) | GC manages backing array | High-throughput systems |
| Type safety | Compile-time size | Runtime length check | Protocol headers, crypto |
| Map key usage | Yes (comparable) | No | Hash-keyed caches |
| Flexibility | Fixed | Dynamic | Never — use slice for flex |
| Copy cost | O(n) full copy | O(1) header copy | Small arrays only |
| False sharing | Possible | Possible | Equal risk — both need care |

---

## Integration with Unsafe Package

```go
package main

import (
    "fmt"
    "unsafe"
)

// Reinterpret [4]byte as uint32 without allocation (little-endian)
func bytesToUint32LE(b [4]byte) uint32 {
    return *(*uint32)(unsafe.Pointer(&b[0]))
}

// Cast IPv4 address to uint32 for comparison/sorting
func ipv4ToUint32(ip [4]byte) uint32 {
    return *(*uint32)(unsafe.Pointer(&ip))
}

func main() {
    ip := [4]byte{127, 0, 0, 1}
    n := ipv4ToUint32(ip)
    fmt.Printf("0x%08X\n", n) // platform-dependent (endianness)
}
```

**Warning:** `unsafe` bypasses Go's type system. Only use when profiling shows a real bottleneck and you understand platform-specific implications (endianness, alignment).

---

## Test

**1. What causes false sharing with arrays in concurrent code?**
- A) Two goroutines sharing the same array variable
- B) Multiple array elements on the same cache line, causing cross-CPU invalidation
- C) Arrays not being thread-safe
- D) Goroutine scheduling overhead

**Answer: B** — Cache lines are typically 64 bytes. Multiple elements in the same cache line means writes by one CPU invalidate the cached line for all other CPUs.

---

**2. When does `[100]int` escape to the heap?**
- A) Always, because arrays are large
- B) Never — arrays always stay on the stack
- C) When a pointer to the array outlives the function scope
- D) When the array is passed to another function by value

**Answer: C** — Escape analysis moves a variable to the heap only when a reference to it outlives the function.

---

**3. Why use `crypto/subtle.ConstantTimeCompare` instead of `==` for `[32]byte` comparison?**
- A) It is faster
- B) `==` does not compare all bytes
- C) `==` short-circuits and can leak timing information to attackers
- D) `==` does not work on arrays

**Answer: C** — `==` stops at the first differing byte. An attacker can use response time to learn how many bytes match.

---

**4. What is bounds check elimination (BCE)?**
- A) Removing the maximum size limit on arrays
- B) A compiler optimization that removes redundant runtime index validation
- C) A runtime safety feature that prevents panics
- D) A linting rule from `go vet`

**Answer: B** — BCE is a compiler optimization pass that removes bounds checks when the compiler can prove the index is always valid.

---

## Tricky Questions

**Q: You declare `var arr [1_000_000]int` in a function. Will it always stack-allocate?**
A: Not necessarily. Very large arrays may be heap-allocated by the compiler regardless. Additionally, if a pointer to the array escapes (e.g., passed to a goroutine), it will definitely heap-allocate. Use `make([]int, 1_000_000)` for large collections.

**Q: How does `[0]sync.Mutex` as a struct field prevent copying?**
A: `sync.Mutex` has a `noCopy` embedded type that triggers `go vet` warnings when copied. Embedding `[0]sync.Mutex` (zero size, no runtime cost) propagates this warning to the containing struct.

**Q: Why does the standard library use `[32]byte` for `sha256.Sum256` instead of `[]byte`?**
A: Three reasons: (1) eliminates heap allocation — the `[32]byte` is returned on the stack, (2) provides compile-time size guarantee — callers don't need to check length, (3) enables direct comparison with `==` and use as a map key.

---

## Summary

At the senior level, arrays are precision tools. They provide compile-time size guarantees enabling type-safe protocols, zero-allocation map keys, and lock-free counters. Critical performance concerns: stack vs heap allocation (escape analysis), false sharing (cache line padding), bounds check elimination, and constant-time comparison for security. The postmortems — stack overflow, false sharing, timing attacks, data races — represent real production categories of failures. Master these patterns to build systems that are simultaneously safer and faster.

---

## Further Reading

- [Go compiler escape analysis FAQ](https://go.dev/doc/faq#stack_or_heap)
- [False sharing (Wikipedia)](https://en.wikipedia.org/wiki/False_sharing)
- [crypto/subtle package](https://pkg.go.dev/crypto/subtle)
- [Go assembly guide](https://go.dev/doc/asm)
- [Bounds check elimination](https://go101.org/article/bounds-check-elimination.html)
- [Go memory model](https://go.dev/ref/mem)
