# R-Tree — Senior Level

> **Audience:** Engineers shipping spatial data in production who need to know which RDBMS uses which variant and why. Prerequisite: `middle.md`.

This document is a tour of **how every major spatial database in production actually implements R-trees** (or their successors). It covers PostGIS, Oracle Spatial, MySQL / MariaDB, SQLite RTREE, SpatiaLite, MongoDB, Elasticsearch / Lucene, Mapbox MBtiles, Hadoop SpatialHadoop / GeoSpark, and 3-D systems like ROS / Octomap. Knowing these mappings is what lets you pick the right database, debug index-related performance, and answer architecture-design questions in interviews.

---

## Table of Contents

1. [PostGIS — GiST + R-tree split](#postgis)
2. [Oracle Spatial — Native R-tree since 8i](#oracle)
3. [MySQL / MariaDB SPATIAL indexes](#mysql)
4. [SQLite RTREE virtual table](#sqlite)
5. [SpatiaLite — SQLite + GEOS + R-tree](#spatialite)
6. [MongoDB 2d / 2dsphere](#mongo)
7. [Elasticsearch geo\_shape — BKD-tree](#es)
8. [Lucene BKD-tree (since 6.0)](#lucene)
9. [Mapbox MBtiles — Tile R-tree](#mapbox)
10. [Hadoop SpatialHadoop / GeoSpark](#hadoop)
11. [ROS / Octomap — 3-D worlds](#ros)

---

<a name="postgis"></a>
## 1. PostGIS — GiST + R-tree split

**PostGIS** is the de facto open-source spatial database, an extension to PostgreSQL maintained since 2001. PostGIS does **not** ship a pure R-tree; it ships an **R-tree implemented on top of GiST**.

### GiST — Generalised Search Tree

GiST is a PostgreSQL framework (Hellerstein, Naughton, Pfeffer, 1995) that lets extension authors plug in **any tree-shaped index** by providing a small set of opaque methods:

- `consistent(entry, query)` — does this subtree entry match the query?
- `union(entries)` — compute the parent's key.
- `compress(entry)` / `decompress(entry)` — for on-disk representation.
- `penalty(key, new_entry)` — choose-subtree cost.
- `picksplit(entries)` — how to split an overflowing node.
- `same(a, b)` — equality.

PostGIS implements these for `GEOMETRY` and `GEOGRAPHY` types using R\*-tree-style split logic. The default operator class `gist_geometry_ops_2d` uses 2-D MBRs (bounding boxes) for split decisions.

### Index syntax

```sql
CREATE INDEX idx_buildings_geom ON buildings USING GIST (geom);
```

### Query pattern

The R-tree-style index answers `&&` (overlapping bounding boxes). Exact predicates like `ST_Intersects` then refine the candidate set:

```sql
SELECT * FROM buildings
WHERE geom && ST_MakeEnvelope(-74, 40, -73, 41, 4326)   -- index uses MBR
  AND ST_Intersects(geom, my_polygon);                  -- exact check
```

PostGIS users almost never need to know the index is GiST + R-tree. They write `CREATE INDEX … USING GIST`, and the planner does the rest. But knowing it underneath is GiST + R\*-tree style split tells you:

- **Performance characteristics** match R\*-tree (low overlap, good query latency).
- **Bulk load** does *not* use STR by default; instead, `CREATE INDEX` does parallel incremental builds. PostGIS 3+ added an experimental `BUFFERING` mode that approximates STR.
- **Concurrency**: GiST uses heavyweight per-page locks. High write throughput requires SPGiST or partitioning.

### Geography vs geometry

`gist_geography_ops` indexes on the sphere using bounding **3-D cones** rather than 2-D MBRs. Same R-tree structure underneath, different MBR math.

---

<a name="oracle"></a>
## 2. Oracle Spatial — Native R-tree since 8i

Oracle Spatial (now Oracle Spatial and Graph) has shipped an R-tree since version 8i (1999). It is the canonical commercial example.

### Index type

```sql
CREATE INDEX idx_geom ON parcels(geom)
    INDEXTYPE IS MDSYS.SPATIAL_INDEX_V2
    PARAMETERS('SDO_INDX_DIMS=2 LAYER_GTYPE=POLYGON');
```

Oracle's R-tree variant is closer to R\*-tree than plain Guttman. The `SDO_INDX_DIMS` parameter selects 2-D (most common) or 3-D / 4-D (for spatio-temporal indices).

### Bulk load

Oracle supports `CREATE INDEX … LOAD BALANCED` which does STR-style packing during the initial build. Subsequent inserts use incremental R\*-tree logic.

### Spatial queries

Oracle's `SDO_FILTER` returns a candidate set using the R-tree; `SDO_RELATE` refines using exact geometry. The pattern matches PostGIS.

### Quad R-tree

Oracle Spatial also offers a "Quad R-tree" variant that combines a quadtree-like spatial partitioning with R-tree-style internal node aggregation. Used for hybrid point/region workloads.

---

<a name="mysql"></a>
## 3. MySQL / MariaDB SPATIAL indexes

MySQL has shipped SPATIAL indexes since 4.1 (2004). Both MyISAM and (since 5.7) InnoDB support R-tree indexes on `GEOMETRY` columns.

### Index syntax

```sql
CREATE TABLE roads (
    id INT PRIMARY KEY,
    path GEOMETRY NOT NULL SRID 4326,
    SPATIAL INDEX (path)
);
```

### Implementation

MySQL implements a plain Guttman R-tree with quadratic split. Not R\*-tree, not Hilbert. Performance is acceptable for moderate workloads but lags PostGIS for large datasets.

### Limitations

- **No bulk loader.** All inserts are incremental.
- **Only MBR queries** are accelerated: `MBRIntersects`, `MBRContains`, `MBRWithin`. Exact predicates like `ST_Intersects` need a follow-up scan.
- **No SRID-aware indexing** until 8.0 (2018).

MariaDB tracks MySQL's R-tree implementation closely. For demanding workloads, most teams pick PostGIS instead.

---

<a name="sqlite"></a>
## 4. SQLite RTREE virtual table

SQLite ships an R\*-tree implementation as a **virtual table** module. Available since 3.6.x (2008), compiled in by default in most builds.

### Usage

```sql
CREATE VIRTUAL TABLE demo_index USING rtree(
    id,           -- Integer primary key
    minX, maxX,
    minY, maxY
);

INSERT INTO demo_index VALUES (1, -80.0, -79.0, 35.0, 36.0);

-- Query: find rows whose MBR overlaps a box.
SELECT id FROM demo_index
WHERE minX <= -79.5 AND maxX >= -80.0
  AND minY <= 35.5  AND maxY >= 35.0;
```

The virtual table is a **pure index** — it stores only the bounding box plus an integer ID. You join back to the main table to get the geometry.

### Why SQLite chose R\*-tree

SQLite is the most-deployed database in the world (mobile phones, browsers, embedded systems). The SQLite RTREE module is used by:

- **Mapbox iOS Tiles** for offline map tile lookup.
- **Wikipedia POI cache** (offline article geography).
- **OpenStreetMap utilities** (mod\_tile, mbtiles).
- Many embedded GIS apps.

R\*-tree was chosen because it gives near-optimal queries with predictable performance, and the algorithm fits comfortably in SQLite's "small, correct, well-tested" philosophy.

### Performance characteristics

- 1-D, 2-D, 3-D, 4-D, and 5-D versions exist (`rtree1`, `rtree2`, …).
- Single-threaded (SQLite is anyway).
- ~50 ns per query on warm cache for trees < 1 M entries.
- Excellent for embedded / mobile use; not designed for OLTP-scale workloads.

---

<a name="spatialite"></a>
## 5. SpatiaLite — SQLite + GEOS + R-tree

SpatiaLite is SQLite + GEOS (geometry library) + helper functions, plus a thin wrapper that uses SQLite's RTREE module to index geometry columns. Excellent for embedded GIS.

### Workflow

1. Store geometry in a `GEOMETRY` column.
2. Create a `BBOX` R-tree index (SpatiaLite manages the bookkeeping).
3. Triggers keep the R-tree in sync on insert / update / delete.

```sql
SELECT CreateSpatialIndex('parcels', 'geom');
-- Behind the scenes: creates `idx_parcels_geom` rtree virtual table
-- plus AFTER INSERT / UPDATE / DELETE triggers.
```

Queries that use the `MbrIntersects` operator are automatically rewritten to hit the R-tree first, then refine with the geometry library.

---

<a name="mongo"></a>
## 6. MongoDB 2d / 2dsphere

MongoDB has had geospatial indexes since 1.0 (2009).

### `2d` index — legacy, planar

The original `2d` index used **geohash-based** indexing (a quadtree-style scheme), not an R-tree. It supports points only and is now deprecated for new applications.

### `2dsphere` index — current, spherical

`2dsphere` uses Google's **S2 library** (spherical cells, a quadtree-like decomposition of the sphere). Underneath, S2 cells are stored in a standard B-tree (MongoDB's WiredTiger storage engine). The query engine computes the set of S2 cells covering the query region and looks each up.

This is **not technically an R-tree**, but the query semantics are R-tree-like: "find all objects whose covering S2 cells intersect the query's covering S2 cells." For comparison purposes, MongoDB's geo index is closer to a quadtree-on-disk than to an R-tree.

### Why this matters

When someone says "MongoDB uses R-trees", they are usually wrong about the modern `2dsphere` index. The 2007–2014 era `2d` index had R-tree-like properties; the current standard is S2 cells.

---

<a name="es"></a>
## 7. Elasticsearch geo\_shape — BKD-tree

Elasticsearch (and Lucene underneath) used R-trees for `geo_shape` until version 5.x. Starting with Lucene 6 / Elasticsearch 6 (2017), they migrated to **BKD-trees** (Block kd-trees).

### BKD-tree

- **Procopiuc, Agarwal, Arge, Vitter (2003)**: introduced the BKD-tree as a *cache-efficient* alternative to R-tree for multi-dimensional numeric data.
- A **kd-tree** partitioned into **blocks** (one block = one Lucene segment).
- Each block is internally sorted and stored as a sequence of fixed-size posting lists.
- Queries do classic kd-tree pruning at block boundaries; within a block, a sorted array of points is scanned with binary search.

### Why Elasticsearch switched

- **Better cache behaviour** for billions of points.
- **Easier to merge / split** with Lucene's segment model.
- **Excellent for numeric range queries**, not just geo. After the geo migration, Lucene also moved `LongPoint` / `IntPoint` / `DoublePoint` to BKD.
- **Simpler concurrency** than an R-tree because segments are immutable.

For geo polygons, the BKD-tree indexes a triangulated mesh: the polygon is decomposed into triangles, each triangle's MBR becomes a BKD point. The trade-off is more entries in the index in exchange for excellent query latency.

Mike McCandless's blog post *"Lucene's BKD-tree as a sole-cause spatial index"* (2015) describes the migration in detail. Elasticsearch users do not need to know — but if you debug `geo_shape` query latency, you are looking at BKD-tree internals.

---

<a name="lucene"></a>
## 8. Lucene BKD-tree (since 6.0)

Same story as Elasticsearch: Lucene 6.0 (2016) migrated all multi-dimensional numeric and geo indexing to BKD-tree.

### Migration summary

| Before Lucene 6 | After Lucene 6 |
|---|---|
| `TrieField` / numeric range queries | `LongPoint` / `IntPoint` / `DoublePoint` over BKD |
| `prefix_tree` quadtree for geo | BKD over (lat, lon) doubles |
| Geo shape R-tree | BKD over triangle MBRs |

Lucene 6.0 release notes call this the "biggest performance improvement in years" — orders-of-magnitude faster range queries and significantly smaller indexes.

### R-tree comparison

BKD wins for **append-only, immutable segments** (Lucene's model). R-tree wins for **mutable, in-place** indexes where you need fast inserts. PostgreSQL's GiST is mutable; Lucene is immutable; that single difference explains the divergence.

---

<a name="mapbox"></a>
## 9. Mapbox MBtiles — Tile R-tree

Mapbox's **MBTiles** format (an open spec maintained on GitHub) is a SQLite database storing vector or raster tiles. The container's tile lookup uses an **R-tree of tile bounding boxes**.

### Practical pattern

A mobile map app downloads an MBTiles file (effectively a SQLite DB), opens it with SpatiaLite or the SQLite RTREE module, and answers:

> "Which tiles do I need to render the current viewport?"

This is a 2-D bounding-box overlap query: R-tree material.

### Why SQLite + R-tree

Single-file packaging (one `.mbtiles` per region), no server required, works offline, queries cost a few microseconds. Used by Mapbox iOS / Android SDK and dozens of third-party tools.

---

<a name="hadoop"></a>
## 10. Hadoop SpatialHadoop / GeoSpark

For big data spatial joins, single-node R-trees do not scale. **SpatialHadoop** (Eldawy & Mokbel, 2015) and **GeoSpark** (now Apache Sedona) partition data across nodes using **distributed R-trees** or **R-tree-based partitioners**.

### Distributed pattern

1. **Sample** the dataset to estimate distribution.
2. **Build a coarse R-tree** over the samples — call it the *global index*.
3. **Partition** the full dataset by mapping each rectangle to the leaf MBR it best fits.
4. Each partition is processed in parallel; results are merged.

For spatial joins (e.g., "find all parking lots within 500 m of a school"), the global R-tree determines which partitions can possibly join. The synchronised-tree-traversal join (covered in `tasks.md`) runs on each pair of partitions in parallel.

### Variants

- **Apache Sedona** (open source, formerly GeoSpark): builds an R-tree per Spark partition; partitions assigned by an STR-style global partitioner.
- **GeoMesa** over **Accumulo / HBase**: combines a Hilbert-curve-encoded row key with R-tree-style metadata.

---

<a name="ros"></a>
## 11. ROS / Octomap — 3-D worlds

Robotics frameworks index 3-D space — point clouds, occupancy maps, sensor fusion. **Octomap** (Hornung et al., 2013) primarily uses an **octree** (the 3-D quadtree analogue), but for indexing **rectangular volumes** (e.g., obstacle bounding boxes, region-of-interest queries), 3-D R-trees come into play.

In **ROS / rviz**:

- Point clouds → octree (Octomap).
- Object lists with extents (e.g., detected obstacles) → 3-D R-tree.
- Collision broadphase between robot arm links and world → BVH (3-D R-tree).

Game engines use the same pattern: octree for static voxel worlds, BVH (3-D R-tree) for dynamic objects.

---

## Comparison table

| System | Index type | Variant | Bulk load | Concurrency |
|---|---|---|---|---|
| **PostGIS** | GiST | R\*-tree style | Incremental (BUFFERING optional) | Page locks |
| **Oracle Spatial** | Native R-tree | R\*-tree style | STR via LOAD BALANCED | RWLock |
| **MySQL / MariaDB** | SPATIAL | Guttman quadratic | Incremental | InnoDB row locks |
| **SQLite RTREE** | Virtual table | R\*-tree | Incremental | Single-writer |
| **SpatiaLite** | SQLite RTREE | R\*-tree | Incremental | Single-writer |
| **MongoDB 2dsphere** | S2 cells over B-tree | Not R-tree | Incremental | Document locks |
| **Elasticsearch / Lucene** | BKD-tree | Block kd-tree | Per-segment STR-like | Immutable segments |
| **Mapbox MBTiles** | SQLite RTREE | R\*-tree | One-shot at packaging | Read-only |
| **Apache Sedona** | Distributed R-tree | STR partitioner | Distributed STR | Per-partition |
| **Octomap** | Octree (+ R-tree side index) | n/a | Incremental | RWLock |

---

## What to remember

- **For relational + spatial queries → PostGIS.** GiST + R\*-tree split. The gold standard.
- **For embedded / mobile → SQLite RTREE.** R\*-tree, one of the most-deployed R-trees in history.
- **For full-text + geo at scale → Elasticsearch.** BKD-tree, not R-tree (since v6).
- **For big-data spatial joins → Apache Sedona.** Distributed STR partitioner.
- **For physics / collision → BVH (3-D R-tree).** Every game engine.

If an interviewer asks "what spatial index would you use?", the answer is almost always "it depends on the database I'm already using." The R-tree is rarely chosen on its own; it comes packaged with the storage system.

---

## Further Reading

- Hellerstein, Naughton, Pfeffer, *"Generalized Search Trees for Database Systems"*, VLDB 1995. The GiST paper.
- PostgreSQL docs, *"GiST Indexes"* and *"Extensibility — Building a GiST Operator Class"*.
- SQLite docs, *"The SQLite R\*Tree Module"*.
- McCandless, *"Lucene's BKD-tree as a sole-cause spatial index"* (Apache Lucene blog, 2015).
- Procopiuc, Agarwal, Arge, Vitter, *"BKD-Tree: A Dynamic Scalable kd-Tree"*, SSTD 2003.
- Eldawy & Mokbel, *"SpatialHadoop: A MapReduce Framework for Spatial Data"*, ICDE 2015.
- Hornung et al., *"OctoMap: An Efficient Probabilistic 3D Mapping Framework Based on Octrees"*, Autonomous Robots 2013.
