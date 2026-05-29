# database/sql — Interview

## 1. How to use this file

Twenty-five questions in interview order — junior to staff — followed by a "what NOT to say" list and a five-minute pre-interview checklist. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. `database/sql` is deceptively small — a few hundred lines of pool, statement, and transaction plumbing on top of `driver.Driver` — but the interview signal is whether you can trace a `db.Query` call from caller to wire, explain why the pool shape causes the failure modes it causes, and reason about contexts, prepared statements, and replica lag without prompting.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is `database/sql`?

**Short answer:** `database/sql` is the standard library's generic SQL interface — it defines `*DB`, `*Tx`, `*Stmt`, `*Rows`, `*Row` and a `driver.Driver` plug-in surface that third-party packages (`pgx/stdlib`, `lib/pq`, `go-sql-driver/mysql`) implement to talk to a specific database. The package owns the **connection pool**, **statement caching**, **context propagation**, and **scan machinery**; the driver owns the **wire protocol** and **value conversion**. You import the driver for its side effects (`_ "github.com/lib/pq"` calls `sql.Register` in `init`) and then call `sql.Open("postgres", dsn)` against the generic API.

**Follow-up:** Why this split? Answer: so application code is portable across databases (the surface is the same for Postgres, MySQL, SQLite) and so the pool, retries, and lifecycle live in one place rather than being re-implemented per driver. The cost is that database-specific features (Postgres arrays, JSONB types, `COPY` protocol) leak through `driver.Valuer`/`sql.Scanner` or sit outside the `database/sql` surface entirely — which is why `pgx` ships both a `database/sql` adapter and its own native API.

**Second follow-up:** Why is `sql.Open` lazy — why doesn't it connect on call? Answer: because a `*DB` is a long-lived process-scoped handle, and the meaningful question is "is the database reachable when we need it" not "is it reachable at process start." `Open` validates the DSN syntax and registers the driver mapping; `Ping` (or any first query) actually opens a connection. The lazy shape lets configuration happen during init without coupling startup to database availability.

---

### Q2. Why is there a connection pool — why not one connection per query?

**Short answer:** Opening a TCP connection plus the database handshake (TLS, auth, parameter exchange) costs 5–50 ms; reusing an already-open connection costs microseconds. A pool amortises that handshake across thousands of queries. It also bounds load on the database: without a pool, 10k concurrent goroutines would open 10k connections and Postgres would refuse most of them once it hits `max_connections`. The pool puts a ceiling on simultaneous in-flight queries, queues the rest, and recycles connections that have been idle too long.

**Follow-up:** Why not one connection per goroutine? Answer: a SQL connection is **stateful** — it holds session settings, an active transaction, a current prepared statement — and most drivers serialise commands on it. Sharing one connection across goroutines would mean serialising all queries; one-per-goroutine means unbounded connection growth. The pool is the compromise: a bounded set of stateful connections that get checked out, used briefly, and checked back in.

---

### Q3. Why must you `defer rows.Close()` after every `db.Query`?

**Short answer:** `rows.Close()` returns the underlying connection to the pool. If you don't call it, the connection stays checked out for the lifetime of the `*Rows` object (until GC eventually finalises it, which may be never under load). A few leaked `*Rows` and the pool drains — `db.Query` calls start blocking forever waiting for a free connection, and the app deadlocks on the database. `rows.Close` is also idempotent and safe to call after `rows.Next` returns false, so the `defer` pattern doesn't double-close. `QueryRow` is the exception: it has its own auto-close in `Row.Scan`, so you don't `defer` anything there.

**Follow-up:** What about iterating fully with `rows.Next` until it returns false — does that release the connection? Answer: yes, `rows.Next` returning false auto-closes internally, so a clean full-iteration path is safe. The `defer` matters because real code has early returns, errors mid-scan, and `break` out of the loop — `defer rows.Close()` covers every exit path. Treat it as mandatory, not optional.

**Second follow-up:** What does `rows.Err()` check, and when do you call it? Answer: after the `for rows.Next()` loop terminates, call `rows.Err()` to surface any error that ended iteration prematurely (network error mid-stream, malformed row, context cancellation). `rows.Next` returns false on both end-of-results and on error; `rows.Err` distinguishes them. Skipping it means silently treating "I got 3 of 10 rows" as "the database had 3 rows" — a data-loss bug that doesn't show up until production.

---

### Q4. What's the difference between `Query` and `QueryRow`?

**Short answer:** `Query` returns `*Rows` and is for zero-or-many results — you iterate with `for rows.Next()` and call `rows.Scan` per row. `QueryRow` returns `*Row` and is for exactly-one (or zero) result — you call `row.Scan` once. The convenience of `QueryRow` is that it defers any error (including `sql.ErrNoRows`) to `Scan`, so you write `err := db.QueryRow(...).Scan(&x)` in one expression. Internally `QueryRow` is `Query` plus auto-close on `Scan` — same plumbing, different ergonomics.

**Follow-up:** What if `QueryRow`'s SQL actually returns multiple rows? Answer: `Scan` reads the first row, then `Row.Close` discards the rest and returns the connection. The extra rows are silently thrown away — which is usually a bug in the query, not a feature. If you care, use `Query` and assert "exactly one row" yourself.

---

### Q5. What's a driver in `database/sql`?

**Short answer:** A driver is anything that implements `driver.Driver` (which returns a `driver.Conn` from `Open(dsn)`). The `database/sql` package never talks to a database directly — it calls into the driver for `Open`, `Prepare`, `Query`, `Exec`, `Begin`, `Commit`, `Rollback`. Drivers register themselves with `sql.Register("name", driver)` in their `init` function, and `sql.Open("name", dsn)` looks up the registered driver by name. Modern drivers also implement context-aware interfaces (`driver.QueryerContext`, `driver.ExecerContext`, `driver.ConnPrepareContext`) so cancellation propagates to the wire.

**Follow-up:** Why import a driver as `_ "github.com/lib/pq"`? Answer: the blank import runs the driver's `init` (which calls `sql.Register`) without giving you a name to refer to the package — you don't need one because you talk to it through `database/sql`. The underscore tells `go vet` and linters that the side effect is intentional.

**Second follow-up:** Can you register the same driver twice? Answer: no — `sql.Register` panics on a duplicate name. The pattern matters in tests where multiple init paths might pull in the same driver; libraries that wrap a driver (instrumentation, sharding) register under a new name (`sql.Register("instrumented-postgres", wrapped)`) to avoid the collision.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through `db.Query("SELECT ...", args...)` end-to-end.

**Short answer:** Six steps, every one of them context-aware in modern Go.

