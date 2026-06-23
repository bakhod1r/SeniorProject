---
layout: default
title: Optimize
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/optimize/
---

# Concurrent Trees — Optimization

> A balanced search tree under concurrent load is one of the hardest data structures to optimize in any language, and Go is no exception. The naive correct implementation — one big `sync.RWMutex` around the whole tree — works, scales to a few cores, and then collapses. Real concurrent trees gain throughput by *shrinking the critical section* (per-node latching, hand-over-hand, optimistic reads), *eliminating mutation* (copy-on-write, persistent trees), *swapping atomics for locks on read paths* (RCU, `atomic.Pointer`), and *changing the physical layout* (cache-line packing, fanout tuning, prefix compression).
>
> Each entry below states a real bottleneck, shows a "before" snippet and an "after" snippet using realistic Go (`google/btree`, `tidwall/btree`, `sync/atomic`, `sync.RWMutex`), and quantifies the expected gain. Numbers are illustrative — always confirm with `go test -bench`, `pprof`, and `runtime/trace` on your own workload.

---

## Optimization 1 — Replace a global tree mutex with hand-over-hand latching

**Problem.** Wrapping every operation in a single `sync.RWMutex` works until QPS rises. Writers serialise even if their paths through the tree do not overlap; readers serialise behind any active writer. On 32 cores, a single mutex collapses throughput to roughly one core's worth.

**Before:**
```go
import "github.com/google/btree"

type Tree struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Item]
}

func (t *Tree) Get(k Item) (Item, bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    return t.bt.Get(k)
}

func (t *Tree) Set(k Item) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(k)
}
```
Every reader and every writer fights for the same lock. At high QPS, the lock itself becomes the bottleneck; CPU is wasted in `runtime.semacquire`.

**After (hand-over-hand, conceptual).** Each internal node carries its own `sync.RWMutex`. A traversal acquires the parent latch, locates the child, acquires the child latch, then releases the parent. Writers hold the latch only along the path they actually touch.

```go
type Node struct {
    mu       sync.RWMutex
    keys     []Key
    children []*Node // nil for leaves
    values   []Value // populated only for leaves
}

func (t *Tree) Get(k Key) (Value, bool) {
    n := t.root
    n.mu.RLock()
    for !n.isLeaf() {
        i := n.findChild(k)
        c := n.children[i]
        c.mu.RLock()
        n.mu.RUnlock() // release parent as soon as child is latched
        n = c
    }
    defer n.mu.RUnlock()
    return n.lookupLeaf(k)
}
```

**Gain.** Throughput scales close to linearly with cores for read-mostly workloads that touch disjoint subtrees. Writers still serialise on the path they walk, but no longer on the whole tree. Typical measured gain: 5x–15x on 16 cores for uniformly distributed keys. The cost is implementation complexity — deadlock-free latch order, careful release on every error path.

---

## Optimization 2 — Replace hand-over-hand with optimistic version-counter reads

**Problem.** Even hand-over-hand pays for `RLock`/`RUnlock` on every node — typically 20–40 ns each. On a tree of height 6, that is 240+ ns of pure lock overhead per lookup, and atomic RMW operations on every node still cause cache-line ping-pong between readers across cores.

**Before:**
```go
func (t *Tree) Get(k Key) (Value, bool) {
    n := t.root
    n.mu.RLock()
    for !n.isLeaf() {
        c := n.children[n.findChild(k)]
        c.mu.RLock()
        n.mu.RUnlock()
        n = c
    }
    defer n.mu.RUnlock()
    return n.lookupLeaf(k)
}
```

**After (OPTIK / OLFIT-style optimistic read).** Every node carries a `uint64` version counter incremented on every mutation. Readers snapshot the version, traverse without locking, then re-check the version. If unchanged, the read is valid.

