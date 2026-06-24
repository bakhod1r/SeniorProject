# Database Bake-Off: Analytics Under Load

> Run the *same* analytical workload over the *same* billion-row dataset on
> Postgres, ClickHouse, and MongoDB. Tune each one fairly, measure ingest,
> footprint, and per-query latency, then deliver a **selection matrix** — "use X
> when…" backed by numbers, not a benchmark beauty contest.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Database selection / OLAP vs OLTP vs document |
| **Skills exercised** | Row-store vs columnar vs document trade-offs, indexing & materialized views, bulk ingest, query tuning, storage/compression analysis, Go (`pgx`, `clickhouse-go`, `mongo-go-driver`) |
| **Interview sections** | 23 (database types & selection), 5 (Postgres), 6 (MongoDB) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You're the engineer asked to settle a recurring argument. The product is an
analytics surface over an events table: dashboards with filtered aggregations,
group-bys, top-N lists, and time-bucketed rollups, over a dataset that grows by
hundreds of millions of rows a month. Three camps exist on the team: "Postgres
already runs everything, just add indexes," "we need ClickHouse, it'll be 100×
faster," and "we're document-shaped, Mongo's aggregation pipeline is fine."

Everyone has an opinion and nobody has numbers. Your job is to load **one
identical dataset** into all three engines, tune each one *reasonably*, run an
**identical** set of analytical queries, and produce a defensible selection
matrix that says which engine wins for which workload shape — and at what cost in
storage, ingest, and operational complexity. You will produce numbers, and you
will explain them. This lab mirrors the methodology of
`events/06-broker-bake-off`: matched workload, fair tuning, decision matrix at
the end.

## 2. Goals / Non-goals

**Goals**
- Load the **same** ≥ 1B-row dataset into Postgres, ClickHouse, and MongoDB and
  report **ingest rate** and **on-disk footprint** for each.
- Run an **identical** query suite (filtered aggregation, group-by, top-N,
  time-bucketed rollup, point lookup, a transactional update) and report
  **p50/p99 per query class per engine**.
- Quantify the cost of the *right* accelerator per engine — a Postgres index or
  `MATERIALIZED VIEW`, a ClickHouse `ORDER BY` key / projection, a Mongo
  compound index — in build time, storage, and ingest penalty.
- Measure **concurrent-query** behavior: how each engine degrades from 1 → 64
  simultaneous analytical clients.
- Deliver a **selection matrix** mapping workload shapes to the right engine,
  with the reasoning a staff panel would accept.

**Non-goals**
- A "which database is fastest" headline. Different engines win different
  queries; the deliverable is the *mapping*, not a single winner.
- Distributed/sharded deployments. Single-node each (one ClickHouse server, one
  Postgres, one `mongod`), so you compare engines, not cluster topologies.
- Managed services (RDS / ClickHouse Cloud / Atlas). Run them yourself so you see
  and tune the knobs.
- Exotic workloads (vector search, full-text, geo). Stay on the analytical core.

## 3. Functional requirements

1. A **data generator** (`cmd/gen`) emits the canonical dataset deterministically
   from a seed, in a format each loader can consume (e.g. CSV/Parquet for bulk
   paths, plus a JSON projection for Mongo).
2. Three **loaders** — `cmd/load-pg`, `cmd/load-ch`, `cmd/load-mongo` — each using
   the engine's *fast* ingest path (Postgres `COPY` via `pgx.CopyFrom`,
   ClickHouse native batch insert via `clickhouse-go`, Mongo unordered
   `InsertMany` / bulk write via `mongo-go-driver`). No row-at-a-time inserts.
3. A **query harness** (`cmd/bench`) runs the identical query suite against any
   engine selected by flag, at a configurable concurrency, and records
   p50/p99/p999 and rows scanned/returned per query.
4. Each engine has a **tuned** and an **untuned** profile (see §10) so the cost of
   the accelerator is isolated, not assumed.
5. A small **transactional workload** (`cmd/txn`) exercises point lookups and
   single-row updates to expose where Postgres wins.

## 4. Load & data profile

- **Volume:** **≥ 1 billion rows** (≥ 500M documents for Mongo if you model
  one-doc-per-event) of a single fact table — call it `events`. Generated once,
  loaded identically into all three.
- **Schema (logical):**
  `event_id`, `user_id` (≈ 50M distinct), `country` (≈ 200 values),
  `event_type` (≈ 30 values), `device` (≈ 10 values), `amount` (decimal),
  `ts` (over a 24-month window), plus a `props` blob (≈ 200 B) to make rows
  realistically wide (~250–300 B/row raw).
