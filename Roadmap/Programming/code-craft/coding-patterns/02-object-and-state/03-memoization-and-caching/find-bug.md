# Memoization & Caching — Find the Bug

> **Category:** [Object & State Patterns](../README.md) — the bugs hide in purity, keys, presence checks, concurrency, and invalidation.

12 buggy snippets across Go, Java, Python.

---

## Bug 1: Memoizing an Impure Function (Python)

```python
from functools import cache

@cache
def price_with_tax(amount):
    rate = fetch_current_tax_rate()    # BUG: external, changing state
    return amount * (1 + rate)
```

**Symptoms:** the tax rate changes, but `price_with_tax(100)` keeps returning the *old* total forever.

<details><summary>Find the bug</summary>

The function isn't pure — its output depends on `fetch_current_tax_rate()`, not just `amount`. The cache freezes the first answer.

</details>

### Fix

```python
@cache
def price_with_tax(amount, rate):      # rate is now part of the key
    return amount * (1 + rate)
```

### Lesson

Only memoize pure functions. Every input that affects the output must be an argument (and thus part of the key).

---

## Bug 2: Truthiness Instead of Presence (Python)

```python
def get(key, cache, compute):
    if cache.get(key):                 # BUG: 0 / "" / None / False look like misses
        return cache[key]
    cache[key] = compute(key)
    return cache[key]
```

**Symptoms:** keys whose cached value is falsy (`0`, `""`, `None`) are recomputed every call — no caching at all for them.

<details><summary>Find the bug</summary>

`if cache.get(key):` is false for any falsy stored value, so legitimate hits are treated as misses.

</details>

### Fix

```python
if key in cache:                       # presence, not truthiness
    return cache[key]
```

### Lesson

Always check **presence**, never truthiness. A cached `0` is still a hit.

---

## Bug 3: Recursion Bypasses the Cache (Python)

```python
cache = {}
def fib(n):
    if n in cache: return cache[n]
    result = _fib_raw(n)               # BUG: helper doesn't use the cache
    cache[n] = result
    return result

def _fib_raw(n):
    if n < 2: return n
    return _fib_raw(n - 1) + _fib_raw(n - 2)   # recurses WITHOUT memo
```

**Symptoms:** `fib(40)` is still exponential — the cache only ever stores the top-level call.

<details><summary>Find the bug</summary>

The recursion happens inside `_fib_raw`, which never touches the cache. Subproblems are recomputed every time.

</details>

### Fix

```python
@cache
def fib(n):
    if n < 2: return n
    return fib(n - 1) + fib(n - 2)     # recurse through the memoized function
```

### Lesson

The recursive call must go through the memoized entry point, or you get zero speedup.

---

## Bug 4: Unbounded Cache on User Input (Java)

```java
private static final Map<String, Result> CACHE = new HashMap<>();
Result handle(String userQuery) {
    return CACHE.computeIfAbsent(userQuery, this::compute);  // BUG: grows forever
}
```

**Symptoms:** memory climbs steadily in production; eventually OOM. Distinct user queries never get evicted.

<details><summary>Find the bug</summary>

The cache is unbounded and keyed by attacker/user-controlled input — every distinct query is stored permanently.

</details>

### Fix

```java
private static final LoadingCache<String, Result> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterAccess(Duration.ofMinutes(10))
    .build(this::compute);
```

### Lesson

Any cache keyed by unbounded input must be bounded (size, TTL, or weak refs).

---

## Bug 5: Race on a Bare Map (Go)

```go
var cache = map[int]int{}
func Fib(n int) int {
    if n < 2 { return n }
    if v, ok := cache[n]; ok { return v }
    v := Fib(n-1) + Fib(n-2)
    cache[n] = v                        // BUG: concurrent write → panic
    return v
}
```

**Symptoms:** under concurrency, `fatal error: concurrent map read and map write`.

<details><summary>Find the bug</summary>

Go maps are not safe for concurrent use. Two goroutines reading/writing simultaneously crash the process.

</details>

### Fix

```go
var (
    mu    sync.RWMutex
    cache = map[int]int{}
)
func Fib(n int) int {
    if n < 2 { return n }
    mu.RLock(); v, ok := cache[n]; mu.RUnlock()
    if ok { return v }
    v = Fib(n-1) + Fib(n-2)
    mu.Lock(); cache[n] = v; mu.Unlock()
    return v
}
```

### Lesson

Guard shared maps with a mutex (or use `sync.Map`). Run `go test -race`.

---

## Bug 6: Cache Stampede on Expiry (Go)

```go
func GetConfig() Config {
    if c, ok := cache.Get("config"); ok { return c }
    return loadFromDB()                  // BUG: 1000 concurrent misses → 1000 DB hits
}
```

**Symptoms:** when the hot key expires, a burst of concurrent requests all miss and all hammer the database at once.

<details><summary>Find the bug</summary>

Nothing collapses concurrent misses for the same key. Each goroutine independently recomputes.

</details>

### Fix

```go
var g singleflight.Group
func GetConfig() (Config, error) {
    v, err, _ := g.Do("config", func() (any, error) { return loadFromDB(), nil })
    return v.(Config), err               // one DB hit, shared by all callers
}
```

### Lesson

Collapse duplicate in-flight computations with single-flight to prevent the thundering herd.

---

## Bug 7: Mutable Cache Key (Java)

