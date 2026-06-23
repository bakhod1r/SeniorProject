---
layout: default
title: database/sql Connection Pool — Senior
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/senior/
---

# database/sql Connection Pool — Senior

[← Back](../)

---

## 1. Audience and scope

This page is for an engineer who already owns a Go service in production talking to PostgreSQL or MySQL, has seen the pool misbehave under load, and now needs to understand the internals well enough to:

- pick `MaxOpenConns`, `MaxIdleConns`, `ConnMaxLifetime`, and `ConnMaxIdleTime` from first principles instead of by copy-paste;
- reason about how a TCP load balancer, pgbouncer, or RDS Proxy interacts with `*sql.DB`;
- debug a frozen pool from goroutine dumps and `DBStats`;
- understand which driver contracts are concurrency-safe and which are not.

Everything below assumes Go 1.21+ and `database/sql` as it lives in the standard library at that version. Where line numbers are cited (`sql.go:NNNN`), they refer to the Go 1.22 source tree; numbers drift between releases but the structure is stable.

---

## 2. Anatomy of `*sql.DB` — what you are actually pooling

`*sql.DB` is not a connection. It is a struct (see `database/sql/sql.go`, type `DB`) that owns:

- `connector driver.Connector` — the factory that produces raw `driver.Conn` values.
- `freeConn []*driverConn` — the idle list, LIFO ordering.
- `connRequests map[uint64]chan connRequest` — waiters blocked on `db.conn(ctx, strategy)`.
- `numOpen int` — count of live conns (idle + in-use), bounded by `maxOpen`.
- `openerCh chan struct{}` — wakeup channel for the `connectionOpener` goroutine.
- `cleanerCh chan struct{}` — wakeup channel for the `connectionCleaner` goroutine.
- `maxLifetime time.Duration`, `maxIdleTime time.Duration`.

The pool is guarded by a single `db.mu sync.Mutex`. Every meaningful operation — acquiring a conn, returning one, opening a new one, closing an expired one — takes this mutex. Under high contention the mutex itself can become a bottleneck, and on a busy host you will see this as `runtime.semrelease` and `sync.(*Mutex).Lock` near the top of a CPU profile.

A `driverConn` wraps `driver.Conn` plus bookkeeping: `createdAt`, `returnedAt`, `inUse`, `dbmuClosed`, and a small per-conn stmt cache `openStmt map[*driverStmt]bool`. The stmt cache matters in Section 6.

The public methods `Query`, `Exec`, `QueryRow`, `Begin`, `Prepare`, `Conn` all funnel through `(*DB).conn(ctx, strategy)` (see `sql.go:1300+` in 1.22). The two strategies are:

```go
const (
    cachedOrNewConn  connReuseStrategy = iota
    alwaysNewConn
)
```

In practice every public call uses `cachedOrNewConn`, except retry paths after `driver.ErrBadConn`, which fall through to `alwaysNewConn`. We come back to `ErrBadConn` in Section 7.

---

## 3. Pool tuning under load

### 3.1 The four knobs

```go
db.SetMaxOpenConns(n)       // hard ceiling, default 0 == unlimited
db.SetMaxIdleConns(n)       // idle list size, default 2
db.SetConnMaxLifetime(d)    // absolute age before close, default 0 == forever
db.SetConnMaxIdleTime(d)    // idle age before close, default 0 == forever (1.15+)
```

Each of these is a write under `db.mu`. The first three reshape the pool synchronously; `ConnMaxIdleTime` only takes effect when the `connectionCleaner` runs.

### 3.2 Choosing `MaxOpenConns`

The naive answer "set it to the database's `max_connections`" is wrong. What you want is:

```
MaxOpenConns_per_pod = floor( (db_max_connections - reservations) / num_pods - headroom )
```

Where:

- `reservations` are the connections reserved for `superuser_reserved_connections` (Postgres) or for replication slots, monitoring agents, migrations, ad-hoc psql sessions.
- `num_pods` is the steady-state number of replicas of *all* services that talk to this database, not just yours.
- `headroom` accounts for HPA scale-up bursts and rolling deploys where briefly `num_pods + maxSurge` pods exist.

Concrete example. PostgreSQL primary with `max_connections = 500`. Reservations: 20 (superuser) + 10 (replication) + 20 (monitoring/migrations) = 50. Two services share this DB:

- `orders-api`: 8 replicas steady, `maxSurge: 25%` → up to 10 during deploy.
- `billing-worker`: 4 replicas steady, can scale to 12.

Worst-case pod count: 10 + 12 = 22.

Available conns: `500 - 50 = 450`. Per-pod budget: `450 / 22 ≈ 20`. Round down to give headroom: `MaxOpenConns = 15` per pod is safe; `MaxOpenConns = 25` will silently break during a deploy when the new replicas come up before the old ones drain.

### 3.3 Leaving headroom for replicas

If you also read from a hot standby with its own `*sql.DB`, that pool counts separately against the standby's `max_connections`. Don't share knobs between primary and replica pools. Typical pattern:

```go
type DBs struct {
    Primary *sql.DB
    Replica *sql.DB
}

func openDBs(cfg Config) (*DBs, error) {
    primary, err := sql.Open("pgx", cfg.PrimaryDSN)
    if err != nil { return nil, err }
    primary.SetMaxOpenConns(15)
    primary.SetMaxIdleConns(15)
    primary.SetConnMaxLifetime(30 * time.Minute)
    primary.SetConnMaxIdleTime(5 * time.Minute)

    replica, err := sql.Open("pgx", cfg.ReplicaDSN)
    if err != nil { primary.Close(); return nil, err }
    // Replica is typically read-heavy with cheaper queries → more conns OK.
    replica.SetMaxOpenConns(30)
    replica.SetMaxIdleConns(15)
    replica.SetConnMaxLifetime(30 * time.Minute)
    replica.SetConnMaxIdleTime(5 * time.Minute)

    return &DBs{Primary: primary, Replica: replica}, nil
}
```

Two anti-patterns here:

- Setting `MaxIdleConns > MaxOpenConns`. The library silently caps `MaxIdleConns` to `MaxOpenConns` (`sql.go:910`-ish), but it confuses readers.
- Setting `MaxIdleConns = 0`. Now every checkout incurs a TCP handshake + TLS + auth + `SET application_name = ...`. On a 5 ms RTT this is brutal under load.

### 3.4 The case for `MaxIdleConns == MaxOpenConns`

Common production setting for a write-heavy API:

```go
db.SetMaxOpenConns(15)
db.SetMaxIdleConns(15)
```

Rationale: idle conns are cheap on the client (a few KB and one fd each), expensive to recreate. If you have a ceiling of 15 conns anyway, there is no point in churning them when concurrency drops to 5. The only reason to keep `MaxIdleConns < MaxOpenConns` is when occasional bursts are far above the steady state and you want to free DB resources between bursts; in that case prefer `ConnMaxIdleTime` to let idles age out.

### 3.5 Sizing from concurrency, not from `max_connections`

A more honest framing: how many concurrent in-flight queries can a single pod produce? If your handler does at most one DB call per request, and you have 200 in-flight requests per pod (limited by `MaxConcurrentRequests` in your server or by a request semaphore), you need at most 200 conns. But typically you don't *want* 200; you want a queue. Setting `MaxOpenConns = 15` means request 16+ blocks on `db.conn` until an idle conn frees up.

This queueing is desirable: it back-pressures the DB. The signal you watch is `DBStats.WaitCount` and `DBStats.WaitDuration`. We use these in Section 13.

---

## 4. ConnMaxLifetime and the load-balancer trap

### 4.1 Why finite lifetimes exist

The original `database/sql` had no lifetime cap. A conn stayed alive until the driver returned `ErrBadConn` from some op. Three classes of bug pushed Go 1.6 to add `SetConnMaxLifetime`:

1. **DNS rebinding.** Your DSN points at `db.internal`. The IP behind it changes (DB failover, cloud migration). Without a lifetime cap, old conns happily continue talking to the old IP until they error out.
2. **Server-side timeouts.** MySQL's `wait_timeout` (default 28800 s) and Postgres's `idle_in_transaction_session_timeout` will sever conns asymmetrically — the server closes, the client doesn't notice until next write. Then the next query gets a stale conn, errors, retries; user latency spikes.
3. **TLS cert rotation.** Long-lived conns hold the original TLS session. Rotated CA → new conns work, old conns work too, but you cannot validate that rotation actually rolled out unless you cycle.

Recommended baseline: `ConnMaxLifetime = 30 * time.Minute`. Lower (5–15 min) if your DB is behind a load balancer that does connection draining.

### 4.2 The load-balancer trap

This is where seniors get burned. Two concrete scenarios:

**Scenario A — HAProxy in front of Postgres primaries with sticky routing.**

Suppose you run a HA Postgres setup behind HAProxy. HAProxy uses a TCP health check to decide which backend is "primary" and steers new TCP connections to it. Once a TCP connection is established, it stays bound to that backend for its lifetime — HAProxy is L4, it does not move bytes between backends. This is the "sticky routing" assumption.

If you set `ConnMaxLifetime = 5 * time.Minute`, every 5 minutes each Go pod tears down all its conns and opens fresh ones. Each fresh conn redoes the HAProxy ACL evaluation. During a failover, HAProxy may flip its idea of the primary, and now your Go pod opens new conns that go to the new primary — good. But during steady state, you are paying ~5 round-trips per minute per pod for nothing, just to reaffirm a routing decision that has not changed.

Worse: if HAProxy is in `leastconn` mode and you cycle all conns simultaneously, you can create a thundering herd on whichever backend currently has the fewest conns, swinging utilization.

**Scenario B — AWS RDS Proxy or pgbouncer in transaction-pool mode.**

RDS Proxy and pgbouncer transaction-pool break the "one client conn == one server backend" assumption. The proxy multiplexes many client conns onto a smaller server-side pool. From Go's perspective, the conn to the proxy is cheap and stateless; tearing it down and reopening it does not actually create a new backend conn on Postgres.

In this world a short `ConnMaxLifetime` is fine — even helpful — because the proxy absorbs the cost. But you must understand: features that depend on per-conn server state (session-level `SET`, `LISTEN/NOTIFY`, prepared statements, advisory locks) will silently break in transaction-pool mode, regardless of what Go does. We unpack this in Section 16.

**Scenario C — Kubernetes service with envoy / linkerd as a sidecar.**

Service mesh proxies do their own conn pooling and load balancing. A Go conn to the local sidecar is dirt cheap. But the mesh's connection limit is per-sidecar; if you have `MaxOpenConns = 50` and 100 pods, the sidecar's upstream may run out of conns to the DB regardless of what Go thinks. Diagnose by reading sidecar metrics, not just `DBStats`.

### 4.3 Recommended pairings

| Topology                                   | ConnMaxLifetime | Rationale                                      |
|--------------------------------------------|-----------------|------------------------------------------------|
| Direct to Postgres/MySQL primary           | 30 min          | Rotate slowly; catch failovers within minutes  |
| Behind L4 LB (HAProxy, NLB)                | 30–60 min       | Avoid churning sticky routing                  |
| Behind pgbouncer (session mode)            | 30 min          | bouncer holds server conn; client cycle cheap  |
| Behind pgbouncer (transaction mode)        | 5–10 min        | Cycle aggressively; no per-session state to lose |
| Behind RDS Proxy                           | 5 min           | AWS recommends this; conns are virtual         |
| Direct to a stateless DBaaS (Spanner-like) | 30–60 min       | Conns are RPC channels; rotate to refresh auth |

