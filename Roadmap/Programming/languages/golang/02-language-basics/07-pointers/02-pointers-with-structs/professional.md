# Go Pointers with Structs — Professional / Internals Level

## 1. Overview

This document covers the binary mechanics of pointer-to-struct: memory layout, field-offset addressing, method dispatch through pointers, escape analysis for `&T{}` constructors, write barriers, and the GC's treatment of pointer fields within structs.

---

## 2. Struct Memory Layout

A struct's layout is determined at compile time:
- Fields in declaration order.
- Each field aligned to its type's alignment requirement.
- Total size rounded up to the strictest alignment.

```go
type T struct {
    A int8     // offset 0, size 1
    // padding [7]byte
    B int64    // offset 8, size 8
    C int32    // offset 16, size 4
    // padding [4]byte
}
// total size: 24 bytes
```

`unsafe.Sizeof`, `unsafe.Alignof`, `unsafe.Offsetof` reveal these.

---

## 3. Field Access Through Pointer

For `p *T` and field `T.B` at offset 8:

```asm
MOVQ 8(AX), reg   ; load p.B (AX = p)
```

Single load instruction, ~1-2 cycles plus cache latency.

For `p.B = v`:
```asm
MOVQ reg, 8(AX)
```

---

## 4. Constructor `&T{...}` Compilation

```go
func New() *T {
    return &T{X: 1, Y: 2}
}
```

Lowered roughly to:
```go
func New() *T {
    p := runtime.newobject(typeT)
    p.X = 1
    p.Y = 2
    return p
}
```

`runtime.newobject` allocates from the heap. The compiler may choose different paths for size classes:
- Tiny (< 16 B): tiny allocator (per-P).
- Small (≤ 32 KB): size-classed allocator.
- Large (> 32 KB): direct page allocation.

---

## 5. Escape Analysis for Constructors

```go
func mayEscape() *T {
    return &T{} // escapes — heap
}

func doesNot() {
    p := &T{} // doesn't escape if we never let p escape — stack
    use(*p)
}
```

The compiler tracks each pointer's flow; if it reaches a sink (return, global, escaping closure, channel-as-interface), the allocation is heap.

---

## 6. Method Dispatch

### 6.1 Direct Call
```go
p := &T{}
p.Method()  // compiled to: T_Method(p)
```

Fast direct call; inlinable if Method is small.

### 6.2 Through Interface
```go
var i I = p
i.Method()  // itab lookup + indirect call
```

Indirect call (~3-5 cycles). PGO may devirtualize.

---

## 7. Write Barriers for Pointer Fields

When you mutate a pointer field in a heap struct:
```go
p.Field = newPtr
```

The compiler emits a write barrier:
```asm
; check GC state, record the change for marking
CALL runtime.gcWriteBarrier
```

Required for concurrent GC correctness. Cost: ~2 cycles when GC is inactive, more during marking phase.

For value-typed fields (no pointers within), no write barrier needed.

---

## 8. GC Roots in Pointer Fields

Each `*T` field within a heap struct is a GC root. The GC follows it during marking.

For a struct with N pointer fields, GC scans N pointers per object instance. Reducing pointer density reduces GC scan work.

---

## 9. Embedded Pointer Methods

```go
type Base struct{}
func (b *Base) M() {}

type Sub struct{ *Base }
```

`s.M()` resolves at compile time:
1. Compiler sees `s.M` and tries to find `M` on `Sub`.
2. Not found; checks embedded fields.
3. Finds `*Base.M`; promotion succeeds.
4. Compiles to `s.Base.M()` (which is `Base.M(s.Base)`).

No runtime overhead for promotion.

---

## 10. Self-Referential Structs

```go
type Node struct {
    V    int
    Next *Node // pointer; required for self-reference
}
```

`*Node` is 8 B; without it, the struct would have infinite size.

The compiler synthesizes the layout: `[V (8 B) | Next (8 B)] = 16 B`.

---

## 11. Tagged Pointers (Not in Standard Go)

Some languages use tagged pointers (low bits = type discriminator). Go does NOT do this; pointers are raw addresses.

For type discrimination, use interfaces (which carry an itab pointer).

---

## 12. Microbenchmark

```go
package main

import "testing"

type Small struct{ X, Y int }
type Big struct{ Data [256]int }

func newSmall() *Small { return &Small{} }
func newBig() *Big     { return &Big{} }

func BenchmarkSmall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = newSmall()
    }
}

func BenchmarkBig(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = newBig()
    }
}
```

Typical:
- newSmall: ~10 ns/op, 16 B/op
- newBig: ~150 ns/op, 2 KB/op

For huge structs, allocation dominates. Use `sync.Pool`.

---

## 13. PGO and Pointer-Heavy Code

PGO can:
- Inline hot constructors.
- Devirtualize interface calls when concrete pointer type dominates.

Profile + rebuild:
```bash
go build -pgo=cpu.prof .
```

---

## 14. Reading Generated Code

```bash
go build -gcflags="-S" 2>asm.txt
go build -gcflags="-m=2" 2>&1 | grep "moved to heap"
```

Look for:
- `MOVQ offset(AX)` patterns for field access.
- `runtime.newobject` calls for `&T{}`.
- `runtime.gcWriteBarrier` for pointer field mutations.

---

## 15. Self-Assessment Checklist

- [ ] I understand struct layout and field offsets
- [ ] I can read assembly for field access through pointer
- [ ] I know how `&T{}` lowers to `runtime.newobject`
- [ ] I understand write barriers for pointer fields
- [ ] I know the GC scans pointer fields as roots
- [ ] I can use sync.Pool to reduce constructor allocation pressure

---

## 16. References

- [Struct types](https://go.dev/ref/spec#Struct_types)
- [`unsafe` package](https://pkg.go.dev/unsafe)
- [`runtime.newobject`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/malloc.go)
- [Write barriers](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/mwbbuf.go)
- 2.7.1 Pointers Basics
- 2.7.4 Memory Management
