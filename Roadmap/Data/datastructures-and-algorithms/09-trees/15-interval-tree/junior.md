# Interval Tree — Junior Level

> **Read time: ~40 minutes** · **Audience:** Students who know binary search trees and have heard the term "augmented data structure" but have never built one. You will leave understanding why a calendar application can find every meeting that overlaps a given hour in O(log n + k) rather than scanning every event.

An **interval tree** is a data structure that stores a dynamic set of closed intervals `[lo, hi]` and supports the question: *given a query interval (or point), report every stored interval that overlaps it*. The naive approach — scan the entire list — costs O(n) per query. An interval tree answers the same question in **O(log n + k)** time, where `k` is the number of intervals actually reported. For a calendar with 100,000 events, that is the difference between checking 100,000 records and checking ~17 + (however many actually overlap). It is one of the foundational structures of computational geometry, and the Linux kernel uses it for virtual-memory-area lookups.

This document teaches **two** standard variants in depth:

1. The **augmented BST interval tree** described in CLRS section 14.3 — a red-black tree ordered by interval low-endpoint, augmented with a `max-high` field per subtree.
2. The **centered interval tree** introduced by Edelsbrunner (1980) and McCreight — pick a pivot point per node, partition intervals into "left of pivot", "contains pivot", "right of pivot".

You will build both in Go, Java, and Python, walk through a worked example by hand, and learn the edge cases (open vs closed intervals, touching endpoints, augmentation maintenance) that bite production code.

---

## Table of Contents

