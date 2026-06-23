---
layout: default
title: Tasks
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/tasks/
---

# Concurrent LRU — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome.

---

## Easy

### Task 1 — Basic LRU

Implement a single-goroutine LRU using `container/list` and a map. Methods: `Get`, `Set`, `Len`. Capacity = 3. Insert 4 keys; assert the first is evicted.

- Use `*entry` structs stored in the list's elements.
- Run a sanity check: after `Set(a)`, `Set(b)`, `Set(c)`, `Get(a)`, `Set(d)`, the cache should contain `{a, c, d}` and `b` should be evicted.

**Goal.** Internalize the map-plus-list pattern.

---

### Task 2 — Add a mutex

Take your LRU from Task 1 and add a `sync.Mutex` around every public method. Spawn 16 goroutines hammering the cache for 1 second. Run with `go test -race`. Verify no race reports.

**Goal.** Understand the single-mutex pattern.

---

### Task 3 — Use `hashicorp/golang-lru/v2`

Replace your implementation with `hashicorp/golang-lru/v2`. Same test as Task 2. Compare line count.

```go
import lru "github.com/hashicorp/golang-lru/v2"
cache, _ := lru.New[string, int](3)
```

**Goal.** See how much the library does for you.

---

### Task 4 — Track hit/miss

Add atomic counters `hits` and `misses`. On Get, increment one. Print the hit rate after the test.

**Goal.** Practice cache observability.

---

### Task 5 — Eviction callback

Use `lru.NewWithEvict` with a callback that prints the evicted key. Run the test. Confirm callbacks fire as expected.

**Goal.** Learn the callback contract.

---

### Task 6 — TTL wrapper

Wrap `lru.Cache[string, ttlEntry]` so Get returns false if the entry's `expireAt` is in the past. Test with TTL of 100 ms; sleep 200 ms; verify Get returns false.

```go
type ttlEntry struct {
    val      string
    expireAt time.Time
}
```

**Goal.** Combine LRU with time-based expiry.

---

### Task 7 — `Peek` vs `Get`

