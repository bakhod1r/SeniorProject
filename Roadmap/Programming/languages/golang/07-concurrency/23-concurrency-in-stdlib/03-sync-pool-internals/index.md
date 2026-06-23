---
layout: default
title: sync.Pool Internals
parent: Concurrency in Stdlib
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: true
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/
---

# sync.Pool Internals

[← Back](../)

`sync.Pool` is one of the most quietly important types in the Go standard library. It is the cache the `fmt` package uses to avoid allocating a fresh `pp` buffer on every `Printf`; it is what `encoding/json` uses to recycle encoder state; it is what `net/http` uses to keep request and response objects out of the garbage collector's hot path. Yet it is also one of the most misunderstood — programmers reach for it to "speed things up" and find their benchmarks unchanged, or they hand-roll their own pool with `sync.Mutex` and a `[]T` and discover, under load, that contention dominates everything.

The reason `sync.Pool` is fast is not that it is clever about allocation. It is fast because it is *per-P*: each goroutine accessing the pool talks first to a slot that belongs to its current `P` (the runtime's representation of a logical processor), with no atomics required for the fast path. Only when that slot is empty does the pool reach into a lock-free queue of `poolDequeue` ring buffers, and only when *that* is empty does it try to steal from another `P`. The GC then sweeps the whole structure once per cycle, but — since Go 1.13 — through a two-generation **victim cache** scheme that prevents a sudden allocation cliff after every collection.

This subsection walks the implementation in `src/sync/pool.go` from the user-facing `Get`/`Put` calls down to the packed-head/tail CAS in `poolDequeue`, the cleanup hook in `runtime/mgc.go`, and the false-sharing pad bytes that make the whole thing fit cleanly into cache lines. By the end you should be able to read the source, explain why each field exists, and decide — with numbers, not gut feel — when `sync.Pool` is the right tool and when it is actively harmful.

## Sub-pages

- [junior.md](junior.md) — What sync.Pool is, when (and when not) to use it, the basic `Get`/`Put` API, `New`, common patterns like `bytes.Buffer` pools and `json.Encoder` pools
- [middle.md](middle.md) — `src/sync/pool.go` walk-through: `poolLocal`, `pin`/`unpin`, `getSlow`, `pinSlow`, GC hook, the two-generation victim cache, what runs on which P
- [senior.md](senior.md) — `poolChain` and `poolChainElt` lock-free linked list, `poolDequeue` packed head/tail CAS, single-producer/multi-consumer ring algorithm, stealing, memory ordering, false sharing pads
- [professional.md](professional.md) — Production tuning: pprof of pool churn, when to size the underlying objects, custom pool variants, comparing to fastcache/bytebufferpool/freelist, NUMA considerations
- [specification.md](specification.md) — Verbatim excerpts from `sync.Pool` godoc, the design proposal that introduced the 2-cache victim scheme (CL 166961 / issue 22950), runtime cleanup hook contract
- [interview.md](interview.md) — 30+ interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on benchmarks, GC drain observation, multi-P stealing stress tests
- [find-bug.md](find-bug.md) — Snippets where pooled objects are mis-reset, references are retained, or the pool is used where it actively hurts performance
- [optimize.md](optimize.md) — Concrete scenarios where pooling helps, where it does not, and how to measure the difference
