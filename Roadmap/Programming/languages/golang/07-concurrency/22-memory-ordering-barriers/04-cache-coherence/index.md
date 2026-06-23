---
layout: default
title: Cache Coherence
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/
---

# Cache Coherence

[← Back](../)

Cache coherence is the hardware contract that gives every CPU core a consistent view of memory even though each core holds its own private copy of recently touched data in L1 and L2 caches. Protocols like MESI and MOESI shuffle cache lines between cores using invalidations, snoops, and ownership transfers — and every atomic operation, mutex, and even a plain shared write in Go ultimately rides on those mechanics. When two goroutines on different cores hammer variables that share a cache line, the protocol bounces the line back and forth and a 1ns L1 hit turns into a 30ns cross-socket round trip. This section explains the protocols, how Go code triggers them, and how to measure and fix the damage.

## Sub-pages

- [junior.md](junior.md) — Cache hierarchy, cache lines, why a write on one core costs more than a write on another, first taste of false sharing
- [middle.md](middle.md) — MESI states and transitions, store buffers, invalidation queues, what `sync/atomic` actually does on x86 and ARM
- [senior.md](senior.md) — MOESI, directory protocols on multi-socket NUMA, designing data layouts to minimise coherence traffic, padding strategies
- [professional.md](professional.md) — Coherence under contention at scale: NUMA-aware allocators, RFO storms, snoop filters, hardware counters, and a deep look at Go's runtime hot paths
- [specification.md](specification.md) — How Go's memory model and the hardware coherence contract relate, what the spec promises, and what it leaves to the CPU
- [interview.md](interview.md) — Interview questions from junior through staff on coherence, false sharing, and atomic-operation cost
- [tasks.md](tasks.md) — Hands-on exercises that reproduce false sharing, measure cache-line bouncing, and apply padding
- [find-bug.md](find-bug.md) — Bug-finding exercises with hidden coherence pathologies
- [optimize.md](optimize.md) — Optimization exercises that turn coherence-bound code into cache-friendly code
