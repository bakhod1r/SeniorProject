# database/sql Source Reading — Practice Tasks

Twenty exercises to build hands-on intuition for Go's `database/sql` package — from "open a SQLite DB and scan a row" to "implement a custom driver and reason about pool exhaustion under load". The goal is not to memorise the API; it is to read the actual stdlib source (`$GOROOT/src/database/sql/`) and develop a model of how `DB`, `Conn`, `Stmt`, `Tx`, and the pool reaper interact. By the time you finish Task 20 you should be able to draw the pool state machine on a whiteboard from memory and explain why `ErrBadConn` is special.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution. Read `junior.md` first — the difference between a `*sql.DB` (a pool handle) and a `*sql.Conn` (one specific connection) is the spine of every task below. The exercises force you to live with that distinction.

Difficulty tags: **J**unior, **M**iddle, **S**enior, **Staff**.

Source files referenced repeatedly:

- `$GOROOT/src/database/sql/sql.go` — the `DB`, `Conn`, `Tx`, `Stmt`, `Rows` types and the pool logic.
- `$GOROOT/src/database/sql/convert.go` — `convertAssign`, the heart of `Scan`.
- `$GOROOT/src/database/sql/driver/driver.go` — the interfaces every driver implements.

Set `GOROOT=$(go env GOROOT)` once at the top of every terminal session before grepping.

---

## Task 1 — Open a SQLite DB and scan a single row (J)

**Goal.** Open a SQLite database (modernc.org/sqlite — pure Go, no CGo), create a `users` table, insert one row, run a `SELECT`, and scan the result into Go variables. Print them. This is the "hello world" of `database/sql`; every later task assumes you have the muscle memory.

**Starter.**

```go
package main

import (
    "database/sql"
    "fmt"
    "log"

    _ "modernc.org/sqlite" // registers the "sqlite" driver
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    // TODO: create the table, insert a row, SELECT it, Scan into vars.
}
```

**Hints.**

- `sql.Open` does NOT actually connect. It only validates the driver name. Call `db.Ping()` if you want to fail fast on a bad DSN.
- `QueryRow` + `Scan` is the one-row shortcut. It never returns `sql.ErrNoRows` until you actually call `Scan` — the error is deferred.
- The blank import (`_ "modernc.org/sqlite"`) is what runs the driver's `init()` and registers it. Without it, `sql.Open("sqlite", ...)` returns "unknown driver".

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatalf("open: %v", err)
    }
    defer db.Close()

    // Senior decision: Ping with a deadline. sql.Open is lazy — without
    // Ping you only discover bad DSNs on the first query. With Ping +
    // context you get a fail-fast startup check that won't hang forever
    // if the DB is unreachable.
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := db.PingContext(ctx); err != nil {
        log.Fatalf("ping: %v", err)
    }

    if _, err := db.ExecContext(ctx, `
        CREATE TABLE users (
            id    INTEGER PRIMARY KEY,
            name  TEXT NOT NULL,
            email TEXT NOT NULL
        )
    `); err != nil {
        log.Fatalf("create: %v", err)
    }

    if _, err := db.ExecContext(ctx,
        `INSERT INTO users(name, email) VALUES (?, ?)`,
        "Ada Lovelace", "ada@example.com",
    ); err != nil {
        log.Fatalf("insert: %v", err)
    }

    var (
        id    int64
        name  string
        email string
    )
    err = db.QueryRowContext(ctx,
        `SELECT id, name, email FROM users WHERE name = ?`,
        "Ada Lovelace",
    ).Scan(&id, &name, &email)
    if err != nil {
        // Senior decision: distinguish ErrNoRows from real DB errors.
        // The former is a normal "not found"; the latter is operational.
        // Conflating them is the single most common bug in Go DB code.
        if err == sql.ErrNoRows {
            log.Println("no user found")
            return
        }
        log.Fatalf("query: %v", err)
    }
    fmt.Printf("id=%d name=%q email=%q\n", id, name, email)
}
```

Run it: `go run main.go`. Expected output: `id=1 name="Ada Lovelace" email="ada@example.com"`.

Read after running: `sql.go` lines containing `func (db *DB) QueryRowContext`. Notice that it returns a `*Row`, not an error — `Row.Scan` is where the error surfaces. That deferral is intentional: it lets `QueryRow().Scan(...)` chain in one expression. Trace what `QueryRowContext` actually does — it calls `QueryContext`, then wraps the returned `*Rows` in a `*Row` that closes the iterator on `Scan`.

</details>

---

## Task 2 — Exec an INSERT and check RowsAffected (J)

**Goal.** Use `db.ExecContext` to run a multi-row UPDATE and inspect the returned `sql.Result`. Call `RowsAffected()` and `LastInsertId()`. Understand which drivers support which (SQLite supports both; PostgreSQL does NOT support `LastInsertId` — you must use `RETURNING`).

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    ctx := context.Background()
    db.ExecContext(ctx, `CREATE TABLE items (id INTEGER PRIMARY KEY, price INTEGER)`)
    for i := 1; i <= 5; i++ {
        db.ExecContext(ctx, `INSERT INTO items(price) VALUES (?)`, i*100)
    }
    // TODO: bulk UPDATE all items WHERE price < 400; print RowsAffected.
    _ = log.Println
    _ = fmt.Println
}
```

**Hints.**

- `Result` is just an interface: `LastInsertId() (int64, error)` and `RowsAffected() (int64, error)`. Either may return "not supported" depending on the driver.
- Always check `err` from `RowsAffected()` — a driver that does not support it returns a real error, not zero.
- The "rows affected" semantic is driver-defined. MySQL with `CLIENT_FOUND_ROWS` returns matched-vs-modified differently than PG. Read the driver docs.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    must(db.ExecContext(ctx, `CREATE TABLE items (id INTEGER PRIMARY KEY, price INTEGER)`))
    for i := 1; i <= 5; i++ {
        must(db.ExecContext(ctx, `INSERT INTO items(price) VALUES (?)`, i*100))
    }

    // Senior decision: capture the Result and ALWAYS check both calls.
    // A driver that returns LastInsertId == -1 + nil error is also a thing
    // — RowsAffected and LastInsertId are not contractually guaranteed
    // to be meaningful; they're driver hints.
    res, err := db.ExecContext(ctx,
        `UPDATE items SET price = price * 2 WHERE price < ?`, 400)
    if err != nil {
        log.Fatalf("update: %v", err)
    }
    affected, err := res.RowsAffected()
    if err != nil {
        // Senior decision: tolerate "not supported" gracefully. Some
        // drivers (especially over odd protocols) return an error here.
        // Log it; don't crash the request.
        log.Printf("RowsAffected unsupported: %v", err)
    } else {
        fmt.Printf("rows affected: %d\n", affected)
    }
    last, err := res.LastInsertId()
    if err != nil {
        log.Printf("LastInsertId unsupported: %v", err)
    } else {
        fmt.Printf("last insert id (UPDATE has none meaningful): %d\n", last)
    }

    // Compare with a real INSERT.
    res, _ = db.ExecContext(ctx, `INSERT INTO items(price) VALUES (?)`, 999)
    last, _ = res.LastInsertId()
    fmt.Printf("after INSERT, LastInsertId = %d\n", last)

    // PostgreSQL note: with lib/pq or pgx the LastInsertId call returns
    // (0, errors.New("LastInsertId is not supported by this driver")).
    // The canonical PG workaround is `INSERT ... RETURNING id` + Scan.
    _ = errors.New
}

func must(_ sql.Result, err error) {
    if err != nil {
        log.Fatal(err)
    }
}
```

Output:

```
rows affected: 3
last insert id (UPDATE has none meaningful): 3
after INSERT, LastInsertId = 6
```

Read after running: search `sql.go` for `type Result interface`. Three lines. Then look at how `*sql.execResult` (the wrapper) just forwards to `driver.Result`. The stdlib does not enforce semantics — that contract lives in each driver.

</details>

---

## Task 3 — Iterate Rows with Next + Scan + Close (J)

**Goal.** Run a multi-row `SELECT`, iterate with `rows.Next()`, scan each row, check `rows.Err()` at the end, and close in a deferred call. Demonstrate that forgetting `rows.Close()` leaves a connection checked out (we will weaponise this in Task 17).

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"

    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    ctx := context.Background()
    db.ExecContext(ctx, `CREATE TABLE nums (n INTEGER)`)
    for i := 1; i <= 5; i++ {
        db.ExecContext(ctx, `INSERT INTO nums(n) VALUES (?)`, i)
    }
    // TODO: SELECT n FROM nums WHERE n % 2 = 0; print each.
    _ = log.Println
}
```

**Hints.**

- The canonical loop: `for rows.Next() { ... } ; if err := rows.Err(); err != nil { ... }`.
- `defer rows.Close()` is mandatory. `Next` returning false does not always close the iterator — only the natural end of iteration does. An early `return` skips the implicit close.
- A second `Query` on the same `*sql.DB` while `rows` is open can block waiting for a free connection. This is Task 17's bug in slow motion.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    if _, err := db.ExecContext(ctx, `CREATE TABLE nums (n INTEGER)`); err != nil {
        log.Fatal(err)
    }
    for i := 1; i <= 5; i++ {
        if _, err := db.ExecContext(ctx, `INSERT INTO nums(n) VALUES (?)`, i); err != nil {
            log.Fatal(err)
        }
    }

    rows, err := db.QueryContext(ctx, `SELECT n FROM nums WHERE n % 2 = 0 ORDER BY n`)
    if err != nil {
        log.Fatalf("query: %v", err)
    }
    // Senior decision: defer Close immediately after the Query check.
    // Putting it later opens a window where an early return leaks the
    // connection. The defer is "next physical line after err check" —
    // no exceptions.
    defer rows.Close()

    for rows.Next() {
        var n int
        if err := rows.Scan(&n); err != nil {
            log.Fatalf("scan: %v", err)
        }
        fmt.Printf("n=%d\n", n)
    }
    // Senior decision: rows.Err() AFTER the loop is mandatory. The loop
    // condition Next() returns false for EITHER end-of-rows or error.
    // Without rows.Err() you cannot tell which. Forgetting this is how
    // partial-result bugs slip past testing.
    if err := rows.Err(); err != nil {
        log.Fatalf("iter: %v", err)
    }
}
```

Output:

```
n=2
n=4
```

Read after running: `sql.go`, search for `func (rs *Rows) Next() bool`. It calls `nextLocked`, which on driver error sets `rs.lasterr` — that's what `rows.Err()` reads. Then trace `func (rs *Rows) Close() error` — it releases the connection back to the pool via `rs.releaseConn`. The whole point of Close is "give the conn back". Without it, the conn sits in `rs` forever.

</details>

---

## Task 4 — Read sql.go and locate the DB struct (J)

**Goal.** Open `$GOROOT/src/database/sql/sql.go` and find the `DB` struct definition. List its fields and write a one-line comment for each, then identify which fields collectively constitute "the pool". This is a reading exercise — no code to write.

**Starter.** (no code; this task is a structured read)

```bash
grep -n '^type DB struct' "$(go env GOROOT)/src/database/sql/sql.go"
```

**Hints.**

- The pool is not a separate type. It is a set of fields on `DB`: `freeConn`, `connRequests`, `numOpen`, `openerCh`, `closed`, `maxIdle`, `maxOpen`, `maxLifetime`, `maxIdleTime`.
- The `connectionOpener` goroutine is started in `OpenDB`. Find it and follow what it does.
- The mutex `mu sync.Mutex` guards the pool fields. Note the comment about lock ordering.

<details><summary>Reference solution</summary>

This task has no code. You are building a mental model of the stdlib type. Here is the annotated field list as of Go 1.22 (verify against your own `$GOROOT`; the exact layout drifts version-to-version):

```go
type DB struct {
    // Atomic numeric counters first — atomic.* needs 8-byte alignment on
    // 32-bit platforms, hence the documented "must be first" hack.
    waitDuration atomic.Int64 // total time waited for new connections

    connector driver.Connector // produces fresh connections
    numClosed atomic.Uint64    // closed-since-start counter for stats

    mu           sync.Mutex    // protects fields below
    freeConn     []*driverConn // IDLE pool — LIFO most-recent-first
    connRequests map[uint64]chan connRequest // pending acquirers, waked by put
    nextRequest  uint64        // next key for connRequests
    numOpen      int           // OPEN counter (used + idle)

    // openerCh is the bridge: connectionOpener pulls from it and creates
    // a fresh driver.Conn for each token, respecting maxOpen.
    openerCh    chan struct{}
    closed      bool
    dep         map[finalCloser]depSet // tracks who depends on what
    lastPut     map[*driverConn]string // debug-only: where each conn was last released
    maxIdleCount int                   // SetMaxIdleConns
    maxOpen      int                   // SetMaxOpenConns
    maxLifetime  time.Duration         // SetConnMaxLifetime
    maxIdleTime  time.Duration         // SetConnMaxIdleTime
    cleanerCh    chan struct{}         // signals the reaper to wake
    waitCount    int64                 // total connections waited for
    maxIdleClosed int64                // conns closed because freeConn was full
    maxIdleTimeClosed int64            // conns closed by idle reaper
    maxLifetimeClosed int64            // conns closed by lifetime reaper

    stop func() // called by Close to cancel background goroutines
}
```

Pool fields = anything touched under `db.mu`. The reaper goroutine (`db.connectionCleaner`) and the opener goroutine (`db.connectionOpener`) are started once in `OpenDB`. The reaper sleeps on `cleanerCh` + a timer; the opener sleeps on `openerCh`.

Lock ordering rule (from comments in sql.go): never hold `db.mu` while calling into a driver. Drivers can block; the mutex must not be the thing that blocks pool acquisition.

Write this annotation as a comment block at the top of your own `pool.md` or in your reading notes. The next eight tasks will reference these fields by name.

</details>

---

## Task 5 — SetMaxOpenConns / SetMaxIdleConns / observe DBStats (M)

**Goal.** Configure the pool with low limits, hammer it with a small concurrent workload, and print `DBStats` snapshots. Observe how `OpenConnections`, `InUse`, `Idle`, `WaitCount`, and `WaitDuration` evolve. Convince yourself the numbers tell a story.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "sync"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    // TODO: SetMaxOpenConns(2), SetMaxIdleConns(1).
    //       Launch 10 goroutines that each run a slow query (e.g. SELECT 1, sleep).
    //       Print DBStats every 100ms while they run.
    var _ context.Context
    var _ sync.WaitGroup
    var _ time.Duration
    _ = log.Println
}
```

