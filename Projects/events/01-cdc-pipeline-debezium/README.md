# Change-Data-Capture Pipeline (Postgres WAL → Kafka)

> Tail the Postgres write-ahead log and turn every committed row change into an
> ordered Kafka event — through a ≥100M-row initial snapshot and a 20–50k
> changes/s write storm. Then prove it: no loss, no out-of-order per key, and a
> replication slot that never silently eats your disk. Finally, build the same
> thing with a transactional Outbox and explain which one you'd ship.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | CDC / data integration |
| **Skills exercised** | Postgres logical replication (WAL, `pgoutput`/`wal2json`), replication slots & WAL retention, Debezium / Kafka Connect, snapshot↔stream cutover, per-key ordering, idempotent downstream, transactional Outbox, Go (`twmb/franz-go` consumer), Prometheus |
| **Interview sections** | 5 (Postgres & SQL), 11 (messaging), 13 (distributed systems) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You run the platform team at a company whose system of record is a single large
Postgres database. Three new consumers want the data *as it changes*: a search
indexer, an analytics warehouse loader, and a cache invalidator. Today they all
poll `WHERE updated_at > ?` on a hot table — and that polling is both slow and
lossy (it misses deletes, it double-reads under clock skew, and it hammers the
primary).

You're going to replace polling with **Change Data Capture**: read committed row
changes straight from the Postgres WAL via logical replication and stream them to
Kafka with Debezium, so every `INSERT`/`UPDATE`/`DELETE` becomes an ordered
event keyed by primary key. The catch is that the source table already has
**≥100M rows** (so you must snapshot it before you can stream), the application
writes **20–50k changes/s** (so the connector can fall behind and a slow consumer
can grow the WAL until the disk fills), and the schema changes under you
(`ALTER TABLE` mid-stream).

Then you'll build the **transactional Outbox** alternative and compare them
head-to-head. The deliverable is not "CDC works" — it's a findings note that
states, with numbers, when CDC beats Outbox and when it doesn't, and a proof that
your pipeline loses nothing and reorders nothing under failure.

## 2. Goals / Non-goals

**Goals**
- Stand up logical replication on Postgres and a Debezium Postgres connector on
  Kafka Connect that snapshots a ≥100M-row table and then streams live changes
  to per-table Kafka topics.
- Characterize **CDC lag** (commit-in-Postgres → event-in-Kafka) as a function of
  write rate, and find the rate at which the connector can no longer keep up.
- Make the danger of an **unconsumed replication slot** concrete: stall the
  pipeline and watch `pg_wal` grow toward the disk limit; show the guardrails.
- Build a downstream Go consumer that applies changes **idempotently** so that
  Debezium's *at-least-once* delivery yields an *exactly-once effect* in the sink,
  and prove it through connector restarts mid-snapshot and mid-stream.
- Implement the **transactional Outbox** pattern and compare it to log-based CDC
  on latency, coupling, ordering, and operational cost.

**Non-goals**
- A managed CDC service (Confluent Cloud, AWS DMS, Striim). Run Debezium +
  Kafka Connect yourself so you see the slot, the offsets, and the snapshot knobs.
- Multi-table foreign-key-consistent CDC into a transactional sink (that's the
  CQRS/Saga staff lab). Here, per-key ordering per table is the contract.
- Schema *registry* ergonomics (Avro/Protobuf compatibility rules) — covered in
  `events/04`. Use JSON or a fixed Avro schema; focus on the WAL→Kafka mechanics.
- Bi-directional / multi-master replication. Source is a single Postgres primary.

## 3. Functional requirements

1. A **source loader** (`cmd/seed`) populates `public.accounts` (or similar) with
   **≥100M rows**, including some **wide rows** (a `payload` column ≥ 4 KB that
   crosses the TOAST threshold) so you exercise TOAST behavior.
2. A **write generator** (`cmd/churn`) applies a configurable mix of
   `INSERT`/`UPDATE`/`DELETE` at a target rate (default 20k/s, sustainable to
   50k/s) with a Zipfian key distribution, deterministic given a seed.
3. **Logical replication** is configured (`wal_level=logical`), a replication slot
   and publication exist, and a **Debezium Postgres connector** (plugin
   `pgoutput`, with a `wal2json` variant tried for comparison) snapshots the table
   then streams CDC events to topic `cdc.public.accounts`, keyed by primary key.
