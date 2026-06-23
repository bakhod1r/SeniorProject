# Rate Limiter — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Theoretical Frame: Stochastic Arrivals and Queueing](#the-theoretical-frame-stochastic-arrivals-and-queueing)
3. [GCRA — Generic Cell Rate Algorithm](#gcra-generic-cell-rate-algorithm)
4. [Adaptive Limiters and Load-Aware Throttling](#adaptive-limiters-and-load-aware-throttling)
5. [Limiter Integration with the Scheduler](#limiter-integration-with-the-scheduler)
6. [Anti-Patterns at Scale](#anti-patterns-at-scale)
7. [Choosing Between Implementations](#choosing-between-implementations)
8. [Summary](#summary)

---

## Introduction

This level is for engineers designing rate-limiting *systems* — not just integrating one. You will think about:

- The queueing-theoretic basis. Rate limiting is a special case of admission control.
- GCRA — the algorithm behind `redis_rate` and most production limiters at scale.
- Adaptive limiters that respond to downstream health, not just a fixed rate.
- How a limiter interacts with the Go scheduler, the OS, and your service's tail latency.
- When a limiter is the wrong answer and a circuit breaker, a queue, or pre-emption fits better.

If you are choosing what to deploy at a billion-request-per-day service, this is where the calculus is.

---

## The Theoretical Frame: Stochastic Arrivals and Queueing

Rate limiting is the dual of admission control in queueing theory. Pretend your service is an M/M/1 queue:

- Arrivals at rate `λ` (Poisson).
- Service rate `μ`.
- Utilisation `ρ = λ/μ`.

When `ρ → 1`, expected wait time `E[W] → ∞`. Rate limiting bounds `λ` to keep `ρ < 1`, preventing queue blow-up.

### Implications

1. **The limit must be below downstream capacity.** Set rate = 70% × μ. The 30% headroom absorbs jitter, retries, and partial failures.
2. **Burst budget = jitter tolerance.** A burst of size `B` means you can absorb `B / λ` seconds of jitter without rejection. Size it from observed arrival variance.
3. **Token bucket is the dual of leaky bucket.** Both enforce the same average rate; they differ in how they handle the queue. Token bucket "lends" capacity (burst absorbs at arrival); leaky bucket "schedules" capacity (burst absorbs at departure).
4. **Sliding-window-counter is an approximation of a fluid model.** The "fluid" leaks at rate λ continuously; the counter discretises into a two-window estimate. The approximation error is bounded by the variance of arrivals within a single window — typically < 1% for well-mixed traffic.

### Little's Law in practice

`L = λ × W`. If you cap arrival rate `λ` at 100/s and average wait is 50 ms, the average number of concurrent waiters is `L = 100 × 0.05 = 5`. This is the cardinality of goroutines parked in `Wait()`. Use it to size your concurrency budget and to predict the memory cost of `Wait`.

If `W` grows unboundedly, `L` grows unboundedly — your limiter is a memory leak. The fix: cap `W` with a context timeout, or use `Allow` instead of `Wait`.

---

## GCRA — Generic Cell Rate Algorithm

GCRA was designed for ATM (the network protocol) cell shaping. It is mathematically equivalent to leaky-bucket, but uses **one timestamp** per key instead of a level counter.

### The state

```
TAT — theoretical arrival time
T   — emission interval (1 / rate)
τ   — tolerance (burst × T)
```

### The check

```
now = current_time
if TAT - now > τ:
    reject
else:
    TAT = max(now, TAT) + T
    accept
```

Three lines. One field. That is the entire algorithm.

### Why it scales

- **One field in Redis** — minimal storage.
- **One Lua call** — atomic update.
- **No counter loops** — does not iterate keys or timestamps.
- **No boundary problem** — `TAT` is continuous.

`redis_rate` uses GCRA. Stripe's rate limiter, Cloudflare's, and many others do too.

### GCRA in Go (in-memory)

```go
type GCRA struct {
    mu    sync.Mutex
    tat   time.Time
    rate  time.Duration // T
    burst time.Duration // tau
}

func NewGCRA(eventsPerSec int, burst int) *GCRA {
    T := time.Second / time.Duration(eventsPerSec)
    return &GCRA{
        rate:  T,
        burst: T * time.Duration(burst),
    }
}

func (g *GCRA) Allow() bool {
    g.mu.Lock()
    defer g.mu.Unlock()
    now := time.Now()
    if g.tat.Before(now) {
        g.tat = now
    }
    if g.tat.Sub(now) > g.burst {
        return false
    }
    g.tat = g.tat.Add(g.rate)
    return true
}
```

`rate.Limiter` and this GCRA are observably equivalent for `Allow`/`Wait` patterns. `rate.Limiter` also supports `Reserve` and weighted reservations — GCRA doesn't natively.

---

## Adaptive Limiters and Load-Aware Throttling

A fixed-rate limiter sets the rate at design time. But downstream capacity is rarely constant — it depends on time of day, on what other services are doing, on garbage collection pauses, on hardware variability.

### AIMD — Additive Increase, Multiplicative Decrease

Borrowed from TCP congestion control:

```go
type AIMD struct {
    mu        sync.Mutex
    rate      float64
    minRate   float64
    maxRate   float64
}

// Called on success.
func (a *AIMD) OnSuccess() {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.rate = math.Min(a.maxRate, a.rate+1.0)
}

// Called on a downstream failure (timeout, 5xx, etc).
func (a *AIMD) OnFailure() {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.rate = math.Max(a.minRate, a.rate*0.5)
}
```

Each success bumps the rate by +1; each failure halves it. The system finds a stable rate where ~ε% of requests fail. TCP uses this; so do many service meshes.

### Gradient-based limiters (Netflix Concurrency Limits)

Sample latency. Compute the gradient of latency over time. If latency is rising, decrease the limit; if falling, increase. Library: `netflix/concurrency-limits` (Java; Go ports exist).

This is a *concurrency* limiter, not strictly a rate limiter, but the same math applies. The key insight: tail latency is the best signal of saturation. CPU and memory are lagging indicators.

### Why adaptive?

A fixed limiter is brittle: too low in good times (lost throughput); too high in bad times (cascade failures). Adaptive limiters self-tune. The cost is complexity and a risk of oscillation.

When to adapt:
- High-volume services where capacity headroom matters.
- Polyglot dependencies where capacity is hard to know.
- Services with significant traffic-pattern variance.

When not to adapt:
- Outbound clients to a third party (their published rate is the contract).
- Cost-protection (you want a fixed ceiling).
- Compliance/audit paths where deterministic behaviour matters.

---

## Limiter Integration with the Scheduler

`rate.Limiter.Wait` parks a goroutine on a timer. At scale this matters.

### Timer fan-out

Each `Wait` call that blocks creates a Go `time.Timer`. The runtime maintains timers in a per-P heap. At 50,000 concurrent waiters across 8 P's, that is 6,250 timers per heap — insertions and pop-mins cost `O(log n)`. Not free.

### Profile this

```go
import _ "net/http/pprof"
// then visit /debug/pprof/profile and look for runtime.timerproc.
```

Heavy time spent in `timerproc` = your Waiters are clogging the scheduler. Solutions:
- Use `Allow` instead of `Wait` on the hot path.
- Cap the number of concurrent waiters with a semaphore in front of the limiter.
- Move the limiter to an edge (e.g., LB) so the application never blocks.

### Tail latency

`Wait` adds bounded delay. Bounded != predictable: under sudden load, you may wait near the configured rate's reciprocal. If your service's p99 budget is 100 ms and your limiter is configured at 100 ev/s with burst 1, expect 10 ms of wait per request in steady-state, plus 100 ms tail at saturation.

**Always profile p99 with the limiter on a synthetic load.** A perfectly-tuned median is meaningless if p99 doubles.

### Goroutine count

Each blocked Waiter is a goroutine. At 10,000 sustained Waiters, that is 10,000 goroutines × ~8 KB = 80 MB. Manageable, but the GC pressure of scanning their stacks is real on a hot path.

---

## Anti-Patterns at Scale

- **Local-only limiter at fleet scale.** N replicas × R rate each = N×R total. You meant R. Use Redis or coordinate.
- **Redis hop on every request without batching.** Pipeline reads. Batch checks for low-priority traffic.
- **Single global Redis key for everything.** All replicas hit one shard. Throughput ceiling = single-shard throughput. Shard by tenant.
- **Adaptive limiter without an upper bound.** Bug in the success-signal? Rate climbs to infinity. Always cap `maxRate`.
- **Rate limit on the LB *and* in the app *and* in the client.** Three limiters compounding silently. Pick one layer for each dimension.
- **`Wait` in a fan-out path.** 1 user request × 100 fan-out = 100 limiter waits. Sequential = 100× tail latency. Parallel = thundering herd at the limiter. Solution: rate-limit at the fan-in, not the fan-out.
- **Burst sized to "feel generous".** Burst should be measured: capture arrival variance and set burst = 99th percentile of inter-arrival spike.
- **Limiting the wrong dimension.** Per-IP behind a corporate NAT punishes 10,000 users in one office. Per-token doesn't help anonymous traffic. Choose the dimension that maps to the abuse you fear.
- **No `Retry-After`.** Clients retry instantly, multiplying your reject rate by 10×.
- **Rejection slower than success.** Attacker prefers rejected requests because they tie up your CPU. Always make reject paths cheap.

---

## Choosing Between Implementations

| Need | Tool |
|------|------|
| In-process, simple, single instance | `rate.Limiter` |
| In-process leaky-bucket (FIFO queueing) | Channel + ticker |
| HTTP middleware, single instance | `chi/httprate` or roll-your-own around `rate.Limiter` |
| Multi-tenant HTTP | `ulule/limiter` or hierarchical custom |
| Distributed counters | `redis_rate` (GCRA) |
| Strict pacing across fleet | Redis Lua leaky bucket |
| Adaptive to downstream | AIMD or Netflix concurrency-limits port |
| Per-method gRPC limiting | Interceptor with per-method `rate.Limiter` map |
| Outbound API client | `rate.Limiter` embedded in client; `Wait` per call |
| Cost guard (no overage allowed) | Distributed quota counter + circuit breaker |

### When *not* to use a rate limiter

- **Bounded queue suffices.** A buffered channel of size N is admission control by another name. Use it if the consumer naturally paces itself.
- **Concurrency cap suffices.** `semaphore.Weighted` for "at most 50 in flight" — cheaper and simpler.
- **Circuit breaker is the right answer.** If your dependency fails, stopping calls entirely (breaker open) is better than slowing them.
- **The downstream has its own limiter.** Respect `Retry-After`, don't double-limit.
- **The request pattern is naturally bounded.** A worker pool of 10 reading from a queue cannot exceed the queue's drain rate.

---

## Summary

Rate limiting is admission control. Choose `rate.Limiter` (lazy-fill token bucket) for in-process, `redis_rate` (GCRA) for distributed, channel-and-ticker leaky bucket when you need FIFO pacing, and adaptive (AIMD or gradient-based) when downstream capacity varies.

GCRA — one timestamp, three lines, no boundary problem — is the algorithm production systems converge on. Understand it; you will see it in `redis_rate`, in service meshes, and in API gateways.

Always profile under load. `Wait` interacts with the Go scheduler's timer heap; tail latency suffers under saturation. Layer limiters cheap-first. Plan for limiter failure: open, closed, local-fallback, or circuit-break. Pick the failure mode before the outage.

The hardest part is not the code — it is choosing where to enforce, how to choose the rate, and how to fail safely. Code is twenty lines; design is the entire problem.
