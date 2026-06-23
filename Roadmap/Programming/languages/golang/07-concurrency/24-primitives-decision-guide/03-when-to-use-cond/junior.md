---
layout: default
title: When to Use sync.Cond — Junior
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/junior/
---

# When to Use sync.Cond — Junior

[← Back](../)

## 1. The problem `sync.Cond` exists to solve

Suppose you have a queue of jobs and several worker goroutines that should each pull one job at a time and execute it. What does a worker do when the queue is empty?

A first attempt:

```go
type Queue struct {
    mu   sync.Mutex
    data []int
}

func (q *Queue) Push(v int) {
    q.mu.Lock()
    q.data = append(q.data, v)
    q.mu.Unlock()
}

func (q *Queue) Pop() int {
    for {
        q.mu.Lock()
        if len(q.data) > 0 {
            v := q.data[0]
            q.data = q.data[1:]
            q.mu.Unlock()
            return v
        }
        q.mu.Unlock()
        // empty: try again
    }
}
```

This works in the sense of being correct. But it is terrible. When the queue is empty, `Pop` busy-spins, taking and releasing the lock in a tight loop, burning a full CPU core just to wait. We need a way for `Pop` to *block* until data appears.

Naive idea: `time.Sleep(10 * time.Millisecond)` between retries. Better — no longer a CPU hog — but now `Pop` is randomly delayed by up to 10ms after a `Push`. Latency is bad.

What we actually want: when the queue is empty, `Pop` parks the goroutine; when `Push` adds data, it wakes one parked goroutine. That is exactly what a *condition variable* provides.

## 2. Anatomy of `sync.Cond`

A `sync.Cond` has four parts:

```go
type Cond struct {
    noCopy  noCopy   // marker so go vet warns if you copy it
    L       Locker   // the mutex you must hold to read/change the predicate
    notify  notifyList
    checker copyChecker
}
```

The only fields you touch directly are `L`. The rest is internal. The methods you use are three:

- `Wait()` — atomically releases `L` and parks the calling goroutine; on wake, re-acquires `L` before returning.
- `Signal()` — wakes one parked waiter (FIFO).
- `Broadcast()` — wakes all parked waiters.

You construct one like this:

```go
var mu sync.Mutex
c := sync.NewCond(&mu)
```

Or, equivalently, as a zero value with the locker assigned later:

```go
var mu sync.Mutex
var c sync.Cond
c.L = &mu
```

Either is fine. The standard library uses both forms.

## 3. The bounded buffer example

Let us rewrite the queue using `sync.Cond`. We make it bounded — both `Push` and `Pop` can block.

```go
type Buffer struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    data     []int
    capacity int
}

func NewBuffer(capacity int) *Buffer {
    b := &Buffer{capacity: capacity}
    b.notFull = sync.NewCond(&b.mu)
    b.notEmpty = sync.NewCond(&b.mu)
    return b
}

func (b *Buffer) Push(v int) {
    b.mu.Lock()
    for len(b.data) == b.capacity {
        b.notFull.Wait()
    }
    b.data = append(b.data, v)
    b.notEmpty.Signal()
    b.mu.Unlock()
}

func (b *Buffer) Pop() int {
    b.mu.Lock()
    for len(b.data) == 0 {
        b.notEmpty.Wait()
    }
    v := b.data[0]
    b.data = b.data[1:]
    b.notFull.Signal()
    b.mu.Unlock()
    return v
}
```

Read this carefully. Several details matter.

### 3.1 Two Conds, one mutex

`notFull` and `notEmpty` both share `&b.mu`. They are two condition variables guarding two predicates on the same shared state. Both `Push` and `Pop` lock the same mutex, so they cannot interleave incorrectly.

### 3.2 `for`, not `if`

The wait is wrapped in a `for` loop:

```go
for len(b.data) == b.capacity {
    b.notFull.Wait()
}
```

Why is this not `if`? Because between the moment a `Pop` calls `notFull.Signal()` and the moment your `Push` wakes up from `Wait`, *another* `Push` may have grabbed the lock and filled the slot. When your `Push` returns from `Wait`, the lock is yours again, but the buffer may already be full again. The `for` loop re-checks. The `if` form would proceed with a corrupt assumption.

Go specifically forbids spurious wakeups (POSIX permits them; Go does not). But the "stolen by another thread" problem is real either way. **Always use `for`.**

### 3.3 `Signal` is enough here

`Push` calls `notEmpty.Signal()` because exactly one new element became available — at most one consumer can be served by this signal. Similarly `Pop` calls `notFull.Signal()` because exactly one slot freed up. If we used `Broadcast`, the code would still be correct, but every other waiter would wake, re-check its predicate, find it false, and go back to sleep. Wasted CPU.

If our predicate were "more than three slots free" or "any signal could matter to anyone," we would need `Broadcast`.

### 3.4 Where is the lock held?

The lock is held:
- When reading the predicate (`len(b.data) == b.capacity`).
- When calling `Wait` (which releases it during the park).
- When making the predicate change (`append`).
- When calling `Signal` — the docs say this is optional, but it is a good habit.
- When unlocking, of course.

A common mistake is to do something like this:

```go
// BUG: do not do this
if len(b.data) == b.capacity {
    b.notFull.Wait()
}
```

without first locking `b.mu`. `Wait` panics in this case: its first action after registering on the notify list is `b.mu.Unlock()`, which fails on an unlocked mutex.

## 4. The five-line wait pattern

Here is the canonical pattern, the only one you should ever write:

```go
c.L.Lock()
for !predicate() {
    c.Wait()
}
// predicate is true; c.L is held
useState()
c.L.Unlock()
```

Memorize it. Tattoo it on your forearm. Every correct Cond-based piece of code in Go follows this pattern. Variations exist (the signal side, lock scopes), but the wait side is non-negotiable.

The mirror pattern on the signal side:

```go
c.L.Lock()
changePredicate()
c.Broadcast()   // or Signal, if you know only one waiter can progress
c.L.Unlock()
```

These two together — the wait loop and the signal loop — are the *entire* protocol.

## 5. `Signal` vs `Broadcast`: a worked example

Imagine a barrier that releases all waiters when an `Activate()` call happens:

