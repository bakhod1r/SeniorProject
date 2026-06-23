---
layout: default
title: LRU Concurrent
parent: Concurrent Data Structures
grand_parent: Go
ancestor: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/
---

# Concurrent LRU Cache

[← Back](../)

A concurrent LRU (Least-Recently-Used) cache combines two cooperating data structures — a hash map for O(1) lookup and a doubly-linked list for O(1) recency tracking — and protects them so that many goroutines can read, write, and evict at the same time. A naive single-mutex LRU serialises every operation and quickly becomes the slowest line in a flame graph. Real production caches use sharding, lock-free reads, careful ordering of map and list updates, and modern admission/eviction policies (S3-FIFO, W-TinyLFU) that sample frequency in addition to recency. This subsection walks from the classic textbook design through `hashicorp/golang-lru`, `dgraph-io/ristretto`, and S3-FIFO so you understand both the theory and the trade-offs you will face when picking a cache library in a hot path.

## Sub-pages

- [junior.md](junior.md) — What LRU is, the linked-list-plus-map invariant, why a global mutex is not enough, and a first correct concurrent version
- [middle.md](middle.md) — Sharded LRU, RWMutex vs Mutex trade-offs, eviction edge cases, integration patterns, and using `hashicorp/golang-lru/v2`
- [senior.md](senior.md) — Architecture: lock-free reads, BP-Wrapper, Clock/Segmented LRU, ristretto internals, S3-FIFO algorithm, hot-key contention
- [professional.md](professional.md) — Cache theory: TinyLFU sketches, doorkeeper, scan resistance, admission policies, GC pressure, NUMA-aware sharding, formal hit-rate analysis
- [specification.md](specification.md) — Formal LRU semantics, `container/list` contract, `hashicorp/golang-lru/v2` API surface, ristretto policy guarantees
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building, benchmarking, and tuning concurrent LRUs
- [find-bug.md](find-bug.md) — Bug-finding exercises with deadlocks, lost updates, eviction races, and broken invariants
- [optimize.md](optimize.md) — Optimization exercises for sharding, allocation, lock contention, and hit-rate
