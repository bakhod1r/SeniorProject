# sync/atomic — Specification

## Table of Contents
1. [Scope](#scope)
2. [Package Documentation Contract](#package-documentation-contract)
3. [Type Specifications](#type-specifications)
4. [Free Function Specifications](#free-function-specifications)
5. [Memory Model Guarantees](#memory-model-guarantees)
6. [Alignment Requirements](#alignment-requirements)
7. [Versioning](#versioning)
8. [References](#references)

---

## Scope

This document collects the formal contract of `sync/atomic` as it appears in the Go standard library and language specification. Where the package documentation is informal, this file restates the rule in precise language and cites the authoritative source.

The audience is the engineer who must answer "is this code correct?" or "is this behaviour guaranteed across Go versions?" with a citation. For pedagogical material, see `junior.md` through `professional.md` in this subsection.

---

## Package Documentation Contract

From `sync/atomic/doc.go` (Go 1.22):

> Package atomic provides low-level atomic memory primitives useful for implementing synchronization algorithms.
>
> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package. Share memory by communicating; don't communicate by sharing memory.
>
> The swap operation, implemented by the SwapT functions, is the atomic equivalent of:
>
>     old = *addr
>     *addr = new
>     return old
>
> The compare-and-swap operation, implemented by the CompareAndSwapT functions, is the atomic equivalent of:
>
>     if *addr == old {
>         *addr = new
>         return true
>     }
>     return false
>
> The add operation, implemented by the AddT functions, is the atomic equivalent of:
>
>     *addr += delta
>     return *addr
>
> The load and store operations, implemented by the LoadT and StoreT functions, are the atomic equivalents of "return *addr" and "*addr = val".
>
> In the terminology of the Go memory model, if the effect of an atomic operation A is observed by atomic operation B, then A is "synchronized before" B. Additionally, all the atomic operations executed in a program behave as though executed in some sequentially consistent order.

The package-level guarantees:

1. Each named operation (`Load`, `Store`, `Add`, `Swap`, `CompareAndSwap`) is **atomic**: no goroutine can observe a partial result.
2. Atomic operations participate in the Go memory model's synchronised-before relation.
3. All atomic operations in a program have a single total order observed by all goroutines (sequential consistency).

---

## Type Specifications

### `atomic.Bool` (Go 1.19+)

```go
type Bool struct {
    _ noCopy
    v uint32
}

func (x *Bool) Load() bool
func (x *Bool) Store(val bool)
func (x *Bool) Swap(new bool) (old bool)
func (x *Bool) CompareAndSwap(old, new bool) (swapped bool)
```

Underlying storage: `uint32` with 0 meaning false, 1 meaning true. The zero value is false. The type contains a `noCopy` marker; copying triggers `go vet` warnings.

### `atomic.Int32`, `atomic.Int64`

```go
type Int32 struct {
    _ noCopy
    v int32
}

type Int64 struct {
    _ noCopy
    _ align64    // forces 8-byte alignment on 32-bit platforms
    v int64
}

// Operations available on both:
func (x *IntT) Load() T
func (x *IntT) Store(val T)
func (x *IntT) Swap(new T) (old T)
func (x *IntT) CompareAndSwap(old, new T) (swapped bool)
func (x *IntT) Add(delta T) (new T)

// Go 1.23+:
func (x *IntT) And(mask T) (old T)
func (x *IntT) Or(mask T) (old T)
```

`Add` returns the new value (after the addition). `Swap` returns the previous value. `CompareAndSwap` returns whether the swap occurred. `And` and `Or` (Go 1.23+) return the previous value.

### `atomic.Uint32`, `atomic.Uint64`

Same operations as the signed types, with `T = uint32` or `uint64`.

### `atomic.Uintptr`

```go
type Uintptr struct {
    _ noCopy
    v uintptr
}
```

Operations: `Load`, `Store`, `Swap`, `CompareAndSwap`, `Add`. No `And`/`Or` as of Go 1.23. Used for low-level integer pointer arithmetic.

### `atomic.Pointer[T]` (Go 1.19+)

```go
type Pointer[T any] struct {
    _ noCopy
    v unsafe.Pointer
}

func (x *Pointer[T]) Load() *T
func (x *Pointer[T]) Store(val *T)
func (x *Pointer[T]) Swap(new *T) (old *T)
func (x *Pointer[T]) CompareAndSwap(old, new *T) (swapped bool)
```

Generic over the pointed-to type. The zero value is `nil`.

### `atomic.Value`

```go
type Value struct {
    v any
}

func (v *Value) Load() (val any)
func (v *Value) Store(val any)
func (v *Value) Swap(new any) (old any)                 // Go 1.17+
func (v *Value) CompareAndSwap(old, new any) (swapped bool) // Go 1.17+
```

Constraint: once a non-nil `Store` succeeds, all subsequent `Store` calls must use the same concrete type. Mismatch panics with `"sync/atomic: store of inconsistently typed value into Value"`.

`Store(nil)` panics with `"sync/atomic: store of nil value into Value"`.

`Load` before any `Store` returns `nil` and `ok` is implicit (untyped nil interface).

---

## Free Function Specifications

The legacy API. All functions take a pointer to the target variable.

### Integer atomics

```go
func AddInt32(addr *int32, delta int32) (new int32)
func AddInt64(addr *int64, delta int64) (new int64)
func AddUint32(addr *uint32, delta uint32) (new uint32)
func AddUint64(addr *uint64, delta uint64) (new uint64)
func AddUintptr(addr *uintptr, delta uintptr) (new uintptr)

func LoadInt32(addr *int32) (val int32)
func LoadInt64(addr *int64) (val int64)
func LoadUint32(addr *uint32) (val uint32)
func LoadUint64(addr *uint64) (val uint64)
func LoadUintptr(addr *uintptr) (val uintptr)

func StoreInt32(addr *int32, val int32)
func StoreInt64(addr *int64, val int64)
func StoreUint32(addr *uint32, val uint32)
func StoreUint64(addr *uint64, val uint64)
func StoreUintptr(addr *uintptr, val uintptr)

func SwapInt32(addr *int32, new int32) (old int32)
func SwapInt64(addr *int64, new int64) (old int64)
func SwapUint32(addr *uint32, new uint32) (old uint32)
func SwapUint64(addr *uint64, new uint64) (old uint64)
func SwapUintptr(addr *uintptr, new uintptr) (old uintptr)

func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
func CompareAndSwapInt64(addr *int64, old, new int64) (swapped bool)
func CompareAndSwapUint32(addr *uint32, old, new uint32) (swapped bool)
func CompareAndSwapUint64(addr *uint64, old, new uint64) (swapped bool)
func CompareAndSwapUintptr(addr *uintptr, old, new uintptr) (swapped bool)
```

Go 1.23 added:

```go
func AndInt32(addr *int32, mask int32) (old int32)
func AndInt64(addr *int64, mask int64) (old int64)
func AndUint32(addr *uint32, mask uint32) (old uint32)
func AndUint64(addr *uint64, mask uint64) (old uint64)
func AndUintptr(addr *uintptr, mask uintptr) (old uintptr)

func OrInt32(addr *int32, mask int32) (old int32)
// ... similar for Int64, Uint32, Uint64, Uintptr
```

### Pointer atomics

```go
func LoadPointer(addr *unsafe.Pointer) (val unsafe.Pointer)
func StorePointer(addr *unsafe.Pointer, val unsafe.Pointer)
func SwapPointer(addr *unsafe.Pointer, new unsafe.Pointer) (old unsafe.Pointer)
func CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) (swapped bool)
```

These take `*unsafe.Pointer`, requiring callers to cast. Prefer `atomic.Pointer[T]` for new code.

---

## Memory Model Guarantees

From the Go memory model document (<https://go.dev/ref/mem>):

> ### Atomic Values
>
> The APIs in the [sync/atomic] package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.
>
> The preceding definition has the same semantics as C++'s sequentially consistent atomics and Java's volatile variables.

### Formal statements

**Synchronised-before relation.** If atomic operation A writes value `v` to address `x`, and atomic operation B reads value `v` from `x`, then A is synchronised before B. (This extends the happens-before relation across goroutines.)

**Sequential consistency.** There exists a single total order S of all atomic operations in the program such that:
- For any two atomic ops a, b on the same goroutine, if a is before b in source order, then a precedes b in S.
- For any read R that observes the value written by W, W precedes R in S, and no other write to the same location lies between W and R in S.
- All goroutines agree on S.

This is the strongest commonly used memory ordering. It rules out all forms of reordering visible to other goroutines.

### Practical implications

- An atomic store followed by an atomic load on the same variable is *strictly ordered*. The load sees the store (or a later write).
- Non-atomic memory writes that happen-before an atomic store are visible to non-atomic reads that happen-after the corresponding atomic load.
- Two writes to two different atomics from one goroutine appear in source order to all other goroutines.

### What is NOT guaranteed

- The exact instruction emitted by the compiler. (Implementation detail.)
- The wall-clock latency of any operation.
- The absence of cache-line contention costs.
- That two atomic ops on different variables form a transactional pair.

---

## Alignment Requirements

From the package documentation:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically via the primitive atomic functions (types Int64 and Uint64 are automatically aligned). The first word in an allocated struct, array, or slice; in a global variable; or in a local variable (because the subject of all atomic operations will escape to the heap) can be relied upon to be 64-bit aligned.

Restated formally:

1. **64-bit platforms** (`amd64`, `arm64`, `ppc64`, etc.): all `int64`/`uint64` values are 8-byte aligned by the compiler. No caller action required.
2. **32-bit platforms** (`386`, `arm`, `mips`):
   - The legacy free functions (`AddInt64`, `LoadInt64`, ...) require the argument address to be 8-byte aligned. Otherwise, behaviour is undefined and typically crashes.
   - Aligned addresses include: the first field of a struct allocated on the heap or as a global; an element of a slice or array whose element type is 8-byte aligned; a local variable that escapes.
   - **The typed `atomic.Int64`, `atomic.Uint64`, etc., types are automatically 8-byte aligned regardless of struct position.** This is enforced by the compiler's special handling of the `align64` zero-sized marker in the struct definition.

**Recommendation:** use the typed API (`atomic.Int64`) exclusively for new code. Alignment is no longer the caller's problem.

---

## Versioning

Go's compatibility promise (https://go.dev/doc/go1compat) guarantees the API will not break across minor versions. Changes within `sync/atomic`:

| Version | Change |
|---|---|
| Go 1.0 | Free functions for int32/int64/uint32/uint64/uintptr Load/Store/Add/Swap/CAS, plus `atomic.Value` with Load/Store. |
| Go 1.4 | `unsafe.Pointer` atomics added. |
| Go 1.17 | `atomic.Value.Swap` and `atomic.Value.CompareAndSwap` added. |
| Go 1.19 | Typed atomic types: `Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`. Memory model formally specified as sequentially consistent. |
| Go 1.23 | `And` and `Or` methods on integer typed atomics; corresponding free functions. |

Older code using the free function API continues to work. The typed API is recommended for new code.

---

## References

### Authoritative

- The Go Programming Language Specification: <https://go.dev/ref/spec>
- The Go Memory Model: <https://go.dev/ref/mem>
- `sync/atomic` package documentation: <https://pkg.go.dev/sync/atomic>
- Go 1.19 release notes (typed atomics): <https://go.dev/doc/go1.19#atomic_types>
- Go 1.23 release notes (And/Or): <https://go.dev/doc/go1.23>
- Russ Cox, "Updating the Go Memory Model": <https://research.swtch.com/gomm>

### Implementation source

- `src/sync/atomic/doc.go`
- `src/sync/atomic/type.go`
- `src/sync/atomic/value.go`
- `src/runtime/internal/atomic/`
- `src/cmd/compile/internal/ssagen/ssa.go` (intrinsic table)

### Related background

- Russ Cox, "Hardware Memory Models": <https://research.swtch.com/hwmm>
- Russ Cox, "Programming Language Memory Models": <https://research.swtch.com/plmm>
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming* (textbook).
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* (free book).

### Race detector

- Race Detector reference: <https://go.dev/doc/articles/race_detector>
- ThreadSanitizer paper (the upstream of Go's `-race`): "ThreadSanitizer: data race detection in practice," 2009.

### Lock-free literature

- M. M. Michael and M. L. Scott, "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms," 1996. (The Michael-Scott queue.)
- R. K. Treiber, "Systems Programming: Coping with Parallelism," IBM Research Report, 1986. (The Treiber stack.)
- M. M. Michael, "Hazard pointers: Safe Memory Reclamation for Lock-Free Objects," 2004.

### Hardware references

- *Intel 64 and IA-32 Architectures Software Developer's Manual*, Volume 3A, Chapter 8: "Multiple-Processor Management" — atomic operations, `LOCK` prefix, cache coherence.
- *ARM Architecture Reference Manual for A-profile architecture*, "Memory Model" chapter — LL/SC, acquire/release semantics, DMB instructions.
