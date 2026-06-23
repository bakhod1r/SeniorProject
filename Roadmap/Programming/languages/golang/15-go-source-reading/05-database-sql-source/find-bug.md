# database/sql — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of Go code using `database/sql`: open/close lifecycle, query/scan loops, transactions, prepared statements, contexts, NULL handling, pool tuning. Each one is plausible, compiles, and passes a happy-path test against a fresh SQLite database. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Snippets use the in-tree `mattn/go-sqlite3` driver (or `modernc.org/sqlite` if you avoid cgo); every reference below points at `database/sql/sql.go` or `database/sql/convert.go` in the standard library.

`database/sql` bugs almost never crash on the happy path. They leak connections that the pool only notices an hour later, hide NULLs behind zero values, race when a `*Tx` escapes a goroutine, or silently disable cancellation. Three questions to ask every snippet:

1. *Who closes the resource — `Rows`, `Stmt`, `Tx` — and does close run on every path including errors and panics?*
2. *Does this code respect the pool — one `*sql.DB` for the process, bounded `MaxOpenConns`, contexts that can cancel?*
3. *Does it handle NULLs, `ErrNoRows`, and driver-specific type conversions that `convert.go` can't paper over?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Forgot `defer rows.Close()` — connection leak

```go
func listUsers(db *sql.DB) ([]string, error) {
    rows, err := db.Query(`SELECT name FROM users`)
    if err != nil {
        return nil, err
    }
    var names []string
    for rows.Next() {
        var n string
        if err := rows.Scan(&n); err != nil {
            return nil, err               // BUG: rows never closed on error
        }
        names = append(names, n)
    }
    return names, rows.Err()              // BUG: still no Close on happy path
}
```

<details><summary>Answer</summary>

**Bug:** `rows` holds a connection from the pool until either (a) `rows.Next()` returns false and the driver auto-closes, or (b) the caller calls `rows.Close()`. Case (a) only fires if the loop drains to completion. Any early `return` — error mid-scan, `break`, panic — leaves the `*Rows` alive and the underlying `*sql.driverConn` checked out of the pool forever. After enough requests, `db.Query` blocks on `MaxOpenConns`.

**Why subtle:** Happy path drains the rowset, so `rows.Next()` returns false at the end and `database/sql/sql.go` calls `Rows.Close()` internally (`Rows.nextLocked` -> `Rows.close`). The leak only shows up when an error breaks the loop early or when `LIMIT 1` queries make the caller `break` after the first hit.

**Spot:** Any `db.Query` or `Stmt.Query` not followed within two lines by `defer rows.Close()`. Mid-function `return` between `Query` and `Close` without `defer` is the same bug.

**Fix:**

```go
rows, err := db.Query(`SELECT name FROM users`)
if err != nil { return nil, err }
defer rows.Close()                        // idempotent — safe to call after Next drains too
```

`Rows.Close` is idempotent (`sql.go`: the `closed` field gates re-entry), so the redundant call after a full drain costs nothing.

**Why common:** "The loop will drain it" reads like a complete contract, and on the happy path it is. Errors are exactly the path that breaks it. `defer rows.Close()` immediately after the error check is the only pattern that survives all exit paths.
</details>

---

## Bug 2 — Checking `rows.Err()` before `rows.Next()`

```go
rows, err := db.Query(`SELECT id FROM orders WHERE total > ?`, 100)
if err != nil { return err }
defer rows.Close()

if err := rows.Err(); err != nil {        // BUG: Err is meaningful only after Next returns false
    return err
}
for rows.Next() {
    var id int64
    rows.Scan(&id)
    process(id)
}
return nil                                // BUG: never inspects Err after the loop
```

<details><summary>Answer</summary>

**Bug:** `Rows.Err` is documented in `database/sql/sql.go` as "the error, if any, that was encountered during iteration". It is set by `Rows.Next` (and `NextResultSet`) when iteration fails. Calling `Err()` *before* `Next()` returns the zero error — the iteration hasn't run. Skipping it *after* the loop means any error that stopped iteration (network blip, deadline expiring, decode failure) is lost; the function returns `nil` and the caller thinks zero rows is the truth.

**Why subtle:** Reading "the error" sounds like an instantaneous getter. It's a post-condition. The function returns clean results on happy path; under a flaky network, half the rows are silently dropped.

