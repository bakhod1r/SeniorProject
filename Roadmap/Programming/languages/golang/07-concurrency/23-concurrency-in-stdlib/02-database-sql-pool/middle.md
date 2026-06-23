---
layout: default
title: database/sql Connection Pool — Middle
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/middle/
---

# database/sql Connection Pool — Middle

[← Back](../)

The `database/sql` package is a thin orchestration layer. The drivers under
`database/sql/driver` do the actual wire protocol work. Everything that makes
`db.Query`, `db.Exec`, `db.BeginTx`, and `tx.Stmt` safe to call from many
goroutines lives in one file: `src/database/sql/sql.go`. If you have never
opened that file, this walkthrough will fix that. We are going to read it the
way you would read a non-trivial application: from the struct outward, then
follow the request through `conn`, `putConn`, the opener, the cleaner, and the
statement and transaction code paths.

The point is not to memorize line numbers. The point is to build a mental
model that survives the next time you stare at a `connection pool exhausted`
metric or a `sql: connection is already closed` error. Once you can name the
five fields involved in waiter signaling and recite what happens when
`ctx.Done` fires while `conn()` is blocked, the package stops being magic.

Line numbers in this document refer to the Go 1.22 source tree. They drift
slightly across releases, but the structures and names have been stable for
years. When in doubt, open `database/sql/sql.go` in your `$GOROOT` and search
for the identifier; you will find it within a handful of lines of the citation.

## The DB struct in full

The center of gravity is `type DB struct` at `database/sql/sql.go:438`. Read
it carefully. Every field there exists to solve a concrete concurrency
problem.

```go
// database/sql/sql.go:438
type DB struct {
    // Atomic access only. At top of struct to prevent mis-alignment
    // on 32-bit platforms. Of type time.Duration.
    waitDuration atomic.Int64 // Total time waited for new connections.

    connector driver.Connector
    // numClosed is an atomic counter which represents a total number of
    // closed connections. Stmt.openStmt checks it before cleaning closed
    // connections in Stmt.css.
    numClosed atomic.Uint64

    mu           sync.Mutex // protects following fields
    freeConn     []*driverConn
    connRequests map[uint64]chan connRequest
    nextRequest  uint64 // Next key to use in connRequests.
    numOpen      int    // number of opened and pending open connections
    // Used to signal the need for new connections
    // a goroutine running connectionOpener() reads on this chan and
    // maybeOpenNewConnections sends on the chan (one send per needed
    // connection). It is closed during db.Close(). The close tells the
    // connectionOpener goroutine to exit.
    openerCh          chan struct{}
    closed            bool
    dep               map[finalCloser]depSet
    lastPut           map[*driverConn]string // stacktrace of last conn's put; debug only
    maxIdleCount      int                    // zero means defaultMaxIdleConns; negative means 0
    maxOpen           int                    // <= 0 means unlimited
    maxLifetime       time.Duration          // maximum amount of time a connection may be reused
    maxIdleTime       time.Duration          // maximum amount of time a connection may be idle before being closed
    cleanerCh         chan struct{}
    waitCount         int64 // Total number of connections waited for.
    maxIdleClosed     int64 // Total number of connections closed due to idle count.
    maxIdleTimeClosed int64 // Total number of connections closed due to idle time.
    maxLifetimeClosed int64 // Total number of connections closed due to max connection lifetime limit.

    stop func() // stop cancels the connection opener.
}
```

Reading order, with the role each field plays:

- `waitDuration` sits at the top because the struct is accessed atomically
  on 32-bit platforms and Go requires 64-bit atomics to be 8-byte aligned.
  This is the same trick you see in `sync.WaitGroup` and `time.Timer`. It
  accumulates total wait time across the lifetime of the pool. `DBStats`
  exposes it as `WaitDuration`.
- `connector driver.Connector` is the factory. When the pool decides it
  needs another physical connection, it calls
  `connector.Connect(ctx)`. The connector is created either by `Open`
  (which looks up the driver by name and wraps it in `dsnConnector`) or by
  `OpenDB` (which receives the connector directly from the caller).
- `numClosed atomic.Uint64` is a generation counter. Prepared statements
  hold references to specific physical connections, and they need to know
  if the underlying connection was closed since they last looked. The
  counter is bumped on every `driverConn.finalClose`.
- `mu sync.Mutex` is the pool's single big lock. There is no per-connection
  lock at this level; every state change to `freeConn`, `connRequests`,
  `numOpen`, `closed`, `dep`, `lastPut`, or the limit fields takes `db.mu`.
  Per-connection state lives on the `driverConn` itself with its own
  mutex, which we will see below.
- `freeConn []*driverConn` is the idle list. New idle connections are
  appended to the end; idle connections are popped from the end. That
  makes the list LIFO, which preserves cache warmth and lets the cleaner
  evict cold connections from the head efficiently.
- `connRequests map[uint64]chan connRequest` is the waiter set. Every
  goroutine that calls `conn()` and finds no capacity allocates a fresh
  channel, registers it in this map under a unique key, releases the
  mutex, and blocks on the channel. When a connection becomes available,
  the returning code path looks at this map, picks an arbitrary entry,
  and hands the connection over via the channel.
- `nextRequest uint64` is just a monotonic counter used to mint keys for
  `connRequests`. The keys must be unique so that a waker can delete the
  entry it served without confusing other entries.
- `numOpen int` is the population of physical connections owned by the
  pool, including both idle and in-use. It is also bumped optimistically
  before calling `openNewConnection` so that two concurrent callers do
  not both decide they have capacity to open another connection.
- `openerCh chan struct{}` connects `maybeOpenNewConnections` to the
  `connectionOpener` goroutine. Each send means "open one more". The
  channel is buffered to `connectionRequestQueueSize` (1,000,000) so the
  send is effectively non-blocking under normal conditions.
- `closed bool` is set once by `Close`. After that, every operation that
  acquires `db.mu` checks the flag and refuses to add work.
- `dep map[finalCloser]depSet` tracks resource dependencies. A
  `driverConn` may be referenced by multiple prepared statements; a
  prepared statement (`Stmt`) is referenced by the `DB` and by every
  `Tx` that prepared a copy on it. When the last reference goes away,
  the resource's `finalClose` runs. This is the package's miniature
  reference-counting GC for things the language GC cannot see.
- `lastPut map[*driverConn]string` is only populated when the
  `debugGetPut` constant at the top of the file is set to `true`. It is
  a developer-only hook to catch double-puts.
- `maxIdleCount int`, `maxOpen int`, `maxLifetime time.Duration`,
  `maxIdleTime time.Duration` are the four tunables you set via the
  `SetMax*` and `SetConn*` methods. The fields are read under `db.mu`,
  so changes take effect on the next operation that acquires the lock.
- `cleanerCh chan struct{}` wakes the cleaner goroutine when limits
  change.
- `waitCount`, `maxIdleClosed`, `maxIdleTimeClosed`, `maxLifetimeClosed`
  are diagnostic counters surfaced through `DBStats`.
- `stop func()` is the cancel function for the context that
  `connectionOpener` runs on. Calling `Close` calls `stop` and the
  opener returns.

That is the whole struct. Sixteen fields, one mutex, three goroutines in
play (opener, cleaner, and the caller currently running). Every other type
in the file is a satellite of this struct.

## Helper types around the pool

Right above `DB`, the file declares a small zoo of helper types
(`database/sql/sql.go:380`–`437`):

```go
// database/sql/sql.go:380
type connRequest struct {
    conn *driverConn
    err  error
}

type connReuseStrategy uint8

const (
    alwaysNewConn   connReuseStrategy = iota // always open a new conn
    cachedOrNewConn                          // first try freeConn, then open new
)

// driverConn wraps a driver.Conn with a mutex, held during all calls.
type driverConn struct {
    db        *DB
    createdAt time.Time

    sync.Mutex  // guards following
    ci          driver.Conn
    needReset   bool // The connection session should be reset before use if true.
    closed      bool
    finalClosed bool // ci.Close has been called
    openStmt    map[*driverStmt]bool

    // guarded by db.mu
    inUse      bool
    returnedAt time.Time // Time the connection was created or returned.
    onPut      []func()  // code (with db.Mu held) run when conn is next returned
    dbmuClosed bool      // same as closed, but guarded by db.mu, for removeClosedStmtLocked
}
```

