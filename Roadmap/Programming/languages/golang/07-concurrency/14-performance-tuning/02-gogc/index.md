---
layout: default
title: GOGC and GOMEMLIMIT
parent: Performance Tuning
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/14-performance-tuning/02-gogc/
---

# GOGC and GOMEMLIMIT

[← Back](../)

Concurrent Go programs share two scarce things: CPU and memory. The garbage collector spends one to save the other, and the two knobs that control that trade-off are `GOGC` and `GOMEMLIMIT`. `GOGC` decides *when* the next collection starts as a percentage of the previous live heap. `GOMEMLIMIT`, added in Go 1.19, sets a soft ceiling that the runtime tries not to cross — pulling collections forward (and burning CPU) as memory grows. Together they let you steer the same binary toward latency, throughput, or memory frugality without touching the code.

This section covers the mental model, the actual GC algorithm (concurrent mark with short stop-the-world phases), `gctrace=1` output reading, `runtime/debug.SetGCPercent` and `SetMemoryLimit`, how allocation patterns and `sync.Pool` feed back into GC pressure, and the everyday job of tuning Go services running in containers with hard memory limits.

## Sub-pages

- [junior.md](junior.md) — What `GOGC` and `GOMEMLIMIT` do, defaults, when to change them
- [middle.md](middle.md) — Reading `gctrace`, GC phases, runtime knobs, container sizing
- [senior.md](senior.md) — Concurrent mark internals, GC assist, `sync.Pool` interaction, allocator pressure
- [professional.md](professional.md) — The 2022 GOGC redesign paper, soft-limit math, pathological tuning patterns
- [specification.md](specification.md) — Runtime environment variables, MemStats fields, debug API
- [interview.md](interview.md) — Questions on GOGC/GOMEMLIMIT trade-offs and GC behaviour
- [tasks.md](tasks.md) — Exercises tuning real workloads with different GOGC and GOMEMLIMIT values
- [find-bug.md](find-bug.md) — Common GC misconfigurations and how they surface in production
- [optimize.md](optimize.md) — Real tuning exercises: throughput, latency, container memory
