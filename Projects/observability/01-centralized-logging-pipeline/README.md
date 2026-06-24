# Centralized Logging Pipeline at Scale

> Build the path a log line takes from a Go service to a queryable index —
> collect → buffer → ship → index → query — for a fleet of services, and make it
> *survive the traffic spike that triples your log volume* instead of taking down
> the app or the log store. The hard part isn't writing the log; it's what
> happens when the sink falls behind and the pipeline has to shed, not collapse.

| | |
|---|---|
| **Tier** | Observability (log aggregation) |
| **Primary domain** | Observability / data pipelines |
| **Skills exercised** | Structured logging (`slog`/`zerolog`), sampling, buffering & backpressure, inverted vs label indexes, cardinality control, retention/compaction, trace correlation, PII redaction, Go |
| **Interview sections** | 18 (observability), 17 (performance), 22 (scalability) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You run platform engineering for ~40 Go services doing a combined ~120k
requests/s at peak. Each service logs — request lines, errors, business events —
and right now every service writes JSON to stdout, a sidecar ships it to a
shared Elasticsearch cluster, and **nobody set a budget on any of it.**

Two things just happened. First, a marketing push doubled traffic for an hour;
log volume went from ~80k events/s to ~250k events/s, the ES ingest queue
backed up, the shipping sidecars buffered to memory, got OOM-killed, and three
services started **blocking on their logging call** and timing out requests.
**Logging caused the outage.** Second, finance noticed the log store is now the
single most expensive line item in the observability bill, mostly from one team
that logged the full request body — including a high-cardinality `user_id` and a
URL with query params — at `INFO` on every request.

Your job is to design and build a centralized logging pipeline that stays **up,
bounded, and cheap** when log volume explodes: structured logs at the source,
sampling and level discipline, a collection path that *never blocks the
application*, a buffer that sheds gracefully when the sink lags, an index whose
cost you can predict and cap, and queries that stay usable over a multi-TB
corpus. You will produce numbers — events/s ingested, p99 query latency, app-side
logging latency under sink stall, drop rate during a spike — not opinions.

This complements `senior/06-observability-backend` (which is the *storage
backend* — the OTLP/index side) and the building-blocks logging primitives:
here you own the **whole pipeline end to end** and its failure modes.

## 2. Goals / Non-goals

**Goals**
- Emit **structured** logs (`slog` or `zerolog`) from a fleet of Go services with
  consistent fields, levels, and trace/correlation IDs.
- Build a collection + buffer + ship path that holds the invariant **"the
  application is never blocked by logging"** under sink stall.
- Stand up a real index (Loki-style label index *or* ELK-style inverted index)
  and characterize ingest throughput, query latency, index size, and cost.
- Make **sampling** and **cardinality control** first-class: cut volume without
  losing the signal you need to debug.
- Define and enforce a **cost ceiling**: bytes/day ingested and TB retained, with
  retention/compaction that keeps query latency bounded as the corpus grows.

**Non-goals**
- Metrics and tracing pipelines as primary deliverables — those are projects 02
  and the tracing backend. (Trace *correlation* IDs are in scope; the trace
  store is not.)
- A managed log SaaS (Datadog/Splunk). Run the index yourself so you see the
  ingest queue, the index segments, and the cardinality blow-up.
- Building a new log *format* or a new query language. Use JSON + LogQL/Lucene.
- Per-line encryption / a SIEM compliance program — PII *redaction* is in scope,
  a full compliance audit is not.

## 3. Functional requirements

1. A **logging library** (`pkg/log`) wrapping `slog` (or `zerolog`) that every
   service uses: structured fields, levels, a `context`-aware logger that
   auto-attaches `trace_id`/`request_id`/`service`/`env`, and a redaction hook.
2. A **fleet simulator** (`cmd/fleet`) that runs N service instances each
   emitting a realistic log mix (request lines, periodic errors, debug bursts) at
   a configurable per-service rate.
3. A **collection path** with two switchable modes:
   - `sidecar` — service writes to stdout/file; an agent (Vector/Fluent Bit, or
     your own Go shipper `cmd/shipper`) tails and ships.
   - `direct` — service ships over the network itself (in-process async writer).
   State the trade-off and measure both.
