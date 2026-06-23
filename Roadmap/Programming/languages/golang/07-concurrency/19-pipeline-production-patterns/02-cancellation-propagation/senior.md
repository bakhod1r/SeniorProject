---
layout: default
title: Cancellation Propagation — Senior
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/senior/
---

# Cancellation Propagation — Senior Level

## Table of Contents
1. [Architecture View](#architecture-view)
2. [Structured Concurrency in Go](#structured-concurrency-in-go)
3. [Supervisor Trees and Restart Policies](#supervisor-trees-and-restart-policies)
4. [The Shape of Real Production Pipelines](#the-shape-of-real-production-pipelines)
5. [Cancellation Flow: Up, Down, Sideways](#cancellation-flow-up-down-sideways)
6. [Drain Semantics in Detail](#drain-semantics-in-detail)
7. [Backpressure and Cancellation Interplay](#backpressure-and-cancellation-interplay)
8. [Cancellation Across Process Boundaries](#cancellation-across-process-boundaries)
9. [Lifecycle Modelling and State Machines](#lifecycle-modelling-and-state-machines)
10. [Designing for Predictable Cancellation Latency](#designing-for-predictable-cancellation-latency)
11. [Cancellation in Streaming Systems](#cancellation-in-streaming-systems)
12. [Race-Free Shutdown Protocols](#race-free-shutdown-protocols)
13. [Cancellation and Resource Lifetime](#cancellation-and-resource-lifetime)
14. [Choosing the Right Abstraction](#choosing-the-right-abstraction)
15. [Testing Strategies for Production-Grade Cancellation](#testing-strategies-for-production-grade-cancellation)
16. [Patterns from the Standard Library](#patterns-from-the-standard-library)
17. [Anti-Patterns at Scale](#anti-patterns-at-scale)
18. [Cancellation Bugs in the Wild](#cancellation-bugs-in-the-wild)
19. [Diagrams](#diagrams)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [Further Reading](#further-reading)

---

## Architecture View

At the senior level, cancellation propagation stops being a per-stage concern and becomes a property of the system. The right question is no longer "does this stage exit on cancel?" but "what is the cancellation topology of the whole service, and where are its weakest links?"

A typical Go service has a multi-layered cancellation graph:

- A root `context` cancelled by `SIGTERM`, `SIGINT`, or an admin-triggered drain.
- One or more per-listener contexts (HTTP, gRPC, message-queue subscriber).
- One per-request context for each incoming call.
- One per-pipeline context inside each request.
- One per-call context for each outbound dependency.
- One per-task context for each background job, periodic worker, or scheduled task.

Every context inherits from one above. Cancelling any node cascades to its descendants. The shape is a forest, with `context.Background()` as the implicit root of every tree.

The architecture-level goals:

- **Liveness.** Every cancellation reaches every goroutine that depends on it, within a known time bound.
- **Safety.** No data loss without explicit acceptance; no double-close; no use-after-cancel of resources that require active state.
- **Observability.** Every cancellation has a recorded reason; latency from cancel-trigger to fully-stopped is measurable.
- **Composability.** New pipelines, workers, and listeners plug into the cancellation graph without manual rewiring.

The remainder of this file unpacks each goal and the patterns that achieve them.

---

## A deeper look at the architectural goals

Each of the four goals — liveness, safety, observability, composability — has concrete patterns that achieve it. Let me unpack each.

### Liveness in detail

Liveness is "the system makes progress and eventually stops when told." For cancellation, two sub-properties:

- **Eventual cancellation**: every goroutine that should stop, does stop, given enough time after `cancel()`.
- **Bounded latency**: "enough time" is a known constant, ideally well under the shutdown SLA.

Eventual cancellation requires every blocking operation to have a path to cancellation. The minimum: every `select` has a `<-ctx.Done()` case. The maximum: every external I/O call uses a context-aware variant, every long inner loop polls `ctx.Err()`.

Bounded latency requires measurement. You cannot promise a 30-second shutdown SLA if you have never measured the cancellation latency under realistic load. The discipline is:

1. Define the SLA (e.g. "fully stopped within 30 seconds of SIGTERM under any conditions").
2. Identify the slowest component (often per-item work or external I/O).
3. Either reduce its latency or accept it as the bottleneck and set the SLA accordingly.
4. Test under load that exercises the worst case.

### Safety in detail

Safety is "nothing bad happens during cancellation." The threats:

- **Double-close**: closing a channel twice panics. Solution: single closer per channel.
- **Use-after-close**: sending to a closed channel panics. Solution: producer closes its own output; nobody else writes after close.
- **Resource leaks**: a goroutine that holds a connection, file, or lock and does not release it on cancellation. Solution: `defer` releases for everything held.
- **Data loss**: in-flight items dropped on cancellation. Solution: design to either tolerate drops or implement an ack/commit protocol.
- **Partial state**: a state machine left in a transient state (e.g. "half-flushed") on cancellation. Solution: explicit recovery on restart, idempotent operations.

Senior-level designs identify these threats up-front and engineer them away. The patterns are familiar — `defer`, `WaitGroup`, ack channels — but the discipline is the architectural commitment.

### Observability in detail

You cannot fix what you cannot see. For cancellation:

- **Cancellation reason**: every cancel carries a cause. `context.WithCancelCause` is the primitive; logging and tracing carry it forward.
- **Cancellation latency**: histogram of time from cancel-trigger to last-goroutine-exited.
- **Goroutine count**: gauge of `runtime.NumGoroutine`, with alerts on drift.
- **Stage-level metrics**: counters for "cancelled mid-process" per stage.
- **Per-goroutine traces**: optional, but valuable for debugging — each goroutine logs its enter/exit with timestamps.

Together these form a "cancellation observability stack" that turns shutdown from a black box into a visible, debuggable process.

### Composability in detail

A new pipeline should plug into the existing graph without manual wiring. The pattern: every component takes `ctx context.Context` as its first parameter, derives child contexts as needed, and respects cancellation. New components inherit the same discipline.

The shape-by-default: a function or struct that holds state and goroutines exposes a `ctx context.Context` argument in its constructor (and possibly a separate `Run(ctx)` method). The implementation derives an internal context for its own work but cancels it on parent cancel.

```go
type Pool struct {
    ctx    context.Context
    cancel context.CancelFunc
    // ...
}

func NewPool(parent context.Context) *Pool {
    ctx, cancel := context.WithCancel(parent)
    return &Pool{ctx: ctx, cancel: cancel}
}

func (p *Pool) Close() { p.cancel() }
```

The pool's internal context derives from the parent; cancelling the parent cancels the pool. `Close` is also available for explicit shutdown. The pool composes with other components automatically.

---

## Structured Concurrency in Go

Structured concurrency is the discipline of constraining goroutine lifetimes to lexical scopes. A function that spawns goroutines must wait for them before returning. The function's scope is the "structure" that contains the concurrency.

Go does not enforce structured concurrency at the language level. There is no `await` that forces a join, no `with` block that closes goroutines. But you can achieve it by convention, using `errgroup`, `sync.WaitGroup`, and `defer cancel()`. The patterns become muscle memory.

### The structured idiom

```go
func operation(parent context.Context) error {
    g, ctx := errgroup.WithContext(parent)
    g.Go(func() error { return stageA(ctx) })
    g.Go(func() error { return stageB(ctx) })
    return g.Wait() // every goroutine has exited before this returns
}
```

`Wait` guarantees that when `operation` returns, every goroutine it spawned has also returned. No leak, no race. The cancellation is automatic on any error.

### Violations of structure

Spawning a goroutine that outlives the function:

```go
func operation(ctx context.Context) {
    go forever(ctx) // never joined
    return
}
```

`forever` is now orphaned. If `ctx` is cancelled, it exits — but who waits for it? Nobody. The function returns; the goroutine continues until `ctx` cancels. This is acceptable only for true fire-and-forget tasks (logging, metrics emission), and even then the long-lived context should be explicit.

### Promotion: escaping the scope deliberately

Sometimes a sub-operation should outlive the function. The principled way: separate the cancellation scope from the function scope.

```go
func handler(parent context.Context, longLived context.Context) {
    if err := work(parent); err != nil {
        // log the failure even if parent's request is over
        go logFailure(longLived, err)
    }
}
```

The fire-and-forget logger uses `longLived` — a context tied to the application lifetime. It will outlive the handler but will still die on shutdown. The pattern is explicit: anyone reading the code sees that `logFailure` is detached.

`context.WithoutCancel` (Go 1.21+) formalises this: `detached := context.WithoutCancel(parent)` returns a context with parent's values but no parent cancellation.

### Why structure matters at scale

A single unstructured goroutine in a request handler is usually harmless. Multiplied by 10 000 RPS and 30 days of uptime, it becomes a leak. Structured concurrency is the discipline that prevents accumulation. Every goroutine has a join point; every join point waits.

The cost is verbosity: you cannot write `go work()` and forget. The benefit is that the goroutine count of your service is bounded by the active operations, not by the cumulative history.

### Comparison with other languages

- **Kotlin coroutines** enforce structure via `CoroutineScope`. Every coroutine belongs to a scope; cancelling the scope cancels all children.
- **Trio in Python** has "nurseries" — a context manager that owns its tasks.
- **Java's `ExecutorService`** has `shutdown` and `awaitTermination` — informal structure.
- **Rust's `tokio::spawn`** is unstructured by default; `JoinHandle` lets you join, but it is optional.

Go is closer to Rust than to Kotlin: structure is a convention, not a language feature. The patterns in this file are how you achieve it.

---

## Structured concurrency: case studies

### Case study A: an in-memory job runner

A function that runs a set of jobs in parallel, waits for all, returns the first error. Structured concurrency makes this trivial:

```go
func runJobs(ctx context.Context, jobs []Job) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for _, j := range jobs {
        j := j
        g.Go(func() error {
            return runJob(ctx, j)
        })
    }
    return g.Wait()
}
```

When `runJobs` returns, every job goroutine has returned. No leaks. Cancellation cascades naturally. This is the gold standard for structured concurrency in Go.

### Case study B: a long-running daemon

A daemon that exposes a status API while running a background workload. The structure is more complex but still bounded:

```go
func runDaemon(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        return runStatusAPI(ctx)
    })

    g.Go(func() error {
        return runBackgroundWork(ctx)
    })

    return g.Wait()
}
```

Two goroutines, joined by `g.Wait`. If either returns an error, the other cancels. If `ctx` is cancelled externally, both stop. The daemon's caller knows that when `runDaemon` returns, the daemon is fully stopped.

### Case study C: a request handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    g, ctx := errgroup.WithContext(ctx)

    var partA, partB Result
    g.Go(func() error {
        var err error
        partA, err = fetchA(ctx)
        return err
    })
    g.Go(func() error {
        var err error
        partB, err = fetchB(ctx)
        return err
    })

    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    json.NewEncoder(w).Encode(combine(partA, partB))
}
```

Fetch two parts in parallel, combine, respond. Structured concurrency: when `g.Wait()` returns, both fetches have returned. Cancellation cascades from client disconnect.

The data race on `partA` and `partB` is fine because `g.Wait()` synchronises — after `Wait`, the assignments in `g.Go`-spawned goroutines are visible to the caller.

### Where structured concurrency breaks

The structured pattern requires "wait for every goroutine before returning." This conflicts with fire-and-forget tasks. Patterns to handle the conflict:

1. **Promote the goroutine to a longer-lived scope.** Use `context.WithoutCancel(parent)` or pass a long-lived context directly. The goroutine then has a join point in the long-lived scope (e.g. `main`).
2. **Track the goroutine in a registry.** A service-level "background tasks" registry that tracks every spawned task. Shutdown waits on all of them.
3. **Accept the trade-off.** For truly fire-and-forget tasks (a log line, a metric increment) the goroutine is short-lived and the leak is bounded. Document and move on.

A typical service has a few "background tasks" (metrics emitter, health checker) that outlive request handlers but live within the service lifetime. They are structured against the service, not against any request.

---

## Supervisor Trees and Restart Policies

A long-lived service has goroutines that should be restarted on failure, not just cancelled. The supervisor pattern handles this.

### Basic supervisor

```go
func supervise(ctx context.Context, name string, fn func(context.Context) error) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        if err := fn(ctx); err != nil {
            log.Printf("%s: %v, restarting", name, err)
        }
    }
}
```

A goroutine that runs `fn`, restarts on error, and exits cleanly on cancellation. Useful for background workers that should be resilient to transient failures.

### With backoff

```go
func superviseWithBackoff(ctx context.Context, name string, fn func(context.Context) error) {
    backoff := time.Second
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        start := time.Now()
        if err := fn(ctx); err != nil {
            log.Printf("%s: %v", name, err)
        }
        if time.Since(start) > 10*time.Second {
            backoff = time.Second // reset if the task ran for a while
        } else {
            backoff *= 2
            if backoff > time.Minute {
                backoff = time.Minute
            }
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(backoff):
        }
    }
}
```

Crash-loop protection. The backoff grows on rapid failures and resets after a stable interval.

### Tree of supervisors

A supervisor that supervises multiple supervisors:

```go
func runService(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        superviseWithBackoff(ctx, "queue-consumer", runConsumer)
        return ctx.Err()
    })
    g.Go(func() error {
        superviseWithBackoff(ctx, "scheduler", runScheduler)
        return ctx.Err()
    })
    g.Go(func() error {
        superviseWithBackoff(ctx, "http-server", runServer)
        return ctx.Err()
    })
    return g.Wait()
}
```

Three supervised tasks; each restarts independently. Cancellation from `ctx` shuts them all down.

### One-for-one vs one-for-all

In Erlang OTP, supervisors choose a restart strategy: one-for-one (restart only the failed child), one-for-all (restart everyone), or rest-for-one (restart the failed child and everything that depends on it).

Go does not have these primitives built in, but you can implement them. The simplest mapping:

- **One-for-one** — each child has its own `supervise` goroutine. Default behaviour.
- **One-for-all** — when any child fails, cancel the parent context (which cancels all children), then start fresh:

```go
func oneForAll(parent context.Context, children []func(context.Context) error) {
    for {
        select {
        case <-parent.Done():
            return
        default:
        }
        ctx, cancel := context.WithCancel(parent)
        g, ctx := errgroup.WithContext(ctx)
        for _, c := range children {
            c := c
            g.Go(func() error { return c(ctx) })
        }
        _ = g.Wait()
        cancel()
        time.Sleep(time.Second)
    }
}
```

Any child returning an error cancels the inner errgroup; all children stop; the supervisor sleeps and starts a new errgroup with all children. Crude but functional.

### When to use restarts

Restarts are appropriate when:

- The work is idempotent (rerunning is safe).
- Failures are transient (network blips, momentary backend unavailability).
- The task is long-lived (a queue consumer, a scheduler).

Restarts are not appropriate when:

- The work has side effects that should not repeat.
- Failures are permanent (misconfiguration, missing dependency).
- The task should fail fast and let the orchestrator (Kubernetes, systemd) restart the whole process.

For most cloud-native Go services, "let the orchestrator restart the process" is the right answer. Internal supervisors are for goroutines that should outlive transient errors but cannot afford a full process restart.

---

## Supervisor: detecting unhealthy restarts

A supervisor that restarts a failing task is useful, but a task that fails repeatedly (a crash loop) wastes resources and masks the bug. Add health monitoring:

```go
type Health struct {
    Failures    int
    LastFailure time.Time
    LastSuccess time.Time
}

func superviseWithHealth(ctx context.Context, name string, fn func(context.Context) error, health *Health) {
    backoff := time.Second
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        start := time.Now()
        err := fn(ctx)
        if err == nil {
            health.LastSuccess = time.Now()
            health.Failures = 0
            backoff = time.Second
        } else {
            health.LastFailure = time.Now()
            health.Failures++
            log.Printf("%s: %v (failures=%d)", name, err, health.Failures)
            if health.Failures > 10 {
                log.Printf("%s: too many failures, escalating", name)
                // signal alerting system, possibly exit
            }
        }
        if time.Since(start) > 30*time.Second {
            backoff = time.Second
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(backoff):
            backoff *= 2
            if backoff > time.Minute {
                backoff = time.Minute
            }
        }
    }
}
```

After 10 consecutive failures, the supervisor escalates. Options: trigger an alert, exit the process so the orchestrator restarts it, or just log loudly. The choice depends on operational preferences.

The lesson: a supervisor is more than a `for` loop. It is a small state machine that tracks health, applies backoff, and reports issues. Production code often externalises this into a library.

---

## Reasoning about cancellation latency, by component

A breakdown of where latency typically lives.

### `select` latency

A goroutine in `select { case <-ctx.Done(): ... case <-other: ... }` wakes within microseconds of `ctx.Done()` closing. The exact number depends on:

- How many goroutines are runnable at the time (scheduler congestion).
- Whether the goroutine was sleeping in a system call (slightly slower wake).
- GOMAXPROCS and the load on the running threads.

Typical: 1-10 microseconds. Worst case under heavy contention: 100 microseconds. This is usually negligible compared to other components.

### Per-item work

If a stage processes one item in 1 ms, the average cancellation latency for that stage is 0.5 ms (uniformly distributed within the item). With `ctx.Err()` polling inside the work, this drops to the polling interval — typically tens of microseconds.

For 100 ms per item, the average is 50 ms; this can be reduced to single-digit milliseconds with polling.

For 1 second per item, the average is 500 ms; this is usually unacceptable for a strict shutdown SLA and you must either reduce the per-item work, add polling, or restructure.

### External I/O

The slowest component. A blocking I/O call without context support can hold a goroutine for seconds or minutes.

- TCP read on a slow connection: until the connection times out.
- Database query without `QueryContext`: until the query completes.
- HTTP request without `NewRequestWithContext`: until the response or socket timeout.

Mitigations:

- Use the context-aware variant of every blocking call.
- Set explicit deadlines (`SetReadDeadline`, `WriteTimeout`).
- Have a watcher goroutine that closes the underlying resource on cancel.

A common pattern: every external call has a 5-second timeout via `context.WithTimeout`, and the call propagates the timeout to the protocol layer. After 5 seconds, the call returns with `context.DeadlineExceeded` and the goroutine exits.

### Buffer flush

A buffered channel may hold pending items at the time of cancellation. The consumer may continue to drain (if the cancellation policy is "deliver pending") or skip (if "drop pending"). The drain time is `buffer_size * per_item_consumer_time`.

For small buffers (1-10) the time is negligible. For large buffers (1000+) it dominates. Design buffers small enough that drain time is acceptable.

### Cumulative latency in a multi-stage pipeline

For a pipeline of N stages with cancellation latency L per stage, the total cancellation time is approximately L * N (if stages are sequential) or max(L_i) (if stages cancel in parallel).

In errgroup-driven pipelines, the cancel is broadcast to all stages simultaneously; each stage exits independently. Total latency is `max(L_i)`, dominated by the slowest stage.

In sequential cleanup (stage 1 closes its output, stage 2 sees and exits, etc.), latency is the sum. Avoid this by using a shared context rather than serial close-propagation.

---

## The Shape of Real Production Pipelines

Real production pipelines are not three stages on one machine. They are:

- A frontend (HTTP, gRPC, or queue subscriber).
- An internal queue or pipeline buffer.
- A pool of workers.
- One or more backend dependencies (databases, RPCs, cloud APIs).
- A result sink (another queue, a database, a response).
- A metrics emitter.
- A logger.
- A health-check endpoint.

Each of these is a participant in the cancellation graph. The challenge is wiring them so that one cancel signal flows everywhere, with predictable latency, no leaks, and no data loss.

### A reference architecture

```go
type Service struct {
    rootCtx    context.Context
    rootCancel context.CancelCauseFunc

    httpSrv *http.Server
    pool    *WorkerPool
    metrics *MetricsEmitter
    health  *HealthChecker
    db      *DBPool
}

func NewService(parent context.Context, cfg Config) (*Service, error) {
    rootCtx, rootCancel := context.WithCancelCause(parent)

    db, err := NewDBPool(rootCtx, cfg.DB)
    if err != nil {
        rootCancel(err)
        return nil, err
    }

    pool := NewWorkerPool(rootCtx, cfg.Workers, db)
    metrics := NewMetricsEmitter(rootCtx, cfg.Metrics)
    health := NewHealthChecker(rootCtx, pool)

    httpSrv := &http.Server{
        Addr:    cfg.Addr,
        Handler: buildHandler(pool, health),
        BaseContext: func(net.Listener) context.Context {
            return rootCtx
        },
    }

    return &Service{
        rootCtx:    rootCtx,
        rootCancel: rootCancel,
        httpSrv:    httpSrv,
        pool:       pool,
        metrics:    metrics,
        health:     health,
        db:         db,
    }, nil
}

func (s *Service) Run() error {
    g, _ := errgroup.WithContext(s.rootCtx)
    g.Go(func() error {
        if err := s.httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            return err
        }
        return nil
    })
    return g.Wait()
}

func (s *Service) Shutdown(deadline time.Duration) error {
    shutdownCtx, cancel := context.WithTimeout(context.Background(), deadline)
    defer cancel()

    // Stop accepting new
    if err := s.httpSrv.Shutdown(shutdownCtx); err != nil {
        log.Printf("server shutdown: %v", err)
    }

    // Drain workers
    s.pool.Drain()

    // Cancel root context
    s.rootCancel(errors.New("shutdown"))

    // Wait for background goroutines
    s.metrics.Wait()
    s.health.Wait()

    return s.db.Close()
}
```

The cancellation graph:

```
rootCtx (cancel cause: "shutdown" or initial error)
   ├── http server (BaseContext: rootCtx)
   │     └── per-request handlers (r.Context())
   │           └── pool.Submit -> worker -> db.QueryContext
   ├── worker pool
   ├── metrics emitter
   ├── health checker
   └── db pool (internal connection management)
```

`Shutdown` orchestrates:

1. HTTP server stops accepting; in-flight handlers see `rootCtx` cancel via `r.Context()`.
2. Pool drains; workers finish in-flight jobs.
3. `rootCancel` cancels the metrics emitter, health checker, and any other background tasks.
4. The DB pool closes after all consumers are done.

Order matters. Closing the DB first would error out workers mid-query. Cancelling `rootCtx` first might race with the HTTP server's drain. Following the strict outside-in ordering (listener → workers → background → resources) avoids these races.

---

## Per-component lifecycle: the `Run/Stop` interface

A common shape for components in a service:

```go
type Component interface {
    Run(ctx context.Context) error
    Stop(ctx context.Context) error
}
```

`Run` blocks until `ctx` cancels or an error occurs; it returns the cancellation reason or the error. `Stop` is an optional graceful shutdown trigger that may signal `Run` to drain.

Implementations:

```go
type Pool struct {
    parent  context.Context
    cancel  context.CancelFunc
    drained chan struct{}
}

func (p *Pool) Run(ctx context.Context) error {
    p.parent, p.cancel = context.WithCancel(ctx)
    p.drained = make(chan struct{})
    defer close(p.drained)
    // ... main loop, blocks until p.parent.Done() ...
    return p.parent.Err()
}

func (p *Pool) Stop(ctx context.Context) error {
    p.cancel()
    select {
    case <-p.drained:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

`Run` is invoked once when the service starts; it blocks until `Stop` (or the parent context) triggers cancellation. `Stop` is invoked during shutdown and waits for `Run` to finish, with its own deadline.

This pattern composes: a service has many components, each with `Run/Stop`; the service's main is:

```go
func main() {
    rootCtx, rootCancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer rootCancel()

    components := []Component{
        NewPool(...),
        NewServer(...),
        NewMetrics(...),
    }

    g, runCtx := errgroup.WithContext(rootCtx)
    for _, c := range components {
        c := c
        g.Go(func() error { return c.Run(runCtx) })
    }

    err := g.Wait()
    log.Println("service stopped:", err)

    // graceful Stop with deadline (best effort)
    stopCtx, stopCancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer stopCancel()
    for _, c := range components {
        if err := c.Stop(stopCtx); err != nil {
            log.Println("stop:", err)
        }
    }
}
```

Each component runs concurrently; the errgroup joins them; on shutdown each is stopped with a deadline. This is the standard service skeleton in production Go.

---

## Cancellation Flow: Up, Down, Sideways

At senior level, the directions of cancellation flow deserve careful analysis.

### Downstream propagation

The most common case: an upstream cancellation flows to downstream consumers. Examples:

- `SIGTERM` cancels rootCtx; everything downstream cancels.
- Request deadline expires; the request's pipeline cancels.
- An upstream stage encounters EOF; downstream stages see the input channel close.

The mechanism is `ctx.Done()` (a shared close) or channel close (per-channel signal). Both broadcast.

### Upstream propagation

A downstream stage decides to stop the pipeline. Examples:

- The consumer found what it wanted (`first(N)` pattern).
- The consumer encountered an unrecoverable error (cancel-on-error).
- The consumer is overloaded and signals back-pressure (rare; usually handled by channel buffering).

The mechanism: the consumer calls `cancel()` on a shared context. Upstream stages see `ctx.Done()` and stop producing. This is the same channel close, just initiated from the other end.

### Sideways propagation

Sibling goroutines in the same group cancel each other on the first error. This is the `errgroup` model: any goroutine returning a non-nil error triggers cancellation that reaches every sibling.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return stageA(ctx) }) // can cancel B
g.Go(func() error { return stageB(ctx) }) // can cancel A
```

If A errors, B sees `ctx.Done()`. If B errors first, A sees it. The cancellation is symmetric.

### Diagonal propagation

A nested errgroup: child errors cancel only the child group; parent group continues unless explicitly told.

```go
g, gctx := errgroup.WithContext(parent)
g.Go(func() error {
    sub, subctx := errgroup.WithContext(gctx)
    sub.Go(func() error { return work(subctx) })
    return sub.Wait() // sub-cancel does not affect parent siblings
})
g.Go(func() error { return otherWork(gctx) })
return g.Wait()
```

Sub-errors are isolated to the sub-group. Only when the outer `g.Go` returns the sub's error does the outer group cancel.

This isolation is what makes nested errgroups valuable: you can cleanly retry the sub-operation without affecting the rest of the parent pipeline.

### Choosing the right propagation model

The choice depends on the failure semantics of the system:

- **All-or-nothing.** Single errgroup; first error kills everyone. Right for transactional pipelines where partial results are useless.
- **Best-effort.** Per-task contexts; each task fails independently. Right for fan-out where partial results are valuable.
- **Hierarchical.** Nested errgroups; sub-failures contained. Right for systems with logical groupings of related tasks.

Senior-level pipeline design is largely about choosing the right propagation model for each layer.

---

## The narrow case of mid-pipeline mutation

A subtle situation: a pipeline stage mutates a slice or map that is shared with downstream. Cancellation interacts with the mutation.

```go
func enricher(ctx context.Context, in <-chan *Item) <-chan *Item {
    out := make(chan *Item)
    go func() {
        defer close(out)
        for item := range in {
            item.Enriched = computeEnrichment(ctx, item)
            select {
            case out <- item:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The enricher mutates `item.Enriched` in place. If the downstream consumer reads `item.Enriched` after cancellation, what does it see?

- If the enricher set the field before the select, the field is set.
- If the enricher was cancelled before setting it, the field is the zero value.

The downstream cannot distinguish. This is a small example of a larger issue: cancellation interrupts work in progress, and partial mutations are visible.

The fix: do not mutate; return new values. Functional style avoids this entirely:

```go
result := &Item{...item, Enriched: computeEnrichment(ctx, item)}
select {
case out <- result:
case <-ctx.Done():
    return
}
```

Now the downstream gets a fully-formed item or nothing. Cancellation cannot leak partial mutations.

---

## Pull-mode vs push-mode pipelines

Two design styles for pipelines:

- **Push-mode**: producer sends, consumer receives. The producer drives the rate.
- **Pull-mode**: consumer requests, producer responds. The consumer drives the rate.

Go channels naturally express push-mode (`out <- v`). Pull-mode requires more wiring but offers different cancellation properties.

### Push-mode cancellation

The producer's `out <- v` is `select`-guarded; cancellation interrupts the send. Standard pattern.

### Pull-mode cancellation

```go
type Producer struct {
    in  chan request
    out chan response
}

func (p *Producer) Request(ctx context.Context) (Response, error) {
    select {
    case p.in <- request{}:
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
    select {
    case r := <-p.out:
        return r, nil
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

The consumer sends a request and waits for a response. Cancellation interrupts either the request or the wait. The producer is a long-lived goroutine that handles requests one at a time.

Pull-mode is useful when:

- The consumer should control the work rate (e.g. avoid producing items the consumer cannot keep up with).
- The work is on-demand rather than streaming.
- Each item has a specific consumer (not just any).

### Combined: pull with batching

A pull-mode producer can batch internally:

```go
func (p *Producer) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-p.in:
            // produce a batch and send each response
            batch := p.produceBatch()
            for _, item := range batch {
                select {
                case p.out <- item:
                case <-ctx.Done():
                    return
                }
            }
        }
    }
}
```

The consumer requests once and receives a batch. The producer's internal batching is opaque to the consumer. Cancellation aborts mid-batch.

Most Go pipelines are push-mode by default. Pull-mode is a valuable variation for specific scenarios.

---

## Drain Semantics in Detail

Drain is what makes cancellation graceful. The high-level rule: when cancelling, ensure that pending work has somewhere to go (or is explicitly discarded). The low-level rule: every producer's last send must complete, either by a consumer reading or by the producer noticing cancellation and aborting.

### The minimal drain

After cancelling, read the remaining values from each channel:

```go
cancel()
for range out {
}
```

This unblocks producers stuck on `out <-`. They see `ctx.Done()` on the next iteration and return.

### Drain with deadline

A drain that does not block forever:

```go
cancel()
drainCtx, drainCancel := context.WithTimeout(context.Background(), 5*time.Second)
defer drainCancel()
drained := make(chan struct{})
go func() {
    for range out {
    }
    close(drained)
}()
select {
case <-drained:
case <-drainCtx.Done():
    log.Println("drain timed out; some goroutines may have leaked")
}
```

If the drain does not complete within 5 seconds, log and proceed. This is the realistic shape for production shutdown — you do not want to wait forever.

### Drain ordering across stages

In a multi-stage pipeline, the drain order matters. Drain the *output* of the pipeline; the cancellation cascades naturally backward. If you drain a middle channel, the producers upstream may still be blocked on the channel before it (because the middle stage cannot push into the drained-but-then-cancelled channel).

The orchestrator should:

1. Cancel the shared context.
2. Drain the final output channel.
3. Wait for all stages to exit (via `WaitGroup` or `errgroup`).

Manual mid-pipeline drains are usually unnecessary because each stage's `select` on `ctx.Done()` lets it exit without waiting for its output to be consumed (the send case loses to the cancel case).

### What to do with in-flight values

When draining, the values you read are no longer useful — by definition, you have cancelled. Two options:

- Discard them silently (`for range out {}`).
- Process them with reduced effort (`for v := range out { logDropped(v) }`).

The choice depends on whether the values are observable or recoverable. For idempotent reads, discard. For pending writes, you may need to commit them (a special case requiring careful design).

### Drain in fan-in stages

A fan-in stage forwards from N inputs to one output. On cancellation, each forwarder must drain its own input (to release upstream producers) and stop forwarding (to let the output close).

```go
go func(in <-chan T) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            // drain remaining
            for range in {
            }
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            select {
            case out <- v:
            case <-ctx.Done():
                // drain remaining
                for range in {
                }
                return
            }
        }
    }
}(in)
```

The drain inside the forwarder ensures the upstream producer can exit. Without it, the producer remains stuck on its send.

### When to skip the drain

If you know the producer also respects `ctx`, it will exit on `ctx.Done()` regardless of whether you drain. The drain is necessary only when the producer's send is blocking on you.

In errgroup-driven pipelines where every stage uses the shared context, drain is often unnecessary; the cancellation reaches everyone independently. The drain becomes important in mixed pipelines (some stages context-aware, others not) and in finite-data pipelines where the producer closes its output on EOF.

---

## Idempotent vs at-most-once vs at-least-once delivery

A pipeline carries data from upstream to downstream. Cancellation can interrupt mid-delivery. The semantics of that interruption fall into three categories.

### At-most-once

Each item is delivered zero or one times. On cancellation, in-flight items are discarded. No duplicates.

```go
select {
case out <- v:
case <-ctx.Done():
    return // v is silently dropped
}
```

The simplest model. Suitable when items can be lost without consequence (metrics, logs, idempotent reads).

### At-least-once

Each item is delivered one or more times. The producer retains the item until acknowledged. On cancellation, unacknowledged items may be redelivered next run.

```go
for _, item := range items {
    if delivered(item) {
        continue
    }
    select {
    case out <- item:
        markDelivered(item)
    case <-ctx.Done():
        return // item is not marked delivered; next run will retry
    }
}
```

Requires durable state (e.g. a checkpoint). Suitable when duplicates are tolerable but loss is not (most messaging systems).

### Exactly-once

Each item is delivered exactly once. Requires coordination: an ack protocol, transactional delivery, or idempotent consumers with deduplication.

```go
for _, item := range items {
    ackCh := make(chan struct{})
    select {
    case out <- AckItem{Value: item, Ack: ackCh}:
    case <-ctx.Done():
        return // item not sent
    }
    select {
    case <-ackCh:
        markDelivered(item)
    case <-ctx.Done():
        return // item sent but not acked; retry next time
    }
}
```

The consumer must idempotently handle the case where it receives the same item twice (e.g. deduplicate by ID). The producer waits for the ack before advancing.

The choice of delivery semantics is an architectural decision. Cancellation behaviour follows from it.

### Pragmatic trade-offs

In practice, "exactly-once" is rare and expensive. Most production systems use "at-least-once with idempotent consumers" — accepting that a cancellation may cause duplicate processing, designing consumers to handle it.

Designing for at-least-once means:

- Each item has a unique ID.
- The consumer tracks "seen" IDs (in a database or LRU cache).
- On receiving a duplicate, the consumer silently drops it.

The cancellation contract is: "If you cancel mid-delivery, an item may be processed twice; this is safe because the consumer handles duplicates."

---

## Backpressure and Cancellation Interplay

Backpressure is how a slow consumer slows down a fast producer. In Go pipelines, unbuffered or small-buffered channels provide back-pressure automatically: the producer's send blocks when the buffer is full, slowing it to the consumer's pace.

Cancellation interacts with back-pressure in interesting ways:

### Cancellation under back-pressure

The producer is blocked on `out <- v` because the consumer is slow. `cancel()` fires. The producer's `select { case out <- v: case <-ctx.Done(): }` picks the cancel case. The producer returns. The buffered value `v` is not delivered.

This is the correct behaviour: cancellation overrides back-pressure. The consumer was slow; cancellation says "we no longer care."

### Backpressure during shutdown

If the consumer is mid-task, it cannot read the channel. The producer is wedged. Cancellation arrives; the producer's `select` notices and the producer exits. Good.

But what if the consumer is reading slowly because it is doing valuable per-item work? On cancel, in-flight items are dropped. If those items represent committed writes, you have lost data. The fix: design the producer to not consider items "delivered" until the consumer acknowledges.

```go
// Producer
for v := range source {
    ack := make(chan struct{})
    select {
    case out <- WorkItem{Value: v, Ack: ack}:
    case <-ctx.Done():
        return
    }
    select {
    case <-ack:
        // item processed, safe to advance
    case <-ctx.Done():
        return
    }
}
```

Each item carries an `ack` channel; the consumer closes it after processing. The producer waits for the ack before sending the next item. This is a "stop-and-wait" protocol that integrates cancellation cleanly.

### Buffered channels as back-pressure dial

A buffer of N decouples producer and consumer up to N items. Smaller buffer means tighter coupling and faster propagation of consumer slowness. Larger buffer means more memory and longer cancellation latency.

A practical heuristic: buffers are 0, 1, or "sufficient for one batch of work." Buffers of "make the producer fast" usually indicate a design problem — the consumer should be made faster or the producer slower, not buffered.

### Bounded queues as a control point

Instead of a raw channel buffer, use a queue object with a `Push(ctx, v)` method that blocks (with `select` on `ctx.Done()`) when full. This makes the back-pressure point explicit and measurable.

```go
type Queue struct {
    ch chan T
}

func (q *Queue) Push(ctx context.Context, v T) error {
    select {
    case q.ch <- v:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (q *Queue) Pop(ctx context.Context) (T, error) {
    select {
    case v := <-q.ch:
        return v, nil
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

The queue is just a channel with a typed API. The benefit is observability: you can instrument `Push` to measure back-pressure (how often does it block? for how long?).

### Backpressure across services

Across an HTTP or gRPC boundary, back-pressure is the connection itself: the client's `Write` blocks when the kernel send buffer fills, which happens when the server is slow. Cancellation is the connection close: client cancels, connection closes, server's `Read` errors out.

The result: cross-service back-pressure and cancellation are physically the same mechanism (TCP flow control and FIN/RST). Designing for cancellation across the wire means designing for clean connection lifecycle.

---

## Backpressure design patterns

### Pattern: bounded queue with timeout

A queue that drops items if Push waits too long:

```go
func (q *Queue) PushWithTimeout(ctx context.Context, v T, d time.Duration) error {
    pushCtx, cancel := context.WithTimeout(ctx, d)
    defer cancel()
    select {
    case q.ch <- v:
        return nil
    case <-pushCtx.Done():
        return pushCtx.Err()
    }
}
```

Bounded waiting; the caller decides whether the timeout means "retry," "drop," or "fail." This is the closest Go offers to an explicit back-pressure policy.

### Pattern: shedding load

When the queue is full, drop the new item rather than block:

```go
select {
case q.ch <- v:
case <-ctx.Done():
    return ctx.Err()
default:
    // queue full; drop or signal load shedding
    metrics.IncDropped()
    return ErrLoadShed
}
```

The `default` case in `select` makes this non-blocking. If the queue cannot accept immediately, we drop.

Load shedding is a sophisticated topic; the key cancellation-related insight is that shedding is *not* the same as cancellation. Shedding is "I am too busy to accept this work right now"; cancellation is "stop the work you have already accepted." Both protect the system from overload, but at different stages.

### Pattern: adaptive concurrency

The number of workers adjusts based on observed latency:

```go
func adaptive(ctx context.Context, items <-chan Item) error {
    workers := 10
    var wg sync.WaitGroup
    for {
        select {
        case <-ctx.Done():
            wg.Wait()
            return ctx.Err()
        default:
        }
        // ... adjust workers based on latency observations ...
    }
}
```

A more advanced pattern; usually implemented via libraries (e.g. Netflix Concurrency Limits). Cancellation cleanly stops the adjustment loop along with the workers.

---

## Cancellation Across Process Boundaries

A pipeline that crosses a process boundary (RPC, HTTP, queue) loses the in-process cancellation primitive. The signal must be reconstructed on the remote side.

### gRPC

gRPC has first-class cancellation support:

- The client's `Context` carries the deadline as a "grpc-timeout" header.
- The server reconstructs a `Context` with the same deadline.
- On client cancel, gRPC sends `RST_STREAM`; the server sees its `Context` cancel.
- On server-side cancellation, the response is closed; the client sees an error.

This is the cleanest cross-process cancellation in Go's ecosystem. Use it freely.

### HTTP/1.1

HTTP/1.1 has no header for deadlines or explicit cancellation. The signal is:

- Client cancellation: close the TCP connection. The server sees the next `Read` return.
- Server cancellation: write a response and close. The client sees EOF on `Read`.

Without deadlines in metadata, the server cannot enforce the client's intended deadline. The client's `http.NewRequestWithContext` with a timeout closes the connection on timeout, but the server may have already started a slow operation that continues to completion (consuming server resources).

Mitigation: enforce server-side timeouts independently (`http.Server.WriteTimeout`, per-handler `context.WithTimeout`). Do not rely on the client-deadline-as-server-deadline pattern.

### HTTP/2 and HTTP/3

Both have stream cancellation primitives:

- HTTP/2: `RST_STREAM` frame closes a single stream without closing the connection.
- HTTP/3: stream reset over QUIC.

Modern Go HTTP servers detect these and cancel the request context appropriately.

### Message queues

Cancellation across a message queue is asymmetric: the consumer can stop consuming, but it cannot "cancel" a message that has been delivered.

- The consumer's local cancellation aborts its processing of the current message.
- Depending on the queue (Kafka commit, SQS ack), the message may be redelivered.
- The producer cannot recall a message that has been published.

For pipelines that include message queues, design idempotent consumers. Cancellation may cause a message to be processed twice (once partially, once retried) — the system must tolerate that.

### Database transactions

A database transaction is its own micro-cancellation domain:

- `db.BeginTx(ctx, ...)` starts a transaction tied to `ctx`.
- If `ctx` cancels mid-transaction, the driver issues a rollback.
- Already-committed work is durable, regardless of subsequent cancellation.

The cancellation latency depends on the driver's responsiveness to the cancel signal. `pgx` (Postgres) is well-instrumented; some MySQL drivers are less so.

### Worker queues across processes

For pipelines that span multiple processes (a producer in one, a worker in another), cancellation is by convention:

- The producer publishes a "cancel" message.
- The worker subscribes to the same channel and processes the cancel.

This is heavyweight; in practice, most multi-process pipelines rely on per-task deadlines rather than explicit cancel. If a task takes too long, it is aborted independently rather than coordinated.

---

## A study: cancellation in long-poll vs streaming

Two related patterns with different cancellation profiles.

### Long-poll: one response per request

```go
func longPoll(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()
    select {
    case ev := <-events:
        json.NewEncoder(w).Encode(ev)
    case <-ctx.Done():
        w.WriteHeader(204)
    }
}
```

The handler waits for one event or a deadline. Cancellation arrives via either source. The handler returns once.

### Server-Sent Events: many responses per request

```go
func sse(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    flusher := w.(http.Flusher)
    for {
        select {
        case <-ctx.Done():
            return
        case ev := <-events:
            fmt.Fprintf(w, "data: %s\n\n", ev.JSON())
            flusher.Flush()
        }
    }
}
```

The handler streams events. Cancellation arrives when the client disconnects. The handler exits the loop and returns.

The difference: long-poll has a fixed end (response or timeout); SSE is open-ended. SSE relies entirely on cancellation to stop. A SSE handler that does not check `ctx.Done()` is a permanent goroutine leak.

---

## Cross-process cancellation: case studies

### Case study: gRPC chained calls

A gRPC server receives a call, then makes a downstream gRPC call. The context is forwarded:

```go
func (s *server) Handle(ctx context.Context, req *Req) (*Resp, error) {
    downstream, err := s.client.Other(ctx, &OtherReq{})
    if err != nil {
        return nil, err
    }
    return &Resp{Data: downstream.Result}, nil
}
```

If the original caller cancels, `ctx` cancels in this server. The `s.client.Other(ctx, ...)` call sends RST_STREAM downstream; the downstream server's context cancels. The whole chain unwinds.

Deadlines propagate similarly: the original deadline travels in `grpc-timeout` metadata; each hop reconstructs the same deadline.

### Case study: HTTP-to-Kafka

A handler receives an HTTP request and publishes to Kafka:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := publish(r.Context(), msg); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
}

func publish(ctx context.Context, msg Message) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case producer.SendChan() <- msg:
        return nil
    }
}
```

The handler cancels if the client disconnects. The publish call respects `ctx` and returns. Kafka itself does not "see" the cancellation — once a message is in flight to the broker, it cannot be retracted.

This is the asymmetry: in-process, cancellation is two-way; into Kafka, cancellation only stops the producer's intent to publish further messages.

### Case study: distributed sagas

A saga is a sequence of compensable steps across services. Cancellation in the middle of a saga must trigger compensations (undo the completed steps).

```go
func runSaga(ctx context.Context, steps []Step) error {
    completed := []Step{}
    defer func() {
        if ctx.Err() != nil {
            for i := len(completed) - 1; i >= 0; i-- {
                completed[i].Compensate(context.Background()) // use detached ctx
            }
        }
    }()
    for _, s := range steps {
        if err := s.Execute(ctx); err != nil {
            return err
        }
        completed = append(completed, s)
    }
    return nil
}
```

The compensation uses `context.Background()` because we want it to run even after the saga's `ctx` cancelled. Or use `context.WithoutCancel(ctx)` to preserve values without cancellation.

Sagas are a deep topic; the relevant cancellation insight is that "graceful shutdown" of a saga is not just "stop running"; it is "stop running and undo what was started."

---

## Lifecycle Modelling and State Machines

A complex pipeline has states: Initialising, Running, Draining, Stopped. Modeling them explicitly clarifies cancellation behaviour.

### Explicit state

```go
type State int

const (
    StateInit State = iota
    StateRunning
    StateDraining
    StateStopped
)

type Service struct {
    mu    sync.Mutex
    state State
    // ...
}

func (s *Service) transition(to State) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !valid(s.state, to) {
        return fmt.Errorf("invalid transition: %d -> %d", s.state, to)
    }
    s.state = to
    return nil
}
```

Transitions are validated. `Init` -> `Running` -> `Draining` -> `Stopped` is the happy path; `Running` -> `Stopped` (skip drain) is forceful.

### Reading state from goroutines

```go
func (s *Service) acceptWork(j Job) error {
    s.mu.Lock()
    state := s.state
    s.mu.Unlock()
    if state != StateRunning {
        return ErrNotRunning
    }
    return s.pool.Submit(j)
}
```

Acceptance checks the state under the mutex. After `Draining`, new work is rejected.

### Coordinating state and context

The state machine drives the cancellation:

```go
func (s *Service) Drain() {
    s.transition(StateDraining)
    s.pool.StopAccepting()
    s.pool.Drain() // waits for workers
    s.transition(StateStopped)
    s.cancel(errors.New("drained"))
}
```

Workers respect the pool's "drain" signal; once they have finished in-flight jobs, they exit. The root cancel fires after, cleaning up background tasks.

### When to model state explicitly

Small services: do not bother. The implicit state from `context.Context` and channel close is sufficient.

Large services with complex lifecycle (multiple shutdown phases, hot config reload, graceful upgrade): model state explicitly. The clarity is worth the code.

---

## Lifecycle examples: rolling updates and hot reload

Production services often need to update without dropping in-flight work. Two patterns.

### Rolling update via two processes

The orchestrator (Kubernetes, systemd) starts a new process before stopping the old. Both run concurrently for a short window. The old process drains while the new one accepts new traffic.

In Go, the old process responds to `SIGTERM` by stopping its listener (e.g. `srv.Shutdown`) and draining its work. The new process is already up.

The cancellation flow in the old process:

1. `SIGTERM` arrives; `rootCtx` cancels.
2. HTTP listener stops accepting; `Shutdown` waits for handlers.
3. Background workers see `rootCtx.Done()`; they drain in-flight work.
4. After all goroutines exit, the old process terminates.

The orchestrator (not Go code) handles the dual-running window. The new process is just a regular boot.

### Hot reload via a single process

A single process reloads configuration without restarting. Cancellation is more interesting:

- Old configuration in use; goroutines hold pointers to it.
- New configuration arrives.
- Old goroutines continue with the old config (or are cancelled).
- New goroutines pick up the new config.

A common pattern: each component has a `Restart(newConfig)` method that creates a new internal context and replaces the old goroutines.

```go
func (p *Pool) Restart(newConfig Config) {
    p.mu.Lock()
    oldCancel := p.cancel
    p.ctx, p.cancel = context.WithCancel(p.parent)
    p.config = newConfig
    p.startWorkers()
    p.mu.Unlock()
    oldCancel() // old workers see cancel and exit
}
```

The new workers start before the old are cancelled; the changeover is brief. In-flight items in the old workers are either drained or dropped depending on policy.

Hot reload is hard to get right; many services prefer rolling updates instead.

---

## Designing for Predictable Cancellation Latency

Cancellation latency is the time from `cancel()` to the last goroutine exiting. For production pipelines, this should be measurable, bounded, and tested.

### Components of latency

- **Per-stage select latency.** The time between `cancel()` and the stage's next `select` iteration. Usually sub-microsecond if the stage selects often.
- **Per-item work time.** If a stage takes 1 second per item with no internal cancellation checks, that is 1 second of latency.
- **Channel buffer flush.** A buffer of 100 with 10 ms per item adds up to 1 second of buffered work.
- **External I/O.** A blocking I/O call that does not respect context can add seconds or minutes.

### Bounding each component

- **Select latency**: keep `select` in every loop; cancellation interruption is sub-millisecond.
- **Per-item work**: insert `ctx.Err()` checks in long inner loops, every 1ms or so.
- **Channel buffer**: keep buffers small (0, 1, or "one batch") unless there is a specific reason.
- **External I/O**: always pass `ctx` to context-aware variants (`db.QueryContext`, `http.NewRequestWithContext`).

### Measuring latency in tests

```go
func TestCancellationLatency(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        runPipeline(ctx)
        close(done)
    }()
    time.Sleep(100 * time.Millisecond) // let it run
    start := time.Now()
    cancel()
    <-done
    latency := time.Since(start)
    if latency > 200*time.Millisecond {
        t.Errorf("cancellation took %v", latency)
    }
}
```

A simple measurement test. Production pipelines should have these and a Prometheus histogram for the same metric.

### Measuring latency in production

```go
start := time.Now()
<-ctx.Done()
cancelObserved := time.Since(start) // when did this goroutine see cancel
// ... continue cleanup ...
totalLatency := time.Since(start)
metrics.CancelLatency.Observe(totalLatency.Seconds())
```

A histogram of per-goroutine cancellation latency tells you which stages are slow to exit. Combined with a stack-trace dump, you can pinpoint the offending blocking call.

### The 99th percentile matters

For shutdown SLAs, you care about the worst case, not the average. A pipeline that exits in 10 ms average but 5 seconds 99th percentile will sometimes blow the SLA. Either improve the worst case (refactor the slow path) or shorten the SLA budget.

---

## A note on `select` semantics revisited

At senior level it pays to revisit `select` precisely. Some properties that affect cancellation design:

- **Fairness**: when multiple cases are ready, Go picks at random. Over many iterations, all cases are picked roughly equally.
- **No partial readiness**: a case is either fully ready or not. A send to a buffered channel is "ready" only when the buffer has room; a receive is ready when the channel has a value (or is closed).
- **`default` makes select non-blocking**: with a default, select returns immediately if no other case is ready. This is the "try-send" idiom.
- **`nil` channel cases are never ready**: setting a channel to nil effectively disables its case. This is a clever trick for state-machine-like selects:

```go
var out chan T
if hasOutput {
    out = realChannel
}
select {
case out <- value:
case <-ctx.Done():
}
```

If `out` is nil, the send case is disabled; the select waits on `ctx.Done()` only.

- **`select` with one case is the same as a plain operation**: `select { case v := <-ch: ... }` is just `v := <-ch` with extra syntax. The compiler may optimise.

These properties combine: a multi-state stage may use nil-channel disabling to express which transitions are valid in each state, while keeping `<-ctx.Done()` always enabled.

---

## Worst-case cancellation latency: a calculation

Suppose a service has:

- An HTTP listener (Shutdown latency: bounded by `WriteTimeout`).
- A worker pool of 16 workers, each processing items in 500 ms.
- A background metrics emitter ticking every 10 seconds.
- A DB connection pool.

Worst-case cancellation latency:

- HTTP Shutdown: up to `WriteTimeout` (say 5 seconds).
- Pool drain: each worker finishes current item, up to 500 ms; in parallel, so 500 ms total.
- Metrics emitter: up to 10 seconds (next tick), unless the ticker is cancellable. With `select { case <-ctx.Done(): case <-ticker.C: }`, latency is 1 microsecond.
- DB pool close: depends on number of in-use connections; near-zero after workers finish.

Total: max(5s, 500ms, 1us, ~0) = 5 seconds. Within a 30-second SLA, comfortable.

If the worker per-item time were 30 seconds instead of 500 ms, the drain alone would blow the SLA. Mitigations: shorter per-item work, cancellation polling, or accept a longer SLA.

The discipline: enumerate the components, identify worst-case per-component latency, sum (or take max), compare to SLA.

---

## Cancellation in Streaming Systems

Streaming systems — ones where the data flows continuously rather than in discrete requests — have specific cancellation challenges.

### Endless streams

A Kafka consumer, a server-sent events stream, a WebSocket connection: all of these produce data indefinitely. Cancellation is the only way to stop them.

```go
func consumeKafka(ctx context.Context, topic string) error {
    consumer := newConsumer(topic)
    defer consumer.Close()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        msg, err := consumer.Poll(ctx, 100*time.Millisecond)
        if err != nil {
            if errors.Is(err, context.Canceled) {
                return err
            }
            log.Println("poll:", err)
            continue
        }
        if msg == nil {
            continue // poll timeout
        }
        if err := process(ctx, msg); err != nil {
            return err
        }
    }
}
```

The poll-based design lets the consumer check `ctx` regularly. A push-based design would need a watcher goroutine to cancel via `consumer.Close()`.

### Stream multiplexing

A service that handles multiple streams (e.g. a chat server with many connected clients) needs per-stream cancellation. The architecture:

- One context per stream.
- Each stream's goroutine selects on its own `ctx.Done()`.
- A shutdown cancels the root context, cascading to every stream.

Cancellation latency is one select-cycle per stream, in parallel. For 10 000 streams, full shutdown is sub-millisecond if every stream selects frequently.

### Stream merging

When multiple streams feed into one output (e.g. multiple message queues into one processor), each input has its own cancellation. The merged output cancellation fires when the parent context cancels.

```go
g, ctx := errgroup.WithContext(parent)
merged := make(chan Event, 64)
for _, src := range sources {
    src := src
    g.Go(func() error {
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case ev := <-src.Receive():
                select {
                case merged <- ev:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
        }
    })
}
// closer
go func() {
    _ = g.Wait()
    close(merged)
}()
```

Each source has its own goroutine; the merged channel is closed after all sources exit. Cancellation reaches every source via `ctx.Done()`.

---

## Streaming systems: detailed patterns

### Pattern: cursor-based pagination with cancellation

A pipeline reads from a paginated source (e.g. a DB cursor or a paginated API). Each page is a batch.

```go
func paginate(ctx context.Context, src Source) <-chan []Row {
    out := make(chan []Row)
    go func() {
        defer close(out)
        cursor := ""
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
            page, nextCursor, err := src.Fetch(ctx, cursor)
            if err != nil {
                return
            }
            if len(page) == 0 {
                return
            }
            select {
            case out <- page:
            case <-ctx.Done():
                return
            }
            if nextCursor == "" {
                return
            }
            cursor = nextCursor
        }
    }()
    return out
}
```

Each page is fetched with the context (so the fetch is cancellable). The send is `select`-guarded. The cursor logic carries forward; on cancellation, the cursor is lost — next run starts over (or resumes from a checkpoint if you store one).

### Pattern: checkpointed streaming

The pipeline periodically writes its progress to a durable store, so restart can resume from the checkpoint.

```go
func checkpointed(ctx context.Context, src Source, ckpt Checkpoint) error {
    cursor, _ := ckpt.Load(ctx)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        page, next, err := src.Fetch(ctx, cursor)
        if err != nil {
            return err
        }
        if len(page) == 0 {
            return nil
        }
        if err := process(ctx, page); err != nil {
            return err
        }
        if err := ckpt.Save(ctx, next); err != nil {
            return err
        }
        cursor = next
    }
}
```

On cancellation, the most recent checkpoint is preserved. Restart resumes from there. The pipeline has "at-least-once" semantics: pages may be processed twice (the one in flight when cancelled).

### Pattern: streaming with replay

The pipeline emits a stream; consumers can request a replay from a point in the past:

```go
type Stream struct {
    history []Event
    mu      sync.Mutex
    subs    map[chan Event]int // last index sent to this sub
}

func (s *Stream) Subscribe(ctx context.Context, fromIdx int) <-chan Event {
    ch := make(chan Event, 16)
    s.mu.Lock()
    s.subs[ch] = fromIdx
    s.mu.Unlock()
    go func() {
        <-ctx.Done()
        s.mu.Lock()
        delete(s.subs, ch)
        close(ch)
        s.mu.Unlock()
    }()
    go s.replay(ctx, ch, fromIdx)
    return ch
}

func (s *Stream) replay(ctx context.Context, ch chan Event, fromIdx int) {
    s.mu.Lock()
    history := append([]Event{}, s.history[fromIdx:]...)
    s.mu.Unlock()
    for _, e := range history {
        select {
        case ch <- e:
        case <-ctx.Done():
            return
        }
    }
}
```

Each subscriber has its own goroutine for replay; cancellation aborts the replay and removes the subscriber. The shared history is protected by a mutex.

This is a sketch; production replay systems are more sophisticated (paged history, retention policies, durable log). The cancellation principles are the same.

---

## Race-Free Shutdown Protocols

Shutdown is where races love to hide. A few patterns to keep things safe.

### Close before cancel? Or cancel before close?

If the producer owns the channel close and respects context, cancel-then-close is the natural order: producers see cancellation and return, their `defer close(out)` runs.

If you close the channel from outside the producer, you risk a double-close (panic) or close-while-sending (panic). Always close from the producing goroutine.

### Race: cancel after producer already closed

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    defer close(out)
    for _, v := range items {
        select {
        case out <- v:
        case <-ctx.Done():
            return
        }
    }
}()
// ... consumer ranges out, exits when items exhausted ...
cancel() // safe — cancel is idempotent, producer already exited
```

`cancel` after the producer has already finished is fine — the cancel is a no-op for the already-completed goroutine.

### Race: dual-write to a channel

```go
go func() { out <- 1 }()
go func() { out <- 2 }()
// who closes out?
```

If both close, panic. If neither closes, range hangs. Solution: use `WaitGroup`, wait for both senders, then a separate closer closes.

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); out <- 1 }()
go func() { defer wg.Done(); out <- 2 }()
go func() { wg.Wait(); close(out) }()
```

Now `close(out)` runs exactly once, after both sends complete. The receiver ranges and exits naturally.

### Race: cancel and close interleaving

```go
go func() {
    defer close(out)
    for v := range in {
        select {
        case out <- v:
        case <-ctx.Done():
            return
        }
    }
}()

cancel()
close(in) // <-- BUG: producer (this goroutine) does not close in, the upstream does
```

The fix is structural: do not close channels you do not own. The upstream stage owns `in`; when it sees cancellation, it closes `in`. This stage merely consumes.

### The "happy path" close ordering

In a pipeline with N stages, the close ordering on cancellation is:

1. Cancel fires.
2. Stage 1 sees `ctx.Done()`, returns, `defer close(out1)` runs.
3. Stage 2's `range out1` ends, returns, `defer close(out2)` runs.
4. ... etc.
5. The final consumer's `range` ends.

The cascade is sequential because each stage waits for the previous one to close. This is the natural flow; you should not need to manually order it.

If your design requires manual ordering (because some stages do not respect context), refactor those stages first.

---

## Race-free protocols: the "stop-the-world" pattern

For some shutdown scenarios you want every goroutine to acknowledge cancellation before proceeding. The pattern: each goroutine sends on a "stopped" channel after observing cancellation; the coordinator waits for N acks.

```go
type World struct {
    ctx     context.Context
    cancel  context.CancelFunc
    workers []chan struct{}
}

func (w *World) AddWorker() chan struct{} {
    stopped := make(chan struct{})
    w.workers = append(w.workers, stopped)
    return stopped
}

func (w *World) Stop() {
    w.cancel()
    for _, c := range w.workers {
        <-c
    }
}

// Each worker:
func work(ctx context.Context, stopped chan struct{}) {
    defer close(stopped)
    // ... loop with select on ctx.Done() ...
}
```

`Stop` waits for every worker to close its `stopped` channel. This is essentially what `sync.WaitGroup` does, but with explicit per-worker channels for visibility.

Variant: each worker logs its name when it stops:

```go
func work(ctx context.Context, stopped chan struct{}, name string) {
    defer close(stopped)
    defer log.Printf("%s stopped", name)
    // ...
}
```

You see the order of stops, useful for debugging slow drains.

### When per-worker channels beat `WaitGroup`

`WaitGroup` is simpler when you only need to know "all done." Per-worker channels are better when:

- You want to know *which* worker is slow.
- You need to time-out per worker rather than collectively.
- You want to log or instrument per-worker drain time.

For very large fleets of workers (thousands), `WaitGroup` is cheaper. For small fleets with debugging needs, per-worker channels add observability.

### Coordinated shutdown via barriers

Sometimes shutdown happens in stages: every worker must reach "phase 1 done" before any moves to "phase 2." This is a barrier.

```go
type Barrier struct {
    n      int
    waitCh chan struct{}
}

func (b *Barrier) Wait(ctx context.Context) error {
    select {
    case b.waitCh <- struct{}{}:
        b.n--
        if b.n == 0 {
            close(b.waitCh)
        }
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A coarse implementation. Use `sync.WaitGroup` or `golang.org/x/sync/syncutil` for production. The cancellation principle is: even barriers must be cancellable, otherwise stuck workers cause deadlock on the barrier.

---

## Cancellation and Resource Lifetime

Goroutines hold resources: file handles, database connections, locks, allocated memory. Cancellation must release them.

### Resources released by `defer`

```go
go func() {
    f, err := os.Open(path)
    if err != nil {
        return
    }
    defer f.Close()
    // ... use f, respecting ctx ...
}()
```

`f.Close` runs whether the goroutine exits normally or on cancellation. The `defer` is the cleanup contract.

### Resources held across `select` iterations

```go
go func() {
    conn, _ := pool.Get(ctx)
    defer pool.Put(conn)
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            useConn(conn, j)
        }
    }
}()
```

The connection is held for the goroutine's lifetime; `defer pool.Put` returns it on exit, including cancellation. This is the right shape for long-lived workers with pooled resources.

### Resources held for one item

If the resource is per-item (e.g. a transaction per job), acquire and release per iteration:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case j := <-jobs:
        tx, err := db.BeginTx(ctx, nil)
        if err != nil {
            return err
        }
        err = process(ctx, tx, j)
        if err != nil {
            tx.Rollback()
            return err
        }
        if err := tx.Commit(); err != nil {
            return err
        }
    }
}
```

Each job has its own transaction; cancellation mid-job rolls back via `Rollback()`. The cancellation cleanup is per-item, not per-goroutine.

### Cancellation under lock

A goroutine holding a `sync.Mutex` cannot easily release it on cancellation:

```go
mu.Lock()
defer mu.Unlock()
// blocking call here is uninterruptible
heavyWork(ctx) // ctx is checked, but the lock is held
```

If `heavyWork` is cancellable, the goroutine returns mid-work, releasing the lock via `defer`. But while the lock is held, other goroutines waiting on it cannot make progress. This is the standard lock-contention problem; cancellation does not solve it.

The mitigation: hold locks only briefly. Do the heavy work outside the critical section. This is good practice generally and is mandatory for cancellable code.

### Cancellation and goroutine-local state

A goroutine that accumulates state (a buffer, a map) loses that state on cancellation. If the state should survive, send it somewhere before exiting:

```go
go func() {
    var buf []byte
    defer func() {
        select {
        case results <- buf:
        case <-time.After(time.Second):
            log.Println("could not deliver buffer on shutdown")
        }
    }()
    // ... accumulate into buf ...
}()
```

On exit (including cancellation), the buffer is delivered via the `results` channel. The fallback `time.After` prevents the goroutine from hanging if no one is reading.

---

## Cancellation in batch systems vs streaming systems

A batch system processes a finite input and exits. A streaming system processes an unbounded input continuously. They handle cancellation differently.

### Batch

The input is finite, so cancellation is the only abnormal exit. The "normal" exit is "input exhausted." After cancellation, the batch may be partially complete; the next run starts fresh or resumes from a checkpoint.

```go
func batch(ctx context.Context, inputs []Input) error {
    for _, in := range inputs {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        if err := process(ctx, in); err != nil {
            return err
        }
    }
    return nil
}
```

Simple loop; checks cancel each iteration. On cancellation, returns early. On completion, returns nil.

### Streaming

The input is infinite, so cancellation is the only exit. The pipeline runs until cancelled.

```go
func stream(ctx context.Context, src Source) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        ev, err := src.Next(ctx)
        if err != nil {
            return err
        }
        if err := process(ctx, ev); err != nil {
            return err
        }
    }
}
```

The streaming version has no natural completion; cancellation is the design's primary exit mechanism. State preservation (checkpoints) is therefore more important — without them, every cancellation restarts from the beginning.

### Hybrid

Many production systems are hybrids: a stream of inputs, but each "session" or "window" is a batch.

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case window := <-windows:
        if err := processWindow(ctx, window); err != nil {
            return err
        }
    }
}
```

Each window is batch-like; the outer loop is stream-like. Cancellation can interrupt mid-window (partial window processed) or between windows (cleaner).

---

## Cancellation in stateful pipelines: state externalisation

A stateless pipeline can be cancelled and restarted trivially. A stateful pipeline has internal state (counters, buffers, aggregations) that is lost on cancellation. Two options:

### Option 1: accept the loss

For ephemeral state (running counters, in-memory caches), losing it on cancellation is fine. The next run starts fresh.

### Option 2: externalise the state

Periodically persist the state to a durable store. On restart, load it.

```go
func aggregator(ctx context.Context, in <-chan Event, store StateStore) error {
    state, err := store.Load(ctx)
    if err != nil {
        return err
    }
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            // best-effort save before exit
            saveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
            defer cancel()
            return store.Save(saveCtx, state)
        case ev := <-in:
            state.Apply(ev)
        case <-ticker.C:
            if err := store.Save(ctx, state); err != nil {
                log.Println("save:", err)
            }
        }
    }
}
```

The state is saved periodically and once more on cancellation (using a detached `context.Background` so the save runs even after the original `ctx` cancelled).

### Option 3: write-ahead log

The pipeline writes each event to a durable log before processing. On restart, replay the log up to the last checkpoint and resume.

This is a heavy pattern; typical for transactional systems. The cancellation principle: the log must be flushed before processing acknowledges; the checkpoint must be advanced atomically with processing.

---

## Cancellation in databases and connection pools

The `database/sql` package and connection pools have their own cancellation behaviour worth understanding.

### `sql.DB.QueryContext`

The query is sent with a cancellation signal. The driver acknowledges and forwards to the database. The database aborts the query and returns "query cancelled" to the driver. The driver returns `context.Canceled` to the caller.

The connection used by the query is returned to the pool. If the cancellation happens after the query completed (rare race), the result is still consumed and the connection is returned cleanly.

### `sql.DB.BeginTx`

Starts a transaction tied to the context. On cancel, the driver issues a rollback. The connection is returned to the pool. Subsequent calls on the `*sql.Tx` return errors.

### Connection pool exhaustion

If all connections are in use and a new query waits for one, the wait is cancellable:

```go
rows, err := db.QueryContext(ctx, query)
```

If `ctx` cancels while waiting for a connection, the function returns `ctx.Err()`. No connection is acquired.

This is critical for resilience: if downstream is slow and connections are exhausted, requests fail fast rather than backing up indefinitely.

### Long-running queries

A query that takes a long time (e.g. a complex analytical query) should have a tight timeout:

```go
queryCtx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
rows, err := db.QueryContext(queryCtx, query)
```

Without the timeout, a misbehaving query could hold a connection for hours, blocking other requests.

---

## Choosing the Right Abstraction

For each part of a system, choose the simplest cancellation primitive that suffices.

| Need | Use |
|------|-----|
| Single producer, single consumer, one-shot | `context.WithCancel` |
| Producer with timeout | `context.WithTimeout` |
| Producer with absolute deadline | `context.WithDeadline` |
| N siblings, cancel on first error, wait for all | `errgroup.WithContext` |
| Bounded fan-out | `errgroup.SetLimit` |
| Signal-driven cancel | `signal.NotifyContext` |
| Side-effect on cancel | `context.AfterFunc` |
| Custom cancel reason | `context.WithCancelCause` + `context.Cause` |
| Detached sub-task | `context.WithoutCancel` |
| Per-subscriber done channel | manual `chan struct{}` |
| Cross-process cancellation | RPC framework (gRPC) or queue protocol |

The trap is overusing the heavier abstractions. A small private pipeline does not need `errgroup`; a single `chan struct{}` may be enough. Conversely, a public API surface should use `context.Context` for ecosystem compatibility, even if a done channel would technically suffice.

---

## Designing APIs with cancellation in mind

A public API exposes goroutines and resources. The cancellation contract should be explicit.

### Function APIs

Every blocking function takes `ctx context.Context` as the first parameter:

```go
func (s *Service) GetUser(ctx context.Context, id string) (*User, error)
```

The contract: `GetUser` returns by the time `ctx` cancels (within some bounded latency). The caller knows that cancellation is supported and that the function will respect it.

### Stream APIs

A function that returns a channel should document:

- What cancels the producer goroutine.
- When the channel closes.
- Whether the caller must drain the channel.

```go
// Subscribe returns a channel of events. The channel is closed when ctx
// cancels or the subscription source terminates. The caller need not drain
// the channel; remaining values are discarded by the producer.
func (s *Subscription) Subscribe(ctx context.Context) <-chan Event
```

Without these notes, readers must reverse-engineer the lifecycle from code.

### Component APIs

A long-lived component should expose `Run/Stop` or similar:

```go
type Worker interface {
    Run(ctx context.Context) error  // blocks until ctx cancels or error
    Close() error                    // immediate, idempotent shutdown
}
```

The caller decides whether to use the context cancellation or the explicit `Close`. Both should work; usually one is the primary path.

### Avoid:

- Returning channels without documenting close semantics.
- Spawning hidden goroutines from constructors. Use `Run` instead, called by the user.
- Storing `ctx` in struct fields without making it explicit in the API.

---

## Cancellation in event-sourced systems

An event-sourced system reads events from a log, processes them, and updates state. Cancellation must preserve the log's progress.

```go
func processEvents(ctx context.Context, log EventLog, state State) error {
    cursor, _ := state.LoadCursor(ctx)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        events, next, err := log.Read(ctx, cursor, 100)
        if err != nil {
            return err
        }
        for _, ev := range events {
            if err := state.Apply(ctx, ev); err != nil {
                return err
            }
        }
        if err := state.SaveCursor(ctx, next); err != nil {
            return err
        }
        cursor = next
    }
}
```

The cursor is the "we have processed up to here" mark. After cancellation, the next run starts from `cursor` — events between `cursor` and the cancel point are reprocessed. The state must be idempotent (applying the same event twice has the same effect).

This is at-least-once delivery. Most event-sourced systems are built this way; exactly-once requires more complex coordination (two-phase commits, transactional logs).

---

## A long worked example: a CDC pipeline

Change Data Capture: a service that watches a source database, captures changes, transforms them, and emits to a destination. Cancellation must handle:

- Source connection loss.
- Destination unavailable.
- Service shutdown.
- Per-message timeouts.

```go
type CDC struct {
    source Source
    dest   Destination
    state  StateStore
    cfg    Config

    ctx    context.Context
    cancel context.CancelCauseFunc
}

func New(parent context.Context, cfg Config, src Source, dst Destination, state StateStore) *CDC {
    ctx, cancel := context.WithCancelCause(parent)
    return &CDC{
        source: src, dest: dst, state: state, cfg: cfg,
        ctx: ctx, cancel: cancel,
    }
}

func (c *CDC) Run() error {
    g, ctx := errgroup.WithContext(c.ctx)

    events := make(chan Event, c.cfg.BufferSize)
    transformed := make(chan Event, c.cfg.BufferSize)

    g.Go(func() error { return c.runSource(ctx, events) })
    g.Go(func() error { return c.runTransform(ctx, events, transformed) })
    g.Go(func() error { return c.runSink(ctx, transformed) })
    g.Go(func() error { return c.runCheckpoint(ctx) })

    return g.Wait()
}

func (c *CDC) Stop(reason error) {
    c.cancel(reason)
}

func (c *CDC) runSource(ctx context.Context, out chan<- Event) error {
    defer close(out)
    cursor, _ := c.state.Load(ctx, "source")
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        batch, next, err := c.source.Fetch(ctx, cursor, c.cfg.BatchSize)
        if err != nil {
            return fmt.Errorf("source: %w", err)
        }
        if len(batch) == 0 {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(c.cfg.PollInterval):
            }
            continue
        }
        for _, ev := range batch {
            select {
            case out <- ev:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        cursor = next
        c.state.Save(ctx, "source", cursor)
    }
}

func (c *CDC) runTransform(ctx context.Context, in <-chan Event, out chan<- Event) error {
    defer close(out)
    for ev := range in {
        result, err := c.transform(ctx, ev)
        if err != nil {
            return fmt.Errorf("transform: %w", err)
        }
        select {
        case out <- result:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}

func (c *CDC) runSink(ctx context.Context, in <-chan Event) error {
    for ev := range in {
        sinkCtx, cancel := context.WithTimeout(ctx, c.cfg.SinkTimeout)
        err := c.dest.Write(sinkCtx, ev)
        cancel()
        if err != nil {
            return fmt.Errorf("sink: %w", err)
        }
    }
    return nil
}

func (c *CDC) runCheckpoint(ctx context.Context) error {
    ticker := time.NewTicker(c.cfg.CheckpointInterval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            // best-effort final checkpoint
            saveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
            defer cancel()
            return c.flushCheckpoint(saveCtx)
        case <-ticker.C:
            if err := c.flushCheckpoint(ctx); err != nil {
                log.Println("checkpoint:", err)
            }
        }
    }
}

func (c *CDC) transform(ctx context.Context, ev Event) (Event, error) { return ev, nil }
func (c *CDC) flushCheckpoint(ctx context.Context) error             { return nil }

type Source interface {
    Fetch(ctx context.Context, cursor string, batchSize int) ([]Event, string, error)
}

type Destination interface {
    Write(ctx context.Context, ev Event) error
}

type StateStore interface {
    Load(ctx context.Context, key string) (string, error)
    Save(ctx context.Context, key, value string) error
}

type Event struct{}

type Config struct {
    BufferSize         int
    BatchSize          int
    PollInterval       time.Duration
    SinkTimeout        time.Duration
    CheckpointInterval time.Duration
}
```

Cancellation analysis:

- Every stage has `ctx` and respects it.
- Every channel send is `select`-guarded.
- The checkpoint stage has a tickle (periodic) and a final flush on shutdown (with a detached context for the flush itself).
- Each sink write has its own timeout, so a slow destination does not stall the whole pipeline.
- `errgroup` joins all four stages; first error cancels the rest.
- `context.WithCancelCause` lets the caller record the shutdown reason.

Total goroutines: 4. Total cancellation paths: every block point. Total per-component shutdown latency: bounded by the slowest stage's per-item work plus the sink timeout. For typical config: sub-second total.

---

## Testing Strategies for Production-Grade Cancellation

### Property-based testing of cancellation

```go
func TestPipelineCancelsCleanly(t *testing.T) {
    quick.Check(func(itemCount int, cancelAt int) bool {
        if itemCount < 0 || cancelAt < 0 {
            return true
        }
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        out := buildPipeline(ctx, itemCount)
        got := 0
        for v := range out {
            _ = v
            got++
            if got == cancelAt {
                cancel()
            }
        }
        return true // didn't deadlock
    }, nil)
}
```

Run with many random parameters; the property is "does not hang." Combined with `-timeout 30s`, a hang produces a panic stack trace useful for debugging.

### Race detector

Always run cancellation tests with `-race`:

```bash
go test -race -count=1 ./...
```

`-count=1` disables caching; `-race` enables the race detector. Cancellation paths often involve close-and-read patterns that race subtly.

### `goleak` for leak detection

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

After every test, `goleak` checks that no goroutines outside an expected baseline remain. If any do, the test fails with a stack trace pointing at the leak.

### Stress tests for cancellation

```go
func TestRepeatedCancel(t *testing.T) {
    for i := 0; i < 1000; i++ {
        ctx, cancel := context.WithCancel(context.Background())
        out := buildPipeline(ctx)
        time.Sleep(time.Microsecond * time.Duration(rand.Intn(100)))
        cancel()
        for range out {
        }
    }
}
```

A thousand cancellations with random timing. Reveals race conditions that single-run tests miss.

### Chaos tests for partial failures

Inject cancellation at random points and verify recovery:

```go
func TestChaosCancellation(t *testing.T) {
    for i := 0; i < 100; i++ {
        if err := withRandomCancel(t, runPipeline); err != nil {
            t.Errorf("iteration %d: %v", i, err)
        }
    }
}

func withRandomCancel(t *testing.T, fn func(context.Context) error) error {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(time.Duration(rand.Intn(100)) * time.Millisecond)
        cancel()
    }()
    return fn(ctx)
}
```

Each iteration cancels at a random time. Any iteration that deadlocks, panics, or leaves goroutines around is a bug.

---

## Architectural review checklist

Before approving a new pipeline design, run through this list:

1. **Cancellation source identified.** Where will the cancel originate? (Signal, deadline, error, manual.)
2. **Authority assigned.** Who is allowed to call `cancel`? (Orchestrator only? Each stage? External admin?)
3. **Propagation traced.** From the cancel source, the signal reaches every stage. Verified by walking the code.
4. **Latency budgeted.** Per-stage worst-case time is known. Sum is below SLA.
5. **External I/O cancellable.** Every external call uses context-aware variants.
6. **Drain protocol defined.** What happens to in-flight values on cancel? Documented decision.
7. **Resource release ordered.** Outside-in: stop accepting, drain work, release resources.
8. **State preservation considered.** Stateful pipelines have checkpoint/restore.
9. **Cause propagation wired.** `WithCancelCause` for debuggability.
10. **Tests cover cancellation paths.** Race detector, leak detector, chaos tests.

This is the same level of rigour you would apply to capacity planning or security review. Cancellation is a load-bearing wall, not a finishing touch.

---

## Advanced testing: fault injection

To test cancellation in the presence of failures, inject controlled errors:

```go
type FlakySource struct {
    Source
    FailEvery int
    counter   int
}

func (f *FlakySource) Fetch(ctx context.Context, cursor string, n int) ([]Event, string, error) {
    f.counter++
    if f.counter%f.FailEvery == 0 {
        return nil, "", errors.New("transient")
    }
    return f.Source.Fetch(ctx, cursor, n)
}
```

Wrap the real source; every Nth call fails. The pipeline's error handling and cancellation behaviour can be tested with predictable failures.

Patterns to test:

- Source returns error after K items. Verify the pipeline cancels cleanly.
- Sink hangs for longer than its timeout. Verify the sink stage cancels and the pipeline continues (or fails, depending on policy).
- Cancellation arrives mid-batch. Verify partial-batch handling.
- Cancellation arrives during a checkpoint. Verify the checkpoint state is consistent.

### Test: cancellation during checkpoint

```go
func TestCancelDuringCheckpoint(t *testing.T) {
    store := &FlakyState{
        Real:      &MemState{},
        BlockSave: true,
        Unblock:   make(chan struct{}),
    }
    ctx, cancel := context.WithCancel(context.Background())
    cdc := New(ctx, defaultConfig(), &MemSource{}, &MemSink{}, store)
    go cdc.Run()

    // Wait until the first save is in flight
    <-store.SaveStarted

    // Cancel; the save is mid-flight
    cancel()

    // Unblock the save
    close(store.Unblock)

    // Wait for shutdown
    <-cdc.Done()

    // Verify the state is consistent
    if store.SavedValue != store.ExpectedValue {
        t.Errorf("inconsistent state")
    }
}
```

The fixture lets us hold the save mid-flight, cancel, and then release. Verifies that the cancellation does not corrupt the state.

### Test: cancellation with `goleak`

```go
func TestCDCNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    for i := 0; i < 10; i++ {
        ctx, cancel := context.WithCancel(context.Background())
        cdc := New(ctx, defaultConfig(), &MemSource{}, &MemSink{}, &MemState{})
        go cdc.Run()
        time.Sleep(10 * time.Millisecond)
        cancel()
        <-cdc.Done()
    }
}
```

After ten cycles, `goleak.VerifyNone` checks that no goroutines outside the baseline remain.

---

## Patterns from the Standard Library

A short tour of `context.Context` usage inside the standard library.

### `net/http.Request.Context`

Returns the context for the request. Cancelled on client disconnect or server shutdown. Every handler should pass this context through to downstream calls.

### `database/sql.DB.QueryContext`

Accepts a context that cancels the query if it cancels. The driver issues a cancel message to the database. The result `*sql.Rows` is implicitly tied to the context: `rows.Next()` returns false and `rows.Err()` returns the cancellation reason.

### `os/exec.CommandContext`

Creates a `Cmd` whose `Process` is killed when the context cancels. Useful for spawning subprocesses with a timeout.

### `net.Dialer.DialContext`

Dials a network connection with cancellation. The connection attempt aborts when the context cancels.

### `crypto/tls.Conn` handshake

Uses the context from the underlying `net.Conn`. If you wrap a TLS conn around a connection with a cancellable context, the handshake aborts on cancel.

### `io.Reader` with `context`

There is no standard `io.Reader` that takes a context. The convention is to wrap manually with `select` and `SetReadDeadline`, as covered earlier. Some libraries (`grpc-go`, `protobuf`) provide their own context-aware wrappers.

### `time.AfterFunc`, `time.NewTimer`

Used internally by `context.WithTimeout` and `context.WithDeadline`. Cancelling the context calls `timer.Stop()`. Without that, the timer leaks until it fires.

The pattern across the standard library: every blocking call has a context-aware variant. Use them.

---

## Cancellation and metrics: a deep dive

Production cancellation observability is a topic in its own right. Done right, it makes shutdown debuggable. Done wrong, you have a system that stops mysteriously.

### The four core metrics

1. **Goroutine count gauge.** `runtime.NumGoroutine()` over time. Drift up = leak. Sudden drop on shutdown = healthy. Plateau = either steady-state or leak under high churn.

2. **Cancellation latency histogram.** Time from `cancel()` to last-goroutine-exited, per pipeline. Tail latencies tell you which pipelines have slow stages.

3. **Cancellation rate counter, by cause.** Cancel events grouped by reason (`context.Canceled` via client disconnect, `context.DeadlineExceeded` via timeout, custom causes). Shifts indicate upstream or downstream changes.

4. **In-flight count gauge.** Active pipelines at any moment. Spikes during shutdown indicate pipelines that are slow to drain.

### Instrumentation patterns

```go
type Instrumented struct {
    inFlight    *prometheus.Gauge
    cancelByErr *prometheus.CounterVec
    duration    *prometheus.Histogram
}

func (i *Instrumented) RunPipeline(ctx context.Context) error {
    i.inFlight.Inc()
    defer i.inFlight.Dec()
    start := time.Now()
    err := actualPipeline(ctx)
    i.duration.Observe(time.Since(start).Seconds())
    if err != nil {
        switch {
        case errors.Is(err, context.Canceled):
            i.cancelByErr.WithLabelValues("canceled").Inc()
        case errors.Is(err, context.DeadlineExceeded):
            i.cancelByErr.WithLabelValues("deadline").Inc()
        default:
            i.cancelByErr.WithLabelValues("other").Inc()
        }
    }
    return err
}
```

A small decorator. Every pipeline run is observed.

### Alerts to set

- **Goroutine count drift.** If `rate(go_goroutines[1h]) > 100`, alert. Healthy services hover; leaks climb.
- **Cancellation rate spike.** If `cancel_count` doubles over 5 minutes, alert. Indicates upstream timeouts or client impatience.
- **Shutdown latency.** If shutdown takes longer than expected, alert (this is harder to wire up but very valuable).
- **In-flight count during shutdown.** If in-flight is still > 0 after `cancel()`, alert with a stack dump.

### Tracing cancellation

Distributed tracing (OpenTelemetry) can capture cancellation events as span events:

```go
span.AddEvent("pipeline cancelled", trace.WithAttributes(
    attribute.String("cause", causeStr),
))
```

In the trace UI you see the cancellation as a discrete event on the timeline, with the cause attached. Excellent for debugging "where did the request stop?"

---

## Patterns from major Go projects

### Kubernetes `apimachinery`

Kubernetes uses `context.Context` throughout. The `Reflector`, `Informer`, and `Cache` components all accept `context.Context` and respect cancellation. The pattern: long-running watchers loop on `ctx.Done()` and on the watch event channel.

The lessons from Kubernetes:

- Long-lived watchers should restart on transient errors (the `Reflector.ListAndWatch` does this with backoff).
- Cancellation must propagate through deep stacks (watcher -> informer -> cache -> consumer).
- Shutdown is graceful: existing watchers drain, new ones do not start.

### `etcd`

`etcd`'s client library uses context heavily. `clientv3.Watch` returns a channel of events that is closed when the context cancels. The implementation manages a goroutine per watcher and ensures it exits on cancel.

The lessons:

- Watcher cancellation must terminate the underlying RPC stream.
- The client library hides the goroutine management from the caller — the caller sees a channel that "just works."

### `Prometheus`

Prometheus's scrape system has a pool of scrapers, each running on a target. Each scraper has a deadline (the scrape interval) and respects cancellation for shutdown.

The lessons:

- Per-task deadlines via `context.WithTimeout` prevent slow targets from blocking the pool.
- A shared context cancels the whole pool on shutdown.

### Standard library `database/sql`

The `database/sql` package has cancellation built into every blocking method. `QueryContext`, `ExecContext`, `BeginTx`, `Conn`. The driver is responsible for translating the cancel into a backend-specific signal.

The lessons:

- Cancellation at the highest layer must reach the lowest layer (driver-to-database).
- The cost of context support is small (a few atomic loads); the benefit is enormous.

---

## Cancellation and circuit breakers

A circuit breaker prevents a service from hammering a failing dependency. Cancellation interacts with it:

```go
type Breaker struct {
    mu       sync.Mutex
    state    string
    failures int
    opened   time.Time
}

func (b *Breaker) Call(ctx context.Context, fn func(context.Context) error) error {
    b.mu.Lock()
    if b.state == "open" && time.Since(b.opened) < time.Minute {
        b.mu.Unlock()
        return errors.New("circuit open")
    }
    b.mu.Unlock()

    err := fn(ctx)
    b.recordResult(err)
    return err
}
```

When the circuit is open, calls fail fast without invoking `fn`. The context is respected — if `ctx` cancels, the function returns early. If the circuit is closed and `fn` is in progress, `fn` itself should respect `ctx`.

The cancellation interaction: a cancelled call should not count as a failure for the circuit breaker (it was not the dependency's fault). Filter:

```go
func (b *Breaker) recordResult(err error) {
    if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
        return // do not count cancellations
    }
    // ... record failure or success ...
}
```

Without this filter, every client disconnect counts as a backend failure, and the circuit opens spuriously.

---

## Anti-Patterns at Scale

A catalogue of cancellation anti-patterns that work at small scale but fail in production.

### Anti-pattern: `time.Sleep` for delay

```go
time.Sleep(time.Second)
```

Uninterruptible. The goroutine sleeps a full second even if cancellation fires after 1 ms. Multiply across many goroutines and shutdown takes seconds.

Fix:

```go
select {
case <-ctx.Done():
    return
case <-time.After(time.Second):
}
```

### Anti-pattern: detached "fire-and-forget" with no cancellation

```go
go cleanup()
```

`cleanup` is unbounded. If it blocks, the goroutine leaks. Pass a context:

```go
go cleanup(longLivedCtx)
```

### Anti-pattern: ignoring `ctx.Err()` after a range

```go
for v := range out {
    use(v)
}
// no check of ctx.Err()
```

If the range ended because of cancellation, you may want to return an error rather than success. Always check.

### Anti-pattern: per-iteration `context.WithTimeout` in a loop

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
    defer cancel() // <-- BUG: defers stack up
    process(ctx, item)
}
```

`defer cancel()` runs at function exit, not loop iteration exit. The cancels stack; all timers stay alive. Fix:

```go
for _, item := range items {
    func() {
        ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
        defer cancel()
        process(ctx, item)
    }()
}
```

### Anti-pattern: storing `ctx` in a struct field

```go
type Worker struct {
    ctx context.Context
}
func (w *Worker) Do() { use(w.ctx) }
```

The context is hidden; readers cannot trace lifetime. Per-method `ctx` parameters are clearer.

There are narrow exceptions (e.g. an HTTP middleware that stores the request context for the duration of one request), but they should be the exception.

### Anti-pattern: not propagating cancellation cause

```go
cancel()
// later: why was this cancelled?
```

`ctx.Err()` returns `context.Canceled`, which says nothing about the reason. Use `WithCancelCause`:

```go
cancel(myError)
// ...
if cause := context.Cause(ctx); cause != nil { ... }
```

### Anti-pattern: cancelling but not waiting

```go
cancel()
return
```

Goroutines have been signalled but not joined. They may still be running, holding resources. Pair with `WaitGroup` or `errgroup.Wait`.

### Anti-pattern: assuming cancel is instant

```go
cancel()
db.Close() // BUG: workers may still be using db
```

The cancel signals; the workers eventually exit. Until they exit, they may still touch `db`. Wait for them before closing shared resources.

### Anti-pattern: cancel inside a tight inner loop

```go
for i := 0; i < 1_000_000; i++ {
    select {
    case <-ctx.Done():
        return
    default:
    }
    process(i)
}
```

The select with `default` makes this non-blocking and turns it into a busy-poll of `ctx.Done()`. It works (cancellation latency is the per-iteration time), but the `default` is wasteful. Better:

```go
for i := 0; i < 1_000_000; i++ {
    if i%1024 == 0 {
        if ctx.Err() != nil {
            return
        }
    }
    process(i)
}
```

A direct `ctx.Err()` check every 1024 iterations is cheaper and clearer.

---

## A taxonomy of cancellation policies

When designing a system, you choose a cancellation policy. Some common ones:

### Policy: fail-fast on first error

Every error is fatal. The first cancellation triggers shutdown of the whole pipeline.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(work1)
g.Go(work2)
return g.Wait() // returns first error
```

Suitable for transactional pipelines, ETL jobs where partial output is useless.

### Policy: best-effort

Errors are isolated. Other goroutines continue.

```go
errs := make([]error, len(items))
var wg sync.WaitGroup
for i, item := range items {
    i, item := i, item
    wg.Add(1)
    go func() {
        defer wg.Done()
        errs[i] = process(ctx, item)
    }()
}
wg.Wait()
return errors.Join(errs...)
```

Suitable for fan-out where each task is independent (e.g. notifying N destinations).

### Policy: bounded retries then fail

Retry on transient errors; fail after K attempts.

```go
for attempt := 0; attempt < 3; attempt++ {
    err := fn(ctx)
    if err == nil { return nil }
    if !isTransient(err) { return err }
    if ctx.Err() != nil { return ctx.Err() }
    backoff(ctx, attempt)
}
return ErrMaxAttempts
```

Suitable for unreliable external calls.

### Policy: degraded mode

On cancellation, return a partial result rather than an error.

```go
result := partial()
defer func() {
    if ctx.Err() != nil {
        // log but return partial
    }
}()
return result
```

Suitable for search-as-you-type, recommendation systems, where any result is better than none.

### Policy: hard isolation

Per-tenant or per-shard contexts that cancel independently. One tenant's failure does not cascade.

```go
for tenant, tenantData := range tenants {
    tenantCtx, cancel := context.WithCancel(ctx)
    go func() {
        defer cancel()
        runForTenant(tenantCtx, tenant, tenantData)
    }()
}
```

Suitable for multi-tenant SaaS.

Each policy has different cancellation semantics. The architect chooses; the implementation follows.

---

## Cancellation in concurrent data structures

A concurrent data structure (a thread-safe map, a queue, a worker pool) should support cancellation in its blocking operations.

### Concurrent map with TTL

```go
type TTLMap struct {
    mu      sync.RWMutex
    data    map[string]entry
    ctx     context.Context
}

type entry struct {
    value   any
    expires time.Time
}

func New(ctx context.Context) *TTLMap {
    m := &TTLMap{
        data: map[string]entry{},
        ctx:  ctx,
    }
    go m.evictor()
    return m
}

func (m *TTLMap) evictor() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-m.ctx.Done():
            return
        case <-ticker.C:
            m.evictExpired()
        }
    }
}

func (m *TTLMap) Get(key string) (any, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    e, ok := m.data[key]
    if !ok || time.Now().After(e.expires) {
        return nil, false
    }
    return e.value, true
}

func (m *TTLMap) Set(key string, value any, ttl time.Duration) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.data[key] = entry{value: value, expires: time.Now().Add(ttl)}
}

func (m *TTLMap) evictExpired() {
    m.mu.Lock()
    defer m.mu.Unlock()
    now := time.Now()
    for k, e := range m.data {
        if now.After(e.expires) {
            delete(m.data, k)
        }
    }
}
```

The map has a background evictor goroutine tied to a context. The context lives for the map's lifetime; cancel it (e.g. on service shutdown) and the evictor exits.

The lesson: any data structure that spawns goroutines (evictors, refreshers, monitors) should accept a context in its constructor.

### Concurrent priority queue with blocking Pop

```go
type PQ struct {
    mu     sync.Mutex
    items  []Item
    notify chan struct{}
}

func (q *PQ) Pop(ctx context.Context) (Item, error) {
    for {
        q.mu.Lock()
        if len(q.items) > 0 {
            it := q.items[0]
            q.items = q.items[1:]
            q.mu.Unlock()
            return it, nil
        }
        wait := q.notify
        q.mu.Unlock()
        select {
        case <-wait:
            // try again
        case <-ctx.Done():
            return Item{}, ctx.Err()
        }
    }
}

func (q *PQ) Push(it Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    close(q.notify)
    q.notify = make(chan struct{})
    q.mu.Unlock()
}

type Item struct{}
```

`Pop` is cancellable: it waits on either the notify channel (which `Push` closes to broadcast) or `ctx.Done()`. When the context cancels, `Pop` returns the error.

The notify pattern (close-and-replace channel) is the standard way to implement "wake up all waiters" without `sync.Cond`. It composes cleanly with `select` and context cancellation.

---

## Cancellation Bugs in the Wild

A few cancellation bugs from real Go projects (paraphrased):

### Bug 1: HTTP handler that did not pass context

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rows, _ := db.Query("SELECT *") // <-- not QueryContext
    // ...
}
```

Symptom: under load with frequent client disconnects, DB connections accumulated. The DB pool exhausted; new requests blocked. Eventually the service died.

Fix: change `db.Query` to `db.QueryContext(r.Context(), ...)`. The DB driver then cancelled the query on client disconnect, releasing the connection.

### Bug 2: errgroup with the wrong context

```go
g, _ := errgroup.WithContext(parent)
g.Go(func() error {
    return work(parent) // <-- used parent, not the errgroup's ctx
})
```

Symptom: when one goroutine errored, siblings did not stop. They continued doing wasteful work. In one case the pipeline kept running for minutes after the error.

Fix: use the `ctx` returned by `errgroup.WithContext`.

### Bug 3: defer cancel in a loop

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel() // <-- accumulates
    process(ctx, item)
}
```

