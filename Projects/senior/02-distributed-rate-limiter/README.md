# Distributed Rate-Limiter Service

> Enforce one global limit across a whole fleet — at 1M+ decisions/s, with a
> sub-millisecond latency budget, and a clear answer for what happens when Redis
> blinks. The hard part isn't the algorithm; it's the *per-decision round-trip*
> and the failure policy.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Traffic control / distributed systems |
| **Skills exercised** | Redis + atomic Lua, token-bucket / sliding-window-counter, local pre-check + async sync, hot-key sharding, fail-open vs fail-closed, `429`/`Retry-After`/`RateLimit` headers, Go (`go-redis`), middleware design |
| **Interview sections** | 7 (caching/Redis), 22 (scalability & HA), 9 (networking) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the API gateway for a multi-tenant platform. A single bad client — a
runaway retry loop, a scraper, a paying tenant who deployed a bug — can saturate
a downstream that everyone shares. The product limit is stated **globally**:
"5,000 req/s per API key, across the entire fleet," not "5,000 per node." With
40 app nodes behind a load balancer, a naive per-node limiter lets a tenant do
40× their quota, and a strict central limiter adds a Redis round-trip to *every*
request on a path that's supposed to add **microseconds**, not milliseconds.

Your job is to build a **distributed rate-limiter** — a Go middleware plus a
small control service — that enforces a *global* limit across the fleet, holds up
at **1M+ decisions/s aggregate** over **millions of distinct keys**, adds a tiny
and *bounded* latency tax, and — this is the senior part — **degrades on purpose**
when Redis is slow or gone, instead of taking the whole API down with it.

> The deep algorithm comparison (token vs leaky bucket vs sliding-window-log vs
> GCRA; accuracy vs memory vs burst) lives in the sibling
> [`resilience/01-rate-limit-algorithm-bake-off`](../../resilience/01-rate-limit-algorithm-bake-off/).
> **Reference it; don't re-derive it here.** This project is about *operating* a
> distributed limiter at scale: the round-trip, the failure policy, the hot key,
> and the headers.

## 2. Goals / Non-goals

**Goals**
- Enforce a **global** limit across N app nodes using Redis as the shared
  counter, with the decision made by **atomic Lua** (no read-modify-write races).
- Implement **token-bucket** and **sliding-window-counter** behind one interface;
  pick a default and justify it for this workload.
- Cut the per-decision cost: a **strict-central** mode (Redis on every request)
  *and* a **local pre-check + async sync** mode (decide locally, reconcile with
  Redis periodically/batched). Measure the accuracy-vs-latency trade.
- Have an explicit, *configurable* degradation policy — **fail-open vs
  fail-closed** — and prove what each does when Redis is degraded.
- Survive **hot keys** (one tenant = one Redis key = one shard) via sharding.
- Return correct `429`, `Retry-After`, and `RateLimit-*` headers.

**Non-goals**
- Re-running the algorithm bake-off — that's `resilience/01`.
- Hierarchical / per-tenant-per-endpoint quota borrowing and fairness — that's
  [`resilience/04-hierarchical-multitenant-quotas`](../../resilience/04-hierarchical-multitenant-quotas/).
  Here a "tenant" is a flat key; nested quotas are a stretch goal.
- A WAF / bot-detection product. You limit by a key you're given, not by
  fingerprinting clients.
- L7 LB-level rate limiting (Envoy/nginx `limit_req`). You build the *app-side*
  limiter so you control the algorithm, the headers, and the failure policy.

## 3. Functional requirements

1. A **middleware** (`ratelimit.Middleware`) wraps an HTTP (and optionally gRPC)
   handler. Per request it extracts a **key**, asks the limiter for a decision,
   and either passes the request through or returns `429` with correct headers.
2. A **limiter core** exposes `Allow(ctx, key string, cost int) (Decision, error)`
   where `Decision` carries `{Allowed bool, Remaining int, Limit int, ResetAfter
   time.Duration, RetryAfter time.Duration}`.
