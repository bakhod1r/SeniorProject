---
layout: default
title: N-Barrier
parent: Concurrency Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/07-n-barrier/
---

# N-Barrier

A `sync.WaitGroup` answers the question "has every goroutine *finished*?" An **N-barrier** answers a different one: "has every goroutine *reached this line*, so that all of them may now continue *together*?" The barrier is a meeting point. N participants arrive, each blocks, and only when the Nth arrives does the barrier release all of them at once. Then — and this is the part that distinguishes a barrier from a one-shot `WaitGroup` — it *resets* and is ready for the next phase.

This subsection covers the full toolkit: the difference from `sync.WaitGroup`, building a reusable (cyclic) barrier with `sync.Mutex` + `sync.Cond`, the generation counter that prevents a fast goroutine from racing into the next phase, channel-based barrier variants, the comparison with `golang.org/x/sync/errgroup` for phased work, and the correctness hazards that bite people in production.

## When to reach for it

Use an N-barrier when your computation proceeds in **phases**, and every worker must finish phase *k* before *any* worker starts phase *k+1*. Classic shapes:

- **Iterative simulations.** A physics or cellular-automaton step reads the whole grid, computes the next grid, then everyone advances to the next tick. No worker may read the next tick's data until all writers of this tick have finished.
- **MapReduce-style rounds.** All mappers must complete before any reducer reads the shuffle output.
- **Lockstep testing.** Force N goroutines to all be "in flight" at the same instant to maximise the chance of exposing a race.
- **Bulk-synchronous parallel (BSP) algorithms.** Compute, then a global synchronisation point, then communicate, repeat.

If your work is *one* phase — fan out, wait for all, done — a plain `sync.WaitGroup` is correct and simpler. Reach for a barrier only when the synchronisation point repeats.

## Sections

- [Junior](junior.md) — what a barrier is, why `WaitGroup` is not a barrier, a minimal `sync.Cond` barrier.
- [Middle](middle.md) — the generation counter, channel-based barriers, a realistic phased simulation.
- [Senior](senior.md) — idiomatic refactors, performance, where barriers fail, comparison with errgroup.
- [Professional](professional.md) — team guidance, review checklist, interaction with the wider system.
- [Specification](specification.md) — precise semantics, invariants, edge cases, reference implementation.
- [Interview](interview.md) — questions from junior to staff level.
- [Tasks](tasks.md) — exercises building barriers from scratch.
- [Find the Bug](find-bug.md) — broken barriers and their fixes.
- [Optimize](optimize.md) — performance work on barriers.

## Cross-references

- `sync.WaitGroup` (`07-concurrency/02-sync-package/`) — the one-shot cousin. A barrier is "a WaitGroup you can use over and over, where everyone both arrives *and* waits."
- `sync.Cond` (`07-concurrency/02-sync-package/`) — the synchronisation primitive most barriers are built on.
- Broadcast (`05-concurrency-patterns/06-broadcast-pattern/`) — releasing all waiters at once is a broadcast; `sync.Cond.Broadcast()` is the engine of a barrier.
- Fan-out / fan-in (`05-concurrency-patterns/02-fan-out/`) — a single-phase fan-out + `WaitGroup` is the degenerate one-phase barrier.
- `golang.org/x/sync/errgroup` — the idiomatic way to run one phase of work and collect the first error; the senior file compares it with barriers for multi-phase work.
