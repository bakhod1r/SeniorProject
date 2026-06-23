---
layout: default
title: CAS Algorithms
parent: Lock-Free Programming
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/12-lock-free-programming/01-cas-algorithms/
---

# Compare-and-Swap (CAS) Algorithms

Compare-and-Swap is the single hardware primitive that makes lock-free programming possible. Every lock-free counter, stack, queue, hash table, and reference counter in Go ultimately rests on one instruction the CPU exposes: "atomically, if the memory at this address still equals the old value I read, write the new value and tell me you succeeded; otherwise leave the memory alone and tell me you failed." From that single operation, a whole family of algorithms is built.

This subsection walks from the raw `sync/atomic.CompareAndSwap*` calls through the canonical CAS loop, into building blocks (counter, flag, head pointer), and out into real lock-free data structures. By the end you will know when a CAS loop beats a mutex, when it loses, and how to reason about contention, livelock, and the cost of retries.

## Learning Path

- [junior.md](./junior.md) — What CAS is, the CAS-loop template, building a counter and a flag, common bugs (~1000+ lines)
- [middle.md](./middle.md) — Lock-free stack, CAS-protected pointer swap, contention behaviour (~600 lines)
- [senior.md](./senior.md) — Building higher-level primitives, comparison with mutex, design trade-offs (~600 lines)
- [professional.md](./professional.md) — Hardware-level CAS (LOCK CMPXCHG, ARMv8 CAS, LL/SC), memory ordering (~500 lines)
- [specification.md](./specification.md) — Go memory model formal rules for CAS (~300 lines)
- [interview.md](./interview.md) — Common interview questions and answers (~400 lines)
- [tasks.md](./tasks.md) — Hands-on exercises with solutions (~600 lines)
- [find-bug.md](./find-bug.md) — Buggy CAS code samples with diagnosis (~700 lines)
- [optimize.md](./optimize.md) — Performance tuning and contention reduction (~500 lines)

## Related Topics

- [02-aba-problem](../02-aba-problem/) — The classic CAS pitfall and its mitigations
- [03-lock-free-data-structures](../03-lock-free-data-structures/) — Stacks, queues, hash maps built on CAS
- [04-memory-fences](../04-memory-fences/) — Memory ordering semantics CAS depends on
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress guarantees and where CAS sits on the spectrum
