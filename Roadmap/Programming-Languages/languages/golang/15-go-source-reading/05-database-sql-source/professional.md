# `database/sql` — Professional (Source Walkthrough)

> Focus: read the actual Go 1.22+ source of `database/sql` and understand the pool, transaction, statement, rows, conversion, context-adapter, driver-interface, and reaper machinery as it is written. Excerpts are simplified — field order preserved, irrelevant branches elided, error paths trimmed. Every excerpt is annotated with the source file. Reading order at the end (§15).

---

## 1. `DB` struct layout — `sql.go`

The `DB` is the public handle. It owns a pool, an opener pump, a request queue, and a closing book-keeper. Everything else routes through this struct.

```go
// from database/sql/sql.go, simplified
type DB struct {
    waitDuration atomic.Int64 // cumulative wait time of conn requests (for DBStats)

    connector driver.Connector
    numClosed atomic.Uint64   // bumped on every closed conn (invalidates Stmt cache)

    mu           sync.Mutex   // protects everything below
    freeConn     []*driverConn
    connRequests map[uint64]chan connRequest
    nextRequest  uint64       // monotonic key for connRequests
    numOpen      int          // open + pending opens
    openerCh     chan struct{}
    closed       bool
    dep          map[finalCloser]depSet
    maxIdleCount int           // default 2
    maxOpen      int           // 0 = unlimited
    maxLifetime  time.Duration
    maxIdleTime  time.Duration
    cleanerCh    chan struct{} // reaper wakeup
    waitCount    int64
    maxIdleClosed     int64
    maxIdleTimeClosed int64
    maxLifetimeClosed int64

    stop func() // stops the connectionOpener goroutine
}
```

Three fields carry the design:

- **`freeConn []*driverConn`** — LIFO stack of idle conns. Push on `putConn`, pop on `conn`. LIFO keeps the most-recently-used conn hot in the driver's caches and lets old ones age out.
- **`connRequests map[uint64]chan connRequest`** — when no free conn is available and the pool is at `maxOpen`, callers register a one-shot channel here and wait. Monotonic keys let cancellation find and remove a specific waiter in O(1).
- **`openerCh chan struct{}`** — drained by a background `connectionOpener` goroutine. Each token tells the goroutine to open one new conn asynchronously, decoupling the caller's hot path from the driver's `Open`.

`numOpen` is *open + pending opens*. The pool counts a conn against `maxOpen` from the moment opening starts, not from the moment it finishes — preventing stampedes where 1 000 concurrent callers all observe "under the cap" and trigger 1 000 driver opens.

---

## 2. `DB.conn(ctx, strategy)` — the acquisition path

Every `db.Query`, `db.Exec`, `db.Begin` calls this. Three branches: free list, wait, open.

```go
// from database/sql/sql.go, simplified
func (db *DB) conn(ctx context.Context, strategy connReuseStrategy) (*driverConn, error) {
    db.mu.Lock()
    if db.closed { db.mu.Unlock(); return nil, errDBClosed }
    if err := ctx.Err(); err != nil { db.mu.Unlock(); return nil, err }
    lifetime := db.maxLifetime

    // (1) Free list: pop the most-recent idle conn.
    last := len(db.freeConn) - 1
    if strategy == cachedOrNewConn && last >= 0 {
        conn := db.freeConn[last]
        conn.inUse = true
        db.freeConn = db.freeConn[:last]
        db.mu.Unlock()
        if conn.expired(lifetime) { conn.Close(); return nil, driver.ErrBadConn }
        if err := conn.resetSession(ctx); errors.Is(err, driver.ErrBadConn) {
            conn.Close(); return nil, driver.ErrBadConn
        }
        return conn, nil
    }

    // (2) At cap → wait on a channel.
    if db.maxOpen > 0 && db.numOpen >= db.maxOpen {
        req := make(chan connRequest, 1)
        reqKey := db.nextRequestKeyLocked()
        db.connRequests[reqKey] = req
        db.waitCount++
        db.mu.Unlock()
        waitStart := nowFunc()
        select {
        case <-ctx.Done():
            db.mu.Lock(); delete(db.connRequests, reqKey); db.mu.Unlock()
            db.waitDuration.Add(int64(time.Since(waitStart)))
            // If a putConn raced our cancel, return that conn to the pool.
            select {
            case ret, ok := <-req:
                if ok && ret.conn != nil { db.putConn(ret.conn, ret.err, false) }
            default:
            }
            return nil, ctx.Err()
        case ret, ok := <-req:
            db.waitDuration.Add(int64(time.Since(waitStart)))
            if !ok { return nil, errDBClosed }
            if ret.err == nil && ret.conn.expired(lifetime) {
                ret.conn.Close(); return nil, driver.ErrBadConn
            }
            return ret.conn, ret.err
        }
    }

    // (3) Under cap → open synchronously.
    db.numOpen++ // counted before Open finishes
    db.mu.Unlock()
    ci, err := db.connector.Connect(ctx)
    if err != nil {
        db.mu.Lock(); db.numOpen--; db.maybeOpenNewConnections(); db.mu.Unlock()
        return nil, err
    }
    db.mu.Lock()
    dc := &driverConn{db: db, createdAt: nowFunc(), returnedAt: nowFunc(), ci: ci, inUse: true}
    db.addDepLocked(dc, dc)
    db.mu.Unlock()
    return dc, nil
}
```