Two observations matter here.

First, `connRequest` is a struct with `conn` and `err`. The waiter channel
type is `chan connRequest`, not `chan *driverConn`. That is how the pool
delivers an error to a waiter when the dialer fails to produce a connection:
the opener sends a `connRequest{conn: nil, err: dialErr}` and the waiter
returns that error. We will see this in `openNewConnection` below.

Second, `driverConn` has two mutex-protected zones. Its embedded
`sync.Mutex` guards the driver-level state: which `driver.Conn` it wraps,
whether it has been closed, the set of open prepared statements. The fields
labeled `// guarded by db.mu` (`inUse`, `returnedAt`, `onPut`, `dbmuClosed`)
are pool-level state and are protected by the parent `DB`'s mutex. You will
see methods that take both locks in a specific order. The order is always
`db.mu` first, then `dc.Mutex`. Reversing that ordering would deadlock.

`createdAt` is set once at open time; it never changes. `returnedAt` is
updated under `db.mu` every time the connection re-enters the free list.
Together they feed `expired` below.

## Open vs OpenDB

`sql.Open` and `sql.OpenDB` both return a `*DB`. They differ in how they
arrive at a `driver.Connector`:

```go
// database/sql/sql.go:823
func Open(driverName, dataSourceName string) (*DB, error) {
    driversMu.RLock()
    driveri, ok := drivers[driverName]
    driversMu.RUnlock()
    if !ok {
        return nil, fmt.Errorf("sql: unknown driver %q (forgotten import?)", driverName)
    }

    if driverCtx, ok := driveri.(driver.DriverContext); ok {
        connector, err := driverCtx.OpenConnector(dataSourceName)
        if err != nil {
            return nil, err
        }
        return OpenDB(connector), nil
    }

    return OpenDB(dsnConnector{dsn: dataSourceName, driver: driveri}), nil
}

// database/sql/sql.go:846
func OpenDB(c driver.Connector) *DB {
    ctx, cancel := context.WithCancel(context.Background())
    db := &DB{
        connector:    c,
        openerCh:     make(chan struct{}, connectionRequestQueueSize),
        lastPut:      make(map[*driverConn]string),
        connRequests: make(map[uint64]chan connRequest),
        stop:         cancel,
    }

    go db.connectionOpener(ctx)

    return db
}
```

This is the moment to internalize the famous lazy-connect property:
`Open` does not dial. It looks up the driver, builds a connector, and hands
back a `*DB` whose `numOpen` is still zero. The first physical connection is
established when the first query (or `db.Ping`) calls `db.conn(ctx, ...)`.

`OpenDB` is the more general entry point that drivers expect modern callers
to use. It is also where the long-lived `connectionOpener` goroutine is
started. Note that `connectionOpener` is the only goroutine spawned by
`OpenDB`. The cleaner is started lazily when the first lifetime or idle-time
limit is set.

`connectionRequestQueueSize` is defined near the top of the file:

```go
// database/sql/sql.go:69
const connectionRequestQueueSize = 1000000
```

A million-slot buffered channel sounds extreme. It exists so that
`maybeOpenNewConnections` can send without ever blocking, which is critical
because the sender holds `db.mu`. If the buffer were small, you could end
up with a sender holding the mutex while the opener tries to acquire the
mutex inside `openNewConnection`. By sizing it absurdly large, the package
guarantees the send always succeeds immediately.

## The hot path: DB.conn

Every query path eventually calls `db.conn(ctx, strategy)`. This is the
single point where a goroutine acquires a physical connection. It lives
around `database/sql/sql.go:1300`:

```go
// database/sql/sql.go:1300
// conn returns a newly-opened or cached *driverConn.
func (db *DB) conn(ctx context.Context, strategy connReuseStrategy) (*driverConn, error) {
    db.mu.Lock()
    if db.closed {
        db.mu.Unlock()
        return nil, errDBClosed
    }
    // Check if the context is expired.
    select {
    default:
    case <-ctx.Done():
        db.mu.Unlock()
        return nil, ctx.Err()
    }
    lifetime := db.maxLifetime

    // Prefer a free connection, if possible.
    last := len(db.freeConn) - 1
    if strategy == cachedOrNewConn && last >= 0 {
        // Reuse the lowest idle time connection so we can close
        // connections which remain idle as soon as possible.
        conn := db.freeConn[last]
        db.freeConn = db.freeConn[:last]
        conn.inUse = true
        if conn.expired(lifetime) {
            db.maxLifetimeClosed++
            db.mu.Unlock()
            conn.Close()
            return nil, driver.ErrBadConn
        }
        db.mu.Unlock()

        // Reset the session if required.
        if err := conn.resetSession(ctx); errors.Is(err, driver.ErrBadConn) {
            conn.Close()
            return nil, err
        }

        return conn, nil
    }

    // Out of free connections or we were asked not to use one. If we're not
    // allowed to open any more connections, make a request and wait.
    if db.maxOpen > 0 && db.numOpen >= db.maxOpen {
        // Make the connRequest channel. It's buffered so that the
        // connectionOpener doesn't block while waiting for the req to be read.
        req := make(chan connRequest, 1)
        reqKey := db.nextRequestKeyLocked()
        db.connRequests[reqKey] = req
        db.waitCount++
        db.mu.Unlock()

        waitStart := nowFunc()

        // Timeout the connection request with the context.
        select {
        case <-ctx.Done():
            // Remove the connection request and ensure no value has been sent
            // on it after removing.
            db.mu.Lock()
            delete(db.connRequests, reqKey)
            db.mu.Unlock()

            db.waitDuration.Add(int64(time.Since(waitStart)))

            select {
            default:
            case ret, ok := <-req:
                if ok && ret.conn != nil {
                    db.putConn(ret.conn, ret.err, false)
                }
            }
            return nil, ctx.Err()
        case ret, ok := <-req:
            db.waitDuration.Add(int64(time.Since(waitStart)))

            if !ok {
                return nil, errDBClosed
            }
            // Only check if the connection is expired if the strategy is cachedOrNewConn.
            // If we require a new connection, just re-use the connection without looking
            // at the expiry time. If it is expired, it will be checked when it is placed
            // back into the connection pool.
            // This prioritizes giving a valid connection to a client over the exact connection
            // lifetime, which could expire exactly after this point anyway.
            if strategy == cachedOrNewConn && ret.err == nil && ret.conn.expired(lifetime) {
                db.mu.Lock()
                db.maxLifetimeClosed++
                db.mu.Unlock()
                ret.conn.Close()
                return nil, driver.ErrBadConn
            }
            if ret.conn == nil {
                return nil, ret.err
            }

            // Reset the session if required.
            if err := ret.conn.resetSession(ctx); errors.Is(err, driver.ErrBadConn) {
                ret.conn.Close()
                return nil, err
            }
            return ret.conn, ret.err
        }
    }

    db.numOpen++ // optimistically
    db.mu.Unlock()
    ci, err := db.connector.Connect(ctx)
    if err != nil {
        db.mu.Lock()
        db.numOpen-- // correct for earlier optimism
        db.maybeOpenNewConnections()
        db.mu.Unlock()
        return nil, err
    }
    db.mu.Lock()
    dc := &driverConn{
        db:         db,
        createdAt:  nowFunc(),
        returnedAt: nowFunc(),
        ci:         ci,
        inUse:      true,
    }
    db.addDepLocked(dc, dc)
    db.mu.Unlock()
    return dc, nil
}
```

Take this in stages.