- **Distributions:** `user_id` is **Zipfian** (s ≈ 1.1) so top-N and group-by are
  skewed; `ts` is roughly uniform over the window with daily seasonality;
  `country`/`event_type` are categorical with realistic frequency skew. This is
  deliberate — uniform random data flatters columnar engines and hides skew.
- **Determinism:** `cmd/gen` is reproducible from `-seed`; the *same* logical rows
  land in all three engines so query results are byte-comparable.
- **Generate once, load three times.** Materialize the dataset to disk so the
  generator cost is not charged to any single engine's ingest number.

## 5. Non-functional requirements / SLOs (the measurement table)

The deliverable is this table, **filled with your measured numbers** for each
engine, untuned and tuned:

| Metric | Postgres | ClickHouse | MongoDB |
|--------|----------|------------|---------|
| Bulk ingest rate (rows/s, fast path) | _measure_ | _measure_ | _measure_ |
| Wall-clock to load full dataset | _measure_ | _measure_ | _measure_ |
| On-disk footprint (compressed) | _measure_ | _measure_ | _measure_ |
| Compression ratio vs raw | _measure_ | _measure_ | _measure_ |
| Q1 filtered aggregation `SUM(amount) WHERE country=? AND ts∈range` (p50/p99) | | | |
| Q2 group-by `GROUP BY event_type` over full table (p50/p99) | | | |
| Q3 top-N `top 20 user_id BY SUM(amount)` (p50/p99) | | | |
| Q4 time-bucket rollup `count/sum BY day over 24mo` (p50/p99) | | | |
| Q5 point lookup `WHERE event_id = ?` (p50/p99) | | | |
| Q6 transactional update single row (p50/p99) | | | |
| Concurrency: Q1 p99 at 64 concurrent clients | | | |
| Accelerator build time (index / projection / MV) | | | |
| Accelerator storage overhead | | | |
| Ingest penalty with accelerator present | | | |

> The point is not to crown one engine. It's to make this table **true** for your
> hardware and **explain** every row — especially the ones where the "obvious"
> winner loses.

## 6. Architecture constraints & guidance

- One node per engine via `docker-compose`, **versions pinned**: Postgres 16,
  ClickHouse (recent stable), MongoDB 7. Identical CPU/RAM/disk limits per
  container so the comparison is fair — state the limits.
- **Tune each engine reasonably and write down how.** Fairness is the whole game:
  - **Postgres:** `shared_buffers`, `work_mem`, `max_parallel_workers_per_gather`,
    BRIN on `ts` for the time-bucket query, btree where point lookups need it,
    consider a `MATERIALIZED VIEW` or rollup table for Q4. Note: this is OLTP
    machinery doing OLAP work — that's the point.
  - **ClickHouse:** `MergeTree` with a deliberate `ORDER BY` (sorting) key, sane
    `PARTITION BY` (e.g. by month), `LowCardinality` for `country`/`event_type`,
    a projection or materialized view for the rollup. Don't sabotage it with a
    bad sort key — and don't sabotage Postgres by withholding an index it
    deserves.
  - **MongoDB:** WiredTiger with `zstd` block compression, compound indexes
    aligned to the aggregation pipeline, `$match` early, allow disk use for large
    `$group`. Model the document honestly (one doc per event).
- Go clients: `jackc/pgx/v5` (use `CopyFrom`), `ClickHouse/clickhouse-go/v2`
  (native batch), `mongodb/mongo-go-driver` (bulk/unordered writes). No ORMs in
  the hot path — you're measuring the engine, not a query builder.
- Instrument with Prometheus + a Grafana board: per-query latency histograms,
  rows scanned, CPU, disk read bytes, and concurrent in-flight queries.

## 7. Data model

Same logical fact, three physical shapes:

```
Postgres (row store):
  events(event_id BIGINT PK, user_id BIGINT, country TEXT, event_type TEXT,
         device TEXT, amount NUMERIC(12,2), ts TIMESTAMPTZ, props JSONB)
  -- accelerators: BRIN(ts), btree(event_id), optional rollup MV by (day,event_type)

ClickHouse (columnar):
  events ENGINE = MergeTree
    PARTITION BY toYYYYMM(ts)
    ORDER BY (country, event_type, ts)        -- sorting key drives scan pruning
    -- country/event_type/device as LowCardinality(String)
    -- optional PROJECTION or MATERIALIZED VIEW for the daily rollup

MongoDB (document):
  events { _id, user_id, country, event_type, device, amount, ts, props {...} }
    -- compound indexes aligned to pipeline, e.g. {country:1, ts:1}
    -- aggregation pipeline: $match → $group → $sort → $limit
```

