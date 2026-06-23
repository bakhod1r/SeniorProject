# database/sql — Optimization

## 1. How to use this file

Fourteen scenarios where `database/sql` code burns latency, allocations, or connections that a small change recovers. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, `lib/pq` / `pgx-stdlib` against a Postgres 16 instance on the same host. Numbers are reproducible-shape — run `go test -bench=. -benchmem` plus `pg_stat_statements` on your hardware before quoting them. The four signatures of a sick `database/sql` app are: round-trip count per request (network RTT × N), `runtime.mallocgc` on row scans, `sql.Stmt` re-parse cost on the server, and connection-pool exhaustion under load. Most wins here remove one of those four. Reading order: Ex. 1, 4, 5, then any order. Ex. 9, 10, 14 are the ones most senior reviews flag.

---

## 2. Exercise 1 — N+1 query for related rows

A handler lists 500 users then loops to fetch each user's `org_name` — one query per user, 501 round-trips, 100 ms total on a 0.2 ms-per-RTT link.

```go
func ListUsersWithOrg(ctx context.Context, db *sql.DB) ([]UserView, error) {
    rows, err := db.QueryContext(ctx, `SELECT id, org_id, name FROM users LIMIT 500`)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []UserView
    for rows.Next() {
        var u UserView
        if err := rows.Scan(&u.ID, &u.OrgID, &u.Name); err != nil { return nil, err }
        var orgName string
        if err := db.QueryRowContext(ctx,
            `SELECT name FROM orgs WHERE id = $1`, u.OrgID).Scan(&orgName); err != nil {
            return nil, err
        }
        u.OrgName = orgName
        out = append(out, u)
    }
    return out, rows.Err()
}
```

```
BenchmarkN1Lookup-8   12   98000000 ns/op   240000 B/op   3500 allocs/op   // 501 round-trips
```

<details><summary>After</summary>

Collect distinct `org_id`s, fetch all org names in one `IN (...)` query, attach by map. Two round-trips total.

```go
func ListUsersWithOrg(ctx context.Context, db *sql.DB) ([]UserView, error) {
    rows, err := db.QueryContext(ctx, `SELECT id, org_id, name FROM users LIMIT 500`)
    if err != nil { return nil, err }
    var users []UserView
    seen := map[int64]struct{}{}
    var ids []int64
    for rows.Next() {
        var u UserView
        if err := rows.Scan(&u.ID, &u.OrgID, &u.Name); err != nil { rows.Close(); return nil, err }
        if _, ok := seen[u.OrgID]; !ok { seen[u.OrgID] = struct{}{}; ids = append(ids, u.OrgID) }
        users = append(users, u)
    }
    rows.Close()
    if err := rows.Err(); err != nil { return nil, err }

    orgs := make(map[int64]string, len(ids))
    if len(ids) > 0 {
        q, args := buildInClause(`SELECT id, name FROM orgs WHERE id IN`, ids) // $1,$2,...
        r2, err := db.QueryContext(ctx, q, args...)
        if err != nil { return nil, err }
        for r2.Next() {
            var id int64; var name string
            if err := r2.Scan(&id, &name); err != nil { r2.Close(); return nil, err }
            orgs[id] = name
        }
        r2.Close()
        if err := r2.Err(); err != nil { return nil, err }
    }
    for i := range users { users[i].OrgName = orgs[users[i].OrgID] }
    return users, nil
}
```

```
BenchmarkInBatch-8   1100   1080000 ns/op   62000 B/op   320 allocs/op
```

~90× faster, ~11× fewer allocs.

**Why faster:** Per-query cost is dominated by RTT + parse + plan, not row return. Going from 501 to 2 round-trips removes 499 RTTs and 499 plans. The second query returns at most 500 rows in one TCP burst; the planner sees a stable shape and caches it.
**Trade-off:** `IN (...)` argument lists have a practical ceiling — Postgres handles thousands, but at ~1000 args the planner spends more time on the predicate; chunk in batches of 500-1000. Two-query shape means the result isn't a single atomic snapshot — fine for read-mostly views, surprising if orgs mutate mid-scan. For deeper joins, prefer a real `JOIN` and let the planner choose hash vs nested-loop.
**When NOT:** Joined data needed once or twice — not worth a second query. Inner data lives on a different DB / service — N+1 becomes M batches across the network. Strict per-user transactional consistency required without `REPEATABLE READ`.
</details>

---

## 3. Exercise 2 — `db.Query` to read a single row

A `db.Query` returns a `*Rows` that must be iterated and closed. For known single-row results, this allocates a cursor, holds a connection until `Close`, and forces the caller to handle "0 rows" via `rows.Next()` returning `false`.

```go
func GetUserName(ctx context.Context, db *sql.DB, id int64) (string, error) {
    rows, err := db.QueryContext(ctx, `SELECT name FROM users WHERE id = $1`, id)
    if err != nil { return "", err }
    defer rows.Close()
    if !rows.Next() { return "", sql.ErrNoRows }
    var name string
    if err := rows.Scan(&name); err != nil { return "", err }
    return name, rows.Err()
}
```

```
BenchmarkQueryOneRow-8   18000   65000 ns/op   3800 B/op   45 allocs/op
```

