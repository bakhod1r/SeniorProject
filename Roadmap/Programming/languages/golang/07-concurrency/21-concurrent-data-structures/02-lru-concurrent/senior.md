---
layout: default
title: Senior
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/senior/
---

# Concurrent LRU — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Real Bottlenecks at Senior Scale](#the-real-bottlenecks-at-senior-scale)
3. [Lock-Free Reads: BP-Wrapper](#lock-free-reads-bp-wrapper)
4. [The Clock Algorithm: Probabilistic LRU](#the-clock-algorithm-probabilistic-lru)
5. [Segmented LRU](#segmented-lru)
6. [The ristretto Architecture in Depth](#the-ristretto-architecture-in-depth)
7. [W-TinyLFU: The Algorithm](#w-tinylfu-the-algorithm)
8. [Count-Min Sketch: How Frequency is Tracked](#count-min-sketch-how-frequency-is-tracked)
9. [The Doorkeeper Optimization](#the-doorkeeper-optimization)
10. [Cost-Based Eviction](#cost-based-eviction)
11. [S3-FIFO: The 2023 Algorithm](#s3-fifo-the-2023-algorithm)
12. [Hot Key Mitigation Strategies](#hot-key-mitigation-strategies)
13. [Memory Layout and Cache Line Optimization](#memory-layout-and-cache-line-optimization)
14. [GC Pressure: When the LRU Becomes the Garbage](#gc-pressure-when-the-lru-becomes-the-garbage)
15. [Off-Heap Caches: bigcache and freecache](#off-heap-caches-bigcache-and-freecache)
16. [Sharding Strategies for Massive Caches](#sharding-strategies-for-massive-caches)
17. [Cache Coherence Across Pods](#cache-coherence-across-pods)
18. [Designing for Cache-Friendly Workloads](#designing-for-cache-friendly-workloads)
19. [Building a Production Cache from First Principles](#building-a-production-cache-from-first-principles)
20. [Profiling Mutex Contention](#profiling-mutex-contention)
21. [Profiling Cache Hit Rate](#profiling-cache-hit-rate)
22. [Capacity Planning](#capacity-planning)
23. [Cache Stampede Prevention at Scale](#cache-stampede-prevention-at-scale)
24. [Cache Poisoning Defenses](#cache-poisoning-defenses)
25. [Cache vs Database Index: When the Database is Enough](#cache-vs-database-index-when-the-database-is-enough)
26. [Senior-Level Mistakes](#senior-level-mistakes)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)

---

## Introduction

At senior level, the question shifts from "how do I make a cache work?" to "how do I make a cache that performs at 100M ops/sec, survives adversarial workloads, and degrades gracefully under failure?" This file is about the mechanisms — lock-free data structures, frequency-aware admission, off-heap storage, careful memory layout — that production caches use under heavy load.

You will not implement most of this from scratch. You will *evaluate* libraries (ristretto, bigcache, freecache), *understand* their trade-offs, and *design* the cache topology of a service that handles real traffic. The goal of this file is to make you a competent reviewer of cache architecture, not just a user.

After reading this file you will:

- Understand BP-Wrapper and why it enables lock-free reads in modern caches.
- Be able to explain W-TinyLFU end to end: window LRU, segmented LRU, TinyLFU sketch, doorkeeper, admission policy.
- Know when to use ristretto, when to use bigcache, and when to use neither.
- Be able to diagnose hot-key contention and apply the right mitigation.
- Understand GC pressure from caches and the off-heap solutions.
- Be able to design a cache topology that survives 10x traffic spikes, adversarial scans, and downstream outages.

---

## The Real Bottlenecks at Senior Scale

At 100M ops/sec, the dominant costs are:

1. **Mutex contention** — already addressed by sharding at middle level. Past 64 shards, diminishing returns.
2. **Atomic operations** — even uncontended atomic CAS is ~5 ns. At 100M ops/sec, that's 500 ms/sec across all cores.
3. **Memory allocation** — every `*entry` and `*list.Element` is a heap allocation. The allocator becomes a bottleneck around 50M allocs/sec.
4. **GC scan time** — the cache holds millions of pointers. GC pause grows linearly with pointer count.
5. **Cache-line bouncing** — false sharing on shared atomics costs 50-100 ns per bounce.
6. **TLB misses** — large maps span many memory pages. Random access causes TLB pressure.
7. **NUMA effects** — on multi-socket machines, cross-socket cache access is 3-10x slower than local.

The senior-level techniques each address one or more of these costs. Lock-free reads address (1). Count-Min Sketch addresses (3) and (4). Off-heap storage addresses (3), (4), and (6). NUMA-aware sharding addresses (7).

You will rarely hit all of these in a single workload, but knowing the menu is the difference between "throw more shards at it" and a thoughtful architecture.

---

## Lock-Free Reads: BP-Wrapper

A pure lock-free LRU is hard because `Get` mutates the recency list. BP-Wrapper (2008 paper by Ding & Zhang) is the elegant trick that most modern caches use: **batch the recency updates**.

### The idea

`Get(k)` returns the value immediately, with no list mutation. The access event is dropped into a small, per-shard ring buffer. Periodically, a background goroutine drains the buffer and updates the recency list.

```go
type Cache struct {
    items map[K]*entry[V]      // protected by Read lock or atomic load
    list  *list.List           // protected by writer lock
    buf   chan accessEvent[K]  // per-shard ring buffer
}

func (c *Cache) Get(k K) (V, bool) {
    c.lock.RLock()
    e, ok := c.items[k]
    c.lock.RUnlock()
    if !ok {
        return nil, false
    }
    // record access without taking the writer lock
    select {
    case c.buf <- accessEvent[K]{k, time.Now()}:
    default:
        // buffer full — drop this access event
    }
    return e.val, true
}

func (c *Cache) processBuf() {
    for ev := range c.buf {
        c.lock.Lock()
        if e, ok := c.items[ev.k]; ok {
            c.list.MoveToFront(e.elem)
        }
        c.lock.Unlock()
    }
}
```

### Consequences

- **Get is lock-free in the hot path.** Only a non-blocking channel send.
- **The recency list lags reality.** A few microseconds of delay. Statistically irrelevant for cache decisions.
- **Buffer overflow drops events.** Under extreme load, some accesses are forgotten. The cache becomes a slightly-noisier LRU. Eviction decisions are still correct on average.
- **The background goroutine becomes a critical resource.** If it falls behind, the buffer overflows and accuracy degrades.

ristretto uses exactly this pattern with a more efficient lossy buffer (no channel, raw array with atomic position).

### When BP-Wrapper helps

When reads dominate and contention on the recency list is the bottleneck. Typical: read-heavy services with thousands of goroutines.

### When it doesn't

When the access pattern is write-heavy or when accuracy of recency is critical. The lossy nature means the cache may evict items that were just used (if the access event was dropped). In practice this is a few percent hit-rate loss vs perfect LRU.

---

## The Clock Algorithm: Probabilistic LRU

Clock is a cheap approximation of LRU that has been used in operating systems since the 1960s. It works on a circular list with a per-entry "referenced" bit.

### Data structure

```go
type clockEntry[K, V any] struct {
    key       K
    val       V
    referenced atomic.Bool
}

type ClockCache[K comparable, V any] struct {
    entries []clockEntry[K, V]
    items   map[K]int // K -> index in entries
    hand    int       // current eviction cursor
    mu      sync.Mutex
}
```

### Get

```go
func (c *ClockCache[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    idx, ok := c.items[k]
    if !ok {
        var zero V
        return zero, false
    }
    c.entries[idx].referenced.Store(true) // mark as recently used
    return c.entries[idx].val, true
}
```

### Set / Evict

```go
func (c *ClockCache[K, V]) Add(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if idx, ok := c.items[k]; ok {
        c.entries[idx].val = v
        c.entries[idx].referenced.Store(true)
        return
    }
    // Find a victim: walk the clock hand until referenced=false
    for {
        e := &c.entries[c.hand]
        if !e.referenced.Load() {
            // evict this slot
            delete(c.items, e.key)
            e.key = k
            e.val = v
            e.referenced.Store(true)
            c.items[k] = c.hand
            c.hand = (c.hand + 1) % len(c.entries)
            return
        }
        e.referenced.Store(false) // give it a second chance
        c.hand = (c.hand + 1) % len(c.entries)
    }
}
```

### Why this is useful

- **Get can use a read lock (or atomic store of `referenced`).** No list mutation.
- **Per-entry allocations are zero.** Pre-allocated slice.
- **Memory is contiguous.** Better cache behaviour than a linked list.

### What it sacrifices

- **Not strict LRU.** Items that were accessed once become equally evictable as items accessed many times after one cycle of the clock hand.
- **Worst-case eviction is O(n).** All entries `referenced=true`; clock walks the whole slice clearing flags. In practice this is rare.

Linux's page cache uses a variant called CLOCK-Pro. The principle is the same: trade strict LRU for simpler concurrent updates.

---

## Segmented LRU

A standard LRU treats all entries equally. Segmented LRU (SLRU) divides the cache into a **protected** segment and a **probationary** segment.

### Layout

```text
Protected segment (80% capacity)      Probationary segment (20% capacity)
MRU                              LRU  MRU                            LRU
[a][b][c][d][e][f][g][h][i][j][k]    [m][n][o][p]
                                      └─ new entries land here
```

### Rules

- A new entry enters probation.
- A hit in probation promotes to protected.
- A hit in protected updates recency within protected.
- An eviction from protected demotes to probation (kept around in case it is hot).
- An eviction from probation drops entirely.

### Why it works

A one-time access does not immediately become a "hot" entry. It must prove itself by being accessed *again* before it gains protected status. This makes SLRU much more scan-resistant than plain LRU.

### Implementation

```go
type SLRUCache[K comparable, V any] struct {
    protected     *lru.Cache[K, V]
    probationary  *lru.Cache[K, V]
    mu            sync.Mutex
}

func (c *SLRUCache[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.protected.Get(k); ok {
        return v, true
    }
    if v, ok := c.probationary.Peek(k); ok {
        c.probationary.Remove(k)
        c.protected.Add(k, v) // promote
        return v, true
    }
    var zero V
    return zero, false
}

func (c *SLRUCache[K, V]) Add(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.protected.Contains(k) {
        c.protected.Add(k, v)
        return
    }
    c.probationary.Add(k, v)
}
```

This is also the structure inside W-TinyLFU's "main cache."

---

## The ristretto Architecture in Depth

ristretto is the de facto high-performance Go cache. Its design choices are worth understanding even if you do not use it directly.

### High-level structure

```text
┌─────────────────────────────────────────────────────────────────┐
│  Get(k)                          Set(k, v, cost)                │
│   │                               │                              │
│   ▼                               ▼                              │
│  storeMap[k] (sharded, RLock)    setBuf (channel)               │
│   │                               │                              │
│   │                               ▼                              │
│   │                               processItems (background)      │
│   │                                 │                            │
│   │                                 ├─ admit? ───►  storeMap     │
│   │                                 │              + LFU         │
│   │                                 │                            │
│   │                                 └─ evict ────►  storeMap     │
│   │                                                              │
│   ▼                                                              │
│  getBuf (per-shard array, lossy)                                 │
│   │                                                              │
│   └─► processBuf (background) ─► update LFU access counts       │
└─────────────────────────────────────────────────────────────────┘
```

### Key components

1. **storeMap**: a sharded map (256 shards) for O(1) lookup.
2. **getBuf**: per-shard lossy buffers for access events. Get appends; background drains.
3. **setBuf**: a channel for Set operations. Set sends; background admits or rejects.
4. **policy (lfuPolicy)**: a SLRU plus a Count-Min Sketch frequency counter.
5. **processItems goroutine**: drains setBuf, decides admission, performs evictions, fires callbacks.

### Get path

```go
func (c *Cache) Get(key uint64) (interface{}, bool) {
    if c == nil || key == 0 {
        return nil, false
    }
    value, ok := c.store.Get(key)
    if ok {
        c.Metrics.add(hit, key, 1)
    } else {
        c.Metrics.add(miss, key, 1)
    }
    c.getBuf.Push(key) // lossy, non-blocking
    return value, ok
}
```

No locks past the shard's RLock in `store.Get`. The access event is pushed to a per-thread (per-shard) buffer.

### Set path

```go
func (c *Cache) Set(key uint64, value interface{}, cost int64) bool {
    if c == nil || key == 0 {
        return false
    }
    select {
    case c.setBuf <- &item{...}:
        return true
    default:
        c.Metrics.add(dropSets, key, 1)
        return false
    }
}
```

Set is also non-blocking. If the buffer is full, the Set is *dropped*. The cache prefers consistent latency over guaranteed admission.

### processItems

The background goroutine:

```go
func (c *Cache) processItems() {
    for {
        select {
        case it := <-c.setBuf:
            // 1. Check admission via TinyLFU
            // 2. If admitted, store and update policy
            // 3. If not admitted, drop silently
        case <-c.cleanupTicker.C:
            // 4. Periodic maintenance (sketch decay)
        }
    }
}
```

This goroutine is the heart of ristretto. Everything else is bookkeeping around it.

### Trade-offs

ristretto sacrifices strict eviction ordering (Set may be dropped, Get may not be recorded) for throughput. Empirically, hit-rate is within 1-2% of perfect LRU and often better than LRU for skewed workloads. The cost is a much more complex API and harder debugging.

---

## W-TinyLFU: The Algorithm

W-TinyLFU is ristretto's eviction algorithm. The name unpacks as:

- **W** = Window: a small LRU in front.
- **TinyLFU** = a tiny LFU sketch deciding what enters the main cache.

### Layout

```text
   New entry          Window LRU          Main cache (SLRU)
   ─────────►         (1% of cap)         (99% of cap)
                      ┌────────┐          ┌──────────────┐
                      │ MRU    │          │ Protected    │
                      │  ...   │  ──TinyLFU──►  ...      │
                      │ LRU    │ admit?   │ Probationary │
                      └────────┘          └──────────────┘
```

### Rules

1. A new entry enters the **window LRU**. It stays for a short while regardless of frequency.
2. When the window LRU evicts, the victim is offered to the main cache.
3. The TinyLFU sketch decides: is this victim more frequent than the main cache's victim?
   - If yes: admit to probationary; main cache's victim is dropped.
   - If no: drop the window victim.
4. Hits in probationary promote to protected.
5. Demotion from protected goes back to probationary.
6. The sketch ages periodically so stale popularity is forgotten.

### Why it works

- **Window** absorbs one-time scans. New entries get a brief chance before competing on frequency.
- **TinyLFU** admission is the gatekeeper. Only entries with proven popularity occupy the main cache.
- **SLRU** in the main cache provides scan resistance within established entries.

Empirically W-TinyLFU achieves 90-99% hit rate on workloads where plain LRU achieves 60-80%.

### Reading the source

In ristretto:

- **`policy.go`**: `tinyLFU` struct combines the sketch and the SLRU.
- **`sketch.go`**: the Count-Min Sketch.
- **`doorkeeper`** (`policy.go`): a bloom-like filter to ignore single-access keys.

The full reading is ~500 lines. Worth a Saturday morning.

---

## Count-Min Sketch: How Frequency is Tracked

A Count-Min Sketch (CMS) is a probabilistic data structure that estimates the frequency of an element in a stream. ristretto uses one to track approximate access counts.

### Structure

A 2D array of counters:

```text
Row 0: hash_0(key) → counter[0][hash_0(key) % width]
Row 1: hash_1(key) → counter[1][hash_1(key) % width]
Row 2: hash_2(key) → counter[2][hash_2(key) % width]
Row 3: hash_3(key) → counter[3][hash_3(key) % width]
```

To record an access: increment all four counters.
To estimate frequency: return the *minimum* of the four counter values.

### Why minimum?

Collisions can only inflate counts (two keys mapping to the same counter accumulate together). The minimum across hashes gives an upper bound on the actual count for the queried key.

### Size and accuracy

ristretto's default is 4 rows × 1M counters × 4 bits each = 2 MB total. For a key space of 10M, expected error is ~0.1% — plenty for ranking.

### Aging

To forget stale popularity, ristretto periodically halves every counter (right shift by 1). This decays counts exponentially. Keys that were popular yesterday but cold today gradually lose their advantage.

### Implementation sketch

```go
type cmSketch struct {
    rows  [4][]uint64 // 4-bit counters packed
    seed  [4]uint64
    mask  uint64
}

func (s *cmSketch) Increment(h uint64) {
    for i := range s.rows {
        idx := (h ^ s.seed[i]) & s.mask
        s.add(i, idx) // saturating 4-bit increment
    }
}

func (s *cmSketch) Estimate(h uint64) uint64 {
    var min uint64 = math.MaxUint64
    for i := range s.rows {
        idx := (h ^ s.seed[i]) & s.mask
        if c := s.get(i, idx); c < min {
            min = c
        }
    }
    return min
}
```

The actual ristretto code uses bit-packing and SIMD-friendly access patterns. Fast.

---

## The Doorkeeper Optimization

The CMS counts every access. For a workload with many one-time keys (a scan), the sketch fills with noise. The **doorkeeper** is a small bloom-like filter that absorbs first accesses.

### How it works

- On every access, check the doorkeeper.
- If the key is NOT in the doorkeeper, add it but do NOT increment the CMS.
- If the key IS in the doorkeeper, increment the CMS.

The doorkeeper is cleared every `aging` interval, same as CMS decay.

### Effect

Single-access keys never reach the CMS. The sketch is dominated by keys with at least two accesses — a much better signal of true popularity.

### Cost

A few KB of memory for the doorkeeper bit array. CPU cost is one extra hash + bit set per access. Net: hit rate improvement of 5-15% on scan-heavy workloads.

---

## Cost-Based Eviction

ristretto uses **cost** instead of count for capacity. Each entry has a cost (you provide it); the cache holds `Σ costs ≤ MaxCost`.

```go
cache.Set(key, value, cost)
```

For uniform-size values, cost = 1 and behaviour matches count-based caching. For variable-size values (cached HTTP responses, marshalled blobs):

```go
cache.Set(key, response, int64(len(response.Body)))
```

The cache now bounds total *bytes*, not entries. Big responses are evicted preferentially.

### Why this matters

A count-based cache with capacity 1000 might hold 1000 × 10 KB responses (10 MB) or 1000 × 10 MB responses (10 GB). Cost-based gives you predictable memory.

### Trade-offs

- **You must know the cost.** For arbitrary types this requires either reflection or a per-type estimator.
- **Cost changes are hard.** If a cached value's effective cost grows (e.g., a slice expands), the cache does not know.
- **Eviction is more complex.** Removing one big entry frees as much space as removing many small ones; the policy must weigh this.

For services where value sizes vary by 10x or more, cost-based is essentially required to prevent OOM.

---

## S3-FIFO: The 2023 Algorithm

S3-FIFO (Simple, Scalable, Small queues FIFO) is a 2024 paper (Yang et al., FAST'24) that beats LRU and W-TinyLFU on most real-world traces while using only three FIFO queues.

### Structure

```text
   New entry
   ─────────►   small (10%)    ──demote──►   main (90%)
                    │                            │
                    │ evict (1 hit) ────────────►│
                    │                            │
                    │ evict (0 hits)             │
                    └────────────►  ghost  ◄─────┘
```

Three FIFO queues:

1. **Small** (10% of capacity): all new entries.
2. **Main** (90% of capacity): items with proven popularity.
3. **Ghost** (90% of capacity, keys only): record of recent main-cache evictions.

### Rules

- New key → small queue.
- Small queue eviction: if hit count ≥ 1, promote to main; else, send key to ghost.
- Main queue eviction: if hit count ≥ 1, requeue at the back; else, send key to ghost.
- A miss whose key is in ghost: insert directly to main (it was once hot).

### Why it works

- **FIFO is simpler than LRU.** No `MoveToFront`. Just append-and-pop. Hugely cache-friendly.
- **Small queue handles scans.** Scans flow through small, never reaching main.
- **Ghost remembers.** A key that was hot, briefly forgotten, can quickly return.

### Concurrency benefit

FIFO operations are append-and-pop — naturally lock-friendly. The recency-update-on-hit problem that plagues LRU does not exist. A hit just increments a counter on the entry, no list manipulation.

### Empirical results

The S3-FIFO paper reports hit-rate matching or beating W-TinyLFU on most traces, with simpler code and better concurrent performance.

### Status in Go

A few S3-FIFO implementations exist. As of mid-2026, none has reached the popularity of `hashicorp/golang-lru/v2` or `dgraph-io/ristretto`. Worth watching as the ecosystem catches up.

---

## Hot Key Mitigation Strategies

A hot key — one that gets 50%+ of total operations — defeats sharding. Mitigation strategies:

### Strategy 1 — Local L1 cache per goroutine

```go
type LocalCache struct {
    local  map[string]*Value
    shared *Cache
}

func (l *LocalCache) Get(k string) *Value {
    if v, ok := l.local[k]; ok {
        return v
    }
    v, _ := l.shared.Get(k)
    l.local[k] = v
    return v
}
```

Each goroutine maintains its own tiny cache (e.g., 10 entries). For hot keys, the local cache absorbs all hits. No locks.

Variant: a `sync.Pool` of per-goroutine caches so they are reused across requests.

### Strategy 2 — Replicated hot key

The hottest 0.1% of keys live in N parallel atomic pointers, one per shard. Reads hit the local copy:

```go
type HotKey[V any] struct {
    replicas [16]atomic.Pointer[V]
}

func (h *HotKey[V]) Load(shard int) *V {
    return h.replicas[shard].Load()
}

func (h *HotKey[V]) Store(v *V) {
    for i := range h.replicas {
        h.replicas[i].Store(v)
    }
}
```

Each shard's CPU reads from its own replica — no cross-CPU traffic.

### Strategy 3 — Snapshot-and-broadcast

For "current value of X" use cases (rate limits, leader id, current flag value):

```go
type Snapshot[V any] struct {
    cur atomic.Pointer[V]
}

func (s *Snapshot[V]) Get() *V { return s.cur.Load() }

// background updater periodically refreshes
func (s *Snapshot[V]) Update(v *V) { s.cur.Store(v) }
```

Reads are ~5 ns. Updates are independent of reads. No locks. Used for "the current value of a singleton" — rate limit window, leader election state, latest config.

### Strategy 4 — Lottery scheduling

If 100 goroutines all want the same key in flight, only 1 should fetch. `singleflight` does this. The 99 others queue and share the result.

### Strategy 5 — Sticky routing

Route requests for hot key K to a specific pod that holds K in its local L1. The other pods never see K. Eliminates cross-pod cache duplication for very hot keys.

Used by some video CDN architectures. Hard to retrofit; design for it from the start.

---

## Memory Layout and Cache Line Optimization

A 64-byte cache line is the unit of CPU memory coherency. Two pieces of data on the same line "share" a coherency cost: modifying one invalidates the other across all CPU caches.

### False sharing

```go
type Stats struct {
    hits   atomic.Uint64 // 8 bytes
    misses atomic.Uint64 // 8 bytes — same cache line as hits!
}
```

When goroutine A increments `hits` on CPU 0 and goroutine B increments `misses` on CPU 1, the cache line ping-pongs between the two CPUs. Each increment costs 50-100 ns instead of 5 ns.

### Fix: pad

```go
type Stats struct {
    hits   atomic.Uint64
    _      [56]byte
    misses atomic.Uint64
    _      [56]byte
}
```

Each counter on its own line. 10x faster under contention.

### Verification

```go
func init() {
    if unsafe.Offsetof(Stats{}.misses) - unsafe.Offsetof(Stats{}.hits) < 64 {
        panic("hits and misses on same cache line")
    }
}
```

### Layout for shard structs

```go
type shard struct {
    mu    sync.Mutex // 8 bytes
    items map[K]V    // 8 bytes (pointer to header)
    list  *list.List // 8 bytes
    _pad  [40]byte   // total = 64 bytes
}
```

Each shard owns a 64-byte chunk. Allocating shards as separate heap objects ensures alignment.

### Pre-allocation

For caches you know upfront will be capacity N:

```go
type entrySlab struct {
    entries [N]entry
    next    atomic.Uint32 // next free slot
}
```

Pre-allocate all entries at startup; no allocations on Set. The entries are contiguous, friendly to L1/L2 cache prefetching.

The trade-off: you waste memory for unused slots. For caches that fill quickly this is irrelevant.

---

## GC Pressure: When the LRU Becomes the Garbage

Each Add allocates a `*entry` and a `*list.Element`. Each eviction frees them. At 10M Adds/sec, that is 20M short-lived allocations per second — a meaningful fraction of allocator and GC time.

### Diagnosing

```bash
GODEBUG=gctrace=1 ./service
```

Output like:

```
gc 47 @5.123s 12%: 0.5+12+0.3 ms clock, 8+24/96/0+5 ms cpu, 256→512→256 MB
```

`12%` is the GC overhead. Above 5% the GC is using too much CPU.

### Mitigation: `sync.Pool` for entries

```go
var entryPool = sync.Pool{
    New: func() interface{} { return new(entry) },
}

func (c *Cache) newEntry() *entry {
    return entryPool.Get().(*entry)
}

func (c *Cache) recycleEntry(e *entry) {
    *e = entry{} // zero it
    entryPool.Put(e)
}
```

Reuse entry structs across Add/Remove cycles. Cuts allocations roughly in half.

### Mitigation: arena allocation

For very large caches, allocate the entire array of entries once:

```go
type Cache struct {
    arena   []entry
    freeIdx atomic.Uint32
    free    chan uint32 // recycled indexes
}

func (c *Cache) alloc() uint32 {
    select {
    case i := <-c.free:
        return i
    default:
        return c.freeIdx.Add(1) - 1
    }
}
```

No heap allocations on Add. The arena is one contiguous allocation, GC scans it once.

### Mitigation: off-heap storage

If your values are byte slices, store them in an unmanaged byte arena. The GC sees only the slice headers (24 bytes each) instead of every byte. Covered next.

---

## Off-Heap Caches: bigcache and freecache

For caches holding hundreds of MB or GB of pointer-heavy data, the GC scan becomes the bottleneck. Off-heap caches store values in a managed byte arena that the GC ignores.

### bigcache

Stores values as `[]byte`. You serialise before Set, deserialise after Get.

```go
import "github.com/allegro/bigcache/v3"

config := bigcache.DefaultConfig(10 * time.Minute)
config.HardMaxCacheSize = 4096 // MB
cache, _ := bigcache.New(context.Background(), config)

data, _ := json.Marshal(user)
cache.Set("user:42", data)

// later
raw, err := cache.Get("user:42")
if err == nil {
    var u User
    _ = json.Unmarshal(raw, &u)
}
```

Internals:

- 1024 shards by default. Each shard is a byte arena + an index map.
- Values are written contiguously into the arena. The index map maps key → offset.
- Eviction: FIFO with TTL. Oldest entries overwrite their slots.
- The arena is `[]byte` — Go's GC sees one object regardless of how many "values" are inside.

### freecache

Similar concept, slightly different trade-offs:

- 256 shards.
- Per-entry TTL.
- Tighter memory layout.
- Slightly more complex internals.

```go
import "github.com/coocood/freecache"

cache := freecache.NewCache(1 * 1024 * 1024 * 1024) // 1 GB
cache.Set([]byte("user:42"), data, 300)

raw, err := cache.Get([]byte("user:42"))
```

### When to use them

- Cache size > 1 GB.
- Pointer-heavy values causing GC stalls > 50 ms.
- Latency-sensitive service where GC pause is the issue, not throughput.

### When not to

- Values are small (< 100 bytes). The serialisation overhead dominates.
- Values are accessed many times per second. Deserialise-on-every-Get is wasteful.
- Strict LRU semantics required (these caches are FIFO + TTL).

For a typical Go service with cache size 10-100 MB, bigcache/freecache add complexity without payoff. Use them when GC profile shows them as needed.

---

## Sharding Strategies for Massive Caches

Beyond hash-based sharding, several strategies appear in production caches.

### Range sharding

Keys are split into ranges. `[0-999]` goes to shard 0, `[1000-1999]` to shard 1, etc. Useful when keys have meaningful order.

```go
func (c *Cache) pick(k int) *shard {
    return c.shards[k/1000]
}
```

Drawback: hot ranges concentrate load. A burst of new users (sequential IDs) hits one shard.

### Hash-then-range sharding

Hash first, then range. Combines collision-free distribution with predictable shard ownership.

### Two-level sharding

```go
type Cache struct {
    coarse []*Cache       // outer ring
    fine   [][]*shard     // inner shards per coarse shard
}
```

For very large caches (1 billion entries). Outer ring picks a node; inner shards distribute within. Useful in distributed designs.

### Locality-aware sharding

On NUMA machines, pin shards to CPU sockets. Goroutines pick the shard that minimises cross-socket traffic.

```go
type Cache struct {
    shards []*shard
    numa   []int // shard idx → NUMA node
}
```

Detect goroutine's CPU via `runtime.LockOSThread` + `syscall.Getcpu`. Pick a shard on the same NUMA node.

Effective on multi-socket boxes; irrelevant on single-socket. For most cloud workloads, irrelevant.

---

## Cache Coherence Across Pods

In-process caches are per-pod. A write on pod A invalidates pod A's cache but not pod B's.

### Pattern 1 — TTL coherence

Set a short TTL. All pods become consistent within TTL after a write. Easy; works for most workloads.

### Pattern 2 — Pub/sub invalidation

```go
// On write:
db.Update(u)
cache.Remove(u.ID)
redis.Publish("invalidations", u.ID)

// In a background goroutine on every pod:
sub := redis.Subscribe("invalidations")
for msg := range sub.Channel() {
    cache.Remove(msg.Payload)
}
```

Sub-second invalidation. Adds Redis as a dependency. Works well at scale.

### Pattern 3 — Versioned values

Each entry has a version. On Get, optionally check version against a fast source of truth.

```go
type entry struct {
    val     *User
    version uint64
}

func (c *Cache) Get(id string) (*User, error) {
    e, ok := c.inner.Get(id)
    if ok {
        curVersion, _ := c.versionStore.Get(id) // fast lookup
        if curVersion == e.version {
            return e.val, nil
        }
    }
    return c.loadAndCache(id)
}
```

The version store is a tiny shared cache (Redis hash). Get is two operations instead of one, but coherence is exact.

### Pattern 4 — Write-through to shared cache

Use only Redis (L2) and skip per-pod cache. Simpler but slower (network for every read).

For most services, **pattern 1 (TTL)** is sufficient. Reach for pattern 2 (pub/sub) when staleness > 5 seconds is a problem. Reach for patterns 3 or 4 only when staleness is unacceptable.

---

## Designing for Cache-Friendly Workloads

Sometimes the right answer is not "build a better cache" but "make the workload more cacheable."

### Key normalization

```go
// BAD: every variant is a different key
cache.Get("Alice@example.com")
cache.Get("alice@example.com")
cache.Get("alice@EXAMPLE.com")

// GOOD: normalize before caching
key := strings.ToLower(strings.TrimSpace(email))
cache.Get(key)
```

Lower-case, trim whitespace, canonicalise URLs — anything that maps user input to a canonical form.

### Granularity

Caching `(user, full profile)` rather than `(user, list of all field values)` reduces variance. The fewer distinct keys, the higher the hit rate.

### Batching

A loop of 100 `cache.Get` calls is 100 lock operations. A single `cache.GetMulti` (if supported) is one. Some caches expose batch APIs; for those that do not, you can wrap:

```go
func (c *Cache) GetMulti(keys []string) map[string]*User {
    out := make(map[string]*User, len(keys))
    for _, k := range keys {
        if v, ok := c.Get(k); ok {
            out[k] = v
        }
    }
    return out
}
```

This does not save lock operations but does save call overhead.

### Pre-aggregation

Instead of caching raw data and computing aggregates on Get, cache the aggregates directly. Trades cache size for compute on miss.

### Cache-friendly schema design

In SQL, denormalise common joins into the row so a single Get returns everything needed. The cache holds joined rows; reads are simpler; cache hits are higher.

---

## Building a Production Cache from First Principles

If you needed to build a high-performance cache from scratch (not just use a library), here is the order of decisions:

1. **What is the value type?** Pointer (Go object), `[]byte` (off-heap), or interface? This determines GC pressure and serialisation cost.
2. **What is the access pattern?** Read-heavy, write-heavy, scan-heavy, frequency-skewed?
3. **What is the throughput target?** <10M ops/s: single-mutex LRU. 10-100M: sharded. >100M: ristretto-style.
4. **What is the memory budget?** Sub-GB: on-heap. Multi-GB: off-heap.
5. **What is the freshness requirement?** Stale-by-hours: pure LRU. Stale-by-minutes: TTL. Stale-by-seconds: pub/sub invalidation.
6. **What is the consistency requirement?** Eventual: in-process LRU. Strong: bypass cache or write-through.

These six answers map to a specific architecture. Skip the survey and you build the wrong thing.

### Skeleton of a from-scratch high-performance cache

```go
package mycache

import (
    "sync"
    "sync/atomic"
    "time"
)

type Cache[K comparable, V any] struct {
    shards    []*shard[K, V]
    shardMask uint64
    hits      atomic.Uint64
    misses    atomic.Uint64
}

type shard[K comparable, V any] struct {
    mu      sync.RWMutex
    items   map[K]*entry[V]
    list    *clockList[K] // clock-style for lock-free reads
    capacity int
    _pad    [16]byte
}

type entry[V any] struct {
    val        V
    referenced atomic.Bool
    expireAt   int64 // unix nanos, 0 = never
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    s := c.shards[c.hash(k)&c.shardMask]
    s.mu.RLock()
    e, ok := s.items[k]
    s.mu.RUnlock()
    if !ok {
        c.misses.Add(1)
        var zero V
        return zero, false
    }
    if e.expireAt > 0 && time.Now().UnixNano() > e.expireAt {
        c.misses.Add(1)
        var zero V
        return zero, false
    }
    e.referenced.Store(true)
    c.hits.Add(1)
    return e.val, true
}
```

Notes:

- `RLock` on Get because we are using Clock (write to `referenced` is an atomic, not a list mutation).
- Per-shard layout fits a cache line.
- TTL is per-entry (each entry holds its own expireAt).
- Atomic hit/miss counters with padding (omitted for brevity).

The full implementation is ~600 lines. Worth doing once as a learning exercise; in production, use a library.

---

## Profiling Mutex Contention

```go
runtime.SetMutexProfileFraction(1) // sample every contended lock
runtime.SetBlockProfileRate(1)     // sample every blocking event
```

Then:

```bash
go test -mutexprofile=mu.out -bench .
go tool pprof -text mu.out
```

Output:

```text
flat  flat%   sum%        cum   cum%
21s   60%    60%         21s   60%   sync.(*Mutex).Lock
12s   34%    94%         12s   34%   sync.(*RWMutex).RLock
```

60% of contention is on plain Mutex. If it is your cache mutex, sharding will help. If it is a different mutex (e.g., the allocator), sharding the cache will not.

The `cum` column is interesting too — it shows the call paths that *led to* the contention. Often the cause is unrelated to the locked code itself.

---

## Profiling Cache Hit Rate

Hit rate is the most important cache metric. Compute it as:

```go
hitRate := float64(hits) / float64(hits + misses)
```

But raw hit rate hides important detail. Better is **hit rate per key prefix**:

```go
hitRateByPrefix := map[string]struct {
    hits, misses uint64
}{}

func record(k string, hit bool) {
    prefix := k[:strings.Index(k, ":")] // e.g., "user", "session", "config"
    s := hitRateByPrefix[prefix]
    if hit { s.hits++ } else { s.misses++ }
    hitRateByPrefix[prefix] = s
}
```

You may find:

- `user` prefix: 95% hit rate (good).
- `config` prefix: 99% (excellent).
- `event` prefix: 5% (cache useless; remove it).

The `event` cache costs you memory and lock contention for nothing. Either fix the workload or remove the cache.

### Hit rate by request route

Track hit rate per HTTP route or RPC method. The overall hit rate hides hot/cold endpoints. Specific routes may need their own caches with different settings.

### Hit rate vs latency

Plot `p99 latency vs hit rate` over time. They should correlate negatively (higher hit rate → lower latency). If they don't, your cache is not helping the right requests.

---

## Capacity Planning

A method for choosing capacity:

1. **Measure working set.** What is the size of the set of keys actually accessed in a typical hour?
2. **Target hit rate.** What hit rate do you need? Higher target = larger cache.
3. **Apply the hit-rate-to-capacity curve.** Most caches show diminishing returns: 80% hit rate at capacity X, 90% at 2X, 95% at 4X.
4. **Multiply by safety factor.** 1.2x for headroom.
5. **Round to power of two.** For bitmask sharding.

If you do not know the working set, estimate by:

```go
type WorkingSetTracker struct {
    seen sync.Map
}

func (t *WorkingSetTracker) Touch(k string) {
    t.seen.Store(k, time.Now())
}

func (t *WorkingSetTracker) Size(since time.Duration) int {
    cutoff := time.Now().Add(-since)
    n := 0
    t.seen.Range(func(k, v interface{}) bool {
        if v.(time.Time).After(cutoff) {
            n++
        }
        return true
    })
    return n
}
```

Run for a week; the size at one hour is your working set.

---

## Cache Stampede Prevention at Scale

`singleflight` handles in-pod stampedes. Cross-pod stampedes are harder.

### Pattern 1 — Jittered TTL

Add ±10% random jitter to TTL so entries do not expire in lockstep.

```go
ttl := baseTTL + time.Duration(rand.Int63n(int64(baseTTL/10)))
```

### Pattern 2 — Probabilistic refresh ahead of expiry

For each Get, compute `expirationProbability = (age / ttl)^n`. Refresh with that probability. As age approaches ttl, refresh becomes likely. Spreads the load.

```go
func shouldRefresh(age, ttl time.Duration) bool {
    p := math.Pow(float64(age)/float64(ttl), 4)
    return rand.Float64() < p
}
```

### Pattern 3 — Stale-while-revalidate (covered in middle.md)

Serve stale while refreshing in background. Avoids the expiry spike entirely.

### Pattern 4 — Mutex on the source

For truly unique cold loads (one item, billions of misses), a global mutex around the load itself prevents N pods from all loading at once. Redis SETNX with a short TTL works as the global mutex.

---

## Cache Poisoning Defenses

A scan attack fills the cache with junk and evicts the hot set. Defenses:

### Defense 1 — TinyLFU admission

ristretto's main weapon. New keys must prove popularity before getting cache space. A scan's keys never get popular and get rejected.

### Defense 2 — Separate caches by key trust

```go
type Cache struct {
    trusted   *lru.Cache[string, *Value] // internal lookups
    untrusted *lru.Cache[string, *Value] // user-input keys, smaller
}
```

User input never evicts internal lookups. Bound the damage.

### Defense 3 — Rate limit cache misses per source

If a single client causes 1000 misses/sec, suspect a scan. Rate-limit them before they reach the cache.

### Defense 4 — Read-only cache for hot data

For truly hot data (top 100 keys), pin them in an unbounded read-only cache that is never evicted. Scans cannot affect this cache because nothing is inserted from misses.

```go
type PinnedCache struct {
    pinned map[string]*Value // never evicted
    cold   *lru.Cache[string, *Value] // for everything else
}
```

The pinned set is refreshed periodically based on analytics ("top keys yesterday").

---

## Cache vs Database Index: When the Database is Enough

Before adding a cache, ask: would a database index solve the problem?

- A well-indexed lookup is often 1-2 ms.
- A cache hit is 1-2 µs (1000x faster).
- A cache miss is the index lookup *plus* the cache overhead.

If your traffic is 1000 req/s, the database index is fine. If it is 100K req/s, the cache earns its keep.

Caches are not free. Costs:

- Memory.
- CPU for hashing and locking.
- Complexity in code.
- Operational burden (sizing, alerting, debugging).
- Risk of staleness bugs.

Use a cache when the alternative (DB or compute) cannot meet the latency/throughput target. Skip it when the simpler path is fast enough.

---

## Senior-Level Mistakes

### Mistake 1 — Reaching for ristretto when golang-lru would do

ristretto's API is complex. cost-based capacity, BufferItems, NumCounters, async Set. For a 10K-ops/sec service, the simpler library is better. Use ristretto when measured throughput demands it.

### Mistake 2 — Off-heap cache for small workloads

bigcache/freecache pay off at GB scale. At 10 MB they add overhead. Profile GC before reaching for them.

### Mistake 3 — Premature sharding

Sharding to 256 stripes on a service that does 10K req/s wastes memory and adds complexity. Default to 16-32; increase based on contention profiling.

### Mistake 4 — Building a custom lock-free cache "for performance"

Lock-free data structures are *very* hard to get right. Existing libraries (ristretto, go-cache) have spent years debugging the edge cases. Building your own is a multi-month commitment to be slightly faster than a free option.

### Mistake 5 — Ignoring NUMA on multi-socket machines

If your cache is hot and you run on a 2- or 4-socket machine, cross-socket cache traffic can double your latency. Use a NUMA-aware sharding scheme or pin processes to one socket.

### Mistake 6 — Treating the cache as a write buffer

Caches are read-side. Writes go to the source of truth, then invalidate or update the cache. Write-back caches exist but are dangerous (data loss on crash).

### Mistake 7 — Not measuring hit rate by key prefix

Overall hit rate hides per-route hit rate. A 90% overall rate may be 99% on one route and 30% on another. The cache should be tuned per route.

### Mistake 8 — Sharing a cache across security boundaries

If `cache.Get(k)` can return a value cached by a different user, you have a confused-deputy attack vector. Cache keys must include the security principal.

### Mistake 9 — Cache key based on mutable input

If your cache key is `(userID, queryString)` and the query string has reordering, you cache (`?a=1&b=2`) and (`?b=2&a=1`) separately. Normalise.

### Mistake 10 — Trusting cache hit rate as a proxy for correctness

A high hit rate means low miss rate, not high *quality* of cached data. If the underlying data is stale but consistent, hit rate is high and users see stale data.

---

## Cheat Sheet

```text
THROUGHPUT TARGETS:
  <1M ops/s:    single mutex LRU
  1-10M ops/s:  sharded LRU (16 shards)
  10-100M ops/s: sharded LRU (64 shards) or ristretto
  >100M ops/s:  ristretto, with profile-driven tuning

ALGORITHMS:
  Plain LRU:    classic, simple
  2Q:           scan-resistant, 2x memory
  ARC:          self-tuning, 3x memory
  SLRU:         segmented LRU, 1.2x memory
  W-TinyLFU:    ristretto, frequency-aware
  S3-FIFO:      2024 algorithm, FIFO-based, lock-friendly

OFF-HEAP:
  bigcache:    FIFO + TTL, GB-scale
  freecache:   LRU-ish + per-entry TTL
  Use when:    GC overhead > 5% and cache > 1 GB

CONCURRENT TRICKS:
  BP-Wrapper:        batch recency updates, lock-free Get
  Clock:             per-entry referenced bit, no list mutation
  Lossy buffers:     drop access events under load
  Cost-based:        cap on bytes, not entries
  Sticky routing:    hot key on one pod only

DEFENSES:
  Cache stampede:  singleflight + jittered TTL + stale-while-revalidate
  Cache poisoning: TinyLFU admission, separate trusted/untrusted, pinned hot set
  GC pressure:     sync.Pool, arena, off-heap
  Hot key:         local L1, replicated atomics, sticky routing
```

---

## Self-Assessment Checklist

- [ ] I can explain BP-Wrapper and implement a lossy access buffer.
- [ ] I can describe the Clock algorithm's invariants.
- [ ] I can explain W-TinyLFU end to end: window, SLRU, sketch, doorkeeper.
- [ ] I understand Count-Min Sketch error bounds.
- [ ] I can design a cache topology for a service doing 100M req/s.
- [ ] I can profile mutex contention and pick the right shard count.
- [ ] I can recognise GC pressure from a cache and choose the right mitigation.
- [ ] I know when ristretto is the right choice and when it is overkill.
- [ ] I can defend a cache against scan-based poisoning.
- [ ] I can plan capacity from a working-set estimate.

---

## The full lifecycle of a cached request

A senior-level mental model of what happens during one cached request:

```
T-50ms: Client sends HTTP GET /users/42
T-0:    Request arrives at the pod
T+0:    HTTP handler runs
T+1us:  context.WithTimeout(50ms)
T+1us:  Auth middleware checks JWT (cached in JWT cache, hit)
T+5us:  Route to user handler
T+5us:  cache.Get("user:42") — local L2 cache miss
T+7us:  singleflight.Do("user:42", loadFn)
T+7us:  loadFn starts
T+8us:  cache.Get on shared Redis (L3) — miss
T+8us:  Open DB connection from pool
T+1ms:  Execute SELECT * FROM users WHERE id=42
T+10ms: DB returns row
T+10ms: Scan into *User struct
T+11ms: Set Redis with TTL=5min (write-around)
T+11ms: Set local L2 cache
T+11ms: singleflight.Do unblocks all waiters (1 in this case)
T+12ms: Serialize *User to JSON
T+13ms: w.Write(json)
T+13ms: Request complete, total latency 13ms
```

Total: 13 ms for one cold-path request. The next request for `user:42` from the same pod:

```
T+0:    HTTP handler runs
T+1us:  Auth middleware (cached)
T+5us:  cache.Get("user:42") — L2 hit
T+6us:  Serialize *User to JSON
T+7us:  w.Write(json)
T+7us:  Request complete, total latency 7us (1900x faster)
```

The cache delivered a 1900x speedup. That is the business case for caching, in one number.

## More on the cache's failure modes

### Failure mode 1: hot key

Symptoms: high CPU, high p99 latency, mutex contention on one shard.
Detection: per-shard size metric; one shard's eviction rate >> others.
Mitigation: local L1 cache, sticky routing, replicated atomic.

### Failure mode 2: cache stampede

Symptoms: simultaneous spike in DB load matching cache misses.
Detection: rate of cache misses vs rate of database queries.
Mitigation: singleflight, jittered TTL, stale-while-revalidate.

### Failure mode 3: cache pollution

Symptoms: hit rate drops, eviction rate spikes.
Detection: working-set tracking; per-key-prefix hit rate.
Mitigation: TinyLFU admission, separate caches per workload, key validation.

### Failure mode 4: silent staleness

Symptoms: users report seeing old data; no error in logs.
Detection: e2e tests comparing cached vs uncached responses.
Mitigation: pub/sub invalidation, shorter TTL, write-through.

### Failure mode 5: memory exhaustion

Symptoms: OOM kills, container restarts.
Detection: memory metric vs cache size metric divergence.
Mitigation: cost-based capacity, off-heap, capacity validation.

### Failure mode 6: long callback

Symptoms: cache operations take milliseconds intermittently.
Detection: cache operation latency histogram; high p99.
Mitigation: move callback work to background goroutine, drop blocking ops.

### Failure mode 7: GC stall

Symptoms: periodic latency spikes correlated with GC events.
Detection: `GODEBUG=gctrace=1` shows long pauses; GC profile.
Mitigation: sync.Pool, arena, off-heap.

### Failure mode 8: leaked references

Symptoms: cache holds entries that should have been removed.
Detection: cache contains entries whose source no longer exists.
Mitigation: explicit invalidation on delete; checksum validation.

Knowing the failure modes is half the battle. The other half is having metrics that detect them.

## Walkthrough: a cache misbehaving in production

Detailed war story to illustrate senior-level debugging.

### The setup

A Go service serves an API. Each request reads a user, a config, and a feature flag. All three are cached. The service has been running for a year at 50K req/s with stable latency.

### Day 0: alert

p99 latency: 80 ms → 800 ms. p50: unchanged. CPU usage: up 30%. Memory: stable. Error rate: stable.

### Investigation

Step 1: `pprof` CPU profile.

```text
55%  runtime.mapassign_faststr
20%  runtime.mapaccess2_faststr
15%  runtime.lock2
```

A lot of map work. The lock contention (15%) is suspicious for a cache that uses sharding.

Step 2: mutex profile.

```text
75%  sync.(*RWMutex).Lock   (in cache.Add)
20%  sync.(*RWMutex).RLock  (in cache.Get)
```

The cache mutex is contended. But why now, after a year of stability?

Step 3: hit rate metric.

Hit rate: 95% → 30%.

Something is happening to the working set.

Step 4: per-prefix hit rate.

```text
user:    99%
config:  99%
flag:    5%
```

Flag hit rate collapsed. The user and config caches are fine.

Step 5: log a sample of flag keys.

```text
flag:f1:user-1234567:expA
flag:f1:user-1234567:expB
flag:f2:user-1234567:expA
flag:f2:user-1234567:expB
...
flag:f1:user-9876543:expA
```

The flag cache keys include an "experiment" suffix that varies per request. The key space is now `flags × users × experiments` — millions of distinct keys for a 16K-capacity cache.

### Root cause

A recent deploy added experiments to the flag evaluator. The cache key was not updated to deduplicate experiments. Each user now generates 4-10 cache keys (one per experiment) instead of 1.

### Fix

Change the cache key to `flag:f1:user-1234567` (no experiment) and store the experiment results inside the value. Cache space drops to `flags × users`, hit rate climbs back to 99%.

### Lesson

Cache keys are part of the API. Adding dimensions to the key without rethinking capacity is a classic regression. The post-mortem suggests:

- Alert on hit-rate drop, not just latency.
- Review cache key design in PRs that touch cached code paths.
- Add an upper-bound metric on key space size (count distinct keys per minute).

## Another war story: the silent OOM

### Setup

A service uses `bigcache` for a 4 GB cache of HTTP responses.

### Day 0

Pods start OOM-killing at 12 GB resident, even though `HardMaxCacheSize = 4096` (MB).

### Investigation

Step 1: `pprof` heap profile.

```text
58%  *bigcache.cacheShard.entries (15 GB total)
```

Way more than 4 GB.

Step 2: read bigcache docs.

`HardMaxCacheSize` is in MB *per shard*. Default shards = 1024. So `4096 × 1024 = 4 PB` cap. Effectively unlimited.

### Fix

`HardMaxCacheSize / shards = 4`. The cache is bounded again.

### Lesson

Library defaults are not always intuitive. Always read the docs. Always add memory alerts independent of the library's self-reporting.

## Another war story: the cache that lost data

### Setup

A service caches user permissions. Writes are write-through.

### Day 0

A user reports that updating their permissions had no effect for 5 minutes.

### Investigation

Step 1: trace the write path.

```go
db.UpdatePermissions(ctx, u)
cache.Add(u.ID, u) // write-through
return nil
```

Looks correct.

Step 2: trace the read path.

```go
v, ok := cache.Get(u.ID)
if ok { return v }
// load from DB
v, _ = db.GetPermissions(ctx, id)
cache.Add(id, v)
return v
```

Also looks correct.

Step 3: check cache instances.

The service has 10 pods. Each has its own cache. The write went to pod 3's cache. The user's next request went to pod 7. Pod 7 had stale data (from 5 minutes ago).

Step 4: check TTL.

TTL is 10 minutes. So pod 7 will not refresh for up to 10 more minutes.

### Fix

Add pub/sub invalidation: on write, publish "user:42 invalidated" to a Redis channel; all pods subscribe and Remove from their local cache.

### Lesson

Per-pod caches need a coherence story. TTL is the simplest; pub/sub is faster. Choose based on the freshness contract.

## Worked example: lock-free read with version vector

For caches where every read must be consistent with the latest write, version vectors help:

```go
type VersionedCache[K comparable, V any] struct {
    inner    *lru.Cache[K, versionedEntry[V]]
    versions *atomicVersionMap[K] // shared with writers
}

type versionedEntry[V any] struct {
    val     V
    version uint64
}

func (c *VersionedCache[K, V]) Get(k K) (V, bool) {
    e, ok := c.inner.Get(k)
    if !ok {
        var zero V
        return zero, false
    }
    cur := c.versions.Load(k)
    if cur > e.version {
        // stale; remove and signal miss
        c.inner.Remove(k)
        var zero V
        return zero, false
    }
    return e.val, true
}

func (c *VersionedCache[K, V]) Add(k K, v V) {
    ver := c.versions.IncrementAndLoad(k)
    c.inner.Add(k, versionedEntry[V]{val: v, version: ver})
}
```

The `versions` map is shared across pods (e.g., backed by Redis with atomic increments). Each pod's local cache trusts only entries with the latest version.

This is the basis for the "validate-on-read" pattern.

## A note on cache eviction order under contention

When a cache evicts an entry while another goroutine is reading it:

- The reader holds an RLock (or completed Get before the writer started).
- The writer holds the Lock to evict.
- The reader's reference to the value remains valid (Go's GC keeps it alive).
- The cache's map no longer contains the key; future Gets miss.

This is the normal, safe behavior. The reader sees a "snapshot" of the value at read time. After the evict, the reader continues to operate on the value; the cache moves on.

Where it gets subtle: if the eviction callback modifies the value (e.g., flushes a buffer), the reader sees a modified value. Avoid mutating cached values in callbacks.

## Reading list for senior-level cache work

Books and papers worth reading:

- **"Cache replacement policies"** (Wikipedia) — survey of LRU, LFU, ARC, 2Q, MQ, LIRS, etc.
- **"TinyLFU: A Highly Efficient Cache Admission Policy"** (Einziger, Friedman, Manes 2017) — the algorithm behind ristretto and Caffeine.
- **"FIFO queues are all you need for cache eviction"** (Yang et al. 2023, SOSP) — the S3-FIFO paper.
- **"BP-Wrapper: A System Framework Making Any Replacement Algorithms (Almost) Lock Contention Free"** (Ding & Zhang 2008) — the lossy buffer trick.
- **"ARC: A Self-Tuning, Low Overhead Replacement Cache"** (Megiddo & Modha 2003) — the original ARC.
- **"The Cache Behaviour of Large Lock-Free Queues"** (Calciu, Sen, Marathe 2018) — applicable to cache-internal data structures.
- **"The Art of Multiprocessor Programming"** (Herlihy & Shavit) — chapters on concurrent data structures.

Most are 10-30 pages. A weekend's reading; a career's worth of intuition.

## A useful mental model: caches as bets

Every cache is a bet:

- "I bet the next access to this key will be within TTL." If wrong, you serve stale.
- "I bet keeping this entry is more valuable than that one." If wrong, hit rate suffers.
- "I bet the working set fits in my capacity." If wrong, you thrash.

The eviction policy is your betting strategy. LRU bets on recency. LFU bets on frequency. W-TinyLFU bets on both. Belady is the omniscient bettor; nobody is Belady.

Caches that bet well have high hit rates. Caches that bet badly are pure overhead. The right policy depends on your workload's statistics — measure them, then bet accordingly.

## Concurrency anti-patterns specific to caches

### Anti-pattern: reading the cache while holding another lock

```go
s.outerMu.Lock()
defer s.outerMu.Unlock()
v, _ := s.cache.Get(key) // cache has its own lock; you're holding two
```

Holding two locks is a lock-order discipline you must maintain. Easy to deadlock. Best avoided.

### Anti-pattern: cache writes inside transactions

```go
tx.Begin()
defer tx.Rollback()
// ... DB work ...
cache.Add(id, v) // committed to cache, but DB tx may roll back
tx.Commit()
```

If the transaction rolls back, the cache holds data that does not exist in the DB. Update the cache *after* commit only.

### Anti-pattern: cache as a coordination primitive

```go
cache.Add("lock:"+id, true)
defer cache.Remove("lock:"+id)
// ... critical section ...
```

A cache is not a lock. Eviction can release the "lock" while a critical section runs. Use real locks (sync.Mutex, Redis SETNX, etcd).

### Anti-pattern: long-running operations under the eviction callback

```go
lru.NewWithEvict(128, func(k, v) {
    sendToS3(v) // network call, holds the lock for 100ms
})
```

The callback holds the cache lock. A 100ms callback blocks all cache operations for 100ms. Push to a queue.

### Anti-pattern: cache populated from background but not from foreground

```go
// Background populates everything proactively.
go func() {
    for k := range allKeys {
        v, _ := load(k)
        cache.Add(k, v)
    }
}()
```

The cache is a side-effect of the background goroutine, not driven by demand. Foreground misses are not handled; if the background stalls, latency tanks. Background pre-warming is a complement, not a substitute, for demand-driven caching.

## Performance tuning checklist

A systematic approach to optimizing a cache:

1. **Profile first.** CPU profile + mutex profile + alloc profile. Identify the bottleneck.
2. **Measure hit rate.** If below 80%, capacity or policy is wrong.
3. **Measure eviction rate.** If high, capacity is undersized.
4. **Measure lock contention.** If high, shard more or switch to ristretto.
5. **Measure allocation rate.** If high, use sync.Pool or arena.
6. **Measure GC overhead.** If high, consider off-heap.
7. **Measure tail latency.** If p99 >> p50, hunt for stop-the-world events.
8. **Iterate.** One change at a time, with metrics.

## Decision matrix: choosing a cache library

| Requirement | Recommendation |
|-------------|----------------|
| Drop-in LRU, low effort | `hashicorp/golang-lru/v2` |
| Scan resistance | `hashicorp/golang-lru/v2.New2Q` |
| Adaptive workload | `hashicorp/golang-lru/v2.NewARC` |
| Time-based expiry | `hashicorp/golang-lru/v2/expirable` |
| High throughput, frequency-skewed | `dgraph-io/ristretto` |
| > 1 GB cache, GC bound | `allegro/bigcache` |
| > 1 GB cache, per-entry TTL | `coocood/freecache` |
| Read-only, fixed key set | `sync.Map` |
| Distributed cache | Redis or Memcached |
| Embedded persistent | `dgraph-io/badger` or BoltDB |

## A philosophical aside

Caches are a confession of failure. Every cache says: "I cannot make my source of truth fast enough."

That sounds harsh, but it is liberating. A cache is not the goal. The goal is meeting the SLO. If you can meet the SLO without a cache — by indexing the database better, by denormalizing the schema, by using a faster query — do that. The system is simpler, the failure modes fewer.

Reach for the cache when the alternatives have been exhausted. Then choose the simplest cache that meets the need. The order of preference:

1. No cache (faster source of truth).
2. Single-mutex LRU.
3. Sharded LRU.
4. W-TinyLFU (ristretto).
5. Off-heap cache.
6. Cache hierarchy.
7. Custom design.

Each step adds complexity. Each step should be motivated by measurement, not by anticipation.

## In-depth: building a near-production sharded clock cache

Let me show a substantial concurrent cache that combines several of the techniques discussed above. This is meant for reading, not copy-paste; it sacrifices some idiom for clarity.

```go
package clockcache

import (
    "hash/maphash"
    "sync"
    "sync/atomic"
    "time"
    "unsafe"
)

type Cache[K ~string, V any] struct {
    shards    []*shard[K, V]
    shardMask uint64
    seed      maphash.Seed

    hits      atomic.Uint64
    misses    atomic.Uint64
    evictions atomic.Uint64
}

type shard[K ~string, V any] struct {
    mu       sync.RWMutex
    items    map[K]*entry[K, V]
    ring     []entry[K, V]
    hand     uint32
    capacity uint32
    // padding to a cache line (typical 64 bytes); compute via unsafe.Sizeof in a real impl
    _pad [16]byte
}

type entry[K ~string, V any] struct {
    key        K
    val        V
    referenced atomic.Bool
    expireAt   int64 // unix nano, 0 = never
    in         bool  // is this slot occupied?
}

func New[K ~string, V any](capacity, shards int) *Cache[K, V] {
    if shards&(shards-1) != 0 || shards == 0 {
        panic("shards must be power of two")
    }
    perShard := uint32((capacity + shards - 1) / shards)
    c := &Cache[K, V]{
        shards:    make([]*shard[K, V], shards),
        shardMask: uint64(shards) - 1,
        seed:      maphash.MakeSeed(),
    }
    for i := range c.shards {
        c.shards[i] = &shard[K, V]{
            items:    make(map[K]*entry[K, V], perShard),
            ring:     make([]entry[K, V], perShard),
            capacity: perShard,
        }
    }
    return c
}

func (c *Cache[K, V]) pick(k K) *shard[K, V] {
    var h maphash.Hash
    h.SetSeed(c.seed)
    h.WriteString(string(k))
    return c.shards[h.Sum64()&c.shardMask]
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    s := c.pick(k)
    s.mu.RLock()
    e, ok := s.items[k]
    s.mu.RUnlock()
    if !ok {
        c.misses.Add(1)
        var zero V
        return zero, false
    }
    if e.expireAt > 0 && time.Now().UnixNano() > e.expireAt {
        c.misses.Add(1)
        var zero V
        return zero, false
    }
    e.referenced.Store(true)
    c.hits.Add(1)
    return e.val, true
}

func (c *Cache[K, V]) Set(k K, v V, ttl time.Duration) {
    s := c.pick(k)
    s.mu.Lock()
    defer s.mu.Unlock()
    var expireAt int64
    if ttl > 0 {
        expireAt = time.Now().Add(ttl).UnixNano()
    }
    if e, ok := s.items[k]; ok {
        e.val = v
        e.referenced.Store(true)
        e.expireAt = expireAt
        return
    }
    // find a slot
    for i := uint32(0); i < s.capacity*2; i++ {
        idx := s.hand % s.capacity
        s.hand = (s.hand + 1) % s.capacity
        e := &s.ring[idx]
        if !e.in {
            // empty slot
            e.key = k
            e.val = v
            e.expireAt = expireAt
            e.referenced.Store(true)
            e.in = true
            s.items[k] = e
            return
        }
        if e.referenced.Load() {
            e.referenced.Store(false) // second chance
            continue
        }
        // evict this entry
        delete(s.items, e.key)
        c.evictions.Add(1)
        var zeroV V
        e.key = k
        e.val = v
        e.expireAt = expireAt
        e.referenced.Store(true)
        s.items[k] = e
        _ = zeroV
        return
    }
}

func (c *Cache[K, V]) Stats() (hits, misses, evictions uint64) {
    return c.hits.Load(), c.misses.Load(), c.evictions.Load()
}

func init() {
    // Sanity: a shard fits one or two cache lines.
    if unsafe.Sizeof(shard[string, int]{}) > 128 {
        // not fatal, just suboptimal
    }
}
```

Properties:

- **Clock-based**: no linked list, fewer allocations per Add.
- **Slice-backed**: contiguous memory, cache-friendly.
- **Per-entry TTL**: fine-grained expiry without a separate timer.
- **Read-only Get under RLock**: hits scale with cores.
- **Sharded**: 16-256 shards reduce write contention.

Limitations:

- **`Set` finds slot under the writer lock** (O(capacity) worst case). Acceptable for cold-path inserts.
- **No `Remove`** in this snippet; would need to mark `e.in = false` and delete from map.
- **No background expiry sweep** — entries expire lazily on Get.
- **No callback on eviction** — would slot in `c.onEvict(e.key, e.val)` before overwriting.

For learning, expand this skeleton. For production, use a tested library.

## Deep dive: BP-Wrapper and the access buffer

Let us examine the lossy buffer in more detail because it is the single most important pattern in high-performance Go caches.

### The data structure

```go
type ringBuf struct {
    data []uint64
    head atomic.Uint64
    mask uint64
}

func newRingBuf(size int) *ringBuf {
    if size&(size-1) != 0 {
        panic("size must be power of two")
    }
    return &ringBuf{
        data: make([]uint64, size),
        mask: uint64(size - 1),
    }
}

func (r *ringBuf) Push(v uint64) {
    pos := r.head.Add(1) - 1
    r.data[pos&r.mask] = v // overwrites old entries
}

func (r *ringBuf) Drain() []uint64 {
    head := r.head.Load()
    if head == 0 {
        return nil
    }
    n := head
    if n > uint64(len(r.data)) {
        n = uint64(len(r.data))
    }
    out := make([]uint64, n)
    copy(out, r.data[:n])
    r.head.Store(0)
    return out
}
```

### Properties

- **Push is wait-free.** One atomic add, one array write.
- **Push can lose data.** If two goroutines push simultaneously near a wrap-around, one may overwrite the other's slot.
- **Drain is racy with Push.** That is intentional — the cache prefers fresh data over completeness.

### Why this is OK for a cache

The cache's recency tracking is a *heuristic*. Missing 1% of access events does not break correctness; it slightly degrades hit rate. Trading 100 ns of lock contention for an occasional 1% accuracy loss is a great deal.

### Per-shard buffers vs global

Per-shard buffers eliminate contention between shards entirely. ristretto uses 256 shard buffers; each goroutine's Get pushes to its local shard's buffer.

### Buffer size tuning

Too small: drops events, hit-rate suffers.
Too large: drain takes longer, recency lag grows.

ristretto defaults to 64 items per buffer. Good for most workloads.

## Deep dive: Count-Min Sketch implementation in Go

A real 4-bit-counter CMS:

```go
type cmSketch struct {
    rows  [4][]uint64 // each uint64 holds 16 counters of 4 bits
    seed  [4]uint64
    mask  uint64
    width uint64
}

func newCMSketch(width uint64) *cmSketch {
    // width must be power of 2
    s := &cmSketch{width: width, mask: width - 1}
    for i := range s.rows {
        s.rows[i] = make([]uint64, width/16) // 16 counters per uint64
        s.seed[i] = rand.Uint64()
    }
    return s
}

func (s *cmSketch) Increment(h uint64) {
    for i := range s.rows {
        idx := (h ^ s.seed[i]) & s.mask
        word := idx / 16
        shift := (idx % 16) * 4
        v := s.rows[i][word]
        cur := (v >> shift) & 0xF
        if cur < 15 { // saturate at 15
            s.rows[i][word] = v + (1 << shift)
        }
    }
}

func (s *cmSketch) Estimate(h uint64) uint64 {
    var min uint64 = 15
    for i := range s.rows {
        idx := (h ^ s.seed[i]) & s.mask
        word := idx / 16
        shift := (idx % 16) * 4
        c := (s.rows[i][word] >> shift) & 0xF
        if c < min {
            min = c
        }
    }
    return min
}

func (s *cmSketch) Reset() {
    // Halve all counters (right shift by 1 in each nibble)
    for i := range s.rows {
        for j := range s.rows[i] {
            s.rows[i][j] = (s.rows[i][j] >> 1) & 0x7777777777777777
        }
    }
}
```

This is essentially what ristretto's `sketch.go` does, minus optimisations.

### Memory math

- Width = 1M = 2^20.
- 4 rows × 1M counters × 4 bits = 16 Mbits = 2 MB.
- Counters saturate at 15 (4 bits). Sufficient for ranking; we never need to know if it's 1000 or 10000.

### Accuracy guarantees

For a sketch with width `w` and `d` hash functions, the error in count estimate is `ε ≤ ⌈e·N/w⌉` with probability `≥ 1 - exp(-d)`, where `N` is total stream length. For ristretto's 4 rows × 1M counters and 1B total accesses: error ≤ ~2700 with probability ≥ 99.98%. Good enough for "this key is hotter than that one."

### Why halving?

A key that is popular for an hour then cold should lose its advantage. Halving counters periodically (e.g., every 10x cache capacity Sets) implements exponential decay. After 4 halvings, a count of 15 becomes 0 — the key is forgotten.

The halving is `(v >> 1) & 0x7777777777777777`. The mask clears the high bit of each nibble so a count of 15 (binary 1111) halves to 7 (0111), not 8 (1000).

## Deep dive: BP-Wrapper for a real cache

The pattern in full, applied to a sharded cache:

```go
type Shard[K comparable, V any] struct {
    mu     sync.RWMutex
    items  map[K]*entry[V]
    list   *list.List
    capacity int
    accessBuf *ringBuf
}

func (s *Shard[K, V]) Get(k K) (V, bool) {
    s.mu.RLock()
    e, ok := s.items[k]
    s.mu.RUnlock()
    if !ok {
        var zero V
        return zero, false
    }
    // record access asynchronously
    s.accessBuf.Push(hash(k))
    return e.val, true
}

func (s *Shard[K, V]) processAccesses() {
    for {
        accesses := s.accessBuf.Drain()
        if len(accesses) == 0 {
            time.Sleep(10 * time.Millisecond)
            continue
        }
        s.mu.Lock()
        for _, h := range accesses {
            // find entry by hash → key → element, MoveToFront
        }
        s.mu.Unlock()
    }
}
```

Issues to handle:

- **Hash collisions** in the access buffer (we pushed the hash, not the key). Either push the key (more memory) or accept occasional misidentified accesses.
- **Background goroutine lifecycle.** Must stop cleanly on cache shutdown.
- **Buffer drain timing.** Too aggressive wastes CPU; too lazy means recency is wildly out of date.

Real implementations (ristretto) push the *key* (not just hash) so identification is exact. The buffer entry size is one machine word for `uint64` keys.

## NUMA awareness in production

On a 2-socket AMD EPYC or Intel Xeon, cross-socket memory access is 3-10x slower than local. A heavily contended cache on one socket can saturate the inter-socket link.

### Detection

```bash
numactl --hardware
```

Shows the number of NUMA nodes and CPU-to-node mapping.

```bash
numastat -p $(pidof your-service)
```

Shows memory distribution per node. If a single node's `Other_Node` count is large, you have cross-node traffic.

### Mitigation: pin processes to one node

```bash
numactl --cpunodebind=0 --membind=0 ./your-service
```

The service uses only CPUs and memory on node 0. Cross-node traffic = 0. Drawback: you have half the total CPU/RAM.

### Mitigation: pin shards to nodes

Each shard's memory is allocated on a specific NUMA node. Goroutines on that node's CPUs touch only that shard.

```go
// Pseudo-code; Go does not expose NUMA-aware allocation directly.
// You would need cgo or a syscall wrapper.
func (c *Cache) allocateShard(node int) *Shard {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    setAffinity(cpusOnNode(node))
    return newShard()
}
```

Go's allocator is not NUMA-aware. To get NUMA placement, you either:
- Pin entire processes (above).
- Allocate via `mmap` and use `madvise(MADV_HUGEPAGE)` + manual placement.
- Use cgo to call `numa_alloc_onnode`.

For most cloud workloads (single-socket VMs), NUMA is irrelevant. For bare metal multi-socket boxes serving cache-heavy traffic, it matters.

## CPU cache effects on linked-list LRU

A doubly-linked list scatters nodes across the heap. Traversing it triggers many L1/L2 misses:

```text
Visit node 1 (cache miss: load from L3 or memory)
  → next pointer points to a random heap address
Visit node 2 (cache miss again)
  → next pointer points to another random address
...
```

Each L1 miss costs ~10 ns; each L2 miss costs ~20 ns; each L3 miss costs ~100 ns. For 1M operations doing MoveToFront, this is significant.

### Mitigation: arena allocation

Allocate all list nodes in one contiguous slab:

```go
type linkedListArena struct {
    nodes []listNode
    free  []uint32 // free indexes
}

type listNode struct {
    prev, next uint32 // indexes, not pointers
    payload    unsafe.Pointer
}
```

Indexes instead of pointers. Adjacent nodes likely on the same cache line. L1 hit rate goes up; ops/sec goes up.

### Mitigation: array-backed Clock cache

Clock cache (covered above) uses a single slice. Iteration is contiguous; prefetching works. This is one reason Clock beats LRU on cache-bound workloads despite using more memory.

## How ristretto handles concurrency: a full walkthrough

A typical sequence of events:

```text
t=0:    Goroutine G1: cache.Get("alice")
        - shard 5 RLock
        - read items map
        - shard 5 RUnlock
        - push "alice" hash to shard 5's accessBuf
        - return value
        Total: ~100 ns

t=0.1ms: Goroutine G2: cache.Set("bob", value, 1)
         - send to setBuf channel (non-blocking)
         - if full: drop, increment dropSets metric, return
         Total: ~50 ns

t=0.5ms: ristretto background goroutine wakes up
         - drain setBuf: 100 items
         - for each: ask policy "admit?"
         - sketch.Estimate for the new key vs sketch.Estimate for current victim
         - if new > victim: admit, evict victim, store new
         - if new <= victim: drop new
         Total: ~10 µs for 100 items

t=1ms:   ristretto background drains accessBufs
         - for each shard's accessBuf, drain into policy.add
         - policy.add: sketch.Increment + SLRU move-to-front
         Total: ~10 µs per shard
```

The cache itself has lock contention only on the slow background path. Hot-path Get is RLock-only (often uncontended). Hot-path Set is channel send (lock-free for the sender).

### What about consistency?

A Set may not be visible to subsequent Gets until the background drains the buffer. A 100 µs window exists. For most caches this is fine — the cache is "eventually consistent" with itself.

For applications that need strict consistency (Set then immediate Get must return the new value), ristretto provides `cache.Wait()` to flush pending operations.

## Production case study: a cache that broke

A hypothetical-but-realistic story:

A service has a sharded LRU cache (`hashicorp/golang-lru/v2`, 32 shards, capacity 65536). For 6 months everything is fine. One day, p99 latency doubles. On call investigates.

### Symptoms

- p99 latency: 80 ms → 150 ms.
- p50: unchanged (5 ms).
- Hit rate: stable at 92%.
- CPU usage: stable.

### Investigation

`pprof` shows nothing unusual. The cache is not contended. The downstream is not slow.

### Insight

Comparing per-shard sizes:

```
shard  0: 1024
shard  1: 1023
shard  2: 1024
...
shard 17: 8192  ← cap
shard 18: 1024
```

Shard 17 is at capacity. Eviction rate on shard 17 is 1000/sec; on other shards, near zero.

A new code path generates keys with a prefix that hashes to shard 17. The hash function `maphash` is uniform, but the specific keys happened to land on one shard. Within shard 17, the working set is 16K but capacity is 2048 — heavy eviction → low hit rate → tail latency spike.

### Fix

Switch to ristretto. TinyLFU does not care about per-shard hash skew — admission is global.

### Lesson

Sharding is a coarse load balancer. It assumes uniform distribution. When the workload has *structure* the hash cannot break, sharding fails. ristretto-style admission policies are the next defense.

## When to NOT use a cache

A few cases where adding a cache makes things worse:

### Case 1 — Already-fast database query

If your DB returns in 200 µs, the cache (with serialisation, hash, lock) returns in 50 µs. Saving 150 µs at the cost of staleness, complexity, and 100 MB of RAM is usually not worth it.

### Case 2 — Highly volatile data

If the data changes every few seconds, your TTL must be < 1 second to be safe. At that TTL, the cache rarely warms up — every Get is a miss followed by a Set. The cache is pure overhead.

### Case 3 — Write-heavy workloads

If your service writes more than it reads, the cache is mostly being invalidated. The hit rate stays low.

### Case 4 — Already in a database cache

Most databases have their own buffer pool. Postgres's shared_buffers, MySQL's InnoDB buffer pool. If your queries hit those, the database is already serving from RAM. An additional in-process cache adds little.

### Case 5 — Strong consistency required

If a stale read is unacceptable (financial balances, security decisions), the cache must be bypassed for those reads. At that point, the cache is helping only a subset of traffic — measure if it's worth it.

## A senior-level interview question

> "We have a service doing 10 GB/s of throughput, 99% reads, 1% writes. The current cache is `hashicorp/golang-lru/v2` with capacity 1M. Hit rate is 60%. p99 latency is 50 ms. How would you improve?"

A good answer covers:

1. **Identify the bottleneck.** 60% hit rate is low. Why? Working set too big, scans evicting hot data, or wrong policy?
2. **Measure.** Hit rate per key prefix. Eviction rate. Mutex profile.
3. **Hypothesise.** If working set > 1M, increase capacity. If scans evicting, switch to 2Q. If frequency-skewed, switch to ristretto.
4. **Roll out behind flag.** Compare.
5. **Iterate.** Cache tuning is rarely one-and-done.

A bad answer goes straight to "switch to ristretto" without measurement. The reviewer wants the *process*, not the destination.

## The library-vs-from-scratch decision tree

```text
Throughput target:
  < 1M ops/s ─► hashicorp/golang-lru/v2 (single mutex)
  1-10M ops/s ─► hashicorp/golang-lru/v2 (sharded wrapper)
  > 10M ops/s ─► measure: contention or hit-rate?
                  ├─ contention ─► ristretto
                  └─ hit-rate ─► investigate algorithm choice

Memory:
  < 100 MB ─► on-heap (any library)
  100 MB-1 GB ─► on-heap with GC tuning
  > 1 GB ─► consider bigcache or freecache

Latency SLO:
  > 100 µs p99 ─► almost any cache
  10-100 µs p99 ─► sharded LRU or ristretto
  < 10 µs p99 ─► ristretto or custom Clock-based

Build your own:
  Only if you need: custom key type, custom cost model, custom eviction,
  AND you've measured existing libraries and proven they don't suffice.
```

## Deep dive: lock-free progress guarantees

Senior-level concurrency vocabulary worth knowing precisely:

- **Wait-free**: every operation completes in a bounded number of steps, regardless of contention. Strongest guarantee.
- **Lock-free**: at least one operation completes in a bounded number of steps. Some operations may retry indefinitely.
- **Obstruction-free**: an operation completes if it runs alone for long enough. Weakest non-blocking guarantee.

Most "lock-free" data structures in practice are *lock-free* (the middle definition) — operations may retry under contention but the system makes progress.

For caches:

- **`atomic.Pointer.Load`** is wait-free. ~1 ns.
- **`atomic.CompareAndSwap`** is lock-free. ~5 ns uncontended, much slower contended.
- **`sync.Mutex.Lock`** is blocking. ~25 ns uncontended, potentially milliseconds contended.

A cache built on atomic pointers (e.g., snapshot pattern for hot keys) is wait-free. A cache built on CAS loops (Treiber stack, Michael-Scott queue) is lock-free. A cache built on Mutex is blocking. The progress guarantee influences worst-case latency.

### What to choose

For p99 latency targets <1 µs, prefer wait-free reads. The mutex's worst-case wait is unbounded under contention. The atomic load is bounded.

For p99 targets >10 µs, mutex is fine. The contention overhead is in the noise.

## Hash function choice for sharding

The shard hash matters more at senior scale. Properties to balance:

- **Speed**: hashes are computed on every Get.
- **Distribution**: must spread keys across shards uniformly.
- **Avalanche**: a 1-bit change in input should flip ~half the output bits.
- **Resistance to crafted collisions**: random seed defeats this concern.

### Options

#### `hash/maphash`

- Speed: ~20 ns for short strings.
- Quality: excellent.
- Seed: random by default.
- Use as default.

#### FNV-1a

- Speed: very fast (~5 ns for 16-byte keys).
- Quality: mediocre. Bad avalanche.
- Seed: none (deterministic).
- Use only when you control inputs and need raw speed.

#### xxhash / xxh3

- Speed: extremely fast (~3 ns per byte).
- Quality: excellent.
- Seed: supported.
- Use when `maphash` shows up in profiles.

#### Murmur3

- Speed: fast.
- Quality: good.
- Seed: supported.
- Use when you need an integer-friendly hash (Go has multiple implementations).

For most workloads, `maphash` is the right choice. Switch to `xxhash` if profiling shows hashing is >5% of CPU.

## Sharded LRU and Go's escape analysis

A subtle performance issue: the `maphash.Hash` value in `pick(k)`:

```go
func (c *Cache) pick(k string) *shard {
    var h maphash.Hash // does this escape?
    h.SetSeed(c.seed)
    h.WriteString(k)
    return c.shards[h.Sum64()&c.shardMask]
}
```

If Go's escape analysis decides `h` escapes to the heap, every Get allocates. Check with:

```bash
go build -gcflags='-m' ./...
```

Look for `moved to heap: h`. If you see it, the hash struct allocates every call.

Workaround: cache a per-goroutine hash via `sync.Pool`:

```go
var hashPool = sync.Pool{
    New: func() interface{} { return new(maphash.Hash) },
}

func (c *Cache) pick(k string) *shard {
    h := hashPool.Get().(*maphash.Hash)
    h.Reset()
    h.SetSeed(c.seed)
    h.WriteString(k)
    s := c.shards[h.Sum64()&c.shardMask]
    hashPool.Put(h)
    return s
}
```

The pool eliminates the allocation. Verify with `b.ReportAllocs()` in benchmarks.

For string keys this is rarely needed — modern Go usually keeps `maphash.Hash` on the stack. But for struct keys with custom marshalling, the allocation can sneak in.

## Special technique: sharded `sync.Map` style cache

For caches that are *almost* read-only (read-mostly, with rare writes), `sync.Map`-inspired design can outperform LRU.

```go
type ReadMostlyCache[K comparable, V any] struct {
    read  atomic.Pointer[map[K]V] // immutable snapshot
    write sync.Mutex
    dirty map[K]V                  // protected by write
}

func (c *ReadMostlyCache[K, V]) Get(k K) (V, bool) {
    m := c.read.Load()
    if m != nil {
        if v, ok := (*m)[k]; ok {
            return v, true
        }
    }
    var zero V
    return zero, false
}

func (c *ReadMostlyCache[K, V]) Add(k K, v V) {
    c.write.Lock()
    defer c.write.Unlock()
    if c.dirty == nil {
        c.dirty = make(map[K]V)
        if m := c.read.Load(); m != nil {
            for k, v := range *m { c.dirty[k] = v }
        }
    }
    c.dirty[k] = v
}

func (c *ReadMostlyCache[K, V]) Commit() {
    c.write.Lock()
    defer c.write.Unlock()
    if c.dirty == nil { return }
    m := c.dirty
    c.read.Store(&m)
    c.dirty = nil
}
```

Reads are wait-free (atomic load + map read). Writes batch up and are committed periodically. Suitable for caches that are written sporadically (config caches, schema caches, type-info caches).

Drawback: there is no eviction. The map grows. For bounded caches use LRU.

## A note on Generics in Go cache libraries

Pre-1.18 Go cache libraries used `interface{}`. Every Get returned `interface{}`, requiring a type assertion. The conversion was both a CPU cost (~5 ns) and an opportunity for runtime panics if the type was wrong.

`hashicorp/golang-lru/v2` uses generics. Get returns the typed `V` directly. No assertion. Compile-time safety. Slightly smaller and faster.

If you maintain a Go service, prefer v2. The migration is mechanical (`lru.New(N)` → `lru.New[K, V](N)`).

For libraries that have not migrated, wrap them:

```go
type TypedCache[V any] struct {
    inner *oldlib.Cache
}

func (c *TypedCache[V]) Get(k string) (V, bool) {
    v, ok := c.inner.Get(k)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}
```

Centralises the assertion in one place. The cost is still there; the bug surface is smaller.

## NUMA, hugepages, and the cache footprint

For caches >100 MB on Linux, the kernel may use 4-KiB pages by default. A 1 GB cache means 256 K pages. The TLB has ~2 K entries. Every random access risks a TLB miss (~100 ns).

### Hugepages

Transparent huge pages (THP) help — Linux automatically promotes contiguous 4-KiB ranges to 2-MiB hugepages. Verify with:

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
```

`[always] madvise never` is good. `always` is aggressive (more memory waste); `madvise` is opt-in.

For Go, opt in:

```go
syscall.Madvise(buf, syscall.MADV_HUGEPAGE) // requires unsafe and syscall
```

This is rarely necessary. THP defaults are usually fine.

### Pinning to NUMA

For multi-socket machines, pin the service to one socket. Even if it uses half the cores, latency is more predictable.

```bash
numactl --cpunodebind=0 --membind=0 ./service
```

In Kubernetes, set CPU pinning with `cpuManagerPolicy=static` and use `Guaranteed` QoS.

## Cache library benchmarks (illustrative)

Numbers from a 16-core AMD machine, 1M ops/goroutine, 16 parallel goroutines, capacity 100K, keyspace 200K (50% miss rate):

```
                          ns/op   alloc/op   B/op  hit rate
hashicorp/golang-lru/v2    264         1     16    49.8%
sharded golang-lru (16)     45         2     24    49.7%
sharded golang-lru (64)     22         2     24    49.7%
ristretto                   12         0      0    52.3%
bigcache                    35         3     48    49.6%
freecache                   28         2     32    49.7%
go-cache                   180         1     16    49.8%
ccache                      52         2     24    49.8%
```

Interpretations:

- **Single mutex** is 10-20x slower than alternatives at 16-core parallelism.
- **Sharded golang-lru** matches off-heap libraries on speed.
- **ristretto** wins on speed *and* hit rate (52.3% vs 49.7% — TinyLFU's admission gives ~3% more useful entries).
- **bigcache/freecache** are competitive at this size, but pay for serialization overhead in time and allocations.

These numbers will change with your CPU, key size, and value type. The relative rankings are stable.

## Memory accounting: when does the cache "fit"?

A cache fits in memory when:

```
cap × (avgKeySize + avgValueSize + overhead) + index ≤ budget
```

where:

- **avgKeySize**: ~16-32 bytes for typical string keys.
- **avgValueSize**: workload-dependent; can be 100 bytes to MB.
- **overhead**: per-entry struct (entry + list element) ~40-60 bytes.
- **index**: map buckets ~16-24 bytes per entry.

For 1M entries with 1 KB values:

- entries: 1M × 1 KB = 1 GB.
- overhead: 1M × 50 = 50 MB.
- index: 1M × 20 = 20 MB.
- Total: ~1.07 GB.

If your budget is 1 GB, you can fit ~900K entries. Plan accordingly.

For off-heap caches:

- entries: 1M × 1 KB = 1 GB (in the byte arena).
- index: 1M × 30 = 30 MB.
- No per-entry overhead (data is packed in the arena).
- Total: ~1.03 GB.

Slightly more efficient than on-heap. The real win is GC.

## Eviction policies: a deeper comparison

A side-by-side of eviction policies on different workloads. Numbers are illustrative hit rates.

| Policy | Uniform random | Zipf 1.0 | Zipf 1.2 | Sequential scan | Mixed (90% hot, 10% scan) |
|--------|----------------|----------|----------|-----------------|---------------------------|
| LRU    | 50%            | 75%      | 88%      | 0%              | 60%                       |
| 2Q     | 50%            | 76%      | 89%      | 5%              | 80%                       |
| ARC    | 50%            | 77%      | 89%      | 8%              | 82%                       |
| SLRU   | 50%            | 76%      | 88%      | 6%              | 78%                       |
| LFU    | 50%            | 80%      | 92%      | 0%              | 75%                       |
| W-TinyLFU | 50%         | 81%      | 92%      | 10%             | 88%                       |
| Belady (oracle) | 52%   | 83%      | 93%      | 50%             | 92%                       |

Observations:

- Random workload: all policies equal (LRU has no advantage when nothing has locality).
- Heavy skew (Zipf 1.2): all policies do well; LFU and W-TinyLFU slightly better.
- Sequential scan: LRU is catastrophic. W-TinyLFU survives.
- Mixed: W-TinyLFU shines because it has both window (for new entries) and admission (for scan resistance).

For most production workloads (closer to "Mixed"), W-TinyLFU is empirically the best general-purpose choice. ARC is a close second. LRU is fine for "well-behaved" workloads.

## Building intuition: cache "shape"

A cache's behaviour is determined by its shape:

```
Cache shape = (capacity, policy, TTL, eviction granularity)
```

Two caches with the same parameters but different policies behave differently. Two caches with the same policy but different capacities behave differently. The art is matching shape to workload.

### Capacity vs hit-rate curve

For most workloads, plot capacity on x and hit rate on y:

```
hit rate
  │                       _________ 95%
  │                  ___/         (asymptote)
  │              ___/
  │           __/  ← sweet spot (90%)
  │         _/
  │       _/
  │     _/
  │   _/  ← steep gain (60%)
  │ _/
  │/
  └──────────────────────────────► capacity
   10    100   1K   10K  100K  1M
```

Most workloads exhibit diminishing returns past 10x the working set. The "sweet spot" is at the knee of the curve. Beyond that, you spend memory for tiny gains.

### TTL vs freshness curve

Plot TTL on x and freshness (1 - average staleness) on y:

- Short TTL: high freshness, low hit rate (cache rarely warm).
- Long TTL: low freshness, high hit rate.
- Sweet spot: TTL = max acceptable staleness.

### Capacity vs memory curve

Linear, but with a slope determined by value size. Plan for the slope, not just the number.

## Patterns for adversarial environments

Caches in user-facing services face hostile traffic: bots scanning for vulnerabilities, scrapers crawling everything, DoS attempts. The cache must survive.

### Pattern: per-source rate limit on cache misses

```go
type RateLimitedCache struct {
    inner    *lru.Cache[string, *Value]
    perIPMisses map[string]*atomic.Uint64
    threshold uint64
}

func (c *RateLimitedCache) Get(ip, key string) (*Value, error) {
    if v, ok := c.inner.Get(key); ok {
        return v, nil
    }
    cnt := c.getMissCounter(ip)
    if cnt.Add(1) > c.threshold {
        return nil, ErrRateLimitExceeded
    }
    v, err := c.load(key)
    if err != nil {
        return nil, err
    }
    c.inner.Add(key, v)
    return v, nil
}
```

The bot that misses 1000 times per second hits the rate limit before consuming much cache space.

### Pattern: tarpit on cache miss for suspicious clients

For clients hitting the cold path repeatedly, deliberately slow down:

```go
if c.isSuspicious(ip) {
    time.Sleep(100 * time.Millisecond)
}
```

100 ms per request limits the attacker to 10 requests/sec/connection. Legitimate clients (who hit the cache) are unaffected.

### Pattern: priority queue for cold path

Cold-path loads from the database can be assigned priority. Internal users get high priority; suspicious users get low priority. A worker pool with a priority queue processes them:

```go
type PriorityLoader struct {
    workers int
    queue   *priorityQueue
}

func (p *PriorityLoader) Load(ctx context.Context, key string, priority int) (*Value, error) {
    ch := make(chan loadResult, 1)
    p.queue.Push(&loadJob{key: key, priority: priority, ch: ch})
    select {
    case r := <-ch:
        return r.v, r.err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

Under attack, the queue saturates with low-priority work; legitimate high-priority requests still go through.

## Pattern: cache that survives downstream outage

When the database is down, a stale cache is better than nothing.

```go
type ResilientCache struct {
    inner *lru.Cache[string, entry]
    loader func(key string) (*Value, error)
}

type entry struct {
    val       *Value
    fetchedAt time.Time
}

func (c *ResilientCache) Get(key string) (*Value, error) {
    e, ok := c.inner.Get(key)
    if ok && time.Since(e.fetchedAt) < c.softTTL {
        return e.val, nil
    }
    v, err := c.loader(key)
    if err == nil {
        c.inner.Add(key, entry{val: v, fetchedAt: time.Now()})
        return v, nil
    }
    // loader failed — serve stale if we have it
    if ok {
        return e.val, nil
    }
    return nil, err
}
```

During a downstream outage, the cache continues serving stale data. Latency stays low; correctness drops to "stale but consistent."

Combine with a circuit breaker: once the downstream has failed 5 times in 10 seconds, stop trying for 30 seconds. Serve stale during the breaker window.

## Worked example: an HTTP service with everything

A complete sketch of an HTTP service that uses every advanced technique:

```go
type Service struct {
    cache        *ristretto.Cache
    sf           singleflight.Group
    breaker      *gobreaker.CircuitBreaker
    rateLimit    *rate.Limiter
    hotKeyL1     *atomic.Pointer[map[string]*Value]
    pubsub       *redis.PubSub
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    id := mux.Vars(r)["id"]

    // 1. L1 cache (lock-free, hot keys only)
    if hot := s.hotKeyL1.Load(); hot != nil {
        if v, ok := (*hot)[id]; ok {
            respond(w, v)
            return
        }
    }

    // 2. L2 cache (ristretto, per-pod)
    if v, ok := s.cache.Get(id); ok {
        respond(w, v.(*Value))
        return
    }

    // 3. Rate limit per source
    if !s.rateLimit.Allow() {
        http.Error(w, "too many cache misses", http.StatusTooManyRequests)
        return
    }

    // 4. Singleflight for concurrent misses
    v, err, _ := s.sf.Do(id, func() (interface{}, error) {
        // 5. Circuit breaker around the slow loader
        return s.breaker.Execute(func() (interface{}, error) {
            return s.load(ctx, id)
        })
    })

    if err != nil {
        // 6. Fall back to stale data if we have it
        if v, ok := s.cache.GetTTL(id); ok {
            respond(w, v.(*Value))
            return
        }
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }

    val := v.(*Value)
    // 7. Populate cache
    s.cache.SetWithTTL(id, val, int64(estimateSize(val)), 5*time.Minute)
    respond(w, val)
}

func (s *Service) subscribeToInvalidations() {
    for msg := range s.pubsub.Channel() {
        // 8. Cross-pod invalidation
        s.cache.Del(msg.Payload)
    }
}
```

Every layer earns its place:
- L1 absorbs the hottest keys without locks.
- L2 absorbs the next tier.
- Rate limit prevents abuse.
- Singleflight deduplicates concurrent misses.
- Circuit breaker survives downstream outages.
- Stale-fallback keeps the service responsive.
- Cross-pod pub/sub propagates writes.

This is the architecture you build to a 100K-QPS endpoint. It is also more complexity than 95% of services need.

## Theoretical limits: what is the best possible hit rate?

For a given workload, there is a theoretical optimal cache: **Belady's algorithm**, which evicts the entry that will be used furthest in the future. Belady's is offline (it needs the future). Real caches approximate it.

For a uniform random workload over N distinct keys with cache size C:

- Hit rate ≈ C / N (linear).

For a Zipf-distributed workload (the realistic case for most web traffic):

- Hit rate climbs faster. C = 10% of N may yield 80% hit rate.

For a heavy-tailed workload (a few extremely hot keys):

- Hit rate can exceed 99% with very small C.

The gap between LRU and Belady's depends on the workload's predictability. LRU achieves ~80% of Belady's optimal on typical workloads. W-TinyLFU achieves ~90-95%. The remaining 5-10% requires future knowledge — unattainable without prediction.

For most services, the move from LRU to W-TinyLFU yields a 5-15% hit-rate improvement. That can translate to a 20-50% latency reduction (because misses dominate the tail).

## Designing the cache API: what makes a good one

When you wrap a cache library or build your own, the API surface matters. Lessons learned across many caches:

### Make the loader explicit

```go
// Bad: implicit loader.
v := cache.Get(key)

// Good: caller provides loader.
v, _ := cache.GetOrLoad(key, loader)

// Best: separate concerns.
if v, ok := cache.Get(key); ok { return v }
v, _ := loader()
cache.Add(key, v)
return v
```

The separation of cache and loader makes testing trivial — mock the loader, exercise the cache.

### Distinguish "not found" from "zero value"

```go
// Bad
v := cache.Get(key) // returns zero if missing; ambiguous

// Good
v, ok := cache.Get(key) // ok is the explicit signal
```

The library convention is `(V, bool)`. Follow it.

### Make eviction observable

```go
type Cache interface {
    OnEviction(func(key K, value V))
    // ...
}
```

Without an eviction hook, you cannot know when an entry leaves. For caches holding resources (file handles, sockets) this is essential.

### Provide deterministic batch operations

```go
// Single-key, sometimes useful.
cache.Set(k, v)

// Batch, often faster and atomic-ish.
cache.SetMulti(map[K]V{ ... })
```

Some libraries provide batch ops; most do not. When they do not, callers loop — losing the chance for optimization.

### Don't expose internals

```go
// Bad
type Cache struct { Inner *internalList } // exported

// Good
type Cache struct { inner *internalList } // unexported
```

Exposing internals means consumers depend on them. Refactoring becomes a breaking change. Hide.

### Document the contract

```go
// Get returns the value for key.
//
// On hit, the entry is promoted to most-recently-used position.
// On miss, returns (zero, false).
//
// Get is safe for concurrent use.
// Get may block briefly under contention.
func (c *Cache) Get(key K) (V, bool)
```

The contract is what consumers rely on. Vague contracts force consumers to read the source.

## Patterns from real cache libraries

### Pattern: builder for complex configuration

```go
cache := lru.NewBuilder[string, int]().
    Capacity(1024).
    Shards(16).
    TTL(5 * time.Minute).
    OnEvict(func(k string, v int) {}).
    Build()
```

Easier to read than 5-argument constructors. Java cache libraries (Caffeine) use this heavily.

### Pattern: functional options

```go
cache := lru.New(
    lru.WithCapacity(1024),
    lru.WithShards(16),
    lru.WithTTL(5*time.Minute),
    lru.WithEvictionCallback(onEvict),
)
```

Go-idiomatic. The same outcome as builder but lighter weight.

### Pattern: pluggable algorithms

```go
type Policy interface {
    Add(key K) (evicted bool, victim K)
    Touch(key K)
    Remove(key K)
}

cache := lru.NewWithPolicy(NewLRU(1024))
// or
cache := lru.NewWithPolicy(NewTinyLFU(1024))
```

Lets the same cache type swap eviction policies. Useful for libraries that want to support multiple variants from one codebase.

## Property-based testing for caches

Property tests verify invariants over random inputs:

```go
func TestCacheInvariants(t *testing.T) {
    f := func(ops []Op) bool {
        c := lru.New[string, int](100)
        for _, op := range ops {
            switch op.Kind {
            case OpGet:
                c.Get(op.Key)
            case OpSet:
                c.Add(op.Key, op.Val)
            case OpRemove:
                c.Remove(op.Key)
            }
            if c.Len() > 100 {
                return false
            }
        }
        return true
    }
    if err := quick.Check(f, nil); err != nil {
        t.Fatal(err)
    }
}
```

The library generates millions of random op sequences. Any sequence that violates `c.Len() <= 100` is reported. Property tests catch bugs that hand-written examples miss.

Useful invariants for caches:

- `len(items) == len(list)` (map and list agree).
- `Len() <= capacity`.
- After `Remove(k)`, `Contains(k) == false`.
- After `Add(k, v)` + `Get(k)`, value is `v`.
- After `Purge`, `Len == 0`.

## A 30-minute exercise: build a ConcurrentLRU benchmark suite

Reproduce the table from `middle.md` on your hardware:

1. Implement single-mutex LRU, sharded LRU (16, 64), and add ristretto and `sync.Map`.
2. Benchmark each at 1, 4, 16 goroutines.
3. Vary capacity (1K, 10K, 100K, 1M).
4. Vary keyspace (uniform, Zipf, sequential).
5. Plot throughput per configuration.

You will discover that:

- Single mutex is bad at high concurrency, regardless of capacity.
- Sharded is consistent across concurrency.
- ristretto pulls ahead at high concurrency and high capacity.
- `sync.Map` is mediocre but works without eviction (memory grows).

The exercise teaches more than reading benchmark tables — you internalise the trade-offs.

## A look at the future

A few directions the field is moving:

- **S3-FIFO** and similar simple algorithms challenge complex LFU-based caches. Watch for Go implementations.
- **Persistent caches** (sled, FoundationDB) blur the cache/database line. In-process caches still win on latency.
- **Hardware-accelerated hashing** (Intel CRC32, ARM CRC32) makes hash cost essentially free; sharding becomes "always on."
- **eBPF cache instrumentation** lets you measure hit rates without code changes.
- **Generic generic constraints** in Go's type system may eventually let cache libraries impose more invariants on K and V types.

Caching is unlikely to be "solved" in any final sense — workloads keep evolving and the trade-offs shift with hardware. The patterns in this file are the foundation; the specifics will change.

## Performance breakdown by operation phase

For a single `Get` on a sharded LRU, where does the time go?

```text
Phase                                    Time      Cumulative
1. Hash the key                          15 ns     15 ns
2. Pick shard (bitmask)                   1 ns     16 ns
3. RLock the shard                        5 ns     21 ns
4. Map lookup                            20 ns     41 ns
5. RUnlock                                3 ns     44 ns
6. Push to access buffer (lossy)          5 ns     49 ns
7. Return value pointer                   1 ns     50 ns
```

~50 ns per uncontended Get. Under contention the lock phases (3 and 5) inflate to hundreds of nanoseconds.

For ristretto without locks:

```text
Phase                                    Time      Cumulative
1. Hash the key                          15 ns     15 ns
2. Pick shard                             1 ns     16 ns
3. Atomic load of shard map               5 ns     21 ns
4. Map lookup                            20 ns     41 ns
5. Push to lossy buffer                   3 ns     44 ns
```

~44 ns. Slightly faster.

For a custom Clock cache:

```text
Phase                                    Time      Cumulative
1. Hash the key                          15 ns     15 ns
2. Pick shard                             1 ns     16 ns
3. RLock                                  5 ns     21 ns
4. Map lookup                            20 ns     41 ns
5. Atomic store on referenced            5 ns     46 ns
6. RUnlock                                3 ns     49 ns
```

Similar to sharded LRU. The win comes under contention: Clock's RLock can be held by many readers simultaneously.

For an off-heap byte cache:

```text
Phase                                    Time      Cumulative
1. Hash the key                          15 ns     15 ns
2. Pick shard                             1 ns     16 ns
3. RLock                                  5 ns     21 ns
4. Lookup offset                         15 ns     36 ns
5. Copy bytes from arena                 30 ns     66 ns
6. RUnlock                                3 ns     69 ns
7. Deserialize bytes                     200 ns    269 ns
```

~270 ns. Much slower than on-heap, but the GC win can dominate for large caches.

The lesson: most of a cache Get is the map lookup, not the lock. Optimizing the lock without optimizing the map is futile.

## When measurement matters most

Some optimizations are essentially free to try and measure. Some are expensive (require refactoring, library swap) and worth measuring first. A non-exhaustive list:

### Cheap to try
- Adjust capacity.
- Adjust TTL.
- Increase shard count.
- Add `b.RunParallel` benchmarks.

### Moderately expensive
- Switch cache libraries (golang-lru → ristretto).
- Add singleflight wrapper.
- Add eviction callback for metrics.

### Expensive
- Write a custom cache type.
- Move to off-heap storage.
- Implement NUMA-aware sharding.
- Add cross-pod invalidation.

Spend time measuring proportional to the cost of the fix.

## Cache wisdom: aphorisms

A few sentences worth memorizing:

- **"The fastest cache is no cache."** Make the source of truth fast enough first.
- **"A cache is a confession of failure."** It says you couldn't make the source of truth fast enough.
- **"Stale data with a smile is better than no data with an apology."** Serve stale during outages.
- **"Cache invalidation is one of the two hard things in computer science. There are no fundamental solutions, only trade-offs."**
- **"The hit rate metric you don't have is the hit rate metric you wish you had at 3 AM."** Always measure.
- **"Sharding turns one contention problem into N smaller ones; not into zero."** Eventually you need a different algorithm.
- **"Pretty code that doesn't measure beats clever code that doesn't measure."** Bias toward simplicity.

## Closing thoughts

Senior-level caching is mostly about **knowing the trade-offs deeply enough to choose wisely**. The implementations are largely available off the shelf. The art is matching workload to mechanism, profiling rigorously, and resisting the temptation to over-engineer.

A simple `lru.New[K, V](N)` serves 95% of services well. The other 5% require everything in this file. Knowing which group you are in — and arriving at that conclusion via measurement, not intuition — is the senior-level skill.

The professional file goes one layer deeper: formal hit-rate analysis, TinyLFU's mathematical foundations, GC pressure quantification, and the design decisions that motivated S3-FIFO.

## Summary

Senior-level concurrent LRU is about understanding the mechanisms that high-performance caches use: lock-free reads via BP-Wrapper, frequency-aware admission via Count-Min Sketch, off-heap storage to avoid GC pressure, careful memory layout to avoid false sharing, and topology choices (sharding, sticky routing, hierarchies) that survive real-world adversarial traffic.

Most services do not need this. Those that do — the ones doing tens of millions of operations per second — earn it back many times over in CPU and latency savings.

The professional file goes deeper into the theory: TinyLFU's mathematical foundations, formal hit-rate analysis, NUMA-aware sharding internals, and the design choices that shaped the 2024 S3-FIFO paper.
