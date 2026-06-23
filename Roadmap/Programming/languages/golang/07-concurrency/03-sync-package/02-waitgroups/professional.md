---
layout: default
title: WaitGroups — Professional
parent: WaitGroups
grand_parent: sync Package
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/professional/
---

# WaitGroups — Professional

← Back to WaitGroups

Time to look under the hood. We dissect the actual `sync.WaitGroup` source, the runtime semaphore that backs `Wait`, the race-detector hooks that catch `Add`-after-`Wait` bugs, and the cost of every operation.

The line numbers below refer to Go 1.22's `src/sync/waitgroup.go`. The code may evolve; the algorithm is stable.

---

## 1. The struct

```go
type WaitGroup struct {
    noCopy noCopy

    state atomic.Uint64        // high 32 bits = counter, low 32 bits = waiter count
    sema  uint32
}
```

Three fields:

- **`noCopy`** — a zero-size marker that `go vet` reads to detect pass-by-value bugs. It exists in `sync.Mutex`, `sync.WaitGroup`, `sync.Cond`, and other types that must not be copied. The marker has no runtime effect; it only triggers a static analysis warning.
- **`state`** — a single 64-bit word that packs *both* the goroutine counter and the number of waiters. We'll dissect the bit layout shortly.
- **`sema`** — a 32-bit semaphore handle used to park and wake `Wait` callers, managed by the runtime via `runtime_Semacquire` and `runtime_Semrelease`.

The whole struct is 24 bytes on 64-bit architectures (after the noCopy zero-size and alignment padding).

### 1.1 Why pack counter and waiters?

A naive design would have separate fields:

```go
counter int32
waiters int32
sema    uint32
```

But then `Add(-1)` (called by `Done`) needs an atomic operation that *both* decrements the counter and reads whether there are waiters. With separate fields you'd need a mutex or a CAS loop on each. By packing both into one 64-bit word, a single `atomic.Uint64.Add` updates the counter and the waiters fence-load is atomic with it.

```
state (64 bits)
+----------------------------+----------------------------+
|   counter (high 32 bits)   |   waiters (low 32 bits)    |
+----------------------------+----------------------------+
```

`Add(delta)` does `state.Add(uint64(delta) << 32)` — a single atomic operation modifying the counter half while leaving the waiter half untouched.

---

## 2. `Add`

The simplified body of `Add(delta int)`:

```go
func (wg *WaitGroup) Add(delta int) {
    state := wg.state.Add(uint64(delta) << 32)
    v := int32(state >> 32)            // new counter
    w := uint32(state)                 // current waiters

    if v < 0 {
        panic("sync: negative WaitGroup counter")
    }
    if w != 0 && delta > 0 && v == int32(delta) {
        // first Add after Wait already in progress — bug
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    if v > 0 || w == 0 {
        return
    }
    // v == 0 and w > 0: time to release waiters
    if wg.state.Load() != state {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    wg.state.Store(0)
    for ; w != 0; w-- {
        runtime_Semrelease(&wg.sema, false, 0)
    }
}
```

Walk through the branches:

- **`v < 0`**: counter went negative ⇒ too many `Done` calls ⇒ panic.
- **`w != 0 && delta > 0 && v == int32(delta)`**: the counter just rose from zero to a positive value while there was already a waiter parked. This is the "Add concurrent with Wait" race condition. Caught and panicked.
- **`v > 0 || w == 0`**: ordinary case — return.
- **`v == 0 && w > 0`**: counter just hit zero with waiters parked. Release each waiter via `runtime_Semrelease`.

The race detector is also notified on every `Add` via `race.ReleaseMerge(unsafe.Pointer(wg))`, recording a happens-before edge.

---

## 3. `Done`

```go
func (wg *WaitGroup) Done() {
    wg.Add(-1)
}
```

That's it. `Done` is `Add(-1)`. All the panic checks live in `Add`.

---

## 4. `Wait`

```go
func (wg *WaitGroup) Wait() {
    for {
        state := wg.state.Load()
        v := int32(state >> 32)
        if v == 0 {
            return        // counter already zero
        }
        // try to bump the waiter count
        if wg.state.CompareAndSwap(state, state+1) {
            runtime_Semacquire(&wg.sema)
            if wg.state.Load() != 0 {
                panic("sync: WaitGroup is reused before previous Wait has returned")
            }
            return
        }
        // CAS failed — another Add or Wait raced; retry
    }
}
```

The loop is a CAS-based reservation:

