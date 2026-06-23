---
layout: default
title: Middle
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/middle/
---

# Concurrent LRU — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where the Junior Design Breaks Down](#where-the-junior-design-breaks-down)
3. [Mental Model: From One Mutex to N Mutexes](#mental-model-from-one-mutex-to-n-mutexes)
4. [Sharded LRU Cache](#sharded-lru-cache)
5. [Picking the Shard: Hashing the Key](#picking-the-shard-hashing-the-key)
6. [Sizing the Shards: 16, 64, 256, 1024](#sizing-the-shards-16-64-256-1024)
7. [RWMutex Variant: When It Helps and When It Hurts](#rwmutex-variant-when-it-helps-and-when-it-hurts)
8. [Eviction Edge Cases Under Contention](#eviction-edge-cases-under-contention)
9. [The `hashicorp/golang-lru/v2` API in Depth](#the-hashicorpgolang-lruv2-api-in-depth)
10. [2Q Cache: When LRU Is Not Enough](#2q-cache-when-lru-is-not-enough)
11. [ARC Cache: Self-Tuning LRU/LFU](#arc-cache-self-tuning-lrulfu)
12. [Expirable LRU: Adding a TTL](#expirable-lru-adding-a-ttl)
13. [Singleflight for Coordinated Misses](#singleflight-for-coordinated-misses)
14. [Negative Caching](#negative-caching)
15. [Write-Through, Write-Around, Write-Back](#write-through-write-around-write-back)
16. [Integration with HTTP Middleware](#integration-with-http-middleware)
17. [Integration with gRPC Interceptors](#integration-with-grpc-interceptors)
18. [Integration with Database Repositories](#integration-with-database-repositories)
19. [Benchmarks: Single Mutex vs Sharded vs `sync.Map`](#benchmarks-single-mutex-vs-sharded-vs-syncmap)
20. [Memory Profiling the Cache](#memory-profiling-the-cache)
21. [Hot Key Detection](#hot-key-detection)
22. [Common Mistakes at This Level](#common-mistakes-at-this-level)
23. [Pitfalls in Sharding](#pitfalls-in-sharding)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [Related Topics](#related-topics)

---

## Introduction

The junior file finished with a single-mutex LRU and `hashicorp/golang-lru/v2`. Both are correct and both are fast enough for many services. At middle level we ask the next question: when they are *not* fast enough, what do you build?

The answer is **sharding**: split the cache into N independent stripes, each with its own mutex. A goroutine that wants key `k` hashes `k`, picks shard `hash(k) % N`, and locks only that shard. With N shards and uniform key distribution, contention drops by a factor of roughly N.

This file covers sharding in depth, explains when it does and doesn't help, walks through the variants (`hashicorp/golang-lru/v2.New2Q`, `NewARC`, `expirable.NewLRU`), shows how to integrate the cache into HTTP, gRPC, and database layers, and benchmarks the three most common designs (single mutex, sharded, `sync.Map`) against each other.

After reading this file you will:

- Be able to build a sharded LRU from scratch in ~150 lines.
- Know when to pick `sync.Mutex`, `sync.RWMutex`, or `atomic` for a cache.
- Use 2Q, ARC, and expirable variants of `hashicorp/golang-lru/v2` correctly.
- Combine LRU with `singleflight`, negative caching, and TTL.
- Diagnose contention with the mutex profile and choose N shards rationally.
- Avoid the two biggest mistakes at this level: per-key shard distribution skew and false sharing between adjacent shard structs.

---

## Where the Junior Design Breaks Down

A single-mutex LRU has one bottleneck: every operation locks the same mutex. As soon as N concurrent goroutines contend for it, throughput stops scaling. The mutex contention profile from a typical busy server looks like:

```
go test -bench BenchmarkLRU -mutexprofile=mu.out
go tool pprof -text mu.out
  flat   flat%    sum%     cum     cum%
  84%    84%      84%      84%     84%   sync.(*Mutex).Lock
```

84% of the contention time is in `Mutex.Lock`. The CPU profile would show the same call, the goroutines parked on it. At that point sharding is the only way forward unless you change the data structure entirely.

The math: if each operation holds the lock for 200 ns, the theoretical maximum throughput on one mutex is 1 / 200ns = 5M ops/sec. At any higher rate goroutines queue. With 16 shards and uniform distribution, the ceiling rises to 80M ops/sec — well past what any single instance needs.

But sharding has costs: extra memory (N capacities of overhead), extra eviction independence (one shard can be full while another is empty), and the need for a stable hash function. The trade-offs matter; the rest of this file goes through them.

---

## Mental Model: From One Mutex to N Mutexes

Think of the single-mutex LRU as one cashier serving a queue. The sharded LRU is N cashiers, each with their own queue. Customers are routed to a cashier by surname (the hash). If surnames are uniformly distributed, each cashier serves 1/N of the load. If 80% of customers have the surname "Smith", one cashier is overwhelmed and the rest are idle — the *hot key* problem.

Two consequences:

1. **Uniform hash distribution matters.** A bad hash function or a workload where most operations touch one key makes sharding useless.
2. **Per-shard capacity must be sized for the worst case.** A shard with 1000 keys at capacity 100 evicts constantly even if other shards are nearly empty.

---

## Sharded LRU Cache

A from-scratch sharded LRU:

```go
package shardedlru

import (
    "hash/maphash"
    "sync"

    lru "github.com/hashicorp/golang-lru/v2"
)

type Cache[K ~string, V any] struct {
    shards    []*shard[K, V]
    shardMask uint64
    seed      maphash.Seed
}

type shard[K ~string, V any] struct {
    inner *lru.Cache[K, V]
    // 56 bytes of padding to push the next shard to its own cache line.
    _pad [56]byte
}

func New[K ~string, V any](capacity, numShards int) (*Cache[K, V], error) {
    // numShards must be a power of two for the bitmask trick.
    if numShards&(numShards-1) != 0 || numShards == 0 {
        panic("shardedlru: numShards must be a power of two")
    }
    perShard := (capacity + numShards - 1) / numShards
    c := &Cache[K, V]{
        shards:    make([]*shard[K, V], numShards),
        shardMask: uint64(numShards) - 1,
        seed:      maphash.MakeSeed(),
    }
    for i := range c.shards {
        inner, err := lru.New[K, V](perShard)
        if err != nil {
            return nil, err
        }
        c.shards[i] = &shard[K, V]{inner: inner}
    }
    return c, nil
}

func (c *Cache[K, V]) pick(k K) *shard[K, V] {
    var h maphash.Hash
    h.SetSeed(c.seed)
    h.WriteString(string(k))
    return c.shards[h.Sum64()&c.shardMask]
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    return c.pick(k).inner.Get(k)
}

func (c *Cache[K, V]) Add(k K, v V) {
    c.pick(k).inner.Add(k, v)
}

func (c *Cache[K, V]) Remove(k K) bool {
    return c.pick(k).inner.Remove(k)
}

func (c *Cache[K, V]) Len() int {
    n := 0
    for _, s := range c.shards {
        n += s.inner.Len()
    }
    return n
}

func (c *Cache[K, V]) Purge() {
    var wg sync.WaitGroup
    for _, s := range c.shards {
        wg.Add(1)
        go func(s *shard[K, V]) {
            defer wg.Done()
            s.inner.Purge()
        }(s)
    }
    wg.Wait()
}
```

Key points to study:

- **`shardMask`**: a power-of-two `numShards` lets us pick the shard with one bitmask, no modulo.
- **`maphash` seed**: each cache has its own random seed so an adversary cannot craft keys that all hash to one shard.
- **Padding**: 56 bytes after the inner pointer pushes the next shard struct to a separate cache line, avoiding false sharing.
- **Per-shard capacity**: total capacity divided by N, rounded up. Total memory roughly equals the single-mutex version.
- **`Len`**: O(N) because it sums all shards. Acceptable; `Len` is for diagnostics, not hot paths.

### Why power-of-two shards?

```go
// modulo (slow, branch on the divisor)
shard := c.shards[h % uint64(len(c.shards))]

// bitmask (one CPU instruction, no division)
shard := c.shards[h & c.shardMask]
```

The bitmask is identical to modulo only when `numShards` is a power of two. The instruction-level speedup is small per operation but matters under millions of ops/sec.

### Why a random hash seed?

If your hash is deterministic (e.g., FNV) and the key space is small, two pods independently compute the same hash and load the same shard with the same keys. An attacker who knows your hash can hand-craft keys that all collide. `maphash.MakeSeed` returns a random seed per process; the same input maps to different shards in different processes. This is the same reason Go's built-in map randomises iteration order.

### Why pad to a cache line?

Modern CPUs cache memory in 64-byte lines. If two shard structs are adjacent and a goroutine writes to one, the cache coherency protocol invalidates the line for the other CPU even though the data is unrelated. This is **false sharing** and it can cost 5-10x in contention. Padding each shard to its own line eliminates it.

Use `unsafe.Sizeof(shard{})` to verify your shard is exactly 64 bytes (or a multiple). On amd64 with a pointer (8 bytes) and 56 bytes of padding, the struct is 64 bytes.

---

## Picking the Shard: Hashing the Key

For string keys, `hash/maphash` is the right default. It is:

- **Fast**: ~20 ns per call.
- **Random per process**: not vulnerable to crafted collisions.
- **Well-distributed**: even for adversarial inputs, the seed makes collisions unpredictable.

For integer keys, you can skip a hash function entirely:

```go
func (c *Cache[K, V]) pick(k uint64) *shard[K, V] {
    // Splittable PRNG step from Murmur, mixes the bits.
    x := k * 0x9E3779B97F4A7C15
    x ^= x >> 30
    return c.shards[x&c.shardMask]
}
```

If your keys are *already* well-distributed (e.g., UUIDs, hashes), you can use the bottom bits directly. If they are sequential (e.g., auto-increment IDs), the bottom bits all map to the same shard — you must mix.

For struct keys, marshal to bytes then hash:

```go
buf := make([]byte, 0, 32)
buf = strconv.AppendInt(buf, int64(k.TenantID), 10)
buf = append(buf, ':')
buf = strconv.AppendInt(buf, int64(k.UserID), 10)
h.Write(buf)
```

Or use `encoding/gob`/`encoding/binary` — but at the cost of an allocation per Get.

---

## Sizing the Shards: 16, 64, 256, 1024

Common shard counts and when each is right:

| Shards | Mutex contention ceiling | Memory overhead | When to use |
|--------|--------------------------|-----------------|-------------|
| 1 | 5M ops/s | Negligible | Single-threaded or low-concurrency services |
| 16 | 80M ops/s | ~1 KB | Default for most services |
| 64 | 320M ops/s | ~4 KB | Heavily concurrent services (>1000 goroutines) |
| 256 | 1.3B ops/s | ~16 KB | Extreme concurrency; rarely needed |
| 1024 | 5B ops/s | ~64 KB | Theoretical; in practice the bottleneck moves to GC or allocator |

The default for `dgraph-io/ristretto` is 256 admission counters and a `numShards` of 256 for the storage. The default for many handwritten Go LRUs is 16 or 32. Pick 16 unless you have measured contention.

A useful heuristic: shards ≈ 4 × `runtime.NumCPU()`. On a 16-core machine, 64 shards. This gives you a 4-to-1 oversubscription ratio so brief contention on one shard doesn't stall a core.

Trade-off: more shards mean more independent eviction policies. A workload with 70% of traffic on 30% of keys may have one shard constantly evicting while others sit idle. Sharding amplifies skew.

---

## RWMutex Variant: When It Helps and When It Hurts

The junior file warned that an `RWMutex` does not help a plain LRU because `Get` mutates the recency list. There are two ways to make it help.

### Option A — Split into `Get` (writer) and `Peek` (reader)

This is what `hashicorp/golang-lru/v2` does. `Peek` takes `RLock`, `Get` takes `Lock`. If your workload has many more peeks than gets, the RWMutex wins. In practice, peeks are usually only used for diagnostics, so this is a marginal win.

### Option B — Replace recency tracking with a counter

If you accept a *probabilistic* LRU (e.g., Clock or Second-Chance), you can update recency with a single atomic counter per entry. Reads then become truly read-only.

```go
type entry[V any] struct {
    val      V
    accessed atomic.Uint64
}

func (c *Cache) Get(k string) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.items[k]
    if !ok {
        return nil, false
    }
    e.accessed.Add(1)
    return e.val, true
}
```

Eviction logic now scans the map periodically and evicts entries with the lowest counter. This is the basic Clock algorithm. ristretto uses a much more sophisticated variant (TinyLFU sketches). For a from-scratch implementation, Clock is the simplest read-mostly LRU substitute.

### When RWMutex hurts

RWMutex has higher overhead than Mutex (it tracks readers and writers separately). For write-mostly workloads (every Get is a write), it is slightly slower than plain Mutex. Benchmark before adopting.

---

## Eviction Edge Cases Under Contention

Under heavy load, eviction interacts with concurrency in surprising ways.

### Edge case 1 — Eviction callback re-entering the cache

```go
cache, _ := lru.NewWithEvict[string, int](128, func(k string, v int) {
    cache.Add(k+":evicted", v) // deadlock or unbounded recursion
})
```

The callback runs under the cache's lock. Re-entering deadlocks (`sync.Mutex` is not reentrant). Even if it were, you'd recurse into eviction and grow without bound.

**Fix.** Push work to a separate goroutine, or write to a different cache.

### Edge case 2 — Many goroutines evicting different shards at once

In a sharded cache, every shard can evict independently. If 16 shards each evict simultaneously, you get 16 callback invocations interleaved. Make sure your callback is goroutine-safe (don't share mutable state without synchronisation).

### Edge case 3 — Shard imbalance triggering early evictions

If 90% of traffic hits shard 3, shard 3 evicts constantly while shards 0-2 and 4-15 are 10% full. The total cache holds far fewer than `capacity` entries effectively. A "global LRU" (one list across all shards) would not suffer from this — but the global list is a contention hot spot again. The trade is unavoidable.

### Edge case 4 — Resize during traffic

`lru.Cache.Resize` evicts surplus entries to fit. If you call it while goroutines are reading, they may see misses for keys that were valid moments ago. Document that Resize is a controlled operation.

### Edge case 5 — Purge under contention

`Purge` takes the lock and walks the entire map+list. If `Len` is 1M and operations are 200 ns each, `Purge` may hold the lock for 200 ms. During that time every other operation blocks. Use `Purge` at startup or behind a maintenance flag.

---

## The `hashicorp/golang-lru/v2` API in Depth

The library has more methods than the junior file showed. Here is the full surface, with notes on which to use when.

```go
// Constructors
lru.New[K, V](size)                                  // plain LRU
lru.NewWithEvict[K, V](size, onEvict)                // with callback
lru.New2Q[K, V](size)                                // two-queue
lru.NewARC[K, V](size)                               // adaptive replacement
expirable.NewLRU[K, V](size, onEvict, ttl)           // TTL variant

// Methods on *lru.Cache[K, V]
Add(key, value) (evicted bool)
Get(key) (value V, ok bool)
Peek(key) (value V, ok bool)                          // no recency update
Contains(key) bool                                     // no recency update
ContainsOrAdd(key, value) (ok, evicted bool)          // atomic combo
PeekOrAdd(key, value) (previous V, ok, evicted bool)  // atomic combo
Remove(key) bool
Resize(size int) (evicted int)
Len() int
Keys() []K                                             // snapshot, MRU first
Values() []V                                           // snapshot, MRU first
Purge()
GetOldest() (key K, value V, ok bool)                 // Peek the LRU end
RemoveOldest() (key K, value V, ok bool)              // Pop the LRU end
```

A few less-obvious ones:

### `ContainsOrAdd` — atomic "store if missing"

```go
ok, evicted := cache.ContainsOrAdd(key, value)
if ok {
    // key was already present; value not added
} else {
    // key was added; possibly evicted another
}
```

Useful for caches that should not overwrite an existing entry (think: first-write-wins).

### `PeekOrAdd` — atomic "get-or-set"

```go
prev, ok, evicted := cache.PeekOrAdd(key, value)
if ok {
    // returned the previous value
    return prev
}
// value was inserted
return value
```

The single-call equivalent of:

```go
if v, ok := cache.Peek(key); ok { return v }
cache.Add(key, value)
return value
```

Use the atomic form to avoid the gap where another goroutine could insert a different value between your Peek and Add.

### `Resize` — change capacity at runtime

```go
evicted := cache.Resize(2048) // evicts surplus to fit
```

If `newCap < Len`, evicts oldest until size fits. If `newCap >= Len`, evicts nothing. Useful for dynamic capacity tuning.

### `GetOldest` and `RemoveOldest` — for queue-like patterns

If you want to process the oldest entries (LIFO is wrong; LRU is right), `GetOldest`/`RemoveOldest` give you direct access. Rarely needed; usually a sign that an LRU is the wrong tool.

---

## 2Q Cache: When LRU Is Not Enough

The two-queue (2Q) algorithm fixes pure LRU's biggest weakness: scan vulnerability. The intuition:

- A miss enters a small **A1in** (FIFO) queue. If accessed only once, it stays in A1in and ages out without disturbing the hot set.
- A second access promotes the entry to **Am**, the main LRU.
- A separate **A1out** ghost list remembers keys that fell out of A1in. If they reappear quickly, they go straight to Am.

The result: a one-time scan fills A1in (small) and ages out, leaving Am intact. The hot set survives.

```go
import lru "github.com/hashicorp/golang-lru/v2"

c, err := lru.New2Q[string, *User](16384)
if err != nil {
    return err
}
c.Add("alice", &User{Name: "Alice"})
v, ok := c.Get("alice")
```

The API is the same as plain LRU. The internal algorithm is different. For workloads where you periodically scan large key sets (analytics, batch imports, crawler), 2Q can be 20-50% better hit-rate than plain LRU.

Cost: 2Q has three internal structures (A1in, Am, A1out) instead of one list. Memory overhead is ~2x. CPU per op is similar.

---

## ARC Cache: Self-Tuning LRU/LFU

Adaptive Replacement Cache (ARC) automatically balances recency and frequency. Its data structures:

- **T1**: recently accessed once (LRU).
- **T2**: recently accessed multiple times (LRU).
- **B1**: ghost of T1 evictions.
- **B2**: ghost of T2 evictions.

When a key reappears from B1, it suggests the cache should be more recency-biased; ARC grows T1. When it reappears from B2, the cache should be more frequency-biased; ARC grows T2. The split adapts to the actual workload.

```go
c, err := lru.NewARC[string, *User](16384)
```

ARC is the best general-purpose policy for unknown workloads. It is also the slowest per op (more pointer chases) and the most memory-hungry (~3x plain LRU). Use it when you have measured plain LRU and 2Q and neither is good enough.

A historical note: ARC is patented by IBM. The `hashicorp/golang-lru/v2.NewARC` implementation uses a variant that avoids the patent claims; if you need to be careful for licensing reasons, read the LICENSE.

---

## Expirable LRU: Adding a TTL

A pure LRU never expires entries. For data that becomes stale on a clock, use `expirable.NewLRU`.

```go
import "github.com/hashicorp/golang-lru/v2/expirable"

cache := expirable.NewLRU[string, *Session](
    1024,
    func(key string, value *Session) {
        log.Printf("session expired: %s", key)
    },
    5*time.Minute,
)

cache.Add("token-abc", &Session{UserID: "u1"})

// 6 minutes later:
v, ok := cache.Get("token-abc") // ok == false
```

How it works:

- Each entry stores its insertion time.
- On `Get`, the cache checks `time.Now().Sub(insertedAt) > ttl`; if so, the entry is removed and miss is returned.
- A background janitor goroutine sweeps expired entries periodically so memory does not grow.

Trade-offs vs hand-rolled TTL:

- **Built-in**: no extra wrapper code.
- **Goroutine cost**: one janitor goroutine per cache. Tiny but present.
- **Janitor frequency**: defaults are reasonable; tune for very large caches.
- **No per-entry TTL**: same TTL for all. If you need per-entry, use `bigcache` or write your own.

---

## Singleflight for Coordinated Misses

A cache miss leads to a loader call. If a hot key expires and 1000 requests miss simultaneously, you get 1000 loader calls — the **thundering herd**. `golang.org/x/sync/singleflight` deduplicates them.

```go
import "golang.org/x/sync/singleflight"

type Cache struct {
    inner *lru.Cache[string, *User]
    sf    singleflight.Group
}

func (c *Cache) Get(ctx context.Context, key string, load func() (*User, error)) (*User, error) {
    if u, ok := c.inner.Get(key); ok {
        return u, nil
    }
    v, err, shared := c.sf.Do(key, func() (interface{}, error) {
        u, err := load()
        if err != nil {
            return nil, err
        }
        c.inner.Add(key, u)
        return u, nil
    })
    _ = shared // true if more than one caller waited on this
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

The `shared` return tells you whether deduplication kicked in. Useful for metrics: `if shared { metrics.SingleflightHits.Inc() }`.

Caveats:

- **All waiters share the same error.** If `load()` fails for a transient reason, every caller sees the failure. Wrap in a retry if needed.
- **`singleflight.Do` blocks until completion.** Use `singleflight.DoChan` for non-blocking with timeout.
- **Per-key groups**: `singleflight.Group.Do(key, ...)` groups by `key`. Two different keys do not block each other.

---

## Negative Caching

A missing entry is a *signal*, often expensive to compute. Cache the absence.

```go
type ttlEntry struct {
    user      *User
    notFound  bool
    expireAt  time.Time
}

func (c *Cache) Get(ctx context.Context, id string) (*User, error) {
    if e, ok := c.inner.Get(id); ok && time.Now().Before(e.expireAt) {
        if e.notFound {
            return nil, ErrUserNotFound
        }
        return e.user, nil
    }
    u, err := c.db.GetUser(ctx, id)
    if errors.Is(err, db.ErrNotFound) {
        c.inner.Add(id, ttlEntry{notFound: true, expireAt: time.Now().Add(30 * time.Second)})
        return nil, ErrUserNotFound
    }
    if err != nil {
        return nil, err
    }
    c.inner.Add(id, ttlEntry{user: u, expireAt: time.Now().Add(5 * time.Minute)})
    return u, nil
}
```

Use a **shorter TTL for negative entries** than positive ones, so a newly created user becomes visible quickly without a long stale-not-found window.

---

## Write-Through, Write-Around, Write-Back

Three patterns for keeping a cache consistent with the source of truth.

### Write-through

```go
func (s *Service) UpdateUser(ctx context.Context, u *User) error {
    if err := s.db.UpdateUser(ctx, u); err != nil {
        return err
    }
    s.cache.Add(u.ID, u) // update cache after DB succeeds
    return nil
}
```

After a successful write, populate the cache with the new value. Next reads are warm. Risk: if the write succeeds in DB but the cache update fails for some reason, the cache has the old value until next eviction or TTL.

### Write-around

```go
func (s *Service) UpdateUser(ctx context.Context, u *User) error {
    if err := s.db.UpdateUser(ctx, u); err != nil {
        return err
    }
    s.cache.Remove(u.ID) // invalidate; next read repopulates
    return nil
}
```

Invalidate the cache after a write; the next read takes the cold path. Simpler and safer than write-through. The cost is one extra slow read after each write.

### Write-back

```go
func (s *Service) UpdateUser(ctx context.Context, u *User) error {
    s.cache.Add(u.ID, u)               // accept the write into the cache
    s.dirty.Add(u.ID, u)               // mark for later flush
    // background goroutine flushes dirty entries to DB
    return nil
}
```

Accept the write into the cache and flush to DB asynchronously. Lowest write latency, highest risk: a crash before flush loses data. Use only when the data is regenerable or the latency requirement is extreme.

For most services: **write-around**. Simple, safe, predictable.

---

## Integration with HTTP Middleware

A response cache for idempotent GETs:

```go
type httpCache struct {
    inner *lru.Cache[string, cachedResponse]
}

type cachedResponse struct {
    status int
    body   []byte
    etag   string
}

func (h *httpCache) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
            next.ServeHTTP(w, r)
            return
        }
        key := r.URL.Path + "?" + r.URL.RawQuery
        if resp, ok := h.inner.Get(key); ok {
            if match := r.Header.Get("If-None-Match"); match == resp.etag {
                w.WriteHeader(http.StatusNotModified)
                return
            }
            w.Header().Set("ETag", resp.etag)
            w.WriteHeader(resp.status)
            _, _ = w.Write(resp.body)
            return
        }
        rec := &recorder{ResponseWriter: w}
        next.ServeHTTP(rec, r)
        if rec.status == http.StatusOK {
            etag := computeETag(rec.body.Bytes())
            h.inner.Add(key, cachedResponse{
                status: rec.status,
                body:   rec.body.Bytes(),
                etag:   etag,
            })
        }
    })
}
```

The cache lives in the middleware chain. Each handler does not need to know about it.

Caveats:

- **Personalised responses must not be cached** (or must be keyed by user). A cache that serves Alice's page to Bob is a data leak.
- **Cookies, auth headers, geo headers** can all change the response. Either bypass for authenticated requests or include the relevant headers in the cache key.
- **`Vary` header support** is non-trivial. Most middleware caches do not implement it correctly.

---

## Integration with gRPC Interceptors

A unary interceptor that caches responses for idempotent RPCs:

```go
type cachingInterceptor struct {
    cache *lru.Cache[string, interface{}]
}

func (c *cachingInterceptor) Unary(
    ctx context.Context,
    req interface{},
    info *grpc.UnaryServerInfo,
    handler grpc.UnaryHandler,
) (interface{}, error) {
    if !isCacheable(info.FullMethod) {
        return handler(ctx, req)
    }
    key := info.FullMethod + ":" + cacheKey(req)
    if resp, ok := c.cache.Get(key); ok {
        return resp, nil
    }
    resp, err := handler(ctx, req)
    if err == nil {
        c.cache.Add(key, resp)
    }
    return resp, err
}
```

Only cache RPCs that are explicitly marked safe to cache (typically `Get*` methods). Mutating RPCs must bypass.

Computing `cacheKey(req)` is the hard part — you need a stable serialisation of the request. `proto.Marshal` is one option but allocates. A typed function per RPC is faster.

---

## Integration with Database Repositories

The cache typically lives in the repository layer:

```go
type UserRepo struct {
    db    *sql.DB
    cache *lru.Cache[string, *User]
    sf    singleflight.Group
}

func (r *UserRepo) FindByID(ctx context.Context, id string) (*User, error) {
    if u, ok := r.cache.Get(id); ok {
        return u, nil
    }
    v, err, _ := r.sf.Do(id, func() (interface{}, error) {
        u, err := r.findByIDFromDB(ctx, id)
        if err != nil {
            return nil, err
        }
        r.cache.Add(id, u)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}

func (r *UserRepo) Update(ctx context.Context, u *User) error {
    if err := r.updateInDB(ctx, u); err != nil {
        return err
    }
    r.cache.Remove(u.ID) // write-around
    return nil
}

func (r *UserRepo) Delete(ctx context.Context, id string) error {
    if err := r.deleteFromDB(ctx, id); err != nil {
        return err
    }
    r.cache.Remove(id)
    return nil
}
```

Three operations cover most repos: read (cache-then-load), write (write-around), delete (delete + invalidate). The pattern is consistent across most domains.

---

## Benchmarks: Single Mutex vs Sharded vs `sync.Map`

A representative benchmark on a 16-core machine, with 16 goroutines, 1M operations each, 100K distinct keys:

```text
BenchmarkSingleMutex-16        7_843_521 ops/s    127 ns/op
BenchmarkSharded16-16         84_321_654 ops/s     11.8 ns/op
BenchmarkSharded64-16        112_587_223 ops/s      8.9 ns/op
BenchmarkSharded256-16       121_443_881 ops/s      8.2 ns/op
BenchmarkSyncMap-16           43_512_876 ops/s     22.9 ns/op
```

Observations:

- Single mutex tops out at ~8M ops/sec. Sharding to 16 stripes gets you 10x.
- Past 64 shards, returns diminish. Allocator and hash cost dominate.
- `sync.Map` is faster than single mutex but slower than sharded LRU. And it has no eviction.

The full benchmark harness:

```go
func BenchmarkSharded(b *testing.B) {
    for _, shards := range []int{1, 16, 64, 256} {
        b.Run(fmt.Sprintf("shards=%d", shards), func(b *testing.B) {
            c, _ := shardedlru.New[string, int](100_000, shards)
            for i := 0; i < 100_000; i++ {
                c.Add(strconv.Itoa(i), i)
            }
            b.ResetTimer()
            b.RunParallel(func(pb *testing.PB) {
                i := 0
                for pb.Next() {
                    c.Get(strconv.Itoa(i % 100_000))
                    i++
                }
            })
        })
    }
}
```

Always benchmark with `b.RunParallel`. A single-goroutine benchmark hides the contention story entirely.

---

## Memory Profiling the Cache

A cache that holds 1M `*User` entries should use, very roughly:

- ~32 MB for the map (entries, buckets).
- ~64 MB for the list nodes.
- N × sizeof(*User) for the values.

If memory usage is much higher, check:

1. **`pprof -alloc_space`** to see who is allocating. If the cache itself dominates, look at the value type — large struct cached by value will explode.
2. **`pprof -inuse_space`** to see live heap. If it grows over time without bound, you have a leak (eviction not running, or capacity-zero treated as unlimited).
3. **GC pressure**: `GODEBUG=gctrace=1` shows GC cycles. Many small allocations per second drive the GC up.

A common gotcha: caching `[]byte` values without copying the underlying array. If the loader returns a slice into a larger buffer, the whole buffer is retained as long as the cache holds the slice.

```go
// BAD
body, _ := io.ReadAll(resp.Body)
cache.Add(key, body[:100]) // retains the full body until eviction

// GOOD
trimmed := make([]byte, 100)
copy(trimmed, body[:100])
cache.Add(key, trimmed)
```

---

## Hot Key Detection

A hot key — one that gets 50%+ of all hits — is a problem because it serialises behind one shard's mutex. Detecting it:

```go
type hotKeyDetector struct {
    counts sync.Map // key string → *atomic.Uint64
}

func (d *hotKeyDetector) Record(key string) {
    if v, ok := d.counts.Load(key); ok {
        v.(*atomic.Uint64).Add(1)
        return
    }
    c := &atomic.Uint64{}
    c.Add(1)
    d.counts.Store(key, c)
}

func (d *hotKeyDetector) Top(n int) []string {
    type kv struct{ k string; v uint64 }
    var all []kv
    d.counts.Range(func(k, v interface{}) bool {
        all = append(all, kv{k.(string), v.(*atomic.Uint64).Load()})
        return true
    })
    sort.Slice(all, func(i, j int) bool { return all[i].v > all[j].v })
    if len(all) > n { all = all[:n] }
    out := make([]string, len(all))
    for i, kv := range all { out[i] = kv.k }
    return out
}
```

A periodic dump of the top 100 keys tells you which keys dominate. If the top 1 has 30%+ of traffic, sharding gains will be limited; consider:

- **Local thread-local caches** (one cache per goroutine, periodic merge).
- **Read replicas** (cache the same hot key in N parallel pods, accept staleness).
- **Inlining** (move the computation out of the cache and into a constant).

For ristretto-style caches, the admission filter (TinyLFU) handles this internally — hot keys naturally win admission contests.

---

## Common Mistakes at This Level

### Mistake 1 — Reusing one mutex for the cache and unrelated state

```go
type Service struct {
    mu sync.Mutex
    cache *lru.Cache[string, *User]
    config *Config
}

func (s *Service) Get(id string) *User {
    s.mu.Lock()
    defer s.mu.Unlock()
    if u, ok := s.cache.Get(id); ok { return u }
    // s.cache locks internally too — but s.mu is already held
    // ...
}
```

`lru.Cache` has its own lock. Wrapping it in another lock doubles the contention and doesn't add safety.

### Mistake 2 — Sharding too few or too many

Too few (1-4): you still bottleneck on a mutex.
Too many (1024+): you spend more time hashing than working.

### Mistake 3 — Skewed shard distribution

Using `key[0]` as the shard index. If most keys start with the same letter, one shard is hammered. Use a real hash.

### Mistake 4 — Eviction callback that allocates

```go
lru.NewWithEvict(128, func(k string, v *User) {
    log.Printf("evicted %s", k) // formats, allocates, holds the lock
})
```

Under high eviction rates this allocates millions of strings. Use a counter, not a log line, for per-eviction observability.

### Mistake 5 — Caching mutable values

```go
cache.Add(id, u)
go func() {
    u.Name = "modified" // races with any other goroutine reading u
}()
```

Once you've put `u` into the cache, you no longer own it. Either copy on write or treat the cached value as immutable.

### Mistake 6 — Forgetting to set a TTL for time-sensitive data

A 5-minute-old user is fine for most reads. A 5-minute-old "is this user banned?" answer is a security incident. TTL is a feature.

### Mistake 7 — Trusting `sync.Map` as an LRU

It is not. `sync.Map` has no eviction. Use it only for "load once, read many" patterns with a small fixed key set.

### Mistake 8 — Building a "cache" that wraps a database call without any actual caching

```go
func (s *Service) Get(id string) (*User, error) {
    return s.db.GetUser(id) // no cache!
}
```

The interface looks like a cache; the implementation isn't. Easy to introduce when you defer "real implementation later" and forget. Add a TODO + alert metric to catch the gap.

### Mistake 9 — Not handling the cache's `Add` returning `evicted=true`

The library's `Add` returns whether an eviction occurred. Some teams want to log or alert on first eviction; if you never check the bool, you can't.

### Mistake 10 — Not testing eviction order

A test like `TestEviction` (in the junior file) catches most regressions. Not having it means a "performance optimisation" might accidentally swap LRU for FIFO and no one notices.

---

## Pitfalls in Sharding

- **False sharing**: adjacent shard structs on the same cache line. Pad to 64 bytes.
- **Non-power-of-two shard counts**: forces modulo. Use bitmask.
- **Deterministic hash**: vulnerable to crafted collisions. Use random seed.
- **Hash on a pointer**: pointer addresses are not stable across runs and are often not well-distributed in low bits. Hash the value.
- **Per-shard capacity too small**: a hot shard evicts constantly while others are idle. Either size for the worst shard or accept the imbalance.
- **Sharing the shard array across two LRU instances**: do not. Each LRU owns its shards.

---

## Cheat Sheet

```text
CHOOSE BY WORKLOAD:
  Low concurrency, simple:        lru.New
  High concurrency:               sharded LRU around lru.New
  Scan-heavy:                     lru.New2Q
  Mixed recency/frequency:        lru.NewARC
  Time-sensitive freshness:       expirable.NewLRU
  Frequency-skewed, high QPS:     ristretto (W-TinyLFU)

SHARDING:
  shards = power of 2; mask = shards - 1
  shard idx = hash(k) & mask
  per-shard cap = total / shards (rounded up)
  pad shard structs to 64 bytes

CONCURRENCY HELPERS:
  singleflight.Group for deduplication of concurrent misses
  atomic counters for hit/miss/eviction metrics
  context for cancellation (loader respects ctx)

WRITE PATTERNS:
  write-around (Remove): simplest and safest
  write-through (Add):  warmer next read; more failure modes
  write-back (async flush): lowest latency; highest risk
```

---

## Self-Assessment Checklist

- [ ] I can build a sharded LRU from scratch in 150 lines.
- [ ] I know why shards should be a power of two and why each struct should be 64 bytes.
- [ ] I can name three workloads where 2Q beats plain LRU.
- [ ] I can name a workload where ARC beats both.
- [ ] I can integrate `singleflight` with an LRU.
- [ ] I have benchmarked single-mutex vs sharded under contention.
- [ ] I can detect hot keys and explain why they limit sharding gains.
- [ ] I know when to choose write-through, write-around, or write-back.

---

## Summary

Middle-level concurrent LRU is about sharding, choosing the right variant from `hashicorp/golang-lru/v2`, and combining the cache with singleflight, TTL, and write patterns. Sharding turns a single-mutex bottleneck into a per-shard bottleneck and scales to tens of millions of ops per second. 2Q and ARC handle access patterns that defeat plain LRU. Expirable LRU handles freshness. The right cache for your service is a combination of these, sized to your workload and instrumented so you can see what is happening.

The senior file moves to lock-free reads, BP-Wrapper, ristretto internals (W-TinyLFU sketches, admission filters), and S3-FIFO.

---

## Related Topics

- [Junior level](junior.md) — single-mutex correctness and the LRU invariant.
- [Senior level](senior.md) — lock-free reads, ristretto internals, S3-FIFO.
- [Goroutines overview](../../01-goroutines/01-overview/) — concurrency basics.
- [`sync.Map`](../../04-sync-map/) — the standard concurrent map and why it is not an LRU.
- [TTL caches](../01-ttl-caches/) — time-based eviction in depth.

## Closing notes on the middle level

The middle level is the practical level. You will spend most of your career here. The patterns in this file — sharding, singleflight, write-around, stale-while-revalidate, layered caches — cover the vast majority of production cache work in Go.

Two recurring themes:

1. **Measure first.** Every optimisation should be motivated by a metric. "I think this will help" is not a reason; "the mutex profile shows 30% wait" is.
2. **Simplicity wins.** A 50-line cache with a single mutex outperforms a 500-line cache built on premature optimisation. Reach for sharding, ristretto, or hierarchies only when the simple option fails to meet a measured target.

The senior level shifts focus from "use the library" to "understand the library." Lock-free reads, BP-Wrapper, ristretto's W-TinyLFU sketches, and S3-FIFO each require deep concurrency knowledge. They are powerful tools and dangerous toys; this file gives you the foundation to evaluate them in your own code.

## Worked benchmarks: numbers you can reproduce

Below are benchmark scripts and the kinds of numbers you should expect. Reproduce them on your hardware before drawing conclusions.

### Setup

```go
package bench_test

import (
    "math/rand"
    "strconv"
    "sync"
    "testing"

    lru "github.com/hashicorp/golang-lru/v2"
    "github.com/dgraph-io/ristretto"
)

const (
    cap       = 16384
    keyspace  = 32768 // 2x cache: ~50% hit rate
)

var keys [keyspace]string

func init() {
    for i := range keys {
        keys[i] = strconv.Itoa(i)
    }
}
```

### Single-mutex `golang-lru/v2`

```go
func BenchmarkPlainLRU(b *testing.B) {
    c, _ := lru.New[string, int](cap)
    for i := 0; i < cap; i++ {
        c.Add(keys[i], i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := keys[r.Intn(keyspace)]
            if _, ok := c.Get(k); !ok {
                c.Add(k, 0)
            }
        }
    })
}
```

Typical output on a 16-core machine:

```text
BenchmarkPlainLRU-16    4527843    265 ns/op    1 allocs/op
```

About 4.5M ops/s aggregate, 265 ns/op single-thread-equivalent. Adds allocate one `*entry` per insert.

### Sharded LRU

```go
func BenchmarkSharded64(b *testing.B) {
    c, _ := shardedlru.New[string, int](cap, 64)
    for i := 0; i < cap; i++ {
        c.Add(keys[i], i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := keys[r.Intn(keyspace)]
            if _, ok := c.Get(k); !ok {
                c.Add(k, 0)
            }
        }
    })
}
```

Typical output:

```text
BenchmarkSharded64-16   58932410    22 ns/op    2 allocs/op
```

About 59M ops/s — 13x the single mutex. Extra allocation is the `maphash.Hash` value, addressable as `var h maphash.Hash` on the stack but escaping in some builds. Use `b.ReportAllocs()` to verify.

### ristretto

```go
func BenchmarkRistretto(b *testing.B) {
    c, _ := ristretto.NewCache(&ristretto.Config{
        NumCounters: 1 << 20, // tracks ~1M keys
        MaxCost:     cap,
        BufferItems: 64,
    })
    for i := 0; i < cap; i++ {
        c.SetWithTTL(keys[i], i, 1, 0)
    }
    c.Wait() // ensure all are admitted
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := keys[r.Intn(keyspace)]
            if _, ok := c.Get(k); !ok {
                c.Set(k, 0, 1)
            }
        }
    })
}
```

Typical output:

```text
BenchmarkRistretto-16   123847619    9.7 ns/op    0 allocs/op
```

About 124M ops/s. No allocations on Get. The cost is API complexity (cost, TTL, BufferItems, NumCounters all to configure).

### Interpretation

- For workloads under 5M ops/s, **`lru.New`** is fine.
- For 5-50M ops/s, **sharded `lru.New`** with 16-64 shards.
- For >50M ops/s or skewed workloads, **ristretto**.

Numbers will vary with CPU, allocator, GC, and key types. Always measure your specific workload.

## Anatomy of a sharded LRU implementation, line by line

Let us walk through the sharded LRU above field by field and method by method, explaining design decisions.

### Field: `shards []*shard[K, V]`

A slice of pointer-to-shard. Pointers (not values) because:

1. **Each shard must be independently addressable** so its mutex stays put. Values in a slice can be moved by `append`.
2. **The padding trick** works only with pointer indirection — each shard's struct is allocated separately and the 64-byte boundary is per-allocation.
3. **Pointer-sized slice elements** are cache-friendly: 8 bytes each on amd64.

### Field: `shardMask uint64`

Stored as `numShards - 1`. The bitmask trick `hash & mask == hash % numShards` works only for power-of-two `numShards`. We validate in `New` and panic otherwise — a programmer error, not a runtime condition.

### Field: `seed maphash.Seed`

A 64-bit random value generated at construction. Each cache instance has its own seed. This means two pods running the same code map the same keys to different shards (which is fine — sharding is per-pod). It also means an attacker who knows the algorithm cannot precompute a key that maps to a specific shard.

### Method: `pick(k K) *shard[K, V]`

Three lines:

```go
var h maphash.Hash
h.SetSeed(c.seed)
h.WriteString(string(k))
return c.shards[h.Sum64()&c.shardMask]
```

- `var h maphash.Hash` is a zero-cost stack allocation. The hash state lives in the local stack frame.
- `h.SetSeed(c.seed)` configures the random salt.
- `h.WriteString(string(k))` hashes the key. For `~string` keys, the conversion `string(k)` is a no-op cost.
- `h.Sum64() & c.shardMask` extracts a shard index in one instruction.

The whole call is ~20 ns. On a 100M ops/sec workload that is 2 seconds of CPU per second across all cores — significant but acceptable.

### Method: `Get(k K) (V, bool)`

```go
return c.pick(k).inner.Get(k)
```

One line. The shard handles its own locking. Throughput scales with `numShards` until other bottlenecks kick in.

### Method: `Len() int`

```go
n := 0
for _, s := range c.shards {
    n += s.inner.Len()
}
return n
```

O(N) where N is the shard count, not the entry count. Acceptable for diagnostics. Each `s.inner.Len()` takes the shard's RLock briefly — fast but not free. Do not call `Len` in a hot path.

### Method: `Purge()`

```go
var wg sync.WaitGroup
for _, s := range c.shards {
    wg.Add(1)
    go func(s *shard[K, V]) {
        defer wg.Done()
        s.inner.Purge()
    }(s)
}
wg.Wait()
```

Purges all shards in parallel. Each `Purge` is O(per-shard-capacity), so the total wall time is roughly (per-shard-capacity × per-op-cost). With 64 shards and 16K per shard, that is 1M ops total — possibly 100 ms wall time. Parallelism makes it 100 ms / numCPU at best.

A subtle bug: the closure captures `s`. We pass `s` as a parameter to avoid the captured-loop-variable trap on pre-1.22 Go. On 1.22+ this is automatic.

## When sharding gives no benefit

Three workloads where sharding does not help:

### Single hot key

If 90% of operations target one key, all hit the same shard. Sharding gains are 10% improvement at best. Mitigation: ristretto (admission filter sees the hot key), per-goroutine L1 cache (absorbs the hot key entirely), or hash the key into N "virtual keys" (loses LRU semantics).

### Very low concurrency

If only 4 goroutines ever touch the cache, sharding past 4 shards is wasted memory. A single-mutex LRU is fine until you saw measurable contention.

### Allocator-bound workload

If every Add allocates 1 KB and the allocator is the bottleneck (visible in `pprof`), sharding the lock does not help; the allocator is still a single global resource. Use `sync.Pool` for the value type instead.

## Visual: the sharded LRU layout in memory

```text
Cache struct (one per process)
┌──────────────────────────────────────────┐
│ shards   : []*shard ────┐                │
│ shardMask: uint64       │                │
│ seed     : maphash.Seed │                │
└─────────────────────────┼────────────────┘
                          │
                          ▼
                     ┌───────┬───────┬───────┬───┐
                     │ *sh 0 │ *sh 1 │ *sh 2 │...│
                     └───┬───┴───┬───┴───┬───┴───┘
                         │       │       │
                         ▼       ▼       ▼
                  shard[0] ── shard[1] ── shard[2]  (each on its own cache line)
                 ┌────────┐  ┌────────┐  ┌────────┐
                 │ inner  │  │ inner  │  │ inner  │
                 │ sf     │  │ sf     │  │ sf     │
                 │ _pad   │  │ _pad   │  │ _pad   │
                 └────────┘  └────────┘  └────────┘
                  ▲           ▲           ▲
                  │           │           │
                  64-byte alignment boundaries
```

Each shard struct is independently allocated, so the Go runtime gives each one its own allocation slot. With the padding to 64 bytes, no two shards share a cache line and `MoveToFront` operations on different shards do not invalidate each other's L1 lines.

## Tooling: visualising shard distribution

A quick utility to confirm your keys distribute uniformly:

```go
func ShardDistribution[K ~string](keys []K, numShards int) []int {
    seed := maphash.MakeSeed()
    counts := make([]int, numShards)
    mask := uint64(numShards - 1)
    for _, k := range keys {
        var h maphash.Hash
        h.SetSeed(seed)
        h.WriteString(string(k))
        counts[h.Sum64()&mask]++
    }
    return counts
}
```

Run with a sample of your real keys; check that no shard has >2x the average. Skew above that suggests either a bad hash function or fundamentally skewed keys (e.g., 90% start with "user:" — fine, the hash mixes; but 90% are *literally the same key* — sharding does not help).

## Worked example: detecting and fixing false sharing

Suppose your sharded LRU is slower than expected. You suspect false sharing.

### Detect

Run with the `perf` profiler on Linux:

```bash
perf stat -e cache-misses,L1-dcache-load-misses ./mybenchmark
```

If `L1-dcache-load-misses` is much higher than `cache-misses`, false sharing is likely.

Or use `runtime.SetMutexProfileFraction(1)` and look for unrelated mutexes appearing as contention points — that is a sign cache lines are bouncing.

### Fix

Add padding to push each shard struct to a 64-byte boundary:

```go
type shard[K, V any] struct {
    inner *lru.Cache[K, V]
    _pad  [56]byte // 8 bytes for the pointer + 56 padding = 64
}
```

Use `unsafe.Sizeof` to confirm:

```go
func init() {
    if unsafe.Sizeof(shard[string, int]{}) != 64 {
        panic("shard padding incorrect")
    }
}
```

If your shard struct has more fields (sf group, atomic counters), recompute the padding:

```go
type shard[K, V any] struct {
    inner *lru.Cache[K, V]       // 8 bytes
    sf    singleflight.Group     // 16 bytes (typical)
    _pad  [40]byte               // 40 bytes
    // total = 64 bytes
}
```

After the fix, re-run the benchmark. A 2-5x speedup on multi-shard caches is common.

## Memory-aware sharding

If memory is constrained (small embedded environment, tight container limits), sharding's per-shard overhead matters. Each shard holds:

- A `*lru.Cache` struct (~100 bytes).
- A `simplelru.LRU` (~50 bytes).
- A `map[K]*list.Element` with capacity = per-shard cap (~16 bytes × capacity, rounded up to nearest power of two).
- A `list.List` (~50 bytes, plus per-element nodes counted in the entries).

For 64 shards each holding 256 entries, the overhead (before entries themselves) is:

- 64 × (100 + 50 + 50) = ~13 KB struct overhead.
- 64 × 16 × 256 = ~260 KB map buckets.
- Total: ~273 KB before entries.

Versus a single LRU of 16384 entries:

- 100 + 50 + 50 = ~200 bytes struct overhead.
- 16 × 16384 = ~256 KB map buckets.
- Total: ~256 KB.

So sharding adds ~17 KB to total memory for this size. Negligible.

For very large caches (millions of entries), the overhead is still <1%. Memory is rarely the reason to avoid sharding.

## Per-shard configuration

Sometimes one shard needs different settings — for example, you know shard 0 always holds a hot subset that deserves more capacity. The sharded LRU above gives each shard identical capacity. To customise:

```go
func New[K ~string, V any](configs []ShardConfig) (*Cache[K, V], error) {
    numShards := len(configs)
    if numShards&(numShards-1) != 0 || numShards == 0 {
        return nil, errors.New("shard count must be power of two")
    }
    c := &Cache[K, V]{
        shards:    make([]*shard[K, V], numShards),
        shardMask: uint64(numShards) - 1,
        seed:      maphash.MakeSeed(),
    }
    for i, cfg := range configs {
        inner, err := lru.New[K, V](cfg.Capacity)
        if err != nil {
            return nil, err
        }
        c.shards[i] = &shard[K, V]{inner: inner}
    }
    return c, nil
}

type ShardConfig struct {
    Capacity int
}
```

In practice, per-shard customisation is rare — sharding is supposed to be transparent. Use this only when you have a clear reason.

## Sharding with consistent hashing

If your cache hierarchy needs *resharding* (e.g., you add more shards at runtime), consistent hashing minimises the number of keys that move. Hash the key, then map to a shard using a virtual-node ring.

```go
import "stathat.com/c/consistent"

type Cache[K ~string, V any] struct {
    shards map[string]*shard[K, V]
    ring   *consistent.Consistent
}

func (c *Cache[K, V]) pick(k K) *shard[K, V] {
    nodeName, _ := c.ring.Get(string(k))
    return c.shards[nodeName]
}
```

For an in-process LRU you almost never need consistent hashing — you can recreate the cache from scratch on capacity changes. But for distributed caches (Memcached client, Redis cluster), consistent hashing is the standard.

## When to use `sync.Map` instead

`sync.Map` is great when:

- Keys are write-once. After the first `Store`, subsequent `Load`s are fast and lock-free for those keys.
- The key space is bounded and small. No eviction means unbounded growth otherwise.
- You need `Range` (iterate all entries). LRU does not provide a Range guarantee.

`sync.Map` is not great when:

- The cache needs bounded memory. Use LRU.
- Writes are frequent. `sync.Map` is optimised for read-heavy patterns.
- Eviction is required for any reason. Use LRU.

A common mistake: using `sync.Map` because it sounds concurrent and ending up with a memory leak.

## Pattern: cache layered with a slow-and-reliable backend

For services where reliability matters more than freshness:

```go
type LayeredCache struct {
    fast *lru.Cache[string, *User]
    slow Backend // e.g., Redis, or a slow but reliable DB
}

func (c *LayeredCache) Get(ctx context.Context, id string) (*User, error) {
    if u, ok := c.fast.Get(id); ok {
        return u, nil
    }
    // try slow backend with a short timeout
    ctx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
    defer cancel()
    u, err := c.slow.Get(ctx, id)
    if err == nil {
        c.fast.Add(id, u)
        return u, nil
    }
    // fall back to a default or cached fallback
    if u, ok := c.fast.Peek(id); ok {
        return u, nil // stale but available
    }
    return nil, err
}
```

The `Peek` here is critical — it serves stale-but-alive data when the slow backend is unreachable. This is a poor-man's circuit breaker.

## Cache-aside vs read-through

Two architectural styles for who triggers the load.

### Cache-aside

The application checks the cache, misses, and explicitly loads.

```go
u, ok := cache.Get(id)
if !ok {
    u, _ = db.Get(id)
    cache.Add(id, u)
}
```

Pros: simple, no magic. Cons: caller must remember the pattern; easy to bypass.

### Read-through

The cache itself triggers the load via a configured loader.

```go
u, _ := cache.GetOrLoad(id, func() (*User, error) {
    return db.Get(id)
})
```

Pros: centralised loader; caller cannot bypass. Cons: cache must know about the loader.

For most Go services, cache-aside is more common because it composes naturally with `singleflight` and per-call context. Read-through is more common in Java frameworks.

## A note on cache-aware data design

The choice of *what* to cache often matters more than the cache implementation. Examples:

- **Cache the result of a JOIN, not each table.** Recomputing the JOIN on a hit defeats the purpose.
- **Cache after authorisation, not before.** Otherwise you cache results that may be unauthorised for the next caller.
- **Cache the *shape* the consumer needs, not the database row.** Marshalling on each call wastes CPU; cache the marshalled form.
- **Cache by canonical key, not request-specific key.** A query like `/users?id=42&include=profile` should cache by `(42, "profile")`, not by the full URL.

The cache is the speedup. Design what goes into it as carefully as you design the cache itself.

## A real-world checklist before shipping

- [ ] Capacity is configurable.
- [ ] Numbers shards is power-of-two and configurable.
- [ ] TTL is configurable (zero means "no TTL").
- [ ] Eviction callback is non-blocking.
- [ ] Metrics: hits, misses, evictions, load_errors, current_size.
- [ ] singleflight wraps the loader if multiple callers may miss the same key.
- [ ] Negative caching: missing-entry sentinel with short TTL.
- [ ] Stale-while-revalidate: optional, for endpoints with strict latency SLOs.
- [ ] Circuit breaker around the loader: optional, for endpoints with unreliable downstreams.
- [ ] Tests: basic, eviction, concurrent (-race), benchmark, stress.
- [ ] Feature flag to disable the cache entirely.
- [ ] Documented staleness contract.
- [ ] Rolled out behind a percentage flag, not 100% on first deploy.
- [ ] Dashboards: hit rate, eviction rate, size, p99 latency with/without cache.
- [ ] Alert: hit rate < threshold for N minutes.

Most teams ship without 5-6 of these. The ones that ship with all of them have fewer cache-related incidents.

## Deeper dive: when to use which variant

A decision tree based on workload profile:

```text
Start here
  │
  ├─ Is the working set << cache capacity?
  │     └─ Yes ─► plain LRU is fine. No need for fancy.
  │
  ├─ Are reads >> writes (≥100:1)?
  │     ├─ Yes + scan-prone ─► 2Q
  │     └─ Yes + steady ─► plain LRU + RWMutex for Peek-heavy
  │
  ├─ Is frequency the dominant signal?
  │     └─ Yes ─► ARC or W-TinyLFU (ristretto)
  │
  ├─ Does the data have a hard freshness deadline?
  │     └─ Yes ─► expirable.LRU or wrap with timestamps
  │
  ├─ Is contention measurable in pprof (>20% lock wait)?
  │     └─ Yes ─► sharded LRU (16-64 shards)
  │
  └─ Throughput target > 10M ops/sec on a single pod?
        └─ Yes ─► ristretto (W-TinyLFU, lock-free buffered Get)
```

Most services answer "no" at every branch and end up with `lru.New[K, V](N)`. That is correct.

## Configuration patterns

### Static configuration

```go
type CacheConfig struct {
    Capacity int
    Shards   int
    TTL      time.Duration
}

var DefaultUserCache = CacheConfig{
    Capacity: 16384,
    Shards:   32,
    TTL:      5 * time.Minute,
}
```

Read from environment or flags at startup. Validate on read. Easy to understand, hard to misuse.

### Dynamic configuration

```go
type Cache struct {
    config atomic.Pointer[CacheConfig]
    // ...
}

func (c *Cache) UpdateConfig(cfg CacheConfig) {
    c.config.Store(&cfg)
    // optionally resize the inner cache
}
```

A config-update channel (etcd, Consul, in-app config service) pushes new values. The cache picks them up on the next operation. Useful when capacity must change without redeploy.

The trap: if the new TTL is shorter, entries that were valid become invalid mid-flight. Test the transition carefully.

### Profile-based configuration

```go
type CachePreset string

const (
    PresetMinimal     CachePreset = "minimal"     // 1024 cap, 1 shard
    PresetDefault     CachePreset = "default"     // 16384 cap, 16 shards
    PresetHighTraffic CachePreset = "high"        // 65536 cap, 64 shards
    PresetMassive     CachePreset = "massive"     // 1M cap, 256 shards
)

func ConfigForPreset(p CachePreset) CacheConfig { /* ... */ }
```

Operators choose by intent, not by numbers. Easier to reason about; harder to misconfigure.

## Mixing caches: 2Q for one path, plain LRU for another

A single service might have multiple cache types:

```go
type UserService struct {
    profileCache  *lru.Cache[string, *Profile]        // plain LRU
    sessionCache  *expirable.LRU[string, *Session]    // TTL
    analyticsCache *lru.TwoQueueCache[string, *Stats] // scan-resistant
}
```

Each cache matches its workload. The shared pool of 50 KB total memory is allocated across three caches by priority. Different access patterns, different policies.

## Cache decomposition: when one cache should be many

If your cache contains very different value sizes (1 KB user profiles + 10 MB rendered reports), per-entry capacity becomes a problem. The big values evict the small ones disproportionately. Solution:

```go
type Cache struct {
    small *lru.Cache[string, *Profile] // capacity 10000
    large *lru.Cache[string, *Report]  // capacity 100
}
```

The small cache handles 10000 small items in a few MB. The large cache handles 100 large items in 1 GB. Total memory is bounded by both caps; eviction in one does not affect the other.

This is also useful when access patterns differ. Profile reads are 99% hit rate; report reads are 30% hit rate. Mixing them in one cache lets the cold reports thrash the hot profiles.

## Cache as a structural pattern

The cache pattern fits naturally with the **decorator pattern**:

```go
type UserRepo interface {
    Get(ctx context.Context, id string) (*User, error)
    Update(ctx context.Context, u *User) error
}

type cachedRepo struct {
    inner UserRepo
    cache *lru.Cache[string, *User]
}

func NewCachedRepo(inner UserRepo, cache *lru.Cache[string, *User]) UserRepo {
    return &cachedRepo{inner: inner, cache: cache}
}

func (c *cachedRepo) Get(ctx context.Context, id string) (*User, error) {
    if u, ok := c.cache.Get(id); ok {
        return u, nil
    }
    u, err := c.inner.Get(ctx, id)
    if err != nil {
        return nil, err
    }
    c.cache.Add(id, u)
    return u, nil
}

func (c *cachedRepo) Update(ctx context.Context, u *User) error {
    if err := c.inner.Update(ctx, u); err != nil {
        return err
    }
    c.cache.Remove(u.ID)
    return nil
}
```

The cache is transparent to callers. The underlying repo is unchanged. You can compose caches:

```go
repo := NewSQLRepo(db)
repo = NewCachedRepo(repo, localCache)
repo = NewMetricsRepo(repo)
repo = NewLoggingRepo(repo)
```

Each layer adds a concern without touching the others. The cache is just one layer in the stack.

## Practical recipes for common scenarios

### Recipe 1 — Caching paginated API responses

```go
type pageKey struct {
    Endpoint string
    Cursor   string
    Limit    int
}

func (s *Service) makeKey(endpoint, cursor string, limit int) string {
    return fmt.Sprintf("%s|%s|%d", endpoint, cursor, limit)
}

func (s *Service) GetPage(ctx context.Context, endpoint, cursor string, limit int) (*Page, error) {
    key := s.makeKey(endpoint, cursor, limit)
    if p, ok := s.cache.Get(key); ok {
        return p, nil
    }
    p, err := s.fetchPage(ctx, endpoint, cursor, limit)
    if err != nil {
        return nil, err
    }
    s.cache.Add(key, p)
    return p, nil
}
```

The key encodes all parameters that affect the response. The cursor must be deterministic for the same query — otherwise you cache infinite distinct results.

### Recipe 2 — Caching computed aggregates

```go
type aggregateKey struct {
    Metric string
    Period string // e.g., "2025-05-18"
}

func (s *Service) GetAggregate(ctx context.Context, metric, period string) (float64, error) {
    key := metric + "|" + period
    if v, ok := s.cache.Get(key); ok {
        return v, nil
    }
    v, err := s.computeAggregate(ctx, metric, period)
    if err != nil {
        return 0, err
    }
    s.cache.Add(key, v)
    return v, nil
}
```

Aggregates over closed time periods (yesterday, last hour) are immutable — long TTL is safe. Aggregates over open periods (today, last 5 min) change — short or no TTL.

### Recipe 3 — Caching authorisation decisions

```go
type authKey struct {
    UserID   string
    Resource string
    Action   string
}

func (s *Service) Authorize(ctx context.Context, userID, resource, action string) (bool, error) {
    key := fmt.Sprintf("%s|%s|%s", userID, resource, action)
    if allowed, ok := s.cache.Get(key); ok {
        return allowed, nil
    }
    allowed, err := s.policy.Check(ctx, userID, resource, action)
    if err != nil {
        return false, err
    }
    s.cache.Add(key, allowed)
    return allowed, nil
}
```

Cache TTL is the maximum acceptable delay between a policy change and its effect. For most enterprise policies, 30-60 seconds is acceptable. For high-stakes operations (financial, security), bypass the cache.

### Recipe 4 — Caching feature-flag evaluations

```go
type flagKey struct {
    Flag   string
    UserID string
}

func (s *Service) IsEnabled(flag, userID string) bool {
    key := flag + "|" + userID
    if v, ok := s.cache.Get(key); ok {
        return v
    }
    v := s.evaluator.Eval(flag, userID) // CPU-bound rule engine
    s.cache.Add(key, v)
    return v
}
```

Feature flags are read on every request — a textbook hot path. The cache makes them effectively free. TTL should match your flag refresh interval (typically 30-60 s).

### Recipe 5 — Caching short-lived but heavy responses

```go
func (s *Service) GetReport(ctx context.Context, id string) (*Report, error) {
    if r, ok := s.cache.Get(id); ok {
        return r, nil
    }
    r, err, _ := s.sf.Do(id, func() (interface{}, error) {
        return s.generator.Generate(ctx, id)
    })
    if err != nil {
        return nil, err.(error)
    }
    rep := r.(*Report)
    s.cache.Add(id, rep)
    return rep, nil
}
```

Reports may take 2-3 seconds to generate. A cache hit returns instantly. `singleflight` prevents duplicate generation when 100 dashboards refresh simultaneously.

## Sharding alternatives

Sharding by hash is the most common pattern. A few others worth knowing:

### Sharding by key prefix

```go
func (c *Cache) pick(k string) *shard {
    if strings.HasPrefix(k, "user:") {
        return c.shards[0]
    }
    if strings.HasPrefix(k, "config:") {
        return c.shards[1]
    }
    return c.shards[2]
}
```

Useful when different prefixes have wildly different access patterns. Each shard can be sized independently. Drawback: you must enumerate prefixes; new prefixes go to the default shard.

### Sharding by tenant

```go
func (c *Cache) pick(tenantID string) *shard {
    return c.shards[hash(tenantID)&c.mask]
}
```

In multi-tenant systems, sharding by tenant means one tenant's churn does not evict another tenant's hot data. A bursty tenant only hurts itself.

### Sharding by key type

```go
type Cache struct {
    users    *lru.Cache[string, *User]
    sessions *lru.Cache[string, *Session]
    configs  *lru.Cache[string, *Config]
}
```

Two-or-three separate caches, each with its own capacity. Easier to reason about than one big sharded cache. Often the right answer.

The principle: shard by *something orthogonal to access pattern*. Hashing the key works because hash is uncorrelated with access. Sharding by prefix works because prefixes often correspond to distinct workloads. Sharding by tenant works because tenants are independent.

## How to migrate from a single-mutex to a sharded cache

A typical PR:

1. Define the new sharded cache type with the same interface as the old one.
2. Add a feature flag `use_sharded_cache=false` by default.
3. Construct both caches at startup; only one is used.
4. Route based on the flag.
5. Deploy. Flip the flag for 1% of traffic.
6. Compare metrics (hit rate, latency, memory).
7. Flip to 100%.
8. Remove the old cache and the flag.

Total time: a week. The cost of *not* doing it carefully: an incident where the new cache has a subtle bug (e.g., key distribution skew) and tail latency spikes.

## Diagnosing a cache that "should be helping but isn't"

Symptoms: low hit rate despite ample capacity. Common causes:

1. **Keys are not what you think.** Are you caching by `(endpoint, params)` but the params include a timestamp? Every request has a unique key.
2. **Capacity is wrong.** The working set is bigger than capacity, so the cache thrashes.
3. **TTL is too short.** Every entry expires before it can be reused.
4. **Cache is created per-request, not per-process.** The `cache := lru.New(...)` is inside a handler.
5. **Cache wrapper is broken.** The wrapper always calls the underlying loader, ignoring the cache.
6. **Wrong key normalisation.** `userID="42"` and `userID="042"` cache as different keys.

Debug systematically:

- Log a sample of keys; check uniqueness.
- Log the loader call rate; if it equals the request rate, the cache is bypassed.
- Add a `cache_age_at_get` histogram; if everything is 0, you have a TTL or eviction problem.
- Add a `cache_capacity_used` gauge; if it stays at 100%, you are at capacity.

A useful trick: temporarily set `capacity = 1_000_000` and see if hit rate goes up. If yes, capacity was the problem. If no, look elsewhere.

## Building a cache hierarchy: L1 / L2 / L3

Production systems often combine multiple caches in a hierarchy:

```text
L1: per-goroutine cache (sync.Pool or local map)
       │   miss
       ▼
L2: per-pod LRU (this file)
       │   miss
       ▼
L3: Redis / Memcached (network)
       │   miss
       ▼
DB: source of truth
```

Each layer trades latency for hit rate and consistency:

- **L1** is sub-nanosecond. Used for very hot keys touched within one request.
- **L2** is sub-microsecond. Shared across goroutines in one pod.
- **L3** is millisecond. Shared across pods. May be invalidated centrally.
- **DB** is 1-100 ms. Source of truth.

A typical request: 60% L1 hits, 30% L2 hits, 8% L3 hits, 2% DB hits. The total latency budget is dominated by the 2% DB tail; L1 makes the 60% effectively free.

A cache hierarchy is *not* a free lunch. Each layer has its own consistency contract. A write must invalidate every layer (or accept staleness in higher layers). Code complexity grows linearly with layers. Most services use L2 + L3; pure L1 is rare outside very specialised cases.

## Worked example: the `singleflight` pattern with concurrency edge cases

Let us walk through `singleflight` semantics step by step. Suppose 100 goroutines all call `Get(ctx, "user:42")` at the same instant. The cache misses for all of them.

```text
t=0: G1 reads cache, miss. Calls sf.Do("user:42", loadFn).
     singleflight creates a call group for "user:42".
     G1 starts loadFn().
t=1: G2 reads cache, miss. Calls sf.Do("user:42", loadFn).
     singleflight finds existing call group. G2 parks on the group's WaitGroup.
     G2 does NOT call loadFn.
...
t=50: G100 also parks.
t=80ms: loadFn returns (user, nil).
     singleflight stores the result in the call group.
     Wakes G1..G100 all at once.
     Each returns the same user.
     singleflight removes the call group.
```

Critical observations:

- **Only one loadFn runs.** The other 99 wait.
- **All callers get the same value.** Including the same `*User` pointer — they share the result. If one mutates it, all see the mutation.
- **The call group survives only for the duration of `loadFn`.** A new call at t=81ms gets the cached value (assuming `loadFn` populated the cache) or starts a fresh load.
- **Errors are shared.** If `loadFn` fails, all callers see the error. Even transient errors.

Tweaks for robustness:

```go
// Forget the result immediately so a failed load does not stick around.
v, err, _ := sf.Do(key, func() (interface{}, error) {
    u, err := load()
    if err != nil {
        sf.Forget(key) // allow next caller to retry immediately
        return nil, err
    }
    cache.Add(key, u)
    return u, nil
})
```

Without `Forget`, a failed call's error is cached only for the duration of the call. The next caller starts a fresh call anyway. So `Forget` is usually not strictly needed — but it makes the intent explicit.

For per-call timeouts:

```go
ch := sf.DoChan(key, loadFn)
select {
case res := <-ch:
    return res.Val.(*User), res.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

The load continues in the background. Other waiters on the same key may still get the result. Useful when one caller has a short deadline but you do not want to abandon the work.

## Combining LRU with circuit breakers

Caches sit in front of slow systems. When the slow system is broken, you do not want misses to pile up against it. A circuit breaker:

```go
import "github.com/sony/gobreaker"

type Cache struct {
    inner   *lru.Cache[string, *User]
    breaker *gobreaker.CircuitBreaker
    loader  func(string) (*User, error)
}

func New(capacity int, loader func(string) (*User, error)) *Cache {
    cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
        Name:        "user-loader",
        MaxRequests: 3,
        Interval:    10 * time.Second,
        Timeout:     30 * time.Second,
        ReadyToTrip: func(c gobreaker.Counts) bool {
            return c.ConsecutiveFailures > 5
        },
    })
    inner, _ := lru.New[string, *User](capacity)
    return &Cache{inner: inner, breaker: cb, loader: loader}
}

func (c *Cache) Get(id string) (*User, error) {
    if u, ok := c.inner.Get(id); ok {
        return u, nil
    }
    v, err := c.breaker.Execute(func() (interface{}, error) {
        return c.loader(id)
    })
    if err != nil {
        // breaker open or load failed — serve stale if available
        if u, ok := c.inner.Peek(id); ok {
            return u, nil
        }
        return nil, err
    }
    u := v.(*User)
    c.inner.Add(id, u)
    return u, nil
}
```

When the breaker is open, the cache becomes the only data source. Stale beats nothing. This pattern keeps your service alive during downstream outages.

## Stale-while-revalidate

A variant of TTL: when an entry expires, serve the stale value *and* refresh it in the background.

```go
type entry struct {
    val       *User
    fetchedAt time.Time
    refresh   atomic.Bool
}

func (c *Cache) Get(id string) (*User, error) {
    e, ok := c.inner.Get(id)
    if ok {
        age := time.Since(e.fetchedAt)
        if age > c.softTTL && !e.refresh.Load() && e.refresh.CompareAndSwap(false, true) {
            go c.refreshInBackground(id)
        }
        if age < c.hardTTL {
            return e.val, nil
        }
        // hard TTL expired; must load synchronously
    }
    return c.loadSync(id)
}

func (c *Cache) refreshInBackground(id string) {
    u, err := c.loader(id)
    if err != nil {
        return // keep old value
    }
    c.inner.Add(id, &entry{val: u, fetchedAt: time.Now()})
}
```

Two TTLs:

- **Soft TTL**: serve stale + refresh asynchronously.
- **Hard TTL**: stop serving entirely; load synchronously.

The CAS on `refresh` ensures only one background refresh per key per soft-TTL window. This pattern eliminates the latency spike at cache expiry.

## Cache warming

A pod that just started has a cold cache. Every request takes the slow path. If the workload has known hot keys, warm them at startup:

```go
func (s *Service) Start(ctx context.Context) error {
    topKeys, err := s.analytics.TopKeys(ctx, 100)
    if err != nil {
        log.Printf("warm cache failed (continuing): %v", err)
    } else {
        var wg sync.WaitGroup
        sem := make(chan struct{}, 8) // 8 concurrent loaders
        for _, k := range topKeys {
            wg.Add(1)
            sem <- struct{}{}
            go func(k string) {
                defer wg.Done()
                defer func() { <-sem }()
                if u, err := s.repo.findByIDFromDB(ctx, k); err == nil {
                    s.cache.Add(k, u)
                }
            }(k)
        }
        wg.Wait()
    }
    return nil
}
```

Make warming a *best-effort* operation — never block startup on it. Limit concurrency so the warm-up itself does not stampede the database.

## Sharing a cache between instances: the limits

Two pods cannot share an in-process cache. Each has its own. Consequences:

- **Total cache memory = N × per-pod capacity.** A 10-pod deployment with 1 GB caches each uses 10 GB total.
- **Each pod has independent eviction.** The same key can be hot in pod A and cold in pod B.
- **Invalidation is per-pod.** A `Remove` on one pod does not affect others.

For a *truly* shared cache, use Redis or Memcached. The trade-off is network latency (1 ms vs sub-microsecond) and a new dependency. Most services use both: a per-pod LRU (L2) in front of a shared Redis (L3).

## A complete sharded LRU with TTL, metrics, and singleflight

Putting it all together — the cache you would actually ship:

```go
package shardedcache

import (
    "context"
    "errors"
    "hash/maphash"
    "sync/atomic"
    "time"

    lru "github.com/hashicorp/golang-lru/v2"
    "golang.org/x/sync/singleflight"
)

type Loader[K comparable, V any] func(ctx context.Context, k K) (V, error)

type Cache[K ~string, V any] struct {
    shards    []*shard[K, V]
    shardMask uint64
    seed      maphash.Seed
    ttl       time.Duration
    loader    Loader[K, V]

    hits      atomic.Uint64
    misses    atomic.Uint64
    loadFails atomic.Uint64
    evictions atomic.Uint64
}

type entryWithTTL[V any] struct {
    val       V
    expireAt  time.Time
}

type shard[K ~string, V any] struct {
    inner *lru.Cache[K, entryWithTTL[V]]
    sf    singleflight.Group
    _pad  [40]byte
}

func New[K ~string, V any](
    totalCapacity int,
    numShards int,
    ttl time.Duration,
    loader Loader[K, V],
) (*Cache[K, V], error) {
    if numShards&(numShards-1) != 0 || numShards == 0 {
        return nil, errors.New("numShards must be a power of two")
    }
    perShard := (totalCapacity + numShards - 1) / numShards
    c := &Cache[K, V]{
        shards:    make([]*shard[K, V], numShards),
        shardMask: uint64(numShards) - 1,
        seed:      maphash.MakeSeed(),
        ttl:       ttl,
        loader:    loader,
    }
    for i := range c.shards {
        inner, err := lru.NewWithEvict[K, entryWithTTL[V]](perShard, func(K, entryWithTTL[V]) {
            c.evictions.Add(1)
        })
        if err != nil {
            return nil, err
        }
        c.shards[i] = &shard[K, V]{inner: inner}
    }
    return c, nil
}

func (c *Cache[K, V]) pick(k K) *shard[K, V] {
    var h maphash.Hash
    h.SetSeed(c.seed)
    h.WriteString(string(k))
    return c.shards[h.Sum64()&c.shardMask]
}

func (c *Cache[K, V]) Get(ctx context.Context, k K) (V, error) {
    s := c.pick(k)
    if e, ok := s.inner.Get(k); ok && time.Now().Before(e.expireAt) {
        c.hits.Add(1)
        return e.val, nil
    }
    c.misses.Add(1)
    v, err, _ := s.sf.Do(string(k), func() (interface{}, error) {
        loaded, err := c.loader(ctx, k)
        if err != nil {
            c.loadFails.Add(1)
            return nil, err
        }
        s.inner.Add(k, entryWithTTL[V]{val: loaded, expireAt: time.Now().Add(c.ttl)})
        return loaded, nil
    })
    if err != nil {
        var zero V
        return zero, err
    }
    return v.(V), nil
}

func (c *Cache[K, V]) Invalidate(k K) {
    c.pick(k).inner.Remove(k)
}

type Stats struct {
    Hits, Misses, LoadFails, Evictions uint64
}

func (c *Cache[K, V]) Stats() Stats {
    return Stats{
        Hits:      c.hits.Load(),
        Misses:    c.misses.Load(),
        LoadFails: c.loadFails.Load(),
        Evictions: c.evictions.Load(),
    }
}
```

This single file is the cache 95% of services should ship. Everything else is variations on this theme.

## When the cache itself becomes a bottleneck

Symptoms:

- `pprof` shows >20% of CPU in `lru.(*Cache).Get` or `lru.(*Cache).Add`.
- Mutex profile shows `runtime.lock2` near the cache.
- Per-op latency increases with traffic, then plateaus.

Things to try, in order:

1. **Increase shards** (1 → 16 → 64). Usually solves it.
2. **Switch to ristretto** if the workload has skew (a few hot keys dominate). TinyLFU handles skew internally.
3. **Move computation outside the lock**. Many caches embed expensive logic (deserialisation, validation) inside Get. Pull it out.
4. **Move to an L1/L2 hierarchy**. A per-goroutine cache absorbs the truly hot keys.
5. **Reconsider the cache itself**. If the underlying load is fast (already cached at a higher layer), the cache adds overhead without benefit.

## Concurrency patterns specific to LRU

### Pattern: prefetch ahead

When you load entry K, also load K+1 if you predict it will be needed soon:

```go
func (c *Cache) Get(ctx context.Context, k string) (*Item, error) {
    item, err := c.getOrLoad(ctx, k)
    if err != nil {
        return nil, err
    }
    if next := predict(k); next != "" {
        go c.warmAsync(ctx, next)
    }
    return item, nil
}

func (c *Cache) warmAsync(ctx context.Context, k string) {
    if c.Contains(k) {
        return // already cached; skip
    }
    _, _ = c.getOrLoad(context.Background(), k)
}
```

Useful when access patterns are predictable (sequential pagination, related resources).

### Pattern: cold path takes the slow lock; hot path takes the fast path

```go
func (c *Cache) Get(k string) (*User, bool) {
    // fast path: read-only lookup; no allocation
    if u, ok := c.fastPath(k); ok {
        return u, true
    }
    // slow path: must populate; full lock + load
    return c.slowPath(k)
}
```

The fast path becomes a hand-rolled lock-free check (atomic load of a generation counter, atomic load of a map pointer). The slow path is the regular cache. Useful only when the hot path is genuinely >99% — otherwise the branch predictor wins anyway. See the senior file for full lock-free designs.

### Pattern: per-goroutine cache fronting a shared cache

```go
type LocalCache struct {
    local  map[string]*User // unsafe-for-concurrent-use
    shared *Cache
}

func (l *LocalCache) Get(k string) *User {
    if u, ok := l.local[k]; ok {
        return u
    }
    u, _ := l.shared.Get(context.Background(), k)
    l.local[k] = u
    return u
}
```

Each goroutine has its own `LocalCache`. No locks. Used for short-lived per-request caches. Resets on goroutine exit.

This pattern is especially useful in batch processing where one worker touches many keys repeatedly.

## How to roll out a cache change in production

Rolling out a cache change (new algorithm, new capacity, new TTL) without an incident:

1. **Implement behind a feature flag.** Old path still works.
2. **Deploy with flag off.** Verify nothing broke.
3. **Enable on 1% of traffic.** Compare metrics: hit rate, latency, error rate, memory.
4. **Run for 24 hours minimum.** Capture a full weekly cycle if possible.
5. **Promote to 10%, then 50%, then 100% over days.** Always have a rollback path.
6. **After steady state, remove the old path.** Lock in the win.

The most common rollout mistake is "I tested locally, it works" → deploy 100% → hit-rate collapses because production has a different access pattern.

## Operational concerns

### Sizing capacity for a new service

Without traffic data, start with these defaults:

- **Hot-set cache (configs, flags)**: capacity = 10x distinct entries you expect. 99%+ hit rate easily.
- **User-data cache**: capacity = active-users-per-pod × 2. e.g. 1000 active users → 2000 capacity. ~90% hit rate.
- **Per-request derivative cache**: per-request, no cap needed.
- **Computed-result cache**: capacity = top-N most-requested-results, sized to RAM budget.

After a week of traffic, tune:

- If `evictions / sec > 10% of misses / sec`, increase capacity.
- If `cache_size < 50% of capacity` for a week, decrease capacity.
- If `hit rate < 70%`, either capacity is wrong or LRU is the wrong policy.

### Tuning TTL

A short TTL trades hit-rate for freshness. A long TTL trades freshness for hit-rate. The right number depends on:

- How often the underlying data changes.
- How costly stale data is (compute? UX? security?).
- How costly a miss is (DB query? CPU compute? external API?).

A useful rule: TTL = max acceptable staleness, *not* "as long as we can get away with". Always document the chosen TTL alongside the rationale.

### Capacity changes at runtime

`Resize` works, but consider the alternatives:

- **Static config + redeploy**: simple, predictable, but slow to react.
- **Config service push**: dynamic but adds a dependency.
- **Auto-tuning based on metrics**: clever but hard to debug.

For most services, static config + redeploy is fine. Auto-tuning is the last resort.

### Cache warming on rolling deploys

Each new pod has a cold cache for the first minute. With aggressive rolling deploys, you might have 20% of pods cold at any time, and the slow path is 20% of total traffic. Mitigations:

- **Warm at startup** (load top-N keys before accepting traffic).
- **Slow rollout** (deploy one pod at a time, wait for warmup).
- **Connection-draining** (let old pods serve while new ones warm).

The right answer depends on traffic patterns and budget.

### Observability for incidents

When the on-call gets paged at 3 AM for a latency spike, the first questions are:

1. Did hit rate drop?
2. Did eviction rate spike?
3. Did cache size collapse?
4. Did the downstream get hammered?

All four metrics must be on the dashboard, with alerts. Without them, the on-call is debugging blind.

## Comparing the popular Go cache libraries

A quick survey of the libraries you will see in Go code:

### `hashicorp/golang-lru/v2`

- **Algorithm**: LRU, 2Q, ARC (and expirable variant).
- **Concurrency**: RWMutex around the core.
- **Allocations**: one per Add (entry + list element).
- **Strengths**: simple, well-tested, generic.
- **Weaknesses**: contention on the single mutex; no admission policy.
- **Use when**: default choice. 95% of services.

### `dgraph-io/ristretto`

- **Algorithm**: W-TinyLFU (LRU + frequency sketch + admission filter).
- **Concurrency**: lock-free buffered Get; sharded internal structures.
- **Allocations**: minimal; cost-based capacity.
- **Strengths**: very high throughput; scan-resistant; high hit rate.
- **Weaknesses**: complex API; counts cost in bytes not items.
- **Use when**: throughput >5M ops/sec; mixed workload with skew.

### `allegro/bigcache`

- **Algorithm**: FIFO with TTL.
- **Concurrency**: sharded; off-heap byte arena.
- **Strengths**: extremely low GC pressure; huge caches possible.
- **Weaknesses**: bytes only (you marshal); no LRU recency.
- **Use when**: cache size > 1 GB; pointer-heavy values causing GC stalls.

### `coocood/freecache`

- **Algorithm**: LRU-ish with off-heap arena.
- **Concurrency**: sharded; lock-free reads.
- **Strengths**: low GC pressure; per-entry TTL.
- **Weaknesses**: bytes only; complex internals.
- **Use when**: bigcache's limits hit; per-entry TTL needed.

### `patrickmn/go-cache`

- **Algorithm**: map with TTL; periodic janitor.
- **Concurrency**: RWMutex.
- **Strengths**: simple; pure standard library style.
- **Weaknesses**: no eviction; unbounded growth without TTL.
- **Use when**: small bounded key sets with hard TTLs.

### `karlseguin/ccache`

- **Algorithm**: LRU with concurrent linked list.
- **Concurrency**: layered locking.
- **Strengths**: high throughput; mature.
- **Weaknesses**: less widely used than golang-lru.
- **Use when**: golang-lru's mutex contention is unacceptable but ristretto is too complex.

A common picking order: golang-lru → ristretto → bigcache. Most services never go past golang-lru.

## Reading the ristretto source

When you need more performance than golang-lru, ristretto is the next stop. Worth a quick tour so you know what you are buying into.

```bash
git clone https://github.com/dgraph-io/ristretto
cd ristretto
```

Key files:

- **`cache.go`**: the main `Cache` type. Look at `Get` — note the buffered access via `getBuf` to avoid lock contention on hot paths.
- **`policy.go`**: the W-TinyLFU policy. Two structures: `lfuPolicy` (the LRU/SLRU split) and the Count-Min Sketch frequency counter.
- **`sketch.go`**: the Count-Min Sketch implementation. ~150 lines of bit-counting magic.
- **`store.go`**: the shard map. 256 shards by default.
- **`ring.go`**: the lossy buffer that propagates access events asynchronously to the policy.

The reading order:

1. `cache.go` Get and Set to see the entry point.
2. `store.go` to see sharding and per-shard storage.
3. `ring.go` to understand how Gets propagate to the policy without locking.
4. `policy.go` to see admission decisions and eviction.
5. `sketch.go` for the math of frequency estimation.

Total reading time: 2-3 hours. Worth it if you might use ristretto in anger.

## Tradeoffs summary

A condensed version of the key trade-offs:

| Decision | Cost | Benefit |
|----------|------|---------|
| Sharding | 64 bytes × N memory; lock complexity | Linear scaling under contention |
| RWMutex | Slightly higher lock overhead | Parallel Peek when many readers |
| 2Q | 2x memory; 1.5x CPU per op | Scan resistance |
| ARC | 3x memory; 2x CPU per op | Self-tuning frequency/recency |
| Expirable | One goroutine; per-entry timestamp | Time-based freshness |
| Singleflight | Extra allocation per miss | Coalesces thundering herd |
| Negative caching | Cache holds "not found" entries | Avoids hammering DB for missing keys |
| Stale-while-revalidate | More complex code | Eliminates latency spike at expiry |
| Circuit breaker | Extra dependency | Survives downstream outages |
| L1/L2 hierarchy | Two layers to invalidate | Higher overall hit rate |

Every choice has a cost. Pick the ones that pay for themselves in your workload.

## Advanced: per-key locks for the loader

`singleflight` shares a result across simultaneous loaders. Sometimes you want stronger guarantees: ensure only one loader runs *at all* for a given key, even across non-overlapping calls.

```go
type Cache struct {
    inner    *lru.Cache[string, *User]
    keyLocks sync.Map // key string → *sync.Mutex
}

func (c *Cache) keyLock(k string) *sync.Mutex {
    if l, ok := c.keyLocks.Load(k); ok {
        return l.(*sync.Mutex)
    }
    newLock := &sync.Mutex{}
    actual, _ := c.keyLocks.LoadOrStore(k, newLock)
    return actual.(*sync.Mutex)
}

func (c *Cache) Get(ctx context.Context, k string) (*User, error) {
    if u, ok := c.inner.Get(k); ok {
        return u, nil
    }
    l := c.keyLock(k)
    l.Lock()
    defer l.Unlock()
    // re-check after acquiring lock
    if u, ok := c.inner.Get(k); ok {
        return u, nil
    }
    u, err := c.loader(ctx, k)
    if err != nil {
        return nil, err
    }
    c.inner.Add(k, u)
    return u, nil
}
```

The double-check pattern: check before locking (fast path), check after locking (avoid duplicate work). Per-key locks scale to billions of distinct keys because the `sync.Map` only holds locks for keys with in-flight work.

Drawback: the lock map grows indefinitely. Periodically GC inactive locks.

For most use cases, `singleflight` is simpler and good enough. Use per-key locks only when `singleflight`'s "all callers see the same error" behaviour is wrong.

## Advanced: lock-free read for hot keys

For a small set of extremely hot keys, even shard-level locking is too expensive. A common pattern: maintain a separate atomic pointer to the value of each hot key, updated periodically by a background goroutine.

```go
type HotCache struct {
    hot map[string]*atomic.Pointer[Value]
}

func (c *HotCache) Get(k string) (*Value, bool) {
    p, ok := c.hot[k]
    if !ok {
        return nil, false
    }
    return p.Load(), true
}

// updater goroutine periodically reloads hot keys
func (c *HotCache) refreshLoop(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            for k, p := range c.hot {
                if v, err := c.loader(ctx, k); err == nil {
                    p.Store(v)
                }
            }
        }
    }
}
```

The Get is lock-free and ~5 ns. The trade is staleness up to the refresh interval. Use for keys that are read millions of times per second.

This pattern shines for things like "current exchange rate", "active feature flags", "global rate limit window" — a tiny, fixed set of values touched on every request.

## Advanced: tiered TTL

Different keys deserve different TTLs. A naive cache has one TTL for all. A tiered cache wraps each entry with its own:

```go
type tieredEntry[V any] struct {
    val      V
    expireAt time.Time
}

type TieredCache[K comparable, V any] struct {
    inner *lru.Cache[K, tieredEntry[V]]
}

func (c *TieredCache[K, V]) Add(k K, v V, ttl time.Duration) {
    c.inner.Add(k, tieredEntry[V]{val: v, expireAt: time.Now().Add(ttl)})
}

func (c *TieredCache[K, V]) Get(k K) (V, bool) {
    e, ok := c.inner.Get(k)
    if !ok || time.Now().After(e.expireAt) {
        var zero V
        return zero, false
    }
    return e.val, true
}
```

Caller decides TTL per Add:

```go
cache.Add("user:42", user, 5*time.Minute)
cache.Add("config:billing", cfg, time.Hour)
cache.Add("flag:dark-mode", flag, 30*time.Second)
```

This is more flexible than a global TTL and avoids the all-or-nothing trade-off.

## Advanced: bypass on debug header

For testing, you often want to bypass the cache on demand. A common pattern:

```go
func (s *Service) Get(ctx context.Context, id string) (*User, error) {
    if ctx.Value(BypassCacheKey{}) != nil {
        return s.loader(ctx, id)
    }
    if u, ok := s.cache.Get(id); ok {
        return u, nil
    }
    u, err := s.loader(ctx, id)
    if err != nil {
        return nil, err
    }
    s.cache.Add(id, u)
    return u, nil
}
```

In HTTP middleware:

```go
if r.Header.Get("X-Bypass-Cache") == "true" && hasInternalAuth(r) {
    ctx = context.WithValue(ctx, BypassCacheKey{}, true)
}
```

Gate it behind internal auth so external clients cannot abuse it to stampede the backend.

## Advanced: cache validation

For caches that hold derived data, a checksum can detect corruption:

```go
type entry struct {
    val      *User
    checksum uint64
}

func (c *Cache) Add(id string, u *User) {
    c.inner.Add(id, entry{val: u, checksum: hash(u)})
}

func (c *Cache) Get(id string) (*User, bool) {
    e, ok := c.inner.Get(id)
    if !ok {
        return nil, false
    }
    if hash(e.val) != e.checksum {
        // someone mutated the cached value
        c.inner.Remove(id)
        return nil, false
    }
    return e.val, true
}
```

Useful in long-running services where bugs in caller code might mutate cached values. The checksum catches it on the next read.

## Advanced: per-request cache (cache lifetime = one request)

Sometimes the cache should not outlive the request — e.g., expensive lookups during a single complex operation.

```go
type RequestCache struct {
    inner map[string]*User
}

func NewRequestCache() *RequestCache {
    return &RequestCache{inner: make(map[string]*User)}
}

func (c *RequestCache) Get(k string) (*User, bool) {
    u, ok := c.inner[k]
    return u, ok
}

func (c *RequestCache) Set(k string, u *User) {
    c.inner[k] = u
}
```

No mutex needed — a request runs in one goroutine. Attach it to the context:

```go
func WithRequestCache(ctx context.Context) context.Context {
    return context.WithValue(ctx, requestCacheKey{}, NewRequestCache())
}

func GetRequestCache(ctx context.Context) *RequestCache {
    c, _ := ctx.Value(requestCacheKey{}).(*RequestCache)
    return c
}
```

In middleware:

```go
ctx := WithRequestCache(r.Context())
next.ServeHTTP(w, r.WithContext(ctx))
```

In handlers:

```go
cache := GetRequestCache(ctx)
if u, ok := cache.Get(id); ok {
    return u
}
u, _ := s.repo.Get(id)
cache.Set(id, u)
return u
```

Request caches eliminate duplicate work within a single request — common when an N+1 query pattern hides behind a graph traversal.

## A few words on testing concurrent caches

Three test types are non-negotiable:

1. **Functional tests under `-race`** — basic Set/Get/Remove with multiple goroutines.
2. **Eviction-order tests** — verify LRU semantics with deterministic sequences.
3. **Stress tests** — N goroutines hammering for K seconds; expect Len <= capacity and no panics.

Three test types are useful but optional:

1. **Property tests** — generate random op sequences, verify invariants.
2. **Benchmarks** — to detect performance regressions in CI.
3. **Long-running soak tests** — 1+ hour run, check for memory growth.

Avoid:

1. **Tests that depend on timing.** "Sleep 100 ms then check eviction" is flaky. Use deterministic key counts.
2. **Tests that mock the cache.** Mocking defeats the purpose. Use the real implementation.
3. **Tests with no `-race`.** Concurrent code without `-race` is half-tested.

A useful trick: run your concurrent test 1000 times in a tight loop in CI. Bugs that show up only occasionally surface within 1000 iterations.

```bash
go test -race -run TestConcurrent -count 1000
```

If you cannot run 1000 iterations in CI, run them locally before merging concurrency-sensitive changes.
