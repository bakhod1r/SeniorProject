# Hierarchical Multi-Tenant Quotas & Fairness

> Enforce nested limits (global → tenant → endpoint → key) across a fleet, and
> make sure one noisy tenant can't eat the cluster. Build a quota system that is
> *fair* under contention and *accurate* across many nodes — then prove both with
> numbers, not assertions.

| | |
|---|---|
| **Tier** | Resilience (multi-tenant control plane) |
| **Primary domain** | Rate/quota management / distributed counting |
| **Skills exercised** | Hierarchical limits, weighted fair queueing, max-min fairness, deficit round robin, distributed token buckets, Redis + Lua, quota borrowing, SLO tiers, throttle attribution, Go (`go-redis` + Lua) |
| **Interview sections** | 7 (caching / Redis), 22 (scalability & HA), 12 (architecture) |
| **Est. effort** | 4–6 focused days |
| **Builds on** | `resilience/01-rate-limit-algorithm-bake-off` (single-limit algorithm internals) |

---

## 1. Context

You run the API gateway for a multi-tenant SaaS. ~5,000 tenants share one fleet,
and traffic is wildly skewed: 20 "whale" tenants drive 80% of load, and a long
tail of small tenants each send a trickle. Aggregate is **~1.2M req/s** across
~40 gateway nodes. The platform sells tiers — `free`, `standard`, `enterprise` —
each with a contractual request budget.

Two things keep breaking. First, a single limit is too coarse: a tenant within
its overall budget can still hammer one expensive endpoint (`POST /export`) and
melt a downstream. Second, when a tenant suddenly spikes — a bad deploy, a retry
storm, a scrape — it consumes shared capacity and **everybody else's latency goes
up**, even tenants nowhere near their own limit. That's the noisy-neighbor
problem, and "just give everyone a hard cap" leaves capacity idle most of the
time while still failing under bursts.

`resilience/01` taught you *one* limiter (token bucket vs sliding window vs GCRA)
on *one* node. This project is the hard version: **nested** limits a request must
clear at every level, **fairness** so spare capacity is shared justly instead of
first-come-first-served, and **distributed** enforcement where the limit is
global — not per-node. You will produce a quota control plane and defend its
fairness and accuracy under a whale-plus-long-tail load.

## 2. Goals / Non-goals

**Goals**
- Enforce a **hierarchy**: a request must pass `global → per-tenant →
  per-endpoint → per-key` and is rejected at the *first* level it violates.
- Keep a noisy tenant **isolated**: its spike must not degrade other tenants'
  success rate or p99 below their SLO, even when global capacity is contended.
- Share **spare** capacity fairly via a real fairness algorithm (weighted fair
  queueing / max-min / deficit round robin), not arbitrarily.
- Enforce limits **globally across the fleet** with a stated, measured accuracy
  bound — not 40 independent per-node limiters that allow 40× overage.
- Make every throttle **explainable**: which level fired, which tenant, why.

**Non-goals**
- Building the gateway/proxy itself — you may sit inside one Go service or behind
  Envoy; the quota engine is the deliverable.
