---
layout: default
title: When to Use sync.Cond — Specification
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/specification/
---

# When to Use sync.Cond — Specification

[← Back](../)

## 1. The official `sync.Cond` type

The verbatim shape of the type from `src/sync/cond.go` (Go 1.22):

```go
// Cond implements a condition variable, a rendezvous point
// for goroutines waiting for or announcing the occurrence
// of an event.
//
// Each Cond has an associated Locker L (often a *Mutex or *RWMutex),
// which must be held when changing the condition and
// when calling the Wait method.
//
// A Cond must not be copied after first use.
//
// In the terminology of the Go memory model, Cond arranges that
// a call to Broadcast or Signal "synchronizes before" any Wait call
// that it unblocks.
//
// For many simple use cases, users will be better off using channels
// than a Cond (Broadcast corresponds to closing a channel, and
// Signal corresponds to sending on a channel).
//
// For more on replacements for sync.Cond, see Roberto Clapis's series on
// advanced concurrency patterns, as well as Bryan Mills's talk on
// concurrency patterns.
type Cond struct {
    noCopy noCopy

    L Locker // held while observing or changing the condition

    notify  notifyList
    checker copyChecker
}
```

The `noCopy` marker is checked by `go vet`. The `copyChecker` is checked at runtime by `Wait`, `Signal` and `Broadcast` themselves: copying a `Cond` after first use will panic with `sync.Cond is copied`.

## 2. The constructor

```go
// NewCond returns a new Cond with Locker l.
func NewCond(l Locker) *Cond {
    return &Cond{L: l}
}
```

A `Cond` can also be constructed as a zero value plus an assigned `L`:

```go
var c sync.Cond
c.L = &mu
```

The two are functionally equivalent. The standard library uses both forms; `io.Pipe` for example uses the zero value form (see `src/io/pipe.go`).

## 3. The Locker interface

`sync.Locker` is the contract that the field `L` satisfies:

```go
type Locker interface {
    Lock()
    Unlock()
}
```

Both `*sync.Mutex` and `*sync.RWMutex` satisfy `Locker`. In the RWMutex case, `Wait()` releases and re-acquires whichever mode you previously took (`Lock`/`Unlock` or `RLock`/`RUnlock` — but you must pass a *consistent* facade). The standard library convention is to pass `rwmu.RLocker()` if waiters take read locks:

```go
mu := &sync.RWMutex{}
c := sync.NewCond(mu.RLocker())
mu.RLock()
for !ready { c.Wait() }
mu.RUnlock()
```

This is rarely a good idea — it mixes the read and write locking domains in ways that are easy to misread.

## 4. `Wait` semantics

```go
// Wait atomically unlocks c.L and suspends execution
// of the calling goroutine. After later resuming execution,
// Wait locks c.L before returning. Unlike in other systems,
// Wait cannot return unless awoken by Broadcast or Signal.
//
// Because c.L is not locked while Wait is waiting, the caller
// typically cannot assume that the condition is true when
// Wait returns. Instead, the caller should Wait in a loop:
//
//    c.L.Lock()
//    for !condition() {
//        c.Wait()
//    }
//    ... make use of condition ...
//    c.L.Unlock()
func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify)
    c.L.Unlock()
    runtime_notifyListWait(&c.notify, t)
    c.L.Lock()
}
```

The body shows the canonical condition-variable protocol implemented in three runtime calls:

1. `runtime_notifyListAdd` reserves a ticket on the notify list while the lock is still held. This is the key atomicity guarantee: a `Signal` or `Broadcast` that happens-after the ticket allocation cannot be missed.
2. `c.L.Unlock()` releases the user lock so other goroutines can change the predicate.
3. `runtime_notifyListWait` parks the goroutine on the runtime's notify list until matched.
4. `c.L.Lock()` re-acquires the lock before returning, so the predicate check after `Wait` happens under the lock.

