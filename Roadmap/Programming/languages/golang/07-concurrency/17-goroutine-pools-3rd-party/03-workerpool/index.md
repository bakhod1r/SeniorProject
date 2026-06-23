---
layout: default
title: Index
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/
---

# gammazero/workerpool

[← Back](../)

`github.com/gammazero/workerpool` is a small, idiomatic Go library that gives you a fixed-size worker pool with an unbounded task queue. It is the simplest of the three popular third-party pools (alongside `panjf2000/ants` and `Jeffail/tunny`): no generics, no result futures, no fancy scaling — just `New(maxWorkers)`, `Submit(func())`, and `Stop()`. Workers spin up on demand up to the configured cap, an internal dispatch goroutine multiplexes submitted tasks onto them, and idle workers are reaped after a short timeout so the pool shrinks back to zero when the work stops.

The appeal of `workerpool` is what it is *not*: it is not a generic framework, it does not try to be the fastest, and it does not surface a thousand tuning knobs. It is roughly 300 lines of well-tested Go that solves one problem — "bound the concurrent worker count, but accept tasks without blocking" — and gets out of the way. The price you pay for that simplicity is a per-task channel send and the danger of an unbounded internal queue. This chapter walks the API, the dispatch loop, the production trade-offs, and the lines where you should reach for `ants` or `tunny` instead.

## Sub-pages

- [junior.md](junior.md) — `workerpool.New`, `Submit`, `Stop`, your first pool, the most common starter mistakes
- [middle.md](middle.md) — `SubmitWait`, `Stopped`, `StopWait`, idle-worker timeout, panic recovery, queue depth
- [senior.md](senior.md) — Internals: the dispatcher goroutine, idle-worker reaper, why submit never blocks, comparison with custom pool designs
- [professional.md](professional.md) — Production: matching pool size to workload type, observability, context integration, draining, real-world incidents
- [specification.md](specification.md) — API reference, semantic notes, semver history, breaking-change log
- [interview.md](interview.md) — 30+ interview questions on `workerpool` and pool design in general
- [tasks.md](tasks.md) — Hands-on exercises for `Submit`, `SubmitWait`, draining, bounded variants
- [find-bug.md](find-bug.md) — Bug snippets: leaked pools, panics that crash the dispatcher, captured loop variables, missing `StopWait`
- [optimize.md](optimize.md) — Optimisation scenarios: eliminate per-task channel sends, batch work, replace unbounded queues, escape pool overhead

## Where this fits in the third-party pool landscape

| Library | Strength | Weakness | When to pick |
|---------|----------|----------|--------------|
| `gammazero/workerpool` | Simplest API, unbounded queue absorbs spikes | Per-task channel overhead, queue can grow without bound | "I just want N workers without writing a goroutine pool by hand" |
| `panjf2000/ants` | Highest throughput, generic Pool/PoolWithFunc, reuse stats | Larger API, behaviour configurable in many ways | High-RPS services, tight memory budgets, generic task functions |
| `Jeffail/tunny` | Request/response style with worker state | One in-flight job per worker, blocks on submit | Stateful workers (CGo handles, ML models), bounded concurrency |
| Hand-rolled `chan func()` + `N goroutines` | Zero dependencies, full control | You write and debug it yourself | Embedded in a library you ship, or extreme performance | 

After this chapter you will know exactly which row to pick for a given workload, and how to spot the moment when `workerpool`'s unbounded queue becomes a production liability rather than a convenience.
