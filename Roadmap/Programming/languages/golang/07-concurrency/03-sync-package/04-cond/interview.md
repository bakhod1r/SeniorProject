# sync.Cond — Interview Questions

A `sync.Cond` question in a Go interview is usually a signal that the interviewer wants to see three things:

1. You know the discipline rules cold (`for` loop, lock-around-wait, lock-around-signal).
2. You can compare `Cond` to channels and reason about when each wins.
3. You understand the runtime model enough to explain *why* the rules exist.

Below are 25 graded questions with model answers.

---

## Warm-up

**Q1.** What is `sync.Cond`?

**A.** A condition variable. It pairs with a `sync.Locker` and provides `Wait`, `Signal`, `Broadcast`. Waiters park until a state predicate becomes true; signallers wake one or all of them after modifying state.

---

**Q2.** How do you construct one?

**A.** `c := sync.NewCond(&mu)` where `mu` is a `sync.Mutex` or any `sync.Locker`. Always store as `*sync.Cond`, never by value.

---

**Q3.** What does `Wait` do?

**A.** Three atomic steps: release the lock, park the goroutine on the wait list, suspend execution. On wake-up: re-acquire the lock, return.

---

**Q4.** What is the difference between `Signal` and `Broadcast`?

**A.** `Signal` wakes one waiter (runtime chooses which); `Broadcast` wakes all waiters. If no one is waiting, both are no-ops — signals are not buffered.

---

**Q5.** Why must `Wait` be inside a `for` loop?

**A.** Three reasons: spurious wake-ups are permitted by the spec, a `Broadcast` may wake multiple waiters competing for one resource (only one wins, others must re-check), and a `Signal` for an unrelated predicate may wake the wrong waiter. The `for` loop makes every wake-up safe.

---

## Discipline

**Q6.** Do you need to hold the lock when calling `Wait`?

**A.** Yes. `Wait` calls `c.L.Unlock()` internally. If the lock isn't held, the runtime panics with "sync: unlock of unlocked mutex".

---

**Q7.** Do you need to hold the lock when calling `Signal`?

**A.** The spec says "permitted but not required." In practice, always hold the lock around the state change and the signal. Signalling outside the lock opens a race: a waiter could re-check the predicate, find it true (or false), and then the signal arrives at the wrong time. Discipline says: lock, change state, signal, unlock.

---

**Q8.** What happens if you call `Signal` while no goroutine is waiting?

**A.** The signal is dropped. The next waiter does not receive a "pending" signal. This is safe because the waiter checks the predicate under the lock before calling `Wait`. If the predicate was already true, the waiter never parks.

---

**Q9.** Can you copy a `sync.Cond`?

**A.** No. The internal wait list and ticket counters cannot be safely duplicated. `go vet`'s `copylocks` analyzer flags copies; the runtime has a `copyChecker` that panics if a `Cond` is used at a new address. Always use `*sync.Cond`.

---

**Q10.** Can you reassign `Cond.L` after construction?

**A.** The field is public so the compiler allows it, but doing so while waiters are parked is undefined behavior — they unlocked the old lock and would re-acquire the new one. Treat `L` as immutable after `NewCond`.

---

## Comparison with channels

**Q11.** When should you use `sync.Cond` instead of a channel?