The accelerators are the experiment in §10, not a given — measure each one's cost.

## 8. Interface contract

- `cmd/bench -engine={pg|ch|mongo} -query={q1..q6} -concurrency=N -runs=M` →
  emits p50/p99/p999, rows scanned, rows returned, and verifies the result hash
  matches across engines.
- `cmd/load-* -src=<dataset> -profile={untuned|tuned}` → loads and reports
  rows/s and final footprint.
- `GET /metrics` → Prometheus exposition for the running harness.
- A single `make bake-off` target reproduces the whole table from committed
  config.

## 9. Key technical challenges

- **A fair fight.** It is trivial to rig this — withhold an index from Postgres,
  give ClickHouse a perfect sort key, model Mongo naively. Staff-level work means
  each engine gets the accelerator it *deserves* for the query, and you can show
  you didn't tilt the table.
- **Why columnar crushes scans.** Q1–Q4 read a few columns over the whole table;
  ClickHouse reads only those columns, compressed, with sort-key pruning, while
  Postgres hauls whole rows through the heap. Expect ClickHouse to win these by a
  large margin — your job is to *quantify* it and explain the mechanism.
- **Why Postgres wins point lookups and transactions.** Q5/Q6 touch one row.
  Postgres's btree + MVCC + real `UPDATE`/transactions beat a columnar engine
  that has no efficient single-row point path and no real OLTP transactions.
  ClickHouse will be *bad* here — that's a finding, not a failure.
- **Mongo aggregation realities.** The pipeline can do the group-bys, but
  `$group` over 1B docs without the right `$match`-early + index is a memory and
  scan disaster. Show where it's competitive and where it falls off.
- **The cost side of the matrix.** Footprint and ingest aren't free dimensions:
  ClickHouse's compression may be 5–10× tighter than Postgres; Mongo's per-doc
  overhead and index storage may dominate. A selection isn't just latency.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each, per engine, into the §5 table:

1. **Ingest bake-off.** Load the full dataset via each engine's fast path. Report
   rows/s, wall-clock, and final compressed footprint. Explain the footprint gap
   (columnar compression vs row heap vs BSON overhead + indexes).
2. **Query suite, untuned.** Run Q1–Q6 at concurrency 1 on the *untuned* schema.
   Capture p50/p99 per query per engine. This is the naïve baseline.
3. **Add the right accelerator per engine.** Postgres index/BRIN/MV, ClickHouse
   `ORDER BY` key / projection, Mongo compound index. Re-run Q1–Q6. Report the
   speedup *and* the accelerator's build time, storage overhead, and ingest
   penalty.
4. **Scan-class deep dive (Q1–Q4).** Show *why* ClickHouse wins: rows/bytes
   actually read, columns touched, sort-key pruning. Contrast with Postgres's
   heap scan and Mongo's pipeline scan.
5. **Point-lookup & transactional workload (Q5–Q6).** Run `cmd/txn`: point
   lookups by `event_id` and single-row updates under light load. Show Postgres
   winning and ClickHouse/Mongo struggling; explain the architectural reason.
6. **Concurrency scaling.** Drive Q1 at 1, 8, 32, 64 concurrent clients per
   engine. Plot p99 vs concurrency. Find where each engine's latency knee is and
   what bounds it (CPU, I/O, lock/merge contention).
7. **Footprint vs speed trade.** For ClickHouse, compare codecs / `ORDER BY`
   choices; for Postgres, MV-rollup vs on-the-fly; for Mongo, index set size vs
   query coverage. Show the storage-for-latency exchange rate.
8. **Selection matrix (required deliverable).** Synthesize everything into:

   | Workload shape | Recommended engine | Why (with your numbers) |
   |----------------|--------------------|--------------------------|
   | Wide-scan aggregations / dashboards over big immutable facts | _e.g._ ClickHouse | columnar scan + compression; cite Q1–Q4 Δ and footprint |
   | Mixed OLTP + light analytics, transactions, point reads | _e.g._ Postgres | btree + MVCC + real transactions; cite Q5/Q6 |
   | Flexible/evolving document shape, moderate scale, pipeline analytics | _e.g._ MongoDB | schema flexibility; cite where the pipeline holds up |
   | "Just one database" small-team constraint | _argue it_ | operational complexity vs the latency you give up |

   Every cell must be justified by a measured row in §5 — and you must call out
   the workload shapes where the choice flips.

## 11. Milestones

