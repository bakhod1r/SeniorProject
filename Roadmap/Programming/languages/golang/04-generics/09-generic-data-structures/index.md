---
layout: default
title: Generic Data Structures
parent: Generics
grand_parent: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/09-generic-data-structures/
---

# Generic Data Structures

[← Back](../)

We explore **generic data structures** — the most natural and rewarding application of type parameters in Go. Stacks, queues, sets, trees, heaps, graphs, and small wrappers like `Pair` or `Optional` all become type-safe one-liners after Go 1.18. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — Stack[T] and Set[T] from scratch; why pre-1.18 versions were ugly
- [middle.md](middle.md) — Queue (slice + ring), LinkedList[T], Pair[K,V], Optional[T]
- [senior.md](senior.md) — Tree[T], BST[T cmp.Ordered], Heap[T], Graph[V,E] and method-set constraints
- [professional.md](professional.md) — When to ship a generic library vs use `container/heap`, `container/list`, `container/ring`
- [specification.md](specification.md) — Spec excerpts for generic type declarations and methods
- [interview.md](interview.md) — 30+ Q&A on building generic containers
- [tasks.md](tasks.md) — 20+ exercises (Trie, BloomFilter, CircularBuffer, CowList)
- [find-bug.md](find-bug.md) — 15+ bugs in generic data structures
- [optimize.md](optimize.md) — Memory layout, receivers, avoiding boxing
