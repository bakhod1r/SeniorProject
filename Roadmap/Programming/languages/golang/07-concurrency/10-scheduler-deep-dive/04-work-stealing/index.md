---
layout: default
title: Work Stealing
parent: Scheduler Deep Dive
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/10-scheduler-deep-dive/04-work-stealing/
---

# Work Stealing

[← Back](../)

Work stealing is the load-balancing algorithm at the heart of the Go scheduler. Each P owns a local runqueue (LRQ) of up to 256 runnable goroutines, but goroutines do not arrive uniformly: one P may have a queue full to capacity while another sits idle with nothing to run. To keep every CPU productive, an idle P first checks its own LRQ, then the global runqueue, then steals half of the runnable goroutines from a randomly selected victim P. The technique was popularised by the MIT Cilk project in the mid-1990s; Go adopted it in version 1.1 (April 2013) when Dmitry Vyukov rewrote the scheduler. Understanding work stealing explains why Go programs scale near-linearly on multi-core machines, why bursty producers do not create stalls, and why the `nmspinning` counter exists. This page walks through the algorithm in `findRunnable`, the "spinning M" mechanism that keeps the system reactive, and the cost model that governs when stealing is profitable.

## Sub-pages

- [junior.md](junior.md) — Why an idle P would steal, what "stealing half" means, and the first picture of the algorithm
- [middle.md](middle.md) — The `findRunnable` flow; spinning Ms; the `wakep` callback; `nmspinning` counter
- [senior.md](senior.md) — Random victim selection; steal cost; `injectglist`; comparison with Cilk and Tokio
- [professional.md](professional.md) — Reading `runtime/proc.go` around `findRunnable` and `runqsteal`; lock ranks; trace events
- [specification.md](specification.md) — The invariants stealing must preserve: fairness, no double-run, work conservation
- [interview.md](interview.md) — Work-stealing questions from junior up to staff level
- [tasks.md](tasks.md) — Exercises that build a miniature work-stealing scheduler
- [find-bug.md](find-bug.md) — Bugs that misuse or starve the work-stealing path
- [optimize.md](optimize.md) — Performance work informed by steal cost, spinning Ms, and LRQ design
