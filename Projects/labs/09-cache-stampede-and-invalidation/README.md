# Cache Stampede & Invalidation Lab

> Put a read-heavy service in front of a slow database, make one key very hot, and
> let its TTL expire under peak load. Watch the herd melt the origin — then bring
> the origin back to life with single-flight, TTL jitter, and refresh-ahead, and
> prove each one with numbers.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Caching under load |
| **Skills exercised** | Cache stampede, request coalescing (`singleflight`), TTL jitter, refresh-ahead / XFetch, cache-aside vs write-through, negative caching, stale-while-revalidate, Go + Redis (`go-redis`, `golang.org/x/sync/singleflight`) |
| **Interview sections** | 7 (caching & Redis), 17 (performance), 22 (scalability) |
| **Est. effort** | 3–4 focused days |

---

## 1. Context

You own the product-catalog read API at a company doing **40k req/s** at peak.
Every read is served from Redis in front of Postgres; the cache hit rate sits
around 98% and the database barely notices. One afternoon a flash sale points
every client at the same product. That product's cache entry happens to expire,
and within ~50 ms **every in-flight request misses, every request stampedes the
database, the database's connection pool saturates, queries that normally take
80 ms start taking 4 s, and the timeouts cascade back up into the API.** The
cache "protecting" the database briefly became the trigger that took it down.

This is the **cache stampede** (thundering herd / dog-pile) failure mode, and it
is one of the most common ways a healthy cached system falls over under load.
Your job in this lab is to *reproduce* the stampede deterministically, *measure*
exactly how badly a single hot-key expiry hurts the origin, and then *eliminate*
it with the standard toolkit — proving each mitigation with before/after numbers.
You will produce curves, not opinions.

## 2. Goals / Non-goals

**Goals**
- Reproduce a cache stampede on demand: drive a hot key, expire it under peak
  load, and measure the resulting origin QPS spike and API p99 blow-up.
- Implement and quantify **single-flight** (request coalescing) so a key miss
  produces exactly **one** origin call regardless of concurrent demand.
- Desynchronize bulk expiry with **TTL jitter** and measure the difference
  between synchronized and jittered expiry storms.
- Implement **refresh-ahead** (probabilistic early expiration / XFetch) and
  **stale-while-revalidate**, and show the p99 and origin-load win vs on-demand
  recompute.
- Compare **cache-aside vs write-through vs write-back** for consistency under
  concurrent writes.
- Handle **cache penetration** (missing keys) with negative caching, and reason
  about **cache breakdown** (one hot key) vs **cache avalanche** (mass expiry).