1. Read the state.
2. If counter is zero, return immediately.
3. Otherwise, CAS to add 1 to the waiter count.
4. If the CAS succeeds, park on the semaphore.
5. When woken, sanity-check that the state is now zero (else reuse-without-cleanup).
6. Return.

If multiple goroutines call `Wait`, each CAS bumps the waiter count atomically and each parks on the same semaphore handle. When the counter reaches zero in `Add`, the loop calls `Semrelease` once per waiter.

The race detector hook is `race.Acquire(unsafe.Pointer(wg))` immediately before returning, completing the happens-before edge with the corresponding `Done` calls.

---

## 5. The runtime semaphore

`runtime_Semacquire` and `runtime_Semrelease` are runtime calls that interact with `g`-aware parking. The semaphore itself is a `uint32`, but the runtime maintains a hash table of *sudog* wait queues keyed by the address of the semaphore word. When a goroutine acquires the semaphore and the counter is zero, the goroutine is suspended; when another calls release, the runtime wakes one parked goroutine.

This is *not* a futex (although on Linux the runtime may eventually call into futexes for the underlying OS-level park). It is Go's user-space scheduler-aware semaphore, which means a parked goroutine doesn't burn a thread.

The cost: an uncontended `Add` is a single atomic op (~5–15ns). A `Wait` that doesn't block is the same. A `Wait` that *does* block costs a CAS, a runtime semaphore parking, and the corresponding wake-up — typically a few microseconds, depending on whether the goroutine landed on the same P or migrated.

---

## 6. The `noCopy` mechanism

```go
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

`noCopy` is a zero-size marker with two no-op methods. It implements `sync.Locker`. The Go vet tool inspects every struct copy and warns if the source contains a `sync.Locker` field. That's what makes `go vet` flag:

```go
func process(wg sync.WaitGroup) { ... }    // vet: passes lock by value
```

The runtime never reads `noCopy`. Only static analysis cares about it. This is why deleting the field would break vet warnings but not break correctness — the WaitGroup would still misbehave, just silently.

---

## 7. The packed-state trick: walking through a real run

Let's trace `Add(3)`, two `Done()`, one `Wait`, then the last `Done`:

```
Initial:  state = 0x0000000000000000  (counter=0, waiters=0)

Add(3):   state = 0x0000000300000000  (counter=3, waiters=0)
Done():   state = 0x0000000200000000  (counter=2, waiters=0)
Done():   state = 0x0000000100000000  (counter=1, waiters=0)

Wait():   CAS state from 0x0000000100000000
            to     0x0000000100000001  (counter=1, waiters=1)
          parks on sema

Done():   state.Add(0xFFFFFFFF00000000)
            -> state = 0x0000000000000001  (counter=0, waiters=1)
          v=0, w=1 — release waiters
          state.Store(0)
          Semrelease(sema)
          waiter wakes, returns
```

Notice how the increment and decrement of the counter use the *high* 32 bits, while `Wait` increments the *low* 32 bits. Both happen via lock-free atomics, and only the rare "counter hits zero with waiters" case takes the slow path.

---

## 8. The race detector's job

When you run `go test -race` (or `go run -race`), the compiler instruments every memory access and every sync primitive. For WaitGroup:

- `Add(positive)` calls `race.ReleaseMerge` — establishes a happens-before edge from this `Add` to a future `Wait` return.
- `Done` calls `race.ReleaseMerge` — establishes an edge from this `Done` to the unblocked `Wait`.
- `Wait` calls `race.Acquire` after returning — receives all those edges.

If your code calls `Add` *after* `Wait` has started (the canonical bug), the race detector sees an `Add` whose `ReleaseMerge` happens *concurrently* with the `Acquire` it should be ordered with, and reports:

```
WARNING: DATA RACE
Read at 0x... by goroutine 6:
  sync.(*WaitGroup).Wait()
Previous write at 0x... by goroutine 7:
  sync.(*WaitGroup).Add()
