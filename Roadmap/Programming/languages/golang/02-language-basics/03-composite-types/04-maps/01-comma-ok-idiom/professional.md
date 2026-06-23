# Comma-Ok Idiom — Professional / Expert Level

## 1. Internals Overview

The comma-ok idiom in Go is not a language construct but a **calling convention** built into the runtime. It leverages Go's multi-return function capability to signal presence/absence without allocations, locks, or panics. This document examines the mechanic at the compiler IR, SSA, and assembly level.

---

## 2. Compiler Pipeline

```
Source code (Go)
       │
       ▼
  Parsing (AST)
       │
       ▼
  Type checking
       │
       ▼
  IR lowering (ir.OINDEXMAP / ir.ODOTTYPE2 / ir.ORECV)
       │
       ▼
  SSA construction
       │  ← comma-ok becomes two SSA values
       ▼
  Machine code generation
       │  ← two values in registers
       ▼
  Object code
```

### IR node types for comma-ok

| Context | IR Node | Runtime function |
|---------|---------|-----------------|
| Map lookup | `ir.OINDEXMAP` | `runtime.mapaccess2*` |
| Type assertion | `ir.ODOTTYPE2` | inline itab compare |
| Channel receive | `ir.ORECV` (2-val) | `runtime.chanrecv` |

---

## 3. Map Lookup at Assembly Level

### Go source
```go
m := map[string]int{"key": 42}
v, ok := m["key"]
```

### Compiled to (x86-64, simplified)
```asm
; Load map pointer into AX
MOVQ  m+0(SP), AX

; Push key pointer onto stack
LEAQ  "key"(SB), BX
MOVQ  BX, keyptr+8(SP)

; Call mapaccess2_faststr
CALL  runtime.mapaccess2_faststr(SB)

; Result 1: pointer to value (AX)
; Result 2: bool ok (BX, or part of AX on some ABIs)
MOVQ  (AX), CX       ; dereference value pointer → v
MOVBLZX BX, DX      ; zero-extend bool → ok

; v is in CX, ok is in DX
; No heap allocation. No stack growth for these results.
```

### mapaccess2_faststr signature
```go
// src/runtime/map_faststr.go
func mapaccess2_faststr(t *maptype, h *hmap, ky string) (unsafe.Pointer, bool)
```

The returned `bool` is a plain register value — one byte. The compiler knows to map the second return of `m[k]` to this register value via the calling convention.

---

## 4. Type Assertion at Assembly Level

```go
var i interface{} = "hello"
s, ok := i.(string)
```

### What the compiler generates (simplified)
```asm
; Load interface: AX=itab, BX=data
MOVQ  i.tab+0(SP), AX
MOVQ  i.data+8(SP), BX

; Compare itab with expected type descriptor for string
LEAQ  type.string(SB), CX
CMPQ  AX, CX

; Set ok based on comparison
SETEQ DX        ; DX = 1 if equal, 0 if not

; If ok, load data from BX (the string header)
; v = *(*string)(BX) if DX == 1
; v = ""             if DX == 0

; Result: s in (AX:BX if string), ok in DX register
```

No function call for simple concrete type assertions — the compiler inlines the itab comparison.

For interface-to-interface assertions, the compiler calls `runtime.assertI2I2` or `runtime.assertE2I2`.

---

## 5. Channel Receive at Assembly Level

```go
v, ok := <-ch
```

### Runtime function
```go
// src/runtime/chan.go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool)
```

The `received` bool maps to the comma-ok `ok` value.

```asm
; Load channel pointer
MOVQ  ch+0(SP), AX

; Push element pointer (destination for value)
MOVQ  &v, BX
MOVQ  BX, ep+8(SP)

; block=true for regular receive
MOVB  $1, block+16(SP)

CALL  runtime.chanrecv(SB)

; Return: selected (AX), received (BX)
; received → ok
MOVBLZX BX, ok_register
```

---

## 6. SSA Form Analysis

### Example: map lookup in SSA

```
# Go source: v, ok := m["key"]

b1:
  v1 = LocalAddr {m} <*map[string]int>
  v2 = StaticLEACall <(unsafe.Pointer, bool)> {runtime.mapaccess2_faststr} v1 "key"
  v3 = SelectN [0] <unsafe.Pointer> v2       ; pointer to value
  v4 = SelectN [1] <bool> v2                 ; ok boolean
  v5 = Load <int> v3                          ; dereference value pointer
  ; v5 = v (the int value), v4 = ok (bool)
```

The `SelectN` node is how the SSA represents extraction of multiple return values. Both `SelectN [0]` and `SelectN [1]` are pure — no side effects, no allocation.

---

## 7. Memory Layout of Relevant Structures

