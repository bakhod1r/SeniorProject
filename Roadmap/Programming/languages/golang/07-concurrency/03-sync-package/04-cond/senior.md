# sync.Cond — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing State Machines on Top of Cond](#designing-state-machines-on-top-of-cond)
3. [The "Predicate-Per-Condition" Discipline](#the-predicate-per-condition-discipline)
4. [Cond vs Channel — The Decision Framework](#cond-vs-channel-the-decision-framework)
5. [Cond vs Semaphore — Two Subtly Different Tools](#cond-vs-semaphore-two-subtly-different-tools)
6. [Integrating with `context.Context`](#integrating-with-contextcontext)
7. [Fairness, Starvation, and Priority](#fairness-starvation-and-priority)
8. [Hot Paths and Lock Contention](#hot-paths-and-lock-contention)
9. [Why the Standard Library Avoids Cond Internally](#why-the-standard-library-avoids-cond-internally)
10. [Code Review Lens for Cond in Production](#code-review-lens-for-cond-in-production)
11. [Migration: Cond to Channels](#migration-cond-to-channels)
12. [Summary](#summary)

---

## Introduction

At the senior level the question is no longer "does my `Cond` code work?" — it's "does this entire subsystem belong on `Cond` at all, and if so what does its design look like at scale?" Reaching for `sync.Cond` in 2026 Go is a deliberate architectural choice that should be made consciously, justified in comments, and revisited when the surrounding system grows.

This file is the answer to the recurring code-review question: "I see a `sync.Cond` in this PR. Is that the right tool, or is it a translation from a C/C++ habit?"

Three things distinguish senior-level use of `Cond`:

1. The decision to use `Cond` is made against a clear alternative (channels, semaphore, atomic state machine) with the trade-offs written down.
2. The state machine the `Cond` participates in is small, documented, and tested. Predicates are named, transitions are explicit.
3. The shutdown/cancellation story is part of the design from day one, not an afterthought added when goroutine leaks appear in production.

If you read this file and conclude "I should use channels," you have read it correctly. That conclusion is the most common one. The narrow cases where `Cond` is preferable are the subject of the second half of this file.

---

## Designing State Machines on Top of Cond

A `Cond`-based subsystem is almost always a state machine: states + transitions + waiters parked on transitions.

```go
type State int
const (
    StateInit State = iota
    StateRunning
    StatePaused
    StateClosed
)

type Service struct {
    mu        sync.Mutex
    cond      *sync.Cond
    state     State
    runners   int
}
```

The state field encodes the current condition; the `Cond` synchronizes transitions.

```go
func (s *Service) Run(ctx context.Context) {
    s.mu.Lock()
    s.runners++
    s.mu.Unlock()

    defer func() {
        s.mu.Lock()
        s.runners--
        s.cond.Broadcast()    // someone may be waiting for runners==0
        s.mu.Unlock()
    }()

    for {
        s.mu.Lock()
        for s.state == StatePaused {
            s.cond.Wait()
        }
        if s.state == StateClosed {
            s.mu.Unlock()
            return
        }
        s.mu.Unlock()
        s.step(ctx)
    }
}

func (s *Service) Pause() {
    s.mu.Lock()
    s.state = StatePaused
    s.mu.Unlock()
    // no broadcast needed; running goroutines will pause on their next iteration
}

func (s *Service) Resume() {
    s.mu.Lock()
    s.state = StateRunning
    s.cond.Broadcast() // all paused runners wake
    s.mu.Unlock()
}

func (s *Service) Close() {
    s.mu.Lock()
    s.state = StateClosed
    s.cond.Broadcast() // wake everyone — paused runners + waitClosed callers
    s.mu.Unlock()
}

func (s *Service) WaitClosed() {
    s.mu.Lock()
    for s.runners > 0 || s.state != StateClosed {
        s.cond.Wait()
    }
    s.mu.Unlock()
}
```

Three predicates over the same state, three wait sites, three transitions. One mutex, one `Cond`. Two `Broadcast`s — on resume and close. No `Signal`s, because every transition is potentially observed by multiple waiters.

This design works. It is also more verbose than the channel equivalent. The trade-off:

- The `Cond` version exposes the state field directly. Callers can inspect `s.State()` without a synchronization primitive being the source of truth.
- The channel version hides state in the channel itself. Inspecting "how many runners are active" requires an extra atomic counter.

Senior engineers choose between them based on what the rest of the codebase looks like. If the service is a building block in a larger state machine that other components inspect, explicit state is valuable. If it is a self-contained worker, channels are simpler.

---

## The "Predicate-Per-Condition" Discipline

Every `Cond` corresponds to exactly one predicate. Avoid the "general purpose `Cond`" anti-pattern:

```go
// BAD
type Worker struct {
    mu   sync.Mutex
    cond *sync.Cond
}

// And throughout the code, different functions call cond.Wait() with different predicates:
// some wait for state==Running
// some wait for queue non-empty
// some wait for runners==0
```

Every state change requires a `Broadcast` because the signaller cannot know which predicate any given waiter cares about. The result is a thundering herd on every event.

The discipline: name your predicates, give each one its own `Cond`. The mutex is still shared.

```go
// GOOD
type Worker struct {
    mu          sync.Mutex
    canRun      *sync.Cond  // waiters: workers; predicate: state == Running
    queueNotEmpty *sync.Cond // waiters: workers; predicate: len(queue) > 0
    idle        *sync.Cond   // waiters: WaitIdle callers; predicate: runners == 0 && queue empty
}
```

Each transition signals only the relevant `Cond`(s). Now `Signal` (wakes one) becomes a valid choice instead of always `Broadcast`. Less herding, less wasted work.

The cost: more fields, more code. The gain: clarity and performance.

---

## Cond vs Channel — The Decision Framework

A practical framework, applied to a hypothetical design:

| Question | If yes, lean toward |
|---|---|
| Do you have one state with multiple distinct predicates? | `Cond` |
| Do you need cancellation by `context.Context`? | Channel |
| Do you need timeouts? | Channel |
| Do you need to compose with other operations via `select`? | Channel |
| Do you need to inspect the state directly (size, contents, etc.)? | `Cond` (explicit state) |
| Do you need the wake-up to carry a value? | Channel |
| Will the broadcast be repeated many times (not one-shot)? | `Cond` |
| Is allocation per operation a real concern in benchmarks? | `Cond` |
| Will the code be reviewed by people who prefer Go idioms? | Channel |
| Is this a port from a C/C++ design and rewriting would obscure intent? | `Cond` |
| Will the subsystem grow over time? | Channel (more flexibility) |

Score the design across these. If the channel column wins by a wide margin, use channels. If the `Cond` column wins, use `Cond` and write a comment explaining why.

### A worked example

You're building a connection pool that:

- Holds up to N connections.
- Lets callers acquire with a timeout.
- Lets callers acquire with cancellation by context.
- Tracks "in use" vs "free" connections.
- Has a `Close()` that drains and rejects new acquires.
- Has a `Stats()` that returns counts.

Run the framework:

- Multiple predicates? Not really — one predicate "any free connection".
- Cancellation? Yes.
- Timeout? Yes.
- Compose via `select`? Yes.
- Inspect state? Yes (Stats).
- Wake-up carries value? Yes (the connection itself).
- Repeated broadcast? Not really; close is one-shot.

The score is heavily channel. The design becomes:

```go
type Pool struct {
    free  chan *Conn
    inUse atomic.Int64
    total atomic.Int64
    closed atomic.Bool
}

func (p *Pool) Acquire(ctx context.Context, d time.Duration) (*Conn, error) {
    if p.closed.Load() {
        return nil, ErrClosed
    }
    timer := time.NewTimer(d)
    defer timer.Stop()
    select {
    case c := <-p.free:
        p.inUse.Add(1)
        return c, nil
    case <-timer.C:
        return nil, ErrTimeout
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

No `Cond` anywhere. The channel `p.free` *is* the wait queue. Allocations are zero on the hot path (the timer is one allocation per acquire, which is the small cost of supporting timeouts).

If you started this design with `Cond`, you would end up with two helper goroutines per acquire (one for timeout, one for context), 30 extra lines of code, and the same end result.

### The exception that proves the rule

You're building a bounded buffer where producers and consumers each have their own predicate, and the buffer also exposes `Drain()`, `Snapshot()`, and `Resize()` operations. Score:

- Multiple predicates? Yes (not full, not empty).
- Inspect state? Yes (drain, snapshot, resize).
- Wake-up carries value? Not directly — the value is in the buffer slice.
- Cancellation? Yes.
- Timeout? Yes.

Mixed score. The right answer is: use a buffered channel for the basic push/pop, but if the auxiliary operations (drain, snapshot, resize) need atomicity with push/pop, you cannot do it through a channel. The channel's contents are opaque from outside. So you fall back to slice + mutex + `Cond`s.

This is the "I see `Cond`, why?" PR. The comment in the code reads:

```go
// We use sync.Cond rather than a buffered channel because Snapshot() and
// Resize() must observe an atomically consistent view of the buffer. A
// channel would force us to drain to a slice and re-fill, which races with
// concurrent push/pop.
```

That comment is the contract with future reviewers.

---

## Cond vs Semaphore — Two Subtly Different Tools

`golang.org/x/sync/semaphore` provides `semaphore.Weighted` — a counting semaphore. It is sometimes the right tool when you would otherwise reach for `Cond`.

A semaphore counts "tokens." `Acquire(ctx, n)` blocks until `n` tokens are available; `Release(n)` returns them. The semaphore handles parking, signalling, and cancellation by `ctx`.

When to use a semaphore vs `Cond`:

| Scenario | Pick |
|---|---|
| "Hold at most N of something" | Semaphore |
| "Wait until N goroutines are idle" | `Cond` or `WaitGroup` |
| "Wait until a complex predicate" | `Cond` |
| "Need context cancellation" | Semaphore |
| "Need to inspect token count" | Semaphore |
| "Need multi-predicate state" | `Cond` |

A common refactor: a `Cond`-based "wait for one of N slots" becomes a one-line semaphore. The semaphore implementation uses a `sync.Mutex` plus a wait list under the hood, conceptually similar to `Cond`, but it exposes a cleaner API.

```go
// Cond version (verbose)
type SlotPool struct {
    mu        sync.Mutex
    available *sync.Cond
    inUse     int
    cap       int
}

func (p *SlotPool) Acquire() {
    p.mu.Lock()
    for p.inUse == p.cap {
        p.available.Wait()
    }
    p.inUse++
    p.mu.Unlock()
}

func (p *SlotPool) Release() {
    p.mu.Lock()
    p.inUse--
    p.available.Signal()
    p.mu.Unlock()
}

// Semaphore version (compact + cancellable)
var sem = semaphore.NewWeighted(N)
sem.Acquire(ctx, 1)
defer sem.Release(1)
```

The semaphore is shorter, supports `ctx`, and has identical semantics. The `Cond` version exists only if you need to do something *else* during `Acquire` that the semaphore doesn't expose.

---

## Integrating with `context.Context`

A `Cond`-based subsystem must integrate with `ctx.Done()` to be usable in a server. Three patterns:

### Pattern A: Per-wait helper goroutine

For each `Wait` call, spawn a goroutine that broadcasts on `ctx.Done()`:

```go
func (s *Service) WaitWithCtx(ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            s.mu.Lock()
            s.cond.Broadcast()
            s.mu.Unlock()
        case <-done:
        }
    }()
    defer close(done)

    s.mu.Lock()
    defer s.mu.Unlock()
    for !s.ready && ctx.Err() == nil {
        s.cond.Wait()
    }
    if ctx.Err() != nil {
        return ctx.Err()
    }
    return nil
}
```

Cost: one extra goroutine per pending wait. In a server with 10 000 concurrent waiters, that's 10 000 extra goroutines — ~20 MB plus scheduler overhead.

### Pattern B: Shared context watcher

For a long-lived context (the service's lifetime context), one goroutine watches and broadcasts on cancel:

```go
func (s *Service) watchCtx() {
    <-s.ctx.Done()
    s.mu.Lock()
    s.cancelled = true
    s.cond.Broadcast()
    s.mu.Unlock()
}
```

All waiters check `s.cancelled` in their predicate. This is the cheap version: one goroutine per service, not per wait.

### Pattern C: Channel instead

If `ctx` cancellation matters in this code path, the design is screaming for channels. Migrate.

---

## Fairness, Starvation, and Priority

`sync.Cond` makes no fairness guarantees. `Signal` wakes "a" waiter, not "the longest-waiting" waiter. Under high contention, the runtime is free to keep waking the same goroutine repeatedly — starvation is possible in pathological cases.

Compare with channels: blocked goroutines on a channel are FIFO. `runtime/chan.go` maintains a linked list of waiters and dequeues in order. This is a real fairness guarantee.

For most systems the unfairness of `Cond` is invisible. For a system where one goroutine waiting "longer than 30 seconds" is unacceptable, you must:

- Add a per-waiter ticket/timestamp.
- Make the predicate check ticket order ("am I the oldest?").
- Use `Broadcast` and let waiters self-sort.

This is heavy. If fairness matters, switch to channels.

### Priority

`Cond` makes no priority guarantees either. Two waiters with different "importance" both park; either may be woken. To implement priority you typically need:

- Separate `Cond`s per priority level.
- Signallers check from highest priority downward and signal the right `Cond`.

Or — again — a redesign using a priority queue and channels.

---

## Hot Paths and Lock Contention

A `Cond`-based design where `Cond.L` is the system's hot mutex falls apart at scale. Every `Wait` and every `Signal` involves taking and releasing `cond.L`. Under heavy contention the mutex becomes the bottleneck.

Indicators:

- `go tool pprof -mutex` shows `cond.L` as the dominant contended lock.
- Throughput plateaus far below CPU saturation.
- `runtime.NumGoroutine` is large, suggesting many goroutines contending for the same lock.

Mitigations:

- **Sharding**: split the state into N independent shards, each with its own `Mutex` and `Cond`. Operations route to the relevant shard.
- **Lock-free hot path**: if the common case can be served without taking the lock (e.g., the slow path is "wait for empty queue" but most operations find non-empty), use atomics for the fast check and only lock on contention.
- **Replace with channel**: channel ops avoid a user-space mutex altogether (channels use a different synchronization mechanism internally).

The senior-level decision: profile first, redesign second. Do not preemptively shard a `Cond` if benchmarks show it is not the bottleneck.

---

## Why the Standard Library Avoids Cond Internally

Read `src/sync/*.go` in the Go standard library. You will find:

- `sync.Mutex` — implemented with atomics and `runtime/sema`, not `Cond`.
- `sync.RWMutex` — same.
- `sync.WaitGroup` — implemented with atomics and `runtime_SemacquireWaitGroup` / `runtime_Semrelease`. No `Cond`.
- `sync.Once` — atomics and a mutex. No `Cond`.
- `sync.Pool` — lock-free fast path.
- `sync.Map` — atomic load/CAS.
- `runtime/chan.go` — its own wait queue mechanism, not `Cond`.

`sync.Cond` is *itself* a wrapper around `runtime_notifyListAdd` / `runtime_notifyListWait` (covered in the professional file). The standard library uses those runtime primitives directly when it needs them. End-user code is expected to use channels or higher-level types.

The lesson: the standard library considers `Cond` exposed for compatibility with classical condition-variable patterns and for cases where channels are awkward. It is not the preferred building block in modern Go. When you see `Cond` in a Go codebase, it is often a sign of one of:

- Code ported from C/C++.
- Code written before channels were idiomatic (early Go).
- Code where the multi-predicate justification is real.
- Code that should be migrated to channels but hasn't been yet.

---

## Code Review Lens for Cond in Production

Senior code review of `Cond` use should ask:

1. **Why this, not a channel?** The comment should answer in one sentence.
2. **What is the predicate?** Named, isolated, cheap?
3. **What signals it?** Every mutation that affects the predicate?
4. **Where is the cancellation/shutdown story?** Is there a `closed` flag and broadcast on close?
5. **Are there multiple `Cond`s sharing one mutex, one per predicate?** Or one `Cond` for multiple predicates (anti-pattern)?
6. **Is `Signal` used where appropriate, or is everything `Broadcast`?** Thundering herd?
7. **Are tests checking signal-before-wait and concurrent waiters?**
8. **Is the lock contention bounded?** Has anyone profiled?
9. **Is the `Cond` constructed once, in a constructor, never reassigned?**
10. **Does the type prevent value-copying?** `_ noCopy` field?

Failing #1 or #4 is usually a "request changes." Failing #2 or #6 is a "suggest improvement." Failing #5 might be acceptable depending on the design.

---

## Migration: Cond to Channels

Most `Cond` code in the wild can be migrated to channels with a clarity gain. A worked migration:

### Before: Cond-based pool

```go
type Pool struct {
    mu        sync.Mutex
    available *sync.Cond
    free      []*Conn
    closed    bool
}

func (p *Pool) Get() (*Conn, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    for !p.closed && len(p.free) == 0 {
        p.available.Wait()
    }
    if p.closed {
        return nil, ErrClosed
    }
    c := p.free[len(p.free)-1]
    p.free = p.free[:len(p.free)-1]
    return c, nil
}

func (p *Pool) Put(c *Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed {
        c.Close()
        return
    }
    p.free = append(p.free, c)
    p.available.Signal()
}

func (p *Pool) Close() {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.closed = true
    for _, c := range p.free {
        c.Close()
    }
    p.free = nil
    p.available.Broadcast()
}
```

### After: channel-based pool

```go
type Pool struct {
    free   chan *Conn
    closed atomic.Bool
}

func NewPool(initial []*Conn) *Pool {
    p := &Pool{free: make(chan *Conn, len(initial)*2)}
    for _, c := range initial {
        p.free <- c
    }
    return p
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    if p.closed.Load() {
        return nil, ErrClosed
    }
    select {
    case c := <-p.free:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (p *Pool) Put(c *Conn) {
    if p.closed.Load() {
        c.Close()
        return
    }
    select {
    case p.free <- c:
    default:
        c.Close()
    }
}

func (p *Pool) Close() {
    if !p.closed.CompareAndSwap(false, true) {
        return
    }
    close(p.free)
    for c := range p.free {
        c.Close()
    }
}
```

The channel version:

- Adds `ctx` support for free.
- Removes the explicit `Wait` discipline.
- Removes the `Cond`.
- Closes cleanly with `close(p.free)` instead of `Broadcast`.

The migration is not always this clean — sometimes the `Cond`-based version exposes operations the channel version cannot — but in most cases the channel version is shorter and clearer.

### When migration is *not* worth it

- The `Cond` version is small, working, and tested.
- The team understands `Cond` well.
- There is no maintenance pressure on the file.

"If it works, don't migrate" is valid. Migration is for code under active development that would benefit from the simpler model.

---

## Summary

`sync.Cond` at the senior level is a calculated choice, not a default. You reach for it when:

- The state has multiple distinct predicates over the same underlying data.
- Repeatable broadcast wake-ups are part of the lifecycle (pause/resume cycles).
- Explicit state inspection beyond channel capabilities is required.
- Profile-driven evidence shows channels are too costly on a hot path.

You avoid it when:

- Cancellation by `context.Context` is in scope.
- Timeouts are required.
- The wake-up should carry a value.
- The code will be reviewed by reviewers who prefer Go idioms.

The discipline of predicate-per-`Cond`, signal-under-lock, and broadcast-on-class-change scales to production-grade subsystems but requires careful design from day one. Most `Cond` code in the wild is a candidate for migration to channels with a clarity gain; some is genuinely better off as it is. Knowing which is which is the senior skill.

The professional file goes underneath: `runtime/sema.go`, `runtime_notifyListAdd`, `runtime_notifyListWait`, the futex layer, and the memory model interaction. Understanding the implementation makes the discipline rules feel inevitable rather than arbitrary.