```go
type Node struct {
    version atomic.Uint64 // odd while a writer is mutating, even when stable
    keys    []Key
    children []*Node
    values  []Value
}

func (n *Node) readBegin() (uint64, bool) {
    for {
        v := n.version.Load()
        if v&1 == 0 {
            return v, true
        }
        runtime.Gosched() // a writer is in progress
    }
}

func (n *Node) readValidate(v uint64) bool {
    return n.version.Load() == v
}

func (t *Tree) Get(k Key) (val Value, ok bool) {
retry:
    n := t.root
    for {
        v, _ := n.readBegin()
        if n.isLeaf() {
            val, ok = n.lookupLeaf(k)
            if !n.readValidate(v) {
                goto retry
            }
            return
        }
        c := n.children[n.findChild(k)]
        if !n.readValidate(v) {
            goto retry
        }
        n = c
    }
}
```
Writers bracket their mutation with `version.Add(1)` before and after, so the counter is odd during the write and even outside.

**Gain.** Read path becomes lock-free in the common case (no contended atomic RMW). Measured 2x–4x speedup over hand-over-hand on read-heavy workloads. Writers still take per-node X-latches. Validation cost: one atomic load per node, ~2 ns each. This is the technique used by HyPer, Silo, ART, and many production indexes.

Caveat: the read path must never dereference a pointer that the writer may have freed. Pair this with epoch-based reclamation (see Optimization 7).

---

## Optimization 3 — Switch a coarse-grained lock to RCU on read-mostly trees

**Problem.** A read-mostly tree (configuration index, routing table, dictionary loaded at startup and rarely changed) wastes cycles on `RLock`/`RUnlock` for every lookup. RWMutex read-acquire is 10–30 ns and still touches a shared cache line, which is murder at 10 M lookups/s.

**Before:**
```go
type RouteTable struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Route]
}

func (t *RouteTable) Lookup(prefix Prefix) (Route, bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    return t.bt.Get(Route{Prefix: prefix})
}
```

**After (RCU via `atomic.Pointer`).** Readers atomically load a pointer to an immutable snapshot. Writers build a new tree (or a copy-on-write delta of the old one), then atomically publish the new pointer.

```go
type RouteTable struct {
    cur atomic.Pointer[btree.BTreeG[Route]]
    wmu sync.Mutex // serialises writers, not readers
}

func NewRouteTable() *RouteTable {
    t := &RouteTable{}
    t.cur.Store(btree.NewG[Route](32, func(a, b Route) bool { return a.Less(b) }))
    return t
}

func (t *RouteTable) Lookup(p Prefix) (Route, bool) {
    return t.cur.Load().Get(Route{Prefix: p})
}

func (t *RouteTable) Insert(r Route) {
    t.wmu.Lock()
    defer t.wmu.Unlock()
    next := t.cur.Load().Clone() // google/btree Clone is COW
    next.ReplaceOrInsert(r)
    t.cur.Store(next)
}
```

**Gain.** Reader path is a single atomic pointer load (~1 ns) plus the tree lookup. No reader–reader contention, no reader–writer contention. Measured 3x–10x throughput improvement on read-heavy workloads.

Caveat: writers pay for the copy. For `google/btree`, the COW clone is O(1) on the root and O(log n) on writes because only nodes on the modified path are duplicated; this is exactly the right cost model for read-mostly indexes. Old snapshots stay alive as long as readers hold their pointer — GC reclaims them automatically once nothing references them.

---

## Optimization 4 — Eliminate per-rebalance recopy with persistent (immutable) trees

**Problem.** A "rebuild on every write" RCU strategy is fine at low write rates but quadratic at high write rates: a tree of N nodes takes O(N) to clone and rebalance on every insert. At 10 k writes/s on a 1 M-key tree, you copy 10 billion nodes per second — a non-starter.