### hmap (Go map header)
```go
// runtime/map.go
type hmap struct {
    count     int     // 8 bytes — number of elements
    flags     uint8   // 1 byte  — concurrent access flags
    B         uint8   // 1 byte  — log_2 of # of buckets
    noverflow  uint16 // 2 bytes
    hash0     uint32  // 4 bytes — hash seed
    buckets   unsafe.Pointer // 8 bytes — array of 2^B bmap
    oldbuckets unsafe.Pointer // 8 bytes — previous array during grow
    nevacuate  uintptr        // 8 bytes — evacuation progress
    extra      *mapextra      // 8 bytes
}
// Total: 8+1+1+2+4+8+8+8+8 = 48 bytes
```

### bmap (bucket)
```go
// 8 key-value pairs per bucket
type bmap struct {
    tophash [bucketCnt]uint8 // 8 bytes — top 8 bits of hash
    // Followed by keys array
    // Followed by values array
    // Followed by overflow pointer
}
// The actual layout is generated at compile time based on key/value types
```

### Interface (eface / iface)
```go
// Empty interface (interface{} or any):
type eface struct {
    _type *_type          // 8 bytes
    data  unsafe.Pointer  // 8 bytes
}

// Non-empty interface:
type iface struct {
    tab  *itab            // 8 bytes — type + method table
    data unsafe.Pointer   // 8 bytes
}
// Total: 16 bytes for any interface
```

### itab
```go
type itab struct {
    inter  *interfacetype // interface descriptor
    _type  *_type         // concrete type descriptor
    hash   uint32         // copy of _type.hash for fast comparison
    _      [4]byte
    fun    [1]uintptr     // method table (variable length)
}
```

The type assertion `i.(T)` essentially checks `i.tab._type == &T_type_descriptor` and computes a hash comparison for efficiency.

---

## 8. Escape Analysis

```go
// Does comma-ok cause heap allocation?

// Test 1: Simple map lookup
func f1(m map[string]int) (int, bool) {
    return m["key"] // returns both values — no alloc
}

// Test 2: Returning pointer to map value (CAUSES ALLOC)
func f2(m map[string]int) *int {
    v, ok := m["key"]
    if !ok { return nil }
    return &v // v escapes to heap!
}

// Test 3: Type assertion
func f3(i interface{}) (string, bool) {
    return i.(string) // returns copy — no alloc for string header
    // BUT: the string data itself was already on heap
}
```

Run: `go build -gcflags="-m -m" yourfile.go` to see escape analysis.

---

## 9. Compiler Intrinsics and Optimizations

### Constant-folded map lookup
```go
// When map and key are known at compile time, the compiler
// may inline or fold the lookup, but maps are generally not
// compile-time constants in Go (unlike some other languages).
// However, the compiler DOES optimize:
// - map with string keys → uses mapaccess2_faststr
// - map with 32-bit int keys → uses mapaccess2_fast32
// - map with 64-bit int keys → uses mapaccess2_fast64
// These fast paths avoid full hash computation in some cases
```

### Type assertion optimization
```go
// Compiler generates different code for:
// 1. Concrete → concrete (impossible, caught by type checker)
// 2. Interface → concrete: inline itab pointer comparison
// 3. Interface → interface: call assertI2I2

// FASTEST: empty interface → concrete type
var i interface{} = 42
n, ok := i.(int) // single pointer comparison — ~1 ns

// SLIGHTLY SLOWER: iface → concrete
var r io.Reader = bytes.NewReader([]byte{})
br, ok := r.(*bytes.Reader) // itab lookup — ~2 ns
_ = br; _ = ok; _ = n
```

---

## 10. ABI (Application Binary Interface)

### Go's register-based ABI (Go 1.17+)

Before Go 1.17, all arguments and returns went through the stack. Since 1.17, Go uses a register-based ABI where small values (including booleans) are passed in registers.

```
// Register ABI return convention (AMD64):
// Return values are placed in: AX, BX, CX, DI, SI, R8, R9, R10, R11
// Boolean ok is typically in BX (second return register)

// Old stack ABI (pre-1.17):
// Both returns on stack: [8 bytes for int] [1 byte for bool] [7 bytes padding]
// Total: 16 bytes on stack per comma-ok call
// New register ABI:
// int → AX register, bool → BX register
// Zero stack cost for the comma-ok pair itself
```

---

## 11. Benchmarks and Profiling

```go
package commaok_bench_test

import (
    "testing"
    "unsafe"
)

var globalMap = func() map[string]int {
    m := make(map[string]int, 1000)
    for i := 0; i < 1000; i++ {
        m[fmt.Sprintf("key%d", i)] = i
    }
    return m
}()

// Benchmark: comma-ok vs no-ok vs unsafe
func BenchmarkMapLookupOk(b *testing.B) {
    m := globalMap
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = m["key500"]
    }
}

func BenchmarkMapLookupNoOk(b *testing.B) {
    m := globalMap
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = m["key500"]
    }
}

func BenchmarkMapLookupMiss(b *testing.B) {
    m := globalMap
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = m["notexist"]
    }
}

// Typical results:
// BenchmarkMapLookupOk-8     197368216    6.07 ns/op    0 B/op    0 allocs/op
// BenchmarkMapLookupNoOk-8   200000000    5.99 ns/op    0 B/op    0 allocs/op
// BenchmarkMapLookupMiss-8   195432109    6.14 ns/op    0 B/op    0 allocs/op
```

