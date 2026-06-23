---
layout: default
title: Tasks
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/tasks/
---

# Concurrent Skip List — Hands-on Tasks

> Practical exercises arranged from easy to hard. Each task names what to build, what success looks like, and a hint or expected outcome. Solution sketches live at the end of the file. The full point is to internalize how a skip list looks under load, where the contention hides, and which optimizations actually pay back.

---

## Easy

### Task 1 — Single-threaded skip list

Implement a baseline skip list that supports `Insert(key int) bool`, `Contains(key int) bool`, and `Delete(key int) bool`. Use a maximum height of 16 and a probability of 0.5 for each next level (geometric distribution). No concurrency yet.

- Each node holds its key and a `[]*node` slice of forward pointers.
- A dedicated header node lives at `maxLevel`; its forward pointers seed all searches.
- `randomLevel()` returns `1` plus the number of coin-flip heads, capped at `maxLevel`.
- A `Len() int` accessor returns the total element count.

Verify by inserting 1000 random keys, asserting `Contains` returns `true` for every inserted key, then deleting half of them and asserting the other half still hits.

**Goal.** Build the data structure once, without locks, so the next tasks can layer concurrency on top.

```go
type node struct {
    key  int
    next []*node // length == level
}

type SkipList struct {
    head     *node
    level    int
    maxLevel int
    n        int
    rng      *rand.Rand
}
```

---

### Task 2 — Print the structure

Add a `Dump(w io.Writer)` method that prints each level top-down, with keys aligned by column. Example output for keys `1, 3, 7, 9, 12`:

```
L3: HEAD -------- 7 -----------
L2: HEAD -- 3 --- 7 ----------
L1: HEAD 1 3 --- 7 -- 9 -----
L0: HEAD 1 3 --- 7 -- 9 12
```

- Walk level 0 to collect every key in order.
- For levels above 0, fill in dashes for missing keys.

Use this to debug your randomization. A healthy skip list looks like a pyramid: roughly `n/2` keys at level 1, `n/4` at level 2, and so on.

**Goal.** Visualize the structure. A broken level distribution will be obvious.

---

### Task 3 — Range scan

Add a method `Range(lo, hi int, visit func(key int) bool)`. It iterates keys in the closed interval `[lo, hi]` in ascending order, calling `visit` for each one. If `visit` returns `false`, the iteration stops.

- Find the first node at level 0 with `key >= lo` using the standard "drop down from header" walk.
- Walk forward through level 0 until `key > hi`.

Verify against a sorted `[]int`. The skip list `Range(5, 15, ...)` must produce the same keys, in the same order, as `sort.SearchInts` plus a slice walk.

**Goal.** Internalize that level 0 is a sorted linked list. Range scans never touch upper levels after locating the lower bound.

---

### Task 4 — Probabilistic level audit

Insert 1 000 000 random keys. Then count, for each level `L`, how many nodes have at least `L` forward pointers. Assert the count at level `L` is approximately `n / 2^L`, with 5% tolerance.

- This is a sanity check on `randomLevel()`.
- A common bug is using `rand.Float64() < 0.5` once and counting that as "level 2 or higher" — that gives the wrong distribution.

**Goal.** Confirm randomization is correct before adding concurrency. A wrong distribution silently degrades search performance from O(log n) to O(n).

---

### Task 5 — Benchmark single-threaded

Write a `Benchmark` (under `testing`) that measures:

- `BenchmarkInsert` — 1 000 000 random inserts.
- `BenchmarkContains` — 1 000 000 lookups against a pre-warmed list of 1M keys.
- `BenchmarkRange` — 1000 scans of width 100 each, against a pre-warmed list.

Note ns/op for each. Use these numbers as the "no contention" baseline. Later tasks will compare concurrent variants against this.

**Goal.** Establish a baseline. Most "optimizations" in real code only pay back relative to a baseline you measured.

---

## Medium

### Task 6 — Coarse-grained locked skip list

Wrap the structure from Task 1 with a single `sync.RWMutex`. `Insert` and `Delete` take the write lock, `Contains` and `Range` take the read lock.

Run a benchmark with N goroutines each performing a mix of 80% reads and 20% writes. Sweep N from 1 to 32. Plot ops/sec vs N.

- You should see throughput plateau or even drop past ~4 goroutines because the writer lock serializes every update.
- This is the baseline against which fine-grained locking will be measured.

