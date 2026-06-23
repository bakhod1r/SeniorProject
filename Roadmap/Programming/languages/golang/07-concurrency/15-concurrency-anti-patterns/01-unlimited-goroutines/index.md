---
layout: default
title: Unlimited Goroutines
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/
---

# Unlimited Goroutines

[← Back](../)

The most common — and most dangerous — concurrency mistake in Go production code is the *unbounded fan-out*: `for _, x := range input { go process(x) }`. Each iteration spawns a goroutine; the size of `input` decides how many. When `input` is small and trusted, it works. When `input` is large, untrusted, or grows under load, the program quietly turns itself into a denial-of-service weapon pointed at its own host: memory exhaustion, downstream overload, dropped connections, and ultimately OOM-killer. This subsection dissects the pattern, the incidents it causes, the cures (worker pool, semaphore, `errgroup.SetLimit`), and the playbook for refactoring an existing codebase that is full of it.

## Sub-pages

- [junior.md](junior.md) — What the anti-pattern looks like, why "just `go`" feels right, the DoS framing, first cures
- [middle.md](middle.md) — Worker pool, semaphore, and `errgroup.SetLimit` in production, sizing the limit, backpressure
- [senior.md](senior.md) — Architecture-level bounds: admission control, queue depth budgets, multi-tier limits, capacity planning
- [professional.md](professional.md) — Scheduler effects, P/M saturation, memory-allocator pressure, runtime-level signals
- [specification.md](specification.md) — What Go guarantees (and does not) about unbounded spawn; runtime limits; `GOMAXPROCS` interactions
- [interview.md](interview.md) — Questions and answers from "what is wrong with this code" to "design a bounded ingestion pipeline"
- [tasks.md](tasks.md) — Hands-on exercises: turn unbounded loops into bounded pools, measure improvements
- [find-bug.md](find-bug.md) — Twenty-plus broken programs across the unbounded-spawn family
- [optimize.md](optimize.md) — Optimization exercises: capacity tuning, allocation reduction, batched dispatch