What to notice:

1. **Strategy** — `cachedOrNewConn` lets the pool reuse; `alwaysNewConn` (used after `ErrBadConn` retry, §12) forces branch (3).
2. **Cancellation race** — branch (2) registers a key, unlocks, then `select`s on context vs. assignment. If the context fires *and* a `putConn` already delivered, the conn is returned to the pool, not leaked.
3. **Expiry is post-acquisition** — `conn.expired(lifetime)` runs after the conn leaves the free list. Expired conns surface as `driver.ErrBadConn`, triggering the 2-retry loop (§12).
4. **Session reset** — every reused conn is reset via the driver's `SessionResetter` hook (§11) before reaching the caller.

---

## 3. `DB.openNewConnection` — the async opener

Closing a conn or canceling a request can free a slot. Rather than have the caller block on `Open`, the pool sends a token to `openerCh` and lets a background goroutine handle it.

```go
// from database/sql/sql.go, simplified
func (db *DB) maybeOpenNewConnections() {
    numRequests := len(db.connRequests)
    if db.maxOpen > 0 {
        numCanOpen := db.maxOpen - db.numOpen
        if numRequests > numCanOpen { numRequests = numCanOpen }
    }
    for numRequests > 0 {
        db.numOpen++ // optimistically count
        numRequests--
        if db.closed { return }
        db.openerCh <- struct{}{}
    }
}

func (db *DB) connectionOpener(ctx context.Context) {
    for {
        select {
        case <-ctx.Done(): return
        case <-db.openerCh: db.openNewConnection(ctx)
        }
    }
}

func (db *DB) openNewConnection(ctx context.Context) {
    ci, err := db.connector.Connect(ctx)
    db.mu.Lock(); defer db.mu.Unlock()
    if db.closed {
        if err == nil { ci.Close() }
        db.numOpen--; return
    }
    if err != nil {
        db.numOpen--
        db.putConnDBLocked(nil, err) // deliver error to a waiter, if any
        db.maybeOpenNewConnections()
        return
    }
    dc := &driverConn{db: db, createdAt: nowFunc(), returnedAt: nowFunc(), ci: ci}
    if db.putConnDBLocked(dc, err) { db.addDepLocked(dc, dc) } else { db.numOpen--; ci.Close() }
}
```

`putConnDBLocked` is the *one* place a conn or error reaches a waiter. It hands the conn to the oldest `connRequests` entry; if none, it pushes to `freeConn`. Bounded by `maxIdleCount` — if the free list is full the conn is closed immediately.

---

## 4. `driverConn` — wrapping `driver.Conn`

The pool's internal handle on the driver's `Conn`. Carries lifecycle state plus a lock so the pool can manipulate the conn from the reaper while a query is in flight.

