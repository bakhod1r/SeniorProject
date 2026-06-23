---
layout: default
title: Interview
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/interview/
---

# Concurrent LRU — Interview Questions

> Questions from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is an LRU cache?

**Model answer.** An LRU (Least Recently Used) cache is a bounded key-value store. When the cache is full and a new entry must be inserted, the least recently used entry is evicted. "Recently used" tracks the order in which keys were last accessed via Get or Set.

**Common wrong answers.**
- "It's a TTL cache." (No — LRU evicts by recency, not by time.)
- "It's the same as FIFO." (No — FIFO evicts by insertion order, ignoring access.)

**Follow-up.** *Why is LRU effective?* — Because of temporal locality: keys accessed recently are more likely to be accessed again soon.

---

### Q2. What two data structures does a textbook LRU combine, and why?

**Model answer.** A hash map (for O(1) lookup of values by key) and a doubly-linked list (for O(1) reorder of entries by recency). The map's values are pointers into the list. Every Get and Set updates both views: lookup goes through the map; move-to-front goes through the list.

**Follow-up.** *Why doubly-linked, not singly-linked?* — To remove an entry from the middle in O(1), you need both prev and next pointers.

---

### Q3. Why doesn't `sync.RWMutex` help an LRU's Get?

**Model answer.** Because Get is a *write*: it moves the accessed entry to the front of the recency list. Multiple readers with RLock would race on the list mutation. The library `hashicorp/golang-lru/v2` uses an RWMutex but takes the write lock in Get — only Peek uses the read lock.