The first action under the lock is the closed check. If `Close` has run, we
bail immediately. The second action is the context check: even before
consulting the pool, we honor an already-cancelled context. The reason is
that returning `ctx.Err()` here is cheaper than going through the wait path
and finding the same answer.

The free-list fast path is the LIFO pop you saw foreshadowed in the field
discussion. It uses `last := len(freeConn) - 1` and takes that connection.
Note the strategy guard: `alwaysNewConn` skips this branch entirely, which
is used by retry logic that just got `driver.ErrBadConn` and does not want
to risk grabbing another stale connection.

Once a free conn is selected, the code marks it `inUse = true` under
`db.mu`, then checks `conn.expired(lifetime)`. If it is expired, the counter
is bumped, the lock dropped, and the connection closed; the caller will see
`driver.ErrBadConn` and the retry logic upstairs will call `conn(ctx,
alwaysNewConn)` to try again on a fresh one.

If the free path fails and we are at `maxOpen`, the wait path runs. This
is the most important paragraph in the file:

```go
req := make(chan connRequest, 1)
reqKey := db.nextRequestKeyLocked()
db.connRequests[reqKey] = req
db.waitCount++
db.mu.Unlock()

select {
case <-ctx.Done():
    ...
case ret, ok := <-req:
    ...
}
```

The buffer size of 1 is deliberate. It means the sender (whoever returns a
connection or opens a new one) can always complete the send without
blocking, even if the receiver has already moved on because its context
fired. The `select` on `ctx.Done()` covers that case: if context fires first,
the goroutine deletes its key from `connRequests` and then performs a
non-blocking drain on `req` to catch the case where the connection arrived
between the moments where the waker checked the map and the moment we
deleted the entry. If we find a connection sitting in the channel, we hand
it back to the pool via `putConn`. That avoids leaking connections when
context cancellation races with delivery.

The optimistic increment of `numOpen` deserves a callout. Before unlocking
to call `connector.Connect`, the code does `db.numOpen++`. This holds the
"slot" against the `maxOpen` cap for the duration of the dial. If two
goroutines saw `numOpen < maxOpen` at the same time, only one of them would
get the slot; the other would be over-capacity and would wait. If the dial
fails, the goroutine takes the lock again, decrements `numOpen`, and calls
`maybeOpenNewConnections` to wake any waiters that might now be able to
proceed.

When the dial succeeds, the goroutine takes the lock again, allocates a
fresh `driverConn`, sets `createdAt` and `returnedAt` to now, marks it
`inUse`, registers it in the dep graph via `addDepLocked`, and returns it.
The dep graph entry will be released by `putConn`'s eventual
`removeDepLocked` calls.

## connRequest delivery and putConn

The other half of the rendezvous lives in `putConn` (around line 1408):

```go
// database/sql/sql.go:1408
// putConn adds a connection to the db's free pool.
// err is optionally the last error that occurred on this connection.
func (db *DB) putConn(dc *driverConn, err error, resetSession bool) {
    if !errors.Is(err, driver.ErrBadConn) {
        if !dc.validateConnection(resetSession) {
            err = driver.ErrBadConn
        }
    }
    db.mu.Lock()
    if !dc.inUse {
        db.mu.Unlock()
        if debugGetPut {
            fmt.Printf("putConn(%v) DUPLICATE was: %s\n\nPREVIOUS was: %s",
                dc, stack(), db.lastPut[dc])
        }
        panic("sql: connection returned that was never out")
    }

    if !errors.Is(err, driver.ErrBadConn) && dc.expired(db.maxLifetime) {
        db.maxLifetimeClosed++
        err = driver.ErrBadConn
    }
    if debugGetPut {
        db.lastPut[dc] = stack()
    }
    dc.inUse = false
    dc.returnedAt = nowFunc()

    for _, fn := range dc.onPut {
        fn()
    }
    dc.onPut = nil

    if errors.Is(err, driver.ErrBadConn) {
        // Don't reuse bad connections.
        // Since the conn is considered bad and is being discarded, treat it
        // as closed. Don't decrement the open count here, finalClose will
        // take care of that.
        db.maybeOpenNewConnections()
        db.mu.Unlock()
        dc.Close()
        return
    }
    added := db.putConnDBLocked(dc, nil)
    db.mu.Unlock()

    if !added {
        dc.Close()
        return
    }
}

// Satisfy a connRequest or put the driverConn in the idle pool and return true
// or return false.
// putConnDBLocked will satisfy a connRequest if there is one, or it will
// return the *driverConn to the freeConn list if err == nil and the idle
// connection limit will not be exceeded.
// If err != nil, the value of dc is ignored.
// If err == nil, then dc must not equal nil.
// If a connRequest was fulfilled or the *driverConn was placed in the
// freeConn list, then true is returned, otherwise false is returned.
func (db *DB) putConnDBLocked(dc *driverConn, err error) bool {
    if db.closed {
        return false
    }
    if db.maxOpen > 0 && db.numOpen > db.maxOpen {
        return false
    }
    if c := len(db.connRequests); c > 0 {
        var req chan connRequest
        var reqKey uint64
        for reqKey, req = range db.connRequests {
            break
        }
        delete(db.connRequests, reqKey) // Remove from pending requests.
        if err == nil {
            dc.inUse = true
        }
        req <- connRequest{
            conn: dc,
            err:  err,
        }
        return true
    } else if err == nil && !db.closed {
        if db.maxIdleConnsLocked() > len(db.freeConn) {
            db.freeConn = append(db.freeConn, dc)
            db.startCleanerLocked()
            return true
        }
        db.maxIdleClosed++
    }
    return false
}
```

The shape is: under `db.mu`, decide whether to hand the connection directly
to a waiter or push it onto `freeConn`. The map iteration `for reqKey, req
= range db.connRequests { break }` picks an arbitrary waiter. That is fine
because Go's map iteration is randomized and there is no fairness contract;
all waiters are treated as equivalent.

When a waiter is found, the connection is marked `inUse = true` under the
same lock that delivers it, then sent on `req`. The buffer-of-1 guarantees
that the send completes without releasing the lock. The waiter wakes up
and observes a connection that already has `inUse == true`. That is
important: no other goroutine can see this connection on `freeConn`
between the moment it is selected and the moment the waiter takes it.

When there are no waiters, the connection is appended to `freeConn` if the
idle count is below `maxIdleConnsLocked()`. If not, the connection is
abandoned (caller receives `added == false` and calls `Close`), and the
`maxIdleClosed` counter is bumped. That is how you observe an oversized
pool dropping connections to satisfy `SetMaxIdleConns`: the counter rises.

`startCleanerLocked` is called every time a connection is appended, which
seems wasteful but is cheap: the cleaner has its own gating logic. It only
starts the goroutine if the relevant lifetime/idle-time limits are set.

The error path is worth re-reading. If `err == driver.ErrBadConn`, the
function does not touch `freeConn`. It calls `maybeOpenNewConnections` to
let the opener spin up a replacement, drops the lock, and then closes the
bad connection. `numOpen` is decremented inside `finalClose`, not here,
because there is a small dance between the dep graph and the close
sequence that we will look at later.

## The opener goroutine

`connectionOpener` is one of the two background goroutines the pool runs.
It is spawned once by `OpenDB` and lives for the lifetime of the pool.

