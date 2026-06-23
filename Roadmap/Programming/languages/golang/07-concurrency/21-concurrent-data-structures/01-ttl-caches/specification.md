---
layout: default
title: Specification
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/specification/
---

# TTL Caches — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [TTL Cache Semantics](#ttl-cache-semantics)
3. [Time Sources and Monotonic Clocks](#time-sources-and-monotonic-clocks)
4. [Eviction Algorithms](#eviction-algorithms)
5. [Sharding and Lock Granularity](#sharding-and-lock-granularity)
6. [Production Libraries: API Surface Comparison](#production-libraries-api-surface-comparison)
7. [Single-Flight Integration](#single-flight-integration)
8. [Negative Caching](#negative-caching)
9. [Observability Conventions](#observability-conventions)
10. [Failure Modes and Edge Cases](#failure-modes-and-edge-cases)
11. [Configuration Knobs](#configuration-knobs)
12. [References](#references)

---

## Introduction

A TTL cache is not a single algorithm — it is a contract between several subsystems running concurrently:

- A **key-value store** that answers `Get` and accepts `Set` from many goroutines.
- A **clock** that decides which entries are dead.
- An **eviction policy** that drops entries when capacity is exceeded.
- A **sweeper** that reclaims memory for expired entries even when nobody reads them.
- An **admission and miss-coalescing layer** that protects the origin from thundering herds.

Unlike a plain map, a TTL cache has no single normative specification. Different libraries make different trade-offs around hit ratio, GC pressure, latency tail, and API ergonomics. This file enumerates the design space and documents what each major Go cache library actually guarantees.

The non-negotiables — what every correct TTL cache must do — are:

1. `Get` after `Set(k, v, ttl)` returns `v, true` for the duration `ttl`.
2. `Get` after `ttl` has elapsed returns `_, false` (the entry is logically gone).
3. Concurrent `Get`, `Set`, and `Delete` are race-free — no torn reads, no use-after-free.
4. Expired entries are eventually reclaimed; memory does not grow without bound when the workload keeps writing short-lived keys.

Everything else — eviction policy, sweep cadence, sharding, admission, observability — is a knob.

---

## TTL Cache Semantics

### Core operations

```go
type Cache[K comparable, V any] interface {
    Get(key K) (value V, ok bool)
    Set(key K, value V, ttl time.Duration)
    Delete(key K)
    Len() int
    Close() error
}
```

Some libraries add:

```go
GetWithExpiration(key K) (V, time.Time, bool)
SetDefault(key K, value V)              // uses cache-wide default TTL
SetWithCost(key K, value V, cost int64) // ristretto: admit by cost
GetOrLoad(key K, load func() (V, error)) (V, error)
```

### The "is it alive?" check

Every `Get` boils down to:

```go
e, ok := store.Load(key)
if !ok || time.Now().After(e.deadline) {
    return zero, false
}
return e.value, true
```

A naive implementation has three concurrency hazards:

1. **Read-then-check race.** Between `Load` and `time.Now`, the sweeper may delete `e`. With value types this is fine; with pointer types you may briefly hold a pointer that is no longer in the map. As long as the pointee is still allocated, this is harmless in Go (GC keeps it alive while you hold the reference). The danger is in C-style caches that free entries explicitly.
2. **Time skew.** If two readers call `time.Now` and disagree on whether the entry is alive, *both answers are correct*. The cache contract does not promise atomic expiration.
3. **Set-during-expiration race.** A reader sees the old entry, fetches it, then a writer puts a fresh one. The reader returns the stale value while the cache holds the fresh one. This is normally acceptable; if it is not, the caller must serialise reads and writes externally.

### Eviction vs expiration

The vocabulary matters:

- **Expiration** — the entry has lived past its TTL. It is logically dead.
- **Eviction** — the cache decides to remove a still-alive entry because it ran out of capacity (LRU, LFU, ARC, random).

A cache can have only expiration (no capacity bound), only eviction (no TTL — degenerates into LRU), or both. Most production caches do both.

### Idempotency of expiration

Calling `Get` after a key has expired must not panic, blow up, or behave differently from `Get` on a never-inserted key. Both return `_, false`. Production libraries hide this behind the `ok` boolean.

---

## Time Sources and Monotonic Clocks

Go's `time.Time` carries both a wall-clock reading and a monotonic reading. Operations on `time.Now()` values use the monotonic component for ordering, immune to wall-clock jumps (NTP, daylight saving, manual `date -s`).

```go
t1 := time.Now()
// ... wall clock jumps backward 1 hour ...
t2 := time.Now()
elapsed := t2.Sub(t1) // positive; uses monotonic
```

This is critical for TTL caches:

- `Set(k, v, ttl)` stores `deadline = time.Now().Add(ttl)`.
- `Get` checks `time.Now().Before(deadline)`.
- Wall-clock jumps do not break expiration.

**Exception.** Times that crossed a serialisation boundary (JSON, gob, protobuf) lose their monotonic component. If you store deadlines in Redis and read them back, they have only wall-clock readings. This is rarely a problem because the deadline is an absolute time, and the loss is in subtraction precision, not correctness.

**Anti-pattern.** Using `time.Now().UnixNano()` and storing `int64` deadlines. Saves a few bytes, but discards monotonic. Most caches accept the cost of holding `time.Time`.

### Clock injection for tests

Production code should not call `time.Now()` directly inside cache internals. Inject a `Clock` interface:

```go
type Clock interface {
    Now() time.Time
    After(d time.Duration) <-chan time.Time
}

type realClock struct{}
func (realClock) Now() time.Time                       { return time.Now() }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }
```

Tests pass a fake clock that advances on demand. Without this, every test must use `time.Sleep`, which is flaky and slow.

In Go 1.24+, `testing/synctest` provides a deterministic fake clock that integrates with the runtime, making `time.Sleep` and `time.After` deterministic inside a test bubble.

---

## Eviction Algorithms

### TTL-only (no capacity limit)

The simplest. Entries leave the cache only by expiring.

```go
type Entry[V any] struct {
    Value    V
    Deadline time.Time
}

type Cache[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]Entry[V]
}
```

Memory grows with insert rate until the sweeper reclaims. Suitable for caches with predictable working sets.

### LRU + TTL

When the cache reaches a capacity bound, evict the least-recently-used entry. Each `Get` and `Set` updates a usage record (doubly linked list or hash-keyed clock pointer).

```
type lruCache[K comparable, V any] struct {
    mu    sync.Mutex
    cap   int
    m     map[K]*lruNode[K, V]
    head  *lruNode[K, V] // most recent
    tail  *lruNode[K, V] // least recent
}
```

**Concurrency cost.** Every `Get` is a write (it moves the node to the head). This forces a write-lock on every read, eliminating the benefit of `sync.RWMutex`. High-throughput LRU caches typically shard, use atomic timestamps + periodic reorganisation, or switch to a clock-based admission policy.

### LFU and TinyLFU

Least Frequently Used: evict the entry with the lowest access count. Pure LFU has two well-known problems:

- **Counter scaling** — counters grow without bound.
- **Stale popularity** — yesterday's hot key blocks today's hot key from entering.

**TinyLFU** (Einziger and Friedman, 2017) solves both with:

- A **count-min sketch** for compact frequency estimation.
- **Aging** — periodically halve all counters to forget old popularity.
- A **doorkeeper** Bloom filter for one-hit-wonders.

**W-TinyLFU** (Window TinyLFU) — the variant used by ristretto and Caffeine (Java) — adds a small LRU window in front for recency-sensitive workloads.

### ARC (Adaptive Replacement Cache)

ARC keeps four lists:

- T1 — recently used once
- T2 — used at least twice (frequency)
- B1 — ghost entries evicted from T1
- B2 — ghost entries evicted from T2

The split between T1 and T2 adapts to the workload. ARC outperforms pure LRU on most real workloads but is patented (IBM) — most open-source projects avoid it. `github.com/hashicorp/golang-lru` provides an ARC implementation in pure Go.

### CLOCK and CLOCK-Pro

CLOCK approximates LRU with a circular buffer and a reference bit per entry. Eviction does one pass clearing reference bits and stops at the first entry whose bit was already 0. Cheaper per-operation than true LRU because `Get` only sets a bit (no list manipulation). The cost is approximate ordering.

CLOCK-Pro extends CLOCK with a cold/hot distinction analogous to ARC, without the patent.

### Comparison summary

| Algorithm | Hit ratio | Get cost | Set cost | Memory overhead | Notes |
|---|---|---|---|---|---|
| Plain TTL | Low (no eviction) | O(1) | O(1) | Low | Works when working set fits forever |
| LRU + TTL | Medium | O(1) under lock | O(1) under lock | List + map | Read = write, lock contention |
| LFU + TTL | Medium-high | O(1) + counter bump | O(log n) for heap | Counters | Sensitive to aging policy |
| TinyLFU + TTL | High | O(1) | O(1) | Sketch + LRU | What ristretto uses |
| ARC + TTL | Very high | O(1) | O(1) | 2x map | Patented; HashiCorp ARC available |
| CLOCK + TTL | Medium-high | O(1) | O(1) amortised | One bit per entry | Simple to implement |

The right pick depends on workload skew, latency budget, and how much you trust your benchmark.

---

## Sharding and Lock Granularity

The single-mutex cache is fine up to ~100 K ops/sec on commodity hardware. Beyond that, contention dominates and `pprof mutex` lights up.

**Standard fix: shard by hash.**

```go
const shards = 256

type Cache[K comparable, V any] struct {
    shards [shards]*shard[K, V]
}

type shard[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]Entry[V]
}

func (c *Cache[K, V]) shardFor(key K) *shard[K, V] {
    h := fnv32(key)
    return c.shards[h%shards]
}
```

### Choosing the shard count

- **Too few** — contention reappears on the hottest shard.
- **Too many** — each shard has a small map; cache-line waste, more allocations, weaker amortisation of sweeper work.
- **Rule of thumb** — 64 or 256 for most services. Above 1024 is rarely justified.

### Hash function selection

- **Cheap and good** — `xxhash` (`github.com/cespare/xxhash`) for byte keys.
- **Standard library** — `hash/maphash` since Go 1.14. Avoids importing third parties.
- **Built-in map hash** — not exported. Cannot reuse Go's internal map hashing without unsafe.
- **Anti-pattern** — `string(key) % shards` with bad hash. The shard map collapses to one shard.

### Shard locking strategy

- **`sync.RWMutex` per shard** — fine when reads dominate.
- **`sync.Mutex` per shard** — simpler, similar throughput when both reads and writes are frequent.
- **Lock-free maps** — `sync.Map` for the hot path, separate locked structure for metadata.

### `sync.Map` for TTL caches

`sync.Map` is optimised for:

- Many writers writing distinct keys.
- A single key that is read repeatedly after being written once.

Its `Load` is lock-free on the read path (after the key stabilises in the read-only map). For TTL caches with read-mostly workloads, `sync.Map` outperforms `RWMutex` + `map`. For write-mostly, the opposite.

`sync.Map` does *not* provide:

- A `Len` operation. You must maintain a separate atomic counter.
- Atomic compound operations. There is `LoadOrStore` and `CompareAndDelete`, but no general transaction.
- Iteration in any defined order.

Most production TTL caches in Go use `sync.Map` plus a separate min-heap or shard-local priority structure for expiration ordering.

---

## Production Libraries: API Surface Comparison

The three caches you will encounter most often in Go are **ristretto** (Dgraph), **bigcache** (Allegro), and **freecache** (Coocood). They make starkly different choices.

### `github.com/dgraph-io/ristretto`

- **Algorithm.** W-TinyLFU admission + Sampled LFU eviction.
- **Sharding.** 256 internal shards by hash, lock-free read path.
- **Memory model.** Stores `interface{}` values. GC traces them. Cost-based admission (you supply a cost per entry — bytes, CPU, anything).
- **Concurrency.** Reads buffered into per-CPU rings, drained asynchronously. Writes go through a Set buffer and may be dropped under load (this is by design — admission policy).
- **Loss semantics.** `Set` returns `bool` but may still drop the entry later if W-TinyLFU rejects it. Callers must not assume `Set(k, v) == true` implies subsequent `Get(k)` succeeds.

```go
cache, _ := ristretto.NewCache(&ristretto.Config{
    NumCounters: 1e7,         // 10x expected unique keys
    MaxCost:     1 << 30,     // 1 GiB
    BufferItems: 64,
})
cache.SetWithTTL("key", value, costInBytes, 5*time.Minute)
v, ok := cache.Get("key")
```

Best for **read-mostly, high-throughput** workloads where eventual consistency on writes is acceptable.

### `github.com/allegro/bigcache`

- **Algorithm.** FIFO with TTL. No LFU/LRU.
- **Sharding.** Configurable shard count.
- **Memory model.** Stores values as `[]byte` in per-shard ring buffers. **Avoids GC pressure** — Go's GC does not scan byte slices the way it scans maps of pointers.
- **Concurrency.** Per-shard `RWMutex`.
- **Trade-off.** You serialise values on `Set` and deserialise on `Get`. The CPU cost of (de)serialisation is the price of GC-free storage.

```go
cfg := bigcache.DefaultConfig(10 * time.Minute) // global TTL
cache, _ := bigcache.New(context.Background(), cfg)
cache.Set("key", []byte("value"))
v, err := cache.Get("key") // err == ErrEntryNotFound on miss
```

Best for **caches holding millions of entries** where GC pause is dominant. The lack of LRU is intentional — FIFO is good enough when entries are uniformly hot.

### `github.com/coocood/freecache`

- **Algorithm.** LRU-ish with TTL.
- **Sharding.** Fixed 256 segments.
- **Memory model.** Pre-allocates a single ring buffer of byte slices. Zero GC pressure on cache contents.
- **Concurrency.** Per-segment mutex.
- **API.** Byte-oriented: keys and values are both `[]byte`.

```go
cache := freecache.NewCache(100 * 1024 * 1024) // 100 MiB
cache.Set([]byte("key"), []byte("value"), 300)  // TTL in seconds
v, err := cache.Get([]byte("key"))
```

Best for **fixed-memory caches** where you want a hard cap with predictable behaviour. The fixed pre-allocation means freecache always uses its configured size — there is no slow ramp-up.

### Comparison table

| Aspect | ristretto | bigcache | freecache |
|---|---|---|---|
| Eviction | W-TinyLFU + LFU | FIFO | LRU-approximate |
| TTL granularity | Per-entry | Per-cache (or per-entry in newer versions) | Per-entry (seconds) |
| Value type | `interface{}` | `[]byte` | `[]byte` |
| GC pressure | Yes (boxed values) | Minimal | None |
| Memory bound | Cost-based | Soft (ring per shard) | Hard (pre-allocated) |
| Set may drop | Yes (admission) | No | Yes (capacity) |
| Concurrency model | Buffered + async drain | Per-shard RWMutex | Per-segment mutex |
| Best for | Hit-ratio sensitive | Many entries, large heap | Hard memory cap |

### Other notable Go caches

- `github.com/hashicorp/golang-lru` — pure LRU, optional 2Q and ARC variants, simple.
- `github.com/maypok86/otter` — Caffeine-equivalent in Go, generics, very high hit ratio.
- `github.com/karlseguin/ccache` — LRU with TTL, layered API.
- `github.com/patrickmn/go-cache` — simple `map[string]item`, single mutex; fine for low-traffic use.
- `github.com/VictoriaMetrics/fastcache` — focused on byte values, very low GC pressure.

### Choosing between them

| Workload | First choice |
|---|---|
| 10 K entries, mixed read/write | `go-cache` or stdlib `sync.Map` + own TTL |
| 1 M entries, read-heavy | ristretto |
| 100 M entries, large heap | bigcache or fastcache |
| Hard RAM budget | freecache or fastcache |
| LRU with simple API | hashicorp/golang-lru |
| Best hit ratio | otter |

---

## Single-Flight Integration

A TTL cache without miss coalescing leaks every cache miss into the origin. Under load, when a hot key expires, every concurrent reader misses simultaneously and slams the database. This is **thundering herd on expiry**.

The fix is `golang.org/x/sync/singleflight`:

```go
import "golang.org/x/sync/singleflight"

type LoadingCache[K comparable, V any] struct {
    cache *Cache[K, V]
    sf    singleflight.Group
    load  func(ctx context.Context, k K) (V, error)
    ttl   time.Duration
}

func (c *LoadingCache[K, V]) Get(ctx context.Context, key K) (V, error) {
    if v, ok := c.cache.Get(key); ok {
        return v, nil
    }
    v, err, _ := c.sf.Do(stringify(key), func() (any, error) {
        if v, ok := c.cache.Get(key); ok {
            return v, nil
        }
        v, err := c.load(ctx, key)
        if err != nil {
            return *new(V), err
        }
        c.cache.Set(key, v, c.ttl)
        return v, nil
    })
    if err != nil {
        return *new(V), err
    }
    return v.(V), nil
}
```

### Key properties

1. **One in-flight load per key.** If 1000 goroutines miss at once, exactly one call to `load` happens; the other 999 wait on the result.
2. **Double-check inside `Do`.** Otherwise, a goroutine that wins the race to `Do` but lost the race to read the freshly populated cache will re-fetch.
3. **Error sharing.** If `load` returns an error, all waiters get the same error. That is usually correct (the upstream is down for all of them), but be careful with retry semantics — they will all retry simultaneously on the next request.
4. **`DoChan` for cancellation.** `sf.Do` is blocking. `sf.DoChan` returns a channel; combine with `select` on `ctx.Done()` for cancellable waits. Note: cancelling one waiter does not cancel the in-flight load.
5. **`Forget(key)`** — if the load is permanently broken, call `sf.Forget(key)` so the next caller retries instead of getting the cached error indefinitely.

### Probabilistic early refresh

Even with singleflight, every entry that hits its TTL exactly causes a brief stall while the lone fetcher runs. **Probabilistic early expiration** (XFetch, from Vattani et al., 2015) hedges:

```go
func shouldRefresh(deadline time.Time, ttl, delta time.Duration) bool {
    now := time.Now()
    timeLeft := deadline.Sub(now)
    if timeLeft <= 0 {
        return true
    }
    // beta controls aggressiveness; ln(rand) gives an exponential
    beta := -delta.Seconds() * math.Log(rand.Float64())
    return timeLeft.Seconds() < beta
}
```

A small fraction of requests trigger a refresh *before* the TTL fires, so the next round of expiry has nothing to do.

### Compose: singleflight + jittered TTL + early refresh

The production pattern:

1. Jitter the TTL on `Set` (`ttl + rand.Float64()*jitter`).
2. Use singleflight on `Get` to coalesce concurrent misses.
3. Probabilistically early-refresh hot keys.
4. Cache negative results too, with a shorter TTL.

---

## Negative Caching

When `load` returns "not found," should you cache that fact?

**Yes, but shortly.** If 1000 goroutines miss a non-existent key, you do *not* want 1000 origin calls. Cache the absence with a short TTL (often 1–10 seconds).

```go
type entry[V any] struct {
    value    V
    deadline time.Time
    negative bool
}

func (c *Cache[K, V]) GetOrLoad(key K) (V, bool, error) {
    e, ok := c.get(key)
    if ok && e.negative {
        return *new(V), false, ErrNotFound
    }
    if ok {
        return e.value, true, nil
    }
    v, err := c.load(key)
    if errors.Is(err, ErrNotFound) {
        c.setNegative(key, c.negTTL)
        return *new(V), false, ErrNotFound
    }
    if err != nil {
        return *new(V), false, err
    }
    c.set(key, v, c.ttl)
    return v, true, nil
}
```

**Tuning the negative TTL.** Too long → freshly created keys are invisible to readers until the negative cache expires (write-then-read consistency hole). Too short → less protection from herd. Often 1–5 seconds in OLTP services.

**Anti-pattern.** Treating all errors as negative results. A transient network error should *not* poison the cache. Only "definitely not found" should be cached negatively.

---

## Observability Conventions

A TTL cache without metrics is a black box. The conventional metrics are:

| Metric | Type | Unit | What it tells you |
|---|---|---|---|
| `cache_hits_total` | counter | events | Numerator of hit ratio |
| `cache_misses_total` | counter | events | Denominator (along with hits) |
| `cache_hit_ratio` | gauge | 0..1 | Health summary; degrades on regression |
| `cache_evictions_total` | counter (labelled by reason) | events | Capacity vs TTL vs explicit Delete |
| `cache_expired_on_read_total` | counter | events | Sweeper underrunning; tune cadence |
| `cache_size_entries` | gauge | items | Capacity bound check |
| `cache_size_bytes` | gauge | bytes | Memory bound check |
| `cache_sweep_duration_seconds` | histogram | seconds | Long sweeps signal sweeper backlog |
| `cache_sweep_removed` | counter | items | Sweeper effectiveness |
| `cache_load_duration_seconds` | histogram (labelled by source) | seconds | Origin latency |
| `cache_load_inflight` | gauge | goroutines | Singleflight effectiveness |
| `cache_load_errors_total` | counter | events | Origin health |
| `cache_admission_rejected_total` | counter | events | TinyLFU rejection rate (ristretto) |

### Hit ratio is a lagging indicator

Hit ratio degrades only after the harm is done. Better to alert on:

- **Origin RPS** from the cache layer — sudden spikes indicate herd or eviction storm.
- **Load p99 latency** — origin slowing down before throughput drops.
- **Sweep duration** — sweeper falling behind.

### Tracing

Tag spans with `cache.hit=true/false` and `cache.layer=L1/L2/origin`. This makes "did the cache help?" a one-query dashboard.

### Sampling

For very high-throughput caches, exporting every counter increment is expensive. Use:

- `expvar` for cheap atomic counters.
- `prometheus.Counter` with batched updates.
- For latency, sample one in N operations.

### `runtime.SetCPUProfileRate` and `runtime/trace`

If the sweeper is suspected of blocking GC or contending with normal traffic, capture a `runtime/trace` profile during a sweep window. The trace viewer shows scheduler latency per goroutine.

---

## Failure Modes and Edge Cases

### Sweeper holds a write-lock while iterating

```go
func (c *Cache[K, V]) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.m {
        if time.Now().After(e.deadline) {
            delete(c.m, k)
        }
    }
}
```

For a 10 M entry cache, this holds the write-lock for hundreds of milliseconds. Every reader stalls.

**Fix.** Sweep in batches, releasing the lock between batches; or use a min-heap of deadlines so the sweeper only touches entries that are actually expired; or shard, so the impact is bounded to one shard.

### Sweeper goroutine never exits

```go
go func() {
    for range time.Tick(time.Second) {
        c.sweep()
    }
}()
```

`time.Tick` cannot be stopped. The cache `Close` does not release this goroutine; on each test that creates a cache, you leak one. Use `time.NewTicker` and stop it explicitly.

### `time.After` in a loop allocates

Each `time.After` allocates a fresh timer. In a sweep loop, this allocates per iteration:

```go
for {
    select {
    case <-time.After(time.Second): // allocation per iteration
        c.sweep()
    case <-quit:
        return
    }
}
```

Use a single `time.NewTicker` and read from `ticker.C` instead.

### Iteration ordering and the sweeper

`for k, v := range m` does not visit every entry on each pass (Go randomises iteration order). If the sweeper bails out early ("removed enough this round"), some entries may take many sweeps to evict. For correctness this is fine; for capacity guarantees this is suspect. A min-heap of deadlines fixes it.

### Zero-TTL semantics

What does `Set(k, v, 0)` mean?

- Some libraries treat it as "no expiration" (effectively infinite TTL).
- Some treat it as "already expired" (so `Get` returns false immediately).
- Some treat it as "use cache-wide default."

This is library-specific. Document it explicitly. Reject negative TTLs.

### Negative TTL

```go
cache.Set("k", "v", -1*time.Second)
```

Some libraries silently treat as zero. Some panic. Some accept it (entry is dead on arrival). Validate at API boundary; reject as a programmer bug.

### Process restart loses everything

A pure in-memory TTL cache is gone after restart. For systems where cold start floods the origin, consider:

- A small disk-persisted snapshot (only viable for small caches).
- A two-tier setup with a remote cache (Redis) below the in-memory tier.
- Pre-warming on startup from a known list of hot keys.

### Multiple processes, no coherence

Two instances of the service hold independent caches. A write on one is invisible to the other until both expire and reload. This is "best-effort" caching and is the dominant pattern in stateless services. Coherence requires either a shared cache (Redis) or invalidation (pub/sub).

---

## Configuration Knobs

A production TTL cache exposes:

| Knob | Typical range | Effect |
|---|---|---|
| Default TTL | 30 s — 1 h | Bigger TTL → higher hit ratio, more stale data |
| Jitter fraction | 5% — 25% | Spreads expiry across time |
| Capacity (entries) | 10 K — 100 M | Memory bound |
| Capacity (bytes) | 10 MB — 100 GB | More precise than entry count |
| Shard count | 32 — 1024 | Throughput; rarely tuned |
| Sweeper cadence | 100 ms — 60 s | Tighter cadence → less memory bloat, more CPU |
| Sweeper batch size | 100 — 10 K | Bigger batch → fewer lock acquisitions, longer stalls |
| Negative TTL | 1 s — 1 min | Herd protection vs write-then-read freshness |
| Single-flight | on / off | On in essentially every production cache |
| Early refresh delta | 0% — 30% of TTL | Bigger → fewer expiry stalls, more origin load |

### Dynamic reconfiguration

Most knobs should be **immutable after construction**. Live tuning of capacity is hard (you may need to evict to shrink). Live tuning of shard count is essentially impossible (rehashes everything).

What can be tuned at runtime:

- Default TTL on new inserts.
- Jitter fraction.
- Negative TTL.
- Sweeper cadence (next tick uses new value).
- Single-flight on/off.

What requires a restart:

- Capacity.
- Shard count.
- Eviction algorithm.

---

## References

- **`golang.org/x/sync/singleflight`** — <https://pkg.go.dev/golang.org/x/sync/singleflight>
- **ristretto README** — <https://github.com/dgraph-io/ristretto>
- **bigcache README** — <https://github.com/allegro/bigcache>
- **freecache README** — <https://github.com/coocood/freecache>
- **otter (Caffeine for Go)** — <https://github.com/maypok86/otter>
- **HashiCorp `golang-lru`** — <https://github.com/hashicorp/golang-lru>
- **TinyLFU: A Highly Efficient Cache Admission Policy** (Einziger, Friedman, 2017) — <https://arxiv.org/abs/1512.00727>
- **ARC: A Self-Tuning, Low Overhead Replacement Cache** (Megiddo, Modha, 2003) — USENIX FAST '03
- **Optimal Probabilistic Cache Stampede Prevention** (Vattani, Chierichetti, Lowenstein, 2015) — <http://cseweb.ucsd.edu/~avattani/papers/cache_stampede.pdf>
- **Caffeine design notes** (Ben Manes) — <https://github.com/ben-manes/caffeine/wiki/Design>
- **Go memory model** — <https://go.dev/ref/mem>
- **Time package documentation** — <https://pkg.go.dev/time>
- **`testing/synctest` design doc** — <https://github.com/golang/go/issues/67434>
- **`sync.Map` internals discussion** — <https://github.com/golang/go/blob/master/src/sync/map.go>
- **W-TinyLFU paper (TinyLFU + windowed LRU)** — <https://dl.acm.org/doi/10.1145/3149371>
