# Segment Tree — Professional Level

> **Audience:** Engineers chasing nanoseconds, designing data structures for huge sparse ranges, or comparing segment trees against advanced alternatives (wavelet trees, GNU PBDS, sqrt segment tree). Prerequisites: `junior.md`, `middle.md`, `senior.md`.

This document covers the **bleeding edge** of segment tree variants and the alternatives that sometimes beat them.

---

## Table of Contents

1. [Cache-Conscious Layout — van Emde Boas](#veb)
2. [SIMD Aggregation](#simd)
3. [Implicit (Sparse / Dynamic) Segment Trees](#implicit)
4. [Wavelet Trees — the K-th Smallest Generalization](#wavelet)
5. [Sqrt Segment Tree (CP Variant)](#sqrt)
6. [Red-Black Tree Augmentation as a Competitor](#rbtree)

---

<a name="veb"></a>
## 1. Cache-Conscious Layout — van Emde Boas

The standard segment tree layout puts the root at index 1, children at 2 and 3, etc. — a **BFS layout**. This is poor for cache lines: jumping from a parent to its child means jumping `i` to `2i`, which is a different cache line for `i > 8` (a 64-byte line holds 8 int64 nodes).

The **van Emde Boas layout** rearranges nodes so a parent and its descendants up to depth √log n live on the same cache line. The technique:

1. Split the tree in half by depth: top half (root to mid-depth) and bottom halves (mid-depth to leaves).
2. Lay out the top half recursively in van Emde Boas order.
3. Lay out each bottom half in van Emde Boas order, contiguously.

The result: any root-to-leaf path crosses **O(log_B n)** cache lines, where `B` is the line capacity in nodes — versus **O(log₂ n)** in the BFS layout. Concretely on x86-64 with 64-byte lines and 8 int64 per line:

- BFS layout: ~20 cache misses for n = 10⁶.
- vEB layout: ~7 cache misses.

That is the same speedup B-trees of branching factor 8 give. The trade is **build complexity**: vEB requires either a custom layout pass or runtime index translation. Cf. **Brodal et al., "Cache-Oblivious Search Trees" (2003)** for the theoretical foundation.

In practice, the vEB layout is implemented for **immutable** segment trees (read-heavy workloads). For mutable trees the gain is smaller because updates still write the path, and modern CPUs have store-buffers that hide some of the BFS-layout cost.

---

<a name="simd"></a>
## 2. SIMD Aggregation

For very wide segment trees, the **bottom level** (the leaves and the level just above) can be aggregated with SIMD. AVX2 has 256-bit registers — 4 int64 or 8 int32 per register. AVX-512 doubles that.

### Pattern
At the leaf level, group the array into chunks of 8 (or 16 for int32). Each chunk's sum is a single `_mm256_add_epi64` reduction. The bottom 3–4 levels of the segment tree are eliminated entirely: the "leaves" of the segment tree become 8-element chunks rather than single elements.

### Throughput
A SIMD sum of 16 int32s takes ~1 cycle on Zen 4 / Sapphire Rapids — vs ~3 cycles for the equivalent scalar additions. For range-sum-only workloads, **SIMD'd segment trees hit 10⁸ queries per second per core** on warm L1.

### Caveats
- SIMD complicates lazy propagation — the apply step must vector-broadcast the tag.
- Min/max SIMD is straightforward (`_mm256_min_epi32`), but min-with-index requires extra masking.
- GCD has no SIMD form — scalar fallback at the bottom levels.
- Code is no longer portable; expect `#ifdef AVX2` blocks. Use libraries like **xsimd** or **Highway** for cross-architecture portability.

---

<a name="implicit"></a>
## 3. Implicit (Sparse / Dynamic) Segment Trees

When the underlying range is huge (e.g., 10¹⁸ — keys are 64-bit hashes) but only ~10⁵ positions are ever touched, allocating a 4n array is infeasible. **Implicit segment trees** allocate nodes **on demand**.

### Structure
Each node holds `(value, lazy, left_child_ptr, right_child_ptr)`. When a query or update needs to descend into a child that doesn't exist, the child is **created lazily** as an "all-identity" node (sum = 0, lazy = 0). Total nodes created = O(k log range) where k is the number of operations.

### Memory
- 32 bytes per node (sum + lazy + two pointers).
- For 10⁵ updates over a 10⁹ range: 10⁵ × 30 ≈ 3M nodes = ~100 MB. That fits.
- For 10⁶ updates: ~30M nodes = ~1 GB. Borderline.

### Python sketch
```python
class Node:
    __slots__ = ("val", "lazy", "left", "right")
    def __init__(self):
        self.val = self.lazy = 0
        self.left = self.right = None

def apply(node, lo, hi, val):
    node.val += val * (hi - lo + 1)
    node.lazy += val

def push(node, lo, hi):
    if node.lazy:
        mid = (lo + hi) // 2
        if not node.left:  node.left  = Node()
        if not node.right: node.right = Node()
        apply(node.left,  lo,    mid, node.lazy)
        apply(node.right, mid+1, hi,  node.lazy)
        node.lazy = 0

def update(node, lo, hi, ql, qr, val):
    if qr < lo or hi < ql: return
    if ql <= lo and hi <= qr: apply(node, lo, hi, val); return
    push(node, lo, hi)
    mid = (lo + hi) // 2
    if not node.left:  node.left  = Node()
    if not node.right: node.right = Node()
    update(node.left,  lo,    mid, ql, qr, val)
    update(node.right, mid+1, hi,  ql, qr, val)
    node.val = node.left.val + node.right.val
```

### Alternatives
- **Coordinate compression** (`middle.md` §6) collapses 10⁹ to 10⁵ a priori; preferable when all operations are known up front.
- **Order-statistic tree** (`tree_order_statistics_node_update` in GNU PBDS) — log n per op, no implicit allocation tricks.

Use implicit when operations stream in and you can't see them in advance.

---

<a name="wavelet"></a>
## 4. Wavelet Trees — the K-th Smallest Generalization

A **wavelet tree** is a generalization that handles **rank/select on arbitrary alphabets**. For a static array, it answers:

- `count(l, r, val)` — how many elements in `arr[l..r]` equal `val`.
- `count_less(l, r, k)` — how many `< k` in `arr[l..r]`. (Same as merge-sort tree, but O(log n) here.)
- `k_th_smallest(l, r, k)` — the k-th smallest in `arr[l..r]`, in **O(log σ)** where σ is the alphabet size.

Wavelet trees are built bit-by-bit: at each level you partition the array into "value's k-th bit is 0" and "value's k-th bit is 1". With balanced bitvector rank/select (Jacobson 1989), every query is O(log σ).

In competitive programming, wavelet trees subsume merge-sort trees and persistent segment trees for static range-kth queries — usually at slightly higher constants but cleaner asymptotics. Real production uses: **succinct text indexes** (FM-index, the basis of `bwa` and `bowtie2` bioinformatics tools).

We have a dedicated chapter for wavelet trees later in the Roadmap (string algorithms).

---

<a name="sqrt"></a>
## 5. Sqrt Segment Tree (CP Variant)

A pragmatic in-between of pure sqrt decomposition and segment tree: divide the array into blocks of size √n; build a small segment tree of blocks (size √n leaves). Block-internal queries scan the block; cross-block queries traverse the small segment tree.

### Memory
- O(n) — the original array plus √n block aggregates.

### Time
- Point update: O(1) on the element + O(log √n) = O(log n / 2) on the small tree. Faster than a full segment tree in the constant.
- Range query crossing many blocks: O(√n) for the partial blocks + O(log √n) for the inner blocks.

### When it wins
- Updates are extremely frequent and queries are long-range (cover most of the array). Then the O(1) update beats O(log n).
- Memory pressure makes the 4n allocation painful.

Most CP teams skip this variant — segment trees with lazy are easier — but the **Mo's algorithm** family (`09-10`) relies on sqrt-decomposition-based ideas.

---

<a name="rbtree"></a>
## 6. Red-Black Tree Augmentation as a Competitor

For some queries — most notably **order-statistic** ones — a **red-black tree augmented with subtree sizes** beats a segment tree.

### GNU PBDS `tree_order_statistics_node_update`
A C++ extension (`__gnu_pbds::tree<T, null_type, less<T>, rb_tree_tag, tree_order_statistics_node_update>`) gives a sorted set with two extra operations:
- `find_by_order(k)` — k-th smallest element, O(log n).
- `order_of_key(x)` — number of elements < x, O(log n).

These cover "count_less" queries in **a single line of code** with no segment tree needed. Many CP teams default to PBDS for online k-th queries.

### Java `TreeMap` with augmentation
Java's `TreeMap` is red-black, but does **not** expose subtree sizes. You can hand-roll an augmented RB tree in 200 lines, or use Andrew Bennett's `TreapList` library.

### When the RB tree wins
- Online insertion *and* k-th queries: segment trees need coordinate compression up front; RB trees absorb new elements naturally.
- "Top-k by score" leaderboards where the score set is dynamic.

### When segment trees win
- Range updates with lazy.
- Non-comparable aggregates (gcd, xor, matrix product).
- Static range queries with persistence.

### Quick decision
- Online dynamic set + order stats → **PBDS / augmented RB tree**.
- Static or semi-static array + flexible monoid → **segment tree**.

---

Segment trees in 2026 remain the **dominant flexible range-query primitive in algorithmic engineering**: cache-conscious, SIMD-amenable, persistable, parallelizable. The variants in this document are the high-end refinements you apply when you have profiled and the bottleneck is the segment tree itself. Continue with `interview.md` for the 10 LeetCode problems that lock the pattern into muscle memory.
