---
layout: default
title: Interview
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/interview/
---

# TTL Caches — Interview Questions

> Graded Q&A spanning junior to staff. Each question carries a model answer, the common wrong answers, and follow-up probes a strong interviewer will use to push deeper.

---

## Junior

### Q1. What is a TTL cache?

**Model answer.** A TTL (time-to-live) cache stores key-value entries that automatically become invalid after a fixed duration. After `Set(k, v, 5*time.Second)`, `Get(k)` returns `v, true` for five seconds; after five seconds it returns `_, false`. The cache enforces a contract: entries live for a bounded duration, after which they are considered gone whether or not anybody asked for them.

**Common wrong answers.**
- "It's a normal map." (No — a map has no expiration.)
- "It's a cache that you must manually clean." (Partial; the cache itself should reclaim memory.)
- "It's for storing temporary data." (Too vague — every cache holds non-permanent data.)

**Follow-up.** *Why TTL instead of LRU?* — TTL bounds *time* (data freshness, write-through delay); LRU bounds *space* (memory footprint, hot-set capture). Many caches combine both: TTL for freshness, LRU for capacity.

---

### Q2. What does this code print?

```go
cache := newCache()
cache.Set("k", "v", 100*time.Millisecond)
time.Sleep(50 * time.Millisecond)
v1, ok1 := cache.Get("k")
time.Sleep(100 * time.Millisecond)
v2, ok2 := cache.Get("k")
fmt.Println(v1, ok1, v2, ok2)
```

**Model answer.** `v ok1=true "" ok2=false`. After 50 ms the entry is alive. After another 100 ms (total 150 ms), the entry has expired. The second `Get` returns the zero value and `false`.

**Follow-up.** *What if the cache uses lazy expiration only?* — Same observable result. Even with lazy expiration, `Get` checks the deadline and returns `false` for expired entries. The difference is whether the entry has been *removed from memory*. Lazy: it sits there until next access. Active: a sweeper removed it already.

---

### Q3. What is wrong with this implementation?

```go
type Cache struct {
    m map[string]item
}

func (c *Cache) Get(k string) (string, bool) {
    e, ok := c.m[k]
    if !ok || time.Now().After(e.deadline) {
        return "", false
    }
    return e.value, true
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.m[k] = item{value: v, deadline: time.Now().Add(ttl)}
}
```

**Model answer.** No synchronisation. Concurrent `Get`/`Set` produce a data race on the map — the runtime will detect this and panic with `fatal error: concurrent map writes`. Go's map is not safe for concurrent use.

