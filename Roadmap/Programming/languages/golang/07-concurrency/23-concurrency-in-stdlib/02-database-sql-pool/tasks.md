---
layout: default
title: database/sql Pool — Tasks
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/tasks/
---

# database/sql Connection Pool — Tasks

[← Back](../)

> Hands-on exercises. Each task has a goal, a starter snippet (where relevant), success criteria, and hints. Solutions are not given; the point is the discovery.

---

## Task 1 — Observe the pool with `DBStats` (junior)

**Goal.** Print pool stats while concurrent workers query the database.

**Setup.** Use a local Postgres (or SQLite via `modernc.org/sqlite` for the simplest path):

```go
db, _ := sql.Open("sqlite", "file:test.db?cache=shared")
db.SetMaxOpenConns(5)
db.SetMaxIdleConns(2)
```

**Steps:**
1. Spawn 20 goroutines, each repeatedly running `SELECT 1; sleep 100ms` for 10 seconds.
2. In a separate goroutine, every second print `db.Stats()`.

**Success.** You see `WaitCount` increment, `InUse == 5`, `Idle` fluctuate.

**Hint.** Use `time.Tick(time.Second)` for the stats printer. The wait happens inside `db.Query`.

---

## Task 2 — Force pool starvation (junior)

**Goal.** Reproduce a hung application due to undersized pool.

**Steps:**
1. Set `db.SetMaxOpenConns(1)`.
2. Spawn 10 goroutines, each running a 5-second `pg_sleep(5)` query.
3. Measure how long the program takes to complete (should be ~50 s).
4. Increase `MaxOpenConns` to 10. Re-measure (~5 s).

**Success.** You have wall-clock numbers that demonstrate the relationship between pool size and tail latency under load.

**Hint.** For SQLite use `SELECT randomblob(1000000)` in a loop to simulate slowness. For Postgres `SELECT pg_sleep(5)`.

---

## Task 3 — Detect a leaked `*sql.Rows` (junior)

**Goal.** Find and fix a conn leak.

**Starter:**
```go
func countUsers(db *sql.DB) (int, error) {
    rows, err := db.Query("SELECT id FROM users WHERE active = true")
    if err != nil {
        return 0, err
    }
    n := 0
    for rows.Next() {
        n++
    }
    return n, nil
}
```

**Steps:**
1. Call `countUsers` 100 times in a loop with `MaxOpenConns=5`.
2. Print `db.Stats().InUse` after each call.
3. Observe that `InUse` climbs to 5 and the program hangs.
4. Fix the function.

**Success.** After the fix, `InUse` returns to 0 after each call.

**Hint.** `rows.Close()` (or `for rows.Next() {}` to completion AND check `rows.Err()`).

---

## Task 4 — Measure pool wait time (middle)

**Goal.** Build a histogram of how long `db.Query` waits for a conn.

**Approach.**
1. Wrap `db.Query` with a function that:
   - Reads `db.Stats().WaitDuration` before and after.
   - Records the delta if it's positive.
2. Run a benchmark of 1000 queries with `MaxOpenConns=2` and concurrency 50.
3. Plot the histogram.

**Success.** You can show the p50/p99 of wait time and correlate it with pool size.

**Hint.** `WaitDuration` is cumulative across the whole pool; for per-call measurement you need to do `time.Now()` around the actual `db.Query` and approximate.

---

## Task 5 — Instrument `DBStats` to Prometheus (middle)

**Goal.** Build a `prometheus.Collector` that emits all `DBStats` fields.

**Starter (skeleton):**
```go
type dbCollector struct {
    db     *sql.DB
    open   *prometheus.Desc
    inUse  *prometheus.Desc
    // ...
}

func (c *dbCollector) Describe(ch chan<- *prometheus.Desc) { /* ... */ }
func (c *dbCollector) Collect(ch chan<- prometheus.Metric) {
    s := c.db.Stats()
    ch <- prometheus.MustNewConstMetric(c.open, prometheus.GaugeValue, float64(s.OpenConnections))
    // ...
}
```

**Steps:**
1. Define one `*prometheus.Desc` for each `DBStats` field.
2. Convert `WaitDuration` to seconds.
3. Register the collector with `prometheus.MustRegister`.
4. Scrape with `curl localhost:9100/metrics`.

**Success.** All 9 fields appear in `/metrics`.

**Hint.** The `WaitCount` and `*Closed` counters should be `CounterValue`; the rest are `GaugeValue`.

---

## Task 6 — Reproduce the long-tx starvation incident (middle)

**Goal.** Show how a forgotten `tx.Rollback()` leaks a conn for `ConnMaxLifetime`.

**Steps:**
1. Set `MaxOpenConns=2`, `ConnMaxLifetime=60s`.
2. Start a goroutine that calls `db.BeginTx(ctx)` but does NOT commit or rollback.
3. In the main goroutine, run normal queries.
4. Observe that one conn is permanently occupied, halving available capacity.
5. Add a `defer tx.Rollback()` (which is a no-op if already committed) to fix.

**Success.** Before the fix, `InUse` stays at 1+; after, returns to 0.

**Hint.** Use `runtime.SetFinalizer` to confirm the GC eventually reclaims the tx, but only after the goroutine holding it exits.

---

## Task 7 — Build a query with retry on bad-conn (middle)

**Goal.** Reproduce `driver.ErrBadConn` and observe the sql package's retry.

**Steps:**
1. Write a fake driver that returns `driver.ErrBadConn` on the first `ExecContext` of a conn (then succeeds).
2. Register it as `sql.Register("flaky", &flakyDriver{})`.
3. Open a `db := sql.Open("flaky", "")`.
4. Run `db.Exec("anything")`; observe it succeeds (retry on a fresh conn).