1. **Caller** invokes `db.Query(query, args...)` which is `db.QueryContext(context.Background(), ...)`.
2. **Pool checkout.** `DB.conn(ctx, strategy)` grabs a `*driverConn` from `freeConn` if one is available; otherwise it either opens a new one (if under `MaxOpenConns`) or blocks on `connRequests` until one is freed or `ctx` is cancelled.
3. **Driver dispatch.** With the connection in hand, `DB.queryDC` tries fast paths in order: if the driver implements `driver.QueryerContext`, call it; else `driver.Queryer`; else fall back to **prepare-then-query** (driver's `PrepareContext` returns a `driver.Stmt`, `Stmt.QueryContext` runs it, statement is closed after use).
4. **Argument conversion.** `sql.driverArgsConnLocked` walks the `args` slice, converts each Go value to a `driver.Value` using either the driver's `CheckNamedValue` (preferred) or the default conversion (`int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, `nil`).
5. **Wire round-trip.** Driver writes the query and bind parameters to the connection, reads the result-set descriptor (column names, types), and yields a `driver.Rows`.
6. **Wrap and return.** `database/sql` wraps the `driver.Rows` in `*sql.Rows`, attaches the connection lock, and returns. The connection stays checked out until `rows.Close()` is called, GC finalises `*Rows`, or `rows.Next` reaches EOF and auto-closes.

**Follow-up:** Where does the goroutine block in this flow? Answer: step 2 (pool checkout, on `connRequests` channel) and step 5 (wire round-trip, on the underlying TCP socket). Both honour the context — cancel `ctx` and the checkout returns `ctx.Err()`, or the driver's context-aware path closes the connection mid-query.

**Second follow-up:** What does the pool checkout actually look like in code? Answer: roughly the following — `DB.conn` first tries `freeConn` (LIFO stack of returned-to-pool connections); on empty, if `numOpen < maxOpen` it calls the driver's `Open` to create a new one; if at the limit it appends a `connRequest` chan to `connRequests` and blocks selecting on `ctx.Done()` and that channel. When a connection returns to the pool, `DB.putConnDBLocked` either hands it directly to a waiting request via the chan or pushes it onto `freeConn`. LIFO is deliberate — recently-used connections are warm in the database's plan cache.

```go
// Conceptual shape of DB.conn (simplified from src).
select {
case <-ctx.Done():
    return nil, ctx.Err()
case ret := <-req: // waited for a returned conn
    return ret.conn, ret.err
}
```

**Third follow-up:** What's the `connectionOpener` goroutine for? Answer: `database/sql` runs a background goroutine that drains a `openerCh` channel and opens new connections asynchronously. When `DB.conn` decides it needs a new connection but doesn't want to block the calling goroutine on the handshake, it signals the opener; the opener performs `driver.Open` and feeds the result back through the pool's request channel. This overlaps connection establishment with serving — the calling goroutine takes whichever arrives first, a freed connection or a freshly-opened one. The opener also runs the `maybeOpenNewConnections` logic that wakes when a queued request can be satisfied by opening more (up to the `MaxOpenConns` ceiling).

---

### Q7. What's a prepared statement in `database/sql`, and where does it live?

**Short answer:** `db.Prepare(sql)` returns a `*sql.Stmt`, which is **not** a single prepared statement on a single connection — it's a *handle* that lazily prepares the SQL on each pooled connection as needed. The first time a goroutine uses the `*Stmt` on connection A, `database/sql` calls the driver's `Prepare` on A and caches the resulting `driver.Stmt` keyed by the connection. Next call may grab connection B from the pool, which triggers another `Prepare` on B. Over time the `*Stmt` accumulates `driver.Stmt` handles on every pooled connection, and `Stmt.Close()` closes all of them.

**Follow-up:** Why is this a problem at low query rates? Answer: every prepared statement multiplies its parse-and-plan cost by the pool size. If `MaxOpenConns=20` and you prepare a statement you call only twice a minute, you pay the prepare cost 20 times — once per connection the pool happens to give you. Without prepare, the same query runs once per call and the driver-side caches (`pgx` keeps a per-connection LRU of recently-seen SQL) often skip the prepare entirely. For high-frequency reused statements, prepare wins; for one-shot or low-rate queries, prepare loses.

---

### Q8. How does `Tx` tie to a connection?

**Short answer:** `db.BeginTx(ctx, opts)` checks out exactly one connection from the pool and pins it to the `*Tx` for the transaction's lifetime. Every `tx.Query`, `tx.Exec`, `tx.Prepare`, `tx.Stmt` is executed on that pinned connection — the pool will not hand it out to anyone else until `tx.Commit()` or `tx.Rollback()` returns it. This is non-negotiable because transaction state (the `BEGIN`, savepoints, isolation level, locks) lives on the connection; running a transaction's queries on different connections would split them across independent sessions in the database.

**Follow-up:** What happens if you forget to commit or roll back? Answer: the connection stays checked out until GC finalises the `*Tx`, at which point a finalizer rolls back and returns the connection. By the time the finalizer fires you're long past the timeline where the transaction matters — and you've held an open transaction in the database for that whole window, potentially holding row locks and bloating WAL. `defer tx.Rollback()` after `BeginTx` (rollback is a no-op after a successful commit) is the mandatory shape.

**Second follow-up:** What about nested transactions? Answer: `database/sql` doesn't have them — `tx.Begin()` is not a method. The database-level equivalent is **savepoints** (`SAVEPOINT sp1; ... ROLLBACK TO sp1`), which you issue as plain SQL inside the outer transaction using `tx.ExecContext`. A wrapper that emulates `Begin`-style nesting via savepoints is a common helper pattern, but the language never built it in because the semantics (what does "rollback inner" mean if the outer has already committed something?) are subtle and database-specific.

---

### Q9. `MaxOpenConns` vs `MaxIdleConns` vs `ConnMaxLifetime` — what does each do?

**Short answer:** Three independent knobs that together define pool behaviour.

| Knob | Effect | Default |
|------|--------|---------|
| `SetMaxOpenConns(n)` | Hard ceiling on simultaneously open connections (in-use + idle). Excess `Query` calls block on `connRequests` until one frees. | 0 (unlimited) |
| `SetMaxIdleConns(n)` | Ceiling on idle (returned-to-pool, not yet handed out) connections. When a connection comes back and idle pool is full, it's closed immediately. | 2 |
| `SetConnMaxLifetime(d)` | After being open for `d`, a connection is closed on next return-to-pool. Defends against long-lived connections that accumulate server-side state or hit network-level idle timeouts. | 0 (forever) |
| `SetConnMaxIdleTime(d)` | After being idle for `d`, a connection is closed. Trims pool when traffic drops. | 0 (forever) |

Common production mistake: leaving `MaxIdleConns` at the default of 2 with `MaxOpenConns=50`. Under bursty traffic the pool opens 50 connections, finishes the burst, and immediately closes 48 of them — next burst pays 48 reconnect handshakes. Set `MaxIdleConns` equal to `MaxOpenConns` (or close to it) for steady throughput.

**Follow-up:** What's the right `MaxOpenConns` for a Postgres app? Answer: lower than people expect. Postgres serves each connection with a backend process; >100 connections per database starts to hurt under load. The rule of thumb is `(cores * 2 + spindles)` per backend, and a pooled app should target half of that across all replicas combined. Beyond that, use PgBouncer in transaction-pooling mode and set `MaxOpenConns` against PgBouncer's pool rather than against Postgres directly.

**Second follow-up:** What about `ConnMaxIdleTime` vs `ConnMaxLifetime` — when does each matter? Answer: `ConnMaxLifetime` is **age from open**; trims old connections regardless of activity. `ConnMaxIdleTime` is **age since last use**; trims connections nobody has touched recently. Use both: lifetime to defend against load-balancer rotation and failover-stale connections, idle-time to trim the pool during quiet periods so you're not holding 50 connections you don't need. Setting only one of them leaves a corresponding failure mode uncovered.

---

### Q10. How does context cancellation actually cancel a query?

**Short answer:** Two stages. (1) **Before the wire round-trip:** every entry point (`QueryContext`, `ExecContext`, `BeginTx`) calls `ctx.Err()` early and aborts with `ctx.Err()` if already done. (2) **During the wire round-trip:** if the driver implements `driver.QueryerContext` (`pgx`, modern MySQL drivers, modern SQLite drivers do), the driver passes the context down to its read/write loop and selects on `ctx.Done()` between sends; on cancellation it sends the database's "cancel query" message (`PG: CancelRequest` on a side socket; MySQL `KILL QUERY`) and closes the connection. The `database/sql` layer also fires a watchdog goroutine that closes the connection if the context fires and the driver hasn't returned yet.

**Follow-up:** What about old drivers that only implement `driver.Queryer` (no context)? Answer: `database/sql` falls back to *connection-level* cancellation — when the context fires, it forcibly closes the underlying connection, which interrupts whatever the driver was reading. The query gets aborted but the connection is destroyed (not returned to the pool). Modern context-aware drivers can preserve the connection by sending a clean cancel; legacy ones can't, which is one reason to prefer `pgx` over `lib/pq`.

**Second follow-up:** Does cancelling a query roll back its writes? Answer: yes — Postgres treats a cancelled query as aborted, and any uncommitted changes from that statement are gone. Inside an explicit transaction, the transaction itself is still open (and now in `aborted` state); you must `ROLLBACK` to clear it. The driver typically does this for you when the connection is returned to the pool, but inside a long-lived `*Tx` the caller has to call `tx.Rollback()` explicitly.

---

### Q11. What is `driver.ErrBadConn` and why does it exist?

**Short answer:** `driver.ErrBadConn` is the sentinel a driver returns when it detects its connection is dead (TCP RST, write to closed socket, malformed reply). `database/sql` treats this as a signal to **retry the operation on a different connection from the pool**, up to a small bounded number of times (currently 2). Without `ErrBadConn`, every transient network blip would surface as an application error even though the next pooled connection would work fine. The contract is one-sided: drivers must return `ErrBadConn` only when the operation **definitely did not start** on the database side — otherwise the retry would re-execute a side-effecting `INSERT` and you'd get duplicates.

**Follow-up:** Why don't `ExecContext`-style writes get retried indefinitely? Answer: because the retry only covers the case where the connection was dead before the query reached the server. Once the query is in flight, the driver returns the real error (network error, timeout, server error) — not `ErrBadConn` — and `database/sql` propagates it. The two-retry cap also bounds pathological cases where every connection in the pool is in some way broken.

**Second follow-up:** Where in driver code does `ErrBadConn` typically get returned? Answer: in the driver's read or write loop, when the syscall returns `ECONNRESET`, `EPIPE`, `io.EOF` on the very first byte of an operation. If even one byte has been written, the driver doesn't know if the server received it, so it returns the real network error (not `ErrBadConn`) and `database/sql` won't retry. This "definitely didn't start" contract is why retry safety holds across the pool.

---

### Q12. Why should you use `*Context` variants always?

**Short answer:** Four reasons, in order of importance. (1) **Cancellation propagates from the caller.** An HTTP handler whose client disconnects should cancel its database query immediately, not wait for it to complete; `QueryContext` with `r.Context()` gives you that for free. (2) **Deadline propagation.** A 100 ms upstream deadline becomes a 100 ms database deadline without you computing or threading anything. (3) **Distributed tracing.** Context carries the trace span; `pgx` and OpenTelemetry instrumentation read `ctx` to attach the span to the database call. (4) **Future-proofing.** Non-context variants (`Query`, `Exec`) are equivalent to passing `context.Background()` — fine for tests, dangerous in production code because they hide the cancellation path. Treat the bare versions as deprecated.

**Follow-up:** Is there ever a reason to use `db.Query` over `db.QueryContext(ctx, ...)`? Answer: short scripts and migrations where there's no caller context to propagate. Even then, `context.Background()` made explicit is clearer. In a library, expose only the `*Context` variants and refuse to add the others.

**Second follow-up:** What about `context.WithValue` carrying request-scoped data into the driver? Answer: avoid it for query parameters — context values are an escape hatch, not a parameter-passing mechanism, and the driver doesn't know about your value keys. Where context values *do* matter for `database/sql`: tracing (OpenTelemetry's span context), tenant tags (multi-tenant request routing in a wrapper driver), and request IDs that the driver attaches to `application_name`. Treat context values as observability metadata, not data.