**Fix.** Add a `sync.RWMutex`:

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]item
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.m[k]
    if !ok || time.Now().After(e.deadline) {
        return "", false
    }
    return e.value, true
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = item{value: v, deadline: time.Now().Add(ttl)}
}
```

**Follow-up.** *Why `RWMutex` and not `Mutex`?* — Reads dominate writes in most caches by 10x or more. `RWMutex` allows concurrent readers, increasing throughput. The cost is a slightly more expensive write.

---

### Q4. What is lazy expiration vs active expiration?

**Model answer.**
- **Lazy.** The cache checks the deadline only inside `Get`. Expired entries occupy memory until a reader stumbles on them. Simple, but unbounded memory if the workload writes and abandons.
- **Active.** A background sweeper goroutine periodically scans the cache and removes expired entries. Bounds memory; costs CPU and lock time.

Most production caches combine both: lazy on the hot path, active in the background to reclaim memory for cold keys.

**Follow-up.** *What happens if you only have lazy?* — Memory grows linearly with insert rate until pressure forces an eviction. A cache that writes 1 K keys/sec with a 1-hour TTL will hold up to 3.6 M entries even if nobody reads them.

---

### Q5. Why is `time.Now().UnixNano()` not ideal for storing deadlines?

**Model answer.** `time.Time` carries both a wall-clock and a monotonic component. `UnixNano()` returns only the wall-clock. If the system clock jumps backward (NTP adjustment, daylight saving, manual `date -s`), deadlines stored as nanoseconds may suddenly be in the "future," and entries appear immortal.

`time.Time` operations (`Sub`, `Before`, `After`) use the monotonic component when both operands have it, immune to clock jumps. So:

```go
deadline := time.Now().Add(ttl) // carries monotonic
if time.Now().Before(deadline)  // uses monotonic; safe
```

is more robust than int64 nanos.

**Follow-up.** *When does the monotonic component get stripped?* — Marshalling (JSON, gob), `Round`, `Truncate`, and a few package APIs strip it. After that the comparison falls back to wall-clock. For an in-memory cache, the monotonic survives the lifetime of the entry.

---

### Q6. What does this print?

```go
cache := newCache()
cache.Set("k", 1, time.Second)
go cache.Set("k", 2, time.Second)
v, _ := cache.Get("k")
fmt.Println(v)
```

**Model answer.** Either `1` or `2` — race between the read and the concurrent write. The Go runtime synchronises via the cache's internal mutex, so this is *not* a data race; it is a benign read-write race in the program logic. The cache contract makes no promise about which write a concurrent read sees.

**Follow-up.** *How would you make this deterministic?* — You cannot, with concurrent writes. If the order matters, serialise externally (a channel into the cache, or a sequence number passed by the caller).

---

### Q7. Why might a TTL cache return `false` even immediately after `Set`?

**Model answer.** Three reasons:

1. **The TTL was zero or negative.** Most caches treat zero as "expired on arrival" — depends on the library.
2. **Capacity-bound eviction.** Caches with strict capacity bounds may immediately evict newly inserted entries if they fail admission (ristretto's TinyLFU does this — `Set` returns true but `Get` may still miss).
3. **Concurrent `Delete` or expiration sweep racing the read.** Unlikely with a brand-new entry but possible.

**Follow-up.** *Does this break the cache contract?* — No. Cache reads are best-effort. The contract is "if I have it, return it"; never "I will keep it."

---

## Middle

### Q8. Explain the trade-off between lazy and active expiration.

**Model answer.**

| Aspect | Lazy | Active |
|---|---|---|
| Memory | Unbounded (until access) | Bounded (sweeper reclaims) |
| CPU | Zero overhead when idle | Periodic sweep cost |
| Latency | Read path adds one deadline check | Sweep may hold a lock |
| Implementation | Trivial | Needs sweeper goroutine, shutdown, jitter |

Production caches combine both. Lazy handles the hot keys (no cost when not read). Active handles the cold tail (entries that would otherwise leak forever).

**Follow-up.** *How often should the sweeper run?* — Trade-off between memory bloat and lock pressure. A cache holding entries with 1-hour TTL can sweep every 30 seconds. A cache with 1-second TTL must sweep every ~100 ms. Tune by measuring `cache_expired_on_read_total` — if many reads find expired entries, sweeper is underrunning.

---

### Q9. Why do many production TTL caches shard internally?

**Model answer.** A single `sync.RWMutex` becomes a contention bottleneck above ~100 K ops/sec on a multi-core machine. Sharding by hash partitions the cache into N independent maps with their own mutexes. Each operation locks only one shard, so contention drops by a factor of N.

```go
const shards = 256
func (c *Cache) shardFor(k string) *shard {
    return c.shards[hash(k) % shards]
}
```

Most Go caches use 64–256 shards. Beyond 1024, sharding overhead (small per-shard maps, hashing cost, sweeper coordination) outweighs the contention saved.

**Follow-up.** *Why a power of 2 in shard count?* — Enables `hash & (shards-1)` instead of `hash % shards`, eliminating a division. Tiny gain per op, but `Get` is on the hottest path.

---

### Q10. What is the thundering herd problem on a TTL cache?

**Model answer.** When a hot key expires, every concurrent reader misses simultaneously. All of them attempt to reload from the origin (database, upstream service). The origin sees a sudden burst — often 1000x baseline RPS — which may exhaust its connection pool, trigger rate limits, or simply melt under load.

The herd is fundamentally a coordination failure: many readers, one fact, one expiry instant.

**Fix.** Use `golang.org/x/sync/singleflight` to coalesce concurrent identical loads:

```go
v, _, _ := sf.Do(key, func() (any, error) {
    return fetchFromOrigin(key)
})
```

Among 1000 concurrent misses on the same key, exactly one calls `fetchFromOrigin`; the others wait on the shared result.

**Follow-up.** *Does singleflight solve the problem entirely?* — Not entirely. The first miss still has the origin's latency. For very hot keys, also use **probabilistic early refresh** (refresh slightly before expiry) and **jittered TTL** (spread expiry instants).

---

### Q11. What is jittered TTL and why does it matter?

**Model answer.** Without jitter, batch-loaded keys all expire in the same millisecond. Imagine warming the cache at startup with 10 K keys, all with TTL 10 minutes. Ten minutes later, all 10 K keys expire at once. Even with singleflight per key, the origin sees a 10 K-key burst.

**Jittered TTL** adds a random offset:

```go
jitter := time.Duration(rand.Int63n(int64(jitterRange)))
cache.Set(k, v, baseTTL + jitter)
```

A typical jitter range is 10–25% of base TTL. The 10 K keys now expire spread over the last 1–2.5 minutes, smoothing the load.

**Follow-up.** *Why not jitter when reading?* — The deadline is fixed at write time. Adjusting on read would require mutation, which complicates the read path and breaks deadline ordering for the sweeper.

---

### Q12. What does `singleflight.Group.Forget` do?

**Model answer.** `Forget(key)` removes a key from the in-flight tracking. If a previous `Do(key, fn)` returned an error and that error is now stale (the upstream recovered), `Forget(key)` allows the next call to actually invoke `fn` rather than returning the cached error to all current waiters.

```go
v, err, _ := sf.Do(key, fetch)
if err != nil {
    sf.Forget(key) // next caller will retry
    return err
}
```

Without `Forget`, the second caller to `Do(key, fetch)` reuses the *result* (including error) of the first call as long as it is still tracked. Calling `Forget` clears that tracking entry.

**Follow-up.** *Wait, does Do cache the result?* — Briefly. `Do` only deduplicates *currently in-flight* calls. Once the in-flight call completes, the next `Do` starts a new fetch. The bug pattern with errors comes from how some implementations retain the result for a short tail.

---

### Q13. What goes wrong with this sweeper?

```go
go func() {
    for {
        time.Sleep(time.Second)
        c.mu.Lock()
        for k, e := range c.m {
            if time.Now().After(e.deadline) {
                delete(c.m, k)
            }
        }
        c.mu.Unlock()
    }
}()
```

**Model answer.**

1. **No shutdown.** The goroutine runs forever. `Close()` cannot stop it. In tests, this leaks goroutines into the next test.
2. **Long lock under write.** For a 10 M entry cache, holding the write-lock for the full scan stalls every reader for hundreds of ms.
3. **`time.Sleep` is uncancellable.** Even if you add a quit channel, the goroutine sleeps for up to 1 s before noticing.
4. **No jitter on sweep cadence.** Multiple cache instances tick together.

**Fix.**

```go
go func() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            c.sweepBatch()
        case <-c.quit:
            return
        }
    }
}()
```

`sweepBatch` releases the lock between small batches, so readers are never blocked for long.

**Follow-up.** *How would you avoid scanning the whole map?* — Maintain a min-heap of `(deadline, key)`. The sweeper pops entries until it sees a future deadline. O(log n) per eviction instead of O(n) per sweep.

---

### Q14. Compare `sync.Map` vs `map + sync.RWMutex` for a TTL cache.

**Model answer.**

**`sync.Map`** is optimised for:
- Many writes to distinct keys.
- Single-write, many-read patterns.
- Lock-free reads after the key stabilises.

**Drawbacks for TTL caches.**
- No `Len`. Maintain `atomic.Int64` separately.
- No iteration order. Sweeping is racy with concurrent modification.
- No CAS for compound values. You must wrap.
- Higher memory per entry.

`map + sync.RWMutex` wins for:
- Tight memory budget.
- Frequent iteration (e.g. sweeping).
- Workloads where writes are common.

`sync.Map` wins for:
- Read-mostly hot path.
- Skewed access pattern where a few keys dominate.
- High goroutine concurrency.

A common production layout: `sync.Map` for the hot path, a separately-locked min-heap for expiration ordering.

**Follow-up.** *Does `sync.Map` use a single mutex?* — Internally it has two maps — a read-only `atomic.Pointer` map and a dirty map with its own mutex. Reads of stable keys are lock-free. The dirty map is promoted when reads start missing. This bimodal behaviour is what makes `sync.Map` faster for read-mostly.

---

### Q15. You set `Set(k, v, 30*time.Minute)`. The next `Get(k)` returns `false`. Name three causes.

**Model answer.**

1. **Capacity eviction.** The cache reached its capacity bound and dropped `k`. Some libraries report this in metrics; some do not. ristretto specifically may reject admission of new entries via TinyLFU.
2. **Concurrent `Delete`.** Another goroutine called `Delete(k)` between `Set` and `Get`.
3. **Different shard interpretation.** With a buggy hash function, `Set` and `Get` may land in different shards. Less common but real, especially with custom keys.

Other possibilities:
- The cache uses a global TTL that overrides the per-entry TTL.
- TTL was negative or zero with library-specific semantics.
- Process panicked and a recovery handler swallowed it.

**Follow-up.** *How do you tell which one?* — Metrics. A `cache_evictions_total{reason=capacity}` counter that ticked recently is the smoking gun.

---

### Q16. What does a `cache_expired_on_read_total` counter tell you?

**Model answer.** It counts how many `Get` calls returned `false` because the entry existed but its deadline had passed. A high rate indicates:

- **Sweeper is underrunning.** Expired entries are accumulating; they get reclaimed only when accessed. Memory pressure builds.
- **Or, TTL is too aggressive.** Entries are dying faster than expected. Consider longer TTL or a different freshness contract.

A healthy cache has near-zero `expired_on_read` because the sweeper removes entries before anyone reads them again. The metric is most useful comparatively: if it ticks up after a deployment, something regressed.

**Follow-up.** *What metric pairs nicely with this?* — `cache_sweep_removed_total` (sweeper's work) and `cache_size_entries` (memory). If `expired_on_read` rises and `sweep_removed` doesn't, sweeper is broken. If both rise, write rate increased and tuning is fine.

---

## Senior

### Q17. Walk through a TTL cache with a min-heap of deadlines. What does it cost you?

**Model answer.**

```go
type entry struct {
    key      string
    value    any
    deadline time.Time
    index    int // for heap operations
}

