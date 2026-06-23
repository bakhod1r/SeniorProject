---
layout: default
title: sync.Cond
parent: Sync Package
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/04-cond/
---

# sync.Cond

A condition variable bound to a `sync.Locker`. Used to suspend goroutines until some predicate over shared state becomes true, then wake one (`Signal`) or all (`Broadcast`) of them. The discipline is strict: the lock must be held around every check and every `Wait`, and `Wait` must always sit inside a `for !predicate { c.Wait() }` loop.

In modern Go, `sync.Cond` is the smallest of the synchronization primitives and the one most often misused. Channels handle most use cases that `Cond` was originally intended for, and many style guides explicitly recommend channels instead. `Cond` keeps a place when you have one shared piece of state and multiple distinct waiting predicates over it, or when a single broadcast must wake many waiters at once with the lowest possible overhead.

## Levels

- [Junior](junior.md) — what a condition variable is, the `for`-loop rule, `Signal` vs `Broadcast`, first examples.
- [Middle](middle.md) — bounded-queue and resource-pool patterns, channel comparison, debugging Wait/Signal mismatches.
- [Senior](senior.md) — predicate design, broadcast storms, when `Cond` actually beats channels, integration with `context.Context`.
- [Professional](professional.md) — runtime internals (`notifyList`, `runtime_notifyListWait`), memory model, futex layering.
- [Specification](specification.md) — language and library guarantees.
- [Interview](interview.md) — questions, traps, model answers.
- [Tasks](tasks.md) — exercises from "implement a bounded queue" to "build a wait-group with Cond".
- [Find the Bug](find-bug.md) — broken Cond code; you find the defect.
- [Optimize](optimize.md) — measuring Cond contention, switching to channels or atomics where it wins.
