---
layout: default
title: Sequential Consistency — Specification
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/specification/
---

# Sequential Consistency — Specification

## Overview

This page collects the formal, authoritative text that defines sequential consistency as it applies to Go programs. It serves as a quick reference for language-lawyer questions.

The primary sources are:

- The Go memory model document at `https://go.dev/ref/mem` (revised 2022 for Go 1.19+).
- The `sync/atomic` package documentation.
- Lamport's 1979 paper for the original definition.
- The C++ standard, [intro.races], for comparison.

---

## Go Memory Model (excerpts, Go 1.19+)

### Definition of the Memory Model

> The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.

### Advice

> Programs that modify data being simultaneously accessed by multiple goroutines must serialize such access. To serialize access, protect the data with channel operations or other synchronization primitives such as those in the sync and sync/atomic packages.

### Happens-Before

> Within a single goroutine, the happens-before order is the order expressed by the program.

> A read r of a variable v is allowed to observe a write w to v if both of the following hold:
> 1. r does not happen before w.
> 2. There is no other write w' to v that happens after w but before r.

### Synchronization

The following are synchronization operations:

> Initialization: If a package p imports package q, the completion of q's init functions happens before the start of any of p's.

> Goroutine creation: The go statement that starts a new goroutine happens before the goroutine's execution begins.

> Goroutine destruction: The exit of a goroutine is not guaranteed to happen before any event in the program.

> Channel communication: A send on a channel is synchronized before the completion of the corresponding receive from that channel.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

> A receive from an unbuffered channel is synchronized before the completion of the corresponding send on that channel.

> Locks: For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

> For any call to l.RLock on a sync.RWMutex variable l, there is an n such that the n'th call to l.Unlock is synchronized before the return from l.RLock, and the matching call to l.RUnlock is synchronized before the return from call n+1 to l.Lock.

> A successful call to l.TryLock (or l.TryRLock) is equivalent to a call to l.Lock (or l.RLock). An unsuccessful call has no synchronizing effect at all.

> Once: A single call of f() from once.Do(f) is synchronized before the return of any call of once.Do(f).

> Atomic Values: The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

> The preceding definition has the same semantics as C++'s sequentially consistent atomics and Java's volatile variables.

### Incorrect Synchronization

> Programs with races are incorrect and can exhibit non-sequentially consistent executions. In particular, note that a read r may observe the value written by any write w that executes concurrently with r. Even if this occurs, it does not imply that reads happening after r will observe writes that happened before w.

> A read of a single machine word-sized or sub-word-sized memory location must observe a value actually written to that location (perhaps by a concurrent executing goroutine) and not yet overwritten.

### Implementation Constraints

The Go compiler must respect:

> The compiler can rearrange reads and writes to memory locations across goroutines, but must not introduce data races.

> Reads and writes of values larger than a single machine word behave as multiple machine-word-sized operations in an unspecified order.

> Implementations must not reorder atomic operations.

---

## sync/atomic Package Documentation (excerpts)

From the package documentation:

> Package atomic provides low-level atomic memory primitives useful for implementing synchronization algorithms.

> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package. Share memory by communicating; don't communicate by sharing memory.

### Sequentially Consistent

> Each of these methods on each type is "atomic." All these atomic operations function as one of the following:
> - A load: atomic.LoadInt32, etc.
> - A store: atomic.StoreInt32, etc.
> - A swap: atomic.SwapInt32, etc. (also Get-and-Set)
> - A compare-and-swap: atomic.CompareAndSwapInt32, etc.
> - An add: atomic.AddInt32, etc. (also Get-and-Add)

> All these atomic operations are sequentially consistent.

### Typed API (Go 1.19+)

> Bool is an atomic boolean value.
> Int32, Int64 are atomic signed integer values.
> Uint32, Uint64 are atomic unsigned integer values.
> Uintptr is an atomic pointer-sized integer.
> Pointer[T] is an atomic typed pointer.