Symptom: for large item lists, defer stack grew large; on function return, thousands of cancels fired. Mostly benign but indicated a misunderstanding.

Fix: inline IIFE pattern shown above.

### Bug 4: missed cancellation on a slow consumer

```go
for v := range producer {
    slowProcess(v) // no ctx check inside; takes 30s per item
}
```

Symptom: cancellation took up to 30 seconds because the per-item process did not check `ctx`. The pipeline-level cancellation was technically correct, but per-item latency was unbounded.

Fix: pass `ctx` into `slowProcess`, poll `ctx.Err()` inside its loops.

### Bug 5: drain forgotten after cancellation

```go
cancel()
return // <-- did not drain producer's channel
```

Symptom: producer goroutine got wedged on its last send and leaked. After thousands of requests, goroutine count climbed by thousands.

Fix: cancel-then-drain pattern.

### Bug 6: closure captured stale context

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
go func() {
    work(ctx)
}()
cancel() // <-- cancels the context immediately
// goroutine sees a cancelled ctx and exits without doing useful work
```

Symptom: workers exited immediately, no work was done. The bug was a misplaced `cancel()` call.

Fix: re-arrange ordering or use `defer cancel()` at the correct scope.

These bugs all share a pattern: small mistake, large impact in production. Cancellation is not optional and not forgiving.

---

## Cancellation antipatterns at architectural level

Beyond per-line antipatterns, some are architectural.

### Antipattern: ignoring context at module boundaries

A module exposes:

```go
func (m *Module) DoSomething(input Input) (Output, error)
```

No `ctx`. Callers cannot cancel. The module is unfit for production use in a service that needs to respect request deadlines.

The fix: take `ctx` as the first parameter. Yes, it requires changes to every caller; that is the cost of correctness.

### Antipattern: synchronous cleanup on shutdown

```go
func main() {
    runServer()
    cleanup() // runs after server returns
}
```

If `cleanup` is slow, shutdown is slow. Worse, `cleanup` runs even if the server is hung. Better:

```go
func main() {
    ctx, cancel := signal.NotifyContext(...)
    defer cancel()

    g, _ := errgroup.WithContext(ctx)
    g.Go(func() error { return runServer(ctx) })
    // ... other components
    err := g.Wait()
    if err != nil { log.Println(err) }
}
```

Cleanup is per-component, runs as `defer` in each component's lifecycle. Shutdown is parallel and bounded.

### Antipattern: cancellation as the only error model

```go
g, ctx := errgroup.WithContext(parent)
// ... goroutines that return errors
err := g.Wait()
// is err the original error or context.Canceled?
```

If a goroutine errors, `errgroup` cancels; siblings see context.Canceled and may also return it. `g.Wait` returns the first error — which is the original, not the cancellation. But code that checks `errors.Is(err, context.Canceled)` may misidentify which one happened.

The fix: be specific in error handling. Check for the original error type first, then for cancellation.

### Antipattern: deep context nesting without reason

```go
ctx1, _ := context.WithCancel(parent)
ctx2, _ := context.WithCancel(ctx1)
ctx3, _ := context.WithCancel(ctx2)
ctx4, _ := context.WithCancel(ctx3)
work(ctx4)
```

Each derivation allocates and registers with the parent. If there is no semantic reason for the nesting (no per-level cancellation), flatten:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
work(ctx)
```