type Cache struct {
    mu   sync.Mutex
    m    map[string]*entry
    pq   priorityQueue // heap of *entry by deadline
}
```

On `Set`:
1. Insert into `m`.
2. Push onto `pq`. O(log n).

On `Get`:
1. Lookup in `m`. O(1).
2. Check deadline.

The sweeper:
1. Peek at the top of `pq`. O(1).
2. If its deadline is past, pop, delete from `m`, repeat. O(log n) per eviction.
3. Stop at the first entry whose deadline is future.

**Cost.** A min-heap is O(log n) for insert and delete. The map is still O(1). On hot inserts, you pay the heap insert. The benefit: the sweeper never scans live entries.

**Subtleties.**

- **Updates.** `Set(k, v, newTTL)` on an existing key must update the heap position, not just push a new entry. Otherwise the heap accumulates stale entries.
- **Sieve approach.** Some implementations skip heap updates and let the sweeper validate against `m` — if the popped entry's key no longer maps to it, skip. Simpler but bloats the heap.
- **Lock granularity.** If you shard, each shard has its own heap. The sweeper visits shards in turn or runs one goroutine per shard.

---

### Q18. Design a TTL cache with stale-while-revalidate semantics.

**Model answer.** Stale-while-revalidate (SWR): when an entry passes its "fresh" deadline but is still within its "stale" deadline, serve it immediately and refresh asynchronously.

```go
type Entry struct {
    Value          any
    FreshUntil     time.Time
    StaleUntil     time.Time
}