<details><summary>After</summary>

`QueryRow` returns a `*Row` that buffers the single result and releases the connection on `Scan`. No cursor lifecycle, simpler error path — `sql.ErrNoRows` returned by `Scan`.

```go
func GetUserName(ctx context.Context, db *sql.DB, id int64) (string, error) {
    var name string
    err := db.QueryRowContext(ctx, `SELECT name FROM users WHERE id = $1`, id).Scan(&name)
    return name, err
}
```

```
BenchmarkQueryRow-8   24000   48000 ns/op   1100 B/op   18 allocs/op
```

~1.35× faster, ~3.5× fewer allocs.

**Why faster:** `QueryRow` skips the `*Rows` state machine (next/close pump) and reads exactly one row; the driver releases the conn immediately after the row arrives. No `defer rows.Close()` frame, no `rows.Next()` materialization of an empty second row.
**Trade-off:** Lost early access to row-level metadata (`ColumnTypes`). If the query unexpectedly returns >1 row, only the first is read and the rest are discarded silently — add `LIMIT 1` defensively if the predicate isn't a primary key.
**When NOT:** Query may return zero or many rows depending on input — `Query` keeps both shapes uniform. Need explicit access to `rows.ColumnTypes()` for dynamic Scan. Driver-specific behaviors that only surface on `*Rows` (some custom row hooks).
</details>

---

## 4. Exercise 3 — Re-preparing the same statement on every call

A repository calls `db.PrepareContext` per request. Each call costs a server round-trip (Postgres `PARSE`), heap-allocates a `*sql.Stmt`, and never reuses the parsed plan.

```go
func (r *UserRepo) Get(ctx context.Context, id int64) (User, error) {
    stmt, err := r.db.PrepareContext(ctx, `SELECT id, name FROM users WHERE id = $1`)
    if err != nil { return User{}, err }
    defer stmt.Close()
    var u User
    err = stmt.QueryRowContext(ctx, id).Scan(&u.ID, &u.Name)
    return u, err
}
```

```
BenchmarkPreparePerCall-8   9000   130000 ns/op   2400 B/op   38 allocs/op
```

<details><summary>After</summary>

Prepare once at repo construction; reuse the `*sql.Stmt` across calls. `database/sql` rebinds the prepared statement to whichever conn it gets — safe across the pool.

```go
type UserRepo struct {
    db      *sql.DB
    getByID *sql.Stmt
}

func NewUserRepo(ctx context.Context, db *sql.DB) (*UserRepo, error) {
    stmt, err := db.PrepareContext(ctx, `SELECT id, name FROM users WHERE id = $1`)
    if err != nil { return nil, err }
    return &UserRepo{db: db, getByID: stmt}, nil
}

func (r *UserRepo) Get(ctx context.Context, id int64) (User, error) {
    var u User
    err := r.getByID.QueryRowContext(ctx, id).Scan(&u.ID, &u.Name)
    return u, err
}
```

```
BenchmarkPrepareCached-8   24000   48000 ns/op   1100 B/op   18 allocs/op
```

~2.7× faster, ~2× fewer allocs, server-side parse cost amortized across all calls.

**Why faster:** The PARSE/BIND/EXEC sequence for a prepared statement skips PARSE on every subsequent call — only BIND/EXEC fly. `*sql.Stmt` maintains a per-conn cached prepared handle inside the pool and re-prepares only on new conns.
**Trade-off:** A long-lived `*sql.Stmt` ties the repo to a `*sql.DB` for its lifetime; closing the DB without closing the stmt leaks. Some drivers (notably pgx in stdlib mode) auto-prepare and cache plans already — measure before adding this layer. Schema changes that invalidate the prepared plan surface as `ErrBadConn` once per conn; the pool retries transparently.
**When NOT:** One-shot queries (admin scripts, migrations). Queries whose SQL text varies per call — see Ex. 4 for placeholders. pgx in native mode already statement-caches; double-prepare is wasted.
</details>

---

## 5. Exercise 4 — `fmt.Sprintf`-built query (also: SQL injection)

A handler interpolates the user's input directly into the SQL. The query string changes per request, defeats the statement cache, and lets a hostile caller drop tables.

```go
func FindUser(ctx context.Context, db *sql.DB, name string) (User, error) {
    q := fmt.Sprintf(`SELECT id, name FROM users WHERE name = '%s'`, name)
    var u User
    err := db.QueryRowContext(ctx, q).Scan(&u.ID, &u.Name)
    return u, err
}
```

```
BenchmarkSprintfQuery-8   8000   140000 ns/op   3600 B/op   55 allocs/op
// Plus: ' OR '1'='1 returns every user; '; DROP TABLE users; -- ends your day.
```

<details><summary>After</summary>

Use placeholders (`$1` for pgx/lib/pq, `?` for MySQL/SQLite). The driver sends the SQL and the values separately; the server parses once and binds.

```go
func FindUser(ctx context.Context, db *sql.DB, name string) (User, error) {
    var u User
    err := db.QueryRowContext(ctx,
        `SELECT id, name FROM users WHERE name = $1`, name).Scan(&u.ID, &u.Name)
    return u, err
}
```

