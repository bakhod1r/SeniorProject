# Postgres Indexing & Partitioning Deep-Dive

> Take a 100M-row table and stop *guessing* about indexes. Learn empirically
> when each index type wins, read `EXPLAIN (ANALYZE, BUFFERS)` like a planner,
> and find the exact point where partitioning beats a bigger index — and where
> an index quietly taxes every write.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Relational performance |
| **Skills exercised** | B-tree/GIN/BRIN/GiST/Hash indexes, composite column order & leftmost-prefix, partial & covering & expression indexes, index-only scans, HOT updates & fillfactor, bloat & `REINDEX CONCURRENTLY`, declarative partitioning & pruning, planner statistics & `n_distinct`, reading `EXPLAIN (ANALYZE, BUFFERS)`, Go (`pgx`) loader, `pgbench` |
| **Interview sections** | 5 (postgres/sql), 17 (performance), 23 (db selection) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the `orders` service at a marketplace. The `orders` table just crossed
**100M rows** and is growing ~2M/day. The dashboard queries that were 8 ms last
year are now 400 ms–4 s, p99 on the checkout path is creeping up, and someone
"helpfully" added four indexes last quarter — INSERTs got slower and nobody can
say which index is even used. Your VACUUM runs long, the table is bloated after
a status-backfill migration, and a junior just proposed "add an index on
everything."

Your job in this lab is to *characterize* Postgres index and partition behavior
on a realistically large, skewed dataset — not on a 10k-row toy where every plan
is a seq scan anyway. You will choose index types from measured evidence, read
the planner's actual buffer counts, and decide partitioning vs indexing with
numbers. **You produce `EXPLAIN (ANALYZE, BUFFERS)` output, not opinions.**

## 2. Goals / Non-goals

**Goals**
- Build a ≥100M-row schema with realistic skew and run a mixed read/write load.
- Demonstrate, with planner evidence, when **B-tree, GIN, BRIN, GiST, and Hash**
  each win — and when each loses.
- Master composite **column order / leftmost-prefix**, **partial**, **covering
  (`INCLUDE`)**, and **expression** indexes; prove **index-only scans**.
- Quantify the **write cost** of each added index and the **HOT-update**/
  `fillfactor` effect.
- Show **declarative range/hash partitioning** changing the plan via **partition
  pruning**, and measure when it beats one giant index.
- Diagnose **index bloat** after UPDATE churn and recover it with
  `REINDEX CONCURRENTLY` — with before/after size and latency.

**Non-goals**
- A managed Postgres (RDS/Aurora/Cloud SQL). Run it yourself so you can `VACUUM`,
  `REINDEX`, read `pg_stat_*`, and own the knobs.
