# Proxy — Optimization Exercises

Each exercise shows a working proxy and a measurable improvement. Numbers are illustrative (`go1.22`, typical hardware); reproduce with `go test -bench`.

---

## Exercise 1: Caching proxy on a hot read path

**Before** — every read hits the backend:

```go
func (s *Store) Read(id string) (User, error) {
    return s.db.QueryUser(id) // ~2ms per call
}
```

**After** — a caching proxy with a bounded LRU:

```go
func (c *CachingStore) Read(id string) (User, error) {
    if u, ok := c.lru.Get(id); ok {
        return u, nil // ~50ns
    }
    u, err := c.real.Read(id)
    if err == nil {
        c.lru.Add(id, u)
    }
    return u, err
}
```

| Metric | Before | After (90% hit) |
|--------|--------|-----------------|
| Mean read latency | 2ms | ~0.2ms |
| Backend QPS at 10k req/s | 10,000 | 1,000 |

**Break-even:** below ~20% hit rate the lookup overhead outweighs the savings — measure your hit rate before keeping the proxy.

---

## Exercise 2: Collapse concurrent misses (singleflight)

**Before** — a cold key hit by 200 goroutines triggers 200 backend calls.

**After:**

```go
func (c *CachingStore) Read(id string) (User, error) {
    if u, ok := c.lru.Get(id); ok {
        return u, nil
    }
    v, err, _ := c.sf.Do(id, func() (any, error) {
        u, err := c.real.Read(id)
        if err == nil {
            c.lru.Add(id, u)
        }
        return u, err
    })
    return v.(User), err
}
```

| Metric | Before | After |
|--------|--------|-------|
| Backend calls for 200 concurrent misses | 200 | 1 |
| Backend peak load on cache expiry | spike | flat |

---

## Exercise 3: RWMutex → sharded cache under contention

**Before** — a single `RWMutex` around the cache map; at 64 cores the write lock and reader-counter cache line contend.

**After** — shard the cache by `hash(key) % N`:

```go
type shardedCache struct {
    shards [256]struct {
        mu sync.RWMutex
        m  map[string]User
    }
}
func (c *shardedCache) shard(key string) *...{ return &c.shards[fnv(key)%256] }
```

| Metric | Before | After |
|--------|--------|-------|
| Read throughput @ 64 goroutines | 8M ops/s | 55M ops/s |
| Lock contention (mutex profile) | high | negligible |

Each key touches only its shard, so independent keys never contend.

---

## Exercise 4: Warm a virtual proxy to remove cold-start spikes

**Before** — a lazy proxy dials the DB on the first request; that request pays ~300ms.

**After** — warm during readiness:

```go
func (s *Server) Ready() error {
    return s.lazyDB.Ping() // forces lazy init before traffic
}
```

| Metric | Before | After |
|--------|--------|-------|
| First-request latency | 300ms | normal (~2ms) |
| Cold-start error rate during deploy | spikes | flat |

The proxy stays lazy in code; you just control *when* the cost lands.

---

## Exercise 5: Avoid interface-dispatch cost on a million-call inner loop

**Before** — a logging proxy wraps a method called in a tight loop 10M times; each call pays interface dispatch + a `log` call guarded by a level check.

**After** — move the proxy to a coarser boundary (per request, not per inner-loop iteration), and gate logging with an atomic level check, not a function call.

| Metric | Before | After |
|--------|--------|-------|
| Loop wall time | 420ms | 60ms |
| Allocations (log formatting) | 10M | 0 (skipped) |

Lesson: proxies belong at coarse boundaries; proxying a hot inner loop multiplies indirection cost.

---

## Exercise 6: Negative caching with short TTL

**Before** — repeated lookups for a missing key hit the backend every time (cache only stores hits).

**After** — cache "not found" with a short TTL (e.g., 5s) to absorb repeated misses without serving stale negatives long.

| Metric | Before | After |
|--------|--------|-------|
| Backend calls for a hot missing key | every request | 1 per 5s |

Be deliberate: negative caching trades a small staleness window for backend protection.

---

## Measurement checklist
- [ ] Measure hit rate before keeping a caching proxy (break-even ~20%).
- [ ] Add singleflight where concurrent misses are possible.
- [ ] Shard the cache only if the mutex profile shows contention.
- [ ] Warm lazy proxies if first-call latency matters.
- [ ] Keep proxies at coarse boundaries, not hot inner loops.
- [ ] Bound the cache and expose size/hit-rate metrics.
