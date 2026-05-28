# database/sql Source — Middle

## 1. What `database/sql` actually is

`database/sql` is not a driver. It is a connection-pool + lifecycle manager built on top of the small `database/sql/driver` interface. The whole package is roughly:

| Layer | Responsibility |
|-------|----------------|
| `sql.DB` | Pool of `*driverConn`; opener goroutine; configuration |
| `sql.Conn` | Single pinned connection borrowed from the pool |
| `sql.Tx` | A `*driverConn` pinned for the duration of a transaction |
| `sql.Stmt` | A logical prepared statement; one `driver.Stmt` per backing conn |
| `sql.Rows` | A cursor over a result set; releases the conn on `Close` |
| `driver.*` | Tiny interfaces every concrete driver implements |

The middle-level skill is reading `sql.go` and recognizing that everything funnels through one method: `DB.conn(ctx, strategy)`.

---

## 2. The pool fields on `DB`

From `database/sql/sql.go`, the meaningful state on `DB`:

| Field | Purpose |
|-------|---------|
| `connector driver.Connector` | Factory that produces `driver.Conn` (since 1.10) |
| `freeConn []*driverConn` | LIFO slice of idle conns ready to be reused |
| `connRequests map[uint64]chan connRequest` | Waiters when pool is at `maxOpen` |
| `numOpen int` | Total conns currently open (in-use + idle) |
| `openerCh chan struct{}` | Signals the background opener goroutine |
| `maxIdleCount int` | Cap on `len(freeConn)` |
| `maxOpen int` | Cap on `numOpen` |
| `maxLifetime time.Duration` | Hard age cap |
| `maxIdleTime time.Duration` | Idle age cap |
| `cleanerCh chan struct{}` | Wakes the lifetime/idle reaper |
| `mu sync.Mutex` | Protects everything above |

There is no lock-free fast path. Every borrow takes `db.mu`. This is why high-throughput services live or die by `SetMaxOpenConns`.

---

## 3. `DB.conn(ctx, strategy)` — the one borrow path

Every `Query`, `Exec`, `Prepare`, `BeginTx`, and `Conn()` call ends up here. Simplified:

```go
func (db *DB) conn(ctx context.Context, strategy connReuseStrategy) (*driverConn, error) {
    db.mu.Lock()
    // 1. Fast path: pop a free conn (LIFO).
    if strategy == cachedOrNewConn && len(db.freeConn) > 0 {
        c := db.freeConn[len(db.freeConn)-1]
        db.freeConn = db.freeConn[:len(db.freeConn)-1]
        c.inUse = true
        if c.expired(lifetime) {
            db.mu.Unlock()
            c.Close()
            return nil, driver.ErrBadConn  // caller retries
        }
        db.mu.Unlock()
        return c, nil
    }

    // 2. Slow path: pool is full → enqueue waiter.
    if db.maxOpen > 0 && db.numOpen >= db.maxOpen {
        req := make(chan connRequest, 1)
        reqKey := db.nextRequestKeyLocked()
        db.connRequests[reqKey] = req
        db.mu.Unlock()
        select {
        case <-ctx.Done():
            // remove waiter, return ctx.Err()
        case ret := <-req:
            return ret.conn, ret.err
        }
    }

    // 3. Room available: open a new one synchronously.
    db.numOpen++          // optimistic; rolled back on error
    db.mu.Unlock()
    ci, err := db.connector.Connect(ctx)
    // wrap into *driverConn; on err: db.numOpen--
}
```

Two strategies exist: `cachedOrNewConn` and `alwaysNewConn`. The second is used internally to avoid reusing a conn that just returned `ErrBadConn`.

---

## 4. Returning a conn — `releaseConn` and `putConn`

When a `Rows`, `Tx`, or `Stmt` is done with a conn, it calls `dc.releaseConn(err)` which calls `db.putConn(dc, err, resetSession)`:

1. If `err == driver.ErrBadConn` → close the conn, `numOpen--`, do not return to pool.
2. Else if `len(connRequests) > 0` → hand the conn directly to the longest-waiting requester via its channel (no slice push).
3. Else if `len(freeConn) < maxIdleCount` and conn not expired → append to `freeConn`.
4. Else → close the conn.

