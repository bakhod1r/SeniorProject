# Compare-and-Swap (CAS) Algorithms — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model: Formal Rules for Atomic Operations](#the-go-memory-model)
3. [Definition of CAS in the Specification](#definition-of-cas-in-the-specification)
4. [Synchronised-Before, Happens-Before, and CAS](#synchronised-before-happens-before-and-cas)
5. [Sequential Consistency Formally](#sequential-consistency-formally)
6. [Linearisability of CAS](#linearisability-of-cas)
7. [Interaction with Non-Atomic Memory](#interaction-with-non-atomic-memory)
8. [Edge Cases in the Spec](#edge-cases-in-the-spec)
9. [Differences Across Go Versions](#differences-across-go-versions)
10. [References](#references)

---

## Introduction

This document covers the formal specification of CAS in Go: what the language and library specifications guarantee, what they leave implementation-defined, and what changed across Go releases. It is intended as a precise reference for reasoning about CAS-using code, not a tutorial.

Authoritative sources:

- The Go Programming Language Specification — <https://go.dev/ref/spec>.
- The Go Memory Model — <https://go.dev/ref/mem>.
- The `sync/atomic` package documentation — <https://pkg.go.dev/sync/atomic>.

---

## The Go Memory Model

The Go memory model (as revised for Go 1.19) defines when reads can observe writes. The key concepts:

- **Memory operation:** a read or write of a specific memory location.
- **Synchronisation primitive:** an operation that establishes ordering between memory operations.
- **Synchronised-before relation:** a partial order on memory operations established by synchronisation primitives.
- **Happens-before relation:** the transitive closure of synchronised-before with program order within each goroutine.

A read `r` may observe a write `w` if and only if:

1. `w` happens-before `r`, and
2. no other write `w'` happens between `w` and `r` and also happens-before `r`.

For non-synchronised reads and writes, this leaves enormous latitude: a race is undefined behaviour. For atomic ops, the specification narrows this.

---

## Definition of CAS in the Specification

The `sync/atomic` package documentation defines:

> **`func CompareAndSwapInt64(addr *int64, old, new int64) (swapped bool)`**
>
> CompareAndSwapInt64 executes the compare-and-swap operation for an int64 value.
> The function compares the contents of the memory location pointed to by `addr` with `old`, and if they are equal, writes `new` to the memory location. The operation is atomic. The return value is `true` if the swap was performed, `false` otherwise.

The same semantics apply to all `CompareAndSwap*` variants and their typed-method equivalents.

The Go memory model, Section "Synchronization > Atomic Values":

> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronise the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronised before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.
>
> This definition has the same semantics as C++'s sequentially consistent atomics and Java's volatile variables.

Specifically for CAS:

- A successful `CompareAndSwap` is both a read (of `old`) and a write (of `new`). Both participate in the synchronised-before order.
- A failed `CompareAndSwap` performs the read but no write. The read still participates.
- The atomic-operation total order includes every CAS (successful or failed) at one point in that order.

### What "atomic" means formally

"Atomic" in the Go specification means: with respect to the memory model, the operation is a single observable event, indivisible. There is no state of the program in which the read and the write happened separately. This is independent of (and stronger than) the hardware "atomic" guarantee, which is about not having torn reads/writes.

---

## Synchronised-Before, Happens-Before, and CAS

### Synchronised-before for atomic ops

If atomic operation A writes to a memory location and atomic operation B reads that location and observes A's write, then A is synchronised-before B.

Applied to CAS:

```go
// goroutine G1
flag.Store(true)        // op A

// goroutine G2
if flag.CompareAndSwap(true, false) { // op B observes A's write
    // A is synchronised-before B
}
```

If G2's CAS succeeds, it observed G1's write of `true`. G1's Store is synchronised-before G2's CAS.

### Happens-before within a goroutine

Within one goroutine, statements happen in program order. Combined with the atomic ordering, this gives the publication idiom:

```go
// goroutine G1
data = 42                  // non-atomic write, op X
flag.Store(true)           // atomic write, op A

// goroutine G2
if flag.Load() {            // atomic read, op B
    use(data)              // non-atomic read, op Y
}
```

Within G1: X happens-before A (program order).
Across goroutines: A synchronised-before B (if B observes A's write).
Within G2: B happens-before Y (program order).
Transitively: X happens-before Y. Y is guaranteed to see X's write (42).

CAS plays the same role as Store and Load in establishing these edges.

### What CAS does *not* synchronise

A CAS synchronises ordering of atomic ops on the *same memory location*. It does not synchronise atomic ops on other locations except via transitive happens-before. Two unrelated atomic variables have no direct ordering relationship unless something in your program creates one.

Example:

```go
var a, b atomic.Int64

// G1
a.Store(1)
b.Store(1)

// G2
fmt.Println(b.Load(), a.Load())
```

Under sequential consistency, the global order includes all four atomic ops in some linear sequence. G2's prints reflect a consistent view of that order. Possible outputs: (0,0), (0,1), (1,1). Impossible: (1,0) — because if G2 saw `b == 1`, it must come after G1's b.Store, which comes after G1's a.Store, so a must also be 1.

### Happens-before with non-atomic data

The most useful property: CAS *publishes* preceding non-atomic writes. If goroutine A makes a series of non-atomic writes and then a CAS, and goroutine B reads the CAS via an atomic op (and observes A's CAS), then B sees all of A's prior non-atomic writes.

```go
// goroutine A
data1 = 100        // non-atomic
data2 = 200        // non-atomic
ready.Store(true)  // atomic

// goroutine B
if ready.Load() {
    use(data1, data2) // sees 100, 200
}
```

This is the publication pattern. It works because Store has release semantics; Load has acquire semantics; together they bracket the non-atomic memory.

CAS has the same role:

```go
// goroutine A
data1 = 100
ready.CompareAndSwap(false, true)

// goroutine B
if ready.Load() {
    use(data1)
}
```

---

## Sequential Consistency Formally

Sequential consistency (SC) is defined: there exists a total order on all atomic operations across all goroutines such that:

1. The order is consistent with each goroutine's program order (atomic ops in one goroutine appear in source order within the total order).
2. Each atomic read observes the most recent atomic write to the same location, where "most recent" is with respect to this total order.

This is the strongest reasonable memory ordering. It is what Java's `volatile` provides, what C++'s `memory_order_seq_cst` provides, and what Go's atomics provide.

### Implication: no out-of-order observations

Under SC, no thread can observe atomic writes in an order inconsistent with the global total order. Concretely:

```go
// G1                        // G2
a.Store(1)                   a.Store(2)
b.Store(1)                   b.Store(2)

// G3
g3a1 := a.Load()
g3b1 := b.Load()

// G4
g4b1 := b.Load()
g4a1 := a.Load()
```

If G3 sees `(a=1, b=2)`, then G2's `a.Store(2)` happens after G3's `a.Load`. If G4 then sees `(b=1, a=2)`, that would be inconsistent — it would imply G1's `a.Store(1)` happens after G2's `b.Store(2)`, but G3 saw G1's a before G2's b. SC rules this out.

Under weaker orderings (acquire/release without SC), G3 and G4 could disagree. SC forces them to agree.

### Implication: SC implies a "store-buffer" violation is observable

SC forbids the classic store-buffer reordering where each goroutine writes its own variable and reads the other's, and both end up reading the initial value. Under SC, at least one read must see the other's write.

On x86 this is naturally provided. On ARM, the compiler must insert barriers to prevent store-buffering. Go's runtime does this on every supported architecture.

---

## Linearisability of CAS

CAS is **linearisable**: each invocation appears to take effect at a single instant between its call and its return. The instant is the linearisation point.

For a successful CAS, the linearisation point is the moment the write happens (atomically with the read of the comparison).

For a failed CAS, the linearisation point is the moment the read happens (no write).

Linearisability is a stronger property than serialisability or sequential consistency for individual operations on a single object. It ensures that even composite operations involving multiple CAS calls behave intuitively when each is considered atomic at its linearisation point.

Lock-free data structures built on CAS (Treiber stack, Michael-Scott queue) inherit linearisability from CAS, provided the algorithm has well-defined linearisation points (typically the "successful CAS that publishes the change").

---

## Interaction with Non-Atomic Memory

The memory model has separate rules for atomic and non-atomic accesses.

### Rule 1: Non-atomic accesses must not race

If two non-atomic operations on the same memory location are concurrent and at least one is a write, the program has a data race and the behaviour is undefined. The compiler, runtime, and `go test -race` are not required to detect every race.

### Rule 2: Atomic and non-atomic accesses to the same location race

```go
var x int64
go func() { x = 5 }()                          // non-atomic write
go func() { atomic.LoadInt64(&x) }()           // atomic read
```

This is a race. The atomic read does not synchronise with the non-atomic write. The race detector flags it.

### Rule 3: Atomic accesses do not race with each other

Two `atomic.Load` calls, two `atomic.Store` calls, two `CompareAndSwap` calls — these are race-free by construction.

### Rule 4: Atomic ops synchronise *some* non-atomic accesses

The publication pattern works because:

- The non-atomic writes happen-before the atomic Store (program order in the writer goroutine).
- The atomic Store is synchronised-before the atomic Load (if the Load observes the Store).
- The atomic Load happens-before the non-atomic reads (program order in the reader goroutine).
- Transitively, the non-atomic writes happen-before the non-atomic reads, eliminating the race.

This is why ` ready.Store(true)` followed by `if ready.Load()` is the correct publication idiom.

---

## Edge Cases in the Spec

### CAS on a value that equals its current value

```go
var x atomic.Int64
x.Store(5)
ok := x.CompareAndSwap(5, 5)
```

This is well-defined: `ok == true`, no observable state change (other than the synchronisation effect). The CAS still acts as a barrier and participates in the total order. Sometimes useful as a "synchronisation point without changing state."

### CAS on misaligned addresses

For 64-bit atomics on 32-bit platforms, the address must be 8-byte aligned. The specification:

> The first word in an allocated struct, array, or slice; in a global variable; or in a local variable (because the subject of all atomic operations will escape to the heap) can be relied upon to be 64-bit aligned.

Misaligned access on a 32-bit platform may cause a runtime panic or silent incorrect behaviour. The Go 1.19 typed atomics (`atomic.Int64` etc.) include an alignment hint and are always aligned.

On 64-bit platforms (amd64, arm64), all 8-byte values are 8-byte aligned by default; no concern.

### CAS on a nil pointer to atomic

```go
var p *atomic.Int64 // nil
p.CompareAndSwap(0, 1) // panics: nil pointer dereference
```

The method receivers panic on nil. Same as any method on a nil pointer.

### CAS on the receiver of a copied atomic

```go
var x atomic.Int64
y := x // copy
y.CompareAndSwap(0, 1) // affects y, not x
```

Each atomic value is independent. The `noCopy` marker triggers `go vet` warnings on copy. Behaviour is well-defined per the spec but typically not what the programmer wants.

### CAS on an atomic.Pointer to an interface

`atomic.Pointer[T]` requires `T` to be a concrete type. For an interface, you would `atomic.Pointer[*MyInterfaceImpl]` for a specific implementation, or use `atomic.Value` for arbitrary interface storage.

### CAS via legacy `atomic.CompareAndSwapPointer`

```go
var p unsafe.Pointer
old := unsafe.Pointer(uintptr(0))
new := unsafe.Pointer(someAddr)
ok := atomic.CompareAndSwapPointer(&p, old, new)
```

The `old` and `new` are `unsafe.Pointer`. The bit pattern, not the type, is compared. Two different `*T` and `*U` values pointing at the same address compare equal.

The typed `atomic.Pointer[T]` is safer: type-preserving, no `unsafe`.

---

## Differences Across Go Versions

### Pre-Go 1.19

The memory model documentation was less precise. Atomics were "guaranteed to be synchronisation primitives" but the formal semantics (sequential consistency) were not spelled out. In practice, the implementation has always been SC; only the documentation changed.

`atomic.Int64`, `atomic.Pointer[T]`, and the other typed atomics did not exist. Code used `atomic.CompareAndSwapInt64(&x, old, new)` with manual alignment management.

### Go 1.19

- Memory model formally specifies sequential consistency for atomics.
- `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Uintptr`, `atomic.Bool`, `atomic.Pointer[T]` added.
- The typed atomics use `align64` and `noCopy` markers internally.

### Go 1.23

- `atomic.Int32.And`, `Or`, `atomic.Int64.And`, `Or`, `atomic.Uint32.And`, `Or`, `atomic.Uint64.And`, `Or`, `atomic.Uintptr.And`, `Or` added.
- These compile to dedicated atomic AND/OR instructions on x86 (`LOCK AND`, `LOCK OR`) and ARM64.

### Code-compatibility implications

Code written for Go 1.18 still works on Go 1.22. The legacy `atomic.CompareAndSwapInt64` and similar functions are still supported and behave identically. The typed atomics are an addition, not a replacement.

For new code, prefer the typed forms — they prevent alignment bugs and accidental copies.

---

## References

- The Go Memory Model: <https://go.dev/ref/mem> (revision history at the bottom).
- The `sync/atomic` package: <https://pkg.go.dev/sync/atomic>.
- The Go Programming Language Specification: <https://go.dev/ref/spec>.
- Russ Cox, "Updating the Go Memory Model" (proposal that led to the Go 1.19 revisions): <https://research.swtch.com/gomm>.
- Leslie Lamport, "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs," IEEE Transactions on Computers C-28(9), 1979. The original sequential consistency paper.
- Maurice Herlihy and Jeannette Wing, "Linearizability: A Correctness Condition for Concurrent Objects," ACM TOPLAS 12(3), 1990. The original linearisability paper.
- Hans-J. Boehm and Sarita V. Adve, "Foundations of the C++ Concurrency Memory Model," PLDI 2008. The basis of C++ atomics, which Go's atomics align with.