---

## 4. Senior questions (Q13–Q20)

### Q13. Tune the connection pool for a high-throughput Postgres app.

**Short answer:** Four numbers, picked against measured load.

1. **`MaxOpenConns`.** Bound it well below Postgres's `max_connections`. If you run 10 app replicas against one Postgres with `max_connections=200`, give each replica `MaxOpenConns=15` so you have headroom for migrations, monitoring, and PgBouncer. Going higher trades throughput for the risk of "too many clients" outages when one replica spikes.
2. **`MaxIdleConns` ≈ `MaxOpenConns`.** Leaving idle at the default of 2 is the most common production foot-gun — bursty traffic pays the reconnect cost for connections 3–N every time. Match idle to open so the pool stays warm.
3. **`ConnMaxLifetime` 5–30 minutes.** Long enough to amortise connections, short enough that load-balancer endpoint changes, Postgres failovers, and TLS-cert rotations don't leave stale connections in the pool. Without it, a Postgres failover leaves your app talking to the old primary forever.
4. **`ConnMaxIdleTime` ≈ 1–2× the typical inter-burst gap.** If burst gaps are 30 s, set 1 min so cold connections close during sustained quiet periods without thrashing during normal traffic.

Senior moves: (a) put PgBouncer in front in transaction-pooling mode and tune the **app pool against PgBouncer's pool**, not against Postgres; that lets you run 200 app replicas with 5 connections each against a PgBouncer pool of 20 backend connections. (b) Export `db.Stats()` as Prometheus metrics — `WaitCount`, `WaitDuration`, `MaxIdleClosed`, `MaxLifetimeClosed` tell you whether the pool is too small, too aggressive, or about right. (c) Load-test before shipping; pool sizing is a measurement problem, not a guessing problem.

**Follow-up:** What signal tells you the pool is too small? Answer: `WaitCount` climbing and `WaitDuration / WaitCount` above ~10 ms means goroutines are queuing on the pool. Either increase `MaxOpenConns` (if Postgres has headroom) or reduce query time. Pool starvation under steady load is the canonical "raise max-open" signal.

**Second follow-up:** What if `db.Stats().MaxLifetimeClosed` is climbing fast? Answer: your `ConnMaxLifetime` is too short for the workload — connections are being recycled before they get used much, paying reconnect cost without amortising it. Push `ConnMaxLifetime` to 15–30 minutes and re-measure. The flip side: if it's zero and you've never seen the pool refresh, you're vulnerable to load-balancer endpoint changes and Postgres failovers. Want a non-zero value; want it long.

---

### Q14. Diagnose: one slow query is holding a connection and the pool is starved.

**Short answer:** The symptom is `db.Stats().WaitCount` rising fast, p99 latency on unrelated queries spiking, and a few connections stuck in the "active" state for seconds. Diagnose in three layers.

1. **Identify the slow query.** Postgres `pg_stat_activity` shows currently-executing queries; filter by `state = 'active'` and `now() - query_start > '1 second'`. You'll usually see the same query text repeated — a missing index, a runaway `LIKE '%foo%'`, an `ORDER BY` over an unindexed column.
2. **Identify the calling code path.** Application-side, the `*sql.DB` metrics don't show which goroutine holds the connection; OpenTelemetry tracing or a `pg_stat_statements` join with `application_name` (which `pgx` can set per-connection) bridges the gap. Set `application_name` to the service name plus a request ID prefix for traceability.
3. **Decide on bound and fix.** Two options. (a) **Hard timeout** the query: set `statement_timeout` per-statement via `SET LOCAL statement_timeout = 5000` inside a `BeginTx`, or pass a `context.WithTimeout(ctx, 5s)` so `pgx` aborts the query at the wire level. (b) **Fix the query**: add the missing index, rewrite the predicate, materialise an expensive subquery. Timeouts contain the blast radius; the index removes the root cause.

Senior move: don't just bump `MaxOpenConns` because the pool is starved — that's treating the symptom. A pool of 200 with a 30-second runaway query is still going to starve, just slower. Add the timeout *and* fix the query *and* alert on `pg_stat_activity` long-runners so the next one surfaces before users notice.

**Follow-up:** Why is `statement_timeout` better than a Go-side `context.WithTimeout` alone? Answer: complementary, not alternative. Context timeout fires the cancel from the client side and frees the goroutine; `statement_timeout` is a Postgres-side guarantee that protects against client-side bugs where the context wasn't threaded through. Belt and braces — set both.

**Second follow-up:** How do you set `statement_timeout` for every query in a Go app? Answer: two options. (1) Set it in the DSN — Postgres accepts `?statement_timeout=5000` in the URL or `options='-c statement_timeout=5000'` in the keyword form; every connection inherits the setting. (2) Set it on connection check-out via a driver hook: `pgx`'s `BeforeAcquire` or a wrapper that runs `SET statement_timeout TO 5000` on each new connection. The DSN approach is simpler; the hook is more flexible (per-tenant timeouts, per-workload tuning).

