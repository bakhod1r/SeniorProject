---
layout: default
title: Concurrent Bloom Filter
parent: Concurrent Bloom Filter
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/07-concurrent-bloom-filter/
---

# Concurrent Bloom Filter

[← Back](../)

A Bloom filter is a tiny, probabilistic set: it tells you "definitely not present" or "possibly present" using a fixed-size bitset and a small number of hash functions. In a concurrent server it lets one goroutine ask "have we seen this key?" without touching the underlying database, cache, or disk. The interesting question is how to share that bitset safely across thousands of goroutines without serialising every Add and every Test through a mutex. The answer is a small zoo of designs: atomic word-level CAS, counting variants for deletion, partitioned shards for write throughput, scalable Bloom filters that grow on demand, and Cuckoo filters when you need actual deletion plus a tighter false-positive bound.

## Sub-pages

- [junior.md](junior.md) — What a Bloom filter is, false positives, the basic Add/Test API, and using `bits-and-blooms/bloom` from a single goroutine
- [middle.md](middle.md) — Sharing a Bloom filter across goroutines: RWMutex wrapping, atomic bitsets, sharding, counting Bloom filters for deletion, and observability
- [senior.md](senior.md) — Architecture: partitioned Bloom filters, scalable Bloom filters (SBF), Cuckoo filter trade-offs, hash-function selection, and integrating the filter with a cache or LSM-tree
- [professional.md](professional.md) — Internals: false-positive math, optimal k from m and n, double hashing, cache-line packing, lock-free designs with `atomic.Uint64`, NUMA effects, and production failure modes
- [specification.md](specification.md) — Formal definitions, false-positive formulae, library API contracts (`bits-and-blooms/bloom/v3`, `willf/bloom`), and Bloom filter literature references
- [interview.md](interview.md) — Interview questions and answers from junior to staff covering false positives, deletion, sharding, and library trade-offs
- [tasks.md](tasks.md) — Hands-on exercises building an atomic Bloom filter, a counting variant, a sharded filter, and a scalable filter from scratch
- [find-bug.md](find-bug.md) — Bug-finding exercises: torn bitset writes, lost counter decrements, hash-seed mismatches, and saturation
- [optimize.md](optimize.md) — Optimization exercises tuning m, k, sharding, hash choice, and cache behaviour against measured false-positive rates
