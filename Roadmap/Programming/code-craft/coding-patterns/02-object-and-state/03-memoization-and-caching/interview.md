# Memoization & Caching — Interview Questions

> **Category:** [Object & State Patterns](../README.md) — caching a pure computation keyed by its inputs, and everything that generalizes from it.

---

## Junior Questions (10)

### J1. What is memoization?

**Answer:** Caching a function's return value keyed by its arguments, so repeated calls with the same inputs return the stored answer instead of recomputing.

### J2. What's the shape of a memoized function?

**Answer:** Check the cache by key; on a **hit** return the stored value; on a **miss** compute, store under the key, and return.

### J3. Why must a memoized function be pure?

**Answer:** A pure function's output depends only on its inputs. An impure one (reads time, randomness, mutable state) can change between calls, so a stored answer goes stale and wrong.

### J4. What's a cache hit vs a cache miss?

**Answer:** Hit: the key is already cached, return it. Miss: the key is absent, compute and store it.

### J5. How do you memoize in Python with one line?

**Answer:** `@functools.cache` or `@functools.lru_cache(maxsize=N)` above the function.

### J6. What's the time complexity of Fibonacci with vs without memoization?

**Answer:** Without: exponential, ~O(φⁿ). With: O(n) — each `fib(k)` computed once.

### J7. What kind of arguments can be cache keys in Python?

**Answer:** Hashable, immutable ones. Lists/dicts aren't hashable; convert a list to a tuple first.

### J8. What does it cost to memoize?

**Answer:** Memory — you store every distinct result. An unbounded cache can leak memory.

### J9. What's the difference between memoization and caching in general?

**Answer:** Memoization is function-level, in-process, assumes purity, and rarely needs invalidation. General caching covers any data, may be distributed, and centers on eviction and invalidation.

### J10. When is memoization a bad idea?

**Answer:** When the function is cheap (lookup costs more than recompute), when inputs rarely repeat (all misses), or when the function isn't pure.

---

## Middle Questions (10)

### M1. What goes into a cache key?

**Answer:** Every argument that affects the output. Omit one (e.g., `currency`) and different inputs collide. Normalize args that shouldn't differentiate (case, order).

### M2. What is an eviction policy? Name a few.

**Answer:** The rule for what to drop when the cache is full. LRU (least recently used), LFU (least frequently used), FIFO, and TTL (time-based). LRU is the safe default.

### M3. When would you choose LFU over LRU?

**Answer:** When a stable hot set dominates and you don't want a burst of one-off keys (a scan) to evict the genuinely popular entries.

### M4. How do you bound a Python cache?

**Answer:** `@lru_cache(maxsize=N)`. `maxsize=None` is unbounded — fine for `fib`, dangerous for user-controlled keys.

### M5. Why is a bare Go `map` unsafe as a cache?

**Answer:** Concurrent writes to a map panic. Guard with a `sync.RWMutex` (cheap reads) or use `sync.Map` for read-mostly workloads.

### M6. What's the standard JVM caching library and why?

**Answer:** Caffeine — bounded, concurrent, with Window-TinyLFU eviction, TTL, stats, and async loading. Far better than a hand-rolled `HashMap`.

### M7. Should you cache exceptions?

**Answer:** Generally no — a transient failure shouldn't be remembered as the permanent answer. Cache only successful results; let failures retry.

### M8. What's negative caching?

**Answer:** Caching "not found" to avoid repeated expensive lookups for absent keys (e.g., missing user, DNS NXDOMAIN). Use a shorter TTL than positive entries.

### M9. Why does a method-level `lru_cache` risk a memory leak?

**Answer:** It keys on `self`, keeping the instance referenced for the cache's lifetime — the object never gets collected. Prefer module-level functions or per-instance/weak caches.

### M10. How do you know a cache is helping?

**Answer:** Measure the hit rate (`cache_info()`, Caffeine `stats()`). A low hit rate means the cache is mostly overhead.

---

## Senior Questions (10)

### S1. What is a cache stampede and how do you prevent it?