---

### Q15. How do you handle read-replica lag in `database/sql` reads?

**Short answer:** Replica lag means a write on the primary at T might not be visible on a replica until T+lag (typically 0–500 ms, occasionally seconds). Three strategies in increasing complexity.

1. **Stale-read tolerance.** Decide per endpoint whether stale data is acceptable. Listings, dashboards, search — fine. The post-write read-back for "your comment was posted" — not fine. Tag queries `(read_after_write bool)` and route accordingly.
2. **Read-your-writes within session.** After a write, route subsequent reads from the same user/session to the primary for a window (e.g. 1 s). Implement via a session cookie or a per-user "last write at" timestamp in Redis; if `now - last_write < lag_budget`, use the primary pool.
3. **Replica lag observation.** Read `pg_last_xact_replay_timestamp()` on the replica and compare to the primary's `pg_current_wal_lsn()` (via Patroni or pgbouncer-cli). Refuse to route reads to a replica whose lag exceeds a threshold; rebalance to other replicas or fall back to primary.

Implementation: two `*sql.DB` instances (`readDB`, `writeDB`) backed by separate DSNs, plus a router function that picks between them per query. Don't try to teach `database/sql` itself about replicas — keep the routing in your repository layer where the business rules live.

**Follow-up:** What about read-only transactions? Answer: `BeginTx` with `sql.TxOptions{ReadOnly: true}` lets the driver announce read-only intent to the database, but it does **not** route the transaction to a replica — that's still your job. Use `ReadOnly` on the primary too, because it enables Postgres planner optimizations and prevents accidental writes during reads.

