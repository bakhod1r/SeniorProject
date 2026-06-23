# Memoization & Caching — Optimization Drills

> **Category:** [Object & State Patterns](../README.md) — make the cache faster, smaller, and safer; and know when *not* to cache.

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread, indicative numbers.

---

## Optimization 1: Memoize Overlapping Recursion

### Slow

```python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)   # exponential
```

### Optimized

```python
from functools import cache
@cache
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

### Benchmark

```
fib(35) naive       ~ 50,000,000 ns
fib(35) memoized    ~      2,000 ns      ~25,000× faster
```

The single biggest win in this topic: overlapping subproblems go from exponential to linear.

---

## Optimization 2: Don't Cache Cheap Functions

### Slow (cache is overhead)

```python
@cache
def double(x): return x * 2    # lookup costs MORE than the multiply
```

### Optimized

```python
def double(x): return x * 2    # just compute it
```

### Benchmark

```
double via lru_cache hit   ~ 90 ns
double inline              ~  5 ns      cache is 18× SLOWER
```

Cache only when **compute ≫ lookup**. A lookup is ~10–90 ns; if compute is cheaper, you've added cost.

---

## Optimization 3: Bound the Cache

### Slow / leaks

```python
@cache                          # unbounded; grows with distinct keys
def resolve(user_query): ...
```

### Optimized

```python
@lru_cache(maxsize=10_000)      # bounded; evicts LRU
def resolve(user_query): ...
```

### Tradeoff

A bound caps memory at the cost of evicting cold entries. For user-controlled keys this is mandatory — unbounded is a memory leak.

---

## Optimization 4: Copy on Build, Not on Every Touch

### Slow

```python
def cache_key(args):
    return tuple(sorted(list(args)))   # builds a new list AND a new tuple every call
```

### Optimized

```python
def cache_key(args):
    return tuple(sorted(args))         # sorted() already returns a new list; one alloc
```

Cut redundant allocations in the hot key-construction path — it runs on *every* call, hit or miss.

---

## Optimization 5: Functional Options → Direct Map in Go

### Slow / non-idiomatic concurrent cache

```go
var cache sync.Map   // fine, but type assertions on every access
func Get(k int) int {
    if v, ok := cache.Load(k); ok { return v.(int) } // interface boxing + assert
    v := compute(k); cache.Store(k, v); return v
}
```

### Optimized for read-mostly with RWMutex + typed map

```go
var (
    mu    sync.RWMutex
    cache = map[int]int{}            // no boxing, no assertions
)
func Get(k int) int {
    mu.RLock(); v, ok := cache[k]; mu.RUnlock()
    if ok { return v }
    v = compute(k)
    mu.Lock(); cache[k] = v; mu.Unlock()
    return v
}
```

### Benchmark

```
sync.Map read (boxed)        ~ 40 ns/op
RWMutex + typed map read     ~ 25 ns/op
```

`sync.Map` shines for disjoint-key-per-goroutine workloads; for shared read-mostly state, a typed map under `RWMutex` avoids boxing.

---

## Optimization 6: Kill the Stampede

### Slow

```go
func Get(id string) (*User, error) {
    if u, ok := cache.Get(id); ok { return u, nil }
    return fetchUser(id)            // every concurrent miss hits the DB
}
```

### Optimized

```go
var g singleflight.Group
func Get(id string) (*User, error) {
    if u, ok := cache.Get(id); ok { return u, nil }
    v, err, _ := g.Do(id, func() (any, error) { return fetchUser(id) })
    if err != nil { return nil, err }
    return v.(*User), nil
}
```

### Benchmark (1000 concurrent requests, cold key)

```
without singleflight    1000 backend calls
with singleflight          1 backend call
```

A single backend call instead of a thundering herd — the difference between a cache that protects the DB and one that amplifies load on it.

---

## Optimization 7: Stale-While-Revalidate Instead of Block-on-Expiry

### Slow

```java
Cache<K, V> c = Caffeine.newBuilder()
    .expireAfterWrite(Duration.ofMinutes(1))   // on expiry, callers block on reload
    .build();
```

### Optimized

```java
LoadingCache<K, V> c = Caffeine.newBuilder()
    .refreshAfterWrite(Duration.ofMinutes(1))  // ONE thread refreshes async
    .expireAfterWrite(Duration.ofMinutes(10))  // hard backstop
    .build(loader);
