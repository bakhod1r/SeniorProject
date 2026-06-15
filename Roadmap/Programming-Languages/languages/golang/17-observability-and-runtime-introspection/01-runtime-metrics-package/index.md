---
layout: default
title: The runtime/metrics Package
parent: Observability & Runtime Introspection
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/17-observability-and-runtime-introspection/01-runtime-metrics-package/
---

# The runtime/metrics Package

[← Back](../)

We explore `runtime/metrics`, the stable, self-describing successor to `runtime.MemStats` and `debug.GCStats`. Metrics are named by slash-paths (`/gc/heap/allocs:bytes`, `/sched/goroutines:goroutines`, `/sched/latencies:seconds`), discovered at runtime via `metrics.All()`, and sampled in one batch with `metrics.Read` — without stopping the world the way `ReadMemStats` does.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of metric names, `All`, `Read`, and reading a histogram
- [middle.md](middle.md) — The API in depth, metric families, MemStats mapping, forward-compatibility
- [senior.md](senior.md) — Sampling cost, Prometheus export, cardinality, version skew
- [professional.md](professional.md) — Internals, value kinds, histogram semantics, collector design
- [specification.md](specification.md) — Formal reference, kinds, naming grammar, stability policy
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken metric-reading code
- [optimize.md](optimize.md) — Sampling, allocation, and export optimizations