The nested form is sometimes necessary (per-stage deadlines) but is otherwise wasteful.

### Antipattern: cancelling the wrong scope

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func (s *Service) Cancel() { s.cancel() }

// somewhere:
service.Cancel() // cancels everything
service.DoSomething(ctx) // ctx is cancelled
```

After `Cancel`, the service is dead. Subsequent calls see a cancelled context. Sometimes that is intended; sometimes the caller does not know. Document the contract: "Cancel makes the service permanently unusable" or "Cancel signals shutdown; calls in flight complete; new calls fail."

---

## Operational lessons from real incidents

A short tour of cancellation-related incidents I (and others) have observed in production. Names changed; lessons preserved.

### Incident 1: graceful shutdown that wasn't

A service with a 30-second shutdown SLA started timing out: shutdowns took 4+ minutes. Investigation revealed that the worker pool's per-item work used `time.Sleep(time.Minute)` for a retry backoff. Cancellation could not interrupt the sleep.

Fix: replace `time.Sleep(d)` with `select { case <-ctx.Done(): case <-time.After(d): }`. The fix was a one-line change; the bug took half a day to find. Lesson: every `time.Sleep` in long-running code is a cancellation liability.

### Incident 2: pipeline that hung on disconnect

A streaming HTTP endpoint hung indefinitely when the client disconnected. Goroutine count climbed; the service eventually OOMed.

Root cause: the handler did not pass `r.Context()` to the database query. The query continued long after the client was gone; the goroutine waited on the query; the goroutine held resources.

Fix: change `db.Query` to `db.QueryContext(r.Context(), ...)`. One-line fix; weeks of growing memory before someone noticed.

### Incident 3: errgroup that did not cancel siblings

A service launched parallel API calls via errgroup. When one call returned an error, the others continued. Latency spiked; the service had to wait for the longest call rather than the first failure.

Root cause: the goroutines used the parent context, not the errgroup's context:

```go
g, _ := errgroup.WithContext(parent)
g.Go(func() error {
    return work(parent) // <-- wrong
})
```

Fix: use `gctx` from `errgroup.WithContext`. Trivial fix; the bug existed for over a year and silently doubled p99 latency.

### Incident 4: cancellation cause lost in the noise

A pipeline cancellation was traced through logs as `context canceled`, with no indication of why. Debugging required reading the full pipeline source.

Fix: use `context.WithCancelCause` and propagate the cause:

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
cancel(fmt.Errorf("upstream timeout: %w", originalErr))
// later
if cause := context.Cause(ctx); cause != nil {
    log.Printf("pipeline cancelled: %v", cause)
}
```