4. A **sink consumer** (`cmd/sink`, `twmb/franz-go`) consumes the CDC topic and
   maintains a downstream replica (a second Postgres schema or a Redis hash),
   applying each change **idempotently** — a re-delivered event must not corrupt
   state. Deletes (Debezium tombstones, `null`-value records) remove the key.
5. The connector and sink survive restarts: on restart they **resume from offsets
   / LSN**, not from zero, and never re-snapshot unless told to.
6. A **chaos hook** (`cmd/chaos`) can: stall the sink (to grow the slot), kill the
   Connect worker mid-snapshot, kill it mid-stream, and issue an `ALTER TABLE`
   while changes are flowing.
7. An **Outbox variant** (`cmd/outbox-*`): the app writes business rows and an
   `outbox` row in the **same transaction**; a relay publishes outbox rows to
   Kafka and marks them sent. Same downstream sink consumes them.

## 4. Load & data profile

- **Initial snapshot:** source table **≥ 100M rows**, ≥ 40 GB on disk including
  TOAST. Report snapshot wall-clock and the lock/consistency mode used.
- **Wide rows:** ~10% of rows carry a `payload` ≥ 4 KB (forces out-of-line TOAST
  storage). Measure how an `UPDATE` that *doesn't* touch the TOAST column emits
  CDC — `REPLICA IDENTITY` and unchanged-toast handling matter here.
- **Write rate:** sustained **20k changes/s**, with a stress run to **50k/s**.
  Mix ≈ 70% UPDATE / 20% INSERT / 10% DELETE. Open-model generator (fixed commit
  rate, *not* "as fast as Debezium drains") so lag can build and be observed.
- **Key distribution:** primary key access is **Zipfian (s≈1.1)** so some keys are
  hot — this stresses per-key ordering and compaction, not just raw volume.
- **Run length:** a steady-state streaming run of **≥ 30 minutes** at target rate,
  plus a separate full-snapshot run timed end to end.
- **Schema change:** at least one `ALTER TABLE ... ADD COLUMN` (nullable, fast)
  and one wider change (`ALTER TYPE` / add `NOT NULL` with default) applied
  mid-stream; record what the connector emits and whether the sink survives.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Steady-state CDC lag (commit→Kafka) at 20k/s, below ceiling | p99 **< 2 s**, bounded and **flat** (not monotonically rising) |
| Connector throughput ceiling | Find & report changes/s the connector sustains; name the bound (snapshot chunking? single-slot decode? Connect task? sink) |
| Initial-snapshot duration (≥100M rows) | Reported with method; streaming must resume from the **consistent point**, zero gap, zero overlap |
| Per-key ordering | For every primary key, sink applies changes in **commit order**; prove with a monotonic per-key version check |
| Delivery / idempotency | Debezium is at-least-once; sink effect is **exactly-once**: after replay/restart, downstream replica == source for sampled keys, **zero corruption** |
| Replication-slot safety | `pg_wal` bounded by `max_slot_wal_keep_size`; an indefinitely stalled slot must **not** fill the disk — alert fires first |
| Restart recovery | After killing Connect mid-snapshot **and** mid-stream, pipeline resumes with **no loss and no duplicate-induced corruption** |
| Schema-change handling | `ALTER TABLE ADD COLUMN` mid-stream causes **no pipeline halt** and no lost changes; new field appears in events after the DDL |

> The point is not a magic lag number — it's to **find** your connector's
> sustainable rate, **explain** what bounds it, and **prove** the correctness
> invariants survive failure.

## 6. Architecture constraints & guidance

- Bring up Postgres (≥ 15), Kafka (KRaft, pinned version), and **Kafka Connect +
  Debezium** via `docker-compose`. Pin every version in your findings.
- Postgres must run with `wal_level=logical`. Use the **`pgoutput`** plugin
  (in-tree, no extension) as the baseline; optionally compare **`wal2json`**.
- Set **`max_slot_wal_keep_size`** so a stalled slot is capped — then *demonstrate*
  what happens when it caps (slot invalidated, source protected) vs when it's
  unset (disk fills). This trade-off is the heart of the lab.
