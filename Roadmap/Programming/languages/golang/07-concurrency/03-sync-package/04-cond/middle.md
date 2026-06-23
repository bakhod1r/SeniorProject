# sync.Cond — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing the Predicate](#designing-the-predicate)
3. [Bounded Queue, Done Properly](#bounded-queue-done-properly)
4. [Resource Pool with Capacity](#resource-pool-with-capacity)
5. [Cond vs Channel — A Side-by-Side](#cond-vs-channel-a-side-by-side)
6. [When Cond Actually Wins](#when-cond-actually-wins)
7. [Adding Cancellation and Timeouts](#adding-cancellation-and-timeouts)
8. [Multiple Conds Over One Lock](#multiple-conds-over-one-lock)
9. [Signal Storms and Thundering Herds](#signal-storms-and-thundering-herds)
10. [Debugging Wait/Signal Mismatches](#debugging-waitsignal-mismatches)
11. [Memory Model and Visibility](#memory-model-and-visibility)
12. [Code Review Checklist](#code-review-checklist)
13. [Summary](#summary)

---

## Introduction

At the junior level, `sync.Cond` is a four-method API and a few discipline rules. At the middle level, the question shifts: *should I use Cond here at all, and if so, how do I structure the predicate so the code is fast, leak-free, and survives shutdown?* This file walks the patterns that real production code uses: bounded queues, resource pools, paused workers, and the inevitable comparison with channels. It also covers the debugging stories you will hit the first time a `Cond`-based subsystem hangs in production.

A theme runs through this file: **`sync.Cond` is rarely the obvious right answer in Go.** Channels handle most use cases more cleanly, and the Go community sentiment (Effective Go, the standard library reviewers, Bryan Mills' "Rethinking Classical Concurrency Patterns") leans hard toward channels. Knowing this, the middle-level engineer must answer two questions before reaching for `Cond`:

1. Can a channel express this directly? If yes, use the channel.
2. If the answer is "no, because…" — write the *because* down in a comment. That comment is your justification to reviewers and your future self.

---

## Designing the Predicate

The predicate is the heart of any `Cond` use. A poorly-chosen predicate creates bugs that the `for` loop cannot rescue.

### Rule 1: the predicate must be a pure function of state guarded by `Cond.L`

If the predicate reads any variable not protected by `Cond.L`, you have a data race. The `for` loop catches stale reads, but it cannot catch racing reads.

```go
// BAD
for !atomic.LoadInt32(&ready) {
    cond.Wait()
}
```

The atomic load is racy with mutations under the lock — not because the load itself is unsafe (it isn't) but because the *combination* "atomic + lock" lets one mutator change atomic state without locking, breaking the signal-then-check invariant. Either everything is atomic, or everything is locked. Pick one.

### Rule 2: the predicate must be cheap

Each waiter re-evaluates the predicate on every wake-up. If the predicate is expensive (calls `time.Now`, walks a long slice, hashes a struct), broadcast storms become catastrophic. Aim for an O(1) check.

### Rule 3: the predicate must be stable

If the predicate can flip back to false between the wake-up and the next line, your code is a race. Suppose:

```go
mu.Lock()
for q.len() == 0 {
    cond.Wait()
}
v := q.pop()    // ok — we hold the lock
mu.Unlock()
```

`q.len() > 0` holds because we hold the lock; another goroutine cannot pop in between. Good. But:

```go
mu.Lock()
for !ready {
    cond.Wait()
}
mu.Unlock()
go consume(globalVar)  // BAD — globalVar may have changed
```

The "ready" predicate is satisfied, but you have already released the lock by the time you read `globalVar`. Read everything you need while still holding the lock, snapshot it, then act.

### Rule 4: prefer one predicate per `Cond`

If a single `Cond` is signalled for two unrelated predicates, every signal wakes every waiter, and most of them re-park. That is harmless but wasteful. Each independent predicate gets its own `Cond`, all sharing one mutex.

---

## Bounded Queue, Done Properly

The textbook example, fleshed out:

```go
type BoundedQueue[T any] struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    items    []T
    cap      int
    closed   bool
}

func NewBoundedQueue[T any](cap int) *BoundedQueue[T] {
    q := &BoundedQueue[T]{cap: cap}
    q.notFull = sync.NewCond(&q.mu)
    q.notEmpty = sync.NewCond(&q.mu)
    return q
}

func (q *BoundedQueue[T]) Push(v T) error {
    q.mu.Lock()
    defer q.mu.Unlock()
    for !q.closed && len(q.items) == q.cap {
        q.notFull.Wait()
    }
    if q.closed {
        return ErrClosed
    }
    q.items = append(q.items, v)
    q.notEmpty.Signal()
    return nil
}

func (q *BoundedQueue[T]) Pop() (T, error) {
    var zero T
    q.mu.Lock()
    defer q.mu.Unlock()
    for !q.closed && len(q.items) == 0 {
        q.notEmpty.Wait()
    }
    if len(q.items) == 0 {
        return zero, ErrClosed
    }
    v := q.items[0]
    q.items = q.items[1:]
    q.notFull.Signal()
    return v, nil
}

func (q *BoundedQueue[T]) Close() {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.closed = true
    q.notEmpty.Broadcast()
    q.notFull.Broadcast()
}
```

Points worth highlighting:

- **Two `Cond`s, one mutex.** Producers wait on `notFull`; consumers wait on `notEmpty`. A push only wakes consumers; a pop only wakes producers.
- **Close is broadcast.** A class-of-state change (closed) is a `Broadcast` because every waiter must observe it. Both `Cond`s broadcast because waiters of either kind may exist.
- **Predicates compound.** The wait loop is `!closed && empty` (or `full`). On close, the loop exits regardless of size.
- **Pop after close drains.** If there are items left, consumers still get them. Only when the queue is closed *and* empty do we return `ErrClosed`. This matches `for v := range ch` semantics on a closed buffered channel.

### Channel equivalent

The same shape with a buffered channel:

```go
ch := make(chan T, cap)

// Push: ch <- v
// Pop:  v, ok := <-ch
// Close: close(ch)
```

Three lines. The buffered channel does everything `BoundedQueue` does, with built-in safety: `close` is broadcast, post-close drain works, `select` integrates timeouts and cancellation.

So why would anyone build the explicit `BoundedQueue`? See **When Cond Actually Wins** below — the answer is "only when you need things the channel can't give you," and those cases are narrower than people assume.

---

## Resource Pool with Capacity

```go
type Pool struct {
    mu        sync.Mutex
    available *sync.Cond
    free      []*Conn
}

func NewPool(initial []*Conn) *Pool {
    p := &Pool{free: initial}
    p.available = sync.NewCond(&p.mu)
    return p
}

func (p *Pool) Acquire() *Conn {
    p.mu.Lock()
    for len(p.free) == 0 {
        p.available.Wait()
    }
    c := p.free[len(p.free)-1]
    p.free = p.free[:len(p.free)-1]
    p.mu.Unlock()
    return c
}

func (p *Pool) Release(c *Conn) {
    p.mu.Lock()
    p.free = append(p.free, c)
    p.available.Signal()
    p.mu.Unlock()
}
```

Acquire blocks when no connection is free. Release wakes one waiter. Simple, correct, no leaks.

### Channel version

```go
ch := make(chan *Conn, N)
// fill
for _, c := range initial { ch <- c }

// Acquire: c := <-ch
// Release: ch <- c
```

Three lines again. The channel version is faster on Linux/amd64 by a small constant (channel ops are hand-tuned in `runtime/chan.go`), and integrates with timeouts:

```go
select {
case c := <-ch:
    return c
case <-time.After(time.Second):
    return nil, ErrTimeout
case <-ctx.Done():
    return nil, ctx.Err()
}
```

The `Cond` version cannot do timeouts or cancellation without significant extra code.

---

## Cond vs Channel — A Side-by-Side

| Capability | `sync.Cond` | Buffered channel |
|---|---|---|
| Wait until predicate true | Yes, via `for cond.Wait()` | Yes, blocking send/recv |
| Wake one waiter | `Signal` | Single send completes for one waiter |
| Wake all waiters | `Broadcast` | `close(ch)` (one-shot) |
| Carry a value with the wake-up | No, re-read state | Yes, the value sent |
| Compose with timeout | Manual (timer goroutine + Broadcast) | `select` + `time.After` |
| Compose with `context.Context` | Manual (broadcast on cancel) | `select` + `ctx.Done()` |
| Allocation per operation | Zero (after `NewCond`) | Zero for buffered, channel struct one-time |
| Memory per primitive | ~6 words | ~10 words + ring buffer |
| Multi-predicate over one state | Natural (multiple `Cond`s) | Awkward (multiple channels) |
| FIFO ordering | No guarantee | FIFO for blocked goroutines |
| Survives reset | No native reset | No native reset (close is one-shot) |
| Standard-library reviewers' preference | Pushback | Encouraged |
| Risk of misuse | High (4 discipline rules) | Lower (channel ops are atomic) |

The summary: channels are the default. `Cond` is for the specific cases below.

---

## When Cond Actually Wins

### Case 1: Multiple distinct predicates over one shared state

The bounded queue with two predicates — `notFull` and `notEmpty` — is the canonical example. The state (the slice of items) is one piece; the predicates are two. With a channel you would split the state, but the queue *is* the channel, and you have lost the explicit data structure with all its inspection methods. If you need `q.Len()`, `q.Snapshot()`, `q.Drain()` operations on the queue, you need explicit state, and `Cond` rides naturally on top.

### Case 2: Broadcast wake-up that must be repeatable

`close(ch)` is one-shot. Once closed, you cannot reopen. For "pause and resume" cycles, the channel approach requires creating a new channel each time, which races with goroutines that captured the old reference. `Broadcast` on a `Cond` is unlimited — you can pause and resume indefinitely.

### Case 3: State inspection beyond the channel's API

A channel exposes `len(ch)` and `cap(ch)` but nothing else. If your subsystem needs "list pending items", "remove an item by ID", "swap two items", you need explicit state, and `Cond` becomes natural.

### Case 4: Avoiding per-operation channel allocation in hot paths

`Cond` operations are zero-allocation. Channel operations also are zero-allocation in the common path, but `select` with `time.After` allocates a `*time.Timer`. In a tight loop with hundreds of millions of operations per second, the difference shows up. This case is rare, but real.

### Case 5: Direct port from a C/C++ design

Sometimes you are porting an existing C or C++ system that uses condition variables, and rewriting in channels would obscure the design. `sync.Cond` preserves the structure.

### Case 6: Atomic predicate over multiple variables

```go
for x < 10 && y > 20 && !cancelled {
    cond.Wait()
}
```

The predicate combines three fields under one lock. With a channel each variable would need its own signalling path, complicating the design.

In every other case, channels are the default.

---

## Adding Cancellation and Timeouts

`Cond` does not natively support cancellation. The standard workaround:

```go
type Waiter struct {
    mu     sync.Mutex
    cond   *sync.Cond
    state  string
    closed bool
}

func (w *Waiter) WaitFor(ctx context.Context, target string) error {
    w.mu.Lock()
    defer w.mu.Unlock()
    for w.state != target && !w.closed && ctx.Err() == nil {
        // unlock and wait; the goroutine below will broadcast on ctx.Done()
        w.cond.Wait()
    }
    if w.closed {
        return ErrClosed
    }
    if ctx.Err() != nil {
        return ctx.Err()
    }
    return nil
}
```

The waiter checks `ctx.Err()` in the loop, but it cannot react to `ctx.Done()` itself — `Wait` does not select on anything. So you need a helper goroutine:

```go
func (w *Waiter) watchCancel(ctx context.Context) {
    <-ctx.Done()
    w.mu.Lock()
    w.cond.Broadcast()
    w.mu.Unlock()
}
```

Start one of these per cancellation context. The broadcast wakes the waiter, which sees `ctx.Err() != nil` and returns.

This is awkward. It also creates a one-goroutine cost per pending `Wait` with a context. In a server that handles 10 000 simultaneous waiters, that's 10 000 extra goroutines.

### Why this is the moment to consider channels

```go
select {
case <-stateChangedCh:
case <-ctx.Done():
    return ctx.Err()
}
```

Two lines, zero extra goroutines. This is why channels win for cancellable wait.

### Timeouts

The same pattern with `time.After` or `time.AfterFunc`:

```go
func (w *Waiter) WaitTimeout(target string, d time.Duration) error {
    timer := time.AfterFunc(d, func() {
        w.mu.Lock()
        w.cond.Broadcast()
        w.mu.Unlock()
    })
    defer timer.Stop()

    w.mu.Lock()
    defer w.mu.Unlock()
    start := time.Now()
    for w.state != target {
        if time.Since(start) >= d {
            return ErrTimeout
        }
        w.cond.Wait()
    }
    return nil
}
```

Note the `time.Since` check inside the loop — the broadcast on timeout wakes the waiter, but the waiter then needs to *know* it timed out, not just that something happened. The `for` loop catches this.

Compare with the channel version:

```go
select {
case <-stateChangedCh:
case <-time.After(d):
    return ErrTimeout
}
```

Again, two lines, no extra goroutine. The case for `Cond` over channels in cancellable/timed contexts is essentially zero.

---

## Multiple Conds Over One Lock

A common pattern in more complex types is multiple `Cond` objects sharing one mutex:

```go
type Pipeline struct {
    mu       sync.Mutex
    canRead  *sync.Cond
    canWrite *sync.Cond
    canFlush *sync.Cond
    // ... state ...
}
```

The mutex serializes access to the state. Each `Cond` represents one predicate over the state. Readers wait on `canRead`; writers on `canWrite`; flushers on `canFlush`. Mutations broadcast or signal the relevant `Cond` depending on which predicates may have flipped.

The discipline:

- All `Cond`s share the same `&p.mu`.
- Every operation locks the mutex, checks/changes state, signals the appropriate `Cond`(s), and unlocks.
- The waiter loops check only their predicate, not unrelated ones.

This is one of the patterns where `Cond` shines over channels: three distinct wait sets over one state, all coordinated by one mutex.

### Anti-pattern: one Cond, multi-predicate

```go
// BAD
for len(q.items) == 0 || q.full {
    cond.Wait()
}
```

If one `Cond` handles both predicates, every push wakes both producers and consumers, half of whom re-park immediately. Use two `Cond` objects: `notFull` and `notEmpty`.

---

## Signal Storms and Thundering Herds

`Broadcast` wakes every waiter. If 1000 goroutines are parked and you `Broadcast`, the runtime unparks all 1000. They all race for `cond.L`. One takes the lock, finds the predicate true, proceeds. The other 999 take the lock one at a time, find the predicate now false (the first one ate the resource), and call `Wait` again.

The total CPU cost: 1000 context switches into runnable, 1000 lock acquisitions, 1000 predicate checks, 1000 returns to parked. That's a *thundering herd*. On a hot path it can dominate your CPU profile.

Mitigation:

- **Use `Signal` when only one waiter can possibly benefit.** Pushing one item to a queue is a single-waiter event. Use `Signal`.
- **Use `Broadcast` only for class-of-state changes.** "Closed", "paused -> running", "error encountered". These naturally affect all waiters.
- **Consider per-waiter channels.** When you need targeted wakes, give each waiter its own channel. The cost is more memory; the gain is no thundering herd.

### A concrete example of the herd

```go
type Counter struct {
    mu   sync.Mutex
    cond *sync.Cond
    n    int
}

func (c *Counter) Add() {
    c.mu.Lock()
    c.n++
    c.cond.Broadcast() // BAD — wakes everyone for each increment
    c.mu.Unlock()
}

func (c *Counter) WaitAt(target int) {
    c.mu.Lock()
    for c.n < target {
        c.cond.Wait()
    }
    c.mu.Unlock()
}
```

If 100 goroutines are waiting on different targets, every `Add` wakes all 100. 99 of them re-park. On a hot Add path this is wasteful. Alternative designs:

- One `Cond` per target, indexed by target value, woken precisely when `n` hits that value.
- A sorted heap of waiters, woken in order as `n` advances.
- A channel-based design where each waiter has its own one-shot channel, closed when its target is reached.

All three are more complex than the broadcast version, and you should only adopt them if profiling shows the herd is real.

---

## Debugging Wait/Signal Mismatches

The most common `Cond` bug is a goroutine that hangs in `Wait` forever. Symptoms:

- `runtime.NumGoroutine()` grows over time.
- A goroutine dump (`SIGQUIT` or `pprof.Lookup("goroutine").WriteTo(...)`) shows many goroutines parked on `sync.runtime_notifyListWait`.
- The application appears to "stall" on certain code paths but recover on others.

### Diagnosis steps

1. **Dump goroutines** under stall. `kill -SIGQUIT $PID` prints all stacks. Look for `sync.(*Cond).Wait`.
2. **Identify the waiters' predicate.** The stack will show the caller of `Wait` — the function with the `for` loop.
3. **Audit the signalling sites.** Every state mutation that *could* satisfy that predicate must call `Signal` or `Broadcast` under the lock.
4. **Check that the lock is the same.** If the waiter uses `mu1` and the signaller uses `mu2`, the signal goes nowhere useful.
5. **Verify the predicate is correct.** Sometimes the predicate is `len(items) > 0` but the signaller only signals when `len(items) >= cap/2`. The bug is a *predicate mismatch*.

### Common causes

- **Signal under the wrong lock.** Easy to do when the `Cond` is on one struct and the state on another.
- **Forgetting to signal at all.** A `Push` that increments a counter but does not call `Signal`. Waiters never learn.
- **Signalling outside the lock.** A waiter re-checks the predicate after the state change but before the signal, finds it false, parks; the signal then fires to no one.
- **Predicate that doesn't capture the change.** State changed in a way that *should* satisfy the predicate, but the predicate's expression doesn't read the right variable.
- **Broadcast missing on close.** Workers parked, server closes, workers never wake.

### A debugging trick: instrument the wait

```go
type instrumentedCond struct {
    *sync.Cond
    name string
    n    atomic.Int64
}

func (c *instrumentedCond) Wait() {
    c.n.Add(1)
    defer c.n.Add(-1)
    c.Cond.Wait()
}

// Expose c.n via metrics
```

If `c.n` rises and never falls, you have a missed signal. The metric tells you exactly which `Cond` is starving.

---

## Memory Model and Visibility

The Go memory model says: a `Signal` or `Broadcast` "happens before" the corresponding `Wait` returns. This is the same kind of synchronization edge as `mu.Unlock` happens-before the next `mu.Lock` returns. So state changes made by the signaller *before* `Signal` (under the lock) are visible to the waiter *after* `Wait` returns (under the lock again).

In practice this means: as long as every reader and writer of the shared state holds `cond.L`, the memory model is your friend. If anyone reads or writes the state outside the lock, all bets are off.

### Atomic vs Lock

You sometimes see hybrid code:

```go
// state is sync.atomic.Int32
mu.Lock()
for state.Load() == 0 {
    cond.Wait()
}
mu.Unlock()
```

The atomic load is technically redundant under the lock — but harmless. Where it goes wrong: if some other goroutine *stores* to `state` *without* the lock, that store may not be visible to the cond-waiter even after a `Signal`, because the memory edge is from `Unlock` to `Lock`, not from atomic-store to atomic-load. Stick to "always under the lock" and you have no surprises.

### Re-entrancy

`sync.Mutex` is not re-entrant. If the signaller calls `Signal` and the signal-handling waiter immediately needs to call back into a function that locks `cond.L`, the design is broken. Refactor so callbacks happen *after* `Unlock`.

---

## Code Review Checklist

When reviewing code that uses `sync.Cond`:

- [ ] The `Cond` is created with `sync.NewCond(&mu)` where `mu` is the same lock that guards the predicate.
- [ ] The lock and the `Cond` live in the same struct, side by side.
- [ ] Every `Wait` is inside a `for` loop over the predicate.
- [ ] Every `Wait` is called while holding the lock.
- [ ] Every state mutation that could flip the predicate calls `Signal` or `Broadcast` under the lock.
- [ ] `Signal` is used when only one waiter could benefit; `Broadcast` for class-of-state changes.
- [ ] There is a documented cancellation/shutdown path (a `closed` flag plus broadcast).
- [ ] No `Cond` is copied. The struct stores `*sync.Cond`, not `sync.Cond`.
- [ ] No `Cond.L` is reassigned after construction.
- [ ] The predicate is cheap and side-effect-free.
- [ ] If a channel would do the same job, the comment explains why `Cond` was chosen.
- [ ] Tests cover both "wait then signal" and "signal before wait" orderings.
- [ ] Tests cover close-while-waiting.
- [ ] Run with `-race`.

---

## Summary

`sync.Cond` at the middle level is a tool of last resort — used deliberately, with a comment explaining why a channel was not chosen. Its strengths are bounded-queue-style designs with multiple predicates over one state, repeatable broadcast wake-ups, and cases where explicit data structures with their own inspection APIs are needed. Its weaknesses are the lack of cancellation, the lack of timeouts, the lack of `select` integration, and the four-rule discipline that beginners stumble on for a year.

The patterns to memorize:

- Two `Cond`s on one mutex for two predicates.
- `Broadcast` for class-of-state changes (closed, paused, errored).
- `Signal` for "one new item, one waiter takes it."
- A `closed` flag plus broadcast on close — the only way to make `Wait` "cancellable."
- Always `for predicate() { cond.Wait() }`. Never `if`.

The senior file covers architectural decisions: how to evaluate `Cond` vs channels in the context of a larger system, how to model state machines on top of `Cond`, and when `runtime/sema` or `golang.org/x/sync/semaphore` are better fits. The professional file opens the runtime hood and explains *why* the discipline rules exist by looking at `notifyList` and `runtime_notifyListWait`.