**Goal.** Prove the obvious: a single RWMutex around a hot structure does not scale.

---

### Task 7 — Per-node locks

Replace the single mutex with one `sync.Mutex` per node. `Insert` and `Delete` lock only the nodes they touch (predecessors at each level, plus the new or removed node itself).

Implement Herlihy's classic "lock the predecessors bottom-up, validate, then splice in" algorithm:

1. `findPath(key)` returns the predecessor and successor at each level (no locks held).
2. `Insert(key)`:
   - Call `findPath`.
   - Lock each predecessor `preds[i]` for `i` in `[0, level)`.
   - Validate: for each `i`, check `preds[i].next[i] == succs[i]`. If any validation fails, unlock all and retry.
   - Insert the new node by setting `new.next[i] = succs[i]` for each level, then `preds[i].next[i] = new`.
   - Unlock all.

Run the same 80/20 benchmark. Compare against Task 6. Expect 2–4× higher throughput at 8 goroutines on a typical laptop.

**Goal.** Reduce critical sections from "the whole list" to "the few nodes around the affected key."

---

### Task 8 — Optimistic search

In a fine-grained locked skip list, the `Contains` path should be lock-free. Implement it:

- Walk from header down levels and forward at each level, comparing keys.
- Return `true` if level 0 yields an exact match.
- Read forward pointers without locking. This is safe **only if** the writer publishes pointers using `atomic.StorePointer` (or `atomic.Pointer[T]`).

Convert each `node.next[i]` from `*node` to `atomic.Pointer[node]`. Update `Insert` and `Delete` accordingly: stores must be atomic, even though they happen under a mutex.

Re-run the benchmark. `Contains`-heavy workloads should be 5–10× faster than Task 7 because readers never block.

**Goal.** Understand why "lock for writers, atomic for readers" is the canonical concurrent-skip-list shape.

---

### Task 9 — Concurrent insert with CAS (lock-free, level 0 only)

Implement `Insert` at level 0 using CAS, with no mutex.

```go
func (s *SkipList) insertLevel0(n *node) bool {
    for {
        pred, curr := s.findLevel0(n.key)
        if curr != nil && curr.key == n.key {
            return false // duplicate
        }
        n.next[0].Store(curr)
        if pred.next[0].CompareAndSwap(curr, n) {
            return true
        }
        // retry: another writer raced ahead
    }
}
```

For now, set `n.next[i]` to `nil` for `i > 0`; you are only building level 0. Run with the race detector. Verify that 8 goroutines inserting 100 000 keys each end with a sorted level-0 list containing every key.

**Goal.** Internalize the CAS-retry loop. This is the building block of every lock-free structure.

---

### Task 10 — Concurrent insert with CAS (multi-level)

Extend Task 9 to all levels. Two strategies:

1. **Bottom-up:** insert at level 0 with CAS first, then climb up. If a higher-level CAS fails, retry from `findPath`. The node is "fully inserted" once it reaches its declared level.
2. **Top-down (Fraser-style):** insert at all levels conceptually, but level-0 insertion is the linearization point. Upper levels self-heal if missing.

Pick one and implement it. Document the linearization point. Test with 8 goroutines × 100 000 random inserts, all keys unique. Assert: every key is reachable through `Contains`, and the level distribution matches the geometric expectation within 5%.

**Goal.** Move beyond level 0. Real skip lists have heights; concurrent insertion has to maintain the invariant at every level.

---

### Task 11 — Logical deletion with marker nodes

Lock-free skip list deletion uses a two-phase approach:

1. **Logical delete:** atomically mark the node's level-0 next pointer with a sentinel "deleted" bit (or a dedicated marker node).
2. **Physical unlink:** any traversal that encounters a marked node is responsible for CAS-ing the predecessor's `next` past it. The node disappears from the structure when the last reader has dropped its reference.

Implement this. Use `atomic.Pointer[node]` with a tagged-pointer trick (or a `markedNext` sentinel struct):

```go
type markedNext struct {
    next    *node
    deleted bool
}
```

Verify under heavy concurrent insert/delete: no key is ever lost mid-delete, no key is duplicated, no marker is leaked.

**Goal.** Learn the marker-node pattern. It is the backbone of lock-free Harris-Michael linked lists, of which skip lists are a logarithmic generalization.

---

### Task 12 — Range scan that observes concurrent writes

Add a `Range(lo, hi int, visit func(key int) bool)` that walks level 0. Document its semantics: which writes does it see, which does it miss?

