---
layout: default
title: Goroutine Lifecycle
parent: Goroutine Lifecycle and Leaks
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/07-goroutine-lifecycle-leaks/01-lifecycle/
---

# Goroutine Lifecycle

[Back](../)

Every goroutine has a beginning, a middle, and an end. The `go` keyword allocates a `g` struct from a free list, hands it to the scheduler as `_Grunnable`, and the runtime carries it through `_Grunning`, `_Gwaiting`, and `_Gsyscall` states before parking it on the dead list as `_Gdead`. Understanding this lifecycle — what causes each transition, how the runtime tracks it, and what your code looks like in `pprof` along the way — is the foundation for the next two sections on leak detection and prevention.

## Sub-pages

- [junior.md](junior.md) — States a goroutine can be in, how it is born and dies, why "it'll exit eventually" is a trap
- [middle.md](middle.md) — Designing for explicit lifecycle, ownership trees, the panic and `Goexit` paths
- [senior.md](senior.md) — Lifecycle in production systems, GC interaction, finalizers, `LockOSThread` consequences
- [professional.md](professional.md) — Runtime internals: `_Grunnable`, `_Grunning`, `_Gwaiting`, `_Gsyscall`, `_Gdead`, the `g` free list
- [specification.md](specification.md) — What the Go specification and `runtime` package guarantee about lifecycle
- [interview.md](interview.md) — Interview questions on goroutine states, exit conditions, and leak diagnosis
- [tasks.md](tasks.md) — Exercises: observe state transitions, force each state, write lifecycle tests
- [find-bug.md](find-bug.md) — Bugged programs where the goroutine lifecycle is wrong; diagnose and fix
- [optimize.md](optimize.md) — Reduce lifecycle overhead: avoid spawn churn, reuse goroutines, shrink waiting time

See also: [02-detecting-leaks](../02-detecting-leaks/), [03-preventing-leaks](../03-preventing-leaks/), [10-scheduler-deep-dive](../../10-scheduler-deep-dive/).
