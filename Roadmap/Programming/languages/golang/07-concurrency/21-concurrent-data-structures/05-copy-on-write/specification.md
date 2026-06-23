---
layout: default
title: Specification
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/specification/
---

# Copy-on-Write — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model on Atomic Operations](#the-go-memory-model-on-atomic-operations)
3. [`sync/atomic` Package API](#syncatomic-package-api)
4. [`atomic.Value` Guarantees](#atomicvalue-guarantees)
5. [`atomic.Pointer[T]` Guarantees](#atomicpointert-guarantees)
6. [The Sync Package and Mutex Semantics](#the-sync-package-and-mutex-semantics)
7. [Implementation-Defined Behavior](#implementation-defined-behavior)
8. [Cross-Version Compatibility](#cross-version-compatibility)
9. [References](#references)

---

## Introduction

The behaviour of copy-on-write patterns in Go is governed by three normative sources:

- **The Go Programming Language Specification** (`go.dev/ref/spec`) — defines the language semantics.
- **The Go Memory Model** (`go.dev/ref/mem`) — defines when one goroutine's writes are visible to another.
- **The `sync/atomic` package documentation** (`pkg.go.dev/sync/atomic`) — defines the atomic operations used to implement COW.

Several behaviours are deliberately *not* specified, leaving room for the runtime to evolve. This file separates what is guaranteed from what is implementation detail.

---

## The Go Memory Model on Atomic Operations

The Go memory model defines the conditions under which a read of a variable can be guaranteed to observe a write to the same variable by a different goroutine. Section "Atomic Values" (revised in Go 1.19) is the normative reference for COW.

### The normative statement

From `https://go.dev/ref/mem`:

> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

Three key points:

1. Atomic operations create *synchronized before* (happens-before) edges.
2. The set of all atomic operations across all goroutines has a *sequentially consistent* total order.
3. Non-atomic operations are ordered only via these atomic edges (or other synchronization primitives).

### Practical consequence for COW

Given:

```go
// Writer
buildSnapshot(c)          // (W1) writes c.Fields
ptr.Store(c)              // (W2) atomic store

// Reader
got := ptr.Load()         // (R1) atomic load returning c
useSnapshot(got)          // (R2) reads got.Fields
```

The memory model guarantees:

- W1 happens-before W2 (program order in writer).
- W2 happens-before R1 (atomic synchronization on `ptr`).
- R1 happens-before R2 (program order in reader).

Transitively, W1 happens-before R2: the reader's field accesses are guaranteed to see the writer's snapshot construction.

### Sequential consistency in practice

The Go memory model goes further than acquire-release. Every atomic operation participates in a single global total order. This means:

```go
// Goroutine A
atomic.Store(&a, 1)
atomic.Store(&b, 1)

// Goroutine B
if atomic.Load(&b) == 1 {
    // atomic.Load(&a) must return 1
}
```

If goroutine B observes B's store to `b`, then A's store to `a` (which preceded the store to `b` in A's program order) must also be observable. This is sequential consistency.

For COW: stores to multiple atomic variables are coherently ordered across all observers. You can rely on "publish X then Y" being observed as such.

---

## `sync/atomic` Package API

The package documentation at `pkg.go.dev/sync/atomic` is the normative source for atomic operations.

### Generic functions (pre-1.19)

```go
func LoadInt32(addr *int32) (val int32)
func LoadInt64(addr *int64) (val int64)
func LoadUint32(addr *uint32) (val uint32)
func LoadUint64(addr *uint64) (val uint64)
func LoadUintptr(addr *uintptr) (val uintptr)
func LoadPointer(addr *unsafe.Pointer) (val unsafe.Pointer)

func StoreInt32(addr *int32, val int32)
func StoreInt64(addr *int64, val int64)
// ... same for the rest

func SwapInt32(addr *int32, new int32) (old int32)
// ... same for the rest

func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
// ... same for the rest

func AddInt32(addr *int32, delta int32) (new int32)
// ... same for integer types
```

These are the original API. They operate on `*T` and require type assertions when storing/loading via `interface{}`.

### Typed atomic wrappers (Go 1.19+)

```go
type Bool struct{ ... }
type Int32 struct{ ... }
type Int64 struct{ ... }
type Uint32 struct{ ... }
type Uint64 struct{ ... }
type Uintptr struct{ ... }
type Pointer[T any] struct{ ... }
type Value struct{ ... }  // pre-1.19, kept for compatibility

func (x *Bool) Load() bool
func (x *Bool) Store(val bool)
func (x *Bool) Swap(new bool) (old bool)
func (x *Bool) CompareAndSwap(old, new bool) (swapped bool)
```

Each type provides Load, Store, Swap, CompareAndSwap. Integer types additionally provide Add (and And, Or in 1.23+).

### Memory model behavior

Per the package documentation:

> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package.

And:

> The swap operation, implemented by the SwapT functions, is the atomic equivalent of:
> ```
> old = *addr
> *addr = new
> return old
> ```

> The compare-and-swap operation, implemented by the CompareAndSwapT functions, is the atomic equivalent of:
> ```
> if *addr == old {
>     *addr = new
>     return true
> }
> return false
> ```

These specifications are atomic — the whole operation appears as a single point in the total order.

### Alignment requirements

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

For COW, this matters when embedding `atomic.Int64` or similar in a struct on 32-bit platforms. `atomic.Pointer[T]` is pointer-aligned and not affected.

---

## `atomic.Value` Guarantees

The `atomic.Value` type was added in Go 1.4. Its guarantees:

### Type consistency

From the docs:

> All calls to Store for a given Value must use values of the same concrete type. Store of an inconsistent type panics, as does Store(nil).

This is a runtime check: the dynamic type of every `Store` argument must match the first one. Mismatched types panic. Nil stores panic.

### Atomicity

> Load returns the value set by the most recent Store. It returns nil if there has been no call to Store for this Value. Once Store has been called, a Value must not be copied.

Load is guaranteed to return a value previously stored (or nil if never stored).

### Memory model

Same as the rest of `sync/atomic`: Load observing a Store creates a synchronized-before edge.

### CompareAndSwap and Swap

Added in Go 1.17. Same semantics as the rest of atomic CAS.

```go
func (v *Value) CompareAndSwap(old, new any) (swapped bool)
func (v *Value) Swap(new any) (old any)
```

### Limitations

- `interface{}` boxing adds overhead.
- Type assertions on every Load.
- `Store(nil)` panics in older versions; behavior with nil interfaces was clarified in 1.18.

For new code, prefer `atomic.Pointer[T]`.

---

## `atomic.Pointer[T]` Guarantees

Added in Go 1.19 along with other typed atomic wrappers.

### Type safety

The type parameter `T` enforces compile-time type safety. `Store` accepts only `*T`; `Load` returns `*T`. No type assertions.

### Atomicity

Same guarantees as `LoadPointer`/`StorePointer`. The operations are atomic with respect to other atomic operations on the same Pointer.

### Zero value

The zero value of `atomic.Pointer[T]` is a Pointer whose stored value is `nil`. Calling `Load` on a zero Pointer returns `nil`. Storing a non-nil `*T` updates the stored value.

### Non-copyable

The type embeds `noCopy`, which `go vet` checks. Attempting to copy a Pointer value triggers a vet warning.

### Memory model

Same as the rest of `sync/atomic`: every Store/Load creates an ordering edge in the global total order.

### API

```go
func (x *Pointer[T]) Load() *T
func (x *Pointer[T]) Store(val *T)
func (x *Pointer[T]) Swap(new *T) (old *T)
func (x *Pointer[T]) CompareAndSwap(old, new *T) (swapped bool)
```

Four methods. Each is one atomic operation.

### Recommended for COW

The documentation strongly suggests `atomic.Pointer[T]` for new code:

> Pointer[T] is the recommended way to manage atomic pointers.

---

## The Sync Package and Mutex Semantics

While COW relies primarily on atomic operations, most production COW also uses `sync.Mutex` for writer serialization.

### `sync.Mutex` guarantees

From the Go memory model:

> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

So consecutive Lock/Unlock pairs are ordered. This is what makes the writer-mutex pattern correct.

### Non-reentrant

```go
mu.Lock()
mu.Lock() // deadlock
```

Mutexes are not reentrant. Don't call methods that re-acquire the same mutex.

### RWMutex semantics

> For any call to l.RLock on a sync.RWMutex variable l, there is an n such that the l.RLock is synchronized after the n-th call to l.Unlock and the corresponding l.RUnlock is synchronized before the n+1-th call to l.Lock.

RWMutex readers are ordered with respect to Unlocks. Writer-preferring as of Go 1.18+ to prevent starvation.

For COW: RWMutex is not strictly needed since atomic.Pointer handles read-side concurrency. But you may use it for the writer's mutex if you prefer.

### `sync.Once`

> The single call of f from once.Do(f) is synchronized before the return of any call of once.Do(f).

`sync.Once` provides one-time initialization with happens-before guarantees. Useful for lazy snapshot initialization.

---

## Implementation-Defined Behavior

Some aspects are not guaranteed by the spec and may change across Go versions or architectures.

### Atomic operation cost

The standard library does not guarantee specific costs for atomic operations. They are typically a few nanoseconds but vary by:
- CPU architecture (x86, ARM, RISC-V).
- Cache hit/miss state.
- Contention level.
- GC phase (write barrier active or not).

### Garbage collection timing

The GC's pause durations and concurrent mark behavior are not specified. They have improved across versions and continue to evolve.

For COW: assume GC will eventually reclaim unreachable snapshots; do not rely on specific timing.

### Goroutine scheduling

Goroutine scheduling is implementation-defined. Two equivalent goroutines may execute in any order. For COW: do not assume one goroutine's writes are visible to another except via documented synchronization primitives.

### Stack allocation

Whether a particular value lives on stack vs heap is determined by escape analysis at compile time. The decision may change across Go versions.

For COW snapshots: they almost always escape. Don't depend on stack allocation.

### Write barrier overhead

The GC's write barrier adds a small cost to pointer writes during concurrent marking. The exact cost is not specified.

### `sync.Map` internal structure

`sync.Map`'s read/dirty separation and promotion behavior are implementation details. Do not rely on specific performance characteristics across versions.

### `runtime.Gosched`

Does not guarantee a particular thread switch. Just a hint to the scheduler.

---

## Cross-Version Compatibility

Key COW-related changes across Go versions:

### Go 1.4 (Dec 2014)

- Added `sync/atomic.Value`. The original COW container.

### Go 1.9 (Aug 2017)

- Improved memory model documentation.

### Go 1.13 (Sep 2019)

- Added `Value.Swap`.

### Go 1.17 (Aug 2021)

- Added `Value.CompareAndSwap`.
- Improved register-based calling convention; atomic operations slightly faster.

### Go 1.18 (Mar 2022)

- Generics introduced.
- `sync.RWMutex` made writer-preferring.

### Go 1.19 (Aug 2022)

- Added typed atomic wrappers: `Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`.
- Memory model formally specifies sequential consistency for atomics.
- `debug.SetMemoryLimit` for soft heap caps.

### Go 1.23 (Aug 2024)

- Added `atomic.And` and `atomic.Or` for atomic bitwise operations on integers.

### Go 1.24+ (TBD)

- `weak.Pointer[T]` for weak references.
- Continued GC improvements.

### Migration guidance

- Pre-1.19 code using `atomic.Value` should migrate to `atomic.Pointer[T]` when possible.
- Pre-1.19 code using `atomic.LoadPointer` with `unsafe.Pointer` should migrate to typed `atomic.Pointer[T]`.
- Pre-1.22 code with captured-variable loops should be reviewed (1.22 changed `for` loop variable scoping).

---

## Atomic Operations: Detailed Semantics

### `Load`

From the spec:

> Load atomically loads and returns the value stored in x.

The returned value is the value of the most recent Store (in the global total order of atomic operations). Multiple Loads without intervening Stores return the same value.

### `Store`

> Store atomically stores val into x.

The store is visible to subsequent atomic Loads of x. The store creates a synchronization edge with such Loads.

### `Swap`

> Swap atomically stores new into x and returns the previous value.

Equivalent to:
```go
old := x.Load()
x.Store(new)
return old
```
but atomic — the load and store are a single point in the total order.

### `CompareAndSwap`

> CompareAndSwap executes the compare-and-swap operation for x.

Equivalent to:
```go
if x.Load() == old {
    x.Store(new)
    return true
}
return false
```
but atomic. The comparison and store are a single point.

Returns true if the swap was performed. Returns false if the current value did not match `old`.

---

## Garbage Collection Specification

The Go GC's behavior is partially specified.

### Reachability

The GC reclaims objects unreachable from any root. Roots include:
- Goroutine stacks.
- Global variables.
- Memory referenced by registers.
- Memory referenced by certain runtime internal structures.

An object is reachable if there is a path of pointer references from a root to it.

### Write barrier

The GC uses a write barrier during concurrent marking. The barrier is implementation-defined but documented:

> The garbage collector uses a write barrier to maintain its invariants. The write barrier is enabled during the concurrent mark phase.

For COW: pointer stores during marking pay slightly more.

### Finalization

`runtime.SetFinalizer` allows custom cleanup when objects become unreachable. For COW: rarely useful — the GC handles snapshot reclamation.

### Force GC

`runtime.GC()` forces a GC cycle. Documented but expensive. Use only for testing or specialized cases.

### `GOGC` and `GOMEMLIMIT`

Environment variables controlling GC behavior:
- `GOGC=100` (default): GC triggers at 2× heap growth.
- `GOGC=off`: disables GC.
- `GOMEMLIMIT`: soft cap on heap.

For COW: tune `GOGC` higher if you can tolerate more memory but want fewer GCs.

---

## Snapshot Lifecycle Specification

### When is a snapshot reachable?

A snapshot `s` is reachable if:
1. The current `atomic.Pointer.v` points to `s`, OR
2. Some goroutine's stack contains a pointer to `s` (e.g., a local variable), OR
3. Some heap object containing a pointer to `s` is itself reachable.

If none of these hold, `s` is unreachable and the GC may reclaim it.

### When does the GC reclaim?

The GC reclaims at some point during a sweep phase after marking determines `s` is unreachable. The exact time is not specified.

### Finalization order

For COW: snapshots usually don't need finalizers. If they do, finalizers run *after* the object is determined unreachable but before reclamation.

### Resurrection

A finalizer can resurrect an object by re-establishing reachability. This is allowed but discouraged. For COW: never do this.

---

## Race Detector Specification

The race detector flags concurrent accesses to shared memory where at least one is a write and there is no happens-before edge between them.

### What it catches

- Concurrent writes to the same field.
- Concurrent read + write to the same field.
- Reads after a Store without proper synchronization.

### What it does not catch

- Logical bugs (lost updates if writers don't serialize).
- Performance issues.
- Memory leaks.

### For COW

Run all tests with `-race`. If a snapshot is mutated after publish, the race detector will catch it (assuming a concurrent reader is exercised).

---

## Specification Summary

The Go memory model + `sync/atomic` documentation + the Go programming language specification together fully specify COW's correctness. The implementation may evolve, but the specified behavior is stable.

For maximal correctness:
- Use `atomic.Pointer[T]` for the snapshot pointer.
- Serialize writers (mutex or CAS loop).
- Treat published snapshots as immutable.
- Test with the race detector.
- Trust the GC for reclamation.

These rules follow directly from the specification.

---

## References

- The Go Programming Language Specification: `https://go.dev/ref/spec`
- The Go Memory Model: `https://go.dev/ref/mem`
- `sync/atomic` package: `https://pkg.go.dev/sync/atomic`
- `sync` package: `https://pkg.go.dev/sync`
- `runtime` package: `https://pkg.go.dev/runtime`
- Go release notes: `https://go.dev/doc/devel/release`
- Russ Cox, "Hardware Memory Models" and "Programming Language Memory Models": `https://research.swtch.com/`

These are the normative references for COW correctness in Go.
