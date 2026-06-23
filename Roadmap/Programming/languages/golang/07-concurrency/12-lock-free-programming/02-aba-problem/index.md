---
layout: default
title: ABA Problem
parent: Lock-Free Programming
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/12-lock-free-programming/02-aba-problem/
---

# The ABA Problem

The **ABA problem** is the most famous trap in lock-free programming. A thread reads a value `A`, gets preempted, and resumes later. While it was paused, another thread changed the value to `B` and back to `A`. The first thread's `CompareAndSwap` looks at memory, sees `A`, and concludes "nothing changed." But everything around that `A` may have changed — nodes were freed, the list reshaped, counters wrapped around. The CAS succeeds and corrupts the data structure.

ABA matters because almost every lock-free algorithm uses CAS to detect interference, and CAS detects only the bit pattern, not the history. In C and C++ this routinely produces dangling pointers and double frees. In Go the garbage collector hides many of the worst cases, but ABA still appears in object pools, integer-indexed slots, ring buffers, and any structure that recycles identifiers.

This subsection explains the problem precisely, walks through the classic lock-free stack example, and surveys the four mainstream mitigations — tagged pointers, double-word CAS, hazard pointers, and epoch-based reclamation — with Go-specific notes throughout.

## Learning Path

- [junior.md](./junior.md) — What ABA is, the stack example, why CAS is fooled (~1000+ lines)
- [middle.md](./middle.md) — How Go's GC mitigates pointer ABA, where ABA still bites (~600 lines)
- [senior.md](./senior.md) — Hazard pointers and epoch-based reclamation in depth (~600 lines)
- [professional.md](./professional.md) — DWCAS, tagged pointers, RCU comparisons, production postmortems (~500 lines)
- [specification.md](./specification.md) — Formal ABA conditions, Go memory model interactions (~300 lines)
- [interview.md](./interview.md) — ABA interview questions with answers (~400 lines)
- [tasks.md](./tasks.md) — Hands-on exercises building and breaking ABA-vulnerable structures (~600 lines)
- [find-bug.md](./find-bug.md) — Real ABA bugs to diagnose (~700 lines)
- [optimize.md](./optimize.md) — Mitigation performance trade-offs (~500 lines)

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — The CAS primitive ABA exploits
- [03-lock-free-data-structures](../03-lock-free-data-structures/) — Where ABA shows up in real designs
- [04-memory-fences](../04-memory-fences/) — Memory ordering and reclamation interplay
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Why hazard pointers add wait-free progress