Step 2 is why a heavily loaded pool stays warm: conns hop directly from finished caller to waiting caller without touching `freeConn`.

---

## 5. The four tuning knobs

| Setter | What it caps | Default |
|--------|--------------|---------|
| `SetMaxOpenConns(n)` | `numOpen`; `0` = unlimited | `0` |
| `SetMaxIdleConns(n)` | `len(freeConn)`; `0` = no idle conns kept | `2` |
| `SetConnMaxLifetime(d)` | Absolute age of a conn before reaping | `0` (none) |
| `SetConnMaxIdleTime(d)` | Time spent idle in `freeConn` before reaping | `0` (none) |

Effects:

- `MaxIdleConns > MaxOpenConns` → silently clamped to `MaxOpenConns`.
- `MaxIdleConns == 0` → every release closes the conn. Equivalent to "no pooling".
- `ConnMaxLifetime` is the only knob that handles **stale conns** (load balancer dropped them, DNS rotated, DB restarted). Setting it to a few minutes is almost always correct.
- `ConnMaxIdleTime` lets the pool shrink during quiet periods without losing the lifetime cap on hot conns.

The reaper goroutine (`connectionCleaner`) wakes every `min(lifetime, idleTime)/2` and walks `freeConn` closing expired entries.

---

## 6. Conn lifecycle

```
                        ┌────────────────┐
              Connect → │  in freeConn   │ ← putConn
                        └────────┬───────┘
                                 │  conn(ctx, strategy)
                                 ▼
                        ┌────────────────┐
                        │   in use       │
                        └────────┬───────┘
                                 │  releaseConn
                ┌────────────────┼────────────────┐
                │                │                │
            ErrBadConn      expired?         freeConn full?
                │                │                │
                └─── Close ──────┴────────────────┘
```

A `driverConn` carries `inUse`, `createdAt`, `returnedAt`, and a list of "finalClosers" (open `Rows` / `Stmt` references). It cannot actually close while a `Rows` is still draining — `Close` is deferred until the last finalCloser releases.

---

## 7. `Tx` source — one pinned conn

`BeginTx` takes a conn via `conn(ctx, cachedOrNewConn)` and stores it on the `Tx`:

```go
type Tx struct {
    db   *DB
    dc   *driverConn   // pinned
    txi  driver.Tx     // driver-side tx handle
    done int32         // 0 = active, 1 = committed/rolled back
    // ...
}
```

Every `tx.Query`, `tx.Exec`, `tx.Prepare` runs on `tx.dc`. `Commit` / `Rollback` calls `tx.txi.Commit()` then `tx.dc.releaseConn(nil)`, returning the conn to the pool. If the caller forgets, the conn is leaked until the `Tx` is GC'd — and even then it will sit in an unknown state. Always `defer tx.Rollback()`.

A `Tx` is **not safe for concurrent use**. The single underlying conn cannot multiplex requests.

---

## 8. `Stmt` source — per-conn driver.Stmt

`db.Prepare(query)` returns one `*sql.Stmt`, but a single logical Stmt may have **multiple** `driver.Stmt` underneath — one per conn it has ever been bound to:

```go
type Stmt struct {
    db    *DB
    query string
    css   []connStmt  // cached driver.Stmt per conn
    // ...
}
type connStmt struct {
    dc *driverConn
    ds *driverStmt
}
```

Flow on `stmt.Query(args)`:

1. `db.conn(ctx, cachedOrNewConn)` to acquire a conn.
2. Search `stmt.css` for a `connStmt` whose `dc` matches.
3. If found → reuse `driver.Stmt`.
4. If not → call `dc.prepare(ctx, query)` and append to `css`.

This is the source of the classic prepared-statement-leak: prepare a `*sql.Stmt`, never `Close()` it, and every conn it visits accumulates a `driver.Stmt`. The server-side prepared statement count grows until the DB chokes.

A `*sql.Stmt` **is** safe for concurrent use — it serializes the conn acquisition.

---

## 9. `Rows` source — cursor + finalCloser

`Rows` holds the conn until drained:

```go
type Rows struct {
    dc          *driverConn
    releaseConn func(error)
    rowsi       driver.Rows
    closemu     sync.RWMutex
    closed      bool
    lasterr     error
    // ...
}
```

The contract:

| Method | What it does |
|--------|--------------|
| `Next()` | `rowsi.Next(dest)`; on EOF or err, auto-closes |
| `Scan(dest...)` | Copies row buffer into caller's dest |
| `Close()` | `rowsi.Close()` and `releaseConn(nil)` |
| `Err()` | Last non-EOF error |

**Drainage rule:** until `Next()` returns false **or** `Close()` is called, the conn is pinned. A code path that does `rows.Next(); return` (only reads the first row) leaks a conn until GC runs the finalizer.

`Rows` is **not safe for concurrent use**. Sharing `*Rows` across goroutines corrupts the read buffer.

---

## 10. `Query` vs `QueryRow` vs `Exec`

| Method | Returns | Conn lifetime |
|--------|---------|---------------|
| `Query` | `*Rows` | Pinned until `Rows.Close()` |
| `QueryRow` | `*Row` | Released after the first `Scan` |
| `Exec` | `Result` | Released immediately |

`QueryRow` is the "one row, no cursor" optimization. Internally it still calls `db.Query` but wraps the `*Rows` in a `*Row` that calls `rows.Close()` inside `Scan`. The driver still streams a result set; `database/sql` just hides the cursor work.

`Exec` returns a `Result` (`LastInsertId`, `RowsAffected`) and never touches a cursor; the conn is back in the pool by the time `Exec` returns.

---

## 11. The `driver` interface boundary

`database/sql/driver` is intentionally tiny. The core interfaces (modern, context-aware names in parens):

| Interface | Method shape | Notes |
|-----------|--------------|-------|
| `driver.Connector` | `Connect(ctx) (Conn, error)` | Replaces `Open(dsn)`; lets `DB` pass context |
| `driver.Conn` | `Prepare`, `Close`, `Begin` | + optional `QueryerContext`, `ExecerContext`, `ConnBeginTx`, `SessionResetter`, `Pinger` |
| `driver.Stmt` | `Close`, `NumInput`, `Exec`, `Query` | + `StmtExecContext`, `StmtQueryContext` |
| `driver.Rows` | `Columns`, `Close`, `Next(dest []Value)` | + `RowsNextResultSet`, `RowsColumnTypeScanType`, … |
| `driver.Tx` | `Commit`, `Rollback` | |
| `driver.Result` | `LastInsertId`, `RowsAffected` | |
| `driver.Value` | `interface{}` (allowed types only) | int64, float64, bool, []byte, string, time.Time, nil |

The optional sub-interfaces are how `database/sql` feature-detects driver capabilities: it does `if c, ok := dc.ci.(driver.QueryerContext); ok` and falls back to the older API if not.

---

## 12. `NamedValue` and `NamedArg` (Go 1.8)

Pre-1.8 drivers received positional `[]driver.Value`. Since 1.8:

```go
type NamedValue struct {
    Name    string  // "" if positional
    Ordinal int     // 1-based
    Value   Value
}
```

Drivers implement `NamedValueChecker` to validate/convert. Callers use:

```go
sql.Named("user_id", 42)
db.Query(`SELECT * FROM u WHERE id = :user_id`, sql.Named("user_id", 42))
```

`database/sql` converts a mix of positional and named args into `[]driver.NamedValue` before handing to the driver.

---

## 13. `ErrBadConn` — the scrubbing signal

`driver.ErrBadConn` is the protocol between driver and pool: "this conn is unusable, don't put me back." Every wrapper method (`dc.Query`, `dc.Exec`, `dc.Prepare`, `dc.Begin`) checks for it:

```go
if err == driver.ErrBadConn {
    dc.Close()           // remove from pool
    return ErrBadConn    // caller retries on a fresh conn
}
```

The caller — typically `DB.query` / `DB.exec` — retries up to `maxBadConnRetries` (currently `2`) with `alwaysNewConn`. After that it gives up and returns `ErrBadConn` to user code. This is how `database/sql` survives load balancer resets, DB restarts, and TCP RSTs without the user noticing.

