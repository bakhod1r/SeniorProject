# Observability Backend — Metrics & Traces Ingest at High Cardinality

> Build the thing that *stores your monitoring*. Ingest OTLP metrics and traces
> at millions of samples per second, fight the cardinality explosion that kills
> every naive design, and serve queries over billions of points without an OOM.
> The lesson is that "just store every label" is the most expensive sentence in
> observability.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Telemetry storage / time-series databases |
| **Skills exercised** | OTLP/gRPC ingest, time-series storage model, inverted index, Gorilla/delta-of-delta compression, WAL + block compaction, downsampling/rollups, trace sampling (head vs tail), query engine, backpressure, Go performance (`pprof`) |
| **Interview sections** | 18 (observability), 17 (performance engineering) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You own "metrics" at a company whose Prometheus has fallen over twice this
quarter. Each time the trigger was the same: a team shipped a new label —
`user_id`, or `pod_name` with a churning replicaset, or a raw URL path — and the
number of unique time series jumped from 2M to 40M overnight. The TSDB's head
block ate all the RAM, the OOM killer took it, and an hour of metrics
disappeared during the incident that needed them most.

Leadership wants an in-house telemetry backend: speak **OTLP** so any
otel-instrumented service can point at it, store metrics and traces *cheaply*,
and answer dashboards and ad-hoc queries fast. Your job is to build that backend
and, more importantly, to **understand and bound the cardinality problem** — to
know exactly where the cliff is, what falls off it (memory, ingest CPU, query
latency), and which design choices move the cliff.

You will produce numbers, not opinions. "It scales" is not an answer; "ingest
holds at 3.2M samples/s up to 8M active series, then index RSS grows ~280 B/series
and we hit the cliff at ~12M on a 32 GB box" is.

## 2. Goals / Non-goals

**Goals**
- Ingest **OTLP metrics and traces over gRPC** and decode them efficiently;
  measure the decode cost as a fraction of the ingest budget.
- Implement a **time-series storage model**: a series is `(metric name + sorted
  label set)`; understand and measure why cardinality (number of distinct series)
  — not sample rate — is the thing that kills you.
- Build a **compressed columnar store**: delta-of-delta for timestamps,
  XOR/Gorilla for float values; report compression ratio vs raw.
- Build an **inverted index** (label → posting list of series IDs) for fast label
  matching, and measure its memory cost per series.
- Implement **WAL + block compaction** (Prometheus-TSDB-shaped) so the head block
  is durable and bounded, and **downsampling/rollups** for old data.
- Implement **trace sampling** — head and tail — and quantify each one's effect
  on storage and on the usefulness of what you kept.
- Build a **query engine** over time ranges with label matchers and basic
  aggregation, and meet p99 SLOs for both 1h and 7d windows.
- Implement **ingest backpressure** so that when storage falls behind, you shed or
  slow producers instead of OOMing.

**Non-goals**
- A PromQL-complete query language. Implement matchers + a handful of aggregations
  (`rate`, `sum by`, `avg`, `quantile`) — enough to exercise the storage.
- A distributed/sharded cluster. **Single node** is the assignment; you must be
  able to *explain* the sharding story (by series hash) but not build it.
- A UI. A query API + a couple of Grafana panels pointed at it is plenty.
- Log ingestion. Metrics and traces only.

## 3. Functional requirements

1. An **OTLP ingest server** (`cmd/ingest`) exposing the OTLP/gRPC services
   (`ExportMetricsServiceServer`, `ExportTraceServiceServer`) on `:4317`. It
   decodes protobuf, maps resource+scope+datapoint attributes into a series
   identity, and writes samples to storage.
2. A **storage engine** (`internal/tsdb`) that:
   - assigns a stable `series_id` (hash of metric + sorted labels) and persists
     the label set once;
   - appends `(ts, value)` to that series in compressed chunks;
   - maintains an **inverted index** label→postings for query-time matching;
   - flushes the in-memory **head** to immutable on-disk **blocks** and
     **compacts** small blocks into larger ones.
