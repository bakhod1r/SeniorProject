---
layout: default
title: database/sql Pool — Find the Bug
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/find-bug/
---

# database/sql Connection Pool — Find the Bug

[← Back](../)

> Each snippet has a real concurrency bug related to the `database/sql` pool. Find it, explain it, fix it.

---

## Bug 1 — Forgotten `rows.Close()`

```go
func listActive(db *sql.DB) ([]int, error) {
    rows, err := db.Query("SELECT id FROM users WHERE active = true")
    if err != nil {
        return nil, err
    }
    var ids []int
    for rows.Next() {
        var id int
        if err := rows.Scan(&id); err != nil {
            return nil, err   // BUG: leaks rows + conn
        }
        ids = append(ids, id)
    }
    return ids, nil
}
```

**Bug.** Two leaks. (1) The function returns inside the loop on scan error without `rows.Close()`. (2) Even on the success path, `rows.Err()` is never checked, and if the iteration ends with a driver error the conn may still be alive but unreleased.

**Fix.**
```go
func listActive(db *sql.DB) ([]int, error) {
    rows, err := db.Query("SELECT id FROM users WHERE active = true")
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var ids []int
    for rows.Next() {
        var id int
        if err := rows.Scan(&id); err != nil {
            return nil, err
        }
        ids = append(ids, id)
    }
    return ids, rows.Err()
}
```

Defer guarantees release on every exit. `rows.Err()` surfaces iteration-time driver errors.

---

## Bug 2 — Concurrent `Rows.Next`

```go
func parallelScan(db *sql.DB) {
    rows, _ := db.Query("SELECT id FROM big_table")
    defer rows.Close()

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for rows.Next() {     // BUG: data race
                var id int
                rows.Scan(&id)
            }
        }()
    }
    wg.Wait()
}
```

**Bug.** `*sql.Rows` is not goroutine-safe. Four goroutines calling `Next` and `Scan` on the same `*sql.Rows` race on the internal cursor and the `lastcols` buffer.

**Fix.** Run one goroutine over `rows` and fan out the *parsed* rows to workers via a channel.

```go
func parallelScan(db *sql.DB) {
    rows, _ := db.Query("SELECT id FROM big_table")
    defer rows.Close()

    ch := make(chan int, 100)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for id := range ch {
                process(id)
            }
        }()
    }
    for rows.Next() {
        var id int
        if err := rows.Scan(&id); err != nil { close(ch); break }
        ch <- id
    }
    close(ch)
    wg.Wait()
}
```

---

## Bug 3 — Long transaction with `context.Background()`

```go
func updateAll(db *sql.DB) error {
    tx, err := db.BeginTx(context.Background(), nil)
    if err != nil {
        return err
    }
    for i := 0; i < 1_000_000; i++ {
        if _, err := tx.Exec("UPDATE t SET x = $1 WHERE id = $2", i, i); err != nil {
            return err   // BUG: tx leaked
        }
    }
    return tx.Commit()
}
```

**Bugs.** (1) On exec error, `tx` is leaked — never rolled back, conn pinned forever. (2) `context.Background()` means the tx survives program shutdown signals; SIGINT cannot abort it.

**Fix.**
```go
func updateAll(ctx context.Context, db *sql.DB) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()  // no-op if Commit succeeded
    for i := 0; i < 1_000_000; i++ {
        if _, err := tx.ExecContext(ctx, "UPDATE t SET x = $1 WHERE id = $2", i, i); err != nil {
            return err
        }
    }
    return tx.Commit()
}
```

---

## Bug 4 — `defer rows.Close()` inside a loop

```go
func fanOutQueries(db *sql.DB, ids []int) error {
    for _, id := range ids {
        rows, err := db.Query("SELECT col FROM t WHERE id = $1", id)
        if err != nil {
            return err
        }
        defer rows.Close()   // BUG: accumulates defers
        for rows.Next() {
            // ...
        }
    }
    return nil
}
```

**Bug.** Every iteration adds a deferred `Close`. If `len(ids) == 10_000`, ten thousand `*sql.Rows` stay open until the outer function returns. Pool runs dry.

**Fix.** Wrap the body in a closure:

```go
func fanOutQueries(db *sql.DB, ids []int) error {
    for _, id := range ids {
        err := func() error {
            rows, err := db.Query("SELECT col FROM t WHERE id = $1", id)
            if err != nil {
                return err
            }
            defer rows.Close()
            for rows.Next() { /* ... */ }
            return rows.Err()
        }()
        if err != nil {
            return err
        }
    }
    return nil
}
```

Or use `db.QueryRow` if you only ever expect one row per id.

---

## Bug 5 — `MaxIdleConns == 0` with bursty traffic

```go
func main() {
    db, _ := sql.Open("postgres", dsn)
    db.SetMaxOpenConns(100)
    // BUG: MaxIdleConns defaults to 2 unless set; programmer "secured" it to 0
    db.SetMaxIdleConns(0)
    // ... serve HTTP ...
}
```

**Bug.** With `MaxIdleConns=0`, every conn closes immediately after the goroutine returns it. The next query opens a fresh one (TLS handshake, auth, ~3 ms each). Throughput collapses to the dial rate.

**Fix.** Set `MaxIdleConns` close to `MaxOpenConns` for steady workloads (or at least to the steady-state working set):

```go
db.SetMaxIdleConns(100)
```

Trade-off: more idle conns means more memory on the database side. For most apps this is the right trade.

---

## Bug 6 — Shared `*sql.Conn`

