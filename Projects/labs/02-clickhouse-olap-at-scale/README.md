# ClickHouse OLAP at Scale Lab

> Load **billions** of clickstream rows into ClickHouse and find out *why*
> columnar storage plus MergeTree answers analytical queries 100–1000× faster
> than Postgres — then find the settings where that advantage collapses: the
> many-small-inserts disaster, the wrong `ORDER BY`, an un-projected GROUP BY,
> and concurrency. You will produce numbers, not opinions.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Columnar analytics / OLAP |
| **Skills exercised** | MergeTree engine family, sparse primary index & granules, partitioning, materialized views & projections, codecs/compression, async inserts & batching, TTL/tiering, Postgres-vs-ClickHouse benchmarking, Go (`clickhouse-go`) bulk loader |
| **Interview sections** | 23 (database selection), 17 (performance), 14 (system design) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own analytics for a product doing ~500M tracked events per day. The growth
team wants self-serve dashboards: "top 50 referrers for country=DE in the last
30 days, broken down by hour," "unique users per campaign," "p95 session length
by device." Today these run against the Postgres fact table and each one takes
40–180 seconds and pins a CPU; three analysts opening dashboards at 9am takes
the OLTP database down with it.

You've been told "just put it in ClickHouse." That's the right instinct and a
dangerous one — ClickHouse is trivially fast on a well-modeled table and
catastrophically slow when you ingest the way you ingest into Postgres (one row
per HTTP request), or when your `ORDER BY` doesn't match how analysts filter.

Your job in this lab is to *characterize* ClickHouse on a multi-billion-row fact
table: hit a real bulk-ingest ceiling, make the three flagship queries fast and
explain **why** (granules, projections, codecs), break ingest with the
small-insert anti-pattern, and run the same queries head-to-head against
Postgres at the same row count. You will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Bulk-load **≥ 3 billion rows** into a MergeTree fact table and report a
  sustained ingest ceiling (rows/s and MB/s), with the bottleneck named.
- Make a tuned `ORDER BY` / primary key the reason scans read **megabytes, not
  gigabytes** — and prove it with `system.query_log` read-bytes deltas.
- Quantify the speedup from **projections** and **materialized views** on
  high-cardinality GROUP BYs, with before/after p99.
- Measure **compression ratio** and the codec trade-off (LZ4 vs ZSTD,
  DoubleDelta/Gorilla on timestamps & gauges) in bytes-on-disk and CPU.
- Reproduce and then *cure* the **many-small-inserts** disaster (too many parts
  → `TOO_MANY_PARTS`) with batching and async inserts.
- Run the **same 3 analytical queries against Postgres** at the same 3B rows and
  explain the gap (and where Postgres still wins).

**Non-goals**
- Running ClickHouse Cloud / a managed cluster. Run it yourself so you see parts,
  merges, and `system.*` tables.
- A distributed/sharded cluster (`Distributed` engine, multi-node) — that's the
  staff sharding lab. Single node here; saturate it first.
- Real-time sub-second streaming ingest — batch/async ingest is the focus.
- Building a BI frontend. Queries are run from `clickhouse-client` and the loader.

## 3. Functional requirements

1. A **loader** (`cmd/loader`) bulk-inserts generated events into ClickHouse via
   the Go driver `ClickHouse/clickhouse-go` (v2), with a configurable batch size,
   parallelism, and an `async_insert` on/off flag. It reports rows/s and MB/s.
2. A **generator** (`cmd/gen`) produces a deterministic (seeded) events fact
   table at the target scale with realistic cardinalities and a skewed key
   distribution (see §4).
3. A **schema set** (`sql/`) defines the same logical fact table three ways:
   the **tuned** MergeTree (good `ORDER BY` + partitioning + codecs), a
   **naive** MergeTree (default `ORDER BY tuple()`, no codecs), and the
   **Postgres** equivalent (with a sensible composite/BRIN index for fairness).