**Hints.**

- `SetMaxOpenConns(2)` caps "total connections out + idle" at 2. Goroutines beyond that block in `connRequests`.
- `db.Stats()` returns `DBStats`. Print it as a one-liner using its fields directly; `%+v` works but is noisy.
- SQLite doesn't really have "slow queries", so simulate one with `SELECT randomblob(100000)` repeated, or just `time.Sleep` after acquiring a conn.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "sync"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Senior decision: small numbers make the contention visible. In
    // production the rule of thumb is 2x CPU cores up to a few dozen;
    // here we want goroutines to QUEUE so DBStats moves.
    db.SetMaxOpenConns(2)
    db.SetMaxIdleConns(1)
    db.SetConnMaxLifetime(time.Minute)
    db.SetConnMaxIdleTime(30 * time.Second)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Background DBStats printer.
    go func() {
        t := time.NewTicker(100 * time.Millisecond)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                s := db.Stats()
                fmt.Printf("open=%d in_use=%d idle=%d wait=%d wait_dur=%s\n",
                    s.OpenConnections, s.InUse, s.Idle,
                    s.WaitCount, s.WaitDuration)
            }
        }
    }()

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            // Each goroutine: acquire a conn, do "slow work", release.
            // With MaxOpenConns=2, 8 of these wait at any given moment.
            conn, err := db.Conn(ctx)
            if err != nil {
                log.Printf("g%d: conn: %v", id, err)
                return
            }
            defer conn.Close() // returns to pool, does NOT close DB.
            if _, err := conn.ExecContext(ctx, `SELECT 1`); err != nil {
                log.Printf("g%d: exec: %v", id, err)
                return
            }
            // Senior decision: hold the conn briefly to force queueing.
            // In real code never sleep with a conn checked out — but this
            // is a teaching exercise about pool dynamics.
            time.Sleep(200 * time.Millisecond)
        }(i)
    }
    wg.Wait()
    // Final snapshot.
    s := db.Stats()
    fmt.Printf("FINAL  open=%d in_use=%d idle=%d wait=%d wait_dur=%s max_open=%d\n",
        s.OpenConnections, s.InUse, s.Idle,
        s.WaitCount, s.WaitDuration, s.MaxOpenConnections)
}
```

You will see something like:

```
open=2 in_use=2 idle=0 wait=2 wait_dur=4ms
open=2 in_use=2 idle=0 wait=4 wait_dur=210ms
open=2 in_use=2 idle=0 wait=6 wait_dur=415ms
open=2 in_use=2 idle=0 wait=8 wait_dur=620ms
FINAL  open=2 in_use=0 idle=1 wait=8 wait_dur=823ms max_open=2
```

`WaitCount=8` means 8 goroutines waited for a conn (10 launched, 2 got in immediately). `WaitDuration` accumulates the total wait. If you see your service's `WaitCount` climbing in prod, you're under-provisioned on connections.

Read after running: `sql.go` `func (db *DB) Stats() DBStats`. Notice every field is read under `db.mu` — taking a Stats snapshot briefly contends with every other pool operation. Don't poll it at 1 kHz. 1 Hz is plenty.

</details>

---

## Task 6 — BeginTx with isolation levels (M)

**Goal.** Run a transaction with `db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})`. SQLite ignores most isolation levels, so this is mostly for the PG case — write the code such that it would work against either, then point a `DATABASE_URL` at a Postgres instance and confirm `SHOW transaction_isolation` returns `serializable`.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "os"

    _ "github.com/jackc/pgx/v5/stdlib" // PostgreSQL via database/sql
)

func main() {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        log.Fatal("set DATABASE_URL")
    }
    db, _ := sql.Open("pgx", dsn)
    defer db.Close()
    // TODO: BeginTx with LevelSerializable; SHOW transaction_isolation.
    var _ context.Context
}
```

**Hints.**

- `sql.TxOptions{ReadOnly: true}` is a separate orthogonal hint. Some drivers honour it (PG), some ignore it.
- `tx.Rollback()` after `tx.Commit()` is safe — it's a no-op and returns `sql.ErrTxDone`. Defer it.
- The level constants are documented in `sql.go`: `LevelDefault, LevelReadUncommitted, LevelReadCommitted, LevelWriteCommitted, LevelRepeatableRead, LevelSnapshot, LevelSerializable, LevelLinearizable`. Most DBs only support a subset.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "os"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        log.Fatal("set DATABASE_URL=postgres://...")
    }
    db, err := sql.Open("pgx", dsn)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // Senior decision: choose isolation by the workload, not by reflex.
    // - LevelReadCommitted (PG default): cheapest, fine for 90% of code.
    // - LevelRepeatableRead: needed if you read the same row twice and
    //   expect consistency within the tx.
    // - LevelSerializable: pay the retry cost for true conflict
    //   serialisation. Always be prepared to retry on
    //   SQLSTATE 40001 (serialization_failure).
    tx, err := db.BeginTx(ctx, &sql.TxOptions{
        Isolation: sql.LevelSerializable,
        ReadOnly:  false,
    })
    if err != nil {
        log.Fatalf("begin: %v", err)
    }
    // Senior decision: defer Rollback unconditionally. After a Commit it
    // returns ErrTxDone, which we ignore. Without the defer, every early
    // return is a tx leak — and pgx will eventually time out the abandoned
    // tx, but the user-visible failure mode is "this conn is stuck".
    defer func() {
        if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
            log.Printf("rollback: %v", rbErr)
        }
    }()

    var level string
    if err := tx.QueryRowContext(ctx, `SHOW transaction_isolation`).Scan(&level); err != nil {
        log.Fatalf("show: %v", err)
    }
    fmt.Printf("transaction_isolation = %q\n", level)
    // Expected: "serializable"

    // Do real work; here a no-op SELECT to exercise the tx.
    var one int
    if err := tx.QueryRowContext(ctx, `SELECT 1`).Scan(&one); err != nil {
        log.Fatalf("select: %v", err)
    }

    if err := tx.Commit(); err != nil {
        // Senior decision: a SERIALIZABLE commit can fail with 40001
        // even if every statement succeeded. The retry must be at this
        // boundary, not inside the tx.
        log.Fatalf("commit: %v", err)
    }
    fmt.Println("committed")
}
```

To run: `DATABASE_URL=postgres://localhost/test?sslmode=disable go run main.go`.

Read after running: `sql.go`, search for `func (db *DB) BeginTx`. It calls `db.beginDC` which calls `dc.ci.(driver.ConnBeginTx).BeginTx(ctx, opts)` — the driver decides whether the isolation level is supported. Drivers that don't implement `ConnBeginTx` fall back to the legacy `Begin()` which ignores opts. Run `grep -n 'ConnBeginTx' "$(go env GOROOT)/src/database/sql/driver/driver.go"` to see the interface.

</details>

---

## Task 7 — QueryContext with a cancellable context (M)

**Goal.** Run a query with a context that gets cancelled mid-execution. Observe how `database/sql` propagates the cancellation: the goroutine returns with `context.Canceled`, the underlying connection is poisoned (closed, not returned to the pool) because the driver was mid-IO.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    db.SetMaxOpenConns(3)
    // TODO: launch a query in a goroutine; cancel its ctx after 10ms.
    //       Print DBStats before/after to see numClosed move.
    var _ time.Duration
    _ = log.Println
}
```

**Hints.**

- SQLite is too fast for cancellation to bite. Use a deliberately slow PG query (`SELECT pg_sleep(5)`) OR a busy-loop SQL like `WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<100000) SELECT count(*) FROM r`.
- After cancellation, `db.Stats().OpenConnections` should have dropped because the cancelled conn was killed, not returned.
- The error you get back is `context.Canceled` or `context.DeadlineExceeded` wrapped — use `errors.Is`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(3)

    before := db.Stats()
    fmt.Printf("BEFORE open=%d numClosed=%d\n",
        before.OpenConnections, before.MaxOpenConnections)

    // Make the query slow by recursing.
    slowSQL := `
        WITH RECURSIVE r(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM r WHERE n < 1000000
        )
        SELECT count(*) FROM r
    `

    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan error, 1)
    go func() {
        var count int
        done <- db.QueryRowContext(ctx, slowSQL).Scan(&count)
    }()

    // Senior decision: give the query enough time to actually start.
    // Cancelling before the conn is checked out doesn't test cancellation
    // mid-query — it tests early-abort. Both are valid; this test wants
    // the harder case.
    time.Sleep(10 * time.Millisecond)
    cancel()

    err = <-done
    if err == nil {
        fmt.Println("query finished before cancel (try a slower query)")
    } else if errors.Is(err, context.Canceled) {
        fmt.Println("query cancelled as expected")
    } else {
        fmt.Printf("unexpected error: %v\n", err)
    }

    // Senior decision: small sleep lets the pool reaper observe the
    // poisoned conn. Without it Stats() may see it still counted.
    time.Sleep(50 * time.Millisecond)
    after := db.Stats()
    fmt.Printf("AFTER  open=%d wait=%d\n", after.OpenConnections, after.WaitCount)
    fmt.Printf("InUse=%d Idle=%d\n", after.InUse, after.Idle)
}
```

What happens internally: `QueryContext` starts a goroutine that watches `ctx.Done()`. When the context fires, it calls the driver's `Cancel`-equivalent (`driver.QueryerContext`-aware drivers can implement it). For drivers that can't cancel an in-flight query, the framework's only option is to close the connection — better to kill the conn than wait for a stuck query. That's why `OpenConnections` drops.

Read after running: `sql.go`, search for `func (db *DB) queryDC`. It calls `withLock(dc, func() { ... })` around the actual driver call, and uses a `ctxDriverQuery` path when `ctx` is cancellable. Then look at `func (dc *driverConn) finalClose` — that's the path a poisoned conn takes when context cancellation forces it.

</details>

---

## Task 8 — Retry on driver.ErrBadConn wrapper (M)

**Goal.** Build a wrapper `Retry(ctx, db, fn)` that runs `fn(conn)` against a fresh `*sql.Conn`. If `fn` returns `driver.ErrBadConn`, retry once. Understand why this is almost always wrong — `database/sql` retries `ErrBadConn` internally for one round trip — and what it would mean to do it at the application layer.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "database/sql/driver"
    "errors"
    "log"

    _ "modernc.org/sqlite"
)

