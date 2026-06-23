# Rate Limiter — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Distributed Rate Limiting on Redis](#distributed-rate-limiting-on-redis)
3. [Leaky-Bucket via Redis Lua](#leaky-bucket-via-redis-lua)
4. [Hierarchical Limiters](#hierarchical-limiters)
5. [Graceful Degradation Under Limiter Failure](#graceful-degradation-under-limiter-failure)
6. [Fairness and Anti-Starvation](#fairness-and-anti-starvation)
7. [Quotas vs Rates vs Concurrency](#quotas-vs-rates-vs-concurrency)
8. [Designing a Multi-Tenant API Limiter](#designing-a-multi-tenant-api-limiter)
9. [Real-World Capacity Planning](#real-world-capacity-planning)
10. [Edge-Case Catalogue](#edge-case-catalogue)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Introduction

Middle level taught you to deploy a single-process rate limiter with metrics. Senior is about everything that breaks when one process becomes ten, and ten becomes a hundred:

- The limiter state must travel. A local-only limiter does not enforce a global SLA.
- Redis becomes a dependency in the request path. That is a failure mode.
- Different limit dimensions compose: per-user *and* per-tenant *and* global *and* per-route.
- Latency-sensitive paths cannot tolerate a synchronous Redis round-trip. There are workarounds.
- Fairness matters. A loud tenant should not starve a quiet one.

This level covers the patterns and trade-offs that show up only at multi-instance scale.

---

## Distributed Rate Limiting on Redis

The textbook distributed counter:

```lua
-- KEYS[1] = bucket key, ARGV[1] = limit, ARGV[2] = window in seconds
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
    return 0
end
return 1
```

In Go:

```go
import (
    "context"
    "github.com/redis/go-redis/v9"
)

var script = redis.NewScript(`...above...`)

func Allow(ctx context.Context, rdb *redis.Client, key string, limit int, window int) (bool, error) {
    v, err := script.Run(ctx, rdb, []string{key}, limit, window).Int()
    if err != nil {
        return false, err
    }
    return v == 1, nil
}
```

This is **fixed window** at fleet scale. Has the same boundary-doubling problem as local fixed window — but acceptable for many APIs.

### `redis_rate` — the production version

[`go-redis/redis_rate`](https://github.com/go-redis/redis_rate) implements a **generic cell rate algorithm** (GCRA) — a leaky-bucket variant. It returns:

```go
type Result struct {
    Limit       Limit         // the configured limit
    Allowed     int           // 1 if allowed, 0 if not
    Remaining   int           // tokens remaining
    RetryAfter  time.Duration // when to retry
    ResetAfter  time.Duration // when the bucket fully refills
}
```

Usage:

```go
import "github.com/go-redis/redis_rate/v10"

limiter := redis_rate.NewLimiter(rdb)
res, err := limiter.Allow(ctx, "user:42", redis_rate.PerMinute(60))
if err != nil { /* Redis down */ }
if res.Allowed == 0 {
    w.Header().Set("Retry-After", strconv.Itoa(int(res.RetryAfter.Seconds())+1))
    w.Header().Set("X-RateLimit-Remaining", "0")
    http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
}
```

GCRA is a token-bucket dual: it stores a single timestamp (`TAT` — theoretical arrival time) rather than a counter. One Redis key, one Lua call, no boundary problem. This is the right default for distributed limiting in 2026.

### The cost: one round-trip per check

If your service handles 50,000 req/s and each check is a 1 ms Redis hop, that is 50,000 outstanding Redis ops sustained. Redis can handle it, but you pay:
- Latency floor of `RTT(redis)` on every request.
- Capacity coupling: Redis outage = service rejects everything (or accepts everything — your fallback policy).

Mitigations: pipeline, batch, or local-first (see hierarchical limiters below).

---

## Leaky-Bucket via Redis Lua

A purer leaky-bucket implementation in Redis:

```lua
-- KEYS[1] = bucket, ARGV[1] = capacity, ARGV[2] = leak_rate (units/sec), ARGV[3] = now (ms)
local capacity   = tonumber(ARGV[1])
local leak       = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])

local bucket = redis.call("HMGET", KEYS[1], "level", "ts")
local level  = tonumber(bucket[1]) or 0
local ts     = tonumber(bucket[2]) or now

-- Leak since last touch.
local elapsed = (now - ts) / 1000.0
level = math.max(0, level - elapsed * leak)

if level + 1 > capacity then
    redis.call("HMSET", KEYS[1], "level", level, "ts", now)
    redis.call("PEXPIRE", KEYS[1], math.ceil((capacity / leak) * 1000))
    return 0
end

level = level + 1
redis.call("HMSET", KEYS[1], "level", level, "ts", now)
redis.call("PEXPIRE", KEYS[1], math.ceil((capacity / leak) * 1000))
return 1
```

Two fields: current level, last-update timestamp. Each call computes the leaked amount, checks capacity, updates. `PEXPIRE` set to "time to drain from full" ensures keys self-expire when idle.

In Go:

```go
type LeakyResult struct {
    Allowed   bool
    LevelAfter float64
}

func leakyAllow(ctx context.Context, rdb *redis.Client, key string, cap, leakPerSec float64) (LeakyResult, error) {
    now := time.Now().UnixMilli()
    res, err := leakyScript.Run(ctx, rdb, []string{key}, cap, leakPerSec, now).Int()
    if err != nil {
        return LeakyResult{}, err
    }
    return LeakyResult{Allowed: res == 1}, nil
}
```

Why use this over `redis_rate`/GCRA? Because GCRA still allows burst up to capacity in a single window; pure leaky-bucket enforces strict pacing. Choose by what your downstream actually requires.

---

## Hierarchical Limiters

Real systems have multiple budgets stacked:

| Layer | Example | Why |
|-------|---------|-----|
| Global | 10,000 req/s | Protect the cluster |
| Per-route | `/login` 500 req/s | Protect the auth service |
| Per-tenant | 100 req/s per org | Fairness between paying customers |
| Per-user | 10 req/s per user | Stop one user from monopolising a tenant |
| Per-IP | 50 req/s per IP | Anonymous abuse |

The rule: an operation is allowed iff **all** layers allow it.

```go
type Multi struct {
    limiters []func(ctx context.Context, r *http.Request) (allowed bool, retry time.Duration, err error)
}

func (m *Multi) Allow(ctx context.Context, r *http.Request) (bool, time.Duration, error) {
    var maxRetry time.Duration
    for _, l := range m.limiters {
        ok, retry, err := l(ctx, r)
        if err != nil {
            return false, 0, err
        }
        if !ok {
            if retry > maxRetry {
                maxRetry = retry
            }
            return false, maxRetry, nil
        }
    }
    return true, 0, nil
}
```

### Order matters

Check **cheap local limiters first**, expensive distributed last. If a request fails the local per-IP limiter, you never make a Redis call. This is the single biggest optimisation in hierarchical setups.

```go
limiters: []func{
    localPerIPLimiter,      // 30 ns
    localPerRouteLimiter,   // 30 ns
    redisPerTenantLimiter,  // 1 ms
    redisGlobalLimiter,     // 1 ms
}
```

A denied IP costs 30 ns. A denied tenant costs 1 ms. An allowed request costs 2 ms.

### Refund on partial denial

Care: if layer 2 allows and consumes a token, then layer 3 denies, the layer-2 token is still consumed. For local limiters this is fine; for distributed counters this can lead to systematic over-consumption. Use `Reserve` + `Cancel` semantics where supported.

---

## Graceful Degradation Under Limiter Failure

What does your service do when Redis is down?

### Policy A: fail open

```go
if errors.Is(err, redis.ErrClosed) {
    return true // allow
}
```

Pro: service continues to work.
Con: no rate limiting — you might lose to a thundering herd while Redis recovers.

### Policy B: fail closed

```go
if err != nil {
    return false // reject
}
```

Pro: maintains safety.
Con: service degrades to "everyone gets 429" when Redis hiccups.

### Policy C: fall back to local

```go
res, err := remote.Allow(ctx, key)
if err != nil {
    metrics.RedisFailure.Inc()
    return local.Allow() // local limiter as the safety net
}
return res.Allowed
```

Pro: best of both worlds — strict in steady state, lenient in failure.
Con: local limit must be sized for the fleet's worst-case fan-out.

### Policy D: circuit-break

If Redis is failing for >10s, switch to local-only for 60s, then probe again. Standard circuit-breaker pattern, applied to the limiter.

The choice depends on what your service does:
- **Login/auth:** fail closed (security trumps availability).
- **Read-heavy API:** fail open or fall back to local (availability trumps strictness).
- **Cost-bearing API calls:** fail closed (the business loses money on overage).

Decide *before* the outage. Document. Test.

---

## Fairness and Anti-Starvation

A simple token-bucket limiter with `Allow()` is **first-come-first-served**. Under contention, fast callers win. Slow callers starve.

### Problem: load distribution

```go
// Two clients, one limiter at 100 req/s.
// Client A loops as fast as possible.
// Client B sends one request every 100 ms.
// Result: A gets ~99 req/s, B is rejected most of the time.
```

Token bucket does not know about clients.

### Solution 1: per-client limiters

Already covered: each client gets its own limiter. The global is just a backstop.

### Solution 2: weighted fair queueing

Track how many tokens each client has used recently. When the global limit is contended, prefer the client with the lowest recent usage. Implementation: per-client counters, sorted on lookup.

### Solution 3: priority lanes

Two limiters: `high_priority` (60 ev/s) and `low_priority` (40 ev/s), summing to your 100 ev/s budget. High-priority traffic is never starved by low.

### Solution 4: queue-based with bounded wait

A leaky-bucket FIFO queue is naturally fair. If the queue length exceeds a threshold, return `503` rather than letting latency blow up.

---

## Quotas vs Rates vs Concurrency

These three are often confused. They control different things.

| Mechanism | Limits | Example | Tool |
|-----------|--------|---------|------|
| **Quota** | Total over a billing period | "10,000 API calls per month" | DB counter, billing service |
| **Rate** | Frequency in short windows | "100 req/s" | `rate.Limiter`, Redis |
| **Concurrency** | Number in flight at once | "max 50 simultaneous requests" | Semaphore, buffered channel |

A typical API has all three:
- Quota: monthly billing cap (long-term).
- Rate: short-term burst cap (per-second).
- Concurrency: in-flight cap (request-time).

A noisy client can hit each independently. Surface each as a distinct error code or header so clients know which limit they hit.

### Concurrency limit is *not* a rate limit

A concurrency limit allows infinitely fast operations if they complete quickly. A rate limit caps frequency regardless of duration. The two are complementary:
- 50 concurrent + 1 ms per op = 50,000 ev/s peak.
- 50 concurrent + 1 s per op = 50 ev/s peak.
- 100 ev/s rate limit caps both.

---

## Designing a Multi-Tenant API Limiter

A reference design:

```
Request flow:
  1. Auth identifies tenant + user.
  2. Per-IP local limiter (30 ns, drops obvious abuse).
  3. Per-user local limiter (30 ns).
  4. Per-tenant Redis limiter (1 ms, enforces SLA tier).
  5. Per-route Redis limiter (1 ms, protects critical endpoints).
  6. Global semaphore (10 ns, prevents fan-out collapse).
  7. Handler runs.

On reject at any layer:
  - HTTP 429
  - X-RateLimit-Limit: <configured limit>
  - X-RateLimit-Remaining: 0
  - X-RateLimit-Reset: <unix timestamp>
  - Retry-After: <seconds>
  - Body: { "code": "RATE_LIMIT", "limit_dim": "tenant" }

Metrics:
  - ratelimit_check{dim, decision} counter
  - ratelimit_remaining{dim, tenant} gauge (sampled)
  - ratelimit_redis_failure counter

Failure mode:
  - If Redis fails, fall back to a generous local limit (cluster-wide ÷ replicas × 2).
  - Alert on the fallback gauge.
```

### Tier configuration

```go
type Tier struct {
    Name         string
    PerSecond    int
    Burst        int
    DailyQuota   int
    Concurrency  int
}

var tiers = map[string]Tier{
    "free":       {Name: "free", PerSecond: 10, Burst: 20, DailyQuota: 1000, Concurrency: 5},
    "standard":   {Name: "standard", PerSecond: 100, Burst: 200, DailyQuota: 100_000, Concurrency: 50},
    "enterprise": {Name: "enterprise", PerSecond: 1000, Burst: 2000, DailyQuota: 10_000_000, Concurrency: 500},
}
```

Each tier defines all four dimensions. Lookup is by tenant ID → tier → config.

---

## Real-World Capacity Planning

How do you pick `PerSecond` and `Burst`?

### Step 1: measure the downstream

If your handler calls a database that can serve 5,000 q/s, the *global* rate limit must be below that. Set it to 70-80% to leave headroom. So global ≈ 3,500 q/s.

### Step 2: divide among tenants

If you have 1,000 active tenants and the global is 3,500, the *average* per-tenant rate must be 3.5 q/s. But traffic is not uniform — a few tenants drive most volume. Set:
- Free tier: 1 q/s (a third of average).
- Standard: 50 q/s (15× average).
- Enterprise: 500 q/s (150× average).

If usage exceeds plan, the global limit kicks in and protects the database.

### Step 3: pick burst

Burst should be ≥ 1× rate and ≤ 5× rate for most workloads. A burst of 1 means strict pacing (good for outbound API clients). A burst of 5× rate accommodates app-startup spikes and retry storms.

### Step 4: simulate

Before deploying, simulate traffic with a load tester. Check:
- Is the rejection rate near zero in steady state? (rate too low if not.)
- Does a synthetic burst cause cascade failures? (concurrency cap missing.)
- Does an attacker IP take down a tenant? (per-IP limit too high.)

Adjust. Roll out behind a feature flag. Monitor for a week.

---

## Edge-Case Catalogue

### Clock skew between Redis and clients

GCRA stores a timestamp. If the client and Redis disagree on time by 1 s, the limiter is off by 1 s of rate. Use `redis.call("TIME")` inside the Lua script to use Redis's clock.

### Token bucket with `rate.Inf`

`rate.NewLimiter(rate.Inf, b)` always allows. Useful as a "disabled" sentinel — code path is the same; behaviour is no-op.

### Reserve cancellation race

```go
r := lim.Reserve()
delay := r.Delay()
go r.Cancel() // cancel in another goroutine
time.Sleep(delay) // may or may not see the cancel
```

`Cancel` is safe to call but only refunds tokens if the action has not been "consumed" yet. If you've already slept past the delay, the cancel is a no-op.

### Limiter cardinality explosion

A per-API-key map sees 10 M keys/day (each key used once). Map grows to 10 M entries. Memory: ~1 GB. Solution: short TTL eviction or LRU with a hard cap.

### Single-tenant noisy under multi-tenant limit

One tenant routinely hits its limit. Their `RetryAfter` is correctly served. But their *clients* aren't using `Retry-After` — they retry instantly. Result: a hot loop slamming your limiter, which costs Redis CPU. Solution: increase the deny-side cost (e.g., 1 s sleep on the deny path) or block at the LB level.

### Two services share a limiter via Redis, but one runs old code

Old code computes burst differently. The Redis state is corrupted from the new code's perspective. Solution: version the Redis key (`limit:v2:user:42`) and migrate explicitly.

### Limiter on a path that should not have it

The metrics endpoint, the health-check endpoint, the admin endpoint. If your middleware blanket-applies a limiter, these can be rejected during an attack. Carve them out explicitly.

### Burst > rate × window for sliding-window-counter

Sliding-window-counter's estimate weights against `prev`. If `burst > limit × 2`, the algorithm's estimate undercounts. Keep burst ≤ limit × 1.5 for the counter to behave intuitively.

---

## Cheat Sheet

```
Distributed limiter:
  - redis_rate (GCRA) is the default.
  - Cost: ~1 ms Redis hop per check.
  - Fallback policy: open/closed/local/circuit-break — decide ahead.

Hierarchical:
  - Order layers cheap-first.
  - Local before Redis.
  - Global as backstop.

Quotas vs rates vs concurrency:
  - Quota: total over period (billing).
  - Rate: events/second.
  - Concurrency: in-flight count.
  Use all three.

Fairness:
  - Per-client limiters before global.
  - Weighted FQ or priority lanes when contended.

Capacity planning:
  - Global = 70% of downstream capacity.
  - Tier rates reflect tier expectations, not equal shares.
  - Burst 1× to 5× rate.
```

---

## Summary

At fleet scale a rate limiter becomes a distributed system. Redis is the canonical backing store; `redis_rate` (GCRA) is the production-default algorithm. Pay one round-trip per check, layer with cheap local limiters to amortise.

Hierarchical limiters compose multiple budgets: global, per-route, per-tenant, per-user, per-IP. Check cheap layers first. Plan for limiter failure: pick `fail open`, `fail closed`, `fall back to local`, or `circuit-break` — and document the choice.

Quotas, rates, and concurrency are three independent mechanisms. Use all three. Fairness requires per-client limiters or priority lanes; a single global limiter starves quiet clients.

Capacity planning starts from the downstream: pick the global rate at ~70% of downstream capacity, divide among tiers by expected usage, and pick burst to absorb realistic jitter. Simulate before deploying. Monitor relentlessly.

A good multi-tenant limiter is a small system: a handful of layers, a Redis cluster, and a metrics dashboard. The thinking is what is hard.
