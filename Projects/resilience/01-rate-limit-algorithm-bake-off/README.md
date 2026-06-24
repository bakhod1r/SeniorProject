# Rate-Limit Algorithm Bake-Off

> Implement every major rate-limit algorithm, drive them all under the same
> 1M+ req/s load, and produce the numbers that let you say — for a given
> requirement — *which one* and *why*. Find where fixed windows leak 2× at the
> boundary, where sliding-log's exactness costs you megabytes, and where a hot
> key melts the shared store.

| | |
|---|---|
| **Tier** | Resilience (rate limiting) |
| **Primary domain** | Rate limiting / overload protection |
| **Skills exercised** | Fixed/sliding window, token & leaky bucket, GCRA, Redis + Lua atomicity, hot-key contention, accuracy/memory/cost trade-offs, Go (`go-redis`) |
| **Interview sections** | 7 (caching/redis), 17 (performance), 22 (scalability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the edge of a multi-tenant API doing **~1M requests/second aggregate**.
Three teams have walked in with three different asks: the auth team wants a
strict "**5 login attempts per minute per account**" with no leakage; the
public-API team wants "**100 req/s but let a client burst to 500**"; the
billing-export team wants "**a smooth 50 req/s, no spikes**" against a fragile
downstream. One generic limiter can't satisfy all three, and the last incident
came from a fixed-window limiter that quietly let **2× the configured rate**
through at the minute boundary.

Before you commit a limiter to the hot path of every request, you're going to
*characterize the field*. This lab implements **all six** major algorithms,
runs them under the same high-load harness, and measures the four axes that
actually decide the choice — **accuracy, memory per key, burst behavior, and
cost** — both as an in-process limiter and as a distributed Redis+Lua limiter.
You will produce a selection matrix, not an opinion.

> **Scope note.** The sibling project `senior/02-distributed-rate-limiter`
> builds a *full production limiter service* (API, sharding, fail-open policy,
> deployment). **This** lab is the **algorithm comparison** that tells that
> service which algorithm to ship. Keep this one a measurement harness.

## 2. Goals / Non-goals

**Goals**
- Implement all six algorithms behind one `Limiter` interface: **fixed-window
  counter, sliding-window log, sliding-window counter (approx), token bucket,
  leaky bucket (as a queue/meter), GCRA**.
- Provide each as an **in-process** variant and a **Redis-backed** variant
  (atomic via a single Lua script per decision).
- Measure each on four axes at scale: **boundary accuracy, memory per key,
  burst allowance, and cost** (CPU/latency for local; Redis CPU + round-trips
  for distributed).
- Reproduce and **quantify the fixed-window boundary-burst flaw** (the 2×).
- Produce an **algorithm-selection matrix**: requirement → recommended
  algorithm, with the measured evidence behind each row.

**Non-goals**
- Building the full limiter *service* (sharding, config API, fail-open,
  deploy) — that's `senior/02`. Here, a tiny HTTP wrapper is enough to drive
  load.
- Multi-tenant quota hierarchies / borrowing — that's `resilience/04`.
- Adaptive / feedback limiting (AIMD, concurrency limits) — that's
  `resilience/02`. These are *fixed-rate* algorithms only.
- Clever distributed clock sync (TrueTime, etc.). You will *expose* clock
  issues, not solve them with exotic hardware.

## 3. Functional requirements

1. A common interface every algorithm implements:
   ```go
   type Limiter interface {
       // Allow returns whether 1 unit is permitted for key now, plus the
       // tokens/retry-after the caller should surface (X-RateLimit-* headers).
       Allow(ctx context.Context, key string, now time.Time) (Decision, error)
   }
   type Decision struct {
       Allowed    bool
       Remaining  int64         // tokens/quota left in window
       RetryAfter time.Duration // when denied
   }
   ```
2. **Six implementations**, each selectable by flag `-algo=fixed|slog|scounter|
   token|leaky|gcra`, each available `-backend=local|redis`.
3. **Local backend:** in-process, sharded `map[string]*state` guarded by striped
   locks (or a sync per-key structure). No network hop.
4. **Redis backend:** one **Lua script** per decision so the read-modify-write is
   atomic on the server (no `WATCH`/round-trip races). Pass `now` from the app
   *and* offer a `redis-time` mode that reads the server clock — so the clock
   experiment is switchable.
5. A **driver** (`cmd/bench`) issues decisions at a configurable rate against a
   configurable key population and distribution, and records accept/deny,
   latency, and memory.
6. An **oracle**: a separate exact reference (sliding-log at full fidelity, or an
   offline replay) used to score every other algorithm's accuracy against ground
   truth for the same request trace.

## 4. Load & data profile

- **Decision rate:** sustained **≥ 1,000,000 decisions/second aggregate** for the
  local backend; **≥ 100k decisions/s** against a single Redis (then scale keys/
  shards to push higher). State your machine.
- **Key cardinality:** **≥ 10,000,000 distinct keys** (per-user / per-IP). Memory
  per key is a headline metric, so you must actually hold millions of live keys,
  not 100.
- **Key popularity:** **Zipfian (s ≈ 1.1)** over the key space, so a handful of
  **hot keys** concentrate traffic — this is what stresses a *shared* store and
  exposes per-key contention. Also run a **uniform** control.
- **Traffic shape:** two profiles — (a) **steady** open-model rate at a fixed
  decisions/s, and (b) **spiky**: baseline plus periodic 5–10× bursts lasting
  1–2 s, to exercise burst allowance (token vs leaky).
- **Trace:** `cmd/gen` emits a deterministic (seeded) request trace
  `(key, ts)` so every algorithm and the oracle see the **identical** stream and
  results are comparable and reproducible.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Local decision p99 latency | < 1 µs amortized at 1M+ decisions/s (it's a map + a few atomics) |
| Redis decision p99 latency (pipelined, warm) | < 2 ms at the stated rate; **report it, then explain the round-trip + Lua cost** |
| Boundary accuracy — fixed-window | **Measure the over-admit**: a perfectly-timed burst at the window edge should reveal **up to 2× the configured rate** in a `2×window` span. Quantify it. |
| Boundary accuracy — sliding-log | **Exact** vs the oracle (0 over-admit) — it *is* effectively the oracle |
| Boundary accuracy — sliding-counter | Bounded approximation error; **report the max over/under-admit %** vs oracle |
| Memory per key — fixed/token/leaky/GCRA | O(1): single-digit to low-tens of **bytes/key**; report measured bytes/key at 10M keys |
| Memory per key — sliding-log | O(requests in window): **report bytes/key** and show it blows up under a hot key |
| Burst allowance | Token bucket admits a configured burst of N immediately; leaky bucket **smooths** to the drain rate. Show both on the spiky profile. |
| Hot-key behavior (Redis) | Report decisions/s and p99 for the **single hottest key** vs the average key; identify the contention bound |

> The goal is **not** to crown a single winner. It's to **fill the selection
> matrix in §10 with measured numbers** and defend every row.

## 6. Architecture constraints & guidance

- **Go.** One package per algorithm behind the `Limiter` interface; the bench
  driver and the Redis Lua scripts are shared.
- **Redis** via `redis/go-redis/v9`. **One Lua script per algorithm**, loaded with
  `SCRIPT LOAD` and invoked by SHA (`EVALSHA`). The whole decision — read state,
  compute, write state, set TTL — must run **inside the script** so it's atomic.
  No application-side read-then-write.
- **TTL hygiene:** every Redis key gets an expiry tied to its window/refill
  horizon so 10M idle keys don't pin memory forever. Report effect of TTL on
  `used_memory`.
- **Local backend:** shard the key map (e.g. 256 stripes) to avoid one global
  lock at 1M decisions/s. Pre-size and reuse state structs to keep allocations
  out of the hot path (`pprof` must show near-zero alloc/decision).
- **Clocks:** the limiter's correctness depends on time. Make the time source
  injectable. For Redis, support both **app-supplied `now`** (clients can
  disagree) and **`TIME` from the Redis server** (single clock, +1 round-trip
  unless folded into the script). The clock experiment toggles between them.
- **Instrument** with Prometheus: decisions/s, allow/deny ratio, p50/p99/p999
  decision latency, Redis round-trips, and `used_memory` sampled from `INFO`.

## 7. Algorithm reference (what you're implementing)

| Algorithm | State per key | Accuracy at boundary | Burst | Memory | Notes |
|-----------|---------------|----------------------|-------|--------|-------|
| **Fixed-window counter** | `count`, `window_start` | **Leaky**: up to 2× across the edge | All-at-once within a window | O(1), tiny | Simplest; the classic boundary flaw |
| **Sliding-window log** | sorted set of timestamps | **Exact** | None (strict) | **O(req/window)** — heavy under hot keys | The oracle; ZSET in Redis |
| **Sliding-window counter** | current + previous window counts | Approx (weighted) | Smoothed | O(1), tiny | Cheap fix for the fixed-window flaw |
| **Token bucket** | `tokens`, `last_refill` | Smooth average; **allows bursts** | **Yes** (bucket depth) | O(1), tiny | "100/s but burst to 500" |
| **Leaky bucket** | `level`, `last_leak` | Smooth average; **no burst** | No (shaped to drain rate) | O(1), tiny | Traffic *shaping*; smooth downstream |
| **GCRA** | single `TAT` (theoretical arrival time) | Smooth, precise | Tunable (burst tolerance τ) | O(1), **one timestamp** | What Redis cell-rate limiters use; token-bucket-equivalent with less state |

You must be able to explain, on a whiteboard, why fixed-window leaks at the edge,
why GCRA needs only one stored value, and why sliding-log is exact but doesn't
scale per key.

## 8. Interface contract

- Driver flags: `-algo`, `-backend`, `-rate`, `-keys`, `-dist=zipf|uniform`,
  `-zipf-s`, `-shape=steady|spiky`, `-limit`, `-window`, `-burst`, `-duration`,
  `-clock=app|redis`.
- `cmd/gen -keys -dist -seed` → deterministic `(key, ts)` trace on stdout/file.
- Optional thin HTTP wrapper `GET /allow?key=…` returning `429` + `Retry-After`
  and `X-RateLimit-Remaining` when denied — only so a real load tool (k6/vegeta)
  can drive the Redis path over the wire if you want network-realistic numbers.
- `/metrics` → Prometheus exposition.
- Findings emitted as a CSV/JSON per run: `algo, backend, dist, rate, keys,
  over_admit_pct, bytes_per_key, p99_us, redis_used_mem`.

## 9. Key technical challenges

- **Atomicity on a shared store.** Read-modify-write per decision *must* be
  atomic or two concurrent requests both pass on the last token. Lua makes the
  whole decision a single server-side op — get the script exactly right
  (including TTL and integer/float handling; Redis Lua numbers are tricky).
- **Boundary correctness, measured not asserted.** Proving the fixed-window 2×
  requires a trace that aligns a burst to the window edge and an oracle to score
  against. Building that harness *is* the lab.
- **Memory at 10M keys.** Sliding-log stores every in-window timestamp; under a
  Zipfian hot key its set explodes. O(1) algorithms hold flat. You must hold the
  keys for real and read `bytes/key` off `used_memory`, not estimate it.
- **Hot-key contention.** Under Zipfian, the hottest key funnels a large share of
  traffic to **one Redis key** → one shard, one keyspace slot, serialized Lua
  executions. Local sharding doesn't help a single hot key either. Find the
  per-key ceiling and explain it.
- **Clock skew.** App-supplied `now` from disagreeing clients can let a client
  cheat a window or get throttled early. Show the failure with two skewed
  clients, then show server-clock mode fixing it (and its round-trip cost).

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each; same trace across algorithms.

1. **Boundary-burst (the 2×).** Configure `limit=100/min`. Fire 100 requests in
   the last 100 ms of one window and 100 in the first 100 ms of the next.
   Measure admits in that **200 ms** straddling the edge. Fixed-window should
   admit ~**200** (2×); sliding-log/counter/GCRA should hold ~100. **Report the
   over-admit % for all six.**
2. **Memory per key at scale.** Load **10M distinct keys**, send the Zipfian
   trace, and read `bytes/key` (from `used_memory` for Redis; `runtime.MemStats`
   / heap pprof for local) for each algorithm. Plot bytes/key. Show sliding-log's
   curve vs the flat O(1) algorithms; show what a single hot key does to
   sliding-log's set size.
3. **Throughput & latency, local vs Redis.** For each algorithm, measure
   sustained decisions/s and p50/p99/p999 (a) in-process and (b) Redis+Lua. Plot
   the gap. Attribute the Redis cost to round-trip vs Lua execution (use
   pipelining; show the effect of batch size).
4. **Hot-key contention (Redis).** Crank Zipfian `s` from 0.8 → 1.1 → 1.4.
   Measure decisions/s and p99 for the single hottest key vs the median key, and
   total throughput. Identify the contention bound and discuss mitigations
   (key-local approximation, randomized sub-keys, request coalescing) — describe,
   don't necessarily build.
5. **Accuracy vs memory trade-off.** Head-to-head: **sliding-log (exact, heavy)**
   vs **sliding-counter (approx, O(1))** on the same trace. Report
   sliding-counter's max over/under-admit % *and* its bytes/key saving. State the
   break-even: at what limit/window/cardinality is the approximation worth it?
6. **Burst handling under spiky load.** On the `-shape=spiky` profile with a 5×
   burst: **token bucket** (depth = burst) should admit the spike up to depth
   then throttle; **leaky bucket** should *flatten* output to the drain rate.
   Plot admitted-rate-over-time for both and GCRA (with τ tuned to match). Show
   the shaping difference visually.
7. **Clock skew.** Two clients with ±2 s skew under `-clock=app`: show one
   over-admits / one starves. Switch to `-clock=redis`: show it corrected, and
   report the added latency.

### Algorithm-selection matrix (the deliverable)

Fill every cell with **your measured numbers**, then defend the recommendation:

| Requirement | Recommended | Why (backed by your data) |
|-------------|-------------|---------------------------|
| Strict "N per fixed window", zero leak, low cardinality | **Sliding-window log** | Exact at the boundary; memory OK when keys/window-volume are small |
| Strict-ish "N per window" at **10M+ keys**, can't afford log memory | **Sliding-window counter** or **GCRA** | O(1) memory; bounded boundary error (report your %) |
| "Steady rate but allow a burst of N" (public API) | **Token bucket** (or **GCRA** w/ burst τ) | Burst depth admits the spike; smooths after |
| "Smooth, no spikes to a fragile downstream" (export job) | **Leaky bucket** | Shapes output to a constant drain rate |
| Minimal per-key state on a shared Redis at huge scale | **GCRA** | One timestamp (TAT) per key; token-bucket-equivalent behavior |
| Quick & dirty, leak-at-edge tolerable | **Fixed-window counter** | Cheapest; only if the 2× edge is acceptable for the use case |

## 11. Milestones

1. `Limiter` interface + fixed-window and token-bucket, local backend; bench
   driver + `cmd/gen` deterministic trace; Prometheus board.
2. Remaining four algorithms (slog, scounter, leaky, GCRA), local; oracle wired
   up; **experiment 1 (boundary 2×)** reproduced and plotted.
3. Redis+Lua backend for all six (one script each, `EVALSHA`, TTLs); **experiment
   3** (local vs Redis throughput/latency).
4. Scale to 10M keys + Zipfian; **experiments 2 & 4** (memory/key, hot-key
   contention).
5. **Experiments 5–7** (accuracy/memory trade-off, burst shaping, clock skew);
   fill the selection matrix; findings note.

## 12. Acceptance criteria (definition of done)

- [ ] All six algorithms implemented behind one interface, **local and Redis**,
      Redis path atomic via a single Lua script per decision.
- [ ] **Boundary-burst measured**: a number for over-admit % per algorithm, with
      fixed-window showing ~2× and the others ~1× — plotted, with the trace
      committed.
- [ ] **Bytes/key reported at 10M keys** for every algorithm, with sliding-log's
      blow-up under a hot key shown explicitly.
- [ ] **Throughput + p50/p99/p999** for local *and* Redis backends, with the
      Redis cost attributed to round-trip vs Lua.
- [ ] **Hot-key contention curve** (Zipfian s sweep) with the per-key ceiling
      identified and explained.
- [ ] **Burst-shaping plot**: token-bucket admits-the-burst vs leaky-bucket
      smooths, on the spiky profile.
- [ ] **Clock-skew demo**: failure under app-clock, fix under redis-clock, with
      the latency cost reported.
- [ ] **Completed selection matrix**, every row backed by a committed number.
- [ ] Every number reproducible from a committed command + seed + config.

## 13. Stretch goals

- **Sliding-window counter as a Lua single-key trick** (current+previous window
  in one hash) and compare its accuracy to the two-window math.
- **Approximate sliding-log** with a fixed-size ring/CMS (Count-Min Sketch) and
  measure the memory/accuracy curve between exact log and O(1) counter.
- **Distributed token bucket with local pre-allocation**: each app instance
  leases a batch of tokens from Redis to cut round-trips; measure the accuracy
  loss vs the round-trip saving (this is the bridge to `senior/02`).
- **`redis-cell` module** (native GCRA) vs your Lua GCRA: latency and correctness.
- **Fairness under contention**: does the hottest key starve others on the same
  Redis shard? Measure tail latency of *cold* keys while a hot key saturates.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Algorithm understanding | Implements all six correctly | Explains *why* each behaves so — derives the fixed-window 2×, GCRA's single-TAT equivalence to token bucket |
| Accuracy measurement | Shows fixed-window leaks at the edge | Quantifies over-admit % for all six vs an oracle; states sliding-counter's error bound |
| Memory analysis | Reports bytes/key | Explains the O(1) vs O(req/window) split; shows hot-key blow-up; picks for a cardinality budget |
| Distributed correctness | Redis decision is atomic (Lua) | Reasons about the round-trip/Lua cost; handles TTL, integer/float Lua pitfalls, clock source |
| Hot-key / contention | Notices the hot key | Measures the per-key ceiling, explains the shard/slot bound, proposes mitigations with trade-offs |
| Selection judgment | Has preferences | Fills the matrix with data and defends each row to a requirement |
| Communication | Clear findings note | Could present the bake-off to a staff panel and survive "why not X?" on every row |

## 15. References

- Generic Cell Rate Algorithm (GCRA) / leaky-bucket-as-meter; `redis-cell` design
  notes; Stripe & Cloudflare engineering posts on sliding-window rate limiting
  (the boundary-burst flaw and the approximation fix).
- `redis/go-redis/v9` — `EVALSHA` / `SCRIPT LOAD`; Redis Lua scripting + atomicity
  semantics; `INFO memory` (`used_memory`) and key-expiry (TTL) behavior.
- *Designing Data-Intensive Applications* — backpressure & load context.
- See also the sibling builds that consume this comparison:
  `senior/02-distributed-rate-limiter/` (the full service),
  `resilience/02-adaptive-concurrency-and-load-shedding/` (feedback limiting),
  `resilience/04-hierarchical-multitenant-quotas/` (quota hierarchies).
- Matching theory: `Interview Question/07-caching-and-redis/` and
  `Interview Question/22-scalability-and-high-availability/`.