```go
type Barrier struct {
    mu     sync.Mutex
    cond   *sync.Cond
    active bool
}

func NewBarrier() *Barrier {
    b := &Barrier{}
    b.cond = sync.NewCond(&b.mu)
    return b
}

func (b *Barrier) Wait() {
    b.mu.Lock()
    for !b.active {
        b.cond.Wait()
    }
    b.mu.Unlock()
}

func (b *Barrier) Activate() {
    b.mu.Lock()
    b.active = true
    b.cond.Broadcast()
    b.mu.Unlock()
}
```

Here we must use `Broadcast`. If we used `Signal`, only one of the waiting goroutines would wake up. The rest would be stuck forever (or until some unrelated event broadcast — there is no such event in this design).

The rule: if more than one waiter could legitimately progress after the predicate change, use `Broadcast`. If only one can, `Signal` is fine.

## 6. The atomic unlock-and-park trick

Let us look at what `Wait` actually does inside. From `src/sync/cond.go`:

```go
func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify)
    c.L.Unlock()
    runtime_notifyListWait(&c.notify, t)
    c.L.Lock()
}
```

Three numbered steps:

1. `runtime_notifyListAdd(&c.notify)` — register on the notify list, *while still holding the lock*. This reserves a ticket number.
2. `c.L.Unlock()` — release the user mutex.
3. `runtime_notifyListWait(&c.notify, t)` — actually park the goroutine until ticket `t` is matched.

The trick is in step 1 happening *before* step 2. If a `Signal` runs after our lock release but before our park, the notify list already has our ticket, and the signal will match it. If `Signal` ran before our lock release… it could not, because to call `Signal` meaningfully you must have changed the predicate, which required holding the lock.

This is the heart of why condition variables work. The lock is not decorative — it is the synchronization point that prevents lost wakeups.

## 7. A simple worked walkthrough

Trace through this scenario in your head:

1. Goroutine A: `Pop()` — locks `mu`, sees empty buffer, registers on `notEmpty.notify` as ticket 1, releases `mu`, parks.
2. Goroutine B: `Pop()` — locks `mu`, sees empty buffer, registers on `notEmpty.notify` as ticket 2, releases `mu`, parks.
3. Goroutine C: `Push(42)` — locks `mu`, buffer is not full, appends 42, calls `notEmpty.Signal()`. The runtime wakes ticket 1 (FIFO). Releases `mu`.
4. Goroutine A: woken; `notEmpty.Wait` re-acquires `mu`. Sees `len(b.data) == 1`, exits the for-loop, takes the element, calls `notFull.Signal()`, unlocks `mu`. Returns 42.
5. Goroutine B: still parked on ticket 2.

This is correct behavior. B only wakes when *another* Push arrives.

If C had called `notEmpty.Broadcast()` instead, both A and B would wake. A would re-acquire `mu`, take the element, unlock. B would then re-acquire `mu`, re-check the predicate, find the buffer empty, and go back to `Wait` (ticket 3). Wasted wakeup but no correctness issue.

## 8. Why everyone says "just use a channel"

Look at our bounded buffer again — 28 lines of code with two Conds, one mutex, two `for { Wait }` loops. Now look at the channel equivalent:

```go
ch := make(chan int, capacity)
// Push: ch <- v
// Pop: <-ch
```

That's it. Three lines including the declaration. The channel runtime implements the same wait/signal protocol but baked into one primitive, written and tested for years, with `select` integration, with `close()` for fan-out, with cancellation via `select { case v := <-ch: ; case <-ctx.Done(): }`.

For 95% of cases where you might reach for `sync.Cond`, a channel is the right answer. The remaining 5% — multi-predicate wakeup, complex shared-state coordination, integration with existing mutex-protected data — are real but rare. We will see one or two in the professional section.

## 9. The four `sync.Cond` operations summarized

```go
c := sync.NewCond(&mu)

// Construct
//   mu is any sync.Locker (typically *sync.Mutex or *sync.RWMutex)
//   c is *sync.Cond; do not copy by value

// Wait (must hold mu)
mu.Lock()
for !predicate() {
    c.Wait()        // releases mu, parks, re-acquires mu on wake
}
mu.Unlock()

// Signal (mu optional but recommended)
mu.Lock()
changePredicate()
c.Signal()          // wakes one (FIFO); no-op if no waiters
mu.Unlock()

// Broadcast (mu optional but recommended)
mu.Lock()
changePredicate()
c.Broadcast()       // wakes all waiters
mu.Unlock()
```

That is the entire surface area. There is no `WaitTimeout`, no `WaitContext`, no `WaitCount`. Cond is a 90-line file in the standard library, and the API has not changed since Go 1.0.

## 10. A small case-study: dispatcher

Here is a slightly less trivial example. A dispatcher accepts work items and distributes them to a fixed pool of workers. We use one Cond for the "workers idle" condition.

```go
type Dispatcher struct {
    mu    sync.Mutex
    cond  *sync.Cond
    queue []Job
    quit  bool
}

func NewDispatcher(n int) *Dispatcher {
    d := &Dispatcher{}
    d.cond = sync.NewCond(&d.mu)
    for i := 0; i < n; i++ {
        go d.worker()
    }
    return d
}

func (d *Dispatcher) Submit(j Job) {
    d.mu.Lock()
    d.queue = append(d.queue, j)
    d.cond.Signal()
    d.mu.Unlock()
}

func (d *Dispatcher) Stop() {
    d.mu.Lock()
    d.quit = true
    d.cond.Broadcast()
    d.mu.Unlock()
}

func (d *Dispatcher) worker() {
    for {
        d.mu.Lock()
        for len(d.queue) == 0 && !d.quit {
            d.cond.Wait()
        }
        if d.quit {
            d.mu.Unlock()
            return
        }
        job := d.queue[0]
        d.queue = d.queue[1:]
        d.mu.Unlock()
        job.Run()
    }
}
```

Walk through it.

- `worker` runs forever, locking, waiting until either there is work or shutdown is requested, then either exiting or popping one job.
- `Submit` adds to the queue and `Signal`s one worker. One signal is sufficient because the new job will be picked up by exactly one worker.
- `Stop` sets `quit = true` and `Broadcast`s, because *all* idle workers need to learn about the shutdown.
- The `for` loop in `worker` re-checks both predicates on wake — that is the "or" inside the loop condition.