- Keys inserted **before** the scan starts must be visited.
- Keys inserted **after** the scan passes their position must not be visited.
- Keys logically deleted **before** the scan starts must not be visited.
- Logically deleted nodes encountered mid-scan must be skipped.

Test concurrency: spawn one scanner and 4 inserters. The scanner records what it saw; the inserters record what they wrote. After both finish, verify the scanner's output is a subset of the union of "keys present at scan start" and "keys inserted before the scan's pointer reached them."

This is a weaker guarantee than "snapshot consistency" — Task 14 strengthens it.

**Goal.** Be honest about what an unsynchronized range scan does. Most "concurrent map" range methods give exactly this guarantee.

---

### Task 13 — Snapshot iterator (copy-on-write)

Add `Snapshot() *Snapshot` that returns a frozen view of the skip list at the moment of the call. `Snapshot.Range(lo, hi, visit)` then iterates the snapshot deterministically, regardless of concurrent writes.

Two approaches:

1. **Copy:** lock the writer for one operation, walk level 0, copy keys into a slice. Iterator scans the slice. Cost: O(n) memory per snapshot. Use this for moderate-size lists or rare snapshots.
2. **Versioned nodes:** each node carries a version stamp. The snapshot remembers the global version at creation time. Iteration filters out nodes inserted after that version. Deletes use the marker pattern with a "deleted-at-version" stamp.

Implement option 1 first. Verify by spawning a snapshot, then 1000 concurrent inserts, and confirming the snapshot's `Range` results are exactly the keys present at snapshot creation.

**Goal.** Understand the cost-quality trade-off between copy snapshots and MVCC snapshots.

---

### Task 14 — Snapshot iterator (MVCC)

Implement option 2 from Task 13. Each node has a `version int64` written atomically at insertion. The skip list has a global `currentVersion atomic.Int64`. `Snapshot.version` captures the value at snapshot time. Iteration skips nodes with `version > snapshot.version`.

Deletes: instead of physical removal, mark the node with `deletedAt = currentVersion`. The snapshot considers a node visible if `node.version <= snapshot.version` AND (`node.deletedAt == 0` OR `node.deletedAt > snapshot.version`).

Garbage-collect old marked nodes when no live snapshot references them (use a reference counter or a watermark of "oldest live snapshot version").

This is essentially how RocksDB's memtable handles snapshots. The cost is constant-overhead per node, no per-snapshot copy.

**Goal.** Build a real production-shape concurrent skip list iterator. This is the largest task; expect ~300 lines.

---

### Task 15 — Benchmark vs `sync.Map`

Write three benchmarks comparing your skip list against `sync.Map`:

1. `BenchmarkReadHeavy` — 90% reads, 10% inserts, 1M-key working set, 8 goroutines.
2. `BenchmarkWriteHeavy` — 50% reads, 50% inserts, 1M-key working set, 8 goroutines.
3. `BenchmarkRange` — 100 scans/sec, 1M-key working set, no writes.

Compare ops/sec. Expected outcomes:

- `sync.Map` wins read-heavy by 2–5× because it has a cached read-only layer for stable keys.
- The skip list wins write-heavy because `sync.Map` upgrades to its mutex-backed dirty layer.
- The skip list wins `Range` decisively because `sync.Map.Range` walks an unsorted snapshot of both layers.

**Goal.** Build empirical intuition for "which structure suits which workload." Trust the numbers more than the lore.

---

## Hard

### Task 16 — Cache-aware node layout

Profile the lock-free skip list with `perf c2c` (Linux) or `go test -bench -benchmem -cpuprofile`. Identify which fields of `node` produce the most cache-line misses.

Typical findings:

- `node.next[0]` is read by every search; co-locate with `node.key` for a single cache-line read.
- `node.next[1..maxLevel-1]` is read only when the search descends; place these in a separately allocated tail so the hot path touches one cache line.
- `node.deleted` flag should share the cache line with `node.next[0]` to coalesce reads.

Restructure the node:

```go
type node struct {
    key   int
    next0 atomic.Pointer[node] // hot
    _     [40]byte             // pad to one cache line
    upper []atomic.Pointer[node] // cold, separately allocated
}
```

Re-benchmark. Expected gain: 20–40% on read-heavy workloads on modern x86. Verify with `perf stat -e cache-misses`.

