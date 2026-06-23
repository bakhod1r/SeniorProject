---
layout: default
title: Tasks
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/tasks/
---

# TTL Caches — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solution sketches are at the end. Every snippet compiles against Go 1.22+ unless otherwise noted.

---

## Easy

### Task 1 — Minimal TTL cache with `map` + `sync.RWMutex`

Build a generic-free `Cache` type that stores `string -> []byte` with a per-entry TTL passed at insertion time. The API:

```go
type Cache struct { /* ... */ }

func New() *Cache
func (c *Cache) Set(key string, value []byte, ttl time.Duration)
func (c *Cache) Get(key string) ([]byte, bool)
func (c *Cache) Delete(key string)
```

Requirements:

- Concurrent `Get` from many goroutines must not block each other.
- A `Get` of an expired key returns `(nil, false)` and removes the entry *lazily* (no background sweeper yet).
- Use `time.Now()` once per call; do not call it twice for the same `Get`.

**Goal.** Establish the baseline you will optimise away in later tasks. You should already feel two design tensions: the `RWMutex` is upgraded to a write lock on lazy delete, and `time.Now()` is monotonic so freezing the clock for tests is awkward.

**Success criteria.**

- A unit test inserts 100 keys with TTL of 50 ms, sleeps 100 ms, then reads them all and expects every `Get` to return `false`.
- `go test -race` is clean.

---

### Task 2 — Inject a clock interface

Refactor Task 1 to take a `Clock` interface in the constructor:

```go
type Clock interface{ Now() time.Time }
```

Provide a real implementation and a `FakeClock` whose `Now()` returns whatever the test sets via `Advance(d time.Duration)`. Rewrite the expiration test to use `FakeClock` instead of `time.Sleep`.

**Goal.** Make every later test deterministic and millisecond-fast. This decoupling is non-negotiable for any cache you ship to production; flaky tests caused by real sleeps are a primary smell of "we built the wrong abstraction".

**Hints.**

- Store `expiresAt time.Time` on each entry, computed at insert.
- The cache only ever asks the clock; it never compares two clocks. Do not mix `time.Now()` with `clock.Now()`.

---

### Task 3 — Lazy expiration semantics under `Get`

Take the cache from Task 2 and answer the following with a test for each:

1. If two goroutines call `Get` simultaneously on the same expired key, only one of them performs the lazy delete; both see `(nil, false)`.
2. If one goroutine calls `Get(k)` on an expired entry while another is calling `Set(k, ...)` with a fresh value, the new value wins and is not deleted by the lazy path.
3. A `Get` that races with `Delete` does not panic and does not resurrect the entry.

**Goal.** Force yourself to think about the "double-check upgrade" pattern: take the `RLock`, see the entry is expired, drop the read lock, take the write lock, *re-check*, delete only if still expired *and* still the same generation.

**Hint.** Tag each entry with a monotonically increasing `gen uint64`. The lazy deleter captures the gen during the read phase and only deletes if it still matches under the write lock.

---

### Task 4 — Background sweeper, version 1

Add a background goroutine that periodically scans the entire map and removes expired entries.

```go
func New(sweep time.Duration) *Cache  // start a sweep loop
func (c *Cache) Close() error          // stop it cleanly
```

Requirements:

- `Close` must not leak the goroutine; verify with `go.uber.org/goleak.VerifyNone(t)`.
- The sweeper holds the lock for the *entire* scan in this naive version — that is fine for now; you will fix it in later tasks.
- `Close` is idempotent: calling it twice is safe.

**Goal.** Practice the "spawn + cancel + wait" lifecycle that every long-running cache needs.

**Common bugs you will hit.**

- Forgetting to `wg.Add(1)` before `go sweep()` — a race between `Close` and the goroutine's first scheduled instant.
- Selecting on `time.After` inside the loop without stopping the timer — see the famous `time.After` leak.

---

### Task 5 — Bounded sweep cost: scan a slice per tick