**Before (rebuild-the-world):**
```go
func (t *RouteTable) Insert(r Route) {
    t.wmu.Lock()
    defer t.wmu.Unlock()
    next := btree.NewG[Route](32, less)
    t.cur.Load().Ascend(func(x Route) bool {
        next.ReplaceOrInsert(x)
        return true
    })
    next.ReplaceOrInsert(r) // O(N) work per insert
    t.cur.Store(next)
}
```

**After (path-copy persistent tree).** Only nodes on the modified root-to-leaf path are duplicated. The rest of the tree is shared with the old snapshot. `google/btree.Clone` is exactly this, but you can also build it explicitly:

```go
type Node struct {
    keys     []Key
    children []*Node
    values   []Value
}

// withInsert returns a new tree root reflecting the insert. Nodes not on the
// modified path are reused (shared with the old root).
func (n *Node) withInsert(k Key, v Value) *Node {
    if n.isLeaf() {
        nl := *n // shallow copy: new keys/values slice header
        nl.keys = append(append([]Key{}, n.keys[:i]...), append([]Key{k}, n.keys[i:]...)...)
        nl.values = append(append([]Value{}, n.values[:i]...), append([]Value{v}, n.values[i:]...)...)
        return &nl
    }
    i := n.findChild(k)
    childNew := n.children[i].withInsert(k, v)
    nn := *n
    nn.children = append([]*Node{}, n.children...) // copy slice
    nn.children[i] = childNew
    return &nn
}

func (t *RouteTable) Insert(r Route) {
    t.wmu.Lock()
    defer t.wmu.Unlock()
    next := t.cur.Load().withInsert(r.Prefix, r.Value)
    t.cur.Store(next)
}
```

**Gain.** Write cost drops from O(N) to O(log N) — the height of the tree, typically 4–8 nodes for B-trees with fanout 32–128. Memory is also shared between snapshots, so multiple historical versions cost only the modified paths. Used by Clojure's persistent maps, Scala's immutable trees, and most "Git-like" data versioning.

Caveat: each write allocates O(log N) new nodes, so allocator pressure rises. Pair with `sync.Pool` for node allocation if writes are hot.

---

## Optimization 5 — Make leaf nodes cache-line aware

**Problem.** A "tidy" B-tree node mixes pointers, keys, and metadata in a struct that crosses several cache lines. Every key comparison may pull a fresh 64-byte line from memory; on a tree of depth 6, that is 6+ cache-line fetches per lookup, dominating latency.

**Before:**
```go
type Node struct {
    mu       sync.RWMutex // 24 bytes
    parent   *Node        // 8 bytes
    keys     []int64      // 24 bytes (header)
    children []*Node      // 24 bytes
    isLeaf   bool         // 1 byte (+7 padding)
}
// Keys and children are heap-allocated slices, each on its own line — every
// comparison may miss in L1 because the keys live far from the node header.
```

**After (cache-line-aware layout).** Inline a fixed-size key array directly in the node and pad the struct to a multiple of the cache line. Keep the keys densely packed and at the start of the struct so they share lines with the version counter.

```go
const (
    cacheLine = 64
    fanout    = 16 // tune so keys array fits ~1 cache line for int64 keys
)

type Node struct {
    version  atomic.Uint64 // 8 bytes
    nKeys    uint16        // 2 bytes
    isLeaf   uint8         // 1 byte
    _        [5]byte       // pad
    keys     [fanout]int64 // 128 bytes for int64 — 2 cache lines, prefetched together
    children [fanout + 1]*Node
    // values  [fanout]Value // for leaves only; could be a separate union
}
```

With careful sizing, `keys[0..fanout-1]` lands in two contiguous cache lines, the comparison routine prefetches both, and the binary search is L1-resident.

**Gain.** Lookup latency commonly drops 2x–3x for L2/L3-resident trees because each node visit costs one or two cache misses instead of four to six. The "ART" paper reports 4x lookup speedups from this kind of layout; `google/btree` and `tidwall/btree` both rely on inline arrays.