- Choose **`REPLICA IDENTITY`** deliberately: `DEFAULT` (PK only in `before`),
  `FULL` (whole old row — bigger WAL, but UPDATE/DELETE carry full `before`).
  Measure the WAL-size and event-size cost of `FULL`.
- Snapshot mode: try Debezium `initial` (snapshot then stream) and reason about
  `incremental` snapshots (signal-table driven, chunked, resumable). State which
  you chose and why for a 100M-row table.
- Sink consumer in Go with **`twmb/franz-go`**. Apply changes inside a DB
  transaction guarded by a dedup key (`(source_lsn)` or `(table, pk, source_ts)`)
  so re-delivery is a no-op. Keep one consumer per partition to preserve per-key
  order; **never** parallelize within a key.
- Topic for the table should be **log-compacted** if the sink is a "latest state"
  replica (keyed by PK, tombstones delete) — note the interaction between
  compaction and replayability.
- Instrument with **Prometheus**: connector lag (`debezium_metrics_MilliSecondsBehindSource`),
  Kafka consumer-group lag, snapshot rows remaining, slot retained bytes
  (`pg_replication_slots.wal_status` / `pg_current_wal_lsn() - restart_lsn`),
  sink apply rate, dedup-hit rate, p50/p99/p999 commit→apply.

## 7. Data model

```
source: public.accounts
  account_id  BIGINT PRIMARY KEY
  balance     BIGINT
  status      TEXT
  payload     TEXT          -- ~10% ≥ 4 KB → TOAST out-of-line
  version     BIGINT        -- bumped on every UPDATE; used to prove per-key order
  updated_at  TIMESTAMPTZ
  -- REPLICA IDENTITY {DEFAULT | FULL} chosen & justified

Debezium CDC envelope (per change):
  { op: c|u|d|r, before, after, source:{ lsn, txId, ts_ms, table }, ts_ms }
  key   = { account_id }                 -- guarantees per-key partition routing
  value = null                           -- tombstone, emitted after a delete

sink replica (idempotent apply):
  replica.accounts(account_id PK, balance, status, payload, version, src_lsn)
  -- apply rule: UPSERT only if incoming source.lsn > stored src_lsn
  -- delete:     remove row on tombstone / op=d
  applied_lsn(slot TEXT PK, last_lsn BIGINT)   -- optional progress ledger

outbox variant:
  outbox(id BIGSERIAL PK, aggregate_id BIGINT, payload JSONB,
         created_at, published_at NULL)        -- written in the business txn
```

`source.lsn` (or the Debezium `(lsn, txId)` pair) is the ordering and dedup
authority end to end: it is monotonic per key, lets the sink discard stale or
re-delivered changes, and is the only number that proves no loss/no reorder.

## 8. Interface contract

- **Connector:** Debezium Postgres connector config (JSON) checked in —
  `slot.name`, `publication.name`, `plugin.name`, `snapshot.mode`,
  `table.include.list`, `tombstones.on.delete`, key/value converters.
- **Kafka topic:** `cdc.public.accounts`, keyed by `account_id`, partitioned so a
  key always lands on one partition. Tombstone = `null` value after delete.
- **Sink:** `cmd/sink` flags — `-topic`, `-group`, `-dedup-key`, `-apply-batch`,
  `-stall` (to simulate a slow consumer for the slot-growth experiment).
- `GET /replica/{account_id}` → `{ account_id, balance, version, src_lsn }` for
  source-vs-sink diffing.
- `GET /metrics` → Prometheus exposition (lag, slot bytes, dedup hits, apply p99).
- **Outbox relay:** `cmd/outbox-relay` flags — `-batch`, `-poll`, and a
  publish-then-mark loop you can also drive via logical decoding of the outbox
  table (note both relay strategies).

## 9. Key technical challenges

- **Snapshot↔streaming cutover with zero gap and zero overlap.** Debezium reads a
  consistent snapshot at an LSN, then streams from exactly that LSN. If your
  understanding of the boundary is wrong you'll either drop changes that landed
  during the snapshot or double-apply them. Prove the seam is clean.
- **The replication slot is a loaded gun.** An unconsumed (or slow) slot pins
  `restart_lsn`, so Postgres cannot recycle WAL — `pg_wal` grows until the disk
  fills and the *primary goes down*. You must show the failure *and* the guardrail
  (`max_slot_wal_keep_size`, monitoring, alerting before the disk dies).
