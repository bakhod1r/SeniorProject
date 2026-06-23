---
layout: default
title: Cancellation Propagation
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/
---

# Cancellation Propagation Across Pipeline Stages

[← Back](../)

In a real Go pipeline, cancellation is not an afterthought — it is the load-bearing wall. Every stage must know how to stop, every downstream channel must drain or unblock, and every deadline must travel from the request boundary to the deepest goroutine. This subsection covers context propagation, the done-channel pattern, fan-out cancellation, deadline propagation, and the difference between upstream and downstream cancellation flow.

## Sub-pages

- [junior.md](junior.md) — Context basics, done channels, and stopping a single stage cleanly
- [middle.md](middle.md) — Wiring `context.Context` through multi-stage pipelines, deadline propagation, and cancel-on-error
- [senior.md](senior.md) — Architecture of cancellation: upstream vs downstream flow, fan-out cancellation, drain semantics, supervisor design
- [professional.md](professional.md) — Internals: how `context` is implemented, cancellation latency under load, race-free shutdown protocols, large-scale incident lessons
- [specification.md](specification.md) — Formal contracts for context propagation and channel-close semantics in Go pipelines
- [interview.md](interview.md) — Cancellation interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for writing cancellable pipeline stages
- [find-bug.md](find-bug.md) — Bug-finding exercises with leaked stages, missed cancels, and deadline drops
- [optimize.md](optimize.md) — Optimization exercises for cancellation latency and graceful shutdown
