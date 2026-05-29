# Quadtree and Octree — Professional Level

> **Audience:** Engineers tuning spatial indexes at the metal — cache layout, GPU dispatch, concurrent updates, terabyte-scale terrain. Prerequisite: `senior.md`.

This document collects the techniques that separate a working quadtree from a production-grade one: Morton/Hilbert order encoding for cache locality, sparse voxel DAG compression, GPU-resident octree traversal, out-of-core terrain pyramids, memory-layout choices (pointer vs index vs Morton-flat), concurrent insert strategies, and a survey of measured performance on real broad-phase collision workloads.

---

## Table of Contents

1. [Morton (Z-order) Encoding — Beyond the Basics](#morton)
2. [Hilbert Curve as a Quadtree Relative](#hilbert)
3. [Sparse Voxel DAGs](#svd)
4. [GPU-Friendly Octree Traversal](#gpu)
5. [Out-of-Core Quadtrees for Terrain](#out-of-core)
6. [Memory Layout — Pointer vs Index vs Morton-Flat](#layout)
7. [Concurrent Insert Strategies](#concurrent)
8. [Real-Time Collision Broad-Phase Numbers](#perf)

---

<a name="morton"></a>
## 1. Morton (Z-order) Encoding — Beyond the Basics

The `junior.md` and `middle.md` chapters introduced bit interleaving. In production:

- **BMI2 `pdep`/`pext`** (Intel Haswell+, AMD Excavator+) collapse the entire spread to one instruction. Sandy Bridge and earlier still need the bit-trick. Detect at runtime, dispatch.
- **`__builtin_clzll` + multiplication** computes the longest-common-prefix of two Morton codes — useful for finding their lowest common ancestor cell in the quadtree.
- **Sort by Morton key** with a radix sort: 4 passes of 8 bits over a 32-bit Morton key sort 10^7 elements in ~50 ms on a single core; GPU radix sort handles 10^9 keys per second.
- **Range query via Litmax/Bigmin** (Tropf-Herzog 1981): given a Morton-sorted array and a query rectangle, compute the smallest Morton key inside the rect that is `> current_position` — lets you skip Z-curve excursions outside the rect in O(log n) per jump.

The **3D Morton** function for octrees interleaves three coordinates; the same bit-trick generalizes (use masks `0x49249249` etc.). On x86 with BMI2: `pdep(x, 0x09249249) | pdep(y, 0x12492492) | pdep(z, 0x24924924)`.

**Cache effect.** For 10^7 points with random Morton keys, a range query scan touches ~5-10× more cache lines than a Morton-sorted scan of the same data. The structural difference is real and measurable.

---

<a name="hilbert"></a>
## 2. Hilbert Curve as a Quadtree Relative

The **Hilbert space-filling curve** also gives a 1D ordering of 2D space, but with strictly better locality than Morton: any two points whose Hilbert keys differ by 1 are spatial neighbors (in Morton, large "Z" jumps occur at quadrant boundaries).

Quantitatively, the **clustering** measure (average number of contiguous runs in a query rect) for Hilbert is ~1.4× better than Morton on uniform rectangles — meaning fewer cache-unfriendly jumps during a range scan.

Why not always use Hilbert?

- **Encoding cost.** Computing a Hilbert key requires 2N table lookups (one per level) or a state-machine traversal. Morton is 4-6 cycles; Hilbert is 50-100. For build-once-read-many workloads (static GIS), the build amortizes — use Hilbert. For per-frame dynamic rebuilds, Morton is fine.
- **Library support.** Morton is in every numerics library and Intel intrinsics. Hilbert needs hand-rolled code.

S2 (Google's spherical geometry library, the index behind MongoDB's `2dsphere` and many maps) uses Hilbert order on six face quadtrees covering a cube projection of the unit sphere. **H3** (Uber's hex-grid library) uses a different hierarchy entirely — hex cells with a 7-way subdivision, designed for transportation grids where hex adjacency matters.

---

<a name="svd"></a>
## 3. Sparse Voxel DAGs

**Kämpe, Sintorn, Assarsson, 2013** — *High Resolution Sparse Voxel DAGs*. The insight: in a sparse voxel octree of a typical scene, **many subtrees are identical** — large air pockets, repeated bricks, walls of identical material. By detecting identical subtrees during construction and pointing multiple parents at the same shared child, the octree becomes a directed acyclic graph (DAG).

Compression results from the original paper:

- Statue dataset, 16K³ voxels: SVO ~50 GB → SVDAG ~280 MB (180× compression).
- Procedural Sierpinski tetrahedron, 64K³ voxels: SVO infeasible → SVDAG fits in 4 GB.

Construction: build the SVO bottom-up, hash each leaf (and later each internal node's child-pointer vector), insert into a hash table; if already present, reuse the pointer instead of allocating a new node. The hash key is the (child_mask, child_pointers) tuple.

```python
def build_svdag(svo_root):
    cache = {}                    # (child_mask, tuple(child_ids)) -> id
    def visit(node):
        if node.is_leaf:
            key = ('leaf', node.material)
        else:
            child_ids = tuple(visit(c) if c else None for c in node.children)
            key = (node.child_mask, child_ids)
        if key not in cache:
            cache[key] = allocate_new_id(key)
        return cache[key]
    return visit(svo_root)
```

Editing an SVDAG is harder than an SVO — modifying a voxel may require un-sharing many ancestors. Most production SVDAG systems are read-only (rendering) and rebuild on offline scene changes.

---

<a name="gpu"></a>
## 4. GPU-Friendly Octree Traversal

Octree traversal on a GPU has three constraints:

1. **Warp coherence.** Threads in a warp (32 on NVIDIA, 64 on AMD wavefronts) execute in lockstep. If half the warp recurses into NE and half into NW, the GPU serializes — performance halves. Solution: persistent-thread traversal where each thread independently walks its own ray, and the warp converges on common cells.
2. **Stack size.** Each thread can afford ~8-16 stack frames in registers. Octree depth must fit. Deeper trees go via shared memory or buffer offloading.
3. **Memory bandwidth.** Pointer-chase loads from random VRAM at ~50 ns each. Solution: pack child pointers + masks into 64-byte cache lines, and use Morton-keyed array layout (no pointers — children are at `parent_id * 8 + octant_index`).

The **TreeCode** (Bedorf-Gaburov-Portegies Zwart 2014, BONSAI N-body solver) achieves 90% of peak FLOPS on NVIDIA Pascal for Barnes-Hut octree traversal of 10^9 stars by carefully managing warp-coherent walks.

For ray tracing, NVIDIA RTX hardware has **dedicated BVH traversal units** (RT cores). Engineering an octree to run on RT cores requires translating it into a BVH at build time — at which point you have just used a BVH. The octree's last GPU stronghold is **voxel rendering** (Minecraft RTX, voxel ray tracing demos) where the voxel grid structure makes octree-with-uniform-leaves natural and RT-core BVH translation cumbersome.

---

<a name="out-of-core"></a>
## 5. Out-of-Core Quadtrees for Terrain

A planetary-scale terrain mesh (Google Earth, Flight Simulator 2020, Cesium) is **petabytes** of data — three orders of magnitude beyond any RAM. The standard architecture:

1. **Server**: terrain stored as quadtree tiles at every zoom level, each tile a few KB to a few MB. Tile `(z, x, y)` is a deterministic URL or KV-store key.
2. **Streaming engine**: each frame, compute the set of tiles needed for the current view at the current zoom level. Request missing tiles asynchronously; render what is already in memory.
3. **LOD seams**: adjacent tiles at different zoom levels have different vertex counts at the shared edge. Skirts, T-junction repair, or geomorphing techniques hide the seam.
4. **Cache**: LRU eviction in RAM (a few hundred tiles) and disk (a few thousand). Cold tiles re-fetched from network.

**Microsoft Flight Simulator 2020** streams the entire Earth from Azure (petabytes of satellite imagery + geometry) by exactly this pattern. The local client holds a few GB of active tiles; the cloud handles the rest.

The pattern generalizes:

- **Cesium** (3D Tiles spec): octrees of 3D tile content for city models.
- **Unreal's World Composition** + **World Partition**: streaming streaming open worlds as a quadtree.
- **Google Earth Engine**: petabyte-scale satellite analysis with quadtree tile addressing as the primary access pattern.

---

<a name="layout"></a>
## 6. Memory Layout — Pointer vs Index vs Morton-Flat

Three encodings, three trade-offs:

### 6.1 Pointer tree

```
Node = { Bbox, Point[], NE*, NW*, SE*, SW* }
```

Each node is a heap allocation; children are pointers. **Pros**: simple; arbitrary tree shape; cheap insertions. **Cons**: pointer-chase per descent (50-100 cycles cache miss on random allocations); GC pressure in Java/Go; not GPU-friendly.

### 6.2 Indexed (array of nodes)

```
node[i] = { Bbox, Point[], ne_idx, nw_idx, se_idx, sw_idx }
```

Nodes live in a contiguous `[]Node`; children are indices, not pointers. **Pros**: better cache locality (especially with hot top-level nodes near the front); serializable; supports SIMD over node arrays. **Cons**: invalidating deletes leaves holes; periodic compaction needed.

### 6.3 Morton-flat (no indices, no pointers)

The full quadtree at depth d has 4^d cells. Store cells in a flat array of size `(4^(d+1) - 1) / 3`. Child of cell `i` at quadrant `q` is at index `4*i + q + 1`. Parent of cell `i` is `(i - 1) / 4`. No pointers. **Pros**: O(1) traversal arithmetic; trivial GPU layout; max cache locality. **Cons**: only works when the tree is fully populated (or you accept wasted slots for empty cells); deep trees blow up exponentially.

Hybrid: a **bucketed Morton-flat** layout where each cell stores a small bucket and only `interesting` cells (those with points or further-subdivided children) are allocated. The "interesting" set is tracked by a parallel bitmask or hash set.

In production:

- **Game engines**: indexed array of nodes, with a free-list for deleted cells.
- **GPU SVO**: Morton-flat or DAG-flat depending on memory budget.
- **GIS server**: pointer tree in memory, Morton-keyed B-tree on disk.

---

<a name="concurrent"></a>
## 7. Concurrent Insert Strategies

Multi-threaded insert into a quadtree is harder than it looks: subdivision changes the structure, and queries running concurrently must see a consistent view.

### 7.1 Lock per node

Each node holds a mutex. Insert acquires locks down the path. Simple, correct, but contention near the root throttles parallelism — every thread first locks the root.

### 7.2 Lock-free with CAS on children

Replace pointer assignments with CAS (compare-and-swap). On subdivision, build the four children off-heap, then CAS the `divided` flag from false to true. Readers see either the leaf or the four children atomically; no torn state. The trick: when CAS fails, the other thread has already subdivided — re-read and recurse.

### 7.3 Bulk parallel build via Morton sort

The cleanest approach for batch loads: sort points by Morton code in parallel (radix sort), then build the tree bottom-up from contiguous groups. Each level's build is embarrassingly parallel — independent groups become independent subtrees. This is how TreeCode/BONSAI and most GPU octree builders work.

### 7.4 Read-copy-update (RCU)

For mostly-read workloads (broadphase queries each frame, structure changes between frames): build a new quadtree on a worker thread, atomically swap the root pointer when done, retire the old tree once no reader holds it. Linux kernel pattern.

### 7.5 The Box2D pattern

Box2D's dynamic AABB tree handles dynamics by:

1. Enlarging each AABB by a fat margin so small motions don't disturb the tree.
2. On motion, check if the new bbox still fits within the fat parent; if so, no tree update.
3. If not, remove the leaf and reinsert (O(log n) each).
4. Periodic rebalance during idle frames.

This is the gold-standard approach for ≤10^4 dynamic objects in games and physics.

---

<a name="perf"></a>
## 8. Real-Time Collision Broad-Phase Numbers

Measured on a modern x86 desktop (Ryzen 5950X, single thread, 2024), broad-phase collision detection on N dynamic axis-aligned boxes per frame:

| N | Naive O(N²) | Quadtree-of-AABBs | Sweep-and-Prune | Spatial Hash |
|---|---|---|---|---|
| 100 | 10 µs | 30 µs | 25 µs | 35 µs |
| 1,000 | 1 ms | 200 µs | 250 µs | 220 µs |
| 10,000 | 100 ms | 2 ms | 3 ms | 1.5 ms |
| 100,000 | 10 s | 25 ms | 35 ms | 12 ms |
| 1,000,000 | hours | 350 ms | 500 ms | 130 ms |

Observations:

- **Below ~500 objects, naive wins.** Branch prediction loves linear scans; tree overhead does not pay off.
- **From 1,000 to 100,000 objects, quadtree leads** (or ties spatial hash on uniform distributions; spatial hash leads on clustered ones).
- **Above ~100,000, spatial hashing dominates** because of cache behavior — every cell access is a hash lookup with O(1) random memory hit, whereas quadtree depth grows.
- **Sweep-and-prune** is solid across the range but loses to specialized structures at both ends.
- **Quadtree wins decisively when query AABBs are large** (e.g., big swept rectangles for fast-moving objects); spatial hashing struggles because the AABB may touch hundreds of cells.

**Game-engine takeaways.** Bullet, PhysX, and Havok all default to a dynamic AABB tree (BVH) similar to Box2D's, but offer spatial-hash modes for high-N projectile systems. The choice depends on N, motion patterns, and whether queries are mostly point-in-bbox or bbox-overlap.

---

This concludes the professional treatment. The quadtree and octree are old structures — Finkel-Bentley 1974, Meagher 1980 — but the engineering around them has continuously evolved. Morton-keyed flat arrays, sparse voxel DAGs, GPU traversal, and out-of-core tile streaming are 21st-century answers to the same 1970s question: *how do we make spatial queries fast?* The answer is always: hierarchical bounding-box prune, plus cache-aware data layout. That principle is timeless; the implementation details adapt to whatever hardware you have.