**Second follow-up:** What does isolation level on `BeginTx` actually do? Answer: `sql.TxOptions{Isolation: sql.LevelSerializable}` issues `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` at `BEGIN`. Postgres maps the levels: `LevelReadUncommitted` and `LevelReadCommitted` both become "read committed" (Postgres doesn't have read-uncommitted); `LevelRepeatableRead` is true SSI-flavoured RR; `LevelSerializable` is SSI. Picking serializable means accepting `40001` (serialization failure) retries as the price for snapshot consistency under concurrent writes.

---

### Q16. Why do prepared statements often hurt performance at low write rate?

**Short answer:** Three reasons. (1) **Per-connection prepare cost multiplied by pool size.** Each `*sql.Stmt` lazily prepares on every pooled connection it touches; a pool of 50 and a low-frequency `INSERT` pays the parse-plan-bind cost 50 times before steady state, and pays it again every time `ConnMaxLifetime` recycles a connection. (2) **Plan staleness.** Postgres caches the prepared plan per-connection; if your data distribution shifts (a small table grows large, a column's selectivity flips), the cached generic plan can be drastically worse than a freshly-planned one. The driver doesn't notice; the database doesn't re-plan automatically. (3) **Lost driver optimisations.** `pgx` in simple-protocol mode does its own per-connection LRU of recent SQL and skips redundant prepares; explicit `*sql.Stmt` defeats that cache.

When prepared statements **do** help: a single SQL string executed thousands of times per second per connection (hot inner loop), where the parse-plan cost dominates. For everything else — most application queries — let the driver decide via its protocol-level caching.

**Follow-up:** If I want a prepared statement, when should I scope it? Answer: scope `*sql.Stmt` to a `*sql.Tx`. A transaction is one connection, so a `tx.Prepare` prepares exactly once and `tx.Stmt(stmt)` from a global prepare-on-DB rebinds the global statement to the transaction's connection. For most callers, just pass the SQL string and arguments to `db.QueryContext` and let the driver cache it.

**Second follow-up:** What about prepared statement deallocation on Postgres? Answer: Postgres tracks prepared statements per session. When a connection is closed (by `ConnMaxLifetime`, by `ErrBadConn`, by pool drain), its prepared statements are gone — fine. But under PgBouncer in *transaction pooling* mode, a single client may land on different backend sessions for each transaction, and prepared statements created in one transaction don't exist in the next. Either disable prepared statements entirely (`pgx` has a `PreferSimpleProtocol` option) or use *session pooling* in PgBouncer, which preserves prepared statements but reduces multiplexing. This trade-off is the canonical PgBouncer foot-gun.

---

### Q17. Cancel a long-running query gracefully.

**Short answer:** Five steps. (1) **Pass a context with deadline.** `ctx, cancel := context.WithTimeout(parent, 30*time.Second); defer cancel()` — pick the deadline against your SLO budget, not against the query's expected time. (2) **Use a context-aware driver** (`pgx`, modern `go-sql-driver/mysql`) so cancellation triggers a wire-level abort, not a connection close. (3) **Set `statement_timeout` at the database level** as a backstop in case the context wasn't propagated correctly. (4) **Wrap the call in a retry decision** — `context.DeadlineExceeded` is a real timeout; surface it to the caller. `errors.Is(err, context.Canceled)` means the caller went away; log and move on. (5) **Test the cancel path.** Write a test that kicks off `pg_sleep(10)`, cancels at 100 ms, and asserts the connection is back in the pool within 200 ms.

```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()

rows, err := db.QueryContext(ctx, "SELECT slow_op($1)", id)
if errors.Is(err, context.DeadlineExceeded) {
    return nil, fmt.Errorf("query timeout: %w", err)
}
```

**Follow-up:** What happens to the connection on cancel? Answer: with a context-aware driver, the driver sends a cancel message (Postgres `CancelRequest` on a parallel socket, MySQL `KILL QUERY`) and the connection returns to the pool clean. With a legacy driver, `database/sql` closes the connection — your pool loses one slot and a fresh handshake pays the reconnect cost. Modernise your driver.

**Second follow-up:** Can you detect "the client gave up" server-side? Answer: Postgres logs cancelled queries with `ERROR: canceling statement due to user request`. `pg_stat_activity` shows them transiently. If you see a steady stream of these, you have either aggressive client-side timeouts (tune the deadline) or runaway upstream timeouts (the HTTP client is cancelling before the query completes). Either way, the metric is worth alerting on — frequent cancellation usually means a chase between deadlines that don't agree.

---

### Q18. Compare `pgx` vs `lib/pq`.

**Short answer:** `lib/pq` is the original pure-Go Postgres driver, still works, in maintenance mode. `pgx` is the actively developed replacement and the default choice for new code. Differences worth knowing.

| Concern | `lib/pq` | `pgx` |
|---------|----------|-------|
| **Maintenance** | Bug fixes only | Active development |
| **`database/sql` adapter** | Native | Via `stdlib` subpackage |
| **Native API** | None | `pgx.Conn`/`pgxpool.Pool` with typed queries |
| **Performance** | Adequate | 10–40% faster on benchmarks (binary protocol, less reflection) |
| **Postgres-specific types** | Limited (`pq.Array`) | Full (arrays, JSONB, ranges, hstore, custom types) |
| **`COPY` protocol** | Limited | First-class `CopyFrom` |
| **Notification (`LISTEN/NOTIFY`)** | Hacky | First-class with channel-style API |
| **Context-aware cancel** | Connection close | Wire-level cancel |
| **Connection pooling** | Via `database/sql` | Via `pgxpool` (native) or `database/sql` |

For new code: use `pgx` via `pgxpool` for the native API (better types, better cancellation, better performance), or via `stdlib` if you need `database/sql` compatibility (ORM, existing code, polyglot patterns). Avoid starting new projects on `lib/pq` — its lack of context-aware cancellation is the disqualifier.

**Follow-up:** Should existing `lib/pq` code migrate? Answer: migrate to `pgx` via `stdlib` first (drop-in driver swap, keep `database/sql`), measure, then decide whether to port to the native API. Most apps see no functional change but get cleaner cancellation and modest latency gains. The native-API port is worth it only if you use Postgres-specific types heavily.

**Second follow-up:** What about `pgxpool` vs `database/sql` for pgx-native apps? Answer: `pgxpool` is `pgx`'s native pool and beats `database/sql`'s pool on three axes — health-checked connections (it pings on acquire), tighter context integration (it never returns a connection that's already past its deadline), and lower allocation overhead (no `driver.Value` boxing layer). For new pgx code, `pgxpool` is the default; for code that needs ORM compatibility or polyglot driver support, the `stdlib` adapter is the bridge.

---

### Q19. Build retry logic for transient connection failures.

**Short answer:** Three layers of retry, each with a different classifier.

1. **Built-in.** `database/sql` already retries `driver.ErrBadConn` up to twice on the next-pool-connection, so naked `ExecContext` calls already survive the simplest transient failures.
2. **Network-level errors.** Wrap the call site in a retry loop that classifies the error: `net.ErrClosed`, `io.EOF`, `syscall.ECONNRESET`, `*net.OpError` are retryable on idempotent reads. `errors.Is(err, context.DeadlineExceeded)` is **not** retryable inside the same context — bubble up. Use exponential backoff with jitter (50 ms base, 2x growth, ±20% jitter, cap at 5 s, max 3 attempts).
3. **Database-side errors.** Postgres `40001` (serialization failure) and `40P01` (deadlock detected) are retryable for `BeginTx` workloads. `08006` (connection failure), `57P01` (admin shutdown), and `57P03` (cannot connect now during recovery) are also retryable. Check `*pgconn.PgError.Code` for the SQLSTATE and decide per-class.

```go
func WithRetry[T any](ctx context.Context, fn func(context.Context) (T, error)) (T, error) {
    var zero T
    var last error
    for attempt := 0; attempt < 3; attempt++ {
        if attempt > 0 {
            select {
            case <-ctx.Done(): return zero, ctx.Err()
            case <-time.After(backoff(attempt)):
            }
        }
        v, err := fn(ctx)
        if err == nil { return v, nil }
        if !isRetryable(err) { return zero, err }
        last = err
    }
    return zero, fmt.Errorf("retries exhausted: %w", last)
}
```

Senior moves: (a) only retry **idempotent** operations — reads, `INSERT ... ON CONFLICT DO NOTHING`, `UPDATE` with explicit version checks; never blind `INSERT` without idempotency, or you double-write. (b) Budget retries against the parent context — if the deadline has 100 ms left, don't sleep 500 ms before retrying. (c) Emit a metric per retry class so you can see "we retried 12k times this hour because of 40001" and decide whether to fix the contention root cause.

**Follow-up:** What about `pgx.PgError` codes you didn't list? Answer: by default, treat unknown errors as **non-retryable**. False positives (over-retry) cause cascading load on a struggling database; false negatives (under-retry) just surface as user-visible errors and you can add the code later. Conservative default, expand the retry set with evidence.

**Second follow-up:** What's wrong with retrying inside a `BeginTx`? Answer: the transaction's connection may be dead, in which case the retry needs a **new** transaction on a **new** connection — not a retry of the next statement on the same `*Tx`. The retry boundary must wrap the entire `BeginTx ... Commit` block, not individual statements within it. Code that retries `tx.ExecContext` in isolation is a common bug; the transaction is already in `aborted` state and every subsequent statement returns "current transaction is aborted."

---

### Q20. Implement read/write splitting at the pool level.

**Short answer:** Two `*sql.DB` instances, a router, and a discipline. The shape:

```go
type Router struct {
    writeDB *sql.DB // primary
    readDB  *sql.DB // replica (or replica pool behind a TCP LB)
}

func (r *Router) QueryContext(ctx context.Context, readOnly bool, q string, args ...any) (*sql.Rows, error) {
    db := r.writeDB
    if readOnly {
        db = r.readDB
    }
    return db.QueryContext(ctx, q, args...)
}

func (r *Router) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
    if opts != nil && opts.ReadOnly { return r.readDB.BeginTx(ctx, opts) }
    return r.writeDB.BeginTx(ctx, opts)
}
```

Three discipline rules. (1) **Writes always primary.** Never route an `INSERT/UPDATE/DELETE` to a replica — they'll error or silently drop on a read-only replica. (2) **Read-after-write goes primary within a short window.** Track `lastWriteAt` per user/session; if `now - lastWriteAt < 1s`, route the read to the primary too. (3) **Transactions are one-DB.** A transaction can't span primary and replica; once you `BeginTx`, all its queries go through that connection's database.

Senior moves: (a) put the routing in the **repository layer** (`UserRepo.GetByID(ctx)` vs `UserRepo.GetByIDFresh(ctx)`), not in the SQL layer — business code knows which reads tolerate staleness; (b) instrument both pools separately (`db_read_*`, `db_write_*` metrics) so you can see when one is saturated; (c) for multiple replicas, put a TCP load balancer (HAProxy, Postgres-aware proxy) in front of the replica pool rather than teaching the app about each replica's address.

**Follow-up:** Why not let the database driver handle replica routing? Answer: some drivers (Postgres's `target_session_attrs=read-only`, multi-host DSN) can, but the routing decisions are application-domain (which queries tolerate staleness, which need read-your-writes) — keeping them in app code keeps the decisions reviewable and testable. Driver-level routing is fine for "any replica is fine" workloads; repository-level is right for everything more nuanced.

**Second follow-up:** How do you test the read/write split locally? Answer: stand up two Postgres instances (or two databases in one cluster) and configure one as a logical replica via `pg_basebackup` / streaming replication. In CI, this is heavy; a lighter alternative is one Postgres with two `*sql.DB` instances pointing at the same DSN — you get the routing logic exercised without true replication. The pure unit-test path mocks the router and asserts that the right method picks `readDB` vs `writeDB` for each call site.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. Critique `database/sql`'s connection pool design.

**Short answer:** Five real problems and what you'd change if you owned the package.

1. **No connection affinity for prepared statements.** Each `*sql.Stmt` lazily prepares on every connection it touches, paying parse-plan cost N times. A better design would either prepare lazily on first use and pin the statement to one connection, or prepare eagerly across the pool at registration. Today's design is the worst of both — surprising cost, no eager guarantee.
2. **Idle pool defaults are wrong.** `MaxIdleConns=2` is a relic of the 2012 era when 2 felt high. Modern apps with `MaxOpenConns=50` get devastated by it; everyone who knows the package overrides it on day one. The default should be equal to `MaxOpenConns`.
3. **No per-request priority or fair queueing.** Under saturation, pool waits are FIFO across all callers — a background batch job can starve interactive requests because both queue on the same channel. A priority queue or per-class quota would be more honest under load.
4. **No connection labelling for diagnostics.** When `pg_stat_activity` shows "idle in transaction" for 30 s, there's no way to map that back to a Go goroutine or HTTP handler. The driver could expose `Conn.SetApplicationName(ctx-derived)` or a callback to attach `application_name` per checkout, and `database/sql` could expose connection IDs in `Stats`.
5. **`driver.ErrBadConn` retry budget is hidden.** Two retries is hardcoded and undocumented in the public API; you can't tune it, can't observe it, can't disable it for non-idempotent operations. Either expose it as a knob or remove the retry and let callers do it.

Staff move: most of these are fixable without breaking the API — better defaults, more telemetry, an opt-in priority queue. None of them are blockers; they're just sharp edges that experienced operators have to work around. The package's overall design (driver-pluggable, pool-owned, context-aware) is sound; the polish is where it shows its age.

**Follow-up:** Why hasn't the team fixed these? Answer: stability. `database/sql` is in the standard library, subject to the Go 1 compatibility promise, and used by every Go app that touches a database. Changing `MaxIdleConns` defaults would shift production behaviour for thousands of apps overnight. The right place for the changes is in companion packages (`pgxpool` is one) or in a `database/sql/v2` proposal, which periodically gets discussed but never lands.

**Second follow-up:** Compared to `pgxpool`, what's the gap? Answer: `pgxpool` ships health-checked connection acquire (pings on take when the connection has been idle longer than a threshold), `BeforeAcquire` and `AfterRelease` hooks for per-connection bookkeeping, native context integration without the watchdog goroutine, and tighter pool-state metrics. The cost: pgx-only, so no cross-driver portability. `database/sql` chooses portability over polish; `pgxpool` chooses polish over portability. For Postgres-only apps, `pgxpool` is the better default in 2026.

---

### Q22. What changes for HTAP (hybrid transactional/analytical) workloads?

**Short answer:** Standard `database/sql` shape is tuned for short-lived OLTP queries — milliseconds, small result sets, many concurrent goroutines. HTAP adds long-running analytical queries that scan millions of rows, run for minutes, and stream large result sets. Five things change.

1. **Separate pools by workload class.** Don't run OLTP and OLAP through the same `*sql.DB` — one slow analytical query can hold a pool slot for minutes and starve OLTP. Two `*sql.DB` instances with different `MaxOpenConns` and `ConnMaxLifetime`, pointed at different connection-pool tiers (or different replicas tuned for OLAP).
2. **Streaming scan, not full materialisation.** OLTP code typically `rows.Next()` until done and accumulates into a slice — fine for 1000 rows, ruinous for 10M. For analytics, scan into a callback or write directly to a downstream sink (Parquet, CSV, S3) without holding the result set in memory. `rows.Next()` already streams from the wire; the app just has to not buffer it.
3. **Different timeout regime.** OLTP context deadlines are 100 ms–5 s; analytics are 5 min–1 h. A unified timeout policy doesn't work — separate the two so a 10 ms OLTP deadline doesn't fire on a 5 min OLAP query because they shared a parent context.
4. **Result set transport.** For analytical exports, `pgx`'s native `CopyTo` (Postgres `COPY TO STDOUT`) is 5–20x faster than row-by-row `SELECT` because it skips the per-row protocol overhead and the per-column conversion logic. Drop down from `database/sql` to the native driver for analytical export paths.
5. **Memory pressure isolation.** Analytics queries that buffer column metadata or large columns can balloon to gigabytes; if OLTP shares the same process, GC pressure cross-contaminates. Run analytics workers in a separate process or pod sized for the bigger heap.

Staff move: HTAP at scale eventually means *two storage engines* (e.g. Postgres + ClickHouse, or row store + columnar replica) and a routing layer that sends OLAP to the analytical engine. `database/sql` is a fine surface for both, but the engines and pools and timeouts diverge — design the routing in your domain code, not in the driver.

**Follow-up:** What about modern HTAP databases (CockroachDB, TiDB, Yugabyte)? Answer: they unify storage but the workload patterns still diverge — short transactions vs long scans. Separate pools and separate timeouts still apply. The HTAP engine reduces the operational cost of having two systems, not the app-side discipline of treating the workloads differently.

**Second follow-up:** Where does `database/sql` actively get in the way of analytical workloads? Answer: the `driver.Value` boxing layer. Every column is converted to an `any` (one of a few permitted types), passed through `convertAssign` reflection, and unboxed into the `Scan` target. For 10M rows × 20 columns × per-column allocation, this is a meaningful CPU cost. Native drivers (`pgx`'s `QueryRow().Scan()` with binary protocol, ClickHouse's columnar batch interface) skip the boxing entirely. For analytical paths, dropping below `database/sql` is the standard optimisation.

---

### Q23. Compare `database/sql` to JDBC.

**Short answer:** Both are language-stdlib database surfaces with a driver plug-in model; differences are in age, scope, and idiom.

| Concern | `database/sql` | JDBC |
|---------|----------------|------|
| **Age** | 2011 (Go 1.0 era) | 1997 |
| **Driver model** | One interface (`driver.Driver`), context-aware sub-interfaces | One interface (`java.sql.Driver`), reflection-based config |
| **Pool** | Built into `*sql.DB` | External (HikariCP, c3p0); JDBC itself has no pool |
| **Prepared statements** | Lazy, per-connection, pool-multiplied | Explicit, scoped to connection or `PreparedStatementCache` |
| **Result sets** | `*Rows` + `Scan` (positional, type-conversion via `Scanner`) | `ResultSet` + getters (positional or named, with type per call) |
| **Streaming** | Pull (`rows.Next`) — natural | Pull (`rs.next`) or cursor-based with fetch size |
| **Type extensibility** | `driver.Valuer`/`sql.Scanner` | `SQLData`, `SQLOutput`/`SQLInput`, `TYPE_REF` |
| **Async** | Context cancellation gives the cooperative version | JDK 17+: `executeAsyncQuery`; otherwise thread-blocking |
| **Connection labelling** | Limited | `Connection.setClientInfo("ApplicationName", ...)` works across vendors |

`database/sql` is **leaner** — no transaction managers, no XA distributed transactions (mostly), no result-set scrolling, no metadata catalogues. JDBC's surface area is several times larger and grew over 25 years of patching. For 90% of app workloads, `database/sql` is more than enough; for two-phase commit across heterogeneous resources or savepoint-heavy transactional code, JDBC has more in the box.

The other half of the comparison is **pool ecosystem**. JDBC's pool is HikariCP — a separately-developed, world-class pool with adaptive sizing, leak detection, JMX metrics, and twenty years of production hardening. `database/sql`'s built-in pool is functional but rudimentary by comparison; teams that need adaptive pool sizing or leak detection build it themselves or pick up `pgxpool` which is closer to Hikari in sophistication.

**Follow-up:** Is the lack of XA in `database/sql` a problem? Answer: rarely. XA's classical use case (distributed transactions across heterogeneous databases or message brokers) has largely been replaced by saga-style compensation and idempotent message processing. Go apps that need cross-system atomicity reach for outbox tables or transactional outbox patterns, not XA. JDBC having XA isn't pulled often even in Java land — it's there for legacy.

**Second follow-up:** What about JDBC's `PreparedStatement.setObject` vs Go's `Scanner`/`Valuer`? Answer: same concept, different ergonomics. `Scanner.Scan(src any) error` and `Valuer.Value() (driver.Value, error)` are the user-extension points for custom types — implement them on your domain type (`UUID`, `Money`, `JSONB`) and it round-trips cleanly through `database/sql`. JDBC's setter/getter pairs are more verbose (one method per JDBC type) but cover more edge cases (binary stream, NCLOB, ROWID) that Go's smaller stdlib type set doesn't have.

---

### Q24. Integrate `database/sql` with distributed tracing.

**Short answer:** Three layers, increasing in fidelity.

1. **Driver-level instrumentation.** `pgx` exposes a `Tracer` interface; OpenTelemetry's `otelpgx` instrument hooks every query, sets `db.statement`, `db.system=postgresql`, `db.connection_id` attributes on the span, and propagates traceparent into the database session via `application_name` or a `SET` command. For drivers without first-class tracing, the `ocsql` / `otelsql` wrapper wraps any `database/sql` driver and instruments at the `sql.Driver`/`sql.Conn` layer.
2. **Span structure.** Every `Query`/`Exec`/`Begin`/`Commit` gets a child span of the calling request's span. Span name is the operation (`SELECT users`, `INSERT orders`) — not the full SQL, which is high-cardinality and PII-laden — with the SQL on a span attribute that you sample or redact. Latency on the span is the wall-clock from the driver call to the driver return.
3. **Database-side correlation.** Set `application_name` on each connection to the service name plus the trace ID prefix; in `pg_stat_activity` you can then map a slow query to its trace. `pgx` supports this via `RuntimeParams`; with `database/sql`, set it once per connection in a `Driver.Open` wrapper or via the DSN. For request-level correlation, embed the trace ID in a SQL comment (`/* traceid=abc123 */ SELECT ...`) — Postgres's `pg_stat_statements` and slow-query log capture comments so you can grep your traces.

Senior moves: (a) **sample SQL text**, never include argument values in span attributes — arguments are PII; (b) instrument **pool stats** as metrics, not spans (gauge for in-use, histogram for wait duration, counter for `MaxIdleClosed`); (c) propagate the trace ID into the database session via comments so you can join app traces to database slow logs without joining on timestamp ranges.

**Follow-up:** What about cardinality on `db.statement`? Answer: track normalised SQL (`SELECT * FROM users WHERE id = ?` not `... id = 4711`) on the span. The driver or your wrapper can normalise by replacing positional args with `?`. Otherwise every distinct argument value creates a new span name and your tracing backend's cardinality explodes.

**Second follow-up:** How do you join a Go trace to a Postgres slow-log entry? Answer: inject the trace ID as a SQL comment at the head of every query — `/* traceid=abc123 service=checkout */ SELECT ...`. Postgres captures comments in `pg_stat_statements` and the slow log; you grep by trace ID to find the matching server-side timing. This works without any database-side changes; the only cost is a few bytes per query on the wire. Sqlcommenter is the standard library implementing this convention across multiple languages and databases.

---

### Q25. Design a "connection migration" pattern for live failover.

**Short answer:** Connection migration is "the primary just failed over; redirect all in-flight and pooled connections to the new primary without dropping requests." Five pieces.

1. **DNS-driven endpoint discovery.** The DSN points at a logical name (`primary.db.internal`) that resolves via DNS or a service-discovery agent (Consul, etcd). On failover, the DNS A record flips to the new primary's IP within seconds. The app's TTL on the DNS lookup must be low (1–5 s); cached infinite TTL is the common foot-gun.
2. **Aggressive `ConnMaxLifetime`.** Set to 5–10 minutes max so existing pooled connections cycle naturally. Without it, a connection opened pre-failover stays bound to the old primary's IP forever (if it doesn't notice the disconnect), and queries either fail or — worse — succeed on a now-read-only host.
3. **Eager connection drain on failure.** When `driver.ErrBadConn` or a Postgres `08006`/`57P01`/`57P03` error fires, **drain the entire pool** (`db.SetMaxIdleConns(0); db.SetMaxIdleConns(target)`), not just the one connection. The whole pool is suspect after a failover, and replacing one connection while leaving 49 stale ones just delays the inevitable.
4. **Failover-aware retry.** Wrap writes in a retry that treats `08006`, `57P01`, `57P03` as retryable for **idempotent** operations and unrecoverable for non-idempotent ones (use idempotency keys or `INSERT ... ON CONFLICT` to make writes idempotent). Cap retries at 3 with exponential backoff so a sustained outage doesn't loop forever.
5. **Health-checked router.** Above `database/sql`, a router periodically pings the primary (`SELECT 1` with a short timeout). On failure, mark the primary unhealthy, route writes to a designated standby (if you've promoted manually) or queue writes in an outbox until healthy. The router pattern decouples failover detection from per-query error handling.

```go
// Sketch of the drain-and-replace step.
func (p *Pool) drainAndReconnect(ctx context.Context) error {
    p.db.SetMaxIdleConns(0)
    p.db.SetMaxIdleConns(p.maxIdle) // close all current idle, reset limit
    return p.db.PingContext(ctx)    // verify new primary is reachable
}
```

Staff move: do not try to migrate **active** transactions across a failover — they have to abort. The pattern protects (a) pooled idle connections from being checked out post-failover and (b) the steady-state retry path for new queries. Active transactions that were mid-flight when the primary died need to return an error to the caller; the caller decides whether to retry (idempotent reads, yes; in-flight writes, only with idempotency keys).

**Follow-up:** What about Postgres-style logical failover with a session-aware proxy (PgBouncer with peering, Patroni, pgcat)? Answer: those move the migration responsibility to the proxy layer. The app's DSN points at the proxy; the proxy holds the connection-to-backend mapping and can rebind connections to a new primary on failover. The app still has to handle in-flight query failures (the proxy can't replay them), but the pool-drain dance becomes the proxy's job. For most production setups, this is the right architectural place for connection migration; the app-side patterns above are the fallback when you don't have a session-aware proxy.

**Second follow-up:** How do you test the failover path without taking down production? Answer: chaos-engineering style. (1) `pg_terminate_backend(pid)` on a connection in `pg_stat_activity` to simulate one connection dying; verify the next query retries cleanly. (2) `iptables -A OUTPUT -p tcp --dport 5432 -j DROP` on the app host for 30 s to simulate a network partition; verify the app surfaces user-visible errors at the right rate, then recovers. (3) Full failover drill in a staging environment with a tool like Toxiproxy injecting latency and dropped connections. Each drill targets one assumption in the migration plan; doing all three before the real failover catches the bugs.

---

## 6. What NOT to say

Phrases that signal a weak candidate. Avoid them — and notice when an interviewer tees one up so you can do the opposite.

- **"`sql.Open` opens a connection."** It doesn't. `Open` parses the DSN and constructs a `*DB`; the first actual connection is made on the first query (or on `db.PingContext`). Get this wrong and the interviewer concludes you haven't read the docs.
- **"I just `defer db.Close()` and let the GC handle the rest."** `db.Close()` is for shutdown, not for per-request cleanup. The per-request things to close are `*Rows`, `*Stmt`, `*Tx`.
- **"`MaxOpenConns=200` because we have lots of traffic."** No — `MaxOpenConns` is bounded by what the database tolerates, not by your traffic. Number-of-replicas times max-open-per-replica must stay under Postgres `max_connections`.
- **"Prepared statements are always faster."** They aren't — see Q16. Senior interviewers ask this exact question to weed out the "I read a 2008 blog post" tier.
- **"Just retry on any error."** Non-idempotent writes plus blind retry equals duplicate data. Retry policies need to classify errors and confirm idempotency.
- **"We use `context.Background()` because we don't have a context."** You always have one — `r.Context()` from the HTTP request, the parent function's `ctx`, or a deliberately scoped `context.WithTimeout`. `context.Background()` in handler code is a smell.
- **"We use `lib/pq`."** Fine if it's a legacy app; signal-negative for a new project. Mention you'd choose `pgx` for new code and have a reason ready.
- **"The driver handles cancellation."** Only context-aware drivers do, and only when you pass the context through. `db.Query(...)` (no context) cannot be cancelled at all.
- **"`tx.Commit()` and we're done."** What if commit fails? What if the connection died mid-commit? Commit failure is a real case — the transaction may or may not have applied — and senior code handles it.
- **"I'll just add an ORM (`gorm`, `ent`) so I don't have to think about this."** ORMs sit on top of `database/sql`; they inherit every pool, statement, and context problem and add their own. Knowing the underlying layer is non-negotiable for any senior role.
- **"`SELECT *` is fine, we'll fix it later."** Select-star plus `Scan` into a struct means a column reorder in the database silently shifts values into wrong fields, and adding a column adds invisible network cost on every query. Be explicit: `SELECT id, name, created_at` always.
- **"We don't need an index because the table is small."** Tables grow. The right time to add the index is at schema design; retrofitting after a slow-query incident is more expensive. "Small now" is not a reason to skip the index.
- **"We'll figure out replicas in v2."** Read/write splitting is a refactor that touches every query. Plan for it at v1 — even if you only have one database, expose `readDB` and `writeDB` (aliased to the same `*sql.DB`) in the repository layer so the boundary exists. Adding the split later is a project; expressing it now is a function rename.
- **"`pgx` is for advanced users."** It's the modern default. `lib/pq` is what you use when you've already shipped on it. New projects on `lib/pq` in 2026 is a yellow flag in code review.

---

## 7. Five-minute pre-interview checklist

Run through this list the morning of the interview. If you can't recite the answer in one breath, look it up.

1. **The pool lifecycle.** `sql.Open` constructs, lazy connect, `db.PingContext` forces a connect. `MaxOpenConns` ceilings. `MaxIdleConns` keeps warm. `ConnMaxLifetime` recycles. `ConnMaxIdleTime` trims.
2. **The `*Rows` discipline.** Always `defer rows.Close()`. `rows.Next` auto-closes at EOF. `QueryRow` auto-closes on `Scan`. `Tx` requires `defer tx.Rollback()` (no-op after commit).
3. **The query flow.** `QueryContext` → pool checkout → driver dispatch (Queryer, Prepare+Query fallback) → arg conversion → wire round-trip → `*Rows` wrap and return. Goroutine blocks on pool checkout and on the socket.
4. **Prepared statements.** `*sql.Stmt` is a *handle*, not one statement — lazily prepares per-connection, multiplied by pool size. Hurts at low rate, helps at high rate. Scope to `*Tx` when you need predictable cost.
5. **`Tx` is one connection.** Pinned for the transaction's lifetime. Never spans connections. `defer tx.Rollback()` covers every exit path.
6. **Context everywhere.** Use `*Context` variants exclusively. Cancellation works only with context-aware drivers (`pgx`). Set `statement_timeout` at the database as a backstop.
7. **`driver.ErrBadConn`.** Sentinel for "connection was dead before the query started." `database/sql` retries up to 2 times on a different connection. Drivers must only return it when the operation definitely didn't start.
8. **Pool tuning.** `MaxIdleConns` should equal `MaxOpenConns`. `MaxOpenConns` is bounded by `Postgres.max_connections / replicas`. `ConnMaxLifetime` 5–30 min. Export `db.Stats()` to Prometheus.
9. **Replica lag.** Reads tolerate staleness or they don't — tag per endpoint. Read-your-writes window after a write routes back to the primary. Two `*sql.DB` instances, routing in the repository layer.
10. **`pgx` over `lib/pq`** for any new project. Better cancellation, better types, active maintenance. Migrate existing code via the `stdlib` adapter first, native API later.
11. **Retry classification.** Network errors (`ECONNRESET`, `io.EOF`) — retry idempotent reads. SQLSTATE `40001`/`40P01` — retry transactions. SQLSTATE `08006`/`57P01`/`57P03` — retry with pool drain. Everything else — bubble up.
12. **Failover discipline.** Aggressive `ConnMaxLifetime`. Drain the pool on `08006`. Idempotent writes only for failover retry. Session-aware proxy (PgBouncer, pgcat) is the right architectural place for connection migration.
13. **What NOT to say.** Re-read section 6. The interviewer is listening for "I know this depth" markers, and reciting these badly is the fastest disqualifier.
14. **Tracing and observability.** `application_name` per-connection for `pg_stat_activity` correlation. SQL comments (`/* traceid=... */`) for trace-to-slow-log joins. `db.Stats()` as Prometheus metrics — `WaitCount`, `WaitDuration`, `MaxIdleClosed`, `MaxLifetimeClosed`, `InUse`, `Idle`.
15. **Driver registration.** Blank import (`_ "github.com/jackc/pgx/v5/stdlib"`) runs `init` and calls `sql.Register`. Then `sql.Open("pgx", dsn)` finds it by name. Wrapping a driver under a new name (instrumentation, sharding) is the canonical extension point.
16. **`Scanner` and `Valuer`.** Implement `Scan(any) error` and `Value() (driver.Value, error)` on your domain types (`UUID`, `Money`, `JSONB`) so they round-trip through `database/sql` without per-call conversion code. The compiler enforces them at the type-assertion boundary; missing them surfaces as runtime conversion errors.
17. **Outbox and idempotency for distributed atomicity.** `database/sql` doesn't do XA, and you don't need it. Write the message and the database state in the same transaction (transactional outbox), let a relay deliver the message, and design consumers to be idempotent. Saga-style compensation handles the rest.
18. **Common production tunables for a Postgres app at 1k QPS.** `MaxOpenConns=15` per replica × 10 replicas behind PgBouncer transaction-pool of 20. `MaxIdleConns=15` (match open). `ConnMaxLifetime=15m`. `ConnMaxIdleTime=2m`. Per-query `context.WithTimeout(ctx, 5*time.Second)`. Postgres `statement_timeout=8s` as backstop. `application_name=service-name`. Sqlcommenter for trace correlation. These are starting points, not gospel — measure under your real load.
19. **`Conn` and `SessionResetter`.** `db.Conn(ctx)` gives you a `*sql.Conn` that pins one underlying connection across multiple calls — useful for advisory locks (`pg_advisory_lock`) or session-scoped settings. Return it via `conn.Close()`. Drivers implementing `SessionResetter` get a `ResetSession` callback on check-in so per-session state is wiped before reuse.
20. **One last sanity check.** If the interviewer says "the pool is the bottleneck," ask which metric — `WaitCount`, `WaitDuration`, or `InUse` at limit. The right answer is always "show me the metric"; jumping straight to "raise max-open" without measurement is the junior tell.
21. **Know one war story.** Have one production incident you can describe in 60 seconds — pool starvation from a missing `rows.Close`, a slow query that ate every connection, a PgBouncer transaction-pool incompatibility with `pgx`'s prepared statements. Interviewers grade on whether you've actually run a database in production; a concrete story is the strongest possible signal.
22. **Be honest about gaps.** If you've never operated Postgres at scale, say so — say what you have done (built `database/sql` apps, read the source, run staging benchmarks) and what you'd want to learn. Faked production stories are the easiest thing to catch under follow-up questions. Honest gaps with a learning path beat invented expertise every time.
23. **Quick verbal recap if asked "summarise database/sql in one sentence".** A driver-pluggable connection pool plus statement, transaction, and context plumbing — the policy lives in `database/sql`, the wire protocol lives in the driver, the application talks to neither directly.

---

## 8. Further reading

- **`src/database/sql/sql.go`**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/database/sql/sql.go> — the pool, statement, and transaction implementation. Read `DB.conn`, `DB.queryDC`, and `connectionRequest` for the pool internals.
- **`src/database/sql/driver/driver.go`**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/database/sql/driver/driver.go> — the driver interface surface. Note `QueryerContext`, `ExecerContext`, `ConnPrepareContext`, `Pinger`, `SessionResetter`, `Validator`.
- **`pgx` documentation**: <https://pkg.go.dev/github.com/jackc/pgx/v5> — the canonical modern Postgres driver. Read the `pgxpool` package for the native pool design, which is a useful contrast to `database/sql`'s.
- **Go database tutorial**: <https://go.dev/doc/database/> — the official tutorial, modernised in 2022. Short, accurate, and the right starting point for anyone less than expert.
- **"Common Pitfalls When Using `database/sql` in Go"**: <https://www.alexedwards.net/blog/configuring-sqldb> — Alex Edwards' pool-tuning post, the canonical reference for `MaxIdleConns` / `MaxOpenConns` / `ConnMaxLifetime` defaults.
- **`otelsql` instrumentation wrapper**: <https://github.com/XSAM/otelsql> — wraps any `database/sql` driver with OpenTelemetry tracing and metrics. Read the `Stats` exporter for the canonical mapping from `db.Stats()` to Prometheus metrics.
- **Sqlcommenter convention**: <https://google.github.io/sqlcommenter/> — the standard for embedding trace IDs and service tags into SQL comments, supported across multiple drivers and database vendors. The pattern to use for joining app traces to database slow logs.
- **PgBouncer pooling modes**: <https://www.pgbouncer.org/features.html> — session, transaction, and statement pooling, with the trade-offs each makes on prepared statements, `SET LOCAL`, and connection state. Required reading before deploying PgBouncer in front of a `database/sql` app.
- **"How to write a SQL driver in Go"**: <https://medium.com/@matryer/golang-advent-calendar-day-eleven-persisting-data-with-a-database-driver-bbb71c95466e> — Mat Ryer's walk through implementing the `driver.Driver` interface from scratch. The right tutorial for understanding what `database/sql` actually expects from a driver.
