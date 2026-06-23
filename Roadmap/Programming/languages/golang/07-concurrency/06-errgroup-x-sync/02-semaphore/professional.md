# x/sync semaphore — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Internal Structure](#internal-structure)
3. [The Acquire Hot Path](#the-acquire-hot-path)
4. [The Acquire Slow Path](#the-acquire-slow-path)
5. [The Release Path and `notifyWaiters`](#the-release-path-and-notifywaiters)
6. [Cancellation Race Handling](#cancellation-race-handling)
7. [Memory Model and Synchronization](#memory-model-and-synchronization)
8. [Comparison with OS Semaphores at the Kernel Level](#comparison-with-os-semaphores-at-the-kernel-level)
9. [Building Your Own Weighted Semaphore](#building-your-own-weighted-semaphore)
10. [Allocation Profile](#allocation-profile)
11. [Summary](#summary)

---

## Introduction

This file is a tour of `golang.org/x/sync/semaphore/semaphore.go` and the implementation choices that make it efficient and correct. The source is short — under 150 lines including comments — and worth reading top to bottom. Below is the structured commentary, focused on the choices that matter for production behaviour.

The file's design summary: a struct holding a mutex, a counter, a maximum, and a `container/list.List` of waiter records. There is no goroutine inside the semaphore. All work happens on caller threads.

---

## Internal Structure

The type, slightly simplified:

```go
package semaphore

import (
    "container/list"
    "context"
    "sync"
)

type Weighted struct {
    size    int64        // capacity, set once in NewWeighted
    cur     int64        // current used
    mu      sync.Mutex   // guards cur and waiters
    waiters list.List    // FIFO of *waiter
}

type waiter struct {
    n     int64           // requested weight
    ready chan struct{}   // closed when this waiter is granted
}
```

Three observations:

1. **`list.List` (linked list)** is used instead of a slice. Adding and removing from arbitrary positions is O(1). The list nodes carry the `waiter` values. A slice would force shifting on cancellation removal.
2. **Each waiter has its own channel** — not a shared condition variable. The wake path is `close(w.ready)`, which is O(1) and lets the waker proceed without further synchronisation.
3. **No internal goroutine.** Every operation runs on the caller's goroutine. The semaphore is a coordination primitive, not a service.

The constructor:

```go
func NewWeighted(n int64) *Weighted {
    return &Weighted{size: n}
}
```

That's it. No goroutine spawned. No channel created. The waiter list is zero-valued and empty.

---

## The Acquire Hot Path

When the queue is empty and capacity is free, `Acquire` is fast:

```go
func (s *Weighted) Acquire(ctx context.Context, n int64) error {
    done := ctx.Done()

    s.mu.Lock()
    select {
    case <-done:
        // Pre-cancelled context: return early without modifying state.
        s.mu.Unlock()
        return ctx.Err()
    default:
    }
    if s.size-s.cur >= n && s.waiters.Len() == 0 {
        // Fast path: capacity available, no waiters ahead of us.
        s.cur += n
        s.mu.Unlock()
        return nil
    }
    // ... slow path follows
}
```

Cost: one mutex lock + unlock, one `select` with no work, one comparison, one addition. On a modern x86 with cache-hot locks, this is roughly 25–50 ns total.

### Why the pre-cancellation check?

If `ctx` is already cancelled when `Acquire` is called, the function returns `ctx.Err()` without entering the queue. This avoids the case where a cancelled caller takes a slot it does not need, only to immediately give it back.

### Why is the queue-empty check required?

Without `s.waiters.Len() == 0`, the fast path would jump the FIFO queue: a fresh caller would take a slot while older waiters are parked. The check enforces strict FIFO.

---

## The Acquire Slow Path

When the fast path fails:

```go
if n > s.size {
    // Request that can never be satisfied: wait only for ctx.
    s.mu.Unlock()
    <-done
    return ctx.Err()
}

ready := make(chan struct{})
w := waiter{n: n, ready: ready}
elem := s.waiters.PushBack(w)
s.mu.Unlock()

select {
case <-done:
    // Cancelled while parked: clean up and return.
    s.mu.Lock()
    select {
    case <-ready:
        // Granted concurrently with cancellation: give it back.
        s.cur -= n
        s.notifyWaiters()
    default:
        // Not yet granted: remove from the queue.
        s.waiters.Remove(elem)
    }
    s.mu.Unlock()
    return ctx.Err()

case <-ready:
    // Granted: cur has already been incremented by notifyWaiters.
    // Re-check ctx for completeness (the implementation rebuilds ctx error).
    select {
    case <-done:
        s.Release(n)
        return ctx.Err()
    default:
    }
    return nil
}
```

Several details:

### `n > s.size` is special

A request that exceeds capacity can never be satisfied through `notifyWaiters`. The implementation does not even park it in the queue — it just waits on `ctx`. This avoids polluting the queue with permanently-unfittable entries.

### Waiter is on a `list.Element`

`s.waiters.PushBack(w)` returns `*list.Element`, the node pointer. The caller saves it so that on cancellation, it can call `s.waiters.Remove(elem)` in O(1). Without the element pointer, cleanup would be O(n).

### Wake is one channel close

`close(w.ready)` wakes the waiter and signals "grant complete." The waker (in `notifyWaiters`) has already incremented `s.cur` before closing. By the time the waiter wakes, the slot is allocated to it; there is nothing for the waiter to do but return.

### Why `make(chan struct{})` per call?

A fresh, unbuffered channel per waiter. It is short-lived (the lifetime of the parked acquire) and not reused. Allocation cost is real (~96 bytes for a `chan struct{}` plus `*list.Element`) but tolerable because parked acquires are slow paths.

A cleverer design might pool channels via `sync.Pool`, but the package authors chose simplicity. The trade-off is paid in allocation count under contention, not in fairness or correctness.

---

## The Release Path and `notifyWaiters`

```go
func (s *Weighted) Release(n int64) {
    s.mu.Lock()
    s.cur -= n
    if s.cur < 0 {
        s.mu.Unlock()
        panic("semaphore: released more than held")
    }
    s.notifyWaiters()
    s.mu.Unlock()
}

func (s *Weighted) notifyWaiters() {
    for {
        next := s.waiters.Front()
        if next == nil {
            break
        }
        w := next.Value.(waiter)
        if s.size-s.cur < w.n {
            // Head doesn't fit: stop here. Do not skip the head to find a
            // smaller waiter (that would violate FIFO).
            break
        }
        s.cur += w.n
        s.waiters.Remove(next)
        close(w.ready)
    }
}
```

Three production-relevant points:

### Wake order is strict FIFO

`notifyWaiters` walks from the front of the list and stops as soon as the head does not fit. This is what enforces head-of-line blocking: if the head wants 10 and only 5 freed, the loop exits even if the next waiter wants 1.

### Wake is inside the lock

`close(w.ready)` happens *while holding* `s.mu`. The closed channel will then wake the parked goroutine when the scheduler picks it up. Releasing the mutex first would let a new `Acquire` slip in between, potentially before the parked goroutine wakes — but FIFO would still be preserved because `notifyWaiters` already incremented `s.cur`. The chosen design keeps everything ordered under one lock.

### Panic on negative `cur`

Releasing more than held is treated as a fatal bug. The package does not silently clamp at zero. This is the right policy — the alternative would hide the calling bug.

---

## Cancellation Race Handling

The trickiest case in the implementation is the race between **grant** and **cancellation**:

```
T1: notifyWaiters under s.mu
    s.cur += w.n
    close(w.ready)        <-- wakes waiter
T2: <-done in waiter      <-- ctx cancelled at the same moment
```

The waiter's `select` may observe `<-done` first or `<-ready` first depending on which the runtime schedules. The implementation handles both:

```go
select {
case <-done:
    s.mu.Lock()
    select {
    case <-ready:
        // Hit the grant-then-cancel race: we DID get the slot, but ctx is cancelled.
        // Give back the slot so subsequent waiters can use it.
        s.cur -= n
        s.notifyWaiters()
    default:
        s.waiters.Remove(elem)
    }
    s.mu.Unlock()
    return ctx.Err()
```

The key insight: when the outer `select` picks `<-done`, the slot may or may not have been granted. The inner `select` distinguishes:

- `<-ready` non-blocking → grant happened. We must release.
- default → no grant. Just remove from queue.

This race-handling block is the most subtle part of the package. Before it was added (in 2020), cancelled acquires could lose a slot, causing slow capacity erosion over time.

---

## Memory Model and Synchronization

`semaphore.Weighted` provides a happens-before edge from `Release(n)` to the matching `Acquire(ctx, n)` return.

The edges are:

- The `s.mu` lock/unlock orders writes around `cur` and `waiters`.
- The `close(w.ready)` synchronises-with the receive on `w.ready` (Go memory model rule: a channel close is synchronised with all receives on that channel).

A user holding a successfully-acquired slot has happens-before knowledge of everything that the releasing goroutine did before it called `Release`. This makes the semaphore safe to use for handoff patterns where the "thing" being protected is some shared state, not just a counter.

A counterexample: `TryAcquire(n)` returning `true` synchronises only with the prior `Release` that made capacity available. It does **not** synchronise with arbitrary writes by other goroutines.

The race detector understands all of this; `go test -race` catches misuse.

---

## Comparison with OS Semaphores at the Kernel Level

A POSIX semaphore (`sem_t`) is implemented on Linux via a futex word in a `sem_t` struct. The fast path increments/decrements the word with an atomic; the slow path calls `futex(FUTEX_WAIT)` / `futex(FUTEX_WAKE)`.

`semaphore.Weighted` mirrors this structurally:

| Component | POSIX `sem_t` | `semaphore.Weighted` |
|---|---|---|
| Fast path | atomic CAS on word | mutex + integer add |
| Wait queue | kernel futex hash bucket | `list.List` |
| Park | `FUTEX_WAIT` syscall | channel receive on `ready` |
| Wake | `FUTEX_WAKE` syscall | `close(ready)` |
| Bookkeeping | kernel-managed | user-managed |
| Cancellation | `sem_timedwait` returns `ETIMEDOUT` | `<-ctx.Done()` returns ctx error |

Three differences with operational impact:

1. **No syscall on uncontended acquire.** The Go semaphore is pure user-space arithmetic plus a mutex. POSIX semaphores also avoid the kernel on uncontended cases (atomic CAS), but the syscall cost on the slow path is higher than channel close.
2. **Goroutine wake is cheap.** Goroutine wake takes hundreds of nanoseconds; OS thread wake takes microseconds. The Go semaphore can sustain higher wake rates than an OS semaphore on the same hardware.
3. **No cross-process sharing.** A POSIX named semaphore can coordinate two processes; `semaphore.Weighted` is in-process only.

When porting from C/C++ with `sem_t` to Go, the API maps cleanly. The biggest semantic shift is from "wait with timeout in milliseconds" to "wait with `ctx`."

---

## Building Your Own Weighted Semaphore

For pedagogical value — and for niche cases where the stock implementation does not fit — write your own. Here is a minimal version that mirrors the package's structure:

```go
package mysem

import (
    "container/list"
    "context"
    "sync"
)

type Weighted struct {
    size    int64
    cur     int64
    mu      sync.Mutex
    waiters list.List
}

type waiter struct {
    n     int64
    ready chan struct{}
}

func NewWeighted(n int64) *Weighted { return &Weighted{size: n} }

func (s *Weighted) Acquire(ctx context.Context, n int64) error {
    done := ctx.Done()
    s.mu.Lock()
    select {
    case <-done:
        s.mu.Unlock()
        return ctx.Err()
    default:
    }
    if s.size-s.cur >= n && s.waiters.Len() == 0 {
        s.cur += n
        s.mu.Unlock()
        return nil
    }
    if n > s.size {
        s.mu.Unlock()
        <-done
        return ctx.Err()
    }
    ready := make(chan struct{})
    w := waiter{n: n, ready: ready}
    elem := s.waiters.PushBack(w)
    s.mu.Unlock()

    select {
    case <-done:
        s.mu.Lock()
        select {
        case <-ready:
            s.cur -= n
            s.notifyWaiters()
        default:
            s.waiters.Remove(elem)
        }
        s.mu.Unlock()
        return ctx.Err()
    case <-ready:
        return nil
    }
}

func (s *Weighted) TryAcquire(n int64) bool {
    s.mu.Lock()
    if s.size-s.cur >= n && s.waiters.Len() == 0 {
        s.cur += n
        s.mu.Unlock()
        return true
    }
    s.mu.Unlock()
    return false
}

func (s *Weighted) Release(n int64) {
    s.mu.Lock()
    s.cur -= n
    if s.cur < 0 {
        s.mu.Unlock()
        panic("mysem: released more than held")
    }
    s.notifyWaiters()
    s.mu.Unlock()
}

func (s *Weighted) notifyWaiters() {
    for {
        next := s.waiters.Front()
        if next == nil {
            return
        }
        w := next.Value.(waiter)
        if s.size-s.cur < w.n {
            return
        }
        s.cur += w.n
        s.waiters.Remove(next)
        close(w.ready)
    }
}
```

That is the entire stock implementation, minus type aliases and minor refactors. Pedagogical value: writing this from scratch forces you to confront the cancellation race, the FIFO discipline, and the choice of channel-per-waiter wake mechanism.

### Channel-only variant (for comparison)

If you do not need weighted acquires, the entire semaphore is a buffered channel:

```go
type Sem struct{ c chan struct{} }
func NewSem(n int) *Sem { return &Sem{c: make(chan struct{}, n)} }
func (s *Sem) Acquire(ctx context.Context) error {
    select {
    case s.c <- struct{}{}: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
func (s *Sem) Release() { <-s.c }
```

20 lines. No `list.List`, no waiter struct, no FIFO guarantee (channel send order is unspecified but practically fair). For weight = 1 use cases, this is the entire production-grade implementation.

---

## Allocation Profile

Per call:

| Operation | Allocations | Bytes |
|---|---|---|
| `NewWeighted(n)` | 1 (`*Weighted`) | ~64 (struct + list head) |
| `Acquire` fast path | 0 | 0 |
| `Acquire` slow path | 2 (channel + list element) | ~96 |
| `TryAcquire` | 0 | 0 |
| `Release` | 0 | 0 |

The slow path allocates on every parked acquire. For workloads where parking is common, the allocator and GC become a non-trivial cost. If profiling shows this, the channel-based simplified variant (no `list.List`) is faster — but loses weighted ability.

Benchmark a synthetic workload that saturates the semaphore:

```
BenchmarkAcquireRelease/contended-8   1000000   1200 ns/op   96 B/op   2 allocs/op
BenchmarkAcquireRelease/uncontended-8 10000000    35 ns/op    0 B/op   0 allocs/op
```

(Numbers illustrative, not measured here.)

---

## Summary

`semaphore.Weighted` is ~100 lines of Go that solves a real coordination problem efficiently:

- **Hot path**: mutex + integer math, no allocation.
- **Slow path**: per-waiter channel + linked list entry, one allocation pair.
- **Wake**: `close(chan)` — O(1), integrates with the Go scheduler.
- **Fairness**: strict FIFO, with head-of-line blocking as a documented consequence.
- **Cancellation**: handled correctly via a double-check `select` on `ready` vs `done`.

The implementation is short enough to read in one sitting and instructive enough to copy when you need a variant (LIFO, best-fit, deadline-aware). For most production code, the stock version is exactly right; the value of reading it is calibration — knowing when you can afford to allocate per acquire, when the FIFO policy is your problem, and when the package's design assumptions stop fitting your workload.