func Retry(ctx context.Context, db *sql.DB, fn func(*sql.Conn) error) error {
    // TODO: get a conn, run fn, on ErrBadConn try once more with a new conn.
    return nil
}

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    _ = Retry
    _ = driver.ErrBadConn
    _ = errors.Is
    _ = log.Println
}
```

**Hints.**

- `database/sql` itself retries `ErrBadConn` *once* before bubbling it. Once it surfaces to your code, it means "the second attempt also failed".
- Your wrapper's two-retry version effectively gives 3 total attempts. Whether that's correctness or busy-loop-on-broken-DB depends on the failure mode.
- The right answer in most prod code is NOT to retry on `ErrBadConn` — it's to retry on a higher-level signal (transient network error from the driver, 1213 deadlock for MySQL, 40001 for PG).

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "database/sql/driver"
    "errors"
    "fmt"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

// Retry runs fn with a connection. If fn returns driver.ErrBadConn
// (already retried once by database/sql, so this is the second failure),
// Retry tries one more time with a fresh conn.
//
// Senior decision: ONE retry. More than that and you're hammering a sick
// downstream. The whole point of ErrBadConn surfacing is "your second
// connection also died". If a third also dies, the DB is genuinely
// unreachable — bail out fast.
func Retry(ctx context.Context, db *sql.DB, fn func(context.Context, *sql.Conn) error) error {
    const attempts = 2
    var last error
    for i := 0; i < attempts; i++ {
        conn, err := db.Conn(ctx)
        if err != nil {
            return fmt.Errorf("acquire conn (attempt %d): %w", i+1, err)
        }
        err = fn(ctx, conn)
        // Senior decision: ALWAYS close the conn back to the pool. A bad
        // conn closes itself implicitly inside database/sql; a good conn
        // returns to idle.
        if cerr := conn.Close(); cerr != nil && err == nil {
            err = cerr
        }
        if err == nil {
            return nil
        }
        last = err
        // Senior decision: only retry on the very specific signal. Any
        // other error is application-domain (constraint violation, bad
        // SQL, etc.) and retrying it is wrong AND wasteful.
        if !errors.Is(err, driver.ErrBadConn) {
            return err
        }
        // Tiny backoff to give the conn opener time to dial a fresh one.
        time.Sleep(5 * time.Millisecond)
    }
    return fmt.Errorf("after %d attempts: %w", attempts, last)
}

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    ctx := context.Background()
    if _, err := db.ExecContext(ctx, `CREATE TABLE t(v INT)`); err != nil {
        log.Fatal(err)
    }

    err = Retry(ctx, db, func(ctx context.Context, c *sql.Conn) error {
        _, err := c.ExecContext(ctx, `INSERT INTO t(v) VALUES (?)`, 42)
        return err
    })
    if err != nil {
        log.Fatalf("retry: %v", err)
    }
    fmt.Println("ok")
}
```

Production caveats: the *right* layer for retries is the unit-of-work boundary (whole transaction), not per-statement. A retried INSERT inside a tx that already committed half its statements creates a phantom row. Read Brad Fitzpatrick's go-nuts post about "the database/sql retry budget" — the conclusion is that ErrBadConn is the framework's signal, not yours, and most app code should ignore it.

Read after running: `sql.go`, search for `func (db *DB) connDC` (the conn acquisition path). The `maxBadConnRetries` constant (default 2) is the framework's internal retry budget. Search for `if err == driver.ErrBadConn` to see all the places the framework swallows it.

</details>

---

## Task 9 — Fake driver supporting NamedValueChecker (M)

**Goal.** Build a minimal `driver.Driver` + `driver.Conn` that registers under a custom name and implements `driver.NamedValueChecker`. Demonstrate that `database/sql` calls `CheckNamedValue` on each parameter before binding. Use this to coerce a custom Go type (a `Money` struct) into an int64 cents value.

**Starter.**

```go
package main

import (
    "database/sql"
    "database/sql/driver"
    "log"
)

type fakeDriver struct{}

func (fakeDriver) Open(name string) (driver.Conn, error) { return nil, nil }

func init() {
    sql.Register("fake", fakeDriver{})
}

func main() {
    // TODO: implement Conn + Stmt + NamedValueChecker.
    //       Wire a query that takes a Money value and coerces to int64.
    _ = log.Println
}
```

**Hints.**

- The minimum interfaces: `driver.Driver`, `driver.Conn`, `driver.Stmt`, `driver.Result`. Most methods can be no-ops returning `(nil, nil)` for this teaching exercise.
- `driver.NamedValueChecker` lives on the `Conn` (or on the `Stmt`) — see `driver.go`. The framework prefers the Stmt's checker if present.
- The framework's default fallback is `driver.DefaultParameterConverter`, which rejects custom types with "unsupported type".

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "database/sql/driver"
    "fmt"
    "io"
    "log"
)

// Money is the custom type the driver knows how to bind.
type Money struct {
    Cents int64
}

// ----- driver.Driver -----

type fakeDriver struct{}

func (fakeDriver) Open(name string) (driver.Conn, error) {
    return &fakeConn{}, nil
}

// ----- driver.Conn -----

type fakeConn struct{}

func (c *fakeConn) Prepare(query string) (driver.Stmt, error) {
    return &fakeStmt{q: query}, nil
}
func (c *fakeConn) Close() error              { return nil }
func (c *fakeConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("tx unsupported") }

// Senior decision: implement NamedValueChecker on the Conn (not just the
// Stmt) so EVERY query path benefits, including Exec without an explicit
// Prepare. The framework probes Stmt first, then Conn — having it here is
// a belt-and-braces default for drivers that re-prepare on the fly.
func (c *fakeConn) CheckNamedValue(nv *driver.NamedValue) error {
    return coerceMoney(nv)
}

// ----- driver.Stmt -----

type fakeStmt struct{ q string }

func (s *fakeStmt) Close() error  { return nil }
func (s *fakeStmt) NumInput() int { return -1 } // "I don't know"; framework counts
func (s *fakeStmt) Exec(args []driver.Value) (driver.Result, error) {
    log.Printf("fakeStmt.Exec q=%q args=%v", s.q, args)
    return fakeResult{}, nil
}
func (s *fakeStmt) Query(args []driver.Value) (driver.Rows, error) {
    return nil, fmt.Errorf("Query unsupported in this demo")
}

// Senior decision: NamedValueChecker on Stmt overrides Conn's. We use the
// SAME coercion function from both — DRY. The contract is "modify nv.Value
// in place to something the driver can bind, or return ErrSkip to defer
// to default conversion, or return an error to reject".
func (s *fakeStmt) CheckNamedValue(nv *driver.NamedValue) error {
    return coerceMoney(nv)
}

func coerceMoney(nv *driver.NamedValue) error {
    switch v := nv.Value.(type) {
    case Money:
        // Coerce to driver.Value — must be one of:
        // int64, float64, bool, []byte, string, time.Time, or nil.
        nv.Value = v.Cents
        return nil
    case int64, string, []byte, float64, bool, nil:
        return nil
    default:
        // Defer to the default converter for everything else.
        return driver.ErrSkip
    }
}

// ----- driver.Result -----

type fakeResult struct{}

func (fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (fakeResult) RowsAffected() (int64, error) { return 1, nil }

// ----- registration -----

func init() {
    sql.Register("fake", fakeDriver{})
}

func main() {
    db, err := sql.Open("fake", "anything")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()
    res, err := db.ExecContext(ctx,
        `INSERT INTO orders(total) VALUES (?)`,
        Money{Cents: 1999},
    )
    if err != nil {
        log.Fatalf("exec: %v", err)
    }
    rows, _ := res.RowsAffected()
    fmt.Printf("rows=%d (Money was bound as int64)\n", rows)
    // Demonstrate the io.EOF path is unused; keep import alive.
    _ = io.EOF
}
```

Run it: prints something like

```
2026/05/29 12:34:56 fakeStmt.Exec q="INSERT INTO orders(total) VALUES (?)" args=[1999]
rows=1 (Money was bound as int64)
```

The Money struct made it through `database/sql` parameter conversion as `int64` because the driver's `CheckNamedValue` rewrote `nv.Value`. Without it, the framework's `DefaultParameterConverter` would reject Money with `sql: converting argument $1 type: unsupported type Money`.

Read after running: `sql.go`, search for `func driverArgsConnLocked`. That's the function that builds the `[]driver.NamedValue` to pass to the driver, and it's where `NamedValueChecker` is consulted. Notice the priority order: Stmt's checker first, then Conn's, then `defaultCheckNamedValue`.

</details>

---

## Task 10 — Read convert.go: Scan into *string vs *sql.NullString (M)

**Goal.** Read `$GOROOT/src/database/sql/convert.go` and write a 200-word explanation of how `Scan(&s string)` differs from `Scan(&ns sql.NullString)` when the column is `NULL`. Demonstrate both behaviours in code: the first errors, the second succeeds with `Valid: false`.

**Starter.**

```bash
grep -n 'convertAssign\|NullString' "$(go env GOROOT)/src/database/sql/convert.go" | head -40
```

```go
// In a Go file:
var s string
var ns sql.NullString
// TODO: scan a NULL column into each. Compare what happens.
```

**Hints.**

- `convertAssignRows` (renamed from `convertAssign` in newer Go) is the dispatch function. It type-switches on the destination's type and the source's type.
- For destination `*string`, `nil` source produces `sql: Scan error on column index 0, name "...": converting NULL to string is unsupported`.
- For destination `*sql.NullString`, the type defines its own `Scan(value any) error` — the framework calls that, and the method handles `nil` by setting `Valid = false`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    _, err = db.ExecContext(ctx, `
        CREATE TABLE t (name TEXT);
        INSERT INTO t(name) VALUES (NULL);
        INSERT INTO t(name) VALUES ('hello');
    `)
    if err != nil {
        log.Fatal(err)
    }

    // ----- Scan NULL into *string -----
    var s string
    err = db.QueryRowContext(ctx, `SELECT name FROM t WHERE name IS NULL`).Scan(&s)
    if err != nil {
        // Expected: "converting NULL to string is unsupported".
        fmt.Printf("*string + NULL -> error: %v\n", err)
    } else {
        fmt.Printf("*string + NULL -> %q (unexpected)\n", s)
    }

    // ----- Scan NULL into *sql.NullString -----
    var ns sql.NullString
    err = db.QueryRowContext(ctx, `SELECT name FROM t WHERE name IS NULL`).Scan(&ns)
    if err != nil {
        fmt.Printf("*NullString + NULL -> error: %v\n", err)
    } else {
        fmt.Printf("*NullString + NULL -> Valid=%v String=%q\n", ns.Valid, ns.String)
    }

    // ----- Scan non-NULL into both for symmetry -----
    err = db.QueryRowContext(ctx, `SELECT name FROM t WHERE name = 'hello'`).Scan(&s)
    fmt.Printf("*string + 'hello' -> %q (err=%v)\n", s, err)
    err = db.QueryRowContext(ctx, `SELECT name FROM t WHERE name = 'hello'`).Scan(&ns)
    fmt.Printf("*NullString + 'hello' -> Valid=%v String=%q (err=%v)\n", ns.Valid, ns.String, err)

    _ = errors.New
}
```

Output:

```
*string + NULL -> error: sql: Scan error on column index 0, name "name": converting NULL to string is unsupported
*NullString + NULL -> Valid=false String=""
*string + 'hello' -> "hello" (err=<nil>)
*NullString + 'hello' -> Valid=true String="hello" (err=<nil>)
```

**Explanation (the 200 words).**

`convert.go` exposes one entry point relevant to `Scan`: `convertAssignRows(dest, src any, rows *Rows) error`. The function first checks if `dest` implements `sql.Scanner` (has `Scan(any) error`). If yes — `*sql.NullString` does — the destination owns the conversion logic. `NullString.Scan` handles `nil` by zeroing the struct and setting `Valid = false`; it never errors on NULL.

If `dest` does NOT implement `sql.Scanner`, `convertAssignRows` runs its built-in type switch. For destination `*string`, the matching branch (`case *string`) requires `src` to be a non-nil string or `[]byte`. A nil `src` falls through to the `return fmt.Errorf("converting NULL to %s is unsupported", ...)` line. Same for `*int`, `*float64`, `*bool`: NULL is a type error.

So the rule is: `*string` says "I am always a string"; `*sql.NullString` says "I am a string or absent, and I will tell you which via `.Valid`". For nullable columns always use the `Null*` family (`NullInt64`, `NullFloat64`, `NullTime`, `NullString`, `NullBool`) or a `*string` if you genuinely want a Go nil pointer to mean SQL NULL (since Go 1.18 the framework also supports `**string` correctly).

Read after running: open `convert.go` and find both `func convertAssignRows` and the methods `func (ns *NullString) Scan(value any) error`. The two-step protocol (Scanner-first, then built-in fallback) is the whole mental model.

</details>

---

## Task 11 — Prometheus exporter for DBStats (S)

**Goal.** Build a pool monitor that periodically scrapes `db.Stats()` and exposes each field as a Prometheus gauge or counter. Wire it to `/metrics` via `promhttp`. Confirm the metrics show up at `localhost:2112/metrics`.

**Starter.**

```go
package main

import (
    "database/sql"
    "log"
    "net/http"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    // TODO: register collectors that pull from db.Stats() on each scrape.
    http.Handle("/metrics", promhttp.Handler())
    log.Fatal(http.ListenAndServe(":2112", nil))
    _ = prometheus.NewDesc
}
```

**Hints.**

- Don't poll `db.Stats()` every second in a goroutine and write to gauges. Use a `prometheus.Collector` whose `Collect()` method calls `db.Stats()` once per scrape. That's the canonical pattern and avoids stale values.
- Counters (monotonic) vs gauges (point-in-time): `WaitCount`, `MaxIdleClosed`, `MaxIdleTimeClosed`, `MaxLifetimeClosed` are counters; `OpenConnections`, `InUse`, `Idle` are gauges; `WaitDuration` is a counter (a `time.Duration` accumulator).
- Add a `db_name` label if you wrap multiple DBs in one process.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "net/http"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    _ "modernc.org/sqlite"
)

