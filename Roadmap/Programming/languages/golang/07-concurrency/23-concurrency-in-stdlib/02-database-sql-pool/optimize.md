---
layout: default
title: database/sql Pool — Optimize
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/optimize/
---

# database/sql Connection Pool — Optimize

[← Back](../)

> Tuning scenarios with measurable before/after expectations. Each scenario gives a workload, a default-settings baseline, the change, and how to verify.

---

## Scenario 1 — Sizing the pool to Little's Law

**Workload.** A backend service doing 2,000 qps of queries with p50 = 2 ms, p99 = 30 ms.

**Default-settings problem.** `MaxOpenConns` is unset (unlimited). On a traffic spike the pool grows to 5,000 conns, the Postgres backend's `max_connections=200` is exceeded, half the connect attempts fail.

**Little's Law analysis.**
- Steady-state concurrency = throughput × latency = 2000 × 0.002 = 4 conns at p50.
- p99 worst case = 2000 × 0.030 = 60 conns.
- Add ×2 burst factor: 120 conns.

**Setting.**
```go
db.SetMaxOpenConns(120)
db.SetMaxIdleConns(120)
```

**Expected gain.** Database stops rejecting connects. p99 query latency stable; small uptick in pool wait time but bounded.

**Verification.**
- `db.Stats().WaitCount` rate should be < 1% of query rate.
- `pg_stat_activity` count <= 120.
- p99 end-to-end latency unchanged or slightly lower (no failed connects to retry).

---

## Scenario 2 — `MaxIdleConns == MaxOpenConns` for steady traffic

**Workload.** 500 qps continuous, no burstiness.

**Default-settings problem.** `MaxIdleConns` defaults to 2. Most conns close immediately after use, requiring fresh handshakes on the next request. Each handshake costs ~3 ms on Postgres with TLS.

**Setting.**
```go
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(50)
```

**Expected gain.** p99 query latency drops by the handshake cost (3–5 ms). `db.Stats().MaxIdleClosed` drops to zero.

**Verification.**
- Run a benchmark of 10,000 sequential queries.
- Before: ~3.5 ms/query average.
- After: ~0.5 ms/query average.

---

## Scenario 3 — `ConnMaxLifetime` behind a TCP load balancer

**Workload.** A Postgres deployment behind HAProxy. HAProxy expires backend connections every 30 minutes for load redistribution.

**Default-settings problem.** Without `ConnMaxLifetime`, a Go pool conn stays open indefinitely. When HAProxy closes the backend side, the Go side does not notice until the next query — which then fails with `EOF`, the pool returns `ErrBadConn`, and one user-visible request retries. Multiplied by every "dormant" conn, you get a burst of failed retries every 30 m.

**Setting.**
```go
db.SetConnMaxLifetime(25 * time.Minute)  // shorter than HAProxy's 30
```

**Expected gain.** Conns are rotated proactively before HAProxy kills them. The `connectionCleaner` closes them at idle moments, not mid-query.

**Verification.**
- `db.Stats().MaxLifetimeClosed` grows steadily.
- Driver-level "unexpected EOF" errors drop to zero.

---

## Scenario 4 — `ConnMaxIdleTime` for memory pressure

**Workload.** A multi-tenant batch processor that hits 200 conns at peak but spends most of the day at 5 conns.

**Default-settings problem.** With only `MaxIdleConns=200`, the 200 conns sit idle, consuming ~10 MB RSS each on the Postgres side. Database memory budget blown.

**Setting.**
```go
db.SetMaxOpenConns(200)
db.SetMaxIdleConns(200)
db.SetConnMaxIdleTime(5 * time.Minute)  // reap unused conns
```

**Expected gain.** During the long quiet stretches the pool shrinks to ~5 conns. Peak capacity preserved.

**Verification.**
- `db.Stats().MaxIdleTimeClosed` rises whenever the pool was over-sized.
- `pg_stat_activity` count tracks actual demand, not historical peak.

---

## Scenario 5 — Per-route bulkhead

**Workload.** Two routes: `/fast` (1 ms queries, 1000 qps) and `/slow` (200 ms queries, 50 qps).

**Problem.** A burst of `/slow` requests (say 100 in flight) holds 100 conns. If `MaxOpenConns=100`, `/fast` is now blocked.

**Fix.** Bulkhead `/slow` with a semaphore:
```go
slowSem := make(chan struct{}, 20)  // cap /slow to 20 in-flight

func slowHandler(w http.ResponseWriter, r *http.Request) {
    select {
    case slowSem <- struct{}{}:
        defer func() { <-slowSem }()
    case <-r.Context().Done():
        return
    }
    // db.Query etc.
}
```

