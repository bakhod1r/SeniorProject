# R-Tree — Hands-On Tasks

> **Audience:** Engineers who have read `junior.md` and `middle.md` and want concrete coding exercises with reference solutions.

The ten tasks below cover the entire spectrum: from primitive Rect arithmetic to a 3-D R-tree to a benchmark harness comparing R-tree against quadtree. Reference solutions are in Python for brevity; the Go and Java translations are mechanical given the code already in `junior.md`.

---

## Task 1 — Rect primitive with unit tests

**Task.** Implement a `Rect` struct with `area()`, `intersects(other)`, `union(other)`, and `enlargement(other)`. Write at least eight unit tests covering edge cases.

### Reference solution

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Rect:
    min_x: float; min_y: float; max_x: float; max_y: float

    def area(self) -> float:
        return max(0.0, self.max_x - self.min_x) * max(0.0, self.max_y - self.min_y)

    def intersects(self, o: "Rect") -> bool:
        return not (o.min_x > self.max_x or o.max_x < self.min_x or
                    o.min_y > self.max_y or o.max_y < self.min_y)

    def union(self, o: "Rect") -> "Rect":
        return Rect(min(self.min_x, o.min_x), min(self.min_y, o.min_y),
                    max(self.max_x, o.max_x), max(self.max_y, o.max_y))

    def enlargement(self, o: "Rect") -> float:
        return self.union(o).area() - self.area()

    def contains(self, o: "Rect") -> bool:
        return (self.min_x <= o.min_x and o.max_x <= self.max_x and
                self.min_y <= o.min_y and o.max_y <= self.max_y)
```

### Unit tests

```python
import pytest

def test_area_positive():        assert Rect(0,0,3,4).area() == 12.0
def test_area_zero_width():      assert Rect(2,0,2,5).area() == 0.0
def test_intersect_overlap():    assert Rect(0,0,5,5).intersects(Rect(3,3,7,7))
def test_intersect_touching():   assert Rect(0,0,5,5).intersects(Rect(5,5,7,7))  # edge touch
def test_intersect_disjoint():   assert not Rect(0,0,1,1).intersects(Rect(2,2,3,3))
def test_union_disjoint():       assert Rect(0,0,1,1).union(Rect(3,3,4,4)) == Rect(0,0,4,4)
def test_union_nested():         assert Rect(0,0,5,5).union(Rect(1,1,2,2)) == Rect(0,0,5,5)
def test_enlargement_zero():     assert Rect(0,0,5,5).enlargement(Rect(1,1,2,2)) == 0.0
def test_enlargement_positive(): assert Rect(0,0,2,2).enlargement(Rect(3,3,5,5)) == 21.0
def test_contains():             assert Rect(0,0,10,10).contains(Rect(2,2,5,5))
```

---

## Task 2 — R-tree insert with quadratic split

**Task.** Implement insert with Guttman's quadratic split (`pickSeeds`, `pickNext`, forced-fill rule). Verify with a synthetic 1000-rectangle workload.

### Reference

See `junior.md` §9 for the full implementation. Validate by asserting:

- Every leaf has between `m` and `M` entries (except possibly the root).
- Every internal node's MBR equals the union of its children's MBRs.
- The tree's depth is `O(log_M n)`: for 1000 entries with M = 4, depth ≤ 5.

```python
def validate(node: Node) -> None:
    if node is not root:
        assert MIN_ENTRIES <= len(node.entries) <= MAX_ENTRIES
    if not node.leaf:
        for e in node.entries:
            assert e.mbr == mbr_of(e.child.entries)
            validate(e.child)
```

---

## Task 3 — R-tree range query

**Task.** Implement `query(window)` that returns every payload whose MBR intersects `window`. Validate against a brute-force linear scan.

### Reference

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

### Validation

```python
def test_query_against_brute_force(tree, all_rects, window):
    expected = {r.payload for r in all_rects if r.mbr.intersects(window)}
    actual = set(tree.query(window))
    assert expected == actual
