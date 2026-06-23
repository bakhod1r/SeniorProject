# Goroutines — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing for Goroutine Lifetimes](#designing-for-goroutine-lifetimes)
3. [Structured Concurrency](#structured-concurrency)
4. [Supervisor Patterns](#supervisor-patterns)
5. [Designing Worker Pools That Scale](#designing-worker-pools-that-scale)
6. [Backpressure](#backpressure)
7. [Bounded Parallelism with Semaphores](#bounded-parallelism-with-semaphores)
8. [Goroutine Leak Engineering](#goroutine-leak-engineering)
9. [Panics in a Concurrent System](#panics-in-a-concurrent-system)
10. [Cancellation Trees and Deadline Propagation](#cancellation-trees-and-deadline-propagation)
11. [Sharing State Between Goroutines](#sharing-state-between-goroutines)
12. [Goroutine-per-Connection vs Event-Loop](#goroutine-per-connection-vs-event-loop)
13. [Observability of Goroutines](#observability-of-goroutines)
14. [Testing Concurrent Code](#testing-concurrent-code)
15. [Architectural Smells](#architectural-smells)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

At the senior level, the focus shifts from "how do I spawn a goroutine" to "how do I design a system that manages thousands of them safely, predictably, and observably." The Go runtime's scheduler is excellent, but it cannot save a design that leaks, that fans out unbounded, that mutates shared state without synchronisation, or that has no clear story for cancellation.

This document covers the architectural questions:

- How do I design lifetimes so leaks are impossible by construction?
- How do I express "structured concurrency" in Go, despite the language having no formal construct for it?
- How do I size a pool, apply backpressure, and degrade gracefully under load?
- How do I observe goroutine behaviour in production?

The patterns here scale from medium services to high-traffic systems handling millions of concurrent operations.

---

## Designing for Goroutine Lifetimes

A reliable concurrent design starts by answering, for each goroutine, four questions:

1. **Who starts it?** (constructor, request handler, main, library entry point)
2. **Who owns its lifetime?** (the same caller? a long-lived service? `main`?)
3. **What signals it to stop?** (closed input channel, cancelled context, explicit `Stop` call)
4. **How does the owner know it has stopped?** (closed `done` channel, returned error, `wg.Done`)

If you cannot answer all four, do not write `go`. Refactor first.

### The "lifetime owner" rule

Every goroutine has exactly one owner. The owner is responsible for stopping the goroutine and observing its exit. Sharing ownership across multiple components leads to "who closes the channel" arguments and double-close panics.

Examples of owners:

- An HTTP handler: spawns request-scoped goroutines, joins them before returning. The handler's request lifecycle owns the goroutine.
- A long-running service: a `Server` struct that holds a `cancel()` function and a `done` channel. `Server.Stop()` is the only valid way to stop the goroutine.
- A pipeline stage: the parent who connects the channels owns the stage's goroutine.

### Lifetime mismatch is the #1 source of leaks

```go
// BAD: handler returns; goroutine survives, eventually writing to closed conn
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        time.Sleep(time.Hour)
        log.Println("late") // leak forever
    }()
}
```

The goroutine outlives the request. If thousands of requests arrive, thousands of goroutines accumulate. Every one of them holds the captured closure, the captured `r`, possibly its body buffer — for an hour.

### Fix: scope goroutines to their lifetime

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error { return work(gctx) })
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
    }
}
```

If the client disconnects, `r.Context()` is cancelled, `work` sees `gctx.Done()`, and the goroutine returns. The handler waits via `g.Wait()` before returning. No leak is possible.

---

## Structured Concurrency

Structured concurrency is a paradigm: every goroutine spawned in a function exits before the function returns. It mirrors how function calls compose — the caller cannot return until callees have returned.

Go does not enforce structured concurrency, but you can adopt it as a convention. The payoff is dramatic: every leak, every deadline propagation bug, every "who closes the channel" argument disappears, because every goroutine's lifetime is bounded by a syntactic block.

### The `errgroup.Group` is the cheapest structured-concurrency primitive

```go
func processBatch(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error { return processItem(ctx, item) })
    }
    return g.Wait()
}
```

When `processBatch` returns:

- All spawned goroutines have exited.
- If any errored, `ctx` was cancelled and the rest exited early.
- The first non-nil error is returned.

This *is* structured concurrency. The function does not return until all its concurrent work has finished.

### Anti-pattern: spawning into the void

```go
func Start() {
    go runForever()
}
```

`Start` returns; `runForever` lives on. Who stops it? The returned `error`? Nope, there is none. The caller's context? Not passed. If `main` returns, sure, the goroutine dies — but until then, you have an unkillable thread.

### Make "starting a long-running goroutine" an explicit type

```go
type Service struct {
    cancel context.CancelFunc
    done   chan error
}

func Start(ctx context.Context) *Service {
    ctx, cancel := context.WithCancel(ctx)
    s := &Service{cancel: cancel, done: make(chan error, 1)}
    go func() { s.done <- s.run(ctx) }()
    return s
}

func (s *Service) Stop() error {
    s.cancel()
    return <-s.done
}
```

The caller has a `Stop()` method that *blocks until the goroutine has actually exited and returned its error*. The lifetime is now visible in the type system.

---

## Supervisor Patterns

In a long-running system, some goroutines must be restarted on failure. The Go equivalent of an Erlang supervisor:

```go
func supervise(ctx context.Context, name string, run func(context.Context) error) {
    backoff := time.Second
    for {
        if ctx.Err() != nil {
            return
        }
        err := safeRun(ctx, run)
        if ctx.Err() != nil {
            return
        }
        log.Printf("supervised goroutine %q exited: %v; restarting in %v", name, err, backoff)
        select {
        case <-ctx.Done():
            return
        case <-time.After(backoff):
        }
        if backoff < 30*time.Second {
            backoff *= 2
        }
    }
}

func safeRun(ctx context.Context, run func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return run(ctx)
}
```

Key properties:

- Recovers panics into errors.
- Backs off exponentially before restart.
- Cancellation aware: returns when `ctx` is done, even mid-backoff.
- Logs every restart with reason.

Supervisors are appropriate for crash-tolerant background loops (consumers, tickers, sync workers). They are *not* appropriate for transient request goroutines — those should fail loudly and let the caller handle it.

### Supervisor trees

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { supervise(ctx, "consumer", consumeLoop); return nil })
g.Go(func() error { supervise(ctx, "metrics",  metricsLoop);  return nil })
g.Go(func() error { supervise(ctx, "janitor",  janitorLoop);  return nil })
return g.Wait()
```

When `parent` is cancelled, the supervisors return, the children stop, the function returns. Structured concurrency, with crash recovery.

---

## Designing Worker Pools That Scale

A naive pool — N workers reading from a single channel — gets you 80% of the way. The other 20% covers the failure modes that bite at scale.

### Issue 1: Slow consumer of `results` blocks workers

```go
results := make(chan Result)        // unbuffered — pinch point
```

If the result reader is slower than workers, every worker blocks on `results <-`. Effective concurrency drops to 1.

Fix: buffer the result channel proportionally to expected burstiness, or push results into a faster sink (e.g. a batched DB writer goroutine).

### Issue 2: Hot worker, cold worker

If jobs vary wildly in cost, some workers finish quickly and starve waiting for the next job, while one worker grinds on a heavy job. The Go runtime will not redistribute. Solution: make jobs roughly uniform by chunking, or use a priority queue with a per-priority pool.

### Issue 3: Catastrophic propagation on worker death

If one worker panics and the supervisor does not restart it, the pool silently shrinks. Over time, the pool degrades. Always supervise pool workers in production.

### Issue 4: Pool size mismatch with downstream

A pool of 100 workers all calling a database with `max_connections=20` will queue 80 connection attempts and time out. Pool size must respect downstream limits.

### Production-grade pool

```go
type Pool struct {
    size     int
    jobs     chan Job
    quit     chan struct{}
    wg       sync.WaitGroup
    panicked atomic.Int64
}

func NewPool(size int) *Pool {
    p := &Pool{size: size, jobs: make(chan Job, size*2), quit: make(chan struct{})}
    p.wg.Add(size)
    for i := 0; i < size; i++ {
        go p.worker(i)
    }
    return p
}

func (p *Pool) worker(id int) {
    defer p.wg.Done()
    defer func() {
        if r := recover(); r != nil {
            p.panicked.Add(1)
            log.Printf("worker %d panic: %v", id, r)
            // restart self
            p.wg.Add(1)
            go p.worker(id)
        }
    }()
    for {
        select {
        case <-p.quit:
            return
        case job, ok := <-p.jobs:
            if !ok {
                return
            }
            job.Run()
        }
    }
}

func (p *Pool) Submit(j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-p.quit:
        return errors.New("pool closed")
    }
}

func (p *Pool) Stop() {
    close(p.quit)
    p.wg.Wait()
}
```

This pool has bounded buffering, supervised workers, observable panic count, and an explicit stop. It is production-shaped without being heavy.

---

## Backpressure

Backpressure is the art of slowing producers when consumers cannot keep up. Without it, queues grow unbounded and memory follows.

### Three levers

| Lever | Effect | Cost |
|---|---|---|
| Block the producer (unbuffered or full buffered channel) | Producer waits → upstream slows → caller backs off | Latency increases |
| Reject the work (full channel + non-blocking send) | Producer drops the work; caller sees error | Lost work |
| Spill to disk / queue (Kafka, NATS, Redis) | Producer succeeds, work is durably queued | Operational complexity |

### Non-blocking submit pattern

```go
func (p *Pool) TrySubmit(j Job) bool {
    select {
    case p.jobs <- j:
        return true
    default:
        return false
    }
}
```

Caller decides what to do with rejection: log, retry, return 503.

### Token-bucket / rate limiter

`golang.org/x/time/rate.Limiter` gates work to a sustainable rate:

```go
limiter := rate.NewLimiter(rate.Limit(100), 200) // 100/s, burst 200

go func() {
    for job := range jobs {
        if err := limiter.Wait(ctx); err != nil { return }
        process(job)
    }
}()
```

Backpressure here applies *time*, not memory.

### Why this matters

A web service that hits 10× normal traffic will, without backpressure, spawn 10× the goroutines, each holding 10× the memory, all racing for the same downstream. The result is OOM or cascading timeout. With backpressure, the service degrades to 503s on the excess, but the rest stays healthy.

---

## Bounded Parallelism with Semaphores

When you want N tasks to run concurrently but no more, use a semaphore.

### Channel-based semaphore

```go
sem := make(chan struct{}, 8) // 8 slots

for _, item := range items {
    sem <- struct{}{} // acquire
    go func(item Item) {
        defer func() { <-sem }() // release
        process(item)
    }(item)
}

// drain — wait for all to release
for i := 0; i < cap(sem); i++ { sem <- struct{}{} }
```

The capacity of the channel is the parallelism limit.

### `golang.org/x/sync/semaphore`

```go
sem := semaphore.NewWeighted(8)

for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    go func() {
        defer sem.Release(1)
        process(item)
    }()
}
sem.Acquire(ctx, 8) // wait for all
```

Supports weighted resources (e.g. one job costs 2, another costs 1), context-aware acquire.

### `errgroup.Group.SetLimit`

The simplest of the three for "N parallel, with errors":

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

Use `errgroup` when you want errors and structured concurrency; use `semaphore` for fine-grained weighted control; use channel-as-semaphore for the simplest case.

---

## Goroutine Leak Engineering

Leaks at scale require engineering discipline, not just awareness.

### Leak budgets

Track `runtime.NumGoroutine()` as a metric. Alert when it grows monotonically over hours. Define an SLO: "p99 goroutine count after recovery from incident must return to baseline within 5 minutes."

### Tag goroutines with `pprof.Labels`

```go
import "runtime/pprof"

ctx = pprof.WithLabels(ctx, pprof.Labels("op", "fetch", "user", userID))
pprof.SetGoroutineLabels(ctx)
go work(ctx)
```

A `goroutine` profile from `/debug/pprof/goroutine` now groups goroutines by these labels. You see "10 000 goroutines stuck in `op=fetch`" instead of just "10 000 goroutines, somewhere."

### Goroutine snapshot diff in tests

```go
import "go.uber.org/goleak"

func TestFetchAll(t *testing.T) {
    defer goleak.VerifyNone(t)
    FetchAll(context.Background(), []string{"a", "b", "c"})
}
```

Test fails if any goroutine spawned during the test has not exited. This catches leaks at PR time, not in production.

### Anti-pattern: ignoring leak signals because "it always recovers"

A test that "occasionally" leaves a goroutine is leaking under some condition. The `goleak` failure is the bug. Investigate; do not retry.

---

## Panics in a Concurrent System

A panic in any goroutine, if not recovered locally, terminates the whole process. In a multi-tenant service, that means a single bad input from one user kills every concurrent request.

### Defence in depth

1. **Recover at every goroutine boundary** that handles untrusted input. Log, increment a metric, return an error.
2. **Recover in HTTP handlers** with `http.Server`'s built-in recovery, or a middleware. Make sure spawned goroutines inside handlers also recover.
3. **Use `errgroup`** — its `Go` does not magically recover, but the *function* you pass returns a regular error, so you can `defer recover()` inside.

### A reusable helper

```go
func safeGo(ctx context.Context, name string, fn func(context.Context) error) func() error {
    return func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("%s panic: %v\n%s", name, r, debug.Stack())
            }
        }()
        return fn(ctx)
    }
}

g.Go(safeGo(ctx, "fetcher", fetch))
```

Now every goroutine spawned via `safeGo` translates a panic into an error, which `errgroup` propagates and the supervisor logs.

### Panics in deferred functions

A `panic` in a deferred function runs after the original panic. If both are unrecovered, only the most recent is reported. Always recover in deferred cleanup that may panic.

---

## Cancellation Trees and Deadline Propagation

Every goroutine in a request handler should observe the request's deadline. Every downstream call inherits it.

### Building the tree

```
parent ctx (HTTP request, 30s deadline)
├── ctx for DB query (inherits deadline)
│   └── ctx for retry attempt (inherits deadline)
└── ctx for downstream call (deadline shortened to 10s)
```

### The `WithTimeout` cascade

```go
func handler(ctx context.Context, ...) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()
        return slowCall(cctx)
    })
    g.Go(func() error {
        cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()
        return otherCall(cctx)
    })
    return g.Wait()
}
```

If the parent is cancelled, both children are cancelled. If one child errors, `errgroup` cancels the group context, both children stop. The outer deadline still bounds everything.

### Honest deadline propagation

A common subtle bug: passing `context.Background()` to a goroutine that should respect the parent's deadline.

```go
go func() {
    res, err := downstream.Get(context.Background(), id) // BUG: no deadline
}()
```

This goroutine ignores cancellation. The handler returns; the goroutine grinds on. Always pass the request's `ctx` (or a derived `ctx`) to every downstream call.

---

## Sharing State Between Goroutines

The Go memory model defines when one goroutine's writes become visible to another. The summary:

- Without synchronisation, no guarantees about visibility or ordering.
- With a `Mutex.Unlock` followed by `Mutex.Lock`, all writes before the unlock are visible after the lock.
- With a channel send-receive pair, sends happen-before the corresponding receive.
- With `sync/atomic`, atomic operations on the same memory are sequentially consistent.

### Practical guidance

| State shape | Tool |
|---|---|
| One owner goroutine, others request via channels | channels (Actor model) |
| Map/slice mutated by many goroutines | `sync.Mutex` (or `sync.RWMutex` if reads dominate) |
| Single integer counter | `sync/atomic` |
| Read-mostly cached config | `atomic.Value` or `atomic.Pointer[T]` |
| Lazy init done once | `sync.Once` |
| Many concurrent readers, infrequent updates | `sync.RWMutex` or copy-on-write via `atomic.Pointer[T]` |

### Copy-on-write configuration

```go
type Config struct { ... }

var cfg atomic.Pointer[Config]

func Get() *Config { return cfg.Load() }

func Update(new *Config) { cfg.Store(new) }
```

Readers never block. Writers replace the pointer. The previous `*Config` lives until no goroutine holds it (the GC handles it). Used by Cloudflare, Google, Uber for hot-reloadable config.

### Avoid `sync.Map` unless you need it

`sync.Map` is optimized for "write-once-read-many" or "disjoint key sets per goroutine." For ordinary "read and write the same keys," a `sync.Mutex` + `map[string]V` is faster. Read the doc comment before reaching for `sync.Map`.

---

## Goroutine-per-Connection vs Event-Loop

Go's "goroutine per connection" model is a deliberate departure from the event-loop model used by Node.js, nginx, and most C++ async frameworks.

| Model | Strengths | Weaknesses |
|---|---|---|
| Goroutine per connection (Go) | Synchronous-style code, easy to read; runtime parks idle goroutines; scales to ~1M connections | Memory cost per goroutine (~2KB stack + heap); GC pressure |
| Event loop (Node, nginx) | Lower memory per connection; predictable latency | Inverted control flow; callback hell; harder to compose |

The Go runtime makes goroutine-per-connection viable by:

- Parking goroutines waiting on I/O instead of holding OS threads.
- Multiplexing all I/O onto a single `netpoll` (epoll/kqueue/IOCP) goroutine.
- Growing stacks on demand, so the per-connection cost stays small.

For most services, the goroutine-per-connection model is the right default. Switch to event-loop-style only if you have measured connection counts north of ~100k–1M *and* per-goroutine memory is the bottleneck.

---

## Observability of Goroutines

You cannot fix what you cannot see. Production Go services should expose:

### `runtime.NumGoroutine()` as a gauge metric

```go
metrics.NewGauge("go_goroutines", func() float64 {
    return float64(runtime.NumGoroutine())
})
```

### `pprof.Lookup("goroutine")` as an HTTP endpoint

```go
import _ "net/http/pprof"
go http.ListenAndServe(":6060", nil)
```

Then:

```bash
curl localhost:6060/debug/pprof/goroutine?debug=1 | head -50
```

### Trace via `runtime/trace`

```go
f, _ := os.Create("trace.out")
defer f.Close()
trace.Start(f)
defer trace.Stop()

// run code
```

Then `go tool trace trace.out` opens a browser visualisation of every goroutine's life: when it ran, when it blocked, on what.

### Custom labels for grouping

```go
ctx := pprof.WithLabels(parent, pprof.Labels("op", "ingest", "tenant", tenantID))
pprof.Do(ctx, pprof.Labels(), func(ctx context.Context) {
    runWork(ctx)
})
```

Profiles now segment by `op` and `tenant`. You see "tenant X's ingest is using 60% of goroutines and 80% of CPU" without instrumenting your business code with metrics.

---

## Testing Concurrent Code

### Hammer with `t.Parallel()` and `-race`

```go
func TestConcurrentFoo(t *testing.T) {
    t.Parallel()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = Foo() // exercise contended code
        }()
    }
    wg.Wait()
}
```

Run `go test -race -count=10 ./...` to repeat the test 10 times and shake out timing-dependent races.

### Use synctest (Go 1.24+) where available

`testing/synctest` (experimental in 1.24) lets you write deterministic tests for concurrent code by virtualising time and the scheduler. Watch the proposal — it dramatically reduces flakiness in tests that today rely on `time.Sleep`.

### Goleak in `TestMain`

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Enforces "no leaked goroutines" across the whole package.

### Property-based shaking

`github.com/leanovate/gopter` or `github.com/sanity-io/litter` can generate random orderings and inputs. For state machines and concurrent data structures, property-based tests find bugs deterministic tests cannot.

---

## Architectural Smells

| Smell | What it indicates |
|---|---|
| Constructor that calls `go` and returns no `Stop` | Leak by design. |
| Function that takes a chan and never reads it | Probably a leak in the caller. |
| Multiple goroutines that all try to close the same channel | Race + panic on double close. |
| Hand-rolled `WaitGroup + chan error + sync.Once` | Replace with `errgroup`. |
| Deep nesting of `select { case ... }` blocks | Suggests an actor or state machine; refactor. |
| `runtime.NumGoroutine()` rising in production | Either organic growth (OK if bounded) or leak (not OK). |
| `time.Sleep` in non-test code as a coordination mechanism | Race waiting to happen. |
| Code that uses both channels *and* a mutex on the same data | Pick one. Document who owns the data. |
| `recover` missing from a worker goroutine that handles untrusted input | One bad request kills the service. |
| `sync.Map` used where `map + Mutex` would do | Premature optimisation, often slower. |

---

## Self-Assessment

- [ ] I can identify the lifetime owner of every goroutine in a code review.
- [ ] I prefer `errgroup` over hand-rolled coordination.
- [ ] I tag goroutines with `pprof.Labels` for production debugging.
- [ ] I enforce "no leaked goroutines" with `goleak` in tests.
- [ ] I size pools based on downstream limits, not gut feeling.
- [ ] I have applied backpressure (block, reject, or spill) consciously in at least one service.
- [ ] I know the difference between `sync.Mutex`, `sync.RWMutex`, `atomic.Value`, and `atomic.Pointer[T]` and pick the right one.
- [ ] I have used `runtime/trace` to debug a real concurrency issue.
- [ ] I have a supervisor pattern for crash-tolerant background loops.
- [ ] I never spawn a goroutine in a constructor without returning a way to stop it.

---

## Summary

Senior-level goroutine work is about *design*, not syntax. Three principles:

1. **Lifetime is a first-class concern.** Every goroutine has an owner, a stop signal, and a way for the owner to confirm exit. If you cannot articulate all three, do not spawn.
2. **Adopt structured concurrency.** Make `errgroup.Group` your default. The function spawning concurrent work returns only after all of it has finished.
3. **Observe everything.** `runtime.NumGoroutine`, `pprof.Labels`, `runtime/trace`, `goleak` — the cost of instrumentation is low, the cost of an undiagnosed leak in production is high.

The professional level dives into the Go runtime itself: the GMP scheduler, work-stealing, sysmon, async preemption, and what actually happens in the nanoseconds between `go f()` and `f` running.