```
BenchmarkPlaceholder-8   24000   48000 ns/op   1100 B/op   18 allocs/op
```

~2.9× faster, ~3× fewer allocs, injection eliminated.

**Why faster:** A stable SQL string lets the server cache the plan (and `database/sql` cache the prepared statement). The interpolated form forced PARSE per call because each query text was unique. Bytes on the wire shrink too — the value arrives in BIND, not embedded in the statement.
**Trade-off:** Placeholders don't work for identifier positions (table names, column names) — those need a whitelist + `fmt.Sprintf` from a trusted set. `IN (...)` lists need one placeholder per value; libraries like `sqlx.In` or `pgx`'s array types help. Postgres uses `$1, $2`; MySQL/SQLite use `?`; abstract behind a builder if cross-db.
**When NOT:** Bona-fide identifier interpolation — but then validate against a whitelist, never trust input. Generating one-off ad-hoc admin reports where the SQL truly is dynamic — quote with `pq.QuoteIdentifier`. Never skip this for any user-influenced value.
</details>

---

## 6. Exercise 5 — `MaxOpenConns` left at default (unlimited)

`sql.Open` returns a pool with `MaxOpenConns = 0` (unlimited). Under burst load with 2000 in-flight requests, each opens its own conn; Postgres `max_connections = 100` rejects with `FATAL: sorry, too many clients`. Even before that, hundreds of idle conns inflate the database's backend memory.

```go
db, err := sql.Open("pgx", dsn)
if err != nil { return nil, err }
// no pool tuning — defaults
return db, nil
```

```
// Under 2000 concurrent goroutines:
// pq: FATAL: sorry, too many clients already
// p99 latency: 8400 ms; error rate: 38%
```

<details><summary>After</summary>

Cap at roughly 2-4× CPU count of the database, or 25% of `max_connections` if shared with other services. Pair with `MaxIdleConns` so the pool reuses warm conns.

```go
db, err := sql.Open("pgx", dsn)
if err != nil { return nil, err }
db.SetMaxOpenConns(32)                  // ~2-4× DB cpu count
db.SetMaxIdleConns(32)                  // keep them warm
db.SetConnMaxIdleTime(5 * time.Minute)  // recycle idle conns
return db, nil
```

```
// Under 2000 concurrent goroutines (same workload):
// p99 latency: 180 ms; error rate: 0%; backend mem: stable.
```

p99 drops ~45×, no `too many clients`, DB backend memory stays bounded.

**Why faster:** Postgres allocates ~10 MB per backend process; thousands of conns saturate RAM and starve work_mem. With a fixed pool, requests queue in Go (cheap) instead of forking new server processes (expensive). Reused warm conns skip TCP/TLS handshake (~1-3 ms each) and the server-side auth round-trip.
**Trade-off:** Queueing means individual requests may wait for a conn; tail latency is bounded by `pool_wait_time`. Sizing too low starves throughput; sizing too high starves the DB. Start at `2 × DB cores`, watch `sql.DBStats.WaitCount` and `WaitDuration` in metrics. For PgBouncer in transaction mode, the Go pool can be larger because pgbouncer multiplexes.
**When NOT:** Single-tenant local dev DB where you'll never hit the cap. Background-job processes that genuinely need to fan out — but even then, use a sized pool, not unlimited. Drivers that maintain their own pool (rare in `database/sql` mode).
</details>

---

## 7. Exercise 6 — `ConnMaxLifetime` left at 0 (forever)

A pool with `ConnMaxLifetime = 0` reuses conns indefinitely. Behind an AWS RDS proxy or any DNS-based failover, old conns keep pointing at the failed primary long after DNS flips. Also: long-lived conns leak server-side memory through prepared-statement caches and accumulated `pg_stat_statements` chatter.

```go
db.SetMaxOpenConns(32)
db.SetMaxIdleConns(32)
// db.SetConnMaxLifetime(0)  // implicit default — forever
```

```
// After RDS failover (~30s DNS TTL):
// 19 of 32 conns still routed to dead host
// 60% error rate for ~8 minutes until manual restart
```

<details><summary>After</summary>

Cap conn lifetime so the pool rotates through DNS. Five minutes is a common starting point; pair with `ConnMaxIdleTime` for idle eviction.

```go
db.SetMaxOpenConns(32)
db.SetMaxIdleConns(32)
db.SetConnMaxLifetime(5 * time.Minute)   // hard rotation
db.SetConnMaxIdleTime(2 * time.Minute)   // idle eviction
```

```
// After RDS failover:
// All conns drained within ~5 min, no manual intervention
// Recovery window: ~3 min average
```

Pool drains stale conns automatically; failover recovery 2-3× faster.

**Why faster (or: more correct):** The pool's internal `connectionCleaner` runs on `ConnMaxLifetime / 4` and forcibly retires conns past their lifetime. Without it, only error-driven `ErrBadConn` retries discover the dead host. Five minutes is a balance: short enough to absorb DNS changes, long enough that handshakes amortize across thousands of queries.
**Trade-off:** New conns pay TCP/TLS/auth setup; setting lifetime too low (< 30s) makes handshake cost dominant. Misalignment with PgBouncer's own conn lifecycle can churn through pgbouncer-side conns. With a sidecar pooler that handles failover, lifetime can be longer.
**When NOT:** Long-lived dev/test setups where stability beats failover. Direct-connect setups with no DNS layer and no expected failover. Highly latency-sensitive paths where handshake cost is intolerable — then keep lifetime long and rely on connection-health checks elsewhere.
</details>