**Goal.** Move beyond "lock-free is fast" to "lock-free + cache-aware is faster." Skip lists especially benefit because level 0 is read on every search.

---

### Task 17 — Tune the level distribution

The classic skip list uses `p = 0.5` (each node has a 50% chance of climbing one level). For read-heavy workloads, `p = 0.25` is often faster: nodes are shorter on average, level-0 walks are slightly longer, but expected total comparisons drop because upper levels are denser.

Run the benchmark suite with `p = 0.5`, `p = 0.25`, and `p = 0.125`. Plot ns/op for `Contains` against `p`. Pick the optimum for your machine.

Then ask: is the optimum stable across cache sizes? Run the same experiment on a small VM (1 vCPU, 2 GB RAM) and a beefy VM (16 vCPU, 64 GB RAM). Often the optimum shifts because small caches favor shorter nodes.

**Goal.** Realize that "constants" in algorithms textbooks are tuning knobs in production code. Always re-tune for your hardware.

---

### Task 18 — Memory reclamation with hazard pointers

In the lock-free variant, deleted nodes cannot be freed immediately — concurrent readers may still hold references. Garbage collection works in Go, but a long-tail reader can pin a node indefinitely.

Implement hazard pointers (Michael, 2004):

1. Each goroutine registers a per-thread hazard pointer slot.
2. Before dereferencing a `*node` from an atomic pointer, store it into the slot.
3. On `Delete`, push the unlinked node onto a per-goroutine retire list.
4. Periodically, scan all hazard pointer slots; nodes not appearing in any slot may be freed (in Go: dropped from the retire list, allowing GC).

This is the same algorithm used by `crossbeam-epoch` in Rust and by `folly::ConcurrentHashMap` in C++.

Test: spawn one slow reader pinned to an old version while 10 writers churn 1M deletes/sec. Confirm memory does not blow up and that the slow reader does not crash.

**Goal.** Build a production-grade memory reclamation scheme. Go's GC saves you from most of this, but understanding hazard pointers is essential for senior-level systems work.

---

### Task 19 — Switch to `github.com/zhangyunhao116/skipset`

For real production use, the consensus library is `github.com/zhangyunhao116/skipset` (and its map variant, `skipmap`). It is a battle-tested lock-free skip list with ordered iteration.

Replace your implementation in a microbenchmark with `skipset.NewInt()`. Run the same benchmarks as Task 15. Compare:

- `Insert` ops/sec.
- `Contains` ops/sec.
- `Range` ops/sec (use `Range(func(value int) bool { ... })`).

Expected: `skipset` is 1.5–3× faster on most workloads because it has years of micro-optimization. Make a note of the gap; your educational implementation is the floor.

Read the source — it is small (~600 lines for `skipset_int.go`). Identify the optimizations you missed (cache-aware layout, custom hazard-pointer-like reclamation, specialized integer-only generic monomorphizations).

**Goal.** Calibrate your work against production code. Most real systems should reach for `skipset`, not roll their own.

---

### Task 20 — Build an ordered concurrent map on top

Wrap the skip list to give it `Get(key) (value, ok)` and `Put(key, value)` semantics. Use `unsafe.Pointer` or `atomic.Pointer[V]` so values can be updated atomically alongside membership.

API:

```go
type Map[K constraints.Ordered, V any] struct { ... }

func New[K constraints.Ordered, V any]() *Map[K, V]
func (m *Map[K, V]) Get(k K) (V, bool)
func (m *Map[K, V]) Put(k K, v V) (prev V, replaced bool)
func (m *Map[K, V]) Delete(k K) bool
func (m *Map[K, V]) Range(visit func(K, V) bool)
func (m *Map[K, V]) Snapshot() *Snapshot[K, V]
```

Add a benchmark identical to `sync.Map`'s upstream benchmarks. Submit a PR-quality README listing where your map is faster than `sync.Map` and where it loses.

**Goal.** Realize the goal: a concurrent ordered map suitable for memtable, in-memory index, or sorted cache use cases.

---

## Solution Sketches

### Task 1

