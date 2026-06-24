# Connection-Pool & Database-Saturation Lab

> A database doesn't fall over because it has too many rows — it falls over
> because it has too many *callers*. Drive thousands of concurrent clients at a
> Postgres with a fixed `max_connections`, find the knee where adding load stops
> adding throughput and starts subtracting it, and learn why the fix is almost
> never "raise the limit."

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Database performance under concurrency |
| **Skills exercised** | Connection pooling, Little's Law, pool sizing, PgBouncer (transaction vs session), lock contention, N+1, idle-in-transaction, Go (`jackc/pgx` pool), `pg_stat_activity` |
| **Interview sections** | 5 (PostgreSQL & SQL), 17 (performance), 22 (scalability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You run the API for a service whose Postgres is "fine" at 200 req/s and falls on
its face at 2,000. The on-call story is always the same: latency goes from 8 ms
to 4 s in under a minute, the app logs fill with `connection pool exhausted` and
`context deadline exceeded`, and someone proposes raising `max_connections` from
200 to 2,000. They do. It gets *worse*.

The database is not out of CPU, RAM, or disk. It is out of the thing nobody
sized: **concurrency**. The row count never changed. What changed is how many
clients are trying to be inside the database at the same instant.

Your job is to *characterize* a Postgres under concurrent load — find the
throughput knee and the cliff past it — then prove that a bounded pool plus
PgBouncer beats an unbounded free-for-all, and that the real killers (N+1, lock
contention, idle-in-transaction, reconnect storms) are application bugs the
database merely *reports*. You will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Find the **knee** (peak throughput) and the **cliff** (where p99 explodes and
  throughput *drops*) as offered concurrency climbs, for a fixed Postgres with
  bounded `max_connections`.
- Derive and validate the right pool size with **Little's Law**, and show
  empirically that more connections ≠ more throughput.
- Show what PgBouncer changes: run the same 5,000-client load with a small server
  pool behind transaction-mode pooling and measure the new ceiling.
- Reproduce and quantify the four canonical saturation modes: **N+1**, **lock
  contention**, **connection exhaustion**, **idle-in-transaction** leaks.

**Non-goals**
- Read replicas / sharding — that's the scalability lab. Here we saturate a
  *single* primary on purpose.
- Schema/index tuning for query plans — keep queries cheap so the bottleneck is
  concurrency, not a missing index (the indexing lab owns that).
- Managed Postgres (RDS). Run it yourself so you can set `max_connections`,
  `shared_buffers`, and watch `pg_stat_activity` directly.

## 3. Functional requirements

1. A **load driver** (`cmd/load`) opens a configurable number of concurrent Go
   workers, each running a closed- or open-model workload against the DB through
   a `pgx` pool, and reports throughput + p50/p99/p999 latency.
2. A small **API** (`cmd/api`) exposes representative endpoints so the load is
   realistic, not just `SELECT 1`:
   - `GET /order/{id}` — one order + its N line items (the **N+1 trap**: naive
     version issues 1 + N queries; batched version issues 1 or 2).
   - `POST /transfer` — debit one row, credit another inside a transaction
     (`SELECT ... FOR UPDATE`) — the **lock-contention** endpoint.
3. The pool is configurable by flag: `-pool-max`, `-pool-min`,
   `-conn-max-lifetime`, `-conn-max-idle-time`, and a toggle to route through
   **PgBouncer** vs direct-to-Postgres.
4. A **chaos hook** (`cmd/chaos`) can: open and abandon `idle in transaction`
   connections; bounce Postgres to trigger a **reconnect storm**; and inject a
   slow row lock to create a pile-up.

## 4. Load & data profile

- **Schema scale:** `accounts` (10M rows), `orders` (50M rows), `line_items`
  (~300M rows, ~6 per order). Big enough to be real, small enough that a single
  point-lookup is a few ms — concurrency, not data size, is the variable.
- **Concurrency sweep:** drive **1 → 50 → 200 → 1,000 → 5,000 → 10,000**
  concurrent clients. The interesting behavior lives past 200.
- **Postgres bound:** `max_connections = 200` (deliberately modest — a real
  8-core box). `shared_buffers = 25%` RAM. Pin the version (e.g. PG 16).
- **Hot-row distribution:** for `/transfer`, pick the credit account
  **Zipfian** (s≈1.1) over 10k accounts so a handful of rows become lock
  hotspots — this is what manufactures contention.
- **Traffic model:** support both **closed** (fixed in-flight clients, measure
  throughput) and **open** (fixed arrival rate, watch queue build) so you can see
  latency under coordinated omission honestly.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Point-lookup p99 (`GET /order/{id}`, below the knee) | < 10 ms |
| Throughput knee (direct, `max_connections=200`) | **Find & report** the client count where throughput peaks; name what bounds it (context-switch cost? lock waits? pool wait queue?) |
| Throughput past the cliff vs at the knee | Quantify the *drop* — peak throughput should be **measurably higher** than throughput at 10,000 clients, proving more callers = less work done |
| Pool-wait time at steady state (clients ≤ pool size) | ~0; pool acquire should not be the bottleneck below the knee |
| PgBouncer (transaction mode, 20-conn server pool) at 5,000 clients | Sustains throughput within ~10% of the knee where direct collapses; report the new p99 |
| N+1 vs batched (`/order`, 500 clients) | Batched ≥ **5×** the throughput of N+1; explain the round-trip math |
| Connection-exhaustion behavior | Pool returns a fast, bounded error (or queues with a deadline) — **never** an unbounded hang |
| Idle-in-transaction count under leak chaos | Detected via `pg_stat_activity`; show the throughput cliff it causes |

> The point is not to hit a magic number — it's to **find** your database's knee
> and the cliff past it, and to **explain** with `pg_stat_activity` and pool
> metrics *why* the curve bends where it does.

## 6. Architecture constraints & guidance

- Postgres + PgBouncer via `docker-compose`. Pin Postgres and PgBouncer versions.
  Constrain the Postgres container to a realistic core count (e.g. `cpus: 8`) so
  the `(2*cores)+effective_spindles` heuristic has meaning.
- Go client: **`jackc/pgx/v5`** with `pgxpool`. Set `MaxConns`/`MinConns`
  explicitly; do **not** rely on `database/sql` defaults. Know the difference
  between *pool acquire wait* and *query execution time* and measure both.
- Run PgBouncer in **transaction** pooling mode for the high-client experiments;
  also test **session** mode to feel why it can't help here.
- Instrument: app-side pool stats (`pool.Stat()` — acquired, idle, wait count,
  wait duration), server-side `pg_stat_activity` (state breakdown:
  `active` / `idle` / `idle in transaction`), `pg_stat_database` (xact commit,
  deadlocks), and per-request p50/p99/p999. Prometheus + a Grafana board.

## 7. Data model

```
accounts(id BIGINT PK, balance BIGINT, ...)                 -- 10M rows
orders(id BIGINT PK, account_id BIGINT FK, status TEXT, ...) -- 50M rows
line_items(id BIGINT PK, order_id BIGINT FK, sku TEXT, qty INT) -- ~300M rows
  INDEX line_items_order_id ON line_items(order_id)
```
The N+1 endpoint reads an order then loops `SELECT * FROM line_items WHERE
order_id = $1` per item; the batched endpoint does it in one
`WHERE order_id = ANY($1)` (or a `JOIN`). The `/transfer` endpoint runs
`BEGIN; SELECT balance FROM accounts WHERE id=$1 FOR UPDATE; ... ; COMMIT;` so
hot credit rows serialize.

## 8. Interface contract

- `GET /order/{id}` → `{ id, account_id, items:[...] }`. Flag `-n-plus-one=true|false`.
- `POST /transfer` → `{ from, to, amount }`; returns `200` or a typed
  `409 conflict` / `503 pool exhausted` — never a silent hang.
- `GET /metrics` → Prometheus exposition including pool acquire wait and
  `pg_stat_activity` state counts.
- Driver flags: `-clients`, `-model open|closed`, `-rate`, `-pool-max`,
  `-pool-min`, `-conn-max-lifetime`, `-pgbouncer=true|false`, `-mode lookup|transfer|order`.

## 9. Key technical challenges

- **Little's Law for pools.** Throughput = concurrency / latency, so the *useful*
  pool size is `L = throughput × latency`. A pool larger than what the DB can run
  in parallel just builds a queue inside Postgres instead of in your app — and an
  in-DB queue is far more expensive. You must derive the target size and then
  prove it.
- **The lock cliff.** Below `max_connections`, more workers help; above the
  number of CPUs that can *actually* make progress, added connections mostly
  contend for locks and the scheduler. Throughput goes flat, then *negative*.
  Reproduce it and show the `pg_stat_activity` `active` count stuck while
  throughput falls.
- **N+1 is a load amplifier.** One logical request becoming `1 + N` queries
  multiplies both round-trips and pool-holding time by N. At 6 line items that's
  ~6× the connection-occupancy per request — the pool exhausts at 1/6th the
  client count. The fix is batching, not a bigger pool.
- **Prepared statements vs transaction pooling.** PgBouncer in transaction mode
  hands you a *different* server connection per transaction, so server-side
  prepared statements (and `SET`, advisory locks, `LISTEN`) don't survive. Know
  why, and what `pgx`'s statement-cache / protocol-level prepare does about it.
- **Reconnect thundering herd.** After a blip, thousands of clients reconnect at
  once and slam `max_connections` + auth; the recovery is slower than the
  outage. Show it, then blunt it with bounded pools + jittered backoff.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (throughput, p50/p99/p999, pool wait, `active` vs
`idle in transaction` counts) for each:

1. **Knee-and-cliff sweep.** Direct to Postgres, `pool-max` ≥ clients. Sweep
   clients 1 → 10,000. Plot throughput and p99 vs concurrency. Mark the knee
   (peak throughput) and the cliff (where throughput *drops* and p99 explodes).
   Name the bottleneck with evidence.
2. **Pool-size sweep.** Fix 1,000 clients; sweep `pool-max` =
   8, 16, 32, 64, 128, 200. Find the pool size that maximizes throughput; show it
   matches your Little's-Law estimate, and that going past `~(2*cores)+spindles`
   *hurts*.
3. **PgBouncer on/off at high client count.** 5,000 clients, `pool-max` per app
   small. Direct (collapses) vs PgBouncer transaction-mode with a 20-conn server
   pool. Compare throughput, p99, and the `pg_stat_activity` active-connection
   count Postgres actually sees.
4. **N+1 vs batched under load.** `/order` at 500 clients, `-n-plus-one=true` vs
   `false`. Measure throughput, p99, queries/sec, and pool occupancy per request.
   Show the round-trip multiplication and the earlier pool exhaustion.
5. **Induced lock contention.** `/transfer` with Zipfian hot credit rows; sweep
   clients 50 → 2,000. Watch p99 blow up while throughput flattens; correlate
   with `pg_stat_activity` lock waits and `pg_stat_database.deadlocks`. Then
   reduce contention (shard the hot row / reorder lock acquisition) and re-measure.
6. **Connection exhaustion as a failure mode.** Set `pool-max` below offered
   concurrency with no acquire timeout, observe unbounded hangs; then add a
   bounded acquire deadline and a `503` and show the difference between *failing
   fast* and *falling over*.
7. **Idle-in-transaction leak.** Use chaos to open transactions and never commit.
   Show how a handful of leaked `idle in transaction` connections consume the
   pool/`max_connections` and crater throughput; detect them via
   `pg_stat_activity`; verify `idle_in_transaction_session_timeout` reclaims them.
8. **Reconnect storm.** Bounce Postgres mid-load; measure recovery time with naive
   reconnect-immediately vs jittered exponential backoff + bounded pool.

## 11. Milestones

1. Compose up Postgres + PgBouncer; schema + `cmd/gen` loading 10M/50M/300M rows;
   driver hitting `/order` and `/transfer`; Prometheus + Grafana board for
   throughput, p99, pool wait, and `pg_stat_activity` states.
2. Knee-and-cliff sweep (experiment 1); write down the bottleneck.
3. Pool-size sweep validated against Little's Law (experiment 2).
4. PgBouncer comparison + N+1 (experiments 3–4).
5. Contention, exhaustion, idle-in-tx, reconnect storm (experiments 5–8);
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Throughput-vs-concurrency curve with the **knee and the cliff** both
      marked, and the bottleneck **named and proven** (pool wait vs lock wait vs
      CPU, with `pg_stat_activity` / pool-stat evidence).
- [ ] Demonstrated that **more connections ≠ more throughput**: a pool sized at
      `~(2*cores)+spindles` beats a 1,000-conn pool, with the Little's-Law math
      written out.
- [ ] PgBouncer transaction-mode result: 5,000 clients sustained within ~10% of
      the knee where direct collapses; before/after `active`-connection count.
- [ ] N+1 vs batched: batched ≥ 5× throughput, with the query-count and pool-hold
      math.
- [ ] Connection exhaustion produces a **fast bounded error**, not a hang; show
      the code path and the latency histogram.
- [ ] Idle-in-transaction leak reproduced, detected via `pg_stat_activity`, and
      reclaimed via timeout — with the throughput dip and recovery shown.
- [ ] Findings note; every number reproducible from a committed command + config.

## 13. Stretch goals

- Add a **read replica** and route `/order` reads to it; measure how much primary
  pool pressure that removes (preview of the scalability lab).
- Compare `pgx` native pool vs `database/sql`+`pgx` stdlib pool vs PgBouncer —
  three pooling layers, where each helps and where they fight.
- Statement-cache experiment: server-side prepared statements direct vs
  transaction-mode PgBouncer; measure the prepare cost and protocol behavior.
- Implement a **bulkhead**: separate pools for `/order` (read) and `/transfer`
  (write) so a write lock pile-up can't starve reads; measure isolation.
- Replace the hot-row `FOR UPDATE` with an advisory-lock or queue-based design and
  re-measure the contention cliff.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Pool sizing | Picks a finite pool, not unlimited | Derives size from Little's Law; proves the optimum and that bigger hurts |
| Knee/cliff analysis | Reports peak throughput | Names and **proves** the bottleneck at the cliff; predicts the next one |
| PgBouncer | Knows transaction vs session mode | Measures the new ceiling; explains prepared-statement/session-state trade-offs |
| N+1 | Recognizes the pattern | Quantifies the round-trip & pool-occupancy amplification; fixes it with batching |
| Lock contention | Sees p99 rise under hot rows | Correlates with `pg_stat_activity`/deadlocks; mitigates and re-measures |
| Failure modes | Handles exhaustion without crashing | Fails fast with bounded deadlines; tames the reconnect storm with backoff + bounded pools |
| Communication | Clear findings note | Could defend every curve and the Little's-Law math to a staff panel |

## 15. References

- PostgreSQL docs: `max_connections`, `pg_stat_activity`,
  `idle_in_transaction_session_timeout`, explicit locking & `FOR UPDATE`.
- PgBouncer docs: transaction vs session vs statement pooling; `default_pool_size`.
- `jackc/pgx` & `pgxpool` docs: `MaxConns`, `MinConns`, `MaxConnLifetime`,
  acquire timeouts, statement cache behavior behind a pooler.
- The classic pool-sizing heuristic: `connections ≈ (2 × cores) + effective_spindles`
  (HikariCP's "About Pool Sizing"); reason from Little's Law, don't cargo-cult it.
- *Designing Data-Intensive Applications* — Ch. 7 (transactions, locking, isolation).
- See also: `Interview Question/05-postgresql-and-sql/` and
  `Interview Question/17-performance-engineering/`.