The cause shows up in logs immediately. Debugging time per incident dropped from hours to minutes.

### Incident 5: per-iteration `defer cancel`

A request handler created a context per item in a loop and `defer cancel`-ed. The defers stacked up; on long requests, hundreds of pending cancels accumulated. Memory grew; eventually the process restarted.

Fix: wrap the per-iteration work in an IIFE:

```go
for _, item := range items {
    func() {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        defer cancel()
        process(ctx, item)
    }()
}
```

The defer now fires per iteration. The accumulation goes away. Lesson: `defer` is per-function, not per-block.

### Incident 6: drain forgotten in shutdown

A service's shutdown cancelled and immediately closed the DB pool. Workers were in mid-query when the pool closed; queries errored out. Half the in-flight work was lost.

Fix: drain workers before closing the pool:

```go
srv.Shutdown(shutdownCtx)
pool.Drain()       // <-- added
db.Close()
```

The cancellation order is outside-in: listener, workers, resources. Get it right or risk silent data loss.

### Incident 7: cancellation with state corruption

A service's background worker periodically wrote state. On cancellation, the write was sometimes interrupted, leaving the state file half-written. Restart loaded the corrupt file and crashed.

Fix: write to a temp file and rename atomically. The rename either succeeds (new state) or does not (old state is preserved). Cancellation cannot leave the state in an intermediate form.

