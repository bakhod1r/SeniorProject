---
layout: default
title: Optimize
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/optimize/
---

# Concurrent Skip List — Optimization

> A textbook concurrent skip list — locks per node, atomic next pointers, marker-based deletion — is a respectable starting point. It rarely lasts long in production. The path from "correct" to "fast enough to replace `sync.Map` in your hot path" is paved with cache-aware layout, contention sharding, randomization tuning, and, eventually, a switch to a battle-tested library.
>
> Each entry below presents a real bottleneck, a "before" sketch, an "after" sketch, and the magnitude of the improvement you should expect. Numbers are illustrative — measure on your own workload before adopting any of these.

---

## Optimization 1 — Reduce contention with finer-grained CAS

**Problem.** A skip-list insertion locks all `lvl` predecessors with `sync.Mutex`. Under heavy concurrent insert at the hot end of the list, the locks at lower levels are uncontended (writers come in at different keys), but the level-`maxLevel - 1` lock is held briefly on every insertion that promotes that high. That lock becomes the bottleneck.

**Before:**
```go
type node struct {
    key  int
    next []atomic.Pointer[node]
    mu   sync.Mutex // one mutex covers all levels
}

func (s *SkipList) Insert(key int) bool {
    for {
        preds, succs := s.findPath(key)
        // Lock every predecessor (one mutex per node, but each covers all levels)
        for i := 0; i < lvl; i++ {
            preds[i].mu.Lock()
        }
        // ... validate, link, unlock ...
    }
}
```

**After (per-level CAS, no mutex):**
```go
type node struct {
    key  int
    next []atomic.Pointer[node] // each level wired independently
}

func (s *SkipList) Insert(key int) bool {
    n := &node{key: key, next: make([]atomic.Pointer[node], lvl)}
    for i := 0; i < lvl; i++ {
        for {
            preds, succs := s.findPathAt(key, i)
            n.next[i].Store(succs[i])
            if preds[i].next[i].CompareAndSwap(succs[i], n) {
                break
            }
        }
    }
    return true
}
```

Each level is its own retry loop. The level-0 CAS is the linearization point; upper-level CASes are best-effort. Two inserts at different keys never block each other at any level.

**Gain.** On 16-thread mixed insert workloads, throughput typically improves 3–5× versus the predecessor-locking variant. The mutex disappears from the contention profile entirely.

Caveat: this complicates `Delete`. The two-phase marker pattern is mandatory; without it, the per-level CAS race window is wide open. See `find-bug.md` Bug 2.

---

## Optimization 2 — Tune the level-promotion probability

**Problem.** Classical skip lists use `p = 0.5` (each node promotes one level with probability 0.5, terminating geometrically). This minimizes expected total pointers (~2 per node) but is not always optimal for *time*. Lower `p` means denser upper levels (more pointers per node), so a search descends fewer levels at the cost of more memory.

**Measurements** for 1M random inserts then 10M `Contains` calls on x86 (8-core, 32 GB RAM):

| `p`     | Avg pointers per node | `Contains` ns/op | Memory factor |
| ------- | --------------------- | ----------------- | ------------- |
| 0.5     | 2.0                   | 380               | 1.0×          |
| 0.25    | 1.33                  | 320               | 0.67×         |
| 0.125   | 1.14                  | 350               | 0.57×         |
| 0.0625  | 1.07                  | 410               | 0.53×         |

The sweet spot is around `p = 0.25` for typical workloads on modern x86. Below that, upper levels become so sparse that the search degenerates toward linear at level 0; above that, each node carries unnecessary pointers and cache pressure increases.

**Before:**
```go
func (s *SkipList) randomLevel() int {
    lvl := 1
    for lvl < s.maxLevel && s.rng.Int63()&1 == 0 {
        lvl++
    }
    return lvl
}
```

**After (`p = 0.25`):**
```go
func (s *SkipList) randomLevel() int {
    lvl := 1
    for lvl < s.maxLevel && s.rng.Int63()&3 == 0 { // 1/4 chance
        lvl++
    }
    return lvl
}
```

**Gain.** ~15% faster `Contains` on the benchmarked machine. Memory drops by 33%.

The sweet spot drifts with cache size. Run the audit on every new target hardware. The library `skipset` uses `p = 1/e ≈ 0.37`, justified by an analytical argument; in practice on x86, `0.25` is close enough.