> All these types provide Load, Store, Swap, and CompareAndSwap methods.
> Integer types additionally provide Add.

### Alignment

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically via the primitive atomic functions (types Int64 and Uint64 are automatically aligned).

---

## Lamport's Original Definition (1979)

The seminal definition:

> The result of any execution is the same as if the operations of all the processors were executed in some sequential order, and the operations of each individual processor appear in this sequence in the order specified by its program.

This is the foundation. Go's memory model is a modern restatement and implementation of this idea.

---

## C++ Memory Order Comparison

For language-lawyer comparisons, the C++ standard's memory_order specifications:

### memory_order_relaxed

> Relaxed operation: there are no synchronization or ordering constraints imposed on other reads or writes, only this operation's atomicity is guaranteed.

### memory_order_acquire

> A load operation with this memory order performs the acquire operation on the affected memory location: no reads or writes in the current thread can be reordered before this load.

### memory_order_release

> A store operation with this memory order performs the release operation: no reads or writes in the current thread can be reordered after this store.

### memory_order_acq_rel

> A read-modify-write operation with this memory order is both an acquire operation and a release operation.

### memory_order_seq_cst

> A load operation with this memory order performs an acquire operation, a store performs a release operation, and read-modify-write performs both an acquire and a release operation, plus a single total order exists in which all threads observe all modifications in the same order.

Go's atomics correspond exactly to memory_order_seq_cst.

---

## Java Memory Model Comparison

### volatile

> A write to a volatile field happens-before every subsequent read of that field.

> A read of a volatile field is synchronized with the read of any other volatile field if there is a happens-before path between them.

> Effectively, volatile in Java gives sequentially consistent semantics for individual fields.

### Atomic classes

> java.util.concurrent.atomic provides atomic classes with sequentially consistent semantics by default. Newer JDKs offer VarHandle with explicit memory orderings.

---

## Rust Memory Model Comparison

Rust's `std::sync::atomic::Ordering`:

- `Relaxed`: only atomicity.
- `Release`: store-release.
- `Acquire`: load-acquire.
- `AcqRel`: combined for RMW.
- `SeqCst`: sequentially consistent.

Go's atomics correspond to `Ordering::SeqCst`.

---

## Quick Reference

### Go SC contract

```
Race-free program ⇒ behaves as if executed under SC
All sync/atomic operations are SC
Synchronisation primitives create happens-before edges
```

### Key happens-before edges

| Source | Target |
|--------|--------|
| go f() statement | First instruction of f |
| Channel send | Corresponding receive completion |
| Channel close | Receive observing closed |
| mutex.Unlock | Subsequent mutex.Lock |
| WaitGroup.Done | Wait return |
| Once.Do(f) completion | Return of subsequent Do |
| Atomic op N | Atomic op N+1 in global order |

### Forbidden under SC

- Out-of-thin-air values.
- IRIW-style inconsistent observations.
- Store-buffer reorderings on synchronising operations.

### Permitted under SC

- Any global order consistent with per-goroutine program order.
- Multiple legal observations of any single execution.

---

## Implementation Compliance

Compilers and runtimes claiming Go memory model compliance must:

1. Emit memory barriers sufficient for SC on each target architecture.
2. Not reorder operations across atomic synchronisation points.
3. Not introduce phantom writes (writes the source did not request).
4. Honour the word-tear-prevention guarantee.
5. Provide a race detector (`-race`) that verifies SC-DRF.

The official Go compiler and runtime satisfy these requirements. Alternative implementations (TinyGo, gccgo) aim for the same compliance.

---

## References

- Go memory model: `https://go.dev/ref/mem`
- sync/atomic: `https://pkg.go.dev/sync/atomic`
- Russ Cox blog posts: `https://research.swtch.com/mm`
- Lamport 1979 paper.
- C++ standard, [intro.races] (n4861 or later).
- Java JSR-133.
- Rust std::sync::atomic documentation.