3. Two algorithms behind the interface, switchable per-key-class by config:
   - **token-bucket** (smooth rate + burst capacity), and
   - **sliding-window-counter** (two-bucket weighted approximation of a rolling
     window; bounded memory, no per-request log).
   Each is implemented as a **single Lua script** evaluated atomically on Redis,
   keyed by tenant key, returning the decision + remaining + reset in one RTT.
4. Two enforcement modes, switchable by flag/config:
   - `strict-central` — every decision hits Redis (exact, one RTT per request).
   - `local-sync` — each node keeps a **local token allowance**, decides from it
     in-process, and **reconciles** with Redis asynchronously (periodic lease
     refill + batched usage reporting). Trades a bounded **overage** for near-zero
     added latency.
5. A **degradation policy** is configurable per key-class: `fail-open` (allow on
   Redis error/timeout) or `fail-closed` (deny). A short **circuit breaker** in
   front of Redis flips to the policy without piling up timed-out calls.
6. **Hot-key sharding:** a single hot tenant key is split into K Redis sub-keys
   (`key:{0..K-1}`), the limit divided across shards, with a documented accuracy
   cost. Sharding is opt-in per key (only for keys that are actually hot).
7. **Multi-tenant key scheme:** keys are namespaced and versioned (see §7) so
   limits, windows, and algorithm can change without colliding with old state.
8. A **chaos hook** (`cmd/chaos`) can add latency to Redis, drop it entirely, and
   restore it — to exercise the degradation policy under load.
9. `/metrics` exposes allow/deny counts, decision latency, Redis RTT, breaker
   state, and per-mode overage (see §9).

## 4. Load & data profile

- **Aggregate decision throughput:** drive **≥ 1,000,000 decisions/s** across the
  fleet (e.g. 20–40 load agents / app nodes). A single sustained run ≥ 10 minutes
  at target rate.
- **Key cardinality:** **≥ 5,000,000 distinct keys** (tenants/API keys) live in
  the keyspace, so Redis memory and key churn are real, not a single counter.
- **Key distribution:** **Zipfian** (s ≈ 1.2) over the keyspace — a handful of
  keys take a large share of traffic. This is deliberate: it manufactures the
  **hot key / hot shard** that breaks a naive single-key design.
- **Cost distribution:** mostly `cost=1`; include a slice of weighted requests
  (`cost=5..50`, e.g. "expensive endpoint") so token-bucket `cost` math is
  exercised, not just unit decrements.
- **Traffic model:** **open-model** load (fixed arrival rate, not closed-loop
  "as fast as it answers") so you can see queueing and `429` rates honestly and
  avoid coordinated omission. State your model.
- **Generator:** `cmd/gen` is deterministic given a seed; it can target a chosen
  over-limit factor (e.g. send each hot key at 1.5× its allowance) so the
  enforcement and overage numbers are reproducible.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| **Decision p99 — `strict-central`** (added by limiter, same-AZ Redis) | < 1.0 ms p99, < 0.4 ms p50 (one Redis RTT + Lua); report p999 |
| **Decision p99 — `local-sync`** (in-process decision) | < 50 µs p99 (no network on the hot path); report sync-RTT separately |
| **Aggregate decision throughput** | ≥ 1,000,000 decisions/s sustained; report the bottleneck (Redis CPU? RTT? a single hot slot?) |
| **Added p99 to the protected service** | ≤ +1 ms p99 in `strict-central`, ≤ +0.1 ms p99 in `local-sync`, vs the no-limiter baseline |
| **Counting accuracy (strict-central)** | **Exact** within one window: allowed ≤ limit (no over-admit beyond Lua atomicity) |
| **Counting accuracy (local-sync)** | Bounded **overage ≤ X%** at steady state — *measure and state X*; it is the price of low latency |
| **Behavior under Redis loss** | Policy honored: fail-open → ~0 added errors, limit not enforced; fail-closed → requests denied. **No latency pile-up** (breaker open in < 1 s) |
| **Header correctness** | Every limited response carries `Retry-After` and `RateLimit-*` consistent with the decision (see §8) |

> The point is not a magic 1M number — it's to **find** your decision-throughput
> ceiling, **name** what bounds it, and **quantify** the latency the limiter
> costs the request path it's protecting.

## 6. Architecture constraints & guidance

