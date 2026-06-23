---
layout: default
title: Specification
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/specification/
---

# Wait-for-Empty-Channel — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [`len(ch)` Semantics](#lench-semantics)
3. [`cap(ch)` Semantics](#capch-semantics)
4. [Channel Send Semantics](#channel-send-semantics)
5. [Channel Receive Semantics](#channel-receive-semantics)
6. [Channel Close Semantics](#channel-close-semantics)
7. [Channel Range Semantics](#channel-range-semantics)
8. [Select Statement Semantics](#select-statement-semantics)
9. [Nil Channel Semantics](#nil-channel-semantics)
10. [Memory Model: Happens-Before Edges](#memory-model-happens-before-edges)
11. [Race Detector Behaviour](#race-detector-behaviour)
12. [`sync.WaitGroup` Specification](#syncwaitgroup-specification)
13. [`sync.Mutex` Specification](#syncmutex-specification)
14. [`sync.RWMutex` Specification](#syncrwmutex-specification)
15. [`sync.Cond` Specification](#synccond-specification)
16. [`sync.Once` Specification](#synconce-specification)
17. [`sync/atomic` Specification](#syncatomic-specification)
18. [`context.Context` Specification](#contextcontext-specification)
19. [`context.Done()` Semantics](#contextdone-semantics)
20. [`context.Err()` Semantics](#contexterr-semantics)
21. [`errgroup.Group` Reference](#errgroupgroup-reference)
22. [`semaphore.Weighted` Reference](#semaphoreweighted-reference)
23. [References](#references)

---

## Introduction

This file is a reference. It quotes the relevant portions of the Go language specification, standard library documentation, and the official memory model, organised around the wait-for-empty-channel anti-pattern. It is not intended to be read end-to-end; bookmark it and consult the relevant section when a question arises.

All quotations are from the Go specification version current as of this writing (Go 1.23). The memory model document referenced is dated 2022-07-23 (subject to minor revisions). Where the source disagrees with this file, the source wins.

---

## `len(ch)` Semantics

From the Go specification, section "Length and capacity":

> The built-in functions `len` and `cap` take arguments of various types and return a result of type int. The implementation guarantees that the result always fits into an int.

For a channel argument, `len(s)`:

> The number of elements in channel buffer (unread); if `s` is nil, len(s) is zero.

### Behaviour summary

- For an unbuffered channel, `len(ch)` always returns 0.
- For a buffered channel, `len(ch)` returns the number of values currently in the buffer that have not yet been received.
- For a nil channel, `len(ch)` returns 0.
- For a closed channel, `len(ch)` returns the count of values not yet received; this drops to 0 once all values are drained.

### Synchronisation properties

- `len(ch)` is *not* a synchronising operation in the memory-model sense.
- It does not create a happens-before edge.
- It reads the channel's internal counter, which is updated under the channel's mutex, but the read is non-synchronising.

### Implication

The result of `len(ch)` is a snapshot. It may be stale by the time you use it. Two consecutive calls may return different values without any send or receive happening between them (if a concurrent goroutine performed a send or receive).

---

## `cap(ch)` Semantics

From the Go specification:

> For a channel argument, `cap(s)` returns the channel buffer capacity, in units of elements; if `s` is nil, cap(s) is zero.

### Behaviour summary

- For an unbuffered channel, `cap(ch)` returns 0.
- For a buffered channel, `cap(ch)` returns the size declared at `make(chan T, N)`.
- For a nil channel, `cap(ch)` returns 0.
- The capacity is fixed at channel creation; it cannot change.

### Synchronisation properties

- `cap(ch)` is essentially a compile-time-known constant once the channel is created.
- It is not a synchronising operation.

### Implication

`cap(ch)` is safe to call from any goroutine and always returns the same value (assuming the channel reference is valid). It is rarely useful for synchronisation because it does not vary with the channel's state.

---

## Channel Send Semantics

From the Go specification, "Send statements":

> A send statement sends a value on a channel. The channel expression's core type must be a channel, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type.
>
> Both the channel and the value expression are evaluated before communication begins. Communication blocks until the send can proceed. A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever.

### Behaviour summary

- Send on closed channel: panic.
- Send on nil channel: blocks forever.
- Send on full buffered channel: blocks until room.
- Send on unbuffered channel: blocks until a receiver is ready.
- Send on partially full buffered channel: proceeds immediately.

### Synchronisation properties

From the memory model:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

This is a happens-before edge. Every write made before the send is visible to whoever does the corresponding receive.

---

## Channel Receive Semantics

From the Go specification, "Receive operator":

> The expression x = <-ch yields a value received from the channel ch. The expression blocks until a value is available. Receiving from a nil channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received.
>
> The expression x, ok = <-ch reads a value into x and stores in ok a boolean value indicating whether the communication succeeded. The value of ok is true if the value received was delivered by a successful send operation to the channel, or false if it is a zero value generated because the channel is closed and empty.

### Behaviour summary

- Receive from open empty channel: blocks until a send.
- Receive from closed empty channel: returns zero value immediately, ok=false.
- Receive from closed non-empty channel: returns next value, ok=true.
- Receive from nil channel: blocks forever.

### Synchronisation properties

From the memory model:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

Every write before the send is visible to the goroutine that performs the receive.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Every write before `close(ch)` is visible to the goroutine whose receive returns zero-value-with-ok-false.

---

## Channel Close Semantics

From the Go specification, "Close":

> The built-in function close(ch) records that no more values will be sent on the channel. It is an error if c is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic. After calling close, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking. The multi-valued receive operation returns a received value along with an indication of whether the channel is closed.

### Behaviour summary

- Close on nil channel: panic.
- Close on already-closed channel: panic.
- Close on receive-only channel (compile-time): error.
- Close on send-only channel: allowed (it's the sender closing).
- Send on closed channel: panic.
- Receive on closed channel: returns zero value, ok=false.

### Synchronisation properties

From the memory model:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

The close itself is the synchronisation event. All writes before close are visible to anyone whose receive returns due to the close.

---

## Channel Range Semantics

From the Go specification, "For statements with range clause":

> For channels, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is nil, the range expression blocks forever.

### Behaviour summary

- `for v := range ch` receives values until `ch` is closed and the buffer is empty.
- When closed and empty, the loop exits.
- If `ch` is nil, the loop blocks forever.
- Each iteration is a receive operation; the same happens-before rules apply.

### Synchronisation properties

Each value received in a range loop is synchronised with its corresponding send. The loop exit is synchronised with the close.

---

## Select Statement Semantics

From the Go specification, "Select statements":

> A "select" statement chooses which of a set of possible send or receive operations will proceed. It looks similar to a "switch" statement but with the cases all referring to communication operations.
>
> A case with a RecvStmt may assign the result of a RecvExpr to one or two variables. The RecvExpr must be a (possibly parenthesized) receive operation. There can be at most one default case and it may appear anywhere in the list of cases.
>
> Execution of a "select" statement proceeds in several steps:
>
> 1. For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement.
> 2. If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection.
> 3. If none of the communications can proceed and there is a default case, that case is chosen.
> 4. Otherwise, the chosen case proceeds; if it was a send, the corresponding receive (if any) is observed; if it was a receive, the value (and ok) is assigned.

### Behaviour summary

- Select chooses one ready case; if multiple are ready, uniformly at random.
- If no case is ready and no default, blocks until one becomes ready.
- If no case is ready and default exists, default runs.
- Nil channels in cases are never selected.

### Synchronisation properties

The chosen case's send or receive establishes a happens-before edge per the channel rules. The default case is a non-synchronising operation.

---

## Nil Channel Semantics

From the Go specification (gathered from various sections):

- `make(chan T)` returns a non-nil channel. Channels declared but not made are nil.
- Send on nil channel: blocks forever.
- Receive on nil channel: blocks forever.
- Close on nil channel: panic.
- `len(nil)`: 0.
- `cap(nil)`: 0.
- A nil case in `select`: never chosen.

The "select with nil case" pattern is sometimes useful for dynamically enabling/disabling channel operations in a select:

```go
var input chan int // nil; receive blocks forever
if condition {
    input = source
}
select {
case v := <-input: // disabled if input is nil
    handle(v)
case <-ctx.Done():
    return
}
```

---

## Memory Model: Happens-Before Edges

From the Go memory model document:

> The happens before relation has the following properties:
>
> If e1 happens before e2 and e2 happens before e3, then e1 happens before e3.
> If e1 ≤ e2 in any single goroutine, then e1 happens before e2.

The edges established by various operations:

### Channel send/receive

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

> The k'th receive on a channel with capacity C is synchronized before the (k+C)'th send from that channel completes.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

### Mutex

> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

> For any call to l.RLock on a sync.RWMutex variable l, there is an n such that the l.RLock is synchronized before call n of l.Unlock, and the matching call to l.RUnlock is synchronized before call n+1 of l.Lock returns.

### Once

> The completion of the function f passed to once.Do is synchronized before the return of any call of once.Do(f).

### Atomic

> If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

### WaitGroup

(Not explicitly in the memory model document but specified in the sync package.)

> Done is synchronized before the return of any Wait call that it unblocks.

### Sequentially consistent atomics

Since Go 1.19, atomic operations from `sync/atomic` are sequentially consistent. Each atomic store is synchronized before any atomic load that observes its value.

---

## Race Detector Behaviour

The Go race detector (enabled with `-race`) instruments memory accesses. It detects:

- Two goroutines accessing the same memory location.
- At least one access is a write.
- There is no happens-before edge between them.

It does not detect:

- Logic races where the data race itself is absent but timing-dependent behaviour is wrong.
- Polling `len(ch)`: the read is under the channel's internal mutex, which the detector sees as a well-formed lock.
- Races inside CGo code or assembly.
- Map access concurrent with write (the runtime catches this separately).

### Implications for the anti-pattern

The wait-for-empty-channel anti-pattern is a *logic race*, not a *data race*. The race detector cannot find it. Code that passes `-race` may still have the anti-pattern. Visual inspection and lints are required.

---

## `sync.WaitGroup` Specification

From the `sync` package documentation:

> A WaitGroup waits for a collection of goroutines to finish. The main goroutine calls Add to set the number of goroutines to wait for. Then each of the goroutines runs and calls Done when finished. At the same time, Wait can be used to block until all goroutines have finished.
>
> A WaitGroup must not be copied after first use.
>
> In the terminology of the Go memory model, a call to Done "synchronizes before" the return of any Wait call that it unblocks.

### API

```go
func (wg *WaitGroup) Add(delta int)
func (wg *WaitGroup) Done()
func (wg *WaitGroup) Wait()
```

### Semantics

- `Add(delta)` increments the counter by `delta`. Negative deltas decrement; if the counter goes negative, panic.
- `Done()` is equivalent to `Add(-1)`.
- `Wait()` blocks until the counter is zero.
- If `Add` is called when the counter is zero and there are waiters, panic.
- Re-use is allowed: after `Wait` returns, the WaitGroup can be re-used by calling `Add` again, but not during a `Wait`.

### Constraints

- `Add` must be called before the goroutine starts; calling from inside the goroutine races with `Wait`.
- Do not copy a WaitGroup; pass `*sync.WaitGroup`.
- `Done` more than `Add` panics.

---

## `sync.Mutex` Specification

From the `sync` package:

> A Mutex is a mutual exclusion lock. The zero value for a Mutex is an unlocked mutex.
>
> A Mutex must not be copied after first use.
>
> In the terminology of the Go memory model, the n'th call to Unlock "synchronizes before" the m'th call to Lock for any n < m. A successful call to TryLock is equivalent to a call to Lock. A failed call to TryLock does not establish any "synchronizes before" relation at all.

### API

```go
func (m *Mutex) Lock()
func (m *Mutex) Unlock()
func (m *Mutex) TryLock() bool
```

### Semantics

- `Lock()` blocks until the mutex is unlocked, then acquires it.
- `Unlock()` releases the mutex; if not locked, panic.
- Not re-entrant: same goroutine calling `Lock()` twice deadlocks.
- TryLock returns false if the mutex is held; this is rarely the right primitive.

---

## `sync.RWMutex` Specification

From the `sync` package:

> A RWMutex is a reader/writer mutual exclusion lock. The lock can be held by an arbitrary number of readers or a single writer.
>
> If any goroutine calls Lock while the lock is already held for reading or writing, Lock blocks until the lock is available. To ensure that the lock eventually becomes available, a blocked Lock call excludes new readers from acquiring the lock.
>
> A RWMutex must not be copied after first use.

### API

```go
func (rw *RWMutex) Lock()
func (rw *RWMutex) Unlock()
func (rw *RWMutex) RLock()
func (rw *RWMutex) RUnlock()
func (rw *RWMutex) TryLock() bool
func (rw *RWMutex) TryRLock() bool
func (rw *RWMutex) RLocker() Locker
```

### Semantics

- `RLock`/`RUnlock`: multiple readers may hold concurrently.
- `Lock`/`Unlock`: exclusive; blocks readers.
- A pending writer prevents new readers (anti-starvation).

### When to use

- Read-heavy workloads.
- Per-write cost is higher than `Mutex`, so for write-heavy workloads, plain `Mutex` is faster.

---

## `sync.Cond` Specification

From the `sync` package:

> Cond implements a condition variable, a rendezvous point for goroutines waiting for or announcing the occurrence of an event.
>
> Each Cond has an associated Locker L (often a *Mutex or *RWMutex), which must be held when changing the condition and when calling the Wait method.
>
> A Cond must not be copied after first use.

### API

```go
func NewCond(l Locker) *Cond
func (c *Cond) Wait()
func (c *Cond) Signal()
func (c *Cond) Broadcast()
```

### Semantics

- `Wait()` atomically releases the lock and suspends the goroutine. When awakened, re-acquires the lock and returns.
- `Signal()` wakes one waiter; no guarantee which.
- `Broadcast()` wakes all waiters.
- Wait must be called in a loop checking the predicate, because of spurious wake-ups and the possibility that the predicate is no longer true by the time the waiter re-acquires the lock.

### Idiomatic usage

```go
mu.Lock()
for !condition() {
    cond.Wait()
}
// condition() is true here
mu.Unlock()
```

---

## `sync.Once` Specification

From the `sync` package:

> Once is an object that will perform exactly one action.
>
> A Once must not be copied after first use.
>
> In the terminology of the Go memory model, the return from f "synchronizes before" the return of any call of once.Do(f).

### API

```go
func (o *Once) Do(f func())
```

### Semantics

- The first call to `Do(f)` runs `f`. Subsequent calls do not run `f` and do not block.
- All callers see `f`'s effects after their `Do(f)` returns.
- If `f` panics, the Once considers the call done; future calls do not retry.

### Common use

- One-shot initialisation.
- "Close once" pattern: `once.Do(func() { close(ch) })`.

---

## `sync/atomic` Specification

From the `sync/atomic` package:

> Package atomic provides low-level atomic memory primitives useful for implementing synchronization algorithms.
>
> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package.
>
> In the terminology of the Go memory model, if the effect of an atomic operation A is observed by atomic operation B, then A "synchronizes before" B.

### Recommended API (Go 1.19+)

```go
atomic.Bool
atomic.Int32, Int64, Uint32, Uint64
atomic.Pointer[T]
atomic.Value
```

Each has methods like:

```go
Load() T
Store(v T)
Swap(v T) T (old)
CompareAndSwap(old, new T) bool
Add(delta T) T (new)  // for numeric types
```

### Semantics

- All operations are atomic with respect to each other.
- Operations are sequentially consistent (since Go 1.19).
- The happens-before edge is: a store synchronizes before any load that observes its value.

### When to use

- Counters (`atomic.Int64`).
- Flags (`atomic.Bool`).
- Lock-free data structures (rare, advanced).
- Replacing mutex for single-word state.

### When not to use

- Anything multi-word: race-prone, use mutex.
- Composability with `select`: not available; use channels.
- Carrying values: use channels.

---

## `context.Context` Specification

From the `context` package:

> Package context defines the Context type, which carries deadlines, cancellation signals, and other request-scoped values across API boundaries and between processes.
>
> Incoming requests to a server should create a Context, and outgoing calls to servers should accept a Context. The chain of function calls between them must propagate the Context, optionally replacing it with a derived Context created using WithCancel, WithDeadline, WithTimeout, or WithValue. When a Context is canceled, all Contexts derived from it are also canceled.
>
> Programs that use Contexts should follow these rules to keep interfaces consistent across packages and enable static analysis tools to check context propagation:
> - Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it. The Context should be the first parameter, typically named ctx.
> - Do not pass a nil Context, even if a function permits it. Pass context.TODO if you are unsure about which Context to use.
> - Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions.
> - The same Context may be passed to functions running in different goroutines; Contexts are safe for simultaneous use by multiple goroutines.

### API

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}

func Background() Context
func TODO() Context
func WithCancel(parent Context) (Context, CancelFunc)
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithValue(parent Context, key, val any) Context
```

Since Go 1.20:

```go
func WithCancelCause(parent Context) (Context, CancelCauseFunc)
func Cause(c Context) error
```

Since Go 1.21:

```go
func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc)
func WithTimeoutCause(parent Context, timeout time.Duration, cause error) (Context, CancelFunc)
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

### Semantics

- `Background()` is the root context. Never cancelled.
- `WithCancel` returns a cancel function. Calling it cancels the derived context.
- `WithTimeout`/`WithDeadline` create a context that cancels at the deadline.
- Cancellation propagates from parent to all children.
- A context that has been cancelled stays cancelled.

---

## `context.Done()` Semantics

From the `context` package:

> Done returns a channel that's closed when work done on behalf of this context should be canceled. Done may return nil if this context can never be canceled. Successive calls to Done return the same value.

### Behaviour

- `Background()` and `TODO()` return nil; their Done() returns nil; a select on a nil channel never fires.
- `WithCancel`-derived contexts return a non-nil channel.
- The channel is *closed* when cancelled; it is not sent to.
- After cancellation, `<-ctx.Done()` returns immediately.

### Synchronisation properties

The closing of `ctx.Done()` is a channel close. The same happens-before semantics apply: any write made before `cancel()` is called is visible to anyone who observes `<-ctx.Done()`.

---

## `context.Err()` Semantics

From the `context` package:

> Err returns nil if Done is not yet closed. After Done is closed, Err returns a non-nil error explaining why: Canceled if the context was canceled or DeadlineExceeded if the context's deadline passed.

### Values

- `nil` before cancellation.
- `context.Canceled` if cancelled by `cancel()` call.
- `context.DeadlineExceeded` if cancelled by deadline.

### Idiomatic check

```go
select {
case <-ctx.Done():
    return ctx.Err()
case ...:
}
```

The select gives event-driven dispatch; `Err()` returns the reason.

### `Cause` (Go 1.20+)

If a context was cancelled via `WithCancelCause` with a non-nil cause, `Cause(ctx)` returns that cause; `Err()` returns `Canceled`. Use `Cause` for detailed root-cause reporting.

---

## `errgroup.Group` Reference

From `golang.org/x/sync/errgroup`:

> A Group is a collection of goroutines working on subtasks that are part of the same overall task. A Group should not be reused for different tasks.
>
> A zero Group is valid, has no limit on the number of active goroutines, and does not cancel on error.

### API

```go
type Group struct { /* opaque */ }

func WithContext(ctx context.Context) (*Group, context.Context)
func (g *Group) Go(f func() error)
func (g *Group) Wait() error
func (g *Group) SetLimit(n int)
func (g *Group) TryGo(f func() error) bool
```

### Semantics

- `Go(f)` calls `f` in a new goroutine. If `f` returns a non-nil error, the group's first error is recorded and the derived context is cancelled.
- `Wait()` blocks until all `Go`-spawned goroutines have returned; returns the first non-nil error or nil.
- `SetLimit(n)` limits concurrent goroutines to `n`; subsequent `Go` calls block until a slot is free.
- `TryGo` is non-blocking; returns false if the limit is exceeded.

### Synchronisation properties

`Wait` returns only after every `Go` has returned. The internal WaitGroup provides the same happens-before guarantees as `sync.WaitGroup`.

---

## `semaphore.Weighted` Reference

From `golang.org/x/sync/semaphore`:

> Weighted provides a way to bound concurrent access to a resource. The callers can request access with a given weight.

### API

```go
type Weighted struct { /* opaque */ }

func NewWeighted(n int64) *Weighted
func (s *Weighted) Acquire(ctx context.Context, n int64) error
func (s *Weighted) TryAcquire(n int64) bool
func (s *Weighted) Release(n int64)
```

### Semantics

- `NewWeighted(n)` creates a semaphore with capacity `n`.
- `Acquire(ctx, n)` blocks until `n` units are available or `ctx` cancels; returns ctx.Err() on cancellation.
- `Release(n)` returns `n` units.
- `TryAcquire(n)` returns false if `n` units are not immediately available.

### Common pattern

```go
sem := semaphore.NewWeighted(8)
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil {
        break
    }
    go func() {
        defer sem.Release(1)
        process(ctx, item)
    }()
}
```

---

## References

- The Go Programming Language Specification — https://go.dev/ref/spec
- The Go Memory Model — https://go.dev/ref/mem
- `sync` package — https://pkg.go.dev/sync
- `sync/atomic` package — https://pkg.go.dev/sync/atomic
- `context` package — https://pkg.go.dev/context
- `golang.org/x/sync/errgroup` — https://pkg.go.dev/golang.org/x/sync/errgroup
- `golang.org/x/sync/semaphore` — https://pkg.go.dev/golang.org/x/sync/semaphore
- `golang.org/x/sync/singleflight` — https://pkg.go.dev/golang.org/x/sync/singleflight
- `golang.org/x/time/rate` — https://pkg.go.dev/golang.org/x/time/rate

For deeper reading on the memory model:

- Russ Cox, "Updating the Go Memory Model" — https://research.swtch.com/gomm
- Hans Boehm and Sarita Adve, "Foundations of the C++ Concurrency Memory Model" — the conceptual basis.

For specific anti-pattern discussion:

- Dave Cheney's blog — many posts on goroutine lifetimes.
- Go forum discussions on `len(ch)` semantics — historical conversations.
- Various engineering blogs (Cloudflare, Discord, Uber) — production case studies.

---

## Closing note

This file is a reference. Use it to settle questions, not to learn the patterns end-to-end. The other files in this section provide the narrative and examples; this file provides the formal grounding.

When debate arises in code review, reach for the relevant section here. The specification is the final word.