This is a perfectly fine use of `sync.Cond`. (As an exercise, try rewriting it with a `chan Job` and a `chan struct{}` for quit. It is also fine. The channel version is a bit shorter. Pick whichever your team finds easier to read.)

## 11. What can go wrong (preview)

We cover bugs in find-bug.md, but here is a preview of the common ones:

1. **`Wait` outside a lock.** Panics: `sync: unlock of unlocked mutex`.
2. **`if !cond { Wait }`.** Subtle bug — a third goroutine can mutate state between the signal and the wake, leaving the predicate false when you return.
3. **`Signal` with multiple predicates.** May wake the wrong waiter; the right waiter is never told.
4. **Copying a Cond.** `go vet` warns; runtime panics with `sync.Cond is copied`.
5. **Signal without holding the lock during the predicate change.** Lost-wakeup race; the waiter parks after the signal.

Every one of these has bitten production code at major companies. They are not academic.

## 12. Try it yourself

Take the dispatcher above. Add a `Resize(n int)` method that changes the worker pool size at runtime. Hint: you will need a `desired` counter and you will need workers to occasionally check it. This is a real exercise in tasks.md. The point is to convince yourself that `sync.Cond` makes some patterns natural that would require multiple channels.

## 13. Mental model

Here is the model to internalize:

- A `sync.Cond` is a *waiting room* attached to a *predicate over shared state*. The mutex protects the state; the Cond is the waiting room.
- `Wait` is "go to sleep until told otherwise, but let other people use the room while I sleep."
- `Signal` is "wake one person up, ignore the rest."
- `Broadcast` is "everybody wake up and check whether your reason for being here has changed."
- The `for` loop around `Wait` is the "check whether your reason has changed" part.

Internalize this and the API stops being mysterious. The hard part is not the API — it is when to use it.

## 14. When to use Cond vs channel: a junior-level decision tree

Ask yourself:

1. **Is the predicate a single boolean transition (e.g., "ready")?** → `close(chan struct{})`. Done.
2. **Is the predicate "items available" or "slots available" in a queue?** → `chan T` with appropriate capacity. Done.
3. **Do you have multiple distinct predicates over the same shared state?** → Possibly `sync.Cond` shines here. Or, equivalently, multiple channels with `select`.
4. **Do you need to "wake all" on a one-time event?** → `close(chan struct{})`. Closed channels broadcast for free.
5. **Do you need to coordinate cancellation/timeout?** → `select` on a `context.Context`'s `Done()` channel. `sync.Cond` has no built-in cancellation.

If you answered "yes" to (3) and only (3), and you can describe in one sentence why a channel would not work, then reach for `sync.Cond`. Otherwise, use a channel.

## 15. Recap

What you now know:

- A condition variable is a waiting room for goroutines that want a predicate to become true.
- `sync.Cond` provides `Wait`, `Signal`, `Broadcast`.
- The mutex protects the predicate; the Cond's job is to let goroutines park and wake cheaply.
- The five-line pattern: lock, `for !predicate { Wait() }`, unlock.
- `Signal` wakes one; `Broadcast` wakes all; when in doubt, use `Broadcast`.
- Cond does not have spurious wakeups in Go, but you still need a `for` loop because of races between signal and wake.
- Most problems that look like Cond problems are actually channel problems. Default to channels.

Next: professional.md, where we look at when Cond is actually the right tool, the rare real production cases, and the stdlib uses that justify the primitive's existence.

## 16. Step by step: writing your first Cond

Let us build a simple notifier from scratch to cement the protocol.

### Step 1: state and lock

We want a type that lets one goroutine signal "I am done" and other goroutines wait for that signal.

```go
type Notifier struct {
    mu   sync.Mutex
    done bool
}
```

The mutex protects the `done` field. So far there is no waiting machinery.

### Step 2: add a Cond

```go
type Notifier struct {
    mu   sync.Mutex
    cond *sync.Cond
    done bool
}

func NewNotifier() *Notifier {
    n := &Notifier{}
    n.cond = sync.NewCond(&n.mu)
    return n
}
```

The Cond's `L` field is `&n.mu`. Constructor is the natural place to wire this up.

### Step 3: the waiter

```go
func (n *Notifier) Wait() {
    n.mu.Lock()
    for !n.done {
        n.cond.Wait()
    }
    n.mu.Unlock()
}
```

Five lines, the canonical pattern. Lock, loop on predicate, wait inside loop, unlock when done.

### Step 4: the signaller

```go
func (n *Notifier) Notify() {
    n.mu.Lock()
    n.done = true
    n.cond.Broadcast()
    n.mu.Unlock()
}
```

We use `Broadcast` here because any number of waiters could be parked, and they should all wake. If we used `Signal`, only one would wake and the rest would block forever.

### Step 5: test it

```go
func main() {
    n := NewNotifier()

    for i := 0; i < 5; i++ {
        go func(i int) {
            n.Wait()
            fmt.Println("waiter", i, "released")
        }(i)
    }

    time.Sleep(100 * time.Millisecond)
    n.Notify()
    time.Sleep(100 * time.Millisecond)
}
```

Output:

```
waiter 3 released
waiter 1 released
waiter 0 released
waiter 4 released
waiter 2 released
```

All five waiters released. (Order depends on scheduling.)

### Step 6: now compare to a channel

The same notifier as a channel:

```go
type Notifier struct {
    ch chan struct{}
}

func NewNotifier() *Notifier {
    return &Notifier{ch: make(chan struct{})}
}

func (n *Notifier) Wait() {
    <-n.ch
}

func (n *Notifier) Notify() {
    close(n.ch)
}
```

Twelve lines vs the Cond version's 17. The channel version is also reentrant-safe (multiple `Notify` calls would panic, but you can guard with `sync.Once` if needed) and gives you `select` integration for cancellation:

```go
select {
case <-n.ch:
case <-ctx.Done():
}
```

The Cond version cannot do this without spawning a side goroutine. **This is the practical case for "default to channels."**

