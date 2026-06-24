# Event Replay & Zero-Downtime Reprojection

> The event log is the source of truth; every read model is a *cache* you can
> throw away and recompute. Prove it: rebuild a 100M-aggregate projection from a
> ≥1B-event log, catch it up to the live tail, and cut traffic over to it — while
> the old projection keeps serving and nobody notices.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Event sourcing / read-model rebuilds (CQRS read side) |
| **Skills exercised** | Immutable event logs, idempotent offset-versioned projections, blue/green read-model cutover, catch-up lag convergence, replay backpressure, time-travel queries, Go (`franz-go`, `pgx`) |
| **Interview sections** | 11 (messaging), 12 (architecture), 13 (distributed systems) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the read side of an event-sourced system. The write side appends facts
to an immutable log — `≥ 1B` events and growing — and a **live projection**
folds those events into a Postgres read model (`100M+` aggregates) that serves
the product's queries. It has worked for two years.

Now two things happen, as they always do. First, product wants a new column that
depends on data the projection never stored, so the old read model *cannot* be
migrated in place — it has to be **recomputed from history**. Second, someone
finds a bug in the projection logic from eight months ago, which means every
aggregate touched since then is subtly wrong.

Both problems have the same answer: **replay the log and rebuild the projection
from scratch.** The catch is that "from scratch" means a multi-hour batch job
over a billion events, and the read model it produces must take over from the
live one with **zero downtime** and **provable equivalence** at the switch
point — no missing events, no double-applied events, no queries served from a
half-built table.

This lab is the "we changed the schema / found a bug and must recompute
everything" skill, done at a scale where it actually hurts. You will produce a
rebuild that is fast enough, correct at cutover, and gentle enough on the cluster
that live traffic never feels it.

## 2. Goals / Non-goals

**Goals**
- Rebuild a derived read model (`100M+` aggregates) from a `≥ 1B`-event log
  **from offset 0**, and report the sustained replay throughput and total
  wall-clock time.
- Make projection apply **idempotent and offset-versioned** so a replay can run
  twice, crash mid-way, or overlap the live tail without double-applying.
- Build the new projection version **side-by-side** with the live one and perform
  an **atomic blue/green cutover** with zero downtime.
- Drive **catch-up convergence**: hand off from historical replay to the live
  tail and show lag falling to zero without a gap or an overlap that corrupts.
- **Backpressure the replay** so a full-speed rebuild does not starve live serving
  (shared Kafka, shared Postgres) — isolate the resources and measure the impact.
- Support **time-travel queries**: reconstruct an aggregate's state *as of* a
  given time/offset directly from the log.

**Non-goals**
- The write side / command model. Events already exist; you only consume them.
- Saga / distributed-transaction orchestration — that's `staff/02`. Here the
  projection is a pure left fold over one log.
- Schema-registry mechanics for the events themselves — that's `events/04`. Use a
  fixed, versioned payload and focus on the *projection* rebuild.
- Multi-region replication of the read model — single region.

## 3. Functional requirements

1. An **event log** (`cmd/seed`) holds `≥ 1B` events: either a Kafka **compacted**
   topic keyed by `aggregate_id`, or an append-only event store
   (`events(stream_id, version, ...)` in Postgres). State which and why; the
   choice changes the replay-completeness story (see §9).
2. A **live projector** (`cmd/projector -mode=live`) tails the log and maintains
   the read model continuously, recording the **highest applied offset** (its
   high-water mark) durably alongside the data.
3. A **replay projector** (`cmd/projector -mode=replay`) rebuilds a *named,
   versioned* read model from offset 0 at maximum safe throughput, writing to a
   **separate** target (table/keyspace) from the live one.
4. **Idempotent apply:** applying the same `(partition, offset)` twice is a no-op;
   the projector can be killed and restarted and resumes exactly where it left
   off with no duplicate effect.
5. A **cutover controller** (`cmd/cutover`) flips the read API from the live
   projection to the freshly-built one **atomically**, only after the new one has
   caught up to (or past) the live one's offset.
6. A **time-travel endpoint** reconstructs a single aggregate's state as of an
   arbitrary `T` (or offset) by folding its event history up to that point.
7. A **read API** (`cmd/api`) serves aggregate queries from whichever projection
   is currently "active", with the active version resolved at request time (not
   pinned at process start).