### 4.4 Reading ConnMaxLifetime from the source

```go
// sql.go, simplified:
func (db *DB) connectionCleanerRunLocked(d time.Duration) (time.Duration, []*driverConn) {
    var idleClosing int64
    var closing []*driverConn
    if db.maxLifetime > 0 {
        // walk freeConn, close any with createdAt+maxLifetime < now
    }
    if db.maxIdleTime > 0 {
        // walk freeConn, close any with returnedAt+maxIdleTime < now
    }
    return d, closing
}
```

The cleaner runs at most once per second (`d = minDuration(maxLifetime, maxIdleTime, defaultMaxIdleTime=1s)`). So if you set `ConnMaxLifetime = 100*time.Millisecond` thinking you'll get sub-second rotation, you won't. Conns get closed lazily on the next cleaner tick, or eagerly only when checked out by `db.conn`.

---

## 5. ConnMaxIdleTime vs ConnMaxLifetime — semantics

These two were often confused before Go 1.15. The distinction:

- `ConnMaxLifetime` is **absolute** age from `createdAt`. A conn used continuously is still closed at lifetime expiry.
- `ConnMaxIdleTime` is **relative** to `returnedAt`. A conn used continuously never accumulates idle time; only conns sitting in `freeConn` accumulate it.

Both are evaluated by the `connectionCleaner` goroutine. The cleaner sleeps `minDuration(maxLifetime, maxIdleTime)` between runs, with a 1-second minimum. On each run it walks `freeConn` and closes conns where:

```go
if db.maxLifetime > 0 && now.Sub(c.createdAt) >= db.maxLifetime {
    close it
} else if db.maxIdleTime > 0 && now.Sub(c.returnedAt) >= db.maxIdleTime {
    close it
}
```

Closure releases the conn from `numOpen`, which can satisfy a pending `connRequests` waiter, which in turn triggers the opener goroutine.

### 5.1 Interaction during cleanup

Say you set:

```go
db.SetMaxOpenConns(30)
db.SetMaxIdleConns(30)
db.SetConnMaxLifetime(30 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
```

Steady state: 30 idle conns, traffic is low. After 5 minutes of pure idleness, all 30 conns hit `maxIdleTime` simultaneously. The cleaner closes all 30 in one pass. The next request will incur 30 simultaneous TCP/TLS handshakes against the DB if traffic suddenly resumes — a self-induced cold-start spike.

Mitigations:

- Make `MaxIdleConns` smaller than `MaxOpenConns` for spiky workloads, so the herd-of-30 case shrinks to herd-of-N.
- Set `MaxIdleConns = MaxOpenConns` and live with the steady-state idle resource usage.
- Use a small `ConnMaxIdleTime` only when conns are *actually* expensive on the server side and idle conn cost matters more than latency.

### 5.2 The `ConnMaxIdleTime = 0` case

Default in Go before 1.15 and still common today: conns never age out for idleness, only for lifetime. This is the right default for a service whose load profile is consistent. Idle conns cost the DB a backend process (Postgres) or thread (MySQL); if you have 200 pods each holding 10 idle conns, that's 2000 idle backends. PostgreSQL each backend ≈ 5–10 MB shared memory, plus a OS thread. On a 16 GB DB, 2000 idle backends are ~20 GB — already over budget.

If you have many low-traffic pods, prefer aggressive `ConnMaxIdleTime` (1–2 minutes) and small `MaxIdleConns` (2–4). The trade is a few ms reconnect latency on the next request after idleness.

---

## 6. Transaction pinning hazards

### 6.1 What a `Tx` holds

`db.BeginTx(ctx, opts)` checks out a conn and binds it to a `*sql.Tx`. The conn is held until `tx.Commit()` or `tx.Rollback()`. While the conn is held, no other goroutine can use it.

```go
tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
if err != nil { return err }
defer tx.Rollback()

// All these calls run on the same underlying conn.
rows, _ := tx.QueryContext(ctx, "SELECT ...")
_, _ = tx.ExecContext(ctx, "UPDATE ...")
return tx.Commit()
```

If the transaction takes 30 seconds because someone added a `SELECT pg_sleep(30)` to an admin endpoint, that conn is pinned for 30 seconds. If `MaxOpenConns = 15` and 15 such tx land at once, the pool is fully starved for 30 seconds; the 16th `QueryContext` blocks on `db.conn` until a tx commits or its ctx expires.

### 6.2 Detecting pinning

Three signals:

1. `DBStats.InUse` near `MaxOpenConns` for sustained periods.
2. `DBStats.WaitCount` climbing faster than `DBStats.WaitDuration / avg_query_time` would predict.
3. In a goroutine dump, many goroutines parked in `database/sql.(*DB).conn` waiting on a `connRequest` channel receive (Section 14).

### 6.3 Separating fast and slow pools

A real architectural fix: split into two `*sql.DB` instances against the same database, with different DSNs (so PostgreSQL sees them as different `application_name`):

```go
fastDB, _ := sql.Open("pgx", "postgres://.../mydb?application_name=orders-fast")
fastDB.SetMaxOpenConns(15)
fastDB.SetMaxIdleConns(15)

slowDB, _ := sql.Open("pgx", "postgres://.../mydb?application_name=orders-slow")
slowDB.SetMaxOpenConns(3)   // small cap
slowDB.SetMaxIdleConns(3)
```

Route handlers:

- OLTP read/write (`<100 ms`) → `fastDB`.
- Reports, exports, batch deletes (`>1 s`) → `slowDB`.

The slow pool can starve itself without taking down the fast one. The fact that they share the database is fine — they just can't share the pool's checkout queue.

Bonus: separate `application_name` lets you `pg_stat_activity` and immediately see which workload owns a misbehaving backend.

### 6.4 Statement-level timeout as a circuit breaker

Independent of pool sizing, set per-statement timeouts at the DB level for the slow pool:

```go
// In the DSN or as the first statement after checkout:
slowDB.ExecContext(ctx, "SET statement_timeout = '30s'")
// But: SET is per-session. If the pool resets sessions (Section 8),
// this is reapplied on each checkout. With pgbouncer transaction mode,
// SET inside a tx is fine; outside a tx, it does not persist.
```

The safer pattern: pass a `context.WithTimeout` to every query and let `database/sql` cancel; combined with `statement_timeout` as a backstop in the DSN options (e.g. `options=-c%20statement_timeout%3D30000` in PG DSN).

---

## 7. Prepared statement caching across connections

### 7.1 The two flavors of "prepared"

`database/sql` distinguishes:

- `(*DB).Prepare(query)` returns a `*sql.Stmt` that is **multi-connection aware**. Internally it lazily prepares the statement on each conn it lands on.
- `(*Conn).Prepare(query)` or `(*Tx).Prepare(query)` returns a `*sql.Stmt` bound to a single conn or tx.

The former is what 99% of code uses. The complexity lives in `(*Stmt).connStmt(ctx, strategy)`.

### 7.2 `Stmt.css` — the per-conn cache

```go
// sql.go, simplified
type Stmt struct {
    db      *DB
    query   string
    mu      sync.Mutex
    closed  bool
    css     []connStmt   // cached per-conn driverStmts
    lastNumClosed uint64 // for stale-entry GC
}

type connStmt struct {
    dc  *driverConn
    ds  *driverStmt
}
```

When you call `stmt.QueryContext(ctx, args...)`:

1. The library asks `db.conn(ctx, cachedOrNewConn)` for a conn.
2. With `stmt.mu` held, it scans `stmt.css` for an entry whose `dc` matches the returned conn.
3. Cache hit → reuse the prepared statement on that conn.
4. Cache miss → call the driver's `Prepare(query)` on this conn, append a new `connStmt` to `css`.

So a single `*sql.Stmt` accumulates up to `MaxOpenConns` cached `driverStmt`s over time. Memory is bounded by the pool size, which is fine. Two consequences:

**Consequence 1: cold cache after pool churn.**

When `ConnMaxLifetime` expires conns, the corresponding `connStmt` entries become stale. They are pruned lazily via `lastNumClosed` tracking: `stmt.removeClosedStmtLocked()` runs when the cache is touched and notices the pool's `numClosed` has advanced. The driver-side prepared statement (e.g. PostgreSQL's `s_1234` handle) was freed automatically when its conn closed.

**Consequence 2: re-preparation hidden in the wire trace.**

If you `Wireshark` a connection during the first few seconds after a deploy, you will see a `PARSE` for the same SQL fired once per conn until the cache fills. This is not a bug, it is the design. For high-fanout queries (one stmt used from many conns simultaneously), this means N parses immediately after pool warmup.

### 7.3 Sharing `*sql.Stmt` across goroutines

`*sql.Stmt` is goroutine-safe. The internal `mu` protects `css` and `closed`. Multiple goroutines calling `stmt.QueryContext` in parallel will each pull their own conn from the pool and find or insert their own `css` entry.

This is the right pattern for hot queries:

```go
type Repository struct {
    db        *sql.DB
    selectByID *sql.Stmt
}

func NewRepository(db *sql.DB) (*Repository, error) {
    stmt, err := db.Prepare("SELECT id, name, email FROM users WHERE id = $1")
    if err != nil { return nil, err }
    return &Repository{db: db, selectByID: stmt}, nil
}

func (r *Repository) GetUser(ctx context.Context, id int64) (User, error) {
    var u User
    err := r.selectByID.QueryRowContext(ctx, id).Scan(&u.ID, &u.Name, &u.Email)
    return u, err
}
```

What you should *not* do:

- Re-prepare on every call (`db.Prepare(...)` inside the handler) — defeats the point.
- Forget `stmt.Close()` on shutdown — driver may leak server-side handles.
- Use `*sql.Stmt` returned by `tx.Prepare()` outside the tx — that stmt dies with the tx.

### 7.4 Re-preparation on conn reset

When the driver returns `driver.ErrBadConn` (Section 8), the library:

1. Closes the bad conn.
2. Removes the `connStmt` entry whose `dc` matched.
3. Retries once with `alwaysNewConn`, which goes through full prep flow on a fresh conn.

This retry is silent. Watch your DB logs to see "prepared statement does not exist" errors flapping if your driver and pool are misaligned — usually a sign that something else (pgbouncer transaction mode) is invalidating prepared statements out from under you.

### 7.5 `Stmt.connStmt` map guarded by `Stmt.mu`

The cache is a slice, not a map, despite the slug "stmt cache". The lookup is O(N) where N ≤ MaxOpenConns. For typical pool sizes (≤30) this is fine. For large pools (>100) and many distinct prepared stmts, the lookup cost shows up; this is one of several reasons to keep pool sizes modest.

The mutex is fine-grained enough that one stmt being repreped on conn A does not block another goroutine using the same stmt on conn B — they each take `stmt.mu` briefly to read/write `css`, then release before doing the per-conn IO.

---

## 8. Context cancellation semantics

### 8.1 The driver interface evolution

```go
// driver/driver.go
type Queryer interface {
    Query(query string, args []Value) (Rows, error)
}

type QueryerContext interface {
    QueryContext(ctx context.Context, query string, args []NamedValue) (Rows, error)
}
```

`Queryer` is the legacy interface. `QueryerContext` is the Go 1.8+ interface. Same pattern for `Execer`/`ExecerContext`, `Conn`/`ConnPrepareContext`, etc.