The sweeper from Task 4 takes the write lock for the entire scan. With a million entries, latency spikes to tens of milliseconds. Rewrite the sweeper so each tick processes at most `N` entries (e.g. 1000), then releases the lock.

Implement a "scan cursor": remember where the previous tick stopped, and resume from there on the next tick. The cursor wraps around to the start of the map when it reaches the end.

**Hint.** Go maps are unordered, so you cannot index into them. The pragmatic approach is to snapshot keys into a slice once per full pass, walk it in chunks, and re-snapshot when the chunk index passes the slice length.

**Success criteria.** With 1 000 000 entries, a single sweep tick locks the cache for less than 1 ms on a typical laptop.

---

## Medium

### Task 6 — `sync.Map` + min-heap of expirations

Replace the `map + RWMutex` with `sync.Map` for the hot read path, and add a separate min-heap of `(expiresAt, key)` pairs guarded by its own mutex. The sweeper pops from the heap until the top entry is in the future.

The API stays the same. Compare:

- Read-heavy workload: 100 readers, 1 writer. Measure ops/sec.
- Write-heavy workload: 100 writers, 1 reader. Measure ops/sec.
- Read-write balanced: 50/50.

**Goal.** Internalise *why* `sync.Map` is read-optimised and *when* the heap design wins.

**Hint.** `container/heap` is the standard fit. Define `type pq []item` and implement `heap.Interface`. The mutex on the heap is short-held — `Push`/`Pop` are O(log n).

**Subtlety.** When `Set` overwrites an existing key, the heap still contains a stale entry pointing at the *old* expiration. Two ways to handle:

1. **Generation counter on each item**, and the sweeper skips items whose generation no longer matches.
2. **Eager heap fix**: remove the old item before pushing the new one, which is O(n) without a secondary index.

The generation approach is almost always right.

---

### Task 7 — Jittered TTL to spread expiration

You have a workload that inserts 10 000 keys in a tight loop, all with TTL = 5 minutes. Five minutes later, all 10 000 keys expire in the same tick, and the sweeper hammers the lock.

Modify `Set` to accept a TTL *range* `(min, max time.Duration)` and pick a uniform random value inside it. Verify the next-tick eviction count distributes evenly across the next second instead of all hitting one tick.

**Goal.** Understand jitter as the standard antidote to synchronized expiry.

**Hint.** Use `math/rand/v2.Int64N` (Go 1.22+). It is goroutine-safe and avoids the global mutex of the old `math/rand`.

**Observe.** Plot the eviction-count histogram over time before and after jitter. The "before" picture is a single tall bar; the "after" is a flat band.

---

### Task 8 — Integrate `golang.org/x/sync/singleflight`

Add a `GetOrLoad` method:

```go
func (c *Cache) GetOrLoad(
    ctx context.Context,
    key string,
    ttl time.Duration,
    load func(ctx context.Context) ([]byte, error),
) ([]byte, error)
```

If the key is in cache and unexpired, return it. Otherwise call `load`, store the result, and return it. Under concurrent misses on the same key, only one `load` runs; all callers receive the same result.

Use `singleflight.Group.Do`. Test with 1000 concurrent `GetOrLoad` on a cold key — `load` must be called exactly once.

**Goal.** Eliminate the **thundering herd** on cold or freshly-expired keys.

**Trap.** Do not hold the cache mutex across the `load` call. Releasing the lock before `singleflight.Do` is essential; otherwise you serialise the entire cache on one slow origin.

---

### Task 9 — Sharded cache

Wrap the cache in a sharding layer: `N` (e.g. 256) independent cache instances, with each key routed to a shard via `fnv64a(key) % N`. The outer API is identical.

Requirements:

- Each shard has its *own* mutex and its *own* sweeper goroutine.
- A close on the outer cache stops every shard cleanly.
- Benchmark single-shard vs 256-shard at 100 concurrent writers. Expect a roughly 20-50x throughput improvement when contention was the bottleneck.

**Goal.** See how horizontal partitioning is the single most effective technique for scaling a contended map.

**Hints.**