The Go runtime implementation lives in `src/runtime/sema.go` (`notifyListAdd`, `notifyListWait`, `notifyListNotifyOne`, `notifyListNotifyAll`). The notify list is a FIFO queue keyed by monotonically increasing ticket numbers.

### 4.1 Wait is not optional

There is no `WaitTimeout`, `WaitCtx`, or `WaitWithCancellation` method. There never has been. If you need a timeout, you must implement it externally — and the canonical implementation is to run a side-goroutine that broadcasts on a timer:

```go
go func() {
    select {
    case <-ctx.Done():
        c.L.Lock()
        cancelled = true
        c.L.Unlock()
        c.Broadcast()
    }
}()
```

Then waiters must check both the predicate *and* `cancelled` in their loop. This is why the Go team usually recommends just using channels for cancellable rendezvous.

## 5. `Signal` semantics

```go
// Signal wakes one goroutine waiting on c, if there is any.
//
// It is allowed but not required for the caller to hold c.L
// during the call.
//
// Signal() does not affect goroutine scheduling priority; if other
// goroutines are attempting to lock c.L, they may be awoken before
// a "waiting" goroutine.
func (c *Cond) Signal() {
    c.checker.check()
    runtime_notifyListNotifyOne(&c.notify)
}
```

Three contractual points:

- Wakes *exactly one* waiter, FIFO by arrival ticket.
- If there is no waiter, `Signal` is a no-op. This is unlike channels, where a send blocks (unbuffered) or fills the buffer.
- The caller may but need not hold the lock. Best practice is to hold the lock: it makes the order of operations easy to reason about (`change predicate; Signal; unlock`).

## 6. `Broadcast` semantics

```go
// Broadcast wakes all goroutines waiting on c.
//
// It is allowed but not required for the caller to hold c.L
// during the call.
func (c *Cond) Broadcast() {
    c.checker.check()
    runtime_notifyListNotifyAll(&c.notify)
}
```

Wakes every goroutine currently parked on the notify list. After `Broadcast`, all waiters will eventually return from `Wait` (each re-acquires `L` on the way out — they do not all run simultaneously). Choice of `Signal` vs `Broadcast`:

- Use `Signal` when at most one waiter could make progress with the current predicate change. Common in single-producer/single-consumer rings.
- Use `Broadcast` when multiple waiters could make progress, or when waiters are waiting on different predicates over the same lock.
- **When in doubt, use `Broadcast`.** Wasted wakeups are cheap (the loop re-tests the predicate and goes back to sleep); lost wakeups are correctness bugs.

## 7. The "spurious wakeup" question

In POSIX, `pthread_cond_wait` is permitted to return without any signal — a *spurious wakeup* — for implementation reasons. The POSIX specification (IEEE Std 1003.1) explicitly states:

> When using condition variables there is always a Boolean predicate involving shared variables associated with each condition wait that is true if the thread should proceed. Spurious wakeups from the `pthread_cond_wait()` or `pthread_cond_timedwait()` functions may occur.

In Go, the docstring says:

> Unlike in other systems, Wait cannot return unless awoken by Broadcast or Signal.

So Go condition variables do *not* permit spurious wakeups in the POSIX sense. But you must still wrap `Wait` in a loop, for a different reason: between the moment the waker calls `Signal` (or `Broadcast`) and the moment the woken goroutine returns from `Wait`, another goroutine can grab the lock and change the predicate back. This is sometimes called the "stolen wakeup" problem. The cure is identical to the POSIX cure — re-check the predicate inside the loop:

```go
c.L.Lock()
for !ready {       // loop, not if
    c.Wait()
}
// ready is true; lock is held
c.L.Unlock()
```

A single `if` instead of `for` is a real, common bug. We dedicate a section to it in find-bug.md.

## 8. Memory model

The `sync.Cond` docstring contains a precise memory-model statement:

> In the terminology of the Go memory model, Cond arranges that a call to Broadcast or Signal "synchronizes before" any Wait call that it unblocks.