```go
type Service struct {
    conn *sql.Conn
}

func NewService(ctx context.Context, db *sql.DB) (*Service, error) {
    c, err := db.Conn(ctx)
    if err != nil {
        return nil, err
    }
    return &Service{conn: c}, nil
}

func (s *Service) handle(ctx context.Context, id int) error {
    _, err := s.conn.ExecContext(ctx, "INSERT INTO log VALUES ($1)", id)
    return err
}
```

**Bug.** Multiple HTTP handler goroutines call `s.handle` concurrently against the same `*sql.Conn`. `database/sql` serializes through the per-conn mutex, but that means every other goroutine blocks behind the in-flight query — pool capacity collapses to 1 conn worth of throughput. And if any internal driver state assumes single-goroutine use, you get corruption.

**Fix.** Don't hoard a `*sql.Conn`. Use `*sql.DB` for stateless work; only use `*sql.Conn` for an explicit session scope (advisory lock, temp table) — and obtain a fresh one per scope.

```go
func (s *Service) handle(ctx context.Context, id int) error {
    _, err := s.db.ExecContext(ctx, "INSERT INTO log VALUES ($1)", id)
    return err
}
```

---

## Bug 7 — Calling `db.Stats()` from a hot path

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    if db.Stats().InUse > 80 {     // BUG: lock contention
        http.Error(w, "busy", 503)
        return
    }
    // ... real work ...
}
```

**Bug.** `db.Stats()` takes `db.mu`. Calling it on every request creates contention on the same mutex that gates `(*DB).conn` and `(*DB).putConn`. Under load, your "backpressure" mechanism becomes the bottleneck.

**Fix.** Sample at a fixed rate (every 100 ms) in a background goroutine and store the result atomically:

```go
var saturation atomic.Int64
go func() {
    for range time.Tick(100 * time.Millisecond) {
        saturation.Store(int64(db.Stats().InUse))
    }
}()

func handleRequest(w http.ResponseWriter, r *http.Request) {
    if saturation.Load() > 80 {
        http.Error(w, "busy", 503)
        return
    }
    // ...
}
```

---

## Bug 8 — Tx commit, then exec

```go
func transfer(ctx context.Context, db *sql.DB) error {
    tx, _ := db.BeginTx(ctx, nil)
    defer tx.Rollback()

    if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal - 10 WHERE id = 1"); err != nil {
        return err
    }
    if err := tx.Commit(); err != nil {
        return err
    }

    // log to audit table
    _, err := tx.ExecContext(ctx, "INSERT INTO audit VALUES (...)")  // BUG: ErrTxDone
    return err
}
```

**Bug.** After `tx.Commit()`, all operations on `tx` return `sql.ErrTxDone`. The audit insert is lost.

**Fix.** Either include the audit insert in the transaction (preferred for atomicity), or do it after with `db.ExecContext` (not `tx.ExecContext`):

```go
func transfer(ctx context.Context, db *sql.DB) error {
    tx, _ := db.BeginTx(ctx, nil)
    defer tx.Rollback()

    if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal - 10 WHERE id = 1"); err != nil {
        return err
    }
    if _, err := tx.ExecContext(ctx, "INSERT INTO audit VALUES (...)"); err != nil {
        return err
    }
    return tx.Commit()
}
```

---

## Bug 9 — Context done but query still running

```go
func slow(ctx context.Context, db *sql.DB) (int, error) {
    ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel()

    var n int
    // 5-second query
    err := db.QueryRowContext(ctx, "SELECT pg_sleep(5), 1").Scan(&n)
    return n, err
}

func main() {
    db, _ := sql.Open("postgres", dsn)
    db.SetMaxOpenConns(2)
    for i := 0; i < 100; i++ {
        slow(context.Background(), db)
    }
}
```

**Bug.** Each `slow` ctx is canceled at 100 ms, but the driver may or may not be able to abort the in-flight `pg_sleep(5)`. With the `lib/pq` driver pre-1.10, the conn was returned to the pool while still busy; later queries would then hit `ErrBadConn`. Even with current drivers, the cancellation costs a round-trip and the conn may need to be discarded.

**Fix.** Test that your driver honors `QueryContext` cancellation (modern `pgx` does cleanly). And set the ctx timeout at the entry point, not deep inside; bubble the cancellation up so the caller can react.

---

## Bug 10 — `*sql.Stmt` close inside a loop

```go
func bulk(ctx context.Context, db *sql.DB, items []Item) error {
    for _, it := range items {
        stmt, err := db.PrepareContext(ctx, "INSERT INTO t (a, b) VALUES ($1, $2)")
        if err != nil {
            return err
        }
        defer stmt.Close()  // BUG: leaks stmts AND grows defers
        if _, err := stmt.ExecContext(ctx, it.A, it.B); err != nil {
            return err
        }
    }
    return nil
}
```

**Bugs.** Prepares one stmt per item (defeating the purpose), and accumulates one defer per item. With 1 million items, 1 million prepared stmts on the database side.

**Fix.** Prepare once, reuse:

```go
func bulk(ctx context.Context, db *sql.DB, items []Item) error {
    stmt, err := db.PrepareContext(ctx, "INSERT INTO t (a, b) VALUES ($1, $2)")
    if err != nil {
        return err
    }
    defer stmt.Close()
    for _, it := range items {
        if _, err := stmt.ExecContext(ctx, it.A, it.B); err != nil {
            return err
        }
    }
    return nil
}
```

Even better: a single `INSERT ... VALUES (...), (...), ...` with batched params, or a driver-specific `COPY` (Postgres `pgx.CopyFrom`).
