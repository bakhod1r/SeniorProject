# Quadtree and Octree — Middle Level

> **Audience:** Engineers who have implemented a PR-quadtree and now need the variant family used in real libraries. Prerequisite: `junior.md`.

This document covers the **family of quadtree-like structures**: the original point quadtree (Finkel-Bentley 1974) vs the region quadtree (Hunter 1978) vs the PR-quadtree vs the compressed quadtree; the **linear quadtree** encoded via Morton (Z-order) bit interleaving for cache-friendly flat storage; bottom-up balanced construction via Morton sort; **octree variants** including sparse and voxel forms; the head-to-head comparison with the k-d tree (space-vs-data subdivision); the **nearest-neighbor algorithm** with branch-and-bound and a min-heap; and **octree ray traversal** for rendering and physics.

---

## Table of Contents

1. [Point Quadtree vs Region Quadtree vs PR-Quadtree](#variants)
2. [Compressed Quadtree](#compressed)
3. [Linear Quadtree — Morton (Z-order) Encoding](#morton)
4. [Bottom-Up Balanced Construction](#balanced)
5. [Octree Variants — Pure, Sparse, Voxel](#octree-variants)
6. [k-d Tree Comparison](#kd-comparison)
7. [Nearest Neighbor — Branch-and-Bound](#nearest)
8. [Octree Ray Traversal](#ray-traversal)

---

<a name="variants"></a>
## 1. Point Quadtree vs Region Quadtree vs PR-Quadtree

Three flavors of quadtree exist in the literature; understanding which is which prevents weeks of confusion when reading papers.

### 1.1 Point quadtree (Finkel-Bentley, 1974)

In the original construction, **each node IS a point** in the input. The splitting lines pass through that point, so the four quadrants are **unequal in size**. Inserting a new point compares it to the root's point, recurses into one of the four children, and either lands on an existing point (collision) or becomes a new leaf. The shape of the tree depends on insertion order.

```
node = (px, py, NE, NW, SE, SW)
```

Pros: every node holds data; no empty children. Cons: tree shape is order-dependent; deletion is awkward; no clean k-NN bound.

This variant is mostly of historical interest. Modern code rarely uses it.

### 1.2 Region quadtree (Hunter, 1978)

Designed for **raster images**. The plane is recursively divided into four equal squares regardless of content. Each node either represents a uniform region (a leaf, e.g., "all white" or "all black") or has four children (further subdivision needed).

Used in image compression, raster GIS, and the original "quadtree" data structure in graphics textbooks. Storage cost: O(perimeter of the image's regions) — not O(area).

```
node = either { color } or { NE, NW, SE, SW }
```

The image's quadtree is **canonical**: independent of insertion order, depending only on the raster content.

### 1.3 PR-quadtree (point-region, Samet 1984)

Used for **point sets in 2D**. Like a region quadtree (equal-size quadrants regardless of data), but storage occurs only at leaves. Each leaf holds at most `capacity` points (often 1 in the textbook version, 4-16 in practice). This is the variant covered in `junior.md` and the one most engineers mean when they say "quadtree" today.

Pros: simple, canonical, works for dynamic point sets. Cons: empty children waste memory; deeply clustered points cause pathological depth (mitigated with MAX_DEPTH).

### 1.4 At a glance

| Variant | Data location | Subdivision rule | Tree shape depends on |
|---|---|---|---|
| Point quadtree | Internal nodes | Splits through stored point | Insertion order |
| Region quadtree | Leaves only | Equal halves regardless of data | Raster content |
| PR-quadtree | Leaves only | Equal halves regardless of data | Point set (canonical given the set) |
| Compressed quadtree | Leaves only | Equal halves, but chains of single-child subdivisions are collapsed | Point set |

---

<a name="compressed"></a>
## 2. Compressed Quadtree

A pathological case: 1000 points clustered in a single 0.001-wide region inside a 1.0-wide world. A PR-quadtree subdivides ~10 levels deep just to reach the cluster, creating ~30 internal nodes whose other three children are empty. Most of the tree is "filler".

A **compressed quadtree** collapses any chain of single-child subdivisions into a single edge labelled with the bbox of the bottommost meaningful node. The tree depth becomes O(log n) regardless of clustering, and the number of internal nodes is bounded by O(n) instead of O(n × depth).

Conceptually:

```
Standard:                Compressed:
  Root                     Root
  └── NW                   └── (cluster_bbox)
      └── NW                    ├── leaf1
          └── NW                ├── leaf2
              └── NW            ...
                  ├── leaf1
                  ├── leaf2
                  ...
```

The compressed quadtree is the spatial analog of a Patricia trie. It is also called a **PR-Patricia quadtree** or a **skip quadtree** (Eppstein-Goodrich-Sun 2005) when augmented with skip-pointers for O(log n) k-NN. It is the default representation in many serious computational-geometry libraries.

---

<a name="morton"></a>
## 3. Linear Quadtree — Morton (Z-order) Encoding

A "linear" quadtree replaces the pointer-based tree with a **flat array** of cells, each identified by an integer key. The key is the **Morton code** — also called **Z-order curve** — formed by interleaving the bits of the cell's (x, y) coordinates.

### 3.1 Morton encoding

Take 16-bit x and y coordinates. The 32-bit Morton code interleaves them:

```
x = x15 x14 x13 ... x1 x0
y = y15 y14 y13 ... y1 y0
M(x,y) = y15 x15 y14 x14 ... y1 x1 y0 x0
```

Cells that are spatially close tend to have close Morton codes — the curve traces a Z shape recursively through the quadrants:

```
0  1     0  1  4  5
2  3     2  3  6  7
         8  9 12 13
        10 11 14 15
```

The Morton code of a cell at level L corresponds to the path from the root: each 2 bits identifies one of {NE=11, NW=10, SE=01, SW=00} (with the convention that bit 1 is x≥cx, bit 0 is y≥cy — pick a convention and stick to it).

### 3.2 Fast interleave

The textbook trick — "spread" the bits:

**Python:**
```python
def part1by1(n: int) -> int:
    """Spread the low 16 bits of n into the even bit positions of a 32-bit result."""
    n &= 0xFFFF
    n = (n | (n << 8)) & 0x00FF00FF
    n = (n | (n << 4)) & 0x0F0F0F0F
    n = (n | (n << 2)) & 0x33333333
    n = (n | (n << 1)) & 0x55555555
    return n

def morton2d(x: int, y: int) -> int:
    return (part1by1(y) << 1) | part1by1(x)

def unmorton2d(m: int) -> tuple[int, int]:
    return compact1by1(m), compact1by1(m >> 1)

def compact1by1(n: int) -> int:
    n &= 0x55555555
    n = (n | (n >> 1)) & 0x33333333
    n = (n | (n >> 2)) & 0x0F0F0F0F
    n = (n | (n >> 4)) & 0x00FF00FF
    n = (n | (n >> 8)) & 0x0000FFFF
    return n
```

**Go:**
```go
func Part1By1(n uint32) uint32 {
    n &= 0xFFFF
    n = (n | (n << 8)) & 0x00FF00FF
    n = (n | (n << 4)) & 0x0F0F0F0F
    n = (n | (n << 2)) & 0x33333333
    n = (n | (n << 1)) & 0x55555555
    return n
}

func Morton2D(x, y uint32) uint32 {
    return (Part1By1(y) << 1) | Part1By1(x)
}
```

**Java:** identical bit dance.

Modern x86 has the `pdep` instruction (BMI2 extension) which performs this in a single op — `_pdep_u32(x, 0x55555555)` does the entire spread. JVM intrinsics expose it via `Integer.expand` (Java 17+).

### 3.3 The linear quadtree

Store points or cell summaries in a sorted array keyed by Morton code:

```python
# Sort all input points by Morton code:
sorted_points = sorted(points, key=lambda p: morton2d(quantize(p.x), quantize(p.y)))
```

Now a range query for a rectangle is a **contiguous range scan** of the sorted array — modulo the gaps where the Z-curve leaves the query rectangle and comes back. Tighter algorithms (next-jump-out, Litmax/Bigmin from Tropf-Herzog 1981) compute the next valid Morton key after a gap, so a range query touches O(log n + k) cells.

### 3.4 Why Morton?

- **Cache-friendly.** Spatially close points sit nearby in memory; a range query streams through contiguous bytes.
- **No pointer chasing.** Sorted array beats pointer trees by 2-3× on modern CPUs.
- **Easy parallelization.** Sort-by-Morton is a GPU primitive (radix sort).
- **Simple persistence.** A linear quadtree serializes to a flat file with no pointer fixups.

This is how high-performance GIS (PostGIS GiST, Oracle Spatial) and modern GPU spatial indexes are built. The Hilbert curve (next section's `senior.md` reference) has slightly better locality but harder arithmetic.

---

<a name="balanced"></a>
## 4. Bottom-Up Balanced Construction

Given n points known in advance, the top-down "insert one by one" build is O(n log n) average — but it produces a tree whose shape depends on insertion order and can be deep on clustered inputs.

**Bottom-up Morton sort build:**

1. Quantize each (x, y) to an integer grid.
2. Compute its Morton code.
3. Sort all points by Morton code — O(n log n), or O(n) with radix sort.
4. Walk the sorted array, grouping consecutive points whose Morton codes share a common prefix of length 2k bits → they live in the same level-k cell.
5. Emit the quadtree from the bottom up.

The result is the **canonical PR-quadtree** for that point set, identical to what top-down would have built but constructed deterministically and with optimal memory layout. The technique generalizes to 3D octrees (interleave three coordinates) and is the standard build path in GPU and HPC implementations.

```python
def build_quadtree_bottom_up(points: list[Point], bits: int = 16):
    pts = sorted(points, key=lambda p: morton2d(quantize(p.x, bits), quantize(p.y, bits)))
    # Recursive build using common-prefix grouping; pseudo-code:
    return build_recursive(pts, 0, len(pts), bits * 2)
```

---

<a name="octree-variants"></a>
## 5. Octree Variants — Pure, Sparse, Voxel

### 5.1 Pure octree

Eight children per internal node, each owning one octant of a cubic region. Stores points (PR-octree) or voxels (region octree). Direct generalization of the quadtree.

Used for: 3D point clouds, sparse particle systems, hierarchical bounding volumes in physics.

### 5.2 Sparse voxel octree (SVO)

A region octree where each leaf represents either a uniform voxel (solid material with one color/density) or further subdivides. Empty regions of space have no allocated node — only "interesting" voxels do.

For a 1024³ voxel volume — 10⁹ voxels — a dense array needs gigabytes. A sparse voxel octree of the same volume, when the scene is mostly empty (a typical landscape with mountains and sky), needs only a few MB. The SVO is the basis of modern voxel ray tracing engines (id Tech 6, NVIDIA GVDB, John Carmack's "Sparse Voxel Octree" engine experiments).

```
SVO node = { material_id, child_mask:8, child_ptrs[popcount(mask)] }
```

The 8-bit `child_mask` indicates which of the 8 octants actually have children; only those pointers are stored. Memory for a homogeneous leaf is one node.

### 5.3 Voxel octree (Minecraft-style chunks)

Minecraft does not use a true octree at runtime; it uses **flat 16×16×16 chunks** with palette compression. But conceptually a world is a 3-level octree: world → region (32×32 chunks) → chunk → block. Most engine-internal LOD and culling structures DO use octrees over the chunk grid. The key takeaway: **a shallow octree of large leaves is cheaper than a deep octree of unit leaves** when each leaf is itself densely packed.

### 5.4 Linear octree

Three coordinates interleaved into one Morton code — `morton3d(x, y, z)`. Same flat-array story as the linear quadtree. The standard storage for GPU octrees and for Octomap (next chapter).

---

<a name="kd-comparison"></a>
## 6. k-d Tree Comparison

| Aspect | Quadtree | k-d Tree |
|---|---|---|
| Subdivision rule | **Space** — fixed midpoint of bbox | **Data** — median point along one axis |
| Branching factor | 4 (or 8 in 3D) | 2 always |
| Tree depth | O(log n) on uniform, deeper on clusters | O(log n) guaranteed |
| Cells | Uniform — every cell is a perfect square (cube) | Adaptive — cells stretch along data |
| Best for | Dynamic scenes, raster data, multi-scale | Static k-NN, machine learning |
| Insertion | Cheap and local | Disturbs balance; periodic rebuild |
| k-NN | Branch-and-bound; pessimistic in 2D, mediocre in 8D+ | Branch-and-bound; gold standard up to ~10D |

A k-d tree partitions on the **data distribution**: at each level it splits along one axis (cycling x, y, z, x, y, z, ...) at the median, so each subtree has exactly half the points. Quadtrees partition on **space**: every subdivision halves the bbox regardless of how points fall.

**Use a quadtree when:**
- Data is dynamic (moving objects).
- You need multi-scale views (LOD, tiles, image pyramids).
- You query rectangles often (range, viewport).
- Memory layout matters (Morton order, GPU).

**Use a k-d tree when:**
- Data is static and you build once.
- Points are higher-dimensional (4D, 5D, ...).
- You do mostly k-NN queries.
- Cells should adapt to skew in the data.

In game engines, the typical setup is: **quadtree/octree for broad-phase collision** (dynamic), **k-d tree for static geometry** (level data), **BVH for triangle rendering** (also static).

---

<a name="nearest"></a>
## 7. Nearest Neighbor — Branch-and-Bound

Given a query point `q`, find the closest stored point. The algorithm uses a priority queue of (distance, node) pairs and prunes any subtree whose bbox is farther than the current best.

### 7.1 Distance from point to bbox

```python
def dist_point_to_bbox(p: Point, b: Bbox) -> float:
    dx = max(0.0, abs(p.x - b.cx) - b.hw)
    dy = max(0.0, abs(p.y - b.cy) - b.hh)
    return (dx * dx + dy * dy) ** 0.5
```

If the point is inside the bbox, returns 0. Otherwise returns the distance to the closest edge.

### 7.2 Algorithm

```
NN(query):
    best_dist = infinity
    best_point = nil
    heap = min-heap of (dist_to_bbox, node)
    push (0, root) on heap
    while heap not empty:
        (d, node) = heap.pop()
        if d >= best_dist:
            break                       # all remaining bboxes are farther than current best
        for p in node.points:
            d_p = dist(query, p)
            if d_p < best_dist:
                best_dist = d_p
                best_point = p
        if node.divided:
            for child in (NE, NW, SE, SW):
                d_c = dist_point_to_bbox(query, child.boundary)
                if d_c < best_dist:
                    heap.push((d_c, child))
    return best_point
```

The min-heap visits children in order of increasing distance to `q`. Once the heap's top is farther than `best_dist`, every remaining node is also farther — we are done.

### 7.3 k-NN

Replace `best_dist` with a max-heap of size k holding the current k best distances. The pruning bound is the heap's max (the worst of the current k bests). When the priority queue's next distance exceeds this max, terminate.

### 7.4 Complexity

Average O(log n) on uniformly distributed points. Worst case O(n) in adversarial or clustered cases — but the constant factor for the average case is excellent.

### 7.5 Python implementation

```python
import heapq, math
from typing import Tuple

def nearest(qt: 'Quadtree', q: Point) -> Point:
    best = (math.inf, None)
    heap: list[Tuple[float, int, 'Quadtree']] = [(0.0, 0, qt)]
    counter = 1
    while heap:
        d, _, node = heapq.heappop(heap)
        if d >= best[0]:
            break
        for p in node.points:
            dp = math.hypot(p.x - q.x, p.y - q.y)
            if dp < best[0]:
                best = (dp, p)
        if node.divided:
            for child in (node.NE, node.NW, node.SE, node.SW):
                dc = dist_point_to_bbox(q, child.boundary)
                if dc < best[0]:
                    heapq.heappush(heap, (dc, counter, child))
                    counter += 1
    return best[1]
```

The `counter` breaks heap ties since `Quadtree` is not `<`-comparable.

---

<a name="ray-traversal"></a>
## 8. Octree Ray Traversal

For ray tracing and 3D collision, traverse the octree along a ray and visit only intersected octants in front-to-back order.

### 8.1 Ray-AABB intersection (slab method)

```python
def ray_aabb(orig: tuple, dir: tuple, box: Box3) -> tuple[float, float] | None:
    """Returns (t_enter, t_exit) where the ray enters and exits the box, or None if no hit."""
    t_min, t_max = -math.inf, math.inf
    for i in range(3):
        if abs(dir[i]) < 1e-9:
            if orig[i] < box.min[i] or orig[i] > box.max[i]:
                return None
        else:
            inv = 1.0 / dir[i]
            t1 = (box.min[i] - orig[i]) * inv
            t2 = (box.max[i] - orig[i]) * inv
            if t1 > t2: t1, t2 = t2, t1
            t_min = max(t_min, t1)
            t_max = min(t_max, t2)
            if t_min > t_max:
                return None
    return (t_min, t_max)
```

### 8.2 Front-to-back octree walk

The classic **Revelles-Urena-Lastra (2000)** algorithm: at each internal node, compute the parametric entry/exit along the ray; identify which octant the ray enters first; walk to subsequent octants in front-to-back order using XOR transitions on the (x, y, z) sign bits.

The advantage of front-to-back traversal: as soon as a leaf hits an opaque surface, you stop — every subsequent octant is *behind* the hit and can be skipped. This is the foundation of GPU sparse voxel octree ray tracing.

### 8.3 In practice

For static scenes, modern engines often prefer a **bounding volume hierarchy (BVH)** over an octree because BVH adapts to non-uniform geometry better. Octrees remain ideal when:

- Geometry is procedural (voxel landscapes).
- You need uniform LOD across space.
- The scene fits a regular subdivision (cosmological simulations, fluid grids).

Otherwise an SAH-built BVH usually outperforms an octree by 20-40% in production renderers.

---

This concludes the middle-level treatment. Continue with `senior.md` for production-system case studies (Google Maps tiles, PostGIS, Minecraft chunks, Barnes-Hut N-body, ROS Octomap) and `professional.md` for Morton optimization, sparse voxel DAGs, GPU traversal, and concurrent updates.