---

## Closing

This specification page is the language-lawyer's reference. For tutorials and explanations, see junior.md through professional.md.

The text above is authoritative (excerpted from official sources) or carefully paraphrased. When in doubt, consult the original sources.

End.

---

## Appendix: Detailed Specification Annotations

### On the meaning of "synchronized before"

The phrase "A is synchronized before B" in Go's spec is equivalent to "A happens-before B" plus a synchronisation-edge contribution. In Go's revised model, the two terms are essentially interchangeable for atomic operations.

### On the "as though executed in some sequentially consistent order"

This clause is the SC guarantee. The "as though" phrasing permits implementations to use whatever fences are needed; the *observable* behaviour must match a sequentially-consistent execution.

### On data race UB

The phrase "Programs with races are incorrect and can exhibit non-sequentially consistent executions" formalises that race-free is a precondition. With races, no SC guarantee applies.

### On word tear

The spec says reads/writes of single machine-word memory locations must observe values actually written. This forbids the compiler from producing torn reads (split into smaller reads) or torn writes.

### On 64-bit alignment

Pre-1.19, the user was responsible for alignment of 64-bit atomics on 32-bit platforms. The typed API (`atomic.Int64`) handles this automatically.

### On atomic.Pointer[T]

Generic typed pointer atomics. Provides SC operations on typed pointers. Equivalent to `atomic.UnsafePointer` but type-safe.

---

## Appendix: Atomic Method Specifications

### atomic.Bool

```go
type Bool struct{ /* opaque */ }

func (x *Bool) Load() bool
func (x *Bool) Store(val bool)
func (x *Bool) Swap(new bool) (old bool)
func (x *Bool) CompareAndSwap(old, new bool) (swapped bool)
```

All operations are sequentially consistent.

### atomic.Int32 / atomic.Int64

```go
type Int32 struct{ /* opaque */ }
type Int64 struct{ /* opaque */ }

func (x *Int32) Load() int32
func (x *Int32) Store(val int32)
func (x *Int32) Swap(new int32) (old int32)
func (x *Int32) CompareAndSwap(old, new int32) (swapped bool)
func (x *Int32) Add(delta int32) (new int32)
```

Same operations for Int64. SC semantics. Int64 is auto-aligned.

### atomic.Uint32 / atomic.Uint64

Same operations as Int32/Int64 but for unsigned. SC semantics.

### atomic.Uintptr

Same as Uint64 but with pointer-sized integer. SC.

### atomic.Pointer[T]

```go
type Pointer[T any] struct{ /* opaque */ }

func (x *Pointer[T]) Load() *T
func (x *Pointer[T]) Store(val *T)
func (x *Pointer[T]) Swap(new *T) (old *T)
func (x *Pointer[T]) CompareAndSwap(old, new *T) (swapped bool)
```

SC operations on typed pointers. No Add (pointer arithmetic not provided).

### Legacy free functions

```go
func LoadInt32(addr *int32) int32
func StoreInt32(addr *int32, val int32)
func SwapInt32(addr *int32, new int32) (old int32)
func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
func AddInt32(addr *int32, delta int32) (new int32)
```

Similar for other types. Same SC semantics. Retained for backwards compatibility.

---

## Appendix: Notable Quotes

A collection of key quotes from spec and authoritative sources:

> "All the atomic operations executed in a program behave as though executed in some sequentially consistent order." — Go memory model

> "The preceding definition has the same semantics as C++'s sequentially consistent atomics and Java's volatile variables." — Go memory model

> "Share memory by communicating; don't communicate by sharing memory." — Go proverbs

> "Programs that modify data being simultaneously accessed by multiple goroutines must serialize such access." — Go memory model

> "The result of any execution is the same as if the operations of all the processors were executed in some sequential order, and the operations of each individual processor appear in this sequence in the order specified by its program." — Lamport 1979