- Billing/metering accuracy for invoicing (that's a different, stricter problem).
- Per-user auth — `tenant_id` and `api_key` arrive trusted from an upstream.
- A pretty UI — a `/quota/debug` JSON endpoint is enough.

## 3. Functional requirements

1. A **quota engine** library (`quota.Decide(ctx, req) → Decision`) that a request
   passes through. `req` carries `{tenant_id, endpoint, api_key, weight, tier}`;
   `Decision` is `{allow bool, level string, retry_after time.Duration,
   reason string}`.
2. **Hierarchical limits** configured per level. A request consumes from each
   level it traverses and is denied at the first exhausted level. Denial must name
   the level (`global` / `tenant` / `endpoint` / `key`).
3. A **fairness scheduler** for contended capacity: when demand exceeds a level's
   limit, admit by **weighted max-min fairness** across tenants (weights from
   tier), not by arrival order. Implement at least **two** of {WFQ, max-min,
   DRR} and make the active one switchable by flag.
4. **Distributed enforcement** in two modes, switchable by flag:
   - `central` — every decision reads/writes a shared Redis token bucket via a
     single atomic Lua script (strict, but Redis is in the hot path).
   - `local-reconciled` — each node keeps a local bucket sized from its share of
     the global limit, and a background loop reconciles with Redis every `N` ms.
   State the accuracy/latency trade-off you measured for each.
5. **Quota borrowing / bursting**: a tenant under its steady limit may borrow from
   a shared **burst pool** up to a ceiling, repaid as the pool refills. Soft
   limits trigger borrowing; **hard** limits never yield.
6. **Priority tiers & SLOs**: `enterprise > standard > free`. Under global
   pressure, lower tiers are shed first; protected tiers keep their guarantee.
7. **Observability**: per-tenant admitted/throttled counters, per-level denial
   counts, current borrow debt, and a `/quota/debug?tenant=X` endpoint returning
   the live decision trace for that tenant.

## 4. Load & data profile

- **Tenants:** 5,000. Tier mix: 50 `enterprise`, 950 `standard`, 4,000 `free`.
- **Traffic skew:** **Zipfian (s≈1.2)** over tenants — ~20 whales carry ~80% of
  volume; the long tail sends < 5 req/s each. This skew is the whole point.
- **Aggregate rate:** sustained **≥ 1M req/s** across the fleet for a ≥ 20-min
  run; burst experiments push a single tenant to **+300k req/s** instantaneously.
- **Endpoints:** at least 3 with different weights — `GET /read` (weight 1),
  `POST /write` (weight 5), `POST /export` (weight 50) — so endpoint limits bite
  before tenant limits for expensive calls.
- **Fleet:** ≥ 8 gateway nodes (Docker) sharing one Redis (single node, then
  Cluster for the hot-key experiment).
- **Generator:** `cmd/load` is deterministic given a seed; supports a "noisy
  neighbor" mode that spikes one named tenant on a schedule.
- **Traffic model:** open-model (fixed offered rate, not closed-loop) so you can
  watch a victim tenant's success rate move while the attacker spikes.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| **Fairness guarantee** | Under contention, each tenant's admitted share is within **±5%** of its weighted max-min fair share; a noisy tenant cannot exceed its fair share by more than its borrowable burst ceiling |
| **Noisy-neighbor isolation** | During a single-tenant +300k req/s spike, **innocent tenants' success rate stays ≥ 99%** and their decision p99 rises by **< 10%** |
| **Enforcement accuracy (central)** | Global admitted count within **±0.5%** of the configured global limit |
| **Enforcement accuracy (local-reconciled)** | Stated, bounded overage — target **≤ 5%** over the global limit at a 200 ms reconcile interval; report the overage-vs-interval curve |
| **Decision latency p99** | **< 1 ms** added per request in `local-reconciled`; **< 5 ms** in `central` at 1M req/s (Redis in path) |
| **Throttle attribution** | 100% of denials report the correct firing level and tenant (verified against an oracle counter) |
| **Tier protection** | Under 100% global overload, `enterprise` admitted ≥ its reserved floor; `free` is shed first |

> The goal is not a magic number — it's to **find** the fairness/accuracy/latency
> trade-off your design makes and **prove** you control it.

## 6. Architecture constraints & guidance

- Go service(s); `go-redis/v9` for Redis. **All multi-key counter mutations go
  through a single Lua script** so check-and-decrement is atomic — never
  GET-then-SET in app code (that's the classic distributed-counting race).
- Hierarchy is an ordered list of limiters; `Decide` short-circuits on the first
  denial. Be deliberate about ordering: cheapest/most-likely-to-deny first.
- For `local-reconciled`, each node gets `global_limit / live_nodes` as its local
  budget; the reconcile loop trues up against Redis and redistributes unused
  budget from idle nodes (this is where fairness across nodes lives).
- Fairness scheduler operates on the *contended* level only — don't pay WFQ cost
  when capacity is plentiful (fast path: if under limit, admit immediately).
- Burst pool is one shared Redis counter with its own refill rate; borrowing is a
  conditional decrement in the same Lua call as the tenant bucket.
- Instrument with Prometheus: `quota_admitted_total{tenant,tier}`,
  `quota_denied_total{level}`, `quota_borrow_debt{tenant}`, decision-latency
  histogram, Redis-call latency. A Grafana board is part of "done".

## 7. Data model

```
config (static, reloadable):
  global_limit         rps
  tenant_limit[tier]   rps          # enterprise/standard/free
  endpoint_weight[ep]  int          # read=1 write=5 export=50
  burst_pool           { size, refill_rps, per_tenant_ceiling }

central mode — Redis keys (mutated only by Lua):
  q:global                 token-bucket {tokens, ts}
  q:tenant:{id}            token-bucket {tokens, ts, weight}
  q:ep:{id}:{endpoint}     token-bucket {tokens, ts}
  q:key:{api_key}          token-bucket {tokens, ts}
  q:burst                  shared pool  {tokens, ts}
  q:debt:{id}              borrow debt

local-reconciled mode (per node):
  local bucket per level, sized = share of global; reconcile loop:
    every 200ms: push local consumed → Redis, pull new share, redistribute
```

The token-bucket Lua script takes `{key, rate, burst, cost, now}` and returns
`{allowed, remaining, retry_after}`; the engine calls it per level and folds the
results into one `Decision`.

## 8. Interface contract

- `quota.Decide(ctx, Request) (Decision, error)` — the engine entry point.
- `Decision{ Allow bool; Level string; RetryAfter time.Duration; Reason string }`.
- Demo HTTP surface:
  - `POST /api/{endpoint}` (header `X-Tenant`, `X-Api-Key`) → `200` or `429` with
    `Retry-After` and `X-Quota-Level` / `X-Quota-Reason` headers.
  - `GET /quota/debug?tenant=X` → live limits, remaining tokens per level, borrow
    debt, and the last N decisions for that tenant.
  - `GET /metrics` → Prometheus exposition.
- Engine configured via flags: `-mode {central|local-reconciled}`,
  `-fairness {wfq|maxmin|drr|none}`, `-reconcile-ms`, `-burst-pool`,
  `-global-rps`.

## 9. Key technical challenges

- **Nested enforcement without N round-trips.** Four levels naively = four Redis
  calls per request. Fold the hierarchy into **one Lua script** that checks and
  decrements all levels atomically and rolls back partial consumption if a later
  level denies — otherwise you leak tokens on rejected requests.
- **Fairness vs throughput.** Max-min / WFQ must decide *who* gets scarce capacity
  without becoming the bottleneck. The fast path (under limit) must stay
  allocation-free; fairness logic only runs when a level is contended.
- **Distributed accuracy vs latency.** `central` is exact but puts Redis in every
  request path (and creates a hot key for whales). `local-reconciled` is fast but
  drifts — overage scales with reconcile interval and node count. You must measure
  the curve, not hand-wave it.
- **Hot-tenant contention.** A whale's tenant bucket is a single hot Redis key —
  the cluster's throughput ceiling for that tenant is one key's ops/s. Sharded
  counters or local-reconciled mode trade accuracy to relieve it.
- **Correct attribution under concurrency.** When two levels are simultaneously
  near-empty, the denial must report the level that *actually* fired, consistently
  — easy to get wrong when limiters run in parallel.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Noisy neighbor, fairness off vs on.** Run steady long-tail traffic, then
   spike tenant `whale-1` to +300k req/s. With `-fairness none`, measure innocent
   tenants' success rate and p99 as the whale eats the global pool. Switch to
   `-fairness maxmin` and re-measure. **Measure:** victim success rate (must
   recover to ≥ 99%), victim p99 delta, whale's admitted share (should clamp to
   fair share + burst ceiling).
2. **Distributed accuracy: central vs local-reconciled.** Drive a fixed global
   rate above the limit in both modes. **Measure:** actual admitted vs configured
   global limit (overage %), and decision p99. Sweep `-reconcile-ms` = 50, 200,
   1000 and plot **overage vs latency** — find the knee.
3. **Quota borrowing under partial load.** Most tenants idle, one tenant bursts
   above its steady limit. **Measure:** how much it borrows from the pool, that it
   never exceeds the per-tenant ceiling, and that borrowing collapses to zero
   (hard limit holds) once the pool drains.
4. **Hot-tenant contention on the central store.** Push one whale's tenant bucket
   to its Redis-key ops ceiling. **Measure:** the per-key throughput wall and
   decision p99 at that key; then relieve it with sharded counters or
   local-reconciled and re-measure the accuracy cost.
5. **Whale + long-tail fairness.** Run the full Zipfian profile at global
   overload. **Measure:** each tenant's admitted share vs its weighted max-min
   fair share (must be within ±5%); confirm the long tail isn't starved by whales.
6. **Tier protection under total overload.** Offer 150% of global capacity across
   all tiers. **Measure:** that `enterprise` keeps its reserved floor and `free`
   is shed first; quantify each tier's admitted rate.
7. **Throttle-attribution correctness.** Run a mixed load where tenant, endpoint,
   and key limits all fire. Compare engine-reported denial levels against an
   independent oracle counter. **Measure:** attribution accuracy (target 100%).

## 11. Milestones

1. Single-node engine: hierarchical token buckets + one Lua script per level;
   `Decide` short-circuits and attributes denials. Prometheus + Grafana board.
2. `cmd/load` with Zipfian tenants + noisy-neighbor mode; first overload run.
3. Distributed enforcement: `central` Lua path, then `local-reconciled` with the
   reconcile loop (experiment 2 curve).
4. Fairness scheduler (max-min + one of WFQ/DRR); noisy-neighbor containment
   (experiments 1, 5).
5. Burst pool + borrowing + tier protection (experiments 3, 6); attribution proof
   (experiment 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 20-min run at ≥ 1M req/s across ≥ 8 nodes; dashboard screenshot
      attached.
- [ ] Noisy-neighbor experiment shows innocent tenants ≥ 99% success and < 10%
      p99 rise **with** fairness, and the contrast **without** it (both plotted).
- [ ] `central` admitted within ±0.5% of global limit; `local-reconciled`
      overage-vs-reconcile-interval curve plotted with the knee identified.
- [ ] All four hierarchy levels demonstrably enforced, with denials attributing
      the correct level (oracle-verified, 100%).
- [ ] Quota borrowing respects the per-tenant ceiling and the hard limit holds
      when the pool drains (shown).
- [ ] Tier protection: under 150% overload, `enterprise` floor held, `free` shed
      first (numbers shown).
- [ ] Findings note: the accuracy/latency/fairness trade-off of your design,
      defensible to a staff panel. Every number reproducible from a committed
      command + config.

## 13. Stretch goals

- **Sharded counters** for hot whale keys (split one tenant bucket into K Redis
  keys, sum on read) and measure the accuracy loss vs the contention relief.
- **Predictive borrowing**: forecast pool availability from recent demand and
  pre-allocate, reducing borrow-request latency for bursty tenants.
- **Per-endpoint SLOs** layered on tiers (e.g. `export` capped harder than
  `read` regardless of tier).
- **Adaptive limits**: raise/lower a tenant's effective limit from downstream
  health signals (load-shed feedback), not just a static config.
- **Graceful node loss**: when a node dies in `local-reconciled`, prove its share
  is reclaimed by the reconcile loop without a global overage spike.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Hierarchical enforcement | Levels enforced; denial names the level | One atomic Lua check across all levels with correct rollback; no token leak on rejection |
| Fairness | Implements a fairness algorithm; noisy tenant is contained | Proves admitted shares match weighted max-min within ±5%; fast path stays allocation-free |
| Distributed accuracy | Knows central is exact and local drifts | Plots the overage-vs-interval curve; recommends a mode for a given SLO with evidence |
| Noisy-neighbor isolation | Shows victims recover with fairness on | Quantifies victim p99/success delta and bounds the whale to fair-share + burst |
| Hot-key handling | Notices the whale's bucket is a hot key | Measures the per-key wall and mitigates it with a stated accuracy cost |
| Tiers & borrowing | Tiers and burst pool work | Tier floors hold under overload; borrowing respects ceilings and hard limits |
| Communication | Clear findings note | Could defend every fairness/accuracy curve to a staff panel |

## 15. References

- `resilience/01-rate-limit-algorithm-bake-off` — token bucket / sliding window /
  GCRA internals this project composes and distributes.
- Demers, Keshav, Shenker — *Analysis and Simulation of a Fair Queueing
  Algorithm* (WFQ); Shreedhar & Varghese — *Efficient Fair Queueing using Deficit
  Round Robin*.
- Stripe / Cloudflare engineering posts on distributed rate limiting and Redis +
  Lua token buckets.
- `go-redis` Lua scripting (`EVALSHA`) and Redis Cluster hot-key guidance.
- See also: `Interview Question/22-scalability-and-high-availability/` and
  `Interview Question/07-caching-and-redis/`.
