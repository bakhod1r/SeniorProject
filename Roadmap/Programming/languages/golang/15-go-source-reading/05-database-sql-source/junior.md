# `database/sql` Source — Junior

## 1. What `database/sql` is

`database/sql` is Go's standard *generic* interface to SQL databases. It doesn't talk to Postgres, MySQL, or SQLite directly. It talks to a **driver** — a small package that knows the wire protocol for one specific database. Your code talks to `database/sql`; `database/sql` talks to the driver; the driver talks to the server.

```
your code  →  database/sql  →  driver (lib/pq, mysql, sqlite3, pgx, ...)  →  the DB
```

This indirection is why you can swap MySQL for Postgres by changing one import and the connection string. The API you call (`db.Query`, `db.Exec`, `tx.Commit`) doesn't change.

> If you came from Java, this is JDBC. If you came from Python, it's PEP 249 / DB-API. Same pattern: a thin standard interface, with per-database drivers behind it.

---

## 2. Where the source lives

On your machine:

```bash
go env GOROOT
ls $(go env GOROOT)/src/database/sql
```

You'll see a small package — well under 10 files. The headline ones:

| File | What it covers |
|------|----------------|
| `sql.go` | Public API: `DB`, `Conn`, `Tx`, `Stmt`, `Rows`, `Row`; the connection pool |
| `driver/driver.go` | The interfaces a driver must implement (`Driver`, `Conn`, `Stmt`, `Rows`, `Tx`) |
| `driver/types.go` | `Value`, `Valuer`, `NamedValue`, default value converters |
| `convert.go` | Scanning DB values into Go types (`int64 → int`, `[]byte → string`, etc.) |
| `ctxutil.go` | Helpers that adapt context-aware driver methods to the legacy ones |
| `sql_test.go` | A fake driver used by the standard library's own tests — great for reading |

The same code is on GitHub at `github.com/golang/go/tree/master/src/database/sql`. Pin to a tag (e.g., `go1.22.0`) when you read.

---

## 3. Prerequisites

- Basic Go: structs, interfaces, error handling, `defer`.
- You've written at least one program that opened a SQL database in *some* language.
- Comfort with the idea that "interface" in Go means a contract — `database/sql/driver.Conn` is a contract a Postgres driver has to satisfy.

You do **not** need to know how the Postgres wire protocol works, or how connection pools are tuned. Those are senior- and professional-level topics.

---

## 4. Drivers and registration

`database/sql` is empty on its own. To actually connect to a database you import a driver package for its side effects:

```go
import (
    "database/sql"
    _ "github.com/lib/pq" // Postgres driver, registers itself
)
```

The `_` is intentional — you never call anything from `lib/pq` directly. Its `init()` function calls:

```go
sql.Register("postgres", &Driver{})
```

That puts the driver into a private map in `sql.go`. Now `sql.Open("postgres", dsn)` can find it by name.

Common drivers you'll meet:

| Database | Import | Name passed to `sql.Open` |
|----------|--------|---------------------------|
| Postgres | `github.com/lib/pq` | `"postgres"` |
| Postgres (newer) | `github.com/jackc/pgx/v5/stdlib` | `"pgx"` |
| MySQL / MariaDB | `github.com/go-sql-driver/mysql` | `"mysql"` |
| SQLite | `github.com/mattn/go-sqlite3` | `"sqlite3"` |

If you forget the `_ "github.com/lib/pq"` import, `sql.Open("postgres", ...)` returns `sql: unknown driver "postgres" (forgotten import?)`. That message comes straight from `sql.go`.

---

## 5. `DB` is a pool, not a connection

This is the single biggest thing to internalize.

```go
db, err := sql.Open("postgres", dsn)
```

`db` is a `*sql.DB`. It is **not** a connection. It is a *pool* of connections — possibly zero, possibly dozens. `sql.Open` doesn't even open a network socket; it just validates the DSN and parks the pool. The first real connection happens when you run a query (or call `db.Ping()`).

Consequences:

- You create **one** `*sql.DB` for the whole program (or per database), at startup. Not one per request.
- You don't close it after every query. You close it when the program is shutting down (or never — leaking a `*sql.DB` at exit is harmless).
- The pool grows on demand. `db.SetMaxOpenConns(n)` caps it. `db.SetMaxIdleConns(n)` controls how many sit idle.
- Concurrency is fine: `*sql.DB` is safe for use from many goroutines. The pool hands out connections one-per-goroutine internally.

In `sql.go` the pool is a slice of `*driverConn` plus a queue of waiters. `db.conn(ctx)` is the function that hands one out (or blocks until one is free).

---

## 6. The four main types

| Type | What it is | Goroutine-safe? |
|------|------------|-----------------|
| `*sql.DB` | The pool. Long-lived. | Yes |
| `*sql.Conn` | A single dedicated connection borrowed from the pool. | Yes (but one query at a time) |
| `*sql.Tx` | A transaction. Holds one connection until `Commit` or `Rollback`. | **No** — one goroutine only |
| `*sql.Stmt` | A prepared statement. | Yes |

Plus two result types:

- `*sql.Rows` — an open cursor over many rows. **Must be closed.**
- `*sql.Row` — a one-row helper returned by `QueryRow`. Close happens automatically when you call `Scan`.

---

## 7. A minimal example

```go
package main

import (
    "database/sql"
    "fmt"
    "log"

    _ "github.com/mattn/go-sqlite3"
)

func main() {
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    if _, err := db.Exec(`CREATE TABLE users (id INTEGER, name TEXT)`); err != nil {
        log.Fatal(err)
    }
    if _, err := db.Exec(`INSERT INTO users VALUES (1, 'Ada'), (2, 'Linus')`); err != nil {
        log.Fatal(err)
    }

    rows, err := db.Query(`SELECT id, name FROM users`)
    if err != nil {
        log.Fatal(err)
    }
    defer rows.Close() // critical

    for rows.Next() {
        var id int
        var name string
        if err := rows.Scan(&id, &name); err != nil {
            log.Fatal(err)
        }
        fmt.Println(id, name)
    }
    if err := rows.Err(); err != nil { // check errors after the loop
        log.Fatal(err)
    }
}
```

Five things to notice:

1. `sql.Open` doesn't connect — `db.Exec` does.
2. `rows` is wrapped in `defer rows.Close()` *before* the loop.
3. `Scan` takes pointers, not values.
4. `rows.Err()` is checked *after* the loop, because `Next()` returns `false` both for "no more rows" and for "an error happened".
5. We never close the `*sql.DB` per-query. One `defer db.Close()` at program exit.

---

## 8. The `Context` variants

Every blocking method on `DB`, `Conn`, `Tx`, and `Stmt` has a `*Context` cousin:

| Plain | Context-aware |
|-------|---------------|
| `db.Query` | `db.QueryContext(ctx, ...)` |
| `db.Exec` | `db.ExecContext(ctx, ...)` |
| `db.Begin` | `db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})` |
| `db.Ping` | `db.PingContext(ctx)` |
| `stmt.Query` | `stmt.QueryContext(ctx, ...)` |

Rule: **always use the `Context` versions** in new code. They let you cancel a query when the caller (HTTP request, RPC) goes away. The plain versions in `sql.go` are literally implemented as `XxxContext(context.Background(), ...)`.

In `ctxutil.go` you'll find the small adapter functions that bridge an older driver (which only implements `Query`) to the modern `QueryContext` API.

---

## 9. Why every `Rows` must be closed

When you call `db.Query`, the pool hands a connection to the resulting `*sql.Rows`. That connection is **out of the pool** until `rows.Close()` is called. If you forget:

- The connection isn't returned. The pool shrinks by one.
- Do this in a loop and you leak every connection — eventually `db.Query` blocks forever waiting for one to come back.
- `rows.Next()` calls `Close` for you when it returns `false` *normally*. But if you `break` out of the loop, or `return` early, or hit an error inside the loop body, `Close` is skipped.

