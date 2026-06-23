---
layout: default
title: database/sql Pool — Professional
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/professional/
---

# database/sql Connection Pool — Professional Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Production Incident: The Slow Query That Took Down Everything](#production-incident-the-slow-query-that-took-down-everything)
3. [Diagnosing Pool Starvation in a Live System](#diagnosing-pool-starvation-in-a-live-system)
4. [Instrumenting Wait Time Properly](#instrumenting-wait-time-properly)
5. [Per-Route Connection Caps via Bulkheads](#per-route-connection-caps-via-bulkheads)
6. [Multi-Pool Architectures](#multi-pool-architectures)
7. [Sharding the Pool by Tenant](#sharding-the-pool-by-tenant)
8. [Pool Behind a Connection Pooler (PgBouncer, ProxySQL)](#pool-behind-a-connection-pooler-pgbouncer-proxysql)
9. [Graceful Shutdown of `*sql.DB`](#graceful-shutdown-of-sqldb)
10. [Handling Failover and Network Partitions](#handling-failover-and-network-partitions)
11. [Circuit Breaker Around the Pool](#circuit-breaker-around-the-pool)
12. [Pool Capacity Planning Worked Example](#pool-capacity-planning-worked-example)
13. [Observability Stack](#observability-stack)
14. [Common Anti-Patterns at Scale](#common-anti-patterns-at-scale)
15. [Summary](#summary)

---

## Introduction

> Focus: production diagnosis and design. You have read junior/middle/senior; you understand `(*DB).conn` line by line. Now: how do you keep this pool healthy under 10k qps, across deploys, failovers, and traffic spikes?

This file is about what happens after the code ships. Sections 2–4 are diagnostic patterns you apply when something is on fire. Sections 5–11 are architectural choices you make before the fire. Sections 12–14 are the connective tissue: planning, observability, the patterns that consistently bite teams.

Every section assumes a real production deployment: Go service, Postgres or MySQL, behind a load balancer, multiple instances, real metrics. Examples use Prometheus and pprof because they are universal.

---

## Production Incident: The Slow Query That Took Down Everything

A canonical story. The service has 4 instances, each with `MaxOpenConns=50`. Database has `max_connections=300`. Baseline traffic: 1000 qps with p99 = 10 ms. Steady-state pool usage: ~10 conns per instance.

On Tuesday at 14:00 a marketing campaign drives traffic to a new dashboard route. The dashboard runs a query that joins three tables without an index. The query takes 4 seconds.

What happens, minute by minute:

- **14:00.** 5 dashboard requests/sec start arriving. Each holds a conn for 4 s. Steady-state working set jumps to 5 × 4 = 20 conns just for the dashboard. Pool size 50 is still fine.
- **14:01.** Word spreads; 20 dashboard requests/sec. Working set = 80 conns. Exceeds `MaxOpenConns=50`. Goroutines start queueing on `connRequests`.
- **14:02.** As goroutines wait, request latency on *all* routes rises. Health-check requests (which run a quick `SELECT 1`) start timing out because they too queue. Load balancer marks instances unhealthy.
- **14:03.** Traffic redistributes to fewer instances. The healthy ones get more load. They saturate too.
- **14:05.** Cascading failure. All 4 instances unhealthy. Service is down.

Lessons:
- Slow queries × concurrency = pool exhaustion.
- Pool exhaustion makes health checks fail, which makes the load balancer punish the wrong instances.
- p99 of `db.Query` no longer reflects query speed; it reflects pool wait.

What the on-call engineer needs:
1. **A dashboard** that shows `db.Stats().InUse / MaxOpenConns` and `rate(db.Stats().WaitCount)`. Saturation visible at a glance.
2. **A pprof endpoint** with goroutine profile, so a stack dump immediately reveals what every conn is doing.
3. **A "blast radius" guarantee:** the dashboard's pool conns cannot exceed N, leaving (50-N) for the rest of the app.

Fix sequence:
1. **Containment.** Bulkhead the dashboard route to 5 in-flight requests (semaphore middleware). Now its pool consumption capped at 5 × 4 = 20 conns.
2. **Recovery.** Health-check route bypasses the pool entirely (`SELECT 1` via a dedicated `*sql.Conn` held for the life of the health-check goroutine).
3. **Fix.** Add the missing index.
4. **Postmortem.** Why didn't a load test catch this? Because load tests usually exercise one route at a time. Multi-route adversarial load testing should be added.

---

## Diagnosing Pool Starvation in a Live System

### Step 1: Confirm saturation

```
curl http://app/metrics | grep db_
```

You expect to see `db_in_use ≈ db_open_connections ≈ MaxOpenConns`, and `rate(db_wait_count_total[1m]) > 0`. If both: starvation confirmed. If only the first: high utilization, not yet starvation.

### Step 2: Find what is holding the conns

```
curl http://app/debug/pprof/goroutine?debug=2 > goroutines.txt
grep -c 'database/sql' goroutines.txt
```

The count tells you approximately how many goroutines are doing DB work. Then categorize:

```
grep -A 5 'database/sql.(\*DB).queryDC' goroutines.txt | sort | uniq -c | sort -rn
```

Each unique stack frame above `queryDC` is a different *caller*. You will see something like:
- 47 stacks in `handleDashboard` calling `db.QueryContext`
- 3 stacks in `handleHealthCheck`
- 1 stack in `handleAdmin`

Now you know: the dashboard is holding 47 of the 50 conns. From here you read the dashboard code and look at the SQL.

### Step 3: Cross-reference with the database

Postgres:
```sql
SELECT pid, state, wait_event, query_start, query
FROM pg_stat_activity
WHERE application_name LIKE 'myapp%'
ORDER BY query_start;
```

If you see 47 conns in `state=active` running the same `SELECT` for >1 second, the query is slow. If they're in `state=idle in transaction`, your code is forgetting to `Commit`/`Rollback`.

MySQL:
```sql
SELECT id, command, time, state, info
FROM information_schema.processlist
WHERE info IS NOT NULL
ORDER BY time DESC;
```

### Step 4: Trace one slow query

If you have a query of interest, run `EXPLAIN ANALYZE` on Postgres or `EXPLAIN FORMAT=JSON` on MySQL. Look for sequential scans, hash joins on the wrong side, missing indexes.

---

## Instrumenting Wait Time Properly

`db.Stats().WaitDuration` is *cumulative across all goroutines that ever waited*. To get a useful metric you compute the *rate*:

```promql
rate(db_wait_duration_seconds_total[1m]) / rate(db_wait_count_total[1m])
```

This is the average wait per waiting goroutine, per minute. Healthy: < 10 ms. Sick: > 100 ms.

For per-call attribution, the only honest path is wrapping the call:

```go
func WaitInstrumented[T any](ctx context.Context, db *sql.DB, fn func(ctx context.Context) (T, error)) (T, error) {
    before := db.Stats().WaitCount
    start := time.Now()
    var v T
    var err error
    done := make(chan struct{})
    go func() {
        v, err = fn(ctx)
        close(done)
    }()
    select {
    case <-done:
    case <-ctx.Done():
    }
    after := db.Stats().WaitCount
    if after > before {
        recordWaitedCall(time.Since(start))
    }
    return v, err
}
```

This is rough — `WaitCount` is shared, so under concurrency you may misattribute. The fundamental limitation: `database/sql` does not expose per-call wait. The only way to get truly per-call timing is wrap the conn acquisition itself, which requires forking the package (some teams do this).

---

## Per-Route Connection Caps via Bulkheads

The "bulkhead" pattern, named after ship compartments: one route's failure should not flood the rest.

```go
func Bulkhead(limit int) func(http.Handler) http.Handler {
    sem := make(chan struct{}, limit)
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            select {
            case sem <- struct{}{}:
            case <-r.Context().Done():
                http.Error(w, "context done", 499)
                return
            default:
                // already at cap — could 503, or also wait with timeout
                http.Error(w, "too many in flight", 503)
                return
            }
            defer func() { <-sem }()
            next.ServeHTTP(w, r)
        })
    }
}
```

Apply with:
```go
mux.Handle("/dashboard", Bulkhead(5)(dashboardHandler))
mux.Handle("/api/", Bulkhead(40)(apiHandler))
mux.Handle("/health", healthHandler) // no bulkhead
```

The math: if every dashboard request holds 1 conn for ≤ 4 s, capping in-flight at 5 caps pool usage at 5. Even if 1000 dashboard requests arrive in 1 s, 995 are rejected at the door before reaching the pool.

### Choosing the cap

- Total of all bulkhead caps ≤ `MaxOpenConns` minus reserved capacity.
- Reserved capacity: at least 1 conn for health, 1 for emergency admin.
- Per-route cap: `expected_qps × p99_latency × 1.5` (safety factor).

---

## Multi-Pool Architectures

### Reads vs writes

Most apps have many more reads than writes. Common pattern: one `*sql.DB` for the primary, another for a read replica:

```go
type Database struct {
    Primary *sql.DB
    Replica *sql.DB
}

func (d *Database) Read(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    return d.Replica.QueryContext(ctx, q, args...)
}

func (d *Database) Write(ctx context.Context, q string, args ...any) (sql.Result, error) {
    return d.Primary.ExecContext(ctx, q, args...)
}
```

Trade-off: read-after-write is no longer guaranteed (replication lag). Most apps tolerate this for most reads; route specific "must see my own writes" reads to the primary.

### Heavy vs light

```go
mainDB := openDB(); mainDB.SetMaxOpenConns(50)
reportsDB := openDB(); reportsDB.SetMaxOpenConns(5)  // capped
```

Reports cannot starve the main app. If a report is slow, only other reports queue.

### Background jobs

Background workers should have a separate `*sql.DB` from the request-serving path. A stuck background job cannot impact request latency.

---

## Sharding the Pool by Tenant

Multi-tenant SaaS: every customer has their own database (or own schema). Two options:

### Option A: One `*sql.DB` per tenant

```go
type Pools struct {
    mu    sync.RWMutex
    bymap map[TenantID]*sql.DB
}

func (p *Pools) Get(t TenantID) *sql.DB {
    p.mu.RLock()
    db, ok := p.bymap[t]
    p.mu.RUnlock()
    if ok {
        return db
    }
    p.mu.Lock()
    defer p.mu.Unlock()
    // double-check
    if db, ok := p.bymap[t]; ok {
        return db
    }
    db = openDB(t.DSN())
    db.SetMaxOpenConns(5)  // small per tenant
    p.bymap[t] = db
    return db
}
```

Pros: isolation. A slow tenant cannot starve others.
Cons: `numTenants × 5` conns total. With 1000 tenants that's 5000 conns — likely too many.

### Option B: One pool, route by SET

```go
func TenantConn(ctx context.Context, db *sql.DB, t TenantID) (*sql.Conn, error) {
    c, err := db.Conn(ctx)
    if err != nil {
        return nil, err
    }
    if _, err := c.ExecContext(ctx, "SET app.tenant_id = $1", t); err != nil {
        c.Close()
        return nil, err
    }
    return c, nil
}
```

Pros: bounded total conns.
Cons: forgetting to set tenant on a checked-out conn is a security bug (data leak across tenants). Must wrap *every* DB operation; type system can help (`type TenantConn struct { *sql.Conn; t TenantID }`).

### Option C: Connection pooler in front

PgBouncer in `transaction` mode multiplexes 10k client conns over 50 backend conns. Each tenant gets a Go-side conn (cheap); PgBouncer figures out the rest.

---

## Pool Behind a Connection Pooler (PgBouncer, ProxySQL)

### How it changes everything

When PgBouncer is between Go and Postgres in `transaction` pooling mode:

- A "conn" in Go's pool is actually a *PgBouncer client conn*, not a Postgres backend conn.
- PgBouncer holds 5–50 actual Postgres conns and assigns them per-transaction.
- This means **prepared statements break**: a stmt prepared on backend A isn't visible on backend B. Driver may get a "prepared statement not found" error on retry.

### What still works
- Plain `db.Query` / `db.Exec` (no prepared statements).
- Transactions, *as long as the transaction is entirely within one PgBouncer pool acquisition*.

### What breaks
- `db.PrepareContext` + reuse across calls. Caching at all.
- Session-level state (`SET LOCAL`, temp tables, advisory locks).

### Workarounds
- `prefer_simple_protocol=true` in pgx config: forces simple-query protocol, no implicit prepare.
- `pool_mode=session` in PgBouncer: one-to-one with backend, eliminates the issue but loses multiplexing.
- Use stored procedures for hot operations (server-side, no client-side prepare).

### Sizing
- Go side `MaxOpenConns`: as high as your app needs, say 200 per instance.
- PgBouncer `pool_size`: small, say 20 per instance.
- Postgres `max_connections`: covers PgBouncer × instances × pool_size + admin.

---

## Graceful Shutdown of `*sql.DB`

Naive shutdown:
```go
func main() {
    db, _ := sql.Open(...)
    defer db.Close()
    // ... serve ...
}
```

Problem: `db.Close()` closes all idle conns, but does not block until in-flight queries finish. If your HTTP server's `Shutdown` returned after stopping `Accept` but with handlers still in flight (drain phase), `db.Close()` happens too early.

Correct pattern:
```go
func main() {
    db, _ := sql.Open(...)
    srv := &http.Server{...}

    // shutdown signal
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
    <-sigs

    // 1. Stop accepting new requests, wait for in-flight to drain
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Printf("HTTP shutdown: %v", err)
    }

    // 2. Stop background jobs (they also use db)
    closeBackgroundJobs()

    // 3. Now safe to close the pool
    if err := db.Close(); err != nil {
        log.Printf("DB close: %v", err)
    }
}
```

If a transaction is open at shutdown time, `db.Close()` does not abort it — the conn closes only when the tx Commit/Rollback returns. So a goroutine holding a long tx will see its next `tx.Exec` return an error after `db.Close()`.

---

## Handling Failover and Network Partitions

Postgres failover (Patroni, RDS Multi-AZ, etc.) typically takes 10–60 s. During that window:

1. **Existing conns die.** TCP RST or silent timeout.
2. **New conns fail.** DNS still pointing at old primary, or new primary not yet promoted.
3. **Pool fills with bad conns.** Pool tries to hand them out, drivers return `ErrBadConn`, pool retries up to `maxBadConnRetries` (default 2).

What you should set:
- `ConnMaxLifetime ≤ DNS TTL`. So conns rotate when the load balancer changes.
- `IsValid()` support in driver (modern `pgx/stdlib` does). Avoids the retry storm.
- Application-level retry with exponential backoff for the "no available conn" / `connection refused` window.

What you should monitor:
- Sudden spike in `db_open_connections` failing to recover. Means conns die faster than they reopen.
- `rate(db_close_total{reason="bad_conn"}[1m])` > 0 sustained. Likely a routing issue.

---

## Circuit Breaker Around the Pool

Adapter pattern: wrap `*sql.DB` with a breaker that fails fast when the pool is sick.

```go
type BreakerDB struct {
    db       *sql.DB
    breaker  *gobreaker.CircuitBreaker
}

func (b *BreakerDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    v, err := b.breaker.Execute(func() (any, error) {
        return b.db.QueryContext(ctx, q, args...)
    })
    if err != nil {
        return nil, err
    }
    return v.(*sql.Rows), nil
}
```

The breaker opens when consecutive errors exceed a threshold; in the open state every call returns immediately with `breaker open` without touching the pool.

This protects:
- Pool from goroutines piling up during a Postgres outage.
- Upstream callers from waiting on hopeless queries.

It does not fix the underlying issue; it just bounds the blast.

---

## Pool Capacity Planning Worked Example

A worked example using real numbers.

**Service:** order-placement API. 1000 qps peak, 50 qps baseline.

**Per-request DB work:**
- 1 `SELECT user` (avg 1 ms, p99 5 ms).
- 1 `INSERT order` (avg 3 ms, p99 10 ms).
- 1 `UPDATE inventory` (avg 2 ms, p99 8 ms).

All three serialized within a transaction. Total per-request DB time: avg 6 ms, p99 23 ms.

**Instances:** 4.

**Per-instance qps:** 250 at peak, 12.5 at baseline.

**Steady-state concurrency per instance:** 250 × 0.006 = 1.5 conns.
**p99 concurrency per instance:** 250 × 0.023 = 5.75 conns.
**Burst factor (×2):** 11.5 conns.

**Recommended `MaxOpenConns` per instance:** 20 (round up + headroom).

**Database `max_connections`:** 4 × 20 + 50 (other clients) + 20 (admin) = 150.

**`MaxIdleConns`:** equal to `MaxOpenConns` (steady-load workload).

**`ConnMaxLifetime`:** 30 m (rotate behind load balancer).

**`ConnMaxIdleTime`:** 5 m (reap during baseline).

**Validation:** load-test at 1.5× peak (1500 qps). Observe `WaitCount` stays near zero. If it spikes, bump `MaxOpenConns` to 30; re-test.

---

## Observability Stack

### Metrics (Prometheus)

```go
var (
    poolStats = []*prometheus.Desc{
        prometheus.NewDesc("db_open", "open conns", []string{"db"}, nil),
        prometheus.NewDesc("db_in_use", "in-use conns", []string{"db"}, nil),
        prometheus.NewDesc("db_idle", "idle conns", []string{"db"}, nil),
        prometheus.NewDesc("db_wait_count", "wait events", []string{"db"}, nil),
        prometheus.NewDesc("db_wait_seconds", "wait seconds", []string{"db"}, nil),
        prometheus.NewDesc("db_closed_max_idle", "closed by max idle", []string{"db"}, nil),
        prometheus.NewDesc("db_closed_max_idle_time", "closed by max idle time", []string{"db"}, nil),
        prometheus.NewDesc("db_closed_max_lifetime", "closed by max lifetime", []string{"db"}, nil),
    }
)
```

### Dashboards

Four critical panels:
1. **Saturation:** `db_in_use / db_open` (instant) and `max over 1m`.
2. **Wait rate:** `rate(db_wait_count[1m])`. Spikes mean undersized pool.
3. **Wait latency:** `rate(db_wait_seconds[1m]) / rate(db_wait_count[1m])`.
4. **Conn churn:** all three `closed_*` rates stacked.

### Alerting

- **Critical:** `db_in_use == MaxOpenConns for 2m`. Pool starved.
- **Warning:** `rate(db_wait_count[5m]) > 1`. Pool too small or queries too slow.
- **Warning:** `rate(db_closed_bad_conn[5m]) > 0.1`. Network instability.

### Tracing

OpenTelemetry's `database/sql` instrumentation (otelsql) wraps every call with a span. The span captures:
- Query SQL (sanitized).
- Conn acquisition time.
- Driver execution time.

Use this to attribute slowness: is it pool wait, network round-trip, or query execution?

---

## Common Anti-Patterns at Scale

### Anti-pattern 1: One global `*sql.DB` for everything

Mixing reporting, request handling, and background jobs in one pool. Anything slow starves everything else. Solution: separate pools (see "Multi-Pool Architectures").

### Anti-pattern 2: Setting `MaxOpenConns` from `runtime.NumCPU()`

```go
db.SetMaxOpenConns(runtime.NumCPU() * 2)  // wrong
```

`NumCPU` has nothing to do with pool size. Pool size is determined by query latency × concurrency, not CPU count.

### Anti-pattern 3: Catch-all retry loop without backoff

```go
for {
    if _, err := db.Exec(...); err == nil {
        break
    }
    // BUG: tight loop on failed conn
}
```

When the pool is unhealthy, this floods it with retries. Use exponential backoff or, better, a circuit breaker.

### Anti-pattern 4: Holding a `*sql.Conn` for the request lifetime

```go
func handler(w, r) {
    c, _ := db.Conn(ctx)
    defer c.Close()
    // ... use c for everything ...
}
```

Effectively one-conn-per-request, pool size limits qps to `MaxOpenConns`. Use `*sql.DB` directly for stateless work.

### Anti-pattern 5: Polling `db.Stats()` from a hot path

Every call takes `db.mu`. Sample once per 100 ms in a background goroutine; store atomically.

### Anti-pattern 6: Trusting `defer rows.Close()` inside long loops

Defers accumulate. Either close manually or wrap the loop body in a function literal so each iteration's defer fires immediately.

### Anti-pattern 7: Tx with `context.Background()`

The tx cannot be aborted by shutdown. Pass a real ctx.

### Anti-pattern 8: Using `db.Stats().InUse` as a "current load" metric

`InUse` is sampled at one instant; it does not reflect the burst the next millisecond brings. Use it as one input to a sliding window, not as a hard threshold.

---

## Summary

At production scale, the pool's behavior shapes everything: latency, saturation, blast radius, deployability. The instruments are:

- **Sizing:** Little's Law for steady state, p99 latency × concurrency for tails, ×2 for bursts.
- **Bulkheading:** semaphore middleware to cap per-route in-flight; multi-pool for cross-concern isolation.
- **Lifetime / idle-time tuning:** lifetime shorter than LB connection TTL; idle-time long enough to keep working set warm.
- **Observability:** four metrics (saturation, wait rate, wait latency, churn), two alerts (saturated, wait spike), one dashboard.
- **Graceful shutdown:** stop accept → drain → close pool, in that order.
- **Failure handling:** circuit breaker around the pool, exponential backoff on transient errors, `IsValid()` to silently drop bad conns.

The pool itself is generic and platform-neutral; the production knobs you turn are mostly about *bounding worst case*. The defaults are sufficient for a hobby project; in production every limit matters.