```

Run with 100 random windows over a 10 000-rect tree; assert no diffs.

---

## Task 4 — R-tree delete with condenseTree

**Task.** Implement `delete(rect, payload)`. On underflow, remove the underflowing node and reinsert its surviving entries from the root.

### Reference

```python
def delete(self, r: Rect, payload) -> bool:
    leaf = self._find_leaf(self.root, r, payload)
    if leaf is None:
        return False
    leaf.entries = [e for e in leaf.entries if not (e.mbr == r and e.payload == payload)]
    self._condense_tree(leaf)
    if not self.root.leaf and len(self.root.entries) == 1:
        # Tree shrinks: promote the only child.
        self.root = self.root.entries[0].child
        self.root.parent = None
    return True

def _find_leaf(self, n: Node, r: Rect, payload):
    if n.leaf:
        for e in n.entries:
            if e.mbr == r and e.payload == payload:
                return n
        return None
    for e in n.entries:
        if e.mbr.intersects(r):
            found = self._find_leaf(e.child, r, payload)
            if found is not None:
                return found
    return None

def _condense_tree(self, node: Node) -> None:
    orphans: list = []
    while node is not self.root:
        parent = node.parent
        if len(node.entries) < MIN_ENTRIES:
            # Remove this node from parent and gather orphans.
            parent.entries = [e for e in parent.entries if e.child is not node]
            orphans.extend(self._collect_entries(node))
        else:
            for e in parent.entries:
                if e.child is node:
                    e.mbr = mbr_of(node.entries)
                    break
        node = parent
    for e in orphans:
        self.insert(e.mbr, e.payload)

def _collect_entries(self, n: Node) -> list:
    if n.leaf:
        return list(n.entries)
    out = []
    for e in n.entries:
        out.extend(self._collect_entries(e.child))
    return out
```

### Tests

- Delete one entry from a 100-entry tree; verify all others still reachable.
- Delete entries until tree is empty; verify root resets to empty leaf.
- Delete entry that causes cascading underflow up the tree.

---

## Task 5 — STR-packed R-tree bulk load

**Task.** Implement Sort-Tile-Recursive bulk load. Compare query latency against incrementally-built tree.

### Reference

See `interview.md` problem 4 for full STR code.

### Benchmark

```python
import time, random
rects = [(Rect(*[random.random() * 100 for _ in range(2)] +
              [random.random() * 100 for _ in range(2)]), i) for i in range(100_000)]

t0 = time.perf_counter()
tree_incremental = RTree()
for r, p in rects:
    tree_incremental.insert(r, p)
print(f"incremental build: {time.perf_counter() - t0:.2f}s")

t0 = time.perf_counter()
tree_str = RTree(); tree_str.root = str_pack(
    [Entry(mbr=r, payload=p) for r, p in rects], MAX_ENTRIES)
print(f"STR build: {time.perf_counter() - t0:.2f}s")

queries = [random_window() for _ in range(1000)]
for tree, name in [(tree_incremental, "incremental"), (tree_str, "STR")]:
    t0 = time.perf_counter()
    for q in queries:
        tree.query(q)
    print(f"{name} query: {(time.perf_counter() - t0) * 1000:.1f} ms total")
```

Expected: STR build ~5-10× faster than incremental; STR queries ~20-30% faster.

---

## Task 6 — Incremental k-NN with priority queue

**Task.** Implement `knn(point, k)` using the Roussopoulos-Kelley-Vincent best-first algorithm.

### Reference

See `interview.md` problem 3.

### Validation

Against brute force:

```python
def brute_force_knn(rects, q, k):
    return sorted(rects, key=lambda r: mindist(q, r.mbr))[:k]