`database/sql` prefers the context-aware interface if the driver implements it. Otherwise it falls back, and **context cancellation is implemented by canceling the conn from a watchdog goroutine**, not by passing ctx to the driver.

### 8.2 The watchdog pattern

When the driver does not implement `QueryerContext`, the library wraps the call:

```go
// Simplified from sql.go ctxDriverQuery
func ctxDriverQuery(ctx context.Context, queryerCtx driver.QueryerContext, queryer driver.Queryer, query string, nvdargs []driver.NamedValue) (driver.Rows, error) {
    if queryerCtx != nil {
        return queryerCtx.QueryContext(ctx, query, nvdargs)
    }
    dargs, err := namedValueToValue(nvdargs)
    if err != nil { return nil, err }
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }
    return queryer.Query(query, dargs)
}
```

That is — for the legacy `Queryer` path, the library only checks ctx **before** dispatching. Once `queryer.Query` is in progress, ctx cancellation does not reach the driver. The watchdog will close the conn *if* the driver implements `driver.Pinger` and the lib decides to evict, but typically your in-flight `Query` runs to completion.

Modern drivers (`lib/pq`, `pgx/stdlib`, `mysql`) all implement `QueryerContext`. So the legacy path is mostly historical. The practical takeaway: when you `cancel()` a ctx mid-query against a modern driver, the driver sends a `CancelRequest` on Postgres or `KILL QUERY` on MySQL, and the in-flight query is aborted server-side. With legacy drivers, cancel is best-effort — the goroutine is unblocked, but the DB keeps chewing.

### 8.3 The "conn return" race

A subtle one. Consider:

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()

rows, err := db.QueryContext(ctx, "SELECT pg_sleep(5)")
// err is nil if the driver returned rows before the 100ms hit.
// But the conn is still executing pg_sleep.
defer rows.Close()
for rows.Next() { ... }
```

If `QueryContext` returned `rows` but the driver is still streaming, ctx cancellation triggers `rows.Close()` internally, which sends a Cancel to the DB. The conn is then handed back to the pool only after the driver acknowledges the cancel. For Postgres, this is usually fast (10s of ms) but not free.

Worse: with some drivers, a canceled rows-streaming query can leave the conn in a weird state and the driver returns `driver.ErrBadConn` on the next reset. The library handles this by closing the conn entirely. Your `WaitCount` ticks up. Pattern repeated under load = pool churn = latency.

### 8.4 Propagating ctx everywhere

Rule: every `Query`, `Exec`, `QueryRow`, `Begin`, `Prepare`, `Conn` call should be the `Context` variant. The bare versions exist for backward compatibility but throw away the request scope. A code-search invariant:

```bash
# Any of these in your code is suspicious:
grep -rn 'db\.\(Query\|Exec\|QueryRow\|Begin\|Prepare\)(' --include='*.go'
# vs. these are fine:
grep -rn 'db\.\(QueryContext\|ExecContext\|QueryRowContext\|BeginTx\|PrepareContext\)(' --include='*.go'
```

Add a linter (`sqlclosecheck` + a custom `analysistest`) to enforce this.

---

## 9. The "session reset" hook — `driver.SessionResetter`

Since Go 1.10, drivers can opt into a hook that fires when a conn is returned to the pool:

```go
// driver/driver.go
type SessionResetter interface {
    ResetSession(ctx context.Context) error
}
```

The library calls this on the conn after the user releases it (e.g., `rows.Close()`, `tx.Commit()`, `(*Conn).Close()`). If `ResetSession` returns `driver.ErrBadConn`, the conn is closed and removed from the pool; otherwise it is returned to `freeConn`.

For PostgreSQL drivers, `ResetSession` typically runs a `DISCARD ALL` or similar to drop session-level state: `SET`, prepared statements (in some configs), temporary tables, advisory locks. The exact behavior is driver-specific:

- `lib/pq` ResetSession: minimal; mostly just checks the conn is alive.
- `pgx/stdlib` ResetSession: runs `DEALLOCATE ALL` when configured; resets `SearchPath`, etc.
- `go-sql-driver/mysql` ResetSession: COM_RESET_CONNECTION wire command.

Why this matters at senior level:

### 9.1 The "session leak" bug

You acquire a conn via `db.Conn(ctx)`, do `SET statement_timeout = '60s'`, return the conn. Without `ResetSession`, that timeout sticks. Next time someone checks out the same conn, they get the 60s timeout — invisible session state leaking across requests.

`ResetSession` mitigates this **if the driver and configuration cooperate**. With pgx in default config, `DISCARD ALL` clears it. With lib/pq, it doesn't. With MySQL drivers and `COM_RESET_CONNECTION`, the wait_timeout etc. session vars reset to defaults.

### 9.2 The "ResetSession is async" subtlety

When the user code does `rows.Close()`, the library schedules the reset but the conn is not immediately returned to `freeConn`. The reset call may itself take time. From the user's perspective, the call returns instantly; from the pool's perspective, the conn is unavailable until reset completes. Under heavy churn this can manifest as `WaitCount` higher than expected.

### 9.3 Disabling ResetSession

Some drivers expose a flag to skip reset (e.g., for performance, when you trust your code not to leak state). Don't, unless you also disable `ConnMaxIdleTime` and ensure your code never SETs a session var.

---

## 10. Per-route concurrency caps — sempahores in front of DB

### 10.1 The "noisy neighbor" problem

Your service has 50 routes. 49 are well-behaved `O(1)` queries. One — `GET /reports/full-export` — does `SELECT * FROM events WHERE ... ORDER BY ts` over 10M rows. A user discovers it and curls it 200 times in parallel.

Without per-route caps, those 200 requests grab up to `MaxOpenConns = 30` conns, pin them for minutes streaming rows, and every other endpoint stalls.

### 10.2 Implementation

```go
type SemaphoreMiddleware struct {
    sem chan struct{}
}

func NewSemaphore(n int) *SemaphoreMiddleware {
    return &SemaphoreMiddleware{sem: make(chan struct{}, n)}
}

func (s *SemaphoreMiddleware) Wrap(h http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        select {
        case s.sem <- struct{}{}:
            defer func() { <-s.sem }()
            h(w, r)
        case <-r.Context().Done():
            http.Error(w, "timeout", http.StatusServiceUnavailable)
        }
    }
}
```

Routing:

```go
mux := http.NewServeMux()
mux.HandleFunc("/users/", usersHandler)                       // unbounded
mux.Handle("/reports/full-export", NewSemaphore(3).Wrap(reportExportHandler))
```

Now the export route can hold at most 3 conns; the other 27 are protected.

### 10.3 Why not just use the DB pool as the queue?

Two reasons:

- **Visibility.** Per-route counters give per-route SLOs. `DBStats.WaitCount` is aggregate.
- **Fairness.** The pool's `connRequests` queue is FIFO; a flood of export requests will block well-behaved ones. A semaphore in front of the noisy route is admission control.

### 10.4 Token bucket vs semaphore

Semaphore = "max N in flight". Token bucket = "max N per second". For DB-bound endpoints, the in-flight model is usually what you want: queries take variable time, you care about concurrency, not rate.

---

## 11. Common race conditions and undefined behavior

This section enumerates patterns that look benign and aren't.

### 11.1 `rows.Close()` after `rows.Next()` returns false

Idiomatic:

```go
rows, err := db.QueryContext(ctx, "SELECT id FROM users")
if err != nil { return err }
defer rows.Close()
for rows.Next() {
    var id int64
    if err := rows.Scan(&id); err != nil { return err }
    process(id)
}
return rows.Err()
```

When `rows.Next()` returns false (no more rows), `database/sql` internally closes the rows and returns the conn to the pool. The `defer rows.Close()` is then a no-op. This is fine and is **the** correct pattern.

### 11.2 Partial scan — leaking the conn

```go
rows, _ := db.QueryContext(ctx, "SELECT id FROM users")
defer rows.Close()
for rows.Next() {
    var id int64
    rows.Scan(&id)
    if id == 42 {
        return // forgot to drain rows
    }
}
```

The `defer rows.Close()` does its job — it closes rows, returns conn. So *with* the defer, no leak. The trap is when you forget the defer:

```go
rows, _ := db.QueryContext(ctx, "SELECT id FROM users")
// no defer
for rows.Next() {
    if cond { return nil }  // rows leaks; conn pinned until GC finalizer runs.
}
return rows.Err()
```

`sql.Rows` has a finalizer that closes the rows when GC reaps it, so the conn comes back eventually. But "eventually" means a full GC cycle, during which the conn is unavailable. Add `sqlclosecheck` to CI to catch this statically.

### 11.3 Concurrent `(*Rows).Next` on the same `Rows` — data race

`*sql.Rows` is not safe for concurrent use. Calling `rows.Next()` from two goroutines on the same `*Rows` is a data race. The race detector flags it; without `-race` you might see corrupted scans or panics.

If you want fan-out processing of rows, read serially in one goroutine and dispatch to workers:

```go
type Job struct{ ID int64 }