```go
type node struct {
    key  int
    next []*node // length == level
}

type SkipList struct {
    head     *node
    level    int
    maxLevel int
    n        int
    rng      *rand.Rand
}

func New() *SkipList {
    const maxLevel = 16
    return &SkipList{
        head:     &node{next: make([]*node, maxLevel)},
        level:    1,
        maxLevel: maxLevel,
        rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
    }
}

func (s *SkipList) randomLevel() int {
    lvl := 1
    for lvl < s.maxLevel && s.rng.Intn(2) == 0 {
        lvl++
    }
    return lvl
}

func (s *SkipList) Insert(key int) bool {
    update := make([]*node, s.maxLevel)
    curr := s.head
    for i := s.level - 1; i >= 0; i-- {
        for curr.next[i] != nil && curr.next[i].key < key {
            curr = curr.next[i]
        }
        update[i] = curr
    }
    if curr.next[0] != nil && curr.next[0].key == key {
        return false
    }
    lvl := s.randomLevel()
    if lvl > s.level {
        for i := s.level; i < lvl; i++ {
            update[i] = s.head
        }
        s.level = lvl
    }
    n := &node{key: key, next: make([]*node, lvl)}
    for i := 0; i < lvl; i++ {
        n.next[i] = update[i].next[i]
        update[i].next[i] = n
    }
    s.n++
    return true
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.level - 1; i >= 0; i-- {
        for curr.next[i] != nil && curr.next[i].key < key {
            curr = curr.next[i]
        }
    }
    return curr.next[0] != nil && curr.next[0].key == key
}

func (s *SkipList) Delete(key int) bool {
    update := make([]*node, s.maxLevel)
    curr := s.head
    for i := s.level - 1; i >= 0; i-- {
        for curr.next[i] != nil && curr.next[i].key < key {
            curr = curr.next[i]
        }
        update[i] = curr
    }
    target := curr.next[0]
    if target == nil || target.key != key {
        return false
    }
    for i := 0; i < s.level; i++ {
        if update[i].next[i] != target {
            break
        }
        update[i].next[i] = target.next[i]
    }
    for s.level > 1 && s.head.next[s.level-1] == nil {
        s.level--
    }
    s.n--
    return true
}

func (s *SkipList) Len() int { return s.n }
```

---

### Task 3

```go
func (s *SkipList) Range(lo, hi int, visit func(key int) bool) {
    curr := s.head
    for i := s.level - 1; i >= 0; i-- {
        for curr.next[i] != nil && curr.next[i].key < lo {
            curr = curr.next[i]
        }
    }
    for n := curr.next[0]; n != nil && n.key <= hi; n = n.next[0] {
        if !visit(n.key) {
            return
        }
    }
}
```

---

### Task 7 (predecessor-locking insert)

```go
type node struct {
    key   int
    next  []atomic.Pointer[node]
    mu    sync.Mutex
    fully bool // true after all next pointers are wired
}

func (s *SkipList) Insert(key int) bool {
    for {
        preds, succs := s.findPath(key)
        if succs[0] != nil && succs[0].key == key {
            return false
        }
        lvl := s.randomLevel()
        // Lock predecessors in ascending order to avoid deadlock.
        locked := preds[:lvl]
        for _, p := range locked {
            p.mu.Lock()
        }
        // Validate: predecessor still points at the expected successor.
        ok := true
        for i := 0; i < lvl; i++ {
            if preds[i].next[i].Load() != succs[i] {
                ok = false
                break
            }
        }
        if !ok {
            for _, p := range locked {
                p.mu.Unlock()
            }
            continue
        }
        n := &node{key: key, next: make([]atomic.Pointer[node], lvl)}
        for i := 0; i < lvl; i++ {
            n.next[i].Store(succs[i])
        }
        for i := 0; i < lvl; i++ {
            preds[i].next[i].Store(n)
        }
        n.fully = true
        for _, p := range locked {
            p.mu.Unlock()
        }
        return true
    }
}
```

---

### Task 9 (lock-free level 0)

```go
func (s *SkipList) insertLevel0(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr != nil && curr.key == key {
            return false
        }
        n := &node{key: key}
        n.next0.Store(curr)
        if pred.next0.CompareAndSwap(curr, n) {
            return true
        }
    }
}

func (s *SkipList) findLevel0(key int) (*node, *node) {
    for {
        pred := s.head
        curr := pred.next0.Load()
        for curr != nil && curr.key < key {
            pred = curr
            curr = curr.next0.Load()
        }
        return pred, curr
    }
}
```

---

### Task 11 (marker-node delete)

