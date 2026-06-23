---
layout: default
title: Optimize
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/optimize/
---

# Concurrent LRU — Optimization

> A concurrent LRU has many failure modes that masquerade as performance problems. Most "optimizations" first require correct measurement of what is actually slow. Each entry below states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — measure in your own code.

---

## Optimization 1 — Sharding to break mutex contention

**Problem.** Single-mutex LRU serializes all operations through one lock. At 16+ goroutines on a multi-core machine, the lock becomes the bottleneck.

**Before:**
```go
cache, _ := lru.New[string, *User](16384)
// 16 goroutines hammer the cache; only one is inside at a time.
```
Throughput: ~5M ops/sec. Mutex profile shows 60%+ wait time.

**After:**
```go
cache := NewSharded[string, *User](16384, 16) // 16 shards
```
Throughput: ~50M ops/sec. Mutex wait drops to <10%.

**Gain.** 10x throughput. The cost is 16 mutex structures (~400 bytes) and one hash per operation (~20 ns).

---

## Optimization 2 — Power-of-two shard count and bitmask

**Problem.** Modulo for shard selection is slow (division on most CPUs).

**Before:**
```go
shard := c.shards[hash % uint64(len(c.shards))] // ~15 ns
```

**After:**
```go
// Constraint: len(c.shards) is a power of two.
shard := c.shards[hash & c.shardMask] // ~1 ns
```

**Gain.** 5-10 ns per operation. Modest but free.

---

## Optimization 3 — Padding shard structs against false sharing

**Problem.** Two shard structs on the same 64-byte cache line cause coherency traffic between CPUs.

**Before:**
```go
type shard struct {
    inner *lru.Cache[string, int] // 8 bytes
    // total 8 bytes; multiple shards fit on one cache line
}
```

**After:**
```go
type shard struct {
    inner *lru.Cache[string, int]
    _pad  [56]byte
    // total 64 bytes; each shard on its own line
}
```

**Gain.** 2-5x throughput improvement under heavy contention. Verify with `unsafe.Sizeof`.

---

## Optimization 4 — Switching from `golang-lru` to ristretto

**Problem.** Even sharded `golang-lru` has a mutex-per-shard ceiling. At very high throughput (>50M ops/sec), ristretto's lock-free Get is faster.

**Before:**
```go
cache := NewShardedLRU(16384, 32)
```
Throughput: ~70M ops/sec.

**After:**
```go
cache, _ := ristretto.NewCache(&ristretto.Config{
    NumCounters: 100_000_000,
    MaxCost:     16384,
    BufferItems: 64,
})
```
Throughput: ~150M ops/sec. Hit rate often improves 5-10% due to TinyLFU.

**Gain.** 2x throughput, plus better hit rate on skewed workloads. Cost: more complex API; eventually consistent.

---

## Optimization 5 — `sync.Pool` for entry allocations

**Problem.** Every Add allocates a new `*entry` struct. At high throughput, this stresses the allocator.

**Before:**
```go
ent := &entry[K, V]{k, v} // allocation per Add
```

**After:**
```go
var entryPool = sync.Pool{
    New: func() interface{} { return new(entry[K, V]) },
}

ent := entryPool.Get().(*entry[K, V])
ent.key = k
ent.val = v
// ... use ...
entryPool.Put(ent) // on eviction
```

**Gain.** Allocation rate drops by ~50%. GC overhead drops proportionally. Latency p99 improves by 5-15%.

---

## Optimization 6 — Cache-line aligned atomic counters

**Problem.** Hit and miss counters on the same cache line cause coherency traffic when both are incremented from different goroutines.

**Before:**
```go
type Cache struct {
    hits   atomic.Uint64
    misses atomic.Uint64
}
```

**After:**
```go
type Cache struct {
    hits   atomic.Uint64
    _      [56]byte
    misses atomic.Uint64
    _      [56]byte
}
```

**Gain.** Counter increment latency drops 5-10x under contention.

---

## Optimization 7 — Lazy aggregation of per-shard metrics

**Problem.** Each operation increments a global counter (with cache-line bouncing).

**Before:**
```go
func (c *Cache) Get(k string) (*V, bool) {
    v, ok := c.pick(k).Get(k)
    if ok {
        c.globalHits.Add(1) // contended
    }
    return v, ok
}
```