```go
// from database/sql/sql.go, simplified
type driverConn struct {
    db        *DB
    createdAt time.Time

    sync.Mutex           // guards following fields
    ci          driver.Conn
    needReset   bool     // hint to reset session next time
    closed      bool
    finalClosed bool     // ci.Close has been called
    openStmt    map[*driverStmt]bool

    // outside Mutex (atomic / db.mu):
    inUse      bool
    returnedAt time.Time
    onPut      []func()  // hooks fired on Put back to pool
    dbmuClosed bool      // marked closed under db.mu
}

func (dc *driverConn) expired(timeout time.Duration) bool {
    if timeout <= 0 { return false }
    return dc.createdAt.Add(timeout).Before(nowFunc())
}

func (dc *driverConn) finalClose() error {
    dc.Lock()
    for si := range dc.openStmt { si.Close() } // close all per-conn prepared stmts
    dc.openStmt = nil
    err := dc.ci.Close()
    dc.ci = nil
    dc.finalClosed = true
    dc.Unlock()
    dc.db.mu.Lock(); dc.db.numOpen--; dc.db.maybeOpenNewConnections(); dc.db.mu.Unlock()
    return err
}
```

`inUse` is the busy bit: `true` while a caller holds a `*Tx`, `*Stmt`, or `*Rows`. The reaper (§13) and `Close` consult it, never yanking an active conn.

`openStmt` is a per-conn cache of prepared statements bound to *this* conn. When the conn closes, its statements close too — a `Stmt` outliving its conn would surface to the driver as an invalid handle.

`closed` vs `finalClosed`: the pool calls `Close` once when the conn becomes unreachable; `finalClose` runs after the dependency graph (`dep`) confirms no `Tx`/`Stmt`/`Rows` still references it. Reference-counting in disguise.

---

## 5. `Tx.Commit` / `Tx.Rollback` — releasing the conn

A `Tx` pins one `*driverConn` for its lifetime. Commit/Rollback ends the pin.

```go
// from database/sql/sql.go, simplified
type Tx struct {
    db *DB
    dc *driverConn
    txi driver.Tx
    releaseConn func(error) // returns dc to pool, sets inUse=false
    done atomic.Bool
    keepConnOnRollback bool // post Go 1.15: rollback can keep dc if session is clean
    ctx context.Context
    cancel context.CancelFunc
}

func (tx *Tx) Commit() error {
    if !tx.done.CompareAndSwap(false, true) { return ErrTxDone }
    select { default: case <-tx.ctx.Done(): return tx.ctx.Err() }
    var err error
    withLock(tx.dc, func() { err = tx.txi.Commit() })
    if !errors.Is(err, driver.ErrBadConn) { tx.closePrepared() }
    tx.cancel()
    tx.releaseConn(err)
    return err
}

func (tx *Tx) rollback(discardConn bool) error {
    if !tx.done.CompareAndSwap(false, true) { return ErrTxDone }
    var err error
    withLock(tx.dc, func() { err = tx.txi.Rollback() })
    if !errors.Is(err, driver.ErrBadConn) { tx.closePrepared() }
    if discardConn { err = driver.ErrBadConn }
    tx.cancel()
    tx.releaseConn(err)
    return err
}
```

`tx.releaseConn` is a closure captured at `Tx` construction; its body is the `putConn` the pool uses everywhere — set `inUse=false`, push to `freeConn` or deliver to a waiter, otherwise close.

`done` is an `atomic.Bool` swap. The first of `Commit`, `Rollback`, or implicit cancel-on-context-done wins; later calls return `ErrTxDone`. `keepConnOnRollback` (Go 1.15+) flips a correctness/perf trade-off: by default rollback discards the conn (safe but expensive); drivers may opt in to keep it.

---

## 6. `Stmt.Query` / `Stmt.Exec` — per-conn prepared cache

`Stmt` is a façade. Behind it the package keeps a *per-conn* cache of prepared handles, lazily prepared the first time the statement is used on each conn.