**Spot:** Any `rows.Err()` call that doesn't come *after* the `for rows.Next()` loop has exited. Bare `return nil` (or `return results, nil`) after a `Next` loop without `if err := rows.Err(); err != nil { return ..., err }` is the same bug.

**Fix:**

```go
for rows.Next() {
    var id int64
    if err := rows.Scan(&id); err != nil { return err }
    process(id)
}
if err := rows.Err(); err != nil { return err }   // checked after Next returns false
return nil
```

**Why common:** Symmetry with other Go iterators (`*bufio.Scanner.Err`, `*csv.Reader.Read`'s sentinel) is real but easy to invert. The rule is uniform across the standard library: post-loop, not pre-loop.
</details>

---

## Bug 3 — Sharing a `*sql.Tx` across goroutines

```go
func transferBatch(db *sql.DB, transfers []Transfer) error {
    tx, err := db.Begin()
    if err != nil { return err }
    defer tx.Rollback()

    var wg sync.WaitGroup
    for _, t := range transfers {
        wg.Add(1)
        go func(t Transfer) {                                  // BUG: tx shared across goroutines
            defer wg.Done()
            tx.Exec(`UPDATE accounts SET bal = bal - ? WHERE id = ?`, t.Amount, t.From)
            tx.Exec(`UPDATE accounts SET bal = bal + ? WHERE id = ?`, t.Amount, t.To)
        }(t)
    }
    wg.Wait()
    return tx.Commit()
}
```

<details><summary>Answer</summary>

**Bug:** A `*sql.Tx` is pinned to one `driverConn`. Drivers are required to expose `Conn` operations that are safe under serialisation but not under concurrency — `database/sql/sql.go` enforces this with `Tx.dc.Lock()` inside `Tx.grabConn`. Multiple goroutines hammering the same `*Tx` serialise on that mutex *if you're lucky* and corrupt the wire protocol *if you're not* — the lock guards entry but driver state (statement buffers, autoincrement IDs, error flags) is not designed for interleaved writes from arbitrary goroutines. With most drivers you observe one of: spurious "bad connection" errors, mixed-up result rows, or a transaction that commits a partial set of statements.

**Why subtle:** Compiles, passes `-race` if the runtime sees only sequential `Exec` calls (the mutex hides the race from the detector), and the unit test with 2 transfers usually succeeds. Production sees 200 concurrent transfers per request and the wire goes wrong.

**Spot:** Any `*sql.Tx` (or `*sql.Stmt`, `*sql.Conn`) escaping a goroutine boundary. The single-connection invariant is the rule: one tx, one goroutine, one statement at a time.

**Fix:** Either serialise the loop (`for t := range transfers { tx.Exec(...) }`) or fan out across multiple transactions, one per goroutine:

```go
g, gctx := errgroup.WithContext(ctx)
for _, t := range transfers {
    t := t
    g.Go(func() error {
        tx, err := db.BeginTx(gctx, nil)
        if err != nil { return err }
        defer tx.Rollback()
        if _, err := tx.Exec(`...`, t.Amount, t.From); err != nil { return err }
        if _, err := tx.Exec(`...`, t.Amount, t.To);   err != nil { return err }
        return tx.Commit()
    })
}
return g.Wait()
```

That changes semantics — N small transactions rather than one big one — and that's the point: concurrency requires independence.

**Why common:** `*sql.DB` *is* goroutine-safe (it's the pool). The natural generalisation "all `database/sql` types are safe" doesn't hold for `Tx`, `Stmt`, `Conn`, or `Rows`. The pool is the only concurrency boundary.
</details>

---

## Bug 4 — Calling `db.Close()` per request — destroys the pool

```go
func handler(w http.ResponseWriter, r *http.Request) {
    db, err := sql.Open("sqlite3", "app.db")
    if err != nil { http.Error(w, err.Error(), 500); return }
    defer db.Close()                                            // BUG: pool dies on every request

    var name string
    db.QueryRow(`SELECT name FROM users WHERE id = ?`, r.URL.Query().Get("id")).Scan(&name)
    fmt.Fprintln(w, name)
}
```

<details><summary>Answer</summary>

**Bug:** `*sql.DB` *is* the pool. `sql.Open` (`database/sql/sql.go`) doesn't open a connection — it allocates a `DB` struct with a `freeConn` slice and a `connRequests` map. Connections are dialled lazily on first use and cached for reuse. Calling `db.Close()` walks `freeConn`, closes every cached connection, and marks the `DB` closed for good (`DB.closed = true`). Doing this per request means every request pays the dial cost again and the pool's whole point — connection reuse — is defeated. Under load you also hit OS-level file descriptor exhaustion and TIME_WAIT pile-ups.

**Why subtle:** Tests pass with one request at a time. The handler returns the right name. Latency looks fine in microbenchmarks because the SQLite file open is fast. Against a real network DB (PostgreSQL, MySQL), p99 is 50 ms higher than it should be and nobody knows why until you `strace` the handler.

**Spot:** Any `sql.Open` inside a per-request handler, per-job worker, or anything that runs more than once per process. `sql.Open` should appear in `main` (or a one-shot init), `db.Close` in shutdown.

**Fix:** Open once, share the `*sql.DB` (it's safe for concurrent use), close on shutdown:

```go
var db *sql.DB
func main() {
    var err error
    db, err = sql.Open("sqlite3", "app.db")
    if err != nil { log.Fatal(err) }
    db.SetMaxOpenConns(25); db.SetMaxIdleConns(25); db.SetConnMaxLifetime(5 * time.Minute)
    defer db.Close()
    http.HandleFunc("/u", handler)
    http.ListenAndServe(":8080", nil)
}
```

**Why common:** "Open a resource, defer close" is the right Go idiom for *files*. `*sql.DB` looks like a file handle and is actually a long-lived pool. The naming hides the difference; the package docs say it explicitly: "It is rare to Close a DB, as the DB handle is meant to be long-lived and shared between many goroutines."
</details>

---

## Bug 5 — SQL injection via `fmt.Sprintf`

```go
func search(db *sql.DB, name string) ([]User, error) {
    q := fmt.Sprintf(`SELECT id, name FROM users WHERE name = '%s'`, name)   // BUG
    rows, err := db.Query(q)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name); err != nil { return nil, err }
        out = append(out, u)
    }
    return out, rows.Err()
}
```

<details><summary>Answer</summary>

**Bug:** `name` is interpolated into the SQL string. An attacker passing `' OR '1'='1` makes the query `SELECT id, name FROM users WHERE name = '' OR '1'='1'` and exfiltrates the whole table. Worse with multi-statement drivers: `'; DROP TABLE users;--` and the table is gone. `fmt.Sprintf` (and `bytes.Buffer.WriteString`, and template strings) all share this hole — anything that concatenates user input into the SQL text.

**Why subtle:** Compiles, runs, and tests against benign input pass. The vulnerability is one URL parameter away. Code review can miss it because the `Sprintf` looks like "just formatting".

**Spot:** Any SQL string that isn't a constant. `database/sql.Query` and friends take placeholders precisely so the driver can send them out-of-band; if the SQL text contains a `%s` or `+ userInput +`, it's vulnerable. `sqlc`, `gosec`, and `staticcheck`'s SA1019/SA4006 catch the common shapes.

**Fix:** Parameterise — the driver escapes for you (or, better, sends values in the bind protocol so escaping is moot):

```go
rows, err := db.Query(`SELECT id, name FROM users WHERE name = ?`, name)
```

For dynamic columns or table names — which can't be parameterised — validate against an allowlist before interpolating: `if !validColumn[col] { return errBadCol }`.

**Why common:** Beginners reach for `Sprintf` because placeholders feel like a feature to learn later. Bobby Tables is twenty years old and still works. The fix is mechanical; the discipline of *never* concatenating user input into SQL is the only durable defence.
</details>

---

## Bug 6 — `Scan(&str)` against a NULL column — panic

```go
type Profile struct {
    ID   int64
    Bio  string                                                 // BUG: NULL-able column
}
func loadProfile(db *sql.DB, id int64) (Profile, error) {
    var p Profile
    err := db.QueryRow(`SELECT id, bio FROM profiles WHERE id = ?`, id).Scan(&p.ID, &p.Bio)
    return p, err                                               // returns sql: Scan error on column index 1: converting NULL to string is unsupported
}
```

<details><summary>Answer</summary>

**Bug:** `convert.go` (`database/sql/convert.go`, function `convertAssignRows`) treats `nil` source -> `*string` destination as an error: "converting NULL to string is unsupported". The schema column is nullable, the Go type is `string`, and `Scan` returns an error — no panic in modern Go, but the row is unrecoverable. With older callers that `panic(err)` it does crash; either way the read fails for any row with a NULL `bio`.

**Why subtle:** Half the rows scan fine. The bug surfaces only for rows where the optional column is unset. Schema is the source of truth; the Go side hasn't kept up.

**Spot:** Any `Scan` target that's `string`, `int64`, `float64`, `time.Time`, `bool` paired with a column the schema allows to be NULL. The convert table in `convert.go` (`strconvErr`, `errNilPtr`, the explicit `case nil:` arm in `convertAssignRows`) lists exactly which conversions accept nil — short answer: only `*sql.NullX` and `*any`.

**Fix:** Use `sql.NullString` (or `*string`, or `sql.Null[T]` in Go 1.22+):

```go
type Profile struct {
    ID  int64
    Bio sql.NullString
}
// usage: if p.Bio.Valid { fmt.Println(p.Bio.String) }
```

For DTOs you want to pass to JSON, the `*string` form serialises as `null` more cleanly; for SQL-side logic, `NullString` carries the `Valid` bit explicitly.

**Why common:** Nullable columns are documented in the schema and forgotten at the Go boundary. `string` is the "natural" type; `NullString` is verbose. The first NULL row is the first failure, often in production.
</details>

---

## Bug 7 — Prepared statement leak — `db.Prepare` in hot path without `Close`

```go
func getName(db *sql.DB, id int64) (string, error) {
    stmt, err := db.Prepare(`SELECT name FROM users WHERE id = ?`)   // BUG: every call
    if err != nil { return "", err }
    // no stmt.Close()
    var name string
    err = stmt.QueryRow(id).Scan(&name)
    return name, err
}
```

<details><summary>Answer</summary>

**Bug:** `db.Prepare` allocates a `*sql.Stmt` that, per `database/sql/sql.go`, holds one *per-connection* prepared statement on the underlying driver connection (`Stmt.cgs` map). Without `stmt.Close()`, the server-side cached statement stays registered and the `*Stmt` struct stays live in the `DB`'s tracking. Called in a loop or a hot handler, you accumulate prepared statements on every connection in the pool — most databases cap this (PostgreSQL: 'prepared statement "stmt_X" already exists' or running out of server memory). Even SQLite leaks `sqlite3_stmt` objects.

**Why subtle:** Slow leak. Tests with 100 calls pass. Production hits the limit after a million requests and starts returning errors that look like driver bugs.

**Spot:** Any `db.Prepare` not followed by `defer stmt.Close()`. Also: `db.Prepare` inside the hot path at all — `database/sql` already caches prepared statements transparently when you pass placeholders to `db.Query` / `db.Exec`, so manual `Prepare` is rarely necessary except when you want to pin a `*Stmt` long-term.

**Fix:** Either prepare once and reuse (with `defer stmt.Close()` in the owning scope), or skip `Prepare` and let `db.Query` handle it:

```go
// preferred: no manual Prepare
err := db.QueryRow(`SELECT name FROM users WHERE id = ?`, id).Scan(&name)

// or, if you really want a pinned Stmt:
var nameStmt *sql.Stmt
func init() {
    var err error
    nameStmt, err = db.Prepare(`SELECT name FROM users WHERE id = ?`)
    if err != nil { log.Fatal(err) }
}
```

**Why common:** `Prepare` looks like a performance optimisation worth doing per-call. It is the opposite — `database/sql` already prepares on your behalf inside `db.Query`, and the manual version replaces a transparent cache with an uncached leak.
</details>

---

## Bug 8 — `MaxOpenConns=0` + slow DB — connection explosion

```go
func main() {
    db, _ := sql.Open("mysql", dsn)
    // BUG: never call SetMaxOpenConns; default is 0 = unlimited
    http.HandleFunc("/r", func(w http.ResponseWriter, r *http.Request) {
        db.QueryRow(`SELECT pg_sleep(2)`).Scan(new(string))
        fmt.Fprintln(w, "ok")
    })
    http.ListenAndServe(":8080", nil)
}
```

<details><summary>Answer</summary>

**Bug:** `DB.maxOpen == 0` in `database/sql/sql.go` is the documented sentinel for unlimited. Every concurrent caller that finds no idle connection dials a new one. Behind a slow DB (a 2-second query here), 10k concurrent requests open 10k connections — server-side `max_connections` slams shut, OS file descriptors exhaust, the DB falls over. The Go process looks fine right up until the DB refuses new connections.

**Why subtle:** Default is "fast and unlimited". For small workloads it's correct. The threshold where it explodes is `(steady-state RPS) * (mean query latency)` connections — under low load, you never see the bug.

**Spot:** Any production `sql.Open` not followed by `db.SetMaxOpenConns(N)` with a sane `N` (≤ `max_connections` of the DB, divided by replica count). Same trap with `SetMaxIdleConns` (default 2 — idle connections close aggressively and you re-dial for every burst) and `SetConnMaxLifetime` (default 0 — connections live forever, eventually getting killed by the DB and surfacing as "bad connection" errors).

**Fix:** Tune all three for the expected workload:

```go
db.SetMaxOpenConns(25)                     // ≤ server max_connections / app instances
db.SetMaxIdleConns(25)                     // keep the pool warm
db.SetConnMaxLifetime(5 * time.Minute)     // rotate before DB-side timeout
db.SetConnMaxIdleTime(1 * time.Minute)     // close truly idle connections
```

25 is a starting number; benchmark for your DB and query mix.

**Why common:** The defaults are tuned for "tinker with sqlite on a laptop". The pool *exists* to bound concurrency; leaving the bound off cancels the pool's purpose. Every production `database/sql` config should call the four setters explicitly.
</details>

---

## Bug 9 — `QueryRow` + `Scan` ignoring `ErrNoRows`

```go
func getBalance(db *sql.DB, id int64) (float64, error) {
    var bal float64
    err := db.QueryRow(`SELECT balance FROM accounts WHERE id = ?`, id).Scan(&bal)
    if err == sql.ErrNoRows {
        return 0, nil                                           // BUG: zero != "missing"
    }
    return bal, err
}
```

<details><summary>Answer</summary>

**Bug:** `QueryRow` (`database/sql/sql.go`) returns a `*Row` that defers errors until `Scan`. If the query matches no rows, `Scan` returns `sql.ErrNoRows`. Treating that as `(0, nil)` collapses two distinct outcomes — "account exists with zero balance" and "account does not exist" — into one. A caller using the return to decide whether to credit an account or to create one will do the wrong thing for the missing case.

**Why subtle:** Compiles cleanly, the type signature looks correct, and tests with existing accounts pass. The bug is a semantic flattening: every "not found" is now a "found-with-zero".

**Spot:** Any `QueryRow ... Scan` followed by `if err == sql.ErrNoRows { return zero, nil }`. The zero-value collapse is the smell. Same trap with `errors.Is(err, sql.ErrNoRows)`.

**Fix:** Propagate the distinction. A typed error or a `(value, found, error)` triple both work:

```go
var ErrNotFound = errors.New("account not found")
func getBalance(db *sql.DB, id int64) (float64, error) {
    var bal float64
    err := db.QueryRow(`SELECT balance FROM accounts WHERE id = ?`, id).Scan(&bal)
    if errors.Is(err, sql.ErrNoRows) { return 0, ErrNotFound }
    if err != nil { return 0, err }
    return bal, nil
}
```

For nullable balances, combine with `sql.NullFloat64` and the absent/zero/null trichotomy is explicit.

**Why common:** `ErrNoRows` looks like an error to be handled, and "handled" reads as "swallowed to zero". It's a *signal*, not a fault — the right handling depends on the caller. Returning the signal upward is the safe default.
</details>

---

## Bug 10 — Mixing `Query` (no Close) with `Exec` — pool drains

```go
func auditAndUpdate(db *sql.DB, id int64) error {
    rows, err := db.Query(`SELECT event FROM audit WHERE user_id = ?`, id)   // BUG: never closed
    if err != nil { return err }
    if rows.Next() {
        // peek at first row, decide to update
        var ev string
        rows.Scan(&ev)
        if ev == "blocked" {
            return nil                                            // BUG: returns with rows still open
        }
    }
    _, err = db.Exec(`UPDATE users SET seen_at = NOW() WHERE id = ?`, id)
    return err                                                    // BUG: rows still open here too
}
```

<details><summary>Answer</summary>

**Bug:** Two compounding leaks. (1) `rows` is not `defer`-closed. The early `return nil` leaves the rows alive and the underlying `driverConn` checked out — `sql.go`'s `Rows.Close` is the only path back to the pool. (2) The function calls `db.Exec` while `rows` is still iterating; `Exec` needs a connection too, so the pool grants it a *different* one. Each request leaks one connection. Over time the pool drains and `db.Exec`/`db.Query` block forever on `MaxOpenConns`.

**Why subtle:** No error is returned, no goroutine panics, tests with a fresh DB pass. The pool exhaustion takes hours and looks like the database has gone slow.

**Spot:** Any `db.Query` followed by another `db.*` call without a `defer rows.Close()` (or explicit `rows.Close()`) in between. Also: any function that does `Query` then plans to `Exec` on the same connection — you can't; `database/sql` doesn't let two operations share a pinned conn unless you use `db.Conn(ctx)`.

**Fix:** Close before issuing the next operation. If you need both on the same connection (rare — usually for `LOCK` / `SET LOCAL` semantics), pin one:

```go
rows, err := db.Query(`SELECT event FROM audit WHERE user_id = ?`, id)
if err != nil { return err }
defer rows.Close()

var blocked bool
if rows.Next() {
    var ev string
    if err := rows.Scan(&ev); err != nil { return err }
    blocked = (ev == "blocked")
}
if err := rows.Err(); err != nil { return err }
rows.Close()                                                  // release conn before the Exec
if blocked { return nil }
_, err = db.Exec(`UPDATE users SET seen_at = NOW() WHERE id = ?`, id)
return err
```

**Why common:** Mixing reads and writes in one function is normal application logic; the rule that each `database/sql` operation needs its own connection is not obvious until you measure the pool. `Exec`s following an un-Closed `Query` is one of the top three sources of production pool exhaustion.
</details>

---

## Bug 11 — Transaction not rolled back on error — connection never released

```go
func charge(db *sql.DB, userID int64, amount float64) error {
    tx, err := db.Begin()
    if err != nil { return err }

    if _, err := tx.Exec(`UPDATE accounts SET bal = bal - ? WHERE id = ?`, amount, userID); err != nil {
        return err                                              // BUG: tx leaked
    }
    if _, err := tx.Exec(`INSERT INTO charges (uid, amount) VALUES (?, ?)`, userID, amount); err != nil {
        return err                                              // BUG: tx leaked
    }
    return tx.Commit()
}
```

<details><summary>Answer</summary>

**Bug:** A `*sql.Tx` pins one `driverConn` (`database/sql/sql.go`: `Tx.dc`). The connection returns to the pool only when `tx.Commit()` or `tx.Rollback()` runs — both call `Tx.close`. Returning out of the function on an error path leaves the `Tx` alive in memory and the connection checked out until GC eventually runs `Tx.cancel` via the finalizer (Go 1.20+ added finalizers as a backstop, but they fire when the GC notices, not when you want). Until then the pool is short one connection. Steady error rate = steady pool drain.

**Why subtle:** Tests on the happy path commit, the connection comes back. Error-path tests run rarely and rarely in production batches large enough to exhaust the pool. The runtime finalizer hides the leak from short test runs.

**Spot:** Any `db.Begin` (or `db.BeginTx`) without an unconditional `defer tx.Rollback()` immediately after the error check. `Rollback` after `Commit` is documented as a no-op, so the defer is always safe.

**Fix:** Defer rollback right after `Begin`:

```go
tx, err := db.Begin()
if err != nil { return err }
defer tx.Rollback()                                            // no-op if Commit already ran

if _, err := tx.Exec(`UPDATE accounts SET bal = bal - ? WHERE id = ?`, amount, userID); err != nil { return err }
if _, err := tx.Exec(`INSERT INTO charges (uid, amount) VALUES (?, ?)`, userID, amount); err != nil { return err }
return tx.Commit()
```

For functions with many branches, the helper pattern is `func withTx(db *sql.DB, ctx context.Context, fn func(*sql.Tx) error) error` that owns Begin/Commit/Rollback.

**Why common:** Manual cleanup on every error branch is forgettable. The `defer tx.Rollback()` immediately after `Begin` is the only pattern that survives refactors that add new error paths.
</details>

---

## Bug 12 — `context.Background()` to `QueryContext` — no cancellation

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rows, err := db.QueryContext(context.Background(),         // BUG: ignored request context
        `SELECT * FROM big_table`)
    if err != nil { http.Error(w, err.Error(), 500); return }
    defer rows.Close()
    // ... slow loop
}
```

<details><summary>Answer</summary>

**Bug:** `database/sql/sql.go`'s `DB.QueryContext` watches the supplied context and, when it cancels, calls the driver's `StmtCancel` / `RowsClose` to abort the query in flight. Passing `context.Background()` opts out of that machinery. When the HTTP client disconnects (closing `r.Context()`), the query keeps running on the DB for as long as it needs, holding a connection, accumulating result rows, and burning DB CPU on a result nobody will read.

**Why subtle:** The code compiles and returns correct results when the client waits patiently. The waste is invisible from the application — you only see it as "DB CPU high under load" and "connections held longer than expected".

**Spot:** Any `QueryContext` / `ExecContext` / `BeginTx` taking `context.Background()` or `context.TODO()` from a request handler, job worker, or anywhere a real context is in scope. `r.Context()` is the right input from HTTP; `ctx` from `errgroup.WithContext` from a worker pool; an explicit `context.WithTimeout` for an unbounded back-end call.

**Fix:** Propagate the request context, optionally narrowing with a timeout:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    rows, err := db.QueryContext(ctx, `SELECT * FROM big_table`)
    if err != nil { http.Error(w, err.Error(), 500); return }
    defer rows.Close()
}
```

**Why common:** `Background()` is the path of least resistance when you don't yet know about context plumbing. The non-context variants (`db.Query`, `db.Exec`) internally pass `context.Background()` for exactly the same reason — they exist for short scripts, and they should not appear in any request- or job-scoped code. `staticcheck` SA1029 / `contextcheck` lint for the misuse.
</details>

---

## Bug 13 — `Scan` before `Next` — runtime error

```go
rows, err := db.Query(`SELECT name FROM users WHERE id = ?`, id)
if err != nil { return err }
defer rows.Close()

var name string
if err := rows.Scan(&name); err != nil {                       // BUG: no Next before Scan
    return err
}
return nil
```

<details><summary>Answer</summary>

**Bug:** `Rows.Scan` (`database/sql/sql.go`) returns `errors.New("sql: Scan called without calling Next")` when `Rows.lastcols` is nil — that field is populated by `Rows.Next`. Calling `Scan` first short-circuits straight to the error path. Even for queries you *know* return exactly one row, you still need `if rows.Next()` (or use `QueryRow`, which does the iteration internally).

**Why subtle:** Compiles. The `Scan` signature accepts the call. The error message is specific enough to find, but the bug surfaces only at runtime — and only if anyone reads the returned error.

**Spot:** Any `rows.Scan` not preceded by `rows.Next()`. Equivalent to forgetting the `for` over the iterator entirely.

**Fix:** Two options. Either iterate properly:

```go
if !rows.Next() {
    if err := rows.Err(); err != nil { return err }
    return ErrNotFound
}
var name string
if err := rows.Scan(&name); err != nil { return err }
return nil
```

Or — usually nicer for single-row reads — drop `Query` for `QueryRow`, which folds `Next`+`Scan`+close-when-empty into one call:

```go
var name string
err := db.QueryRow(`SELECT name FROM users WHERE id = ?`, id).Scan(&name)
```

**Why common:** "I'm only reading one row, why bother with `Next`?" The iterator contract is uniform across 0..N rows; `Query`/`Next`/`Scan`/`Close` is one shape and `QueryRow`/`Scan` is another. Mix them and the runtime tells you.
</details>

---

## Bug 14 — `time.Time` against an `INT` timestamp column

```go
// Schema (SQLite or MySQL):
// CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);   -- stored as Unix seconds
type Event struct {
    ID int64
    At time.Time                                                // BUG: column is INT, not TIMESTAMP
}

err := db.QueryRow(`SELECT id, ts FROM events WHERE id = ?`, id).Scan(&e.ID, &e.At)
// sql: Scan error on column index 1: converting driver.Value type int64 ("1716998400") to a time.Time: unsupported Scan
```

<details><summary>Answer</summary>

**Bug:** `convert.go` (`database/sql/convert.go`, `convertAssignRows`) is type-strict for `time.Time` — the source must be a `time.Time` from the driver. Some drivers translate `TIMESTAMP`/`DATETIME` columns into `time.Time` automatically; an `INTEGER` column comes through as `int64` and `Scan` rejects the assignment with "unsupported Scan, storing driver.Value type int64 into type *time.Time". The schema decision (epoch seconds in an INT) and the Go type (`time.Time`) are mismatched.

**Why subtle:** Looks identical to schemas with native timestamp types. The same Go code works against PostgreSQL `TIMESTAMP WITH TIME ZONE`. The bug is the column type the team chose years ago that nobody re-examines.

**Spot:** Any `Scan(&someTimeVar)` paired with a column declared `INT`/`BIGINT`/`TEXT`. Also: any `Scan(&someBoolVar)` against a column declared `INTEGER` (some drivers translate, some don't — `convert.go`'s `case bool` accepts only specific source types).

**Fix:** Scan into the source type and convert explicitly, or use a `sql.Scanner` wrapper:

```go
// inline:
var ts int64
err := db.QueryRow(`SELECT id, ts FROM events WHERE id = ?`, id).Scan(&e.ID, &ts)
e.At = time.Unix(ts, 0).UTC()

// or a Scanner wrapper:
type unixSecs time.Time
func (u *unixSecs) Scan(src any) error {
    n, ok := src.(int64)
    if !ok { return fmt.Errorf("unixSecs: want int64, got %T", src) }
    *u = unixSecs(time.Unix(n, 0).UTC())
    return nil
}
// usage: var at unixSecs; db.QueryRow(...).Scan(&e.ID, &at); e.At = time.Time(at)
```

For new schemas, store timestamps in the native type the DB provides — `TIMESTAMPTZ` in PostgreSQL, `DATETIME`/`TIMESTAMP` in MySQL, ISO-8601 text in SQLite — and let the driver do the conversion.

**Why common:** Storing time as Unix epoch is a Linux-ism that survives into application schemas. `time.Time` is the natural Go type. `convert.go` won't bridge the two automatically because there's no canonical scale (seconds? millis? micros?). Explicit conversion is the only honest answer.
</details>

---

## Summary

These fourteen bugs cluster into four families.

**Lifecycle (1, 4, 7, 10, 11):** rows not closed, the DB itself closed every request, prepared statements leaked, queries left open while another op runs, transactions never rolled back. The pool is the resource — every type holding it (`Rows`, `Stmt`, `Tx`) must return it explicitly. `defer X.Close()` immediately after the error check is the only pattern that survives all exit paths.

**Concurrency and pool tuning (3, 8, 12):** sharing `*Tx` across goroutines, leaving `MaxOpenConns` unbounded, ignoring context cancellation. `*sql.DB` is the only concurrency-safe handle; everything else is single-goroutine. The pool exists to bound concurrency — leaving its bounds unset cancels its purpose. Contexts are how callers reclaim work that's no longer wanted.

**Iteration and error semantics (2, 9, 13):** `rows.Err` before `Next`, `ErrNoRows` collapsed to zero, `Scan` without `Next`. The iterator contract is exact: `Next` before `Scan`, `Err` after the loop, `ErrNoRows` is a signal not a swallow. Same shape as `bufio.Scanner`; same discipline.

**Conversion and injection (5, 6, 14):** SQL injection from `fmt.Sprintf`, NULL into `string`, `time.Time` against an INT column. `database/sql` parameterises for you, `convert.go` is strict about NULL and types, and schema choices made years ago drive the Scanner code you write today.

Review checklist for any `database/sql` PR:

- [ ] Does every `db.Query` / `Stmt.Query` have `defer rows.Close()` on the very next line after the error check?
- [ ] Is `rows.Err()` checked *after* the `for rows.Next()` loop exits, not before, and is the error propagated rather than dropped?
- [ ] Is `*sql.DB` opened once at program start and closed at shutdown — never per-request — and are `MaxOpenConns`, `MaxIdleConns`, `ConnMaxLifetime`, `ConnMaxIdleTime` all set explicitly?
- [ ] Does every SQL string use placeholders (`?`, `$1`) for user input — never `fmt.Sprintf` or string concatenation — and are dynamic identifiers (table/column names) validated against an allowlist?
- [ ] Does every nullable column scan into `sql.NullX` (or `*T`), and does every `time.Time` / `bool` scan target match a column type the driver actually maps?
- [ ] Are `*sql.Tx`, `*sql.Stmt`, `*sql.Conn`, `*sql.Rows` each confined to one goroutine, with no goroutine fan-out sharing them?
- [ ] Does every `db.Begin` have an unconditional `defer tx.Rollback()` immediately after the error check, with `tx.Commit()` as the success-path final statement?
- [ ] Does every database call use the `*Context` variant with a real `context.Context` (request, errgroup, or `WithTimeout`), never `context.Background()` in a handler or worker?
- [ ] Does `QueryRow ... Scan` propagate `sql.ErrNoRows` as a distinct outcome rather than collapsing it to a zero value, and does `Query ... Scan` always call `rows.Next()` before `rows.Scan(...)`?
- [ ] Is `db.Prepare` reserved for long-lived `*Stmt`s with an explicit `defer stmt.Close()` — and avoided in hot paths where `db.Query` already prepares transparently?
