---
layout: default
title: TTL Caches
parent: Concurrent Data Structures
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/
---

# Concurrent TTL Caches

[← Back](../)

A **TTL (time-to-live) cache** stores values that automatically become invalid after a fixed duration. In a concurrent setting, multiple goroutines simultaneously read, write, and delete entries while the cache is *also* racing against the wall clock — entries quietly expire even when nobody touches them. That combination — concurrent mutation plus background decay — makes TTL caches one of the most interview-relevant and bug-prone data structures in any production Go service.

This subsection walks through the full design space:

- **Get / Set / Delete with expiration.** The cache must atomically check "is this entry still alive?" while another goroutine may be inserting a fresh version or deleting it.
- **Lazy vs active eviction.** Lazy: drop the entry only when a reader stumbles on it. Active: a background sweeper periodically scans and removes dead entries. Both have failure modes; production caches typically combine them.
- **Sweep goroutines.** The single hardest engineering decision: how often to sweep, how much work per tick, how to avoid stalling readers, how to shut down cleanly.
- **`sync.Map` plus a min-heap of expirations.** A common Go-idiomatic layout: `sync.Map` for the hot path, a heap protected by a mutex for the sweeper.
- **Production libraries — ristretto, bigcache, freecache.** Each chooses a different trade-off: ristretto picks admission via TinyLFU, bigcache splits into shards with byte arrays to avoid GC pressure, freecache pre-allocates ring buffers.
- **Jittered TTL.** Without jitter, batch-inserted keys all expire in the same millisecond and trigger a stampede — see *thundering herd*.
- **Thundering herd on expiry.** When a hot key expires, every concurrent reader misses simultaneously and slams the origin. The fix is **single-flight** (`golang.org/x/sync/singleflight`).
- **Observability.** Hit ratio, miss ratio, eviction rate, expired-on-read counter, sweep latency, sweeper queue depth, p99 lookup latency.

## Sub-pages

- [junior.md](junior.md) — What a TTL cache is, `map + sync.RWMutex`, lazy expiration, the first sweep goroutine, common beginner bugs
- [middle.md](middle.md) — `sync.Map` + min-heap, active sweep loops, jittered TTL, basic singleflight, choosing eviction policies
- [senior.md](senior.md) — Sharded caches, `ristretto` and `bigcache` internals, admission policies, hot-key mitigation, graceful shutdown
- [professional.md](professional.md) — GC-free large caches, memory layout for billions of entries, off-heap arenas, NUMA-aware sharding, multi-tier (L1/L2) caching
- [specification.md](specification.md) — Formal contract: invariants, memory ordering guarantees, behaviour under clock skew, monotonic vs wall time
- [interview.md](interview.md) — 30–40 interview Q&A from junior to staff
- [tasks.md](tasks.md) — 15–20 hands-on exercises building progressively more sophisticated TTL caches
- [find-bug.md](find-bug.md) — 10–12 bug-finding snippets with deadlocks, races, leaks, and stampede triggers
- [optimize.md](optimize.md) — 8–10 optimization scenarios — sweeper tuning, allocation reduction, sharding choices