```go
type markedRef struct {
    next    *node
    deleted bool
}

type node struct {
    key  int
    mref atomic.Pointer[markedRef]
}

func (s *SkipList) Delete(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr == nil || curr.key != key {
            return false
        }
        old := curr.mref.Load()
        if old.deleted {
            return false // someone beat us
        }
        marked := &markedRef{next: old.next, deleted: true}
        if !curr.mref.CompareAndSwap(old, marked) {
            continue
        }
        // Physical unlink: best-effort, retries will finish it.
        predMref := pred.mref.Load()
        if predMref != nil && predMref.next == curr {
            newPred := &markedRef{next: marked.next, deleted: predMref.deleted}
            pred.mref.CompareAndSwap(predMref, newPred)
        }
        return true
    }
}
```

---

### Task 13 (snapshot copy)

```go
type Snapshot struct {
    keys []int
}

func (s *SkipList) Snapshot() *Snapshot {
    s.mu.Lock()
    defer s.mu.Unlock()
    out := make([]int, 0, s.n)
    for n := s.head.next[0]; n != nil; n = n.next[0] {
        out = append(out, n.key)
    }
    return &Snapshot{keys: out}
}

func (snap *Snapshot) Range(lo, hi int, visit func(int) bool) {
    i := sort.SearchInts(snap.keys, lo)
    for ; i < len(snap.keys) && snap.keys[i] <= hi; i++ {
        if !visit(snap.keys[i]) {
            return
        }
    }
}
```

---

### Task 14 (MVCC snapshot)

```go
type node struct {
    key       int
    version   int64
    deletedAt atomic.Int64
    next      []atomic.Pointer[node]
}

type SkipList struct {
    head           *node
    currentVersion atomic.Int64
    // ...
}

type Snapshot struct {
    version int64
    list    *SkipList
}

func (s *SkipList) Snapshot() *Snapshot {
    return &Snapshot{
        version: s.currentVersion.Load(),
        list:    s,
    }
}

func (snap *Snapshot) visible(n *node) bool {
    if n.version > snap.version {
        return false
    }
    d := n.deletedAt.Load()
    if d == 0 {
        return true
    }
    return d > snap.version
}

func (snap *Snapshot) Range(lo, hi int, visit func(int) bool) {
    curr := snap.list.head
    for i := snap.list.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil || nxt.key >= lo {
                break
            }
            curr = nxt
        }
    }
    for n := curr.next[0].Load(); n != nil && n.key <= hi; n = n.next[0].Load() {
        if snap.visible(n) {
            if !visit(n.key) {
                return
            }
        }
    }
}
```

---

### Task 16 (cache-aware layout)

```go
type node struct {
    key   int
    next0 atomic.Pointer[node]
    flags atomic.Uint32
    _     [32]byte // pad rest of cache line
    upper []atomic.Pointer[node]
}
```

The hot path — `Contains` walking level 0 — touches one cache line per node. Higher-level walks pay a second cache miss, but they happen log(n) times per search, while level-0 reads happen ~log(n) times too, so doubling the cost on the cold path is acceptable.

---

### Task 19 (skipset call site)

```go
import "github.com/zhangyunhao116/skipset"

func benchSkipsetInsert(b *testing.B) {
    s := skipset.NewInt()
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        rng := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            s.Add(rng.Intn(1_000_000))
        }
    })
}
```

Read the upstream README for `skipset` and `skipmap`. The API mirrors `sync.Map` closely, so swapping is usually a 10-minute migration.

---

### Task 20 (ordered map)

```go
type Map[K constraints.Ordered, V any] struct {
    list *skipList[K, V] // your concurrent skip list, key type K, payload V
}

type entry[V any] struct {
    val atomic.Pointer[V]
}

func (m *Map[K, V]) Put(k K, v V) (prev V, replaced bool) {
    n, existed := m.list.upsert(k, &v)
    if existed {
        old := n.entry.val.Swap(&v)
        if old != nil {
            return *old, true
        }
    }
    return prev, false
}
```

The skip list owns membership; the per-node `entry` owns the value pointer. Updates to existing keys do not touch the skip list at all — they swap the value atomically. This is exactly the layered approach `skipmap` uses.

---

## Final note

By Task 20 you will have built — and benchmarked — every concurrent variant of a skip list that appears in production codebases: locked, fine-grained-locked, lock-free, MVCC-snapshotted, cache-aware. You will know which variant is right for which workload, and you will know when to reach for `skipset` instead of writing your own.

Keep the benchmark numbers. They are evidence for the next time someone says "skip lists are slow" or "sync.Map is fastest." The answer is always: measure your workload.
