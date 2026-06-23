# x/sync semaphore — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definition](#formal-definition)
3. [Type and Function Signatures](#type-and-function-signatures)
4. [Preconditions](#preconditions)
5. [Postconditions](#postconditions)
6. [Ordering and Fairness](#ordering-and-fairness)
7. [Cancellation Semantics](#cancellation-semantics)
8. [Memory Model Edges](#memory-model-edges)
9. [Error Returns](#error-returns)
10. [Resource Bounds](#resource-bounds)
11. [Edge Cases](#edge-cases)
12. [Compliance Checks](#compliance-checks)
13. [Reference Pseudocode](#reference-pseudocode)
14. [Summary](#summary)

---

## Introduction

This file is the formal contract for `golang.org/x/sync/semaphore.Weighted`. The package itself ships as a small file of ~100 lines, but its behaviour is precise enough that production code depends on it for memory budgets and concurrency limits. Below is the contract every implementation must satisfy and every caller may rely on.

References:
- Source: `golang.org/x/sync/semaphore/semaphore.go`
- Package documentation: `pkg.go.dev/golang.org/x/sync/semaphore`

---

## Formal Definition

A `Weighted` semaphore is a tuple `(N, used, Q)` where:

- `N` is a non-negative integer (the **capacity**), fixed at construction.
- `used` is a non-negative integer with `0 ≤ used ≤ N` (current allocation).
- `Q` is a FIFO list of waiters; each waiter has a weight `w` and a signal channel `ready`.

The operations:

- `Acquire(ctx, n)`:
  - If `Q` is empty and `used + n ≤ N`, set `used := used + n` and return `nil`.
  - Otherwise enqueue the caller with weight `n` and a fresh `ready`. Block until either `ready` is closed (meaning the request succeeded) or `ctx.Done()` fires. On context cancellation, remove the entry from `Q` if still present and return `ctx.Err()`.
- `TryAcquire(n)`:
  - If `Q` is empty and `used + n ≤ N`, set `used := used + n` and return `true`.
  - Otherwise return `false` without enqueuing.
- `Release(n)`:
  - Decrement `used` by `n`. Then, while the head of `Q` has weight `≤ N - used`, dequeue it and close its `ready` (and add its weight to `used`).
  - Panic if `n` would make `used` negative.

---

## Type and Function Signatures

```go
package semaphore

type Weighted struct { /* unexported */ }

func NewWeighted(n int64) *Weighted

func (s *Weighted) Acquire(ctx context.Context, n int64) error
func (s *Weighted) TryAcquire(n int64) bool
func (s *Weighted) Release(n int64)
```

All weights are `int64` to support large memory budgets (bytes).

---

## Preconditions

For `NewWeighted(n)`:
- `n >= 0`. Negative `n` is undefined; in practice it yields a semaphore that can never be acquired with positive weight.

For `Acquire(ctx, n)`:
- `ctx != nil`.
- `n >= 1`. Behaviour for `n == 0` returns `nil` immediately; behaviour for `n < 0` is undefined.
- `n` may exceed `N`. In that case `Acquire` returns `ctx.Err()` once `ctx` cancels — it never succeeds. This is **not** an immediate error; if `ctx` never cancels, the call blocks forever.

For `TryAcquire(n)`:
- `n >= 1`.
- Like `Acquire`, `n > N` always returns `false`.

For `Release(n)`:
- The caller must previously have acquired at least `n` total units from the same `Weighted`.
- `n >= 0`. `Release(0)` is a no-op apart from the wake scan.
- Releasing more than was acquired panics with `"semaphore: released more than held"`.

---

## Postconditions

After `Acquire(ctx, n)` returns `nil`:
- `used` has been incremented by `n`.
- The caller is logically the holder of `n` units; it must call `Release(n)` exactly once (or transfer that obligation).

After `Acquire(ctx, n)` returns an error:
- The error is `ctx.Err()` (`context.Canceled` or `context.DeadlineExceeded`).
- `used` is unchanged.
- The caller must **not** call `Release` for this acquisition.

After `TryAcquire(n)` returns `true`: same as a successful `Acquire`. The caller must call `Release(n)`.

After `TryAcquire(n)` returns `false`: `used` unchanged; no `Release` is required or permitted for this call.

After `Release(n)`:
- `used` is decremented by `n`.
- Zero or more waiters at the head of `Q` may have been unblocked; their `Acquire` calls will return `nil`.

---

## Ordering and Fairness

The implementation provides **strict FIFO** ordering on `Q`:

- A waiter is enqueued in arrival order, with arrival defined by the moment it took the internal mutex inside `Acquire`.
- A `Release` only wakes the **head** of the queue (and subsequent heads that also fit). If the head requires more weight than is currently available, **no further waiter is woken**, even if a later waiter would fit.
- This means a heavy waiter at the head can block lighter waiters behind it ("head-of-line blocking"). This is a deliberate fairness trade-off, not a bug.
- `TryAcquire` is **fairness-bypassing only when the queue is empty**. When `Q` is non-empty, `TryAcquire` returns `false` even if there is enough free capacity — to preserve FIFO for waiters already parked.

Consequence: across an unbounded sequence of calls, a waiter that arrives is guaranteed to be woken in finite time, provided releases continue. Starvation is impossible if the queue keeps draining.

---

## Cancellation Semantics

`Acquire(ctx, n)` integrates with `context.Context`:

- If `ctx` is already cancelled at call time, the function returns `ctx.Err()` without taking a place in `Q`, regardless of whether capacity is free.
- If `ctx` cancels while the caller is parked in `Q`, the caller is removed from `Q` (so it cannot later be granted) and the function returns `ctx.Err()`.
- A subtle case: if `ctx` cancels at the *exact same moment* the caller would be granted (its `ready` channel is closed), the implementation prefers cancellation. The granted slot is then immediately released back to capacity so subsequent waiters can proceed — this is the post-1.16 fix; older versions could lose a slot here.

Implementation note: the cancellation cleanup runs inside `s.mu`, so a cancelled `Acquire` cannot lose its place to a concurrent `Release`.

---

## Memory Model Edges

A successful `Acquire(ctx, n)` **synchronizes-after** the `Release(n)` (or `Release` chain) that made capacity available, in the Go memory model sense. Concretely:

- Any write `W` that happened-before `Release` happens-before any read `R` that happens-after the matching `Acquire`.
- This is the same edge a channel send/receive provides; under the hood the wakeup is a channel close.

`TryAcquire` does not synchronize-with anything except via the prior `Release` that made capacity available (when it returns `true`).

---

## Error Returns

`Acquire` returns one of:

- `nil` on success.
- `ctx.Err()` on cancellation, which is one of `context.Canceled` or `context.DeadlineExceeded`.

It never returns any other error. `TryAcquire` and `Release` do not return errors.

`Release` may **panic** with `"semaphore: released more than held"` if the cumulative releases exceed cumulative acquisitions.

---

## Resource Bounds

For a `Weighted` with capacity `N` and worst-case `K` simultaneously parked waiters:

- Memory: O(1) for the semaphore itself + O(K) for the waiter list. Each waiter consumes one `*list.Element` plus one `chan struct{}` (about 96 bytes total on 64-bit Go).
- Acquire fast path: one mutex acquire, one compare, one decrement, one mutex release — typically tens of nanoseconds.
- Acquire slow path: one mutex acquire, one list append, one mutex release, one channel receive — typically microseconds plus scheduling latency.
- Release: one mutex acquire, one decrement, a head-of-queue scan that closes at most `K` channels and dequeues them, one mutex release.

There is no internal goroutine. There is no internal timer. The semaphore performs no work unless a caller is in `Acquire` or `Release`.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| `Acquire(ctx, n)` with `n > N` | Blocks forever or until `ctx` cancels; returns `ctx.Err()`. |
| `Acquire(ctx, 0)` | Returns `nil` immediately, no change to `used`, no `Release` needed. |
| `TryAcquire(n)` with `n > N` | Returns `false`. |
| `TryAcquire` with non-empty `Q` and free capacity | Returns `false` to preserve FIFO. |
| `Release(0)` | Decrements by zero; scans the queue head; effectively a no-op. |
| `Release` more than acquired | Panics. |
| Concurrent `Acquire` and `Release` | Serialised by the internal mutex; outcome consistent with some linearised order. |
| `Acquire` from many goroutines with same weight | Granted strictly FIFO. |
| Heavy `Acquire` at head, light `Acquire` behind | Light one waits for heavy one — by design. |
| `Acquire` with already-cancelled ctx | Returns `ctx.Err()` immediately. |

---

## Compliance Checks

An implementation claiming compatibility with the `semaphore.Weighted` contract should pass:

1. **Single-thread invariant**: after any sequence of `Acquire`/`TryAcquire`/`Release` from one goroutine that balances out (every acquired weight is released), `used == 0`.
2. **FIFO ordering**: with `N = 1`, three sequential `Acquire(ctx, 1)` calls A, B, C from three goroutines (ordering established by a barrier) must be woken in A, B, C order regardless of when releases happen.
3. **Head-of-line blocking**: with `N = 10`, an `Acquire(ctx, 10)` followed by an `Acquire(ctx, 1)` while 1 unit is free still leaves the 1-unit caller blocked until the 10-unit caller's grant.
4. **Cancellation purity**: `Acquire` that returns `ctx.Err()` must leave `used` and `Q` exactly as if the call never enqueued.
5. **Release wake**: `Release` that frees enough capacity for the head waiter must wake exactly that waiter (and subsequent heads that also fit) before returning.
6. **Mass underflow**: `Release(n)` with `n` greater than current `used` panics.
7. **Memory model**: write-then-Release / Acquire-then-read race detector run must not flag the read.

---

## Reference Pseudocode

```go
type Weighted struct {
    mu    sync.Mutex
    size  int64
    cur   int64
    waiters list.List // of waiter{n int64, ready chan struct{}}
}

func (s *Weighted) Acquire(ctx context.Context, n int64) error {
    s.mu.Lock()
    if s.size-s.cur >= n && s.waiters.Len() == 0 {
        s.cur += n
        s.mu.Unlock()
        return nil
    }
    if n > s.size {
        // Wait only for ctx; we can never succeed.
        s.mu.Unlock()
        <-ctx.Done()
        return ctx.Err()
    }
    ready := make(chan struct{})
    w := waiter{n: n, ready: ready}
    elem := s.waiters.PushBack(w)
    s.mu.Unlock()

    select {
    case <-ctx.Done():
        s.mu.Lock()
        select {
        case <-ready:
            // We were granted exactly at cancellation. Release the grant so
            // others can proceed.
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
    for s.waiters.Len() > 0 {
        front := s.waiters.Front()
        w := front.Value.(waiter)
        if s.size-s.cur < w.n {
            return // head doesn't fit; do NOT skip it (FIFO)
        }
        s.cur += w.n
        s.waiters.Remove(front)
        close(w.ready)
    }
}
```

This pseudocode reflects the actual implementation closely enough that production reasoning can be done against it.

---

## Summary

The `semaphore.Weighted` contract is small, strict, and FIFO:

- Capacity `N` is fixed at construction.
- Each acquisition takes a weight; each release returns it.
- Cancellation never leaves the semaphore in an inconsistent state.
- FIFO ordering is mandatory; head-of-line blocking is a deliberate consequence.
- Releasing more than held panics.

Build mental models on this contract; the implementation faithfully realises it.
