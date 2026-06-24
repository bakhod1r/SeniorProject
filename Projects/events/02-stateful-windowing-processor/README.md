# Stateful Stream-Processing Engine (Flink-lite, in Go)

> Build a stateful stream processor that consumes Kafka and computes windowed
> aggregations *correctly* under out-of-order and late events. Learn where
> watermarks trade correctness for latency, and where keyed state stops fitting
> in RAM and has to spill to disk.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Stream processing / distributed systems |
| **Skills exercised** | Event-time windowing (tumbling/sliding/session), watermarks & allowed lateness, keyed local state + changelog, checkpoint/restart, idempotent sinks, Go (`twmb/franz-go`, `cockroachdb/pebble` or `dgraph-io/badger`, `pprof`) |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the real-time analytics path at a company doing ~2B events/day. Product
wants per-account rollups computed *on the stream* instead of in a nightly batch:
"sessions per user", "5-minute sliding revenue", "count per fixed minute". The
catch is the data isn't tidy — mobile clients buffer offline and flush hours
later, so events arrive **out of order** with a long tail of late arrivals, and
the key space is huge (millions of accounts) so per-key window state won't sit
in memory forever.

Reaching for Flink/Kafka-Streams hides exactly the parts an interviewer probes:
*what a watermark actually is*, *what "allowed lateness" costs you*, and *where
your window state lives when there are 10M keys*. So you build a **Flink-lite**
engine yourself, in Go, and produce numbers: how much late data you drop at a
given watermark lag, when state spills to disk, and how long recovery from a
checkpoint takes after a crash.

## 2. Goals / Non-goals

**Goals**
- Implement **tumbling**, **sliding**, and **session** windows over **event
  time**, keyed by `account_id`, with correct results under reordering.
- Implement **watermarks** + **allowed lateness** and quantify the
  correctness-vs-latency trade-off (how many late events are dropped at each
  watermark lag).
- Hold **keyed local state** for 10M+ keys with a **changelog**, spilling to an
  embedded KV (`pebble`/`badger`) when it exceeds a memory budget.
- **Checkpoint** state + input offsets atomically and **recover** after a crash
  with results that match a no-crash run.
- Emit results to an **idempotent sink** so replay/recovery doesn't double-count.

**Non-goals**
- Reimplementing Flink's full operator graph, SQL layer, or cluster scheduler —
  single process (or a few keyed shards), no distributed task manager.
- Exactly-once *across* operators via two-phase commit to multiple systems —
  one sink, made idempotent. State the guarantee you reach.
