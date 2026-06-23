---
layout: default
title: Fan-Out
parent: Concurrency Patterns
grand_parent: Concurrency
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/02-fan-out/
---

# Fan-Out

[← Back](../)

We explore the fan-out pattern: distributing work from one input channel to N worker goroutines that read concurrently. We cover static vs dynamic worker counts, combining fan-out with fan-in, load balancing semantics, error propagation with `errgroup`, pool sizing for IO-bound vs CPU-bound work, and how fan-out differs from a worker pool.

## Sub-pages

- [junior.md](junior.md) — First fan-out, what "N workers reading one channel" means, basic shutdown
- [middle.md](middle.md) — Fan-out + fan-in combined, errgroup, cancellation across workers
- [senior.md](senior.md) — Pool sizing, backpressure, saturation, IO vs CPU tuning
- [professional.md](professional.md) — Parallel HTTP clients, batch image processing, work-stealing alternative
- [specification.md](specification.md) — Channel select fairness, scheduling guarantees, contract of distribution
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for fan-out workers, errgroup, dynamic resizing
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken worker code
- [optimize.md](optimize.md) — Worker count tuning, batch dispatch, reducing select churn