The safe rule: `defer rows.Close()` immediately after the `db.Query` line. Closing twice is fine — `Close` is idempotent.

`*sql.Row` (from `QueryRow`) closes itself inside `Scan`, so you don't need a defer there.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **Driver** | A package implementing `database/sql/driver` interfaces for one specific database |
| **DSN** | "Data Source Name" — the connection string (`host=... user=... dbname=...`) |
| **Connection pool** | A reusable set of open DB connections, kept warm so queries don't pay a TCP+TLS+auth handshake every time |
| **Statement** | A SQL string sent to the database |
| **Prepared statement** | A SQL string parsed once by the server, then executed many times with different parameters |
| **Row** | One result tuple from a `SELECT` |
| **Cursor** | A server-side pointer that walks through a result set; `*sql.Rows` wraps one |
| **Transaction** | A unit of work that either fully commits or fully rolls back |
| **Driver value** | One of the limited types a driver can return: `int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, `nil` |

---

## 11. Common confusions

- **"A `*sql.DB` is one connection." No** — it's a pool. Create one and share it across goroutines.
- **"I should close `*sql.DB` after each query." No** — close it once at program shutdown. Closing per query throws away the pool.
- **"`*sql.Tx` is safe to share between goroutines." No** — a `Tx` is bound to one connection. Use it from a single goroutine. Share the `*sql.DB`, not the `*sql.Tx`.
- **"`sql.Open` opens a connection." No** — it just builds the pool object. Call `db.Ping()` (or any query) if you want to verify the DB is reachable at startup.
- **"`Scan` is type-strict like Go assignment." Not quite** — `convert.go` will turn `[]byte` into `string`, `int64` into `int`, parse `time.Time` from a string in some drivers. The conversions are forgiving but documented.
- **"If `rows.Next()` returns `false`, the loop succeeded." Not always** — it returns `false` on errors too. Always check `rows.Err()` afterwards.
- **"Prepared statements are always faster." No** — for a one-shot query, `Exec` is simpler. Prepared statements pay off when you run the same SQL many times with different args.

---

## 12. The map you should leave with

```
$GOROOT/src/database/sql/
├── sql.go              # DB, Conn, Tx, Stmt, Rows, Row, the pool
├── convert.go          # Scan: driver value → Go variable
├── ctxutil.go          # Context-aware <-> legacy driver adapters
└── driver/
    ├── driver.go       # Driver, Conn, Stmt, Tx, Rows interfaces
    └── types.go        # Value, Valuer, NamedValue, default converter
```

If you can open these files and find:

- `sql.Register` (in `sql.go`)
- `func (db *DB) conn(` — how a connection is borrowed from the pool (in `sql.go`)
- `func (rs *Rows) Close(` — what happens when a result set ends (in `sql.go`)
- `type Driver interface` and `type Conn interface` (in `driver/driver.go`)

… you've achieved the junior-level goal.

---

## 13. Summary

`database/sql` is a thin generic layer. It defines interfaces (`Driver`, `Conn`, `Stmt`, `Rows`, `Tx`) in `driver/driver.go`, and a connection pool plus a friendly API (`DB`, `Conn`, `Tx`, `Stmt`, `Rows`, `Row`) in `sql.go`. You import a driver for its side effects, open one long-lived `*sql.DB`, use the `*Context` methods, always `defer rows.Close()`, and never share a `*sql.Tx` across goroutines. At this level the goal is to know the file map and the four-types-plus-Rows shape — not to understand the pool's locking. That comes next.

---

## Further reading
- Go source: `https://github.com/golang/go/tree/master/src/database/sql` (pin to a tag like `go1.22.0`)
- `database/sql` package docs: `https://pkg.go.dev/database/sql`
- `database/sql/driver` docs: `https://pkg.go.dev/database/sql/driver`
- "Go database/sql tutorial" — `http://go-database-sql.org` — practical patterns
- `lib/pq`, `go-sql-driver/mysql`, `mattn/go-sqlite3`, `jackc/pgx` — read a driver's `Open` and `Query` to see the interfaces in action