4. A **query suite** (`sql/queries/`) holds the 3 flagship analytical queries
   (Q1 top-N filtered + time-bucketed, Q2 high-cardinality `uniq`, Q3 multi-dim
   roll-up), runnable against all three schemas, emitting wall time + read bytes.
5. A **bench runner** (`cmd/bench`) executes a query N times (warm + cold), and
   reports p50/p99 and bytes read from `system.query_log` (ClickHouse) and
   `EXPLAIN (ANALYZE, BUFFERS)` (Postgres).

## 4. Load & data profile

- **Volume:** generate **≥ 3 billion rows** into the events fact table; the
  tuned table should land in the **tens of GB on disk after compression** (raw
  is ~300–600 GB depending on payload width — report your real ratio).
- **Row shape:** a clickstream event — see §7. Width target ~120–200 B raw/row.
- **Cardinalities (deliberate, realistic):** `user_id` ~50M distinct,
  `event_type` ~40, `url_host` ~200k (Zipfian, s≈1.1 — a few hosts dominate),
  `country` ~240, `device` ~12, `campaign_id` ~100k. High-cardinality columns
  (`user_id`, `url_host`) are what make GROUP BY / `uniq` expensive and what
  projections must rescue.
- **Time spread:** events span **180 days** so `PARTITION BY toYYYYMM(ts)` yields
  ~6 partitions and date-range queries can prune partitions and granules.
- **Generator:** `cmd/gen` is deterministic given a seed; it can emit Parquet/CSV
  for bulk load **and** stream rows for the small-insert experiment.
- **Traffic model for ingest:** test both **bulk** (large batches, the right way)
  and a hostile **open-model trickle** (one row per insert, the wrong way) to
  reproduce the parts explosion.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained bulk-ingest throughput (tuned table, batched, LZ4) | Find & report the ceiling in **rows/s and MB/s**; justify it (CPU on compression? merge backpressure? disk write BW? driver round-trips?). Expect **≥ 500k rows/s** single-node on commodity hardware — beat or explain it. |
| Q1 — top-N, filtered + time-bucketed (`WHERE country, ts range`), p99 | **< 200 ms** on tuned table at 3B rows (vs seconds-to-minutes on Postgres) |
| Q2 — high-cardinality distinct (`uniq(user_id)` by campaign), p99 | **< 500 ms** on tuned table (with projection/MV); state exact vs approximate |
| Q3 — multi-dimension roll-up (GROUP BY 4 cols, no filter, full scan), p99 | **< 3 s** full-scan on tuned table; **< 200 ms** if served by an AggregatingMergeTree MV |
| Compression ratio (raw bytes / on-disk bytes), tuned table | **≥ 8×** with LZ4; report ZSTD(3) ratio & CPU cost separately |
| Granule read efficiency (tuned vs naive `ORDER BY`) on Q1 | Tuned reads **< 1%** of the rows naive reads; prove with `read_rows`/`read_bytes` |
| Concurrent-query degradation | At **16 concurrent** copies of Q3, report p99 vs single-stream; identify the bound (`max_threads` × concurrency → CPU/memory) |

> The point of the lab is not to hit a magic number — it's to **find** your
> table's numbers, **explain** them with `system.query_log` and `system.parts`,
> and know exactly which knob moved each one.

## 6. Architecture constraints & guidance

- Single-node ClickHouse via `docker-compose` (pin the version, e.g.
  `clickhouse/clickhouse-server:24.x`). Single-node Postgres 16 alongside for the
  bake-off, given enough `shared_buffers`/`work_mem` to be a fair opponent.
- **Go loader:** `ClickHouse/clickhouse-go` v2 using the native protocol and
  **batch** API (`conn.PrepareBatch` → `batch.Append` → `batch.Send`); this is
  the columnar-block path and far faster than row-by-row `Exec`. Make batch size
  and parallelism flags. Add an `async_insert=1, wait_for_async_insert` variant.
