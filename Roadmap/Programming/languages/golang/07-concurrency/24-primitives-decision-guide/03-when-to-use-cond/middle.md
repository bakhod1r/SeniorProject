---
layout: default
title: When to Use sync.Cond — Middle
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/middle/
---

# When to Use sync.Cond — Middle

[← Back](../)

## Table of Contents
1. [What this file assumes](#what-this-file-assumes)
2. [The three rules of sync.Cond](#the-three-rules-of-synccond)
3. [Why the wait must be a for loop](#why-the-wait-must-be-a-for-loop)
4. [Signal vs Broadcast](#signal-vs-broadcast)
5. [A correct bounded queue](#a-correct-bounded-queue)
6. [When a channel is the better answer](#when-a-channel-is-the-better-answer)
7. [The cases channels cannot express](#the-cases-channels-cannot-express)
8. [Lost wakeups and the lock discipline](#lost-wakeups-and-the-lock-discipline)
9. [Cancellation: Cond's weak spot](#cancellation-conds-weak-spot)
10. [Common middle-level mistakes](#common-middle-level-mistakes)
11. [Cheat sheet](#cheat-sheet)
12. [Self-assessment checklist](#self-assessment-checklist)
13. [Summary](#summary)
14. [Further reading](#further-reading)

---

## What this file assumes
You can:
- Explain that `sync.Cond` lets goroutines wait for a condition guarded by a mutex.
- Write a `Wait`/`Signal` pair that compiles.

You will learn here:
- The three non-negotiable rules for using `Cond` correctly.
- Exactly when a channel replaces `Cond` and when it cannot.
- How lost wakeups happen and why `Wait` must sit in a `for` loop.
- Why `Cond` and cancellation don't mix, and what to do about it.

---

## The three rules of sync.Cond

1. **Hold the lock around `Wait`, `Signal`, and `Broadcast`-adjacent state changes.** `Wait` atomically unlocks, blocks, and re-locks. You must hold `L` when you call it.
2. **Always re-check the condition in a `for` loop**, never an `if`. `Wait` can return without the condition being true (spurious-ish wakeups, multiple waiters racing for one item).
3. **Change the shared state under the lock, then signal.** Signal/Broadcast may be called with or without the lock held, but the state mutation that the waiters are testing must be protected.

```go
c.L.Lock()
for !condition() {
    c.Wait()
}
// condition() is true here, lock held
c.L.Unlock()
```

---

## Why the wait must be a for loop

Consider two consumers waiting on a queue and one producer that pushes a single item and calls `Signal`. Without a re-check:

```go
c.L.Lock()
if len(q) == 0 {   // BUG: if, not for
    c.Wait()
}
item := q[0]        // both consumers may reach here; second one indexes empty slice
q = q[1:]
c.L.Unlock()
```

`Signal` may wake one waiter, but by the time it re-acquires the lock another goroutine could have taken the item. The re-check in a `for` loop re-tests `len(q) == 0` after re-locking and goes back to sleep if the item is gone. This is the single most common `Cond` bug.

---

## Signal vs Broadcast

- **`Signal()`** wakes one waiting goroutine (if any). Use it when one state change satisfies exactly one waiter — e.g., one item pushed, one consumer can proceed.
- **`Broadcast()`** wakes all waiters. Use it when a state change might satisfy many waiters, or when waiters wait on *different* conditions over the same mutex — e.g., "configuration reloaded" should wake everyone so each re-checks its own predicate.

When in doubt, `Broadcast` is safe (everyone re-checks and most go back to sleep); `Signal` is an optimization you take only when you can prove exactly one waiter can make progress.

---

## A correct bounded queue

```go
type BoundedQueue struct {
    mu       sync.Mutex
    notEmpty *sync.Cond
    notFull  *sync.Cond
    items    []int
    capacity int
}

func New(capacity int) *BoundedQueue {
    q := &BoundedQueue{capacity: capacity}
    q.notEmpty = sync.NewCond(&q.mu)
    q.notFull = sync.NewCond(&q.mu)
    return q
}

func (q *BoundedQueue) Push(v int) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == q.capacity {
        q.notFull.Wait()
    }
    q.items = append(q.items, v)
    q.notEmpty.Signal()
}

func (q *BoundedQueue) Pop() int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.notEmpty.Wait()
    }
    v := q.items[0]
    q.items = q.items[1:]
    q.notFull.Signal()
    return v
}
```

Two condition variables share one mutex: one signals "space available", the other "item available". Each `Wait` is in a `for` loop. This is the canonical multi-condition `Cond` example.

---

## When a channel is the better answer

The bounded queue above is *exactly* a buffered channel:

```go
q := make(chan int, capacity)
q <- v       // Push: blocks while full
v := <-q     // Pop: blocks while empty
```

One line each, no `Cond`, no lock, integrates with `select` for timeouts and cancellation. **If your wake condition is "a value was added" or "a value was removed", use a channel.** The channel *is* a condition variable specialized for value handoff.

---

## The cases channels cannot express

`sync.Cond` earns its place when the wake condition is **not** a value transfer:

- **"Wake all waiters when the configuration is reloaded."** No value is handed to any specific waiter; everyone re-reads shared state.
- **"Wake when a shared counter crosses a threshold"** where multiple goroutines test *different* thresholds against the same state.
- **"Resume all paused workers when a global pause flag clears."**

```go
type Gate struct {
    mu     sync.Mutex
    cond   *sync.Cond
    open   bool
}

func (g *Gate) WaitOpen() {
    g.mu.Lock()
    for !g.open {
        g.cond.Wait()
    }
    g.mu.Unlock()
}

func (g *Gate) Open() {
    g.mu.Lock()
    g.open = true
    g.mu.Unlock()
    g.cond.Broadcast() // wake everyone waiting on the gate
}
```

A `close(chan struct{})` can model a one-shot gate, but `Cond` handles a gate that opens and closes repeatedly, which a channel cannot (you can't re-open a closed channel).

---

## Lost wakeups and the lock discipline

A **lost wakeup** happens when a `Signal` fires while no goroutine is yet in `Wait`, and the signal is simply discarded. `Cond` does not count signals. The defense is the lock discipline: because the waiter holds the lock while checking the condition and `Wait` releases it atomically, and the signaler changes state under the lock before signaling, a waiter cannot "miss" a state change — it either sees the new state on its `for`-check (and never sleeps) or is asleep and gets woken. Break the discipline (signal a state change without holding the lock during the mutation) and lost wakeups return.

---

## Cancellation: Cond's weak spot

`sync.Cond.Wait` cannot be cancelled. There is no `WaitContext`. A goroutine blocked in `Wait` stays blocked until signaled — even if its `context.Context` is cancelled. Workarounds:

- **Broadcast on shutdown.** Set a `closed` flag under the lock, `Broadcast`, and have each waiter's `for` loop also test the flag and return.

```go
func (q *BoundedQueue) Pop(ctx context.Context) (int, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        if q.closed {
            return 0, errClosed
        }
        q.notEmpty.Wait()
    }
    // ...
}

func (q *BoundedQueue) Close() {
    q.mu.Lock(); q.closed = true; q.mu.Unlock()
    q.notEmpty.Broadcast()
    q.notFull.Broadcast()
}
```

- **Prefer a channel** when per-operation timeout/cancellation matters, because `select { case v := <-ch: case <-ctx.Done(): }` is built for it. This is the most common reason senior engineers avoid `Cond` entirely.

---

## Common middle-level mistakes
1. **`if` instead of `for`** around `Wait` — the textbook lost-item bug.
2. **Calling `Wait` without holding `L`** — panics or corrupts state.
3. **Mutating shared state without the lock, then signaling** — reintroduces lost wakeups.
4. **`Signal` when multiple waiters could proceed** but only one is woken and it can't make progress — use `Broadcast`.
5. **Expecting `Wait` to honor a context** — it never does.
6. **Reaching for `Cond` when a buffered channel would do** — adds lock plumbing for no gain.

---

## Cheat sheet

| Situation | Use |
|---|---|
| Producer/consumer value handoff | buffered channel |
| One-shot "go" signal to many | `close(chan struct{})` |
| Repeatable open/close gate | `sync.Cond` + `Broadcast` |
| Wake all on shared-state change | `sync.Cond` + `Broadcast` |
| Wake exactly one that can proceed | `sync.Cond` + `Signal` |
| Need per-wait timeout/cancel | channel + `select`, not `Cond` |

---

## Self-assessment checklist
- [ ] I always wrap `Wait` in a `for` loop and can explain why.
- [ ] I hold the lock around `Wait` and the state mutation.
- [ ] I can choose `Signal` vs `Broadcast` with a reason.
- [ ] I can rewrite a `Cond` queue as a channel and know when not to.
- [ ] I can name a wake condition that channels cannot express.
- [ ] I know `Wait` ignores context and how to add shutdown.

---

## Summary
`sync.Cond` is for waiting on an arbitrary condition over shared state guarded by a mutex. Three rules keep it correct: hold the lock, re-check in a `for` loop, mutate-then-signal. Use `Signal` for one-waiter-can-proceed and `Broadcast` for everyone-re-checks. Most "wait for an item" problems are really channels in disguise — reach for `Cond` only when the wake condition is not a value handoff (repeatable gates, shared-state thresholds, config reloads). Its fatal weakness is cancellation: `Wait` ignores context, so when per-operation timeouts matter, a channel wins.

In `senior.md` we'll look at where `Cond` actually survives in production code, how to wrap it safely behind an API, and the measured cases where it beats both channels and busy-polling.

---

## Further reading
- `sync.Cond` docs — https://pkg.go.dev/sync#Cond
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (argues for channels over Cond)
- `src/sync/cond.go` — short and worth reading
- The Go Memory Model — https://go.dev/ref/mem

---

[← Back](../)
