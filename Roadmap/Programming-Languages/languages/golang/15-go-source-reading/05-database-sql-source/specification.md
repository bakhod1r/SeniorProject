# `database/sql` Source — Specification

## 1. Intro

`database/sql` is Go's standard interface to relational databases. It does not bundle a driver; it defines the contract that drivers implement and the user-facing types and methods that programs call. The package shipped in Go 1.0 (March 2012) and has lived under the Go 1 compatibility promise ever since: the user-facing API at `database/sql` is stable, the names do not change, and the behaviour of existing methods is preserved across releases. New capability lands as new optional driver interfaces or as `*Context` variants rather than as breaking changes to the original surface.

The package is governed by two source trees in the standard library: `src/database/sql/` for the user-facing API and `src/database/sql/driver/` for the driver contract. The driver tree is the extension point — any package satisfying the driver interfaces and calling `sql.Register("name", driverInstance)` participates without modifying the standard library. PostgreSQL drivers (`lib/pq`, `jackc/pgx`'s `stdlib` adapter), MySQL drivers (`go-sql-driver/mysql`), SQLite drivers (`mattn/go-sqlite3`, `modernc.org/sqlite`), Microsoft SQL Server drivers (`microsoft/go-mssqldb`), Oracle drivers (`sijms/go-ora`), ClickHouse drivers (`ClickHouse/clickhouse-go`), and dozens of niche drivers all interoperate through this single contract. The package itself contains zero database-specific code; every wire-protocol byte is the driver's responsibility.

The architecture is a textbook example of the dependency inversion principle in standard-library form: the high-level policy (pooling, retry, context propagation, prepared-statement caching, transaction tracking) is in `database/sql`; the low-level mechanism (parsing the DSN, opening a TCP socket, framing a query packet, decoding a result row) is in the driver. The two communicate through the interfaces in `database/sql/driver`. Adding a new database engine to the Go ecosystem requires zero changes to the standard library — only a new package implementing the driver interfaces.

The package documentation lives at <https://pkg.go.dev/database/sql> and <https://pkg.go.dev/database/sql/driver>. Source for the current release is at <https://github.com/golang/go/tree/master/src/database/sql>. The list of registered third-party drivers is maintained at <https://github.com/golang/go/wiki/SQLDrivers>. The design rationale is summarised in the original golang-nuts thread "database/sql design" (2011) and elaborated in Brad Fitzpatrick's GopherCon talk "Go database/sql" (2014); both predate Go 1.8 and so do not cover the context revision, but they remain accurate on the architectural split between pool and driver.

---

## 2. The two-package design

`database/sql` is split into two packages with distinct audiences:

| Package | Audience | Stability discipline |
|---------|----------|----------------------|
| `database/sql` | Application code; the entry point for `Open`, `Query`, `Exec`, `Begin`. | Frozen surface; method names, signatures, and documented semantics unchanged since Go 1.0. New behaviour added as `*Context` siblings or as new top-level functions. |
| `database/sql/driver` | Driver authors; the interfaces a driver implements so that `database/sql` can drive it. | Original interfaces frozen; new optional interfaces added over time (e.g. `ConnBeginTx`, `StmtExecContext`, `NamedValueChecker`, `Validator`). Drivers opt in by implementing the new interface; old drivers keep working. |

The split lets application code import only `database/sql` and never see the driver contract. The driver package is imported by driver authors and by application code only for the side effect of registration (the conventional `_ "github.com/go-sql-driver/mysql"` blank import calls `sql.Register("mysql", &MySQLDriver{})` from the driver's `init()`).

The handshake between the two packages is mediated by `sql.Register` and `sql.Open`. `Register` stores driver instances in a package-level map; `Open(name, dsn)` looks up the driver by name and returns a `*sql.DB` that wraps the driver's `Conn`s in a connection pool with retry, context cancellation, statement caching, and transaction tracking. The driver itself does none of that — its job is to talk wire protocol to a database; the pool, the contexts, and the retry policy are `database/sql`'s job.

A consequence of the split is that the pool semantics are uniform across drivers. `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`, and `SetConnMaxIdleTime` configure the pool's policy regardless of which database is behind it; an application moving from MySQL to PostgreSQL changes the driver import and the DSN but does not rewrite its pool-tuning code. Likewise, context cancellation, prepared-statement reuse, and transaction tracking are implemented once and inherited by every driver that opts into the relevant interfaces. This is the standard-library payoff of the inversion: complex cross-cutting policy lives in one place and benefits every database.

A second consequence is the testing story. Because the contract is interface-based, an in-memory fake driver (the standard library's own `fakedb_test.go`, or third-party packages like `DATA-DOG/go-sqlmock`) can be substituted for a real database in tests. The application code under test still sees `*sql.DB` and calls `Query` and `Exec`; the test driver records the calls or returns canned results. This is impossible in language ecosystems where the database client is a concrete class with no interface surface; in Go it is the default mode of unit testing data-access code.

A third consequence — easy to miss until a production incident exposes it — is that every cross-cutting concern landed in `database/sql` is shared across every driver. Pool exhaustion behaviour is identical for a MySQL workload and a PostgreSQL workload. Context cancellation propagation is identical. The retry-on-`ErrBadConn` policy is identical. Operators tuning a production database can read a single set of docs (`SetMaxOpenConns`, `SetConnMaxLifetime`, the `DBStats` fields) and the knowledge transfers across every database their applications talk to.

---

## 3. Stable user-facing types

The types below are the application-visible surface. Their method sets have been frozen since Go 1.0 except for `*Context` additions in Go 1.8.

| Type | Role |
|------|------|
| `*sql.DB` | Connection pool handle; safe for concurrent use; the long-lived object an application opens once and shares. Methods include `Query`, `QueryRow`, `Exec`, `Begin`, `Prepare`, `Ping`, `Close`, plus `*Context` siblings of each. |
| `*sql.Conn` (Go 1.9+) | Single connection drawn from the pool and held by the caller for a sequence of operations that must share session state (temp tables, `SET LOCAL`, advisory locks). Acquired by `DB.Conn(ctx)`; released by `Conn.Close()`. |
| `*sql.Tx` | An in-progress transaction; produced by `DB.Begin` or `DB.BeginTx`. Methods mirror `*sql.DB` (`Query`, `Exec`, `Prepare`, `Stmt`); terminated by `Commit` or `Rollback`. |
| `*sql.Stmt` | A prepared statement; produced by `DB.Prepare`, `Tx.Prepare`, or `Conn.PrepareContext`. Can be reused across calls; thread-safe when prepared on `*sql.DB`. |
| `*sql.Rows` | The streaming result of a multi-row query; iterated with `Next()`, decoded with `Scan(...)`, terminated with `Close`. Multi-result-set support via `NextResultSet`. |
| `*sql.Row` | Convenience wrapper around `Rows` for the single-row case; `Scan` returns `ErrNoRows` if the query produced zero rows. |
| `sql.Result` | Outcome of an `Exec`; exposes `LastInsertId() (int64, error)` and `RowsAffected() (int64, error)`. Driver may return errors from either if it does not support the operation. |
| `sql.NullString`, `sql.NullInt64`, `sql.NullInt32`, `sql.NullInt16`, `sql.NullByte`, `sql.NullFloat64`, `sql.NullBool`, `sql.NullTime` | Wrapper types that represent SQL NULLs alongside a typed value; each carries a `Valid bool` field. Used as `Scan` targets when the column is nullable. |
| `sql.RawBytes` | A `Scan` target that aliases the driver-owned byte buffer without copying; valid only until the next call to `Next`, `Scan`, or `Close`. Use sparingly. |
| `sql.NamedArg` (Go 1.8+) | A name-tagged argument value; produced by `sql.Named("name", value)` and passed to `Query`/`Exec` for drivers that support named parameters. |

The constructor for `NullTime` arrived in Go 1.13; the other `Null*` types have been present since Go 1.0 (`NullString`, `NullInt64`, `NullFloat64`, `NullBool`) or Go 1.10 (`NullInt32`, `NullInt16`, `NullByte`). Go 1.22 added the generic `sql.Null[T any]`, which subsumes all of them but does not retire the specific types — they remain to avoid breaking decades of code that names them directly.

Lifecycle considerations across these types:

| Type | Construction | Termination | Concurrency |
|------|--------------|-------------|-------------|
| `*sql.DB` | `Open(driverName, dsn)` or `OpenDB(connector)`; typically once per process per database. | `Close()` shuts down the pool and closes idle connections. Rare in long-lived servers; common in one-shot tools. | Safe for concurrent use; designed to be a long-lived shared handle. |
| `*sql.Conn` | `DB.Conn(ctx)`; held by one goroutine for a sequence of operations. | `Conn.Close()` returns the connection to the pool. After Close, every method returns `ErrConnDone`. | Not safe for concurrent use; one goroutine at a time. |
| `*sql.Tx` | `DB.BeginTx(ctx, opts)`. | `Commit()` or `Rollback()`; after termination, every method returns `ErrTxDone`. | Not safe for concurrent use; transactions are bound to one connection. |
| `*sql.Stmt` | `DB.PrepareContext` (poolwide) or `Tx.PrepareContext` (transaction-bound) or `Conn.PrepareContext` (connection-bound). | `Stmt.Close()` releases the underlying prepared statement on every cached connection. | Safe for concurrent use when prepared on `*sql.DB`; unsafe when prepared on `*sql.Conn` or `*sql.Tx`. |
| `*sql.Rows` | Returned by `QueryContext` or `Stmt.QueryContext`. | `Rows.Close()`; deferred immediately after the call is the canonical pattern. | Not safe for concurrent use; iterator semantics. |

The most common mistake in early Go code is treating `*sql.DB` as a single connection — calling `Close()` between requests, opening a new `DB` per HTTP handler — which defeats the pool. The shape is identical to `http.Client`: one long-lived handle shared across goroutines.

Pool-tuning knobs deserve enumeration because their interaction is non-obvious:

| Method | Default | Effect |
|--------|---------|--------|
| `SetMaxOpenConns(n)` | 0 (unlimited) | Hard cap on simultaneously open connections; reaching the cap blocks new requests until a connection is returned to the pool. The single most important production knob. |
| `SetMaxIdleConns(n)` | 2 | Maximum connections kept idle in the pool; excess are closed on return. Should be tuned together with `MaxOpenConns` — setting idle below open creates churn. |
| `SetConnMaxLifetime(d)` | 0 (unlimited) | Absolute age cap; older connections are closed on next return. Required for DNS-rotated database hosts and for load-balanced clusters. |
| `SetConnMaxIdleTime(d)` | 0 (unlimited; Go 1.15+) | Idle-time cap; connections idle longer than `d` are closed. Useful for reducing idle-connection pressure on the database. |
| `Stats()` | — | Returns `DBStats` with counters for open, in-use, idle, wait count, wait duration, max-idle-closed, max-lifetime-closed. The observability surface. |

---

## 4. `Scanner` and `driver.Valuer`

Custom type conversion is the bidirectional bridge between SQL column values and Go types. It is governed by two single-method interfaces.

```go
// in database/sql
type Scanner interface {
    Scan(src any) error
}

// in database/sql/driver
type Valuer interface {
    Value() (Value, error)
}
```

`Scan` is called by `Rows.Scan` when the destination is a `Scanner`; the driver delivers the column value as one of the documented `driver.Value` kinds (`int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, `nil`) and the type's `Scan` method narrows it to the Go-side representation. `Value` is called by the driver when an argument is passed to `Query`, `Exec`, or `Stmt.Exec`; the argument is converted to a `driver.Value` before crossing the driver boundary.

The pair allows user-defined types — a UUID type, a JSON-backed config struct, a money type with currency — to round-trip through SQL without per-call conversion code. Every `Null*` type in `database/sql` is itself a `Scanner` and `Valuer`; the same machinery powers third-party types like `pgtype.Numeric` and `uuid.UUID`.

The conversion contract has three levels of strictness:

| Level | Rule |
|-------|------|
| Driver-side | A driver may only return `driver.Value` kinds documented in the `Value` typedef: `int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, or `nil`. Returning anything else is a driver bug, even if the consumer happens to handle it. |
| Conversion-side | `convertAssign` in `convert.go` performs the documented assignments between `driver.Value` kinds and Go destination kinds: numeric widening, string-from-bytes, time-from-string parsing for RFC 3339 layouts, and so on. The function is the single source of truth for what `Scan` will accept. |
| User-side | A `Scanner` implementation receives the `driver.Value` raw and is responsible for any further conversion. The convention is to accept all reasonable source kinds and document the supported ones; rejecting an unsupported kind returns an error, not a panic. |

A common pitfall: a value-receiver `Scan` method (`func (u UUID) Scan(src any) error`) modifies a copy and silently loses the result. The correct shape is always a pointer receiver. The same trap exists for `Valuer`, though it bites less often because `Value` is read-only.

Documentation references:

- `database/sql.Scanner`: <https://pkg.go.dev/database/sql#Scanner>
- `database/sql/driver.Valuer`: <https://pkg.go.dev/database/sql/driver#Valuer>
- `driver.Value` kinds: <https://pkg.go.dev/database/sql/driver#Value>
- `convertAssign` implementation: <https://github.com/golang/go/blob/master/src/database/sql/convert.go>

---

## 5. Driver interfaces

The driver contract is layered. A minimum-viable driver implements `Driver` and `Conn` and `Stmt` and `Rows`; richer drivers add the optional context-aware and behaviour-extending interfaces below.

| Interface | Required? | Purpose |
|-----------|-----------|---------|
| `driver.Driver` | Required | Entry point; `Open(dsn string) (Conn, error)` creates a connection. Registered with `sql.Register(name, &MyDriver{})`. |
| `driver.DriverContext` (1.10+) | Optional | Replaces `Open` with `OpenConnector(dsn) (Connector, error)`; lets a driver parse the DSN once and reuse it. Pairs with `sql.OpenDB(connector)`. |
| `driver.Connector` (1.10+) | Required if `DriverContext` is implemented | `Connect(ctx) (Conn, error)` and `Driver() Driver`; the parsed-DSN object. |
| `driver.Conn` | Required | A single database connection; methods `Prepare(query) (Stmt, error)`, `Close() error`, `Begin() (Tx, error)`. |
| `driver.ConnPrepareContext` (1.8+) | Optional | `PrepareContext(ctx, query) (Stmt, error)`; lets the driver honour cancellation during prepare. |
| `driver.ConnBeginTx` (1.8+) | Optional | `BeginTx(ctx, opts) (Tx, error)`; transactions with isolation level and read-only hints. |
| `driver.ExecerContext` (1.8+) | Optional | `ExecContext(ctx, query, args) (Result, error)`; one-shot exec on a connection without explicit `Prepare`. |
| `driver.QueryerContext` (1.8+) | Optional | `QueryContext(ctx, query, args) (Rows, error)`; one-shot query without explicit `Prepare`. |
| `driver.Pinger` (1.8+) | Optional | `Ping(ctx) error`; driver-specific liveness check. Without it, `DB.Ping` falls back to opening a fresh connection. |
| `driver.Stmt` | Required | A prepared statement; methods `Close()`, `NumInput() int`, `Exec(args)`, `Query(args)`. |
| `driver.StmtExecContext` (1.8+) | Optional | `ExecContext(ctx, args) (Result, error)`. |
| `driver.StmtQueryContext` (1.8+) | Optional | `QueryContext(ctx, args) (Rows, error)`. |
| `driver.NamedValueChecker` (1.9+) | Optional | `CheckNamedValue(*NamedValue) error`; lets a driver accept driver-specific argument types (e.g. arrays, ranges, JSON values) without `database/sql` rejecting them as unsupported. |
| `driver.Rows` | Required | The result set; methods `Columns()`, `Close()`, `Next(dest []Value) error`. |
| `driver.RowsNextResultSet` (1.8+) | Optional | `HasNextResultSet() bool` and `NextResultSet() error`; multi-result-set support. |
| `driver.RowsColumnTypeScanType` (1.8+) | Optional | `ColumnTypeScanType(index) reflect.Type`; lets `Rows.ColumnTypes` report the natural Go type per column. |
| `driver.RowsColumnTypeDatabaseTypeName` (1.8+) | Optional | `ColumnTypeDatabaseTypeName(index) string`; SQL-side type name (`"VARCHAR"`, `"TIMESTAMP"`). |
| `driver.RowsColumnTypeLength` (1.8+) | Optional | `ColumnTypeLength(index) (int64, bool)`. |
| `driver.RowsColumnTypeNullable` (1.8+) | Optional | `ColumnTypeNullable(index) (bool, bool)`. |
| `driver.RowsColumnTypePrecisionScale` (1.8+) | Optional | `ColumnTypePrecisionScale(index) (int64, int64, bool)`. |
| `driver.Tx` | Required | `Commit() error`, `Rollback() error`. |
| `driver.Result` | Required | `LastInsertId() (int64, error)`, `RowsAffected() (int64, error)`. |
| `driver.SessionResetter` (1.10+) | Optional | `ResetSession(ctx) error`; called when a pooled connection is returned to the pool, letting the driver clear session-local state (`SET LOCAL`, temp tables). |
| `driver.Validator` (1.15+) | Optional | `IsValid() bool`; called by the pool before reusing a connection. Returning false discards the connection without an explicit error round trip. |

The contract scales by feature detection: `database/sql` checks at runtime whether a driver implements a given optional interface (`if _, ok := drv.(driver.QueryerContext); ok`) and falls back to the older primitives when the optional interface is absent. A driver written for Go 1.0 still works under Go 1.22; a driver that opts into `ConnBeginTx` gains isolation-level support without breaking older callers.

The feature-detection pattern is the package's central extension mechanism. New driver capability is added by:

1. Defining a new interface in `database/sql/driver` whose method signature carries the new capability.
2. Adding a runtime type-assertion in `database/sql` at the call site that uses the new method when available and falls back to the old path when not.
3. Documenting the interface as optional, with a paragraph in the package docs explaining the fallback.

Existing drivers continue to satisfy `driver.Driver` and the original required interfaces and need no modification. Drivers that want the new feature implement the new interface. This is the same pattern Go uses for `io.WriterTo`, `io.ReaderFrom`, and the `http.ResponseWriter` extension interfaces (`http.Flusher`, `http.Hijacker`); `database/sql` is the standard library's most aggressive user of it, with the highest count of optional interfaces in a single package.

Reference list of optional interfaces: <https://pkg.go.dev/database/sql/driver>.

How drivers in production layer the interfaces:

| Driver | Implements |
|--------|------------|
| `github.com/go-sql-driver/mysql` | `Driver`, `DriverContext`, `Connector`, `Conn`, `ConnBeginTx`, `ConnPrepareContext`, `ExecerContext`, `QueryerContext`, `Pinger`, `Stmt`, `StmtExecContext`, `StmtQueryContext`, `NamedValueChecker`, `Rows`, `RowsNextResultSet`, `RowsColumnTypeScanType`, `RowsColumnTypeDatabaseTypeName`, `RowsColumnTypeLength`, `RowsColumnTypeNullable`, `RowsColumnTypePrecisionScale`, `SessionResetter`. Full feature coverage. |
| `github.com/lib/pq` | `Driver`, `Conn`, `ConnBeginTx`, `ConnPrepareContext`, `ExecerContext`, `QueryerContext`, `Pinger`, `Stmt`, `StmtExecContext`, `StmtQueryContext`, `Rows`, `RowsColumnTypeScanType`, `RowsColumnTypeDatabaseTypeName`. Older but still widely used; missing `Validator`. |
| `github.com/jackc/pgx/v5/stdlib` | `Driver`, `DriverContext`, `Connector`, `Conn`, `ConnBeginTx`, `ConnPrepareContext`, `ExecerContext`, `QueryerContext`, `Pinger`, `Stmt`, `StmtExecContext`, `StmtQueryContext`, `NamedValueChecker`, `Rows`, all `RowsColumnType*`, `SessionResetter`, `Validator`. Modern driver; the reference example of maximally implementing the contract. |
| `github.com/mattn/go-sqlite3` | `Driver`, `DriverContext`, `Conn`, `ConnBeginTx`, `ConnPrepareContext`, `ExecerContext`, `QueryerContext`, `Pinger`, `Stmt`, `StmtExecContext`, `StmtQueryContext`, `NamedValueChecker`, `Rows`, `RowsColumnTypeScanType`, `RowsColumnTypeDatabaseTypeName`, `RowsColumnTypeLength`, `RowsColumnTypeNullable`. CGO-based; ubiquitous in tests. |
| `modernc.org/sqlite` | Same as `mattn/go-sqlite3`; pure Go, no CGO; identical contract coverage. |
| `github.com/microsoft/go-mssqldb` | Full coverage including `NamedValueChecker` for SQL Server's named parameter syntax and `SessionResetter` for `sp_reset_connection`. |

Reading any of these drivers is the practical complement to reading `database/sql` itself; the contract documentation alone does not convey how it is exercised in anger.

A worked example of how `database/sql` selects a code path at runtime, expressed in pseudocode:

```go
func (db *DB) QueryContext(ctx context.Context, query string, args ...any) (*Rows, error) {
    dc, err := db.conn(ctx, cachedOrNewConn)
    if err != nil { return nil, err }
    if qc, ok := dc.ci.(driver.QueryerContext); ok {
        return queryDC(ctx, dc, qc, releaseConn, query, args)
    }
    if q, ok := dc.ci.(driver.Queryer); ok {
        return queryLegacy(ctx, dc, q, releaseConn, query, args)
    }
    stmt, err := dc.prepareDC(ctx, query)
    if err != nil { return nil, err }
    return stmt.QueryContext(ctx, args...)
}
```

The dispatch sequence — context-aware, then legacy, then prepare-and-query — is the central pattern. Every entry point in `database/sql` follows it for the relevant pair of interfaces.

---

## 6. Sentinel errors

`database/sql` exposes a small set of named errors that callers compare against directly. These are stable values; new sentinels are added but existing ones are not renamed or repurposed.

| Sentinel | Meaning |
|----------|---------|
| `sql.ErrNoRows` | Returned by `Row.Scan` when the underlying query produced zero rows. The canonical way to distinguish "no match" from a real error in the single-row case. |
| `sql.ErrConnDone` | Returned by operations on a `*sql.Conn` after the connection has been returned to the pool (`Conn.Close` was called). Indicates a programming error: continued use of a released handle. |
| `sql.ErrTxDone` | Returned by `Tx.Commit`, `Tx.Rollback`, and other `Tx` methods when the transaction has already been committed or rolled back. |
| `driver.ErrBadConn` | Returned by a driver's `Conn` methods when the connection is no longer usable. `database/sql` interprets this as a signal to discard the connection and, for idempotent operations, retry on a fresh one. Drivers must not return `ErrBadConn` after they have started writing to the wire for a non-idempotent operation, because the retry would re-execute the statement. |
| `driver.ErrSkip` | Returned by a driver method to signal "I do not implement this; fall back to the generic path." Mostly historical; modern drivers prefer not implementing the optional interface in the first place. |
| `driver.ErrRemoveArgument` (1.9+) | Returned by `CheckNamedValue` to instruct `database/sql` to drop the argument entirely; used by drivers that consume out-of-band sentinel arguments. |

`ErrBadConn` deserves extra attention because it is the only sentinel that triggers an automatic retry. The retry policy is: on `ErrBadConn`, discard the connection, and if the operation is idempotent and has not yet written to the wire, request a new connection and retry once. The retry is bounded — at most one — and it is conditional on the operation not having committed any bytes yet. Drivers signal this by returning `ErrBadConn` only before the first wire byte; once a query packet is en route, `ErrBadConn` is a contract violation. The constant is exported but should be used by drivers, not application code; application code that sees an `ErrBadConn` bubbling up is observing a driver bug.

The interaction with `errors.Is` is straightforward for the package's own sentinels — `errors.Is(err, sql.ErrNoRows)` is the canonical check — but does not extend to driver-side errors. Database-specific errors (a PostgreSQL `pq.Error`, a MySQL `*mysql.MySQLError`) carry SQLSTATE codes and structured fields; portable application code that distinguishes "unique violation" from "deadlock" goes through driver-specific type assertions or through a portability layer like `jackc/pgx`'s `pgerrcode`. `database/sql` does not standardise SQLSTATE or any other error taxonomy; that is by design — different databases disagree, and forcing a unified taxonomy would be a leaky abstraction.

Documentation: <https://pkg.go.dev/database/sql#pkg-variables>, <https://pkg.go.dev/database/sql/driver#pkg-variables>.

---

## 7. Transaction isolation levels

Isolation level is set by `BeginTx` through `sql.TxOptions{Isolation: ...}`. The constants are declared in `database/sql` and forwarded to the driver via `driver.TxOptions`.

| Constant | SQL standard equivalent | Notes |
|----------|-------------------------|-------|
| `sql.LevelDefault` | — | Use whatever the driver or database default is; the safe choice when the application has no specific requirement. |
| `sql.LevelReadUncommitted` | READ UNCOMMITTED | Dirty reads permitted; rarely useful, supported by MySQL and SQL Server, not by PostgreSQL (silently upgraded to READ COMMITTED). |
| `sql.LevelReadCommitted` | READ COMMITTED | PostgreSQL default; each statement sees a snapshot taken at statement start. |
| `sql.LevelWriteCommitted` | — | Driver-specific extension; rarely used. |
| `sql.LevelRepeatableRead` | REPEATABLE READ | MySQL InnoDB default; same snapshot for the duration of the transaction; phantom reads excluded under InnoDB's gap-locking. |
| `sql.LevelSnapshot` | SNAPSHOT | SQL Server snapshot isolation; PostgreSQL approximates with REPEATABLE READ. |
| `sql.LevelSerializable` | SERIALIZABLE | Strictest level; serialisation failures must be handled by retry on PostgreSQL. |
| `sql.LevelLinearizable` | — | Driver-specific extension for systems with explicit linearisability (CockroachDB, Spanner). |

Whether a level is honoured is up to the driver and the database. Drivers that do not implement `ConnBeginTx` ignore the option entirely and return a transaction at the default level; `database/sql` does not enforce or translate the constants. The mapping from `sql.IsolationLevel` to SQL syntax is the driver's job.

`TxOptions` also carries `ReadOnly bool`, which drivers can map to the database's read-only mode (PostgreSQL `SET TRANSACTION READ ONLY`, MySQL `START TRANSACTION READ ONLY`). The hint is advisory; the driver is free to ignore it if the database does not support read-only transactions, and `database/sql` does not enforce that no writes occur. Use `ReadOnly: true` to enable database-side query plan optimisations and to let read-only replicas accept the transaction.

Practical mapping of the constants per database engine:

| Engine | Read uncommitted | Read committed | Repeatable read | Serializable |
|--------|------------------|----------------|------------------|---------------|
| PostgreSQL | Silently upgraded to Read committed | Default; per-statement snapshot | Transaction-long snapshot | True serialisation; retry on `40001` |
| MySQL (InnoDB) | Honoured | Honoured | Default; gap locks exclude phantoms | Honoured; row locks acquired aggressively |
| SQL Server | Honoured | Default | Honoured | Honoured |
| CockroachDB | Mapped to Serializable | Mapped to Serializable | Mapped to Serializable | Default and only meaningful level |
| SQLite | Single-writer model; isolation collapses to Serializable in practice | — | — | Default |

Application code that depends on a specific isolation level must verify it against the target engine's documentation, not against the `database/sql` constants alone. The constants are a portable request; the database's response is engine-specific.

Documentation: <https://pkg.go.dev/database/sql#IsolationLevel>, <https://pkg.go.dev/database/sql#TxOptions>.

---

## 8. Source file map

The standard-library tree is small enough to enumerate. Paths are relative to `src/database/sql/`.

| File | Role |
|------|------|
| `sql.go` | The user-facing API: `DB`, `Tx`, `Stmt`, `Rows`, `Row`, `Conn`, `Result`, `NullString` and friends, `Open`, `OpenDB`, `Register`, `Drivers`, the pool implementation, the prepared-statement cache, the context plumbing. The bulk of the package. |
| `convert.go` | Type-conversion helpers used by `Rows.Scan`, `convertAssign`, the bridging between `driver.Value` kinds and Go destination types, the `NullString`/`NullInt*`/`NullTime` `Scan` and `Value` implementations. |
| `ctxutil.go` | Context helpers used internally to translate `context.Context` cancellation into driver-level cancellation across the connection boundary. |
| `sql_test.go`, `convert_test.go`, `fakedb_test.go`, `benchmark_test.go` | Tests; `fakedb_test.go` is an in-process test driver used by the standard-library test suite and useful as a minimal reference driver. |

Under `src/database/sql/driver/`:

| File | Role |
|------|------|
| `driver.go` | The driver-side interfaces: `Driver`, `DriverContext`, `Connector`, `Conn`, `ConnBeginTx`, `ConnPrepareContext`, `ExecerContext`, `QueryerContext`, `Pinger`, `Stmt`, `StmtExecContext`, `StmtQueryContext`, `NamedValueChecker`, `Rows`, all the `RowsColumnType*` variants, `Tx`, `Result`, `SessionResetter`, `Validator`. |
| `types.go` | `Value`, `ValueConverter`, the built-in `Bool`, `Int32`, `String`, `Null`, `NotNull`, `DefaultParameterConverter` converters, the `Valuer` interface. |

Browsable source: <https://github.com/golang/go/tree/master/src/database/sql>.

The most rewarding reading order for a senior engineer working through the source for the first time:

1. `driver/types.go` and `driver/driver.go` — the contract, twelve hundred lines, defines everything else.
2. `sql.go` from the top: the global `drivers` map and `Register`, then `Open` and `OpenDB`, then `DB` and the pool implementation (`db.conn`, `db.putConn`, the `connRequest` channel-based wakeup mechanism).
3. The transaction code path: `DB.BeginTx`, `Tx.Commit`, `Tx.Rollback`, and the connection-bound lifecycle.
4. The query path: `DB.QueryContext`, `Stmt.QueryContext`, `Rows.Next`, `Rows.Scan`.
5. `convert.go` — `convertAssign` and the type-conversion matrix.
6. `ctxutil.go` — the small adapter layer that translates `context.Context` cancellation into `driver.ErrBadConn` or an explicit cancel call on `Conn.QueryContext`.

Approximately 5,000 lines of Go, well-commented, with the architecture mostly visible from the type declarations alone.

Key implementation details worth tracing while reading:

| Detail | Where to look |
|--------|--------------|
| Pool's connection-request queue | `sql.go`: `DB.connRequests map[uint64]chan connRequest`; goroutines block on a per-request channel and are woken when an idle connection becomes available. |
| Statement caching across pool connections | `sql.go`: `Stmt.css []connStmt`; a prepared statement on `*sql.DB` keeps a per-connection prepared handle and re-prepares on a fresh connection if its cached one is closed. |
| Context cancellation propagation | `sql.go` and `ctxutil.go`: each operation that takes a context spawns a watcher goroutine via `withLock` and `db.mu`; cancellation triggers `Conn.Close` (and consequently `ErrBadConn`) if the driver does not implement a context-aware variant. |
| `ErrBadConn` retry loop | `sql.go`: `DB.conn` and `DB.queryDC` retry once on `ErrBadConn` if the operation has not yet been attempted against a non-cached connection. |
| Connection age limit | `sql.go`: `connectionCleaner` goroutine that periodically scans `db.freeConn` for connections past `connMaxLifetime` and closes them. |
| `Tx`'s exclusive lock on a connection | `sql.go`: `Tx.dc *driverConn` plus the `db.numOpen` accounting; the transaction's connection is removed from the pool until commit or rollback. |
| `Rows.Scan` conversion entry point | `convert.go`: `convertAssign(dest, src)` with a large switch over destination kind; `convertAssignRows(dest, src, rows)` adds row-context for `RawBytes`. |

---

## 9. Notable additions across releases

The Go 1 compatibility promise governs how `database/sql` evolves: existing names and behaviours are preserved; new capability lands as new methods, new optional interfaces, or new exported types.

| Release | Addition |
|---------|----------|
| Go 1.0 (Mar 2012) | Initial package: `DB`, `Tx`, `Stmt`, `Rows`, `Row`, `Result`, `NullString`, `NullInt64`, `NullFloat64`, `NullBool`, `Scanner`, `driver.Driver`/`Conn`/`Stmt`/`Rows`/`Tx`/`Result`/`Valuer`. |
| Go 1.2 (Dec 2013) | `Rows.Columns` documented stably; `SetMaxOpenConns`, `SetMaxIdleConns` for pool sizing. |
| Go 1.3 (Jun 2014) | `Stmt.QueryRow` added; small adjustments to the pool's behaviour under contention. |
| Go 1.8 (Feb 2017) | Context support across the board: `QueryContext`, `ExecContext`, `BeginTx`, `PingContext`, `PrepareContext`, `StmtQueryContext`, `StmtExecContext`. `NamedArg` and `sql.Named` for named parameters. Multi-result-set support via `Rows.NextResultSet`. Column type metadata via `Rows.ColumnTypes` and the `RowsColumnType*` driver interfaces. Cancellation propagation through the driver. |
| Go 1.9 (Aug 2017) | `*sql.Conn` for held-connection workflows. `NamedValueChecker` for driver-defined argument types. `Rows.ColumnTypes` extended. |
| Go 1.10 (Feb 2018) | `DriverContext` and `Connector` for DSN-parse-once drivers. `SessionResetter` for pool-return cleanup. `OpenDB(connector)` as an alternative to `Open(name, dsn)`. `NullInt32`. |
| Go 1.13 (Sep 2019) | `NullTime`. `DB.SetConnMaxIdleTime`. |
| Go 1.15 (Aug 2020) | `driver.Validator` for cheap pre-checkout liveness validation. |
| Go 1.17 (Aug 2021) | `NullByte`, `NullInt16`. `Rows.Err` clarified to never return `io.EOF`. |
| Go 1.19 (Aug 2022) | `Null[T]` generic wrapper proposal landed in draft; promoted to `sql.Null[T]` in Go 1.22. |
| Go 1.22 (Feb 2024) | `sql.Null[T any]` generic nullable wrapper, replacing the need for a per-type `Null*` variant. |

Release notes index: <https://go.dev/doc/devel/release>. `database/sql` is mentioned by release in the "Minor changes to the library" sections of each release page.

Two themes recur across the additions:

- **Capability via optional interfaces, never via method-set growth on required interfaces.** Every new feature since Go 1.0 — context cancellation, named parameters, multi-result sets, column type metadata, session reset, validator, isolation level — lands as a new interface that drivers may or may not implement. Required interface method sets are frozen.
- **`*Context` siblings, never replacements.** The Go 1.8 context revision added `QueryContext`, `ExecContext`, `BeginTx`, `PingContext`, `PrepareContext`, `StmtQueryContext`, `StmtExecContext`. The original non-`Context` methods remained, with their bodies rewritten to delegate to the new methods with `context.Background()`. Application code that predates Go 1.8 still compiles unchanged.

These two themes are the source of the package's stability and the reason driver code from 2013 still runs in 2026.

---

## 10. Compatibility discipline

`database/sql` is one of the cleanest demonstrations of the Go 1 compatibility promise. Three rules govern its evolution:

1. **Original interfaces are frozen.** `driver.Driver`, `driver.Conn`, `driver.Stmt`, `driver.Rows`, `driver.Tx`, `driver.Result`, `driver.Valuer`, and `sql.Scanner` have the same method sets in Go 1.22 that they had in Go 1.0. A driver written against Go 1.0 still compiles and runs against the current standard library.
2. **New capability is added as new optional interfaces.** `ConnBeginTx`, `QueryerContext`, `ExecerContext`, `NamedValueChecker`, `SessionResetter`, and `Validator` are all opt-in. `database/sql` performs a type assertion at runtime; if the driver implements the new interface, the new code path is used; otherwise the old fallback is used.
3. **`*Context` methods are siblings, not replacements.** `Query` and `QueryContext` both exist; the older method internally calls the newer with `context.Background()`. Application code can adopt context support gradually without rewriting call sites.

The result is that decade-old driver code keeps working, application code written before Go 1.8 still compiles, and migration to context support is incremental rather than disruptive. The cost is interface proliferation: a feature-complete driver implements roughly twenty interfaces from `database/sql/driver`. That cost is paid by the driver author; the application sees only `*sql.DB`.

The compatibility discipline also constrains what `database/sql` can fix. Quirks in the original API — `Exec` returning a `Result` whose `LastInsertId` and `RowsAffected` may both error out, `Rows.Scan` requiring exact argument count, the lack of a typed bulk-insert API — cannot be addressed without breaking existing code. They survive as documented behaviour, worked around by drivers and helper libraries (`sqlx`, `sqlc`, `bun`, `ent`) rather than by the standard library itself.

---

## 11. Notable proposals

The package's evolution is documented in Go issue tracker proposals. The accepted and significant ones:

| Proposal | Issue | Outcome |
|----------|-------|---------|
| Context-aware `database/sql` | <https://golang.org/issue/13690> | Accepted and shipped in Go 1.8; introduced `QueryContext`, `ExecContext`, `BeginTx`, `PingContext`, `PrepareContext`, plus the corresponding driver interfaces. |
| `Conn.QueryRowContext` and held connections | <https://golang.org/issue/22697> | Accepted and shipped in Go 1.9; introduced `*sql.Conn` and the `DB.Conn(ctx)` accessor for session-bound operations. |
| Connector API for DSN-parse-once | <https://golang.org/issue/15388> | Accepted and shipped in Go 1.10; introduced `DriverContext`, `Connector`, and `sql.OpenDB`. |
| `SessionResetter` interface | <https://golang.org/issue/22049> | Accepted and shipped in Go 1.10; allows drivers to clear session-local state on pool return. |
| `NamedValueChecker` for driver-specific arg types | <https://golang.org/issue/22326> | Accepted and shipped in Go 1.9. |
| `Validator` interface for pre-checkout liveness | <https://golang.org/issue/23719> | Accepted and shipped in Go 1.15. |
| `NullTime` | <https://golang.org/issue/30305> | Accepted and shipped in Go 1.13. |
| Generic `Null[T]` | <https://golang.org/issue/60370> | Accepted and shipped in Go 1.22. |
| `Rows.Err` non-`io.EOF` clarification | <https://golang.org/issue/46556> | Behaviour change documented; landed in Go 1.17. |

The full proposal list for the package: <https://github.com/golang/go/issues?q=label%3Aproposal+database%2Fsql>.

A handful of proposals were deliberately rejected or remain open for instructive reasons:

| Proposal | Issue | Status / rationale |
|----------|-------|--------------------|
| Bulk insert API | <https://golang.org/issue/5171> | Open / declined in successive forms; the proposal would standardise a `DB.BulkInsert` or similar high-throughput entry point. Rejected because the per-database wire formats differ enough that no portable shape exists; left to drivers and helpers like `pgx.CopyFrom`. |
| Generic typed scan | <https://golang.org/issue/61637> | Open; proposes `func ScanOne[T any](rows *Rows) (T, error)` and a generic row mapper. Active discussion; current direction is to keep the standard library minimal and let helpers (`scany`, `sqlx`) cover the ergonomic surface. |
| Result-set iteration with closure | <https://golang.org/issue/53449> | Open; would add `Rows.Range(func(*Rows) bool)` analogous to `sync.Map.Range`. Aligned with the broader iterator landing in Go 1.23 and may be revisited under that lens. |
| Built-in connection pool metrics | <https://golang.org/issue/35408> | Implemented in Go 1.11 as `DB.Stats()` returning `DBStats`; subsequent proposals to extend the struct with more fields are still considered case by case. |

The pattern across rejections is the same: anything that requires the standard library to encode database-specific knowledge gets pushed out to drivers or helper libraries; the standard library stays minimal, portable, and stable.

---

## 12. Bug reporting

Bugs against `database/sql` and `database/sql/driver` are filed in the Go issue tracker at <https://github.com/golang/go/issues>. The convention is to prefix the issue title with `database/sql:` (or `database/sql/driver:`) so that the team's triage filters surface it correctly. Driver bugs (mis-behaviour of `lib/pq`, `go-sql-driver/mysql`, `pgx`) are filed against the driver's own repository, not against the standard library; the standard library tracker is for the contract, the pool, the conversion machinery, and the `*sql` types themselves.

Reproducible bug reports typically include:

- The Go version (`go version`) and the platform (`go env GOOS GOARCH`).
- The driver name and version (`go list -m`).
- A minimal program that reproduces the issue, ideally using the in-tree `fakedb_test.go` driver when the bug is in `database/sql` itself rather than a real driver.
- The expected and actual behaviour, citing the relevant section of <https://pkg.go.dev/database/sql>.

The maintainers for `database/sql` are listed in <https://go.googlesource.com/go/+/master/src/database/sql/> commit history; historically Brad Fitzpatrick, Daniel Theophanes, and Russ Cox have driven the package's evolution. Bug fixes that touch the driver contract require careful review because the optional-interface discipline must be preserved; new interfaces, not modified ones, are the only way capability is added.

For security-sensitive issues — driver-level SQL injection, connection-pool-induced data leaks across users, TLS misuse — the Go security team is reached via <security@golang.org>, not the public tracker. The standard process is described at <https://go.dev/security/policy>.

Three categories of issue are filed regularly enough to be worth distinguishing in advance:

| Category | Examples | Where to file |
|----------|----------|---------------|
| Standard-library bugs | Pool deadlocks under contention, `Rows.Close` not being called on cancellation, `Scan` mishandling a `driver.Value` kind, `Tx.Stmt` not rebinding correctly. | <https://github.com/golang/go/issues> with the `database/sql:` prefix. |
| Driver-specific bugs | Wire-protocol misbehaviour, DSN parser bugs, driver-side conversion errors, connection leaks specific to the driver's `Close` path. | The driver's own repository. The standard library cannot fix these. |
| Documentation gaps | An optional driver interface whose semantics are unclear, a `*Context` method whose cancellation contract is under-specified, a sentinel error that is returned in more cases than the docs say. | <https://github.com/golang/go/issues> with the `database/sql:` prefix and the `Documentation` label. |

The package's stability over thirteen years is a direct consequence of how seriously the maintainers take the Go 1 compatibility promise. The discipline — original interfaces frozen, new capability as optional interfaces, `*Context` siblings rather than replacements — is the model that the rest of the standard library aspires to and the most concrete answer in the Go ecosystem to the question "how does a foundational library evolve without breaking its users." `database/sql` is worth reading as much for that discipline as for what it does.

When opening a bug report, including the following decisively shortens triage:

| Item | Why it matters |
|------|----------------|
| Output of `go version` | Behaviour differs across releases; a bug in Go 1.18 may be fixed in Go 1.22. |
| Output of `go env GOOS GOARCH CGO_ENABLED` | Connection pooling and goroutine scheduling differ subtly on Windows and on `GOARCH=wasm`. |
| Driver name and version (`go list -m all | grep <driver>`) | Distinguishes a `database/sql` bug from a driver bug. |
| A minimal reproducer using `fakedb_test.go` if possible | Lets the maintainers run the test in CI without external infrastructure. |
| Citation of the relevant section of <https://pkg.go.dev/database/sql> | Anchors the discussion to the documented contract rather than to expected behaviour the reporter inferred. |
| Output under `GODEBUG=sqltracing=1` if the bug is in the pool or retry path | The package supports a small set of debug knobs via `GODEBUG`; trace output is invaluable for race-condition reports. |

Bug reports that include all six are usually triaged within a week; reports that include only the symptom often languish for months waiting for clarification.