1. Compose stack up (all three engines, pinned, equal resource limits);
   `cmd/gen` produces the deterministic dataset to disk.
2. Three fast-path loaders working; ingest + footprint table filled
   (experiment 1).
3. Query harness + Q1–Q6 with cross-engine result-hash verification; untuned
   baseline table (experiment 2).
4. Tuned profiles per engine; accelerator-cost table (experiments 3–4).
5. Transactional workload + concurrency sweeps (experiments 5–6); knee curves.
6. Findings note + **selection matrix** (experiments 7–8).

## 12. Acceptance criteria (definition of done)

- [ ] Identical dataset (same seed, same logical rows) loaded into all three;
      cross-engine query results verified equal by hash.
- [ ] §5 table fully populated, untuned **and** tuned, every engine.
- [ ] Each engine's tuning written down and *justified* as fair (no rigged
      handicaps); a reviewer can see Postgres got its index and ClickHouse got a
      sane sort key.
- [ ] ClickHouse's scan win is **quantified and explained** (bytes/columns read,
      pruning), not just asserted.
- [ ] Postgres's point-lookup/transaction win is shown with Q5/Q6 numbers.
- [ ] Concurrency p99-vs-clients curves plotted for each engine, with the bound
      named.
- [ ] A **selection matrix** mapping ≥ 4 workload shapes to an engine, every cell
      backed by a number from §5 and the flip-points called out.
- [ ] Every number reproducible from a committed command + config (`make
      bake-off`).

## 13. Stretch goals

- Add a **materialized-view / continuous-aggregate** rollup per engine (CH
  `MATERIALIZED VIEW`, PG `MATERIALIZED VIEW` or TimescaleDB continuous
  aggregate, Mongo on-demand MV) and re-cost Q4.
- **JSON/semi-structured** path: query inside `props` (PG `JSONB` GIN vs CH JSON
  type vs native Mongo) and add a row to the matrix.
- **Update-heavy** variant: mutate 5% of rows and measure each engine's cost
  (PG MVCC bloat/`VACUUM`, CH `ALTER ... UPDATE` mutation pain, Mongo in-place).
- **Cold vs warm cache**: drop OS page cache and re-run Q1; report cold-start
  penalty per engine.
- Scale the dataset to 5–10B rows on one engine and show where single-node
  Postgres falls off the cliff that ClickHouse doesn't.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Fairness of the bake-off | Tunes each engine somewhat | Each engine gets the accelerator it deserves; can prove the comparison isn't rigged |
| Scan analysis | Shows ClickHouse is faster on aggregations | **Explains** the columnar mechanism with bytes/columns read and pruning evidence |
| OLTP vs OLAP boundary | Knows Postgres is better for point/txn work | Quantifies Q5/Q6, explains *why* columnar/document engines lose there |
| Cost dimensions | Reports query latency | Weighs latency against footprint, ingest, and operational complexity |
| Concurrency | Runs at concurrency 1 | Plots the p99 knee per engine and names the bound |
| Selection matrix | Produces a matrix | **Defends** every cell with numbers, states the flip-points, and resists resume-driven "ClickHouse for everything" |
| Communication | Clear findings note | Could defend the whole matrix — including the unflattering rows — to a staff panel |

> **Staff bar in one line:** the deliverable is a *defensible decision*, not a
> winner. A staff engineer picks the engine the workload needs, proves it with
> the table, and explicitly avoids the resume-driven default (reaching for
> ClickHouse on a transactional workload, or forcing Postgres to do OLAP it
> shouldn't).

## 15. References

- ClickHouse docs: `MergeTree`, sorting key vs partition key, `LowCardinality`,
  projections & materialized views, codecs.
- PostgreSQL docs: `COPY`, BRIN indexes, `work_mem`/parallel query, materialized
  views; consider TimescaleDB continuous aggregates for rollups.
- MongoDB docs: aggregation pipeline (`$match`/`$group`/`$sort`), compound index
  design, WiredTiger compression, bulk writes.
- *Designing Data-Intensive Applications* — Ch. 3 (storage & retrieval:
  row-oriented vs column-oriented).
- Go clients: `jackc/pgx/v5` (`CopyFrom`), `ClickHouse/clickhouse-go/v2` (native
  batch insert), `mongodb/mongo-go-driver` (unordered bulk writes).
- Sibling methodology: `events/06-broker-bake-off/` (matched-workload bake-off →
  selection matrix).
- See also: `Interview Question/23-database-types-and-selection/`,
  `Interview Question/05-postgresql/`, and `Interview Question/06-mongodb/`.
