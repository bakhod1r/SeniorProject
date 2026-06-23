# Arrays — Interview Questions

## Overview

This file covers interview questions about Go arrays at Junior, Middle, Senior, and Scenario-Based levels, plus a FAQ section. Arrays appear in Go interviews surprisingly often because they reveal understanding of Go's type system, value semantics, and the relationship between arrays and slices.

---

## Junior Level Questions

**Q1: What is the zero value of `var a [4]string`?**

A: `["" "" "" ""]` — an array of 4 empty strings. Go automatically initializes every element of an array to the zero value of its element type. For `string`, the zero value is `""` (empty string). For `int`, it would be `0`. For `bool`, it would be `false`. For pointer types, it would be `nil`.

---

**Q2: What is the difference between `[3]int` and `[]int`?**

A: `[3]int` is an **array** — fixed size of exactly 3 integers, size is part of the type at compile time. `[]int` is a **slice** — a dynamic view into an underlying array, with length and capacity tracked at runtime. Arrays are value types (copied on assignment); slices are reference types (header is copied, underlying array is shared). You cannot append to an array; you can append to a slice.

---

**Q3: What happens when you run this code?**
```go
arr := [3]int{1, 2, 3}
b := arr
b[0] = 99
fmt.Println(arr[0], b[0])
```

A: Prints `1 99`. Arrays are value types in Go. `b := arr` creates a complete independent copy of the array. Modifying `b[0]` has no effect on `arr`. This is different from slices, where assignment would share the underlying array.

---

**Q4: Can you append to an array in Go?**

A: No. `append` is a built-in function that works only on slices. Arrays have a fixed size that cannot change after declaration. If you need to add elements, you must either: (1) convert the array to a slice with `arr[:]` and then append to the slice, or (2) use a slice from the beginning. The slice will get a new backing array when capacity is exceeded.

---

**Q5: What does `[...]int{1, 2, 3}` mean?**

A: The `[...]` syntax tells the compiler to count the number of elements in the literal and use that as the fixed size. So `[...]int{1, 2, 3}` is equivalent to `[3]int{1, 2, 3}`. The type is `[3]int` — a fixed-size array of 3 integers. After declaration, the size is permanent. This syntax is convenient because it prevents size mismatches and counts automatically.

---

**Q6: How do you iterate over an array in Go?**

A:
```go
arr := [5]int{10, 20, 30, 40, 50}

// Method 1: range (preferred — index and value)
for i, v := range arr {
    fmt.Printf("arr[%d] = %d\n", i, v)
}

// Method 2: range, index only
for i := range arr {
    fmt.Println(arr[i])
}

// Method 3: traditional index loop
for i := 0; i < len(arr); i++ {
    fmt.Println(arr[i])
}
```
The `range` form is preferred as it prevents off-by-one errors.

---

**Q7: Are two arrays with the same elements always equal with `==`?**

A: Only if they have the **same type** (same size and same element type). `[3]int{1,2,3} == [3]int{1,2,3}` is `true`. But you cannot even compare `[3]int` with `[4]int` — it is a compile error because they are different types. Also, arrays of non-comparable types (like `[3][]int`) cannot be compared at all.

---

## Middle Level Questions

**Q1: Why does `crypto/sha256.Sum256` return `[32]byte` instead of `[]byte`?**

A: Several reasons:
1. **Compile-time guarantee**: The type `[32]byte` guarantees at the type level that the result is always exactly 32 bytes. Callers don't need to check `len(result) == 32`.
2. **Comparability**: `[32]byte` can be used as a map key and compared with `==`. This enables patterns like `map[[32]byte]SomeValue` for hash-based caches.
3. **Zero allocation**: The `[32]byte` is returned by value and lives on the caller's stack — no heap allocation, no GC pressure.
4. **Convention**: Fixed-size algorithms should have fixed-size types in their API.

---

**Q2: How do arrays behave as struct fields vs pointer fields?**

A:
```go
type WithArray struct {
    data [1000]int // 8000 bytes embedded in struct
}

type WithPointer struct {
    data *[1000]int // 8 bytes (pointer), array elsewhere
}

a := WithArray{} // struct itself is 8000 bytes
p := WithPointer{data: new([1000]int)} // struct is 8 bytes + separate 8000 bytes on heap
```

`WithArray` has the array inline — better cache locality, no pointer indirection, but expensive to copy. `WithPointer` has indirection — cheaper to copy the struct, but pointer dereference on each access and GC pressure.

---

**Q3: What is false sharing and how do arrays cause it?**

A: False sharing occurs when multiple goroutines write to different memory locations that happen to share the same CPU cache line (typically 64 bytes). For `[8]int64` (64 bytes), if 8 goroutines each write to `arr[i]` for their respective `i`, they all write to the same cache line. Every write by one goroutine forces all other CPUs to invalidate their cached copy of that line, causing massive performance degradation even though no two goroutines touch the same element.

