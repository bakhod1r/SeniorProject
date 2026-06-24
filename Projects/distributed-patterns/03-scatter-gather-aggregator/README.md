# Scatter-Gather / Aggregator

> Fan one request out to N backends in parallel, merge the answers, and return
> within a deadline — *even when some backends are slow or dead.* The whole game
> is tail latency: a scatter-gather is only as fast as its slowest required
> branch, and at fan-out 50 the "rare" p99 of one backend becomes your *common*
> case. Build it correct, then make the tail stop eating the deadline.

| | |
|---|---|
| **Tier** | Distributed-patterns (request fan-out) |
| **Primary domain** | Parallel fan-out / response aggregation |
| **Skills exercised** | Context-deadline propagation, bounded concurrency, hedged/backup requests, partial-result semantics, merge/rank/dedup aggregation, tail-latency analysis, Go (`errgroup`, `context`, `golang.org/x/sync`) |
| **Interview sections** | 13 (distributed systems), 22 (scalability), 9 (networking) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the **search gateway** in front of a sharded index. A query has to hit
**every shard** (the matching documents could be on any of them), so one inbound
request fans out to *N* shard backends, each returns its top-k local hits, and
the gateway merges them into a single ranked page. Same shape powers federated
search, a price-aggregator hitting 30 supplier APIs, a fraud check gathering
signals from 12 services, and a recommendation join.

It works fine in the demo with 4 shards and a warm cache. Then the index grows
to 64 shards, traffic climbs to 20k QPS, and one shard lands on a noisy host
doing a background merge. Suddenly your gateway's p99 is **2.4 s** even though
*every shard's own p99 is 80 ms* — because at fan-out 64, almost every request
touches at least one slow shard. Product asks: "why is search slow?" The shards
all look healthy on their own dashboards. The slowness lives **in the fan-out
math**, not in any one box.

Your job: build a scatter-gather gateway that holds an end-to-end p99 deadline
under injected slow/dead backends — using hedged requests, partial results, and a
shared deadline — and **quantify the tail-amplification** so you can defend the
design to a staff panel. You will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Fan a request out to *N* backends **in parallel** under a single shared
  deadline propagated via `context`, and aggregate the results (merge/rank/dedup).
- Make the end-to-end p99 **decouple** from the worst backend's p99 using
  mitigations: hedged/backup requests, tied requests, and `(n-k)`-of-`n` partial
  results.
- Define and enforce **partial-result semantics**: when the deadline fires,
  return what you have, labelled with a completeness percentage — never hang.
- Bound the fan-out (backpressure) so a flood of inbound requests can't multiply
  into a backend-killing storm.
- **Quantify the tail-amplification math** and the latency-vs-extra-load trade-off
  of hedging.

**Non-goals**
- Building the shard backends themselves — they're stubs with injectable latency
  distributions. The interesting code is the *coordinator*.