---

## Optimization 3 — Cache-aware node layout

**Problem.** A skip-list `Contains` walks `O(log n)` nodes; each walk touches the node's `key` and its `next[i]` pointer at the current level. If `key` and `next[0]` live on different cache lines, every node visit is two cache misses on a cold cache.

**Before:**
```go
type node struct {
    key  int                    // 8 bytes
    next []atomic.Pointer[node] // slice header: 24 bytes
    // total: 32 bytes header, but slice points to a separate heap allocation
}
```

When `Contains` reads `node.next[i]`, it fetches the slice header (one cache line), then the backing array (another cache line). Two cache misses per node, in the worst case.

**After:**
```go
type node struct {
    key   int
    next0 atomic.Pointer[node] // hot: read on every level-0 walk
    _     [40]byte             // pad to 64-byte cache line
    upper []atomic.Pointer[node] // cold: indexed only on multi-level walks
}
```

Reading `key` and `next0` is now one cache line. The `upper` slice header lives on the next cache line, accessed only when the search needs to descend below level 0.

Allocate the `upper` slice eagerly with capacity equal to the node's level — `make([]atomic.Pointer[node], lvl-1)`. Index 0 in `upper` corresponds to level 1 of the skip list (level 0 is `next0`).

**Gain.** 20–40% faster `Contains` on read-heavy workloads. Measure with `perf stat -e cache-misses,L1-dcache-load-misses`.

This is the optimization `skipset` makes for integer-keyed skip lists. Generic Go's monomorphization in 1.18+ helps but cannot match a hand-tuned cache-aware layout.

---

## Optimization 4 — Co-locate the marker with `next[0]`

**Problem.** The marker-based delete pattern uses a `markedRef` struct:

```go
type markedRef struct {
    next    *node
    deleted bool
}
```

Each `node` holds `mref atomic.Pointer[markedRef]`. Reading the marker requires two pointer hops: load `mref`, then dereference. Each hop is a potential cache miss.

**Before:**
```go
type node struct {
    key  int
    mref atomic.Pointer[markedRef]
}
```

`Contains` checks `mref.Load().deleted` for every node visited. Two cache misses per check.

**After (tagged pointer):**
```go
type node struct {
    key   int
    next0 atomic.Uintptr // low bit is the deleted marker
}

func (n *node) loadNext() (*node, bool) {
    raw := n.next0.Load()
    return (*node)(unsafe.Pointer(raw &^ 1)), raw&1 != 0
}

func (n *node) markDeleted() bool {
    raw := n.next0.Load()
    if raw&1 != 0 {
        return false
    }
    return n.next0.CompareAndSwap(raw, raw|1)
}
```

The deletion flag is the low bit of the pointer (alignment guarantees the low 3 bits are zero on every Go architecture). One word holds both the successor pointer and the deleted bit; one atomic operation reads or writes them together. No `markedRef` allocation, no second cache line.

**Gain.** 30–50% faster `Delete` and 10–15% faster `Contains` because the cold-cache path drops one indirection.

Caveat: tagged pointers require `unsafe`. They are correct on every architecture Go targets, but the compiler will not protect you from misuse. Wrap the encode/decode in inline helpers and test heavily with the race detector.

---

## Optimization 5 — Replace `findPath` with descending search

**Problem.** A naive concurrent skip list calls `findPath(key)` to find all predecessors and successors at every level, even when only a few levels matter. For a `Contains`, all upper-level walks are wasted; only the final level-0 lookup matters.

**Before:**
```go
func (s *SkipList) Contains(key int) bool {
    preds, succs := s.findPath(key) // returns 2 * maxLevel pointers
    _ = preds
    return succs[0] != nil && succs[0].key == key
}
```

`findPath` allocates two slices per call. At high QPS this is millions of allocations per second; GC pressure dominates.

**After (descending search, no allocation):**
```go
func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil || nxt.key >= key {
                break
            }
            curr = nxt
        }
    }
    nxt := curr.next[0].Load()
    return nxt != nil && nxt.key == key
}
```

No allocation. One pointer (`curr`) walks down levels, then forward.

**Gain.** 10–20% faster `Contains` and a massive drop in GC frequency. On microbenchmarks dominated by `Contains`, this single change can be the biggest win.

