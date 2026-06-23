---
layout: default
title: When to Use sync.Cond — Find the Bug
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/find-bug/
---

# When to Use sync.Cond — Find the Bug

[← Back](../)

Each snippet below contains at least one real bug. Find it before reading the answer. These are exactly the bugs `sync.Cond` is famous for in production code.

## Bug 1 — Wait without holding the lock

```go
type Queue struct {
    mu   sync.Mutex
    cond *sync.Cond
    data []int
}

func New() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue) Pop() int {
    for len(q.data) == 0 {
        q.cond.Wait()              // BUG
    }
    q.mu.Lock()
    v := q.data[0]
    q.data = q.data[1:]
    q.mu.Unlock()
    return v
}
```

**Bug.** `q.cond.Wait()` is called without holding `q.mu`. `Wait` internally calls `q.mu.Unlock()`, which panics if the mutex is not currently locked.

**Symptom at runtime.** Immediate panic: `sync: unlock of unlocked mutex`.

**Fix.**

```go
func (q *Queue) Pop() int {
    q.mu.Lock()
    for len(q.data) == 0 {
        q.cond.Wait()
    }
    v := q.data[0]
    q.data = q.data[1:]
    q.mu.Unlock()
    return v
}
```

The whole predicate-check-and-wait loop must be inside the locked region.

---

## Bug 2 — `if` instead of `for`

```go
type Latch struct {
    mu    sync.Mutex
    cond  *sync.Cond
    ready bool
}

func (l *Latch) Wait() {
    l.mu.Lock()
    if !l.ready {
        l.cond.Wait()            // BUG
    }
    l.mu.Unlock()
}

func (l *Latch) Release() {
    l.mu.Lock()
    l.ready = true
    l.cond.Broadcast()
    l.mu.Unlock()
}

// And elsewhere, after the latch has been used:
func (l *Latch) Reset() {
    l.mu.Lock()
    l.ready = false
    l.mu.Unlock()
}
```

**Bug.** The `if !l.ready { l.cond.Wait() }` form is unsound. Suppose `Release` runs and broadcasts. Before any of the waiters re-acquire the lock, `Reset` runs and sets `ready = false`. When a waiter finally returns from `Wait`, `ready` is false again — but with `if`, it does not re-check; it proceeds with `Unlock` and returns to the caller as if it had been released.

**Symptom.** Sporadic and impossible to reproduce locally. In production, "I waited and was told everything was ready, but it wasn't."

**Fix.** Always wrap `Wait` in a loop:

```go
for !l.ready {
    l.cond.Wait()
}
```

The Go docstring is explicit about this and even gives the loop as the example.

---

## Bug 3 — `Signal` with multiple predicates

```go
type RW struct {
    mu     sync.Mutex
    cond   *sync.Cond
    canRead, canWrite bool
}

func (r *RW) WaitRead() {
    r.mu.Lock()
    for !r.canRead {
        r.cond.Wait()
    }
    r.mu.Unlock()
}
func (r *RW) WaitWrite() {
    r.mu.Lock()
    for !r.canWrite {
        r.cond.Wait()
    }
    r.mu.Unlock()
}

func (r *RW) EnableRead() {
    r.mu.Lock()
    r.canRead = true
    r.cond.Signal()             // BUG
    r.mu.Unlock()
}
func (r *RW) EnableWrite() {
    r.mu.Lock()
    r.canWrite = true
    r.cond.Signal()             // BUG
    r.mu.Unlock()
}
```

**Bug.** Two waiters can be parked on the same Cond, one waiting on `canRead`, the other on `canWrite`. When `EnableRead` calls `Signal`, the runtime wakes the FIFO-oldest waiter — possibly the one waiting on `canWrite`. That waiter sees its predicate is still false and goes back to sleep. The waiter that *could* progress is still parked, and never gets a signal.

**Symptom.** Hung goroutines. A leak detector finds them. `go tool trace` shows them sitting in `runtime.semasleep`.

**Fix.** Use `Broadcast`. Wasted wakeups are cheap — each one re-checks its own predicate and goes back to sleep. Lost wakeups are correctness bugs.

```go
r.cond.Broadcast()
```

Better fix: split into two Conds, one per condition. But Broadcast is the simpler universal answer.

---

## Bug 4 — Copying a Cond

```go
type Worker struct {
    mu   sync.Mutex
    cond sync.Cond           // BUG: value, not pointer
    todo []func()
}

func New() Worker {
    w := Worker{}
    w.cond = sync.Cond{L: &w.mu}
    return w                 // BUG: copies the Cond (and the mutex)
}

func main() {
    w := New()
    go w.run()
    w.submit(func(){ fmt.Println("hi") })
}
```

**Bug.** `New` returns a `Worker` by value, copying the embedded `sync.Cond` and `sync.Mutex`. `go vet` will warn (`assignment copies lock value to *Worker`). At runtime, the first time `Wait`/`Signal`/`Broadcast` is called on the returned copy, the `copyChecker` panics with `sync.Cond is copied`.

