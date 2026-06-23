---
layout: default
title: False Sharing Overview
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/overview/
---

# False Sharing

[← Back](../)

False sharing is the silent performance killer of multi-core Go programs. Two CPU cores update two *logically independent* variables, but those variables happen to live on the same 64-byte cache line — so every write ping-pongs the line between cores through the cache-coherence protocol, turning a lock-free path into a serialised one. Programs that look "embarrassingly parallel" end up no faster — sometimes slower — than the single-threaded version. The Go runtime fights this with explicit padding inside `sync.Mutex`, `sync.Pool`, and the scheduler's per-P structures; `runtime/internal/sys.CacheLinePad` is the canonical 64-byte filler. This subsection covers what false sharing is, how to spot it with `perf`, `pprof`, and microbenchmarks, and how to fix it with padding, sharding, and array-of-structs layouts.

## Sub-pages

- [junior.md](junior.md) — What a cache line is, why two unrelated variables can contend, and the first padded counter
- [middle.md](middle.md) — Per-CPU sharded counters, `sync.Pool` shards, real-world benchmark patterns
- [senior.md](senior.md) — Designing concurrent data structures with cache-line awareness, NUMA effects, MESI states
- [professional.md](professional.md) — Reading runtime/internal/sys padding, perf c2c, pprof hardware counters, microarchitecture deep-dive
- [specification.md](specification.md) — What the Go memory model says (and does not say) about cache lines, hardware references, runtime/internal/sys
- [interview.md](interview.md) — Interview questions from junior to staff level on false sharing
- [tasks.md](tasks.md) — Hands-on exercises to reproduce and fix false sharing
- [find-bug.md](find-bug.md) — Snippets containing real false-sharing bugs; locate, explain, fix
- [optimize.md](optimize.md) — Optimization recipes for padded counters, sharded maps, and per-P state