3. A **WAL** that makes un-flushed head samples crash-recoverable; replay on
   startup must reconstruct the head exactly.
4. A **trace pipeline** (`cmd/ingest` trace path) that stores spans and supports a
   sampling mode flag: `head` (probabilistic at ingest) or `tail` (buffer a trace
   by `trace_id`, decide after it completes, keep error/slow traces).
5. A **downsampler** (`cmd/rollup`) that produces 5m and 1h rollups (min/max/sum/
   count/last) from raw blocks for data older than a retention threshold.
6. A **query API** (`cmd/query`) that serves range queries with label matchers
   and aggregation, choosing raw vs rollup data based on the requested step.
7. **Backpressure**: ingest must apply flow control (gRPC `RESOURCE_EXHAUSTED` /
   bounded queues) when the head or WAL write path saturates — never unbounded
   buffering to OOM.

A storage-engine choice is part of the assignment: either build the **mini-TSDB**
above, **or** back the same API with **ClickHouse**. You must try one fully and
write the trade-off analysis for the other (see §6, §13).

## 4. Load & data profile

- **Metrics volume:** sustain **≥ 1,000,000 samples/s** ingest in the baseline
  run; push toward **5M+ samples/s** to find the ceiling. Single sustained run
  ≥ 30 minutes.
- **Cardinality:** this is the whole point. Sweep **active series** from 100k →
  1M → 5M → **the point where the box dies**. Cardinality comes from a label
  generator with controllable distinct counts:
  `service` (×50) × `instance` (×200) × `endpoint` (×100) × `status` (×8), with a
  **poison knob** to inject a high-cardinality label (`user_id`, `request_id`)
  that explodes series count on demand.
- **Total retained points:** generate enough for **≥ 5 billion** points on disk
  (e.g. 1M series × 1 sample/15s × 21 h ≈ 5B) so compaction and query-over-block
  behavior are real, not toy.
- **Traces volume:** ≥ 200k spans/s, average 8 spans/trace, with a realistic
  latency distribution (p99 long-tail) and a 0.5% error rate so tail-sampling has
  something worth keeping.
- **Generator:** `cmd/gen` is deterministic given a seed; label cardinality and
  the poison knob are flags. Timestamps follow an **open model** (fixed scrape
  interval), not "as fast as storage drains," so you can watch the head and WAL
  grow under sustained pressure.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained metric ingest (baseline, ≤ 1M active series) | **≥ 1M samples/s** on one node; report CPU & the decode-vs-store split |
| Ingest ceiling | **Find & report** it; name the bottleneck (protobuf decode? index lock? chunk append? WAL fsync?) and prove it with `pprof` |
| Index memory per active series | **Measure & report** (target headline: ≤ ~300 B/series); plot RSS vs series count and mark the cliff |
| Value compression (Gorilla, real gauge/counter mix) | **≤ 2 bytes/sample** average on disk; report bits/sample vs the raw 16 B `(int64,float64)` |
| Query p99 — narrow (1 series, 1h) | **< 50 ms** |
| Query p99 — wide (`sum by(service)`, 1h, ~10k series) | **< 500 ms** |
| Query p99 — long range (`sum by(service)`, 7d, via rollups) | **< 2 s**; prove rollups are being used |
| WAL recovery time after kill -9 (1M-series head) | **< 30 s**; head reconstructed exactly |
| Ingest under storage backpressure | Bounded RSS; sheds/slows with explicit `RESOURCE_EXHAUSTED`, **does not OOM** |

> The goal is not a magic number — it's to **find your cardinality cliff**,
> **name what falls off it**, and **show which design choices move it**.

## 6. Architecture constraints & guidance

- **Go everywhere.** OTLP via `go.opentelemetry.io/proto/otlp` + `google.golang.org/grpc`.
  You may front the ingest with an `otel-collector` (OTLP receiver → OTLP exporter
  to your server) to prove wire compatibility, but the backend is yours.
- **Mini-TSDB path:** model it on Prometheus TSDB — a mutable **head** (recent
  ~2h, in memory + WAL), periodic flush to immutable **blocks** (`index` +
  `chunks` files), background **compaction**, and an inverted index inside each
  block. Chunks hold ~120 samples and use Gorilla encoding.
