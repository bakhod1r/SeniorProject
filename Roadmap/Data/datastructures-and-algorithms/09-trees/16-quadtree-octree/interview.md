# Quadtree and Octree — Interview Problems

> **Audience:** Engineers preparing for systems/algorithms interviews where spatial data structures appear. Prerequisite: `junior.md` and `middle.md`.

This file collects 10 problems that have appeared in real interviews and LeetCode contests, each with full Go, Java, and Python solutions plus brief discussion. The problems progress from canonical LeetCode quadtree puzzles to practical scenarios — collision detection, k-NN, Barnes-Hut, region compression.

---

## Table of Contents

1. [LC 427 — Construct Quad Tree](#p1)
2. [LC 558 — Logical OR of Two Quad Trees](#p2)
3. [Build PR-Quadtree + Range Query](#p3)
4. [2D Nearest Neighbor via Quadtree](#p4)
5. [k-NN with Priority Queue Pruning](#p5)
6. [Collision Detection — N Circles per Frame](#p6)
7. [Construct Octree from Voxel Grid + Compress](#p7)
8. [Morton-Encoded Linear Quadtree](#p8)
9. [Barnes-Hut Force Approximation (Toy 2D)](#p9)
10. [Region Quadtree for B/W Image — Compression Ratio](#p10)

---

<a name="p1"></a>
## 1. LC 427 — Construct Quad Tree

**Problem.** Given an `n × n` binary grid (n is a power of 2), build the region quadtree representing it. A node is a *leaf* if its grid region is uniform (all 0s or all 1s); otherwise it has 4 children for the 4 sub-quadrants. Return the root.

**Approach.** Recurse: if the current region is uniform, emit a leaf with that value; otherwise split into 4 equal sub-quadrants and recurse on each.

**Python:**
```python
class Node:
    def __init__(self, val: bool, isLeaf: bool, topLeft=None, topRight=None, bottomLeft=None, bottomRight=None):
        self.val = val
        self.isLeaf = isLeaf
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomLeft = bottomLeft
        self.bottomRight = bottomRight

class Solution:
    def construct(self, grid: list[list[int]]) -> Node:
        def build(r: int, c: int, size: int) -> Node:
            first = grid[r][c]
            uniform = all(grid[r + i][c + j] == first
                          for i in range(size) for j in range(size))
            if uniform:
                return Node(bool(first), True)
            h = size // 2
            return Node(True, False,
                        build(r,     c,     h),
                        build(r,     c + h, h),
                        build(r + h, c,     h),
                        build(r + h, c + h, h))
        return build(0, 0, len(grid))
```

**Go:**
```go
type Node struct {
    Val, IsLeaf bool
    TopLeft, TopRight, BottomLeft, BottomRight *Node
}

func construct(grid [][]int) *Node {
    var build func(r, c, size int) *Node
    build = func(r, c, size int) *Node {
        first := grid[r][c]
        uniform := true
        for i := 0; i < size && uniform; i++ {
            for j := 0; j < size; j++ {
                if grid[r+i][c+j] != first {
                    uniform = false
                    break
                }
            }
        }
        if uniform {
            return &Node{Val: first == 1, IsLeaf: true}
        }
        h := size / 2
        return &Node{
            Val: true, IsLeaf: false,
            TopLeft:     build(r,   c,   h),
            TopRight:    build(r,   c+h, h),
            BottomLeft:  build(r+h, c,   h),
            BottomRight: build(r+h, c+h, h),
        }
    }
    return build(0, 0, len(grid))
}
```

**Java:**
```java
class Node {
    public boolean val, isLeaf;
    public Node topLeft, topRight, bottomLeft, bottomRight;
}

class Solution {
    public Node construct(int[][] grid) {
        return build(grid, 0, 0, grid.length);
    }
    private Node build(int[][] g, int r, int c, int size) {
        int first = g[r][c];
        boolean uniform = true;
        for (int i = 0; i < size && uniform; i++)
            for (int j = 0; j < size; j++)
                if (g[r + i][c + j] != first) { uniform = false; break; }
        Node n = new Node();
        if (uniform) { n.val = first == 1; n.isLeaf = true; return n; }
        int h = size / 2;
        n.val = true; n.isLeaf = false;
        n.topLeft     = build(g, r,     c,     h);
        n.topRight    = build(g, r,     c + h, h);
        n.bottomLeft  = build(g, r + h, c,     h);
        n.bottomRight = build(g, r + h, c + h, h);
        return n;
    }
}
```

**Optimization.** Build bottom-up: if all 4 children are leaves with the same value, collapse to a single leaf. Same correctness, half the recursion in uniform regions.

**Complexity.** O(n² log n) worst case, O(k) where k is the number of nodes in the output tree for a sparse image.

---

<a name="p2"></a>
## 2. LC 558 — Logical OR of Two Quad Trees

**Problem.** Given two quad trees of the same dimension, return the quad tree representing their logical OR.

**Approach.** Recurse simultaneously on both. Base cases:
- If either is a leaf with value 1, the result is a leaf with value 1.
- If either is a leaf with value 0, the result is the other.
- Otherwise recurse on all 4 child pairs; if all 4 results are leaves with the same value, collapse.

**Python:**
```python
class Solution:
    def intersect(self, q1: Node, q2: Node) -> Node:
        if q1.isLeaf:
            return q1 if q1.val else q2
        if q2.isLeaf:
            return q2 if q2.val else q1
        tl = self.intersect(q1.topLeft, q2.topLeft)
        tr = self.intersect(q1.topRight, q2.topRight)
        bl = self.intersect(q1.bottomLeft, q2.bottomLeft)
        br = self.intersect(q1.bottomRight, q2.bottomRight)
        if tl.isLeaf and tr.isLeaf and bl.isLeaf and br.isLeaf and \
           tl.val == tr.val == bl.val == br.val:
            return Node(tl.val, True)
        return Node(True, False, tl, tr, bl, br)
```

**Go and Java**: identical structure.

**Insight.** This pattern (recurse on two trees simultaneously with leaf-shortcut) generalizes to any boolean operation — AND, XOR, NOT — and to spatial set operations on the corresponding region quadtrees. Used in CAD systems for boolean operations on 2D regions and 3D solids.

---

<a name="p3"></a>
## 3. Build PR-Quadtree + Range Query

**Problem.** Given n points and a list of query rectangles, return for each query the list of points inside. Build a PR-quadtree once; query many times.

**Solution.** Use the `Quadtree` class from `junior.md`. Build by inserting all n points; for each query call `QueryRange`.

**Python:**
```python
def solve(points: list[Point], queries: list[Bbox]) -> list[list[Point]]:
    world = Bbox(50, 50, 50, 50)        # tune to enclose all points
    qt = Quadtree(world, capacity=8)
    for p in points:
        qt.insert(p)
    answers = []
    for rect in queries:
        out: list[Point] = []
        qt.query_range(rect, out)
        answers.append(out)
    return answers
```

**Discussion.** Time: O(n log n) build + O(log n + k) per query (avg). For 10^5 points and 10^4 queries the naive O(nq) = 10^9 baseline is replaced by ~10^6 operations.

---

<a name="p4"></a>
## 4. 2D Nearest Neighbor via Quadtree

**Problem.** Given n stored points and a query point q, return the closest stored point.

**Solution.** Branch-and-bound as described in `middle.md` §7. Use a min-heap of (bbox-distance, node) to descend in order of decreasing potential.

**Go:**
```go
import "container/heap"

type item struct{ dist float64; node *Quadtree }
type pq []item
func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(item)) }
func (p *pq) Pop() interface{}   { old := *p; x := old[len(old)-1]; *p = old[:len(old)-1]; return x }

func (q *Quadtree) Nearest(query Point) (Point, bool) {
    best := math.Inf(1)
    var bestP Point
    found := false
    h := &pq{{dist: 0, node: q}}
    heap.Init(h)
    for h.Len() > 0 {
        it := heap.Pop(h).(item)
        if it.dist >= best { break }
        for _, p := range it.node.Points {
            d := math.Hypot(p.X-query.X, p.Y-query.Y)
            if d < best { best = d; bestP = p; found = true }
        }
        if it.node.Divided {
            for _, c := range []*Quadtree{it.node.NE, it.node.NW, it.node.SE, it.node.SW} {
                d := distPointToBbox(query, c.Boundary)
                if d < best {
                    heap.Push(h, item{dist: d, node: c})
                }
            }
        }
    }
    return bestP, found
}
```

**Complexity.** O(log n) average; O(n) worst case.

---

<a name="p5"></a>
## 5. k-NN with Priority Queue Pruning

**Problem.** Given n stored points and a query point q, return the k nearest.

**Solution.** Variant of #4 with a max-heap of size k holding the current k best. The pruning bound is the max of this heap.

**Python:**
```python
import heapq, math

def knn(qt, q: Point, k: int) -> list[Point]:
    best: list[tuple[float, int, Point]] = []   # max-heap via negated distance
    counter = 0
    def consider(p: Point):
        nonlocal counter
        d = math.hypot(p.x - q.x, p.y - q.y)
        if len(best) < k:
            heapq.heappush(best, (-d, counter, p))
            counter += 1
        elif d < -best[0][0]:
            heapq.heapreplace(best, (-d, counter, p))
            counter += 1
    def cur_bound() -> float:
        return -best[0][0] if len(best) == k else math.inf

    heap: list[tuple[float, int, 'Quadtree']] = [(0.0, 0, qt)]
    n_counter = 1
    while heap:
        d, _, node = heapq.heappop(heap)
        if d >= cur_bound():
            break
        for p in node.points:
            consider(p)
        if node.divided:
            for c in (node.NE, node.NW, node.SE, node.SW):
                dc = dist_point_to_bbox(q, c.boundary)
                if dc < cur_bound():
                    heapq.heappush(heap, (dc, n_counter, c))
                    n_counter += 1
    return sorted([p for _, _, p in best], key=lambda p: math.hypot(p.x - q.x, p.y - q.y))
```

**Complexity.** O((k + log n) · log n) average.

---

<a name="p6"></a>
## 6. Collision Detection — N Circles per Frame

**Problem.** Given N moving circles (position + radius), find every pair that overlaps in the current frame.

**Solution.** Build a fresh PR-quadtree of circle bbox-centers each frame. For each circle, query the rectangle `[cx - r, cy - r, cx + r, cy + r]` enlarged by the maximum possible radius (so we catch all circles whose bboxes might overlap). Among returned candidates, do exact circle-circle distance check.

**Python:**
```python
def find_collisions(circles: list[tuple[float, float, float]]) -> list[tuple[int, int]]:
    """circles[i] = (cx, cy, r). Returns list of colliding index pairs."""
    if not circles:
        return []
    max_r = max(r for _, _, r in circles)
    world = compute_enclosing_bbox(circles)
    qt = Quadtree(world, capacity=8)
    pts: list[Point] = []
    for i, (cx, cy, _) in enumerate(circles):
        p = Point(cx, cy)
        pts.append(p)
        qt.insert(p)
    pt_to_idx = {(p.x, p.y): i for i, p in enumerate(pts)}     # crude reverse map for demo
    pairs = []
    for i, (cx, cy, r) in enumerate(circles):
        rect = Bbox(cx, cy, r + max_r, r + max_r)
        candidates: list[Point] = []
        qt.query_range(rect, candidates)
        for c in candidates:
            j = pt_to_idx[(c.x, c.y)]
            if j <= i:
                continue            # avoid double-counting
            cx2, cy2, r2 = circles[j]
            dist2 = (cx - cx2) ** 2 + (cy - cy2) ** 2
            if dist2 <= (r + r2) ** 2:
                pairs.append((i, j))
    return pairs
```

**Production note.** A real engine maintains the quadtree across frames and updates only moved objects (remove + reinsert if out-of-cell). For 10^4 dynamic circles this is the standard broad-phase pattern; sub-millisecond per frame on a modern CPU.

---

<a name="p7"></a>
## 7. Construct Octree from Voxel Grid + Compress

**Problem.** Given an `n × n × n` boolean voxel grid (n a power of 2), build the region octree and report the number of nodes.

**Approach.** Same as LC 427 in 3D. Recurse on cubic regions; collapse uniform regions to leaves.

**Python:**
```python
class OctreeNode:
    def __init__(self, val: bool, is_leaf: bool, children=None):
        self.val = val
        self.is_leaf = is_leaf
        self.children = children or [None] * 8

def build_octree(g, x: int, y: int, z: int, size: int) -> OctreeNode:
    first = g[x][y][z]
    uniform = all(g[x + i][y + j][z + k] == first
                  for i in range(size) for j in range(size) for k in range(size))
    if uniform:
        return OctreeNode(bool(first), True)
    h = size // 2
    children = []
    for oct_idx in range(8):
        dx = h if (oct_idx & 1) else 0
        dy = h if (oct_idx & 2) else 0
        dz = h if (oct_idx & 4) else 0
        children.append(build_octree(g, x + dx, y + dy, z + dz, h))
    if all(c.is_leaf and c.val == children[0].val for c in children):
        return OctreeNode(children[0].val, True)        # late collapse
    return OctreeNode(True, False, children)
```

**Complexity.** O(n³) cells; output size depends on spatial regularity. For mostly-empty space (a cloud, a tree), compression often reduces node count by 100× vs the dense grid.

---

<a name="p8"></a>
## 8. Morton-Encoded Linear Quadtree

**Problem.** Implement Morton encode/decode for 16-bit (x, y) → 32-bit key, and a sort-by-Morton range query.

**Python:**
```python
def part1by1(n: int) -> int:
    n &= 0xFFFF
    n = (n | (n << 8)) & 0x00FF00FF
    n = (n | (n << 4)) & 0x0F0F0F0F
    n = (n | (n << 2)) & 0x33333333
    n = (n | (n << 1)) & 0x55555555
    return n

def compact1by1(n: int) -> int:
    n &= 0x55555555
    n = (n | (n >> 1)) & 0x33333333
    n = (n | (n >> 2)) & 0x0F0F0F0F
    n = (n | (n >> 4)) & 0x00FF00FF
    n = (n | (n >> 8)) & 0x0000FFFF
    return n

def morton2d(x: int, y: int) -> int:
    return (part1by1(y) << 1) | part1by1(x)

def unmorton2d(m: int) -> tuple[int, int]:
    return compact1by1(m), compact1by1(m >> 1)

class LinearQuadtree:
    """Sorted array keyed by Morton code. Range query via scan with prune."""
    def __init__(self, points: list[tuple[int, int]]):
        self.points = sorted(points, key=lambda p: morton2d(p[0], p[1]))
        self.keys = [morton2d(x, y) for x, y in self.points]

    def range_query(self, xmin: int, ymin: int, xmax: int, ymax: int) -> list[tuple[int, int]]:
        # Simple scan with pruning; production code uses Litmax/Bigmin.
        out = []
        from bisect import bisect_left
        lo_key = morton2d(xmin, ymin)
        hi_key = morton2d(xmax, ymax)
        lo = bisect_left(self.keys, lo_key)
        for i in range(lo, len(self.keys)):
            if self.keys[i] > hi_key:
                break
            x, y = self.points[i]
            if xmin <= x <= xmax and ymin <= y <= ymax:
                out.append((x, y))
        return out
```

**Note.** The Morton-key range `[lo_key, hi_key]` overestimates the query rectangle (Z-curve excursions); the per-point filter inside catches false positives. Tropf-Herzog's Litmax/Bigmin algorithm computes the next valid Morton code after the curve leaves the rect — required for guaranteed O(log n + k).

---

<a name="p9"></a>
## 9. Barnes-Hut Force Approximation (Toy 2D)

**Problem.** Given n bodies with (x, y, mass), compute the gravitational force on each body using a quadtree.

**Approach.** Build a quadtree where each internal node stores the total mass and center of mass of its subtree. When computing force on body B from a node N: if `node.size / distance(B, node.com) < theta`, use N as a single body at its center of mass; else recurse into children.

**Python:**
```python
import math

THETA = 0.5
G = 1.0

class BHQuad:
    def __init__(self, boundary: Bbox):
        self.boundary = boundary
        self.body = None                # (x, y, m) if leaf with one body
        self.com_x = self.com_y = 0.0   # center of mass
        self.mass = 0.0
        self.children: list['BHQuad'] | None = None

    def insert(self, b: tuple[float, float, float]) -> None:
        x, y, m = b
        if self.body is None and self.children is None:
            self.body = b
            self.com_x, self.com_y, self.mass = x, y, m
            return
        if self.children is None:
            self._subdivide()
            existing = self.body
            self.body = None
            self._insert_into_child(existing)
        self._insert_into_child(b)
        total_m = self.mass + m
        self.com_x = (self.com_x * self.mass + x * m) / total_m
        self.com_y = (self.com_y * self.mass + y * m) / total_m
        self.mass = total_m

    def _subdivide(self) -> None:
        b = self.boundary
        h, v = b.hw / 2, b.hh / 2
        self.children = [
            BHQuad(Bbox(b.cx + h, b.cy + v, h, v)),    # NE
            BHQuad(Bbox(b.cx - h, b.cy + v, h, v)),    # NW
            BHQuad(Bbox(b.cx + h, b.cy - v, h, v)),    # SE
            BHQuad(Bbox(b.cx - h, b.cy - v, h, v)),    # SW
        ]

    def _insert_into_child(self, b: tuple[float, float, float]) -> None:
        x, y, _ = b
        for c in self.children:
            if c.boundary.contains(Point(x, y)):
                c.insert(b)
                return

    def force_on(self, body: tuple[float, float, float]) -> tuple[float, float]:
        x, y, _ = body
        dx = self.com_x - x
        dy = self.com_y - y
        d = math.sqrt(dx * dx + dy * dy) + 1e-9
        if self.children is None:
            if self.body is None or self.body == body:
                return 0.0, 0.0
            f = G * self.mass / (d * d * d)
            return f * dx, f * dy
        size = 2 * self.boundary.hw
        if size / d < THETA:
            f = G * self.mass / (d * d * d)
            return f * dx, f * dy
        fx = fy = 0.0
        for c in self.children:
            cfx, cfy = c.force_on(body)
            fx += cfx; fy += cfy
        return fx, fy
```

**Complexity.** O(N log N) per step instead of O(N²). For N = 10^4 the speedup is ~1000×.

---

<a name="p10"></a>
## 10. Region Quadtree for B/W Image + Compression Ratio

**Problem.** Given an `n × n` black/white image, build the region quadtree and compute the compression ratio (`n² bits / nodes_in_tree`).

**Approach.** Build via LC 427 algorithm. Count nodes.

**Python:**
```python
def compress_image(grid: list[list[int]]) -> tuple[int, int, float]:
    """Returns (n*n, num_nodes, ratio)."""
    n = len(grid)
    node_count = 0
    def build(r: int, c: int, size: int) -> bool:
        nonlocal node_count
        first = grid[r][c]
        uniform = all(grid[r + i][c + j] == first
                      for i in range(size) for j in range(size))
        node_count += 1
        if uniform:
            return True
        h = size // 2
        build(r,     c,     h)
        build(r,     c + h, h)
        build(r + h, c,     h)
        build(r + h, c + h, h)
        return False
    build(0, 0, n)
    return n * n, node_count, (n * n) / node_count
```

**Discussion.** For a 256×256 scan of clean text, the quadtree typically has 5K-15K nodes vs 65K pixels → ~5× compression. For a photograph, the tree has nearly one leaf per pixel → no compression. Choose region quadtree for **piecewise-uniform** sources only.

---

## Interview Tips

- **Recognize the spatial cue.** "Find within rect", "nearest", "collisions", "tile zoom" all map to quadtree.
- **Start with the bbox-prune pattern.** Even if you cannot remember subdivide exactly, sketch the "if not intersect, return" recursion and the interviewer will nod.
- **Mention the constant-factor argument.** Quadtree's O(log n + k) is great, but the real win is pruning empty space. Saying so demonstrates depth.
- **Know when NOT to use a quadtree.** Static k-NN → k-d tree. Many overlapping rectangles → R-tree. Mass dynamic objects → spatial hash. Saying "I'd reach for X here instead" is a strong signal.
- **Code subdivide carefully.** It is the easiest place to bug out. Center+half-extents is the safest form.

Continue with `tasks.md` for hands-on implementation exercises.