- Power-of-two shard count lets you use `hash & (N-1)` instead of modulo.
- `fnv.New64a()` allocates; prefer the inline fnv loop or `xxhash` for hot paths.

---

### Task 10 — Observability: hit, miss, expired-on-read counters

Add an `Stats` method returning a struct with at least:

```go
type Stats struct {
    Hits             uint64
    Misses           uint64
    ExpiredOnRead    uint64
    LazyDeletes      uint64
    SweepDeletes     uint64
    Sets             uint64
    Size             int
}
```

All counters must be updated with `atomic.AddUint64`; do not hold any lock just to update a counter.

Wire the counters into a `prometheus.Counter` and a `prometheus.Gauge` (size) via the `prometheus/client_golang` library. Verify hit ratio is reported as `Hits / (Hits + Misses)` from the `/metrics` endpoint.

**Goal.** Practice the rule: *every concurrent data structure ships with metrics or it is broken in production.*

---

### Task 11 — Graceful shutdown with in-flight loaders

Combine Tasks 8 and 9. On `Close`, the cache must:

1. Stop accepting new `Set` and `GetOrLoad` (return a "closed" error).
2. Wait for in-flight `load` callbacks to finish, with a deadline from `context.Context`.
3. Stop all sweepers.
4. Drain all stats.

Add a test that closes the cache while 100 goroutines are mid-`GetOrLoad`. None of them should be left hanging; all should observe either the cached value or `ErrClosed`.

**Goal.** Model the production reality where caches outlive most other state and shutdown ordering matters.

**Hint.** A `sync.WaitGroup` tracks in-flight loads; `Close` decrements after `wg.Wait()` under a deadline.

---

### Task 12 — Active eviction under memory pressure

Add a max-size cap (in entries, e.g. 100 000). When `Set` would push the size past the cap, evict the entry with the soonest `expiresAt`, even if it is still alive. (You will replace this with LRU + admission in Task 17.)

Requirements:

- The eviction is O(log n) using the existing min-heap from Task 6.
- An evicted-due-to-size counter joins `Stats`.