- **Redis** via `docker-compose` (pin the version). Start single-node; for the
  hot-key and scale experiments, move to **Redis Cluster** (so different keys land
  on different slots/shards). Co-locate Redis with app nodes (same AZ) — the RTT
  *is* the SLO, so don't measure across regions and call it slow.
- **Go client:** `redis/go-redis/v9`. Use `EVALSHA` (script cache) for the Lua,
  with `EVAL` fallback on `NOSCRIPT`. **Pool the connections** — at 1M decisions/s
  the connection pool and pipelining matter as much as the script.
- **Atomicity is non-negotiable:** the whole decision (read counter → check →
  decrement/refill → set TTL) runs **inside one Lua script** so it's a single
  atomic Redis operation. No `GET`-then-`SET` from Go.
- **Time source:** pass the node's wall-clock time *into* the script
  (`redis.call('TIME')` for window math is fine, but be explicit), and reason
  about **clock skew** across nodes — a key that exists on Redis is the single
  source of truth for "now" only if you make it so.
- Keep the **limiter core** independent of HTTP so it can also back a gRPC
  interceptor and a standalone "check" RPC.
- Instrument with **Prometheus**; histogram the *decision* latency and the *Redis
  RTT* as separate series.

## 7. Data model / Redis key schema

Keys are namespaced, versioned, and carry the algorithm so state never collides
across config changes:

```
rl:v1:{algo}:{tenant}:{resource}            # logical key, one rate-limited entity
  e.g.  rl:v1:tb:acct_8123:api_global
        rl:v1:swc:acct_8123:search

# token-bucket state (Redis HASH, single key, atomic Lua):
HASH rl:v1:tb:{tenant}:{resource}
  tokens   -> float   # current tokens
  ts       -> int     # last refill timestamp (ms)
TTL = ceil(capacity / refill_rate) + slack    # self-expiring idle keys

# sliding-window-counter state (two fixed buckets, atomic Lua):
STRING rl:v1:swc:{tenant}:{resource}:{window_start_epoch}   -> count
  current + previous bucket; decision weights previous by elapsed fraction
  TTL = 2 * window  (old buckets self-evict)

# hot-key sharding (opt-in for keys flagged hot):
rl:v1:tb:{tenant}:{resource}#shard{0..K-1}   # limit/K per shard, picked by rand or req-hash
```

**TTL discipline:** every key sets a TTL so **5M idle keys self-evict** — never
rely on a sweeper. The TTL is part of the algorithm (token-bucket: long enough to
not lose tokens between requests; SWC: 2× window so the previous bucket is still
readable). State your TTL math; a wrong TTL is silent inaccuracy.

## 8. API / middleware contract + response headers

**Middleware contract**
```go
type Limiter interface {
    // cost is the number of tokens this request consumes (default 1).
    Allow(ctx context.Context, key string, cost int) (Decision, error)
}
type Decision struct {
    Allowed    bool
    Limit      int           // the configured limit for the window
    Remaining  int           // tokens/quota left after this decision
    ResetAfter time.Duration // until the window/bucket fully refills
    RetryAfter time.Duration // 0 if allowed; else when to retry (denied)
}
```

**HTTP behavior**
- **Allowed** → pass through; attach informative headers:
  - `RateLimit-Limit: 5000`
  - `RateLimit-Remaining: 4317`
  - `RateLimit-Reset: 12`  *(seconds until reset; per the IETF `RateLimit` draft)*
- **Denied** → `HTTP 429 Too Many Requests`, body `{"error":"rate_limited",
  "retry_after":3}`, plus:
  - `Retry-After: 3` *(seconds; integer, RFC-9110 form)*
  - `RateLimit-Remaining: 0` and `RateLimit-Reset: 3`