- **ClickHouse path:** one wide table keyed by `(series_id, ts)` with the label set
  in a `Map(String,String)` or normalized into a `series` dimension table;
  `MergeTree` ordered by `(series_id, ts)`, `DoubleDelta`/`Gorilla` codecs on the
  columns, TTL-based rollups via materialized views. Use it to *contrast* the
  effort of buy-vs-build.
- Keep **ingest, query, and rollup as separate binaries** so you can scale and
  profile them independently. Ingest is CPU/alloc-bound; query is I/O + CPU.
- **Instrument yourself with yourself** where sane, plus Prometheus: ingest rate,
  active series gauge, head size, WAL bytes, compaction duration, chunk
  bytes/sample, query p50/p99/p999, index RSS. Keep a `pprof` endpoint hot —
  ingest will be allocation-bound and you will live in the heap and CPU profiles.

## 7. Data model

A **series** is identified by its metric name plus its label set; cardinality is
the count of distinct series, and it is the dominant cost driver.

```
series identity:
  series_id = xxhash64( metric_name + sorted("k=v")... )      // stable, 64-bit
  series:    { series_id PK, labels map[string]string, first_ts, last_ts }

samples (per series, columnar chunk):
  chunk: { series_id, min_ts, max_ts,
           ts:    delta-of-delta varint stream,               // timestamps
           vals:  Gorilla XOR-encoded float64 stream }        // ~120 samples/chunk

inverted index (for label lookup):
  postings:  "label=value" -> sorted []series_id              // intersect for AND matchers
  label_names, label_values dictionaries                      // for /labels, /label/{n}/values

on-disk block (immutable, ~2h of data):
  block/
    meta.json          # time range, series count, stats
    index              # symbol table + postings + series->chunk refs
    chunks/000001      # concatenated Gorilla chunks
  head + WAL:          # mutable recent window, replayed on startup

rollups (downsampled):
  rollup_5m, rollup_1h: per series, { ts, min, max, sum, count, last }

traces:
  span:  { trace_id, span_id, parent_id, service, name, start, dur, status, attrs }
  tail buffer: trace_id -> []span (held until trace idle/complete, then sample-decide)
```

The **inverted index is the memory you cannot escape**: every active series costs
its label strings (deduped via a symbol table) plus its postings-list entries.
Measuring bytes/series here is the core deliverable of the lab.

## 8. Interface contract

**OTLP ingest (gRPC, `:4317`)**
- `opentelemetry.proto.collector.metrics.v1.MetricsService/Export` — accepts
  `ResourceMetrics`; resource + datapoint attributes become the label set.
- `opentelemetry.proto.collector.trace.v1.TraceService/Export` — accepts
  `ResourceSpans`; spans enter the (head/tail) sampling path.
- Backpressure surfaces as gRPC `RESOURCE_EXHAUSTED` when bounded queues fill.

**Query API (HTTP, `:9090`)**
- `GET /api/query_range?query=<expr>&start=&end=&step=` →
  `{ series: [ { labels:{...}, points:[[ts,val],...] } ] }`
  where `<expr>` supports label matchers (`{service="api",status=~"5.."}`) and
  `sum|avg|max|min|quantile by(<labels>)` plus `rate(...)`.
- `GET /api/labels`, `GET /api/label/{name}/values` — index-backed.
- `GET /api/traces?service=&min_dur=&status=` → tail-sampled traces.
- `GET /metrics` → Prometheus exposition of the backend's own internals.

**Flags / env**
- ingest: `-series-flush-interval`, `-head-retention=2h`, `-wal-dir`,
  `-max-inflight`, `-trace-sampling=head|tail`, `-head-rate=0.1`, `-tail-keep=errors,slow`.
- gen: `-rate`, `-series`, `-poison-label`, `-poison-cardinality`, `-spans-rate`,
  `-error-rate`, `-seed`.
- rollup: `-source`, `-resolution=5m|1h`, `-older-than`.

