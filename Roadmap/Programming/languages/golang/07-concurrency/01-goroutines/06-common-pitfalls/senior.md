# Goroutine Common Pitfalls — Senior Level

> Focus: pitfalls as *architectural* problems. Ownership, lifetime contracts, supervisor anti-patterns, leak budgets, and what to do when a single mistake compounds across a service mesh.

## Table of Contents
1. [The architectural lens](#the-architectural-lens)
2. [Ownership and lifetime contracts](#ownership-and-lifetime-contracts)
3. [Supervisor anti-patterns](#supervisor-anti-patterns)
4. [The "leak budget" framing](#the-leak-budget-framing)
5. [Shutdown contracts](#shutdown-contracts)
6. [Pitfalls in long-running services](#pitfalls-in-long-running-services)
7. [Pitfalls in distributed systems made of goroutines](#pitfalls-in-distributed-systems-made-of-goroutines)
8. [Backpressure and the "infinite queue" pitfall](#backpressure-and-the-infinite-queue-pitfall)
9. [Pitfalls in graceful degradation](#pitfalls-in-graceful-degradation)
10. [Designing APIs that prevent pitfalls](#designing-apis-that-prevent-pitfalls)
11. [Reviewing concurrent code as a senior](#reviewing-concurrent-code-as-a-senior)
12. [Summary](#summary)

---

## The architectural lens

At the senior level, you stop debugging *the* leak and start preventing the *class* of leaks. The questions change from "where is the bug?" to:

- "What is the lifetime contract for goroutines in this subsystem?"
- "Who owns shutdown? Who waits? Who guarantees completion?"
- "What invariants must hold across all goroutines? How are they enforced?"
- "What is our leak budget — and how do we know we have not exceeded it?"
- "How does a single goroutine pitfall cascade across the service?"

The pitfalls do not change — captured loop variables, leaked sends, missing cancels — but their *consequences* scale. A captured loop variable in a unit test prints `5 5 5`. The same bug in a payment authorisation handler may charge the wrong customer. The shape is identical; the blast radius is not.

---

## Ownership and lifetime contracts

Every goroutine has, implicitly, three contracts:

1. **Spawn contract.** Who decides this goroutine should exist? Under what condition?
2. **Lifetime contract.** When does this goroutine exit? Who signals exit?
3. **Cleanup contract.** Who waits for the exit? What invariants must hold before the goroutine returns?

Bugs at this level happen when contracts are *implicit* and *contradictory*.

### Implicit contract example

```go
type Cache struct {
    data sync.Map
}

func NewCache() *Cache {
    c := &Cache{}
    go c.evictLoop()        // who waits for this?
    return c
}
```

Spawn: `NewCache` decides. Lifetime: undocumented. Cleanup: nobody. The goroutine outlives the cache and pins the cache's memory. If the cache is "garbage collected," the goroutine keeps it alive — the receiver method has a reference.

**The contract must be explicit.** Either:

```go
type Cache struct {
    data sync.Map
    stop chan struct{}
    wg   sync.WaitGroup
}

func NewCache() *Cache {
    c := &Cache{stop: make(chan struct{})}
    c.wg.Add(1)
    go c.evictLoop()
    return c
}

func (c *Cache) Close() {
    close(c.stop)
    c.wg.Wait()
}

func (c *Cache) evictLoop() {
    defer c.wg.Done()
    for {
        select {
        case <-c.stop: return
        case <-time.After(time.Minute):
            c.evict()
        }
    }
}
```

Now spawn, lifetime, and cleanup are all explicit. The caller knows the contract: "construct with `NewCache`, dispose with `Close`."

### "Background goroutine without an owner" anti-pattern

```go
func init() {
    go pollEnv()            // who owns this?
}
```

A common shape in legacy code: a package-level `init` spawns a goroutine that lives for the entire process. No way to stop it, no way to wait for it, no way to test code that depends on its absence.

The replacement is a *typed* lifecycle:

```go
type EnvPoller struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func StartEnvPoller(ctx context.Context) *EnvPoller {
    ctx, cancel := context.WithCancel(ctx)
    p := &EnvPoller{cancel: cancel}
    p.wg.Add(1)
    go p.run(ctx)
    return p
}

func (p *EnvPoller) Stop() {
    p.cancel()
    p.wg.Wait()
}
```

The cost is six extra lines. The benefit is testability, deterministic shutdown, and a goroutine the linter can reason about.

### Ownership transfer

Sometimes a goroutine produced by component A is *handed off* to component B. Send a channel, pass a closure. The contract must travel with the goroutine:

- "B now owns this goroutine. A will not signal it. A will not wait for it."
- "B's lifecycle dictates this goroutine's lifecycle."

Code reviews at this level should flag any cross-component goroutine that does not have an explicit handoff comment.

---

## Supervisor anti-patterns

In distributed systems and Erlang-style designs, *supervisors* are the standard way to organise long-running concurrent work. Go does not have built-in supervisors, but engineers re-invent them. Some patterns are good; many are anti-patterns.

### Anti-pattern: restart-on-panic without backoff

```go
func supervise(name string, fn func()) {
    for {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("%s panicked: %v", name, r)
                }
            }()
            fn()
        }()
    }
}
```

A goroutine that panics due to a deterministic bug — a nil dereference on the first input — restarts immediately, panics again, restarts again. CPU burns at 100% with no progress.

**Fix.** Add exponential backoff, a max-restart count, and a circuit breaker. If the same goroutine panics 10 times in 10 seconds, escalate to the parent: "this subsystem is broken; do not restart."

### Anti-pattern: supervisor that does not honour shutdown

```go
func supervise(fn func()) {
    for {
        fn()
    }
}
```

No exit condition. The supervisor loops forever. Shutdown leaves it running.

**Fix.** Take a `context.Context`. Exit when cancelled.

```go
func supervise(ctx context.Context, fn func(context.Context)) {
    for ctx.Err() == nil {
        func() {
            defer recoverAndLog()
            fn(ctx)
        }()
    }
}
```

### Anti-pattern: shared mutable state across "isolated" supervised goroutines

Two supervised goroutines that share a `map` or a slice. The supervisor restarts one on panic — but the shared state is in an inconsistent intermediate state from the panic. The other goroutine, still running, observes corrupted data.

**Fix.** Supervised goroutines should own their state. If they must share, share via channels, not via mutexes on shared structs.

### Anti-pattern: one goroutine supervises N "workers" but does not bound them

```go
for j := range jobs {
    go supervise(func() { process(j) })
}
```

Unbounded. The "supervision" does not bound — it only restarts on failure. Under high job rates, you spawn a goroutine per job, then supervise each forever. Memory and CPU explode.

**Fix.** Supervised pool of N workers, each consuming from `jobs`.

---

## The "leak budget" framing

You cannot prove a long-running service has *zero* leaks. You can decide a *budget*: a bounded amount of leakage that is acceptable per unit of work, and then measure against it.

Example budget for a request handler:

- Per-request goroutines must all exit within `request_timeout + 5s`.
- Per-request memory must be released within `5 * GC interval`.
- `runtime.NumGoroutine()` should track within ±10 of `in_flight_requests + base_goroutines`.

The budget makes leak detection *automatic*. A monitoring rule:

```
alert: GoroutineCountAbnormal
expr: go_goroutines > in_flight_requests + 50
for: 5m
```

If you exceed the budget, you have a leak — even if you cannot point at the line of code yet.

### Setting a budget for a worker pool

- Pool size: 100 workers.
- Queue depth: 1000.
- Expected goroutine count at idle: ~110 (workers + a few internals).
- Expected goroutine count under load: ~110 (workers do not multiply).
- If goroutine count grows past 200, alarm.

### Setting a budget for a streaming service

- One goroutine per active client connection.
- One supervisor goroutine.
- One metrics goroutine.
- Expected: `clients + small constant`.
- If goroutine count grows faster than client count, alarm.

The budget framing makes goroutine pitfalls *observable* even when you cannot statically prove their absence.

---

## Shutdown contracts

The most common production pitfall at scale is "shutdown does not actually shut down." A request handler is still running when the container is killed. A worker pool drops the in-flight jobs. A background flusher loses the last batch.

### The shutdown checklist

A well-designed Go service has a *shutdown contract* documented per subsystem:

1. **Signal.** Cancel a context, close a channel, or call `Stop()`.
2. **Drain.** The subsystem stops accepting new work but continues to process in-flight work.
3. **Wait.** Caller blocks until the subsystem reports done (via `wg.Wait`, `<-done`, etc.).
4. **Timeout.** Caller imposes a maximum wait. After timeout, force-close.
5. **Invariants.** After shutdown, certain invariants hold: no in-flight work, no open connections, no held resources.

A shutdown that skips any step is a pitfall.

### Pitfall: graceful HTTP shutdown without context propagation

```go
func main() {
    srv := &http.Server{Handler: handler}
    go srv.ListenAndServe()
    <-sigChan
    srv.Shutdown(context.Background())  // BUG: no timeout
}
```

`srv.Shutdown` waits for in-flight handlers to return. If a handler is stuck, `Shutdown` waits forever. The orchestrator (Kubernetes) eventually sends `SIGKILL` and your in-flight work dies.

**Fix.**

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

And handlers must respect `r.Context()` to actually finish within the timeout.

### Pitfall: shutdown order

```go
func (s *Service) Shutdown() {
    s.server.Shutdown(ctx)
    s.db.Close()
}
```

Shutdown of the server returns when handlers are done — but those handlers used the database. Closing the database while handlers are mid-call panics.

**Correct order.** Stop the *intake* first. Drain in-flight. Stop the *backends*. Same logic applies to internal subsystems: stop producers before consumers.

### Pitfall: shutdown that does not survive a panic

```go
func main() {
    s := NewService()
    defer s.Shutdown()
    s.Run()
}
```

If `s.Run` panics, `defer s.Shutdown()` runs. Good. But if `s.Shutdown` itself panics, your service did not actually shut down cleanly. Add `defer recover` inside `Shutdown` for production code.

---

## Pitfalls in long-running services

### Pitfall: goroutine spawn rate exceeds collection rate

A subtle leak. Each request spawns a "temporary" goroutine that should exit within a second. But under high load, request rate (1000/s) is faster than the goroutine exit rate (e.g., 900/s due to a slow downstream). The goroutine count grows monotonically. Memory follows.

**Detection.** Plot `go_goroutines` against `requests_in_flight`. If the former grows faster than the latter, you have a spawn-rate leak.

**Fix.** Bound concurrency with a semaphore. The goroutines that exceed the cap wait (with timeout) for a slot.

### Pitfall: `sync.Pool` does not bound

`sync.Pool` is for object reuse, not concurrency control. A pool of buffers under load grows to hold one buffer per concurrent goroutine, then shrinks at GC time. If your goroutine count is unbounded, your pool size is unbounded.

### Pitfall: long-running goroutines that never read new config

A goroutine that loads its config at spawn time and never re-reads. Operators change the config; nothing happens.

**Fix.** Either (a) document that the goroutine is config-immutable, requiring restart on change, or (b) thread an "atomic" config pointer that the goroutine re-reads each iteration.

### Pitfall: timers that compound

```go
for range time.Tick(time.Second) {
    if condition {
        time.Sleep(10 * time.Second)        // BUG: sleeps inside tick
    }
}
```

If `condition` is true, the goroutine misses ticks while sleeping. When it wakes, the ticker channel has buffered values that fire in rapid succession. Behaviour appears glitchy.

**Fix.** Either use a single timer that you reset, or accept that `Ticker` drops ticks if the receiver is slow (standard behaviour). Be explicit about which.

---

## Pitfalls in distributed systems made of goroutines

A microservice is essentially a set of goroutines that talk over the network. Distributed pitfalls layer on top of single-process pitfalls.

### Pitfall: cancellation does not cross the network

The client cancels its context. The server-side goroutine is happily computing. The context propagated by gRPC or HTTP/2 may signal cancellation upstream — but the server's code must *check* `ctx.Done()` to react.

Many handler bodies look like:

```go
func (s *Server) BigQuery(ctx context.Context, req *Req) (*Resp, error) {
    rows, err := s.db.Query(longSQL)        // ignores ctx
    ...
}
```

The query runs to completion even after the client gave up. With repeated client retries, the server is buried in zombie queries.

**Fix.** Use `db.QueryContext(ctx, ...)` (or whatever your client supports) and audit every long operation for context awareness.

### Pitfall: per-request retries spawn per-request goroutines

```go
func (c *Client) WithRetry(ctx context.Context, fn func() error) error {
    for i := 0; i < 5; i++ {
        if err := fn(); err == nil {
            return nil
        }
        time.Sleep(backoff(i))
    }
    return errors.New("max retries")
}
```

Now imagine `fn` itself spawns goroutines that the caller does not see. Five retries = five fan-outs. Under load, goroutine count compounds.

**Fix.** Make the contract of `fn` explicit: does it spawn goroutines? Does it wait for them? Document and enforce.

### Pitfall: gRPC streams without cancellation

A server-side streaming RPC pushes events to the client. The client closes the stream. The server's goroutine is mid-`Send`. The `Send` blocks (or fails). If the goroutine does not propagate the failure and exit, it leaks.

**Fix.** Always check the stream's context after `Send`. Exit on error or cancellation.

---

## Backpressure and the "infinite queue" pitfall

The most expensive pitfall at scale is the *unbounded queue*. It is the goroutine pitfall family member that scales linearly with traffic.

### Pitfall: producer faster than consumer, with no signal

```go
jobs := make(chan Job, 100_000)         // "huge buffer to absorb spikes"

go producer(jobs)                       // 100k jobs/s
go consumer(jobs)                       // 50k jobs/s
```

The buffer fills in 2 seconds. The producer blocks. From the outside, throughput halves. No alert fires — the buffer absorbed the spike, just not the steady state.

**Fix.** Apply backpressure to the *source*. If the source is HTTP, return 429. If it is Kafka, slow consumption. Buffers are not infinite; do not pretend they are.

### Pitfall: dropping silently

```go
select {
case jobs <- j:
default:
    // drop
}
```

Drops without a metric is a silent data-loss bug. Add a counter and an alert.

```go
select {
case jobs <- j:
case <-time.After(50 * time.Millisecond):
    droppedCounter.Inc()
    return errBackpressure
}
```

---

## Pitfalls in graceful degradation

Real services degrade. Pitfalls hide in the degradation paths.

### Pitfall: fallback that spawns more goroutines

```go
result, err := fastPath(ctx)
if err != nil {
    go slowPathBackground(req)          // try again later
    return errors.New("temporary")
}
```

Each failure spawns a background goroutine. Under sustained failure, goroutine count tracks failure rate. Memory follows.

**Fix.** Queue retries onto a bounded pool. Drop if the pool is full.

### Pitfall: circuit breaker that does not bound goroutines

A circuit breaker fails fast and returns to the caller. But the caller spawned a goroutine to do the failed work. The breaker prevents the *call*; it does not prevent the *spawn*. Spawn rate continues to grow.

**Fix.** Check the circuit breaker *before* `go`, not inside the goroutine.

---

## Designing APIs that prevent pitfalls

The senior-level move is to *design out* pitfalls. If your API cannot be misused, it is not misused.

### Return a `Stop` function, not a "use defer cancel"

Instead of:

```go
ctx, cancel := context.WithCancel(parent)
go server.Run(ctx)
// don't forget to call cancel()
```

Provide:

```go
stop := server.Start(parent)
defer stop()        // signal + wait inside
```

The user cannot forget cancellation because the API ties spawn to stop.

### Refuse to spawn after `Stop`

```go
func (p *Pool) Submit(j Job) error {
    select {
    case <-p.closed:
        return errPoolClosed
    case p.jobs <- j:
        return nil
    }
}
```

Submitting after shutdown is an error, not a panic. Callers get a typed signal.

### Make ownership obvious in the type

```go
type Worker struct { ... }
func New(...) *Worker          // constructs and starts
func (w *Worker) Wait() error  // blocks until done
```

vs. the anti-pattern:

```go
func StartWorker(...)          // returns nothing; goroutine "out there"
```

If your type does not return a handle, callers cannot wait for it.

### Use channels at the API boundary, not internal channels in types

A type that exposes `chan int` invites the consumer to `close` it, send on it, or read past the close. A type that exposes `Next() (int, bool)` (the iterator pattern) is safe — the consumer cannot misuse it.

---

## Reviewing concurrent code as a senior

When you review a PR with concurrency:

1. **Find every `go`.** For each, ask: spawn? lifetime? cleanup?
2. **Find every `chan` declaration.** For each, ask: who owns the close?
3. **Find every `WithCancel`/`WithTimeout`.** For each, ask: where is `cancel` called?
4. **Find every `sync.Mutex`.** For each, ask: what does it protect? What is the critical section?
5. **Find every `time.Tick`/`time.After`.** Each is suspicious; ask why.
6. **Find every `recover`.** For each, ask: is it inside `defer`? At a goroutine boundary?
7. **Find every shared variable.** For each, ask: how is access synchronised? Is the protocol consistent?
8. **Look at shutdown.** Is there a `Stop`/`Close`? Does it wait? Does it timeout?
9. **Look at the tests.** Does CI run with `-race`? Is `goleak` used?

A senior review is mechanical. Apply this checklist on every PR with concurrency, and most pitfalls vanish before merge.

---

## Summary

At the senior level, pitfalls stop being typos and become *architectural debt*. A captured loop variable in a 50-line program is a one-liner; the same kind of bug in a 200 000-line service is "we charged 1% of customers the wrong amount during a 4-hour incident, root cause was a race in the credit authoriser." The fix is rarely "change this line"; it is "redesign this contract so the line cannot be wrong."

The senior toolkit:

- Explicit lifetime contracts (`Stop()`, `Wait()`).
- Supervisors with backoff, bounds, and shutdown awareness.
- Leak budgets backed by metrics and alerts.
- Shutdown contracts with signal, drain, wait, timeout.
- API design that makes misuse hard.
- Code review checklist that catches the patterns at PR time.

The next level — `professional.md` — pushes into the runtime: how the scheduler, GC, and cgo machinery interact with these pitfalls, and what to do when the runtime itself is in play.