**Success.** You see two driver-level `Open()` calls for one `Exec()` from the user's perspective.

**Hint.** Implement `driver.Driver`, `driver.Conn` (`ExecContext`), `driver.Result` (`LastInsertId`, `RowsAffected`).

---

## Task 8 — Saturate the opener goroutine (middle)

**Goal.** Show that conns are not opened in parallel beyond `openerCh` buffer size.

**Steps:**
1. Set `MaxOpenConns=100`, `MaxIdleConns=0`.
2. From an empty pool, spawn 100 goroutines simultaneously calling `db.Query`.
3. Instrument the driver's `Open()` with a timestamp log.
4. Observe that opens happen one-at-a-time on the opener goroutine path (with some racing as initial calls dial directly).

**Success.** You have a log showing opens spaced by the dial latency, not parallel.

**Hint.** `database/sql/sql.go:1190` — the `connectionOpener` loop processes one open per iteration.

---

## Task 9 — Compare `ConnMaxLifetime` settings (senior)

**Goal.** Measure the cost of frequent conn rotation.

**Steps:**
1. Benchmark 10,000 small queries with:
   - `ConnMaxLifetime=0` (no rotation).
   - `ConnMaxLifetime=1s` (frequent rotation).
   - `ConnMaxLifetime=1m` (occasional).
2. Compare p50/p99 latency.

**Success.** You can quantify the dial latency overhead of frequent rotation (typically 0.5–5 ms per new conn).

**Hint.** Use `go test -bench` with `-benchtime=10s`.

---

## Task 10 — Test prepared-statement cache behavior (senior)

**Goal.** Show that `*sql.Stmt` re-prepares on a fresh conn.

**Starter:**
```go
stmt, _ := db.Prepare("SELECT 1")
defer stmt.Close()
for i := 0; i < 10; i++ {
    stmt.QueryContext(ctx)
}
```

**Steps:**
1. Set `MaxOpenConns=5`, `MaxIdleConns=5`.
2. Wrap the driver's `PrepareContext` with a counter.
3. Run the above with low concurrency; observe up to 5 `PrepareContext` calls total.
4. Set `MaxIdleConns=0`; observe 10 `PrepareContext` calls.

**Success.** You can explain the cache key (the `*driverConn` pointer) and why it's invalidated when the conn leaves the pool.

**Hint.** `database/sql/sql.go:2700` — `*Stmt.css` field.

---

## Task 11 — Race on `*sql.Rows.Next` (senior)

**Goal.** Trigger a race detector failure.

**Starter:**
```go
rows, _ := db.Query("SELECT id FROM big_table")
for i := 0; i < 4; i++ {
    go func() {
        for rows.Next() {
            var id int
            rows.Scan(&id)
        }
    }()
}
```

**Steps:**
1. Build with `go build -race`.
2. Run; observe race detector output pointing at `(*Rows).Next`.

**Success.** You can name the offending field (the row buffer in `*sql.Rows`).

**Hint.** Each goroutine reads the same `lastcols` field without synchronization.

---

## Task 12 — Implement per-route connection caps (senior)

**Goal.** Cap how many conns a given HTTP route can hold simultaneously.

**Design.** A middleware:
```go
sem := make(chan struct{}, 5) // per-route cap
http.Handle("/heavy", limitHandler(sem, heavyHandler))
```

The handler must acquire `sem` *before* calling `db.Query`, so a route running heavy queries doesn't starve all the others.

**Success.** Under load, requests to `/heavy` queue at the middleware, not inside the pool, leaving capacity for `/light`.

**Hint.** This is "bulkhead" pattern. Easier to reason about than per-route pools.

---

## Task 13 — Audit your app for ctx-less queries (senior)

**Goal.** Find every `db.Query(...)` (no context) and replace with `db.QueryContext(ctx, ...)`.

**Tool.** `go vet` does not catch this. Use `grep` + `gopls`:
```
git grep -nE '\.(Query|Exec|Prepare|Begin)\(' | grep -v Context
```

**Success.** Every call site uses the `Context` variant and threads a request-scoped ctx.

**Hint.** This is the single highest-impact safety fix you can make in most legacy Go SQL code.

---

## Task 14 — Build a leak-finder linter (staff)

**Goal.** Detect `db.Query`/`db.QueryContext` whose returned `*sql.Rows` does not have a corresponding `.Close()` in the same scope.

**Approach.** Use `go/analysis`:
```go
var Analyzer = &analysis.Analyzer{
    Name: "rowsleak",
    Doc:  "find *sql.Rows without Close",
    Run:  run,
}
```

In `run`, walk every CallExpr matching `(*database/sql.DB).Query` and check that the result is followed by a `Close()` call in the same function.

**Success.** Your analyzer flags Task 3's buggy version and passes the fixed version.

**Hint.** This is non-trivial. Start with the `nilness` analyzer source as a template.

---

## Task 15 — Production dashboard (staff)

**Goal.** Build a Grafana dashboard from the Task 5 collector.

**Panels:**
- "Pool Saturation" — `db_in_use / db_open_connections`.
- "Wait Rate" — `rate(db_wait_count_total[1m])`.
- "Wait Latency" — `rate(db_wait_duration_seconds_total[1m]) / rate(db_wait_count_total[1m])`.
- "Conn Churn" — sum of `rate(db_closed_total{reason=...}[1m])` per reason.
- "Open vs Max" — `db_open_connections` with annotation at configured `MaxOpenConns`.

**Success.** You can detect, from the dashboard alone, the difference between "pool too small" (high wait rate) and "queries too slow" (high InUse with low wait rate).

**Hint.** Wait latency is per-goroutine average; combine with `InUse` to see if it's contention or slow queries.
