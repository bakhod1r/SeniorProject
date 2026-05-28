# `sync` and `sync/atomic` — Specification

## 1. Introduction

The `sync` package is part of the Go standard library and is governed by the [Go 1 compatibility promise](https://go.dev/doc/go1compat). Once a type or function ships in `sync` it cannot be renamed, removed, or have its signature changed within the Go 1 release line; new behaviour arrives by adding new types (`OnceValue`, `OnceFunc`) or new methods, never by altering the existing surface. The package provides the low-level concurrency primitives — mutual exclusion, one-shot initialisation, broadcast signalling, latch-style wait groups, a concurrent map, and a transient object pool — that nearly every other concurrent Go library is built on top of.

The behaviour of these primitives is not defined by their implementations alone. The [Go memory model](https://go.dev/ref/mem), revised in 2022 to align with the published C/C++ and Java memory models, is the authoritative document for what guarantees `sync` and `sync/atomic` provide. The memory model defines a partial order called "happens-before" over events in concurrent goroutines; `sync` operations are listed as the synchronisation events that establish this order. Reading `sync`'s source without first reading the memory model produces a working but incomplete understanding: the code shows what the primitives do mechanically, the memory model shows what the language promises to user programs that use them.

The companion `sync/atomic` package provides lock-free primitive operations on integer and pointer types. It is the foundation on which most of `sync` is implemented internally — `Mutex`, `Once`, `WaitGroup`, and `Pool` all use atomic operations on their internal state — and it is also the public surface a senior Go programmer reaches for when a mutex would be overkill. Like `sync`, `sync/atomic` is governed by Go 1 compatibility, and its types and operations are catalogued in the memory model as synchronisation events.

This specification is the authoritative-source map for senior code reading: which source files define what, which proposals introduced which features, what each contract guarantees and forbids, and where the runtime bridge ties `sync` into the Go scheduler.

---

## 2. The Go memory model and `sync`

The [Go memory model](https://go.dev/ref/mem) defines, for two goroutines `g1` and `g2`, when a read in `g2` is guaranteed to observe a write in `g1`. The model is built around the "synchronised before" relation, which is a strict partial order on synchronising events; "happens-before" is the transitive closure of "synchronised before" combined with sequenced-before (program order within a single goroutine).

The 2022 revision aligned Go with the sequentially consistent atomics model used by C/C++ and Java. Before the revision, the documentation was informal and ambiguous about racing reads; the revision made the guarantees precise and added explicit text for `sync/atomic` operations.

`sync` and `sync/atomic` are the language's synchronisation events. The memory model lists them by name:

| Synchronisation event | Happens-before guarantee |
|------------------------|--------------------------|
| Channel send / receive | The send happens before the corresponding receive completes. Receive on a closed channel happens after the close. |
| `Mutex.Unlock` / next `Lock` | The `n`-th call to `Unlock` on a mutex `m` happens before the `(n+1)`-th call to `Lock` on `m` returns. |
| `RWMutex.Unlock` / next `RLock` or `Lock` | `Unlock` happens before any subsequent `Lock`. `RUnlock` happens before any subsequent `Lock` that observes the read lock being released. |
| `Once.Do(f)` | The single call to `f` happens before any other `Do(f)` call returns. |
| `WaitGroup.Done` / `Wait` | All `Done` calls happen before any `Wait` that observes the counter at zero returns. |
| `atomic` operations | A successful `CompareAndSwap`, `Store`, or `Add` synchronises with a subsequent `Load` that observes its result, on the same address. |
| `Map.Store` / `Load`, `LoadOrStore`, `LoadAndDelete` | A store of a key happens before a load that observes it. |

These guarantees are the contract `sync` exists to provide. The implementations in `src/sync/*.go` realise them on top of the runtime scheduler and `sync/atomic` operations.

The 2022 revision introduced four important precisions over the original text:

1. **Atomic operations are sequentially consistent.** The model previously left the ordering of atomic operations across multiple addresses unspecified; the revision pins it down. A `Store` to address A followed in program order by a `Store` to address B is observed in that order by any goroutine that sees both.
2. **Racy reads of word-sized values may return unrelated values.** Before the revision, the documentation hinted that a racy read of an `int` might tear or might return the old or new value; the revision states explicitly that a data race may produce a value not equal to any prior write — torn reads are permitted, and undefined behaviour is the right mental model.
3. **`sync` primitives are happens-before sources.** The revision enumerates `Mutex`, `RWMutex`, `WaitGroup`, `Once`, channel send/receive, and atomic operations as the synchronisation events; nothing else (e.g., `time.Sleep`, `runtime.Gosched`) provides happens-before.
4. **Compiler reordering is permitted within the relation's limits.** The compiler may reorder reads and writes within a goroutine as long as the observable behaviour respects program order; across goroutines, reordering is constrained only by synchronisation events.

This is the framework against which `sync` source code should be read: every atomic operation in `mutex.go` or `waitgroup.go` exists to produce, or to observe, a synchronisation event listed above.

---

## 3. Stable types in `sync`

| Type | Purpose | Introduced |
|------|---------|------------|
| `Mutex` | Mutual exclusion; non-reentrant. | Go 1.0 |
| `RWMutex` | Reader/writer mutex; many readers or one writer. | Go 1.0 |
| `WaitGroup` | Counter-based barrier for goroutine completion. | Go 1.0 |
| `Once` | Exactly-once initialisation; `Do(f func())`. | Go 1.0 |
| `Cond` | Condition variable; `Wait`, `Signal`, `Broadcast`; requires an external `Locker`. | Go 1.0 |
| `Pool` | Per-P transient object cache; items may be cleared at any GC. | Go 1.3 |
| `Map` | Concurrent map optimised for read-mostly workloads. | Go 1.9 |
| `Locker` | Interface with `Lock()` and `Unlock()`; satisfied by `*Mutex`, `*RWMutex`, and the `Locker()` of `*RWMutex`. | Go 1.0 |
| `OnceValue[T]` | One-shot computation that returns and caches a typed value. | Go 1.21 |
| `OnceFunc` | One-shot wrapper for a `func()`; subsequent calls re-panic if the first panicked. | Go 1.21 |
| `OnceValues[T1, T2]` | One-shot computation returning two values. | Go 1.21 |

Source: [`src/sync/`](https://github.com/golang/go/tree/master/src/sync) in the Go repository.

---

## 4. The `sync/atomic` package

The `sync/atomic` package provides lock-free operations on a fixed set of integer, pointer, and boolean types. Operations are guaranteed to be atomic with respect to other goroutines; the memory model promises sequential consistency for these operations across the whole program.

### 4.1 Wrapper types (Go 1.19+)

| Type | Backing storage | Notes |
|------|-----------------|-------|
| `atomic.Int32` | `int32` | Methods: `Load`, `Store`, `Add`, `Swap`, `CompareAndSwap`. |
| `atomic.Int64` | `int64` | Same method set. On 32-bit ARM and 386, alignment is required; the wrapper type enforces it via field layout. |
| `atomic.Uint32` | `uint32` | Same method set; arithmetic wraps. |
| `atomic.Uint64` | `uint64` | Same method set; same alignment caveat as `Int64`. |
| `atomic.Uintptr` | `uintptr` | Same method set; used for opaque address-sized values. |
| `atomic.Pointer[T]` | `*T` | Generic typed pointer (Go 1.19). Methods: `Load`, `Store`, `Swap`, `CompareAndSwap`. |
| `atomic.Bool` | `uint32` internally | Methods: `Load`, `Store`, `Swap`, `CompareAndSwap`. |
| `atomic.Value` | `any` via `unsafe.Pointer` | Methods: `Load`, `Store`, `Swap` (1.17), `CompareAndSwap` (1.17). Stored values must be of consistent concrete type after the first `Store`. |

### 4.2 Free function operations (legacy, Go 1.0+)

The original package surface was free functions on pointer arguments — `atomic.AddInt32(addr *int32, delta int32) int32`, `atomic.LoadInt64(addr *int64) int64`, `atomic.CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) bool`, and so on. These remain supported under Go 1 compatibility but the wrapper types (4.1) are the recommended surface for new code; the wrappers eliminate alignment bugs on 32-bit platforms and present a more type-safe API.

### 4.3 Operations

| Operation | Semantics |
|-----------|-----------|
| `Load` | Atomically read the current value. |
| `Store` | Atomically write a new value. |
| `Add` | Atomically add a delta and return the new value (integer types only). |
| `Swap` | Atomically write a new value and return the previous one. |
| `CompareAndSwap` | Atomically compare with the expected value and write the new value only if equal; returns whether the swap occurred. |

Source: [`src/sync/atomic/`](https://github.com/golang/go/tree/master/src/sync/atomic) — `doc.go`, `value.go`, `type.go`, and the architecture-specific `asm_*.s` files.

### 4.4 Memory ordering of atomic operations

The [memory model](https://go.dev/ref/mem#atomic) makes `sync/atomic` operations sequentially consistent: a total order exists over all atomic operations in the program, consistent with each goroutine's program order, and every goroutine observes that order. This is the strongest possible ordering and is more restrictive than the acquire/release semantics of C/C++ `memory_order_acquire` and `memory_order_release`.

The practical consequences:

- A `Store` is a release operation with respect to all prior writes in the same goroutine; a subsequent `Load` on the same address from another goroutine that observes the stored value is an acquire operation that sees all those prior writes.
- A `CompareAndSwap` that succeeds is both an acquire and a release; the failed case is a load that still participates in the total order.
- `Add` is a read-modify-write that is atomic and ordered with respect to all other atomic operations.

There is no relaxed-ordering form of these operations in `sync/atomic`. Programs that want weaker ordering have no portable way to express it; the language designers chose the strong default deliberately, on the grounds that the cost of sequential consistency is small in practice and the cognitive cost of weaker ordering is large.

### 4.5 Alignment on 32-bit platforms

The free-function 64-bit operations (`AddInt64`, `LoadInt64`, `StoreInt64`, `CompareAndSwapInt64`, `SwapInt64`) require their argument to be 8-byte aligned on 32-bit platforms. The package documentation states: "On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned."

The `atomic.Int64` and `atomic.Uint64` wrapper types (Go 1.19+) include a no-op field that forces correct alignment, eliminating this footgun for code that adopts the typed wrappers.

---

## 5. The `Mutex` contract

`sync.Mutex` is a non-reentrant mutual-exclusion lock with the following formal contract:

| Rule | Source |
|------|--------|
| Zero value is a valid unlocked mutex. | [`mutex.go`](https://github.com/golang/go/blob/master/src/sync/mutex.go) doc comment. |
| `Lock` blocks until the mutex is acquired. | Same. |
| `Unlock` of an unlocked mutex is a run-time error. | Same; enforced by `throw("sync: unlock of unlocked mutex")`. |
| A locked mutex is not associated with a particular goroutine — any goroutine may call `Unlock`. | Same; relied on by some pipeline patterns but discouraged. |
| A `Mutex` must not be copied after first use. | [`go vet`](https://pkg.go.dev/cmd/vet) `-copylocks` check; documented in `mutex.go`. |
| The `Mutex` API is `Lock`, `Unlock`, `TryLock` (since Go 1.18). | `mutex.go`. |

`TryLock` was added in Go 1.18 ([proposal #45435](https://github.com/golang/go/issues/45435)) after a long debate; the documentation notes that "correct use of TryLock exists but is rare" and that most usages indicate a design problem.

`Mutex` has two implementation phases internally: a fast path written in inline atomic operations and a slow path that parks goroutines via the runtime scheduler. The slow path uses [`runtime_SemacquireMutex`](https://github.com/golang/go/blob/master/src/runtime/sema.go) and [`runtime_Semrelease`](https://github.com/golang/go/blob/master/src/runtime/sema.go) which are linknamed from `sync` into the runtime.

The implementation has two operating modes, switched between dynamically since Go 1.9:

| Mode | Behaviour |
|------|-----------|
| Normal | New `Lock` callers may attempt to acquire the mutex immediately, bypassing the queue of parked waiters; this maximises throughput. A spinning fast path runs `runtime_canSpin` and `runtime_doSpin` before parking. |
| Starvation | If a waiter has been waiting more than 1 ms, the mutex switches to starvation mode: ownership is handed directly from the unlocker to the waiter at the front of the queue, and new arrivals queue at the tail rather than racing. The mode reverts to Normal when the queue is empty or when the next acquirer's wait would be brief. |

These modes are not visible in the public API and are not part of the contract; they are implementation choices that satisfy the documented semantics while preventing pathological tail latency. Source comments in [`mutex.go`](https://github.com/golang/go/blob/master/src/sync/mutex.go) discuss the rationale.

---

## 6. The `RWMutex` contract

`sync.RWMutex` distinguishes readers from writers. The contract:

| Rule | Source |
|------|--------|
| Zero value is a valid unlocked RWMutex. | [`rwmutex.go`](https://github.com/golang/go/blob/master/src/sync/rwmutex.go). |
| `RLock` permits any number of concurrent readers when no writer holds the lock. | Same. |
| `Lock` is exclusive: no other readers or writers may hold the lock during a write hold. | Same. |
| The lock is writer-preferring: once a writer is waiting, new readers block. This prevents writer starvation but permits reader starvation under continuous write pressure. | Same; documented as "If a goroutine holds a `RWMutex` for reading and another goroutine might call `Lock`, no goroutine should expect to be able to acquire a read lock until the initial read lock is released." |
| `RUnlock` of an unlocked mutex is a run-time error. | Same. |
| The `Locker()` method returns a `Locker` whose `Lock` and `Unlock` call `RLock` and `RUnlock`; useful for plugging an `RWMutex` into APIs that take a `Locker`. | `rwmutex.go`. |
| Recursive read locking is forbidden. A goroutine that calls `RLock` and then `Lock` (or another `RLock` while a writer is waiting) deadlocks. | Same. |
| `TryLock` and `TryRLock` were added in Go 1.18. | [proposal #45435](https://github.com/golang/go/issues/45435). |

The internal implementation uses a `Mutex` plus atomic counters; the writer-preferring semantics are realised by incrementing a "writer waiting" counter that subsequent `RLock` calls observe and respect.

---

## 7. The `WaitGroup` contract

`sync.WaitGroup` provides a counter-based barrier. The contract:

| Rule | Source |
|------|--------|
| Zero value is a valid empty WaitGroup. | [`waitgroup.go`](https://github.com/golang/go/blob/master/src/sync/waitgroup.go). |
| `Add(delta)` adjusts the counter; `delta` may be negative. | Same. |
| `Done` is equivalent to `Add(-1)`. | Same. |
| `Wait` blocks until the counter is zero. | Same. |
| A negative counter value at any point is a run-time error: `panic("sync: negative WaitGroup counter")`. | Same. |
| Calls to `Add` with a positive delta must happen-before the corresponding `Wait`. | Same; the canonical formulation is "Add must be called before Wait, never after, never concurrently with a transition through zero." |
| `Wait` and `Add` must not run concurrently with a transition of the counter from non-zero to zero. | Same; enforced by a panic if reuse is detected before all waiters return. |
| `WaitGroup` must not be copied after first use. | `go vet -copylocks` check. |

The implementation packs the counter and waiter count into a single 64-bit value, manipulated by `atomic.CompareAndSwap`. The runtime hooks `runtime_Semacquire` and `runtime_Semrelease` park and unpark waiters.

---

## 8. The `Once` contract

`sync.Once` provides exactly-once execution of a function:

| Rule | Source |
|------|--------|
| Zero value is a fresh, undone Once. | [`once.go`](https://github.com/golang/go/blob/master/src/sync/once.go). |
| `Do(f)` runs `f` if and only if it is the first call on this Once instance to enter `Do`. | Same. |
| The call to `f` happens-before any other `Do` call on the same Once returns. | [Memory model](https://go.dev/ref/mem#once). |
| If `f` panics, the Once is considered "done"; subsequent `Do` calls do not run `f` and return immediately. The panic propagates out of the call that ran `f`. | `once.go`. |
| `Do(f)` does not invoke `f` if a previous call to `Do(g)` (with a possibly different function) has already run on this Once. The function argument is not the identity key — the Once itself is. | Same. |
| `Once` must not be copied after first use. | Same; `go vet -copylocks` check. |

The implementation is a tagged atomic — `done atomic.Uint32` plus a `Mutex` for the slow path. The fast path is a single `atomic.LoadUint32` followed by an early return when the bit is set.

---

## 9. The `Map` contract

`sync.Map` is a concurrent map optimised for two workloads: read-mostly with stable keys, and disjoint key sets across goroutines:

| Rule | Source |
|------|--------|
| Zero value is a valid empty map. | [`map.go`](https://github.com/golang/go/blob/master/src/sync/map.go). |
| `Load`, `Store`, `LoadOrStore`, `LoadAndDelete`, `Delete`, `Swap`, `CompareAndSwap`, `CompareAndDelete` are the operations. The last three were added in Go 1.20 ([proposal #51972](https://github.com/golang/go/issues/51972)). | Same. |
| `Range(f func(key, value any) bool)` calls `f` for each key/value present at some moment during the range. It is a snapshot view: keys added or removed during the range may or may not be visited; each visited pair reflects the value at the moment of visit. | Same. |
| `Range` does not block other operations. | Same. |
| The map is safe for concurrent use without external synchronisation. | Same. |
| The map's performance is worse than a `Mutex`-protected `map[K]V` for write-heavy workloads. The documentation explicitly calls this out: "Most code should use a plain Go map instead." | Same. |
| The map is not generic. Keys and values are `any`. Users must perform type assertions on retrieval. | Same. |

The internal design is a two-tier structure: a read-only atomic snapshot for cheap reads, and a dirty `map` protected by a `Mutex` for writes. When the dirty map accumulates enough writes the read snapshot is promoted. Source: [`src/sync/map.go`](https://github.com/golang/go/blob/master/src/sync/map.go).

---

## 10. The `Pool` contract

`sync.Pool` is a per-P transient cache for objects that can be reused:

| Rule | Source |
|------|--------|
| Zero value is an empty Pool with no `New` function. | [`pool.go`](https://github.com/golang/go/blob/master/src/sync/pool.go). |
| `Get` returns an arbitrary item from the pool, removing it; if the pool is empty, returns `New()` if `New` is set, else `nil`. | Same. |
| `Put` adds an item to the pool. | Same. |
| Items in the pool may be removed at any time without notification. In practice, the runtime clears the pool on each garbage collection cycle. | Same; the doc states "Any item stored in the Pool may be removed automatically at any time without notification." |
| `Pool` is safe for concurrent use. | Same. |
| `Pool` must not be copied after first use. | `go vet -copylocks` check. |
| `Pool` is not a general-purpose cache. Storing long-lived expensive-to-recompute values in a `Pool` is a bug; the value will be discarded at the next GC. | Documented antipattern; see the doc comment. |

The internal structure is per-P (one shard per scheduler P) plus a victim cache that survives one GC. Source: [`src/sync/pool.go`](https://github.com/golang/go/blob/master/src/sync/pool.go) and the runtime hook [`runtime_registerPoolCleanup`](https://github.com/golang/go/blob/master/src/runtime/mgc.go).

Per-P sharding is what makes `Pool` scale: a `Get` on P0 reads from P0's local shard with no contention against goroutines running on P1 through P_n. When the local shard is empty, the implementation steals from another P's shard before falling back to `New`. The victim cache, added in Go 1.13, holds the previous generation of pool items for one GC cycle; this smooths the cost of GC clearing for workloads with bursty allocation patterns. The Go 1.13 redesign is described in [CL 166961](https://go-review.googlesource.com/c/go/+/166961) and the accompanying issue [#22950](https://github.com/golang/go/issues/22950).

---

## 10a. The `Cond` contract

`sync.Cond` is a condition variable for goroutine coordination over a shared predicate:

| Rule | Source |
|------|--------|
| A `Cond` must be constructed with `sync.NewCond(l Locker)`; the zero value is not useful because `L` would be nil. | [`cond.go`](https://github.com/golang/go/blob/master/src/sync/cond.go). |
| The associated `Locker` (`Cond.L`) must be held when calling `Wait`. | Same. |
| `Wait` atomically unlocks `L` and parks the goroutine on a notification list; upon resumption, `L` is re-locked before `Wait` returns. | Same. |
| Spurious wakeups are not specified to occur, but callers must re-check the predicate in a loop. The standard pattern is `for !condition() { c.Wait() }`. | Same; explicitly documented. |
| `Signal` wakes one waiter, if any; `Broadcast` wakes all waiters. Neither requires holding `L`. | Same. |
| `Cond` must not be copied after first use. | `go vet -copylocks` check. |
| `Cond` is implemented over `runtime.notifyList`; the same primitive that backs `WaitGroup`'s wait queue. | [`runtime2.go`](https://github.com/golang/go/blob/master/src/sync/runtime2.go) and [`runtime/sema.go`](https://github.com/golang/go/blob/master/src/runtime/sema.go). |

The package documentation notes that "in most cases" channels are a better fit than `Cond`; the type exists for the cases where a channel cannot express the predicate-and-broadcast pattern cleanly.

## 10b. The `Locker` interface

`sync.Locker` is the smallest possible interface for a mutex-like type:

```go
type Locker interface {
    Lock()
    Unlock()
}
```

It is satisfied by `*Mutex` and `*RWMutex` directly, and by the value returned by `(*RWMutex).RLocker()` which produces a `Locker` whose `Lock` calls the underlying `RLock`. The interface exists primarily as the argument type for `sync.NewCond`; secondarily, it lets callers parameterise code over the choice of mutex implementation. Custom implementations of `Locker` are permitted and used by some libraries (timed-out locks, instrumented locks) but are rare.

---

## 11. The runtime bridge

`sync` is unusual in the standard library: it reaches into the runtime via `go:linkname` to use scheduler primitives that are not exported as a stable API. The bridge lives in [`src/sync/runtime.go`](https://github.com/golang/go/blob/master/src/sync/runtime.go) and declares function signatures whose bodies live in the runtime package.

| Linknamed function | Runtime implementation | Purpose |
|--------------------|-------------------------|---------|
| `runtime_SemacquireMutex` | `runtime.semacquire1` | Park a goroutine waiting on a mutex. |
| `runtime_Semrelease` | `runtime.semrelease` | Wake one waiter parked on a semaphore. |
| `runtime_Semacquire` | `runtime.semacquire` | Generic park used by `WaitGroup` and `Cond`. |
| `runtime_notifyListAdd` / `notifyListWait` / `notifyListNotifyOne` / `notifyListNotifyAll` | `runtime.notifyListAdd` and friends | Underlying primitive of `sync.Cond`'s wait queue. |
| `runtime_canSpin` / `runtime_doSpin` | `runtime.sync_runtime_canSpin` / `procyield` | Adaptive spinning before parking; used in the fast paths of `Mutex` and `RWMutex`. |
| `runtime_registerPoolCleanup` | `runtime.poolCleanup` registration | Hook by which the GC drains `sync.Pool` victim caches at the start of each cycle. |
| `runtime_procPin` / `runtime_procUnpin` | `runtime.procPin` / `procUnpin` | Pin the current goroutine to its P so per-P pool shard access is race-free. |
| `runtime_LoadAcquintptr` / `runtime_StoreReluintptr` | runtime atomic helpers | Acquire/release semantics used in `Once` and `RWMutex`. |

These linknames are an internal protocol between `sync` and the runtime. They are not part of the Go 1 promise to user code — `go:linkname` to runtime symbols from outside the standard library is unsupported and warned against. The list itself is stable in practice across Go versions but is subject to change at any minor release.

---

## 12. Generics additions (Go 1.21+)

Go 1.21 ([release notes](https://go.dev/doc/go1.21#sync)) added typed one-shot helpers built on top of `Once`:

| Helper | Signature | Behaviour |
|--------|-----------|-----------|
| `OnceFunc` | `func OnceFunc(f func()) func()` | Returns a function that calls `f` at most once. If the first call panics, every subsequent call re-panics with the same value. |
| `OnceValue[T]` | `func OnceValue[T any](f func() T) func() T` | Returns a function that calls `f` at most once and caches the return. Subsequent calls return the cached `T` without invoking `f`. |
| `OnceValues[T1, T2]` | `func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)` | Two-value variant; common idiom for `(value, error)` initialisation. |

These functions replace the very common idiom:

```go
var (
    once  sync.Once
    value T
    err   error
)
func get() (T, error) {
    once.Do(func() { value, err = compute() })
    return value, err
}
```

with:

```go
var get = sync.OnceValues(compute)
```

The proposal is [#56102](https://github.com/golang/go/issues/56102). The implementation lives in [`src/sync/oncefunc.go`](https://github.com/golang/go/blob/master/src/sync/oncefunc.go).

---

## 13. Authoritative source files

| File | Contents |
|------|----------|
| [`src/sync/mutex.go`](https://github.com/golang/go/blob/master/src/sync/mutex.go) | `Mutex` and `TryLock`. |
| [`src/sync/rwmutex.go`](https://github.com/golang/go/blob/master/src/sync/rwmutex.go) | `RWMutex`, `RLocker`. |
| [`src/sync/waitgroup.go`](https://github.com/golang/go/blob/master/src/sync/waitgroup.go) | `WaitGroup`. |
| [`src/sync/once.go`](https://github.com/golang/go/blob/master/src/sync/once.go) | `Once`. |
| [`src/sync/oncefunc.go`](https://github.com/golang/go/blob/master/src/sync/oncefunc.go) | `OnceFunc`, `OnceValue`, `OnceValues`. |
| [`src/sync/cond.go`](https://github.com/golang/go/blob/master/src/sync/cond.go) | `Cond`. |
| [`src/sync/map.go`](https://github.com/golang/go/blob/master/src/sync/map.go) | `Map`. |
| [`src/sync/pool.go`](https://github.com/golang/go/blob/master/src/sync/pool.go) | `Pool` and its victim-cache machinery. |
| [`src/sync/runtime.go`](https://github.com/golang/go/blob/master/src/sync/runtime.go) | The linkname declarations bridging to the runtime. |
| [`src/sync/runtime2.go`](https://github.com/golang/go/blob/master/src/sync/runtime2.go) | `notifyList` struct definition shared with the runtime. |
| [`src/sync/atomic/doc.go`](https://github.com/golang/go/blob/master/src/sync/atomic/doc.go) | Documentation and free-function signatures. |
| [`src/sync/atomic/type.go`](https://github.com/golang/go/blob/master/src/sync/atomic/type.go) | `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Bool`, `Pointer[T]`. |
| [`src/sync/atomic/value.go`](https://github.com/golang/go/blob/master/src/sync/atomic/value.go) | `Value`. |
| [`src/sync/atomic/asm.s`](https://github.com/golang/go/blob/master/src/sync/atomic/asm.s) | Architecture-portable assembly stubs. |
| [`src/runtime/sema.go`](https://github.com/golang/go/blob/master/src/runtime/sema.go) | Semaphore implementation used by `Mutex`, `WaitGroup`, `Cond`. |

The full directory listing for [`src/sync/`](https://github.com/golang/go/tree/master/src/sync) and [`src/sync/atomic/`](https://github.com/golang/go/tree/master/src/sync/atomic) is the starting point for any source-reading session.

---

## 14. Compatibility scope

The [Go 1 compatibility document](https://go.dev/doc/go1compat) governs what may and may not change:

| Allowed | Forbidden |
|---------|-----------|
| Adding new exported types (`OnceValue`, `Pointer[T]`). | Removing or renaming existing exported types. |
| Adding new methods to existing types when the additions cannot affect existing code (`TryLock`). | Changing the signature of an existing exported method. |
| Performance improvements that preserve the documented contract. | Tightening or loosening the documented contract for an existing method. |
| Bug fixes that align behaviour with the documented contract. | Changes that would break a program relying on the documented behaviour. |
| Internal implementation changes (e.g., the 2017 `sync.Map` redesign). | Changes that would break a program that uses only documented behaviour. |

The package has remained source-compatible since Go 1.0 (March 2012). Notable additions:

- Go 1.3: `sync.Pool`.
- Go 1.9: `sync.Map`.
- Go 1.17: `atomic.Value.Swap`, `atomic.Value.CompareAndSwap`.
- Go 1.18: `Mutex.TryLock`, `RWMutex.TryLock`, `RWMutex.TryRLock`.
- Go 1.19: `atomic.Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`, `Bool`.
- Go 1.20: `Map.Swap`, `Map.CompareAndSwap`, `Map.CompareAndDelete`.
- Go 1.21: `OnceFunc`, `OnceValue`, `OnceValues`.

---

## 15. Notable proposals

| Proposal | Title | Outcome |
|----------|-------|---------|
| [#37142](https://github.com/golang/go/issues/37142) | sync: add Map.LoadAndDelete | Accepted; shipped in Go 1.15. |
| [#45435](https://github.com/golang/go/issues/45435) | sync: add Mutex.TryLock, RWMutex.TryLock, RWMutex.TryRLock | Accepted with reservations; shipped in Go 1.18. |
| [#50860](https://github.com/golang/go/issues/50860) | sync/atomic: add typed atomic values | Accepted; shipped as `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]`, `Bool` in Go 1.19. |
| [#51972](https://github.com/golang/go/issues/51972) | sync: add Map.Swap, CompareAndSwap, CompareAndDelete | Accepted; shipped in Go 1.20. |
| [#56102](https://github.com/golang/go/issues/56102) | sync: add OnceFunc, OnceValue, OnceValues | Accepted; shipped in Go 1.21. |
| [#47657](https://github.com/golang/go/issues/47657) | sync: add ShardedValue or similar per-CPU value | Open; under discussion as a possible Go 1.24+ addition. |
| [#44343](https://github.com/golang/go/issues/44343) | sync: typed sync.Map using generics | Declined for Go 1.18; revisited as `MapOf` proposals (#71076 and predecessors). |
| [#21155](https://github.com/golang/go/issues/21155) | sync: add Pool.Reset | Declined; the existing semantics already permit clearing. |

The historical proposal list for the `sync` package is at [pkgsite proposals view](https://github.com/golang/go/issues?q=is%3Aissue+label%3AProposal+sync%3A).

---

## 16. Bug reporting

Bugs in `sync` or `sync/atomic` are filed at [github.com/golang/go/issues](https://github.com/golang/go/issues) with the label `sync` (and `sync/atomic` as a sub-component label where applicable). The issue template asks for:

1. The Go version (`go version`).
2. The platform (`go env GOOS GOARCH`).
3. A minimal reproducer.
4. Expected and actual behaviour.

The package's maintainers are listed in [`CODEOWNERS`](https://github.com/golang/go/blob/master/CODEOWNERS) and historically include members of the runtime team. Security-relevant issues (a hypothetical lock-skipping bug, for example) are reported through [security@golang.org](https://go.dev/security/policy) rather than the public tracker.

The race detector (`go test -race`) is the first-line tool for diagnosing suspected `sync` misuse. The detector instruments memory accesses and reports any pair that are unordered by the memory-model relations defined above; a `sync` primitive used correctly should produce no race reports, and any report from `sync`-using code is either a bug in user code or, very rarely, a bug in `sync` itself.
