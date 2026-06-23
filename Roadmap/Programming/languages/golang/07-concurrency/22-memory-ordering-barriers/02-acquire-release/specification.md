---
layout: default
title: Specification
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/specification/
---

# Acquire / Release — Specification

This file collects the formal specifications and documentation relevant to acquire/release semantics in Go.

## The Go Memory Model (2022 Revision)

The official document at https://go.dev/ref/mem defines Go's memory model. Key excerpts:

### Sequenced-before

> Within a single goroutine, the happens-before relation is the order expressed by the program. A read r of v is allowed to observe a write w to v if both of the following hold:
> 
> - r does not happen-before w.
> - There is no other write w' to v that happens-after w and happens-before r.

### Synchronization

> The following operations on memory establish a happens-before relationship between memory operations made by different goroutines.

### `go` statement

> The `go` statement that starts a new goroutine is synchronized before the start of the goroutine's execution.

### Channel communication

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.
> 
> The closing of a channel is synchronized before a receive that returns because the channel is closed.
> 
> A receive from an unbuffered channel is synchronized before the completion of the corresponding send on that channel.
> 
> The kth receive on a channel with capacity C is synchronized before the completion of the (k+C)th send from that channel.

### Locks

> For any `sync.Mutex` or `sync.RWMutex` variable `l` and n < m, call n of `l.Unlock()` is synchronized before call m of `l.Lock()` returns.
> 
> For any call to `l.RLock` on a `sync.RWMutex` variable `l`, there is an n such that the n'th call to `l.Unlock` is synchronized before the return of `l.RLock`, and the matching call to `l.RUnlock` is synchronized before the return of call n+1 to `l.Lock`.

### Once

> A single call of `f()` from `once.Do(f)` is synchronized before the return of any call of `once.Do(f)`.

### Atomic operations

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

This last paragraph is the key: Go's atomics are sequentially consistent.

## `sync/atomic` Package Documentation

From https://pkg.go.dev/sync/atomic:

> Package atomic provides low-level atomic memory primitives useful for implementing synchronization algorithms.
> 
> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package.

### Types

```go
type Bool struct { ... }
type Int32 struct { ... }
type Int64 struct { ... }
type Uint32 struct { ... }
type Uint64 struct { ... }
type Uintptr struct { ... }
type Pointer[T any] struct { ... }
type Value struct { ... }
```

Each has methods:
- `Load() T`
- `Store(val T)`
- `Swap(new T) (old T)`
- `CompareAndSwap(old, new T) (swapped bool)`
- `Add(delta T) (new T)` (numeric types only)

### Function forms (legacy)

```go
func LoadInt32(addr *int32) (val int32)
func StoreInt32(addr *int32, val int32)
func AddInt32(addr *int32, delta int32) (new int32)
func SwapInt32(addr *int32, new int32) (old int32)
func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
// ... and Int64, Uint32, Uint64, Uintptr, Pointer variants
```

These predate the struct types and are still supported. New code should prefer the struct wrappers for type safety and alignment guarantees.

## `sync` Package Documentation

### Mutex

```go
type Mutex struct {
    // unexported fields
}

func (m *Mutex) Lock()
func (m *Mutex) Unlock()
func (m *Mutex) TryLock() bool
```

> A Mutex is a mutual exclusion lock. The zero value for a Mutex is an unlocked mutex.
> 
> A Mutex must not be copied after first use.

### RWMutex

```go
type RWMutex struct {
    // unexported fields
}

func (rw *RWMutex) Lock()
func (rw *RWMutex) Unlock()
func (rw *RWMutex) RLock()
func (rw *RWMutex) RUnlock()
func (rw *RWMutex) TryLock() bool
func (rw *RWMutex) TryRLock() bool
func (rw *RWMutex) RLocker() Locker
```

> A RWMutex is a reader/writer mutual exclusion lock. The lock can be held by an arbitrary number of readers or a single writer. The zero value for a RWMutex is an unlocked mutex.

### Once

```go
type Once struct {
    // unexported fields
}

func (o *Once) Do(f func())
```

> Once is an object that will perform exactly one action.
> 
> A Once must not be copied after first use.

Helpers (Go 1.21+):

```go
func OnceFunc(f func()) func()
func OnceValue[T any](f func() T) func() T
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

### WaitGroup

```go
type WaitGroup struct {
    // unexported fields
}