- Consensus / leader election — branches are independent, no coordination among
  them (that's `01`/`02`).
- Streaming joins or stateful windowing — this is request/response fan-out, not a
  pipeline (that's `05-fan-out-fan-in`).

## 3. Functional requirements

1. A **gateway** (`cmd/gateway`) accepts an inbound query, fans it out to the
   configured set of backends, aggregates, and returns within a deadline.
2. **Shared deadline:** the inbound request carries (or is assigned) a budget;
   every outbound branch derives its `context` from it via
   `context.WithDeadline`. When the budget is spent, *all* in-flight branches are
   cancelled — no orphaned goroutines, no leaked connections.
3. **Aggregation** is pluggable: at minimum a **top-k merge** (k-way merge of
   per-shard sorted hits, dedup by doc id, global re-rank) and a **numeric
   reduce** (min price across suppliers). State the merge cost.
4. **Completeness modes**, switchable by flag:
   - `all-of-n` — require every branch; slowest branch sets latency (baseline).
   - `k-of-n` — succeed when *k* of *n* branches return; the rest are dropped at
     the deadline, response is labelled partial.
   - `hedged` — after a per-request **hedge delay** (e.g. p95 of a branch), send a
     backup copy of any still-outstanding branch to a second replica; take the
     first to answer; cancel the loser.
5. A **backend stub** (`cmd/backend`) serves a branch with an *injectable* latency
   distribution (fixed, normal, bimodal, or "one host is a straggler") and an
   injectable error/timeout rate.
6. A **chaos hook** can mark a backend **slow** (add fixed latency) or **dead**
   (drop/refuse) mid-run.
7. Every response reports: `completeness` (% of branches included), `branches_ok`,
   `branches_hedged`, `branches_timed_out`, and the `as_of` deadline used.

## 4. Load & data profile

- **Fan-out width:** test at **N = 4, 16, 64, 256** backends. The tail story is
  invisible at 4 and dominant at 256 — that's the point.
- **Per-backend latency:** baseline log-normal with **p50 = 20 ms, p99 = 200 ms**
  (a realistic 10× tail). One backend is the **straggler**: p50 = 20 ms but a 5%
  chance of a 1 s stall (background GC/merge model).
- **Dataset (for the search variant):** a sharded corpus of **≥ 200M documents**
  across the shards, each shard returns its local top-50; the gateway merges to a
  global top-20. Big enough that the **merge cost** (sort/dedup of `N × 50` hits)
  is measurable at N = 256.
- **Inbound traffic:** open-model driver (fixed arrival rate, *not* closed-loop),
  sweeping **100 → 5k → 20k QPS**. Open model is mandatory: hedging changes
  *offered load*, and a closed loop hides that.
- **Generator:** `cmd/gen` is deterministic given a seed (latency draws, doc ids,
  query terms) so a run is reproducible.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| End-to-end p99 (`all-of-n`, N=64, one straggler injected) | **Measure & report** — this is the broken baseline; expect it ≈ backend p999 |
| End-to-end p99 (`hedged`, N=64, same straggler) | **< 250 ms** (≈ single-backend p99) — the tail must decouple from the straggler |
| Completeness under deadline (`k-of-n`, k = 0.95N) | ≥ **95%** of branches included at p99, deadline never exceeded |
| Fan-out amplification factor (extra backend RPS ÷ inbound RPS) | `all-of-n` = N; hedged adds a **bounded ≤ 5%** overhead (cap it and prove it) |
| Deadline adherence | **100%** — no inbound request ever exceeds its budget, partial or not |
| Goroutine / connection leak after cancel | **Zero** — `pprof` shows in-flight count returns to baseline after each request |

> The point is not to hit a magic millisecond — it's to make the **end-to-end
> p99 stop tracking the slowest backend**, and to *prove* the hedge overhead is
> bounded. A scatter-gather that's fast only when every backend is healthy is the
> bug, not the feature.

## 6. Architecture constraints & guidance

- **One coordinator goroutine per inbound request** spawns *N* branch goroutines
  via `errgroup.WithContext` (or a hand-rolled fan-out with a results channel).
  The group's context carries the shared deadline; the first cancellation reason
  (deadline, or `k-of-n` satisfied) tears the rest down.
- **Bound the fan-out.** Total outstanding branch calls = `inbound_concurrency × N`.
  At 20k QPS × 64 that's a 1.28M-call/s firehose. Put a **bounded worker pool /
  semaphore** in front of each backend (or a global one) so backpressure pushes
  back on *intake*, not on the backends. Shed at the gateway before you melt a
  shard.
- **Hedging:** issue the backup only after the hedge delay, and only to a
  *different* replica. Always cancel the loser the instant the winner returns —
  an uncancelled hedge is pure waste and doubles your amplification.
- **Per-branch isolation:** one branch's error/timeout must not fail the request
  (in `k-of-n`/`hedged`) and must not panic the coordinator. Collect per-branch
  outcomes; decide completeness centrally.
- **Don't block the merge on stragglers:** drain results as they arrive into a
  bounded buffer; run the k-way merge over whatever has landed when the deadline
  or `k-of-n` fires.
- Instrument with Prometheus: end-to-end p50/p99/p999, **per-branch** latency,
  hedge-fire rate, hedge-win rate, completeness histogram, branches-timed-out,
  outstanding-branch gauge, and **backend RPS** (to read the amplification factor
  directly).

## 7. Data model

```
inbound query:   { query string, budget_ms int, mode all-of-n|k-of-n|hedged, k int }

branch request:  derived ctx (deadline = now + budget_ms), shard_id, query
branch result:   { shard_id, hits []hit, latency_ms, err, hedged bool }
hit:             { doc_id uint64, score float32, shard_id int }

aggregated response:
  { hits []hit (global top-k after k-way merge + dedup by doc_id),
    completeness float  (branches_ok / N),
    branches_ok, branches_hedged, branches_timed_out int,
    as_of_deadline_ms int }
```
The merge is a **bounded-heap k-way merge** over the per-shard sorted hit lists:
push the head of each arrived list into a min/max-heap of size `global_k`, dedup
by `doc_id` (keep max score). Cost ≈ `O(N·50·log k)` — small per call, but at
N=256 and 20k QPS it's a real CPU line item; measure it.

## 8. Interface contract

- `POST /search` → body `{query, budget_ms, mode, k}` →
  `{hits, completeness, branches_ok, branches_hedged, branches_timed_out, as_of_deadline_ms}`.
  Always returns **200 with a partial result** on deadline, never 504-on-one-slow-shard.
- `GET /metrics` → Prometheus exposition (per-branch + end-to-end histograms).
- Backend stub configured via flags/env: `-latency-dist`, `-p50`, `-p99`,
  `-straggler-rate`, `-error-rate`, `-dead`.
- Gateway configured via flags/env: `-backends`, `-budget`, `-mode`, `-k`,
  `-hedge-delay`, `-max-inflight` (intake bound), `-per-backend-pool`.

## 9. Key technical challenges

- **Tail amplification is the central enemy.** If each backend independently
  meets its deadline with probability *p*, then `all-of-n` meets it with `p^N`.
  At a per-backend 99% on-time (`p = 0.99`): N=1 → 99% on-time, but **N=64 → 0.99^64 ≈ 53%** on-time, and **N=256 → ≈ 8%**. The "1-in-100" slow backend
  becomes the *common* path. This is the Dean & Barroso "*The Tail at Scale*"
  result — internalize the `1 − p^N` curve before writing a line of code.
- **Hedging vs extra load.** A backup request cuts the tail but costs duplicate
  work. Fire the hedge at the **95th percentile** of a branch and only ~5% of
  branches hedge → ~5% extra backend load buys you a near-elimination of the
  straggler tail. Fire it too early (e.g. at p50) and you **double** your load
  for marginal latency gain. Find your hedge-delay knee.
- **Partial-result correctness.** `k-of-n` trades completeness for latency, but
  the answer must be *honestly labelled* and *still useful* — for search, dropping
  1 of 64 shards loses ≤ 1.6% of candidate docs (usually fine); for a "min price"
  reduce, a dropped supplier might be *the* cheap one (sometimes not fine). The
  semantics are domain-specific; state yours.
- **Cancellation hygiene.** The moment `k-of-n` is satisfied or the deadline
  fires, every loser branch must be cancelled and its goroutine/connection
  reclaimed. The classic bug: the request returns but background goroutines keep
  hammering dead backends. `pprof` must show in-flight returning to baseline.
- **Backpressure without deadlock.** Bounding intake and per-backend pools is
  necessary, but a naive bound can deadlock the coordinator (it waits on a pool
  slot held by a branch waiting on the coordinator). Keep the dependency acyclic.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 **correct** first — it's your control. Then push each axis alone,
then both. Don't tune a tail you can't yet measure.

- **Stage 0 · Simple.** Fan out to **N=4** healthy backends, single inbound
  request at a time, `all-of-n`. Propagate one deadline, merge top-k, return.
  Goal: *correctness* — `counted == produced` for the merge (no lost/dup hits),
  deadline always respected, zero goroutine leak. This is the baseline every
  later number is measured against.

- **Stage 1 · Big data.** Fan out across **N=64–256 shards** over the **≥ 200M-doc**
  corpus, low inbound rate. Now the work is in the **merge**: `N × 50` hits to
  sort/dedup/re-rank per query, and the *partial-result* path matters because at
  N=256 the odds that all 256 shards beat the deadline are low even when healthy.
  Measure merge CPU and the completeness distribution. Tune the k-way merge
  (bounded heap, not a full sort) and the per-shard top-k pushdown.

- **Stage 2 · High RPS.** Drop to **N=16** but drive **5k → 20k QPS**. The enemy
  is **fan-out amplification**: 20k × 16 = **320k backend calls/s**. Backends
  saturate, queue, and their *own* tails inflate — feeding the scatter-gather
  tail. Add intake bounding + per-backend pools; turn on hedging and watch the
  **latency-vs-extra-load trade-off** (hedge cuts p99 but lifts backend RPS — find
  the hedge-delay that buys the tail for ≤ 5% extra load).

- **Stage 3 · Both (the boss fight).** **N=64–256 shards over the 200M-doc corpus
  at 20k QPS**, with chaos injecting a **slow** shard (p999 = 1 s) and a **dead**
  shard mid-run. Hold the **end-to-end p99 deadline** via hedging + `k-of-n`
  partial results while the tail-amplification math is working against you.
  **Quantify it:** with per-backend on-time `p = 0.99`, `all-of-n` at N=64 is
  on-time only `0.99^64 ≈ 53%` of the time; show how hedging restores it toward
  `1 − (1−p)^2` per branch (≈ 99.99%), and report the resulting end-to-end p99,
  completeness %, and amplification factor. This is the only stage that counts as
  "staff done."

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Fan-out tail sweep.** All backends healthy. Sweep **N = 1, 4, 16, 64, 256**
   in `all-of-n`. Plot end-to-end p99 vs N and overlay the predicted `1 − p^N`
   on-time curve. Confirm the tail is *amplification*, not any single slow box.
2. **Inject one slow backend.** N=64, `all-of-n`, mark **one** shard p999 = 1 s.
   Show end-to-end p99 collapses to ≈ backend p999. This is the broken baseline
   everything else fixes.
3. **Hedged-request win.** Same setup as (2), turn on `hedged` with hedge-delay =
   branch p95. Report the **Δp99** (should drop back toward single-backend p99)
   and the **Δ backend RPS** (should be a small bounded %). State the hedge-delay
   knee: sweep delay = p50, p90, p95, p99 and plot p99 vs extra-load.
4. **`(n−k)`-of-`n` partial results.** N=64, kill (dead) **2** shards. In
   `all-of-n` the request can't complete; in `k-of-n` with k=62 it returns at the
   deadline with completeness ≈ 96.9%. Show latency and the completeness label;
   argue whether the dropped shards matter for search-merge vs min-price-reduce.
5. **Amplification under load.** N=16, drive 20k QPS. Measure backend RPS with
   hedging off vs on; compute the amplification factor; show intake-bounding +
   per-backend pools keep backends below saturation (shed at the gateway instead
   of melting a shard).
6. **Cancellation / leak proof.** Mid-run, capture `pprof` goroutine + open-conn
   counts. After each request completes (incl. partial/hedged), in-flight must
   return to baseline — prove no leaked branch goroutines hammering dead backends.
7. **Tied requests (stretch).** Instead of delayed hedge, send to *two* replicas
   immediately with a cross-cancel "I've started" message; compare tail and load
   vs delayed hedging.

## 11. Milestones

1. Stage-0 gateway: N=4, shared deadline, `all-of-n`, k-way merge, zero-leak
   cancellation; Prometheus + Grafana board for end-to-end + per-branch latency.
2. Backend stub with injectable latency dists + chaos (slow/dead); `cmd/gen`
   deterministic load; the fan-out tail sweep (experiment 1) with the `1 − p^N`
   overlay.
3. `k-of-n` + partial-result semantics + completeness labelling (experiments 4).
4. Hedged/tied requests + the hedge-delay knee (experiments 3, 7); slow-backend
   injection (experiment 2).
5. Stage-3 boss fight: N=64–256 over 200M docs at 20k QPS with chaos; intake
   bounding + amplification measurement (experiment 5); leak proof (6); findings
   note with the tail-amplification math.

## 12. Acceptance criteria (definition of done)

- [ ] Stage-3 run: N≥64 over ≥200M docs at 20k QPS with a slow **and** a dead
      shard injected; end-to-end **p99 within deadline**, dashboard attached.
- [ ] The `1 − p^N` tail-amplification curve plotted against **measured** p99 vs
      N — prediction and measurement agree, and you can explain any gap.
- [ ] Hedging cuts the injected-straggler p99 back toward single-backend p99 for
      a **stated, bounded** extra backend load (≤ 5%) — both numbers reported.
- [ ] `k-of-n` returns a correctly-labelled **partial** result on dead shards
      without ever exceeding the deadline; completeness % matches branches_ok/N.
- [ ] `pprof` proves **zero** goroutine/connection leak after cancellation.
- [ ] Amplification factor measured under load; intake bounding shown to protect
      backends from the fan-out firehose.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Adaptive hedge delay:** drive the hedge delay from the *live* p95 of each
  backend (EWMA) instead of a static value; measure stability under shifting load.
- **Request-level deadline propagation across hops:** make the gateway itself a
  backend of an upstream gateway (2-level fan-out) and propagate the *remaining*
  budget downward; show the budget shrinking per hop.
- **Backup-request suppression:** Google's "cancel the other copy" optimization —
  measure how much load it saves vs naive hedging at high fan-out.
- **Speculative re-shard:** on a persistently slow shard, re-route its slice to a
  healthy replica for the rest of the request; compare to plain hedging.
- **Weighted completeness:** for min-price-style reduces, weight branches by
  business value so `k-of-n` drops *low-value* branches first.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Tail-latency understanding | Knows p99 of the slowest backend dominates | **Derives `1 − p^N`**, predicts the curve, and matches it to measurement — fluent in Dean & Barroso "*The Tail at Scale*" |
| Hedging | Implements a working backup request | Quantifies the latency-vs-load trade-off; finds the hedge-delay knee; bounds and proves the overhead |
| Partial results | Returns *something* on timeout | Defines honest, domain-correct completeness semantics; argues when dropping a branch is safe and when it isn't |
| Deadline & cancellation | Propagates one `context` deadline | Zero-leak teardown proven with `pprof`; deadline adherence is 100%, partial or not |
| Fan-out amplification | Notices fan-out multiplies backend load | Measures the factor; bounds intake; sheds at the gateway before backends saturate |
| Communication | Clear findings note | Could defend the tail-amplification math and the hedge trade-off to a staff panel |

## 15. References

- Dean & Barroso, **"The Tail at Scale"** (CACM 2013) — the canonical paper:
  fan-out tail amplification, hedged requests, tied requests, backup-request
  suppression. Read it first; this whole project is its lab.
- *Designing Data-Intensive Applications* — Ch. 1 (percentiles, tail latency) and
  the discussion of scatter/gather in partitioned search.
- Go: `context` deadlines/cancellation, `golang.org/x/sync/errgroup`,
  `golang.org/x/sync/semaphore` for bounded fan-out.
- Jeff Dean, "Achieving Rapid Response Times in Large Online Services" (talk) —
  latency-tolerating techniques at fan-out scale.
- See also: `labs/05-elasticsearch-at-scale/` (the sharded query this gateway
  fronts — its per-shard top-k *is* a scatter-gather branch) and database
  **sharding** (`staff/01-sharded-multitenant-platform/`, the cross-shard query
  problem this pattern answers).
- See the parent [`Interview Question/13-distributed-systems/`](../../Interview%20Question/13-distributed-systems/)
  bank for the matching theory (fan-out, tail latency, partial failure); plus
  section 22 (scalability) and 9 (networking/deadlines).
