---
layout: default
title: database/sql Connection Pool
parent: Concurrency in Stdlib
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: true
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/02-database-sql-pool/
---

# database/sql Connection Pool

The Go standard library's `database/sql` package implements a generic, driver-agnostic SQL client. The whole package is built around a single observation: opening a TCP connection to a database and negotiating its handshake is expensive (often 1–10 ms), and most SQL workloads are short queries that complete in microseconds. Therefore the package keeps a *pool* of already-open `driver.Conn` objects inside `*sql.DB`, hands them out on demand to whichever goroutine calls `DB.Query` or `DB.Exec`, and returns them to the pool when the goroutine is done. Every concurrency primitive you can think of shows up: a mutex (`DB.mu`) protecting the pool slice, a buffered channel (`openerCh`) used as a signaling semaphore, a per-request channel (`connRequest`) used as a goroutine park slot, two long-lived background goroutines (`connectionOpener`, `connectionCleaner`), a per-connection mutex (`driverConn.Lock`) enforcing the driver's single-threaded contract, and a small fleet of context-cancellation goroutines spawned per query.

This subsection walks the pool implementation end to end against the actual `database/sql/sql.go` source. Every claim has a file:line citation. By the end you should be able to read `(*DB).conn`, `(*DB).putConn`, `(*DB).connectionOpener`, and `(*DB).connectionCleaner` line by line and explain every goroutine launched, every channel send, every lock acquired, and the exact happens-before edge that lets a connection move safely from the pool into a query goroutine and back.

## Sub-pages

- [junior.md](junior.md) — What a connection pool is, why DB clients need one, basic `sql.DB` usage, why `sql.DB` is goroutine-safe by design, the difference between `*sql.DB` and `*sql.Conn`
- [middle.md](middle.md) — Source walk of `database/sql/sql.go`: `(*DB).conn`, `(*DB).putConn`, `(*DB).connectionOpener`, `(*DB).connectionCleaner`, with file:line references; how `freeConn`, `connRequests`, and `numOpen` cooperate
- [senior.md](senior.md) — Pool tuning under load, full `sql.DBStats` analysis, transaction pinning costs, `ConnMaxLifetime` vs `ConnMaxIdleTime`, prepared statement caching across connections, deep look at race bugs with `*sql.Rows`
- [professional.md](professional.md) — Production diagnosis: pool starvation incidents, slow-query → all-conns-blocked patterns, instrumenting wait time, designing per-route connection caps, multi-tenant pool sharding
- [specification.md](specification.md) — Normative excerpts: `database/sql` package docs, `database/sql/driver` interface contracts (single-thread guarantee, `Open`, `Close`, `ExecContext`, `QueryContext`), Go memory model implications for pooled state, SQL standard transaction isolation references
- [interview.md](interview.md) — 30+ interview questions from junior to staff with model answers
- [tasks.md](tasks.md) — Hands-on exercises: measure pool wait, induce starvation, fix it, instrument `DBStats` to Prometheus
- [find-bug.md](find-bug.md) — 8–10 snippets with `database/sql` concurrency bugs (leaked `Rows`, concurrent `Rows.Next`, context misuse, transaction misuse) with fixes
- [optimize.md](optimize.md) — Tuning scenarios: pool size for a given workload, `ConnMaxLifetime` behind a load balancer, prepared statement caching, before/after benchmarks
