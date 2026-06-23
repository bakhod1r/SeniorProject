---
layout: default
title: GMP Model
parent: Scheduler Deep Dive
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/10-scheduler-deep-dive/01-gmp-model/
---

# The G-M-P Model

[← Back](../)

The G-M-P model is the cornerstone abstraction of the Go runtime scheduler. Three concrete structs — `g` (goroutine), `m` (machine, an OS thread), and `p` (processor, the scheduling context) — together implement the M:N mapping that lets millions of goroutines time-share a handful of OS threads. The triangle was introduced in Go 1.1 (April 2013) following Dmitry Vyukov's 2012 design document *"Scalable Go Scheduler Design"*, which fixed the single-global-runqueue bottleneck of Go 1.0. Every other topic in this section — preemption, `GOMAXPROCS`, work-stealing, syscall handoff — manipulates the same three structs. Internalise them once and the rest of the scheduler reads almost like prose.

## Sub-pages

- [junior.md](junior.md) — Friendly first tour: what G, M, and P each mean and why three letters instead of one
- [middle.md](middle.md) — Field-level tour of `g`, `m`, `p`; local runqueues vs the global runqueue; idle lists
- [senior.md](senior.md) — State transitions; the `schedule()` loop; per-P caches; the `sched` global
- [professional.md](professional.md) — Reading `runtime/runtime2.go` and `runtime/proc.go` line by line; lock ranks; invariants
- [specification.md](specification.md) — The invariants the scheduler must preserve and the contract `newproc`, `schedule`, `findrunnable` honor
- [interview.md](interview.md) — GMP interview questions from junior to staff level
- [tasks.md](tasks.md) — Exercises that reproduce parts of the scheduler from scratch
- [find-bug.md](find-bug.md) — Bugs that only become visible once you understand G-M-P
- [optimize.md](optimize.md) — Performance work informed by GMP layout, local runqueues, and idle lists
