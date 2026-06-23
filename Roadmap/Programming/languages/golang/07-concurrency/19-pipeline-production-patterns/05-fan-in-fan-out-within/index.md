---
layout: default
title: Fan-In Fan-Out Within
parent: Pipeline Production Patterns
grand_parent: Go
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/
---

# Fan-In / Fan-Out Inside a Pipeline

[← Back](../)

Fan-out splits one stream of work across N parallel workers. Fan-in merges the N output streams back into one. Inside a real pipeline both shapes happen at the same time, often nested, and they must coordinate with backpressure, context cancellation, ordering, and partial failure. This subsection explores n-way merges, ordered merges, dynamic stages with `reflect.Select`, and how each of those primitives interacts with channel capacity and shutdown.

## Sub-pages

- [junior.md](junior.md) — What fan-in and fan-out are, the simplest two-channel merge, and the first hazards
- [middle.md](middle.md) — Production-shaped merge functions, ordered merge, worker pools that fan in, and backpressure
- [senior.md](senior.md) — Architecture: stage composition, partial failure, weighted fan-out, n-way merges, leak prevention
- [professional.md](professional.md) — Under the hood: `reflect.Select` cost, runtime select internals, scheduling and latency analysis
- [specification.md](specification.md) — Formal contract: invariants, ordering guarantees, completion semantics
- [interview.md](interview.md) — Interview questions and model answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building fan-out and fan-in stages
- [find-bug.md](find-bug.md) — Bug-finding exercises with leaks, deadlocks, and wrong-ordering merges
- [optimize.md](optimize.md) — Optimization exercises for throughput, latency, and scheduler load
