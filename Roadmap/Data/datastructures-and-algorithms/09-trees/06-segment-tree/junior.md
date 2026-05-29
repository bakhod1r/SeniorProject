# Segment Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Students who know recursion, binary trees, and arrays, and now want a data structure that handles range queries and point updates in O(log n).

A **segment tree** is the most flexible "I need fast range queries on a mutable array" data structure in the standard algorithmic toolkit. It answers questions like *"what is the sum of `arr[l..r]`?"* in O(log n) and lets you change any element with `arr[i] = v` also in O(log n), and it generalizes far beyond sums — it handles **min, max, gcd, xor, product, custom monoids, range assignments, range additions, persistent versions, 2D variants, and merge-sort trees** — all with the same skeleton. Once you internalize it, an entire universe of "range" problems becomes routine.

This document teaches the recursive, array-backed segment tree from scratch on a five-element array. We build it, query it, update it, and trace every recursive call. We finish with the formal complexity analysis, the most common bug list, and a cheat sheet you can use forever.

---

## Table of Contents

1. [Introduction — Why a Segment Tree Beats Prefix Sums for Mutable Arrays](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Tree Layout, Identity, Combine](#core-concepts)
5. [Big-O Summary](#big-o)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons (vs Prefix Sums, vs Fenwick)](#pros-cons)
8. [Step-by-Step Walkthrough on `[2, 1, 5, 3, 4]`](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — The Three-Way Trichotomy](#patterns)
11. [Error Handling](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why a Segment Tree Beats Prefix Sums for Mutable Arrays

Imagine you have an array of `n = 1,000,000` integers — say, daily transaction totals for a bank — and you need to support two operations interleaved millions of times per second:

1. **Range query:** *"What is the sum of `arr[l..r]`?"* (e.g., "total transactions in week 18".)
2. **Point update:** *"Set `arr[i] = v`."* (a correction is posted.)

Three obvious approaches:

| Approach | Query | Update | When it wins |
|---|---|---|---|
| **Raw array** | O(n) per query | O(1) | When updates dominate massively |
| **Prefix-sum array** `pre[i] = arr[0]+...+arr[i-1]` | O(1) | O(n) to rebuild | When the array never changes |
| **Segment tree** | O(log n) | O(log n) | When both operations are frequent |

For `n = 1,000,000`:
- Raw array: ~10⁶ ops per query — at 10⁹ ops/s, 1 ms per query.
- Prefix-sum: instant query but rebuild is ~10⁶ ops, so any update destroys throughput.
- **Segment tree: ~20 ops per query, ~20 ops per update**, regardless of n. That is a ~50,000× speedup over the raw array, and unlike prefix sums it stays fast when the data mutates.

A segment tree is a **complete binary tree** where each node stores an **aggregate** (sum, min, max, gcd, ...) over a contiguous segment `[lo, hi]` of the original array. The root covers `[0, n-1]`. A node covering `[lo, hi]` with `lo < hi` has two children: the **left child** covers `[lo, mid]` and the **right child** covers `[mid+1, hi]`, where `mid = (lo + hi) / 2`. Leaves cover a single element `[i, i]`. To answer a range query you traverse the tree, taking only the nodes whose segments are fully inside the query range (and recursing on the partial ones). To update an element you walk from the root down to the relevant leaf, fixing aggregates along the way.

Segment trees were introduced by **Jon Bentley in 1977** for solving geometric problems (the so-called Klee's measure problem), and they were systematized in **Mark de Berg et al., *Computational Geometry: Algorithms and Applications*, Chapter 10**. In modern competitive programming they are the **default** for any range-query problem more interesting than "static sum".

---

<a name="prerequisites"></a>
## 2. Prerequisites

To get the most out of this document you should be comfortable with:

1. **Binary trees.** A node has up to two children. Heights, leaves, and recursion on trees should feel natural.
2. **Recursion.** Most segment-tree code recurses on `(node, lo, hi)`. The control flow is the same shape as quicksort and tree traversal.
3. **Arrays and indexing.** We will store the tree in a flat array of size `4n`, with the root at index `1` and children of node `i` at `2i` and `2i+1`.
4. **Big-O for trees.** Knowing why a balanced binary tree has height O(log n) is essential for the complexity argument.
5. **(Optional) Prefix sums.** The pedagogical contrast in §1 will land harder if you have written a prefix-sum solution before.

If any of these is shaky, review the corresponding sections of the **05 (basic data structures)** and **09-01 (binary trees)** folders in this Roadmap first.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Segment** | A contiguous range `[lo, hi]` of array indices that one tree node represents. |
| **Node range** | Same as segment — the `[lo, hi]` pair attached to a node. |
| **Leaf** | A node whose segment has `lo == hi`. It stores exactly one array element. |
| **Internal node** | A node with two children; stores the aggregate of its segment, computed from its children. |
| **Aggregate / value** | The combined result stored at a node — e.g., sum, min, max, gcd. |
| **Identity** | The neutral element of the aggregate. `0` for sum, `+∞` for min, `−∞` for max, `0` for gcd, `1` for product. |
| **Combine / merge** | The associative operation that fuses two child aggregates into the parent's. For sums: `a + b`. For min: `min(a, b)`. |
| **Pull-up** | After updating a child, recompute the parent: `tree[v] = combine(tree[2v], tree[2v+1])`. |
| **Push-down** | (Lazy propagation, `middle.md`.) Before descending, flush a pending update from a parent to its children. |
| **Lazy tag** | A deferred update stored at a node, applied later only when needed. |
| **Build** | Construct the tree from an input array in O(n). |
| **Point update** | Change a single element `arr[i] := v`. |
| **Range update** | Change every element in `arr[l..r]` (needs lazy propagation; see `middle.md`). |
| **Range query** | Return the aggregate over `arr[l..r]`. |
| **`4n` rule** | Allocate `4 * n` slots for the tree array — guaranteed to fit any segment tree on n elements. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Tree Layout, Identity, Combine

### 4.1 The tree as a flat array

A complete binary tree can live in an array. We use **1-indexed** storage: the root is at index `1`. For a node at index `v`:

- Left child: `2*v`
- Right child: `2*v + 1`
- Parent: `v / 2` (integer division)

The reason this works is that level `k` of a complete binary tree contains indices `[2^k, 2^(k+1) - 1]`, and children sit at consecutive doubled indices. (See `09-01-binary-tree` for the heap-style layout proof.)

### 4.2 Why size `4n`?

When `n` is not a power of two, the tree is "ragged" — some leaves sit one level lower than others. The deepest level can be twice as wide as expected. A standard upper bound: **`2 * next_power_of_two(n)`** slots. To avoid computing the next power of two, we just use `4n`. That is always safe and wastes at most ~50% of slots.

```
n = 5  →  next pow 2 = 8  →  need 16 slots  →  4*5 = 20 ✓
n = 7  →  next pow 2 = 8  →  need 16 slots  →  4*7 = 28 ✓
n = 8  →  next pow 2 = 8  →  need 16 slots  →  4*8 = 32 ✓
```

### 4.3 The recursive recipe — three branches

Every segment-tree operation (build, update, query) follows the same recursion. At a node covering `[lo, hi]` you ask:

```
combine(left_child_result, right_child_result)
```

For a **query** over `[ql, qr]`:

| Case | Action |
|---|---|
| `[lo, hi]` is fully outside `[ql, qr]` (`hi < ql` or `lo > qr`) | Return the **identity** (0 for sum). Contributes nothing. |
| `[lo, hi]` is fully inside `[ql, qr]` (`ql <= lo && hi <= qr`) | Return `tree[v]`. No need to recurse — the node already aggregates exactly the segment we want. |
| Otherwise (**partial overlap**) | Recurse on both children and combine the results. |

This trichotomy is the **heart** of every segment tree operation. Internalize it.

### 4.4 Build is bottom-up via recursion

```
build(v, lo, hi):
    if lo == hi:
        tree[v] = arr[lo]                        # leaf
        return
    mid = (lo + hi) / 2
    build(2v, lo, mid)
    build(2v+1, mid+1, hi)
    tree[v] = combine(tree[2v], tree[2v+1])      # pull-up
```

Time: each node is touched once. Total nodes ≤ 2 * 2^⌈log₂ n⌉ ≤ 4n, so **build is O(n)**.

### 4.5 Update is top-down with a pull-up

```
update(v, lo, hi, idx, val):
    if lo == hi:
        tree[v] = val                            # leaf — apply
        return
    mid = (lo + hi) / 2
    if idx <= mid:
        update(2v, lo, mid, idx, val)
    else:
        update(2v+1, mid+1, hi, idx, val)
    tree[v] = combine(tree[2v], tree[2v+1])      # fix ancestor
```

We descend from the root to the leaf at position `idx`, then on the way back up we recompute every ancestor's aggregate. Path length is O(log n), so **update is O(log n)**.

### 4.6 Query is the three-branch recursion

```
query(v, lo, hi, ql, qr):
    if qr < lo or hi < ql: return IDENTITY       # disjoint
    if ql <= lo and hi <= qr: return tree[v]     # contained
    mid = (lo + hi) / 2                          # partial
    return combine(
        query(2v,   lo,    mid, ql, qr),
        query(2v+1, mid+1, hi,  ql, qr)
    )
```

A classical proof shows that the recursion visits at most **4·⌈log₂ n⌉** nodes: at each level there are at most two "partial overlap" nodes, and they contribute one "contained" sibling each. So **query is O(log n)**.

### 4.7 The combine function and its identity

| Aggregate | Combine `f(a, b)` | Identity |
|---|---|---|
| Sum | `a + b` | `0` |
| Min | `min(a, b)` | `+∞` |
| Max | `max(a, b)` | `-∞` |
| Product (mod p) | `(a * b) % p` | `1` |
| GCD | `gcd(a, b)` | `0` |
| XOR | `a ^ b` | `0` |
| Bitwise OR | `a | b` | `0` |
| Bitwise AND | `a & b` | `~0` (all ones) |
| Set union (small sets) | `a ∪ b` | `∅` |

**Requirement:** the operation must be **associative** — `f(a, f(b, c)) = f(f(a, b), c)` — because the tree groups children left-to-right. (It does **not** need to be commutative; segment trees preserve order, which lets you store, e.g., matrix products for "range matrix multiplication" queries.)

---

<a name="big-o"></a>
## 5. Big-O Summary

| Operation | Time | Space |
|---|---|---|
| **Build** from array of size n | **O(n)** | O(n) — the `4n` array |
| **Point update** | **O(log n)** | O(log n) recursion stack |
| **Point query** (get one element) | O(log n) | O(log n) |
| **Range query** | **O(log n)** — at most ~4 log₂ n nodes visited | O(log n) |
| **Range update** (with lazy, `middle.md`) | O(log n) | O(log n) |
| **Total memory** | **4n** slots, each holding one aggregate | — |

For `n = 10⁶`: about 4·20 = 80 node visits per query. At ~ns per visit, that is **80 ns per query** — about 12 million queries per second on a single core.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 A pyramid of daily, weekly, monthly summaries
A bank materializes hierarchical sums of transactions: each leaf is one day's total, parents are weekly totals, grandparents are monthly, great-grandparents are quarterly. To get "total in the last 47 days" you do **not** sum 47 individual days — you grab the relevant monthly nodes, plus a couple of weekly ones, plus a couple of daily leftovers, totaling ~log₂(47) ≈ 6 node reads. Each posting updates exactly one daily leaf and walks up to fix the parents. That is a segment tree.

### 6.2 OLAP cube roll-up
OLAP databases (analytic warehouses) **pre-aggregate** sales by region, by product category, by week, by quarter. Querying "Q4 sales in North America" reads the matching pre-aggregated cell instead of scanning every transaction. Segment trees are the 1-D, mutable version of this idea.

### 6.3 Real-time leaderboards
A game leaderboard with 1 M players supports "what is my rank?" (range count) and "I just gained XP" (point update). A segment tree indexed by score gives both in O(log n). We cover this in `senior.md`.

### 6.4 Streaming volume bars
A trading dashboard shows the moving-window sum of trade volume per second. Each new tick is a point insert; each "last N seconds" question is a range query. Segment tree → constant-bound 20-node touches per question.

---

<a name="pros-cons"></a>
## 7. Pros and Cons (vs Prefix Sums, vs Fenwick)

### Pros
- **Both queries and updates in O(log n).** Prefix-sum arrays only do queries fast; raw arrays only do updates fast. Segment trees give you both.
- **Generic.** Plug in any associative combine — sum, min, max, gcd, xor, matrix product, set union of small sets. The skeleton is identical.
- **Range updates with lazy propagation** (`middle.md`). Hard or impossible for Fenwick.
- **Persistent versions** are straightforward — see `professional.md`.
- **2D and higher.** A "segment tree of segment trees" gives O(log² n) rectangle queries (`middle.md`).
- **Works on arbitrary monoids.** Anywhere you can define `combine` and `identity` you have a segment tree.

### Cons (vs Fenwick Tree, covered in `09-07-fenwick-tree`)
- **More memory.** Segment tree: 4n slots. Fenwick: exactly n. For static sums on a billion ints, Fenwick wins by 4× on RAM.
- **Larger constants.** Fenwick uses ~2 bit-tricks per step. Segment tree uses 4 function calls per step. Fenwick is typically **2–3× faster** for prefix sums.
- **More code.** A Fenwick tree fits in 10 lines; a segment tree with lazy is 60+.
- **Cache-unfriendly recursion.** The recursive form jumps around memory. Iterative form (`middle.md`) recovers most of the locality.

### Cons (vs Prefix Sum Array)
- **Worse query constant** when the array never changes — prefix sum is O(1) per query.
- **More memory and code.**

### Decision matrix
| Need | Use |
|---|---|
| Static array, only sum queries | **Prefix sum** |
| Mutable array, only prefix sums or single-point updates | **Fenwick tree** |
| Mutable array, arbitrary range aggregate (min/max/gcd/...) | **Segment tree** |
| Mutable array, range updates AND range queries | **Segment tree with lazy** |
| Need history of all past versions | **Persistent segment tree** |

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough on `[2, 1, 5, 3, 4]`

Let `n = 5`, `arr = [2, 1, 5, 3, 4]`, aggregate = sum.

### 8.1 Build

The recursion partitions `[0, 4]`:

```
                  [0,4]=15
                 /        \
          [0,2]=8         [3,4]=7
          /     \         /     \
     [0,1]=3   [2,2]=5  [3,3]=3 [4,4]=4
     /    \
 [0,0]=2 [1,1]=1
```

Stored in a 1-indexed array of size 4n = 20 (we only use 11 of those):

| `v` | Segment | Value |
|---|---|---|
| 1 | `[0,4]` | 15 |
| 2 | `[0,2]` | 8 |
| 3 | `[3,4]` | 7 |
| 4 | `[0,1]` | 3 |
| 5 | `[2,2]` | 5 |
| 6 | `[3,3]` | 3 |
| 7 | `[4,4]` | 4 |
| 8 | `[0,0]` | 2 |
| 9 | `[1,1]` | 1 |

Notice node `5` is a leaf at depth 2 while node `8` and `9` are leaves at depth 3 — that is the "ragged" shape from §4.2.

### 8.2 Query `sum(arr[1..3])` — expected `1 + 5 + 3 = 9`

Call `query(v=1, lo=0, hi=4, ql=1, qr=3)`:

```
v=1, [0,4]: partial overlap → recurse both children
├─ v=2, [0,2]: partial → recurse both
│  ├─ v=4, [0,1]: partial → recurse both
│  │  ├─ v=8, [0,0]: fully outside (0 < 1) → return 0
│  │  └─ v=9, [1,1]: fully inside → return 1
│  │  combine: 0 + 1 = 1
│  └─ v=5, [2,2]: fully inside → return 5
│  combine: 1 + 5 = 6
└─ v=3, [3,4]: partial → recurse both
   ├─ v=6, [3,3]: fully inside → return 3
   └─ v=7, [4,4]: fully outside (4 > 3) → return 0
   combine: 3 + 0 = 3
combine top: 6 + 3 = 9 ✓
```

Total nodes visited: 9 out of 9 — small `n` makes the bound loose, but for `n = 10⁶` we would visit at most ~80.

### 8.3 Update `arr[2] += 10` (so `arr[2]` becomes 15)

We model "add 10 to a single position" as `update(idx=2, delta=+10)` (for an in-place set, take `val` and overwrite). Walk down to the leaf at `[2,2]`, then pull up:

```
update(v=1, [0,4], idx=2, +10):
   mid = 2,   idx=2 <= 2 → go left
   update(v=2, [0,2], +10):
      mid = 1,   idx=2 > 1 → go right
      update(v=5, [2,2], +10):
         leaf — tree[5] += 10  → 15
      tree[2] = tree[4] + tree[5] = 3 + 15 = 18
   tree[1] = tree[2] + tree[3] = 18 + 7 = 25
```

Tree after:

```
                  [0,4]=25
                 /        \
          [0,2]=18        [3,4]=7
          /     \         /     \
     [0,1]=3  [2,2]=15  [3,3]=3 [4,4]=4
     /    \
 [0,0]=2 [1,1]=1
```

### 8.4 Re-query `sum(arr[1..3])`

Same traversal as before, but `tree[5]` is now 15, so the answer is `1 + 15 + 3 = 19`. The update completed in 3 leaf-to-root steps, the re-query in ~9 node visits — both fast.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Recursive sum segment tree

#### Go
```go
package segtree

// SumSegTree is a sum-aggregating segment tree backed by a flat slice.
type SumSegTree struct {
    n    int
    tree []int64
}

func NewSumSegTree(arr []int64) *SumSegTree {
    n := len(arr)
    st := &SumSegTree{n: n, tree: make([]int64, 4*max(n, 1))}
    if n > 0 {
        st.build(1, 0, n-1, arr)
    }
    return st
}

func (st *SumSegTree) build(v, lo, hi int, arr []int64) {
    if lo == hi {
        st.tree[v] = arr[lo]
        return
    }
    mid := (lo + hi) / 2
    st.build(2*v,   lo,    mid, arr)
    st.build(2*v+1, mid+1, hi,  arr)
    st.tree[v] = st.tree[2*v] + st.tree[2*v+1]
}

// Update sets arr[idx] = val.
func (st *SumSegTree) Update(idx int, val int64) { st.update(1, 0, st.n-1, idx, val) }
func (st *SumSegTree) update(v, lo, hi, idx int, val int64) {
    if lo == hi {
        st.tree[v] = val
        return
    }
    mid := (lo + hi) / 2
    if idx <= mid {
        st.update(2*v, lo, mid, idx, val)
    } else {
        st.update(2*v+1, mid+1, hi, idx, val)
    }
    st.tree[v] = st.tree[2*v] + st.tree[2*v+1]
}

// Query returns sum of arr[ql..qr] inclusive.
func (st *SumSegTree) Query(ql, qr int) int64 { return st.query(1, 0, st.n-1, ql, qr) }
func (st *SumSegTree) query(v, lo, hi, ql, qr int) int64 {
    if qr < lo || hi < ql {
        return 0 // identity for sum
    }
    if ql <= lo && hi <= qr {
        return st.tree[v]
    }
    mid := (lo + hi) / 2
    return st.query(2*v, lo, mid, ql, qr) +
        st.query(2*v+1, mid+1, hi, ql, qr)
}

func max(a, b int) int { if a > b { return a }; return b }
```

#### Java
```java
public final class SumSegTree {
    private final int n;
    private final long[] tree;

    public SumSegTree(long[] arr) {
        this.n = arr.length;
        this.tree = new long[Math.max(4 * n, 4)];
        if (n > 0) build(1, 0, n - 1, arr);
    }

    private void build(int v, int lo, int hi, long[] arr) {
        if (lo == hi) { tree[v] = arr[lo]; return; }
        int mid = (lo + hi) >>> 1;
        build(2 * v,     lo,    mid, arr);
        build(2 * v + 1, mid + 1, hi, arr);
        tree[v] = tree[2 * v] + tree[2 * v + 1];
    }

    /** Sets arr[idx] = val. */
    public void update(int idx, long val) { update(1, 0, n - 1, idx, val); }
    private void update(int v, int lo, int hi, int idx, long val) {
        if (lo == hi) { tree[v] = val; return; }
        int mid = (lo + hi) >>> 1;
        if (idx <= mid) update(2 * v,     lo,    mid, idx, val);
        else            update(2 * v + 1, mid + 1, hi, idx, val);
        tree[v] = tree[2 * v] + tree[2 * v + 1];
    }

    /** Sum of arr[ql..qr] inclusive. */
    public long query(int ql, int qr) { return query(1, 0, n - 1, ql, qr); }
    private long query(int v, int lo, int hi, int ql, int qr) {
        if (qr < lo || hi < ql) return 0L;
        if (ql <= lo && hi <= qr) return tree[v];
        int mid = (lo + hi) >>> 1;
        return query(2 * v,     lo,    mid, ql, qr)
             + query(2 * v + 1, mid + 1, hi, ql, qr);
    }
}
```

#### Python
```python
class SumSegTree:
    """Sum-aggregating segment tree. Sorted indices [0..n-1]."""

    def __init__(self, arr):
        self.n = len(arr)
        self.tree = [0] * max(4 * self.n, 4)
        if self.n:
            self._build(1, 0, self.n - 1, arr)

    def _build(self, v, lo, hi, arr):
        if lo == hi:
            self.tree[v] = arr[lo]
            return
        mid = (lo + hi) // 2
        self._build(2 * v,     lo,    mid, arr)
        self._build(2 * v + 1, mid + 1, hi, arr)
        self.tree[v] = self.tree[2 * v] + self.tree[2 * v + 1]

    def update(self, idx: int, val: int) -> None:
        """arr[idx] = val."""
        self._update(1, 0, self.n - 1, idx, val)

    def _update(self, v, lo, hi, idx, val):
        if lo == hi:
            self.tree[v] = val
            return
        mid = (lo + hi) // 2
        if idx <= mid:
            self._update(2 * v,     lo,    mid, idx, val)
        else:
            self._update(2 * v + 1, mid + 1, hi, idx, val)
        self.tree[v] = self.tree[2 * v] + self.tree[2 * v + 1]

    def query(self, ql: int, qr: int) -> int:
        """Sum of arr[ql..qr] inclusive."""
        return self._query(1, 0, self.n - 1, ql, qr)

    def _query(self, v, lo, hi, ql, qr):
        if qr < lo or hi < ql:
            return 0
        if ql <= lo and hi <= qr:
            return self.tree[v]
        mid = (lo + hi) // 2
        return (self._query(2 * v,     lo,    mid, ql, qr) +
                self._query(2 * v + 1, mid + 1, hi, ql, qr))
```

### 9.2 Swapping in min/max/gcd/xor

The skeleton is identical — only the **combine** and **identity** change.

```python
# Min segment tree
INF = float("inf")
def combine_min(a, b): return min(a, b)
IDENTITY_MIN = INF

# Max segment tree
NEG_INF = float("-inf")
def combine_max(a, b): return max(a, b)
IDENTITY_MAX = NEG_INF

# GCD segment tree
from math import gcd
def combine_gcd(a, b): return gcd(a, b)
IDENTITY_GCD = 0          # gcd(0, x) = x, so 0 is the identity

# XOR segment tree
def combine_xor(a, b): return a ^ b
IDENTITY_XOR = 0
```

We refactor to a generic monoid in `tasks.md` task 6.

---

<a name="patterns"></a>
## 10. Coding Patterns — The Three-Way Trichotomy

Every segment tree query/update follows the same shape:

```
def descend(v, lo, hi, ...):
    # 1. Disjoint — return identity / do nothing
    if disjoint([lo, hi], target):
        return IDENTITY

    # 2. Contained — read or write the whole subtree in O(1)
    if contained([lo, hi], target):
        return tree[v]

    # 3. Partial — recurse on both children, combine
    mid = (lo + hi) // 2
    return combine(
        descend(2 * v,     lo,    mid, ...),
        descend(2 * v + 1, mid + 1, hi, ...)
    )
```

This pattern repeats for **build** (where target is implicitly the whole array), **point update** (where target is a single index, so one of the two child recursions skips immediately), **range query** (target is `[ql, qr]`), and **range update with lazy** (`middle.md`). Once you see it, every variant becomes the same five-line spine with different details.

---

<a name="errors"></a>
## 11. Error Handling

| Error | Cause | Fix |
|---|---|---|
| `IndexOutOfBounds` on `tree[2*v]` | Allocated only `2n` instead of `4n` | Use `4 * max(n, 1)`. |
| Off-by-one when `hi == lo - 1` | Building on empty subarray | Special-case `n == 0` before calling `build`. |
| Stack overflow on huge `n` | Deep recursion | Use iterative segment tree (`middle.md`) for `n > 5·10⁵` in Python or single-threaded JVM. |
| Wrong answer for queries crossing the array | Forgot disjoint check | Always check `qr < lo or hi < ql` **first**. |
| Update visible only at leaf | Forgot pull-up | After the recursive call, set `tree[v] = combine(tree[2v], tree[2v+1])`. |
| Garbage when `ql > qr` | Invalid query | Reject or swap before recursing. |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Use the iterative bottom-up form for ~2× speedup** when you don't need lazy propagation. See `middle.md`.
2. **Allocate the `tree` array once**, not per operation. Don't realloc inside a hot loop.
3. **Use primitive `long`/`int64`** in Java/Go to avoid autoboxing.
4. **Increase the recursion limit in Python** with `sys.setrecursionlimit(10**6)` for `n > 10⁴`, or switch to the iterative form.
5. **Inline the combine** for sums — `a + b` is faster than calling a function pointer.
6. **Pre-pad your array to a power of two** if you build many segment trees; halves the special-casing.
7. **Reuse the structure across test cases** by writing a `reset()` instead of allocating fresh.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always allocate `4 * n`** (or `2 * nextPow2(n)`), never `2 * n`. The latter under-allocates for non-power-of-two sizes.
- **Document the aggregate and identity** at the top of the file. Future-you will not remember whether the tree stores sums or XORs.
- **Test with `n = 1`, `n = 2`, `n = 3`** — these reveal off-by-one bugs that `n = 16` hides.
- **Unit-test against a brute-force O(n)** reference on random inputs.
- **Choose 1-indexed storage with root = 1.** Doubling and child math are simpler.
- **Use 64-bit integers for sum aggregates** — even with 10⁵ ints up to 10⁹, the total can exceed 2³¹.
- **Keep `lo`/`hi` inclusive on both sides.** Mixing inclusive/exclusive is a footgun.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected behavior |
|---|---|---|
| Single-element array, query `[0,0]` | `arr=[7]`, query(0,0) | Returns `7` |
| Query equals one position | `arr=[2,1,5,3,4]`, query(2,2) | Returns `5` |
| Query covers whole array | query(0,4) | Returns root |
| Query `ql > qr` | query(3,1) | Reject or return identity |
| Empty array | `n=0` | Avoid building; all queries return identity |
| `n` not a power of two | `n=5,7,11` | Works due to `4n` allocation |
| Sum overflow | 10⁵ ints of value 10⁹ | Use `int64`/`long` |
| Update to same value | Set `arr[2] = arr[2]` | Touches log n nodes harmlessly |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Allocating `2n` instead of `4n`.** Works on powers of two; silently corrupts memory on other sizes.
2. **Off-by-one on the disjoint check.** Writing `qr <= lo` instead of `qr < lo` cuts off a valid index.
3. **Forgetting the pull-up after update.** The leaf gets the new value but parents stay stale.
4. **Using mutable arguments by reference incorrectly.** In Python, passing the recursion stack as a `[lo, hi, v]` list and mutating it instead of allocating fresh — leads to confusing bugs.
5. **Using `int` (32-bit) for sum aggregates.** Overflow silently produces negatives.
6. **Querying with `(l, r)` half-open vs `(l, r)` inclusive without checking the convention.** Pick one; stick to it.
7. **Recomputing children inside `query`.** Don't update during a query — that turns O(log n) into O(n).
8. **Mixing min and sum in the same tree.** A node stores one aggregate; you need two trees for two queries.
9. **Confusing 0-indexed array `arr` with 1-indexed tree `tree`.** `arr[lo]` is the original element; `tree[v]` is the aggregate at node `v`.
10. **Forgetting to handle `n == 0`.** Empty input is a real edge case in competitive problems.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
ALLOCATE
    tree = new T[4 * n]
    root = node 1, covering [0, n-1]
    child(v) = 2v (left), 2v+1 (right)

BUILD(v, lo, hi)
    if lo == hi: tree[v] = arr[lo]; return
    mid = (lo + hi) / 2
    BUILD(2v,   lo,    mid)
    BUILD(2v+1, mid+1, hi)
    tree[v] = combine(tree[2v], tree[2v+1])

POINT UPDATE(v, lo, hi, idx, val)
    if lo == hi: tree[v] = val; return
    mid = (lo + hi) / 2
    if idx <= mid: UPDATE(2v, lo, mid, idx, val)
    else:          UPDATE(2v+1, mid+1, hi, idx, val)
    tree[v] = combine(tree[2v], tree[2v+1])

RANGE QUERY(v, lo, hi, ql, qr)
    if qr < lo or hi < ql: return IDENTITY            # disjoint
    if ql <= lo and hi <= qr: return tree[v]          # contained
    mid = (lo + hi) / 2                               # partial
    return combine(
        QUERY(2v,   lo,    mid, ql, qr),
        QUERY(2v+1, mid+1, hi,  ql, qr))

COMPLEXITY
    Build: O(n)
    Update: O(log n)
    Query: O(log n)
    Space: O(n) — 4n slots

COMBINE / IDENTITY
    sum:  a+b, 0     min: min(a,b), +inf
    max:  max(a,b), -inf    gcd: gcd(a,b), 0
    xor:  a^b, 0     prod: a*b, 1
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the segment tree as a binary tree on a dark canvas, each node showing its `[lo, hi]` range and current aggregate. Buttons let you **Build** from a custom array, **Point Update** (index + new value), and **Range Query** (l, r). During each operation it highlights visited nodes — green for fully-contained, red for fully-outside, yellow for partial-overlap — and shows the running aggregate in a side panel. A stat strip tracks array size, total tree nodes, last operation, and comparisons performed. Step through a query on a 7-element array once and the trichotomy will be permanent.

---

<a name="summary"></a>
## 18. Summary

- A segment tree is a complete binary tree where each node aggregates a contiguous segment of the original array.
- Build is **O(n)**; point update and range query are **O(log n)** — at most ~4·log₂ n node visits each.
- Store the tree in a flat array of size **4n**, root at index 1, children of `v` at `2v` and `2v+1`.
- Every operation follows the **three-way trichotomy**: fully disjoint → identity; fully contained → node value; partial → recurse both children and combine.
- The same skeleton handles **sum, min, max, gcd, xor**, and any associative monoid — just swap the `combine` and `identity`.
- Compared to prefix-sum arrays, segment trees support updates. Compared to Fenwick trees, segment trees are more flexible but use more memory and have larger constants.

Master this and you have the foundation for lazy propagation, persistent segment trees, 2D segment trees, merge-sort trees, and every advanced range-query data structure ever shipped to a contest or a database.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Bentley**, J.L., *Solutions to Klee's Rectangle Problems* (Carnegie-Mellon, 1977). The original segment tree paper, in a computational-geometry setting.
- **de Berg, Cheong, van Kreveld, Overmars**, *Computational Geometry: Algorithms and Applications*, 3rd ed., Chapter 10. The textbook treatment of segment trees and interval trees.
- **CP-Algorithms.com** — `https://cp-algorithms.com/data_structures/segment_tree.html`. The most-used segment tree tutorial in competitive programming; covers lazy, persistent, 2D, and iterative forms.
- **Antti Laaksonen**, *Competitive Programmer's Handbook*, Chapter 28. Free PDF; clean code and exercises.
- **Codeforces EDU** — "ITMO Academy: Segment Tree" course (parts 1 and 2). Interactive problem set graded by judge.
- Continue with `middle.md` for lazy propagation, iterative form, 2D, merge-sort trees, and persistent variants.