```go
// from database/sql/sql.go, simplified
type Stmt struct {
    db *DB
    query string
    cg stmtConnGrabber  // non-nil only for Tx-bound stmts
    cgds *driverStmt
    mu sync.Mutex
    closed bool
    css []connStmt      // cache: (driverConn, driver.Stmt) pairs
    lastNumClosed uint64
}

type connStmt struct {
    dc *driverConn
    ds *driverStmt
}

func (s *Stmt) connStmt(ctx context.Context, strategy connReuseStrategy) (*driverConn, releaseConn, *driverStmt, error) {
    if s.cg != nil { /* Tx-bound: reuse the Tx's conn and cgds */ }

    // Discard cached css whose conn was closed since last call.
    s.mu.Lock()
    if s.lastNumClosed != s.db.numClosed.Load() {
        s.css = s.css[:0]
        s.lastNumClosed = s.db.numClosed.Load()
    }
    s.mu.Unlock()

    dc, err := s.db.conn(ctx, strategy)
    if err != nil { return nil, nil, nil, err }

    s.mu.Lock()
    for _, v := range s.css {
        if v.dc == dc { s.mu.Unlock(); return dc, dc.releaseConn, v.ds, nil }
    }
    s.mu.Unlock()

    ds, err := s.prepareOnConnLocked(ctx, dc) // cache miss → prepare on this conn
    if err != nil { dc.releaseConn(err); return nil, nil, nil, err }
    return dc, dc.releaseConn, ds, nil
}
```

The cache key is the `*driverConn` itself. A prepared statement is meaningful only on the connection that prepared it — putting that fact in the cache structure makes correctness fall out of the lookup.

The `lastNumClosed` trick is a coarse GC: rather than tracking every conn's lifecycle, the package increments `db.numClosed` on every close and compares. If the counter advanced, *some* conn was closed (possibly one we cached) and the whole `css` slice is swept. Cheap, correct, no per-conn callbacks.

`Stmt.Query`/`Exec` then call `dc.ci`'s `Exec`/`Query` (via the ctxutil adapters, §9) and wrap the resulting `driver.Rows`.

---

## 7. `Rows.Next` / `Scan` / `Close` — cursor management

`Rows` owns the conn (`releaseConn`), the `driver.Rows`, and a reused `lastcols` slice.

```go
// from database/sql/sql.go, simplified
type Rows struct {
    dc *driverConn
    releaseConn func(error)
    rowsi driver.Rows
    cancel func()
    closemu sync.RWMutex
    closed bool
    lasterr error
    lastcols []driver.Value // reused across Next() calls
}

func (rs *Rows) nextLocked() (doClose, ok bool) {
    if rs.closed { return false, false }
    if rs.lastcols == nil {
        rs.lastcols = make([]driver.Value, len(rs.rowsi.Columns()))
    }
    rs.lasterr = rs.rowsi.Next(rs.lastcols)
    if rs.lasterr != nil { return true, false } // io.EOF closes too
    return false, true
}

func (rs *Rows) Scan(dest ...any) error {
    rs.closemu.RLock(); defer rs.closemu.RUnlock()
    if rs.lasterr != nil && rs.lasterr != io.EOF { return rs.lasterr }
    if rs.closed { return errors.New("sql: Rows are closed") }
    if rs.lastcols == nil { return errors.New("sql: Scan called without calling Next") }
    if len(dest) != len(rs.lastcols) {
        return fmt.Errorf("sql: expected %d args, got %d", len(rs.lastcols), len(dest))
    }
    for i, sv := range rs.lastcols {
        if err := convertAssignRows(dest[i], sv, rs); err != nil {
            return fmt.Errorf("sql: Scan error on column index %d: %w", i, err)
        }
    }
    return nil
}

func (rs *Rows) close(err error) error {
    rs.closemu.Lock()
    if rs.closed { rs.closemu.Unlock(); return nil }
    rs.closed = true
    rs.closemu.Unlock()
    var rowsErr error
    withLock(rs.dc, func() { rowsErr = rs.rowsi.Close() })
    if rs.cancel != nil { rs.cancel() }
    rs.releaseConn(err) // <-- conn returns to pool here
    return rowsErr
}
```

Three things to lock in:

- **`lastcols` is allocated once and reused.** Every `Next` writes into the same `[]driver.Value`; `Scan` reads it the same iteration and copies out. This is why you cannot retain pointers into scanned values past the next `Next` for binary types — same backing slice.
- **`errClosed`** behavior: every public method short-circuits when `closed` is true. Contract: any error makes `Rows` unusable; `Close` is the only legal final call.
- **`releaseConn` in `close` is the conn's path back to the pool.** Forget to `Close` `*Rows` and the conn stays `inUse` forever — the canonical "exhausted pool, no error" bug.

---

## 8. `convertAssign` — type conversion (`convert.go`)

