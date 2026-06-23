# sync.Map — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Workload Analysis Before Implementation](#workload-analysis-before-implementation)
3. [`singleflight` — When Load-Once Is the Goal](#singleflight--when-load-once-is-the-goal)
4. [Generic Wrappers for sync.Map](#generic-wrappers-for-syncmap)
5. [Sharded Maps Done Properly](#sharded-maps-done-properly)
6. [Comparison with `atomic.Pointer[map]`](#comparison-with-atomicpointermap)
7. [Memory Model and Happens-Before Guarantees](#memory-model-and-happens-before-guarantees)
8. [Pitfalls at Scale](#pitfalls-at-scale)
9. [Designing APIs Around `sync.Map`](#designing-apis-around-syncmap)
10. [When to Ditch the Map Entirely](#when-to-ditch-the-map-entirely)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At middle level you learned to choose between `sync.Map`, `RWMutex+map`, sharded maps, and `atomic.Pointer[map]` by measurement. At senior level you start *designing systems* around these choices: deciding the shape of your concurrency model, knowing when to pull in `singleflight` instead of `LoadOrStore`, when to build a generic wrapper, and when to retire the concurrent map idea entirely.

After this file you will:

- Analyse a workload's access pattern before reaching for a primitive.
- Use `golang.org/x/sync/singleflight` correctly for load-once semantics.
- Build a type-safe generic wrapper that compiles to the same code as a typed map.
- Implement a proper sharded concurrent map.
- Reason about memory-model implications of `sync.Map` in fan-out architectures.
- Recognise structural smells that mean "stop using a map; redesign."

---

## Workload Analysis Before Implementation

Before choosing a primitive, characterise the workload along these axes:

1. **Read/write ratio.** 1:1, 10:1, 100:1, 1000:1? This dominates the choice.
2. **Key cardinality and stability.** Does the key set change? At what rate?
3. **Value size and lifetime.** Are values cheap (ints) or expensive (parsed configs)?
4. **Contention concentration.** Are operations uniformly distributed or clustered on a few keys?
5. **Consistency requirements.** Do you need `Len`, snapshot, or ordered iteration?
6. **Latency sensitivity.** Is the 99th percentile the constraint, or throughput?
7. **Lifetime of the map.** Short-lived per-request or process-lifetime?
8. **Memory budget.** Is amplification acceptable?

For each axis, a different primitive wins. The senior skill is *running the question through all eight before writing code*.

### Worked example: rate-limiter cache

- Read/write ratio: 100:1 (token bucket consulted on every request, refilled rarely).
- Key cardinality: medium, growing (one bucket per client IP).
- Value: a small struct, cheap.
- Contention: spread across IPs; no hot key.
- Consistency: not needed; eventual consistency fine.
- Latency: 99p matters; rate-limit cost must be < 1 µs.
- Lifetime: process-lifetime.
- Memory: must cap (untrusted IP space).

Conclusion: `sync.Map` is a strong candidate for the hot read path. But because the key set grows unbounded, you need a periodic sweep with `CompareAndDelete`. Or — better — use an LRU cache library like `hashicorp/golang-lru` or `ristretto` and accept the small overhead.

### Worked example: in-memory key-value store

- Read/write ratio: 1:1.
- Key cardinality: huge, growing.
- Value: variable size.
- Contention: distributed but with hotspots.
- Consistency: `Len` needed for metrics.
- Latency: throughput matters.
- Lifetime: process-lifetime.
- Memory: capped.

Conclusion: sharded `RWMutex+map`, 64 or 256 shards. `sync.Map` would lose on writes and lack `Len`. A single `RWMutex+map` would bottleneck on writes.

---

## `singleflight` — When Load-Once Is the Goal

`sync.Map.LoadOrStore` solves "set if absent." It does *not* solve "compute once and share the result." If two goroutines both miss the cache, both compute, and one wins the store. The losing goroutine wasted work.

`golang.org/x/sync/singleflight` deduplicates concurrent calls to the same key. Only one goroutine computes; the others wait for the result.

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group
var cache sync.Map

func GetUser(id string) (*User, error) {
    if v, ok := cache.Load(id); ok {
        return v.(*User), nil
    }
    v, err, _ := g.Do(id, func() (any, error) {
        u, err := db.Fetch(id)
        if err != nil {
            return nil, err
        }
        cache.Store(id, u)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

The third return value of `g.Do` is `shared bool` — `true` if multiple callers reused the result. Useful for metrics.

### When to use `singleflight` vs `LoadOrStore`

- **`LoadOrStore`** if computation is cheap and you do not mind duplicate work. The atomic insert prevents two values from being stored, but both may compute.
- **`singleflight`** if computation is expensive (database query, external API call, expensive parse). Only one goroutine pays, others wait.

### `singleflight` pitfalls

- **Panic propagation.** If the function passed to `g.Do` panics, all waiters receive the panic. Recover inside the function.
- **Context handling.** `Do` does not take a context. If the first caller's context cancels, the work continues; later callers still wait. Use `DoChan` and select on it with a cancelable receive.
- **Result caching is your job.** `singleflight` only dedupes in-flight calls; it does not cache. Combine with `sync.Map` for caching.

### Combining `sync.Map` and `singleflight`

The canonical pattern for an expensive-to-compute cache:

```go
type Cache struct {
    g singleflight.Group
    m sync.Map // map[string]*Entry
}

func (c *Cache) Get(key string) (*Entry, error) {
    if v, ok := c.m.Load(key); ok {
        return v.(*Entry), nil
    }
    v, err, _ := c.g.Do(key, func() (any, error) {
        e, err := compute(key)
        if err != nil {
            return nil, err
        }
        c.m.Store(key, e)
        return e, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*Entry), nil
}
```

This is the *correct* "compute once and cache" pattern. Use it whenever the compute step is non-trivial.

---

## Generic Wrappers for sync.Map

Go 1.18+ generics let us hide the `any` API. The standard wrapper:

```go
package syncmap

import "sync"

type Map[K comparable, V any] struct {
    inner sync.Map
}

func (m *Map[K, V]) Load(key K) (V, bool) {
    v, ok := m.inner.Load(key)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}

func (m *Map[K, V]) Store(key K, value V) {
    m.inner.Store(key, value)
}

func (m *Map[K, V]) LoadOrStore(key K, value V) (V, bool) {
    actual, loaded := m.inner.LoadOrStore(key, value)
    return actual.(V), loaded
}

func (m *Map[K, V]) LoadAndDelete(key K) (V, bool) {
    v, ok := m.inner.LoadAndDelete(key)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}

func (m *Map[K, V]) Delete(key K) {
    m.inner.Delete(key)
}

func (m *Map[K, V]) Range(f func(K, V) bool) {
    m.inner.Range(func(k, v any) bool {
        return f(k.(K), v.(V))
    })
}

func (m *Map[K, V]) Swap(key K, value V) (V, bool) {
    prev, loaded := m.inner.Swap(key, value)
    if !loaded {
        var zero V
        return zero, false
    }
    return prev.(V), true
}

func (m *Map[K, V]) CompareAndSwap(key K, old, new V) bool {
    return m.inner.CompareAndSwap(key, old, new)
}

func (m *Map[K, V]) CompareAndDelete(key K, old V) bool {
    return m.inner.CompareAndDelete(key, old)
}
```

This gives you `syncmap.Map[string, *Entry]` with no `any` in user code, and the type assertions happen exactly once in one file you can audit.

### What you give up

- The same boxing overhead remains. Storing `int` still allocates an interface. Generics fix the *type-safety*, not the underlying interface storage.
- `CompareAndSwap` still panics for non-comparable `V` at runtime. The type system does not prevent it; you would need `V comparable` as the type constraint for those methods, but Go does not allow method-level constraints. Document it.

### A proposal in flight

A `sync.Map[K, V]` is proposed for the standard library (issue 47657 and others). As of Go 1.22 it has not landed. Once it does, prefer the standard wrapper over hand-rolled ones.

---

## Sharded Maps Done Properly

The middle-level sketch was a starting point. A production sharded map deserves care.

```go
package sharded

import (
    "hash/maphash"
    "sync"
)

type shard[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

type Map[K comparable, V any] struct {
    shards []*shard[K, V]
    seed   maphash.Seed
    hashFn func(maphash.Seed, K) uint64
}

func New[K comparable, V any](shardCount int, hashFn func(maphash.Seed, K) uint64) *Map[K, V] {
    shards := make([]*shard[K, V], shardCount)
    for i := range shards {
        shards[i] = &shard[K, V]{m: make(map[K]V)}
    }
    return &Map[K, V]{
        shards: shards,
        seed:   maphash.MakeSeed(),
        hashFn: hashFn,
    }
}

func (s *Map[K, V]) shard(key K) *shard[K, V] {
    h := s.hashFn(s.seed, key)
    return s.shards[int(h%uint64(len(s.shards)))]
}

func (s *Map[K, V]) Get(key K) (V, bool) {
    sh := s.shard(key)
    sh.mu.RLock()
    v, ok := sh.m[key]
    sh.mu.RUnlock()
    return v, ok
}

func (s *Map[K, V]) Set(key K, value V) {
    sh := s.shard(key)
    sh.mu.Lock()
    sh.m[key] = value
    sh.mu.Unlock()
}

func (s *Map[K, V]) Delete(key K) {
    sh := s.shard(key)
    sh.mu.Lock()
    delete(sh.m, key)
    sh.mu.Unlock()
}

func (s *Map[K, V]) Len() int {
    n := 0
    for _, sh := range s.shards {
        sh.mu.RLock()
        n += len(sh.m)
        sh.mu.RUnlock()
    }
    return n
}
```

### Choosing shard count

- Too few: writes contend on the same lock; throughput plateaus.
- Too many: memory overhead per empty shard; cache locality suffers.
- Rule of thumb: 16 for small workloads, 64–256 for high-concurrency servers, never more than 4× `GOMAXPROCS` unless you have a measured reason.

### Hash function

The `maphash` package provides a cryptographically-irrelevant but well-distributed hash that is randomised per program run. This is what you want for shard selection. **Do not use `fnv` for shard selection** if your keys are attacker-controlled — `fnv` is predictable and an attacker can engineer hot-shard scenarios. `maphash` is randomised per process, so the same key hashes differently in two runs.

### `Len` cost

`Len` walks every shard. For 64 shards, that is 64 mutex acquisitions. Acceptable for an occasional metrics scrape; not for the hot path. Cache it if you call it often.

---

## Comparison with `atomic.Pointer[map]`

The "copy-on-write" pattern:

```go
type Config struct {
    p atomic.Pointer[map[string]string]
}

func (c *Config) Get(k string) (string, bool) {
    m := *c.p.Load()
    v, ok := m[k]
    return v, ok
}

func (c *Config) Replace(newMap map[string]string) {
    c.p.Store(&newMap)
}
```

**Reads are blazing fast**: one atomic load, one map index. No lock, no contention, no `sync.Map` book-keeping. The Go compiler can sometimes even inline the indirection.

The trade-off: **every write rebuilds the entire map**. For "config swapped once a minute" this is fine. For "1 000 writes per second," catastrophic.

### When `atomic.Pointer[map]` wins

- Configuration tables updated rarely, read constantly.
- Routing tables, feature flags.
- DNS-like lookups.

### When it loses

- Anything with regular writes.
- Anything with large maps where rebuild is expensive.

### Update protocol

```go
func (c *Config) Set(key, value string) {
    for {
        oldPtr := c.p.Load()
        newMap := make(map[string]string, len(*oldPtr)+1)
        for k, v := range *oldPtr {
            newMap[k] = v
        }
        newMap[key] = value
        if c.p.CompareAndSwap(oldPtr, &newMap) {
            return
        }
    }
}
```

The CAS retry loop ensures no concurrent updates lose. If many writers race, they retry; the loser wastes a copy. Acceptable when writers are rare.

---

## Memory Model and Happens-Before Guarantees

From the Go memory model (post 1.19 revision):

> The APIs in the sync and sync/atomic packages are collectively "synchronizing operations" that can be used to allow one goroutine to observe operations completed by another.

In concrete terms:

- A `Store(k, v)` *happens before* any subsequent `Load(k)` that returns that `v`.
- A `LoadOrStore` that successfully stores has the same `Store` semantics.
- A `Range` callback observes values that were stored *before* the callback was invoked, for each visited key.
- `CompareAndSwap` success forms a happens-before edge with subsequent reads of that key.

What this lets you do: publish complex objects through `sync.Map` safely.

```go
type Entry struct {
    Name string
    Data []byte
}

// goroutine A
e := &Entry{Name: "x", Data: make([]byte, 100)}
fillData(e.Data)
m.Store("x", e)

// goroutine B (later)
if v, ok := m.Load("x"); ok {
    e := v.(*Entry)
    use(e.Name, e.Data) // safe: B sees what A wrote before Store
}
```

The `Store` flushes all of A's prior writes to memory visible to B's later reads. This is exactly the same guarantee a mutex would give.

### What it does *not* guarantee

- A `Range` does not provide a snapshot. You may see partial updates to different keys.
- A `Store` immediately followed by a `Load` from another goroutine may race — there is no guarantee the load runs after the store *in real time*. The guarantee is "if the load returns the stored value, the prior writes are visible."

For a fuller discussion see the specification page.

---

## Pitfalls at Scale

### Pitfall 1: Tombstones and amplification

Deleted entries leave behind a marker (`expunged`) in the read structure until the read structure is rebuilt. High-churn workloads (constantly storing and deleting) cause this to balloon. We cover the mechanics at professional level. The practical effect: a `sync.Map` may use 2–3× the memory of an `RWMutex+map` for the same live entry count under churn.

### Pitfall 2: Boxing pressure

Every `Store(k, intValue)` boxes the `int` as an interface, allocating on the heap. For a hot map with millions of int writes per second, this is a massive GC bill. Use:

- `[]atomic.Int64` indexed by hash (no map at all).
- Pointer values (`*int64`) that are allocated once and updated atomically.
- A typed wrapper that stores pointers, not values.

### Pitfall 3: The map nobody owns

`sync.Map` makes it tempting to scatter a single map across many packages, since "everyone can read/write safely." This becomes a maintenance nightmare. Treat a `sync.Map` like any shared state: one owning package controls reads, writes, and lifecycle; others use a typed API.

### Pitfall 4: Range during shutdown

A `Range` walking the map while another goroutine is draining and closing connections can race on the *values* (the map operations are safe; what your callback does with the values is not). Always use immutable values, or copy under a per-value lock.

### Pitfall 5: Goroutine leaks via `singleflight`

If you use `singleflight` with a never-completing function, every waiter leaks. Use a context-cancellable version:

```go
result := c.g.DoChan(key, fn)
select {
case r := <-result:
    return r.Val.(*Entry), r.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

---

## Designing APIs Around `sync.Map`

Recommended boundary:

```go
type UserCache struct {
    m syncmap.Map[string, *User] // generic wrapper
    g singleflight.Group
}

func (c *UserCache) Get(ctx context.Context, id string) (*User, error)
func (c *UserCache) Invalidate(id string)
func (c *UserCache) Range(f func(id string, u *User) bool)
```

Notes:

- **The map is private.** No external caller touches `Load`/`Store`.
- **Operations are named for intent.** `Get` is not `Load`; `Invalidate` is not `Delete`. The wording communicates that there is a cache underneath.
- **Errors and context flow through public methods.** The map cannot fail, but the underlying compute can.
- **`Range` is exposed for metrics, not state mutation.** Callers cannot, e.g., bulk-update through it.

A wrapper like this lets you replace `sync.Map` with a sharded map or `ristretto` later without changing callers.

---

## When to Ditch the Map Entirely

Sometimes the right answer is "no map." Indicators:

1. **You only ever look up by integer ID in a dense range.** A `[]T` is faster, simpler, and lockless if you only append.
2. **Your keys are enums or small fixed sets.** A typed struct with explicit fields is clearer than a map.
3. **You really want a set, not a map.** Many Go codebases simulate sets with `map[K]struct{}` — fine, but a sorted slice with binary search is often faster for small sets.
4. **The "map" only ever has one entry.** Use `atomic.Pointer[T]` directly.
5. **You are duplicating state already held in the database.** Cache invalidation is the second-hardest problem in CS. Re-fetch on demand if you can afford the latency, and skip the cache.
6. **You are storing data with strong ordering requirements.** A queue (slice + index + mutex, or a `chan`) fits better.

The temptation to reach for `sync.Map` because "concurrent" is in the name is real. Resist if a simpler structure works.

---

## Self-Assessment

- [ ] I can analyse a workload along read/write ratio, key cardinality, contention, consistency, and latency before picking a primitive.
- [ ] I use `singleflight` for expensive load-once work, and combine it with `sync.Map` for caching.
- [ ] I have built (or can sketch) a generic `Map[K, V]` wrapper that hides the `any` API.
- [ ] I can implement a sharded concurrent map with `maphash`, knowing why `fnv` is wrong for attacker-controlled keys.
- [ ] I know when `atomic.Pointer[map]` outperforms `sync.Map`.
- [ ] I understand the happens-before edges `sync.Map` provides.
- [ ] I recognise the boxing/amplification/tombstone pitfalls.
- [ ] I have, at least once, decided not to use a concurrent map and used a simpler structure instead.
- [ ] I expose maps behind named domain methods, not raw `Load`/`Store`.
- [ ] I can explain why `Range` is not a snapshot in three sentences.

---

## Summary

At senior level you stop reaching for `sync.Map` reflexively. You analyse the workload, pick between `sync.Map`, `RWMutex+map`, sharded maps, `atomic.Pointer[map]`, or no map at all. You combine `singleflight` with whichever cache primitive suits the read pattern. You wrap the `any` API in a generic shell so the type system catches your mistakes. You know the happens-before contract well enough to publish complex objects through the map confidently.

The map is a tool. The skill is knowing when not to use it, and when to use it, knowing precisely which variant. The next file — professional — looks inside `sync.Map` to explain *why* these trade-offs exist, by examining the read/dirty/expunged machinery.