**A.** When you have one piece of shared state with multiple distinct predicates over it. The bounded queue is the canonical example: producers wait on "not full," consumers wait on "not empty," both share the same slice. Channels could not express this without splitting the state. Also: when you need repeated broadcast wake-ups (channels' `close` is one-shot), or when explicit state inspection (Snapshot, Drain) is required.

---

**Q12.** When should you avoid `sync.Cond`?

**A.** When you need cancellation by `context.Context`, when you need timeouts, when you need to compose with other operations via `select`, when the wake-up should carry a value, or when the team prefers Go idioms over C-style primitives. In all these cases, channels win.

---

**Q13.** Why does Go's standard library prefer channels?

**A.** Channels integrate with `select` and `context.Context` naturally, support timeouts, carry values, and have stronger fairness (FIFO). `Cond` requires the user to enforce all this manually. The standard library reviewers, Effective Go, and Bryan Mills' "Rethinking Classical Concurrency Patterns" all push toward channels.

---

**Q14.** Implement a "wait until ready" with both `Cond` and a channel. Compare.

**A.**

```go
// Cond:
mu.Lock()
for !ready { cond.Wait() }
mu.Unlock()

// signaller:
mu.Lock(); ready = true; cond.Signal(); mu.Unlock()

// Channel:
<-readyCh

// signaller (one waiter): readyCh <- struct{}{}
// signaller (many waiters): close(readyCh)
```

The channel version is shorter, supports `select` and `ctx.Done()`, and is harder to misuse. The `Cond` version is more flexible for repeated wake-ups but verbose.

---

## Patterns

**Q15.** Implement a bounded queue with `sync.Cond`.

**A.**

```go
type Q struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    items    []int
    cap      int
}

func NewQ(cap int) *Q {
    q := &Q{cap: cap}
    q.notFull = sync.NewCond(&q.mu)
    q.notEmpty = sync.NewCond(&q.mu)
    return q
}

func (q *Q) Push(v int) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == q.cap { q.notFull.Wait() }
    q.items = append(q.items, v)
    q.notEmpty.Signal()
}

func (q *Q) Pop() int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 { q.notEmpty.Wait() }
    v := q.items[0]
    q.items = q.items[1:]
    q.notFull.Signal()
    return v
}
```

Two `Cond`s, one mutex. Each operation signals the *other* condition (a push frees up "not empty" for consumers; a pop frees up "not full" for producers).

---

**Q16.** How would you add `Close` to that queue?

**A.**

```go
type Q struct {
    // ... as before
    closed bool
}

func (q *Q) Close() {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.closed = true
    q.notFull.Broadcast()
    q.notEmpty.Broadcast()
}

// In Push: for !q.closed && len(q.items) == q.cap { q.notFull.Wait() }
//          then check q.closed and return error if set
// In Pop:  for !q.closed && len(q.items) == 0   { q.notEmpty.Wait() }
//          then drain remaining items; return error only when empty AND closed
```

`Broadcast` because every parked goroutine must observe the close.

---

**Q17.** Why two `Cond`s instead of one?

**A.** A single `Cond` would broadcast on every push and every pop, waking both producers and consumers each time. Most of them re-park immediately because their predicate isn't satisfied (consumers don't care about "not full"; producers don't care about "not empty"). Two `Cond`s let each wait set be woken only when its predicate changes.

---

**Q18.** Implement a `WaitGroup`-like primitive with `Cond`.

**A.**

```go
type WG struct {
    mu   sync.Mutex
    cond *sync.Cond
    n    int
}

func NewWG() *WG {
    w := &WG{}
    w.cond = sync.NewCond(&w.mu)
    return w
}

func (w *WG) Add(delta int) {
    w.mu.Lock()
    w.n += delta
    if w.n == 0 { w.cond.Broadcast() }
    w.mu.Unlock()
}

func (w *WG) Done() { w.Add(-1) }

func (w *WG) Wait() {
    w.mu.Lock()
    for w.n > 0 { w.cond.Wait() }
    w.mu.Unlock()
}
```

`Broadcast` because multiple `Wait` callers must all observe `n == 0`. Note: the real `sync.WaitGroup` is implemented with atomics and `runtime/sema` directly for speed; this is the conceptual equivalent.

---

## Runtime / internals

**Q19.** What runtime primitive does `Cond.Wait` ultimately call?

**A.** `runtime_notifyListAdd` allocates a ticket; `runtime_notifyListWait` parks the goroutine via `goparkunlock`. On Linux this eventually reaches the `futex` syscall when a thread needs to block. Internally the wait queue is a linked list of `sudog` structs protected by a runtime mutex.

---

**Q20.** How does the ticket mechanism prevent lost wake-ups?

**A.** The ticket is allocated under `cond.L`. After the user's `Wait` calls `c.L.Unlock()`, a `Signal` could fire and notify the ticket. The runtime's `notifyListWait` then checks: "is my ticket less than `notify`?" — if yes, the signal already happened, so don't park. This collapses the race between unlock and park.

---

**Q21.** What is a "spurious wake-up"?

**A.** A wake-up not caused by `Signal` or `Broadcast`. The spec permits them; current Go implementations don't produce them, but POSIX condition variables can. The `for` loop makes them harmless: the predicate is false, so the waiter re-parks.

---

**Q22.** What memory model guarantee does `Cond` provide?

**A.** A `Signal` or `Broadcast` is synchronized before the corresponding `Wait` returns. So writes done by the signaller *before* the signal (under `cond.L`) are visible to the waiter *after* `Wait` returns (under `cond.L` again). The lock provides the happens-before edge; the `Cond` only manages parking.

---

## Bugs

**Q23.** Spot the bug.

```go
mu.Lock()
if !ready {
    cond.Wait()
}
process(state)
mu.Unlock()
```

**A.** `if` instead of `for`. On a spurious wake-up, `ready` could still be false but `process(state)` runs anyway. Replace with `for !ready { cond.Wait() }`.

---

**Q24.** Spot the bug.

```go
go func() {
    for {
        cond.L.Lock()
        if queue.len() > 0 {
            v := queue.pop()
            cond.L.Unlock()
            process(v)
            continue
        }
        cond.L.Unlock()
        cond.Wait() // BUG
    }
}()
```

**A.** `cond.Wait()` is called without holding the lock — panic. Also: there's a race between unlock and `Wait` where another goroutine could push and signal, and we miss it. Fix: keep the lock held, use `for queue.len() == 0 { cond.Wait() }`.

---

**Q25.** Spot the bug.

```go
mu.Lock()
state.value = newValue
mu.Unlock()
cond.Signal() // outside the lock
```

**A.** Subtle. Signalling outside the lock opens a race: another goroutine could lock, see the new value, do its thing, and unlock — then our `Signal` fires to a different waiter, who wakes, re-checks, finds the predicate false (because the first goroutine consumed the change), and re-parks. Net effect: a wasted wake-up plus a missed wake-up for the actual beneficiary. Fix: signal under the lock.

```go
mu.Lock()
state.value = newValue
cond.Signal()
mu.Unlock()
```

---

## Bonus / tricky

**Q26.** Why is there no `Cond.WaitTimeout` in the standard library?

**A.** The Go community decided that `select` with `time.After` covers the use case for channels, and the standard library does not encourage `Cond` for new code. Adding `WaitTimeout` would be a non-trivial change to the wait list, and it would arrive long after channels became the idiom. So it never landed.

---

**Q27.** Can `Cond.Wait` deadlock?

**A.** Yes if you violate the discipline. Common ways: holding two locks across `Wait` and another goroutine acquires them in opposite order; recursively calling a function that locks `cond.L` from inside a callback invoked after wake-up; deadlock on the signal path because the signaller can't acquire `cond.L`. The `Cond` itself does not deadlock — the surrounding lock discipline does.

---

**Q28.** How would you implement `Cond` from scratch using only a mutex and a channel?

**A.** Conceptually:

```go
type myCond struct {
    L  sync.Locker
    ch chan struct{}
}

func (c *myCond) Wait() {
    c.L.Unlock()
    <-c.ch
    c.L.Lock()
}
```

The problem: this only works for one waiter at a time, and `Signal` sending on `c.ch` blocks if no one is listening. Buffered channels lose the "one wake = one signal" invariant. To replicate `Cond` fully you need a list of per-waiter channels and a mutex to manage them — essentially reimplementing `notifyList`. This is why the runtime provides `notifyList` directly.

---

**Q29.** Two waiters, both wait on `Cond`. A `Broadcast` fires. What is the order in which they wake?

**A.** Unspecified. The runtime makes no guarantee. Treat the wake order as arbitrary.

---

**Q30.** Should new Go code use `sync.Cond`?

**A.** Usually no — channels are the idiom. Exceptions exist (multi-predicate over one state, repeated broadcast, explicit state inspection, performance-critical paths), but each use should be justified in a comment. If the team is split, the default should be channels.

---

## Closing observation

A candidate who answers all 30 of these correctly knows `sync.Cond` better than most production Go code that uses it. The most common gap is question 25 (signal-outside-lock subtlety) and question 12 (channel migration awareness). If you can articulate the answers to those two, you are in good shape.