```go
tmp := path + ".tmp"
if err := writeFile(ctx, tmp, data); err != nil {
    return err
}
return os.Rename(tmp, path)
```

Lesson: cancellation can interrupt anywhere; design state writes to be atomic.

### Incident 8: signal handler that ignored cancel

A service installed a custom SIGTERM handler that did its own cleanup but did not cancel the root context. Background goroutines continued running; the service appeared to hang on shutdown.

Fix: use `signal.NotifyContext` to wire the signal into the context tree:

```go
ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer cancel()
```

The signal cancels `ctx`; every goroutine respecting `ctx` exits. Custom signal handlers should also call `cancel`.

---

## Diagrams

### Cancellation cascade through nested errgroups

```
parentCtx
   │
   ├─ outer errgroup (gctx)
   │     │
   │     ├─ goroutine 1 ── work(gctx)
   │     │
   │     └─ goroutine 2 ── inner errgroup (igctx, derived from gctx)
   │                          │
   │                          ├─ goroutine A ── workA(igctx)
   │                          └─ goroutine B ── workB(igctx)
   │
   │ outer.Wait() returns first non-nil error;
   │ on error, gctx cancels, which cancels igctx,
   │ which cancels both A and B.
```

### Race-free shutdown of a service

```
1. SIGTERM arrives
2. signal.NotifyContext fires; rootCtx cancels
3. main proceeds to Shutdown:
   a. srv.Shutdown(shutdownCtx) — stops listener, waits for handlers
   b. pool.Drain() — waits for workers to finish in-flight jobs
   c. rootCancel(reason) — cancels background goroutines
   d. <-metrics.Done(), <-health.Done() — wait for background tasks
   e. db.Close() — release final resources
4. main returns
```

