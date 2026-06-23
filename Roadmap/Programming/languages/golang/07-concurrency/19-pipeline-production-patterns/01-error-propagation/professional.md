---
layout: default
title: Professional
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/professional/
---

# Error Propagation in Pipelines — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Distributed Pipeline Architectures](#distributed-pipeline-architectures)
3. [Error Contracts Between Services](#error-contracts-between-services)
4. [Idempotency Budgets and Exactly-Once](#idempotency-budgets-and-exactly-once)
5. [Cost Models of Structured Concurrency](#cost-models-of-structured-concurrency)
6. [Cross-Process Saga Patterns](#cross-process-saga-patterns)
7. [Event Sourcing and Pipeline Errors](#event-sourcing-and-pipeline-errors)
8. [Backpressure Beyond Pipelines](#backpressure-beyond-pipelines)
9. [Pipeline Observability at Scale](#pipeline-observability-at-scale)
10. [Failure Domains and Blast Radius](#failure-domains-and-blast-radius)
11. [Designing for Operations](#designing-for-operations)
12. [Pipeline Capacity Planning](#pipeline-capacity-planning)
13. [SLO Design for Pipelines](#slo-design-for-pipelines)
14. [Multi-Region Pipelines](#multi-region-pipelines)
15. [Stateful Pipelines and Recovery](#stateful-pipelines-and-recovery)
16. [Distributed Tracing Deep Dive](#distributed-tracing-deep-dive)
17. [Error Routing at Scale](#error-routing-at-scale)
18. [Compatibility and Versioning](#compatibility-and-versioning)
19. [The Cost of Wrong Defaults](#the-cost-of-wrong-defaults)
20. [Pipeline Anti-Patterns at Staff Level](#pipeline-anti-patterns-at-staff-level)
21. [Case Studies](#case-studies)
22. [Patterns From Other Systems](#patterns-from-other-systems)
23. [Future Directions](#future-directions)
24. [Tooling Ecosystem](#tooling-ecosystem)
25. [Self-Assessment](#self-assessment)
26. [Summary](#summary)
27. [Further Reading](#further-reading)

---

## Introduction
> Focus: "I'm designing pipelines that span services, regions, and teams. Failure modes interact in non-obvious ways. The error API is a contract that other teams depend on. Operations matter as much as code."

At professional / staff level, error propagation transcends the language. It is a system-design discipline. The questions:

- How do errors cross service boundaries cleanly?
- How do we approximate exactly-once when the network is at-least-once?
- What does it cost to wrap every blocking operation in structured concurrency?
- How do we design pipelines that survive region outages, deploys, dependency failures?
- How do we observe pipelines that span hundreds of services?

These questions don't have one answer. They have trade-offs. This file teaches the trade-offs.

---

## Prerequisites

- All previous levels in this series.
- Production experience with distributed systems.
- Familiarity with at least one workflow engine (Temporal, Cadence, AWS Step Functions).
- Exposure to event sourcing, CQRS, sagas.
- Experience reading and writing service-to-service error contracts.

---

## Distributed Pipeline Architectures

A pipeline running in one Go process is a degenerate case of a distributed pipeline. At scale, stages become services. Errors must cross network boundaries.

### Architecture 1: Synchronous chain

```
Service A --(HTTP/gRPC)--> Service B --> Service C
```

Each service is a stage. Errors return through HTTP/gRPC status codes. Cancellation via request context (gRPC propagates deadlines).

Pros: simple, low latency, debuggable.
Cons: each service must be available; failure in C blocks A.

### Architecture 2: Asynchronous via queue

```
Service A --> Queue 1 --> Service B --> Queue 2 --> Service C
```

Each service consumes from its input queue and produces to its output. Errors handled per-service, DLQ for poison.

Pros: durability, decoupling, scaling per-stage.
Cons: complexity, latency, eventual consistency.

### Architecture 3: Event sourcing

```
Service A --> Event Log --> Service B (projection 1)
                       --> Service C (projection 2)
                       --> Service D (projection 3)
```

All state changes are events. Services project the log into their own views. Errors recover by replay.

Pros: replay, audit, multiple views from one source.
Cons: complexity, eventual consistency, log management.

### Architecture 4: Workflow engine

```
Service A --> Workflow (Temporal/Cadence) --> Activity B --> Activity C
```

A workflow engine orchestrates. Each step is an "activity" — a function on a worker. The engine handles retries, persistence, cancellation.

Pros: durable execution, retries handled, audit.
Cons: requires the engine; learning curve; vendor lock-in.

### Choosing

For most internal pipelines, architecture 1 is enough. Move to 2 when latency tolerance is high and durability matters. Architecture 3 is for analytics and replay scenarios. Architecture 4 for complex multi-step workflows.

Most teams pick wrong, choosing 2 or 4 prematurely. Start simple.

---

## Error Contracts Between Services

When service A calls service B, what do errors look like? This is a contract.

### gRPC error contract

gRPC uses `google.rpc.Status`:

```protobuf
message Status {
    int32 code = 1;       // canonical code (e.g., NOT_FOUND)
    string message = 2;   // human-readable
    repeated google.protobuf.Any details = 3; // structured details
}
```

Codes are standardised (RFC 7231 inspired): OK, INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED, PERMISSION_DENIED, ALREADY_EXISTS, RESOURCE_EXHAUSTED, FAILED_PRECONDITION, ABORTED, OUT_OF_RANGE, UNIMPLEMENTED, INTERNAL, UNAVAILABLE, DATA_LOSS, DEADLINE_EXCEEDED, CANCELLED.

Details can be any proto message. Common patterns:

```protobuf
message ValidationError {
    string field = 1;
    string description = 2;
}

message RetryInfo {
    google.protobuf.Duration retry_delay = 1;
}
```

Service A serialises Go errors to gRPC status. Service B receives and converts back.

```go
func toGRPC(err error) error {
    var vErr *ValidationError
    if errors.As(err, &vErr) {
        st := status.New(codes.InvalidArgument, err.Error())
        st, _ = st.WithDetails(&pb.ValidationError{Field: vErr.Field, Description: vErr.Description})
        return st.Err()
    }
    // ... other mappings ...
    return status.Error(codes.Internal, "internal error")
}
```

### HTTP error contract

REST APIs use status codes and bodies:

```json
{
    "code": "validation_failed",
    "message": "Field 'email' is required",
    "details": {
        "field": "email"
    }
}
```

Less standardised than gRPC. Each team picks conventions.

### Custom error contract

In your own protocol:

```go
type APIError struct {
    Code    string         `json:"code"`
    Message string         `json:"message"`
    Detail  map[string]any `json:"detail,omitempty"`
    Cause   *APIError      `json:"cause,omitempty"`
}
```

Recursive `Cause` mirrors Go's `Unwrap` chain. Marshallable, callable across teams.

### Don't leak internal errors

Internal error messages can reveal table names, file paths, internal hostnames — security and operational risks.

```go
func sanitize(err error) error {
    if errors.Is(err, ErrNotFound) {
        return ErrNotFound // public sentinel; safe
    }
    log.Error("internal error", "err", err) // log the real one
    return ErrInternal // generic; safe
}
```

Public errors go on the wire; internal errors stay in logs.

---

## Idempotency Budgets and Exactly-Once

True exactly-once is impossible in a distributed system (two-generals problem). But we can approximate.

### At-least-once + dedup = effectively once

The standard pattern:

1. Caller assigns idempotency key per logical operation.
2. Server checks: has this key been processed?
3. If yes, return cached result.
4. If no, process and record the key.

The check + record must be atomic (transaction or compare-and-swap).

```go
func (s *Service) Process(ctx context.Context, req Request) (Response, error) {
    var resp Response
    err := s.db.BeginTx(ctx, func(tx *sql.Tx) error {
        var exists bool
        err := tx.QueryRowContext(ctx,
            "SELECT EXISTS(SELECT 1 FROM idempotency WHERE key = $1)", req.Key).Scan(&exists)
        if err != nil { return err }
        if exists {
            return tx.QueryRowContext(ctx,
                "SELECT response FROM idempotency WHERE key = $1", req.Key).Scan(&resp)
        }
        // process
        resp, err = s.doWork(ctx, req)
        if err != nil { return err }
        _, err = tx.ExecContext(ctx,
            "INSERT INTO idempotency (key, response) VALUES ($1, $2)", req.Key, resp)
        return err
    })
    return resp, err
}
```

### Idempotency budget

Storing every key forever is expensive. Bound retention:

```go
DELETE FROM idempotency WHERE created_at < NOW() - INTERVAL '30 days'
```

After 30 days, the key is forgotten. Clients must not retry beyond the budget. Usually OK — retries typically happen within seconds.

### Costs

- Storage: one row per request, growing.
- Latency: each request checks the table.
- Index: on the key column; size matters.

For high-throughput services, the dedup table is a significant operational concern. Some services use a bloom filter for fast "definitely-not-seen" checks plus a slow table for "maybe-seen."

### When to skip

If your operation is *naturally* idempotent (e.g., "set this value"), you don't need a dedup table. Just check the current state.

### Saga steps and idempotency

Each saga step is invoked once on forward, possibly once on rollback. The step's implementation must be idempotent for both directions. This is non-trivial.

Forward idempotency: re-running the step is a no-op if the desired state already exists.

```go
// Idempotent: insert if not exists
INSERT INTO orders (id, ...) VALUES ($1, ...) ON CONFLICT (id) DO NOTHING
```

Compensation idempotency: re-running the compensator is a no-op if the rollback has already happened.

```go
// Idempotent: delete if exists; no error if already deleted
DELETE FROM orders WHERE id = $1
```

These are easy in DBs with unique constraints. Harder in external APIs without strong idempotency support.

---

## Cost Models of Structured Concurrency

Structured concurrency (errgroup + context propagation) adds cost. Where is it spent?

### CPU costs

- Goroutine creation: ~1.5 µs.
- Context propagation: nanoseconds per Value lookup.
- Channel send/recv: ~50 ns.
- Mutex Lock/Unlock: ~30 ns uncontended.
- Atomic operation: ~5 ns.

For a pipeline doing 10k items/sec, that's 10 µs/item budget. The concurrency overhead is comfortably within. For 1M items/sec, you need to be more careful.

### Memory costs

- Each goroutine: ~2 KB stack + closure capture (often 100+ bytes).
- Each errgroup: ~200 bytes.
- Each context derivation: ~100 bytes.
- Each channel: depends on buffer.

For a pipeline with 1000 in-flight goroutines, ~2-4 MB of goroutine memory. Fine on modern servers.

### Latency costs

- Goroutine scheduling: typically <100 ns to wake up.
- Channel send to receiver wake-up: ~1 µs.
- Context cancellation propagation: depends on `select` frequency.

A pipeline that doesn't poll `ctx.Done()` may take seconds to react to cancellation. Polling frequency matters.

### Trade-off

For a CRUD service handling 100 RPS, structured concurrency is essentially free. For a streaming pipeline at 1M events/sec, every microsecond matters. Tune accordingly.

The general advice: use structured concurrency by default. Measure if you suspect overhead. Optimise specific hot paths.

---

## Cross-Process Saga Patterns

Sagas that span processes need durable state and ordered message delivery.

### Pattern: Database-backed saga

State in a Postgres/MySQL table. Each step persists progress.

```sql
CREATE TABLE sagas (
    id UUID PRIMARY KEY,
    definition_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_step INT NOT NULL,
    completed_steps JSONB,
    payload JSONB,
    last_error TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

A coordinator process reads pending sagas, advances them, persists. On crash, another coordinator picks up.

Pros: simple, debuggable, uses existing DB.
Cons: polling overhead, lock contention.

### Pattern: Workflow engine

Temporal or Cadence host workflows. Activities are functions on workers. The engine persists state, handles retries, cancellation.

```go
func OrderWorkflow(ctx workflow.Context, order Order) error {
    ao := workflow.ActivityOptions{
        StartToCloseTimeout: 5 * time.Minute,
        RetryPolicy: &temporal.RetryPolicy{
            MaximumAttempts: 5,
        },
    }
    ctx = workflow.WithActivityOptions(ctx, ao)

    var paymentID string
    if err := workflow.ExecuteActivity(ctx, ChargeActivity, order).Get(ctx, &paymentID); err != nil {
        return err
    }
    // compensations registered automatically
    if err := workflow.ExecuteActivity(ctx, AllocateActivity, order).Get(ctx, nil); err != nil {
        workflow.ExecuteActivity(ctx, RefundActivity, paymentID).Get(ctx, nil)
        return err
    }
    return nil
}
```

The engine handles persistence and retries.

Pros: durable execution, retries built-in, audit logs.
Cons: dedicated infrastructure, learning curve.

### Pattern: Choreography via events

Each step emits an event. The next step listens.

```
OrderCreated -> charge service: emits PaymentCharged or PaymentFailed
PaymentCharged -> inventory service: emits InventoryAllocated or InventoryFailed
PaymentFailed -> (no further steps; user notified)
InventoryFailed -> compensator service: refunds
```

Decentralised. Each service knows only its own role.

Pros: loose coupling.
Cons: hard to see overall flow; debugging is forensic; ordering guarantees needed.

---

## Event Sourcing and Pipeline Errors

Event sourcing: state changes are events; current state is derived by replay.

### How errors fit

- A successful step emits a `StepCompleted` event.
- A failed step emits a `StepFailed` event.
- Compensators emit `CompensationApplied` events.
- The current state is computed from all events.

```go
type Event struct {
    ID        string
    Type      string
    AggregateID string
    Data      json.RawMessage
    Timestamp time.Time
}

type Order struct {
    ID       string
    State    string // pending, charging, charged, ...
    Events   []Event
}

func (o *Order) Apply(e Event) {
    switch e.Type {
    case "PaymentCharged":
        o.State = "charged"
    case "PaymentFailed":
        o.State = "failed"
    case "RefundApplied":
        o.State = "refunded"
    }
}
```

### Pipeline as event projector

A pipeline reads events and updates projections (read models):

```go
for ev := range events {
    if err := projection.Apply(ctx, ev); err != nil {
        log.Error("projection failed", "ev", ev.ID, "err", err)
        // retry? skip? DLQ?
    }
}
```

Idempotency: projections can re-process events. The result should be the same.

Position tracking: each consumer tracks its position in the event log. On restart, resume from saved position.

### Replay

Need to fix a bug? Reset position, replay. New view? Same: project the entire log into a new view.

### Errors during projection

What happens if projection fails on a specific event? Options:

- Skip: log, move on. Risk: silent inconsistency.
- Stop: halt the projection. Risk: blocks all downstream.
- DLQ: move event to DLQ for manual review. Best for unknown failures.
- Retry: backoff and retry. Best for transient.

Choose per failure type.

---

## Backpressure Beyond Pipelines

Backpressure is more than pipeline channels. It's a system-design concept.

### Layers of backpressure

1. **TCP**: kernel-level. Slow consumer eventually slows the sender.
2. **Application protocol**: HTTP/2 flow control, gRPC streaming.
3. **Queue depth**: producers throttle when downstream queue fills.
4. **Rate limit**: producer rejects new work at a quota.
5. **Circuit breaker**: producer fails fast when downstream is failing.
6. **Load shedding**: server drops low-priority requests under load.

A robust system layers these. Don't rely on TCP alone.

### Implementation

```go
type Server struct {
    semaphore *semaphore.Weighted
}

func (s *Server) Handle(ctx context.Context, req Request) error {
    if !s.semaphore.TryAcquire(1) {
        return ErrOverloaded
    }
    defer s.semaphore.Release(1)
    return s.process(ctx, req)
}
```

Bound in-flight work. Reject excess. The client retries elsewhere or backs off.

### Negotiated backpressure

In gRPC streaming, server can send "backoff" hints to clients:

```go
return status.Error(codes.ResourceExhausted, "back off for 5 seconds")
```

Client honors the hint. Coordination beats brute-force.

---

## Pipeline Observability at Scale

At staff level, observability is a deliverable, not a bonus.

### Three pillars

- **Metrics**: numerical time series. Aggregable. Cheap.
- **Logs**: structured events. Detailed. Searchable. Expensive at scale.
- **Traces**: request paths. Show causality across services.

Each has a job. Together they form a complete picture.

### Metrics for pipelines

Per stage:
- `stage_duration_seconds` (histogram, labels: stage, status)
- `stage_in_flight` (gauge, labels: stage)
- `stage_errors_total` (counter, labels: stage, error_kind)

Per pipeline:
- `pipeline_duration_seconds` (histogram, labels: status)
- `pipeline_items_total` (counter, labels: status)

External:
- `dependency_request_duration_seconds` (histogram, labels: dependency, status)
- `dependency_circuit_breaker_state` (gauge, labels: dependency, state)

These let you answer: "is the pipeline slow? where? failing? to what dependency?"

### Logs

Structured. JSON. Including:
- `trace_id`: ties to traces.
- `pipeline_id`: ties to a specific run.
- `stage`: where the event occurred.
- `item_id`: the item being processed.
- `error`: the error (if any).
- `level`: info/warn/error.

```go
log.Error("stage failed",
    "trace_id", traceID,
    "pipeline_id", pid,
    "stage", "parse",
    "item_id", item.ID,
    "error", err,
    "duration_ms", elapsed.Milliseconds())
```

Searchable in your log aggregator. Filter by `error_kind` to find patterns.

### Traces

Each pipeline run is one trace. Each stage is one or more spans. Each external call is a sub-span.

```
Pipeline: 1.2s
├ Stage 1: 100ms
│  └ DB query: 80ms
├ Stage 2: 800ms
│  ├ API call 1: 200ms (failed)
│  ├ API call 2: 250ms (succeeded after retry)
│  └ DB write: 300ms
└ Stage 3: 200ms
```

Visualised in Jaeger or Tempo. Find the slow span; that's your bottleneck.

### Cost management

At 1M operations per minute, full logging costs millions per year. Reduce:

- Sample: log 1 in N requests.
- Aggregate: log "10 errors in last second" instead of per-error.
- Adaptive: log more when error rate is high; less when normal.
- Tiered: hot logs (last 24h, full detail) and cold logs (older, aggregated).

Engineering organisations spend significant effort here. It's not glamorous but it's necessary.

---

## Failure Domains and Blast Radius

A failure domain is the scope of impact from one failure. Design pipelines to bound it.

### Tenant isolation

Per-tenant resources prevent one tenant from impacting others:

- Separate worker pools per tenant.
- Separate rate limiters per tenant.
- Separate DBs per tenant (or schemas).

A noisy neighbour can't disrupt others.

### Region isolation

Pipelines should be region-bounded. A region failure should not cascade globally.

- DBs replicated per region; writes go to the local primary.
- Failover within a region; cross-region failover is manual.
- Cross-region pipelines explicit; not implicit via shared DBs.

### Functional isolation

One pipeline shouldn't crash the host service. Wrap in panic recovery; isolate via processes if needed.

### Blast radius rules of thumb

- One bad input: affects one item.
- One bad code path: affects one pipeline.
- One bad dependency: affects all pipelines using it.
- One bad region: affects all services in that region.
- One bad config rollout: should affect a fraction, not all.

Each rule corresponds to an isolation mechanism: per-item retries/DLQ, per-pipeline timeouts, circuit breakers, multi-region deployment, canary rollouts.

---

## Designing for Operations

Operations is the longest-running phase of any pipeline's life. Design for it.

### Runbooks

Every pipeline has a runbook:

- What the pipeline does.
- Common alerts and their meanings.
- Step-by-step diagnostic procedures.
- Escalation paths.
- Recovery procedures (replay, manual intervention).

Keep them current. Outdated runbooks are worse than no runbook.

### Knobs

Operators need controls without redeploying:

- Disable a stage temporarily.
- Adjust parallelism live.
- Set a rate limit.
- Pause processing.
- Replay a range.

Expose via config or admin API:

```go
type ControlPlane struct {
    pipeline *Pipeline
}

func (c *ControlPlane) SetParallelism(n int) { c.pipeline.workers.Resize(n) }
func (c *ControlPlane) PauseStage(name string) error { ... }
func (c *ControlPlane) ReplayRange(start, end int64) error { ... }
```

Operators don't need to redeploy for routine tuning.

### Graceful shutdown

When the pipeline receives SIGTERM:

1. Stop accepting new work.
2. Wait for in-flight work to finish (bounded).
3. Persist state.
4. Exit.

```go
func (p *Pipeline) Shutdown(ctx context.Context) error {
    p.acceptNew = false
    select {
    case <-p.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Kubernetes sends SIGTERM, waits 30s, sends SIGKILL. Use those 30s wisely.

### Replay capability

When something goes wrong, you'll want to replay a range:

```go
type Replay struct {
    Start, End int64
    DryRun     bool
}

func (p *Pipeline) Replay(ctx context.Context, r Replay) error { ... }
```

Plan for it from day one. Retrofitting replay is painful.

---

## Pipeline Capacity Planning

How much capacity does your pipeline need?

### Inputs

- Expected throughput (items/sec).
- Peak throughput (items/sec).
- Average item size.
- Average processing time per item.
- Allowed latency (p99 ≤ N seconds).

### Calculation

For a pipeline processing X items/sec, where each takes T seconds:

- Concurrent work in flight: X × T items.
- Memory per item: M bytes.
- Total memory: X × T × M.

If T = 0.1s, X = 1000/s, M = 10 KB → in-flight memory = 1 MB.

If T = 10s, X = 1000/s, M = 10 KB → in-flight memory = 100 MB.

Long-running stages multiply memory pressure.

### CPU

If each item takes C ms of CPU and you have K cores:

- Max throughput per node: K × 1000 / C items/sec.
- Nodes needed for X items/sec: X × C / (K × 1000).

For X = 10k/s, C = 5ms, K = 8: nodes = 10000 × 5 / 8000 = 6.25 nodes.

Round up. Add 50% headroom for spikes and GC.

### Network

Bandwidth in × out, request rate to dependencies. Often the binding constraint at high volumes.

### Disk

If pipeline persists state (sagas, idempotency table): rows × size × retention.

For 1M items/day, 1 KB per row, 30-day retention: 30 GB. Index size: 2-3x. Total: ~100 GB.

### Capacity model spreadsheet

Build one. Update quarterly. Use it for budget planning.

---

## SLO Design for Pipelines

Service Level Objectives quantify "good enough."

### Examples

- **Throughput**: process 99% of items within 10 seconds.
- **Success rate**: 99.9% of items succeed.
- **Availability**: pipeline accepts input 99.99% of the time.

### Error budget

If SLO is 99.9% success, you have a 0.1% error budget. In one month with 1M items:

- 1M × 0.001 = 1000 items can fail.
- Beyond that, you're out of budget.

When budget is exhausted, deploys halt. Focus shifts to reliability work.

### Choosing SLOs

- Too tight: cost prohibitive, hard to maintain.
- Too loose: bad user experience.
- Right: matches user expectations and product needs.

Negotiate with product teams. Document explicitly.

### Monitoring

SLO dashboards: current vs target, budget remaining, recent burn rate.

Alert when budget burn rate exceeds threshold ("if we keep burning at this rate, we'll exhaust in 7 days").

---

## Multi-Region Pipelines

Running pipelines in multiple regions adds latency and consistency challenges.

### Geo-partitioned

Each region runs its own pipeline for its own data. Failure in one region doesn't affect others.

Pros: isolation, low latency.
Cons: complexity, requires partitioning strategy.

### Active-passive

Primary region runs pipeline; secondary stands by. On primary failure, secondary takes over.

Pros: simple failover.
Cons: secondary mostly idle; failover takes minutes; data may be slightly behind.

### Active-active

All regions run all pipelines. Conflicts resolved by sync.

Pros: maximum availability.
Cons: conflict resolution; eventual consistency; complex.

### Common patterns

Cross-region replication of saga state: each region has a copy. On region failure, another region picks up incomplete sagas.

Cross-region message queues: items can be processed by any region. Latency varies; sometimes higher than single-region but more available.

### When to multi-region

Most internal pipelines: single region, occasional failover.
User-facing: multi-region for latency and availability.
Critical: multi-region with active-active.

Multi-region is expensive operationally. Don't reach for it without need.

---

## Stateful Pipelines and Recovery

Some pipelines have state that survives restarts: counters, accumulators, ML models being trained.

### State storage

- **Local disk**: fastest, lost on instance failure.
- **Remote DB**: durable, slower.
- **State store (etcd, Zookeeper)**: durable, designed for state.

Choose based on durability needs.

### Checkpointing

Periodically save state. On restart, restore.

```go
type Pipeline struct {
    state    map[string]int64
    saveEvery time.Duration
}

func (p *Pipeline) Run(ctx context.Context) error {
    p.loadState()
    ticker := time.NewTicker(p.saveEvery)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            p.saveState() // best-effort
            return ctx.Err()
        case <-ticker.C:
            p.saveState()
        case ev := <-p.events:
            p.process(ev)
        }
    }
}
```

Frequency trades durability vs cost.

### Recovery time

If state is large (GB), loading takes minutes. Plan for it:

- Hot standby: another instance with state already loaded.
- Incremental load: serve while loading.
- Compressed snapshots: faster transfer.

### Determinism

For replay to work, processing must be deterministic. Same events + same state = same result. Avoid:

- `time.Now()` non-deterministic (use event timestamps).
- Random numbers without seed.
- External calls without idempotency.

Workflow engines like Temporal enforce determinism. Your pipeline may want similar discipline.

---

## Distributed Tracing Deep Dive

Tracing is essential for distributed pipelines.

### Trace propagation

A trace is a tree of spans. Each span has a parent. The root span starts at the entry point.

```go
ctx, rootSpan := tracer.Start(context.Background(), "pipeline.run")
defer rootSpan.End()

// pass ctx through every stage
```

Each stage creates child spans. The tree depth matches your stage depth.

### Cross-service propagation

When calling service B from A, embed trace context in headers:

```go
req, _ := http.NewRequestWithContext(ctx, "POST", url, body)
otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
```

Service B extracts:

```go
ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
ctx, span := tracer.Start(ctx, "handler")
```

The trace now spans both services. Visualised end-to-end.

### Span attributes

Add metadata to spans:

```go
span.SetAttributes(
    attribute.String("item.id", item.ID),
    attribute.Int("batch.size", len(batch)),
    attribute.String("tenant.id", tenant.ID),
)
```

In Jaeger, filter by attributes. "Show me all spans for tenant X." Powerful debugging.

### Span events

Mark important moments:

```go
span.AddEvent("retry", trace.WithAttributes(attribute.Int("attempt", attempt)))
```

Events show as dots on the span. Mark retries, cache hits, decisions.

### Sampling strategy

Tracing 100% is expensive. Sample:

- **Head-based**: decision at trace start. Easy, may miss interesting traces.
- **Tail-based**: decision after trace completes. Captures errors and slow traces. More complex.

For production, tail-based with 100% of errors and 1% of normal is a good default.

### Trace explorer

Equip your tracing UI with:

- Filter by service, span name, attributes.
- Compare traces (find the slow one).
- Aggregate views (p99 by service, by endpoint).
- Service maps (auto-generated from traces).

These views answer 80% of debugging questions.

---

## Error Routing at Scale

In a large pipeline, errors need routing — not all errors are equal.

### Routing taxonomy

```
error
├ user error -> respond to user; do not page
│  ├ validation
│  ├ authorization
│  └ not found
├ transient -> retry; alert if rate high
│  ├ network
│  └ throttling
├ persistent -> alert; investigate
│  ├ data corruption
│  ├ contract violation
│  └ internal logic
└ fatal -> page; stop pipeline
   ├ database unreachable
   ├ config missing
   └ corrupt state
```

The pipeline classifies each error and routes:

```go
err := work()
switch classify(err) {
case userError:
    metrics.UserErrors.Inc()
    return err
case transient:
    metrics.Transient.Inc()
    return retry(err)
case persistent:
    metrics.Persistent.Inc()
    alerting.Notify("persistent error", err)
    return err
case fatal:
    metrics.Fatal.Inc()
    alerting.Page("fatal", err)
    return err
}
```

Different error categories have different operational responses.

### Classification

Use `errors.Is` and `errors.As` to classify:

```go
func classify(err error) ErrorKind {
    if errors.Is(err, context.Canceled) { return cancelled }
    if errors.Is(err, ErrFatal) { return fatal }
    if errors.Is(err, ErrTransient) { return transient }
    var ve *ValidationError
    if errors.As(err, &ve) { return userError }
    return persistent
}
```

Done well, this is the foundation of operational pipelines.

---

## Compatibility and Versioning

Pipelines are long-lived. Code evolves. Compatibility matters.

### Backward-compatible changes

Safe (in general):

- Adding optional fields to messages.
- Adding new sentinel errors.
- Adding new stages (if they're no-ops for old data).
- Loosening validation.

### Backward-incompatible changes

Risky:

- Removing fields.
- Removing sentinels.
- Tightening validation.
- Changing error semantics.

For these:

1. Add a v2 alongside v1.
2. Migrate clients to v2.
3. Deprecate v1.
4. Remove v1 after grace period.

### Wire format compatibility

If your pipeline persists state, the format must be readable by every version. Use formats with versioning:

- Protobuf with optional fields (forward and backward compatible).
- JSON with explicit version field.
- Avro with schema registry.

Don't use Go gob — too tied to Go's type system.

### Saga state compatibility

If a saga is in flight when you deploy a new version, the new version must handle the old state. Worst case: stuck sagas. Mitigations:

- Drain before deploy: wait for in-flight sagas to complete.
- Backward-compatible code: new version reads old state.
- Migration: explicit upgrade step that runs once.

Plan for it.

---

## The Cost of Wrong Defaults

Defaults shape behaviour at scale. Wrong defaults compound.

### Example: 30-second timeout

If your HTTP client's default timeout is 30s, every dependency call can hang for 30s before failing. Under a dependency outage, all your workers hang for 30s, capacity drops, queue grows.

Better: explicit per-call timeouts based on SLOs.

### Example: unlimited goroutines

If `g.SetLimit` is not called, fan-out can spawn millions. Memory blows up. Scheduler overloaded.

Better: always SetLimit.

### Example: no retry budget

If retries are uncapped per pipeline, one flaky dependency consumes all worker time on retries.

Better: budget per pipeline; once exhausted, fail fast.

### Example: synchronous logging

Logging that blocks the request path slows everything. At scale, log buffers fill up and the application stalls.

Better: async logging with bounded buffers.

### Example: persistent connection without keepalive

A TCP connection that never sends keepalives can stay dead-but-open for hours.

Better: enable keepalive; set TCP timeouts.

Each default is small. Together they determine whether your service degrades gracefully or catastrophically.

---

## Pipeline Anti-Patterns at Staff Level

These look fine but are wrong at scale.

### Anti-pattern: One-size-fits-all retry

Every error retried with the same policy. Result: validation errors retried, wasting capacity; transient errors retried with insufficient backoff, amplifying load.

Fix: classify errors; retry only transient; with backoff and jitter.

### Anti-pattern: Synchronous on the request path

A user request triggers a long pipeline; the request times out before completion.

Fix: async with webhook completion, or polling endpoint.

### Anti-pattern: No backpressure

Pipeline accepts unlimited work. Queue grows, memory grows, OOM.

Fix: bounded queue; reject excess.

### Anti-pattern: Single point of failure

One DB, one queue, one region. Outage takes down everything.

Fix: replication, multi-region for critical paths.

### Anti-pattern: Tight coupling to a workflow engine

All business logic inside Temporal workflows. Migration to another engine is impossible.

Fix: keep business logic in plain Go functions; workflow engine just orchestrates.

### Anti-pattern: Custom retry library

Team writes its own retry. Buggy. Inconsistent across services.

Fix: standard library (`cenkalti/backoff`) or shared internal lib.

### Anti-pattern: Logs as metrics

Counting "ERROR" log lines for monitoring. Slow, expensive, fragile.

Fix: use metrics (counters, gauges, histograms).

### Anti-pattern: No SLO

Pipeline runs without targets. Performance drifts. Nobody notices until customer complains.

Fix: define SLOs; alert on burn rate.

---

## Case Studies

### Case Study 1: The 50% reduction in incidents

A team had 10 incidents/month from a payments pipeline. Causes: cascading retries, no DLQ, no circuit breaker.

Changes:

1. Circuit breaker on each external dependency.
2. DLQ for poison messages.
3. Retry with jitter and budget.
4. Per-tenant bulkheads.

Result: 5 incidents/month. The other 5 were unrelated to pipeline mechanics — they were business logic bugs.

Lesson: most pipeline incidents have known fixes. Apply them.

### Case Study 2: The query that broke production

A pipeline ran a DB query that, due to a data growth spike, started taking 30s instead of 100ms. Workers were saturated; queue grew; eventually OOM.

Changes:

1. Per-call DB timeout: 5s.
2. Query optimisation (added an index).
3. Capacity-aware admission (don't accept work if workers are saturated).

Result: under similar conditions, the pipeline now degrades gracefully — drops some work but stays up.

Lesson: bounded timeouts and admission control prevent cascading failure.

### Case Study 3: The migration that didn't break anything

A pipeline migrated from a single-region to multi-region architecture. Zero customer-visible disruption.

How:

1. New region ran in parallel for 2 weeks; old region still authoritative.
2. Reads served from local region.
3. Writes routed to old region; replicated to new.
4. Cut over writes during low-traffic window.
5. Decommissioned old region after 1 month of stability.

Lesson: migrations succeed when planned in phases with rollback capability.

---

## Patterns From Other Systems

Learn from production systems beyond Go.

### Kafka Streams

Streaming pipeline with built-in state stores, exactly-once semantics (in some configs), and replay. Concept of "topology" — stages connected by streams.

Influences Go libraries that aim for similar semantics.

### Apache Flink

Distributed stream processor with strong consistency guarantees, checkpointing, savepoint-based recovery. Inspires patterns for stateful Go pipelines.

### AWS Step Functions

Hosted workflow service. State machine definition in JSON. Each step is a Lambda. Built-in retry, error handling, parallel branches.

Worth studying for state-machine-based pipeline design.

### Erlang/OTP supervision trees

Every process is supervised. On crash, supervisor restarts. Hierarchy of supervisors. Inspires structured concurrency.

`errgroup` is a one-level supervisor. For deeper trees, you build them.

### Akka actors

Actors with mailboxes. Each actor processes one message at a time. Failure restarts the actor with policy. Inspires per-tenant isolation patterns.

---

## Future Directions

Where pipeline design is heading.

### Native structured concurrency in Go

The Go team has explored structured concurrency proposals. The current `errgroup` is the de facto standard but lacks native syntax.

Watch the design docs.

### Generic pipeline libraries

With Go generics, type-safe pipeline libraries are possible:

```go
type Stage[I, O any] func(ctx context.Context, in <-chan I, out chan<- O) error

func Run[I, O any](ctx context.Context, in []I, stages ...Stage) ([]O, error)
```

Libraries like `sourcegraph/conc` explore this space.

### Hardware-accelerated pipelines

For high-volume data processing (ML, video), GPU/TPU-accelerated stages. Go is not the natural fit but interop is improving.

### Serverless pipelines

Per-event invocations on AWS Lambda, Cloud Functions, Cloudflare Workers. Stateless, scales horizontally. Different patterns from long-lived processes.

Go works well in serverless. State management is the challenge.

### Confidential computing

Pipelines processing sensitive data in secure enclaves. Errors must not leak data even in failure modes. Special considerations for logging and tracing.

---

## Tooling Ecosystem

Tools you'll use at this level:

- `pprof`: performance profiling.
- `go test -race`: race detection in tests.
- OpenTelemetry: tracing and metrics.
- Prometheus: metrics storage and alerting.
- Grafana: dashboards.
- Jaeger / Tempo: trace storage and UI.
- Loki / ElasticSearch: log storage and search.
- Temporal / Cadence: workflow engines.
- `sentinel`: chaos engineering (or Chaos Mesh).
- `kubectl debug`: live debugging of pods.
- `goroutine` profile: stack inspection.

Master the toolchain. Tools save hours when production breaks.

---

## Self-Assessment

- [ ] I can design a multi-service pipeline with explicit error contracts.
- [ ] I can implement idempotency with budgets.
- [ ] I can quantify the cost of structured concurrency in my use case.
- [ ] I can choose between in-process saga, DB-backed saga, and workflow engine.
- [ ] I can design SLOs and alerting for a pipeline.
- [ ] I can size capacity for expected load.
- [ ] I can plan a multi-region pipeline migration.
- [ ] I can write runbooks for on-call.
- [ ] I can identify the failure domains in a pipeline architecture.
- [ ] I can review and approve pipeline designs from other teams.

---

## Summary

Professional / staff-level pipeline design is about systems, contracts, operations, and trade-offs. The Go code is the smallest part. Most of the work is design: choosing the right architecture, defining error contracts, planning capacity, designing for failure.

The senior who can write a perfect errgroup pipeline graduates to professional when they can answer: "Why this architecture and not that one?" with reference to throughput, durability, blast radius, operational cost, and team capability.

Pipeline design is a craft. It rewards experience. The best designs come from engineers who've watched their pipelines fail in production and learned from the failures.

---

## Further Reading

- "Patterns of Distributed Systems" — Unmesh Joshi.
- "Designing Data-Intensive Applications" — Martin Kleppmann.
- "Site Reliability Engineering" — Google.
- "Building Reliable Distributed Systems" — Werner Vogels (AWS blog).
- Temporal documentation.
- Cadence documentation.
- AWS Well-Architected Framework.
- Google SRE workbook.
- Bryan Mills, "Rethinking Classical Concurrency Patterns."
- The original "Sagas" paper — Garcia-Molina and Salem, 1987.

---

## Closing

You've reached the end of the four-level series on error propagation in pipelines. From `go f()` and `errgroup.Go` at junior, through sagas and aggregation at senior, to multi-region multi-service architectures here at professional. The same primitives compose into ever more sophisticated patterns.

The next stage of growth is not more reading. It is building. Take a real production pipeline at your company. Audit it against this material. Find the gaps. Propose changes. Implement them. Watch them work — or fail. Learn.

Mastery is built one production incident at a time.

---

## Extended Case Study: Designing a Global Payment Pipeline

To bring everything together, walk through the design of a global payment pipeline. The pipeline:

- Processes payments for users in 200+ countries.
- Handles 100k transactions/sec at peak.
- Must be available 99.99% of the time.
- Must be auditable for compliance.
- Must support multiple payment processors (Stripe, Adyen, regional ones).

### Architecture

- Per-region pipeline (US, EU, APAC). Cross-region replication for compliance only.
- Each pipeline is a chain: validate -> route to processor -> charge -> record.
- Processor selection based on country and amount.
- Sagas for multi-step processes (subscription cancellation, refunds).

### Error design

Sentinels:

```go
var (
    ErrInsufficientFunds = errors.New("insufficient funds")
    ErrProcessorDown     = errors.New("processor unavailable")
    ErrFraud             = errors.New("fraud detected")
    ErrCountryRestricted = errors.New("country restricted")
)
```

Typed errors with rich data:

```go
type ProcessorError struct {
    Processor string
    Code      string
    Retryable bool
    Err       error
}
```

Error contract across services (gRPC):

```protobuf
enum PaymentErrorCode {
    PAYMENT_OK = 0;
    PAYMENT_INSUFFICIENT_FUNDS = 1;
    PAYMENT_PROCESSOR_DOWN = 2;
    PAYMENT_FRAUD = 3;
    PAYMENT_COUNTRY_RESTRICTED = 4;
    PAYMENT_INTERNAL = 99;
}
```

### Idempotency

Every charge has a client-provided idempotency key. Server stores key + result in a dedicated table. Retention: 7 days (charges retried within 7 days return cached result).

### Retry policy

- Transient processor errors: exponential backoff, max 3 attempts, jitter.
- ProcessorDown: switch to backup processor (multi-processor fallback).
- InsufficientFunds: no retry (user must update payment method).
- Internal: retry once with delay; if still fails, alert.

### Bulkheads

- Per-processor worker pool.
- Per-country rate limit.
- Per-merchant rate limit.

### Circuit breakers

- One per processor.
- Open at 50% failure rate over 30 seconds.
- Half-open after 60 seconds; admit 1 request to test.

### Observability

- Per-request span (trace ID + span ID).
- Metrics per processor: latency, success rate, circuit state.
- Logs include trace ID, country, processor, amount (no PCI data).
- Audit log: every state change persisted with operator/system attribution.

### Sagas

For complex flows (subscription with auto-renewal), Temporal workflow:

```go
func SubscriptionWorkflow(ctx workflow.Context, sub Subscription) error {
    for {
        // wait until next renewal
        workflow.Sleep(ctx, durationUntilNextRenewal(sub))
        result, err := workflow.ExecuteActivity(ctx, ChargeActivity, sub).Get(ctx, nil)
        if err != nil {
            // Notify user, mark subscription as past_due, retry later
            workflow.ExecuteActivity(ctx, NotifyPastDueActivity, sub).Get(ctx, nil)
            continue
        }
        // record renewal, update next date
    }
}
```

Workflow runs forever; Temporal persists state.

### Recovery

- Failed transactions: DLQ for manual review.
- Failed sagas: paused in Temporal; operators inspect and resume.
- Region failure: traffic shifts to nearest region; cross-region replication catches up.

### Capacity

- 100k TPS peak; 30k TPS average.
- Per-region: 50% peak headroom.
- Processor pools sized to fit.

### Operations

- Runbooks per failure type.
- Knobs for: pause processor, adjust rate limits, replay range.
- Daily reports of error rates per category.

This is the kind of design conversation a staff engineer leads. It synthesises everything from the previous levels plus organisational and operational concerns.

---

## Bonus: 30 Questions for Staff Pipeline Interview

If you can answer all of these, you're ready for staff-level pipeline work:

1. Design a pipeline for processing 1M events/sec with 99.9% success rate.
2. How would you implement exactly-once semantics?
3. When is the saga pattern overkill?
4. Compare Temporal vs database-backed saga.
5. How do you bound the blast radius of a single bug?
6. How do you migrate from at-least-once to effectively-once?
7. Design an idempotency layer for a payments API.
8. How do you size the dedup table retention?
9. When is multi-region worth the complexity?
10. How do you trace a request across 20 services?
11. What's wrong with retry-on-every-error?
12. How do you handle a poisoned message in a queue?
13. Compare gRPC streaming vs Kafka for pipelines.
14. Design a backfill that takes 3 days to run.
15. How do you test failure paths?
16. What metrics do you alert on?
17. What's the difference between SLO and SLA?
18. How do you handle a runaway pipeline consuming all CPU?
19. Design a rate limiter that supports per-tenant and per-resource quotas.
20. When does structured concurrency become a liability?
21. How do you migrate a saga's state schema?
22. Compare orchestration vs choreography for distributed sagas.
23. How do you handle a dependency that has 10x normal latency?
24. Design a graceful shutdown that doesn't lose work.
25. What's the failure mode of a circuit breaker without a timeout?
26. How do you debug a pipeline that "just hangs"?
27. When do you replay vs reprocess from scratch?
28. How do you observe a stateful pipeline?
29. What's the operational cost of running a workflow engine?
30. When do you write your own retry library vs using a standard one?

For each: think for 5 minutes; write down your answer; discuss with a peer.

---

## Final Words

The four-level journey through error propagation in Go pipelines is complete. The skills compound:

- Junior: write correct concurrent code.
- Middle: design error vocabularies and patterns.
- Senior: build production-grade systems with sagas and observability.
- Professional: architect distributed systems with explicit contracts and operations.

Each level is a foundation for the next. Skipping levels means brittle code at scale. Investing in foundations pays back over decades of practice.

Concurrency is hard. Distributed systems are harder. Error handling sits at the intersection. Master it deliberately. Build slowly. Test relentlessly. Observe everything.

Then sleep through the 3 AM pages.

---

## Deep Dive: Designing Pipeline APIs for Multiple Consumers

A pipeline that serves multiple teams has higher design constraints. The API becomes a contract that other engineers depend on.

### Public vs internal API surface

Public: documented, stable, versioned. Internal: free to change.

Public must include:

- The `Run` function (or equivalent verb).
- All sentinel errors callers might match.
- All typed errors callers might inspect.
- The config struct.
- The result type.

Internal: everything else — stages, workers, channels, retry logic.

### Backward compatibility commitments

When you publish a pipeline API:

- New fields in config: optional, default to current behaviour.
- New sentinel errors: must be wrapped under existing categories if callers had switches.
- New stages: must be no-ops for clients that don't enable them.
- Renamed parameters: never; introduce new params, deprecate old.

### Forward compatibility

Code your client to ignore unknown fields, accept unknown enum values, handle new errors gracefully. Robust clients survive their server's evolution.

### Documentation as API

Every public symbol has a doc comment. Every error documented. Examples in `example_test.go`. Generated docs hosted somewhere visible.

Without docs, consumers reverse-engineer behaviour from code. Brittle and error-prone.

### Migration support

When you change behaviour, provide a migration:

- Tools to scan client code for incompatibilities.
- Conversion utilities.
- A deprecation period (3 months minimum for internal teams).

### Example: a generic pipeline library

```go
// Package conc provides structured concurrency primitives.
package conc

// Pipeline is a typed multi-stage processor.
type Pipeline[I, O any] struct { ... }

// New creates a pipeline. Stages are added with AddStage.
func New[I, O any](cfg Config) *Pipeline[I, O] { ... }

// Run executes the pipeline. Returns when all stages complete or any fails.
// The returned error chain may include any of:
//   - context.Canceled / context.DeadlineExceeded
//   - errors from any stage, wrapped with stage identification
//   - ErrCapacityExceeded if SetLimit was reached and TryGo failed
func (p *Pipeline[I, O]) Run(ctx context.Context, input []I) ([]O, error) { ... }

// Stage adds a processing stage to the pipeline. Stages run concurrently.
type Stage[I, O any] func(ctx context.Context, in <-chan I, out chan<- O) error
```

Notice: explicit error documentation, generic types, clear naming. This is what a public-API pipeline library looks like.

---

## Deep Dive: Designing for On-Call

If you're on call for the pipeline, design accordingly.

### Dashboards

Every pipeline has a primary dashboard:

- Throughput (items/sec) — primary KPI.
- Latency (p50, p95, p99).
- Error rate by category.
- Queue depth (if applicable).
- Active goroutines (leak detection).
- Dependency latency (per dependency).
- Circuit breaker states.
- DLQ size.

The dashboard tells you in 30 seconds: is the pipeline healthy?

### Alerts

Tier alerts:

- **Page** (wakes engineer): SLO at risk, service down, data loss.
- **Slack** (notifies team during hours): SLO degraded, error rate elevated.
- **Email/digest** (no urgency): trends, anomalies, capacity warnings.

Avoid alert fatigue: too many pages → engineers ignore them. Tune until pages are actionable.

### Runbooks

For each alert, document:

1. What it means.
2. Where to look first.
3. Common causes.
4. Mitigation steps.
5. Who to escalate to.

```markdown
## Alert: PipelineErrorRateHigh

What: Error rate >5% for 5+ minutes.

First look: dashboard "Errors by category". Identify category.

If "Transient" elevated:
  - Check dependency dashboards for outages.
  - If dependency outage, wait for recovery.
  - If sustained, open circuit breaker manually: `kubectl ... set env CIRCUIT_BREAKER_X=open`

If "Validation" elevated:
  - Check recent deploys.
  - Inspect sample errors in logs.
  - Possibly bad input format from upstream.

If "Internal" elevated:
  - PAGE oncall-backend immediately.
  - Capture goroutine dump: `kubectl exec ... -- kill -QUIT 1`.
  - Roll back recent deploy.

Escalation: page-database, page-payments-team after 15 minutes.
```

Practice runbooks in game days. Update after each incident.

### On-call interfaces

Operations need to:

- See pipeline state.
- Pause/resume.
- Replay a range.
- Drain a queue.
- Inspect DLQ items.
- Force-fail a stuck saga.

Build admin APIs (with proper authn/authz). Or a debug CLI:

```bash
pipelinectl status
pipelinectl pause stage=parse
pipelinectl resume stage=parse
pipelinectl replay --from=2026-05-01 --to=2026-05-02
pipelinectl dlq list
pipelinectl saga inspect saga-id-xyz
pipelinectl saga force-fail saga-id-xyz
```

These tools save hours.

### Postmortems

Every incident, write a postmortem:

- Timeline.
- Impact (users affected, duration).
- Root cause.
- Resolution.
- Prevention (action items).

Postmortems are not blame. They're the only way an organisation learns.

---

## Deep Dive: Pipeline Cost Engineering

At scale, pipelines cost money. Optimising cost is a design dimension.

### Cost drivers

- Compute: per-instance per-hour.
- Memory: per-GB per-hour.
- Disk: per-GB-month.
- Network: per-GB transferred, especially cross-region.
- Dependencies: per-call to external APIs, third-party services.

A pipeline processing 1B items/day at $10/instance-hour, with 100 instances, costs $24k/month just for compute. Storage, network, dependencies often more.

### Cost per item

Define a unit cost:

```
cost_per_item = (compute_$ + memory_$ + network_$) / items_processed
```

Track over time. Improvements show as cost reduction.

### Optimisations

- **Batch operations**: 1 query with 100 rows is cheaper than 100 queries with 1 row each.
- **Caching**: cache external API results to reduce calls.
- **Compression**: store and transmit compressed data.
- **Spot instances**: for non-critical pipelines, use spot/preemptible. 50-80% cheaper.
- **Right-sizing**: don't run on bigger instances than needed.
- **Off-hours batch**: heavy batch work overnight when capacity is cheaper.

### Cost-aware design

If a stage's dependency costs $0.001/call and you do 100M items/day, that's $100k/day just on that dependency. Cache aggressively or batch.

A staff engineer asks: "What is this design's marginal cost per million items?" before approving it.

### FinOps integration

Modern orgs have FinOps teams that track and optimise cloud costs. Engage them. They have tools and data you don't.

---

## Deep Dive: Pipeline Performance at the Limit

Pipelines pushed to their limits expose subtleties.

### CPU saturation

When all CPUs are at 100%, no more throughput. Symptoms: latency rises, queue grows. Profile CPU. Common findings:

- Hot code in JSON encoding/decoding (consider gob, protobuf).
- Excessive GC (reduce allocations).
- Inefficient regex.
- Tight loop without yield.

### Memory saturation

When heap grows unbounded, GC pauses lengthen, ultimately OOM. Symptoms: lag spikes, eventual crash. Profile heap:

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Look for: large slices that don't get released, leaked goroutines (each is 2 KB+).

### Lock contention

When threads spend more time waiting on locks than working. Profile blocked:

```bash
go tool pprof http://localhost:6060/debug/pprof/block
```

Look for: shared mutex on hot path. Mitigate with sharding, lock-free patterns, or `sync.RWMutex` for read-heavy.

### Network saturation

If you're at line rate, you can't push more data. Add bandwidth, compress, batch.

### Disk saturation

Heavy writes (logging, DB) can saturate disk. Async batched writes help. SSD vs HDD makes a 10x difference.

### Dependency saturation

Most pipelines bottleneck on a dependency. Capacity-plan and bound calls per second.

### Tail latency

p99 matters more than p50 for user-facing pipelines. A single slow stage can multiply tail latency:

```
P(slow) per stage = 1%
P(slow) pipeline = 1 - (1 - 0.01)^stages
For 10 stages: ~10%
```

Each stage independent. Add stages, tail latency degrades multiplicatively.

Mitigations: hedging (send duplicate requests, take first), per-stage timeouts, parallelism.

---

## Deep Dive: Disaster Recovery

What happens when everything goes wrong?

### Scenarios

- Region outage.
- Datacenter loss.
- Bad deploy.
- Data corruption.
- Ransomware.
- Provider outage (cloud, dependencies).

### Recovery time and point objectives

- **RTO (Recovery Time Objective)**: how quickly must we be back up?
- **RPO (Recovery Point Objective)**: how much data loss is acceptable?

For payments: RTO = 5 minutes, RPO = 0 (no data loss).
For analytics: RTO = 4 hours, RPO = 1 hour.

The trade-off: tighter RTO/RPO = more cost.

### Backup strategy

- Continuous: every write replicated.
- Periodic: snapshots every N minutes.
- Point-in-time recovery (PITR): replay log to a specific moment.

For pipeline state, PITR is gold. Saga state from any point can be restored.

### Restore drills

Practice restoring. Every quarter. Untested backups are worthless.

```bash
# Drill:
# 1. Restore yesterday's saga state to a staging cluster.
# 2. Verify integrity.
# 3. Process recent transactions.
# 4. Compare to production.
```

The first drill always uncovers something broken. The fifth drill is routine.

### Chaos in production

Real chaos engineering: kill instances, drop network, pause DBs in production. Catches problems before they catch you.

Netflix's Chaos Monkey, Chaos Kong (kill a region), Chaos Gorilla (kill multiple zones). Same concept, different blast radius.

### Tabletop exercises

Once a quarter, gather the team. Walk through a scenario:

> "Wednesday 3 AM. The primary database is unresponsive. The replica lag is 30 minutes. The pipeline is alerting. What do you do?"

Discuss step by step. Document gaps. Improve.

---

## Deep Dive: Compliance and Audit

Some pipelines have legal requirements.

### PCI-DSS (payments)

- No PCI data in logs.
- Encryption at rest.
- Encryption in transit.
- Access logging.
- Quarterly vulnerability scans.

Pipeline must be designed so PCI data is in narrow paths, redacted everywhere else.

### GDPR (EU data)

- Data subject can request deletion.
- Data subject can request export.
- Right to be forgotten propagates through pipeline state.

Saga state, DLQ items, audit logs — all must be deletable per request. Design with this in mind.

### HIPAA (healthcare)

Similar to PCI-DSS but for medical data. Encryption, audit, access control.

### SOC 2

Process-level controls. Documentation, change management, access reviews.

### Audit trail

Every state change recorded:

```
2026-05-15 10:23:45.123 Z user_id=abc123 action=charge amount=100 result=ok payment_id=xyz789
```

Append-only. Tamper-evident. Retained per policy (often 7 years).

The audit trail is *not* the same as logs. Logs may be rotated, sampled, redacted. Audit trails are forever.

---

## Deep Dive: Trade-offs in Real Decisions

Real design decisions have trade-offs. Examples.

### Trade-off: Sync vs async pipeline

Sync:
- + Lower latency for caller.
- + Easier to debug.
- + Errors return immediately.
- − Caller waits.
- − Less scalable.

Async:
- + Caller doesn't wait.
- + Scales by adding workers.
- + Durability via queue.
- − More complex.
- − Eventual consistency.
- − Need webhooks or polling for completion.

For a typical pipeline (>100ms processing time), async wins for user experience.

### Trade-off: Single DB vs sharded

Single:
- + Simple.
- + ACID across the dataset.
- + Cheap to start.
- − Scaling ceiling.
- − Single point of failure.

Sharded:
- + Horizontal scale.
- + Failure of one shard partial.
- − Cross-shard transactions hard.
- − Operational complexity.

Most pipelines start single, shard when forced.

### Trade-off: First error vs aggregation

First-error:
- + Simple.
- + Fast cancellation.
- + Clear cause.
- − Lose secondary errors.
- − Not suitable for batch reporting.

Aggregation:
- + Complete picture.
- + Per-item visibility.
- − More memory.
- − More complex callers.

Use first-error for user-facing, aggregation for batch.

### Trade-off: Saga vs distributed transaction

Saga:
- + Works across heterogeneous services.
- + Long-running OK.
- + No locks.
- − Eventual consistency.
- − Compensators needed.

Distributed transaction (2PC):
- + Strong consistency.
- + No compensators.
- − Holds locks.
- − Slow.
- − Sensitive to failures.

For modern systems, sagas. 2PC is rarely justified.

### Trade-off: Workflow engine vs custom

Engine (Temporal, etc.):
- + Battle-tested durability.
- + Built-in retry, signal, child workflows.
- + Visibility.
- − Operational burden.
- − Vendor lock-in.
- − Learning curve.

Custom:
- + Tailored to needs.
- + No external dependency.
- + Cheap.
- − Reinventing the wheel.
- − Bugs in your saga lib.

For complex workflows, engines pay off. For simple sagas, custom is fine.

---

## Deep Dive: Organisational Patterns

How teams organise around pipelines.

### Pipeline ownership

- **Single team owns end-to-end**: simple, but team must have all skills.
- **Federated stages**: each team owns a stage. Coordination heavy.
- **Platform team owns infrastructure, product teams own logic**: scales, but needs clear contracts.

The third works at large scale. Platform team provides pipeline framework; product teams write stages.

### On-call rotation

Pipeline owners are on-call for the pipeline. 24/7 coverage with rotating shifts.

For platform teams: on-call for the framework, not for product-team logic.

### Incident review

Postmortems are public. Action items tracked. Repeats identified and addressed.

### Capacity planning

Quarterly. Track current usage, forecast growth, plan headroom.

Tight pipelines (no headroom) are fragile. 50% headroom is typical; 100% for critical.

### Cost reviews

Monthly. Identify trends. Optimise. Justify spend.

### SLO reviews

Quarterly. Are we meeting? Why or why not? Should we tighten?

These reviews force discipline. Without them, drift happens.

---

## Deep Dive: When Concurrency Hurts

Sometimes the concurrent design is worse than sequential.

### Small batches

Spawning 10 goroutines to process 10 items: overhead exceeds work. Just iterate.

```go
for _, item := range smallList {
    process(item)
}
```

Simple, fast, no concurrency overhead.

### Per-item allocation

If each goroutine allocates 1 KB, 100k goroutines allocate 100 MB. Sequential allocates per-iteration: the GC reclaims; net memory low.

### Tight loops

Goroutines have scheduling latency. A tight CPU-bound loop in one goroutine often beats the same loop split across many.

### Shared state

Concurrency on heavily shared state is locking on shared state. Locking serialises. Net throughput often worse than single-threaded.

When in doubt: benchmark. Don't assume concurrent is faster.

---

## Deep Dive: Idempotency in Detail

Idempotency is the property that an operation has the same effect on repeat as on first call.

### Levels of idempotency

- **Mathematical**: `f(x) = f(f(x))`. Setting a value.
- **Practical**: same input → same observable result. Inserting a row with the same key.
- **Approximate**: result is "close enough." A retried email arrives once (usually).

### Designing for idempotency

- **Use unique keys.** Each operation has an ID. Re-running checks the ID.
- **Conditional writes.** `INSERT ... ON CONFLICT DO NOTHING`. `UPDATE ... WHERE state = expected`.
- **Versioning.** Each record has a version. Updates check the version (optimistic concurrency).
- **Idempotency tokens.** Caller-provided ID stored in dedup table.

### Idempotent vs commutative

Idempotent: same op twice = once. Commutative: order doesn't matter.

`INSERT ... ON CONFLICT DO NOTHING` is idempotent.
`INSERT ... ON CONFLICT DO UPDATE SET counter = counter + 1` is NOT idempotent (counter increases each time).

### Non-idempotent operations

- Sending emails (without dedup token).
- Charging credit cards (without idempotency key).
- Random number generation.
- Time-based operations (`SET updated_at = NOW()`).

For non-idempotent ops, either:

1. Make them idempotent via a dedup layer.
2. Don't retry.
3. Accept double-execution and design downstream to tolerate it.

### Idempotency vs replay

Idempotency makes retries safe. Replay makes recovery from scratch safe. Both rely on the same principles.

A pipeline that supports replay can rebuild state from scratch by replaying events. Each event must be processed idempotently.

---

## Deep Dive: Schema Evolution in Pipelines

Pipelines persist data. The data's schema evolves over time.

### Adding a field

Most languages and formats: backward compatible. Old code reads new data with the new field as default; new code reads old data missing the field.

```protobuf
message Order {
    string id = 1;
    string customer_id = 2;
    // added later:
    optional string promo_code = 3;
}
```

Old code ignores `promo_code`. New code defaults it to empty string.

### Removing a field

Backward incompatible (old code reads new data, field is missing, may crash).

Migration:
1. Mark field deprecated.
2. Stop writing it.
3. Wait for all readers to migrate.
4. Remove from schema.

### Renaming a field

Same as removing + adding. Doubly painful. Just don't rename.

### Changing a field's type

Generally breaking. Add a new field with the new type, deprecate old, remove old after migration.

### Multi-version compatibility

For a deploy window, code in production reads schema version N-1 and N. After deploy, only N. Plan deploy order: roll out readers first, then writers, then remove old.

### Schema registry

Tools like Confluent Schema Registry centralise schemas. Producers register; consumers validate. Compatibility checks prevent breaking changes.

For internal pipelines, even a wiki page of "current schemas" beats nothing.

---

## Deep Dive: Eventually Consistent vs Strongly Consistent

Distributed pipelines often must choose.

### Strongly consistent

All replicas show the same view at the same time. Reads always see latest write.

Pros: simple mental model, no inconsistency bugs.
Cons: slow (distributed coordination), low availability (cannot serve during partition).

### Eventually consistent

Replicas converge over time. Reads may see stale data temporarily.

Pros: fast, available.
Cons: programmers must handle stale reads, conflict resolution.

### When to use which

For payments: strongly consistent (no double-charge).
For analytics: eventually consistent (slight lag OK).
For inventory: depends — over-sell tolerable vs not.

Most pipelines have a mix: some operations strict, others lax.

### Read-after-write consistency

A specific consistency model: "after I write, my next read sees it."

Implementations:
- Read from primary (slow, serialises).
- Sticky sessions (always read from same replica).
- Causal tokens (read at least version X).

### Conflict resolution

When two writers concurrently modify the same record:

- Last-write-wins (LWW): timestamp wins. Simple but can lose data.
- Vector clocks: track causality. More complex but accurate.
- CRDTs (conflict-free replicated data types): designed for concurrent modification.

For most pipeline state, LWW with sufficient timestamps is acceptable.

---

## Deep Dive: Tail Latency Engineering

p99 (and p999) latency is the user experience. Optimising it requires different techniques than optimising p50.

### Causes of tail latency

- GC pauses (rare in Go but possible).
- Lock contention (one slow holder blocks everyone).
- Cache misses.
- Slow dependencies (one slow call multiplies through).
- Network jitter.
- Resource exhaustion (queue depth, file descriptors).

### Mitigations

- **Hedging**: send duplicate requests, take first. 2x cost, much better p99.
- **Backup paths**: try fast path first, fall back to slower if needed.
- **Cancellation**: kill slow operations past a threshold.
- **Per-call timeouts**: bound worst case.
- **Resource pre-allocation**: avoid allocation in hot path.

### Hedging example

```go
type Result struct { ... }

func hedgedFetch(ctx context.Context, url string) (Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    resCh := make(chan Result, 2)
    g.Go(func() error {
        r, err := fetch(ctx, url)
        if err == nil { resCh <- r }
        return err
    })
    select {
    case r := <-resCh:
        return r, nil
    case <-time.After(50 * time.Millisecond):
        // hedge: try a second request
        g.Go(func() error {
            r, err := fetch(ctx, url)
            if err == nil { resCh <- r }
            return err
        })
    }
    select {
    case r := <-resCh:
        return r, nil
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
}
```

After 50ms, fire a second request. Take whichever finishes first. Doubles cost but reduces p99 significantly.

### Measuring tail latency

Histograms with fine-grained buckets:

```go
metrics.NewHistogram("latency", prometheus.HistogramOpts{
    Buckets: prometheus.ExponentialBuckets(0.001, 2, 16),
})
```

Buckets from 1ms to ~65s. Covers normal and pathological cases.

### SLO on tail

If SLO is "p99 ≤ 500ms," that's strict. Achieving it requires every stage to have p99 ≤ 50ms (assuming 10 stages). Reverse-engineer budgets.

---

## Deep Dive: Pipeline Patterns from Functional Programming

Some pipeline patterns trace to functional roots.

### Map, filter, reduce

```go
func Map[I, O any](in <-chan I, f func(I) O) <-chan O {
    out := make(chan O)
    go func() {
        defer close(out)
        for v := range in {
            out <- f(v)
        }
    }()
    return out
}

func Filter[T any](in <-chan T, pred func(T) bool) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range in {
            if pred(v) { out <- v }
        }
    }()
    return out
}
```

Compose:

```go
out := Reduce(Filter(Map(input, double), isPositive), 0, sum)
```

Limitations: no error propagation built-in, no context cancellation. Need to integrate with errgroup.

### Monadic error handling

Go's `error` return is essentially an `Either` type. Wrap with `%w` to chain.

Result types:

```go
type Result[T any] struct {
    Value T
    Err   error
}

func (r Result[T]) Map(f func(T) T) Result[T] {
    if r.Err != nil { return r }
    return Result[T]{Value: f(r.Value)}
}
```

Reduce boilerplate. Some Go users find this verbose; others love it.

### Streams

Apache Beam, Java streams, JavaScript iterators — all pipelines with rich composition. Go's channels are stripped-down versions.

The trade-off: simpler primitives = more boilerplate; richer primitives = more abstraction. Go errs toward simplicity. Wrappers can add abstraction when needed.

---

## Deep Dive: Cross-Language Pipelines

Pipelines that span languages have unique error issues.

### gRPC across languages

gRPC's status codes are language-neutral. Errors map across:

```go
// Go service raises
return status.Error(codes.NotFound, "user not found")

// Java client receives
io.grpc.StatusRuntimeException: NOT_FOUND: user not found

// Python client receives
grpc.RpcError, with code() == StatusCode.NOT_FOUND
```

Each language has its own way to inspect. The contract is the code + message + details.

### Serialised errors

JSON-encoded errors:

```json
{
    "code": "NOT_FOUND",
    "message": "user not found",
    "details": {"user_id": 42}
}
```

Each language parses to its idiomatic representation. Maintain a shared schema.

### Type mappings

A Go error type doesn't translate to Python. The receiving service must build its own representation.

Document mappings:

| Go | Python | Java |
|----|--------|------|
| `*ValidationError{Field}` | `ValidationError(field)` | `ValidationException(getField())` |
| `ErrNotFound` (sentinel) | `NotFoundError` exception | `NotFoundException` |

Without shared schema, every service reinvents.

---

## Deep Dive: Observability vs Privacy

Logging more = better debugging, worse privacy. Balance is design.

### What you can log

- Pseudonymised IDs (hashes, UUIDs).
- Non-sensitive metadata (timestamp, status, duration).
- Error types (not error contents that might contain PII).
- Performance counters.

### What you cannot log

- PII (names, emails, addresses).
- PCI data (card numbers, CVVs).
- Health data (HIPAA).
- Credentials (passwords, API keys).
- Customer-content data (messages, files).

### Redaction

```go
log.Info("user processed",
    "user_id", hash(user.ID),
    "email_domain", emailDomain(user.Email), // not the full email
    "duration_ms", elapsed.Milliseconds())
```

Hash IDs so the same user is identifiable across logs but not externally meaningful.

### Tracing and PII

Spans should not contain PII either. Same redaction rules.

### Compliance review

Before deploying logging code, have a compliance/security review. Easier than fixing later.

### Sample logs

Document sample logs in the runbook:

```
# Normal:
{"ts":"2026-05-15T10:00:00Z","level":"info","stage":"parse","item_id":"abc","duration_ms":12}

# Error:
{"ts":"...","level":"error","stage":"charge","item_id":"abc","error_kind":"insufficient_funds","error_chain":["charge","payments client","sdk"]}
```

Don't log:

```
{"user_email":"actual@email.com",...}  // PII leak
{"card_number":"4242...",...}           // PCI violation
{"api_key":"sk_..."...}                  // Credential leak
```

---

## Deep Dive: Pipeline Modularity

Modular pipelines are easier to maintain.

### Stage as module

Each stage in its own file, with its own test:

```
pipeline/
  pipeline.go        // orchestrator
  pipeline_test.go
  stages/
    parse/
      parse.go
      parse_test.go
    enrich/
      enrich.go
      enrich_test.go
    store/
      store.go
      store_test.go
```

Each stage testable in isolation. Composed by the orchestrator.

### Interfaces between stages

Define stage inputs and outputs as interfaces:

```go
type Parser interface {
    Parse(ctx context.Context, raw []byte) (Record, error)
}

type Enricher interface {
    Enrich(ctx context.Context, r Record) (EnrichedRecord, error)
}

type Storer interface {
    Store(ctx context.Context, r EnrichedRecord) error
}
```

Mockable. Replaceable. Test-friendly.

### Wire-up

```go
func NewPipeline(p Parser, e Enricher, s Storer) *Pipeline {
    return &Pipeline{parser: p, enricher: e, storer: s}
}
```

Dependency injection. Production wires real implementations; tests wire fakes.

### Versioning stages

If a stage's interface evolves, version it:

```go
type ParserV1 interface { Parse(ctx, []byte) (Record, error) }
type ParserV2 interface { ParseV2(ctx, []byte) (Record, ParseMetadata, error) }
```

Pipeline can use either; gradually migrate.

---

## Deep Dive: Asynchronous Result Patterns

For long-running pipelines, callers don't want to wait.

### Polling

Caller submits work, gets an ID, polls for status:

```
POST /jobs -> {"job_id":"abc"}
GET /jobs/abc -> {"status":"running","progress":42}
GET /jobs/abc -> {"status":"done","result":{...}}
```

Simple. Wasteful for long jobs. Throttle polling appropriately.

### Webhooks

Caller submits work + a callback URL. Service posts when done.

```
POST /jobs body={..., "callback":"https://caller/done"}
[service processes, then]
POST https://caller/done body={"job_id":"abc","result":{...}}
```

Efficient. Caller must be available.

### Server-sent events

Long-lived connection, server streams updates:

```
GET /jobs/abc/stream
event: progress
data: {"progress":42}

event: done
data: {"result":...}
```

Real-time. Limited to single connection per client.

### WebSockets

Bidirectional. More complex but most flexible.

### Choice

For internal services: webhooks (or gRPC streaming).
For external API: polling (most universal).
For real-time UI: SSE or WebSockets.

---

## Deep Dive: Choosing Pipeline Boundaries

Where does one pipeline end and another begin?

### Tight coupling within

Stages that share state heavily belong together. Splitting requires expensive coordination.

### Loose coupling between

Independent transformations of independent data are separate pipelines.

### Async boundary

If two stages would benefit from independent scaling, retry, or rate limits, separate them with a queue.

### Synchronous boundary

If the second stage cannot start without the first's result and total latency is critical, keep them in one process.

### Example

Order processing: validate, charge, allocate, ship, notify.

- Validate → charge: sync (must be atomic).
- Charge → allocate: sync (rollback charge if allocate fails).
- Allocate → ship: async (allocation is committed; ship in background).
- Ship → notify: async (ship is committed; notify in background).

Three pipelines: pre-allocation (sync), post-allocation (async), post-ship (async). Each independently scalable.

---

## Deep Dive: Tracing Cost and Effectiveness

Tracing has cost. Worth it?

### Direct costs

- Span creation: 1-10 µs.
- Span export: batched, async.
- Backend storage: variable.

For 1k spans/sec, ~1 GB/day at typical sizes. Manageable.

### Benefits

- Find slow stages instantly.
- See cross-service dependencies.
- Identify contention.
- Audit causality.

### Sampling

100% in development. 1-10% in production for normal requests. 100% for errors and slow requests (tail sampling).

### When tracing helps most

Distributed systems with >5 services. Single-service pipelines benefit less; logs and metrics suffice.

### When tracing is wasted

If nobody reads the traces. Set up dashboards and queries that actually get used.

A tracing setup that nobody opens is shelfware. Worse: gives false confidence.

---

## Final Closing

The professional / staff level is where engineering becomes architecture. The Go code is the smallest portion of the job. Most of your time is design discussions, RFC writing, operational planning, team coordination.

The principles from junior level still hold. The patterns from middle level are still in your toolkit. The senior-level practices are still required. But now you compose them at the system level.

A staff engineer's pipeline design is judged not by elegance alone, but by:

- How well it serves the product.
- How well it serves operations.
- How well it serves the team.
- How well it survives reality.

Build for reality. Test for reality. Operate in reality. The pipelines that endure are the ones designed with those constraints from the start.

End of professional level. Read the rest of this directory (specification, interview, tasks, find-bug, optimize) to round out your knowledge. Then build something. Then operate it. Then come back here and laugh at how much you didn't know — including how much you still don't.

---

## Extended Architecture Reference: Specific Pipeline Designs

A reference of canonical pipeline designs, each with their error model.

### Design A: Synchronous web API with internal pipeline

Use case: a user-facing endpoint that processes a request through 3-5 stages before responding.

```
HTTP -> handler -> errgroup pipeline (3 stages) -> response
```

Error model:
- First-error from errgroup.
- HTTP status mapped from error category.
- Cancellation tied to request context.
- Per-call dependency timeouts (300ms).

Pros: simple, low latency, easy to debug.
Cons: caller waits.

### Design B: Async batch job

Use case: nightly job processing yesterday's data.

```
cron -> coordinator -> errgroup (parallel batches) -> reports
```

Error model:
- Aggregation; report all batch failures.
- Retries inside batch processor.
- DLQ for poison batches.
- Email summary at completion.

Pros: durability via DB, retries.
Cons: long-running.

### Design C: Real-time event stream

Use case: process events from Kafka in real time.

```
Kafka -> consumer -> stages -> Kafka (output topic) + DB
```

Error model:
- Per-event: log + DLQ for poison.
- Pipeline-fatal: alert and stop consuming.
- Cursor-based recovery (Kafka offset commit).
- Idempotency via DB primary key.

Pros: throughput.
Cons: complex operational story.

### Design D: Multi-step workflow

Use case: order fulfillment with payment, allocation, shipping.

```
HTTP -> create order -> Temporal workflow
              workflow:
                charge activity
                allocate activity
                ship activity
                notify activity
              compensators run on failure
```

Error model:
- Per-activity retry policy.
- Saga rollback on failure.
- Workflow persisted in Temporal.
- Activities idempotent.

Pros: durable, retried, audit.
Cons: Temporal operational cost.

### Design E: Multi-region active-passive

Use case: critical service with regional failover.

```
Primary region: active pipeline
Secondary region: standby
Replication: continuous DB replication
```

Error model:
- Primary handles all traffic.
- Health check failure → DNS failover.
- Saga state replicated; secondary picks up incomplete sagas.
- RTO: 5 minutes; RPO: <1 minute.

Pros: high availability.
Cons: complex; expensive.

### Design F: Multi-tenant SaaS

Use case: per-tenant pipelines on shared infrastructure.

```
Request -> auth -> tenant lookup -> per-tenant pipeline
```

Error model:
- Bulkhead per tenant (rate limits, worker pools).
- Per-tenant SLOs.
- Tenant errors don't cascade.
- Shared infrastructure failures alert all tenants.

Pros: isolation, scale.
Cons: noisy-neighbour management.

---

## Comparative: Workflow Engines Side-by-Side

For your saga needs, here are the major workflow engines.

### Temporal

Origin: Uber Cadence fork.
Language: Go SDK first-class; many others available.
Persistence: own cluster (Cassandra, MySQL, PostgreSQL).
Workflow definition: Go code (deterministic).
Retries: declarative per activity.
Versioning: GetVersion API for backward compat.
Operational cost: medium-high.

Strengths: durable execution, mature, rich features.
Weaknesses: dedicated infrastructure, learning curve.

### AWS Step Functions

Origin: AWS-managed.
Language: any (via SDK).
Persistence: AWS-managed.
Workflow definition: Amazon States Language (JSON).
Retries: declarative.
Versioning: limited.
Operational cost: low (managed).

Strengths: managed, AWS integration.
Weaknesses: vendor lock-in, JSON DSL less expressive.

### Cadence

Original Uber project, predecessor of Temporal. Similar capability.

### Argo Workflows

Origin: Kubernetes-native.
Language: any (via container).
Persistence: Kubernetes CRDs.
Workflow definition: YAML.
Retries: declarative.

Strengths: K8s native, no extra cluster.
Weaknesses: YAML DSL, K8s overhead per step.

### When to use which

- **Heavy use of Go, on-prem or any cloud**: Temporal.
- **AWS shop, simple workflows**: Step Functions.
- **Kubernetes shop, container-based**: Argo.

Or, for simple sagas: roll your own in Go with DB-backed state.

---

## Comparative: Message Queue Choices

Async pipelines need a queue.

### Kafka

Strengths: throughput, retention, replay, ecosystem.
Weaknesses: operational complexity, partitions are a design choice.
Use for: high-throughput streams, event sourcing.

### RabbitMQ

Strengths: flexible routing, easier to operate than Kafka.
Weaknesses: lower throughput, queues delete on consume.
Use for: task queues, RPC, moderate volume.

### AWS SQS

Strengths: managed, simple API, DLQ built-in.
Weaknesses: limited throughput per queue, no exactly-once, no ordering (FIFO has limits).
Use for: AWS-native task queues.

### NATS / JetStream

Strengths: lightweight, fast, modern Go-friendly.
Weaknesses: smaller ecosystem.
Use for: microservices messaging, IoT.

### Redis Streams

Strengths: cheap if you already have Redis.
Weaknesses: not as durable as Kafka, smaller scale.
Use for: low-volume streaming.

### Choice

Most teams pick what they already operate. Adding a new queue is operational debt.

---

## Comparative: Tracing Backends

Tracing data needs storage and a UI.

### Jaeger

Open source, originally Uber.
Storage: Cassandra, ElasticSearch.
UI: built-in.
Strengths: free, established.
Weaknesses: needs operating.

### Tempo

Open source, by Grafana Labs.
Storage: object storage (S3, GCS).
UI: Grafana.
Strengths: cheap storage, integration with Loki and Prometheus.
Weaknesses: newer.

### Honeycomb / Datadog / New Relic

Managed services.
Strengths: turnkey, advanced query.
Weaknesses: cost.

### AWS X-Ray, GCP Cloud Trace

Managed, cloud-native.
Strengths: integration with respective cloud.
Weaknesses: cloud lock-in.

### Choice

Open source if you have ops capacity. Managed if you don't. The data and the workflow matter more than the brand.

---

## Detailed Walkthrough: Migrating From In-Process to Distributed Pipeline

A common evolution: a monolith pipeline becomes too large; split it.

### Phase 0: Single-process pipeline

```go
func Run(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(parse)
    g.Go(enrich)
    g.Go(store)
    return g.Wait()
}
```

All in one process. Easy.

### Phase 1: Identify the boundary

Which stage benefits most from independent scaling? Usually the heaviest (enrich, often).

### Phase 2: Add a queue between

```go
// Producer process: read, parse, write to queue
func ProducerRun(ctx context.Context, items []Item) error {
    for _, it := range items {
        parsed, err := parse(it)
        if err != nil { return err }
        if err := queue.Publish(ctx, parsed); err != nil { return err }
    }
    return nil
}

// Consumer process: read from queue, enrich, store
func ConsumerRun(ctx context.Context, queue Queue) error {
    for {
        msg, err := queue.Consume(ctx)
        if err != nil { return err }
        enriched, err := enrich(msg)
        if err != nil {
            msg.Nack()
            continue
        }
        if err := store(enriched); err != nil {
            msg.Nack()
            continue
        }
        msg.Ack()
    }
}
```

Two processes. Queue in between. Each scales independently.

### Phase 3: Add observability

New entities (the queue, the consumer process). Add metrics, logs, traces for each.

### Phase 4: Define error contract

What errors does the consumer return? How does the producer find out about failures? Decision: DLQ, plus periodic alerts.

### Phase 5: Operationalise

Runbooks for the new components. Deploy pipelines. Monitoring.

### Phase 6: Iterate

Find new pain points. Maybe split again. Maybe move to a workflow engine.

This is the evolution path many production systems follow over years. Plan for it.

---

## Detailed Walkthrough: A Production Incident

A composite story drawing from real incidents.

### Setup

A payments pipeline processes 50k charges/minute. Stages: validate, charge, settle, notify.

### Timeline

- **10:00**: deploy of a new feature ("apply promo codes").
- **10:05**: error rate climbs from 0.1% to 2%.
- **10:08**: alert fires.
- **10:09**: on-call sees the alert. Opens dashboard. Sees error category "validation" elevated.
- **10:10**: opens recent logs. Sees `promo: invalid format` errors.
- **10:12**: confirms: new feature has a bug. Promo code parser rejects valid codes.
- **10:13**: decision: roll back.
- **10:15**: rollback initiated.
- **10:20**: rollback complete. Error rate normalising.
- **10:30**: error rate back to 0.1%.

Total user impact: 30 minutes, ~15k transactions affected.

### Postmortem

Root cause: promo code parser had an off-by-one error. Unit tests didn't cover the boundary.

Action items:
1. Add property-based test for promo parser.
2. Canary deploy promo feature first to 1% of traffic.
3. Improve alert threshold sensitivity (catch 1% earlier).
4. Add error-by-stage dashboard pivot for faster triage.

This is a "good" incident: short impact, clear root cause, actionable improvements. The pipeline design enabled fast diagnosis and rollback. The team learned and improved.

### What the design enabled

- Error categorisation: "validation" vs "internal" identified the bug class immediately.
- Per-stage metrics: showed where the bug lived.
- Wrapped errors with `%w`: error chain pointed at the promo parser.
- Rollback capability: deploy infrastructure supported quick revert.

Each of these was a design decision made months earlier. They paid off in this incident.

---

## Pattern: Asynchronous Reply

For long-running pipelines, "fire and forget" with reply via callback.

```go
type Submission struct {
    ID       string
    Callback string
    Payload  []byte
}

func Submit(ctx context.Context, s Submission) error {
    if err := queue.Publish(ctx, s); err != nil { return err }
    return nil
}

// In a worker process:
func Worker(ctx context.Context) error {
    for {
        s, err := queue.Consume(ctx)
        if err != nil { return err }
        result := process(s)
        notify(ctx, s.Callback, result)
        // ack regardless; reply is best-effort
        queue.Ack(s)
    }
}
```

Caller submits, eventually gets called back. Many to-do list / job-runner patterns work this way.

Considerations:
- Caller must accept incoming HTTP. Or polling fallback.
- Notify is unreliable; retry mechanism needed for callback failure.
- Caller must dedupe by submission ID.

---

## Pattern: Two-Tier Pipeline (Hot + Cold)

Some pipelines have "hot" (real-time) and "cold" (batch) paths.

```
Event -> hot pipeline -> approximate result for user
       \
        -> cold pipeline -> exact result, replaces approximate
```

Hot is fast, may be slightly wrong. Cold is slower, authoritative.

Example: bank transaction. Hot: immediately show "pending." Cold: settlement happens overnight, may reverse.

Implementation:
- Hot path: in-memory, optimistic.
- Cold path: durable, definitive.
- UI shows hot result with "pending" indicator until cold confirms.

Trade-off: complexity vs UX. Worth it for high-value flows.

---

## Pattern: CQRS

Command-query responsibility segregation. Commands go through one pipeline (writes); queries through another (reads).

```
Write pipeline: command -> validate -> apply -> persist -> emit event
Read pipeline: event -> project to read store -> serve queries
```

Reads are fast (denormalised). Writes are simple (no read concerns). Events provide audit trail.

Errors:
- Write errors: standard pipeline error handling.
- Projection errors: complicated (eventually consistent but recoverable via replay).

CQRS adds complexity. Use when read patterns and write patterns differ greatly.

---

## Pattern: Materialised View

Periodically rebuild a view from source data.

```go
func RebuildView(ctx context.Context) error {
    return errgroup.WithContext(ctx).Run(func(g *errgroup.Group, ctx context.Context) error {
        g.SetLimit(workers)
        var newView View
        var mu sync.Mutex
        rows, err := source.Read(ctx)
        if err != nil { return err }
        for row := range rows {
            row := row
            g.Go(func() error {
                projected, err := project(row)
                if err != nil { return err }
                mu.Lock()
                newView.Add(projected)
                mu.Unlock()
                return nil
            })
        }
        if err := g.Wait(); err != nil { return err }
        return view.AtomicReplace(ctx, newView)
    })
}
```

(Note: this code uses a fictional `errgroup.WithContext(...).Run(...)` adapter for brevity; the principle is what matters.)

Materialised views are eventually consistent with the source. Trade-off: latency vs query performance.

---

## Pattern: Idempotent State Machines

Each entity (order, user, transaction) has a state machine. Transitions are explicit and idempotent.

```go
func (o *Order) Transition(event Event) error {
    switch {
    case o.State == "pending" && event.Type == "charge_succeeded":
        o.State = "charged"
        o.PaymentID = event.PaymentID
    case o.State == "pending" && event.Type == "charge_failed":
        o.State = "failed"
    case o.State == "charged" && event.Type == "ship_succeeded":
        o.State = "shipped"
    // ...
    default:
        return fmt.Errorf("invalid transition: %s + %s", o.State, event.Type)
    }
    return nil
}
```

Replaying events from log produces the current state. Saving state is just saving the order record.

Pipelines feed events to the state machine. Errors in the pipeline don't corrupt state — invalid transitions are rejected.

---

## Considerations: Building Tooling Around Pipelines

A pipeline framework benefits from tooling.

### CLI tools

- `pipelinectl status`: current state.
- `pipelinectl pause`: pause a stage.
- `pipelinectl resume`: resume.
- `pipelinectl replay`: replay a range.
- `pipelinectl dlq inspect`: examine dead-letter queue.
- `pipelinectl saga show`: detail a saga.

Engineers operate the pipeline without redeploying.

### Web UI

A small web UI showing:
- Pipeline graph (stages, channels).
- Live metrics.
- Recent errors.
- DLQ contents.
- In-flight sagas.

Saves time on triage.

### Test harness

A library for testing pipelines:

```go
func TestPipeline(t *testing.T) {
    h := pipeline.NewTestHarness(t).
        WithMockStorer(...).
        WithMockAPI(...).
        ExpectErrorIs(ErrTransient)

    h.Run(testItem)
}
```

Common test patterns extracted. Tests stay readable.

### Code generators

If you add many similar pipelines, generate boilerplate:

```bash
pipelinegen new --name=OrderImport --stages=parse,validate,store
```

Generates the pipeline structure, tests, runbook template.

### Documentation generators

From code annotations, generate operational docs:

```go
// @pipeline OrderImport
// @sla 99.9% success, p99 < 5s
// @runbook https://...
func OrderImport(...)
```

Tooling pulls these into a hub.

These tools take time to build but compound. After 5 pipelines, you spend more time managing them than writing them. Tooling pays back fast.

---

## Considerations: Team Practices

How teams work on pipelines.

### Design reviews

Major pipelines get design docs before code. RFC format:

- Problem.
- Proposal.
- Alternatives considered.
- Trade-offs.
- Operational plan.
- Migration plan.
- Open questions.

Peers review. Iterate. Approve before coding.

### Code reviews

For pipeline changes:
- Two reviewers minimum.
- One from the pipeline owners.
- One from operations / SRE.

Focus on: correctness, observability, operability.

### Testing requirements

Pipeline PRs require:
- Unit tests for stages.
- Integration test for the pipeline.
- Failure-path tests.
- Race tests pass.

CI enforces.

### Deploys

Pipelines are critical. Deploys are careful:
- Staging first. Wait 24 hours.
- Canary: 1%, 10%, 50%, 100%.
- Each step waits for healthy metrics.
- Rollback if degraded.

Take a long time. Worth it.

### On-call

Pipeline owners on-call. Rotation usually 1 week.

Handoff includes recent incidents, pending action items.

---

## Considerations: Scaling Engineering

As your team grows, pipeline ownership scales.

### One team, one pipeline

A team owns end-to-end: code, deploy, operate, evolve. Tight cohesion. Limit on complexity.

### Federated teams

Multiple teams own stages. Coordination overhead. Stage interfaces become contracts.

Works if stage interfaces are stable and well-documented. Breaks if teams diverge.

### Platform + product

Platform team builds the framework; product teams write business logic. Scales to many pipelines.

Risks: platform team becomes bottleneck if not staffed; product teams diverge from platform.

### Reaching staff engineer level

Operating one pipeline well: senior.
Operating multiple pipelines, training others, designing frameworks: staff.
Defining org-wide patterns, RFCs others follow: principal.

Each level adds scope. The skills are the same; the radius widens.

---

## Considerations: Career Implications

Mastery of pipelines is rare and valuable.

### Skills you build

- Concurrent programming (Go specifically, but transferable).
- Distributed systems thinking.
- Error handling and recovery design.
- Observability practices.
- Operational discipline.

These are core staff-level skills in any backend role.

### Industries that need this

- Fintech: payments, settlements, fraud.
- E-commerce: orders, inventory, fulfillment.
- Healthcare: claims, records.
- Streaming/Media: encoding, distribution.
- IoT: ingestion, processing.
- AI/ML: training pipelines, inference.

Every nontrivial backend has pipelines.

### Promotion criteria

For senior → staff in pipeline work:
- Lead a pipeline migration.
- Author RFCs for cross-team pipeline patterns.
- Mentor others on pipeline design.
- Recover the team from a major pipeline incident.
- Demonstrate broad systems thinking.

Hard to fake. Built over years.

---

## Recapping the Series: Distilled Wisdom

After four levels of pipeline study, the essence:

1. **Errors are part of the design**, not an afterthought.
2. **Cancellation is everyone's job**: every blocking op must honour `ctx.Done()`.
3. **Wrap errors with %w**: preserve the chain for callers.
4. **Sentinel + typed + opaque**: three levels of error vocabulary.
5. **First-error vs aggregate**: choose deliberately.
6. **Bounded everything**: parallelism, retries, queue depth, latency.
7. **Idempotency is non-negotiable** for anything with side effects.
8. **Compensating actions are essential** for multi-step processes.
9. **Observe everything**: metrics, logs, traces, audits.
10. **Test failure paths exhaustively**.
11. **Design for operations**: runbooks, knobs, replay.
12. **Plan for evolution**: backward compat, migration paths.

These twelve principles, applied consistently, produce pipelines that endure.

The day-to-day work is in the details: which sentinel? what timeout? when to retry? when to give up? Each decision shapes the system. Choose wisely.

---

## A Personal Note

If you've worked through all four files in this series, you've absorbed maybe 30 hours of writing — the distilled output of years of practice. The next 1000 hours are yours to spend in production.

Most pipelines you write will be unsatisfying. Bugs you didn't predict. Failure modes you didn't imagine. 3 AM pages for problems you "should have caught."

This is normal. Every engineer who built a great pipeline first built ten mediocre ones. The mediocre ones are how you learn.

The principles in these documents are timeless. Tools change — Temporal was new once, Kubernetes too. Patterns evolve — sagas were named in 1987 but evolved in interpretation since. Languages change — Go is one of many.

But the discipline of designing for failure, of treating errors as data, of cooperating across goroutines via cancellation, of observing what you operate — these endure.

Master these principles. Apply them. Iterate.

The pipelines you build will outlive your tenure on the team. They will process billions of items. They will catch bugs and recover gracefully. They will let your colleagues sleep.

That's the work.

---

## Coda: Reading List Per Topic

For deeper study, organised by topic.

### Concurrency
- Tony Hoare, "Communicating Sequential Processes."
- Doug Lea, "Concurrent Programming in Java."
- Brian Goetz, "Java Concurrency in Practice."
- Katherine Cox-Buday, "Concurrency in Go."

### Error handling
- Joel Spolsky, "Exceptions" (essay).
- Russ Cox, "Error Values and Wrapping in Go 1.13."
- Roberto Ierusalimschy, "Programming in Lua" (error chapter).

### Distributed systems
- Martin Kleppmann, "Designing Data-Intensive Applications."
- Andrew Tanenbaum and Maarten van Steen, "Distributed Systems."
- Pat Helland, "Memories, Guesses, and Apologies."

### Sagas and workflows
- Hector Garcia-Molina and Kenneth Salem, "Sagas" (1987 paper).
- "Practical Saga Patterns" (microservices.io).
- Temporal docs and blog.

### Observability
- Cindy Sridharan, "Distributed Tracing in Practice."
- Charity Majors et al., "Observability Engineering."

### SRE / operations
- Google, "Site Reliability Engineering."
- Google, "The SRE Workbook."
- Michael Nygard, "Release It!"

### Performance
- Brendan Gregg, "Systems Performance."
- Martin Thompson, "Mechanical Sympathy" (talks).
- Damian Gryski, "go-perfbook" (GitHub).

This list could fill a year of study. Pick three. Read them. Then pick three more.

---

## Final Closing

You finished. Take a break.

The next pipeline you build will be better than the last. The one after that, better still. In five years you'll look back at today's code and cringe — that's growth.

The materials in this series will outlast many versions of Go. The principles are language-agnostic. The mechanics are specific to Go but the design lessons apply everywhere.

Build well. Test thoroughly. Operate carefully. Document accurately. Mentor others.

That is the staff-level pipeline engineer's job.

Welcome to the work.

---

## Extended Practical Guide: Building a Distributed Saga Step by Step

The single most useful skill at this level is implementing a robust distributed saga. Walk through one end-to-end.

### Step 1: Define the workflow

Consider a hotel booking workflow:

```
Reserve hotel room
Reserve flight
Charge credit card
Send confirmation email
```

Each step has a forward action and a compensator:

| Step | Forward | Compensator |
|------|---------|-------------|
| Reserve room | API call, holds room | Release room |
| Reserve flight | API call, holds seat | Release seat |
| Charge card | API call, charges | Refund |
| Send email | API call, sends | (none, can't unsend) |

### Step 2: Define the data model

```sql
CREATE TABLE bookings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    state TEXT NOT NULL, -- pending, in_progress, completed, failed, rolled_back
    current_step INT NOT NULL,
    completed_steps JSONB,
    payload JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

CREATE TABLE booking_events (
    id BIGSERIAL PRIMARY KEY,
    booking_id UUID REFERENCES bookings(id),
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

`bookings` is the saga state. `booking_events` is the audit trail.

### Step 3: Define step interfaces

```go
type Step interface {
    Name() string
    Forward(ctx context.Context, payload *Payload) error
    Compensate(ctx context.Context, payload *Payload) error
}

type Payload struct {
    UserID     string
    HotelID    string
    FlightID   string
    RoomID     string    // set by Reserve room
    SeatID     string    // set by Reserve flight
    PaymentID  string    // set by Charge
    Amount     int64
}
```

### Step 4: Implement steps

```go
type ReserveRoomStep struct {
    hotels HotelClient
}

func (r *ReserveRoomStep) Name() string { return "reserve_room" }

func (r *ReserveRoomStep) Forward(ctx context.Context, p *Payload) error {
    roomID, err := r.hotels.Reserve(ctx, p.HotelID, p.UserID, "idempotency-key-"+p.UserID)
    if err != nil {
        return fmt.Errorf("reserve room: %w", err)
    }
    p.RoomID = roomID
    return nil
}

func (r *ReserveRoomStep) Compensate(ctx context.Context, p *Payload) error {
    if p.RoomID == "" { return nil } // never succeeded
    return r.hotels.Release(ctx, p.RoomID)
}
```

Note: idempotency-key on Reserve. The hotel API dedupes. If Reserve is called twice with the same key, the second call returns the same room.

### Step 5: Implement coordinator

```go
type Coordinator struct {
    store BookingStore
    steps []Step
    log   Logger
}

func (c *Coordinator) Process(ctx context.Context, bookingID string) error {
    booking, err := c.store.Load(ctx, bookingID)
    if err != nil { return fmt.Errorf("load: %w", err) }

    payload := booking.Payload

    // Resume from current step
    switch booking.State {
    case StateCompleted, StateFailed, StateRolledBack:
        return nil // terminal
    case StatePending:
        booking.State = StateInProgress
        c.store.Save(ctx, booking)
    case StateInProgress, StateRollingBack:
        // resume
    }

    if booking.State == StateRollingBack {
        return c.rollback(ctx, booking)
    }

    return c.forward(ctx, booking)
}

func (c *Coordinator) forward(ctx context.Context, b *Booking) error {
    for i := b.CurrentStep; i < len(c.steps); i++ {
        step := c.steps[i]
        b.CurrentStep = i
        if err := c.store.Save(ctx, b); err != nil {
            return fmt.Errorf("persist before step: %w", err)
        }
        c.log.Info("saga forward", "id", b.ID, "step", step.Name())
        c.recordEvent(ctx, b.ID, "step_started", step.Name())

        err := step.Forward(ctx, b.Payload)
        if err == nil {
            b.CompletedSteps = append(b.CompletedSteps, step.Name())
            c.recordEvent(ctx, b.ID, "step_succeeded", step.Name())
            continue
        }

        c.log.Error("saga step failed", "id", b.ID, "step", step.Name(), "err", err)
        b.LastError = err.Error()
        b.State = StateRollingBack
        c.recordEvent(ctx, b.ID, "step_failed", step.Name())
        if err := c.store.Save(ctx, b); err != nil {
            return fmt.Errorf("persist before rollback: %w", err)
        }
        return c.rollback(ctx, b)
    }
    b.State = StateCompleted
    c.recordEvent(ctx, b.ID, "saga_completed", "")
    return c.store.Save(ctx, b)
}

func (c *Coordinator) rollback(ctx context.Context, b *Booking) error {
    // Use fresh context for rollback
    rollbackCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
    defer cancel()

    var errs []error
    for i := len(b.CompletedSteps) - 1; i >= 0; i-- {
        name := b.CompletedSteps[i]
        step := c.findStep(name)
        if step == nil { continue }
        c.log.Info("saga compensate", "id", b.ID, "step", name)
        c.recordEvent(rollbackCtx, b.ID, "compensation_started", name)
        err := step.Compensate(rollbackCtx, b.Payload)
        if err != nil {
            c.log.Error("compensation failed", "id", b.ID, "step", name, "err", err)
            errs = append(errs, fmt.Errorf("compensate %s: %w", name, err))
            c.recordEvent(rollbackCtx, b.ID, "compensation_failed", name)
            // continue with other compensations
        } else {
            c.recordEvent(rollbackCtx, b.ID, "compensation_succeeded", name)
            b.CompletedSteps = b.CompletedSteps[:i]
            c.store.Save(rollbackCtx, b)
        }
    }
    b.State = StateRolledBack
    c.store.Save(rollbackCtx, b)
    if len(errs) > 0 {
        return fmt.Errorf("rollback had errors: %w", errors.Join(errs...))
    }
    return fmt.Errorf("saga rolled back: %s", b.LastError)
}

func (c *Coordinator) recordEvent(ctx context.Context, bookingID, eventType, data string) {
    _, _ = c.store.RecordEvent(ctx, BookingEvent{
        BookingID: bookingID,
        EventType: eventType,
        Payload:   data,
    })
}

func (c *Coordinator) findStep(name string) Step {
    for _, s := range c.steps {
        if s.Name() == name { return s }
    }
    return nil
}
```

### Step 6: Implement crash recovery

A scheduled job picks up incomplete sagas:

```go
func (c *Coordinator) Recover(ctx context.Context) error {
    incomplete, err := c.store.FindIncomplete(ctx, time.Now().Add(-30*time.Minute))
    if err != nil { return err }

    for _, b := range incomplete {
        b := b
        go func() {
            if err := c.Process(ctx, b.ID); err != nil {
                c.log.Error("recovery failed", "id", b.ID, "err", err)
            }
        }()
    }
    return nil
}
```

Run every 5 minutes. Picks up sagas that have been "in_progress" for >30 minutes without progress.

### Step 7: Test exhaustively

Test cases:
- Happy path: all steps succeed.
- Step N fails: verify rollback runs for steps 1..N-1.
- Forward retry succeeds: after first failure, retry, success.
- Compensator fails: verify other compensators still run.
- Crash mid-forward: process restarts; resumes from current step.
- Crash mid-rollback: process restarts; resumes rollback.
- Concurrent execution of same saga: only one wins (DB advisory lock).
- Step is idempotent: re-running mid-step is safe.

Each test exercises a real failure mode. Build a chaos harness:

```go
type ChaosStep struct {
    real        Step
    failOnFwd   bool
    failOnComp  bool
    crashOnFwd  bool
    crashOnComp bool
}
```

Inject controlled failures. Verify behavior.

### Step 8: Observability

Metrics:
- `saga_started_total`
- `saga_completed_total`
- `saga_rolled_back_total`
- `saga_step_duration_seconds{step, status}`
- `saga_compensation_duration_seconds{step, status}`

Logs at every step. Trace IDs propagated.

Dashboards: state of all in-flight sagas; recent terminal states; trends.

### Step 9: Operations

Admin tools:
- List in-flight sagas.
- Inspect specific saga (state, events).
- Manually advance / fail / cancel a saga.
- Retry a stuck saga.
- Force-complete a saga (skipping further steps).

Used rarely but essential when something goes wrong.

### Step 10: Iterate

This coordinator is ~500 lines. It's enough for small-scale sagas. As complexity grows, you might:

- Add child sagas (a saga step launches another saga).
- Add long-running waits (saga sleeps until an external event).
- Add parallel branches.
- Add signal/wait patterns.

At some complexity, switch to a workflow engine like Temporal.

---

## Extended Reference: errgroup Alternatives

For specific needs, other concurrency libraries.

### `sourcegraph/conc`

A modern alternative with pools, streams, and iterators:

```go
import "github.com/sourcegraph/conc"

p := conc.NewWaitGroup()
p.Go(func() { /* do work */ })
p.Wait()

// Pool with error handling
pool := pool.New().WithMaxGoroutines(10).WithErrors()
pool.Go(func() error { return work() })
err := pool.Wait()

// Stream
stream := stream.New()
for _, item := range items {
    item := item
    stream.Go(func() stream.Callback {
        result := process(item)
        return func() { handleResult(result) }
    })
}
stream.Wait()
```

Pros: more types, more features.
Cons: another dependency, less standard.

### `golang.org/x/sync/semaphore`

For weighted concurrency limits:

```go
sem := semaphore.NewWeighted(int64(workers))

for _, item := range items {
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    go func(item Item) {
        defer sem.Release(1)
        process(item)
    }(item)
}
```

Pros: handles weighted resource demands.
Cons: more manual coordination.

### `github.com/panjf2000/ants`

Goroutine pool that reuses goroutines:

```go
pool, _ := ants.NewPool(workers)
defer pool.Release()

for _, item := range items {
    item := item
    pool.Submit(func() {
        process(item)
    })
}
```

Pros: lower goroutine creation overhead.
Cons: another dependency; goroutines are cheap, gains rarely measurable.

### Choosing

For most pipelines, `errgroup` is right. Reach for alternatives only when you have a specific need errgroup doesn't meet.

---

## Extended Reference: Production Pipeline Frameworks in Go

A survey of frameworks you might use or contribute to.

### Temporal SDK

Workflow engine integration. Workflows in Go; activities also.

```go
func MyWorkflow(ctx workflow.Context, input Input) (Output, error) {
    ao := workflow.ActivityOptions{ ... }
    ctx = workflow.WithActivityOptions(ctx, ao)
    var result Output
    err := workflow.ExecuteActivity(ctx, MyActivity, input).Get(ctx, &result)
    return result, err
}
```

### Benthos / Bento

Stream processing engine in Go. Config-driven pipelines for messaging.

```yaml
input:
  kafka:
    addresses: [localhost:9092]
    topics: [events]

pipeline:
  processors:
    - bloblang: |
        root = this
        root.processed_at = now()

output:
  http_client:
    url: https://api.example.com/events
```

For ETL-style streaming, can be faster than custom code.

### Watermill

Library for event-driven applications. Provides primitives for message handling, retries, DLQ.

### Conduit

Connector-based data integration. Source/destination plugins.

### Choosing

For unique business logic: custom Go.
For ETL: consider Benthos.
For event-driven: Watermill or custom.
For workflows: Temporal.

---

## Closing Reference: A Pipeline Maturity Model

Where is your team on the maturity scale?

### Level 1: Ad hoc

- One-off pipelines per use case.
- Different patterns each time.
- Errors swallowed or panic.
- No monitoring.

### Level 2: Patterned

- Use `errgroup` consistently.
- Errors wrapped and propagated.
- Some metrics.
- Some logging.

### Level 3: Robust

- Standard pipeline framework.
- Defined error vocabulary.
- Comprehensive metrics, logs, traces.
- Tested failure paths.
- Runbooks.

### Level 4: Optimised

- SLO-driven design.
- Capacity planned.
- Bulkheads and circuit breakers.
- DLQ and replay.
- Postmortems and continuous improvement.

### Level 5: Self-healing

- Auto-scaling.
- Adaptive concurrency.
- Predictive failure detection.
- Auto-remediation for known issues.
- Chaos engineering routine.

Most teams are at level 2 or 3. Level 4 is the goal for production-critical systems. Level 5 is rare.

Movement up the levels is gradual. Each level requires investment that may not feel productive until an incident proves its worth.

---

## Closing Reference: Quick Diagnosis Cheat Sheet

When the pipeline alerts at 3 AM, check in order:

1. **Recent deploy?** Roll back.
2. **Dependency down?** Check dependency dashboard.
3. **Resource saturation?** Check CPU, memory, network.
4. **Bad input?** Check error categories.
5. **Cascade?** Check for retries amplifying load.

These five questions resolve 80% of incidents.

For the 20% that aren't routine:

- Capture goroutine dump.
- Capture metrics screenshot.
- Open detailed logs.
- Page another engineer.
- Don't panic.

Postmortem after. Improve the runbook.

---

## Closing Reference: One-Liners to Remember

Distilled wisdom from this series:

- "Errors are values. Treat them as data."
- "Cancellation is everyone's job."
- "Wrap errors. Don't lose the chain."
- "Sentinel for atomic. Type for structured. Opaque for everything else."
- "First-error fast. Aggregate slow. Choose deliberately."
- "Idempotency is non-negotiable for side effects."
- "Every compensator must be idempotent and order-independent."
- "Bound everything. Unbounded systems blow up."
- "Test failure paths. Happy paths are the cheap tests."
- "Design for operations. Code for years; operate for decades."

Stick these on a wall. Refer to them when reviewing designs.

---

## Closing Reference: The Goodbye

You've reached the end. Truly. The professional file is over.

The remaining files in this directory — specification, interview, tasks, find-bug, optimize — are reference and practice material. Use them to consolidate.

But the real learning is now: in production, on call, debugging at 3 AM, writing RFCs, reviewing PRs, mentoring juniors.

The journey from "first goroutine" to "designs distributed pipelines" takes years. You're somewhere on that journey. Wherever you are, keep going.

The work is worthwhile. The systems you build matter. The skills you develop will outlast any framework, any language, any company.

Be kind to yourself. Mistakes are how you learn. The senior engineer next to you has made every mistake you'll make, plus several you won't. Ask them. They want to help.

Then go build something. Make it work. Make it observable. Make it operable. Make it last.

Good luck.

---

## Bonus Chapter: A Deep Look at sync.ErrGroup Internals

To truly own this material, read the errgroup source. Here is a guided tour.

```go
// Package errgroup provides synchronization, error propagation, and Context
// cancelation for groups of goroutines working on subtasks of a common task.

package errgroup

import (
    "context"
    "fmt"
    "sync"
)

type token struct{}

// A Group is a collection of goroutines working on subtasks that are part of
// the same overall task.
//
// A zero Group is valid, has no limit on the number of active goroutines,
// and does not cancel on error.
type Group struct {
    cancel func(error)

    wg sync.WaitGroup

    sem chan token

    errOnce sync.Once
    err     error
}

func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}

// WithContext returns a new Group and an associated Context derived from ctx.
//
// The derived Context is canceled the first time a function passed to Go
// returns a non-nil error or the first time Wait returns, whichever occurs
// first.
func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := withCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

// Wait blocks until all function calls from the Go method have returned,
// then returns the first non-nil error (if any) from them.
func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}

// Go calls the given function in a new goroutine.
// It blocks until the new goroutine can be added without the number of
// active goroutines in the group exceeding the configured limit.
//
// The first call to return a non-nil error cancels the group's context, if the
// group was created by calling WithContext. The error will be returned by Wait.
func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
    }

    g.wg.Add(1)
    go func() {
        defer g.done()

        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}

// TryGo calls the given function in a new goroutine only if the number of
// active goroutines in the group is currently below the configured limit.
//
// The return value reports whether the goroutine was started.
func (g *Group) TryGo(f func() error) bool {
    if g.sem != nil {
        select {
        case g.sem <- token{}:
            // Note: this allows barging iff channels in general allow barging.
        default:
            return false
        }
    }

    g.wg.Add(1)
    go func() {
        defer g.done()

        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
    return true
}

// SetLimit limits the number of active goroutines in this group to at most n.
// A negative value indicates no limit.
//
// Any subsequent call to the Go method will block until it can add an active
// goroutine without exceeding the configured limit.
//
// The limit must not be modified while any goroutines in the group are active.
func (g *Group) SetLimit(n int) {
    if n < 0 {
        g.sem = nil
        return
    }
    if len(g.sem) != 0 {
        panic(fmt.Errorf("errgroup: modify limit while %v goroutines in the group are still active", len(g.sem)))
    }
    g.sem = make(chan token, n)
}
```

That is essentially the whole thing. About 100 lines. Worth re-reading.

### Key observations

1. **`token`**: a zero-byte struct used as a semaphore slot. No memory overhead.
2. **`sem`**: optional buffered channel. If nil, no limit. If set, capacity = limit.
3. **`errOnce`**: ensures only one goroutine writes to `g.err`.
4. **`cancel`**: stored as a `func(error)` since Go 1.20 introduced `context.WithCancelCause`.
5. **`done`**: factored so both `Go` and `TryGo` use the same release path.

### Subtleties

- `Wait` cancels even on success. This avoids leaking the goroutine started by `WithCancel` (which is otherwise garbage-collected eventually).
- `cancel(g.err)` passes the error as the cause. Callers can retrieve via `context.Cause(ctx)`.
- `errOnce` writes are visible to `Wait` because `wg.Done` synchronises (memory model).
- `SetLimit` panics if any goroutines are active (uses `len(g.sem)` to detect).

### Limitations

- No panic recovery.
- No per-task timeout (use child context).
- No prioritisation.
- Errors are first-wins (no aggregation built in).

For features beyond this, build on top.

---

## Bonus Chapter: A Working Code Connect

A full working example that demonstrates context propagation, cancellation, and error handling across realistic boundaries.

```go
package processing

import (
    "context"
    "database/sql"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "log/slog"
    "net/http"
    "runtime"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

// Public errors.
var (
    ErrInvalidPayload   = errors.New("invalid payload")
    ErrUpstreamDown     = errors.New("upstream down")
    ErrStorageFailed    = errors.New("storage failed")
    ErrNotificationFailed = errors.New("notification failed")
    ErrTransient        = errors.New("transient")
)

// Typed error with stage attribution.
type StageError struct {
    Stage string
    Err   error
}

func (e *StageError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }

// Config tunes the pipeline.
type Config struct {
    Workers       int
    APITimeout    time.Duration
    DBTimeout     time.Duration
    MaxRetries    int
    BatchSize     int
    QueueSize     int
}

// Default configuration suitable for production.
func DefaultConfig() Config {
    return Config{
        Workers:    runtime.NumCPU() * 2,
        APITimeout: 30 * time.Second,
        DBTimeout:  10 * time.Second,
        MaxRetries: 3,
        BatchSize:  100,
        QueueSize:  16,
    }
}

// Dependencies are external systems the pipeline talks to.
type Deps struct {
    UpstreamURL string
    DB          *sql.DB
    Notifier    Notifier
    Logger      *slog.Logger
}

// Notifier sends notifications about pipeline events.
type Notifier interface {
    Notify(ctx context.Context, kind string, data map[string]any) error
}

// Pipeline processes events from upstream into storage with notifications.
type Pipeline struct {
    cfg  Config
    deps Deps
}

// New creates a configured pipeline.
func New(cfg Config, deps Deps) *Pipeline {
    return &Pipeline{cfg: cfg, deps: deps}
}

// Result of a pipeline run.
type Result struct {
    ProcessedItems int
    FailedItems    int
    DroppedItems   int
    Duration       time.Duration
    Errors         []error
}

// Run executes the pipeline. Returns nil error on graceful completion,
// or an error categorised by the failure type.
//
// Cancellation via ctx is honored; the pipeline will exit promptly.
func (p *Pipeline) Run(ctx context.Context) (*Result, error) {
    start := time.Now()
    result := &Result{}

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(p.cfg.Workers)

    // Channels between stages.
    rawCh := make(chan json.RawMessage, p.cfg.QueueSize)
    parsedCh := make(chan ParsedEvent, p.cfg.QueueSize)
    storedCh := make(chan StoredEvent, p.cfg.QueueSize)

    // Stage 1: ingest from upstream.
    g.Go(func() error {
        return p.recoverPanic(ctx, "ingest", func() error {
            return p.ingest(ctx, rawCh)
        })
    })

    // Stage 2: parse.
    g.Go(func() error {
        return p.recoverPanic(ctx, "parse", func() error {
            return p.parse(ctx, rawCh, parsedCh, result)
        })
    })

    // Stage 3: store.
    g.Go(func() error {
        return p.recoverPanic(ctx, "store", func() error {
            return p.store(ctx, parsedCh, storedCh, result)
        })
    })

    // Stage 4: notify.
    g.Go(func() error {
        return p.recoverPanic(ctx, "notify", func() error {
            return p.notify(ctx, storedCh, result)
        })
    })

    err := g.Wait()
    result.Duration = time.Since(start)

    p.deps.Logger.Info("pipeline finished",
        "processed", result.ProcessedItems,
        "failed", result.FailedItems,
        "dropped", result.DroppedItems,
        "duration", result.Duration,
        "err", err)

    return result, err
}

// recoverPanic wraps a stage in a panic-to-error converter.
func (p *Pipeline) recoverPanic(ctx context.Context, stage string, fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<16)
            n := runtime.Stack(buf, false)
            err = &StageError{Stage: stage, Err: fmt.Errorf("panic: %v\n%s", r, buf[:n])}
            p.deps.Logger.Error("stage panic", "stage", stage, "value", r)
        }
    }()
    return fn()
}

func (p *Pipeline) ingest(ctx context.Context, out chan<- json.RawMessage) error {
    defer close(out)

    req, err := http.NewRequestWithContext(ctx, "GET", p.deps.UpstreamURL, nil)
    if err != nil {
        return &StageError{Stage: "ingest", Err: fmt.Errorf("build request: %w", err)}
    }

    client := &http.Client{Timeout: p.cfg.APITimeout}
    resp, err := client.Do(req)
    if err != nil {
        return &StageError{Stage: "ingest", Err: fmt.Errorf("%w: %w", ErrUpstreamDown, err)}
    }
    defer resp.Body.Close()

    if resp.StatusCode >= 500 {
        return &StageError{Stage: "ingest", Err: fmt.Errorf("%w: status %d", ErrUpstreamDown, resp.StatusCode)}
    }

    dec := json.NewDecoder(resp.Body)
    for dec.More() {
        var raw json.RawMessage
        if err := dec.Decode(&raw); err != nil {
            if errors.Is(err, io.EOF) { return nil }
            return &StageError{Stage: "ingest", Err: fmt.Errorf("decode: %w", err)}
        }
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- raw:
        }
    }
    return nil
}

type ParsedEvent struct {
    ID      string
    Type    string
    Payload []byte
}

func (p *Pipeline) parse(ctx context.Context, in <-chan json.RawMessage, out chan<- ParsedEvent, result *Result) error {
    defer close(out)

    var mu sync.Mutex
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(p.cfg.Workers)

    for raw := range in {
        raw := raw
        g.Go(func() error {
            var ev ParsedEvent
            if err := json.Unmarshal(raw, &ev); err != nil {
                mu.Lock()
                result.DroppedItems++
                result.Errors = append(result.Errors, fmt.Errorf("%w: %v", ErrInvalidPayload, err))
                mu.Unlock()
                return nil // do not propagate; record and continue
            }
            if ev.ID == "" {
                mu.Lock()
                result.DroppedItems++
                mu.Unlock()
                return nil
            }
            select {
            case <-gctx.Done(): return gctx.Err()
            case out <- ev:
            }
            return nil
        })
    }

    return g.Wait()
}

type StoredEvent struct {
    ID   string
    Type string
}

func (p *Pipeline) store(ctx context.Context, in <-chan ParsedEvent, out chan<- StoredEvent, result *Result) error {
    defer close(out)

    var mu sync.Mutex
    for ev := range in {
        if err := p.storeWithRetry(ctx, ev); err != nil {
            mu.Lock()
            result.FailedItems++
            result.Errors = append(result.Errors, &StageError{Stage: "store", Err: err})
            mu.Unlock()
            if errors.Is(err, ErrStorageFailed) {
                return err // fatal
            }
            continue
        }
        mu.Lock()
        result.ProcessedItems++
        mu.Unlock()
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- StoredEvent{ID: ev.ID, Type: ev.Type}:
        }
    }
    return nil
}

func (p *Pipeline) storeWithRetry(ctx context.Context, ev ParsedEvent) error {
    var lastErr error
    for attempt := 0; attempt < p.cfg.MaxRetries; attempt++ {
        cctx, cancel := context.WithTimeout(ctx, p.cfg.DBTimeout)
        _, err := p.deps.DB.ExecContext(cctx,
            "INSERT INTO events (id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
            ev.ID, ev.Type, ev.Payload)
        cancel()

        if err == nil { return nil }
        if !isTransient(err) {
            return fmt.Errorf("%w: %v", ErrStorageFailed, err)
        }
        lastErr = err
        wait := time.Duration(1<<attempt) * 200 * time.Millisecond
        select {
        case <-ctx.Done(): return ctx.Err()
        case <-time.After(wait):
        }
    }
    return fmt.Errorf("%w after %d attempts: %v", ErrTransient, p.cfg.MaxRetries, lastErr)
}

func (p *Pipeline) notify(ctx context.Context, in <-chan StoredEvent, result *Result) error {
    for ev := range in {
        err := p.deps.Notifier.Notify(ctx, "event_stored", map[string]any{
            "id":   ev.ID,
            "type": ev.Type,
        })
        if err != nil {
            // notifications are best-effort; log but don't fail
            p.deps.Logger.Warn("notify failed", "id", ev.ID, "err", err)
        }
    }
    return nil
}

func isTransient(err error) bool {
    // simplified
    return errors.Is(err, context.DeadlineExceeded) ||
        errors.Is(err, ErrTransient)
}
```

This single Go file demonstrates:

- Pipeline orchestrator with errgroup.
- Multiple stages: ingest, parse, store, notify.
- Per-stage panic recovery.
- Internal fan-out in parse stage.
- Per-item retry in store stage.
- Best-effort notification.
- Aggregation of dropped/failed items.
- Sentinel errors and typed errors.
- Context cancellation throughout.
- Structured logging.

It's about 250 lines. Production code would have tests, dependency injection details, configuration loading, but the core is what you see here.

---

## A Final Code Recap

Throughout these four files, we've shown:

- The 20-line errgroup skeleton.
- Per-tenant isolation pipelines.
- ETL with aggregation and rollback.
- A complete saga coordinator.
- A panic-safe pipeline.
- A circuit-breaker-wrapped dependency.
- A webhook fan-out with retry.
- A payment processing system.

Each example built on the previous. Each demonstrated additional concepts.

Re-read them. Compile them. Modify them. Break them. Each modification teaches something.

The code is the curriculum.

---

## Truly Final Words

If you've reached here, you've read 200+ pages of pipeline material. Take a moment.

Then close the file. Open a terminal. Write a tiny pipeline. Run it. Break it on purpose. Fix it.

That moment — writing code that works after understanding the patterns — is when learning becomes real.

The next time you write `errgroup.WithContext`, you'll know what's happening, why, and where the failure modes lurk. That knowledge separates the engineers who write robust pipelines from those who write fragile ones.

Be one of the former. Build the pipelines. Operate them. Improve them.

Years from now, you'll write a pipeline that handles a billion items, recovers gracefully from outages, and lets your colleagues sleep through alerts.

That's the goal.

End of professional level. End of the series.