4. A **buffer with an explicit overflow policy**, switchable by flag:
   `block` | `drop-newest` | `drop-oldest` | `spill-to-disk`. The default for the
   app-side path must **never be `block`**.
5. An **index + query** layer: ship into Loki *or* Elasticsearch; expose a query
   API (`GET /logs?query=...&from=...&to=...`) and label/field-based filtering.
6. A **sampler**: head sampling by level/route, plus tail-style "keep all logs
   for any request that errored" correlation by `trace_id`.
7. A **redactor**: configurable field/regex rules that drop or mask PII
   (emails, tokens, card numbers) *before* the log leaves the process.
8. **Retention & compaction**: configurable TTL per stream/index, with
   compaction/rollover, so old data ages out and query cost stays bounded.

## 4. Load & data profile

- **Fleet:** simulate **≥ 40 service instances**. Per-service baseline ~2k
  events/s → fleet baseline ~80k events/s; spike profile pushes to
  **≥ 250k events/s** for sustained minutes.
- **Corpus:** generate and retain **≥ 2 TB** of indexed logs (Stage 1/3) so query
  latency over long ranges and index size are real, not toy.
- **Event mix:** ~92% `INFO` request lines, ~5% `WARN`, ~2% `ERROR`, ~1% `DEBUG`
  bursts. Each request line carries `trace_id`, `route`, `status`, `latency_ms`,
  `user_id`, `bytes`.
- **Cardinality:** `route` is low-cardinality (~200 values) — a good label.
  `user_id` is high-cardinality (10M values) and `trace_id` is unbounded — these
  are the **cardinality traps**; they belong in the *log body*, never as an index
  label / indexed keyword that explodes the index.
- **Distribution:** errors are **bursty and correlated** (one bad deploy → a
  flood from one service), and `route` traffic is Zipfian (a few hot endpoints
  dominate). This is deliberate — it stresses per-stream hot spots and sampling.
- **Generator:** `cmd/fleet` is deterministic given a seed; the spike is a
  scripted, repeatable traffic profile (open model — fixed emit rate, so you can
  watch the buffer fill and lag build, not "as fast as the sink drains").

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained ingest throughput | Find & report the pipeline's ceiling (events/s and MB/s); name the bound (shipper CPU? index merge? network? disk fsync?) |
| **App-side logging call latency (p99)** | **< 1 ms at steady state, < 5 ms under full sink stall** — the app must not feel the sink |
| App-side logging latency (worst case) | **Bounded** — a stalled/dead sink must *never* make a log call block for seconds; prove a hard cap |
| Query p99 (label/field filter over last 1 h) | < 2 s on the live corpus at 80% of ingest ceiling |
| Query p99 (range scan over 24 h, filtered) | < 10 s on the ≥ 2 TB corpus |
| Drop policy under overflow | **Explicit and observed**: which policy, what % dropped during the spike, and a metric counting every dropped line |
| Loss budget at steady state (rate below ceiling) | **Zero** drops; buffer flat, not monotonically rising |
| Index cardinality | Bounded — no unbounded label set; `user_id`/`trace_id` never become index labels |
| Cost ceiling | A stated bytes/day ingest cap and TB-retained cap, **enforced** (sampling + retention), not aspirational |

> The point is not a magic number — it's to **find** your pipeline's ingest
> ceiling, **prove** the app never blocks on logging, and **cap** the cost.

## 6. Architecture constraints & guidance

- Bring the index up via `docker-compose`: Loki + (its object store) **or**
  Elasticsearch + Kibana. Pin versions. Loki is the cheaper teaching target for
  label-index + cardinality; ELK is the teaching target for inverted-index cost.
  Do at least one; the bake-off (stretch) does both.
- **App-side writer must be async and bounded**: a ring/channel buffer with a
  drop policy, drained by a background flusher. Synchronous network writes on the
  request path are an automatic fail of this lab.