Caveat: fanout that is too large slows binary search inside a node; too small grows tree height. Sweet spot is usually 16–64 for int64 keys, lower for larger keys. Measure with a benchmark sweep.

---

## Optimization 6 — Batch rebalances during bulk insert

**Problem.** A naive bulk loader inserts keys one at a time, rebalancing after each. For N keys, this is O(N log N) tree work plus O(N) lock acquisitions. On 10 M keys, the constant factor matters.

**Before:**
```go
func (t *Tree) BulkInsert(keys []Key) {
    for _, k := range keys {
        t.Insert(k) // each call: lock, descend, split if needed, unlock
    }
}
```

**After (sort + bulk-load):** Sort the input, then construct the tree bottom-up with full leaves and one rebalance at the end. `google/btree` does not expose a bulk-load API, but you can sort and `ReplaceOrInsert` in order (which gives sequential allocation patterns), or build leaves manually.

```go
import "sort"

func (t *Tree) BulkInsert(keys []Key) {
    sort.Slice(keys, func(i, j int) bool { return keys[i].Less(keys[j]) })
    t.mu.Lock()
    defer t.mu.Unlock()
    for _, k := range keys {
        t.bt.ReplaceOrInsert(k) // sequential keys: each split is at the right edge
    }
}
```

For a manual implementation, build all leaves first, then internal nodes layer by layer:

```go
func BuildSortedBTree(keys []Key, fanout int) *Node {
    leaves := make([]*Node, 0, (len(keys)+fanout-1)/fanout)
    for i := 0; i < len(keys); i += fanout {
        end := i + fanout
        if end > len(keys) {
            end = len(keys)
        }
        leaves = append(leaves, &Node{keys: append([]Key{}, keys[i:end]...), isLeaf: true})
    }
    layer := leaves
    for len(layer) > 1 {
        next := make([]*Node, 0, (len(layer)+fanout-1)/fanout)
        for i := 0; i < len(layer); i += fanout {
            end := i + fanout
            if end > len(layer) {
                end = len(layer)
            }
            parent := &Node{children: append([]*Node{}, layer[i:end]...)}
            for _, c := range parent.children[1:] {
                parent.keys = append(parent.keys, c.keys[0])
            }
            next = append(next, parent)
        }
        layer = next
    }
    return layer[0]
}
```

**Gain.** Bulk load is O(N) instead of O(N log N) for tree work, and zero rebalances during build. Measured 5x–20x faster than naive bulk insert on 10 M-key inputs. Bonus: leaves are densely packed, so subsequent range scans hit fewer cache lines.

---

## Optimization 7 — Replace mutex with `atomic.Pointer` swap for immutable subtrees

**Problem.** Even with hand-over-hand or optimistic reads, a `sync.Mutex` on every node costs 24 bytes per node and 10–30 ns per acquire/release. On a tree of 1 M nodes, that is 24 MB of locks before the actual data. Worse, write paths still serialise.

**Before:**
```go
type Node struct {
    mu       sync.Mutex
    keys     []Key
    children []*Node
}

func (n *Node) Replace(i int, c *Node) {
    n.mu.Lock()
    n.children[i] = c
    n.mu.Unlock()
}
```

**After (atomic pointer per child slot).** Each child slot is an `atomic.Pointer[Node]`. Writers build a replacement subtree off to the side, then publish it with a single CAS. Readers do an atomic load — no lock, no fence, just a cache-coherent read.

```go
type Node struct {
    keys     [fanout]Key
    children [fanout + 1]atomic.Pointer[Node] // each slot is independently swappable
}

func (n *Node) Get(k Key) (Value, bool) {
    if n.isLeaf() {
        return n.lookupLeaf(k)
    }
    i := n.findChild(k)
    c := n.children[i].Load()
    return c.Get(k)
}

func (n *Node) replaceChild(i int, oldC, newC *Node) bool {
    return n.children[i].CompareAndSwap(oldC, newC)
}
```

