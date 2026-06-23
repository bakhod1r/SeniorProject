# Memoization & Caching — Practice Tasks

> **Category:** [Object & State Patterns](../README.md) — hands-on drills for keying, bounding, concurrency, and invalidation.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: Memoize Fibonacci](#task-1-memoize-fibonacci)
2. [Task 2: Generic Memoize Wrapper](#task-2-generic-memoize-wrapper)
3. [Task 3: Build an O(1) LRU Cache](#task-3-build-an-o1-lru-cache)
4. [Task 4: Multi-Argument Cache Key](#task-4-multi-argument-cache-key)
5. [Task 5: TTL Cache](#task-5-ttl-cache)
6. [Task 6: Concurrency-Safe Memoization](#task-6-concurrency-safe-memoization)
7. [Task 7: Single-Flight Against Stampede](#task-7-single-flight-against-stampede)
8. [Task 8: Negative Caching](#task-8-negative-caching)
9. [Task 9: Weak-Keyed Per-Object Cache](#task-9-weak-keyed-per-object-cache)
10. [Task 10: Cache Stats and Hit Rate](#task-10-cache-stats-and-hit-rate)

---

## Task 1: Memoize Fibonacci

**Goal:** turn exponential recursion into linear.

### Python

```python
from functools import cache

@cache
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

### Java

```java
private final Map<Integer, Long> memo = new HashMap<>();
long fib(int n) {
    if (n < 2) return n;
    return memo.computeIfAbsent(n, k -> fib(k - 1) + fib(k - 2));
}
```

### Go

```go
var memo = map[int]int{}
func Fib(n int) int {
    if n < 2 { return n }
    if v, ok := memo[n]; ok { return v }
    v := Fib(n-1) + Fib(n-2)
    memo[n] = v
    return v
}
```

---

## Task 2: Generic Memoize Wrapper

**Goal:** wrap any single-argument pure function.

### Python

```python
def memoize(fn):
    cache = {}
    def wrapper(*args):
        if args not in cache:        # presence check, not truthiness
            cache[args] = fn(*args)
        return cache[args]
    wrapper.cache = cache
    return wrapper
```

### Java

```java
static <K, V> Function<K, V> memoize(Function<K, V> fn) {
    Map<K, V> cache = new ConcurrentHashMap<>();
    return k -> cache.computeIfAbsent(k, fn);
}
```

### Go (generics)

```go
func Memoize[K comparable, V any](fn func(K) V) func(K) V {
    cache := map[K]V{}
    return func(k K) V {
        if v, ok := cache[k]; ok { return v }
        v := fn(k)
        cache[k] = v
        return v
    }
}
```

---

## Task 3: Build an O(1) LRU Cache

**Goal:** `get`/`put` in O(1) with eviction of the least-recently-used entry.

### Python

```python
from collections import OrderedDict

class LRU:
    def __init__(self, cap: int):
        self.cap, self.d = cap, OrderedDict()
    def get(self, k):
        if k not in self.d: return -1
        self.d.move_to_end(k)
        return self.d[k]
    def put(self, k, v):
        self.d[k] = v
        self.d.move_to_end(k)
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
```

### Java

```java
class LRU<K, V> extends LinkedHashMap<K, V> {
    private final int cap;
    LRU(int cap) { super(16, 0.75f, true); this.cap = cap; } // accessOrder=true
    @Override protected boolean removeEldestEntry(Map.Entry<K, V> e) {
        return size() > cap;
    }
}
```

### Go

```go
import "container/list"

type LRU struct {
    cap int
    ll  *list.List
    m   map[int]*list.Element
}
type pair struct{ k, v int }

func NewLRU(cap int) *LRU { return &LRU{cap, list.New(), map[int]*list.Element{}} }
func (c *LRU) Get(k int) (int, bool) {
    if e, ok := c.m[k]; ok { c.ll.MoveToFront(e); return e.Value.(*pair).v, true }
    return 0, false
}
func (c *LRU) Put(k, v int) {
    if e, ok := c.m[k]; ok { e.Value.(*pair).v = v; c.ll.MoveToFront(e); return }
    c.m[k] = c.ll.PushFront(&pair{k, v})
    if c.ll.Len() > c.cap {
        back := c.ll.Back()
        c.ll.Remove(back); delete(c.m, back.Value.(*pair).k)
    }
}
```

---

## Task 4: Multi-Argument Cache Key

**Goal:** key on *all* inputs, normalized.

### Python

```python
@cache
def price(product_id: int, currency: str) -> float:
    return _lookup(product_id, currency.upper())   # normalize before caching? key it explicitly:

# Better: normalize at the boundary so equal-meaning calls share a key
def price_norm(product_id, currency):
    return _price(product_id, currency.upper())
@cache
def _price(product_id, currency): ...
```

### Go

```go
type key struct{ product int; currency string }
var cache = map[key]float64{}
func Price(product int, currency string) float64 {
    k := key{product, strings.ToUpper(currency)}
    if v, ok := cache[k]; ok { return v }
    v := lookup(k.product, k.currency); cache[k] = v; return v
}
```

### Java

```java
record Key(int product, String currency) {}
Map<Key, Double> cache = new ConcurrentHashMap<>();
double price(int product, String currency) {
    return cache.computeIfAbsent(new Key(product, currency.toUpperCase()),
        k -> lookup(k.product(), k.currency()));
}
```

---

## Task 5: TTL Cache

**Goal:** entries expire after a fixed lifetime.

### Java (Caffeine)

```java
Cache<String, Value> c = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(5))
    .build();
Value v = c.get(key, k -> load(k));
```

### Python

```python
import time
class TTLCache:
    def __init__(self, ttl): self.ttl, self.d = ttl, {}
    def get_or(self, k, compute):
        now = time.monotonic()
        if k in self.d and now - self.d[k][0] < self.ttl:
            return self.d[k][1]
        v = compute(); self.d[k] = (now, v); return v
```

### Go

```go
type entry struct{ t time.Time; v int }
type TTL struct{ ttl time.Duration; m map[string]entry }
func (c *TTL) GetOr(k string, compute func() int) int {
    if e, ok := c.m[k]; ok && time.Since(e.t) < c.ttl { return e.v }
    v := compute(); c.m[k] = entry{time.Now(), v}; return v
}
```

---

## Task 6: Concurrency-Safe Memoization

**Goal:** safe under concurrent access.

### Go

```go
type Cache struct {
    mu sync.RWMutex
    m  map[int]int
}
func (c *Cache) Get(k int, compute func(int) int) int {
    c.mu.RLock(); v, ok := c.m[k]; c.mu.RUnlock()
    if ok { return v }
    v = compute(k)
    c.mu.Lock(); c.m[k] = v; c.mu.Unlock()
    return v
}
```

### Java

```java
ConcurrentHashMap<Integer, Long> cache = new ConcurrentHashMap<>();
long get(int k) { return cache.computeIfAbsent(k, this::compute); } // atomic per key
```

### Python

```python
import threading
class SafeMemo:
    def __init__(self, fn): self.fn, self.d, self.lock = fn, {}, threading.Lock()
    def __call__(self, k):
        with self.lock:
            if k in self.d: return self.d[k]
        v = self.fn(k)                  # compute outside the lock
        with self.lock: self.d[k] = v
        return v
```

---

## Task 7: Single-Flight Against Stampede

**Goal:** collapse concurrent misses for the same key into one computation.

### Go

```go
import "golang.org/x/sync/singleflight"
var g singleflight.Group
func GetUser(id string) (*User, error) {
    v, err, _ := g.Do(id, func() (any, error) { return fetchUser(id) })
    if err != nil { return nil, err }
    return v.(*User), nil
}
```

### Java (Caffeine guarantees single load per key)

```java
LoadingCache<String, User> c = Caffeine.newBuilder()
    .maximumSize(10_000)
    .build(id -> fetchUser(id));   // one load per key even under concurrency
User u = c.get(id);
```

### Python (in-flight coalescing)

```python
import threading
class SingleFlight:
    def __init__(self): self.lock = threading.Lock(); self.inflight = {}
    def do(self, key, fn):
        with self.lock:
            ev = self.inflight.get(key)
            if ev is None:
                ev = self.inflight[key] = {"event": threading.Event(), "val": None}
                leader = True
            else:
                leader = False
        if not leader:
            ev["event"].wait(); return ev["val"]
        ev["val"] = fn()
        ev["event"].set()
        with self.lock: del self.inflight[key]
        return ev["val"]
```

---

## Task 8: Negative Caching

**Goal:** cache "not found" with a shorter TTL than positive entries.

### Python

```python
MISS = object()                       # distinct sentinel, never a real value
def get_user(uid, cache, ttl_hit=300, ttl_miss=30):
    now = time.monotonic()
    if uid in cache and now - cache[uid][0] < cache[uid][2]:
        val = cache[uid][1]
        return None if val is MISS else val
    user = db_lookup(uid)             # may be None
    if user is None:
        cache[uid] = (now, MISS, ttl_miss)
        return None
    cache[uid] = (now, user, ttl_hit)
    return user
```

### Go

```go
// Store a tri-state: present-hit, present-miss, absent.
type slot struct{ user *User; found bool; exp time.Time }
func Get(id string) *User {
    if s, ok := cache[id]; ok && time.Now().Before(s.exp) {
        return s.user // nil if negatively cached
    }
    u := db(id)
    ttl := 5 * time.Minute
    if u == nil { ttl = 30 * time.Second } // shorter for misses
    cache[id] = slot{u, u != nil, time.Now().Add(ttl)}
    return u
}
```

---

## Task 9: Weak-Keyed Per-Object Cache

**Goal:** cache derived data without keeping the source object alive.

### Python

```python
import weakref
_derived: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
def expensive_view(obj):
    if obj not in _derived:
        _derived[obj] = compute_view(obj)   # obj can still be GC'd later
    return _derived[obj]
```

### Java (Caffeine)

```java
Cache<Node, View> cache = Caffeine.newBuilder()
    .weakKeys()          // entry evicted when the Node is otherwise unreferenced
    .build();
View v = cache.get(node, Node::computeView);
```

---

## Task 10: Cache Stats and Hit Rate

**Goal:** measure whether the cache earns its keep.

### Python

```python
f = lru_cache(maxsize=1000)(expensive)
# ... run workload ...
info = f.cache_info()
hit_rate = info.hits / (info.hits + info.misses) if (info.hits + info.misses) else 0.0
print(f"hit rate: {hit_rate:.1%}, size: {info.currsize}/{info.maxsize}")
```

### Java (Caffeine)

```java
Cache<K, V> c = Caffeine.newBuilder().maximumSize(N).recordStats().build();
// ... run workload ...
CacheStats s = c.stats();
System.out.printf("hit rate: %.1f%%, evictions: %d%n", s.hitRate() * 100, s.evictionCount());
```

### Go (manual counters)

```go
type Stats struct{ hits, misses atomic.Int64 }
func (c *Cache) Get(k int) (int, bool) {
    if v, ok := c.m[k]; ok { c.stats.hits.Add(1); return v, true }
    c.stats.misses.Add(1); return 0, false
}
```

---

## Practice Tips

1. **Always presence-check** (`k in cache`), never truthiness — cached `0`/`None`/`""` are valid hits.
2. **Bound every cache** and verify eviction works under load.
3. **Run `go test -race`** on every concurrent cache.
4. **Assert single-load** under concurrency (count loader invocations).
5. **Print the hit rate** — a cache with no hits is a bug, not an optimization.

---

[← Interview](interview.md) · [Object & State](../README.md) · **Next:** [Find-Bug](find-bug.md)