- **Redis error**, `fail-open` → pass through, set `RateLimit-Remaining` absent or
  best-effort, increment a `limiter_degraded_total` metric (don't lie in headers).
- **Redis error**, `fail-closed` → `429` (or `503` if you distinguish "we don't
  know" from "you're over"); document which and why.

**Config (per key-class)**
```
-algo=tb|swc  -mode=strict-central|local-sync  -policy=fail-open|fail-closed
-limit=5000 -window=1s -burst=10000 -shards=1 -redis-timeout=20ms -breaker-trip=0.5
```

The middleware **must not** add unbounded latency: the Redis call is wrapped in a
hard `context` timeout (e.g. 20 ms) and a circuit breaker, so a slow Redis turns
into a *policy decision*, never a hung request.

## 9. Key technical challenges

- **The per-decision round-trip is the whole problem.** A 0.3 ms same-AZ Redis
  RTT is "free" at 1k req/s and *ruinous* at 1M — it bounds throughput and adds
  tail latency to a path that's supposed to be invisible. `local-sync`
  amortizes it (decide locally, sync in the background) at the cost of **bounded
  overage**. The senior skill is choosing — and *measuring* — that trade.
- **Atomicity vs sharding tension.** One Lua script on one key is exactly correct
  but makes that key a single hot Redis slot. Sharding fixes the hot slot but
  makes the global count approximate (limit/K per shard ≠ exact global limit
  under skew). You can't have exact + sharded + cheap; pick two and prove the cost.
- **Fail-open vs fail-closed is a product decision with a measured cost.**
  Fail-open keeps the API up but lets abuse through during a Redis incident;
  fail-closed protects the downstream but can convert a Redis blip into an outage.
  Neither is "right" — you must measure both and recommend per key-class.
- **Clock & TTL handling.** Token refill and window boundaries are time math.
  Skew across nodes, TTL that's too short (lost tokens / lost previous bucket),
  or relying on Go's clock instead of Redis's all produce *silent* inaccuracy
  that only shows up as wrong allow/deny counts under load.
- **Honest accuracy accounting.** "It works" means: allowed-count vs the
  configured limit, measured, with the overage percentage stated for the
  approximate modes. An average is not an answer; show the distribution.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (decision p50/p99/p999, Redis RTT, throughput,
allow/deny counts, overage %, added p99 to the protected service) for each:

1. **Strict-central vs local-sync — latency & throughput.** Same input rate, same
   limit. Plot decision p99 and aggregate throughput for both modes. Quantify how
   much latency `local-sync` buys and at what **overage %** (accuracy cost).
2. **Round-trip amortization.** In `local-sync`, sweep the sync interval / batch
   size. Show the curve: shorter interval → tighter accuracy, more Redis load;
   longer → cheaper, larger overage. Find the knee for the ≤ X% overage SLO.
3. **Hot-key saturation + sharding mitigation.** Drive one Zipfian-hot key until a
   single Redis slot saturates (watch slot CPU / p99 on that key). Then turn on
   **K-shard** splitting and re-measure: throughput recovered, and the **new
   accuracy error** introduced by per-shard limits under skew.
4. **Redis degraded — fail-open vs fail-closed.** Using `cmd/chaos`, (a) add
   +50 ms Redis latency, then (b) kill Redis entirely, mid-load. Measure, for each
   policy: added error rate, added latency, how fast the breaker opens, and how
   much over-limit traffic leaked (fail-open) or how many good requests were
   denied (fail-closed). Produce the trade-off table.
5. **Distributed counting accuracy under load.** At a known over-limit input
   (each hot key sent at 1.5× allowance) across all nodes, measure
   **actual admitted / configured limit** per window. Report exact (strict) vs
   bounded overage (local-sync, sharded). This is the headline accuracy number.
6. **Added p99 to the protected service.** Put a real downstream behind the
   middleware. Measure the protected service's p99 with the limiter off, in
   `strict-central`, and in `local-sync`. The delta is the latency tax — keep it
   inside §5.

## 11. Milestones

1. Compose Redis + a stub protected service; token-bucket Lua; `strict-central`
   middleware returning correct `429`/`Retry-After`/`RateLimit-*`. Prometheus +
   a Grafana board (allow/deny, decision p99, Redis RTT).
2. `cmd/gen` Zipfian keyspace at 5M keys; first 1M-decisions/s ceiling run; write
   down the bound.
3. Sliding-window-counter Lua; `local-sync` mode with lease refill + batched
   reporting; overage measurement harness (experiments 1–2).
4. Hot-key sharding on Redis Cluster (experiment 3); degradation policy + circuit
   breaker, chaos run (experiment 4).
5. Accuracy + protected-service-tax runs (experiments 5–6); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 10-min run at **≥ 1M decisions/s** with the decision-throughput
      ceiling reported **and the bottleneck named and proven** (Redis CPU / RTT /
      single hot slot — show the evidence).
- [ ] `strict-central` decision p99 < 1 ms; `local-sync` decision p99 < 50 µs;
      both with full latency histograms attached.
- [ ] Added p99 to the protected service within §5 for both modes, vs a
      no-limiter baseline.
- [ ] Strict mode is **exact** (admitted ≤ limit within a window); local-sync
      **overage % is measured and stated**, with the sync-interval knee plotted.
- [ ] Hot-key saturation demonstrated, then mitigated by sharding, with the
      recovered throughput **and** the introduced accuracy error both quantified.
- [ ] Fail-open vs fail-closed measured under degraded **and** dead Redis: the
      trade-off table exists, breaker opens in < 1 s, no latency pile-up.
- [ ] Headers verified: `429` + `Retry-After` + `RateLimit-*` consistent with the
      decision (show captured responses).
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **GCRA (cell-rate)** single-key variant for smooth limiting with one stored
  value; compare memory/accuracy against token-bucket (cross-ref `resilience/01`).
- **Probabilistic / approximate global counter** (e.g. per-node sampling reported
  to Redis) for keys where exactness doesn't matter but cardinality is huge.
- **Two-tier limits** (per-node soft cap as a fast reject + global hard cap) —
  cut Redis traffic for keys that are nowhere near their limit.
- **gRPC interceptor + standalone Check RPC** so non-Go services share the limiter.
- **Nested quota teaser:** per-tenant *and* per-endpoint, then hand off the real
  fairness/borrowing problem to `resilience/04`.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Distributed correctness | Global limit enforced atomically via Lua; strict mode exact | Proves atomicity, reasons about clock/TTL, defends why the count is correct under skew |
| Round-trip cost | Knows Redis RTT is the tax; reports decision p99 | Amortizes it with local-sync; quantifies the accuracy-vs-latency knee |
| Failure policy | Implements fail-open & fail-closed | Measures both under degraded *and* dead Redis; recommends per key-class with the trade-off table |
| Hot keys | Notices the hot slot | Mitigates with sharding and **measures** the introduced accuracy error |
| Accuracy honesty | Reports allow/deny counts | States overage %, shows the distribution, no average-only claims |
| Latency discipline | Hard timeout + breaker, no hung requests | Keeps added p99 inside SLO and proves it against a baseline |
| Communication | Clear findings note + header captures | Could defend every curve and the failure policy to a staff panel |

## 15. References

- **Theory bank:** [`Interview Question/07-caching-and-redis/`](../../Interview%20Question/07-caching-and-redis/)
  (Redis data structures, Lua atomicity, pipelining, TTL/eviction) and
  [`Interview Question/22-scalability-and-high-availability/`](../../Interview%20Question/22-scalability-and-high-availability/)
  (global limits across a fleet, fail-open/closed, graceful degradation). Section
  9 (networking) for the round-trip cost and connection pooling.
- **Sibling labs:**
  [`resilience/01-rate-limit-algorithm-bake-off`](../../resilience/01-rate-limit-algorithm-bake-off/)
  for the algorithm comparison (token/leaky bucket, sliding-window log/counter,
  GCRA; accuracy vs memory vs burst) — **don't duplicate it here** — and
  [`resilience/04-hierarchical-multitenant-quotas`](../../resilience/04-hierarchical-multitenant-quotas/)
  for nested per-tenant/endpoint quotas and fairness.
- `redis/go-redis/v9` — `EVALSHA`/script caching, pooling, pipelining.
- Redis docs — Lua scripting atomicity, `EXPIRE`/TTL semantics, Redis Cluster
  slots and hash tags (`{...}`).
- IETF draft `draft-ietf-httpapi-ratelimit-headers` (`RateLimit-*`) and RFC 9110
  §10.2.3 (`Retry-After`).