A driver **must not** return `ErrBadConn` once it has read any data from the wire — by then the user has observed state and a silent retry would re-execute a non-idempotent statement.

---

## 14. Context propagation (since 1.8)

`QueryContext`, `ExecContext`, `BeginTx`, `Conn().PingContext`, etc. wire the caller's `ctx` into the driver. The pool also watches it:

- While **waiting** on `connRequests`, `<-ctx.Done()` aborts the borrow.
- While the query is **in flight**, a separate goroutine watches `ctx.Done()` and calls `dc.cancel(ctx.Err())`, which dispatches to driver-side cancellation (e.g. `pgconn.CancelRequest`).
- A cancelled conn is **scrubbed**: the pool drops it because the protocol state is unknown.

This is why `*WithContext` methods cost a goroutine per call. For very short queries on hot paths some teams prefer the non-context variants.

---

## 15. Query flow end-to-end

```mermaid
sequenceDiagram
    participant U as User code
    participant DB as sql.DB
    participant P as pool (freeConn / connRequests)
    participant DC as *driverConn
    participant D as driver.Conn / Stmt / Rows
    U->>DB: db.QueryContext(ctx, q, args)
    DB->>P: conn(ctx, cachedOrNewConn)
    alt freeConn non-empty
        P-->>DB: pop *driverConn (LIFO)
    else under maxOpen
        DB->>D: connector.Connect(ctx)
        D-->>DB: driver.Conn
        DB->>P: numOpen++
    else at maxOpen
        DB->>P: enqueue connRequest
        P-->>DB: released conn (or ctx err)
    end
    DB->>DC: ctxDriverPrepare + StmtQueryContext
    DC->>D: driver.Stmt.QueryContext(ctx, args)
    D-->>DC: driver.Rows
    DC-->>DB: wrap as *sql.Rows
    DB-->>U: *sql.Rows (conn pinned)
    U->>DB: rows.Next(); rows.Scan(...)
    U->>DB: rows.Close()
    DB->>P: putConn(dc, err)
    alt waiters present
        P->>P: hand to longest waiter
    else freeConn under cap
        P->>P: append to freeConn
    else
        P->>D: Close
    end
```

---

## 16. Middle-level mistakes

- **Sharing `*Rows` across goroutines.** The internal buffer is single-reader. Race, panic, or silent corruption.
- **Forgetting `rows.Close()` on early return.** Conn pinned until the finalizer runs minutes later.
- **`*sql.Stmt` never `Close()`d.** Each new conn it touches gets a fresh `driver.Stmt`; server-side count grows forever.
- **`MaxIdleConns = 0` "to save memory."** Every release closes; `Connect` cost paid on every borrow.
- **`MaxLifetime = 0` behind a load balancer.** Long-lived conns get silently dropped by the LB; you discover this through random `connection reset` errors.
- **Holding a `Tx` open across a network call.** One pinned conn during an unrelated HTTP request; pool exhaustion follows.
- **Treating `ErrBadConn` as a real error.** It's a pool signal; `database/sql` already retries it. If you see it in user code, you exhausted retries — investigate the network, don't catch the error.
- **Calling `QueryRow` then ignoring `Scan` error.** No `Scan` = no `Close` = pinned conn.

---

## 17. Summary

Middle-level `database/sql` is one method (`conn`), one mutex (`db.mu`), and four knobs (`MaxOpen`, `MaxIdle`, `MaxLifetime`, `MaxIdleTime`). The rest of the package decorates that core: `Tx` pins a conn, `Stmt` caches a `driver.Stmt` per conn, `Rows` pins until drained. `ErrBadConn` is the scrubbing signal; context cancellation kills in-flight conns. Read `sql.go` once with this map in hand and the 4 KLOC file shrinks to a half-dozen ideas.

---

## Further reading
- `src/database/sql/sql.go` — `DB.conn`, `DB.putConn`, `connectionCleaner`
- `src/database/sql/convert.go` — `driver.Value` conversion rules
- `database/sql/driver` package docs — the interface contract
- `pgx` stdlib adapter — production-grade driver wired through `driver.Connector`
- `go-sql-driver/mysql` — reference implementation of the optional sub-interfaces
- Go 1.8 release notes — context + named args additions