- **At-least-once → exactly-once effect.** Debezium can re-deliver after a Connect
  crash or rebalance. Correctness lives entirely in the sink: idempotent UPSERT
  guarded by `src_lsn` monotonicity, deletes via tombstones, all in one DB txn.
- **Per-key ordering under a hot Zipfian key.** Ordering is only guaranteed within
  a partition; a hot key concentrates load on one partition/consumer and can
  become the straggler. You must not "fix" lag by reordering within a key.
- **TOAST & `REPLICA IDENTITY`.** An UPDATE that doesn't change a TOASTed column
  emits an *unchanged-toast* placeholder, not the value; `REPLICA IDENTITY
  DEFAULT` gives you only the PK in `before`. Naive sinks corrupt wide rows here.
- **Schema change mid-stream.** `ALTER TABLE` flows through the WAL; the connector
  must keep going and emit the new shape. With a registry-less JSON pipeline,
  prove the sink tolerates added fields and doesn't halt the connector.
- **Outbox vs CDC trade-off, defended.** Outbox gives you app-controlled payloads
  and no logical-replication ops burden, at the cost of a dual-write-in-one-txn
  discipline, a polling/decoding relay, and table bloat. Quantify, don't hand-wave.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and a one-paragraph "why" for each:

1. **CDC lag vs write rate.** Sweep churn rate 5k → 20k → 35k → 50k/s. Plot
   commit→Kafka p99 lag. Find the rate where lag stops being flat and starts
   climbing — that's the connector ceiling. Name what bounds it.
2. **Stall the consumer → slot/WAL growth.** Pause the sink (or the Connect task)
   with churn running. Watch `restart_lsn` freeze and slot-retained bytes / `pg_wal`
   climb. Run it twice: with `max_slot_wal_keep_size` **unset** (disk heads toward
   full) and **set** (slot invalidated, primary protected). Report the alert lead time.
3. **Snapshot duration vs table size.** Snapshot at 10M, 50M, 100M rows. Plot
   wall-clock and rows/s. Compare `initial` vs `incremental` snapshot, and the
   effect of snapshot chunk size and parallelism on lock/contention on the source.
4. **`REPLICA IDENTITY` & TOAST cost.** `DEFAULT` vs `FULL`: measure WAL bytes/s
   and CDC event size at 20k/s. Then UPDATE a non-TOAST column on wide rows and
   verify the sink reconstructs the row correctly (no clobbered `payload`).
5. **Schema change mid-stream.** Apply `ALTER TABLE ADD COLUMN` and a heavier
   change while streaming. Confirm zero connector halt, zero lost changes, and
   that post-DDL events carry the new field. Note any error and how you'd handle it.
6. **Failover correctness.** During a 30-min run: (a) kill the Connect worker
   mid-snapshot; (b) kill it mid-stream; (c) trigger a consumer-group rebalance.
   After each, prove `replica == source` for a sample of keys and that per-key
   `version`/`src_lsn` is monotonic — no loss, no corruption from re-delivery.
7. **Outbox vs CDC bake-off.** Same workload through the Outbox relay. Compare:
   end-to-end p99 latency, source write amplification, ordering guarantees, ops
   surface (slot management vs outbox table bloat/cleanup), and coupling (who owns
   the event shape). Produce a recommendation table.
8. **Compaction & replay.** With a log-compacted topic, kill and rebuild the sink
   from the topic. Show that a fresh consumer reaches correct latest state, and
   reason about what compaction *destroys* for full-history replay.

## 11. Milestones

1. Compose up: Postgres (logical), Kafka, Connect+Debezium; `cmd/seed` to 100M
   rows; Prometheus + a Grafana board for lag / slot bytes / apply rate.
2. Connector snapshots + streams to `cdc.public.accounts`; `cmd/sink` applies
   idempotently; first source-vs-sink diff is clean at low rate.
3. Lag-vs-rate sweep and snapshot-duration runs (experiments 1, 3); ceiling named.
4. Slot-growth experiment with and without the cap (experiment 2); guardrail proven.
5. `REPLICA IDENTITY`/TOAST and schema-change runs (experiments 4, 5).
6. Chaos/failover correctness run (experiment 6); diff proof committed.
7. Outbox variant + bake-off (experiments 7, 8); findings note with recommendation.

