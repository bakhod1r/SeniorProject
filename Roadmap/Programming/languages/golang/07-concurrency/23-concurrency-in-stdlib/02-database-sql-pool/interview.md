---
layout: default
title: database/sql Pool — Interview
parent: database/sql Connection Pool
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/interview/
---

# database/sql Connection Pool — Interview Questions

[← Back](../)

> Practice questions from junior to staff. Each has a model answer and follow-up probes.

---

## Junior

### Q1. What is `*sql.DB`?

**Model answer.** `*sql.DB` is a *pool* of database connections, not a single connection. The package docs are explicit: "DB is a database handle representing a pool of zero or more underlying connections. It's safe for concurrent use by multiple goroutines." You construct one with `sql.Open(driverName, dsn)`, share it across your entire application, and let it manage opening, reusing, and closing the underlying `driver.Conn` objects.

**Follow-up.** *How many `*sql.DB` should an HTTP server have?* Usually one per database. It is a long-lived object.

---

### Q2. What does `sql.Open` actually do?

**Model answer.** Almost nothing. It validates the driver name, builds a `*DB`, and returns it. It does NOT open a TCP connection. The first connection is opened lazily — either by the first `Query`/`Exec` or by an explicit `db.PingContext`.

**Follow-up.** *How do you confirm the DSN works at startup?* Call `db.PingContext(ctx)` after `Open`.

---

### Q3. What is `MaxOpenConns`?

**Model answer.** The hard cap on simultaneously checked-out connections. If 100 goroutines try to query at once and `MaxOpenConns=10`, then 10 will hold conns, and the other 90 will block in `(*DB).conn` waiting on a `connRequest` channel.

**Follow-up.** *Default?* Unlimited (0). In production you almost always want to set a value smaller than your database's `max_connections`.

---

### Q4. What is `MaxIdleConns`?

**Model answer.** The cap on connections kept in the `freeConn` slice between uses. Default is 2. When a goroutine returns a conn via `putConn`, if `len(freeConn) >= MaxIdleConns` the conn is closed instead of pooled.

**Follow-up.** *Why is default 2 a problem?* Under bursty load you keep opening and closing conns, costing you the handshake every time. Set `MaxIdleConns == MaxOpenConns` for steady workloads.

---

### Q5. Is `*sql.DB` goroutine-safe?

**Model answer.** Yes. Internally `DB.mu` (a `sync.Mutex`) protects the pool data structures. Every concurrent caller of `db.Query` gets its own `*driverConn` (or blocks until one is available); two goroutines never share the same driver conn at the same time.

---

### Q6. Why must you call `rows.Close()`?

**Model answer.** Until `rows.Close()` (or `rows.Next()` returning false and the rows draining), the goroutine still owns the underlying `*driverConn`. Forgetting to close leaks the conn out of the pool. The pool shrinks by one until the connection is eventually closed by `ConnMaxLifetime` or the GC finalizer.

**Follow-up.** *Does `defer rows.Close()` always help?* Yes — except inside a tight `for { rows := ...; defer rows.Close(); ... }` loop, where defers accumulate until the function returns.

---

### Q7. What's the difference between `*sql.DB` and `*sql.Conn`?

**Model answer.** `*sql.DB` is a pool; each `Query` may use a different underlying conn. `*sql.Conn` is a single conn checked out from the pool with `db.Conn(ctx)`; all queries on it run on the same session. Use `*sql.Conn` for session-state things: temp tables, `SET LOCAL`, advisory locks.

---

### Q8. Can two goroutines call `Query` on the same `*sql.DB` at the same time?

**Model answer.** Yes. They get separate conns (or one blocks waiting). What you *cannot* do is have two goroutines reading from the same `*sql.Rows`, or two goroutines using the same `*sql.Conn` simultaneously, or two goroutines on the same `*sql.Tx`.

---

### Q9. What is a `*sql.Tx`?

**Model answer.** A transaction that pins one conn from `BeginTx` until `Commit` or `Rollback`. The conn cannot be used by anyone else during that time.

**Follow-up.** *What happens if you forget `Commit`/`Rollback`?* The conn is leaked until garbage-collected. If the request handler dies, the conn is stuck for `ConnMaxLifetime` minimum.

---

### Q10. What's the simplest way to leak a conn?

**Model answer.** `rows, _ := db.Query(...)` followed by an early return without `rows.Close()`. Or `tx, _ := db.Begin()` without a deferred rollback.

---

## Middle

### Q11. Walk me through `(*DB).conn` step by step.