### Cancellation latency breakdown

```
t0:           cancel() called
t0 + 1us:     ctx.Done() observed by stage 1 (via select)
t0 + 1us:     stage 1 returns; defer close(out1) fires
t0 + 2us:     stage 2's range out1 ends (closed channel)
t0 + 3us:     stage 2 returns; defer close(out2) fires
t0 + 4us:     stage 3's range out2 ends
t0 + 5us:     all goroutines exited

For tight stages, total latency is microseconds.
For stages with heavy per-item work, latency = max per-item time.
```

### Upstream vs downstream cancellation

```
Downstream:
   producer ──out──> stage1 ──out──> consumer
        │              │              │
        │              │              └─ cancel() (consumer triggers)
        └─ ctx.Done() ─┴─ ctx.Done() ─┘
        Producer and stage1 see ctx.Done(), exit.

Upstream:
   producer ──out──> stage1 ──out──> consumer
        │              │              │
        └─ cancel()    │              │
        (producer       │              │
         triggers)      │              │
        └─ ctx.Done() ─┴─ ctx.Done() ─┘
        Stage1 and consumer see ctx.Done(); their inputs also close.
```

### Supervisor tree

```
runService(ctx)
   │
   ├─ supervise(ctx, "consumer", runConsumer)
   │     └─ runConsumer (restarts on error, exits on ctx)
   │
   ├─ supervise(ctx, "scheduler", runScheduler)
   │     └─ runScheduler
   │
   └─ supervise(ctx, "server", runServer)
         └─ runServer
```

