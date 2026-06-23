---
layout: default
title: Lock-Free vs Wait-Free
parent: Lock-Free Programming
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/12-lock-free-programming/05-lock-free-vs-wait-free/
---

# Lock-Free vs Wait-Free

"Lock-free" and "wait-free" are often used interchangeably in casual conversation, but they name two different points on a precise progress hierarchy first laid out by Maurice Herlihy in his 1991 paper *Wait-Free Synchronization*. Choosing between them is not a matter of taste; it is a matter of what guarantee your system requires and what cost you are willing to pay.

This subsection establishes the four rungs of the hierarchy — blocking, obstruction-free, lock-free, wait-free — explains where common Go constructs sit, and gives an honest assessment of when each property matters. The short answer for almost every Go program is "mutex or lock-free." Wait-free is a niche tool for hard-real-time and fault-tolerant systems, useful to understand even when you will not implement it.

## Learning Path

- [junior.md](./junior.md) — The hierarchy, definitions, simple examples (~1000+ lines)
- [middle.md](./middle.md) — Treiber stack vs wait-free queues, contention analysis (~600 lines)
- [senior.md](./senior.md) — Universal construction, helping mechanisms, design trade-offs (~600 lines)
- [professional.md](./professional.md) — Hard-RT, fault tolerance, FPGA / kernel use (~400 lines)
- [specification.md](./specification.md) — Formal progress definitions (~300 lines)
- [interview.md](./interview.md) — Questions you will be asked (~400 lines)
- [tasks.md](./tasks.md) — Hands-on exercises (~600 lines)
- [find-bug.md](./find-bug.md) — Misclassified progress guarantees (~600 lines)
- [optimize.md](./optimize.md) — When to step down the hierarchy for speed (~500 lines)
