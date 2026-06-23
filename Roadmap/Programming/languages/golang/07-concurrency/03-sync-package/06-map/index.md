---
layout: default
title: sync.Map
parent: Sync Package
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/06-map/
---

# sync.Map

[← Back](../)

`sync.Map` is Go's specialised concurrent map. It exists because the built-in `map` is **not safe** for concurrent use: two goroutines writing to the same map, or one writing while another reads, triggers the runtime's concurrent-map-access detector and aborts the program with `fatal error: concurrent map writes`. The fastest fix is `RWMutex + map[K]V`. The most misunderstood fix is `sync.Map`.

This subsection covers when `sync.Map` actually pays off (read-mostly caches with stable keys, per-goroutine entries), when it loses to a plain mutex-guarded map (balanced read/write workloads, growing key sets, anywhere you need `len`), and the internal trick that powers the fast path: two underlying maps named `read` and `dirty`, plus the `expunged` sentinel for safely deleting entries. We also walk through the Go 1.20 additions — `Swap`, `CompareAndSwap`, `CompareAndDelete` — that finally gave `sync.Map` atomic-style update semantics.

## Sub-pages

- [junior.md](junior.md) — First contact: why ordinary `map` crashes, basic `Load`/`Store`/`Range`, common patterns
- [middle.md](middle.md) — Full API including Go 1.20 additions, `RWMutex+map` vs `sync.Map` decision matrix, benchmarks
- [senior.md](senior.md) — Workload analysis, `singleflight`, generic wrappers, sharded maps, type safety
- [professional.md](professional.md) — Internals: `read`/`dirty` split, `expunged` sentinel, amplification, misses counter, promotion
- [specification.md](specification.md) — Formal API contract, memory model guarantees, references
- [interview.md](interview.md) — Interview questions and answers from junior to staff level
- [tasks.md](tasks.md) — Hands-on exercises: caches, atomic update, sharded maps, generic wrappers
- [find-bug.md](find-bug.md) — Bug hunts: concurrent writes, lost updates, Range misuse, leaked entries
- [optimize.md](optimize.md) — Choosing between `sync.Map`, `RWMutex+map`, sharded maps, and `singleflight`
