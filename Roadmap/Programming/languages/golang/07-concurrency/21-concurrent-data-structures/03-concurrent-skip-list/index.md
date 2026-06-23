---
layout: default
title: Concurrent Skip List
parent: Concurrent Data Structures
grand_parent: Go
ancestor: Concurrency
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/
---

# Concurrent Skip List

[← Back](../)

A **skip list** is a probabilistic, layered linked list that gives O(log n) expected search, insert, and delete without the bookkeeping cost of a balanced tree. The *concurrent* skip list adds CAS-based, often lock-free, multi-level updates with **marker nodes** to make deletes linearisable. It is the data structure behind `java.util.concurrent.ConcurrentSkipListMap`, behind LevelDB / RocksDB memtables, and behind Go libraries like `github.com/zhangyunhao116/skipset` and `sweet.io/skipset`. Compared to `sync.Map`, a skip list keeps keys *ordered* and supports cheap range queries; compared to a B-tree, it is dramatically simpler to make concurrent because each modification touches a thin vertical slice rather than a wide page.

## Sub-pages

- [junior.md](junior.md) — What a skip list is, why it is randomised, single-threaded build-up, and the first naive "lock the whole thing" concurrent version
- [middle.md](middle.md) — Fine-grained locking (per-node locks), Pugh's algorithm, lock coupling, validate-then-link, and the moment marker nodes become necessary
- [senior.md](senior.md) — Lock-free Fraser/Harris/Pratt design: CAS per level, marker pointers, helping, snapshot iterators, range queries, ABA prevention
- [professional.md](professional.md) — Memory reclamation (hazard pointers, epoch-based reclamation, Go's GC as a substitute), cache-line layout, NUMA, comparison with B+tree memtables, `skipset` internals
- [specification.md](specification.md) — Formal properties: linearisability points, progress guarantees, the Harris–Michael deletion lemma, randomisation analysis
- [interview.md](interview.md) — Interview questions and answers from junior to staff on skip lists and concurrent variants
- [tasks.md](tasks.md) — Hands-on exercises: build a sequential skip list, add coarse locks, evolve to per-node locks, finally to lock-free
- [find-bug.md](find-bug.md) — Bug-finding exercises: missing markers, partial unlink, height mismatch, lost updates, reclaim-too-early races
- [optimize.md](optimize.md) — Optimization exercises: random source choice, fixed-vs-dynamic height, padding, batched promotion, sharded skip lists