> "A memory model that is more relaxed than sequential consistency is harder to use." — paraphrased from Adve-Boehm 2010

> "Strong by default. Weak by opt-in. We chose strong only." — Russ Cox on Go's choice

---

## Appendix: Memory Model Glossary, Specification Edition

| Term | Definition (from spec) |
|------|-------------------------|
| Memory model | The conditions under which reads guarantee to observe writes. |
| Happens-before | The partial order from program order and synchronisation. |
| Synchronized before | Equivalent to happens-before for atomic operations. |
| Data race | Two accesses, at least one a write, not ordered by happens-before. |
| Sequentially consistent | Operations appear in a global total order respecting per-goroutine program order. |
| Atomic operation | A sync/atomic operation, indivisible. |
| Word tear | A read or write split into smaller operations. Forbidden. |
| Phantom write | A write the source did not request. Forbidden. |

---

## Appendix: Hardware Specification Pointers

For comparison, the relevant sections of hardware ISA specifications:

### Intel SDM

Volume 3, Section 8.2: "Memory Ordering." Describes TSO formally.

### AMD64 manual

Volume 2, Section 7.2: similar to Intel; codifies TSO.

### ARM ARMv8 Reference Manual

Section B2: "The AArch64 Application Level Memory Model." Defines the formal model.

### RISC-V ISA spec

Volume I, Chapter "RVWMO Memory Consistency Model." Defines the weak memory order.

### POWER ISA spec

Book II, Chapter 1: "Storage Model." Defines the POWER memory model.

These are authoritative for hardware. Go's compiler dispatches to them.

---

## Appendix: Standard Test Suite

The Go runtime's test suite includes memory-model tests:

- `runtime/race`: race detector tests.
- `sync/atomic`: atomic-operation tests.
- `runtime/internal/atomic`: low-level atomic tests per architecture.

These tests run on every Go release across all supported architectures. The Go team monitors them carefully.

---

## Appendix: Compliance Bug Tracker

When implementations violate the memory model, bugs are filed:

- Compiler bugs: `github.com/golang/go/issues` labeled compiler/runtime.
- Hardware bugs: vendor-specific errata sheets.

Memory-model bugs are P0 priority. The Go team responds quickly.

---

## End of Specification

This page provides the authoritative reference. For tutorials, see other pages in the section.

For language-lawyer questions: consult the spec, then this page, then Russ Cox's blog. For implementation questions: read the Go runtime source.

End.

---

## Appendix: Specification of Common Patterns

### Publication pattern, formally

```
Goroutine A (writer):
  Statement 1: data = value  // plain write
  Statement 2: flag.Store(true) // atomic SC store

Goroutine B (reader):
  Statement 3: if flag.Load() == true  // atomic SC load
  Statement 4:   use(data)  // plain read

happens-before chain:
  S1 →[program order] S2
  S2 →[SC sync] S3 (if S3 observes true)
  S3 →[program order] S4

By transitivity: S1 →* S4
Therefore: S4 sees the value of S1.
```

### Mutex pattern, formally

```
Goroutine A:                Goroutine B:
  S1: mu.Lock()
  S2: x = 1
  S3: mu.Unlock()
                              S4: mu.Lock()
                              S5: r = x
                              S6: mu.Unlock()

happens-before:
  S3 →[mutex sync] S4
By program order and transitivity: S2 → S5
S5 reads the value written by S2.
```

### Channel pattern, formally

```
Goroutine A:                Goroutine B:
  S1: x = 1
  S2: ch <- 0
                              S3: <-ch
                              S4: r = x

happens-before:
  S2 →[channel sync] S3
Combined with program order: S1 → S4
S4 sees x = 1.
```

These formalisations apply across the entire memory model.

---

## Appendix: One-Line Summary

Go memory model in one line:

> Race-free programs behave as if all operations execute in some global total order, with sync/atomic operations participating in this order with SC semantics.

That sentence is the entire specification, condensed.

End.