## 17. A second worked example: producer-consumer

Walk through this carefully. A producer generates items at irregular intervals; multiple consumers each take one item at a time.

```go
type Stream struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []int
}

func NewStream() *Stream {
    s := &Stream{}
    s.cond = sync.NewCond(&s.mu)
    return s
}

func (s *Stream) Produce(v int) {
    s.mu.Lock()
    s.items = append(s.items, v)
    s.cond.Signal()
    s.mu.Unlock()
}

func (s *Stream) Consume() int {
    s.mu.Lock()
    for len(s.items) == 0 {
        s.cond.Wait()
    }
    v := s.items[0]
    s.items = s.items[1:]
    s.mu.Unlock()
    return v
}
```

`Produce` uses `Signal` because exactly one consumer can take the new item. `Consume` follows the canonical loop pattern.

Scenario:

1. Three consumers call `Consume`; all park on the Cond (tickets 1, 2, 3).
2. Producer calls `Produce(10)`. `Signal` wakes ticket 1. Producer unlocks.
3. Consumer ticket 1: re-acquires mu inside `Wait`'s return. Sees `len(items) == 1`, exits the loop, takes 10, unlocks, returns.
4. Consumers 2 and 3 still parked.
5. Producer calls `Produce(20)`. Signal wakes ticket 2.

Note that consumers wake in FIFO order — this is a property of `Signal`'s implementation. If we used `Broadcast`, all three would wake on every produce, two would re-park, and we would burn extra scheduling cycles. So `Signal` is the right choice here, given that the predicate is "items available" and exactly one consumer can be served per item.

The channel equivalent:

```go
ch := make(chan int) // unbuffered
// Produce: ch <- v
// Consume: <-ch
```

Or with buffering:

```go
ch := make(chan int, 100)
// Produce: ch <- v   (blocks if buffer full)
// Consume: <-ch       (blocks if buffer empty)
```

One line of channel declaration replaces ~20 lines of Cond. The channel runtime handles the same FIFO wake-up. **This is why "use channels" is the default advice.**

## 18. Common interview question worked: why is `for` not `if`?

I claim that the following two snippets are NOT equivalent, even though they look superficially similar:

```go
// Version A (correct):
for !ready {
    c.Wait()
}

// Version B (buggy):
if !ready {
    c.Wait()
}
```

Here is a concrete failure scenario for B.

Setup: three goroutines G1, G2, G3 share a Cond `c` and a bool `ready`. G1 and G2 are waiters; G3 is the signaller plus also a "resetter."

1. G1: locks, sees `ready=false`, calls `Wait`. Releases lock, parks.
2. G2: locks, sees `ready=false`, calls `Wait`. Releases lock, parks.
3. G3: locks, sets `ready=true`, calls `Broadcast`, unlocks. The runtime queues G1 and G2 for wake-up, but they have not actually re-acquired the lock yet.
4. G3 (continuing): immediately re-locks, sets `ready=false` (a "reset"), unlocks.
5. G1: woken up by Broadcast. Re-acquires the lock inside `Wait`. Returns from `Wait` with the lock held. *Predicate check inside `if !ready`*: G1 has already done the check (in step 1) and entered the `Wait` body; it does NOT re-check. So G1 proceeds with `ready == false` and corrupts whatever invariant the code relies on.

If the version were `for !ready { c.Wait() }`, step 5 would re-check the predicate, find it false, and re-park G1. Eventually, when `ready` is set to true again and Broadcast is called, G1 would proceed correctly.

This is exactly the kind of subtle bug that makes `sync.Cond` hard. The fix is one character: `if` to `for`. The cost of getting it wrong is silent data corruption that surfaces only under high load. **Always use `for`.**

## 19. Frequently asked beginner questions

### Q: Why does `Wait` need a lock?

To prevent the lost-wakeup race. Without the lock, you could read the predicate, decide to wait, and another goroutine could change the predicate and signal *before* you actually park. You'd then park, and there would be no future signal. The lock plus the `notifyListAdd` ordering eliminate this race.

### Q: Why not just check the predicate and `select` on a channel?

You can! That is the channel-based alternative. The reason Cond exists is for cases where the predicate involves multiple variables and changing it under a lock is natural. But for the simple "wait for one boolean," a channel is better.

### Q: What is `sync.Locker`?

An interface with two methods: `Lock()` and `Unlock()`. Both `*sync.Mutex` and `*sync.RWMutex` satisfy it. `sync.NewCond` takes a `Locker`, so any of these works.

### Q: Can I share one Cond between multiple structs?

Technically yes, but it almost never makes sense. The Cond is logically tied to a specific lock and a specific predicate. If your design has two different predicates, use two Conds.

### Q: What happens if I forget to `Broadcast`?

Waiters wait forever. There is no timeout. The bug surfaces as goroutine leaks visible in `pprof` (look for goroutines in `runtime.semacquire1` underneath `sync.(*Cond).Wait`).

### Q: Can `Wait` panic?

Yes, if called without holding `cond.L`. The internal `Unlock` will panic. Also, if the Cond itself has been copied after first use, the `copyChecker` panics with `sync.Cond is copied`.

### Q: Is `sync.Cond` safe to use across goroutines?

The whole point of Cond is to coordinate across goroutines. So yes, it is designed for this. But the Cond struct itself must be referenced by pointer — never copied — and the underlying Locker must be the same across all callers.

## 20. Quick reference card

Print this and stick it on your monitor:

```
sync.Cond cheat sheet
=====================
Construct:   c := sync.NewCond(&mu)
Wait:        mu.Lock(); for !pred { c.Wait() }; mu.Unlock()
Signal:      mu.Lock(); changePred(); c.Signal(); mu.Unlock()       // one waiter
Broadcast:   mu.Lock(); changePred(); c.Broadcast(); mu.Unlock()    // all waiters

Rules:
  - mu MUST be held when calling Wait.
  - mu SHOULD be held when calling Signal/Broadcast (avoids lost-wakeup).
  - Wait MUST be wrapped in `for`, never `if`.
  - Use Broadcast when in doubt — wasted wake-ups are cheap, lost ones are bugs.
  - Never copy a sync.Cond by value (use *sync.Cond, not sync.Cond).
  - No timeout / cancellation built in — use channels if you need either.

Default decision: prefer channels. Use Cond only if:
  - Multiple distinct predicates over one mutex-protected struct.
  - No cancellation/timeout requirement.
  - The channel alternative is genuinely less readable.
```