func (wg *WaitGroup) Add(delta int)
func (wg *WaitGroup) Done()
func (wg *WaitGroup) Wait()
```

> A WaitGroup waits for a collection of goroutines to finish. The main goroutine calls Add to set the number of goroutines to wait for. Then each of the goroutines runs and calls Done when finished. At the same time, Wait can be used to block until all goroutines have finished.

### Cond

```go
type Cond struct {
    L Locker
    // unexported fields
}

func NewCond(l Locker) *Cond
func (c *Cond) Broadcast()
func (c *Cond) Signal()
func (c *Cond) Wait()
```

### Map

```go
type Map struct {
    // unexported fields
}

func (m *Map) Load(key any) (value any, ok bool)
func (m *Map) Store(key, value any)
func (m *Map) LoadOrStore(key, value any) (actual any, loaded bool)
func (m *Map) LoadAndDelete(key any) (value any, loaded bool)
func (m *Map) Delete(key any)
func (m *Map) Swap(key, value any) (previous any, loaded bool)
func (m *Map) CompareAndSwap(key, old, new any) bool
func (m *Map) CompareAndDelete(key, old any) (deleted bool)
func (m *Map) Range(f func(key, value any) bool)
```

> The Map type is optimized for two common use cases: (1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys.

### Pool

```go
type Pool struct {
    New func() any
    // unexported fields
}

func (p *Pool) Get() any
func (p *Pool) Put(x any)
```

> A Pool is a set of temporary objects that may be individually saved and retrieved.
> 
> Any item stored in the Pool may be removed automatically at any time without notification.

## Channel Operations Specification

From the Go language spec (https://go.dev/ref/spec):

> A new, initialized channel value can be made using the built-in function make. If a non-zero capacity is provided, make initializes a buffered channel with that capacity. Otherwise, the channel is unbuffered.

Channel operations:

- `ch <- v`: send v on channel ch.
- `<-ch`: receive from channel ch.
- `close(ch)`: close channel ch.
- `cap(ch)`: channel capacity.
- `len(ch)`: number of elements currently in the channel buffer.

> Sends and receives are blocking operations.
> 
> The capacity, in number of elements, sets the size of the buffer in the channel. If the capacity is zero or absent, the channel is unbuffered and communication succeeds only when both a sender and receiver are ready.
> 
> A receive from a closed channel always succeeds, returning the element type's zero value after any previously sent values have been received.
> 
> Sending to or closing a closed channel causes a run-time panic.

## DRF-SC Theorem

The theoretical foundation of Go's memory model:

> Theorem (DRF-SC): If a program has no data races under sequential consistency, then it has no data races under any weaker memory model.

This justifies the design: write race-free code (using the synchronization primitives above), and the program behaves as if it were sequentially consistent.

## Race Detector Behavior

`go run -race` instruments memory accesses. The runtime tracks happens-before via vector clocks. When two accesses to the same memory location are unsynchronized and at least one is a write, the detector reports a data race.

Notes:
- The race detector is *complete* but not *sound*: every reported race is real, but it may miss races that don't occur in this run.
- Run with `-count=N` to repeat tests N times for better coverage.
- The race detector overhead is approximately 5-10x in time and 2-5x in memory.

## Related Specifications

- C++11/14/17/20 standard, [intro.races] and [atomics] sections.
- Rust reference, memory model chapter.
- Java Memory Model (JSR-133).
- Linux kernel memory model (KCM).

These specify memory ordering in their respective languages. Go's model is closest to "DRF-SC for atomics with sequential consistency."

## Summary

The Go memory model is short, precise, and pragmatic:

- Synchronization primitives establish happens-before.
- Atomic operations are sequentially consistent.
- Data races are undefined behavior.
- The race detector finds most violations in tests.

Read the official memory model document carefully. The text is dense but every sentence matters.

End of specification.md.

---

## Appendix A: Side-by-Side Comparison with C++

C++ memory_order values and Go equivalents:

| C++ | Go equivalent |
|-----|---------------|
| `memory_order_relaxed` | Not exposed; closest is plain access (unsafe) |
| `memory_order_acquire` (load) | `atomic.Load` (Go provides seq-cst, which is stronger) |
| `memory_order_release` (store) | `atomic.Store` (Go provides seq-cst, which is stronger) |
| `memory_order_acq_rel` (RMW) | `atomic.Add`, `atomic.Swap`, `atomic.CompareAndSwap` (also seq-cst) |
| `memory_order_seq_cst` | All Go atomics |
| `memory_order_consume` | Not in any practical implementation |

Go's "stronger by default" approach trades a few nanoseconds for simplicity.

---

## Appendix B: Side-by-Side with Rust

Rust's `Ordering` enum maps almost identically to C++:

| Rust | Go equivalent |
|------|---------------|
| `Ordering::Relaxed` | Not exposed |
| `Ordering::Acquire` | `atomic.Load` (seq-cst) |
| `Ordering::Release` | `atomic.Store` (seq-cst) |
| `Ordering::AcqRel` | RMW atomics (seq-cst) |
| `Ordering::SeqCst` | All Go atomics |

---

## Appendix C: Java Comparison

| Java | Go equivalent |
|------|---------------|
| `volatile` read | `atomic.Load` |
| `volatile` write | `atomic.Store` |
| `synchronized` block | `sync.Mutex` |
| `AtomicInteger.compareAndSet` | `atomic.CompareAndSwap` |
| `final` field after constructor | implicit; Go has no special rule, but post-construction writes need synchronization |

Java's "all volatiles share a global order" matches Go's seq-cst for atomics.

---

## Appendix D: The Race Detector's Algorithm

Race detection is based on vector clocks:

- Each goroutine has a logical clock.
- Each memory location tracks the clock of its last access by each goroutine.
- Synchronization operations (Send, Lock, Atomic, etc.) merge clocks across goroutines.
- A read is racy if it doesn't happen-after all previous writes (by clock comparison).

The implementation is in `runtime/race/`. The Go runtime is instrumented to call into a C library (`compiler-rt`'s TSan) at every memory access.

Cost: ~5-10x slower, ~2-5x memory. Acceptable for tests, not production.

---

## Appendix E: Memory Model Examples from the Spec

### Example 1: incorrect synchronization

```go
var a string
var done bool

