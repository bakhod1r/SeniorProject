---
layout: default
title: Find Bug
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/find-bug/
---

# Concurrent LRU — Find the Bug

> Each snippet contains a real concurrency or correctness bug in a concurrent LRU. Find it, explain it, fix it.

---

## Bug 1 — Forgotten map delete on eviction

```go
func (c *LRU[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.order.Len() >= c.capacity {
        back := c.order.Back()
        c.order.Remove(back) // evict from list
        // BUG
    }
    ent := &entry[K, V]{k, v}
    c.items[k] = c.order.PushFront(ent)
}
```

**Bug.** The list removes the back element, but the map still contains its key. The map grows unbounded; future Gets for the "evicted" key return a stale `*list.Element` pointing to a freed node.

**Fix.** Extract the key from the back element before removing, then delete from the map:

```go
back := c.order.Back()
kv := c.order.Remove(back).(*entry[K, V])
delete(c.items, kv.key)
```

---

## Bug 2 — `Get` without lock

```go
func (c *LRU[K, V]) Get(k K) (V, bool) {
    if e, ok := c.items[k]; ok {
        c.mu.Lock()
        c.order.MoveToFront(e)
        c.mu.Unlock()
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}
```

**Bug.** The map read `c.items[k]` is unsynchronized. Concurrent Set may resize the map while this Get reads it, causing a crash or wrong result. Go maps are not safe for concurrent read-and-write.

**Fix.** Take the lock before any map access:

```go
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
```

---

## Bug 3 — Eviction callback re-entering the cache

```go
cache, _ := lru.NewWithEvict[string, *Conn](128, func(k string, v *Conn) {
    cache.Add(k+":closed", v) // callback writes back to cache
})
```

**Bug.** The callback runs under the cache's lock. Calling `cache.Add` deadlocks because the lock is not reentrant.

**Fix.** Push work to a separate goroutine:

```go
cache, _ := lru.NewWithEvict[string, *Conn](128, func(k string, v *Conn) {
    go func() { cache.Add(k+":closed", v) }()
})
```

Or, more typically, perform a non-cache action in the callback (close a file, decrement a refcount).

---

## Bug 4 — RWMutex for Get

```go
type LRU[K comparable, V any] struct {
    mu    sync.RWMutex
    items map[K]*list.Element
    order *list.List
    // ...
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e) // RACE: list mutation under RLock
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}
```

**Bug.** `MoveToFront` mutates the list. Multiple goroutines holding RLock simultaneously will race on the list pointers. Eventually the list corrupts (cycles, nil dereferences).

**Fix.** Either use `sync.Mutex`, or split into `Get` (Lock) and `Peek` (RLock):

```go
func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    // ...
}

func (c *LRU[K, V]) Peek(k K) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    // ... no MoveToFront
}
```

---

## Bug 5 — `Len` lock-free under contention

```go
func (c *LRU[K, V]) Len() int {
    return c.order.Len() // no lock
}
```

**Bug.** `list.List.Len` reads internal state. Without synchronization, this races with concurrent Set/Remove operations modifying the list.

**Fix.**

```go
func (c *LRU[K, V]) Len() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.order.Len()
}
```

---

## Bug 6 — Non-power-of-two shards with bitmask

```go
type ShardedLRU struct {
    shards [10]*lru.Cache[string, int] // 10 shards
}

func (c *ShardedLRU) pick(k string) *lru.Cache[string, int] {
    h := hash(k)
    return c.shards[h & 9] // mask of (10-1) = 9
}
```

**Bug.** `& 9` is `& 0b1001`. Indexes 2, 3, 4, 5, 6, 7 never appear (those bits are unset in 9). Only shards 0, 1, 8, 9 receive any keys.

**Fix.** Use a power-of-two shard count (16, 32, 64). Then the mask `N-1` is all ones.

```go
type ShardedLRU struct {
    shards [16]*lru.Cache[string, int]
}
```

---

## Bug 7 — Capturing loop variable in goroutine

```go
func StartWorkers(items []string) {
    cache, _ := lru.New[string, int](1024)
    for i, item := range items {
        go func() {
            cache.Add(item, i) // captures item and i by reference
        }()
    }
}
```

