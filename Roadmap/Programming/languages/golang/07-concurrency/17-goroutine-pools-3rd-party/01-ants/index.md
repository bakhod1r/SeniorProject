---
layout: default
title: Index
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/
---

# panjf2000/ants — Goroutine Pool

[← Back](../)

`ants` is a high-performance goroutine pool for Go, written by Andy Pan (`panjf2000`). The library reuses a fixed (or dynamically resized) set of long-lived worker goroutines instead of spawning a fresh goroutine for every task. The goal is to cap concurrent work, recycle stacks, reduce scheduler pressure, and keep memory usage predictable under spikes.

Most Go programs do not need a goroutine pool — Go's runtime is engineered so that "one goroutine per request" is the default answer. But once a service starts to drown in goroutines (millions per second of short tasks, fan-out fan-in jobs, websocket back-pressure, database fan-out, file scanning), the cost of `go f()` becomes visible: stack churn, GC pressure on `g` structs, scheduler contention, OOM under burst. `ants` is the most popular library that solves this in Go — currently 13k+ stars, used in production at Tencent, Bytedance, and many open-source projects (`gnet`, `triton-go`, etc.).

The library went through two major versions:

- **v1** (`github.com/panjf2000/ants`) — the original API: `Pool`, `Submit(func())`, `PoolWithFunc`, `Invoke(arg)`. Still maintained for backwards compatibility but no longer the recommended import path.
- **v2** (`github.com/panjf2000/ants/v2`) — what every modern project should use. Adds functional options (`Option` / `WithXxx`), `MultiPool` for sharding, ergonomic `Tune`, configurable expiration, panic handler, blocking vs non-blocking submit, and a generics-friendly `PoolWithFunc[T]` in newer releases.

This subsection covers `v2` in depth, from "what is a goroutine pool" to "how the worker stack and lock-free path work inside the source."

## Sub-pages

- [junior.md](junior.md) — Why a goroutine pool exists, the `ants.NewPool` + `Submit` workflow, capacity, `Release`, and small first programs.
- [middle.md](middle.md) — `PoolWithFunc`, functional options (`WithExpiryDuration`, `WithPanicHandler`, `WithNonblocking`, `WithMaxBlockingTasks`), `Tune`, and error handling.
- [senior.md](senior.md) — Internals: the worker stack, the lock-free fast path vs the locker fallback, the `goWorker` lifecycle, `sync.Pool` reuse, `MultiPool` sharding and the MGRR (round-robin / least-tasks) strategy.
- [professional.md](professional.md) — Production usage: capacity planning, multi-tenant pools, observability (`Running` / `Free` / `Cap`), integration with `errgroup`, graceful shutdown, and case studies of real services built on `ants`.
- [specification.md](specification.md) — API reference: every public type, option, method, sentinel error (`ErrPoolOverload`, `ErrPoolClosed`, `ErrInvalidPoolSize`, …), and notable v1 → v2 differences.
- [interview.md](interview.md) — 30+ graded interview Q&A covering API surface, internals, and production trade-offs.
- [tasks.md](tasks.md) — 15+ hands-on coding tasks, each with acceptance criteria.
- [find-bug.md](find-bug.md) — 10+ broken snippets — pool leaks, deadlocks on `Submit`, unhandled panics, races on `Tune`.
- [optimize.md](optimize.md) — 8+ optimization scenarios — sizing the pool, batching submits, reducing lock contention, switching from `Pool` to `MultiPool`.

## When to read this subsection

Read this subsection after you are comfortable with:

- Plain goroutines and the `go` keyword (subsection `01-goroutines`).
- `sync.WaitGroup`, `sync.Mutex`, `sync.Pool` (subsection `02-sync-primitives`).
- Channels and `select` (subsection `03-channels` and `04-select`).
- `context.Context` cancellation (subsection `05-context`).
- The intuition behind "one goroutine per request is fine, until it isn't" — see `15-concurrency-anti-patterns` for cases where unbounded goroutines bite you.

If you understand all of the above, `ants` is the next natural step: it shows you what a production-grade, well-tuned goroutine pool looks like, what API choices the library made, and what trade-offs you would have to make if you were ever to write your own.

## At a glance

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(1000)
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 0; i < 10_000; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			_ = i * i
		})
	}
	wg.Wait()
	fmt.Println("running:", pool.Running(), "free:", pool.Free())
}
```

Ten thousand tasks, but never more than a thousand goroutines in flight. That is the elevator pitch.

## Related topics

- `15-concurrency-anti-patterns` — why "spawning a goroutine per event" eventually fails.
- `16-goroutine-pools-stdlib` — implementing a pool from scratch using channels and `sync.WaitGroup`.
- `18-errgroup` — combining `errgroup` with `ants` for cancellation + concurrency limits.
- `19-semaphore` — `golang.org/x/sync/semaphore` as a lighter weight alternative for "limit N concurrent tasks."
