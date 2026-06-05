# R-Tree — Middle Level

> **Audience:** Engineers who understand Guttman's original R-tree (see `junior.md`) and want the variants and bulk-load techniques used in real systems. Prerequisite: `junior.md`.

This document covers the **family of R-tree variants** that exist for different workloads, the **bulk-load** algorithm STR (the only practical way to build a tight R-tree from scratch), **R\*-tree** (the de facto production standard), **R+ tree** (zero-overlap variant), **Hilbert R-tree** (space-filling-curve packing), **incremental k-nearest-neighbour** queries, and brief notes on **3-D R-trees** for spatio-temporal indexing.

---

## Table of Contents

1. [R\*-Tree — The Production Default](#rstar)
2. [R+ Tree — Zero Overlap by Duplicating Objects](#rplus)
3. [Hilbert R-Tree — Pack by Space-Filling Curve](#hilbert)
4. [STR Bulk Load — Sort-Tile-Recursive](#str)
5. [Split Heuristics Compared](#splits)
6. [Forced Reinsertion in Detail](#reinsertion)
7. [Incremental k-NN Query](#knn)
8. [3-D R-Tree for Spatio-Temporal Data](#three-d)

---

<a name="rstar"></a>
## 1. R\*-Tree — The Production Default

Beckmann, Kriegel, Schneider, and Seeger published **"The R\*-tree: An Efficient and Robust Access Method for Points and Rectangles"** at SIGMOD 1990. Their headline claim: 30–40% fewer node accesses than plain Guttman R-tree on average workloads, with no change to the user-facing API. Forty years later this is still the default R-tree variant in PostGIS (via GiST), SpatiaLite, and academic libraries.

R\*-tree changes three things relative to Guttman:

### 1.1 ChooseSubtree (modified)

Plain Guttman picks the child that needs **least enlargement**. R\*-tree picks differently at different levels:

- **At a level whose children are leaves**: pick the child whose MBR yields **least overlap enlargement** with sibling MBRs. (Overlap with siblings is what causes multi-path descents, so minimising it here is a direct quality improvement.) Ties broken by least area enlargement.
- **At higher levels**: same as Guttman — least area enlargement, ties by least area.

The leaf-level overlap criterion is expensive (`O(M²)` per choice) but pays for itself in query latency.

### 1.2 Split heuristic (R\*-tree split)

For each axis, sort the entries by `min` and by `max` of that axis. For each sort and each split position, compute:

- **goodness-of-split** = perimeter sum of the two resulting MBRs.

Pick the axis with minimum total perimeter sum (the *axis selection*). Then on that axis, pick the split position minimising:

1. **Overlap** of the two resulting MBRs.
2. Tied? Total **area**.

Why perimeter? Perimeter is a proxy for "squareness" — square MBRs minimise the average dead space they introduce into query rectangles. Why overlap-then-area? Because overlap directly drives multi-path descent (the dominant cost), and area is the secondary cost (dead space).

### 1.3 Forced reinsertion

The killer feature. On the **first** overflow at a given level during an insert, instead of splitting, R\*-tree:

1. Sorts the M+1 entries by the distance of each entry's centroid from the node's MBR centroid.
2. Removes the **30% farthest** entries.
3. Calls insert again on each of them from the root.

Only on a **second** overflow at the same level (during the reinsert cascade) does R\*-tree actually split. The result: entries that no longer "belong" in a node get a chance to find a better home, and globally the tree's overlap drops dramatically.

### 1.4 Cost

R\*-tree's insert is `~2×` slower than plain Guttman due to forced reinsertion (often visiting the tree twice per insert). Its queries are `~30-40%` faster. For read-heavy workloads (the typical spatial DB), this is an excellent trade.

### 1.5 Pseudocode for R\*-tree split (axis selection only)

```python
def rstar_split(entries):
    best_axis, best_dist = None, math.inf
    candidates = {}
    for axis in (0, 1):           # 0 = x, 1 = y
        for sort_by in ("min", "max"):
            sorted_es = sorted(entries, key=lambda e: getattr(e.mbr, f"{sort_by}_{['x','y'][axis]}"))
            total = 0
            distributions = []
            for k in range(MIN, M - MIN + 2):
                g1 = sorted_es[:k]; g2 = sorted_es[k:]
                p1 = perimeter(mbr_of(g1)); p2 = perimeter(mbr_of(g2))
                total += p1 + p2
                distributions.append((g1, g2))
            if total < best_dist:
                best_dist, best_axis, candidates = total, axis, distributions
    # Now pick split position by overlap, tie by area
    best = min(candidates, key=lambda d: (overlap(mbr_of(d[0]), mbr_of(d[1])),
                                          mbr_of(d[0]).area() + mbr_of(d[1]).area()))
    return best
```

This is more involved than Guttman quadratic, but it runs in `O(M log M)` and produces dramatically better trees.

---

<a name="rplus"></a>
## 2. R+ Tree — Zero Overlap by Duplicating Objects

Sellis, Roussopoulos, and Faloutsos proposed the **R+ tree** at VLDB 1987. Its central idea: forbid sibling MBR overlap entirely. If an object straddles two sibling regions, **store it in both**.

### Properties

- **Zero overlap** between sibling MBRs.
- **Single-path descent** for point queries (great for queries that are points, like "what feature is at (lat, lng)?").
- **Object duplication** for objects that cross region boundaries (the price you pay).

### Trade-offs

- Point queries are guaranteed `O(log_M n)` worst case — never multi-path.
- Range queries still touch multiple nodes (because the range query rectangle itself can straddle boundaries).
- Storage overhead is proportional to how often objects straddle boundaries. For tiny objects in a uniform distribution, ~negligible. For huge objects (e.g., a road segment crossing many tiles), overhead can be 5–10×.
- **Delete is messy**: deleting an object means removing all copies, and the tree must track which entries are duplicates of the same original.

### When to choose

- Workload is point-query-heavy and objects are small. Example: indexing GPS pings against a map of neighbourhoods.
- You can tolerate write-time cost for read-time guarantees.

R+ tree is rare in modern production systems because R\*-tree gives similar query performance without duplication. But it remains the textbook reference for "zero overlap" structures.

---

<a name="hilbert"></a>
## 3. Hilbert R-Tree — Pack by Space-Filling Curve

Ibrahim Kamel and Christos Faloutsos at VLDB 1994 introduced the **Hilbert R-tree**. The idea: map each MBR's centroid to a 1-D **Hilbert curve key**, and treat the R-tree as a B+ tree on those keys.

### Why Hilbert curve?

A space-filling curve is a 1-D ordering of 2-D (or k-D) space. Hilbert preserves locality remarkably well: two MBRs close on the Hilbert key are usually close in space. This means **B+ tree splits on the Hilbert key produce sibling nodes that are spatially compact** — which is exactly what an R-tree wants.

### Construction

1. Compute each entry's centroid.
2. Map centroid to Hilbert key (O(log range) bit-twiddling).
3. Insert into a B+ tree keyed by Hilbert key, with leaves storing the original MBR and payload.
4. Maintain MBR aggregates in internal nodes as usual.

### Benefits

- **Bulk load is essentially a B+ tree bulk load** sorted by Hilbert key — extremely cache-friendly, `O(n log n)`.
- **Disk locality is excellent.** Pages adjacent on disk are also adjacent in space, so range scans don't seek much.
- **Insert is straightforward**: compute Hilbert key, B+ tree insert. No fancy heuristics.

### Drawbacks

- For very long, thin rectangles, the centroid is a poor proxy. Hilbert R-tree's MBRs may end up overlapping more than R\*-tree's.
- The Hilbert key is fixed at construction time. If your data range changes, you might need to rebuild.

Used in: some GIS systems, especially for read-mostly workloads where bulk load and excellent disk locality matter more than dynamic insert quality.

---

<a name="str"></a>
## 4. STR Bulk Load — Sort-Tile-Recursive

Leutenegger, Lopez, and Edgington's **Sort-Tile-Recursive (STR)** algorithm (1997) is the standard bulk-load algorithm for R-trees. Given `n` rectangles up front, STR builds a tree in `O(n log n)` time with **near-zero MBR overlap** and ~100% leaf fill.

The reason STR matters: **incremental insertion of n rectangles takes `O(n M log_M n)` time and produces a tree with substantial overlap.** STR is faster *and* gives better query performance.

### The algorithm (2-D)

Given `n` rectangles, target fanout `M`:

1. Compute the number of leaves needed: `P = ⌈n / M⌉`.
2. Compute the number of vertical "slices": `S = ⌈√P⌉`.
3. Sort all rectangles by **centroid x**.
4. Partition into `S` contiguous slices of `⌈n / S⌉` rectangles each.
5. Within each slice, sort by **centroid y**.
6. Partition each slice into `⌈n / (S × M)⌉` groups of `M` rectangles. Each group becomes one leaf.
7. The result is `P` leaves, all roughly `M`-full.
8. Recurse on the leaves' MBRs to build the next level.

### Why "tile"?

After the two sorts, the rectangles are grouped into a grid of `S × (P/S)` tiles, each containing exactly `M` rectangles (modulo rounding). The grid is the "tiling" of step 6.

### Properties

- Time: `O(n log n)` (dominated by sorting).
- Tree fill: every leaf except possibly one is exactly `M`.
- Sibling overlap: very low — STR-built trees often outperform incrementally-built R\*-trees on queries.

### When to use

- **Initial load** of a spatial database from a known dataset. Always STR.
- **Periodic rebuild** of a degraded tree.
- **Read-mostly workloads** where you can afford to rebuild after large batches of inserts.

### Pseudocode (Python sketch)

```python
def str_pack(rects, M):
    if len(rects) <= M:
        return Node(leaf=True, entries=[Entry(mbr=r, payload=p) for r, p in rects])
    P = math.ceil(len(rects) / M)
    S = math.ceil(math.sqrt(P))
    rects.sort(key=lambda rp: (rp[0].min_x + rp[0].max_x) / 2)
    slice_size = math.ceil(len(rects) / S)
    leaves = []
    for s in range(S):
        slice_rects = rects[s * slice_size : (s + 1) * slice_size]
        slice_rects.sort(key=lambda rp: (rp[0].min_y + rp[0].max_y) / 2)
        for i in range(0, len(slice_rects), M):
            leaf_entries = [Entry(mbr=r, payload=p) for r, p in slice_rects[i:i + M]]
            leaves.append(Node(leaf=True, entries=leaf_entries))
    # Recurse on (mbr_of_leaf, leaf) pairs to build the upper levels.
    upper = [(mbr_of(l.entries), l) for l in leaves]
    return _str_internal(upper, M)
```

### 3-D and higher

STR generalises: sort by `x` into `n^(1/d)` slices, sort each by `y` into `n^(2/d)` strips, etc. The fanout is preserved; the constants grow with dimension but the algorithm is unchanged.

---

<a name="splits"></a>
## 5. Split Heuristics Compared

| Heuristic | Cost | Query quality | Used by |
|---|---|---|---|
| **Linear (Guttman 1984)** | `O(M)` per split | Mediocre — significant overlap | Early systems; teaching examples |
| **Quadratic (Guttman 1984)** | `O(M²)` per split | Good baseline | Original Guttman R-tree |
| **R\*-tree split (Beckmann 1990)** | `O(M log M)` per split | Best on average | PostGIS GiST, SpatiaLite |
| **R+ split (Sellis 1987)** | `O(M log M)` per split | Zero overlap, duplicates objects | R+ tree |
| **STR pack (Leutenegger 1997)** | `O(n log n)` for whole tree | Excellent on static data | Bulk load, periodic rebuild |
| **Hilbert split** | `O(M log M)` per split | Good locality | Hilbert R-tree |

In production: build initially with STR. For inserts after that, use R\*-tree split. Plain Guttman quadratic remains the simplest pedagogical reference but is rarely the right production choice.

---

<a name="reinsertion"></a>
## 6. Forced Reinsertion in Detail

R\*-tree's most distinctive idea. The algorithm:

```
overflow_treatment(node, level):
    if first overflow at this level during the current insertion:
        # Forced reinsertion
        sort node.entries by distance(entry.mbr.center, node.mbr.center) descending
        p = 0.3 * M     # 30% of entries
        to_reinsert = node.entries[:p]
        node.entries = node.entries[p:]
        adjust_tree(node, None)             # tighten MBRs
        for e in to_reinsert:
            insert(e, from_root=True)
    else:
        # Standard split
        split_node(node)
```

The "level marker" must be per-insertion, not global, so the algorithm avoids infinite loops. The standard trick: each insertion carries a bitset indicating which levels have already triggered reinsertion this round.

### Why reinsertion works

A node's MBR grows over time as you insert more rectangles into it. Old entries that were chosen because they minimised enlargement at the time may no longer be the best fit — their better home is elsewhere in the tree. Forced reinsertion gives them a chance to migrate.

### Why "30% farthest"

Empirically, the authors tested 10%, 20%, 30%, 40%, 50%. 30% gave the best overall trade-off between disruption (reinserting too many becomes a global rebuild) and quality improvement. The number is a parameter; you can tune for your workload.

### Cost

Each forced reinsertion does up to `0.3 × M` extra inserts. In the worst case, those inserts cascade up the tree triggering more reinsertions. In practice, the cascades terminate quickly because reinserted entries usually find a new home without further overflow.

Net effect: R\*-tree inserts are ~2× slower than Guttman, but the tree quality stays high over the long term. Crucial for write-heavy workloads where you cannot afford to rebuild.

---

<a name="knn"></a>
## 7. Incremental k-NN Query

Given a query point `q` and an integer `k`, find the `k` nearest objects in the index. Roussopoulos, Kelley, and Vincent introduced the **incremental k-NN** algorithm for R-trees in 1995.

### The algorithm

Use a min-priority queue keyed by **minimum distance from `q` to the entry's MBR** (`mindist`).

```python
def knn(root, q, k):
    pq = []                       # min-heap of (priority, entry, is_leaf_entry)
    heappush(pq, (0, root_entry, False))
    results = []
    while pq and len(results) < k:
        priority, e, is_leaf = heappop(pq)
        if is_leaf:
            results.append(e.payload)
        else:
            for child_entry in e.child.entries:
                d = mindist(q, child_entry.mbr)
                heappush(pq, (d, child_entry, e.child.leaf))
    return results
```

`mindist(q, mbr)` is the shortest Euclidean distance from `q` to the closest point on the MBR boundary (or 0 if `q` is inside).

### Why this works

When you pop an entry from the queue, it has the smallest `mindist` among everything you have seen so far. If that entry is a leaf (an actual object), you can safely emit it: no other unseen object can be closer because they all live in subtrees whose `mindist` ≥ this object's distance.

If it is an internal node, you "expand" it by pushing its children. This is best-first search.

### Complexity

- Average: `O(log n + k)`. Each step does at most `M` heap operations.
- Worst: `O(n)` if all objects cluster at the same distance.

### Variants

- **`MINMAXDIST`** (Roussopoulos's original optimisation): a tighter pruning bound. If you have already seen `k` candidates and the smallest `mindist` to an unseen subtree exceeds the largest candidate distance, you can stop. The original paper uses both `mindist` and `minmaxdist`; the simple version above with just `mindist` is correct and simpler, slightly less aggressive.
- **k-NN with predicates**: only return objects matching a side filter. Same algorithm, skip leaf entries whose payload fails the filter (but still count them against k? — design choice).
- **Reverse k-NN**: "find all objects whose nearest neighbour is `q`." Different problem; usually handled with specialised structures.

### Use cases

- "Find the 10 nearest gas stations to my position." PostGIS uses this via the `<->` operator.
- "Find the nearest 5 photos to this location." Mapping apps.
- "Find the nearest hospitals for an emergency dispatch."

---

<a name="three-d"></a>
## 8. 3-D R-Tree for Spatio-Temporal Data

The R-tree generalises to `d` dimensions without changing the algorithm — every "rectangle" becomes a `d`-orthotope, MBRs are `d`-orthotopes, and `intersect`, `area`, and `union` extend naturally.

### Spatio-temporal indexing

Treat **time as an extra dimension**: index "trajectories" as 3-D MBRs `(x_min, y_min, t_min, x_max, y_max, t_max)`. Queries like:

> "Which vehicles were in this region between 13:00 and 14:00?"

become standard 3-D range queries on the 3-D R-tree.

### Other 3-D use cases

- **CAD / BIM**: index 3-D building components.
- **Game / physics engines**: BVH (Bounding Volume Hierarchy) is a 3-D R-tree, used for collision broadphase. Walt Disney Animation Studios, Pixar, every AAA game engine.
- **Point cloud indexing**: although octrees often win for points specifically, 3-D R-trees handle mixed point + region payloads cleanly.
- **Voxel volumes**: large medical imaging volumes use a 3-D R-tree of subvolumes to skip empty space in queries.

### Curse of dimensionality

Above ~10 dimensions, the **volume of an MBR grows faster than the volume of contained objects**. Every internal MBR covers most of the search space, so queries no longer prune effectively. R-tree performance degrades to linear scan.

For high-D similarity search (image embeddings, vector search), R-tree is the wrong tool. Use **VAMSplit R-tree** (a variant tuned for high-D), **LSH**, **HNSW**, or **PQ-IVF** (FAISS-style). We cover these briefly in `professional.md`.

### Implementation note

Generalising the 2-D code in `junior.md` to k-D is mostly a `Rect` → `Orthotope` change with a loop over dimensions. The split heuristics extend naturally — R\*-tree's "axis selection" already iterates over axes.

---

## Summary

- **R\*-tree** is the default production R-tree variant: modified chooseSubtree, perimeter-based split, forced reinsertion. 30–40% fewer node accesses than plain Guttman.
- **R+ tree** trades duplication for zero overlap; great for point queries on small objects.
- **Hilbert R-tree** uses a space-filling curve key; excellent disk locality, simple insert.
- **STR bulk load** builds a near-perfect R-tree in `O(n log n)` for static datasets — always use this when you can.
- **Incremental k-NN** with a priority queue keyed by `mindist` gives `O(log n + k)` average.
- **3-D R-tree** handles spatio-temporal data and 3-D scenes; degenerates above ~10 dimensions.

Continue with `senior.md` for how PostGIS, Oracle Spatial, SQLite RTREE, and Lucene use R-trees (or their successors) in real production systems.

---

## Further Reading

- Beckmann, Kriegel, Schneider, Seeger, *"The R\*-tree"*, SIGMOD 1990.
- Sellis, Roussopoulos, Faloutsos, *"The R+ Tree"*, VLDB 1987.
- Kamel & Faloutsos, *"Hilbert R-tree"*, VLDB 1994.
- Leutenegger, Lopez, Edgington, *"STR: A Simple and Efficient Algorithm for R-Tree Packing"*, ICDE 1997.
- Roussopoulos, Kelley, Vincent, *"Nearest Neighbor Queries"*, SIGMOD 1995.
- Samet, *Foundations of Multidimensional and Metric Data Structures*, 2006.