**Goal.** Distinguish *expiry* (entry's TTL hit) from *eviction* (capacity hit). The two have different metrics and different mental models for capacity planning.

---

## Hard

### Task 13 — Per-shard sweeper budget

Each shard's sweeper currently runs every 1 s with a budget of 1000 entries. Under load, one shard may have a million expired entries while another has none; the busy shard never catches up.

Implement an *adaptive* budget: if the heap top is more than `sweepInterval` behind real time, the sweeper runs again immediately without sleeping, until it catches up or hits a max work-per-second cap.

Add a metric `sweep_lag_seconds` (gauge) reporting `now - heap.top.expiresAt` if positive, else 0.

**Goal.** Build a self-regulating sweeper, not a fixed-rate one.

---

### Task 14 — Eliminate the sweeper entirely (pure lazy)

Some workloads (e.g. very-short-TTL session caches) make active sweeping a net loss: the sweeper churns through entries that would have been hit anyway in the next millisecond. Build a pure-lazy variant.

The challenge: with no sweeper, expired-but-unread entries accumulate forever, leaking memory. Solve it via a *probabilistic sweep on Set*:

- On every `Set`, with probability `1/N`, scan a fixed K random entries and lazily delete any that are expired.

This is Redis's strategy for the same problem. Validate with a benchmark that under a 50/50 read/write workload, the memory footprint stabilises rather than growing without bound.

**Goal.** Internalise that "no background goroutine" is a valid and sometimes superior design.

**Hint.** `math/rand/v2.IntN(len(keys))` over a snapshot. Picking random keys from a `map` requires a secondary slice — a useful exercise in trade-offs.

---

### Task 15 — Lock-free read path with `atomic.Pointer`

For a read-mostly workload, the `RWMutex` on the shard is still the bottleneck under contention because every reader does a CAS-like RUnlock. Build a variant where:

- The shard's map is an `atomic.Pointer[map[string]*entry]` — readers load it, do their lookup, done.
- Writers take a mutex, *copy* the map, mutate the copy, and `Store` the new pointer.

This is COW (copy-on-write). Measure: at 1 reader / 1 writer, expect the COW variant to be roughly the same; at 100 readers / 1 writer, expect it to be 5-10x faster.

**Goal.** See where COW shines and where it dies (write-heavy workloads suffer because every write reallocates the entire map).

**Trap.** Lazy deletion now requires the writer mutex, so reads that find expired entries should *defer* the delete to a queue consumed by the writer.

---

### Task 16 — Multi-tier (L1 in-process, L2 Redis)

Wrap your in-process cache as L1; add a Redis client as L2. The `GetOrLoad` flow becomes:

1. Check L1. Hit? Return.
2. Check L2 (`GET key`). Hit? Populate L1 with remaining TTL, return.
3. `singleflight` the loader; on success, populate both L1 and L2.

Requirements:

- L1 TTL is `min(originalTTL, 30 * time.Second)` to bound staleness.
- L2 TTL is the original.
- Failures to write L2 do *not* fail the request — log and continue.
- Add `stats.L1Hits`, `stats.L2Hits`, `stats.L2Errors`.

**Goal.** Implement the multi-tier pattern every backend eventually grows into.

**Hint.** Use `github.com/redis/go-redis/v9`. Avoid `GET` + `TTL` (two round trips); use a single Lua `EVAL` returning `[value, pttl]` in one call.

---

### Task 17 — Add an admission policy (TinyLFU sketch)

Under capacity pressure, evicting the *soonest-to-expire* entry is dumb: it may be your hottest key. Implement TinyLFU admission:

- Maintain a count-min sketch of access frequencies (size ~10x cap, 4 hash functions, 4-bit counters).
- On a `Set` that would evict, compare the incoming key's frequency to the current victim's frequency. If incoming is *higher*, evict the victim; otherwise reject the `Set` (or queue it as a "window" admission).

This is the core of `ristretto`. Implement the count-min sketch with 4-bit counters packed into `[]uint64`.

**Goal.** See why admission policies, not just eviction policies, are state-of-the-art for caches.

**Reference.** Read the TinyLFU paper, *TinyLFU: A Highly Efficient Cache Admission Policy* (2017), before starting.

---

### Task 18 — GC-aware large cache via byte arenas

When the cache holds millions of pointers (entries with `key string`, `value []byte`), every GC cycle scans them all. Build a variant where:

- Values are stored as `[]byte` slices into a small set of large pre-allocated arenas (e.g. 8 × 256 MB `[]byte`).
- The map stores `(arenaIdx uint8, offset uint32, length uint32)` instead of a pointer to a value.

This is the `bigcache` strategy. Measure GC pause before and after with `runtime.ReadMemStats` and the `gctrace` env var; expect a 10-100x reduction in GC time.

**Goal.** Understand that "the GC is your enemy at scale" is a real engineering pressure, and how byte arenas defeat it.

**Trap.** Arenas grow forever unless you compact. Implement a ring-buffer per arena so new writes overwrite the oldest expired entries.

---

### Task 19 — Race-condition Whodunnit

This shard implementation has a real race condition. Find it, explain it, fix it without changing the API. Run `go test -race` to confirm.

```go
type shard struct {
    mu      sync.Mutex
    entries map[string]*entry
}

type entry struct {
    value     []byte
    expiresAt time.Time
}

func (s *shard) Get(key string) ([]byte, bool) {
    s.mu.Lock()
    e, ok := s.entries[key]
    s.mu.Unlock()
    if !ok { return nil, false }
    if time.Now().After(e.expiresAt) {
        s.mu.Lock()
        delete(s.entries, key)
        s.mu.Unlock()
        return nil, false
    }
    return e.value, true
}

func (s *shard) Set(key string, value []byte, ttl time.Duration) {
    s.mu.Lock()
    s.entries[key] = &entry{value: value, expiresAt: time.Now().Add(ttl)}
    s.mu.Unlock()
}
```

**Hint.** Look at the *double-checked lazy delete*. Between `Unlock` and the second `Lock` in `Get`, another goroutine may `Set` a fresh value with the same key. The `delete` then wipes the *fresh* value.

---

### Task 20 — Implement `RoundTrip` cache for HTTP

Wrap your TTL cache as an `http.RoundTripper` that caches `GET` responses for the `Cache-Control: max-age=N` duration, with the URL as key.

- Use `singleflight` keyed by `req.URL.String()` so concurrent identical GETs share one origin call.
- Respect `no-store`, `private`, and `must-revalidate`.
- Add `Vary: Accept-Encoding` handling: cache key includes the chosen encoding.
- A test verifies the second call to the same URL hits cache and never opens a connection.

**Goal.** Bring everything together — TTL, singleflight, shards, observability — in the shape that almost every Go service eventually needs.

---

## Solution Sketches

### Task 1

```go
package ttlcache

import (
    "sync"
    "time"
)

type entry struct {
    value     []byte
    expiresAt time.Time
}

type Cache struct {
    mu   sync.RWMutex
    data map[string]entry
}

func New() *Cache {
    return &Cache{data: make(map[string]entry)}
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: value, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *Cache) Get(key string) ([]byte, bool) {
    now := time.Now()
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()
    if !ok {
        return nil, false
    }
    if now.After(e.expiresAt) {
        c.mu.Lock()
        // re-check under write lock
        if e2, ok2 := c.data[key]; ok2 && now.After(e2.expiresAt) {
            delete(c.data, key)
        }
        c.mu.Unlock()
        return nil, false
    }
    return e.value, true
}

func (c *Cache) Delete(key string) {
    c.mu.Lock()
    delete(c.data, key)
    c.mu.Unlock()
}
```

---

### Task 2

```go
type Clock interface {
    Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

type FakeClock struct {
    mu  sync.Mutex
    now time.Time
}

func (f *FakeClock) Now() time.Time {
    f.mu.Lock()
    defer f.mu.Unlock()
    return f.now
}

func (f *FakeClock) Advance(d time.Duration) {
    f.mu.Lock()
    f.now = f.now.Add(d)
    f.mu.Unlock()
}

type Cache struct {
    mu    sync.RWMutex
    data  map[string]entry
    clock Clock
}

func New(clock Clock) *Cache {
    if clock == nil {
        clock = realClock{}
    }
    return &Cache{data: make(map[string]entry), clock: clock}
}
```

---

### Task 4

```go
type Cache struct {
    mu    sync.RWMutex
    data  map[string]entry
    clock Clock

    quit chan struct{}
    done chan struct{}
    once sync.Once
}

func New(clock Clock, sweep time.Duration) *Cache {
    c := &Cache{
        data:  make(map[string]entry),
        clock: clock,
        quit:  make(chan struct{}),
        done:  make(chan struct{}),
    }
    go c.sweepLoop(sweep)
    return c
}

func (c *Cache) sweepLoop(d time.Duration) {
    defer close(c.done)
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-c.quit:
            return
        case <-t.C:
            c.sweep()
        }
    }
}

func (c *Cache) sweep() {
    now := c.clock.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *Cache) Close() error {
    c.once.Do(func() {
        close(c.quit)
        <-c.done
    })
    return nil
}
```

---

### Task 6

```go
type item struct {
    key       string
    expiresAt time.Time
    gen       uint64
    index     int // heap index; -1 if removed
}

type pq []*item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].expiresAt.Before(p[j].expiresAt) }
func (p pq) Swap(i, j int)       {
    p[i], p[j] = p[j], p[i]
    p[i].index = i
    p[j].index = j
}
func (p *pq) Push(x any) {
    it := x.(*item)
    it.index = len(*p)
    *p = append(*p, it)
}
func (p *pq) Pop() any {
    old := *p
    n := len(old)
    it := old[n-1]
    old[n-1] = nil
    it.index = -1
    *p = old[:n-1]
    return it
}

type entry struct {
    value []byte
    gen   uint64
    // expiresAt also lives in the heap item
    expiresAt time.Time
}

type Cache struct {
    data sync.Map // map[string]*entry

    hmu sync.Mutex
    h   pq
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    exp := time.Now().Add(ttl)
    gen := nextGen()
    c.data.Store(key, &entry{value: value, gen: gen, expiresAt: exp})

    c.hmu.Lock()
    heap.Push(&c.h, &item{key: key, expiresAt: exp, gen: gen})
    c.hmu.Unlock()
}

func (c *Cache) sweep() {
    now := time.Now()
    for {
        c.hmu.Lock()
        if c.h.Len() == 0 {
            c.hmu.Unlock()
            return
        }
        top := c.h[0]
        if top.expiresAt.After(now) {
            c.hmu.Unlock()
            return
        }
        heap.Pop(&c.h)
        c.hmu.Unlock()

        v, ok := c.data.Load(top.key)
        if !ok {
            continue
        }
        e := v.(*entry)
        // skip stale heap items
        if e.gen != top.gen {
            continue
        }
        c.data.Delete(top.key)
    }
}
```

---

### Task 8

```go
import "golang.org/x/sync/singleflight"

type Cache struct {
    /* ... */
    sf singleflight.Group
}

func (c *Cache) GetOrLoad(
    ctx context.Context,
    key string,
    ttl time.Duration,
    load func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    if v, ok := c.Get(key); ok {
        return v, nil
    }
    v, err, _ := c.sf.Do(key, func() (any, error) {
        // re-check after acquiring single-flight: another goroutine may have populated
        if v, ok := c.Get(key); ok {
            return v, nil
        }
        result, err := load(ctx)
        if err != nil {
            return nil, err
        }
        c.Set(key, result, ttl)
        return result, nil
    })
    if err != nil {
        return nil, err
    }
    return v.([]byte), nil
}
```

---

### Task 9

```go
const numShards = 256

type Sharded struct {
    shards [numShards]*Cache
}

func NewSharded() *Sharded {
    var s Sharded
    for i := range s.shards {
        s.shards[i] = New(realClock{}, time.Second)
    }
    return &s
}

func (s *Sharded) shard(key string) *Cache {
    h := fnv64a(key)
    return s.shards[h&(numShards-1)]
}

func fnv64a(s string) uint64 {
    const (
        offset64 uint64 = 14695981039346656037
        prime64  uint64 = 1099511628211
    )
    h := offset64
    for i := 0; i < len(s); i++ {
        h ^= uint64(s[i])
        h *= prime64
    }
    return h
}

func (s *Sharded) Get(key string) ([]byte, bool) { return s.shard(key).Get(key) }
func (s *Sharded) Set(key string, v []byte, ttl time.Duration) {
    s.shard(key).Set(key, v, ttl)
}
func (s *Sharded) Close() error {
    for _, sh := range s.shards {
        _ = sh.Close()
    }
    return nil
}
```

---

### Task 14

```go
func (c *Cache) maybeProbeSweep() {
    if rand.IntN(probeFreq) != 0 { // e.g. probeFreq = 100
        return
    }
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    n := 0
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
        n++
        if n >= probeK { // e.g. probeK = 20
            return
        }
    }
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: value, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
    c.maybeProbeSweep()
}
```

---

### Task 15

```go
type shard struct {
    snap atomic.Pointer[map[string]*entry]

    mu    sync.Mutex // serialises writers and gc of expired
    queue chan string // expired-but-not-yet-deleted keys
}

func newShard() *shard {
    s := &shard{queue: make(chan string, 1024)}
    m := make(map[string]*entry)
    s.snap.Store(&m)
    go s.writer()
    return s
}

func (s *shard) Get(key string) ([]byte, bool) {
    m := *s.snap.Load()
    e, ok := m[key]
    if !ok {
        return nil, false
    }
    if time.Now().After(e.expiresAt) {
        select { case s.queue <- key: default: }
        return nil, false
    }
    return e.value, true
}

func (s *shard) Set(key string, v []byte, ttl time.Duration) {
    s.mu.Lock()
    old := *s.snap.Load()
    next := make(map[string]*entry, len(old)+1)
    for k, e := range old {
        next[k] = e
    }
    next[key] = &entry{value: v, expiresAt: time.Now().Add(ttl)}
    s.snap.Store(&next)
    s.mu.Unlock()
}

func (s *shard) writer() {
    for key := range s.queue {
        s.mu.Lock()
        old := *s.snap.Load()
        if e, ok := old[key]; ok && time.Now().After(e.expiresAt) {
            next := make(map[string]*entry, len(old))
            for k, v := range old {
                if k == key { continue }
                next[k] = v
            }
            s.snap.Store(&next)
        }
        s.mu.Unlock()
    }
}
```

---

### Task 19

The race: in `Get`, between `s.mu.Unlock()` and the second `s.mu.Lock()`, another goroutine can `Set(key, ...)` with a fresh value. The second `Lock` then `delete`s the *fresh* entry. Fix:

```go
func (s *shard) Get(key string) ([]byte, bool) {
    s.mu.Lock()
    e, ok := s.entries[key]
    if !ok {
        s.mu.Unlock()
        return nil, false
    }
    if time.Now().After(e.expiresAt) {
        // delete only if it is still the same pointer
        if cur, stillThere := s.entries[key]; stillThere && cur == e {
            delete(s.entries, key)
        }
        s.mu.Unlock()
        return nil, false
    }
    val := e.value
    s.mu.Unlock()
    return val, true
}
```

The `cur == e` pointer-identity check makes the delete safe under the same lock, with no second lock acquisition. Or simply hold the lock through both the read and the delete decision — the entire critical section is small.

---

### Task 20

```go
type cachingRT struct {
    base  http.RoundTripper
    cache *Sharded
    sf    singleflight.Group
}

func (c *cachingRT) RoundTrip(req *http.Request) (*http.Response, error) {
    if req.Method != http.MethodGet {
        return c.base.RoundTrip(req)
    }
    key := req.URL.String() + "|enc=" + req.Header.Get("Accept-Encoding")
    if body, ok := c.cache.Get(key); ok {
        return &http.Response{
            StatusCode: 200,
            Body:       io.NopCloser(bytes.NewReader(body)),
            Header:     http.Header{"X-Cache": []string{"HIT"}},
        }, nil
    }
    v, err, _ := c.sf.Do(key, func() (any, error) {
        resp, err := c.base.RoundTrip(req)
        if err != nil {
            return nil, err
        }
        defer resp.Body.Close()
        body, _ := io.ReadAll(resp.Body)
        ttl := parseMaxAge(resp.Header.Get("Cache-Control"))
        if ttl > 0 && resp.StatusCode == 200 {
            c.cache.Set(key, body, ttl)
        }
        return body, nil
    })
    if err != nil {
        return nil, err
    }
    body := v.([]byte)
    return &http.Response{
        StatusCode: 200,
        Body:       io.NopCloser(bytes.NewReader(body)),
        Header:     http.Header{"X-Cache": []string{"MISS"}},
    }, nil
}

func parseMaxAge(cc string) time.Duration {
    // pragmatic: parse "max-age=N"
    for _, part := range strings.Split(cc, ",") {
        part = strings.TrimSpace(part)
        if strings.HasPrefix(part, "max-age=") {
            n, err := strconv.Atoi(strings.TrimPrefix(part, "max-age="))
            if err == nil && n > 0 {
                return time.Duration(n) * time.Second
            }
        }
    }
    return 0
}
```

---

## Wrap-up

You should now have, in your own codebase:

- A baseline TTL cache with lazy and active eviction.
- A clock-injected variant that tests deterministically in microseconds.
- A sharded, observable, single-flight-guarded cache that survives a hot-key stampede.
- A copy-on-write reader path for read-heavy workloads.
- A multi-tier L1/L2 cache wiring up Redis.
- The byte-arena variant that hides millions of entries from the GC.

The next file, [find-bug.md](find-bug.md), takes the same primitives and shows what they look like when they go wrong. The file after that, [optimize.md](optimize.md), takes them and shows how to make them faster.