## 12. Acceptance criteria (definition of done)

- [ ] ≥ 30-min steady-state run at ≥ 20k changes/s with **flat** CDC lag;
      dashboard screenshot attached, lag p99 number stated.
- [ ] Initial-snapshot duration for ≥ 100M rows reported, with the snapshot mode
      and consistency boundary explained; streaming resumes with **no gap, no overlap**
      (show the LSN seam).
- [ ] Connector throughput ceiling reported **with the bottleneck named and
      evidenced** (decode? Connect task? sink apply? slot single-threading?).
- [ ] Slot-safety experiment shown both ways: uncapped slot grows `pg_wal` toward
      the limit, and `max_slot_wal_keep_size` caps it before the disk dies, with the
      alert firing first. Both timelines committed.
- [ ] After killing Connect **mid-snapshot and mid-stream** plus a rebalance,
      `replica == source` for sampled keys with **zero corruption**; per-key
      `version`/`src_lsn` proven monotonic (show the SQL/diff).
- [ ] TOAST/`REPLICA IDENTITY` behavior demonstrated: an UPDATE not touching the
      TOASTed column does **not** clobber `payload` in the sink.
- [ ] `ALTER TABLE` mid-stream handled with no connector halt and no lost changes.
- [ ] Outbox-vs-CDC comparison table with **defended numbers** (latency, write
      amplification, ordering, ops cost, coupling) and a stated recommendation.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Incremental snapshot under load:** trigger Debezium's signal-table-driven
  incremental snapshot of a new table *while* streaming continues; measure the
  impact on lag and prove no interleaving errors.
- **Multi-table transaction grouping:** enable Debezium transaction metadata and
  show how a downstream could reconstruct source-transaction boundaries.
- **Heterogeneous sink:** add a second sink (Redis or Elasticsearch) on the same
  topic; show fan-out with independent offsets and zero impact on the SQL sink.
- **Outbox via logical decoding:** publish the outbox table *itself* through CDC
  instead of polling — collapsing both patterns into one — and discuss the trade.
- **Slot-failover drill:** promote a Postgres replica and show what happens to the
  logical slot (it doesn't follow by default); design the recovery.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Snapshot/stream cutover | Snapshots then streams without obvious gaps | Explains and **proves** the LSN seam; knows `initial` vs `incremental` trade-offs at 100M rows |
| CDC lag analysis | Reports a lag number at a rate | Names and **proves** the connector ceiling; knows the next bottleneck |
| Slot / WAL safety | Knows an unconsumed slot retains WAL | Demonstrates disk-fill risk *and* the cap, with monitoring + alert lead time |
| Delivery correctness | Idempotent apply in the happy path | Exactly-once *effect* survives mid-snapshot + mid-stream kills + rebalance; explains *why* it's correct |
| Ordering | Knows ordering is per-partition/key | Handles hot-key skew without breaking per-key order; proves monotonicity |
| TOAST / replica identity | Aware deletes/updates carry `before` | Picks `REPLICA IDENTITY` with measured cost; sink never clobbers wide rows |
| CDC vs Outbox judgment | Builds both, lists pros/cons | Recommends one per context with quantified latency/ops/coupling evidence |
| Communication | Clear findings note | Could defend every lag curve and the slot timeline to a staff panel |

## 15. References

- Postgres docs: logical replication, replication slots, `wal_level=logical`,
  `REPLICA IDENTITY`, `max_slot_wal_keep_size`, TOAST storage.
- Debezium docs: Postgres connector, snapshot modes (`initial`/`incremental` +
  signaling), `pgoutput` vs `wal2json`, tombstones, transaction metadata.
- Kafka Connect: offsets, task restarts, converters, log compaction.
- *Designing Data-Intensive Applications* — Ch. 11 (change data capture &
  derived data); Ch. 5 (replication, leaders & logs).
- Microservices outbox / dual-write problem write-ups (transactional outbox,
  polling-publisher vs log-tailing relay).
- `twmb/franz-go` consumer-group example.
- See also: `Interview Question/11-messaging-and-event-streaming/` and
  `Interview Question/05-postgresql-and-sql/`.