Inserting becomes: build the new subtree (allocate new path nodes), then CAS-publish at the parent. Concurrent writers that touch disjoint slots succeed in parallel; those that touch the same slot retry.

**Gain.** Read path becomes truly lock-free, ~1 ns per node visit. Write path scales with concurrency on disjoint subtrees. Memory drops by the mutex cost (~24 MB on a 1 M-node tree).

Caveat: subtrees swapped out must not be freed while readers still hold pointers to them. Combine with epoch-based reclamation:

```go
import "github.com/google/btree" // for inspiration; pattern is general

type Epoch struct {
    active atomic.Int64 // count of readers in this epoch
}

// On read enter:   e.active.Add(1)
// On read exit:    e.active.Add(-1)
// Writers retire nodes into the current epoch's free list and free them only
// when active == 0 and the epoch has advanced past two boundaries.
```

This is the technique used by Java's `ConcurrentSkipListMap` (less so) and by the Linux kernel's RCU (precisely). In Go, you can lean on the garbage collector instead: as long as no reader can read the old pointer, GC reclaims it eventually. The trade-off is occasional memory bloat for retired-but-not-yet-collected nodes.

---

## Optimization 8 — Profile-guided height selection (fanout tuning)

**Problem.** B-tree fanout is the most over-looked tuning knob. A fanout that is too small grows tree height (more comparisons, more pointer chases). A fanout that is too large makes binary-search-inside-a-node slow and pollutes cache. The "right" fanout depends on key size, value size, access pattern, and cache topology — and you cannot guess it.

**Before:**
```go
bt := btree.NewG[Item](32, less) // fanout 32 chosen because "it's a power of 2"
```

**After.** Sweep fanout values and measure. `google/btree.NewG(degree, less)` takes a `degree` (half-fanout), so `degree=32` gives a fanout of 64. Bench across degrees:

```go
func BenchmarkBTreeFanout(b *testing.B) {
    for _, deg := range []int{4, 8, 16, 32, 64, 128} {
        b.Run(fmt.Sprintf("deg=%d", deg), func(b *testing.B) {
            bt := btree.NewG[Item](deg, less)
            for i := 0; i < 100_000; i++ {
                bt.ReplaceOrInsert(Item{Key: int64(rand.Int63())})
            }
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _, _ = bt.Get(Item{Key: int64(rand.Int63())})
            }
        })
    }
}
```

Typical results on a modern x86 server with 8-byte keys:

| Degree | Fanout | Get ns/op | Insert ns/op |
|--------|--------|-----------|--------------|
| 4      | 8      | 380       | 720          |
| 8      | 16     | 290       | 560          |
| 16     | 32     | 240       | 480          |
| 32     | 64     | 230       | 470          |
| 64     | 128    | 260       | 510          |
| 128    | 256    | 340       | 640          |

The sweet spot is around fanout 32–64, but the *exact* value differs per machine. Run the bench in CI, pin the chosen degree per workload.

**Gain.** Choosing the right fanout typically wins 20–40% on lookup latency and 10–20% on insert latency. A bad choice (degree 4 or degree 128) can cost 2x.

Bonus: for read-mostly workloads with large values, you can use a B+-tree where leaves carry values and internal nodes carry only keys + pointers. This raises effective internal fanout (more keys per cache line) and shortens height further.

---

## Optimization 9 — Use `tidwall/btree` generic API to avoid interface boxing

**Problem.** A pre-generics B-tree with `interface{}` items pays for type assertions on every comparison and forces a heap allocation per key. On primitive keys this is the dominant cost.

**Before (pre-1.18-style):**
```go
import "github.com/google/btree" // v1.0.x — non-generic API

type IntKey int

func (a IntKey) Less(b btree.Item) bool { return a < b.(IntKey) }

bt := btree.New(32)
bt.ReplaceOrInsert(IntKey(42)) // boxes 42 into an interface
```
Every comparison incurs a type assertion (`b.(IntKey)`); every insert allocates an interface header.