**Bug.** Pre-Go 1.22, all goroutines share the same `item` and `i`. They see the final values, not their per-iteration values.

**Fix.** Pass as parameters:

```go
go func(item string, i int) {
    cache.Add(item, i)
}(item, i)
```

On Go 1.22+, the for-range scoping fix makes this work, but explicit is still clearer.

---

## Bug 8 — Eviction callback panics

```go
cache, _ := lru.NewWithEvict[string, *File](128, func(k string, f *File) {
    f.Close() // panics if f is nil
})
```

**Bug.** If the value is nil (e.g., the cache was given `cache.Add(k, nil)`), the callback panics. The panic happens under the cache's lock; the cache may be left in an inconsistent state.

**Fix.** Nil-check in the callback:

```go
func(k string, f *File) {
    if f != nil {
        f.Close()
    }
}
```

Or panic-recover in the callback to prevent crashing the cache.

---

## Bug 9 — Race between `Peek` and `Add`

```go
func GetOrAdd[K comparable, V any](c *lru.Cache[K, V], k K, v V) V {
    if cur, ok := c.Peek(k); ok {
        return cur
    }
    c.Add(k, v)
    return v
}
```

**Bug.** Between Peek and Add, another goroutine may insert a different value for `k`. Two callers may both Peek (miss), both Add. The second Add overwrites the first.

**Fix.** Use `PeekOrAdd`, which is atomic:

```go
func GetOrAdd[K comparable, V any](c *lru.Cache[K, V], k K, v V) V {
    prev, ok, _ := c.PeekOrAdd(k, v)
    if ok {
        return prev
    }
    return v
}
```

---

## Bug 10 — Cache key includes timestamp

```go
func (s *Service) Get(ctx context.Context, userID string) (*User, error) {
    key := userID + ":" + time.Now().Format(time.RFC3339)
    if u, ok := s.cache.Get(key); ok {
        return u, nil
    }
    // ...
}
```

**Bug.** Every call generates a new key (timestamp varies). The cache always misses; every request goes to the loader. The cache is pure overhead.

**Fix.** Use a stable key:

```go
key := userID
```

If you need time-bucketed caching, round the timestamp to the bucket:

```go
bucket := time.Now().Truncate(time.Minute).Format(time.RFC3339)
key := userID + ":" + bucket
```

---

## Bug 11 — Sharding by first character

```go
func (c *Cache) pick(k string) *shard {
    return c.shards[int(k[0])%len(c.shards)]
}
```

**Bug.** Bias toward the most common first character. For user-prefix keys like "user:", all keys hit the same shard.

**Fix.** Use a hash function:

```go
func (c *Cache) pick(k string) *shard {
    var h maphash.Hash
    h.SetSeed(c.seed)
    h.WriteString(k)
    return c.shards[h.Sum64()&c.shardMask]
}
```

---

## Bug 12 — Writing to the cached value

```go
u, _ := cache.Get(id)
u.LastSeen = time.Now() // mutates cached value
```

**Bug.** Another goroutine reading the same `u` sees the modified value. Worse, if `u` is being marshalled to JSON elsewhere, the mutation may corrupt the output.

**Fix.** Treat cached values as immutable. To "update", create a new value and re-cache:

```go
u, _ := cache.Get(id)
u2 := *u // copy
u2.LastSeen = time.Now()
cache.Add(id, &u2)
```

---

## Bug 13 — Cache size pinned at 0

```go
cache, err := lru.New[string, int](capacity)
if err != nil {
    log.Printf("cache disabled: %v", err)
    cache = &lru.Cache[string, int]{} // zero value
}
```

**Bug.** The zero-valued Cache is unusable. Subsequent calls panic with nil pointer dereference.

**Fix.** Either error out or use a no-op cache:

```go
if err != nil {
    return nil, err
}
```

Or define a no-op cache type implementing the interface:

```go
type noopCache struct{}
func (n *noopCache) Get(k string) (int, bool) { return 0, false }
func (n *noopCache) Add(k string, v int) {}
```

---

## Bug 14 — TTL check after Get promotes

```go
func (c *TTLCache) Get(k string) (string, bool) {
    e, ok := c.inner.Get(k) // promotes recency
    if !ok {
        return "", false
    }
    if time.Now().After(e.expireAt) {
        return "", false // returns miss, but recency was already updated
    }
    return e.val, true
}
```