func (c *Cache) Get(ctx context.Context, key string) (any, error) {
    e, ok := c.load(key)
    if !ok {
        return c.synchronousFetch(ctx, key)
    }
    now := time.Now()
    if now.Before(e.FreshUntil) {
        return e.Value, nil // fresh
    }
    if now.Before(e.StaleUntil) {
        c.asyncRefresh(key) // serve stale, refresh in background
        return e.Value, nil
    }
    return c.synchronousFetch(ctx, key) // too stale
}
```

**Async refresh.** Must be deduplicated (singleflight on the key). Must be bounded (max in-flight refreshes). Must not block the caller.

**Why this matters.** It hides origin latency from the client during refresh, at the cost of serving slightly stale data. Common in CDN-style and config services.

**Follow-up.** *What metrics do you add?* — `cache_serve_fresh_total`, `cache_serve_stale_total`, `cache_serve_miss_total`. The ratio of stale to fresh tells you whether your refresh logic is keeping up.

---

### Q19. Why does ristretto's `Set` return a `bool` that can be `false` even when the cache has space?

**Model answer.** Ristretto uses **TinyLFU admission**. Before admitting a new entry, the cache asks: "Has this key been requested recently enough to outrank the entry it would evict?"

The frequency sketch tracks per-key access counts. On `Set`, ristretto compares the candidate key's count against the LFU victim's count. If the candidate is colder, it is rejected — even if the cache has free capacity. The reasoning: admitting a one-hit-wonder might evict a frequently-used entry. Rejecting cold candidates protects hit ratio.

**Implication for callers.** `Set(k, v) == true` does not guarantee `Get(k)` will succeed. The contract is "we tried to admit it; further admission policy may have other ideas."

**Follow-up.** *Doesn't this break cache semantics?* — Only if you assume eventual `Get` success. The cache layer is best-effort; the caller must always be ready to handle a miss. Ristretto trades guaranteed admission for higher steady-state hit ratio. For applications where every `Set` must be visible — for example, a write-through to a slow store with a cache veneer — ristretto is the wrong tool.

---

### Q20. Why does bigcache avoid GC pressure?

**Model answer.** Go's GC scans live pointers to determine reachability. A map of 10 M entries, each holding pointers, is 10 M pointers per GC cycle to trace. With concurrent GC, this adds CPU and, more importantly, lengthens the mark phase.

Bigcache stores values as `[]byte` inside per-shard ring buffers. A `[]byte` is internally a pointer + length + capacity, but the *contents* of the byte slice are not traced as individual pointers — they are opaque bytes. So 10 M entries become 10 M slice headers (which are traced), but the GC does not walk inside each value.

The cost: every `Set` serialises the value to bytes; every `Get` deserialises. CPU goes up, GC pause goes down.

**Follow-up.** *When is this worth it?* — When GC pause becomes user-visible. P99 latency on a large heap can spike to tens or hundreds of ms during GC. Apps that hold tens of millions of cache entries benefit; small caches do not.

---

### Q21. How would you implement cache invalidation across multiple service instances?

**Model answer.** Cache coherence across processes is a distributed-systems problem.

**Options.**

1. **TTL-only.** Each instance holds its own cache; stale data lives until TTL expires. Simplest, weakest consistency. Acceptable for read-mostly data with bounded staleness tolerance.
2. **Pub/sub invalidation.** Service A updates the DB, then publishes `cache.invalidate(key)` on Redis pub/sub or NATS. All instances subscribe and `Delete(key)` locally. Fast, but requires reliable delivery; missed messages mean stale entries until TTL.
3. **Versioned keys.** Cache by `(key, version)`. On update, increment the version (in Redis or DB). Reads include the version. Old entries become unreachable. Memory grows until TTL clears them.
4. **Shared cache (Redis).** Skip local caches; everyone hits Redis. Strong consistency, but you pay network latency on every read.
5. **Two-tier (local + shared).** Local L1 with short TTL, shared L2 (Redis) with longer TTL. L1 catches the bulk of reads; L2 catches L1 misses; coherence is bounded by L1 TTL.

**Trade-offs.**

| Approach | Latency | Consistency | Complexity |
|---|---|---|---|
| TTL only | Lowest | Eventual, bounded by TTL | Lowest |
| Pub/sub invalidation | Low | Strong if delivery reliable | Medium |
| Versioned keys | Low | Strong | Medium |
| Shared cache | Medium | Strong | Low |
| Two-tier | Low | Bounded eventual | High |

The right pick depends on staleness tolerance and request volume.

---

### Q22. Walk through a thundering herd scenario step by step, then describe each mitigation.

**Model answer.**

**Scenario.** A product catalog service holds `product:123` with TTL 60 s. The product has 10 K QPS. At T=60 s, the entry expires. Between T=60 s and T=60 s + origin_latency (~50 ms), 500 reads arrive. Each finds an empty cache and fetches from the upstream catalog DB. The DB suddenly sees a 500-request burst on the same query.

**Mitigation 1: singleflight.** Wrap the origin call in `singleflight.Group.Do`. The first request triggers the fetch; the other 499 wait. Burst on DB: 1, not 500.

```go
v, _, _ := sf.Do("product:123", func() (any, error) {
    return db.LoadProduct(123)
})
```

**Mitigation 2: jittered TTL.** Instead of every entry expiring at exactly 60 s, expire at `60 + rand(0, 15)` s. For 10 K products, expiry instants spread over 15 s. Per-second herd reduced 15x.

**Mitigation 3: probabilistic early refresh.** Before TTL fires, a small percentage of reads probabilistically trigger a background refresh. By the time TTL would have fired, the entry is already refreshed. The herd never materialises.

**Mitigation 4: stale-while-revalidate.** Even when TTL fires, serve the stale value to readers for up to `staleWindow` while one async refresh runs. No reader waits for the origin.

**Mitigation 5: external locking.** A Redis lock (`SETNX`) coordinates refresh across instances. Only one process per cluster fetches at a time. More moving parts; rarely needed if singleflight + jitter + SWR are in place.

**Stacking the mitigations.** Production-grade caches use *all* of these. The single most effective is singleflight; the rest sand down the edges.

---

### Q23. Design a TTL cache for 100 M entries, 200 GB working set, 1 M ops/sec. Which library and why?

**Model answer.**

**Constraints to weigh.**
- 200 GB does not fit in process heap on most machines; this is a cluster-scale cache.
- 100 M entries in a Go map produces 4–8 GB of map overhead plus GC scan cost.
- 1 M ops/sec across 256 shards is ~4 K ops/shard/sec — well within `sync.RWMutex` capacity.

**Architecture.**

1. **Two tiers.** A local in-process L1 (small, fast, ~100 K entries) and a distributed L2 (Redis Cluster or Memcached).
2. **L1 implementation.** `ristretto` if the workload is read-heavy with skew (hit ratio matters); `bigcache` if entries are large and GC pause dominates.
3. **L2 implementation.** Redis Cluster with consistent hashing. TTL set on Redis side.
4. **Coherence.** L1 has short TTL (10–60 s). L2 has long TTL (5–60 min). Invalidation on write goes to L2; L1 auto-refreshes on TTL.
5. **Singleflight on L1 misses.** Every miss into L2 is coalesced per key per process.

**Why not just one big in-process cache.** 200 GB in one process is a GC nightmare and a single point of failure. Distributing across L2 nodes spreads memory and provides failover.

**Why not just Redis.** Network RTT for every read is 200 µs+. L1 absorbs the hot 90% in <1 µs.

**Follow-up.** *What about freecache for L1?* — Fine if you want a hard memory cap on L1. Pre-allocates a ring buffer, never grows. Pairs well with limited-memory containers.

---

### Q24. Write a worker that periodically refreshes hot keys. What concurrency hazards do you need to address?

**Model answer.**

```go
type Refresher struct {
    cache   *Cache
    hot     []string
    load    func(ctx context.Context, key string) (any, error)
    period  time.Duration
    quit    chan struct{}
    sf      singleflight.Group
    sem     chan struct{} // bounds in-flight refreshes
}