1. [Introduction — Overlap queries in O(log n + k)](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — two flavors of interval tree](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Centered Interval Tree (McCreight variant)](#centered)
11. [Coding Patterns](#patterns)
12. [Error Handling — Open vs Closed Intervals](#errors)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases](#edge-cases)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation Reference](#animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Overlap queries in O(log n + k)

You are writing a calendar app. The user clicks on **Tuesday, 14:30**, and you need to display every meeting that is currently happening at that moment. The user might also drag-select **14:00 to 15:30** and ask "show me every meeting that overlaps this window". You have 100,000 events in the database.

The naive solution is to scan every event and check `event.start <= queryEnd && event.end >= queryStart`. That is O(n), and if the user is panning the timeline by 15-minute increments, you do this hundreds of times per session. At n = 100,000 the lag becomes visible; at n = 10 million it is unusable.

An interval tree fixes this. After building the structure in O(n log n), each overlap query runs in O(log n + k), where `k` is the number of overlapping intervals the query actually returns. For a typical calendar query that returns 3 meetings out of 100,000, you visit roughly 17 + 3 = 20 tree nodes instead of 100,000. That is a 5,000× speedup, and it is the difference between a feature that ships and a feature that gets cut.

Two well-studied designs achieve this bound:

- **CLRS augmented red-black tree** (section 14.3 of *Introduction to Algorithms*) — a normal BST keyed by the low endpoint, with each node augmented with `subtreeMax = max(high)` over its subtree. The augmentation lets the overlap-search routine prune entire subtrees that cannot possibly overlap the query.
- **Edelsbrunner's centered interval tree** (1980) — recursively pick a center point; intervals strictly left of center go to the left child, strictly right go to the right child, and intervals containing the center are kept at the node sorted twice (by low ascending, by high descending).

Both are O(log n + k); they differ in trade-offs we will cover. The CLRS variant is dynamic (cheap insert/delete via red-black rotations); the centered variant is static but slightly faster for query-heavy workloads.

This is **not** the same as a **segment tree**, which stores points and answers range-sum / range-min / lazy-update queries over a fixed integer domain. Segment trees and interval trees are distinct structures with overlapping names and frequent confusion — see section 4.5.

---

<a name="prerequisites"></a>
## 2. Prerequisites

Before reading on, you should already know:

1. **Binary search trees.** Insertion, deletion, in-order traversal, the BST property (`left.key < node.key <= right.key`). A pass through any introductory BST chapter is enough.
2. **The idea of augmenting a tree.** An *augmentation* is extra information stored at each node, derived from the node's subtree, that is maintained as the tree mutates. Subtree size is the most common example (used for "rank" / "k-th smallest" queries). Interval trees augment each node with the maximum high-endpoint in its subtree.
3. **Big-O notation including output-sensitive complexity.** O(log n + k) means the cost depends both on the size of the structure *and* on the size of the answer. Such bounds are called **output-sensitive** and are common in computational geometry.
4. **Red-black trees, at the level of "they exist and self-balance in O(log n) per operation".** You do not need to implement RB rotations from memory; we will use a plain BST for clarity and note where RB augmentation goes.

If any of these is shaky, work through `04-binary-search-tree/junior.md` and `11-red-black-tree/junior.md` first.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Interval** | A pair `[lo, hi]` with `lo <= hi`. Usually closed, sometimes half-open `[lo, hi)`. The interval represents a contiguous range on the real line. |
| **Low endpoint** | The smaller boundary `lo`. Also called *start*, *left*, *begin*. |
| **High endpoint** | The larger boundary `hi`. Also called *end*, *right*, *finish*. |
| **Overlap** | Two intervals `[a, b]` and `[c, d]` **overlap** iff `a <= d && c <= b` (closed). For half-open intervals replace `<=` with `<` on the boundary that is open. Always define your convention up front. |
| **Stabbing query** | Find every stored interval that contains a query *point* `q`. A special case of overlap query with `[q, q]`. |
| **Overlap query** | Find every stored interval that overlaps a query *interval* `[a, b]`. |
| **Augmentation** | Extra per-node data derived from the subtree, maintained as the tree mutates. Interval trees augment with `subtreeMax = max(high in this subtree)`. |
| **subtreeMax** | The maximum high endpoint among all intervals stored in this node's subtree. The key field that enables pruning. |
| **Centered interval tree** | Edelsbrunner's variant: pick a pivot per node; three-way split into left, contains-center, right. |
| **Pivot / center point** | The chosen splitting value for a node in a centered interval tree. Often the median endpoint. |
| **Output-sensitive complexity** | A time bound that includes the size `k` of the answer, e.g., O(log n + k). |
| **Range tree, segment tree, R-tree** | Related but **distinct** structures, often confused. See section 4.5. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — two flavors of interval tree

### 4.1 The overlap test

Two closed intervals `[a, b]` and `[c, d]` overlap if and only if:

```
a <= d  AND  c <= b
```

Equivalently: one starts before the other ends, on both sides. Memorize this; almost every bug in interval-tree code traces back to a wrong overlap test. If the intervals are half-open `[a, b)` and `[c, d)`, replace the relevant `<=` with `<` — for `[a, b)` and `[c, d)`, the overlap condition is `a < d AND c < b`.

For a single query *point* `q`, the test reduces to `lo <= q <= hi`.

### 4.2 Augmented BST interval tree (CLRS 14.3)

This is a plain binary search tree keyed by `interval.low`. Two intervals with the same low are tied broken arbitrarily (by original insertion order, or by high). Each node stores:

```
node:
    interval  : (lo, hi)
    subtreeMax: int     // max of (this.interval.hi, left.subtreeMax, right.subtreeMax)
    left, right
```

**Insert** works exactly like normal BST insert (compare by `lo`, recurse), then on the way back up the call stack, update `subtreeMax` at every visited ancestor.

**Overlap-search** for query `[a, b]` walks the tree starting at the root:

```
overlap(node, query):
    if node is null:           return
    if node.interval overlaps query:
        report node.interval
    if node.left != null and node.left.subtreeMax >= query.lo:
        overlap(node.left, query)   // left subtree MIGHT contain an overlap
    if node.interval.lo <= query.hi:
        overlap(node.right, query)  // right subtree MIGHT contain an overlap
```

The two pruning conditions are the heart of the algorithm:

1. **Left subtree prune.** If every interval in the left subtree ends before `query.lo`, the maximum high there is `< query.lo`, and no left interval can overlap the query. Skip the whole subtree.
2. **Right subtree prune.** The BST is ordered by `lo`, so the right subtree contains only intervals with `lo >= node.interval.lo`. If `node.interval.lo > query.hi`, every right interval starts after the query ends — none overlaps. Skip.

These two prunes together give O(log n + k). Why? Each reported overlap costs O(1) amortized work, and the "wasted" visits — nodes visited but not reported — form a path of length O(log n) on each side of the answer set. A formal proof is in CLRS 14.3.

To balance the tree we use red-black rotations. The augmentation `subtreeMax` is **rotation-friendly**: after a rotation, only the two rotated nodes need their `subtreeMax` recomputed, in O(1) each. This is exactly the kind of augmentation Theorem 14.1 of CLRS describes as "maintainable".

### 4.3 Centered interval tree (Edelsbrunner / McCreight)

This is a different design. Instead of a BST ordered by low endpoint, you build a tree of **center points**:

```
build(intervals):
    if intervals is empty:  return null
    center = median of endpoints in intervals
    left = []; right = []; contains = []
    for I in intervals:
        if I.hi < center:    left.append(I)
        else if I.lo > center: right.append(I)
        else:                 contains.append(I)
    node.center = center
    node.byLow  = contains sorted by lo ascending
    node.byHigh = contains sorted by hi descending
    node.left   = build(left)
    node.right  = build(right)
    return node
```

The "contains" set is stored **twice**, sorted two ways. That redundancy is what makes the stabbing query fast.

**Stabbing query** for point `q`:

```
stab(node, q):
    if node is null:  return
    if q < node.center:
        // every "contains" interval has lo <= center; but we need lo <= q
        for I in node.byLow:
            if I.lo > q: break       // sorted ascending — rest can't match
            report I
        stab(node.left, q)
    else if q > node.center:
        for I in node.byHigh:
            if I.hi < q: break       // sorted descending — rest can't match
            report I
        stab(node.right, q)
    else:  // q == center
        for I in node.byLow: report I
```

The recursion descends at most O(log n) levels, and at each level you scan a *prefix* of `byLow` or `byHigh` whose total length over all levels sums to O(k). Hence O(log n + k).

### 4.4 Which one to use

| Property | CLRS RB tree | Centered tree |
|---|---|---|
| Dynamic insert/delete | O(log n) | O(n) (rebuild subtree) |
| Static build | O(n log n) | O(n log n) |
| Query | O(log n + k) | O(log n + k) |
| Constants | Larger (more pointer chasing) | Smaller (good cache locality) |
| Memory | One node per interval | Each "contains" interval stored twice |
| Code complexity | Familiar BST + one extra field | Three-way split, two sorted lists per node |
| Used in | Linux kernel, jemalloc, LLVM | Python `intervaltree`, computational geometry libs |

**Rule of thumb:** intervals frequently inserted and deleted → CLRS RB tree. Build once and query many times → centered.

### 4.5 Don't confuse with segment trees, range trees, R-trees

Beginners frequently conflate these. They are **different structures with different jobs**:

- **Interval tree** — stores intervals, answers "which stored intervals overlap a query point or interval". This document's topic.
- **Segment tree** — stores values at *integer positions* over a fixed range `[0, N)`. Supports range-sum, range-min, lazy-update queries. The leaves are points, not intervals. We covered it in `09-trees/10-segment-tree/`.
- **Range tree** — multidimensional point search structure. Used for orthogonal range queries on points in d dimensions.
- **R-tree** — multidimensional bounding-box index used by databases (PostGIS, MongoDB) for 2D/3D spatial queries.

If your data is *points* and you want sums, use a segment tree. If your data is *intervals* and you want overlaps, use an interval tree.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | CLRS augmented RB | Centered (static) |
|---|---|---|
| Build from n intervals | O(n log n) | O(n log n) |
| Insert | O(log n) | O(n) worst |
| Delete | O(log n) | O(n) worst |
| Stab(point q) → all hits | O(log n + k) | O(log n + k) |
| Overlap([a, b]) → all hits | O(log n + k) | O(log n + k) |
| Space | O(n) | O(n) (each "contains" stored 2×) |

`k` denotes the size of the output. The `log n` term is the cost paid to *reach* the answer set; the `k` term is the cost paid to *enumerate* it.

For n = 10⁶ and a query that returns k = 5: about 20 + 5 = 25 work units, vs n = 10⁶ for naive scan. Four orders of magnitude faster.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Calendar overlap

You want every meeting overlapping **Tuesday 14:30**. Each meeting is an interval `[start, end]`. Stab-query for `q = 14:30`. The interval tree returns the answer in O(log n + k); naive scan needs O(n).

### 6.2 Gene annotations on a chromosome

A genome is a sequence of base-pair positions. Each gene, exon, and regulatory element is an interval `[start, end]` on a chromosome. Biologists constantly ask "which annotations overlap position 12,345,678?" or "which exons overlap the region [12M, 13M] on chr7?". Tools like **BEDtools**, **samtools**, the Python `intervaltree` package, and `bx-python` all use interval trees internally.

### 6.3 Virtual memory areas

A Linux process has a list of VMAs — contiguous memory regions like `[0x4000_0000, 0x4000_1000]` for a mapped page. When the kernel handles a page fault at address `addr`, it must find the VMA containing `addr`. The kernel uses an augmented RB interval tree (`lib/interval_tree.c`) for exactly this stabbing query.

### 6.4 Booking systems

A hotel has 200 rooms. You want to know which rooms are occupied during a candidate guest stay `[Jul 14, Jul 17]`. Each existing booking is an interval; stab-query the proposed range for any overlap.

### 6.5 Network firewall rules

Firewall rules often specify *port ranges*: "allow TCP 8000-8099". When a packet arrives on port 8042, the firewall looks up every rule that *contains* port 8042. Stab-query on a small set of port-range intervals.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **O(log n + k) overlap queries.** Output-sensitive; fast when the answer is small.
- **Supports both point (stabbing) and range (overlap) queries** with one structure.
- **CLRS variant is fully dynamic.** Insert and delete in O(log n).
- **Standard, well-understood algorithm.** Implementations exist in every major language.
- **Used in real production code** — Linux kernel, jemalloc, LLVM register allocator.

### Cons
- **Implementation complexity.** Centered tree has two sorted lists per node; CLRS variant needs both RB-tree rotations and augmentation maintenance. Easy to get subtly wrong.
- **Not multidimensional.** 1D only. For 2D+ use R-trees or kd-trees.
- **Worst-case k can equal n.** If every stored interval overlaps the query, you must report all of them — O(n) regardless of the structure. The structure is fast when the answer is *small*.
- **Memory overhead.** Each node stores low, high, subtreeMax, two pointers, and (for RB) a color bit. ~40-48 bytes per interval in C, more in Java/Python with object headers.
- **For static datasets, simpler structures beat it.** A sorted array + binary search by low endpoint plus a "max-high so far" array gives O(log n + k) too, with better cache locality.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Build a CLRS-style augmented BST on these intervals (inserted in order, no rebalancing — we use plain BST for clarity):

```
[15, 20], [10, 30], [17, 19], [5, 20], [12, 15], [30, 40]
```

### Insertion trace

**Insert [15, 20].** Tree is empty. Root = `[15, 20]`, subtreeMax = 20.

```
            [15,20] max=20
```

**Insert [10, 30].** Compare lo = 10 to root.lo = 15. Go left. Left is empty → place here. Then update ancestors' subtreeMax: root.subtreeMax = max(20, 30) = 30.

```
            [15,20] max=30
           /
   [10,30] max=30
```

**Insert [17, 19].** 17 > 15 → right. Empty → place. Root.subtreeMax = max(30, 19) = 30.

```
            [15,20] max=30
           /              \
   [10,30] max=30   [17,19] max=19
```

**Insert [5, 20].** 5 < 15 → left to [10,30]. 5 < 10 → left of [10,30] → place. Update: [10,30].subtreeMax = max(30, 20) = 30. Root.subtreeMax = max(20, 30, 19) = 30.

```
            [15,20] max=30
           /              \
   [10,30] max=30   [17,19] max=19
   /
[5,20] max=20
```

**Insert [12, 15].** 12 < 15 → left. 12 > 10 → right of [10,30]. Place. Update: [10,30].subtreeMax = max(30, 20, 15) = 30. Root.subtreeMax = max(20, 30, 19) = 30.

```
            [15,20] max=30
           /              \
   [10,30] max=30    [17,19] max=19
   /         \
[5,20]      [12,15]
max=20      max=15
```

**Insert [30, 40].** 30 > 15 → right. 30 > 17 → right of [17,19]. Place. Update: [17,19].subtreeMax = max(19, 40) = 40. Root.subtreeMax = max(20, 30, 40) = 40.

```
            [15,20] max=40
           /              \
   [10,30] max=30    [17,19] max=40
   /         \                 \
[5,20]      [12,15]         [30,40]
max=20      max=15          max=40
```

### Overlap query for `[14, 16]`

Start at root [15, 20], subtreeMax = 40.

1. **Root [15, 20] overlaps [14, 16]?** `15 <= 16 && 14 <= 20` → yes. **Report [15, 20]**.
2. Check left subtree. `left.subtreeMax = 30 >= query.lo = 14` → recurse left.
3. Check right subtree. `node.interval.lo = 15 <= query.hi = 16` → recurse right.

**Recurse into [10, 30].**
1. Does [10, 30] overlap [14, 16]? `10 <= 16 && 14 <= 30` → yes. **Report [10, 30]**.
2. Left subtree: [5, 20].subtreeMax = 20 >= 14 → recurse left.
3. Right subtree: [10, 30].lo = 10 <= 16 → recurse right.

**Recurse into [5, 20].**
1. Overlap? `5 <= 16 && 14 <= 20` → yes. **Report [5, 20]**.
2. No left, no right (subtreeMax = 20 >= 14 but left is null; lo 5 <= 16 but right is null).

**Recurse into [12, 15].**
1. Overlap? `12 <= 16 && 14 <= 15` → yes. **Report [12, 15]**.
2. No children.

Back at [10, 30] done. Continue to root's right subtree.

**Recurse into [17, 19].**
1. Overlap? `17 <= 16`? **No** (17 > 16). Skip.
2. Left subtree null. Right subtree: [17, 19].lo = 17 > query.hi = 16 → **prune right**. Done.

**Final answer:** `{[15,20], [10,30], [5,20], [12,15]}`.

Notice the prune at [17, 19]: we did not descend into [30, 40] at all, because the BST ordering told us every right-subtree interval starts at 17 or later, which is past our query's high of 16.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

We implement the **augmented BST** version (no RB balancing for clarity; a comment at the end explains where to add rotation hooks).

### 9.1 Go

```go
package intervaltree

// Interval is a closed interval [Lo, Hi].
type Interval struct {
    Lo, Hi int
}

func (a Interval) Overlaps(b Interval) bool {
    return a.Lo <= b.Hi && b.Lo <= a.Hi
}

type node struct {
    iv          Interval
    subtreeMax  int
    left, right *node
}

type IntervalTree struct {
    root *node
}

func (t *IntervalTree) Insert(iv Interval) {
    t.root = insert(t.root, iv)
}

func insert(n *node, iv Interval) *node {
    if n == nil {
        return &node{iv: iv, subtreeMax: iv.Hi}
    }
    if iv.Lo < n.iv.Lo {
        n.left = insert(n.left, iv)
    } else {
        n.right = insert(n.right, iv)
    }
    if iv.Hi > n.subtreeMax {
        n.subtreeMax = iv.Hi
    }
    return n
}

// OverlapSearch returns ONE interval overlapping q, or nil.
func (t *IntervalTree) OverlapSearch(q Interval) *Interval {
    n := t.root
    for n != nil {
        if n.iv.Overlaps(q) {
            return &n.iv
        }
        if n.left != nil && n.left.subtreeMax >= q.Lo {
            n = n.left
        } else {
            n = n.right
        }
    }
    return nil
}

// AllOverlaps reports every stored interval overlapping q.
func (t *IntervalTree) AllOverlaps(q Interval) []Interval {
    var out []Interval
    collect(t.root, q, &out)
    return out
}

func collect(n *node, q Interval, out *[]Interval) {
    if n == nil {
        return
    }
    if n.iv.Overlaps(q) {
        *out = append(*out, n.iv)
    }
    if n.left != nil && n.left.subtreeMax >= q.Lo {
        collect(n.left, q, out)
    }
    if n.iv.Lo <= q.Hi {
        collect(n.right, q, out)
    }
}
```

### 9.2 Java

```java
public final class IntervalTree {

    public record Interval(int lo, int hi) {
        public boolean overlaps(Interval o) {
            return lo <= o.hi && o.lo <= hi;
        }
    }

    private static final class Node {
        Interval iv;
        int subtreeMax;
        Node left, right;
        Node(Interval iv) { this.iv = iv; this.subtreeMax = iv.hi(); }
    }

    private Node root;

    public void insert(Interval iv) { root = insert(root, iv); }

    private Node insert(Node n, Interval iv) {
        if (n == null) return new Node(iv);
        if (iv.lo() < n.iv.lo()) n.left  = insert(n.left,  iv);
        else                     n.right = insert(n.right, iv);
        if (iv.hi() > n.subtreeMax) n.subtreeMax = iv.hi();
        return n;
    }

    public Interval overlapSearch(Interval q) {
        Node n = root;
        while (n != null) {
            if (n.iv.overlaps(q)) return n.iv;
            if (n.left != null && n.left.subtreeMax >= q.lo()) n = n.left;
            else                                                n = n.right;
        }
        return null;
    }

    public java.util.List<Interval> allOverlaps(Interval q) {
        java.util.List<Interval> out = new java.util.ArrayList<>();
        collect(root, q, out);
        return out;
    }

    private void collect(Node n, Interval q, java.util.List<Interval> out) {
        if (n == null) return;
        if (n.iv.overlaps(q)) out.add(n.iv);
        if (n.left != null && n.left.subtreeMax >= q.lo()) collect(n.left, q, out);
        if (n.iv.lo() <= q.hi())                            collect(n.right, q, out);
    }
}
```

### 9.3 Python

```python
from dataclasses import dataclass, field
from typing import Optional, List

@dataclass(frozen=True)
class Interval:
    lo: int
    hi: int
    def overlaps(self, o: "Interval") -> bool:
        return self.lo <= o.hi and o.lo <= self.hi

@dataclass
class _Node:
    iv: Interval
    subtree_max: int
    left:  Optional["_Node"] = None
    right: Optional["_Node"] = None

class IntervalTree:
    def __init__(self) -> None:
        self.root: Optional[_Node] = None

    def insert(self, iv: Interval) -> None:
        self.root = self._insert(self.root, iv)

    def _insert(self, n: Optional[_Node], iv: Interval) -> _Node:
        if n is None:
            return _Node(iv, iv.hi)
        if iv.lo < n.iv.lo:
            n.left  = self._insert(n.left,  iv)
        else:
            n.right = self._insert(n.right, iv)
        if iv.hi > n.subtree_max:
            n.subtree_max = iv.hi
        return n

    def overlap_search(self, q: Interval) -> Optional[Interval]:
        n = self.root
        while n is not None:
            if n.iv.overlaps(q):
                return n.iv
            if n.left is not None and n.left.subtree_max >= q.lo:
                n = n.left
            else:
                n = n.right
        return None

    def all_overlaps(self, q: Interval) -> List[Interval]:
        out: List[Interval] = []
        self._collect(self.root, q, out)
        return out

    def _collect(self, n: Optional[_Node], q: Interval, out: List[Interval]) -> None:
        if n is None:
            return
        if n.iv.overlaps(q):
            out.append(n.iv)
        if n.left is not None and n.left.subtree_max >= q.lo:
            self._collect(n.left, q, out)
        if n.iv.lo <= q.hi:
            self._collect(n.right, q, out)
```

### 9.4 Note on balancing

The implementations above are plain BSTs. Worst-case height is O(n) on adversarial insertion order. To get the guaranteed O(log n), wrap the BST with red-black or AVL balancing. After each rotation, recompute `subtreeMax` for the two rotated nodes only (each in O(1)). CLRS Theorem 14.1 formalizes the conditions under which an augmentation can be maintained by RB rotations; `subtreeMax = max(this.hi, left.subtreeMax, right.subtreeMax)` satisfies them because it depends only on the node and its children.

---

<a name="centered"></a>
## 10. Centered Interval Tree (McCreight variant)

Python implementation, static build:

```python
from dataclasses import dataclass
from typing import List, Optional
from statistics import median

@dataclass
class CenteredNode:
    center: float
    by_low:  List[Interval]   # contains-center, sorted by lo asc
    by_high: List[Interval]   # contains-center, sorted by hi desc
    left:  Optional["CenteredNode"]
    right: Optional["CenteredNode"]

def build_centered(ivs: List[Interval]) -> Optional[CenteredNode]:
    if not ivs:
        return None
    endpoints = [x.lo for x in ivs] + [x.hi for x in ivs]
    center = median(endpoints)
    left_ivs, right_ivs, contains = [], [], []
    for iv in ivs:
        if iv.hi < center:   left_ivs.append(iv)
        elif iv.lo > center: right_ivs.append(iv)
        else:                contains.append(iv)
    return CenteredNode(
        center  = center,
        by_low  = sorted(contains, key=lambda x: x.lo),
        by_high = sorted(contains, key=lambda x: -x.hi),
        left    = build_centered(left_ivs),
        right   = build_centered(right_ivs),
    )

def stab(node: Optional[CenteredNode], q: float) -> List[Interval]:
    if node is None:
        return []
    out: List[Interval] = []
    if q < node.center:
        for iv in node.by_low:
            if iv.lo > q: break
            out.append(iv)
        out.extend(stab(node.left, q))
    elif q > node.center:
        for iv in node.by_high:
            if iv.hi < q: break
            out.append(iv)
        out.extend(stab(node.right, q))
    else:
        out.extend(node.by_low)
    return out
```

The build is O(n log n) — same as sorting. The static structure is rarely the right pick for an evolving calendar; it shines for one-shot geometry queries on a fixed dataset, e.g., gene-annotation databases that are built once and queried millions of times.

---

<a name="patterns"></a>
## 11. Coding Patterns

- **"Find any one overlap" vs "find all overlaps".** The single-overlap version (`overlapSearch`) is a single root-to-leaf descent — O(log n). The all-overlaps version walks every relevant subtree — O(log n + k). Make sure your API distinguishes these; a "find one" call is much cheaper.
- **Point query is just a degenerate interval query.** Implement `stab(q)` as `allOverlaps([q, q])`.
- **Closed vs half-open** — pick a convention and stamp it in your type. Half-open is friendlier to programmers (concatenation works without "+1") but closed is friendlier to humans ("meeting from 14:00 to 15:00").
- **Sentinel "empty subtree max"** — when a child is null, treat its `subtreeMax` as `-∞` (or `INT_MIN`). The pruning condition then correctly returns false.

---

<a name="errors"></a>
## 12. Error Handling — Open vs Closed Intervals

The single most common bug in production interval-tree code is mishandling **touching endpoints**.

| Convention | Do `[1, 5]` and `[5, 10]` overlap? |
|---|---|
| Closed | **Yes** — they share point 5. Overlap test: `a.lo <= b.hi && b.lo <= a.hi`. |
| Half-open `[lo, hi)` | **No** — `[1, 5)` ends just before 5, `[5, 10)` starts at 5. Overlap test: `a.lo < b.hi && b.lo < a.hi`. |

Pick **one** convention for your codebase and write it in code:

```python
class Interval:
    CONVENTION = "half_open"   # or "closed"
    def overlaps(self, o: "Interval") -> bool:
        if self.CONVENTION == "half_open":
            return self.lo < o.hi and o.lo < self.hi
        return self.lo <= o.hi and o.lo <= self.hi
```

Calendar apps are usually **half-open** — "meeting 14:00-15:00" means it ends *just before* 15:00, so a 15:00-16:00 meeting can begin without conflict. Bioinformatics is split: BED is half-open zero-based `[start, end)`, GFF/GTF is closed one-based `[start, end]`. Read the spec before writing code.

Other error categories:

| Error | Cause | Fix |
|---|---|---|
| `lo > hi` | Inverted endpoints from user input | Validate at construction: `assert lo <= hi`. |
| Forgot to update `subtreeMax` after insert | Returned the new node without bubbling up | Always recompute on the way back up. |
| Forgot to update `subtreeMax` after delete | Same as above for delete | Walk back up; or rebuild lazily. |
| Pruning condition uses `>` instead of `>=` | Off-by-one on the boundary | The correct guard is `left.subtreeMax >= q.lo` (for closed intervals). |
| Returned only one overlap when caller wanted all | API confusion | Two separate methods: `overlapSearch` (any one) and `allOverlaps` (every one). |

---

<a name="performance-tips"></a>
## 13. Performance Tips

1. **Store interval endpoints inline in the node** rather than via a pointer to an `Interval` object. One cache line per node access matters.
2. **Use iterative descent for `overlapSearch`** (find any one). Saves stack frames and lets the compiler inline.
3. **Allocate nodes from an arena** in hot paths. Java escape analysis often manages this; in Go, a `sync.Pool` helps; in C++, a typed slab allocator.
4. **For a static dataset, prefer the centered tree** — fewer pointer chases per query, better cache behaviour.
5. **Cap recursion depth** with iterative walks if you expect adversarial input (unbalanced BST without RB).
6. **Batch overlap queries when possible.** If the workload is "find overlaps for each of these 1000 ranges", sort the query ranges and process them in lockstep with a sweep over the tree — often O((n + Q) log n) instead of O(Q · log n).
7. **Profile before optimizing.** A naive O(n) scan beats a tree for n < ~50 because of constant factors.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Make `Interval` immutable.** Mutating endpoints corrupts the tree's invariants instantly.
- **Document the overlap convention** at the top of the file: "all intervals are closed `[lo, hi]`".
- **Test the prune conditions explicitly.** Tests should include queries where pruning is required for correctness (left subtree has no overlap, right subtree has no overlap).
- **Use property-based testing.** Generate random interval sets and random queries; compare the tree's `allOverlaps` to a naive O(n) scan. Any divergence is a bug.
- **Separate the BST mechanics from the augmentation.** A `subtreeMax` updater that runs after every structural change is easier to maintain than tangled insert/delete code.

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Behavior |
|---|---|
| Empty tree | `overlapSearch` returns null; `allOverlaps` returns []. |
| Single interval | Trivially correct. |
| Query exactly equal to a stored interval | Reports the stored interval. |
| Touching endpoints `[1,5]` and `[5,10]`, closed | Report both. |
| Touching endpoints `[1,5]` and `[5,10]`, half-open | Do not report. |
| All intervals identical `[3,7]` repeated 100× | All 100 reported on any overlapping query. |
| Single-point intervals `[5,5]` | Treated as point; stabbing at 5 reports them. |
| Tree with 1 element, query disjoint | Returns empty. |
| Query interval contains every stored interval | Returns all n; output dominates: O(n). |
| `lo == hi == 0` | Valid zero-length point; ensure the comparator handles ties. |
| Negative endpoints | Fine; the BST is over integers/floats with normal ordering. |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Forgetting to maintain `subtreeMax`.** The tree silently returns wrong answers — the structure is still a valid BST, but the prune incorrectly skips subtrees.
2. **Using `>` instead of `>=` in the prune.** Misses overlaps at the boundary endpoint.
3. **Mixing open and closed conventions in the same codebase.** Half the tests pass; production data corrupts.
4. **Confusing interval tree with segment tree.** Different structure, different use case. Reading a stub by name is not enough.
5. **Inserting intervals where `lo > hi`.** Silent corruption. Validate at the constructor.
6. **Reporting on `node.iv.overlaps(q)` *before* recursing.** That is actually correct; the mistake is forgetting to call it.
7. **Recursing into the right subtree unconditionally.** Without the `node.iv.lo <= q.hi` check, you lose the O(log n + k) bound and end up O(n + k).
8. **Using a plain BST in production.** Adversarial input degenerates to a linked list. Add balancing or accept the risk explicitly.
9. **Forgetting to recompute `subtreeMax` after RB rotations.** Augmentation maintenance is the part newcomers get wrong.
10. **Treating the augmentation as a sum.** `subtreeMax` is a max, not a sum. Updating it incrementally on delete is fiddly — you cannot subtract from a max.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
OVERLAP TEST (closed):     a.lo <= b.hi  AND  b.lo <= a.hi
OVERLAP TEST (half-open):  a.lo <  b.hi  AND  b.lo <  a.hi

CLRS INTERVAL TREE
    Order:        BST by interval.lo
    Augment:      subtreeMax = max(this.hi, left.subtreeMax, right.subtreeMax)
    Insert:       normal BST insert; update subtreeMax on the way up
    Delete:       normal BST delete; recompute subtreeMax on path
    Search any:   descend; if !overlap, go left iff left.subtreeMax >= q.lo, else go right
    Search all:   recurse left iff left.subtreeMax >= q.lo
                  recurse right iff node.interval.lo <= q.hi

COMPLEXITY
    Build:        O(n log n)
    Insert/Del:   O(log n) with RB balancing
    Stab/Overlap: O(log n + k)   (k = output size)
    Space:        O(n)

VARIANTS
    CLRS RB tree            — dynamic, cheap insert/delete
    Centered (McCreight)    — static, faster queries, three-way split per node
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

`animation.html` in this folder renders an augmented BST built from intervals you type in. Each node shows its interval and `subtreeMax`. You can issue a point or interval query; the animation highlights visited nodes (yellow), reported hits (green), and grayed-out pruned subtrees. Stats display node count, tree height, intervals stored, hits returned, and nodes visited per query. Walking through a query manually on the animation cements why the prune conditions work.

---

<a name="summary"></a>
## 19. Summary

- An **interval tree** stores intervals and answers overlap queries in **O(log n + k)** — output-sensitive.
- Two standard variants: the **CLRS augmented red-black tree** (BST by `lo`, augmented with `subtreeMax`) and the **centered tree** (Edelsbrunner / McCreight, three-way split per node).
- The augmented-RB design supports cheap dynamic insert/delete; the centered design is static but faster for query-heavy workloads.
- The single-overlap query descends a single root-to-leaf path; the all-overlaps query walks every subtree that might contain a hit and prunes the rest using `subtreeMax`.
- Watch out for the open-vs-closed convention; it bites every team eventually.
- Don't confuse interval trees with segment trees, range trees, or R-trees — different structures, different problems.

Master this, and you have the foundation for understanding the Linux kernel's VMA index, the bioinformatics tooling stack, and every "find all events in a window" query you will ever build.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Cormen, Leiserson, Rivest, Stein**, *Introduction to Algorithms* (CLRS), 3rd ed., Section 14.3 — *Interval Trees*. The canonical augmented-RB-tree treatment.
- **Mark de Berg, Otfried Cheong, Marc van Kreveld, Mark Overmars**, *Computational Geometry: Algorithms and Applications*, 3rd ed., Chapter 10 — *More Geometric Data Structures*. The centered-interval-tree analysis with proofs.
- **Herbert Edelsbrunner**, *Dynamic Data Structures for Orthogonal Intersection Queries*, Tech. Report F59, TU Graz, 1980. The original centered-interval-tree paper.
- **Edward McCreight**, *Priority Search Trees*, SIAM Journal on Computing 14(2), 1985. Closely related structure.
- **Linux kernel source**: `include/linux/interval_tree.h` and `lib/interval_tree.c` — a production augmented-RB tree, type-generic via the `INTERVAL_TREE_DEFINE` macro.
- **Python `intervaltree`** package — practical centered-style implementation widely used in bioinformatics.
- **LeetCode** — problems 56, 57, 252, 253, 715, 729, 731, 732, 1893. Practice interval reasoning until the patterns are automatic.
- Continue with `middle.md` for stabbing queries, interval scheduling, augmentation variants, range modules, and persistent interval trees.
