---
layout: default
title: Concurrent Counters
parent: Concurrent Data Structures
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/
---

# Concurrent Counters

[← Back](../)

A "counter" looks like the most trivial concurrent primitive — a single integer being incremented from many goroutines. In practice it is one of the richest topics in concurrent programming. A naive `atomic.Int64.Add(1)` can become the single hottest cache line in your entire process, dragging throughput from millions of ops/sec to hundreds of thousands as core count grows. Solving this leads through false sharing and cache-line padding, sharded counters, "sloppy" per-CPU counters, Java's `LongAdder` analog in Go, HDR histograms for tail-latency observability, and Go's standard `expvar` package for exposing them to operators.

## Sub-pages

- [junior.md](junior.md) — Why `count++` is broken under concurrency, `sync.Mutex`, and the first taste of `sync/atomic`
- [middle.md](middle.md) — `atomic.Int64`/`Uint64`, CompareAndSwap loops, monotonic vs gauge counters, and the basic shard pattern
- [senior.md](senior.md) — False sharing, cache-line padding, sharded counters by goroutine ID, sloppy counters, and `LongAdder`-style designs
- [professional.md](professional.md) — Per-CPU counters via runtime hooks, HDR histograms, `expvar` integration, NUMA, and percentile-preserving merging
- [specification.md](specification.md) — Formal memory-model guarantees of `sync/atomic`, alignment rules, and `expvar` API contract
- [interview.md](interview.md) — Interview questions from junior through staff/principal level
- [tasks.md](tasks.md) — Hands-on exercises: build sharded counter, padded counter, HDR-histogram-backed metric
- [find-bug.md](find-bug.md) — Bug-hunting exercises: missing atomics, alignment crashes, false sharing, broken merges
- [optimize.md](optimize.md) — Optimization exercises: turn a slow shared counter into a sharded one, benchmark cache-line padding

## Why this matters

Counters are everywhere in concurrent Go code. Almost every service has them. Yet they remain one of the most misunderstood primitives — engineers ship `count++` and only learn it was wrong after the race detector or a confused operator finds the silent off-by-N error. This subsection covers counters from the most basic "why is my count wrong?" up through cache-line-aware sharded designs, HDR histograms, NUMA-aware placement, and the full observability subsystem architecture that production-grade services rely on.

## Quick navigation by skill level

- **Brand new to atomics** → start with junior.md
- **Comfortable with atomic.Int64, want CAS and `expvar`** → middle.md
- **Counter shows up in your profile** → senior.md
- **Designing a metrics subsystem** → professional.md
- **Studying for interview** → interview.md
- **Looking for hands-on practice** → tasks.md
- **Bug hunting practice** → find-bug.md
- **Optimization practice** → optimize.md
- **Need the formal contract** → specification.md

## Key learning outcomes

After this subsection, you can:

- Diagnose any concurrent-counter bug
- Choose the right counter primitive for any contention regime
- Build a sharded, padded, per-P or sloppy counter as appropriate
- Integrate counters with `expvar`, Prometheus, and OpenTelemetry
- Design alerts and dashboards driven by counter outputs
- Operate counter-based observability subsystems at production scale

## The recurring lessons

Throughout the ten files in this subsection, the same lessons appear repeatedly:

1. **`count++` is three operations**, not one. Always atomic if there are concurrent writers.
2. **`atomic.Int64`** (Go 1.19+) is the modern, type-safe API. Prefer it in new code.
3. **`-race` is mandatory** for any code with shared state. Run it in tests, CI, every PR.
4. **Cache lines matter** at high contention. 64-byte alignment on most platforms; 128 on Apple Silicon and POWER.
5. **Sharding scales contention** but introduces read cost. Power-of-2 sizes for fast modulo.
6. **Per-P shards eliminate** cross-core contention entirely when runtime cooperation is acceptable.
7. **Sloppy counters trade freshness** for ultimate throughput. Lossy on crash.
8. **HDR histograms record in constant time** and provide bounded relative error. The right tool for latency.
9. **Don't average percentiles** across processes — sum bucket counts, then quantile.
10. **Cardinality is the silent killer** of metric backends. Always bound.
11. **Counters drive alerts** which drive incident response. Name with care, document units.
12. **The right counter is the simplest one that works** — don't optimize prematurely.

## Estimated reading time

- index.md: 5 minutes
- junior.md: 60 minutes
- middle.md: 90 minutes
- senior.md: 120 minutes
- professional.md: 150 minutes
- specification.md: 20 minutes
- interview.md: 30 minutes
- tasks.md: depends on practice depth
- find-bug.md: 30 minutes
- optimize.md: 30 minutes

Total: about 10 hours for thorough reading, plus practice time.

## Recommended reading order

1. junior.md (full)
2. tasks.md J-section, do at least J1-J5
3. middle.md (full)
4. tasks.md M-section, do at least M1-M3
5. specification.md (skim; refer back as needed)
6. senior.md (full, may need re-reads)
7. tasks.md S-section, do at least S1-S3
8. professional.md (full)
9. tasks.md P-section as career allows
10. find-bug.md and optimize.md as periodic refreshers
11. interview.md before any interview involving Go concurrency
