# Quadtree and Octree — Tasks

> **Audience:** Engineers who have read `junior.md` and `middle.md` and want hands-on practice. Each task has a reference solution sketch.

Work through these in order — they build on each other. The first three give you a solid implementation; the next four exercise queries; the last three are mini-projects (Barnes-Hut, collision, SVO compression) suitable for a portfolio.

---

## Task 1 — Implement PR-Quadtree

**Goal.** Implement the PR-quadtree with `Insert`, `Contains`, and `QueryRange` from scratch.

**Requirements:**
- `Bbox` with `Contains(point)` and `Intersects(other)`.
- Bucket capacity tunable; MAX_DEPTH = 16.
- `Insert(point) bool` — returns false if outside boundary.
- `Contains(point) bool` — does any stored point equal this one?
- `QueryRange(rect, []Point) -> []Point`.

**Tests:**
- Insert 1000 random points; verify `QueryRange(root_bbox)` returns all.
- Range query returning 0, 1, all points.
- `Contains` for inserted and absent points.
- Insert outside root → false; tree unchanged.

**Reference (Python sketch):**
```python
# See junior.md §9.1 for a complete reference implementation.
# Add this Contains helper:
def contains(self, p: Point) -> bool:
    if not self.boundary.contains(p):
        return False
    for q in self.points:
        if q == p:
            return True
    if self.divided:
        return (self.NE.contains(p) or self.NW.contains(p) or
                self.SE.contains(p) or self.SW.contains(p))
    return False
```

---

## Task 2 — Octree in 3D

**Goal.** Extend Task 1 to 3D. 8 children per node, indexed by `(xSign, ySign, zSign)` bitmask.

**Requirements:**
- `Box3` with `Contains(point3)` and `Intersects(other)`.
- `Octree` with same API as `Quadtree` but in 3D.

**Tests:**
- Insert random 3D points; verify range query over the root returns all.
- Range query over a small sub-cube returns a smaller set; verify by linear scan equality.

**Reference.** See `junior.md` §9.2. The pattern is identical to 2D with an extra axis. The octant index `i & 1`, `i & 2`, `i & 4` corresponds to (x, y, z).

---

## Task 3 — Linear Quadtree via Morton

**Goal.** Implement Morton encode/decode for 16-bit (x, y) and build a sorted linear quadtree of integer-grid points.

**Requirements:**
- `morton2d(x, y) -> int` (bit-interleave).
- `unmorton2d(m) -> (x, y)`.
- `LinearQuadtree.range_query(xmin, ymin, xmax, ymax)`.

**Tests:**
- Round-trip: `unmorton2d(morton2d(x, y)) == (x, y)` for 1000 random pairs.
- Verify Morton sorted order: spatial neighbors at the same level have close keys.
- Range query equivalence: returns the same set as a brute-force scan.

**Reference.** See `middle.md` §3.2 and `interview.md` #8. The implementation uses the standard mask-and-shift bit-spread.

**Stretch goal.** Implement **Litmax/Bigmin** (Tropf-Herzog 1981) to skip Z-curve excursions outside the rect efficiently. Hint: at the highest bit where the current Morton key exits the rectangle, compute the next valid key by manipulating that bit and the bits below.

---

## Task 4 — Nearest Neighbor with Priority Queue

**Goal.** Implement `Quadtree.Nearest(query) -> Point` using branch-and-bound with a min-heap of (bbox-distance, node).

**Requirements:**
- `dist_point_to_bbox(p, bbox)` — Euclidean distance from point to the closest edge of bbox (0 if inside).
- `Nearest(query)` returns the stored point with smallest distance to query.

**Tests:**
- 10,000 random points; verify against brute-force linear scan over 1,000 random queries.
- Query at the exact location of a stored point: result is that point (distance 0).
- Edge case: empty tree → return None / error.

**Reference.** See `middle.md` §7 and `interview.md` #4.

---

## Task 5 — k-Nearest Neighbors

**Goal.** Extend Task 4 to find the k nearest points.

**Requirements:**
- `kNN(query, k) -> list[Point]` returns up to k closest stored points, sorted by distance.
- Use a bounded max-heap of size k as the running result set.

**Tests:**
- Verify against brute-force k-NN over 100 random queries with k = 5, 20, 100.
- k larger than the number of stored points: return all.
- k = 0: return empty list.

**Reference.** See `interview.md` #5.

---

## Task 6 — Range Query Rectangle

**Goal.** This is part of Task 1, but as a standalone exercise: implement `QueryRange(rect)` and measure performance vs brute force.

**Requirements:**
- Benchmark on 10^4, 10^5, 10^6 points, query rectangles of varying sizes (1%, 10%, 50% of root area).
- Report time per query vs brute-force scan.

**Expected results:**
| n | query% | quadtree | brute |
|---|---|---|---|
| 10^4 | 1% | <100 µs | 1 ms |
| 10^5 | 1% | <500 µs | 10 ms |
| 10^6 | 1% | <2 ms | 100 ms |

If your numbers are wildly off, suspect: (1) missing bbox-intersect prune, (2) bucket size too small (excessive subdivision), (3) Python overhead (use PyPy or rewrite the hot inner loop with NumPy).