---

## Designing for change: API stability and cancellation

Cancellation should be a stable part of your public API. Breaking changes here are costly because every caller is affected.

### Stable additions

- Adding `ctx context.Context` as a new first parameter is a breaking change. Plan it carefully; sometimes the only way is a new method name (`DoCtx` alongside legacy `Do`).
- Adding a `Cancel` method to a long-running component is non-breaking.
- Adding `WithCancelCause`-style cause propagation is non-breaking if existing `ctx.Err()` semantics are preserved.

### Breaking changes to avoid

- Removing `ctx context.Context` from a method (rare; would be silly).
- Changing the semantics of an existing context (e.g. previously immortal, now cancellable).
- Tightening deadline enforcement (a previously lenient deadline now fires strictly).

### Versioning cancellation contracts

A documented contract:

```
// Subscribe returns a channel of events. The channel is closed when:
//   - ctx is cancelled (drain optional, no further events)
//   - The subscription source ends naturally (drain mandatory if you want all events)
//   - The Service is closed via Close()
//
// The function does not leak goroutines; the producer exits within
// 100ms of any of the above triggers.
```

The contract is part of the API. Document it; test it; preserve it across versions.

---

## Cancellation as observability

Cancellation events are signals about system health.

- A spike in cancellations may indicate upstream timeouts (callers giving up).
- A spike in `context.DeadlineExceeded` indicates either slow internal work or aggressive client timeouts.
- A drop in cancellations indicates clients no longer give up — either they got faster or they have higher tolerance.

