# sync.Cond — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Source: `src/sync/cond.go`](#the-source-srcsynccondgo)
3. [`notifyList` — the Heart of Cond](#notifylist-the-heart-of-cond)
4. [`runtime_notifyListAdd` and Ticket Allocation](#runtime_notifylistadd-and-ticket-allocation)
5. [`runtime_notifyListWait` — Park and Unpark](#runtime_notifylistwait-park-and-unpark)
6. [`runtime_notifyListNotifyOne` and `NotifyAll`](#runtime_notifylistnotifyone-and-notifyall)
7. [The Futex / Semaphore Layer](#the-futex-semaphore-layer)
8. [Memory Model Reasoning](#memory-model-reasoning)
9. [`copyChecker` and the noCopy Guard](#copychecker-and-the-nocopy-guard)
10. [Allocation Behavior and Inlining](#allocation-behavior-and-inlining)
11. [Why the Discipline Rules Exist](#why-the-discipline-rules-exist)
12. [Summary](#summary)

---

## Introduction

`sync.Cond` is a thin user-space wrapper around a small set of runtime primitives. To understand why the discipline rules are non-negotiable — why `Wait` must be in a `for` loop, why the lock must be held, why `Signal` outside the lock is dangerous — you have to look under the hood. This file walks the actual source code of `sync.Cond` and the runtime functions it calls, and explains what the bits do.

Everything below is true of Go 1.21+. Implementation details vary slightly across versions; the *contract* has been stable since Go 1.0.

---

## The Source: `src/sync/cond.go`

The implementation is short — roughly 100 lines. Stripped of comments and copy-check plumbing:

```go
type Cond struct {
    noCopy noCopy
    L      Locker
    notify notifyList
    checker copyChecker
}

func NewCond(l Locker) *Cond {
    return &Cond{L: l}
}

func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify)
    c.L.Unlock()
    runtime_notifyListWait(&c.notify, t)
    c.L.Lock()
}

func (c *Cond) Signal() {
    c.checker.check()
    runtime_notifyListNotifyOne(&c.notify)
}

func (c *Cond) Broadcast() {
    c.checker.check()
    runtime_notifyListNotifyAll(&c.notify)
}
```

Four user-facing operations. Each delegates to runtime functions defined in `runtime/sema.go`. The `Cond` itself holds:

- `noCopy noCopy` — `go vet` hint to prevent value copies.
- `L Locker` — the lock the user supplied.
- `notify notifyList` — the runtime-managed wait list and ticket counters.
- `checker copyChecker` — a runtime check that the `Cond` has not been copied.

Everything interesting happens in `notifyList` and the four `runtime_notifyList*` functions.

---

## `notifyList` — the Heart of Cond

Defined in `runtime/sema.go`:

```go
type notifyList struct {
    wait   atomic.Uint32   // next ticket to be issued
    notify uint32          // next ticket to be notified
    lock   mutex           // runtime mutex protecting the list
    head   *sudog          // linked list head
    tail   *sudog          // linked list tail
}
```

Four critical fields:

- **`wait`** — monotonically increasing counter, the *next ticket number*. Incremented on every `Wait`.
- **`notify`** — the *highest ticket number that has been notified*. When a goroutine wakes, it compares its ticket to `notify`.
- **`lock`** — a runtime-internal mutex (not `sync.Mutex`), used to protect `head`, `tail`, and `notify`.
- **`head`, `tail`** — a doubly-linked list of `sudog`s (the runtime's "scheduling user-data G" struct, used for parking goroutines).

The list is a *queue of parked goroutines*. Each `sudog` carries the goroutine pointer and a ticket. The list is built in order: when a goroutine waits, it appends a `sudog` with its ticket to the tail.

The crucial property: tickets are monotonic. This gives the runtime a way to distinguish "old" waiters (already notified, should wake) from "new" waiters (parked after the notification, should remain parked).

---

## `runtime_notifyListAdd` and Ticket Allocation

The first half of `Wait`:

```go
func notifyListAdd(l *notifyList) uint32 {
    t := l.wait.Add(1) - 1
    return t
}
```

Allocates a new ticket. `l.wait.Add(1) - 1` reserves the next ticket, atomically. This call does *not* touch the lock or the linked list — it is just an atomic increment.

Why allocate the ticket *before* unlocking the user's mutex? Because the user holds `cond.L` at this point. If we allocated after the unlock, a `Signal` could fire between unlock and allocate, miss us, and we'd park forever. By allocating under the user's lock, we guarantee that any subsequent `Signal` sees our ticket as "outstanding."

So the ticket is the bridge: it is claimed under `cond.L`, and the `Signal` checks "any ticket ≥ `notify` to wake?" without needing `cond.L`.

---

## `runtime_notifyListWait` — Park and Unpark

The second half of `Wait`:

```go
func notifyListWait(l *notifyList, t uint32) {
    lockf(&l.lock)
    if less(t, l.notify) {
        unlockf(&l.lock)
        return       // already notified before we could park
    }
    s := acquireSudog()
    s.g = getg()
    s.ticket = t
    // append s to the linked list
    if l.tail == nil {
        l.head = s
    } else {
        l.tail.next = s
    }
    l.tail = s
    goparkunlock(&l.lock, ...)   // unlocks l.lock, parks the goroutine
    releaseSudog(s)
}
```

What it does:

1. Acquires the runtime lock `l.lock`.
2. Checks: if our ticket `t` was *already notified* (notification happened between `notifyListAdd` and now), we skip parking and return immediately.
3. Otherwise, allocates a `sudog` for this goroutine, links it into the wait list.
4. Calls `goparkunlock` — this is the runtime primitive that atomically:
   - Releases `l.lock`.
   - Parks the goroutine.

When the goroutine eventually wakes (because some `Signal` or `Broadcast` marked the `sudog` as ready), it resumes after `goparkunlock`, releases its `sudog`, and returns from `notifyListWait`. Back in `Wait`, the final step is `c.L.Lock()` — re-acquire the user's mutex.

The race-prevention here is subtle. Between `runtime_notifyListAdd` and `runtime_notifyListWait`, the user's lock `c.L` is released (the `c.L.Unlock()` call in `Wait`). A `Signal` could fire in this window, incrementing `notify` past our ticket. The `if less(t, l.notify)` check in `notifyListWait` catches this case: we never park, we just return immediately. Without that check, we'd park on a signal that already happened.

---

## `runtime_notifyListNotifyOne` and `NotifyAll`

`Signal`:

```go
func notifyListNotifyOne(l *notifyList) {
    if l.wait.Load() == atomic.LoadUint32(&l.notify) {
        return  // no waiters
    }
    lockf(&l.lock)
    t := l.notify
    for s := l.head; s != nil; s = s.next {
        if s.ticket == t {
            // unlink s from list
            l.notify = t + 1
            readyWithTime(s, ...)   // make s.g runnable
            unlockf(&l.lock)
            return
        }
    }
    // no eligible waiter; advance notify anyway
    l.notify++
    unlockf(&l.lock)
}
```

What it does:

1. Quick check: if `wait == notify`, no one is waiting. Return.
2. Lock `l.lock`.
3. Scan the linked list for the first `sudog` whose ticket equals the current `notify`.
4. If found: increment `notify`, unlink the `sudog`, mark its goroutine runnable.
5. If not found: still increment `notify` so future `Wait` calls with that ticket will not park.

`Broadcast`:

```go
func notifyListNotifyAll(l *notifyList) {
    if l.wait.Load() == atomic.LoadUint32(&l.notify) {
        return
    }
    lockf(&l.lock)
    s := l.head
    l.head = nil
    l.tail = nil
    atomic.StoreUint32(&l.notify, l.wait.Load())
    unlockf(&l.lock)
    // wake all
    for ; s != nil; s = s.next {
        readyWithTime(s, ...)
    }
}
```

Sets `notify` to `wait` — all outstanding tickets are now notified. Detaches the entire wait list, walks it, marks every goroutine runnable.

The asymmetry between `Signal` and `Broadcast` is small: both scan the list, but `Signal` stops at the first match while `Broadcast` walks all. `Broadcast` is therefore O(N) in the number of waiters; `Signal` is O(N) in the worst case but typically O(1) because the head of the list is usually the next waiter.

---

## The Futex / Semaphore Layer

`goparkunlock` and `readyWithTime` are themselves implemented on top of OS primitives:

- **Linux**: `futex` syscall via `runtime/lock_futex.go`.
- **macOS, BSD**: `pthread_cond_wait` via `runtime/lock_sema.go`.
- **Windows**: `WaitForSingleObject` and semaphores.

The Go runtime abstracts these into a unified "park / unpark" interface. Calling `goparkunlock` ultimately reaches into the OS to suspend the thread (if no other goroutine is runnable). Calling `readyWithTime` enqueues the goroutine on a run queue and wakes the corresponding thread if needed.

This layering is why `Cond` operations are fast: the runtime keeps the wait list in user space and only touches the OS when a thread truly needs to block. A `Signal` that finds a runnable waiter without blocking takes hundreds of nanoseconds; one that needs an actual OS wakeup takes a few microseconds.

---

## Memory Model Reasoning

The Go memory model says: "The n'th call to `c.Signal()` happens before the return of the n'th call to `c.Wait()` that does not block earlier than the call to `c.Signal()`."

Decoded:

- A `Signal` synchronizes with the `Wait` it wakes.
- Writes done by the signaller *before* `Signal` are visible to the waiter *after* `Wait` returns.

In practice this is mediated by:

- The user-supplied lock `cond.L`: writes happen under it, reads happen under it, so unlock-lock provides the memory edge.
- The internal `l.lock`: provides the atomic transition between "ticket allocated" and "ticket notified."

If you signal *outside* `cond.L`, you lose the user-level memory edge. The waiter still wakes, but the state changes you made may not be visible (the runtime's internal sync handles the wait list, not your data). The visibility depends on the lock, which is why "signal under the lock" is the rule.

---

## `copyChecker` and the noCopy Guard

```go
type copyChecker uintptr

func (c *copyChecker) check() {
    if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
        !atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
        uintptr(*c) != uintptr(unsafe.Pointer(c)) {
        panic("sync.Cond is copied")
    }
}
```

`copyChecker` stores its own address. On every operation it checks "am I still at the address I was first used at?" If not, the `Cond` has been copied to a new location — its `notifyList` and any parked goroutines are now inconsistent with the new instance.

The check is a runtime safety net. The compile-time check is `noCopy`, a zero-size type with a `Lock` method that `go vet` recognizes:

```go
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

`go vet`'s `copylocks` checker flags any code that copies a struct containing `noCopy`. Combined with `copyChecker`, this gives you both compile-time warnings and runtime panics.

Lesson: never store `sync.Cond` by value. Always `*sync.Cond`.

---

## Allocation Behavior and Inlining

`Cond` operations allocate zero heap memory in the common path:

- `NewCond` allocates one `*sync.Cond` (heap).
- `Wait` allocates one `sudog` from a free list (`acquireSudog` reuses from a pool).
- `Signal` and `Broadcast` allocate nothing.

The `sudog` pool is per-P (per scheduler-processor), so contention on the pool is minimal. Repeated `Wait` calls on the same `Cond` recycle `sudog`s through the pool.

The Go compiler does *not* inline `Wait`, `Signal`, or `Broadcast` — they call into the runtime, which is across the inlining boundary. Each call is a real function call. The cost of an uncontended `Signal` is dominated by the atomic load and the function call; under contention the cost grows with the wait list scan.

---

## Why the Discipline Rules Exist

Now the rules make sense:

### "Hold the lock around `Wait`"

`Wait` calls `c.L.Unlock()`. If the lock isn't held, the unlock panics. The lock also provides the memory edge for state visibility.

### "Hold the lock around `Signal`"

Without the lock, a waiter could re-check the predicate, find it false, park; meanwhile our state change was already done. The signal then fires to a waiter who *just* parked and missed it. Holding the lock around the state change and the signal collapses this window.

### "Use a `for` loop"

The runtime's `notifyListWait` may return spuriously (it does not, in current versions, but the API permits it). More importantly, between the signal that woke us and our re-acquisition of `cond.L`, another waiter may have taken the lock and consumed the state change. Re-checking the predicate is mandatory.

### "Use `*sync.Cond`, not value"

`copyChecker` panics if the `Cond` is at a different address than first use. `noCopy` triggers `go vet`. A copied `Cond` has an empty wait list and parks waiters that nobody will signal.

### "Use `Broadcast` for class-of-state changes"

Multiple waiters with different predicates might all be waiting on `cond.L`. A `Signal` wakes exactly one; the wrong predicate may be picked. `Broadcast` wakes all; each re-checks; the right one proceeds.

### "Use one `Cond` per predicate"

Same reason: a single `Cond` for two predicates means every signal wakes waiters of both predicates, half of whom re-park. Inefficient.

---

## Summary

`sync.Cond` is approximately 100 lines of user-space code on top of `notifyList` and four runtime functions. The `notifyList` is a ticket-and-linked-list wait queue. The ticket mechanism prevents lost wake-ups: tickets allocated under `cond.L` are observed by `Signal` via `l.notify`, so a `Signal` that fires "before" the `Wait` parks still notifies the right ticket.

The memory model is built on the user's mutex `cond.L`. Holding the lock around state changes and signals provides the happens-before edge that makes the data visible to the waker.

The runtime ultimately calls into OS primitives (`futex` on Linux, `pthread_cond_wait` elsewhere) only when a thread truly needs to block. The hot path is fast: an atomic increment, a list-head check, a wakeup.

Most of the discipline rules — `for` loop, lock-around-signal, never-copy — are direct consequences of the implementation. Once you have read the source, the rules feel inevitable.

For day-to-day code, the lesson is the same as at the senior level: prefer channels. `Cond` is the small, sharp tool when channels don't fit, and the runtime makes it reasonably fast — but the implementation does not magically prevent misuse, and Go's channel primitives offer similar performance with much friendlier ergonomics.
