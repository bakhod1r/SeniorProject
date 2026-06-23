---
layout: default
title: Optimize
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/optimize/
---

# Backpressure — Optimization Scenarios

This page presents 10 scenarios where the *right backpressure choice* fixes a latency or memory problem. For each:

1. The symptom.
2. The current (poor) design.
3. The optimisation.
4. The measurable improvement.

Use these as patterns to recognise in your own systems.

---

## Scenario 1: HTTP server with creeping memory

### Symptom

A REST API uses 200 MB RSS at startup. Over the course of a day, RSS climbs to 4 GB. Periodically the kernel kills the process. After restart, RSS starts at 200 MB and climbs again.

### Current design

Each handler does `go expensiveWork(r)` and returns immediately. There is no concurrency limit and no work-tracking.

### Optimisation

Replace fire-and-forget goroutines with a bounded worker pool. The HTTP handler calls `pool.SubmitCtx(ctx, work)`. When the pool is full, the handler returns 503.

Memory is now bounded by pool size + buffer size × per-job memory. RSS stabilises.

### Measurable improvement

- RSS: stable at 250 MB instead of growing to 4 GB.
- Goroutine count: stable at ~workers + buffer.
- Restarts: zero per week instead of two.
- 99th percentile latency under load: 350 ms (with bounded queueing) instead of 30 s (with queue growth).

---

## Scenario 2: Tail latency dominated by one slow downstream

### Symptom

A search endpoint calls 10 sub-services in parallel. p50 latency is 50 ms; p99 is 1500 ms. One of the sub-services occasionally takes 1.5 seconds.

### Current design

```go
results := make([]Result, len(services))
var wg sync.WaitGroup
for i, s := range services {
    wg.Add(1)
    go func(i int, s Service) {
        defer wg.Done()
        results[i] = s.Query(ctx, q)
    }(i, s)
}
wg.Wait()
return aggregate(results)
```

No timeout. The slowest service dominates p99.

### Optimisation

Add per-call timeout (500 ms). Treat timed-out services as "no result" rather than "error." Hedge reads if the service is idempotent.

```go
ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
defer cancel()
// ...

for i := range services {
    if results[i] == nil { /* time out; treat as miss */ }
}
```

### Measurable improvement

- p99 latency: 600 ms instead of 1500 ms.
- Result completeness: 95% (occasionally lose a service) instead of 100%.
- Tail-driven outages: eliminated.

---

## Scenario 3: Telemetry shipper blocking the app

### Symptom

The application has 100 ms p50 latency normally. Several times per day, all requests spike to 5 seconds. Profile shows time spent in `metrics.Record`.

### Current design

```go
func recordMetric(name string, value float64) {
    metricsChan <- Metric{name, value} // unbuffered, blocks if backend is slow
}
```

A slow metrics backend stalls every request that records a metric.

### Optimisation

Buffer the metrics channel; drop on full; count drops.

```go
var metricsChan = make(chan Metric, 10000)
var drops atomic.Uint64

func recordMetric(name string, value float64) {
    select {
    case metricsChan <- Metric{name, value}:
    default:
        drops.Add(1)
    }
}
```

### Measurable improvement

- p99 latency: 150 ms instead of 5000 ms during incidents.
- Metric drop rate: 0.01% normally, occasionally 1% during spikes.
- Observability slightly degraded; application reliability vastly improved.

---

## Scenario 4: Per-tenant fairness

### Symptom

A multi-tenant service runs 100 customers. One customer ("Acme") fires 10× their usual load briefly. During that time, other customers see 503s.

### Current design

Single global queue. Acme's load fills it; everyone's requests are rejected.

### Optimisation

Per-tenant queues with shared workers. Each tenant has a private bounded queue. Acme fills only their own queue; others are unaffected.

```go
queues map[string]chan Job
workers shared

func Submit(tenant string, j Job) bool {
    q := getQueue(tenant)
    select {
    case q <- j: return true
    default: return false
    }
}
```

### Measurable improvement

- Cross-tenant impact during Acme's spike: zero (others see normal latency).
- Acme sees 503 for excess work; other tenants do not.
- Customer satisfaction maintained even under noisy-neighbour conditions.

---

## Scenario 5: Slow database query stalling the pool

### Symptom

The web service uses a 50-connection DB pool. Once per hour, a slow query holds a connection for 30 seconds. During that time, p99 latency for all requests climbs to 5 seconds because requests wait for a free connection.

### Current design

```go
rows, err := db.Query(q)
```

No timeout. A slow query monopolises a connection.

### Optimisation

Per-query context timeout. Statement-level timeout via Postgres `statement_timeout` as a backstop.

```go
ctx, cancel := context.WithTimeout(reqCtx, 200*time.Millisecond)
defer cancel()
rows, err := db.QueryContext(ctx, q)
```