```

Callers get the slightly-stale value instantly while one background thread refreshes — latency stays flat across expiry boundaries, and no herd forms.

---

## Optimization 8: Coarsen the Key to Raise Hit Rate

### Slow (0% hit rate)

```python
@lru_cache(maxsize=10_000)
def quote(user_id, timestamp_ms):   # millisecond key → every call is unique
    return compute(user_id)
```

### Optimized

```python
@lru_cache(maxsize=10_000)
def quote(user_id, bucket):         # bucket = timestamp_ms // 60_000 (per-minute)
    return compute(user_id)
```

### Benchmark

```
ms-precise key      hit rate   0%   (pure overhead)
per-minute bucket   hit rate  ~98%  (large win)
```

A cache key with an effectively-infinite domain never hits. Coarsen it to the resolution that matters.

---

## Optimization 9: Tabulation Over Recursion for DP

### Slow (recursion + cache + call overhead)

```python
@cache
def edit(i, j): ...                 # deep recursion, stack frames, dict lookups
```

### Optimized (bottom-up table)

```python
def edit(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    # fill iteratively, contiguous memory, no recursion
    ...
    return dp[len(a)][len(b)]
```

### Benchmark

```
top-down memoized    ~ 1.0× (baseline)
bottom-up tabulated  ~ 1.5–3× faster, no recursion-depth limit
```

When *all* subproblems are needed, tabulation beats memoization: contiguous arrays, no hashing, no call overhead, no recursion limit. See [Dynamic Programming](../../../../../Data/datastructures-and-algorithms/13-dynamic-programming/README.md).

---

## Optimization 10: Promote a Hot Cache to a Higher Tier

### Slow (recompute on every node, every restart)

```python
@lru_cache(maxsize=10_000)          # per-process, lost on restart, not shared
def feature_flags(user_id): ...
```

### Optimized (shared, durable L2)

```python
def feature_flags(user_id):
    if (v := local.get(user_id)) is not None:   # L1: in-process
        return v
    v = redis.get(f"ff:{user_id}")              # L2: shared across the fleet
    if v is None:
        v = compute(user_id)
        redis.setex(f"ff:{user_id}", 300, v)
    local.put(user_id, v)
    return v
```

A near (L1) + far (L2) tier shares work across nodes and survives restarts — at the cost of a second invalidation surface. See [Redis caching patterns](../../../../../Backend/redis/README.md).

---

## Optimization Tips

### How to find caching bottlenecks

1. **Measure the hit rate first** (`cache_info()`, Caffeine `stats()`). Low hit rate → the cache is overhead or the key is wrong.
2. **Profile compute vs lookup.** If `compute < lookup`, remove the cache.
3. **Watch heap growth** — an unbounded cache shows up as a steady climb.
4. **Run `go test -race` / load tests** to surface stampedes and double-computes.

### Optimization checklist

- [ ] Memoize overlapping recursion (exponential → linear).
- [ ] Don't cache cheap functions.
- [ ] Bound every cache (size / TTL / weak refs).
- [ ] Build the key cheaply; no redundant allocations.
- [ ] Guard concurrency (RWMutex / ConcurrentHashMap / Caffeine).
- [ ] Single-flight to kill stampedes.
- [ ] Stale-while-revalidate over block-on-expiry.
- [ ] Coarsen high-cardinality keys to raise hit rate.
- [ ] Tabulate when all subproblems are needed.
- [ ] Promote hot caches to a shared tier when nodes must share.

### Anti-optimizations

- ❌ **Caching cheap or non-repeating computations** — pure overhead.
- ❌ **Unbounded caches on user input** — a memory leak.
- ❌ **Caching impure results** — stale, wrong answers.
- ❌ **Multi-tier caches without an invalidation plan** — two ways to be wrong.
- ❌ **Premature distribution** — Redis latency can exceed the compute you're avoiding.

---

## Summary

Caching optimizations are about **maximizing hit rate, minimizing footprint, and surviving concurrency** — not micro-tuning the data structure. The biggest wins are structural: memoize overlapping recursion, bound the cache, fix the key, and collapse stampedes. The biggest losses come from caching the wrong things: cheap functions, impure results, or non-repeating keys.

---

[← Find-Bug](find-bug.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md)

**Memoization & Caching roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Object Pool](../04-object-pool/junior.md).
