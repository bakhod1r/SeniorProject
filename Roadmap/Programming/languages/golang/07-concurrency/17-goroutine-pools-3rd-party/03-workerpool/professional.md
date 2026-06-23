---
layout: default
title: Professional
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/professional/
---

# gammazero/workerpool — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Professional Means](#what-professional-means)
3. [Pool Sizing in Production](#pool-sizing-in-production)
4. [Matching Pool Size to Workload Type](#matching-pool-size-to-workload-type)
5. [Sizing Heuristics That Actually Work](#sizing-heuristics-that-actually-work)
6. [Observability Foundations](#observability-foundations)
7. [Metrics You Must Have](#metrics-you-must-have)
8. [Logging Strategy](#logging-strategy)
9. [Tracing Integration](#tracing-integration)
10. [Alerting Strategy](#alerting-strategy)
11. [Context Integration Patterns](#context-integration-patterns)
12. [Draining vs Hard Stop](#draining-vs-hard-stop)
13. [Kubernetes Lifecycle Integration](#kubernetes-lifecycle-integration)
14. [Capacity Planning](#capacity-planning)
15. [Adaptive Sizing](#adaptive-sizing)
16. [Production Wrapper Anatomy](#production-wrapper-anatomy)
17. [Real-World Incident 1: The Hung Webhook](#real-world-incident-1-the-hung-webhook)
18. [Real-World Incident 2: The 4 GB Queue](#real-world-incident-2-the-4-gb-queue)
19. [Real-World Incident 3: The Cascading Slowdown](#real-world-incident-3-the-cascading-slowdown)
20. [Real-World Incident 4: The Reaping Surprise](#real-world-incident-4-the-reaping-surprise)
21. [Production Anti-Patterns](#production-anti-patterns)
22. [Migration Stories](#migration-stories)
23. [Failure Modes and Defences](#failure-modes-and-defences)
24. [Pool as Part of System Architecture](#pool-as-part-of-system-architecture)
25. [Multi-Tenant Isolation](#multi-tenant-isolation)
26. [Cost Accounting](#cost-accounting)
27. [Performance Engineering](#performance-engineering)
28. [Tricky Production Points](#tricky-production-points)
29. [Test](#test)
30. [Cheat Sheet](#cheat-sheet)
31. [Self-Assessment Checklist](#self-assessment-checklist)
32. [Summary](#summary)
33. [What You Can Build](#what-you-can-build)
34. [Further Reading](#further-reading)
35. [Related Topics](#related-topics)
36. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

The professional file is about *running* `workerpool` in production. Not learning the API, not reading the source — operating it on systems that handle real traffic with real consequences.

You already know the API (junior), the operational nuances (middle), and the internals (senior). What this file adds:

- How to *pick* `maxWorkers` and queue caps deliberately.
- How to *observe* a pool in flight, in alerting-and-dashboards terms.
- How to *survive* a slow downstream, a runaway producer, a process restart.
- How to *evolve* the pool's configuration as load grows.
- Stories from incidents — not contrived, but representative of what actually breaks.

This file is longer than the others because production wisdom is dense. Read it once linearly, then return to specific sections as your work demands. A code review checklist at the end summarises everything.

---

## What Professional Means

Senior means understanding the code. Professional means understanding the system the code runs in.

A professional engineer asks:

- "What happens to this pool at 100x load?"
- "What does the on-call see if this pool gets stuck?"
- "How long does a deploy take with this pool? What does shutdown look like?"
- "If the downstream service is degraded, does this pool make it worse or better?"
- "What's the budget — CPU, memory, goroutines, dollars — for this pool?"

You should not be able to answer these by reading source. You answer them by:

- Running load tests.
- Watching metrics during real traffic.
- Reading incident retrospectives.
- Talking to other operators.
- Sometimes, just paying attention as you ship and observe.

The professional file is your guide to those activities applied to `workerpool`-based code.

---

## Pool Sizing in Production

The single most important decision when adopting a pool is `maxWorkers`. Get this wrong and nothing else matters. Get it right and most other questions become tractable.

### The wrong way: pick a "nice round number"

```go
pool := workerpool.New(100) // because 100 is reassuring
```

100 is not based on anything. Maybe it's right; maybe it's 10x too high; maybe it's 10x too low. Without measurement, you do not know.

### The right way: derive from workload characteristics

You need three pieces of information:

1. **Per-task latency.** How long does one task take, on average and at p99?
2. **Target throughput.** Tasks per second you need to sustain.
3. **Downstream concurrency capacity.** How many concurrent calls can your downstream tolerate?

With these:

- `workers_for_throughput = target_throughput * avg_latency`
- `workers_max = min(workers_for_throughput, downstream_capacity)`

Example: target 200 RPS, average latency 0.5s, downstream allows 50 concurrent calls.

- `workers_for_throughput = 200 * 0.5 = 100`
- `workers_max = min(100, 50) = 50`

So `workerpool.New(50)`. With 50 workers and 0.5s tasks, you sustain 100 RPS — not the 200 you targeted, because the downstream is the limit. Either:

- Negotiate higher downstream limits.
- Reduce per-task latency.
- Drop target throughput.

The point is: you now know *why* 50, not "it felt right".

### The hot-reload temptation

A common request: "can the pool size change at runtime?"

`workerpool` does not support this. To approximate it, you either:

- Use a wrapper (Appendix in senior file) that swaps pools on resize.
- Use `ants` with `Tune()`.
- Accept that pool size requires a restart.

For most services, restart-on-config-change is fine. For services where restart is costly (long startup, sticky sessions), implement the wrapper.

---

## Matching Pool Size to Workload Type

A taxonomy of workload types and how to size for each.

### Pure CPU-bound (no I/O)

Examples: image resizing, video encoding, compression, JSON marshalling.

`maxWorkers = GOMAXPROCS`. More workers than cores wastes context switches. Less than cores leaves cores idle.

```go
pool := workerpool.New(runtime.GOMAXPROCS(0))
```

### Pure I/O-bound (network or disk)

Examples: HTTP fetching, database queries, file uploads.

`maxWorkers` is much higher — typically 10–100x cores. Workers spend most of their time blocked on I/O, so the runtime can schedule many of them on a few threads.

How high exactly? Limited by:

- Downstream concurrency (don't overwhelm).
- Local file descriptors (`ulimit -n`).
- Local memory (each goroutine has a stack).
- Goroutine accounting (millions are fine but not free).

A good starting point: 50-100 workers per core. So an 8-core machine: 400-800 workers for pure I/O.

### Mixed CPU and I/O

Examples: parsing JSON from HTTP responses, transforming data fetched from a DB.

If the work is mostly I/O with a small CPU step, treat as I/O-bound. If it's mostly CPU with a small I/O wait, treat as CPU-bound. If it's 50/50, size to the I/O dimension (CPU work will share cores fine).

For real precision, profile: how much wall-clock time does a task spend in each phase? Size for the longer phase.

### Database-bound

Special case of I/O-bound. The constraint is usually the database's concurrent connection limit:

```
maxWorkers <= db_max_connections - other_consumers
```

If your DB allows 100 connections and other processes use 30, set `maxWorkers = 70` (or fewer, to leave headroom).

Connection pooling at the DB driver level matters: each task takes a connection from the driver's pool. If the driver's pool is smaller than `maxWorkers`, tasks block waiting for a connection — wasted worker slots.

Sync your driver pool size to your `maxWorkers`.

### External API-bound

Constrained by the API's rate limit and concurrent connection limit. Read their docs:

```
"50 requests per second, 10 concurrent"
```

Use a rate limiter (`rate.NewLimiter(50, 50)`) for the RPS bound, and `workerpool.New(10)` for the concurrency bound. Both work together: the limiter ensures you don't exceed 50/s, the pool ensures no more than 10 are in flight.

---

## Sizing Heuristics That Actually Work

A grab-bag of rules of thumb, in the order you should apply them.

### Rule 1: Start small

Begin with `maxWorkers = 2` or `4`. Measure. Increase only when you see queue depth growing under load. Resist the temptation to start "high enough to handle anything" — that's how you accidentally hammer a downstream.

### Rule 2: Use NumCPU as a floor for CPU-bound

For CPU work: `maxWorkers >= runtime.NumCPU()` (so all cores can be used).

### Rule 3: Use Latency * RPS for I/O-bound

`maxWorkers = avg_task_seconds * target_rps`. Adjust for p99 latency if tail-sensitive.

### Rule 4: Bound by downstream

Whatever you compute, do not exceed the downstream's tolerated concurrency.

### Rule 5: Add 20% headroom

`maxWorkers = computed_value * 1.2`. Handles modest traffic spikes without queueing.

### Rule 6: Test with synthetic load

Before deploying a new pool size, run a load test that exceeds expected traffic by 2x. Watch queue depth, latency, error rate.

### Rule 7: Document the math

In code:

```go
// maxWorkers = 50: chosen for downstream limit (DB connection cap = 60, 10 reserved for other services)
// expected steady-state: 30-40 workers active under normal load
// expected peak: 50 workers (saturated) under traffic spikes
const dbPoolWorkers = 50
var dbPool = workerpool.New(dbPoolWorkers)
```

Future maintainers (or future you) will thank you.

### Rule 8: Revisit on every deploy

Workload changes, hardware changes, downstream changes. If your pool size has not been reviewed in six months, it is probably wrong.

### Rule 9: Be especially careful around 1 and `NumCPU`

`maxWorkers = 1` is a serialised queue — sometimes intended, often a bug. `maxWorkers = NumCPU()` is standard for CPU-bound — but on different machines `NumCPU` differs, so the same code runs at different parallelism. Be explicit.

### Rule 10: When in doubt, smaller

A pool that is too small overflows its queue noticeably (you can see and fix it). A pool that is too large can silently kill a downstream. Bias toward smaller.

---

## Observability Foundations

A pool without observability is a black box. In production, that means trouble.

You need three layers of observability:

1. **Metrics** — counters and gauges, for trending and alerting.
2. **Logging** — discrete events, for forensic analysis.
3. **Tracing** — per-request flows, for understanding cross-service interactions.

Each layer answers different questions:

- Metrics: "is the pool healthy *right now*?"
- Logging: "what happened *during this incident*?"
- Tracing: "where did *this specific task* go?"

A production-grade pool wrapper instruments all three.

### Why instrumentation at the wrapper, not the library?

The library is generic; your instrumentation is service-specific. Adding metrics/logging/tracing inside the library would be invasive and opinionated. Adding it in a thin wrapper around the library is clean and gives you full control.

This is the same pattern used by every other production-grade library wrapper in Go: `net/http` with Prometheus middleware, `sql.DB` with `OpenTelemetry`, etc.

---

## Metrics You Must Have

The minimum metrics for any production pool:

### 1. Submitted counter

```go
poolSubmitted := prometheus.NewCounterVec(prometheus.CounterOpts{
    Name: "workerpool_submitted_total",
    Help: "Total tasks submitted to the pool",
}, []string{"pool"})
```

Increment on every `Submit`. Tells you the input rate.

### 2. Completed counter

```go
poolCompleted := prometheus.NewCounterVec(prometheus.CounterOpts{
    Name: "workerpool_completed_total",
    Help: "Total tasks that completed (including panicked)",
}, []string{"pool", "result"})
```

Increment with `result="ok"` on success, `result="panic"` on panic, `result="error"` on returned error. Tells you output rate and breakdown.

### 3. Queue depth gauge

```go
poolQueueDepth := prometheus.NewGaugeVec(prometheus.GaugeOpts{
    Name: "workerpool_queue_depth",
    Help: "Current waiting queue depth",
}, []string{"pool"})
```

Set periodically (every 5-10 seconds) from `pool.WaitingQueueSize()`. Tells you backpressure status.

### 4. Active workers gauge (best-effort)

The library does not expose this directly. Approximate via submitted - completed (in-flight) minus queue depth (those queued but not running):

```go
inflight := submitted - completed
running := inflight - queueDepth
```

`running` is an approximation but usually accurate.

### 5. Task duration histogram

```go
poolDuration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name: "workerpool_task_duration_seconds",
    Help: "Task execution time",
    Buckets: prometheus.ExponentialBuckets(0.001, 2, 14), // 1ms to 8s
}, []string{"pool"})
```

Observe `time.Since(start)` at the end of each task. Tells you per-task latency distribution.

### 6. Queue dwell histogram

The time a task spends queued before running:

```go
poolDwell := prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name: "workerpool_queue_dwell_seconds",
    Help: "Time in queue before execution",
}, []string{"pool"})
```

Observe `runStart - submitStart`. Tells you if the pool is keeping up.

### 7. Drop counter (if you implement bounded queue)

```go
poolDropped := prometheus.NewCounterVec(prometheus.CounterOpts{
    Name: "workerpool_dropped_total",
    Help: "Tasks rejected because queue was full",
}, []string{"pool"})
```

### 8. Stopped indicator

```go
poolStopped := prometheus.NewGaugeVec(prometheus.GaugeOpts{
    Name: "workerpool_stopped",
    Help: "1 if pool is stopped, 0 otherwise",
}, []string{"pool"})
```

Periodically set from `pool.Stopped()`. Tells you if the pool is shutting down.

### Putting them together

A wrapper that emits all eight metrics looks like this:

```go
type InstrumentedPool struct {
    name string
    pool *workerpool.WorkerPool
}

func (ip *InstrumentedPool) Submit(taskName string, f func()) {
    submitTime := time.Now()
    poolSubmitted.WithLabelValues(ip.name).Inc()
    ip.pool.Submit(func() {
        runStart := time.Now()
        poolDwell.WithLabelValues(ip.name).Observe(runStart.Sub(submitTime).Seconds())

        result := "ok"
        defer func() {
            if r := recover(); r != nil {
                result = "panic"
                log.Printf("pool=%s task=%s panic=%v", ip.name, taskName, r)
            }
            poolCompleted.WithLabelValues(ip.name, result).Inc()
            poolDuration.WithLabelValues(ip.name).Observe(time.Since(runStart).Seconds())
        }()

        f()
    })
}
```

In a separate goroutine, update gauges periodically:

```go
go func() {
    ticker := time.NewTicker(5 * time.Second)
    for range ticker.C {
        poolQueueDepth.WithLabelValues(ip.name).Set(float64(ip.pool.WaitingQueueSize()))
        if ip.pool.Stopped() {
            poolStopped.WithLabelValues(ip.name).Set(1)
        } else {
            poolStopped.WithLabelValues(ip.name).Set(0)
        }
    }
}()
```

---

## Logging Strategy

Metrics give you trends; logs give you specifics. The right log volume:

- Per-task logs: only in debug mode. At production scale they swamp.
- Slow-task logs: yes, with a threshold. "Task X took 5s" is actionable.
- Panic logs: always. With stack traces.
- Drop logs: rate-limited. "Dropped 100 tasks in the last minute" is useful; logging every drop is noise.
- Pool lifecycle: at INFO level. "Pool created", "Pool drained", "Pool stopped with N tasks dropped".

A pattern:

```go
ip.pool.Submit(func() {
    start := time.Now()
    defer func() {
        elapsed := time.Since(start)
        if r := recover(); r != nil {
            log.Error("task panic",
                "pool", ip.name,
                "task", taskName,
                "panic", r,
                "stack", string(debug.Stack()),
                "elapsed", elapsed)
            return
        }
        if elapsed > 500*time.Millisecond {
            log.Warn("slow task",
                "pool", ip.name,
                "task", taskName,
                "elapsed", elapsed)
        }
    }()
    f()
})
```

Structured logging (slog, zap, zerolog) is essential. Plain text logs are unsearchable at scale.

### What to log on slow tasks

The minimum: pool name, task name, elapsed time. Add the request ID if available. Avoid the task arguments (they may be huge, sensitive, or both).

### What to log on shutdown

```
INFO pool=webhook draining started, queue_depth=1234
INFO pool=webhook draining progress, remaining=623, elapsed=10s
WARN pool=webhook drain deadline exceeded, calling hard stop
INFO pool=webhook stopped, dropped=120
```

These four-line stories tell the on-call exactly what happened during shutdown.

---

## Tracing Integration

For services with distributed tracing (OpenTelemetry, Jaeger), pool tasks should appear as spans in the trace.

```go
ip.pool.Submit(func() {
    ctx, span := tracer.Start(ctx, "workerpool.task",
        trace.WithAttributes(
            attribute.String("pool", ip.name),
            attribute.String("task", taskName),
        ))
    defer span.End()

    if err := f(ctx); err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
    }
})
```

The span captures:

- The pool name.
- The task name.
- Start and end times.
- Any errors.

In the trace viewer, you see: parent request → handler span → pool task span. Crucially, you see *how long the task waited in the queue* if you record the submit-time as a span event.

This is how production engineers diagnose "why did this request take 5 seconds?" — they trace it, find the pool task span, see the dwell time was 4 seconds, conclude the pool was overloaded.

---

## Alerting Strategy

Alerts are metrics with thresholds and on-call notification. The minimum alerts for a production pool:

### Alert 1: Queue depth high

```
alert: PoolQueueGrowing
expr: workerpool_queue_depth > 1000
for: 5m
severity: warning
summary: "Pool {{ $labels.pool }} queue is over 1000 for 5 minutes"
```

If the queue is over 1000 for 5 minutes, you have backpressure issues. Either size up, slow producers, or investigate the downstream.

### Alert 2: Pool stopped unexpectedly

```
alert: PoolStopped
expr: workerpool_stopped == 1
for: 1m
severity: page
summary: "Pool {{ $labels.pool }} is stopped"
```

If the pool stopped but the service is supposed to be running, page. This usually means a deploy or a crash.

### Alert 3: Panic rate elevated

```
alert: PoolPanicRate
expr: rate(workerpool_completed_total{result="panic"}[5m]) > 0.1
for: 5m
severity: page
summary: "Pool {{ $labels.pool }} panicking >0.1/s"
```

Panics in tasks are bugs. A bursty panic might be a bad input; a sustained panic is a broken deployment.

### Alert 4: Drop rate high

```
alert: PoolDropping
expr: rate(workerpool_dropped_total[5m]) > 0
for: 5m
severity: warning
summary: "Pool {{ $labels.pool }} dropping tasks"
```

If you have bounded queues and they are dropping, you are losing work. Investigate.

### Alert 5: Task duration p99 spike

```
alert: PoolSlowTasks
expr: histogram_quantile(0.99, rate(workerpool_task_duration_seconds_bucket[5m])) > 5
for: 10m
severity: warning
summary: "Pool {{ $labels.pool }} p99 task duration > 5s"
```

Sustained slow tasks usually mean a downstream issue.

These five alerts cover ~90% of pool-related incidents. Tune the thresholds to your service's normal levels.

---

## Context Integration Patterns

Production pools must respect cancellation. The library does not enforce this; you do.

### Pattern: parent context cancels everything

```go
type Service struct {
    pool *workerpool.WorkerPool
    ctx  context.Context
}

func (s *Service) Process(item Item) {
    s.pool.Submit(func() {
        s.handleItem(s.ctx, item)
    })
}

func (s *Service) Shutdown() {
    s.pool.StopWait()
}
```

The service has a context that lives as long as the service. Cancelling it (via shutdown signal) propagates to every task. Tasks check `s.ctx.Done()` and bail.

### Pattern: per-request context propagation

In an HTTP server, each request has its own context. To propagate it to a pool task:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    pool.Submit(func() {
        if err := ctx.Err(); err != nil {
            return // client disconnected before we started
        }
        process(ctx, ...)
    })
    fmt.Fprintln(w, "accepted")
}
```

If the client disconnects, the context is cancelled. The task notices and bails early. This is good citizenship — no work is wasted on a request that no longer matters.

Caveat: HTTP request contexts are cancelled when the response is fully written. If you `fmt.Fprintln(w, "accepted")` and return, the response is complete and the context cancels. The pool task then sees a cancelled context. To detach, use `context.Background()` instead:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool.Submit(func() {
        process(context.Background(), ...) // continues even after response
    })
    fmt.Fprintln(w, "accepted")
}
```

Pick deliberately. "Cancel when client gives up" vs "keep going regardless" is a design choice.

### Pattern: per-task timeout

```go
pool.Submit(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    process(ctx, ...)
})
```

Every task has a 10-second deadline. After 10s, the context is cancelled and the task should bail. This bounds worker hold time.

Critical: actually check `ctx.Done()` inside `process`. The context does nothing on its own; the code must respect it.

### Pattern: deadline from upstream

In a chained service:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithDeadline(r.Context(), time.Now().Add(5*time.Second))
    defer cancel()
    pool.Submit(func() {
        process(ctx, ...)
    })
}
```

The deadline propagates from request to pool to downstream calls. If the request has 5s budget, no task can run beyond that. Composable and clean.

---

## Draining vs Hard Stop

Shutdown is where pool bugs hide. Let's make this explicit.

### When to drain

- The work in the queue is valuable.
- You have time to wait (maintenance window, scheduled deploy).
- The downstream can handle continued requests.

Use `pool.StopWait()`.

### When to hard-stop

- You are out of time (signal received with deadline ending).
- The work in the queue is no longer valuable (cancelled, stale).
- Downstream is dead and continued requests just fail.

Use `pool.Stop()`.

### When to combine

Most often: drain with a deadline, then hard-stop if exceeded.

```go
drained := make(chan struct{})
go func() {
    pool.StopWait()
    close(drained)
}()

select {
case <-drained:
    log.Info("drained cleanly")
case <-time.After(deadline):
    log.Warn("drain deadline; hard stop")
    pool.Stop()
    <-drained
}
```

Adjust `deadline` to your service's SLA. For Kubernetes, default `terminationGracePeriodSeconds` is 30s; the deadline should be ~25s (leave a 5s buffer for the rest of shutdown).

### Counting dropped tasks

When you hard-stop, some tasks are dropped. Count them so you know the impact:

```go
before := pool.WaitingQueueSize()
pool.Stop()
<-drained
log.Info("hard stop", "dropped", before)
```

This is approximate (the queue may have changed between `WaitingQueueSize` and `Stop`), but close enough for accounting.

### Stopping producers first

The shutdown sequence must be:

1. Stop accepting new requests (HTTP server shutdown).
2. Stop any internal producers (close channels, signal goroutines).
3. Drain the pool.

If you reverse 2 and 3, the pool drains, then producers add more work, and you never finish draining.

A common bug: forgetting step 2. Background tickers keep submitting; the pool never drains.

```go
// correct order
close(myInternalProducerStopCh)
producerWg.Wait()
pool.StopWait()
```

---

## Kubernetes Lifecycle Integration

If your service runs on Kubernetes, you must handle SIGTERM correctly.

### The default behaviour

K8s sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30s), then SIGKILL. If your service doesn't drain in time, it dies abruptly and any in-flight tasks are lost.

### A robust signal handler

```go
func main() {
    pool := workerpool.New(50)
    srv := &http.Server{...}

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)

    go func() {
        srv.ListenAndServe()
    }()

    sig := <-sigs
    log.Info("signal received", "signal", sig)

    // Phase 1: stop accepting new HTTP requests
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Error("server shutdown", "err", err)
    }
    log.Info("http server stopped, draining pool")

    // Phase 2: drain pool with remaining time budget
    drained := make(chan struct{})
    go func() {
        pool.StopWait()
        close(drained)
    }()
    select {
    case <-drained:
        log.Info("pool drained cleanly")
    case <-shutdownCtx.Done():
        log.Warn("pool drain deadline, hard stop")
        pool.Stop()
        <-drained
    }

    log.Info("shutdown complete")
}
```

Key points:

- One `shutdownCtx` with the total budget (30s).
- HTTP server shutdown uses some of that budget.
- Pool drain uses the rest.
- If we run out of time, hard-stop and accept the loss.

### `preStop` hook

K8s lets you run a script before SIGTERM. Use it to remove the pod from the load balancer earlier:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
```

This delays SIGTERM by 5 seconds, giving the LB time to stop routing to this pod. Your draining then happens with the pod already out of rotation — no new requests arrive.

### Liveness vs readiness

- **Liveness probe:** fails → pod restart. Should NOT fail during shutdown (that triggers restart loops).
- **Readiness probe:** fails → pod removed from LB. SHOULD fail during shutdown.

Implement readiness to return 503 once `pool.Stopped()` is true. K8s pulls you from the LB; remaining in-flight requests finish; pool drains; exit.

```go
http.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
    if pool.Stopped() {
        http.Error(w, "shutting down", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})
```

---

## Capacity Planning

A more rigorous take than "Rule 5: Add 20% headroom".

### Establishing the baseline

For a stable workload, run for a week and observe:

- Mean RPS.
- Peak RPS (max over 1-minute windows).
- Mean task duration.
- p99 task duration.
- Mean queue depth.
- Peak queue depth.

These six numbers characterise your pool's normal operation.

### Projecting growth

If you expect 50% growth in traffic over 6 months:

- Peak RPS will be 1.5x current.
- Mean queue depth may be much higher than 1.5x (queues grow non-linearly with load).
- You will need more workers and/or more capacity downstream.

Plot expected queue depth vs `maxWorkers` for the projected load. Pick the point where queue depth stays manageable.

### Headroom for spikes

Real traffic has spikes. A standard recommendation:

- Size for `peak_rps * 1.5`.
- Or: size so queue depth stays under 1000 even at peak.

Adjust to your service's tail-tolerance.

### Cost considerations

Each worker is roughly 4 KB of memory at idle plus whatever the task allocates. 1000 workers ~= 4 MB minimum. Negligible.

Each worker holds a downstream resource (a DB connection, an HTTP connection). At 1000 workers, you have 1000 connections in use during peak. That may be expensive — connections to RDS, paid API calls, etc.

So pool size affects:

- CPU (negligible unless you saturate cores).
- Memory (negligible).
- Downstream resources (significant).
- Per-request cost (if downstream is paid).

Pick based on the constraining resource, not raw worker count.

---

## Adaptive Sizing

For services with widely varying load (a 10x daily curve, for example), a static pool size is suboptimal. Adaptive sizing improves utilisation.

### The simplest adaptation

Two pool sizes: "day" and "night". Switch on a schedule.

```go
type AdaptivePool struct {
    mu sync.RWMutex
    inner *workerpool.WorkerPool
}

func (ap *AdaptivePool) Switch(target int) {
    ap.mu.Lock()
    defer ap.mu.Unlock()
    old := ap.inner
    ap.inner = workerpool.New(target)
    go old.StopWait()
}

func (ap *AdaptivePool) Submit(f func()) {
    ap.mu.RLock()
    p := ap.inner
    ap.mu.RUnlock()
    p.Submit(f)
}

func adapt(ap *AdaptivePool) {
    ticker := time.NewTicker(time.Hour)
    for range ticker.C {
        h := time.Now().Hour()
        if h >= 9 && h <= 18 {
            ap.Switch(100) // day
        } else {
            ap.Switch(20) // night
        }
    }
}
```

The drawback: pool swap is disruptive. Inflight tasks on the old pool finish; new tasks go to the new pool. There's a brief period of dual-pool state.

### Better: target-utilisation feedback

Compute current utilisation; resize to keep it around a target (say 70%):

```go
func adaptUtilization(ap *AdaptivePool, target float64) {
    ticker := time.NewTicker(time.Minute)
    for range ticker.C {
        u := utilization(ap) // your metric of "how full is the pool"
        if u > target+0.1 {
            ap.Switch(ap.size + 10)
        } else if u < target-0.1 {
            ap.Switch(ap.size - 10)
        }
    }
}
```

Damping the changes (only resize if outside a band) prevents oscillation.

### Using ants for resize

If adaptive sizing is important, just use `ants` and its `Tune()` method:

```go
pool, _ := ants.NewPool(50, ants.WithExpiryDuration(30*time.Second))
// later
pool.Tune(75)
```

Cheaper and cleaner than the `workerpool` wrapper.

The choice between "wrap workerpool" and "switch to ants" is mostly cultural. If your codebase already standardised on `workerpool`, the wrapper is fine. If you are starting fresh and need resize, `ants` is the simpler path.

---

## Production Wrapper Anatomy

The reference wrapper for a production-grade pool. This is what you should aim to have for any pool that handles real traffic.

```go
package prodpool

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "runtime/debug"
    "sync"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
    "github.com/prometheus/client_golang/prometheus"
)

// Pool wraps gammazero/workerpool with:
//   - bounded queue (semaphore)
//   - context-aware submit
//   - panic recovery with attribution
//   - prometheus metrics
//   - structured logging
//   - graceful + bounded shutdown
type Pool struct {
    name   string
    inner  *workerpool.WorkerPool
    sem    chan struct{}
    log    *slog.Logger

    // metrics
    submitted prometheus.Counter
    completed *prometheus.CounterVec
    duration  prometheus.Histogram
    dwell     prometheus.Histogram
    qDepth    prometheus.Gauge
    dropped   prometheus.Counter

    // state
    stopped   atomic.Bool
    stopOnce  sync.Once
    pendingWG sync.WaitGroup
}

// Options configures a Pool at creation.
type Options struct {
    Name          string
    MaxWorkers    int
    QueueCap      int
    Logger        *slog.Logger
    Registerer    prometheus.Registerer
}

// New creates a production-ready pool.
func New(opts Options) *Pool {
    if opts.MaxWorkers < 1 {
        opts.MaxWorkers = 1
    }
    if opts.QueueCap < 1 {
        opts.QueueCap = opts.MaxWorkers * 10
    }
    if opts.Logger == nil {
        opts.Logger = slog.Default()
    }
    if opts.Registerer == nil {
        opts.Registerer = prometheus.DefaultRegisterer
    }

    p := &Pool{
        name:  opts.Name,
        inner: workerpool.New(opts.MaxWorkers),
        sem:   make(chan struct{}, opts.QueueCap),
        log:   opts.Logger,
    }

    labels := prometheus.Labels{"pool": opts.Name}
    p.submitted = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "workerpool_submitted_total", ConstLabels: labels,
    })
    p.completed = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "workerpool_completed_total", ConstLabels: labels,
    }, []string{"result"})
    p.duration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name: "workerpool_task_duration_seconds", ConstLabels: labels,
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
    })
    p.dwell = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name: "workerpool_queue_dwell_seconds", ConstLabels: labels,
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
    })
    p.qDepth = prometheus.NewGauge(prometheus.GaugeOpts{
        Name: "workerpool_queue_depth", ConstLabels: labels,
    })
    p.dropped = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "workerpool_dropped_total", ConstLabels: labels,
    })

    opts.Registerer.MustRegister(p.submitted, p.completed, p.duration, p.dwell, p.qDepth, p.dropped)

    go p.gaugeLoop()
    return p
}

// Submit schedules a task. Returns error if the pool is closed or full.
func (p *Pool) Submit(ctx context.Context, taskName string, f func(context.Context) error) error {
    if p.stopped.Load() {
        return errors.New("pool stopped")
    }
    submitTime := time.Now()

    select {
    case p.sem <- struct{}{}:
    case <-ctx.Done():
        p.dropped.Inc()
        return ctx.Err()
    default:
        p.dropped.Inc()
        return fmt.Errorf("pool %q full", p.name)
    }

    if p.stopped.Load() {
        <-p.sem
        p.dropped.Inc()
        return errors.New("pool stopped")
    }

    p.submitted.Inc()
    p.pendingWG.Add(1)
    p.inner.Submit(func() {
        runStart := time.Now()
        p.dwell.Observe(runStart.Sub(submitTime).Seconds())
        result := "ok"
        defer func() {
            <-p.sem
            p.pendingWG.Done()
            if r := recover(); r != nil {
                result = "panic"
                p.log.Error("task panic",
                    "pool", p.name,
                    "task", taskName,
                    "panic", r,
                    "stack", string(debug.Stack()))
            }
            p.completed.WithLabelValues(result).Inc()
            p.duration.Observe(time.Since(runStart).Seconds())
        }()
        if err := f(ctx); err != nil {
            result = "error"
            p.log.Warn("task error",
                "pool", p.name,
                "task", taskName,
                "err", err)
        }
    })
    return nil
}

func (p *Pool) gaugeLoop() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        if p.stopped.Load() {
            return
        }
        p.qDepth.Set(float64(p.inner.WaitingQueueSize()))
    }
}

// Stop drains the pool with a deadline. After the deadline, performs a hard stop.
func (p *Pool) Stop(deadline time.Duration) (dropped int64) {
    p.stopOnce.Do(func() {
        p.stopped.Store(true)
        p.log.Info("pool draining", "pool", p.name, "queue", p.inner.WaitingQueueSize())

        done := make(chan struct{})
        go func() {
            p.inner.StopWait()
            close(done)
        }()

        select {
        case <-done:
            p.log.Info("pool drained cleanly", "pool", p.name)
        case <-time.After(deadline):
            dropped = int64(p.inner.WaitingQueueSize())
            p.log.Warn("pool drain deadline; hard stop",
                "pool", p.name, "dropped", dropped)
            p.inner.Stop()
            <-done
        }
    })
    return dropped
}
```

This is ~150 lines and packs in:

- Configurable construction.
- Bounded queue.
- Context-aware drop on overload.
- Panic recovery with stack and attribution.
- Six Prometheus metrics.
- Structured logging.
- Graceful shutdown with deadline.
- Stop idempotency via `sync.Once`.

You can drop this into a service and ship. It is the kind of code that survives audits.

---

## Real-World Incident 1: The Hung Webhook

### Setup

A service delivers webhooks to customer-configured URLs. Pool size 50. Worked for two years without incident.

### Incident

One customer's URL started hanging — connections accepted, no response, no close. Tasks delivering to that URL waited on the response. With 50 workers and a high enough rate of webhooks for that customer, all 50 eventually held hung connections. New webhooks queued unbounded.

Memory grew from 200 MB to 4 GB over 10 minutes. Liveness probe failed (metrics endpoint slow under GC pressure). Pod restarted. New pod hit the same hung URL. Restart loop.

### Investigation

Goroutine dump from the dying pod showed:

```
50 workers in net/http.(*Transport).RoundTrip
all blocked in chan receive
```

The HTTP client had no timeout. The downstream never closed the connection. Workers were stuck forever.

### Fix

Per-call timeout:

```go
client := &http.Client{Timeout: 30 * time.Second}
```

That single line, applied across the codebase, fixed the immediate issue. The webhook to the hung URL now failed after 30 seconds; workers freed up; the queue drained.

Additional defences added later:

- Bounded queue (1,000 tasks max).
- Per-customer concurrency limit.
- Dead-letter queue for repeatedly failing webhooks.

### Lessons

1. **Network timeouts are mandatory.** Always. Default Go HTTP client has no timeout — it will hang forever.
2. **Unbounded queues turn small downstream issues into outages.** A single bad URL took down a whole service.
3. **Liveness probes need to be cheap.** If they share resources with the main work, they can fail under load and trigger restarts that make things worse.
4. **Per-customer isolation prevents cross-tenant impact.** One bad customer should not take out the others.

---

## Real-World Incident 2: The 4 GB Queue

### Setup

A batch processor pulled records from a queue and submitted each to a `workerpool` for transformation. Pool size 16. Queue was the system's input; transformation involved an external API call.

### Incident

The external API had a partial outage — requests succeeded but took 30 seconds instead of 200 ms. The batch processor kept pulling at full speed (it didn't know about the slowdown). The pool's queue grew from ~100 to ~500,000 entries over 15 minutes.

Each queue entry held a closure with ~2 KB of captured state. Memory: 500,000 × 2 KB = 1 GB just for closures. Plus the records themselves: another 3 GB. Total: 4 GB and growing.

Pod hit OOM, restarted. New pod started pulling records again. Same outcome.

### Investigation

`heap` profile showed:

```
ROOT
  github.com/gammazero/workerpool.(*WorkerPool).Submit
    main.(*Processor).submit
      main.(*Processor).buildClosure
        ... 3.5 GB ...
```

The closures captured large records by value. With 500,000 in the queue, that was the lion's share of memory.

### Fix

Two changes:

1. Bound the queue at 1,000 entries via semaphore. Producers block when full.
2. Slow the producer when API latency rises. A simple feedback loop.

After the fix, the pool's queue stayed under 1,000 even during the outage. The producer paused when the API was slow. Memory stayed flat.

### Lessons

1. **Unbounded queues are a memory bug.** Even if you don't OOM today, you might tomorrow.
2. **Closures with large captures multiply the problem.** Audit what your task closures hold.
3. **Producers should react to consumer health.** If the downstream is slow, the producer should slow down. Don't blindly fill the queue.
4. **Profile heap during outages.** It tells you exactly what's eating memory.

---

## Real-World Incident 3: The Cascading Slowdown

### Setup

A pipeline of three pools: parse (4 workers), enrich (8 workers), write (16 workers). Each stage submitted to the next via channels.

### Incident

A new "enrich" rule was deployed that hit a third-party API. The third-party API was rate-limited. Enrich tasks started taking 5 seconds instead of 50 ms.

The enrich pool's queue grew. Parse kept producing (its workers were fine). The enrich-side channel (between parse and enrich pools) filled to its capacity (10,000). Parse workers blocked on `ch <- item`. Parse stopped processing.

Now nothing was being read from the input queue. The input queue grew. Soon the upstream service (which fed the input queue) was throttled. The whole pipeline stalled.

### Investigation

`runtime.Stack` showed:

- Parse workers: blocked on `enrichCh <- item`.
- Enrich workers: blocked on third-party API.
- Write workers: idle.

Trace showed third-party API latency had jumped from 50ms p99 to 5s p99.

### Fix

Multiple changes:

1. Bounded retries on the third-party API with circuit breaker.
2. Drop enrichment when the API is unhealthy (fall back to "no enrichment" mode).
3. Resize enrich pool from 8 to 32 to handle the slower latency.
4. Convert the inter-pool channels to bounded with overflow → log + drop.

After the fix, third-party API slowdowns no longer cascaded. The pipeline kept moving (with degraded enrichment quality, by design).

### Lessons

1. **Pipelines transmit pressure.** A slow stage blocks the upstream.
2. **Circuit breakers are essential for external dependencies.** Otherwise one downstream's incident becomes yours.
3. **Have a degraded mode.** If enrichment is unhealthy, prefer "unenriched data" to "no data".
4. **Pool sizes must be set per-stage based on each stage's latency.** Inheriting sizes between stages is wrong.

---

## Real-World Incident 4: The Reaping Surprise

### Setup

A long-running service used `workerpool` for background tasks that arrived every 5 seconds (one task every five seconds). Pool size 4.

### Incident

CPU usage was 5% during normal operation but spiked to 30% every 5 seconds in a sawtooth pattern. The team thought it was a memory allocation issue and spent two days profiling allocations. Nothing.

### Investigation

A goroutine count graph showed:

```
0s: 1 (just dispatcher)
5s: 2 (dispatcher + 1 worker)
7s: 1 (worker reaped after 2s idle)
10s: 2 (new task, new worker)
12s: 1
...
```

Every 5-second task spawned a new worker (because the previous one was reaped at the 2-second mark). The CPU spike was the goroutine creation + scheduling overhead. Tiny, but visible.

### Fix

Two options:

1. Submit a heartbeat task every 1.9 seconds to keep workers warm.
2. Just accept the cost (it was 30% of 5%, so 1.5% effective).

The team chose option 2 after measuring. The CPU spike was real but had no user impact. They added a graph annotation explaining the pattern and moved on.

### Lessons

1. **Idle reaping has visible cost on bursty workloads.** Not always a bug; just a thing to understand.
2. **Look at goroutine counts, not just allocation profiles.** Worker churn isn't an allocation issue.
3. **Sometimes the right fix is "accept it".** Not every observation requires action.
4. **Library defaults are tuned for the common case.** Yours might not match.

---

## Production Anti-Patterns

A consolidated list of "do not".

### 1. Untimed network calls in tasks

No `http.Client.Timeout`, no `context.WithTimeout`. The task hangs forever. The worker is stuck. Eventually the pool is stuck. Always set a timeout.

### 2. Unbounded queue with untrusted producers

A queue accepting input from the network must be bounded. Use a semaphore. Drop tasks rather than OOM.

### 3. Pool per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := workerpool.New(8)  // wrong
    defer pool.StopWait()
    // ... submit tasks ...
}
```

Each request pays the dispatcher startup cost. Hoist the pool to package scope.

### 4. Forgotten StopWait

Tests pass because GC reclaims, production leaks because the process doesn't restart often.

### 5. Cross-pool synchronous calls

`poolA` submits to `poolB`, blocks waiting. If `poolB` is saturated, `poolA` is stuck. Use async hand-off (channels, fire-and-forget).

### 6. Panicky tasks without recovery

The library recovers, but the panic value and stack are lost. Wrap each task with `defer recover()`.

### 7. Shared state without locks

Two workers write to a map without a mutex. The race detector finds it eventually. Production doesn't get the chance.

### 8. No metrics

Pools without observability are bugs waiting to happen. At minimum: submitted, completed, queue depth.

### 9. Pool size based on optimism

`maxWorkers = 1000` because "we might need it". You don't. Size from data.

### 10. Restart on every config change

If your `maxWorkers` is in a YAML file and you have to redeploy to change it, you can't react to incidents quickly. Build hot-reload (or use `ants`).

### 11. Single pool for mixed workloads

CPU and I/O workloads in one pool starve each other. Split.

### 12. Ignoring queue depth in capacity planning

The queue is part of your memory footprint. A 100,000-entry queue with 2 KB closures is 200 MB. Plan for it.

### 13. No drain deadline

`pool.StopWait()` blocks until done. If a task hangs, you hang. K8s SIGKILLs you. Use a deadline.

### 14. Submitting before init complete

Module-level `var pool = workerpool.New(N)` runs during package init. If a sibling package's init also submits, ordering matters. Prefer lazy init or explicit construction in `main`.

### 15. Pool inside a goroutine that exits

```go
go func() {
    pool := workerpool.New(8)
    defer pool.StopWait()
    // ...
}()
```

When the goroutine exits, the pool is GC'd. Tasks may not have run. Always make pool lifetime explicit.

---

## Migration Stories

### From a hand-rolled pool to workerpool

Common path. A team has 600 lines of pool code accumulated over years, full of edge cases. They replace it with `workerpool` and a 100-line wrapper. Net: -500 lines, fewer bugs, more familiar code. Win.

### From workerpool to ants

Triggered by needing runtime resize, typed args, or higher throughput. Migration is mechanical (Appendix W in senior file). Effort: a day. Gain: configurability.

### From workerpool to tunny

Triggered by needing per-worker state. Migration is significant — the API shape is different. Effort: a week. Gain: stateful workers.

### From workerpool to errgroup.SetLimit

Triggered by realizing you didn't actually need a pool — just bounded concurrency for one batch. Migration is trivial. Effort: an hour. Gain: less infrastructure.

### From ants to workerpool

Less common but happens. Usually because the team realised they were using only the simple part of `ants`'s API and wanted simpler. Effort: a day. Gain: smaller surface area.

The lesson: migrations are easy when libraries share semantics. Hard when they differ. Stay flexible about which library you use; what you write *inside* the tasks is what matters.

---

## Failure Modes and Defences

A defensive checklist for any production pool.

| Failure | Defence |
|---------|---------|
| Task hangs on I/O | `context.WithTimeout` + check `ctx.Done()` in task |
| Task panics | `defer recover()` inside task closure |
| Producer outruns consumer | Bounded queue via semaphore, drop or block |
| Memory grows from large closures | Audit captured state; pass by reference where safe |
| Pool not shutdown on exit | `defer pool.StopWait()` or explicit shutdown phase |
| Shutdown takes forever | Deadline + hard stop fallback |
| Tasks lost on hard stop | Accept the loss; metric the count |
| Downstream rate limit | `rate.Limiter` in front of submit |
| Tenant noisy neighbour | Per-tenant pool or token bucket |
| Two pools deadlock | Async hand-off via channels |
| Worker pool overflows OS limits | Cap `maxWorkers`; monitor open FDs |
| GOMAXPROCS mismatch | Size from `runtime.GOMAXPROCS(0)` |
| Slow tasks block batch progress | Per-task timeout |
| Pool not observable | Wrap with metrics |
| Panic logs missing context | Log task name + relevant IDs in the deferred recover |

Each row corresponds to an incident pattern we have seen. Implementing every defence may be overkill for your service; implementing none is reckless. Pick based on stakes.

---

## Pool as Part of System Architecture

A pool is one component in a larger system. Its place in the architecture affects how you treat it.

### Pool inside a request hot path

Used for background fan-out from a synchronous handler. The handler responds before the pool tasks complete.

Design:

- Pool is shared, package-scope.
- Submission is fire-and-forget.
- Tasks are idempotent (retry-safe).
- A separate process or job catches up on failed tasks.

### Pool for batch processing

Used for periodic work — a cron-like job that processes a queue.

Design:

- Pool is constructed at job start, drained at job end.
- Tasks include their own error handling.
- A retry layer wraps failed tasks for the next run.

### Pool inside a pipeline

Used as one stage among several.

Design:

- Each stage has its own pool.
- Inter-stage hand-off via bounded channels (so each stage has backpressure to upstream).
- Drain stages in order during shutdown.

### Pool inside a library

Used by a library to manage its own concurrency without exposing the pool to callers.

Design:

- The library should accept a pool or pool size as a configuration parameter.
- Default to a sensible size based on common workloads.
- Document the resource usage so callers can plan.

---

## Multi-Tenant Isolation

A pool serving multiple tenants is a target. One noisy tenant can:

- Saturate the pool with their tasks.
- Hold workers via slow downstreams.
- Eat queue capacity.

Mitigations:

### 1. Per-tenant pool

A separate `workerpool.WorkerPool` per tenant. Total resource use scales with tenant count; only practical for tens of tenants.

### 2. Per-tenant token bucket

One shared pool, but each tenant has an in-flight cap.

```go
type TenantTokens struct {
    mu     sync.Mutex
    bucket map[string]int
    cap    int
}

func (tt *TenantTokens) Acquire(tenant string) bool {
    tt.mu.Lock()
    defer tt.mu.Unlock()
    if tt.bucket[tenant] >= tt.cap {
        return false
    }
    tt.bucket[tenant]++
    return true
}

func (tt *TenantTokens) Release(tenant string) {
    tt.mu.Lock()
    defer tt.mu.Unlock()
    tt.bucket[tenant]--
}
```

Submit only if `Acquire` succeeds.

### 3. Per-tenant queue cap

Track the number of queued tasks per tenant. Reject new submits for tenants over their cap.

### 4. Pool sharding by tenant hash

`tenantID % shards` selects the pool. Total pools = `shards`. Tenants share a pool but cannot stalk each other (they get different shards via hashing).

This bounds the worst case: a noisy tenant only affects others on the same shard.

### Choosing among these

For 10 tenants: per-tenant pool.
For 1,000 tenants: per-tenant token bucket + shared pool.
For 10,000 tenants: pool sharding + per-tenant tokens within each shard.
For 100,000+ tenants: don't run them in one process. Shard at the service level.

---

## Cost Accounting

Pools consume resources. Production engineers should be able to answer "how much does this pool cost us?"

### Memory cost

- Per-pool: ~5-50 KB.
- Per-worker: ~2-8 KB stack.
- Per-queue-entry: variable (closure size).
- Total: `5 KB + maxWorkers * 4 KB + queueSize * closureSize`.

For typical values (50 workers, 100 closures of 200 bytes): 5 + 200 + 20 = 225 KB. Negligible.

For pathological values (50 workers, 100,000 closures of 2 KB): 5 + 200 + 200,000 = 200 MB. Real.

### CPU cost

- Per submit: ~200 ns.
- Per task: dominated by the task itself.
- Dispatcher: idle CPU (just parked in `select`).

For a pool doing 10,000 submits/second: 10,000 * 200ns = 2 ms/second = 0.2% of one core. Negligible.

For a pool doing 1,000,000 submits/second: 20% of one core. Significant. Consider sharding or `ants`.

### Downstream cost

If each task makes a downstream call:

- 50 workers × 1 call per task × per-call cost.
- For a paid API at $0.001/call and a million tasks/day: $1,000/day. Significant.

Optimisation: cache, batch, deduplicate.

### Engineering cost

The wrapper code. Metrics dashboards. Alerts. Documentation. Code reviews.

Per pool, expect 100-300 lines of wrapper + ~50 lines of dashboard YAML + ~50 lines of alert rules + 1 day of engineer time per quarter to maintain.

For a service with 5 pools, that's a tangible engineering investment. Worth it for production-grade services.

---

## Performance Engineering

When a pool's performance becomes a bottleneck, here are the steps.

### Step 1: Measure

```bash
go test -bench=Submit -benchmem
go test -bench=Submit -cpuprofile cpu.prof
go test -bench=Submit -memprofile mem.prof
```

Identify what is slow: submit overhead, task execution, GC pressure?

### Step 2: Reduce closure allocation

Per-submit allocation is the most common scalable cost. Reduce by:

- Smaller captured state (pass references not values).
- Pre-allocate captured state outside the loop.
- Use `ants.PoolWithFunc` to avoid closures entirely.

### Step 3: Reduce per-task overhead

For very small tasks (sub-microsecond), the dispatcher hop dominates. Options:

- Batch tasks: submit a closure that does N items.
- Inline: don't use a pool for trivial tasks.
- Move to `ants` (single channel hop instead of two).

### Step 4: Reduce contention

If many goroutines submit simultaneously:

- Shard pools (multiple smaller pools, hash to shard).
- Buffer submissions in a per-goroutine local channel, batch-drain to pool.

### Step 5: Reduce GC pressure

If GC takes >10% of CPU:

- Audit closure capture sizes.
- Use `sync.Pool` for reused objects.
- Tune `GOGC`.

### Step 6: Benchmark again

```
before: 200 ns/op  16 B/op  1 alloc
after:  100 ns/op   0 B/op  0 alloc
```

Document the win. Add a benchmark to your test suite so regressions are caught.

### When *not* to performance-engineer

If your pool does 100 RPS and tasks take 100 ms each, the pool's overhead is 0.0002% of total. Optimising the pool is a waste; optimise the task.

90% of pool performance problems are misallocated effort. Measure first.

---

## Tricky Production Points

### Pool size and GOMAXPROCS

If a container is run with `GOMAXPROCS=1` (some sidecar configurations do this), a CPU-bound pool with `maxWorkers > 1` gains nothing. Always log `runtime.GOMAXPROCS(0)` at startup.

### Pool size and Kubernetes CPU limits

K8s `resources.limits.cpu` doesn't change `GOMAXPROCS` automatically (unless you use the `automaxprocs` library). A pod with `limits.cpu: 2` and `GOMAXPROCS=32` will be throttled. Use `go.uber.org/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

This sets `GOMAXPROCS` to match the CPU limit.

### Stale workers after deploy

If you deploy a new version while old workers are running tasks, the old tasks continue running on old code. Tasks must be backward-compatible across deploys.

### Memory leaks from forgotten pools

`pprof` `goroutine` is the diagnostic. If you see many `workerpool.dispatch` goroutines, you have leaked pools.

### Pool inside test code

```go
func TestSomething(t *testing.T) {
    pool := workerpool.New(4)
    defer pool.StopWait()
    // ...
}
```

`defer` runs at the end of the test. But if `t.Parallel()` is involved, the test may not actually finish before the next test starts. Use `t.Cleanup` for explicit ordering.

### Race detector slowness with pools

`-race` adds ~10x latency to channel operations. A pool that handles 1M tasks/sec in production might do 100K under race. Tests that depend on rate may need adjustment.

### Pool that survives a `panic` in main

If `main()` panics and `defer pool.StopWait()` was set up, the defer runs. Pool drains. But the panic still propagates. Useful for crash logging — the drain happens, then the panic continues.

### Multiple panics in tasks

Each task panic is recovered independently. The library does not aggregate or sample. If many tasks panic, you get many log entries. Consider a panic-rate metric to alert on bursts.

### Task that calls `os.Exit`

Bypasses recover. Pool, program, everything dies. Don't call `os.Exit` from inside a pool task unless that's exactly your intent.

### Task that calls `runtime.LockOSThread`

The worker goroutine now owns an OS thread until `UnlockOSThread`. Other workers are unaffected, but the worker cannot be reaped while locked (it must return from the task to be reaped). Be careful: long-running locked tasks pin a thread per task.

---

## Test

A production-style test for a pool wrapper.

```go
func TestPool_Submit_NormalFlow(t *testing.T) {
    p := New(Options{
        Name: "test", MaxWorkers: 4, QueueCap: 100,
        Logger: slog.Default(),
        Registerer: prometheus.NewRegistry(),
    })
    defer p.Stop(5 * time.Second)

    var counter int64
    for i := 0; i < 100; i++ {
        err := p.Submit(context.Background(), "increment", func(ctx context.Context) error {
            atomic.AddInt64(&counter, 1)
            return nil
        })
        if err != nil {
            t.Fatalf("submit: %v", err)
        }
    }
    p.Stop(5 * time.Second)
    if atomic.LoadInt64(&counter) != 100 {
        t.Fatalf("counter = %d, want 100", counter)
    }
}

func TestPool_FullQueue(t *testing.T) {
    p := New(Options{
        Name: "test", MaxWorkers: 1, QueueCap: 5,
        Logger: slog.Default(),
        Registerer: prometheus.NewRegistry(),
    })
    defer p.Stop(5 * time.Second)

    // Block the only worker.
    block := make(chan struct{})
    err := p.Submit(context.Background(), "blocker", func(ctx context.Context) error {
        <-block
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    // Fill the queue cap.
    for i := 0; i < 5; i++ {
        err := p.Submit(context.Background(), "task", func(ctx context.Context) error {
            return nil
        })
        if err != nil {
            t.Fatalf("submit %d: %v", i, err)
        }
    }

    // Next submit should be rejected.
    err = p.Submit(context.Background(), "overflow", func(ctx context.Context) error {
        return nil
    })
    if err == nil {
        t.Fatal("expected overflow rejection")
    }

    close(block)
}

func TestPool_Panic(t *testing.T) {
    var loggedPanic atomic.Bool
    logger := slog.New(testLogHandler(func(rec slog.Record) {
        if rec.Message == "task panic" {
            loggedPanic.Store(true)
        }
    }))

    p := New(Options{
        Name: "test", MaxWorkers: 1, QueueCap: 10,
        Logger: logger,
        Registerer: prometheus.NewRegistry(),
    })
    defer p.Stop(5 * time.Second)

    p.Submit(context.Background(), "panicker", func(ctx context.Context) error {
        panic("boom")
    })
    p.Stop(5 * time.Second)
    if !loggedPanic.Load() {
        t.Fatal("panic not logged")
    }
}

func TestPool_StopDeadline(t *testing.T) {
    p := New(Options{
        Name: "test", MaxWorkers: 1, QueueCap: 100,
        Logger: slog.Default(),
        Registerer: prometheus.NewRegistry(),
    })

    block := make(chan struct{})
    p.Submit(context.Background(), "slow", func(ctx context.Context) error {
        <-block
        return nil
    })

    start := time.Now()
    dropped := p.Stop(100 * time.Millisecond)
    elapsed := time.Since(start)

    if elapsed > 200*time.Millisecond {
        t.Fatalf("Stop didn't honour deadline: took %s", elapsed)
    }
    _ = dropped
    close(block)
}
```

These tests exercise normal flow, full queue, panic recovery, and shutdown deadline — the four bedrock contracts of a production pool wrapper.

---

## Cheat Sheet

```
Sizing:
  CPU-bound:    maxWorkers = NumCPU
  I/O-bound:    maxWorkers = avg_latency * target_rps, capped by downstream
  Mixed:        size to I/O dimension

Always have:
  - Bounded queue (semaphore)
  - Per-task timeout (context)
  - Panic recovery (defer recover)
  - Shutdown deadline (drain in goroutine, select on timer)

Metrics (minimum 6):
  - submitted_total (counter)
  - completed_total (counter, labels: ok/panic/error)
  - queue_depth (gauge)
  - task_duration_seconds (histogram)
  - queue_dwell_seconds (histogram)
  - dropped_total (counter)

Alerts (minimum 5):
  - queue_depth high for 5m
  - panic rate elevated
  - drop rate non-zero
  - p99 task duration spike
  - pool stopped unexpectedly

K8s lifecycle:
  - preStop: sleep 5s (LB drain)
  - SIGTERM: server.Shutdown(ctx) then pool.Stop(deadline)
  - Readiness: 503 once pool.Stopped()

Cost:
  - Memory: ~5 KB + maxWorkers*4 KB + queueSize*closureSize
  - CPU per submit: ~200 ns
  - Dispatcher: idle
```

Memorise this; refer back as needed.

---

## Self-Assessment Checklist

- [ ] I can derive `maxWorkers` from workload latency and target throughput.
- [ ] I can list at least 6 metrics every production pool should emit.
- [ ] I can write a graceful shutdown with a deadline + hard-stop fallback.
- [ ] I can describe the K8s lifecycle integration for a pool.
- [ ] I can spot the four classic incident patterns (hung downstream, unbounded queue, cascading slowdown, reaping surprise) from symptoms.
- [ ] I can build a production wrapper with metrics, logging, recovery, and bounded queue.
- [ ] I can plan capacity from observed metrics (mean, peak, latency).
- [ ] I can explain when to drain vs hard-stop.
- [ ] I can identify pool anti-patterns in PR review.
- [ ] I can decide when to wrap `workerpool` vs migrate to `ants`.

If all yes, you have professional-level fluency with `workerpool` and pool-based architectures in general.

---

## Summary

`gammazero/workerpool` is a small library; using it in production is a substantial discipline. The library itself does almost nothing wrong; almost every pool-related production incident comes from how it was wrapped, sized, observed, or shut down.

The professional engineer's job is to bring guards, observability, and operational wisdom around a small, trustable primitive. Six items to take from this file:

1. **Size deliberately.** Math, not vibes.
2. **Bound the queue.** Always, if the producer can outrun the consumer.
3. **Wrap with metrics.** A pool you cannot see is a pool you cannot operate.
4. **Drain with deadline.** Bound your shutdown time.
5. **Recover panics with attribution.** Silent panics are silent bugs.
6. **Learn from incidents.** Each story above is a real lesson; collect your own.

The next files — specification, interview, tasks, find-bug, optimize — are practical. They sharpen specific skills. The professional file is the philosophy underlying them.

---

## What You Can Build

At professional level you can build:

- A production-grade background-task service for any company.
- A pool wrapper that survives audits.
- Capacity plans, alerts, dashboards.
- Migrations between pool libraries.
- Pool-aware shutdown stories that meet SLAs.

You can also lead reviews of teammates' pool code with authority.

---

## Further Reading

- The library's source (Senior file).
- Brendan Gregg, "Systems Performance" — for capacity planning.
- "Site Reliability Engineering" by Google — incident response and post-mortems.
- "The Twelve-Factor App" — the "concurrency" factor specifically.
- Real post-mortems on GitHub for "panjf2000/ants" or "workerpool" issues — lessons from others.

---

## Related Topics

- **Rate limiting** (`golang.org/x/time/rate`) — companion to pools.
- **Circuit breakers** (`sony/gobreaker`) — protect against bad downstreams.
- **Graceful shutdown** patterns — broadly applicable.
- **Backpressure** theory — Little's Law and friends.
- **Observability stacks** — Prometheus, OpenTelemetry, Grafana.

---

## Diagrams and Visual Aids

### A complete production architecture

```
                    HTTP request
                          │
                          ▼
                  ┌──────────────┐
                  │ http server  │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        respond OK             pool.Submit(ctx, ...)
                                      │
                                      ▼
                             ┌─────────────────┐
                             │  Pool wrapper   │
                             │ - sem cap 1000  │
                             │ - metrics       │
                             │ - panic recover │
                             └────────┬────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │  workerpool     │
                            │  maxW = 50      │
                            └────────┬────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │ worker goroutine│
                            │ - rate limit    │
                            │ - context check │
                            │ - downstream call│
                            └────────┬────────┘
                                      │
                                      ▼
                                 downstream
```

Observe: there is a lot more around the pool than the pool itself. Production engineering is mostly the surrounding code.

### Drain timeline

```
T=0    SIGTERM received
T=1s   k8s preStop completes, LB stopped routing
T=1s   server.Shutdown() called
T=4s   server done (existing connections finished)
T=4s   pool.Stop(30s) called
T=4-32s   pool draining
T=32s  if not done, hard stop
T=33s  goroutine count returns to baseline
T=33s  os.Exit(0)
```

Total budget: ~30-35 seconds. Within K8s's default `terminationGracePeriodSeconds: 30`. Tune your defaults.

### Queue depth diagnostic flowchart

```
queue_depth > threshold?
  └─ no → healthy
  └─ yes:
       is it growing?
         └─ no → temporary backpressure, monitor
         └─ yes:
              is downstream healthy?
                └─ no → fix downstream, pool will catch up
                └─ yes:
                     are workers maxed out?
                       └─ yes → size up maxWorkers
                       └─ no → investigate worker stuck states
```

This kind of flowchart, written down and shared with the team, makes on-call faster.

### Multi-pool architecture

```
┌────────────────────────────────────┐
│              Service               │
│                                    │
│  ┌──────────┐  ┌──────────┐       │
│  │ CPU pool │  │ I/O pool │       │
│  │   N=8    │  │  N=128   │       │
│  └────┬─────┘  └────┬─────┘       │
│       │             │              │
│  ┌────▼─────────────▼─────┐       │
│  │ shared infrastructure  │       │
│  │ - logger              │       │
│  │ - metrics registry    │       │
│  │ - shutdown coordinator│       │
│  └────────────────────────┘       │
└────────────────────────────────────┘
```

Two pools, shared infrastructure, coordinated shutdown. Standard pattern for mixed-workload services.

These visualisations should accompany code in your real systems' documentation. Spending an hour on diagrams pays back tenfold in on-call clarity.

---

## Appendix A: Pool Performance Tuning Cookbook

A step-by-step recipe for optimising a pool in production.

### Phase 1: Establish a baseline

Run the service under normal load for at least 24 hours. Collect:

- Pool metrics (submitted/sec, completed/sec, queue depth, task duration).
- Resource metrics (CPU, memory, goroutine count).
- Downstream metrics (latency, error rate).

Note the steady-state values. These are your "normal".

### Phase 2: Identify the bottleneck

Two questions:

1. Are queue depth and dwell time growing over time? → Producer outrunning consumer. Either:
   - Increase `maxWorkers` if downstream allows.
   - Slow producer (rate limit, drop).

2. Is queue stable but tasks are slow? → Task itself is the bottleneck. Profile the task code.

### Phase 3: Apply a targeted fix

For producer-outrunning-consumer:

- Try increasing `maxWorkers` in steps (e.g., 50 → 75 → 100). Watch:
  - Queue depth (should decrease).
  - Downstream latency (should not degrade significantly).
  - Downstream error rate (should not increase).

- If downstream degrades, stop increasing. You found the ceiling.

For slow tasks:

- Profile the task. CPU? I/O? Allocations?
- Optimise the hot path.
- Re-measure.

### Phase 4: Validate

After the change, run for another 24 hours. Compare new metrics to baseline. Verify:

- Queue depth lower or stable.
- No new errors.
- Memory usage stable.
- Downstream healthy.

### Phase 5: Document

Add a comment near the pool's `New` call:

```go
// maxWorkers = 75: increased from 50 on 2024-03-15 after queue depth grew during peaks.
// Validated against downstream limit (100 concurrent allowed).
const taskPoolSize = 75
```

The next engineer (you, in 6 months) will thank you.

---

## Appendix B: Pool-Related On-Call Runbook

A typical incident runbook for pool issues.

### Symptom: "Service is slow"

1. Check pool metrics dashboard.
2. Is queue depth elevated?
   - Yes → backpressure issue. Continue.
   - No → not a pool issue; look elsewhere.

3. Is dwell time elevated?
   - Yes → tasks are queued for long. Capacity issue.
   - No → tasks are running but tasks themselves are slow. Profile.

4. Is downstream latency elevated?
   - Yes → root cause is downstream. Escalate to downstream team.
   - No → continue.

5. Is worker count maxed?
   - Yes → consider increasing `maxWorkers` (hot fix: ramp up via config).
   - No → investigate why workers aren't busy (deadlock? blocked?).

### Symptom: "Memory growing"

1. Check pool metrics. Queue depth?
   - Growing → unbounded queue issue. Hot fix: restart, then add bound.
   - Stable → not pool memory; look at heap profile.

2. Heap profile: is `workerpool` or `deque` in top allocators?
   - Yes → pool memory issue.
   - No → other allocator; look elsewhere.

### Symptom: "Service won't shut down"

1. Look at goroutine dump.
2. Are workers stuck on I/O?
   - Yes → tasks have no timeout. Hot fix: SIGKILL. Long fix: add timeouts.
   - No → continue.

3. Are workers stuck on locks?
   - Yes → deadlock in user code.
   - No → continue.

4. Is dispatcher exited?
   - Yes → workers should follow shortly.
   - No → dispatcher is hung; library bug or pause not cancelled.

### Symptom: "Tasks dropped"

1. Check `dropped_total` metric.
2. Was queue cap hit?
   - Yes → undersized queue or producer too aggressive.
   - No → tasks dropped at Stop time.

3. Is this acceptable?
   - Yes → adjust monitoring threshold.
   - No → increase queue cap or implement durable retry.

A printed runbook by the on-call's desk pays for itself.

---

## Appendix C: Sizing Calculator

Here is a small CLI tool that helps size a pool. Run it with workload parameters.

```go
package main

import (
    "flag"
    "fmt"
)

func main() {
    targetRPS := flag.Float64("rps", 100, "target RPS")
    avgLatency := flag.Float64("latency", 0.1, "avg task latency in seconds")
    p99Latency := flag.Float64("p99", 0.5, "p99 task latency in seconds")
    downstreamCap := flag.Int("downstream", 100, "downstream concurrency cap")
    headroom := flag.Float64("headroom", 0.2, "headroom multiplier (0.2 = 20%)")
    flag.Parse()

    // Based on average
    fromAvg := *targetRPS * *avgLatency

    // Based on p99 (more conservative)
    fromP99 := *targetRPS * *p99Latency

    // Bound by downstream
    bounded := min(fromAvg, float64(*downstreamCap))
    boundedConservative := min(fromP99, float64(*downstreamCap))

    fmt.Printf("Recommendations:\n")
    fmt.Printf("  Aggressive (avg latency, no headroom):     %.0f workers\n", fromAvg)
    fmt.Printf("  Aggressive (avg latency, with headroom):   %.0f workers\n", fromAvg*(1+*headroom))
    fmt.Printf("  Conservative (p99 latency, no headroom):   %.0f workers\n", fromP99)
    fmt.Printf("  Conservative (p99 latency, with headroom): %.0f workers\n", fromP99*(1+*headroom))
    fmt.Printf("\nBounded by downstream cap (%d):\n", *downstreamCap)
    fmt.Printf("  Aggressive bounded:    %.0f\n", bounded)
    fmt.Printf("  Conservative bounded:  %.0f\n", boundedConservative)
    fmt.Printf("\nRecommendation: %d workers\n", int(boundedConservative*(1+*headroom)))
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}
```

Run:

```bash
$ go run ./size-calc -rps 200 -latency 0.05 -p99 0.5 -downstream 100
Recommendations:
  Aggressive (avg latency, no headroom):     10 workers
  Aggressive (avg latency, with headroom):   12 workers
  Conservative (p99 latency, no headroom):   100 workers
  Conservative (p99 latency, with headroom): 120 workers

Bounded by downstream cap (100):
  Aggressive bounded:    10
  Conservative bounded:  100

Recommendation: 120 workers
```

In this example, the conservative bound is the downstream's 100, and with headroom you'd want 120 — but the downstream caps you, so settle for 100 and monitor.

Use this tool when introducing a new pool. Save the parameters in your codebase as comments.

---

## Appendix D: Pool Memory Math

Detailed memory accounting.

### Goroutine stacks

Go allocates 2-8 KB per goroutine, growing as needed. For pool purposes:

- Dispatcher: 1 goroutine × ~4 KB = 4 KB.
- Workers (active): N goroutines × ~4 KB = 4N KB.

### Channel buffers

`workerpool` uses unbuffered channels. Their internal state is ~96 bytes each, total <1 KB.

### Deque (waiting queue)

The deque starts small (16 slots) and doubles. Each slot is a `func()` pointer (8 bytes) plus a small overhead.

For a queue with Q entries:
- Backing array: ~Q * 8 bytes plus growth slack.
- Closures themselves: Q * closure_size, where closure_size depends on captures.

### Captured closures

This is usually the biggest contributor. A simple closure with no captures: ~32 bytes (interface header + func ptr). With captures, add the captured data.

If you capture a `*MyStruct` pointer: +8 bytes.
If you capture a `[]byte` (small): +24 bytes (slice header).
If you capture a `[]byte` (1 KB): +1024 bytes (the slice may share backing).
If you capture a 1 KB struct by value: +1024 bytes (always copied).

For typical webhook closures: ~200 bytes per closure.

### Worked example

A pool with `maxWorkers = 50`, queue cap = 10,000, typical closure size 200 bytes:

- Goroutines (peak): 1 + 50 = 51 × 4 KB = 204 KB
- Channels: 1 KB
- Deque backing: 10,000 × 8 = 80 KB
- Closures: 10,000 × 200 = 2 MB
- Total: ~2.3 MB at peak queue

This scales linearly with queue depth. If queue depth is 100,000, you are at 23 MB.

For 100 such pools (e.g., per-tenant), it's 230 MB minimum. Still tractable, but it adds up.

### Memory pressure thresholds

Some heuristics:

- Pool memory < 1% of container limit: no concern.
- 1-5%: monitor.
- 5-15%: actively manage queue cap, audit closure sizes.
- 15%+: probably should refactor.

If your container is 1 GB and your pool is using 200 MB (20%), you have a memory problem to fix.

---

## Appendix E: Pool Throughput Math

How much throughput can a pool sustain?

### CPU-bound

Throughput = `maxWorkers * tasks_per_second_per_worker`.

If each task takes 100 µs of CPU and you have 8 cores (worker = core):
- Per-worker rate: 1 / 100 µs = 10,000 tasks/sec.
- Total: 8 × 10,000 = 80,000 tasks/sec.

### I/O-bound

Throughput = `maxWorkers / avg_task_latency`.

If each task takes 100 ms of I/O wait and you have 100 workers:
- Total: 100 / 0.1s = 1,000 tasks/sec.

### Mixed

Take the smaller of the two calculations.

### Pool overhead

Per-submit cost is ~200 ns. For 1M tasks/sec, that's 200 ms/sec = 20% of one core just for submits. Realistic limit before the dispatcher becomes a bottleneck: ~5M tasks/sec on modern hardware.

For higher throughput: shard pools or use `ants`.

### Worked example

A service expects 1,000 background notification deliveries per second. Each delivery is an HTTP call with 50 ms latency.

- Workers needed: 1,000 * 0.05 = 50 workers minimum.
- With 20% headroom: 60.
- With p99 latency (200 ms): 1,000 * 0.2 = 200 workers for p99-driven sizing.
- Final: 60 workers if you're OK with occasional queueing under p99 conditions; 200 if you must avoid queueing entirely.

Pick based on tail-tolerance. For most services, 60 is fine; the queue absorbs spikes.

---

## Appendix F: A Year in the Life of a Pool

A narrative example. Suppose your service launches in January with a pool, and we trace its evolution.

### January (Launch)

- Initial setup: `pool := workerpool.New(20)`.
- Wrapper: basic metrics, panic recovery.
- Load: 50 RPS, queue depth ~0.
- All good.

### March (Growth)

- Load doubles to 100 RPS.
- Queue depth occasional spikes to 50 during traffic bursts.
- Monitoring shows healthy ratios.
- No change needed.

### June (Incident 1)

- Downstream API has a one-hour incident: 5x latency.
- Pool queue grows to 5,000. Memory spike. No OOM, but close.
- After incident: add bounded queue (semaphore, cap 1,000).
- Lesson: unbounded queues are fine when everything works, dangerous when it doesn't.

### August (Growth)

- Load triples to 300 RPS.
- Bounded queue starts dropping under bursts.
- Investigation: 20 workers is too few. Resize to 40.
- Drops stop.

### October (Tenant Onboarding)

- Major customer adds 10x their previous traffic.
- One tenant now consumes most pool capacity. Other tenants see degraded service.
- Add per-tenant token bucket. Each tenant gets max 20 concurrent.
- Fairness restored.

### December (Year-End Sale)

- Traffic spikes 5x for Black Friday week.
- Pool scaled up to 100 workers temporarily.
- After sale: scale back to 40.
- Lesson: have a config knob for `maxWorkers` so resize is a config change, not a deploy.

### Following January (Retrospective)

A year of pool work:
- Wrapper grew from 50 lines to 200.
- Configuration knobs: max workers, queue cap, per-tenant cap.
- Metrics: 6 → 12 (added per-tenant breakdowns).
- Alerts: 5 → 8 (added per-tenant alerts).
- Incidents directly attributable to the pool: 0. (The downstream incident in June was outside the pool's responsibility; it just happened to surface there.)

This is a typical evolution. A pool is not "set and forget"; it grows with the service.

---

## Appendix G: Pool Anti-Heroes — Code Patterns to Avoid

A gallery of "do not write this in production".

### Anti-hero 1: The Bare Pool

```go
pool := workerpool.New(8)
for x := range work {
    pool.Submit(func() { process(x) })
}
pool.StopWait()
```

No wrapper, no metrics, no error handling, no timeouts, no captured-variable shadow. This is fine for a CLI tool. Not for production.

### Anti-hero 2: The Optimistic Pool

```go
pool := workerpool.New(1000) // because we might need it
```

1000 workers is rarely the right number. It's a sign that the engineer didn't measure.

### Anti-hero 3: The Stoic Pool

```go
pool.Submit(func() {
    if err := work(); err != nil {
        // silently ignore
    }
})
```

Errors are dropped on the floor. Production lesson: if you didn't log it, it didn't happen.

### Anti-hero 4: The Panicker

```go
pool.Submit(func() {
    panic(getStuff())
})
```

If `getStuff` ever returns nil that you don't expect, you panic. The library recovers. You never know it happened. Validate inputs explicitly.

### Anti-hero 5: The Inheritor

```go
type MyPool struct {
    *workerpool.WorkerPool // embed
}
```

Now `MyPool` exposes the library's full API plus your additions. Hard to change behaviour (e.g., wrap `Submit`). Prefer composition (named field, not embed).

### Anti-hero 6: The Global

```go
var Pool = workerpool.New(8)
```

A package-level variable is fine for some uses, but it makes testing hard. Prefer dependency injection: create the pool in `main`, pass it to constructors.

### Anti-hero 7: The Long-Liver

```go
func process(items []Item) {
    pool := workerpool.New(8)
    defer pool.StopWait()
    // do work for an hour
}
```

A pool inside an hour-long function holds the dispatcher and workers for an hour. That's fine if the function legitimately needs them. But if the function only uses the pool for 10 minutes of that hour, you've wasted 50 minutes of goroutine residence.

Better: hoist the pool to a higher scope or stop it sooner.

### Anti-hero 8: The Double Stopper

```go
pool := workerpool.New(8)
defer pool.StopWait()
// ...
pool.Stop() // accidentally drops queued work
// later
pool.StopWait() // returns immediately, but queued tasks are gone
```

If both stop methods are called, the first one wins. The intent (drain vs discard) is determined by the first call. Avoid mixing.

### Anti-hero 9: The Submit-Then-Stop Race

```go
go func() {
    for {
        pool.Submit(work)
    }
}()
pool.StopWait()
```

The submitter loops forever. The submit calls after `StopWait` are silently dropped. The goroutine never exits. Always check `Stopped` in a submission loop.

### Anti-hero 10: The Confused Mixer

```go
g, ctx := errgroup.WithContext(ctx)
pool := workerpool.New(8)
for _, item := range items {
    g.Go(func() error {
        pool.Submit(func() { /* ... */ })
        return nil
    })
}
g.Wait()  // returns before pool tasks finish
pool.StopWait()
```

Mixing `errgroup` and `workerpool` for the same tasks. Pick one. We covered this in the senior file.

---

## Appendix H: Real Example - Webhook Delivery Service

A complete production-style webhook delivery service using `workerpool`.

```go
package webhooks

import (
    "bytes"
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "runtime/debug"
    "sync"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
    "github.com/prometheus/client_golang/prometheus"
)

type Service struct {
    pool       *workerpool.WorkerPool
    log        *slog.Logger
    client     *http.Client
    sem        chan struct{}
    tenantCaps map[string]chan struct{}
    tenantMu   sync.RWMutex

    submitted  prometheus.Counter
    completed  *prometheus.CounterVec
    duration   prometheus.Histogram
    dropped    *prometheus.CounterVec
    queueDepth prometheus.Gauge

    stopped atomic.Bool
}

type Webhook struct {
    TenantID string
    URL      string
    Body     []byte
}

func New(maxWorkers, queueCap int, log *slog.Logger, reg prometheus.Registerer) *Service {
    s := &Service{
        pool: workerpool.New(maxWorkers),
        log:  log,
        client: &http.Client{
            Timeout: 30 * time.Second,
        },
        sem:        make(chan struct{}, queueCap),
        tenantCaps: make(map[string]chan struct{}),

        submitted: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "webhook_submitted_total",
        }),
        completed: prometheus.NewCounterVec(prometheus.CounterOpts{
            Name: "webhook_completed_total",
        }, []string{"result"}),
        duration: prometheus.NewHistogram(prometheus.HistogramOpts{
            Name:    "webhook_duration_seconds",
            Buckets: prometheus.ExponentialBuckets(0.01, 2, 10),
        }),
        dropped: prometheus.NewCounterVec(prometheus.CounterOpts{
            Name: "webhook_dropped_total",
        }, []string{"reason"}),
        queueDepth: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "webhook_queue_depth",
        }),
    }
    reg.MustRegister(s.submitted, s.completed, s.duration, s.dropped, s.queueDepth)
    go s.gaugeLoop()
    return s
}

const tenantConcurrencyCap = 10

func (s *Service) tenantSem(tenantID string) chan struct{} {
    s.tenantMu.RLock()
    c, ok := s.tenantCaps[tenantID]
    s.tenantMu.RUnlock()
    if ok {
        return c
    }
    s.tenantMu.Lock()
    defer s.tenantMu.Unlock()
    c, ok = s.tenantCaps[tenantID]
    if ok {
        return c
    }
    c = make(chan struct{}, tenantConcurrencyCap)
    s.tenantCaps[tenantID] = c
    return c
}

func (s *Service) Deliver(ctx context.Context, w Webhook) error {
    if s.stopped.Load() {
        s.dropped.WithLabelValues("stopped").Inc()
        return errors.New("service stopped")
    }
    select {
    case s.sem <- struct{}{}:
    case <-ctx.Done():
        s.dropped.WithLabelValues("context").Inc()
        return ctx.Err()
    default:
        s.dropped.WithLabelValues("full").Inc()
        return errors.New("queue full")
    }

    tCap := s.tenantSem(w.TenantID)
    select {
    case tCap <- struct{}{}:
    default:
        <-s.sem
        s.dropped.WithLabelValues("tenant_cap").Inc()
        return fmt.Errorf("tenant %q over capacity", w.TenantID)
    }

    s.submitted.Inc()
    s.pool.Submit(func() {
        start := time.Now()
        result := "ok"
        defer func() {
            <-s.sem
            <-tCap
            if r := recover(); r != nil {
                result = "panic"
                s.log.Error("webhook delivery panic",
                    "tenant", w.TenantID,
                    "url", w.URL,
                    "panic", r,
                    "stack", string(debug.Stack()))
            }
            s.completed.WithLabelValues(result).Inc()
            s.duration.Observe(time.Since(start).Seconds())
        }()
        if err := s.deliverOne(ctx, w); err != nil {
            result = "error"
            s.log.Warn("webhook delivery failed",
                "tenant", w.TenantID,
                "url", w.URL,
                "err", err)
        }
    })
    return nil
}

func (s *Service) deliverOne(ctx context.Context, w Webhook) error {
    req, err := http.NewRequestWithContext(ctx, "POST", w.URL, bytes.NewReader(w.Body))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")
    resp, err := s.client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return fmt.Errorf("HTTP %d", resp.StatusCode)
    }
    return nil
}

func (s *Service) gaugeLoop() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        if s.stopped.Load() {
            return
        }
        s.queueDepth.Set(float64(s.pool.WaitingQueueSize()))
    }
}

func (s *Service) Shutdown(ctx context.Context) error {
    s.stopped.Store(true)
    s.log.Info("webhook service draining", "queue", s.pool.WaitingQueueSize())

    done := make(chan struct{})
    go func() {
        s.pool.StopWait()
        close(done)
    }()

    select {
    case <-done:
        s.log.Info("webhook service drained cleanly")
        return nil
    case <-ctx.Done():
        dropped := s.pool.WaitingQueueSize()
        s.log.Warn("drain deadline; hard stop", "dropped", dropped)
        s.pool.Stop()
        <-done
        return ctx.Err()
    }
}

// Ensure JSON-encoding utility is used
var _ = json.Marshal
```

This service:

- Bounds total queue at `queueCap`.
- Bounds per-tenant concurrency at 10.
- Times out each HTTP call at 30 seconds.
- Recovers panics with stack traces.
- Emits 5 metrics with labels.
- Logs slow operations.
- Shuts down with deadline.

It's about 200 lines. You can drop this into a service and ship.

---

## Appendix I: Pool Patterns Across Industries

Different industries develop different pool habits.

### Fintech

Strict latency SLAs. Pool sizing is conservative; tail latency is everything. Pools are typically small (matched to downstream limits). Circuit breakers are standard.

### Ad-tech

Throughput over latency. Pools are large, queues are large, drops are acceptable. Adaptive sizing is common.

### IoT/Telemetry

Massive parallelism for incoming data, small parallelism for outgoing actions. Often two pools per service.

### E-commerce

Bursty traffic (sales, promotions). Pools sized for steady state with scale-out for bursts. Per-customer quotas.

### Media/Streaming

CPU-bound transcoding workloads. `tunny` more common than `workerpool` (per-worker codec state). Worker pools are massive (per-core), tightly controlled.

### Banking

Worker pools are rare. Banking systems often use thread-per-request (Java) or process-per-request (mainframe). Where pools exist, they're heavily audited and small.

### Gaming

Many small fast tasks. Submit overhead matters. Often hand-rolled or `ants`.

Your industry's conventions are not laws, but they reflect accumulated wisdom. Talk to peers in your industry; copy what works.

---

## Appendix J: Pool Naming Conventions

A small thing, but worth doing right.

### Bad names

- `pool`
- `wp`
- `workerPool`
- `taskPool`
- `defaultPool`

### Good names

- `webhookDeliveryPool`
- `imageResizePool`
- `dbWritePool`
- `legacySyncPool`

The name conveys *purpose*. When you grep for "webhookDeliveryPool" across the codebase, you find every call site. When you grep for "pool", you find every variable.

For metrics labels, use the same name (lowercased, snake_case):

```go
prometheus.Labels{"pool": "webhook_delivery"}
```

This way, dashboards and alerts speak the same language as the code.

---

## Appendix K: Pool Documentation Conventions

In each file that creates or uses a pool, document:

1. The *purpose* of the pool.
2. The *sizing reasoning*.
3. The *failure mode* (what happens under load).
4. The *shutdown behaviour*.
5. The *metrics* exposed.

A doc comment example:

```go
// webhookPool delivers customer webhooks. Sized to match downstream API
// concurrency (max 100, leaving 20 for other services). The queue is capped
// at 10,000 deliveries; overflow is dropped and queued for re-delivery via
// the retry service. Pool drains on SIGTERM with a 25-second deadline.
//
// Metrics: webhook_submitted_total, webhook_completed_total{result},
// webhook_duration_seconds, webhook_queue_depth, webhook_dropped_total{reason}.
var webhookPool = newWebhookPool(80, 10000)
```

This documentation makes the pool's role explicit. Anyone reading the code knows the *why* without spelunking.

---

## Appendix L: Cross-Service Pool Coordination

When multiple services share a downstream, their pools collectively affect it.

### The problem

Service A has `maxWorkers = 50` calling Downstream X.
Service B has `maxWorkers = 50` calling Downstream X.
Downstream X allows 80 concurrent.

When both services run at peak, they may saturate X with 100 concurrent, exceeding the 80 limit. X starts returning errors. Both services see degraded downstream.

### The solution

1. **Account for total concurrency across all callers.** Sum of all `maxWorkers` should be < downstream limit.

2. **Use a service discovery / quota system.** Downstream X exposes quotas; callers must respect them.

3. **Implement coordinated rate limiting.** Each service contributes to a distributed token bucket.

4. **Talk to the downstream team.** Often the simplest answer.

This is beyond `workerpool` itself, but `workerpool`-sized services contribute to the problem. Senior engineers think system-wide.

---

## Appendix M: Pool Versioning

`workerpool` follows semver. Major version (v1) has been stable for years. Minor versions add features (`Pause`). Patch versions are bug fixes.

In your `go.mod`:

```
require github.com/gammazero/workerpool v1.1.3
```

For a stable service, pin to a specific patch. For active development, accept minor updates with `~1.1.0` (no — Go uses Minimum Version Selection; pin specifically).

When upgrading:
- Read the changelog.
- Run your test suite.
- Deploy to staging first.
- Watch metrics for any change.

The library is stable enough that upgrades rarely break things. But every dependency upgrade is a small risk.

---

## Appendix N: Pool Lifecycle in CI/CD

How does the pool fit into your deployment pipeline?

### CI tests

Tests should:
- Create a pool, submit a known number of tasks, verify all ran.
- Test bounded queue rejection.
- Test panic recovery.
- Test shutdown deadline.
- Run with `-race`.

### Staging deploys

Staging should have realistic traffic patterns. If your pool is sized for 1000 RPS but staging only handles 10 RPS, you cannot test for the right behaviour.

Use traffic replay or load generators to exercise the pool in staging.

### Production deploys

Deploy gradually:
- Canary 1% of traffic to new version.
- Watch pool metrics: any change?
- Ramp to 10%, 50%, 100%.

If a deploy doubles queue depth, roll back. The pool's behaviour is a deploy-quality signal.

### Rollback procedure

If a pool change goes wrong:
- Immediate: scale up resources or roll back the deploy.
- Short-term: adjust `maxWorkers` via config (if hot-reload supported).
- Long-term: investigate the root cause.

A clear rollback path is part of professional pool ownership.

---

## Appendix O: Pool Patterns Across Cloud Providers

Cloud providers offer alternatives to in-process pools. When does `workerpool` lose to them?

### AWS Lambda

If your work is "burst of independent tasks", Lambda + SQS scales horizontally without an in-process pool. Each task is its own Lambda invocation. No pool to size.

When to prefer Lambda: bursty workloads with no shared state.
When to prefer `workerpool`: in-process state, low latency, predictable load.

### Google Cloud Tasks

Cloud Tasks is a managed work queue. You enqueue tasks; the platform delivers them to your HTTP service. Built-in retry, deadline, rate limiting.

When to prefer Cloud Tasks: cross-service work, durability matters.
When to prefer `workerpool`: in-process, low overhead per task.

### Kubernetes Jobs

For batch processing, K8s Jobs run a pod to completion. Each pod runs its work without a pool, or with a single-process pool. You scale by spawning more pods.

When to prefer Jobs: large-scale batch, requires isolation.
When to prefer `workerpool` inside a Job: many small tasks within one Job.

### Goroutine pools in a managed runtime

Some platforms (Cloudflare Workers, Deno Deploy) limit goroutine creation. `workerpool` may need adjustment.

### Decision framework

- Throughput < 100 RPS: in-process pool is fine.
- 100-10K RPS: in-process pool with bounded queue.
- 10K-100K RPS: in-process pool + horizontal scaling.
- 100K+ RPS: distribution, possibly serverless.

`workerpool` shines in the 100-10K range. Below, it's overkill. Above, distribution matters more than the pool library.

---

## Appendix P: Pool Auditing Checklist

When auditing a pool's production-readiness, check:

### Configuration

- [ ] `maxWorkers` derived from workload characteristics (not a magic number)?
- [ ] Queue cap set (bounded)?
- [ ] Tunable via config without redeploy?

### Lifecycle

- [ ] `New` paired with `StopWait` (or equivalent)?
- [ ] Shutdown has a deadline?
- [ ] Producers stop before pool drains?

### Tasks

- [ ] Each task has a timeout (context.WithTimeout)?
- [ ] Each task captures variables correctly (shadow or 1.22+)?
- [ ] Each task is goroutine-safe re: shared state?

### Error handling

- [ ] Errors collected (not silently dropped)?
- [ ] Panics recovered with attribution?

### Observability

- [ ] At least 6 metrics emitted?
- [ ] Slow tasks logged?
- [ ] Panic stacks logged?

### Alerts

- [ ] Queue depth alert?
- [ ] Panic rate alert?
- [ ] Drop rate alert?
- [ ] Duration p99 alert?
- [ ] Stopped alert?

### Documentation

- [ ] Pool purpose documented?
- [ ] Sizing reasoning recorded?
- [ ] Runbook reference?

### Testing

- [ ] Tests for normal flow?
- [ ] Tests for queue full?
- [ ] Tests for panic recovery?
- [ ] Tests for shutdown deadline?
- [ ] Tests run with `-race`?

A pool that passes all 18 checks is production-ready.

A pool that fails some is *workable* — you can still ship, but with risk awareness.

---

## Appendix Q: Career Notes

A meta-observation: developers who can build production-grade pools tend to be valued. Why?

- Concurrency mastery is hard.
- Operational thinking (metrics, alerts, runbooks) is rarer than coding.
- Pools touch many parts of system design (rate limiting, capacity, backpressure).
- The ability to *not* over-engineer (use a small library well) is mature.

In interviews, you can demonstrate these skills by:

- Explaining how you sized a pool.
- Recounting a pool-related incident.
- Sketching a production wrapper architecture.

The professional file's content is exactly what hiring managers probe at the senior+ levels.

---

## Appendix R: Pools and Microservice Architecture

`workerpool` operates inside one process. In microservice architectures:

- Each service has its own pool(s).
- Inter-service communication is via HTTP/gRPC, not shared pools.
- Pool scaling is per-service, not global.

Implications:

- Total system concurrency = sum across all services.
- Service-to-service back-pressure must be implemented (HTTP 429, gRPC `Unavailable`).
- A bad service can affect downstream regardless of pool design.

Microservice-aware pool design:

- Bound by downstream service's capacity.
- Implement client-side rate limiting.
- Use circuit breakers between services.
- Monitor downstream call latency and adjust.

This is the system-level view. `workerpool` is a tool inside it.

---

## Appendix S: A Postmortem Template for Pool Incidents

When you have an incident:

```markdown
# Incident: <one-line title>

## Date / time
YYYY-MM-DD HH:MM UTC

## Impact
- N requests dropped
- M customers affected
- Duration: T minutes

## Detection
How was the incident detected? Alerting? Customer report?

## Timeline
- T-0: incident starts
- T+5m: alert fires
- T+10m: on-call engaged
- T+30m: root cause identified
- T+60m: mitigation deployed
- T+90m: incident resolved

## Root cause
A specific bug, a specific change, a specific external event.

## Mitigation
What stopped the impact?

## Resolution
What permanently fixed the issue?

## Lessons
1. ...
2. ...

## Action items
- [ ] Add metric X
- [ ] Add alert Y
- [ ] Tune `maxWorkers` to Z
- [ ] Document runbook procedure
```

Use this template for every pool incident. The "Lessons" and "Action items" sections drive improvements. Over time, your pools become more robust.

---

## Appendix T: Final Words

The professional file has been long. To leave you with something portable:

**The pool is not the system.** The pool is a primitive. The system is the wrapper, the metrics, the alerts, the runbooks, the conversations with the downstream team, the capacity plans, the postmortems.

A professional engineer who uses `workerpool` understands all of these. The library itself is the smallest, simplest thing in the picture. The wisdom is what surrounds it.

Take what you have learned. Go ship. When the next incident happens, you will be the one who diagnoses it in 10 minutes instead of 2 hours. That is what professional means.

The remaining files — specification, interview, tasks, find-bug, optimize — are practical. Use them as reference and exercise material. The professional file is your operating philosophy.

---

## Appendix U: Bonus Patterns

A few extra production patterns that did not fit elsewhere.

### Pattern: Pool warm-up

```go
func warmUp(p *workerpool.WorkerPool) {
    var wg sync.WaitGroup
    for i := 0; i < p.MaxWorkers; i++ {
        wg.Add(1)
        p.Submit(func() {
            defer wg.Done()
            // tiny no-op task to spawn the worker
        })
    }
    wg.Wait()
}
```

Forces all workers to spin up immediately. Useful if you want to absorb the first burst without spawn cost.

### Pattern: Pool throttling on cold start

In the first 30 seconds after startup, accept fewer tasks (because downstream connections aren't warm, caches are cold, JIT/profile-guided opts aren't applied yet).

```go
if time.Since(startedAt) < 30*time.Second {
    // accept at half rate
    if rand.Intn(2) == 0 {
        s.dropped.Inc()
        return
    }
}
pool.Submit(...)
```

Crude but effective for some workloads.

### Pattern: Pool with health check

A health check tasks itself runs through the pool periodically. If it stalls, the pool is unhealthy.

```go
func healthCheckLoop(p *workerpool.WorkerPool, alert func()) {
    for {
        time.Sleep(10 * time.Second)
        done := make(chan struct{})
        p.Submit(func() { close(done) })
        select {
        case <-done:
            // ok
        case <-time.After(time.Second):
            alert()
        }
    }
}
```

If a no-op task takes more than 1 second to run, the pool is overloaded (or broken).

### Pattern: Pool with circuit breaker

Wrap submit:

```go
type CBPool struct {
    inner *workerpool.WorkerPool
    cb    *gobreaker.CircuitBreaker
}

func (cp *CBPool) Submit(f func()) error {
    _, err := cp.cb.Execute(func() (interface{}, error) {
        cp.inner.Submit(f)
        return nil, nil
    })
    return err
}
```

If the breaker opens (too many failures recently), `Submit` returns an error and the task is rejected. Useful when downstream failures should cause local rejection rather than queue growth.

### Pattern: Pool with deadline-driven submit

```go
func (s *Service) SubmitWithDeadline(deadline time.Time, f func()) error {
    select {
    case s.sem <- struct{}{}:
        // proceed
    case <-time.After(time.Until(deadline)):
        return errors.New("submit deadline exceeded")
    }
    s.pool.Submit(func() {
        defer func() { <-s.sem }()
        f()
    })
    return nil
}
```

If the queue is full, wait up to a deadline. Beyond that, fail. Useful when you want bounded submission latency.

### Pattern: Pool with dynamic priorities

Multiple pools, choose based on priority:

```go
func (s *Service) SubmitPriority(p Priority, f func()) {
    switch p {
    case High:
        s.highPool.Submit(f)
    case Medium:
        s.medPool.Submit(f)
    case Low:
        s.lowPool.Submit(f)
    }
}
```

High-priority work has guaranteed capacity. Low-priority work scales down on overload.

---

## Appendix V: Future-Proofing

How to write pool code that ages well.

### 1. Interface-driven design

Define an interface; depend on it:

```go
type Pool interface {
    Submit(func()) error
    Stop(context.Context) error
}
```

If you ever swap libraries, change the implementation, not the call sites.

### 2. Configuration in code, not constants

```go
type PoolConfig struct {
    MaxWorkers int
    QueueCap   int
    DrainTimeout time.Duration
}
```

Pass `PoolConfig` to constructors. Drift becomes one place to update.

### 3. Versioned wrappers

If your wrapper is shared across services, version it like an internal package. Breaking changes get a v2.

### 4. Deprecation paths

When you replace a pool wrapper, leave the old one available for a transition period with a deprecation warning.

### 5. Documentation that ages

Don't document Go-1.17 behaviour in 2024. Re-read your docs annually; remove stale parts.

These habits make your pool code outlive specific decisions, specific libraries, specific incidents.

---

## Appendix W: The Cost of Stagnation

A pool that is "set and forget" is a pool that ages poorly. The world changes:

- Traffic patterns evolve.
- Hardware changes.
- Downstream services change.
- Library versions advance.
- Team understanding deepens.

A pool whose `maxWorkers` is the same in 2026 as in 2020 is probably wrong for one of those reasons.

Professional engineers schedule revisits:

- Quarterly: review pool metrics. Anything off-trend?
- Annually: revisit `maxWorkers`. Still aligned with workload?
- Per incident: update runbook, possibly the pool config.

This is part of pool ownership.

---

## Appendix X: One Last Mantra

> Pools are simple primitives wrapped in operational discipline. The library is the easy part. The discipline is the work.

Carry this forward. Run pools well. Sleep at night.

---

## Appendix Y: Resources for Continuing Education

- Books: "Site Reliability Engineering" (Google), "Designing Data-Intensive Applications" (Kleppmann), "Concurrency in Go" (Cox-Buday).
- Blogs: brendangregg.com, danluu.com, dave.cheney.net.
- Conferences: SREcon, GopherCon, KubeCon.
- Communities: Gopher Slack #performance, #sre channels.

Production knowledge is mostly tacit; the best way to acquire it is to be near people who have it. Pair with senior engineers. Attend post-mortems. Ask questions.

---

## Appendix Z: Closing

You started learning `workerpool` with `New` and `Submit`. You finish with capacity plans, runbooks, and incident retrospectives. That is the arc from beginner to professional.

You will not remember everything from this file on first read. That's fine. Bookmark it. Return when you face a specific problem. The patterns are here.

Go build robust services. The pool is now your tool.

---

## Appendix AA: Production Story — Replaying After a Crash

A service was processing a stream of events. Pool processed each event, wrote to a database. After an OOM crash, the team discovered:

- 50,000 events were lost (in the queue at crash time).
- Some events had partial database writes (task crashed mid-write).
- No record of which events ran.

The fix took weeks:

1. Move the source of truth out of the pool's queue. Events come from a durable queue (Kafka, SQS, Redis Streams).
2. Each task processes one event idempotently and acks back to the queue.
3. On crash, unacked events are re-delivered.
4. Database writes are wrapped in transactions or made idempotent.

After the fix:

- Crashes lose nothing.
- Replays are safe.
- The pool is "stateless" in the sense that its in-memory queue is just a buffer; the truth is in the upstream queue.

This is a general pattern: pool tasks should be replayable. If they aren't, you have data loss at crash time.

Implications for `workerpool`:

- The pool's queue is not durable. Don't put long-lived state there.
- Source events from a durable queue.
- Make tasks idempotent.

---

## Appendix BB: A Comparison of Two Pool Wrapper Designs

Two engineers each design a wrapper. Let's compare.

### Wrapper A: minimal

```go
type Pool struct {
    inner *workerpool.WorkerPool
}

func (p *Pool) Submit(f func()) {
    p.inner.Submit(func() {
        defer func() { _ = recover() }()
        f()
    })
}
```

Pros: small. Concise.
Cons: no metrics, no logging, no bounded queue, no shutdown contract.

This wrapper is fine for trivial services. Not for production.

### Wrapper B: production-grade

(The `Pool` struct in Appendix H of this file — ~150 lines.)

Pros: production-ready.
Cons: bigger; more code to maintain.

This wrapper is appropriate for any production service. The extra 140 lines pay for themselves the first time you need to debug an incident.

### Take-away

The size of your wrapper should be proportional to the stakes. Toy projects: 10 lines. Toy production services: 50 lines. Real production: 150-300 lines. Critical infrastructure: 500+ lines.

If you find yourself writing 1000+ lines around `workerpool`, consider whether the library is still the right choice — or whether you're building a domain-specific pool that should be its own library.

---

## Appendix CC: Pool Patterns in Open Source

A survey of how popular Go projects use pools.

### Kubernetes

Uses `client-go`'s `workqueue` for controller loops. Not `workerpool` directly, but very similar pattern.

### Prometheus

Uses goroutines per scrape job with a semaphore for concurrency cap. No third-party pool library.

### Docker

Hand-rolled pools in places, plus standard goroutine-per-task in others.

### etcd

Uses small purpose-built worker pools for specific tasks.

### Grafana

Uses `errgroup` for bounded concurrency in many places.

The pattern across the ecosystem: hand-rolled or `errgroup`. Third-party pool libraries are common in mid-sized services and less so in giant-codebase projects. Why?

- Giant projects have their own conventions and resist adding dependencies.
- They have engineers who can hand-roll.
- Their use cases vary across components, so one library doesn't fit all.

In your service, the decision depends on team size, codebase size, and convention.

---

## Appendix DD: Pool Code Reviews in Depth

A real PR review example. The author proposes:

```go
var emailPool = workerpool.New(100)

func sendEmail(to string, body []byte) {
    emailPool.Submit(func() {
        _ = smtpClient.Send(to, body)
    })
}
```

Reviewer comments:

1. "Why 100? Document the reasoning."
2. "Where is `emailPool` stopped? I don't see a `StopWait` anywhere."
3. "The `_ = smtpClient.Send(...)` discards errors. If sending fails, we have no record."
4. "No timeout on `smtpClient.Send`. If SMTP hangs, this worker hangs."
5. "No bound on the queue. A sudden burst of emails would grow memory unbounded."
6. "No metrics. How will we know if this is unhealthy?"
7. "Captured loop variable? Or not because no loop visible? Why does this function exist as `func` instead of using closure capture from caller?"
8. "Per-tenant fairness? If one tenant sends a million emails, others wait."

The author revises:

```go
const emailPoolSize = 100 // matches SMTP server's accept concurrency

var emailPool = newInstrumentedPool(InstrumentedOptions{
    Name:       "email",
    MaxWorkers: emailPoolSize,
    QueueCap:   10000,
    Logger:     slog.Default(),
    Registerer: prometheus.DefaultRegisterer,
})

func init() {
    // emailPool drained from main.shutdown()
}

// sendEmail enqueues an email for asynchronous delivery. Returns error if the
// queue is full or the service is shutting down. Per-tenant concurrency is
// bounded inside the pool wrapper.
func sendEmail(ctx context.Context, tenant, to string, body []byte) error {
    return emailPool.Submit(ctx, "send_email_"+tenant, func(ctx context.Context) error {
        ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()
        return smtpClient.Send(ctx, to, body)
    })
}
```

The revised version addresses all eight comments. This is what code review for pools looks like.

---

## Appendix EE: Backstage / Runbook Maintenance

A pool with a runbook is operationally healthy. A pool without one is a footgun.

A good runbook covers:

### Section 1: Overview

What the pool does, at a high level. Read this when you're on-call and you don't remember.

### Section 2: Alerts → Causes → Actions

For each alert:
- Symptoms
- Likely causes
- Diagnostic commands
- Mitigation steps

Example:

```
Alert: PoolQueueGrowing

Symptoms: workerpool_queue_depth metric > 1000 for 5 minutes.

Likely causes:
1. Downstream slowdown.
2. Traffic spike beyond capacity.
3. Worker hang (rare).

Diagnostic:
- Check downstream latency (downstream_p99 dashboard panel).
- Check submit rate vs complete rate.
- Goroutine dump: pkill -USR1 <pid>

Mitigation:
- If downstream slow: contact downstream team, consider degraded mode.
- If traffic spike: scale up (kubectl scale ...) or increase maxWorkers via config.
- If worker hang: roll the pod (kubectl delete pod ...).
```

### Section 3: Common questions

"Why is `maxWorkers` set to 75 and not 100?"  
"What does the dwell-time histogram tell us?"  
"How do I shut down cleanly during a deploy?"

### Section 4: History

Significant past incidents and their resolutions. A "we tried that already" reference.

A runbook is a living document. Update it after every incident.

---

## Appendix FF: Pool Code as Documentation

A common observation: pool code is usually *not* well-commented because it looks simple. But pool code embeds many assumptions:

- About sizing.
- About workload characteristics.
- About downstream tolerances.
- About error handling philosophy.

Each assumption deserves a comment. A counter-example:

```go
pool := workerpool.New(50)
```

vs.

```go
// emailPool: 50 workers matches SMTP server's accept concurrency.
// Reviewed quarterly; last adjusted 2024-03 (was 30, raised because
// of growth). If queue depth alerts fire, consider:
//   1. Raising to 75 if SMTP can handle (check with smtp-team).
//   2. Adding per-tenant rate limiting.
//   3. Splitting transactional vs marketing email pools.
pool := workerpool.New(50)
```

The second version teaches future maintainers. The first version forces them to dig through history.

Comments are documentation that lives with code. Use them.

---

## Appendix GG: Two Stories About Pool Removal

Sometimes the right action is to *delete* the pool.

### Story 1: The unnecessary pool

A service had a pool with `maxWorkers = 1`. Tasks were submitted from a single goroutine. The pool was serving no purpose — it was just a wrapper around sequential execution.

The author had introduced the pool "in case we want to parallelise later". Three years later, nothing was parallelised. The pool was dead weight.

The PR to remove the pool was 20 lines deleted, 10 lines simplified. Cleaner code. Same behaviour.

Lesson: don't introduce abstractions speculatively.

### Story 2: The over-engineered pool

A service had a pool with metrics, logging, tracing, panic recovery, per-tenant quotas, dynamic resize, and a 600-line wrapper. The pool handled 5 tasks per second.

The author had built it as a "future-proof" pool when the service was new. Three years later, the load was still 5 RPS. The over-engineering was a maintenance burden.

The PR to simplify the pool was 500 lines deleted. Fewer features. Less to break.

Lesson: match complexity to actual needs, not aspirations.

---

## Appendix HH: Pool Migrations to Other Patterns

When `workerpool` (or any pool) is not the right answer, migrate to:

### 1. Per-request goroutine with errgroup.SetLimit

For batch operations within one request, this is simpler than a pool.

### 2. Durable queue (SQS, NATS, Kafka)

For work that must survive process crashes.

### 3. Cron-like scheduler

For periodic batch jobs without continuous load.

### 4. Stream processor (Flink, Beam)

For high-throughput data processing.

### 5. Worker container fleet

For embarrassingly parallel work that should scale horizontally.

The pool is one tool. Other tools fit different problems. A senior+ engineer chooses among them.

---

## Appendix II: The Operational Maturity Curve

Where is your pool on the maturity curve?

### Level 0: Untracked

No metrics. No alerts. Pool exists; nobody knows how it's doing.

### Level 1: Trended

Basic metrics (submit, complete). Dashboard exists. Trends visible.

### Level 2: Alerted

Critical alerts (queue depth, panic rate). On-call is paged.

### Level 3: Runbook

Documented procedures for common alerts. New on-call can act without senior help.

### Level 4: Capacity-planned

Annual capacity reviews. Sizing is data-driven.

### Level 5: Adaptive

Pool sizing responds to load automatically. Failure modes are well-understood.

### Level 6: Defensively wrapped

Every failure mode has a defence: panic recovery, queue bounds, deadlines, per-tenant limits.

### Level 7: Multi-tenant fair

Noisy tenants cannot starve others.

Most production pools live at Level 2-4. Aspire to 4-5 for important services, 6-7 for critical infrastructure.

---

## Appendix JJ: Soft Skills of Pool Operation

Beyond code, pool operation requires:

### Patience

When the queue depth spikes, the temptation is to immediately tune `maxWorkers`. Resist. Diagnose first. Often the queue spike is a symptom, not the disease.

### Communication

Pool incidents often involve multiple teams (yours, downstream's, ops). Clear communication during incidents is the difference between 10-minute and 4-hour resolutions.

### Documentation

Senior+ engineers create durable artifacts: runbooks, sizing rationales, postmortems. Code without documentation is half the value.

### Mentorship

Help juniors understand why your pool is the way it is. The next incident may happen on their watch.

### Skepticism

Don't trust your assumptions. Verify with measurement.

These skills do not appear in `workerpool`'s README. But they shape how `workerpool` works in your hands.

---

## Appendix KK: A Day in the Life

A senior engineer responsible for a service with `workerpool` might spend a typical day:

- 09:00 — Check dashboards. Pool metrics look normal.
- 09:30 — Code review on a teammate's pool change. Suggest renaming a constant for clarity.
- 11:00 — Pair with a junior to debug a slow task. Discover the issue is downstream, not the pool.
- 13:00 — Update the runbook based on yesterday's incident.
- 14:00 — Capacity planning meeting. Forecast 30% growth; propose `maxWorkers` increase from 60 to 80.
- 16:00 — Review the production wrapper for a new service. Suggest two improvements.
- 17:00 — Off.

Most days, the pool is invisible. The work is around it: reviews, planning, mentoring, documentation.

If you're spending hours debugging pool internals every day, something is wrong. The pool should be a stable platform, not a source of constant trouble.

---

## Appendix LL: One More Closing

You've now seen `workerpool` from four angles: API (junior), operations (middle), internals (senior), and production (professional). Each angle taught something different. Each is required for fluent use.

This file is long because production wisdom is dense and specific. It will not transfer fully from reading; it transfers from doing. Build pools. Operate them. Have incidents. Learn from them. Refine your approach.

In ten years, the library may not be the same. New competitors will emerge. Your code will need to evolve. But the *principles* in this file — bounded queues, deliberate sizing, observability, defensive shutdown, idempotent tasks, multi-tenant fairness — will outlast specific tools.

That's the value of professional-level study. You learn the principles, not just the tools.

Goodbye, and good luck.

---

## Appendix MM: Final Quick Reference

```
PRODUCTION POOL CHECKLIST
─────────────────────────
[ ] maxWorkers derived from latency * RPS, bounded by downstream
[ ] Queue cap set (semaphore)
[ ] context.WithTimeout per task
[ ] defer recover() inside task closure
[ ] Pool name appears in metrics labels
[ ] At least 6 metrics emitted
[ ] At least 5 alerts configured
[ ] Runbook written
[ ] Shutdown with deadline + hard-stop fallback
[ ] Tests with -race for normal flow, full queue, panic, shutdown
[ ] Documentation comment on pool creation explaining sizing
[ ] Code review caught: sizing reason, lifecycle pairing, error handling
```

Print this. Hang it near your monitor.

---

The end. Truly.

---

## Appendix NN: Extended Incident Stories

Three more production incidents, each illustrating a different category of pool-related failure.

### Story: The Slow Index Build

A search service used `workerpool` to index documents. Pool size 32. Each document took ~50 ms to index. Steady throughput: 600 docs/sec.

A new feature added "extracted entities" to each document — calling out to a Named Entity Recognition (NER) service for each. The NER service had 500 ms p99 latency.

The team did not resize the pool. Effective throughput dropped to 64 docs/sec (32 workers / 0.5s). The indexing queue grew indefinitely. After 4 hours, memory was at 12 GB. Service died.

Lesson: **Anytime task latency changes, revisit pool sizing.** Adding an extra HTTP call to a task multiplied latency by 10x. Pool capacity, which was hard-coded, did not respond. The bottleneck moved silently from "indexing CPU" to "NER round-trip".

The fix: pool sized from 32 → 256 (matched to NER service's concurrent capacity). Throughput recovered to ~500 docs/sec.

Long-term fix: pool size pulled from config, with a daily review job that checks if the size still makes sense given measured latency.

### Story: The Cascading Database Connections

A web app had two pools: a request handler pool (managed by `net/http`) and a background-task pool (`workerpool`, size 50). Both made DB calls.

The DB connection pool was sized for 100 connections. Normally:

- HTTP handlers: ~50 concurrent → ~50 connections.
- Background pool: ~30 concurrent → ~30 connections.
- Total: ~80 connections, fine.

One day, a slow DB query started taking 30 seconds. HTTP handlers piled up. Background tasks piled up. Both pools sat full.

Now:

- HTTP handlers: 200+ concurrent (because each is slow).
- Background pool: 50 concurrent (all slow).
- Total: 250+ wanting connections.
- DB: rejects 150+ with "max connections exceeded".

The DB rejections caused user-visible errors. Background tasks failed. The system was effectively down.

Lesson: **shared resources across pools must be sized for the worst-case sum.** The DB connection pool was sized for a happy path. Under load, it became the bottleneck.

The fix: DB pool sized to `(HTTP_pool_cap + background_pool_cap) * 1.2`. Connection limit raised. DB tuning.

Long-term: better isolation. Read replicas for background tasks. Connection pooling middleware. Bulkheading by workload type.

### Story: The Phantom Memory Leak

A service ran fine for weeks. Memory slowly grew. Heap profile showed `[]byte` allocations dominating, attributed to a task in the pool.

The task body was simple:

```go
pool.Submit(func() {
    data, _ := ioutil.ReadAll(resp.Body)
    process(data)
})
```

The data is processed and goes out of scope. So why is memory growing?

Profiling revealed: `process(data)` cached the byte slice in a global map. The cache had no eviction. Over time, it filled with all the response bytes ever seen.

Pool was *innocent*. The pool tasks were memory-correct. The leak was in `process`.

Lesson: **a memory leak attributable to pool tasks may live outside the pool.** Don't blame the pool until you've checked what the tasks do. Pool dashboards may show no anomaly while memory rises.

The fix: cache eviction policy. Memory stabilised.

---

## Appendix OO: Pool-Adjacent Patterns

Patterns that often appear near pools.

### Worker pool of worker pools

For massive concurrency on multi-tenant systems: a top-level pool of "shards", each shard being its own pool. Hash tenants to shards.

### Pool with priority queue

Replace the FIFO queue with a heap. Forking `workerpool` to do this is ~50 lines. Useful when task urgency varies.

### Pool with task results stream

Replace the `func()` task with `func() Result`. Results flow on a channel. Useful for fan-in patterns.

### Pool with retries

Tasks return `error`. On error, re-submit with backoff. Useful for transient failures.

### Pool with idempotency keys

Tasks have unique IDs. Recently-completed IDs are tracked; duplicate submits are dropped. Useful for at-least-once delivery.

Each of these is a wrapper or fork of `workerpool`. Build them when you need them; do not pre-build them.

---

## Appendix PP: Pool Lifecycle in Long-Running Services

For a service running for months:

### Hour 1

Pool created. Workers spin up as needed. Idle reaping kicks in during quiet periods.

### Day 1

Pool has handled millions of tasks. Workers churn (spawn, idle, reap). Steady state.

### Week 1

If the workload is bursty, the queue depth oscillates. If steady, the queue stays near 0.

### Month 1

Memory usage stable. Goroutine count stable. The pool is "boring" — exactly what you want.

### Month 6

A new feature subtly changes task latency. Pool's effective throughput shifts. Monitor and resize if needed.

### Year 1

Hardware change, library upgrade, or workload shift may prompt a config update. Pool is otherwise unchanged.

The boring pool is the healthy pool. If your pool is exciting, something is wrong.

---

## Appendix QQ: Onboarding Other Engineers

When a new engineer joins your team, how do you teach them about the pool?

### Day 1

- "We use `gammazero/workerpool` for background tasks."
- "Here is the wrapper. It has metrics and panic recovery."
- "Here is the runbook for incidents."

### Week 1

- Walk through one task end-to-end: submit, run, complete.
- Show them the dashboard. Explain each metric.
- Pair on a small change.

### Month 1

- Have them on-call for a low-traffic period. Help them resolve at least one alert.
- Code review at least three of their PRs that touch the pool.

### Month 3

- They should be able to:
  - Add a new metric.
  - Adjust `maxWorkers` based on data.
  - Run the diagnostic flowchart for queue spikes.

### Month 6

- They should be able to handle on-call solo.
- They should review junior engineers' pool code.

This is roughly the expected ramp for production-grade pool ownership.

---

## Appendix RR: Personality Types of Pools

A whimsical but useful classification.

### The Workhorse

Steady traffic, predictable load, sized comfortably. Boring. Reliable. Never causes incidents. The ideal.

### The Anxious One

Bursty traffic. Queue depth oscillates. Alerts fire periodically. Healthy but noisy.

### The Athlete

Carefully sized for peak performance. Operates near limits. Trip with a small change in workload. Requires constant attention.

### The Hoarder

Unbounded queue. Memory grows. Eventually crashes. Bad hygiene.

### The Coward

Drops everything on bad load. Underutilises capacity. Overcorrected for past incidents.

### The Diva

Per-tenant quotas, per-priority bands, per-region overrides. Beautiful design. Many moving parts. Fragile to changes.

Your goal: cultivate Workhorses. Reform Hoarders. Tolerate Anxious Ones. Tame Athletes. Replace Cowards. Simplify Divas.

---

## Appendix SS: Pool Smells in Code Review

If you see these patterns, ask questions.

### Smell 1: `workerpool.New(GLOBAL_CONSTANT)` with no comment

Why that constant? Where did it come from?

### Smell 2: A pool used in only one function

Maybe it should be local; maybe it shouldn't be a pool at all.

### Smell 3: A pool wrapped in another struct with no methods added

Why the indirection? Either expose the pool directly or add value.

### Smell 4: `pool.Stop()` instead of `pool.StopWait()` without justification

`Stop` discards. Make sure the author intended that.

### Smell 5: A pool with no shutdown

Where does it stop? When the program exits?

### Smell 6: A `pool.Submit` inside another pool's task

Cross-pool submission. Watch for deadlocks.

### Smell 7: `Submit` with a closure capturing `*sync.Mutex`

The closure now shares the mutex. Is it released?

### Smell 8: `pool.Submit` inside a `defer`

Why deferred? Tasks may run after the function returns.

### Smell 9: A pool serving more than one workload type

CPU and I/O share badly. Split.

### Smell 10: `maxWorkers = 0` or `< 0`

The library normalises to 1. Almost always a bug.

Code review catches these. Make them part of your team's checklist.

---

## Appendix TT: Pool API Evolution

A retrospective on `workerpool`'s API since v1.0:

- v1.0: `New`, `Submit`, `SubmitWait`, `Stop`, `StopWait`, `Stopped`, `WaitingQueueSize`.
- v1.1: panic recovery added.
- v1.x: `Pause` added.

No method has been removed or had its signature changed. Every v1.0 program still compiles.

This is the gold standard of API stability. Compare to libraries that release v2, v3 every year.

If you write libraries, study `workerpool`'s history. Stability is achievable.

---

## Appendix UU: Pool Trivia

A few unrelated facts.

- The library has zero external dependencies (except the author's own `deque`).
- The library has ~95% test coverage.
- The library's repo has ~500 stars (modest, but high quality).
- The author also wrote `gammazero/deque`, `gammazero/radixtree`, and other small focused libraries.
- The library was last "feature-modified" (Pause added) several versions ago.
- Issues on the repo are mostly "feature requests" that get politely declined.

This is what a stable, focused library looks like.

---

## Appendix VV: Reflections

Some closing reflections on what makes `workerpool` worth the depth of study we've given it.

### It's a microcosm of Go

Channels, goroutines, select, sync primitives — `workerpool` uses them all idiomatically. Reading the source is a Go-style master class.

### It's small enough to fully understand

Most libraries are too big to internalise. `workerpool` fits in your head. You can know everything about it.

### It's stable enough to bet on

Years of API stability is rare. Building on top is safe.

### It's flexible enough to extend

Wrappers, forks, replacements — all are easy. The minimal API does not paint you into corners.

### It teaches discipline

The author's discipline (saying no to features) is visible in the source. That discipline is contagious.

For all these reasons, `workerpool` rewards deep study. Other libraries — bigger, more featureful — do not. Pick your study targets carefully.

---

## Appendix WW: The Last Story

A senior engineer who had used `workerpool` for years finally read its source. They were impressed. The 300 lines were a single afternoon's read. The patterns inside were universally applicable.

They went back to their team and proposed: "We should write our own libraries the way Gillis writes his. Small. Stable. Focused. Documented."

It took two years to change the culture. But over those two years, the team's internal libraries shrank in lines while growing in quality. Bugs decreased. Onboarding got faster. Code reviews became debates about design philosophy, not specific bugs.

This is the secondary value of studying `workerpool`. Beyond the library itself, you learn how to think about libraries.

---

## Appendix XX: A Self-Test for Professional Level

Ten questions; answer privately.

1. How do you derive `maxWorkers` for an I/O-bound workload with target 500 RPS and 200 ms p99 latency?
2. What is the minimum set of metrics every production pool should emit?
3. How does Kubernetes' `terminationGracePeriodSeconds` interact with `pool.StopWait()`?
4. What is the failure mode of an unbounded queue under sustained overload?
5. How do you isolate noisy tenants in a multi-tenant pool?
6. What is the operational cost of `Submit` vs raw `go f()`?
7. When should you migrate from `workerpool` to `ants`? To `tunny`? To `errgroup.SetLimit`?
8. What is the right shutdown ordering for a service with HTTP server, a pool, and a background ticker?
9. How do you size a database connection pool relative to a worker pool that uses it?
10. What is a postmortem and when do you write one?

Answers should be specific and confident. If you hesitate on any, revisit the relevant section.

---

## Appendix YY: Final Self-Check Answers

Brief answers to the self-test:

1. `workers = target_rps * p99_latency = 500 * 0.2 = 100`, bounded by downstream cap, with 20% headroom = ~120.
2. submitted_total, completed_total{result}, queue_depth, queue_dwell_seconds, task_duration_seconds, dropped_total.
3. K8s gives you `terminationGracePeriodSeconds` (default 30s) after SIGTERM. Your `pool.StopWait()` must finish in that window or your work is lost. Use a deadline + hard stop fallback.
4. Memory grows linearly with queued tasks. Eventually OOM. Closures with large captures accelerate this.
5. Per-tenant pools (few tenants), per-tenant token bucket (many tenants), pool sharding by tenant hash (very many tenants).
6. Submit: ~200 ns + 1 closure alloc. `go f()`: ~250 ns + goroutine spawn. Comparable for the first task; pool wins on reuse.
7. To `ants`: when you need resize, typed args, higher throughput, or configurable expiry. To `tunny`: when workers need state. To `errgroup.SetLimit`: when you need errors+context and a one-shot batch.
8. (1) Stop accepting requests (HTTP server). (2) Stop internal producers. (3) Drain pool with deadline. (4) Hard-stop if needed. (5) Exit.
9. `db_pool >= sum(worker_pools_using_db) * factor`. Factor ~1.2 for headroom. Bound by what DB allows.
10. A postmortem documents an incident: timeline, root cause, mitigation, lessons, action items. Write one for every customer-impacting incident.

If you knew all of these, you're at professional level. If you fuzzed on a few, revisit the file.

---

## Appendix ZZ: One Sentence

If you take one sentence from this entire file:

**Wrap the library you adopt with the operational guards your service needs, and revisit those guards as your service grows.**

That sentence is the professional perspective in 23 words. The rest is elaboration.

---

## Appendix AAA: Goodbye

You have spent significant time on `gammazero/workerpool`. Most engineers who use the library spend an afternoon. You spent days.

That depth pays off. When the next incident happens, you will diagnose it in minutes. When the next architectural decision arises, you will have informed opinions. When a junior asks "what's a worker pool?", you can teach.

Those are the marks of professional-level mastery.

Now go forth and build. The library waits. Your services need you.

---

## Appendix BBB: Bonus — A Closing Letter

Dear future engineer reading this file,

I do not know who you are or what you build. But I know that you, like the engineers before you, will face the same set of pool-related challenges: sizing, observability, shutdown, failure modes.

The patterns in this file will not solve them for you. They will give you vocabulary. With vocabulary, you can think faster. You can argue more clearly. You can teach others.

Use that vocabulary. Carry it forward. Refine it as you learn. In ten years, write your own version of this file.

Yours,  
A previous engineer who debugged a pool incident at 3 AM and lived to tell about it.

---

## Appendix CCC: A Final Footnote

The library is at https://github.com/gammazero/workerpool. The author is Andrew J. Gillis. The license is MIT.

If you use it in production and it serves you well, consider contributing back: a bug fix, a documentation improvement, a sponsored issue. Maintainers of small focused libraries deserve appreciation.

That's it. The end.

---

## Appendix DDD: Three More Production Patterns

### Pattern: Pool with hot-reload of configuration

For services that should not restart to apply a new pool size:

```go
type ReloadablePool struct {
    mu sync.RWMutex
    p  *workerpool.WorkerPool
    cfg PoolConfig
}

func (rp *ReloadablePool) Apply(newCfg PoolConfig) {
    rp.mu.Lock()
    defer rp.mu.Unlock()
    if newCfg == rp.cfg {
        return
    }
    old := rp.p
    rp.p = workerpool.New(newCfg.MaxWorkers)
    rp.cfg = newCfg
    go old.StopWait()
}

func (rp *ReloadablePool) Submit(f func()) {
    rp.mu.RLock()
    p := rp.p
    rp.mu.RUnlock()
    p.Submit(f)
}
```

This allows config changes to be applied without process restart. Drain time after Apply: until old pool finishes its in-flight tasks (could be seconds to minutes).

Wire it up to your config system (Consul, Vault, K8s ConfigMaps with a watcher).

### Pattern: Pool with chaos engineering hooks

In non-production environments, inject failures to test resilience:

```go
type ChaosPool struct {
    inner    *workerpool.WorkerPool
    failRate float64
}

func (cp *ChaosPool) Submit(f func()) {
    cp.inner.Submit(func() {
        if rand.Float64() < cp.failRate {
            panic("chaos injection")
        }
        f()
    })
}
```

Set `failRate = 0.01` to make 1% of tasks panic. Verify your service handles it gracefully. Run this in chaos-engineering experiments before production deploys.

### Pattern: Pool with shadow execution

For testing new logic without affecting production:

```go
type ShadowPool struct {
    primary *workerpool.WorkerPool
    shadow  *workerpool.WorkerPool
}

func (sp *ShadowPool) Submit(f func(), shadowF func()) {
    sp.primary.Submit(f)
    if shadowF != nil {
        sp.shadow.Submit(shadowF)
    }
}
```

The primary runs the production logic; the shadow runs the new logic. Compare outputs offline. If they match for a week, promote the shadow.

This is how serious A/B testing of pool logic is done.

---

## Appendix EEE: Long-Form Capacity Plan

A worked example of capacity planning.

### Service: imageProcessor

Current state:
- 8 cores per pod.
- Tasks: image resize, average 200 ms, p99 800 ms.
- Pool size: 16.
- Steady-state throughput: 60 RPS.
- Queue depth: ~5 at steady state.

Projected next year:
- 3x user growth → 180 RPS peak.
- Per-image processing unchanged.

Calculations:

- Workers needed at average latency: 180 * 0.2 = 36.
- Workers needed at p99 latency: 180 * 0.8 = 144.
- Bounded by per-pod resource limit: 32 cores.

So per pod: max 32 workers (because CPU-bound). To handle 180 RPS:

- Per-pod throughput at 32 workers: 32 / 0.2 = 160 RPS (average), 32 / 0.8 = 40 RPS (p99).
- Number of pods needed: 180 / 160 = 1.2 (avg) or 180 / 40 = 4.5 (p99).

Decision: scale to 5 pods, each with `maxWorkers = 32`. Total capacity at p99: 200 RPS, leaving 20% headroom over 180.

Cost:
- 5 pods × 8 cores × pricing = $X.

Plan:
- Increase replicas from 2 to 5 over 3 months.
- Increase `maxWorkers` from 16 to 32 in next deploy.
- Monitor: queue depth should stay under 10 even at peak.

This is what a capacity plan looks like. Specific, data-driven, time-bound.

---

## Appendix FFF: Pool Failure Recovery Strategies

When a pool fails, what's your recovery story?

### Strategy 1: Restart

Simplest. Process exits, K8s restarts. Lose in-flight work. Some downtime.

When to use: stateless services, fast restart (<10s), durable upstream queues.

### Strategy 2: Drain and restart

Graceful. Pool drains before exit. No lost work. Slower restart (up to drain time).

When to use: stateful services, deploys where you control timing.

### Strategy 3: Live reload

Reset the pool without process restart. No downtime, no in-flight loss (if done carefully).

When to use: long-running services with expensive startup.

### Strategy 4: Failover

Run two replicas; failover if one fails. K8s does this for you.

When to use: high-availability services.

### Strategy 5: Self-healing

Pool detects stuck workers and restarts itself.

When to use: deeply embedded pools where external monitoring is hard.

### Combining strategies

Most services use 1 (restart) for crashes and 2 (drain) for deploys. Strategy 4 (failover) is the platform's job, not the pool's.

---

## Appendix GGG: Pool Lifecycle in Tests

Testing pool code has its own patterns.

### Unit test: contract verification

Test that the wrapper honours its API contract. Mock the inner pool if needed.

### Integration test: real pool

Use a real `workerpool.WorkerPool` in an integration test:

```go
func TestService_DeliverMany(t *testing.T) {
    s := NewService(testConfig)
    defer s.Shutdown(context.Background())

    for i := 0; i < 1000; i++ {
        err := s.Deliver(context.Background(), testWebhook(i))
        require.NoError(t, err)
    }
    s.Drain(t)

    assert.Equal(t, int64(1000), s.completedCount())
}
```

### Race test: stress under concurrency

```go
func TestService_RaceConditions(t *testing.T) {
    s := NewService(testConfig)
    defer s.Shutdown(context.Background())

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                _ = s.Deliver(context.Background(), testWebhook(j))
            }
        }()
    }
    wg.Wait()
    s.Drain(t)
}
```

Run with `-race`. Should pass.

### Load test: production-like

Outside unit tests, use a load generator (`vegeta`, `k6`, etc.) to drive realistic traffic. Watch metrics. Verify thresholds.

### Chaos test: failure injection

Inject panics, slow tasks, downstream failures. Verify the service degrades gracefully, not catastrophically.

---

## Appendix HHH: Common Production Questions

Real questions engineers ask about pools in production.

### Q: "Why is my queue growing even though workers seem idle?"

Possible causes:
- Workers blocked on a shared lock or channel.
- Workers reaped due to inactivity, queue depth = pending; new workers spinning up.
- Misreading metrics (queue size vs in-flight).

Diagnose with goroutine dump.

### Q: "Why is my pool's throughput lower than expected?"

Calculate `workers / avg_latency`. Compare to actual. Mismatch indicates:
- Latency higher than expected (slow downstream).
- Workers not fully utilised (blocked elsewhere).
- Pool size mismatch.

### Q: "Why are tasks dropped when the queue isn't full?"

Possible: a per-tenant cap or context timeout fires before the pool's semaphore.

### Q: "Why does shutdown take so long?"

Long-running tasks. Find them in goroutine dump. Add timeouts.

### Q: "Why does CPU usage spike every 2 seconds?"

Idle worker reaping respawning. See "The Reaping Surprise" incident.

### Q: "Why is memory growing slowly?"

Forgotten pools, growing queue, or captured-state leaks.

### Q: "Should I share a pool across goroutines?"

Yes — that's safe and idiomatic. Just don't share *tasks* across pools.

### Q: "Can I size the pool dynamically?"

Not with `workerpool`. Either wrap to swap pools or use `ants.Tune()`.

### Q: "What happens to a task if the process is killed mid-task?"

The task vanishes. Upstream must retry. Use durable queues for at-least-once.

### Q: "Can I prioritise specific tasks?"

Not within one `workerpool`. Two pools (high, low) or a custom design.

---

## Appendix III: Resource Limits and Pools

Operating systems impose limits. Pools interact with them.

### File descriptors (`ulimit -n`)

Each open file, socket, or pipe is one FD. Default: ~1024 on many systems.

A pool with 1000 workers, each holding a TCP connection: 1000 FDs. Plus your other connections. Easy to exhaust.

Mitigations:
- Increase `ulimit -n` to ~65536.
- Reuse connections (HTTP keep-alive, DB pooling).
- Bound pool size by FD budget.

### Threads (`ulimit -u`)

Each goroutine *can* require an OS thread. With `LockOSThread`, definitely. With cgo, often.

Default thread limit: ~1024. A pool with 1000 workers using cgo: trouble.

Mitigations:
- Avoid cgo in pool tasks.
- Use sync.Pool to reuse connections.
- Cap pool size.

### Memory (`ulimit -m` or container limits)

Hard limit; OOM kill on exceed.

Pool memory math (Appendix D) tells you how much you use.

### Process count

Less relevant for pools, but if you spawn subprocesses inside tasks (rare), watch.

The pool itself is not the limit; the resources it consumes are.

---

## Appendix JJJ: Pool Versioning and Compatibility

When updating dependencies:

### Workerpool upgrades

Generally safe. The API is stable. New minor versions add features without breaking old code.

### Go version upgrades

Test the pool under the new Go. The library is pure Go and usually fine. Loop variable scoping (1.22) affects callers, not the library.

### Compatibility matrix

If you publish a library that uses `workerpool`, document the version range. Example: `requires go >= 1.20 and workerpool >= 1.1`.

This helps consumers pick compatible versions.

---

## Appendix KKK: Pool in Multi-Region Deployments

For services deployed across regions:

- Each region has its own pool(s).
- Cross-region traffic is rare (unless you're routing).
- Capacity is planned per-region.

Implications:

- Failover: another region absorbs traffic. Its pool must handle the surge.
- Monitoring: per-region pool dashboards.
- Configuration: per-region tuning (different downstream latencies).

`workerpool` is a per-process primitive; it doesn't know about regions. Your service architecture does.

---

## Appendix LLL: Stress Testing

Before trusting a pool in production, stress-test it.

```go
func TestPoolUnderStress(t *testing.T) {
    if testing.Short() {
        t.Skip("stress test")
    }
    pool := workerpool.New(50)
    defer pool.StopWait()

    var done atomic.Int64
    var wg sync.WaitGroup

    const submitters = 100
    const perSubmitter = 100_000

    for s := 0; s < submitters; s++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < perSubmitter; i++ {
                pool.Submit(func() {
                    done.Add(1)
                })
            }
        }()
    }
    wg.Wait()
    pool.StopWait()

    expected := int64(submitters * perSubmitter)
    if done.Load() != expected {
        t.Fatalf("ran %d, want %d", done.Load(), expected)
    }
}
```

10 million tasks. Run with `-race`. If it completes without panic and the counters match, the library is solid.

This kind of test catches concurrency bugs that no other test does.

---

## Appendix MMM: A Last Mental Picture

Imagine your service as a city. Requests are vehicles. Pools are intersections.

- `maxWorkers` is the number of lanes.
- The queue is the waiting line.
- Each worker is a traffic light.
- Downstream is the next intersection.

When traffic increases:
- Add lanes (raise `maxWorkers`).
- Speed up lights (optimise tasks).
- Build alternate routes (split pools).

When traffic decreases:
- Idle reaper closes unused lanes.
- Memory returns to baseline.

A well-designed intersection serves traffic smoothly with no jams. A well-designed pool serves tasks smoothly with no buildup.

Use this metaphor when explaining pools to non-engineers (managers, designers). It maps well.

---

## Appendix NNN: Verifiable Properties of a Production Pool

Properties you can write tests or assertions for:

1. **No leaks.** After `StopWait`, `runtime.NumGoroutine()` returns to baseline.
2. **All tasks run.** With `StopWait`, the completion counter equals the submission counter.
3. **No tasks beyond cap.** Peak concurrent tasks ≤ `maxWorkers`.
4. **No tasks lost on Stop with empty queue.** With `Stop`, running tasks complete.
5. **No deadlocks.** Under normal load, `Submit` returns within 100 ms p99.
6. **Idempotent shutdown.** Calling `Stop` or `StopWait` twice does not panic.
7. **Goroutine-safe Submit.** Many submitters do not corrupt state.
8. **Panic isolation.** A panic in one task does not kill others.

Write tests for each. Run them in CI.

---

## Appendix OOO: Adopting workerpool in an Existing Codebase

A staged adoption plan.

### Stage 1: Identify candidate use cases

Look for places where:
- Multiple goroutines are spawned for similar work.
- Concurrency needs bounding.
- `sync.WaitGroup` and `make(chan)` are hand-rolled.

### Stage 2: Pick a pilot

A non-critical service or component. Replace its concurrency with `workerpool`. Validate behaviour matches.

### Stage 3: Build the wrapper

Write the production wrapper for your needs. Tests, metrics, dashboards.

### Stage 4: Roll out to critical services

One service at a time. Watch metrics for a week before declaring success.

### Stage 5: Document conventions

A wiki page: "When and how we use workerpool". Onboarding asset.

### Stage 6: Train the team

Lunch-and-learn. Code review enforcement.

This is a six-month plan for a 20-person team. Smaller teams move faster; larger teams more carefully.

---

## Appendix PPP: Pool Code Smells in Architecture

Beyond individual code, smell architectures.

### Smell: pool everywhere

If every function uses a pool, the system is over-pooled. Most code does not need bounded concurrency.

### Smell: pool nowhere

If no concurrency bound exists, the system is fragile to load. Add pools where needed.

### Smell: many small pools

Many short-lived pools waste setup overhead. Consolidate.

### Smell: one big pool

A single pool for many workload types causes interference. Split.

### Smell: pool decisions made by individuals

Pool sizing should be a team decision, documented. Otherwise it's tribal knowledge.

### Smell: no shared wrapper

Each service writes its own wrapper. Inconsistent metrics, divergent practices. Centralise the wrapper.

### Smell: pools mixed with errgroup, semaphores, manual goroutines

Multiple concurrency primitives layered. Hard to reason about. Pick one approach per service.

Architectural smells are subtle but corrosive. Senior+ engineers spot and remove them.

---

## Appendix QQQ: A Career Endpoint

If you mastered `workerpool` to the level this file describes, you have a transferable skill: production concurrency mastery. That skill applies to:

- Any worker pool (other libraries, hand-rolled).
- Connection pools (DB, HTTP).
- Resource pools (file handles, GPU buffers).
- Job queues (Celery, Sidekiq equivalents).
- Stream processors (Kafka consumers).

The patterns generalise. Sizing by `latency * throughput`, bounded queues, observability, deadline-driven shutdown — all apply.

You may move to a job that does not use Go. The patterns travel.

---

## Appendix RRR: Truly The Final

This file is now ~5000 lines. The library it documents is ~300. The ratio reflects reality: the operational and architectural knowledge dwarfs the library itself.

That's the lesson. Tools are small; using them well is big.

Carry that forward.

Goodbye.

---

## Appendix SSS: The Last Diagram

```
                ╔══════════════════════════════════════╗
                ║       Your Production Service         ║
                ║                                       ║
                ║  ┌────────────────────────────────┐  ║
                ║  │  Pool Wrapper (~200 lines)     │  ║
                ║  │  - bounded queue (semaphore)   │  ║
                ║  │  - metrics                     │  ║
                ║  │  - logging                     │  ║
                ║  │  - panic recovery              │  ║
                ║  │  - graceful shutdown           │  ║
                ║  │  ┌─────────────────────────┐   │  ║
                ║  │  │  gammazero/workerpool   │   │  ║
                ║  │  │   (~300 lines)          │   │  ║
                ║  │  │  - dispatcher           │   │  ║
                ║  │  │  - workers              │   │  ║
                ║  │  │  - queue (deque)        │   │  ║
                ║  │  │  - shutdown             │   │  ║
                ║  │  └─────────────────────────┘   │  ║
                ║  └────────────────────────────────┘  ║
                ║                                       ║
                ║  ┌────────────────────────────────┐  ║
                ║  │  Observability (dashboards,    │  ║
                ║  │  alerts, runbook, on-call)     │  ║
                ║  └────────────────────────────────┘  ║
                ║                                       ║
                ║  ┌────────────────────────────────┐  ║
                ║  │  Operational Practices (sizing │  ║
                ║  │  reviews, postmortems, hiring) │  ║
                ║  └────────────────────────────────┘  ║
                ╚══════════════════════════════════════╝
```

The library is one box in a larger system. The other boxes are where you add value.

This is the picture to carry. Now go build.

---

## Appendix TTT: A Final Coda

The pool you choose, the wrapper you write, the metrics you emit, the incidents you survive — these are the texture of your engineering life.

Sometimes you will deploy a pool that runs for years without incident. Sometimes a pool you wrote in a hurry will wake you at 3 AM. Both happen. Both teach you.

The discipline of production engineering is making the second kind rarer over time. This file's purpose is to accelerate that learning. Read it once for breadth; return to specific sections for depth; cite it in code reviews; adapt its patterns to your needs.

Engineering is a craft. Pools are one of its tools. You now know that tool well enough to use it confidently. Whether you adopt `workerpool`, switch to `ants`, hand-roll your own, or go server-less entirely, the principles in this file travel with you.

That's worth the time you spent reading.

---

## Appendix UUU: Acknowledgements

This professional file synthesises wisdom from many sources: open-source maintainers, incident retrospectives I have read, conversations with colleagues over the years, and patterns I have seen in dozens of production services. None of the ideas here are mine alone; they belong to the engineering community.

If you take one of these ideas and improve it, share it back. That is how the craft grows.

---

## Appendix VVV: An Index of Critical Topics

For quick reference, the must-know topics:

- Sizing: §3, §4, §5
- Observability: §6, §7
- Shutdown: §12, §13
- Incidents: §17, §18, §19, §20
- Production wrapper: §16, Appendix H
- Multi-tenancy: §25
- Cost: §26

Bookmark these.

---

## Appendix WWW: One More Pause

You have read 5000+ lines of this file. That is real time invested.

Reward yourself: build something with what you have learned. The knowledge calcifies through use.

Go.

---

## Appendix XXX: Closing Words

May your pools be sized correctly.  
May your queues be bounded.  
May your shutdowns be graceful.  
May your panics be logged.  
May your on-call rotations be quiet.

The end.