```go
// database/sql/sql.go:1264
// Open one new connection
func (db *DB) openNewConnection(ctx context.Context) {
    // maybeOpenNewConnections has already executed db.numOpen++ before it sent
    // on db.openerCh. This function must execute db.numOpen-- if the
    // connection fails or is closed before returning.
    ci, err := db.connector.Connect(ctx)
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.closed {
        if err == nil {
            ci.Close()
        }
        db.numOpen--
        return
    }
    if err != nil {
        db.numOpen--
        db.putConnDBLocked(nil, err)
        db.maybeOpenNewConnections()
        return
    }
    dc := &driverConn{
        db:         db,
        createdAt:  nowFunc(),
        returnedAt: nowFunc(),
        ci:         ci,
    }
    if db.putConnDBLocked(dc, err) {
        db.addDepLocked(dc, dc)
    } else {
        db.numOpen--
        ci.Close()
    }
}

// database/sql/sql.go:1232
// Assumes db.mu is locked.
// If there are connRequests and the connection limit hasn't been reached,
// then tell the connectionOpener to open new connections.
func (db *DB) maybeOpenNewConnections() {
    numRequests := len(db.connRequests)
    if db.maxOpen > 0 {
        numCanOpen := db.maxOpen - db.numOpen
        if numRequests > numCanOpen {
            numRequests = numCanOpen
        }
    }
    for numRequests > 0 {
        db.numOpen++ // optimistically
        numRequests--
        if db.closed {
            return
        }
        db.openerCh <- struct{}{}
    }
}

// database/sql/sql.go:1255
// Runs in a separate goroutine, opens new connections when requested.
func (db *DB) connectionOpener(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-db.openerCh:
            db.openNewConnection(ctx)
        }
    }
}
```

The roles are now clean. `maybeOpenNewConnections` runs synchronously under
`db.mu` and decides how many new connections are needed. For each one, it
bumps `numOpen` optimistically and sends one struct on `openerCh`. The
opener goroutine pops those signals one by one and dials. Each dial that
succeeds turns into a `putConnDBLocked` that either satisfies a waiter or
goes to the free list.

The flow when a waiter shows up looks like this:

```
caller goroutine             pool                              opener goroutine

conn(ctx, cachedOrNewConn)
  lock db.mu
  freeConn empty?
  numOpen == maxOpen?
  insert connRequest, unlock
  block on req
                              putConn dc (error path)
                                lock db.mu
                                maybeOpenNewConnections
                                  numOpen++, send openerCh
                                unlock, close dc
                                                                wake on openerCh
                                                                connector.Connect(ctx)
                                                                  lock db.mu
                                                                  putConnDBLocked(dc, nil)
                                                                    pick a waiter
                                                                    delete reqKey
                                                                    dc.inUse = true
                                                                    req <- {dc, nil}
                                                                  addDepLocked
                                                                  unlock
wake on req
  return dc
```

Two corner cases. First, if `db.closed` is set between the moment
`maybeOpenNewConnections` sent on `openerCh` and the moment the opener
actually starts dialing, the opener notices and closes the dialed
connection without ever exposing it. Second, if the dial fails, the
opener calls `putConnDBLocked(nil, err)`, which goes down a branch that
sends `connRequest{conn: nil, err: err}` to whichever waiter it picks.
That is how the caller learns the dial failed even though it never invoked
`connector.Connect` itself.

## The cleaner goroutine

The cleaner is started lazily by `startCleanerLocked`:

```go
// database/sql/sql.go:1077
// startCleanerLocked starts connectionCleaner if needed.
func (db *DB) startCleanerLocked() {
    if (db.maxLifetime > 0 || db.maxIdleTime > 0) && db.numOpen > 0 && db.cleanerCh == nil {
        db.cleanerCh = make(chan struct{}, 1)
        go db.connectionCleaner(db.shortestIdleTimeLocked())
    }
}

// database/sql/sql.go:1086
func (db *DB) connectionCleaner(d time.Duration) {
    const minInterval = time.Second
    if d < minInterval {
        d = minInterval
    }
    t := time.NewTimer(d)

    for {
        select {
        case <-t.C:
        case <-db.cleanerCh: // maxLifetime was changed or db was closed.
        }

        db.mu.Lock()

        d = db.shortestIdleTimeLocked()
        if db.closed || db.numOpen == 0 || d <= 0 {
            db.cleanerCh = nil
            db.mu.Unlock()
            return
        }

        d, closing := db.connectionCleanerRunLocked(d)
        db.mu.Unlock()
        for _, c := range closing {
            c.Close()
        }

        if d < minInterval {
            d = minInterval
        }
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(d)
    }
}
```

Two wakeups: the timer and `cleanerCh`. The timer fires on a duration
computed from `shortestIdleTimeLocked`, which is the smaller of
`maxLifetime` and `maxIdleTime` (whichever is set). The other wakeup is a
single-slot channel that `SetConnMaxLifetime`, `SetConnMaxIdleTime`, and
`Close` write into to ask the cleaner to recompute.

The actual work happens in `connectionCleanerRunLocked`:

```go
// database/sql/sql.go:1128
func (db *DB) connectionCleanerRunLocked(d time.Duration) (time.Duration, []*driverConn) {
    var idleClosing int64
    var closing []*driverConn
    if db.maxIdleTime > 0 {
        // As freeConn is ordered by returnedAt process
        // in reverse order to minimise the work needed.
        idleSince := nowFunc().Add(-db.maxIdleTime)
        last := len(db.freeConn) - 1
        for i := last; i >= 0; i-- {
            c := db.freeConn[i]
            if c.returnedAt.Before(idleSince) {
                i++
                closing = db.freeConn[:i:i]
                db.freeConn = db.freeConn[i:]
                idleClosing = int64(len(closing))
                db.maxIdleTimeClosed += idleClosing
                break
            }
        }
        if len(db.freeConn) > 0 {
            c := db.freeConn[0]
            if d2 := c.returnedAt.Sub(idleSince); d2 < d {
                // Ensure idle connections are cleaned up as soon as
                // possible.
                d = d2
            }
        }
    }

    if db.maxLifetime > 0 {
        expiredSince := nowFunc().Add(-db.maxLifetime)
        for i := 0; i < len(db.freeConn); i++ {
            c := db.freeConn[i]
            if c.createdAt.Before(expiredSince) {
                closing = append(closing, c)

                last := len(db.freeConn) - 1
                // Use slow delete as order is required to ensure
                // connections are reused least idle time first.
                copy(db.freeConn[i:], db.freeConn[i+1:])
                db.freeConn[last] = nil
                db.freeConn = db.freeConn[:last]
                i--
            } else if c.createdAt.After(expiredSince) {
                // Find the first connection created after expiredSince.
                if d2 := c.createdAt.Sub(expiredSince); d2 < d {
                    d = d2
                }
            }
        }
        db.maxLifetimeClosed += int64(len(closing)) - idleClosing
    }

    return d, closing
}
```

The idle-time pass exploits the FIFO ordering of `freeConn` by
`returnedAt`. Connections at the head of the slice are the oldest by
returned time, so the function walks from the end (newest) backward,
finds the index past which all entries are expired, slices that prefix
off, and returns it to be closed. The slice trick `db.freeConn[:i:i]`
gives the closing prefix its own capacity so subsequent appends to the
mutated `freeConn` do not stomp it.

The lifetime pass cannot use the prefix shortcut because `freeConn` is
ordered by `returnedAt`, not by `createdAt`. The function walks the slice
and deletes expired entries individually. It also computes the time
until the next-to-expire connection so the timer reset is precise.

When the pool is fully idle and the cleaner runs out of work, it sets
`db.cleanerCh = nil` and exits. `startCleanerLocked` will spawn a new one
the next time a connection is added.

## driverConn lifecycle

We have seen `driverConn` used in two contexts: the free list and the
in-use phase. Let us close the loop on its lifecycle. The full type is at
`database/sql/sql.go:537` and the close machinery is just below.

```go
// database/sql/sql.go:537 (continued from earlier)

// expired reports whether the driverConn has been used past the given timeout.
// The timeout argument may be the maximum lifetime, or it may be zero (no expiry).
func (dc *driverConn) expired(timeout time.Duration) bool {
    if timeout <= 0 {
        return false
    }
    return dc.createdAt.Add(timeout).Before(nowFunc())
}

// resetSession checks if the driver connection needs the session to be reset
// and if required, resets it.
func (dc *driverConn) resetSession(ctx context.Context) error {
    dc.Lock()
    defer dc.Unlock()

    if !dc.needReset {
        return nil
    }
    if cr, ok := dc.ci.(driver.SessionResetter); ok {
        return cr.ResetSession(ctx)
    }
    return nil
}

// validateConnection checks if the connection is valid and can
// still be used. It also marks the session for reset if required.
func (dc *driverConn) validateConnection(needsReset bool) bool {
    dc.Lock()
    defer dc.Unlock()

    if needsReset {
        dc.needReset = true
    }
    if cv, ok := dc.ci.(driver.Validator); ok {
        return cv.IsValid()
    }
    return true
}
```

