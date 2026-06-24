# Exactly-Once Streaming Analytics Pipeline (Kafka → ClickHouse)

> Stand up the full real-world data-platform pattern: ingest a billion-event
> Kafka stream, compute windowed rollups with watermarks and late-data handling,
> and land the results **exactly once** into ClickHouse — a sink with *no
> transactions* — so the analytics tables never double-count and never lose a
> bucket, even when you kill the processor mid-batch. The hard part isn't the
> happy path; it's making "exactly once" survive across three systems while
> still batching inserts hard enough to keep ClickHouse fast. You will produce
> numbers, not opinions.

| | |
|---|---|
| **Tier** | Staff (cross-cutting, multi-system) |
| **Primary domain** | End-to-end streaming data pipeline |
| **Skills exercised** | End-to-end exactly-once across Kafka→processor→ClickHouse, sink idempotency without transactions (ReplacingMergeTree / insert-dedup / idempotency keys), atomic offset+state commit, event-time windowing & watermarks, late-data handling, insert batching vs the small-insert anti-pattern, checkpointing & recovery, backpressure, backfill/reprocessing, Go (`twmb/franz-go`, `ClickHouse/clickhouse-go`, `cockroachdb/pebble`, `pprof`) |
| **Interview sections** | 11 (messaging & event streaming), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 6–9 focused days |

---

## 1. Context

You own the real-time analytics platform at a company doing ~2B events/day. The
business runs on a single dashboard: per-minute and per-hour rollups of revenue,
unique users, and event counts, sliced by account and country. Today those
numbers come from a nightly batch job, so they're 12–24 hours stale and Finance
keeps catching discrepancies the morning after. Product wants the dashboard
**live** — bounded to a few seconds behind real time — and Finance wants one
thing in writing: **every event is counted exactly once.** Not "approximately."
A double-counted minute that inflates revenue on a board the CFO reads is a
resign-on-the-spot incident.

The naive version of this is a weekend project: a Kafka consumer that does
`INSERT INTO clickhouse` per message. It will be wrong in two ways at once. It
double-counts on every restart (at-least-once delivery + no sink transaction),
and it kills ClickHouse with millions of single-row inserts (the cardinal OLAP
sin — see `labs/02`). The interesting engineering is reconciling the two
pressures that fight each other: **exactly-once wants you to commit small,
verifiable units; ClickHouse wants you to insert huge batches.** And the system
in the middle — Kafka, your stateful windowing processor, ClickHouse — has *no*
distributed transaction spanning all three. There is no XA here. You have to
*construct* exactly-once out of idempotent inserts, deterministic batch
identity, and an atomic offset+state commit.

Your job is to build this pipeline at scale, prove the exactly-once invariant
through a process kill mid-batch, and defend the throughput/latency/correctness
trade-off with measured curves. You will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Ingest a sustained high-volume Kafka stream (target **≥ 200k events/s**, ≥ 1B
  events total per run) and land per-minute / per-hour rollups into ClickHouse.
- Achieve **end-to-end exactly-once**: `sum(clickhouse_rollups) == ground_truth`
  exactly, across processor kills, ClickHouse insert failures, and rebalances.
- Compute event-time windowed aggregations with **watermarks** and a defined
  **allowed-lateness** policy; handle out-of-order and late events correctly.
- Batch inserts into ClickHouse (avoid the small-insert anti-pattern) **without
  breaking** exactly-once — batch identity must be deterministic and replayable.
- Checkpoint windowing state and Kafka offsets atomically so recovery is exact.
- Apply backpressure (slow the Kafka read) when ClickHouse falls behind, rather
  than buffering unboundedly or dropping data.
- Support **backfill / reprocessing** of a historical window without corrupting
  live aggregates.

**Non-goals**
- Adopting Flink / Kafka-Streams / Spark. The whole point is to build the
  exactly-once machinery yourself so you can defend *why* it's correct. (If you
  want the pure windowing engine first, build `events/02` and reuse it here.)
- Sub-second end-to-end latency. This is analytics, not trading; a few seconds
  is the target. Don't over-rotate on latency at the cost of correctness.
