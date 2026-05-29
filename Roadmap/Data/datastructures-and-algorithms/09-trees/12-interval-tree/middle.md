# Interval Tree — Middle Level

> **Audience:** Engineers comfortable with the CLRS augmented-BST interval tree from `junior.md`. We now build the production-grade variants, alternate query types, and the small family of structures around them.

This document covers: the **red-black balanced interval tree** as it actually ships in `lib/interval_tree.c`; the **centered (McCreight) variant** with its three-way per-node split; **stabbing queries** for a single point; **range queries** that report every overlap of a query interval `[a, b]`; the **maximum-overlap (chromatic number)** problem solved both by sweep-line and by interval tree; the classic **interval-scheduling** greedy; richer augmentations (count, sum-of-lengths, max-length); the **range module** / interval-merging data structure; and finally **persistent interval trees** with path-copying.

---

## Table of Contents

1. [Augmented Red-Black Interval Tree (CLRS)](#rb-tree)
2. [Centered Interval Tree (McCreight)](#centered)
3. [Stabbing Query — All Intervals Containing a Point](#stabbing)
4. [Range Query — All Intervals Overlapping `[a, b]`](#range)
5. [Maximum-Overlap Problem](#max-overlap)
6. [Interval Scheduling — Greedy Max Non-Overlap](#scheduling)
7. [Richer Augmentations](#augmentations)
8. [Range Modules — Interval Merging](#range-module)
9. [Persistent Interval Trees](#persistent)

---

<a name="rb-tree"></a>
## 1. Augmented Red-Black Interval Tree (CLRS)

The plain BST in `junior.md` works on average but degenerates to O(n) on adversarial input. CLRS 14.3 promotes it to a **red-black tree** with the `subtreeMax` augmentation. Theorem 14.1 (CLRS) guarantees that an augmentation **can be maintained through rotations in O(1) per rotation** if the augmented value depends only on the node itself and its left and right child augmentations — which `subtreeMax = max(this.hi, left.subtreeMax, right.subtreeMax)` does.

### Augmentation maintenance rule

After **any** structural mutation (insert, delete, rotation), recompute `subtreeMax` for every modified node, in O(1) each. A rotation touches exactly two nodes, so each rotation adds O(1) to the asymptotic cost — RB balancing remains O(log n) per insert/delete.

### Java skeleton with RB hooks

```java
private void leftRotate(Node x) {
    Node y = x.right;
    x.right = y.left;
    if (y.left != nil) y.left.parent = x;
    y.parent = x.parent;
    if (x.parent == nil)            root        = y;
    else if (x == x.parent.left)    x.parent.left  = y;
    else                            x.parent.right = y;
    y.left   = x;
    x.parent = y;
    // CRITICAL: x first (deeper), then y.
    updateMax(x);
    updateMax(y);
}

private void updateMax(Node n) {
    int m = n.iv.hi();
    if (n.left  != nil) m = Math.max(m, n.left.subtreeMax);
    if (n.right != nil) m = Math.max(m, n.right.subtreeMax);
    n.subtreeMax = m;
}
```

The discipline is simple: any time a parent pointer changes, call `updateMax` on the new lower node first, then on its parent. Bugs in this area produce *silent* wrong answers — the tree still satisfies BST and RB invariants, but the overlap-search prune lies.

### Delete

Delete in an augmented RB tree is the same RB delete you already know, plus a path of `updateMax` calls from the deepest modified node up to the root. Many implementations cheat by **lazy delete** — mark the node tombstoned and rebuild periodically. The Linux kernel goes the full distance; jemalloc accepts tombstones.

### Production reference: `INTERVAL_TREE_DEFINE`

Linux's `lib/interval_tree_generic.h` exposes a macro `INTERVAL_TREE_DEFINE(node_type, rb_field, start_type, last, START, LAST, prefix)` that generates a strongly-typed augmented RB interval tree for any user-defined node type. The VMA tree (`mm/mmap.c`) uses it for `struct vm_area_struct`. We dissect it in `professional.md`.

---

<a name="centered"></a>
## 2. Centered Interval Tree (McCreight)

The centered tree was introduced by Edelsbrunner (1980, TU Graz tech report F59) and popularized by McCreight; it is also covered in de Berg ch 10. The defining trick: at every node, pick a **center point** and three-way split the intervals.

### Build

```go
type centeredNode struct {
    center            float64
    byLow             []Interval     // contains-center, sorted by lo ascending
    byHigh            []Interval     // contains-center, sorted by hi descending
    left, right       *centeredNode
}

func buildCentered(ivs []Interval) *centeredNode {
    if len(ivs) == 0 {
        return nil
    }
    eps := make([]float64, 0, 2*len(ivs))
    for _, iv := range ivs {
        eps = append(eps, float64(iv.Lo), float64(iv.Hi))
    }
    center := medianOf(eps)

    var leftSet, rightSet, contains []Interval
    for _, iv := range ivs {
        switch {
        case float64(iv.Hi) < center:
            leftSet = append(leftSet, iv)
        case float64(iv.Lo) > center:
            rightSet = append(rightSet, iv)
        default:
            contains = append(contains, iv)
        }
    }
    byLow  := append([]Interval(nil), contains...)
    byHigh := append([]Interval(nil), contains...)
    sort.Slice(byLow,  func(i, j int) bool { return byLow[i].Lo  <  byLow[j].Lo  })
    sort.Slice(byHigh, func(i, j int) bool { return byHigh[i].Hi >  byHigh[j].Hi })
    return &centeredNode{
        center:  center,
        byLow:   byLow,
        byHigh:  byHigh,
        left:    buildCentered(leftSet),
        right:   buildCentered(rightSet),
    }
}
```

Sorting endpoints once at the root and reusing during recursive splits drops the build to O(n log n) total.

### Why store the "contains" set twice

The crucial insight: a query point `q < node.center` can only hit "contains" intervals with `lo <= q`. Walking `byLow` in ascending order, you can stop as soon as `iv.lo > q`. Symmetrically, for `q > node.center`, walk `byHigh` descending and stop when `iv.hi < q`. The total work per level is `O(hits_at_this_level)`, so the whole query is `O(log n + k)`.

### Trade-offs

- **No dynamic insert/delete.** Adding an interval may rewrite the entire subtree it lands in.
- **Slightly higher memory** (each "contains" interval is stored in two arrays at one node).
- **Excellent cache locality** during query (sequential array walks).

Use centered for static datasets queried millions of times; use augmented-RB for evolving sets.

---

<a name="stabbing"></a>
## 3. Stabbing Query — All Intervals Containing a Point

A **stabbing query** asks: *given point `q`, report every stored interval `[lo, hi]` with `lo <= q <= hi`.* It is the most common interval-tree workload — every "what's happening at time T" maps to it.

### Via augmented BST

Just call `allOverlaps([q, q])`:

```python
def stab(tree, q):
    return tree.all_overlaps(Interval(q, q))
```

Wave at the elegance: a stabbing query is a degenerate overlap query.

### Via centered tree

```python
def stab(node, q):
    if node is None: return []
    out = []
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
        out.extend(node.by_low)   # q == center: every "contains" interval qualifies
    return out
```

Both achieve O(log n + k).

---

<a name="range"></a>
## 4. Range Query — All Intervals Overlapping `[a, b]`

A range query generalizes stabbing: find every stored interval that overlaps the query range `[a, b]`. The augmented-BST version is just `allOverlaps((a, b))` from `junior.md`.

On a centered tree, you traverse all nodes whose `center ∈ [a, b]` plus the descents from the root to the leftmost-relevant and rightmost-relevant nodes. The total work remains O(log n + k).

### Edge cases worth highlighting

- **Empty query interval `a > b`** — by convention, return empty.
- **Query is unbounded** (e.g., `[-∞, +∞]`) — return everything; O(n).
- **Query lies entirely outside all stored intervals** — return empty in O(log n) thanks to pruning.

---

<a name="max-overlap"></a>
## 5. Maximum-Overlap Problem

> Given a set of intervals, find the maximum number of intervals that are simultaneously active at any single point.

This is the *chromatic number* of the interval graph; in interview-speak it is **LeetCode 253 — Meeting Rooms II**: the minimum number of conference rooms needed to host all meetings.

### Sweep-line + min-heap (O(n log n))

```python
import heapq

def min_rooms(meetings):
    meetings.sort(key=lambda m: m[0])      # by start
    heap = []                              # min-heap of end times
    for start, end in meetings:
        if heap and heap[0] <= start:
            heapq.heappop(heap)
        heapq.heappush(heap, end)
    return len(heap)
```

The heap size at the end equals the maximum simultaneous overlap.

### Difference-array sweep (O(n log n))

```python
def max_overlap(intervals):
    events = []
    for lo, hi in intervals:
        events.append((lo,  +1))
        events.append((hi+1, -1))           # closed interval, half-open in event space
    events.sort()
    active = best = 0
    for _, delta in events:
        active += delta
        best = max(best, active)
    return best
```

This is sometimes called the **`+1 at lo, -1 at hi+1`** trick. It is a special case of the discrete derivative.

### Interval tree variant

If you already maintain an augmented interval tree with an additional augmentation `subtreeOverlap = max simultaneous overlap inside this subtree`, you can answer "max overlap at this moment" in O(log n) and update in O(log n). The augmentation is heavier to maintain — see section 7.

---

<a name="scheduling"></a>
## 6. Interval Scheduling — Greedy Max Non-Overlap

> Select the largest subset of pairwise non-overlapping intervals.

Classic greedy: sort by **end time ascending**, repeatedly pick the next interval whose start is `>= last_picked.end`.

```go
func MaxNonOverlap(ivs []Interval) []Interval {
    sort.Slice(ivs, func(i, j int) bool { return ivs[i].Hi < ivs[j].Hi })
    var picked []Interval
    lastEnd := math.MinInt
    for _, iv := range ivs {
        if iv.Lo >= lastEnd {
            picked = append(picked, iv)
            lastEnd = iv.Hi
        }
    }
    return picked
}
```

O(n log n) from the sort; O(n) thereafter. This is **optimal** — the proof is the standard exchange argument: any optimal selection can be transformed into the greedy selection without losing intervals by repeatedly swapping the optimal's first choice for the earliest-ending one.

You don't need an interval tree for the greedy; it appears here because (a) it's the canonical sibling problem, and (b) the *weighted* version (each interval has a value, maximize sum of values of picked intervals) requires dynamic programming over an interval tree, which `senior.md` covers.

---

<a name="augmentations"></a>
## 7. Richer Augmentations

The `subtreeMax` augmentation enables overlap pruning. Other useful augmentations:

| Augmentation | Maintained Value | Enables |
|---|---|---|
| `subtreeCount` | number of nodes in subtree | rank/order-statistics queries |
| `subtreeSumLength` | sum of `(hi - lo)` over subtree | total covered span queries |
| `subtreeMaxLength` | max `(hi - lo)` over subtree | longest interval queries |
| `subtreeMinLo` | min `lo` over subtree | earliest interval queries |
| `subtreeMaxHi` | `subtreeMax` (canonical) | overlap pruning |
| `subtreeOverlap` | max simultaneous overlap inside subtree | online chromatic queries |

Most are O(1) to maintain per rotation. `subtreeOverlap` is the only one that genuinely requires the BST keys to be endpoints (not just `lo`), and even then needs both endpoint events folded into the recurrence; we leave it for `senior.md`.

### Composing augmentations

Multiple augmentations coexist. Each contributes a constant overhead per rotation. Linux's interval_tree generic actually parametrizes the "max" augmentation by user-provided LAST and START accessors so the same tree can index "highest physical address in subtree" or "latest start time in subtree" without code duplication.

---

<a name="range-module"></a>
## 8. Range Modules — Interval Merging

> Maintain a **set of merged intervals** under insert (add `[a, b)`), delete (remove `[a, b)`), and query (is `[a, b)` fully covered?).

This is LeetCode 715 **Range Module** verbatim. The structure is sometimes called an **interval set**, **range set**, or **interval merging**.

The canonical solution uses a `TreeMap` / `std::map` keyed by interval `lo`, with `hi` as value, maintaining the invariant: **stored intervals are pairwise disjoint** (any addition that would touch or overlap an existing interval merges them).

### Python (using `sortedcontainers`)

```python
from sortedcontainers import SortedList

class RangeModule:
    def __init__(self):
        self.intervals = SortedList()   # list of (lo, hi), disjoint, sorted

    def addRange(self, left: int, right: int) -> None:
        idx = self.intervals.bisect_left((left,))
        if idx > 0 and self.intervals[idx-1][1] >= left:
            idx -= 1
            left = self.intervals[idx][0]
        merged_hi = right
        while idx < len(self.intervals) and self.intervals[idx][0] <= right:
            merged_hi = max(merged_hi, self.intervals[idx][1])
            del self.intervals[idx]
        self.intervals.add((left, merged_hi))

    def queryRange(self, left: int, right: int) -> bool:
        idx = self.intervals.bisect_right((left,)) - 1
        return idx >= 0 and self.intervals[idx][0] <= left and right <= self.intervals[idx][1]

    def removeRange(self, left: int, right: int) -> None:
        idx = self.intervals.bisect_left((left,))
        if idx > 0 and self.intervals[idx-1][1] > left:
            idx -= 1
        to_add = []
        while idx < len(self.intervals) and self.intervals[idx][0] < right:
            lo, hi = self.intervals[idx]
            if lo < left:  to_add.append((lo, left))
            if hi > right: to_add.append((right, hi))
            del self.intervals[idx]
        for iv in to_add:
            self.intervals.add(iv)
```

Each operation is amortized O(log n) per touched interval; in the worst case `addRange` can remove many touched intervals at once, but the total work over a sequence of operations is O((n + m) log n) where m is the number of removals (amortization argument: each interval is added once and removed once).

This is *not* a CLRS interval tree — it is the simpler "augmented sorted set". But it solves the most common interval-merging workload, and it pairs naturally with an interval tree if you also need overlap queries on the merged result.

---

<a name="persistent"></a>
## 9. Persistent Interval Trees

A **persistent** data structure preserves every previous version. After each insert/delete you get a new "version pointer"; old pointers still navigate the old state. Useful for time-travel queries: "show me all events overlapping noon on 14 March, as known at midnight on 13 March".

The standard technique is **path copying** (Sleator, Tarjan, Driscoll): when you change a node, allocate a copy of every node on the root-to-node path; everything off the path is shared with previous versions. Each update copies O(log n) nodes; each version takes O(log n) extra memory; total memory after V versions is O((n + V) log n).

A persistent CLRS interval tree is the persistent RB tree with augmentation recomputed on each copied node. Functional languages (Clojure, Haskell, OCaml) make this idiomatic; in Java/Go you implement it with immutable node classes and a node arena.

Applications:
- **Time-versioned calendars.** "What did I think my schedule was last Monday?"
- **Database snapshots / MVCC.** Each transaction sees a consistent older view.
- **Undo stacks in IDEs.** Each edit creates a new tree version; Ctrl-Z swaps in the previous root.

We dig deeper in `professional.md`; for now know that the augmentation rules from CLRS Theorem 14.1 carry over cleanly, because `subtreeMax` only depends on a node's children — copying a node and recomputing in O(1) keeps the structure consistent.

---

**Where to go next.** `senior.md` covers how these structures show up in real production codebases (Linux VMA tree, BEDtools, LLVM live ranges, calendar systems). `professional.md` covers concurrency (lock coupling, RCU), cache-conscious layouts, bulk operations, and multidimensional generalizations. `interview.md` collects 10 LeetCode problems with three-language solutions. `tasks.md` contains hands-on exercises with reference solutions.