func setup() {
    a = "hello"
    done = true
}

func main() {
    go setup()
    for !done {
    }
    print(a)
}
```

> Not guaranteed to observe `a = "hello"` or even the write to `done`. Without synchronization, the compiler may not write to `a` or `done` at all in setup or before reading them in main.

This is the canonical broken-publication example.

### Example 2: correct synchronization

```go
var a string
var once sync.Once

func setup() {
    a = "hello"
}

func doprint() {
    once.Do(setup)
    print(a)
}

func twoprint() {
    go doprint()
    go doprint()
}
```

> Calling `twoprint` will print "hello" twice. The first call to `doprint` will run `setup` once. Both calls to `doprint` happen-after the call to `setup` because of `once.Do`'s happens-before guarantee.

---

## Appendix F: Atomic Operations on Aligned Types

From the `sync/atomic` documentation:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically via the primitive atomic functions (types Int64 and Uint64 are automatically aligned). The first word in an allocated struct, array, or slice; in a global variable; or in a local variable (because the subject of all atomic operations will escape to the heap) can be relied upon to be 64-bit aligned.

This is why `atomic.Int64`, `atomic.Uint64`, and `atomic.Pointer[T]` are struct wrappers — to guarantee alignment.

---

## Appendix G: Channel Operations and Memory Order

| Operation | Memory order |
|-----------|--------------|
| `ch <- v` (send) | Release fence on completion |
| `<-ch` (receive) | Acquire fence on completion |
| `close(ch)` | Release fence on completion |
| `select` with cases | Acquire/release based on which case fires |

For unbuffered channels, send and receive synchronize directly. For buffered, the k-th send happens-before the k-th receive completes.

---

## Appendix H: Compiler Reordering Constraints

The Go compiler may not reorder operations across:

- Function calls (in general).
- Atomic operations (they are compiler barriers).
- Mutex Lock/Unlock.
- Channel send/receive.
- `volatile`-like access (Go doesn't have volatile; uses atomics).

The compiler may reorder:

- Within a single basic block, respecting data dependencies.
- Across function calls if the compiler can prove safety (inlining).
- Loop-invariant code out of loops.

Atomics serve dual purpose: synchronization + compiler barrier.

---

## Appendix I: Hardware Reordering Constraints

On x86 (TSO):
- Reads can be reordered with younger writes to different addresses.
- Writes are not reordered with younger reads (sometimes).
- Atomic ops are full barriers.

On ARM (weak):
- Most reorderings allowed.
- Explicit fences required for ordering.
- LDAR/STLR provide acquire/release.

Go emits the right barriers per architecture, hiding this complexity.

---

## Appendix J: Closing

This specification file documents the formal contracts. For practical guidance, read junior through professional. For the canonical text, read https://go.dev/ref/mem.

End.

---

## Appendix K: Pre-2022 Memory Model Notes

The original Go memory model (2009-2022) was less precise. The 2022 revision added:

- Explicit happens-before axioms.
- Clarification that atomics are sequentially consistent.
- Notes on race detector semantics.
- Examples of broken vs. correct synchronization.

If you encounter older Go literature, be aware that some details may have changed. The core ideas — synchronization establishes happens-before, races are undefined — have been stable.

## Appendix L: Go 1.19+ Changes

Go 1.19 added typed atomics:

```go
var x atomic.Int32
x.Store(1)
```

vs. the old:

```go
var x int32
atomic.StoreInt32(&x, 1)
```

The typed forms are type-safe and align correctly. The function forms remain for backward compatibility.

Go 1.19 also clarified the memory model around alignment: typed atomics guarantee alignment automatically.

Go 1.21 added `sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues`.

## Appendix M: Future Changes

Possible future additions:

- Explicit memory orderings (relaxed, acq-rel) — debated but not adopted.
- Better runtime support for NUMA — opaque to user code.
- More wait-free types in the standard library.

The Go memory model is unlikely to change radically. The current form has held up well under real-world scrutiny.

## Appendix N: Authoritative References

- The Go memory model: https://go.dev/ref/mem
- The Go language specification: https://go.dev/ref/spec
- The `sync` package: https://pkg.go.dev/sync
- The `sync/atomic` package: https://pkg.go.dev/sync/atomic

When in doubt, consult these. They are the source of truth.

## Appendix O: Excerpt — The Original Russ Cox Memory Model Paper

From "Programming Language Memory Models" (2021):

> Go's memory model is a hybrid: it provides sequential consistency for atomic operations, but undefined behavior for races on non-atomic operations.
> 
> This puts Go between C++/Rust (which have full memory_order vocabulary) and Java (which has well-defined behavior for races).
> 
> The trade-off favors simplicity: programmers don't need to choose orderings, and the race detector enforces the DRF assumption.

This summary captures the design philosophy concisely.

## Appendix P: Excerpt — Hardware Memory Models

From "Hardware Memory Models" (2021):

> x86 has TSO (Total Store Order): writes by a single core appear in order to other cores, but writes by different cores may be observed in different orders by different observers (unless full barriers are used).
> 
> ARM has a much weaker model: writes by a single core can be observed in different orders by different observers without explicit barriers.
> 
> The Go runtime emits the appropriate barriers per architecture to provide sequential consistency for atomics.

This is the foundation for understanding why atomic costs vary by architecture.

## Appendix Q: Closing

This specification file is intended as a reference. For tutorial content, see junior/middle/senior/professional. For exercises, see tasks. For interview prep, see interview.

---

## Appendix R: Cross-Reference Index

Cross-references to other files in this subsection:

- For "what does it mean to publish?": junior.md.
- For real-world patterns: middle.md.
- For formal happens-before reasoning: senior.md.
- For runtime internals: professional.md.
- For exercises: tasks.md.
- For interview prep: interview.md.
- For bug-finding: find-bug.md.
- For optimization: optimize.md.

This spec file is the canonical reference for the formal contracts.

---

## Appendix S: Errata for Older Documents

Older Go documentation occasionally contains imprecise statements. Notable corrections from the 2022 revision:

1. "Atomic operations behave as ordinary reads/writes" — incorrect; they are sequentially consistent.
2. "The race detector is exhaustive" — incorrect; it only finds races that actually occur.
3. "Channel close is a fence" — true but imprecise; it's a release synchronized with each receive.

If you find conflicting statements, trust https://go.dev/ref/mem.

## Appendix T: A Final Note

This file is intentionally short. The tutorials are in junior/middle/senior/professional. This file is the dry, factual reference — the kind you check when reviewing a PR or writing a memo.

For learning, read the tutorials. For citing, link to https://go.dev/ref/mem. For practice, read source code.

## Appendix U: A Reminder

Specifications are static; understanding is dynamic. Read this file periodically, but invest your time in writing concurrent code, debugging it, and explaining it to others.

The specification is the floor of correctness. Your code aspires to that floor and beyond.

## Appendix V: One Last Quote

From the Go memory model:

> Programs that modify data being simultaneously accessed by multiple goroutines must serialize such access. To serialize access, protect the data with channel operations or other synchronization primitives such as those in the sync and sync/atomic packages.

This is the entire contract, in one sentence.

Read that sentence twice. Commit it. Apply it.

End.