**Bug.** Get promotes the entry to MRU. Then the TTL check fails. The cache now contains an expired entry at the MRU position — it will live longest before evicting.

**Fix.** Use `Peek` for the TTL check:

```go
e, ok := c.inner.Peek(k)
if !ok || time.Now().After(e.expireAt) {
    c.inner.Remove(k)
    return "", false
}
c.inner.Get(k) // now promote
return e.val, true
```

Or store TTL outside the cache and remove on expiry.

---

## Bug 15 — Long callback under lock

```go
cache, _ := lru.NewWithEvict[string, *Result](128, func(k string, r *Result) {
    if err := publishToKafka(r); err != nil {
        log.Printf("kafka publish failed: %v", err)
    }
})
```

**Bug.** Kafka publish can take 50-500 ms. The callback runs under the cache's lock, blocking all other operations on the cache for that duration.

**Fix.** Send to a buffered channel; a worker goroutine publishes:

```go
ch := make(chan *Result, 1000)
go func() {
    for r := range ch {
        publishToKafka(r)
    }
}()
cache, _ := lru.NewWithEvict[string, *Result](128, func(k string, r *Result) {
    select {
    case ch <- r:
    default:
        // queue full; drop or log
    }
})
```

---

## Bug 16 — Two caches sharing one mutex

```go
type Service struct {
    mu       sync.Mutex
    users    *lru.Cache[string, *User]
    sessions *lru.Cache[string, *Session]
}

func (s *Service) GetUser(id string) *User {
    s.mu.Lock()
    defer s.mu.Unlock()
    if u, ok := s.users.Get(id); ok { return u }
    // ...
}
```

**Bug.** Each cache has its own internal mutex. Wrapping them with `s.mu` adds a useless second lock and unrelated caches serialize against each other.

**Fix.** Remove `s.mu`:

```go
func (s *Service) GetUser(id string) *User {
    if u, ok := s.users.Get(id); ok { return u }
    // ...
}
```

---

## Bug 17 — Reading `cache.Keys()` while iterating

```go
func (s *Service) DumpCache() {
    keys := s.cache.Keys()
    for _, k := range keys {
        v, _ := s.cache.Get(k) // promotes, may evict another
        log.Printf("%s = %v", k, v)
    }
}
```

**Bug.** Each Get promotes the key, which may evict another key. By the time you iterate over `keys`, some keys are no longer in the cache.

**Fix.** Use `Peek` to avoid mutating recency:

```go
for _, k := range keys {
    v, _ := s.cache.Peek(k)
    // ...
}
```

---

## Bug 18 — Sharing context across loaders

```go
func (s *Service) Load(ctx context.Context, k string) (*Value, error) {
    s.ctx = ctx // store for use by singleflight
    v, err, _ := s.sf.Do(k, s.loadOne)
    return v.(*Value), err
}

func (s *Service) loadOne() (interface{}, error) {
    return s.fetch(s.ctx, ...) // uses the stored ctx
}
```

**Bug.** Multiple goroutines store their `ctx` into `s.ctx`. The last writer wins; the loader uses a context that may not match the caller. If one caller's context is cancelled, the loader may abort, breaking other callers.

**Fix.** Use the appropriate context for the loader; do not store across calls:

```go
v, err, _ := s.sf.Do(k, func() (interface{}, error) {
    return s.fetch(context.Background(), ...) // long-lived ctx
})
```

Or use `singleflight.DoChan` and select on multiple contexts.

---

## Bug 19 — Forgotten error when loading

```go
v, _ := loader()
cache.Add(key, v) // ignored error; cached possibly invalid value
```

**Bug.** If `loader` failed, `v` is the zero value (often nil). The cache now holds nil; future Gets return `(nil, true)`. Callers think they got a value when they didn't.

**Fix.**

```go
v, err := loader()
if err != nil {
    return nil, err
}
cache.Add(key, v)
```

---

## Bug 20 — Eviction policy assumption in callback

```go
cache, _ := lru.NewWithEvict[string, int](100, func(k string, v int) {
    if v > 1000 {
        log.Printf("evicted important value: %s = %d", k, v)
    }
})
```

