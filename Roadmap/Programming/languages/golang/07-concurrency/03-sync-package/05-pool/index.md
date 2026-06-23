---
layout: default
title: sync.Pool
parent: Sync Package
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/05-pool/
---

# sync.Pool

[← Back](../)

`sync.Pool` is a free-list for short-lived temporary objects, designed to relieve garbage-collector pressure on hot allocation paths. A `Pool` lets you reuse a `*bytes.Buffer`, a `*gzip.Writer`, a JSON encoder, or any other object whose construction cost outweighs the cost of borrowing it for a single request. Two methods do the work: `Get()` pulls an object from the pool (or calls `New` if the pool is empty), and `Put()` returns the object once you are done.

The catch is that `sync.Pool` is not a general-purpose pool. The runtime is permitted to evict every item on any garbage-collection cycle (the **victim cache** softens that since Go 1.13, but does not remove it). That makes `sync.Pool` perfect for buffers and encoders, and absolutely wrong for database connections, file handles, or anything whose construction has side effects you cannot afford to repeat. This subsection walks from "what does `Get` return?" to the lock-free per-P internals, victim-cache behaviour across GC cycles, the generic wrapper that arrived with Go 1.18, and the benchmark methodology you need to prove that pooling actually helps.

## Sub-pages

- [junior.md](junior.md) — First contact: `Get`, `Put`, `New`, the bytes.Buffer pattern, why pooling is not caching
- [middle.md](middle.md) — Reset discipline, escape analysis, generic pool wrappers, pitfalls in HTTP handlers
- [senior.md](senior.md) — Per-P local pools, the steal path, victim cache, when not to use `sync.Pool`
- [professional.md](professional.md) — Internals: `poolLocal`, `poolDequeue`, victim cache, runtime hooks, atomics
- [specification.md](specification.md) — Formal API contract, memory model, GC interaction, references
- [interview.md](interview.md) — Interview questions from junior to staff level
- [tasks.md](tasks.md) — Hands-on exercises: buffer pools, encoder pools, generic wrappers, benchmarking
- [find-bug.md](find-bug.md) — Bug hunts: forgotten Reset, captured pointers, type assertions, copied Pool
- [optimize.md](optimize.md) — Optimization exercises: measuring `-benchmem`, sizing, when pooling backfires