Fix: pad each element to a full cache line:
```go
type padded struct {
    val int64
    _   [56]byte // pad to 64 bytes
}
var counters [8]padded
```

---

**Q4: When does a local array escape to the heap?**

A: A local array escapes to the heap when:
1. A pointer to the array (or any element) is stored where it can outlive the function: returned from the function, stored in a heap-allocated struct, or captured by a goroutine.
2. The array is passed to an interface method (the interface box may escape).
3. The array is very large and the compiler decides it would blow the stack.

You can check: `go build -gcflags="-m" ./...` will print escape analysis decisions.

---

**Q5: Why can arrays be used as map keys but slices cannot?**

A: Map keys in Go must be **comparable** — the `==` operator must be defined for the type. Arrays are comparable (element-by-element comparison). Slices are not comparable (only comparable to `nil`). This is a fundamental design decision: slices are reference types pointing to shared mutable memory, so equality is ambiguous (do you compare by reference or by value?). Arrays have value semantics, so equality is unambiguous.

---

**Q6: What is bounds check elimination and how can you trigger it?**

A: BCE is a compiler optimization that removes runtime bounds checks when the compiler can prove at compile time that an index is always valid.

Triggers:
- Constant indices: `arr[3]` for `[5]int` → check eliminated at compile time
- Loop with range: `for i, v := range arr` → compiler knows `i < len(arr)`
- Explicit length check before access

Verify: `go build -gcflags="-d=ssa/check_bce/debug=1" ./...`

---

## Senior Level Questions

**Q1: Explain the memory layout difference between `[N]T` (value), `*[N]T` (pointer), and `[]T` (slice).**

A:
- `[N]T`: Exactly `N * sizeof(T)` bytes. No header, no pointer. Lives on the stack if it doesn't escape. Copying copies all `N * sizeof(T)` bytes.
- `*[N]T`: Exactly 8 bytes (pointer size). Points to `N * sizeof(T)` bytes elsewhere (usually heap). Copying the pointer is 8 bytes; the pointed-to data is shared.
- `[]T`: 24 bytes (3 words: pointer + len + cap). The pointer points to a backing array. Copying the slice header is 24 bytes; the backing array is shared.

Key insight: `*[N]T` and `[]T` both involve pointer indirection. `[N]T` is value, no indirection. Choice depends on whether you need sharing or value semantics.

---

**Q2: How would you implement a timing-safe comparison for two `[32]byte` values, and why is `==` insufficient?**

A: Use `crypto/subtle.ConstantTimeCompare`:
```go
import "crypto/subtle"

func secureEqual(a, b [32]byte) bool {
    return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
```

Why `==` is insufficient: The `==` operator for arrays performs a sequential comparison and stops at the first mismatching byte. An attacker who can measure the time taken by `verify(token, stored)` can learn how many leading bytes match the expected value. By submitting tokens that share increasingly many prefix bytes with the target, the attacker can reconstruct the secret one byte at a time (a timing oracle attack). `ConstantTimeCompare` always examines all bytes regardless of where the mismatch occurs.

---

**Q3: Design a zero-allocation, concurrent, fixed-size cache using arrays.**

A:
```go
type Cache struct {
    mu      sync.RWMutex
    entries map[[32]byte]CacheEntry
}

type CacheEntry struct {
    Value     []byte
    ExpiresAt time.Time
}

func (c *Cache) Get(key []byte) ([]byte, bool) {
    hash := sha256.Sum256(key)  // [32]byte on stack — no allocation
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.entries[hash]   // lookup by array value — no allocation
    if !ok || time.Now().After(e.ExpiresAt) {
        return nil, false
    }
    return e.Value, true
}
```

The critical property: using `[32]byte` as the map key means the `sha256.Sum256` result (stack-allocated) can be used directly as a map key without allocating a string or slice. A `map[string]...` approach would require `string(keyBytes)` which allocates.

---

**Q4: How does the Go runtime handle bounds checks differently on different CPU architectures?**

A: On AMD64, a bounds check for `arr[i]` compiles to:
```asm
CMPQ  CX, $N         // compare index against length (constant)
JAE   runtime.panicIndex  // jump if above or equal (unsigned)
```

The use of unsigned comparison (`JAE` = Jump if Above or Equal) means negative indices also fail: `uint(-1) = 18446744073709551615` which is always `>= N`, so one branch handles both negative and too-large indices.

On ARM64: uses `CMP` + `BCS` (Branch if Carry Set, unsigned).

The compiler eliminates this check when it can prove safety through flow analysis, value ranges, or constant evaluation.

---

**Q5: What happens at the assembly level when you copy a `[1000]int`?**

A: For a 8000-byte copy, the compiler emits a call to `runtime.memmove(dst, src, 8000)`. The `memmove_amd64.s` implementation uses:
- `MOVUPS` (16-byte SSE moves) for alignment handling
- `VMOVDQU` (32-byte AVX moves) when AVX is available
- `REP MOVSQ` for bulk copies (8 bytes per instruction, repeated)