**Bug.** The callback runs for *every* eviction, not just specific ones. Under high load, it logs continuously; the log itself becomes a bottleneck.

**Fix.** Log at a sample rate, or move the value-check to where the value is added:

```go
var evicts atomic.Uint64
cache, _ := lru.NewWithEvict[string, int](100, func(_ string, _ int) {
    evicts.Add(1)
})
```

---

## Bug 21 — Map iteration order assumption

```go
func (c *MyCache) FindLRU() (string, int) {
    for k, e := range c.items { // iteration order is random
        if isOldest(e) {
            return k, e.val
        }
    }
    return "", 0
}
```

**Bug.** Go map iteration order is random. The loop returns *some* "oldest" entry but not necessarily *the* oldest one across calls.

**Fix.** Use the linked list to find the LRU end:

```go
back := c.order.Back()
if back != nil {
    ent := back.Value.(*entry[K, V])
    return ent.key, ent.val
}
```

---

## Bug 22 — `singleflight.Forget` race

```go
v, err, _ := sf.Do(key, loadFn)
sf.Forget(key) // always forget
```

**Bug.** `Forget` removes the key from the in-flight set. But if another goroutine is *currently* in `Do` for the same key and the loader is still running, that goroutine still gets the result. If you then start a new `Do` for the same key, you create a duplicate concurrent load.

**Fix.** Only `Forget` on error:

```go
v, err, _ := sf.Do(key, func() (interface{}, error) {
    v, err := loader()
    if err != nil {
        sf.Forget(key) // allow retry
        return nil, err
    }
    return v, nil
})
```

---

## Bug 23 — Comparing pointers to entries

```go
e1, _ := cache.GetOldest()
// ... some operations ...
e2, _ := cache.GetOldest()
if e1 == e2 { // bug?
    // both calls returned the same entry
}
```

**Bug.** `GetOldest` returns the value, not a pointer to the cache's entry. The comparison is on the values; for non-pointer types it's comparing values; for pointer types, two distinct calls may return the same key but different `*list.Element` pointers (depending on internal reuse).

**Fix.** Compare keys:

```go
k1, _, _ := cache.GetOldest()
k2, _, _ := cache.GetOldest()
if k1 == k2 { ... }
```

---

## Bug 24 — Sharded cache without seed

```go
type ShardedLRU struct {
    shards []*lru.Cache[string, int]
}

func (c *ShardedLRU) pick(k string) *lru.Cache[string, int] {
    return c.shards[hash(k) % len(c.shards)] // no seed
}
```

**Bug.** If `hash` is deterministic (e.g., FNV), an attacker can craft keys that all hash to the same shard, defeating sharding.

**Fix.** Use `maphash` with a random seed:

```go
type ShardedLRU struct {
    shards []*lru.Cache[string, int]
    seed   maphash.Seed
}

func (c *ShardedLRU) pick(k string) *lru.Cache[string, int] {
    var h maphash.Hash
    h.SetSeed(c.seed)
    h.WriteString(k)
    return c.shards[h.Sum64() & uint64(len(c.shards)-1)]
}
```

---

## Bug 25 — Resize during eviction storm

```go
cache.Resize(newCap) // newCap < Len; evicts surplus
```

**Bug.** If `Len` is 1M and `newCap` is 1K, `Resize` evicts 999K entries while holding the lock. The cache is unavailable for the duration.

**Fix.** Resize incrementally:

```go
for cache.Len() > newCap {
    cache.RemoveOldest()
    if cache.Len() > newCap {
        runtime.Gosched() // yield to other goroutines
    }
}
cache.Resize(newCap) // final adjustment
```

Or schedule the resize during low traffic.

---

## Conclusion

These are real bugs encountered in production code. Many are subtle — the code looks correct on first read. Concurrency bugs in particular are hard to spot in review and harder to reproduce in tests.

Tools that help:

- `go test -race` — catches data races at runtime.
- `go vet` — catches some structural issues.
- `staticcheck` — catches common Go mistakes.
- Code review by someone who has seen concurrency bugs before.

The cost of a cache bug in production: hours of debugging, possibly customer-visible incidents, sometimes data loss. The cost of careful review: 30 minutes. Always invest in the review.
