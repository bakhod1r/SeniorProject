# Go Pointers Basics — Professional / Internals Level

## 1. Overview

This document covers what pointers become at the binary level: layout, calling convention, escape analysis implementation, GC interaction (write barriers, stack maps), and the runtime mechanics of `unsafe.Pointer` and `uintptr` conversions.

---

## 2. Pointer Representation

A Go pointer is an 8-byte value (on 64-bit platforms) holding a memory address. The type system tracks the pointee type at compile time but the runtime value is just an address.

```
*int     ← 8 bytes, address of an int
*Point   ← 8 bytes, address of a Point
```

The compiler emits pointer-shape information for the GC: stack maps and heap object descriptors track which words are pointers.

---

## 3. Calling Convention for Pointer Args

Pointer arguments pass through a single integer register (AX, BX, CX, ... in the standard ABIInternal). For:

```go
func use(p *T) {}
```

```asm
CALL use(SB)  ; p in AX
```

Inside the body, `*p` lowers to a `MOVQ (AX), reg` for read or `MOVQ reg, (AX)` for write.

---

## 4. Escape Analysis Implementation

In `cmd/compile/internal/escape/`, the compiler:

1. Builds an escape graph: nodes are values, edges represent "value V might be reached by reference R".
2. Marks nodes as escaping if they reach package-level globals, function results, channels, or escaping closures.
3. Final decision per allocation: stack or heap.

The graph traversal handles:
- Direct pointer assignments.
- Slice/map/channel storage.
- Interface boxing (boxed values often escape).
- Closure captures.

---

## 5. Stack vs Heap Allocation Decision

For:
```go
func f() *int {
    n := 5
    return &n
}
```

Compiler decides:
1. `&n` is taken.
2. The pointer is returned (escapes).
3. Therefore `n` is moved to the heap.

For:
```go
func f() {
    n := 5
    p := &n
    use(*p)
}
```

The pointer doesn't escape; `n` stays on the stack.

---

## 6. GC Mechanics for Pointers

### 6.1 Write Barriers

When mutating pointers in heap objects, the GC needs to track the change to maintain correctness during concurrent collection. The compiler inserts **write barriers** automatically:

```go
heapObj.field = newPtr // compiler emits write barrier call
```

The write barrier is a small assembly stub (`runtime.gcWriteBarrier`) that records the change for the GC's mark phase.

### 6.2 Pointer Maps

For each heap object, the runtime maintains a **pointer map** (in the type's _type metadata) indicating which words contain pointers. The GC scans only those words.

For stack frames, similar maps exist. The compiler emits stack maps as part of `funcdata`.

### 6.3 Type-Precise GC

Go's GC is type-precise: it knows exactly which slots are pointers (vs ints, floats, etc.). This is what makes the conservative-GC pitfalls of C/C++ irrelevant.

---

## 7. unsafe.Pointer Mechanics

`unsafe.Pointer` is a special type that the compiler treats specially:
- Can be converted to/from any pointer type.
- Can be converted to/from `uintptr`.
- Is NOT subject to write barriers (use with care).

```go
import "unsafe"

x := int64(42)
p := &x
up := unsafe.Pointer(p)
ip := *(*int32)(up) // reinterpret as int32 (low 32 bits on little-endian)
```

The runtime treats `unsafe.Pointer` as a pointer for GC purposes; converting to `uintptr` is "anti-GC" — once a pointer is in `uintptr` form, the GC won't track it. If GC moves the object (during stack growth), the `uintptr` becomes stale.

---

## 8. Pointer Comparisons

Pointer equality is address equality. Implementation: a single CPU compare instruction.

```asm
CMPQ AX, BX  ; compare two pointer registers
```

Branch on equality.

---

## 9. Constructor Performance

For:
```go
func NewPoint(x, y int) *Point {
    return &Point{X: x, Y: y}
}
```

Each call:
- 1 heap allocation (~25 ns + GC tracking).
- Initialization of 2 fields (~2 cycles).

If callers don't need a heap allocation (e.g., they only use the value briefly), returning by value is cheaper:
```go
func MakePoint(x, y int) Point {
    return Point{X: x, Y: y}
}
```

---

## 10. Pointer-Heavy vs Value-Heavy Designs

Design A (pointer-heavy):
```go
type List struct {
    items []*Item
}
```

Design B (value-heavy):
```go
type List struct {
    items []Item
}
```

| Aspect | A (pointers) | B (values) |
|--------|--------------|------------|
| Memory | N pointers + N items | N items inline |
| GC roots | N (one per pointer) | 0 (within slice) |
| Cache locality | Worse (items scattered) | Better (items contiguous) |
| Mutation cost | Direct via pointer | Via index |
| Sharing across slices | Possible | Each slice has copy |

For high-throughput services with many items, Design B usually wins on GC and cache locality.

---

## 11. PGO and Pointers

PGO can:
- Inline more aggressively functions returning pointers.
- Devirtualize interface calls when one concrete pointer type dominates.

For pointer-heavy code, PGO can produce significant speedups.

---

## 12. Reading Generated Assembly

For pointer code:
```bash
go build -gcflags="-S" 2>asm.txt
```

Look for:
- `MOVQ (AX), reg` — pointer dereference for read.
- `MOVQ reg, (AX)` — pointer dereference for write.
- Write barrier calls (`runtime.gcWriteBarrier`) — insertions by compiler.
- `LEAQ` — address-of computation.

---

## 13. Stack Maps

Each function has stack maps describing which stack slots are pointers at each safepoint (function call, GC poll). Generated by the compiler; consumed by the runtime during GC and stack growth.

You can inspect via:
```bash
go tool objdump -s "main.f" myprog
```

The runtime walks these maps when a GC cycle starts or when a goroutine's stack grows.

---

## 14. `atomic.Pointer[T]` Implementation

```go
type Pointer[T any] struct {
    _ noCopy
    _ [0]*T
    v unsafe.Pointer
}

func (x *Pointer[T]) Load() *T {
    return (*T)(atomic.LoadPointer(&x.v))
}

func (x *Pointer[T]) Store(val *T) {
    atomic.StorePointer(&x.v, unsafe.Pointer(val))
}
```

Uses `atomic.LoadPointer` / `StorePointer` internally. The runtime emits write barriers automatically.

---

## 15. Self-Assessment Checklist

- [ ] I understand pointer representation (8 B address)
- [ ] I know how the compiler decides stack vs heap
- [ ] I understand GC write barriers
- [ ] I know stack maps and their purpose
- [ ] I can use `atomic.Pointer[T]` for lock-free swaps
- [ ] I understand `unsafe.Pointer` semantics
- [ ] I can read assembly for pointer operations
- [ ] I know when to prefer value-heavy vs pointer-heavy designs

---

## 16. References

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Escape analysis source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/escape/)
- [`runtime.gcWriteBarrier`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/mwbbuf.go)
- [`atomic.Pointer` docs](https://pkg.go.dev/sync/atomic#Pointer)
- [`unsafe.Pointer` rules](https://pkg.go.dev/unsafe#Pointer)
- 2.7.4 Memory Management
- 2.7.4.1 Garbage Collection
