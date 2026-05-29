# Quadtree and Octree — Junior Level

> **Read time: ~40 minutes** · **Audience:** Students comfortable with binary trees and 2D coordinates, ready to extend tree thinking into space.

A quadtree is a tree where **every internal node has exactly four children**, and each node owns a rectangular region of 2D space that is split into four equal quadrants among its children. An octree is the 3D analog: every internal node has eight children, and each owns a cube subdivided into eight octants. These two structures are the workhorse spatial indexes of computer graphics, GIS, robotics, physics simulation, and game collision detection. If you have ever wondered how Google Maps loads only the tiles you can see, how Minecraft stores billions of blocks, or how a game can detect collisions among ten thousand moving objects in a single millisecond — the answer almost always involves a quadtree or an octree.

This document teaches the **point-region quadtree** (the most common variant) from scratch, then shows the octree as a near-identical 3D generalization. We cover bounding-box arithmetic, the recursive insert with subdivision, range queries, the pitfalls of coincident points and infinite subdivision, and the practical bucket-size and depth-limit choices that separate a textbook implementation from a production one. By the end, you will be able to write a quadtree from memory and reason about its performance on real workloads.

---

## Table of Contents

1. [Introduction — Pruning Empty Space](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Subdivision and Recursion](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs k-d Tree](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — The Recursive Bbox Prune](#patterns)
11. [Error Handling — Boundary Conventions](#errors)
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
## 1. Introduction — Pruning Empty Space

You are writing a 2D game with ten thousand asteroids floating around a screen. Every frame you must answer: *for each asteroid, which other asteroids might it collide with?* The naive approach compares every pair — 10,000 × 10,000 = 100 million comparisons per frame. At 60 FPS that is 6 billion comparisons per second. Your laptop's CPU caves in.

The fix is to **stop comparing things that are obviously far apart**. Divide the screen into four quadrants. An asteroid in the top-left quadrant cannot collide with one in the bottom-right; you do not even need to test that pair. Subdivide further: each quadrant becomes four sub-quadrants. Now an asteroid sitting in the top-left sub-quadrant of the top-left quadrant only ever needs to test against its handful of immediate neighbors. Most pairs are eliminated **without any per-pair comparison** — they are pruned by a single bbox-vs-bbox test at a high level of the tree.

This is the quadtree idea. A node represents an axis-aligned bounding box of 2D space; its four children represent the NE, NW, SE, SW quadrants of that box. Recurse until each leaf contains only a small number of items (typically 4 to 16). Spatial queries — *find all points inside this rectangle*, *find the nearest point to this location*, *find all objects whose bbox overlaps mine* — visit only the nodes whose box intersects the query, and the rest of the tree is skipped entirely.

The octree is the same idea in 3D. A cubic region is split into eight equal octants. Used for voxel worlds, ray tracing, 3D collision, point-cloud processing from LIDAR, and astrophysical N-body simulation. Everything you learn about quadtrees transfers directly.

The asymptotic complexity of quadtree queries is **O(log n) on average** for uniformly distributed data, but the headline win is the **enormous constant-factor reduction** from pruning empty space. On real game and GIS workloads you routinely see 100x or 1000x speedups over the naive O(n²) baseline. Worst case is still O(n) — adversarial clustered inputs can build a degenerate tree — but with a depth cap and a sensible bucket size this is rare in practice.

The structure was introduced by **Finkel and Bentley in 1974** ("Quad Trees: A Data Structure for Retrieval on Composite Keys") for indexing multi-key records; **Meagher's 1980 octree paper** generalized it to 3D for solid-modeling and rendering. The definitive survey is **Hanan Samet's 1984 ACM Computing Surveys paper** "The Quadtree and Related Hierarchical Data Structures", and his 2006 book *Foundations of Multidimensional and Metric Data Structures* is still the reference.

---

<a name="prerequisites"></a>
## 2. Prerequisites

To follow this document you need:

1. **2D Cartesian coordinates.** A point is `(x, y)`; a rectangle is usually `(x, y, w, h)` (top-left + size) or `(cx, cy, halfW, halfH)` (center + half-extents). We use the center+half-extents form because it makes the subdivision arithmetic symmetric and cleaner.
2. **Recursion.** A quadtree node is naturally defined in terms of four children of the same type. If you have written a binary tree traversal, you can write a quadtree traversal.
3. **Axis-aligned bounding boxes.** Two ops: `bbox.contains(point)` (is the point inside?) and `bboxA.intersects(bboxB)` (do they overlap?). These are four-comparison operations.
4. **Basic Big-O.** You should be comfortable with the idea that a tree of branching factor 4 and depth d has up to 4^d leaves, so depth ≈ log_4(n) on balanced inputs.

That is all. No prior knowledge of spatial data structures is assumed.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Quadtree** | Tree where each internal node has 4 children, each representing one quadrant (NE, NW, SE, SW) of the parent's bbox. |
| **Octree** | 3D analog: each internal node has 8 children, one per octant of the parent's cube. |
| **Point quadtree** | Original Finkel-Bentley variant. Each node *is* a point; the splitting lines pass through that point, so children are unequal in size. |
| **Region quadtree** | Each node represents a region of space split into 4 equal sub-regions, regardless of where points fall. Used for raster images. |
| **PR-quadtree** (Point-Region) | Region quadtree that stores points; a leaf holds at most one point (or, with bucketing, a small bucket). The most popular variant; this document focuses on it. |
| **Bbox** | Axis-aligned bounding box. `{cx, cy, hw, hh}` or `{xmin, ymin, xmax, ymax}`. |
| **Bucket** | A small array of points held at a leaf. When the bucket overflows, the leaf subdivides. |
| **Bucket capacity** (threshold, k) | Maximum points a leaf may hold before subdividing. Typical values 4-16. |
| **Subdivide** | Convert a leaf into an internal node by creating four (or eight) empty children and distributing the bucket's points into them. |
| **Quadrant** | One of the four children of a quadtree node: NE (top-right), NW (top-left), SE (bottom-right), SW (bottom-left). |
| **Octant** | One of eight children in 3D, indexed by the sign of (dx, dy, dz) relative to the cube's center. |
| **Depth limit / MAX_DEPTH** | Cap on recursion depth to prevent infinite subdivision when many points coincide. |
| **Leaf** | A node with no children; holds the bucket of points. |
| **Internal node** | A node that has been subdivided; in the most common variant it holds no points itself, only children. |
| **Range query** | Find all points inside a query rectangle (or axis-aligned box in 3D). |
| **k-NN query** | Find the k nearest neighbors of a query point. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Subdivision and Recursion

### 4.1 The node

A PR-quadtree node carries:

```
struct Node {
    Bbox        boundary       // the square region this node owns
    int         capacity       // max points before subdividing
    Point[]     points         // bucket — empty after subdivision
    bool        divided        // true once we have children
    Node*       NE, NW, SE, SW // the four quadrant children, nil while leaf
}
```

A node starts as a leaf with an empty bucket. Insertions push into `points` until the bucket overflows (`len(points) == capacity`); then we subdivide.

### 4.2 Subdivision

Subdivision creates four children whose boundaries are the four quadrants of the parent's boundary:

```
parent.boundary = {cx, cy, hw, hh}

NE.boundary = {cx + hw/2, cy + hh/2, hw/2, hh/2}   // top-right
NW.boundary = {cx - hw/2, cy + hh/2, hw/2, hh/2}   // top-left
SE.boundary = {cx + hw/2, cy - hh/2, hw/2, hh/2}   // bottom-right
SW.boundary = {cx - hw/2, cy - hh/2, hw/2, hh/2}   // bottom-left
```

(In screen coordinates where y grows downward, swap NE/SE and NW/SW signs — pick a convention and document it.)

After subdivision, in the standard variant the parent's bucket is emptied: each existing point is re-inserted into the appropriate child. From now on the parent stores no points directly; queries always recurse to leaves.

### 4.3 Insert

```
insert(node, p):
    if not node.boundary.contains(p):
        return false                      // point is outside this region
    if not node.divided:
        if len(node.points) < node.capacity:
            node.points.append(p)
            return true
        if node.depth >= MAX_DEPTH:
            node.points.append(p)         // last resort: oversized bucket
            return true
        node.subdivide()
    return node.NE.insert(p) or node.NW.insert(p) or node.SE.insert(p) or node.SW.insert(p)
```

The `or` short-circuits: only one child contains the point, so only one insert succeeds. Average cost: O(log n) on uniform data. Worst case O(MAX_DEPTH).

### 4.4 Range query

```
queryRange(node, rect, found):
    if not node.boundary.intersects(rect):
        return                            # PRUNE — this subtree is irrelevant
    for p in node.points:                 # leaves; internal nodes have empty .points
        if rect.contains(p):
            found.append(p)
    if node.divided:
        queryRange(node.NE, rect, found)
        queryRange(node.NW, rect, found)
        queryRange(node.SE, rect, found)
        queryRange(node.SW, rect, found)
```

The first line is the magic. If the query rectangle does not touch the node's boundary, we return immediately — an entire subtree (possibly thousands of points) is skipped with one comparison. This is what gives the quadtree its real-world speed.

### 4.5 The bbox helpers

```
contains(bbox, p):
    return abs(p.x - bbox.cx) <= bbox.hw && abs(p.y - bbox.cy) <= bbox.hh

intersects(a, b):
    return abs(a.cx - b.cx) <= a.hw + b.hw && abs(a.cy - b.cy) <= a.hh + b.hh
```

Both are four comparisons. Branchless on modern CPUs.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Average (uniform) | Worst (clustered) |
|---|---|---|
| Insert | O(log n) | O(MAX_DEPTH) ≈ O(1) |
| Range query | O(log n + k) | O(n) |
| Nearest neighbor | O(log n) | O(n) |
| Build from n points | O(n log n) | O(n × MAX_DEPTH) |
| Space | O(n) | O(n + 4^MAX_DEPTH) |

`k` is the size of the output set. The query cost has a `log n` term to find the right leaves plus a linear term to enumerate the matches — you cannot return k things in less than k time.

**Constant factors matter more than asymptotics here.** On a million uniformly distributed points with a query rectangle covering 1% of the area, a quadtree typically returns ~10,000 points in under a millisecond — the asymptote is O(log n + k) but the practical speedup over linear scan can be 100-1000×.

For `n = 10^6` uniform points and bucket size 8, tree depth is ~7-10. Insert touches about that many nodes.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 City map zoom levels

Open Google Maps. The whole world is one tile at zoom 0. Zoom in once and the world is split into 4 tiles (a 2×2 grid). Zoom again: 16 tiles. Zoom level 20 has 4^20 ≈ 10^12 tiles — enough for every house. When you pan the map, only the tiles intersecting your viewport are downloaded. That tile pyramid **is** a quadtree, and the address of a tile encodes the path from the root through the quadrants.

### 6.2 Hierarchical address: "borough → district → block"

To find a coffee shop in Brooklyn you do not search Tokyo first. You navigate New York → Brooklyn → Park Slope → 7th Avenue. Each step prunes a vast region. The quadtree is exactly this hierarchy applied to arbitrary rectangles.

### 6.3 Picture compression by quadrants

A black-and-white image. If a 256×256 block is entirely white, you store one "white" symbol. If it is entirely black, one "black" symbol. If it is mixed, you split into four 128×128 blocks and recurse. Final tree has one leaf per uniform region. This is the **region quadtree** for image compression — covered in `senior.md`.

### 6.4 Astronomy: Barnes-Hut

A galaxy with N stars. Computing pairwise gravity is O(N²) — infeasible for N = 10^9. Build an octree of star positions; for any star, treat far-away clusters as a single mass at their center of mass. Per-star cost drops from O(N) to O(log N). Total: O(N log N). This algorithm has been used in every major cosmological simulation since 1986.

### 6.5 Game collision broad-phase

Every frame, insert each game object into a fresh quadtree (or rebuild incrementally). To find candidates for object A, query the quadtree for A's bbox; only nearby objects are returned. The remaining narrow-phase test (exact geometry) runs on a tiny set instead of all N objects.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs k-d Tree

| Aspect | Quadtree / Octree | k-d Tree |
|---|---|---|
| Subdivision rule | **Space**: split fixed midpoint regardless of where points lie | **Data**: split along the median point so each half has equal count |
| Branching factor | 4 (2D) or 8 (3D) | 2 |
| Depth | O(log n) on uniform; deeper on clustered | O(log n) on any input (median-balanced) |
| Empty regions | Many empty children; wasted nodes | None — every leaf has data |
| Build cost | O(n log n) average | O(n log n) guaranteed |
| Update cost (insert/delete) | Cheap — local subdivision/coalesce | Expensive — may unbalance, requires rebuild |
| Bbox tests | Simple, axis-aligned, symmetric | Per-axis comparisons; more complex k-NN math |
| Best fit | Dynamic scenes (games, sims), rasters, multi-scale data | Static k-NN over fixed point sets |

The k-d tree is covered in a separate chapter. **Use a quadtree when objects move** (cheap rebuild, cheap incremental updates) and when query rectangles are axis-aligned. **Use a k-d tree** when the point set is static and you need k-NN with rigorous balance guarantees.

### Quadtree pros

- Simple to code; the recursive structure mirrors the recursive geometry.
- Insertions/deletions are local — no global rebalance.
- Multi-scale: zoom in or out by descending or ascending the tree. Natural fit for tiled rendering and LOD.
- Easy to parallelize: independent subtrees can be queried by separate threads.
- Encodable as a flat array via Morton order — see `middle.md`.

### Quadtree cons

- Pathological depth on clustered data (galaxies of points at one location). Requires MAX_DEPTH.
- Worst-case query is O(n) on adversarial inputs.
- Empty children waste memory. Sparse quadtrees mitigate this.
- Points exactly on a subdivision line require a tiebreak convention.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Build a PR-quadtree over the box `[0, 16] × [0, 16]` (center `(8, 8)`, half-extents `(8, 8)`) with bucket capacity = 2. Insert 8 points:

```
p1 = (2, 2)
p2 = (3, 3)
p3 = (14, 2)
p4 = (15, 5)
p5 = (4, 12)
p6 = (5, 14)
p7 = (12, 13)
p8 = (13, 11)
```

**Insert p1 (2,2).** Root is leaf with empty bucket. Bucket: `[p1]`.
**Insert p2 (3,3).** Bucket: `[p1, p2]`. Still under capacity.
**Insert p3 (14,2).** Bucket would overflow → **subdivide root**. Root's four children:
- NE: `[8,16] × [8,16]`
- NW: `[0,8] × [8,16]`
- SE: `[8,16] × [0,8]`
- SW: `[0,8] × [0,8]`

Re-distribute existing bucket: p1 (2,2) → SW, p2 (3,3) → SW. SW.bucket = `[p1, p2]`. Now insert p3 (14,2) → SE. SE.bucket = `[p3]`.

**Insert p4 (15,5).** Falls into SE. SE.bucket = `[p3, p4]`.
**Insert p5 (4,12).** Falls into NW. NW.bucket = `[p5]`.
**Insert p6 (5,14).** Falls into NW. NW.bucket = `[p5, p6]`.
**Insert p7 (12,13).** Falls into NE. NE.bucket = `[p7]`.
**Insert p8 (13,11).** Falls into NE. NE.bucket = `[p7, p8]`.

Tree:

```
Root [0,16]×[0,16] (internal)
├── NE [8,16]×[8,16] → bucket [p7(12,13), p8(13,11)]
├── NW [0,8]×[8,16]  → bucket [p5(4,12), p6(5,14)]
├── SE [8,16]×[0,8]  → bucket [p3(14,2), p4(15,5)]
└── SW [0,8]×[0,8]   → bucket [p1(2,2), p2(3,3)]
```

Depth 1, 4 leaves, 8 points. Balanced.

### Range query: rectangle `[10, 16] × [10, 16]`

1. Root intersects query. Recurse to all four children.
2. NE `[8,16]×[8,16]` intersects query. Bucket: p7(12,13) inside ✔, p8(13,11) inside ✔. Add both.
3. NW `[0,8]×[8,16]` does **not** intersect query (`xmax=8 < 10`). **Prune.**
4. SE `[8,16]×[0,8]` does **not** intersect query (`ymax=8 < 10`). **Prune.**
5. SW `[0,8]×[0,8]` does **not** intersect query. **Prune.**

Output: `[p7, p8]`. Visited 1 root + 4 children = 5 node tests, looked at 2 points. Linear scan would have looked at 8 points. With 1 million points, the win is 5 orders of magnitude.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Quadtree (PR variant)

**Go:**
```go
package quadtree

type Point struct{ X, Y float64 }

type Bbox struct{ Cx, Cy, Hw, Hh float64 }

func (b Bbox) Contains(p Point) bool {
    return p.X >= b.Cx-b.Hw && p.X <= b.Cx+b.Hw &&
           p.Y >= b.Cy-b.Hh && p.Y <= b.Cy+b.Hh
}

func (a Bbox) Intersects(c Bbox) bool {
    return !(a.Cx+a.Hw < c.Cx-c.Hw || a.Cx-a.Hw > c.Cx+c.Hw ||
             a.Cy+a.Hh < c.Cy-c.Hh || a.Cy-a.Hh > c.Cy+c.Hh)
}

const MaxDepth = 16

type Quadtree struct {
    Boundary Bbox
    Capacity int
    Depth    int
    Points   []Point
    Divided  bool
    NE, NW, SE, SW *Quadtree
}

func New(b Bbox, cap int) *Quadtree {
    return &Quadtree{Boundary: b, Capacity: cap}
}

func (q *Quadtree) Insert(p Point) bool {
    if !q.Boundary.Contains(p) {
        return false
    }
    if !q.Divided {
        if len(q.Points) < q.Capacity || q.Depth >= MaxDepth {
            q.Points = append(q.Points, p)
            return true
        }
        q.subdivide()
    }
    return q.NE.Insert(p) || q.NW.Insert(p) || q.SE.Insert(p) || q.SW.Insert(p)
}

func (q *Quadtree) subdivide() {
    h := q.Boundary.Hw / 2
    v := q.Boundary.Hh / 2
    d := q.Depth + 1
    q.NE = &Quadtree{Boundary: Bbox{q.Boundary.Cx + h, q.Boundary.Cy + v, h, v}, Capacity: q.Capacity, Depth: d}
    q.NW = &Quadtree{Boundary: Bbox{q.Boundary.Cx - h, q.Boundary.Cy + v, h, v}, Capacity: q.Capacity, Depth: d}
    q.SE = &Quadtree{Boundary: Bbox{q.Boundary.Cx + h, q.Boundary.Cy - v, h, v}, Capacity: q.Capacity, Depth: d}
    q.SW = &Quadtree{Boundary: Bbox{q.Boundary.Cx - h, q.Boundary.Cy - v, h, v}, Capacity: q.Capacity, Depth: d}
    q.Divided = true
    old := q.Points
    q.Points = nil
    for _, p := range old {
        _ = q.NE.Insert(p) || q.NW.Insert(p) || q.SE.Insert(p) || q.SW.Insert(p)
    }
}

func (q *Quadtree) QueryRange(r Bbox, found *[]Point) {
    if !q.Boundary.Intersects(r) {
        return
    }
    for _, p := range q.Points {
        if r.Contains(p) {
            *found = append(*found, p)
        }
    }
    if q.Divided {
        q.NE.QueryRange(r, found)
        q.NW.QueryRange(r, found)
        q.SE.QueryRange(r, found)
        q.SW.QueryRange(r, found)
    }
}
```

**Java:**
```java
public final class Quadtree {
    static final int MAX_DEPTH = 16;

    public record Point(double x, double y) {}

    public record Bbox(double cx, double cy, double hw, double hh) {
        public boolean contains(Point p) {
            return p.x() >= cx - hw && p.x() <= cx + hw &&
                   p.y() >= cy - hh && p.y() <= cy + hh;
        }
        public boolean intersects(Bbox b) {
            return !(cx + hw < b.cx - b.hw || cx - hw > b.cx + b.hw ||
                     cy + hh < b.cy - b.hh || cy - hh > b.cy + b.hh);
        }
    }

    private final Bbox boundary;
    private final int capacity;
    private final int depth;
    private final java.util.List<Point> points = new java.util.ArrayList<>();
    private boolean divided = false;
    private Quadtree NE, NW, SE, SW;

    public Quadtree(Bbox boundary, int capacity) { this(boundary, capacity, 0); }
    private Quadtree(Bbox b, int c, int d) { this.boundary = b; this.capacity = c; this.depth = d; }

    public boolean insert(Point p) {
        if (!boundary.contains(p)) return false;
        if (!divided) {
            if (points.size() < capacity || depth >= MAX_DEPTH) {
                points.add(p);
                return true;
            }
            subdivide();
        }
        return NE.insert(p) || NW.insert(p) || SE.insert(p) || SW.insert(p);
    }

    private void subdivide() {
        double h = boundary.hw() / 2, v = boundary.hh() / 2;
        double cx = boundary.cx(), cy = boundary.cy();
        int d = depth + 1;
        NE = new Quadtree(new Bbox(cx + h, cy + v, h, v), capacity, d);
        NW = new Quadtree(new Bbox(cx - h, cy + v, h, v), capacity, d);
        SE = new Quadtree(new Bbox(cx + h, cy - v, h, v), capacity, d);
        SW = new Quadtree(new Bbox(cx - h, cy - v, h, v), capacity, d);
        divided = true;
        java.util.List<Point> old = new java.util.ArrayList<>(points);
        points.clear();
        for (Point p : old) {
            boolean ok = NE.insert(p) || NW.insert(p) || SE.insert(p) || SW.insert(p);
            assert ok;
        }
    }

    public void queryRange(Bbox r, java.util.List<Point> out) {
        if (!boundary.intersects(r)) return;
        for (Point p : points) if (r.contains(p)) out.add(p);
        if (divided) {
            NE.queryRange(r, out); NW.queryRange(r, out);
            SE.queryRange(r, out); SW.queryRange(r, out);
        }
    }
}
```

**Python:**
```python
from dataclasses import dataclass, field
from typing import List, Optional

MAX_DEPTH = 16

@dataclass(frozen=True)
class Point:
    x: float
    y: float

@dataclass(frozen=True)
class Bbox:
    cx: float
    cy: float
    hw: float
    hh: float
    def contains(self, p: Point) -> bool:
        return (self.cx - self.hw <= p.x <= self.cx + self.hw and
                self.cy - self.hh <= p.y <= self.cy + self.hh)
    def intersects(self, b: 'Bbox') -> bool:
        return not (self.cx + self.hw < b.cx - b.hw or self.cx - self.hw > b.cx + b.hw or
                    self.cy + self.hh < b.cy - b.hh or self.cy - self.hh > b.cy + b.hh)

@dataclass
class Quadtree:
    boundary: Bbox
    capacity: int = 4
    depth: int = 0
    points: List[Point] = field(default_factory=list)
    divided: bool = False
    NE: Optional['Quadtree'] = None
    NW: Optional['Quadtree'] = None
    SE: Optional['Quadtree'] = None
    SW: Optional['Quadtree'] = None

    def insert(self, p: Point) -> bool:
        if not self.boundary.contains(p):
            return False
        if not self.divided:
            if len(self.points) < self.capacity or self.depth >= MAX_DEPTH:
                self.points.append(p)
                return True
            self._subdivide()
        return (self.NE.insert(p) or self.NW.insert(p) or
                self.SE.insert(p) or self.SW.insert(p))

    def _subdivide(self) -> None:
        b = self.boundary
        h, v = b.hw / 2, b.hh / 2
        d = self.depth + 1
        self.NE = Quadtree(Bbox(b.cx + h, b.cy + v, h, v), self.capacity, d)
        self.NW = Quadtree(Bbox(b.cx - h, b.cy + v, h, v), self.capacity, d)
        self.SE = Quadtree(Bbox(b.cx + h, b.cy - v, h, v), self.capacity, d)
        self.SW = Quadtree(Bbox(b.cx - h, b.cy - v, h, v), self.capacity, d)
        self.divided = True
        old, self.points = self.points, []
        for p in old:
            self.NE.insert(p) or self.NW.insert(p) or self.SE.insert(p) or self.SW.insert(p)

    def query_range(self, r: Bbox, out: List[Point]) -> None:
        if not self.boundary.intersects(r):
            return
        for p in self.points:
            if r.contains(p):
                out.append(p)
        if self.divided:
            self.NE.query_range(r, out)
            self.NW.query_range(r, out)
            self.SE.query_range(r, out)
            self.SW.query_range(r, out)
```

### 9.2 Octree (3D analog)

**Python sketch:**
```python
@dataclass(frozen=True)
class Point3:
    x: float; y: float; z: float

@dataclass(frozen=True)
class Box3:
    cx: float; cy: float; cz: float
    hx: float; hy: float; hz: float
    def contains(self, p: Point3) -> bool:
        return (abs(p.x - self.cx) <= self.hx and
                abs(p.y - self.cy) <= self.hy and
                abs(p.z - self.cz) <= self.hz)

class Octree:
    """Same shape as Quadtree but with 8 children indexed by (xSign, ySign, zSign)."""
    def __init__(self, boundary: Box3, capacity: int = 8, depth: int = 0):
        self.boundary = boundary
        self.capacity = capacity
        self.depth = depth
        self.points: List[Point3] = []
        self.children: List[Optional['Octree']] = [None] * 8
        self.divided = False

    def _octant_index(self, p: Point3) -> int:
        return (1 if p.x >= self.boundary.cx else 0) | \
               (2 if p.y >= self.boundary.cy else 0) | \
               (4 if p.z >= self.boundary.cz else 0)

    def insert(self, p: Point3) -> bool:
        if not self.boundary.contains(p): return False
        if not self.divided:
            if len(self.points) < self.capacity or self.depth >= MAX_DEPTH:
                self.points.append(p); return True
            self._subdivide()
        return self.children[self._octant_index(p)].insert(p)

    def _subdivide(self) -> None:
        b = self.boundary
        hx, hy, hz = b.hx / 2, b.hy / 2, b.hz / 2
        for i in range(8):
            dx = hx if (i & 1) else -hx
            dy = hy if (i & 2) else -hy
            dz = hz if (i & 4) else -hz
            child_box = Box3(b.cx + dx, b.cy + dy, b.cz + dz, hx, hy, hz)
            self.children[i] = Octree(child_box, self.capacity, self.depth + 1)
        self.divided = True
        for p in self.points:
            self.children[self._octant_index(p)].insert(p)
        self.points = []
```

The octree has 8 children indexed by bitmask of (x-sign, y-sign, z-sign). Otherwise identical.

---

<a name="patterns"></a>
## 10. Coding Patterns — The Recursive Bbox Prune

Almost every quadtree algorithm is the same shape:

```
recurse(node, query):
    if not node.boundary intersects/touches query:
        return                  # PRUNE — entire subtree skipped
    process leaf data at this node
    if internal:
        recurse(each child, query)
```

That single template covers:

- **Range query** (the query is a rectangle; "intersects" = bbox-bbox overlap).
- **Point query** (the query is a point; "intersects" = bbox contains point).
- **k-NN** (the query is a point + current k-th-best distance; "intersects" = bbox is within current radius — branch and bound).
- **Ray cast** (the query is a ray; "intersects" = ray-bbox intersection test).
- **Collision broad-phase** (the query is a moving object's swept bbox).
- **Image rendering** (the query is the viewport; "intersects" = visible tile test).

If you internalize this pattern, the quadtree is one mental model that solves an entire family of problems.

---

<a name="errors"></a>
## 11. Error Handling — Boundary Conventions

### 11.1 Points on the edge between quadrants

When `p.x == node.cx`, which child gets the point? The answer must be **consistent**. Two common conventions:

- **Inclusive-lower**: NE gets `[cx, cx+hw] × [cy, cy+hh]`, NW gets `[cx-hw, cx) × [cy, cy+hh]`. Points on the splitting line go right or up.
- **Inclusive-upper**: opposite. Points on the line go left or down.

Pick one and document it. The pattern in our Go code (`>=` and `<=` everywhere) is "inclusive on both sides" — which means a point exactly on the dividing line will be claimed by **both** of two children. The `||` short-circuit in `Insert` ensures only the first one keeps it, but the order (NE → NW → SE → SW) becomes the tiebreak. That is fine as long as you do not silently change the order later.

### 11.2 Points exactly on the boundary of the root

`boundary.contains(p)` uses `<=` on both edges so the closed rectangle includes its boundary. A point exactly at `(0, 0)` on a `[0,16]×[0,16]` root is inserted. A point at `(-0.0001, 0)` is rejected; the caller must handle this (typically by enlarging the root or filtering input first).

### 11.3 Floating-point boundaries

After many subdivisions, the boundary numbers carry accumulated rounding error. For typical floats and 16-deep trees the error is below 10^-12 — invisible. For double-precision GIS at planetary scale you may need to use the original root bbox in the contains test (instead of the local node's drifted bbox), or switch to fixed-point integer coordinates.

### 11.4 NaN coordinates

`NaN >= x` is false for any x, so a point with NaN coordinates is rejected by `contains`. The caller should filter NaN before inserting.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Bucket size 4-16.** Too small (1) means many subdivisions and lots of pointer-chasing on insert; too large (>32) means leaves degrade to linear scans. Benchmark for your workload.
2. **MAX_DEPTH around 16-20.** Caps memory in pathological cases. At depth 20 a 2D world is partitioned into ~10^12 cells — far finer than any realistic resolution.
3. **Pre-allocate the points slice.** The recursive resize during subdivide hurts. In hot loops, set `points` capacity = bucket capacity from the start.
4. **Reuse the tree across frames.** Building a fresh tree every frame is fine for ≤10^5 dynamic objects. Beyond that, consider an incremental tree with cell coalescing (rebalance on deletion).
5. **Avoid recursion for queries on shallow trees.** An iterative stack-based traversal is 30-50% faster on hot paths because it skips the function-call overhead.
6. **Order children by query relevance** in k-NN. Descend the closest child first — the pruning radius shrinks and other children get cheaply pruned.
7. **Loose quadtrees** (covered in `professional.md`) reduce edge-case re-bucketing for moving objects.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document the y-axis convention.** Screen-space y grows downward; math-space y grows upward. Pick one for the whole codebase.
- **Use center+half-extents (not corner+size)** for boundaries. The subdivide arithmetic is symmetric, and `contains` is one comparison per axis.
- **Always set MAX_DEPTH.** Coincident points (same x,y inserted many times) will otherwise infinite-loop.
- **Keep buckets at leaves only.** When you subdivide, drain the parent's bucket into children. This makes range queries simpler — internal nodes contribute zero points.
- **Provide a `Clear()` method.** For per-frame rebuilds you want to reset without GC churn.
- **Wrap the public API.** Hide subdivide and child accessors; expose `Insert`, `QueryRange`, `Nearest`, `Clear`.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Behavior |
|---|---|
| Empty tree | `QueryRange` returns nothing. No crash. |
| Insert outside root | `Insert` returns false. Decide: expand the root or reject. |
| All points at the same location | Without MAX_DEPTH, infinite subdivision. With MAX_DEPTH, leaf bucket grows beyond capacity and queries become O(k). |
| Single point | Stored in root's bucket. No subdivision. |
| Bucket capacity = 0 | Subdivide on every insert. Each leaf can hold at most MAX_DEPTH-deep singletons. Avoid. |
| Query rectangle equal to root | Returns all points. Same as full traversal. |
| Query rectangle outside root | First `intersects` test fails. Returns instantly. |
| Two points exactly on a splitting line | Both end up in the same child (the first one your `||` order tries). |
| Deeply clustered points | Tree depth → MAX_DEPTH; leaf overflows; query degrades to O(n) within the cluster. |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting the bbox-intersect prune.** Without it, every query walks every node — O(n) regardless of the tree.
2. **Off-by-one on the bbox edges.** Using `<` vs `<=` inconsistently across `contains` and `intersects` causes silent point-loss at the boundary.
3. **Mixing center-vs-corner coordinates.** A subtle bug: you define boundaries as `(cx, cy, hw, hh)` but pass `(x, y, w, h)` to the constructor. Half the tree maps to nowhere.
4. **No MAX_DEPTH.** Stack overflow when many coincident points arrive.
5. **Subdividing but leaving points in the parent.** Now range queries either miss them (if leaves are the only data source) or double-count them.
6. **Re-using the same `found` slice across queries without resetting.** Results accumulate; the caller sees stale data.
7. **Inserting moving objects without removing-and-reinserting.** When an asteroid moves out of its current quadrant, the tree no longer reflects reality. For dynamic scenes, either rebuild each frame or implement removal + reinsertion.
8. **Using `==` to compare floating-point coordinates.** Points at "the same location" may differ by 10^-15 due to floating-point math; use a small epsilon if you need to detect duplicates.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
QUADTREE NODE:    boundary, capacity, depth, points[], divided, NE, NW, SE, SW

INSERT(p):
    if !boundary.contains(p): return false
    if !divided:
        if len(points) < capacity || depth >= MAX_DEPTH:
            points.append(p); return true
        subdivide()
    return NE.insert(p) || NW.insert(p) || SE.insert(p) || SW.insert(p)

SUBDIVIDE:
    create 4 children with half-size boundaries (NE, NW, SE, SW)
    re-insert current points into them
    points = []

QUERY_RANGE(rect):
    if !boundary.intersects(rect): return                 # PRUNE
    for p in points: if rect.contains(p): emit p
    if divided: recurse on all 4 children

PARAMETERS
    capacity: 4-16
    MAX_DEPTH: 16-20

COMPLEXITY (n uniform points)
    Insert     O(log n)  avg
    Range     O(log n + k)
    Build     O(n log n)
    Space     O(n)
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. Click on the dark canvas to add points; the quadtree subdivides whenever a bucket overflows, and the splitting lines animate in. Drag a rectangle to issue a range query: matching points light up green, visited (intersected) nodes glow yellow, pruned subtrees grey out. Stats display point count, depth, leaf count, and the number of points returned by the last query.

---

<a name="summary"></a>
## 18. Summary

- A quadtree partitions 2D space into four quadrants recursively; an octree does the same with eight octants in 3D.
- The point-region (PR) variant stores points in leaf buckets and subdivides when a bucket overflows.
- Insert is recursive descent + subdivide on overflow; range query is recursive descent with a bbox-intersect prune at every node.
- Average operations are O(log n); the headline win is empty-space pruning, often 100-1000× faster than naive O(n²) on real spatial workloads.
- Pick bucket capacity around 4-16 and MAX_DEPTH around 16-20 to balance memory and depth against pathological clustering.
- Master the recursive bbox-prune pattern: it underlies range queries, k-NN, ray casting, collision detection, and image rendering.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Finkel, Bentley**, "Quad Trees: A Data Structure for Retrieval on Composite Keys", *Acta Informatica* 4(1), 1974. The paper that introduced the structure.
- **Meagher**, "Octree Encoding: A New Technique for the Representation, Manipulation and Display of Arbitrary 3-D Objects by Computer", 1980. The octree's first appearance.
- **Samet**, "The Quadtree and Related Hierarchical Data Structures", *ACM Computing Surveys* 16(2), 1984. The canonical survey.
- **Samet**, *Foundations of Multidimensional and Metric Data Structures*, Morgan Kaufmann, 2006. The reference text — comprehensive coverage of every variant.
- **de Berg et al.**, *Computational Geometry: Algorithms and Applications*, 3rd ed., Springer, 2008. Chapter 14 covers quadtrees with rigorous analysis.
- Continue with `middle.md` for region quadtrees, linear quadtrees with Morton order, k-NN via branch-and-bound, and octree ray traversal.
