---
layout: default
title: Acquire Release
parent: Memory Ordering Barriers
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/
---

# Acquire / Release Semantics

[← Back](../)

Acquire/release is the second-strongest memory ordering family in modern hardware and language memory models. An **acquire** operation prevents subsequent reads and writes from being reordered before it; a **release** operation prevents preceding reads and writes from being reordered after it. Together they form the publication–subscription pattern that underlies every correct lock, lazy initializer, and atomic flag. Go does not expose explicit acquire/release ordering — `sync/atomic` operations and `sync.Mutex` provide sequentially consistent semantics, but understanding the underlying pair is essential for reasoning about safe publication, double-checked locking, and the *happens-before* relations the Go memory model promises.

## Sub-pages

- [junior.md](junior.md) — What acquire and release mean, why locks pair them, and how `atomic.Store`/`atomic.Load` publish values safely
- [middle.md](middle.md) — Building publication patterns, lazy init with `sync.Once`, the read-mostly flag, and the producer-flag handshake
- [senior.md](senior.md) — Double-checked locking, seqlocks, RCU-style publication, and what *happens-before* guarantees Go actually makes
- [professional.md](professional.md) — C++/Rust `memory_order` parallels, what Go's runtime emits per architecture, fence elision, and the cost of sequential consistency
- [specification.md](specification.md) — Excerpts from the Go memory model, `sync/atomic` documentation, and the *happens-before* axioms
- [interview.md](interview.md) — Interview questions from junior through staff level, with answers
- [tasks.md](tasks.md) — Hands-on exercises building publication patterns and reasoning about reorderings
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken publication, missing acquire, and torn reads
- [optimize.md](optimize.md) — Optimization exercises replacing locks with atomics where safe, and measuring the cost