```

For 1000 random queries on a 10 000-rect tree, every R-tree k-NN answer must match the brute-force order.

---

## Task 7 — R\*-tree chooseSubtree + reinsertion

**Task.** Modify the insert pipeline to use:

1. R\*-tree chooseSubtree at the leaf-parent level (minimum overlap enlargement).
2. Forced reinsertion of the 30% farthest entries on first overflow per level.

### Reference

See `interview.md` problem 8. Compare query latency before / after on the same data; expect 25-40% fewer node visits.

### Tests

- Build with R-tree; build with R\*-tree on identical inputs. Compare sibling overlap as a metric: R\*-tree's total overlap should be ~half that of plain Guttman.

---

## Task 8 — Spatial join with synchronised tree traversal

**Task.** Given two R-trees `R` and `S`, return every overlapping pair. Compare against indexed-nested-loop (query the smaller tree's entries against the larger).

### Reference

See `interview.md` problem 5.

### Benchmark

| Algorithm | 10 000 × 10 000 rects | 100 000 × 100 000 rects |
|---|---|---|
| Naive `O(nm)` | 1.0 s | 100 s |
| Indexed nested loop | 0.4 s | 6 s |
| Synchronised traversal | 0.1 s | 1.5 s |

(Numbers approximate; depend on hardware and overlap density.)

---

## Task 9 — 3-D R-tree for AABBs

**Task.** Implement a 3-D R-tree. Verify with a synthetic workload: 10 000 random 3-D AABBs, 1 000 random box queries, assert against brute-force scan.

### Reference

Reuse the `RTree` code with `Rect3D` (see `interview.md` problem 10). Generalise:

- `intersects`, `union`, `volume` over 3 dimensions.
- `pickSeeds` cost is `volume(union) - volume(a) - volume(b)`.

### Performance note

Higher dimensions reduce pruning effectiveness. For 3-D AABBs of physical objects (collision broadphase), R-tree still works well because objects do not span the universe. For 10+ D, the MBR overlap becomes severe; switch to HNSW or similar.

---

## Task 10 — Benchmark vs Quadtree

**Task.** Build identical 10⁵-rectangle workloads in an R-tree and a quadtree. Run 10⁴ window queries. Measure: (a) build time, (b) average query latency, (c) worst-case query latency, (d) memory.

### Setup

- Use the quadtree implementation from `09-trees/13-quadtree/junior.md` (or any standard implementation).
- Use the R-tree implementation from `09-trees/14-r-tree/junior.md`.
- Generate uniformly distributed rectangles in `[0, 100]²` with sizes uniformly in `[0.1, 5.0]`.

### Expected results

| Metric | R-tree (Guttman) | R\*-tree | Quadtree |
|---|---|---|---|
| Build time (incremental) | 1.5 s | 3.0 s | 0.8 s |
| STR build | 0.2 s | n/a | n/a |
| Avg query latency (us) | 50 | 30 | 80 |
| Worst-case query latency (us) | 800 | 200 | 4000 (clustered data) |
| Memory (MB) | 28 | 28 | 35 |

### Interpretation

- **R-tree handles rectangles natively**; quadtree needs to insert each rectangle at the level where it fits entirely, sometimes near the root, which inflates queries.
- **R\*-tree's higher build cost** pays off in lower worst-case query latency.
- **Quadtree degrades badly on clustered data** because its depth is data-dependent; R-tree stays balanced.

### Sample benchmark code

```python
def benchmark():
    import time
    n_rects, n_queries = 100_000, 10_000

    rects = generate_rects(n_rects)
    queries = generate_queries(n_queries)

    for name, tree_cls in [("R-tree", RTree), ("Quadtree", Quadtree)]:
        t0 = time.perf_counter()
        tree = tree_cls()
        for r in rects:
            tree.insert(r, r.id)
        build_time = time.perf_counter() - t0

        latencies = []
        for q in queries:
            t0 = time.perf_counter_ns()
            tree.query(q)
            latencies.append(time.perf_counter_ns() - t0)

        latencies.sort()
        print(f"{name}: build={build_time:.2f}s "
              f"avg_query={sum(latencies)/len(latencies)/1000:.1f}us "
              f"p99_query={latencies[int(0.99*len(latencies))]/1000:.1f}us")

if __name__ == "__main__":
    benchmark()
```

---

## Stretch task (optional) — Wrap PostGIS

For Python practitioners: wrap a PostGIS spatial index in a thin Python class and benchmark it against your in-memory R-tree. The PostGIS index will be faster on large datasets, slower for ≤ 10 000 rectangles (network and serialisation overhead). Understand the crossover point empirically — it is excellent interview material.

---

## Summary

Tasks 1–4 build the core data structure (`Rect`, insert, query, delete). Tasks 5–7 add the production-quality features (STR bulk load, k-NN, R\*-tree). Tasks 8–9 cover the two killer use cases (spatial join, 3-D AABBs). Task 10 puts it all in perspective by measuring against the alternative (quadtree).

After finishing the ten tasks you will be able to:

- Explain every R-tree variant from `middle.md` from first principles.
- Implement a working spatial index for any production language in a day.
- Debug PostGIS / SQLite RTREE / SpatiaLite query performance issues.
- Answer the interview questions in `interview.md` with confidence.

Continue with the stretch task and the `professional.md` reading list to go deeper.