Create a cache of 3. Insert a, b, c. Call `Peek(a)`. Insert d. Verify `a` was evicted (Peek doesn't promote). Repeat with `Get(a)`. Verify `b` was evicted (Get promoted a).

**Goal.** Distinguish the two methods.

---

## Medium

### Task 8 — Sharded LRU

Build a sharded LRU using 16 shards, each backed by `hashicorp/golang-lru/v2`. Pick the shard via `maphash` on the string key. Verify it works under concurrent load with `-race`.

```go
type ShardedLRU[K ~string, V any] struct {
    shards [16]*lru.Cache[K, V]
    seed   maphash.Seed
}
```

**Goal.** Implement sharding.

---

### Task 9 — Benchmark single vs sharded

Write `BenchmarkSingleMutex` and `BenchmarkSharded16`. Each runs 16 parallel goroutines doing 1M ops on a 10K-entry cache. Compare ns/op.

Expected outcome: sharded is 5-15x faster.

**Goal.** Measure the contention cost.

---

### Task 10 — Singleflight wrapper

Combine `lru.Cache` with `singleflight.Group`. Spawn 100 goroutines calling `cache.GetOrLoad(key, loadFn)` for the same key simultaneously. Verify `loadFn` is called only once.

```go
v, err, shared := sf.Do(key, func() (interface{}, error) { ... })
```

**Goal.** Eliminate thundering herds.

---

### Task 11 — Hot key detection

Maintain a `sync.Map[string, *atomic.Uint64]` of access counts. After running a Zipf workload, print the top 10 keys. Verify they correspond to the Zipf head.

**Goal.** Profile cache behavior.

---

### Task 12 — Cache stampede simulation

Set a 1-second TTL. Spawn 1000 goroutines that each Get the same key. After 1 second, observe how many load function calls happen. Implement `singleflight`; rerun. Compare.

**Goal.** Reproduce a real production scenario.

---

### Task 13 — Negative caching

A loader sometimes returns `ErrNotFound`. Cache the absence with a 10-second TTL. Verify subsequent lookups return cached "not found" without re-calling the loader.

**Goal.** Implement a useful pattern.

---

### Task 14 — Write-around invalidation

Build a repository pattern. `Update(id, v)` calls the database then `cache.Remove(id)`. Test: Update, Get → cache miss, loads from DB; Get → cache hit.

**Goal.** Practice the write-around pattern.

---

### Task 15 — Cache-aside with metrics

Build a service that uses cache-aside. Export Prometheus metrics for hits, misses, evictions, current size. Test with a realistic workload.

**Goal.** Production-ready observability.

---

## Hard

### Task 16 — Implement BP-Wrapper

Build a cache where Get is RLock-only. Access events are pushed to a per-shard channel; a background goroutine drains the channel and updates the recency list under Lock.

Compare benchmark numbers with the regular sharded cache. Expected: faster under heavy read load.

**Goal.** Reproduce the BP-Wrapper pattern.

---

### Task 17 — Clock cache

Implement a Clock cache backed by a `[]entry` slice, a clock hand, and per-entry atomic `referenced` flags. Get sets the flag; Set evicts by walking the hand.

**Goal.** Build an alternative concurrent eviction algorithm.

---

### Task 18 — Stale-while-revalidate

Use two TTLs per entry. On Get within soft TTL, return cached value. Between soft and hard TTL, return cached value AND start a background refresh (use atomic CAS to ensure only one refresh per key). Past hard TTL, load synchronously.

**Goal.** Eliminate latency spikes at TTL expiry.

---

### Task 19 — Mattson's algorithm

Process a 1M-event trace through Mattson's algorithm. Output the Miss Ratio Curve: hit rate at every cache size from 100 to 100K. Plot in your favorite tool.

```go
func Mattson(trace []string) []int { ... } // stack distances
```

**Goal.** Compute LRU hit rate at all sizes from one trace.

---

### Task 20 — Compare cache libraries

Implement the same workload using `hashicorp/golang-lru/v2`, `dgraph-io/ristretto`, `allegro/bigcache`, and `coocood/freecache`. Compare hit rate, throughput, memory, p99 latency.

Expected outcome: ristretto wins on throughput; bigcache wins on memory for large caches.

**Goal.** Empirical comparison of the field.

---

### Task 21 — TinyLFU admission filter

Implement Count-Min Sketch (4 rows, 1M counters). Implement an admission rule: incoming key is admitted iff its sketch estimate exceeds the cache's would-be victim's. Apply on top of a sharded LRU.

Compare hit rate with and without admission on a scan-heavy workload.

**Goal.** Implement the W-TinyLFU foundation.

---

### Task 22 — S3-FIFO

Implement S3-FIFO: three FIFO queues (small, main, ghost). Per-entry counter 0-3. Promotion rules per the algorithm.

Compare with plain LRU on a Zipf workload. Expected: S3-FIFO matches or beats LRU.

**Goal.** Implement the 2024 state-of-the-art.

---

### Task 23 — Multi-pod invalidation

Simulate two pods with their own caches. Implement Redis pub/sub invalidation: a write on pod A publishes "key K invalidated"; pod B subscribes and Removes from its cache. Test cross-pod consistency.

(Use a real Redis or mock with channels.)

**Goal.** Solve cache coherence in a multi-pod deployment.

---

### Task 24 — Off-heap cache

Build a cache that stores serialised values in a `[]byte` arena. Use the arena as a circular buffer; track slot offsets via a map. Compare GC behavior with on-heap.

**Goal.** Reduce GC pressure for a large cache.

---

### Task 25 — Adversarial workload defense

Implement a cache that protects against poisoning. Add (a) per-source rate limiting on misses, (b) a TinyLFU admission filter, (c) a "pinned" set of always-warm keys. Simulate an attack and verify the hot set survives.

**Goal.** Build a production-resilient cache.

---

## Bonus: Open-Ended

### Task 26 — Design exercise

You are given a service:
- 50K req/s.
- Each request reads 3 cached values.
- 5M unique keys, Zipf 1.0.
- 1 GB memory budget.

Design a cache topology: tiers, capacity per tier, TTL, sharding, eviction policy. Estimate hit rate at each tier. Defend your choices.

**Goal.** Practice systems design with quantitative reasoning.

---

### Task 27 — Read a paper, reproduce

Read the TinyLFU paper (Einziger et al. 2017). Reproduce one experiment from the paper (e.g., comparing hit rate on a published trace). Discuss any differences.

**Goal.** Engage with the literature.

---

### Task 28 — Optimize an existing cache

Take your favorite cache from earlier tasks. Profile it with `pprof`. Find the top 3 CPU consumers. Apply optimizations (sync.Pool, bit-packing, hash function change). Re-benchmark. Document the wins.

**Goal.** Real performance work.

---

### Task 29 — Cache for a specific workload

Pick a real workload (web pages by URL, user profiles, image thumbnails). Characterize the access pattern (Zipf parameter, working set size, scan frequency). Design and implement a cache. Defend the algorithm choice.

**Goal.** Apply theory to practice.

---

### Task 30 — Build a cache benchmark suite

Open-source quality: benchmarks for LRU, sharded LRU, ristretto, sync.Map, on multiple workloads (uniform, Zipf, scan, mixed). Publish on GitHub. Compare your results with others.

**Goal.** Contribute to the ecosystem.

---

## Solutions

Reference implementations for each task are in the senior and professional files. The patterns are not secret; the practice is what matters.

For tasks 16-25, expect each to take 4-8 hours of focused work. For tasks 26-30, days or weeks. Take your time.

---

## A suggested sequence

For a junior engineer: tasks 1-7 in one week.
For a middle: tasks 8-15 over two weeks.
For a senior: tasks 16-25 over a month.
For a staff candidate: tasks 26-30 over a quarter.

The tasks are cumulative — each builds on prior knowledge. Skipping ahead is possible but not optimal.

---

## How to evaluate your solution

Each task is "done" when:

1. It runs without errors and passes the success criterion.
2. It passes `go test -race` if concurrency is involved.
3. The code is clear enough that a peer can read it in 5 minutes.
4. Edge cases are handled (zero capacity, nil values, concurrent shutdown).
5. Metrics are exposed if the task involves observability.

Self-graded. Be honest.

---

## Final note

The point of these tasks is not to build production caches — use libraries for that. The point is to internalize the mechanics so that when you read library source code, debug production incidents, or design new systems, the concepts are second nature.

Spend more time on tasks that humble you. Skip tasks that feel trivial. The middle ground is where the learning happens.