**After:**
```go
type shard struct {
    inner    *lru.Cache
    hits     atomic.Uint64  // per-shard
    _pad     [56]byte
}

func (c *Cache) Stats() Stats {
    var total uint64
    for _, s := range c.shards {
        total += s.hits.Load()
    }
    return Stats{Hits: total}
}
```

**Gain.** Each shard's counter is uncontended. Stats() is O(N) but called rarely (metrics scrape).

---

## Optimization 8 — Pre-allocate map capacity

**Problem.** Default-sized map grows incrementally, causing rehashes.

**Before:**
```go
c.items = make(map[K]*list.Element)
```

**After:**
```go
c.items = make(map[K]*list.Element, capacity)
```

**Gain.** Avoids 3-5 rehashes for a 100K cache. Saves ~50 ms of init time and improves steady-state by avoiding allocator pressure.

---

## Optimization 9 — Hash function selection

**Problem.** `hash/maphash` is excellent for correctness but ~20 ns per call. For very high throughput, a faster hash matters.

**Before:**
```go
var h maphash.Hash
h.SetSeed(c.seed)
h.WriteString(k)
hash := h.Sum64() // ~20 ns
```

**After (xxhash):**
```go
import "github.com/cespare/xxhash/v2"
hash := xxhash.Sum64String(k) // ~5 ns
```

**Gain.** 15 ns per operation. At 100M ops/sec, 1.5 seconds of CPU per second saved across cores.

**Trade-off.** xxhash is not seeded by default. For non-adversarial inputs, fine. For untrusted keys, use a seeded variant.

---

## Optimization 10 — Reduce critical section size

**Problem.** Doing expensive work inside the lock blocks other operations.

**Before:**
```go
func (c *Cache) Set(k string, raw []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    var v Value
    json.Unmarshal(raw, &v) // expensive! holds the lock
    c.inner.Add(k, &v)
}
```

**After:**
```go
func (c *Cache) Set(k string, raw []byte) {
    var v Value
    json.Unmarshal(raw, &v) // outside the lock
    c.mu.Lock()
    c.inner.Add(k, &v)
    c.mu.Unlock()
}
```

**Gain.** Reduced lock hold time → less contention → higher throughput.

---

## Optimization 11 — Avoid `defer` in hot paths

**Problem.** `defer` has a small but non-zero overhead (~5 ns in Go 1.14+, less in newer versions).

**Before:**
```go
func (c *Cache) Get(k string) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    // ... 5 lines ...
}
```

**After (Go 1.14+ has zero-cost defer for simple cases; only do this if profile shows it):**
```go
func (c *Cache) Get(k string) (V, bool) {
    c.mu.Lock()
    v, ok := c.inner[k]
    c.mu.Unlock()
    if !ok {
        var zero V
        return zero, false
    }
    return v, true
}
```

**Gain.** Marginal; only matters if defer shows up in profiles.

---

## Optimization 12 — Inline the hash function

**Problem.** A function call has overhead (~2-5 ns).

**Before:**
```go
shard := c.pick(k)
```

**After (inline the pick logic):**
```go
var h maphash.Hash
h.SetSeed(c.seed)
h.WriteString(k)
shard := c.shards[h.Sum64()&c.shardMask]
```

**Gain.** 2-5 ns per operation. Only matters at extreme throughput. Modern Go compilers often inline automatically.

---

## Optimization 13 — Off-heap storage for large caches

**Problem.** On-heap LRU with millions of entries stresses GC. Pause times grow with heap size.

**Before:**
```go
cache := NewShardedLRU[string, *Value](1_000_000, 64)
// values are *Value pointers; GC scans them all
```
GC pause: 100-200 ms per cycle.

**After:**
```go
import "github.com/allegro/bigcache/v3"

config := bigcache.DefaultConfig(10 * time.Minute)
config.HardMaxCacheSize = 4 // MB per shard × 1024 shards = ~4GB
cache, _ := bigcache.New(context.Background(), config)
// values are serialised []byte; GC sees one large byte arena
```
GC pause: <10 ms.

**Gain.** 10-20x lower GC pause. Cost: serialisation overhead on every operation; values are now bytes.

---

## Optimization 14 — Combine related lookups into one batch

**Problem.** Looking up three values takes three Get calls, three lock acquisitions.

**Before:**
```go
user, _ := userCache.Get(id)
session, _ := sessionCache.Get(id)
profile, _ := profileCache.Get(id)
```

