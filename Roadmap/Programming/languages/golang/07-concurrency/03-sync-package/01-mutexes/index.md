---
layout: default
title: Mutexes
parent: sync Package
grand_parent: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/01-mutexes/
---

# Mutexes

[← Back](../)

We explore Go's `sync.Mutex` and `sync.RWMutex`: how they protect shared state, why they must never be copied, why Go does not support reentrancy, how `defer m.Unlock()` becomes a survival reflex, and how mutex contention is measured and tuned in production.

## Sub-pages

- [junior.md](junior.md) — First contact: race conditions, Lock/Unlock, defer-Unlock, RWMutex
- [middle.md](middle.md) — Patterns, granularity, copy-of-mutex bug, TryLock, deadlocks
- [senior.md](senior.md) — RWMutex internals, sharded mutexes, lock ordering, contention profiling
- [professional.md](professional.md) — Mutex internals: state word, semacquire, normal vs starvation mode, futex
- [specification.md](specification.md) — Formal API contracts and runtime guarantees of the sync package
- [interview.md](interview.md) — Interview questions from junior to staff level
- [tasks.md](tasks.md) — Hands-on exercises with mutexes and RWMutex
- [find-bug.md](find-bug.md) — Bug-finding exercises: copy-of-mutex, missing Unlock, lock-ordering deadlocks
- [optimize.md](optimize.md) — Replacing mutexes with atomics, sharding, sync.Pool, RWMutex tuning
