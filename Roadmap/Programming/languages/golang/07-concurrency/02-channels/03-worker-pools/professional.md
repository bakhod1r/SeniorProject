# Worker Pools — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Architecture Reference](#production-architecture-reference)
3. [The Pool as a Service Component](#the-pool-as-a-service-component)
4. [Lifecycle Management at Scale](#lifecycle-management-at-scale)
5. [Backpressure Across Process Boundaries](#backpressure-across-process-boundaries)
6. [Adaptive Concurrency Control](#adaptive-concurrency-control)
7. [Failure Domains and Bulkheads](#failure-domains-and-bulkheads)
8. [Cost Model](#cost-model)
9. [Capacity Planning Workflow](#capacity-planning-workflow)
10. [Production Stack: Real Architectures](#production-stack-real-architectures)
11. [Operational Concerns](#operational-concerns)
12. [Migration Patterns](#migration-patterns)
13. [Edge Cases at Scale](#edge-cases-at-scale)
14. [Production Readiness Checklist](#production-readiness-checklist)
15. [Summary](#summary)

---

## Introduction
> Focus: "I run a fleet of services. Pools are everywhere. How do I keep them from being the cause of every incident?"

Professional-level pool work is operational. The pattern is no longer interesting; what matters is what happens when the pool meets reality:
- Traffic spikes 10x during a flash sale.
- Downstream service degrades; pool fills; cascading timeout.
- Memory leak in a worker; pod OOMs; new pod starts; problem returns.
- Pool runs fine for 23h; at midnight a cron triggers and it deadlocks.

This file is about pools as production components — how to design, deploy, monitor, and evolve them in services that real users depend on.

---

## Production Architecture Reference

```text
            ┌─────────────────────────────────────────────────┐
            │ Load Balancer (rate limit, circuit break)       │
            └────────────────────┬────────────────────────────┘
                                 ▼
            ┌─────────────────────────────────────────────────┐
            │ HTTP Server                                     │
            │   admission control: token bucket, semaphore    │
            └────────────────────┬────────────────────────────┘
                                 ▼
            ┌─────────────────────────────────────────────────┐
            │ Worker Pool                                     │
            │   N = sized via Little's Law                    │
            │   queue: bounded, reject on overflow            │
            │   ctx-propagated, instrumented                  │
            └────────┬───────────────────────┬────────────────┘
                     ▼                       ▼
            ┌────────────────┐      ┌─────────────────┐
            │ DB conn pool   │      │ Downstream API   │
            │  (sized 1.5×N) │      │  (rate limited)  │
            └────────────────┘      └─────────────────┘
```

Three pools, layered:
1. **HTTP admission** — bounds concurrent requests.
2. **Worker pool** — bounds processing.
3. **Resource pools** — bound DB and HTTP-client concurrency.

Each layer's size is derived from the next, not picked independently.

---

## The Pool as a Service Component

A production pool is rarely a `[]chan Job` and `WaitGroup`. It is a struct with a lifecycle, configuration, and observability:

```go
type Pool struct {
    name    string
    cfg     Config
    jobs    chan Job
    workers []*worker
    metrics Metrics
    logger  *slog.Logger

    once   sync.Once
    cancel context.CancelFunc
    done   chan struct{}
}

type Config struct {
    Size            int
    QueueDepth      int
    JobTimeout      time.Duration
    ShutdownTimeout time.Duration
    OnError         func(Job, error)
}

func (p *Pool) Start(parent context.Context) error { ... }
func (p *Pool) Submit(ctx context.Context, j Job) error { ... }
func (p *Pool) Stop(ctx context.Context) error { ... }
func (p *Pool) Health() error { ... }
```

`Submit` returns an error so the caller can implement reject semantics. `Stop` takes a context so deployment systems can enforce a max shutdown window. `Health` integrates with k8s readiness probes.

### Sample method bodies

```go
func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        p.metrics.QueueDepth.Set(float64(len(p.jobs)))
        return nil
    case <-ctx.Done():
        return ctx.Err()
    default:
        p.metrics.Rejected.Inc()
        return ErrPoolFull
    }
}

func (p *Pool) Stop(ctx context.Context) error {
    var err error
    p.once.Do(func() {
        close(p.jobs)
        select {
        case <-p.done:
        case <-ctx.Done():
            p.cancel()
            <-p.done
            err = errShutdownTimeout
        }
    })
    return err
}
```

The `once.Do` guards against double-stop. The `default` clause in `Submit` makes it a "reject on full" pool.

---

## Lifecycle Management at Scale

### Start order

Pools start *after* their dependencies. If your pool talks to a database, the DB connection must be live before the pool accepts jobs. Reverse order on shutdown.

```go
func (s *Service) Start(ctx context.Context) error {
    if err := s.db.Connect(ctx); err != nil {
        return err
    }
    if err := s.pool.Start(ctx); err != nil {
        s.db.Close()
        return err
    }
    if err := s.http.Listen(ctx); err != nil {
        s.pool.Stop(ctx)
        s.db.Close()
        return err
    }
    return nil
}

func (s *Service) Stop(ctx context.Context) error {
    s.http.Shutdown(ctx) // stop accepting requests
    s.pool.Stop(ctx)     // drain in-flight
    s.db.Close()
    return nil
}
```

### Graceful shutdown timing

Kubernetes sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30s), then SIGKILL. Your shutdown must complete in less than that.

Plan: 5s buffer for k8s to finalise + (HTTP grace) + (pool drain) ≤ grace period.

If `HTTP grace = 10s` and `pool drain = 15s`, set grace to 30s and accept 5s buffer. If pool drain might exceed 25s, you have a design problem — your jobs are too long-lived for graceful shutdown to work.

### Drain vs cancel

Drain mode finishes everything in flight. Cancel mode kills it. Production choice: drain with a deadline, then cancel.

```go
func (p *Pool) Stop(ctx context.Context) error {
    close(p.jobs)
    drainTimer := time.NewTimer(p.cfg.ShutdownTimeout)
    defer drainTimer.Stop()
    select {
    case <-p.done:
        return nil
    case <-drainTimer.C:
        p.cancel()
        <-p.done
        return errDrainTimeout
    }
}
```

---

## Backpressure Across Process Boundaries

Inside one process, channels propagate backpressure naturally. Across processes — when the pool is fed by HTTP, gRPC, Kafka — backpressure becomes an explicit protocol.

### HTTP

Reject with 429 Too Many Requests + `Retry-After` header. Document the rejection in your API spec. Make sure clients implement exponential backoff.

```go
if err := pool.Submit(ctx, j); err == ErrPoolFull {
    w.Header().Set("Retry-After", "1")
    http.Error(w, "service overloaded", 429)
    return
}
```

### gRPC

Return `RESOURCE_EXHAUSTED`. Use gRPC's built-in retries (`MaxConcurrentStreams`, `RetryPolicy`) on the client.

### Kafka

Don't commit the offset until processing succeeds. Slow consumer = consumer-group lag = visible backpressure metric. Pool size and consumer concurrency are coupled — usually one consumer per pool, configured to match.

### Across all three

The principle: **a fast accept of work that won't be done is worse than a rejection.** Producers can react to rejections (slow down, retry, skip). They can't react to a request that times out 30s later.

---

## Adaptive Concurrency Control

Static N is fine when load is predictable. When it isn't, you need feedback.

### AIMD (Additive Increase, Multiplicative Decrease)

Start at min. On every successful request, +1. On every failure, ×0.5. Stabilises at the maximum stable concurrency.

```go
type AIMD struct {
    mu      sync.Mutex
    current int
    min     int
    max     int
}

func (a *AIMD) OnSuccess() {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.current < a.max {
        a.current++
    }
}

func (a *AIMD) OnFailure() {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.current = max(a.min, a.current/2)
}
```

Used in libraries like Netflix's `concurrency-limits`. The Go port: `github.com/platinummonkey/go-concurrency-limits`.

### Vegas / Gradient

More sophisticated: tracks request latency and adjusts based on whether latency is increasing or stable. Useful when downstream latency degrades before failures appear.

### When adaptive helps

- Downstream capacity changes (autoscaling, partial failure).
- Multi-tenant where one noisy neighbor reduces capacity for everyone.
- Long-running services where the "right" N changes hour to hour.

### When it hurts

- Short-lived processes (the algorithm hasn't converged before the process exits).
- Predictable load (a static N tuned once is simpler and more debuggable).

---

## Failure Domains and Bulkheads

A single pool is a single failure domain. If one job hangs, all workers are at risk. Bulkheads divide a service into multiple pools, each with its own resource budget.

### Per-tenant bulkhead

Tenant A traffic never starves tenant B:

```go
type MultitenantPool struct {
    pools map[string]*Pool
}

func (m *MultitenantPool) Submit(tenant string, j Job) error {
    return m.pools[tenant].Submit(j)
}
```

Sized per tenant by SLA tier.

### Per-priority bulkhead

Critical work and bulk work share resources but are throttled independently:

```go
critical := New(Config{Size: 32})
bulk     := New(Config{Size: 8})
```

Critical pool is large; bulk pool is small. When bulk fills up, critical traffic is unaffected.

### Per-downstream bulkhead

If your service calls three downstreams (DB, cache, external API), use three pools, each sized for its downstream. If the external API hangs, only one pool fills — the others keep serving.

---

## Cost Model

Every pool has a cost in three dimensions:

### Memory

- Goroutine stacks: ~8 KiB per worker (grows with usage).
- Channel buffers: `cap × sizeof(Job)`.
- Per-worker state: caches, buffers, connections.

For N=64 workers with 1 KiB Job and 64-deep buffer:
`64 × 8 KiB + 64 × 1 KiB = 576 KiB + per-worker state`

### CPU

- Goroutine scheduling overhead is ~µs per dispatch. Negligible for jobs > 1 ms.
- Lock contention: if workers share a mutex, contention scales with N².
- Cache thrashing: workers on different cores reading shared state evict each other.

### Downstream

- Each worker holds ~1 connection. N workers × per-instance count = total connections to downstream.
- Downstream rate limit / your worker count = max sustainable throughput per worker.

### Cost-per-request

`(memory_per_worker + amortised_cpu) / requests_per_worker_per_sec`

For a CPU-bound worker doing 100 req/s with 8 KiB stack:
`8 KiB / 100 = 80 bytes per request of stack overhead.` Trivially cheap. Cost is dominated by what `process()` does, not by the pool itself.

---

## Capacity Planning Workflow

1. **Measure baseline.** Single worker, single request: latency, allocations, downstream calls.
2. **Apply Little's Law.** `N = throughput × latency` per instance.
3. **Add headroom.** 30-50% over P99 sizing.
4. **Verify with load test.** Synthetic traffic at 1.5x target rate. Watch P99 latency.
5. **Run under chaos.** Kill downstream; pool should reject, not hang.
6. **Set alerts.** P99 latency, queue depth, error rate, rejection rate.
7. **Document.** "Service X uses N=120 workers, sized for 500 req/s at 200 ms P99. Resize procedure: ..."

### Load test template

```bash
# k6 example
k6 run --vus 200 --duration 5m --rps 500 script.js

# expected:
#   p(95) < 250ms
#   error rate < 0.1%
#   queue depth (from /metrics) < 100
```

---

## Production Stack: Real Architectures

### Architecture A: Image processing service

- 3 instance fleet, each with NumCPU=16.
- Pool A: HTTP intake, N=200 (I/O-bound, just reads form data).
- Pool B: Image processing, N=16 (CPU-bound, libvips).
- Pool C: S3 upload, N=32 (I/O-bound, AWS SDK).

Three pools because image processing is the slow stage; intake and upload should not be blocked by it.

### Architecture B: Stream processor (Kafka)

- 1 consumer per partition (16 partitions × 1 = 16 consumers).
- Each consumer feeds a per-partition pool of N=8.
- Pool drain on rebalance: commit offset only after pool is empty.

Backpressure: consumer pauses when pool queue fills. Kafka handles the rest.

### Architecture C: Webhook fanout

- Subscribers register URLs.
- Event arrives → fanout function → pool of 32 HTTP senders.
- Per-subscriber rate limit: 10 req/s. Rate limiter inside worker.
- Failed deliveries → retry queue (separate pool).

Two pools: live and retry. Retry is at lower priority and lower N.

---

## Operational Concerns

### Logging

Every job logs `job_id`, `latency`, `outcome`. Use structured logging (`slog`):

```go
logger.Info("job completed",
    "job_id", j.ID,
    "duration_ms", time.Since(start).Milliseconds(),
    "outcome", "success")
```

Avoid logging *inside* the hot loop unless the log line is critical. Even structured logging costs allocations.

### Tracing

Each job is a trace span. The pool is a parent span when N=1; for N>1, each job is its own root or has the producer span as parent.

```go
ctx, span := tracer.Start(ctx, "pool.process")
defer span.End()
process(ctx, j)
```

### Metrics

Mandatory:
- `pool_jobs_total{outcome="success|error|rejected"}`
- `pool_inflight`
- `pool_queue_depth`
- `pool_duration_seconds` (histogram)

Optional:
- `pool_workers_active`
- `pool_queue_wait_seconds`

### Alerts

- P99 latency > target → pool too small or downstream slow.
- Rejection rate > 1% → pool overloaded.
- Goroutine count > 2× expected → leak.
- Queue depth at 100% > 10s → catastrophic backpressure.

### Runbooks

For each alert, document the diagnosis and remediation. "P99 latency alert? Run `/debug/pprof/goroutine`. Look for 100s of workers in `chan recv`. If yes, pool is starving. Scale up N or add instances."

---

## Migration Patterns

### Migrating from per-request goroutine to pool

Before:
```go
func handle(w http.ResponseWriter, r *http.Request) {
    go process(r) // unbounded
    w.WriteHeader(200)
}
```

After:
```go
func handle(w http.ResponseWriter, r *http.Request) {
    if err := pool.Submit(r.Context(), Job{Req: r}); err != nil {
        http.Error(w, "busy", 429)
        return
    }
    w.WriteHeader(202)
}
```

Two breaking changes:
1. Status code: 200 → 202 (now async).
2. Error path: rejection. Document, version the API.

### Migrating from static N to dynamic

Add an `OnLoad` callback that watches queue depth and adjusts. Roll out gradually: 10% of fleet first, monitor, then 100%.

### Migrating between pool implementations

If swapping `errgroup` for a custom pool, run them side-by-side for a sample of traffic; compare metrics; cut over when latency, error rate, and resource use match.

---

## Edge Cases at Scale

| Edge case | Symptom | Mitigation |
|-----------|---------|-----------|
| Slow downstream causes queue to grow | P99 latency rises gradually | Bound queue, reject on full |
| GC pauses block workers | Latency spikes every minute | Tune GOGC, reduce per-job allocations |
| One bad job poisons worker | Throughput drops by 1/N | Per-job timeout + recover |
| Pool of 0 from config bug | Service hangs at start | Validate `cfg.Size > 0` in `New` |
| WaitGroup negative counter | Crash | Audit all `Add`/`Done` paths |
| Producer outpaces consumer permanently | Memory grows | Bounded queue, reject on full |
| Single worker cannot process jobs in pool's lifetime | Throughput stuck | Per-job timeout, kill stuck jobs |
| Restart loop during partial outage | Throughput oscillates | Stagger restarts, circuit break |

---

## Production Readiness Checklist

- [ ] Pool size derived from Little's Law, not guessed.
- [ ] Bounded queue with explicit reject behaviour.
- [ ] Per-job timeout always set.
- [ ] Context propagation through every layer.
- [ ] Graceful shutdown completes in < 80% of k8s grace period.
- [ ] Metrics emitted: jobs, inflight, queue depth, duration, rejected.
- [ ] Alerts on P99 latency, rejection rate, goroutine count.
- [ ] Runbook documenting how to debug pool starvation.
- [ ] Load tested at 1.5× target rate.
- [ ] Chaos tested with downstream failure injection.
- [ ] Bulkheaded by tenant or priority where applicable.
- [ ] No `sync.Pool` unless allocation profile justifies.
- [ ] No dynamic resizing unless load varies > 10x.
- [ ] Worker panics recover and emit a metric.
- [ ] All channels closed exactly once by their owner.
- [ ] No goroutine leaks under cancellation (test enforces).

---

## Summary

Professional pool work is operational engineering. You wrap the pattern in a service-component struct with `Start`/`Submit`/`Stop`/`Health`. You size with Little's Law and verify with load tests. You bulkhead by tenant or priority to contain failures. You instrument exhaustively and tie metrics to SLOs. You make backpressure an explicit protocol across process boundaries (429, RESOURCE_EXHAUSTED). You plan capacity in a documented workflow and write runbooks for the alerts. You migrate gradually using parallel rollouts. The pool itself is the easy part — running it well in a fleet at scale is the work.
