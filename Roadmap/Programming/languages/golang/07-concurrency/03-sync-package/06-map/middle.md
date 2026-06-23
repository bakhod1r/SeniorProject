# sync.Map — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Full API at Middle Level](#the-full-api-at-middle-level)
3. [Go 1.20 Additions in Depth](#go-120-additions-in-depth)
4. [Decision Matrix: `sync.Map` vs `RWMutex + map`](#decision-matrix-syncmap-vs-rwmutex--map)
5. [Benchmarks You Should Run Yourself](#benchmarks-you-should-run-yourself)
6. [Atomic-Update Patterns](#atomic-update-patterns)
7. [Range Semantics in Detail](#range-semantics-in-detail)
8. [Tracking Size](#tracking-size)
9. [TTL and Eviction Wrappers](#ttl-and-eviction-wrappers)
10. [Mixed Workloads — When Neither Fits](#mixed-workloads--when-neither-fits)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior level you learned the `sync.Map` API and the rule "read-mostly, stable keys, otherwise default to `RWMutex+map`." At middle level you start *justifying* that rule with measurements and *choosing* the right tool with data. After this file you will:

- Know every method on `sync.Map`, including the Go 1.20 additions, in detail.
- Reason about why `sync.Map` is slower for write-heavy workloads, with numbers.
- Pick between `sync.Map`, `RWMutex+map`, and sharded variants for real scenarios.
- Build atomic-update patterns using `CompareAndSwap`.
- Wrap `sync.Map` with TTL and size-tracking.

---

## The Full API at Middle Level

```go
package sync

type Map struct { /* unexported */ }

func (m *Map) Load(key any) (value any, ok bool)
func (m *Map) Store(key, value any)
func (m *Map) LoadOrStore(key, value any) (actual any, loaded bool)
func (m *Map) LoadAndDelete(key any) (value any, loaded bool)
func (m *Map) Delete(key any)
func (m *Map) Range(f func(key, value any) bool)

// Go 1.20+
func (m *Map) Swap(key, value any) (previous any, loaded bool)
func (m *Map) CompareAndSwap(key, old, new any) (swapped bool)
func (m *Map) CompareAndDelete(key, old any) (deleted bool)
```

Every method is safe for concurrent use. None return errors; their effects are observable via the `ok`/`loaded`/`swapped`/`deleted` booleans. The key must be comparable; values can be anything.

### `LoadOrStore` revisited

The atomic "set if absent" is more than convenience — it eliminates the classic race:

```go
// Bad: check-then-act
if _, ok := m.Load(k); !ok {
    m.Store(k, v) // another goroutine may have stored between
}

// Good
m.LoadOrStore(k, v)
```

The `loaded` return tells you whether the entry pre-existed. If you only care about putting *something* there, you can ignore it. If you care about *which value won*, use `actual`.

### `LoadAndDelete` revisited

The atomic "take and remove" is the work-handoff primitive. Producers `Store`; consumers `LoadAndDelete`. Only one consumer can succeed per entry. Without `LoadAndDelete`, you would have to lock externally to prevent two consumers from taking the same key.

```go
if v, ok := m.LoadAndDelete(jobID); ok {
    process(v.(*Job)) // we, and only we, took this job
}
```

---

## Go 1.20 Additions in Depth

Three methods landed in Go 1.20 that close the longest-standing gap in `sync.Map`: atomic updates.

### `Swap` — set and return the previous value

```go
func (m *Map) Swap(key, value any) (previous any, loaded bool)
```

Atomically replaces the value for `key` with `value` and returns the previous one. Like `Store` but with the old value as a return. Useful when you want to act on the old value while installing a new one.

```go
previous, loaded := registry.Swap(connID, newConn)
if loaded {
    previous.(*Conn).Close() // old connection bumped out
}
```

Before 1.20 you would need a `Load` followed by a `Store`, with the racy gap in between.

### `CompareAndSwap` — atomic conditional update

```go
func (m *Map) CompareAndSwap(key, old, new any) (swapped bool)
```

Replaces the value only if the current value is equal to `old`. Returns `true` on success. The values are compared with `==`, the standard Go equality, so `old` must be a comparable type. Crucially, **a struct or pointer with the same shape but different identity may or may not compare equal** depending on the type — be precise about what you store.

```go
// Increment-if-current pattern
for {
    v, _ := m.Load("hits")
    if m.CompareAndSwap("hits", v, v.(int)+1) {
        break
    }
}
```

Failure modes:
- `old` does not equal the current value → returns `false`, no change.
- The key does not exist → returns `false`, no change. **`CompareAndSwap` does not insert.**

If you need "insert if absent, atomically update if present," use `LoadOrStore` first, then `CompareAndSwap` in a retry loop.

### `CompareAndDelete` — atomic conditional remove

```go
func (m *Map) CompareAndDelete(key, old any) (deleted bool)
```

Removes the entry only if the current value equals `old`. Useful for "remove only if I am the most recent writer" patterns:

```go
// Remove cache entry if it has not been refreshed
m.CompareAndDelete(key, staleValue)
```

This eliminates the race where you `Load` a stale value, decide to delete, and meanwhile another goroutine refreshed it.

### Values must be comparable for CAS variants

`CompareAndSwap` and `CompareAndDelete` compare values with `==`. If your values are interface types holding a slice, map, or function, the comparison panics at runtime:

```go
var m sync.Map
m.Store("k", []int{1, 2})
m.CompareAndSwap("k", []int{1, 2}, []int{3, 4})
// panic: runtime error: comparing uncomparable type []int
```

Pointer values (`*Entry`) compare by address, which is usually what you want for cache entries.

---

## Decision Matrix: `sync.Map` vs `RWMutex + map`

The most useful skill at middle level is choosing correctly. Here is the decision table I keep on my desk:

| Workload property | sync.Map | RWMutex + map | Sharded map | Notes |
|---|---|---|---|---|
| Read-mostly, stable keys | **Best** | OK | OK | The sweet spot. |
| Read-mostly, growing keys | OK | **Best** | OK | sync.Map pays for `dirty` rebuilds. |
| Balanced read/write | Slow | **Best** | **Best** | sync.Map writes are expensive. |
| Write-heavy | Slow | **Good** | **Best** | Contention is the bottleneck; sharding cuts it. |
| Per-key contention low (writes spread) | OK | OK | **Best** | Sharding shines. |
| Per-key contention high (hot key) | Slow | Slow | Slow | None help; rethink data model. |
| Need atomic counter increment | OK (Go 1.20+) | OK | OK | Or use `atomic.Int64` outside the map. |
| Need `Len()` | No | **Yes** | **Yes** | sync.Map has no `Len`. |
| Need ordered iteration | No | **Yes** | **Yes** | None of these give order; use a sorted slice. |
| Need atomic snapshot | No | **Yes** | Hard | RWMutex+map is easiest: `RLock`, copy keys, `RUnlock`. |
| Small (< 100 entries) | Slow | **Best** | Overkill | The mutex is rarely contended at this size. |
| Huge (1M+ entries), churn | Memory amp | OK | **Best** | sync.Map retains tombstones. |
| Generic value type wanted | No (any) | **Yes** | Yes | Build a generic wrapper if needed. |
| Cross-goroutine writes rare | **Best** | OK | OK | sync.Map's other sweet spot. |

The two patterns the Go authors explicitly designed for:

> The Map type is optimized for two common use cases: (1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys.

If your workload is neither, `sync.Map` is almost always slower than `RWMutex+map`.

---

## Benchmarks You Should Run Yourself

Here are skeletal benchmarks. Copy them into your project, adjust the workload, and *measure*.

```go
// bench_test.go
package mapbench_test

import (
    "fmt"
    "sync"
    "testing"
)

const N = 10000

func setupBuiltin() (map[int]int, *sync.RWMutex) {
    m := make(map[int]int)
    for i := 0; i < N; i++ {
        m[i] = i
    }
    return m, &sync.RWMutex{}
}

func setupSyncMap() *sync.Map {
    var m sync.Map
    for i := 0; i < N; i++ {
        m.Store(i, i)
    }
    return &m
}

func BenchmarkReadMostly_RWMutex(b *testing.B) {
    m, mu := setupBuiltin()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            mu.RLock()
            _ = m[i%N]
            mu.RUnlock()
            i++
        }
    })
}

func BenchmarkReadMostly_SyncMap(b *testing.B) {
    m := setupSyncMap()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            _, _ = m.Load(i % N)
            i++
        }
    })
}

func BenchmarkBalanced_RWMutex(b *testing.B) {
    m, mu := setupBuiltin()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            if i%2 == 0 {
                mu.RLock()
                _ = m[i%N]
                mu.RUnlock()
            } else {
                mu.Lock()
                m[i%N] = i
                mu.Unlock()
            }
            i++
        }
    })
}

func BenchmarkBalanced_SyncMap(b *testing.B) {
    m := setupSyncMap()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            if i%2 == 0 {
                _, _ = m.Load(i % N)
            } else {
                m.Store(i%N, i)
            }
            i++
        }
    })
}

func BenchmarkWriteHeavy_RWMutex(b *testing.B) {
    m, mu := setupBuiltin()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            mu.Lock()
            m[i%N] = i
            mu.Unlock()
            i++
        }
    })
}

func BenchmarkWriteHeavy_SyncMap(b *testing.B) {
    m := setupSyncMap()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            m.Store(i%N, i)
            i++
        }
    })
}

var _ = fmt.Sprintf
```

Run with:

```bash
go test -bench=. -benchmem -cpu=1,2,4,8 ./...
```

### Indicative results on Apple M2, Go 1.22, 8 cores

These are *rough numbers* — your hardware will differ. Always re-measure.

| Benchmark | -cpu=1 | -cpu=4 | -cpu=8 |
|---|---|---|---|
| ReadMostly_RWMutex | 30 ns/op | 90 ns/op | 200 ns/op |
| ReadMostly_SyncMap | 15 ns/op | 18 ns/op | 22 ns/op |
| Balanced_RWMutex | 50 ns/op | 280 ns/op | 700 ns/op |
| Balanced_SyncMap | 90 ns/op | 220 ns/op | 350 ns/op |
| WriteHeavy_RWMutex | 80 ns/op | 350 ns/op | 900 ns/op |
| WriteHeavy_SyncMap | 180 ns/op | 600 ns/op | 1 500 ns/op |

Lessons:

- **Read-mostly with stable keys: `sync.Map` scales beautifully.** At 8 cores it is roughly 10× faster than `RWMutex+map`, because reads are lock-free.
- **Balanced workloads: `sync.Map` and `RWMutex+map` are comparable.** `sync.Map` may pull ahead on many cores; the gap is small.
- **Write-heavy: `RWMutex+map` wins.** `sync.Map`'s write path is more expensive per operation. Plus, both contend on a single lock at high concurrency, so consider sharding.

The above numbers reverse if your workload has *high churn* (many new keys and deletions). `sync.Map` slows further as the read/dirty rebuild fires repeatedly.

---

## Atomic-Update Patterns

### Pattern 1: Increment-if-present with `CompareAndSwap`

```go
func increment(m *sync.Map, key any) {
    for {
        v, ok := m.Load(key)
        if !ok {
            m.LoadOrStore(key, 1)
            return
        }
        next := v.(int) + 1
        if m.CompareAndSwap(key, v, next) {
            return
        }
    }
}
```

The retry loop handles concurrent updates. If `CompareAndSwap` fails, another goroutine bumped the value first; we retry with the new current value.

**Caveat:** for hot counters, this can spin under contention. An `atomic.Int64` is faster. Use `sync.Map` for *per-key* counters where each key is rarely contended.

### Pattern 2: Replace-if-equal for cache invalidation

```go
func refreshIfStale(m *sync.Map, key string, stale *Entry) {
    fresh := load(key)
    m.CompareAndSwap(key, stale, fresh)
}
```

If another goroutine already refreshed, our `CompareAndSwap` does nothing. No lost updates, no double-refresh.

### Pattern 3: Delete-if-equal for safe eviction

```go
func evict(m *sync.Map, key string, expected *Entry) {
    m.CompareAndDelete(key, expected)
}
```

Common in TTL eviction: a background goroutine schedules a delete after N seconds, but only if the entry has not been replaced in the meantime.

### Pattern 4: Atomic swap with side effect

```go
prev, loaded := m.Swap(connID, newConn)
if loaded {
    prev.(*Conn).Close()
}
```

The `Swap` returns the old value; we close it. This pattern is connection-pool gold.

---

## Range Semantics in Detail

The `Range` callback signature:

```go
func(key, value any) bool
```

Return `true` to continue, `false` to stop.

The spec:

> Range does not necessarily correspond to any consistent snapshot of the Map's contents: no key will be visited more than once, but if the value for any key is stored or deleted concurrently (including by f), Range may reflect any mapping for that key from any point during the Range call.

Translation:

- Each key existing at the start of `Range` is visited at most once.
- Keys inserted during `Range` may or may not be visited.
- Keys deleted during `Range` may or may not be visited.
- The *value* observed for a key may be the value at any point during the call.
- Order is unspecified.

### Consequences

1. **Don't use `Range` for "atomic snapshot" of state.** Use `RWMutex+map` if you need that.
2. **Modifying the map from inside `Range` is safe** but the modifications interact with iteration in implementation-defined ways. Avoid.
3. **`Range` runs in O(n) of the *visible* entries.** For large maps with many tombstones (see professional level), the actual work can exceed the apparent count.

### Common Range patterns

```go
// Collect keys (loosely consistent)
var keys []string
m.Range(func(k, _ any) bool {
    keys = append(keys, k.(string))
    return true
})

// Filter and collect
var actives []*Conn
m.Range(func(_, v any) bool {
    c := v.(*Conn)
    if c.Active() {
        actives = append(actives, c)
    }
    return true
})

// Early exit on match
var found *Entry
m.Range(func(_, v any) bool {
    e := v.(*Entry)
    if e.ID == target {
        found = e
        return false
    }
    return true
})
```

---

## Tracking Size

`sync.Map` has no `Len()`. The recommended way to track size, if you need it:

```go
type CountedMap struct {
    m sync.Map
    n int64 // atomic
}

func (c *CountedMap) Store(k, v any) {
    if _, loaded := c.m.LoadOrStore(k, v); loaded {
        c.m.Store(k, v) // overwrite
    } else {
        atomic.AddInt64(&c.n, 1)
    }
}

func (c *CountedMap) Delete(k any) {
    if _, loaded := c.m.LoadAndDelete(k); loaded {
        atomic.AddInt64(&c.n, -1)
    }
}

func (c *CountedMap) Len() int64 {
    return atomic.LoadInt64(&c.n)
}
```

Notes:

- The `Store` path uses `LoadOrStore` first to detect "was it already there?" then a second `Store` for the overwrite. Two operations, slightly slower.
- The `Len` is eventually consistent: between a `Store` and the counter `Add`, a concurrent `Len` may be off by one. Usually acceptable.
- If you need precise size, you need a mutex, which defeats the point of `sync.Map`. Consider `RWMutex+map` instead.

---

## TTL and Eviction Wrappers

A common request: "cache values with a TTL." `sync.Map` does not natively support this; you build it on top:

```go
type ttlEntry struct {
    value   any
    expires time.Time
}

type TTLMap struct {
    m sync.Map
}

func (t *TTLMap) Set(key any, value any, ttl time.Duration) {
    t.m.Store(key, ttlEntry{value, time.Now().Add(ttl)})
}

func (t *TTLMap) Get(key any) (any, bool) {
    v, ok := t.m.Load(key)
    if !ok {
        return nil, false
    }
    e := v.(ttlEntry)
    if time.Now().After(e.expires) {
        t.m.CompareAndDelete(key, e) // safe: only if unchanged
        return nil, false
    }
    return e.value, true
}
```

The `CompareAndDelete` ensures we do not evict an entry that was refreshed between our `Load` and the delete.

For periodic sweep:

```go
func (t *TTLMap) Sweep() {
    now := time.Now()
    t.m.Range(func(k, v any) bool {
        if now.After(v.(ttlEntry).expires) {
            t.m.CompareAndDelete(k, v)
        }
        return true
    })
}
```

Run `Sweep` from a ticker. Note that high-churn TTL workloads can hurt `sync.Map` performance due to memory amplification — consider an eviction-aware library like `ristretto` or `freecache` for serious caching.

---

## Mixed Workloads — When Neither Fits

Two scenarios where the choice is harder:

### Scenario A: Bursty writes, otherwise read-mostly

Example: a config map that is mostly read, but occasionally a bulk update writes 1 000 entries.

If reads vastly outnumber writes overall, `sync.Map` still wins despite the burst. But during the burst, throughput drops. If the burst causes user-visible latency, consider an `atomic.Pointer[map[K]V]` that swaps the entire map atomically on update — readers see no contention at all, writers pay the full rebuild cost.

```go
type Config struct {
    m atomic.Pointer[map[string]string]
}

func (c *Config) Get(k string) (string, bool) {
    v, ok := (*c.m.Load())[k]
    return v, ok
}

func (c *Config) Swap(newMap map[string]string) {
    c.m.Store(&newMap)
}
```

This is the "copy-on-write map" pattern. Reads are a single atomic load plus a map index — even faster than `sync.Map`. The catch: every write rebuilds the whole map.

### Scenario B: Hot keys

If a small set of keys gets most of the writes, no map structure helps — your data model is concentrated. Solutions:

1. Per-shard atomic counters (`[N]atomic.Int64`) indexed by hash.
2. Move hot state out of the map into a typed struct with `atomic.Pointer`.
3. Aggregate updates in a buffered channel processed by a single goroutine.

The map is not the bottleneck; the contention is. Sharding the map without sharding the access pattern does not help.

### Sharded map skeleton

```go
const shardCount = 64

type ShardedMap struct {
    shards [shardCount]struct {
        sync.RWMutex
        m map[string]any
    }
}

func (s *ShardedMap) shardFor(key string) *struct {
    sync.RWMutex
    m map[string]any
} {
    h := fnv32(key)
    return &s.shards[h%shardCount]
}

func (s *ShardedMap) Get(key string) (any, bool) {
    sh := s.shardFor(key)
    sh.RLock()
    v, ok := sh.m[key]
    sh.RUnlock()
    return v, ok
}

func (s *ShardedMap) Set(key string, value any) {
    sh := s.shardFor(key)
    sh.Lock()
    sh.m[key] = value
    sh.Unlock()
}
```

64 shards means at most 1/64 of operations contend on the same lock. For write-heavy workloads at high concurrency, this typically outperforms both `sync.Map` and a single `RWMutex+map`.

---

## Self-Assessment

- [ ] I can list every method on `sync.Map` from memory.
- [ ] I know what `Swap`, `CompareAndSwap`, and `CompareAndDelete` do and what they return.
- [ ] I can pick between `sync.Map`, `RWMutex+map`, and a sharded map for a given workload.
- [ ] I can write a benchmark that compares them on my real access pattern.
- [ ] I know the `Range` semantics precisely — not a snapshot, may or may not see concurrent stores.
- [ ] I can implement an atomic-increment-per-key pattern using `CompareAndSwap`.
- [ ] I know how to track size externally with an `atomic.Int64`.
- [ ] I can build a TTL wrapper using `CompareAndDelete` for safe eviction.
- [ ] I know when `atomic.Pointer[map]` beats both `sync.Map` and `RWMutex+map`.
- [ ] I know why hot keys are not solvable by sharding alone.

---

## Summary

`sync.Map` is a specialised concurrent map with a small but powerful API. Since Go 1.20 it supports atomic update via `Swap`, `CompareAndSwap`, and `CompareAndDelete`. Its sweet spot — read-mostly with stable keys, or per-goroutine disjoint writes — wins by an order of magnitude over `RWMutex+map` at high concurrency. Outside that sweet spot, a plain `RWMutex+map` is faster, simpler, and typed.

The middle-level skill is *measurement-driven choice*: run the benchmarks, look at your read/write ratio, count your keys, ask whether you need `Len` or snapshot semantics, and pick deliberately. For write-heavy concentrated workloads, sharding beats both. For bursty config swaps, `atomic.Pointer[map]` is even faster than `sync.Map` on the read path.

At senior level we examine deeper trade-offs: generic wrappers, `singleflight` for load-once, and the limits of all these structures when contention concentrates.