func dispatch(ctx context.Context, db *sql.DB, jobs chan<- Job) error {
    rows, err := db.QueryContext(ctx, "SELECT id FROM tasks WHERE status='pending'")
    if err != nil { return err }
    defer rows.Close()
    for rows.Next() {
        var j Job
        if err := rows.Scan(&j.ID); err != nil { return err }
        select {
        case jobs <- j:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return rows.Err()
}
```

### 11.4 Using `*sql.Conn` from multiple goroutines — data race

```go
conn, err := db.Conn(ctx)
if err != nil { return err }
defer conn.Close()

go func() { conn.ExecContext(ctx, "SET ...") }()
go func() { conn.QueryContext(ctx, "SELECT ...") }()
// Race. Driver.Conn is single-threaded; pool returns one conn,
// the library does not arbitrate.
```

A `*sql.Conn` is single-conn handle; the underlying `driver.Conn` is single-threaded. Using it from multiple goroutines is undefined.

`*sql.DB` is the goroutine-safe thing. `*sql.Conn` is for pinning a single conn for session state (`SET`, advisory locks). Always use it from one goroutine at a time.

### 11.5 Closing a `Tx` with pending `Rows`

```go
tx, _ := db.BeginTx(ctx, nil)
rows, _ := tx.QueryContext(ctx, "SELECT id FROM users")
tx.Commit() // What happens to rows?
```

Per the docs and the implementation: `tx.Commit()` while rows are pending is undefined. In practice with most drivers it returns an error (`commit unexpectedly resulted in rollback` or `another command is already in progress`). Always exhaust or close rows before committing:

```go
tx, _ := db.BeginTx(ctx, nil)
defer tx.Rollback()
rows, _ := tx.QueryContext(ctx, "SELECT id FROM users")
for rows.Next() { ... }
rows.Close()
return tx.Commit()
```

### 11.6 Holding `*sql.Stmt` past `tx.Commit()`

```go
tx, _ := db.BeginTx(ctx, nil)
stmt, _ := tx.PrepareContext(ctx, "SELECT ...")
tx.Commit()
stmt.QueryContext(ctx, ...) // undefined; stmt is closed.
```

Stmts from `tx.Prepare` die with the tx. If you need a long-lived stmt, prepare it on the DB.

### 11.7 The `QueryRow` + `Scan` deferred error

`db.QueryRowContext(...).Scan(...)` returns an error from either `Query` or `Scan`. There is no separate error path. If the `Query` itself failed (bad SQL, conn died), the error is reported only when you call `Scan`. Don't:

```go
row := db.QueryRowContext(ctx, "SELECT bogus")
// no Scan ever called
// The error is silently dropped; conn may be in bad state.
```

Always call `Scan`. If you don't care about the result, scan into `_`:

```go
var dummy int
_ = db.QueryRowContext(ctx, "SELECT 1").Scan(&dummy)
```

---

## 12. Driver concurrency contracts

The `database/sql/driver` package defines the contract every driver must honor and the contract the library may assume. Worth memorizing because misalignment shows up as ugly bugs.

### 12.1 `driver.Conn` — single-threaded

`driver.Conn` has no concurrency expectations. The library serializes all access. A driver that internally launches goroutines (e.g., pgx's IO loop) is responsible for its own internal sync, but from the library's view, only one method is called at a time.

### 12.2 `driver.Stmt` — single-threaded with its conn

`driver.Stmt` is tied to a specific `driver.Conn`. While the stmt is executing (`Exec`, `Query`), no other method on the same conn may be called. The library enforces this by holding `dc.Lock()` for the duration of the call.

### 12.3 `driver.Result` — independent of the conn

`driver.Result` is the (RowsAffected, LastInsertId) thing. Once `Exec` returns it, the conn is released back to the pool. But `Result.RowsAffected()` may be called later, possibly while another goroutine is using the same conn. The contract: `Result` must not refer to live conn state; it should be a value type. Most drivers implement Result as a struct of two int64s, so this is fine.

The library does *not* protect Result methods. If a driver implementer makes Result hold a pointer back to the conn, they will see races.

### 12.4 `driver.Rows` — single-threaded

While a `driver.Rows` is alive, the conn is pinned to it. No other op on the conn can run. The library tracks this by setting `dc.ci` (driver.Conn) to "in use by rows" state. After `rows.Close()`, the conn becomes reusable.

This is why `for rows.Next() { db.ExecContext(...) }` is dangerous: the outer rows is using the conn, and `db.ExecContext` will pull a different conn. You end up with two conns in flight per request, which can starve the pool.

The pattern to avoid:

```go
rows, _ := db.QueryContext(ctx, "SELECT id FROM users")
for rows.Next() {
    var id int64
    rows.Scan(&id)
    db.ExecContext(ctx, "UPDATE users SET visited_at = NOW() WHERE id = $1", id)
    // ^ second conn checked out per iteration.
}
```

Fix: batch the IDs, then issue one update. Or use a transaction with `SELECT ... FOR UPDATE` and update inside the same tx.

### 12.5 `driver.NamedValueChecker`

Optional driver interface. If a driver implements it, the library defers value validation to the driver. Used by `pgx` to support typed `time.Time`, `[]byte`, `pgtype.Numeric`, etc. without forcing the library into a switch ladder.

Why this matters: when you pass an `int64` to a Postgres `numeric` column, the driver's `CheckNamedValue` may reject it or coerce it; the library has no opinion. So a behavior diff between drivers is normal and expected.

---

## 13. Pool starvation patterns

### 13.1 N+1 explosion

Common in ORMs and in hand-rolled code with `for rows.Next() { fetch related }`:

```go
rows, _ := db.QueryContext(ctx, "SELECT id FROM posts WHERE author_id = $1", author)
for rows.Next() {
    var id int64
    rows.Scan(&id)
    var commentCount int
    db.QueryRowContext(ctx, "SELECT COUNT(*) FROM comments WHERE post_id = $1", id).Scan(&commentCount)
    // ^ checks out a second conn per iteration. With 50 posts and 30 conns,
    //   the inner query queues frequently.
}
```

Two costs:

- The outer rows pins conn A while the inner query needs conn B. Double conn occupancy.
- Latency multiplies: 50 sequential queries instead of 1 join or 1 batched lookup.

Detection: in your trace spans, an outer Query with 50 inner Queries nested. In `DBStats`, `WaitCount` climbs whenever this code path runs.

Fix: rewrite as a join or as a batched lookup with `IN ($1, $2, ...)` or a `WITH` CTE.

### 13.2 The "fan out without bounded concurrency" trap

```go
ids := loadIDs()
var wg sync.WaitGroup
for _, id := range ids {
    wg.Add(1)
    go func(id int64) {
        defer wg.Done()
        db.QueryRowContext(ctx, "SELECT ... WHERE id = $1", id).Scan(...)
    }(id)
}
wg.Wait()
```

If `len(ids) = 1000` and `MaxOpenConns = 15`, you create 1000 goroutines each waiting on `db.conn`. `connRequests` map balloons. Memory usage spikes (each goroutine ≈ 8 KB stack); pool is saturated; latency for everyone tanks.

Fix: bounded concurrency with errgroup + semaphore:

```go
g, gctx := errgroup.WithContext(ctx)
sem := make(chan struct{}, 10) // at most 10 outstanding queries
for _, id := range ids {
    id := id
    sem <- struct{}{}
    g.Go(func() error {
        defer func() { <-sem }()
        // ... query using gctx
        return nil
    })
}
return g.Wait()
```

### 13.3 Detection via `DBStats`

```go
type DBStats struct {
    MaxOpenConnections int   // configured
    OpenConnections    int   // current
    InUse              int   // checked out
    Idle               int   // in freeConn
    WaitCount          int64 // total waits since DB open
    WaitDuration       time.Duration // total wait time
    MaxIdleClosed      int64 // closed due to SetMaxIdleConns
    MaxIdleTimeClosed  int64 // closed due to SetConnMaxIdleTime
    MaxLifetimeClosed  int64 // closed due to SetConnMaxLifetime
}
```

What to alert on:

- `WaitCount` rate > 0 sustained for >1 minute. Means pool is saturated.
- `WaitDuration / WaitCount` (average wait) > your p99 query time. Means queueing dominates.
- `InUse / MaxOpenConnections > 0.8` sustained. Means imminent saturation.
- `MaxLifetimeClosed` rate sudden spike. Means deploy or LB event cycled conns en masse.

### 13.4 The "rate of WaitCount" example

`WaitCount` is a monotonic counter. Compute rate by sampling:

```go
type poolWatcher struct {
    db   *sql.DB
    prev sql.DBStats
}

func (p *poolWatcher) tick() {
    cur := p.db.Stats()
    waitDelta := cur.WaitCount - p.prev.WaitCount
    waitDurDelta := cur.WaitDuration - p.prev.WaitDuration
    fmt.Printf("waits=%d avg_wait=%v in_use=%d/%d\n",
        waitDelta,
        durationOrZero(waitDelta, waitDurDelta),
        cur.InUse, cur.MaxOpenConnections,
    )
    p.prev = cur
}

func durationOrZero(n int64, d time.Duration) time.Duration {
    if n == 0 { return 0 }
    return d / time.Duration(n)
}
```

Sample every 5 seconds. Above 100 waits / 5s on a 30-conn pool is a red flag.

---

## 14. Building Prometheus metrics from DBStats

The standard pattern: a goroutine that publishes `DBStats` as Prometheus gauges and counters.

```go
package dbmetrics

import (
    "context"
    "database/sql"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

type Collector struct {
    db   *sql.DB
    name string

    openConns       prometheus.Gauge
    inUseConns      prometheus.Gauge
    idleConns       prometheus.Gauge
    maxOpenConns    prometheus.Gauge
    waitCount       prometheus.Counter
    waitDuration    prometheus.Counter
    maxIdleClosed   prometheus.Counter
    maxLifeClosed   prometheus.Counter
    maxIdleTimeClosed prometheus.Counter
}

func New(db *sql.DB, name string, reg prometheus.Registerer) *Collector {
    labels := prometheus.Labels{"db": name}
    c := &Collector{
        db:   db,
        name: name,
        openConns: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "db_open_connections", ConstLabels: labels,
        }),
        inUseConns: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "db_in_use_connections", ConstLabels: labels,
        }),
        idleConns: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "db_idle_connections", ConstLabels: labels,
        }),
        maxOpenConns: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "db_max_open_connections", ConstLabels: labels,
        }),
        waitCount: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "db_wait_count_total", ConstLabels: labels,
        }),
        waitDuration: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "db_wait_duration_seconds_total", ConstLabels: labels,
        }),
        maxIdleClosed: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "db_max_idle_closed_total", ConstLabels: labels,
        }),
        maxLifeClosed: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "db_max_lifetime_closed_total", ConstLabels: labels,
        }),
        maxIdleTimeClosed: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "db_max_idle_time_closed_total", ConstLabels: labels,
        }),
    }
    reg.MustRegister(c.openConns, c.inUseConns, c.idleConns, c.maxOpenConns,
        c.waitCount, c.waitDuration,
        c.maxIdleClosed, c.maxLifeClosed, c.maxIdleTimeClosed)
    return c
}

func (c *Collector) Run(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    var prev sql.DBStats
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s := c.db.Stats()
            c.openConns.Set(float64(s.OpenConnections))
            c.inUseConns.Set(float64(s.InUse))
            c.idleConns.Set(float64(s.Idle))
            c.maxOpenConns.Set(float64(s.MaxOpenConnections))
            c.waitCount.Add(float64(s.WaitCount - prev.WaitCount))
            c.waitDuration.Add((s.WaitDuration - prev.WaitDuration).Seconds())
            c.maxIdleClosed.Add(float64(s.MaxIdleClosed - prev.MaxIdleClosed))
            c.maxLifeClosed.Add(float64(s.MaxLifetimeClosed - prev.MaxLifetimeClosed))
            c.maxIdleTimeClosed.Add(float64(s.MaxIdleTimeClosed - prev.MaxIdleTimeClosed))
            prev = s
        }
    }
}
```

Use a 5–10 second tick. The counters are delta-applied because Prometheus counters are monotonic and `DBStats.WaitCount` is also monotonic — feeding the absolute value would work but loses precision on restarts; feeding deltas is what we want.

Alerting rules in Prometheus (PromQL):

```yaml
- alert: DBPoolWaitsHigh
  expr: rate(db_wait_count_total[5m]) > 10
  for: 5m
  labels: {severity: warning}
  annotations:
    summary: "DB pool waits sustained >10/s on {{$labels.db}}"

- alert: DBPoolNearSaturation
  expr: db_in_use_connections / db_max_open_connections > 0.8
  for: 3m

- alert: DBConnsChurning
  expr: rate(db_max_lifetime_closed_total[5m]) > 1
  for: 10m
  annotations:
    summary: "Pool churning on {{$labels.db}}"
```

---

## 15. Reading goroutine profiles for pool issues

When you do `curl localhost:6060/debug/pprof/goroutine?debug=2` on a frozen pod, the goroutine dump tells you where things are stuck. Pool-related stalls have a signature.

### 15.1 Waiting for a free conn

```
goroutine 4242 [select, 3 minutes]:
database/sql.(*DB).conn(0xc0001234, {0x7fa3d0, 0xc000abcd00}, 0x1)
        /usr/local/go/src/database/sql/sql.go:1370 +0x6e8
database/sql.(*DB).query(0xc0001234, {0x7fa3d0, 0xc000abcd00}, ...)
        /usr/local/go/src/database/sql/sql.go:1746 +0x77
database/sql.(*DB).QueryContext(...)
        /usr/local/go/src/database/sql/sql.go:1725
myapp/repository.(*Users).FindByID(...)
        /app/repository/users.go:42