**Symptom.** `go vet` reports it loudly. If you ignore vet and run anyway, you get the panic on first use.

**Fix.** Return `*Worker`, not `Worker`. Construct fields in place under the pointer.

```go
func New() *Worker {
    w := &Worker{}
    w.cond.L = &w.mu
    return w
}
```

---

## Bug 5 — Signal before park (lost wakeup)

```go
type Once struct {
    mu   sync.Mutex
    cond *sync.Cond
    done bool
}

func (o *Once) DoAsync(f func()) {
    go func() {
        f()
        o.done = true            // BUG: writing predicate without lock
        o.cond.Signal()          // BUG: signal without lock
    }()
}

func (o *Once) Wait() {
    o.mu.Lock()
    for !o.done {
        o.cond.Wait()
    }
    o.mu.Unlock()
}
```

**Bug.** The signaler mutates `o.done` and calls `Signal` without taking the lock. A `Wait` call running concurrently may execute:

1. `o.mu.Lock()`
2. Read `o.done` — sees false (the writer has not yet written)
3. *(writer thread runs entirely here: sets `o.done = true`, calls `o.cond.Signal()` on an empty notify list — no-op)*
4. `o.cond.Wait()` parks. Forever.

**Symptom.** Goroutine hangs. The bug is timing-dependent and only shows under contention, so test-once-and-ship will not catch it.

**Fix.** Take the lock when changing the predicate and signaling:

```go
func (o *Once) DoAsync(f func()) {
    go func() {
        f()
        o.mu.Lock()
        o.done = true
        o.cond.Broadcast()
        o.mu.Unlock()
    }()
}
```

The docs say the lock is "allowed but not required" during `Signal`/`Broadcast` — but the lock is *required* during the predicate change, and taking the lock around both makes the entire sequence atomic, eliminating the lost-wakeup race.

---

## Bug 6 — Broadcast outside the loop's lock invariant

```go
type Pool struct {
    mu    sync.Mutex
    cond  *sync.Cond
    avail int
}

func (p *Pool) Take() {
    p.mu.Lock()
    for p.avail == 0 {
        p.cond.Wait()
    }
    p.avail--
    p.mu.Unlock()
}

func (p *Pool) Put() {
    p.mu.Lock()
    p.avail++
    p.mu.Unlock()                // BUG: unlock before signal
    p.cond.Signal()              // BUG: see below
}
```

**Bug.** The unlock-then-signal order is a footgun for two reasons:

1. Another `Put` may interleave between unlock and signal, both having incremented `avail` to 2, and one of them losing its signal because there is no parked waiter at the moment.
2. More subtly, between the unlock and the signal, a new caller of `Take` may grab the lock, see `avail > 0`, decrement, and leave. Then the `Signal` fires when there is a parked waiter, but `avail` is already back to zero — wasted wakeup, waiter goes back to sleep. That part is harmless. The harmful interleaving is (1): under heavy contention you can demonstrably lose signals.

A second issue: `Signal` wakes only one waiter, but if `Put` is called twice in a row (and there are two waiters), the second `Signal` may also be lost as above. `Broadcast` is safer here.

**Symptom.** Some `Take` callers block longer than expected under load. Hard to reproduce.

**Fix.** Hold the lock for the predicate change and the signal together:

```go
func (p *Pool) Put() {
    p.mu.Lock()
    p.avail++
    p.cond.Signal()
    p.mu.Unlock()
}
```

For a pool where any of N waiters can be served by any of N Put calls, `Signal` is fine if you signal under the lock. If you have any doubt, use `Broadcast`.

---

## Bug 7 — Re-using a closed broadcast (Cond does not "close")

```go
type Gate struct {
    mu     sync.Mutex
    cond   *sync.Cond
    opened bool
}

func (g *Gate) Open() {
    g.mu.Lock()
    g.opened = true
    g.cond.Broadcast()
    g.mu.Unlock()
}

func (g *Gate) Close() {
    g.mu.Lock()
    g.opened = false
    g.mu.Unlock()                // BUG: nothing wakes waiters
}

func (g *Gate) Pass() {
    g.mu.Lock()
    for !g.opened {
        g.cond.Wait()
    }
    g.mu.Unlock()
}
```

**Bug.** `Close` mutates state but does not signal. That is OK *if* no waiter cares about the close. But suppose the program shuts down and wants to release all `Pass` callers with an error — `Close` provides no mechanism to wake them, and they sit forever in `Wait`.

This is the structural reason channels are preferred for fan-out: `close(ch)` does both the state change and the broadcast atomically and irreversibly. With `sync.Cond` you must remember to broadcast on every state change that could unblock waiters.

**Fix.** Add a `closed` flag and broadcast on close:

```go
func (g *Gate) Close() {
    g.mu.Lock()
    g.closed = true
    g.cond.Broadcast()
    g.mu.Unlock()
}
func (g *Gate) Pass() error {
    g.mu.Lock()
    for !g.opened && !g.closed {
        g.cond.Wait()
    }
    closed := g.closed
    g.mu.Unlock()
    if closed { return errClosed }
    return nil
}
```

[← Back](../)
