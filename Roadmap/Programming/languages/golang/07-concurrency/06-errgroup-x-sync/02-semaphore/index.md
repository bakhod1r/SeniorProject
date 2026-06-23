---
layout: default
title: x/sync semaphore
parent: errgroup and x/sync
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/06-errgroup-x-sync/02-semaphore/
---

# x/sync semaphore

`golang.org/x/sync/semaphore` is a **weighted, FIFO, context-aware** counting semaphore. A weight of `n` is reserved with `Acquire(ctx, n)` and returned with `Release(n)`. Acquisitions block until enough capacity is free or `ctx` is cancelled. Unlike a buffered channel acting as a semaphore, each waiter can request a different weight — making it the standard tool when "one job costs more than another" (memory budgets, large file slots, GPU memory, large message handlers).

Internally it is a small struct guarded by a mutex with a FIFO list of waiters parked on private channels. There is no goroutine inside the semaphore; the mutex protects the counter and the queue, and a successful `Release` wakes the front waiter by closing its channel.

## Levels

- [Junior](junior.md) — what a semaphore is, `NewWeighted`, `Acquire`, `Release`, weight = 1 case, channel comparison.
- [Middle](middle.md) — `TryAcquire`, context cancellation, weighted patterns, memory-budget gating.
- [Senior](senior.md) — fairness analysis, queue head blocking, sizing under bursty load, combining with `errgroup`.
- [Professional](professional.md) — internals: the FIFO `list.List`, the per-waiter `chan struct{}`, the mutex hot path, comparison with OS semaphores.
- [Specification](specification.md) — formal contract: pre/postconditions, ordering, error semantics.
- [Interview](interview.md) — common questions and traps.
- [Tasks](tasks.md) — exercises from "limit 8 in flight" to "build your own weighted semaphore".
- [Find the Bug](find-bug.md) — broken semaphore usage with the defect to spot.
- [Optimize](optimize.md) — measuring acquire contention, choosing weights, when to swap for a channel pool.