`expired` is the single source of truth for whether a connection is
beyond its `maxLifetime`. It is called by `conn` on the free path, by
`putConn` on the return path, and by the cleaner on the idle path.
Whenever you see a "connection is too old, close it" decision in this
package, it comes from one of those three sites.

`resetSession` is invoked by `conn` right after picking a free
connection, but outside `db.mu`. The reason it is outside the mutex is
that `ResetSession` is a driver call that can take real time (it
might write to the network), and you do not want the whole pool to
freeze on it. The driver hook is optional; if the `driver.Conn`
implements `driver.SessionResetter`, it is called. The
`needsReset` flag is set when something happened during the previous
operation that might have left server-side state (transaction
abandonment, table locks, etc.).

`validateConnection` is the counterpart called by `putConn` before
deciding whether to put a connection back in the pool. If the driver
implements `driver.Validator`, that hook gets to veto reuse.

Now the close machinery:

```go
// database/sql/sql.go:603
// the dc.db's Mutex is held.
func (dc *driverConn) closeDBLocked() func() error {
    dc.Lock()
    defer dc.Unlock()
    if dc.closed {
        return func() error { return errors.New("sql: duplicate driverConn close") }
    }
    dc.closed = true
    return dc.db.removeDepLocked(dc, dc)
}

func (dc *driverConn) Close() error {
    dc.Lock()
    if dc.closed {
        dc.Unlock()
        return errors.New("sql: duplicate driverConn close")
    }
    dc.closed = true
    dc.Unlock() // not defer; removeDep finalClose calls may need to lock

    // And now updates that require holding dc.mu.Lock.
    dc.db.mu.Lock()
    dc.dbmuClosed = true
    fn := dc.db.removeDepLocked(dc, dc)
    dc.db.mu.Unlock()
    return fn()
}

func (dc *driverConn) finalClose() error {
    var err error

    // Each *driverStmt has a lock to the dc. Copy the list out of the dc
    // before calling close on each stmt.
    var openStmt []*driverStmt
    withLock(dc, func() {
        openStmt = make([]*driverStmt, 0, len(dc.openStmt))
        for ds := range dc.openStmt {
            openStmt = append(openStmt, ds)
        }
        dc.openStmt = nil
    })
    for _, ds := range openStmt {
        ds.Close()
    }
    withLock(dc, func() {
        dc.finalClosed = true
        err = dc.ci.Close()
        dc.ci = nil
    })

    dc.db.mu.Lock()
    dc.db.numOpen--
    dc.db.maybeOpenNewConnections()
    dc.db.mu.Unlock()

    dc.db.numClosed.Add(1)
    return err
}
```

Three functions, three roles. `closeDBLocked` is called when the pool
already holds `db.mu` (for example in `removeConn` when the cleaner
hands back a list of doomed connections). It marks the `driverConn`
closed and returns the actual cleanup function so the caller can
invoke it after releasing the mutex. `Close` is the public-facing
method that grabs both locks in the right order and then runs the
cleanup function. `finalClose` is where the dependency graph
eventually lands: when the last reference to the connection is gone,
finalClose actually closes the underlying `driver.Conn`, decrements
`numOpen`, calls `maybeOpenNewConnections` to keep the pool warm, and
bumps `numClosed`.

The dep graph deserves a paragraph. Each `driverConn` has zero or more
`driverStmt` values bound to it (cached prepared statements). The
`Stmt` type tracks a set of those bindings. The graph entry `dep[dc]`
holds the set of "users" of `dc`; `addDepLocked` adds an edge,
`removeDepLocked` removes one and returns a function to run when the
set becomes empty. The function is the `finalClose`. This way,
`dc.Close()` does not strand prepared statements: the conn is marked
closed, but its driver-level handle is only torn down after the last
statement that references it has also been closed.

## Tx pinning

When you call `db.BeginTx`, the pool gives you a connection and locks
it. The `Tx` struct (around `database/sql/sql.go:1925`) holds a
pointer to that `driverConn` and uses it for every subsequent query.

```go
// database/sql/sql.go:1925
type Tx struct {
    db *DB

    // closemu prevents the transaction from closing while there
    // is an active query. It is held for read during queries
    // and exclusively during close.
    closemu sync.RWMutex

    // dc is owned exclusively until Commit or Rollback, at which point
    // it's returned with putConn.
    dc  *driverConn
    txi driver.Tx

    // releaseConn is called once the Tx is closed to release
    // any held driverConn back to the pool.
    releaseConn func(error)

    // done transitions from false to true exactly once, on Commit
    // or Rollback. once done, all operations fail with
    // ErrTxDone.
    done atomic.Bool

    // keepConnOnRollback is true if the connection is kept open after a Rollback failure.
    keepConnOnRollback bool

    // All Stmts prepared for this transaction. These will be closed after the
    // transaction has been committed or rolled back.
    stmts struct {
        sync.Mutex
        v []*Stmt
    }

    // cancel is called after done transitions from false to true.
    cancel func()

    // ctx lives for the life of the transaction.
    ctx context.Context
}
```

Key invariants:

- A `Tx` owns exactly one `*driverConn` for its lifetime. The
  connection is not available to anyone else.
- All methods on `Tx` take the same `dc` and pass it through to the
  driver. There is no need to consult `freeConn` again.
- `closemu sync.RWMutex` lets multiple in-flight queries on the same
  Tx interleave with each other under the read lock, while `Commit`
  and `Rollback` take the write lock so they wait for outstanding
  queries to finish before closing the Tx.
- On `Commit` or `Rollback`, `releaseConn(err)` runs. That function
  was set in `BeginTx` to call `db.putConn(dc, err, true)`. The `true`
  argument is `resetSession`, which marks the conn for session reset
  on the next checkout. This is what makes sure that an aborted
  transaction does not leave session-level state visible to the next
  user.

`db.BeginTx` itself is below. Note the retry on `driver.ErrBadConn`:

```go
// database/sql/sql.go:1859
func (db *DB) BeginTx(ctx context.Context, opts *TxOptions) (*Tx, error) {
    var tx *Tx
    var err error
    for i := 0; i < maxBadConnRetries; i++ {
        tx, err = db.begin(ctx, opts, cachedOrNewConn)
        if !errors.Is(err, driver.ErrBadConn) {
            break
        }
    }
    if errors.Is(err, driver.ErrBadConn) {
        return db.begin(ctx, opts, alwaysNewConn)
    }
    return tx, err
}
```

`maxBadConnRetries` is `2`. So on a bad connection the pool retries
twice with the cached-or-new strategy, then falls through to a final
attempt that forces a brand-new connection. This pattern shows up
again on `Query`, `Exec`, and `Ping`. It is the package's standard way
of dealing with stale TCP connections that died between checkout
attempts.

## Stmt and per-connection prepared statements

`Stmt` (around `database/sql/sql.go:2598`) is interesting because it
straddles the pool. A `Stmt` returned by `db.Prepare` is a pool-level
object that knows how to materialize a per-connection driver statement
on demand and how to release it.