`Scan` ends in `convertAssignRows` which delegates to `convertAssign`. A ~250-line switch. Four representative cases.

### 8.1 Direct same-type assignment

```go
// from database/sql/convert.go, simplified
case string:
    switch d := dest.(type) {
    case *string:
        if d == nil { return errNilPtr }
        *d = s; return nil
    case *[]byte:
        if d == nil { return errNilPtr }
        *d = []byte(s); return nil
    }
```

Fast path: type-switched, allocation-light, single store for `*string ← string`.

### 8.2 Bytes ↔ string with copy semantics

```go
case []byte:
    switch d := dest.(type) {
    case *string:
        *d = string(s); return nil          // copy — string is immutable
    case *any:
        *d = bytes.Clone(s); return nil     // clone — caller may retain
    case *[]byte:
        *d = bytes.Clone(s); return nil     // clone — see §7
    }
```

`Clone` exists because `s` aliases the driver's `lastcols`. Without the clone the next `Next` would mutate the caller's `[]byte`.

### 8.3 Numeric strings

```go
case *int64:
    s := asString(src)
    i64, err := strconv.ParseInt(s, 10, 64)
    if err != nil { return strconvErr(err) }
    *d = i64; return nil
case *float64:
    s := asString(src)
    f64, err := strconv.ParseFloat(s, 64)
    if err != nil { return strconvErr(err) }
    *d = f64; return nil
```

Drivers commonly hand back textual numerics (Postgres `NUMERIC`); `Scan` parses on the consumer side. Costly per row at scale.

### 8.4 Reflection fallback

```go
dpv := reflect.ValueOf(dest)
if dpv.Kind() != reflect.Pointer { return errors.New("destination not a pointer") }
if dpv.IsNil() { return errNilPtr }
dv := reflect.Indirect(dpv)
sv := reflect.ValueOf(src)
if dv.Kind() == sv.Kind() && sv.Type().ConvertibleTo(dv.Type()) {
    dv.Set(sv.Convert(dv.Type())); return nil
}
// last resort: format src to string and parse via strconv into dv.Kind()
```

`sql.Scanner` is checked earlier and short-circuits this whole block — implementing it for custom types is the way to avoid reflection.

---

## 9. `ctxutil.go` — context adapters

Drivers that predate Go 1.8 implement `driver.Stmt.Exec`/`Query` without context. The package wraps them so cancellation still works.

```go
// from database/sql/ctxutil.go, simplified
func ctxDriverPrepare(ctx context.Context, ci driver.Conn, query string) (driver.Stmt, error) {
    if ciCtx, is := ci.(driver.ConnPrepareContext); is {
        return ciCtx.PrepareContext(ctx, query)
    }
    si, err := ci.Prepare(query)
    if err == nil {
        select {
        default:
        case <-ctx.Done():
            si.Close(); return nil, ctx.Err()
        }
    }
    return si, err
}

func ctxDriverExec(ctx context.Context, execerCtx driver.ExecerContext, execer driver.Execer,
                   query string, nvdargs []driver.NamedValue) (driver.Result, error) {
    if execerCtx != nil { return execerCtx.ExecContext(ctx, query, nvdargs) }
    dargs, err := namedValueToValue(nvdargs)
    if err != nil { return nil, err }
    select {
    default:
    case <-ctx.Done(): return nil, ctx.Err()
    }
    return execer.Exec(query, dargs)
}
```

Pattern: feature-detect the `*Context` variant via type assertion; if absent, downgrade `[]driver.NamedValue → []driver.Value` and check the context once before the call. Cancellation *during* a legacy driver's blocking `Exec` is unenforced — the call runs to completion. The adapter is a compatibility shim, not a cancellation guarantee.

---

## 10. `Driver` / `Conn` / `Stmt` interfaces — `driver/driver.go`

The driver contract is small. The whole package compiles down to these signatures.