```java
Map<List<String>, Result> cache = new HashMap<>();
List<String> key = new ArrayList<>(List.of("a"));
cache.put(key, r);
key.add("b");                            // BUG: mutating a key already in the map
Result hit = cache.get(key);             // null — hashCode changed
```

**Symptoms:** entries become unreachable; `get` misses on keys you just inserted; the map leaks.

<details><summary>Find the bug</summary>

`ArrayList.hashCode()` depends on contents. Mutating the key after insertion moves its bucket; the old entry is orphaned forever.

</details>

### Fix

```java
List<String> key = List.copyOf(original);   // immutable snapshot as the key
cache.put(key, r);
```

### Lesson

Cache keys must be immutable. Use immutable collections, records, or defensive copies.

---

## Bug 8: Caching a Transient Exception (Python)

```python
results = {}
def fetch(url):
    if url in results: return results[url]
    try:
        results[url] = http_get(url)
    except TimeoutError as e:
        results[url] = e                 # BUG: caching a transient failure
    return results[url]
```

**Symptoms:** one timeout poisons the URL — every later call returns the cached exception even after the service recovers.

<details><summary>Find the bug</summary>

A transient failure is stored as the permanent answer. The cache never retries.

</details>

### Fix

```python
def fetch(url):
    if url in results: return results[url]
    value = http_get(url)                # let exceptions propagate; don't cache them
    results[url] = value
    return value
```

### Lesson

Cache successes, not transient failures. (Negative-cache *known absence* with a short TTL — never cache timeouts/5xx as permanent.)

---

## Bug 9: Stale Read After Write (Java)

```java
User getUser(int id) { return cache.get(id, this::loadUser); }

void rename(int id, String name) {
    db.updateName(id, name);             // BUG: cache not invalidated
}
```

**Symptoms:** after `rename`, `getUser` keeps returning the old name until the entry expires.

<details><summary>Find the bug</summary>

The write updates the DB but never invalidates the cached copy. The cache and the truth diverge.

</details>

### Fix

```java
void rename(int id, String name) {
    db.updateName(id, name);
    cache.invalidate(id);                // write-invalidate
}
```

### Lesson

When the cached thing reflects mutable state, every write must invalidate (or update) the cache.

---

## Bug 10: Method-Level lru_cache Leaks Instances (Python)

```python
class Service:
    @lru_cache(maxsize=None)             # BUG: keyed on self, pins every instance
    def expensive(self, x):
        return self._compute(x)
```

**Symptoms:** `Service` instances are never garbage-collected; heap grows with every short-lived service object.

<details><summary>Find the bug</summary>

`lru_cache` on a method includes `self` in the key, so the cache holds a strong reference to every instance forever.

</details>

### Fix

```python
from functools import cached_property    # per-instance, dies with the object
# or use a per-instance dict:
class Service:
    def __init__(self): self._memo = {}
    def expensive(self, x):
        if x not in self._memo:
            self._memo[x] = self._compute(x)
        return self._memo[x]
```

### Lesson

Don't put `lru_cache` on instance methods. Use a per-instance cache or a module-level function.

---

## Bug 11: Double Compute Under Lock-Free Check (Go)

```go
func (c *Cache) Get(k int) int {
    if v, ok := c.read(k); ok { return v }
    v := expensiveCompute(k)             // BUG: two goroutines both compute on cold miss
    c.write(k, v)
    return v
}
```

**Symptoms:** on a cold key under concurrency, the expensive computation runs multiple times (wasteful, sometimes incorrect if `compute` has cost limits).

<details><summary>Find the bug</summary>

The check-then-compute window isn't atomic. Multiple goroutines pass the "not present" check before any writes back.

</details>

### Fix

```go
var g singleflight.Group
func (c *Cache) Get(k int) (int, error) {
    if v, ok := c.read(k); ok { return v, nil }
    v, err, _ := g.Do(strconv.Itoa(k), func() (any, error) {
        r := expensiveCompute(k)
        c.write(k, r)
        return r, nil
    })
    return v.(int), err
}
```

### Lesson

To guarantee *single* computation per key, use single-flight or an atomic compute-if-absent — a plain check-then-act races.

---

## Bug 12: Cache Key Omits an Argument (Python)

```python
@lru_cache(maxsize=1000)
def render(template_id):                 # BUG: locale affects output but isn't a key
    return _render(template_id, get_current_locale())
```

**Symptoms:** the first locale to render a template "wins" — every locale gets that cached rendering.

<details><summary>Find the bug</summary>

`get_current_locale()` is an implicit input. The key is only `template_id`, so different locales collide on one entry.

</details>

### Fix

```python
@lru_cache(maxsize=1000)
def render(template_id, locale):         # locale is now part of the key
    return _render(template_id, locale)
```

### Lesson

Every input that changes the output must be in the key — never read hidden state inside a memoized function.

---

## Practice Tips

1. **Audit purity:** does the function read time, randomness, globals, or I/O? If so, it's not memoizable as-is.
2. **Grep for `cache.get(...)` used in a boolean context** — likely a truthiness bug.
3. **Run `go test -race`** on every concurrent cache.
4. **Test invalidation:** write, then read, and assert the new value.
5. **Test single-load:** count loader invocations under concurrent access.

---

[← Tasks](tasks.md) · [Object & State](../README.md) · **Next:** [Optimize](optimize.md)