```

The key frame is `database/sql.(*DB).conn` and the duration "3 minutes". This goroutine has been blocked for 3 minutes waiting for a free connection. It is sitting on a `select` over its `connRequest` chan and ctx.Done(). If you see 200 such goroutines, the pool is starved.

### 15.2 Waiting on the driver

```
goroutine 4243 [IO wait, 2 minutes]:
internal/poll.runtime_pollWait(...)
internal/poll.(*pollDesc).wait(...)
net.(*conn).Read(...)
github.com/jackc/pgconn.(*PgConn).receiveMessage(...)
github.com/jackc/pgx/v5.(*Conn).Query(...)
```

Driver is blocked on network read from Postgres. The DB is taking too long to respond. Conn is held; pool has one less available. If many goroutines look like this and target the same query, you have a slow query problem, not a pool problem.

### 15.3 Reading the conn ownership

`database/sql` itself does not tag conns with the goroutine that holds them. To find the offender:

- Note the goroutines in `IO wait` on `pgconn.receiveMessage` or similar driver internals.
- Their call stack tells you which handler is holding the conn.
- Time of stall (`[IO wait, X minutes]`) tells you how long.

Combine with `pg_stat_activity` (Postgres-side):

```sql
SELECT pid, state, query_start, NOW() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY duration DESC LIMIT 10;
```

The longest-running query on the DB side correlates with the IO-wait goroutine in your dump.

### 15.4 Pinpointing the leaker

If you suspect a conn leak (rows not closed, tx not closed), check `DBStats.InUse` over time. A leak shows as `InUse` slowly climbing toward `MaxOpenConnections` and never recovering, until pool starvation.

Tool: `runtime.SetFinalizer` is set by `database/sql` on rows/tx that prints to stderr when finalized while still open. Run with `GODEBUG=sqltrace=1` (some forks) or just `go test -race` to catch most cases. Production: enable a structured log on rows leak via wrapping the driver.

---

## 16. Distributed pool considerations — pgbouncer modes

### 16.1 Session vs transaction vs statement pool modes

pgbouncer offers three pool modes:

- **session**: client conn ↔ server conn one-to-one for the client's lifetime. Server conn returned only on client disconnect.
- **transaction**: client conn ↔ server conn for the duration of a transaction. Between txns, server conn goes back to the pool.
- **statement**: server conn returned after each statement. No multi-statement txns allowed.

Statement mode is rare; transaction and session are common.

### 16.2 Go's pool interaction with session mode

Session mode is the "transparent" case. From Go's perspective, talking to pgbouncer is identical to talking to Postgres directly. All session features work: `SET`, prepared statements, `LISTEN/NOTIFY`, advisory locks.

The pool sizing question changes shape:

- `pgbouncer.default_pool_size` is the cap on server-side conns to Postgres.
- Your Go `MaxOpenConns` is the cap on Go-side conns to pgbouncer.
- They are independent. `MaxOpenConns` can be much larger than pgbouncer's pool because conns to pgbouncer are cheap, but server conns are bounded by pgbouncer.

Typical sizing: each Go pod has `MaxOpenConns = 50` against pgbouncer, pgbouncer has `default_pool_size = 30` across all clients, Postgres has `max_connections = 100`. You overcommit Go-side because not all Go conns will be active at once; pgbouncer queues if they are.

### 16.3 Transaction mode — the gotchas

Transaction mode is where seniors get burned because Go's prepared statement cache and session state assumptions break.

**Prepared statements.** When Go calls `db.Prepare(...)`, the driver issues `PREPARE` on a server-side conn. In transaction pool mode, the next request from the same Go conn lands on a *different* server conn — which has no idea about that prepared statement. Result: `prepared statement "lrupsc_1" does not exist` errors.

Mitigations:

- Use `pgx` directly (not through `database/sql`) which has a "simple protocol" mode that avoids server-side prepares.
- Or configure your driver to use the extended protocol with one-shot prepares (`pgx` does this with `default_query_exec_mode=cache_describe`).
- Or use pgbouncer >= 1.21 which finally supports `PREPARE` in transaction mode via `max_prepared_statements`.

**SET commands.** Outside a tx, `SET search_path TO myschema` lands on a server conn and is lost when the conn returns to pgbouncer's pool. Always wrap in a transaction or use `SET LOCAL` (works inside tx only).

**LISTEN/NOTIFY.** Broken in transaction mode. Use a dedicated `*sql.Conn` via `db.Conn(ctx)` against a session-mode pgbouncer instance, or directly against Postgres.

**Advisory locks.** `pg_try_advisory_lock` outside a tx is broken (lock held until session ends; session ended). Use `pg_try_advisory_xact_lock` inside a tx — released on commit/rollback.

### 16.4 Configuring Go for pgbouncer transaction mode

```go
db.SetMaxOpenConns(50)     // can be more than pgbouncer's pool
db.SetMaxIdleConns(50)
db.SetConnMaxLifetime(5 * time.Minute)
db.SetConnMaxIdleTime(1 * time.Minute)
// Plus driver-level: tell pgx not to use server-side prepares.
```

For `pgx/stdlib`:

```go
cfg, _ := pgx.ParseConfig("postgres://...")
cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
db := stdlib.OpenDB(*cfg)
```

This forces every query to go over the simple protocol; no server-side prepares. You pay one extra parse per query, you gain pgbouncer transaction-mode compatibility.

### 16.5 RDS Proxy specifics

AWS RDS Proxy is conceptually similar to pgbouncer in transaction mode, with some twists:

- **Pinning.** Some operations pin a Go conn to a specific server conn for its lifetime: `SET`, prepared statements (older versions), large transactions. Pinning defeats multiplexing. AWS CloudWatch publishes `DatabaseConnectionsBorrowLatency` and pinning-related metrics; watch those.
- **Idle client timeout.** RDS Proxy closes idle client conns after 30 minutes by default. Set `ConnMaxIdleTime` to less than that (5 min) so Go closes first.
- **Failover.** RDS Proxy abstracts the writer endpoint. During failover, in-flight conns may be reset; new conns get the new writer. Set `ConnMaxLifetime = 5 * time.Minute` so all conns rotate within 5 min of a failover and find the new writer.

---

## 17. Real-world debugging — runaway transaction

A worked example. Symptom: at 14:32 UTC, p99 latency on `POST /orders` jumped from 80 ms to 30 s. By 14:35, all `POST /orders` requests are timing out.

### 17.1 First look: DBStats

```
DBStats:
  MaxOpenConnections: 15
  OpenConnections:    15
  InUse:              15
  Idle:               0
  WaitCount:          2150  (was 1200 five min ago)
  WaitDuration:       9m22s (was 12s five min ago)
```

Pool is fully saturated. `WaitDuration` has jumped by ~9 minutes in 5 minutes — every request is now spending a meaningful fraction of its time waiting for a conn.

### 17.2 Goroutine dump

```
$ curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
$ grep -c 'database/sql.(\*DB).conn' goroutines.txt
14
```

14 goroutines are in `(*DB).conn`. One more is missing from that count — presumably the holder of the long-running tx.

```
$ grep -B 2 -A 30 'IO wait' goroutines.txt | grep -A 30 'pgconn'
goroutine 4001 [IO wait, 3 minutes]:
internal/poll.runtime_pollWait(...)
github.com/jackc/pgconn.(*PgConn).receiveMessage(...)
github.com/jackc/pgx/v5/stdlib.(*Conn).Query(...)
database/sql.(*DB).queryDC(...)
database/sql.(*Tx).QueryContext(...)
myapp/handlers.exportAllOrders.func2(...)
        /app/handlers/orders.go:312
myapp/handlers.exportAllOrders(...)
        /app/handlers/orders.go:298
```

Found it. `exportAllOrders` started a tx 3 minutes ago and is streaming a huge result set. Pool is starved because that one handler holds one conn and the other 14 conns are blocked behind it.

Wait — only one conn is pinned, but 14 goroutines are waiting? Look more carefully.

```
$ grep -c '(*Tx).QueryContext' goroutines.txt
8
```

8 goroutines are inside a tx. Each holds a conn. Plus 6 more conns held outside a tx by other handlers. That's 14 conns held + 14 waiting. The 14 held are taking too long because... look at the underlying SQL.

### 17.3 Postgres side

```sql
SELECT pid, state, query_start, NOW() - query_start AS dur, query
FROM pg_stat_activity
WHERE state = 'active' ORDER BY dur DESC LIMIT 5;
```

```
 pid  | state  | duration | query
------+--------+----------+--------------------------------------------------
 9123 | active | 00:03:42 | SELECT ... FROM orders WHERE ... ORDER BY ts
 9124 | active | 00:01:55 | INSERT INTO orders ...
 9125 | active | 00:01:54 | INSERT INTO orders ...
 ...  | active | 00:01:53 | INSERT INTO orders ...
```

The top query is the export. The others are normal inserts blocked behind a `Lock` or `BufferIO` wait. Check `pg_stat_activity.wait_event`:

```sql
SELECT pid, wait_event_type, wait_event, query FROM pg_stat_activity WHERE state = 'active';
```

```
 pid  | wait_event_type | wait_event      | query
------+-----------------+-----------------+-----------------------
 9123 | IO              | DataFileRead    | SELECT ... FROM orders
 9124 | Lock            | transactionid   | INSERT INTO orders ...
 9125 | Lock            | transactionid   | INSERT INTO orders ...
```

Aha — pid 9123 is doing a sequential scan reading data files (IO wait), and pids 9124+ are blocked waiting on a transactionid lock. Some lock that the export tx holds (perhaps `SELECT ... FOR UPDATE` somewhere, or maybe a row lock from an earlier `UPDATE` in the same tx).

### 17.4 Fix

Three-step response:

1. **Immediate**: `SELECT pg_cancel_backend(9123);` to abort the export. Pool will drain; latency will recover.
2. **Short-term**: Add a 60-second `statement_timeout` to the slow pool. Re-route export endpoint to slow pool with `MaxOpenConns = 2`.
3. **Long-term**: Replace the export from a live query with a streaming COPY into S3 / GCS, or run on a read replica.

### 17.5 Prevention

This entire incident was preventable with:

- Per-route concurrency cap on `/orders/export` (Section 10).
- Separate slow-pool with low `MaxOpenConns` (Section 6.3).
- `statement_timeout` on every conn (Section 9, ResetSession or DSN options).
- Alerts on `WaitCount` rate > 5/s (Section 14).

---

## 18. Driver-specific gotchas

### 18.1 `lib/pq` (the original Postgres driver)

- No `driver.Pinger` implementation in old versions; `db.PingContext` falls back to a SELECT.
- `ResetSession` is a no-op; session state leaks.
- Notification (`LISTEN/NOTIFY`) requires the `pq.Listener` type, not `*sql.DB`.
- Cancellation is supported but uses a separate TCP conn to send `CancelRequest`. If your firewall blocks the cancel port, cancel becomes a no-op.

### 18.2 `pgx/stdlib`

- Has its own connection pool (`*pgxpool.Pool`) that's independent of `database/sql`. Use that when you want pgx features (LISTEN, COPY, batch).
- When wrapped via `stdlib.OpenDB`, it integrates with `database/sql` but loses some features (no batched protocol by default).
- `ResetSession` runs `DISCARD ALL` if configured; check `pgx.ConnConfig.AfterRelease`.
- Prepared statement caching is double-layered: pgx caches per-conn, `database/sql` caches per-Stmt-per-conn. Memory adds up.

### 18.3 `go-sql-driver/mysql`

- `ResetSession` uses MySQL's `COM_RESET_CONNECTION` (requires MySQL 5.7+).
- `interpolateParams=true` does client-side parameter interpolation; loses prepared statement benefits but works with bouncers.
- `readTimeout` / `writeTimeout` in DSN; without them, a hung server stalls the conn forever.
- `multiStatements=true` enables `;`-separated multi-statements; security risk — never enable for user-input queries.

### 18.4 Cgo-based drivers (libmysqlclient, oracle, db2)

`database/sql` assumes drivers are pure Go and don't interact with the OS scheduler beyond network IO. cgo-based drivers (e.g., `mattn/go-oci8`) bring their own threading model. Each cgo call blocks a P (processor) until return. Effects:

- Heavy concurrent driver calls can starve the Go runtime. Set `GOMAXPROCS` appropriately and consider explicit `runtime.LockOSThread` if the driver requires thread-local state.
- Timeouts via ctx cancellation may not propagate through the C code. The Go goroutine returns on cancel, but the C call may still be running on the thread — orphaned work.

If you must use a cgo driver, treat `MaxOpenConns` not just as a DB-side limit but as a thread budget. Setting `MaxOpenConns = 100` with a cgo driver on a 4-core machine is a recipe for runaway thread counts.

---

## 19. Putting it all together — a production config

Below is a config that combines the lessons. Postgres direct (no proxy), 8 pods of an order-API.

```go
package db