func (r *Refresher) Run(ctx context.Context) {
    ticker := time.NewTicker(r.period)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            for _, k := range r.hot {
                k := k
                select {
                case r.sem <- struct{}{}:
                    go func() {
                        defer func() { <-r.sem }()
                        rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
                        defer cancel()
                        r.sf.Do(k, func() (any, error) {
                            v, err := r.load(rctx, k)
                            if err == nil {
                                r.cache.Set(k, v, ttlFor(k))
                            }
                            return v, err
                        })
                    }()
                default:
                    // refresh backlog full; skip this tick for this key
                }
            }
        case <-r.quit:
            return
        case <-ctx.Done():
            return
        }
    }
}
```

**Hazards addressed.**

1. **Bounded parallelism.** `r.sem` caps in-flight refreshes. Without it, a slow origin causes goroutine explosion.
2. **Singleflight.** Combines with normal on-demand reads — they share the in-flight refresh.
3. **Timeout per refresh.** A stuck origin call does not pin a goroutine forever.
4. **Multiple shutdown channels.** Both `quit` and `ctx.Done` end the loop.
5. **Backlog skip.** If refreshes are backing up, drop this tick for that key rather than queuing forever.
6. **No mutation of `r.hot` during iteration.** If the hot list is dynamic, copy it under a lock or use a snapshot pattern.

**Follow-up.** *How do you know which keys are hot?* — Sample reads with a counter; periodically promote the top-K. Some caches (Caffeine, otter) expose a `frequencyOf` API; others require external tracking.

---

### Q25. The cache is consuming 80 GB but the working set is 20 GB. What might be wrong?

**Model answer.** Several candidates, investigated in order:

1. **Sweeper not running.** Goroutine died from a panic or was never started. Check `runtime.NumGoroutine` and goroutine stacks for the sweeper.
2. **Sweeper running but stalling.** It holds a lock for too long, falls behind, drops sweeps. Check `cache_sweep_duration_seconds` and `cache_expired_on_read_total`.
3. **TTL too long.** Memory holds keys long after they should be gone. Recompute the working set with the actual access pattern, not the assumed one.
4. **No capacity bound.** If the cache uses pure TTL with no cap, sustained insert rate can grow it past the working set during a traffic spike, and shrinkage waits for sweep.
5. **GC fragmentation.** Less common but real: many tiny entries with pointer-rich values keep heap fragmented. Switching to `bigcache`-style byte-array storage compacts.
6. **Per-entry overhead underestimated.** Each map entry has 30–50 bytes of overhead on top of the key/value. 100 M entries = 3–5 GB just for the map skeleton.
7. **Leaked references in closures.** If cached values close over large request contexts (database connections, request bodies), they pin those allocations.

**Triage tools.** `pprof heap`, `runtime.ReadMemStats`, the cache's own metrics, GC trace (`GODEBUG=gctrace=1`).

---

### Q26. How do you test a TTL cache deterministically?

**Model answer.**

1. **Inject a clock.** Hardcoding `time.Now()` makes tests use real time. Pass a `Clock` interface; in tests use a fake that advances on demand.

```go
type Clock interface {
    Now() time.Time
}

type FakeClock struct{ t time.Time }
func (c *FakeClock) Now() time.Time             { return c.t }
func (c *FakeClock) Advance(d time.Duration)    { c.t = c.t.Add(d) }
```

Test:
```go
clock := &FakeClock{t: time.Now()}
cache := NewWithClock(clock)
cache.Set("k", "v", time.Second)
clock.Advance(2 * time.Second)
_, ok := cache.Get("k")
require.False(t, ok)
```

2. **`testing/synctest` (Go 1.24+).** Provides a deterministic clock that integrates with the runtime. `time.Sleep` advances virtual time without real waits.

3. **Concurrency tests.** Run with `go test -race`. Spin many goroutines hammering the cache; assert invariants (e.g., `len(cache.Get(k))` never inconsistent).

4. **Goroutine leak detection.** `go.uber.org/goleak` at the end of each test.

5. **Property tests.** `testing/quick` or `pgregory.net/rapid` to randomly generate sequences of `Set`/`Get`/`Delete`/`Advance` and check invariants (TTL respected, memory bounded).

**Follow-up.** *How do you test the sweeper without a clock?* — You cannot, deterministically. Either inject the clock or use a `synctest` bubble.

---

## Staff

### Q27. Explain the happens-before guarantees a TTL cache provides between `Set` and a concurrent `Get`.

**Model answer.** The cache's internal mutex (or `sync.Map` operations, or atomic pointer swaps) establishes a happens-before relationship. Concretely:

- `Set(k, v)` happens-before any `Get(k)` that returns `v`. The reader sees not only `v` but everything the writer did *before* `Set` — for example, mutations to `v` itself.

Without that synchronisation, the writer's memory operations on `v` may not be visible to the reader. Two failure modes:

1. **`v` is a struct with sub-fields populated just before `Set`.** The writer fills `v.A = 1; v.B = 2; cache.Set(k, v)`. The reader does `cache.Get(k)` and sees `v` but observes `v.A = 0, v.B = 0`. With proper synchronisation, this is impossible.

2. **`v` is a pointer to a mutable struct.** If the writer continues to mutate `*v` after `Set`, the reader may observe inconsistent fields. The cache only guarantees what the writer did *before* `Set`. Post-`Set` mutations bypass the synchronisation.

**Implication for API design.** Cache values should be effectively immutable. Once you `Set`, do not modify the value. If you need to update, `Set` a fresh value.

---

### Q28. What if you replaced `time.Now()` with an atomically-updated global timestamp?

**Model answer.** This optimisation appears in some very-high-throughput caches. Each `time.Now()` is ~50–100 ns; an `atomic.LoadInt64` is ~3 ns.

**Implementation.**

```go
var nowNano atomic.Int64

