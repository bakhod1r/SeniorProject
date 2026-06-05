# R-Tree — Interview Problems

> **Audience:** Engineers preparing for systems / database / spatial-algorithm interviews.

R-tree problems show up in interviews at companies that ship spatial data (Uber, Lyft, DoorDash, Mapbox, Airbnb), at search teams (Elasticsearch, Algolia, Pinterest), at game / graphics teams (Roblox, Niantic, Unity), and at infrastructure shops that need geo-aware load balancers. The questions test whether you understand multi-path descent, MBR enlargement, split heuristics, and the integration patterns from `senior.md`.

This document gives 10 graded problems with reference solutions in **Go**, **Java**, and **Python**.

---

## Table of Contents

1. [Implement an R-tree with quadratic split](#p1)
2. [Window range query](#p2)
3. [k-Nearest neighbours via priority queue](#p3)
4. [Bulk load with STR](#p4)
5. [Spatial join — all overlapping pairs](#p5)
6. [Polygon-contains-point lookup](#p6)
7. [Smallest enclosing rectangle of N rectangles](#p7)
8. [R\*-tree forced reinsertion](#p8)
9. [Range count without enumerating](#p9)
10. [3-D R-tree for spatio-temporal queries](#p10)

---

<a name="p1"></a>
## 1. Implement an R-tree with quadratic split

**Problem.** Implement a basic R-tree supporting `insert(rect, payload)` and `search(query_rect) -> list[payload]`. Use Guttman's quadratic split. Fanout `M = 4`, minimum `m = 2`.

**Approach.** This is the warm-up question. The full code is in `junior.md` §9. Interviewers want to hear you correctly describe `chooseSubtree` (minimum enlargement, ties by area), `splitNode` (pickSeeds picks the pair with the largest wasted-area cost, pickNext assigns by group preference, with forced-fill rule to maintain `m`), and `adjustTree` (walk up enlarging MBRs and propagating splits).

**Common pitfalls graded by interviewer:**

- Forgetting to walk back up and tighten MBRs.
- Not handling root split (when adjustTree returns a sibling at the root level).
- Off-by-one with the `forced fill` rule.

See `junior.md` for full Go / Java / Python implementations.

---

<a name="p2"></a>
## 2. Window range query

**Problem.** Given an R-tree of rectangles representing buildings and a query window `(x1, y1, x2, y2)`, return all buildings whose MBR intersects the window.

### Go
```go
func (t *RTree) Query(window Rect) []any {
    var out []any
    query(t.Root, window, &out)
    return out
}
func query(n *Node, w Rect, out *[]any) {
    for _, e := range n.Entries {
        if !e.MBR.Intersects(w) {
            continue
        }
        if n.Leaf {
            *out = append(*out, e.Payload)
        } else {
            query(e.Child, w, out)
        }
    }
}
```

### Java
```java
public List<Object> query(Rect window) {
    List<Object> out = new ArrayList<>();
    query(root, window, out);
    return out;
}
private void query(Node n, Rect w, List<Object> out) {
    for (Entry e : n.entries) {
        if (!e.mbr.intersects(w)) continue;
        if (n.leaf) out.add(e.payload);
        else query(e.child, w, out);
    }
}
```

### Python
```python
def query(self, window: Rect) -> list:
    out = []
    self._query(self.root, window, out)
    return out

def _query(self, n: Node, w: Rect, out: list) -> None:
    for e in n.entries:
        if not e.mbr.intersects(w):
            continue
        if n.leaf:
            out.append(e.payload)
        else:
            self._query(e.child, w, out)
```

**Complexity.** `O(log_M n + k)` average, `O(n)` worst (when overlap is heavy).

**Follow-up.** "How would you guarantee a worst-case `O(log_M n + k)`?" → R+ tree (forbid overlap by duplicating objects across siblings). Worth mentioning but rarely chosen in practice.

---

<a name="p3"></a>
## 3. k-Nearest neighbours via priority queue

**Problem.** Given a query point `q = (x, y)` and integer `k`, return the `k` rectangles whose nearest point to `q` is closest.

**Approach.** Best-first search with a min-priority queue keyed by `mindist(q, mbr)` (Roussopoulos, Kelley, Vincent 1995). When you pop a leaf entry, emit it; when you pop an internal entry, push its children.

### Python
```python
import heapq
def mindist(q, mbr):
    dx = max(mbr.min_x - q[0], 0, q[0] - mbr.max_x)
    dy = max(mbr.min_y - q[1], 0, q[1] - mbr.max_y)
    return (dx * dx + dy * dy) ** 0.5

def knn(self, q: tuple[float, float], k: int) -> list:
    pq: list = []
    heapq.heappush(pq, (0.0, 0, False, self.root))  # (d, tiebreak, is_leaf, node_or_entry)
    counter = 1
    out = []
    while pq and len(out) < k:
        d, _, is_leaf, item = heapq.heappop(pq)
        if is_leaf:
            out.append(item)
        else:
            node = item
            for e in node.entries:
                if node.leaf:
                    heapq.heappush(pq, (mindist(q, e.mbr), counter, True, e.payload))
                else:
                    heapq.heappush(pq, (mindist(q, e.mbr), counter, False, e.child))
                counter += 1
    return out
```

### Go
```go
type pqItem struct {
    Dist    float64
    IsLeaf  bool
    Payload any
    Node    *Node
    Order   int
}
type PQ []pqItem
func (p PQ) Len() int            { return len(p) }
func (p PQ) Less(i, j int) bool  { return p[i].Dist < p[j].Dist }
func (p PQ) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *PQ) Push(x any)         { *p = append(*p, x.(pqItem)) }
func (p *PQ) Pop() any           { old := *p; n := len(old); x := old[n-1]; *p = old[:n-1]; return x }

func mindist(qx, qy float64, r Rect) float64 {
    dx := math.Max(math.Max(r.MinX-qx, 0), qx-r.MaxX)
    dy := math.Max(math.Max(r.MinY-qy, 0), qy-r.MaxY)
    return math.Hypot(dx, dy)
}
func (t *RTree) KNN(qx, qy float64, k int) []any {
    pq := &PQ{{Dist: 0, Node: t.Root}}
    heap.Init(pq)
    var out []any
    ord := 0
    for pq.Len() > 0 && len(out) < k {
        it := heap.Pop(pq).(pqItem)
        if it.IsLeaf {
            out = append(out, it.Payload)
            continue
        }
        for _, e := range it.Node.Entries {
            ord++
            if it.Node.Leaf {
                heap.Push(pq, pqItem{Dist: mindist(qx, qy, e.MBR), IsLeaf: true, Payload: e.Payload, Order: ord})
            } else {
                heap.Push(pq, pqItem{Dist: mindist(qx, qy, e.MBR), Node: e.Child, Order: ord})
            }
        }
    }
    return out
}
```

### Java
```java
public List<Object> knn(double qx, double qy, int k) {
    PriorityQueue<double[]> pq = new PriorityQueue<>(Comparator.comparingDouble(a -> a[0]));
    // wrap each item: [dist, order, isLeaf? 1.0 : 0.0, index_into_storage]
    java.util.List<Object> nodes = new java.util.ArrayList<>();
    nodes.add(root);
    pq.add(new double[]{0.0, 0, 0.0, 0});
    List<Object> out = new ArrayList<>();
    int ord = 1;
    while (!pq.isEmpty() && out.size() < k) {
        double[] top = pq.poll();
        Object item = nodes.get((int) top[3]);
        boolean isLeaf = top[2] == 1.0;
        if (isLeaf) { out.add(item); continue; }
        Node n = (Node) item;
        for (Entry e : n.entries) {
            double d = mindist(qx, qy, e.mbr);
            if (n.leaf) {
                nodes.add(e.payload);
                pq.add(new double[]{d, ord++, 1.0, nodes.size() - 1});
            } else {
                nodes.add(e.child);
                pq.add(new double[]{d, ord++, 0.0, nodes.size() - 1});
            }
        }
    }
    return out;
}
private double mindist(double qx, double qy, Rect r) {
    double dx = Math.max(Math.max(r.minX - qx, 0), qx - r.maxX);
    double dy = Math.max(Math.max(r.minY - qy, 0), qy - r.maxY);
    return Math.hypot(dx, dy);
}
```

**Complexity.** `O(log n + k)` average; `O(n)` worst when MBRs cluster at the same distance.

**Follow-up.** Add MINMAXDIST pruning (Roussopoulos 1995) — tighter bound but trickier code.

---

<a name="p4"></a>
## 4. Bulk load with STR

**Problem.** Given `n` rectangles up front, build the R-tree in `O(n log n)` using Sort-Tile-Recursive.

**Approach.** Sort by centroid x, partition into `⌈√(n/M)⌉` slices, sort each slice by centroid y, partition each slice into groups of `M` to form leaves; recurse on the leaves' MBRs.

### Python
```python
import math
def str_pack(entries: list, M: int) -> Node:
    if len(entries) <= M:
        return Node(leaf=True, entries=entries)
    P = math.ceil(len(entries) / M)
    S = math.ceil(math.sqrt(P))
    entries.sort(key=lambda e: 0.5 * (e.mbr.min_x + e.mbr.max_x))
    slice_size = math.ceil(len(entries) / S)
    children = []
    for s in range(S):
        sl = entries[s * slice_size : (s + 1) * slice_size]
        sl.sort(key=lambda e: 0.5 * (e.mbr.min_y + e.mbr.max_y))
        for i in range(0, len(sl), M):
            leaf = Node(leaf=True, entries=sl[i:i + M])
            children.append(Entry(mbr=mbr_of(leaf.entries), child=leaf))
    return str_pack_internal(children, M)
```

### Go
```go
func STRPack(entries []Entry, M int) *Node {
    if len(entries) <= M {
        return &Node{Leaf: true, Entries: entries}
    }
    P := int(math.Ceil(float64(len(entries)) / float64(M)))
    S := int(math.Ceil(math.Sqrt(float64(P))))
    sort.Slice(entries, func(i, j int) bool {
        return 0.5*(entries[i].MBR.MinX+entries[i].MBR.MaxX) <
            0.5*(entries[j].MBR.MinX+entries[j].MBR.MaxX)
    })
    sliceSize := (len(entries) + S - 1) / S
    var children []Entry
    for s := 0; s < S; s++ {
        lo := s * sliceSize
        hi := lo + sliceSize
        if hi > len(entries) {
            hi = len(entries)
        }
        sl := append([]Entry(nil), entries[lo:hi]...)
        sort.Slice(sl, func(i, j int) bool {
            return 0.5*(sl[i].MBR.MinY+sl[i].MBR.MaxY) <
                0.5*(sl[j].MBR.MinY+sl[j].MBR.MaxY)
        })
        for i := 0; i < len(sl); i += M {
            end := i + M
            if end > len(sl) {
                end = len(sl)
            }
            leaf := &Node{Leaf: true, Entries: append([]Entry(nil), sl[i:end]...)}
            children = append(children, Entry{MBR: mbrOf(leaf.Entries), Child: leaf})
        }
    }
    return STRPack(children, M)
}
```

### Java
```java
public Node strPack(List<Entry> entries, int M) {
    if (entries.size() <= M) {
        Node leaf = new Node(true);
        leaf.entries = new ArrayList<>(entries);
        return leaf;
    }
    int P = (entries.size() + M - 1) / M;
    int S = (int) Math.ceil(Math.sqrt(P));
    entries.sort(Comparator.comparingDouble(e -> 0.5 * (e.mbr.minX + e.mbr.maxX)));
    int sliceSize = (entries.size() + S - 1) / S;
    List<Entry> children = new ArrayList<>();
    for (int s = 0; s < S; s++) {
        int lo = s * sliceSize;
        int hi = Math.min(lo + sliceSize, entries.size());
        List<Entry> sl = new ArrayList<>(entries.subList(lo, hi));
        sl.sort(Comparator.comparingDouble(e -> 0.5 * (e.mbr.minY + e.mbr.maxY)));
        for (int i = 0; i < sl.size(); i += M) {
            int end = Math.min(i + M, sl.size());
            Node leaf = new Node(true);
            leaf.entries = new ArrayList<>(sl.subList(i, end));
            children.add(new Entry(mbrOf(leaf.entries), leaf, null));
        }
    }
    return strPack(children, M);
}
```

**Complexity.** `O(n log n)` build, `O(n)` space. Produces a tree with ~100% leaf fill and minimal sibling overlap.

---

<a name="p5"></a>
## 5. Spatial join — all overlapping pairs

**Problem.** Given two R-trees `R` and `S`, return every pair `(r, s)` such that `r.mbr` intersects `s.mbr`.

**Approach.** Synchronised tree traversal (Brinkhoff, Kriegel, Seeger 1993). Walk both trees in lockstep; at each pair of nodes, only descend into pairs of children whose MBRs intersect.

### Python
```python
def spatial_join(r_root: Node, s_root: Node) -> list:
    out = []
    _join(r_root, s_root, out)
    return out

def _join(rn: Node, sn: Node, out: list) -> None:
    for re in rn.entries:
        for se in sn.entries:
            if not re.mbr.intersects(se.mbr):
                continue
            if rn.leaf and sn.leaf:
                out.append((re.payload, se.payload))
            elif rn.leaf:
                _join(rn, se.child, out)
            elif sn.leaf:
                _join(re.child, sn, out)
            else:
                _join(re.child, se.child, out)
```

(Go and Java translations are mechanical; same control flow.)

**Complexity.** `O(n + m + k)` average, `O(nm)` worst case. The synchronised descent prunes most pairs without ever descending.

**Follow-up.** Mention plane-sweep within node-pair join (`O(M log M)` instead of `O(M²)` per pair) for large M.

---

<a name="p6"></a>
## 6. Polygon-contains-point lookup

**Problem.** Given polygons indexed in an R-tree and a query point `q`, return all polygons containing `q`.

**Approach.** Two-phase: (a) R-tree returns candidates whose MBR contains `q`; (b) exact point-in-polygon test on each candidate.

### Python
```python
def contains_point(self, qx: float, qy: float) -> list:
    candidates = []
    self._query_point(self.root, qx, qy, candidates)
    return [p for p in candidates if point_in_polygon(qx, qy, p.polygon)]

def _query_point(self, n: Node, qx: float, qy: float, out: list) -> None:
    for e in n.entries:
        if not (e.mbr.min_x <= qx <= e.mbr.max_x and e.mbr.min_y <= qy <= e.mbr.max_y):
            continue
        if n.leaf:
            out.append(e.payload)
        else:
            self._query_point(e.child, qx, qy, out)
```

`point_in_polygon` uses the classic ray-casting test (count edge crossings).

**This is PostGIS's `ST_Contains(geom, point)` query** in miniature. The R-tree is the filter; the exact predicate refines.

---

<a name="p7"></a>
## 7. Smallest enclosing rectangle of N rectangles

**Problem.** Compute the MBR containing every rectangle in the tree, in `O(1)` if you maintain a cached root MBR, or `O(n)` if you rebuild.

**Approach.** The root's entries already store MBRs; the tree's overall MBR is the union of root entry MBRs.

### Python
```python
def total_mbr(self) -> Rect:
    if not self.root.entries:
        return Rect(0, 0, 0, 0)
    m = self.root.entries[0].mbr
    for e in self.root.entries[1:]:
        m = m.union(e.mbr)
    return m
```

**Interview value.** This question tests whether you understand the R-tree's MBR aggregation invariant. Production R-trees often cache the root MBR for `O(1)` access.

---

<a name="p8"></a>
## 8. R\*-tree forced reinsertion

**Problem.** Implement the forced-reinsertion branch of R\*-tree insertion. On overflow, remove the 30% of entries farthest from the node's MBR centre and reinsert them from the root.

**Approach.** Track per-insertion which levels have already reinserted (so you don't loop forever). On first overflow at a level, run reinsertion; on subsequent overflow, fall back to split.

### Python
```python
def insert_rstar(self, r: Rect, payload) -> None:
    self._reinsert_done = set()
    self._do_insert(r, payload, level=0)

def _do_insert(self, r: Rect, payload, level: int) -> None:
    leaf = self._choose_leaf_rstar(self.root, r)
    leaf.entries.append(Entry(mbr=r, payload=payload))
    self._handle_overflow(leaf)

def _handle_overflow(self, node: Node) -> None:
    if len(node.entries) <= MAX_ENTRIES:
        return
    level = self._depth_of(node)
    if level not in self._reinsert_done and node is not self.root:
        self._reinsert_done.add(level)
        self._forced_reinsert(node)
    else:
        sibling = self._split_node(node)
        self._adjust_tree(node, sibling)

def _forced_reinsert(self, node: Node) -> None:
    cx, cy = self._centroid(node_mbr(node))
    sorted_entries = sorted(
        node.entries,
        key=lambda e: -((0.5 * (e.mbr.min_x + e.mbr.max_x) - cx) ** 2
                        + (0.5 * (e.mbr.min_y + e.mbr.max_y) - cy) ** 2),
    )
    p = int(0.3 * MAX_ENTRIES)
    to_reinsert = sorted_entries[:p]
    node.entries = sorted_entries[p:]
    self._adjust_tree(node, None)
    for e in to_reinsert:
        self.insert_rstar(e.mbr, e.payload)
```

(Go and Java follow the same control flow with explicit data structures.)

**Interview emphasis.** Call out:
- The level marker is per-insertion, reset at top-level.
- 30% is empirically chosen by Beckmann et al.
- Forced reinsertion globally reduces overlap; without it, R\*-tree degrades to R-tree quality.

---

<a name="p9"></a>
## 9. Range count without enumerating

**Problem.** Given a query rectangle, count how many leaf entries intersect it — without returning them. Used by query planners for cardinality estimation.

### Python
```python
def count(self, q: Rect) -> int:
    return self._count(self.root, q)

def _count(self, n: Node, q: Rect) -> int:
    total = 0
    for e in n.entries:
        if not e.mbr.intersects(q):
            continue
        if n.leaf:
            total += 1
        else:
            total += self._count(e.child, q)
    return total
```

**Optimisation.** If an internal node's MBR is *fully contained* in the query, you can short-circuit: every entry below it is in the result. This requires each internal node to cache its total leaf count, but cuts traversal by orders of magnitude on large queries.

```python
def _count_optimised(self, n: Node, q: Rect) -> int:
    total = 0
    for e in n.entries:
        if not e.mbr.intersects(q):
            continue
        if q.contains(e.mbr):                # full containment
            total += e.leaf_count            # precomputed
        elif n.leaf:
            total += 1
        else:
            total += self._count_optimised(e.child, q)
    return total
```

This is the trick PostGIS query planners use for `ST_Estimated_Extent`.

---

<a name="p10"></a>
## 10. 3-D R-tree for spatio-temporal queries

**Problem.** Index moving objects (vehicle positions with timestamps) and answer: "Which objects were in this region during time window `[t1, t2]`?"

**Approach.** Treat each position as a 3-D AABB `(x_min, y_min, t_min, x_max, y_max, t_max)`. Build a 3-D R-tree; queries are 3-D range queries.

### Python (3-D Rect helpers)
```python
@dataclass
class Rect3D:
    min_x: float; min_y: float; min_t: float
    max_x: float; max_y: float; max_t: float

    def intersects(self, o: "Rect3D") -> bool:
        return not (o.min_x > self.max_x or o.max_x < self.min_x or
                    o.min_y > self.max_y or o.max_y < self.min_y or
                    o.min_t > self.max_t or o.max_t < self.min_t)

    def union(self, o: "Rect3D") -> "Rect3D":
        return Rect3D(min(self.min_x, o.min_x), min(self.min_y, o.min_y), min(self.min_t, o.min_t),
                      max(self.max_x, o.max_x), max(self.max_y, o.max_y), max(self.max_t, o.max_t))

    def volume(self) -> float:
        return ((self.max_x - self.min_x) *
                (self.max_y - self.min_y) *
                (self.max_t - self.min_t))
```

Reuse the 2-D R-tree code with `Rect3D` everywhere. Split heuristics generalise: `pickSeeds` iterates over pairs; `pickNext` uses 3-D enlargement (`volume` instead of `area`).

**Real example.** Uber's Marmaray pipeline indexes driver pings in 3-D space-time; queries like "find every driver who passed through this neighbourhood between 5 and 6 PM yesterday" hit a partitioned 3-D R-tree.

**Follow-up.** Mention the **curse of dimensionality** in higher D; for ~10+ dimensions, switch to HNSW or IVF-PQ.

---

## Cheat sheet — interview-ready summary

```
INSERT
  chooseLeaf by minimum enlargement (ties: smallest area)
  on overflow: Guttman quadratic split OR R*-tree split
  walk up enlarging MBRs; propagate splits; grow tree on root split

SEARCH(window)
  descend EVERY child whose MBR intersects window
  worst case O(n) if overlap is heavy

KNN(q, k)
  best-first with priority queue of mindist(q, mbr)
  emit a popped leaf; expand a popped internal node

BULK LOAD (STR)
  sort by x → slice → sort by y → pack groups of M → recurse

SPATIAL JOIN
  synchronised traversal: pair intersecting children, recurse

R* DIFFERENCES
  - leaf-level chooseSubtree minimises overlap not enlargement
  - perimeter-based split with overlap tiebreak
  - forced reinsertion (30% farthest) on first overflow per level

VARIANTS
  R+ : zero overlap, duplicate objects
  Hilbert R-tree : pack by Hilbert key, B+ tree under the hood
  STR pack : O(n log n) bulk build
```

---

## Quick reference — "what would you use?"

| Problem | Answer |
|---|---|
| Range query on building footprints | R-tree (or R\*-tree) |
| Embedded mobile map | SQLite RTREE module |
| Production geospatial DB | PostGIS (GiST + R\*-tree) |
| Append-only geo / numeric search | Lucene BKD-tree |
| Spatial join at TB scale | Apache Sedona / SpatialHadoop |
| Vehicle position tracking | 3-D R-tree |
| Game physics broadphase | BVH (3-D R-tree) |
| High-D similarity (vectors) | HNSW / IVF-PQ, NOT R-tree |