**After (single cache for related data):**
```go
type Bundle struct {
    User    *User
    Session *Session
    Profile *Profile
}
bundle, _ := bundleCache.Get(id) // one lock acquisition
```

**Gain.** Reduces lock acquisitions by 3x. Trade-off: more eviction granularity (whole bundle goes when any value changes).

---

## Optimization 15 — Lock-free check before locked update

**Problem.** Every Set takes the lock even if the entry exists with the same value.

**Before:**
```go
func (c *Cache) Set(k string, v *Value) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.inner.Add(k, v)
}
```

**After:**
```go
func (c *Cache) Set(k string, v *Value) {
    if cur, ok := c.inner.Peek(k); ok && cur == v {
        return // no change needed
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    c.inner.Add(k, v)
}
```

**Gain.** Avoids redundant Sets. Useful when the same value is repeatedly Set (idempotent loaders, hot-path caches).

---

## Optimization 16 — Bypass the cache for huge values

**Problem.** Caching a 10 MB value inserts and may evict 100 smaller values. The eviction cost overshadows the cache benefit.

**Before:**
```go
cache.Add(id, hugeValue)
```

**After:**
```go
if estimateSize(hugeValue) > 1024*1024 { // 1 MB threshold
    return hugeValue, nil // don't cache
}
cache.Add(id, hugeValue)
```

**Gain.** Prevents one bad request from destroying the cache. Trade: that specific request always misses.

---

## Optimization 17 — Move logging out of the cache hot path

**Problem.** Every miss logs; under high miss rate, the log itself becomes the bottleneck.

**Before:**
```go
if _, ok := cache.Get(k); !ok {
    log.Printf("cache miss: %s", k)
    // ... load and store ...
}
```

**After:**
```go
if _, ok := cache.Get(k); !ok {
    if missCount.Add(1)%10000 == 0 {
        log.Printf("cache miss rate sample: %s", k)
    }
    // ... load and store ...
}
```

**Gain.** Eliminates log contention as a bottleneck. Sampling preserves the diagnostic value.

---

## Optimization 18 — Pre-warm the cache at startup

**Problem.** Cold cache → slow first requests → tail-latency spike during deploys.

**Before:**
```go
// nothing; cache starts empty
```

**After:**
```go
func (s *Service) Start(ctx context.Context) error {
    hot, _ := s.analytics.TopKeys(ctx, 1000)
    var wg sync.WaitGroup
    sem := make(chan struct{}, 8)
    for _, k := range hot {
        wg.Add(1)
        sem <- struct{}{}
        go func(k string) {
            defer wg.Done()
            defer func() { <-sem }()
            v, _ := s.loader(ctx, k)
            s.cache.Add(k, v)
        }(k)
    }
    wg.Wait()
    return nil
}
```

**Gain.** Eliminates the cold-cache latency spike. Cost: a few seconds of startup time.

---

## Optimization 19 — Singleflight for stampede prevention

**Problem.** When a hot key misses, N concurrent goroutines all call the loader.

**Before:**
```go
if v, ok := cache.Get(k); ok { return v }
v, _ := load(k) // N callers race here
cache.Add(k, v)
return v
```

**After:**
```go
if v, ok := cache.Get(k); ok { return v }
result, _, _ := sf.Do(k, func() (interface{}, error) {
    v, err := load(k)
    if err != nil {
        return nil, err
    }
    cache.Add(k, v)
    return v, nil
})
return result.(*Value)
```

**Gain.** Reduces load calls by up to N (one per concurrent miss). Major win at high concurrency.

---

## Optimization 20 — Cost-based capacity for variable-size values

**Problem.** Mixed value sizes lead to OOM under count-based capacity.

**Before:**
```go
cache, _ := lru.New[string, []byte](10000) // 10K entries of varying size
```
Memory could be anywhere from 1 MB to 10 GB.

**After:**
```go
cache, _ := ristretto.NewCache(&ristretto.Config{
    NumCounters: 100_000,
    MaxCost:     1 * 1024 * 1024 * 1024, // 1 GB
    BufferItems: 64,
})
cache.Set(k, v, int64(len(v))) // cost = byte size
```

**Gain.** Predictable memory usage. Eviction prefers large entries when over budget.

---

## Optimization 21 — Replace `interface{}` with typed cache