- Let MergeTree do its job: **insert in large blocks** (≥ 100k–1M rows/insert),
  let background merges compact parts. Never one-row inserts in the bulk path.
- Instrument from ClickHouse's own truth: `system.query_log` (read_rows,
  read_bytes, memory_usage, query_duration_ms), `system.parts` (parts count,
  bytes, rows per partition), `system.asynchronous_metrics`, `system.merges`.
  Optionally scrape into Prometheus for a Grafana board of parts/merges/ingest.
- Keep all schema and tuning in committed `sql/` files; every reported number
  must be reproducible from a committed command + config.

## 7. Data model

```sql
-- Tuned MergeTree fact table (the protagonist)
CREATE TABLE events
(
    ts          DateTime      CODEC(DoubleDelta, LZ4),   -- monotonic-ish time
    user_id     UInt64        CODEC(LZ4),
    event_type  LowCardinality(String),                  -- ~40 values
    url_host    LowCardinality(String),                  -- ~200k -> dictionary
    url_path    String        CODEC(ZSTD(3)),            -- wide, low-entropy text
    country     LowCardinality(String),
    device      LowCardinality(String),
    campaign_id UInt32        CODEC(LZ4),
    duration_ms UInt32        CODEC(Gorilla, LZ4),        -- gauge-like
    revenue     Decimal64(4)  CODEC(LZ4)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (country, event_type, url_host, ts)              -- match the WHERE/GROUP BY
SETTINGS index_granularity = 8192;
```

```sql
-- Projection: serve the high-cardinality roll-up without re-scanning the base
ALTER TABLE events ADD PROJECTION p_campaign_uniq
(
    SELECT campaign_id, uniqState(user_id), count()
    GROUP BY campaign_id
);
ALTER TABLE events MATERIALIZE PROJECTION p_campaign_uniq;
```

```sql
-- Materialized view -> AggregatingMergeTree for Q3 (pre-aggregated roll-up)
CREATE MATERIALIZED VIEW events_by_dim_mv
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (country, device, event_type, toStartOfHour(ts)) AS
SELECT country, device, event_type, toStartOfHour(ts) AS hour,
       countState() AS events, uniqState(user_id) AS uniq_users,
       sumState(revenue) AS rev
FROM events
GROUP BY country, device, event_type, hour;
```

The **naive** table is the same columns with `ORDER BY tuple()`, no codecs, no
partitioning — the control. The **Postgres** table is the same columns with a
composite btree on `(country, ts)` and/or a BRIN on `ts`, plus the same 3 queries.

## 8. Interface contract

- `cmd/loader -batch=200000 -parallel=4 -async=false -table=events` →
  streams generated rows into ClickHouse, prints `rows/s`, `MB/s`, final
  `system.parts` count.
- `cmd/gen -seed=42 -rows=3000000000 -out=parquet` → deterministic fact data.
- `cmd/bench -target=clickhouse|postgres -query=q1 -runs=20 -cold` →
  prints p50/p99 wall time + read_rows/read_bytes (CH) or shared-block reads (PG).
- Queries `q1.sql`, `q2.sql`, `q3.sql` are identical in intent across engines and
  committed verbatim. Tuning knobs (`max_threads`, `max_insert_block_size`,
  `async_insert`, `min_insert_block_size_rows`) set via flag/`SETTINGS`.

## 9. Key technical challenges

- **`ORDER BY` is the whole game.** The primary key is a *sparse* index: one mark
  per 8192-row granule. A query can only skip granules whose mark range can't
  contain matches — which only works if the leading `ORDER BY` columns are the
  ones you filter on. Wrong order → full-scan; right order → read 0.1% of rows.
- **The small-insert disaster.** Each `INSERT` creates a part; parts must merge in
  the background. One-row inserts create millions of parts, merges fall behind,
  you hit `TOO_MANY_PARTS`, and ingest stalls. The fix (batching / async inserts)
  is the lesson — reproduce the failure *before* curing it.