## 21. Exercises to do before moving on

Before reading the next page, do these by hand:

1. Implement a `OnceLatch` using `sync.Cond`. `Release()` releases all waiters; subsequent `Release()` calls are no-ops; subsequent `Wait()` calls return immediately. (15 minutes.)
2. Rewrite the same thing using `chan struct{}` and `sync.Once`. (5 minutes.)
3. Implement a bounded buffer using `sync.Cond` (as shown above). (20 minutes.)
4. Rewrite it as a buffered `chan`. (2 minutes.)
5. Try to add `WaitTimeout(d time.Duration)` to the Cond version of (1). (30 minutes; you will find it ugly.)
6. Add `WaitTimeout` to the channel version. (3 minutes; `select` with `time.After`.)

The asymmetry between Cond and channel for these exercises is the whole lesson. The channel versions are shorter, faster, and feature-richer. Cond's niche is narrower than its API suggests.

## 22. Going forward

The professional.md page tackles:

- The real production cases where Cond is the right tool.
- Reading stdlib source (`io.Pipe`, `os/exec`) for canonical examples.
- The deprecation conversation around `sync.Cond`.
- Bryan Mills's "replace Cond with channels" patterns.
- A real refactor story converting a Cond-heavy service to channels.

After that, specification.md gives you the full godoc + memory model. interview.md is 40 questions you can use to test yourself. tasks.md, find-bug.md, and optimize.md are practice and reference.

The mental model to internalize:

- `sync.Cond` is a low-level building block for the rare case where channels do not fit.
- For 95% of waiting scenarios, channels are the right answer.
- For the other 5%, Cond is correct but error-prone — you must know the rules cold.

If after this page you remember nothing else, remember: **lock, `for`, `Wait`, unlock**. That is the only safe pattern. The rest is judgement.

## 23. A longer worked example: the bathroom problem

A common teaching example for condition variables: a bathroom that can hold up to N people of the same gender at a time. People of opposite genders cannot be inside simultaneously. Goroutines call `EnterMale()` / `EnterFemale()` and `Leave()`.

We have three predicates:

- Male can enter if no females are inside AND the count is below N.
- Female can enter if no males are inside AND the count is below N.
- Leave can always happen.

```go
type Bathroom struct {
    mu       sync.Mutex
    cond     *sync.Cond
    capacity int
    males    int
    females  int
}

func New(capacity int) *Bathroom {
    b := &Bathroom{capacity: capacity}
    b.cond = sync.NewCond(&b.mu)
    return b
}

func (b *Bathroom) EnterMale() {
    b.mu.Lock()
    for b.females > 0 || b.males == b.capacity {
        b.cond.Wait()
    }
    b.males++
    b.mu.Unlock()
}

func (b *Bathroom) EnterFemale() {
    b.mu.Lock()
    for b.males > 0 || b.females == b.capacity {
        b.cond.Wait()
    }
    b.females++
    b.mu.Unlock()
}

func (b *Bathroom) LeaveMale() {
    b.mu.Lock()
    b.males--
    if b.males == 0 {
        b.cond.Broadcast()
    } else {
        b.cond.Signal()
    }
    b.mu.Unlock()
}

func (b *Bathroom) LeaveFemale() {
    b.mu.Lock()
    b.females--
    if b.females == 0 {
        b.cond.Broadcast()
    } else {
        b.cond.Signal()
    }
    b.mu.Unlock()
}
```

Walk through the design decisions:

1. **One mutex, one Cond.** The shared state (`males`, `females`) is small enough that one mutex is fine. The Cond covers two different predicates (male can enter, female can enter), so we must `Broadcast` in the case where state change could unblock either predicate.
2. **Why `Broadcast` when the bathroom empties.** When `males` drops to zero, females may now enter. There might be many waiting females; we want to wake all of them so they can race for the bathroom. (The `capacity` limit means at most `capacity` will succeed; the rest will re-wait. That is the cost of using one Cond for multiple predicates.)
3. **Why `Signal` otherwise.** When males drop from 5 to 4, only another male can enter (since females are still blocked by the presence of males). One male can enter, so `Signal` is correct.
4. **Why `for` not `if`.** Between the wake-up and re-acquisition of the lock, another goroutine could enter. The for-loop re-checks the predicate.

This is a textbook case where Cond is at least competitive with channels. The channel version would need at least two channels (one per gender), a counter, and complex coordination logic. Cond's strength is that one mutex protects all the shared state, and one Cond covers all the waiting.

### Stress-testing the bathroom

A real test would look like this:

```go
func TestBathroom(t *testing.T) {
    b := New(3)
    var wg sync.WaitGroup
    for i := 0; i < 50; i++ {
        wg.Add(2)
        go func() { defer wg.Done(); b.EnterMale(); time.Sleep(time.Millisecond); b.LeaveMale() }()
        go func() { defer wg.Done(); b.EnterFemale(); time.Sleep(time.Millisecond); b.LeaveFemale() }()
    }
    wg.Wait()
}
```

Run with `-race`. If you have any of the classic Cond bugs (signal without lock, `if` instead of `for`, `Signal` where `Broadcast` was needed), this test eventually catches it. Concurrency bugs are probabilistic — increase the iteration count or run under stress (`go test -count=100 -race`) to surface them.

### The channel-based alternative

For the bathroom problem, the channel version is non-trivial. One approach uses two semaphore-channels and a coordinator goroutine:

```go
type Bathroom struct {
    enterMale   chan struct{}
    enterFemale chan struct{}
    leave       chan rune // 'M' or 'F'
}
```

The coordinator goroutine accepts entry requests from one channel at a time, tracking who is inside. This works but is more code than the Cond version. The Cond version's strength is the shared-mutex design.

This is the rare case where Cond is the natural fit. Internalize the difference: shared-state, multi-predicate problems are Cond's niche. Queue-shaped problems are channel's niche.