Use the descending search variant for `Contains`, `Range`'s initial seek, and lock-free `Insert`'s preliminary key-existence check. Only the full-locking `Insert` truly needs `findPath`.

---

## Optimization 6 — Eliminate the `topLevel` field

**Problem.** Many skip list implementations maintain `topLevel`, the highest level currently in use. It speeds up searches when the list is small. But `topLevel` is concurrent shared state: every insert that grows the list bumps it, every delete that empties the top level decrements it. The contention on `topLevel` becomes visible at scale.

**Before:**
```go
type SkipList struct {
    head     *node
    topLevel atomic.Int32
    maxLevel int
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := int(s.topLevel.Load()) - 1; i >= 0; i-- {
        // walk
    }
}
```

Every `Contains` reads `topLevel`, an atomic load. Every `Insert` may CAS `topLevel`. The field is a hot cache line, contended across goroutines.

**After (always start from `maxLevel - 1`):**
```go
type SkipList struct {
    head     *node
    maxLevel int // constant, set at construction
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil { // empty level, short-circuit
                break
            }
            if nxt.key >= key {
                break
            }
            curr = nxt
        }
    }
    nxt := curr.next[0].Load()
    return nxt != nil && nxt.key == key
}
```

Empty upper levels short-circuit instantly because `head.next[i].Load() == nil`. The cost of "always start from `maxLevel - 1`" is a handful of nil-pointer loads, each ~1ns.

**Gain.** 5–15% faster `Contains` under contended workloads. Eliminates one race-detector flag and one ABA opportunity (see `find-bug.md` Bug 5).

`maxLevel = 16` works well up to ~65 000 keys at `p = 0.5`; `maxLevel = 32` covers up to ~4 billion. Use 32 for safety; the overhead is negligible.

---

## Optimization 7 — Use `sync.Pool` for transient findPath buffers

**Problem.** If you keep `findPath` (because Insert needs the full predecessor/successor array), each call allocates a `[]preds` and `[]succs` of length `maxLevel`. At high QPS this is two allocations per Insert; GC pressure grows.

**Before:**
```go
func (s *SkipList) findPath(key int) (preds, succs []*node) {
    preds = make([]*node, s.maxLevel)
    succs = make([]*node, s.maxLevel)
    // ...
    return
}
```

At 1M inserts/sec, that's 2M allocations/sec, each ~256 bytes. GC overhead becomes a real cost.

**After (pooled buffers):**
```go
type pathBuf struct {
    preds [32]*node // pre-sized to maxLevel
    succs [32]*node
}

var pathPool = sync.Pool{
    New: func() any { return new(pathBuf) },
}

func (s *SkipList) findPath(key int, buf *pathBuf) {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil || nxt.key >= key {
                break
            }
            curr = nxt
        }
        buf.preds[i] = curr
        buf.succs[i] = curr.next[i].Load()
    }
}

func (s *SkipList) Insert(key int) bool {
    buf := pathPool.Get().(*pathBuf)
    defer pathPool.Put(buf)
    for {
        s.findPath(key, buf)
        // ... rest of Insert using buf.preds[] and buf.succs[] ...
    }
}
```

Fixed-size arrays in the pooled struct eliminate slice header overhead. The pool amortizes allocation across calls.

**Gain.** Allocation rate drops ~95%. GC pause frequency drops by ~5×. Throughput improves 10–25% on insert-heavy workloads where allocation was the bottleneck.

Caveat: `sync.Pool` is not a guarantee — the pool may discard items at any GC cycle. The cost is "occasional `New` call," which is fine because that path is also fast. Pool only for objects whose construction is the bottleneck.

---

## Optimization 8 — Switch to `github.com/zhangyunhao116/skipset`

**Problem.** Your educational implementation works, but it tops out at ~5M `Contains`/sec/core on x86. The production library `skipset` achieves ~25M `Contains`/sec/core through specialized integer-key code, cache-aware layout, and three years of micro-optimization.

**Before:**
```go
type SkipList struct {
    head     *node
    maxLevel int
}

list := New()
list.Insert(42)
ok := list.Contains(42)
list.Range(0, 100, func(k int) bool { fmt.Println(k); return true })
```