This means writes happening-before `Signal`/`Broadcast` in program order are visible to the goroutine after it returns from `Wait`. This is the same flavor of release/acquire ordering you get from `Mutex.Unlock` / `Mutex.Lock`. The Go memory model document (`go.dev/ref/mem`) lists `sync.Cond` under "Sync package" with the rule:

> The nth call to c.Wait that returns is synchronized after the nth call to c.Notify (Signal or Broadcast) that wakes it.

## 9. The `noCopy` field and `copyChecker`

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

On first use, `Wait`/`Signal`/`Broadcast` CAS-write the `Cond`'s own address into the `copyChecker` word. On subsequent uses, the recorded address is compared with the actual address. If the `Cond` has been copied, the addresses differ, and the method panics. This is a runtime detector for what `go vet`'s `copylocks` analyzer detects at compile time via the `noCopy` marker.

`noCopy` itself is defined in `src/sync/cond.go`:

```go
// noCopy may be added to structs which must not be copied
// after the first use.
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from `go vet`.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

The trick is that `go vet` sees a struct embedding a `Locker`, infers "this must not be copied", and flags any pass-by-value or assignment.

## 10. Why no `WaitContext`?

The Go team has had several discussions on adding context cancellation to `sync.Cond`. The consensus is: if you need cancellation, you almost certainly should be using a channel. A condition variable's API only makes sense if the predicate is checked under a lock — but cancellation is an out-of-band event with no natural place in the predicate. Adding `WaitContext` would require either (a) a separate notify list per context, blowing up the simple FIFO design, or (b) waking all waiters periodically to check context, which defeats the purpose of parking. See issue [#16620](https://github.com/golang/go/issues/16620) for the discussion.

## 11. POSIX context

The condition variable pattern goes back to Brinch Hansen and Hoare in the 1970s. The POSIX version (`pthread_cond_t`) added three things over the original:

- An associated mutex passed into `pthread_cond_wait`, so the "atomic unlock-and-park" sequence has no race.
- `pthread_cond_signal` (one waiter) and `pthread_cond_broadcast` (all waiters) as separate calls.
- `pthread_cond_timedwait` for bounded waits.

Go's `sync.Cond` matches POSIX on the first two and explicitly omits the third. Go also tightens the contract by forbidding spurious wakeups. The reason the API surface is so small is partly historical (it was added very early in Go's life) and partly philosophical (channels are the preferred abstraction). The `sync.Cond` docstring's last paragraph, "For many simple use cases, users will be better off using channels," is a tell.

## 12. The `notifyList` runtime type

For completeness, here is the runtime-side data structure from `src/runtime/sema.go`:

```go
type notifyList struct {
    wait   atomic.Uint32 // ticket number of next waiter
    notify uint32        // ticket number of next waiter to be notified
    lock   uintptr       // futex-style spinlock
    head   *sudog        // FIFO of parked goroutines
    tail   *sudog
}
```

`sudog` is the runtime's "goroutine waiting on something" struct, reused by channels and `sync.Mutex` and most other blocking primitives.

## 13. Summary table

| Aspect | `sync.Cond` |
|---|---|
| Wait without signal? | Not allowed (no spurious wakeups). Still must loop. |
| Multiple-waiter wakeup? | `Broadcast` |
| Single-waiter wakeup? | `Signal` (no-op if no waiter) |
| Timeout/cancel? | Not built-in; emulate via side broadcaster |
| Copy safety? | `noCopy` + runtime checker (panics) |
| Locker type? | Any `sync.Locker` (typically `*sync.Mutex`) |
| Released by? | `Wait` releases on entry, re-acquires on exit |
| Memory model? | Signal/Broadcast synchronizes-before unblocked Wait |
| Equivalent in channels? | `Broadcast` ≈ `close(ch)`; `Signal` ≈ `ch <- struct{}{}` |

## 14. Pointers into the standard library

If you want to read concrete, correct, production uses of `sync.Cond`, the canonical references in the Go tree are:

- `src/io/pipe.go` — Bidirectional reader/writer using a single mutex and two Conds (or one Cond, depending on Go version).
- `src/os/exec/exec.go` — Used in older versions to coordinate stdout/stderr capture. (Removed in recent Go in favor of channels.)
- `src/net/http/server.go` — `connReader` historically used Cond for read-blocking; modern code uses channels.
- `src/runtime/proc.go` — *Not* using `sync.Cond` (it predates it), but `notifyList` itself.
- `src/sync/cond.go` — The implementation itself; the file is under 100 lines.

A useful reading exercise: clone the Go tree, run `grep -rn 'sync.NewCond' src/` and you will find fewer than ten real usages. That alone is the most honest argument for "prefer channels."

## 15. Runtime details that matter for reasoning

The Go runtime implements `sync.Cond`'s park/wake on the same `sudog` (suspended-G) infrastructure used by channels and `sync.Mutex`. Specifically:

- `runtime_notifyListAdd` acquires a fresh ticket by atomically incrementing `notifyList.wait`. This is a single atomic operation; it does not allocate.
- `runtime_notifyListWait` looks up the head of the FIFO, may sleep (`gopark`), and on wake, removes the matched sudog. Allocation of `sudog` is satisfied from a per-P pool (`sched.sudogcache`), so the steady-state cost is two atomic ops and a futex.
- `runtime_notifyListNotifyOne` walks the FIFO from the smallest unprocessed ticket and matches the first waiter; the ticket numbers form a monotonically increasing sequence so signal is O(1) amortized.
- `runtime_notifyListNotifyAll` walks the entire list, calling `goready` on each.

The implementation predates Go's modern channel runtime by years and is conservative. There is nothing exotic happening — the cost difference vs channels is mostly the extra round-trip through your user-space mutex.

## 16. The `Locker` interface revisited

`sync.Locker` is just `Lock()` + `Unlock()`. Anything satisfying that interface can be the Cond's L. Beyond `sync.Mutex` and `*sync.RWMutex` (with `.RLocker()`), you sometimes see custom Lockers used in tests or for instrumented mutexes. Be careful: the Cond's `Wait` calls `Unlock` then `Lock`. If your custom Locker has any asymmetry (counts only, e.g.), Cond will misbehave.

A useful idiom: a Locker that records lock acquisition for race-debugging:

```go
type instrumentedMutex struct {
    sync.Mutex
    holder atomic.Int64 // goid of holder, for debugging
}
func (m *instrumentedMutex) Lock()   { m.Mutex.Lock(); m.holder.Store(currentGoid()) }
func (m *instrumentedMutex) Unlock() { m.holder.Store(0); m.Mutex.Unlock() }

c := sync.NewCond(&instrumentedMutex{})
```

This works because `instrumentedMutex` is a valid `Locker`. Just remember that the Cond will call your `Unlock` during `Wait`; do not put expensive bookkeeping there.

## 17. Equivalence table: Cond operations vs channel operations

For a "one event, fan-out to all waiters" pattern:

| Cond | Channel |
|---|---|
| `c.L.Lock(); done = true; c.Broadcast(); c.L.Unlock()` | `close(doneCh)` |
| `c.L.Lock(); for !done { c.Wait() }; c.L.Unlock()` | `<-doneCh` |

For a "one event, fan-out to one waiter" pattern (queue-shaped):

| Cond | Channel |
|---|---|
| Push: `c.L.Lock(); data = append(...); c.Signal(); c.L.Unlock()` | `ch <- v` |
| Pop: `c.L.Lock(); for len(data)==0 { c.Wait() }; v := data[0]; data=data[1:]; c.L.Unlock()` | `v := <-ch` |

The channel forms are not just shorter — they integrate with `select` for cancellation and timeout, which Cond does not.

[← Back](../)