**After (`tidwall/btree` or `google/btree` generic API):**
```go
import "github.com/tidwall/btree"

bt := btree.NewBTreeG[int](func(a, b int) bool { return a < b })
bt.Set(42) // no boxing
```
Or with `google/btree` generic API:
```go
import "github.com/google/btree"

bt := btree.NewG[int](32, func(a, b int) bool { return a < b })
bt.ReplaceOrInsert(42)
```

**Gain.** Eliminates per-key boxing (saves 16 bytes/key) and the type assertion (~3–5 ns/cmp). Measured 1.5x–2.5x faster on primitive-key workloads. For struct keys, the gain is smaller (the struct is already unboxed via the generic parameter), but allocator pressure still drops.

`tidwall/btree` also exposes a built-in `Locked` flag (`btree.NewBTreeGOptions[int](less, btree.Options{NoLocks: false})`) so you can switch between locked and unlocked variants without rewriting code. Use the unlocked variant when you own external synchronisation (e.g., behind RCU or `atomic.Pointer` swap).

---

## Optimization 10 — Path-prefix compression for long string keys (ART-style)

**Problem.** A B-tree storing long string keys (URLs, file paths, DNS names) wastes memory and cache: every node stores full keys, comparisons walk many bytes, and tree height grows because each level distinguishes by only one or two characters.

**Before (B-tree with full string keys):**
```go
bt := btree.NewG[string](32, func(a, b string) bool { return a < b })
bt.ReplaceOrInsert("https://example.com/api/v1/users")
bt.ReplaceOrInsert("https://example.com/api/v1/posts")
// Many keys share the "https://example.com/api/v1/" prefix; the B-tree stores
// it in every leaf and re-compares it on every lookup.
```

**After (ART — Adaptive Radix Tree — with path compression).** Common prefixes live once at the parent edge; nodes adapt size (Node4, Node16, Node48, Node256) to fanout. ART achieves O(k) lookup where k is key length, independent of n. Production Go implementation: `github.com/plar/go-adaptive-radix-tree` or `github.com/kellydunn/go-art`.

```go
import art "github.com/plar/go-adaptive-radix-tree"

t := art.New()
t.Insert(art.Key("https://example.com/api/v1/users"), userRoute)
t.Insert(art.Key("https://example.com/api/v1/posts"), postRoute)
v, ok := t.Search(art.Key("https://example.com/api/v1/users"))
```

For concurrent ART, see ROWEX or "Concurrent ART" papers; in Go, the typical pattern is to combine ART with optimistic version counters (Optimization 2) or with the `atomic.Pointer` per-edge swap (Optimization 7).

**Gain.** Memory drops dramatically for prefix-heavy workloads — often 5x–10x for URL or path keys. Lookup latency drops by 2x–5x because comparisons skip shared prefixes and fanout per node is 4–256 (variable), keeping height shallow.

Caveat: ART is harder to implement than a B-tree and harder to make concurrent. Use it when keys are strings or byte sequences with significant prefix overlap; for fixed-size keys (int64, UUID), stick with B-trees.

---

## Optimization 11 — Snapshot iteration without holding a global lock

**Problem.** A long-running range scan that holds the tree's `RLock` for the duration of the iteration blocks all writers — possibly for seconds on a large tree. This is a common cause of "the database stalled" incidents.

**Before:**
```go
func (t *Tree) RangeAll(fn func(Item) bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    t.bt.Ascend(func(it Item) bool { return fn(it) })
}
```
If `fn` is slow (e.g., writes to disk, makes a network call), every writer waits.

**After (snapshot via clone).** `google/btree.Clone` returns a copy-on-write snapshot in O(1). Iterate the snapshot under no lock; writers continue against the live tree.

```go
func (t *Tree) RangeAll(fn func(Item) bool) {
    t.mu.Lock()
    snap := t.bt.Clone() // O(1); marks shared nodes COW
    t.mu.Unlock()
    snap.Ascend(func(it Item) bool { return fn(it) })
}
```