```go
// database/sql/sql.go:2598
type Stmt struct {
    // Immutable:
    db        *DB    // where we came from
    query     string // that created the Stmt
    stickyErr error  // if non-nil, this error is returned for all operations

    closemu sync.RWMutex // held exclusively during close, for read otherwise.

    // If Stmt is prepared on a Tx or Conn then cg is present and will
    // only ever grab a connection from cg.
    // If cg is nil then the Stmt must grab an arbitrary connection
    // from db and determine if it must call Conn.Prepare or use a cached statement.
    cg   stmtConnGrabber
    cgds *driverStmt

    // parentStmt is set when a transaction-specific statement
    // is requested from an identical statement prepared on the same
    // conn. parentStmt is used to track the dependency of this statement
    // on its originating ("parent") statement so that parentStmt may
    // be closed by the user without them having to know whether or not
    // any transactions are still using it.
    parentStmt *Stmt

    mu     sync.Mutex // protects the rest of the fields
    closed bool

    // css is a list of underlying driver statement interfaces
    // that are valid on particular connections. This is only
    // used if cg == nil and one is found that has idle
    // connections. If cg != nil, cgds is always used.
    css []connStmt

    // lastNumClosed is copied from db.numClosed when Stmt is created
    // without tx and closed connections in css are removed.
    lastNumClosed uint64
}

type connStmt struct {
    dc *driverConn
    ds *driverStmt
}
```

The mental model is:

- A `Stmt` is a logical prepared statement plus a cache of
  per-`driverConn` driver-level prepares (`css`).
- When you call `stmt.Query`, the code grabs a connection from the
  pool. If the cache `css` has an entry for that connection, the
  driver statement is reused. If not, `Conn.Prepare(query)` runs and
  the result is added to the cache.
- `db.numClosed` is consulted to evict cache entries for connections
  that have been closed since the last call. That is what
  `lastNumClosed` is for: a cheap "did the world change?" check.

When you call `stmt.Close`, every entry in `css` is closed via the
driver and the dependency edge from the conn to the stmt is removed.

For `tx.Stmt(stmt)`, the package creates a new `Stmt` whose `cg` is
the `Tx`, meaning all operations will use the Tx's pinned connection.
That is why you can prepare a statement on `db`, then use it inside a
`Tx`, and the package will arrange for a fresh prepare on the Tx's
specific connection if one is not already cached.

## Rows and the single-threaded contract

`Rows` (around `database/sql/sql.go:3193`) is documented to be safe
for use by a single goroutine. The package does not protect it with a
mutex.

```go
// database/sql/sql.go:3193
type Rows struct {
    dc          *driverConn // owned; must call releaseConn when closed to release
    releaseConn func(error)
    rowsi       driver.Rows
    cancel      func() // called when Rows is closed, may be nil.

    // closemu prevents Rows from closing while there
    // is an active streaming result. It is held for read during non-close operations
    // and exclusively during close.
    //
    // closemu guards lasterr and closed.
    closemu sync.RWMutex
    closed  bool
    lasterr error // non-nil only if closed is true

    // lastcols is only used in Scan, Next, and NextResultSet which are expected
    // not to be called concurrently.
    lastcols []driver.Value

    // raw is a buffer for RawBytes that persists between Scan calls.
    // This is used when the driver returns a mismatched type that requires
    // an allocation.
    raw []byte

    // hookNextDone is for testing.
    hookNextDone func()
}
```

The `closemu` field exists for one specific concurrency: an HTTP
handler that calls `rows.Close()` from a deferred close while another
goroutine is in the middle of `rows.Next`. The read lock is held
during streaming; the write lock during close. This means a deferred
`rows.Close()` will safely wait for the in-flight `Next` to finish.
But two concurrent `rows.Next` calls are not protected, and the
documentation is explicit that you must not do that.

`Rows` owns the `driverConn` for the duration of iteration. When you
call `rows.Close`, `releaseConn(err)` is invoked, which is the same
`db.putConn` plumbing we already saw. That is why leaking a `Rows`
value leaks a connection: the conn stays marked `inUse = true` and
nobody else can have it.

## Context cancellation while waiting

The wait path inside `conn` is the most common place for context
cancellation to bite, so it is worth a section of its own.

```go
case <-ctx.Done():
    db.mu.Lock()
    delete(db.connRequests, reqKey)
    db.mu.Unlock()

    db.waitDuration.Add(int64(time.Since(waitStart)))

    select {
    default:
    case ret, ok := <-req:
        if ok && ret.conn != nil {
            db.putConn(ret.conn, ret.err, false)
        }
    }
    return nil, ctx.Err()
```

Three steps after the context fires.

1. Remove the request key from the map. After this, no future
   `putConnDBLocked` can find this waiter.
2. Record the wait time. Even though the wait ended in cancellation,
   it still counts toward `WaitDuration`.
3. Drain the request channel non-blockingly. If a connection had
   already been handed off between "we checked the map" and "we
   acquired the mutex to delete", it is sitting in the channel.
   Returning it via `putConn` puts it back in the free list or hands
   it to another waiter.

Without step 3 you would leak a connection on every cancellation race.
With it, the pool is correct. This is the only place in the file where
a non-blocking receive is used purely for race resolution rather than
flow control. Look for it the next time you read the source.

The same dance is repeated, in inverted form, on the put side. When
`putConnDBLocked` decides to deliver to a waiter, it picks the key,
deletes it, sets `inUse = true`, and sends. The buffer-of-1 plus the
delete-under-lock ensures the send always succeeds, even if the
waiter has already moved on to the context-cancelled branch above.

## The four tunables

`SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`, and
`SetConnMaxIdleTime` all live near `database/sql/sql.go:920`. They are
short and instructive.

```go
// database/sql/sql.go:920
func (db *DB) SetMaxIdleConns(n int) {
    db.mu.Lock()
    if n > 0 {
        db.maxIdleCount = n
    } else {
        // No idle connections.
        db.maxIdleCount = -1
    }
    // Make sure maxIdle doesn't exceed maxOpen
    if db.maxOpen > 0 && db.maxIdleConnsLocked() > db.maxOpen {
        db.maxIdleCount = db.maxOpen
    }
    var closing []*driverConn
    idleCount := len(db.freeConn)
    maxIdle := db.maxIdleConnsLocked()
    if idleCount > maxIdle {
        closing = db.freeConn[maxIdle:]
        db.freeConn = db.freeConn[:maxIdle]
    }
    db.maxIdleClosed += int64(len(closing))
    db.mu.Unlock()
    for _, c := range closing {
        c.Close()
    }
}

func (db *DB) SetMaxOpenConns(n int) {
    db.mu.Lock()
    db.maxOpen = n
    if n < 0 {
        db.maxOpen = 0
    }
    syncMaxIdle := db.maxOpen > 0 && db.maxIdleConnsLocked() > db.maxOpen
    db.mu.Unlock()
    if syncMaxIdle {
        db.SetMaxIdleConns(n)
    }
}

func (db *DB) SetConnMaxLifetime(d time.Duration) {
    if d < 0 {
        d = 0
    }
    db.mu.Lock()
    // Wake cleaner up when lifetime is shortened.
    if d > 0 && d < db.maxLifetime && db.cleanerCh != nil {
        select {
        case db.cleanerCh <- struct{}{}:
        default:
        }
    }
    db.maxLifetime = d
    if db.numOpen > 0 && db.maxLifetime > 0 {
        db.startCleanerLocked()
    }
    db.mu.Unlock()
}

func (db *DB) SetConnMaxIdleTime(d time.Duration) {
    if d < 0 {
        d = 0
    }
    db.mu.Lock()
    defer db.mu.Unlock()

    // Wake cleaner up when idle time is shortened.
    if d > 0 && d < db.maxIdleTime && db.cleanerCh != nil {
        select {
        case db.cleanerCh <- struct{}{}:
        default:
        }
    }
    db.maxIdleTime = d
    if db.numOpen > 0 && db.maxIdleTime > 0 {
        db.startCleanerLocked()
    }
}
```

Things to notice:

- `SetMaxIdleConns(n)` not only sets the field; if the current free
  list is already larger, it slices the tail off and closes those
  connections immediately. This is the only place outside the cleaner
  where free connections are closed in bulk.