**Expected gain.** `/fast` always has at least 80 conns available regardless of `/slow` load. Tail latency of `/fast` decoupled from `/slow`.

**Verification.**
- Load test both routes simultaneously.
- Measure `/fast` p99 — should be < 5 ms regardless of `/slow` concurrency.

---

## Scenario 6 — Prepared statement caching for a hot query

**Workload.** A single `SELECT` accounting for 80% of queries.

**Default-settings problem.** `db.QueryContext(ctx, "SELECT ...")` reparses the SQL every call. Driver-level cost: parse + plan ~50 µs on top of the actual query.

**Setting.**
```go
stmt, err := db.PrepareContext(ctx, "SELECT col FROM t WHERE id = $1")
// keep stmt for the lifetime of the application
```

Make `stmt` a package-level variable; goroutine-safe.

**Expected gain.** Per-query overhead drops to 1–2 µs. For 80%-of-traffic query, that's a noticeable end-to-end improvement.

**Verification.**
- Benchmark: 100k QueryContext direct vs Prepared+Exec.
- pgx logs (if used) should show `Parse`/`Bind` instead of full re-parse.

**Trade-off.** Each `*sql.Stmt` caches one driver stmt *per conn*. If you have 100 conns and 50 stmts, the database holds 5000 prepared stmts. Some databases impose limits.

---

## Scenario 7 — `pgx` driver native pool vs `database/sql`

**Workload.** Sustained 10,000 qps Postgres.

**Trade-off.** `pgx`'s native pool (`pgxpool.Pool`) skips the `database/sql` layer entirely and can use Postgres protocol-level features (`Pipelined`, binary format throughout). At 10k qps the `database/sql` overhead (mutex contention, generic value coercion) can be measurable.

**Decision criteria.**
- `database/sql`: portable across drivers, integrates with libraries that expect `*sql.DB`.
- `pgxpool`: 10–30% faster on hot paths; loses driver portability.

**Verification.** Benchmark with `go test -bench` your actual queries. If `database/sql` is < 5% of total request time, don't bother switching.

---

## Scenario 8 — Removing the `defer rows.Close()` from the critical path

**Workload.** A query that always returns one row, in a hot path.

**Default code.**
```go
rows, _ := db.Query("SELECT v FROM t WHERE id = $1", id)
defer rows.Close()
if rows.Next() {
    rows.Scan(&v)
}
```

**Better code.**
```go
err := db.QueryRow("SELECT v FROM t WHERE id = $1", id).Scan(&v)
```

`QueryRow` returns a `*sql.Row` that auto-closes the underlying rows when `Scan` is called. One fewer defer in the hot path, slightly less allocation, and impossible to leak.

**Expected gain.** Small (~50 ns) but recurring on every call.

**Verification.** Benchmark `Query`+`Close` vs `QueryRow`+`Scan` over 1M iterations.

---

## Scenario 9 — Batch INSERT instead of one-at-a-time

**Workload.** Ingesting 100,000 rows.

**Slow code.**
```go
for _, r := range rows {
    db.Exec("INSERT INTO t (a, b) VALUES ($1, $2)", r.A, r.B)
}
```

100k round-trips, each ~0.5 ms, total 50 s.

**Fast code (multi-row VALUES).**
```go
const chunk = 1000
for i := 0; i < len(rows); i += chunk {
    end := i + chunk
    if end > len(rows) { end = len(rows) }
    var args []any
    var vals []string
    for j, r := range rows[i:end] {
        args = append(args, r.A, r.B)
        vals = append(vals, fmt.Sprintf("($%d, $%d)", 2*j+1, 2*j+2))
    }
    q := "INSERT INTO t (a, b) VALUES " + strings.Join(vals, ",")
    db.Exec(q, args...)
}
```

100 round-trips, total ~1 s.

**Fastest (Postgres COPY via pgx).**
```go
conn, _ := pool.Acquire(ctx)
defer conn.Release()
conn.Conn().CopyFrom(ctx, pgx.Identifier{"t"}, []string{"a", "b"}, src)
```

100 ms.

**Verification.** Wall clock on the ingest job.

---

## Scenario 10 — Avoiding pool starvation from a slow query

**Workload.** A reporting query that takes 30 s, deployed without an index.

**Symptom.** All 50 pool conns occupied by the reporting query for 30 s; every other request blocks.

**Quick fix.** Run reports on a separate `*sql.DB` with a small `MaxOpenConns`, so they can never starve the main pool.

```go
mainDB  := sql.Open("postgres", dsn);  mainDB.SetMaxOpenConns(50)
reportsDB := sql.Open("postgres", dsn); reportsDB.SetMaxOpenConns(5)
```