// Senior decision: implement the Collector interface, not push to gauges
// from a goroutine. Collectors are called by promhttp at scrape time, so
// the values are fresh, the goroutine doesn't exist, and you don't burn
// CPU between scrapes.
type dbStatsCollector struct {
    db     *sql.DB
    dbName string

    maxOpen           *prometheus.Desc
    open              *prometheus.Desc
    inUse             *prometheus.Desc
    idle              *prometheus.Desc
    waitCount         *prometheus.Desc
    waitDuration      *prometheus.Desc
    maxIdleClosed     *prometheus.Desc
    maxIdleTimeClosed *prometheus.Desc
    maxLifetimeClosed *prometheus.Desc
}

func newDBStatsCollector(db *sql.DB, name string) *dbStatsCollector {
    labels := []string{"db"}
    return &dbStatsCollector{
        db:     db,
        dbName: name,
        maxOpen: prometheus.NewDesc("go_sql_max_open_connections",
            "Max open connections configured.", labels, nil),
        open: prometheus.NewDesc("go_sql_open_connections",
            "Open connections (in use + idle).", labels, nil),
        inUse: prometheus.NewDesc("go_sql_in_use_connections",
            "Connections currently checked out.", labels, nil),
        idle: prometheus.NewDesc("go_sql_idle_connections",
            "Connections currently idle in the pool.", labels, nil),
        waitCount: prometheus.NewDesc("go_sql_wait_count_total",
            "Total times a goroutine waited for a connection.", labels, nil),
        waitDuration: prometheus.NewDesc("go_sql_wait_duration_seconds_total",
            "Total time waited for connections, in seconds.", labels, nil),
        maxIdleClosed: prometheus.NewDesc("go_sql_max_idle_closed_total",
            "Connections closed due to SetMaxIdleConns.", labels, nil),
        maxIdleTimeClosed: prometheus.NewDesc("go_sql_max_idle_time_closed_total",
            "Connections closed due to SetConnMaxIdleTime.", labels, nil),
        maxLifetimeClosed: prometheus.NewDesc("go_sql_max_lifetime_closed_total",
            "Connections closed due to SetConnMaxLifetime.", labels, nil),
    }
}

func (c *dbStatsCollector) Describe(ch chan<- *prometheus.Desc) {
    ch <- c.maxOpen
    ch <- c.open
    ch <- c.inUse
    ch <- c.idle
    ch <- c.waitCount
    ch <- c.waitDuration
    ch <- c.maxIdleClosed
    ch <- c.maxIdleTimeClosed
    ch <- c.maxLifetimeClosed
}

func (c *dbStatsCollector) Collect(ch chan<- prometheus.Metric) {
    s := c.db.Stats()
    g := func(d *prometheus.Desc, v float64) {
        ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v, c.dbName)
    }
    cn := func(d *prometheus.Desc, v float64) {
        ch <- prometheus.MustNewConstMetric(d, prometheus.CounterValue, v, c.dbName)
    }
    g(c.maxOpen, float64(s.MaxOpenConnections))
    g(c.open, float64(s.OpenConnections))
    g(c.inUse, float64(s.InUse))
    g(c.idle, float64(s.Idle))
    cn(c.waitCount, float64(s.WaitCount))
    cn(c.waitDuration, s.WaitDuration.Seconds())
    cn(c.maxIdleClosed, float64(s.MaxIdleClosed))
    cn(c.maxIdleTimeClosed, float64(s.MaxIdleTimeClosed))
    cn(c.maxLifetimeClosed, float64(s.MaxLifetimeClosed))
}

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(8)
    db.SetMaxIdleConns(4)

    prometheus.MustRegister(newDBStatsCollector(db, "primary"))

    // Generate some traffic so the metrics are non-zero.
    go func() {
        ctx := context.Background()
        for {
            _, _ = db.ExecContext(ctx, `SELECT 1`)
            time.Sleep(100 * time.Millisecond)
        }
    }()

    http.Handle("/metrics", promhttp.Handler())
    log.Println("metrics on :2112/metrics")
    log.Fatal(http.ListenAndServe(":2112", nil))
}
```

Run with `go run main.go`, then `curl -s localhost:2112/metrics | grep go_sql_`. You'll see all nine series with `db="primary"` labels.

Why this matters in production: `go_sql_wait_count_total` and `go_sql_wait_duration_seconds_total` are the signals that say "your pool is too small". Set up Grafana alerts on `rate(go_sql_wait_count_total[5m]) > 1` per second — that's "more than one goroutine per second is queueing for a connection".

</details>

---

## Task 12 — Diagnose pool exhaustion with WaitCount + WaitDuration (S)

**Goal.** Construct a scenario that exhausts the pool — too many concurrent slow queries against too few connections — and use `WaitCount` + `WaitDuration` to prove the diagnosis. Then fix it three ways and compare: (a) raise MaxOpenConns, (b) speed up the query, (c) add a timeout that fails-fast instead of waiting.

**Starter.**

```go
package main

import (
    "database/sql"
    _ "modernc.org/sqlite"
)

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    // TODO: scenario A: MaxOpen=2, 100 goroutines, slow query.
    //       scenario B: MaxOpen=20, same load.
    //       scenario C: context.WithTimeout(50ms), MaxOpen=2.
    //       Print WaitCount/WaitDuration for each, compare.
    _ = db
}
```

**Hints.**

- Run each scenario in a fresh `*sql.DB` so stats don't leak between runs.
- The "timeout fails fast" scenario should show `Acquire conn: context deadline exceeded` errors and a LOWER `WaitDuration` than the unbounded-wait scenario — because the wait got cut short.
- The fix is rarely "raise MaxOpenConns to infinity". The PG server itself caps at `max_connections`; raising the Go pool past that just moves the queue.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "sync"
    "sync/atomic"
    "time"

    _ "modernc.org/sqlite"
)

type scenario struct {
    name        string
    maxOpen     int
    perCallTO   time.Duration // 0 = no timeout
    workMS      time.Duration
    goroutines  int
}

func runScenario(s scenario) {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(s.maxOpen)
    db.SetMaxIdleConns(s.maxOpen)

    var (
        ok    int64
        fails int64
    )
    start := time.Now()
    var wg sync.WaitGroup
    for i := 0; i < s.goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            ctx := context.Background()
            if s.perCallTO > 0 {
                var cancel context.CancelFunc
                ctx, cancel = context.WithTimeout(ctx, s.perCallTO)
                defer cancel()
            }
            conn, err := db.Conn(ctx)
            if err != nil {
                atomic.AddInt64(&fails, 1)
                return
            }
            defer conn.Close()
            // Simulate slow query: SQLite is fast, so we sleep.
            time.Sleep(s.workMS)
            _, _ = conn.ExecContext(ctx, `SELECT 1`)
            atomic.AddInt64(&ok, 1)
        }()
    }
    wg.Wait()
    elapsed := time.Since(start)
    st := db.Stats()
    fmt.Printf("[%-22s] elapsed=%6s ok=%-3d fails=%-3d  WaitCount=%-3d WaitDuration=%s\n",
        s.name, elapsed.Truncate(time.Millisecond), ok, fails,
        st.WaitCount, st.WaitDuration.Truncate(time.Millisecond))
    _ = errors.Is
}

func main() {
    base := scenario{workMS: 50 * time.Millisecond, goroutines: 100}

    fmt.Println("Diagnosis: pool too small, no timeout")
    a := base
    a.name = "A: maxOpen=2"
    a.maxOpen = 2
    runScenario(a)

    fmt.Println("\nFix (a): raise the pool")
    b := base
    b.name = "B: maxOpen=20"
    b.maxOpen = 20
    runScenario(b)

    fmt.Println("\nFix (b): speed up the query (workMS 50 -> 5)")
    c := base
    c.name = "C: maxOpen=2, fast"
    c.maxOpen = 2
    c.workMS = 5 * time.Millisecond
    runScenario(c)

    fmt.Println("\nFix (c): fail fast with a per-call timeout")
    d := base
    d.name = "D: maxOpen=2, TO=50ms"
    d.maxOpen = 2
    d.perCallTO = 50 * time.Millisecond
    runScenario(d)
}
```

Sample output:

```
Diagnosis: pool too small, no timeout
[A: maxOpen=2        ] elapsed= 2.5s ok=100 fails=0   WaitCount=98  WaitDuration=2.4s

Fix (a): raise the pool
[B: maxOpen=20       ] elapsed= 252ms ok=100 fails=0   WaitCount=80  WaitDuration=720ms

Fix (b): speed up the query (workMS 50 -> 5)
[C: maxOpen=2, fast  ] elapsed= 254ms ok=100 fails=0   WaitCount=98  WaitDuration=242ms

Fix (c): fail fast with a per-call timeout
[D: maxOpen=2, TO=50ms] elapsed=  53ms ok=2   fails=98  WaitCount=2   WaitDuration=99ms
```

Interpretation. Scenario A is the bug: 98 goroutines waited an average of ~24ms each, total elapsed 2.5s. Scenario D is the operational fix: instead of 100 slow-but-successful requests, you get 2 successful + 98 fail-fast errors that the caller can retry or shed. In a live system, D is almost always preferable to A — you give the user a 503 in 50ms instead of a 200 in 2500ms. The metric to alert on is `WaitCount` rising; the fix is usually scenarios B+C combined (raise pool moderately, speed up the query), with D as the safety net.

</details>

---

## Task 13 — Read replica router wrapper over DB (S)

**Goal.** Build a `RoutingDB` that wraps a primary `*sql.DB` and N replica `*sql.DB`s. Reads (`Query`, `QueryRow`) round-robin over replicas; writes (`Exec`, `Begin`) hit the primary. Provide a `ForceLeader(ctx)` to pin a request to the primary even for reads (for read-after-write consistency).

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "sync/atomic"
)

type RoutingDB struct {
    primary  *sql.DB
    replicas []*sql.DB
    rr       atomic.Uint64
}