**Answer:** When a hot key expires, many concurrent requests all miss and recompute it at once, hammering the backend. Fix with **single-flight** (collapse duplicate in-flight computes into one — Go's `singleflight`), jittered/early expiration, or stale-while-revalidate.

### S2. How do you make memoization concurrency-safe without double-computing?

**Answer:** Use an atomic compute-if-absent: `ConcurrentHashMap.computeIfAbsent` (per-key), Caffeine's `LoadingCache`, or `singleflight` in Go. The cache guarantees the loader runs once per key.

### S3. Why is cache invalidation hard?

**Answer:** The cached value reflects mutable external state, so you must answer "when does this become wrong and who removes it?" across possibly many nodes, races between write and concurrent read, and no easy way to reach into every heap.

### S4. Name invalidation strategies.

**Answer:** TTL, write-through, write-invalidate (delete on write), event/CDC-driven, and versioned keys (bump a version so reads naturally miss and old entries age out via LRU).

### S5. When would you use weak or soft references in a cache?

**Answer:** Weak keys/values when the cache must not keep its keys alive (identity-keyed derived data); soft values to let the GC reclaim cache memory under pressure instead of OOMing.

### S6. Compare in-process and distributed caching.

**Answer:** In-process: nanosecond hits, per-node, lost on restart, hard to invalidate across nodes. Distributed (Redis): shared, survives restarts, network latency, has its own TTL/eviction. Multi-tier combines them but doubles the invalidation problem.

### S7. How do versioned keys help invalidation?

**Answer:** Instead of deleting `user:42`, you read under `user:42:v{version}` and bump the version on write. Stale entries simply stop being read and fall out of the LRU — no delete/read race.

### S8. What's stale-while-revalidate?

**Answer:** Serve the slightly stale cached value immediately while one background worker refreshes it (Caffeine `refreshAfterWrite`). Keeps latency low and avoids a herd on expiry.

### S9. How do you cache something keyed by an object without leaking it?

**Answer:** Use weak keys (`WeakKeyDictionary` in Python, `weakKeys()` in Caffeine) so the entry is evicted when the object is otherwise unreferenced.

### S10. Where does memoization end and a cache architecture begin?

**Answer:** The moment you add eviction, TTL, concurrency, invalidation, or distribution. Pure memoization is the trivial case (pure function, fixed inputs); a cache architecture is everything that handles change, contention, and memory.

---

## Coding Tasks (5)

### C1. Memoize Fibonacci three ways.

```python
from functools import cache
@cache
def fib(n): return n if n < 2 else fib(n-1) + fib(n-2)
```

```java
Map<Integer, Long> memo = new HashMap<>();
long fib(int n) {
    if (n < 2) return n;
    return memo.computeIfAbsent(n, k -> fib(k-1) + fib(k-2));
}
```

```go
var memo = map[int]int{}
func fib(n int) int {
    if n < 2 { return n }
    if v, ok := memo[n]; ok { return v }
    v := fib(n-1) + fib(n-2); memo[n] = v; return v
}
```

### C2. Build an O(1) LRU cache.

```python
from collections import OrderedDict
class LRU:
    def __init__(self, cap): self.cap, self.d = cap, OrderedDict()
    def get(self, k):
        if k not in self.d: return -1
        self.d.move_to_end(k); return self.d[k]
    def put(self, k, v):
        self.d[k] = v; self.d.move_to_end(k)
        if len(self.d) > self.cap: self.d.popitem(last=False)
```

### C3. Concurrency-safe memo in Go with singleflight.

```go
var g singleflight.Group
func Get(id string) (*User, error) {
    v, err, _ := g.Do(id, func() (any, error) { return fetch(id) })
    if err != nil { return nil, err }
    return v.(*User), nil
}
```

### C4. TTL cache in Java with Caffeine.

```java
Cache<String, Value> c = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(5))
    .build();
Value v = c.get(key, k -> load(k));
```

### C5. Generic memoize decorator (Python).

```python
def memoize(fn):
    cache = {}
    def wrapper(*args):
        if args not in cache:           # presence check, not truthiness
            cache[args] = fn(*args)
        return cache[args]
    return wrapper
```

---

## Trick Questions (5)

### T1. Is `if cache.get(key):` a correct hit check?

**No.** It treats a cached `0`, `""`, `None`, or `False` as a miss. Check *presence* (`key in cache`).

### T2. Does memoizing speed up `def double(x): return x*2`?

**No** — it's slower. The lookup costs more than the multiply. Cache only when compute ≫ lookup.

### T3. Can you memoize a function that takes a list?

**Not directly** in Python — lists are unhashable. Convert to a tuple, or the cache raises `TypeError`.

### T4. Will `@lru_cache` make recursive Fibonacci fast if the recursion calls a *different* (un-memoized) helper?

**No.** The recursive calls must go through the memoized entry point, or every subproblem is recomputed.

### T5. Does a TTL cache need invalidation logic?

**It is** invalidation logic — TTL *is* time-based invalidation, accepting staleness up to *T*. You've left pure memoization the moment you add it.

---

## Behavioral Questions (5)

### B1. Tell me about a cache you added in production.

**Sample:** "Pricing recomputation was 30 ms and called per request with a small set of `(plan, region)` pairs. A Caffeine cache (maxSize 5k, 10-min TTL) took it to a >95% hit rate and cut p99 latency in half."

### B2. Describe a caching bug you debugged.

**Sample:** "A method-level `@lru_cache` kept service instances alive across requests — a slow heap leak. We moved the cache to a module-level function keyed by the request's stable fields."

### B3. How did you handle invalidation?

**Sample:** "We used versioned keys: writes bumped `user:{id}:v`, so reads naturally missed and old entries aged out of the LRU — no delete/read race across nodes."

### B4. When did caching make things worse?

**Sample:** "We cached responses keyed by a millisecond timestamp — every call was a miss. We removed the cache and the added lookup latency."

### B5. How do you decide what to cache?

**Sample:** "Profile first. Cache only hot, expensive, pure-enough computations with repeating inputs. Then bound it, add stats, and watch the hit rate before and after."

---

## Tips for Answering

1. **Lead with the rule:** memoize **pure** functions; everything else is caching with invalidation.
2. **Always mention bounding** — an unbounded cache is a leak.
3. **Name the stampede** and `singleflight` for concurrency questions.
4. **Quote the hard-problem line** on invalidation, then list concrete strategies.
5. **Know the tools:** `lru_cache` (Python), Caffeine (Java), guarded map + `singleflight` (Go).

---

[← Professional](professional.md) · [Object & State](../README.md) · **Next:** [Tasks](tasks.md)