**After:**
```go
import "github.com/zhangyunhao116/skipset"

list := skipset.NewInt()
list.Add(42)
ok := list.Contains(42)
list.Range(func(k int) bool {
    if k < 0 { return true }
    if k > 100 { return false }
    fmt.Println(k)
    return true
})
```

The API is nearly identical. The internals are dramatically more refined:

- Specialized monomorphizations for `int`, `int32`, `string` — no generic-dispatch overhead.
- Cache-aware node layout with tagged pointers.
- Hazard-pointer-style reclamation (actually a custom epoch scheme) for high-throughput delete patterns.
- Per-level CAS with self-healing missed links.
- Range iteration that avoids allocating any intermediate state.

**Gain.** 3–5× throughput on both reads and writes. Lower memory because the nodes are smaller. Lower latency variance because reclamation does not stall under load.

When should you *not* use `skipset`?

- You need a value (not just a set) and `skipmap` is not flexible enough for your value type. Sometimes you must roll your own.
- You need a specific concurrency or snapshot semantic the library does not offer (point-in-time MVCC, repeatable-read iteration).
- You are writing teaching material or want to understand the internals.

For 95% of production use cases, `skipset` / `skipmap` is the right answer. Adopt it; spend your time on application logic.

---

## Optimization 9 — Avoid `Range` materialization

**Problem.** A common shape of `Range` collects keys into a slice before processing:

```go
keys := []int{}
list.Range(0, 1_000_000, func(k int) bool {
    keys = append(keys, k)
    return true
})
for _, k := range keys {
    process(k)
}
```

The intermediate slice is a costly allocation, especially for wide ranges over large lists. Worse, it freezes the iteration mid-scan: while you copy keys, the list keeps changing, and the copied keys may no longer reflect the current state by the time `process` runs.

**Before:** Materialize-then-process.

**After:** Process in the visit callback.

```go
list.Range(0, 1_000_000, func(k int) bool {
    process(k)
    return true
})
```

No intermediate slice. Each key is processed as it is visited. The callback is the boundary between iteration semantics and application logic.

If `process` is slow and blocks the iterator (which holds an implicit position pointer in the list), spawn a goroutine per item or buffer through a channel:

```go
ch := make(chan int, 1024)
go func() {
    defer close(ch)
    list.Range(0, 1_000_000, func(k int) bool {
        select {
        case ch <- k:
        case <-ctx.Done():
            return false
        }
        return true
    })
}()
for k := range ch {
    process(k)
}
```

The channel decouples iteration speed from processing speed, with bounded memory (the buffer size).

**Gain.** Eliminates a large allocation on the hot path. Improves p99 latency by orders of magnitude on huge ranges. Allows the iteration to bail out early when `process` decides it has enough data.

---

## Optimization 10 — Bound the height with `maxLevel`

**Problem.** If `randomLevel` can return any height up to `maxLevel`, an unlucky sequence of inserts may create a tall, narrow tower with `maxLevel = 32` and an array of 32 atomic pointers per node — 256 bytes of pointers, even for a 16-byte key.

The expected height grows logarithmically: for `n = 2^k` keys, `maxLevel = k+1` is plenty. Higher levels add memory with no real benefit.

**Before:**
```go
const maxLevel = 32 // covers 4 billion keys at p=0.5
```

Every node carries up to 32 pointers, 256 bytes of cold memory.

**After (size-adaptive):**
```go
func New(expectedSize int) *SkipList {
    lvl := int(math.Ceil(math.Log2(float64(expectedSize)))) + 1
    if lvl < 8 {
        lvl = 8
    }
    return &SkipList{maxLevel: lvl}
}
```

For an expected 1M keys, `maxLevel = 21`. Pointer overhead drops by ~35%.

**Gain.** Memory: 25–35% reduction in node footprint. `Contains` slightly faster because each empty-level short-circuit on the descending search is a cache hit less.

Caveat: if the list grows past `expectedSize`, the height becomes inadequate and searches slow down. Cap with a generous safety factor (e.g., `expectedSize * 4`).

---

## Optimization 11 — NUMA-aware sharded skip list

**Problem.** On NUMA hardware (typical 2+ socket servers), a single skip list whose nodes are scattered across memory pages may suffer from cross-socket memory accesses. Each access costs ~3× a local access.

**Before:** One global skip list, accessed from all sockets.