func New(primary *sql.DB, replicas ...*sql.DB) *RoutingDB { return nil }
func (r *RoutingDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    return nil, nil
}
func (r *RoutingDB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
    return nil, nil
}
```

**Hints.**

- Don't try to parse SQL to detect reads-vs-writes. Have the caller choose the method (`QueryContext` vs `ExecContext`). If they call `QueryContext("INSERT...")` that's their bug, not yours.
- Round-robin with `atomic.Uint64.Add(1) % uint64(len(r.replicas))`. Avoid `rand` — predictable load distribution is a feature.
- `ForceLeader` flag lives in `context.Value` so middleware can flip it transparently.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "sync/atomic"

    _ "modernc.org/sqlite"
)

type forceLeaderKey struct{}

// ForceLeader marks the context as requiring the primary even for reads.
// Use after a write when you need read-after-write consistency, e.g.
// "create order then redirect to /orders/{id}".
func ForceLeader(ctx context.Context) context.Context {
    return context.WithValue(ctx, forceLeaderKey{}, true)
}

func isLeaderForced(ctx context.Context) bool {
    v, _ := ctx.Value(forceLeaderKey{}).(bool)
    return v
}

type RoutingDB struct {
    primary  *sql.DB
    replicas []*sql.DB
    rr       atomic.Uint64
}

func New(primary *sql.DB, replicas ...*sql.DB) *RoutingDB {
    if primary == nil {
        panic("routingdb: primary required")
    }
    return &RoutingDB{primary: primary, replicas: replicas}
}

// Senior decision: when no replicas configured, ALL traffic goes to
// primary. Same when ForceLeader is set. This is the safe default — a
// misconfigured RoutingDB degrades to "talks to primary", never to "talks
// to nothing".
func (r *RoutingDB) reader(ctx context.Context) *sql.DB {
    if isLeaderForced(ctx) || len(r.replicas) == 0 {
        return r.primary
    }
    n := r.rr.Add(1)
    return r.replicas[(n-1)%uint64(len(r.replicas))]
}

func (r *RoutingDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    return r.reader(ctx).QueryContext(ctx, q, args...)
}

func (r *RoutingDB) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
    return r.reader(ctx).QueryRowContext(ctx, q, args...)
}

// Senior decision: writes ALWAYS go to primary, no exceptions. ExecContext
// on a replica with replication delay would silently succeed against an
// older snapshot and the next read would still not see it — debugging
// hell. The pattern is enforced by routing, not documentation.
func (r *RoutingDB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
    return r.primary.ExecContext(ctx, q, args...)
}

func (r *RoutingDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
    // Senior decision: BeginTx on a read replica is supported by some PG
    // setups for read-only txs (with ReadOnly: true). To keep this simple
    // and safe, default to primary; advanced callers can reach in.
    if opts != nil && opts.ReadOnly {
        return r.reader(ctx).BeginTx(ctx, opts)
    }
    return r.primary.BeginTx(ctx, opts)
}

func (r *RoutingDB) Close() error {
    var first error
    if err := r.primary.Close(); err != nil {
        first = err
    }
    for _, rep := range r.replicas {
        if err := rep.Close(); err != nil && first == nil {
            first = err
        }
    }
    return first
}

func main() {
    // For the demo, use three in-memory SQLite DBs as "primary" + "r1" + "r2".
    primary, _ := sql.Open("sqlite", ":memory:")
    r1, _ := sql.Open("sqlite", ":memory:")
    r2, _ := sql.Open("sqlite", ":memory:")
    rdb := New(primary, r1, r2)
    defer rdb.Close()

    ctx := context.Background()
    if _, err := rdb.ExecContext(ctx, `CREATE TABLE t(v INT)`); err != nil {
        log.Fatal(err)
    }
    // Replicas don't have the table — that's the point. In production they'd
    // catch up via real replication; here we manually copy.
    for _, db := range []*sql.DB{r1, r2} {
        if _, err := db.ExecContext(ctx, `CREATE TABLE t(v INT)`); err != nil {
            log.Fatal(err)
        }
    }

    if _, err := rdb.ExecContext(ctx, `INSERT INTO t VALUES (1)`); err != nil {
        log.Fatal(err)
    }
    // Read goes round-robin to replicas (which don't have the row yet).
    var n int
    err := rdb.QueryRowContext(ctx, `SELECT count(*) FROM t`).Scan(&n)
    fmt.Printf("replica read: count=%d (expected 0 — lag) err=%v\n", n, err)

    // ForceLeader reads from the primary.
    err = rdb.QueryRowContext(ForceLeader(ctx), `SELECT count(*) FROM t`).Scan(&n)
    fmt.Printf("primary read: count=%d (expected 1) err=%v\n", n, err)

    _ = errors.New
}
```

Output:

```
replica read: count=0 (expected 0 — lag) err=<nil>
primary read: count=1 (expected 1) err=<nil>
```

Production caveats: real implementations carry replication lag as a metric, evict replicas above a threshold, and surface lag in `DBStats`-like API for monitoring. They also handle per-replica health: a failing replica should be quarantined for some cooldown rather than routed to. The skeleton above gets the control flow right; the production refinements bolt on as decorator wrappers around `r.reader(ctx)`.

</details>

---

## Task 14 — pgx direct vs pgx via database/sql (S)

**Goal.** Benchmark `github.com/jackc/pgx/v5` used directly (`pgx.Conn`, `pgxpool.Pool`) versus the same driver wrapped behind `database/sql` (`pgx/v5/stdlib`). Same workload, same Postgres. Quantify the throughput delta and explain WHY pgx-direct is faster.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "os"
    "testing"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    _ "github.com/jackc/pgx/v5/stdlib"
)

func BenchmarkPgxDirect(b *testing.B) {
    // TODO: pgx.Connect; for each iter, QueryRow + Scan a single integer.
}

func BenchmarkPgxStdlib(b *testing.B) {
    // TODO: sql.Open("pgx", dsn); same query.
}

func main() {
    _ = pgx.Connect
    _ = pgxpool.New
    _ = sql.Open
    _ = log.Println
    _ = os.Getenv
}
```

**Hints.**

- The pgx-direct path uses `binary` protocol by default; the `database/sql` path goes through the `driver.Value` adapter which requires `text` conversion for many types. That's a measurable cost per row.
- For an apples-to-apples test, use the same single-row query (`SELECT 1`). For row-heavy workloads, the gap widens — pgx's `pgx.CollectRows` skips a layer of conversion.
- Run with `-benchmem`. The stdlib path allocates more `[]byte` for the textual representations.

<details><summary>Reference solution</summary>

```go
// File: pgx_bench_test.go
package main

import (
    "context"
    "database/sql"
    "log"
    "os"
    "testing"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    _ "github.com/jackc/pgx/v5/stdlib"
)

var (
    pgxDirect *pgxpool.Pool
    sqlDB     *sql.DB
)

func TestMain(m *testing.M) {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        log.Println("DATABASE_URL not set, skipping")
        os.Exit(0)
    }
    var err error
    pgxDirect, err = pgxpool.New(context.Background(), dsn)
    if err != nil {
        log.Fatal(err)
    }
    defer pgxDirect.Close()
    sqlDB, err = sql.Open("pgx", dsn)
    if err != nil {
        log.Fatal(err)
    }
    defer sqlDB.Close()
    sqlDB.SetMaxOpenConns(8)
    sqlDB.SetMaxIdleConns(8)
    os.Exit(m.Run())
}

func BenchmarkPgxDirect(b *testing.B) {
    ctx := context.Background()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var n int
        if err := pgxDirect.QueryRow(ctx, `SELECT $1::int`, 1).Scan(&n); err != nil {
            b.Fatal(err)
        }
    }
}

func BenchmarkPgxStdlib(b *testing.B) {
    ctx := context.Background()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var n int
        if err := sqlDB.QueryRowContext(ctx, `SELECT $1::int`, 1).Scan(&n); err != nil {
            b.Fatal(err)
        }
    }
}

// Parallel variants — the gap usually widens because the stdlib mutex
// serialises a tiny bit more than pgxpool's lock-free path.
func BenchmarkPgxDirectParallel(b *testing.B) {
    ctx := context.Background()
    b.ReportAllocs()
    b.SetParallelism(8)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            var n int
            if err := pgxDirect.QueryRow(ctx, `SELECT $1::int`, 1).Scan(&n); err != nil {
                b.Fatal(err)
            }
        }
    })
}

func BenchmarkPgxStdlibParallel(b *testing.B) {
    ctx := context.Background()
    b.ReportAllocs()
    b.SetParallelism(8)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            var n int
            if err := sqlDB.QueryRowContext(ctx, `SELECT $1::int`, 1).Scan(&n); err != nil {
                b.Fatal(err)
            }
        }
    })
}

func ignored() {
    // keep pgx imported even if TestMain skips
    _ = pgx.ErrTxClosed
}
```

Run with:

```
DATABASE_URL=postgres://localhost/test?sslmode=disable \
    go test -bench=. -benchmem -benchtime=3s ./...
```

Typical numbers on a local PG (your mileage varies):

```
BenchmarkPgxDirect-8            45000   78000 ns/op    400 B/op    12 allocs/op
BenchmarkPgxStdlib-8            38000   91000 ns/op    560 B/op    18 allocs/op
BenchmarkPgxDirectParallel-8   240000   15000 ns/op    400 B/op    12 allocs/op
BenchmarkPgxStdlibParallel-8   190000   19000 ns/op    560 B/op    18 allocs/op
```

The stdlib path is ~15-20% slower with ~40% more allocs. Why:

1. `database/sql` runs a `driverArgsConnLocked` step that converts every Go value into a `driver.Value` (the limited set of types stdlib understands) before handing it to the driver. pgx-direct skips this and passes Go values straight to its binary encoder.
2. `database/sql` allocates a `*sql.Row` wrapper and threads `*sql.Rows` through; pgx returns its `pgx.Row` directly with less indirection.
3. Pool contention: `database/sql` uses one global mutex on `DB.mu`; `pgxpool` uses sharded primitives.
4. The text protocol fallback path: when stdlib asks for an `int`, pgx-stdlib has to materialise the text form because that's what `driver.Value` historically required for unspecified column types. Direct pgx negotiates the binary protocol and avoids that allocation.

Pick the wrapper anyway in most apps. The 15% throughput cost buys you (a) compatibility with every `*sql.DB`-using library (sqlx, squirrel, sqlc-generated code), (b) one less driver-specific concept on your team, (c) trivial migration to a different driver later. The gap closes further with pgx 5.x's improvements; the bottleneck in real apps is rarely the driver shim — it's network RTT and query plans.

Read after running: `sql.go` `func driverArgsConnLocked` is the per-call conversion price. Trace what happens to a single integer arg from `QueryContext` down to `driver.QueryerContext.QueryContext` — every `interface{}` boundary is a heap allocation candidate.

</details>

---

## Task 15 — Savepoints for nested-transaction-like behaviour (S)

**Goal.** PostgreSQL/SQLite support SAVEPOINTs inside a transaction. `database/sql` has no native API; you issue raw SQL. Build a helper `WithSavepoint(ctx, tx, name, fn)` that creates a savepoint, runs `fn`, and rolls back to the savepoint if `fn` errors — without aborting the enclosing transaction.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"

    _ "modernc.org/sqlite"
)

func WithSavepoint(ctx context.Context, tx *sql.Tx, name string, fn func(context.Context) error) error {
    // TODO: SAVEPOINT name; defer RELEASE/ROLLBACK based on fn's error.
    return nil
}

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    _ = WithSavepoint
    _ = log.Println
}
```

**Hints.**

- `SAVEPOINT name; ... RELEASE SAVEPOINT name` on success; `ROLLBACK TO SAVEPOINT name` on error.
- Validate the name — it goes verbatim into SQL. Don't accept user input. Allow `[A-Za-z_][A-Za-z0-9_]{0,31}` only.
- Nested savepoints: just call `WithSavepoint` again with a different name. Each level is its own SAVEPOINT.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "regexp"

    _ "modernc.org/sqlite"
)

var validSavepointName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,31}$`)

// WithSavepoint runs fn inside a SAVEPOINT. If fn returns an error,
// rolls back to the savepoint (leaving the outer tx open). If fn succeeds,
// releases the savepoint.
//
// Senior decision: take name as input. SAVEPOINT names are identifiers
// in SQL; passing user input would be SQL injection. The regex enforces
// the safe subset matching Postgres's identifier rules.
func WithSavepoint(ctx context.Context, tx *sql.Tx, name string, fn func(context.Context) error) (err error) {
    if !validSavepointName.MatchString(name) {
        return fmt.Errorf("invalid savepoint name %q", name)
    }
    if _, err := tx.ExecContext(ctx, "SAVEPOINT "+name); err != nil {
        return fmt.Errorf("savepoint %s: %w", name, err)
    }
    // Senior decision: named return + defer is the cleanest way to do
    // "rollback OR release depending on the function's outcome".
    defer func() {
        if p := recover(); p != nil {
            // A panic inside fn — release would be wrong; rollback is.
            _, _ = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+name)
            panic(p) // re-throw; we own the savepoint, not the panic.
        }
        if err != nil {
            if _, rbErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+name); rbErr != nil {
                // Combine errors — the rollback failure is rare but
                // important. errors.Join is Go 1.20+.
                err = errors.Join(err, fmt.Errorf("rollback to %s: %w", name, rbErr))
            }
            return
        }
        if _, relErr := tx.ExecContext(ctx, "RELEASE SAVEPOINT "+name); relErr != nil {
            err = fmt.Errorf("release %s: %w", name, relErr)
        }
    }()
    return fn(ctx)
}

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    if _, err := db.ExecContext(ctx, `CREATE TABLE t(v INT)`); err != nil {
        log.Fatal(err)
    }

    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        log.Fatal(err)
    }
    defer tx.Rollback()

    if _, err := tx.ExecContext(ctx, `INSERT INTO t VALUES (1)`); err != nil {
        log.Fatal(err)
    }

    // Inner block: insert 2, then fail. Expect 2 to be rolled back, 1 to remain.
    err = WithSavepoint(ctx, tx, "sp1", func(ctx context.Context) error {
        if _, err := tx.ExecContext(ctx, `INSERT INTO t VALUES (2)`); err != nil {
            return err
        }
        return errors.New("simulated failure inside savepoint")
    })
    fmt.Printf("inner block returned: %v\n", err)

    // Outer continues: insert 3. Should commit alongside 1.
    if _, err := tx.ExecContext(ctx, `INSERT INTO t VALUES (3)`); err != nil {
        log.Fatal(err)
    }

    if err := tx.Commit(); err != nil {
        log.Fatal(err)
    }

    // Verify: 1 and 3 present, 2 absent.
    rows, _ := db.QueryContext(ctx, `SELECT v FROM t ORDER BY v`)
    defer rows.Close()
    var got []int
    for rows.Next() {
        var v int
        rows.Scan(&v)
        got = append(got, v)
    }
    fmt.Printf("rows committed: %v (expected [1 3])\n", got)
}
```