Or with the RCU pattern (Optimization 3), the snapshot is free:
```go
func (t *RouteTable) RangeAll(fn func(Route) bool) {
    snap := t.cur.Load() // lock-free
    snap.Ascend(func(r Route) bool { return fn(r) })
}
```

**Gain.** Writers no longer block on long scans. Memory cost is the COW delta — new internal nodes for any write that touches a path also referenced by the snapshot. For short-lived scans the delta is tiny; for long scans it can grow, so cap the snapshot lifetime in your application.

---

## Optimization 12 — Avoid GC pressure with `sync.Pool` for tree nodes

**Problem.** A tree under heavy churn (many inserts and deletes) allocates and frees nodes constantly. Even with the generational GC improvements, allocation rate of 100 MB/s on tree internals causes mark assist storms and tail-latency spikes.

**Before:**
```go
func (n *Node) split() (left, right *Node) {
    left = &Node{keys: n.keys[:fanout/2]}    // alloc 1
    right = &Node{keys: n.keys[fanout/2:]}   // alloc 2
    return
}
```

**After (pooled nodes):**
```go
var nodePool = sync.Pool{
    New: func() any { return &Node{} },
}

func newNode() *Node {
    n := nodePool.Get().(*Node)
    // zero relevant fields; do not leak old pointers
    *n = Node{}
    return n
}

func freeNode(n *Node) {
    nodePool.Put(n)
}

func (n *Node) split() (left, right *Node) {
    left, right = newNode(), newNode()
    copy(left.keys[:], n.keys[:fanout/2])
    copy(right.keys[:], n.keys[fanout/2:])
    return
}
```

**Gain.** Allocation rate drops 50x–100x on churn-heavy workloads. GC frequency drops; p99 latency improves dramatically. Pair with RCU or epoch reclamation: never pool a node while a reader may still see it.

Caveat: `sync.Pool` is per-P and may drop items at any GC. Do not assume `Put`-ted nodes persist. Do not put nodes that have escaped to other goroutines.

---

## Optimization 13 — Lehman-Yao B-link trees for higher write concurrency

**Problem.** Even hand-over-hand latching serialises writers that walk overlapping paths. During a split, the parent must be relatched, blocking concurrent inserters that would otherwise touch different children. On a tree under heavy concurrent write load, splits become the bottleneck.

**Before (classic crab-latching B-tree):**
```go
func (t *Tree) Insert(k Key) {
    parent := lockExclusive(t.root)
    for !parent.isLeaf() {
        child := lockExclusive(parent.children[parent.findChild(k)])
        if child.willSplit() {
            // hold both latches through the split
            split(parent, child)
        }
        unlockExclusive(parent)
        parent = child
    }
    parent.insertLeaf(k)
    unlockExclusive(parent)
}
```
Splits hold two X-latches; concurrent inserters wait.

**After (B-link tree — Lehman & Yao 1981).** Every node has a "right-link" pointer to its right sibling at the same level. After a split, the new right sibling is created and the right-link is set *before* the parent is updated. A reader or writer that arrives at the old node and finds its key exceeds the local high-key follows the right-link instead of relatching the parent.

```go
type Node struct {
    mu        sync.RWMutex
    highKey   Key   // max key reachable from this node
    rightLink *Node // pointer to right sibling (may be set during split)
    keys      []Key
    children  []*Node
}

func (t *Tree) findLeaf(k Key) *Node {
    n := t.root
    n.mu.RLock()
    for !n.isLeaf() {
        // follow right-links if a split has moved our key right
        for n.rightLink != nil && k.Greater(n.highKey) {
            r := n.rightLink
            r.mu.RLock()
            n.mu.RUnlock()
            n = r
        }
        c := n.children[n.findChild(k)]
        c.mu.RLock()
        n.mu.RUnlock()
        n = c
    }
    // same right-link chase at leaf level
    for n.rightLink != nil && k.Greater(n.highKey) {
        r := n.rightLink
        r.mu.RLock()
        n.mu.RUnlock()
        n = r
    }
    return n
}
```