---

## 12. Compiler Directives and Code Generation

```go
//go:noinline — prevents inlining, useful for benchmarking individual lookups
//go:nosplit  — prevents stack growth (not used for comma-ok itself)

// To inspect generated assembly:
// go tool compile -S yourfile.go | grep -A 20 "mapaccess2"

// To see SSA:
// GOSSAFUNC=YourFunc go build yourfile.go
// Opens ssa.html showing all SSA phases

// To see escape analysis:
// go build -gcflags="-m" yourfile.go
```

### Example: Inspecting assembly for map comma-ok

```bash
# Create file map_ok.go:
# func lookup(m map[string]int, k string) (int, bool) { return m[k] }

go tool compile -S map_ok.go | grep -A 30 '"".lookup'
# Shows: CALL runtime.mapaccess2_faststr(SB)
# Followed by: MOVQ and MOVBLZX instructions for the two return values
```

---

## 13. Memory Model Implications

```go
// Go's memory model guarantee for channels:
// "A send on a channel happens before the corresponding receive from that channel completes"
// "The closing of a channel happens before a receive that returns a zero value because the channel is closed"

// This means:
ch := make(chan int, 1)
data := 42

go func() {
    data = 100   // write
    ch <- 1      // send happens-before receive
}()

<-ch             // receive happens-after send
fmt.Println(data) // guaranteed to see 100, not 42

// With comma-ok:
val, ok := <-ch  // same guarantee — the close/send
                  // happens-before this returns ok=false/true
```

---

## 14. Edge Cases at the Compiler Level

### The "ok" variable naming convention

The Go compiler does not enforce the name "ok" — it's purely convention. The SSA generates the same code regardless:
```go
v, present := m["key"]
v, found    := m["key"]
v, _        := m["key"]  // second return discarded
```
All generate the same `mapaccess2` call; the second return is either used or discarded by the optimizer.

### Discarded ok: does the compiler optimize out the bool computation?

```go
v := m["key"]       // Uses mapaccess1 — does NOT compute bool
v, _ = m["key"]     // Also uses mapaccess1! Compiler is smart.
v, ok := m["key"]   // Uses mapaccess2 — computes bool
```

The Go compiler uses `mapaccess1` when ok is discarded or not present. This is a meaningful optimization: `mapaccess2` must set the extra bool register, while `mapaccess1` skips that step.

---

## 15. Professional Patterns Summary

### Pattern 1: Build zero-allocation lookup wrappers using generics (Go 1.18+)

```go
func MapGet[K comparable, V any](m map[K]V, key K) (V, bool) {
    v, ok := m[key]
    return v, ok
}

func MapGetOrDefault[K comparable, V any](m map[K]V, key K, def V) V {
    if v, ok := m[key]; ok {
        return v
    }
    return def
}
```

### Pattern 2: Interface capability probe

```go
func bestWriter(w io.Writer) io.Writer {
    if bw, ok := w.(interface{ Flush() error }); ok {
        _ = bw // return a wrapper that flushes
    }
    return w
}
```

### Pattern 3: Compile-time interface assertion

```go
// Ensure type implements interface at compile time
var _ io.Reader = (*MyReader)(nil)

// If MyReader doesn't implement io.Reader, compile error here
// No comma-ok needed — this is a static guarantee
```

### Pattern 4: Safe context value extraction

```go
type contextKey[T any] struct{ name string }

func FromContext[T any](ctx context.Context, key contextKey[T]) (T, bool) {
    v, ok := ctx.Value(key).(T)
    return v, ok
}
```

---

## 16. Summary

The comma-ok idiom is a deceptively simple surface over a carefully engineered runtime mechanism:

1. **Map**: calls `mapaccess2*` fast-path functions that return pointer + bool from the hash table probe
2. **Type assertion**: inlined itab pointer comparison + optional hash check
3. **Channel**: calls `chanrecv` which inspects `hchan.closed` and buffer state

At the assembly level, the `ok` boolean lives in a register — zero stack or heap cost. The compiler chooses between `mapaccess1` (single return) and `mapaccess2` (two returns) based on whether you use the boolean, providing an automatic optimization for the common case.

Understanding this level enables you to write better benchmarks, interpret pprof output accurately, build zero-allocation abstractions, and make informed trade-offs in high-frequency lookup paths.