**Common wrong answers.**
- "Because RWMutex is slower than Mutex." (Irrelevant.)
- "Because Get returns a value." (Returning a value doesn't make it a writer; mutating the list does.)

---

### Q4. Show me a simple concurrent LRU in Go.

**Model answer.**

```go
import (
    "container/list"
    "sync"
)

type LRU[K comparable, V any] struct {
    mu       sync.Mutex
    capacity int
    items    map[K]*list.Element
    order    *list.List
}

type entry[K comparable, V any] struct {
    key K
    val V
}

func New[K comparable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{
        capacity: cap,
        items:    make(map[K]*list.Element, cap),
        order:    list.New(),
    }
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        e.Value.(*entry[K, V]).val = v
        c.order.MoveToFront(e)
        return
    }
    if c.order.Len() >= c.capacity {
        back := c.order.Back()
        kv := c.order.Remove(back).(*entry[K, V])
        delete(c.items, kv.key)
    }
    ent := &entry[K, V]{k, v}
    c.items[k] = c.order.PushFront(ent)
}
```

---

### Q5. What is the LRU invariant?

**Model answer.** The keys in the map are exactly the entries in the list, the lengths agree, and the size does not exceed capacity. Every operation must preserve this invariant when it returns.

---

### Q6. What does `hashicorp/golang-lru/v2.New` return?

**Model answer.** `(*Cache[K, V], error)`. The error is non-nil only if the size is `≤ 0`. The library prefers explicit error handling over panic.

**Follow-up.** *What constructor lets you provide an eviction callback?* — `NewWithEvict`.

---

### Q7. What is the difference between `Get` and `Peek`?

**Model answer.** Both look up a key. `Get` promotes the entry to MRU (updates recency). `Peek` does not change recency. Use `Peek` for diagnostics or debug dumps; use `Get` for application logic.

---

## Mid

### Q8. Why might a single-mutex LRU bottleneck a high-concurrency service?

**Model answer.** All operations serialize through one mutex. At high concurrency (many cores, many goroutines), only one goroutine is inside the cache at a time. Throughput plateaus around 5M ops/sec on modern CPUs. Beyond that, goroutines queue on `Lock()` and tail latency rises.

**Follow-up.** *How do you mitigate?* — Sharding: split the cache into N independent stripes, each with its own mutex. Throughput scales linearly with N until other bottlenecks (allocator, GC, hash) dominate.

---

### Q9. How would you shard a concurrent LRU?

**Model answer.** Use N shards (N is a power of two). For each operation, hash the key and pick `shard[hash(key) & (N-1)]`. Each shard is an independent LRU with its own mutex. Total capacity is split N ways.

```go
type ShardedLRU[K ~string, V any] struct {
    shards    []*lru.Cache[K, V]
    shardMask uint64
    seed      maphash.Seed
}

func (c *ShardedLRU[K, V]) Get(k K) (V, bool) {
    return c.pick(k).Get(k)
}
```

**Follow-up.** *Why power-of-two N?* — So `hash & (N-1)` replaces `hash % N` (faster, no division). *Why a random hash seed?* — To prevent crafted-collision attacks.

---

### Q10. What is `singleflight` and why does a cache need it?

**Model answer.** `golang.org/x/sync/singleflight` deduplicates concurrent calls to the same key. When 100 goroutines miss the same key simultaneously, `singleflight.Do(key, loader)` ensures only one `loader` call runs; the other 99 wait for its result.

Without `singleflight`, a cache miss spike triggers a thundering herd on the downstream system.

**Follow-up.** *What is the trade-off?* — All callers share the same error if the loader fails. For some workloads, retrying separately is preferable.

---

### Q11. Cache stampede: what is it and how do you prevent it?

**Model answer.** When a hot key's TTL expires, all concurrent requests miss simultaneously and hit the slow source. Preventions:

- **singleflight**: one loader per key.
- **Jittered TTL**: ±10% randomness in expiry so keys do not expire in lockstep.
- **Stale-while-revalidate**: serve stale data while a background loader refreshes.
- **Probabilistic early refresh**: as a key approaches TTL, occasionally refresh ahead of expiry.

---

### Q12. When would you choose 2Q or ARC over plain LRU?

**Model answer.**

- **2Q**: when scans (one-time bulk reads) regularly evict the hot set. 2Q's recent queue absorbs scans; only twice-accessed keys reach the main LRU.
- **ARC**: when the workload mixes recency and frequency unpredictably. ARC adapts its split via the parameter `p`.

For uniform workloads with stable hot sets, plain LRU is fine.

---

### Q13. Describe the `lru.Cache.Add` method's return value.

**Model answer.** It returns `bool` indicating whether an eviction occurred to make space for the new entry. Useful for metrics (`if evicted { evictCount.Inc() }`).

---

### Q14. What happens if the eviction callback calls back into the cache?

**Model answer.** Deadlock. The eviction runs while the cache's lock is held. Re-entering the cache attempts to acquire the same lock, which is not re-entrant. The goroutine deadlocks; depending on Go version and runtime, this may show up as a hang.

**Fix.** Push work to a separate goroutine: `go func() { cache.Remove(k) }()`.

---

### Q15. How would you cache values larger than the default size?

**Model answer.** Use cost-based capacity (ristretto's pattern). Each entry has a cost; the cache holds entries whose sum of costs does not exceed MaxCost. Big values are evicted preferentially.

For plain `hashicorp/golang-lru/v2`, manually size capacity for the smallest expected value to avoid memory blowup.

---

### Q16. Explain write-through, write-around, and write-back caching.

**Model answer.**

- **Write-through**: on update, write to source first, then update the cache. Cache always has fresh values. Risk: cache update can fail after DB succeeds.
- **Write-around**: on update, write to source first, then invalidate the cache. Next read repopulates. Simpler.
- **Write-back**: write to the cache first, flush to source asynchronously. Lowest write latency, highest risk (data loss on crash).

For most services, write-around is the default.

---

## Senior

### Q17. Walk me through ristretto's architecture.

**Model answer.** ristretto has several components:

- **storeMap**: sharded map (256 shards) for O(1) Get.
- **getBuf**: per-shard lossy buffers recording access events. Get pushes; background goroutine drains.
- **setBuf**: channel for pending Sets. Sender does not block; if full, Set is dropped.
- **policy**: W-TinyLFU. Includes Count-Min Sketch for frequency estimation, SLRU for storage.
- **processItems goroutine**: drains setBuf, decides admission (does this key's frequency exceed the victim's?), performs eviction, fires callbacks.

Get is lock-free past the storage shard's RLock. Set is non-blocking. The cache is *eventually* consistent — a Set may not be visible until the background processes it.

**Follow-up.** *What is the trade-off?* — Strict semantics are relaxed for throughput. The cache may drop Sets under heavy load; the cache may evict a key that was just Set.

---

### Q18. Explain the Count-Min Sketch.

**Model answer.** A CMS is a probabilistic data structure that estimates the frequency of an element in a stream. It uses `d` rows of `w` counters. To record an access, hash the key with `d` different hashes and increment all `d` counters. To estimate frequency, return the minimum of the `d` counter values.

The minimum gives an upper-bound estimate (collisions can only inflate counts; minimum bounds them).

**Error analysis.** Error ≤ ε × N with probability ≥ 1 - exp(-d), where ε = e/w. For ristretto's `d=4`, `w=1M`, errors are within 0.0001% × N — sufficient for ranking.

**Follow-up.** *Why halve the counters periodically?* — To forget stale popularity. Without aging, keys that were popular yesterday but cold today permanently outcompete current popular keys.

---

### Q19. What is BP-Wrapper and why does it matter?

**Model answer.** BP-Wrapper (Ding & Zhang 2008) is a technique to make replacement algorithms lock-free on the Get path. The idea: don't update recency synchronously. Push the access event to a per-thread (or per-shard) lossy buffer. A background goroutine drains the buffer and updates the recency list.

Result: Get is wait-free (one atomic push). The recency list lags reality by microseconds, but the cache still makes good eviction decisions.

ristretto uses this pattern.

---

### Q20. Why might you choose bigcache or freecache over an on-heap LRU?

**Model answer.** GC pressure. An on-heap LRU with millions of entries means millions of small heap objects. The Go GC scans them all on each cycle. For caches >1 GB, scan time becomes significant (100-200 ms pauses).

bigcache/freecache store values in a managed byte arena. The GC sees one large []byte instead of millions of pointers. GC time drops dramatically.

Trade-off: values must be serialised on Set, deserialised on Get. Adds CPU cost per operation.

**Follow-up.** *When NOT to use them?* — For small caches (<100 MB) where GC overhead is negligible; for caches with strict LRU semantics (bigcache is FIFO+TTL); for pointer-heavy values where serialisation cost exceeds GC savings.

---

### Q21. Detect a hot key and mitigate.

**Model answer.** Detection: instrument per-key access counts. A hot key has >10% of total operations. In a sharded cache, the shard holding the hot key shows disproportionate contention.

Mitigations:

- **Local L1 cache per goroutine**: absorbs the hot key without locks.
- **Replicated atomic pointer**: one per shard; reads hit the local replica.
- **Sticky routing**: all requests for the hot key go to one pod, eliminating cross-pod load.
- **Inlining**: if the hot key is a constant computation, move it out of the cache.

---

### Q22. How does sharding interact with eviction policies?

**Model answer.** Each shard has its own eviction list. A workload with skewed hashing can have one shard at capacity (evicting constantly) while others are idle. The effective cache is smaller than the nominal capacity.

ristretto-style global admission (TinyLFU) does not have this problem because admission is global, not per-shard.

---

### Q23. Describe the S3-FIFO algorithm.

**Model answer.** S3-FIFO uses three FIFO queues:

- **Small**: 10% of capacity, recent entries.
- **Main**: 90% of capacity, established entries.
- **Ghost**: tracks recently evicted keys (no values).

Rules: new keys enter Small. Hits increment a per-entry counter (0-3, saturating). When Small evicts: count ≥ 1 → promote to Main; else if key in Ghost → ignore; else → add to Ghost. When Main evicts: count ≥ 1 → reinsert at back; else → drop. A miss whose key is in Ghost inserts directly to Main.

The algorithm is simpler than W-TinyLFU and empirically beats it on most production traces (FAST 2024 paper).

---

### Q24. Why is `Get` an atomic write on a Clock cache?

**Model answer.** Clock cache replaces the per-entry "last access timestamp" with a per-entry boolean "referenced" flag. Get sets the flag (atomic write). Eviction walks the array looking for `referenced=false`; clears flags as it goes (second-chance).

The atomic write on Get is wait-free. The eviction takes the writer lock. Reads scale linearly with cores in the absence of contention on Set.

---

### Q25. What is "stale-while-revalidate" and when do you use it?

**Model answer.** Two TTLs per entry: soft (start refresh) and hard (must reload synchronously). On Get:

- Age < soft TTL: return cached value.
- Soft TTL ≤ age < hard TTL: return cached value AND start a background refresh.
- Age ≥ hard TTL: load synchronously.

The pattern eliminates the latency spike at TTL expiry. Use for caches with predictable refresh costs and tight p99 budgets.

---

### Q26. Show me a sharded cache that pads against false sharing.

**Model answer.**

```go
type shard[K ~string, V any] struct {
    inner *lru.Cache[K, V] // 8 bytes
    _pad  [56]byte         // 56 bytes
    // total = 64 bytes (one cache line on amd64)
}
```

Each shard's struct occupies exactly one cache line. Two adjacent shards do not share a line. Mutations on one shard do not invalidate the L1 cache of another.

Verify with `unsafe.Sizeof(shard[string, int]{})`.

---

## Staff

### Q27. Design a cache for a 1M-QPS service with 10M unique keys.

**Model answer.** A multi-tier approach:

- **L1 per-goroutine**: tiny (10 entries) for very hot keys; no locks. Absorbs ~30% of traffic.
- **L2 per-pod ristretto**: 5M capacity, 64 shards. Absorbs ~95% of remaining traffic.
- **L3 Redis cluster**: 50M capacity, shared across pods. Absorbs ~90% of L2 misses.
- **DB with proper indexes**: source of truth.

Capacity sizing:

- L1: 10 entries/goroutine, negligible.
- L2 per pod: 5M × 600 bytes ≈ 3 GB.
- L3: 50M × 600 bytes ≈ 30 GB (shared).

Pod count: 1M QPS / per-pod throughput. Per-pod ~100K QPS → 10 pods minimum, scale to 30 for headroom.

Coherence: 5-minute TTL plus Redis pub/sub for explicit invalidations.

Observability: hit rate per tier; eviction rate per tier; lock contention; GC overhead.

---

### Q28. How do you measure cache effectiveness in production?

**Model answer.** Multiple metrics:

- **Hit rate**: total and per-key-prefix.
- **Eviction rate**: high rate signals undersized cache.
- **Cache size**: should equal capacity in steady state.
- **Mutex contention**: from `runtime.SetMutexProfileFraction(1)`.
- **Latency**: p50, p99 for both hits and misses.
- **GC overhead**: from `GODEBUG=gctrace=1`.
- **Memory footprint**: from `runtime.MemStats`.

Dashboards: hit rate over time, eviction rate, latency breakdowns. Alerts: hit rate < threshold for N minutes.

For cache sizing, periodically compute the Miss Ratio Curve (Mattson's algorithm) from a representative trace.

---

### Q29. The cache hit rate dropped from 95% to 30%. How do you diagnose?

**Model answer.** Systematic checklist:

1. **Per-prefix hit rate**: which prefixes dropped? Often it's one specific key pattern.
2. **Working set size**: did the access pattern change? A new feature might introduce a new dimension to keys.
3. **Eviction rate**: spiked means working set exceeds capacity.
4. **Recent deploys**: any code path that adds dimensions to cache keys?
5. **Traffic source**: a bot or scan attack?

Common causes: new feature adds experiment ID to keys → key space multiplies; bulk import touches every key; cache config changed (lower capacity); downstream returns different values on each request.

Fix: depends on cause. Restore key normalization, increase capacity, add admission filter (W-TinyLFU), or rate-limit the source.

---

### Q30. Describe the cache invalidation problem in a multi-pod deployment.

**Model answer.** Each pod has its own in-memory cache. A write on pod A invalidates A's local cache but not B's. Until B's TTL expires, B serves stale.

Solutions:

- **Short TTL**: eventually consistent within TTL window. Simple but adds load.
- **Pub/sub invalidation**: pod A publishes "invalidate key K" to a Redis/Kafka channel; all pods Remove. Sub-second consistency. Adds infrastructure.
- **Change Data Capture (CDC)**: database changes feed a stream; pods invalidate based on the stream. Sub-second consistency. Better isolation.
- **Versioned reads**: each entry has a version; on Get, verify against a fast version store. Strong consistency at the cost of every Get making two operations.
- **Centralised cache**: skip per-pod; everyone uses Redis. Higher latency.

Pick based on freshness requirements and operational complexity tolerance.

---

### Q31. What is the relationship between cache theory and information theory?

**Model answer.** A cache of `C` keys can hold at most `C log₂(N)` bits of information about "which keys are valuable." The hit rate is bounded by how much of the access trace this information predicts.

For Zipf-distributed workloads, the entropy is low (popularity concentrates); small caches capture most accesses. For uniform workloads, entropy is maximum; only a cache near `N` helps.

Belady's algorithm achieves the information-theoretic optimum given perfect lookahead. Online algorithms (LRU, LFU, W-TinyLFU) approximate Belady's; competitiveness analysis (Sleator & Tarjan 1985) bounds how close they get.

---

### Q32. When would you build a cache from scratch instead of using a library?

**Model answer.** Rarely. Acceptable reasons:

- **Novel key type** with specific layout (e.g., fixed-size structs for direct memory layout).
- **Novel eviction policy** (research, custom workload). 99% of the time, an existing policy fits.
- **Extreme constraints** (zero allocations per op, embedded environment).
- **Learning**: building one teaches the principles deeply.

Unacceptable reasons:

- "It looks easy."
- "We want fewer dependencies."
- "Our cache library has a feature we don't need."

For production: use a library. The libraries have years of bug-fixes you don't want to redo.

---

### Q33. Show me how false sharing affects a cache benchmark.

**Model answer.**

```go
// Before — fields adjacent on cache line
type Counter struct {
    hits   atomic.Uint64
    misses atomic.Uint64
}

// After — padded
type Counter struct {
    hits   atomic.Uint64
    _      [56]byte
    misses atomic.Uint64
    _      [56]byte
}
```

Without padding, hits and misses share a 64-byte cache line. When goroutine A increments hits on CPU 0 and B increments misses on CPU 1, the line ping-pongs between CPUs. Each increment costs ~100 ns instead of ~5 ns.

With padding, each counter occupies its own line. 10-20x throughput improvement under contention.

Verify by benchmarking before and after, or by reading `L1-dcache-load-misses` from `perf stat`.

---

### Q34. What does "linearizable" mean for a cache, and is `hashicorp/golang-lru/v2` linearizable?

**Model answer.** Linearizability: each operation appears to take effect atomically at some instant between its invocation and return. A linearizable cache behaves as if all operations executed in a serial order.

`hashicorp/golang-lru/v2` is linearizable per cache: every operation holds the mutex during its critical section. From any external observer, operations appear in a serial order.

ristretto is *not* linearizable. Sets may not be visible to subsequent Gets until a background goroutine processes them. This is intentional — strict linearizability requires synchronization that ristretto avoids for throughput.

---

### Q35. Compare LRU, LFU, and ARC on a scan-heavy workload.

**Model answer.**

- **LRU**: catastrophic. The scan touches each key once; every scan key becomes "most recent." After the scan, the cache contains only scan keys, hot keys evicted.
- **LFU**: better. Scan keys all have count 1; hot keys have higher counts. LFU prefers high counts. But LFU is slow (sorting by count) and has its own issues (stale-popularity).
- **ARC**: handles it well. New (one-time) keys land in T1 (recency). When they age out without re-access, they go to B1 (ghost). The hot keys in T2 are untouched.

Empirical hit rates on a 90% hot + 10% scan workload:

- LRU: ~60% (collapses).
- LFU: ~75%.
- ARC: ~82%.
- W-TinyLFU: ~88% (admission filter blocks scan keys from entering main cache).

---

### Q36. How does Go's escape analysis affect cache performance?

**Model answer.** Local variables that "escape" their function get heap-allocated instead of stack-allocated. Each heap allocation is GC-tracked and adds pressure.

In a cache, the most common offender is the hash struct in `pick()`:

```go
func (c *Cache) pick(k string) *shard {
    var h maphash.Hash // does it escape?
    h.SetSeed(c.seed)
    h.WriteString(k)
    return c.shards[h.Sum64()&c.shardMask]
}
```

If escape analysis decides `h` escapes, every `pick()` allocates. Verify with `go build -gcflags=-m`.

Workaround: `sync.Pool` of reusable hash structs, or use a hash function that doesn't allocate (custom inline implementation).

---

### Q37. Outline the test plan for a new cache implementation.

**Model answer.**

1. **Unit tests**: basic Set/Get/Remove sequences; eviction order; TTL expiry; edge cases (zero capacity, single entry, full cache).
2. **Concurrent tests under `-race`**: many goroutines doing mixed operations. Check Len ≤ capacity at the end.
3. **Property tests**: random op sequences. Check invariants hold.
4. **Benchmarks**: single-threaded and parallel. Compare against `hashicorp/golang-lru/v2`.
5. **Stress tests**: 1+ hour run with heavy load. Check no memory growth, no panics.
6. **Trace replay**: real production traces fed through; check hit rate matches expectations.
7. **Chaos tests**: inject failures (panicking callbacks, slow loaders, downstream errors). Check graceful degradation.

Run benchmarks and unit tests in CI. Run stress and trace replay tests pre-release.

---

### Q38. What are the patent and licensing concerns for ARC?

**Model answer.** ARC (Megiddo & Modha 2003) was patented by IBM (US Patent 6,996,676). The patent expired in 2024.

Before expiry, implementations had to either license or use modified variants. `hashicorp/golang-lru/v2.NewARC` is a modified ARC that avoids the patented claims.

For new projects, ARC is no longer a licensing risk. But other algorithms (some LFU variants) have similar issues; always check before adopting.

---

## Quick-Fire Questions

- Q: Time complexity of LRU Get? A: O(1).
- Q: Memory overhead per entry in `hashicorp/golang-lru/v2`? A: ~100 bytes (entry + element).
- Q: What does Resize(0) do? A: Returns an error in v2; sometimes panics in v1.
- Q: Can two LRUs share a list? A: No.
- Q: Why is `container/list` not safe for concurrent use? A: Multiple pointer writes per operation; concurrent access corrupts the list.
- Q: What is the cost of a cache miss in a sharded LRU? A: One Get + one Add. Each is O(1).
- Q: How does `hashicorp/golang-lru/v2` track eviction order? A: Doubly-linked list via `container/list`.
- Q: Why does Peek take RLock and Get take Lock? A: Get mutates (MoveToFront); Peek doesn't.
- Q: What does `lru.NewWithEvict` add? A: A callback invoked on each eviction.
- Q: Can the callback re-enter the cache? A: No. Deadlock.

---

## Conclusion

These questions cover the spectrum from basic LRU mechanics to production-scale architecture. A candidate at level X can usually answer questions through level X with confidence and questions at level X+1 with thought. Staff-level interviewing means probing into theory, trade-offs, and judgment — not just facts.