**After:** Shard the keyspace across N skip lists, each pinned to a NUMA node:

```go
type ShardedSkipList struct {
    shards [numNUMA]*SkipList
}

func (s *ShardedSkipList) Insert(key int) bool {
    return s.shards[key&(numNUMA-1)].Insert(key)
}

func (s *ShardedSkipList) Range(lo, hi int, visit func(int) bool) {
    // Range crosses shards — must walk all of them in sorted order.
    iters := make([]*Iterator, numNUMA)
    for i, shard := range s.shards {
        iters[i] = shard.NewIterator(lo, hi)
    }
    h := newMinHeap(iters)
    for h.Len() > 0 {
        k, it := h.Pop()
        if !visit(k) {
            return
        }
        if it.Next() {
            h.Push(it)
        }
    }
}
```

Pinning is done with `runtime.LockOSThread()` + `syscall.SchedSetaffinity` (Linux-only), or by routing requests to goroutines whose `GOMAXPROCS` slot is mapped to the right NUMA node.

**Gain.** Memory access latency drops by 2–3× on cross-socket hot paths. Insert/Contains throughput scales nearly linearly with the number of NUMA nodes. Range pays a cost — merging K sorted shards is O(N log K) — but rarely dominates.

This optimization rarely pays off on a single-socket machine. It is essential for in-memory databases running on dual-socket Xeons or EPYCs.

---

## Optimization 12 — Replace allocation-heavy `Range` with iterator

**Problem.** `Range(lo, hi, visit)` is convenient for one-shot scans but forces the entire iteration into a single callback. For streaming use cases (an SQL `SELECT ... ORDER BY key` that pages results), an external iterator is more natural and avoids the recursion-into-callback pattern.

**Before:**
```go
list.Range(lo, hi, func(k int) bool {
    if shouldStop(k) {
        return false
    }
    yield(k) // hopes that yield doesn't block too long
    return true
})
```

`yield` runs inside the iteration; if it blocks (e.g., writing to a network), the list cannot progress. With a long callback, holding the iterator state for seconds is fragile.

**After (external iterator):**
```go
type Iterator struct {
    list *SkipList
    curr *node
    hi   int
}

func (s *SkipList) NewIterator(lo, hi int) *Iterator {
    it := &Iterator{list: s, hi: hi}
    it.curr = s.findFirst(lo)
    return it
}

func (it *Iterator) Next() (key int, ok bool) {
    for it.curr != nil && it.curr.key <= it.hi {
        if !it.curr.mref.Load().deleted {
            k := it.curr.key
            it.curr = it.curr.mref.Load().next
            return k, true
        }
        it.curr = it.curr.mref.Load().next
    }
    return 0, false
}
```

The caller pulls keys with `Next()`. The iterator state lives in `Iterator`, allowing the caller to pause indefinitely between calls.

**Gain.** No callback inversion of control. Streaming semantics work naturally. The iterator's lifetime is explicit, so memory reclamation can pin only nodes the iterator references.

Caveat: stale iterators that linger for a long time prevent the deleted nodes they reference from being reclaimed. Document the lifecycle: callers must `Close()` the iterator when done. Or implement hazard pointers so the iterator's reference is observable to the reclamation pass.

---

## Final note

The optimizations stack. Starting from a textbook concurrent skip list, expect:

| Stage                                       | Throughput (ops/s/core) | Memory per node |
| ------------------------------------------- | ------------------------ | ---------------- |
| Textbook (per-node mutex, atomic next)      | ~2M                      | ~80 B            |
| + descending search, no `topLevel`          | ~3M                      | ~80 B            |
| + per-level CAS, marker-tagged pointer      | ~6M                      | ~48 B            |
| + cache-aware layout                        | ~9M                      | ~48 B            |
| + `p = 0.25` tuning                         | ~10M                     | ~32 B            |
| Switching to `github.com/.../skipset`       | ~25M                     | ~24 B            |

The last row is the production target. Build the first five for understanding; ship the sixth. Your reader is grateful, your tail latency is happier, and your time goes back to application logic where it belongs.

Profile before, profile after. Many of these changes can hurt as easily as they help on the wrong workload — `sync.Pool` for buffers, NUMA sharding, and the tagged-pointer trick are the three that most commonly produce no win on a workload that does not actually need them. Measure, do not guess.
