# Segment Tree — Middle Level

> **Audience:** Engineers who have written a recursive sum segment tree and want the variants that win contests and ship in production. Prerequisite: `junior.md`.

This document covers the **extension family** built on top of the basic recursion: **lazy propagation** for range updates, **monoid generalization** so one skeleton handles sum/min/max/gcd/xor, **segment trees with merging**, the **iterative bottom-up form** for ~2× speedup, **persistent segment trees** (Sleator–Tarjan path copying), **coordinate compression** for billion-wide ranges with thousands of points, **2D segment trees**, and **merge-sort trees** for "count elements < k in a range" queries.

---

## Table of Contents

1. [Lazy Propagation for Range Updates](#lazy)
2. [Monoid Generalization — One Skeleton, Many Aggregates](#monoid)
3. [Segment Tree with Merging (small-to-large)](#merging)
4. [Iterative Bottom-Up Segment Tree](#iterative)
5. [Persistent Segment Tree](#persistent)
6. [Coordinate Compression](#coords)
7. [2D Segment Trees](#two-d)
8. [Merge-Sort Trees](#merge-sort-tree)

---

<a name="lazy"></a>
## 1. Lazy Propagation for Range Updates

The basic segment tree from `junior.md` handles **point updates** in O(log n). What if we need to add `v` to every element in `arr[l..r]` — a **range update** — and still answer range sums in O(log n)?

A naive approach calls point-update `r - l + 1` times, giving O((r - l + 1) · log n) per range update. Lazy propagation reduces this to **O(log n) per range update**.

### 1.1 The idea
When a range update fully covers a node's segment, we **stop descending** and just stamp a *lazy tag* on that node, saying "everyone underneath me also got +v, but I haven't told them yet". When a future query or update needs to descend through this node, we **push down** the tag: apply it to the two children's stored values, propagate the tag onto their lazy slots, and clear the tag on the parent.

This is the same deferral idea as the *amortized accounting method* in CLRS chapter 17 — we charge work to the parent so the children don't pay until forced.

### 1.2 Invariants
1. `tree[v]` always equals the **correct aggregate** over `[lo, hi]` *as if all lazy tags above and including `v` had been applied*.
2. `lazy[v]` represents updates that have been applied to `tree[v]` but **not yet to descendants**.

Maintaining these two invariants is everything.

### 1.3 Range-add / sum query — Python skeleton

```python
class RangeAddSumSegTree:
    """Supports range-add updates and range-sum queries in O(log n) each."""

    def __init__(self, arr):
        self.n = len(arr)
        self.tree = [0] * (4 * self.n)
        self.lazy = [0] * (4 * self.n)
        self._build(1, 0, self.n - 1, arr)

    def _build(self, v, lo, hi, arr):
        if lo == hi:
            self.tree[v] = arr[lo]
            return
        mid = (lo + hi) // 2
        self._build(2*v,     lo,    mid, arr)
        self._build(2*v + 1, mid + 1, hi,  arr)
        self.tree[v] = self.tree[2*v] + self.tree[2*v + 1]

    def _apply(self, v, lo, hi, val):
        # Apply "+val on every element in [lo, hi]" to node v.
        self.tree[v] += val * (hi - lo + 1)
        self.lazy[v] += val

    def _push(self, v, lo, hi):
        if self.lazy[v] != 0:
            mid = (lo + hi) // 2
            self._apply(2*v,     lo,    mid, self.lazy[v])
            self._apply(2*v + 1, mid + 1, hi,  self.lazy[v])
            self.lazy[v] = 0

    def update(self, ql, qr, val):
        self._update(1, 0, self.n - 1, ql, qr, val)

    def _update(self, v, lo, hi, ql, qr, val):
        if qr < lo or hi < ql:
            return
        if ql <= lo and hi <= qr:
            self._apply(v, lo, hi, val)
            return
        self._push(v, lo, hi)
        mid = (lo + hi) // 2
        self._update(2*v,     lo,    mid, ql, qr, val)
        self._update(2*v + 1, mid + 1, hi,  ql, qr, val)
        self.tree[v] = self.tree[2*v] + self.tree[2*v + 1]

    def query(self, ql, qr):
        return self._query(1, 0, self.n - 1, ql, qr)

    def _query(self, v, lo, hi, ql, qr):
        if qr < lo or hi < ql:
            return 0
        if ql <= lo and hi <= qr:
            return self.tree[v]
        self._push(v, lo, hi)
        mid = (lo + hi) // 2
        return (self._query(2*v,     lo,    mid, ql, qr) +
                self._query(2*v + 1, mid + 1, hi,  ql, qr))
```

The new piece is `_apply` (apply a tag to a node) and `_push` (flush to children). All other operations call `_push` before recursing.

### 1.4 Why `val * (hi - lo + 1)` for sum?
Adding `+val` to every element in a segment of length `(hi - lo + 1)` adds `val * (hi - lo + 1)` to the sum. The same node could be "min" instead — for range-add + range-min, the apply formula is `tree[v] += val` (the minimum shifts by `val`).

### 1.5 Combining tags
Two consecutive range-add updates compose by **addition**: `tag_combined = tag_old + tag_new`. For other operations the composition rule differs:

| Operation | Tag composition |
|---|---|
| Range add | `tag = tag + new` |
| Range assign (set) | `tag = new` (overwrite — older tags are erased) |
| Range multiply | `tag = tag * new` |
| Range-add + range-assign mixed | Two tags per node; assign first, then add |

Get the composition wrong and the tree silently produces incorrect answers. Always derive the composition on paper before coding.

### 1.6 Go and Java versions

**Go:**
```go
type LazySum struct {
    n    int
    tree []int64
    lazy []int64
}

func (s *LazySum) apply(v, lo, hi int, val int64) {
    s.tree[v] += val * int64(hi-lo+1)
    s.lazy[v] += val
}

func (s *LazySum) push(v, lo, hi int) {
    if s.lazy[v] != 0 {
        mid := (lo + hi) / 2
        s.apply(2*v,   lo,    mid, s.lazy[v])
        s.apply(2*v+1, mid+1, hi,  s.lazy[v])
        s.lazy[v] = 0
    }
}

func (s *LazySum) Update(ql, qr int, val int64) { s.update(1, 0, s.n-1, ql, qr, val) }
func (s *LazySum) update(v, lo, hi, ql, qr int, val int64) {
    if qr < lo || hi < ql { return }
    if ql <= lo && hi <= qr { s.apply(v, lo, hi, val); return }
    s.push(v, lo, hi)
    mid := (lo + hi) / 2
    s.update(2*v,   lo,    mid, ql, qr, val)
    s.update(2*v+1, mid+1, hi,  ql, qr, val)
    s.tree[v] = s.tree[2*v] + s.tree[2*v+1]
}
```

**Java:**
```java
public final class LazySumSegTree {
    private final int n;
    private final long[] tree, lazy;
    public LazySumSegTree(long[] arr) {
        this.n = arr.length;
        this.tree = new long[4 * n];
        this.lazy = new long[4 * n];
        build(1, 0, n - 1, arr);
    }
    private void apply(int v, int lo, int hi, long val) {
        tree[v] += val * (hi - lo + 1L);
        lazy[v] += val;
    }
    private void push(int v, int lo, int hi) {
        if (lazy[v] != 0) {
            int mid = (lo + hi) >>> 1;
            apply(2 * v,     lo,    mid, lazy[v]);
            apply(2 * v + 1, mid + 1, hi, lazy[v]);
            lazy[v] = 0;
        }
    }
    public void rangeAdd(int l, int r, long v) { upd(1, 0, n - 1, l, r, v); }
    private void upd(int v, int lo, int hi, int ql, int qr, long val) {
        if (qr < lo || hi < ql) return;
        if (ql <= lo && hi <= qr) { apply(v, lo, hi, val); return; }
        push(v, lo, hi);
        int mid = (lo + hi) >>> 1;
        upd(2 * v,     lo,    mid, ql, qr, val);
        upd(2 * v + 1, mid + 1, hi,  ql, qr, val);
        tree[v] = tree[2 * v] + tree[2 * v + 1];
    }
    // build, query, push parallel to Python above.
    private void build(int v, int lo, int hi, long[] a) {
        if (lo == hi) { tree[v] = a[lo]; return; }
        int mid = (lo + hi) >>> 1;
        build(2*v, lo, mid, a); build(2*v+1, mid+1, hi, a);
        tree[v] = tree[2*v] + tree[2*v+1];
    }
}
```

---

<a name="monoid"></a>
## 2. Monoid Generalization — One Skeleton, Many Aggregates

Once you have lazy and basic segment trees, you realize the *only* aggregate-specific code is:

- `IDENTITY` (e.g., `0` for sum, `+∞` for min)
- `combine(a, b)` (e.g., `a + b`, `min(a, b)`)

Wrap these in an interface and the same class handles every monoid.

```python
from dataclasses import dataclass
from typing import Callable, TypeVar, Generic

T = TypeVar("T")

@dataclass
class Monoid(Generic[T]):
    identity: T
    combine: Callable[[T, T], T]

SUM_MONOID = Monoid(0,   lambda a, b: a + b)
MIN_MONOID = Monoid(float("inf"),  lambda a, b: min(a, b))
MAX_MONOID = Monoid(float("-inf"), lambda a, b: max(a, b))
GCD_MONOID = Monoid(0,   lambda a, b: __import__("math").gcd(a, b))

class MonoidSegTree:
    def __init__(self, arr, m: Monoid):
        self.n, self.m = len(arr), m
        self.tree = [m.identity] * (4 * self.n)
        if self.n: self._build(1, 0, self.n - 1, arr)
    def _build(self, v, lo, hi, arr):
        if lo == hi: self.tree[v] = arr[lo]; return
        mid = (lo + hi) // 2
        self._build(2*v, lo, mid, arr); self._build(2*v+1, mid+1, hi, arr)
        self.tree[v] = self.m.combine(self.tree[2*v], self.tree[2*v+1])
    def query(self, ql, qr):
        return self._query(1, 0, self.n - 1, ql, qr)
    def _query(self, v, lo, hi, ql, qr):
        if qr < lo or hi < ql: return self.m.identity
        if ql <= lo and hi <= qr: return self.tree[v]
        mid = (lo + hi) // 2
        return self.m.combine(
            self._query(2*v, lo, mid, ql, qr),
            self._query(2*v+1, mid+1, hi, ql, qr))
    def update(self, idx, val):
        self._update(1, 0, self.n - 1, idx, val)
    def _update(self, v, lo, hi, idx, val):
        if lo == hi: self.tree[v] = val; return
        mid = (lo + hi) // 2
        if idx <= mid: self._update(2*v, lo, mid, idx, val)
        else:          self._update(2*v+1, mid+1, hi, idx, val)
        self.tree[v] = self.m.combine(self.tree[2*v], self.tree[2*v+1])
```

In **Java** the monoid becomes a `BinaryOperator<Long>` plus an identity. In **Go**, generics (added in 1.18) let you write `SegTree[T any]` with a `combine func(T, T) T`. Both forms are about 2× slower than a specialized sum tree (function-call overhead), but they remove duplication and let you swap aggregates by editing one line.

---

<a name="merging"></a>
## 3. Segment Tree with Merging (small-to-large)

A more advanced trick: store at each tree node a **multiset** (sorted list, indexed map, or a small segment tree) of the elements in its segment. Merging two such structures from sibling nodes lets you answer subtree queries by walking the segment tree once.

Common pattern: **dsu-on-tree** ("Sack" / Arpa's trick), used in tree-coloring problems where every subtree must report a statistic.

### Sketch
For each node `v` covering segment `[lo, hi]`, store a sorted list `lst[v]` of `arr[lo..hi]`. Build: `lst[v] = merge(lst[2v], lst[2v+1])`. Total memory: O(n log n). Query "how many values in `arr[l..r]` are < k" → walk the segment tree visiting O(log n) fully-contained nodes; binary-search `k` in each list; sum the counts. Total: **O(log² n)**.

This is also called a **merge-sort tree** (see §8). We use merging here mainly for tree-on-tree problems and offline range-mode queries.

---

<a name="iterative"></a>
## 4. Iterative Bottom-Up Segment Tree

The recursive form is clear but slow because of function-call overhead and cache-jumping. The iterative form fits in 25 lines, runs ~2× faster, and is the default in competitive programming after Stas Bondar (Codeforces handle "Egor") popularized the layout around 2010.

### 4.1 The layout
Pad `n` to a power of two. Leaves live at indices `[n, 2n)`. The parent of leaf `n + i` is `(n + i) / 2`. The root is at `1`.

```
n = 4 (already pow-2). Tree slots:
  1
 2 3
4567   ← leaves are arr[0..3]
```

For `arr = [2, 1, 5, 3]`:
```
tree[1] = 2+1+5+3 = 11
tree[2] = 2+1 = 3,  tree[3] = 5+3 = 8
tree[4..7] = 2, 1, 5, 3
```

### 4.2 Code — point update, range sum

**Python:**
```python
class IterSegTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.tree = [0] * (2 * self.n)
        for i, v in enumerate(arr):
            self.tree[self.n + i] = v
        for i in range(self.n - 1, 0, -1):
            self.tree[i] = self.tree[2*i] + self.tree[2*i + 1]

    def update(self, idx, val):
        i = idx + self.n
        self.tree[i] = val
        i //= 2
        while i:
            self.tree[i] = self.tree[2*i] + self.tree[2*i + 1]
            i //= 2

    def query(self, l, r):                  # inclusive [l, r]
        res, l, r = 0, l + self.n, r + self.n + 1   # [l, r) half-open
        while l < r:
            if l & 1: res += self.tree[l]; l += 1
            if r & 1: r -= 1; res += self.tree[r]
            l //= 2; r //= 2
        return res
```

The query walks from the two boundary leaves upward, collecting nodes that are "right siblings of `l`" and "left siblings of `r`". Each loop iteration consumes one level, so **at most 2·log₂(n) nodes are visited**.

### 4.3 Go and Java

**Go:**
```go
type IterSeg struct{ n int; t []int64 }

func NewIterSeg(a []int64) *IterSeg {
    n := len(a)
    t := make([]int64, 2*n)
    for i, v := range a { t[n+i] = v }
    for i := n - 1; i > 0; i-- { t[i] = t[2*i] + t[2*i+1] }
    return &IterSeg{n, t}
}
func (s *IterSeg) Update(idx int, v int64) {
    i := idx + s.n
    for s.t[i] = v; i > 1; i /= 2 { s.t[i/2] = s.t[i&^1] + s.t[i|1] }
}
func (s *IterSeg) Query(l, r int) int64 {
    res := int64(0)
    for l, r = l+s.n, r+s.n+1; l < r; l, r = l/2, r/2 {
        if l&1 == 1 { res += s.t[l]; l++ }
        if r&1 == 1 { r--; res += s.t[r] }
    }
    return res
}
```

**Java** — almost identical to Go with `int` arrays.

### 4.4 Why faster?
- No function-call overhead.
- Tight register-resident loop.
- Better branch prediction.
- Children of node `i` always at `2i` and `2i+1` — easy for the CPU's hardware prefetcher.

**Caveat:** lazy propagation in the iterative form is **doable but ugly** — you must push down ancestors of both query endpoints in the right order before reading/writing. Most CP teams keep the recursive form for lazy trees.

---

<a name="persistent"></a>
## 5. Persistent Segment Tree

A *persistent* data structure preserves the previous version after each update. Reading version `k` returns the tree as it was after the `k`-th update.

### 5.1 The path-copying trick
Update normally touches O(log n) nodes from root to a leaf. Instead of mutating them, **clone each touched node and link the new node to its unchanged sibling**. The clones form a new root that shares all unchanged subtrees with the previous version.

```
        old_root                new_root
          /  \                    /  \
        L     R     ─update L→  L'    R   ← R is shared
       / \                      / \
      ...                      ...
```

After `k` updates, you have `k` distinct roots, each O(log n) bigger than the previous one. Total memory: **O(n + k log n)**.

### 5.2 Use cases
- **K-th smallest in a static array range** (Bryan Tan / "merge-sort tree replacement"): build one persistent segment tree per array prefix; query `arr[l..r]` by subtracting roots `r` and `l-1`.
- **Time-travel queries** ("what was the sum at version 42?") for editors with undo.
- **Functional databases** with snapshot isolation — every transaction has a unique read-only view.

### 5.3 Python sketch (sum, point update)
```python
class Node:
    __slots__ = ("left", "right", "val")
    def __init__(self, left=None, right=None, val=0):
        self.left, self.right, self.val = left, right, val

def build(lo, hi, arr):
    if lo == hi: return Node(val=arr[lo])
    mid = (lo + hi) // 2
    left, right = build(lo, mid, arr), build(mid + 1, hi, arr)
    return Node(left, right, left.val + right.val)

def update(node, lo, hi, idx, val):
    if lo == hi: return Node(val=val)
    mid = (lo + hi) // 2
    if idx <= mid:
        new_left = update(node.left, lo, mid, idx, val)
        return Node(new_left, node.right, new_left.val + node.right.val)
    new_right = update(node.right, mid + 1, hi, idx, val)
    return Node(node.left, new_right, node.left.val + new_right.val)

# Usage:
roots = [build(0, n - 1, arr)]
roots.append(update(roots[-1], 0, n - 1, 3, 99))   # version 1
```

In **Go** and **Java** the node type is similar (left/right pointers + value). Memory pools and slab allocators are worth applying when `k > 10⁵`.

---

<a name="coords"></a>
## 6. Coordinate Compression

A segment tree's memory is O(n) where n is the **range size**. If queries span `[0, 10⁹]` but there are only 10⁵ distinct interesting positions, allocating 4·10⁹ slots is impossible. The fix: **compress the coordinates**.

### 6.1 Algorithm
1. Collect every coordinate that appears in any operation (queries and updates).
2. Sort and dedupe → an array `coords[0..m-1]` with `m ≤ k`.
3. Replace every original coordinate `x` with its rank `bisect_left(coords, x)`.
4. Build a segment tree of size `m`.

### 6.2 Python
```python
from bisect import bisect_left
def compress(values):
    cs = sorted(set(values))
    return cs, {x: i for i, x in enumerate(cs)}
```

### 6.3 Why it works
Segment trees care only about **the relative order** of indices, never their absolute values. As long as you remember the inverse mapping (`coords[i]` gives back the original value), every operation is preserved.

### 6.4 When to use
- **Sweep-line problems** on real numbers (intervals, rectangles).
- **Histogram-of-events** with floats or huge ints.
- **Range queries over IPs, timestamps, or hashes.**

---

<a name="two-d"></a>
## 7. 2D Segment Trees

A 2D segment tree is a **segment tree of segment trees**: the outer tree indexes rows, and each node of the outer tree holds a **complete segment tree of columns** restricted to the rows in its segment. A rectangle query `[r1..r2] × [c1..c2]` walks O(log R) nodes in the outer tree and, on each, runs an O(log C) inner query. Total: **O(log R · log C)** per query.

### Memory
Naively, **O(R · C · log R)** — sometimes too much. Practical mitigations:
- Build only when first touched (sparse 2D segment tree).
- Use coordinate compression on both axes.

### Use cases
- Rectangle sum on a 1024×1024 grid with point updates (e.g., 2D heatmap).
- Online sweep with vertical scan and 2D updates.

### Code skeleton (Java, rectangle sum + point update)
```java
public final class SegTree2D {
    private final int R, C;
    private final long[][] tree;          // outer × inner

    public SegTree2D(long[][] grid) {
        this.R = grid.length; this.C = grid[0].length;
        this.tree = new long[4 * R][4 * C];
        buildY(1, 0, R - 1, grid);
    }
    private void buildY(int vy, int loY, int hiY, long[][] g) {
        if (loY == hiY) {
            buildX(vy, 1, 0, C - 1, g[loY]); return;
        }
        int midY = (loY + hiY) >>> 1;
        buildY(2*vy,     loY,     midY, g);
        buildY(2*vy + 1, midY + 1, hiY, g);
        mergeX(vy, 1, 0, C - 1);          // merge two inner trees
    }
    // buildX, mergeX, query, update parallel — left as an exercise; see tasks.md.
}
```

---

<a name="merge-sort-tree"></a>
## 8. Merge-Sort Trees

A merge-sort tree is a segment tree where **each node stores the sorted list of its segment's elements**. Built in O(n log n) time and O(n log n) space — the segment of length L at depth `d = log(n/L)` contributes L sorted entries, and the total across all levels is `n · log n`.

### Queries it answers
- *"How many elements in `arr[l..r]` are strictly less than `k`?"* — walk to O(log n) fully-contained nodes; in each, binary-search `k`; sum the counts. **O(log² n)** per query.
- *"Median of `arr[l..r]`"* (with binary search on the answer) — O(log³ n).
- *"K-th smallest in `arr[l..r]`"* — same idea but persistent segment trees do it in O(log n).

### Python skeleton (counts < k in a range)
```python
class MergeSortTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.tree = [None] * (4 * self.n)
        self._build(1, 0, self.n - 1, arr)
    def _build(self, v, lo, hi, arr):
        if lo == hi:
            self.tree[v] = [arr[lo]]; return
        mid = (lo + hi) // 2
        self._build(2*v, lo, mid, arr)
        self._build(2*v + 1, mid + 1, hi, arr)
        # merge two sorted lists
        a, b = self.tree[2*v], self.tree[2*v + 1]
        out, i, j = [], 0, 0
        while i < len(a) and j < len(b):
            if a[i] <= b[j]: out.append(a[i]); i += 1
            else:            out.append(b[j]); j += 1
        out.extend(a[i:]); out.extend(b[j:])
        self.tree[v] = out
    def count_less(self, ql, qr, k):
        return self._cnt(1, 0, self.n - 1, ql, qr, k)
    def _cnt(self, v, lo, hi, ql, qr, k):
        if qr < lo or hi < ql: return 0
        if ql <= lo and hi <= qr:
            from bisect import bisect_left
            return bisect_left(self.tree[v], k)
        mid = (lo + hi) // 2
        return (self._cnt(2*v, lo, mid, ql, qr, k) +
                self._cnt(2*v + 1, mid + 1, hi, ql, qr, k))
```

Use this for **LeetCode 315** (count smaller after self), **LeetCode 327** (count range sum), and offline order-statistic queries. Persistent segment trees beat it for online range k-th queries but merge-sort trees are easier to code.

---

You now have the toolkit for almost every "1-D range with twist" problem you'll see in a contest or in a real-time analytics service. Continue with `senior.md` for production deployment patterns and engineering trade-offs.