## 24. Why `Broadcast` is the safe default

In code review, you will see arguments like "use `Signal`, it's more efficient." For a junior, the safer rule is: **default to `Broadcast`, switch to `Signal` only when you can prove correctness.**

The argument:

- A wasted wake-up costs about 1 microsecond (the waiter wakes, re-checks the predicate, re-parks). This is negligible at any reasonable load.
- A missed wake-up means a goroutine waits forever. This is a correctness bug that might not surface for hours and might not be reproducible.

For the same reason, the canonical condition variable lecture at universities teaches `Broadcast` first. The trade-off:

| Approach | Risk |
|---|---|
| `Broadcast` always | Slightly slower under high contention |
| `Signal` always | Lost wake-ups if predicate is multi-modal |

When you have *one* predicate and *one* type of waiter, `Signal` is safe and slightly faster. When you have *multiple* predicates (different reasons to wait), `Broadcast` is the only correct choice. When in doubt, `Broadcast`.

## 25. A debugging story

Here is a real-world Cond debugging story from a service I helped triage.

**Symptom.** Hourly health-check failures. The service was a request router with a connection pool. Pool size was supposed to dynamically grow when latency spiked. Health checks showed the pool stuck at minimum size for 5+ minutes at a time, then suddenly recovering.

**Diagnosis.** We took goroutine dumps during a stuck period. 47 goroutines were sitting in `sync.(*Cond).Wait` under `pool.getConnection()`. The pool's grow logic was:

```go
func (p *Pool) maybeGrow() {
    p.mu.Lock()
    if p.size < p.maxSize && p.waitingCount > p.size/2 {
        p.size++
        go p.startConn()
    }
    p.mu.Unlock()
}

func (p *Pool) returnConn(c *Conn) {
    p.mu.Lock()
    p.idle = append(p.idle, c)
    p.cond.Signal()  // <-- bug
    p.mu.Unlock()
}
```

The grow logic signals "a new connection is available" via the same Cond used for "a connection has been returned." Both Cond uses end up parking goroutines waiting for a connection. The signaler picks the FIFO-oldest waiter — but that waiter might have already given up (if it was about to time out), and the Signal is "consumed" by it, not delivered to a goroutine that could use it.

The fix: change to `Broadcast` so any of the parked goroutines can pick up the new connection.

```go
p.cond.Broadcast()
```

After this, the symptom disappeared. The 47 goroutines stopped piling up. Pool grew correctly.

**Lesson.** `Signal` is a footgun when waiters have side conditions (timeouts, cancellations) that you do not control from inside the Cond logic. `Broadcast` is more forgiving. The minor wasted-wake-up cost is dwarfed by the cost of debugging missing wake-ups in production.

## 26. Two-Cond bounded buffer: the textbook reference

Here is the canonical two-Cond bounded buffer, slightly more careful than the version in section 3:

```go
type BoundedBuffer[T any] struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    buf      []T
    head, tail, count int
}

func New[T any](capacity int) *BoundedBuffer[T] {
    b := &BoundedBuffer[T]{buf: make([]T, capacity)}
    b.notFull  = sync.NewCond(&b.mu)
    b.notEmpty = sync.NewCond(&b.mu)
    return b
}

func (b *BoundedBuffer[T]) Push(v T) {
    b.mu.Lock()
    for b.count == len(b.buf) {
        b.notFull.Wait()
    }
    b.buf[b.tail] = v
    b.tail = (b.tail + 1) % len(b.buf)
    b.count++
    b.notEmpty.Signal()
    b.mu.Unlock()
}

func (b *BoundedBuffer[T]) Pop() T {
    b.mu.Lock()
    for b.count == 0 {
        b.notEmpty.Wait()
    }
    v := b.buf[b.head]
    var zero T
    b.buf[b.head] = zero  // help GC if T is a pointer-like
    b.head = (b.head + 1) % len(b.buf)
    b.count--
    b.notFull.Signal()
    b.mu.Unlock()
    return v
}
```

Notice the upgrades over section 3:

- A real ring buffer (head/tail/count) instead of a slice-grow.
- Generic over `T`.
- Zeroing the slot in `Pop` so GC can collect referenced objects.
- Still using `Signal` (not `Broadcast`) because each push frees at most one consumer and each pop frees at most one producer.

This is roughly 25 lines of correct, idiomatic Cond. The channel equivalent is one line:

```go
ch := make(chan T, capacity)
```

If you find yourself writing the 25-line version, ask why. The answer should be specific (e.g., "I need to add a `Peek` method that does not block," which channels do not support natively).

## 27. The minimal Cond test pattern

If you do use Cond, your tests must include race-detection runs:

```go
func TestBufferRace(t *testing.T) {
    b := New[int](10)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(2)
        go func() { defer wg.Done(); for j := 0; j < 100; j++ { b.Push(j) } }()
        go func() { defer wg.Done(); for j := 0; j < 100; j++ { _ = b.Pop() } }()
    }
    wg.Wait()
}
```

Run with:

```
$ go test -race -count=50
```

50 iterations is the bare minimum to surface scheduler-dependent bugs. For high-confidence runs, use 1000 or more. Race-detection slows tests by ~2x but catches data races that would otherwise be invisible.

## 28. Where to go next

You now have the mechanics of `sync.Cond`. The next page (professional.md) covers when to actually use it in production. The pages after that cover specification, interview questions, hands-on tasks, find-the-bug exercises, and performance optimization.

A useful homework: open `src/sync/cond.go` in the Go source tree. Read the 90 lines. Notice the `noCopy` and `copyChecker`. Notice the `runtime_notifyListAdd` happening *before* `c.L.Unlock()` in `Wait`. Notice that there is no `WaitContext` and no `WaitTimeout`. That entire surface area is the API you now know.

Then run `grep -rn 'sync.NewCond' $(go env GOROOT)/src` and read the real usages. There are fewer than ten. They are concentrated in `io.Pipe` and a few other low-level synchronization primitives. This is the empirical evidence that the Go team itself uses Cond sparingly.

## 29. The "why no spurious wakeups" deep-dive

A topic that confuses many learners: POSIX condition variables permit *spurious wakeups* — `pthread_cond_wait` can return without any matching `signal`/`broadcast`, for implementation reasons. Programs must defensively check the predicate in a loop.

