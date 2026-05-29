# R-Tree — Junior Level

> **Read time: ~40 minutes** · **Audience:** Engineers who know B-trees and bounding-box basics, and want to understand the spatial index used by PostGIS, Oracle Spatial, MySQL SPATIAL, SQLite RTREE, and SpatiaLite.

The **R-tree** is the production-grade spatial index of the database world. Every major spatial database in production today ships an R-tree or an R-tree variant: **PostGIS** (via GiST with R-tree-style split), **Oracle Spatial** (since 8i, 1999), **MySQL/MariaDB SPATIAL indexes**, **SQLite RTREE virtual table** (used by Mapbox iOS Tiles, Wikipedia point-of-interest queries, OpenStreetMap utilities), **SpatiaLite**, and even early **MongoDB** 2d indexes. Antonin Guttman published the original R-tree paper at SIGMOD in 1984 while a PhD student at UC Berkeley; forty years later, his idea remains the default answer to "how do I index polygons, lines, and rectangles for fast spatial queries?"

Conceptually the R-tree generalises a B-tree from 1-D keys to **k-dimensional bounding rectangles**. Internal nodes store **Minimum Bounding Rectangles (MBRs)** of their children, and queries prune subtrees whose MBR does not intersect the query rectangle. Unlike a B-tree, however, a single query may have to descend **multiple children** at a node because MBRs are allowed to overlap. This *multi-path descent* is the source of every interesting R-tree problem — split heuristics, packing strategies, and variants like R\*-tree all exist to reduce overlap and keep queries fast.

This document teaches you the R-tree from scratch: how the data structure is laid out, how insert / search / delete work, the original Guttman quadratic split, when to choose R-tree over quadtree or kd-tree, and the code in Go, Java, and Python.

---

## Table of Contents