---

## 8. Exercise 7 — Allocating a new struct per scanned row

A reader allocates `&User{}` on every iteration. For 100k-row scans, that's 100k separate heap objects passed to `Scan`, plus per-iteration `defer` and slice growth.

```go
func LoadUsers(ctx context.Context, db *sql.DB) ([]*User, error) {
    rows, err := db.QueryContext(ctx, `SELECT id, name, email FROM users`)
    if err != nil { return nil, err }
    defer rows.Close()
    var users []*User
    for rows.Next() {
        u := &User{} // 100k heap allocs
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil { return nil, err }
        users = append(users, u)
    }
    return users, rows.Err()
}
```

```
BenchmarkScanAllocPerRow-8   8   140000000 ns/op   38000000 B/op   400000 allocs/op
```

<details><summary>After</summary>

Use a reusable stack-local struct; copy into the output slice (which is one heap allocation, grown by `append`). The driver's `Scan` writes through pointers — no heap requirement.

```go
func LoadUsers(ctx context.Context, db *sql.DB) ([]User, error) {
    rows, err := db.QueryContext(ctx, `SELECT id, name, email FROM users`)
    if err != nil { return nil, err }
    defer rows.Close()
    users := make([]User, 0, 1024) // pre-size if known
    var u User                      // stack-local, reused
    for rows.Next() {
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil { return nil, err }
        users = append(users, u)    // copy, no escape
    }
    return users, rows.Err()
}
```

```
BenchmarkScanReusePtr-8   28   42000000 ns/op   11000000 B/op   200001 allocs/op
```

~3.3× faster, ~3.5× fewer allocs.

