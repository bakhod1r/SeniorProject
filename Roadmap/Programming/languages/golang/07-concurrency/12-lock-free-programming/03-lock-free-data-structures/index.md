---
layout: default
title: Lock-Free Data Structures
parent: Lock-Free Programming
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/12-lock-free-programming/03-lock-free-data-structures/
---

# Lock-Free Data Structures

A **lock-free data structure** guarantees that at least one operating thread always makes progress, even if other threads are arbitrarily delayed. Building one is a different sport from using one. The hardware gives you a single primitive — compare-and-swap — and you have to weave it into algorithms that maintain invariants under concurrent mutation, without ever taking a mutex. The seminal designs are old: Treiber's stack (1986), Michael and Scott's queue (1996), Harris's linked list (2001), Cliff Click's hash map (2007). Each is a small masterpiece of reasoning; each has a Go translation that is short to write and easy to get subtly wrong.

This subsection presents the canonical lock-free data structures in Go. We implement Treiber's stack, the Michael-Scott queue, Harris's lock-free list, single-atomic counters, single-producer/single-consumer ring buffers, Vyukov's bounded MPMC queue, a sketch of Click's non-blocking hash map, and a lock-free skip list. We then look at where these designs win in production and where they lose — and they often lose, because lock-free code is harder to test, harder to debug, and not automatically faster than a well-tuned mutex.

## Learning Path

- [junior.md](./junior.md) — What a lock-free data structure is, full Treiber stack and MS-queue code (~1000+ lines)
- [middle.md](./middle.md) — Harris's lock-free list, SPSC and MPSC ring buffers, design trade-offs (~700 lines)
- [senior.md](./senior.md) — Vyukov MPMC queue, Click's hash map, lock-free skip list, when NOT to go lock-free (~700 lines)
- [professional.md](./professional.md) — LMAX Disruptor heritage, false sharing, NUMA, real benchmarks (~500 lines)
- [specification.md](./specification.md) — Linearizability proofs, MS-queue formal model, ABA-freedom arguments (~300 lines)
- [interview.md](./interview.md) — Common interview questions with answers (~400 lines)
- [tasks.md](./tasks.md) — Hands-on exercises with solutions (~700 lines)
- [find-bug.md](./find-bug.md) — Buggy lock-free code samples with diagnoses (~700 lines)
- [optimize.md](./optimize.md) — Tuning under contention, sharding, batching (~500 lines)

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — The CAS primitive every structure here depends on
- [02-aba-problem](../02-aba-problem/) — The ABA trap and Go's partial GC mitigation
- [04-memory-fences](../04-memory-fences/) — Memory ordering and reclamation interplay
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy: obstruction-free, lock-free, wait-free