1. [Introduction — Why R-Trees Exist](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — MBRs, Fanout, Multi-Path Descent](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs Quadtree, kd-tree](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — Recursive MBR Enlargement](#patterns)
11. [Error Handling](#errors)
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
## 1. Introduction — Why R-Trees Exist

Imagine you store **10 million polygons** representing city blocks, building footprints, lake outlines, and road segments for a mapping application. A user pans the map and asks: *"Give me every feature visible in this viewport."* The viewport is a small rectangle covering perhaps 0.001% of the world. You must answer in **under 50 ms** or the map feels laggy.

A naive linear scan tests every polygon's bounding box against the viewport — 10 million intersection tests per pan, which on a modern CPU takes hundreds of milliseconds even with SIMD. Way too slow.

A 1-D B-tree on `min_x` will not help: a polygon with small `min_x` can still be on the other side of the planet (its `max_x` can extend arbitrarily). You need an index that prunes in **all spatial dimensions at once**.

The R-tree solves this. It groups nearby objects together, computes a Minimum Bounding Rectangle (MBR) for each group, then groups *those* groups recursively. The result is a balanced tree where:

- **Leaves** hold the object MBRs plus a payload pointer (object ID, polygon geometry, row pointer, file offset).
- **Internal nodes** hold MBRs of their children.
- **A range query** descends the tree from the root, visiting only those children whose MBR intersects the query rectangle.

If your viewport touches only a tiny corner of the world, the query prunes 99.99% of the tree at the root level. The 10-million-polygon scan becomes a logarithmic-depth tree walk that visits a few hundred nodes. Query latency drops from hundreds of ms to single-digit ms.

Antonin Guttman's 1984 SIGMOD paper, *"R-Trees: A Dynamic Index Structure for Spatial Searching"*, was the first paper to make this construction practical. He showed how to insert, delete, and split nodes while keeping the tree balanced like a B-tree. Subsequent work — R\*-tree (Beckmann et al. 1990), R+ tree (Sellis et al. 1987), Hilbert R-tree (Kamel & Faloutsos 1994), and STR-packed R-tree (Leutenegger et al. 1997) — all build on Guttman's structure.

If you only remember one fact: **the R-tree is the B-tree of spatial data**. Same balance, same logarithmic depth, same on-disk efficiency — extended to k dimensions, with MBRs replacing scalar keys.

---

<a name="prerequisites"></a>
## 2. Prerequisites

Before reading further you should be comfortable with:

1. **B-trees** — covered in `09-trees/04-b-tree`. The R-tree borrows B-tree's balancing strategy (every leaf at the same depth) and node-split-on-overflow approach. If "minimum fill", "fanout", and "split-and-bubble-up" are unfamiliar, read the B-tree topic first.
2. **Bounding box geometry** — see `09-trees/13-quadtree`. You should know how to compute an axis-aligned bounding box (AABB), test two AABBs for intersection, and compute the union of two AABBs. The R-tree manipulates AABBs constantly.
3. **Recursion** — insert, search, and delete are naturally recursive.
4. **Basic geometry intuition** — area, overlap, "enlargement" (how much one rectangle grows to contain another).

A working knowledge of computational geometry helps but is not required. Everything in this document is axis-aligned rectangles only.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **MBR (Minimum Bounding Rectangle)** | The smallest axis-aligned rectangle that contains a set of points or other rectangles. Stored as `(min_x, min_y, max_x, max_y)`. |
| **AABB** | Axis-Aligned Bounding Box — synonymous with 2-D MBR. The term "AABB" is more common in graphics; "MBR" in databases. |
| **Fanout (M)** | Maximum number of entries per node. Chosen so a node fills exactly one disk page (typical M ≈ 50–200 for 4 KB pages). |
| **Minimum fill (m)** | Minimum entries per node, usually `m = ⌊0.4 × M⌋`. Like the B-tree, this guarantees logarithmic depth. |
| **Entry** | One slot in a node. A leaf entry is `(object_MBR, payload)`. An internal entry is `(child_MBR, child_pointer)`. |
| **Choose-subtree heuristic** | The rule for picking which child to descend on insert. Guttman: pick the child whose MBR needs the least *enlargement* to contain the new rectangle. |
| **Split heuristic** | The rule for partitioning M+1 entries into two new nodes when overflow happens. Original Guttman: linear or quadratic. R\*-tree: a sophisticated overlap-minimising split. |
| **Dead space** | Area inside an MBR but not inside any of its child MBRs. Wasted space; queries that touch dead space have to descend in vain. |
| **Overlap** | Area shared by two sibling MBRs. Overlap is the primary cause of multi-path descent and the main metric R\*-tree minimises. |
| **Forced reinsertion** | R\*-tree trick: on overflow, instead of splitting immediately, remove ~30% of the farthest entries and reinsert them. Globally reduces overlap. |
| **Condense tree** | Delete-time operation: after removing an entry, walk up shrinking MBRs and merge underflowing nodes. |
| **Bulk load** | Build the tree from scratch given all objects up front. STR (Sort-Tile-Recursive) is the standard algorithm. |
| **GiST** | Generalised Search Tree — PostgreSQL's framework that lets users plug in R-tree-style split logic for any type. PostGIS uses GiST. |
| **BKD-tree** | Block kd-tree, Lucene/Elasticsearch's modern alternative for geo / numeric indexing. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — MBRs, Fanout, Multi-Path Descent

### 4.1 Node layout

Every R-tree node is a list of up to `M` entries, all at the same level. There are two node kinds:

- **Leaf node**: each entry is `(object_MBR, payload)`. The `payload` is whatever you need to recover the object: a row pointer, an object ID, a file offset, an inline polygon, etc.
- **Internal node**: each entry is `(child_MBR, child_pointer)`. `child_MBR` is the bounding rectangle of every entry in the child node.

Like a B-tree, all leaves are at the **same depth**. The root is the only node allowed to have fewer than `m` entries (so that an empty tree can have a one-entry root).

### 4.2 The "minimum bounding rectangle" invariant

For every internal entry `(child_MBR, child_pointer)`:

> `child_MBR` is the smallest axis-aligned rectangle that contains every entry in the child's MBR list.

When you insert an object and the tree grows, you must walk back up the insert path and **enlarge each MBR** along the way so that the invariant is preserved. When you delete and the tree shrinks, you walk up and **tighten** MBRs.

### 4.3 The search algorithm

```
search(node, query_rect):
    results = []
    for entry in node.entries:
        if entry.mbr intersects query_rect:
            if node is leaf:
                results.append(entry.payload)
            else:
                results.extend(search(entry.child, query_rect))
    return results
```

The critical line is `for entry in node.entries`. In a B-tree, a search descends at most **one** child per level. In an R-tree, it can descend **many** because sibling MBRs can overlap. This is the source of the worst-case `O(n)` complexity: if every MBR at every level contains the query rect, the search visits the whole tree.

### 4.4 Fanout and minimum fill

The two parameters that define the tree's shape:

- **M** (max entries per node) — chosen so a node fits in one disk page. For a 4 KB page and 32-byte entries: `M = 4096 / 32 ≈ 128`.
- **m** (min entries per node) — usually `m = ⌊0.4 × M⌋`. With `M = 128`, `m = 51`. The minimum-fill rule keeps the tree balanced: a node is allowed to be no less than 40% full.

A tree with `n` objects has height `O(log_M n)`. For `M = 128` and `n = 10⁹`: height ≈ 4 levels. That is one of the R-tree's killer features — even billion-object indices fit in 4–5 disk pages from root to leaf.

### 4.5 Insertion

```
insert(root, rect, data):
    leaf = chooseLeaf(root, rect)        # descend by choose-subtree heuristic
    leaf.append((rect, data))
    if leaf overflows (more than M entries):
        new1, new2 = splitNode(leaf)
        replace leaf in parent with new1; add new2 as sibling entry
        propagate split up if the parent now overflows
    walk up from leaf, enlarging MBRs to cover the new rect
```

`chooseSubtree` (Guttman): pick the child whose MBR needs the **least enlargement** to contain the new rectangle. Ties broken by smallest child MBR area.

`splitNode` (Guttman quadratic): pick the **two seed entries** that would waste the most space if grouped together, then assign every remaining entry to whichever group needs less enlargement. We cover the algorithm step by step in section 9.

### 4.6 Deletion

```
delete(root, rect):
    leaf = findLeaf(root, rect)          # descend visiting all intersecting children
    remove the entry from leaf
    condenseTree(leaf)                   # walk up: if a node underflows, remove it
                                         # and reinsert its orphaned entries from the top
```

`condenseTree` is the asymmetric mirror of `splitNode`. Rather than rebalancing a node by merging with a sibling (as B-trees do), the R-tree typically **removes the underflowing node** and **reinserts** its surviving entries from the root. This restores the minimum-fill invariant without disturbing nearby nodes' MBRs.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Average | Worst |
|---|---|---|
| Insert | O(log_M n) | O(log_M n) |
| Delete | O(log_M n) amortised | O(n) (rare, requires re-inserting many orphans) |
| Range query (output size `k`) | O(log_M n + k) | **O(n)** if MBRs overlap heavily |
| k-NN query | O(log_M n + k) average | O(n) worst |
| Bulk load (STR) | O(n log n) | O(n log n) |
| Space | O(n) | O(n) |

**Important caveat:** the average-case `O(log_M n + k)` assumes well-distributed data with little MBR overlap. R\*-tree (`middle.md`) reduces overlap by 30–40% over plain Guttman R-tree and gives much better empirical performance. For uniformly distributed data on random rectangles, even plain Guttman gives near-logarithmic queries; for highly clustered or skewed data (e.g., a billion road segments concentrated in a few cities), overlap can degrade performance significantly.

Compare with quadtree (covered in topic 13): R-tree is **balanced** like a B-tree, whereas a point quadtree can be highly unbalanced if the input is skewed. R-tree handles **rectangles**; classic point quadtrees handle **points**. For polygons or extents, R-tree wins.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Nested administrative boundaries

Country → state → county → city → block. A query "is point (lat, lng) inside any park?" prunes by country first (skip every state outside the matching country), then state, then county, etc. Each level of the R-tree is one level of this hierarchy.

### 6.2 Geographic folders on a map server

Tile servers split the world into a quad-tree of map tiles (Mercator zoom levels 0–22). The R-tree generalises this by allowing tiles to overlap and bucket multiple objects of variable size into one tile.

### 6.3 Shipping container packing

Loading a freight ship: pack small boxes into medium boxes into containers into cargo holds. Each level has its bounding volume; querying "where is this small box?" descends from ship down to box. Same idea, three or four levels of MBRs.

### 6.4 Game collision broadphase

A 3D game engine uses an R-tree (or BVH — bounding volume hierarchy, basically a 3-D R-tree) to find which objects could collide with the player without testing every object in the world. This is the cornerstone of real-time physics.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs Quadtree, kd-tree

### Pros

- **Handles extents, not just points.** Polygons, lines, and rectangles index naturally. Quadtrees and kd-trees were designed for points; rectangles require workarounds (e.g., inserting both endpoints).
- **Balanced like a B-tree.** Logarithmic depth even on skewed data. Point quadtrees can degenerate to linear depth.
- **Disk-friendly.** Nodes sized to page boundaries, like B-tree. Each tree-walk traverses a handful of pages.
- **Industry standard.** PostGIS, Oracle Spatial, MySQL, SQLite, SpatiaLite — every major spatial DB ships an R-tree.
- **Updates are cheap.** Insert and delete are O(log n). Quadtrees often need rebuild on dense inserts.
- **k-NN supported.** Incremental k-NN with a priority queue (Roussopoulos, Kelley, Vincent 1995) is elegant on an R-tree.

### Cons

- **Overlap degrades queries.** Plain Guttman R-tree can develop heavily-overlapping MBRs, leading to multi-path descents and worst-case O(n). R\*-tree mitigates but does not eliminate.
- **Higher complexity than quadtree.** Split heuristics, choose-subtree heuristics, and minimum-fill bookkeeping take ~300 lines vs 80 for a basic quadtree.
- **For pure point data, quadtree or kd-tree are simpler.** R-tree pays a small constant overhead for handling rectangles you do not have.
- **High-dimensional curse.** Above ~10 dimensions, every node's MBR covers nearly the whole space, and R-tree degenerates. Use VAMSplit R-tree, LSH, or HNSW instead.

### Rule of thumb

- **Points only, mostly read, low dimensions (≤3):** quadtree (simpler) or R-tree (more general).
- **Rectangles / polygons, mixed read+write:** R-tree.
- **Production database with arbitrary geometry:** R-tree (PostGIS uses GiST + R-tree split).
- **High dimensions (≥10):** specialised structures — VAMSplit R-tree, LSH, HNSW.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Build a tree with M = 4, m = 2 (toy parameters). Insert these six rectangles in order:

```
A = (0,0,2,2)    B = (1,1,3,3)    C = (4,4,5,5)
D = (5,1,7,3)    E = (2,5,4,7)    F = (6,5,8,7)
```

**Step 1 — insert A.** Tree is empty; create a root leaf with one entry: `[A]`. Root MBR is the MBR of `A` itself: `(0,0,2,2)`.

**Step 2 — insert B.** Root leaf still under capacity. Append: `[A, B]`. Root MBR enlarges to `(0,0,3,3)`.

**Step 3 — insert C.** Append: `[A, B, C]`. Root MBR enlarges to `(0,0,5,5)`. Notice we now have dead space: the region around (3,0)–(4,3) is inside the root MBR but inside no leaf entry's MBR.

**Step 4 — insert D.** Append: `[A, B, C, D]`. Root MBR enlarges to `(0,0,7,5)`. Now we have exactly `M = 4` entries; still fine.

**Step 5 — insert E.** Capacity exceeded after append (would be 5). We must **split** the root leaf.

Guttman's quadratic split:

1. **PickSeeds**: try every pair, pick the pair that wastes the most space if grouped together. Compute, for each pair `(i, j)`: `d = area(union(i, j)) − area(i) − area(j)`. The pair with the **largest** `d` becomes the seeds.
   - Try (A, C): union (0,0,5,5) area 25; area(A)=4, area(C)=1; d = 25-4-1 = 20.
   - Try (A, D): union (0,0,7,3) area 21; area(A)=4, area(D)=4; d = 21-4-4 = 13.
   - Try (B, D): union (1,1,7,3) area 12; area(B)=4, area(D)=4; d = 12-4-4 = 4.
   - … the winning pair is **(A, C) with d = 20** (or possibly (C, E) when E is included).

   Assuming seeds = A and C: group1 = `[A]`, group2 = `[C]`.

2. **PickNext**: for each remaining entry, compute the cost of putting it in group1 vs group2 (enlargement of each group's MBR). Assign to whichever needs less enlargement; in ties, smaller area.
   - B (1,1,3,3): group1 union (0,0,3,3) enlargement 5; group2 union (1,1,5,5) enlargement 15. → group1.
   - D (5,1,7,3): group1 union (0,0,7,3) enlargement 17; group2 union (4,1,7,5) enlargement 11. → group2.
   - E (2,5,4,7): group1 (which now contains A, B with MBR (0,0,3,3)) → union (0,0,4,7) enlargement 19; group2 (contains C, D with MBR (4,1,7,5)) → union (2,1,7,7) enlargement 18. → group2.

3. Result: leaf1 = `[A, B]` MBR (0,0,3,3); leaf2 = `[C, D, E]` MBR (2,1,7,7). New root is an internal node with two entries pointing to these two leaves.

**Step 6 — insert F (6,5,8,7).**

ChooseSubtree from the root:
- Group1 MBR (0,0,3,3): enlargement to contain F = area((0,0,8,7)) − area((0,0,3,3)) = 56 − 9 = 47.
- Group2 MBR (2,1,7,7): enlargement = area((2,1,8,7)) − area((2,1,7,7)) = 36 − 30 = 6.

→ descend into group2. Add F: leaf2 = `[C, D, E, F]`, MBR (2,1,8,7). At capacity. Done.

Final tree (3 nodes total):

```
Root (internal)
├── Entry MBR (0,0,3,3) → leaf1 [A, B]
└── Entry MBR (2,1,8,7) → leaf2 [C, D, E, F]
```

A range query for `(0,0,1,1)` intersects only the first root entry → descends only into leaf1 → returns A. **One leaf visited out of two.** Good pruning.

A range query for `(3,4,5,6)` intersects the second root entry only (does not touch the first MBR which has `max_x=3`) → descends into leaf2 → visits C and E. The other leaf is pruned without even examining its contents.

Now imagine 10 million rectangles, height 4 instead of 2, fanout 128 instead of 4. The same pattern applies — each level prunes 99% of subtrees on a small viewport query.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

We implement a 2-D R-tree with Guttman's quadratic split: `Rect`, `Node`, `insert`, `chooseSubtree`, `splitNode`, `search`, `delete`. Production code uses R\*-tree (`middle.md`) but Guttman's version is the cleanest place to start.

### 9.1 Go

```go
package rtree

import "math"

const (
    MaxEntries = 4 // small for teaching; production: 32-128
    MinEntries = 2
)

type Rect struct{ MinX, MinY, MaxX, MaxY float64 }

func (r Rect) Area() float64 { return (r.MaxX - r.MinX) * (r.MaxY - r.MinY) }

func (r Rect) Intersects(o Rect) bool {
    return !(o.MinX > r.MaxX || o.MaxX < r.MinX ||
        o.MinY > r.MaxY || o.MaxY < r.MinY)
}

func (r Rect) Union(o Rect) Rect {
    return Rect{
        math.Min(r.MinX, o.MinX), math.Min(r.MinY, o.MinY),
        math.Max(r.MaxX, o.MaxX), math.Max(r.MaxY, o.MaxY),
    }
}

func (r Rect) Enlargement(o Rect) float64 {
    return r.Union(o).Area() - r.Area()
}

// An Entry is either a child pointer (internal) or a payload (leaf).
type Entry struct {
    MBR     Rect
    Child   *Node // nil iff leaf entry
    Payload any   // valid iff leaf entry
}

type Node struct {
    Leaf    bool
    Entries []Entry
    Parent  *Node
}

type RTree struct{ Root *Node }

func New() *RTree { return &RTree{Root: &Node{Leaf: true}} }

// ---------- Search ----------
func (t *RTree) Search(q Rect) []any {
    var out []any
    search(t.Root, q, &out)
    return out
}

func search(n *Node, q Rect, out *[]any) {
    for _, e := range n.Entries {
        if !e.MBR.Intersects(q) {
            continue
        }
        if n.Leaf {
            *out = append(*out, e.Payload)
        } else {
            search(e.Child, q, out)
        }
    }
}

// ---------- Insert ----------
func (t *RTree) Insert(r Rect, payload any) {
    leaf := chooseLeaf(t.Root, r)
    leaf.Entries = append(leaf.Entries, Entry{MBR: r, Payload: payload})
    var split *Node
    if len(leaf.Entries) > MaxEntries {
        split = splitNode(leaf)
    }
    t.adjustTree(leaf, split)
}

func chooseLeaf(n *Node, r Rect) *Node {
    if n.Leaf {
        return n
    }
    best := 0
    bestEnlarge := math.Inf(1)
    bestArea := math.Inf(1)
    for i, e := range n.Entries {
        en := e.MBR.Enlargement(r)
        ar := e.MBR.Area()
        if en < bestEnlarge || (en == bestEnlarge && ar < bestArea) {
            best, bestEnlarge, bestArea = i, en, ar
        }
    }
    return chooseLeaf(n.Entries[best].Child, r)
}

// Guttman quadratic split.
func splitNode(n *Node) *Node {
    entries := n.Entries
    i, j := pickSeeds(entries)
    g1 := []Entry{entries[i]}
    g2 := []Entry{entries[j]}
    mbr1, mbr2 := entries[i].MBR, entries[j].MBR
    remaining := make([]Entry, 0, len(entries)-2)
    for k, e := range entries {
        if k != i && k != j {
            remaining = append(remaining, e)
        }
    }
    for len(remaining) > 0 {
        // Force assignment if one group needs entries to reach MinEntries.
        if len(g1)+len(remaining) == MinEntries {
            g1 = append(g1, remaining...)
            for _, e := range remaining {
                mbr1 = mbr1.Union(e.MBR)
            }
            remaining = nil
            break
        }
        if len(g2)+len(remaining) == MinEntries {
            g2 = append(g2, remaining...)
            for _, e := range remaining {
                mbr2 = mbr2.Union(e.MBR)
            }
            remaining = nil
            break
        }
        idx, toG1 := pickNext(remaining, mbr1, mbr2)
        e := remaining[idx]
        remaining = append(remaining[:idx], remaining[idx+1:]...)
        if toG1 {
            g1 = append(g1, e); mbr1 = mbr1.Union(e.MBR)
        } else {
            g2 = append(g2, e); mbr2 = mbr2.Union(e.MBR)
        }
    }
    n.Entries = g1
    sibling := &Node{Leaf: n.Leaf, Entries: g2, Parent: n.Parent}
    if !n.Leaf {
        for _, e := range g2 {
            e.Child.Parent = sibling
        }
    }
    return sibling
}

func pickSeeds(es []Entry) (int, int) {
    bestI, bestJ := 0, 1
    bestD := math.Inf(-1)
    for i := 0; i < len(es); i++ {
        for j := i + 1; j < len(es); j++ {
            u := es[i].MBR.Union(es[j].MBR).Area()
            d := u - es[i].MBR.Area() - es[j].MBR.Area()
            if d > bestD {
                bestD, bestI, bestJ = d, i, j
            }
        }
    }
    return bestI, bestJ
}

func pickNext(rem []Entry, mbr1, mbr2 Rect) (int, bool) {
    bestIdx := 0
    bestDiff := -1.0
    bestToG1 := true
    for i, e := range rem {
        d1 := mbr1.Enlargement(e.MBR)
        d2 := mbr2.Enlargement(e.MBR)
        diff := math.Abs(d1 - d2)
        if diff > bestDiff {
            bestDiff = diff
            bestIdx = i
            bestToG1 = d1 < d2
        }
    }
    return bestIdx, bestToG1
}

func (t *RTree) adjustTree(n, sibling *Node) {
    for n != t.Root {
        parent := n.Parent
        // Update MBR of n's entry in parent.
        for i, e := range parent.Entries {
            if e.Child == n {
                parent.Entries[i].MBR = computeMBR(n.Entries)
                break
            }
        }
        if sibling != nil {
            parent.Entries = append(parent.Entries, Entry{
                MBR:   computeMBR(sibling.Entries),
                Child: sibling,
            })
            sibling.Parent = parent
            if len(parent.Entries) > MaxEntries {
                sibling = splitNode(parent)
            } else {
                sibling = nil
            }
        }
        n = parent
    }
    if sibling != nil {
        // Grow tree taller.
        newRoot := &Node{
            Leaf: false,
            Entries: []Entry{
                {MBR: computeMBR(n.Entries), Child: n},
                {MBR: computeMBR(sibling.Entries), Child: sibling},
            },
        }
        n.Parent = newRoot
        sibling.Parent = newRoot
        t.Root = newRoot
    }
}

func computeMBR(es []Entry) Rect {
    if len(es) == 0 {
        return Rect{}
    }
    m := es[0].MBR
    for _, e := range es[1:] {
        m = m.Union(e.MBR)
    }
    return m
}
```

### 9.2 Java

```java
public final class RTree {
    static final int MAX = 4, MIN = 2;

    public static final class Rect {
        final double minX, minY, maxX, maxY;
        public Rect(double a,double b,double c,double d){minX=a;minY=b;maxX=c;maxY=d;}
        double area(){ return (maxX-minX)*(maxY-minY); }
        boolean intersects(Rect o){
            return !(o.minX>maxX||o.maxX<minX||o.minY>maxY||o.maxY<minY);
        }
        Rect union(Rect o){
            return new Rect(Math.min(minX,o.minX),Math.min(minY,o.minY),
                            Math.max(maxX,o.maxX),Math.max(maxY,o.maxY));
        }
        double enlargement(Rect o){ return union(o).area() - area(); }
    }

    static final class Entry {
        Rect mbr; Node child; Object payload;
        Entry(Rect r, Node c, Object p){ mbr=r; child=c; payload=p; }
    }

    static final class Node {
        boolean leaf;
        java.util.List<Entry> entries = new java.util.ArrayList<>();
        Node parent;
        Node(boolean l){ leaf=l; }
    }

    private Node root = new Node(true);

    // ---- Search ----
    public java.util.List<Object> search(Rect q){
        java.util.List<Object> out = new java.util.ArrayList<>();
        search(root, q, out);
        return out;
    }
    private void search(Node n, Rect q, java.util.List<Object> out){
        for (Entry e : n.entries) {
            if (!e.mbr.intersects(q)) continue;
            if (n.leaf) out.add(e.payload);
            else        search(e.child, q, out);
        }
    }

    // ---- Insert ----
    public void insert(Rect r, Object payload){
        Node leaf = chooseLeaf(root, r);
        leaf.entries.add(new Entry(r, null, payload));
        Node sibling = leaf.entries.size() > MAX ? splitNode(leaf) : null;
        adjustTree(leaf, sibling);
    }
    private Node chooseLeaf(Node n, Rect r){
        if (n.leaf) return n;
        int best=0; double bestE=Double.POSITIVE_INFINITY, bestA=Double.POSITIVE_INFINITY;
        for (int i=0;i<n.entries.size();i++){
            Entry e = n.entries.get(i);
            double en = e.mbr.enlargement(r), ar = e.mbr.area();
            if (en < bestE || (en==bestE && ar < bestA)) {
                best=i; bestE=en; bestA=ar;
            }
        }
        return chooseLeaf(n.entries.get(best).child, r);
    }

    private Node splitNode(Node n){
        java.util.List<Entry> es = n.entries;
        int[] seeds = pickSeeds(es);
        int si = seeds[0], sj = seeds[1];
        java.util.List<Entry> g1 = new java.util.ArrayList<>(), g2 = new java.util.ArrayList<>();
        g1.add(es.get(si)); g2.add(es.get(sj));
        Rect m1 = es.get(si).mbr, m2 = es.get(sj).mbr;
        java.util.List<Entry> rem = new java.util.ArrayList<>();
        for (int k=0;k<es.size();k++) if (k!=si && k!=sj) rem.add(es.get(k));
        while (!rem.isEmpty()) {
            if (g1.size() + rem.size() == MIN){
                for (Entry e : rem){ g1.add(e); m1 = m1.union(e.mbr); }
                rem.clear(); break;
            }
            if (g2.size() + rem.size() == MIN){
                for (Entry e : rem){ g2.add(e); m2 = m2.union(e.mbr); }
                rem.clear(); break;
            }
            int pick=0; boolean toG1=true; double bestDiff=-1;
            for (int i=0;i<rem.size();i++){
                double d1=m1.enlargement(rem.get(i).mbr);
                double d2=m2.enlargement(rem.get(i).mbr);
                double diff=Math.abs(d1-d2);
                if (diff > bestDiff){ bestDiff=diff; pick=i; toG1=d1<d2; }
            }
            Entry chosen = rem.remove(pick);
            if (toG1){ g1.add(chosen); m1 = m1.union(chosen.mbr); }
            else     { g2.add(chosen); m2 = m2.union(chosen.mbr); }
        }
        n.entries = g1;
        Node sib = new Node(n.leaf);
        sib.entries = g2;
        sib.parent = n.parent;
        if (!n.leaf) for (Entry e : g2) e.child.parent = sib;
        return sib;
    }
    private int[] pickSeeds(java.util.List<Entry> es){
        int bi=0, bj=1; double bd=Double.NEGATIVE_INFINITY;
        for (int i=0;i<es.size();i++)
            for (int j=i+1;j<es.size();j++){
                double d = es.get(i).mbr.union(es.get(j).mbr).area()
                         - es.get(i).mbr.area() - es.get(j).mbr.area();
                if (d > bd){ bd=d; bi=i; bj=j; }
            }
        return new int[]{bi,bj};
    }

    private void adjustTree(Node n, Node sibling){
        while (n != root) {
            Node parent = n.parent;
            for (Entry e : parent.entries) if (e.child == n) { e.mbr = mbrOf(n.entries); break; }
            if (sibling != null) {
                parent.entries.add(new Entry(mbrOf(sibling.entries), sibling, null));
                sibling.parent = parent;
                sibling = parent.entries.size() > MAX ? splitNode(parent) : null;
            }
            n = parent;
        }
        if (sibling != null) {
            Node nr = new Node(false);
            nr.entries.add(new Entry(mbrOf(n.entries), n, null));
            nr.entries.add(new Entry(mbrOf(sibling.entries), sibling, null));
            n.parent = nr; sibling.parent = nr; root = nr;
        }
    }
    private Rect mbrOf(java.util.List<Entry> es){
        Rect m = es.get(0).mbr;
        for (int i=1;i<es.size();i++) m = m.union(es.get(i).mbr);
        return m;
    }
}
```

### 9.3 Python

```python
from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple
import math

MAX_ENTRIES = 4
MIN_ENTRIES = 2

@dataclass
class Rect:
    min_x: float; min_y: float; max_x: float; max_y: float
    def area(self) -> float: return (self.max_x - self.min_x) * (self.max_y - self.min_y)
    def intersects(self, o: "Rect") -> bool:
        return not (o.min_x > self.max_x or o.max_x < self.min_x or
                    o.min_y > self.max_y or o.max_y < self.min_y)
    def union(self, o: "Rect") -> "Rect":
        return Rect(min(self.min_x, o.min_x), min(self.min_y, o.min_y),
                    max(self.max_x, o.max_x), max(self.max_y, o.max_y))
    def enlargement(self, o: "Rect") -> float: return self.union(o).area() - self.area()

@dataclass
class Entry:
    mbr: Rect
    child: Optional["Node"] = None
    payload: Any = None

@dataclass
class Node:
    leaf: bool
    entries: List[Entry] = field(default_factory=list)
    parent: Optional["Node"] = None

class RTree:
    def __init__(self) -> None:
        self.root = Node(leaf=True)

    # ---- Search ----
    def search(self, q: Rect) -> List[Any]:
        out: List[Any] = []
        self._search(self.root, q, out)
        return out

    def _search(self, n: Node, q: Rect, out: List[Any]) -> None:
        for e in n.entries:
            if not e.mbr.intersects(q):
                continue
            if n.leaf:
                out.append(e.payload)
            else:
                self._search(e.child, q, out)

    # ---- Insert ----
    def insert(self, r: Rect, payload: Any) -> None:
        leaf = self._choose_leaf(self.root, r)
        leaf.entries.append(Entry(mbr=r, payload=payload))
        sibling = self._split_node(leaf) if len(leaf.entries) > MAX_ENTRIES else None
        self._adjust_tree(leaf, sibling)

    def _choose_leaf(self, n: Node, r: Rect) -> Node:
        if n.leaf:
            return n
        best = min(range(len(n.entries)),
                   key=lambda i: (n.entries[i].mbr.enlargement(r), n.entries[i].mbr.area()))
        return self._choose_leaf(n.entries[best].child, r)

    def _pick_seeds(self, es: List[Entry]) -> Tuple[int, int]:
        bi, bj, bd = 0, 1, -math.inf
        for i in range(len(es)):
            for j in range(i + 1, len(es)):
                d = es[i].mbr.union(es[j].mbr).area() - es[i].mbr.area() - es[j].mbr.area()
                if d > bd:
                    bd, bi, bj = d, i, j
        return bi, bj

    def _split_node(self, n: Node) -> Node:
        es = n.entries
        si, sj = self._pick_seeds(es)
        g1, g2 = [es[si]], [es[sj]]
        m1, m2 = es[si].mbr, es[sj].mbr
        rem = [es[k] for k in range(len(es)) if k != si and k != sj]
        while rem:
            if len(g1) + len(rem) == MIN_ENTRIES:
                for e in rem: g1.append(e); m1 = m1.union(e.mbr)
                rem = []; break
            if len(g2) + len(rem) == MIN_ENTRIES:
                for e in rem: g2.append(e); m2 = m2.union(e.mbr)
                rem = []; break
            best_i, to_g1, best_diff = 0, True, -1.0
            for i, e in enumerate(rem):
                d1 = m1.enlargement(e.mbr); d2 = m2.enlargement(e.mbr)
                diff = abs(d1 - d2)
                if diff > best_diff:
                    best_diff, best_i, to_g1 = diff, i, d1 < d2
            chosen = rem.pop(best_i)
            if to_g1: g1.append(chosen); m1 = m1.union(chosen.mbr)
            else:     g2.append(chosen); m2 = m2.union(chosen.mbr)
        n.entries = g1
        sib = Node(leaf=n.leaf, entries=g2, parent=n.parent)
        if not n.leaf:
            for e in g2: e.child.parent = sib
        return sib

    def _adjust_tree(self, n: Node, sibling: Optional[Node]) -> None:
        while n is not self.root:
            parent = n.parent
            for e in parent.entries:
                if e.child is n:
                    e.mbr = self._mbr(n.entries); break
            if sibling is not None:
                parent.entries.append(Entry(mbr=self._mbr(sibling.entries), child=sibling))
                sibling.parent = parent
                sibling = self._split_node(parent) if len(parent.entries) > MAX_ENTRIES else None
            n = parent
        if sibling is not None:
            new_root = Node(leaf=False, entries=[
                Entry(mbr=self._mbr(n.entries), child=n),
                Entry(mbr=self._mbr(sibling.entries), child=sibling),
            ])
            n.parent = new_root; sibling.parent = new_root
            self.root = new_root

    @staticmethod
    def _mbr(es: List[Entry]) -> Rect:
        m = es[0].mbr
        for e in es[1:]: m = m.union(e.mbr)
        return m
```

Delete with `condenseTree`, k-NN with a priority queue, and the R\*-tree reinsertion variant all live in `middle.md` and `tasks.md`.

---

<a name="patterns"></a>
## 10. Coding Patterns — Recursive MBR Enlargement

Every operation that grows or shrinks a node has to **walk back up the tree** and update parent MBRs. The pattern is:

```python
def adjust_path(node):
    while node is not root:
        parent = node.parent
        for e in parent.entries:
            if e.child is node:
                e.mbr = mbr_of(node.entries)
                break
        node = parent
```

This recurrence is the heartbeat of the R-tree. Every insert and delete invokes it. Forgetting to do this is the single most common R-tree bug (covered in section 15).

A complementary pattern: when you split a node, the *parent* needs to know about the new sibling. The split returns the sibling; the recursion passes it up; the parent either has room (`append` and stop propagating) or also overflows (split again). Eventually you may need to make a new root, growing the tree taller by one.

---

<a name="errors"></a>
## 11. Error Handling

| Situation | Symptom | Mitigation |
|---|---|---|
| Empty tree at query | Search returns empty list | Root is an empty leaf — natural. |
| Query rect outside universe | Empty result | Correct behaviour; do not crash. |
| Degenerate rect (`min == max`, zero area) | Enlargement may be 0 for many subtrees; ties resolved by area heuristic | Allow zero-area rects (points stored as `Rect(x,y,x,y)`); ties broken by child area, not enlargement. |
| Insert with `min > max` | Inverted rect | Validate at insert: assert `min_x <= max_x && min_y <= max_y`. |
| Root split | `adjustTree` returns a sibling at the root level | Create a new root with two children pointing to old root and sibling. Tree height grows by one. |
| Delete of missing key | `findLeaf` returns nothing | Return `false` to caller; do not corrupt the tree. |
| NaN coordinates | Comparisons silently fail | Validate inputs; reject NaN before insert. |
| Concurrent mutation | Race condition | Wrap with a `RWMutex` or per-page lock (see `professional.md`). |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Use R\*-tree (`middle.md`) in production.** 30–40% fewer node visits than plain Guttman, identical interface.
2. **Bulk load with STR when you have all data up front.** Quadratic insert is `O(n M log_M n)`; STR is `O(n log n)` and produces a much tighter tree with near-zero overlap.
3. **Tune M to your page size.** Disk-resident R-tree: `M ≈ page_size / entry_size`. For PostGIS on 8 KB pages: M ≈ 100–200. Memory-resident: smaller M (8–16) often wins via better cache behaviour.
4. **Hold MBRs inline.** Storing only an MBR pointer wastes a cache line per child. Inline MBRs into the parent entry.
5. **Skip subtrees aggressively.** `intersects` is dirt cheap; never delay it.
6. **Avoid storing tiny rectangles in a node-shared MBR.** Heavy overlap kills queries.
7. **Reinsertion on delete underflow** is wasteful for high write rates; consider lazy deletion plus periodic compaction.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Pick R-tree for extent data (polygons, lines, regions), not pure point sets.** For points, a quadtree or kd-tree is simpler and equally fast.
- **For PostgreSQL / PostGIS, just use `CREATE INDEX … USING GIST (geom)`.** The default `gist_geometry_ops_2d` operator class is an R-tree variant.
- **Document the operator your queries use.** PostGIS `&&` (bounding-box overlap) uses the R-tree; `ST_Intersects` falls back to exact geometry after the R-tree filter.
- **Benchmark with real distribution.** Synthetic uniform rectangles are an unrealistic best case. Real road segments cluster in cities, real building footprints cluster in downtown areas. R-tree quality depends entirely on the workload.
- **Rebuild periodically.** Heavy insert/delete workloads degrade the tree. Rebuild with STR-pack monthly if your DB does not auto-rebalance.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Expected behaviour |
|---|---|
| Empty tree | Root is empty leaf; search returns nothing; insert creates first entry. |
| Single object | Root has one entry; search returns that entry if intersected. |
| All objects identical | All MBRs equal; splits are arbitrary but legal; queries return all. |
| All objects in a horizontal line | Linear MBRs, splits by `min_x`; tree still balanced. |
| Mix of huge and tiny rectangles | Huge rects expand MBRs aggressively; consider separating huge "global" objects into a side index. |
| Insert at root that is also the only leaf | Root is the leaf; standard chooseLeaf returns root immediately. |
| Root-level split | Tree height grows by one; new root holds the two children. |
| Repeated identical inserts | Each gets its own entry; queries return all duplicates. |
| Delete the last entry | Tree becomes empty; root is reset to empty leaf. |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting to recompute MBRs after insert or delete.** Queries silently miss objects. Always walk up the tree and tighten.
2. **Choosing subtree by area instead of enlargement.** Wrong heuristic; the tree degenerates because everything piles into the smallest child.
3. **Not handling root split.** Tree never grows taller; eventually overflowing the root crashes. Make a new root with two children.
4. **Confusing `intersects` with `contains`.** R-tree queries use **intersect**: any overlap counts. Many bugs come from accidentally using `contains` and missing edge-overlapping objects.
5. **Letting `m` go to 1.** Setting `MIN_ENTRIES = 1` destroys the depth guarantee. Use `m = ⌊0.4 × M⌋`.
6. **Using inverted rectangles** (`min_x > max_x`). All MBR math breaks silently. Validate inputs.
7. **Reinventing rather than using PostGIS / SQLite RTREE.** Most "I need a custom R-tree" reasons are wrong; use the proven one.
8. **Inserting points without zero-area Rect wrapper.** Points are `Rect(x,y,x,y)`. Some implementations crash on zero-area rects; handle the zero case explicitly.
9. **Splitting greedily by linear order.** Linear split is faster but ~2× worse query quality; quadratic or R\*-tree split are the standard.
10. **Ignoring overlap monitoring.** A healthy R-tree has low overlap. If sibling MBRs overlap by more than ~20%, queries degrade fast — consider rebuild or switch to R\*-tree.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
NODE
    leaf?    yes → entries are (mbr, payload)
             no  → entries are (mbr, child_ptr)
    entries  list of length [m, M]; root may have [1, M]

INSERT
    leaf = chooseLeaf(root, rect)
    leaf.add(rect, data)
    if overflow: split via Guttman quadratic
    walk up: enlarge MBRs; propagate splits

SEARCH(query)
    for each entry in root:
        if entry.mbr intersects query:
            if leaf: emit entry.payload
            else:    recurse into entry.child

DELETE
    leaf = findLeaf(rect)        # may visit multiple paths
    remove entry; condenseTree:
        walk up; if any node underflows, remove and reinsert orphans

CHOOSE SUBTREE
    pick child minimising enlargement; tie-break smallest area

SPLIT (quadratic)
    pickSeeds: pair with max wasted area
    pickNext:  entry whose group-preference is most decisive
    forced-fill rule: never let a group drop below m

PARAMETERS
    M typically 50-200 for disk; 8-16 for memory
    m = floor(0.4 * M)

COMPLEXITY
    height          O(log_M n)
    insert/delete   O(log_M n)
    range query     O(log_M n + k) average, O(n) worst
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html`. You can click-and-drag rectangles onto a canvas; the R-tree builds itself, drawing MBRs as semi-transparent boxes colour-coded by depth. Drag a query rectangle to fire a range query: nodes visited glow yellow, returned objects glow green. The side panel shows live stats — object count, tree height, fanout, overlap area, last query latency, and MBRs visited.

Trying a few different distributions (uniform, clustered, linear) makes the overlap-vs-quality tradeoff visible in seconds.

---

<a name="summary"></a>
## 18. Summary

- The **R-tree** is the production-grade spatial index used by PostGIS, Oracle Spatial, MySQL/MariaDB SPATIAL, SQLite RTREE, and SpatiaLite.
- It is a B-tree generalised to **k-dimensional bounding rectangles**. Internal nodes store MBRs of their children; leaves store object MBRs plus payload.
- **Insert** uses *chooseSubtree* (minimum enlargement) and splits overflowing nodes with Guttman's quadratic split.
- **Search** descends every child whose MBR intersects the query rectangle — possibly more than one per level, which is why heavy overlap degrades performance.
- **Delete** uses *condenseTree* to walk up the tree, tighten MBRs, and reinsert orphans from underflowing nodes.
- Worst case is `O(n)` when MBRs overlap heavily; **R\*-tree** (`middle.md`) reduces this with forced reinsertion and a sophisticated split heuristic.
- For points only, prefer quadtree or kd-tree; for **rectangles and extents**, R-tree is the standard answer.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Guttman, A.** *"R-Trees: A Dynamic Index Structure for Spatial Searching"*, SIGMOD 1984. The original paper. Required reading for anyone who works on spatial DBs.
- **Beckmann, N., Kriegel, H.-P., Schneider, R., Seeger, B.** *"The R\*-tree: An Efficient and Robust Access Method for Points and Rectangles"*, SIGMOD 1990. The state-of-the-art variant; covered in `middle.md`.
- **Sellis, T., Roussopoulos, N., Faloutsos, C.** *"The R+ Tree: A Dynamic Index for Multi-dimensional Objects"*, VLDB 1987.
- **Kamel, I., Faloutsos, C.** *"Hilbert R-tree: An Improved R-tree using Fractals"*, VLDB 1994.
- **Samet, H.** *Foundations of Multidimensional and Metric Data Structures* (Morgan Kaufmann, 2006). The comprehensive textbook.
- **PostgreSQL documentation:** *"GiST Indexes"* — how PostGIS plugs R-tree-style splits into the generalised search tree framework.
- **SQLite documentation:** *"The SQLite R\*Tree Module"* — practical embedded R-tree.
- Continue with `middle.md` for R\*-tree, R+ tree, Hilbert R-tree, STR bulk load, and incremental k-NN.