Slow queries are cancelled after 200 ms; the connection returns to the pool.

### Measurable improvement

- Cross-request impact of slow query: minimal.
- Slow queries surface as errors instead of cascading slowness.
- p99 latency: stable at 250 ms.

---

## Scenario 6: Cold start during deploy

### Symptom

Rolling deployments cause brief 503 spikes. New replicas boot with empty caches; their first 100 requests are 10× slower than steady-state.

### Current design

LB routes traffic to a new replica as soon as it passes the readiness check. Readiness = "process is up."

### Optimisation

Two-step readiness: process up + warmth check. The replica reports "ready" only after 100 successful test requests have warmed the cache.

Add admission control with adaptive concurrency: new replicas start with a small limit and grow.

### Measurable improvement

- Deploy-time 503 spike: eliminated.
- p99 during rollout: same as steady-state.
- Rollout safety: blue-green deployments now zero-downtime.

---

## Scenario 7: Memory leak under burst load

### Symptom

After a marketing campaign sent 10× normal traffic for 30 minutes, RSS climbed from 500 MB to 8 GB. The OOM killer terminated the process two hours after the campaign ended.

### Current design

A `chan Job` with capacity 10,000,000 — sized to "absorb any spike." The campaign filled most of it. Even after traffic returned to normal, the buffer remained mostly full for hours.

### Optimisation

Reduce buffer to 100. Add `SubmitCtx` with 200 ms timeout. Excess work is rejected as 503; clients retry with backoff.

### Measurable improvement

- RSS during campaign: 600 MB instead of 8 GB.
- Post-campaign OOM: never.
- 503 rate during campaign: 7% (acceptable; customers retried).
- Total successful requests during campaign: 92% (vs 0% after OOM).

---

## Scenario 8: Retry storms after downstream blip

### Symptom

A downstream service was unavailable for 60 seconds. After it recovered, its load was 5× normal for 10 minutes, causing further instability. Investigation showed all upstream callers retried aggressively without backoff.

### Current design

```go
for {
    err := call(ctx, req)
    if err == nil { return nil }
    if !isRetryable(err) { return err }
    // retry immediately
}
```

### Optimisation

Exponential backoff with jitter. Max retry count. Honour `Retry-After` if returned by the downstream.

```go
for i := 0; i < 5; i++ {
    err := call(ctx, req)
    if err == nil { return nil }
    if !isRetryable(err) { return err }
    delay := baseDelay * time.Duration(1 << i)
    jitter := time.Duration(rand.Int63n(int64(delay) / 2))
    select {
    case <-time.After(delay + jitter):
    case <-ctx.Done(): return ctx.Err()
    }
}
```

### Measurable improvement

- Post-outage spike: eliminated.
- Recovery time: 60 seconds (outage duration) instead of 10 minutes.
- Cascade failures: zero.

---

## Scenario 9: Variable-cost requests starving cheap ones

### Symptom

An API has two endpoints: `/cheap` (5 ms) and `/expensive` (5 seconds). p99 latency for `/cheap` is 8 seconds because cheap requests share a worker pool with expensive ones.

### Current design

Single worker pool. When 8 workers are busy with expensive requests, cheap requests queue behind them.

### Optimisation

Two separate worker pools (bulkhead pattern). Cheap pool: 32 workers, small buffer. Expensive pool: 4 workers, larger buffer.

### Measurable improvement

- /cheap p99: 30 ms instead of 8 seconds.
- /expensive p99: 5.5 seconds (unchanged).
- Total RPS capacity unchanged; latency distribution dramatically better.

---

## Scenario 10: Cache stampede on key expiration

### Symptom

Once per hour (at the cache TTL boundary), 1000 concurrent requests for the same key all hit the database. The DB momentarily saturates; latency spikes.

### Current design

```go
func get(key string) []byte {
    if v, ok := cache.Get(key); ok { return v }
    v := db.Fetch(key)
    cache.Set(key, v)
    return v
}
```

All 1000 callers race; all 1000 fetch.

### Optimisation

`golang.org/x/sync/singleflight`. Only one fetch happens; others wait and share the result.

```go
var sf singleflight.Group
func get(key string) []byte {
    v, _, _ := sf.Do(key, func() (any, error) {
        if v, ok := cache.Get(key); ok { return v, nil }
        v := db.Fetch(key)
        cache.Set(key, v)
        return v, nil
    })
    return v.([]byte)
}
```

Additionally, jittered TTLs prevent simultaneous expiration across keys.

### Measurable improvement

- DB hits during stampede: 1 instead of 1000.
- DB latency during stampede: stable instead of spiking.
- p99 during stampede: 50 ms instead of 2 seconds.

---

## Closing Patterns

These ten scenarios reveal common optimisation patterns:

1. **Bound everything.** Unbounded queues are the most common bug.
2. **Timeout everything.** Without timeouts, slow operations cascade.
3. **Isolate work classes.** Bulkhead pattern prevents one class from starving others.
4. **Drop telemetry, not user work.** Different policies for different work classes.
5. **Backoff with jitter.** Synchronised retries amplify outages.
6. **Coalesce duplicate work.** Singleflight prevents stampedes.
7. **Per-tenant fairness.** Multi-tenant services must isolate tenants.
8. **Adaptive limits.** Static limits cannot handle workload variability.
9. **Drain on shutdown.** Clean shutdowns prevent lost work.
10. **Make rejection visible.** Counters and alerts; never silent drops.

---

## Optimisation Methodology

When facing a performance/memory problem:

1. **Measure.** Where is the bottleneck? CPU? Memory? Latency? Heap?
2. **Reproduce.** Can you cause the symptom on demand? If not, you cannot verify the fix.
3. **Hypothesise.** What backpressure mechanism is missing or wrong?
4. **Change one thing.** Apply the fix.
5. **Re-measure.** Confirm the metric moved in the right direction.
6. **Watch for new symptoms.** Backpressure fixes can shift the bottleneck elsewhere.

A common trap: applying multiple fixes at once. You cannot tell which one helped (or which one made things worse). Patience pays.

---

## Closing

Backpressure is more than a defensive technique. Applied correctly, it is an *optimisation* — it makes systems faster, smaller, and more predictable. The ten scenarios above are not rare; you will see most of them in any year of building production software.

When you spot one in your own systems, you now have the playbook.

---

## Final Tip: Optimise the Failure Mode, Not Just the Happy Path

A common pattern: a system runs fine 99% of the time; engineers tune the 99% case. Then a 1% case (a spike, an outage, a slow downstream) causes a major incident.

The right approach: optimise *both*. Make the happy path fast and the failure path graceful. Backpressure is the discipline of optimising the failure path.

The result: a system that runs fast 99% of the time and gracefully degrades the other 1%, rather than a system that runs fast 99% of the time and crashes the other 1%.

Both feel the same most of the time. They feel very different the other times.

---

## Bonus Scenario A: GC Pauses Causing Spurious Rejections

### Symptom

A service rejects 1–2% of requests with 503 even at low load. Investigation: rejections coincide with GC pauses.

### Current design

`Submit` uses `select default` with no wait. During an 80 ms GC pause, the worker pool's consume loop is paused; the buffer fills; new submits get default and 503.

### Optimisation

Add a short wait before rejecting:

```go
ctx, cancel := context.WithTimeout(parentCtx, 100 * time.Millisecond)
defer cancel()
select {
case p.jobs <- j:
case <-ctx.Done():
    return ErrBusy
}
```

100 ms absorbs typical GC pauses.

### Measurable improvement

- Spurious 503 rate: 0.01% instead of 1.5%.
- Latency p99 of accepted requests: unchanged.

---

## Bonus Scenario B: Per-Worker State Leak

### Symptom

Each worker goroutine holds a per-worker buffer of 10 MB. With 32 workers, that is 320 MB of memory just for buffers. Workers rarely fill the buffers; only the largest jobs need them.

### Current design

Each worker pre-allocates the buffer at startup.

### Optimisation

Use `sync.Pool` for buffers. Workers acquire on demand; release when done. The pool retains a few buffers but releases excess.

### Measurable improvement

- RSS: 200 MB instead of 320 MB.
- Latency: unchanged.
- Cold-job latency: slightly higher (need to allocate) but acceptable.

---

## Bonus Scenario C: Excessive Wakeups Hurting Throughput

### Symptom

A high-throughput worker pool's CPU usage is dominated by goroutine scheduling, not actual work. Profile shows time in `runtime.gopark` and `runtime.goready`.

### Current design

Many workers, small jobs, each requiring a channel operation. The scheduling overhead dominates.

### Optimisation

Batch jobs. Instead of sending one item per send, send 16 at a time. The scheduling overhead amortises across the batch.

### Measurable improvement

- Throughput: 200K jobs/sec instead of 80K jobs/sec.
- CPU usage: 60% on work, 10% on scheduling instead of 30/40.

---

## Bonus Scenario D: Aging-Out Stale Items in Queue

### Symptom

The queue holds work for up to 30 seconds during peak load. Some items are completed but no longer useful — the user already gave up.

### Current design

Plain FIFO queue with no TTL.

### Optimisation

Tag each item with an "arrival time." Workers check before processing:

```go
if time.Since(j.ArrivedAt) > maxAge {
    // skip; record stale-skip counter
    continue
}
```

Or use adaptive LIFO (process newest first under overload).

### Measurable improvement

- "Useful work" fraction: 99% instead of 70% during overload.
- p99 latency for accepted-and-completed work: lower (skipped stale items).
- Drop counter still climbs, but the work skipped is what no one is waiting for.