func init() {
    go func() {
        ticker := time.NewTicker(time.Millisecond)
        defer ticker.Stop()
        for range ticker.C {
            nowNano.Store(time.Now().UnixNano())
        }
    }()
}

func cheapNow() int64 { return nowNano.Load() }
```

**Trade-offs.**

- **Precision.** Time is rounded to the ticker period. For TTLs in seconds or minutes, 1 ms granularity is fine. For TTLs in microseconds, this breaks.
- **No monotonic.** Stored as int64 — wall clock jumps now affect deadlines. The ticker is monotonic, but the stored value is wall.
- **Sweeper lag.** If the ticker goroutine starves (rare but possible under GC pressure), `cheapNow()` falls behind real time. Entries appear immortal for a brief window.
- **Test injection.** Now you need to fake the ticker too.

**When it is worth it.** Caches with very tight per-op budgets — 100 M ops/sec, sub-100 ns per op. Most production code does not need this.

---

### Q29. Walk through a production incident caused by a TTL cache. What was the root cause?

**Model answer.** A common incident pattern:

**Setup.** A service used `go-cache` with TTL 5 minutes for user-permission lookups. Permissions changed roughly monthly. The team assumed stale data for ~5 minutes was acceptable.

**Incident.** A security policy was tightened. Compliance demanded enforcement within 60 seconds. Engineers shortened the TTL to 1 minute. The cache hit ratio dropped from 95% to 50%. The permission service, sized for the previous load, was overwhelmed. Latency p99 jumped from 20 ms to 1200 ms. Cascading timeouts in upstream services.

**Root cause.** TTL is not the right invalidation primitive when policy changes must propagate fast. A 1-minute TTL still allows up to 60 seconds of stale data; tightening it further reduces hit ratio further but never reaches "immediate."

**Fix.** Replace TTL invalidation with pub/sub invalidation: keep TTL at 5 minutes for safety, but publish `cache.invalidate(user)` on every permission change. All instances subscribe and `Delete(user)` immediately. Combine with a "Last-modified" header so clients can verify.

**Lessons.**

- TTL is for *freshness*, not *invalidation*. They look the same and are not.
- Hit ratio is load-bearing. Halving it doubles origin load.
- Define the invalidation contract first; pick the technology second.

---

### Q30. How would you build a hierarchical TTL cache: L1 in-process, L2 Redis, L3 origin?

**Model answer.**

```go
type Hierarchical struct {
    l1    *LocalCache  // ristretto, 100 K entries, 30 s TTL
    l2    RedisClient  // 10 M entries, 30 min TTL
    l3    func(ctx, key) (any, error)
    sf    singleflight.Group
}

func (h *Hierarchical) Get(ctx context.Context, key string) (any, error) {
    if v, ok := h.l1.Get(key); ok {
        return v, nil
    }
    v, err, _ := h.sf.Do(key, func() (any, error) {
        if v, ok := h.l1.Get(key); ok {
            return v, nil // someone filled it while we waited
        }
        if v, err := h.l2.Get(ctx, key); err == nil {
            h.l1.Set(key, v, 30*time.Second)
            return v, nil
        }
        v, err := h.l3(ctx, key)
        if err != nil {
            return nil, err
        }
        h.l2.Set(ctx, key, v, 30*time.Minute)
        h.l1.Set(key, v, 30*time.Second)
        return v, nil
    })
    return v, err
}
```

**Properties.**

- L1 absorbs ~90% of reads at <1 µs.
- L2 absorbs ~95% of L1 misses at <1 ms.
- L3 sees ~0.5% of reads.
- Singleflight runs at L1 level — multiple in-flight requests for the same key share one journey through the stack.

**Subtle behaviours.**

1. **Writes.** `Set` updates L1 and L2; the next `Get` from any instance sees it after their L1 expires.
2. **Invalidation.** A pub/sub channel deletes from L1 across instances. L2 can be authoritatively invalidated by direct `DEL`.
3. **L2 outages.** Fall back to L3 directly. The L1 still serves recent reads.
4. **L3 outages.** Serve stale L1 if available (extend stale window). Return error otherwise.
5. **Coherence window.** Bounded by L1 TTL (30 s). Acceptable for read-heavy workloads where users tolerate "saw it 30 seconds ago."

**Anti-patterns.**

- Writing to L1 only. Other instances cannot see the new value.
- Caching error responses in L1 and L2 without separation. Errors should have their own short TTL.
- Skipping singleflight at L1. Without it, every miss cascades through L2 and L3 in parallel.

---

### Q31. Walk through how ristretto buffers reads asynchronously. Why?

**Model answer.** Every cache `Get` in ristretto must:

1. Look up the value (read path).
2. Update the access counter for TinyLFU (write path).

Step 2 is a write. If it were synchronous, every read would contend on a counter mutex.

**Ristretto's trick.** Reads append the accessed key to a per-CPU ring buffer (`p.GetBuffer`). The ring is small (~64 items). When full, a single goroutine drains it into the TinyLFU sketch under a lock. Most reads pay only the ring-buffer append (~5 ns); the cost of updating the counter is amortised.

**Trade-offs.**

- **Eventual consistency on access counts.** Counters lag by up to a ring's worth of operations.
- **Per-CPU rings.** Need `runtime.NumCPU` or `runtime.GOMAXPROCS` to size correctly. A goroutine running on a different P from where it started sees a different ring; this is fine because the buffer drainer is asynchronous.
- **Backpressure.** If the drain goroutine falls behind, new reads find the ring full and the cache silently drops the access notification. Counters underestimate. Hit ratio may degrade. In practice this only happens at extreme rates.

**Why this design.** Hit-ratio-optimised caches need per-access bookkeeping. Buffering moves bookkeeping off the hot path. The cost is approximation. Ristretto considers the approximation worth a 10x throughput gain.

---

### Q32. Explain `sync.Pool`-based entry reuse in a TTL cache. What can go wrong?

**Model answer.** Allocating an entry struct on every `Set` is wasteful. `sync.Pool` reuses freed entries:

```go
var entryPool = sync.Pool{
    New: func() any { return new(entry) },
}