For small fixed-size arrays (typically ≤32 bytes), the compiler unrolls to direct `MOVQ` instructions without a function call. The threshold varies by Go version and platform.

---

## Scenario-Based Questions

**Scenario 1: You are reviewing a PR where a developer added `var buf [10000000]byte` inside an HTTP handler. What problems do you identify and how would you fix them?**

A:
Problems:
1. **Stack overflow risk**: 10MB on the goroutine stack. Go stacks start at 8KB and grow dynamically, but declaring a 10MB array at function entry may exceed goroutine stack limits.
2. **Memory waste**: Every active request holds 10MB, even if only 100 bytes are used.
3. **No reuse**: A new 10MB buffer is allocated for every request.

Fixes:
```go
// Option 1: Use a slice (heap-allocated, GC-managed)
buf := make([]byte, 10000000)

// Option 2: Use sync.Pool for reuse (best for high-throughput servers)
var bufPool = sync.Pool{
    New: func() interface{} {
        b := make([]byte, 10000000)
        return &b
    },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*[]byte)
    defer bufPool.Put(buf)
    // use (*buf)[:n]
}
```

---

**Scenario 2: A team is building a network protocol parser. The protocol has a fixed 20-byte header followed by a variable payload. How would you model this using Go arrays and slices?**

A:
```go
type Header [20]byte  // fixed-size, compile-time guarantee

func (h Header) MessageType() uint8  { return h[0] }
func (h Header) PayloadLength() uint16 {
    return binary.BigEndian.Uint16(h[2:4])
}
func (h Header) SequenceNum() uint32 {
    return binary.BigEndian.Uint32(h[4:8])
}

type Packet struct {
    Header  Header  // embedded by value — 20 bytes inline
    Payload []byte  // variable length
}

func ParsePacket(data []byte) (Packet, error) {
    if len(data) < 20 {
        return Packet{}, fmt.Errorf("too short: %d bytes", len(data))
    }
    var p Packet
    copy(p.Header[:], data[:20])  // copy into fixed array
    payloadLen := p.Header.PayloadLength()
    if len(data) < 20+int(payloadLen) {
        return Packet{}, fmt.Errorf("incomplete payload")
    }
    p.Payload = data[20 : 20+int(payloadLen)]
    return p, nil
}
```

Using `[20]byte` for the header: guarantees correct size at compile time, enables struct embedding, makes the struct comparable, and provides zero-allocation parsing when `data` is already available.

---

**Scenario 3: You are profiling a parallel computation and find that throughput does not scale beyond 4 cores, even though the machine has 16 cores and CPU usage is maxed. Suspect false sharing. How do you diagnose and fix it?**

A:
Diagnosis:
```bash
# Linux perf tool
perf stat -e cache-misses,cache-references ./myprogram

# Go race detector (won't catch false sharing but validates correctness)
go test -race ./...

# Benchmark with different core counts
for cores in 1 2 4 8 16; do
    GOMAXPROCS=$cores go test -bench=BenchmarkParallel -count=3
done
# If throughput plateaus or regresses, suspect false sharing
```

Fix:
```go
// Before: false sharing
type Stats struct {
    counters [16]int64  // 128 bytes — 2 cache lines, adjacent elements share
}

// After: cache-line-padded
const cacheLineSize = 64
type paddedCounter struct {
    value int64
    _     [cacheLineSize - 8]byte
}
type Stats struct {
    counters [16]paddedCounter // each on its own cache line
}
```

Validation: re-run benchmark; throughput should now scale linearly with core count.

---

## FAQ

**Q: Should I use arrays or slices for most Go code?**
A: Slices. Arrays are a specialized tool for when the fixed size is a semantic constraint (cryptographic hashes, protocol headers, fixed-size identifiers). For general collections, lists, and any dynamic data, always use slices.

**Q: Can arrays be nil in Go?**
A: No. Arrays are value types and cannot be nil. `var a [5]int` gives you a valid, zero-initialized array. Only pointer types, slices, maps, functions, channels, and interfaces can be nil.

**Q: Why does ranging over a copied array in a function not modify the original?**
A: Because function arguments in Go are passed by value. The array is copied on the function call. The range loop then iterates over the copy. To modify the original, pass a pointer to the array: `func f(arr *[5]int)`.

**Q: Is `[0]T` a useful type?**
A: Yes, in niche scenarios: as a struct field to mark a struct as non-copyable (by embedding `[0]sync.Mutex`), as a channel element type (`chan [0]struct{}`), or as a placeholder in type system tricks. Zero-size types are free at runtime.

**Q: What is the maximum size of an array in Go?**
A: There is no hard language limit. Practical limits come from available memory and, for stack-allocated arrays, the goroutine stack size. Very large arrays should always be heap-allocated (use a slice or `new`). The compiler may reject programs where the constant size computation overflows `int`.