## 4. Load & data profile

- **Volume:** `≥ 1B` events in the log. Single full-replay run reads all of them.
- **Aggregates:** `100M+` distinct `aggregate_id`s, so the rebuilt read model has
  `100M+` rows — comfortably past Postgres's "fits in shared_buffers" comfort zone.
- **Events per aggregate:** skewed — most aggregates have 1–5 events, a long tail
  has thousands (an active account vs. a dormant one). `aggregate_id` popularity
  is **Zipfian** (s≈1.1); this makes per-partition replay work uneven on purpose.
- **Event shape:** small, fixed binary/JSON — e.g. `{ aggregate_id, version,
  type, ts, payload }` ~200–400 B. Projection apply is a cheap fold, so the
  bottleneck is I/O and write batching, not CPU per event.
- **Generator:** `cmd/seed` is deterministic given a seed and emits a *known*
  final state per aggregate, so you can later assert `rebuilt == expected`
  without trusting the live projection.
- **Live tail:** while a replay runs, a producer keeps appending new events at a
  modest rate (e.g. 5–20k events/s) so catch-up has a *moving* target, not a
  frozen log.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Replay throughput (full rebuild, offset 0) | Find & report the ceiling (events/s and MB/s); justify the bound (Postgres write batching? Kafka fetch? single-writer CPU? fsync?) |