- Sharding across nodes (that's the staff DB lab) — this is single-node.
- ORM ergonomics. Write raw SQL so the plan is exactly what you think it is.
- Query *rewriting* tricks as the main event — the focus is indexes & partitions.

## 3. Functional requirements

1. A **schema** (`schema.sql`) for `orders` (+ a child `events` table) sized to
   **≥100M rows**, with columns chosen to exercise every index type (see §7).
2. A **loader** (`cmd/load`, Go + `jackc/pgx` v5, `COPY` protocol) that generates
   deterministic-from-seed rows at the stated scale and skew, fast enough to load
   100M rows in a single sitting (target: bulk `COPY`, not row-by-row INSERT).
3. A **query workbench** (`cmd/bench` or committed `.sql` files) that runs each
   benchmark query under `EXPLAIN (ANALYZE, BUFFERS, TIMING)` and records plan +
   timing + buffer counts.
4. A **write-load harness** built on **`pgbench`** with custom scripts, to measure
   INSERT/UPDATE throughput **with and without** each candidate index.
5. A **findings note** (`FINDINGS.md`) where every claim is backed by committed
   `EXPLAIN (ANALYZE, BUFFERS)` output and a reproducible command.

## 4. Load & data profile

- **Volume:** `orders` ≥ **100,000,000 rows**; `events` ≥ **300M rows** (≈3 per
  order) for the BRIN/time experiments. Report on-disk table + index sizes from
  `pg_total_relation_size`.
- **Time spread:** `created_at` spans **3 years**, monotonically increasing on
  insert (so it correlates with physical order — the BRIN sweet spot).
- **Skew (deliberate):**
  - `status` ∈ {`pending`,`paid`,`shipped`,`delivered`,`cancelled`,`refunded`} —
    **highly skewed**: ~92% `delivered`, ~3% each of the rest. (`pending` is the
    rare hot-path filter — the partial-index target.)
  - `customer_id` **Zipfian** (s≈1.1) over 5M customers → some customers have
    100k+ orders, most have a handful.
  - `attrs jsonb` — variable keys (e.g. `{"channel":"ios","coupon":"X","ab":7}`)
    for GIN; one nested array `tags text[]` for GIN-on-array.
  - `region` low-cardinality (12 values) → `n_distinct` test + hash-partition key.
- **Generator:** deterministic given `-seed`; document the exact distribution.
- **Read/write mix:** steady **read** workbench queries while a **`pgbench`**
  write stream runs (95/5 and 50/50 read/write profiles) so you observe index
  maintenance cost under concurrent load, not in isolation.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Point lookup `WHERE order_id = $1` (B-tree PK) | p99 < **1 ms**; **Buffers: shared hit** only after warmup; ≤ 5 buffers read |
| Selective range `created_at BETWEEN` (last 7 days, ~0.6% of rows) | Index/bitmap scan, **not** seq scan; report buffers vs the 100M-row seq-scan baseline |
| Rare-status filter `status='pending'` (~0.4M rows) | **Partial index** plan; < **15 ms**; show buffer count ≪ full B-tree |
| `attrs @> '{"channel":"ios"}'` (jsonb containment) | **GIN bitmap** plan; report recheck rows & buffers vs a normalized-column B-tree |
| Covering query (`SELECT amount,status … WHERE customer_id=$1`) | **Index Only Scan**, `Heap Fetches: 0` after VACUUM |
| Time-window aggregate over `events` (1-day slice of 300M) | **BRIN** within **3×** of B-tree latency at **<2%** of B-tree index size — report both |
| Write throughput tax per added index | Quantified Δ TPS from `pgbench` per index; name the worst offender |
| Bloat recovery | After churn, `REINDEX CONCURRENTLY` cuts index size & restores scan latency to baseline ±10% — show both numbers |

> The point is not a magic millisecond — it's to **find** your cluster's numbers
> and **explain the plan and the buffers** that produced them.

## 6. Architecture constraints & guidance

- **Postgres 16** in `docker-compose`, pinned version, with a deliberately sized
  `shared_buffers` (e.g. 25% of container RAM), `effective_cache_size`,
  `work_mem`, `maintenance_work_mem` — record them; the plan depends on them.
- Load via **`COPY`** (`pgx.CopyFrom`), not INSERTs — 100M row-by-row INSERTs is
  a different lab. Build indexes **after** bulk load and time the build.
- Always run reads with `EXPLAIN (ANALYZE, BUFFERS)`. A timing without buffers is
  half a measurement — buffers separate "fast because cached" from "fast plan."
- Run `ANALYZE` after load and after each large change; a stale `n_distinct` is
  the #1 cause of a wrong plan. Inspect `pg_stats` for the columns you index.
- Use `pg_stat_user_indexes` / `pg_stat_user_tables` to prove which indexes are
  actually used (`idx_scan`) and to watch `n_dead_tup`, HOT (`n_tup_hot_upd`).
- For the partitioning experiments use **declarative partitioning** (range on
  `created_at`, hash on `region`) — not inheritance triggers.

## 7. Data model

```sql
CREATE TABLE orders (
  order_id    bigserial,
  customer_id bigint      NOT NULL,   -- Zipfian, 5M distinct
  status      text        NOT NULL,   -- skewed: ~92% 'delivered'
  region      text        NOT NULL,   -- 12 distinct (hash-partition key)
  amount      numeric(12,2) NOT NULL,
  created_at  timestamptz NOT NULL,   -- monotonic on insert (BRIN-friendly)
  updated_at  timestamptz NOT NULL,
  attrs       jsonb       NOT NULL,   -- GIN target
  tags        text[]      NOT NULL,   -- GIN-on-array target
  PRIMARY KEY (order_id)              -- B-tree
);

CREATE TABLE events (                 -- ≥300M rows, append-only, time-correlated
  event_id   bigserial,
  order_id   bigint      NOT NULL,
  kind       text        NOT NULL,
  ts         timestamptz NOT NULL,    -- monotonic → BRIN vs B-tree showdown
  PRIMARY KEY (event_id)
);
```

Candidate indexes to build, measure, and (some of them) reject:

```sql
-- B-tree composite: column order matters (leftmost-prefix)
CREATE INDEX ix_cust_created ON orders (customer_id, created_at);
-- Partial: only the rare hot-path rows
CREATE INDEX ix_pending ON orders (created_at) WHERE status = 'pending';
-- Covering / index-only scan
CREATE INDEX ix_cust_inc ON orders (customer_id) INCLUDE (amount, status);
-- Expression index
CREATE INDEX ix_lower_region ON orders (lower(region));
-- GIN on jsonb and on array
CREATE INDEX ix_attrs_gin ON orders USING gin (attrs jsonb_path_ops);
CREATE INDEX ix_tags_gin  ON orders USING gin (tags);
-- BRIN on the append-only time column (vs a B-tree on the same column)
CREATE INDEX ix_events_ts_brin ON events USING brin (ts) WITH (pages_per_range=128);
CREATE INDEX ix_events_ts_btree ON events (ts);   -- the size/speed comparison
-- Hash (equality-only) vs B-tree on the same column
CREATE INDEX ix_region_hash ON orders USING hash (region);
```

## 8. Interface contract

- Each benchmark query lives in a committed `.sql` file and is run as
  `EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT) <query>`; its output is saved
  next to it (`q03.sql` → `q03.plan.txt`).
- The loader: `cmd/load -dsn … -seed 42 -orders 100000000 -events 300000000`.
- `pgbench` write scripts: `bench/insert.sql`, `bench/update_status.sql`,
  driven as `pgbench -n -f bench/update_status.sql -c 16 -j 4 -T 120`.
- A `make` target (or `run.sh`) reproduces: load → analyze → build indexes →
  run the read suite → run the write suite → dump sizes. Every number traces to
  one command.

## 9. Key technical challenges

- **Reading the plan, not the clock.** `Buffers: shared hit=… read=…` tells you
  whether a "fast" query was fast because of a good plan or a warm cache. You
  must separate the two, and reason about `Rows Removed by Filter`, `Heap
  Fetches`, bitmap `recheck`, and `Rows Removed by Index Recheck`.
- **Column order & leftmost-prefix.** `(customer_id, created_at)` serves
  `WHERE customer_id=$1 AND created_at>…` and `WHERE customer_id=$1` but **not**
  `WHERE created_at>…` alone. Proving the negative case is the lesson.
- **When the planner ignores your index.** A non-selective predicate (e.g.
  `status='delivered'`, 92% of rows) makes a seq scan *correct*. Forcing an
  index there is slower — prove it. `n_distinct`/`pg_stats` drives this choice.
- **BRIN vs B-tree.** BRIN is ~1000× smaller but only wins when physical order
  correlates with the column. Break it: shuffle `events` and watch BRIN collapse.
- **The write tax.** Every secondary index is updated on every relevant write and
  blocks HOT updates if it indexes a changed column. Quantify TPS loss per index,
  and show how `fillfactor` + HOT recovers some of it.
- **Bloat.** A mass `UPDATE status` leaves dead tuples and bloated indexes; scans
  slow down even though the row count is unchanged. `REINDEX CONCURRENTLY` (not
  the locking `REINDEX`) is the production recovery — measure the win.
- **Partition pruning.** A `created_at` predicate must prune to one partition at
  plan time; prove pruning happened (`Subplans Removed` / one partition in the
  plan) and measure planning-time cost when partition count grows.

## 10. Experiments to run (break it / tune it)

Every experiment requires **`EXPLAIN (ANALYZE, BUFFERS)` evidence** (plan +
timing + buffers), before and after. Commit the plan output.

1. **No-index → B-tree → covering, same query.** Run
   `SELECT amount,status FROM orders WHERE customer_id=$1` with (a) no index,
   (b) `(customer_id)`, (c) `INCLUDE (amount,status)`. Record latency **and**
   `shared hit/read` buffers and `Heap Fetches` for each. Show (c) becomes an
   **Index Only Scan** with `Heap Fetches: 0` *after VACUUM* — and isn't, before.
2. **BRIN vs B-tree on 300M-row time column.** On `events.ts`: build both, report
   index **size** (`pg_relation_size`) and a 1-day-window scan's latency + buffers
   for each. Then **shuffle** `events` physical order (`CLUSTER` on a random key or
   reload unsorted) and re-measure — show BRIN degrade and explain correlation.
3. **GIN-on-jsonb vs normalized column.** Query `attrs @> '{"channel":"ios"}'`
   with a `gin (attrs)` index, vs extracting `channel` to its own B-tree column.
   Compare latency, index size, write cost, and the GIN **recheck** row count.
4. **Composite column-order effect.** With `(customer_id, created_at)`: run
   `WHERE customer_id=$1 AND created_at>$2` (uses both), `WHERE customer_id=$1`
   (leftmost OK), and `WHERE created_at>$2` alone (no prefix → seq/other scan).
   Show the third's plan and buffers, then add `(created_at, customer_id)` and
   re-measure. Conclude which order to keep.
5. **Partial-index selectivity win.** `WHERE status='pending'` (~0.4%) with a full
   B-tree on `status` vs a **partial** index `WHERE status='pending'`. Compare
   index size and buffers. Then run the same with `status='delivered'` (92%) and
   show the planner (correctly) picks a **seq scan** — index doesn't help.
6. **Partition pruning before/after.** Range-partition `orders` by month on
   `created_at`. Run a last-7-days query on the unpartitioned table vs the
   partitioned one; show **partition pruning** (only 1–2 partitions scanned,
   `Subplans Removed` in the plan) and the buffer/latency delta. Then test a query
   with **no** partition-key predicate and show pruning fails (all partitions).
7. **Write-throughput cost per added index.** Baseline `pgbench` INSERT/UPDATE TPS
   with **zero** secondary indexes, then add them one at a time (B-tree, GIN,
   covering, expression) and re-run. Report Δ TPS per index; name the most
   expensive (expect GIN-on-jsonb). Show indexing the **updated** column kills HOT.
8. **HOT & fillfactor.** Set `fillfactor=70` on `orders`, run an `UPDATE` stream
   on a **non-indexed** column; watch `pg_stat_user_tables.n_tup_hot_upd` rise.
   Then index that column and show HOT updates drop to ~0. Quantify the bloat &
   TPS difference.
9. **Bloat & `REINDEX CONCURRENTLY` recovery.** Run a heavy `UPDATE status`
   churn pass; measure index size growth (`pgstattuple`/`pg_relation_size`) and
   the slowdown of experiment-1's query. Run `REINDEX INDEX CONCURRENTLY`; show
   size shrink and latency return to baseline ±10%. Note it ran without an
   exclusive lock.
10. **Stale statistics break the plan.** Bulk-insert 20M rows, **don't** `ANALYZE`,
    and run a range query — show the planner mis-estimates rows (bad `n_distinct`)
    and picks the wrong scan. Run `ANALYZE`; show the plan flip. This is the
    cheapest production fix and the most-forgotten.

## 11. Milestones

1. Compose Postgres up (tuned + pinned); `schema.sql`; Go `COPY` loader hits
   100M `orders` + 300M `events`; sizes recorded; `ANALYZE` done.
2. Read workbench wired to `EXPLAIN (ANALYZE, BUFFERS)`; baseline seq-scan numbers
   captured; experiments 1, 4, 5 (B-tree family) done.
3. Specialized indexes: experiments 2 (BRIN), 3 (GIN), and the Hash-vs-B-tree
   equality test done with sizes + buffers.
4. `pgbench` write harness; experiments 7, 8 (write tax + HOT/fillfactor) done.
5. Partitioning (experiment 6) and bloat recovery + stale-stats (9, 10) done;
   `FINDINGS.md` written with plans attached.

## 12. Acceptance criteria (definition of done)

- [ ] 100M+ `orders` and 300M+ `events` loaded; table + per-index sizes reported
      from `pg_total_relation_size`, with index **build times**.
- [ ] Every benchmark query has committed `EXPLAIN (ANALYZE, BUFFERS)` output;
      claims cite the **plan node + buffer counts**, not just wall-clock ms.
- [ ] Index-only scan demonstrated with `Heap Fetches: 0` (and shown failing
      before VACUUM).
- [ ] BRIN-vs-B-tree size **and** latency table on the 300M-row time column, plus
      the shuffled-order degradation result.
- [ ] Composite column-order: the leftmost-prefix negative case shown in a plan.
- [ ] Partial-index win **and** the non-selective case where the index is (rightly)
      ignored.
- [ ] Partition pruning proven in a plan (pruned partitions) with before/after
      numbers, plus the no-pruning counter-case.
- [ ] `pgbench` write-tax table: Δ TPS per added index, worst offender named.
- [ ] Bloat → `REINDEX CONCURRENTLY` → recovery, with size + latency before/after.
- [ ] Stale-stats plan flip shown before/after `ANALYZE`.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **`pg_trgm` GIN** for `LIKE '%foo%'` / fuzzy search on a text column; compare to
  a normal B-tree (which can't serve a leading wildcard).
- **GiST** experiment: range/exclusion (e.g. `tstzrange` no-overlap exclusion
  constraint, or a geometric/`ltree` column) where B-tree can't express the query.
- **Hash-partition** `orders` by `region` and contrast with range-by-month for a
  query that filters on neither key (worst case) vs both.
- **Multicolumn vs expression covering** for a sort-and-limit query
  (`ORDER BY created_at DESC LIMIT 20`) — show the index providing both filter and
  order, killing the explicit `Sort` node.
- **Parallel seq scan vs index scan** crossover: find the selectivity where a
  parallel seq scan beats the index, and tune `random_page_cost`.
- **B-tree deduplication / `pg_visibility`** inspection of the visibility map to
  explain *why* index-only scans need a recent VACUUM.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Reading plans | Knows seq vs index scan from `EXPLAIN ANALYZE` | Reasons from `Buffers`, `Heap Fetches`, recheck & filter rows; separates cache from plan |
| Index-type choice | Picks B-tree/GIN/BRIN correctly when prompted | Justifies each from selectivity, size, write cost & correlation — and rejects the wrong ones with data |
| Composite & covering | Knows leftmost-prefix exists | Proves the negative case; designs `INCLUDE`/order for index-only scans with `Heap Fetches: 0` |
| Write trade-offs | Knows indexes slow writes | Quantifies TPS tax per index; understands HOT/`fillfactor`; recommends which indexes to *drop* |
| Partitioning | Sets up declarative partitions | Proves pruning in the plan; knows when partitioning beats a bigger index and when it doesn't |
| Bloat & stats | Knows VACUUM/ANALYZE exist | Diagnoses bloat & stale `n_distinct` from `pg_stat_*`; recovers with `REINDEX CONCURRENTLY` and measures it |
| Communication | Clear findings note | Could defend every plan and every buffer count to a staff panel |

## 15. References

- Postgres docs: *Indexes* (B-tree, Hash, GiST, GIN, BRIN), *Index-Only Scans*,
  *Declarative Partitioning*, `EXPLAIN`, `pgstattuple`, `REINDEX CONCURRENTLY`.
- *Designing Data-Intensive Applications* — Ch. 3 (storage & retrieval, B-trees
  vs LSM, secondary indexes).
- *The Art of PostgreSQL* (Fontaine) — indexing & query plans.
- Markus Winand, *Use The Index, Luke!* — leftmost-prefix, covering, the negative
  cases.
- `pgbench` docs (custom scripts) and `jackc/pgx` `CopyFrom` for the bulk loader.
- See also: `Interview Question/05-postgresql-and-sql/` and
  `Interview Question/17-performance-engineering/`.
