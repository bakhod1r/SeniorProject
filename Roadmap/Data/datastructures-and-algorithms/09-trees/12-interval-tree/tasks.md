# Interval Tree — Tasks

> Ten hands-on exercises with reference solutions. Each task targets one skill from `junior.md`–`professional.md`. Aim to implement before reading the solution; treat the solution as a checking aid.

---

## Table of Contents

1. [Augmented BST Interval Tree](#task-1)
2. [Upgrade to Augmented Red-Black Tree](#task-2)
3. [Centered Interval Tree (McCreight)](#task-3)
4. [Stabbing Query — All Intervals Containing a Point](#task-4)
5. [Maximum Overlap Depth at Any Point](#task-5)
6. [Greedy Interval Scheduling](#task-6)
7. [Range Merge — Insert and Delete](#task-7)
8. [Bulk Build from Sorted Endpoints in O(n)](#task-8)
9. [Persistent Interval Tree](#task-9)
10. [Solve LC 715 Range Module with an Interval Tree](#task-10)

---

<a name="task-1"></a>
## Task 1. Augmented BST Interval Tree

**Build:** an `IntervalTree` with `insert(lo, hi)`, `overlapSearch(query) -> Optional<Interval>` (any one overlap), and `allOverlaps(query) -> List<Interval>` (every overlap). Use the CLRS augmentation `subtreeMax`. No balancing required.

**Reference:** see `junior.md` section 9 for Go, Java, and Python implementations. Verify with:

```python
t = IntervalTree()
for iv in [(15,20),(10,30),(17,19),(5,20),(12,15),(30,40)]:
    t.insert(Interval(*iv))
assert t.overlap_search(Interval(14, 16)) is not None
hits = t.all_overlaps(Interval(14, 16))
assert {(h.lo, h.hi) for h in hits} == {(15,20),(10,30),(5,20),(12,15)}
```

---

<a name="task-2"></a>
## Task 2. Upgrade to Augmented Red-Black Tree

Take your Task 1 BST and add red-black balancing. After every rotation, recompute `subtreeMax` for the two rotated nodes (not just the new root). Verify by inserting 10 000 intervals in a worst-case adversarial order and asserting that `height <= 2 * log2(n)`.

**Reference (Java sketch):**

```java
public class RBIntervalTree {
    private static final boolean RED = true, BLACK = false;
    private Node root;

    private static final class Node {
        Interval iv; int subtreeMax;
        Node left, right, parent;
        boolean color;
        Node(Interval iv) { this.iv = iv; this.subtreeMax = iv.hi(); this.color = RED; }
    }

    public void insert(Interval iv) {
        Node n = new Node(iv);
        bstInsert(n);
        fixInsert(n);
    }

    private void bstInsert(Node z) { /* standard BST insert by z.iv.lo */ }
    private void fixInsert(Node z) { /* standard RB fixup, with leftRotate/rightRotate */ }

    private void leftRotate(Node x) {
        Node y = x.right;
        x.right = y.left;
        if (y.left != null) y.left.parent = x;
        y.parent = x.parent;
        if (x.parent == null) root = y;
        else if (x == x.parent.left) x.parent.left = y;
        else                          x.parent.right = y;
        y.left = x; x.parent = y;
        updateMax(x);                // CRITICAL: x first, then y
        updateMax(y);
    }
    // rightRotate symmetric

    private void updateMax(Node n) {
        int m = n.iv.hi();
        if (n.left  != null) m = Math.max(m, n.left.subtreeMax);
        if (n.right != null) m = Math.max(m, n.right.subtreeMax);
        n.subtreeMax = m;
    }
}
```

After fixup, walk from the inserted node up to the root and call `updateMax` on each ancestor. Skipping this is the #1 bug.

---

<a name="task-3"></a>
## Task 3. Centered Interval Tree (McCreight)

Implement a static centered tree per `middle.md` section 2. Inputs: a list of `Interval`. Output: a built tree supporting `stab(q)` and `overlap(query)`. Use median-of-endpoints as the pivot.

**Reference (Python):**

```python
@dataclass
class CenteredNode:
    center: float
    by_low:  list
    by_high: list
    left:  Optional["CenteredNode"]
    right: Optional["CenteredNode"]

def build(ivs):
    if not ivs: return None
    eps = sorted(x.lo for x in ivs) + sorted(x.hi for x in ivs)
    center = eps[len(eps)//2]
    L, R, C = [], [], []
    for iv in ivs:
        if iv.hi < center: L.append(iv)
        elif iv.lo > center: R.append(iv)
        else: C.append(iv)
    return CenteredNode(
        center, sorted(C, key=lambda x: x.lo), sorted(C, key=lambda x: -x.hi),
        build(L), build(R))

def stab(node, q):
    if node is None: return []
    out = []
    if q < node.center:
        for iv in node.by_low:
            if iv.lo > q: break
            out.append(iv)
        out += stab(node.left, q)
    elif q > node.center:
        for iv in node.by_high:
            if iv.hi < q: break
            out.append(iv)
        out += stab(node.right, q)
    else:
        out += node.by_low
    return out
```

Verify by comparing `stab(q)` against an O(n) brute force for 1000 random intervals and 1000 random query points.

---

<a name="task-4"></a>
## Task 4. Stabbing Query — All Intervals Containing a Point

Given an `IntervalTree`, implement `stab(point)` that returns every stored interval `[lo, hi]` with `lo <= point <= hi`.

**Reference (Go, building on Task 1):**

```go
func (t *IntervalTree) Stab(point int) []Interval {
    return t.AllOverlaps(Interval{Lo: point, Hi: point})
}
```

The minimal-effort approach: a stab query is a degenerate overlap query. For a centered tree, use the specialized stab from Task 3 — it's slightly faster because it skips the `[q, q]` overlap test.

---

<a name="task-5"></a>
## Task 5. Maximum Overlap Depth at Any Point

> Given a list of intervals, return the maximum number of intervals simultaneously active at any single point.

Two approaches:

**Approach A — sweep with a min-heap of end-times.** O(n log n).

```python
import heapq
def max_overlap_heap(ivs):
    ivs.sort()                            # by lo
    heap = []
    best = 0
    for lo, hi in ivs:
        while heap and heap[0] < lo:      # closed: < ; half-open: <=
            heapq.heappop(heap)
        heapq.heappush(heap, hi)
        best = max(best, len(heap))
    return best
```

**Approach B — difference-array sweep.** O(n log n).

```python
def max_overlap_diff(ivs):
    events = []
    for lo, hi in ivs:
        events.append((lo, +1))
        events.append((hi + 1, -1))
    events.sort()
    active = best = 0
    for _, d in events:
        active += d
        best = max(best, active)
    return best
```

**Via interval tree:** maintain a per-node augmentation `subtreeOverlap` updated on every insert / delete. Trickier; left as an extension exercise — see Schmidt 2009 for the recurrence.

Verify all three approaches agree on 100 random inputs of size 1000.

---

<a name="task-6"></a>
## Task 6. Greedy Interval Scheduling

> Given a list of intervals, select the largest subset of pairwise non-overlapping intervals.

Sort by end-time ascending, greedy-pick. O(n log n).

**Reference (Go):**

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

**Reference (Python):**

```python
def max_non_overlap(ivs):
    ivs = sorted(ivs, key=lambda x: x.hi)
    picked, last_end = [], float('-inf')
    for iv in ivs:
        if iv.lo >= last_end:
            picked.append(iv)
            last_end = iv.hi
    return picked
```

**Reference (Java):**

```java
public List<Interval> maxNonOverlap(List<Interval> ivs) {
    ivs.sort(Comparator.comparingInt(Interval::hi));
    List<Interval> picked = new ArrayList<>();
    int lastEnd = Integer.MIN_VALUE;
    for (Interval iv : ivs) {
        if (iv.lo() >= lastEnd) {
            picked.add(iv);
            lastEnd = iv.hi();
        }
    }
    return picked;
}
```

The greedy is optimal — proof by exchange argument (see middle.md section 6 or any algorithms textbook).

---

<a name="task-7"></a>
## Task 7. Range Merge — Insert and Delete

> Maintain a set of merged disjoint intervals. Support `addRange(lo, hi)`, `removeRange(lo, hi)`, `contains(point) -> bool`.

This is the LC 715 design (without the `queryRange`). Use a sorted map keyed by interval lo, value is hi.

See `middle.md` section 8 for the Python implementation, and `interview.md` section 5 for the Java version. Skeleton in Go:

```go
type RangeSet struct {
    intervals *redblackTree   // ordered map<int, int>: lo -> hi
}

func (r *RangeSet) AddRange(lo, hi int) {
    // 1. Find any existing interval with .hi >= lo (floor or ceil).
    // 2. Expand lo and hi to absorb every overlapping or touching interval.
    // 3. Delete absorbed intervals; insert merged [lo, hi].
}

func (r *RangeSet) RemoveRange(lo, hi int) {
    // 1. Find every existing interval overlapping [lo, hi].
    // 2. For each, split off [iv.lo, lo) and (hi, iv.hi] if they remain.
    // 3. Delete the originals; insert the surviving fragments.
}

func (r *RangeSet) Contains(point int) bool {
    // Find the floor entry; check its hi covers point.
}
```

Verify by alternating 10 000 random `addRange`/`removeRange`/`contains` operations against a `set<int>` reference.

---

<a name="task-8"></a>
## Task 8. Bulk Build from Sorted Endpoints in O(n)

> Given a list of intervals with **endpoints already sorted by lo**, build a balanced augmented BST in O(n) (not O(n log n)).

The trick: treat the sorted input as a sorted array; the BST that is balanced and sorted is the **complete binary tree** that takes the middle element as root, recurses on left half for left child, right half for right child.

**Reference (Python):**

```python
def build_balanced(ivs):
    """ivs is sorted ascending by lo. Returns root of balanced augmented BST."""
    def rec(lo, hi):  # array indices
        if lo > hi: return None
        mid = (lo + hi) // 2
        node = _Node(ivs[mid], ivs[mid].hi)
        node.left  = rec(lo, mid - 1)
        node.right = rec(mid + 1, hi)
        if node.left  and node.left.subtree_max  > node.subtree_max: node.subtree_max = node.left.subtree_max
        if node.right and node.right.subtree_max > node.subtree_max: node.subtree_max = node.right.subtree_max
        return node
    return rec(0, len(ivs) - 1)
```

Each interval is visited once; the recursion is O(n). The resulting tree has height `⌈log₂(n+1)⌉` — exactly balanced.

For the centered tree, the same idea works using sorted endpoints — see `professional.md` section 4 for the median-of-medians refinement.

---

<a name="task-9"></a>
## Task 9. Persistent Interval Tree

> Build an interval tree where each `insert(iv)` returns a *new version* of the tree without mutating older versions.

Path-copying implementation. Immutable node class; insert copies every node on the path from the root to the new leaf.

**Reference (Python, plain BST persistence):**

```python
from dataclasses import dataclass
from typing import Optional

@dataclass(frozen=True)
class PNode:
    iv: Interval
    subtree_max: int
    left:  Optional["PNode"]
    right: Optional["PNode"]

def p_insert(root: Optional[PNode], iv: Interval) -> PNode:
    if root is None:
        return PNode(iv, iv.hi, None, None)
    if iv.lo < root.iv.lo:
        new_left = p_insert(root.left, iv)
        new_max = max(root.iv.hi, new_left.subtree_max,
                      root.right.subtree_max if root.right else float('-inf'))
        return PNode(root.iv, new_max, new_left, root.right)
    else:
        new_right = p_insert(root.right, iv)
        new_max = max(root.iv.hi, new_right.subtree_max,
                      root.left.subtree_max if root.left else float('-inf'))
        return PNode(root.iv, new_max, root.left, new_right)
```

Verify: insert intervals one by one, keeping all version roots; assert that each old version's `all_overlaps` still gives correct results corresponding to that older state.

To make it balanced + persistent, layer this technique on top of a persistent red-black tree (Okasaki, *Purely Functional Data Structures*, ch 3).

---

<a name="task-10"></a>
## Task 10. Solve LC 715 Range Module with an Interval Tree

> Implement `addRange(left, right)`, `queryRange(left, right) -> bool`, `removeRange(left, right)` on half-open intervals.

Two approaches:

**Easy approach (LC 715 actual solution).** Use a `TreeMap<Integer, Integer>` keyed by interval lo, maintain disjoint intervals. See `interview.md` section 5.

**Tougher approach (the spirit of this task).** Use a real augmented interval tree as the storage; on `addRange`, query for overlaps, merge them; on `removeRange`, query for overlaps, split them.

**Reference (Python with the IntervalTree from Task 1):**

```python
class RangeModule:
    def __init__(self):
        self.t = IntervalTree()

    def addRange(self, left, right):
        overlaps = self.t.all_overlaps(Interval(left, right - 1))   # half-open -> closed [left, right-1]
        merged_lo, merged_hi = left, right
        for iv in overlaps:
            merged_lo = min(merged_lo, iv.lo)
            merged_hi = max(merged_hi, iv.hi + 1)
            self.t.remove(iv)
        self.t.insert(Interval(merged_lo, merged_hi - 1))

    def queryRange(self, left, right):
        for iv in self.t.all_overlaps(Interval(left, right - 1)):
            if iv.lo <= left and iv.hi + 1 >= right:
                return True
        return False

    def removeRange(self, left, right):
        overlaps = self.t.all_overlaps(Interval(left, right - 1))
        for iv in overlaps:
            self.t.remove(iv)
            if iv.lo < left:        self.t.insert(Interval(iv.lo, left - 1))
            if iv.hi + 1 > right:   self.t.insert(Interval(right, iv.hi))
```

(You'll need to add a `remove(iv)` method to the IntervalTree from Task 1; standard BST delete plus `subtreeMax` recomputation on the affected path.)

Verify against the easy TreeMap solution on a long random sequence of operations.

---

That covers the practical skill set. By the time you finish all ten tasks you should be able to implement an interval tree from scratch in an interview, recognize when a sweep-line or greedy beats it, and reason about the production trade-offs of balancing, augmentation, concurrency, and persistence.
