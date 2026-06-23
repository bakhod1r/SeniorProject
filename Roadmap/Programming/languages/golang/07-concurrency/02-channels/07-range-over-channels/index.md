---
layout: default
title: Range Over Channels
parent: Channels
grand_parent: Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/07-range-over-channels/
---

# Range Over Channels

[← Back](../)

`for v := range ch` is Go's idiomatic way to consume every value a channel produces, from now until the channel is closed and drained. It compiles down to the same primitive — a two-value receive — that you would write by hand, but in one line, with no off-by-one mistakes and no forgotten `break`. It is the canonical consumer side of every producer/consumer, fan-in, and pipeline stage in idiomatic Go. It is also the most common source of leaks for beginners: a `range` over a channel that no one closes will block forever.

## Sub-pages

- [junior.md](junior.md) — Syntax, semantics, why `for range` stops, and the leak it causes when no one closes the channel
- [middle.md](middle.md) — Producer/consumer pattern, fan-in/fan-out, draining on shutdown, and combining with `select`
- [senior.md](senior.md) — Pipeline architecture, ownership rules, range vs select, and Go 1.23 range-over-func comparison
- [professional.md](professional.md) — Compiler lowering: how `for v := range ch` rewrites to `chanrecv2`, runtime call sequencing, and codegen
- [specification.md](specification.md) — Go spec excerpts on `for ... range` over channels and runtime semantics
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises with producer/consumer, pipelines, and graceful shutdown
- [find-bug.md](find-bug.md) — Bug-finding exercises: deadlocks, leaks, infinite loops, broken pipelines
- [optimize.md](optimize.md) — Optimization exercises for range-loop overhead, batching, and back-pressure
