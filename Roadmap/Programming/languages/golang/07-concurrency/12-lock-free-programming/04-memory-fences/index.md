---
layout: default
title: Memory Fences and Barriers
parent: Lock-Free Programming
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/12-lock-free-programming/04-memory-fences/
---

# Memory Fences and Barriers

[← Back](../)

A **memory fence** (or memory barrier) is a CPU instruction that constrains the ordering of memory operations. Without fences, both the compiler and the processor are free to reorder loads and stores to extract performance — a freedom that is invisible in single-threaded code and catastrophic in lock-free algorithms. Fences are the lowest-level tool a programmer has to say "these operations must appear, to other CPUs, in the order I wrote them."

Go does not expose explicit fences in the standard library. Instead, every call into `sync/atomic` emits the right fence for the target architecture — `LOCK`-prefixed instructions or `XCHG` on x86, `LDAR` / `STLR` and `DMB` on ARM64. Go's memory model further promises that atomic operations behave as if executed in some sequentially consistent order, which is the strongest ordering anyone usually needs. This subsection explains what fences are, why hardware memory models force them on us, how Go hides the difference between x86's TSO and ARM's weak ordering, and when you must still think about fences explicitly — typically when reading atomic source, designing a new lock-free structure, or bridging to C through Cgo.

## Learning Path

- [junior.md](junior.md) — What a fence is, why reordering exists, Go atomics imply fences (~1000+ lines)
- [middle.md](middle.md) — Acquire / release / seq_cst, x86 TSO vs ARM weak compared (~600 lines)
- [senior.md](senior.md) — Designing with the four orderings, C++/Java equivalents, FFI concerns (~600 lines)
- [professional.md](professional.md) — Hardware instruction tables (`MFENCE`, `DMB`, `lwsync`), store buffers, OOO cores (~600 lines)
- [specification.md](specification.md) — Formal memory-model rules and authoritative references (~300 lines)
- [interview.md](interview.md) — Common interview questions and answers (~400 lines)
- [tasks.md](tasks.md) — Hands-on exercises (~600 lines)
- [find-bug.md](find-bug.md) — Reordering bugs and their diagnosis (~600 lines)
- [optimize.md](optimize.md) — Reducing fence overhead in hot paths (~500 lines)

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS is the primary fence-emitting primitive
- [02-aba-problem](../02-aba-problem/) — A reordering-flavoured bug, even on TSO
- [03-lock-free-data-structures](../03-lock-free-data-structures/) — Algorithms whose correctness rests on fences
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress guarantees built on the same primitives