```

This is much more useful than the runtime panic, because it points at *both* the offending `Add` and the `Wait` it raced with.

---

## 9. Cost benchmarks (Go 1.22 amd64)

Approximate, on a 2024 laptop. Your numbers will vary.

| Operation                                  | Time      |
|--------------------------------------------|-----------|
| `Add(1)` no waiters                        | ~5 ns     |
| `Done()` no waiters                        | ~5 ns     |
| `Wait()` already at zero                   | ~3 ns     |
| `Wait()` blocks then released (1 goroutine)| ~1.5 µs   |
| `go func(){}()` (goroutine launch)         | ~600 ns   |

The takeaway: a WaitGroup with N goroutines costs roughly `N × (Add + Done) + Wait`, plus the cost of the goroutines themselves. For typical N (10s to 1000s), the WaitGroup overhead is in the noise compared to the goroutine launch and the work.

---

## 10. Comparison with C++ and Java

| Construct                 | Go              | C++                         | Java                        |
|---------------------------|-----------------|-----------------------------|-----------------------------|
| Counting barrier          | `sync.WaitGroup`| `std::latch` (one-shot)     | `CountDownLatch` (one-shot) |
| Reusable barrier          | manual or `errgroup` | `std::barrier` (C++20)  | `CyclicBarrier`             |
| Future-based fan-in       | channels        | `std::async`/futures        | `CompletableFuture`         |

`sync.WaitGroup` is most similar to `std::latch` — *technically* reusable, but the API encourages one-shot use. Reuse is allowed but the rules are stringent.

---

## 11. WaitGroup with an explicit timeout (the "race" with Wait)

`Wait` has no timeout. If you want one, you must wrap:

```go
func WaitWithTimeout(wg *sync.WaitGroup, d time.Duration) bool {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return true
    case <-time.After(d):
        return false
    }
}
```

Caveats:

- The wrapper goroutine **leaks** if the timeout fires — it will continue to call `Wait` until the WaitGroup actually drains. It's stuck.
- If the WaitGroup never drains, the leak is permanent. In long-running services, this can accumulate.
- This is a hint that you should use `context.Context` and have the workers check `ctx.Done()` themselves, then `Wait` will eventually return.

---

## 12. A debugging trick: counting outstanding goroutines

`WaitGroup` doesn't expose the counter, but in debug builds you can wrap it:

```go
type DebugWG struct {
    sync.WaitGroup
    n atomic.Int64
}

func (w *DebugWG) Add(d int) {
    w.n.Add(int64(d))
    w.WaitGroup.Add(d)
}

func (w *DebugWG) Done() {
    w.n.Add(-1)
    w.WaitGroup.Done()
}

func (w *DebugWG) Outstanding() int64 {
    return w.n.Load()
}
```

In production, prefer real observability — Prometheus gauges or pprof goroutine dumps. The wrapper above is a debugging crutch.

---

## 13. Why no `WaitGroup.AddDeadline` or `Semaphore` in stdlib?

The Go team intentionally keeps `WaitGroup` minimal. Variants:

- Bounded concurrency? Use `errgroup.SetLimit` or `golang.org/x/sync/semaphore.Weighted`.
- Timeout? Use a `context.Context`.
- Errors? Use `errgroup`.
- Cancellation? Use `context.Context`.

A grand-unified primitive would obscure the trade-offs. The stdlib `WaitGroup` is the smallest useful piece; you compose richer behaviour on top.

---

## 14. Internals diagram

```
   +------------------------------------------------------+
   |                    sync.WaitGroup                    |
   +------------------------------------------------------+
   |  noCopy   (vet marker)                               |
   |                                                      |
   |  state    (atomic.Uint64)                            |
   |    +---------------------------+--------------------+|
   |    | counter (high 32 bits)    | waiters (low 32)  ||
   |    +---------------------------+--------------------+|
   |                                                      |
   |  sema     (uint32, runtime semaphore handle)         |
   +------------------------------------------------------+

   Add(d):     state += d << 32  (atomic)
               if counter == 0 && waiters > 0:
                   for w in waiters: Semrelease(sema)

   Done():     Add(-1)

   Wait():     loop: CAS state to state+1 (waiter)
               park on sema
               return
```

If you can sketch this from memory, you have a complete mental model.

---

## 15. Reading exercise

Open `$GOROOT/src/sync/waitgroup.go` and read it end to end. It is ~120 lines including comments. Map each branch to the panic messages you might see:

- "sync: negative WaitGroup counter"
- "sync: WaitGroup misuse: Add called concurrently with Wait"
- "sync: WaitGroup is reused before previous Wait has returned"

Each message corresponds to a specific check we discussed. If you can predict, given a misuse pattern, exactly which message will fire — you understand the implementation.

---

## 16. Going deeper

- [specification.md](specification.md) — the formal API contract
- [interview.md](interview.md) — internals questions for staff-level interviews
- [find-bug.md](find-bug.md) — apply this knowledge to broken code
- [optimize.md](optimize.md) — when WaitGroup is too coarse and what to replace it with