**Long fix.** Add the missing index.

**Verification.** Trigger 10 reports simultaneously; main-app p99 unchanged.

---

## Scenario 11 — `IsValid` to detect dead conns proactively

**Workload.** Service runs across a Postgres failover. After failover, every old conn is dead; the pool only learns when it hands one out.

**Without `Validator`.** First 50 requests after failover all hit `ErrBadConn`, each retried once. p99 latency spikes from 5 ms to ~3 s.

**With `Validator`.** Driver's `(c *conn).IsValid()` checks for a recent successful round-trip. Pool discards dead conns silently before reuse. No user-visible failure.

**How to verify your driver supports it.**
```go
var _ driver.Validator = (*pq.conn)(nil)
```

Compile-time assert. `pgx/stdlib` and modern drivers support it. Legacy `lib/pq` does not.

---

## Scenario 12 — Tuning `*sql.Stmt` cache hit rate

**Workload.** App uses `db.Prepare` for 20 statements, `MaxOpenConns=100`.

**Problem.** When a stmt is used, it must be (re)prepared on whichever conn the next call gets. With 100 conns and 20 stmts, total prepared stmts is up to 2000 server-side. Some configs limit prepared stmts to 1024 per session, others charge memory per stmt.

**Trade-off A.** Lower `MaxOpenConns` to reduce per-stmt fanout.
**Trade-off B.** Use `db.QueryContext` directly without `*sql.Stmt`; let the driver query-string cache (pgx does this transparently).
**Trade-off C.** Use server-side prepared stmts via the driver-specific protocol (Postgres `PREPARE` named) and route by name.

**Verification.** `pg_prepared_statements` count, memory per session.

---

## Scenario 13 — Reducing context-watcher goroutine churn

**Workload.** Very high qps, short ctx timeouts on every query.

**Detail.** For each query the package may spawn a small goroutine to watch `ctx.Done()` and cancel the in-flight driver call. At 50k qps that's 50k goroutines/sec churn — measurable in goroutine scheduling.

**Fix in Go 1.21+.** Modern drivers (pgx, mysql v1.7+) implement `QueryerContext` natively, so the package doesn't need the watcher. Verify with `go tool pprof -goroutine`.

**Verification.** Compare pprof goroutine count under load before and after a driver upgrade.

---

## Scenario 14 — `db.Conn(ctx)` for session pinning vs `Tx`

**Workload.** Operations that require multiple queries on the same Postgres session (advisory lock + queries while holding it).

**Pattern A (Tx).** Wrap everything in a single transaction. Holds a conn the whole time. Bad if the work is read-mostly: long open tx blocks vacuum.

**Pattern B (Conn).**
```go
c, _ := db.Conn(ctx)
defer c.Close()
c.ExecContext(ctx, "SELECT pg_advisory_lock(1)")
// ... many queries ...
c.ExecContext(ctx, "SELECT pg_advisory_unlock(1)")
```

Same conn, same session, no open transaction — vacuum can still progress.

**Verification.** Use `pg_stat_activity` to confirm `state = 'idle'` (not `idle in transaction`) between queries.

---

## Scenario 15 — Avoiding `db.Stats()` lock contention with a sampled gauge

**Workload.** Every request handler currently calls `db.Stats()` for a "saturation check."

**Cost.** Each call takes `db.mu`. Under high qps, this serializes with `(*DB).conn` and `(*DB).putConn`.

**Fix.** Sample once per 100 ms in a goroutine, store atomically:

```go
var inUse atomic.Int64
go func() {
    t := time.NewTicker(100 * time.Millisecond)
    for range t.C {
        inUse.Store(int64(db.Stats().InUse))
    }
}()
```

**Verification.** Profile shows `db.Stats` no longer in top of `pprof -mutex`.

---

## Scenario 16 — Benchmark template

Use this template to verify any of the above changes:

```go
func BenchmarkQuery(b *testing.B) {
    db := openTestDB()
    db.SetMaxOpenConns(50)
    db.SetMaxIdleConns(50)
    db.SetConnMaxLifetime(0)

    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            var n int
            db.QueryRow("SELECT 1").Scan(&n)
        }
    })
    b.ReportMetric(float64(db.Stats().WaitCount), "waits")
    b.ReportMetric(float64(db.Stats().WaitDuration.Nanoseconds()), "wait_ns")
}
```

Run with `go test -bench=. -benchtime=10s -cpu=1,4,16` to measure both single-thread and contended throughput. Always report `WaitCount` and `WaitDuration` alongside ns/op — they tell you whether the bottleneck is the pool or the query.
