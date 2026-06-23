---
layout: default
title: sync.Once — Professional
parent: sync.Once
grand_parent: sync Package
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/professional/
---

# sync.Once — Professional Level

← Back to sync.Once

We open `src/sync/once.go` and walk through the actual implementation: the `done` flag, the atomic fast path, the mutex slow path, the double-check pattern, and the memory model proof that justifies the happens-before guarantee. References are to Go 1.22 source. The algorithm has been stable since Go 1.0; only the spelling of the atomic primitives has evolved.

---

## 1. The struct

The whole of `sync.Once` is a dozen lines:

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}
```

Two fields:

- **`done`** — a 32-bit atomic flag. `0` means "not yet run." `1` means "run completed." There are no other states.
- **`m`** — a `sync.Mutex` used on the slow path to serialise concurrent first-touch callers.

The struct is 24 bytes on 64-bit (`atomic.Uint32` is 4, `Mutex` is 8, plus alignment). It used to be declared as `done uint32` (a plain integer) accessed via `atomic.LoadUint32` and `atomic.StoreUint32`; the migration to `atomic.Uint32` is a type-system improvement only — the underlying machine instructions are identical.

A historical curiosity: pre-1.13 versions had a `done int32` placed *first* in the struct so that on 32-bit platforms the atomic load was naturally aligned. This is no longer required because the compiler aligns `atomic.Uint32` correctly by definition.

---

## 2. The `Do` method

The full implementation, with comments:

```go
func (o *Once) Do(f func()) {
    // Fast path: atomic load of `done`.
    // If it's 1, init has run; return immediately.
    if o.done.Load() == 0 {
        // Slow path
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    // Double-check after acquiring the mutex.
    // Another goroutine may have run f while we were blocked
    // on Lock(); if so, done is now 1 and we skip f.
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

That is the entire algorithm. Twelve lines, no surprises. Two things make it tick: the *fast path* on the hot side, and the *double-check* inside the slow path.

### 2.1 The fast path

```go
if o.done.Load() == 0 {
    o.doSlow(f)
}
```

After the first successful call, `done` is `1`. Every subsequent call:

1. Performs an atomic load of `done`. On amd64 this is a plain `MOV` plus an LFENCE that is essentially free.
2. Compares to zero. False — branch over.
3. Returns.

Total: ~2 nanoseconds on modern hardware. No mutex, no allocation. This is why `Once.Do` is cheap to call on the request path: after the first time, it costs as much as a single integer comparison.

### 2.2 The slow path

```go
func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

When the fast path observes `done == 0`, control falls through to `doSlow`. Three possibilities:

1. **First caller, no contention.** Takes the mutex, sees `done == 0`, runs `f`, the deferred `o.done.Store(1)` flips the flag, mutex released.
2. **Late caller, init already finished.** Takes the mutex (briefly contested with whoever held it last), sees `done == 1`, skips `f`, releases the mutex.
3. **Concurrent first-touch.** Many goroutines all see `done == 0` on the fast path and pile into `doSlow`. They queue on the mutex. The first one in runs `f` and sets `done`. The rest take the mutex in order, but their double-check `if o.done.Load() == 0` is now false, so they skip `f` and release.

The double-check is the *only* place that `f` is actually invoked. The fast path never calls `f`. The slow path only calls `f` if the post-mutex check confirms `done` is still zero.

### 2.3 Why the defer order matters

```go
defer o.m.Unlock()
if o.done.Load() == 0 {
    defer o.done.Store(1)
    f()
}
```

There are two deferred statements. They run in LIFO order:

1. `o.done.Store(1)` runs *first* — right after `f()` returns.
2. `o.m.Unlock()` runs *second* — after the store.

This means: the `done` flag is set *while we still hold the mutex*. Any concurrent caller waiting on the mutex will, after acquiring it, see `done == 1` and skip `f`. There is no window where `done` is `1` but the mutex is unlocked and a racer could observe an inconsistent state.

Also crucial: `o.done.Store(1)` is deferred so it runs *even if `f` panics*. This is what gives `Once` its "panic counts as done" semantics. A naive implementation that wrote `done = 1` only on the success path would re-run `f` after a panic — exactly what `Once` does not do.

---

## 3. Why the double-check?

The pattern of "load outside the lock, lock, load again, do work, store" is the **double-checked locking pattern**. It is famously broken in Java without `volatile` and broken in C++ without `std::atomic`. Why does it work in Go?

Two ingredients:

1. **The Go memory model**. The Go memory model defines `atomic.Uint32.Load` and `atomic.Uint32.Store` as sequentially consistent. The store-with-lock-held happens-before the load-after-lock-acquired in a different goroutine.
2. **The placement of the store inside the mutex**. The store is performed before unlocking, so its visibility is anchored to the mutex release. Any goroutine that subsequently acquires the mutex sees the store.

Without the atomic types, you would have data races on `done`. The fast path reads `done` without holding the mutex; if the store were a plain non-atomic write, the read would be a race. The Go race detector would flag this. By using `atomic.Uint32`, the read and write are synchronised at the language level, and the race detector is satisfied.

In other languages, the same pattern requires the equivalent of `std::atomic<bool>` with `memory_order_acquire`/`memory_order_release`. Go's atomics are conceptually sequentially consistent (stricter than acquire/release but on amd64 free; on arm64 a hair more expensive). Either way, the pattern is provably correct.

---

## 4. The memory model proof

Why does `Once` provide happens-before from `f`'s body to every later `Do` return?

Step by step:

1. Goroutine A enters `doSlow`, acquires the mutex.
2. A's `done.Load()` returns 0.
3. A executes `f`, including all its writes (call this set $W$).
4. A executes `defer o.done.Store(1)` — `done` is now 1.
5. A executes `defer o.m.Unlock()` — mutex released.
6. Goroutine B's fast path runs *later in real time*. B calls `done.Load()`, sees `1`.
7. B returns from `Do`.

The happens-before chain:

- $W$ happens-before `o.done.Store(1)` (within A, program order).
- `o.done.Store(1)` happens-before `o.m.Unlock()` (within A, program order, plus the mutex release barrier).
- `o.m.Unlock()` happens-before any later `o.m.Lock()` (mutex contract).
- `o.done.Store(1)` happens-before any later `o.done.Load()` that returns `1` (atomic synchronisation).

Therefore $W$ happens-before any later `Do` that observes `done == 1`. Including B's, which observed the store on the fast path *without taking the mutex*. The synchronisation comes from the atomic store/load pair alone.

This is the formal justification of "lazy singletons just work" with `sync.Once`. You can write to a global inside `Do`, and any reader who calls `Do` afterwards (even via the fast path, even without going near the mutex) sees the write.

---

## 5. Why not `atomic.Bool`?

`atomic.Bool` exists since Go 1.19. Why does `Once` use `atomic.Uint32`?

- **Historical inertia.** The original implementation used `uint32` with `atomic.LoadUint32`. `atomic.Bool` did not exist. Backward compatibility prevented a cosmetic switch.
- **No observable difference.** On every architecture Go supports, `atomic.Bool` and `atomic.Uint32` compile to the same instruction (a byte or word load and a memory barrier). The Uint32 form was already proven.
- **Future flexibility.** `Uint32` leaves room for additional states (currently unused) without an API break. `Bool` is binary by definition.

There is no significance to the choice; treat them as equivalent for `Once`'s purpose.

---

## 6. The Go 1.21 helpers — implementation

`sync.OnceFunc`, `OnceValue`, `OnceValues` are wrappers around a `sync.Once`. Their full source (simplified):

```go
func OnceFunc(f func()) func() {
    var (
        once  Once
        valid bool
        p     any
    )
    g := func() {
        defer func() {
            f = nil // release the closure for GC
            if !valid {
                panic(p) // re-panic with the captured value
            }
        }()
        f()
        valid = true
    }
    return func() {
        once.Do(g)
        if !valid {
            panic(p)
        }
    }
}
```

Annotations:

- The captured `f` is set to `nil` after the first call, so the closure no longer holds a reference to whatever `f` captured. GC can reclaim it.
- `valid` tracks whether `f` returned normally. If it panicked, `p` holds the value.
- The returned wrapper re-panics on every subsequent call if the first call panicked. This is the "loud" panic policy: every caller learns about the failure.

`OnceValue` and `OnceValues` are essentially the same, generic over the return types. They capture `f`'s output into the closure and return it.

The key innovation is the panic-replay behaviour. Raw `sync.Once` silently no-ops after a panicking call; the 1.21 wrappers shout. Choose deliberately.

---

## 7. Cost analysis

Empirical numbers on a 2024-era amd64 CPU at 3.5 GHz:

| Operation | Time |
|---|---|
| `once.Do(f)` after first call (fast path) | ~0.7 ns |
| `once.Do(f)` first call, uncontended (slow path) | ~30 ns + cost of `f` |
| `once.Do(f)` contended first call | ~50–100 ns + cost of `f` per loser |
| `atomic.Uint32.Load` | ~0.5 ns |
| `Mutex.Lock` + `Unlock`, uncontended | ~10 ns |

The fast path is essentially a single atomic load. Calling `Once.Do` on the hot path of an HTTP request handler costs nothing meaningful.

For comparison, calling a plain function: ~1 ns. Calling `Once.Do` on the fast path is *less than half* the cost of a regular function call.

---

## 8. False sharing concerns

`sync.Once` is 24 bytes. Three of them fit in a 64-byte cache line. If two `Once` values land on the same cache line and live in two different goroutines, writes to one can invalidate the other's cache line. This is **false sharing**.

In practice, package-level `Once` declarations are not hot — the slow path runs at most once. The fast path is read-only. False sharing on `Once` is almost never a problem.

The exception: many `Once` values bundled in a slice or struct, where many goroutines simultaneously perform first-touch on different `Once`s. If this matters, pad the structs to cache-line boundaries:

```go
type paddedOnce struct {
    sync.Once
    _ [64 - 24]byte // pad to 64 bytes
}
```

This is exotic. Real programs do not need it.

---

## 9. Race detector hooks

The Go race detector (`-race` flag) instruments memory accesses with synchronisation tracking. For `sync.Once`:

- The atomic load/store of `done` are recognised as synchronisation operations.
- The mutex Lock/Unlock are recognised.
- The happens-before edges described in the memory-model section are encoded directly.

If you write:

```go
go once.Do(func() { x = 42 })
fmt.Println(x) // RACE: no synchronisation
```

the race detector flags it: the second goroutine reads `x` without calling `Do`, so it has no happens-before relation with the assignment. Add `once.Do(...)` to the read path (even though it is a no-op on the fast path) and the race goes away.

This is one of the practical reasons to *always* read shared state through the same `Once.Do` that wrote it: not because the runtime forces you, but because that is what makes the synchronisation explicit to the race detector and to human readers.

---

## 10. Comparison to other languages

| Language | "Run once" primitive |
|---|---|
| C++11 | `std::call_once(flag, f)` with `std::once_flag` |
| Java | `synchronized` block + `volatile` flag, or `LazyHolder` idiom |
| Python | `threading.RLock` + flag, or `functools.lru_cache(maxsize=1)` |
| Rust | `std::sync::Once::call_once(f)` |
| C# | `Lazy<T>` |

The shape is universal. The differences are in:

- **API ergonomics.** Go's `once.Do(f)` is as small as it gets.
- **Generic return.** Rust's `LazyLock`, C#'s `Lazy<T>`, Go 1.21's `OnceValue` all add a return type. Go 1.0–1.20's `Once.Do` did not.
- **Reset.** C++ allows `std::once_flag` to be assigned over (effectively a reset). Go does not, by design.

C++'s `std::call_once` is the closest cousin to Go's `Once`. Both use a double-checked pattern internally. Both block late callers. Both treat panic/exception as "done."

---

## 11. Walking `src/sync/once.go`

The full file is about 80 lines including comments. Key landmarks:

```
src/sync/once.go
├── package sync
├── import (atomic)
├── type Once struct { done atomic.Uint32; m Mutex }
│
├── func (o *Once) Do(f func())
│   ├── if o.done.Load() == 0:
│   │     o.doSlow(f)
│   └── return
│
└── func (o *Once) doSlow(f func())
    ├── o.m.Lock()
    ├── defer o.m.Unlock()
    ├── if o.done.Load() == 0:
    │     defer o.done.Store(1)
    │     f()
    └── return
```

The whole production source. No hidden state, no platform-specific paths. Read it for yourself; it is one of the cleanest files in the standard library.

---

## 12. The runtime semaphore (slow path of `Mutex`)

`Once.m` is a `sync.Mutex`. When the slow path is contended, what happens?

`Mutex.Lock` on amd64:

1. Atomic CAS attempt on the mutex's state word: try to flip from unlocked (0) to locked (1).
2. If the CAS succeeds, return — fast path.
3. If it fails, enter the slow path, which involves:
   - Spinning briefly (4 iterations on multicore amd64) hoping the holder releases.
   - If still locked, calling `runtime_SemacquireMutex(&m.sema)` — a runtime semaphore.
   - The semaphore parks the goroutine on a wait queue maintained by the runtime.
4. When `Unlock` is called, the runtime semaphore wakes the next waiter.

For `Once`, this matters when many goroutines hit the cold slow path simultaneously. They all attempt CAS, one wins, the rest park on the semaphore. The winner runs `f` (which may take milliseconds), then unlocks. Each waiter then acquires the lock in turn, runs the double-check (`done == 1` now), skips `f`, releases.

The cost per loser: one semaphore park + one lock acquisition + one atomic load + one unlock. On the order of microseconds total, dominated by the semaphore wait. Acceptable for a one-time cost.

For sustained high contention on a `Once` slow path (which is rare — it only happens during the brief first-touch window), you would see this in pprof under `sync.(*Mutex).lockSlow`. The fix, almost always, is to pre-warm the `Once` synchronously before fanning out.

---

## 13. Atomic implementation per architecture

The atomic load/store of `done`:

| Architecture | Load | Store |
|---|---|---|
| amd64 | `MOV` | `MOV` + `MFENCE` (or `XCHG`) |
| arm64 | `LDAR` (load-acquire) | `STLR` (store-release) |
| ppc64 | `LWZ` + `LWSYNC` | `LWSYNC` + `STW` |
| 386 | `MOV` + `MFENCE` | `LOCK XCHG` |
| wasm | single-threaded; no fences needed |

On amd64, the load is essentially free (one machine instruction). The store is more expensive but only happens once. This is one reason `Once` is cheaper than a Mutex on the hot path: the hot path avoids the LOCK prefix that mutex acquisition requires.

On arm64, the load-acquire `LDAR` is slightly more expensive than a plain load but still on the order of 1 ns. Same conclusion: the fast path is cheap.

---

## 14. Why `Once` cannot be reset

`Once` deliberately offers no `Reset` method. Why?

Three reasons:

1. **Race correctness.** A "reset" would have to flip `done` back to 0 atomically. If a concurrent goroutine is in the fast path observing `done == 0` and proceeds to the slow path, it must see a consistent mutex state. The semantics of "reset while concurrent callers exist" are very hard to define cleanly.
2. **Use-case mismatch.** The vast majority of uses are commit-forever (singleton, init, idempotent close). The minority that want reset are better served by `atomic.Pointer` with explicit replacement.
3. **API minimalism.** Go stdlib resists adding methods. `Once` does one thing.

If you want reset, build it yourself: replace the `Once` value under a mutex, as described in middle and senior level. Or, more cleanly, use a different abstraction.

---

## 15. Bug hunt: the historical `Once` issue

Before Go 1.18, `Once` used `atomic.LoadUint32` and `atomic.StoreUint32` on a plain `uint32` field. There was a documented issue (golang/go#41690, fixed in 1.18) where the fast path optimisation could be wrong on 32-bit platforms due to alignment of `uint32` in a struct. The fix was to ensure `done` was the first field. The change to `atomic.Uint32` in 1.19+ embeds the alignment requirement in the type, removing the trap.

This is a useful historical note: the algorithm is simple, but getting *atomic on every architecture* right took real iteration. The current implementation is the result of many years of refinement of a 12-line algorithm.

---

## 16. Summary

`sync.Once`, viewed at professional depth:

- **State**: a 4-byte atomic flag + an 8-byte mutex = 12 bytes (24 with alignment).
- **Algorithm**: double-checked locking, with atomic load on the fast path and mutex + double-check on the slow path.
- **Correctness**: justified by the Go memory model — atomic store-with-lock-held creates happens-before with atomic load-on-fast-path.
- **Panic semantics**: deferred store of `done = 1` runs on panic, so `Once` is permanently "done" after a panicking `f`.
- **Cost**: ~0.7 ns on the fast path, ~30 ns + `f`'s cost on the uncontended slow path, microseconds per loser under contention.
- **Go 1.21 helpers**: thin wrappers that add return values, GC release of the closure, and loud panic replay.

The standard library source is ~80 lines. Read it. It is one of the cleanest, smallest, most-relied-on primitives in Go, and it is fully explicable in a single sitting.

Next, specification level catalogues the formal API contract and links the standard library documentation, the Go memory model, and the proposal documents for the 1.21 additions.