- Shipper/agent (`cmd/shipper` or Vector/Fluent Bit) batches and compresses
  (gzip/zstd) before sending; it owns retries with backoff and the
  spill-to-disk buffer for sink outages.
- Keep `pkg/log`, `cmd/fleet`, `cmd/shipper`, and the query API as separable
  pieces so you can kill and scale them independently.
- Instrument the pipeline *with metrics* (Prometheus): emit rate, ship rate,
  buffer depth/occupancy, drop count by reason, bytes shipped, sink errors,
  end-to-end log latency (emit→queryable), index ingest rate, active streams /
  index cardinality. You cannot tune what you cannot see — and "the observability
  pipeline has no observability" is the classic trap.

## 7. Data model

```
log event (wire / JSON):
  { ts, level, msg, service, env, trace_id, request_id,
    route, status, latency_ms, user_id, bytes, ...fields }

Loki-style (label index):
  stream  = { service, env, level, route }     -- LOW-cardinality labels ONLY
  body    = the JSON line (trace_id, user_id live HERE, not as labels)
  chunk   = compressed, time-ordered log lines per stream

ELK-style (inverted index):
  index   = logs-YYYY.MM.DD   (time-based rollover)
  doc     = the JSON event; mapping marks high-cardinality fields
            as `keyword: index:false` (stored, not inverted) to bound index size
```

The single most important modeling decision: **what becomes an index
key/label and what stays in the body.** `route` and `level` partition queries
cheaply; `user_id` and `trace_id` as index keys are the cardinality bomb —
keep them searchable-by-scan in the body, not as inverted terms / labels.

## 8. Interface contract

- `GET /logs?query={LogQL|Lucene}&from=&to=&limit=` → matching lines (newest
  first), with the time range and label/field filters honored.
- `GET /metrics` → Prometheus exposition (buffer depth, drop count, ship rate,
  e2e latency, index cardinality, bytes/day).
- `pkg/log` API: `log.Ctx(ctx).Info("msg", "key", val)`; level via env; redaction
  rules + sampling config via a config struct; overflow policy via flag.
- Shipper configured via flags/env: `-mode={sidecar|direct}`,
  `-overflow={block|drop-newest|drop-oldest|spill}`, `-batch`, `-compression`,
  `-sample`, `-buffer-bytes`, `-spill-dir`.

## 9. Key technical challenges

- **The app must never block on logging.** When the sink stalls, a synchronous or
  unbounded path turns a log store outage into an *application* outage. The
  bounded async buffer + drop policy is the safety valve — and "blocking is a
  disaster" is the lesson, not a footnote.
- **Drop vs block vs spill is a real trade-off.** Blocking protects the data and
  kills the app. Dropping protects the app and loses data — *which* data?
  (Drop `DEBUG` before `ERROR`; keep error traces.) Spill-to-disk buys time but
  has its own ceiling (disk fills, fsync cost). Pick per-path and defend it.
- **Cardinality explosion.** One high-cardinality field promoted to a Loki label
  or an ES inverted keyword can multiply active streams / index terms by
  millions, blow up memory, and make ingest crawl. Demonstrate the blow-up, then
  fix it by moving the field to the body.
- **Sampling without losing the signal.** Sample `INFO` aggressively, but keep
  **all** lines for any `trace_id` that errored (tail correlation) — otherwise you
  sampled away exactly the request you need to debug.
- **Query at scale.** A naive full-scan over 2 TB and 24 h is hopeless; queries
  must exploit time partitioning + labels/index to prune chunks. Show the pruning
  working (and what an unprunable high-cardinality query costs).
- **Cost is a design constraint, not an afterthought.** Ingest bytes/day and
  retained TB *are* the bill. Level discipline + sampling + retention are the
  knobs; the cost ceiling must be enforced, not hoped for.

## 10. Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's your control. Then push each axis alone, then
both. Don't tune what isn't yet correct.