Go's `sync.Cond.Wait` does NOT permit spurious wakeups. The docstring says:

> Unlike in other systems, Wait cannot return unless awoken by Broadcast or Signal.

Why does Go forbid them? Because the runtime's notify-list is precise: tickets are issued in order, and a wake-up matches a specific ticket. There is no mechanism that would cause a wake-up without a corresponding signal.

So why do you *still* need a `for` loop? Because of the **stolen wakeup** problem we covered above. A signal wakes goroutine A. Before A re-acquires the lock, goroutine B grabs the lock, mutates the predicate, and releases. A finally re-acquires the lock — but the predicate is now false again. A must re-check.

This is conceptually distinct from POSIX's spurious wakeup but requires the same defensive code:

```go
for !predicate() {
    c.Wait()
}
```

The for-loop is universal across POSIX threads, Java's `Object.wait`, and Go's `sync.Cond.Wait`. It is one of those universal concurrency idioms: re-check the precondition after waking up.

## 30. Visualizing the FIFO notify list

Here is what the notify list looks like in memory, conceptually:

```
notifyList:
  wait    = 5      // next ticket to issue
  notify  = 2      // next ticket to wake
  head -> [ticket=2, G_b] -> [ticket=3, G_c] -> [ticket=4, G_d] -> nil
```

`G_a` was ticket 1 and has already been woken. `G_b`, `G_c`, `G_d` are parked, waiting for their tickets to be matched by Signal.

- A `Signal` call increments `notify` from 2 to 3 and calls `goready(G_b)`.
- A `Broadcast` call iterates the list, calling `goready` on each, and advances `notify` to `wait` (5 in this case).

This is why `Signal` is FIFO — the runtime walks the list head-first. It is also why `Signal` is O(1) and `Broadcast` is O(N) in the number of waiters.

## 31. Mental practice problem

Try to solve this in your head:

> A barrier coordinates N goroutines. Each goroutine calls `Arrive()`. The first N-1 callers block. When the Nth goroutine arrives, all N are released. The barrier resets so it can be used again.

Sketch the Cond version:

```go
type Barrier struct {
    mu       sync.Mutex
    cond     *sync.Cond
    n        int  // required arrivals
    arrived  int
    generation int  // increment on each release to distinguish phases
}

func (b *Barrier) Arrive() {
    b.mu.Lock()
    g := b.generation
    b.arrived++
    if b.arrived == b.n {
        b.arrived = 0
        b.generation++
        b.cond.Broadcast()
    } else {
        for g == b.generation {
            b.cond.Wait()
        }
    }
    b.mu.Unlock()
}
```

Why the `generation` counter? Because without it, the wait loop's predicate would be `arrived == n`, but the last arrival resets `arrived` to 0 before broadcasting. The waiters wake, see `arrived == 0`, and re-park. Deadlock.

The fix is the generation counter: each barrier-fire bumps it, and waiters check whether their generation has passed. This is a classic "the predicate is not stable" Cond pattern that distinguishes Cond from a one-shot channel.

A channel version of this barrier would use a `chan struct{}` per generation, closed when the barrier fires. The implementation looks like:

```go
type Barrier struct {
    mu    sync.Mutex
    n     int
    count int
    gate  chan struct{}
}

func New(n int) *Barrier {
    return &Barrier{n: n, gate: make(chan struct{})}
}

func (b *Barrier) Arrive() {
    b.mu.Lock()
    b.count++
    if b.count == b.n {
        b.count = 0
        old := b.gate
        b.gate = make(chan struct{})
        close(old)
        b.mu.Unlock()
        return
    }
    g := b.gate
    b.mu.Unlock()
    <-g
}
```

The channel version is roughly the same length. Pick whichever you find clearer.

## 32. Goroutine-leak detection with Cond

Cond is notorious for goroutine leaks: a waiter never gets a signal because of a bug, and it sits forever. Use `goleak` in your tests:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

This causes any test that leaves running goroutines to fail. Run with `-race` to also catch data races. The combination of `-race` + `goleak` + many iterations is the strongest CI-time safety net for Cond-based code.

## 33. A summary you can take to your next code review

When reviewing code that uses `sync.Cond`, look for:

| Check | What it tells you |
|---|---|
| `Wait` inside `for`, not `if` | If `if`, it's almost certainly a bug. |
| `Wait` inside the locked region | If outside, immediate panic on first call. |
| `Signal`/`Broadcast` under the lock | If outside, possible lost-wakeup race. |
| `Broadcast` for multi-predicate Conds | If `Signal`, possible lost wake-up. |
| `*sync.Cond`, never `sync.Cond` by value | If copied, runtime panic on first method call. |
| Cancellation requirement? | If yes, push back: channels are usually better. |
| Existing `sync.WaitGroup`/`sync.Once` alternative? | If yes, prefer the specialized primitive. |
| Channel alternative drafted? | Even if Cond is chosen, the comparison should be in the PR description. |

Junior engineers should know each of these checks. Senior engineers will additionally have intuition for which alternatives to suggest.

## 34. Closing thoughts

`sync.Cond` is a primitive every Go developer should understand, even if you never write one in production. Two reasons:

1. **Reading legacy code.** You will encounter Cond in stdlib and in old internal libraries. Knowing the protocol prevents misreading.
2. **Mental model for concurrency.** The "wait for predicate, signal under lock, loop on wake" pattern is fundamental — even channels implement it under the hood.

But the bias in Go is strongly toward channels for new code. The Go FAQ says: "Don't communicate by sharing memory; share memory by communicating." Channels are the embodiment of that philosophy. Cond is the holdover from the share-memory-by-locking world, kept for cases where the philosophy does not fit.

Your job as a junior:

1. Know the wait/signal protocol perfectly.
2. Default to channels for new code.
3. Recognize Cond bugs in code review.
4. Know when (rare) to use Cond.

That is enough. The rest is judgment that comes with experience.

## 35. Extended walkthrough: reading `sync.Cond`'s source

To make the protocol click, let us read the actual implementation in `src/sync/cond.go`. It is short enough to reproduce here in full (Go 1.22, slightly abridged for clarity):