## 9. Key technical challenges

- **The cardinality cliff.** Ingest cost and index RSS are roughly linear in
  *active series*, nearly flat in *sample rate*. Adding one high-cardinality label
  can 20× series overnight. You must find where memory or ingest CPU falls off,
  and show that the slope is the inverted index, not the sample stream.
- **Decode cost.** OTLP protobuf decode + attribute→series mapping can dominate
  the ingest CPU budget before any storage work happens. Profile it; the naive
  `map[string]string` per datapoint allocates brutally.
- **Hot-path allocations.** Series lookup, label sorting, and hashing run millions
  of times per second. The difference between meeting and missing 1M samples/s is
  usually in `pprof`'s alloc profile, not the algorithm.
- **Gorilla on real data.** XOR/delta-of-delta gets you ~1.3 bytes/sample on
  slowly-changing gauges but degrades on noisy/random values — measure the spread,
  not the brochure number.
- **Head vs tail sampling.** Head is cheap and stateless but blind (it may drop the
  one trace that mattered). Tail sees the whole trace and keeps errors/slow ones,
  but must buffer in-flight traces — bounded memory vs completeness is the trade.
- **Backpressure without data loss surprises.** When compaction or WAL fsync falls
  behind, unbounded ingest buffering OOMs. Bounded queues + `RESOURCE_EXHAUSTED`
  keep you alive but now you're dropping samples — make that explicit and counted.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (and a `pprof` profile) for each:

1. **Cardinality cliff.** Fix sample rate; sweep active series 100k → 1M → 5M →
   crash. Plot ingest throughput, ingest CPU, and index RSS vs series count. Mark
   the cliff. Then fire the **poison label** mid-run and watch the slope change.
2. **Rate vs cardinality (the key insight).** Hold series fixed, 2× the sample
   rate; then hold rate fixed, 2× the series. Show that *cardinality* moves RSS
   and ingest CPU far more than *rate* does. This is the headline finding.
3. **Compression ratio.** Gorilla + delta-of-delta vs raw `(int64,float64)`.
   Report bits/timestamp and bits/value on (a) a smooth counter, (b) a noisy
   gauge, (c) random floats. Explain the spread.
4. **Decode budget.** Profile ingest with `pprof`; report what % of CPU is
   protobuf decode + attribute mapping vs chunk append vs index update. Optimize
   the top frame (interning, `sync.Pool`, avoid per-datapoint maps) and re-measure.
5. **Query p99 vs range.** Same `sum by(service)` query over 1h, 24h, 7d. Show
   the 7d query collapses without rollups and meets SLO with them. Prove which
   data source served it.
6. **Head vs tail sampling.** Run both at the same span rate. Compare stored bytes
   **and** "did we keep the error/slow traces?" — head sampling's blindness vs
   tail sampling's buffer memory. Report tail-buffer RSS and how it grows with
   in-flight trace count.
7. **Downsampling: storage win vs fidelity loss.** Roll 1M series to 5m/1h. Report
   the disk savings *and* the error introduced (e.g. a p99 spike invisible at 1h
   resolution). Quantify the fidelity you traded for the bytes.