Output:

```
inner block returned: simulated failure inside savepoint
rows committed: [1 3] (expected [1 3])
```

When to use savepoints in practice: partial-success bulk imports ("process 1000 rows; if any one row fails, skip it but keep the rest"), polymorphic insert-or-update flows where you want to try INSERT, catch the constraint violation, and fall back to UPDATE without restarting the outer tx. The Postgres MVCC cost of savepoints is small but non-zero; don't sprinkle them everywhere.

Read after running: there's nothing for savepoints in `sql.go` — the stdlib doesn't model them. You're issuing raw SQL through `tx.ExecContext`. Some ORMs (sqlx's `*Tx`, ent, gorm) wrap this for you; the helper above is what they all reduce to internally.

</details>

---

## Task 16 — Query-cache layer keyed by context value (S)

**Goal.** Build a wrapper `CachedDB` that caches the *result set* of `QueryContext` calls. Cache key = SQL + args. TTL via `time.AfterFunc`. Bypass via a context value (`SkipCache(ctx)`). Demonstrate cache hits vs misses with a counter.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "sync"
    "time"
)

type CachedDB struct {
    db    *sql.DB
    ttl   time.Duration
    mu    sync.Mutex
    cache map[string]*cacheEntry
}

type cacheEntry struct {
    rows [][]any
    cols []string
}

func New(db *sql.DB, ttl time.Duration) *CachedDB                       { return nil }
func (c *CachedDB) QueryContext(ctx context.Context, q string, args ...any) ([][]any, []string, error) {
    return nil, nil, nil
}
func SkipCache(ctx context.Context) context.Context { return ctx }
```

**Hints.**

- Cache key: `fmt.Sprintf("%s|%v", sql, args)`. Crude but fine for the exercise. Production uses fnv64 + structured args.
- The values you cache must NOT be `*sql.Rows` (it's not safe to hand the same iterator to two callers). Materialise into `[][]any` once per miss.
- `time.AfterFunc` for eviction means one goroutine per entry, which is fine for low-cardinality caches. For high-cardinality use a single janitor.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "sync"
    "sync/atomic"
    "time"

    _ "modernc.org/sqlite"
)

type skipCacheKey struct{}

// SkipCache returns a context that forces a cache miss. Use for the
// "force-fresh after write" path — same role as ForceLeader in Task 13.
func SkipCache(ctx context.Context) context.Context {
    return context.WithValue(ctx, skipCacheKey{}, true)
}

func isSkipCache(ctx context.Context) bool {
    v, _ := ctx.Value(skipCacheKey{}).(bool)
    return v
}

type cacheEntry struct {
    cols []string
    rows [][]any
}

type CachedDB struct {
    db    *sql.DB
    ttl   time.Duration
    mu    sync.Mutex
    cache map[string]*cacheEntry
    hits  atomic.Int64
    miss  atomic.Int64
}

func New(db *sql.DB, ttl time.Duration) *CachedDB {
    return &CachedDB{
        db:    db,
        ttl:   ttl,
        cache: make(map[string]*cacheEntry),
    }
}

func (c *CachedDB) Stats() (hits, misses int64) {
    return c.hits.Load(), c.miss.Load()
}

// Senior decision: cache key includes the SQL AND the args. Caching by
// SQL alone is wrong (same query, different parameters, different rows).
// Caching by args alone is wrong (same args, different queries). Both
// must be in the key.
func cacheKey(q string, args []any) string {
    return fmt.Sprintf("%s|%v", q, args)
}

func (c *CachedDB) QueryContext(ctx context.Context, q string, args ...any) ([][]any, []string, error) {
    key := cacheKey(q, args)
    if !isSkipCache(ctx) {
        c.mu.Lock()
        if entry, ok := c.cache[key]; ok {
            c.mu.Unlock()
            c.hits.Add(1)
            return entry.rows, entry.cols, nil
        }
        c.mu.Unlock()
    }
    c.miss.Add(1)

    rows, err := c.db.QueryContext(ctx, q, args...)
    if err != nil {
        return nil, nil, err
    }
    defer rows.Close()
    cols, err := rows.Columns()
    if err != nil {
        return nil, nil, err
    }
    var out [][]any
    for rows.Next() {
        // Senior decision: build []any of *any to scan into, then deref.
        // This pattern lets us cache without knowing the column types.
        ptrs := make([]any, len(cols))
        vals := make([]any, len(cols))
        for i := range ptrs {
            ptrs[i] = &vals[i]
        }
        if err := rows.Scan(ptrs...); err != nil {
            return nil, nil, err
        }
        out = append(out, vals)
    }
    if err := rows.Err(); err != nil {
        return nil, nil, err
    }

    entry := &cacheEntry{cols: cols, rows: out}
    c.mu.Lock()
    c.cache[key] = entry
    c.mu.Unlock()

    // Senior decision: AfterFunc cleanup. One goroutine per entry is the
    // simple choice; for high-cardinality caches use a single janitor on
    // a min-heap of expiry times. The choice depends on cache size.
    time.AfterFunc(c.ttl, func() {
        c.mu.Lock()
        if c.cache[key] == entry {
            delete(c.cache, key)
        }
        c.mu.Unlock()
    })

    return out, cols, nil
}

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    db.ExecContext(ctx, `CREATE TABLE t(v INT)`)
    for i := 1; i <= 3; i++ {
        db.ExecContext(ctx, `INSERT INTO t VALUES (?)`, i)
    }

    cdb := New(db, 500*time.Millisecond)
    q := `SELECT v FROM t WHERE v > ?`
    for i := 0; i < 5; i++ {
        rows, _, err := cdb.QueryContext(ctx, q, 0)
        if err != nil {
            log.Fatal(err)
        }
        fmt.Printf("rows=%v\n", rows)
    }
    h, m := cdb.Stats()
    fmt.Printf("hits=%d misses=%d (expect 4 hits, 1 miss)\n", h, m)

    // Bypass with SkipCache: forces another miss.
    cdb.QueryContext(SkipCache(ctx), q, 0)
    h, m = cdb.Stats()
    fmt.Printf("after SkipCache: hits=%d misses=%d (expect 4 hits, 2 misses)\n", h, m)

    // After TTL, the entry evicts and the next call misses.
    time.Sleep(600 * time.Millisecond)
    cdb.QueryContext(ctx, q, 0)
    h, m = cdb.Stats()
    fmt.Printf("after TTL: hits=%d misses=%d (expect 4 hits, 3 misses)\n", h, m)
}
```

Output:

```
rows=[[1] [2] [3]]
rows=[[1] [2] [3]]
rows=[[1] [2] [3]]
rows=[[1] [2] [3]]
rows=[[1] [2] [3]]
hits=4 misses=1 (expect 4 hits, 1 miss)
after SkipCache: hits=4 misses=2 (expect 4 hits, 2 misses)
after TTL: hits=4 misses=3 (expect 4 hits, 3 misses)
```

Caveats this skeleton glosses over: cache invalidation on writes (the hard problem), stampede protection (use singleflight so 100 simultaneous misses cause 1 query, not 100), and memory bounds (the map above is unbounded — production caches set an LRU cap). The point of the exercise is the *placement*: a wrapper around `*sql.DB` is the right place for this layer, NOT inside individual repository methods.

</details>

---

## Task 17 — Forgotten Rows.Close leaks a connection (S)

**Goal.** Write a deliberately buggy function that runs a query but forgets `rows.Close()`. Loop-call it. Print `DBStats` after each iteration and prove that `OpenConnections` keeps climbing until it hits `MaxOpenConns`, at which point further calls block forever (or timeout). Then add the `defer rows.Close()` and show the bug disappears.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"
    _ "modernc.org/sqlite"
)

func leakyQuery(db *sql.DB) error {
    rows, err := db.QueryContext(context.Background(), `SELECT 1`)
    if err != nil {
        return err
    }
    // BUG: missing rows.Close()
    for rows.Next() {
        var n int
        rows.Scan(&n)
    }
    return rows.Err()
}

func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    defer db.Close()
    db.SetMaxOpenConns(3)
    // TODO: call leakyQuery N times, print Stats() each iter.
    //       Then show the fix (defer rows.Close) eliminates the leak.
    _ = log.Println
}
```

**Hints.**

- The leak only manifests if you don't fully iterate (`rows.Next()` until false). A fully-drained iterator self-closes on the last `Next()` returning false — but partial iteration plus no Close leaves the conn pinned.
- Wait, that's exactly the bug pattern: people read the first row, then `return` without closing. Construct THAT version to make the leak deterministic.
- With `MaxOpenConns=3`, the 4th leaky call will block on conn acquisition. Use `context.WithTimeout` to fail fast and observe.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

// leakyQuery exhibits the canonical leak: open a Rows, read the first row,
// return without iterating to end and without Close. The conn stays
// checked out forever.
func leakyQuery(ctx context.Context, db *sql.DB) error {
    rows, err := db.QueryContext(ctx, `SELECT v FROM t`)
    if err != nil {
        return err
    }
    // Read ONE row then bail. The remaining rows are still in flight;
    // database/sql holds the conn for them. No Close = leaked conn.
    if rows.Next() {
        var v int
        rows.Scan(&v)
    }
    return nil // BUG: missing rows.Close()
}

// safeQuery is the fix.
func safeQuery(ctx context.Context, db *sql.DB) error {
    rows, err := db.QueryContext(ctx, `SELECT v FROM t`)
    if err != nil {
        return err
    }
    defer rows.Close()
    if rows.Next() {
        var v int
        rows.Scan(&v)
    }
    return rows.Err()
}

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(3)
    db.SetMaxIdleConns(3)

    ctx := context.Background()
    db.ExecContext(ctx, `CREATE TABLE t(v INT)`)
    for i := 1; i <= 10; i++ {
        db.ExecContext(ctx, `INSERT INTO t VALUES (?)`, i)
    }

    fmt.Println("--- leaking ---")
    for i := 1; i <= 3; i++ {
        if err := leakyQuery(ctx, db); err != nil {
            log.Fatal(err)
        }
        s := db.Stats()
        fmt.Printf("after leak #%d: open=%d in_use=%d idle=%d\n",
            i, s.OpenConnections, s.InUse, s.Idle)
    }

    // 4th call should block — give it a deadline to prove it.
    fmt.Println("\n--- 4th leak (will time out) ---")
    ctx4, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    err = leakyQuery(ctx4, db)
    if errors.Is(err, context.DeadlineExceeded) {
        fmt.Println("BLOCKED on conn acquisition — pool exhausted by leaks")
    } else {
        fmt.Printf("unexpected: %v\n", err)
    }

    fmt.Println("\n--- restart with safeQuery ---")
    db2, _ := sql.Open("sqlite", ":memory:")
    defer db2.Close()
    db2.SetMaxOpenConns(3)
    db2.ExecContext(ctx, `CREATE TABLE t(v INT)`)
    for i := 1; i <= 10; i++ {
        db2.ExecContext(ctx, `INSERT INTO t VALUES (?)`, i)
    }
    for i := 1; i <= 10; i++ {
        if err := safeQuery(ctx, db2); err != nil {
            log.Fatal(err)
        }
    }
    s := db2.Stats()
    fmt.Printf("after 10 safe calls: open=%d in_use=%d idle=%d (idle should be > 0)\n",
        s.OpenConnections, s.InUse, s.Idle)
}
```

Output:

```
--- leaking ---
after leak #1: open=1 in_use=1 idle=0
after leak #2: open=2 in_use=2 idle=0
after leak #3: open=3 in_use=3 idle=0

--- 4th leak (will time out) ---
BLOCKED on conn acquisition — pool exhausted by leaks

--- restart with safeQuery ---
after 10 safe calls: open=1 in_use=0 idle=1 (idle should be > 0)
```

This is the most common database/sql bug in production Go code. The signature is "service works fine under low load, hangs after a few minutes under load". The diagnosis is `db.Stats().InUse` climbing without ever dropping; the fix is `defer rows.Close()` placed immediately after the err check on `QueryContext`. There is no other valid pattern. A linter (`rowserrcheck`, `sqlclosecheck`) catches this; wire one into CI.

Read after running: `sql.go`, search for `func (rs *Rows) Next() bool`. The path where `Next` returns false because of error or end-of-rows calls `rs.close(err)` — which IS the implicit close. BUT the early-return path (caller stops iterating before Next returns false) skips that. Only `rows.Close()` covers both shapes; that's why defer is non-negotiable.

</details>

---

## Task 18 — Custom database/sql/driver for a fake protocol (Staff)