---

## Task 7 — Region Quadtree from B/W Image

**Goal.** Build a region quadtree from an `n × n` binary image (n a power of 2) and verify lossless decompression.

**Requirements:**
- `build(image) -> Node` where Node is either leaf-with-value or 4-children.
- `decompress(node, size) -> image` reconstructs the original grid.
- Assert: `decompress(build(image)) == image` for any input.

**Tests:**
- Solid black image → tree has 1 node.
- Checkerboard → tree has n² nodes (worst case; no compression possible).
- Random "circle" mask → measure compression ratio (typically 5-50× depending on n).

**Reference.** See `interview.md` #1 (build) and #10 (compression ratio). Decompression is a recursive paint: leaf paints its region uniformly; internal node recurses into quadrants.

---

## Task 8 — Mini Barnes-Hut 2D N-Body

**Goal.** Simulate gravity on N point masses in 2D using a Barnes-Hut quadtree.

**Requirements:**
- Each step: rebuild the quadtree of current positions; compute force on each body via the quadtree with opening angle θ = 0.5; advance positions via leapfrog or Euler integration.
- Animate the simulation (write a small HTML5 canvas viewer or output PNG frames).
- Compare per-step time against naive O(N²) for N = 100, 1000, 10000.

**Expected speedups:**
| N | naive | Barnes-Hut | speedup |
|---|---|---|---|
| 100 | <1 ms | <1 ms | ~1× |
| 1000 | 50 ms | 5 ms | 10× |
| 10000 | 5 s | 50 ms | 100× |

**Reference.** See `interview.md` #9 for the core force-on-body function.

**Stretch.** Add a star-cluster test: 1000 bodies sampled from a Plummer sphere. Verify the cluster does not artificially heat or evaporate over 1000 steps — a sign of bugs in the force calculation or integrator.

---

## Task 9 — Collision Detection Demo

**Goal.** Build a small demo: N AABBs moving with random velocities, find all overlapping pairs per frame using a quadtree.

**Requirements:**
- Each frame: insert all AABB centers into a fresh quadtree; for each AABB, query the rect enlarged by max half-extent; filter candidates by exact AABB-AABB overlap test.
- Compare per-frame time against naive O(N²) for N = 100, 1000, 10000.
- Optional: render a canvas with overlapping pairs highlighted.

**Production note.** This rebuild-per-frame approach is fine for ≤10^4 AABBs. For larger N, switch to incremental updates (remove + reinsert moved objects).

**Reference.** See `interview.md` #6.

---

## Task 10 — Sparse Voxel Octree Compression (Subtree Sharing)

**Goal.** Build a region octree from a 3D voxel grid; detect identical subtrees and report compression ratio.

**Requirements:**
- Build the octree (Task 7 in 3D — see `interview.md` #7).
- During or after build, hash each subtree by its structure and reuse identical ones (sparse voxel DAG concept).
- Count: total nodes in octree, unique subtrees after sharing, compression ratio.

**Tests:**
- Empty volume (all 0): one node.
- Uniform volume (all 1): one node.
- Sierpinski tetrahedron (recursive self-similar voxel pattern): unique-subtree count is **O(depth)** vs O(8^depth) for the unsharded octree — massive compression.
- Random noise: nearly zero sharing — compression ratio ~1×.

**Reference (Python sketch):**
```python
def share_subtrees(node, cache: dict) -> int:
    """Returns a canonical id for this subtree; identical structure → same id."""
    if node.is_leaf:
        key = ('leaf', node.val)
    else:
        child_ids = tuple(share_subtrees(c, cache) for c in node.children)
        key = ('internal', child_ids)
    if key not in cache:
        cache[key] = len(cache)
    return cache[key]

# After build:
cache = {}
share_subtrees(root, cache)
unique_nodes = len(cache)
ratio = total_octree_nodes / unique_nodes
```

**Discussion.** Sparse Voxel DAGs (Kämpe-Sintorn-Assarsson 2013) achieve 100-1000× compression on large voxel models with structural self-similarity (cityscapes, procedural terrain) and are a key technique in modern voxel ray tracing.

---

## Task 11 — Loose Quadtree for Moving Objects (Stretch)

**Goal.** Implement a "loose" quadtree where each cell's stored bbox is enlarged by a factor (typically 2×) so moving objects whose centers cross cell boundaries don't need re-bucketing.

**Requirements:**
- Each cell has a "loose" bbox = 2× the tight bbox.
- An object is stored in a cell if its bbox fits inside the loose bbox.
- Range query checks against tight bbox of nearby cells but examines objects in the loose region.

**Discussion.** Loose quadtrees (Thatcher Ulrich 2000) trade slightly worse query times for vastly reduced re-bucketing in dynamic scenes; they are widely used in real-time game engines.

---

## Submission

For your portfolio: pick Tasks 8 (Barnes-Hut) or 9 (collision) and produce a polished HTML demo with stats overlay. Both make excellent visualization pieces that hiring managers immediately understand.

Continue with `interview.md` for LeetCode-flavored variants.
