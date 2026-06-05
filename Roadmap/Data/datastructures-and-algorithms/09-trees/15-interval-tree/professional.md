# Interval Tree — Professional Level

> **Audience:** Engineers building production interval-indexed systems where throughput, latency, and correctness under concurrency all matter. Assumes mastery of `junior.md`–`senior.md`.

This document covers the topics that come up once you start scaling: **concurrency models**, **cache-conscious layouts**, **bulk operations**, **persistence**, **comparison to segment-tree-of-points encodings**, and the **multidimensional generalization path** toward kd-trees and R-trees.

---

## Table of Contents

1. [Concurrent Interval Trees](#concurrency)
2. [`INTERVAL_TREE_DEFINE` — Linux's Type-Generic Augmented RB Tree](#linux-macro)
3. [Cache-Conscious Design](#cache)
4. [Bulk Operations](#bulk)
5. [Persistent Interval Trees](#persistent)
6. [Versus Segment-Tree-of-Points Encoding](#vs-segment)
7. [Multidimensional Generalization](#multidim)
8. [Compressed Time Axis](#compressed-time)

---

<a name="concurrency"></a>
## 1. Concurrent Interval Trees

A single global lock around an interval tree limits throughput to one writer at a time. Production systems use one of three patterns:

### Lock coupling (hand-over-hand)

Each node holds its own mutex. A traversal acquires the root lock, descends to a child, acquires the child lock, releases the parent lock, and repeats. Insertions acquire write locks; reads acquire read locks. Lock coupling allows concurrent readers in different subtrees and concurrent writers if their paths don't overlap.

Downside: each operation does O(log n) lock-acquire/release pairs. The atomic-operation overhead dominates for small workloads; the technique pays off only when contention is high enough that a single mutex would serialize.

### Read-Copy-Update (RCU)

The Linux kernel uses RCU for many of its interval-tree-like indices (page tables, parts of the VFS). Readers take **no locks at all** — they just dereference pointers and read. Writers build a new version of the structure (path-copying or copy-on-write), then atomically swap the root pointer. Old readers continue to see the old tree until they finish; the old nodes are reclaimed once a **grace period** has elapsed (no reader can still be holding them).

For interval trees, RCU pairs naturally with the augmented-RB design: each update copies O(log n) nodes on the modified path. Readers always see a consistent snapshot; writers serialize among themselves (typically with a single mutex on the writer path) but readers are unimpeded.

### Optimistic concurrency (sequence locks / version counters)

Each node holds a version counter. A reader reads the counter before and after its descent; if they differ, the structure mutated mid-read and the reader retries. Writers bump the counter at every mutation.

Sequence locks scale beautifully for read-heavy workloads but require **carefully formed reads** — a reader cannot dereference a stale pointer to freed memory. Pair with epoch-based reclamation (EBR) or hazard pointers.

### Lock-free augmented BSTs

There is a small academic literature on lock-free augmented BSTs (Bronson 2010, Natarajan & Mittal 2014). The augmentation `subtreeMax` complicates lock-freedom because updates to `subtreeMax` must be atomically consistent with structural changes. In practice, RCU + writer-serialization is the standard production pattern.

---

<a name="linux-macro"></a>
## 2. `INTERVAL_TREE_DEFINE` — Linux's Type-Generic Augmented RB Tree

`include/linux/interval_tree_generic.h` exposes a single macro:

```c
#define INTERVAL_TREE_DEFINE(ITSTRUCT, ITRB, ITTYPE, ITSUBTREE,         \
                             ITSTART, ITLAST, ITSTATIC, ITPREFIX)
```

Arguments:

- `ITSTRUCT` — the user's struct type (e.g., `struct vm_area_struct`).
- `ITRB` — the field name inside the struct that holds the embedded `struct rb_node`.
- `ITTYPE` — the integer type of the interval endpoints (`unsigned long` for VMAs).
- `ITSUBTREE` — the field name of the augmented `subtreeMax` (Linux calls it `subtree_last`).
- `ITSTART(node)` — accessor expression returning the start of an interval.
- `ITLAST(node)` — accessor expression returning the last (inclusive end) of an interval.
- `ITSTATIC` — `static` or empty, controlling the linkage of generated functions.
- `ITPREFIX` — prefix for generated function names.

The macro generates:

```c
ITSTATIC void ITPREFIX_insert(ITSTRUCT *node, struct rb_root_cached *root);
ITSTATIC void ITPREFIX_remove(ITSTRUCT *node, struct rb_root_cached *root);
ITSTATIC ITSTRUCT *ITPREFIX_iter_first(struct rb_root_cached *root,
                                       ITTYPE start, ITTYPE last);
ITSTATIC ITSTRUCT *ITPREFIX_iter_next(ITSTRUCT *node,
                                       ITTYPE start, ITTYPE last);
```

Key design choices:

- **Intrusive nodes.** The `rb_node` is embedded in the user struct, not a wrapper. No allocation per insert; the user owns the memory.
- **Augmentation maintained via callbacks.** The macro generates the `subtree_last` update callback and passes it to the generic `rb_insert_augmented` / `rb_erase_augmented`. Theorem 14.1 (CLRS) keeps each rotation O(1).
- **Cached root** (`rb_root_cached`) tracks the leftmost node — useful for iterating intervals in order.
- **`iter_first` + `iter_next` are an iterator pair.** Equivalent to the all-overlaps walk but yields nodes one at a time without recursion, so the caller can stop early.

This pattern — intrusive nodes, type-generic via macros, augmentation via callbacks — is the gold standard for in-kernel data structures. It has zero runtime overhead vs hand-rolling a tree per type.

---

<a name="cache"></a>
## 3. Cache-Conscious Design

A node in a pointer-based interval tree typically costs 40–48 bytes (interval endpoints, `subtreeMax`, left/right pointers, RB color bit, parent pointer). Modern CPUs fetch 64-byte cache lines. A traversal touches one cache line per node, so a tree of depth 20 incurs ~20 L1 cache misses worst case.

### Inline interval data

The first cache-conscious rule: **store `lo, hi, subtreeMax` directly in the node**, never indirected through a heap-allocated `Interval` object. The compare-test reads them in the same cache line as the node header.

### B+ tree of intervals

For very large trees (millions of intervals) the depth-20 cache penalty hurts. A B+ tree variant — branching factor 32 or 64 instead of 2, with intervals stored sorted per node and `subtreeMax` augmentation per child pointer — cuts depth to ~4. Each node touched is a cluster of intervals fitting in 2–3 cache lines.

Linux's Maple Tree (added in 6.x) is approximately this design for the VMA index. The Maple Tree uses 4-arity per leaf node and 16-arity per internal node, with `last` augmentation tracked per child slot. The result is a 2–3× speedup over the augmented RB tree for typical VMA workloads.

### Eytzinger layout for static trees

If your dataset is static, store the tree as a 1-indexed array in BFS order. Children of node `i` are at `2i` and `2i+1`. Sequential prefetch becomes trivial; the array is contiguous; no pointer-chasing. The technique was originally proposed for binary search (the "BFS layout" in Khuong & Morin 2017); it carries over to centered interval trees.

### NUMA awareness

On NUMA systems, pin per-shard trees to their owning socket. If a query crosses sockets, expect cross-socket cache traffic. Production GIS engines often partition the spatial domain (and thus the interval index) along NUMA lines.

---

<a name="bulk"></a>
## 4. Bulk Operations

### Bulk build in O(n) (centered tree from sorted endpoints)

If your intervals come with endpoints already sorted, you can build a balanced centered tree in O(n) instead of O(n log n). The technique: a single recursive call uses the median-of-medians as the center, partitions in linear time, and recurses.

### Union of N interval trees

A common operation: merge several per-shard interval trees into a single global one (e.g., shard rebalancing, replication catch-up). Naive insertion is O((nN) log(nN)). The optimal sequence is:

1. Collect endpoint events from each tree in O(n) per tree.
2. Sort the merged event list in O(nN log N) using a **multiway merge** since each tree's events are already sorted.
3. Rebuild a single tree in O(nN).

Total: O(nN log N). For N = 64 shards and n = 10⁶ per shard, that's ~6 × 10⁹ vs ~10¹⁰ for naive insertion — 1.7× speedup, larger when N grows.

### Range-batch overlap

A workload of Q simultaneous overlap queries (e.g., "given Q query ranges, find overlaps for each") often benefits from a **sweep**. Sort the queries by lo; sweep the tree by lo with a moving active set. Total O((n + Q) log n) vs O(Q log n + Qk).

---

<a name="persistent"></a>
## 5. Persistent Interval Trees

The path-copying technique from `middle.md` carries over. Each update copies O(log n) nodes; the augmentation `subtreeMax` is recomputed on each copied node in O(1).

### Fat-node persistence

An alternative to path copying: store multiple `(version, value)` pairs in each node. Each node grows over time; lookups binary-search the node's version list. Sleator and Tarjan's general persistence framework uses this.

For interval trees specifically, the augmentation is the wrinkle. `subtreeMax` is a function of the current state of the subtree, which itself depends on which version we're querying. Path copying handles this naturally (the augmented value is baked into the copied path); fat nodes need version-indexed augmentation storage, which is messier.

### Application: MVCC

A database's MVCC layer uses persistence to give each transaction a consistent snapshot. An interval index inside a transactional store (e.g., temporal queries over ranges) maps cleanly to a persistent interval tree. PostgreSQL's MVCC is row-oriented (per-tuple version chains), not tree-oriented, so this is more theoretical than practical for OLTP databases — but specialized temporal databases (HyPer, MEMSQL) do use persistent tree structures.

---

<a name="vs-segment"></a>
## 6. Versus Segment-Tree-of-Points Encoding

An alternative to interval trees: encode intervals as **point events** and feed them to a segment tree.

For each interval `[lo, hi]`, insert two events:

- `+1` at position `lo`
- `-1` at position `hi + 1`

Now query "how many intervals contain point `q`" by computing `prefixSum(q) = number of +1 events at positions <= q minus number of -1 events at positions <= q`. A segment tree of size `O(maxCoord)` over the integer domain supports point-update and prefix-sum in O(log U).

**Pros vs interval tree:**
- Conceptually simpler.
- Supports "how many intervals contain q" as a single number (interval tree gives the list, which is heavier).
- Works with arrays + Fenwick trees for tiny constants.

**Cons vs interval tree:**
- Requires bounded integer domain (or coordinate compression).
- Cannot enumerate the actual intervals at a point — only the count.
- Update is O(log U) where U is the domain size, not O(log n).
- Doesn't support delete cleanly (you'd need to track which events are from which interval).

**Use segment-tree-of-points when:** you only need counts, the domain is small, intervals are short-lived. **Use interval tree when:** you need to enumerate intervals, support deletes, work over a large or unbounded domain.

---

<a name="multidim"></a>
## 7. Multidimensional Generalization

The 1D interval tree generalizes to higher dimensions in two main ways.

### 2D interval tree (range tree of intervals)

For axis-aligned 2D rectangles, the canonical structure is a **multilevel range tree**: a tree on the x-projection, and at each x-tree node, a secondary tree on the y-projection of the intervals stored there. Total space O(n log n), query time O(log² n + k).

In practice, 2D interval trees are rarely used; the **R-tree** (Guttman 1984) is the dominant 2D bounding-box index. R-trees use a B+ tree where each node stores a bounding box that contains all children's bounding boxes. Insertion picks the child whose bounding box would grow the least; deletion may rebalance lazily. The R-tree variants (R*-tree, Hilbert R-tree, R+-tree) tune the split heuristic.

### kd-tree

For higher-dimensional *point* data (not intervals), the **kd-tree** alternates the split dimension per level. It's the structure of choice for nearest-neighbour queries up to d ≈ 20 dimensions. For intervals in higher dimensions you can store the midpoint as a kd-tree point and the half-extents as auxiliary data — but R-trees are usually preferable.

### Path forward in this roadmap

This is why the `09-trees` series follows interval tree with R-tree and kd-tree as later topics. Each is a generalization: interval tree → 2D interval / range tree → R-tree → R*-tree → kd-tree variants.

---

<a name="compressed-time"></a>
## 8. Compressed Time Axis

In event-driven simulation (network simulators, hardware simulators, game-physics simulators) the time axis is unevenly spaced: most "ticks" have no events, and a few moments have many. Indexing intervals over absolute time wastes space on empty regions.

The solution is **coordinate compression**: collect every distinct endpoint value, sort, assign each a rank. Now your axis is `{0, 1, ..., 2n-1}` and an interval `[lo_real, hi_real]` becomes `[rank(lo_real), rank(hi_real)]`. The interval tree is built over the compressed axis.

This is useful when:

- The domain is unbounded or huge but only a small number of distinct endpoints occur.
- You can collect all endpoints up front (offline workload). For streaming workloads, you cannot easily compress on the fly; use balanced BST of endpoints + rebuild periodically.

Coordinate compression turns the segment-tree-of-points encoding (section 6) from O(U) space to O(n) space, making it competitive with interval trees again for offline workloads.

---

**Where to go next.** `interview.md` collects 10 LeetCode-style problems with three-language solutions. `tasks.md` provides hands-on exercises with reference solutions to consolidate your understanding.