**Model answer.** `(*DB).conn(ctx, strategy)` does the following:
1. Take `db.mu`.
2. Check `ctx.Err()`; if non-nil, release and return.
3. Iterate `freeConn`: if `strategy == cachedOrNewConn` and any non-expired conn exists, pop the back, mark `inUse=true`, release `db.mu`, return.
4. If `maxOpen > 0 && numOpen >= maxOpen`: build a `chan connRequest`, add it to `db.connRequests`, release `db.mu`, then `select { case req := <-ch: ...; case <-ctx.Done(): ... }`.
5. Otherwise increment `numOpen`, release `db.mu`, and call `db.connector.Connect(ctx)` to dial a fresh conn.

This is at `database/sql/sql.go:1330`.

---

### Q12. What is the `openerCh` channel?

**Model answer.** `openerCh chan struct{}` (1-buffered) is a signal for the `connectionOpener` goroutine. When `putConn` sees a pending `connRequest` but `numOpen >= maxOpen` is no longer true (because a conn was just closed), it sends on `openerCh`. The opener wakes, calls `openNewConnection`, which itself fulfills the next `connRequest`.

In modern Go (1.16+) the opener mostly handles the "we need more conns because requests are queued" case rather than the path most callers take.

---

### Q13. What is `connRequests`?

**Model answer.** A `map[uint64]chan connRequest` — one entry per goroutine currently parked waiting for a conn. The map key is a monotonic ID; the channel is a 1-buffered slot. When a conn becomes available, `putConnDBLocked` picks an arbitrary entry, sends the conn on its channel, deletes the entry. The blocked goroutine in `(*DB).conn` then unblocks via its `select`.

---

### Q14. What does `(*DB).connectionCleaner` do?

**Model answer.** A long-lived goroutine that periodically scans `freeConn` for conns whose `createdAt + ConnMaxLifetime < now` or whose `returnedAt + ConnMaxIdleTime < now`, closes them, and updates `DBStats.MaxLifetimeClosed` / `MaxIdleTimeClosed`. It uses a `time.Timer` that ticks based on the shortest of the two configured limits. Sleeps when no limits are set.

---

### Q15. Why is there a 1-buffered channel for each `connRequest`?

**Model answer.** So the producer side (`putConnDBLocked`) can deliver a conn even if the consumer hasn't yet entered the `select`. The producer sends, then deletes the map entry while still holding `db.mu`. The consumer either reads from the channel or, if it had been cancelled and missed it, the conn is "lost" from the channel — and the code in `(*DB).conn`'s `ctx.Done()` branch detects this by draining the channel and putting the conn back in the pool.

---

### Q16. Explain the conn-return path.