**Goal.** Build a complete driver for a fictional protocol: in-process, in-memory, supports `CREATE TABLE / INSERT / SELECT *` for tables with `(int, string)` columns. Register it under `sql.Register("memdb", ...)`. Use it from `database/sql` with full Prepare/Query/Exec semantics. Educational — the goal is to internalise every driver interface.

**Starter.**

```go
package main

import (
    "database/sql"
    "database/sql/driver"
    "log"
)

// TODO: implement Driver, Conn, Stmt, Rows, Tx (no-op), Result.
// TODO: a tiny SQL parser (regex-level).
// TODO: register as "memdb".

func main() {
    db, _ := sql.Open("memdb", "")
    _ = db
    _ = driver.Open
    _ = log.Println
}
```

**Hints.**

- Drive your design from the interfaces in `$GOROOT/src/database/sql/driver/driver.go`. Implement only what the stdlib *requires* (Conn, Stmt, Rows, Result, Driver). Skip the optional context-aware variants for the first cut; the framework wraps non-context drivers automatically.
- Use a single global store (a `map[string][]row`) guarded by a mutex. This is a *fake* driver.
- The parser is intentionally tiny — `strings.Fields` + regex. The lesson is the interface implementation, not parsing.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "database/sql/driver"
    "errors"
    "fmt"
    "io"
    "log"
    "regexp"
    "strconv"
    "strings"
    "sync"
)

// ---------- in-memory store ----------

type table struct {
    cols []string // column names
    rows [][]any  // each row: []any of len(cols), each value is int64 or string
}

var (
    storeMu sync.Mutex
    store   = map[string]*table{}
)

// ---------- driver.Driver ----------

type memDriver struct{}

func (memDriver) Open(name string) (driver.Conn, error) {
    return &memConn{}, nil
}

// ---------- driver.Conn ----------

type memConn struct {
    closed bool
}

func (c *memConn) Prepare(q string) (driver.Stmt, error) {
    if c.closed {
        return nil, driver.ErrBadConn
    }
    return &memStmt{q: strings.TrimSpace(q)}, nil
}
func (c *memConn) Close() error { c.closed = true; return nil }
func (c *memConn) Begin() (driver.Tx, error) {
    // memdb is a teaching driver — txs are no-ops.
    return &memTx{}, nil
}

// ---------- driver.Tx ----------

type memTx struct{}

func (memTx) Commit() error   { return nil }
func (memTx) Rollback() error { return nil }

// ---------- driver.Stmt ----------

type memStmt struct {
    q string
}

func (s *memStmt) Close() error { return nil }
func (s *memStmt) NumInput() int {
    return strings.Count(s.q, "?")
}

var (
    reCreate = regexp.MustCompile(`(?i)^CREATE\s+TABLE\s+(\w+)\s*\(([^)]+)\)\s*$`)
    reInsert = regexp.MustCompile(`(?i)^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$`)
    reSelect = regexp.MustCompile(`(?i)^SELECT\s+\*\s+FROM\s+(\w+)\s*$`)
)

// ---------- driver.Result ----------

type memResult struct{ affected int64 }

func (r memResult) LastInsertId() (int64, error) { return 0, nil }
func (r memResult) RowsAffected() (int64, error) { return r.affected, nil }

func (s *memStmt) Exec(args []driver.Value) (driver.Result, error) {
    if m := reCreate.FindStringSubmatch(s.q); m != nil {
        name := strings.ToLower(m[1])
        cols := splitCols(m[2])
        storeMu.Lock()
        defer storeMu.Unlock()
        if _, exists := store[name]; exists {
            return nil, fmt.Errorf("table %q exists", name)
        }
        store[name] = &table{cols: cols}
        return memResult{affected: 0}, nil
    }
    if m := reInsert.FindStringSubmatch(s.q); m != nil {
        name := strings.ToLower(m[1])
        wantCols := splitCols(m[2])
        valTokens := splitCols(m[3])
        storeMu.Lock()
        defer storeMu.Unlock()
        t, ok := store[name]
        if !ok {
            return nil, fmt.Errorf("no such table %q", name)
        }
        if len(wantCols) != len(t.cols) {
            return nil, fmt.Errorf("column count mismatch")
        }
        row := make([]any, len(t.cols))
        argIdx := 0
        for i, tok := range valTokens {
            if tok == "?" {
                if argIdx >= len(args) {
                    return nil, fmt.Errorf("not enough args")
                }
                row[i] = args[argIdx]
                argIdx++
                continue
            }
            // literal int or quoted string
            if n, err := strconv.ParseInt(tok, 10, 64); err == nil {
                row[i] = n
            } else {
                row[i] = strings.Trim(tok, "'")
            }
        }
        t.rows = append(t.rows, row)
        return memResult{affected: 1}, nil
    }
    return nil, fmt.Errorf("memdb: unsupported Exec: %s", s.q)
}

// ---------- driver.Rows ----------

type memRows struct {
    cols []string
    rows [][]any
    pos  int
}

func (r *memRows) Columns() []string { return r.cols }
func (r *memRows) Close() error      { return nil }
func (r *memRows) Next(dest []driver.Value) error {
    if r.pos >= len(r.rows) {
        return io.EOF // canonical signal for "no more rows"
    }
    for i, v := range r.rows[r.pos] {
        dest[i] = v
    }
    r.pos++
    return nil
}

func (s *memStmt) Query(args []driver.Value) (driver.Rows, error) {
    if m := reSelect.FindStringSubmatch(s.q); m != nil {
        name := strings.ToLower(m[1])
        storeMu.Lock()
        defer storeMu.Unlock()
        t, ok := store[name]
        if !ok {
            return nil, fmt.Errorf("no such table %q", name)
        }
        // Deep-copy the snapshot so concurrent writes don't mutate the iter.
        rows := make([][]any, len(t.rows))
        for i, r := range t.rows {
            cp := make([]any, len(r))
            copy(cp, r)
            rows[i] = cp
        }
        return &memRows{cols: append([]string(nil), t.cols...), rows: rows}, nil
    }
    return nil, fmt.Errorf("memdb: unsupported Query: %s", s.q)
}

// ---------- helpers ----------

func splitCols(s string) []string {
    parts := strings.Split(s, ",")
    out := make([]string, len(parts))
    for i, p := range parts {
        out[i] = strings.TrimSpace(p)
    }
    return out
}

// ---------- registration & demo ----------

func init() {
    sql.Register("memdb", memDriver{})
}

func main() {
    db, err := sql.Open("memdb", "")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    ctx := context.Background()

    if _, err := db.ExecContext(ctx, `CREATE TABLE users (id, name)`); err != nil {
        log.Fatal(err)
    }
    if _, err := db.ExecContext(ctx,
        `INSERT INTO users(id, name) VALUES (?, ?)`, 1, "Ada"); err != nil {
        log.Fatal(err)
    }
    if _, err := db.ExecContext(ctx,
        `INSERT INTO users(id, name) VALUES (?, ?)`, 2, "Grace"); err != nil {
        log.Fatal(err)
    }

    rows, err := db.QueryContext(ctx, `SELECT * FROM users`)
    if err != nil {
        log.Fatal(err)
    }
    defer rows.Close()
    for rows.Next() {
        var id int64
        var name string
        if err := rows.Scan(&id, &name); err != nil {
            log.Fatal(err)
        }
        fmt.Printf("id=%d name=%q\n", id, name)
    }
    if err := rows.Err(); err != nil {
        log.Fatal(err)
    }
    // memdb-specific: prove that the wrapped *sql.DB pool works.
    fmt.Printf("DBStats: %+v\n", db.Stats())
    _ = errors.New
}
```

Output:

```
id=1 name="Ada"
id=2 name="Grace"
DBStats: {MaxOpenConnections:0 OpenConnections:1 InUse:0 Idle:1 WaitCount:0 WaitDuration:0s MaxIdleClosed:0 MaxIdleTimeClosed:0 MaxLifetimeClosed:0}
```

Read after running: walk the `driver` package interfaces top to bottom:

- `Driver.Open` — produce a `Conn`.
- `Conn.Prepare` — produce a `Stmt`.
- `Conn.Close` — free resources.
- `Conn.Begin` — start a `Tx`.
- `Stmt.NumInput` — count of `?` placeholders, or -1 if unknown.
- `Stmt.Exec` — for INSERT/UPDATE/DELETE.
- `Stmt.Query` — for SELECT.
- `Rows.Columns`/`Next`/`Close`.
- `Result.LastInsertId`/`RowsAffected`.

Optional context-aware variants (`QueryerContext`, `ExecerContext`, `ConnBeginTx`, `SessionResetter`) let the framework skip its compatibility shim — implement them in a real driver to support cancellation, isolation, and conn lifecycle hooks. The fake above intentionally skips them so the wrapper layer in `sql.go` does its compatibility work — `grep ctxQuerier sql.go` shows where.

</details>

---

## Task 19 — Go pool reaper vs HikariCP — design comparison (Staff)

**Goal.** Read `sql.go`'s `connectionCleaner` and `connectionOpener` carefully. Write a 300-word design comparison with Java's HikariCP — specifically: (a) how each handles MaxLifetime, (b) per-call vs background reaping, (c) what happens to in-flight queries when a conn ages out. This is mostly a reading + writing task; the code is a tiny demo that exercises `SetConnMaxLifetime` to observe reaping behaviour.

**Starter.**

```bash
grep -n 'connectionCleaner\|connectionOpener' "$(go env GOROOT)/src/database/sql/sql.go"
```

```go
// Tiny demo: set ConnMaxLifetime=200ms, hold a conn open by busy-waiting,
// then release it and observe via Stats() that it's been closed (not idle).
```

**Hints.**

- The Go reaper is a single goroutine on a ticker. HikariCP uses scheduled tasks via `ScheduledExecutorService` and per-pool worker threads.
- Go's `SetConnMaxLifetime` only closes conns when they're returned to the pool past their TTL — an in-flight query past TTL completes first. HikariCP has the same behaviour (the "maxLifetime is a SOFT timeout that only applies to idle connections" rule).
- Neither pool can safely yank a conn from a running query — that would break the driver mid-protocol. So the question of "what happens to in-flight" is: "the query finishes, then the conn is discarded instead of returned to idle".

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    db.SetMaxOpenConns(2)
    db.SetConnMaxLifetime(200 * time.Millisecond)

    ctx := context.Background()
    // Open a conn explicitly so we control its lifecycle.
    conn, err := db.Conn(ctx)
    if err != nil {
        log.Fatal(err)
    }

    // Use the conn briefly so it's "born" and counted.
    if _, err := conn.ExecContext(ctx, `SELECT 1`); err != nil {
        log.Fatal(err)
    }
    fmt.Printf("after first use: %+v\n", stats(db))

    // Return it: it goes idle. Reaper hasn't fired yet — still under 200ms.
    if err := conn.Close(); err != nil {
        log.Fatal(err)
    }
    fmt.Printf("after Close (still fresh): %+v\n", stats(db))

    // Wait past MaxLifetime, then poll once. The reaper closes it.
    time.Sleep(400 * time.Millisecond)
    // The reaper runs on a ticker (default sqlMaxLifetime/2). Force a Stats()
    // read which may itself prompt cleanup paths to be observed.
    fmt.Printf("after MaxLifetime: %+v\n", stats(db))

    // Now request a fresh conn — should be a NEW one, not the reaped one.
    conn, err = db.Conn(ctx)
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()
    fmt.Printf("after Conn(): %+v\n", stats(db))
}

func stats(db *sql.DB) string {
    s := db.Stats()
    return fmt.Sprintf("open=%d idle=%d max_lifetime_closed=%d",
        s.OpenConnections, s.Idle, s.MaxLifetimeClosed)
}
```

**Design comparison (the 300 words).**

Both Go's `database/sql` and Java's HikariCP solve the same problem — "recycle long-lived connections before the DB or LB kills them out from under us" — with two structurally similar but tactically different designs.

*Maxlifetime semantics.* Both treat `MaxLifetime` (Go: `SetConnMaxLifetime`; Hikari: `maxLifetime`) as a soft target enforced only at *release time*. A query past the deadline runs to completion; only when the conn returns to idle does the pool decide "this conn is too old, discard instead of cache". Neither pool will kill an in-flight query — the driver protocol state would corrupt mid-stream. Hikari documents this explicitly; Go's behaviour falls out of where the lifetime check is placed in `putConn`.

*Reaper architecture.* Go runs ONE goroutine, `connectionCleaner`, woken by `cleanerCh` and a ticker (interval = MaxLifetime/2 with a 1-second floor). It walks `freeConn` under `db.mu`, closes expired entries, and re-sleeps. Hikari uses a `ScheduledExecutorService` with a `HouseKeeper` task on a fixed period (default 30s, configurable), plus a separate `HouseKeeperExecutor` for housekeeping operations. Hikari's per-pool design is slightly heavier (multiple threads per pool) but allows finer-grained scheduling. Go's single-goroutine design is leaner per pool but means stat collection (`Stats()`) is the only place that contends with reaping on `db.mu`.