```go
// from database/sql/driver/driver.go, signatures only
type Driver interface {
    Open(name string) (Conn, error)
}
type DriverContext interface {
    OpenConnector(name string) (Connector, error)
}
type Connector interface {
    Connect(context.Context) (Conn, error)
    Driver() Driver
}
type Conn interface {
    Prepare(query string) (Stmt, error)
    Close() error
    Begin() (Tx, error) // deprecated in favor of ConnBeginTx
}
type ConnBeginTx interface {
    BeginTx(ctx context.Context, opts TxOptions) (Tx, error)
}
type ConnPrepareContext interface {
    PrepareContext(ctx context.Context, query string) (Stmt, error)
}
type ExecerContext interface {
    ExecContext(ctx context.Context, query string, args []NamedValue) (Result, error)
}
type QueryerContext interface {
    QueryContext(ctx context.Context, query string, args []NamedValue) (Rows, error)
}
type Stmt interface {
    Close() error
    NumInput() int
    Exec(args []Value) (Result, error)  // deprecated
    Query(args []Value) (Rows, error)
}
type StmtExecContext interface {
    ExecContext(ctx context.Context, args []NamedValue) (Result, error)
}
type StmtQueryContext interface {
    QueryContext(ctx context.Context, args []NamedValue) (Rows, error)
}
type Rows interface {
    Columns() []string
    Close() error
    Next(dest []Value) error
}
type Tx interface {
    Commit() error
    Rollback() error
}
```

Every public method composes from these. The `*Context` interfaces are *optional* — feature-detected via `if x, ok := iface.(driver.ConnPrepareContext); ok`. Old drivers compile; new drivers opt in.

---

## 11. Optional driver interfaces — opt-in feature negotiation

Three optional interfaces let drivers control finer behavior:

```go
// from database/sql/driver/driver.go, simplified
type NamedValueChecker interface { CheckNamedValue(*NamedValue) error }
type SessionResetter   interface { ResetSession(ctx context.Context) error }
type Validator         interface { IsValid() bool }
```

- **`NamedValueChecker`** — the driver inspects/rewrites each `NamedValue` before bind. Postgres' `pq` uses this to map Go types onto PG types the default check rejects (`[]int64` → array, `time.Time` → `TIMESTAMPTZ`).
- **`SessionResetter`** — called on a conn checked out from the free list. Drivers reset session-scoped state (`SET LOCAL`, prepared cursors, temp tables) so the next caller sees a clean session. Without this, cross-request session bleed.
- **`Validator`** — called before reuse; a `false` return is treated like `ErrBadConn` and the conn is discarded.

The `resetSession` call site is in §2; `IsValid` is consulted in `driverConn.expired` and the reaper. None are required; defaults are "no rewrite, no reset, always valid."

---

## 12. `ErrBadConn` semantics — the 2-retry loop

A conn pulled from the pool may already be dead — peer closed, network blipped, server restarted. The package retries.

```go
// from database/sql/sql.go, simplified
const maxBadConnRetries = 2

func (db *DB) exec(ctx context.Context, query string, args []any, strategy connReuseStrategy) (Result, error) {
    var res Result
    var err error
    for i := 0; i < maxBadConnRetries; i++ {
        res, err = db.execDC(ctx, query, args, strategy)
        if !errors.Is(err, driver.ErrBadConn) { return res, err }
    }
    // Final attempt: force a brand-new conn.
    return db.execDC(ctx, query, args, alwaysNewConn)
}
```

Semantics: a driver that detects "this conn is unusable" returns `driver.ErrBadConn`. The pool retries up to twice with the original strategy, then forces `alwaysNewConn` once. Three attempts total. If all return `ErrBadConn`, the user sees it.

Critical contract: *drivers that have already executed work are forbidden from returning `ErrBadConn`*, because the retry would re-execute and break idempotency. From the driver's perspective:

> `ErrBadConn` means "the server has not seen this query yet; safe to retry on a different conn."

This contract is the entire reason `database/sql` transparently handles server restarts. Violate it and you double-execute writes.

---

## 13. Connection reaper — background expiry

A goroutine scans the free list and closes expired conns.