import (
    "context"
    "database/sql"
    "fmt"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
)

type Config struct {
    DSN              string
    MaxOpenConns     int           // default 15
    MaxIdleConns     int           // default = MaxOpenConns
    ConnMaxLifetime  time.Duration // default 30m
    ConnMaxIdleTime  time.Duration // default 5m
    AppName          string
    StatementTimeout time.Duration // default 30s, set via DSN options
}

func Open(ctx context.Context, cfg Config) (*sql.DB, error) {
    if cfg.MaxOpenConns == 0 { cfg.MaxOpenConns = 15 }
    if cfg.MaxIdleConns == 0 { cfg.MaxIdleConns = cfg.MaxOpenConns }
    if cfg.ConnMaxLifetime == 0 { cfg.ConnMaxLifetime = 30 * time.Minute }
    if cfg.ConnMaxIdleTime == 0 { cfg.ConnMaxIdleTime = 5 * time.Minute }
    if cfg.StatementTimeout == 0 { cfg.StatementTimeout = 30 * time.Second }

    dsn := fmt.Sprintf("%s&application_name=%s&statement_timeout=%d",
        cfg.DSN, cfg.AppName, int(cfg.StatementTimeout/time.Millisecond))

    db, err := sql.Open("pgx", dsn)
    if err != nil { return nil, err }

    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

    // Validate connectivity before returning.
    pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := db.PingContext(pingCtx); err != nil {
        db.Close()
        return nil, fmt.Errorf("db ping: %w", err)
    }

    return db, nil
}
```

Usage at startup:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    fastDB, err := db.Open(ctx, db.Config{
        DSN: os.Getenv("DB_DSN"),
        MaxOpenConns: 15,
        AppName: "orders-fast",
        StatementTimeout: 5 * time.Second,
    })
    if err != nil { log.Fatalf("open fast db: %v", err) }
    defer fastDB.Close()

    slowDB, err := db.Open(ctx, db.Config{
        DSN: os.Getenv("DB_DSN"),
        MaxOpenConns: 3,
        AppName: "orders-slow",
        StatementTimeout: 60 * time.Second,
        ConnMaxIdleTime: 1 * time.Minute,
    })
    if err != nil { log.Fatalf("open slow db: %v", err) }
    defer slowDB.Close()

    reg := prometheus.NewRegistry()
    dbmetrics.New(fastDB, "orders-fast", reg).Run(ctx, 5*time.Second)
    dbmetrics.New(slowDB, "orders-slow", reg).Run(ctx, 5*time.Second)

    // ... HTTP server, routing.
}
```

Things worth flagging:

- `statement_timeout` is in the DSN, so it survives session resets — `ResetSession` runs `DISCARD ALL` which does *not* clear server-level parameters set via `SET`, but DSN-level options are reapplied as startup parameters on every conn. Safe.
- The slow pool's `MaxOpenConns = 3` is the admission control. Even if 1000 export requests pile up, at most 3 hit the DB simultaneously.
- `ConnMaxLifetime = 30m` is conservative; failover detection within ~30 minutes.

---

## 20. Quick reference

| Symptom                           | Likely cause                                   | First fix                             |
|-----------------------------------|------------------------------------------------|----------------------------------------|
| Latency spike, WaitCount climbing | Pool starved by slow queries                   | Identify slow query; add timeout       |
| InUse never drops                 | Conn leak (rows/tx not closed)                 | `sqlclosecheck` in CI                  |
| MaxLifetimeClosed spike at 5m mark| LB or proxy cycling conns                      | Align ConnMaxLifetime with infra       |
| `prepared statement does not exist` | pgbouncer transaction mode + server-side prep | Switch driver to simple protocol       |
| Session vars leaking across requests | ResetSession not running DISCARD ALL        | Pin via `db.Conn` or set vars per-call |
| Many goroutines stuck in `(*DB).conn` | Pool size too small for traffic             | Raise MaxOpenConns within DB limits    |
| Cancel context, query still runs  | Legacy driver Queryer interface                | Upgrade driver to QueryerContext       |
| N+1 in handler, fan-out blowing up | Unbounded goroutines per request              | Bounded errgroup + semaphore           |
| Cold start after deploy           | Pool reopens all conns simultaneously          | Lower MaxIdleConns to smooth ramp      |
| Failover: stale conns talk to old IP | No ConnMaxLifetime                          | Set ConnMaxLifetime = 30m              |

---

## 21. Internals quick-reference (sql.go)

Pinning points in the source you should be able to read:

- `(*DB).conn` — checkout. Around `sql.go:1300`. Two strategies. Spawns `connectionOpener` if needed.
- `(*DB).putConn` — return. Around `sql.go:1430`. Hands to waiter from `connRequests` if any.
- `(*DB).connectionCleaner` — background goroutine. Around `sql.go:1100`. Sleeps `min(maxLifetime, maxIdleTime)`.
- `(*DB).connectionOpener` — background goroutine. Reads from `openerCh`. Opens a new conn under `db.mu`.
- `(*Stmt).connStmt` — Around `sql.go:2700`. Per-conn stmt cache lookup.
- `(*DB).queryDC` — query on a checked-out conn. Around `sql.go:1700`. Calls into driver QueryerContext or falls back.
- `withLock` — small helper that locks `db.mu`, runs a fn, unlocks. Used everywhere.

Mental model: every public method on `*sql.DB` is "checkout → operate → return". The pool's only job is to manage the checkout queue and the conn lifecycle. The driver does the actual SQL.

---

## 22. Deeper: the `connRequest` waiter mechanism

When a goroutine calls `db.conn(ctx, cachedOrNewConn)` and no idle conn is available, two paths exist depending on `numOpen` vs `maxOpen`:

- If `numOpen < maxOpen`, the library opens a new conn synchronously (or asynchronously, see below).
- If `numOpen >= maxOpen`, the goroutine registers a `connRequest`:

```go
// sql.go, simplified
req := make(chan connRequest, 1)
reqKey := db.nextRequestKeyLocked()
db.connRequests[reqKey] = req
db.waitCount++
db.mu.Unlock()

waitStart := nowFunc()

select {
case <-ctx.Done():
    // remove req from connRequests map under db.mu
    // drain req if a conn was sent in race
    return nil, ctx.Err()
case ret, ok := <-req:
    db.waitDuration.Add(int64(time.Since(waitStart)))
    if !ok { return nil, errDBClosed }
    return ret.conn, ret.err
}
```

A few interesting details:

1. **The channel is buffered (capacity 1).** When `(*DB).putConn` decides to hand a returned conn to a waiter, it does a non-blocking send. If the buffer is full (shouldn't happen normally), the library would deadlock — so the cap-1 buffer is critical.

2. **`waitCount` and `waitDuration` are atomically incremented**, not protected by `db.mu` in the recent versions. That's why you can read `DBStats` cheaply from a metrics goroutine.

3. **Cancellation during wait is a two-step dance.** When ctx fires, the goroutine acquires `db.mu` to remove its `connRequest`. But a conn might have been sent to it concurrently — that conn would otherwise be orphaned. The library handles this: after removing the request, it drains `req` and, if a conn was in flight, puts it back into the pool. See `sql.go` around `(*DB).conn` cancellation path.

4. **Why the map and not a queue?** Wait requests are not strictly FIFO. The `connRequests` map allows the library to pick *any* waiter to hand a returned conn to. In practice the map iteration order in Go is randomized, which gives approximate fairness; older versions had subtle starvation issues that were fixed by switching to map-based selection.

### 22.1 The `nextRequest` and `numCanceled` accounting

The library tracks every conn checkout cost via two counters internal to `*DB`:

```go
type DB struct {
    // ...
    waitDuration atomic.Int64
    waitCount    int64
    maxIdleClosed     int64
    maxIdleTimeClosed int64
    maxLifetimeClosed int64
}
```

These are visible via `db.Stats()`. The `WaitCount` increments every time a goroutine has to wait (i.e., no idle conn AND `numOpen >= maxOpen`). It does not increment if the conn is created on demand (`numOpen < maxOpen`). This subtlety matters for interpretation: `WaitCount == 0` does not mean conns are always idle — it means the pool never reached `maxOpen`.

### 22.2 The "open in flight" counter

When a goroutine triggers the opener (`numOpen < maxOpen` but no idle conn), there is a small window between "decide to open" and "open completed". During this window, the library has to count the in-flight open against `numOpen`, otherwise multiple concurrent goroutines would all decide to open and overshoot `maxOpen`.

```go
// sql.go
db.numOpen++ // optimistically count it
db.mu.Unlock()

ci, err := db.connector.Connect(ctx)
if err != nil {
    db.mu.Lock()
    db.numOpen-- // back out
    db.maybeOpenNewConnections() // wake another waiter
    db.mu.Unlock()
    return nil, err
}
// ... ci is now real, insert into pool
```

If `connector.Connect` fails (DNS, TCP refused, auth error), the optimistic count is rolled back. But during the open attempt, other goroutines see `numOpen == maxOpen` and may block on `connRequest`. Slow connect attempts therefore have a higher cost than just the latency of the attempt itself.

In production with a healthy DB, conn open takes 5–30 ms (TCP + TLS + auth). With a degraded DB, it can be many seconds; this is when the optimistic accounting bites.

---

## 23. Cancellation propagation in detail

When a `QueryContext` call's ctx fires mid-query, the chain is:

1. Library's watchdog goroutine notices `ctx.Done()`.
2. Library calls into the driver's `Conn.CancelRequest` (or equivalent). For Postgres, this opens a *separate* TCP connection to the server with a CancelRequest message.
3. The driver's main IO goroutine, blocked in `net.(*conn).Read`, returns with an error (after the server processes the cancel and closes/aborts the query).
4. The Go caller's `QueryContext` returns `ctx.Err()` or a wrapped error.
5. The library then decides whether to keep the conn or close it. If the conn is in a known-good state, keep; otherwise, close.

### 23.1 The "cancel race" — what if the query finished before cancel arrived?

Common scenario: client times out at 99 ms; the query finished at 98 ms server-side and returned 100 rows. The driver is now streaming rows back; the client cancel arrives mid-stream. What happens?

- The server receives the cancel, finds no active query (it finished). Cancel is a no-op server-side.
- The driver's IO loop is reading row data. It does not stop because of the cancel; it stops because either (a) the rows are fully sent and the conn returns to ReadyForQuery, or (b) the client closes the conn.
- The Go caller sees `ctx.Err()` returned from `QueryContext`. Rows are discarded. Library calls `rows.Close()`, which signals the driver to stop reading and drain.

Result: the work is done, the data is thrown away, the conn may be in a weird state. The library closes the conn to be safe. WaitCount may tick up; latency on next query is one TCP/TLS handshake higher.

### 23.2 Avoiding the race

You can't fully avoid it — networks are racy by definition. But you can reduce the cost:

- Don't time out at the boundary where the query is "usually fast enough". If p99 is 50 ms, set timeout at 200 ms minimum.
- Use connection-level keepalives so the driver detects dead conns proactively rather than discovering them on the next query.

### 23.3 Cancelable Begin

`db.BeginTx(ctx, opts)` honors ctx during the begin call. If ctx fires before the BEGIN statement reaches the server, the begin is aborted and no tx is created. If ctx fires *during* BEGIN (unlikely but possible), the conn is closed.

Once the tx is created, the ctx is **not** used to cancel operations. You must pass a (potentially derived) ctx to each `tx.QueryContext` / `tx.ExecContext` call. Cancellation of the original ctx after BeginTx does not abort in-flight tx operations — they each carry their own ctx.

This is a common confusion. The fix is to derive a child ctx and pass it down:

```go
func (s *Service) doStuff(ctx context.Context) error {
    txCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    tx, err := s.db.BeginTx(txCtx, nil)
    if err != nil { return err }
    defer tx.Rollback()

    // All ops use txCtx, so they all share the 5s budget.
    if _, err := tx.ExecContext(txCtx, "INSERT ..."); err != nil { return err }
    if _, err := tx.ExecContext(txCtx, "UPDATE ..."); err != nil { return err }
    return tx.Commit()
}
```

If you instead used `ctx` (the parent) inside the tx, ctx might be a request scope with no deadline, and your tx can run forever.

---

## 24. The `(*DB).Conn(ctx)` escape hatch

`*sql.Conn` is for when you need to ensure successive operations land on the same physical conn. Use cases:

- Session-level state: `SET search_path TO myschema; SELECT ... FROM mytable;`.
- Advisory locks: `SELECT pg_advisory_lock(123); ... SELECT pg_advisory_unlock(123);`.
- Temporary tables: `CREATE TEMP TABLE t (...); INSERT INTO t ...; SELECT ... FROM t;`.
- `LISTEN/NOTIFY`.

```go
conn, err := db.Conn(ctx)
if err != nil { return err }
defer conn.Close() // returns conn to pool

if _, err := conn.ExecContext(ctx, "SET search_path TO myschema"); err != nil { return err }
rows, err := conn.QueryContext(ctx, "SELECT * FROM mytable")
if err != nil { return err }
defer rows.Close()
// ... process rows
```

### 24.1 What `conn.Close()` does

It does **not** close the underlying network conn. It releases the conn back to the pool, where:

- `ResetSession` is called (which may run `DISCARD ALL` or similar).
- The conn becomes available for `db.Query`, `db.Exec`, `db.BeginTx`, etc.

After `conn.Close()`, the `*sql.Conn` handle is unusable — any further calls return `sql.ErrConnDone`.

### 24.2 The lifecycle pitfall

Forgetting `conn.Close()` is bad. The conn is pinned forever (or until your process dies). Unlike `rows.Close()`, there is no finalizer here that auto-closes — `*sql.Conn` is just a struct with a pointer to a `driverConn`, and the GC can't safely auto-close it because the user might be planning to use it. Always defer.

### 24.3 Concurrency

`*sql.Conn` is NOT goroutine-safe. The underlying `driver.Conn` is single-threaded. Using the same `*sql.Conn` from two goroutines is a data race (Section 11.4).

If you need parallel work on the same session state, you can't — that's a fundamental DB constraint, not a Go one. Either serialize the work or use multiple conns with separate session state.

---

## 25. Worked example: implementing a per-tenant advisory-lock pattern

Real-world scenario. You have a tenant-aware service. Each tenant's onboarding requires a series of steps that must not run concurrently for the same tenant (race in row creation). Use Postgres advisory locks via a checked-out conn.

```go
package onboarding

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
)

type Service struct {
    db *sql.DB
}

var ErrAlreadyOnboarding = errors.New("onboarding already in progress for this tenant")

// Onboard runs the multi-step onboarding for a tenant.
// Holds an advisory lock for the tenant ID; returns ErrAlreadyOnboarding
// if another goroutine (in this pod or another pod) is already onboarding.
func (s *Service) Onboard(ctx context.Context, tenantID int64) error {
    conn, err := s.db.Conn(ctx)
    if err != nil {
        return fmt.Errorf("conn: %w", err)
    }
    defer conn.Close()

    var acquired bool
    err = conn.QueryRowContext(ctx,
        "SELECT pg_try_advisory_lock($1)", tenantID,
    ).Scan(&acquired)
    if err != nil {
        return fmt.Errorf("acquire lock: %w", err)
    }
    if !acquired {
        return ErrAlreadyOnboarding
    }

    // Critical: release lock on exit. If we crash, the lock is released
    // when the conn closes (advisory locks are session-scoped).
    defer func() {
        // Use a fresh ctx so cancellation doesn't skip the release.
        rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer rcancel()
        _, _ = conn.ExecContext(rctx, "SELECT pg_advisory_unlock($1)", tenantID)
    }()

    return s.runSteps(ctx, conn, tenantID)
}

func (s *Service) runSteps(ctx context.Context, conn *sql.Conn, tenantID int64) error {
    // Run each step on the same conn so any session state is consistent.
    if _, err := conn.ExecContext(ctx, "INSERT INTO tenants ..."); err != nil { return err }
    if _, err := conn.ExecContext(ctx, "INSERT INTO billing_accounts ..."); err != nil { return err }
    if _, err := conn.ExecContext(ctx, "INSERT INTO audit_logs ..."); err != nil { return err }
    return nil
}
```

Notes:

- `pg_try_advisory_lock` is non-blocking; returns true on acquisition, false otherwise. Compare with `pg_advisory_lock` (blocking).
- The lock is **session-scoped**. If the conn dies, the lock is released. If the process crashes, the session ends, the lock is released. This is the correct durability story for this kind of mutex.
- Using `pg_try_advisory_xact_lock` would tie the lock to a tx, which is even better when feasible — release is automatic on commit/rollback.
- Critical: do not use `db.Exec(..., "SELECT pg_try_advisory_lock(...)")` directly on `*sql.DB`. That would acquire the lock on whichever conn the pool hands you, release it back to the pool, and the lock would stay held by a "free" conn. Other goroutines could happen to get that conn and inherit the lock invisibly. Always use `*sql.Conn` for session-level state.

---

## 26. Worked example: read-your-writes consistency on a primary/replica setup

When you write to primary and immediately read from replica, the replica may not have caught up. Common workarounds:

- Read from primary for "fresh-required" reads.
- Use a `wait_for_lsn` mechanism (Postgres `pg_wait_for_subscription_lag` or similar).
- Tag conns by "freshness window" and route accordingly.

Implementation sketch:

```go
type DBs struct {
    primary *sql.DB
    replica *sql.DB
}

type Reader interface {
    QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
    QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
}

type freshness int

const (
    EventualOK freshness = iota
    FreshRequired
)

func (d *DBs) Reader(f freshness) Reader {
    if f == FreshRequired {
        return d.primary
    }
    return d.replica
}

// In handler:
user, err := repo.GetUser(ctx, d.Reader(EventualOK), userID)
// After a write:
_, err = repo.UpdateUser(ctx, d.primary, userID, newName)
// Read-your-writes requires fresh:
user, err = repo.GetUser(ctx, d.Reader(FreshRequired), userID)
```

Both `*sql.DB` instances have their own pools, ConnMaxLifetime, etc. They are configured independently as in Section 3.3.

Pool-relevant insight: a primary that takes most of the write traffic and a replica that takes most read traffic will have very different pool dynamics. The replica's pool spends more time idle on connect (reads are usually short), so set `ConnMaxIdleTime` longer there. The primary's pool spends time in active checkout; set `ConnMaxIdleTime` lower to keep state fresh.

---

## 27. Antipatterns checklist

A list to grep your codebase for. Each item is a bug magnet.

### 27.1 `sql.Open` followed by no `Ping`

```go
db, _ := sql.Open("pgx", dsn)
// no Ping
// First query in handler is now the first thing that exercises the DSN.
// If the DSN is wrong, you discover it under user load.
```

Fix: always `db.PingContext(ctx)` at startup, fail fast.

### 27.2 Default pool sizes in production

```go
db, _ := sql.Open(...)
// MaxOpenConns = 0 (unlimited)
// MaxIdleConns = 2
```

Unlimited `MaxOpenConns` will happily exceed the DB's `max_connections` under load, leading to "too many connections" errors. `MaxIdleConns = 2` will churn conns. Always set both.

### 27.3 Setting `MaxOpenConns` once at startup with hardcoded value

```go
db.SetMaxOpenConns(50)
```

50 is wrong for some pod count, right for others. Read from config that scales with deployment size:

```go
podCount := mustGetenv("DEPLOYMENT_REPLICAS")
dbMax := mustGetenv("DB_MAX_CONNECTIONS")
budget := (dbMax - reservations) / podCount
db.SetMaxOpenConns(budget - headroom)
```

### 27.4 Ignoring `rows.Err()` after the loop

```go
for rows.Next() {
    // ...
}
// did NOT check rows.Err()
```

If `Next()` returns false because of an error (network blip, server error mid-stream), the loop exits silently. Always:

```go
if err := rows.Err(); err != nil {
    return fmt.Errorf("iterate: %w", err)
}
```

### 27.5 `db.Begin()` without ctx

```go
tx, err := db.Begin()
// equivalent to db.BeginTx(context.Background(), nil)
// No deadline, no cancellation.
```

`db.Begin` should be considered deprecated for new code. Always `BeginTx(ctx, &sql.TxOptions{...})`.

### 27.6 Conn in a long-lived goroutine

```go
go func() {
    conn, _ := db.Conn(context.Background())
    for range time.Tick(time.Hour) {
        conn.ExecContext(context.Background(), "...")
    }
}()
```

That conn is pinned forever. The pool effectively has `MaxOpenConns - 1` usable conns. If you need a long-lived dedicated conn for `LISTEN` or similar, open a separate `*sql.DB` for that purpose, with `MaxOpenConns = 1`, so it doesn't steal from your main pool.

### 27.7 `Stmt.Close()` in a hot path

```go
stmt, _ := db.PrepareContext(ctx, q)
defer stmt.Close() // good if stmt is one-shot
// But: if you call this on every request, you're preparing per request.
```

Prepare once at startup, close at shutdown. The `*sql.Stmt` is goroutine-safe and lives for the process.

### 27.8 Ignoring `(*Result).RowsAffected()` error

```go
res, _ := db.ExecContext(ctx, "DELETE FROM ...")
n, _ := res.RowsAffected()
if n == 0 { /* assume not found */ }
```

Some drivers cannot report `RowsAffected` and return an error. Always check it. If the driver doesn't support it, fail loudly or don't rely on it.

### 27.9 Sharing `*sql.DB` across binaries via globals

```go
var DB *sql.DB

func init() {
    DB, _ = sql.Open(...)
}
```

Two problems: (1) `init()` runs before main flag parsing; you can't configure from CLI. (2) Global state is hard to test. Prefer dependency injection — pass `*sql.DB` explicitly to constructors.

### 27.10 Custom driver wrappers that break the contract

You write a "tracing" wrapper around `driver.Conn` that adds a goroutine inside. Now your conn is no longer single-threaded from the library's view. Bizarre failures ensue. If you wrap a driver, the wrapper must preserve all concurrency contracts. Look at `github.com/uptrace/opentelemetry-go-extra/otelsql` for a correct example.

---

## 28. Performance: when the pool itself becomes the bottleneck

Most services hit DB-side limits before pool-side limits. But on a service doing 50k QPS with `MaxOpenConns = 100`, `db.mu` becomes hot.

### 28.1 Profiling `db.mu` contention

```bash
go tool pprof -http :8080 http://localhost:6060/debug/pprof/mutex
```

Look for `database/sql.(*DB).conn` and `database/sql.(*DB).putConn` in the top contended sites. If they show up significantly, options are:

- Increase `MaxOpenConns` so fewer goroutines fight for the queue.
- Shard your access: multiple `*sql.DB` instances against the same DSN. Round-robin or hash by tenant.
- Move to a connection-pool-aware driver (pgx native `*pgxpool.Pool`) that uses finer-grained synchronization.

### 28.2 Sharded pools

```go
type ShardedDB struct {
    shards []*sql.DB
}

func NewSharded(dsn string, n int, configure func(*sql.DB)) (*ShardedDB, error) {
    s := &ShardedDB{shards: make([]*sql.DB, n)}
    for i := 0; i < n; i++ {
        db, err := sql.Open("pgx", dsn)
        if err != nil {
            for j := 0; j < i; j++ { s.shards[j].Close() }
            return nil, err
        }
        configure(db)
        s.shards[i] = db
    }
    return s, nil
}

func (s *ShardedDB) Pick() *sql.DB {
    return s.shards[fastrand()%uint32(len(s.shards))]
}
```

Each shard has its own mutex. Three shards of 10 conns each = 30 conns total, but with 1/3 the lock contention compared to one 30-conn pool.

Caveat: each shard runs its own opener and cleaner goroutines. Memory cost is small but non-zero. And `Stats()` must be aggregated across shards.

### 28.3 When NOT to shard

If your contention is on the DB itself (CPU at 90% on Postgres primary), sharding the Go pool won't help. The bottleneck is downstream. Pool sharding only helps when `db.mu` shows up in your mutex profile.

---

## 29. Failover and DSN-level resilience

Once you have `ConnMaxLifetime` rotating conns, you should also let the driver handle failover at the DSN level.

### 29.1 Multi-host DSN

Postgres DSN supports multiple hosts:

```
postgres://host1,host2,host3:5432/mydb?target_session_attrs=read-write
```

The driver tries each host in order. With `target_session_attrs=read-write`, it picks the first one that is the primary (not a hot standby). Failover: when the primary changes, new conns will discover the new primary by walking the host list.

Combine with `ConnMaxLifetime = 5 * time.Minute` and you have automatic failover within ~5 min, no manual intervention.

### 29.2 Retry policy

`database/sql` does not retry on driver errors except for `ErrBadConn` (one retry only). Application-level retries are your responsibility:

```go
func retry(ctx context.Context, fn func() error) error {
    backoff := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        err := fn()
        if err == nil { return nil }
        if !isRetryable(err) { return err }
        select {
        case <-time.After(backoff):
            backoff *= 2
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errors.New("exhausted retries")
}

func isRetryable(err error) bool {
    if errors.Is(err, driver.ErrBadConn) { return true }
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        // 40P01 deadlock, 40001 serialization_failure
        return pgErr.Code == "40P01" || pgErr.Code == "40001"
    }
    return false
}
```

Important: only retry idempotent operations. A retry on `INSERT INTO orders` could create two orders. Use idempotency keys on the application side.

### 29.3 Pool-aware retry — do not amplify

A poorly-designed retry loop hammers the pool:

```go
for {
    err := db.ExecContext(ctx, ...)
    if err == nil { break }
    // no backoff, no max attempts
}
```

During an outage, this retry loop occupies a conn slot continuously, starving healthy traffic. Always backoff with jitter, cap attempts, and treat ctx.Done() as terminal.

---

## 30. Testing the pool

### 30.1 Smoke test for size limits

```go
func TestPoolMaxOpen(t *testing.T) {
    db := openTestDB(t)
    db.SetMaxOpenConns(3)
    db.SetMaxIdleConns(3)

    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    var wg sync.WaitGroup
    started := make(chan struct{}, 10)
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // pg_sleep ensures the conn is held
            _, _ = db.ExecContext(ctx, "SELECT pg_sleep(0.5)")
            started <- struct{}{}
        }()
    }
    wg.Wait()
    close(started)

    s := db.Stats()
    if s.MaxOpenConnections != 3 {
        t.Fatalf("expected MaxOpenConnections=3, got %d", s.MaxOpenConnections)
    }
    if s.WaitCount < 7 {
        t.Fatalf("expected at least 7 waits (10 goroutines, 3 conns), got %d", s.WaitCount)
    }
}
```

This confirms the pool actually caps at the configured size.

### 30.2 Leak test

```go
func TestNoConnLeakAfterRowsClose(t *testing.T) {
    db := openTestDB(t)
    db.SetMaxOpenConns(2)
    db.SetMaxIdleConns(2)

    for i := 0; i < 100; i++ {
        rows, err := db.QueryContext(ctx, "SELECT 1")
        if err != nil { t.Fatal(err) }
        for rows.Next() {
            var x int
            rows.Scan(&x)
        }
        rows.Close()
    }

    s := db.Stats()
    if s.InUse != 0 {
        t.Fatalf("leak: InUse=%d after loop, want 0", s.InUse)
    }
}
```

If you regress to `for rows.Next() { return }` without close, this test catches it.

### 30.3 Race-condition test

```go
func TestConcurrentSafe(t *testing.T) {
    db := openTestDB(t)
    db.SetMaxOpenConns(10)

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            var n int
            db.QueryRowContext(ctx, "SELECT 1").Scan(&n)
        }()
    }
    wg.Wait()
}
```

Run with `go test -race`. If anyone introduces concurrent use of an internal field, the race detector catches it. `database/sql` itself is race-clean; this guards against your wrappers.

### 30.4 Integration test against pgbouncer

To validate your transaction-mode setup, spin up pgbouncer in CI (docker-compose), point your tests at it, and run scenarios:

- Hundreds of concurrent simple queries.
- A transaction that does SET; then a non-tx query; verify SET did not leak.
- A LISTEN; verify it fails predictably (transaction mode does not support LISTEN).

CI script:

```yaml
services:
  postgres:
    image: postgres:16
  pgbouncer:
    image: bitnami/pgbouncer:1.21
    environment:
      POSTGRESQL_HOST: postgres
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_DEFAULT_POOL_SIZE: 10
```

Tests run against `pgbouncer:6432`.

---

## 31. The DBStats interpretation cheat sheet

For each metric, what it means, what to alert on, what action to take.

### 31.1 `OpenConnections`

What: current count of live conns (idle + in-use).

Watch: trend over time. Should be stable around your steady-state load.

Alert: drops to 0 unexpectedly = full pool reset; spikes equal to MaxOpen = saturation.

### 31.2 `InUse`

What: conns currently checked out by goroutines.

Watch: ratio `InUse / MaxOpenConnections`.

Alert: > 0.8 sustained = approaching saturation. > 0.95 = imminent waits.

### 31.3 `Idle`

What: conns in `freeConn`, available for next checkout.

Watch: should be small but positive most of the time. Zero idles means every checkout incurs a wait or an open.

Action: if Idle = 0 consistently, raise MaxIdleConns or MaxOpenConns.

### 31.4 `WaitCount`

What: total waits since DB open (monotonic).

Watch: rate. `rate(WaitCount[5m])` in Prometheus.

Alert: > 1/sec sustained = pool saturated.

### 31.5 `WaitDuration`

What: total time spent waiting (monotonic).

Watch: average wait via `rate(WaitDuration[5m]) / rate(WaitCount[5m])`.

Alert: average wait > p99 of query duration = queueing exceeds work.

### 31.6 `MaxIdleClosed`

What: conns closed because they exceeded MaxIdleConns (over the idle cap).

Watch: rate. Steady positive = idle churn.

Action: raise MaxIdleConns to match MaxOpenConns; reduces churn.

### 31.7 `MaxIdleTimeClosed`

What: conns closed by exceeding ConnMaxIdleTime.

Watch: rate. Spikes after periods of low traffic = expected.

Action: if rate matches your traffic gaps, healthy; if persistent during steady load, your ConnMaxIdleTime is too aggressive.

### 31.8 `MaxLifetimeClosed`

What: conns closed by exceeding ConnMaxLifetime.

Watch: rate; should match `MaxOpenConnections / ConnMaxLifetime` in steady state.

Alert: > 10x expected rate = LB or proxy is cycling conns out from under you.

---

## 32. Future-facing: trends in `database/sql`

Recent Go versions have added incremental improvements:

- **Go 1.10**: `driver.SessionResetter`, `driver.NamedValueChecker`, `driver.Pinger`.
- **Go 1.13**: `(*DB).Conn`, type aliases for driver value types.
- **Go 1.14**: `(*Rows).Close()` is now safe to call concurrently with `(*Rows).Next` in some narrow cases.
- **Go 1.15**: `SetConnMaxIdleTime`.
- **Go 1.20**: improvements to `DBStats` and finalizer correctness.
- **Go 1.22**: minor doc improvements; the structure is essentially fixed.

Likely future direction (community discussion):

- A way to register a "conn warmup" callback that runs `SET` on every new conn.
- Better integration with OpenTelemetry without driver wrappers.
- Per-stmt cache configuration (e.g., disable the per-conn cache for transaction-mode pgbouncer).

None of this is in flight as of Go 1.22. For now, the contracts in this doc are stable.

---

## 33. Closing notes

The `database/sql` pool looks simple — four `Set*` methods, a `Stats()` call. It is simple, in the sense that there is nothing fancy. But it sits at the boundary between Go's goroutine scheduler, the network, the driver's internal threading, and the database's own conn lifecycle. Bugs there look like every other production bug — slow, mysterious, intermittent.

The senior skill is not memorizing all the knobs. It is reading a goroutine dump and recognizing the `(*DB).conn` blocked state in 2 seconds, knowing immediately whether `MaxOpenConns` or `ConnMaxLifetime` or a leaking handler is to blame, and having the metrics in place to verify the hypothesis in 30 seconds. The tuning is downstream of that.

Three things to internalize:

1. **The pool is a queue, not a cache.** Sizing is about how much queueing you want, not how many conns "should" exist.
2. **Conns carry state.** Anything between checkout and return — session vars, prepared stmts, locks — is invisible to the next user unless ResetSession or your own discipline clears it.
3. **The driver contract is single-threaded.** Multi-goroutine use of `*sql.DB` is fine because the library serializes; multi-goroutine use of `*sql.Conn`, `*sql.Stmt` (within a tx), `*sql.Rows` is not.

---

[← Back](../)
