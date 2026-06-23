# When to Use Concurrency — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Quantitative Models for Concurrency](#quantitative-models-for-concurrency)
3. [Latency Tail Mathematics](#latency-tail-mathematics)
4. [Capacity Planning](#capacity-planning)
5. [Profiling-Driven Concurrency Decisions](#profiling-driven-concurrency-decisions)
6. [Queue Theory in Service Design](#queue-theory-in-service-design)
7. [Worked Example: a Real Service](#worked-example-a-real-service)
8. [Limits of Theoretical Modelling](#limits-of-theoretical-modelling)
9. [Summary](#summary)

---

## Introduction

This file applies quantitative reasoning to concurrency decisions. We will use Amdahl's law, queueing theory (Little's law, M/M/1, M/M/c), and tail-latency calculus to predict the effects of adding or removing concurrency. We will also walk through a real-shaped example.

These models are simplifications. Real systems are messier. But the models illuminate trade-offs the intuition misses.

---

## Quantitative Models for Concurrency

### Amdahl: speedup vs cores

```
S(n) = 1 / ((1-p) + p/n)
```

Where p is the parallel fraction, n is cores.

Plotting S(n) for various p:

| p | n=2 | n=4 | n=8 | n=16 | n=∞ |
|---|---|---|---|---|---|
| 1.0 | 2.0 | 4.0 | 8.0 | 16.0 | ∞ |
| 0.95 | 1.90 | 3.48 | 5.93 | 9.14 | 20.0 |
| 0.9 | 1.82 | 3.08 | 4.71 | 6.40 | 10.0 |
| 0.7 | 1.54 | 2.11 | 2.58 | 2.91 | 3.33 |
| 0.5 | 1.33 | 1.60 | 1.78 | 1.88 | 2.0 |

Lesson: if your code has 30% serial fraction, adding cores past 8 gives diminishing returns.

### Gustafson: speedup for growing problems

```
S(n) = n - (1-p)(n-1)
```

For p = 0.95, n = 16: `16 - 0.05 × 15 = 15.25`. Linear scaling.

Gustafson applies when problem size grows with hardware. Most production services serve fixed-shape requests; Amdahl is more relevant.

### Little's law

```
L = λ × W
```

- L = average number of items in the system.
- λ = arrival rate (items/time).
- W = average time in the system (latency).

For a service:
- L = concurrent in-flight requests.
- λ = requests per second.
- W = average latency.

Example: 1000 req/sec, 100 ms average latency → L = 100 in-flight requests. To handle these you need ~100 concurrency.

Use Little's law to size pools, channel buffers, connection pools. It is one of the most useful tools in capacity planning.

### Utilization

For a single-server queue:

```
ρ = λ × s
```

Where s is the average service time. If ρ < 1, the system is stable; if ρ ≥ 1, queues grow unboundedly.

At ρ → 1, average queue length → ∞ in theory. In practice, ρ > 0.7 starts to show significant queueing latency.

This is why utilisation alarms fire at 70–80%, not 100%.

---

## Latency Tail Mathematics

### Fan-out tail amplification

If you call N backends in parallel and wait for all, and each backend has independent slowness probability p:

```
P(at least one slow) = 1 - (1 - p)^N
```

For per-backend p99 = 1% (i.e., 1% of requests are "slow"), N = 10:

```
P(any slow) = 1 - 0.99^10 ≈ 9.6%
```

Your p99 = where the per-backend p90.4 is. P95 of aggregate ≈ where per-backend p99.4 is — much worse.

If p99 of each backend is 100 ms, your fan-out's p99 may be 200 ms or more.

### Hedged requests

Send the request to backend A; after `delay`, send a duplicate to backend B.

The probability that A is slow at the hedge cutoff = some function of A's latency distribution. Suppose 99% of A's responses come in within `delay`. Then 1% of requests fire a duplicate.

The duplicate's first response time is essentially `delay + B's response time`. If B is fast, the total is `delay + B_fast`.

Net effect: 99% of requests are A-fast (~delay); 1% are `delay + B`. Tail is bounded by `delay + B_p99`, much better than `A_p99`.

Cost: 1% extra request volume. Cheap.

### Quorum reads

Send to all N backends; succeed as soon as K respond.

For K = 1 (any response wins): fastest of N. p99 of "fastest of N" with i.i.d. p99 = p:
```
P(all slow) = p^N
```

For p = 0.01, N = 3: `P(all slow) = 0.000001`. p99 of fastest of 3 is essentially p50 of single. Tail vanishes.

Cost: 3x request volume. Expensive but effective for critical reads.

### General formula

For K of N quorum, P(quorum fails) = sum over ways for too many to be slow. CDF of order statistics. Can compute with binomial probabilities.

---

## Capacity Planning

### Per-pod throughput

A Go pod can typically handle:

- Pure I/O-bound: 10 000+ req/sec at low latency (limited by FDs, memory, downstream).
- Mixed (some CPU): 1000–5000 req/sec.
- CPU-bound: 100–500 req/sec per core.

These are rough; profile your specific workload.

### Memory per request

A request goroutine has:

- Stack: ~2 KB initially, can grow.
- Request struct: depends on size.
- Buffers (request body, response body): typically 4–64 KB.

For 1000 in-flight requests: ~100 MB of request memory. Add cache, connection pools, etc.

### Connection pools

DB / API connection pool size:

- Match to downstream capacity.
- Use Little's law: pool size ≥ λ × W.
- For DB: typical 25–100 connections per app instance.
- For HTTP client: typical 100–1000 idle, no hard limit on in-flight.

### Worker pool sizing under Little's law

For a worker pool processing async jobs:

- λ = arrival rate.
- W = service time per job.
- L = λ × W = workers needed (steady state).

For a burst of size B, queue depth grows to ~B before workers catch up. Buffer accordingly.

### Sizing for tail tolerance

To handle p99 of arrivals without queueing:

- Sustained capacity = p50 of arrivals.
- Burst capacity = p99 of arrivals.
- Margin for backpressure / shed at ~1.5x burst.

---

## Profiling-Driven Concurrency Decisions

Real concurrency decisions are made with profiles, not guesses.

### Step 1: profile the sequential version

```bash
go test -cpuprofile cpu.out -bench .
go tool pprof cpu.out
```

Identify where time is spent. If 80% is in one function, parallelising that function may give 4x speedup. If time is evenly spread, parallelism gives less.

### Step 2: identify parallel opportunities

- Loops where iterations are independent.
- I/O calls that can run in parallel.
- Stages with different rates.

### Step 3: estimate Amdahl ceiling

If 30% of time is serial, max speedup is 3.33x. Decide if that justifies the complexity.

### Step 4: implement the simplest concurrent version

Often `errgroup` for fan-out, or a worker pool. Resist the urge to over-design.

### Step 5: benchmark side-by-side

```bash
go test -bench BenchmarkSeq,BenchmarkConcurrent -benchmem
```

Verify the speedup matches your estimate. If less, profile the concurrent version — find the new bottleneck.

### Step 6: stress test

Production load is different from benchmark load. Test with realistic concurrency, request mix, latency.

### Step 7: deploy gradually

Feature flag, canary, watch metrics. Roll back if regression.

### Step 8: revisit periodically

Workload shifts. The concurrency that paid off six months ago may not pay off today.

---

## Queue Theory in Service Design

Queue theory gives precise predictions for service behaviour under load.

### M/M/1 queue

Single server, Poisson arrivals at rate λ, exponential service times with mean 1/µ. Utilisation ρ = λ/µ.

- Average queue length: L = ρ / (1 - ρ).
- Average waiting time: W = ρ / (µ × (1 - ρ)).

At ρ = 0.5: L = 1, W = 1/µ × 1 = 1 service time of waiting.
At ρ = 0.9: L = 9, W = 9 service times of waiting.
At ρ = 0.99: L = 99, W = 99 service times. Tail explodes.

### M/M/c queue

c servers (e.g., c workers in a pool). Arrivals at rate λ. Each server processes at rate µ. Utilisation ρ = λ / (c × µ).

Multiple servers smooth the tail. At ρ = 0.9 with c = 4: average queue and wait are much lower than M/M/1 at same utilisation.

### Implications

- Run servers at < 70% utilisation to keep queueing latency low.
- Adding workers (c) reduces tail more than reducing per-task service time.
- Predict capacity needs from λ (expected arrival rate) and µ (per-server service rate).

These are idealised models — real arrivals are not Poisson, real service times are not exponential. But the qualitative behaviour holds: utilisation near 1 is dangerous.

---

## Worked Example: a Real Service

Consider a real-shaped service: a recommendation API. The handler:

1. Authenticates user (~5 ms).
2. Loads user profile from cache (~2 ms hit, 50 ms miss).
3. Loads recent activity from DB (~20 ms).
4. Calls 3 recommendation backends in parallel (~50 ms each).
5. Aggregates and ranks results (~10 ms).
6. Returns response.

### Sequential analysis

Latency: 5 + 2 + 20 + 50 × 3 + 10 = 187 ms.

This exceeds a 100 ms p99 budget. We need concurrency.

### Step 1: parallelise the backends

Sequential calls to 3 backends: 150 ms.
Parallel: max(50, 50, 50) = 50 ms.

New total: 5 + 2 + 20 + 50 + 10 = 87 ms. Under budget.

### Step 2: parallelise profile + activity

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { profile = loadProfile(ctx, userID); return nil })
g.Go(func() error { activity = loadActivity(ctx, userID); return nil })
g.Wait()
```

Latency: max(2, 20) = 20 ms instead of 22.

Marginal improvement.

### Step 3: tail latency

Each backend's p99 is 200 ms (50 avg). Fan-out p99 ≈ `200 + ε` (the slowest dominates).

Total p99: 5 + 2 + 20 + 200 + 10 = 237 ms. We are over budget at p99.

### Step 4: hedged backends

For each backend, hedge: send to A, after 50 ms send to B (a replica).

Now backend p99 ≈ 50 + 50 = 100 ms.

New total p99: 5 + 2 + 20 + 100 + 10 = 137 ms. Still over.

### Step 5: quorum

Send to 4 backends, take the first 3 to respond.

P99 of "first 3 of 4" with backend p99 = 200, p50 = 50: roughly 60–80 ms.

New total p99: 5 + 2 + 20 + 80 + 10 = 117 ms. Close to budget.

### Step 6: cache the auth

Cache auth state with 30-second TTL. 99% hit rate. Auth p99 = 0.5 ms (cache hit) most of the time.

New total p99 = 0.5 + 2 + 20 + 80 + 10 = 112.5 ms. Almost there.

### Step 7: cache profile

If profile is mostly stable, cache for 1 minute. Hit rate 95%.

p99 of profile fetch: max(2 ms cache, 50 ms backend) — but if we cache mostly, p99 ≈ 2 ms.

Total p99 = 0.5 + 2 + 20 + 80 + 10 = 112.5 ms. Same.

The bottleneck is now the recommendations fan-out (80 ms p99) and the DB activity load (20 ms).

### Step 8: tighter recommendation deadlines

Set a 70 ms deadline on each backend. If a backend exceeds, the request fails for that backend; we have 3 of 4 still.

New total p99: ~100 ms. We made it.

### Lessons

- Multiple concurrency techniques compounded.
- The first cut (parallelise backends) was the biggest win.
- Tail latency required hedged or quorum.
- Caching is concurrency's quiet partner — it removes work that would otherwise need to be concurrent.
- Profiling guides each step.

---

## Limits of Theoretical Modelling

Models are approximations. Real systems differ:

### Arrivals are not Poisson

Real traffic has spikes (start of an hour, end of a sale, viral content). Models assume independent arrivals; reality has bursts.

Buffer for burst, do not rely on M/M/c steady-state predictions.

### Service times are not exponential

Real service times have heavy tails (occasional slow requests). p99 may be 10x p50, not 5x.

Use measured distributions for capacity planning, not exponential assumptions.

### Network introduces variability

Latency between services varies. A model that ignores network gets the answer wrong.

Include realistic network distributions in simulations.

### Failures happen

Backends fail. Network partitions. GC pauses. Real systems must handle these gracefully; models often ignore them.

Add timeouts and retries to your design; assume rare failures.

### Code changes

The system you measured is not the system you deploy. Constant change means constant remeasurement.

Build observability that lets you re-derive numbers easily.

### Conclusion

Use models to understand qualitative behaviour and as starting points. Always verify with measurement on the actual system.

---

## Summary

Quantitative reasoning sharpens concurrency decisions. Amdahl bounds parallel speedup. Little's law sizes pools and queues. Queueing theory predicts behaviour at utilisation. Tail-latency math reveals why fan-out hurts p99 and why hedging / quorum help.

The professional engineer combines models with profiling and stress testing. Models predict; measurements verify; iteration tunes.

Real systems are messier than models. Bursts, heavy tails, failures, code drift — all conspire to make pure theory inadequate. The lesson: build observability, measure constantly, iterate.

The next file (`specification`) collects references for the canonical concurrency-design literature.