```go
// from database/sql/sql.go, simplified
func (db *DB) startCleanerLocked() {
    if (db.maxLifetime > 0 || db.maxIdleTime > 0) && db.numOpen > 0 && db.cleanerCh == nil {
        db.cleanerCh = make(chan struct{}, 1)
        go db.connectionCleaner(db.shortestIdleTimeLocked())
    }
}

func (db *DB) connectionCleaner(d time.Duration) {
    const minInterval = time.Second
    if d < minInterval { d = minInterval }
    t := time.NewTimer(d)
    for {
        select {
        case <-t.C:
        case <-db.cleanerCh: // wakeup on SetConnMaxLifetime / SetConnMaxIdleTime
        }
        db.mu.Lock()
        d = db.shortestIdleTimeLocked()
        if db.closed || db.numOpen == 0 || d <= 0 {
            db.cleanerCh = nil; db.mu.Unlock(); return
        }
        d, closing := db.connectionCleanerRunLocked(d)
        db.mu.Unlock()
        for _, c := range closing { c.Close() } // outside db.mu
        if d < minInterval { d = minInterval }
        if !t.Stop() { select { case <-t.C: default: } }
        t.Reset(d)
    }
}

func (db *DB) connectionCleanerRunLocked(d time.Duration) (time.Duration, []*driverConn) {
    var closing []*driverConn
    if db.maxIdleTime > 0 {
        for i := 0; i < len(db.freeConn); i++ {
            c := db.freeConn[i]
            if d2 := db.maxIdleTime - nowFunc().Sub(c.returnedAt); d2 <= 0 {
                closing = append(closing, c)
                last := len(db.freeConn) - 1
                db.freeConn[i] = db.freeConn[last]; db.freeConn[last] = nil
                db.freeConn = db.freeConn[:last]
                i--; db.maxIdleTimeClosed++
            } else if d2 < d { d = d2 }
        }
    }
    // maxLifetime: similar sweep against c.createdAt.
    return d, closing
}
```

Properties:

- **Single goroutine per `DB`.** Started lazily when `maxLifetime` or `maxIdleTime` is set and at least one conn is open. Exits when the pool is closed or empties.
- **Adaptive interval.** Sleeps until the *next* conn would expire. Wakes early when caps change (`db.cleanerCh <- struct{}{}`).
- **Closing happens outside `db.mu`.** `driver.Conn.Close` can take milliseconds and must not block the pool.
- **Only idle conns are reaped.** `inUse` conns are invisible to the cleaner; they're checked for expiry on the way *back* to the pool (`putConn` calls `expired`).

---

## 14. `DBStats` — accumulated metrics

```go
// from database/sql/sql.go, simplified
type DBStats struct {
    MaxOpenConnections int
    OpenConnections    int  // = numOpen
    InUse              int  // = numOpen - len(freeConn)
    Idle               int  // = len(freeConn)
    WaitCount          int64
    WaitDuration       time.Duration
    MaxIdleClosed      int64
    MaxIdleTimeClosed  int64
    MaxLifetimeClosed  int64
}

func (db *DB) Stats() DBStats {
    wait := db.waitDuration.Load()
    db.mu.Lock(); defer db.mu.Unlock()
    return DBStats{
        MaxOpenConnections: db.maxOpen,
        OpenConnections:    db.numOpen,
        InUse:              db.numOpen - len(db.freeConn),
        Idle:               len(db.freeConn),
        WaitCount:          db.waitCount,
        WaitDuration:       time.Duration(wait),
        MaxIdleClosed:      db.maxIdleClosed,
        MaxIdleTimeClosed:  db.maxIdleTimeClosed,
        MaxLifetimeClosed:  db.maxLifetimeClosed,
    }
}
```

Increment sites:

| Field | Where it bumps |
|---|---|
| `waitCount` | `DB.conn` branch (2), under `db.mu` |
| `waitDuration` | `DB.conn` branch (2), atomic add on success or context cancel |
| `maxIdleClosed` | `putConn` when free list is at `maxIdleCount` |
| `maxIdleTimeClosed` | `connectionCleanerRunLocked` idle-time sweep |
| `maxLifetimeClosed` | `connectionCleanerRunLocked` lifetime sweep |

`InUse` is derived, not stored. There is no per-call instrumentation cost; `Stats()` is the only reader and it pays the lock once.

---

## Pool state machine (ASCII)