| Stage | Data | Ingest rate | What it stresses here |
|-------|------|-------------|------------------------|
| **0 · Simple** | small | low | one service → structured logs → indexed & queryable, **correct** |
| **1 · Big data** | **≥ 2 TB** | low | index size, query latency over long ranges, retention/compaction |
| **2 · High RPS** | small | **≥ 250k events/s** | buffering, backpressure, sampling, the **app-not-blocked** guarantee |
| **3 · Both** | **≥ 2 TB** | **≥ 250k events/s** | query *while* ingesting at peak; cardinality control; cost ceiling |

- **Stage 0 — correctness baseline.** One service uses `pkg/log`, ships into the
  index, and `GET /logs` returns the right lines with `trace_id` and fields
  intact. Redaction strips a planted PII field. This is the control: prove the
  pipeline is *correct* before it's *fast*.
- **Stage 1 — big data (huge retained corpus).** Backfill the index to **≥ 2 TB**
  of logs spanning days. Measure index size vs raw bytes (compression ratio),
  query p99 over 1 h vs 24 h ranges, and how retention/compaction (chunk
  rollover, segment merge, TTL deletion) keep query latency from degrading as the
  corpus grows. Find where a long-range scan stops being interactive.
- **Stage 2 — high RPS (ingest flood).** Drive the fleet to **≥ 250k events/s**
  with a *small* retained corpus. This is the **app-not-blocked** stage: stall the
  sink and prove the app-side log call stays under the latency cap while the
  buffer absorbs, then sheds per its drop policy. Turn on sampling and show
  volume drop without losing error traces. The failure to avoid: logging back-
  pressuring into request latency.
- **Stage 3 — both (production boss fight).** Sustain **≥ 250k events/s** ingest
  *into* and query *over* the **≥ 2 TB** corpus simultaneously. Now the
  interactions bite: ingest competes with query for index CPU/IO; a high-
  cardinality field melts ingest *and* queries; the cost ceiling forces sampling
  + retention choices. Hold all SLOs at once, with the cost cap enforced. A
  project is only "senior/staff done" at Stage 3 — measured and defended.

## 11. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Sink-stall backpressure.** Pause/throttle the index mid-load. Watch buffer
   depth climb; verify the **app-side log call latency stays under the cap** and
   that overflow follows the configured policy. Compare `block` vs `drop-*` vs
   `spill`: app latency, lines lost, recovery time when the sink returns.
2. **Cardinality blow-up.** Promote `user_id` (or `trace_id`) to a Loki label / ES
   inverted keyword. Measure active streams / index terms, ingester memory, and
   ingest throughput before and after. Then move it back to the body and recover.
3. **Sampling sweep.** Sample `INFO` at 100% → 10% → 1%, with tail-keep on errored
   traces. Plot volume/cost vs "could I still debug a sampled-away request?"
4. **Level discipline.** Run with `DEBUG` on for the whole fleet vs `INFO`. Δ in
   events/s, bytes/day, and index size. (This is the cheapest cost win — quantify
   it.)
5. **Sidecar vs direct ship.** Same load both modes: app-side latency, CPU, lines
   lost on a sink outage, operational blast radius. When is each right?
6. **Compression / batching.** none vs gzip vs zstd; batch size 1 → 1k lines.
   Network bytes, shipper CPU, end-to-end latency. Find the knee.
7. **Query under ingest (Stage 3).** Run a label-pruned query and a deliberately
   unprunable high-cardinality query while ingesting at peak. Δ query p99, and
   the effect on ingest rate. Show pruning working.
8. **Retention/compaction.** Let the corpus age past TTL; verify old data deletes,
   compaction reclaims space, and long-range query latency stays bounded.
9. **The outage replay.** Reproduce the §1 incident: 3× volume spike + a stalled
   sink. Prove the app stays up (no request-latency regression from logging) and
   report exactly what the pipeline shed and what it kept.

## 12. Milestones

1. `pkg/log` (structured, ctx-aware, trace IDs, redaction) + Stage-0 single
   service → index → `GET /logs`; Prometheus + a Grafana board.
2. `cmd/fleet` realistic mix; bounded async writer + overflow policy; Stage-2
   ingest flood and the sink-stall backpressure experiment (1).
3. Sampling + tail-keep + level discipline (experiments 3–4); cardinality
   blow-up and fix (experiment 2).