- Multi-region / cross-DC replication (that's `staff/04`).
- A query/dashboard layer. You write correct rollup tables; reading them fast is
  `labs/02`'s job.

## 3. Functional requirements

1. A **producer / generator** (`cmd/gen`) emits events to topic `events` at a
   configurable rate with a realistic, *deterministic* (seeded) distribution and
   an injectable fraction of **out-of-order and late** events.
2. A **stream processor** (`cmd/processor`) consumes `events`, maintains keyed
   event-time windows (per-minute and per-hour, keyed by `(account_id, country)`),
   advances a watermark, and emits **closed-window rollups** downstream.
3. A **ClickHouse sink** (`cmd/sink`, or a stage inside the processor) writes
   rollups into ClickHouse in **batches**, with a dedup/idempotency mechanism so
   replays don't double-count.
4. The pipeline guarantees **end-to-end exactly-once**: after any combination of
   processor kill, ClickHouse error, and consumer rebalance, the ClickHouse
   aggregates equal the ground truth computed independently from the same input.
5. **Checkpointing**: window state + the Kafka offsets that produced it are
   persisted atomically; on restart the processor resumes from the last
   checkpoint with no double-emit and no gap.
6. **Backpressure**: when ClickHouse insert latency rises (or returns errors),
   the processor stops advancing Kafka reads instead of growing memory unbounded.
7. A **backfill mode** (`cmd/backfill`) reprocesses a bounded historical offset
   range / time window and lands corrected rollups **without** corrupting or
   double-counting live aggregates for overlapping windows.

## 4. Load & data profile

- **Volume:** generate and replay **≥ 1 billion events** per run; single
  sustained run ≥ 30 minutes at target rate.
- **Rate:** sustained **≥ 200k events/s** ingest; also test a **2–4× burst** to
  exercise backpressure.
- **Event shape:** `{ event_id, account_id, country, event_time, amount, kind }`,
  ~200–400 B serialized.
- **Key distribution:** `account_id` is **Zipfian** (s≈1.1) over 10M accounts so
  windowed state has hot keys and skewed partitions (mirrors `labs/01`).
- **Time skew:** event_time lags ingest_time by a tunable distribution; inject
  **out-of-order** events and a long tail of **late** arrivals (e.g. 1–3% of
  events arrive after their window's nominal close) to exercise watermarks and
  allowed-lateness. Make the late fraction a flag.
- **Generator:** deterministic given a seed, so ground truth is recomputable.
- **Traffic model:** open-model producer (fixed send rate) so you can watch lag
  and end-to-end latency build when the sink is the bottleneck.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained ingest throughput | **≥ 200k events/s** end-to-end (Kafka→windowing→ClickHouse), held flat for ≥ 30 min |
| End-to-end latency p99 (event ingest → row visible in ClickHouse) | **< 10 s** at steady state; report the batching contribution explicitly |
| **Exactly-once invariant** | After processor kill mid-batch + ClickHouse error injection + rebalance: `Σ ClickHouse rollups == ground truth`, **exactly** — zero double-counts, zero loss, per key and in aggregate |
| ClickHouse insert pattern | Batches of **≥ 10k rows** (or async-insert equivalent); **zero** single-row inserts in steady state |
| Watermark / late-data correctness | Defined allowed-lateness window; late events within it are folded into the correct bucket; events beyond it are routed to a side output, **counted**, never silently dropped |
| Consumer lag at steady state (rate below ceiling) | Bounded and flat, not monotonically rising |
| Recovery time after processor kill | Resume to steady-state lag within a stated bound; report it |
| Backpressure behavior | When ClickHouse stalls, Kafka read rate drops and memory stays bounded; **no data loss**, lag recovers when ClickHouse does |

> The point is not to hit a magic number — it's to **find** your pipeline's
> numbers and **prove** the exactly-once invariant survives the chaos run.

## 6. Architecture constraints & guidance

- **Kafka** (3 brokers, KRaft) + **ClickHouse** (single node fine; a 2-shard
  cluster is a stretch) via `docker-compose`. Pin versions; record them.
- **Go** throughout. Kafka client: `twmb/franz-go` (transactions, cooperative
  rebalancing, batch control). ClickHouse: `ClickHouse/clickhouse-go` v2 (native
  protocol, async inserts, batch API).
- Keep the processor and sink as **separate concerns** even if one binary, so you
  can reason about — and independently kill — the windowing stage and the
  ClickHouse-write stage.
- **Local windowing state** lives in an embedded LSM store (`cockroachdb/pebble`
  or `dgraph-io/badger`) once it outgrows RAM — 10M keys × multiple open windows
  will not fit in a map. The checkpoint is a consistent snapshot of this state
  plus the input offsets.
- Decide your **exactly-once seam** explicitly and write it down (see §9). The
  two viable designs: (a) **idempotent ClickHouse inserts** with a deterministic
  `(window_key, version)` and `ReplacingMergeTree` dedup, with offsets committed
  to Kafka only *after* the batch is durably accepted; or (b) **external
  transactional offset store** where the offset/checkpoint and the sink-batch id
  commit together and ClickHouse dedups on replay. Justify the choice.
- Instrument with Prometheus: ingest rate, windowing throughput, ClickHouse
  insert batch size / latency / rows-per-second, end-to-end p50/p99/p999, Kafka
  lag, watermark lag, in-flight batches, dedup hits.

## 7. Data model

**Kafka topics**
```
events            (input)   key=account_id, value=event proto/json, ~200–400 B
rollups.dlq       (late/poison side output) events past allowed-lateness, with reason
```

**Windowing state (embedded LSM, checkpointed)**
```
state key:   (window_kind, account_id, country, window_start)   window_kind ∈ {minute, hour}
state value: { count uint64, sum_amount int128, ... , last_updated_event_time }
meta:        watermark per partition, committed Kafka offsets per (topic, partition)
checkpoint:  atomic snapshot = { state delta, watermarks, offsets, last_emitted_batch_id }
```

**ClickHouse analytics tables**
```sql
-- Rollup fact, idempotent on (window + version). ReplacingMergeTree keeps the
-- highest version per sort key, so a replayed batch overwrites, never duplicates.
CREATE TABLE rollup_minute
(
    window_start  DateTime,
    account_id    UInt64,
    country       LowCardinality(String),
    event_count   UInt64,
    sum_amount    Int128,
    batch_id      UInt64,          -- deterministic sink-batch id
    version       UInt64           -- monotonic per window; dedup key
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMMDD(window_start)
ORDER BY (window_start, account_id, country);

-- rollup_hour is identical with hour-granularity window_start.
-- Reads that must not see pre-merge duplicates use FINAL or a
-- GROUP BY ... argMax(_, version) view; document which and why.
```
`ReplacingMergeTree(version)` is the load-bearing idea: ClickHouse has no
transactions, so we make every sink write **idempotent by identity**. A window's
row carries a deterministic `(window_start, account_id, country)` sort key and a
`version`; reprocessing the same window emits the same key with an equal-or-newer
version, and the merge keeps exactly one. Dedup is *eventual* (it happens at
merge time), so reads use `FINAL` or `argMax(version)` to never observe a
transient duplicate. Spell out this read-side contract — it's where most
candidates get exactly-once subtly wrong.

## 8. Pipeline / interface contract

- **Stages:** `Kafka(events) → consume → keyed event-time windowing (watermark) →
  close-window emit → batch buffer → ClickHouse insert → offset commit`.
- **Sink batch contract:** a batch is a deterministic set of closed-window rows
  with a stable `batch_id` derived from the input offset range it covers. The
  same input range always produces the same `batch_id` and the same rows ⇒ a
  retried or replayed batch is a no-op after dedup.
- **Commit order (the invariant):** offsets advance **only after** the
  corresponding rows are durably accepted by ClickHouse *and* the checkpoint is
  persisted. Crash anywhere before that ⇒ re-emit the same batch ⇒ ClickHouse
  dedups it. Never commit the offset first.
- **Config (flags/env):** `-rate`, `-late-fraction`, `-out-of-order-spread`,
  `-window` (minute|hour), `-allowed-lateness`, `-batch-rows`, `-batch-max-wait`,
  `-eos-mode` (replacing|idempotent-offset-store), `-async-insert`.
- `GET /metrics` → Prometheus exposition.
- `cmd/verify` recomputes ground-truth rollups from the input log/seed and
  `diff`s them against ClickHouse (`FINAL`); exit non-zero on any discrepancy.

## 9. Key technical challenges

- **Sink idempotency without transactions (the crux).** ClickHouse has no
  multi-statement transaction you can join to your offset commit. You cannot do
  "insert rows AND commit offset" atomically across two systems. The fix is to
  make the insert *idempotent* — `ReplacingMergeTree(version)` keyed by window
  identity, or insert-dedup, or an idempotency-key table — so that re-running the
  exact same batch after a crash converges to the same state. Exactly-once
  becomes **at-least-once delivery + idempotent sink + deterministic batch
  identity**. Prove this is equivalent to exactly-once *as observed in the
  rollup tables*, and state where duplicates are visible before merges run.
- **Atomic offset + state commit.** The window state (LSM) and the Kafka offsets
  that produced it must checkpoint as one unit, and offsets must lag the durable
  sink write. A torn commit (state advanced, offset not, or vice-versa) is the
  classic exactly-once bug. Design the commit so the worst case is *replay*, never
  *loss* and never *double-apply-without-dedup*.
- **Batching vs exactly-once.** Big batches keep ClickHouse fast but widen the
  blast radius of a mid-batch crash and the latency floor. Small batches are
  safe and slow and re-create the small-insert anti-pattern. Find the knee and
  show the deterministic-`batch_id` makes a partial batch safe to retry whole.
- **Watermarks & late data.** A watermark decides when a window is "closed" and
  eligible to emit. Too aggressive ⇒ you drop late events (wrong counts); too lax
  ⇒ unbounded state and latency. Allowed-lateness lets a closed window be
  *corrected* by emitting a higher `version` for the same key — which only works
  because the sink is idempotent. Late-beyond-policy events go to a side output
  and are still counted, never silently dropped.
- **Backpressure across the seam.** When ClickHouse slows, the buffer mustn't
  grow without bound. Pause Kafka fetches / pause partitions until the sink
  drains. Memory bounded, lag recovers, zero loss — measure all three.
- **Backfill without corrupting live data.** Reprocessing a historical window
  must emit the *same* `(window_key)` with a newer `version` so ReplacingMergeTree
  overwrites — never a parallel duplicate row and never touching unrelated live
  windows.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (throughput, e2e p50/p99/p999, lag, batch size,
ClickHouse rows/s, allocations) for each:

1. **Throughput & latency at target rate.** Drive ≥ 200k events/s for ≥ 30 min.
   Report sustained ingest, end-to-end p99, and the **batching contribution** to
   latency (how much of p99 is `-batch-max-wait`). Name the bottleneck.
2. **Exactly-once proof (the headline).** During a sustained run, **kill the
   processor mid-batch** (SIGKILL while a ClickHouse insert is in flight), let it
   recover, then run `cmd/verify`: ClickHouse (`FINAL`) must equal ground truth
   **exactly** — zero dupes, zero loss, per key. Repeat with a ClickHouse insert
   *error* injected mid-batch. Show the diff is empty.
3. **Insert-batch sweep.** `-batch-rows` ∈ {1k, 10k, 100k, 1M} × `-batch-max-wait`
   ∈ {200ms, 1s, 5s}. Plot throughput vs e2e p99 vs recovery cost. Confirm
   exactly-once holds at every point (deterministic `batch_id` is what makes
   large batches safe). Find the knee. Show the 1-row baseline melting ClickHouse.
4. **Watermark / late-data correctness.** Sweep `-late-fraction` and
   `-allowed-lateness`. Verify late-within-policy events land in the right bucket
   (via a corrected higher `version`), late-beyond-policy events hit the side
   output and are counted there, and **no event is silently lost**. Show counts.
5. **ClickHouse-slowdown backpressure.** Throttle/pause ClickHouse (CPU limit or
   `system stop merges` / artificial latency) under load. Confirm the processor
   slows Kafka reads, **memory stays bounded**, no data is dropped, and lag
   recovers cleanly once ClickHouse returns. Plot memory and lag through the dip.
6. **Backfill / reprocess.** While live aggregation runs, backfill a historical
   1-hour window from an offset range. Prove live overlapping windows are
   untouched and the backfilled window converges to ground truth (newer `version`
   replaces, no parallel duplicates). `cmd/verify` clean afterward.
7. **EOS tax.** Compare a naive at-least-once-with-duplicates pipeline against the
   exactly-once design at the same input rate. Quantify Δ throughput and Δ p99 —
   the price of correctness.

## 11. Milestones

1. Compose Kafka + ClickHouse up; `cmd/gen` deterministic Zipfian stream with
   injectable late/out-of-order events; Prometheus + Grafana board.
2. Windowing processor with watermarks emitting closed per-minute rollups to logs
   (no sink yet); ground-truth `cmd/verify` for the no-failure path.
3. ClickHouse `ReplacingMergeTree` sink with batched, deterministic-`batch_id`
   inserts; first 200k/s run; baseline e2e p99.
4. Atomic offset+state checkpoint; **exactly-once chaos run** (experiment 2) —
   kill processor + inject insert error, prove `verify` clean.
5. Backpressure + late-data + backfill (experiments 4–6); findings note with the
   batch-size knee and the EOS tax.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min run at **≥ 200k events/s** with **flat** lag and e2e
      p99 reported; dashboard screenshot attached.
- [ ] **Exactly-once proven**: after killing the processor mid-batch **and**
      injecting a ClickHouse insert error during the same run, `cmd/verify` shows
      `ClickHouse FINAL == ground truth` exactly (attach the empty diff).
- [ ] **Zero single-row inserts** in steady state; batch-size vs throughput vs
      e2e-p99 curve plotted, with the knee identified and exactly-once confirmed
      at each point.
- [ ] Watermark/late-data policy documented; late-within-policy folded correctly,
      late-beyond-policy counted in a side output, **no silent loss** (show counts).
- [ ] Backpressure demonstrated: ClickHouse slowdown → bounded memory, no loss,
      lag recovers (plot attached).
- [ ] Backfill of a historical window proven not to corrupt live aggregates.
- [ ] Findings note quantifying the EOS throughput/latency tax and the read-side
      `FINAL`/`argMax(version)` contract. Every number reproducible from a
      committed command + config.

## 13. Stretch goals

- Replace `ReplacingMergeTree` dedup with an **idempotency-key / insert-dedup**
  design and compare correctness window, read-side complexity, and merge cost.
- Move offsets into an **external transactional store** (Postgres) committed with
  the checkpoint; compare against the Kafka-committed-after-sink design.
- **Aggregating sink**: `AggregatingMergeTree` + materialized view so ClickHouse
  does the final merge of partial per-batch aggregates — and reason about whether
  that preserves exactly-once.
- 2-shard ClickHouse: distributed inserts + dedup across shards.
- Exactly-once **consume-process-produce** to an intermediate compacted Kafka
  topic before the sink, and compare with the direct-to-ClickHouse design.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| End-to-end exactly-once | Invariant holds on the happy path and a clean restart | Holds through mid-batch kill **+** sink error **+** rebalance; can explain *why* idempotent-sink + deterministic-batch + ordered-commit equals exactly-once, and where duplicates are visible pre-merge |
| Sink idempotency (no txns) | Uses ReplacingMergeTree and knows reads need `FINAL` | Designs deterministic batch identity, defends the read-side contract, and compares dedup strategies with cost numbers |
| Batching trade-off | Batches inserts; avoids per-row writes | Quantifies the batch-size knee (throughput vs latency vs recovery) and keeps exactly-once at every point |
| Watermarks / late data | Closes windows on a watermark | Tunes allowed-lateness, corrects closed windows via versioned re-emit, counts late-beyond-policy, proves no loss |
| Backpressure & recovery | Doesn't OOM under a slow sink | Bounded memory + zero loss + measured recovery; backfill that doesn't corrupt live data |
| Measurement rigor | Reports throughput + p99 | Isolates the bottleneck, separates batching latency from processing latency, proves cause |
| Communication | Clear findings note | Could defend the exactly-once proof and every curve to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 11 (stream processing),
  Ch. 12 (the future of data systems: exactly-once, idempotence, derived data).
- ClickHouse docs: `ReplacingMergeTree`, `AggregatingMergeTree`, async inserts,
  `FINAL` / `argMax`, deduplication of inserts.
- `twmb/franz-go` (consumer, cooperative rebalancing, manual commits) and
  `ClickHouse/clickhouse-go` v2 (native batch API, async inserts).
- Confluent / Flink: "Exactly Once Semantics", watermarks & allowed lateness.
- See also (build on or reuse): `labs/01-kafka-throughput-and-exactly-once/`
  (Kafka ceiling + EOS), `labs/02-clickhouse-olap-at-scale/` (the small-insert
  anti-pattern, MergeTree modeling), and
  `events/02-stateful-windowing-processor/` (the windowing engine this pipeline
  lands into ClickHouse).
- Theory: `Interview Question/11-messaging-and-event-streaming/`,
  `Interview Question/13-distributed-systems/`,
  `Interview Question/17-performance-engineering/`.