- `SetMaxOpenConns(n)` recursively calls `SetMaxIdleConns(n)` if the
  new max-open is smaller than the current max-idle. The invariant
  `maxIdle <= maxOpen` is preserved by the package; you cannot leave
  the pool in a contradictory state via these knobs.
- `SetConnMaxLifetime` and `SetConnMaxIdleTime` both poke `cleanerCh`
  with a non-blocking send so the cleaner wakes up and recomputes its
  schedule. If the cleaner is not yet running, `startCleanerLocked`
  may launch it.

The `maxIdleConnsLocked` helper:

```go
// database/sql/sql.go:891
const defaultMaxIdleConns = 2

func (db *DB) maxIdleConnsLocked() int {
    n := db.maxIdleCount
    switch {
    case n == 0:
        return defaultMaxIdleConns
    case n < 0:
        return 0
    default:
        return n
    }
}
```

A zero value (the default) means "two idle connections". A negative
value means "no idle connections" (every put will close). A positive
value means literally that number. This is one of the most
under-appreciated defaults in `database/sql`: a fresh `*DB` will
happily idle two open connections to your database even when your
app is doing nothing, and a fresh pool with the default settings can
look surprisingly chatty in tcpdump.

## DBStats and what they actually measure

`DB.Stats()` (around `database/sql/sql.go:1056`) returns a snapshot:

```go
// database/sql/sql.go:1056
type DBStats struct {
    MaxOpenConnections int // Maximum number of open connections to the database.

    // Pool Status
    OpenConnections int // The number of established connections both in use and idle.
    InUse           int // The number of connections currently in use.
    Idle            int // The number of idle connections.

    // Counters
    WaitCount         int64         // The total number of connections waited for.
    WaitDuration      time.Duration // The total time blocked waiting for a new connection.
    MaxIdleClosed     int64         // The total number of connections closed due to SetMaxIdleConns.
    MaxIdleTimeClosed int64         // The total number of connections closed due to SetConnMaxIdleTime.
    MaxLifetimeClosed int64         // The total number of connections closed due to SetConnMaxLifetime.
}

func (db *DB) Stats() DBStats {
    wait := db.waitDuration.Load()

    db.mu.Lock()
    defer db.mu.Unlock()

    stats := DBStats{
        MaxOpenConnections: db.maxOpen,

        Idle:            len(db.freeConn),
        OpenConnections: db.numOpen,
        InUse:           db.numOpen - len(db.freeConn),

        WaitCount:         db.waitCount,
        WaitDuration:      time.Duration(wait),
        MaxIdleClosed:     db.maxIdleClosed,
        MaxIdleTimeClosed: db.maxIdleTimeClosed,
        MaxLifetimeClosed: db.maxLifetimeClosed,
    }
    return stats
}
```

`InUse` is `numOpen - len(freeConn)`. It is a derived value, not a
field. That means even a stats-only call has to take `db.mu`. There is
no way to read the in-use count atomically. In a hot path this is
fine because the lock is held only long enough to read four ints; but
if you call `Stats()` every microsecond from many goroutines, you can
introduce contention. Read it from a single ticker, not from request
handlers.

The counters (`WaitCount`, `WaitDuration`, `MaxIdleClosed`,
`MaxIdleTimeClosed`, `MaxLifetimeClosed`) are monotonically
increasing. To compute rates, take two snapshots and subtract. The
classic mistake is to read `WaitCount` and conclude "we never wait"
because the value is small; if your app has been running for a week,
divide by elapsed time and you will see the real rate.

`MaxIdleClosed` rising under load means `SetMaxIdleConns` is too low:
the pool is opening connections, using them once, then closing them
because there is no idle slot. Bump it.

`MaxIdleTimeClosed` rising during slow periods means
`SetConnMaxIdleTime` is doing its job: cold connections are being
recycled. That is usually fine.

`MaxLifetimeClosed` rising means connections are being rotated by
age. That is also usually fine, especially if you have a load
balancer in front of the database that needs to see periodic
reconnection to rebalance.

`WaitCount` and `WaitDuration` rising together is the signature of
pool exhaustion. Either the pool is too small (raise `maxOpen`) or
the application is holding connections too long (look for `Rows`
leaks, long-running transactions, or accidental `db.Exec` inside a
`for` loop that should be a single `INSERT`).

## driver.Conn, driver.SessionResetter, driver.Validator

A short detour into `database/sql/driver/driver.go` is in order so the
pool's behavior makes sense.

```go
// database/sql/driver/driver.go:99
type Conn interface {
    Prepare(query string) (Stmt, error)
    Close() error
    Begin() (Tx, error)
}

// database/sql/driver/driver.go:144
type SessionResetter interface {
    ResetSession(ctx context.Context) error
}

// database/sql/driver/driver.go:150
type Validator interface {
    IsValid() bool
}

// database/sql/driver/driver.go:128
var ErrBadConn = errors.New("driver: bad connection")
```

`ErrBadConn` is the contract that lets the pool retry safely. The
documentation comment at `driver/driver.go:127` is worth quoting in
full:

> ErrBadConn should be returned by a driver to signal to the sql
> package that a driver.Conn is in a bad state (such as the server
> having earlier closed the connection) and the sql package should
> retry on a new connection.

The key word is "should": only return `ErrBadConn` when you are sure
the statement did not execute on the server. If you return it from a
write that may have partially happened, you create a duplicate
execution risk. Drivers like `lib/pq` and `pgx/v5/stdlib` follow this
rule: they downgrade to a permanent error the moment the wire
protocol has progressed past the point of no return.

The pool's retry loop appears at `database/sql/sql.go:1648`:

```go
const maxBadConnRetries = 2

// database/sql/sql.go:1648
func (db *DB) Exec(query string, args ...any) (Result, error) {
    return db.ExecContext(context.Background(), query, args...)
}

func (db *DB) ExecContext(ctx context.Context, query string, args ...any) (Result, error) {
    var res Result
    var err error
    for i := 0; i < maxBadConnRetries; i++ {
        res, err = db.exec(ctx, query, args, cachedOrNewConn)
        if !errors.Is(err, driver.ErrBadConn) {
            break
        }
    }
    if errors.Is(err, driver.ErrBadConn) {
        return db.exec(ctx, query, args, alwaysNewConn)
    }
    return res, err
}
```

Two cached-or-new retries, then a final force-new attempt. This is
the same pattern as `BeginTx`. `QueryContext` and `PingContext`
follow it too. It is the package-wide story for recovering from
stale connections.

## Putting it all together: a query's life

Let us trace `db.QueryContext(ctx, "SELECT 1")` from caller to bytes
on the wire.

1. `QueryContext` calls `db.query(ctx, query, args, cachedOrNewConn)`.
2. `db.query` calls `db.conn(ctx, cachedOrNewConn)`.
3. Inside `conn`:
   a. Lock `db.mu`. Check `closed`. Check `ctx.Done`.
   b. `freeConn` is empty (first call). Skip the free path.
   c. `db.numOpen < db.maxOpen` (or maxOpen is unset). Take the
      open-new path. `numOpen++`. Unlock.
   d. Call `db.connector.Connect(ctx)`. The driver dials. Returns
      `driver.Conn`.
   e. Lock `db.mu`. Build a `driverConn` with `inUse = true`,
      `createdAt = now`, `returnedAt = now`. Call `addDepLocked`.
      Unlock.
   f. Return `dc`.
4. Back in `db.query`: call `db.queryDC(ctx, txctx, dc, releaseConn,
   query, args)`.
5. `queryDC` checks whether the driver implements `Queryer`
   (deprecated) or `QueryerContext`. It uses `QueryerContext.QueryContext`
   if available, falling back to prepare-then-query.
6. The driver writes the wire-level query, reads the response, and
   returns a `driver.Rows`.
7. `queryDC` wraps `driver.Rows` in a `*Rows` whose `releaseConn`
   captures `dc` and the put function.
