# Sharded Multi-Tenant Database Platform

> Scale a relational workload past one Postgres node by sharding it across many.
> Build the routing layer, isolate noisy tenants — and then do the hard thing:
> **split a hot shard while it serves live traffic, losing zero rows and zero
> seconds of uptime.** The shard key is a one-way door; defend yours.

| | |
|---|---|
| **Tier** | Staff (horizontal data scaling) |
| **Primary domain** | Distributed data / multi-tenancy |
| **Skills exercised** | Sharding, shard-key design, consistent hashing, directory routing, cross-shard fan-out, online resharding (dual-write + backfill + cutover), tenant isolation, fleet-wide schema migration, Go (`pgx`, `jackc/pgxpool`) |
| **Interview sections** | 5 (postgres), 13 (distributed systems), 22 (scalability), 23 (db selection) |
| **Est. effort** | 6–10 focused days |

---

## 1. Context

You run the data platform for a B2B SaaS doing **~4 billion rows** of tenant
data across **~8,000 tenants**. The primary Postgres node is at 85% CPU during
business hours, the working set no longer fits in RAM, and a single `VACUUM` on
the biggest table now runs into the next maintenance window. Vertical scaling
bought you 18 months; it has run out. Read replicas help reads but not the write
ceiling, and the write ceiling is the wall you've hit.

Worse: tenants are wildly skewed. Three "whale" tenants account for ~40% of all
rows and ~55% of write volume; the long tail is 7,000 tenants under 50k rows
each. One whale's batch import currently degrades p99 for everyone on the box —
the classic noisy-neighbor failure.

Your mandate is to **shard the relational workload horizontally** across many
Postgres instances behind a routing layer, keep tenants isolated, and — the part
that decides whether this is a staff-level result — **reshard live**: detect a
hot shard and split it without downtime, without losing or duplicating a single
row under concurrent writes. You will produce numbers and a defended design, not
a diagram.

This is also a *when-not-to* exercise. Sharding is the most expensive
architecture decision on this list. Part of the deliverable is proving you'd
reach for Citus, Vitess, or simply a bigger box first — and saying exactly where
that stops being enough.

## 2. Goals / Non-goals

**Goals**
- Stand up **N ≥ 4 Postgres shards** behind a Go routing layer that maps any
  query to the correct shard from a stable **shard key**, and serve a
  multi-tenant OLTP workload across them.
- Show **near-linear write-throughput scaling** as shards are added, find where
  it stops being linear, and explain why.
- Implement and prove an **online shard split**: take a hot shard, split it into
  two, and cut over live traffic with **zero downtime and zero data loss/dupes**
  under concurrent writes.
- Enforce **tenant isolation** so one whale's burst cannot blow the SLO for
  tenants on other shards (and bound the blast radius for co-resident tenants).
- Roll a **schema migration across all N shards** safely (expand/contract), and
  report fleet-wide rollout time and failure handling.

**Non-goals**
- Adopting Citus or Vitess as the *solution*. You will **benchmark against**
  them (§13), but the point is to build the routing/resharding logic yourself so
  you understand what they hide.