```
                       +---------------+
            Open()     |               |    Close()
        +--------------|     CLOSED    |<-------------+
        |              |               |              |
        v              +---------------+              |
   +----+------+                                      |
   |   POOL    |  conn() branch (1)                   |
   |  (any     |  free list pop, LIFO                 |
   |  state)   |---->[ IDLE -> IN_USE ]               |
   |           |       caller holds dc                |
   |           |                                      |
   |           |  conn() branch (3): under maxOpen    |
   |           |  driver.Connect synchronous          |
   |           |---->[ OPENING -> IN_USE ]            |
   |           |       numOpen++ early                |
   |           |                                      |
   |           |  conn() branch (2): at cap           |
   |           |  +---------------+   putConn(dc)     |
   |           |->|   WAITING     |--+-------------+  |
   |           |  +---------------+  |             |  |
   |           |        | ctx done   |             |  |
   |           |        v            v             |  |
   |           |  +-----------+   rendezvous:      |  |
   |           |  | CANCELLED |   conn delivered   |  |
   |           |  +-----------+   via chan         |  |
   |           |                                   |  |
   |           |  putConn(dc) from Tx/Rows/Stmt   <+  |
   |           |  inUse=false; push to freeConn      |
   |           |  or hand to oldest connRequest      |
   |           |                                     |
   |           |  reaper sweep (maxLifetime/IdleTime)|
   |           |  connectionCleanerRunLocked         |
   |           |  Close() outside db.mu              |
   |           |                                     |
   |           |  ErrBadConn from any call           |
   |           |  retry loop, up to 2x, then         |
   |           |  alwaysNewConn for final attempt    |
   +-----------+                                     |
                                                     |
   openerCh consumer goroutine:                      |
   +-------------+   driver.Connect   +-----------+  |
   | token in    |------------------->| put to    |  |
   | openerCh    |                    | waiter or |  |
   +-------------+                    | freeConn  |  |
                                      +-----------+  |
                                                     |
   connectionCleaner goroutine:                      |
   +-------------+   timer wake       +-----------+  |
   | sleep until |------------------->| sweep,    |  |
   | next expiry |                    | Close     |--+
   +-------------+                    +-----------+
```

---

## 15. Reading order recommendation

1. **`driver/driver.go` — interface signatures end to end** (10 min). The whole contract drivers implement; deprecated `Begin`/`Exec`/`Query` next to the `*Context` variants tells the migration story.
2. **`sql.go` — `DB` struct definition** (5 min). Just lines ~400–500; internalise the layout in §1.
3. **`DB.Open` / `OpenDB`** (10 min). Trace how `Connector` is constructed (fallback `dsnConnector` wraps the driver's `Open`).
4. **`DB.conn`** (30 min). The hot path. Read it three times: ignoring branch (2), focusing on (2), then on the cancellation race.
5. **`DB.putConn` / `putConnDBLocked`** (15 min). The mirror of `conn`. Idle conn either reaches a waiter, the free list, or `Close`.
6. **`connectionOpener` / `openNewConnection`** (10 min). The async opener loop.
7. **`driverConn`** (15 min). The wrapper struct and its `Close`/`finalClose`/`expired` methods; the `db.dep` ref-counting layer.
8. **`Tx` lifecycle** (20 min). `DB.BeginTx`, `Tx.Commit`, `Tx.Rollback`, the `Tx.awaitDone` cancel goroutine.
9. **`Stmt` and `connStmt` caching** (25 min). The `numClosed` GC trick is subtle; sketch "Stmt created → conn reaped → next exec finds stale cache" on paper.
10. **`Rows` and the read loop** (15 min). Compare `Next`, `Scan`, `Close`. Trace `releaseConn` in `close` to confirm where the conn returns.
11. **`convert.go`** (20 min). Skim `convertAssign` to internalise the case dispatch — know the shape, find the case you need.
12. **`ctxutil.go`** (10 min). Short. Now you understand "context-aware driver" at the call boundary.
13. **`connectionCleaner` / `connectionCleanerRunLocked`** (15 min). The reaper. Read after `putConn` so "what gets reaped" is already answered.
14. **`ErrBadConn` retry sites** (10 min). Grep `maxBadConnRetries`; all sites follow the same pattern. Confirm idempotency contract by reading the driver-side comment.
15. **`DBStats` and instrumentation** (5 min). Sweep every `waitCount++`, `maxIdleClosed++` site to see the metric story.

Total: ~3.5 hours for a real read. A 45-minute skim leaves the `connRequests` cancellation race and the `Stmt` cache-invalidation as black boxes — exactly the parts that matter on a production on-call.