- **Projections vs MVs vs base scan.** A projection is a second physical sort of
  the same data inside the table; an AggregatingMergeTree MV is an incrementally
  maintained pre-aggregate. Each has a write-amplification and storage cost.
  Quantify what each buys on Q2/Q3 and what it costs on ingest.
- **Codec trade-offs.** DoubleDelta/Gorilla crush monotonic timestamps and
  gauges; LZ4 is fast/cheap, ZSTD compresses harder for CPU. The wrong codec on
  the wrong column type costs ratio *and* query CPU. Measure both.
- **Concurrency.** ClickHouse spends threads per query (`max_threads`). One query
  can saturate all cores; sixteen concurrent ones contend. Find where added
  concurrency stops adding throughput and starts adding latency.
- **Fairness to Postgres.** Don't strawman it — give it `work_mem`, the right
  index, parallel workers. The point is to explain the *structural* columnar win,
  not to win a rigged race.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (rows/s, MB/s, p50/p99, read_rows/read_bytes,
on-disk bytes, CPU) for each:

1. **Ingest throughput vs batch size:** insert 100M rows at batch sizes
   1, 100, 1k, 10k, 100k, 1M rows. Plot rows/s and `system.parts` count vs batch
   size. Find the knee and the point where tiny batches collapse ingest.
2. **The many-small-inserts disaster:** drive one-row (or 1k-row) inserts as fast
   as possible until you trigger `TOO_MANY_PARTS` / merge backpressure. Capture
   parts count over time, then **cure it** two ways — (a) client-side batching,
   (b) `async_insert=1` server-side buffering — and re-measure rows/s and parts.
3. **`ORDER BY` / primary key:** run Q1 on the **naive** (`ORDER BY tuple()`)
   vs **tuned** table. Report `read_rows`/`read_bytes` from `system.query_log` and
   the p99 ratio. Show the tuned table reads < 1% of the granules.
4. **Projection / materialized-view speedup:** run Q2 and Q3 with no projection,
   then with the projection / AggregatingMergeTree MV. Report before/after p99 and
   the ingest-throughput tax + extra on-disk bytes the projection/MV adds.
5. **Compression & codecs:** load the same data with (a) no codecs, (b) LZ4,
   (c) ZSTD(3), (d) DoubleDelta+Gorilla on ts/duration. Report compression ratio,
   bytes-on-disk per column (`system.columns`), ingest CPU, and Q1 query CPU.
6. **Concurrent-query degradation:** run Q3 at concurrency 1, 2, 4, 8, 16, 32.
   Plot p99 and total throughput vs concurrency; identify the bound (`max_threads`
   × concurrency vs cores/memory) and the point of negative return.
7. **ClickHouse vs Postgres, same 3B rows:** run Q1, Q2, Q3 on both engines (PG
   tuned with its best index + `work_mem`). Report wall time, bytes read, and CPU.
   Explain the gap **and** name a query shape where Postgres is competitive or wins
   (e.g. a selective point/PK lookup, or a single-row update).
8. **TTL & tiering (stretch-adjacent):** add `TTL ts + INTERVAL 90 DAY` to move
   or drop old partitions (or `TO VOLUME 'cold'`); measure on-disk reduction and
   any effect on a 180-day query.

## 11. Milestones

1. Compose ClickHouse + Postgres up; `cmd/gen` deterministic data; `cmd/loader`
   batch path green; first 100M-row load and an ingest number.
2. Tuned vs naive schema both loaded to 3B rows; Q1 granule-read comparison
   (experiment 3) — the headline columnar result.
3. Ingest sweeps (experiments 1–2): batch-size knee + the small-insert disaster
   reproduced and cured; parts-over-time graphs.
4. Projections + MV (experiment 4) and codecs (experiment 5): Q2/Q3 sped up,
   compression ratios reported.