4. Stage-1 ≥ 2 TB backfill; query-latency + retention/compaction work
   (experiments 7–8).
5. Stage-3 combined run + the outage replay (experiment 9); cost-ceiling
   enforcement; findings note.

## 13. Acceptance criteria (definition of done)

- [ ] Stage-0 correctness: `GET /logs` returns the right lines with fields and
      `trace_id` intact; a planted PII field is redacted before leaving the
      process (show the wire bytes).
- [ ] **App-not-blocked proof:** with the sink fully stalled, app-side log-call
      p99 stays under the cap and is **hard-bounded** (no multi-second blocks);
      show the latency histogram and the drop-count metric.
- [ ] Overflow policy is explicit and measured: report % dropped per policy
      during the spike, and that *every* dropped line is counted.
- [ ] Cardinality blow-up demonstrated **and** fixed: streams/terms + memory
      before/after, with ingest throughput recovered.
- [ ] Stage-1: ≥ 2 TB corpus; query p99 over 1 h and 24 h reported; retention
      deletes old data and compaction reclaims space (show it).
- [ ] Stage-3: peak ingest **and** query held simultaneously with all SLOs met
      and the **cost ceiling enforced** (bytes/day + TB cap), with sampling +
      retention as the levers.
- [ ] Ingest ceiling reported **with the bottleneck named and proven** (pprof /
      `iostat` / index-merge metrics).
- [ ] Every number is reproducible from a committed command + config.

## 14. Stretch goals

- **Loki vs ELK bake-off:** same load and corpus into both; compare ingest
  throughput, index size, query latency, and cost-per-GB. Pick one with evidence.
- **OTLP logs:** emit via the OpenTelemetry logs SDK and ship through a Collector;
  compare to the direct path.
- **Tail-based sampling service:** a real two-tier sampler that buffers by
  `trace_id` and decides keep/drop once the request completes (error → keep all).
- **Tiered retention:** hot (fast index) → warm (object store) → cold (frozen)
  with a query that transparently spans tiers; measure the latency cliff.
- **Adaptive sampling:** auto-raise the sample rate when ingest approaches the
  cost ceiling; auto-lower it when error rate spikes (keep more signal in
  incidents).

## 15. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| App-not-blocked guarantee | Async bounded writer; app doesn't block in happy path | **Proves** a hard latency cap under full sink stall; defends drop-vs-block-vs-spill per path |
| Backpressure / overflow | Picks a drop policy and counts drops | Quantifies each policy's app-latency vs data-loss trade-off; recovers cleanly |
| Cardinality control | Knows high-cardinality labels are bad | Demonstrates the blow-up and the fix; bounds streams/terms with evidence |
| Sampling | Samples INFO to cut volume | Keeps the signal: tail-keep on errored traces; defends what was sampled away |
| Index & query at scale | Queries are correct | Exploits time + label/index pruning; explains a long-range / high-cardinality query's cost |
| Cost | Aware logs cost money | Enforces a stated bytes/day + TB ceiling with sampling + retention; reports cost-per-GB |
| Measurement rigor | Reports p99 + ingest rate | Names and proves the ingest bottleneck; explains the tail under load |
| Communication | Clear findings note | Could defend every curve — and the outage replay — to a staff panel |

## 16. References

- `slog` (stdlib structured logging) and `rs/zerolog` docs.
- Grafana **Loki** docs: labels & cardinality, chunks, LogQL, retention/compaction.
- Elasticsearch docs: mappings (`keyword` / `index:false`), index lifecycle
  management (ILM), inverted-index sizing.
- **Vector** / **Fluent Bit** docs: buffering, backpressure, disk buffers, retries.
- OpenTelemetry **logs** spec + Collector pipelines.
- *Designing Data-Intensive Applications* — Ch. 3 (storage & retrieval: inverted
  indexes), Ch. 11 (stream processing).
- Companion build: `senior/06-observability-backend` (the storage/ingest backend).
- See also: `Interview Question/18-observability/` (and 17-performance,
  22-scalability) for the matching theory.