**Model answer.** `(*DB).putConn(dc, err, resetSession)`:
1. Take `db.mu`.
2. If the conn is bad (`err == driver.ErrBadConn`), call `dc.Close()`, decrement `numOpen`, signal `openerCh`, release lock.
3. If there are pending `connRequests`, pop one and deliver this conn via its channel (so the waiter doesn't go through `freeConn` at all).
4. Else if `len(freeConn) < MaxIdleConns`, append to `freeConn`.
5. Else close the conn.
6. Release lock.

---

### Q17. What's the driver concurrency contract?

**Model answer.** `driver.Conn` and everything derived from it (`driver.Stmt`, `driver.Tx`, `driver.Rows`) are *not* required to be goroutine-safe. The `database/sql` package guarantees serialization via the per-conn `driverConn.Lock()`. A driver author can assume only one goroutine touches their object at a time.

---

### Q18. What's the difference between `ConnMaxLifetime` and `ConnMaxIdleTime`?

**Model answer.** `ConnMaxLifetime` is wall time since the conn was opened — at expiry the conn is closed regardless of whether it has been used in the meantime. `ConnMaxIdleTime` is time since the conn was last returned to the pool — at expiry an idle conn is closed but an active one survives.

**Follow-up.** *Why have both?* Lifetime forces rotation across load balancer changes and DNS updates. Idle time reaps conns that won't be needed again. Common production settings: lifetime 30 m, idle time 5 m.

---

### Q19. What goroutines does `*sql.DB` keep alive?

**Model answer.** Exactly two long-lived ones:
1. `connectionOpener`, started in `(*DB).Open`.
2. `connectionCleaner`, started lazily when `SetConnMaxLifetime` or `SetConnMaxIdleTime` is called with a positive value.

Per-query: a context-watching goroutine may be spawned by some driver paths to abort on `ctx.Done()`.

---

### Q20. What is `(*DB).numOpen`?

**Model answer.** The count of opened-and-not-yet-closed conns, including the ones currently being dialed (`numOpen` is incremented optimistically when `connectionOpener` starts opening one, decremented if the dial fails). Protected by `db.mu`. Compared against `MaxOpenConns` in `(*DB).conn` to decide whether to block.

---

## Senior

### Q21. Explain `sql.DBStats` field by field.

**Model answer.**
- `OpenConnections`: current `numOpen`.
- `InUse`: conns currently checked out by some goroutine.
- `Idle`: `len(freeConn)`.
- `WaitCount`: cumulative count of goroutines that had to wait for a conn.
- `WaitDuration`: cumulative wait time across all goroutines.
- `MaxIdleClosed`: conns closed because `freeConn` was full when returned.
- `MaxIdleTimeClosed`: conns closed by the cleaner due to `ConnMaxIdleTime`.
- `MaxLifetimeClosed`: conns closed by the cleaner due to `ConnMaxLifetime`.

If `WaitCount` is growing rapidly, your pool is undersized. If `MaxIdleClosed` is large, your `MaxIdleConns` is smaller than the working set.

---

### Q22. How do you size `MaxOpenConns`?

**Model answer.** Little's Law: `concurrency = throughput × latency`. If your service does 1000 qps and average query takes 5 ms, steady-state concurrency is 5 conns. Add headroom for tail latency (p99 of 50 ms → ~50 conns) and bursts (×2). Cap at `0.8 × database max_connections / num_instances`.

---

### Q23. How does a transaction pin a connection?

**Model answer.** `(*DB).BeginTx` calls `(*DB).conn` to obtain a `*driverConn`, then stores it on the new `*sql.Tx`. The conn is *not* returned to the pool via `putConn`; instead it stays on the `Tx` until `Commit` or `Rollback` is called, which releases it. During the tx every method (`Exec`, `Query`, `Prepare`) routes through the pinned conn.

---

### Q24. What are the race conditions on `*sql.Rows`?

**Model answer.**
1. Concurrent `Rows.Next()` calls — data race on internal cursor.
2. Calling any `Rows` method after `rows.Close()` — invalid state.
3. Using a `Rows` after closing the parent `*sql.Conn` — undefined.
4. Calling `db.Close()` while another goroutine is reading rows — depends on driver.

Only the goroutine that opened the rows should read them, and only until it closes them.

---

### Q25. What's prepared-statement caching about?

**Model answer.** A `*sql.Stmt` caches one `driver.Stmt` per `*driverConn` it has used (`stmt.css []connStmt`). If the next call to `stmt.QueryContext` gets a conn already in the cache, no re-preparation. If it gets a fresh conn, a new `driver.Stmt` is prepared on that conn and cached. The cache is cleaned when conns are closed.

**Follow-up.** *Pitfall?* With a large pool and many statements you can keep thousands of prepared stmts open server-side. Some databases (older MySQL) limit prepared stmts per session.

---

### Q26. Why might `db.Conn(ctx)` block indefinitely?

**Model answer.** If `MaxOpenConns` is set and every conn is currently in use by long-running queries or open transactions, new requests park on `connRequests`. If `ctx` is `context.Background()` they wait forever.

---

### Q27. What happens to in-flight requests on `db.Close()`?

**Model answer.** `(*DB).Close()` marks the pool closed, closes every conn in `freeConn`, and fulfills every pending `connRequest` with `sql.ErrConnDone`-like errors. Conns currently checked out keep working until their owner returns them (then they get closed immediately). It does *not* abort in-flight queries — the driver must honor ctx cancellation separately.

---

### Q28. How is `driver.ErrBadConn` used?

**Model answer.** When a driver method returns `driver.ErrBadConn`, the sql package interprets it as "this conn is unusable; throw it away." It will then retry the operation on a fresh conn up to `maxBadConnRetries` (currently 2) times. The bad conn is removed from the pool, `numOpen` decremented, `openerCh` signaled.

---

### Q29. What is `(*driverConn).resetSession`?

**Model answer.** Called by `putConn` before the conn re-enters the pool. If the driver implements `driver.SessionResetter`, its `ResetSession(ctx)` is invoked, letting the driver clear server-side session state (Postgres `DISCARD ALL`, MySQL `RESET CONNECTION`). Without `SessionResetter`, server-side state (temp tables, `SET LOCAL`, prepared stmts not in the cache) survives, which can cause cross-request bleed.

---

### Q30. How do you instrument pool wait time per route?

**Model answer.** Capture `db.Stats().WaitDuration` before and after the relevant block, divide by `WaitCount` delta, expose to Prometheus. Per-route is awkward because the pool is global; the closest you can do is record `time.Since(start)` around `db.Query` and attribute most of that to wait when `db.Stats().WaitCount` grows.

---

## Staff

### Q31. Design a pool that supports tenant isolation.

**Model answer.** One `*sql.DB` per tenant is the simplest, but `numTenants × MaxOpenConns` may overflow the database. Alternatives:
- Single pool with per-tenant `chan struct{}` semaphores in front of every `db.Query` call.
- A custom `driver.Connector` that injects tenant ID into the conn (`SET app.tenant = X`).
- An external proxy (PgBouncer in `transaction` mode) doing the multiplexing — your Go pool then sees a fixed small number of "conns" each of which is really a virtual session.

---

### Q32. How would you build a connection-aware circuit breaker?

**Model answer.** Wrap `*sql.DB` so every query goes through a state machine: open / half-open / closed. When `WaitDuration` per query exceeds a threshold or driver errors spike, trip the breaker; subsequent queries fail fast. Use `db.Stats()` polled every second as the input signal; integrate with `sony/gobreaker` or similar.

---

### Q33. Why is calling `db.Query` from inside a long-running goroutine without a deadline a production hazard?

**Model answer.** Three concerns:
1. The goroutine may park in `(*DB).conn` for many minutes if the pool is starved; the rest of the request handler has no way to know how long this will take.
2. If the goroutine is canceled by the caller but uses `context.Background()` to query, it cannot abort; both query and conn are wedged.
3. If a database restart causes every conn to become stale, the query may hang on TCP write/read until OS keepalives fire (minutes by default).

Always pass a context with a deadline.

---

### Q34. Explain how `(*Tx).awaitDone` interacts with pool return.

**Model answer.** When `BeginTx` is called, a goroutine `tx.awaitDone` is spawned that selects on `ctx.Done()` and `tx.done`. If ctx cancels first, it calls `tx.rollback(true)` which in turn calls the driver's `Rollback` and returns the conn to the pool. This is what guarantees ctx cancellation does not leak a transaction conn.

---

### Q35. What's the worst pool-starvation incident you've seen, and how did you debug it?

**Model answer.** Common pattern: a slow query (missing index) takes p99 = 5 s. Under 200 qps, that means ~1000 conns needed steady state, but pool was set to 50. Result: all conns wedged on the slow query, every other query queuing on `connRequests`, request p99 climbs to seconds, eventually circuit breaker trips. Diagnose with: `pg_stat_activity` to find the offending query, `db.Stats().WaitCount` growth rate, goroutine dump to confirm goroutines parked in `(*DB).conn`. Fix: add the index, then reduce p99 query time to bring the working set back under `MaxOpenConns`.

---

### Q36. How would you redesign the pool to support per-conn affinity (e.g., for read-your-writes consistency)?

**Model answer.** Currently `(*DB).conn` is opaque — you can't ask for "the conn I used last." Workarounds:
- `db.Conn(ctx)` to pin a conn for an entire request scope; remember to `Close()` it to return to the pool.
- A second pool just for "follow-up reads," sized to the read concurrency.
- Driver-level routing (Postgres connection pooler that tags transactions for sticky routing).

A redesign of `database/sql` itself would need a goroutine-keyed map and a way to release the affinity, which is invasive enough that it's not in the standard library.

---

### Q37. What memory-model guarantee makes pool reuse safe?

**Model answer.** `db.mu.Unlock()` in `putConn` synchronizes-with `db.mu.Lock()` in the next `(*DB).conn` that picks up the same conn from `freeConn`. By the Go memory model, all writes the previous user made to `dc.ci`-reachable state are visible to the next user. This is why a goroutine returning a conn after, say, writing temp-table rows on Postgres can be sure another goroutine seeing the same conn observes those rows.

---

### Q38. Why is `Validator.IsValid()` important?

**Model answer.** Conns can rot — TCP keepalives may not detect a network blip, the server might drop the conn during a deploy, a load-balancer reconfiguration could redirect. `IsValid()` is called by the pool right before reuse; if it returns false, the conn is discarded. Without it, the next `Query` returns `driver.ErrBadConn` and the user-visible request fails (only to retry on a fresh conn). With it, the discard happens silently before the user sees an error.

---

### Q39. Design Prometheus metrics from `DBStats`.

**Model answer.** Expose:
- `db_open_connections` (gauge) from `OpenConnections`
- `db_in_use` (gauge) from `InUse`
- `db_idle` (gauge) from `Idle`
- `db_wait_count_total` (counter) from `WaitCount`
- `db_wait_duration_seconds_total` (counter) from `WaitDuration`
- `db_closed_total{reason}` (counter) with three children: `max_idle`, `max_idle_time`, `max_lifetime`

Scrape every 10 s, build rate-based dashboards. Alert when `rate(db_wait_count_total) > 5/s` or `db_in_use / db_open_connections == 1` for 5 m.

---

### Q40. Suppose `db.Stats().InUse == MaxOpenConns` continuously. What's wrong?

**Model answer.** Either:
- Long-running queries (look at `pg_stat_activity.state = 'active'` durations).
- Long-running transactions (look at `pg_stat_activity.state = 'idle in transaction'`).
- Goroutines leaking conns (forgot `rows.Close()` or `tx.Rollback()`).

Take a Go goroutine dump (`pprof -goroutine`) and grep for `database/sql.(*DB).queryDC`, `database/sql.(*Rows).Next`, and `database/sql.(*Tx)`; the count tells you how many requests are holding conns and what they're doing.
