---
layout: default
title: Pipeline
parent: Concurrency Patterns
grand_parent: Concurrency
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/03-pipeline/
---

# Pipeline

[← Back](../)

We explore the pipeline pattern: stages of goroutines connected by channels, where each stage reads from its input channel and writes to its output channel. We cover stage signatures, closing channels at the end of each stage, cancellation through `context.Context`, error handling, the done-channel pattern, bounded vs unbounded stages, and how to splice fan-out and fan-in into a pipeline.

## Sub-pages

- [junior.md](junior.md) — First three-stage pipeline, why each stage is a goroutine, who closes what
- [middle.md](middle.md) — Generic stage signatures, cancellation through ctx, composable pipelines
- [senior.md](senior.md) — Buffer sizing, backpressure between stages, splitting and joining stages
- [professional.md](professional.md) — Production ETL, image-processing pipeline, log enrichment, streaming aggregation
- [specification.md](specification.md) — Formal contract of a stage, ordering guarantees, channel close protocol
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for building, fusing, and shutting down pipelines
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken pipeline code
- [optimize.md](optimize.md) — Stage parallelism, fused trivial stages, object reuse, fast shutdown
