---
layout: default
title: Goroutines
parent: Concurrency
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/
---

# Goroutines

[← Back](../)

Goroutines are Go's lightweight, runtime-scheduled concurrent units of execution. Started with the `go` keyword, they begin life with a tiny ~2KB stack, multiplex onto a small pool of OS threads via the GMP scheduler, and grow or shrink their stacks on demand. They make it cheap to express concurrency at the scale of "one goroutine per request" — but they bring their own pitfalls: leaks, races, captured loop variables, and panics that vanish into the runtime.

## Sub-pages

- [junior.md](junior.md) — What a goroutine is, the `go` keyword, simple examples, and the most common first-time mistakes
- [middle.md](middle.md) — Why and when to spawn goroutines, real-world patterns, lifecycle management, and synchronisation basics
- [senior.md](senior.md) — Architecture: structured concurrency, supervisor patterns, leak prevention, and goroutine pool design
- [professional.md](professional.md) — Under the hood: the GMP scheduler, work-stealing, sysmon, async preemption, and stack growth internals
- [specification.md](specification.md) — Formal Go spec excerpts on `go` statements, runtime guarantees, and scheduler behaviour
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for spawning, coordinating, and stopping goroutines
- [find-bug.md](find-bug.md) — Bug-finding exercises with leaks, deadlocks, races, and captured-variable bugs
- [optimize.md](optimize.md) — Optimization exercises for goroutine pools, scheduler contention, and over-spawning
