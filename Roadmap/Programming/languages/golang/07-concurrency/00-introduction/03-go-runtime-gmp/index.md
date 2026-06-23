---
layout: default
title: Go Runtime GMP
parent: Concurrency
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/00-introduction/03-go-runtime-gmp/
---

# Go Runtime GMP

[← Back](../)

The Go scheduler is what turns the language's lightweight goroutines into real CPU work. It is built on three abstractions: **G** (a goroutine, the unit of work), **M** (a machine, an OS thread), and **P** (a processor, a logical context that holds a run queue and is required to execute Go code). Goroutines start, run, block, get stolen, and exit on a tightly engineered M:N scheduler that has evolved since Go 1.0 (a single global queue) to today's per-P queues, work-stealing, async preemption, and integrated network poller.

This subsection is the introductory pass on GMP. You learn the abstractions, the run-queue layout, the work-stealing protocol, sysmon's role, and how syscalls and network I/O integrate. Deeper coverage — preemption details, stack growth, scheduler tracing — lives in `10-scheduler-deep-dive`. Here we lay the foundations so the deep dive has somewhere to land.

## Sub-pages

- [junior.md](junior.md) — What G, M, P are; how the scheduler runs goroutines; first introspection with `GODEBUG=schedtrace`
- [middle.md](middle.md) — Run queues, work stealing, syscalls and the network poller, GOMAXPROCS tuning
- [senior.md](senior.md) — Scheduler implications for system design: pinning, fairness, latency, isolation
- [professional.md](professional.md) — Internals: `g`, `m`, `p` structs, sysmon, async preemption, scheduler invariants
- [specification.md](specification.md) — Authoritative references, `GODEBUG` knobs, version timeline
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises with scheduler tracing and tuning
- [find-bug.md](find-bug.md) — Bug-finding exercises about scheduler-aware bugs
- [optimize.md](optimize.md) — Optimization exercises involving scheduler behaviour