func (c *Cache) Set(k string, v any, ttl time.Duration) {
    e := entryPool.Get().(*entry)
    e.key = k
    e.value = v
    e.deadline = time.Now().Add(ttl)
    c.put(e)
}

func (c *Cache) evict(e *entry) {
    *e = entry{} // zero to break references
    entryPool.Put(e)
}
```

**Hazards.**

1. **Forgetting to zero.** A pooled entry retains its previous pointer. The old value can stay alive long past its expiration, defeating GC.
2. **Putting a still-reachable entry back into the pool.** A reader holds a reference to `e.value`; you `evict` and `Put(e)`. The next caller gets a "fresh" entry that the reader still uses. Data corruption.
3. **Pool churn under GC.** `sync.Pool` items are dropped on every GC cycle. Under high allocation rates, the pool empties between cycles. Measure that pooling actually helps.
4. **False sharing.** Adjacent entries from the pool may share cache lines. Hot writes thrash CPU cache. Often fixed by padding.

**Mitigation.** Use pooling only for entries with predictable lifetime. The cache must guarantee no reader still holds the entry by the time it pools — typically via the lock that protects the map.

---

### Q33. What does this code do, and what is wrong with it?

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]*entry
}

func (c *Cache) Get(k string) (any, bool) {
    c.mu.Lock()
    e, ok := c.m[k]
    c.mu.Unlock()
    if !ok {
        return nil, false
    }
    if time.Now().After(e.deadline) {
        c.mu.Lock()
        delete(c.m, k)
        c.mu.Unlock()
        return nil, false
    }
    return e.value, true
}
```

**Model answer.**

1. **Double lock acquisition.** Two `Lock`/`Unlock` pairs for one logical operation. Doubles overhead.
2. **TOCTOU on the delete.** Between the unlock and the second lock, another goroutine may have `Set(k, freshValue)`. The second `Lock` then deletes the *fresh* value. Data loss.
3. **`Mutex` not `RWMutex`.** Reads are serialised even when nothing is being written.

**Fix.**

```go
func (c *Cache) Get(k string) (any, bool) {
    c.mu.RLock()
    e, ok := c.m[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.deadline) {
        return nil, false
    }
    return e.value, true
}
```

Leave the deletion to the sweeper. If you must delete on read, do it inside a single critical section with a re-check:

```go
c.mu.Lock()
defer c.mu.Unlock()
e, ok := c.m[k]
if !ok {
    return nil, false
}
if time.Now().After(e.deadline) {
    delete(c.m, k)
    return nil, false
}
return e.value, true
```

But this serialises every read — usually not worth it.

---

### Q34. Compare a TTL cache to a Redis SETEX. When use which?

**Model answer.**

**In-process TTL cache.**
- Latency: 100 ns – 1 µs per op.
- Capacity: bounded by process heap.
- Coherence: per-process; sees only its own writes.
- Failure mode: lost on restart; lost on crash.
- Cost: code complexity + memory.

**Redis SETEX.**
- Latency: 100 µs – 1 ms (network RTT).
- Capacity: bounded by Redis cluster memory.
- Coherence: shared by all clients.
- Failure mode: lost on Redis crash unless AOF/RDB.
- Cost: network + Redis infra.

**Use in-process when.**
- Read latency budget is microseconds.
- Coherence across instances is not required (or tolerated as eventual).
- Working set fits in process memory.
- Per-process duplication of cached data is acceptable.

**Use Redis when.**
- Multiple instances must agree on the cached value.
- Cache survives instance restarts.
- Working set is larger than a single process.
- You already operate Redis.

**Use both (layered) when.**
- Read traffic is heavy and bursty (L1 absorbs).
- Coherence is needed (L2 propagates).
- Origin is expensive (L2 spares it).

**Anti-pattern.** Using Redis for sub-millisecond per-key reads when an in-process cache would suffice. The network RTT becomes the bottleneck before Redis itself does.

---

### Q35. Design a TTL cache that supports cancellation of an in-flight load.

**Model answer.** Standard `singleflight.Do` is uninterruptible — once the load starts, no caller can cancel it. For per-request cancellation, use `DoChan`:

```go
type Cache struct {
    store *LocalCache
    sf    singleflight.Group
    load  func(ctx context.Context, key string) (any, error)
}

func (c *Cache) Get(ctx context.Context, key string) (any, error) {
    if v, ok := c.store.Get(key); ok {
        return v, nil
    }
    ch := c.sf.DoChan(key, func() (any, error) {
        // Note: this context is NOT the caller's. It must outlive
        // the load if other callers may still be waiting.
        loadCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        v, err := c.load(loadCtx, key)
        if err == nil {
            c.store.Set(key, v, 5*time.Minute)
        }
        return v, err
    })
    select {
    case r := <-ch:
        return r.Val, r.Err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

**Properties.**

- Each caller has its own `ctx`. Cancelling one caller returns its context error.
- The in-flight load continues; other waiters still receive its result.
- The load uses a separate context (often a fresh one) so it is not coupled to any one caller's cancellation. Otherwise the first caller to cancel would abort the load for everyone.

**Subtleties.**

- **Cancelling all waiters.** If you really want to abort the load when nobody is waiting, you need reference counting on the in-flight group. Not standard library.
- **Goroutine leaks.** If `singleflight.Do` panics, callers waiting on `DoChan` block forever unless the goroutine inside `Do` recovers. Use `recover()` inside.
- **Memory.** Each `DoChan` allocates a channel per call. For very high concurrency, this matters.

---

### Q36. How do you size a TTL cache?

**Model answer.**

**Step 1: characterise the workload.**
- Unique key cardinality (`U`).
- Read rate (`R` per second).
- Skew (Zipfian alpha, or "top-K accounts for X% of reads").
- Acceptable hit ratio target (`H`).

**Step 2: estimate working set.**
- For uniform access, capacity ~= U.
- For skewed access, capacity ~= top-K covering H% of traffic. Often << U.

**Step 3: estimate memory per entry.**
- Key bytes + value bytes + overhead.
- Overhead: 50 B for `sync.Map`, 30 B for plain `map`, 100+ B for entries with extra metadata.

**Step 4: compute capacity bound.**
- Capacity * memory-per-entry ≤ memory budget.

**Step 5: validate with a benchmark.**
- Simulate the actual workload, measure hit ratio at different capacities.
- The curve is usually steep — doubling capacity might raise hit ratio from 80% to 95%; doubling again from 95% to 98%.

**Step 6: set TTL based on freshness, not capacity.**
- TTL governs *staleness*. Set it from product requirements ("show product price within 60 s of update").
- Capacity governs *memory*. Set it from infrastructure ("we have 4 GB").

**Anti-pattern.** Using TTL to bound memory ("we set TTL=5 min so the cache won't grow"). It will grow — up to insert-rate * 5 min. Use capacity bounds + LRU for memory.

---

### Q37. How do you migrate from a stale-data-tolerant cache to a fresh-data-required service?

**Model answer.** A migration path that avoids a flag-day:

1. **Add a versioning column.** Every cached entity gets a version field; mutations increment it.
2. **Reduce TTL gradually.** Cut TTL in half each week. Observe hit ratio and origin load. Roll back if degradation is unacceptable.
3. **Introduce pub/sub invalidation.** On every write, publish `cache.invalidate(entity, version)`. All instances subscribe. Initially treat as a bug-detection signal (log only). Then begin acting on it.
4. **Validate against the origin.** For each cached read, occasionally re-fetch from the origin and assert equality. Alert on divergence. This is a sampled correctness check.
5. **Adopt write-through.** All writes go through a service that updates both the origin and the cache. Reads still go to the cache.
6. **Drop TTL or set it as a safety net.** Once invalidation is reliable, TTL becomes a backstop for missed messages, set to hours rather than seconds.

**Failure modes to avoid.**

- **Flag-day rollouts.** "Now we use invalidation." Inevitable bugs surface in production. Roll forward gradually.
- **Inconsistent invalidation messages.** Drop or duplicate messages produce drift. Use idempotent versions, not raw `Delete`.
- **Ignoring the long tail.** A few rare entries with very long original TTLs may have stale data forever. Sweep with a forced refresh on observed reads.

---

### Q38. What goes in a code review checklist for TTL cache code?

**Model answer.**

1. Cache type is generic-typed or documents the value type clearly.
2. Concurrent access is protected (mutex, `sync.Map`, sharded locks).
3. `Get` does not hold a lock during expensive work.
4. `Set` validates non-negative TTL.
5. Zero TTL has explicit, documented behaviour.
6. Deadline uses `time.Time`, not `int64`, to preserve monotonic.
7. Sweeper goroutine is stopped on `Close` (explicit quit channel).
8. Sweeper does not hold lock across full map iteration.
9. Tests use injected clock or `synctest`, not real `time.Sleep`.
10. Tests run with `-race`.
11. Goroutine leak detection (`goleak`) in tests.
12. Singleflight wraps origin loads, with `Forget` on transient errors.
13. Negative results are cached with shorter, configurable TTL.
14. TTL has jitter on insert.
15. Capacity bound prevents unbounded growth.
16. Metrics emitted: hits, misses, evictions, sweep_duration, load_duration, expired_on_read.
17. No `time.Tick` in long-lived loops (`NewTicker` + `Stop`).
18. `Set` does not silently fail; either succeeds or surfaces the reason.
19. Cache is documented as best-effort — callers handle misses.
20. Value type is effectively immutable after `Set`.

---

## Summary of follow-ups by level

| Level | Follow-up themes |
|---|---|
| Junior | "What does this print?", "Why is `time.Now().UnixNano()` worse than `time.Time`?", "Lazy vs active?" |
| Middle | "Why shard?", "What is the herd problem?", "Trade-offs of `sync.Map`?" |
| Senior | "Implement min-heap sweeper", "Design SWR", "When does ristretto reject a `Set`?" |
| Staff | "Happens-before through the cache", "Hierarchical cache design", "Migration to freshness-required service", "Code review checklist" |