- Globally-distributed / multi-region placement (that's a separate staff lab).
- A general distributed-SQL query planner. Cross-shard queries exist here to be
  measured and then *designed away*, not to be made fast.
- Strong cross-shard ACID by default. You will deliberately design to **not
  need** distributed transactions; the one place you can't, you'll state the
  guarantee you actually provide.

## 3. Functional requirements

1. A **router** (`cmd/router` or a library `internal/shardmap`) resolves any
   request carrying a `tenant_id` to exactly one shard and returns a `pgxpool`
   handle to it. Routing must survive shard add/remove and an in-progress split.
2. A **data API** (`cmd/api`) exposes tenant-scoped OLTP operations:
   - `POST /tenants/{tid}/orders` — single-shard write.
   - `GET  /tenants/{tid}/orders?...` — single-shard read.
   - `GET  /admin/reports/revenue` — **cross-shard** scatter-gather aggregate
     (exists so you can measure the fan-out tax and then justify avoiding it).
3. A **shard map** is the source of truth for key→shard placement. Implement
   **both** routing strategies behind one interface and compare them (§8):
   - **Directory-based** (a lookup table: `tenant_id → shard_id`, cacheable).
   - **Algorithmic** (consistent hashing over a hash ring with virtual nodes).
4. A **resharder** (`cmd/reshard`) performs an online split of one source shard
   into two: snapshot → **dual-write** → backfill → verify → **cutover** →
   decommission, each step resumable and individually reversible before cutover.
5. A **migrator** (`cmd/migrate`) applies a schema change across all shards with
   per-shard status, bounded concurrency, and a stop-on-failure mode.
6. A **load harness** (`cmd/load`) drives a tenant-skewed open-model workload and
   a **chaos hook** that can promote a tenant to "whale" mid-run and kill a shard.

## 4. Load & data profile

- **Volume:** ≥ **4 billion rows** total across shards (orders + line items);
  the largest single table per shard ≥ 200M rows so index and vacuum behavior
  is realistic, not toy.
- **Tenants:** **8,000** tenants. Sizes are **Zipfian (s ≈ 1.2)**: 3 whales hold
  ~40% of rows, ~60 mid-tenants hold ~35%, ~7,900 long-tail tenants hold the
  rest. This skew is the whole point — it breaks naive hashing.
- **Shards:** start at **4**, scale experiments to **8 and 16**. Each shard is
  its own Postgres instance (separate container, own page cache, own WAL).
- **Write/read mix:** 30% writes / 70% reads at steady state; whale import bursts
  push one tenant to **10× its baseline write rate** for 5-minute windows.
- **Generator:** `cmd/gen` is deterministic given a seed; it can emit the
  Zipfian tenant distribution and a configurable hot-tenant burst.
- **Traffic model:** **open-model** (fixed arrival rate, not closed-loop) so lag
  and tail latency build visibly when a shard saturates.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Single-shard write p99 (steady state, below ceiling) | < 15 ms |
| Single-shard read p99 (indexed, tenant-scoped) | < 10 ms |
| Router resolution overhead (per request, cache-hit) | < 100 µs added p99; report cache-miss path separately |
| Write-throughput scaling 4→8→16 shards | Near-linear; **report the actual slope** and name what bends it |
| Cross-shard scatter-gather p99 (revenue report, N shards) | Measure & report; expect ≫ single-shard. Justify why it's an admin-only path |
| **Online split — data correctness** | After split under live writes: `rows_before == rows_after`, **zero lost, zero duplicate** (prove with a checksum diff) |
| **Online split — availability** | **Zero failed writes** during cutover; report max write-path latency spike and its duration |
| Noisy-neighbor blast radius | A whale at 10× write rate must **not** push other shards' p99 above SLO; co-resident tenants' degradation bounded and reported |
| Fleet schema migration (N shards) | Completes with per-shard status; report total wall-clock and behavior on a mid-rollout shard failure |

> The target is not a magic number — it's to **find** your platform's scaling
> slope and resharding cost, and **defend** them to a staff panel.

## 6. Architecture constraints & guidance

- **N Postgres instances** via `docker-compose`, each a real separate node
  (own volume, own `shared_buffers`). Pin the version. No managed RDS — you need
  to see the WAL, the vacuum, the connection limits.
- **Go + `pgx`/`pgxpool`**, one pool **per shard**. The router owns the pool map;
  size pools so total connections stay under each shard's `max_connections`
  (this becomes a real constraint at 16 shards — budget it).
- **Shard map** lives in a small coordination store (a dedicated Postgres
  "catalog" DB or etcd). Routers cache it and watch for version bumps; an
  in-progress split publishes a "splitting" state the router must honor.
- **Idempotency keys** on writes from day one — resharding correctness depends on
  being able to replay safely.
- Instrument with Prometheus: per-shard QPS / p99 / connection-pool saturation /
  replication or backfill lag, router cache hit-rate, and a per-tenant
  top-talkers view so you can *see* the whale.

## 7. Data model & shard map

```sql
-- Every shardable table carries the shard key as a leading column.
-- Shard key = tenant_id (see §9 for why, and what it costs).

orders(
  tenant_id   BIGINT NOT NULL,          -- SHARD KEY
  order_id    BIGINT NOT NULL,          -- unique *within* tenant
  amount_cents BIGINT NOT NULL,
  status      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, order_id)      -- co-located, no cross-shard PK
);
line_items(
  tenant_id   BIGINT NOT NULL,          -- SHARD KEY (co-located with orders)
  order_id    BIGINT NOT NULL,
  sku         TEXT, qty INT, price_cents BIGINT,
  PRIMARY KEY (tenant_id, order_id, sku),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, order_id)
);

-- Idempotency ledger (per shard) — makes dual-write + replay safe.
write_log(tenant_id BIGINT, idem_key UUID, applied_at TIMESTAMPTZ,
          PRIMARY KEY (tenant_id, idem_key));
```

**Shard map (catalog DB — source of truth):**
```sql
shards(shard_id INT PK, dsn TEXT, state TEXT);   -- state: active | splitting | draining
-- Directory strategy:
tenant_placement(tenant_id BIGINT PK, shard_id INT, moved_at TIMESTAMPTZ);
-- Algorithmic strategy: hash ring with virtual nodes
ring(vnode_hash BIGINT PK, shard_id INT);        -- ~256 vnodes/shard for even spread
map_version BIGINT;                              -- routers watch this; bump on any change
```

**Key design points to defend:**
- `tenant_id` leads every PK so a whole tenant lives on one shard → most queries
  are **single-shard**, and a tenant moves as one atomic unit during resharding.
- No global auto-increment IDs (they'd force a cross-shard sequence). IDs are
  unique *within* a tenant, or use ULID/snowflake-style IDs if you need global
  uniqueness — state which and why.
- The **whale problem** the model can't hide: one whale > one shard's capacity
  means `tenant_id` alone is no longer a sufficient shard key. §9 forces the
  decision (sub-shard a whale by a composite key vs. give it a dedicated shard).

## 8. Routing / API contract

- **Router interface (one contract, two implementations):**
  `ShardFor(tenant_id) → (shard_id, *pgxpool.Pool)`; both directory and
  consistent-hashing implement it. Compare: directory gives **arbitrary
  placement** (you can pin a whale to its own shard) at the cost of a lookup +
  cache-invalidation problem; consistent hashing gives **O(1) stateless
  routing** and minimal key movement on rebalance, but you **can't pin** a hot
  tenant without a directory override on top.
- **During a split**, `ShardFor` consults `state`: a tenant whose range is
  `splitting` routes writes to **both** old and new shard (dual-write) and reads
  to the authoritative side until cutover flips the map version.
- **Endpoints:**
  - `POST /tenants/{tid}/orders` → 200; carries `Idempotency-Key`.
  - `GET  /tenants/{tid}/orders` → single-shard.
  - `GET  /admin/reports/revenue` → fan-out to all shards, scatter-gather,
    merge; response includes `shards_queried`, `fanout_ms`, `slowest_shard`.
  - `GET  /admin/shardmap` → current placement + map version.
  - `GET  /metrics` → Prometheus.
- **Config/flags:** `-strategy=directory|consistent-hash`, `-shards`,
  `-vnodes`, `-pool-size-per-shard`.

## 9. Key technical challenges

- **Shard-key choice is a one-way door.** `tenant_id` (co-locates a tenant,
  cheap single-shard reads, easy moves) vs. **hash(tenant_id)** (even spread,
  kills range scans, hard to pin a whale) vs. **range** (range scans + easy
  splits, but hot-range skew). Pick one, state the workload it optimizes, and
  name the query class it makes expensive. Then handle the case it breaks: a
  **whale bigger than one shard**.
- **Online resharding without losing a row.** The split must be correct under
  concurrent writes: snapshot a consistent point → **dual-write** new writes to
  source *and* destination → **backfill** the historical rows (chunked,
  resumable, idempotent via `write_log`) → **verify** with a per-chunk checksum
  → **cutover** by bumping `map_version` atomically → drain & decommission the
  old copy. The dangerous windows are (a) writes that land between snapshot and
  dual-write start, and (b) the cutover instant — design both so **no write is
  lost and no row is double-applied**.
- **Cross-shard queries are a tax, not a feature.** A scatter-gather report is
  bounded by the **slowest** shard (tail amplification) and N× the connections.
  Measure it, then justify why it's admin-only / async / served from a
  pre-aggregated rollup instead of the live path.
- **Distributed transactions — designed away.** A write that must touch two
  tenants/shards atomically has no cheap answer (2PC = coordinator + blocking).
  The staff move is to make the shard key guarantee such writes don't exist; for
  the one case that genuinely spans shards, state the weaker guarantee you ship
  (e.g. saga + idempotency, eventual consistency) and why it's acceptable.
- **Noisy neighbors.** A whale's burst can saturate its shard's CPU, WAL, and
  connection pool. Bound the blast radius: per-tenant rate limits / pool quotas,
  and shard placement that isolates whales — and *prove* other shards stay green.
- **Fleet-wide schema migration.** A migration must be **expand/contract** so
  old and new code coexist while it rolls; a non-concurrent `CREATE INDEX` or a
  rewriting `ALTER` on a 200M-row shard locks writes. Roll with bounded
  concurrency and handle a shard that fails mid-rollout without leaving the fleet
  in mixed schema forever.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Scaling slope:** fix per-tenant rate, run on 4 → 8 → 16 shards. Plot
   aggregate write throughput. Is it linear? Where does it bend, and what bends
   it — router CPU, catalog lookups, connection limits, or skew?
2. **Shard-key bake-off:** route the *same* workload by `tenant_id` vs
   `hash(tenant_id)` vs range. Measure single-shard hit-rate, load balance
   (per-shard QPS spread), and what each does to the revenue report.
3. **Hot-shard detection + live split:** drive a whale to 10× write rate, detect
   the hot shard, and perform an **online split** while traffic runs. Measure:
   failed writes (target **0**), max write-latency spike and its duration, and
   total split wall-clock. Then prove correctness (experiment 4).
4. **Resharding correctness under concurrency:** during the split, run a
   continuous writer. After cutover, checksum source vs destination:
   `rows_before == rows_after`, **zero lost, zero duplicate**. Show the diff/SQL.
   Then kill the resharder mid-backfill and prove it resumes idempotently.
5. **Scatter-gather vs single-shard:** revenue report fan-out p99 at 4/8/16
   shards vs a single-shard read. Quantify tail amplification (slowest-shard
   effect). Then serve it from a rollup and re-measure.
6. **Router overhead:** directory (with and without cache) vs consistent-hash
   resolution latency under load. Report cache hit-rate and the cache-miss p99.
7. **Noisy neighbor:** whale burst on shard A — measure p99 on shards B/C/D
   before and after adding per-tenant pool quotas / rate limits. Show isolation.
8. **Fleet migration:** roll an expand/contract change (add column + backfill +
   index `CONCURRENTLY`) across all shards. Report wall-clock, write impact per
   shard, and behavior when one shard fails mid-rollout.

## 11. Milestones

1. Compose N shards + catalog; router with directory strategy; data API doing
   single-shard reads/writes; Prometheus + Grafana per-shard board.
2. `cmd/gen` Zipfian tenants at scale; baseline scaling run (experiment 1) and
   shard-key bake-off (experiment 2).
3. Consistent-hashing strategy behind the same interface; router-overhead +
   scatter-gather measurements (experiments 5, 6).
4. **Online resharder**: dual-write + backfill + verify + cutover; live split
   with correctness proof (experiments 3, 4). *This is the milestone that matters.*
5. Noisy-neighbor isolation + fleet schema migration (experiments 7, 8);
   findings note + Citus/Vitess comparison (§13).

## 12. Acceptance criteria (definition of done)

- [ ] N ≥ 4 real Postgres shards serving the tenant-scoped API; per-shard
      dashboard screenshot attached.
- [ ] Scaling curve (4/8/16 shards) plotted, **with the bend named and proven**
      (pprof / pg_stat / connection-saturation evidence).
- [ ] Both routing strategies implemented behind one interface and compared with
      numbers.
- [ ] **Online split executed under live writes** with **zero failed writes**,
      and a checksum diff proving `rows_before == rows_after`, zero lost/dupe.
- [ ] Resharder proven **resumable** (killed mid-backfill, resumes idempotently).
- [ ] Noisy-neighbor: whale at 10× does **not** breach other shards' SLO, with
      the isolation mechanism and before/after numbers shown.
- [ ] Fleet schema migration rolled across all shards with per-shard status and
      a documented mid-rollout-failure behavior.
- [ ] Findings note: shard-key choice defended, resharding plan defended, and a
      crisp statement of **when you would not shard** (and reach for Citus/Vitess
      or a bigger box instead).
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Citus / Vitess comparison:** run the same workload and the same split on
  Citus (distributed Postgres) and/or Vitess (sharded MySQL). Where do they beat
  your hand-rolled router, and what do they cost you in control or ops?
- **Whale sub-sharding:** for a tenant bigger than one shard, introduce a
  composite shard key (`tenant_id, bucket`) and route a single whale across
  shards while keeping the long tail on `tenant_id`. Measure the complexity tax.
- **Cross-shard saga:** implement one genuinely cross-shard operation as a saga
  with compensation + idempotency; show it converges and bound its window.
- **Read-replica blend:** add a replica per shard and route reads to it; measure
  replication lag's effect on read-your-writes and the throughput it buys.
- **Automatic rebalancing:** turn hot-shard detection into an automated split
  trigger with a safety budget (never split more than one shard at a time).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Shard-key choice | Picks a reasonable key | **Defends** it against the workload; names the query class it makes expensive and handles the whale-bigger-than-a-shard case |
| Routing layer | Routes correctly | Compares directory vs consistent-hash with numbers; routing survives an in-flight split |
| Online resharding | Can move data with a maintenance window | **Live split, zero downtime, zero lost/dupe under concurrent writes**, resumable; explains *why* the protocol is correct |
| Cross-shard queries | Knows fan-out is slow | Quantifies tail amplification; designs the live path to avoid it (rollup/async) |
| Distributed transactions | Avoids them | Designs the shard key so they don't exist; for the unavoidable case, states the exact guarantee shipped and why it's safe |
| Tenant isolation | Notices noisy neighbors | Bounds blast radius and **proves** other shards stay green under a 10× whale |
| Fleet migration | Migrates one DB | Expand/contract across N shards, handles mid-rollout failure |
| Judgment | Can shard | **Knows when NOT to** — reaches for Citus/Vitess/a bigger box first and says exactly where that stops being enough |
| Communication | Clear findings note | Could defend the shard key and the resharding plan to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 6 (Partitioning) & Ch. 7
  (Transactions): consistent hashing, rebalancing, range vs hash partitioning.
- Citus documentation — distributed tables, shard rebalancer, reference tables.
- Vitess documentation — VTGate routing, resharding (`MoveTables`,
  `SplitClone`), vindexes.
- `jackc/pgx` & `pgxpool` — per-shard pooling and connection budgeting.
- See also:
  - `Interview Question/05-postgresql-and-sql/` — indexing, vacuum, EXPLAIN,
    schema migration mechanics.
  - `Interview Question/13-distributed-systems/` — partitioning, consistency,
    2PC vs sagas, idempotency.
  - `Interview Question/22-scalability-and-high-availability/` — horizontal
    scaling, hot keys, blast-radius isolation.
  - `Interview Question/23-database-types-and-selection/` — when to shard vs
    replicate vs adopt Citus/Vitess.
