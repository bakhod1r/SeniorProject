---
layout: default
title: Runtime Goroutine Management
parent: Goroutines
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/04-runtime-management/
---

# Runtime Goroutine Management

[Back](../)

The Go runtime exposes a small but consequential set of APIs through the `runtime`, `runtime/debug`, `runtime/pprof`, `runtime/trace`, and `runtime/metrics` packages. These APIs let you inspect the live goroutine population, tune scheduler parallelism, pin work to OS threads, capture stack traces, label goroutines for profiling, and control GC behaviour that indirectly drives scheduling. None of them are required for a working Go program, but every production codebase eventually touches several of them. This subsection groups the APIs by purpose so you know which knob to reach for, when to leave them alone, and which ones are traps disguised as tools.

## Sub-pages

- [junior.md](junior.md) — The visible APIs, what each one does, simple examples, and the few you should reach for first
- [middle.md](middle.md) — Practical use of `GOMAXPROCS`, stack/thread caps, GC tuning, and the debug package in production services
- [senior.md](senior.md) — Profiling and tracing: `pprof.SetGoroutineLabels`, `runtime/trace`, `runtime/metrics`, and how labels propagate
- [professional.md](professional.md) — Internals: where these APIs hook into the runtime, cost models, and the interaction with sysmon, GC, and the scheduler
- [specification.md](specification.md) — Documented guarantees, function signatures, semantics, and version history
- [interview.md](interview.md) — Interview questions about runtime APIs, GC tuning, and profiling
- [tasks.md](tasks.md) — Hands-on exercises for each major API group
- [find-bug.md](find-bug.md) — Buggy uses of `LockOSThread`, finalizers, `Gosched`, `GOMAXPROCS`, and GC tuning
- [optimize.md](optimize.md) — Tune GC, parallelism, and stack limits to hit a target metric