8. **Backpressure.** Throttle the disk (compaction can't keep up); drive ingest
   above drain rate. Show RSS stays bounded, `RESOURCE_EXHAUSTED` fires, dropped
   samples are counted — and that the process **does not OOM**.
9. **WAL recovery.** `kill -9` mid-ingest with a 1M-series head; measure replay
   time and prove the head is reconstructed sample-for-sample.

## 11. Milestones

1. OTLP/gRPC ingest decoding metrics; in-memory head + series map + inverted
   index; Prometheus self-metrics + a Grafana board (ingest rate, active series,
   head size).
2. `cmd/gen` with cardinality + poison knobs; first **cardinality-cliff** run
   (experiment 1); write down the RSS-per-series number and the bound.
3. Gorilla chunks + WAL + flush-to-block + compaction; compression and recovery
   numbers (experiments 3, 9).
4. Query engine (matchers + `sum by` + `rate`); narrow and wide p99 (experiment 5
   at 1h/24h).
5. Rollups + long-range query path; downsampling win/loss (experiments 5@7d, 7).
6. Trace pipeline with head & tail sampling; sampling comparison (experiment 6).
7. Backpressure + decode-budget optimization (experiments 2, 4, 8); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min ≥ 1M samples/s run at a stated active-series count with
      **bounded** head/RSS; dashboard screenshot attached.
- [ ] **Cardinality-cliff curve** plotted (throughput + index RSS vs series), with
      the cliff marked and the per-series memory cost reported.
- [ ] Ingest ceiling reported **with the bottleneck named and proven** via `pprof`
      (decode / index lock / chunk append / WAL fsync).
- [ ] Compression: bits/sample for timestamps and values on smooth vs noisy data,
      vs the 16-byte raw baseline.
- [ ] Query p99 for narrow (1h), wide (1h), and long-range (7d, via rollups) meets
      §5; the 7d query is shown to use rollups.
- [ ] Head vs tail sampling compared on both **storage bytes** and **kept-the-
      important-traces** usefulness.
- [ ] Backpressure run: RSS bounded, `RESOURCE_EXHAUSTED` shown, dropped samples
      counted, **no OOM**.
- [ ] WAL recovery after `kill -9` reconstructs the head exactly, under 30 s.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Buy-vs-build write-up:** implement the same query API over **ClickHouse** and
  contrast ingest throughput, compression, query p99, and *engineering effort* vs
  your mini-TSDB. State which you'd ship and why.
- **Exemplars / trace-to-metric linking:** attach exemplar trace IDs to metric
  samples; jump from a latency spike to the trace that caused it.
- **Out-of-order ingest** within the head window (late samples), and the index
  cost of supporting it.
- **Series churn / GC:** age out stale series from the head and reclaim index
  memory; measure the churn rate at which RSS stabilizes.
- **Adaptive tail sampling:** raise/lower the keep rate based on buffer pressure;
  show it holds the SLO under a trace burst.
- **Sharding story (design only):** write the ADR for sharding by `series_id`
  hash across N ingesters, including how queries fan out and merge.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Cardinality understanding | Knows series count drives cost | **Proves** the slope is the inverted index; predicts the cliff before hitting it; moves it with a design change |
| Ingest performance | Hits 1M samples/s | Names & proves the bottleneck via `pprof`; kills the top alloc frame and re-measures |
| Storage / compression | Gorilla works, ratio reported | Explains why it degrades on noisy data; reasons about bytes/series end-to-end |
| Query engine | Matchers + aggregation, p99 reported | Meets long-range SLO via rollups; explains raw-vs-rollup planning |
| Trace sampling | Implements head & tail | Quantifies the storage-vs-usefulness trade; chooses with evidence; bounds tail-buffer memory |
| Failure / backpressure | Doesn't OOM; recovers from WAL | Sheds explicitly, counts loss, recovers head exactly and fast |
| Communication | Clear findings note | Could defend every curve — especially the cliff — to a staff panel |

## 15. References

- OpenTelemetry: OTLP spec, `go.opentelemetry.io/proto/otlp`, and the
  `otel-collector` OTLP receiver/exporter (use it to prove wire compatibility).
- Facebook **Gorilla** paper ("Gorilla: A Fast, Scalable, In-Memory Time Series
  Database") — delta-of-delta timestamps + XOR float compression.
- **Prometheus TSDB** format docs (head, WAL, blocks, index, compaction) and Fabian
  Reinartz's writeup — the shape this mini-TSDB borrows.
- ClickHouse `MergeTree`, `DoubleDelta`/`Gorilla` codecs, TTL + materialized-view
  rollups — for the buy-vs-build contrast.
- Go `net/http/pprof` and `runtime/pprof` — you will live here; alloc profiles are
  where the ingest ceiling is found.
- See also: `Interview Question/18-observability/` (metrics/traces/cardinality,
  sampling) and `Interview Question/17-performance-engineering/` (profiling,
  allocation cost, tail latency).
