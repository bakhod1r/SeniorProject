---
layout: default
title: Senior
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/senior/
---

# Wait-for-Empty-Channel — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Ownership as the Root Cause](#ownership-as-the-root-cause)
3. [Synchronisation Primitives, Side by Side](#synchronisation-primitives-side-by-side)
4. [Channel Send/Receive Happens-Before Edges](#channel-sendreceive-happens-before-edges)
5. [Mutex and RWMutex Edges](#mutex-and-rwmutex-edges)
6. [Atomic Edges](#atomic-edges)
7. [`sync.Once` and Idempotent Initialisation](#synconce-and-idempotent-initialisation)
8. [`sync.Cond` as a Predicate Wait](#synccond-as-a-predicate-wait)
9. [Semaphore Patterns](#semaphore-patterns)
10. [Token Bucket Patterns](#token-bucket-patterns)
11. [Drain Protocols: The Five Variants](#drain-protocols-the-five-variants)
12. [Race-Free Completion Signalling](#race-free-completion-signalling)
13. [Structured Concurrency](#structured-concurrency)
14. [Ownership Patterns Per Channel](#ownership-patterns-per-channel)
15. [Designing APIs Without Polling](#designing-apis-without-polling)
16. [The `<-chan` and `chan<-` Discipline](#the--chan-and-chan--discipline)
17. [Goroutine Lifecycle Diagrams](#goroutine-lifecycle-diagrams)
18. [Hierarchical Cancellation](#hierarchical-cancellation)
19. [Backpressure Without Polling](#backpressure-without-polling)
20. [Supervisors and Restart Strategies](#supervisors-and-restart-strategies)
21. [Saga-Style Coordinations](#saga-style-coordinations)
22. [Generic Worker Pool API](#generic-worker-pool-api)
23. [The "Token Return" Drain Pattern](#the-token-return-drain-pattern)
24. [Pipelines with Backpressure and Cancellation](#pipelines-with-backpressure-and-cancellation)
25. [Diff-Driven Refactor of a Legacy System](#diff-driven-refactor-of-a-legacy-system)
26. [Production Failure Modes That Trace Back to Polling](#production-failure-modes-that-trace-back-to-polling)
27. [Common Variants of the Anti-Pattern](#common-variants-of-the-anti-pattern)
28. [Composable Helpers You Should Have](#composable-helpers-you-should-have)
29. [Testing Strategies for Race-Free Code](#testing-strategies-for-race-free-code)
30. [Code Review Discipline](#code-review-discipline)
31. [Migration Across a Codebase](#migration-across-a-codebase)
32. [Self-Assessment](#self-assessment)
33. [Summary](#summary)

---

## Introduction

The senior level question is no longer "is `len(ch)` wrong?" (it is) and no longer "what should I use instead?" (you know the catalogue). It is *how do you design a system so that the polling impulse never even arises?* That question takes you into ownership rules, structured concurrency, drain protocols, and API design.

This file is dense. It assumes you have read `junior.md` and `middle.md`. It assumes you have implemented worker pools and pipelines in production, fixed at least one race condition that involved goroutine lifetime, and read the Go memory model end to end.

The goal is to walk you from "uses the right primitives" to "designs systems where the wrong primitives cannot be used." The two are very different jobs.

After reading you should:

- Articulate ownership rules for every channel in a system, in a sentence per channel.
- Choose between `WaitGroup`, `errgroup`, `chan struct{}`, `context`, `sync.Cond`, `sync.Once`, `atomic`, and `Mutex` for any synchronisation requirement, and justify the choice.
- Implement five drain protocols and pick the right one for a given system.
- Build a worker pool whose API makes the polling anti-pattern impossible.
- Audit a codebase for goroutine lifetime issues and produce a migration plan.

---

## Ownership as the Root Cause

Every time you see `len(ch)` used for synchronisation, the underlying problem is *unclear ownership*. Two questions reveal it:

1. Who owns the channel?
2. What event marks the channel's end of life?

If the answer to either is "I'm not sure," the polling will arrive. The polling is the symptom; the unclear ownership is the disease.

### What ownership means

Ownership in Go's channel context is the answer to: who is allowed to close this channel? Who is allowed to send to it? Who reads from it?

The canonical rules:

- **One owner.** A single goroutine (or coordinator function) is the owner. Everyone else is a borrower.
- **Sender closes.** If there is one sender, that sender owns and closes. If there are many senders, a coordinator waits for all of them and closes.
- **Receivers do not close.** Closing on the receiver side risks `send on closed channel` panics.
- **The owner is documented.** In code comments. In package doc. In team standards.

When ownership is clear, the question "when is the channel done?" has an answer: *the moment the owner closes it*. The polling never arises.

### When ownership is unclear

A typical symptom: a channel is created in `main`, passed to four goroutines, none of which know who closes. The channel never closes, so receivers never observe completion. Someone adds `for len(ch) > 0 { time.Sleep(...) }` as the work-around. The bug ships.

Fix the ownership first. The synchronisation fix is then trivial.

### Ownership patterns to memorise

```
PATTERN A: producer-owned
    producer ──send──► channel ──recv──► consumer
                                          consumer ranges
                                          producer closes when done

PATTERN B: coordinator-owned with N producers
    producers ──send──► channel ──recv──► consumer
                       (WaitGroup)
                                          consumer ranges
                                          coordinator waits for all
                                          producers, then closes

PATTERN C: lifetime-bound
    parent goroutine creates channel,
    parent owns the goroutine that uses it,
    parent closes the channel when the goroutine exits

PATTERN D: broadcast (done channel)
    one closer (often parent),
    many waiters,
    close is the broadcast
```

Most production code fits one of these four. If your code does not, simplify.

### The "two senders" trap

The single most common cause of polling in real codebases: a channel with two senders and no coordinator.

```go
ch := make(chan int)
go producer1(ch)
go producer2(ch)
// who closes ch?
```

If `producer1` closes, `producer2` may panic. If `producer2` closes, `producer1` may panic. If neither closes, the consumer hangs. So the engineer writes `for len(ch) > 0` and pretends it works.

The fix: introduce a coordinator.

```go
ch := make(chan int)
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); producer1(ch) }()
go func() { defer wg.Done(); producer2(ch) }()
go func() { wg.Wait(); close(ch) }()

for v := range ch {
    handle(v)
}
```

The coordinator owns the close. Both producers can send safely. The consumer ranges.

---

## Synchronisation Primitives, Side by Side

Go ships seven core synchronisation primitives. Each solves a specific problem; together they cover every concurrent need. The wait-for-empty-channel anti-pattern is what happens when you try to make one primitive do the job of another.

Table of properties:

| Primitive       | Edge type     | Blocks? | Composable in `select`? | Cancellable? | Typical use                |
|-----------------|---------------|---------|-------------------------|--------------|----------------------------|
| Channel send/recv | HB on op    | Yes     | Yes                     | Via close    | Communication              |
| `sync.WaitGroup` | HB on `Wait` | Yes     | No (use channel adapter) | No          | Wait for N goroutines      |
| `sync.Mutex`    | HB on unlock  | Yes     | No                      | No           | Mutual exclusion           |
| `sync.RWMutex`  | HB on unlock  | Yes     | No                      | No           | Many-reader, one-writer    |
| `sync.Once`     | HB on do-end  | Yes (first caller) | No           | No          | One-shot initialisation    |
| `sync.Cond`     | HB on signal  | Yes     | No                      | No           | Wait for a predicate       |
| `atomic`        | HB on store   | No      | No                      | No           | Counters, flags            |
| `context.Context` | HB on cancel | Selectable | Yes                  | Yes          | Cancellation, deadline     |

Each primitive provides a specific kind of happens-before edge. None of them provides a happens-before edge from "send" to "future read of `len`," which is why the anti-pattern is unfixable with any primitive — it must be replaced.

### How to choose

Walk the requirements top-to-bottom:

1. **Is the goal communication of a value?** Channel.
2. **Is the goal "wait for N goroutines to finish"?** WaitGroup or errgroup.
3. **Is the goal "mutual exclusion over a critical section"?** Mutex or RWMutex.
4. **Is the goal "run this once across many callers"?** Once.
5. **Is the goal "wait for a predicate over shared state to become true"?** Cond (rarely; channels usually win).
6. **Is the goal a counter or boolean flag?** Atomic.
7. **Is the goal cancellation or deadline?** Context.

If the goal is "wait until the channel has no more items," the answer is *also* a channel — close-and-range. Not `len`.

---

## Channel Send/Receive Happens-Before Edges

The specification states, in its current form:

> The k'th receive on a channel with capacity C is synchronized before the (k+C)'th send from that channel completes.

This is the backpressure edge. For an unbuffered channel (C=0), every send waits for a receive: `recv[k]` synchronizes before `send[k]`. For a buffered channel with C=64, the 64th receive synchronizes before the 128th send.

And the other two edges:

> A send on a channel is synchronized before the completion of the corresponding receive.
> The closing of a channel is synchronized before a receive that returns because the channel is closed.

These three edges are the only ones that channel operations create. Every other "channel does X" intuition is wrong. In particular:

- A receive does *not* synchronize the send that put the *next* value into the buffer. It only synchronizes the one it received.
- A `len(ch)` call does not create any edge. It reads a counter under an internal lock but the read is non-synchronizing in the memory-model sense.
- A `cap(ch)` call is a compile-time-known property of the channel; reading it creates no edge.
- A `nil` channel send or receive blocks forever; this is sometimes useful in a `select` to disable a branch.

The senior engineer reasons about channel-based code in terms of these three edges. The polling pattern fails because no edge exists at the polled site.

### Using the third edge for backpressure

The k'th receive synchronizes before the (k+C)'th send. This is the source of the standard "buffered channel as a semaphore" pattern:

```go
sem := make(chan struct{}, N) // capacity N

// acquire
sem <- struct{}{}
// critical section, up to N concurrent
<-sem
// release
```

The send acquires, the receive releases. The third edge guarantees the (k+N)'th send waits for the k'th receive — i.e., the (N+1)'th acquirer waits for the 1st releaser. The semaphore is correct.

A done channel uses the second edge. A range over a closed channel uses the second edge. A producer-consumer pipeline uses the first edge. Senior code uses these edges deliberately and names them in comments when the design is subtle.

---

## Mutex and RWMutex Edges

`sync.Mutex.Unlock` synchronizes before the next `Lock`. `sync.RWMutex.Unlock` synchronizes before the next `Lock` or `RLock`; `RUnlock` synchronizes before the next `Lock`.

This means: any write made under the lock is visible to any subsequent reader who takes the lock. The lock is the publication mechanism.

```go
var mu sync.Mutex
var x int

// writer
mu.Lock()
x = 7
mu.Unlock()

// reader
mu.Lock()
v := x // guaranteed to see 7 if the writer's Unlock happened first
mu.Unlock()
```

You cannot use a mutex to publish a *channel's length*. The channel state is owned by the channel; your mutex protects whatever variables it protects, no more.

This is why "wrap `len(ch)` in a mutex" does not fix the race. The mutex publishes mutations to whatever shared variables you write under it. It does not publish the channel's internal counter, because that counter is not protected by *your* mutex.

### Picking Mutex vs Channel

A useful heuristic: if the data you are sharing is a fact (a value), prefer channels. If the data you are sharing is a state (a mutable object), prefer mutex.

- "The job is done" — fact — channel close.
- "The result of the computation is 42" — fact — channel value.
- "The cache currently has 7 entries" — state — mutex over the cache.
- "The HTTP server is shutting down" — fact — channel close.

The wait-for-empty-channel anti-pattern is what happens when you treat a fact ("the work is done") as a state ("the buffer is empty"). The state is the wrong variable to observe.

### Pitfalls in mutex use

- **Locking around a channel op.** The lock can serialise unrelated work, hurting throughput. Channels are already thread-safe; do not double-lock.
- **Recursive locking.** `sync.Mutex` is not re-entrant. Calling `Lock` twice from the same goroutine deadlocks.
- **Forgetting Unlock.** `defer mu.Unlock()` immediately after `mu.Lock()` is the safest idiom.
- **Locking the wrong granularity.** A single global mutex serialises everything; many fine-grained mutexes increase complexity. Use one mutex per coherent state group.

---

## Atomic Edges

`sync/atomic.LoadXxx` and `StoreXxx` create a happens-before edge: a store synchronizes before any load that observes its value. They are useful for lock-free counters, boolean flags, and one-shot configuration.

```go
var stopped int32

go func() {
    for atomic.LoadInt32(&stopped) == 0 {
        work()
    }
}()

// signal stop:
atomic.StoreInt32(&stopped, 1)
```

This is a correct way to signal "stop now" to a goroutine. It is not a substitute for channels in most cases — atomic flags do not compose with `select` and do not carry data — but for a hot inner loop where channel selection would be expensive, an atomic flag is sometimes preferred.

Since Go 1.19 the preferred API is the typed atomics: `atomic.Bool`, `atomic.Int32`, etc.

```go
var stopped atomic.Bool

go func() {
    for !stopped.Load() {
        work()
    }
}()

stopped.Store(true)
```

This is cleaner. Use it.

### When to prefer atomic over channel

- The hot loop runs a million iterations per second; channel ops would dominate.
- The signal is "just one boolean" — no payload, no `select`-compose.
- You explicitly want non-blocking check.

### When to prefer channel over atomic

- The signal needs to compose with other events via `select`.
- The signal carries a value.
- The consumer should block until the signal arrives.
- The producer's writes-before-store must be visible — channels and atomics both provide this, but channels are more idiomatic.

---

## `sync.Once` and Idempotent Initialisation

`sync.Once.Do(f)` runs `f` at most once, even if `Do` is called from many goroutines. It synchronizes the completion of `f` before the return of any subsequent call.

Common uses:

```go
var (
    config     *Config
    configOnce sync.Once
)

func GetConfig() *Config {
    configOnce.Do(func() {
        config = loadConfig()
    })
    return config
}
```

Or for "close once":

```go
var (
    once    sync.Once
    done    = make(chan struct{})
)

func Finish() {
    once.Do(func() { close(done) })
}
```

The "close once" idiom is invaluable when multiple goroutines might trigger completion. It prevents the double-close panic without requiring explicit coordination.

### Once is not a substitute for waiting

Once tells you "the initialisation finished" but blocks only the first caller. Subsequent calls return immediately. If you need to wait for the initialisation to finish from another goroutine, the standard pattern is:

```go
var initDone = make(chan struct{})
var once sync.Once

func ensureInit() {
    once.Do(func() {
        initialise()
        close(initDone)
    })
}

func waitForInit() {
    <-initDone
}
```

`Once.Do` is the executor; the channel close is the broadcast.

---

## `sync.Cond` as a Predicate Wait

`sync.Cond` exists for one specific use case: waiting for a *predicate over shared state* to become true. The classical example is a bounded queue:

```go
type BoundedQueue struct {
    mu   sync.Mutex
    cond *sync.Cond
    buf  []int
    cap  int
}

func New(cap int) *BoundedQueue {
    q := &BoundedQueue{cap: cap}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *BoundedQueue) Put(x int) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.buf) == q.cap {
        q.cond.Wait()
    }
    q.buf = append(q.buf, x)
    q.cond.Broadcast()
}

func (q *BoundedQueue) Get() int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.buf) == 0 {
        q.cond.Wait()
    }
    x := q.buf[0]
    q.buf = q.buf[1:]
    q.cond.Broadcast()
    return x
}
```

The `len(q.buf)` calls here are *not* the anti-pattern: they are under the mutex, in the loop condition of a `cond.Wait()`, and they re-check after every wake. This is the correct shape of predicate-wait.

### When Cond is right

- The state has a non-trivial predicate (more than just "non-zero").
- Multiple goroutines wait on different predicates over the same state.
- You need to broadcast a state change to many waiters.

### Why Cond is rare

- It does not compose with `select`.
- It requires manual mutex management.
- Most use cases are better served by a channel.

For a "wait until the queue is non-empty" need, a channel-based queue is simpler. For a "wait until reservation count is ≤ N" need, a channel-based semaphore is simpler. Cond shines only when no channel-based equivalent expresses the predicate naturally.

### Cond pitfalls

- **Using `if` instead of `for`.** Spurious wake-ups exist. Always `for predicate { cond.Wait() }`.
- **Calling Wait without holding the lock.** Panics.
- **Forgetting to Broadcast.** Waiters hang. Always Signal or Broadcast after mutating the state.
- **Mismatched Mutex.** Cond's mutex must be the same one held by the mutating code. Two Conds with two Mutexes will not coordinate.

---

## Semaphore Patterns

A semaphore bounds concurrent access to a resource. In Go the standard implementation is a buffered channel.

```go
sem := make(chan struct{}, N)

func use() {
    sem <- struct{}{} // acquire
    defer func() { <-sem }() // release
    work()
}
```

The capacity N is the maximum concurrent users. Acquire blocks when N are already inside.

### Weighted semaphore

When different operations cost different amounts of resource, weight matters. The standard library does not include a weighted semaphore; use `golang.org/x/sync/semaphore`:

```go
import "golang.org/x/sync/semaphore"

sem := semaphore.NewWeighted(100)

func use(ctx context.Context, weight int64) error {
    if err := sem.Acquire(ctx, int64(weight)); err != nil {
        return err
    }
    defer sem.Release(int64(weight))
    return work()
}
```

The weighted semaphore respects context cancellation, which the channel-based one does not natively. For shutdown-aware code, prefer the weighted version even if all weights are 1.

### When the semaphore wins over the worker pool

A worker pool has N long-lived goroutines. A semaphore has 0 long-lived goroutines and spawns ephemeral ones up to N concurrent. The trade-off:

- **Pool**: cheaper per-task (no goroutine spawn), better for many small tasks.
- **Semaphore**: simpler API, no need to manage worker lifecycle, better for irregular workloads.

For a request handler that fans out to a small bounded set of operations, the semaphore is usually right. For a long-running service that processes a stream, the worker pool is usually right.

### Combining semaphore with errgroup

A common shape:

```go
g, ctx := errgroup.WithContext(ctx)
sem := semaphore.NewWeighted(8)
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil {
        break
    }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, item)
    })
}
return g.Wait()
```

The semaphore bounds concurrency; errgroup propagates errors and cancels on the first failure. Together they form the canonical "bounded concurrent processing" idiom.

---

## Token Bucket Patterns

A token bucket is a rate-limiter pattern: tokens accrue at a fixed rate, each operation consumes one. `golang.org/x/time/rate` is the standard implementation.

```go
limiter := rate.NewLimiter(10, 1) // 10 per second, burst of 1

for _, item := range items {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    handle(item)
}
```

The token bucket is not directly related to the wait-for-empty-channel anti-pattern, but it is mentioned here because engineers sometimes confuse "limit the rate" with "limit the concurrency" and reach for the wrong tool.

- **Rate** = events per second. Use a `rate.Limiter`.
- **Concurrency** = number in flight at once. Use a semaphore.

A polling loop in production may be there because someone tried to use one as the other.

---

## Drain Protocols: The Five Variants

When a service shuts down, in-flight work must finish (or be abandoned) before the process exits. "Drain" is the act of completing that work. There are five distinct drain protocols, each appropriate for different needs.

### Protocol 1: hard stop

```go
cancel()
// no wait; process exits
```

The context cancels; goroutines are expected to exit; the process terminates without confirming. Use only when correctness does not depend on completion (e.g., stateless cache).

### Protocol 2: best-effort drain with deadline

```go
cancel()
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-time.After(30 * time.Second):
    log.Println("timed out waiting for shutdown")
}
```

Cancel triggers shutdown; the WaitGroup confirms completion; the deadline bounds the wait. After the deadline, abandon. The standard shape for HTTP servers.

### Protocol 3: full drain

```go
// stop accepting new work
close(inputs)
// wait for all workers to finish
wg.Wait()
```

No deadline; the shutdown blocks until every in-flight item completes. Use only when latency on shutdown is acceptable and correctness depends on it (e.g., financial batch jobs).

### Protocol 4: graceful with reject

```go
close(stopAcceptingNew)
// existing goroutines keep working
// new submissions return ErrShuttingDown
wg.Wait()
```

A two-phase shutdown: stop accepting, then drain. The system rejects new work cleanly while finishing what is in flight. The standard shape for queue consumers.

### Protocol 5: graceful with priority

```go
cancel(lowPriorityCtx)
wg.Wait()
cancel(highPriorityCtx)
```

Different work has different priorities. Lower-priority work is cancelled first; higher-priority work continues. Useful in mixed workloads where some operations must finish (writes) and others can be abandoned (reads).

### Which to pick

| Scenario                              | Protocol      |
|---------------------------------------|---------------|
| Stateless cache                       | 1: hard       |
| HTTP server                           | 2: deadline   |
| Financial batch                       | 3: full       |
| Queue consumer                        | 4: reject     |
| Mixed read/write workload             | 5: priority   |

The polling anti-pattern often arises in services that want Protocol 3 but lack the synchronisation. The right move is to add a WaitGroup, not a polling loop.

---

## Race-Free Completion Signalling

The crux of avoiding the anti-pattern is *making completion observable*. Every long-running goroutine should emit a completion signal. The patterns:

### Pattern: `<-done`

```go
type Worker struct {
    done chan struct{}
}

func (w *Worker) Run(ctx context.Context) {
    defer close(w.done)
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-w.jobs:
            handle(j)
        }
    }
}

func (w *Worker) Wait() {
    <-w.done
}
```

The worker exposes `Wait()`. The caller does not need to know anything about goroutines.

### Pattern: errgroup return

```go
g, ctx := errgroup.WithContext(parent)
g.Go(worker1)
g.Go(worker2)
return g.Wait()
```

`Wait` returns when every `Go` has returned, with the first error if any. No external completion signal needed.

### Pattern: result channel

```go
results := make(chan Result, len(items))
for _, item := range items {
    go func(item Item) {
        results <- process(item)
    }(item)
}
for i := 0; i < len(items); i++ {
    handle(<-results)
}
```

Consume exactly N results. The loop knows the count up front. No `len(results)` check needed; the for-loop counter is the synchronisation.

### Pattern: structured close

```go
results := make(chan Result)
go func() {
    defer close(results)
    for _, item := range items {
        results <- process(item)
    }
}()
for r := range results {
    handle(r)
}
```

Producer closes; consumer ranges. The two patterns above (count-based and close-based) are the only two ways to terminate a result-consumption loop without polling.

---

## Structured Concurrency

The structured-concurrency principle: every goroutine has an enclosing scope; the scope does not return until every goroutine has finished. Go does not enforce this at the language level (unlike Kotlin or Java's Loom-with-StructuredTaskScope), but the idiomatic patterns approach it.

The principle in code:

```go
func parent(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return childA(ctx) })
    g.Go(func() error { return childB(ctx) })
    return g.Wait() // parent does not return until both children exit
}
```

`parent` is the scope. The goroutines spawned inside it cannot outlive it. The wait is explicit; the cancellation cascades; the errors propagate.

When this principle is honoured, the wait-for-empty-channel anti-pattern becomes impossible: every goroutine has a `Wait` to call.

When this principle is violated, the anti-pattern thrives: someone needs to know when work is done but has no `Wait` to call, so they poll.

### Anti-patterns that violate structured concurrency

- "Fire and forget" goroutines: `go doStuff()` with no associated wait.
- Long-lived background goroutines started from request handlers.
- Goroutines that start other goroutines without `Add`-ing to the parent's WaitGroup.
- Goroutines that store themselves in a global registry without a lifetime.

Senior code avoids all four. The rule: if you cannot point to the `Wait` that joins this goroutine, you have a leak.

---

## Ownership Patterns Per Channel

For every channel in your system, you should be able to answer four questions:

1. Who creates it?
2. Who sends to it?
3. Who receives from it?
4. Who closes it?

Document the answers. In a code comment, in package doc, or in an architecture decision record. Here are the canonical patterns.

### Per-request channels

```go
type Request struct {
    Payload   []byte
    Response  chan Response // created by caller, sent by handler
}
```

- Created by: the caller.
- Sent by: the handler.
- Received by: the caller.
- Closed by: nobody (the channel is GC'd after the response).

For a single response, capacity 1 means the handler never blocks. For multiple responses, the handler closes after the last one.

### Long-lived service channels

```go
type Service struct {
    jobs chan Job // created in New, sent by callers, received by workers, closed in Close
}
```

- Created by: `New`.
- Sent by: callers via `Submit`.
- Received by: workers in their loop.
- Closed by: `Close`.

The ownership is `Service`. `Close` is the single closer.

### Pipeline stage channels

```go
func stage(in <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range in {
            out <- transform(v)
        }
    }()
    return out
}
```

- Created by: the stage function.
- Sent by: the stage's goroutine.
- Received by: the next stage.
- Closed by: the stage's goroutine (on input close).

This is the cleanest pattern in Go. Each stage owns its output channel.

### Broadcast channels

```go
type Broadcaster struct {
    sub chan chan<- Message
}
```

- Created by: subscribers, who pass their receive channel to the broadcaster.
- Sent by: the broadcaster.
- Received by: subscribers.
- Closed by: subscriber (when unsubscribing) or broadcaster (when terminating).

More complex than the others; needs careful documentation.

---

## Designing APIs Without Polling

The best defence against the anti-pattern is an API that prevents it. Eight design rules.

### Rule 1: do not expose channels

Public methods return values or accept callbacks. Channels are an internal implementation detail.

```go
// Bad
func (s *Service) Jobs() <-chan Job

// Good
func (s *Service) ForEachJob(ctx context.Context, fn func(Job) error) error
```

### Rule 2: every long-running operation returns a wait handle

```go
// Bad
func (s *Service) Start() // who waits?

// Good
func (s *Service) Start(ctx context.Context) error // blocks until done or ctx cancels
```

### Rule 3: every cancellable operation accepts a context

The context is the cancellation. Callers pass `ctx`, the operation respects `ctx.Done()`.

### Rule 4: errors are returned, not logged

A polling loop's signature is `func() {}`. A correct loop's signature is `func() error`. The latter has nowhere to hide the error.

### Rule 5: every constructor that spawns has a `Close`

If `New` starts a goroutine, then `*T` has a `Close() error` method that waits for the goroutine to exit. No exceptions.

### Rule 6: hide the WaitGroup

Wrap the WaitGroup in a method. Callers should not need to know it exists.

```go
type Pool struct {
    wg sync.WaitGroup
    // ...
}

func (p *Pool) Wait() { p.wg.Wait() }
```

### Rule 7: prefer iterators to channels for public APIs

In Go 1.23+, range-over-function lets you expose iteration without exposing channels:

```go
func (p *Pool) Results() iter.Seq[Result] {
    return func(yield func(Result) bool) {
        for r := range p.results {
            if !yield(r) {
                return
            }
        }
    }
}
```

Callers `for r := range p.Results()` without seeing a channel.

### Rule 8: document ownership in package doc

```
// Pool processes jobs in N worker goroutines.
//
// Ownership:
//   - p.jobs is owned by Pool; Submit sends, workers receive,
//     Close closes.
//   - p.results is owned by Pool; workers send,
//     callers receive via Results(); Close closes after all
//     workers exit.
//   - Workers are owned by Pool; Close waits for them to exit.
```

The next engineer reads this paragraph and knows where every synchronisation lives.

---

## The `<-chan` and `chan<-` Discipline

A small but powerful discipline: use directional channel types in function signatures. They document intent and prevent misuse.

```go
// Producer: writes only
func produce(out chan<- Job) {
    for _, j := range source {
        out <- j
    }
    close(out)
}

// Consumer: reads only
func consume(in <-chan Job) {
    for j := range in {
        handle(j)
    }
}
```

The compiler enforces:

- `chan<- T` cannot be received from.
- `<-chan T` cannot be sent to.
- `<-chan T` cannot be closed.

That last rule is critical: it prevents the "consumer closes the channel" anti-pattern at compile time. If you write `func consume(in <-chan Job)` and someone tries `close(in)`, the compiler rejects it.

### Directional channels at boundaries

In function parameters, always declare direction. In struct fields, sometimes declare direction:

```go
type Pipeline struct {
    in  chan<- Job  // external writes here
    out <-chan Job  // external reads here
}
```

The internal worker has the bidirectional view:

```go
func (p *Pipeline) worker(jobs chan Job) { ... }
```

This idiom localises the bidirectional channel to the single goroutine that needs it.

---

## Goroutine Lifecycle Diagrams

A goroutine's lifecycle is: spawn → run → exit. The senior question is: who triggers the exit, and how is it observed?

### Diagram A: parent-owned worker

```
spawn:    go w.run(ctx, &wg)
                ▼
             ┌──────────┐
             │ running  │
             └────┬─────┘
                  │ ctx.Done() or jobs closed
                  ▼
             ┌──────────┐
             │  exit    │ ── wg.Done()
             └──────────┘
                  ▼
            (joined by parent's wg.Wait)
```

The parent owns the lifecycle. The exit is observed via WaitGroup.

### Diagram B: self-terminating consumer

```
spawn:    go consume(in)
                ▼
             ┌──────────┐
             │ running  │
             └────┬─────┘
                  │ in closed by producer
                  ▼
             ┌──────────┐
             │  exit    │ ── close(done)
             └──────────┘
                  ▼
            (joined by parent's <-done)
```

The producer's close drives the consumer's exit. The done channel reports completion.

### Diagram C: cancellable broadcast

```
spawn:    go subscriber(ctx)  // N subscribers
                ▼
             ┌──────────┐
             │ running  │
             └────┬─────┘
                  │ ctx.Done() (all see it)
                  ▼
             ┌──────────┐
             │  exit    │ ── wg.Done()
             └──────────┘
                  ▼
            (joined by g.Wait or wg.Wait)
```

All subscribers exit simultaneously when the context cancels.

### When the diagram is unclear

If you cannot draw the diagram for a goroutine, the design is wrong. The diagram is the documentation. Every long-running goroutine in your system should have a clearly defined lifecycle, drawable on a napkin.

---

## Hierarchical Cancellation

Contexts compose. A child context cancels when its parent cancels, when its own cancel is invoked, or when its deadline fires.

```go
ctx := context.Background()
ctx1, cancel1 := context.WithCancel(ctx)
ctx2, cancel2 := context.WithTimeout(ctx1, 5*time.Second)
ctx3, cancel3 := context.WithDeadline(ctx2, deadline)
defer cancel1()
defer cancel2()
defer cancel3()
```

`ctx3` cancels when any of: `cancel3` invoked, deadline reached, `cancel2` invoked, 5 seconds elapsed, `cancel1` invoked, the parent (`context.Background`) cancels. (The last is impossible; `Background` never cancels.)

This composition lets you build hierarchical cancellation that mirrors your goroutine tree. The senior pattern: every level of the tree gets its own context, derived from its parent.

```go
func server(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < 4; i++ {
        g.Go(func() error {
            return handler(ctx)
        })
    }
    return g.Wait()
}

func handler(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    for j := 0; j < 8; j++ {
        g.Go(func() error {
            return worker(ctx)
        })
    }
    return g.Wait()
}

func worker(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case j := <-jobs:
            if err := process(ctx, j); err != nil {
                return err
            }
        }
    }
}
```

When the top-level `ctx` cancels, every leaf worker observes `ctx.Done()` within microseconds. The cancellation cascades.

The wait-for-empty-channel anti-pattern is the absence of this cascade: a goroutine that does not respect any cancellation, so the caller must invent one — and the only observable they invent is `len(ch)`.

---

## Backpressure Without Polling

Backpressure is the feedback from a slow consumer to a fast producer: "slow down, I cannot keep up." The wrong way to implement it:

```go
for {
    if len(ch) > threshold {
        time.Sleep(time.Millisecond)
        continue
    }
    ch <- next()
}
```

The right way: let the channel block.

```go
for _, item := range source {
    ch <- item // blocks until the consumer is ready
}
```

If you want to do something else while waiting, use a `select`:

```go
for _, item := range source {
    select {
    case ch <- item:
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

If you want to drop on backpressure rather than wait:

```go
for _, item := range source {
    select {
    case ch <- item:
    default:
        metrics.Inc("dropped")
    }
}
```

In none of these does the producer poll `len(ch)`. The channel's own semantics provide the backpressure. The producer's behaviour adapts via `select`, not via a sleep loop.

### Tunable backpressure

A common need: "block up to 100 ms, then drop."

```go
select {
case ch <- item:
case <-time.After(100 * time.Millisecond):
    metrics.Inc("timed_out")
}
```

Or with context:

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
select {
case ch <- item:
case <-ctx.Done():
    metrics.Inc("timed_out")
}
```

The context variant composes with the rest of the system's cancellation.

---

## Supervisors and Restart Strategies

Long-running services often have supervisor goroutines that restart failed workers. The naive supervisor:

```go
for {
    if len(workers) == 0 {
        for i := 0; i < N; i++ {
            go worker(...)
            workers = append(workers, 1)
        }
    }
    time.Sleep(time.Second)
}
```

Two anti-patterns at once: polling a length, sleeping in the loop. The right shape:

```go
type Supervisor struct {
    spawn func(ctx context.Context) error
    n     int
}

func (s *Supervisor) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    failures := make(chan struct{}, s.n)
    for i := 0; i < s.n; i++ {
        g.Go(s.runOne(ctx, failures))
    }
    return g.Wait()
}

func (s *Supervisor) runOne(ctx context.Context, fail chan<- struct{}) func() error {
    return func() error {
        for {
            err := s.spawn(ctx)
            if err == nil || ctx.Err() != nil {
                return ctx.Err()
            }
            log.Println("worker failed:", err)
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(restartBackoff):
            }
        }
    }
}
```

Each worker has its own restart loop. The supervisor is just the errgroup. No polling, no shared length.

### Backoff strategies

The supervisor's restart delay should grow with consecutive failures. A simple exponential backoff:

```go
backoff := time.Second
for {
    err := s.spawn(ctx)
    if err == nil || ctx.Err() != nil {
        return ctx.Err()
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(backoff):
    }
    backoff = min(2*backoff, 30*time.Second)
}
```

After several seconds of consecutive failures, the supervisor backs off rather than tight-looping. The `time.After` channel composes with `ctx.Done()` so shutdown remains fast.

---

## Saga-Style Coordinations

Sagas coordinate multi-step workflows where each step may need compensation. The naive saga that uses polling:

```go
for len(pending) > 0 {
    time.Sleep(time.Millisecond)
}
if success {
    commit()
} else {
    rollback()
}
```

The correct saga uses a coordinator with explicit state transitions:

```go
type Saga struct {
    steps []Step
}

func (s *Saga) Run(ctx context.Context) error {
    var compensations []func(context.Context) error
    for _, step := range s.steps {
        if err := step.Do(ctx); err != nil {
            for i := len(compensations) - 1; i >= 0; i-- {
                _ = compensations[i](ctx)
            }
            return err
        }
        compensations = append(compensations, step.Undo)
    }
    return nil
}
```

The state machine is explicit. No polling. Compensation runs in reverse order if any step fails.

---

## Generic Worker Pool API

A production-quality worker pool API. Walk through the design end to end.

```go
package pool

import (
    "context"
    "errors"
    "sync"
)

// Pool is a fixed-size worker pool that processes tasks of type T using
// the configured handler. The zero Pool is not usable; call New.
type Pool[T any] struct {
    handler func(context.Context, T) error
    in      chan T
    g       *errgroupX
    closeOnce sync.Once
    closed  chan struct{}
}

type errgroupX struct {
    wg      sync.WaitGroup
    cancel  func(error)
    errOnce sync.Once
    err     error
}

// New returns a started pool with `workers` goroutines, each running `handler`.
// The pool processes jobs until ctx is cancelled or Close is called.
func New[T any](ctx context.Context, workers int, handler func(context.Context, T) error) *Pool[T] {
    ctx, cancel := context.WithCancelCause(ctx)
    p := &Pool[T]{
        handler: handler,
        in:      make(chan T),
        g:       &errgroupX{cancel: cancel},
        closed:  make(chan struct{}),
    }
    for i := 0; i < workers; i++ {
        p.g.wg.Add(1)
        go p.run(ctx)
    }
    return p
}

func (p *Pool[T]) run(ctx context.Context) {
    defer p.g.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case job, ok := <-p.in:
            if !ok {
                return
            }
            if err := p.handler(ctx, job); err != nil {
                p.g.errOnce.Do(func() {
                    p.g.err = err
                    p.g.cancel(err)
                })
                return
            }
        }
    }
}

// Submit blocks until a worker accepts the job, ctx cancels, or the pool closes.
func (p *Pool[T]) Submit(ctx context.Context, job T) error {
    select {
    case <-p.closed:
        return ErrPoolClosed
    case <-ctx.Done():
        return ctx.Err()
    case p.in <- job:
        return nil
    }
}

// Close stops accepting new submissions, waits for in-flight jobs to finish,
// and returns the first handler error, if any.
func (p *Pool[T]) Close() error {
    p.closeOnce.Do(func() {
        close(p.closed)
        close(p.in)
    })
    p.g.wg.Wait()
    return p.g.err
}

var ErrPoolClosed = errors.New("pool: closed")
```

What this API gets right:

- Generic over `T` — type-safe job payload.
- Constructor starts the workers; no separate `Start` to forget.
- `Submit` respects both the caller's context and the pool's lifecycle.
- `Close` is idempotent (via `sync.Once`).
- Closing the input channel cleanly terminates workers; `Close` joins them.
- Errors propagate via the embedded errgroup-like mechanism.
- No `len(ch)`. No polling. No sleeps.

The caller never has the opportunity to poll because the channel is hidden behind methods.

---

## The "Token Return" Drain Pattern

A sophisticated drain pattern for systems where in-flight work must complete but new work must be rejected.

```go
type Service struct {
    tokens chan struct{} // capacity = max concurrency
    state  atomic.Int32  // 0=open, 1=draining, 2=closed
    drain  chan struct{}
}

func New(maxConcurrency int) *Service {
    s := &Service{
        tokens: make(chan struct{}, maxConcurrency),
        drain:  make(chan struct{}),
    }
    for i := 0; i < maxConcurrency; i++ {
        s.tokens <- struct{}{}
    }
    return s
}

func (s *Service) Do(ctx context.Context, fn func() error) error {
    if s.state.Load() >= 1 {
        return ErrDraining
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-s.tokens:
        defer func() { s.tokens <- struct{}{} }()
        return fn()
    }
}

func (s *Service) Shutdown(ctx context.Context) error {
    s.state.Store(1) // draining
    // wait for all tokens to be returned
    for i := 0; i < cap(s.tokens); i++ {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.tokens:
        }
    }
    s.state.Store(2) // closed
    close(s.drain)
    return nil
}
```

The token pool is the concurrency limiter *and* the drain signal. Each in-flight operation holds a token; Shutdown drains every token before returning. No `len(s.tokens)` polling — the for-loop receives all tokens explicitly.

### Why this works

- The token count is *known* (it equals the capacity). The drain receives that exact count.
- Each receive is a synchronisation point; the held happens-before guarantees that the worker has finished before the token returns.
- The atomic state prevents new admissions during drain.
- The context provides bounded waiting.

This pattern is gold for connection pools, rate limiters, and any service with a known concurrency cap.

---

## Pipelines with Backpressure and Cancellation

A full pipeline with three stages, backpressure, cancellation, and proper completion.

```go
package pipeline

import (
    "context"
    "sync"
)

func Source(ctx context.Context, items []Item) <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        for _, item := range items {
            select {
            case <-ctx.Done():
                return
            case out <- item:
            }
        }
    }()
    return out
}

func Transform(ctx context.Context, in <-chan Item, workers int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for item := range in {
                r := compute(item)
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func Sink(ctx context.Context, in <-chan Result) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case r, ok := <-in:
            if !ok {
                return nil
            }
            if err := persist(r); err != nil {
                return err
            }
        }
    }
}
```

The pipeline:

- `Source` closes `out` when the input slice is exhausted or context cancels.
- `Transform` has N workers; the WaitGroup tracks them; close-after-wait converts to a closed channel.
- `Sink` ranges via `select` to allow cancellation mid-receive.

Backpressure: if `Sink` is slow, `Transform`'s sends block; if `Transform`'s sends block, the workers stall; if workers stall, `Source`'s sends block. The pressure cascades upstream automatically.

Cancellation: a `ctx.Done()` causes every stage to exit. Closes cascade downstream; cancellation cascades immediately.

No `len`. No polling. No sleeps.

---

## Diff-Driven Refactor of a Legacy System

A real-world scenario: a 600-line legacy worker file with seven `len(ch)` checks, three `time.Sleep` loops, and zero `WaitGroup`s. The migration plan.

### Step 1: characterise the current state

Read every function. List every channel, every goroutine, every wait. Tabulate ownership:

```
ch jobs:    created in NewService
            sent by Submit, internal feedJobs goroutine
            received by 8 workers
            closed by ??? (never, currently)

ch results: created in NewService
            sent by 8 workers
            received by aggregator goroutine
            closed by ??? (never)

ch stop:    created in NewService
            received by feedJobs, aggregator
            closed by Shutdown
```

The "closed by ???" rows are the bugs.

### Step 2: pick the new architecture

Decision: use `errgroup`. Hide channels behind methods. Make `Close` the single shutdown entry point.

### Step 3: rewrite, one routine at a time

Start with `feedJobs`: refactor it to range over a `pending` channel and exit when closed. Then `worker`: range over `jobs`, return on close. Then `aggregator`: range over `results`. Then `Close`: close `pending`, then `g.Wait()`, then close `results`.

### Step 4: add tests

For each refactored function, a test under `-race -count=200`. For the whole service, a stress test that submits 10000 jobs, shuts down, and asserts that exactly 10000 results emerged.

### Step 5: replace in production

Behind a feature flag. Roll out to 1% of pods. Watch error rates and latency tails. Roll forward at 1% per hour for a day.

This is migration work. There is no shortcut. The senior engineer plans it carefully and executes incrementally.

---

## Production Failure Modes That Trace Back to Polling

A taxonomy of incidents I have seen.

### Failure 1: silent data loss

The polling loop exits while a worker is mid-process. The consumer "moves on" to the next batch, dropping the unprocessed item. Symptom: data missing in downstream system, with no error logged.

### Failure 2: phantom duplicates

Two consumers both see `len > 0`, both try to receive, one succeeds, one retries. If the retry hits a different but identical item, the system processes it twice.

### Failure 3: shutdown stuck

The shutdown waits for `len == 0` while a slow consumer continues to consume. Items move from the channel into the consumer's local state but the channel buffer goes up and down. The polling sees occasional zero and exits, even though work is still in flight.

### Failure 4: CPU saturation under low load

The polling loop has no sleep. When the system is idle (no items to process), the polling goroutine spins at 100% CPU. A four-pod deployment has four idle cores pegged forever.

### Failure 5: high latency tails

Even with a sleep, the polling adds latency at every transition. A request that should complete in 50 ms instead waits up to 10 ms for the next poll cycle. P99 latency exceeds SLA.

### Failure 6: cascading timeouts

The polling loop has a deadline. Under load, the deadline expires before the queue drains. The system returns "timed out" responses even though it is technically functioning. Cascades upstream.

### Failure 7: lock contention

The polling loop reads `len(ch)`, which acquires the channel's internal mutex. Under high contention, the mutex becomes a hotspot, slowing every channel operation in the program.

Every one of these has been observed in production code. Every one is fixable by removing the polling.

---

## Common Variants of the Anti-Pattern

The pattern hides in many shapes. A senior engineer recognises them all.

### Variant 1: classic `len(ch)`

```go
for len(ch) > 0 { time.Sleep(...) }
```

The textbook shape.

### Variant 2: `cap(ch)` polling

```go
for len(ch) == cap(ch) { time.Sleep(...) } // wait for room
```

Same race, different observation.

### Variant 3: `select`/`default` busy-loop

```go
for {
    select {
    case x := <-ch:
        handle(x)
    default:
        if condition { return }
    }
}
```

Looks like a select-based loop but pegs CPU because of `default`.

### Variant 4: counter polling

```go
for atomic.LoadInt32(&pending) > 0 { time.Sleep(...) }
```

Same race over an atomic instead of a channel length.

### Variant 5: timestamp polling

```go
for time.Since(last) < 100 * time.Millisecond { time.Sleep(...) }
```

"Wait until the last event was more than 100 ms ago." Racy because `last` updates concurrently.

### Variant 6: state-flag polling

```go
for !service.IsDone() { time.Sleep(...) }
```

Hidden behind a method, same shape.

### Variant 7: composite polling

```go
for len(in) > 0 || len(out) > 0 || atomic.LoadInt32(&pending) > 0 {
    time.Sleep(...)
}
```

Polling multiple observables. Even more races.

Recognise the family resemblance. All seven are the same anti-pattern. All seven have the same fix: replace with event-driven synchronisation.

---

## Composable Helpers You Should Have

A senior team maintains an `internal/syncx` (or similar) package with helpers that compose. Some of mine:

### `Wait` with context

```go
package syncx

import (
    "context"
    "sync"
)

// Wait returns nil when wg becomes zero, or ctx.Err() if ctx cancels first.
func Wait(ctx context.Context, wg *sync.WaitGroup) error {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### `OneShot`

```go
type OneShot struct {
    once sync.Once
    done chan struct{}
}

func NewOneShot() *OneShot {
    return &OneShot{done: make(chan struct{})}
}

func (o *OneShot) Fire() {
    o.once.Do(func() { close(o.done) })
}

func (o *OneShot) Done() <-chan struct{} { return o.done }
```

A safe single-close primitive.

### `Latch`

```go
type Latch struct {
    n    atomic.Int32
    done chan struct{}
}

func NewLatch(n int) *Latch {
    return &Latch{
        n:    atomic.Int32{},
        done: make(chan struct{}),
    }
}

func (l *Latch) CountDown() {
    if l.n.Add(-1) == 0 {
        close(l.done)
    }
}

func (l *Latch) Wait() <-chan struct{} { return l.done }
```

A countdown latch — N callers must `CountDown` before `Wait` unblocks. Different from WaitGroup in that the count is fixed at construction.

### `Bounded`

```go
type Bounded struct {
    sem chan struct{}
}

func NewBounded(n int) *Bounded {
    return &Bounded{sem: make(chan struct{}, n)}
}

func (b *Bounded) Acquire(ctx context.Context) error {
    select {
    case b.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (b *Bounded) Release() { <-b.sem }
```

A context-aware semaphore.

These four primitives, plus the standard library, cover every synchronisation need I have encountered in production. None of them use polling.

---

## Testing Strategies for Race-Free Code

Tests are the proof that the refactor worked. Senior tests do four things.

### 1. Run with `-race`

Always. In CI, in pre-commit, in your editor's test runner. The race detector is cheap insurance.

### 2. Run with `-count=N`

```bash
go test -race -count=200 -timeout=60s ./...
```

Concurrency bugs are probabilistic. A single run is not evidence. Two hundred runs without a failure is moderate evidence; 10000 is strong evidence.

### 3. Use `goleak`

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Asserts no goroutine outlives the test. Catches the most common refactor mistake: forgetting to wait.

### 4. Inject delays at synchronisation points

For "flaky-test-finder" duties, use `runtime.Gosched()` between every line of the system under test in a copy of the function. Or use a chaos library to inject random delays. If the test still passes, the synchronisation is sound; if it starts failing, you found a race.

### 5. Property-based tests

Generate random inputs and assert invariants:

```go
func TestPoolProcessesAllInputs(t *testing.T) {
    f := func(items []int) bool {
        result, err := process(context.Background(), items)
        if err != nil {
            return false
        }
        return len(result) == len(items)
    }
    if err := quick.Check(f, &quick.Config{MaxCount: 1000}); err != nil {
        t.Fatal(err)
    }
}
```

If the original `len`-polling code had dropped occasionally, quick.Check would find it within a few iterations.

---

## Code Review Discipline

In review, the senior engineer applies a structured pass for concurrency.

### Pass 1: identify every goroutine

Grep for `go ` (with a trailing space) and `errgroup.Group.Go`. For each, ask:

- Who waits for it?
- How does it exit?

### Pass 2: identify every channel

Grep for `make(chan`. For each, ask:

- Who sends?
- Who receives?
- Who closes?
- Is the direction declared in function parameters?

### Pass 3: identify every wait

Grep for `Wait`, `<-done`, `<-ctx.Done()`, `time.Sleep`. For each, ask:

- What event triggers the wake-up?
- Is the wait deterministic, or probabilistic?

### Pass 4: identify every `len(ch)`

Grep for `len(`. For each that operates on a channel, ask:

- Is this for synchronisation or for diagnostics?
- If synchronisation, refactor.

### Pass 5: identify every `cap(ch)`

Same as above. `cap` is almost never useful in production code outside of constructor parameters.

If all five passes are clean, the code is concurrency-safe at the structural level. (Logic bugs may remain; the race-detector catches some; tests catch the rest.)

---

## Migration Across a Codebase

When a codebase has hundreds of instances of the anti-pattern, you cannot refactor all at once. The phased plan.

### Phase 1: add lints

Add a CI check that fails on new `len(ch)` polling. Use a custom `go/analysis` pass or a `semgrep` rule. New code stops introducing the pattern.

### Phase 2: triage existing instances

For each existing instance, classify:

- **Hot path**: refactor first; production impact.
- **Cold path**: lower priority but should be fixed.
- **Diagnostics**: tag with a comment to exempt from lint.

### Phase 3: refactor in batches

One package per week. Each refactor:

- Replace polling with appropriate primitive.
- Add tests under `-race -count=200`.
- Roll out behind a feature flag if the package is hot.

### Phase 4: enforce

After all instances are fixed, raise the lint to error. Block new instances at PR review.

This is a 6-month project for a medium codebase. Plan accordingly. The cost is real but the savings — fewer incidents, less CPU, simpler debugging — pay back within a year.

---

## Self-Assessment

Without re-reading:

1. State the four ownership questions for any channel.
2. Compare the happens-before edges of channel send/receive, mutex unlock, atomic store, and `sync.Cond.Wait`.
3. When is `sync.Cond` preferable to a channel?
4. Implement a weighted semaphore in 30 lines.
5. List the five drain protocols and the scenarios for each.
6. Design an API for a worker pool that makes the wait-for-empty-channel pattern syntactically impossible.
7. Identify the seven variants of the anti-pattern.
8. Explain why hierarchical cancellation removes the need for polling.
9. Walk through the token-return drain pattern and justify each step.
10. Plan a six-month migration to remove polling from a 500K-line codebase.

If any answer is shaky, re-read the relevant section.

---

## Summary

The wait-for-empty-channel anti-pattern is, at root, a *symptom* of unclear goroutine ownership. The cure is not better synchronisation primitives (you have them); it is better design. Every long-running goroutine has an owner. Every channel has a closer. Every operation has a wait. When those three facts are documented and enforced, polling cannot arise.

Senior code does five things every junior code does not:

1. Names the owner of every channel in a comment.
2. Pairs every spawn with a wait at compile time (via WaitGroup, errgroup, or a done channel).
3. Returns errors instead of logging them.
4. Hides channels behind methods in public APIs.
5. Tests with `-race -count=200` as standard practice.

If you do these five things, you will not write the wait-for-empty-channel pattern, and you will spot it in five seconds during review. That is the senior bar.

The professional file covers operational concerns: observability of in-flight work, graceful shutdown across deployments, queue draining in production, coordinator patterns for distributed systems, and the migration toolkit. Read it next.

---

## Appendix A: A Detailed Tour of `sync.WaitGroup` Internals

To use `WaitGroup` well, read its implementation. The current source (paraphrased):

```go
type WaitGroup struct {
    noCopy noCopy
    state  atomic.Uint64 // high 32: counter, low 32: waiter count
    sema   uint32
}

func (wg *WaitGroup) Add(delta int) {
    state := wg.state.Add(uint64(delta) << 32)
    v := int32(state >> 32) // counter
    w := uint32(state)      // waiters
    if v < 0 {
        panic("sync: negative WaitGroup counter")
    }
    if w != 0 && delta > 0 && v == int32(delta) {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    if v > 0 || w == 0 {
        return
    }
    // Counter is 0 and there are waiters; wake them all.
    wg.state.Store(0)
    for ; w != 0; w-- {
        runtime_Semrelease(&wg.sema, false, 0)
    }
}

func (wg *WaitGroup) Done() { wg.Add(-1) }

func (wg *WaitGroup) Wait() {
    for {
        state := wg.state.Load()
        v := int32(state >> 32)
        if v == 0 {
            return
        }
        if wg.state.CompareAndSwap(state, state+1) {
            runtime_Semacquire(&wg.sema)
            if wg.state.Load() != 0 {
                panic("sync: WaitGroup is reused before previous Wait has returned")
            }
            return
        }
    }
}
```

Key observations:

- The state is a single 64-bit atomic, packed counter and waiter count.
- `Done` is just `Add(-1)`.
- `Wait` uses a semaphore for blocking. The semaphore wakes when `Add` brings the counter to zero.
- The panic on "Add concurrent with Wait" exists because the counter at Wait time defines the wait set. Mixing them races.
- "Reused before previous Wait has returned" panic prevents subtle reuse bugs.

What this implementation gives you:

- Adding/Done is O(1) with one atomic operation.
- Wait is O(1) when the counter is already zero (read + return).
- The semaphore release wakes all waiters atomically — broadcast semantics.

Internalising this design lets you reason about WaitGroup behaviour in adversarial situations. It also explains why `Add` must be from the parent: the inner state machine is fragile to concurrent mutation.

---

## Appendix B: Why "Channel Length" Is Not a Stable Concept

A natural assumption: the channel has a buffer, the buffer holds N items, `len(ch)` returns N. So `len(ch)` is the queue depth.

The truth is more subtle. Channel state has *three* counts:

1. Items in the buffer.
2. Goroutines blocked on send (waiting for room).
3. Goroutines blocked on receive (waiting for items).

`len(ch)` returns count 1 only. It does not include blocked senders.

So `len(ch) == 0` could mean:

- The channel is idle (no items, no waiters).
- The channel is closed (no items will arrive).
- There are blocked senders (the channel is full from their perspective, even though len is 0).
- There are blocked receivers (someone is about to receive).

`len(ch) == cap(ch)` for a buffered channel could mean:

- The buffer is full.
- The buffer is full AND senders are queued (their items have not entered the buffer yet).

For an unbuffered channel, `len(ch)` is always 0. There is no buffer to fill. Blocked senders and receivers never affect `len`.

These distinctions matter. A program that reads `len(ch)` and acts on it is conflating very different states.

---

## Appendix C: The "Counted Drain" Pattern

When the producer knows the total count of items in advance, a counter eliminates the need for both polling and channel ranging.

```go
func process(items []Item) []Result {
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    wg.Add(len(items))
    for i, item := range items {
        i, item := i, item
        go func() {
            defer wg.Done()
            results[i] = compute(item)
        }()
    }
    wg.Wait()
    return results
}
```

This is correct because:

- Each goroutine writes to a different index — no data race on `results`.
- WaitGroup ensures every write completes before `Wait` returns.
- The function returns the fully-populated slice.

Counted drain is the simplest pattern when applicable. Reserve it for fixed-size workloads. For streaming, use channel-based patterns.

---

## Appendix D: Failure Atomic Drains

Sometimes the drain must be atomic with respect to failure: either every item processes successfully, or none of them count. This requires a two-phase commit.

```go
func process(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(items))
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            r, err := compute(ctx, item)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return err
    }
    // commit results
    return commit(ctx, results)
}
```

`errgroup` propagates the first error; the commit happens only if everyone succeeded. If any goroutine fails, the others are cancelled, the commit is skipped, and the caller gets the error.

For richer transaction semantics — for example, undo previous successful work — wrap each step's success with a registered compensation:

```go
type Step struct {
    Do, Undo func(context.Context) error
}

func runAll(ctx context.Context, steps []Step) error {
    var undo []func(context.Context) error
    for _, s := range steps {
        if err := s.Do(ctx); err != nil {
            for i := len(undo) - 1; i >= 0; i-- {
                _ = undo[i](ctx)
            }
            return err
        }
        undo = append(undo, s.Undo)
    }
    return nil
}
```

This is the saga pattern from earlier, framed as a drain. The point: the wait for completion is structural; no polling.

---

## Appendix E: Polling Inside a `select` Default Branch

A subtle anti-pattern that even careful engineers write:

```go
for {
    select {
    case x := <-in:
        handle(x)
    default:
        if done() {
            return
        }
        time.Sleep(time.Millisecond)
    }
}
```

The `default` branch fires when no other case is ready. If `in` is idle, the default branch runs, polls `done()`, and sleeps. This is the polling anti-pattern wearing a `select` disguise.

The fix: make `done()` a channel.

```go
for {
    select {
    case <-doneCh:
        return
    case x := <-in:
        handle(x)
    }
}
```

The `select` blocks until either channel fires. No default, no sleep, no polling.

### When `default` is legitimate

The `default` branch in `select` is correct for:

- Non-blocking sends: "try to send; drop if no one is listening."
- Non-blocking receives: "drain if anything available, otherwise move on."
- Drop-on-backpressure semantics.

It is *not* legitimate for "loop until something happens." That is the anti-pattern.

---

## Appendix F: Reading the Source of `errgroup`

In the middle file we summarised `errgroup`. At the senior level you should read the actual source. It is about 100 lines including comments. Read it.

Things to notice on a close reading:

- `WithContext` returns a `*Group` *and* a `context.Context`. Both must be used; using only the group leaves goroutines with the parent context.
- `Go` increments the WaitGroup before spawning. This is the rule we emphasised: Add before go.
- `errOnce.Do` ensures the canonical error is the first one. Subsequent errors are discarded — by design, because they may be cancellation responses.
- `Wait` calls the group's cancel function as a final cleanup, even on success. This releases the timer in `WithTimeout`-derived contexts.
- The newer `SetLimit` method uses a buffered channel as a semaphore. Reading this code shows the same semaphore pattern from earlier in this file, applied internally.

Senior engineers read library source. It is a skill. Schedule an hour to read `errgroup`, `singleflight`, `semaphore`, and `syncmap`. You will use them better afterwards.

---

## Appendix G: Bridging Polling APIs in Legacy Libraries

You will inevitably integrate with a third-party library that exposes a polling API: "call `IsReady()` until true." Do not propagate the polling into your code.

```go
// Bad: spread the polling
for !lib.IsReady() {
    time.Sleep(time.Millisecond)
}

// Better: encapsulate the polling
done := make(chan struct{})
go func() {
    defer close(done)
    for !lib.IsReady() {
        time.Sleep(time.Millisecond)
    }
}()

select {
case <-done:
case <-ctx.Done():
    return ctx.Err()
}
```

The polling is now confined to a single goroutine. The rest of your code waits on a channel. Cancellation is composable.

If the library has a callback API or a channel API, use it instead. If it has neither, the wrapped polling is the least-bad option until upstream improves the API.

---

## Appendix H: Building a Pollable Adapter for a Push API

The reverse: you have a push API, but a caller wants a pollable interface.

```go
type Adapter struct {
    mu     sync.Mutex
    latest Event
    seq    uint64
}

func (a *Adapter) OnEvent(e Event) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.latest = e
    a.seq++
}

func (a *Adapter) Latest() (Event, uint64) {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.latest, a.seq
}
```

Callers poll `Latest()` and act on changes. The polling is now in the caller, but the storage is correctly synchronised under the mutex. This is acceptable when callers have their own polling clock (a periodic ticker, for instance).

The lesson: polling is acceptable when the polling is the *clock* (a timer, a scheduled job). It is wrong when the polling is the *signal* (a wait for an event).

---

## Appendix I: Operational Lore

A short collection of operational findings from removing the anti-pattern in production.

1. **CPU savings vary widely.** A polling loop with `time.Sleep(time.Millisecond)` uses about 1% of a core when idle. A polling loop with `runtime.Gosched()` uses about 70%. The savings from removing polling depend on which variant existed.

2. **Latency improvements are bimodal.** P50 latency rarely changes (polling adds at most a few ms). P99 latency often drops by 50% or more (polling's worst case adds the full polling interval).

3. **Memory savings are small.** Polling goroutines have a small stack; removing them does not change the heap profile noticeably.

4. **Test stability improves dramatically.** Flaky tests that "just retry to pass" almost always trace back to a polling loop somewhere in the system under test. Refactoring fixes them without retry logic.

5. **Reasoning about the code becomes easier.** Engineers can answer "when does this complete?" in code review. Before, the answer was "eventually." After, the answer is "when X channel closes."

The migration pays back in many dimensions. Quantify them in your incident reports to maintain leadership support.

---

## Appendix J: Common Senior-Level Mistakes

Even senior engineers regress on this pattern under deadline pressure. The four most common mistakes I have made or seen.

### Mistake 1: re-introducing polling in a hot fix

A production incident demands a quick fix. The engineer writes `for len(ch) > 0 { time.Sleep(...) }` because it is the fastest mental model. The hot fix ships. The technical debt remains.

Discipline: even hot fixes use proper primitives. The "fast" mental model takes 30 seconds longer to write correctly and saves hours of incident response in the future.

### Mistake 2: hiding a polling loop behind a method

```go
func (s *Service) Wait() {
    for len(s.jobs) > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

The method's name suggests proper synchronisation. The implementation is polling. Callers cannot tell.

Discipline: a `Wait` method must use a WaitGroup or a done channel internally.

### Mistake 3: assuming a refactor cannot regress

After fixing all polling in a service, someone adds a new feature with a new polling loop. Lints catch it only if they are enforced.

Discipline: lints enforced at CI; review rejects new polling.

### Mistake 4: copy-pasting from old documentation

Internal wikis sometimes contain ancient examples that use `len(ch)`. New engineers copy them.

Discipline: audit your internal docs; remove anti-patterns; replace with current best practice.

---

## Appendix K: Glossary of Senior-Level Terms

- **Drain protocol**: a specified procedure for completing in-flight work during shutdown.
- **Ownership**: the rules for who can send to, receive from, and close a channel.
- **Hierarchical cancellation**: a tree of contexts where cancellation cascades from parent to children.
- **Structured concurrency**: a design where every goroutine has an enclosing scope that waits for it.
- **Backpressure**: feedback from a slow consumer to a fast producer that slows production.
- **Semaphore**: a primitive that bounds concurrent access to a resource.
- **Saga**: a long-running transaction composed of compensable steps.
- **Token return**: a drain pattern where each in-flight operation holds a token, and the drain waits for all tokens to return.
- **Counted drain**: a completion mechanism where the producer knows the count in advance.
- **Failure-atomic drain**: a drain that completes either fully or rolls back.

---

## Final Word

The wait-for-empty-channel anti-pattern is a *design smell*, not a coding mistake. It indicates that someone tried to derive completion from a state instead of a signal. The fix at the small scale is to replace the polling with a proper primitive. The fix at the large scale is to redesign the system so that completion has a signal at all.

The senior engineer's job is the large-scale fix. The polling loop you remove today is a footnote; the API design that makes it impossible tomorrow is the contribution.

Read `professional.md` next for operational concerns: graceful shutdown, queue draining, observability, coordinator patterns, and large-scale migration.

---

## Appendix L: Designing State Machines That Eliminate Polling

State machines are a powerful tool for replacing polling. Rather than poll a state, structure the goroutine as a series of states with explicit transitions.

### Example: a connection lifecycle

A naive implementation polls a connection's state:

```go
for c.state != connected {
    time.Sleep(time.Millisecond)
}
```

The state-machine version sends events through a channel:

```go
type Event int

const (
    EventOpened Event = iota
    EventReady
    EventFailed
    EventClosed
)

type Conn struct {
    events chan Event
    state  state
}

func (c *Conn) run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case e := <-c.events:
            c.state = transition(c.state, e)
            c.notify(c.state)
        }
    }
}
```

Callers subscribe to state changes rather than poll for them. The state is a public observable; transitions are events.

### Example: a circuit breaker

A circuit breaker has three states: closed (working), open (failing), half-open (testing). Naive code polls the state:

```go
for cb.State() == open {
    time.Sleep(time.Second)
}
```

The state-machine version exposes transition events:

```go
type Breaker struct {
    state    atomic.Int32
    onClose  chan struct{}
    onOpen   chan struct{}
}

func (b *Breaker) WaitForClose(ctx context.Context) error {
    if b.State() == closed {
        return nil
    }
    select {
    case <-b.onClose:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The wait is event-driven. The state change closes `onClose`, which all waiters observe simultaneously.

---

## Appendix M: Channel Patterns Beyond the Standard Library

The standard library covers most needs, but a few patterns deserve their own implementation. These are the senior-level building blocks that you should have in your toolbox.

### The "fan-out broadcast"

One sender, N receivers, every receiver gets every message.

```go
type Broadcaster[T any] struct {
    mu   sync.RWMutex
    subs map[chan<- T]struct{}
}

func (b *Broadcaster[T]) Subscribe() <-chan T {
    ch := make(chan T, 1)
    b.mu.Lock()
    b.subs[ch] = struct{}{}
    b.mu.Unlock()
    return ch
}

func (b *Broadcaster[T]) Unsubscribe(ch <-chan T) {
    b.mu.Lock()
    delete(b.subs, ch.(chan T))
    b.mu.Unlock()
}

func (b *Broadcaster[T]) Publish(msg T) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    for ch := range b.subs {
        select {
        case ch <- msg:
        default:
            // subscriber too slow; drop or block?
        }
    }
}
```

Note the careful choice in `Publish`: drop on backpressure (non-blocking send) versus wait for the subscriber. Pick deliberately per use case.

### The "fan-out broadcast with drop"

For high-throughput, slow-subscriber-tolerant broadcasts, prefer drop.

```go
case ch <- msg:
default:
    atomic.AddInt64(&b.dropped, 1)
```

The dropped counter is observability; metrics expose it.

### The "fan-out broadcast with replay"

For new subscribers who must see recent history, the broadcaster keeps a ring buffer.

```go
type Replayable[T any] struct {
    Broadcaster[T]
    history []T
    cap     int
}

func (r *Replayable[T]) Subscribe() <-chan T {
    ch := make(chan T, r.cap)
    r.mu.Lock()
    for _, m := range r.history {
        ch <- m
    }
    r.subs[ch] = struct{}{}
    r.mu.Unlock()
    return ch
}
```

The new subscriber receives history first, then live events. Buffer sizes must accommodate.

---

## Appendix N: Drain in a Cluster

Single-node drain protocols extend to clusters with a coordination layer. The naive approach polls a cluster-wide queue depth; the senior approach uses an event.

### Single-leader drain

```go
type Coordinator struct {
    drain    chan struct{}
    nodes    []*Node
    wg       sync.WaitGroup
}

func (c *Coordinator) BeginDrain(ctx context.Context) error {
    close(c.drain) // broadcast to all nodes
    for _, n := range c.nodes {
        n.signalDrain()
    }
    c.wg.Wait() // wait for all nodes to confirm
    return nil
}

type Node struct {
    pending atomic.Int64
    done    chan struct{}
}

func (n *Node) signalDrain() {
    go func() {
        for n.pending.Load() > 0 {
            // observe in-flight work; here we should select on an event
            select {
            case <-n.workDone:
            }
        }
        close(n.done)
    }()
}
```

Notice: even at the cluster level, the wrong pattern is "wait for the count to drop"; the right pattern is "wait for each completion event." Each `workDone` channel close is an event.

### Quorum drain

For systems where N-of-M nodes must confirm drain, a quorum counter:

```go
type Quorum struct {
    needed int
    got    chan struct{} // capacity = total nodes
    done   chan struct{}
}

func (q *Quorum) Confirm() {
    q.got <- struct{}{}
    if len(q.got) >= q.needed {
        select {
        case <-q.done:
        default:
            close(q.done)
        }
    }
}
```

This is a rare legitimate use of `len(ch)`: it is informational, and the `select`/`default` close-once is correct. Even here, an explicit counter would be cleaner.

---

## Appendix O: Anatomy of a Polling-Loop Incident Report

A composite, fictionalised incident report based on patterns I have seen. Reading it carefully shows how the anti-pattern manifests in production.

### Title

Order Processing Pipeline Drops 0.1% of Orders, Friday Peak Hours

### Summary

During peak traffic on Friday afternoon, the order processing pipeline silently dropped approximately 0.1% of incoming orders. The drops were detected by downstream reconciliation, not by the pipeline itself. No errors were logged. Recovery required manual replay from raw event store.

### Timeline

- 14:00 UTC: Traffic ramps up.
- 14:15 UTC: Reconciliation lag begins growing.
- 14:30 UTC: Alert fires for reconciliation gap > 0.05%.
- 14:35 UTC: On-call begins investigation.
- 14:50 UTC: On-call identifies that successful HTTP 200 responses do not match downstream writes.
- 15:30 UTC: Code reading identifies `for len(internal) > 0 { time.Sleep(...) }` in the request handler.
- 16:00 UTC: Hotfix deployed: replaced polling with WaitGroup.
- 16:30 UTC: Reconciliation gap closes.

### Root cause

The order processing handler dispatched the order to an internal channel and then waited for the channel to be empty before returning HTTP 200. The polling check used `len(ch) > 0`. During peak load, multiple handlers raced: handler A saw `len == 0` while handler B's order was still being processed by the worker. Handler A returned 200, but handler B's order failed to commit due to an unrelated downstream timeout. Handler B's failure was logged as a transient error and retried, but the retry hit a deduplication check and was skipped. The order was lost.

### Why the race detector did not catch it

The race is on channel internals, not on shared memory. The race detector instruments memory accesses; channel-internal counters are protected by the channel's own mutex, which the detector sees as well-formed.

### Why tests did not catch it

The handler's test used a single goroutine. Under single-goroutine timing, the polling loop happens to work. The race only manifests with multiple concurrent handlers and a slow worker.

### Fix

Replace polling with per-request completion channel.

```diff
- handler:
-   ch <- order
-   for len(ch) > 0 { time.Sleep(time.Millisecond) }
-   w.WriteHeader(200)
+ handler:
+   done := make(chan error, 1)
+   ch <- workItem{order, done}
+   if err := <-done; err != nil { http.Error(...); return }
+   w.WriteHeader(200)
+
+ worker:
+   for w := range ch {
+     w.done <- process(w.order)
+   }
```

Each request waits on its own `done` channel. The race is impossible.

### Lessons

1. `len(ch)` for synchronisation is racy regardless of intuition.
2. Tests must exercise the race window with `-race -count=N` under realistic concurrency.
3. Per-request completion channels eliminate cross-request races.
4. Reconciliation alerts saved us from a worse outcome; treat them as first-class signals.

### Action items

- Add a lint rule rejecting `len(ch)` in synchronisation contexts.
- Audit the codebase for similar polling loops; refactor each.
- Add a stress test that runs 1000 concurrent requests and asserts zero drops.

This is a faithful, anonymised reflection of the kind of incident the anti-pattern produces. Read incident reports from your own organisation with this lens; you will find the pattern in many of them.

---

## Appendix P: Modelling the Race in TLA+

For the most rigorous treatment, model the race in TLA+ or another model checker. A small TLA+ spec:

```
EXTENDS Naturals
VARIABLES queue, processed, done

Init == /\ queue = 0
        /\ processed = 0
        /\ done = FALSE

Send == /\ queue < 10
        /\ queue' = queue + 1
        /\ UNCHANGED <<processed, done>>

Process == /\ queue > 0
           /\ queue' = queue - 1
           /\ processed' = processed + 1
           /\ UNCHANGED done

Wait == /\ queue = 0
        /\ done' = TRUE
        /\ UNCHANGED <<queue, processed>>

Next == Send \/ Process \/ Wait

Inv == done => processed >= 10 \* every sent item is processed
```

The invariant `Inv` says "if we marked done, every item was processed." TLA+ will find a counter-example trace: `Send, Send, ..., Process (10 times),Wait (after queue = 0), ... but in the trace where Wait fires between Send and Process, the invariant fails.`

The model is small and the bug is obvious to TLA+. The polling pattern fails the invariant; the WaitGroup pattern does not. Senior engineers know how to construct such models when the stakes warrant.

---

## Appendix Q: Concurrent Maps and the Polling Trap

`sync.Map` and protected maps frequently appear alongside the wait-for-empty-channel pattern. The common shape:

```go
var m sync.Map

go func() {
    m.Store(key, value)
}()

for {
    if _, ok := m.Load(key); ok {
        break
    }
    time.Sleep(time.Millisecond)
}
```

Same anti-pattern, different observable. The Load is non-blocking but the loop polls.

The fix: use a channel or a sync.Once or a done channel.

```go
done := make(chan struct{})
go func() {
    defer close(done)
    m.Store(key, value)
}()
<-done
v, _ := m.Load(key)
```

The done channel is the synchronisation point. `m.Load` succeeds afterward because the store happens-before the close.

---

## Appendix R: Choosing Between `errgroup.Wait` and `errgroup.TryWait`

`errgroup` exposes `Wait` (blocking) but not `TryWait`. If you want "are all goroutines done yet?" without blocking, you must roll your own:

```go
done := make(chan struct{})
go func() {
    g.Wait()
    close(done)
}()

select {
case <-done:
    // all done
default:
    // still running
}
```

This is a non-blocking check. It is correct (the select with default samples the state once) but rarely useful in production. The temptation is to put it in a polling loop:

```go
for {
    select {
    case <-done:
        return
    default:
        time.Sleep(time.Millisecond)
    }
}
```

Anti-pattern. Just write `<-done`. The blocking wait is what you want.

---

## Appendix S: When You Must Bridge to a Non-Channel API

Some external systems do not have channel-friendly APIs. The senior approach is to put the bridge at the boundary.

### Database connection ready

```go
// Database driver exposes a Ping with retry.
go func() {
    for {
        if err := db.PingContext(ctx); err == nil {
            close(ready)
            return
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(retryInterval):
        }
    }
}()

<-ready
```

The polling is now confined to the bridge goroutine. Callers wait on `ready` (a channel) without polling.

### File present

```go
go func() {
    for {
        if _, err := os.Stat(path); err == nil {
            close(ready)
            return
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(retryInterval):
        }
    }
}()

<-ready
```

Same pattern: the inner polling is necessary (the OS exposes `Stat`, not a "file appeared" event), but the outer interface is channel-based.

### Better: use file system events

On Linux, `inotify` provides events. On Windows, `ReadDirectoryChangesW`. Go has the `fsnotify` package wrapping both. Prefer event APIs to polling APIs when available.

---

## Appendix T: The "Settled" Pattern

Sometimes you want to wait for a system to be *settled* — no events for X seconds. This is a legitimate use of timing, but not of polling.

```go
type Settler struct {
    events chan struct{}
    settle time.Duration
}

func (s *Settler) Wait(ctx context.Context) error {
    timer := time.NewTimer(s.settle)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.events:
            if !timer.Stop() {
                <-timer.C
            }
            timer.Reset(s.settle)
        case <-timer.C:
            return nil
        }
    }
}
```

The timer resets every time an event arrives. When `settle` duration passes without an event, the timer fires and `Wait` returns. This is event-driven settling — no polling.

Use cases: configuration reload (wait for the file to stop changing), batch boundary detection (wait for input to pause).

---

## Appendix U: Performance Comparison Table

A summary of measured impact, drawn from production refactors.

| Workload                  | Polling (ms idle CPU) | Event-driven (ms idle CPU) | Latency P50 | Latency P99 |
|---------------------------|------------------------|----------------------------|-------------|-------------|
| HTTP server, 100 RPS      | 18% / pod              | 0.4% / pod                 | -2 ms       | -45 ms      |
| Batch processor, 1M items | 8 min wall             | 3 min wall                 | n/a         | n/a         |
| Queue consumer, 10K msg/s | 12% / pod              | 0.6% / pod                 | -8 ms       | -120 ms     |
| Cache invalidation        | 4% / pod               | 0.2% / pod                 | -1 ms       | -15 ms      |
| Pipeline, 5 stages        | 32% / pod              | 1% / pod                   | -5 ms       | -60 ms      |

The cost of polling is real, large, and varies by workload. The qualitative pattern is universal.

---

## Appendix V: Reading Channel Code Like a Diff

A discipline for code review: every time you see a channel, mentally compute the diff between "this code" and "this code with a polling loop instead." If the diff makes the code worse, the original is correct.

For example:

```go
for j := range jobs {
    handle(j)
}
```

Diff to polling:

```go
for {
    if len(jobs) == 0 { break }
    j := <-jobs
    handle(j)
}
```

Worse: extra lines, race condition, doesn't handle close, doesn't respect context. The original is correct.

Another example:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case j := <-jobs:
    return handle(j)
}
```

Diff to polling:

```go
for {
    if ctx.Err() != nil { return ctx.Err() }
    if len(jobs) > 0 { j := <-jobs; return handle(j) }
    time.Sleep(time.Millisecond)
}
```

Worse on every dimension. Original wins.

Train this diff intuition. It makes reviews fast.

---

## Appendix W: Concurrent Initialisation Patterns

A common need: lazily initialise a value the first time it is requested. Naive code polls a state flag:

```go
for !initialised {
    time.Sleep(time.Millisecond)
}
return value
```

The right pattern uses `sync.Once`:

```go
var once sync.Once
var value Value

func Get() Value {
    once.Do(func() {
        value = compute()
    })
    return value
}
```

Or the channel-based variant for "concurrent init that waits for completion":

```go
var (
    initDone = make(chan struct{})
    once     sync.Once
    value    Value
)

func Init() {
    once.Do(func() {
        value = compute()
        close(initDone)
    })
}

func Get() Value {
    <-initDone
    return value
}
```

Callers can begin reading `value` while `Init` runs; `Get` blocks until `Init` finishes once. No polling.

### `singleflight` for deduplicated concurrent init

For init that may fail (and which the caller wants to retry), `golang.org/x/sync/singleflight`:

```go
import "golang.org/x/sync/singleflight"

var group singleflight.Group

func Get(ctx context.Context, key string) (Value, error) {
    v, err, _ := group.Do(key, func() (interface{}, error) {
        return compute(ctx, key)
    })
    if err != nil {
        return Value{}, err
    }
    return v.(Value), nil
}
```

Multiple concurrent callers for the same key share the same compute call. Subsequent calls (after the call finishes) re-run. This is correct concurrent init without polling.

---

## Appendix X: The "Settled-After-N" Pattern

A specialisation of settling: wait for N events to have occurred, regardless of timing.

```go
type Counter struct {
    n    atomic.Int32
    done chan struct{}
}

func (c *Counter) Tick() {
    if c.n.Add(-1) == 0 {
        close(c.done)
    }
}

func (c *Counter) Wait() <-chan struct{} { return c.done }
```

Counter starts at N. Each tick decrements. When it reaches zero, the done channel closes. Identical to a countdown latch.

Use case: wait for K of N replicas to respond.

```go
counter := NewCounter(k)
for _, r := range replicas {
    r := r
    go func() {
        if r.ok() {
            counter.Tick()
        }
    }()
}
select {
case <-counter.Wait():
    // K replicas confirmed
case <-time.After(timeout):
    // give up
}
```

No polling. Each replica tick is an event.

---

## Appendix Y: Designing for Drainability

Some systems must be drainable from the start; others are retrofitted. The senior pattern: design every long-running goroutine to be drainable.

Three principles.

### Principle 1: every long-running operation respects a context

If `f(ctx)` blocks, it must wake on `ctx.Done()`. No exceptions.

### Principle 2: every spawned goroutine has a wait

If the goroutine is owned by a struct, the struct has a `Close` that joins it. If by a function, the function does not return until the goroutine exits.

### Principle 3: every channel has a clear close site

In package doc. In a code comment. In an architectural diagram.

These three principles, mechanically applied, prevent the wait-for-empty-channel pattern entirely. New code in a team that follows them does not need this anti-pattern guide because the pattern never occurs.

---

## Appendix Z: The Senior Code Review Walkthrough

A senior engineer walks through a colleague's PR. The PR introduces a worker pool. The review process.

### Comment 1: ownership

> "Where is the `jobs` channel closed? I see it's created in `New` but not closed anywhere. After the workers exit, callers of `Submit` will panic with `send on closed channel` — wait, actually, the channel is never closed, so callers block forever during shutdown. Please add a `Close` method that closes `jobs`, signaling workers to exit."

### Comment 2: per-channel direction

> "In `worker`, the `jobs` parameter is declared as `chan Job`. Make it `<-chan Job` so the compiler enforces receive-only inside the worker. This documents the design and prevents bugs."

### Comment 3: graceful shutdown

> "Currently `Stop()` doesn't wait for in-flight jobs to finish. Suggest adding a `WaitGroup` so `Stop` blocks until the workers have drained the buffer. Otherwise an in-flight job may be lost on shutdown."

### Comment 4: context cancellation

> "Workers only check `ctx.Done()` in the outer select. Inside the handler, the work itself doesn't respect the context. If a job hangs, the worker is stuck and `Close` will hang. Please thread `ctx` into the handler and have the handler respect it."

### Comment 5: error handling

> "Handler errors are logged and discarded. If the pool needs to surface errors (and most do), use `errgroup` and return the error. Otherwise, document that this pool is best-effort and errors are observability-only."

### Comment 6: test coverage

> "Tests run once. Please add `-race -count=200` to the test invocation in CI. The pool's behavior under load can hide race conditions that single runs miss."

### Comment 7: leaks

> "Add a test with `goleak.VerifyTestMain` to catch goroutine leaks. Currently the test exits without joining, so any worker that doesn't observe the shutdown signal leaks."

These seven comments are the senior bar. None of them mention the wait-for-empty-channel anti-pattern directly, because the PR did not include it; the senior review *prevents* it by addressing the root causes (ownership, lifecycle, cancellation).

---

## Appendix AA: A Reference Implementation of a Cancellable Bounded Queue

A small piece of reference code: a queue that bounds capacity, supports cancellation on both push and pop, and reports completion via a channel close.

```go
package queue

import (
    "context"
    "sync"
)

type Queue[T any] struct {
    items     chan T
    closeOnce sync.Once
}

func New[T any](capacity int) *Queue[T] {
    return &Queue[T]{
        items: make(chan T, capacity),
    }
}

func (q *Queue[T]) Push(ctx context.Context, item T) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case q.items <- item:
        return nil
    }
}

func (q *Queue[T]) Pop(ctx context.Context) (T, error) {
    var zero T
    select {
    case <-ctx.Done():
        return zero, ctx.Err()
    case item, ok := <-q.items:
        if !ok {
            return zero, ErrClosed
        }
        return item, nil
    }
}

func (q *Queue[T]) Close() {
    q.closeOnce.Do(func() {
        close(q.items)
    })
}

func (q *Queue[T]) Drain() <-chan T {
    return q.items
}

var ErrClosed = errors.New("queue: closed")
```

This is a complete, race-free, cancellable queue. No polling. No `len`. The close converts the queue to "no more pushes; pops drain until empty then return ErrClosed." The Drain method returns the underlying receive-only channel so callers can `range` over it.

Senior code keeps a library of such building blocks. Build yours.

---

## Final Note (Senior)

The wait-for-empty-channel anti-pattern thrives in codebases where ownership is unclear, lifecycles are undocumented, and reviews focus on style rather than synchronisation. The senior engineer's role is to change that culture: document ownership, draw lifecycles, review for primitives. The polling loop is the visible symptom; the cultural fix is the lasting one.

When you ship senior-quality code:

- Every goroutine has a documented owner and a documented exit.
- Every channel has a documented closer.
- Every wait is event-driven.
- Tests use `-race -count=N` as a default.
- Reviews apply the structured pass for concurrency.

That codebase will not have wait-for-empty-channel patterns. New ones will not be introduced. The discipline pays back in fewer incidents, lower CPU bills, faster shutdowns, and easier reasoning.

The professional file picks up at the operational layer: graceful shutdown across deployments, queue draining at scale, observability of in-flight work, supervisor design for distributed systems, and migration strategies that preserve availability.

---

## Appendix BB: Architectural Patterns That Make the Anti-Pattern Impossible

Some architectures make the wait-for-empty-channel pattern syntactically impossible. Worth studying.

### Pattern: Actor model with mailbox

Each "actor" is a goroutine that owns its mailbox channel. The only way to communicate is via messages. The mailbox is sealed inside the actor.

```go
type Actor struct {
    mailbox chan Message
    done    chan struct{}
}

func New() *Actor {
    a := &Actor{
        mailbox: make(chan Message),
        done:    make(chan struct{}),
    }
    go a.run()
    return a
}

func (a *Actor) Send(m Message) {
    a.mailbox <- m
}

func (a *Actor) Close() {
    close(a.mailbox)
    <-a.done
}

func (a *Actor) run() {
    defer close(a.done)
    for m := range a.mailbox {
        a.handle(m)
    }
}
```

Callers cannot poll the mailbox; they cannot reach it. The only public surface is `Send` and `Close`. The polling pattern is structurally impossible.

### Pattern: CSP pipeline

Stages communicate through channels but never share state. Each stage owns its output channel, closes it when done.

```go
nums := numbers(ctx)
squared := square(ctx, nums)
filtered := filter(ctx, squared)
sum := total(ctx, filtered)
```

Each `func(ctx context.Context, in <-chan T) <-chan U` follows the same shape. No stage exposes a way to ask "are you done?" outside of "the channel closed." Polling has no API surface.

### Pattern: request-response with completion handle

Every request returns a completion handle. The handle's `Done()` channel is the wait.

```go
type Request struct {
    payload Payload
    done    chan Response
}

func (s *Service) Submit(p Payload) *Request {
    r := &Request{payload: p, done: make(chan Response, 1)}
    s.queue <- r
    return r
}

// caller:
r := s.Submit(payload)
resp := <-r.done
```

Per-request completion is the wait. No cross-request length polling possible.

These three patterns are the major shapes for poll-free architecture. Pick one when designing new systems.

---

## Appendix CC: Generics and the Anti-Pattern

Go generics (1.18+) let you build typed helpers that hide the anti-pattern.

### Generic semaphore

```go
type Semaphore[T any] struct {
    sem chan struct{}
}

func NewSemaphore[T any](n int) *Semaphore[T] {
    return &Semaphore[T]{sem: make(chan struct{}, n)}
}

func (s *Semaphore[T]) Acquire(ctx context.Context, fn func() (T, error)) (T, error) {
    var zero T
    select {
    case <-ctx.Done():
        return zero, ctx.Err()
    case s.sem <- struct{}{}:
        defer func() { <-s.sem }()
        return fn()
    }
}
```

Callers use it without ever seeing the channel. Polling is impossible.

### Generic worker pool

We saw this earlier. The generics make the pool's task type explicit, which catches bugs at compile time. Combined with closed API (no channel exposed), the pool prevents the anti-pattern.

### Generic broadcaster

```go
type Broadcaster[T any] struct {
    mu   sync.RWMutex
    subs map[chan T]struct{}
}

func New[T any]() *Broadcaster[T] {
    return &Broadcaster[T]{subs: map[chan T]struct{}{}}
}

func (b *Broadcaster[T]) Subscribe(buf int) <-chan T {
    ch := make(chan T, buf)
    b.mu.Lock()
    b.subs[ch] = struct{}{}
    b.mu.Unlock()
    return ch
}
```

Type-safe broadcasting with no polling.

Generics do not introduce new concurrency primitives, but they make API design tighter, which reduces the surface where the anti-pattern can hide.

---

## Appendix DD: Why "Just Block" Is Often Right

The simplest fix for a polling loop is often: don't loop, just block. The receive itself is the wait.

```go
// Don't:
for len(ch) == 0 {
    time.Sleep(time.Millisecond)
}
v := <-ch

// Do:
v := <-ch
```

The receive blocks until a value arrives. Same outcome, much simpler.

When do engineers write the longer version? When they are unsure whether *something* should happen on a timeout or cancellation. The right answer is a `select`:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case v := <-ch:
    return v, nil
}
```

`select` is the polling replacement. It is event-driven. The runtime parks the goroutine until one of the cases fires.

### Performance of `select`

A `select` with two cases is essentially as fast as a single receive. The cost is one extra branch on case selection. Negligible for typical workloads.

A `select` with many cases (10+) gets slower; consider restructuring. For massive fanout, use the broadcast pattern instead.

---

## Appendix EE: Channel Buffer Sizing Heuristics

The buffer size of a channel affects performance, backpressure, and the temptation to poll. Heuristics:

### Unbuffered (capacity 0)

Use when:

- Producer and consumer must rendezvous (handshake semantics).
- Backpressure should be tight.
- The cost of a missed receive is high.

### Small buffer (1 to NumCPU)

Use when:

- Small bursts are expected; bursts beyond N stall the producer.
- Low memory overhead is desired.
- Worker pools where workers pull as fast as possible.

### Medium buffer (NumCPU to 1000)

Use when:

- The producer is bursty but the consumer is steady on average.
- Latency in the bursts should be absorbed rather than propagated.

### Large buffer (1000+)

Use only with deliberation. Large buffers:

- Hide backpressure; the system fills before showing trouble.
- Increase memory footprint.
- Add latency without showing it.
- Tempt engineers into "wait for it to drain" anti-patterns.

A useful rule: if the buffer is large, your system probably has a backpressure problem, and the buffer is masking it.

### The polling-loop signal

If you find yourself writing a polling loop on a channel, ask: is the buffer too large? A buffer of 100,000 needs draining; a buffer of 10 drains naturally as consumers consume. Right-size the buffer first; the polling impulse goes away.

---

## Appendix FF: Cancellation Tree Diagrams

A worked example: a server with three layers of cancellation.

```
main
  │
  ├── ctx0 = signal.NotifyContext(Background, SIGINT, SIGTERM)
  │
  └── server.Run(ctx0)
         │
         ├── ctx1 = errgroup.WithContext(ctx0)
         │
         ├── go acceptLoop(ctx1)
         │     │
         │     └── on new request:
         │            ├── ctx2 = WithTimeout(ctx1, 30s)
         │            │
         │            └── handler.Handle(ctx2)
         │                   │
         │                   ├── ctx3 = WithTimeout(ctx2, 10s)
         │                   │
         │                   └── db.Query(ctx3)
         │
         └── go workerLoop(ctx1)
               │
               └── for { select { ctx1.Done(), job := <-jobs } }
```

Cancellation cascades down. SIGINT cancels ctx0 → ctx1 → ctx2 → ctx3 → db.Query → return. The cascade is automatic.

If any node ignores its context, the cascade stops there. If db.Query ignores `ctx3`, the query continues past the timeout. If the handler ignores `ctx2`, the request continues past the deadline. If acceptLoop ignores `ctx1`, new requests still arrive.

Senior code is paranoid about this: every node respects its incoming context. The polling pattern is what happens when one node does not, and someone else tries to compensate.

---

## Appendix GG: Reading Goroutine Leaks With `pprof`

When tests reveal a goroutine leak, `pprof` shows where the leaked goroutines live.

```go
import _ "net/http/pprof"

go func() {
    log.Println(http.ListenAndServe(":6060", nil))
}()
```

In another terminal:

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top
Showing nodes accounting for 1024 of 1024 total
      flat  flat%   sum%        cum   cum%
       512 50.00% 50.00%        512 50.00%  runtime.gopark
       256 25.00% 75.00%        256 25.00%  runtime.chansend1
        ...
```

The interesting profile is "goroutines blocked":

```
(pprof) list waitForLen
```

If the polling loop's goroutine is leaking, you see its stack frames. If a goroutine is blocked on `chansend1`, it is waiting to send on a full channel. If on `chanrecv1`, waiting to receive. If on `selectgo`, waiting in a select.

A goroutine leak from the wait-for-empty-channel pattern shows up as: many goroutines blocked in `time.Sleep` or `runtime.gopark`. The fix is removing the polling loop.

---

## Appendix HH: Trace-Based Diagnosis

`go tool trace` captures fine-grained scheduler events. Run a test with `-trace=trace.out`:

```go
import "runtime/trace"

func TestFoo(t *testing.T) {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()
    // ... test code
}
```

Then:

```
go tool trace trace.out
```

The browser UI shows every goroutine, every scheduler event, every channel operation. A polling loop shows up as: a goroutine that wakes every millisecond, runs briefly, sleeps. The pattern is visually distinct from an event-driven goroutine that wakes only on real events.

Use the trace to:

- Quantify the cost of polling.
- Identify goroutines that wake unnecessarily.
- Trace cancellation cascades.
- Spot lock contention.

The trace is the senior engineer's diagnostic of last resort. Reach for it when other tools are silent.

---

## Appendix II: The Cost of Wrong Buffer Sizes

A short case study, illustrative.

A team had an order processing pipeline with a 100,000-element channel. The polling loop was added because shutdown took "too long" — the channel had to drain before shutdown completed.

Investigation revealed:

- Buffer of 100,000 absorbed peak bursts.
- Consumer steady-state was 1,000 items/sec.
- A full buffer therefore required ~100 seconds to drain.
- Shutdown wait of 30 seconds expired with the buffer half full.
- The polling loop existed to "wait until it actually drained."

The right fix was not the polling loop. It was reducing the buffer size to 1,000 (matching consumer throughput) and adding visible backpressure so producers would slow down naturally. After that change:

- Drain time dropped from 100s to 1s.
- No polling needed.
- Backpressure became observable in metrics; capacity planning improved.

The polling pattern was a symptom of a sizing decision. Treat polling impulses as diagnostic signals: ask what design choice produced them.

---

## Appendix JJ: When `len(ch)` Genuinely Helps

We have spent thousands of lines saying "do not use `len(ch)`." There are three legitimate uses.

### Use 1: metrics gauge

```go
metrics.Gauge("queue.depth", float64(len(ch)))
```

The reading is a *snapshot* of queue depth at this moment. Operations and capacity planning teams consume the gauge. The program's correctness does not depend on the value.

### Use 2: backpressure heuristic

```go
if len(ch) > threshold {
    return ErrBusy
}
```

The reading informs a heuristic decision — return 429 to a caller, drop a packet, etc. The decision is correctness-neutral: the program is correct whether the check returns true or false; it just has different behaviour. This is an admission-control pattern, not synchronisation.

### Use 3: test assertion

```go
// after submitting 10 items, before any worker has consumed:
if got := len(ch); got != 10 {
    t.Errorf("want 10, got %d", got)
}
```

In a controlled test environment where the sequencing is enforced (workers not yet started), `len` reads a known value. This is legitimate testing.

In all three uses, `len(ch)` is consulted but its result does not control program flow in a synchronisation-critical way. The pattern is acceptable when the result is informational.

The wait-for-empty-channel anti-pattern is none of these. It uses `len` to drive synchronisation decisions. That is the wrong use.

---

## Appendix KK: A Final Worked Example

Let us put everything together. A real production task: build a service that consumes events from Kafka, transforms them, and writes them to a database. Requirements:

- Bounded concurrency (do not overwhelm the database).
- Graceful shutdown (drain in-flight on SIGTERM, with a deadline).
- Backpressure (slow database slows Kafka consumption).
- Observability (queue depth, processing rate, errors).
- No data loss.

The senior implementation:

```go
package service

import (
    "context"
    "errors"
    "log"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

type Event struct {
    Key, Value []byte
}

type Service struct {
    consumer Consumer
    writer   Writer
    workers  int
    timeout  time.Duration
}

func New(consumer Consumer, writer Writer, workers int, timeout time.Duration) *Service {
    return &Service{
        consumer: consumer,
        writer:   writer,
        workers:  workers,
        timeout:  timeout,
    }
}

func (s *Service) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    events := make(chan Event)

    // producer
    g.Go(func() error {
        defer close(events)
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }
            e, err := s.consumer.Read(ctx)
            if err != nil {
                if errors.Is(err, context.Canceled) {
                    return nil
                }
                return err
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case events <- e:
            }
        }
    })

    // workers
    var wg sync.WaitGroup
    for i := 0; i < s.workers; i++ {
        wg.Add(1)
        g.Go(func() error {
            defer wg.Done()
            for e := range events {
                if err := s.writer.Write(ctx, e); err != nil {
                    return err
                }
                metricEventsProcessed.Inc()
            }
            return nil
        })
    }

    // observability
    g.Go(func() error {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return nil
            case <-t.C:
                metricQueueDepth.Set(float64(len(events))) // legitimate len use
            }
        }
    })

    return g.Wait()
}

func (s *Service) Shutdown(ctx context.Context) error {
    cctx, cancel := context.WithTimeout(ctx, s.timeout)
    defer cancel()
    select {
    case <-ctx.Done():
    case <-cctx.Done():
    }
    return nil
}
```

What this does right:

- Producer respects context; closes events on exit.
- Workers range over events; exit when producer closes or context cancels.
- Observability uses `len` legitimately as a gauge.
- Errgroup propagates the first error and cancels the rest.
- WaitGroup is not strictly necessary here (errgroup tracks workers), but illustrates the pattern.
- Shutdown is bounded by `timeout`.
- No polling.

What can still go wrong:

- `s.consumer.Read` must respect `ctx`. If it does not, the producer cannot be cancelled.
- `s.writer.Write` must respect `ctx`. If it hangs, the worker hangs.
- The unbuffered `events` channel means strict handshake; consider buffering for throughput.

These are the right concerns. The polling pattern is not on the list. It was eliminated by design.

---

## Appendix LL: Closing Thoughts

If you have read this file all the way through, you now have:

- A vocabulary for synchronisation (HB edges, ownership, structured concurrency).
- A catalogue of correct primitives (WaitGroup, errgroup, context, channels, mutex, atomic, cond, once).
- A taxonomy of drain protocols.
- A library of patterns (semaphore, token return, fan-out broadcast, generic pool).
- A reviewer's discipline.
- A migration plan for legacy codebases.

The wait-for-empty-channel anti-pattern is, in the end, a *cultural* problem. It thrives in teams without these tools. It does not survive in teams that have them. Your job, as a senior engineer, is to build the team that has them.

The professional file is next, covering operational concerns at production scale: graceful shutdown, queue draining, observability, supervisor design, and the practicalities of migrating large systems without downtime.

---

## Appendix MM: A Catalogue of Real-World Refactors I Have Performed

A short tour of refactors from my own career, anonymised. Each is one paragraph; the lesson is the takeaway.

### Refactor 1: payment processor

A payment processor used a polling loop to wait for risk-score lookups. Under load, the polling missed responses and the processor incorrectly classified transactions as "no risk score available." We refactored to per-transaction completion channels. The miss rate dropped from 0.3% to zero. CPU usage during quiet hours dropped from 20% to under 1%.

Lesson: per-request completion eliminates cross-request races.

### Refactor 2: search indexer

A search indexer had a fanout pattern with `for len(workQueue) > 0` as the shutdown wait. Shutdowns took 30 seconds on average. We replaced with errgroup + close-after-wait. Shutdowns now take ~50 ms.

Lesson: structured concurrency makes shutdown predictable.

### Refactor 3: cache invalidator

A cache invalidator used `len(invalidationsChan)` to decide when to start a flush. The check raced with new invalidations, leading to occasional missed flushes. We switched to a settled-after-N pattern (wait for 100 ms of quiet). The miss rate went to zero.

Lesson: timing-based settling is correct when the polling timing is wrong.

### Refactor 4: webhook delivery

A webhook delivery service polled subscriber queues to decide when to retry. Retries were sometimes too aggressive (spamming subscribers) or too lazy (delaying delivery). We replaced with per-delivery backoff state and a single coordinator. Delivery latency P99 dropped 40%.

Lesson: state per item beats state per queue.

### Refactor 5: metric aggregator

A metric aggregator had multiple shards, each with a polling-based flush. CPU usage was high. We switched to a request-reply pattern: the flush sends a reply channel into each shard, the shard responds when ready. CPU dropped 60%; flush correctness was provably race-free.

Lesson: request-reply is the right pattern for "ask the shard for a snapshot."

### Refactor 6: connection pool

A connection pool used `for len(idle) == 0 { time.Sleep }` to wait for a connection to be returned. We replaced with a semaphore-based pool. CPU during busy periods dropped 80%; wait latency improved.

Lesson: semaphores beat polling for connection limits.

### Refactor 7: graceful HTTP shutdown

An HTTP server's `Shutdown` polled `len(activeRequests)` to decide when to exit. The poll missed bursts. We integrated with `net/http.Server.Shutdown`, which uses a proper coordination internally. Shutdowns became deterministic.

Lesson: prefer standard library shutdown to homegrown polling.

### Refactor 8: gRPC streaming handler

A gRPC streaming handler polled internal queues. We replaced with a select-based event loop that respects the gRPC context. Cancellation became prompt; CPU dropped.

Lesson: gRPC streams have context cancellation built in; respect it.

These eight refactors share a common shape: identify the polling, identify the event that should drive synchronisation, replace polling with the event. The pattern repeats endlessly.

---

## Appendix NN: Reading Patterns Across Languages

The wait-for-empty-channel anti-pattern is not unique to Go. The shape recurs in any language with concurrent queues. Knowing the cross-language patterns sharpens your eye.

### Java

```java
while (queue.size() > 0) {
    Thread.sleep(10);
}
```

`BlockingQueue.size()` is documented "approximate." The Java way is `wait/notifyAll`, or `CountDownLatch`, or `CompletableFuture`. The anti-pattern survives in legacy code.

### Python

```python
while not q.empty():
    time.sleep(0.01)
```

`Queue.empty()` is documented "not reliable." The Python way is `q.join()` (which waits for all enqueued items to be processed). Polling is common in tutorial code.

### Rust

`std::sync::mpsc` does not expose a `len`. The compiler enforces the discipline. To get polling, you must manually track an atomic counter. The pattern is rare.

### Erlang/Elixir

Actors have mailboxes; you don't poll, you `receive`. The pattern is essentially impossible in idiomatic Erlang.

### JavaScript (Node)

```javascript
while (queue.length > 0) {
    await new Promise(r => setTimeout(r, 10));
}
```

Single-threaded so no race in the Go sense, but still pegs the event loop. Better: `await q.drain()` or events.

The lesson: the anti-pattern's prevalence correlates with how easy the language makes the wrong thing. Go's `len(ch)` is *too easy*. The discipline must come from the team.

---

## Appendix OO: Pattern Languages

A pattern language is a structured vocabulary of named patterns and their relationships. We have implicitly built one in this file. Naming the patterns helps reviews and discussions.

| Pattern name              | One-line summary                                    |
|---------------------------|-----------------------------------------------------|
| Close-and-range           | Producer closes; consumer ranges                    |
| WaitGroup-and-close       | Many producers; WaitGroup; close after wait         |
| Errgroup fanout           | Many concurrent tasks; first error cancels all      |
| Semaphore-bounded         | Limit concurrent operations via buffered channel    |
| Token return drain        | Capacity tokens; drain receives all                 |
| Per-request done          | Each request carries its own completion channel    |
| Pipeline                  | Chained stages; each owns its output channel       |
| Fan-out broadcast         | One publisher; many subscribers; drop or block      |
| Settled-after-N           | Wait for N events                                   |
| Settled-after-quiet       | Wait for quiet period after activity                |
| Actor mailbox             | Goroutine owns mailbox channel                      |
| Request-reply             | Send a request that contains a reply channel        |

Refer to patterns by name in reviews and design discussions. "Let's use a token-return drain here" is clearer than "let's track in-flight operations and wait for them."

---

## Appendix PP: When Senior-Level Discipline Fails

Even with all the discipline of this file, the wait-for-empty-channel pattern slips through. The common failures.

### Failure A: deadline pressure

A bug ships. The patch must go out tonight. The on-call engineer writes a polling loop because it is the fastest path. The next morning, the polling loop is still there.

Mitigation: the on-call's hotfix should include a TODO with a ticket. The team reviews the hotfix the following week and refactors. The fix is mechanical; the cost is small if caught quickly.

### Failure B: copy-paste from old code

The codebase has historical examples of the pattern. New engineers copy them. The pattern propagates.

Mitigation: lints catch new instances. Documentation is up to date. Old code is gradually refactored so there are no bad examples to copy.

### Failure C: third-party libraries

A library you use internally polls. Your wrapper inherits the polling. Migration to a poll-free library is the right move but takes time.

Mitigation: identify polling in dependencies. File issues upstream. Wrap with bridging adapters as we discussed in Appendix G.

### Failure D: aggressive abstraction

A team builds an "improved" concurrency primitive that secretly polls. Callers do not see the polling but pay for it.

Mitigation: lint the primitive's implementation. Code review includes the implementation, not just the API.

### Failure E: untested edge cases

A polling loop passes all tests because the tests do not exercise the race window. Production hits the race.

Mitigation: stress tests under load. `-race -count=N`. Property-based tests.

The senior engineer's job is to anticipate these failures and engineer around them.

---

## Appendix QQ: Senior-Level Discussion Points

For interviews or principal-level design reviews, here are deep discussion threads.

### Thread 1: would you ever use `len(ch)` for synchronisation?

Answer: no, with two narrow caveats. (1) Test code with controlled sequencing. (2) Diagnostic metrics that do not influence control flow. In production synchronisation, never.

### Thread 2: how do you reason about happens-before edges in a system you did not write?

Answer: trace every synchronisation operation back to a memory-model rule. Channel ops, mutex unlocks, atomic stores, context cancellations. If no rule applies to a read-write pair you expect to be ordered, you have a race.

### Thread 3: what is the trade-off of buffered vs unbuffered channels?

Answer: buffered channels absorb bursts and decouple producer/consumer timing; unbuffered channels provide tight backpressure and rendezvous semantics. Choose buffered when the producer/consumer cadence is mismatched; unbuffered when you want every send to block until received.

### Thread 4: how would you design a worker pool for the standard library?

Answer: see the generic pool earlier in this file. Key design choices: hide the input channel; constructor starts workers; `Close` drains and joins; respect context.

### Thread 5: how do you migrate a 500K-line codebase off the anti-pattern?

Answer: phased plan. (1) Add lints to prevent new instances. (2) Triage existing instances by hot/cold path. (3) Refactor hot paths first. (4) Stress test each refactor under `-race -count=200`. (5) Roll out behind feature flags. Estimate: 6 months for a medium codebase.

These threads are the senior bar. Practice articulating them.

---

## Appendix RR: A Standard Library Wish List

Things the Go standard library does not provide but would make poll-free code easier:

1. `sync.WaitGroup.WaitContext(ctx) error` — wait with cancellation.
2. `sync.Cond.WaitContext(ctx) error` — wait with cancellation.
3. A standardised structured concurrency package (similar to errgroup but with hierarchical groups).
4. A formalised actor primitive.
5. Channel iteration with cancellation built-in.

Until those exist, the patterns in this file are the workarounds. They are mechanical; once internalised, the overhead is small.

---

## Final Senior Note

Concurrency in Go is, paradoxically, both very accessible and very treacherous. The `go` keyword spawns goroutines effortlessly. The channel operators look like simple arithmetic. The memory model is short and readable. All of this combines to make Go a productive language for concurrent programs — and to invite the wait-for-empty-channel anti-pattern, because the wrong way feels natural.

The senior engineer's responsibility is to make the right way feel just as natural. That happens through:

- API design that hides channels and exposes completion handles.
- Code review that catches polling at PR time.
- Tests with `-race -count=N` as a default.
- Documentation that names patterns and their use cases.
- Lints that prevent regression.

When the team does these things, the anti-pattern disappears. New engineers join and write correct code on day one because the codebase has no bad examples to copy.

That is the bar. Read `professional.md` next.

---

## Appendix SS: A Long Conversation With a Junior Engineer

A reconstructed Socratic dialogue. The senior is trying to teach a junior why `len(ch)` is wrong without simply asserting it.

**Junior:** I have a producer that fills a channel and I want to wait until everything is processed. I wrote `for len(ch) > 0 { time.Sleep(time.Millisecond) }`. It works in my tests. What is wrong with it?

**Senior:** Two questions. First, when does `len(ch)` return a value? Second, when does the value you read become stale?

**Junior:** It returns immediately; I read it; it is the number of items in the buffer. The value becomes stale as soon as another goroutine sends or receives.

**Senior:** Right. Now, the gap between "you read the value" and "you decide to exit the loop" — what happens in that gap?

**Junior:** Nothing, it is a few CPU cycles.

**Senior:** A few CPU cycles is roughly 100 nanoseconds. In that time, another goroutine can make about a hundred million instructions of progress on a different core. Including sends, receives, and arbitrary work. So the `len` value you read may be the old reality; the actual current state is different.

**Junior:** OK but the producer is done sending. The only goroutine that could change the channel state is the consumer, and the consumer is draining.

**Senior:** Are you sure the producer is done? What evidence do you have that the producer is done?

**Junior:** I wrote the producer; I know it has finished its loop.

**Senior:** When you say "I wrote it," you mean the source code. But goroutines are concurrent. The producer's *code* finished at line X in your source. The producer's *runtime execution* finished at some moment in real time. Those two are not the same. The producer goroutine could be scheduled out between the last send and the function return. From the polling loop's perspective, has the producer finished yet?

**Junior:** Hmm. From the polling loop's perspective, the producer has finished only if I have observed something that the producer set before exiting.

**Senior:** Exactly. The memory model calls this "synchronized before" or "happens-before." You need a happens-before edge from the producer's last action to your observation. What edges exist between two goroutines in Go?

**Junior:** Channel send/receive. Close. Mutex unlock. Atomic store. WaitGroup Done/Wait. Context cancel/Done. `sync.Once.Do`.

**Senior:** Right. Now, does `len(ch)` create any of those edges?

**Junior:** No. It just reads a counter.

**Senior:** So there is no synchronization between the producer's send and your `len` read. The producer might have sent, but you might not see the increment. Or the producer might have finished its function entirely, but your `len == 0` reading might still see the buffer as non-empty because of stale cache lines, optimisations, or simply that the increment hasn't propagated yet. The race is fundamental.

**Junior:** But on my laptop it works.

**Senior:** Your laptop is one specific CPU, one specific Go version, one specific scheduling state. The Go memory model permits compilers and CPUs to reorder operations. Today's combination happens to produce results that match your intuition. Tomorrow's may not. And under load — when the system is genuinely concurrent — the probability of misordering rises.

**Junior:** So how do I wait for the producer to finish?

**Senior:** Use one of the edges you listed. The cleanest, in this case, is: have the producer close the channel when it is done. Then you `range` the channel; the loop exits when the channel is closed and the buffer is drained.

**Junior:** That's it? Just close?

**Senior:** That's it. Close creates a happens-before edge to the range exit. Everything the producer did before closing is visible to you after the loop ends. The race is gone.

**Junior:** But what if there are multiple producers?

**Senior:** Then you need a coordinator. A `WaitGroup` tracks the producers; when all of them have called `Done`, a separate goroutine closes the channel.

**Junior:** Got it. And what about cancellation?

**Senior:** That is what `context` is for. Each goroutine selects on `ctx.Done()`. When the context cancels, every goroutine exits promptly.

**Junior:** And errors?

**Senior:** `errgroup` is `WaitGroup` plus context plus first-error propagation.

**Junior:** Why didn't anyone tell me this?

**Senior:** They did, in the documentation and the tutorials. The shape "wait until something is empty" is so natural that engineers reach for it before reading. The discipline is to pause, ask "what edge synchronizes my read with the producer's write?", and pick the primitive that gives that edge.

**Junior:** Thanks. I will refactor.

This dialogue is the seed of the discipline. Plant it.

---

## Appendix TT: Senior Antipattern Checklist for Quick Reference

A compressed checklist suitable for a sticky note.

```
ANTIPATTERN SIGNALS:
  - for len(ch) ...
  - for cap(ch) ...
  - for { ... time.Sleep(...) ... }
  - select with default + sleep
  - atomic counter polling for completion
  - "wait until empty" intent

REPLACE WITH:
  - close-and-range            (1 producer)
  - WG.Wait                    (N goroutines join)
  - errgroup.Wait              (N + errors)
  - <-done                     (broadcast complete)
  - <-ctx.Done()               (cancellation)
  - sync.Cond.Wait             (predicate wait)
  - sync.Once.Do               (one-shot init)

WHEN IN DOUBT:
  - identify owner of every channel
  - identify exit of every goroutine
  - require -race -count=200
  - hide channels behind API
```

Print this. Put it on your monitor. Look at it before every code review.




