---
layout: default
title: database/sql Pool — Junior
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/junior/
---

# database/sql Connection Pool — Junior Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [What a Connection Is](#what-a-connection-is)
6. [Why a Pool Exists](#why-a-pool-exists)
7. [What `*sql.DB` Actually Holds](#what-sqldb-actually-holds)
8. [The Two Roles of `*sql.DB`](#the-two-roles-of-sqldb)
9. [Goroutine Safety, Plain English](#goroutine-safety-plain-english)
10. [`*sql.DB` vs `*sql.Conn` vs `*sql.Tx`](#sqldb-vs-sqlconn-vs-sqltx)
11. [Lifetime of One Query](#lifetime-of-one-query)
12. [`Open` Does Not Open](#open-does-not-open)
13. [`Ping` Forces a Real Connection](#ping-forces-a-real-connection)
14. [Closing What You Opened](#closing-what-you-opened)
15. [Pool Knobs You Can Set](#pool-knobs-you-can-set)
16. [Reading `DBStats`](#reading-dbstats)
17. [Hands-On: A Tiny Program](#hands-on-a-tiny-program)
18. [Coding Patterns](#coding-patterns)
19. [Clean Code](#clean-code)
20. [Error Handling](#error-handling)
21. [Security Considerations](#security-considerations)
22. [Performance Tips](#performance-tips)
23. [Best Practices](#best-practices)
24. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
25. [Common Mistakes](#common-mistakes)
26. [Common Misconceptions](#common-misconceptions)
27. [Tricky Points](#tricky-points)
28. [Test](#test)
29. [Tricky Questions](#tricky-questions)
30. [Cheat Sheet](#cheat-sheet)
31. [Self-Assessment Checklist](#self-assessment-checklist)
32. [Summary](#summary)
33. [What You Can Build](#what-you-can-build)
34. [Further Reading](#further-reading)
35. [Related Topics](#related-topics)
36. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "What is a connection pool? Why does `*sql.DB` look like one object but secretly manage many? What do I, a junior Go programmer, need to know to not corrupt my data?"

A **connection pool** is a piece of code that keeps a small number of expensive resources (database connections) alive, hands them out to callers on demand, and takes them back when callers are done. The standard library puts this pool inside `*sql.DB`. To you the programmer it looks like a single object with methods like `Query`, `Exec`, and `Begin`. Under the hood it is juggling sockets, mutexes, and goroutines so you can write `db.Query("SELECT ...")` from any goroutine and have it Just Work.

This file teaches you, at the junior level, the vocabulary and intuition behind that pool. We are not going to read `sql.go` source line by line — that is the middle file. We are going to answer:

1. What is a database connection, physically?
2. Why is opening one expensive enough to merit a pool?
3. What does `*sql.DB` look like inside, at a high level?
4. How do `Query`, `Exec`, and `Begin` get a conn out of the pool?
5. What is `MaxOpenConns`, `MaxIdleConns`, `ConnMaxLifetime`, `ConnMaxIdleTime`?
6. How do you observe the pool with `db.Stats()`?
7. What are the most common ways to leak a conn?

After reading this file you will understand why `*sql.DB` is something you create once at program start and share with everyone, why `sql.Open` does not actually open anything, and why forgetting `rows.Close()` is the single most common production bug in Go database code.

You will not yet understand `(*DB).conn`'s exact lock interleavings or how `connRequests` works as a wait queue. That is the middle file. You will know the *why* and the *vocabulary*, which is the foundation everything else stands on.

---

## Prerequisites

- **Required:** Comfort with Go syntax, goroutines, and channels.
- **Required:** You have written a small Go program that talks to a database (PostgreSQL, MySQL, SQLite — any one).
- **Required:** Awareness that `database/sql` is a generic API and that you also need a driver (`github.com/lib/pq`, `github.com/jackc/pgx`, `github.com/go-sql-driver/mysql`, etc.).
- **Helpful:** Some exposure to TCP — you should know that a "connection" between two computers usually means a TCP socket, and that opening one takes a handshake.
- **Helpful:** Rough idea of what a database server is (a long-running program that listens on a TCP port).

You do not need to know:
- How PostgreSQL's wire protocol works.
- What SQL injection is at the byte level (we will mention it).
- Anything about the Go race detector's vector clocks.

If you can write `db, _ := sql.Open("postgres", dsn); db.QueryRow("SELECT 1")` and get a 1 back, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Connection pool** | A cache of already-open database connections, plus the logic to hand them out, take them back, open new ones, and close old ones. |
| **`*sql.DB`** | Go's standard-library type for a connection pool. Despite the name, it is *not* a single connection — it is a pool. Created via `sql.Open`. |
| **`*sql.Conn`** | A single connection checked out of the pool. Use it when you need session affinity (temp tables, advisory locks). Return it with `Conn.Close()`. |
| **`*sql.Tx`** | A transaction. Holds one connection from `BeginTx` until `Commit` or `Rollback`. |
| **`*sql.Rows`** | A cursor over query results. Holds one connection until `Close()`. |
| **`*sql.Row`** | A convenience for single-row queries. Auto-closes the underlying rows when you `Scan`. |
| **`*sql.Stmt`** | A prepared statement. Caches a prepared `driver.Stmt` per connection it has touched. Goroutine-safe. |
| **Driver** | The package that knows how to talk a specific database's wire protocol (e.g., `lib/pq` for Postgres). |
| **`driver.Conn`** | The driver-level type. The pool wraps one of these inside each `*driverConn`. *Not* goroutine-safe by itself; the pool serializes through a per-conn mutex. |
| **Idle conn** | A connection sitting in the pool, not currently checked out by any goroutine. |
| **In-use conn** | A connection currently checked out, owned by exactly one goroutine. |
| **`MaxOpenConns`** | The hard cap on simultaneously-open conns. Goroutines beyond this cap block. |
| **`MaxIdleConns`** | The cap on idle conns kept in the pool between uses. Default 2. |
| **`ConnMaxLifetime`** | Maximum wall time a conn may live before being closed and replaced. |
| **`ConnMaxIdleTime`** | Maximum time a conn may sit idle in the pool before being closed. |
| **`DBStats`** | A snapshot of the pool's internal counters: `OpenConnections`, `InUse`, `Idle`, `WaitCount`, `WaitDuration`, `MaxIdleClosed`, `MaxIdleTimeClosed`, `MaxLifetimeClosed`. |
| **Pool starvation** | A state where every conn is checked out and goroutines are queueing for one, often because of slow queries. |
| **Conn leak** | A goroutine acquires a conn (or rows or tx) and never returns it. Pool shrinks effectively by one. |
| **Dial** | The act of opening a fresh connection to the database: DNS, TCP handshake, TLS handshake, auth. Often 1–10 ms. |
| **`ResetSession`** | Optional driver hook called by the pool before reusing a conn to clear server-side session state. |
| **`IsValid()`** | Optional driver hook called by the pool right before reusing a conn to check it is still alive. |

---

## Core Concepts

### A pool is a queue with rules

The simplest pool would be a slice and a mutex: `var freeConn []*Conn; var mu sync.Mutex`. Take the mutex, pop the back of the slice, return. Push back when done.

`database/sql` is exactly that, with three additions:

1. **A hard cap (`MaxOpenConns`).** If the pool can't grow further, the caller has to wait.
2. **A waiting room (`connRequests`).** Callers who can't get a conn park in a per-request channel. When a conn becomes available, one waiter wakes.
3. **Background goroutines.** One opens new conns when needed (`connectionOpener`); one closes old ones (`connectionCleaner`).

Everything else — prepared statements, transactions, contexts — is built on top of this core.

### Why "open" is expensive

Opening one TCP connection from your Go process to the database server involves:

1. **DNS lookup.** Resolve `db.example.com` to an IP. Maybe cached, maybe not.
2. **TCP handshake.** Three-way SYN / SYN-ACK / ACK. ~1 round-trip across the network.
3. **TLS handshake.** Another 1–2 round-trips, plus crypto.
4. **Authentication.** Send username, get challenge, send password hash, get OK. 1–2 round-trips.
5. **Initial setup.** `SET application_name`, time zone, encoding. 1 round-trip.

In total: 4–6 round-trips. On a LAN at 0.5 ms each, that's 2–3 ms. Across regions it can be 50 ms. If your typical SQL query itself takes 1 ms, you cannot afford to open and close a conn per query. You have to pool.

### Why "close" matters too

Idle conns aren't free. Each one holds an OS file descriptor on both sides (Go and DB), and consumes memory on the DB server (~5–10 MB per Postgres backend). You don't want 10,000 idle conns either. So the pool needs an upper bound on idle, and a way to close conns that have been idle too long or have been open too long.

### A pool is a contention point

By definition, the pool is shared by every goroutine that wants to query the database. If your service handles 1000 qps, the pool's internal mutex is contended 1000 times per second. Designing the pool to keep the critical section as short as possible — and to release the mutex before doing anything that could block — is the whole game.

---

## What a Connection Is

A database connection is a long-lived TCP socket carrying a stream of messages: queries you send, results you read. Most databases have a stateful protocol — once you've authenticated, the conn is your session, and the server remembers things about you (the current schema, time zone, prepared statements, temp tables, transaction state).

This statefulness is why the pool exists, and also why misusing the pool is dangerous. A conn fresh from the pool may have a temp table you don't expect (created by a previous tenant of that conn). The driver may call `ResetSession` to clear that, or it may not. As a junior, the rule is: **don't put session-specific stuff on a conn unless you're using `*sql.Conn` or `*sql.Tx` to keep it pinned.**

### Conns are stateful

Inside a single `driver.Conn`, the following matter:
- The current transaction (if any).
- Prepared statements you've created on this conn.
- `SET LOCAL` values that survive the transaction (`SET LOCAL` lasts only until the next commit/rollback; plain `SET` lasts the whole session).
- Temp tables (Postgres `CREATE TEMP TABLE`).
- Advisory locks (Postgres `pg_advisory_lock`).

If you create a temp table on a conn and then return the conn to the pool, the temp table is still there when someone else gets that conn. This is usually a bug.

### Conns are single-threaded from the driver's view

A `driver.Conn` is *not* designed for concurrent use. Two goroutines reading from the same TCP socket would interleave bytes. The `database/sql` package guarantees that only one goroutine touches a `*driverConn` at a time, via a per-conn mutex. Drivers can rely on this and write straightforward code.

### Conns can die

TCP connections die for many reasons: network blip, server restart, load balancer timeout, OS killing the socket. A dead conn looks fine from your side until you try to send something through it. Then `db.Query` returns an error. The pool handles this by recognizing `driver.ErrBadConn`, discarding the conn, and retrying on a fresh one. Up to a small retry limit.

---

## Why a Pool Exists

Imagine you didn't have a pool. Every `db.Query` would:

```go
func Query(q string) {
    conn, _ := openConn()  // 3 ms
    rows, _ := conn.Exec(q) // 0.5 ms
    closeConn(conn)         // small
    use(rows)
}
```

At 1000 qps, you'd dial 1000 times per second. Most queries would be 3.5 ms total, of which 3 ms is dial. CPU would mostly be doing TLS handshakes. The DB server would see 1000 new connections per second, exhausting its `max_connections` setting. Latency would be terrible.

With a pool:

```go
func Query(q string) {
    conn, _ := pool.Get()    // 1 µs (just a mutex lock + slice pop)
    rows, _ := conn.Exec(q)  // 0.5 ms
    pool.Put(conn)           // 1 µs
    use(rows)
}
```

At 1000 qps, you dial maybe 10 times per second (as conns die or age out). Most queries are 0.5 ms total. DB server sees 10 conns held open. Latency is dominated by the actual query.

This is why every database client library has a pool. `database/sql` is unusual in that the pool is part of the standard library and shared across all drivers, instead of each driver writing its own.

---

## What `*sql.DB` Actually Holds

Internally, `*sql.DB` is roughly:

```go
type DB struct {
    mu           sync.Mutex
    freeConn     []*driverConn          // idle, ready to hand out
    connRequests map[uint64]chan connRequest  // goroutines waiting for a conn
    numOpen      int                    // count of opened conns (including dialing)
    maxOpen      int                    // user-set cap
    maxIdle      int                    // user-set idle cap
    maxLifetime  time.Duration
    maxIdleTime  time.Duration
    cleanerCh    chan struct{}          // wake the cleaner
    openerCh     chan struct{}          // wake the opener
    closed       bool
    // ... and more
}
```

(See `database/sql/sql.go:430` for the real definition.)

Notice what *isn't* in here: no record of which goroutine owns which conn. The pool doesn't care. It just hands them out and takes them back. The fact that "this goroutine" got "this conn" is encoded in the call stack of the goroutine, nothing more.

This is important: the pool is goroutine-agnostic. It can't tell you who's holding what. If a goroutine forgets to return its conn, the pool only finds out when the conn's lifetime expires or the goroutine exits and the GC kicks in (via a finalizer). The leak is silent from the pool's side.

---

## The Two Roles of `*sql.DB`

`*sql.DB` plays two roles simultaneously, and the distinction matters.

### Role 1: A pool of conns

You call `db.Query`, `db.Exec`, `db.BeginTx`. The pool picks a conn for you, runs your call, returns the conn (or pins it to a Tx).

### Role 2: A façade over the driver

`*sql.DB` exposes a uniform API regardless of whether the driver is Postgres, MySQL, SQLite, or something exotic. The driver author writes `Connect`, `ExecContext`, `QueryContext`, etc.; `*sql.DB` adds pooling, context cancellation, prepared statement caching, retry on `ErrBadConn`, and statistics.

If `*sql.DB` were *just* a pool, you could use it like a sync.Pool of conns. But it's also a query executor: `db.Query("SELECT ...")` does conn acquisition + execution + release in one call. This bundling is convenient but hides the conn-acquisition step.

When you want to make the acquisition explicit — for instance, to do several queries on the same session — you use `db.Conn(ctx)`, which gives you a `*sql.Conn`. That's the same conn until you `Close()` it.

---

## Goroutine Safety, Plain English

The package doc says:

> DB is a database handle representing a pool of zero or more underlying connections. It's safe for concurrent use by multiple goroutines.

In practice this means:

- You can share one `*sql.DB` across 1000 goroutines, all calling `Query` simultaneously.
- Each `Query` gets its own conn (or blocks waiting for one).
- The pool's internal data structures (`freeConn`, `connRequests`, `numOpen`) are protected by `db.mu`.

It does NOT mean:

- A `*sql.Rows` returned from `db.Query` is goroutine-safe. (It is not. One goroutine at a time per `*sql.Rows`.)
- A `*sql.Tx` is goroutine-safe. (It is not. One goroutine at a time per `*sql.Tx`.)
- A `*sql.Conn` is goroutine-safe across multiple methods. (Mostly not — see `database/sql/sql.go` for the small exceptions.)

The pool itself is safe; the *objects you check out of it* are single-goroutine.

### Why this distinction matters

A new Go programmer might write:

```go
rows, _ := db.Query("SELECT id FROM users")
var wg sync.WaitGroup
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for rows.Next() {
            var id int
            rows.Scan(&id)
            process(id)
        }
    }()
}
wg.Wait()
```

This compiles and *might* even produce output, but the race detector will scream. Four goroutines reading the same `*sql.Rows` race on the cursor and the scan buffer. Result: corrupted data.

The right pattern is: one goroutine iterates `rows`, dispatches parsed rows to workers via a channel.

---

## `*sql.DB` vs `*sql.Conn` vs `*sql.Tx`

These are easy to confuse.

| Type | What it represents | How to obtain | How to release | Goroutine-safe? |
|------|--------------------|---------------|----------------|-----------------|
| `*sql.DB` | The pool itself | `sql.Open` | `db.Close()` at program end | Yes |
| `*sql.Conn` | One conn pinned for a session | `db.Conn(ctx)` | `c.Close()` | No |
| `*sql.Tx` | A transaction | `db.BeginTx(ctx, opts)` | `tx.Commit()` or `tx.Rollback()` | No |

### When to use each

- **`*sql.DB`** for stateless queries: a SELECT here, an INSERT there, no relationship between them. ~90% of code uses only `*sql.DB`.
- **`*sql.Conn`** when you need session state across queries: temp tables, advisory locks, `SET` values, `LISTEN`/`NOTIFY` on Postgres. Rare.
- **`*sql.Tx`** when you need atomicity: multiple operations that must commit or roll back together. Common but not for every query.

### Cost differences

- `db.Query` → grab a conn from the pool, run, return. Typically microseconds of pool overhead.
- `db.Conn` → grab a conn and pin it. Pool overhead at acquisition + a `*sql.Conn` allocation. Conn is unavailable to others until released.
- `db.BeginTx` → grab a conn, send `BEGIN`. One extra round-trip. Conn pinned until `Commit`/`Rollback`.

A bad pattern is to wrap every query in `db.BeginTx`+`tx.Query`+`tx.Commit`. That's both an extra round-trip and an extra conn pin. Only use transactions when you need them.

---

## Lifetime of One Query

Step by step, what happens when you call `db.Query("SELECT name FROM users WHERE id = $1", 7)`:

1. **Lookup args.** Go figures out that `7` is an `int`. The driver will translate it later.
2. **Acquire a conn.** `*sql.DB` calls its internal `(*DB).conn(ctx, strategy)`:
   - Takes `db.mu`.
   - If `freeConn` has a conn: pop, mark in-use, release lock, return.
   - Else if `numOpen < MaxOpenConns`: increment `numOpen`, release lock, dial a new conn.
   - Else: build a `connRequest` channel, register it, release lock, wait in a `select`.
3. **Call the driver.** Now holding `dc.Lock()`, the pool calls the driver's `QueryContext` (or falls back to `Prepare` + `Query`).
4. **Driver sends the SQL.** Bytes go out over the TCP socket.
5. **Driver reads the response.** Bytes come back; column metadata + first batch of rows.
6. **Wrap in `*sql.Rows`.** A `*sql.Rows` struct is returned to the caller, holding a reference to the `*driverConn`.
7. **Caller iterates.** `rows.Next()` may pull more rows from the driver, which may read more bytes.
8. **Caller closes.** `rows.Close()`. The pool's `releaseConn(rows.dc, err)` is invoked, which calls `(*DB).putConn`, returning the conn to `freeConn` (or fulfilling a waiting `connRequest`).

Throughout, exactly one goroutine has access to the conn. The per-conn mutex (`dc.Lock`) is held for the duration of each driver call.

### What if step 2 has to wait?

If `numOpen == MaxOpenConns` and `freeConn` is empty, step 2 puts the goroutine to sleep in a `select`:

```go
select {
case req := <-myChannel:
    // someone put a conn into my channel
case <-ctx.Done():
    // I gave up waiting
}
```

When another goroutine returns a conn via `putConn`, the pool checks `connRequests` and sends the conn to one waiter's channel. That waiter wakes, finds the conn in its `req`, and proceeds with step 3.

If the ctx is canceled first, the goroutine returns `ctx.Err()`. There's careful logic to make sure that if a conn was concurrently put into the channel, it's not lost — it gets returned to the pool.

---

## `Open` Does Not Open

This trips up everyone the first time:

```go
db, err := sql.Open("postgres", "postgres://localhost/db")
if err != nil {
    log.Fatal(err)  // does NOT fire if Postgres is down
}
```

`sql.Open` validates the driver name and DSN syntax, allocates a `*sql.DB`, and returns. It does *not* dial Postgres. The first dial happens lazily — on the first `Query`, `Exec`, or explicit `Ping`.

To check the connection at program start:

```go
db, err := sql.Open("postgres", dsn)
if err != nil {
    log.Fatal(err)
}
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if err := db.PingContext(ctx); err != nil {
    log.Fatal(err)  // this WILL fire if Postgres is unreachable
}
```

### Why is `Open` lazy?

So that a misconfigured DSN can be caught synchronously without making your `init()` block on network I/O. Lazy is the right default for libraries.

---

## `Ping` Forces a Real Connection

`db.PingContext(ctx)` does exactly what its name says: it acquires a conn from the pool (opening one if necessary), calls the driver's `Ping()` method, and returns the conn. It's the only way to force a "really dial right now" without doing a query.

Use it for:
- Startup health checks.
- Periodic liveness checks of the pool.
- Pre-dialing a conn before a big workload so the first request doesn't pay the handshake.

Don't use it inside a hot path; it costs as much as a no-op query.

---

## Closing What You Opened

Three things you must close, in increasing severity of forgetting:

### 1. `*sql.Rows`

`rows.Close()` returns the conn to the pool. Without it, the conn is held until the GC finalizes the `*sql.Rows` — which could be never if you keep a reference.

```go
rows, err := db.Query("SELECT id FROM users")
if err != nil {
    return err
}
defer rows.Close()  // ALWAYS
```

Exception: if you iterate `rows.Next()` to completion, `rows` auto-closes. But `defer rows.Close()` is still correct (and idempotent).

### 2. `*sql.Tx`

Every `BeginTx` must be matched by `Commit` or `Rollback`. The pattern:

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
defer tx.Rollback()  // no-op if Commit succeeded
// ...do work...
return tx.Commit()
```

The deferred `Rollback` is a safety net: if any return path before `Commit` fires, the tx is rolled back; if `Commit` succeeded, the deferred `Rollback` is a no-op.

### 3. `*sql.DB`

Only at program shutdown. `db.Close()` closes all idle conns. In-flight queries continue until they finish, then their conns close.

```go
defer db.Close()  // at main()
```

You almost never close `*sql.DB` mid-program. It's a long-lived process resource.

---

## Pool Knobs You Can Set

Four knobs. Two cap counts; two cap durations.

### `db.SetMaxOpenConns(n)`

Hard cap on simultaneously-open conns (in-use + idle + dialing). Default 0 = unlimited. Always set this in production.

```go
db.SetMaxOpenConns(50)
```

### `db.SetMaxIdleConns(n)`

Cap on idle conns kept in the pool between uses. Default 2. If you set it less than `MaxOpenConns`, the difference will be closed-and-reopened constantly.

```go
db.SetMaxIdleConns(50)  // usually equal to MaxOpenConns
```

### `db.SetConnMaxLifetime(d)`

A conn older than `d` is closed at its next return-to-pool. Default 0 = never. Use to rotate conns across load balancer changes, DNS updates.

```go
db.SetConnMaxLifetime(30 * time.Minute)
```

### `db.SetConnMaxIdleTime(d)`

A conn that has been idle longer than `d` is closed by the cleaner goroutine. Default 0 = never. Use to free idle conns during quiet periods.

```go
db.SetConnMaxIdleTime(5 * time.Minute)
```

### Reasonable defaults for a web service

```go
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(50)
db.SetConnMaxLifetime(30 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
```

Tune from here based on observation.

---

## Reading `DBStats`

`db.Stats()` returns a snapshot:

```go
type DBStats struct {
    MaxOpenConnections int

    // Pool Status
    OpenConnections int
    InUse           int
    Idle            int

    // Counters
    WaitCount         int64
    WaitDuration      time.Duration
    MaxIdleClosed     int64
    MaxIdleTimeClosed int64
    MaxLifetimeClosed int64
}
```

What each tells you:

- **`OpenConnections`** = `InUse + Idle`. Conns the pool currently holds.
- **`InUse`** = checked out, busy.
- **`Idle`** = in `freeConn`, available.
- **`WaitCount`** = how many times a goroutine had to wait for a conn. Growing rapidly = pool too small.
- **`WaitDuration`** = cumulative wait time. Divide by `WaitCount` for average per wait.
- **`MaxIdleClosed`** = conns closed because `freeConn` was full at return. Means `MaxIdleConns` is smaller than your working set.
- **`MaxIdleTimeClosed`** = conns closed by the cleaner for idleness.
- **`MaxLifetimeClosed`** = conns closed by the cleaner for age.

A healthy production pool has:
- `WaitCount` growing very slowly (occasional waits OK).
- `MaxIdleClosed` near zero.
- `MaxLifetimeClosed` and `MaxIdleTimeClosed` growing steadily (rotation working).

---

## Hands-On: A Tiny Program

Let's set up a `*sql.DB` and look at it under load.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "sync"
    "time"

    _ "modernc.org/sqlite"
)

func main() {
    db, err := sql.Open("sqlite", "file:test.db?_busy_timeout=5000")
    if err != nil {
        panic(err)
    }
    defer db.Close()

    db.SetMaxOpenConns(3)
    db.SetMaxIdleConns(3)

    if err := db.PingContext(context.Background()); err != nil {
        panic(err)
    }

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 5; j++ {
                var n int
                if err := db.QueryRow("SELECT 1 + ?", j).Scan(&n); err != nil {
                    fmt.Println("err:", err)
                    return
                }
                time.Sleep(100 * time.Millisecond)
            }
        }(i)
    }

    // Print stats every 200 ms
    go func() {
        t := time.NewTicker(200 * time.Millisecond)
        defer t.Stop()
        for {
            <-t.C
            s := db.Stats()
            fmt.Printf("open=%d in_use=%d idle=%d wait=%d\n",
                s.OpenConnections, s.InUse, s.Idle, s.WaitCount)
        }
    }()

    wg.Wait()
}
```

Run this. You should see:
- `open` climb to 3 quickly.
- `in_use` oscillate between 0 and 3.
- `wait` increment (because 10 workers competing for 3 conns).

Now change `db.SetMaxOpenConns(3)` to `db.SetMaxOpenConns(10)`. Re-run. `wait` should stay at 0.

This is your first taste of pool sizing in action.

---

## Coding Patterns

### Pattern: Query + Close

```go
rows, err := db.Query(q, args...)
if err != nil {
    return err
}
defer rows.Close()

for rows.Next() {
    var v Foo
    if err := rows.Scan(&v.A, &v.B); err != nil {
        return err
    }
    process(v)
}
return rows.Err()
```

Always: query, defer close, loop, check err.

### Pattern: QueryRow

For single-row queries:

```go
var n int
err := db.QueryRow("SELECT COUNT(*) FROM t").Scan(&n)
```

`QueryRow` auto-closes the underlying rows when `Scan` runs. No explicit close needed.

### Pattern: Exec + Result

```go
res, err := db.Exec("DELETE FROM t WHERE id < ?", cutoff)
if err != nil {
    return err
}
n, _ := res.RowsAffected()
log.Printf("deleted %d rows", n)
```

`Exec` for statements that don't return rows. No conn-leak risk because there's no `*sql.Rows`.

### Pattern: Tx + defer Rollback

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
defer tx.Rollback()
// ... operations ...
return tx.Commit()
```

Defer + commit dance. If Commit fires, the deferred Rollback is a no-op (`ErrTxDone`, harmless).

### Pattern: PreparedStmt for repeated queries

```go
stmt, err := db.PrepareContext(ctx, "INSERT INTO t (a, b) VALUES (?, ?)")
if err != nil {
    return err
}
defer stmt.Close()

for _, r := range rows {
    if _, err := stmt.ExecContext(ctx, r.A, r.B); err != nil {
        return err
    }
}
return nil
```

Prepare once, exec many. Cheaper than re-preparing on every call.

### Pattern: db.Conn for session-pinned ops

```go
c, err := db.Conn(ctx)
if err != nil {
    return err
}
defer c.Close()

if _, err := c.ExecContext(ctx, "SET LOCAL statement_timeout = 5000"); err != nil {
    return err
}
// ... queries on c ...
```

`SET LOCAL` only affects the current session; pinning a conn keeps the same session.

---

## Clean Code

- **Pass `context.Context` everywhere.** Use `QueryContext`, `ExecContext`, `BeginTx`. Never the non-ctx variants in production.
- **Name your variables.** `func (s *Store) FindUserByID(ctx context.Context, id int64) (*User, error)` — explicit beats clever.
- **Group SQL constants.** Put `const sqlFindUser = "SELECT ..."` at the top of the file. Easy to grep for queries.
- **One layer between handlers and SQL.** A `Store` or `Repository` type that owns the `*sql.DB`. Handlers call store methods; only the store calls SQL.

### Anti-pattern: SQL string-building from user input

```go
db.Query("SELECT * FROM users WHERE name = '" + name + "'")  // SQL INJECTION
```

Always use placeholders:

```go
db.Query("SELECT * FROM users WHERE name = ?", name)
```

This is not a code-style preference; it is a security requirement.

---

## Error Handling

### Important error types

- `sql.ErrNoRows` — `QueryRow().Scan(...)` found no rows. Often expected, not actually an error.
- `sql.ErrTxDone` — tried to use a `*sql.Tx` after Commit/Rollback. Usually a bug.
- `sql.ErrConnDone` — used a `*sql.Conn` after Close.
- Driver-specific errors — `pq.Error` (Postgres), `*mysql.MySQLError` (MySQL).

### Distinguishing "no rows" from "error"

```go
var u User
err := db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = $1", id).Scan(&u.Name)
if err == sql.ErrNoRows {
    return nil, ErrUserNotFound  // domain error, not a system error
}
if err != nil {
    return nil, fmt.Errorf("query user: %w", err)
}
return &u, nil
```

### Wrapping context

Always wrap with `fmt.Errorf("...: %w", err)` so callers can `errors.Is` / `errors.As`.

---

## Security Considerations

### SQL injection

Mentioned above; the rule is *always use placeholders*. The driver figures out the right syntax (`?` for MySQL/SQLite, `$1, $2, ...` for Postgres). Never concatenate user input into SQL.

### Logging the DSN

```go
log.Println("connecting to", dsn)  // BAD if dsn contains password
```

DSNs often contain credentials. Mask them before logging.

### TLS

For production: always use TLS. Set `sslmode=require` (Postgres), `tls=true` (MySQL), etc. in the DSN.

### Least-privilege user

The DB user your service connects as should have only the privileges it needs. Don't connect as `postgres` superuser.

---

## Performance Tips

1. **Set `MaxOpenConns`.** Default unlimited is wrong for production.
2. **Set `MaxIdleConns == MaxOpenConns`** for steady workloads.
3. **Set `ConnMaxLifetime`** behind any load balancer.
4. **`defer rows.Close()`** every single time.
5. **Use `QueryRow` for single-row queries.** Less code, no leak risk.
6. **Batch INSERTs** with multi-row `VALUES (...), (...), ...` instead of one query per row.
7. **Cache `*sql.Stmt`** for hot queries (it's goroutine-safe).
8. **Use `context.Context` with timeouts** so a slow query doesn't tie up a conn forever.

---

## Best Practices

- **One `*sql.DB` per database, per process.** Share it widely.
- **Sentinel error checks with `errors.Is`** for `sql.ErrNoRows`.
- **Use migrations for schema** (golang-migrate, goose). Don't `CREATE TABLE` from app code.
- **Test with `sqlmock` or a real DB.** Mocking the driver is fragile; spinning up a real Postgres in a container is fine.
- **Never log secrets.** Redact passwords in DSN logs.
- **Monitor `DBStats`** in production. You'll learn more from one week of dashboards than from any blog post.

---

## Edge Cases and Pitfalls

### `sql.Open` doesn't catch bad DSN

If the DSN string is malformed, `sql.Open` may still succeed because it doesn't dial. Use `PingContext` at startup.

### `defer rows.Close()` after `if err != nil`

```go
rows, err := db.Query(q)
defer rows.Close()  // BAD: rows is nil if err != nil
if err != nil {
    return err
}
```

If `db.Query` errors, `rows` is nil. The deferred `rows.Close()` panics. Always check err first:

```go
rows, err := db.Query(q)
if err != nil {
    return err
}
defer rows.Close()
```

### `Scan` into a `*string` for nullable columns

A `NULL` column scanned into `*string` is fine (becomes nil), but into `string` is an error. Use `sql.NullString` or `*string`.

### Bool args

Most drivers translate Go `bool` to the DB's boolean. Some old MySQL configurations store booleans as `tinyint(1)`; check your driver.

### `QueryContext` with already-canceled ctx

Returns immediately with `ctx.Err()`. No conn is acquired.

---

## Common Mistakes

1. **Forgetting `rows.Close()`.** #1 leak source.
2. **Forgetting `tx.Rollback()`.** #2 leak source.
3. **`defer rows.Close()` inside a loop.** Defers stack up.
4. **Sharing `*sql.Rows` across goroutines.** Data race.
5. **Calling `sql.Open` repeatedly.** Should be once at startup.
6. **Using `db.Stats()` from a hot path.** Lock contention.
7. **Setting `MaxIdleConns=0`.** Constant reconnect cost.
8. **Concatenating user input into SQL.** SQL injection.
9. **No ctx timeout on `db.QueryContext`.** Hung queries pin conns.
10. **Closing `*sql.DB` in a unit test's `defer`.** Fine in a test, but in a long-lived program close only at shutdown.

---

## Common Misconceptions

- **"`*sql.DB` is one connection."** No, it's a pool.
- **"`sql.Open` connects."** No, it returns. First connection is lazy.
- **"`*sql.DB.Close()` closes after current queries."** Mostly true, but it doesn't *wait*; it just marks the pool closed.
- **"Higher `MaxOpenConns` is always better."** No — too high overruns DB's `max_connections`.
- **"Prepared statements are always faster."** Not always; for a one-off query, `Prepare` + `Exec` + `Close` is more round-trips than a plain `Exec`.
- **"`*sql.Stmt` is bound to one conn."** No, it caches one `driver.Stmt` per conn it has used.
- **"A `Tx` releases the conn between queries."** No, it pins from Begin to Commit/Rollback.

---

## Tricky Points

- **`db.Conn(ctx).Close()` returns the conn to the pool**, not to the OS. Different from `(*sql.DB).Close()`.
- **`rows.Next()` may dial a new conn on retry** if the driver returns `ErrBadConn` mid-query (depends on driver).
- **Two `db.Query` calls do not guarantee the same backend session.** You may get different conns, and Postgres `LISTEN` notifications could be split between them.
- **Calling methods on a closed `*sql.Rows` returns errors silently from some methods, panics from others.** Be conservative: don't touch after close.

---

## Test

A few quick check questions. Answers in the senior file.

1. What's the default `MaxIdleConns`?
2. What does `sql.ErrNoRows` mean?
3. Does `sql.Open` dial the database?
4. How do you make a single query auto-close its rows?
5. After `tx.Commit()`, can you call `tx.Exec`?
6. What's `db.Stats().WaitDuration` measured in?
7. What's the difference between `db.Query("SELECT ?", x)` and `db.Query("SELECT $1", x)`?
8. Can two goroutines call `db.Query` at the same time?
9. Can two goroutines iterate the same `*sql.Rows`?
10. When does `connectionCleaner` start its first iteration?

---

## Tricky Questions

1. You set `MaxOpenConns=10`. You start 20 goroutines, each calling `db.Query`. How many TCP conns are open after a few seconds?
2. You set `MaxIdleConns=2` and `MaxOpenConns=10`. After a load spike that opened 10 conns, you have no traffic for 1 minute. How many conns are open?
3. You see `db.Stats().MaxIdleClosed` rising rapidly. What's the cause?
4. Your app dials Postgres successfully, runs queries for a week. Then you change your Postgres password but don't restart the app. What happens?
5. You `db.BeginTx(ctx, nil)`. The ctx has a 1-second deadline. You take 5 seconds to commit. What happens?

---

## Cheat Sheet

```
sql.Open(driver, dsn)        →  return *DB, no dial
db.PingContext(ctx)          →  force dial
db.SetMaxOpenConns(n)        →  hard cap
db.SetMaxIdleConns(n)        →  idle cap (default 2)
db.SetConnMaxLifetime(d)     →  conn age limit
db.SetConnMaxIdleTime(d)     →  conn idleness limit
db.Stats()                   →  pool stats snapshot

db.QueryContext(ctx,q,args)  →  rows, defer rows.Close()
db.QueryRowContext(ctx,q,a)  →  single row, auto-close on Scan
db.ExecContext(ctx,q,args)   →  no rows, return Result
db.BeginTx(ctx,opts)         →  Tx, defer tx.Rollback()
db.Conn(ctx)                 →  pin a conn for session

rows.Next() / rows.Scan(...) / rows.Err()
tx.Commit() / tx.Rollback()
```

---

## Self-Assessment Checklist

- [ ] I can explain why `sql.Open` doesn't dial.
- [ ] I can list the four `Set...` knobs and what each one does.
- [ ] I always `defer rows.Close()` (or use `QueryRow`).
- [ ] I always pair `BeginTx` with `defer Rollback`.
- [ ] I use `Context` variants for every query.
- [ ] I know `*sql.DB`, `*sql.Conn`, `*sql.Tx`, `*sql.Rows` and which are goroutine-safe.
- [ ] I can read `db.Stats()` and explain each field.
- [ ] I never concatenate user input into SQL.
- [ ] I share one `*sql.DB` across my app.
- [ ] I would recognize a conn leak from a `db.Stats().InUse` rising over time.

---

## Summary

`*sql.DB` is a pool, not a connection. Its job is to amortize the cost of opening connections across many queries by reusing them, while presenting a single goroutine-safe handle to the rest of your code. You configure the pool with four knobs (`MaxOpenConns`, `MaxIdleConns`, `ConnMaxLifetime`, `ConnMaxIdleTime`), observe it with `db.Stats()`, and use it with `Query`, `Exec`, `BeginTx`, and `Conn`.

The objects you check *out* of the pool — `*sql.Rows`, `*sql.Tx`, `*sql.Conn` — are not goroutine-safe and must be closed or committed before their underlying conn can return to the pool. Forgetting these is the #1 source of production bugs.

You've now seen the *what* and the *why*. The middle file walks the actual `database/sql/sql.go` source and shows how `(*DB).conn`, `putConn`, `connectionOpener`, and `connectionCleaner` work line by line. The senior file then tunes the pool for real workloads.

---

## What You Can Build

With the junior-level understanding you should be able to:

- Open a `*sql.DB`, run a few queries, close cleanly.
- Configure pool size for a small service.
- Identify a forgotten `rows.Close()` and fix it.
- Add a `/healthz` endpoint that runs `db.PingContext`.
- Build a simple repository pattern wrapping `*sql.DB`.
- Read `db.Stats()` and reason about pool saturation.
- Use transactions correctly with `defer Rollback`.

You should not yet attempt:

- Diagnosing pool starvation in production (senior).
- Tuning `MaxOpenConns` for a 10k qps service (senior).
- Writing your own `database/sql` driver (specification).
- Sharding the pool across tenants (professional).

---

## Further Reading

- Go package doc: `database/sql` — https://pkg.go.dev/database/sql
- Go package doc: `database/sql/driver` — https://pkg.go.dev/database/sql/driver
- "Go database/sql tutorial" — http://go-database-sql.org/
- The actual source: `src/database/sql/sql.go` in your Go install (`go env GOROOT`).
- "How to use Go's `database/sql`" by Alex Edwards.
- `pgx` documentation for Postgres-specific features beyond `database/sql`.

---

## Related Topics

- Middle file: source walk of `database/sql/sql.go`.
- Senior file: pool tuning, `DBStats` deep dive, transaction pinning.
- Section 23-01: net/http server concurrency (the typical caller of the pool).
- Section 11: sync.Pool (a different "pool" for allocations).
- Section 22: memory barriers (what underlies the mutex protecting `db.mu`).

---

## Diagrams and Visual Aids

### High-level model

```
            ┌──────────────────────────────┐
            │           *sql.DB            │
            │  ┌──────────────────────┐    │
            │  │  freeConn []         │    │  <- idle pool
            │  │  connRequests {}     │    │  <- waiters
            │  │  numOpen, maxOpen    │    │
            │  └──────────────────────┘    │
            │  + connectionOpener goroutine│
            │  + connectionCleaner goroutine│
            └──────────────────────────────┘
              ▲                       ▲
        Query │                       │ PutConn
              │                       │
          (your goroutine)         (your goroutine)
```

### Lifetime of a conn

```
  Closed ──[dial]──▶ Idle ──[checkout]──▶ InUse ──[release]──▶ Idle ──[lifetime exceeded]──▶ Closed
                                                     │
                                                     ├── ctx canceled ─▶ Closed (bad)
                                                     │
                                                     └── ErrBadConn   ─▶ Closed
```

### What happens at `db.Query`

```
goroutine A         *sql.DB.mu           driverConn
  │                    │                     │
  ├──Query("SELECT")──▶│                     │
  │                    │ (lock)              │
  │                    │ pop freeConn        │
  │                    │ (unlock)            │
  ◀────dc────────────  │                     │
  │                    │                     │
  ├──Lock dc────────── │ ────────────────────▶│
  │                    │                     │ exec
  │◀────rows─────────  │ ─────────────────── │
  │                    │                     │
  ├──rows.Close()────  │ ────────────────────▶│
  │                    │ (lock)              │
  │                    │ push freeConn       │
  │                    │ (unlock)            │
```

This is the canonical happy path. The middle file shows the unhappy paths.

---

## Appendix A: Walking Through `sql.Open` In Slow Motion

Let's slow down and follow `sql.Open` to see exactly what it does — and what it doesn't do.

```go
db, err := sql.Open("postgres", "postgres://localhost/test")
```

Step by step:

1. `sql.Open` calls `drivers["postgres"]`. This is a package-level `map[string]driver.Driver` populated at init time by drivers' `sql.Register` calls. If `"postgres"` is not in the map, you get `sql.ErrDriverNotRegistered`.

2. The driver's value (e.g., `&pq.Driver{}`) is wrapped as `dsnConnector{dsn: dsn, driver: driveri}`. This `dsnConnector` is a `driver.Connector` that knows how to dial later.

3. `sql.OpenDB(connector)` is called. It allocates a `*DB`:

```go
db := &DB{
    connector:    connector,
    openerCh:     make(chan struct{}, connectionRequestQueueSize),
    lastPut:      make(map[*driverConn]string),
    connRequests: make(map[uint64]chan connRequest),
    stop:         func() {},  // placeholder
}
db.stop, _ = context.WithCancel(context.Background())  // simplified
go db.connectionOpener(ctx)
return db
```

4. `go db.connectionOpener(ctx)` spawns a goroutine. **This is the first goroutine the pool creates, and it's done before any connection has been opened.** The goroutine sits in a `for range openerCh` loop, waiting to be told to open a conn.

5. `sql.Open` returns.

So after `sql.Open`:
- One `*DB` struct exists.
- One background goroutine (`connectionOpener`) is parked on a channel receive.
- Zero TCP connections to the database exist.
- Zero queries can be run yet, but the pool is ready to dial when one is requested.

The first `db.QueryContext` or `db.PingContext` is what kicks off the real dial — by either popping from `freeConn` (empty), checking `numOpen` (zero), incrementing it, and dialing in the caller's goroutine; or by sending on `openerCh` and waiting for the opener goroutine to dial.

This lazy design is friendly to tests, libraries, and configuration files that may have an invalid DSN that wouldn't matter unless used. But it's also a footgun for production startup: your service can come up "healthy" with a broken DSN, only to fail when the first request arrives.

The fix is universal: call `db.PingContext(ctx)` at startup. The pattern:

```go
func main() {
    db, err := sql.Open("postgres", os.Getenv("DSN"))
    must(err)
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    must(db.PingContext(ctx))

    // now start the HTTP server
}
```

---

## Appendix B: A Walk Through One Full Query Lifecycle

Imagine `db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = $1", 42).Scan(&name)`. Let's narrate every step at the junior level.

```go
1. row := db.QueryRowContext(ctx, sql, args...)
   // This returns *sql.Row WITHOUT yet running the query.
   // *sql.Row holds a closure that will run on .Scan().

2. row.Scan(&name)
   // Now the query runs:
   //   a. db.QueryContext is invoked
   //   b. It calls (*DB).conn(ctx, strategy)
   //         - Locks db.mu
   //         - Iterates freeConn looking for a non-expired conn
   //         - If found: pop, mark inUse, unlock, return dc
   //         - If freeConn empty AND numOpen<maxOpen: increment numOpen, unlock, dial new conn
   //         - If freeConn empty AND numOpen>=maxOpen: register a connRequest channel, unlock, select on it
   //   c. Now holding a *driverConn dc.
   //   d. dc.Lock() (per-conn mutex)
   //   e. Translate args to driver.NamedValue
   //   f. Call dc.ci.QueryContext (driver method)
   //      The driver:
   //        - Writes the query and params over the TCP socket
   //        - Reads the response: row description (column metadata)
   //        - Returns a driver.Rows
   //   g. Wrap driver.Rows in *sql.Rows
   //   h. dc.Unlock() (but conn still marked in-use)
   //   i. Iterate rows.Next() to get the first row (Row knows it's QueryRow)
   //   j. rows.Scan() decodes the row into &name
   //   k. rows.Close() releases the conn:
   //         - dc.Lock(); driver.Rows.Close(); dc.Unlock()
   //         - (*DB).putConn(dc, nil, true):
   //              - db.mu.Lock()
   //              - check connRequests: if any waiters, deliver dc to one
   //              - else: append dc to freeConn (if room)
   //              - else: close dc
   //              - db.mu.Unlock()
```

There are many ways this can branch:
- Driver returns `ErrBadConn`. The pool throws away dc, retries with a fresh conn.
- Ctx is canceled. The pool aborts the wait or the driver call.
- The driver's `QueryContext` errors with a SQL error (syntax, constraint violation). The conn is still good; it goes back to the pool. The error is returned to the caller.

The point of seeing this is to internalize: every `db.Query*` involves *acquisition* (which may wait), *driver call* (which may take a while), and *release* (which may unblock another goroutine). At every step there's a mutex involved.

---

## Appendix C: How `MaxOpenConns` Throttles

The throttle works exactly like a semaphore implemented with a channel and a counter.

If `MaxOpenConns = 10` and 20 goroutines call `db.Query` simultaneously:

1. The first 10 are granted conns (possibly opened on demand).
2. The next 10 enter `(*DB).conn`, find `numOpen == 10`, register a `connRequest`, and wait in a `select`.
3. As each of the first 10 returns its conn via `putConn`, one of the waiters is woken (in arbitrary order — the map iteration order, which is randomized in Go).
4. The woken waiter receives the conn, completes its query, returns it, and the next waiter wakes.

There is no fairness guarantee. Go's map iteration is randomized, so the choice of which waiter to wake is effectively random. This is fine for most workloads but means you can't say "first come first served" — a request waiting 10 ms may unblock before one waiting 1 s.

For workloads where fairness matters (e.g., regulatory), the only path is to build a fair queue in front of the pool yourself.

---

## Appendix D: How `MaxIdleConns` Caps the Pool

When `putConn` returns a conn:

```
if no waiting connRequest:
    if len(freeConn) < MaxIdleConns:
        freeConn = append(freeConn, dc)
    else:
        dc.Close()  // counted as MaxIdleClosed
```

So `MaxIdleConns` is the steady-state size of the idle pool. After a workload subsides, the pool shrinks to (at most) `MaxIdleConns`.

If `MaxIdleConns < MaxOpenConns` and your traffic alternates between bursty (uses many conns) and quiet (uses few), every burst will trigger opening (`MaxOpenConns - MaxIdleConns`) new conns, then closing them at the next quiet period. The closing is silent but the next burst's opens cost handshakes.

For a typical web service with steady traffic, `MaxIdleConns == MaxOpenConns` is the right setting: the pool never closes a conn just because it's idle (it'll still close for age via `ConnMaxLifetime`).

---

## Appendix E: How `ConnMaxLifetime` Rotates Conns

The rotation logic lives in `connectionCleaner`, a goroutine the pool starts when you call `SetConnMaxLifetime(d)` with `d > 0` (or `SetConnMaxIdleTime`).

The cleaner:

```
for {
    sleep(some duration based on the configured limits)
    db.mu.Lock()
    now := time.Now()
    for each dc in freeConn:
        if dc.createdAt + maxLifetime < now:
            close(dc); remove from freeConn; numOpen--; MaxLifetimeClosed++
        else if dc.returnedAt + maxIdleTime < now:
            close(dc); remove from freeConn; numOpen--; MaxIdleTimeClosed++
    db.mu.Unlock()
}
```

What this means:
- A conn that's been *in-use* for the entire `maxLifetime` doesn't get killed mid-query. The cleaner only touches idle conns. When the long-running goroutine returns the conn, `putConn` itself checks the age and closes if expired.
- The cleaner doesn't run continuously; it sleeps and wakes on a timer. So a conn might survive a few seconds past its `maxLifetime` until the cleaner's next tick.

For most apps this is invisible. For apps behind aggressive load balancers (where back-end conns get killed every X seconds), set `ConnMaxLifetime` to slightly less than X so your Go-side conns get retired *before* the LB kills them silently.

---

## Appendix F: The `connectionOpener` Goroutine in Plain English

The opener exists to dial connections asynchronously when the pool needs more capacity. It runs in this loop:

```
for range openerCh:
    if pool needs another conn:
        dial, allocate driverConn, add to freeConn or hand to a waiter
```

Three places send on `openerCh`:

1. **`(*DB).maybeOpenNewConnections`** — called whenever a connRequest is pending and we could grow the pool. It sends up to `(maxOpen - numOpen)` signals.
2. **`(*DB).putConn`** — when a bad conn is discarded, it sends one signal to top up.
3. **`(*DB).connectionCleaner`** — after closing aged-out conns, if there are still pending requests, signal the opener.

So the opener is reactive: it doesn't pre-warm the pool. The first request after `sql.Open` will dial in the caller's goroutine (a special case in `(*DB).conn` when `numOpen < maxOpen`). Subsequent waiters who *cannot* dial themselves (because the cap is reached) are served by the opener when capacity frees up.

In practice, on a steady workload, the opener is mostly idle. It does the work during traffic spikes that exceed the current pool size but not `MaxOpenConns`.

---

## Appendix G: A First Look at `*sql.Tx`

Transactions deserve their own page (in the senior file), but a junior should know the basic shape.

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

tx, err := db.BeginTx(ctx, &sql.TxOptions{
    Isolation: sql.LevelReadCommitted,
    ReadOnly:  false,
})
if err != nil {
    return err
}
defer tx.Rollback()  // safety net

if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal - 100 WHERE id = $1", from); err != nil {
    return err
}
if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal + 100 WHERE id = $1", to); err != nil {
    return err
}

return tx.Commit()
```

What `BeginTx` does:

1. Calls `(*DB).conn` to acquire a `*driverConn`.
2. Holds that conn for the lifetime of the `*sql.Tx`.
3. Sends `BEGIN` (or `BEGIN ISOLATION LEVEL ...`) over that conn.
4. Returns a `*sql.Tx` that wraps the conn.

Every `tx.ExecContext` or `tx.QueryContext` routes through the pinned conn. `tx.Commit()` sends `COMMIT`; `tx.Rollback()` sends `ROLLBACK`. Either way, the conn returns to the pool.

The deferred `tx.Rollback()` is critical. Without it, if your function returns before `tx.Commit()` (e.g., on error), the tx leaks — the conn stays pinned to a transaction that the database server still considers open. Eventually it times out server-side, but in the meantime that conn is *gone from your pool*.

After `Commit` or `Rollback`, calling any method on `tx` returns `sql.ErrTxDone`. So the deferred `Rollback` after a successful `Commit` is harmless.

---

## Appendix H: A First Look at `*sql.Stmt`

Prepared statements are an optimization. Instead of sending the full SQL each time, you send it once (the *prepare* step), and then each *exec* just sends parameter values.

```go
stmt, err := db.PrepareContext(ctx, "SELECT name FROM users WHERE id = $1")
if err != nil {
    return err
}
defer stmt.Close()

for _, id := range ids {
    var name string
    if err := stmt.QueryRowContext(ctx, id).Scan(&name); err != nil {
        return err
    }
    log.Println(id, name)
}
```

The clever part: `*sql.Stmt` is goroutine-safe, even though `driver.Stmt` is not. The package achieves this by caching one `driver.Stmt` per conn-the-stmt-has-touched, in a slice on `*sql.Stmt`. When `stmt.Query` is called:

1. Acquire a conn from the pool.
2. Look up the conn in the stmt's cache.
3. If found: use the cached `driver.Stmt`.
4. If not found: call `dc.PrepareContext(stmt.query)` to prepare on this conn, cache the result.
5. Execute.
6. Return conn to pool. Driver Stmt stays cached for next time.

When a conn is removed from the pool (lifetime, idletime, bad), its entries in every `*sql.Stmt`'s cache are removed.

**Pitfall:** with a large `MaxOpenConns` and many prepared stmts, the total number of *driver* prepared stmts can grow to `MaxOpenConns × numStmts`. On Postgres each costs memory; on MySQL there's a per-session limit (`max_prepared_stmt_count`).

---

## Appendix I: `db.Conn` and Session Pinning

When you absolutely need successive queries to run on the same backend session, use `db.Conn`:

```go
c, err := db.Conn(ctx)
if err != nil {
    return err
}
defer c.Close()  // returns to pool, does NOT close TCP

if _, err := c.ExecContext(ctx, "CREATE TEMP TABLE tmp AS SELECT * FROM big WHERE region = 'us-east-1'"); err != nil {
    return err
}
if _, err := c.ExecContext(ctx, "SELECT COUNT(*) FROM tmp WHERE active"); err != nil {
    return err
}
// tmp ceases to exist when c is returned to the pool... unless the driver doesn't ResetSession
```

`c.Close()` returns the conn to the pool — it does not close the TCP socket. The pool may then hand the conn to another goroutine. If the driver implements `SessionResetter`, the pool calls `ResetSession` between users, which for Postgres clears temp tables. If not, the next user *might see* the temp table — usually a security/correctness bug.

Modern drivers (pgx, recent versions of `lib/pq`) implement `SessionResetter`. Verify yours does, or wrap your session work in a transaction so temp tables die at commit.

---

## Appendix J: The "Same Goroutine" Rule

A rule that catches many bugs: **only the goroutine that opened a `*sql.Rows`, `*sql.Tx`, or `*sql.Conn` should use it.**

This is not a hard rule enforced by the runtime, but it is a coding discipline that prevents accidental sharing.

Examples of violations:

```go
// VIOLATION: tx used by two goroutines
tx, _ := db.BeginTx(ctx, nil)
go func() {
    tx.Exec("INSERT ...")
}()
tx.Commit()  // race: commit vs insert

// VIOLATION: rows used by two goroutines
rows, _ := db.Query("SELECT ...")
for i := 0; i < 4; i++ {
    go func() { for rows.Next() { ... } }()
}

// VIOLATION: conn used by two goroutines
c, _ := db.Conn(ctx)
go c.ExecContext(ctx, "A")
go c.ExecContext(ctx, "B")
```

All three race. The fixes are: open one rows/tx/conn *per goroutine*, OR have one goroutine iterate and send results to other goroutines via channels.

---

## Appendix K: The Most Common Production Bug

Top of the leaderboard, by my experience and most public Go-database postmortems:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rows, err := db.QueryContext(r.Context(), "SELECT ...")
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    // BUG: no rows.Close()
    var results []Item
    for rows.Next() {
        var it Item
        rows.Scan(&it.A, &it.B)
        results = append(results, it)
    }
    json.NewEncoder(w).Encode(results)
}
```

Under steady traffic this slowly leaks conns out of the pool. The first one or two are not noticeable; by the time you've leaked `MaxOpenConns` of them, your service hangs. Restart fixes it for an hour, then it happens again.

The fix is one line:

```go
defer rows.Close()
```

If you write Go code that touches `database/sql`, train your reflex: **every `db.Query` returns a `rows`; every `rows` needs a `defer rows.Close()`**. Run it as a linter (`rowsclosed`, `sqlrows`, your own). Pair-review it.

---

## Appendix L: What `db.Stats()` Does Internally

Roughly:

```go
func (db *DB) Stats() DBStats {
    db.mu.Lock()
    defer db.mu.Unlock()
    return DBStats{
        MaxOpenConnections: db.maxOpen,
        OpenConnections:    db.numOpen,
        InUse:              db.numOpen - len(db.freeConn),
        Idle:               len(db.freeConn),
        WaitCount:          db.waitCount,
        WaitDuration:       time.Duration(db.waitDuration),
        MaxIdleClosed:      db.maxIdleClosed,
        MaxIdleTimeClosed:  db.maxIdleTimeClosed,
        MaxLifetimeClosed:  db.maxLifetimeClosed,
    }
}
```

It takes the pool's mutex. That's both a feature (snapshot is consistent) and a footgun (calling it from a hot path serializes with `(*DB).conn`).

The right way to use `db.Stats()` in production: a background goroutine samples every 100 ms or every 1 s, stores the result in atomically-updated globals, and the rest of the code reads from those globals. Never call `db.Stats()` per-request.

---

## Appendix M: A Story About Forgetting `defer cancel()`

A common context bug, not strictly database-related but always relevant:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, _ := context.WithTimeout(r.Context(), 5*time.Second)  // BUG
    rows, _ := db.QueryContext(ctx, "...")
    defer rows.Close()
    // ...
}
```

The `_` discards the `cancel` function. That means the timer the context started is never released until it fires (5 seconds later). In a high-qps service, you accumulate thousands of timers, growing memory and CPU.

Fix:
```go
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
```

`go vet` catches this; let it.

---

## Appendix N: Why You Should Always Pass `Context`

Two reasons:

1. **Cancellation.** A user closes their browser; the request ctx cancels; the in-flight `db.QueryContext` is canceled; the conn is freed; resources are saved.
2. **Deadlines.** Without a deadline, a slow query holds a conn forever. With one, the pool gets the conn back at the deadline (driver willing).

The non-ctx variants (`db.Query`, `db.Exec`) exist for backward compatibility. They use `context.Background()` internally — meaning your query has no deadline and no cancellation. In production, this is almost always wrong.

A grep target for code review:

```
git grep -nE 'db\.(Query|Exec|Prepare|Begin)\(' | grep -v Context
```

Every match should be examined.

---

## Appendix O: A Visual Tour of `freeConn` and `connRequests`

`freeConn` is a slice (LIFO is preferred — most recently used conns are warmer in the OS's TCP stack):

```
freeConn = [dc1, dc2, dc3]
              ^
              ^   ^
              ^   ^   ^
       used 5 min ago
                  used 30 s ago
                      used right now
```

`putConn` appends to the end; `(*DB).conn` pops from the end. So the most recently used conn is the next one out — good for cache locality and for keeping a small set of conns hot if traffic doesn't fully use the pool.

`connRequests` is a map. When a goroutine waits, it allocates a 1-buffered channel and adds it to the map:

```
connRequests = {
  uint64(0xabc1): chan connRequest,   // goroutine A waiting
  uint64(0xabc2): chan connRequest,   // goroutine B waiting
  uint64(0xabc3): chan connRequest,   // goroutine C waiting
}
```

When a conn comes back via `putConn`, the pool iterates the map (in some randomized order), picks one entry, sends the conn on its channel, and deletes the entry.

The waiting goroutine in `(*DB).conn` then receives from its channel inside a `select`:

```go
select {
case req := <-myCh:
    if !req.conn.expired(...) { return req.conn, nil }
    // expired: get another
case <-ctx.Done():
    // give up, deregister, return ctx.Err()
}
```

This dual structure (slice for idle, map for waiters) keeps both common operations O(1).

---

## Appendix P: A Mini Glossary of Verbs

| Verb | What it means inside the pool |
|------|-------------------------------|
| `Open` | At pool level: lazily create a `*DB`. At conn level: dial a fresh TCP socket. |
| `Connect` | The driver's verb for "open a new conn" (via `driver.Connector`). |
| `Conn` | At pool level: pop or wait for an idle conn. |
| `PutConn` | Return a conn to the pool (or close it if pool is full/old). |
| `Close` | At pool level: shut down the entire pool. At conn level: close the TCP socket. At rows/tx level: release the conn back to the pool. |
| `Prepare` | At pool level: get a `*sql.Stmt`. At driver level: send PREPARE on a conn. |
| `Exec` / `Query` | At pool level: acquire a conn, run, release. At driver level: send and read. |
| `Begin` | At pool level: acquire a conn and pin it as a Tx. At driver level: send BEGIN. |
| `Commit` / `Rollback` | Send COMMIT/ROLLBACK; release the conn. |
| `Ping` | Acquire a conn, call driver's Ping, release. |

`Close` is overloaded across three levels of abstraction. Always think: "close what?"

---

## Appendix Q: A Note About SQLite

SQLite is a special database for `database/sql` purposes:

- It's embedded (no TCP). The "conn" is just a file handle.
- It serializes writes through a file lock. Two goroutines writing through the same `*sql.DB` *will* contend.
- For SQLite, set `MaxOpenConns(1)` for writes (or use WAL mode and tune carefully).

Many junior tutorials use SQLite for convenience. The pool behavior is non-representative of typical client-server databases. When you learn this material, prefer a containerized Postgres for hands-on work.

---

## Appendix R: A Note About Cloud Databases

Many cloud database services (RDS, Cloud SQL, Aurora, etc.) terminate idle connections after a fixed time (often 10–30 minutes). If your `ConnMaxLifetime` is longer than this, you'll see periodic `ErrBadConn` retries.

Recommended setting:
```go
db.SetConnMaxLifetime(5 * time.Minute)   // shorter than cloud's idle limit
```

Some services also have a `max_connections` budget per cluster. Make sure `instances × MaxOpenConns < cluster_max_connections - 20` (headroom).

---

## Appendix S: A Note About Migrations and Long-Running DDL

`ALTER TABLE ... ADD COLUMN` on Postgres takes a brief lock; on MySQL InnoDB it can take *minutes* on a large table. If you run migrations via the same `*sql.DB` your app is serving from, the migration holds a conn for that whole time, reducing your effective pool capacity.

Best practice: migrations run with a separate `*sql.DB` (or even a separate process) so they can't starve your app.

---

## Appendix T: Tying it All Together — A Recap Story

You're building an order-processing API. Steps:

1. `sql.Open("postgres", os.Getenv("DSN"))` — creates the pool. No dial yet.
2. `db.SetMaxOpenConns(50)` — cap based on `Little's Law × 1.5` for your expected p99.
3. `db.SetMaxIdleConns(50)` — match the open cap; keep them warm.
4. `db.SetConnMaxLifetime(25*time.Minute)` — rotate before your LB kills them.
5. `db.SetConnMaxIdleTime(5*time.Minute)` — reap during quiet hours.
6. `db.PingContext(ctx)` — fail fast if DSN is wrong.
7. Pass `db` to your HTTP handlers via a `Store` struct.
8. Every handler uses `db.QueryContext(r.Context(), ...)`, `defer rows.Close()`, checks `rows.Err()` after the loop, returns appropriate HTTP errors.
9. Background workers use a *separate* `*sql.DB` so they can't starve handlers.
10. Prometheus exporter samples `db.Stats()` every 1 s; Grafana dashboard with the four panels (saturation, wait rate, wait latency, churn).
11. Graceful shutdown: stop accepting requests, drain, then `db.Close()`.

Every numbered step above ties back to something in this file. None of it is exotic; all of it is necessary.

---

## Appendix U: Hand-Trace `db.QueryRow("SELECT 1").Scan(&n)`

A small hand-trace, line by line, to embed the model in muscle memory.

```
db.QueryRow("SELECT 1")
  → returns *sql.Row{db: db, query: "SELECT 1", args: nil, ctx: context.Background()}
  → no DB work yet

row.Scan(&n)
  → row.rowsi == nil so it must run the query:
       db.QueryContext(row.ctx, row.query, row.args...)
  → (*DB).query calls (*DB).conn(ctx, cachedOrNewConn)
       lock db.mu
       len(freeConn) == 0
       numOpen == 0 < maxOpen
       numOpen++
       unlock db.mu
       call db.connector.Connect(ctx) -- the dial
       returns *driverConn dc
  → call (*DB).queryDC(ctx, dc, ...)
       dc.Lock()
       call dc.ci.QueryContext(ctx, "SELECT 1", nil)
       returns driver.Rows
       wrap as *sql.Rows
       dc.Unlock() — but dc still inUse
  → return *sql.Rows
  → row.rowsi = *sql.Rows
  → row.rowsi.Next() — returns true, advances cursor
  → row.rowsi.Scan(&n) — n = 1
  → row.rowsi.Close()
       call driver.Rows.Close()
       call (*DB).releaseConn(dc) → (*DB).putConn(dc, nil, true)
       lock db.mu
       no connRequests
       len(freeConn) < maxIdle
       freeConn = append(freeConn, dc)
       unlock db.mu

n is now 1, conn is in the pool, ready for next call.
```

Read this until it stops being mysterious. Once you can recite this on your own, you've absorbed the junior material.

---

## Appendix V: A Note on the Race Detector

If you use `go test -race` (and you should), the race detector will catch many `database/sql` misuses:

- Two goroutines calling `rows.Next()` on the same `*sql.Rows`.
- Two goroutines using the same `*sql.Tx`.
- A goroutine calling `*sql.Rows` methods after `rows.Close()` returns.
- A goroutine using a `*sql.Conn` after another goroutine closed it.

The detector won't catch:

- Forgetting to call `rows.Close()` (leak, not a race).
- Forgetting to call `tx.Commit()`/`Rollback()` (leak, not a race).
- Forgetting to set `MaxOpenConns` (config issue).

Use the detector in CI; use linters and code review for the rest.

---

## Appendix W: `go vet` and Sql

Standard `go vet` doesn't catch sql-specific bugs (no `rows.Close` checks, no ctx-less calls). Third-party linters that do:

- `staticcheck` — checks many things, including some SQL patterns.
- `sqlrows` — specifically for `rows.Close` and `rows.Err` checks.
- `rowserrcheck` — same idea, different implementation.

Add these to your CI. Catching even one production-blocking conn leak per quarter pays for the tool's setup.

---

## Appendix X: A Cheat Sheet for `defer` Patterns

| Resource | Pattern | Notes |
|----------|---------|-------|
| `*sql.Rows` | `defer rows.Close()` after err check | idempotent |
| `*sql.Tx` | `defer tx.Rollback()` before any returns | no-op after Commit |
| `*sql.Conn` | `defer c.Close()` | returns to pool |
| `*sql.Stmt` | `defer stmt.Close()` | usually long-lived, not always deferred |
| `*sql.DB` | `defer db.Close()` at `main()` | program lifetime |
| `context.Context` | `defer cancel()` | from `WithTimeout`/`WithCancel` |

Always pair the constructor with the destructor *immediately*, before any code that could panic or return.

---

## Appendix Y: Frequently Asked Questions

**Q. Should I `sql.Open` in `init()`?**
A. No. `init()` runs before `main()`, before flags are parsed, before env vars are read. Do it in `main()` (or a constructor `New*()`).

**Q. Should I have one `*sql.DB` or one per package?**
A. One per database. Pass it down via dependency injection or a global if you must.

**Q. What if I have two databases (Postgres + MySQL)?**
A. Two `*sql.DB`s, one each.

**Q. What if I have a primary + read replica?**
A. Two `*sql.DB`s, one each. Route reads to the replica.

**Q. Can `*sql.DB` be a `sync.Pool`?**
A. No, completely different. `sync.Pool` is for short-lived objects to reduce GC. `*sql.DB` is for long-lived TCP conns.

**Q. What's the easiest mock for tests?**
A. `github.com/DATA-DOG/go-sqlmock`. It's a fake driver. For integration tests, spin up a real Postgres in a Docker container.

**Q. Should I close `*sql.DB` between tests?**
A. Yes if each test uses its own. No if a top-level `TestMain` owns it.

**Q. Why does my IDE complain `rows.Close()` is unreachable?**
A. Because of an `if err != nil { return }` between `db.Query` and `defer rows.Close()`. If err is non-nil, rows is nil, so closing it would panic. The IDE is right but the issue is order — defer must be after the err check.

**Q. How does pool size relate to goroutine count?**
A. They're independent. You can have 1,000 goroutines and `MaxOpenConns=10`; the extra goroutines just queue.

**Q. Why is my `WaitDuration` huge but my queries are fast?**
A. `WaitDuration` is cumulative over the program's lifetime. Divide by `WaitCount` for average per wait. Or use `rate(...)` in Prometheus.

**Q. Can I use `*sql.DB` from a finalizer?**
A. No. Finalizers should be free of synchronization. Use a separate cleanup goroutine.

---

## Appendix Z: One More Cheat Sheet — Symptoms and Causes

| Symptom | Likely cause |
|---------|--------------|
| `db.Stats().InUse` slowly climbing | Conn leak (forgotten `rows.Close` or `tx.Rollback`) |
| `db.Stats().WaitCount` rapidly growing | Pool too small for load |
| `pq: too many clients` error | DB's `max_connections` exceeded |
| `EOF` from queries during deploys | Backend killed conns; need `ConnMaxLifetime` |
| `driver: bad connection` on every other query | Conn-rot, IsValid not implemented |
| `Context deadline exceeded` from `db.Query` | Pool wait or slow query exceeding ctx |
| `sql: database is closed` | `db.Close()` called too early in shutdown |
| `sql.ErrTxDone` | Using `*sql.Tx` after Commit/Rollback |
| `sql.ErrNoRows` from `QueryRow` | No matching row (often expected) |
| Process growing in memory under load | Defers piling up, or rows not closed |

When you see any of these in logs or dashboards, scan this table first.

---

## Appendix AA: Three Production-Grade Snippets to Copy

### 1. Healthcheck handler

```go
func healthz(db *sql.DB) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
        defer cancel()
        if err := db.PingContext(ctx); err != nil {
            http.Error(w, "db: "+err.Error(), http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    })
}
```

### 2. Standardized query helper

```go
func QueryAll[T any](ctx context.Context, db *sql.DB, q string, scan func(*sql.Rows) (T, error), args ...any) ([]T, error) {
    rows, err := db.QueryContext(ctx, q, args...)
    if err != nil {
        return nil, fmt.Errorf("query: %w", err)
    }
    defer rows.Close()
    var out []T
    for rows.Next() {
        v, err := scan(rows)
        if err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        out = append(out, v)
    }
    return out, rows.Err()
}
```

Usage:
```go
users, err := QueryAll(ctx, db, "SELECT id, name FROM users", func(r *sql.Rows) (User, error) {
    var u User
    return u, r.Scan(&u.ID, &u.Name)
})
```

### 3. Transaction helper

```go
func WithTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) (err error) {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer func() {
        if p := recover(); p != nil {
            tx.Rollback()
            panic(p)
        }
        if err != nil {
            tx.Rollback()
            return
        }
        err = tx.Commit()
    }()
    err = fn(tx)
    return
}
```

Usage:
```go
err := WithTx(ctx, db, func(tx *sql.Tx) error {
    _, err := tx.Exec("UPDATE ...")
    return err
})
```

---

## Appendix AB: The Junior-to-Middle Bridge

If you read this entire file and the appendices, you should be ready for `middle.md`. The middle file picks up where this one ends:

- We will read `database/sql/sql.go` source line by line.
- We will trace every lock acquisition in `(*DB).conn` and `(*DB).putConn`.
- We will see exactly how `connectionOpener` and `connectionCleaner` are structured.
- We will see how `*sql.Stmt`'s per-conn cache is implemented.

You won't be lost as long as you've internalized:
- `*sql.DB` is a pool, not a conn.
- `freeConn` slice + `connRequests` map + per-conn mutex.
- `MaxOpenConns` is the gate; `MaxIdleConns` is the cap on idle.
- `Lifetime` and `IdleTime` are time-based reapers.
- `Close` on rows/tx/conn returns to the pool; `Close` on `*sql.DB` shuts the whole thing down.
- Always pass `Context`. Always defer-close. Always check `rows.Err()`.

Take a breath. Move on when ready.

---

End of `junior.md`. Onward to `middle.md`.

---

## Appendix AC: One Last Pass at the Mental Model

Imagine `*sql.DB` as a small staffing agency. It has:

- A roster of available workers (`freeConn`).
- A waiting list of jobs (`connRequests`).
- A maximum headcount (`MaxOpenConns`).
- A retirement age (`ConnMaxLifetime`).
- A maximum vacation length (`ConnMaxIdleTime`).
- A recruiter (`connectionOpener`) who hires when there's demand.
- A janitor (`connectionCleaner`) who retires old workers.

Every `db.Query` is a job that needs one worker. If a worker is on the roster, it's assigned immediately. Otherwise the job waits on the list. When a worker finishes, the agency either hands them to the next job in line, or sends them back to the roster, or retires them if they're too old or there are too many on the roster.

You, the customer, just call `db.Query`. The agency manages all the worker logistics.

This image — pool as staffing agency — is enough to reason about most pool behaviors. Keep it in mind through the middle file's lower-level details.

---

## Appendix AD: Reading Stack Traces Involving the Pool

When you `pprof -goroutine` a healthy Go service that uses `database/sql`, you'll see stacks like:

```
goroutine 1234 [select, 5 minutes]:
database/sql.(*DB).conn(0xc0002a8000, 0x129abc0, 0xc000123620, 0x0)
        /usr/local/go/src/database/sql/sql.go:1382 +0x4a8
database/sql.(*DB).query(0xc0002a8000, ...)
        /usr/local/go/src/database/sql/sql.go:1747 +0x76
database/sql.(*DB).QueryContext(0xc0002a8000, ...)
        /usr/local/go/src/database/sql/sql.go:1729 +0xe2
main.(*UserRepo).FindAll(0xc00009c510, ...)
        /app/repo/user.go:47 +0xa6
main.(*UserHandler).List(0xc0001bc060, ...)
        /app/http/handler.go:123 +0xf3
...
```

Interpretation: this goroutine is blocked in `(*DB).conn` at line 1382 (the `select` waiting on a `connRequest` channel and ctx). Five-minute wait suggests pool exhaustion.

Common stack-trace shapes to know:

| Frame in stack | What it means |
|----------------|---------------|
| `*DB).conn` blocked on `select` | Waiting for a conn from the pool |
| `*DB).queryDC` then driver Query | Active driver query (real work) |
| `*Rows).Next` blocked on network read | Driver reading the next row |
| `*Rows).Close` | Returning the conn |
| `*DB).putConn` | Conn being returned (briefly) |
| `*Tx).awaitDone` parked | Tx ctx-watcher goroutine, normal |
| `*DB).connectionOpener` parked | Opener idle, normal |
| `*DB).connectionCleaner` parked | Cleaner idle, normal |

When debugging, look for many copies of the same `*DB).conn` frame — that's queueing.

---

## Appendix AE: A Long Worked Example — A Simple URL Shortener

Let's design a tiny app end-to-end and show where every `database/sql` decision matters.

### Schema (Postgres)

```sql
CREATE TABLE links (
    code TEXT PRIMARY KEY,
    url  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_links_created ON links(created_at);
```

### Repository

```go
type LinkRepo struct {
    db *sql.DB
}

func NewLinkRepo(db *sql.DB) *LinkRepo {
    return &LinkRepo{db: db}
}

func (r *LinkRepo) Create(ctx context.Context, code, url string) error {
    _, err := r.db.ExecContext(ctx,
        "INSERT INTO links(code, url) VALUES ($1, $2)", code, url)
    return err
}

func (r *LinkRepo) Lookup(ctx context.Context, code string) (string, error) {
    var url string
    err := r.db.QueryRowContext(ctx,
        "SELECT url FROM links WHERE code = $1", code).Scan(&url)
    if err == sql.ErrNoRows {
        return "", ErrNotFound
    }
    return url, err
}

func (r *LinkRepo) Recent(ctx context.Context, limit int) ([]Link, error) {
    rows, err := r.db.QueryContext(ctx,
        "SELECT code, url, created_at FROM links ORDER BY created_at DESC LIMIT $1", limit)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var out []Link
    for rows.Next() {
        var l Link
        if err := rows.Scan(&l.Code, &l.URL, &l.CreatedAt); err != nil {
            return nil, err
        }
        out = append(out, l)
    }
    return out, rows.Err()
}
```

### Wiring

```go
func main() {
    dsn := os.Getenv("DSN")
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(25)
    db.SetConnMaxLifetime(30 * time.Minute)
    db.SetConnMaxIdleTime(5 * time.Minute)

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := db.PingContext(ctx); err != nil {
        log.Fatal(err)
    }

    repo := NewLinkRepo(db)
    mux := http.NewServeMux()
    mux.Handle("/", &LinkHandler{repo: repo})
    mux.Handle("/healthz", healthz(db))

    srv := &http.Server{Addr: ":8080", Handler: mux}
    log.Fatal(srv.ListenAndServe())
}
```

### Handler

```go
type LinkHandler struct{ repo *LinkRepo }

func (h *LinkHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()

    code := strings.TrimPrefix(r.URL.Path, "/")
    if code == "" {
        http.NotFound(w, r)
        return
    }
    url, err := h.repo.Lookup(ctx, code)
    if err == ErrNotFound {
        http.NotFound(w, r)
        return
    }
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    http.Redirect(w, r, url, http.StatusFound)
}
```

### What's happening, pool-wise

- One `*sql.DB`, 25 conns, 25 idle.
- Each request acquires one conn, runs one query, returns it. ~5 ms p99 query, so steady state at 5000 qps would need ~25 conns — at the edge.
- At higher load, requests queue in `(*DB).conn`, increasing latency until ctx timeout fires at 2 s.
- `db.PingContext` at startup ensures wrong DSN crashes the binary immediately.
- `/healthz` keeps the LB happy without holding conns long.

### What we *didn't* do (and why)

- No transactions: each query is independent.
- No `*sql.Stmt`: the query is small and the driver's own statement cache (pgx caches prepared stmts internally) does the job.
- No `*sql.Conn`: we don't need session affinity.
- No background goroutines: stateless service.
- No metrics: ok for a demo; in production we'd add the DBStats exporter.

This is a paint-by-numbers production-ready app. Every piece you saw maps to a concept covered above.

---

## Appendix AF: A Hands-On Diagnostic Exercise

Suppose you `kubectl exec` into a running service and want to know if the pool is sick. Run:

```bash
# in your service, expose pprof
curl -s http://localhost:8080/debug/pprof/goroutine?debug=2 \
  | grep -c 'database/sql'
```

If the count is much higher than `MaxOpenConns`, you probably have goroutines queued in `(*DB).conn`. Then:

```bash
curl -s http://localhost:8080/metrics | grep -E '^db_'
```

If `db_in_use == db_max_open_connections`, pool is saturated.

```bash
curl -s http://localhost:8080/debug/pprof/goroutine?debug=2 \
  | grep -A 5 'database/sql.(\*DB).conn' \
  | grep -E '^\s*main\.' \
  | sort | uniq -c | sort -rn | head
```

This shows which user handler is queueing for conns. From there, look at the handler's SQL.

---

## Appendix AG: Differences Between Drivers You Should Know

While `database/sql` is generic, drivers behave differently in important ways.

### `github.com/lib/pq` (legacy Postgres)
- Mature, widely deployed.
- Does not implement `Validator` (so a dead conn leaks until the next failed query).
- Slower than pgx for high-throughput workloads.
- Set `sslmode` explicitly.

### `github.com/jackc/pgx/v5/stdlib` (pgx as database/sql driver)
- Modern Postgres driver.
- Implements `Validator`, `SessionResetter`, `NamedValueChecker`.
- ~30% faster than `lib/pq` on hot paths.
- Recommended for new code.

### `github.com/go-sql-driver/mysql`
- The de facto MySQL driver.
- Implements `ResetSession` (sends `RESET CONNECTION`).
- Configure `parseTime=true` to make `time.Time` work natively.
- Watch out for the implicit `interpolateParams` flag.

### `modernc.org/sqlite` and `mattn/go-sqlite3`
- Embedded SQLite. The conn is a file handle, not a TCP socket.
- For writes, set `MaxOpenConns(1)` or use WAL mode.

### `github.com/microsoft/go-mssqldb`
- For SQL Server.
- Distinct named-parameter syntax (`@p1`).

### `github.com/mattn/go-oci8`
- Oracle. Requires C dependencies. Less mainstream in Go.

You don't need to know every driver, but you should know which one your project uses and check its interface implementations.

---

## Appendix AH: When the Pool Becomes the Bottleneck

A signal: if you've sized `MaxOpenConns` correctly and `db.Stats().WaitDuration` is large per wait (e.g., > 50 ms) but your queries are individually fast (e.g., 1 ms), something is hogging the pool. The culprits, in order of frequency:

1. **A transaction that's running for too long.** Look at `pg_stat_activity` for `state = 'idle in transaction'` rows.
2. **A long-running query in another goroutine.** `state = 'active'` for many seconds.
3. **A leaked `*sql.Rows`.** No DB-side symptom; only Go-side. Take a goroutine dump.
4. **Network latency.** Each query's round-trip is fast individually but adds up.

For all four, the fix path is different. Pool size is rarely the right answer when wait duration is high relative to query duration — you should fix the underlying hog instead.

---

## Appendix AI: A Quiz on `defer`

Without running, predict what each prints. Then verify.

### Quiz 1
```go
func main() {
    db, _ := sql.Open("sqlite", ":memory:")
    db.SetMaxOpenConns(2)
    for i := 0; i < 4; i++ {
        rows, _ := db.Query("SELECT 1")
        defer rows.Close()
    }
    fmt.Println(db.Stats().InUse)
}
```
What does it print before `main` returns?

**Answer:** 4 (all four `rows.Close` are deferred, none have fired yet, so 4 conns are pinned by 4 rows). After `main` returns and defers fire, the program exits. With `MaxOpenConns=2` and 4 rows trying to hold conns, the 3rd `db.Query` blocks forever (deadlock).

Lesson: `defer rows.Close()` inside a loop is buggy.

### Quiz 2
```go
func main() {
    db, _ := sql.Open("postgres", dsn)
    db.SetMaxOpenConns(1)
    tx, _ := db.Begin()
    defer tx.Rollback()

    rows, _ := db.Query("SELECT 1")  // BUG?
    defer rows.Close()
    rows.Next()
}
```
Does it run?

**Answer:** No. `tx` holds the one conn; `db.Query` waits for it. With `context.Background()`, it waits forever — deadlock.

Lesson: with a small pool, don't intersperse Tx and DB calls; everything inside the tx scope should go via the tx.

---

## Appendix AJ: Patterns That Look Right But Aren't

### Anti-pattern 1: "Health check that opens"

```go
func healthz(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn)  // BAD: opens a new pool every request
    defer db.Close()
    db.Ping()
    w.WriteHeader(200)
}
```

Every request creates a new `*sql.DB`, dials, closes. Drains your DB's `max_connections` and is slow. Use the long-lived `*sql.DB`:

```go
func healthz(db *sql.DB) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if err := db.PingContext(r.Context()); err != nil {
            w.WriteHeader(503); return
        }
        w.WriteHeader(200)
    })
}
```

### Anti-pattern 2: "Defer commit, defer rollback"

```go
tx, _ := db.Begin()
defer tx.Commit()    // BAD
defer tx.Rollback()  // BAD
```

Both run on return. Whichever runs first wins; the other returns `ErrTxDone`. You probably wanted the commit conditional on success:

```go
tx, _ := db.Begin()
defer tx.Rollback()
// do work; on success, explicit:
if err := tx.Commit(); err != nil { return err }
```

### Anti-pattern 3: "Wrap every query in a Tx"

```go
func find(ctx context.Context, id int) (User, error) {
    tx, _ := db.BeginTx(ctx, nil)  // BAD: unnecessary
    defer tx.Rollback()
    var u User
    err := tx.QueryRowContext(ctx, "SELECT ... WHERE id=$1", id).Scan(&u.ID, &u.Name)
    if err != nil { return u, err }
    tx.Commit()
    return u, nil
}
```

A single read query doesn't need a transaction. The Tx adds two extra round-trips (`BEGIN`, `COMMIT`) and pins a conn. Just `db.QueryRowContext`.

### Anti-pattern 4: "Tx + db calls in the same function"

```go
tx, _ := db.Begin()
defer tx.Rollback()
tx.Exec("UPDATE ...")
db.Exec("INSERT INTO log ...")  // BAD: bypasses tx
tx.Commit()
```

The `db.Exec` runs on a *different* conn (a separate one from the pool), outside the transaction. If the tx rolls back, the log insert still happens — partial inconsistency. Always route everything through `tx`.

---

## Appendix AK: A Diagnostic Checklist

When DB calls in your service are slow or failing, work down this list in order:

1. **Is the DB itself up?** `psql -c 'SELECT 1'` from a sidecar. If no, that's your problem; not Go.
2. **Are you `Ping`-ing at startup?** If no, you might have a stale DSN. Add `db.PingContext`.
3. **What does `db.Stats()` say?**
   - `InUse == MaxOpenConns` constantly → pool saturated.
   - `WaitCount` growing rapidly → queueing.
   - `MaxLifetimeClosed` huge → conns rotating excessively (lower `ConnMaxLifetime`).
4. **Goroutine dump.** `pprof -goroutine`. Are many goroutines parked in `(*DB).conn` (queueing) or in driver code (slow queries)?
5. **DB-side activity.** `pg_stat_activity` (Postgres), `SHOW PROCESSLIST` (MySQL). Long-running queries? Idle-in-tx? Lock waits?
6. **Network latency.** `traceroute` or `mtr` from app to DB. Sudden RTT spike?
7. **DB CPU/IO/RAM.** Cloud console or `top` on the DB host.
8. **Recent deploys.** A new query without an index? A new endpoint with a long-running tx?

Most production incidents resolve at step 3 or 4. Steps 5–8 are the remainder.

---

## Appendix AL: How the Pool Survives a DB Restart

Scenario: DB rolling restart. Each conn dies. What happens in Go?

1. **Existing in-use conns** running queries get `EOF` from the network. The driver returns this as a normal error or as `ErrBadConn`. If `ErrBadConn`, the pool discards the conn, decrements `numOpen`, and the calling goroutine may retry once on a fresh conn.

2. **Existing idle conns** in `freeConn` are still in the slice. The pool doesn't know they're dead until it tries to hand one out. The next user-side `db.Query` will discover this and trigger an `ErrBadConn` retry.

3. **For drivers with `Validator`**, the `IsValid()` method checks each conn just before reuse. Dead conns are silently discarded.

4. **The opener**, when asked to dial, will fail until the new DB instance accepts connections. The goroutine waiting on a `connRequest` channel sees the error propagated.

End state: after a few seconds, all dead conns have been discarded; new ones are dialed; service resumes.

Without `Validator`, the brief window of failures (~1 second) is user-visible. With it, the failures are absorbed inside the pool.

---

## Appendix AM: Why Not Just Spawn Goroutines per DB Call?

A naive question: instead of pooling, why not just use a goroutine per query — Go's lightweight goroutines should be cheap, right?

The issue isn't goroutines; it's the *conns* (heavyweight TCP sockets). Each goroutine that wants to talk to the DB needs a conn. If you have 1000 goroutines all wanting to query simultaneously, you'd need 1000 conns — way more than the DB can support.

The pool exists precisely to *bound* the number of conns. The number of goroutines can be huge; the number of conns must be small.

Think of it as: goroutines are basically free; conns are scarce. The pool gates the scarce resource.

---

## Appendix AN: Mental Models for Senior Material

Before reading the senior file, try to answer:

1. If `MaxOpenConns=100`, a query takes 50 ms, and you have 5000 qps, will the pool be sufficient?
   - Little's Law: concurrency = 5000 × 0.05 = 250. Pool is undersized.

2. If you set `ConnMaxLifetime=10s` and your DB does ~3 ms handshake, how much overhead per query?
   - Each conn rotates every 10 s. At p100 query rate, you handshake every 10 s per conn. With 100 conns, that's 10 handshakes/sec × 3 ms = 30 ms/sec overhead — negligible. Lower `ConnMaxLifetime` further and it grows.

3. A goroutine holds a `*sql.Conn` for 30 seconds. With `MaxOpenConns=10`, what happens?
   - Effective pool size for everyone else is 9. Workload-dependent whether that's OK.

If those answered easily, you're ready.

---

## Appendix AO: A Few Words About the Driver Ecosystem

The `database/sql/driver` package defines interfaces; drivers implement them. The drivers themselves are a separate ecosystem on GitHub. Notable:

- Postgres: `lib/pq`, `pgx` (recommended).
- MySQL: `go-sql-driver/mysql`.
- SQLite: `mattn/go-sqlite3` (CGO), `modernc.org/sqlite` (pure Go).
- MSSQL: `microsoft/go-mssqldb`.
- Snowflake: `snowflakedb/gosnowflake`.
- BigQuery: not via `database/sql`; use Google Cloud SDK.
- DynamoDB: not via `database/sql`; use AWS SDK.

The `database/sql` package only works for SQL databases that support standard semantics. NoSQL stores have their own clients.

---

## Appendix AP: A Note About `sql.Null*` Types

For columns that can be NULL, you can't scan into a `string` or `int64` directly — that would error. Use `sql.NullString`, `sql.NullInt64`, etc.:

```go
var name sql.NullString
err := row.Scan(&name)
if name.Valid {
    use(name.String)
} else {
    // was NULL
}
```

Or use pointer types (`*string`) — many drivers support that and it's often more ergonomic.

For Go 1.22+, generics-friendly types like `sql.Null[T]` are being explored.

---

## Appendix AQ: One Final Story About Pool Sizing

A team I worked with had `MaxOpenConns=200`, four instances, behind a Postgres with `max_connections=300`. After deploy, all instances hit ~50 in-use conns. Then a daily batch job ran, opening 100 more conns just from that one instance. The total backend conns exceeded 300; new conns failed; Postgres logs filled with errors.

Diagnosis:
- 4 × 50 = 200 conns for serving traffic (fine).
- 4 × ? = ? for batch job (was supposed to be small).
- Postgres at 300 limit.

Fix:
- The batch job had its own `*sql.DB` with `MaxOpenConns=10`. Total batch usage: 4 × 10 = 40. New peak: 240, under the limit.

Lesson: think of `instances × MaxOpenConns` as the total DB-side budget, not per-instance. Sum every `*sql.DB` you have in every instance.

---

## Appendix AR: One Last Glossary, Reversed

Test yourself. Given the definition, can you name the term?

1. ___ — The maximum count of simultaneously-checked-out conns. → `MaxOpenConns`.
2. ___ — The cap on idle conns kept between uses. → `MaxIdleConns`.
3. ___ — A conn's age limit. → `ConnMaxLifetime`.
4. ___ — A conn's max idle duration. → `ConnMaxIdleTime`.
5. ___ — A snapshot of pool counters. → `DBStats`.
6. ___ — Sentinel error for "no matching row." → `sql.ErrNoRows`.
7. ___ — Error for "tx already finished." → `sql.ErrTxDone`.
8. ___ — Driver-returned sentinel for "this conn is unusable." → `driver.ErrBadConn`.
9. ___ — Background goroutine that dials new conns on demand. → `connectionOpener`.
10. ___ — Background goroutine that closes aged-out conns. → `connectionCleaner`.

If all ten flowed easily, you've mastered the junior vocabulary.

---

## Appendix AS: Final Pass — Read These Source Lines

Open `$GOROOT/src/database/sql/sql.go` and find:

- Line 430 — `type DB struct`. Look at the fields.
- Line 467 — `type driverConn struct`. Note the locks.
- Line 1330 — `(*DB).conn`. The acquisition logic.
- Line 1450 — `(*DB).putConn`. The release logic.
- Line 1190 — `(*DB).connectionOpener`.
- Line 1080 — `(*DB).connectionCleaner`.
- Line 2880 — `(*Stmt).QueryContext`. Notice the per-conn cache lookup.

Don't try to understand every line. Just *see* the structures. The middle file will walk them in depth.

---

## Appendix AT: One More Cheat Sheet

A compressed all-of-it-in-one-place reference:

```
                            *sql.DB
                              │
                              ▼
                      ┌───────────────┐
                      │  db.mu (Mutex) │
                      │                │
                      │  freeConn[]    │  <- LIFO of idle conns
                      │  connRequests{}│  <- map of waiters
                      │  numOpen       │
                      │  maxOpen       │
                      │  maxIdle       │
                      │  maxLifetime   │
                      │  maxIdleTime   │
                      └───────────────┘
                              │
                              │ spawned by sql.OpenDB:
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
          connectionOpener          (started later, optionally)
          (reads openerCh)          connectionCleaner
                                    (timer-driven)


       (*DB).conn(ctx,...) flow:
         lock db.mu
         try freeConn[end]
           hit? unlock, return
           miss? check numOpen < maxOpen
             yes: numOpen++, unlock, dial
             no:  register connRequests[id], unlock, select on ch or ctx


       (*DB).putConn(dc) flow:
         lock db.mu
         if bad: close dc, numOpen--, signal opener
         if any connRequests: deliver to one, delete from map
         elif len(freeConn) < maxIdle: append
         else: close dc, MaxIdleClosed++
         unlock
```

Internalize this diagram. Once it's in your head, the middle file just adds the line numbers.

---

## Appendix AU: A Closing Word

You've now read more about a connection pool than most working Go programmers ever will. The reward isn't in trivia (though you have it now); it's in the production calmness of knowing what `*sql.DB` is, what it isn't, and how it fails.

When you next see a Slack alert about "DB connection errors," you'll know to look at `db.Stats().WaitCount`, then the goroutine dump, then `pg_stat_activity`. You'll know that `defer rows.Close()` is non-negotiable. You'll know that the *first* tuning you reach for is `MaxOpenConns`.

The deeper files build on this. Go read them.

---

End of `junior.md`.