**Non-goals**
- A distributed multi-region cache (that's the scalability staff lab). Single
  Redis instance (or a small cluster) is enough to see every effect here.
- Eviction-policy tuning (LRU vs LFU maxmemory) as a primary focus — you'll touch
  it, but the lab is about **expiry under load**, not memory pressure.
- Building a novel cache library. Use `go-redis` and stdlib `singleflight`.

## 3. Functional requirements

1. A **read API** (`cmd/api`) serves `GET /product/{id}` from a cache-aside path:
   look up Redis, on miss read the origin, populate Redis with a TTL, return.
2. A **slow origin** (`cmd/origin` or a real Postgres) answers reads in a
   configurable **50–200 ms** with a **bounded concurrency** (e.g. a pool of 32
   connections / a semaphore) so it can actually be saturated and shed load.
3. The cache fill path is pluggable by flag across these strategies, switchable
   without redeploying logic:
   - `naive` — plain cache-aside, no coalescing (the stampede baseline).
   - `singleflight` — coalesce concurrent misses per key into one origin call.
   - `jitter` — randomized TTL (`base ± jitter%`) to spread expiries.
   - `refresh-ahead` — probabilistic early recompute (XFetch) before expiry.
   - `swr` — serve stale while one background refresh runs.
4. A **load generator** (`cmd/load`) issues reads with a **Zipfian** key
   distribution and can force a chosen hot key to expire mid-run.
5. Write modes (`cmd/writer`) supporting `cache-aside` (invalidate on write),
   `write-through` (update cache + origin), and `write-back` (cache now, origin
   async) so consistency can be measured under concurrent writes.

## 4. Load & data profile

- **Read rate:** open-model load at a **sustained 30k–50k req/s**; single run
  ≥ 15 minutes. Open model (fixed arrival rate, not closed-loop) so you can watch
  queues build when the origin chokes.
- **Key popularity:** **Zipfian** (s ≈ 1.0–1.2) over **1M product IDs**, so a
  handful of keys take the majority of traffic. The single hottest key should
  carry **≥ 10%** of all reads — that is the key you will expire.
- **Origin latency:** configurable **50–200 ms** per read, with **bounded
  concurrency** (e.g. 32). This is the scarce resource the stampede destroys.
- **Origin capacity:** at 32 concurrent × ~100 ms, the origin can serve only
  **~320 reads/s** before it queues — three orders of magnitude below peak read
  rate. The cache is the only thing standing between 40k req/s and that ceiling.
- **Miss profile:** include a slice of **never-existing keys** (e.g. 2% of reads
  hit IDs not in the origin) to exercise penetration / negative caching.
- **Generator:** deterministic given a seed; can schedule a "hot-key expiry
  event" and a "mass-expiry event" at fixed wall-clock offsets.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Origin QPS ceiling (concurrency 32 × ~100 ms) | **~320 reads/s** — derive it, then never let mitigations exceed it during a stampede |
| Origin QPS during hot-key expiry (with mitigation) | **≤ 1 origin call per key per refresh window** — single-flight must collapse the herd to ~1, not thousands |
| API p99 read latency, steady state (98%+ hit) | **< 10 ms** |
| API p99 during a hot-key expiry (with mitigation) | **< 50 ms** (vs seconds in the naive baseline — report the gap) |
| Cache hit rate, steady state | **≥ 97%** |
| Stampede blast radius (naive baseline) | **Measured**: peak origin QPS, pool-saturation duration, API timeout count — this is the number you're driving to zero |
| Correctness under writes | No permanently stale entry after a write completes; write-through/aside reconverge within one TTL |

> The point isn't to hit a magic latency — it's to **find** how hard one expiring
> hot key hits your origin, then **prove** each mitigation removes that spike.

## 6. Architecture constraints & guidance

- Redis 7.x via `docker-compose` (pin the version). One instance is fine; a
  3-node cluster is a stretch goal. Use `go-redis/redis/v9`.
- Origin is either a real Postgres with an artificial `pg_sleep`-style delay, or a
  `cmd/origin` HTTP service that sleeps `50–200 ms` behind a semaphore. Either
  way the **bounded concurrency must be real and observable**.
- Request coalescing: `golang.org/x/sync/singleflight` — its `Do`/`DoChan` keyed
  by cache key is exactly the coalescing primitive. Note the per-process scope:
  singleflight coalesces *within one API instance*, so with N replicas the origin
  can still see up to N concurrent misses per key — call that out and reason about
  it (a distributed lock / Redis `SET NX` mutex is the cross-instance answer).
- Keep API instances stateless and horizontally scalable; run **≥ 2 instances**
  behind a load balancer so the per-process singleflight limitation is visible.
- Instrument everything with Prometheus: read QPS, hit/miss rate, **origin call
  rate**, origin in-flight/pool-wait, singleflight coalesce ratio, p50/p99/p999
  end-to-end, stale-serve count, negative-cache hit count.

## 7. Data model

```
Redis value:   key = "product:{id}"
  payload (JSON or msgpack) + soft metadata for refresh-ahead:
  { data: {...}, computed_at: unix_ms, ttl_ms: int, delta_ms: int }   // delta = last recompute cost

TTL strategies:
  naive         : SET product:{id} <v> EX 60
  jitter        : EX (60 ± rand(0..15))            // ±25% spread
  refresh-ahead : logical-expiry stored in value; physical TTL longer
  swr           : two windows — fresh-until, stale-until (serve stale, refresh bg)

negative cache: key = "missing:{id}" with short TTL (e.g. 5s) to absorb penetration
```

Refresh-ahead (XFetch) recompute trigger:
`now - computed_at + delta_ms * beta * ln(rand()) >= ttl_ms` → recompute early.
A larger `delta_ms` (expensive recompute) or larger `beta` makes early refresh
more likely, so the hot, expensive keys refresh *before* they expire — never
producing a synchronized miss.

## 8. Interface contract

- `GET /product/{id}` → `{ "id": N, "data": {...}, "source": "cache|origin|stale", "age_ms": ... }`
- `POST /product/{id}` (writer) → updates origin and applies the configured write
  mode; returns `{ "mode": "...", "invalidated": true }`.
- `GET /metrics` → Prometheus exposition.
- Configured via flags/env: `-strategy` (naive|singleflight|jitter|refresh-ahead|swr),
  `-write-mode` (aside|through|back), `-ttl`, `-jitter-pct`, `-beta`,
  `-origin-latency`, `-origin-concurrency`, `-neg-ttl`.

## 9. Key technical challenges

- **Reproducing the herd deterministically.** A stampede needs a hot key *and* a
  synchronized miss. You must script the expiry so the spike is repeatable, not a
  lucky accident — `DEL` the hot key (or let a no-jitter TTL fire) at a known
  instant while the load is at peak.
- **Coalescing scope.** `singleflight` collapses concurrent misses to one origin
  call *per process*. With multiple API replicas the origin still sees one call
  *per replica*. Deciding whether that's acceptable, or whether you need a
  cross-instance lock (Redis `SET NX PX` mutex with a short lease), is the real
  design call — and it has a correctness/latency cost to measure.
- **Refresh-ahead without thundering on the refresh.** Probabilistic early
  expiration must itself be coalesced, or you've just moved the herd earlier.
  XFetch's randomness plus singleflight is the combination that works.
- **Stale-while-revalidate consistency window.** Serving stale wins latency but
  defines a bounded staleness you must state and defend (how stale is too stale
  for this data?).
- **Write consistency.** Under concurrent read+write, cache-aside has a classic
  race (a slow read can repopulate a stale value *after* an invalidation).
  Write-through avoids it but couples write latency to two stores. You must
  reproduce the cache-aside race and show it.
- **Penetration.** Requests for keys that don't exist bypass the cache entirely
  and hammer the origin forever unless you negatively cache the miss.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (origin QPS, API p99, hit rate, timeout count) for each:

1. **Stampede baseline (break it):** at peak load, `DEL` the hot key with the
   `naive` strategy. Measure the **origin QPS spike** (expect thousands of
   concurrent misses → pool saturation), API p99 (expect seconds), and how long
   the origin stays saturated. This is your blast radius.
2. **Single-flight (fix it):** repeat experiment 1 with `singleflight`. Origin
   calls for the hot key should collapse to **~1 per refresh**. Plot origin QPS
   and the coalesce ratio (concurrent misses ÷ origin calls).
3. **Replica fan-out:** run experiment 2 with **2 and then 4 API replicas**. Show
   the origin now sees one miss *per replica*, motivating a Redis-mutex
   cross-instance lock; measure that variant's origin QPS and added latency.
4. **TTL jitter vs synchronized expiry (avalanche):** populate 100k keys with the
   **same** TTL, let them all expire at once → mass-expiry storm. Repeat with
   `±25%` jitter. Plot origin QPS over the expiry window for both — synchronized
   should be a spike, jittered a low plateau.
5. **Refresh-ahead vs on-demand (tune it):** `refresh-ahead` (XFetch) vs `naive`
   recompute on the hot, expensive key. Compare **p99** and **origin load** —
   refresh-ahead should keep p99 flat across the expiry boundary while on-demand
   shows a latency notch. Sweep `beta`.
6. **Stale-while-revalidate latency win:** `swr` vs blocking recompute on a
   miss. Measure the p99 difference for requests that arrive during a refresh,
   and report the resulting staleness window.
7. **Cold-start / cache fill:** start with an empty Redis and turn on full load.
   Measure how long the origin stays pinned at its ceiling, the API p99 during
   warm-up, and which strategy reaches steady-state hit rate fastest.
8. **Write consistency (cache-aside race):** with concurrent readers and a writer,
   reproduce the cache-aside stale-repopulation race; then switch to
   `write-through` and show it's gone. Report the staleness window for each mode
   and write-back's reconvergence lag.
9. **Penetration:** drive 5% of traffic at non-existent IDs with and without
   negative caching. Measure origin QPS from misses; show negative caching caps it.

## 11. Milestones

1. Compose up Redis + slow origin; cache-aside read API; load gen with Zipfian
   keys; Prometheus + a Grafana board for QPS / hit-rate / origin-load / p99.
2. Reproduce the stampede (experiment 1) — capture the blast-radius numbers.
3. Single-flight + replica fan-out + Redis-mutex variant (experiments 2–3).
4. TTL jitter and the avalanche experiment (experiment 4).
5. Refresh-ahead (XFetch) and stale-while-revalidate (experiments 5–7).
6. Write-mode consistency and penetration / negative caching (experiments 8–9);
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Stampede reproduced **on demand** with the naive strategy, with a dashboard
      screenshot showing the origin QPS spike and pool saturation.
- [ ] With single-flight, a hot-key miss under peak load produces a **provable
      ~1 origin call** (show the origin call counter / coalesce ratio).
- [ ] Replica fan-out demonstrated and the Redis-mutex cross-instance variant
      measured (origin calls = ~1 globally, with its latency cost reported).
- [ ] Synchronized vs jittered mass-expiry curves plotted side by side.
- [ ] Refresh-ahead keeps p99 flat across the expiry boundary vs on-demand
      (both curves attached); `beta` sweep recorded.
- [ ] Stale-while-revalidate latency win quantified with the staleness window stated.
- [ ] Cache-aside write race reproduced, then shown fixed under write-through.
- [ ] Negative caching shown to cap penetration origin QPS.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- Cross-instance coalescing with a Redis `SET NX PX` mutex *and* a short
  lease-renewal, handling the lock-holder-dies case; compare to per-process
  singleflight on origin load and tail latency.
- Redis Cluster (3 shards): show that a single hot key still concentrates on one
  shard (the hot-slot problem) and try client-side local caching to absorb it.
- Adaptive TTL: lengthen TTLs for hot keys and shorten for cold ones; measure
  hit-rate and memory impact.
- Probabilistic early expiration tuned per-key from measured recompute cost
  (`delta_ms`) instead of a global `beta`.
- Add a local in-process L1 (LRU) in front of Redis and measure the extra hit
  rate vs the added invalidation complexity.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Stampede understanding | Reproduces the herd and names it | Quantifies blast radius (origin QPS, pool-wait, timeouts) and predicts it from the load/latency model |
| Single-flight | Coalesces misses within a process | Knows the per-process limit, measures replica fan-out, and builds + justifies the cross-instance mutex |
| Expiry desync | Adds TTL jitter | Distinguishes breakdown vs avalanche; sizes jitter from the expiry-rate math |
| Refresh-ahead | Recomputes before expiry | Implements XFetch, tunes `beta` from recompute cost, and keeps the refresh itself coalesced |
| Stale-while-revalidate | Serves stale to win latency | Defends the staleness window for the data's consistency needs |
| Write consistency | Knows cache-aside can go stale | Reproduces the race, picks a write mode per workload with evidence |
| Communication | Clear findings note | Could defend every curve and the coalescing-scope trade-off to a staff panel |

## 15. References

- Redis docs: key expiry, `SET NX PX`, eviction policies, cluster hash slots.
- `golang.org/x/sync/singleflight` — `Do` / `DoChan` request coalescing.
- `redis/go-redis/v9` — pipelining, Lua scripts, cluster client.
- Vattani, Chierichetti, Lowenstein — *Optimal Probabilistic Cache Stampede
  Prevention* (XFetch / probabilistic early expiration).
- *Designing Data-Intensive Applications* — caching, staleness, and read paths.
- RFC 5861 — HTTP `stale-while-revalidate` (the pattern, applied server-side).
- See also: `Interview Question/07-caching-and-redis/` and
  `Interview Question/17-performance-engineering/`.
