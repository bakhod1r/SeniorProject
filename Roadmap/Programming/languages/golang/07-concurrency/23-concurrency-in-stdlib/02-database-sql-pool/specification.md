---
layout: default
title: database/sql Pool — Specification
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/specification/
---

# database/sql Connection Pool — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Go database/sql Package Documentation](#go-databasesql-package-documentation)
3. [database/sql/driver Interface Contracts](#databasesqldriver-interface-contracts)
4. [The Single-Thread Guarantee](#the-single-thread-guarantee)
5. [Connection Lifecycle](#connection-lifecycle)
6. [Context Cancellation Contract](#context-cancellation-contract)
7. [Transaction Contracts](#transaction-contracts)
8. [Prepared Statement Contracts](#prepared-statement-contracts)
9. [Go Memory Model Implications](#go-memory-model-implications)
10. [SQL Standard Transaction Isolation](#sql-standard-transaction-isolation)
11. [Cross-Reference Table](#cross-reference-table)
12. [References](#references)

---

## Introduction

This file collects normative excerpts from `database/sql` and `database/sql/driver` package docs, the relevant Go memory model statements, and the SQL standard isolation levels referenced by `sql.IsolationLevel`. It is the reference you consult when a behavior in the junior/middle/senior files needs an authoritative source.

Citations are taken from Go 1.22 source comments and the SQL:2016 standard. Paraphrased only for compactness.

---

## Go database/sql Package Documentation

### `*sql.DB` is a pool, not a connection

From `database/sql/sql.go` package doc:

> DB is a database handle representing a pool of zero or more underlying connections. It's safe for concurrent use by multiple goroutines. The sql package creates and frees connections automatically; it also maintains a free pool of idle connections. If the database has a concept of per-connection state, such state can be reliably observed within a transaction (Tx) or connection (Conn). Once DB.Begin is called, the returned Tx is bound to a single connection. Once Commit or Rollback is called on the transaction, that transaction's connection is returned to DB's idle connection pool.

### Pool limits

From `database/sql/sql.go` doc comments on the setters:

> SetMaxOpenConns sets the maximum number of open connections to the database. If MaxIdleConns is greater than 0 and the new MaxOpenConns is less than MaxIdleConns, then MaxIdleConns will be reduced to match the new MaxOpenConns limit. If n <= 0, then there is no limit on the number of open connections. The default is 0 (unlimited).

> SetMaxIdleConns sets the maximum number of connections in the idle connection pool. If MaxOpenConns is greater than 0 but less than the new MaxIdleConns, then the new MaxIdleConns will be reduced to match the MaxOpenConns limit. If n <= 0, no idle connections are retained. The default max idle connections is currently 2. This may change in a future release.

> SetConnMaxLifetime sets the maximum amount of time a connection may be reused. Expired connections may be closed lazily before reuse. If d <= 0, connections are not closed due to a connection's age.

> SetConnMaxIdleTime sets the maximum amount of time a connection may be idle. Expired connections may be closed lazily before reuse. If d <= 0, connections are not closed due to a connection's idle time.

### `DB.Conn` for single-connection scope

> Conn returns a single connection by either opening a new connection or returning an existing connection from the connection pool. Conn will block until either a connection is returned or ctx is canceled. Queries run on the same Conn will be run in the same database session. Every Conn must be returned to the database pool after use by calling Conn.Close.

### `DB.PingContext` opens a connection if necessary

> PingContext verifies a connection to the database is still alive, establishing a connection if necessary.

---

## database/sql/driver Interface Contracts

### `driver.Driver`

```go
type Driver interface {
    Open(name string) (Conn, error)
}
```

> Open returns a new connection to the database. The name is a string in a driver-specific format. Open may return a cached connection (one previously closed), but doing so is unnecessary; the sql package maintains a pool of idle connections for efficient re-use.

### `driver.Connector` (preferred since Go 1.10)

```go
type Connector interface {
    Connect(ctx context.Context) (Conn, error)
    Driver() Driver
}
```

> Connect returns a connection to the database. Connect may return a cached connection (one previously closed), but doing so is unnecessary; the sql package maintains a pool of idle connections for efficient re-use. The provided context.Context is for dialing only and should not be retained for use after Connect returns.

### `driver.Conn`

```go
type Conn interface {
    Prepare(query string) (Stmt, error)
    Close() error
    Begin() (Tx, error)
}
```

Extended interfaces a real driver should also implement:

- `ConnPrepareContext`: `PrepareContext(ctx context.Context, query string) (Stmt, error)`
- `ConnBeginTx`: `BeginTx(ctx context.Context, opts TxOptions) (Tx, error)`
- `Pinger`: `Ping(ctx context.Context) error`
- `Validator`: `IsValid() bool` (Go 1.15+, used by `sql` to drop bad conns before reuse)
- `SessionResetter`: `ResetSession(ctx context.Context) error` (called before reuse)
- `NamedValueChecker`, `ExecerContext`, `QueryerContext`

### Driver `Stmt`

```go
type Stmt interface {
    Close() error
    NumInput() int
    Exec(args []Value) (Result, error)   // deprecated; use StmtExecContext
    Query(args []Value) (Rows, error)    // deprecated; use StmtQueryContext
}
```

Extended:
- `StmtExecContext`
- `StmtQueryContext`

### Driver `Rows`

```go
type Rows interface {
    Columns() []string
    Close() error
    Next(dest []Value) error
}
```

Extended:
- `RowsColumnTypeDatabaseTypeName`, `RowsColumnTypeLength`, `RowsColumnTypeNullable`, `RowsColumnTypePrecisionScale`, `RowsColumnTypeScanType`
- `RowsNextResultSet`

---

## The Single-Thread Guarantee

From `database/sql/driver/driver.go` package doc:

> All Conn implementations should implement the following interfaces: Pinger, SessionResetter, and Validator. If named parameters or context are supported, the driver's Conn should implement: ExecerContext, QueryerContext, ConnPrepareContext, and ConnBeginTx.

And critically:

> Drivers are now encouraged to implement Validator, IsValid(). The sql package will call IsValid before reusing a connection. If IsValid returns false, the connection will be removed from the pool.

The single-thread guarantee (paraphrased from package commentary and the `(*DB).conn` lock structure in `sql.go:1330`):

> A driver's Conn and any objects derived from it (Stmt, Tx, Rows) MUST NOT be used concurrently by multiple goroutines. The sql package ensures this by holding `driverConn.Lock()` for the duration of every operation that touches a particular `*driverConn`.

This means a driver author writing `(*pgConn).ExecContext` may freely assume:
- No other goroutine is calling any method on this `Conn` at the same time.
- No `Stmt` derived from this conn is being used concurrently.
- The conn's network socket has a single reader and a single writer.

The driver may still launch internal goroutines (e.g., for reading the wire) but must serialize external API calls itself if it does so.

---

## Connection Lifecycle

A `driverConn` (the sql-package wrapper around `driver.Conn`) progresses through these states:

| State          | Field/Condition                                            | Meaning                                          |
|----------------|------------------------------------------------------------|--------------------------------------------------|
| Opening        | counted in `numOpen`, not yet in `freeConn`                | `connectionOpener` is dialing                    |
| Idle (free)    | in `freeConn` slice, `inUse == false`                      | Available for next `conn()` call                 |
| Checked out    | `inUse == true`, removed from `freeConn`                   | A goroutine owns it for query or tx              |
| Closing        | `closed == true`, removed from `freeConn`, in `numOpen`    | Either age/idle-time expired or driver returned an error |
| Closed         | `numOpen` decremented, `dc.finalClose()` called            | Returned to driver `Close()`                     |

See `database/sql/sql.go:467` for `*driverConn` struct definition. The fields `dc.inUse`, `dc.closed`, `dc.dbmuClosed`, and `dc.createdAt` are protected by `dc.Lock()` (a per-conn `sync.Mutex`), while `dc.db.freeConn` and `dc.db.numOpen` are protected by `dc.db.mu`.

---

## Context Cancellation Contract

From `database/sql/sql.go` doc on `DB.QueryContext`:

> QueryContext executes a query that returns rows, typically a SELECT. The args are for any placeholder parameters in the query.

The ctx contract has three points:

1. **Before checkout.** If `ctx` is already canceled before `(*DB).conn` is reached, `conn()` returns `ctx.Err()` without allocating a conn.
2. **While waiting in `connRequests`.** If `ctx` is canceled while the goroutine is parked on its request channel, `(*DB).conn` returns `ctx.Err()` and arranges that any future fulfilment of the request is put back into the pool. See `sql.go:1390-1430`.
3. **During driver work.** Once the conn is in the driver's hands, the driver's `*Context` method is responsible for honoring cancellation. The `sql` package spawns a small "ctx-watcher" goroutine (`(*DB).withLock` → `tx.awaitDone`-style) that calls back into the driver to abort.

### Spec text on cancellation

From `database/sql/driver/driver.go`:

> If a Conn does not implement QueryerContext, the sql package's DB.Query will fall back to Queryer. If a Conn implements neither, DB.Query will use Prepare followed by Stmt.Query. Cancellation is best-effort; the driver may not be able to interrupt an in-flight query.

---

## Transaction Contracts

### `sql.IsolationLevel`

```go
type IsolationLevel int

const (
    LevelDefault         IsolationLevel = iota
    LevelReadUncommitted
    LevelReadCommitted
    LevelWriteCommitted
    LevelRepeatableRead
    LevelSnapshot
    LevelSerializable
    LevelLinearizable
)
```

From the SQL:2016 standard, §4.35.4 (paraphrased):

| Level             | Phenomena prevented                                          |
|-------------------|--------------------------------------------------------------|
| READ UNCOMMITTED  | None                                                          |
| READ COMMITTED    | Dirty reads                                                  |
| REPEATABLE READ   | Dirty reads, non-repeatable reads                            |
| SERIALIZABLE      | Dirty reads, non-repeatable reads, phantom reads             |

`SNAPSHOT` and `LINEARIZABLE` are not in SQL:2016 but are commonly supported by Postgres, MS SQL, and Spanner respectively.

### `Tx` pinning

From the `sql.Tx` doc:

> Tx is an in-progress database transaction. A transaction must end with a call to Commit or Rollback. After a call to Commit or Rollback, all operations on the transaction fail with ErrTxDone. The statements prepared for a transaction by calling the transaction's Prepare or Stmt methods are closed by the call to Commit or Rollback.

This is the formal source of the "transaction pins a connection" rule: every `Tx` holds an exclusive reference to a `*driverConn` from `BeginTx` until `Commit` or `Rollback`.

---

## Prepared Statement Contracts

From the `sql.Stmt` doc:

> A prepared statement is safe for concurrent use by multiple goroutines.

This is implemented in `database/sql/sql.go:2700`+ by caching, per `*sql.Stmt`, a map from `*driverConn` to `driver.Stmt`. When a goroutine calls `stmt.QueryContext`, the package:

1. Acquires a `*driverConn` (via `(*DB).conn`).
2. Looks up the driver `Stmt` for this conn in the cache; if absent, calls `dc.ci.PrepareContext`.
3. Executes the query.
4. Returns the conn to the pool (driver stmt stays cached on the conn).

This is why a `*sql.Stmt` is goroutine-safe even though a `driver.Stmt` is not: each goroutine gets its own conn-bound driver stmt.

---

## Go Memory Model Implications

From `https://go.dev/ref/mem`:

> The closing of a channel happens before a receive that returns because the channel is closed.

> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() happens before call m of l.Lock() returns.

Applied to `database/sql`:

- `dc.db.mu.Lock()` in `(*DB).conn` synchronizes-with `dc.db.mu.Unlock()` in `(*DB).putConn`, so a conn returned by goroutine A is safely usable by goroutine B.
- The `connRequest` channel send/receive in `putConnDBLocked` (sql.go:1480) establishes a happens-before edge from the releasing goroutine to the waiting goroutine.
- The per-conn `dc.Lock()` makes all driver-side state writes visible to any subsequent user of that conn.

The sql package does NOT use any `sync/atomic` field on `driverConn` for ordering — every cross-goroutine field is mutex-protected.

---

## SQL Standard Transaction Isolation

SQL:2016 §4.35.4 defines four standard levels; `database/sql` maps them as follows:

| `sql.LevelXxx`        | SQL standard        | Notes                                           |
|------------------------|---------------------|-------------------------------------------------|
| LevelReadUncommitted   | READ UNCOMMITTED    | Allows dirty reads                              |
| LevelReadCommitted     | READ COMMITTED      | Default in Postgres, Oracle                     |
| LevelRepeatableRead    | REPEATABLE READ     | Default in MySQL InnoDB                         |
| LevelSerializable      | SERIALIZABLE        | Strongest standard level                        |
| LevelSnapshot          | (not in std)        | Postgres `REPEATABLE READ` is actually snapshot |
| LevelLinearizable      | (not in std)        | Spanner external consistency                    |

The driver translates `sql.TxOptions.Isolation` to a `SET TRANSACTION ISOLATION LEVEL ...` statement (or driver-specific protocol message) when the underlying `driver.ConnBeginTx` is called.

---

## Cross-Reference Table

| Concept                     | Source location                                         | Lock                                  |
|-----------------------------|---------------------------------------------------------|---------------------------------------|
| `DB` struct                 | `database/sql/sql.go:430`                               | `DB.mu`                               |
| `driverConn` struct         | `database/sql/sql.go:467`                               | `driverConn.Lock` and `DB.mu`         |
| `(*DB).conn`                | `database/sql/sql.go:1330`                              | `DB.mu`                               |
| `(*DB).putConn`             | `database/sql/sql.go:1450`                              | `DB.mu`                               |
| `(*DB).putConnDBLocked`     | `database/sql/sql.go:1475`                              | caller holds `DB.mu`                  |
| `(*DB).connectionOpener`    | `database/sql/sql.go:1190`                              | takes `DB.mu`                         |
| `(*DB).openNewConnection`   | `database/sql/sql.go:1210`                              | takes `DB.mu`                         |
| `(*DB).connectionCleaner`   | `database/sql/sql.go:1080`                              | takes `DB.mu`                         |
| `connRequest` channel       | `database/sql/sql.go:480` (map field)                   | per-request channel; `DB.mu` guards map |
| `freeConn` slice            | `database/sql/sql.go:444`                               | `DB.mu`                               |
| `Tx.Commit` / `Rollback`    | `database/sql/sql.go:2200`+                             | `Tx.closemu`, `Tx.cancel`, `dc.Lock`  |
| `Stmt.QueryContext`         | `database/sql/sql.go:2880`+                             | `Stmt.css` slice, per-conn `dc.Lock`  |

---

## References

1. Go source: `src/database/sql/sql.go` (Go 1.22+).
2. Go source: `src/database/sql/driver/driver.go`.
3. Go memory model: https://go.dev/ref/mem.
4. Go `database/sql` package doc: https://pkg.go.dev/database/sql.
5. Go `database/sql/driver` package doc: https://pkg.go.dev/database/sql/driver.
6. SQL:2016 standard (ISO/IEC 9075-1:2016), §4.35 Transactions.
7. PostgreSQL docs on isolation levels: https://www.postgresql.org/docs/current/transaction-iso.html.
8. MySQL InnoDB locking and isolation: https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html.
9. Go blog: "Go Database/SQL Tutorial" (still authoritative for pool semantics).
10. Brad Fitzpatrick's original `database/sql` design notes (golang-dev mailing list, 2011–2013).