Building cancellation metrics into a service surfaces issues earlier:

```go
var (
    cancelByCause = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "pipeline_cancel_total",
        Help: "Pipeline cancellations by cause",
    }, []string{"cause"})
)

// At pipeline exit:
cause := "unknown"
switch {
case errors.Is(ctx.Err(), context.DeadlineExceeded):
    cause = "deadline"
case errors.Is(ctx.Err(), context.Canceled):
    if c := context.Cause(ctx); c != nil {
        cause = c.Error()[:32] // truncate
    } else {
        cause = "client_disconnect"
    }
}
cancelByCause.WithLabelValues(cause).Inc()
```

A dashboard plotting cancellations by cause is a fast diagnostic tool. "Deadline" climbing means slow internal work; "client_disconnect" climbing means impatient clients (or a slow path).

---

## Cheat Sheet

```go
// Structured concurrency
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return stageA(ctx) })
g.Go(func() error { return stageB(ctx) })
return g.Wait()

// Bounded fan-out
g.SetLimit(n)

// Supervisor
for {
    select {
    case <-ctx.Done(): return
    default:
    }
    if err := fn(ctx); err != nil {
        log.Println(err)
    }
    select {
    case <-ctx.Done(): return
    case <-time.After(backoff):
    }
}

// Cancel with cause
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
cancel(myErr)
err := context.Cause(ctx)

// Detached background work
ctx2 := context.WithoutCancel(ctx)
go background(ctx2)

// Drain after cancel
cancel()
for range out {}
wg.Wait()

// Cancellable I/O
db.QueryContext(ctx, ...)
http.NewRequestWithContext(ctx, ...)
exec.CommandContext(ctx, ...)
net.Dialer{}.DialContext(ctx, ...)

// Watchdog cancellation
go func() {
    <-ctx.Done()
    conn.SetReadDeadline(time.Now())
}()
```

---

## Cancellation in middleware and interceptors

In HTTP, gRPC, and similar request-response frameworks, middleware wraps handlers and may need to participate in cancellation.

### HTTP middleware that adds a deadline

```go
func WithTimeout(d time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx, cancel := context.WithTimeout(r.Context(), d)
            defer cancel()
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

The middleware narrows the request's context. Downstream handlers see the tighter deadline.

### HTTP middleware that recovers panics

```go
func WithRecover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v", rec)
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

If the handler panics, the request context is still cancelled (when the handler returns, the response writes). Downstream goroutines spawned by the handler see the cancel.

### gRPC interceptor for tracing

```go
func TracingInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    span, ctx := tracer.StartSpanFromContext(ctx, info.FullMethod)
    defer span.End()
    return handler(ctx, req)
}
```

The interceptor adds a tracing span to the context. The handler sees a context with tracing info; cancellation behaviour is unaffected.

### Middleware that adds a watcher

```go
func WithObserver(observer func(ctx context.Context)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            go observer(r.Context())
            next.ServeHTTP(w, r)
        })
    }
}
```

A goroutine watches the request context (e.g. for metrics) and exits when the request ends. The goroutine has a structured lifetime tied to the request.

---

## Production wisdom: the dozen rules

After years of fixing cancellation bugs, the rules I keep returning to:

1. **Every function that does anything blocking takes `ctx context.Context` as its first parameter.** No exceptions.
2. **Every blocking channel operation lives inside `select` with `<-ctx.Done()` as another case.** No exceptions.
3. **Every channel is closed by the goroutine that owns it (the one that writes to it).** No second writer.
4. **Every `WithCancel`/`WithTimeout`/`WithDeadline` is paired with `defer cancel()`** at the right scope. The scope is the function that called the helper.
5. **Every external I/O call uses the context-aware variant**: `QueryContext`, `NewRequestWithContext`, `DialContext`, `CommandContext`.
6. **Every long inner loop polls `ctx.Err()` periodically** (every 1ms or so). The cost is one atomic load; the benefit is mid-loop cancellation.
7. **Every long-running goroutine has a documented exit condition.** Either "exits when input channel closes" (and someone is responsible for the close) or "exits when ctx cancels" (and ctx is wired in).
8. **Every cancellation has a recorded cause via `WithCancelCause`** if you might debug it later. The cause shows up in logs, traces, and metrics.
9. **Every shutdown is tested under load**, not just in unit tests. Production shutdown is when corner cases bite.
10. **Every cancellation latency is measured.** What you cannot measure, you cannot improve.
11. **Every drain has a deadline.** A drain that hangs is worse than data loss.
12. **Every resource is released by `defer`** so cancellation paths and normal paths share cleanup.

These are not "best practices" — they are the bare minimum for a service that handles cancellation correctly. Anything less is a latent leak.

---

## Cancellation in chained microservices

A request crosses 4 microservices: A -> B -> C -> D. Each is a separate process. Cancellation must propagate through every hop.

### gRPC end-to-end

```go
// In service A:
ctx, cancel := context.WithTimeout(parentCtx, time.Second)
defer cancel()
respB, err := bClient.Call(ctx, req)

// In service B's handler:
func (s *BServer) Call(ctx context.Context, req *Req) (*Resp, error) {
    respC, err := s.cClient.Call(ctx, req)
    // ...
}

// In service C's handler:
func (s *CServer) Call(ctx context.Context, req *Req) (*Resp, error) {
    respD, err := s.dClient.Call(ctx, req)
    // ...
}

// In service D's handler:
func (s *DServer) Call(ctx context.Context, req *Req) (*Resp, error) {
    return s.work(ctx)
}
```

The deadline travels in `grpc-timeout` metadata from A to B to C to D. Each hop reconstructs a context with the same remaining deadline (minus network delay).

A cancellation at A (client disconnects) closes the stream A->B. B's `ctx` cancels. B's call to C closes. C's `ctx` cancels. C's call to D closes. D's `ctx` cancels. D's work aborts.

The chain unwinds in microseconds per hop (RST_STREAM is one frame). End-to-end cancellation across a 4-hop chain is sub-millisecond.

### HTTP without explicit deadline propagation

HTTP/1.1 has no header for deadlines. Each hop must enforce its own:

```go
// Service A:
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "POST", urlB, body)
resp, _ := http.DefaultClient.Do(req)

// Service B (handler):
ctx := r.Context() // cancels on client disconnect, but no deadline
ctx, cancel := context.WithTimeout(ctx, time.Second) // B enforces its own deadline
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "POST", urlC, body)
// ...
```

Each hop adds its own deadline. The total is the sum of the per-hop deadlines, not the original budget. Mitigation: use a header (`X-Request-Deadline: timestamp`) and decode it on each hop.

### Distributed tracing for cancellation

Tracing systems (OpenTelemetry, Jaeger) propagate trace IDs across hops. Cancellation events can be tagged in spans:

```go
span.SetStatus(codes.Error, "cancelled")
span.RecordError(ctx.Err())
```

When a request cancels mid-chain, the trace shows where the cancellation propagated and which hops completed before it. Invaluable for debugging slow requests and cancellation races.

---

## A note on `context.Context` philosophy

`context.Context` is sometimes criticised: it makes every function signature longer; the values bag (`WithValue`) is an anti-pattern when overused; it bolts cancellation onto a language that did not have it natively.

These criticisms have merit, but the alternative — making every function take a done channel parameter, or none at all, or implementing cancellation per-package — is worse. `context.Context` is the *standardised* solution; its ubiquity is its value.

The design philosophy embedded in `context`:

- Cancellation is a property of an operation, not of a thread or goroutine.
- Cancellation is broadcast, not directed.
- Cancellation is composable: a parent cancels all children.
- Cancellation carries a reason but the propagation is the same regardless.

These are good principles. Adopt them; do not fight them.

The narrow critique that does deserve weight: `context.Value` is overused for passing "implicit" parameters. Use it sparingly, only for true cross-cutting concerns (trace IDs, auth) that would otherwise pollute every function signature. For domain values, use explicit parameters.

---

## Summary

At senior level, cancellation propagation becomes an architectural property of the whole system. The patterns to internalise:

- Structured concurrency: every goroutine has a join point in the function that spawned it.
- Supervisor trees: long-running tasks restart with backoff and exit on shutdown.
- Race-free shutdown protocols: cancel before close, drain before exit, order resource release outside-in.
- Predictable cancellation latency: measured, bounded, tested.
- Choosing the right abstraction per scope.
- Defending against cancellation anti-patterns at scale.

`errgroup` remains the workhorse; `context.WithCancelCause`, `context.AfterFunc`, and `context.WithoutCancel` (Go 1.21+) round out the toolkit. Real production pipelines should test cancellation paths with chaos and stress tests, instrument latency, and watch for goroutine count drift.

Professional level explores internals: the implementation of `context`, scheduler interactions, large-scale incident lessons, and performance under load.

---

## Closing thoughts

Cancellation propagation feels like a low-level concern but is in fact a high-level architectural choice. The choice is binary: either every goroutine has a path to cancellation, or some do not. There is no middle ground.

A service that gets cancellation right has bounded shutdown, predictable resource usage, and visible failure modes. A service that gets it wrong has slow shutdown, accumulating goroutine count, and silent leaks that manifest as memory creep over weeks.

The good news: the patterns are small and the discipline is teachable. `errgroup`, `select with ctx.Done()`, `defer cancel()`, `defer close(out)` — these are the building blocks. Combine them consistently and the cancellation behaviour of your service emerges from the implementation rather than being bolted on at the end.

The next file, professional level, explores what happens beneath these abstractions: how `context` is implemented, what cancellation costs in the scheduler, what large-scale incident postmortems teach about cancellation at production scale.

---

## Further Reading

- "Structured Concurrency in Go" — Trevor Manning: <https://lucisferre.net/2020/07/09/structured-concurrency-in-go/>
- "Notes on Structured Concurrency" — Nathaniel J. Smith: <https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/>
- `golang.org/x/sync/errgroup` source: <https://cs.opensource.google/go/x/sync/+/refs/heads/master:errgroup/>
- The Go Blog — *Go 1.21 release notes (`WithoutCancel`, `AfterFunc`, `WithCancelCause`)*: <https://go.dev/blog/go1.21>
- "Patterns for Cancellation in Go" — Sergey Davidoff: <https://elliotchance.medium.com/golang-context-cancellation-and-best-practices-7f3b6df5b6e6>
- *Designing Data-Intensive Applications* by Martin Kleppmann — chapter on stream processing for backpressure context.