**Gain.** Writers no longer hold parent latches across splits. Concurrent inserts into different leaves proceed independently. This is the protocol used by PostgreSQL's B-tree (`nbtree.c`) and many other production systems. Measured 2x–5x write throughput improvement on contended workloads.

Caveat: implementation complexity is real — sibling pointers must be set atomically, and the right-link chase must be bounded to avoid infinite loops during concurrent splits. The Lehman-Yao paper and PostgreSQL's `README.btree` are essential reading.

---

## Optimization 14 — Use `runtime/trace` and `pprof` to find the actual bottleneck

**Problem.** It is tempting to "optimize" a concurrent tree by guessing — "let's add more shards, let's switch to ART." Without measurement, you usually move the bottleneck rather than fix it.

**Before.** Iterating on production performance tuning by intuition.

**After.**
```go
import (
    "os"
    "runtime/pprof"
    "runtime/trace"
)

func ProfileWorkload() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    tf, _ := os.Create("trace.out")
    trace.Start(tf)
    defer trace.Stop()

    runTreeWorkload()
}
```

Then:
- `go tool pprof cpu.prof` — see where CPU is spent. Common findings: 70% in `runtime.semacquire` (lock contention), 30% in `mallocgc` (allocation pressure), 50% in `memequal` (slow comparator).
- `go tool trace trace.out` — see goroutine blocking, scheduling delays, GC pauses. Common findings: writers blocking readers for 100s of ms, GC mark assist stalls during heavy insert.
- Add a `mutex` profile: `runtime.SetMutexProfileFraction(1); pprof.Lookup("mutex").WriteTo(...)`. Shows which lock is most contended — often a single hot internal node.

**Gain.** You move from guessing to measuring. The most common surprises:
- The "concurrent" tree is actually single-threaded because all keys hash to one shard.
- 80% of CPU is the `Less` function — a string `<` on long keys — not the tree at all.
- GC pauses dominate p99; the tree is fine.
- Writers block readers for 30 ms during a rebalance; switch to RCU or B-link.

The trace tool is the highest-leverage diagnostic the Go runtime ships. Run it before any major restructuring.

---

## Final note

Concurrent tree optimization is a stack of techniques, not a single trick. The order to apply them, roughly:

1. **Measure** with `pprof` and `runtime/trace`. Do not skip this.
2. **Right-size the fanout** for your key/value shape (Optimization 8). Cheap to try, big impact.
3. **Pick the right concurrency model** for your read/write ratio:
   - Read-mostly (>95% reads): RCU + `atomic.Pointer` (Optimizations 3, 7).
   - Mixed: hand-over-hand or optimistic version counters (Optimizations 1, 2).
   - Write-heavy: B-link tree (Optimization 13) or persistent tree (Optimization 4).
4. **Reduce GC pressure** with `sync.Pool` for nodes (Optimization 12) and inline arrays for keys (Optimization 5).
5. **For string keys, consider ART** with path compression (Optimization 10).
6. **For bulk operations, batch** sorted inserts (Optimization 6).

Most of the time, the answer is "use `google/btree` or `tidwall/btree` behind RCU and call it a day." Reach for hand-coded latching, persistent trees, or Bw-trees only when measurement proves the simpler design is the bottleneck. The literal cost of `Insert(k)` is not the limit — your access pattern is, and the data structure should match it.

Profile before you optimize. Measure before and after. Many of these changes can hurt as easily as they help on the wrong workload — RCU is catastrophic on write-heavy paths, B-link trees are massive overkill for read-mostly indexes, and `sync.Pool` can pessimise simple cases by adding indirection. The runtime is good; your job is to give it the right shape of data.