**Problem.** Pre-generics caches return `interface{}`; every Get incurs type assertion and possibly an allocation.

**Before:**
```go
cache, _ := lru.New(128) // v1, interface{}
v, _ := cache.Get(k)
u := v.(*User) // assertion
```

**After:**
```go
cache, _ := lru.New[string, *User](128) // v2, generic
u, _ := cache.Get(k) // no assertion
```

**Gain.** Saves ~5 ns per Get; cleaner code; type safety at compile time.

---

## Optimization 22 — Per-goroutine L1 cache for hot keys

**Problem.** A few keys absorb most traffic; sharding does not help for those.

**Before:**
```go
v, _ := cache.Get(hotKey) // every call hits the shared cache
```

**After:**
```go
type Worker struct {
    localCache map[string]*Value // per-goroutine
    shared     *Cache
}

func (w *Worker) Get(k string) *Value {
    if v, ok := w.localCache[k]; ok {
        return v
    }
    v, _ := w.shared.Get(k)
    w.localCache[k] = v
    return v
}
```

**Gain.** For very hot keys, eliminates cache lookups entirely. Trade: per-goroutine memory + stale data.

---

## Optimization 23 — Disable GC for short benchmarks

**Problem.** GC mid-benchmark perturbs results.

**Before:**
```go
func BenchmarkCache(b *testing.B) {
    cache, _ := lru.New[string, int](10000)
    for i := 0; i < b.N; i++ {
        cache.Get("key")
    }
}
```

**After:**
```go
func BenchmarkCache(b *testing.B) {
    cache, _ := lru.New[string, int](10000)
    runtime.GC()  // clear any pending GC
    debug.SetGCPercent(-1) // disable GC for the duration
    defer debug.SetGCPercent(100)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        cache.Get("key")
    }
}
```

**Gain.** Stable benchmark results. Caveat: only for short benchmarks (otherwise memory grows unbounded).

---

## Optimization 24 — Profile-guided sizing

**Problem.** Picking cache size by intuition leads to over- or under-provisioning.

**Before:**
```go
cache, _ := lru.New[string, *User](100000) // "should be enough"
```

**After:**
```go
// Measure working set first.
trace := captureProductionTrace(1 * time.Hour)
mrc := mattsonAlgorithm(trace)
// mrc[c] is hit rate at capacity c
// Pick c where mrc[c] reaches 90% (or your target)
cache, _ := lru.New[string, *User](optimalSize)
```

**Gain.** Right-sized cache. Memory savings (often 2-3x), better hit rate.

---

## Optimization 25 — Stale-while-revalidate

**Problem.** TTL expiry causes simultaneous cache misses and a latency spike.

**Before:**
```go
e, ok := cache.Get(k)
if !ok || time.Now().After(e.expireAt) {
    return slowLoad(k) // every TTL boundary = slow path
}
return e.val
```

**After:**
```go
e, ok := cache.Get(k)
if !ok {
    return slowLoad(k)
}
age := time.Since(e.fetchedAt)
if age < softTTL {
    return e.val
}
if age < hardTTL {
    if e.refresh.CompareAndSwap(false, true) {
        go refreshInBackground(k)
    }
    return e.val // stale, but immediate
}
return slowLoad(k)
```

**Gain.** Eliminates latency spike at TTL expiry. Users see slightly stale data but no slow responses.

---

## Conclusion

Every optimization above should be motivated by a measurement. The order in which to apply them:

1. **Profile** with `pprof` (CPU, mutex, alloc).
2. **Pick the biggest opportunity** from the profile.
3. **Apply ONE optimization**.
4. **Re-benchmark**.
5. **Verify the improvement**.
6. **Commit**.
7. **Repeat**.

Random optimization without measurement adds complexity without benefit. Disciplined optimization with measurement yields compounding improvements.

The typical sequence for a Go service:

1. **No optimization** (single-mutex LRU). Works up to ~10K req/s.
2. **Sharding**. Up to ~1M req/s.
3. **Singleflight + TTL jitter**. Solves stampede problems.
4. **ristretto migration**. Up to ~10M req/s per pod.
5. **Off-heap (bigcache)**. For >1 GB caches.
6. **NUMA tuning, hugepages**. Last resort.

Each step earns 2-10x. The cumulative improvement, when justified by measurement, can be 100-1000x over a naive starting point.

Profile. Optimize. Measure. Iterate. That is the loop.
