---
layout: default
title: Senior
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/senior/
---

# Batching — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture: Where Batching Lives in the Stack](#architecture-where-batching-lives-in-the-stack)
3. [Latency Budgeting](#latency-budgeting)
4. [Adaptive Batch Sizing](#adaptive-batch-sizing)
5. [Multi-Tenant Fairness](#multi-tenant-fairness)
6. [Backpressure Composition at the System Level](#backpressure-composition-at-the-system-level)
7. [The Drain Pattern and Batching](#the-drain-pattern-and-batching)
8. [Choosing Between Application and Library Batching](#choosing-between-application-and-library-batching)
9. [Compositional Patterns](#compositional-patterns)
10. [Capacity Planning](#capacity-planning)
11. [Reliability Engineering](#reliability-engineering)
12. [Cost Engineering](#cost-engineering)
13. [Security and Compliance](#security-and-compliance)
14. [Migration and Versioning](#migration-and-versioning)
15. [Anti-Patterns](#anti-patterns)
16. [Case Studies](#case-studies)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

The middle level taught you to build a production-ready batcher: graceful shutdown, retries, metrics, real sinks. The senior level steps back and asks the architectural questions: where does the batcher *live* in the system, what *latency budget* does it own, how does it *fair-share* between tenants, how does it *compose* with backpressure and dynamic worker scaling at the service boundary, what is the *cost* of a batcher being saturated versus a sink being slow?

A senior engineer thinks beyond the batcher itself. They think about:

- Why this code uses a batcher at all, given upstream is already buffered in Kafka.
- What guarantees the batcher makes that the upstream relies on (or doesn't).
- How adding a 100 ms `MaxBatchDelay` interacts with downstream SLOs.
- What happens when 50 batchers across the fleet all hit a slow downstream simultaneously.
- Whether the batcher's metrics, alerts, and runbooks are sufficient to debug at 3 AM.

After this file you will be able to:

- Place batchers correctly in an end-to-end system, knowing what each tier is for.
- Compute a latency budget that includes batching contribution and verify it against SLOs.
- Implement and tune adaptive batch sizing.
- Design multi-tenant fairness without breaking amortisation.
- Compose batchers with backpressure, drain, and dynamic scaling.
- Choose between application-level and client-library batching.
- Estimate capacity and cost.
- Conduct a security review of a batcher in the audit-log context.
- Migrate from synchronous writes to batched writes safely.

You should have absorbed middle.md and have a batcher running in production (or its equivalent in a test environment). Senior reading is most useful when you have a real system to anchor it to.

---

## Architecture: Where Batching Lives in the Stack

A modern service architecture typically has multiple batching tiers:

```
client
  |
  v
LB / API gateway --[ ingress batching? ]--+
  |                                       |
  v                                       v
HTTP handler                          metrics/logs
  |                                       |
  v                                       v
in-process batcher --[ to Postgres ]      batcher --[ to remote write ]
  |                                       |
  v                                       v
Postgres (group commit)              Prometheus
  |
  v
CDC outbox --[ to Kafka ]
  |
  v
Kafka client (linger.ms)
  |
  v
Kafka broker (group fsync)
```

Each tier amortises something different:

- **HTTP gateway batching**: rare; not standard. Some special cases use it.
- **In-process batcher to Postgres**: amortises connection and parse cost.
- **Postgres group commit**: amortises WAL fsync cost (`commit_delay`, `commit_siblings`).
- **CDC outbox**: amortises Kafka producer cost.
- **Kafka client linger**: amortises broker round-trip.
- **Kafka broker group fsync**: amortises disk write cost.

The pipeline has 4-5 batching stages. Each adds latency; each amortises. The art is choosing which stages to add, which to skip, and how to size each.

### Where to Add a Batcher

Add a batcher when:

- The downstream's per-call cost dominates per-item cost (the cost-per-call model).
- The downstream has its own batching but the upstream pattern (1 item per call) does not engage it.
- You have multiple producers feeding one downstream and want shared amortisation.

Do not add a batcher when:

- The downstream already batches effectively (Kafka with linger).
- The pipeline already has a batching stage upstream of you.
- The marginal throughput improvement is < 2x.

### Where Not to Add a Batcher

A common over-engineering pattern: adding batchers everywhere, including between stages that do not benefit. Each stage adds latency and shutdown complexity. A 5-stage pipeline with 100 ms per stage is 500 ms of latency floor.

Example: a service that reads from Kafka and writes to Postgres. Kafka delivers in batches already (consumer pulls a batch at a time). The application processes each item, writing to Postgres. Adding an application-level batcher between processing and Postgres makes sense if each item is one Postgres call. Adding a batcher between Kafka and processing does not — the Kafka client already batched.

### Service-to-Service Batching

Between microservices, batching is rarer. The upstream service makes one call per business event; batching at the caller adds latency to the *user-visible* path. Batching at the *callee* (server-side) is OK if it does not delay the response.

A pattern: the upstream sends events to an "ingestion" service via per-event RPC. The ingestion service batches and writes downstream. The upstream gets fast acknowledgements (just "I queued it"); the ingestion service absorbs the latency.

---

## Latency Budgeting

Every operation has a latency budget. Document it.

### The Budget Sheet

For a `POST /event` endpoint with a 100 ms p99 SLO, the budget might look like:

| Stage | Budget (p99) |
|-------|-------------:|
| TLS handshake (amortised) | 0 ms (keep-alive) |
| Routing | 1 ms |
| Auth (cached) | 2 ms |
| Validation | 1 ms |
| Batcher Add (channel send) | 1 ms |
| Response serialisation | 1 ms |
| Network return | 5 ms |
| **Total** | **11 ms** |
| **SLO** | **100 ms** |
| **Headroom** | **89 ms** |

The 89 ms headroom is for tail latency, GC pauses, and unforeseen slowdowns.

Now: the *batcher's* contribution to *end-to-end durability* of the event:

| Stage | Budget |
|-------|-------:|
| Add to batcher | 1 ms |
| Wait in input channel | up to 50 ms |
| Wait in buffer (until trigger) | up to MaxBatchDelay = 200 ms |
| Flush call | up to FlushTimeout = 5 s |
| **Total** | **~5.25 s** |

That is the time from `Add` to "event durable in Postgres". It is *not* the same as the HTTP latency — the HTTP response is sent immediately after `Add`. But it is the latency for "if Postgres goes down right now, how long is data at risk".

Document both. Engineering teams routinely confuse "API latency" with "durability latency" and over- or under-engineer one of them.

### Tail Latency

p99 latency dominates user perception. A batcher that has 5 ms p50 and 5 s p99 is broken from the user's standpoint, even though the average looks fine. Always emit histograms; always set alerts on p99.

### Composition Across Stages

End-to-end p99 is not the sum of stage p99s. The correct formula depends on dependencies, but a useful approximation:

```
p99_end_to_end ≈ sum(p99_stage_i) + some_extra
```

The "extra" comes from cross-stage interactions: a slow stage backs up its upstream, causing the upstream's queue depth to rise and its p99 to grow. Cascading slowdowns make end-to-end p99 worse than the sum.

To bound this, *each stage's queue depth must be bounded*, and *each stage's flush latency must be bounded by a per-flush timeout*. Without those, one slow stage can take down the whole pipeline.

---

## Adaptive Batch Sizing

Static `MaxBatchSize` works when traffic is steady. When it is variable, an adaptive sizer can win.

### The Control Loop

```go
type AdaptiveSizer struct {
    current      int
    min, max     int
    history      []Sample
    targetUtil   float64 // e.g., 0.8 (80% full)
    targetLatency time.Duration
}

type Sample struct {
    size     int
    duration time.Duration
    reason   string
    err      error
}

func (a *AdaptiveSizer) Record(s Sample) {
    a.history = append(a.history, s)
    if len(a.history) > 100 {
        a.history = a.history[1:]
    }
}

func (a *AdaptiveSizer) Recommend() int {
    if len(a.history) < 10 {
        return a.current
    }
    var totalSize, errCount int
    var totalDur time.Duration
    for _, s := range a.history {
        totalSize += s.size
        totalDur += s.duration
        if s.err != nil {
            errCount++
        }
    }
    avgSize := float64(totalSize) / float64(len(a.history))
    avgDur := totalDur / time.Duration(len(a.history))
    if errCount > len(a.history)/4 {
        // Too many errors; shrink fast.
        return max(a.min, a.current/2)
    }
    util := avgSize / float64(a.current)
    if util > a.targetUtil && avgDur < a.targetLatency {
        // Full and fast; grow.
        return min(a.max, a.current+a.current/4)
    }
    if util < a.targetUtil/2 || avgDur > a.targetLatency {
        // Empty or slow; shrink.
        return max(a.min, a.current-a.current/8)
    }
    return a.current
}
```

Run `Recommend()` every few seconds, replace `MaxBatchSize`. The batcher's run loop reads `MaxBatchSize` atomically (or with a mutex) on every iteration.

### What to Adapt On

- Average batch size (fullness).
- Average flush duration.
- Error rate.
- Sink-reported throttle signals.
- Queue depth (high = scale up; low = scale down).

### Pitfalls

- **Oscillation**: aggressive controller swings size up and down. Add hysteresis or a long observation window.
- **Trapped in local minimum**: if the sink fails at small sizes (because the test sample size is too small to be representative), the controller never tries larger sizes. Periodic "exploration" helps.
- **Cold start**: at startup, the controller has no history. Start at a safe default.
- **Two batchers adapting independently**: if two batchers see the same downstream, they may adapt in opposition. Coordinate via a shared state or share a single sink.

### When NOT to Adapt

If traffic is steady and the downstream is reliable, static sizing is simpler and just as good. Adaptive sizing is for variable-traffic, variable-downstream cases.

---

## Multi-Tenant Fairness

A single shared batcher mixes items from many tenants. Fairness becomes a question.

### The Problem

Tenant A sends 10000 items per second. Tenant B sends 1 item per second.

In a shared batcher with `MaxBatchSize = 500`, every batch is almost all A's items. B's one item per second sits in the buffer until the time trigger fires.

Worse: if A's items occasionally cause sink failures (e.g., a constraint violation), B's items in the same batch fail too. A's bad data poisons B's good data.

### Solutions

#### 1. Per-Tenant Sub-Batcher

One buffer per tenant; flush each independently. Covered in middle.md.

Trade-off: more state, more flush calls, less amortisation.

#### 2. Per-Tenant Quotas in a Shared Batcher

Limit each tenant's items per batch:

```go
func (b *Batcher) flushQuotaAware(buf []Item) {
    perTenant := map[string][]Item{}
    overflow := []Item{}
    for _, item := range buf {
        if len(perTenant[item.Tenant]) < b.perTenantQuota {
            perTenant[item.Tenant] = append(perTenant[item.Tenant], item)
        } else {
            overflow = append(overflow, item)
        }
    }
    // Flush per-tenant batches.
    // Push overflow back into the buffer for the next round.
}
```

This is more complex than per-tenant sub-batchers and rarely worth it.

#### 3. Per-Sink Splitting

If different tenants go to different sinks (different Postgres schemas, different Kafka topics), per-sink batchers are the natural unit. Each batcher is one tenant or one shard.

#### 4. Weighted Fair Queueing

In the input channel, dequeue items with priority weighted by tenant. Tenants with high QoS get fast lanes. Implemented via heap or per-tenant channels.

### Memory Bounds for Multi-Tenant

With per-tenant buffers, memory worst-case is `numTenants * MaxBatchSize`. For 1000 tenants and 500-item batches, that is 500K items in RAM. Decide an aggregate cap.

Strategies:

- **Eager flush on memory pressure**: when total items > threshold, force-flush the tenant with the largest buffer.
- **Per-tenant memory caps**: refuse items from tenants over their quota.
- **Tenant grouping**: combine low-volume tenants into "shared" batchers.

### Isolation vs Amortisation

There is a fundamental trade-off. Strict per-tenant isolation maximises fairness but minimises amortisation. Strict shared batching maximises amortisation but minimises fairness. The right point depends on the system.

A practical heuristic: shared batcher when items/tenant are similar; per-tenant when items/tenant vary 10x or more.

---

## Backpressure Composition at the System Level

In a service with multiple layers, backpressure flows up. A batcher's input channel filling is one signal. How it composes with the layers above and below matters.

### Stack Backpressure

```
HTTP handler  --[ Add ]-->  batcher  --[ Write ]-->  sink
                channel               flush queue
```

When the sink is slow:

1. `Write` blocks longer.
2. The batcher's run loop is busy in `Write` more often.
3. The input channel fills.
4. `Add` blocks.
5. The HTTP handler blocks in `Add`.
6. The handler's response is delayed.
7. The client's request is delayed.
8. The client's queue (if any) fills.

Each step propagates the signal. The question is *where* in the chain you absorb the pressure.

### Absorbing at the Edge

The earliest absorption is at the HTTP handler:

```go
ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
defer cancel()
if err := batcher.Add(ctx, item); err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        return 503
    }
}
```

When the batcher is full, the handler returns 503 with `Retry-After`. The client retries with backoff. The pressure stays on the client; the server stays responsive.

This is the right answer for most HTTP services.

### Absorbing Internally

For background work that has no user-facing latency, absorb internally:

```go
// Block until enqueued, no timeout.
batcher.Add(context.Background(), item)
```

The producer (e.g., a CDC consumer) blocks. That backs up the consumer offset commit. Kafka's lag metric rises. An operator notices and scales the service.

### The Wrong Answer: Unbounded Queueing

```go
in: make(chan Item, math.MaxInt32)
```

The channel never blocks. Memory grows until OOM. The system "works" for a while, then crashes catastrophically.

Always bound the queue. Make backpressure visible.

### Cross-Service Backpressure

If service A calls service B which has a batcher: A's call to B blocks while B's batcher is full. A's backpressure surfaces at A's `b.Add` call. A may then propagate further up.

This is fine *if* A has its own backpressure handling. If not, the chain breaks at the slowest link.

End-to-end: every stage must bound its queue and propagate backpressure to its caller. Skipping a stage breaks the chain.

---

## The Drain Pattern and Batching

The drain pattern (covered in `05-drain-pattern`) is the broader generalisation of "what to do with in-flight work on shutdown". A batcher's `Shutdown(ctx)` is a specialisation.

### Drain Composition

A typical service has multiple drain stages:

1. Stop accepting new HTTP requests (`srv.Shutdown`).
2. Wait for in-flight handlers to complete (`srv.Shutdown` also handles this).
3. Drain the batcher (`b.Shutdown(ctx)`).
4. Close the sink (`db.Close()`).
5. Exit.

Each stage has a sub-deadline. The total deadline is the orchestrator's overall timeout. Allocate sub-deadlines based on expected duration:

```go
total := 30 * time.Second
httpDeadline := total / 2 // 15 s
batcherDeadline := total / 4 // 7.5 s
sinkDeadline := total / 4 // 7.5 s
```

In code:

```go
ctx, cancel := context.WithTimeout(context.Background(), total)
defer cancel()

httpCtx, _ := context.WithTimeout(ctx, httpDeadline)
srv.Shutdown(httpCtx)

batcherCtx, _ := context.WithTimeout(ctx, batcherDeadline)
b.Shutdown(batcherCtx)

sinkCtx, _ := context.WithTimeout(ctx, sinkDeadline)
db.Close() // db.Close does not take ctx; we rely on the outer ctx
```

### Drain SLA

What does "drained" mean for your service?

- **Strong drain**: every item that was `Add`-ed before SIGTERM is durable. Requires bounded buffer, deadline reached.
- **Weak drain**: best effort; some items may be lost on timeout.
- **No drain**: items in buffer are lost. Acceptable for some metrics-class data.

Document which. The SLA goes into your runbook and capacity plan.

### When Drain Is Impossible

Some shutdowns are not drains: SIGKILL, OOM kill, kernel panic. In these cases the buffer is unconditionally lost.

Defense: minimise the at-risk window. A 100 ms `MaxBatchDelay` puts at most ~100 ms of data at risk on hard kill. A 1 hour `MaxBatchDelay` puts up to 1 hour at risk. Choose based on the value of the data.

For high-value data: persist outside the process (Kafka, on-disk WAL). The batcher is then just an amortisation layer, not a durability boundary.

---

## Choosing Between Application and Library Batching

Many client libraries batch internally:

- Kafka producers (linger.ms + batch.size).
- AWS SDK (BatchWriteItem, BatchPutItem).
- librdkafka.
- pgx (CopyFrom is already a "batch" in one call).

When to use the library's batching vs your own:

### Use the library's when:

- The library's batching is well-tested and the defaults are reasonable.
- You do not need to combine/transform items.
- You do not need to feed the *same* batch to multiple sinks.
- Your code path is naturally one-call-per-item; the library batches behind the scenes.

### Use your own when:

- You need to combine items (combiner pattern).
- You need a shared latency budget across multiple sinks.
- You need per-tenant batching.
- The library's batching is poorly tested or has known bugs.
- You need stronger observability than the library provides.

### Double Batching

Combining your own batcher with a library's batcher (e.g., your app batches 100 items, hands them to Kafka producer which itself batches into 1000-record requests) is sometimes useful but often wasteful.

If the library's batcher is doing what you want, do not duplicate it.

### Configuring the Library's Batcher

For Kafka producers:

- `linger.ms`: 5-50 ms typical.
- `batch.size`: 16-64 KB.
- `compression.type`: gzip or zstd for any non-trivial payload.
- `acks`: `all` for durability.

For AWS SDK:

- Use `BatchWriteItem` (up to 25 items per call).
- Wrap in a retry layer for unprocessed items.

For pgx:

- `CopyFrom` for 500+ rows.
- Multi-row INSERT for smaller batches with ON CONFLICT.

---

## Compositional Patterns

A batcher composes with other concurrency patterns. Some common compositions.

### Batcher + Worker Pool

A worker pool of batchers: each worker has its own buffer; items are sharded to workers.

```
producers
   |
   v
[hash(key) % numWorkers]
   |     |     |
   v     v     v
worker  worker  worker
(batcher)(batcher)(batcher)
   |     |     |
   v     v     v
        sink
```

Use case: high-throughput sinks where shard-key ordering is preserved.

### Batcher + Circuit Breaker

The sink is wrapped in a circuit breaker. When open, flushes fail immediately (without touching the sink). The batcher's retry logic falls back to DLQ.

```go
sink := NewCircuitSink(NewRetryingSink(NewPGSink(pool, ...)))
```

### Batcher + Rate Limiter

If the sink has a rate limit, throttle flushes:

```go
func (s *RateLimitedSink) Write(ctx context.Context, batch []Item) error {
    if err := s.limiter.Wait(ctx); err != nil {
        return err
    }
    return s.inner.Write(ctx, batch)
}
```

The batcher's flush latency now includes wait time.

### Batcher + Bulkhead

Isolate batchers per workload class. A batcher for high-priority items is separate from a batcher for low-priority items, with separate sink connection pools. A slowdown in one does not starve the other.

### Batcher + Saga

For distributed transactions: batches are part of a saga. If the batcher fails its step, a compensating action rolls back upstream. Rare and complex; usually outbox + CDC is preferred.

---

## Capacity Planning

How big a batcher, how many of them, how much CPU and memory?

### CPU

A single batcher's run loop is cheap: ~1 microsecond per iteration. At 100K items/s and `MaxBatchSize = 100`, that is 1K flushes/s = 1 ms of CPU per second. Negligible.

The sink's work is the CPU cost: serialisation, compression, encryption. Profile.

### Memory

`(QueueDepth + MaxBatchSize * (1 + concurrentFlushes)) * sizeof(Item)`.

For 8 KB items and typical config: ~30 MB. For 1 MB items, ~5 GB. Decide which.

### Goroutines

A simple batcher: 1 goroutine. A pipeline batcher: 1 + numFlushers. A worker-pool of batchers: numWorkers * (1 + flushers).

Even a service with 100 batchers has fewer than 1000 goroutines for the batching layer. Goroutines are not the bottleneck.

### Headroom

Plan for 2x peak. If steady peak is 100K items/s with a 100 ms latency budget, the system must sustain 200K items/s without breaking the SLO. Test it.

### Failure Modes

- Sink down: backpressure to producers. Verify producers respond gracefully.
- Half-broken sink: high latency, some success. Verify retries do not amplify.
- Slow consumer (downstream of the sink): backpressure on the sink's own queue (e.g., Kafka broker disk full).
- Network partition: timeouts everywhere; flush failures.

For each, decide the policy and verify with chaos testing.

---

## Reliability Engineering

### SLOs

A batcher's SLOs:

- **Throughput SLO**: items per second sustained, at p99 batch latency below threshold.
- **Durability SLO**: items lost per million on clean shutdown.
- **Crash durability**: items lost per million on hard kill. Inherent function of `MaxBatchDelay`.
- **Availability**: fraction of time the batcher is accepting new items.

### Error Budgets

Allow some loss in exchange for development velocity. If your SLO is "0.001% loss on hard kill", that is 100 items per million. At 1M items/day, that is 100/day. If a deploy could lose 100 items, that costs ~1 hour of error budget.

This calculation lets you decide whether shorter `MaxBatchDelay` (less loss, more cost) or longer (more loss, more throughput) is worth it.

### Chaos Testing

In staging: kill the batcher process at random times. Verify the loss is within budget. Verify the upstream replays missing items.

Inject latency: make the sink slow for 10 minutes. Verify backpressure surfaces correctly and producers respond with 503s, not infinite buffering.

Inject errors: make 10% of flushes fail. Verify retries work and DLQ accumulates non-transient errors.

### Recovery Plays

- Drain the DLQ. Have a tool that replays DLQ items into the batcher or directly into the sink.
- Restart-loop recovery. If the batcher keeps crashing, can the upstream re-buffer until the batcher recovers?
- Manual flush via admin endpoint. If a checkpoint is needed, force a flush.

---

## Cost Engineering

Batching is the largest "free" performance win in distributed systems. But it has costs:

- **Latency cost**: documented in the budget.
- **Memory cost**: items in transit.
- **CPU cost**: serialisation, copy.
- **Complexity cost**: more code paths, more failure modes.

### When to NOT optimise

If your service handles 100 items per minute, batching saves you a few CPU cycles. Not worth the complexity. Pay the per-item cost and move on.

### When to over-optimise

If your service handles 1 million items per second and the sink is the bottleneck, every percent of batch fill rate matters. Adaptive sizing, NUMA-aware batching, lock-free queues — all in play.

### Sensitivity Analysis

When in doubt, compute: "if I cut my flush rate in half, how many fewer database connections do I need? How many fewer Kafka brokers? What does that save per month?"

Often, batching pays for itself in infrastructure cost within weeks.

---

## Security and Compliance

### Audit Trail

If items are audit logs, the batcher is in the security path. Considerations:

- **Loss**: a missing audit log is a compliance violation. Drain SLA must be tight; durability must be high.
- **Tampering**: items in the buffer are mutable. If integrity matters, hash each item on `Add` and verify in the sink.
- **Confidentiality**: items in memory longer than necessary. Zero on flush if they contain secrets.

### Data Residency

Batches that mix tenants from different regions can violate data residency. Use per-region batchers.

### Encryption

Items at rest (in the buffer, even briefly) are in memory. If your threat model includes memory dumps, encrypt at rest.

Items in transit (flush call): use TLS for network sinks. For local sinks (Unix socket to a sidecar), authentication on the socket.

### Access Control

The batcher's admin endpoints (flush, stats) need authorisation. Otherwise an unauthenticated user can trigger flushes and DoS the downstream.

---

## Migration and Versioning

### Adding a Batcher to an Existing Service

The 10-step migration from middle.md applies. At the senior level, the additional concerns:

- **Rollback plan**: if the batcher behaves badly, can you switch back to unbatched in seconds? Feature flag for the batcher.
- **A/B test**: ramp the batcher to 10% of traffic, observe, then 50%, then 100%.
- **Forward compatibility**: items in the buffer at deploy time are in the *old* version's format. The new version reads them. Make item types versioned.

### Removing a Batcher

Removing is rare but happens (e.g., the sink got fast enough that batching is no longer worth it). Reverse migration: phase the batcher out by switching to direct writes for a small fraction first.

### Versioning Item Types

```go
type AuditEvent struct {
    Version int
    // ...
}
```

If the batcher is restarted with a new code version, items in the buffer may be partially deserialised. Test that.

For on-disk buffers (rare but real): version your format.

---

## Anti-Patterns

### The Forever Buffer

A batcher with `MaxBatchSize = 1000000` and `MaxBatchDelay = 1 hour`. Looks like it works in tests; loses everything on crash.

### The Surrogate Worker Pool

Using a batcher as a fake worker pool: spawn 100 batchers with `MaxBatchSize = 1` and call it parallelism. Use a real worker pool instead.

### The Synchronous Write Wrapping

A batcher whose `Add` blocks until the item is flushed. That defeats the purpose; you have an async API with sync semantics. Use a worker pool with a `done` channel instead.

### The Hand-Rolled Reinvention

Building a batcher when the client library already batches. Read the library docs first.

### The Untimed Flush

A flush with `context.Background()` that hangs forever on a slow sink. Always `WithTimeout`.

### The Cryptic Reason Label

`flushReason = "auto"` instead of `"size"|"time"|"shutdown"`. Future-debugger curses you.

### The Per-Tenant Channel Explosion

Allocating one channel per tenant in a multi-tenant system with millions of tenants. Goroutines and channels are cheap but not free; aggregate small tenants.

### The Concurrent Flush Without Ordering Story

Multiple flush workers writing to an ordered sink without sequencing. Random data corruption follows.

### The Silent Drop

`select { case b.in <- item: ; default: }` without metric. Items vanish, no one knows.

---

## A Note on Documentation Discipline

Documentation is the senior engineer's tool. A few principles:

### Document the Why, Not the What

Bad: "MaxBatchSize is 500."
Good: "MaxBatchSize is 500 because measurements showed throughput knee at 600; we chose 500 with 20% safety margin."

The "what" is in the code; the "why" is in the docs.

### Decision Records

Each significant choice becomes a Decision Record. See earlier section. Future engineers consult them.

### Runbooks

Every alert points to a runbook. Each runbook has:
- Symptom.
- Diagnosis steps.
- Mitigation steps.
- Root cause investigation.

A runbook that has never been used is suspect.

### Architecture Diagrams

One per service. Includes:
- Components.
- Data flow.
- External dependencies.
- Failure modes.

Keep them up to date. Stale diagrams mislead.

### Code Comments

Comment the non-obvious. Skip the obvious.

Bad: `i++ // increment i`
Good: `// We retry up to 3 times; beyond, the DLQ catches permanent errors.`

### README

Each repo has a README that explains:
- What the service does.
- How to run it locally.
- How to deploy.
- How to operate.

Without this, onboarding is painful.

## A Deeper Look at Capacity Math

For a batcher with a peak rate, compute resources:

### Throughput

Peak: P events/s.
Sustainable: S events/s. Plan for P; provision for 2P.

### Concurrent Flushes

Sink call latency: L ms.
Concurrent flushes needed: (P * L) / (MaxBatchSize * 1000).

Example: P=10K, L=20ms, MaxBatchSize=100. Need 2 concurrent flushes minimum. With safety: 4.

### Pool Size

DB connection pool: 2x concurrent flushes (for headroom).

### Memory

Per batcher: QueueDepth * sizeOf(Item) + MaxBatchSize * sizeOf(Item) + flush_in_flight * MaxBatchSize * sizeOf(Item).

For 1 KB items, QueueDepth=8K, MaxBatchSize=100, flushers=4: 8 MB + 100 KB + 400 KB = ~9 MB.

Negligible.

### CPU

Batcher overhead: ~100 ns per item.
At 10K events/s: 1 ms/s of CPU. ~0.1% of one core.

Sink CPU (serialisation, network): much more. Profile.

### Network

If sink is remote: bandwidth = average batch size * batches/s.

For 1 KB items, batches of 100, 100 batches/s: 10 MB/s. Manageable.

Cross-DC: $0.02-0.10 / GB. 10 MB/s * 30 days = ~2.5 TB. $50-250/month.

### Roll-Up

For a typical setup:

| Resource | Per Batcher | Per Service (10 batchers) |
|----------|------------:|-------------------------:|
| CPU | 0.1 core | 1 core |
| Memory | 10 MB | 100 MB |
| Connections | 8 | 80 |
| Bandwidth | 10 MB/s | 100 MB/s |

Plan accordingly. Provision 2x for safety.

## A Deeper Look at Latency Budgeting Across Stages

End-to-end latency in a multi-stage system:

```
client -> [API gateway] -> [auth] -> [event handler] -> [batcher] -> [DB]
```

Each stage has a budget. Total = sum of stage budgets + interactions.

### Stage Budgets

For 100 ms SLO:

- API gateway: 5 ms.
- Auth: 5 ms.
- Event handler: 5 ms.
- Batcher add: 1 ms.
- DB: 20 ms (durability).
- Interactions (cross-stage variance): 10 ms.
- Headroom: 54 ms.

But: durability latency (Add to flushedOK) is *not* in the API path. The API returns 202 after Add. Durability is a separate budget.

### Durability Budget

For 1 second durability SLO:

- Add: 1 ms.
- Queue wait: 100 ms (worst case).
- Buffer wait: 100 ms (worst case, MaxBatchDelay).
- Flush: 100 ms (p99 sink).
- Total: 301 ms p99.

Comfortable below 1 s. Adjust if SLO tightens.

### Why Both Budgets

API budget: user experience. Affects perception, conversion, retention.

Durability budget: data integrity. Affects compliance, recovery.

A senior engineer documents both. Trade-offs may apply different ways to each.

## A Deeper Look at Multi-Tenant Fairness

Multi-tenant systems must balance fairness and amortisation.

### The Fairness Problem

Tenant A produces 10K events/s. Tenant B produces 100 events/s.

In a shared batcher: every batch is mostly A's items. B's events sit longer.

In per-tenant batchers: B's batches are tiny; per-call amortisation lost.

### The Spectrum

Three approaches:

1. **Shared with no fairness**: amortisation max, fairness zero.
2. **Shared with quotas**: limit each tenant per batch.
3. **Per-tenant**: full fairness, low amortisation.

### Real-World Choice

Most production systems pick between 2 and 3, depending on:

- Number of tenants. > 1000? Shared with quotas. < 10? Per-tenant.
- Sink isolation requirement. Strong? Per-tenant. Weak? Shared.
- Cost of cross-tenant failure. High? Per-tenant. Low? Shared.

### Implementing Quotas

```go
type quotaBatcher struct {
    quotas map[string]int // per-tenant max items per batch
}

func (q *quotaBatcher) flush(buf []Item) {
    perTenant := map[string][]Item{}
    leftover := []Item{}
    for _, item := range buf {
        if len(perTenant[item.Tenant]) < q.quotas[item.Tenant] {
            perTenant[item.Tenant] = append(perTenant[item.Tenant], item)
        } else {
            leftover = append(leftover, item)
        }
    }
    for _, tenantBatch := range perTenant {
        q.sink.Write(ctx, tenantBatch)
    }
    // Push leftover back to buffer for next round.
}
```

This is a simplification; production code adds overflow handling, prioritisation.

## A Deeper Look at Adaptive Sizing in Production

Earlier we discussed adaptive sizing. Some production lessons:

### Lesson 1: Oscillation

A simple controller that grows on "fill rate > 80%" and shrinks on "fill rate < 50%" can oscillate.

Trigger: fill rate hits 81%; controller grows. Now batches are larger; latency per flush is higher; fill rate drops to 60% (still in band). Steady.

But: traffic burst pushes fill rate to 90%; grow again. Then burst ends; fill rate drops to 40%; shrink. Oscillation.

Fix: longer observation window. Average fill rate over 10 minutes, not 1.

### Lesson 2: Cold Start

At startup, controller has no history. Starts at the configured default.

If default is wrong (e.g., 100 when knee is 1000), the controller slowly grows. May take hours to settle.

Fix: aggressive cold-start phase. Grow 2x per minute until knee or fill rate < 70%.

### Lesson 3: Multi-Variable

Adaptive sizing affects `MaxBatchSize`. But the optimal `MaxBatchSize` depends on:
- Arrival rate.
- Sink latency.
- Sink throughput cap.
- Cost of failure.

Single-variable controllers are blind to most of these. Real adaptive systems use ML or domain-specific heuristics.

### Lesson 4: Stability

A system with adaptive sizing is harder to reason about. Two batchers running the same load may have different `MaxBatchSize` after a week.

This is fine if observable but can confuse junior engineers ("why is this one batcher behaving differently?").

### When to Skip Adaptive

For most cases: skip. Static sizing with periodic manual review is simpler and good enough.

For 10x traffic variation between day and night: maybe.

For unknown workload shape: maybe, with caution.

## A Compendium of Senior-Level Insights

Discrete lessons that took years to accumulate:

1. **The first batcher you ship will lose data.** The bug is in shutdown. Test shutdown specifically.
2. **The second batcher you ship will lose data differently.** This time it is on crash. Add upstream replay.
3. **The third batcher will work.** And you will spend the next year tuning it.
4. **Metrics are not optional.** Without them, you fly blind. With them, you fly informed.
5. **Adaptive sizing is rarely worth it.** Static tuning catches 90% of the value with 10% of the complexity.
6. **Per-tenant batching is rarely worth it.** Shared with quotas catches 80%. Per-tenant is for special cases.
7. **The DLQ will fill.** Have a drain process. Test the drain.
8. **The sink will fail.** Have a circuit breaker and a DLQ.
9. **The producers will not respect backpressure.** Surface 503 explicitly.
10. **The downstream will change.** Version your items.
11. **The latency budget is a constraint, not a target.** Stay well below.
12. **Throughput is per-shard, not global.** Plan accordingly.
13. **You will be paged about a batcher.** Make sure your runbook works at 3 AM.
14. **The batcher's biggest enemy is success.** When traffic grows 10x, last year's config is wrong.
15. **The hardest bugs are at shutdown.** Test shutdown more than steady-state.
16. **Tests with `time.Sleep` are flaky.** Use fake clocks.
17. **`select` is randomised.** Do not depend on case order.
18. **`time.Ticker` drifts.** `time.Timer` is precise.
19. **Channels are fast.** Lock-free queues are overkill.
20. **`interface{}` allocates.** Use generics.

These are the lessons every senior engineer has learned the hard way. Pass them on to juniors.

## Pattern Catalog Reference

A quick reference of patterns we've covered:

| Pattern | Where | Purpose |
|---------|-------|---------|
| Size trigger | Run loop | Flush when N items accumulated |
| Time trigger | Run loop | Flush when D elapsed |
| Close trigger | Run loop on `!ok` | Drain on shutdown |
| Manual flush | Public API | End-of-request fence |
| Defensive copy | Before sink call | Prevent aliasing |
| `sync.Pool` | Batch slices | Reduce allocation |
| Retry decorator | Wrap sink | Handle transients |
| Circuit breaker | Wrap retry | Prevent storms |
| DLQ | Failure path | Permanent errors |
| Rate limiter | Before sink | Respect limits |
| Pipeline | flushReq channel | Decouple flush |
| Worker pool | flushReq workers | Parallel flushes |
| Sharded batchers | By hash key | Per-key isolation |
| Per-tenant sub-batch | Buffer per key | Tenant isolation |
| Combiner | Map buffer | Combine items |
| Adaptive sizing | Background goroutine | Self-tune |
| Hedged flush | Two parallel calls | Cut tail latency |
| Bulkhead | Separate pools | Fault isolation |
| Persistent buffer | Disk WAL | Crash safety |

This catalog is the senior engineer's mental library. Reach for the right pattern given the requirements.

## A Decision Framework: Build vs Buy

When the company needs a batcher: build in-house or use a library/service?

### Build In-House

- Custom requirements not met by libraries.
- Want full control over performance, semantics.
- Team has expertise.
- Long-term commitment.

Cost: weeks-to-months of engineering. Ongoing maintenance.

### Use a Library

- Standard use case (channel-based, size+time triggers).
- Open-source library exists (OpenTelemetry SDK, batcher libraries).
- Want maintenance from the community.

Cost: hours to integrate. Periodic library updates.

### Use a Managed Service

- Want a black-box solution.
- Sidecar / agent like Datadog or Fluent Bit.
- Pay for operations rather than build.

Cost: $/month based on volume.

### Hybrid

Most real systems mix:
- Library for common cases.
- Custom decorators for special needs.
- Managed for non-core services.

Senior engineers make these decisions with cost-benefit analysis, not preference.

## A Note on Career Growth

Batching is a microcosm of distributed systems engineering:
- Trade-offs (latency vs throughput).
- Failure modes (network, retries, DLQ).
- Observability (metrics, traces, alerts).
- Capacity planning (sizing, headroom).
- Operations (runbooks, incidents).

An engineer who masters batchers gains the toolkit for many adjacent problems:
- Stream processing.
- Cache design.
- Queue systems.
- Replication.
- Sharding.

The patterns generalise. The discipline transfers. Time spent on batching pays back in every adjacent system you build.

## The Senior's Bookshelf

A senior engineer's reading list for batching and related topics:

### Foundational

- "Designing Data-Intensive Applications" (Martin Kleppmann). Covers batch vs stream, log structures, partitioning.
- "Site Reliability Engineering" (Beyer et al.). SLOs, error budgets, incident response.
- "The Phoenix Project" (Kim et al.). DevOps narrative; broad context.

### Performance

- "Systems Performance" (Brendan Gregg). Profiling, observability, system tuning.
- "BPF Performance Tools" (Brendan Gregg). Modern observability.

### Go-Specific

- "100 Go Mistakes and How to Avoid Them" (Teiva Harsanyi). Common pitfalls.
- "Concurrency in Go" (Katherine Cox-Buday). Patterns.

### Concurrency Theory

- "The Art of Multiprocessor Programming" (Herlihy, Shavit). Theory of concurrent algorithms.
- LMAX Disruptor papers. High-throughput patterns.

### Streaming and Data

- "Kafka: The Definitive Guide" (Narkhede et al.). Kafka internals.
- "Stream Processing with Apache Flink" (Hueske, Kalavri). Flink and streaming concepts.

### Production Patterns

- "Release It!" (Michael Nygard). Production stability patterns.
- "Microservices Patterns" (Chris Richardson). Saga, outbox, CQRS.

These are the books a senior engineer has read and re-read. Each covers a slice of the broader knowledge needed to operate batchers in production.

## Operating At Scale: A Real Day

A day in the life of a senior engineer operating a batcher fleet.

### 09:00 — Coffee, Review Yesterday

Open dashboard. Check overnight:
- Batch sizes: stable, p50 ~480 (close to MaxBatchSize=500).
- Flush durations: stable, p99 ~30 ms.
- DLQ: 0 new items.
- Queue depths: all <30%.

All green. Note in the team log: "audit batchers stable overnight; no action needed".

### 10:30 — A New Service Launches

A teammate launches a new microservice that emits 1000 events/s to our existing batcher. We expected this; capacity is sized for 2x.

Watch metrics:
- Queue depth jumps from 30% to 60%.
- p99 flush duration unchanged.
- Batch sizes still hitting MaxBatchSize.

System absorbed the load. Sign-off complete.

### 13:00 — Postgres Maintenance Window

Postgres team announces a 15-minute maintenance: brief read-only mode at 13:30.

Pre-flight: confirm the batcher's behavior during read-only.

- Read-only Postgres rejects writes.
- Our retry layer treats as transient.
- After 3 retries, items go to DLQ.

Decision: increase DLQ depth alert threshold for the window. Wait it out.

### 13:30 — Maintenance Starts

Watch:
- Flush failures spike.
- Retries spike.
- DLQ accumulates ~5K items.
- Queue depth rises to 60%.

Producers get 503s on saturated batchers.

### 13:45 — Maintenance Ends

Postgres back. Watch:
- Retries succeed. DLQ stops growing.
- Need to drain DLQ.
- Run drain script: re-injects DLQ items into the batcher.
- Within 5 minutes: DLQ empty, queue normal.

### 16:00 — A Performance Investigation

A new feature added a JSON field to events. p99 flush durations crept up over the last week.

Profile: serialisation is now 20% of CPU (was 5%).

Action: switch from `encoding/json` to `easyjson` for the audit type. ~3x faster serialisation. CPU back to baseline.

PR review. Merge. Deploy. Watch.

### 17:00 — Wrap Up

Team standup. Note today's actions:
- Absorbed new service load.
- Survived Postgres maintenance (DLQ as designed).
- Optimised serialisation (3x speedup).

Tomorrow's work: explore adaptive sizing for variable-volume workloads.

This is what staff-level day-to-day work looks like. Not heroic; not chaotic. Just operating a well-built system.

## Detailed Architecture Diagrams

A senior engineer draws diagrams. Some standard ones for batchers.

### Layered Architecture

```
+---------------+
| Producers     |
| (HTTP, gRPC,  |
|  consumers)   |
+-------+-------+
        |
        v
+---------------+
| API Layer     |  <-- validation, auth, conversion
+-------+-------+
        |
        v
+---------------+
| Batcher       |  <-- buffer, size+time triggers
+-------+-------+
        |
        v
+---------------+
| Retry Layer   |  <-- transient error handling
+-------+-------+
        |
        v
+---------------+
| Circuit Brkr  |  <-- prevents storm during outage
+-------+-------+
        |
        v
+---------------+
| Rate Limiter  |  <-- respects downstream limits
+-------+-------+
        |
        v
+---------------+
| Concrete Sink |  <-- network call
+-------+-------+
        |
        v
+---------------+
| Downstream    |
+---------------+
```

Each layer composes via the Sink interface.

### Sharded Topology

```
                Producers
                   |
        +----------+----------+
        |          |          |
        v          v          v
   +--------+ +--------+ +--------+
   |Batcher | |Batcher | |Batcher |
   |   0    | |   1    | |   2    |
   +---+----+ +---+----+ +---+----+
       |          |          |
       v          v          v
   +--------+ +--------+ +--------+
   |  DB    | |  DB    | |  DB    |
   | replica| | replica| | replica|
   |   0    | |   1    | |   2    |
   +--------+ +--------+ +--------+
```

Each shard is independent. Producers route by hash.

### Hierarchical Topology

```
Per-server batchers (small, fast):
   [b1] [b2] [b3] [b4]
     |    |    |    |
     v    v    v    v
  Aggregator batcher (large, slower):
            [B]
             |
             v
         Downstream
```

Two-stage amortisation. Used in multi-region setups.

## Capacity Planning Spreadsheet

A senior engineer maintains a spreadsheet for capacity:

| Metric | Current | Target | Notes |
|--------|--------:|-------:|-------|
| Peak req/s | 5K | 50K | 10x growth in 12 months |
| Avg req/s | 1K | 10K | |
| MaxBatchSize | 100 | 500 | Knee on the curve |
| MaxBatchDelay | 100ms | 100ms | SLO budget |
| Flushers | 2 | 8 | Linear with peak |
| QueueDepth | 1024 | 8192 | 2s burst absorption |
| Per-batcher mem | 1MB | 8MB | Buffer + queue |
| Total mem | 4MB | 64MB | 8 shards |
| Sink TPS | 5K | 100K | Postgres pool size 20 |

This is the spreadsheet that justifies "we need 4 more cores and 32 GB more RAM next year". Get it right.

## Architecture for Idempotency

A senior decision: how to achieve idempotency end-to-end.

### Item-Level Idempotency

Each item has a unique ID. Sink uses ON CONFLICT or equivalent.

```sql
INSERT INTO events (id, payload) VALUES ($1, $2)
ON CONFLICT (id) DO NOTHING
```

Cost: per-item dedup at the sink. Usually fast with a unique index.

### Batch-Level Idempotency

Each batch has a unique ID. Sink tracks "batch X processed".

```sql
INSERT INTO batches (id) VALUES ($1)
ON CONFLICT (id) DO NOTHING RETURNING id;
-- If RETURNING returned, then proceed to insert items.
```

Cost: one extra round-trip per batch. Allows retries without per-item dedup.

### Outbox Pattern

The batcher writes to a local outbox. A separate process drains the outbox to the downstream. The outbox is the durable boundary.

```
app -> [outbox table in DB] -> [CDC] -> Kafka -> downstream
```

Cost: more infrastructure. Benefit: transactional guarantees with the app's primary DB.

### Choose Based on Cost

For most cases: item-level idempotency. Cheap, works.

For mixed-criticality: outbox for important events; item-level for others.

For low-volume: maybe no idempotency; just at-least-once with manual reconciliation.

## Architecture for Multi-Region

Multi-region batchers face cross-DC latency (50-200 ms RTT) and bandwidth costs.

### Pattern: Regional Aggregation

Each region has its own batchers writing to a regional sink. Replication is the sink's job.

Pros: low intra-region latency.
Cons: per-region sinks; replication delay.

### Pattern: Cross-Region Shipping

Local batchers ship batches to a global sink (chosen region). Larger batches absorb cross-DC RTT.

Pros: single sink (simpler).
Cons: latency cost; bandwidth cost.

### Pattern: Two-Tier

Local: small batches (low latency).
Regional aggregator: combines local batches; ships cross-DC.

Pros: bandwidth amortisation.
Cons: complex.

For most multi-region services: regional aggregation. Use the others only when you have a specific reason.

## Architecture for Cost Optimisation

A senior optimises both performance and cost.

### Bandwidth

Batching reduces TCP overhead. Compression (gzip, zstd) reduces bytes.

For cross-region: bandwidth costs $0.02-0.10 per GB. At 100 MB/s: $250-1000/month.

Compression at 5x: $50-200/month. Worth the CPU.

### Compute

Batching reduces per-call cost. Fewer database connections. Fewer broker workers. Lower CPU.

For a 10x amortisation: ~80% fewer cores. At $50/core/month: thousands saved per year.

### Storage

Batching writes are usually cheaper. Postgres group commit amortises fsync. Kafka batch produce reduces broker work.

For 1 TB/day write workload: batching can reduce storage IOPS by 50-90%. Translates to smaller, cheaper instances.

### Engineering

Batching adds complexity. Engineering time to design, test, operate.

For most services: pays back in 1-3 months at production scale.

For pre-MVP: do not optimise prematurely.

## The Twelve-Factor Batcher

The Twelve-Factor App principles, applied to batchers:

1. **Codebase**: one repo per service. Batchers are libraries within.
2. **Dependencies**: declare via go.mod.
3. **Config**: env vars (`MAX_BATCH_SIZE`, `MAX_BATCH_DELAY_MS`).
4. **Backing services**: Sinks are attached resources.
5. **Build, release, run**: separate stages.
6. **Processes**: stateless (the buffer is in-memory; not persistent).
7. **Port binding**: not directly; expose via HTTP if needed.
8. **Concurrency**: scale by processes.
9. **Disposability**: fast startup, graceful shutdown.
10. **Dev/prod parity**: same code, different configs.
11. **Logs**: structured, to stdout.
12. **Admin processes**: ad-hoc tooling (drain DLQ) as separate scripts.

Following these makes the batcher a good citizen of modern services.

## Decision Records

A pattern: every significant batcher decision becomes a "Decision Record" in the repo.

Format:

```
# DR-XX: Choose MaxBatchSize for Audit Batcher

Date: 2024-XX-XX
Status: Accepted

## Context
We need a batch size for the audit batcher. Options: 100, 500, 1000.

## Decision
500.

## Consequences
- Throughput: capable of 5K-15K events/s.
- Latency: p99 ~30 ms for flush.
- Postgres: parameter count below 65535.
- Memory: 500 items * 1 KB = 500 KB per batch; fine.

## Alternatives Considered
- 100: too small; flush rate too high.
- 1000: better throughput but higher per-flush latency.
- Adaptive: complex; deferred to v2.
```

These records survive personnel changes. Future engineers know why decisions were made.

## A Conversation About Observability

What do you instrument first?

### Tier 1: Essentials

Cannot operate without these.
- `flush_total{name, reason}`.
- `batch_size_items{name}` histogram.
- `flush_duration_seconds{name, result}` histogram.
- `queue_depth{name}` gauge.

### Tier 2: Common

Useful for debugging.
- `flush_failure_total{name, error_type}`.
- `dropped_total{name, drop_type}`.
- `add_blocked_total{name}` (if Add can block).

### Tier 3: Advanced

For deep investigations.
- Per-flush trace spans.
- Per-item trace context.
- Sink-internal metrics (e.g., DB query plan changes).

Most batchers ship with Tier 1. Adding Tier 2 is a few hours' work. Tier 3 requires tracing infrastructure.

Without Tier 1, the batcher is operating blind. Add it before shipping.

## A Real Production Story: The 80/20 Rule

A team had a batcher with throughput at 80% of expected. After a week of debugging:

- 20% of items took 80% of CPU due to a heavy JSON field.
- Splitting items by type (heavy vs light) and batching separately recovered throughput.
- 80/20 again: 80% of items were "light", 20% "heavy".

The fix: two batchers, light and heavy. Heavy batches were smaller (50 items vs 500). Throughput recovered.

Lesson: a uniform batcher assumes uniform items. When items vary, split.

## A Real Production Story: The Late Realisation

A team deployed a batcher to ship logs to a vendor. Logs flowed; metrics looked fine.

Three months later, the vendor invoiced 10x expected. Investigation:

- The batcher had `MaxBatchSize = 1` (default forgotten).
- Each log line was one API call to the vendor.
- The vendor billed per API call, not per byte.

Cost: thousands of dollars per month, wasted.

Lesson: read the bill. Validate that batching actually reduced calls.

## Reviewing a Batcher Design: A Worked Example

A junior on your team sends you this design doc. Let us review.

### Design Doc

"A batcher to ship logs to S3. Items are JSON log lines. MaxBatchSize = 1, MaxBatchDelay = 60s. The flush writes one item per S3 object."

### Senior Comments

1. "MaxBatchSize = 1 with delay 60s means the batcher waits 60s for one item. This is not batching. Why?"
2. "If you really want one S3 object per item, you don't need a batcher; just write directly."
3. "If you want to batch, use MaxBatchSize = 1000 or so, write a manifest plus the data in one S3 multipart upload."
4. "S3 has no per-call batching; you have to bundle data manually."
5. "Have you considered Athena partitioning? One file per minute is more useful than per second."

### Resolution

After discussion, the team redesigned: MaxBatchSize = 10000, MaxBatchDelay = 60s. Each flush writes one S3 object containing 10000 lines. Athena can partition by hour.

The original design would have created 1 million tiny S3 objects per day. The revised design creates ~1500. Storage savings: 99.85% of API calls.

This is the kind of review that senior engineering provides. The junior's instinct was right (batching helps), but the configuration was wrong.

## A Conversation About Test Strategy

For batchers, what tests should be in CI?

### Must-Have

- Unit tests for each trigger.
- Race tests (`-race`).
- Shutdown drain test.
- Shutdown timeout test.

### Should-Have

- Integration test with a real sink (testcontainers, in-process fakes).
- Property-based tests (random items, verify invariants).
- Concurrent producer test.

### Nice-To-Have

- Chaos tests (random sink failures).
- Load tests (sustained throughput).
- Memory profile tests (no leaks).

### Production Verification

- Canary deployment.
- Synthetic load.
- Manual chaos drill.

Each level catches a class of bugs. Unit tests catch logic; integration catches contract violations; load catches scaling; chaos catches resilience.

A team that ships a batcher with only unit tests is taking on risk.

## A Mental Model: The Batch As A Resource

Think of each batch as a "resource" allocated to a flush operation.

- Allocation: items accumulate in a batch.
- Use: the flush sends the batch to the sink.
- Release: after success or DLQ, the batch is released.

Resource accounting: at any time, the number of allocated batches is `flush_in_flight`. Bounded by `Flushers` and `FlushQueueCap`.

Total resource consumption: `flush_in_flight * MaxBatchSize * sizeof(Item)`.

For 4 flushers, 1000 batch size, 1 KB items: 4 MB worst-case in flight.

This perspective makes capacity planning concrete.

## A Mental Model: The Batcher As A Tap

Producers fill the tap; the tap drains into the sink.

- Tap rate (production rate) sets the flow.
- Tap capacity (queue depth) bounds the level.
- Drain rate (sink throughput) sets the steady-state.

If tap > drain: level rises. Eventually overflows (backpressure).
If tap < drain: level stays low (under-utilised).
If tap = drain: level is at the "knee" — efficient.

This generalises the "bathtub" mental model into a tunable.

## A Mental Model: Backpressure as Communication

Backpressure is a signal: "I cannot accept more right now". The receiver communicates to the sender by:

- Blocking (sender waits).
- Returning error (sender retries or fails).
- Dropping (sender unaware; bad pattern).

Each option has trade-offs. None is "free".

For a healthy system: backpressure is rare. When it happens: signal flows back through the stack, ending at the user (e.g., a 503).

For an unhealthy system: backpressure is constant. Indicates capacity mismatch.

Use backpressure metrics (queue depth, block rate) to detect emerging issues.

## A Mental Model: Latency Composition

End-to-end latency = sum of stage latencies + interactions.

If stages are well-isolated (each has bounded queue), interactions are small.

If stages share resources (CPU, network), one slow stage slows others.

For a batcher, the "stage" is "from Add to flushedOK". Includes:
- Channel wait.
- Buffer wait.
- Flush wait.
- Sink processing.

Plot each as a histogram. Sum (or max for p99) gives the end-to-end picture.

## A Mental Model: Failure Cascade

When something goes wrong, what fails next?

For a batcher:
- Sink slow -> flush slow -> queue full -> Add blocks -> upstream blocks -> user 503.

Each level is a hop. The chain breaks at the weakest link.

To prevent cascade:
- Bound each queue.
- Timeout each call.
- Surface backpressure at each hop.

A well-designed system fails one stage at a time, gracefully.

## A Long Conversation: The "Should We Batch" Decision

Many architecture discussions involve "should we add a batcher here?". Some considerations.

### The Pro Side

- Per-call cost is high (>1 ms).
- High throughput (>1000/s).
- Latency budget allows (~100 ms delay tolerable).
- Downstream amortises well.
- Items can be combined safely.

### The Con Side

- Latency budget is tight (<10 ms).
- Throughput is low (<100/s, batches will never fill).
- Items are heterogeneous (hard to batch).
- Downstream batches already.
- Strict per-item semantics required.

### The Conversation

"Should we batch the audit write?"

- "Per call cost?" — 5 ms for Postgres write.
- "Throughput?" — 5000/s peak.
- "Latency budget?" — 100 ms (user does not see audit).
- "Downstream support?" — Postgres COPY is 5x faster than INSERT.
- "Items combinable?" — Yes, all rows in one table.

Answer: yes, batch.

"Should we batch the login endpoint?"

- "Per call cost?" — 2 ms.
- "Throughput?" — 50/s peak.
- "Latency budget?" — User is waiting; need response.
- "Downstream support?" — bcrypt is per-password.
- "Items combinable?" — No, each login is independent.

Answer: no, do not batch.

Apply this conversation framework to every "should we batch" decision. It saves debate cycles.

## Real Numbers from Production

Some real numbers from production batchers I've seen.

### Audit Log (Postgres)

- 30K events/s sustained.
- 4 instances, 1 batcher each.
- MaxBatchSize 500, MaxBatchDelay 100ms.
- p50 batch size: 480.
- p99 flush duration: 30 ms.
- 0 DLQ items in 30 days.
- Postgres CPU: 15%.

### Metrics (Statsd)

- 200K events/s.
- One process, one batcher.
- MaxBatchSize 1432 (one UDP packet), MaxBatchDelay 100ms.
- p99 flush duration: 0.5 ms (UDP).
- Drop rate: 0 (UDP buffer absorbs).

### Notification (Push)

- 1M events/hour (≈300/s).
- 10 batchers (per device-region shard).
- MaxBatchSize 100, MaxBatchDelay 5s.
- Combiner pattern (collapse per-user notifications).
- p99 latency: 5 s (latency-tolerant).

### Search Indexing (Elastic)

- 50K events/s peak.
- 2 batchers per consumer instance.
- MaxBatchSize 5000 docs / 10 MB, MaxBatchDelay 10s.
- p99 flush duration: 200 ms.
- DLQ: ~10 items/day (transient Elastic errors with bad payloads).

### CDC Pipeline

- 100K events/s.
- One batcher per source partition (16 partitions, 16 batchers).
- MaxBatchSize 1000, MaxBatchDelay 100 ms.
- Strict order-preserving (1 flusher per batcher).
- p99 latency: 200 ms.

The variation in tuning reflects domain: audit (durability), metrics (lossy), notification (debounce), search (throughput), CDC (ordering). Same pattern; different configurations.

## Comparing Batching to Alternatives

Batching is one tool. When are alternatives better?

### Alternative: Cache

For repeated reads, a cache amortises lookup cost. For batching writes, it does not apply.

For "lookup then write" workflows, both apply: cache the lookup, batch the write.

### Alternative: Persistent Queue (Kafka)

A queue is a durable buffer; consumers read in batches. For high-volume async processing, a queue replaces an in-process batcher.

Trade-off: queue adds operational complexity, ~ms latency. But: durability, replayability, multiple consumers.

For most production systems beyond toy scale: have a queue.

### Alternative: Streaming Frameworks (Kafka Streams, Flink)

For complex transformations (joins, windows, aggregations), use a streaming framework.

Trade-off: heavyweight, separate cluster.

For application-level batching, in-process is enough.

### Alternative: Pre-Aggregation in the Source

If items are emitted by a controlled source, the source itself can pre-aggregate. Counters that accumulate at the source and flush periodically.

For example: a Prometheus client emits aggregate values at scrape time; no separate batcher needed in the application.

### Alternative: Multi-Item API

If you can change the API contract, accept many items per call. The caller batches; the server processes in bulk.

This avoids the need for a server-side batcher entirely. Best when the API can be changed.

## A Senior-Level Refactoring Pattern

Refactoring a service from synchronous to batched. A real workflow:

### Step 1: Identify the Bottleneck

Profile. Find the per-call hot path (parse + execute on DB).

### Step 2: Extract a Sink Interface

```go
type AuditSink interface {
    Save(ctx context.Context, e []Event) error
}
```

Replace direct DB calls with `sink.Save(ctx, []Event{e})`.

### Step 3: Add the Batcher

Insert the batcher between callers and the sink. Initially: `MaxBatchSize = 1` (no actual batching; just async).

### Step 4: Verify Behavior

Tests should pass. Latency unchanged (no batching yet).

### Step 5: Tune

Increase `MaxBatchSize`. Measure. Adjust `MaxBatchDelay` to fit SLO.

### Step 6: Production Rollout

Feature flag. 1% -> 10% -> 50% -> 100%.

### Step 7: Cleanup

Remove old synchronous path. Document the new architecture.

This is the canonical refactoring. Takes 1-2 weeks of focused work.

## Reliability Patterns That Compose

A senior engineer combines reliability patterns:

### Batcher + Retry + Circuit Breaker + DLQ

```
items -> Batcher -> [flush] -> RetrySink -> CircuitSink -> ConcreteSink
                                                 |
                                                 v (when open)
                                              DLQSink
```

Each layer:
- Retry: handles transient errors.
- Circuit Breaker: prevents retry storms during outages.
- DLQ: catches permanent failures.

Compose with the decorator pattern. Each is independently testable.

### Batcher + Rate Limiter

When the sink has a rate limit:

```
items -> Batcher -> RateLimiter -> Sink
```

The limiter throttles the flush rate. The batcher amortises per-call cost up to the limit.

### Batcher + Bulkhead

Per-priority batchers:

```
hot items -> HotBatcher -> hotPool -> Sink
cold items -> ColdBatcher -> coldPool -> Sink
```

A slow cold flush does not starve hot items. Two separate pools, two separate sinks (or same sink with priority).

### Batcher + Hedging

For latency-sensitive flushes, send to two replicas; first to ack wins:

```go
func (h *HedgedSink) Write(ctx context.Context, batch []Item) error {
    ch := make(chan error, 2)
    go func() { ch <- h.primary.Write(ctx, batch) }()
    go func() { ch <- h.secondary.Write(ctx, batch) }()
    return <-ch
}
```

Cost: 2x downstream load. Benefit: p99 latency cut significantly.

Caveat: requires idempotent sink.

## Architecture: Worker Pool of Batchers

A common scaling pattern: pool of batchers, each handling a partition.

```
producers --(hash key)--> [batcher_0, batcher_1, ..., batcher_N-1]
                              |          |              |
                              v          v              v
                          [sink_0]   [sink_1]      [sink_N-1]
```

Each batcher is independent. Producers route by hash. Each batcher's sink can be a different connection / partition / shard.

### When to Use

- Sink supports parallel writes (multi-partition Kafka, multi-shard DB).
- Items have a natural shard key (user ID, tenant ID).
- Single-batcher throughput is insufficient.

### Trade-offs

- Pro: linear scalability.
- Pro: per-shard isolation.
- Con: more goroutines, more memory.
- Con: cross-shard ordering lost.

### Sizing

Choose `N` based on:
- Sink's parallel capacity.
- Goroutine overhead.
- Memory budget.

Typical: 4-16 shards. Beyond, diminishing returns.

## Architecture: Pipeline of Batchers

Sometimes a multi-stage pipeline:

```
[stage 1: batch raw] -> [stage 2: enrich + re-batch] -> [stage 3: write]
```

Each stage adds latency but enables transformations. Examples:

- Stage 1: collect raw events.
- Stage 2: enrich with user data (lookup from cache).
- Stage 3: write enriched events to DB.

### Trade-offs

- Pro: separation of concerns.
- Pro: each stage can be tuned independently.
- Con: latency adds up.
- Con: multiple failure points.

Avoid unless each stage adds real value.

## Architecture: Sidecar Batchers

A batcher running as a sidecar (separate process/container) to the main service:

- Main service writes to local Unix socket.
- Sidecar reads, batches, ships to remote sink.
- Sidecar handles retries, DLQ, observability.

Examples:
- Datadog agent.
- Fluentd / Fluent Bit.
- OpenTelemetry Collector.

### Pros

- Decoupled from main service.
- Same sidecar across many services.
- Crash isolation.

### Cons

- Extra hop.
- IPC overhead.
- Sidecar process to deploy.

For organisation-wide telemetry, sidecars win. For service-specific batching, in-process wins.

## A Look At Cross-Service Backpressure

A batcher's queue is one backpressure point. In distributed systems, backpressure propagates across service boundaries.

### Example Pipeline

```
[client] -> [API gateway] -> [auth service] -> [event handler] -> [batcher] -> [Postgres]
```

If Postgres slows:
1. Batcher's flush takes longer.
2. Batcher's queue fills.
3. Event handler's `Add` blocks (or returns 503).
4. Auth service's call to event handler slows.
5. API gateway's call to auth slows.
6. Client's call to API gateway slows.

Each hop has its own queue. Each must surface backpressure to its caller.

### Encoding Backpressure in Protocols

HTTP: 503 Service Unavailable with Retry-After.
gRPC: `RESOURCE_EXHAUSTED` status.
RPC frameworks (Thrift, Avro): protocol-specific error.

The client must understand and respond. Naive clients retry immediately, amplifying the problem. Mature clients use exponential backoff with jitter.

### Token Bucket Across Services

Sometimes backpressure is too coarse. A token bucket lets the upstream rate-limit calls to the downstream:

```go
limiter := rate.NewLimiter(rate.Limit(1000), 100) // 1000/s, burst 100
limiter.Wait(ctx)
client.Call(...)
```

The limiter rates the calls. Backpressure is now smooth, not all-or-nothing.

### Coordinated Backpressure

For multiple producers feeding one batcher, coordinated rate limiting:

- Each producer takes from a shared limiter.
- Limiter enforces global rate.
- Backpressure is per-producer slow, not 503 spikes.

This is the cleanest design for distributed backpressure. Implementation is non-trivial.

## A Closer Look at SLO Definition

Defining an SLO for a batcher:

### Throughput SLO

"99% of weeks, the batcher processes at least 50K events/s during peak hour."

Measurable. Actionable. Time-bounded.

### Latency SLO

"99% of events from `Add` to `flushedOK` within 200 ms, measured over 5-minute windows."

Note: NOT "average latency is 200 ms". p99 of *every individual event*, in a sliding window.

### Durability SLO

"99.99% of events that returned `nil` from `Add` end up in `flushedOK`."

Burning the budget:
- Loss on shutdown timeout: 1 per million events.
- Loss on crash: 100 per million events (depending on `MaxBatchDelay`).
- Loss on DLQ permanent failure: 10 per million.
- Total: 111 per million = 99.989%.

If SLO is 99.99% (100 ppm), we are over budget. Tighten MaxBatchDelay or add upstream replay.

### Availability SLO

"99.95% of the time, `Add` returns nil or a transient error."

Less than 99.95% triggers an incident review.

## A Note on Cost Optimisation

Batchers reduce infrastructure cost. Quantifying:

### Postgres CPU

Without batching: 1500 INSERTs/s = 1 core continuously busy.
With batching (100 rows/INSERT): 15 INSERTs/s = 0.1 core.

Saved: 0.9 core. At $50/month/core, $45/month savings.

For 50K rows/s: 0.9 saved cores per batching factor of 100. Add up over a year: $540 per shard.

### Network

Without batching: 50K req/s * 1 KB header = 50 MB/s network for just headers.
With batching: 500 req/s * 1 KB = 500 KB/s.

Saved: 49.5 MB/s. Bandwidth is usually free within a cloud region; cross-region matters.

### Kafka

Without batching: 50K produce calls/s. Brokers struggle.
With batching: 500/s. Easy.

Saved: probably half the broker count.

### Memory

Cost from items waiting in the buffer. Usually negligible.

### Engineering Time

Batchers are not free. ~1 week to design+ship+tune a basic one. ~3-4 weeks for a production-grade one with all observability.

Pays for itself in weeks at most reasonable scales.

## Senior Mistakes to Avoid

After years of batchers, the mistakes a senior engineer still makes:

### Premature Optimisation

Building a lock-free MPMC ring before the channel-based batcher even ships. The channel was fine; the ring buffer is now a maintenance burden.

Lesson: ship the simple version. Optimise only after profiling.

### Over-Engineering the Configuration

Exposing 30 knobs in the config. Users tune the wrong ones. Defaults are forgotten.

Lesson: expose the 5 essential knobs. Hide the rest behind sensible defaults.

### Missing the Latency Budget

Picking `MaxBatchDelay = 100 ms` because "that's what the tutorial said". Then surprised when p99 latency is 100 ms.

Lesson: derive `MaxBatchDelay` from the SLO budget.

### Forgetting Producer-Side Backpressure

The batcher's input channel is bounded. But the producer is a goroutine pool that grows unboundedly to keep up. When the batcher slows, the pool grows; memory explodes.

Lesson: every stage in the pipeline must propagate backpressure.

### Trusting "Cleanup Will Happen"

The batcher leaks a goroutine on every Close. Tests pass; production memory grows. Months later, someone notices.

Lesson: verify cleanup. `runtime.NumGoroutine` is your friend.

### Coupling to a Specific Sink

The batcher's code mentions Postgres directly. Now changing to Kafka requires rewriting the batcher.

Lesson: always use a Sink interface.

### Ignoring the DLQ

The DLQ grows quietly. When it has 1M items, no one knows how to drain.

Lesson: monitor the DLQ. Define drain procedures.

## Coordinating Batcher Lifecycle With Service Lifecycle

A service's lifecycle has phases:

1. Construct: dependency wiring.
2. Start: goroutines run.
3. Serve: business logic.
4. Stop: graceful shutdown.
5. Close: release resources.

The batcher participates in 1, 2, 4, 5. Common bugs at each:

- **Construct without Start**: batcher created but `go run()` not called. Producers' `Add` queues forever.
- **Stop without Close**: batcher drained but connection pool not closed. Connections leak.
- **Stop without enough time**: deadline too short; items lost.
- **Close before Stop**: `db.Close()` called before `batcher.Shutdown(ctx)`; flushes fail.

Use a lifecycle library (fx, wire) to enforce order, or wire by hand carefully.

## Reading Real Codebases

Some real-world Go batchers to read:

- **OpenTelemetry SDK** (`sdk/trace/batch_span_processor.go`): the reference implementation. 350 lines. Covers everything we discussed.
- **Vector** (Rust, but conceptually identical): commercial-grade. Look at `lib/vector-core/src/sinks/util/batch.rs`.
- **Loki client** (Go): grafana/loki, `clients/pkg/promtail/client`.
- **Prometheus remote write** (Go): prometheus/prometheus, `storage/remote/queue_manager.go`.
- **Datadog tracer** (Go): DataDog/dd-trace-go, batcher inside the tracer.

Reading these makes the patterns concrete. Each is slightly different but all share the core shape: select loop, dual triggers, retry layer, DLQ.

## A Note on Backwards-Incompatible Sink Changes

When the sink's API changes (a new required column, a deprecated endpoint), the batcher must adapt. Strategies:

- **Forward-compatible items**: items carry version info; sink translates as needed.
- **Drain-and-redeploy**: drain the batcher, redeploy with the new schema. Brief downtime.
- **Dual-write**: write to both old and new sinks during transition. Reconcile after.
- **Outbox + CDC**: the application writes to an outbox table; a separate process propagates to the sink. Schema changes happen at the propagator level.

For long-lived services, the outbox is the most flexible. For short-lived services, drain-and-redeploy is simpler.

## Domain-Specific Examples

How different domains shape the batcher:

### Trading System

- Latency-critical: microseconds matter.
- `MaxBatchDelay` = 100 microseconds.
- `MaxBatchSize` = 32 (small).
- Single-threaded for ordering.
- No retries (orders must succeed or be cancelled).

### Audit Log

- Throughput-critical, latency-tolerant.
- `MaxBatchDelay` = 1 second.
- `MaxBatchSize` = 1000.
- Multi-flusher OK (idempotent inserts).
- Bounded retries; DLQ to S3 for review.

### Metrics

- High volume, lossy tolerant.
- `MaxBatchDelay` = 100 ms.
- `MaxBatchSize` = 5000 samples.
- Combine (aggregate counters).
- Drop on overflow (no point retrying old metrics).

### IoT Telemetry

- Distributed producers, central sink.
- `MaxBatchDelay` = 60 seconds (per device).
- `MaxBatchSize` = 100 (per device).
- Persistent buffer on device (sync to central when online).
- Cloud-side batches further before storage.

Each domain shapes the trigger choice, size, retry policy, and durability. Senior engineering is the discipline of matching design to domain.

## Observability: SLIs, SLOs, and Error Budgets

A senior engineer thinks about observability in terms of Service Level Indicators (SLIs), Objectives (SLOs), and error budgets.

### SLIs for a Batcher

- **Throughput SLI**: events processed per second.
- **Latency SLI**: p99 time from `Add` to flush completion.
- **Durability SLI**: fraction of items eventually flushed (over all items added).
- **Availability SLI**: fraction of time the batcher accepts new items without error.

### SLOs

Set objectives for each SLI:

- Throughput SLO: > 50K events/s sustained.
- Latency SLO: p99 < 100 ms.
- Durability SLO: > 99.99% (loss < 100 ppm).
- Availability SLO: > 99.9%.

### Error Budgets

Express SLOs as error budgets:

- Latency budget: 1% of events can exceed 100 ms. At 50K/s, that is 500/s allowed slow.
- Durability budget: 0.01% of events can be lost. At 50K/s, 5/s allowed lost.

When the budget burns faster than the period (e.g., 1 month), trigger an alert.

### Burn Rate Alerts

Two alerts per SLO:

- Fast burn: budget consumed at > 10x rate. Suggests acute problem.
- Slow burn: budget consumed at > 1x rate over a long window. Suggests chronic problem.

This is canonical SRE practice; the SLO model maps cleanly onto batchers.

## The "Why Not Just Bigger Server" Discussion

Sometimes the answer to "throughput is too low" is "use a bigger server", not "add a batcher". When is each right?

### Bigger Server

- The bottleneck is CPU within the application.
- Vertical scaling is cheaper than engineering time.
- The downstream is fast enough that batching is not the win.

### Batcher

- The bottleneck is per-call cost (network, parse, serialise).
- Vertical scaling does not address the bottleneck.
- The downstream amortisation is the win.

If your service is at 80% CPU and adding a batcher doesn't change that, you needed bigger servers. If your downstream is at 80% CPU because of per-call cost, the batcher is the right fix.

## Reactive vs Proactive Tuning

Two approaches:

### Reactive

Tune in response to incidents. The system runs; something breaks; you adjust knobs. Cheap upfront but costly downstream.

### Proactive

Tune based on load tests before deploying. More upfront work; fewer incidents.

Both are reasonable. The choice depends on the cost of incidents (regulated industries can't afford reactive). For a startup, reactive is faster. For a bank, proactive is required.

## Engineering Trade-Offs to Document

In any non-trivial batcher decision, document:

- **Why batching here, not at another layer**: e.g., "We batch in the app because the downstream client library does not handle our combining requirements."
- **Why this `MaxBatchSize`**: "Measured throughput knee at 500; chose 400 with 20% safety margin."
- **Why this `MaxBatchDelay`**: "SLO budget contribution is 50 ms; chose 40 ms with 10 ms headroom."
- **Why this `QueueDepth`**: "Covers 2 seconds of peak; alerts trigger at 80% before reaching cap."
- **Why this retry budget**: "3 attempts cover 99% of transient failures based on historical 95th percentile transient recovery time."
- **Why this DLQ**: "Permanent failures must be reviewable; chose Kafka topic with 7-day retention because operators check it daily."

A design document with these justifications is reviewed once and consulted many times. The lack of such a document is a "code archaeology" hazard.

## The Difficulty of Removing a Batcher

Once a batcher exists, removing it is hard. Reasons:

- Downstream sized for batched traffic; can't handle unbatched.
- Application code coupled to async semantics (Add then ack later).
- Operational tooling (metrics, alerts, runbooks) all tied to the batcher.
- Performance regression risk during transition.

Removing a batcher should follow the reverse migration pattern: feature-flag a direct-write path, ramp slowly, observe, switch.

Most batchers, once added, stay forever. Choose carefully.

## A Note on Asynchronous Result Semantics

A batched API returns "accepted" before the item is durable. Some callers want the durability guarantee:

```go
ack := batcher.AddWithAck(ctx, item)
err := <-ack
```

This breaks the amortisation benefit (now the caller waits) but provides synchronous-like semantics. Use sparingly:

- For "important" items only (most are fire-and-forget).
- With timeout to prevent hangs.

This pattern is the foundation of "outbox" implementations: the outbox row is committed synchronously, but the downstream propagation is asynchronous. The caller knows the commit succeeded; the propagation is decoupled.

## Senior-Level Refactoring Patterns

Refactoring a batcher commonly involves:

### Extracting a Sink Interface

Before:

```go
batcher := &Batcher{db: db}
batcher.flush() // calls db.Exec directly
```

After:

```go
sink := &DBSink{db: db}
batcher := &Batcher{sink: sink}
```

Now the sink is pluggable; tests can use a fake.

### Splitting the Run Loop

Before: one giant `run()` method with 200 lines.

After: smaller methods for each branch:

```go
func (b *Batcher) run() {
    for {
        select {
        case item := <-b.in:
            b.handleItem(item)
        case <-b.ticker.C:
            b.handleTimeTrigger()
        case <-b.closeCh:
            b.handleShutdown()
            return
        }
    }
}
```

### Extracting the Retry Layer

Before: retries inline in `flush`.

After: `RetryingSink` decorator.

### Pulling Out Metrics

Before: metrics inline.

After: a `Metrics` struct with an interface; default implementation uses Prometheus; tests use a fake.

These refactors don't change behaviour but improve testability and reuse. They are typical senior-level cleanups.

## A Deep Dive on the Drain Pattern

The drain pattern (covered in sibling `05-drain-pattern`) deserves a deep look in batching context.

### What Is Drain

Drain means: stop accepting new work, finish in-flight work, then exit. For a batcher, "in-flight" includes items in the channel, items in the buffer, and items handed to the sink but not yet acked.

### Drain Phases

1. **Stop intake**: producers must not enqueue new items. Close intake channel, signal close.
2. **Flush channel**: the run loop drains the input channel into the buffer.
3. **Flush buffer**: the final buffer is dispatched to a flush worker.
4. **Wait for flushers**: pending flushes must complete.
5. **Stop flushers**: close flush queue; flushers exit when drained.
6. **Stop run loop**: run loop exits when buffer is empty and flush queue is closed.
7. **Close sink**: the sink's `Close()` releases resources (DB connections, etc).

Each phase has a sub-deadline. The total deadline budget must cover all phases.

### Drain Phase Diagram

```
[ producers ] -- close intake --> [ channel ] -- drain --> [ run loop ] -- flush --> [ flushers ] -- wait --> [ sink.Close ]
       ^                              ^                          ^                          ^
   stop_intake_d                drain_channel_d           flush_buffer_d            sink_close_d
```

### Drain Codification

```go
func (b *Batcher[T]) Shutdown(ctx context.Context) error {
    // Phase 1: stop intake.
    b.closeOnce.Do(func() {
        close(b.closeCh)
    })

    // Phase 2: signal run loop, which drains channel and flushes.
    close(b.in)

    // Phase 3-6: wait for done.
    select {
    case <-b.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The `done` channel is closed by the run loop only after all phases 3-6 are complete. The `Shutdown` function just waits.

### Drain Loss

What can be lost during drain:

- **Items in flight in `Add`**: a producer's send may not complete if the channel is closed first. Use the double-check pattern in `Add` to return `ErrClosed` cleanly.
- **Items in the channel after close**: drained by the run loop. Safe.
- **Items in the buffer when deadline strikes**: lost. Counted in `droppedOnShutdown`.
- **Items in flush in flight**: ambiguous. Sink may have ack'd or not. Log and accept ambiguity.

### Test Drain Carefully

A test:

```go
func TestDrainNoLoss(t *testing.T) {
    sink := NewBlockingSink()
    b := NewBatcher(sink, MaxBatchSize=10, MaxBatchDelay=time.Hour)

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            _ = b.Add(ctx, Item{ID: i})
        }(i)
    }
    wg.Wait()

    sink.Allow() // let pending flushes complete
    if err := b.Shutdown(ctx); err != nil {
        t.Fatal(err)
    }
    sink.Allow()

    received := sink.Received()
    if len(received) != 100 {
        t.Fatalf("lost %d items", 100-len(received))
    }
}
```

The blocking sink lets us control when flushes complete, exercising the drain phases deterministically.

### Drain Deadline Tuning

How long should drain take?

- Phase 1 (close intake): instant.
- Phase 2 (drain channel): proportional to channel size. 1024 items / 1M items/s = 1 ms. Trivial.
- Phase 3 (flush buffer): proportional to flush latency, ~ `flush_duration_p99`.
- Phase 4 (wait for flushers): proportional to `numFlushers * flush_duration_p99 / numFlushers` = `flush_duration_p99`.
- Phase 5 (stop flushers): trivial.
- Phase 6 (run loop exit): trivial.
- Phase 7 (close sink): library-dependent.

Total: ~ 2 * `flush_duration_p99`. For 100 ms p99 flush, 200 ms drain. Add a 10x safety factor: 2 seconds.

For most services, 5-30 seconds drain deadline is plenty.

## Cancellation Semantics

A batcher's `Add` takes a context. The semantics:

- **Context cancelled before enqueue**: `Add` returns `ctx.Err()`. Item not enqueued.
- **Context cancelled during enqueue (channel send)**: Add returns `ctx.Err()`. Item may or may not be enqueued (race with the channel).

The second case is awkward but unavoidable: by the time `select` picks the `ctx.Done` case, the send may have happened. In practice this is rare (microsecond window) and idempotency handles it.

For the flush call, the sink's context is *not* the producer's context. It is a fresh context with `FlushTimeout`. This is important: if a producer cancels, that should not cancel the flush of items from other producers in the same batch.

## Liveness vs Safety

In distributed systems, "liveness" means good things eventually happen; "safety" means bad things never happen. A batcher cares about both.

Liveness:

- Every item eventually flushes.
- The system makes progress under load.
- Shutdown completes (eventually).

Safety:

- No items lost on clean shutdown.
- No items duplicated unless idempotency handles it.
- No items reordered (within the ordering scope).

The trade-off: tighter safety (stronger durability) usually means looser liveness (slower shutdown, longer retries).

A senior engineer states the safety and liveness requirements explicitly, then designs to meet both within an acceptable trade-off.

## Capacity Math: A Working Example

Suppose we need to handle 30K events/s with p99 durability of 50 ms.

Step 1: choose `MaxBatchDelay`. SLO budget 50 ms; the wait can be at most 50 ms. Choose 40 ms (10 ms headroom).

Step 2: choose `MaxBatchSize`. At 30K events/s and 40 ms delay, expected batch size = 30K * 0.040 = 1200. Set `MaxBatchSize = 1500` (25% headroom).

Step 3: choose `QueueDepth`. Cover 2 seconds of peak: 30K * 2 = 60K. Set `QueueDepth = 65536` (next power of 2).

Step 4: choose `Flushers`. If sink can handle 4 concurrent calls, set 4 flushers. Each handles 30K/4 = 7500 events/s. Each batch is 1500 events; that is 5 flushes/s per flusher.

Step 5: per-flush memory. 1500 events * 1 KB = 1.5 MB per batch. With 4 flushers in flight: 6 MB. Plus the in-progress batch: 1.5 MB. Plus the queue: 65536 * 1 KB = 64 MB. Total: ~70 MB. Reasonable.

Step 6: per-flush time. Postgres COPY at 200K rows/s: 1500 rows / 200K = 7.5 ms. Plus 2 ms call overhead. Total ~10 ms. Comfortably below `MaxBatchDelay`.

Step 7: failure tolerance. If a flush fails, we retry. With 4 flushers, others continue. If all 4 fail, queue grows. `QueueDepth` covers 2 s; after 2 s of total outage, producers see 503s.

This is the working: explicit numbers, justified choices, headroom documented.

## Migration Story: Adding a Batcher

A real story (anonymised) of adding a batcher to a working service.

### Day 0

Service writes audit events synchronously to Postgres: 1 INSERT per request. Service handles 5K req/s peak. Postgres CPU at 80%; DBA complains.

### Day 1

Engineer profiles. INSERT cost: 3 ms per call. At 5K/s, that is 15 seconds of DB CPU per second — 1.5 cores of pure INSERT. Compute: at batches of 100, the cost would be 100 calls/s * 5 ms = 0.5 cores. Decision: add batcher.

### Day 2-3

Engineer writes the batcher. Junior-level: size + time triggers, channel-based, in-memory `Sink` for tests. Adds middle-level wiring: metrics, retry layer, DLQ to local file. Tests pass.

### Day 4

Engineer adds the batcher behind a feature flag. Default: batcher off (synchronous writes). New code path: batcher on. Wires SIGTERM to drain.

### Day 5

Deploy to canary (1% of traffic). Feature flag: batcher on. Observe:

- Batch size p50: 80.
- Batch size p99: 480 (size trigger).
- Flush duration p99: 12 ms.
- Postgres CPU on canary: dropped from 80% to 22%.
- API p99 latency: dropped from 8 ms to 3 ms.

### Day 6-9

Ramp the flag to 10%, 50%, 100% over 4 days. No incidents. Postgres CPU on the whole fleet: 30%. DBA happy.

### Day 10

Lessons learned:

- Took 4 days to deploy because we did it carefully. Worth it.
- `MaxBatchDelay = 100 ms` added 100 ms to "durability latency" but not to API latency. Educated the team on the difference.
- DLQ had 0 items in the rollout window. Encouraging.

### Day 30

Discovered an edge case: a misbehaving client sent 50K req/s for 30 seconds. Queue depth went to 90%. Some 503s. No data loss. Updated documentation: "if you see 503s on `POST /event`, ramp up your client's backoff".

This is what senior engineering looks like in practice: incremental, measured, validated.

## Comparison: Synchronous, Async, Batched

Three implementations of the same service, side by side:

### Synchronous

```go
func handler(w http.ResponseWriter, r *http.Request) {
    e := parseEvent(r)
    _, err := db.ExecContext(r.Context(), "INSERT INTO events ...", e.UserID, e.Action, e.TS)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.WriteHeader(200)
}
```

- Code: 8 lines.
- Latency: 3-5 ms.
- Throughput: ~1500 req/s per pool.
- Failure: 500 on DB error (transparent).
- Durability: synchronous; no loss.

### Async (Fire-and-Forget)

```go
func handler(w http.ResponseWriter, r *http.Request) {
    e := parseEvent(r)
    go func() {
        _, _ = db.ExecContext(context.Background(), "INSERT ...", ...)
    }()
    w.WriteHeader(202)
}
```

- Code: 8 lines.
- Latency: 1 ms.
- Throughput: ~50K req/s.
- Failure: silent (no error path).
- Durability: terrible; lost on crash, lost on DB error.

### Batched

```go
func handler(w http.ResponseWriter, r *http.Request) {
    e := parseEvent(r)
    ctx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
    defer cancel()
    if err := batcher.Add(ctx, e); err != nil {
        http.Error(w, err.Error(), 503)
        return
    }
    w.WriteHeader(202)
}
```

- Code: 10 lines (plus 250 lines for the batcher).
- Latency: 1 ms (or 503 on overload).
- Throughput: ~100K req/s.
- Failure: 503 on overload (graceful).
- Durability: 100 ms loss window on hard kill; otherwise reliable.

The batched version is more code but better in every operational dimension. Worth it for high-throughput services.

## Trade-Off Tables

A senior engineer often presents trade-offs as tables. Here are some for batcher design.

### `MaxBatchSize`

| Size | Latency | Throughput | Memory | Failure Cost |
|-----:|--------:|-----------:|-------:|-------------:|
| 10 | Low | Low | Low | Low |
| 100 | Low | Medium | Medium | Medium |
| 1000 | Medium | High | High | High |
| 10000 | High | Very High | Very High | Very High |

"Failure cost" is the data lost when a single batch fails. Higher size = more loss.

### `MaxBatchDelay`

| Delay | Throughput | Per-Item Latency | Crash Loss Window |
|------:|-----------:|-----------------:|------------------:|
| 1 ms | Low | Very Low | 1 ms |
| 10 ms | Medium | Low | 10 ms |
| 100 ms | High | Medium | 100 ms |
| 1 s | Very High | High | 1 s |
| 10 s | Maximum | Very High | 10 s |

The crash loss window is the worst-case data lost on hard kill.

### `QueueDepth`

| Depth | Backpressure Surface | Memory | Burst Absorption |
|------:|---------------------:|-------:|-----------------:|
| 1 | Immediate (synchronous) | Low | None |
| 100 | Quick | Low | 100 items |
| 10K | Slow | Medium | 10K items |
| 1M | Very Slow | High | 1M items |

"Backpressure surface" is how quickly producers feel the slowdown when the consumer is busy.

### Flushers (Pipeline Workers)

| Workers | Throughput | Ordering | Memory |
|--------:|-----------:|---------:|-------:|
| 1 | Baseline | Strong | Baseline |
| 2 | 2x (if sink supports) | Weak | 2x |
| 4 | 4x | Weak | 4x |
| 16 | Plateau | Weak | 16x |

The plateau depends on the sink's concurrency capacity.

## Numerical Examples

Some numbers worth knowing for back-of-envelope:

### Postgres COPY FROM

- Per-call overhead: ~1-3 ms
- Per-row overhead: ~10 µs (depends on schema)
- Throughput: 50K-500K rows/s per connection

For a 1000-row batch: 1-3 ms + 10 ms = 11-13 ms.

### Postgres Multi-Row INSERT

- Per-call: ~3-5 ms
- Per-row: ~50 µs
- Throughput: 5K-20K rows/s per connection

For a 100-row batch: 3-5 ms + 5 ms = 8-10 ms.

### Kafka Produce

- Per-call: ~2-5 ms (one round-trip)
- Per-record: ~1 µs (negligible)
- Throughput: 100K-1M records/s per broker

For a 1000-record batch: 2-5 ms + 1 ms = 3-6 ms.

### HTTP _bulk

- Per-call: 10-50 ms (TLS, parsing)
- Per-doc: ~10 µs
- Throughput: 10K-100K docs/s per server

For a 1000-doc batch: 10-50 ms + 10 ms = 20-60 ms.

### gRPC Unary

- Per-call: ~1-3 ms
- Per-byte: negligible
- Throughput: 50K-200K calls/s per server

These are starting points. Measure your actual numbers.

## Where to Put the Batcher in the Codebase

Code organisation questions for senior engineers:

- **In the handler**: the handler creates a per-request batch and flushes at end. Easy, but no cross-request amortisation. Use for end-of-request flushing.
- **In a service struct**: a shared batcher attached to the service. Standard.
- **In a separate package**: reusable batcher library. Good when you have many similar batchers.
- **In an init function**: a global batcher. Anti-pattern; avoid.
- **In dependency injection**: the batcher is a dependency, wired up at startup. Standard for fx/wire.

Recommend: dependency injection with a service-attached or package-attached batcher.

## Designing Across Failure Modes

A senior engineer thinks about failure modes upfront and designs to make each one graceful.

### Failure: Downstream Slow

Symptom: flush latency rises; queue depth grows.

Design response:
- Per-flush timeout (fail fast).
- Bounded queue (surface backpressure).
- 503 to clients (don't queue indefinitely).
- Metric alert at 80% queue.

### Failure: Downstream Down

Symptom: every flush errors out.

Design response:
- Retry layer with bounded budget.
- Circuit breaker opens after sustained failures.
- DLQ for items the breaker rejects.
- Manual or automated DLQ replay when downstream recovers.

### Failure: Process Crash

Symptom: buffer contents lost.

Design response:
- Upstream must be replayable (Kafka with retention).
- `MaxBatchDelay` bounds the worst-case loss window.
- Idempotency in the downstream so replay is safe.

### Failure: Memory Pressure

Symptom: process near OOM.

Design response:
- Bounded buffer (`QueueDepth` * `MaxBatchSize`).
- Bounded retry queue.
- Bounded DLQ (if local; if external like Kafka, it is the remote's bound).
- Force-flush on memory pressure (rare).

### Failure: Partial Network Partition

Symptom: some downstream replicas reachable, others not.

Design response:
- Pool retries against multiple replicas.
- Fail to alternative replica if primary unreachable.
- Don't pin connections to a specific replica; let the driver rebalance.

### Failure: Schema Drift

Symptom: in-flight batch has old schema; new code rejects it.

Design response:
- Versioned items.
- Old version readable by new code (forward compatibility).
- Don't add required fields without a default; don't remove fields without deprecation.

### Failure: Misconfiguration

Symptom: someone sets `MaxBatchDelay` to 1 minute by mistake; items lose freshness.

Design response:
- Validation in `New()`.
- Sane defaults if not set.
- Alert on parameter values that look unusual.

### Failure: Bug in Sink

Symptom: sink panics on some inputs.

Design response:
- Recover in the flush call site.
- Isolate the bad item (split-and-retry) or DLQ the whole batch.
- Log the panic with item shape.

## Patterns We Did Not Cover

A senior should know these exist even if we did not explore them deeply:

- **Coalescing batchers**: combine semantically related items (e.g., multiple updates to same key collapse).
- **Streaming batchers**: emit partial batches in a stream rather than discrete flushes; for sinks like Kinesis.
- **Hierarchical batchers**: regional batchers ship to a global batcher; two-tier amortisation.
- **Erasure-coded batchers**: split a batch into N pieces with parity, ship to N replicas; can lose any K-N.
- **Lock-free MPMC batchers**: for very high throughput; replace channel with ring buffer.
- **Per-key serialisation batchers**: items with the same key go through the same single-threaded path.

Each of these is a senior-to-staff design topic. Knowing they exist lets you reach for them when needed.

## Mental Models for Operations

When operating a batched system, useful mental models:

### Three Queues

Every batcher has three queues:

1. The input queue (channel between producers and run loop).
2. The buffer (the in-progress batch).
3. The flush queue (between run loop and flushers).

Each can be a bottleneck. Each can fill. The metric `queue_depth` should report all three (or at least the first), so you know which is the constraint.

### Two Latencies

There are two latencies in a batched system:

1. **API latency**: time from client request to response. Includes Add (fast).
2. **Durability latency**: time from client request to item-in-sink. Includes Add + buffer wait + flush.

They are different SLOs. Document both.

### One Bottleneck

At any moment, exactly one thing is the bottleneck: the producer, the channel, the run loop, the buffer, the flush queue, the network, the sink. Profile to find which. Move it. Repeat.

## Operational Story: A Day in the Life

A typical operational story for a batcher in production.

09:00. Engineer X deploys a new version of the service. The batcher's `MaxBatchSize` was changed from 500 to 1000 based on capacity planning.

09:05. Dashboards show batch size p99 climbing from 480 to 950. Throughput per flush doubled; flush rate halved. Queue depth dropped (faster amortisation).

09:30. p99 flush duration rose from 30 ms to 65 ms (larger batches take longer). No alerts because still under threshold.

10:00. Postgres CPU drops from 60% to 35% — bigger batches = fewer parse+plan operations.

11:00. Engineer X removes the `MaxBatchSize = 1000` from the rollout doc as "verified safe at peak".

14:00. Brief traffic spike to 3x peak. Queue depth rises to 50% of cap. Producers see brief 50 ms tail on `Add`. No 503s.

18:00. Daily report shows: 4.3M events processed; 0 DLQ items; 0 drops; 99.999% durability.

A boring day, in the best sense. The batcher is doing exactly what it was designed to do. Senior engineering is the difference between exciting days and boring days.

## When the System Outgrows the Batcher

At some point, the application-level batcher is no longer enough. Signs:

- Memory pressure from buffering.
- Latency budget consumed entirely by batcher.
- Multi-region complexity exceeds what app code can handle.
- Schema evolution outpaces code changes.

At that point, consider:

- **Move batching to a sidecar**: a separate process (often a service mesh proxy) batches downstream calls.
- **Move batching to a dedicated ingestion service**: an "ingestion API" that batches and persists.
- **Use a streaming platform**: Kafka, Pulsar, Kinesis. They are batchers with extra features.

Each of these is a step up in operational complexity. Don't reach for them prematurely.

## Detailed Design Document: Audit Log Batcher

A worked design doc for a senior engineer to write before coding.

### Purpose

Buffer audit events generated by the API service and flush to Postgres `audit_log` table.

### Requirements

- Functional: every API call generates one audit event. Events are immutable. All events must reach Postgres.
- Throughput: peak 50K events/s.
- Latency: API call latency must not include database write latency.
- Durability: at-most one event lost per million on clean shutdown. Zero events lost on transient downstream failures.
- Observability: dashboards for batch size, flush rate, queue depth, error rate.

### Non-Requirements

- Real-time visibility (events can be 100 ms behind).
- Per-event acknowledgement to client (the API returns 202 after enqueue).
- Cross-tenant ordering (within-tenant ordering is preserved by the schema; cross-tenant order does not matter).

### Architecture

```
API handler
  |
  v
batcher.Add (50 ms timeout) -> 503 on overflow
  |
  v
[ shared batcher: MaxBatchSize=500, MaxBatchDelay=100 ms, QueueDepth=8192 ]
  |
  v
[ pipeline: 4 flush workers ]
  |
  v
[ retry layer: 3 transient retries, exponential backoff ]
  |
  v
[ circuit breaker: opens after 50% failure for 60s ]
  |
  v
[ pgxpool (size=8) ]
  |
  v
Postgres audit_log (CopyFrom)

(on flush error, after retry exhaustion)
  |
  v
[ DLQ: Kafka topic "audit-dlq" ]
```

### Sizing

- 50K/s peak * 100 ms delay = 5000 items expected in buffer. `MaxBatchSize = 500` * 10 buffered batches = 5000. OK.
- `QueueDepth = 8192` covers 160 ms of peak.
- 4 flush workers * 500 items each = 2000 items in flight. Pool size 8 supports 4 concurrent + 4 headroom.

### Triggers

- Size (500): hot path, primary.
- Time (100 ms): cold path.
- Shutdown: drain all, 30 s deadline.

### Shutdown

`Shutdown(ctx)` with 30 s deadline. On timeout, log "audit_log: drained N, dropped M items".

Order:
1. `srv.Shutdown(httpCtx)` (5 s).
2. `batcher.Shutdown(ctx)` (25 s).
3. `pool.Close()`.

### Observability

Metrics emitted (all labelled `name="audit"`):

- `batcher_flush_total{name, reason}`
- `batcher_batch_size_items{name}`
- `batcher_flush_duration_seconds{name, result}`
- `batcher_queue_depth{name}`
- `batcher_dlq_total{name}`

Alerts:

- `batch_size_items{name}` p50 < 100 for 5m -> "low batch utilisation" (info).
- `flush_duration_seconds{name}` p99 > 5 s for 2m -> "sink slow" (warn).
- `queue_depth{name}` > 6000 for 1m -> "queue full" (page).
- `flush_total{name, result="error"}` rate > 0.1/s for 5m -> "error rate elevated" (warn).
- `dlq_total{name}` rate > 1/s for 5m -> "dlq filling" (warn).
- `dlq_total{name}` rate > 100/s for 1m -> "dlq flooding" (page).

### Testing

Unit tests with fake clock:

- Size trigger fires at 500 items.
- Time trigger fires at 100 ms with non-empty buffer.
- Shutdown drains buffer.
- Shutdown timeout returns error and counts drops.
- Retry succeeds after 2 transient failures.
- Circuit breaker opens after 5 failures.
- DLQ receives permanent failures.

Integration test with real Postgres (testcontainers):

- Insert 100K events, verify all land.
- Inject Postgres downtime for 30 s, verify retries and recovery.
- Inject Postgres constraint violation, verify DLQ.

Load test:

- Sustained 50K/s for 5 minutes. Verify p99 latency under 50 ms.
- Burst to 200K/s for 30 s. Verify queue depth bounded, 503s returned.

Chaos test:

- Random SIGTERM during sustained load. Verify drain SLA.
- Random network partition between batcher and Postgres for 1 minute. Verify recovery.

### Operations

Runbook entries:

- "Queue depth alert": check downstream health; check `flush_duration_seconds`; consider scaling.
- "DLQ flooding": classify DLQ items; if all same error, fix root cause; if mixed, investigate.
- "Items missing after deploy": check shutdown logs; verify drain completed within deadline.

### Risk Analysis

- **Postgres down for > 30 minutes**: Kafka DLQ fills. Need monitoring on DLQ topic.
- **Schema migration**: must be backward compatible. Batches in flight during migration have old schema.
- **CPU bound**: serialisation hot loop. Profile and optimise.
- **Memory pressure**: 50K events * 1 KB each = 50 MB. Per-batcher cap holds.

### Rollout

1. Deploy to canary (1% of traffic). Run 24 hours. Verify metrics.
2. Deploy to 10% (audit log only). Run 48 hours.
3. Deploy to 100%.

### Rollback

If issues: feature flag to bypass the batcher and write synchronously. Throughput will drop but correctness preserved.

This is what a senior engineer writes before writing code. Reading this should give a reviewer enough to approve or push back on the approach.

## Senior-Level Interview Questions to Expect

When interviewing for staff/senior, you may be asked:

**Q1.** "Design a service that ingests 1M events/s and writes them to Postgres."

Expected answer: shards + per-shard batchers + COPY FROM + backpressure on overflow + DLQ + metrics. Discuss trade-offs of `MaxBatchSize`, ordering across shards, multi-region.

**Q2.** "Your service has a 100 ms p99 SLO. The downstream is Postgres with 20 ms p99 query latency. Can you batch?"

Expected answer: yes, with `MaxBatchDelay <= 50 ms`. Add 20 ms for the flush, 30 ms headroom for queue and scheduling. Verify with load test.

**Q3.** "How do you ensure no items are lost on SIGTERM?"

Expected answer: `Shutdown(ctx)` with deadline; on timeout, log unprocessed items; rely on upstream replay (Kafka, idempotent retries). True zero-loss requires write-ahead-log inside the batcher, which is heavy.

**Q4.** "Two services share a downstream batcher. One tenant is misbehaving. How do you protect the other?"

Expected answer: per-tenant sub-batchers, per-tenant memory caps, per-tenant retry budgets, DLQ per tenant.

**Q5.** "Your batcher's p99 latency is fine but p99.9 is 30 seconds. What is happening?"

Expected answer: rare cascade: shutdown drain, GC pause, downstream throttle, sink retry. Look at traces, not metrics. Check that retries are bounded.

**Q6.** "The downstream API is rate-limited at 100 calls/s. Your traffic peaks at 50000 items/s. How big are your batches?"

Expected answer: at least 500 items per call. With 100 calls/s budget, that is 50000 items/s capacity. Account for headroom: aim for 70 calls/s, 700 items per batch. If batches don't fill, the time trigger fires and you under-utilise; tune `MaxBatchDelay`.

**Q7.** "When should you NOT batch?"

Expected answer: synchronous user-facing writes; very low volume; downstream already batches; ordering across batches required and not provided; partial success not supported by downstream.

**Q8.** "How do you test that a batcher loses no data on clean shutdown?"

Expected answer: deterministic test with fake clock, sink that records all items, `Add` known set, `Shutdown(ctx)`, assert sink received all.

**Q9.** "Your batch is too big for the downstream. The downstream rejects with 413. What do you do?"

Expected answer: split-and-retry. The retry layer splits the batch into halves and retries each. Recursive split until each piece fits.

**Q10.** "How would you scale a batcher from 10K items/s to 1M items/s?"

Expected answer: shard the input (consistent hashing by key); per-shard batchers; per-shard sink connections (or pool with > shard count); horizontal scaling of the service; multi-region if cross-DC bandwidth matters.

## A Look at What Other Systems Do

A survey of how high-throughput systems batch.

### Kafka Broker

The broker batches incoming produce requests (group commit), batches log appends to the page cache, and batches fsyncs to disk. Three layers of batching, each tuned by config:

- `num.io.threads`: parallel writers.
- `log.flush.interval.ms`: time trigger on fsync.
- `log.flush.interval.messages`: size trigger on fsync.

### TigerBeetle

A high-throughput accounting database. Batches I/O extremely aggressively: 8 KB of transfers per disk write, scheduled by an internal state machine. The throughput is millions of transactions/s.

### Postgres

`commit_delay` and `commit_siblings` let you batch group commits. Off by default; useful for very write-heavy OLTP.

### Cassandra

Per-partition write batches. The driver batches client-side; the coordinator batches across replicas.

### Elasticsearch

Indexing is batched on the bulk endpoint. Internal refresh interval defaults to 1 second; that is itself a batching layer.

### Prometheus Remote Write

500 samples per request, 5 second deadline. Configurable.

### OpenTelemetry SDK

512 spans per export, 5 second delay. Configurable.

The pattern is universal: every high-throughput system batches at multiple layers. The art is in the configuration, not the algorithm.

## Patterns for Combiner-Style Batchers

A combiner-style batcher merges items. Examples:

### Counter Aggregation

```go
type CounterCombiner struct {
    counts map[string]int64
}

func (c *CounterCombiner) Add(key string, delta int64) {
    c.counts[key] += delta
}

func (c *CounterCombiner) Drain() map[string]int64 {
    out := c.counts
    c.counts = make(map[string]int64)
    return out
}
```

In a metrics batcher, "increment counter X" is the item. Aggregation reduces 1000 events to 1 row.

### Distinct Set

```go
type DistinctCombiner struct {
    set map[string]struct{}
}

func (d *DistinctCombiner) Add(key string) {
    d.set[key] = struct{}{}
}

func (d *DistinctCombiner) Drain() []string {
    out := make([]string, 0, len(d.set))
    for k := range d.set {
        out = append(out, k)
    }
    d.set = make(map[string]struct{})
    return out
}
```

For "send a notification per unique recipient", the combiner deduplicates.

### Sketches

For approximate distinct counting at scale, HyperLogLog or Count-Min Sketch. The combiner merges sketches:

```go
type HLLCombiner struct {
    sketch *hyperloglog.HyperLogLog
}

func (h *HLLCombiner) Add(key string) {
    h.sketch.Insert([]byte(key))
}

func (h *HLLCombiner) Drain() *hyperloglog.HyperLogLog {
    s := h.sketch
    h.sketch = hyperloglog.New()
    return s
}
```

The flushed sketch is small (~1.5 KB) and can be combined with other sketches downstream.

### Window-Based Aggregation

For "count requests per second", a tumbling window:

```go
type Window struct {
    start time.Time
    counts map[string]int
}

func (w *Window) Add(key string, t time.Time) {
    if t.Sub(w.start) > windowSize {
        // flush old, start new
    }
    w.counts[key]++
}
```

This blurs into stream processing. For application code, a simple time-trigger flush often suffices.

## Designing a Reusable Batcher Library

If you find yourself writing batchers repeatedly, package one:

```go
package gobatch

type Item any
type Sink[T Item] interface {
    Write(ctx context.Context, batch []T) error
}

type Batcher[T Item] struct {
    /* ... */
}

func New[T Item](opts ...Option[T]) (*Batcher[T], error) { /* ... */ }
```

Design principles:

- **Generic over Item**: the user's items can be any type.
- **Options pattern**: `WithMaxBatchSize(n)`, `WithMaxBatchDelay(d)`, etc.
- **Sink interface**: pluggable.
- **Testability**: clock abstraction, metrics interface.
- **No magic**: explicit configuration only.

Reference: OpenTelemetry's `BatchSpanProcessor` is roughly this shape.

### Versioning the Library

Once you ship a batcher library, breaking changes are painful. APIs to keep stable:

- The Sink interface.
- The Add and Shutdown methods.
- The error types.

APIs that can evolve:

- The internal state (struct fields).
- The metrics labels (with deprecation cycle).
- The default config values.

Use semver. Tag breaking changes as major.

## Batching Across the Wire

Some patterns batch at the network protocol level, not in application code.

### HTTP/2 Multiplexing

HTTP/2 can carry many concurrent requests over one connection. From the application's perspective, this is "no batching needed"; the protocol handles connection reuse. But response-side compaction (the server returns many responses in one TCP packet) is a form of batching.

### gRPC Streaming

A gRPC server-stream sends many responses to one request. Sometimes used for "subscribe to events" — but the server can choose to batch its sends.

### Pipelining

A protocol that allows multiple requests in flight without waiting for responses. Redis pipelining is the canonical example. From the application's view, you batch many commands; the protocol sends them as one stream.

Pipelining is conceptually similar to batching. The difference is *protocol level* vs *application level*. Pipelining is for protocols that support it; application batching is for everything else.

## A Real Multi-Tenant Production Pattern

Designing a multi-tenant batcher for a SaaS ingestion service.

### Requirements

- 10000 tenants. Range from 1 item/s to 100 items/s per tenant.
- Tenant isolation: a bad tenant cannot affect others.
- Aggregate throughput: 100K items/s.
- Per-tenant durability: 99.99%.
- Latency budget: 100 ms p99 from API call to ack.

### Design

```
HTTP handler
  |
  v
[tenant router] -> hash(tenantID) -> [shard 0..N]
  |
  v
[shard batcher] (one per shard, ~1000 tenants each)
  |
  v
[per-tenant sub-batch within shard]
  |
  v
[shard flush worker pool]
  |
  v
Postgres (per-tenant schema)
```

Each shard has:

- One main goroutine (run loop).
- Per-tenant buffer (map).
- Per-tenant timer.
- A pool of flush workers (size 4).

### Memory Bound

Per shard: 1000 tenants * 100 items * 1 KB = 100 MB. Per service (16 shards): 1.6 GB. Set a cap; refuse items from tenants over their per-shard limit.

### Fairness

The shard's flush worker pool drains a flush queue. The queue is FIFO; small tenants and large tenants get fair treatment. A single tenant cannot starve others as long as we use one batcher per shard, not one per tenant.

### Failure Isolation

A tenant's batch failure is logged and DLQ'd. Other tenants' batches are unaffected.

### Observability

Metrics labelled by shard (not tenant; cardinality bomb otherwise). For per-tenant insights, log-based metrics or sampled tracing.

### Scaling

To handle 200K items/s: double the shards. Each shard is independent.

### Trade-offs

- More shards = better isolation, more memory.
- Larger per-tenant timers = larger batches per tenant, more amortisation.
- Smaller per-tenant timers = lower latency per tenant.

This is a real-world senior design problem. The answer is not "one batcher"; it is a system of batchers with explicit fairness rules.

## Hardware Considerations

Senior tuning sometimes considers hardware:

### Network

- Bandwidth: a 10 Gb/s NIC at 50% utilisation is 600 MB/s. A 1 KB item at 100K/s is 100 MB/s. Plenty of headroom.
- Latency: cross-DC RTT 50 ms. Per-flush cost is dominated by RTT, not bandwidth.
- Packet loss: TCP retransmits add to tail latency. Monitor.

### Storage

- Disk IOPS: a Postgres COPY does many sequential writes. SSDs at 100K IOPS easily saturate any reasonable batcher.
- WAL fsync: each commit fsyncs WAL. Group commit can amortise (`commit_delay`, `synchronous_commit=local`).

### CPU

- Sequence: serialisation, compression, then network. Each can be a bottleneck.
- Profile: use `pprof` to see where time goes.
- Vectorisation: if you serialise lots of small records, SIMD-accelerated codecs (like `vtprotobuf`) can help.

### Memory

- Per-batch allocation: profile with `-memprofile`. Big sources are item copies and serialisation buffers.
- GC pressure: many small allocations stress the GC. Use `sync.Pool` for buffers.

## Working with Vendored Client Libraries

When the sink is a vendor SDK (AWS, Azure, GCP), batching capabilities vary. Notes from real usage:

### AWS DynamoDB

`BatchWriteItem` takes up to 25 items per call. Items can be Put or Delete. Items in a batch can target different tables. On failure, partial success returns `UnprocessedItems` — you must retry just those.

Code:

```go
func (s *DynamoSink) Write(ctx context.Context, batch []Item) error {
    writeReqs := make([]types.WriteRequest, len(batch))
    for i, item := range batch {
        writeReqs[i] = types.WriteRequest{
            PutRequest: &types.PutRequest{Item: marshall(item)},
        }
    }
    input := &dynamodb.BatchWriteItemInput{
        RequestItems: map[string][]types.WriteRequest{
            s.table: writeReqs,
        },
    }
    out, err := s.client.BatchWriteItem(ctx, input)
    if err != nil {
        return err
    }
    if len(out.UnprocessedItems) > 0 {
        return fmt.Errorf("unprocessed: %d items", len(out.UnprocessedItems[s.table]))
    }
    return nil
}
```

`MaxBatchSize = 25` is the natural cap. Above that, your batcher needs to split.

### AWS S3 PutObject (Batched via Manifest)

S3 PutObject is not batched per se, but for many small objects, write a manifest file referencing them. The "batch" is the manifest plus the small files. For very small items, write them concatenated into one S3 object instead — one PUT, many logical items.

This is a different pattern than per-call batching but the same idea: amortise per-call cost.

### Google Cloud Pub/Sub

Pub/Sub Go client batches by default. Configure with `pubsub.PublishSettings`:

```go
client.Topic("foo").PublishSettings = pubsub.PublishSettings{
    CountThreshold: 100,
    DelayThreshold: 10 * time.Millisecond,
    ByteThreshold:  1024 * 1024,
}
```

The client handles batching internally. Use the library; do not duplicate.

### Confluent Kafka Go Client

Similar to franz-go. `librdkafka.queue.buffering.max.ms` is linger. `batch.size` is the per-batch byte cap.

## Concurrency Control Across Batcher Instances

If your service has multiple batcher instances (per shard, per tenant, per priority class), they share infrastructure: database connections, network bandwidth, CPU.

Coordination patterns:

- **Pool-aware sizing**: each batcher knows the global pool size and limits its concurrency.
- **Token-based flushing**: a shared semaphore limits concurrent flushes across all batchers.
- **Centralised throttling**: a sidecar or proxy throttles all sinks.

Coordination adds complexity. For 2-3 batchers, do nothing. For 100+, coordinate.

## The Difficulty of Exactly-Once

"Exactly-once" delivery is a perennial topic. With a batcher:

- **At-most-once**: items can be lost (no retry).
- **At-least-once**: items can be duplicated (retries; downstream must dedupe).
- **Exactly-once**: items processed exactly once. Requires coordination across producer, batcher, and sink.

For most practical purposes, at-least-once with idempotent sink is the right answer. Trying to achieve true exactly-once usually requires transactional outbox, which is beyond the batcher.

## Multi-Producer Coordination

If your producers are spread across machines (e.g., a distributed service), they may all have local batchers. Each ships to a central downstream. Trade-offs:

- More batchers = more parallelism, more aggregate throughput.
- More batchers = smaller per-batch size (each batcher's local rate is lower than total).
- More batchers = more shutdown coordination.

Sometimes a single central batcher (a sidecar or "ingestion service") gives bigger batches and simpler operations. Other times distributed batching is fine.

## A Deep Look at Adaptive Sizing With Control Theory

The naive adaptive sizer in earlier sections uses heuristics. A control-theoretic approach uses a proportional-integral-derivative (PID) controller:

```go
type PIDController struct {
    setpoint float64
    kp, ki, kd float64
    integral float64
    lastErr  float64
    lastTime time.Time
}

func (p *PIDController) Update(measured float64, now time.Time) float64 {
    err := p.setpoint - measured
    dt := now.Sub(p.lastTime).Seconds()
    if dt <= 0 {
        dt = 1
    }
    p.integral += err * dt
    deriv := (err - p.lastErr) / dt
    p.lastErr = err
    p.lastTime = now
    return p.kp*err + p.ki*p.integral + p.kd*deriv
}
```

For batch sizing, the "setpoint" might be 80% utilisation of batches. The "measured" is current utilisation. The output is an adjustment to `MaxBatchSize`.

Tuning PID gains is its own art (Ziegler-Nichols, manual tuning). For a batcher, kp dominates: rate of response to deviation. ki handles long-term steady-state error. kd dampens oscillation.

In practice, simple proportional control with a long observation window works for most batchers. PID is overkill for typical use; reach for it only if simple control oscillates persistently.

## Token Bucket Throttling

When the sink has a rate limit and you want to smooth bursts, layer a token bucket between batcher and sink:

```go
import "golang.org/x/time/rate"

type ThrottledSink struct {
    inner   Sink
    limiter *rate.Limiter
}

func (t *ThrottledSink) Write(ctx context.Context, batch []Item) error {
    if err := t.limiter.WaitN(ctx, len(batch)); err != nil {
        return err
    }
    return t.inner.Write(ctx, batch)
}
```

`WaitN(ctx, len(batch))` accounts for the batch size — a batch of 100 items consumes 100 tokens. The limiter's `Burst` should be at least `MaxBatchSize` so a single batch can pass.

This combines well with batching: amortise the per-call cost, then throttle to the sink's rate. Result: a steady, bounded stream into the sink.

## Bulkhead Isolation

When a single batcher serves multiple workload classes (e.g., free users vs paid users), a problem in one class can saturate the batcher and starve the other.

The bulkhead pattern isolates classes:

- One batcher per class.
- Separate sink connection pools.
- Separate retry budgets.
- Possibly separate goroutine pools.

The cost is more state and more configuration. The benefit is fault isolation: a slowdown in paid-users does not affect free-users (and vice versa).

For consumer-facing products, bulkheading by user-tier is common.

## The Reactor Pattern Comparison

A reactor (event-loop) approach to handling many connections:

```
main loop:
  poll fd_set for ready fds
  for each ready fd:
    read/write/handle
```

Compare to a batcher:

```
main loop:
  select on input + ticker
  for each event: handle
```

They share the structure: a single goroutine processing many events. The batcher specialises in *grouping* events; the reactor specialises in *dispatching* them. Some systems combine: a reactor that dispatches events to per-shard batchers.

Erlang/OTP's `gen_server` is reactor-shaped. Go's `select` gives you the same shape natively.

## Implementation: A Topology-Aware Batcher

A senior implementation that knows about CPU topology and pins flush goroutines to specific cores:

```go
import (
    "runtime"
    "golang.org/x/sys/unix"
)

func pinFlusher(coreID int) {
    runtime.LockOSThread()
    var set unix.CPUSet
    set.Set(coreID)
    unix.SchedSetaffinity(0, &set)
}

func (b *Batcher) startFlushers() {
    numCores := runtime.NumCPU()
    for i := 0; i < b.numFlushers; i++ {
        i := i
        go func() {
            pinFlusher(i % numCores)
            b.flushWorker()
        }()
    }
}
```

This is rare and usually overkill. NUMA awareness matters only when you have a multi-socket box and the sink is also on a specific node. We will revisit this in professional.md.

## Service Mesh and Batching

In a service mesh (Istio, Linkerd), sidecar proxies can batch outbound calls. The application sees one call per request; the sidecar amortises.

This shifts the batching from application code to infrastructure. Trade-offs:

- **Pro**: less app code, less variation across services.
- **Pro**: visible in the mesh's telemetry.
- **Con**: harder to tune for specific workloads.
- **Con**: less control over partial-flush, retry, DLQ semantics.

For application-specific batching (where you need to combine items, version them, sample them), app-level is better. For uniform RPC amortisation across many services, mesh-level can work.

## A Deeper Look at Latency Composition

End-to-end latency in a batched pipeline is a stack:

```
client -> LB -> handler -> batcher.Add -> in-queue -> in-buffer -> sink-flush -> network -> sink-process -> ack -> client
```

Each segment has its own p50, p99, and p999. Some are correlated (sink-flush implies network); some are independent (handler's response time vs sink-flush).

### Modelling Latency

Approximation 1: stage latencies are independent.

```
p99_total ≈ sqrt(sum(p99_i^2)) + delta
```

(Standard deviation of a sum of independent random variables.)

Approximation 2: stage latencies are perfectly correlated (worst case).

```
p99_total = sum(p99_i)
```

Approximation 3: stage latencies have a tail correlation but not full.

In practice, ~Approximation 2 for the slow tail (long downstream calls affect everything). Use this for capacity planning.

### Where the Time Goes

For a typical batcher pipeline:

- 1 ms in `Add` (channel send, validation).
- 10-50 ms in the input queue (depends on rate).
- 0-200 ms in the buffer (waiting for trigger).
- 5-50 ms in flush (network + sink work).
- 1-10 ms back to caller (if any).

Total: 17-310 ms. The "buffer wait" dominates p99 for low-throughput cases; "queue wait" dominates for saturated cases.

### Tail Latency Mitigation

- **Reduce `MaxBatchDelay`**: tighter latency floor, smaller batches.
- **Adaptive sizing**: respond to load to balance.
- **Hedging**: send the same batch to two replicas; take the first reply. Doubles cost but cuts tail.
- **Speculative retries**: if a flush is slow, start a parallel retry. Risk: duplicates.
- **Smaller per-batch timeout**: fail fast on slow flushes; retry next batch.

## Multi-Region Architecture

A multi-region service has batchers in each region. Cross-region writes are expensive (50-200 ms RTT). Use:

- **Per-region batchers** writing to per-region sinks. Replication is downstream.
- **Single global batcher** if the workload is small and the latency cost is acceptable.
- **Two-tier**: regional batcher amortises locally, ships to global sink in larger batches.

For audit logs that must land in a single region: cross-region batchers ship batches to one region. The latency cost (50-200 ms per flush) is absorbed by larger batches; tune `MaxBatchSize` upward.

For data that can be regionally partitioned: per-region batchers and per-region sinks. Lower latency, simpler operations.

## The Batcher as a Coordination Boundary

A batcher is a serialisation point — items are linearised through the input channel. This makes it a natural place to put:

- **Sequence numbering**: tag each item with a monotonically increasing seq.
- **Deduplication**: drop items with already-seen keys.
- **Validation**: reject malformed items.
- **Enrichment**: add timestamps, request IDs.
- **Filtering**: forward only items matching a predicate.

These transformations are "free" in the sense that they happen in the run loop which would otherwise be idle. But each adds CPU cost; profile before adding many.

## Designing for a 10x Traffic Spike

Capacity planning for spikes: design for 10x peak, not steady state.

A batcher sized for 10x peak might be over-sized for steady state (mostly time-triggered batches, low fill rate). That is fine; the cost is small. Under-sizing means failure during spikes; the cost is huge.

Test: artificially burst traffic to 10x for a minute. Verify:

- Queue depth rises but stays below cap.
- Producers do not block (or 503 quickly).
- Sink keeps up or degrades gracefully.
- After the burst, queue drains in seconds.

If any fail: more capacity, smaller `MaxBatchSize`, or a fallback (DLQ).

## Per-Item vs Per-Batch SLOs

Two different SLOs for the same workload:

- **Per-item SLO**: 99% of items committed within 1 second of `Add`.
- **Per-batch SLO**: 99% of batch flushes complete within 100 ms.

These can be in tension. A larger batch is faster *per-item* (more amortised) but slower *per-batch* (more work). A smaller batch is slower per-item (less amortised) but faster per-batch.

The right SLO depends on what users care about. For audit logs: per-item (when can I see my action in the audit table?). For metrics: per-batch (how fresh is the dashboard?).

Often you have both, with different priorities.

## Knobs to Tune

A senior engineer's tuning checklist when a batcher misbehaves:

1. `MaxBatchSize`: up or down based on the throughput vs latency curve.
2. `MaxBatchDelay`: tighten for latency, loosen for throughput.
3. `QueueDepth`: increase to absorb spikes; decrease to surface backpressure earlier.
4. `FlushTimeout`: tighten to fail fast; loosen for slow legitimate downstream.
5. `Flushers`: increase for parallel sinks; decrease for ordered sinks.
6. `RetryBudget`: more retries = more chance of success, more work; fewer = faster failure.
7. `DLQ size`: enough to hold a recovery batch; not so much that you forget about it.

Tune one at a time. Measure between each. Document the result.

## Design Review Checklist

When reviewing a batcher design at the senior level, walk through:

### Triggers

- [ ] Both size and time triggers present?
- [ ] Both configurable per environment?
- [ ] Time trigger uses `time.Ticker` (drift) or `time.Timer` (precise) appropriate to the workload?
- [ ] Close-triggered flush implemented?
- [ ] Manual flush method available if needed?
- [ ] Byte-size trigger if the sink has a body limit?

### Shutdown

- [ ] `Shutdown(ctx)` with deadline?
- [ ] Documented "drain SLA" — what guarantees on shutdown?
- [ ] Idempotent (safe to call multiple times)?
- [ ] Order: stop upstream, then `Shutdown`?
- [ ] On timeout, items in unknown state are counted and logged?

### Errors and Retries

- [ ] Classified into permanent / transient / throttle / partial?
- [ ] Retry layer external to the batcher (decorator)?
- [ ] Exponential backoff with jitter?
- [ ] Bounded retry budget?
- [ ] DLQ for permanent errors?
- [ ] Circuit breaker for sustained failures?
- [ ] Per-flush timeout via `context.WithTimeout`?

### Observability

- [ ] Batch size histogram?
- [ ] Flush duration histogram?
- [ ] Flush reason counter?
- [ ] Queue depth gauge?
- [ ] Flush failure counter?
- [ ] Sink-level metrics (per-call latency, per-call status)?
- [ ] Tracing with span links?
- [ ] Logs with reason and size on every flush?

### Concurrency

- [ ] Single owner of the buffer?
- [ ] No mutex around the buffer?
- [ ] Producers safe to call from many goroutines?
- [ ] `Close`/`Shutdown` safe to call concurrently with `Add`?

### Backpressure

- [ ] Bounded input channel?
- [ ] Policy: block, drop, or grow — documented?
- [ ] If block: deadline on `Add` ctx?
- [ ] If drop: counter on dropped items?
- [ ] Upstream signalling (503, RST, ResourceExhausted)?

### Multi-Tenancy

- [ ] Per-tenant isolation if needed?
- [ ] Per-tenant memory bounded?
- [ ] Fairness considered if tenants vary 10x or more?

### Testing

- [ ] Fake clock for deterministic time-trigger tests?
- [ ] Tests for each trigger (size, time, close, manual)?
- [ ] Shutdown timeout test?
- [ ] Retry-on-transient test?
- [ ] All tests run with `-race`?

### Operations

- [ ] Runbook for "low throughput"?
- [ ] Runbook for "high latency"?
- [ ] Runbook for "items missing after deploy"?
- [ ] Alert on queue depth > 80%?
- [ ] Alert on flush failure rate > 1%?
- [ ] Alert on flush duration p99 > MaxBatchDelay?

This checklist is the senior engineer's design-review tool. Use it before approving a batcher PR.

## Cross-System Interactions

A batcher does not live alone. It interacts with rate limiters, circuit breakers, schedulers, queues. Some real interactions worth knowing.

### Batcher Behind Rate Limiter

If the sink's rate limit is "N items per second" and the batcher flushes B items per batch every D seconds, then `B / D <= N`. If the batcher exceeds the rate, the rate limiter blocks the flush, the batcher's run loop stalls, the input channel fills, producers block.

The right answer is to size the batcher so that `MaxBatchSize / MaxBatchDelay <= N`. If `MaxBatchDelay = 100 ms` and `N = 1000`, then `MaxBatchSize <= 100`. Or: relax the rate limit. Or: add more batchers.

### Batcher In Front of Cache Warmer

A batcher feeding a cache warmer (writes to a cache to speed up later reads). Often the cache writes are best-effort, so the batcher can drop on overflow. The combiner pattern is often used: many "warm key X" requests collapse into one.

### Batcher In Front of Notification Service

A notification batcher collapses 50 "user followed you" events into one push. The combiner sums per recipient; the time window is generous (5-30 seconds) because pushes are not real-time.

Trade-off: longer window = fewer pushes (good) but worse responsiveness (bad).

### Batcher Behind CDC

CDC reads change events from a database and replicates them. A batcher in this pipeline can amortise the downstream writes (to Elastic, to Kafka). Order is critical (CDC events are causally ordered); single-flusher is required.

If the downstream is partitioned (per-key), per-key sub-batchers can preserve order while parallelising.

## A Tale of Two Architectures

Two services with the same goal, different architecture.

### Service A: Direct Writes

```
HTTP handler --> pgx.Exec("INSERT INTO ... VALUES ($1, $2, $3)")
```

Per-request latency: 5 ms (network) + 2 ms (DB) = 7 ms.

Throughput ceiling: ~14000 req/s per connection pool with 100 connections.

Operational complexity: low.

Risk on crash: zero (synchronous commit).

### Service B: Batched Writes

```
HTTP handler --> batcher.Add (1 ms) --> [batcher with 100 maxSize, 50 ms maxDelay] --> CopyFrom
```

Per-request latency: 1 ms.

Throughput ceiling: ~100000 req/s (batched COPY is fast).

Operational complexity: moderate.

Risk on crash: up to 100 ms of buffered items.

### Choosing

- Throughput need 1000 req/s, no spike: Service A.
- Throughput need 50000 req/s, occasional spike to 200000: Service B.
- Compliance: lose-zero on hard kill: Service A.
- Compliance: lose < 100 items per million on hard kill: Service B.

The right answer is workload-dependent. Senior engineering is the discipline of asking these questions before choosing.

## Reading List

- "Designing Data-Intensive Applications" (Kleppmann): chapter on batch vs stream processing.
- "Site Reliability Engineering" (Beyer et al.): the SLO chapter; informs your batcher's SLOs.
- Kafka documentation: the producer's batching is the canonical reference.
- Postgres documentation: `commit_delay`, `synchronous_commit`, `wal_buffers` are all related to in-database batching.
- Tigerbeetle's blog: on the I/O batching of a high-throughput finance database.
- The OpenTelemetry Go SDK source: `sdktrace/batch_span_processor.go`.

## Case Studies

### Case Study 1: OpenTelemetry BatchSpanProcessor

The OpenTelemetry Go SDK's `BatchSpanProcessor` is a model implementation.

- **Triggers**: size (`MaxExportBatchSize`, default 512), time (`ScheduledDelay`, default 5 s), shutdown (`Shutdown(ctx)`).
- **Drop policy**: oldest items dropped if queue full (`MaxQueueSize`, default 2048).
- **Concurrency**: synchronous flush; one batch in flight.
- **Observability**: built-in metrics on drops, exports, durations.

Read the source: ~350 lines of Go. Most production batchers should look like this.

### Case Study 2: Prometheus Remote Write

Prometheus' remote write sends samples to remote storage in batches.

- **Triggers**: per-shard size (`max_samples_per_send`, default 500), time (`batch_send_deadline`, default 5 s).
- **Sharding**: per-target shards to parallelise.
- **Retries**: exponential backoff with cap; drops after N attempts.
- **Backpressure**: queue full -> drop samples (with metric).

Notable: Prometheus drops on overflow because metrics are aggregate; a few missing samples are tolerable. This is policy, not bug.

### Case Study 3: Kafka Producer

Kafka's producer client has linger and batch.size. The application calls `Produce(record, callback)`. The client batches in the background.

- **Triggers**: size (`batch.size`), time (`linger.ms`).
- **Per-partition batching**: each broker's records are batched separately.
- **Retries**: configurable via `retries` and `retry.backoff.ms`.
- **Idempotency**: enabled with `enable.idempotence=true`, dedupes via producer IDs.

The producer is a reference implementation. When in doubt about your batcher, ask "how does Kafka do this?".

### Case Study 4: The Database/sql Pool

Not a batcher per se, but related. `*sql.DB` is a connection pool. When your batcher calls `db.ExecContext` concurrently, the pool handles connection allocation. Tuning:

- `MaxOpenConns`: at least equal to concurrent flushes.
- `MaxIdleConns`: keep connections warm.
- `ConnMaxLifetime`: rotate to handle DB-side restarts.

A misconfigured pool turns a fast batcher into a slow one.

---

## Self-Assessment

- [ ] I can place batchers correctly in a multi-tier architecture.
- [ ] I can compute a latency budget that includes batching contribution.
- [ ] I can implement adaptive batch sizing with hysteresis.
- [ ] I can design per-tenant fair batching without breaking amortisation.
- [ ] I can compose a batcher with circuit breaker, rate limiter, retry, and DLQ.
- [ ] I can explain when to use application batching vs library batching.
- [ ] I can plan capacity for a batcher-heavy service.
- [ ] I can conduct a security review of an audit-log batcher.
- [ ] I can run chaos tests against a batcher and interpret the results.
- [ ] I can list five anti-patterns and explain how to detect each.

---

## Summary

Senior batching is not about the code inside `run()`. It is about the system around the batcher: latency budgets, fairness, backpressure composition, capacity planning, security, migration. The code is a junior or middle exercise; the architecture is the senior exercise.

You have a batcher in production. You know what knobs to turn. You know what to measure. You know what to expect when things break. The next file, `professional.md`, takes the deepest dive: ring buffers, lock-free accumulators, NUMA, and the internals of Kafka and Postgres that you have been calling all along.