```go
package sync

import (
    "sync/atomic"
    "unsafe"
)

type Cond struct {
    noCopy noCopy
    L Locker
    notify  notifyList
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

There is also a `copyChecker` type at the bottom of the file, which CAS-writes the Cond's own address on first use and panics on a copy.

Things to internalize from this code:

1. **The whole thing is under 100 lines.** Cond is a thin shell around the runtime's `notifyList`.
2. **`Wait` is four runtime calls.** No locking subtleties beyond the unlock-then-park order. The lock-then-unlock-then-park sequence is the lost-wakeup-prevention pattern that has been the foundation of condition variables since the 1970s.
3. **`Signal` and `Broadcast` are even simpler.** Just delegate to the runtime.

Once you read this, the API stops being mysterious. The "magic" is in `runtime_notifyListAdd` happening before `c.L.Unlock` — and that is the only magic.

## 36. Practice: trace through code

Trace the following code and write down (in your head or on paper) which goroutines are parked, which are running, and what the predicate value is at each step. Three goroutines (Alpha, Beta, Gamma); one Cond `c`; one bool `ready`.

```go
// Initial state: ready = false, no one is parked.

// Step 1: Alpha runs
c.L.Lock()         // Alpha holds L
for !ready { c.Wait() }  // Alpha parks on c (ticket 1), releases L

// Step 2: Beta runs
c.L.Lock()         // Beta holds L
for !ready { c.Wait() }  // Beta parks on c (ticket 2), releases L

// Step 3: Gamma runs
c.L.Lock()         // Gamma holds L
ready = true       // predicate change
c.Signal()         // wakes ticket 1 (Alpha)
c.L.Unlock()       // Gamma releases L

// Step 4: Alpha wakes
//   - Alpha re-acquires L (inside Wait's return)
//   - Loop check: ready == true, exit loop
c.L.Unlock()       // Alpha releases L, exits

// Beta is still parked. Will only wake on another Signal or Broadcast.
```

What if Gamma called `Broadcast` instead of `Signal`?

```go
// Step 3': Gamma runs
c.L.Lock()
ready = true
c.Broadcast()      // wakes both Alpha (ticket 1) and Beta (ticket 2)
c.L.Unlock()

// Step 4': Alpha and Beta race for L. Suppose Alpha gets it first.
//   - Alpha re-acquires L, loop check: ready == true, exit, unlock.
//   - Beta acquires L, loop check: ready == true, exit, unlock.
```

Both Alpha and Beta exit. This is why `Broadcast` is needed when multiple waiters may benefit from the predicate change.

Now consider a buggy variant where Gamma does this:

```go
// Step 3'': Gamma runs (buggy)
ready = true       // predicate change WITHOUT lock
c.Signal()         // signal WITHOUT lock
```

A bad interleaving:

1. Alpha and Beta are in step 1 and step 2 (parked under L).
2. Gamma writes `ready = true` without lock. (Race: visible to readers? Not guaranteed under Go memory model.)
3. Gamma calls `Signal()`. If no waiter has parked yet... but they have. Alpha is parked. Signal wakes ticket 1.
4. Alpha tries to re-acquire L (inside Wait return). L is not held by anyone. Alpha acquires L. Check loop: `ready == true`. Exit.

This *happens to work* but is incorrect. A different interleaving:

1. Alpha is parked (ticket 1).
2. Gamma writes `ready = true` without lock.
3. Gamma calls `Signal()`. Beta has not yet parked (Beta is in step 2 before lock). Signal goes to Alpha (the only waiter).
4. Beta now acquires L, checks `ready == true`, exits loop. Does NOT need a signal.

But suppose this:

1. Alpha and Beta both parked.
2. Gamma writes `ready = true` without lock. CPU caches not flushed yet.
3. Gamma calls `Signal()`. Wakes Alpha.
4. Alpha re-acquires L. Reads `ready`. May see stale `false` (no synchronization with Gamma's write). Re-parks.
5. Gamma's write eventually becomes visible. But no further Signal will be called. Alpha and Beta wait forever.

This is the lost-wakeup bug. The fix is to take L around the predicate change and signal:

```go
c.L.Lock()
ready = true
c.Signal()
c.L.Unlock()
```

Tracing through these examples builds the intuition. Do this exercise with several Cond examples until the pattern becomes second nature.

## 37. Common confusions clarified

### "Doesn't the lock-acquire after Wait defeat the purpose?"

No. The lock is essential for the predicate check. When `Wait` returns, the lock is held, and the goroutine can safely read the shared state. Without re-acquiring the lock, the post-Wait predicate check would race with concurrent writers.

### "Why does Wait release the lock atomically with parking?"

So that signals issued after the lock release but before the park are not lost. The `notifyListAdd` call (which registers the waiter) happens before the unlock. Any Signal/Broadcast that runs after `notifyListAdd` will see the ticket and match it, even if the waiter has not yet actually parked. The runtime handles "signal arrived before park" by making the park a no-op.

### "Can I have two goroutines `Wait`-ing simultaneously?"

Yes — that is the whole point. Each `Wait` gets its own ticket and parks independently. Signal wakes one (FIFO); Broadcast wakes all.

### "What if I call `Wait` and there's never a signal?"

The goroutine waits forever. There is no built-in timeout. This is a goroutine leak. `goleak` will catch it; production monitoring will see it via `pprof`.

### "Can I store a `sync.Cond` as a field of another struct?"

Yes, but always as a pointer (`*sync.Cond`) or by initializing the embedded `Cond` in place and never copying the parent struct. The runtime panics on copy.

## 38. Self-test before moving on

Answer these without looking back:

1. What does `Wait` do step-by-step?
2. Why is `for` needed around `Wait`?
3. When do you use `Signal` vs `Broadcast`?
4. What happens if you call `Wait` without holding the lock?
5. What happens if you copy a `sync.Cond`?
6. Does Go have spurious wakeups?
7. Can `Wait` take a timeout?
8. What is the channel equivalent of `close(ch)` for a Cond?

If you can answer all eight in your head with confidence, you have the junior-level understanding of `sync.Cond`. Move on to professional.md.

[← Back](../)