8. The caller iterates with `rows.Next` and `rows.Scan`. Each call
   is a single-goroutine operation on `rows`.
9. The caller calls `rows.Close`. `releaseConn(nil)` runs, which
   calls `db.putConn(dc, nil, true)`.
10. `putConn`:
    a. `validateConnection(true)` is called. If the driver's
       `IsValid` returns false, switch to the ErrBadConn path.
    b. Lock `db.mu`. Check `inUse` (true). Check `dc.expired(maxLifetime)`.
    c. Mark `inUse = false`. Set `returnedAt = now`.
    d. Run any `dc.onPut` callbacks.
    e. `putConnDBLocked(dc, nil)`. No waiters. `len(freeConn) <
       maxIdleConnsLocked()`. Append to `freeConn`. Call
       `startCleanerLocked` (no-op if no lifetime is set). Return
       true.
    f. Unlock.
11. The next `db.QueryContext` will pick this connection off
    `freeConn` via the LIFO pop.

That is the whole journey. Eleven steps for a single round trip;
most of the time only steps 9-11 differ between subsequent queries.

## Real-world consequences of this design

A few things fall out of the design that matter for production
deployments.

The LIFO free list means connections that have just been used are
more likely to be picked next. Under steady load with `maxOpen = 100`
and a working set of 30 simultaneous queries, you will tend to see
about 30 connections busy and 70 connections collecting dust. The
`SetConnMaxIdleTime` knob is how you reclaim those 70.

The arbitrary-waiter selection in `putConnDBLocked` (range over the
map, break on the first entry) means waiters are served in
pseudorandom order. There is no FIFO fairness. In practice this is
not a problem because the wait times are bounded by your
`db.SetConnMaxLifetime` and your context deadlines, but it means you
cannot rely on the pool to be fair.

The opener goroutine is a single goroutine. It dials sequentially. If
your driver's `Connect` takes 200ms (TLS, DNS, authentication), and
you suddenly want 20 more connections, the opener will need four
seconds to satisfy them all. During that four seconds, your latency
metrics will show wait time. The fix is to keep the working set warm
with a sensible `SetMaxIdleConns` and `SetConnMaxIdleTime`, not to
parallelize the opener (the package does not let you).

The cleaner is also a single goroutine, but it runs only periodically
and does not block anyone. Its only effect on hot-path latency is
that `c.Close()` may briefly contend on the driver's send mutex if a
caller happens to be dialing the same connection-typed object. In
practice this is unmeasurable.

`numOpen` is incremented optimistically before `connector.Connect`.
Under failure, the increment is rolled back. This means
`db.Stats().OpenConnections` can briefly include connections that
are about to be discarded because the dial failed. If you sample
stats very fast and very often during a database outage, you will
see the count flap. That is normal.

`db.numClosed` is the simplest field in the struct: it just counts
how many times `finalClose` ran. Prepared statements use it to
decide whether their `css` cache needs garbage collection. If your
app is heavily statement-cache-bound, you will see `numClosed` grow
slowly under steady state and spike when you call
`SetConnMaxLifetime` to a smaller value (which forces lifetime-based
recycling).

## Reading order summary

If you go back and read `database/sql/sql.go` end to end, follow this
order to keep your head straight:

1. Lines 1-90: package doc, imports, constants. Skim.
2. Lines 90-300: the registry, `drivers`, `Register`. Skip on first
   read.
3. Lines 380-440: `connRequest`, `connReuseStrategy`, `driverConn`.
   Read carefully.
4. Lines 440-540: the `DB` struct itself. Read every field.
5. Lines 540-700: `driverConn` methods. Focus on `expired`,
   `Close`, `finalClose`.
6. Lines 700-820: dep graph. Read once for context.
7. Lines 820-900: `Open`, `OpenDB`, `Close`. Read carefully.
8. Lines 900-1080: `SetMax*`, `SetConn*`, `maxIdleConnsLocked`,
   `startCleanerLocked`. Read carefully.
9. Lines 1080-1230: the cleaner. Read carefully.
10. Lines 1230-1300: `maybeOpenNewConnections`, `connectionOpener`,
    `openNewConnection`. Read very carefully.
11. Lines 1300-1410: `conn`. The single most important function in
    the file.
12. Lines 1410-1500: `putConn`, `putConnDBLocked`. Read very
    carefully.
13. Lines 1500-1700: `exec`, `query`, `Ping`. Read for the retry
    pattern.
14. Lines 1860-2100: `BeginTx`, `Tx`. Read once.
15. Lines 2580-3000: `Stmt`. Read once.
16. Lines 3100-3400: `Rows`. Read once.

There is more in the file (database/sql Row, Scanner, NullString,
etc.), but it is leaf code that does not change the pool model. The
concurrency story is fully contained in the 1500 lines listed above.

## Heuristics for choosing the four knobs

This is not a tuning guide, but reading the source clarifies how the
knobs interact.

`SetMaxOpenConns(n)`: set to the maximum number of concurrent
operations you want against the database. Below that, you waste
connections; above, you stack waiters. The optimum is usually well
below your database's `max_connections` because every other instance
of your service is also drawing from the same pool. A common formula
is `floor(0.8 * (DB max_connections - reserved_admin) / app_replicas)`.

`SetMaxIdleConns(n)`: set to the working set of your app at steady
state. Set it equal to or close to `maxOpen` if your traffic is
bursty; lower it if memory is tight and you would rather pay for new
dials than for kept-warm connections. The default of `2` is almost
always wrong for a real workload.

`SetConnMaxLifetime(d)`: set to slightly less than whatever
intermediate cuts connections for you. If you have a load balancer
with a 5-minute connection timeout, set this to 4 minutes. If you
have nothing in the path, 30 minutes to 1 hour is a sane default to
let upstream pgbouncer-like things rotate.

`SetConnMaxIdleTime(d)`: set to the timescale beyond which an idle
connection is no longer worth holding. For a database charged per
connection-minute, this matters. For a database that does not, this
is a memory hygiene knob: 5 to 15 minutes is fine.

## Common pitfalls visible in the source

Reading the source makes a few recurring user errors easy to
understand.

Forgetting to close `Rows`. The `dc` is captured by `releaseConn`.
Nothing else releases the connection. `dc.inUse` stays true. The
connection is invisible to the free path. Eventually you hit
`maxOpen` and every query waits forever.

Forgetting to call `Rollback` or `Commit` on a `Tx`. Same as above
but with the Tx's `dc`. The pool will wait. Use `context.WithTimeout`
on your `BeginTx` and use `defer tx.Rollback()`, which is harmless on
a committed Tx.

Calling `db.Close` while goroutines are mid-query. `Close` sets
`db.closed = true` and tears down resources. In-flight `conn` calls
that have not yet returned will see `errDBClosed` on the next pool
operation. Make sure your shutdown sequence drains queries before
calling `db.Close`.

Setting `maxIdleConns` higher than `maxOpenConns`. The package
silently clamps `maxIdleCount` down. If you wanted higher idle
than open, the source rejects it.

Calling `db.Stats()` in a tight loop. Each call takes `db.mu`. Under
load, this can show up in flame graphs. Sample, do not poll.

## Where to go next

The companion `professional.md` for this section dives into pool
sizing, monitoring, and incident playbooks for production
PostgreSQL/MySQL deployments. The `find-bug.md` exercises ask you to
spot leaks and starvation patterns in code samples. The
`optimize.md` exercises ask you to apply the source-level knowledge
in this document to fix bad pool settings under simulated load.

For driver-level reading, follow up with `pgx/v5/stdlib` (Postgres,
which fully implements `Connector`, `SessionResetter`, and
`Validator`) and the `go-sql-driver/mysql` source (MySQL, which has
historically had subtleties around `ErrBadConn` on writes that
illustrate why the contract matters).

The next time you face a `connection pool exhausted` ticket, return
to this file and trace `conn` and `putConn` in your head. You will
find the answer faster than any profiler will.

[← Back](../)
