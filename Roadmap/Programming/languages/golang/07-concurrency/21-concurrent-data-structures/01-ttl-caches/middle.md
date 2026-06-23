---
layout: default
title: Middle
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/middle/
---

# Concurrent TTL Caches — Middle Level

## Table of Contents
1. [Where We Left Off](#where-we-left-off)
2. [Why a Heap?](#why-a-heap)
3. [Designing the Expiration Heap](#designing-the-expiration-heap)
4. [Implementing the Heap-Backed Cache](#implementing-the-heap-backed-cache)
5. [Handling Updates: Stale Heap Entries](#handling-updates-stale-heap-entries)
6. [Switching to `sync.Map` for Reads](#switching-to-syncmap-for-reads)
7. [Combining `sync.Map` with a Heap](#combining-syncmap-with-a-heap)
8. [Batched Sweeps](#batched-sweeps)
9. [Time-Budgeted Sweeps](#time-budgeted-sweeps)
10. [Jittered TTL](#jittered-ttl)
11. [Thundering Herds in Detail](#thundering-herds-in-detail)
12. [`singleflight` to the Rescue](#singleflight-to-the-rescue)
13. [Negative Caching](#negative-caching)
14. [Stale-While-Revalidate](#stale-while-revalidate)
15. [Refresh-Ahead](#refresh-ahead)
16. [Eviction Policies Overview](#eviction-policies-overview)
17. [Implementing a Bounded TTL Cache](#implementing-a-bounded-ttl-cache)
18. [Choosing Between `ristretto`, `bigcache`, and `freecache`](#choosing-between-ristretto-bigcache-and-freecache)
19. [Observability: Hits, Misses, and Latency Histograms](#observability-hits-misses-and-latency-histograms)
20. [Distributed Caches Briefly Considered](#distributed-caches-briefly-considered)
21. [Cache Warming Strategies](#cache-warming-strategies)
22. [Cache Stampede Patterns Beyond Single-Flight](#cache-stampede-patterns-beyond-single-flight)
23. [Testing at the Middle Level](#testing-at-the-middle-level)
24. [Common Mid-Level Mistakes](#common-mid-level-mistakes)
25. [Worked Example: API Gateway Cache](#worked-example-api-gateway-cache)
26. [Worked Example: Token Validation Cache](#worked-example-token-validation-cache)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [Further Reading](#further-reading)

---

## Where We Left Off

At the junior level we built a TTL cache with:

- `map[string]entry` protected by `sync.RWMutex`
- A single sweep goroutine that walked the whole map every interval
- Per-entry TTLs, hit/miss counters, clean shutdown

That cache has clear limits. Three of them dominate at the middle level:

1. **The sweeper is `O(N)`.** Walking a million entries while holding the write lock stalls every reader.
2. **Hot keys cause thundering herds.** When a popular key expires and 1,000 goroutines simultaneously miss, every one of them calls the upstream — 999 calls more than necessary.
3. **There is no size bound.** Memory grows with the working set; an attacker (or a misconfigured client) can drive it to OOM.

This file fixes the first two. The third — bounded size with intelligent eviction — is mostly the senior file's territory, but we introduce it here through `ristretto`, `bigcache`, and `freecache`.

By the end of this file you will be able to:

- Design and implement a heap-backed TTL cache where sweeps are `O(log N)` amortised per expiration, not `O(N)` per tick
- Combine `sync.Map` with a heap and explain the trade-offs
- Add jitter to TTLs to flatten herds and explain why it works
- Use `golang.org/x/sync/singleflight` to coalesce concurrent misses
- Choose between `ristretto`, `bigcache`, and `freecache` based on workload shape
- Implement stale-while-revalidate and refresh-ahead patterns
- Add Prometheus-style metrics to a cache for observability

---

## Why a Heap?

In the junior cache, the sweeper visits every entry — alive or dead — on every tick. That is wasteful when most entries are alive. A smarter sweeper should know *which entry expires next* and wake up only when needed.

The classic data structure for "smallest priority next" is a **min-heap**, indexed by expiration time. Insertion and removal are `O(log N)`. The minimum (next expiring entry) is at the root — `O(1)` to inspect.

The strategy:

- Each cache entry, when inserted, also pushes a `{expiresAt, key}` pair onto the heap.
- The sweeper does NOT use a fixed interval. It blocks on a timer set to the *root's* expiration time.
- When the timer fires, the sweeper pops everything from the heap whose expiration is now in the past.
- It then resets the timer to the new root.

The result: sweeps cost `O(k log N)` where `k` is the number of entries that expired since the last sweep — almost always tiny. The cache stops doing work between expirations.

A complication: when a `Set` overwrites an entry, the old heap entry becomes stale (it points to a `(key, oldExpiresAt)` that is no longer in the cache). We have two ways to handle this — *lazy stale dropping* or *index-based removal* — discussed below.

---

## Designing the Expiration Heap

A `container/heap`-backed structure:

```go
package cache

import (
    "container/heap"
    "time"
)

type heapItem struct {
    key       string
    expiresAt time.Time
    index     int
}

type expirationHeap []*heapItem

func (h expirationHeap) Len() int { return len(h) }
func (h expirationHeap) Less(i, j int) bool {
    return h[i].expiresAt.Before(h[j].expiresAt)
}
func (h expirationHeap) Swap(i, j int) {
    h[i], h[j] = h[j], h[i]
    h[i].index = i
    h[j].index = j
}
func (h *expirationHeap) Push(x any) {
    item := x.(*heapItem)
    item.index = len(*h)
    *h = append(*h, item)
}
func (h *expirationHeap) Pop() any {
    old := *h
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    item.index = -1
    *h = old[:n-1]
    return item
}
```

This is the standard `container/heap` boilerplate. The `index` field on each item lets us remove an *arbitrary* item from the heap in `O(log N)` via `heap.Remove`. That capability is essential for handling `Delete` and `Set` correctly — without it, the heap fills with dead entries.

---

## Implementing the Heap-Backed Cache

Now we wire the map and the heap together:

```go
package cache

import (
    "container/heap"
    "sync"
    "time"
)

type entry struct {
    value     string
    expiresAt time.Time
    heapIdx   *heapItem // back-pointer for O(log N) removal
}

type HeapCache struct {
    mu     sync.Mutex
    data   map[string]entry
    heap   expirationHeap

    timer    *time.Timer
    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func NewHeapCache() *HeapCache {
    c := &HeapCache{
        data: make(map[string]entry),
        heap: expirationHeap{},
        stop: make(chan struct{}),
        done: make(chan struct{}),
    }
    heap.Init(&c.heap)
    c.timer = time.NewTimer(time.Hour) // arbitrary far future
    if !c.timer.Stop() {
        <-c.timer.C
    }
    go func() {
        defer close(c.done)
        c.run()
    }()
    return c
}

func (c *HeapCache) SetWithTTL(key, value string, ttl time.Duration) {
    expiresAt := time.Now().Add(ttl)
    c.mu.Lock()
    defer c.mu.Unlock()

    // Remove any existing heap entry for this key.
    if old, ok := c.data[key]; ok && old.heapIdx != nil {
        heap.Remove(&c.heap, old.heapIdx.index)
    }

    item := &heapItem{key: key, expiresAt: expiresAt}
    heap.Push(&c.heap, item)
    c.data[key] = entry{value: value, expiresAt: expiresAt, heapIdx: item}

    c.rescheduleLocked()
}

func (c *HeapCache) Get(key string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.data[key]
    if !ok || time.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}

func (c *HeapCache) Delete(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.data[key]; ok {
        if e.heapIdx != nil {
            heap.Remove(&c.heap, e.heapIdx.index)
        }
        delete(c.data, key)
    }
    c.rescheduleLocked()
}

func (c *HeapCache) rescheduleLocked() {
    if !c.timer.Stop() {
        select {
        case <-c.timer.C:
        default:
        }
    }
    if len(c.heap) == 0 {
        return
    }
    delay := time.Until(c.heap[0].expiresAt)
    if delay < 0 {
        delay = 0
    }
    c.timer.Reset(delay)
}

func (c *HeapCache) run() {
    for {
        select {
        case <-c.timer.C:
            c.evictExpired()
        case <-c.stop:
            return
        }
    }
}

func (c *HeapCache) evictExpired() {
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    for len(c.heap) > 0 && !c.heap[0].expiresAt.After(now) {
        item := heap.Pop(&c.heap).(*heapItem)
        if e, ok := c.data[item.key]; ok && e.heapIdx == item {
            delete(c.data, item.key)
        }
        // else: stale heap entry (key was overwritten or deleted) — skip.
    }
    c.rescheduleLocked()
}

func (c *HeapCache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

Notice the back-pointer (`heapIdx`) and the `e.heapIdx == item` identity check. Together they make the heap entry a *canonical* reference: if an `entry`'s `heapIdx` no longer matches the item we just popped, the item is stale and we ignore it.

We also use a `Mutex` (not `RWMutex`) because every operation now mutates either the heap or the map. There is no read-only path worth speeding up.

---

## Handling Updates: Stale Heap Entries

Strategy A (above): **canonical heap entry**. Each cache entry stores a back-pointer to its heap item. On overwrite or delete, we explicitly `heap.Remove` the old item. The heap stays compact.

Strategy B: **lazy stale dropping**. We never remove old heap items on overwrite. Instead, when the sweeper pops an item, it checks whether the cache entry still references this exact item — and skips otherwise. The heap is allowed to grow with stale entries.

```go
// Strategy B set: do not remove old heap entries
func (c *Cache) Set(k, v string) {
    expiresAt := time.Now().Add(c.ttl)
    item := &heapItem{key: k, expiresAt: expiresAt}
    c.mu.Lock()
    heap.Push(&c.heap, item)
    c.data[k] = entry{value: v, expiresAt: expiresAt, heapIdx: item}
    c.mu.Unlock()
    // No removal of any old heap entry.
}

// Strategy B sweep: skip items that are no longer the canonical
func (c *Cache) evictExpired() {
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    for len(c.heap) > 0 && !c.heap[0].expiresAt.After(now) {
        item := heap.Pop(&c.heap).(*heapItem)
        if e, ok := c.data[item.key]; ok && e.heapIdx == item && !time.Now().Before(e.expiresAt) {
            delete(c.data, item.key)
        }
    }
}
```

Strategy B has two implementation costs:

- The heap may grow large (one stale entry per `Set` that updates an existing key).
- The sweeper does work for each stale entry it encounters.

But it avoids the `O(log N)` overhead of `heap.Remove` on every `Set`. For workloads where keys are mostly read and rarely overwritten, strategy B is faster overall. For workloads with frequent updates, strategy A wins.

Choose deliberately, document the choice in the code.

---

## Switching to `sync.Map` for Reads

`sync.Map` is Go's purpose-built concurrent map. Internally it has a *read* map served lock-free and a *dirty* map for fresh writes. The lock-free read path is faster than `RWMutex.RLock` for high-concurrency lookups.

For a TTL cache where reads vastly outnumber writes (typical 95/5 split), `sync.Map` can beat `map + RWMutex` by 2–3× on reads. The catch: writes are slower, and iteration (`Range`) is awkward and only loosely consistent.

The minimum `sync.Map`-backed TTL cache:

```go
package cache

import (
    "sync"
    "time"
)

type syncMapEntry struct {
    value     string
    expiresAt time.Time
}

type SyncMapCache struct {
    data sync.Map // string -> syncMapEntry
    ttl  time.Duration
}

func (c *SyncMapCache) Set(key, value string) {
    c.data.Store(key, syncMapEntry{
        value:     value,
        expiresAt: time.Now().Add(c.ttl),
    })
}

func (c *SyncMapCache) Get(key string) (string, bool) {
    v, ok := c.data.Load(key)
    if !ok {
        return "", false
    }
    e := v.(syncMapEntry)
    if time.Now().After(e.expiresAt) {
        c.data.Delete(key) // safe; sync.Map handles concurrent delete
        return "", false
    }
    return e.value, true
}

func (c *SyncMapCache) Delete(key string) {
    c.data.Delete(key)
}
```

What we lost: efficient sweep. `sync.Map.Range` is allowed to skip newly-added keys, may visit deleted keys, and provides no progress guarantees. Walking `sync.Map` for sweeping is slower than walking a plain `map`, and you cannot iterate while holding "the" lock because there is no single lock.

The conclusion most engineers reach: **`sync.Map` is excellent for the read path but a poor fit for sweeping**. The natural composition is "use `sync.Map` for reads, drive eviction through an external structure (a heap) that the sweeper owns."

---

## Combining `sync.Map` with a Heap

The hybrid layout:

```
+---------------------+        +-----------------------+
|  sync.Map           |        |  expirationHeap       |
|  (key -> entry)     |        |  (priority queue of   |
|  served lock-free   |        |   expiration items)   |
+---------------------+        +-----------------------+
        ^                                 ^
        |                                 |
        | Reads / Writes / Deletes        | Sweeper only
        |                                 |
   application code                  sweeper goroutine
```

Reads go to `sync.Map`. Writes go to *both* (insert into `sync.Map`, push onto heap). The sweeper pops items from the heap whose `expiresAt` has passed, verifies via `sync.Map.Load` that the entry is still the latest (matching expiration), and `Delete`s if so.

Sketch:

```go
type entry struct {
    value     string
    expiresAt time.Time
}

type HybridCache struct {
    data sync.Map
    heap *minHeap     // protected by heapMu
    heapMu sync.Mutex

    timer *time.Timer
    stop  chan struct{}
}

func (c *HybridCache) Set(key, value string, ttl time.Duration) {
    e := entry{value: value, expiresAt: time.Now().Add(ttl)}
    c.data.Store(key, e)

    c.heapMu.Lock()
    c.heap.push(&heapItem{key: key, expiresAt: e.expiresAt})
    c.rescheduleLocked()
    c.heapMu.Unlock()
}

func (c *HybridCache) Get(key string) (string, bool) {
    v, ok := c.data.Load(key)
    if !ok {
        return "", false
    }
    e := v.(entry)
    if time.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}

func (c *HybridCache) evict() {
    now := time.Now()
    c.heapMu.Lock()
    defer c.heapMu.Unlock()
    for c.heap.len() > 0 && !c.heap.peek().expiresAt.After(now) {
        item := c.heap.pop()
        if v, ok := c.data.Load(item.key); ok {
            e := v.(entry)
            // Only delete if the heap item matches the current entry's expiration.
            if e.expiresAt.Equal(item.expiresAt) {
                c.data.Delete(item.key)
            }
        }
    }
    c.rescheduleLocked()
}
```

Trade-offs:

- Hot path (`Get`) is lock-free. Excellent throughput.
- `Set` now takes a mutex (for the heap) on every call. Worse than the pure `sync.Map` approach.
- The heap grows on every `Set`, even when overwriting; stale entries are dropped lazily by the sweeper.

For workloads with ~10:1 read:write, the hybrid wins clearly. For write-heavy workloads, the heap mutex starts to dominate; a sharded heap or per-shard cache (senior level) becomes necessary.

---

## Batched Sweeps

A complementary technique: instead of holding the lock for one long sweep that visits every entry, do many short sweeps that release the lock between batches.

```go
func (c *Cache) batchedSweep(batchSize int) {
    for {
        now := time.Now()
        c.mu.Lock()
        evicted := 0
        // Snapshot up to batchSize keys to check this round.
        snapshot := make([]string, 0, batchSize)
        for k := range c.data {
            snapshot = append(snapshot, k)
            if len(snapshot) >= batchSize {
                break
            }
        }
        for _, k := range snapshot {
            if e, ok := c.data[k]; ok && now.After(e.expiresAt) {
                delete(c.data, k)
                evicted++
            }
        }
        done := evicted == 0 // crude termination
        c.mu.Unlock()
        if done {
            return
        }
        // Let other goroutines breathe before the next batch.
        runtime.Gosched()
    }
}
```

This is a deliberate trade: total wall-clock time of the sweep increases (more lock acquire/release cycles), but the *maximum* lock-held duration drops. p99 of reader latency improves dramatically.

A subtlety: ranging over a Go map gives keys in randomised order, so successive batches do not consistently cover the entire map. To guarantee full coverage you must keep a per-sweep iterator state. For a cache built on a heap, this problem disappears — the heap itself imposes order and the sweeper visits items in expiration order.

---

## Time-Budgeted Sweeps

A variant of batched sweeps: limit by *time*, not count.

```go
func (c *Cache) sweepWithBudget(budget time.Duration) {
    deadline := time.Now().Add(budget)
    for time.Now().Before(deadline) {
        c.mu.Lock()
        progress := false
        for k, e := range c.data {
            if time.Now().After(e.expiresAt) {
                delete(c.data, k)
                progress = true
            }
            if time.Now().After(deadline) {
                break
            }
        }
        c.mu.Unlock()
        if !progress {
            return
        }
        runtime.Gosched()
    }
}
```

This produces a sweeper that "does its best in N milliseconds and then yields." Useful when you have a hard p99 latency budget — the sweeper provably cannot stall any reader for more than the budget plus one operation.

The cost: very large caches may grow arrears (the sweeper cannot keep up). Pair with metrics to detect "sweeper-falling-behind" so you can alert.

---

## Jittered TTL

A perfectly synchronised cache is a *bad* cache. When you insert 100,000 entries at the same instant with the same TTL, they all expire in the same instant. The next reader for any of them triggers a miss; if your service is busy, dozens or hundreds of expirations land in the same microsecond and the upstream is hit by a wave.

The fix: add a small random offset to each TTL.

```go
import "math/rand/v2"

func (c *Cache) Set(key, value string) {
    jitter := time.Duration(rand.Int64N(int64(c.jitterMax)))
    expiresAt := time.Now().Add(c.ttl + jitter)
    // ...
}
```

A typical jitter is 10% of the TTL: for `ttl=60s`, jitter is 0–6 s. Entries inserted at t=0 expire scattered between t=60 and t=66 instead of all at t=60.

Why does this work? Because the work the upstream does during a herd is dominated by the *coincidence* of misses. Spreading misses out by 6 seconds reduces the peak rate of upstream calls by roughly a factor of `peakRate / 6s` — orders of magnitude in practice.

The cost of jitter is tiny — at most 10% extra staleness for the average entry. For most applications this is invisible.

**Direction of jitter.** You can add jitter to the high side (longer life) or the low side (shorter life). Adding to the high side is conservative — entries live at least as long as the nominal TTL. Adding to the low side means entries may expire early, but you can use it to randomise *refreshes* without changing the cache's "freshness guarantee." Pick based on which property matters more.

---

## Thundering Herds in Detail

Let us look at the herd mechanism carefully because it is the most consequential subtle failure mode in caching.

The setup:

- Hot key `K` is cached. TTL = 60 s.
- At time `t`, the entry expires.
- At time `t`, 5,000 requests for `K` arrive concurrently.

In the junior cache, every request:

1. Calls `Get("K")` — miss.
2. Calls upstream — which takes 50 ms.
3. Calls `Set("K", v)`.

Steps 1 and 3 are fast. Step 2 is what hurts. With 5,000 concurrent step-2 calls, the upstream sees 5,000× its normal QPS and probably falls over. Worst case: the upstream's threads get tied up, latency explodes, and *every* downstream service that depends on it degrades.

This is "thundering herd," "stampede," "dog-pile," "cache stampede" — all the same phenomenon. Three classes of fix:

1. **Singleflight.** Only one in-flight request per key; others wait for its result.
2. **Refresh-ahead.** Refresh hot keys *before* they expire so misses never happen for them.
3. **Stale-while-revalidate.** Serve a stale value while a single goroutine refreshes in the background.

Each has its place. Singleflight is the universal first defence.

---

## `singleflight` to the Rescue

`golang.org/x/sync/singleflight` is a small package — about 200 lines — that solves exactly this problem. It exposes one type, `Group`, with one main method:

```go
func (g *Group) Do(key string, fn func() (interface{}, error)) (v interface{}, err error, shared bool)
```

Semantics: if multiple goroutines call `Do` with the same key simultaneously, only the first goroutine actually executes `fn`. The others block until `fn` returns and receive the same result.

Integration with a TTL cache:

```go
package cache

import (
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type LoaderCache struct {
    mu    sync.RWMutex
    data  map[string]entry
    ttl   time.Duration
    group singleflight.Group
    load  func(key string) (string, error)
}

type entry struct {
    value     string
    expiresAt time.Time
}

func (c *LoaderCache) Get(key string) (string, error) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        return e.value, nil
    }

    v, err, _ := c.group.Do(key, func() (interface{}, error) {
        // Re-check under singleflight in case another goroutine just filled it.
        c.mu.RLock()
        e, ok := c.data[key]
        c.mu.RUnlock()
        if ok && time.Now().Before(e.expiresAt) {
            return e.value, nil
        }
        val, err := c.load(key)
        if err != nil {
            return "", err
        }
        c.mu.Lock()
        c.data[key] = entry{value: val, expiresAt: time.Now().Add(c.ttl)}
        c.mu.Unlock()
        return val, nil
    })
    if err != nil {
        return "", err
    }
    return v.(string), nil
}
```

Now if 5,000 goroutines simultaneously miss on `K`, only one calls `load`. The other 4,999 wait inside `Do` and receive the loaded value when it returns. Upstream QPS for `K` drops from 5,000 to 1.

The cost is small:

- An extra map (`singleflight.Group`'s internal calls map).
- A goroutine-yield per waiting goroutine.
- Slight bookkeeping inside `Do`.

**Edge case: `load` panics.** `Do` recovers the panic and re-panics in the caller's goroutine. All waiting goroutines receive the same panic. You may want to wrap your `load` in defensive code.

**Edge case: `load` returns an error.** All waiting goroutines receive that same error. Decision: do you cache the error (negative caching) or let the next reader retry? Discussed below.

**Edge case: stale results.** If `load` takes 5 s and 5,000 readers are waiting, the result they receive is up to 5 s "old" by the time they see it. For most caching purposes this is fine; for time-sensitive operations, beware.

**Forget(key).** `Do` keeps the call alive until it returns. If you want to *cancel* an in-flight call for a key (because, say, you just received a `Delete`), call `Forget(key)`. Subsequent calls will start a fresh `Do` instead of joining the old one.

---

## Negative Caching

What happens when `load` returns "not found" or another well-defined error? Three options:

1. **Do not cache.** Every miss re-calls `load`. If the key really does not exist, every reader pays the full cost.
2. **Cache the absence.** Store a sentinel "miss" entry with a (usually shorter) TTL. Readers see the sentinel and return "not found" without calling `load`.
3. **Cache the error.** Same as 2, but distinguish "not found" from "load failed."

Option 2 is the typical choice for DNS-like lookups: cache successes for `successTTL` (e.g. 60 s) and absences for `negativeTTL` (e.g. 5 s). The shorter negative TTL guards against "the key was just created elsewhere and I'm caching a no for too long."

Sketch:

```go
type entry struct {
    value     string
    found     bool
    expiresAt time.Time
}

func (c *Cache) Get(k string) (string, bool, error) {
    c.mu.RLock()
    e, ok := c.data[k]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        return e.value, e.found, nil
    }
    v, found, err := c.load(k) // load returns ("", false, nil) for "not found"
    if err != nil {
        return "", false, err
    }
    ttl := c.successTTL
    if !found {
        ttl = c.negativeTTL
    }
    c.mu.Lock()
    c.data[k] = entry{value: v, found: found, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
    return v, found, nil
}
```

Negative caching especially helps when an attacker can probe for non-existent keys: without it, every probe is a full upstream call.

---

## Stale-While-Revalidate

A pattern borrowed from HTTP caching (RFC 5861). The cache serves the *stale* value to readers while spawning a background refresh. Readers never see a miss; the cache transitions from "fresh" → "stale, serving but refreshing" → "fresh" in the background.

Sketch:

```go
type entry struct {
    value      string
    freshUntil time.Time
    staleUntil time.Time
    refreshing atomic.Bool
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.staleUntil) {
        return "", false // genuine miss
    }
    if time.Now().After(e.freshUntil) {
        // Stale — serve but trigger background refresh.
        if e.refreshing.CompareAndSwap(false, true) {
            go c.refresh(k)
        }
    }
    return e.value, true
}

func (c *Cache) refresh(k string) {
    defer func() {
        c.mu.Lock()
        if e, ok := c.data[k]; ok {
            e.refreshing.Store(false)
            c.data[k] = e
        }
        c.mu.Unlock()
    }()
    v, err := c.load(k)
    if err != nil {
        return // keep serving stale
    }
    c.mu.Lock()
    now := time.Now()
    c.data[k] = entry{
        value:      v,
        freshUntil: now.Add(c.freshTTL),
        staleUntil: now.Add(c.freshTTL + c.staleWindow),
    }
    c.mu.Unlock()
}
```

The reader's worst-case latency is now `O(map lookup)`, never `O(upstream call)`. The cost: callers may see data up to `freshTTL + staleWindow` old when the upstream is slow.

Variant: combine with singleflight to ensure only one background refresh per key. Without it, `CompareAndSwap` already prevents *concurrent* refreshes for a key, but you still spawn a fresh goroutine per stale read.

---

## Deep Dive: SWR Edge Cases

Stale-while-revalidate sounds simple but has interesting edge cases.

**Edge 1: refresh fails.** What if `loader` errors during background refresh? We must decide:

- Keep serving stale forever? Eventually wrong.
- Stop serving stale immediately? Forces a synchronous reload on next reader.
- Extend stale window briefly, retry? Most robust.

Typical: extend the stale window for a small "grace period" (e.g. 10 s) and try again. After N failed attempts, evict.

**Edge 2: refresh storms.** If 1,000 readers see the same stale entry within microseconds, the `refreshing.CompareAndSwap` ensures only one wins the right to refresh. Good. But the other 999 returns are happening concurrently with one in-flight refresh — fine.

**Edge 3: refresh completes after invalidation.** Reader B calls `Invalidate(k)` while goroutine A is mid-refresh. When A returns, it overwrites the just-invalidated entry. Solutions:

- Check inside the refresh callback whether the key is still wanted.
- Use a generation counter; refresh only commits if its generation matches.

**Edge 4: client cancellation.** If the request that triggered the stale-read is cancelled, the refresh goroutine still runs to completion. This is generally desired (the next request benefits) but can hide bugs in tests.

These are not deal-breakers — SWR is a hugely valuable pattern — but you must think about each before shipping.

---

## Refresh-Ahead

A more proactive pattern. The cache schedules a background refresh some fraction (say, 80%) of the way through each TTL.

```go
func (c *Cache) Set(k, v string) {
    expiresAt := time.Now().Add(c.ttl)
    refreshAt := time.Now().Add(time.Duration(float64(c.ttl) * 0.8))
    c.mu.Lock()
    c.data[k] = entry{value: v, expiresAt: expiresAt}
    c.mu.Unlock()
    time.AfterFunc(time.Until(refreshAt), func() {
        if !c.stillNeeded(k) {
            return
        }
        if v, err := c.load(k); err == nil {
            c.Set(k, v)
        }
    })
}
```

Pros: hot keys are kept warm; misses are rare even at TTL boundaries.

Cons: every Set spawns a timer. For 1M entries, you have 1M pending timers. The Go runtime handles them efficiently (single heap), but the memory adds up. Better: refresh only keys with recent read activity.

Refresh-ahead is most appealing when the working set is small and the upstream is reliable.

---

## Deep Dive: Refresh-Ahead vs Soft TTL

Some literature calls "refresh-ahead" by the alias "soft TTL." The pattern:

- Each entry has a **soft TTL** (`refreshAt`) and a **hard TTL** (`expiresAt`).
- Reads before `refreshAt`: just return. No background work.
- Reads between `refreshAt` and `expiresAt`: serve the value AND schedule a background refresh.
- Reads after `expiresAt`: synchronous refresh (miss).

The combined behaviour:

- Hot keys are refreshed in the background and never miss synchronously.
- Cold keys (read once, then forgotten) miss on the first read after `expiresAt` but waste no background work.

Implementation is essentially `SWR + per-read trigger`:

```go
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.hardExpiresAt) {
        return "", false
    }
    if time.Now().After(e.softExpiresAt) {
        if e.refreshing.CompareAndSwap(false, true) {
            go c.refresh(k)
        }
    }
    return e.value, true
}
```

A reasonable choice of `softExpiresAt` is ~70-80% of the way through the hard TTL. Tune by measuring how often readers fall into the "synchronous miss" path.

---

## Eviction Policies Overview

So far our cache has no size bound. Real production caches do. The standard policies:

- **LRU (Least Recently Used).** Evict the entry that has not been accessed for the longest time. Implementation: doubly-linked list + map.
- **LFU (Least Frequently Used).** Evict the entry with the lowest access count. Implementation: priority queue + map.
- **FIFO (First In, First Out).** Evict the oldest entry by insertion order. Simplest.
- **Random.** Evict a uniformly-random entry. Surprisingly competitive in many workloads.
- **TinyLFU.** Probabilistic admission with frequency sketches. Used by `ristretto`. State-of-the-art for many workloads.

For TTL caches, eviction kicks in when the cache hits its size cap *before* entries naturally expire. Without size bounds, eviction is only ever driven by TTL.

The classic "TTL + LRU" combination — exemplified by `hashicorp/golang-lru/v2/expirable` — is the dominant choice in production Go services because:

- TTL handles the "data went stale" problem.
- LRU handles the "data has not been used in a while" problem.
- Together they bound both *staleness* and *size*.

Detailed eviction policies are the subject of the *next* subsection (LRU concurrent caches). Here we cover only the bare minimum needed to bound a TTL cache's size.

---

## Implementing a Bounded TTL Cache

The simplest bound is "cap entry count and drop randomly when over." It is not the most efficient eviction policy but it is dead simple:

```go
func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if _, ok := c.data[k]; !ok && len(c.data) >= c.maxEntries {
        // Drop one random entry.
        for randomKey := range c.data {
            delete(c.data, randomKey)
            break
        }
    }
    c.data[k] = entry{value: v, expiresAt: time.Now().Add(c.ttl)}
}
```

Map iteration order in Go is randomised, so `for k := range c.data { delete; break }` actually drops a random entry — no extra randomness needed.

Better policies require auxiliary data structures (linked list for LRU; heap or sketch for LFU). For production-quality bounded caches, prefer a library like `ristretto` or `hashicorp/golang-lru` that has thought through the trade-offs.

---

## Choosing Between `ristretto`, `bigcache`, and `freecache`

Three of the most popular high-performance Go caches. They make very different trade-offs.

### `ristretto`

```go
import "github.com/dgraph-io/ristretto"

cache, err := ristretto.NewCache(&ristretto.Config{
    NumCounters: 1e7,     // number of keys to track frequency of (10× cache size)
    MaxCost:     1 << 30, // maximum cost of cache (1 GB)
    BufferItems: 64,      // number of keys per Get buffer
})
if err != nil {
    log.Fatal(err)
}
cache.SetWithTTL("k", "v", 1, time.Minute) // (key, value, cost, ttl)
cache.Wait()
v, ok := cache.Get("k")
```

Internals:

- TinyLFU admission policy with a count-min sketch for frequency estimation.
- Sharded internal storage with low contention.
- Async metadata updates via batched ring buffers (`BufferItems`).
- Sampled LRU eviction within shards.
- Cost-based bounds (not entry count) — you pay attention to *value size* rather than just *count*.

When to use ristretto:

- Read-heavy workloads with diverse keys.
- You want sophisticated admission to keep one-hit-wonders out.
- You can express bounds as memory cost rather than item count.
- You can tolerate eventually-consistent stats and slightly delayed writes.

When *not* to use it:

- Strict consistency requirements ("a Set must be visible to the next Get" is *not* guaranteed without `Wait()`).
- Very small caches where the metadata overhead dominates.
- You need to iterate the cache contents reliably.

### `bigcache`

```go
import "github.com/allegro/bigcache/v3"

cache, err := bigcache.New(context.Background(), bigcache.DefaultConfig(10*time.Minute))
if err != nil {
    log.Fatal(err)
}
_ = cache.Set("k", []byte("v"))
v, err := cache.Get("k")
```

Internals:

- Shards (default 1,024) each protected by its own mutex.
- Each shard holds keys/values in a single contiguous byte slice — a giant ring buffer per shard.
- No per-entry GC overhead because all entries live inside `[]byte`s and the GC sees a single allocation per shard.
- TTL applies cache-wide; entries are evicted FIFO within their shard when the buffer fills.

When to use bigcache:

- Huge caches (hundreds of millions of entries).
- You can serialise values to `[]byte` cheaply.
- GC pause is more concerning than CPU.
- A simple FIFO/TTL policy is acceptable.

When *not* to use it:

- You need LRU or LFU.
- Values are large pointers/structs (the serialisation cost is bad).
- You need per-entry TTLs.

### `freecache`

```go
import "github.com/coocood/freecache"

cache := freecache.NewCache(100 * 1024 * 1024) // 100 MB
_ = cache.Set([]byte("k"), []byte("v"), 60) // ttl in seconds
v, err := cache.Get([]byte("k"))
```

Internals:

- Fixed-size memory pool divided into 256 segments.
- Each segment is a circular ring of slot tables + data blocks.
- All keys and values live as `[]byte` inside the pool.
- LRU eviction within a segment.
- Zero GC pressure (entire pool is one allocation).

When to use freecache:

- Memory-strict environments (fixed cap, no surprises).
- Very high throughput where every allocation matters.
- Simple key/value semantics.
- Per-entry TTL with seconds-resolution is enough.

### Side-by-side

| Feature | `ristretto` | `bigcache` | `freecache` |
|---|---|---|---|
| Admission policy | TinyLFU | None | None |
| Eviction | Sampled LRU | FIFO | LRU per segment |
| TTL granularity | per-entry | cache-wide | per-entry (seconds) |
| Value type | interface{} | []byte | []byte |
| GC overhead | low | very low | very low |
| Sharding | yes | yes (1024 default) | yes (256 segments) |
| Best at | smart admission | huge entry counts | strict memory budget |

For a generic backend service, start with `ristretto` unless you specifically need the GC properties of `bigcache` or `freecache`. The TinyLFU admission policy keeps the cache "smart" without manual tuning, which is the single biggest win.

---

## Observability: Hits, Misses, and Latency Histograms

A cache without metrics is a cache you cannot improve. At the middle level, you should expose at least:

- `cache_hits_total{cache="name"}` — counter
- `cache_misses_total{cache="name"}` — counter
- `cache_evictions_total{cache="name", reason="expired|capacity|explicit"}` — counter
- `cache_size{cache="name"}` — gauge
- `cache_get_duration_seconds{cache="name"}` — histogram
- `cache_load_duration_seconds{cache="name"}` — histogram (for loader-based caches)

The `reason` label on evictions is essential. Knowing that 99% of evictions are TTL-driven versus capacity-driven tells you whether to tune TTL or grow the cache.

A simple Prometheus-style integration:

```go
import (
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

type Metrics struct {
    Hits   prometheus.Counter
    Misses prometheus.Counter
    GetDur prometheus.Histogram
}

func (c *Cache) Get(key string) (string, bool) {
    start := time.Now()
    defer func() {
        c.metrics.GetDur.Observe(time.Since(start).Seconds())
    }()
    // ... existing logic ...
}
```

Add load metrics on the loader path:

```go
v, err, _ := c.group.Do(key, func() (interface{}, error) {
    loadStart := time.Now()
    val, err := c.load(key)
    c.metrics.LoadDur.Observe(time.Since(loadStart).Seconds())
    return val, err
})
```

The histogram of `LoadDur` tells you what your *p99 origin call* looks like, which directly informs how much singleflight is saving you.

---

## Distributed Caches Briefly Considered

In-process caches are great until you scale out. Once you run multiple replicas:

- Each replica caches independently. Hit ratio is replica-local.
- A cold replica (just started, or after deploy) hammers the upstream until its cache warms up.
- Invalidations are hard. Deleting a key on replica A does nothing for replicas B, C, D.

Some patterns to bridge to senior/professional content:

1. **Sticky routing.** Route requests for the same key to the same replica. The cache becomes effectively global. Cost: load imbalance, complex routing.
2. **Two-tier (L1/L2).** L1 = in-process cache (fast, small). L2 = Redis or similar (shared, larger). L1 absorbs the hot keys; L2 absorbs the long tail. Discussed at the professional level.
3. **Pub/sub invalidation.** When a key changes, broadcast a "drop this key" message on a channel that all replicas subscribe to. Each replica drops its local entry.
4. **Just use Redis.** For many services, the simplest answer.

This middle file does not cover distributed caches in depth — that is the senior file's job. But you should know that the assumption "all reads go through one process" stops holding the moment you autoscale.

---

## Deep Dive: Distributed Pub/Sub Invalidation

When you go from 1 replica to N, in-process caches duplicate work. When key K changes on replica A, replicas B, C, D still serve the old value until their TTLs expire.

The fix: a pub/sub channel.

```go
import "github.com/redis/go-redis/v9"

type Cache struct {
    local *LocalCache
    rdb   *redis.Client
}

func (c *Cache) Set(k, v string) {
    c.local.Set(k, v)
    // Tell other replicas to drop their local copy.
    c.rdb.Publish(ctx, "invalidations", k)
}

func (c *Cache) listen() {
    sub := c.rdb.Subscribe(ctx, "invalidations")
    for msg := range sub.Channel() {
        c.local.Delete(msg.Payload)
    }
}
```

When replica A publishes "K," all other replicas drop their local entry for K. The next read on those replicas misses and refetches the fresh value.

Pitfalls:

- The publishing replica also receives its own message (some pub/sub systems echo). Ignore self-published messages by including a replica ID.
- Message loss: pub/sub does not guarantee delivery. A replica that disconnects misses messages and serves stale data until reconnect. Mitigate with a periodic full resync.
- Ordering: messages may arrive out of order. For idempotent "delete K" messages, this is fine. For more complex invalidations, you need versioning.

This is a senior topic; we mention it here to flesh out the migration story.

---

## Cache Warming Strategies

When a replica boots, its cache is empty. The first wave of requests all miss. If your upstream cannot handle the load, you have a cold-start failure mode.

Three strategies:

1. **Lazy warming.** Do nothing special; the cache fills up as requests arrive. Acceptable if upstream can absorb the burst.
2. **Snapshot/restore.** Periodically serialise the cache to disk or external storage; on boot, load the snapshot. Cache starts warm. Cost: snapshot management, staleness on restore.
3. **Replay warming.** On boot, read a list of "always-hot" keys from configuration and prefetch them. The application knows what is hot; cache does not need to discover it.

A practical compromise: lazy warming protected by singleflight. The first request for `K` after boot will trigger one upstream call; the next 999 requests in the next 50 ms will all wait for that one call. Cold-start damage is reduced to "exactly one upstream call per hot key."

---

## Deep Dive: Cache-Aside vs Read-Through vs Write-Through

Three classical caching topologies. Each shapes your TTL cache differently.

### Cache-aside

The application controls the cache; the cache does not know about the upstream:

```go
v, ok := cache.Get(k)
if !ok {
    v = upstream.Load(k)
    cache.Set(k, v)
}
```

Pros: simple, no coupling. Cons: stampedes (every caller calls upstream) unless you add singleflight.

### Read-through

The cache knows how to fetch from the upstream:

```go
v := cache.GetOrLoad(k) // cache calls loader internally
```

Pros: centralised stampede protection, easier to test. Cons: the cache is now coupled to the storage layer.

All our middle-level examples (LoaderCache, dbcache, dnscache) are read-through. This is the modern best practice.

### Write-through

Writes go to the cache *and* the upstream synchronously:

```go
cache.Set(k, v); upstream.Save(k, v)
```

Or, the cache forwards writes itself. Pros: cache is always consistent. Cons: write latency is upstream latency.

Cousin: **write-behind** (write to cache immediately, write to upstream asynchronously). Faster writes; risk of data loss on crash.

Most TTL caches are read-only with respect to the upstream — you do not write to a TTL cache and expect persistence. For backend services this is the right model. When you need write-through, consider whether the cache is the right primitive or whether you actually need a database with a cache in front of it.

---

## Cache Stampede Patterns Beyond Single-Flight

Singleflight is a sledgehammer; sometimes you want a scalpel.

**Probabilistic early expiration.** A fraction of readers treat the entry as "about to expire" and refresh it early. Stagger the refresh across the population to avoid the all-at-once herd.

```go
// Refresh probability grows as we approach expiry.
func shouldRefreshEarly(now, expiresAt time.Time, ttl time.Duration) bool {
    remaining := expiresAt.Sub(now)
    p := 1.0 - float64(remaining)/float64(ttl)
    if p <= 0 {
        return true
    }
    return rand.Float64() < p*0.05 // tune the 0.05
}
```

The classic implementation is "XFetch" by Vattani et al. (2015) — a small academic paper worth reading.

**Lock-then-fetch.** Like singleflight but with a hold time: only allow one refresh per key per second, no matter how many readers are waiting. Helps when the upstream itself takes seconds and you do not want multiple refresh attempts in that window.

**Two-stage caching.** A short-TTL L1 cache "absorbs" rapid bursts; a long-TTL L2 cache provides durability. Reads check L1 first; misses check L2; misses there call upstream. The herd is split between layers and the upstream sees at most one call per L2 TTL window.

---

## Deep Dive: Combining Heap + Singleflight + Jitter

Putting the three primary mid-level techniques together looks like this:

```go
package cache

import (
    "container/heap"
    "math/rand/v2"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type item struct {
    key       string
    expiresAt time.Time
    index     int
}

type expHeap []*item

func (h expHeap) Len() int            { return len(h) }
func (h expHeap) Less(i, j int) bool  { return h[i].expiresAt.Before(h[j].expiresAt) }
func (h expHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *expHeap) Push(x any)         { it := x.(*item); it.index = len(*h); *h = append(*h, it) }
func (h *expHeap) Pop() any {
    old := *h; n := len(old); it := old[n-1]; old[n-1] = nil; it.index = -1
    *h = old[:n-1]; return it
}

type entry struct {
    value     string
    expiresAt time.Time
    heapItem  *item
}

type Cache struct {
    mu          sync.Mutex
    data        map[string]entry
    heap        expHeap
    ttl         time.Duration
    jitter      time.Duration
    loader      func(string) (string, error)
    group       singleflight.Group
    timer       *time.Timer
    stop        chan struct{}
    stopOnce    sync.Once
    done        chan struct{}
}

func New(ttl, jitter time.Duration, loader func(string) (string, error)) *Cache {
    c := &Cache{
        data:   make(map[string]entry),
        ttl:    ttl,
        jitter: jitter,
        loader: loader,
        stop:   make(chan struct{}),
        done:   make(chan struct{}),
    }
    heap.Init(&c.heap)
    c.timer = time.NewTimer(time.Hour)
    if !c.timer.Stop() {
        <-c.timer.C
    }
    go func() {
        defer close(c.done)
        c.run()
    }()
    return c
}

func (c *Cache) Get(key string) (string, error) {
    c.mu.Lock()
    e, ok := c.data[key]
    if ok && time.Now().Before(e.expiresAt) {
        c.mu.Unlock()
        return e.value, nil
    }
    c.mu.Unlock()

    v, err, _ := c.group.Do(key, func() (interface{}, error) {
        // Re-check.
        c.mu.Lock()
        e, ok := c.data[key]
        if ok && time.Now().Before(e.expiresAt) {
            c.mu.Unlock()
            return e.value, nil
        }
        c.mu.Unlock()

        val, err := c.loader(key)
        if err != nil {
            return "", err
        }
        c.set(key, val)
        return val, nil
    })
    if err != nil {
        return "", err
    }
    return v.(string), nil
}

func (c *Cache) set(key, value string) {
    jit := time.Duration(0)
    if c.jitter > 0 {
        jit = time.Duration(rand.Int64N(int64(c.jitter)))
    }
    expiresAt := time.Now().Add(c.ttl + jit)
    c.mu.Lock()
    defer c.mu.Unlock()
    if old, ok := c.data[key]; ok && old.heapItem != nil {
        heap.Remove(&c.heap, old.heapItem.index)
    }
    it := &item{key: key, expiresAt: expiresAt}
    heap.Push(&c.heap, it)
    c.data[key] = entry{value: value, expiresAt: expiresAt, heapItem: it}
    c.rescheduleLocked()
}

func (c *Cache) rescheduleLocked() {
    if !c.timer.Stop() {
        select {
        case <-c.timer.C:
        default:
        }
    }
    if len(c.heap) == 0 {
        return
    }
    delay := time.Until(c.heap[0].expiresAt)
    if delay < 0 {
        delay = 0
    }
    c.timer.Reset(delay)
}

func (c *Cache) run() {
    for {
        select {
        case <-c.timer.C:
            c.evictExpired()
        case <-c.stop:
            return
        }
    }
}

func (c *Cache) evictExpired() {
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    for len(c.heap) > 0 && !c.heap[0].expiresAt.After(now) {
        it := heap.Pop(&c.heap).(*item)
        if e, ok := c.data[it.key]; ok && e.heapItem == it {
            delete(c.data, it.key)
        }
    }
    c.rescheduleLocked()
}

func (c *Cache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

This is the canonical "middle-grade" production cache shape. About 150 lines. It scales to millions of entries (the heap is `O(log N)`), absorbs traffic spikes (singleflight), avoids batch-expiry herds (jitter), and shuts down cleanly. It still lacks bounded size (the LRU subsection adds that) and shard-based locking (the senior file adds that), but for most services it is enough.

---

## Testing at the Middle Level

Beyond the basic tests in the junior file, you should now write:

- **Concurrency tests for singleflight.** Spawn N goroutines that all `Get("K")` at once after invalidating it; assert the loader was called exactly once.
- **Stampede tests.** Spawn N goroutines each looping 100 `Get` calls on a key whose TTL is 1 ms. Compare upstream-call count with and without singleflight; the latter should be 100,000×-ish lower.
- **Jitter histogram tests.** Insert 10,000 entries with jittered TTLs; bucket their expirations into 100 ms intervals; assert no bucket exceeds (e.g.) 5% of the total.
- **Sweep-budget tests.** Configure a sweep budget of 1 ms; run on a 1M-entry cache; assert that no `Get` takes longer than 1.5 ms even during sweep.
- **Eviction-policy tests.** Insert N+1 entries into a cap-N cache; assert the right one was evicted (random for our naive policy, recency-based for LRU, etc).

Tests for time-based behaviour benefit greatly from the injected-clock pattern. Tests for singleflight do not need fake time — they need many goroutines.

---

## Deep Dive: Singleflight Pitfalls in Detail

Singleflight is one of those tools that "just works" most of the time and then bites you in a specific scenario. Here are the ones to know.

### Pitfall A: Long-running loaders block waiters

If `loader` takes 30 seconds, every waiter blocks for 30 seconds — not just the initiator. There is no per-caller timeout in `Do`. Either:

- Use `DoChan` and combine with context, or
- Wrap the loader in a context-aware wrapper so it gives up after a deadline, or
- Use a deadline-aware loader internally.

### Pitfall B: Error caching

If `loader` returns an error, *every* waiter gets that error. Including waiters who arrived after the first batch. If your loader returns "temporary failure," 1,000 waiters all see "temporary failure" — and the next caller probably also sees it.

Combine singleflight with negative caching to avoid retry storms:

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    val, err := load(key)
    if err != nil {
        // Brief negative cache to prevent immediate retry storm.
        c.setNegative(key, time.Second)
    }
    return val, err
})
```

### Pitfall C: Forgetting Forget()

If a caller invalidates a key while a load is in flight, the load completes and may overwrite the (now-stale) value. Call `g.Forget(key)` before invalidation:

```go
func (c *Cache) Invalidate(k string) {
    c.group.Forget(k)
    c.mu.Lock()
    delete(c.data, k)
    c.mu.Unlock()
}
```

The order matters slightly: `Forget` first so concurrent waiters see a fresh state.

### Pitfall D: Singleflight + context cancellation

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()

v, err, _ := g.Do(key, func() (interface{}, error) {
    return loadWithContext(ctx, key) // uses outer ctx — but maybe shared with siblings!
})
```

If two callers join the same `Do`, the loader uses *the first caller's* context. If the first caller is cancelled, the loader is also cancelled — even though the second caller wants the result.

Fix: pass a non-cancellable context to the loader, or detach explicitly:

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    return loadWithContext(context.Background(), key)
})
```

### Pitfall E: Memory pressure from waiting goroutines

Every waiter holds a goroutine. If 1M readers wait on a slow loader, you have 1M goroutines (~2GB of stack) suspended. Mitigate with rate limits on concurrent `Get` calls or by using `DoChan` and a worker pool that handles requests.

---

## Common Mid-Level Mistakes

**Mistake 1: forgetting to release the lock around the loader.** A junior cache often holds the cache lock while calling the upstream:

```go
c.mu.Lock()
defer c.mu.Unlock()
if e, ok := c.data[k]; ok && !expired(e) { return e.value }
v := slowLoad(k) // <-- LOCK HELD!
c.data[k] = entry{value: v, ...}
```

Mid-level fix: release the lock around the slow call, accept that two goroutines may load duplicate work *or* use singleflight to coalesce.

**Mistake 2: singleflight without re-checking the cache.** Inside the `Do` callback, re-check the cache. Otherwise the second-to-arrive `Do` call (right after the first finishes) refetches the value redundantly.

**Mistake 3: storing pointers without copies.** With singleflight, the same value pointer is handed to N waiters. If any one of them mutates it, they all see the mutation. Document immutability or return copies.

**Mistake 4: heap entries never removed.** Strategy B from earlier: easy to write, but if you `Set` the same key a million times you have a million stale heap entries. Periodically rebuild the heap or use Strategy A.

**Mistake 5: jitter so large it breaks freshness SLO.** Jitter of 50% of TTL means some entries live 1.5× their nominal TTL. If your SLO is "cache stale by at most X," you must subtract jitter from the nominal TTL to stay within budget.

**Mistake 6: singleflight Forget() not called on Delete.** If you Delete a key while a `Do` is in flight, the waiters still get the about-to-be-stale value. Call `group.Forget(key)` in your Delete to abandon the inflight call.

**Mistake 7: refresh-ahead spawning a goroutine per Set.** Easy to do; rapidly becomes hundreds of thousands of goroutines. Replace with one shared scheduler.

---

## Deep Dive: How Singleflight Works Internally

`singleflight.Group` is small enough to read in one sitting. Its core data structure is a map of in-flight calls:

```go
type Group struct {
    mu sync.Mutex
    m  map[string]*call
}

type call struct {
    wg   sync.WaitGroup
    val  interface{}
    err  error
    dups int
    chans []chan<- Result
}
```

Behaviour of `Do(key, fn)`:

1. Lock the group mutex.
2. If `m[key]` exists, increment `dups`, unlock, wait on `c.wg.Wait()`, return the shared `val, err`.
3. Otherwise, create a new `call`, set `wg.Add(1)`, store it in `m[key]`, unlock.
4. Run `fn()` (no lock held).
5. Lock, store result on the call, delete from `m`, unlock.
6. Call `wg.Done()` — all waiting goroutines wake.
7. Return the result.

The whole thing is roughly 100 non-blank lines. Reading it is instructive because:

- You see why `fn` runs *without* the group mutex held — otherwise the second caller would deadlock with the first.
- You see why `m` is keyed by string — so callers can deduplicate by whatever they consider "the same call."
- You see how `DoChan` (a non-blocking variant returning a channel) is implemented on top of the same `call` struct.

There is no magic. The takeaway: when you find yourself wanting to coalesce identical concurrent calls in your own code, this exact pattern is straightforward to roll if you cannot pull in the `x/sync` dependency.

---

## Deep Dive: The `BufferItems` Mystery in `ristretto`

Many people read the ristretto config and wonder: "What is `BufferItems`?" It is one of the most under-documented but most important tuning knobs.

`ristretto` does *not* update access metadata synchronously on every `Get`. That would require taking a lock, which would defeat the whole point of a lock-free read path. Instead, every `Get` writes a small access record into a per-CPU ring buffer of size `BufferItems`. When the ring fills, the buffer is flushed asynchronously to the central metadata structures.

`BufferItems = 64` is the default. Setting it higher amortises lock acquisitions but delays metadata visibility (so eviction decisions are slightly out-of-date). Setting it lower reduces lag but increases lock pressure.

For most workloads, the default works well. Only tune when you have explicit measurements showing the central metadata lock is a bottleneck (visible in profiles as `sync.(*Mutex).Lock`).

The lesson: lock-free data structures often *do* take locks; they just do so out of the hot path. Understanding where the locks moved to is part of evaluating any "lock-free" library.

---

## Deep Dive: Wait() in ristretto

Another ristretto gotcha. `cache.Set(k, v, cost)` does not synchronously insert. The set goes through an admission gate (TinyLFU asks "is this key worth admitting?") and into an async update channel.

This means:

```go
cache.Set("k", "v", 1)
v, ok := cache.Get("k")
// ok may be false! The Set has not yet been processed.
```

Calling `cache.Wait()` blocks until all pending writes have been drained. In tests you almost always want this. In production hot paths, you almost never do.

The reason for this design: it allows ristretto to batch admission decisions and amortise the cost of TinyLFU updates. The trade-off is the lack of read-your-writes consistency.

If your application *requires* "write then immediately read returns the value," ristretto is the wrong cache. Use `hashicorp/golang-lru` instead, which is synchronous at the cost of more lock contention.

---

## Deep Dive: bigcache's GC-Free Promise

`bigcache` advertises "no GC pressure." Where does that property come from?

Each shard's entries are stored in a single `[]byte` — one giant allocation. The Go garbage collector treats `[]byte` as opaque: it scans the slice header (3 words) but not its contents. Compare with `map[string]*Entry`, where every key and every value pointer is scanned individually.

For a cache with 100 million small entries:

- `map[string][]byte` approach: 300 million pointers for the GC to scan on every cycle. GC pauses balloon.
- `bigcache` approach: 1024 shard byte slices, plus a small index per shard. GC pauses unaffected.

The price is that storing or reading a value requires serialisation (copy bytes into the buffer; copy bytes out). For values that already are `[]byte` (e.g. HTTP response bodies), this is free. For Go structs, you must encode/decode every access, which is often slower than the GC savings.

**Rule of thumb.** Use bigcache when:

1. Your entries are naturally `[]byte` (HTTP, gRPC, protobuf, JSON).
2. You have so many entries that GC time is a measured problem.
3. You can accept FIFO eviction within a shard.

For other cases, the GC savings are not worth the serialisation cost.

---

## Deep Dive: freecache's Segmented Memory Pool

`freecache` takes the bigcache idea one step further. Memory is a single pool divided into 256 segments. Each segment has:

- A slot table mapping `hash(key) % slotsPerSeg` to entry positions.
- A data ring buffer holding actual key/value bytes.
- Per-segment lock.

When the data ring fills, the oldest entries are evicted to make room. This gives LRU-within-a-segment behaviour.

Why 256 segments?

- 256 is small enough that the slot table fits in CPU cache.
- 256 is large enough that lock contention is rare (each shard handles 1/256 of traffic).
- 256 maps neatly to one byte of the hash, simplifying segment selection.

Why fixed memory pool?

- The pool is allocated once at startup; you never see a growing process.
- You know your maximum memory cost upfront — no surprises.
- The pool is one Go allocation; GC overhead is constant regardless of entry count.

Trade-off: you must size the pool correctly. Too small and you evict useful entries to make room. Too large and you waste memory. Picking the size is application-specific; start with "10× your expected hot working set."

---

## Deep Dive: When Heap Sweeps Beat Tick Sweeps

We have advocated for the heap-based sweeper. There is one case where ticking beats heap-based: **very high turnover with broadcast expiration**.

Example: a rate-limiter cache where every entry has the same 1-second TTL and entries flow in continuously. The heap would have constant churn (push every insert, pop every second). A simple tick that fires once per second and scans for expired entries is *less* overhead in absolute terms.

For caches where:

- Every entry has the same TTL, and
- Entries are inserted faster than they are read,

a ticking sweeper plus a circular buffer (entries indexed by "second of insertion") can beat a heap by 5-10×. This is the design of many rate limiters.

For caches where TTLs vary per entry, or where eviction order matters, the heap wins.

The general lesson: data-structure choice depends on the *shape* of the workload, not the abstract problem statement.

---

## Deep Dive: time.Timer vs time.Ticker for Sweeping

We have used both. They differ in subtle ways.

**`time.Ticker`.** Fires repeatedly at a fixed interval. If the receiver is slow, ticks are dropped — never queued. Cannot be re-armed at a different interval without `Reset(d)`. The classic loop:

```go
t := time.NewTicker(interval); defer t.Stop()
for {
    select {
    case <-t.C: doWork()
    case <-stop: return
    }
}
```

Suited for "periodic background work, regardless of state."

**`time.Timer`.** Fires once at a given delay. Can be re-armed via `Reset(d)`. After firing or `Stop`, you must drain `t.C` before `Reset` to avoid racing with a delivered-but-not-received tick:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(newDelay)
```

Suited for "wake at the next interesting moment, even if it changes."

For our heap-backed cache, `Timer` is the right choice because the next-expiration moment changes with every Set/Delete. For our junior cache, `Ticker` was fine because the interval was constant.

A subtle bug source: re-arming a `Timer` without draining its channel sometimes works (because the channel is buffered with capacity 1), but if a tick was already delivered into the channel and not received, the next `<-t.C` will pop the *old* tick — possibly causing a spurious immediate wakeup. The defensive pattern shown above prevents this.

---

## Deep Dive: Why `singleflight` Doesn't Cache

A common confusion: people think `singleflight` is a cache. It isn't. It deduplicates *in-flight* calls. Once the call returns, the deduplication ends — the next call with the same key will start a fresh in-flight call.

That is exactly why singleflight composes with a cache: the cache holds the result for some TTL, singleflight prevents simultaneous misses. Without the cache, every call would re-execute (after the first batch settles).

The chain:

1. Cache hit → return value.
2. Cache miss → call `singleflight.Do(key, loader)`.
3. `Do` returns → store result in cache.
4. Next reader: cache hit (until TTL).

Use them together, never one without the other.

---

## Deep Dive: Singleflight and Context Cancellation

What if the goroutine that initiated the `Do` call is cancelled (its context times out, the request is aborted)? Does the `Do` call get cancelled?

**No.** `Do` runs to completion regardless of the caller's context. The other waiters still get the result.

If you want cancellation semantics, use `DoChan` and select on context:

```go
ch := group.DoChan(key, loader)
select {
case res := <-ch:
    return res.Val, res.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

The caller can give up, but the `loader` keeps running until it returns. Other waiters still receive the result.

For a TTL cache this is usually fine: even if your caller gives up, the result is cached for the next reader. But be careful in tests — a loader that "leaks" past the test function's scope can interfere with subsequent tests.

---

## Deep Dive: Sharded Singleflight

A single `singleflight.Group` has one mutex protecting its internal map. Under very high concurrency (millions of QPS, thousands of distinct missing keys per second), that mutex becomes a hotspot.

Solution: shard the group:

```go
type ShardedGroup struct {
    groups [256]singleflight.Group
}

func (s *ShardedGroup) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
    h := fnv32(key)
    return s.groups[h&255].Do(key, fn)
}
```

Now each shard's lock handles 1/256 of traffic. The cost is more bookkeeping; benefit is roughly linear scaling.

You only need this at extreme scale. For most services, a single `Group` is fine.

---

## Deep Dive: SWR vs Refresh-Ahead vs Singleflight

Three patterns, often confused. Side-by-side:

| Property | Single-flight | SWR | Refresh-ahead |
|---|---|---|---|
| Triggered by | concurrent misses | stale read | timer at 80% TTL |
| Reader latency on miss | one origin call | zero (serves stale) | zero (already fresh) |
| Origin call count | 1 per miss event | 1 per stale-read window | 1 per TTL |
| Implementation complexity | low | medium | medium-high |
| Best for | uneven traffic spikes | predictable read traffic | known hot keys |
| Cost when nothing is happening | zero | zero | one timer per hot key |

Most real systems combine at least two. Single-flight is almost always present. SWR fits when origin is occasionally slow but the freshness budget allows serving stale. Refresh-ahead fits when you can predict the working set.

---

## Deep Dive: TTL with Variable Cost Items

In `ristretto` you pass a `cost` parameter to `SetWithTTL`. What does it mean?

The cache budget is denominated in "cost units," not entry count. You choose the cost unit:

- Bytes: `Set(k, v, int64(len(v)))`. Bound the cache by total bytes.
- Entries: `Set(k, v, 1)`. Bound by entry count.
- Custom: `Set(k, v, expensiveness(v))`. Weight by some application-specific notion.

This is more flexible than entry-count caps. A cache that holds both 1-byte and 1-MB entries should not treat them equally — evicting a million 1-byte entries to make room for one 1-MB entry is wasteful.

Most other Go caches do not have this concept. If you need it, ristretto is the obvious choice.

---

## Deep Dive: Cost Estimation Pitfalls

When you choose "bytes" as the cost unit, you must compute the byte cost accurately. Common mistakes:

- `len(v)` returns the *content* length but ignores the Go header (16 bytes for string, 24 for slice).
- A struct's `unsafe.Sizeof()` returns the inline size, not the size of pointed-to data.
- A `map[string]string` reports `len() == number of entries` but does not include the hash table overhead.

For most caches, "close enough" is fine: pick a reasonable estimate and over-provision the budget. For high-precision memory accounting, you may need to walk the value's memory graph.

```go
func cost(v string) int64 {
    return int64(len(v) + 16) // string header + content
}

func cost(v []byte) int64 {
    return int64(len(v) + 24) // slice header + content
}

func cost(v *Entry) int64 {
    return int64(unsafe.Sizeof(*v)) + cost(v.body)
}
```

Round generously upward — under-estimating costs means the cache exceeds the budget you thought you set.

---

## Deep Dive: ristretto Set Returning False

A confusing-at-first ristretto behaviour:

```go
ok := cache.Set("k", "v", 1)
// ok may be false even though Set didn't error
```

Why? Because TinyLFU's admission policy may reject the key entirely. The new key's estimated access frequency is compared against the *frequency of the entry we would have to evict*. If the new key is judged unlikely to be popular enough to justify eviction, the Set is silently dropped.

For a first-ever Set on a key, this is unusual but possible if the cache is full of hot entries. The fix: do not worry about it for a `Get`-then-`Set` loader pattern (you will try again next miss), but for "I really want this written" cases, increase `NumCounters` (the frequency tracker) and check the return.

A pattern: log when Set returns false, monitor the rate. If admissions-rejected is high, your cache is too small or your traffic is adversarial. Sometimes the right answer is "let it stay; that key really is cold."

---

## Worked Example: API Gateway Cache

An API gateway sits in front of N internal services. For idempotent GETs, it caches responses. Design:

- Key: `{method}:{path}?{sortedQueryString}`.
- Value: the response body + headers.
- TTL: 30 s default, overridable by `Cache-Control: max-age=...` from upstream.
- Singleflight: yes.
- Jitter: 5%.
- Bounded: 100,000 entries via LRU on top.

```go
package gateway

import (
    "io"
    "net/http"
    "strconv"
    "strings"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type cachedResp struct {
    status    int
    headers   http.Header
    body      []byte
    expiresAt time.Time
}

type Cache struct {
    mu     sync.RWMutex
    data   map[string]cachedResp
    ttl    time.Duration
    jitter time.Duration
    group  singleflight.Group
    next   http.RoundTripper
}

func New(next http.RoundTripper, ttl, jitter time.Duration) *Cache {
    return &Cache{
        data:   make(map[string]cachedResp),
        ttl:    ttl,
        jitter: jitter,
        next:   next,
    }
}

func (c *Cache) RoundTrip(req *http.Request) (*http.Response, error) {
    if req.Method != http.MethodGet {
        return c.next.RoundTrip(req)
    }
    key := req.Method + ":" + req.URL.RequestURI()

    c.mu.RLock()
    cr, ok := c.data[key]
    c.mu.RUnlock()
    if ok && time.Now().Before(cr.expiresAt) {
        return c.responseFromCached(cr), nil
    }

    v, err, _ := c.group.Do(key, func() (interface{}, error) {
        resp, err := c.next.RoundTrip(req)
        if err != nil {
            return nil, err
        }
        defer resp.Body.Close()
        body, err := io.ReadAll(resp.Body)
        if err != nil {
            return nil, err
        }
        ttl := c.ttlFor(resp.Header)
        cr := cachedResp{
            status:    resp.StatusCode,
            headers:   resp.Header.Clone(),
            body:      body,
            expiresAt: time.Now().Add(ttl + jitterDuration(c.jitter)),
        }
        c.mu.Lock()
        c.data[key] = cr
        c.mu.Unlock()
        return cr, nil
    })
    if err != nil {
        return nil, err
    }
    return c.responseFromCached(v.(cachedResp)), nil
}

func (c *Cache) ttlFor(h http.Header) time.Duration {
    cc := h.Get("Cache-Control")
    for _, p := range strings.Split(cc, ",") {
        p = strings.TrimSpace(p)
        if strings.HasPrefix(p, "max-age=") {
            if n, err := strconv.Atoi(strings.TrimPrefix(p, "max-age=")); err == nil {
                return time.Duration(n) * time.Second
            }
        }
    }
    return c.ttl
}

func (c *Cache) responseFromCached(cr cachedResp) *http.Response {
    return &http.Response{
        StatusCode: cr.status,
        Header:     cr.headers.Clone(),
        Body:       io.NopCloser(strings.NewReader(string(cr.body))),
    }
}
```

Decisions worth highlighting:

- Implements `http.RoundTripper`. The cache plugs into any `http.Client`.
- Only caches GETs.
- Respects `Cache-Control: max-age` if upstream sends it; otherwise falls back to the cache's default TTL.
- Uses singleflight to coalesce concurrent misses.
- Adds jitter to expiration to prevent batch-expiry.
- Does not yet bound size — that is the LRU subsection's job.

`jitterDuration` is left as a small helper.

---

## Deep Dive: Bounding by Memory, Not Entries

Most TTL caches bound by entry count. That works when entries are roughly uniform in size. When they are not — a cache holding tiny user records *and* huge HTML pages — entry count is a poor proxy for memory.

Two approaches:

1. **Cost-weighted eviction (ristretto style).** Each entry has a `cost`; the cache evicts until total cost is below threshold.
2. **Size-monitoring callback.** Periodically measure approximate memory; trigger eviction when over.

Ristretto handles approach 1 natively. For other caches, you can approximate approach 2:

```go
func (c *Cache) approxBytes() int64 {
    var total int64
    c.mu.RLock()
    for k, e := range c.data {
        total += int64(len(k)) + int64(len(e.value)) + 40 // overhead estimate
    }
    c.mu.RUnlock()
    return total
}

func (c *Cache) memoryWatcher() {
    t := time.NewTicker(10 * time.Second); defer t.Stop()
    for range t.C {
        if c.approxBytes() > c.memBudget {
            c.evictLargest(c.memBudget / 10) // free 10% of budget
        }
    }
}
```

This is approximate (we ignore map overhead and GC fragmentation), but useful as a soft cap.

A subtle real-world bug: `approxBytes` ranges the whole map under RLock. For a 10M-entry cache, this is the same kind of sweep stall we tried to avoid. Sample instead — scan 1% of entries and extrapolate.

---

## Deep Dive: Sweep Cancellation Mid-Pass

If `Close` is called during a sweep, the current sweep finishes before the goroutine exits. For a 100ms-long sweep on a million-entry cache, `Close` blocks for up to 100ms.

If you need faster shutdown:

```go
func (c *Cache) sweep() {
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    count := 0
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
        count++
        if count%1000 == 0 {
            select {
            case <-c.stop:
                return // abort early
            default:
            }
        }
    }
}
```

The per-1000-iteration check costs essentially nothing. Now `Close` aborts the sweep at the next thousand-entry boundary.

In tests this matters a lot — without abort, every test that calls `Close` while a sweep is running pays the full sweep duration. In production it matters less because shutdowns are infrequent.

---

## Worked Example: Token Validation Cache

A common backend need: validate JWTs without recomputing signatures on every request.

```go
package authcache

import (
    "errors"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type Claims struct {
    Subject string
    Scopes  []string
}

type Verifier interface {
    Verify(token string) (Claims, time.Time, error) // claims, expiresAt, error
}

type Cache struct {
    mu       sync.RWMutex
    data     map[string]entry
    verifier Verifier
    group    singleflight.Group

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

type entry struct {
    claims    Claims
    expiresAt time.Time
}

var ErrExpired = errors.New("token expired")

func New(v Verifier, sweep time.Duration) *Cache {
    c := &Cache{
        data:     make(map[string]entry),
        verifier: v,
        stop:     make(chan struct{}),
        done:     make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        t := time.NewTicker(sweep)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                c.sweep()
            case <-c.stop:
                return
            }
        }
    }()
    return c
}

func (c *Cache) Validate(token string) (Claims, error) {
    c.mu.RLock()
    e, ok := c.data[token]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        return e.claims, nil
    }

    v, err, _ := c.group.Do(token, func() (interface{}, error) {
        claims, exp, err := c.verifier.Verify(token)
        if err != nil {
            return Claims{}, err
        }
        c.mu.Lock()
        c.data[token] = entry{claims: claims, expiresAt: exp}
        c.mu.Unlock()
        return claims, nil
    })
    if err != nil {
        return Claims{}, err
    }
    return v.(Claims), nil
}

func (c *Cache) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *Cache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

Key design choices:

- Uses each token's natural expiration (`exp` claim) as the TTL — no global default.
- Singleflight means a burst of identical-token requests pays one signature verification.
- Failed validations are *not* cached. If you want to cache failures (to defend against flooded bad tokens), add a `negativeTTL`-style entry with a short fixed TTL.
- The cache holds a copy of the claims for the token's full life. Bound this with a size cap in production.

---

## Deep Dive: Read Patterns vs Cache Design

The right cache for a workload depends on the *shape* of the requests.

**Zipfian distribution** (small set of very hot keys, long tail of cold ones). Almost every real-world workload looks like this. A small cache that holds the hot keys dominates: 95% hit ratio with ~1% of the universe.

**Uniform distribution** (every key equally likely). Cache hit ratio = `cacheSize / keySpace`. Often not worth caching.

**Sequential/scanning** (each key requested once, in order). 0% hit ratio. Cache is wasted memory.

**Bursty hot-cold transitions** (popular topics rotate every hour). LRU evicts the old hot set in favour of the new — good. LFU (without aging) clings to the old set — bad. TinyLFU with aging handles this well.

Knowing your distribution lets you choose:

- Cache size: hot keys' working-set size.
- Eviction policy: LRU for shifting hot sets, LFU for stable popular keys.
- TTL: how long do values need to be fresh?

Measure before you tune. A `top-K hot keys` summary over an hour of traffic answers most of these questions.

---

## Worked Example: DNS-like Lookup Cache

A canonical TTL cache application: positive and negative caching of name lookups.

```go
package dnscache

import (
    "errors"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type Resolver interface {
    Lookup(name string) (ip string, ttl time.Duration, err error)
}

var ErrNXDomain = errors.New("nxdomain")

type entry struct {
    ip        string
    found     bool
    expiresAt time.Time
}

type Cache struct {
    mu       sync.RWMutex
    data     map[string]entry
    resolver Resolver
    negTTL   time.Duration // for NXDOMAIN
    group    singleflight.Group

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func New(r Resolver, negTTL, sweep time.Duration) *Cache {
    c := &Cache{
        data:     make(map[string]entry),
        resolver: r,
        negTTL:   negTTL,
        stop:     make(chan struct{}),
        done:     make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        t := time.NewTicker(sweep)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                c.sweep()
            case <-c.stop:
                return
            }
        }
    }()
    return c
}

func (c *Cache) Lookup(name string) (string, error) {
    c.mu.RLock()
    e, ok := c.data[name]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        if !e.found {
            return "", ErrNXDomain
        }
        return e.ip, nil
    }

    v, err, _ := c.group.Do(name, func() (interface{}, error) {
        ip, ttl, err := c.resolver.Lookup(name)
        if errors.Is(err, ErrNXDomain) {
            c.mu.Lock()
            c.data[name] = entry{found: false, expiresAt: time.Now().Add(c.negTTL)}
            c.mu.Unlock()
            return "", ErrNXDomain
        }
        if err != nil {
            // Transient error — do not cache.
            return "", err
        }
        c.mu.Lock()
        c.data[name] = entry{ip: ip, found: true, expiresAt: time.Now().Add(ttl)}
        c.mu.Unlock()
        return ip, nil
    })
    if err != nil {
        return "", err
    }
    return v.(string), nil
}

func (c *Cache) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *Cache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

The negative-caching pattern (NXDOMAIN cached for `negTTL`) is the *single* most important defence against probing attacks. Without it, an attacker who knows your cache has no entry for `bogus-name-12345.com` can issue 10,000 queries per second and force 10,000 upstream lookups per second.

---

## Deep Dive: Anti-pattern — Big Switch on Cache Misses

A pattern I have seen in many codebases:

```go
func getData(k string) string {
    switch typeOf(k) {
    case "user":
        return userCache.GetOrLoad(k)
    case "session":
        return sessionCache.GetOrLoad(k)
    case "order":
        return orderCache.GetOrLoad(k)
    }
}
```

Three different caches, three different code paths, three different metrics. The complexity grows linearly with cache count, and adding a new type means touching N call sites.

Better: a generic registry that handles cache lookup uniformly.

```go
type Registry struct {
    caches map[string]Cache
}

func (r *Registry) Get(typeName, key string) (any, error) {
    c, ok := r.caches[typeName]
    if !ok {
        return nil, fmt.Errorf("unknown type %q", typeName)
    }
    return c.Get(key)
}
```

The call site stays one line. Adding a type is one registration. Metrics are uniform across types.

Trade-off: type erasure (everything returns `any`). With Go 1.18+ generics, you can keep type safety at the cost of a per-type method on the registry. Pick what fits your codebase.

---

## Worked Example: Database Query Result Cache

```go
package dbcache

import (
    "context"
    "database/sql"
    "fmt"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type User struct {
    ID    int64
    Name  string
    Email string
}

type Cache struct {
    mu    sync.RWMutex
    data  map[int64]entry
    db    *sql.DB
    ttl   time.Duration
    group singleflight.Group
}

type entry struct {
    user      *User
    expiresAt time.Time
}

func New(db *sql.DB, ttl time.Duration) *Cache {
    return &Cache{
        data: make(map[int64]entry),
        db:   db,
        ttl:  ttl,
    }
}

func (c *Cache) Get(ctx context.Context, id int64) (*User, error) {
    c.mu.RLock()
    e, ok := c.data[id]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        return e.user, nil
    }

    key := fmt.Sprintf("user:%d", id)
    v, err, _ := c.group.Do(key, func() (interface{}, error) {
        var u User
        err := c.db.QueryRowContext(ctx,
            "SELECT id, name, email FROM users WHERE id = ?", id,
        ).Scan(&u.ID, &u.Name, &u.Email)
        if err == sql.ErrNoRows {
            // Cache the absence briefly.
            c.mu.Lock()
            c.data[id] = entry{user: nil, expiresAt: time.Now().Add(time.Second * 5)}
            c.mu.Unlock()
            return (*User)(nil), nil
        }
        if err != nil {
            return nil, err
        }
        c.mu.Lock()
        c.data[id] = entry{user: &u, expiresAt: time.Now().Add(c.ttl)}
        c.mu.Unlock()
        return &u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}

func (c *Cache) Invalidate(id int64) {
    c.mu.Lock()
    delete(c.data, id)
    c.mu.Unlock()
    c.group.Forget(fmt.Sprintf("user:%d", id))
}
```

Pattern worth noting:

- `Invalidate` calls `group.Forget(key)` so any in-flight load is dropped. Otherwise readers might still get the about-to-be-stale value.
- Returns a pointer (`*User`) so missing users (nil) are distinct from a zero-value `User{}`.
- Reads the database under context; respects cancellation.
- Uses the database's own row-not-found as a signal for negative caching.

---

## Cheat Sheet

```go
// Heap-backed eviction
type heapItem struct { key string; expiresAt time.Time; index int }
heap.Push(&h, item); heap.Pop(&h); heap.Remove(&h, idx)

// Sync.Map basics
m.Store(k, v); v, ok := m.Load(k); m.Delete(k); m.Range(fn)

// Singleflight
var g singleflight.Group
v, err, shared := g.Do(key, func() (interface{}, error) { ... })
g.Forget(key)

// Jitter
import "math/rand/v2"
d := time.Duration(rand.Int64N(int64(maxJitter)))

// Batched sweep
for {
    c.mu.Lock(); batch := snapshot(batchSize); c.mu.Unlock()
    if len(batch) == 0 { break }
    c.mu.Lock(); evict(batch); c.mu.Unlock()
    runtime.Gosched()
}

// Bounded
if len(c.data) >= cap { for k := range c.data { delete(c.data, k); break } }

// ristretto
ristretto.NewCache(&ristretto.Config{NumCounters: ..., MaxCost: ..., BufferItems: 64})

// bigcache
bigcache.New(ctx, bigcache.DefaultConfig(ttl))

// freecache
freecache.NewCache(100 << 20).Set([]byte(k), []byte(v), 60)
```

---

## Deep Dive: Comparing Sweep Strategies in Numbers

A back-of-the-envelope comparison for a 1M-entry cache, with 30 s TTL.

| Strategy | Sweep frequency | Time per sweep | Lock-held p99 | Memory above live set | Reader p99 contribution |
|---|---|---|---|---|---|
| Tick, full sweep, 30s | every 30s | 100ms | 100ms | small | up to 100ms |
| Tick, full sweep, 5s | every 5s | 80ms (fewer expired) | 80ms | tiny | up to 80ms |
| Heap, on-expiration | per expiration event | <1ms | <1ms | tiny | <1ms |
| Heap, lazy stale drop | per expiration event | depends on stale ratio | <5ms typically | up to 2× | <5ms |
| Batched tick (1000/batch) | every 5s, ~50 batches | ~1.6ms each | <2ms | small | <2ms |

Numbers are illustrative — your mileage will vary by 2-3× on different hardware. The point is that the heap strategy is qualitatively different: lock-held time is dictated by the number of expirations in the current batch, not the total cache size.

For caches under ~100k entries, even the naive tick sweep is fine. Above that, heap or batched-tick becomes mandatory.

---

## Self-Assessment Checklist

- [ ] I can implement a heap-backed sweeper that wakes only at the next expiration.
- [ ] I can explain Strategy A vs Strategy B for handling overwrites in the heap.
- [ ] I can describe `sync.Map`'s read-fast-path and when to choose it.
- [ ] I can implement singleflight-based stampede protection.
- [ ] I can implement jittered TTL and explain its effect on herd flattening.
- [ ] I know the differences between `ristretto`, `bigcache`, `freecache` and when to choose each.
- [ ] I can implement stale-while-revalidate and refresh-ahead.
- [ ] I can name and describe the standard cache metrics.
- [ ] I can identify and fix the seven mid-level mistakes listed.
- [ ] I can implement an HTTP gateway cache and a JWT validation cache.

---

## Deep Dive: Choosing a Sweeper Cadence

Even with a heap, you sometimes want a regular cadence (e.g. to push metrics). Or, if you choose strategy B (lazy stale dropping), the sweeper must run periodically regardless of heap state to flush accumulated stale entries.

Reasonable cadences:

- For a heap-backed cache, no cadence at all — the sweeper wakes only at the next expiration.
- For a tick-based cache, `tick = min(ttl/5, 1 minute, 30% of staleness budget)`.
- For a stats-export tick, every 10 seconds is fine — independent of eviction cadence.

A combination some teams use:

```go
go c.expirationLoop()    // heap-driven, fires at next expiration
go c.metricsLoop()       // ticker every 10s, exports stats
go c.staleCleanupLoop()  // ticker every minute, rebuilds heap if too sparse
```

Three goroutines, three concerns. Each loop is a single function ending in `select { case <-stop: return }`. Easy to reason about.

---

## Deep Dive: Memory Locality and CPU Caches

Once your cache holds tens of millions of entries, CPU cache misses dominate the cost of `Get`. Even a "hash map lookup" can take 100+ ns if it touches memory far from anything in L1/L2.

Mitigations applicable at middle level:

- **Keep keys short.** A 16-byte key fits in fewer cache lines than a 256-byte key. Hash long keys to fixed-size identifiers if you can.
- **Co-locate hot fields.** In your `entry` struct, put `expiresAt` next to `value` so a single cache line fetch grabs both.
- **Pre-warm the map.** `make(map[string]entry, expectedSize)` avoids rehashing.
- **Reuse allocations.** `sync.Pool` for transient buffers around lookups.

You will rarely measure a benefit from these on small caches. On caches of 10M+ entries, the cumulative wins are 2-3×. Senior file has more.

---

## Deep Dive: Goroutine Scheduling and the Cache Lock

A subtle point about how Go schedules goroutines that contend on a mutex:

When 100 goroutines wait on `c.mu.Lock()`, they form an unspecified wake-up order. Go's `sync.Mutex` does *not* guarantee FIFO ordering; the runtime picks the next holder based on internal heuristics.

In practice this means a *starvation-resistant* mutex (the default since Go 1.9) eventually serves every waiter, but the latency distribution at the tail can be wide. p99 of "time to acquire" under heavy contention is often 10× p50.

What you can do at middle level:

- Reduce lock-holding time (don't do I/O under the lock).
- Reduce the number of acquisitions (batch operations).
- Shard the lock (senior file).
- Use a `sync.RWMutex` if reads dominate (already done in our designs).

You cannot prevent occasional tail-latency spikes due to scheduling unless you ensure the lock is held for an extremely short, predictable time. Hence the obsession with "lock-held duration" at every level above this one.

---

## Deep Dive: Sharded Counter Updates

Even your hit/miss counters can become hotspots. Under millions of QPS, `atomic.Uint64.Add(1)` on a single cache line bottlenecks on the cache-coherence protocol — every CPU core has to invalidate the line, fight for it, and write back.

The mitigation: per-CPU counters, summed on demand.

```go
type ShardedCounter struct {
    shards [runtime.NumCPU()]struct {
        v atomic.Uint64
        _ [56]byte // padding to fill a cache line (64 bytes total)
    }
}

func (c *ShardedCounter) Add(n uint64) {
    c.shards[fastRand()%uint32(len(c.shards))].v.Add(n)
}

func (c *ShardedCounter) Sum() uint64 {
    var total uint64
    for i := range c.shards {
        total += c.shards[i].v.Load()
    }
    return total
}
```

The cache-line padding (`_ [56]byte`) prevents false sharing — two adjacent counters on the same cache line would still contend even though they are logically separate.

For caches handling under 1M QPS, this is overkill. For high-throughput proxies and gateways, it matters.

---

## Deep Dive: Avoiding `fmt.Sprintf` in Hot Paths

A common but invisible cost: building cache keys via `fmt.Sprintf`.

```go
key := fmt.Sprintf("user:%d", id) // allocates, parses format string
```

Each call allocates a string and runs the format-string state machine. For a hot path doing 1M lookups per second, this is a measurable chunk of CPU.

Alternatives:

```go
key := "user:" + strconv.Itoa(int(id))      // allocates once, but no format machine
key := strconv.AppendInt([]byte("user:"), id, 10) // []byte key, zero allocation if pooled
```

Or, if your cache supports integer keys directly (with generics), skip the string entirely:

```go
cache := NewCache[int64, *User]()
```

These micro-optimisations matter when the cache itself is so fast that even tiny per-call costs dominate. Always measure before optimising. But know the techniques exist.

---

## Deep Dive: Why Loading Should Be Idempotent

Singleflight runs `loader` once and shares the result. If `loader` has side effects, those side effects happen once even though multiple callers wanted them.

Examples of non-idempotent loaders:

- `loader` increments a database counter ("page view"). Only one view is recorded for the entire herd.
- `loader` sends an email. Only one email is sent.
- `loader` writes an audit log. Only one log entry.

In each case, the behaviour is *probably* what you want — but you should think it through. If you genuinely need per-caller side effects, do them outside `singleflight.Do`.

```go
// Wrong: only one click is recorded.
v, _, _ := group.Do(key, func() (interface{}, error) {
    return loadAndIncrementClickCount(id)
})

// Right: increment per call, load once.
go incrementClickCount(id) // fire-and-forget side effect
v, _, _ := group.Do(key, func() (interface{}, error) {
    return loadOnly(id)
})
```

---

## Summary

The middle level of TTL caching is where you stop building from primitives and start composing real production patterns:

- The sweeper graduates from `O(N) per tick` to `O(k log N) per expiration` via a min-heap.
- The hot path gets faster with `sync.Map` for reads.
- Stampedes get tamed with singleflight, jitter, stale-while-revalidate, and refresh-ahead.
- The cache acquires a size bound — naively first, then via libraries like `ristretto`.
- Observability becomes mandatory.

Everything here still runs in one process and assumes one or a few cores. The senior level scales out: sharding for many cores, distributed invalidation, hot-key mitigation at internet scale, and the deep internals of `ristretto`, `bigcache`, and `freecache`.

---

## Deep Dive: Replicated Singleflight

In a multi-replica setup, each replica has its own `singleflight.Group`. If 12 replicas each miss on key K simultaneously, the upstream sees 12 calls — singleflight only deduplicated within each replica.

The fix: distributed singleflight. The first replica to miss acquires a distributed lock (Redis SETNX); the others wait or return stale data.

```go
func (c *Cache) Get(k string) (string, error) {
    if v, ok := c.local.Get(k); ok {
        return v, nil
    }
    lockKey := "sf:" + k
    ok, _ := c.rdb.SetNX(ctx, lockKey, "1", 10*time.Second).Result()
    if !ok {
        // Another replica is loading; wait and retry.
        time.Sleep(50 * time.Millisecond)
        return c.Get(k) // or return stale
    }
    defer c.rdb.Del(ctx, lockKey)
    v, err := c.upstream.Load(k)
    if err == nil {
        c.local.Set(k, v)
    }
    return v, err
}
```

This is fragile (Redis can lose locks, the holder can die, etc.). Production-grade versions use redlock or fencing tokens. Senior-level material; mentioned here so you know the pattern exists.

---

## Deep Dive: A Production Cache Checklist

Before you ship a TTL cache to production, run through this list.

- [ ] Reads are protected (RLock, sync.Map, or lock-free shard).
- [ ] Writes are protected (Lock or sync.Map.Store).
- [ ] Sweep does not hold the lock for longer than your latency budget.
- [ ] Sweeper has a clean shutdown path (Close returns synchronously).
- [ ] Cache exposes hits, misses, evictions, size, get-duration, load-duration metrics.
- [ ] Loader is wrapped in singleflight.
- [ ] TTLs are jittered (10% is a reasonable default).
- [ ] Negative results are cached with a shorter TTL.
- [ ] Cache has a size cap (LRU or cost-based).
- [ ] Mass invalidation is supported (clear all, or by prefix).
- [ ] Failure modes (loader panic, loader error, OOM) are documented.
- [ ] You have run the cache under `-race` for at least 60 s of stress.
- [ ] You have run a load test that triggers eviction and confirmed no panics.
- [ ] You have a runbook for "cache hit ratio dropped suddenly."
- [ ] You have a runbook for "cache memory grew unexpectedly."

That last pair is the most often skipped. A cache is operational software; treat it as such.

---

## Deep Dive: When the Loader is a gRPC Call

gRPC introduces specific quirks for cache loaders.

- **Context propagation.** The loader's context should carry the original request's deadline and metadata.
- **Streaming responses.** A streaming RPC cannot trivially be cached; collect the stream into a slice first or cache only the first response.
- **Backoff and retry.** gRPC clients typically have built-in retry. Combined with singleflight, you may be double-protecting against the same failure mode.
- **Cancellation.** When a caller cancels, the gRPC stub respects it — but the singleflight callback runs on a synthetic context. Decouple the two carefully.

A sketch:

```go
func (c *Cache) Get(ctx context.Context, k string) (*Pb.Result, error) {
    if v, ok := c.local.Load(k); ok && !expired(v) {
        return v.(item).val, nil
    }
    v, err, _ := c.group.Do(k, func() (interface{}, error) {
        // Use a fresh context with our own deadline.
        loadCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        resp, err := c.client.Get(loadCtx, &Pb.Req{Key: k})
        if err != nil {
            return nil, err
        }
        c.local.Store(k, item{val: resp, expiresAt: time.Now().Add(c.ttl)})
        return resp, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*Pb.Result), nil
}
```

The fresh `loadCtx` ensures one caller's cancellation does not propagate to all waiters.

---

## Deep Dive: Migrating From In-Process to Distributed

You start with an in-process cache. Six months later, you have 12 replicas and the cache hit ratio is no longer where it was.

The classic migration:

1. Keep the in-process cache (call it L1).
2. Add Redis (call it L2). L2 holds all keys, longer TTL.
3. `Get(k)`: check L1 → L2 → upstream.
4. `Set(k, v)`: write to L2 first, then L1.
5. `Delete(k)`: delete from L2, broadcast a pub/sub message that all replicas drop their L1 entry.

The L1 absorbs hot keys and provides sub-millisecond latency for them. The L2 absorbs the long tail and provides cross-replica consistency. Upstream load drops further than either layer alone would manage.

Subtleties:

- L1 size is tiny (10k entries). L2 size is large (1M entries).
- L1 TTL is short (seconds to minutes). L2 TTL is longer (minutes to hours).
- L1 may serve stale data even after L2 is updated, until the pub/sub message arrives. Decide whether this is acceptable.

This pattern is the dominant production design for caches at "real" scale. Detailed coverage is in the professional file; we mention it here as the natural next step beyond middle-grade in-process caches.

---

## Further Reading

- `golang.org/x/sync/singleflight` documentation and source — small, readable.
- `dgraph-io/ristretto` README and design doc — TinyLFU explained.
- `allegro/bigcache` README — shard-based ring buffer design.
- `coocood/freecache` README — segmented memory pool.
- "XFetch: A Decentralized Approach to Solving Cache Stampedes" (Vattani et al., 2015) — probabilistic early expiration.
- Mailgun's `groupcache` documentation — distributed singleflight.
- Caffeine (Java) documentation — design ideas often portable to Go.

---

## Final Walk-Through: Production-Grade Cache Module

Putting everything together in a coherent shape ready for production:

```go
package cache

import (
    "context"
    "errors"
    "math/rand/v2"
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sync/singleflight"
)

type Loader[V any] func(ctx context.Context, key string) (V, error)

type Stats struct {
    Hits   uint64
    Misses uint64
    Loads  uint64
    Errors uint64
}

type Cache[V any] struct {
    mu       sync.RWMutex
    data     map[string]item[V]
    loader   Loader[V]
    ttl      time.Duration
    jitter   time.Duration
    negTTL   time.Duration
    group    singleflight.Group

    hits, misses, loads, errors atomic.Uint64

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

type item[V any] struct {
    value     V
    err       error // for negative caching
    expiresAt time.Time
}

type Options struct {
    TTL           time.Duration
    Jitter        time.Duration
    NegativeTTL   time.Duration
    SweepInterval time.Duration
}

func New[V any](opts Options, loader Loader[V]) *Cache[V] {
    c := &Cache[V]{
        data:   make(map[string]item[V]),
        loader: loader,
        ttl:    opts.TTL,
        jitter: opts.Jitter,
        negTTL: opts.NegativeTTL,
        stop:   make(chan struct{}),
        done:   make(chan struct{}),
    }
    if opts.SweepInterval > 0 {
        go func() {
            defer close(c.done)
            t := time.NewTicker(opts.SweepInterval)
            defer t.Stop()
            for {
                select {
                case <-t.C:
                    c.sweep()
                case <-c.stop:
                    return
                }
            }
        }()
    } else {
        close(c.done)
    }
    return c
}

func (c *Cache[V]) Get(ctx context.Context, key string) (V, error) {
    c.mu.RLock()
    it, ok := c.data[key]
    c.mu.RUnlock()
    if ok && time.Now().Before(it.expiresAt) {
        c.hits.Add(1)
        return it.value, it.err
    }
    c.misses.Add(1)

    v, err, _ := c.group.Do(key, func() (interface{}, error) {
        // Re-check under singleflight.
        c.mu.RLock()
        it, ok := c.data[key]
        c.mu.RUnlock()
        if ok && time.Now().Before(it.expiresAt) {
            return it.value, it.err
        }

        c.loads.Add(1)
        val, err := c.loader(ctx, key)
        if err != nil {
            c.errors.Add(1)
            if c.negTTL > 0 {
                c.store(key, val, err, c.negTTL)
            }
            return val, err
        }
        c.store(key, val, nil, c.ttl)
        return val, nil
    })

    if err != nil {
        var zero V
        return zero, err
    }
    return v.(V), nil
}

func (c *Cache[V]) store(key string, value V, err error, base time.Duration) {
    jit := time.Duration(0)
    if c.jitter > 0 {
        jit = time.Duration(rand.Int64N(int64(c.jitter)))
    }
    c.mu.Lock()
    c.data[key] = item[V]{value: value, err: err, expiresAt: time.Now().Add(base + jit)}
    c.mu.Unlock()
}

func (c *Cache[V]) Invalidate(key string) {
    c.group.Forget(key)
    c.mu.Lock()
    delete(c.data, key)
    c.mu.Unlock()
}

func (c *Cache[V]) Stats() Stats {
    return Stats{
        Hits:   c.hits.Load(),
        Misses: c.misses.Load(),
        Loads:  c.loads.Load(),
        Errors: c.errors.Load(),
    }
}

func (c *Cache[V]) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, it := range c.data {
        if now.After(it.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *Cache[V]) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}

var ErrClosed = errors.New("cache closed")
```

Usage:

```go
userCache := cache.New[*User](cache.Options{
    TTL:           5 * time.Minute,
    Jitter:        30 * time.Second,
    NegativeTTL:   10 * time.Second,
    SweepInterval: 30 * time.Second,
}, func(ctx context.Context, key string) (*User, error) {
    return db.LoadUser(ctx, key)
})
defer userCache.Close()

user, err := userCache.Get(ctx, "user:42")
```

Generic, with all the safety nets discussed in this file. About 130 lines.

---

## Related Topics

- LRU/LFU caches (next subsection)
- Distributed caching (senior level)
- Connection pools (similar lifecycle patterns)
- Background job processing (sweeper patterns)