---

## Bonus Scenario E: Buffer Size Too Aggressive for Long Pauses

### Symptom

After a 5-minute network blip (downstream unavailable), the service recovers slowly. Investigation: the queue accumulated 50,000 retries during the blip; they all need to be processed before new requests can be served.

### Current design

Large buffer (50,000) and aggressive client retry.

### Optimisation

Smaller buffer (1,000). Excess gets immediate 503 with `Retry-After`. Client backoff prevents stampede.

### Measurable improvement

- Recovery time after blip: 30 seconds instead of 5 minutes.
- Memory during blip: 100 MB instead of 5 GB.
- 503s during blip: 95% (clients backoff appropriately).

---

## A Note on Premature Optimisation

The patterns in this page solve real problems. They also have costs:

- More code paths to test.
- More configuration to tune.
- More dimensions for things to go wrong.

Apply each optimisation only when you have **measured** the problem. The order should be:

1. **Measure.** Confirm the problem exists.
2. **Diagnose.** Identify the cause.
3. **Optimise.** Apply the fix.
4. **Re-measure.** Confirm improvement.
5. **Document.** Future engineers need to understand the change.

Skipping step 1 leads to "cargo cult" backpressure: complex code that does not address the actual problem. Stay rigorous.

---

## Bonus Scenario F: Adaptive Concurrency vs Static

### Symptom

A service had a static concurrency limit of 100. Under hardware upgrade (32-core → 64-core), the limit became too conservative; the service was idle but rejecting. Under a buggy downstream, the limit became too lenient; the service overloaded.

### Current design

```go
sem := make(chan struct{}, 100)
```

### Optimisation

Replace with AIMD-driven limit. The limit adapts to current capacity. Hardware upgrade: limit grows to ~200. Downstream slow: limit shrinks to ~30.

### Measurable improvement

- Hardware utilisation: 80% instead of 40% post-upgrade.
- Latency during downstream issue: stable instead of degrading.
- Operational toil: no manual tuning after hardware changes.

---

## Bonus Scenario G: Coalescing Bursts at Edge

### Symptom

Mobile clients send "presence" updates every 30 seconds. When a network partition heals, thousands of clients send their queued updates simultaneously. The service spikes.

### Current design

Every update is processed individually.

### Optimisation

At the edge (CDN or gateway), use a leaky bucket to smooth the burst. Or coalesce updates server-side: only process the latest update per user.

### Measurable improvement

- Backend spike during partition heal: eliminated.
- Steady-state throughput: same.
- Latency during heal: stable.

---

## Bonus Scenario H: Avoiding the "Bigger Buffer" Trap

### Symptom

After every incident, the team's instinct is "make the buffer bigger." Over a year, the buffer has grown from 100 to 100,000. Now incidents take much longer to recover from.

### Current design

Buffer = "however big needed to never reject."

### Optimisation

Revert to small buffer + rejection. Document that the team's goal is **fast recovery**, not **never reject**. Rejections are the system's honest signal of overload.

### Measurable improvement

- Recovery time: minutes instead of hours.
- Operator clarity: dashboards show rejection rate, an actionable metric.
- Incidents: fewer total because the team responds faster.

---

## Closing Reflection

Many backpressure optimisations are not about adding code — they are about *removing* it. Smaller buffers. Fewer retries. Less elaborate fallbacks. The discipline is restraint: pick the right policy, document why, observe carefully, adjust deliberately.

That restraint is what distinguishes seasoned engineers from those who just discovered concurrency. Anyone can add a buffer; few people can defend its size with data.

---

## A Final Patterns Table

| Symptom | Pattern | Why it works |
|---|---|---|
| Memory grows | Bound the queue | RSS becomes O(buffer) |
| p99 spikes | Per-call timeout + short submit wait | Bounded queueing |
| One class starves others | Bulkhead | Per-class isolation |
| Retries amplify | Exponential backoff + jitter | Decorrelated reruns |
| Stampede on cache miss | Singleflight | One fetch, N waiters |
| Tail-driven slowness | Hedge | First-back wins |
| GC pause causes 503s | Short submit wait | Absorb pauses |
| Slow client pins resources | Read timeout + bounded outbox | Memory bounded per connection |
| Stale work in queue | TTL on items | Skip useless work |
| Hardware change | Adaptive concurrency | Auto-retune |

Memorise this table. Recognise the symptom; apply the pattern.

---

## Conclusion

Backpressure is optimisation. Throughout this page, every "optimisation" was an application of the same discipline: bound your resources, surface overload, adapt over time. Done right, backpressure is invisible in healthy operation and graceful in failure. The metric to watch is *recovery time*, not *peak throughput*. A system that handles 100K RPS but takes an hour to recover from a blip is worse than one that handles 80K RPS and recovers in 30 seconds.

Build for graceful failure first. Throughput follows.