**Why faster:** `&User{}` per row escapes to the heap because the pointer is stored in the slice. A single stack-local `u` copied into a `[]User` keeps the per-iteration allocation off the heap; only `append` grows the backing array (log n times). Strings inside `User` still allocate (the driver copies `[]byte` from the row buffer into a Go string), but that's unavoidable for non-mutable strings.
**Trade-off:** Returning `[]User` instead of `[]*User` doubles per-element size when `User` is large; for >128-byte structs, `[]*User` with an arena (or `sync.Pool`) is better. Mutating one entry through the slice mutates the slice's storage, not a separately owned object — usually fine, occasionally surprising.
**When NOT:** Heterogeneous post-processing where each row is consumed alone (don't bother accumulating). Very large structs (KB+) where copy cost dominates; in that case pool the structs. Streaming consumers that emit rows downstream without retention — see Ex. 8.
</details>

---

## 9. Exercise 8 — Buffering an entire result set into memory

A handler runs `SELECT * FROM events` (5 GB), accumulates all rows in a slice, then writes JSON to the response. Peak memory doubles (slice + serialized form), GC stalls multiply, and the client waits for the whole query before seeing a byte.

```go
func DumpEvents(ctx context.Context, db *sql.DB, w io.Writer) error {
    rows, err := db.QueryContext(ctx, `SELECT id, ts, payload FROM events`)
    if err != nil { return err }
    defer rows.Close()
    var all []Event
    for rows.Next() {
        var e Event
        if err := rows.Scan(&e.ID, &e.TS, &e.Payload); err != nil { return err }
        all = append(all, e)
    }
    return json.NewEncoder(w).Encode(all)
}
```

```
BenchmarkBufferAll-8   1   3800000000 ns/op   5200000000 B/op   12000000 allocs/op
// peak RSS: ~10 GB
```

<details><summary>After</summary>

Stream row-by-row to the writer. The pool conn is held longer (until last row), but memory stays bounded and the client sees data immediately.

```go
func DumpEvents(ctx context.Context, db *sql.DB, w io.Writer) error {
    rows, err := db.QueryContext(ctx, `SELECT id, ts, payload FROM events`)
    if err != nil { return err }
    defer rows.Close()
    enc := json.NewEncoder(w)
    io.WriteString(w, "[")
    first := true
    var e Event
    for rows.Next() {
        if err := rows.Scan(&e.ID, &e.TS, &e.Payload); err != nil { return err }
        if !first { io.WriteString(w, ",") }
        first = false
        if err := enc.Encode(e); err != nil { return err }
    }
    io.WriteString(w, "]")
    return rows.Err()
}
```

```
BenchmarkStreamRows-8   3   1400000000 ns/op   84000 B/op   400 allocs/op
// peak RSS: ~60 MB
```

~2.7× faster, ~60000× less peak memory.

**Why faster:** `json.Marshal(all)` rebuilds a 5 GB string in `bytes.Buffer`, reallocating up the geometric ladder. Streaming writes each encoded row straight to the wire; the backing buffer stays small (the encoder's chunk). GC scan time drops because there is no live multi-GB slice.
**Trade-off:** The conn stays held for the duration of the scan; if the handler is slow at writing (slow client), the conn is wasted on TCP backpressure — use a `context.WithTimeout` defensively. Errors mid-stream leave partial JSON on the wire; document the response shape and add a server-side trailer or chunked-encoding error marker for clients.
**When NOT:** Result set known to be small (< 10k rows, < 10 MB) — buffering is simpler and lets you set `Content-Length`. Need to sort or transform across the whole set before emitting (top-N, aggregations) — let the DB do it via `ORDER BY` / `GROUP BY` instead. Clients can't handle streaming JSON.
</details>

---

## 10. Exercise 9 — One transaction per write in a batch

A loader inserts 10k rows by opening a transaction per row, ending up with 10k `BEGIN`/`COMMIT` pairs and 10k WAL flushes (`fsync`). Postgres tops out at ~5000 commits/sec on a fast NVMe drive — and you're committing 10k.

```go
func InsertEvents(ctx context.Context, db *sql.DB, events []Event) error {
    for _, e := range events {
        tx, err := db.BeginTx(ctx, nil)
        if err != nil { return err }
        if _, err := tx.ExecContext(ctx,
            `INSERT INTO events (id, ts, payload) VALUES ($1, $2, $3)`,
            e.ID, e.TS, e.Payload); err != nil {
            tx.Rollback(); return err
        }
        if err := tx.Commit(); err != nil { return err }
    }
    return nil
}
```

```
BenchmarkTxPerRow-8   1   2100000000 ns/op   3200000 B/op   60000 allocs/op  // 10k rows, ~4800 commits/s
```

<details><summary>After</summary>

Wrap the batch in a single transaction. One `BEGIN`, one `COMMIT`, one `fsync` (or one WAL flush group). Postgres throughput becomes inserts-per-second, not commits-per-second.

```go
func InsertEvents(ctx context.Context, db *sql.DB, events []Event) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback() // safe — no-op if Commit succeeded

    stmt, err := tx.PrepareContext(ctx,
        `INSERT INTO events (id, ts, payload) VALUES ($1, $2, $3)`)
    if err != nil { return err }
    defer stmt.Close()

    for _, e := range events {
        if _, err := stmt.ExecContext(ctx, e.ID, e.TS, e.Payload); err != nil {
            return err
        }
    }
    return tx.Commit()
}
```

```
BenchmarkOneTxBatch-8   25   45000000 ns/op   140000 B/op   600 allocs/op
```

~46× faster, ~100× fewer allocs.

**Why faster:** Each `COMMIT` triggers WAL `fsync`, the slowest thing the database does. Batching shares the fsync across all inserts. Prepared statement inside the tx skips re-PARSE per row. Network round-trips for BEGIN/COMMIT drop from 20k to 2.
**Trade-off:** A single failing row aborts the whole batch (or use `SAVEPOINT` per row, but the WAL win disappears). Large transactions hold locks longer — bad for high-contention tables. Long-running transactions block VACUUM in Postgres; chunk into 1k-5k per tx for very large loads.
**When NOT:** Writes are independent and each must succeed/fail alone — autocommit-per-row is correct. Multi-statement units where logic between statements needs the prior commit visible (rare; usually wrong). Long-running streams where you don't know the batch end up front — chunk by time window.
</details>

---

## 11. Exercise 10 — `INSERT` per row instead of batched insert

Even inside one transaction (Ex. 9), inserting 10k rows with 10k `INSERT` statements pays parse + network + per-row plan overhead × 10k. A single multi-value INSERT or `COPY` runs an order of magnitude faster.

```go
// Already in one tx; still 10k INSERTs:
stmt, _ := tx.PrepareContext(ctx,
    `INSERT INTO events (id, ts, payload) VALUES ($1, $2, $3)`)
for _, e := range events {
    stmt.ExecContext(ctx, e.ID, e.TS, e.Payload)
}
```

```
BenchmarkInsertPerRowInTx-8   25   45000000 ns/op   140000 B/op   600 allocs/op
```

<details><summary>After</summary>

Multi-row `VALUES (...), (...), (...)` — one statement, all rows. For >5k rows or large payloads, use Postgres `COPY FROM STDIN` via `pgx`'s `CopyFrom`.

```go
// Multi-row INSERT (good up to ~5k rows / 65535 params Postgres limit):
func InsertEventsBatch(ctx context.Context, db *sql.DB, events []Event) error {
    if len(events) == 0 { return nil }
    args := make([]any, 0, len(events)*3)
    var sb strings.Builder
    sb.WriteString(`INSERT INTO events (id, ts, payload) VALUES `)
    for i, e := range events {
        if i > 0 { sb.WriteByte(',') }
        n := i * 3
        fmt.Fprintf(&sb, "($%d,$%d,$%d)", n+1, n+2, n+3)
        args = append(args, e.ID, e.TS, e.Payload)
    }
    _, err := db.ExecContext(ctx, sb.String(), args...)
    return err
}

// For huge loads, prefer pgx COPY:
//   _, err := pgxConn.CopyFrom(ctx, pgx.Identifier{"events"},
//       []string{"id","ts","payload"}, pgx.CopyFromRows(rows))
```

```
BenchmarkMultiRowInsert-8   180   6300000 ns/op   72000 B/op   55 allocs/op   // VALUES form
BenchmarkCopyFrom-8         500   2100000 ns/op   12000 B/op   18 allocs/op   // pgx COPY
```

VALUES form ~7× faster than prepared-per-row; `COPY` ~21× faster.

**Why faster:** A multi-row VALUES sends one PARSE/BIND/EXEC for the entire batch; Postgres internally walks the value list with one plan. `COPY FROM STDIN` skips SQL parsing entirely — it's a pure data-stream protocol with minimal per-row server cost.
**Trade-off:** Postgres caps prepared-statement parameters at 65535 — for 3-column rows, that's ~21k rows per multi-row insert; chunk accordingly. `COPY` skips per-row triggers (well, it doesn't, but it bypasses some checks) and doesn't return per-row generated keys easily — use `RETURNING` carefully. SQL `VALUES` form is portable; `COPY` is Postgres-specific.
**When NOT:** Heterogeneous inserts (different tables / columns per row). Inserts requiring server-side defaults that depend on prior row state. Tiny batches (< 50 rows) where the win is invisible.
</details>

---

## 12. Exercise 11 — `db.PingContext` in the request hot path

A handler calls `db.PingContext` at the start of every request to "make sure the DB is up". This costs one round-trip per request even when the pool's conns are warm and the DB is healthy.

```go
func Handler(ctx context.Context, db *sql.DB, w http.ResponseWriter, r *http.Request) {
    if err := db.PingContext(r.Context()); err != nil {
        http.Error(w, "db unavailable", http.StatusServiceUnavailable)
        return
    }
    // ... actual handler work
}
```

```
BenchmarkHandlerWithPing-8   12000   95000 ns/op   400 B/op   5 allocs/op
// Plus: extra round-trip per request, +0.2 ms p50 on local DB, +5 ms on cross-AZ DB.
```

<details><summary>After</summary>

Skip the per-request ping. The pool reports `ErrBadConn` on broken conns and the driver retries on a different one. Health checks belong in a periodic goroutine (or PgBouncer / RDS Proxy / sidecar) that reports liveness to a `/healthz` endpoint.

```go
// In main(): start a background health probe at startup.
go func() {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for range t.C {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        healthy := db.PingContext(ctx) == nil
        cancel()
        dbHealthy.Store(healthy)
    }
}()

// Handler: no ping. Let real queries surface real errors.
func Handler(ctx context.Context, db *sql.DB, w http.ResponseWriter, r *http.Request) {
    // ... handler work; database/sql retries on ErrBadConn internally.
}
```

```
BenchmarkHandlerNoPing-8   24000   48000 ns/op   200 B/op   3 allocs/op
```

~2× faster handler, one fewer round-trip per request.

**Why faster:** A ping is a no-op query (Postgres responds with `ParameterStatus`). It costs one full RTT plus driver-side ack. Removing it from the hot path saves that RTT × QPS. The pool's `ErrBadConn` retry logic catches truly dead conns on the next real query — no liveness signal is lost.
**Trade-off:** A pool with one freshly broken conn lets one request fail before retry kicks in; that's fine for 99.9% targets, not for hard real-time. Periodic health goroutine has its own bugs (clock skew, goroutine leak on shutdown); pair with `errgroup`.
**When NOT:** Health endpoints (`/healthz`) themselves — ping is the right primitive there. Startup probe: ping once at boot, panic if the DB is unreachable. Specific code paths where you must confirm liveness before a non-idempotent operation.
</details>

---

## 13. Exercise 12 — Context with no deadline on long queries

A handler passes `context.Background()` (or the request context with no inner deadline) to a query. A pathological query that scans the whole table holds the conn until either the client disconnects or the server kills it via `statement_timeout`. Result: a few slow queries exhaust the pool.

```go
func Search(ctx context.Context, db *sql.DB, q string) ([]Result, error) {
    rows, err := db.QueryContext(ctx,
        `SELECT id, title FROM docs WHERE title ILIKE '%' || $1 || '%'`, q)
    if err != nil { return nil, err }
    defer rows.Close()
    // ... no deadline, no protection against runaway queries
}
```

```
// Under load with 0.1% pathological queries scanning 50M rows:
// Pool wait p99: 4200 ms (waiting for stuck conns to free)
// Healthy request p99: 8000 ms (queued behind pathological ones)
```

<details><summary>After</summary>

Wrap with a query-specific timeout. The driver sends a cancel to the server (`pg_cancel_backend`-equivalent), the conn returns to the pool, and the runaway query stops billing CPU.

```go
func Search(ctx context.Context, db *sql.DB, q string) ([]Result, error) {
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()

    rows, err := db.QueryContext(ctx,
        `SELECT id, title FROM docs WHERE title ILIKE '%' || $1 || '%'`, q)
    if err != nil { return nil, err }
    defer rows.Close()
    // ... process rows; ctx.Err() == DeadlineExceeded on timeout
}
```

```
// Same workload, 500ms per-query timeout:
// Pool wait p99: 18 ms
// Healthy request p99: 120 ms
// 0.1% requests fail fast with DeadlineExceeded
```

Pool wait p99 drops ~230×; tail latency bounded.

**Why faster:** Without a deadline, one runaway query blocks one conn for tens of seconds; with concurrency above pool size, healthy requests queue. With a per-query deadline, pool turnover stays steady at ~500 ms worst-case. Server-side, the driver issues a `CANCEL` request that aborts the running query — wasted work, but bounded.
**Trade-off:** Some queries need >500 ms legitimately — set per-endpoint deadlines, not global. The cancel itself isn't free (~1 ms round-trip) and isn't instantaneous; the server checks for cancellation between operators. Cancelling mid-transaction may leave the conn in an aborted state — `database/sql` recycles it.
**When NOT:** Batch jobs and ETL where queries are expected to run for minutes — set deadlines per stage, not per query, and use `statement_timeout` at the role/connection level. Cron/admin scripts where you want full completion.
</details>

---

## 14. Exercise 13 — Closing `rows` late (deferred until function exit)

A function consumes a `Rows`, then does ~50 ms of additional work before returning. The `defer rows.Close()` holds the pool conn for that extra 50 ms — multiply by request rate and the pool fills with conns whose rows are already drained.

```go
func ProcessUsers(ctx context.Context, db *sql.DB) error {
    rows, err := db.QueryContext(ctx, `SELECT id, name FROM users`)
    if err != nil { return err }
    defer rows.Close() // released only on function return
    var users []User
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name)
        users = append(users, u)
    }
    if err := rows.Err(); err != nil { return err }

    // 50ms of CPU work — conn still held
    summary := expensiveAnalysis(users)
    return saveSummary(ctx, summary) // grabs another conn from a now-smaller pool
}
```

```
BenchmarkLateClose-8   3000   55000000 ns/op   28000 B/op   320 allocs/op
// Pool conn held: ~52 ms total per call
```

<details><summary>After</summary>

Close `rows` immediately after the loop. The conn returns to the pool while CPU work proceeds.

```go
func ProcessUsers(ctx context.Context, db *sql.DB) error {
    rows, err := db.QueryContext(ctx, `SELECT id, name FROM users`)
    if err != nil { return err }
    var users []User
    var u User
    for rows.Next() {
        if err := rows.Scan(&u.ID, &u.Name); err != nil { rows.Close(); return err }
        users = append(users, u)
    }
    closeErr := rows.Close()                                 // release conn here
    if err := rows.Err(); err != nil { return err }
    if closeErr != nil { return closeErr }

    // Pool conn already free; CPU work doesn't block other requests
    summary := expensiveAnalysis(users)
    return saveSummary(ctx, summary)
}
```

```
BenchmarkEarlyClose-8   3200   52000000 ns/op   28000 B/op   320 allocs/op
// Pool conn held: ~2 ms (the query loop itself)
// Net effect under concurrency: ~25× more concurrent capacity in the same pool
```

Single-shot benchmark looks similar; pool throughput at concurrency rises sharply because conns recycle ~25× faster.

**Why faster:** `database/sql` returns a conn to the pool on `rows.Close` (or implicit close when `Next` returns false on the last row — but only if no error). Until then, the conn is exclusive. Holding it past the loop is wasted exclusivity.
**Trade-off:** Manual close means you must close on every error path — easy to leak. A common compromise: `defer rows.Close()` immediately after `Query`, then call `rows.Close()` explicitly when done; the second call is a no-op. Lint with `errcheck` or `bodyclose` (rowserrcheck) to catch leaks.
**When NOT:** Functions short enough that `defer` close happens microseconds later. Code where the post-loop work also issues queries (you'd hold a conn anyway). Test code where pool exhaustion isn't a concern.
</details>

---

## 15. Exercise 14 — `sql.Open` per request

A misread of the API leads to `sql.Open` per request — each call creates a new pool (not a new conn — a new pool). Each pool opens its own conns; nothing is shared; conns leak because the pool is never closed.

```go
func Handler(w http.ResponseWriter, r *http.Request) {
    db, err := sql.Open("pgx", dsn) // new pool every request
    if err != nil { http.Error(w, err.Error(), 500); return }
    // no db.Close() — leaks the pool
    // ... use db
}
```

```
// Under 1000 RPS:
// Conn count climbs unbounded until 'too many clients'
// p99: 6800 ms; error rate ramps to 100% within 90s
```

<details><summary>After</summary>

`sql.Open` returns a *pool*. Open once at startup, share via DI, close on shutdown.

```go
// main.go
db, err := sql.Open("pgx", dsn)
if err != nil { log.Fatal(err) }
defer db.Close()
db.SetMaxOpenConns(32); db.SetMaxIdleConns(32); db.SetConnMaxLifetime(5*time.Minute)
if err := db.PingContext(context.Background()); err != nil { log.Fatal(err) }

srv := &http.Server{Handler: NewHandler(db)}
// pass `db` to handlers via closures / struct fields

// Handler
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // h.db is the shared pool — no Open here
    rows, _ := h.db.QueryContext(r.Context(), `SELECT ...`)
    defer rows.Close()
    // ...
}
```

```
// Same workload:
// Conn count stable at 32
// p99: 110 ms; error rate: 0%
```

p99 drops ~60×; conn count bounded.

**Why faster:** `sql.Open` is essentially zero-cost (no conn yet — it just constructs a `*sql.DB` struct) but conns are created lazily on first use. A new pool per request defeats every reuse mechanism: prepared statements, warm TCP/TLS sessions, server-side cached plans, the pool itself. Sharing one pool means ~32 long-lived conns serve thousands of requests.
**Trade-off:** A shared pool is a shared resource — a misbehaving handler holding a conn affects everyone. Goroutine-safe by construction, but enforcement of per-handler etiquette (close rows, deadlines) becomes critical (Ex. 12, Ex. 13). DI plumbing for `*sql.DB` is boilerplate; accept it.
**When NOT:** Multi-tenant apps where each tenant truly needs an isolated pool (different credentials) — open one pool per tenant *at app start*, cache by tenant ID, not per request. CLI tools running a single command — `sql.Open` then `db.Close` per invocation is fine.
</details>

---

## 16. When NOT to optimize

Most of these wins matter only when the database is on the request path of a high-QPS service. If your app runs queries once a minute (cron, scheduled report, admin tool), every exercise here is irrelevant — clarity beats nanoseconds. CLI tools, one-shot migrations, test fixtures: leave the code obvious.

**Profile first.** Database/sql cost has four signatures: high `WaitCount` / `WaitDuration` in `db.Stats()` → Ex. 5 (pool too small) or Ex. 13 (conns held too long); `runtime.mallocgc` on row-scan stacks → Ex. 7 or Ex. 8; high `pg_stat_statements.calls` for the same query text with low `mean_exec_time` → Ex. 3 (re-prepare) or Ex. 5 (handshake churn); `BEGIN` showing up as a top entry in `pg_stat_statements` → Ex. 9 (tx-per-row).

**Common premature optimizations:** caching `*sql.Stmt` (Ex. 3) for a query called twice per day; `COPY FROM STDIN` (Ex. 10) for a 12-row insert; per-query timeouts (Ex. 12) on internal cron jobs that legitimately run for hours; index-by-name child caches when the join is already cheap; `MaxOpenConns` (Ex. 5) tuning before measuring `WaitCount`.

**Correctness gaps disguised as optimizations:** `IN (...)` batching (Ex. 1) that exceeds the param limit and silently truncates; `QueryRow` (Ex. 2) on queries that may legitimately return zero rows handled differently than "user not found"; cached `*sql.Stmt` (Ex. 3) that survives a schema change; `fmt.Sprintf` (Ex. 4) for any user-influenced bytes — that's a vulnerability, not a perf knob; `ConnMaxLifetime` (Ex. 6) too short, churning handshakes; struct-reuse (Ex. 7) where the struct holds a `[]byte` aliased back into the row buffer (driver-specific footgun); streaming (Ex. 8) without flushing on error, leaving truncated JSON; single-tx batch (Ex. 9) holding locks long enough to deadlock with other writers; multi-row INSERT (Ex. 10) exceeding 65535-param limit and erroring at runtime; removed ping (Ex. 11) without an alternative liveness mechanism; missing `cancel()` on `context.WithTimeout` (Ex. 12) leaking timer resources; early `rows.Close()` (Ex. 13) called twice without no-op guarantee; shared `*sql.DB` (Ex. 14) with per-tenant credentials mixed across requests.

---

## 17. Summary

**Always-ship wins** (default in any new database/sql code): one `*sql.DB` opened at startup (Ex. 14); `MaxOpenConns` set to a sane finite value (Ex. 5); `ConnMaxLifetime` set to ~5 min (Ex. 6); placeholders not `fmt.Sprintf` (Ex. 4) — always; `QueryRow` for known single-row reads (Ex. 2); deadline on every query (Ex. 12); `rows.Close()` right after consumption (Ex. 13).

**Wins behind a profile** (when measurements justify them): `IN (...)` batching to kill N+1 (Ex. 1, when round-trip count dominates); cached `*sql.Stmt` (Ex. 3, when prepare overhead shows in flame graphs); struct reuse in scan loops (Ex. 7, when `mallocgc` shows in row scans); streaming result sets (Ex. 8, when peak memory shows in RSS); one-tx batches (Ex. 9, when `COMMIT` dominates `pg_stat_statements`); multi-row INSERT / COPY (Ex. 10, when row count > 1k per batch); removing handler-path ping (Ex. 11, when per-request RTT matters).

**Specialty** (only when the design calls for it): per-tenant pool caches for multi-tenant SaaS; pgx-native mode bypassing `database/sql` for COPY/LISTEN/array types; custom retry layers on top of `database/sql` for circuit-breaker semantics; PgBouncer/RDS Proxy in front for connection multiplexing beyond what one Go pool can manage.

`database/sql` cost is round-trips, prepared-statement churn, allocations on the scan path, and pool exhaustion. Strip those four from the hot path by choosing the right primitive: `QueryRow` for singletons; batched `IN (...)` for relations; one tx for bulk writes; `COPY` for very bulk writes; finite pool, bounded conn lifetime, bounded query deadline. The library itself is well-behaved — the wins come from matching the call shape to the request shape. Profile, then pick the lever; the four signatures above tell you which one.
