# AVL Tree — Professional Level

> **Audience:** Engineers building or maintaining production AVL-based systems, library authors, and researchers. Prerequisite: `senior.md`.

This document covers the **modern AVL** — cache behavior on contemporary CPUs, the concurrency story (why lock-free AVL is hard and what to do instead), the **persistent (functional) AVL** analysis from Okasaki's perspective, the **WAVL** (Weak AVL) variant of Haeupler-Sen-Tarjan 2015 that hybridizes AVL and red-black, and the **B-tree vs AVL** crossover analysis on modern memory hierarchies.

---

## Table of Contents

1. [Cache Effects on AVL — Node Layout](#cache)
2. [Concurrency — Why Lock-Free AVL Is Hard](#concurrency)
3. [Persistent (Functional) AVL Cost Analysis](#persistent)
4. [WAVL — Weak AVL (Haeupler-Sen-Tarjan 2015)](#wavl)
5. [B-Trees vs AVL on Modern CPUs](#vs-btree)

---

<a name="cache"></a>
## 1. Cache Effects on AVL — Node Layout

Modern CPUs (2026) have:

- L1 cache: ~32 KB per core, 4–5 cycle latency, 64-byte cache line.
- L2 cache: ~1 MB, ~12 cycles.
- L3 cache: ~30 MB shared, ~40 cycles.
- DRAM: ~150 cycles per random access.

A pointer chase on a tree node that misses L1 costs at least 12 cycles; missing L3 costs ~150. AVL's `O(log n)` lookup makes `O(log n)` pointer chases, each potentially a cache miss. For `n = 10⁷`, that's ~25 misses × 150 cycles = 3.75 μs just for memory stalls.

### 1.1 Node size matters

A minimal AVL node in C/Go/Rust is:

```
key (8 bytes) + left (8) + right (8) + height (4) + padding (4) = 32 bytes
```

A 64-byte cache line holds **2 nodes**. If two siblings happen to land on the same cache line, the search of either is free after the first miss.

Many production AVLs target one-node-per-cache-line to simplify alignment math:

```
struct Node {
    Key key;
    Node* left, *right;
    Node* parent;
    int8_t balance_factor;
    int8_t flags;
    int8_t pad[6];
}
// 8 + 8 + 8 + 8 + 1 + 1 + 6 = 40 bytes; cache line at 64 holds one node
```

### 1.2 Pointer compression

When the tree lives entirely within a known arena (say, ≤4 GB), pointers can be 32-bit offsets instead of 64-bit absolute addresses. Node size halves:

```
key (8) + left (4) + right (4) + height (1) + pad (3) = 20 bytes
```

Now a cache line holds **3 nodes** plus padding. This is the technique used by ZFS's in-kernel AVL and by several embedded-database engines (LMDB-derived).

### 1.3 Pointer-in-LSB tricks

Heap-allocated nodes are aligned to 8 or 16 bytes, leaving 3–4 unused low bits per pointer. You can pack the 2-bit balance factor into a pointer's LSBs:

```
parent_with_bf = parent_ptr | (bf + 1)  // bf ∈ {-1, 0, +1} → {0, 1, 2}
```

To dereference, mask off the low 3 bits. This trick recovers the memory cost of cached balance and is used by `RtlAvlTable` (Windows kernel) and `libavl` (GNU).

### 1.4 Eytzinger-style layout — not for dynamic AVL

In static binary search (see `08-search-algorithms/02-binary-search/professional.md`), the Eytzinger array layout places the root at index 0, left children at 2i+1, right at 2i+2, eliminating pointer chases. **This does not apply to dynamic AVL** — rotations would require shuffling array slots, costing O(n) per rotation. For static, read-only AVL substitutes, Eytzinger wins; for dynamic trees, pointer-based AVL is the only practical choice.

### 1.5 Practical takeaway

For high-performance AVL:
1. Use a node pool / arena, not per-node malloc.
2. Pack to ≤32 bytes; one or two nodes per cache line.
3. Cache balance factor (2 bits) over height (32 bits) when memory matters.
4. Use 32-bit offset pointers if the tree fits in 4 GB of arena.
5. Prefetch the next-most-likely-visited child during comparison.

These tricks together give 2–3× lookup throughput over a naive `malloc`-per-node AVL.

---

<a name="concurrency"></a>
## 2. Concurrency — Why Lock-Free AVL Is Hard

A single-threaded AVL is straightforward. Making it concurrent is one of the hardest open problems in data-structure engineering. The reason: **rotations touch three to five nodes simultaneously**, and any reader caught mid-rotation can observe a non-BST shape.

### 2.1 Coarse-grained locking

The simplest correct concurrent AVL:

```
operation():
    lock(tree_global_lock)
    do op
    unlock(tree_global_lock)
```

Correct, trivially. Throughput is single-threaded. Acceptable for trees touched by only a few writers and read by serialized batches; useless for high-concurrency workloads.

### 2.2 Hand-over-hand (lock coupling) locking

A more refined approach:

```
search(key):
    lock(root)
    cur = root
    while cur != null:
        next = (key < cur.key) ? cur.left : cur.right
        if next != null:
            lock(next)
        unlock(cur)
        cur = next
    return cur
```

Each thread holds at most 2 locks at once. Readers don't block each other if locks are reader-writer. **But for AVL inserts/deletes, rotations rewire ancestor pointers** — you need to hold a lock on the parent of every node you might rotate. Concurrent inserters can deadlock if they grab locks in different orders.

The practical mitigation: **always lock from root downward**, never upward. Insert: lock the root, descend re-locking as you go, find insertion point, lock the leaf area, perform insert, then walk back **releasing locks bottom-up**. Rotations during the upward walk require the parent's lock — but you released the parent's lock on the way down!

Solution: **optimistic descent followed by validation**, similar to optimistic locking in databases. Descend without locks, find the insertion point, lock the relevant subtree's root, validate that the descent path is still correct, and either commit or restart.

### 2.3 Bronson et al. (2010) — Optimistic AVL

The state-of-the-art concurrent AVL is Bronson et al.'s "A Practical Concurrent Binary Search Tree" (PPoPP 2010). It uses:

- Per-node version counters for optimistic reads.
- Hand-over-hand locking during rebalance.
- A separate "background rebalance" thread that lazily catches up on rotations.

This achieves nearly linear scaling up to ~32 cores on read-heavy workloads. Implementation is ~2000 lines of subtle code. Bugs in it have been published in formal verification papers. Most production systems don't bother — they use a skip list (`ConcurrentSkipListMap` in Java) which is much easier to make concurrent because there is no rebalancing.

### 2.4 The practical answer: don't

For concurrent ordered maps in 2026, use:
- **Skip list** (`java.util.concurrent.ConcurrentSkipListMap`, `crossbeam-skiplist` in Rust): lock-free, no rebalancing, O(log n) average.
- **Persistent copy-on-write tree**: each writer creates a new version; readers continue on old version. Per-update cost O(log n) extra nodes but no locking. Used by `clojure.core` immutable maps and OCaml `Map`.
- **Read-copy-update (RCU) AVL**: writers atomically swap the root pointer between versions; readers see a consistent snapshot per traversal. Used in some kernel paths.
- **Sharded AVL**: partition the key space by hash and run independent single-threaded AVLs per shard.

If you actually need concurrent AVL with fine-grained locking, read Bronson et al. and Drachsler-Cohen et al., budget weeks of debugging, and invest in formal verification.

---

<a name="persistent"></a>
## 3. Persistent (Functional) AVL Cost Analysis

`middle.md` introduced path copying. Let's analyze it precisely in Okasaki's framework.

### 3.1 Setup

A persistent AVL exposes:
```
insert : Tree × Key → Tree              -- returns new tree, old still valid
delete : Tree × Key → Tree
lookup : Tree × Key → Option<Value>
```

Each `insert` returns a new root; the old root and all references through it remain valid. Updates are non-destructive.

### 3.2 Per-operation cost

| Op | Time | New nodes allocated | Space saved (shared) |
|---|---|---|---|
| `lookup` | O(log n) | 0 | n |
| `insert` | O(log n) | O(log n) | n - O(log n) |
| `delete` | O(log n) | O(log n) | n - O(log n) |

Allocation is the cost: each modified path node must be copied. With balanced height `1.44 log n`, that's ~30 allocations for n = 10⁶, ~45 for n = 10⁹.

### 3.3 The rotation challenge

Rotations move pointers between nodes that may live in different generations. The rule: **any node touched by the rotation must be a new node**, because the old node belongs to the old tree and is shared.

So when rebalancing during the upward walk of a persistent insert, you cannot in-place rotate a shared node. Instead:

1. Walk down recording the path (or use the natural recursion).
2. On the way back up, create new copies of the path nodes.
3. When a copy needs rebalance, perform the rotation on the new copies only.

The amortized cost is the same O(log n) per update; the constant is higher because every modified node is allocated, not just rewritten.

### 3.4 Cost vs red-black

Okasaki's *Purely Functional Data Structures* (1998) showed that persistent **red-black trees** can be implemented with a clean pattern-matching insert: match the configurations after recoloring/rotation, return new nodes for the affected path. AVL persistence is also clean but the four rotation cases (eight including delete's bf-zero variants) make the pattern matching wordier. In Haskell or OCaml, persistent RB is the typical choice; persistent AVL is used when the tighter height bound matters more than code size.

### 3.5 Garbage collection interaction

In a GC'd language (Haskell, Clojure, Scala), old versions are collected when no longer referenced. In a non-GC language (Rust, C++), persistent trees need reference counting (`Arc<Node>`), with its own atomic-overhead cost.

In Rust, the `im` crate provides persistent AVL with `Rc<Node>` (single-threaded) or `Arc<Node>` (multi-threaded). Performance is competitive with mutation-based maps for read-heavy workloads, ~2× slower for write-heavy.

### 3.6 Snapshotting

A practical use of persistent AVL: **point-in-time snapshots** of a database. Save the current root pointer; subsequent writes create new versions; the snapshot remains queryable. Costs O(1) to snapshot, O(log n) per write thereafter. Used by Datomic, Git's object database, and many copy-on-write filesystems.

---

<a name="wavl"></a>
## 4. WAVL — Weak AVL (Haeupler-Sen-Tarjan 2015)

In 2015, Bernhard Haeupler, Siddhartha Sen, and Robert Tarjan published "Rank-balanced trees" (originally as the Weak AVL or WAVL paper at ESA 2009; journal version *ACM Transactions on Algorithms* 2015). WAVL **hybridizes** AVL and red-black, achieving:

- **Tight height bound** like AVL (better than red-black).
- **At most 2 rotations per delete** like red-black (better than AVL).

### 4.1 The rank invariant

Each node has a rank (integer). For a leaf, rank = 0. For an internal node, the rank differences with the children must be in `{1, 2}`. No two consecutive rank-2 differences. Specifically:

- AVL invariant: each rank difference is 1 or 2; **no two children with rank difference 2**.
- WAVL relaxes: each rank difference is 1 or 2, **but rank-2 children are allowed in some configurations**.

The result: at every node, both children are either rank-1 (like an AVL) or rank-2 (like a black RB node). WAVL freely mixes both.

### 4.2 Bounds

| Tree | Height bound | Rotations per insert | Rotations per delete |
|---|---|---|---|
| AVL | `1.44 log n` | ≤ 2 | O(log n) |
| Red-black | `2 log n` | ≤ 2 | ≤ 3 |
| WAVL | `2 log n` (after deletes), `1.44 log n` (insert-only) | ≤ 2 | ≤ 2 amortized |

**WAVL gives the AVL height bound when the tree is built only by inserts**, and degrades gracefully to red-black-like balance when deletes happen. The amortized rotation count for delete is constant.

### 4.3 Practical adoption

WAVL is a research result. It is not widely deployed because:
- The invariant is more complex to teach.
- The improvement over RB is small in practice.
- Engineering teams stick with the structure they know (RB).

However, **if you are designing a new sorted-map from scratch with no compatibility constraints**, WAVL is arguably the better choice — it strictly dominates RB on rotation count and matches AVL on height. The lack of stdlib adoption is purely historical.

Implementations exist in academic open-source code, the *Algorithms Illuminated* series by Tim Roughgarden discusses it, and at least one production database (research-stage) uses WAVL internally.

---

<a name="vs-btree"></a>
## 5. B-Trees vs AVL on Modern CPUs

A B-tree of order `b` (each node has up to `b` keys and `b+1` children) has height `log_b(n)`. With `b = 64`, the height for `n = 10⁹` is `log_64(10⁹) ≈ 5`. A balanced AVL: ~30 levels. So a B-tree lookup chases **6× fewer pointers**.

Each B-tree node holds many keys in a contiguous array, fitting in 1–2 cache lines. The intra-node search (a binary search over 64 sorted keys) runs entirely in cache after the first miss. The cost: each B-tree level chase costs one cache miss + 6 comparisons; each AVL level costs one cache miss + 1 comparison.

For a fair comparison on `n = 10⁹`:

| Tree | Levels | Cache misses per lookup | Comparisons | Wall time (est.) |
|---|---|---|---|---|
| AVL (binary) | 30 | 30 | 30 | ~30 × 150ns = 4.5 μs |
| B-tree (b=64) | 5 | 5 | 30 (5 × 6) | ~5 × 150ns + 30 × 1ns = 0.78 μs |

The B-tree is **~6× faster** when both trees overflow L3.

### 5.1 Where AVL still wins

When the whole tree fits in L3 (`n ≤ ~10⁶` for small keys):
- Both trees do most of their work in cache.
- AVL's binary comparison per level is faster than B-tree's 6-key binary search.
- AVL is slightly faster here.

When the workload is **range queries returning many results**, B-trees with siblings linked (B+ trees) win even harder. AVL would do `k` separate logarithmic lookups; B+ tree walks one leaf chain.

### 5.2 Hybrid approaches

Modern in-memory databases (HyPer, MemSQL/SingleStore) sometimes use **B-tree variants with small fanout** (b ≈ 8) for in-memory indexes — large enough for cache benefit, small enough for fast intra-node comparison. The Adaptive Radix Tree (ART, Leis et al. 2013) is another modern alternative that beats both AVL and B-tree on in-memory string workloads.

### 5.3 When to definitively pick which

| Scenario | Pick |
|---|---|
| Disk-resident, or n > L3 | B-tree / B+ tree |
| In-memory, n < L3, need ordered ops | AVL or red-black |
| In-memory, mixed string/int keys | ART or HAT-trie |
| Concurrent | Skip list or persistent tree |
| Lookups only after a one-time sort | Sorted array + binary search (or Eytzinger) |

### 5.4 The honest summary

In 2026, AVL is a niche tool: lookup-heavy in-cache workloads, range trees and other geometric augmentations, real-time systems, and teaching. The default in-memory sorted-map for new systems is red-black for write-mixed workloads, ART for string-heavy workloads, B-tree for everything that touches disk. AVL remains the most pedagogically pure entry point to the rotation mechanics that underlie all of them.

When you understand AVL deeply, you can build red-black, WAVL, persistent variants, augmented trees, and rotation-based fixes to any BST shape. That mastery is the real reason we still teach it.