*Opener pattern.* Go's `connectionOpener` is a separate goroutine that consumes tokens from `openerCh` and dials. It's how `connRequests` get satisfied without holding `db.mu` across a driver call. Hikari uses a `ConnectionBag` (a hand-rolled lock-free queue) with `addConnectionExecutor` threads. Both achieve the same property: pool acquisition never blocks on dialling because dialling happens off the request path.

*Failure handling.* Go closes a conn on `ErrBadConn` and retries the request once. Hikari evicts on SQL exceptions matching a configurable rule and uses `connectionTestQuery` for proactive validation. Go has no equivalent — it discovers bad conns by trying them.

Both pools converge on the same principles; the differences are mostly in *where* (single goroutine vs thread pool) and *when* (continuous reaper vs scheduled task) the policy is enforced.

Read after running: `sql.go`, search for `connectionCleaner` (the reaper) and `connectionOpener` (the dialer). The pattern is fundamental — every modern pool implementation has these two background workers; you can't avoid them and stay safe.

</details>

---

## Task 20 — Per-tx PostgreSQL statement_timeout (Staff)

**Goal.** Implement a helper `WithStatementTimeout(ctx, db, timeout, fn)` that opens a transaction, sets `SET LOCAL statement_timeout = '500ms'` (or whatever was passed), runs `fn(tx)`, and commits. The `SET LOCAL` scope means the timeout dies with the tx. Demonstrate that a slow query inside the helper times out at the *server* (not just Go's context), and that a fast query commits normally.

**Starter.**

```go
package main

import (
    "context"
    "database/sql"
    "log"

    _ "github.com/jackc/pgx/v5/stdlib"
)

func WithStatementTimeout(
    ctx context.Context, db *sql.DB,
    timeout time.Duration,
    fn func(context.Context, *sql.Tx) error,
) error {
    // TODO: BeginTx, SET LOCAL statement_timeout, run fn, commit/rollback.
    return nil
}

func main() {
    _ = WithStatementTimeout
    _ = log.Println
}
```

**Hints.**

- `SET LOCAL` ties the setting to the current transaction. After commit/rollback it reverts. This is the safe scope — `SET` (no LOCAL) would leak to subsequent uses of the same pooled conn.
- The PG error code is `57014` (`query_canceled`) when statement_timeout fires. You can detect it via `pgx`'s error helpers or just `errors.Is(err, context.DeadlineExceeded)` — no, that's wrong, server-side cancellation comes back as a generic `*pgconn.PgError`. Match on `pgErr.Code == "57014"`.
- The timeout is a STRING in milliseconds with a unit (e.g. `'500ms'`). Don't pass an int as `$1` — the SET command doesn't take parameters. Use safe formatting (we know the value is a `time.Duration`, not user input).

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "os"
    "time"

    "github.com/jackc/pgx/v5/pgconn"
    _ "github.com/jackc/pgx/v5/stdlib"
)

// WithStatementTimeout runs fn inside a transaction with a server-enforced
// per-statement timeout. The timeout fires at the database, not in Go's
// context machinery — important when you need a HARD upper bound that
// survives even a stuck driver.
//
// Senior decision: SET LOCAL, not SET. The local scope means the setting
// dies with the transaction. The non-LOCAL form would leave statement_timeout
// set on the underlying connection AFTER commit, and the next user of that
// pooled conn would inherit it. That's a silent surprise we will not ship.
func WithStatementTimeout(
    ctx context.Context, db *sql.DB,
    timeout time.Duration,
    fn func(context.Context, *sql.Tx) error,
) (err error) {
    if timeout <= 0 {
        return fmt.Errorf("statement timeout must be > 0, got %s", timeout)
    }

    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin: %w", err)
    }
    defer func() {
        if p := recover(); p != nil {
            _ = tx.Rollback()
            panic(p)
        }
        if err != nil {
            if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
                err = errors.Join(err, fmt.Errorf("rollback: %w", rbErr))
            }
        }
    }()

    // Format as integer milliseconds + unit. statement_timeout accepts
    // 'NNNN' (interpreted as ms) or 'NNNNms', 'NNs', etc. Stick to ms for
    // clarity. The value is computed by us, not user input — safe to splice.
    ms := timeout.Milliseconds()
    if ms < 1 {
        ms = 1
    }
    setStmt := fmt.Sprintf("SET LOCAL statement_timeout = '%dms'", ms)
    if _, err = tx.ExecContext(ctx, setStmt); err != nil {
        return fmt.Errorf("set timeout: %w", err)
    }

    if err = fn(ctx, tx); err != nil {
        return err
    }
    if err = tx.Commit(); err != nil {
        return fmt.Errorf("commit: %w", err)
    }
    return nil
}

// isQueryCanceled checks for PG SQLSTATE 57014 (statement_timeout fired).
func isQueryCanceled(err error) bool {
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        return pgErr.Code == "57014"
    }
    return false
}

func main() {
    dsn := os.Getenv("DATABASE_URL")
    if dsn == "" {
        log.Fatal("set DATABASE_URL")
    }
    db, err := sql.Open("pgx", dsn)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    rootCtx := context.Background()

    // Demo 1: a fast query commits.
    fmt.Println("--- fast query ---")
    err = WithStatementTimeout(rootCtx, db, 500*time.Millisecond,
        func(ctx context.Context, tx *sql.Tx) error {
            var n int
            return tx.QueryRowContext(ctx, `SELECT 1`).Scan(&n)
        })
    fmt.Printf("fast: err=%v\n", err)

    // Demo 2: a slow query is cancelled by the server.
    fmt.Println("\n--- slow query (pg_sleep 2) ---")
    err = WithStatementTimeout(rootCtx, db, 200*time.Millisecond,
        func(ctx context.Context, tx *sql.Tx) error {
            _, err := tx.ExecContext(ctx, `SELECT pg_sleep(2)`)
            return err
        })
    if isQueryCanceled(err) {
        fmt.Println("slow: server cancelled with SQLSTATE 57014 (statement_timeout)")
    } else {
        fmt.Printf("slow: err=%v\n", err)
    }

    // Demo 3: prove SET LOCAL didn't leak. Run a different statement
    // outside the helper that would have died if statement_timeout was 200ms.
    fmt.Println("\n--- post-helper independent query ---")
    ctx2, cancel := context.WithTimeout(rootCtx, 5*time.Second)
    defer cancel()
    _, err = db.ExecContext(ctx2, `SELECT pg_sleep(1)`)
    fmt.Printf("independent 1s sleep after helper: err=%v (should be nil)\n", err)
}
```

To run:

```
DATABASE_URL=postgres://localhost/test?sslmode=disable go run main.go
```

Output:

```
--- fast query ---
fast: err=<nil>

--- slow query (pg_sleep 2) ---
slow: server cancelled with SQLSTATE 57014 (statement_timeout)

--- post-helper independent query ---
independent 1s sleep after helper: err=<nil> (should be nil)
```

Why this pattern matters in production:

1. **Defence in depth against context misuse.** Go's `context.WithTimeout` is great but relies on every layer respecting cancellation. A stuck driver, a malformed PG response, or simply a missing `WithTimeout` upstream leaves the query running. Server-side `statement_timeout` is the unconditional backstop.

2. **Per-workload limits.** Different code paths have different acceptable latencies. A real-time API call should die at 100ms; a background report tolerates 30s. `SET LOCAL` lets each call set its own bound without changing global PG config.

3. **Scope safety.** `SET LOCAL` dies with the tx. `SET` would persist on the pooled conn and silently throttle the next caller. The latter is a classic "works on staging, breaks under load" bug because staging's tiny load means the conn never gets reused in time to expose it.

4. **The Go context still matters.** It cancels the client-side wait; without it, even when the server kills the query, the Go goroutine would be blocked reading the response. Use both: server timeout as the hard limit, client context as the local-side bound (typically with a small additional grace, e.g. server=500ms, ctx=750ms).

Read after running: `sql.go` doesn't have `statement_timeout` in it — this is a PG-specific feature your code applies on top. The lesson is that `database/sql` is a thin pool; everything DB-specific is up to you, expressed in SQL. The shape of this helper (Begin → SET LOCAL config → fn → Commit) is the canonical place to push DB-specific per-tx behaviour, and it composes with everything else above — savepoints, replicas, retries, breakers — because every layer is just another wrapper around the same `*sql.DB`.

</details>

---

## How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (got it unaided), `3` (got it AND wrote a runnable test that proved the property — bug reproduced, pool exhausted, NULL handled, timeout fired). Sum:

| Score | What it means |
|-------|---------------|
| 0–20  | You can `sql.Open` and scan a row but you haven't built the mental model. Re-do Tasks 1–4; the rest depend on knowing that `*sql.DB` is a pool, not a connection. |
| 21–35 | You can configure the pool and write a transaction. Push through Tasks 7–10. The Scan/NullString distinction in Task 10 is the single most-asked Go DB interview question; if it didn't click, re-read `convert.go` end to end. |
| 36–50 | You can operate the pool: monitor it, diagnose exhaustion, route reads. Tasks 14–17 push toward staff-level — driver comparison and the canonical leak bug. |
| 51–60 | Staff level. You can build a driver, reason about cross-pool design (Go vs HikariCP), and combine PG server-side features with the Go pool. If Task 20 was easy, you're ready to maintain the pool at a company that scales it past trivial. |

The grade is not the goal. The goal is "after reading `sql.go` and `convert.go` for an afternoon, can you predict what happens to the pool state on any given operation?" — `db.Conn()` increments `numOpen`; `conn.Close()` returns to `freeConn`; a cancelled `QueryContext` poisons the conn (`finalClose`); `SetConnMaxLifetime` flips `cleanerCh`. If those come reflexively you're operating from a model, not from documentation.

Concrete verification commands worth running:

- For Task 5: `go test -race -count=10 ./...` should not flake. The DBStats reader and the goroutines race on `db.mu`, but only under the framework's lock — your test code should be clean.
- For Task 11: `curl -s localhost:2112/metrics | grep go_sql_in_use_connections` should return one line with a small positive integer. If you see `# HELP` but no data point, your `Collect` didn't emit.
- For Task 12: each scenario's `WaitDuration / WaitCount` ratio should approximate the average wait. Scenario A's ratio should be roughly `goroutines * workMS / maxOpen`. If your numbers diverge wildly, you're holding conns longer than you think.
- For Task 17: run with `GODEBUG=schedtrace=200,scheddetail=1` and watch goroutine counts climb in the leaky version. A goroutine waiting on a pool conn shows as `runnable` not `waiting`; tells you exactly where the leak is in real diagnosis.
- For Task 20: confirm `SHOW statement_timeout` outside the helper returns `0` (PG default) — proves `SET LOCAL` did not leak. If it returns your timeout, the LOCAL keyword was dropped somewhere.

---

## Stretch challenges

**S1 — Pool reaper instrumentation patch.** Apply a local patch to your Go source's `connectionCleaner` to emit a structured log every time it closes a conn (reason: `MaxIdleTime` / `MaxLifetime` / `MaxIdleConns`). Build a small harness that runs a workload and writes the log to a file. Analyse the distribution: how many of your closures are lifetime-driven vs idle-driven? In a real service this distinction tells you whether to tune `SetConnMaxLifetime` or `SetMaxIdleConns`. Constraint: the patch must be guarded behind a build tag so a vanilla `go build` produces an unmodified stdlib.

**S2 — Sharded `*sql.DB` over N PGs.** Build a sharded DB that routes by tenant ID (FNV64 hash mod N) to N independent `*sql.DB`s. Add a cross-shard `QueryAll(ctx, q, args)` that fans out, collects results, and aggregates. Handle the failure modes: shard down (fail-fast vs partial result), context cancellation propagation, conn-pool sizing per shard (don't multiply by N — divide the total budget). Prove via load test that a single hot shard doesn't starve the others — pool isolation is the property to verify.

**S3 — Backpressure-aware connection acquisition.** Extend the pool exhaustion diagnosis from Task 12 into a feedback-driven shedder. Track an EWMA of `WaitDuration / WaitCount` (average wait) and SHED requests when it crosses a threshold — return 503 before even trying `db.Conn()`. The hard part is the threshold: too tight and you shed unnecessarily; too loose and the pool oscillates. Wire it as a middleware that exports a Prometheus metric (`shed_total` and `shed_wait_ms_threshold`) so SRE can dial it in. Constraint: the shedder's overhead at the hot path must be `<200ns` per request (atomic load + compare; no locks).
