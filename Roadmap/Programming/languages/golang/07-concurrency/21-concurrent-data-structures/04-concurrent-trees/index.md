---
layout: default
title: Concurrent Trees
parent: Concurrent Data Structures
grand_parent: Go
ancestor: Concurrency
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/
---

# Concurrent Trees

[← Back](../)

Concurrent trees are ordered, balanced search structures — B-trees, B+-trees, red-black trees, AVL trees, radix trees, ART (Adaptive Radix Trees), and Bw-trees — that allow many goroutines to read and update them at the same time without exposing intermediate, half-rewritten states. Unlike a flat map or skip-list, a tree's invariants (height balance, fanout limits, in-order key sequence) cut across many nodes at once, so the locking, optimistic, copy-on-write, and RCU strategies that make them safe are subtle and rich. In Go, the most important production-grade implementations are `google/btree` (single-writer, copy-on-write), `tidwall/btree` (generic, optionally locked), and embedded BoltDB / bbolt B+-trees (single-writer, MVCC readers). This subsection walks from "what is a B-tree" all the way to lock-free Bw-tree internals and PostgreSQL-grade concurrent B+-tree engineering.

## Sub-pages

- [junior.md](junior.md) — What a balanced search tree is, why ordering matters, the first lock around a `*Tree`, and using `google/btree` for sorted in-memory data
- [middle.md](middle.md) — Hand-over-hand (lock-coupling), reader/writer locks per node, optimistic concurrency with version counters, COW B-trees, working with `tidwall/btree`
- [senior.md](senior.md) — Architecture of a real concurrent B+-tree: latching protocols (S/X latches), latch crabbing, B-link trees (Lehman-Yao), MVCC integration, RCU on tree spines, immutable persistent trees
- [professional.md](professional.md) — The Bw-tree (mapping table + delta chains + epoch reclamation), concurrent ART, OLFIT, BzTree, hardware transactional memory for trees, and how PostgreSQL, InnoDB, SQL Server, and Hekaton actually do it
- [specification.md](specification.md) — Formal invariants of B-trees and B+-trees, the Lehman-Yao B-link protocol, OPTIK / OLFIT correctness arguments, ART invariants, and the Bw-tree paper's normative rules
- [interview.md](interview.md) — Interview questions from junior ("what's a B-tree?") to staff ("design a concurrent B+-tree for a 100k-QPS index")
- [tasks.md](tasks.md) — Hands-on exercises: lock-coupling traversal, COW insert, B-link split, ART concurrent insert
- [find-bug.md](find-bug.md) — Bug-finding exercises with split races, deadlock between coupled latches, stale optimistic reads, and use-after-free during RCU
- [optimize.md](optimize.md) — Optimization exercises for tree fanout, latch granularity, sibling pointers, cache-line packing, and prefix compression