| Full-rebuild wall-clock (1B events → 100M rows) | Report it; set a budget (e.g. **< 4 h**) and meet it, or explain what blocks you |
| Cutover downtime (read API) | **Zero** — no failed reads, no 5xx, during the switch |
| Cutover correctness | At the switch offset, **new read model == live read model** for every aggregate (prove it; zero diffs) |
| Idempotency invariant | Replaying overlapping offsets (replay tail overlaps live) yields **identical** state — `apply` twice == `apply` once |
| Catch-up convergence | After replay reaches the historical end, lag to the live tail falls to **0 and stays bounded** (converges, doesn't oscillate) |
| Replay impact on live serving | Live read-API p99 degrades by **< 20%** while a full-speed replay runs concurrently (or isolate so it's ~0) |
| Time-travel query (state as-of T) | Correct reconstructed state; report latency for a 1k-event aggregate |

> The point isn't a magic rebuild time — it's to **find** your replay ceiling,
> **prove** the cutover is exact, and **show** the live path survived the rebuild.

## 6. Architecture constraints & guidance

- Log + read model via `docker-compose`: 3-broker Kafka (KRaft) for the compacted
  topic, **or** a Postgres event store; plus a Postgres read model. Pin versions.
- Go client: `twmb/franz-go` for Kafka; `jackc/pgx` (v5) with `CopyFrom` / batched
  inserts for the read-model writes — naive row-at-a-time `INSERT` will not hit
  your replay budget.
- **Version the read model explicitly.** Either separate tables
  (`accounts_v3` / `accounts_v4`) or a `projection_version` column + a `projections`
  registry row marking which version is `active`. The read API resolves "active"
  per request.
- Store the projector's **high-water mark in the same store as the data**, ideally
  in the *same transaction* as the batch write, so the offset and the data can
  never disagree after a crash.
- Replay and live projectors are **separate processes** so you can throttle, kill,
  and resource-isolate the replay independently of live serving.
- Instrument with Prometheus: replay events/s, apply batch size, write latency,
  per-partition replay progress, live lag, read-API p99 (live vs replay running),
  catch-up lag-to-tail.

## 7. Data model

```
-- Source of truth (Postgres event-store variant)
events(
  global_seq   BIGSERIAL PRIMARY KEY,   -- total order for replay
  aggregate_id BIGINT NOT NULL,
  version      INT    NOT NULL,         -- per-aggregate sequence (optimistic concurrency)
  type         TEXT   NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,
  payload      JSONB  NOT NULL,
  UNIQUE(aggregate_id, version)
)
-- (Kafka variant: compacted topic `events`, key = aggregate_id, offset = position)

-- Read model, versioned and built side-by-side
accounts_v4(aggregate_id PK, balance BIGINT, status TEXT, ... , applied_seq BIGINT)

-- Projector high-water mark, written WITH the batch (one row per (version, partition))
projection_offsets(version TEXT, partition INT, applied_offset BIGINT,
                   PRIMARY KEY(version, partition))

-- Which version the read API serves
projections(version TEXT PRIMARY KEY, state TEXT)   -- state ∈ {building, ready, active, retired}
```

Idempotency rule: a row's `applied_seq`/`applied_offset` advances **monotonically**;
an apply for an offset `≤` the stored one is a no-op. For Kafka, dedup is keyed by
`(partition, offset)`; for the event store, by monotonic `global_seq` per aggregate.

## 8. Interface contract

- `GET /aggregate/{id}` → current state from the **active** projection
  `{ aggregate_id, ..., applied_seq, projection_version }`.
- `GET /aggregate/{id}/as-of?ts=...` (or `?offset=...`) → time-travel: state folded
  from the log up to that point, plus the offset/seq it stopped at.
- `POST /cutover {version}` → promote a `ready` projection to `active` atomically;
  returns the offset at which the swap occurred. Idempotent.
- `GET /projections` → registry: each version, its `state`, build offset, lag.
- `GET /metrics` → Prometheus exposition.
- Projector configured via flags: `-mode={live|replay}`, `-version`, `-from-offset`,
  `-batch`, `-rate-limit` (replay backpressure), `-catch-up`.

## 9. Key technical challenges

- **Idempotent apply at the seam.** A replay must catch up to a *moving* tail. The
  hard part is the handoff: replay stops at offset `X`, live must continue from
  `X` with neither a gap (lost events) nor a re-apply that breaks a non-idempotent
  fold. Offset-versioned apply is what makes the overlap safe — design it so a
  10k-offset overlap is provably a no-op.
- **Atomic cutover without a torn read.** Flipping `active` mid-build, or while a
  request reads, must never expose a half-populated table. Decide your switch:
  a single registry-row UPDATE in a transaction, a view repoint, or a table
  rename — and argue why it's atomic for concurrent readers.
- **Catch-up convergence.** If replay throughput ≤ live ingest rate, you never
  converge. You must replay *faster* than new events arrive; quantify the margin
  and the convergence time from a 1B-event backlog.
- **Backpressure / resource isolation.** A full-speed replay and live serving
  share Kafka fetch bandwidth and the Postgres write path. Without throttling, the
  rebuild starves live queries (lock contention, WAL pressure, cache eviction).
  Isolate it — separate connection pool, rate limit, off-peak, or a replica.
- **Compaction vs. completeness.** If the log is a **compacted** Kafka topic, only
  the *latest* value per key survives — you can rebuild *current* state but you
  **cannot** time-travel or reconstruct history. An uncompacted/event-store log
  keeps every fact. This trade-off is central; state it explicitly.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Replay throughput vs. write batching.** Sweep projection write batch size
   (1 / 100 / 1k / 10k rows per `CopyFrom`/txn). Plot replay events/s and total
   rebuild time. Find the knee where batching stops helping (WAL/fsync bound).
2. **Cutover correctness proof.** Build `v4` to a frozen offset `X`; freeze the
   live `v3` at the same `X`; `diff` every aggregate. Acceptance = **zero rows
   differ**. Show the SQL (`EXCEPT` / checksum-by-aggregate) that proves it.
3. **Replay impact on live serving.** Measure live read-API p50/p99 with no replay,
   then during a full-speed replay. Quantify the degradation. Then add backpressure
   (rate limit / separate pool / replica) and re-measure — show you bought the
   isolation back.
4. **Catch-up convergence from a 1B backlog.** Start replay from 0 with live
   ingest running at a fixed rate. Plot lag-to-tail over time; report the
   convergence time and the throughput margin (replay rate − ingest rate) that
   makes it converge. Then push ingest up until it **doesn't** converge — find the
   crossover.
5. **Idempotency / overlap stress.** Run replay so its tail overlaps the live
   range by 10k+ offsets; kill the replay projector mid-batch and restart it.
   Prove the final state equals a clean single-pass replay (no double-apply, no
   gap).
6. **Partial replay / single-aggregate repair.** Without a full rebuild, repair
   *one* corrupted aggregate by re-folding only its event stream. Measure the cost
   and prove the rest of the read model is untouched.
7. **Compaction effect on completeness.** On the compacted-topic variant, run a
   replay after compaction has collapsed history; show that time-travel queries
   are now impossible and current-state is still correct. Contrast with the
   event-store variant where both work.

## 11. Milestones

1. Compose up; `cmd/seed` produces a deterministic 1B-event log with known final
   state; live projector building the `v3` read model; Prometheus + Grafana board
   (replay rate, lag-to-tail, read-API p99).
2. Replay projector with offset-versioned idempotent apply; first full-rebuild run
   from offset 0; write down the throughput ceiling and its bound (experiment 1).
3. Catch-up handoff: replay converges to the live tail with no gap/overlap
   corruption (experiments 4, 5).
4. Blue/green cutover controller; prove `new == live` at the switch offset with
   zero downtime (experiment 2).
5. Backpressure + time-travel + partial repair (experiments 3, 6, 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Full rebuild of a `≥ 1B`-event log into a `100M+`-row read model, with the
      **wall-clock time and replay throughput ceiling reported and the bottleneck
      named and proven** (pprof / `pg_stat`/`iostat` evidence).
- [ ] Replay write-batching curve plotted; knee identified.
- [ ] **Zero-downtime cutover:** no failed reads during the switch (load-driver
      log attached), and at the switch offset `new == live` for **every** aggregate
      (show the `EXCEPT`/checksum diff = 0 rows).
- [ ] **Idempotency proven:** replay tail overlapping the live range, plus a
      mid-batch kill/restart, yields state identical to a clean single pass.
- [ ] **Catch-up convergence** from a 1B backlog plotted; convergence time and the
      throughput margin that achieves it reported; the non-convergence crossover
      found.
- [ ] Live read-API p99 during a concurrent full-speed replay reported, before and
      after backpressure/isolation.
- [ ] Time-travel query returns correct as-of-`T` state; single-aggregate repair
      demonstrated without a full rebuild.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Parallel replay** across partitions/shards with per-partition high-water marks
  and a barrier before cutover; measure the speedup vs. single-writer and the new
  bottleneck.
- **Snapshotting:** periodically materialize aggregate snapshots so a replay can
  start from the latest snapshot instead of offset 0; measure rebuild-time savings
  vs. snapshot storage cost and staleness.
- **Online reprojection:** keep the live projection serving while the new version
  builds *and* tails live writes, so cutover is a lag-0 hot swap rather than a
  freeze-and-diff.
- **Replay to a different store** (Postgres → Redis or ClickHouse read model) from
  the same log; show the log is the single source of truth, projections are
  disposable.
- **Schema-migration as reprojection:** treat an additive read-model schema change
  as a new projection version built by replay, never an in-place `ALTER`.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Replay throughput | Rebuilds the log; reports a rate | Names and **proves** the bound; tunes batching to a stated budget and knows the next bottleneck |
| Idempotent apply | Apply is idempotent in the happy path | Overlap + crash mid-batch still converges to the exact single-pass state; explains *why* it's safe |
| Cutover | Switches versions without a long outage | **Atomic, zero-downtime** swap proven exact (`new == live`) with a torn-read argument |
| Catch-up convergence | Gets the new model "close" to live | Quantifies convergence time and the throughput margin; finds the non-convergence crossover |
| Backpressure / isolation | Notices replay hurts live serving | Isolates resources and measures the recovered live p99 |
| Time-travel / completeness | Can fold one aggregate as-of T | Articulates the compaction-vs-history trade-off and designs the log accordingly |
| Communication | Clear findings note | Could defend every curve and the cutover-correctness proof to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 11 (stream processing; "deriving
  current state from an event log", reprocessing & dual-write-free schema change).
- Martin Fowler — *Event Sourcing*, *CQRS*, and *Retroactive Event* notes.
- Confluent — log compaction semantics; Kafka consumer offset & seek APIs.
- `twmb/franz-go` (seek/replay from offset 0) and `jackc/pgx` `CopyFrom` batching.
- Sibling project: [`staff/02-event-sourced-cqrs-saga`](../../staff/02-event-sourced-cqrs-saga/)
  — the write side, sagas, and outbox that *produce* the log this lab replays.
- See also: `Interview Question/11-messaging-and-event-streaming/` for the matching
  theory (event sourcing, projections, idempotency, exactly-once).
