---
layout: default
title: Partial Cancellation — Senior
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/senior/
---

# Partial Cancellation — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Lifetime as an Architectural Concept](#lifetime-as-an-architectural-concept)
3. [The Three Lifetimes Every Service Has](#the-three-lifetimes-every-service-has)
4. [Detached Work in Service Architecture](#detached-work-in-service-architecture)
5. [Graceful Shutdown Protocols](#graceful-shutdown-protocols)
6. [Supervised Detached Goroutines](#supervised-detached-goroutines)
7. [Distributed Tracing Across the Detach Boundary](#distributed-tracing-across-the-detach-boundary)
8. [Backpressure on Detached Pools](#backpressure-on-detached-pools)
9. [Failure Modes and Recovery](#failure-modes-and-recovery)
10. [The Platform-Level Detached Layer](#the-platform-level-detached-layer)
11. [Structured Concurrency and Partial Cancellation](#structured-concurrency-and-partial-cancellation)
12. [Migrations and Adoption](#migrations-and-adoption)
13. [Cross-Service Partial Cancellation](#cross-service-partial-cancellation)
14. [Observability for Detached Work](#observability-for-detached-work)
15. [Case Studies](#case-studies)
16. [Antipatterns at Scale](#antipatterns-at-scale)
17. [Decision Frameworks](#decision-frameworks)
18. [Summary](#summary)

---

## Introduction

At junior level you learned the API. At middle level you learned the patterns. At senior level you learn the *architecture*: how partial cancellation reshapes the design of a service, how it interacts with shutdown, observability, distributed tracing, and operational practice.

The central senior-level question is: **who owns the lifetime of this work?**

For request-bound work, the answer is "the request." For background work, the answer is "the process." For detached work, the answer is neither — it is something in between, and someone in your design needs to own it explicitly.

A senior-level engineer designs detached work as a *first-class platform concern*, not a per-handler choice. The platform provides the pool, the supervisor, the metrics, the graceful drain. Handlers submit work; the platform handles the rest.

This file teaches you:

- The three lifetimes every service has and how to map them.
- Detached work as an architectural pattern, not a tactical tool.
- Graceful shutdown protocols that handle in-flight detached work.
- Supervised detached goroutines and their failure modes.
- Distributed tracing's interaction with the detach boundary.
- Backpressure, observability, and migration strategies.

By the end, you should be able to design the detached-work subsystem of a service from scratch and defend the design.

---

## Lifetime as an Architectural Concept

In a typical Go service, lifetime appears in three places:

1. **Per-request lifetime.** Bounded by the HTTP/gRPC connection. Cancelled on client disconnect.
2. **Per-process lifetime.** Bounded by the process. Cancelled on SIGTERM/SIGINT.
3. **Detached lifetime.** Specific to one piece of work. Owns its own deadline.

When you design a service, you should identify, for every piece of code, which of these three lifetimes owns it. A line of code without a clear lifetime owner is a bug waiting to happen.

### The lifetime audit

A useful design exercise: walk through your service top to bottom and label every function with the lifetimes it interacts with.

```
handler                  → per-request (from r.Context())
audit middleware         → per-request (uses r.Context())
                        → detached (spawns audit goroutine)
background flusher       → per-process (lives in main loop)
graceful shutdown        → per-process (sees SIGTERM)
```

Sometimes the lifetimes are explicit (the function takes a context as the first argument). Sometimes they are implicit (the function uses a struct field that holds a context). Audit them all.

### Drawing the lifetime tree

```
process (cancelled on SIGTERM)
├── HTTP server (cancelled by process)
│   ├── request 1 (cancelled by client or response)
│   │   ├── handler work (request-bound)
│   │   └── detached audit (detached, drained at process shutdown)
│   ├── request 2 ...
│   └── ...
├── background batcher (process-bound)
└── background flusher (process-bound)
```

The diagram makes ownership clear. Detached work is *not* a child of the request in this diagram; it is a sibling under the process.

### Why the explicit diagram matters

When a colleague says "the audit goroutine is leaking," your first question should be "what is its lifetime owner?" If the answer is "no one knows," you have found the bug.

A well-designed service has a diagram that everyone agrees on. The diagram lives in the architecture doc. New PRs that add concurrency must show where they fit on the diagram.

---

## The Three Lifetimes Every Service Has

### Lifetime 1: Per-Request

The user sends a request. The server begins work. The work is for *this* request, on behalf of *this* user. If the user gives up (closes the connection), the work should stop.

This is the default lifetime for almost everything in a handler.

**Owner:** the HTTP server's per-request context.

**Cancellation:** client disconnect, response written, deadline expired.

**Use:** all reads and writes that the user is waiting for.

### Lifetime 2: Per-Process

The process boots. Some goroutines start. They run for the lifetime of the process. They do not belong to any one request.

Examples: background batchers, flushers, periodic refreshers, health checkers, metric emitters.

**Owner:** the main goroutine's process-wide context (typically created with `signal.NotifyContext`).

**Cancellation:** SIGTERM, SIGINT, explicit shutdown call.

**Use:** infrastructure-level goroutines.

### Lifetime 3: Detached / Per-Operation

A request happens. A specific side-effect is triggered. The side-effect has its own lifetime, independent of the request and (usually) not living past process shutdown.

**Owner:** the detached pool's supervisor.

**Cancellation:** the operation's own deadline, the process shutdown signal (via the pool), or explicit cancel.

**Use:** audit logging, span export, webhook delivery, fire-and-forget notifications.

### The mapping table

| Code shape | Lifetime |
|---|---|
| `db.Query(ctx, ...)` in handler | per-request |
| `ctx := r.Context()` | per-request |
| `signal.NotifyContext(...)` in main | per-process |
| `pool.Submit(ctx, ...)` | detached |
| `context.WithoutCancel(parent)` | detached |
| `time.AfterFunc(...)` | per-process (timers outlive requests) |
| `for { ... <-ticker.C ... }` in a background goroutine | per-process |

Internalise this table. When you see one of the code shapes, you should immediately know which lifetime it belongs to.

---

## Detached Work in Service Architecture

A senior-level architecture distinguishes three categories of detached work:

### Category A: Side-effects of business operations

Audit logs, event publishing, metric emission. These are tied to a specific business operation but should run regardless of the user's view.

**Pattern:** detached pool, time-bounded, retried, tracked, drained at shutdown.

### Category B: Background maintenance

Cache refresh, index rebuild, garbage collection, log rotation. These are not tied to any one request.

**Pattern:** per-process goroutine, not detached from any request. Uses the process context directly.

### Category C: Asynchronous workflows

Sagas, multi-step processes, fan-out workflows. These may take minutes or hours and span many requests.

**Pattern:** durable queue, separate worker processes, idempotent stages. Detached from any single request.

The first category is what `WithoutCancel` was designed for. The second uses normal background goroutines. The third uses external infrastructure (queues, workflows).

### When to escalate from A to C

Category A works for sub-minute side-effects with low business impact. When the work becomes:

- Longer (minutes or hours).
- More business-critical (must not be lost).
- More complex (multiple stages with retries).

…escalate to category C: a durable queue with a separate worker. The detached pool is good for "best-effort with a few retries." It is not good for "must complete eventually, no matter what."

### The progression

Many services start with category A (handler spawns detached goroutines) and migrate to category C (handler enqueues to a durable queue; a separate worker processes the queue). The migration usually happens when:

- The detached pool reaches capacity under load.
- Lost work becomes a business problem.
- Visibility into detached work becomes inadequate (you cannot tell what is in flight).
- Restart loses work in flight.

Plan for the migration. The detach-and-pool layer is a stepping-stone, not an end state for high-criticality work.

---

## Graceful Shutdown Protocols

A graceful shutdown is a choreography:

1. Stop accepting new requests.
2. Wait for in-flight requests to finish.
3. Wait for in-flight detached work to finish.
4. Close database connections, message broker connections, file handles.
5. Exit.

Each step has its own deadline. Each step interacts with partial cancellation.

### Step 1: Stop accepting new requests

```go
httpServer.Shutdown(ctx) // closes listener, lets in-flight requests finish
```

The HTTP server's `Shutdown` method handles this. While in shutdown, new requests are rejected with a 503 or connection refused.

### Step 2: Wait for in-flight requests

`httpServer.Shutdown` waits for in-flight handlers to return. Each handler is using `r.Context()`, which is *not* cancelled by `Shutdown` — the handler continues normally. If a handler takes too long, the `Shutdown`'s own context deadline fires, and the handler is forced.

### Step 3: Wait for in-flight detached work

The detached pool's `Drain` method waits for all in-flight detached work. Each piece of work is bounded by its own timeout. The drain has its own budget.

```go
pool.Drain(drainCtx) // drainCtx has a deadline
```

### Step 4: Close infrastructure

Close database pools, Kafka producers, file handles, etc. Each has its own shutdown protocol.

### Step 5: Exit

`os.Exit(0)` or return from `main`.

### A real-world shutdown function

```go
func (s *Server) Shutdown(ctx context.Context) error {
    log.Println("shutdown: stopping HTTP")
    if err := s.http.Shutdown(ctx); err != nil {
        log.Printf("http shutdown: %v", err)
    }

    log.Println("shutdown: draining detached work")
    drainCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
    defer cancel()
    if err := s.pool.Drain(drainCtx); err != nil {
        log.Printf("pool drain: %v", err)
    }

    log.Println("shutdown: closing infrastructure")
    if err := s.db.Close(); err != nil {
        log.Printf("db close: %v", err)
    }
    if err := s.kafka.Close(); err != nil {
        log.Printf("kafka close: %v", err)
    }

    log.Println("shutdown complete")
    return nil
}
```

Each step has explicit error logging. None of them aborts the others. The overall budget is set by `ctx`'s deadline (typically 30-90 seconds).

### Budget allocation

If the total shutdown budget is 60 seconds:

- HTTP shutdown: up to 30 seconds (for in-flight requests).
- Detached drain: up to 25 seconds.
- Infrastructure close: up to 5 seconds.

Allocate the budgets in your shutdown code. If any step exceeds its budget, log and move on — do not let one slow step swallow the entire budget.

### SIGTERM vs SIGKILL

Kubernetes sends SIGTERM, then waits `terminationGracePeriodSeconds`, then sends SIGKILL. If your graceful shutdown takes longer than the grace period, you get SIGKILL and lose work.

The default grace period is 30 seconds. If your detached pool needs more, configure the grace period accordingly. If your detached pool needs *much* more (because work can take minutes), you have escalated past category A — use a durable queue.

---

## Supervised Detached Goroutines

A *supervised* detached goroutine is one whose lifecycle is owned by a supervisor. The supervisor is responsible for:

- Spawning the goroutine.
- Recovering from panics.
- Tracking it for shutdown.
- Logging its outcome.
- Restarting it on failure (if appropriate).

The supervisor is a centralised abstraction. Handlers do not manage goroutines directly; they submit work to the supervisor.

### The supervisor interface

```go
type Supervisor interface {
    // Submit submits work for detached execution.
    // The returned ID can be used to look up the work's status.
    Submit(parent context.Context, name string, fn func(context.Context) error) (id OpID)

    // Status returns the current status of an in-flight or completed operation.
    Status(id OpID) (Status, bool)

    // Drain waits for all in-flight work or until ctx is cancelled.
    Drain(ctx context.Context) error
}
```

### The supervisor implementation

```go
type supervisor struct {
    process context.Context
    pool    *Pool
    ops     sync.Map // map[OpID]*Op
}

type Op struct {
    ID      OpID
    Name    string
    Start   time.Time
    End     time.Time
    Err     error
    Status  Status
}

type Status int

const (
    StatusPending Status = iota
    StatusRunning
    StatusDone
    StatusFailed
    StatusPanicked
)

func (s *supervisor) Submit(parent context.Context, name string, fn func(context.Context) error) OpID {
    id := newOpID()
    op := &Op{ID: id, Name: name, Status: StatusPending}
    s.ops.Store(id, op)
    s.pool.Submit(parent, name, 30*time.Second, func(ctx context.Context) error {
        op.Status = StatusRunning
        op.Start = time.Now()
        defer func() {
            op.End = time.Now()
            if r := recover(); r != nil {
                op.Status = StatusPanicked
                op.Err = fmt.Errorf("panic: %v", r)
                return
            }
        }()
        if err := fn(ctx); err != nil {
            op.Status = StatusFailed
            op.Err = err
            return err
        }
        op.Status = StatusDone
        return nil
    })
    return id
}
```

The supervisor tracks each operation in a map. An admin endpoint can query status.

### Supervisor failure modes

- **Supervisor itself crashes.** If the supervisor is a goroutine and it panics, all tracking is lost. Recover at the supervisor level too.
- **Map grows unboundedly.** Operations stay in the map forever. Periodically prune completed ones.
- **Pool saturation.** If the pool is full, `Submit` may block or return an error. The supervisor must handle this.
- **Drain hangs.** If a detached operation never returns (and has no timeout), drain hangs. Always have a per-operation timeout.

### Supervisor good-citizen behaviours

- Drop operations older than 5 minutes from the map.
- Emit a metric for the number of in-flight operations.
- Emit a metric for the queue depth.
- Log a warning if the queue is more than 80% full for more than 30 seconds.
- Expose an admin endpoint for current status.

---

## Distributed Tracing Across the Detach Boundary

Distributed tracing is one of the more interesting interactions with partial cancellation.

### The basics

A trace is a tree of spans. Each span has:

- A trace ID (shared across the whole trace).
- A span ID (unique to this span).
- A parent span ID (the span that started this one).

When work crosses a network or a goroutine boundary, the trace ID is propagated. The OpenTelemetry SDK handles this for HTTP and gRPC.

### Tracing detached work

A detached goroutine has the parent's trace ID (preserved by `WithoutCancel`). It can start a new span as a child of the parent span:

```go
detached := context.WithoutCancel(parent)
ctx, span := tracer.Start(detached, "audit.write")
defer span.End()
// ... work ...
```

The new span is a child of the parent. The trace tree shows the audit as a child of the user request.

### The "orphan span" problem

A common bug: the parent span has been ended (`span.End()` was called when the request finished). The detached goroutine starts a child span. The child span has a parent that is no longer "alive" in the tracer's bookkeeping.

Most tracing SDKs handle this gracefully (the child span is exported with its parent ID, and the trace UI shows them connected). But some bookkeeping (e.g., aggregating per-trace metrics) may be off.

### The "follow-from" link

A more semantically correct pattern is to use a *follows-from* link instead of a parent-child relationship for detached work:

```go
ctx, span := tracer.Start(detached, "audit.write",
    trace.WithLinks(trace.Link{
        SpanContext: trace.SpanContextFromContext(parent),
    }),
)
```

The audit span is not a child of the request span; it is a separate root span linked to the request span. This more accurately represents "the audit was triggered by the request but is not part of the request's work."

### Practical advice

Use parent-child for now. Most tracing systems display it well. Follow-from is more pedantic and less widely supported. Revisit when tracing systems mature.

---

## Backpressure on Detached Pools

A detached pool is a bounded resource. When demand exceeds capacity, you need a backpressure strategy.

### Strategy 1: Block on `Submit`

```go
func (p *Pool) Submit(work func(context.Context)) {
    p.work <- work // blocks if full
}
```

The handler blocks until the pool has space. Predictable but couples the handler to the pool's capacity.

### Strategy 2: Reject on `Submit`

```go
func (p *Pool) Submit(work func(context.Context)) error {
    select {
    case p.work <- work:
        return nil
    default:
        return ErrPoolFull
    }
}
```

The handler immediately knows the pool is full. The handler decides what to do.

### Strategy 3: Buffered queue with overflow to DLQ

```go
func (p *Pool) Submit(work TaskMeta) {
    select {
    case p.work <- work:
    default:
        p.dlq.Enqueue(work)
    }
}
```

Overflow writes to a durable queue. A separate worker drains the DLQ at its own pace. The handler never blocks.

### Strategy 4: Priority lanes

Critical work uses a separate channel with higher priority; best-effort work uses a low-priority channel. The pool drains high first, then low.

### Choosing a strategy

- Strategy 1: when the workload is predictable and the pool is generously sized.
- Strategy 2: when the handler can choose to log-and-skip on overflow.
- Strategy 3: when no work can be lost.
- Strategy 4: when there are tiers of importance.

A common design: strategy 3 for audit; strategy 2 for metrics (because metrics overflow is acceptable); strategy 4 for mixed pools.

### Capacity planning

Size the pool to handle p99 demand, not average. If average is 100 submissions per second and p99 burst is 1000, size the queue to absorb 1000 - 100 × duration submissions worth of overflow.

Monitor:

- Pool queue depth (gauge).
- Pool submissions per second (counter).
- Pool overflow rate (counter).
- Pool worker utilisation (gauge).

A queue that is constantly more than 80% full means the pool is undersized.

---

## Failure Modes and Recovery

A senior-level engineer thinks about how a system fails before it fails.

### Failure: Pool worker panics

Each worker runs `defer recover()`. The panic is logged, the worker continues to the next task.

### Failure: Pool queue full

`Submit` returns an error (strategy 2/3). The handler logs and either retries with backoff or writes to a DLQ.

### Failure: Detached operation hangs

The per-operation timeout fires. The operation aborts. The pool slot is freed.

### Failure: Pool drain times out

The drain has a budget. If the budget elapses before all work completes, the drain returns. The remaining work is lost (or logged for forensic analysis).

### Failure: Process crashes

All in-flight detached work is lost. Recovery requires re-running operations on the next start, which requires the work to be idempotent and a persistent record of what was outstanding.

This is the strongest argument for escalating critical work to a durable queue.

### Failure: Downstream is down

Detached operations retry per their internal policy. After exhausting retries, they log and either write to a DLQ or give up.

### Failure: Memory pressure

Long-running detached goroutines hold their contexts and any captured state. If memory becomes constrained, the GC will not free them. The fix is to bound the duration of detached work and to extract only the values you need (don't capture entire response structs).

### Failure: Connection pool exhaustion

Detached operations open connections. If the connection pool is undersized for the detached load, they queue. The fix is to size the connection pool relative to the worker pool.

---

## The Platform-Level Detached Layer

In a mature codebase, partial cancellation is a *platform* concern, not a per-feature concern. The platform provides:

- A detached pool, configured with sensible defaults.
- A submission API that handles trace propagation, recovery, logging, metrics.
- A drain hook called automatically at shutdown.
- An admin endpoint for status.

Feature teams use the platform; they do not roll their own.

### The platform API

```go
package detached

func Submit(ctx context.Context, name string, fn func(context.Context) error) {
    platform.Submit(ctx, name, fn)
}

func Status() []OpInfo { return platform.Status() }
```

Feature code:

```go
detached.Submit(r.Context(), "order.audit", func(ctx context.Context) error {
    return audit.Write(ctx, order)
})
```

One line. The platform handles everything.

### Why a platform layer

- **Consistency.** Every detached operation uses the same conventions.
- **Centralised tuning.** Pool sizes, timeouts, retry policies are tuned in one place.
- **Centralised observability.** All detached work is visible in one dashboard.
- **Easier audits.** Security and SRE teams can audit one library, not 500 ad-hoc goroutines.

### When to introduce the platform layer

Around 50 detached call sites is the threshold. Below that, per-feature management is fine. Above that, the duplication and inconsistency become a maintenance burden.

### The migration

Build the platform layer in a new package. Add it as an optional path. Migrate one feature at a time. Once 80% of the call sites use the platform, deprecate the ad-hoc approach.

---

## Structured Concurrency and Partial Cancellation

Structured concurrency (per Loom, Java's Structured Task Scope, or Go's proposal `#62488`) says: every concurrent operation belongs to a scope, and the scope is responsible for waiting for and handling errors from all operations.

Partial cancellation as expressed with `WithoutCancel` is *unstructured* — the detached goroutine escapes its parent scope. This is intentional. Structured concurrency is the right default; partial cancellation is the explicit escape hatch.

A structured-concurrency model in Go would look like:

```go
errgroup.WithContext(parent) // structured
context.WithoutCancel(parent) // unstructured — explicit escape
```

The escape is loud and visible. It does not happen by accident.

A senior-level design might say: "by default, all work is structured. We grant exceptions for X, Y, Z" — typically audit, metrics, span export, the things that genuinely cannot be cancelled with the parent.

---

## Migrations and Adoption

### Adopting partial cancellation in an existing codebase

Start with the worst offender: a place where detached work is broken because it uses the parent context. Fix it. The fix is six lines. The benefit is measurable (audit row count goes up, failure rate goes down).

Next, find five more similar places. Apply the same pattern.

Once you have ten examples, introduce the platform layer. Migrate the existing examples to the platform.

Once the platform layer is established, write a linting rule that flags `go func() { ... ctx ... }()` patterns inside handlers and asks "is this detached work? Should it use the platform layer?"

### Migrating from per-feature pools to a platform pool

Each feature team probably has its own ad-hoc detached pool. The platform pool is one shared resource.

Migration:

1. Build the platform pool with the same behaviour as the feature pools.
2. Run benchmarks to confirm equivalent performance.
3. Migrate one feature at a time, behind a feature flag.
4. Roll out the migrated features in stages.
5. Once all features migrate, delete the per-feature pools.

This takes weeks; do not rush.

### Migrating from detached to durable queue

For high-criticality work (audit, payment confirmation, regulatory events), eventually you outgrow the detached pool. The fix is a durable queue.

The migration:

1. Identify the critical detached operations.
2. Build a durable queue (Kafka, SQS, NATS JetStream, or a database-backed queue).
3. Modify the operation to enqueue to the queue instead of executing inline.
4. Build a worker process that consumes the queue.
5. Test, deploy, observe.
6. Eventually, decommission the detached pool path for the migrated operations.

The handler now calls `queue.Enqueue(ctx, event)` instead of `detached.Submit(ctx, "audit", ...)`. The enqueue is a fast network call; it is bound by the request context. The actual audit happens in a separate process, on a different timeline.

---

## Cross-Service Partial Cancellation

Single-process partial cancellation is one thing. Multi-service partial cancellation is another.

Suppose service A calls service B and service C. A's caller cancels. A wants to abort the call to B but let the call to C run to completion.

A's call to B uses the request context, so closing the connection to B aborts B's work (B sees the connection close).
A's call to C uses a detached context. A does not close the connection to C; C runs to completion.

But: A's process can fail. If A crashes between calling C and C returning, C continues but its result is lost. The only way to ensure C completes regardless of A is to enqueue the work to a durable queue. Then C's worker is independent of A.

The cross-service version of partial cancellation is therefore inherently coupled to durable queues. `WithoutCancel` solves the single-process case; queues solve the cross-process case.

---

## Observability for Detached Work

A detached operation that fails silently is worse than no detached operation at all — you have a side-effect that may or may not happen, with no way to know.

Observability for detached work requires:

- **Metrics.** Submissions, in-flight, completions, failures, latencies, queue depth.
- **Logs.** Every failure logged with trace ID and operation name.
- **Traces.** Every operation has its own span linked to the request.
- **Admin endpoint.** Real-time view of in-flight operations.
- **Alerting.** Pages when failure rate or queue depth crosses a threshold.

### Metrics

```go
var (
    detachedSubmissions = metrics.Counter("detached_submissions_total", "name")
    detachedFailures    = metrics.Counter("detached_failures_total", "name", "reason")
    detachedInflight    = metrics.Gauge("detached_inflight", "name")
    detachedDuration    = metrics.Histogram("detached_duration_seconds", "name")
    poolQueueDepth      = metrics.Gauge("detached_pool_queue_depth")
    poolOverflow        = metrics.Counter("detached_pool_overflow_total")
)
```

Each metric provides a different view. Together they answer: how much detached work is happening, how fast, with what failure rate.

### Logs

```
INFO  detached.start name=audit trace=abc123 op=op-7
INFO  detached.done name=audit trace=abc123 op=op-7 ms=42
WARN  detached.fail name=audit trace=abc123 op=op-7 err="dial tcp: timeout"
ERROR detached.panic name=audit trace=abc123 op=op-7 panic="..."
```

Structured logs with the operation ID and trace ID. SREs can query by op ID or trace ID to investigate a specific failure.

### Traces

Every detached operation starts a span. The span is exported even if the operation fails. The span carries the operation name, the duration, the result, and any error.

### Admin endpoint

```
GET /admin/detached
{
  "inflight": [
    {"id": "op-7", "name": "audit", "start": "2026-05-14T12:34:56Z"},
    ...
  ],
  "queue_depth": 47,
  "workers": 100,
  "recent_failures": [...]
}
```

For debugging stuck operations.

### Alerting

- Queue depth > 80% for 5 minutes → page.
- Failure rate > 5% for 10 minutes → page.
- Drain duration > 60% of budget → warn.
- Submission failures (pool full) > 0 → warn.

---

## Case Studies

### Case Study 1: An audit service that lost rows

A team noticed that approximately 0.5% of orders had no audit row. Investigation:

- Audit was a goroutine using `r.Context()`.
- When the client disconnected fast (mobile network drops), the goroutine's context was cancelled.
- The audit insert was cancelled mid-write.

Fix: use `WithoutCancel`. Bonus: add a metric for audit success rate. The metric jumped from 99.5% to 99.99% (the remaining 0.01% was database failures).

Lessons:
- Test detached operations under simulated client disconnects.
- Monitor the success rate, not just the count.

### Case Study 2: A pool that filled up at peak

A service used an unbounded `go` for detached webhooks. At normal load, this was fine. During a marketing spike, the system spawned 50,000 webhooks per second. Memory ballooned, the GC slowed, p99 latency spiked.

Fix: bounded pool, drop overflow to DLQ. p99 stable.

Lessons:
- Unbounded goroutine spawning is never the right answer at scale.
- Capacity planning for detached work is as important as for request handling.

### Case Study 3: A graceful shutdown that took forever

A service's `terminationGracePeriodSeconds` was 30 seconds, but graceful shutdown took 90 seconds because a few detached webhooks had retry budgets of 60 seconds.

Fix: shorter retry budget for graceful-shutdown-aware pool, plus a stop hint that bypasses retries during shutdown.

Lessons:
- Coordinate retry budgets with shutdown budgets.
- Detached operations should know when the process is shutting down.

---

## Antipatterns at Scale

### Antipattern: Per-Handler Pool

Each handler creates its own bounded pool. There are 50 pools, each with its own metrics, each with its own drain, each with its own size. The total worker count is 5000 across the service.

Fix: one platform pool, shared across all handlers.

### Antipattern: Detached Recursion

A detached operation spawns its own detached operations, which spawn their own. The fan-out is unbounded.

Fix: flatten the recursion into a queue.

### Antipattern: Detached With Synchronous Wait

```go
ch := make(chan struct{})
go func() {
    detached := context.WithoutCancel(r.Context())
    doWork(detached)
    close(ch)
}()
<-ch // <-- handler waits, defeating the point of detaching
```

If the handler waits, you have not detached anything from the handler's perspective. The whole point was to return without waiting.

### Antipattern: Single-Flight Without Detach

```go
sf.Do(key, func() (any, error) {
    return load(parent, key) // uses parent context
})
```

The first caller's cancellation affects the others. Always use a detached context inside the singleflight work function.

### Antipattern: Eager Detach in Middleware

```go
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithoutCancel(r.Context())
        r = r.WithContext(ctx)
        next.ServeHTTP(w, r)
    })
}
```

The entire request is now non-cancellable. Every downstream call ignores client disconnect. The system wastes resources on abandoned requests.

---

## Decision Frameworks

### Framework 1: "Should this work be detached?"

```
Does the work primarily benefit the user (load their cart)?
  → No detach.
Does the work primarily benefit the system (audit, metrics)?
  Is the work tied to the request (it depends on request data)?
    → Detach.
  Is the work independent of the request (a periodic flush)?
    → Use a background goroutine, not detach.
```

### Framework 2: "Is detach sufficient, or do I need a queue?"

```
Can the work be lost on process crash without business consequence?
  → Detach is sufficient.
Must the work complete eventually no matter what?
  → Use a durable queue.
```

### Framework 3: "What is my drain budget?"

```
What is the longest detached operation in my system?
What is the longest acceptable shutdown delay?
Set drain budget = min(longest op, shutdown budget * 80%).
```

### Framework 4: "How do I observe this?"

```
For each detached operation:
  - Counter: submissions, completions, failures.
  - Histogram: duration.
  - Gauge: in-flight.
  - Log: every failure with op name and trace ID.
  - Trace: a span per operation.
```

If any of these are missing, the operation is under-observed.

---

## Summary

At senior level, partial cancellation is an architectural pattern. You design the lifetimes, build the platform layer, integrate with shutdown and observability, plan for failure modes, and choose when to escalate to a durable queue.

The single most important senior-level skill: **for every concurrent operation, you can name its lifetime owner.** If you cannot, you have a bug.

The professional file dives into internals: `withoutCancelCtx`, `propagateCancel`, `AfterFunc`, `Cause` propagation, and the relationship to runtime cleanup.

---

## Appendix: A Senior-Level Reading List

- The Go 1.21 release notes section on `WithoutCancel`, `WithDeadlineCause`, and `AfterFunc`.
- The proposal documents at `https://github.com/golang/go/issues/40221` and `#57928`.
- The OpenTelemetry Go SDK source code, particularly `sdk/trace/batch_span_processor.go`.
- Kubernetes lifecycle hooks documentation (for understanding `terminationGracePeriodSeconds`).
- The structured concurrency proposal at `#62488`.
- Articles on saga patterns and the outbox pattern.

These should keep you busy for a month.

---

## Final Word

Partial cancellation looks like a small API. At senior level, you see it as a *position* in a much larger design space — the design of lifetime, the design of observability, the design of graceful shutdown, the design of the platform layer. Each of those is its own book. The thread that runs through them is: who owns this work, and what is its deadline?

If you can answer that question for every goroutine in your service, you have done senior-level partial cancellation correctly.

---

## Deep Dive: Designing a Production-Grade Detached Platform

We will spend the next several thousand lines walking through the design of a production-grade detached platform end-to-end. Every decision is annotated.

### Requirements

The platform must support:

- Submitting detached work with a name, parent context, deadline, and retry policy.
- Bounded queue with overflow handling.
- Bounded worker pool.
- Per-operation timeout.
- Panic recovery.
- Graceful drain at shutdown.
- Tracing integration: each operation has a span linked to its parent.
- Logging integration: each operation logs start, finish, and failures.
- Metrics integration: counters, gauges, histograms.
- Admin endpoint for current status.
- Configurable retry with exponential backoff.
- Optional DLQ for permanent failures.

### Non-requirements (deliberately scoped out)

- Persistent queue (use a real durable queue for that).
- Distributed coordination (the platform is per-process).
- Priority lanes (one pool, one priority).
- Dynamic resizing (static pool size, restart to change).

### The package layout

```
detached/
├── platform.go       — public API
├── pool.go           — worker pool
├── op.go             — Op and Status types
├── tracing.go        — span integration
├── metrics.go        — metric integration
├── logging.go        — log integration
├── admin.go          — admin endpoint
├── retry.go          — retry policy
├── dlq.go            — dead-letter integration
└── platform_test.go  — tests
```

### Public API

```go
package detached

import (
    "context"
    "time"
)

type Platform struct {
    // ... unexported ...
}

type Config struct {
    Workers         int
    QueueSize       int
    DefaultTimeout  time.Duration
    DefaultAttempts int
    OnDLQ           func(Op) // called when an op exhausts retries
}

func New(processCtx context.Context, cfg Config) *Platform

func (p *Platform) Submit(parent context.Context, name string, fn func(context.Context) error)

func (p *Platform) SubmitWithOptions(parent context.Context, name string, opts Options, fn func(context.Context) error)

type Options struct {
    Timeout  time.Duration
    Attempts int
    Backoff  func(attempt int) time.Duration
}

func (p *Platform) Drain(ctx context.Context) error

func (p *Platform) Status() Snapshot

type Snapshot struct {
    InFlight   []Op
    QueueDepth int
    Workers    int
    Metrics    SnapshotMetrics
}
```

Simple at the call site, rich underneath.

### Internal types

```go
type Op struct {
    ID       OpID
    Name     string
    Parent   context.Context
    Fn       func(context.Context) error
    Opts     Options
    Status   Status
    Start    time.Time
    End      time.Time
    Attempts int
    Err      error
}

type Status int

const (
    StatusPending Status = iota
    StatusRunning
    StatusRetrying
    StatusDone
    StatusFailed
    StatusPanicked
)
```

### The worker loop

```go
func (p *Platform) worker(id int) {
    defer p.wg.Done()
    for {
        select {
        case op, ok := <-p.work:
            if !ok {
                return
            }
            p.execute(op)
        case <-p.process.Done():
            return
        }
    }
}

func (p *Platform) execute(op *Op) {
    op.Status = StatusRunning
    op.Start = time.Now()
    defer func() {
        op.End = time.Now()
        p.completed(op)
    }()
    defer p.recoverPanic(op)

    detached := context.WithoutCancel(op.Parent)
    for attempt := 0; attempt < op.Opts.Attempts; attempt++ {
        op.Attempts = attempt + 1
        ctx, cancel := context.WithTimeout(detached, op.Opts.Timeout)
        err := op.Fn(ctx)
        cancel()
        if err == nil {
            op.Status = StatusDone
            return
        }
        if attempt == op.Opts.Attempts-1 {
            op.Status = StatusFailed
            op.Err = err
            if p.cfg.OnDLQ != nil {
                p.cfg.OnDLQ(*op)
            }
            return
        }
        op.Status = StatusRetrying
        time.Sleep(op.Opts.Backoff(attempt))
        select {
        case <-p.process.Done():
            op.Status = StatusFailed
            op.Err = errors.New("aborted during retry: process shutdown")
            return
        default:
        }
    }
}
```

This is the core. Several things to notice:

- The detach happens once, before the retry loop. Each attempt has its own timeout.
- The retry checks `p.process.Done()` between attempts, so shutdown is responsive.
- Failure is logged via `completed`; DLQ is invoked.
- Panics are recovered (deferred at the top).

### Recovery

```go
func (p *Platform) recoverPanic(op *Op) {
    if r := recover(); r != nil {
        op.Status = StatusPanicked
        op.Err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        log.Printf("detached panic op=%s err=%v", op.Name, op.Err)
        metrics.Inc("detached_panics_total", "name", op.Name)
    }
}
```

The stack trace is captured for debugging.

### Tracing

```go
func (p *Platform) startSpan(parent context.Context, name string) (context.Context, trace.Span) {
    return tracer.Start(parent, "detached."+name,
        trace.WithLinks(trace.Link{SpanContext: trace.SpanContextFromContext(parent)}))
}
```

Each detached operation has its own span linked to the parent. The detached context is used as the span's parent context, so the span's lifetime is the operation's lifetime.

### Metrics

```go
type metrics struct {
    submitted *prom.CounterVec
    completed *prom.CounterVec
    failed    *prom.CounterVec
    panicked  *prom.CounterVec
    inflight  *prom.GaugeVec
    duration  *prom.HistogramVec
    queue     prom.Gauge
}

func (p *Platform) onSubmit(op *Op) {
    p.m.submitted.WithLabelValues(op.Name).Inc()
    p.m.inflight.WithLabelValues(op.Name).Inc()
    p.m.queue.Set(float64(len(p.work)))
}

func (p *Platform) onComplete(op *Op) {
    p.m.inflight.WithLabelValues(op.Name).Dec()
    p.m.duration.WithLabelValues(op.Name).Observe(op.End.Sub(op.Start).Seconds())
    switch op.Status {
    case StatusDone:
        p.m.completed.WithLabelValues(op.Name).Inc()
    case StatusFailed:
        p.m.failed.WithLabelValues(op.Name).Inc()
    case StatusPanicked:
        p.m.panicked.WithLabelValues(op.Name).Inc()
    }
}
```

### Drain

```go
func (p *Platform) Drain(ctx context.Context) error {
    close(p.work)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Close the work channel; workers drain remaining tasks; wait for the wait-group; respect the drain budget.

A subtle point: after `close(p.work)`, new submissions to `p.work` will panic. The platform must reject new submissions during drain:

```go
func (p *Platform) Submit(parent context.Context, name string, fn func(context.Context) error) {
    select {
    case <-p.draining:
        log.Printf("detached: submission after drain start, name=%s", name)
        return
    default:
    }
    // ... usual submit logic ...
}
```

A `draining` channel is closed at the start of `Drain`. Subsequent submissions are dropped with a log.

### Admin endpoint

```go
func (p *Platform) AdminHandler() http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        snap := p.Status()
        _ = json.NewEncoder(w).Encode(snap)
    })
}
```

A JSON snapshot. Useful for `curl localhost:9000/admin/detached` during incidents.

### Tests

The platform's tests should cover:

- Submission and completion (happy path).
- Submission rejection on full queue.
- Retry on failure.
- DLQ on retry exhaustion.
- Panic recovery.
- Drain waits for all in-flight.
- Drain respects budget.
- Submissions during drain are rejected.
- Metrics are emitted correctly.
- Trace IDs are preserved.

Each test is small but stamping out 10+ tests on the platform pays for itself many times over.

---

## Deep Dive: The Saga Pattern with Partial Cancellation

A saga is a sequence of operations with compensating actions on failure. Partial cancellation appears at every step.

### A typical saga

Booking a vacation involves:

1. Reserve a hotel.
2. Reserve a flight.
3. Charge the credit card.
4. Send the confirmation email.

If step 3 fails, you must compensate steps 1 and 2 (release the hotel and flight reservations). If step 4 fails, you typically log and move on — the booking is valid, the email is best-effort.

### Saga with detached compensation

```go
type Step struct {
    Do         func(context.Context) error
    Compensate func(context.Context) error
}

func RunSaga(parent context.Context, steps []Step) error {
    var done []Step
    for _, step := range steps {
        if err := step.Do(parent); err != nil {
            // Failure: compensate done steps, detached.
            for _, prev := range done {
                p := prev
                detached.Submit(parent, "compensate", func(ctx context.Context) error {
                    return p.Compensate(ctx)
                })
            }
            return err
        }
        done = append(done, step)
    }
    return nil
}
```

The main saga uses the parent context — if the caller cancels, the saga aborts.
The compensations are detached — they must run even if the caller has given up.

### Edge case: caller cancels during compensation

If the caller cancels after the saga has started compensating but before the compensations finish, what happens?

- The main saga returns the error.
- The compensations are detached, so they continue running.
- The caller receives the error.

This is the correct behaviour. The caller's view says "booking failed." The system's view says "in-flight reservations are being released."

### Edge case: compensation fails

A compensation may itself fail. The detached operation logs and retries. If retries exhaust, the compensation is written to a DLQ for manual recovery.

In severe cases, the compensation may not be reliable: a hotel reservation that needs manual release. For such cases, the compensation enqueues a message to a queue consumed by an operator dashboard.

### Why detached, not synchronous?

You could compensate synchronously inside the saga function. The caller would wait for compensations to complete before seeing the failure.

Detached compensation has two advantages:

- The caller sees the failure immediately (lower latency on failure).
- The compensations can run in parallel.

The disadvantage:

- The caller does not know if compensations succeeded.

For most sagas, the parallel speedup and lower latency on failure are worth the loss of synchronous confirmation. The DLQ catches compensations that need manual intervention.

---

## Deep Dive: Backpressure Across Layers

Backpressure in a service with detached work has three layers:

1. **Request-level backpressure.** When the service is overloaded, reject new requests with 503.
2. **Handler-level backpressure.** When a downstream is slow, the handler's context times out.
3. **Detached-pool-level backpressure.** When the detached pool is full, `Submit` fails.

Each layer has its own signal. Each layer responds differently.

### Request-level

Use a rate limiter or admission controller in front of the service. When admission rate exceeds threshold, new requests get 503.

### Handler-level

Each downstream call has its own timeout. When a downstream times out, the handler returns 504 or fallbacks.

### Detached-pool-level

When the pool is full, `Submit` returns an error. The handler either:

- Retries with backoff (rarely useful — the pool is still full).
- Writes to a DLQ (durable, processed later).
- Logs and drops (acceptable for best-effort work).

### Coordinating the layers

The three layers should be coordinated. If the detached pool is consistently full, request-level admission should tighten. If the handler is consistently timing out, an alert fires.

A real-time dashboard shows:

- Request admission rate vs capacity.
- Handler latency p99 vs SLO.
- Pool queue depth vs capacity.
- Pool overflow rate.

A SRE looks at this dashboard during an incident and decides where the bottleneck is.

---

## Deep Dive: Multi-Tenant Detached Pools

A multi-tenant service handles requests from many tenants. One tenant should not starve detached pool resources from others.

### Strategy 1: Per-tenant pool

Each tenant has its own dedicated pool. Isolation is strong. Resource usage is bounded.

```go
type MultiTenant struct {
    pools sync.Map // map[TenantID]*Pool
}

func (m *MultiTenant) Submit(parent context.Context, tenant TenantID, name string, fn func(context.Context) error) {
    p, _ := m.pools.LoadOrStore(tenant, NewPool(processCtx, 10))
    p.(*Pool).Submit(parent, name, time.Minute, fn)
}
```

Downside: many small pools, each with some idle capacity. Total capacity is fragmented.

### Strategy 2: Shared pool with per-tenant quotas

One pool, with internal accounting of per-tenant in-flight count.

```go
type QuotaPool struct {
    inner   *Pool
    quotas  map[TenantID]int
    counts  sync.Map // map[TenantID]*atomic.Int32
}

func (q *QuotaPool) Submit(parent context.Context, tenant TenantID, ...) {
    count, _ := q.counts.LoadOrStore(tenant, new(atomic.Int32))
    c := count.(*atomic.Int32)
    if c.Load() >= int32(q.quotas[tenant]) {
        return errors.New("tenant quota exceeded")
    }
    c.Add(1)
    q.inner.Submit(parent, name, timeout, func(ctx context.Context) error {
        defer c.Add(-1)
        return fn(ctx)
    })
}
```

Better resource usage; per-tenant cap.

### Strategy 3: Weighted fair queueing

The pool dequeues from per-tenant queues round-robin. Even at saturation, every tenant gets a slice.

More complex to implement; useful when no single tenant should starve others under heavy load.

### Choosing

- Few tenants, simple isolation needs: per-tenant pool.
- Many tenants, simple quota: shared pool with quotas.
- Many tenants, strict fairness: weighted fair queueing.

---

## Deep Dive: The Lifecycle of a Detached Operation

Let us trace one operation through its entire lifecycle.

### t=0: Submission

The handler calls `pool.Submit(ctx, "audit", auditFn)`.

The pool:

1. Wraps `auditFn` in a closure that detaches the context, applies the timeout, and recovers panics.
2. Sends the closure to the work channel.
3. Increments the "submitted" counter.

If the work channel is full, the submission is rejected and an error is returned.

### t=1ms: Pickup

A worker goroutine reads from the work channel. The worker:

1. Notes the start time.
2. Updates the operation's status to "running."
3. Increments the "in-flight" gauge.
4. Starts the operation.

### t=2ms to t=50ms: Execution

The operation runs. It uses the detached context (with timeout). It may call downstream services, write to the database, emit events.

### t=51ms: Completion or failure

The operation returns.

If successful:
- Status: Done.
- Increment "completed" counter.
- Record duration in histogram.
- Decrement "in-flight" gauge.

If failed (returned an error):
- Status: Failed (or Retrying if more attempts remain).
- If retrying: sleep, then loop back to execution.
- If failed permanently: increment "failed" counter, call DLQ if configured.

If panicked:
- Recovered.
- Status: Panicked.
- Increment "panicked" counter.
- Log the stack trace.

### t=52ms: Cleanup

The worker is free for the next operation. The completed operation's record is kept in the operations map for some time (for admin queries), then pruned.

### Lifecycle metrics

The histogram records the duration. The counter records the outcome. The admin endpoint can show the current state.

A typical operation has:
- p50 duration: 20ms
- p99 duration: 200ms
- Failure rate: 0.1%
- Panic rate: 0.001%

These numbers vary per operation. Monitor each operation separately.

---

## Deep Dive: Operational Runbooks

A senior-level service has runbooks for common incidents involving detached work.

### Runbook: Pool queue depth alert

**Trigger:** Queue depth > 80% for 5 minutes.

**Investigation:**
1. Check pool worker utilisation. Are workers idle? If yes, the bottleneck is elsewhere (database, downstream).
2. Check downstream service health.
3. Check database connection pool. Is it saturated?
4. Check submission rate. Has it spiked?

**Mitigation:**
1. If transient: wait it out, log post-incident.
2. If sustained: scale the pool (requires restart with new config).
3. If downstream is dead: stop submitting to the pool until downstream recovers.

### Runbook: Drain timeout

**Trigger:** Pod is being terminated; drain budget elapses before all work completes.

**Investigation:**
1. Check the admin endpoint for in-flight operations.
2. Identify any operation that takes longer than the drain budget.
3. Check if those operations should be in a durable queue instead.

**Mitigation:**
1. Increase Kubernetes `terminationGracePeriodSeconds` for the deployment.
2. Migrate long-running operations to a durable queue.
3. Reduce per-operation timeout (but ensure the operation completes within the new timeout).

### Runbook: Repeated panics

**Trigger:** Panic counter increments more than 10 in 5 minutes.

**Investigation:**
1. Check logs for the panic stack traces.
2. Identify the panicking operation.
3. Look at recent code changes to that operation.

**Mitigation:**
1. Revert the recent change.
2. Add defensive code to handle bad input.

### Runbook: DLQ growing

**Trigger:** DLQ size > 1000.

**Investigation:**
1. Check the DLQ entries. What is the common error?
2. Is the downstream broken?
3. Is the data malformed?

**Mitigation:**
1. Fix the downstream or the data.
2. Replay the DLQ.
3. Add monitoring to catch this earlier next time.

---

## Deep Dive: Migration Stories

Two real migrations to learn from.

### Migration 1: From `go func` to platform pool

A startup had grown to about 200 detached `go func` call sites across 30 files. Each call site had its own conventions. The team wanted to standardise.

Steps taken:

1. **Audit.** Identified all 200 call sites. Classified by purpose (audit, metric, webhook, etc.).
2. **Platform.** Built the `detached` package with the API shown above.
3. **Pilot.** Migrated one feature (audit) over a week. Measured behavior. Confirmed no regressions.
4. **Rollout.** Migrated remaining features in priority order: webhooks, then metrics, then ad-hoc cleanup.
5. **Lint.** Added a linter that flags new `go func` in handlers as a warning. Manual review required to confirm.
6. **Cleanup.** Removed the old ad-hoc helpers from the codebase.

Duration: 8 weeks for the audit; 4 months for the full migration.

Outcome: 200 call sites converged to one library. Observability dramatically improved. Drain became reliable.

### Migration 2: From platform pool to durable queue

A team's audit service was a critical compliance requirement. Lost audit rows were a regulatory problem.

Steps taken:

1. **Identify.** Audit was the only operation with regulatory weight; everything else was fine.
2. **Queue.** Set up Kafka as the audit transport. Defined the schema.
3. **Producer.** Modified the audit handler to enqueue to Kafka instead of calling the detached pool.
4. **Consumer.** Built a separate worker process that consumed from Kafka and wrote to the audit database.
5. **Cutover.** Behind a feature flag, switched production traffic to the new path.
6. **Verify.** Compared audit-row counts before and after. Confirmed parity.
7. **Decommission.** Removed the detached-pool path for audit.

Duration: 6 weeks.

Outcome: zero audit-row loss even on process crash. Latency unchanged.

---

## Final Senior-Level Mindset

At senior level, partial cancellation is one tool in a much larger lifetime-management toolkit. Other tools:

- Process-lifetime goroutines.
- Durable queues.
- Sagas.
- Outbox pattern.
- Eventual-consistency replication.

`WithoutCancel` is the sub-minute, in-memory, best-effort end of this spectrum. The senior engineer knows when to use it and when to reach for something more durable.

A senior-level review of any "let me detach this" PR should ask:

- Is the work best-effort, or must it complete?
- Is the work short, or could it take minutes?
- Is the work idempotent?
- What is the consequence of loss on process crash?
- Should this be in a durable queue instead?

If the answer is "must complete, could take a long time, loss has business consequence," the answer is not `WithoutCancel` — it is Kafka.

If the answer is "best-effort, sub-minute, loss is acceptable, idempotent," the answer is the detached platform layer.

That distinction is where senior-level partial cancellation lives.

---

## Closing Reflections

The promise of partial cancellation is simple: "let this work outlive that work." The reality involves dozens of decisions about lifetime, observability, recovery, drain, capacity, and migration.

A senior engineer can build a service that handles these decisions cleanly. The platform layer hides the complexity from feature teams. Feature teams write one-liners. The platform handles the rest.

When the platform is in place, partial cancellation is a non-event. Engineers think about *whether* they need it and let the platform handle *how*.

That is the senior-level success criterion: making something that was once tricky into something that is routine.

---

## Appendix: A Comparison Table With Other Lifetime-Management Tools

| Tool | Use case | Bounded by | Lost on crash? | Idempotent required? |
|---|---|---|---|---|
| Synchronous call | Caller waits | Caller's deadline | No (caller still has data) | No |
| Goroutine + request ctx | Async, caller may give up | Request | Yes | Yes (best to be) |
| Detached + pool | Outlive request, sub-minute | Operation deadline | Yes | Yes |
| Durable queue | Outlive process, minutes-hours | Queue retention | No | Yes |
| Database outbox | Outlive process, transactional | Reaper schedule | No | Yes |
| Saga | Multi-step business workflow | Saga timeout | Maybe (compensations) | Per step |

Read this table top-to-bottom. Each row trades simplicity for durability. Choose the right row for the problem.

---

## Appendix: Where to Look in Real Codebases

If you want to learn from real partial-cancellation code, look at:

- The Kubernetes `client-go` library, particularly its informer cache eviction code.
- The `etcd` codebase's lease keep-alive goroutines.
- The OpenTelemetry SDK's batch span processor.
- The `cilium` networking project's controller framework.
- Cloud-provider SDKs (AWS SDK Go v2) for the way they handle async operations.

These projects have wrestled with partial cancellation in production for years. Their idioms are battle-tested.

---

## Appendix: A Year's Worth of Reading

If you want to deepen partial-cancellation skills over a year:

- Month 1: Build the 12-step middle-level exercise and the 200-line platform layer.
- Month 2: Read the OpenTelemetry SDK source code.
- Month 3: Read the Kubernetes informer code.
- Month 4: Build a saga with compensation in your own service.
- Month 5: Migrate one critical operation from detached pool to durable queue.
- Month 6: Add tenant quotas to your detached pool.
- Month 7: Build the admin endpoint, dashboards, and alerts.
- Month 8: Lead a code review on a colleague's PR that introduces detached work.
- Month 9: Write a post-mortem on a detached-work incident.
- Month 10: Mentor a junior engineer through their first detached implementation.
- Month 11: Run a half-day workshop on lifetime management.
- Month 12: Write an internal doc that captures everything you have learned.

By month 12, you are not just using partial cancellation — you are teaching it.

---

## Appendix: Frequent Questions From Reviewers

**Why not just use `context.Background()` for the audit?**

Because you lose the trace ID, the user ID, and other request values. `WithoutCancel` preserves them.

**Why not use a synchronous `defer audit(...)` at the end of the handler?**

Because the handler will wait for the audit to complete before returning. Latency hit.

**Why not use a goroutine without `WithoutCancel`?**

Because the goroutine's context will be cancelled when the request ends, aborting the audit mid-write.

**Why not just keep the audit synchronous and accept the latency?**

If your latency SLO allows it, fine. Many services choose this. But once you have 10 side-effects per request, the latency adds up.

**Why a pool? Why not just `go` for each detached operation?**

Goroutines are cheap, but their downstream effects (database connections, file descriptors, HTTP requests) are not. A pool bounds the total resource use.

**Why a platform package?**

Consistency, observability, central tuning, easier audits.

**Why bother with retries inside the pool?**

Transient failures are common. Retries with backoff catch most of them. Without retries, you lose work to ephemeral issues.

**Why a DLQ?**

For when retries exhaust. You want a way to find and fix the failed work.

**Why drain at shutdown?**

To avoid losing in-flight work. Even with retries and DLQ, work in flight when the process exits is lost unless drained.

These are the standard objections. You should have an answer to each.

---

## Final Final Closing

`WithoutCancel` is one function. The architecture around it is a year's work. The senior engineer is the person who has done that year's work and made it look easy for everyone else.

---

## Extended Topic: Choosing Your Detach Boundary

At senior level, *where* you detach matters as much as *whether* you detach.

### Boundary at the handler

The most common boundary. The handler detaches immediately before spawning a side-effect:

```go
func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    // ... main work ...
    detached := context.WithoutCancel(r.Context())
    go audit(detached)
}
```

Simple, visible, traceable.

### Boundary at the service

A service method does both main work and detached side-effects. The handler is unaware of detached work; it just calls the service:

```go
func (s *OrderService) Place(ctx context.Context, req PlaceRequest) (*Order, error) {
    order, err := s.place(ctx, req)
    if err != nil {
        return nil, err
    }
    // Service-level detach.
    s.pool.Submit(ctx, "audit", auditFn)
    return order, nil
}
```

Cleaner separation of concerns: the handler is purely about HTTP; the service is about business logic and side-effects.

### Boundary at the repository

The detached operation is part of the data access layer:

```go
func (r *AuditRepo) Record(parent context.Context, ev Event) {
    r.pool.Submit(parent, "audit", func(ctx context.Context) error {
        return r.db.InsertAudit(ctx, ev)
    })
}
```

The repository owns its detached behaviour. Callers do not know or care.

### Choosing the boundary

- **Handler boundary** is right when the side-effect is specific to one handler.
- **Service boundary** is right when the side-effect is part of the business semantics of an operation.
- **Repository boundary** is right when the side-effect is intrinsic to the data layer (e.g., audit is always written for every write to this table).

Most teams settle on service or repository boundaries for consistency. Handler boundaries are reserved for one-off cases.

---

## Extended Topic: Cross-Process Lifetimes

A handler spawns a detached goroutine. The detached goroutine calls a downstream service. The downstream service runs in another process.

When the original caller cancels:
- The handler's `r.Context()` is cancelled.
- The detached goroutine's context is not.
- The downstream call is unaffected.

When the handler's process crashes:
- The detached goroutine is killed (process-wide).
- The downstream call is in flight on the network — the TCP socket closes.
- The downstream service sees the connection close and may or may not roll back its work.

The key insight: detached work *within* a process is reliable; detached work *across* processes requires explicit coordination.

For cross-process reliability:

- Idempotent operations. If the call is interrupted, redoing it must be safe.
- Persistent queues. Enqueue first, process later.
- Outbox pattern. Write the intent to a database in the same transaction as the primary write; a separate process consumes the outbox.

`WithoutCancel` is a in-process tool. Cross-process partial cancellation requires more.

---

## Extended Topic: Detached Work and Idempotency

A detached operation that runs at most once is a luxury. Realistically, detached operations may be retried by the pool (on transient failure) and may be re-submitted by the handler (on caller retry). They must be idempotent.

### What idempotent means

An operation is idempotent if running it twice has the same effect as running it once.

- `INSERT ... ON CONFLICT DO NOTHING` is idempotent.
- `UPDATE counter SET value = value + 1` is *not* idempotent.
- `UPDATE counter SET value = 42` is idempotent (assuming the same value).
- `POST /webhook` is not idempotent by default; with an idempotency key, it can be.

### Designing for idempotency

- Use natural unique keys (the order ID, the audit row ID) rather than auto-increment IDs.
- Use `ON CONFLICT DO NOTHING` or `INSERT ... IF NOT EXISTS`.
- Pass idempotency keys to downstream services that support them.
- Treat side-effects as "request to do X" rather than "do X" — the operation should check if X has already been done.

### Verifying idempotency

In a test:

```go
func TestAuditIdempotent(t *testing.T) {
    ev := Event{ID: "e1", Data: "x"}
    if err := writeAudit(ctx, ev); err != nil {
        t.Fatal(err)
    }
    if err := writeAudit(ctx, ev); err != nil {
        t.Fatal(err) // second write must also succeed
    }
    count := countRows(ev.ID)
    if count != 1 {
        t.Fatalf("expected 1 row, got %d", count)
    }
}
```

Running the operation twice should leave the system in the same state as running it once.

---

## Extended Topic: Observability Across Detach Boundaries

When a detached operation fails, the operator needs to be able to find the related request. Conversely, when a request fails downstream, the operator needs to find the related detached operations.

### Correlation IDs

Each request has a unique correlation ID. The ID is logged in every log line related to the request. The detached operation logs the same ID.

```
INFO request.start id=req-7 path=/order
INFO request.end id=req-7 path=/order status=201 ms=42
INFO detached.start id=req-7 name=audit op=op-99
INFO detached.end id=req-7 name=audit op=op-99 ms=23 status=done
```

Grepping `id=req-7` shows the full timeline.

### Trace context

A more sophisticated approach uses distributed traces. The detached operation's span is linked to the request span. A trace view shows the request and all its detached operations as a tree.

### Metrics per operation name

The detached pool emits metrics labelled by operation name. A dashboard shows, per name:

- Submissions per second.
- Failures per second.
- Latency p50 / p99.
- In-flight count.

A regression in any of these signals a problem.

### Sampling

For very high-throughput detached operations, full per-operation logging is expensive. Sample at 1% or 10%. Always log failures fully.

### Alerts

- Submission rate drops to 0: maybe the upstream stopped submitting (bug).
- Failure rate spikes: investigate.
- Queue depth grows: pool is overloaded.
- p99 latency spikes: downstream is slow.

Each alert has its own runbook. The on-call engineer needs the runbook plus the metrics plus the logs.

---

## Extended Topic: The Cost of Wrong Decisions

What goes wrong when partial cancellation is misapplied?

### Cost 1: Wasted server resources

Detaching all reads (so they "don't error out") means every reader continues even after the user has disconnected. CPU, memory, downstream calls, all wasted.

In a service doing 10,000 requests per second with 50% client-disconnect-before-completion rate, detaching the reads wastes 5,000 reads per second worth of resources. That can be the difference between needing 10 servers and needing 20.

### Cost 2: Stuck shutdowns

Detached operations with no per-op timeout, running for minutes, prevent graceful shutdown. The pod is killed by Kubernetes. Work in flight is lost. The user sees inconsistent state.

### Cost 3: Unbounded goroutine growth

Detached operations spawned without a pool, with no bound. Under load, goroutine count grows unbounded. Eventually the process runs out of memory.

### Cost 4: Lost critical work

Detached operations crashed by panic. No DLQ. The work is silently dropped. The business sees missing audit rows, missing notifications, missing events.

### Cost 5: Hidden coupling

A detached operation depends on a value in the parent context. The parent code changes; the value is no longer there. The detached operation breaks silently.

### Cost 6: Cascading failures

A detached pool fills up because the downstream is slow. Handlers block on `Submit`. Request latency spikes. The service starts dropping requests. The downstream sees its load drop and recovers — but the service is now in a bad state because the pool is still full.

Each of these costs is paid by a team that did not think about partial cancellation deeply.

---

## Extended Topic: Reviewing Detached Code

A code review of detached code should ask:

1. **What is being detached and why?** Explain the necessity.
2. **What is the operation's deadline?** Should there be one? Is it the right value?
3. **What happens on failure?** Logged? Retried? DLQ?
4. **What happens on panic?** Recovered?
5. **What happens at shutdown?** Drained? Aborted?
6. **What values does the detached context need?** Trace ID? User ID? Tenant ID?
7. **What downstream resources does it use?** Database connections? HTTP clients?
8. **What is the steady-state rate of this operation?** Will it overwhelm anything?
9. **Is the operation idempotent?** If retried, will it cause duplicates?
10. **Is there a metric, a log, and a trace?**

If any answer is unsatisfactory, ask the author to add context.

---

## Extended Topic: A Conversational Pattern Library

Here are five conversation snippets you might have in a code review.

### Conversation 1

Reviewer: "Why detach here? Is this work for the user?"
Author: "It is for the analytics dashboard. The user never sees it. We just need the data eventually."
Reviewer: "Then a durable queue is a better fit — analytics has tolerance for delay but loss is a problem. Detached pool can lose on crash."
Author: "Fair point. Let me write to Kafka instead."

### Conversation 2

Reviewer: "I see `WithoutCancel(parent)` but no timeout. What bounds this?"
Author: "The downstream call has its own timeout."
Reviewer: "Let's add a context timeout in addition. Defensive depth — if the client's timeout fails, the context still wins."
Author: "Done."

### Conversation 3

Reviewer: "This is a detached `go func` directly. Why not use the platform pool?"
Author: "I wasn't aware of it. Where's the docs?"
Reviewer: "`internal/detached`. Submit instead of `go func`; everything else is automatic."
Author: "Migrating."

### Conversation 4

Reviewer: "What happens if this panics?"
Author: "Then... the program crashes?"
Reviewer: "Don't ship code that crashes the server on bad input. Add `defer recover` or use the platform pool which has it built in."
Author: "Switching to the platform."

### Conversation 5

Reviewer: "Why does the detached context have the user's auth token?"
Author: "It needs to call the auth-checked endpoint."
Reviewer: "Tokens have short TTLs. The detached call may run after the token expires."
Author: "Let me load a fresh service-account token in the detached goroutine instead."

These are the daily conversations of a senior engineer.

---

## Extended Topic: A Mental Checklist Before Detaching

Before reaching for `WithoutCancel`, ask:

1. Will this work be wasted if the request is cancelled?
2. Is the user expecting the result?
3. Is the work side-effect-only?
4. Is the work bounded in duration?
5. Is the work idempotent?
6. Is the work tolerant of loss on crash?
7. Is the work bounded in resource use?
8. Does it have a clear deadline?
9. Is it observable?
10. Is it recoverable from panic?

A "no" to any of these is a yellow flag. Two or more "no" answers and you should reconsider.

---

## Extended Topic: When Detaching Is Wrong, the Right Tool

If detaching is wrong because:

- The work is user-visible → keep it synchronous (or partly so).
- The work must complete (cannot be lost) → durable queue.
- The work is long-running → durable queue or saga.
- The work is multi-step with compensations → saga.
- The work crosses process boundaries → durable queue plus idempotency.
- The work has unbounded resources → durable queue with worker pool.

Each alternative has its own implementation cost. Pick the one that fits the requirement.

---

## Extended Topic: The Migration Path

A team that grows organically usually walks this path:

1. **No background work.** All operations are synchronous in handlers.
2. **`go func` everywhere.** Detached work is ad-hoc.
3. **Internal helpers.** `safeGo`, `runDetached`, etc.
4. **A platform package.** Centralised pool, observability, recovery.
5. **Durable queues for critical operations.** Audit, notifications, billing events.
6. **Sagas and outboxes.** For multi-step business workflows.
7. **External workflow engines.** Temporal, Cadence, AWS Step Functions.

Each step is a level up. Most companies live at step 4 or 5 for years. Step 6 and 7 require dedicated infrastructure investment.

Knowing where you are on this path helps you plan the next step. A team at step 2 should not try to jump to step 7. A team at step 5 should not stay there if step 6 would solve their problems.

---

## Extended Topic: Communication with Stakeholders

When partial cancellation is part of a service's design, you need to communicate it to:

- **Product managers** — explain that "the email goes out after the response" means the email may take longer than the response.
- **SREs** — explain the drain budget and the implications for `terminationGracePeriodSeconds`.
- **Auditors** — explain the durability story for compliance-relevant operations.
- **Junior engineers** — explain why the codebase uses the platform layer and not ad-hoc `go func`.

Each audience needs a different level of detail. Practice giving the 5-minute version, the 30-minute version, and the full 2-hour version.

---

## Extended Topic: Long-Term Maintenance

A partial-cancellation system needs ongoing care:

- **Pool sizing reviews** every quarter. Are the pools well-sized for current load?
- **Per-operation deadlines reviews.** Are they still right?
- **Failure rate reviews.** Are we catching failures? Do we have alerts for new failure modes?
- **Migration reviews.** Are there operations that should move to a durable queue?
- **Documentation reviews.** Is the platform docs up to date?
- **Onboarding material reviews.** Are new engineers learning the right patterns?

A neglected partial-cancellation system slowly degrades. Scheduled reviews keep it healthy.

---

## Extended Topic: When the Senior Engineer Becomes the Bottleneck

A common failure mode: only the senior engineer understands partial cancellation. Every PR involving detached work needs their review. They become a bottleneck.

The fix: documentation, training, linting, code review checklists. Distribute the knowledge. The senior engineer's job is to make the team self-sufficient, not to be the single point of expertise.

Concrete steps:

- Write a 5-page internal doc on partial cancellation.
- Give a 1-hour tech talk to the team.
- Pair with one engineer per quarter on a detached-work feature.
- Document the code review checklist.
- Add automated linting for common mistakes.
- Set up an internal forum for questions.

Over six months, the team becomes self-sufficient. The senior engineer can focus on higher-level work.

---

## Senior-Level Conclusion

Partial cancellation at senior level is no longer about an API. It is about:

- Architecting lifetimes.
- Designing platform layers.
- Operating production systems.
- Migrating between abstractions.
- Communicating with stakeholders.
- Maintaining and evolving the system over years.

A senior engineer reads `context.WithoutCancel(parent)` and sees the entire architecture behind it. A junior engineer sees a function call. The gap between those views is what this file teaches.

If you can take a service from "scattered `go func` detached work" to "platform-managed observable resilient detached work," and then to "appropriate work is moved to durable queues with sagas for compensations," and you can explain each step, you have mastered senior-level partial cancellation.

The professional file dives into how the standard library implements all of this — the runtime mechanics of `withoutCancelCtx`, `propagateCancel`, `Cause`, `AfterFunc`, and the subtle compositions that make it work.

---

## Closing Anecdote

A senior engineer who joined a team found a service with 47 ad-hoc detached goroutines. The drain timed out at every deploy. Audit rows were missing. Customers were complaining about delayed confirmation emails.

Over four months, the engineer:

- Built a platform layer.
- Migrated all 47 call sites.
- Added observability.
- Identified the audit subsystem as a candidate for durable queueing.
- Migrated audit to Kafka.
- Wrote runbooks.
- Trained the team.

After four months: drains were reliable. Audit rows were never lost. Customer complaints about emails dropped to zero. The team understood the architecture and could maintain it.

The engineer did not write a fancy algorithm or invent a new technology. They applied existing patterns systematically and made them part of the team's daily practice.

That is senior-level work.

---

## Extended Case Study: Building "Detachable" — A Production Library

Let us spend the next several thousand lines walking through the design and implementation of a real internal library called `detachable`, suitable for production use.

### Goals

- A single import for all detached work in the codebase.
- Configurable per-operation: timeout, retries, backoff, recovery.
- Built-in observability: metrics, logging, tracing.
- Bounded resource use: capped worker pool, capped queue.
- Graceful drain with budget.
- Per-tenant quotas.
- Optional DLQ for terminal failures.
- Test harnesses for verifying behaviour.

### Public API in full

```go
package detachable

import (
    "context"
    "time"
)

// Platform is the entry point. One Platform per process.
type Platform struct {
    // ... unexported ...
}

type Config struct {
    Workers      int            // worker goroutines
    QueueSize    int            // bounded queue
    DefaultOpts  Options        // applied if not overridden
    TenantQuotas map[string]int // per-tenant in-flight cap
    Tracer       Tracer         // optional
    Logger       Logger         // optional
    Metrics      Metrics        // optional
    OnDLQ        func(Op)       // called on terminal failure
}

type Options struct {
    Timeout  time.Duration
    Attempts int
    Backoff  BackoffFunc
    OnRetry  func(err error, attempt int)
}

type BackoffFunc func(attempt int) time.Duration

func ExponentialBackoff(base, max time.Duration) BackoffFunc {
    return func(attempt int) time.Duration {
        d := base << attempt
        if d > max {
            d = max
        }
        return d
    }
}

func New(processCtx context.Context, cfg Config) *Platform

func (p *Platform) Submit(parent context.Context, name string, fn func(context.Context) error) error
func (p *Platform) SubmitWithOpts(parent context.Context, name string, opts Options, fn func(context.Context) error) error
func (p *Platform) Drain(ctx context.Context) error
func (p *Platform) Status() Snapshot
```

### The internal Op type

```go
type Op struct {
    ID       OpID
    Name     string
    Tenant   string
    Parent   context.Context
    Opts     Options
    Status   Status
    Start    time.Time
    End      time.Time
    Attempts int
    Err      error
}
```

### The submit logic

```go
func (p *Platform) Submit(parent context.Context, name string, fn func(context.Context) error) error {
    return p.SubmitWithOpts(parent, name, p.cfg.DefaultOpts, fn)
}

func (p *Platform) SubmitWithOpts(parent context.Context, name string, opts Options, fn func(context.Context) error) error {
    if p.isDraining() {
        return ErrDraining
    }
    tenant := tenantFromCtx(parent)
    if !p.acquireTenantSlot(tenant) {
        return ErrTenantFull
    }
    op := &Op{
        ID: newOpID(),
        Name: name,
        Tenant: tenant,
        Parent: parent,
        Opts: opts,
        Status: StatusPending,
    }
    work := func() {
        defer p.releaseTenantSlot(tenant)
        p.execute(op, fn)
    }
    select {
    case p.work <- work:
        return nil
    default:
        p.releaseTenantSlot(tenant)
        return ErrQueueFull
    }
}
```

Two early returns: draining and tenant-full. Two failure modes: queue-full (acceptable, return error) and no error (success).

### The execute logic

```go
func (p *Platform) execute(op *Op, fn func(context.Context) error) {
    op.Status = StatusRunning
    op.Start = time.Now()
    p.recordStart(op)
    defer func() {
        op.End = time.Now()
        p.recordEnd(op)
    }()
    defer p.recover(op)

    detached := context.WithoutCancel(op.Parent)
    spanCtx, span := p.tracer.Start(detached, "detached."+op.Name)
    defer span.End()

    for attempt := 0; attempt < op.Opts.Attempts; attempt++ {
        op.Attempts = attempt + 1
        ctx, cancel := context.WithTimeout(spanCtx, op.Opts.Timeout)
        err := fn(ctx)
        cancel()
        if err == nil {
            op.Status = StatusDone
            return
        }
        if attempt == op.Opts.Attempts-1 {
            op.Status = StatusFailed
            op.Err = err
            if p.cfg.OnDLQ != nil {
                p.cfg.OnDLQ(*op)
            }
            return
        }
        if op.Opts.OnRetry != nil {
            op.Opts.OnRetry(err, attempt)
        }
        select {
        case <-time.After(op.Opts.Backoff(attempt)):
        case <-p.process.Done():
            op.Status = StatusFailed
            op.Err = errors.New("aborted: process shutting down")
            return
        }
    }
}
```

The retry loop:

- Wraps in a timeout per attempt.
- Calls the on-retry hook between attempts.
- Sleeps with backoff.
- Aborts cleanly on process shutdown.

### The recover logic

```go
func (p *Platform) recover(op *Op) {
    if r := recover(); r != nil {
        op.Status = StatusPanicked
        op.Err = fmt.Errorf("panic: %v", r)
        p.logger.Errorw("detached panic",
            "op", op.ID, "name", op.Name, "err", op.Err,
            "stack", string(debug.Stack()))
        p.metrics.IncPanic(op.Name)
    }
}
```

Logs with stack trace. Increments the panic counter. The operation is marked Panicked.

### The drain logic

```go
func (p *Platform) Drain(ctx context.Context) error {
    close(p.draining)
    close(p.work)
    done := make(chan struct{})
    go func() {
        p.wg.Wait()
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

`draining` is closed first to prevent new submissions. `work` is closed to signal workers to exit after draining the queue. Wait until both are done or the budget elapses.

### The tenant quota logic

```go
type tenantCounter struct {
    cap   int32
    count atomic.Int32
}

func (p *Platform) acquireTenantSlot(tenant string) bool {
    cap, ok := p.cfg.TenantQuotas[tenant]
    if !ok {
        return true // no quota for this tenant
    }
    c := p.tenantCounters[tenant]
    if c == nil {
        return true
    }
    for {
        cur := c.count.Load()
        if cur >= int32(cap) {
            return false
        }
        if c.count.CompareAndSwap(cur, cur+1) {
            return true
        }
    }
}

func (p *Platform) releaseTenantSlot(tenant string) {
    if c, ok := p.tenantCounters[tenant]; ok {
        c.count.Add(-1)
    }
}
```

Atomic CAS for thread-safe quota tracking.

### Status snapshot

```go
type Snapshot struct {
    InFlight []OpInfo
    Queue    int
    Workers  int
}

type OpInfo struct {
    ID       string
    Name     string
    Tenant   string
    Start    time.Time
    Attempt  int
    Status   string
}

func (p *Platform) Status() Snapshot {
    var in []OpInfo
    p.ops.Range(func(k, v any) bool {
        op := v.(*Op)
        in = append(in, OpInfo{
            ID:      string(op.ID),
            Name:    op.Name,
            Tenant:  op.Tenant,
            Start:   op.Start,
            Attempt: op.Attempts,
            Status:  op.Status.String(),
        })
        return true
    })
    return Snapshot{
        InFlight: in,
        Queue:    len(p.work),
        Workers:  p.cfg.Workers,
    }
}
```

Iterates over the operations map. Includes the queue depth.

### Tests for the platform

The platform's tests should cover:

```go
func TestSubmitAndComplete(t *testing.T) { /* ... */ }
func TestQueueFull(t *testing.T) { /* ... */ }
func TestTenantQuotaEnforced(t *testing.T) { /* ... */ }
func TestRetryOnTransientFailure(t *testing.T) { /* ... */ }
func TestDLQOnRetryExhaustion(t *testing.T) { /* ... */ }
func TestPanicRecovered(t *testing.T) { /* ... */ }
func TestDrainWaitsForInFlight(t *testing.T) { /* ... */ }
func TestDrainRespectsBudget(t *testing.T) { /* ... */ }
func TestSubmissionsAfterDrainStartRejected(t *testing.T) { /* ... */ }
func TestStatusReflectsInFlight(t *testing.T) { /* ... */ }
func TestTraceSpanLinkedToParent(t *testing.T) { /* ... */ }
func TestMetricsEmittedCorrectly(t *testing.T) { /* ... */ }
```

Twelve tests. Each is small (under 30 lines). Together they cover the contract.

### Sample test: drain with in-flight work

```go
func TestDrainWaitsForInFlight(t *testing.T) {
    procCtx, procCancel := context.WithCancel(context.Background())
    defer procCancel()
    p := New(procCtx, Config{Workers: 4, QueueSize: 10, DefaultOpts: Options{
        Timeout: time.Second, Attempts: 1, Backoff: ExponentialBackoff(time.Millisecond, time.Second),
    }})
    var completed atomic.Int32
    for i := 0; i < 10; i++ {
        _ = p.Submit(context.Background(), "test", func(ctx context.Context) error {
            time.Sleep(50 * time.Millisecond)
            completed.Add(1)
            return nil
        })
    }
    drainCtx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := p.Drain(drainCtx); err != nil {
        t.Fatal("drain failed:", err)
    }
    if completed.Load() != 10 {
        t.Fatalf("expected 10 completed, got %d", completed.Load())
    }
}
```

### Sample test: drain timeout

```go
func TestDrainRespectsBudget(t *testing.T) {
    procCtx, procCancel := context.WithCancel(context.Background())
    defer procCancel()
    p := New(procCtx, Config{Workers: 1, QueueSize: 10, DefaultOpts: Options{
        Timeout: time.Hour, Attempts: 1, Backoff: ExponentialBackoff(time.Millisecond, time.Second),
    }})
    _ = p.Submit(context.Background(), "test", func(ctx context.Context) error {
        time.Sleep(time.Hour)
        return nil
    })
    drainCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    err := p.Drain(drainCtx)
    if err == nil {
        t.Fatal("expected drain to time out")
    }
}
```

### Documentation

The platform package needs a README:

- Quickstart: 10 lines showing the most common use.
- Configuration reference: every Config field explained.
- Operation lifecycle diagram.
- Common patterns: audit logging, webhook delivery, metric emission.
- Anti-patterns and their fixes.
- Migration guide: from `go func` to platform.
- Observability guide: how to read the metrics, what alerts to set.
- Runbook: what to do when X happens.

Documentation should be at least as long as the code.

### Onboarding material

A new engineer joining the team should be able to:

- Read the README and understand the API in 30 minutes.
- Write their first detached operation in an hour.
- Understand the metrics dashboard in another hour.
- Pass a code review with no major changes.

If onboarding takes more than half a day, the documentation needs work.

---

## Extended Case Study: Migrating an Audit Subsystem

A team has the following audit code, written in 2019:

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    res := s.do(r.Context(), r)
    w.WriteHeader(200)
    json.NewEncoder(w).Encode(res)
    go func() {
        // pre-1.21 hand-rolled detach
        ctx := withoutCancel(r.Context())
        _ = s.audit.Write(ctx, AuditEntry{
            TraceID: traceIDFromCtx(ctx),
            UserID:  userIDFromCtx(ctx),
            Path:    r.URL.Path,
        })
    }()
}

type noCancelCtx struct{ ctx context.Context }
func (n noCancelCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (n noCancelCtx) Done() <-chan struct{}       { return nil }
func (n noCancelCtx) Err() error                  { return nil }
func (n noCancelCtx) Value(k any) any             { return n.ctx.Value(k) }

func withoutCancel(parent context.Context) context.Context { return noCancelCtx{ctx: parent} }
```

The team upgrades to Go 1.21 and decides to migrate.

### Step 1: Replace the hand-rolled detach

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    res := s.do(r.Context(), r)
    w.WriteHeader(200)
    json.NewEncoder(w).Encode(res)
    go func() {
        ctx := context.WithoutCancel(r.Context())
        _ = s.audit.Write(ctx, AuditEntry{
            TraceID: traceIDFromCtx(ctx),
            UserID:  userIDFromCtx(ctx),
            Path:    r.URL.Path,
        })
    }()
}
```

Delete the `noCancelCtx` and `withoutCancel`. The standard library replaces them.

### Step 2: Add a timeout

```go
go func() {
    ctx := context.WithoutCancel(r.Context())
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    _ = s.audit.Write(ctx, AuditEntry{...})
}()
```

Bounded operation.

### Step 3: Add panic recovery

```go
go func() {
    defer func() {
        if rec := recover(); rec != nil {
            log.Printf("audit panic: %v", rec)
        }
    }()
    ctx := context.WithoutCancel(r.Context())
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    _ = s.audit.Write(ctx, AuditEntry{...})
}()
```

### Step 4: Track for shutdown

```go
s.detachedWG.Add(1)
go func() {
    defer s.detachedWG.Done()
    defer func() { /* recover */ }()
    ctx := context.WithoutCancel(r.Context())
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    _ = s.audit.Write(ctx, AuditEntry{...})
}()
```

### Step 5: Migrate to platform

```go
s.detached.Submit(r.Context(), "audit", func(ctx context.Context) error {
    return s.audit.Write(ctx, AuditEntry{...})
})
```

One line. The platform handles detach, timeout, recovery, WaitGroup, metrics, logging, tracing.

### Step 6: Consider durable queue

Once the platform is in place, the team realises audit is critical. Lost audit rows are a compliance issue. They migrate to Kafka.

```go
s.audit.Enqueue(r.Context(), AuditEntry{...})
```

The handler enqueues; a separate consumer process writes to the database. Zero loss on process crash.

### Migration timeline

- Step 1: 1 day (find-and-replace).
- Step 2-4: 1 week (incremental hardening).
- Step 5: 2 weeks (build platform + migrate).
- Step 6: 6 weeks (set up Kafka + consumer + cutover).

Total: about two months. Worth it for the reliability gains.

---

## Extended Case Study: A Distributed System with Partial Cancellation Throughout

Consider a multi-service system: a user-facing API, an order service, a payment service, and a notification service. Each communicates over gRPC.

### Request flow

1. User calls API.
2. API calls order service.
3. Order service calls payment service.
4. Order service writes to database.
5. Order service returns success.
6. API returns success.
7. User sees response.

After step 6, the order service must:

- Emit an order.created event.
- Notify the notification service to send a confirmation email.
- Update the search index.

### Where partial cancellation applies

Step 7's tail (the post-response work) is detached from the user request. Each side-effect is its own detached operation.

```go
func (s *OrderService) PlaceOrder(ctx context.Context, req *Req) (*Resp, error) {
    if err := s.charge(ctx, req); err != nil {
        return nil, err
    }
    order, err := s.save(ctx, req)
    if err != nil {
        return nil, err
    }

    // Detached side-effects.
    s.detached.Submit(ctx, "order_event", func(c context.Context) error {
        return s.events.Emit(c, OrderCreated{ID: order.ID})
    })
    s.detached.Submit(ctx, "notify_user", func(c context.Context) error {
        return s.notifications.Send(c, order.UserID, NotifyOrderPlaced)
    })
    s.detached.Submit(ctx, "index_order", func(c context.Context) error {
        return s.search.Index(c, order)
    })

    return &Resp{ID: order.ID}, nil
}
```

Three detached operations. Each is independent. The user's response goes out before any of them complete.

### Cross-service durability

Each "Submit" enqueues to a Kafka topic. A consumer per service handles the topic. The order service does not own the lifetime of the email send — the notification service does.

The order service's detached pool *enqueues* to Kafka. The notification service has its own platform that consumes from Kafka and sends the email.

This is the natural progression: in-process detached for low-stakes side-effects; cross-process queues for high-stakes side-effects.

### When to escalate

A common heuristic: if loss of the side-effect would cause customer complaints, escalate to a queue. If loss is acceptable (a missed metric, a slightly stale cache), in-process detached is fine.

### Observability across services

The same trace ID propagates through Kafka headers. A trace shows:

- The API call.
- The order service call.
- The payment service call (synchronous).
- The order.created event (asynchronous).
- The notification service call (asynchronous).

All on one trace. Cross-service partial cancellation made observable.

---

## Extended Topic: A Day in the Life of a Detached Pool

Picture a day in the life of a healthy production detached pool. The pool is sized for 100 workers, queue depth 400. Steady-state submission rate: 200/second.

### 09:00 — Morning rush

Traffic begins. Submission rate climbs from 50/sec to 300/sec over 15 minutes. The pool sustains 300/sec with average operation duration 100ms — that is 30 in-flight at any moment. Queue depth stays under 50.

Metrics:
- Submissions: 300/sec.
- In-flight: 30.
- Queue depth: 30-50.
- Failure rate: 0.1%.
- p99 latency: 200ms.

All green.

### 11:30 — Database hiccup

A read replica goes down. Audit writes (which use this replica) start retrying. Per-operation latency rises from 100ms to 500ms (because of retries).

Metrics:
- Submissions: 300/sec.
- In-flight: 150 (limited by 100 workers, queue fills).
- Queue depth: 200+.
- Failure rate: still 0.1% (retries are eventually succeeding).

Alert fires at queue depth > 80%. SRE investigates, finds the read replica issue, fails over to another replica.

### 11:35 — Recovery

Queue drains within 5 minutes. Metrics return to baseline.

### 14:00 — Marketing push

A push notification campaign drives a 5x traffic spike. Submission rate hits 1500/sec briefly. The queue fills. Submissions start failing with ErrQueueFull.

Handler logic:

```go
if err := s.detached.Submit(ctx, "metric", fn); err != nil {
    log.Printf("metric submission failed: %v", err)
    // Acceptable for metrics.
}
```

Metrics overflow is acceptable. The handler logs and moves on. No alert.

### 18:00 — Deploy

A new version is deployed. Kubernetes sends SIGTERM to the old pods. The platform's drain starts. Queue had ~50 items; in-flight had ~30. Within 10 seconds, all drain. Pods exit cleanly.

The new pods boot. The pool starts empty. Steady-state resumes.

### 02:00 — Quiet night

Submission rate drops to 10/sec. The pool has 1-2 in-flight at any moment. 99 workers are idle. This is fine — idle workers cost almost nothing.

### Daily summary

- Submissions: ~10 million.
- Failures: 10,000 (0.1%).
- Panics: 5.
- Pool overflow events: 1 (during marketing push).
- Drain failures: 0.

A healthy day.

---

## Extended Topic: When the Pool Is Sick

What does a sick pool look like? Signs and remedies.

### Sign: Queue depth always > 80%

The pool is undersized. Solution: increase worker count or queue size. Restart required.

### Sign: Failure rate climbing

Downstream is degrading. Solution: investigate the downstream, not the pool.

### Sign: p99 latency spiking

Either the downstream is slow or the workers are saturated. Solution: check downstream first, then check worker utilisation.

### Sign: Repeated panics

A bug in the operation code. Solution: roll back the deploy, fix the bug.

### Sign: Drain timeout

Operations are taking longer than the drain budget. Solution: lower per-op timeouts, or migrate long operations to a durable queue.

### Sign: Memory growth

Detached operations holding too many resources. Solution: extract minimal values at detach point, or reduce concurrency.

### Sign: CPU spike

Too many goroutines. Solution: increase pool size or reduce per-handler submissions.

Each sign has a primary remedy. The SRE plays whack-a-mole — fix the cause, watch for the next sign.

---

## Extended Topic: Lessons Learned the Hard Way

A list of lessons from real production incidents involving partial cancellation:

1. **Always have a per-operation timeout.** A single hung operation can hold up drain.
2. **Always have a drain budget.** Otherwise SIGKILL wins.
3. **Always recover panics.** A panic in a detached goroutine takes down the whole pod.
4. **Always preserve trace IDs.** Without them, you cannot debug failures.
5. **Always have a metric.** "No metric, no service" — you cannot manage what you cannot measure.
6. **Always know your steady-state submission rate.** Capacity planning depends on it.
7. **Always reject submissions during drain.** Otherwise the drain never completes.
8. **Always document the pool's behaviour.** New engineers will mis-use it otherwise.
9. **Always test drain under load.** The fast path looks fine; the slow path is where bugs hide.
10. **Always escalate critical work.** Detached pools are good for non-critical work; queues are for critical.

These ten lessons cost real teams real money to learn. Read them and avoid the costs.

---

## Extended Topic: When Partial Cancellation Is Overkill

Sometimes a team builds a sophisticated detached platform when a simpler solution would work.

- A small service with one or two side-effects: maybe `go func` with a `defer recover` is enough.
- A service where every side-effect must be durable: maybe a queue from the start is right.
- A service where everything is synchronous and that is fine: maybe no detached layer at all.

The platform layer is the right answer for a *medium-complexity* service. Smaller services may not need it; larger services may need more than one layer (platform + queue + workflow engine).

Recognise where you are. Do not over-engineer.

---

## Final Senior-Level Words

You have read several thousand lines on senior-level partial cancellation. The synthesis is: lifetime is an architectural concept; partial cancellation is one tool to express it; the platform layer is the abstraction that makes it routine; durable queues are the escalation path for critical work; observability ties it all together.

If you internalise this, you can:

- Design a partial-cancellation strategy for a service.
- Build the platform layer.
- Run incident response when the pool misbehaves.
- Migrate to durable queues when appropriate.
- Mentor others through the same journey.

That is the breadth and depth of senior-level partial cancellation. The professional file dives into the standard library internals that make all of this possible.

---

## Extended Walkthrough: A Three-Hour Coding Session

Below is a transcript of a three-hour coding session where a senior engineer designs a detached audit subsystem from scratch. The transcript shows the decisions and trade-offs in real time.

### Hour 1: Requirements and design sketch

**Problem.** The team's audit subsystem currently uses `go func` directly. Audit rows are sometimes lost. Drain at shutdown is slow.

**Goals.**
- Zero loss of audit rows under normal operation.
- Drain within 30 seconds at shutdown.
- Observable in dashboards.
- Easy to migrate.

**Non-goals.**
- Zero loss under process crash (will use durable queue later).
- Sub-millisecond per-audit latency.

**Sketch.** A platform-managed detached pool. Per-audit metrics. A drain hook.

### Hour 2: Implementation

```go
package audit

import (
    "context"
    "log"
    "time"

    "internal/detached"
)

type Audit struct {
    pool *detached.Platform
    db   AuditDB
}

func New(processCtx context.Context, db AuditDB) *Audit {
    return &Audit{
        pool: detached.New(processCtx, detached.Config{
            Workers:   50,
            QueueSize: 200,
            DefaultOpts: detached.Options{
                Timeout: 5 * time.Second,
                Attempts: 3,
                Backoff: detached.ExponentialBackoff(100*time.Millisecond, time.Second),
            },
        }),
        db: db,
    }
}

func (a *Audit) Record(parent context.Context, ev Event) {
    if err := a.pool.Submit(parent, "audit", func(ctx context.Context) error {
        return a.db.Insert(ctx, ev)
    }); err != nil {
        log.Printf("audit submit failed: %v", err)
    }
}

func (a *Audit) Drain(ctx context.Context) error {
    return a.pool.Drain(ctx)
}
```

40 lines. The hard work was done by the platform package; this is the audit-specific glue.

### Hour 3: Tests

```go
func TestAuditRecordSucceeds(t *testing.T) {
    db := newMockDB()
    a := New(context.Background(), db)
    a.Record(context.Background(), Event{ID: "e1"})
    drainCtx, _ := context.WithTimeout(context.Background(), time.Second)
    _ = a.Drain(drainCtx)
    if db.Count() != 1 {
        t.Fatalf("expected 1 audit, got %d", db.Count())
    }
}

func TestAuditRecordRetries(t *testing.T) {
    db := newMockDBFailFirst(2)
    a := New(context.Background(), db)
    a.Record(context.Background(), Event{ID: "e1"})
    drainCtx, _ := context.WithTimeout(context.Background(), 5*time.Second)
    _ = a.Drain(drainCtx)
    if db.Count() != 1 {
        t.Fatalf("expected 1 audit after retries, got %d", db.Count())
    }
}

func TestAuditDrainWaits(t *testing.T) {
    db := newMockSlowDB(100 * time.Millisecond)
    a := New(context.Background(), db)
    for i := 0; i < 50; i++ {
        a.Record(context.Background(), Event{ID: "e" + strconv.Itoa(i)})
    }
    start := time.Now()
    drainCtx, _ := context.WithTimeout(context.Background(), 5*time.Second)
    _ = a.Drain(drainCtx)
    if time.Since(start) < 100*time.Millisecond {
        t.Fatal("drain returned too fast")
    }
    if db.Count() != 50 {
        t.Fatalf("expected 50 audits, got %d", db.Count())
    }
}
```

Three tests cover the happy path, retries, and drain semantics.

### End of session

The audit subsystem is migrated to the platform pool. Old `go func` audit code is deleted. Production deploys catch the new behaviour. Audit-row loss drops to near zero.

Total effort: three hours of focused work plus the ongoing investment in the platform layer. The audit team's productivity is unchanged; the reliability is much improved.

---

## Extended Topic: Naming Things Well

A surprisingly underrated senior-level skill: naming the operations submitted to the detached pool.

### Bad name

```go
pool.Submit(ctx, "task", fn)
```

"task" is meaningless. The metric labelled "task" is useless. The log line "task panicked" tells you nothing.

### Good name

```go
pool.Submit(ctx, "order.audit", fn)
pool.Submit(ctx, "order.notify", fn)
pool.Submit(ctx, "order.index", fn)
pool.Submit(ctx, "user.welcome_email", fn)
```

Each name follows `<entity>.<action>`. The metric labelled "order.audit" is precise. The log line "order.audit panicked" tells you exactly what failed.

### Conventions

- Use `lower_case_with_dots` (or `lower_case_with_underscores`).
- The first segment is the entity or feature (order, user, payment).
- The second segment is the action (audit, notify, index).
- Keep it short — under 30 characters.
- Be specific — `audit` is better than `log`.

### Why naming matters

- Dashboards display the names. Confusing names produce confusing dashboards.
- Alerts use the names. Vague names produce vague alerts.
- Search uses the names. Generic names are hard to find.
- Documentation references the names. Inconsistent names produce inconsistent docs.

Spend an extra minute naming each detached operation. The cumulative payoff over years is enormous.

---

## Extended Topic: Coordinating With the Database Pool

A detached operation typically does database work. The detached pool size and the database connection pool size interact.

### Scenario: detached pool larger than database pool

If the detached pool has 100 workers and the database pool has 20 connections, only 20 workers can be making database calls at a time. The other 80 are blocked waiting for connections.

Effective concurrency: 20.

The detached pool is "over-sized" in this case. Scaling it to 100 buys nothing.

### Scenario: detached pool smaller than database pool

100 connections available, but only 20 workers. Connections are idle.

Effective concurrency: 20.

The database pool is over-sized. Scaling it down might save resources.

### Right-sizing

Match the detached pool size to the *expected* number of concurrent detached operations. Match the database pool to the *sum* of all concurrent users of the database (request handlers, detached operations, background goroutines).

A common rule of thumb:

- Database pool: 2x the number of CPU cores.
- Detached pool: comparable, depending on operation duration.

For a 4-core machine: 8 DB connections, 50 detached workers (because they do mostly I/O, not CPU).

### Watching for trouble

If you see detached operations queuing on the database pool (a metric in your DB client), the DB pool is the bottleneck.

If you see the detached pool queue depth high but DB connections idle, the detached pool is the bottleneck.

Each scenario has a different fix.

---

## Extended Topic: Coordinating With External Service Rate Limits

A detached operation that calls an external service is bounded by that service's rate limit.

### Scenario: webhook delivery

A detached pool spawns 100 webhook deliveries per second. The target service accepts 50/second. The remainder gets rate-limited.

The pool's retry logic kicks in. Operations retry; latency rises; queue fills.

Fix: rate-limit the *submissions* to match the target. A token bucket in front of the pool's `Submit`:

```go
func (s *WebhookService) Send(ctx context.Context, w Webhook) {
    if !s.rateLimiter.Allow() {
        s.queue.Enqueue(w) // overflow to a durable queue
        return
    }
    s.pool.Submit(ctx, "webhook", func(c context.Context) error {
        return s.deliver(c, w)
    })
}
```

The rate limiter enforces the target's bound. Overflow goes to a durable queue that drains at a sustainable pace.

### Scenario: third-party API with quotas

An API charges per request. Detached operations should not exceed the daily budget.

Add a budget tracker:

```go
if !s.budget.Try() {
    return ErrBudgetExceeded
}
s.pool.Submit(ctx, "api_call", fn)
```

The budget tracker is replenished daily.

### General principle

The detached pool's *capacity* is one bound. The external rate limit is another. Whichever is lower dominates. Design around the lower one.

---

## Extended Topic: Securing Detached Operations

A detached operation may run with credentials that need security review.

### The token issue

A handler receives a user-bearer token. The handler authenticates the user, then spawns a detached operation that calls another service on the user's behalf.

If the detached operation runs after the token expires, the downstream rejects it.

Fixes:

- Use a service-account token for the detached call (works only if the downstream accepts service-account auth).
- Refresh the user token before the detached call (works only if you have a refresh token).
- Persist the operation as a durable job and run it synchronously (a queue with a worker that has its own credentials).

### The privilege escalation issue

A detached operation that does cleanup may need higher privileges than the original user. For example, an audit row is written by an audit service account, not by the user.

Use a separate identity for detached operations:

```go
detachedCtx := context.WithValue(context.WithoutCancel(ctx), credKey{}, serviceAccountCreds)
```

The detached operation uses the service account, not the user.

### The data leakage issue

A detached audit row may contain sensitive user data. If the audit log is accessible by a wider audience than the original request was, you have a leak.

Audit logs should be access-controlled and field-redacted appropriately.

### Review checklist

For every detached operation, review:

- What credentials does it use?
- Are those credentials appropriate for the operation?
- Does the operation handle sensitive data?
- Is the data appropriately redacted in logs/metrics?
- Could a misuse of this operation lead to privilege escalation?

Security review is part of detached-work design at senior level.

---

## Extended Topic: Reducing Goroutine Counts

Detached pools can sometimes be replaced with non-goroutine designs.

### Pattern: batched flushing

Instead of one detached goroutine per metric, buffer metrics and flush periodically:

```go
type MetricBuffer struct {
    in chan Metric
}

func (m *MetricBuffer) Emit(ev Metric) {
    select {
    case m.in <- ev:
    default: // drop on overflow
    }
}

func (m *MetricBuffer) run(processCtx context.Context) {
    var buf []Metric
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case ev := <-m.in:
            buf = append(buf, ev)
            if len(buf) >= 100 {
                pushMetrics(processCtx, buf)
                buf = nil
            }
        case <-ticker.C:
            if len(buf) > 0 {
                pushMetrics(processCtx, buf)
                buf = nil
            }
        case <-processCtx.Done():
            return
        }
    }
}
```

One goroutine, many metrics. No partial cancellation per metric.

### Pattern: batched writes

For audit rows, batch writes to the database:

```go
type AuditBatch struct {
    in chan Event
}

func (a *AuditBatch) Add(ev Event) {
    a.in <- ev
}

func (a *AuditBatch) run(processCtx context.Context) {
    var batch []Event
    flushTicker := time.NewTicker(100 * time.Millisecond)
    defer flushTicker.Stop()
    for {
        select {
        case ev := <-a.in:
            batch = append(batch, ev)
            if len(batch) >= 50 {
                a.flush(processCtx, batch)
                batch = nil
            }
        case <-flushTicker.C:
            if len(batch) > 0 {
                a.flush(processCtx, batch)
                batch = nil
            }
        case <-processCtx.Done():
            if len(batch) > 0 {
                a.flush(processCtx, batch)
            }
            return
        }
    }
}
```

One goroutine, many audits. Fewer database round trips.

### When to batch

- High-rate operations (>100/sec).
- Operations where latency-to-visibility is not critical (a 100ms delay is acceptable).
- Operations that benefit from bulk operations (database INSERT ... VALUES).

### When not to batch

- Low-rate operations.
- Operations where visibility latency matters (an alert that must fire immediately).
- Operations that cannot be aggregated (a webhook that delivers a specific event).

---

## Extended Topic: Tiered Detached Work

A service with mixed criticality detached work may benefit from tiers.

### Tier 1: Critical, durable

Operations that must complete: audit (compliance), payment confirmation, regulatory events. → Kafka.

### Tier 2: Important, transient

Operations that should complete, with loss tolerance: notifications, webhooks. → Detached pool with DLQ.

### Tier 3: Best-effort

Operations that may be lost without consequence: metric emission, cache warm-up. → Detached pool, no DLQ.

The platform supports all three:

- Tier 1 uses an `Enqueue` API backed by Kafka.
- Tier 2 uses a `Submit` API on the pool with `OnDLQ` configured.
- Tier 3 uses a `Submit` API on the pool with no DLQ.

Each tier has its own observability dashboard and alerts.

---

## Extended Topic: A Sample Internal Documentation

A real internal documentation page for a detached platform might look like:

> # Detached Platform Guide
>
> ## When to use
>
> Use the detached platform when you have side-effect work that:
> - Must outlive the originating request.
> - Is bounded in duration (under a minute).
> - Is best-effort or tolerant of loss on process crash.
>
> Do *not* use the detached platform for:
> - Work that the user is waiting for.
> - Long-running multi-step workflows (use sagas).
> - Work that must complete eventually regardless of failures (use Kafka).
>
> ## Quickstart
>
> ```go
> import "internal/detached"
>
> func handler(w http.ResponseWriter, r *http.Request) {
>     // ... main work ...
>     detached.Submit(r.Context(), "feature.action", func(ctx context.Context) error {
>         return doSideEffect(ctx)
>     })
> }
> ```
>
> ## Configuration
>
> The platform is configured in `cmd/server/main.go`. To change:
>
> - Worker count: edit `Config.Workers`.
> - Queue size: edit `Config.QueueSize`.
> - Default timeout: edit `Config.DefaultOpts.Timeout`.
>
> ## Naming
>
> Use `<feature>.<action>` for the operation name. Examples:
> - `order.audit`
> - `user.welcome_email`
> - `payment.notify`
>
> ## Observability
>
> - Metrics: `detached_*` series in Prometheus.
> - Dashboard: `Detached Platform` in Grafana.
> - Alerts: see `alerts/detached.yaml`.
> - Logs: filter on `name=...`.
>
> ## Failure modes
>
> See the runbooks in `docs/runbooks/detached/`.
>
> ## Anti-patterns
>
> - Do not use `go func` directly. Use the platform.
> - Do not use `context.Background()` instead of `WithoutCancel`. The platform handles this.
> - Do not forget to handle the error returned by `Submit`.

This is the kind of doc that every engineer reads on their first day.

---

## Extended Topic: Hiring and Interview Questions

If you are hiring a senior engineer, the following questions probe partial cancellation knowledge:

### Q1. When would you reach for `context.WithoutCancel`?

Good answer: explains the value-preserving lifetime-detaching role; mentions audit, metrics, span export; mentions bounding the detached work.

### Q2. Walk me through your detached pool design.

Good answer: bounded workers, bounded queue, per-op timeout, panic recovery, drain with budget, observability.

### Q3. How do you decide between detached pool and durable queue?

Good answer: criticality of the work; tolerance for loss on crash; latency vs durability trade-offs.

### Q4. What goes wrong at shutdown?

Good answer: drain budget vs Kubernetes grace period; lost in-flight work; coordination with HTTP server shutdown.

### Q5. How do you ensure detached operations are observable?

Good answer: metrics, logs with trace IDs, traces, admin endpoint, alerts.

A candidate who can answer these clearly has done senior-level partial cancellation.

---

## Extended Topic: Reviewing Your Own Code

Once a quarter, walk through your service and ask:

1. How many detached goroutines does my service spawn?
2. Are they all going through the platform?
3. What is the failure rate of each operation?
4. What is the queue depth at peak?
5. What is the drain duration at deploy?
6. Are there operations that should escalate to a queue?
7. Are there operations that are over-engineered?
8. Are there missing metrics, logs, or alerts?
9. Has any new code introduced ad-hoc `go func`?
10. Is the platform layer still meeting its design goals?

If any answer is unsatisfactory, schedule work to address it.

---

## Final Wrap-up

Partial cancellation at senior level is a craft. The API is small. The discipline is large. The payoff — reliable, observable, maintainable detached work — is enormous.

A senior engineer's contribution to a team's partial-cancellation practice is one of the most valuable things they can do. It is not flashy; it does not produce demos. But it is the kind of work that pays dividends for years.

Master it. Teach it. Document it. Maintain it. And know when to escalate beyond it.

That is the senior-level partial cancellation arc. The professional file dives into the internals that make it all work.

---

## Appendix: A Real Senior-Level Architecture Doc

For reference, here is what a senior-level architecture doc for a service's detached subsystem might look like.

### Title: Detached Work in OrderService

### Status

Active. Reviewed quarterly.

### Goals

- Zero loss of audit rows under normal operation.
- Sub-30-second drain on deploy.
- Observable in dashboards and traces.
- Easy to extend for new side-effect types.

### Non-goals

- Loss-free on process crash (use Kafka for that).
- Multi-region replication (handled at the queue layer).
- Sub-microsecond submission latency.

### Architecture

The detached subsystem has three layers:

1. **The platform package** (`internal/detached`). Provides a bounded worker pool with retry, recovery, drain, and observability.
2. **Feature wrappers** (`internal/audit`, `internal/notify`, etc.). Domain-specific code that uses the platform.
3. **Durable backups** (Kafka topics for `order_audit_events`, `payment_confirmations`). For operations that cannot afford in-process loss.

### Capacity

- Workers: 100
- Queue: 400
- Steady-state submission rate: 200/sec
- Peak: 1000/sec (overflow to Kafka backup)

### Observability

- Metrics: `detached_*` series. Dashboards: "Detached Platform Overview", "Per-Operation Detail".
- Logs: structured logs with trace IDs.
- Traces: each detached op has a span.
- Alerts: queue depth, failure rate, drain time, panic rate.

### Operational procedures

- Drain budget: 30 seconds.
- Kubernetes `terminationGracePeriodSeconds`: 45 seconds.
- Deploy strategy: rolling, with 5-minute soak between batches.

### Failure modes

- See runbooks in `docs/runbooks/detached/`.

### Migration plan

- Audit is migrated to Kafka in Q2.
- Notification is staying on detached pool (acceptable loss).
- New operations evaluated case-by-case.

### Review schedule

- Quarterly: capacity review, failure rate review, migration review.
- Monthly: post-incident review of any pool-related incident.

### Owner

@order-service team. Tech lead: @senior-engineer.

---

This kind of doc lives in the team's wiki. It is read by everyone who touches the service. It is updated whenever the architecture changes.

---

## Appendix: Glossary of Senior-Level Concepts

| Term | Meaning |
|---|---|
| Platform layer | A package that centralises detached-work patterns |
| Detached pool | A bounded worker pool for detached operations |
| Drain budget | The deadline within which the pool must finish in-flight work at shutdown |
| Tenant quota | A per-tenant cap on in-flight operations |
| DLQ | Dead-letter queue: where permanently failed operations go |
| Saga | A multi-step business workflow with compensating actions |
| Outbox | A durable buffer for events tied to the same DB transaction as the primary write |
| Eventual consistency | A state where the system converges to consistency after a delay |
| Idempotency | An operation safe to retry without side effects |
| Capacity planning | Choosing the pool/queue sizes based on expected load |
| Backpressure | Slowing producers when consumers are saturated |
| Bulkhead | An isolation boundary that prevents one failure from cascading |

Use these terms precisely. Vague language is a source of bugs.

---

## Appendix: Common Mistakes by Tenure

Junior engineers make these mistakes:
- Using `context.Background()` instead of `WithoutCancel`.
- Forgetting to bound detached work with a timeout.
- Forgetting to recover panics in detached goroutines.

Mid-level engineers make these mistakes:
- Detaching inside middleware (defeats cancellation for the whole request).
- Coupling detached operations sequentially when they should be parallel.
- Building per-feature pools instead of using a shared platform.

Senior engineers make these mistakes (rare but expensive):
- Choosing a detached pool when a durable queue is required.
- Setting drain budget mismatched to Kubernetes grace period.
- Failing to escalate critical work as the service grows.

Staff engineers make these mistakes (very rare):
- Designing the platform too rigidly to accommodate future tiers.
- Not investing in observability and education for the platform.
- Letting the platform become unowned over time.

Each tier has its own characteristic mistakes. Knowing them helps you avoid them.

---

## Appendix: A Manifesto

I will:

- Treat lifetime as a first-class design concept.
- Name, for every goroutine, its lifetime owner.
- Always pair detach with a bound.
- Always recover panics in detached operations.
- Always track detached work for graceful shutdown.
- Always observe detached operations with metrics, logs, and traces.
- Escalate critical work to durable queues.
- Build platform layers that hide complexity from feature teams.
- Document the patterns so new engineers can adopt them.
- Maintain the platform as production load evolves.

Print this and post it above your desk.

---

## Appendix: The Last Word

Partial cancellation is the discipline of saying "this work has its own life." `WithoutCancel` is the one-line expression of that discipline. Everything else in this file is the architecture, the operations, the migrations, the observability, and the long-term care.

A senior engineer is the person who can move a team from "we have a bug" to "we have a system" with respect to detached work. The journey takes months. The result lasts for years.

The professional file is your next step. It dives into how the Go standard library actually implements partial cancellation — the sentinel value tricks, the `propagateCancel` walk, the `AfterFunc` machinery, the `Cause` propagation rules. Understanding the internals lets you debug subtle interactions and design new patterns with confidence.

Welcome to senior-level partial cancellation. The work continues at the professional level.

---

## Appendix: Quick Reference Card

```
// Detach
detached := context.WithoutCancel(parent)

// Detach + bound
ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), d)
defer cancel()

// Platform submit
detached.Submit(parent, "feature.action", func(ctx context.Context) error {
    return work(ctx)
})

// Graceful drain
drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
pool.Drain(drainCtx)

// Decide: detach vs queue
//   Best-effort, transient → detach
//   Critical, durable → queue
//   Multi-step → saga
//   Cross-service → queue + outbox
```

Print and keep at your desk. Reference daily until automatic.

---

## Appendix: Twelve Production-Grade Code Snippets

These are not contrived examples — they are the kind of code you write in a production service.

### Snippet 1: A handler that submits one detached operation

```go
func (s *Server) PlaceOrder(w http.ResponseWriter, r *http.Request) {
    order, err := s.svc.Place(r.Context(), parseReq(r))
    if err != nil {
        writeErr(w, err)
        return
    }
    writeOK(w, order)
    s.platform.Submit(r.Context(), "order.audit", func(ctx context.Context) error {
        return s.audit.Record(ctx, AuditEvent{OrderID: order.ID})
    })
}
```

### Snippet 2: Multiple detached operations from one handler

```go
func (s *Server) PlaceOrder(w http.ResponseWriter, r *http.Request) {
    order, err := s.svc.Place(r.Context(), parseReq(r))
    if err != nil {
        writeErr(w, err)
        return
    }
    writeOK(w, order)
    s.platform.Submit(r.Context(), "order.audit", func(ctx context.Context) error {
        return s.audit.Record(ctx, AuditEvent{OrderID: order.ID})
    })
    s.platform.Submit(r.Context(), "order.notify_user", func(ctx context.Context) error {
        return s.notify.User(ctx, order.UserID, NotifyOrderPlaced)
    })
    s.platform.Submit(r.Context(), "order.index", func(ctx context.Context) error {
        return s.search.Index(ctx, order)
    })
}
```

### Snippet 3: A service method that fans out detached work

```go
func (s *Service) Charge(ctx context.Context, req ChargeReq) (*Receipt, error) {
    receipt, err := s.process(ctx, req)
    if err != nil {
        return nil, err
    }
    s.platform.Submit(ctx, "charge.receipt_log", func(c context.Context) error {
        return s.db.InsertReceipt(c, receipt)
    })
    s.platform.Submit(ctx, "charge.webhook", func(c context.Context) error {
        return s.webhooks.Send(c, req.MerchantID, receipt)
    })
    return receipt, nil
}
```

### Snippet 4: Bridging a process context

```go
func (s *Server) loopBackground() {
    for {
        select {
        case <-s.processCtx.Done():
            return
        case <-time.After(time.Minute):
            s.platform.Submit(s.processCtx, "cache.warmup", func(c context.Context) error {
                return s.cache.WarmAll(c)
            })
        }
    }
}
```

### Snippet 5: Combining detached + errgroup

```go
func (s *Service) Aggregate(ctx context.Context) (Aggregate, error) {
    g, gctx := errgroup.WithContext(ctx)
    var a, b, c Result
    g.Go(func() error { var err error; a, err = s.fetchA(gctx); return err })
    g.Go(func() error { var err error; b, err = s.fetchB(gctx); return err })
    g.Go(func() error { var err error; c, err = s.fetchC(gctx); return err })

    // Best-effort logging, detached from the errgroup.
    s.platform.Submit(ctx, "aggregate.log", func(c context.Context) error {
        return s.log.Record(c, "aggregate called")
    })

    if err := g.Wait(); err != nil {
        return Aggregate{}, err
    }
    return Aggregate{a, b, c}, nil
}
```

### Snippet 6: Singleflight with detached work

```go
func (s *Service) Load(ctx context.Context, key string) (any, error) {
    v, err, _ := s.sf.Do(key, func() (any, error) {
        c := context.WithoutCancel(ctx)
        c, cancel := context.WithTimeout(c, 30*time.Second)
        defer cancel()
        return s.fetch(c, key)
    })
    return v, err
}
```

### Snippet 7: Detached with custom options

```go
s.platform.SubmitWithOpts(ctx, "webhook.deliver",
    detached.Options{
        Timeout: 30 * time.Second,
        Attempts: 5,
        Backoff: detached.ExponentialBackoff(time.Second, time.Minute),
    },
    func(c context.Context) error {
        return deliver(c, webhook)
    })
```

### Snippet 8: Per-tenant detached operation

```go
ctx = context.WithValue(ctx, tenantKey{}, "tenant-42")
s.platform.Submit(ctx, "tenant.audit", func(c context.Context) error {
    return s.audit.RecordForTenant(c, ev)
})
```

The platform reads `tenantKey` to apply tenant quota.

### Snippet 9: Detached compensation in a saga

```go
for _, step := range completedSteps {
    p := step
    s.platform.Submit(ctx, "saga.compensate", func(c context.Context) error {
        return p.Compensate(c)
    })
}
```

### Snippet 10: Detached cleanup on parent cancel

```go
stop := context.AfterFunc(ctx, func() {
    s.platform.Submit(ctx, "cleanup.on_cancel", func(c context.Context) error {
        return cleanup(c, resource)
    })
})
defer stop()
```

### Snippet 11: Detached with a stop-hint

```go
s.platform.SubmitWithOpts(ctx, "long_running", detached.Options{Timeout: time.Hour, Attempts: 1, Backoff: nil},
    func(c context.Context) error {
        for i := 0; i < 1000; i++ {
            select {
            case <-s.processCtx.Done():
                return errors.New("aborted by shutdown")
            default:
            }
            process(c, i)
        }
        return nil
    })
```

### Snippet 12: Detached + queue fallback

```go
if err := s.platform.Submit(ctx, "critical.event", func(c context.Context) error {
    return s.process(c, event)
}); err != nil {
    // Pool full or draining — fall back to durable queue.
    if qerr := s.kafka.Enqueue(ctx, event); qerr != nil {
        log.Printf("both paths failed: pool=%v queue=%v", err, qerr)
    }
}
```

Twelve snippets. Each is short. Together they cover the daily vocabulary of partial cancellation.

---

## Final Senior-Level Words

Read these snippets until they look obvious. Practise writing variations of them. Internalise the rhythms — the `Submit` + name + closure pattern, the bounded-options variant, the singleflight detach, the saga compensation. These rhythms are what senior-level partial cancellation looks like in daily code.

The professional file follows. It is the deepest dive: standard library internals, the algorithms behind cancellation propagation, the precise contract of `AfterFunc` and `Cause`, and the design trade-offs that the Go team weighed. Read it last; it makes the most sense once the senior-level architecture is comfortable.

---

## Truly Final Word

Six chapters from now, you will look back at junior-level material and find it elementary. Eighteen chapters from now, you will look at senior-level material and find *it* elementary. The discipline of partial cancellation, deeply learned, becomes invisible. That invisibility is the goal. When detached work is just how your team writes code, the architecture is right.

Welcome to the work. The professional level awaits.

---

## Appendix Z: Three Bonus Patterns

### Bonus 1: The "deferred detach" pattern

Sometimes you want to defer a detached operation until the *function returns* — like `defer` but for detached work:

```go
func handle(ctx context.Context) {
    auditEvents := newAuditAccumulator(ctx)
    defer auditEvents.Flush(ctx) // synchronous flush at end of function
    ...
}
```

If you want the flush to outlive the function (so the caller does not wait), wire it through the platform:

```go
defer func() {
    s.platform.Submit(ctx, "audit.flush", func(c context.Context) error {
        return auditEvents.Flush(c)
    })
}()
```

The `defer` runs at function exit; the platform handles the actual work.

### Bonus 2: The "fan-in to detached" pattern

A handler receives N items. It dispatches each as a detached operation. It collects the results... but the collecting is itself detached.

```go
func (s *Service) DispatchAndCollect(ctx context.Context, items []Item) {
    results := make(chan Result, len(items))
    for _, it := range items {
        it := it
        s.platform.Submit(ctx, "item.process", func(c context.Context) error {
            r, err := process(c, it)
            if err != nil {
                return err
            }
            results <- r
            return nil
        })
    }
    s.platform.Submit(ctx, "items.aggregate", func(c context.Context) error {
        var all []Result
        for r := range results {
            all = append(all, r)
        }
        return s.aggregate(c, all)
    })
}
```

The handler returns immediately. The dispatch happens in parallel. The aggregation runs after dispatch (it never finishes if dispatch never finishes — production code needs a count).

### Bonus 3: The "ratchet" pattern

A detached operation that gradually shifts work from a "do it now" path to a "queue it for later" path under load:

```go
func (s *Service) Audit(ctx context.Context, ev Event) {
    if s.platform.Status().Queue < s.softLimit {
        s.platform.Submit(ctx, "audit", func(c context.Context) error {
            return s.db.Insert(c, ev)
        })
        return
    }
    // Above soft limit: queue to durable storage.
    _ = s.kafka.Enqueue(ctx, ev)
}
```

Under normal load, the audit runs immediately via the platform. Under load, it spills to Kafka. A separate consumer drains Kafka into the audit table.

Two tiers, one entry point.

---

## A Closing Reflection

This senior file is long because the topic is large. The longer you spend on it, the more you find. Each subsection could be its own essay; each pattern could be its own library.

The unifying thread: lifetime is everything. Every operation has a lifetime. Every goroutine has a lifetime. Every context has a lifetime. The art is in naming, designing, observing, and evolving those lifetimes over years.

If you internalise that, the API calls write themselves. `WithoutCancel` is just one tool in the kit, not the destination.

Go forth and detach wisely.

---

## Appendix: A Senior-Level Slip List

Things even senior engineers slip on, and how to catch them:

1. Forgetting to call `recover` because "this code can't panic." It will, eventually.
2. Setting a Kubernetes grace period without coordinating with the drain budget.
3. Using `context.Background()` because it is shorter than `context.WithoutCancel(parent)`.
4. Migrating to a durable queue without retaining the in-process fast path for low-criticality operations.
5. Building the platform layer but not writing the docs.
6. Writing the docs but not training the team.
7. Training the team but not enforcing the patterns via linters.
8. Adding linters but not measuring whether they reduce mistakes.

Each of these is a small slip. Together they explain why partial cancellation at scale takes years of attention.

---

## Appendix: A Promise to Yourself

Promise to:

- Read the professional file even though it is dense.
- Build the platform layer for your team.
- Write the docs.
- Train the team.
- Maintain it.
- Escalate when appropriate.
- Document the escalations.
- Teach the next senior.

Each promise is small. The cumulative effect over years is to leave the team and the codebase better than you found them.

That is the senior-level contribution. Onward.

---

## Appendix: One Last Walkthrough

A team's service has 30 handlers. Each handler does some main work and submits a few detached operations. The platform layer was introduced three months ago and is in use across the codebase.

The senior engineer reviews the team's PR backlog one morning. They notice:

- One PR adds a `go func` in a handler without using the platform. Comment: "use the platform here for consistency and observability."
- Another PR uses the platform but with a 60-second timeout. Comment: "is 60s really right? our drain budget is 30s."
- A third PR adds a new operation called `task`. Comment: "rename to `<feature>.<action>` for dashboard clarity."
- A fourth PR uses `context.Background()`. Comment: "use the parent context (via the platform); we want trace IDs preserved."

Four small comments. Each maintains a standard. Each helps the codebase stay healthy.

This is what senior-level partial cancellation work looks like in daily practice. Not glamorous. Indispensable.

---

## Truly The End

The senior file ends here. The professional file is next. It is more compact but more dense — internals, semantics, edge cases.

If you have read this far and understand most of it, you are ready for the professional level. If not, build the 12-step middle exercise and re-read the relevant senior sections.

Onward.
