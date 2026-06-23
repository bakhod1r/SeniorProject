---
layout: default
title: Backpressure
parent: Production Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/
---

# Backpressure

[← Back](../)

Backpressure is the discipline of letting a slow consumer push back on a fast producer instead of silently absorbing work it cannot finish. In Go this shows up as bounded channels, blocking sends, semaphore-based admission, queue-based load shedding, and AIMD rate adjustment — all so that the system bends under load instead of collapsing. Without backpressure, queues grow without bound, memory inflates, p99 latency explodes, and the process eventually dies of OOM or watchdog timeout.

## Sub-pages

- [junior.md](junior.md) — Bounded channels, blocking sends, the unbounded-queue antipattern, and the first taste of backpressure
- [middle.md](middle.md) — Semaphores, worker pools, load shedding, timeouts on sends, and propagating pressure through pipelines
- [senior.md](senior.md) — Architecture: AIMD, token buckets, admission control, cross-service backpressure, and observability hooks
- [professional.md](professional.md) — Distributed backpressure, gRPC flow control, Kafka consumer lag, queue theory, Little's law, and Netflix concurrency-limits
- [specification.md](specification.md) — Formal model of channels as bounded queues, runtime semantics of blocking sends, and select-with-default
- [interview.md](interview.md) — 30–40 interview questions on backpressure from junior to staff
- [tasks.md](tasks.md) — 15–20 hands-on exercises for building backpressure-aware pipelines
- [find-bug.md](find-bug.md) — 10–12 buggy snippets where backpressure is missing, wrong, or counter-productive
- [optimize.md](optimize.md) — 8–10 scenarios where the right backpressure strategy fixes a latency or memory problem