- Schema evolution / Avro — fixed binary payload (that's the schema-registry lab).
- Re-sharding window state across nodes live (that's the staff sharding lab).

## 3. Functional requirements

1. A **source** (`cmd/source`) consumes topic `events` from Kafka with `franz-go`,
   extracts the event timestamp from the payload (not the Kafka append time), and
   feeds records into the windowing operator in arrival order.
2. A **windowing operator** (`internal/window`) supports, selectable by flag:
   - `tumbling` — fixed, non-overlapping (e.g. 1-minute) windows.
   - `sliding` — size + slide (e.g. 5-minute size, 1-minute slide).
   - `session` — gap-based (e.g. close after 30s of inactivity per key), with
     **session merging** when a late event bridges two open sessions.
3. A **watermark generator** advances event-time as `max_seen_ts − allowed_skew`
   (bounded-out-of-orderness). Windows fire when the watermark passes
   `window_end + allowed_lateness`; events older than the watermark by more than
   the lateness budget are **dropped and counted** (not silently lost).
4. **Keyed state** stores per-window accumulators keyed by `(key, window)`. State
   lives in memory up to a budget, then spills to `pebble`/`badger`; every state
   mutation is appended to a **changelog** for recovery.
5. A **checkpoint coordinator** (`cmd/checkpoint` or a goroutine) periodically
   snapshots state + the source offsets atomically; on restart the engine loads
   the latest checkpoint and resumes from the committed offsets.
6. A **sink** (`internal/sink`) writes fired-window results idempotently, keyed by
   `(key, window_start, window_end)`, so re-emission after recovery is a no-op.
7. A **chaos hook** (`cmd/chaos`) can `kill -9` the engine mid-run to exercise
   recovery from the last checkpoint.

## 4. Load & data profile

- **Volume:** generate and process **≥ 1 billion events** total; a single
  sustained run ≥ 30 minutes at target rate.
- **Message size:** 256 B events (`account_id`, `value`, `event_ts`, `seq`, pad).
- **Key cardinality:** `account_id` over **10M+ accounts**, **Zipfian (s≈1.1)** so
  a handful of hot keys dominate volume while millions of cold keys still hold
  open window state — this is what makes state large.
- **Out-of-order model:** each event's `event_ts` is delayed from "true" time by a
  **Zipfian-tailed** lag: ~95% within a few seconds, a long tail up to **several
  minutes** late, plus a small fraction of *extreme* stragglers (hours). This is
  the knob the watermark/lateness experiments turn.
- **Generator:** `cmd/gen` is deterministic given a seed; it emits the *true*
  ordering and the *delayed* ordering so you can compute a ground-truth result to
  diff against.
- **Traffic model:** open-model source (fixed input rate) so lag and state growth
  are observable rather than self-throttled by the consumer.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained ingest throughput (256 B, single process) | Find & report the ceiling; name the bound (CPU on window bookkeeping? state I/O? GC/allocs?) |
| Result correctness vs ground truth (no late events) | **100%** of windows match the deterministic batch result, exactly |
| Result correctness with late tail @ chosen watermark | Report **drop rate** (% events past lateness budget) and the resulting per-window error |
| Per-event processing p99 (ingest → accumulator updated) | < 5 ms at 80% of ingest ceiling |
| Window-fire → sink-emit p99 | < 1 s after watermark crosses `window_end + lateness` |
| Resident memory under 10M open keys | **Bounded** (e.g. ≤ 4 GB); engine spills to disk rather than OOMing |
| Recovery time after `kill -9` (load checkpoint → caught up) | Measured & reported; results post-recovery match a clean run |
| State-on-disk size @ 10M keys | Reported, with the compaction story for the changelog |

> The point isn't a magic number — it's to **find** where each trade-off bites
> (watermark lag vs dropped events, key count vs spill, window size vs memory) and
> **explain** it with measurements.

## 6. Architecture constraints & guidance

- 1 Kafka broker (KRaft, no ZooKeeper) via `docker-compose` is enough — the lab
  is about the *processor*, not the broker. Pin the version.
- Go Kafka client: `twmb/franz-go`. Disable client-side reordering and read the
  payload `event_ts` yourself — Kafka offset order ≠ event-time order.
- Embedded state store: `cockroachdb/pebble` (LSM, RocksDB-shaped, good for the
  changelog story) or `dgraph-io/badger`. Keep a hot in-memory map for active
  windows; treat the KV as the spill + checkpoint tier.
- Make the watermark, window assigner, and state backend **interfaces** so you can
  swap window types and a memory-only vs disk-backed state without rewrites.
- Single-writer per key: shard by `hash(account_id) % N` across N goroutines so
  each key's state is touched by exactly one worker — no per-key locks.
- Instrument with **Prometheus**: ingest rate, watermark value & lag, open-window
  count, dropped-late counter, spill bytes, checkpoint duration, sink emit rate,
  p50/p99/p999 per stage. Profile allocations with `pprof` — window bookkeeping
  is an allocation trap.

## 7. Data model

```
event:  { account_id uint64, value int64, event_ts int64 (ms), seq uint64, pad []byte }

keyed state (in-memory hot tier + pebble/badger cold tier):
  windowKey   = (account_id, window_start, window_end)      // tumbling/sliding
  sessionKey  = (account_id, session_id)                    // session, mergeable
  accumulator = { count uint64, sum int64, min,max int64, last_update_ts int64 }

changelog (append-only, in pebble): seq → (windowKey, accumulator-delta)
checkpoint:  { checkpoint_id, source_offsets[partition]→offset,
               state_snapshot_ptr, watermark, ts }

sink (idempotent):
  results(account_id, window_start, window_end, agg..., PRIMARY KEY(account_id, window_start, window_end))
```
A fired window upserts into `results` keyed by `(account_id, window_start,
window_end)`; re-emitting the same window after recovery is an idempotent no-op.

## 8. Interface contract

- `GET /windows/{account_id}?from=&to=` → fired windows for a key in a time range.
- `GET /watermark` → `{ "watermark_ms": ..., "lag_ms": ..., "dropped_late": N }`.
- `GET /metrics` → Prometheus exposition.
- Engine configured via flags/env: `-window=tumbling|sliding|session`,
  `-size`, `-slide`, `-gap`, `-allowed-skew`, `-allowed-lateness`,
  `-state=mem|disk`, `-mem-budget`, `-checkpoint-interval`, `-shards`.

## 9. Key technical challenges

- **Event time vs processing time.** Offsets arrive in append order; your results
  must be in *event-time* order. The watermark is the only thing that tells you
  "event time has advanced enough to fire this window" — get its semantics wrong
  and you either fire too early (wrong) or never (stalled).
- **The watermark trade-off is the lab.** A tight watermark (small `allowed_skew`)
  fires fast but drops more of the late tail; a loose one is more correct but
  holds windows open longer (more state, more latency). You must *quantify* the
  curve, not pick a number.
- **Session merging.** A late event can fall in the gap between two open sessions
  and must **merge** them — including merging their accumulators and state
  entries. This is the subtle correctness bug factory.
- **State that doesn't fit.** 10M Zipfian keys with overlapping sliding windows
  means millions of live `(key, window)` accumulators. Decide what stays hot, what
  spills to `pebble`, and when expired windows get **garbage-collected** so state
  doesn't grow without bound.
- **Atomic checkpoints.** State snapshot and source offsets must be consistent —
  if you snapshot state at offset X but commit offset Y, recovery double-counts or
  loses events. The changelog + offset must move together.
- **Allocation pressure.** Per-event window assignment, map churn, and accumulator
  boxing generate garbage at billions of events. `pprof` the heap; this is an
  `alloc/op` problem before it's a throughput problem.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Window-type cost.** Same input, same key set: tumbling vs sliding (5m/1m) vs
   session. Measure ingest throughput, p99 per-event latency, open-window count,
   and resident memory. Explain why sliding costs more.
2. **Watermark lag vs correctness.** Sweep `allowed_skew` ∈ {1s, 5s, 30s, 2m} at a
   fixed late-tail profile. Plot **% late events dropped** and **per-window error
   vs ground truth** against fire latency. Find the knee.
3. **Allowed-lateness sweep.** Fix the watermark; sweep `allowed_lateness` ∈ {0,
   10s, 1m, 5m}. Measure recovered-correctness vs extra state held open and extra
   sink re-emits.
4. **State size vs cardinality vs memory.** Run with 100k → 1M → 10M keys. Plot
   resident memory and find where `mem` mode OOMs and `disk` mode must spill.
   Report on-disk state size and spill throughput.
5. **Throughput vs window size.** Tumbling 1s → 1m → 10m. Show how larger windows
   change accumulator count, memory, and fire frequency.
6. **Out-of-order severity.** Sweep the Zipfian delay tail from "tight" (95% < 1s)
   to "wild" (long minutes-late tail). Measure dropped-late rate and result error
   at a fixed watermark — show how reorder severity degrades correctness.
7. **Recovery from checkpoint.** During a 30-min run, `kill -9` the engine. Measure
   time to load the last checkpoint and catch back up to live; prove post-recovery
   results match a clean run, and that the idempotent sink produced no duplicates.
8. **Checkpoint-interval cost.** Sweep checkpoint interval {5s, 30s, 2m}. Trade
   recovery time (smaller = faster recovery) against steady-state overhead
   (snapshot pause + changelog/disk I/O).

## 11. Milestones

1. Compose Kafka up; `cmd/gen` deterministic Zipfian-delayed data with a
   ground-truth batch result; `cmd/source` feeding events.
2. Tumbling windows + watermark + drop-late counter; first correctness diff vs
   ground truth; Prometheus board for rate/watermark-lag/open-windows.
3. Sliding + session windows (incl. session merge); window-type cost run (exp 1).
4. Disk-backed state + changelog; cardinality/memory sweep and spill (exp 4);
   `pprof` the allocation hot path.
5. Checkpoint/recover; `kill -9` chaos proving post-recovery correctness and
   idempotent sink (exp 7); watermark/lateness trade-off curves (exp 2, 3, 6).

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min run at a stated rate with **bounded** memory and **flat**
      open-window count, dashboard screenshot attached.
- [ ] All three window types produce results that **match the deterministic
      ground-truth** when no events are dropped (show the diff).
- [ ] Watermark-lag curve plotted: dropped-late % and per-window error vs fire
      latency, with the chosen operating point justified.
- [ ] State spills to `pebble`/`badger` at 10M keys without OOM; resident memory
      stays under the stated budget; on-disk size reported.
- [ ] After `kill -9` mid-load, the engine recovers from the last checkpoint and
      post-recovery results **match a clean run**, with **zero duplicate** sink
      rows (show the SQL/diff).
- [ ] Recovery time and checkpoint overhead measured and reported.
- [ ] `pprof` heap profile attached; the per-event allocation hot path named and
      reduced, with `alloc/op` before/after.
- [ ] Every number is reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Incremental / RocksDB-style checkpoints:** snapshot only the changelog delta
  since the last checkpoint instead of full state; measure the overhead drop.
- **Watermark per partition** (per Kafka partition) with a global min — handle an
  idle partition that would otherwise stall the global watermark.
- **Late-data side output:** route dropped-late events to a side topic instead of
  counting-and-discarding; reprocess them in a slow path.
- **Two-phase commit sink** to a second system (e.g. Postgres + Kafka) for true
  cross-system exactly-once; quantify the coordinator cost vs idempotent upsert.
- **State TTL & compaction tuning:** tune `pebble` compaction for the changelog and
  measure write amplification of the checkpoint path.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Event-time model | Implements watermarks, windows fire correctly | Explains watermark semantics; handles idle partitions and per-partition watermark min |
| Late-data handling | Drops & counts late events | Quantifies the lag/lateness trade-off; picks an operating point with evidence |
| Window correctness | Tumbling/sliding match ground truth | Session merge is correct under reordering; proves it against the deterministic result |
| State at scale | State works for the key set | Spills to disk at 10M keys with bounded memory; GCs expired windows; reports on-disk cost |
| Recovery | Recovers after a crash | Atomic state+offset checkpoint; proves post-recovery == clean run with an idempotent sink |
| Performance | Reports throughput + p99 | Names the bottleneck; reduces `alloc/op` with pprof evidence |
| Communication | Clear findings note | Could defend every curve (watermark, spill, recovery) to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 11 (stream processing,
  event-time vs processing-time, windows).
- *Streaming Systems* (Akidau, Chernyak, Lax) — watermarks, windowing, the
  "what / where / when / how" model.
- Apache Flink docs: event time, watermarks, allowed lateness, keyed state,
  checkpointing (read for the model, not to copy the impl).
- `twmb/franz-go` consumer docs; `cockroachdb/pebble` / `dgraph-io/badger` docs.
- Go `runtime/pprof` + `pprof -alloc_space` for the allocation hot path.
- See also: `Interview Question/11-messaging-and-event-streaming/`.
