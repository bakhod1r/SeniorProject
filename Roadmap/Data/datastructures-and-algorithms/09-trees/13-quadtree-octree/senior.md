# Quadtree and Octree — Senior Level

> **Audience:** Engineers shipping production systems that index spatial data. Prerequisite: `middle.md`.

This document is a tour of **quadtrees and octrees in production**: how they back the maps you use every day, the game engines you play, the GIS databases that serve trillions of features, and the science codes that simulate galaxies. The goal is to give you enough context to recognize the pattern in any system architecture and to pick the right variant for your own work.

---

## Table of Contents

1. [GIS — Tile Pyramids, PostGIS, R-trees](#gis)
2. [Mapping — Google Maps, Mapbox, OSM](#mapping)
3. [Image Processing — Region Quadtrees](#images)
4. [Game Engines — Broad-Phase Collision](#games)
5. [3D Rendering — Voxel Engines and Minecraft](#voxels)
6. [Sparse Voxel Octrees in GPU Ray Tracing](#svo)
7. [Astrophysics — Barnes-Hut and Tree Codes](#barnes-hut)
8. [Robotics — Octomap and SLAM](#octomap)
9. [Spatial Databases — Oracle, SQL Server, MongoDB](#spatial-db)
10. [Architectural Patterns](#patterns)

---

<a name="gis"></a>
## 1. GIS — Tile Pyramids, PostGIS, R-trees

Geographic information systems (GIS) deal with billions of features: roads, buildings, parcels, sensor readings, satellite pixels. Every spatial query — "what is within 500 m of this point?", "which parcels intersect this polygon?", "give me everything visible in this viewport" — is answered by a spatial index, and that index is almost always a tree of bounding boxes.

**PostGIS** (the geographic extension to PostgreSQL) supports two main index types:

- **GiST (Generalized Search Tree)** — a flexible R-tree-like structure. The default for `GEOMETRY` columns. Internally it uses R-tree splitting heuristics (typically Guttman's quadratic or linear split), but the underlying recursion-on-bounding-rectangles is structurally identical to a quadtree query.
- **SP-GiST (Space-Partitioned GiST)** — explicitly supports quadtrees, k-d trees, and tries. The PostGIS `quadtree_ops` operator class builds a true PR-quadtree variant. Useful for point-only datasets and when the data distribution makes R-tree splits inefficient.

In practice, the R-tree wins on most GIS workloads because it adapts to data clustering. The pure quadtree wins on uniformly distributed point sets and on tile-aligned data (e.g., satellite imagery). Both share the same query API: `<<&` (overlaps), `&&` (bbox intersects), `<->` (k-NN).

**MapServer, GeoServer, ArcGIS** layer their spatial indexes on the same primitives. The vendor differences are in disk layout, write concurrency, and how aggressively they cluster — but the algorithmic core has barely changed since the 1980s.

---

<a name="mapping"></a>
## 2. Mapping — Google Maps, Mapbox, OSM

Web maps work by partitioning the world into a **tile pyramid**: zoom 0 is one 256×256 PNG covering the whole world; zoom 1 splits it into a 2×2 grid (4 tiles); zoom 2 into 4×4 (16); zoom 22 (the practical limit for street view) has 4^22 ≈ 1.7×10^13 tiles. Each zoom level is one stratum of a quadtree.

The **slippy-map tile addressing scheme** (used by Google, Mapbox, OSM, every web mapping API):

```
URL = https://tiles.example.com/{z}/{x}/{y}.png
```

`z` is the zoom level (= tree depth), `(x, y)` is the tile coordinate at that level — directly the index of a quadrant in the Morton-encoded quadtree. The cache-control headers, the CDN, and the browser all key off this scheme. Tile `(z, x, y)` uniquely identifies one quadtree node.

When you pan or zoom the map, the browser computes which tile range covers the visible viewport at the current zoom level — typically 10-30 tiles — and requests them. The quadtree structure makes that computation O(1).

Mapbox Vector Tiles (MVT) extend this from rasters to vector geometry, but the addressing is the same.

**Google Earth's 3D terrain** uses an octree (or rather, a quadtree of terrain patches with vertical multi-resolution layers) for level-of-detail rendering of the planet's surface from orbit down to the street. The system is called "Pyramidal Multi-Resolution Tile Hierarchy" internally.

---

<a name="images"></a>
## 3. Image Processing — Region Quadtrees

For binary or low-color-depth images, a region quadtree encodes uniform rectangles as single nodes. Compression of a black-and-white scan: if the entire image is white, one node. If half is white, one branch becomes a single white leaf; the other recurses. Compression ratio depends on the spatial regularity of the image — a scanned document compresses to ~5% of pixel-array size, a photograph hardly at all.

Variants used in production:

- **MX-quadtree**, **MX-CIF quadtree**: used for indexing axis-aligned rectangles (e.g., text bounding boxes in OCR).
- **CIF (Caltech Intermediate Form) quadtree**: index for VLSI layout; the boxes are circuit components.
- **Quadtree-based JPEG variants**: JPEG itself uses DCT, but quadtree partitioning is the basis of more recent block-adaptive video codecs (HEVC/H.265's "coding tree unit" hierarchy is literally a quadtree).

**Object detection pipelines** (R-CNN family) used image quadtrees historically for region proposals; modern transformer-based detectors don't, but the underlying "look at coarse cells, refine to fine cells" pattern survives in attention masks and feature pyramids.

---

<a name="games"></a>
## 4. Game Engines — Broad-Phase Collision

Every frame, a game engine answers: *which pairs of objects might be touching?* With 10,000 dynamic objects the naive pairwise test is 100 million per frame — impossible at 60 FPS. The fix is **broad-phase collision detection**, and a quadtree (2D) or octree (3D) of object AABBs is the standard approach for spatially heterogeneous scenes.

**Unity** ships `Physics2D.OverlapAreaAll` and `Physics.OverlapBox` built on a dynamic AABB tree (Box2D's algorithm, similar to a loose octree). The Unity Job System parallelizes the queries across cores.

**Unreal Engine** uses an octree (`FOctree<>`) for the scene's spatial partition — visibility culling, light culling, sound emitter culling, navigation queries. The `OctreeQuery` template lets gameplay code do AABB-against-octree in O(log n) without touching the spatial-partition internals.

**Box2D** (the 2D physics library behind countless mobile games) uses a **dynamic AABB tree** — not a strict quadtree but the same prune-on-bbox idea with binary branching and a moving-objects optimization called "fat AABBs" (each AABB is enlarged so small motions don't require tree updates).

**Performance reality:** for ≤10^4 objects, both quadtree and AABB-tree broad-phase finish in under 1 ms on a modern CPU; the bottleneck shifts to narrow-phase (per-pair triangle/polygon tests). Above 10^5 objects, the quadtree's leaf scans dominate; engines switch to **spatial hashing** (a flat grid) or **sweep-and-prune** which both have better cache behavior at scale.

---

<a name="voxels"></a>
## 5. 3D Rendering — Voxel Engines and Minecraft

**Minecraft.** Each world is a grid of 16×16×384 (post-1.18) **chunks**. The chunks themselves are stored in a 2D grid keyed by `(chunkX, chunkZ)`; vertical sections within a chunk are a flat array. So the world is essentially a *shallow* quadtree (one level deep: regions of 32×32 chunks each, the "region files" `.mca`) with a flat array at the leaves. Each chunk uses **palette-encoded** storage: a small dictionary of block types + a packed bit array of indices.

Why no deep octree? Because at 10^5+ blocks per chunk, a deep octree's pointer overhead exceeds the compression savings, and Minecraft's update workload (place/break blocks frequently) makes octree rebalancing expensive. Flat arrays + palette compression win.

**Voxel engines that DO use octrees**: Atomontage, Voxel Farm, John Carmack's experimental SVO engines. They are common in **medical imaging** (volumetric MRI, CT scans where 90% of the volume is air) and **scientific visualization** of sparse fluid flow.

**Unreal Engine 5's Nanite** virtualizes geometry through a hierarchy of cluster groups — not strictly an octree but a similar multi-resolution hierarchical structure with bbox-based culling.

---

<a name="svo"></a>
## 6. Sparse Voxel Octrees in GPU Ray Tracing

For high-end voxel ray tracing, the sparse voxel octree (SVO) is the structure of choice. NVIDIA's **GVDB** (Gigantic Volumetric DataBase) is a GPU-resident sparse voxel octree designed for medical volumes, simulation, and games. It can hold 10^11 occupied voxels in a few GB and ray-trace at interactive rates on a single GPU.

Key implementation points:

- **Flat array storage** keyed by Morton code; each cell's child mask + pointer table inlined for cache hit on traversal.
- **Hierarchical brick caching**: top levels live in fast memory; deep levels are paged from VRAM/disk on demand.
- **GPU-friendly traversal**: warp-coherent stack walks; the SVO is small enough that the stack fits in registers + L1.
- **Material indirection**: voxels store a small material ID, not full color; final shading is a texture lookup.

Octanes/Otoy and Frostbite have shipped engines around similar SVO designs. Even when SVO is not the final delivered structure, it is often the **build-time intermediate** that later gets compacted into a GPU-friendly format.

---

<a name="barnes-hut"></a>
## 7. Astrophysics — Barnes-Hut and Tree Codes

**Barnes & Hut, 1986** — *A hierarchical O(N log N) force-calculation algorithm*. The problem: simulate gravity (or any 1/r² force) on N bodies. Naive: O(N²) per step — for N = 10^10 (a cosmological dark-matter simulation), one step takes years.

The algorithm: build an octree over the bodies. For any body B, when computing forces, you do not need every individual far-away body — you can use the **center of mass** of an entire octree cell as a single source, provided the cell is far enough away. The **opening angle parameter** θ controls the trade-off: if `cell.size / distance_to_B < θ`, use the cell's center of mass; otherwise descend into children.

```
force_on(B, node):
    if node is leaf:
        sum direct forces from each body in node
    elif node.size / distance(B, node.center_of_mass) < theta:
        treat node as one body at its center of mass
    else:
        recurse into all 8 children
```

Total work per step: O(N log N) instead of O(N²). With θ = 0.5 the approximation error is ~10^-3, indistinguishable from exact at most scales of interest. Every major cosmological N-body code since 1990 (Gadget, ChaNGa, HACC, GreeM) uses some variant of this. ChaNGa scales to billions of particles on tens of thousands of cores.

**Variants:** Fast Multipole Method (FMM, Greengard & Rokhlin 1987) goes one further — O(N) using multipole expansions on top of the tree.

---

<a name="octomap"></a>
## 8. Robotics — Octomap and SLAM

**Hornung, Wurm, Bennewitz, Stachniss, Burgard, 2013** — *OctoMap: An Efficient Probabilistic 3D Mapping Framework Based on Octrees*. The de facto standard 3D occupancy grid in ROS (Robot Operating System).

A mobile robot with a LIDAR or depth camera generates point clouds; the world is built up as a 3D grid where each voxel stores `P(occupied)`. A dense grid for a 50×50×10 m building at 5 cm resolution is 10^8 voxels — too much memory for embedded hardware. OctoMap uses a sparse octree of probability values, collapsing internal nodes when all children have the same occupancy state.

Features:

- **Probabilistic update**: each LIDAR ray updates voxels along its path (log-odds increment for "free", decrement at the endpoint for "occupied").
- **Multi-resolution queries**: a path planner can query at 50 cm resolution for global planning, 5 cm for local obstacle avoidance — same tree, different depth.
- **Compression**: an empty room collapses to a single "free" node regardless of resolution.

ROS messages (`octomap_msgs/Octomap`) serialize the tree to binary; the structure transfers between robots and base stations efficiently. Every drone, autonomous car, and Boston Dynamics robot doing 3D obstacle avoidance has an OctoMap or close cousin somewhere in its stack.

---

<a name="spatial-db"></a>
## 9. Spatial Databases — Oracle, SQL Server, MongoDB

Beyond PostGIS, every major database has a spatial index:

- **Oracle Spatial**: R-tree primary index. Older versions supported a "linear quadtree" via Hilbert encoding for use as a B-tree key — useful for tile servers where points need to live in the same index as other columns.
- **Microsoft SQL Server**: `geometry` and `geography` columns use **grid-based indexing** — explicitly a quadtree-like multi-resolution grid where each level can be tuned (HIGH, MEDIUM, LOW density). A row is indexed at the finest cell that fully contains it. The query plan uses bbox-prune on the grid levels.
- **MongoDB**: `2dsphere` indexes use **S2 geometry** (Google's spherical quadtree library). Cells are quadtree cells on a planet-scale Hilbert curve covering the unit sphere.
- **Elasticsearch**: `geo_point` and `geo_shape` use **BKD-trees** (a k-d-tree variant) for points; `geo_shape` uses **prefix-trees over geohashes** which are exactly quadtree node addresses.
- **Redis**: `GEO` commands store points as Geohash strings (Morton-encoded lat/long) in a sorted set; range queries are sorted-set range scans — a manual linear quadtree.
- **DynamoDB Geo Library** (open-source): partitions the world by geohash prefixes, so each DynamoDB partition holds one "cell" of a flat quadtree.

The common pattern: **encode the cell as a sortable key (Morton or Hilbert), store in a B-tree / sorted set / partitioned KV store**. The "quadtree" is implicit in the key encoding.

---

<a name="patterns"></a>
## 10. Architectural Patterns

Recognize a quadtree/octree opportunity when you see:

- **Pruning on bounding boxes** dominating query cost.
- **Multi-resolution views** of the same underlying data.
- **Spatially clustered access** — most queries are about nearby items.
- **Tile-based storage** — fixed-size leaves that can be streamed independently.

Decision tree for production:

```
Is the data static and you query mostly k-NN?           → k-d tree
Is the data 2D and dynamic with rectangle queries?      → quadtree (or AABB-tree)
Is the data 3D and sparse-volumetric?                   → sparse voxel octree
Do you need a single sortable key per cell?             → Morton/Hilbert linear quadtree
Are queries multi-shape (not just AABB)?                → R-tree
Are queries on the sphere (lat/long)?                   → S2 (spherical quadtree)
Is the workload write-heavy and clustered?              → flat hash grid + spatial hashing
```

The boundary between "true quadtree" and "structure that uses the quadtree idea" is thin. What matters in production is the **invariants**: hierarchical bounding-box prune, multi-resolution access, and (often) a Morton-style sortable key. Master those and the implementation language and storage backend become details.

---

Continue with `professional.md` for sparse voxel DAGs, GPU traversal performance, out-of-core terrain, and concurrent update strategies.