5. Concurrency (experiment 6) + Postgres bake-off (experiment 7); findings note
   with the "why columnar wins / where it loses" analysis.

## 12. Acceptance criteria (definition of done)

- [ ] **≥ 3B rows** loaded into the tuned MergeTree table; ingest ceiling reported
      in rows/s **and** MB/s **with the bottleneck named and proven**.
- [ ] Q1/Q2/Q3 p99 numbers on the tuned table meet (or miss-with-explanation) the
      §5 SLOs, each backed by `system.query_log` read_rows/read_bytes.
- [ ] Tuned vs naive `ORDER BY` on Q1: tuned reads **< 1%** of the rows naive
      reads — shown with the SQL and the `query_log` diff.
- [ ] The many-small-inserts disaster reproduced (parts explosion / `TOO_MANY_PARTS`)
      **and** cured two ways, with before/after rows/s and parts count.
- [ ] Projection/MV before-after p99 on Q2/Q3, with the ingest + storage tax stated.
- [ ] Compression ratio (≥ 8× LZ4) and per-codec trade-off table.
- [ ] Concurrency curve (p99 vs 1→32 concurrent Q3) with the bound identified.
- [ ] Postgres-vs-ClickHouse table for all 3 queries at 3B rows, with the gap
      explained and a query shape where Postgres wins named.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- **SummingMergeTree vs AggregatingMergeTree:** model a pre-summed counter both
  ways; compare write cost and read simplicity.
- **Sparse index granularity sweep:** `index_granularity` 8192 vs 1024 vs adaptive;
  measure index size vs granule-skip precision on a selective query.
- **`data skipping` indexes:** add a `minmax`/`bloom_filter` skip index on a column
  not in `ORDER BY` and measure granule pruning on a filter over it.
- **Dictionary/`LowCardinality` ablation:** drop `LowCardinality` from `url_host`
  and measure the GROUP BY and storage regression.
- **Distributed teaser:** shard the table across 2 nodes with a `Distributed`
  engine and re-run Q3; observe scatter-gather (proper sharding is the staff lab).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Schema / `ORDER BY` design | Picks an `ORDER BY` that matches the queries | Explains the sparse-index/granule mechanics; proves the granule-skip with `query_log` and would redesign it for a new query mix |
| Ingest | Loads 3B rows in large batches | Reports the ingest ceiling with the bound named; reproduces *and* cures the small-insert disaster two ways |
| Projections / MVs | Adds an MV and shows it's faster | Quantifies the speedup **and** the write/storage tax; picks projection vs MV vs base scan deliberately |
| Compression / codecs | Reports a compression ratio | Per-column codec choices justified by data type; trades ratio vs CPU for an SLO |
| Concurrency | Notices queries slow under load | Finds the concurrency knee, names the bound (`max_threads`×N vs cores), tunes it |
| Postgres comparison | Shows ClickHouse is faster | Explains the *structural* columnar win and names where Postgres still wins — picks the right tool per workload |
| Communication | Clear findings note | Could defend every curve and the engine-selection call to a staff panel |

## 15. References

- ClickHouse docs: MergeTree engine family, primary keys & sparse index, projections,
  materialized views, `async_insert`, codecs, TTL & storage policies.
- `system.query_log`, `system.parts`, `system.columns`, `system.merges` — your
  source of truth for read_bytes, parts, and compression per column.
- `ClickHouse/clickhouse-go` v2 — native batch API for the Go loader.
- Postgres: BRIN indexes, `EXPLAIN (ANALYZE, BUFFERS)`, parallel query, `work_mem`.
- *Designing Data-Intensive Applications* — Ch. 3 (column-oriented storage).
- See also: `Interview Question/23-database-types-and-selection/` (OLAP vs OLTP,
  columnar vs row stores, when to pick ClickHouse) and
  `Interview Question/17-performance-engineering/` (query latency, the tail,
  measuring read amplification).
