---
layout: default
title: Fan-In
parent: Concurrency Patterns
grand_parent: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/01-fan-in/
---

# Fan-In

[← Back](../)

We explore the fan-in pattern: merging values from N input channels into a single output channel using goroutines and `sync.WaitGroup`. We cover classic merge, generic merge with Go 1.18+ generics, cancellation propagation, `reflect.Select` for dynamic N, ordering tradeoffs, backpressure across producers, and correct closing of the output channel.

## Sub-pages

- [junior.md](junior.md) — First merge function, why we need WaitGroup, when to close the output channel
- [middle.md](middle.md) — Generic fan-in, cancellation, comparison with `select`-based merging
- [senior.md](senior.md) — Ordering, backpressure, dynamic N with `reflect.Select`, memory model implications
- [professional.md](professional.md) — Production fan-in: log aggregation, sensor merge, multi-source feed pipelines
- [specification.md](specification.md) — Formal contract of fan-in, happens-before edges, channel close semantics
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for writing, fixing, and tuning merges
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken fan-in code
- [optimize.md](optimize.md) — Bounded fan-in, buffer sizing, reducing per-message goroutine cost
