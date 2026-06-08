# k-d Tree — Interview Preparation

> **Audience:** Candidates preparing for spatial-data, graphics, ML-infra, and senior systems interviews. Tiered Q&A from definitions through formal analysis, plus a full coding challenge (build + nearest neighbor) in Go, Java, and Python.

These 46 questions span every level: junior (what/how), middle (why/when), senior (systems), and professional (proofs and bounds). After them comes a complete coding challenge you should be able to write from memory.

---

## Table of Contents

1. [Junior Questions (1–14)](#junior)
2. [Middle Questions (15–28)](#middle)
3. [Senior Questions (29–39)](#senior)
4. [Professional Questions (40–46)](#professional)
5. [Coding Challenge — Build + Nearest Neighbor](#challenge)
6. [Rapid-Fire Round](#rapidfire)

---

<a name="junior"></a>
## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a k-d tree? | A binary search tree for k-dimensional points where the comparison **axis rotates** with depth (`axis = depth mod k`). |
| 2 | What does the "k" mean? | The number of dimensions per point (2 for a map, 3 for a scene). Distinct from the "k" in k-NN. |
| 3 | How is a k-d tree different from a normal BST? | A BST compares on one fixed key; a k-d tree cycles the comparison coordinate at each level. |
| 4 | Which axis does a node split on? | `axis = depth mod k`. In 2D: even depths split on x, odd on y. |
| 5 | How do you decide left vs right for a point? | Compare the point's coordinate on the node's split axis: `< split` → left, `>= split` → right. |
| 6 | Why use the median to build? | The median splits points into equal halves, guaranteeing height O(log n) regardless of distribution. |
| 7 | What is the build complexity? | O(n log n) with quickselect median; O(n log² n) if you sort at every level. |
| 8 | How does nearest-neighbor search start? | Descend toward the query's leaf (same as inserting q) to get a first "best" guess. |
| 9 | What is the pruning step? | After unwinding, check the far subtree only if its split line could be closer than the best so far: `diff² < bestDist`. |
| 10 | Why compare squared distances? | To avoid expensive `sqrt`; squared distance preserves ordering. |
| 11 | What is each node's "region"? | The axis-aligned rectangle (box) of space the subtree is responsible for. |
| 12 | What's the average NN query time in 2D? | Expected O(log n). |
| 13 | What's the worst-case NN query time? | O(n) — unbalanced tree or high dimension. |
| 14 | Name one real use of k-d trees. | Map "nearest café," 3D point clouds, ray tracing, k-NN classifier on low-D features. |

**Detailed answers to selected junior questions:**

**Q1 — What is a k-d tree?**
A space-partitioning binary search tree for points in `k`-dimensional space. Each node stores one point and a split axis; the axis cycles with depth so that consecutive levels partition different coordinates. This turns a 1D ordering tree into a multidimensional spatial index supporting nearest-neighbor, k-NN, range, and radius queries.

**Q5 — Left vs right?**
At a node splitting on axis `a` with value `s = node.point[a]`, a point `p` goes left if `p[a] < s`, right if `p[a] >= s`. The chosen convention for equality (`>=` right) must be consistent so duplicates route deterministically.

**Q3 — k-d tree vs a normal BST.**
A BST keys every node on the same single value; comparisons always use that one key. A k-d tree keys the node at depth `d` on coordinate `d mod k`, so the comparison key **rotates** between dimensions level by level. Structurally they are the same binary tree; the difference is entirely in *which coordinate* the routing decision uses at each level — and that one change makes the tree a multidimensional spatial partition instead of a 1D ordering.

**Q6 — Why the median, in depth.**
The median on the split axis guarantees each child gets at most ⌊n/2⌋ points, so the height is ⌈log₂ n⌉ *regardless of point distribution* — because the median is defined by **rank**, not value. A value-based split (e.g. the cell's geometric midpoint) can put all points on one side for skewed data, producing a tall, slow tree. Median build is what makes the height bound distribution-independent.

**Q9 — The pruning step, in words.**
Standing at a node after exploring the near side, the far subtree lives across the splitting hyperplane. The closest any far point can be to the query is the perpendicular distance to that plane, `|q[axis] − split|`. If that already exceeds the best distance found, no far point can win — skip the whole subtree. Otherwise recurse.

---

<a name="middle"></a>
## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | How do you do k-NN instead of single NN? | Bounded max-heap of size k; prune using the k-th nearest distance once the heap is full. |
| 16 | Why is the pruning bound `+∞` until the heap fills? | Until you have k candidates, any subtree could contribute, so you cannot prune. |
| 17 | How does range (box) search prune? | Recurse into a child only if the query box overlaps that side of the split line. |
| 18 | How does radius search differ from NN? | Same descent but the bound is a **fixed** `r`, not a shrinking best. |
| 19 | Why explore the near side before the far side? | It tightens `bestDist` early, making far-side pruning succeed more often. |
| 20 | Are k-d trees self-balancing? | No. Inserts can unbalance; you rebuild or use scapegoat/Bentley–Saxe. |
| 21 | Why is deletion awkward? | The replacement must be the min on the split axis found in a subtree; most systems tombstone + rebuild. |
| 22 | k-d tree vs uniform grid? | Grid: O(1) buckets for uniform density; k-d tree adapts to clustering, wastes no empty cells. |
| 23 | k-d tree vs quadtree? | Quadtree splits *space* into 4 equal quadrants; k-d tree splits on a *point*, one axis at a time, more memory-efficient. |
| 24 | k-d tree vs range tree? | Range tree: O(log² n + m) range queries but O(n log n) memory; k-d tree: O(√n + m) range, O(n) memory, also does NN. |
| 25 | What is the 2D range-query bound? | O(√n + m) for reporting, O(√n) for counting. |
| 26 | When does NN degrade to O(n)? | High dimension (pruning fails) or an unbalanced/skewed tree. |
| 27 | Median split vs midpoint split? | Median = balanced tree; midpoint = squarer cells, can prune better for clustered data (SciPy `cKDTree`). |
| 28 | How do you bulk-load in O(n log n)? | Use quickselect (`nth_element`) for the median at each node instead of full sorting. |

**Detailed answers:**

**Q15 — k-NN with a heap.**
Maintain a max-heap of the k best `(distance, point)` pairs, top = worst. Visit nodes as in NN; insert each point if the heap isn't full or it beats the current worst. Prune the far side when `diff² >= heap.top.distance` and the heap is full. Result: expected O(k + log n).

**Q19 — Near-side-first, why it matters.**
Correctness never depends on order — both sides get tested when the bound demands it. But performance does: descending the *near* side first quickly finds a good candidate and shrinks `bestDist`. A smaller `bestDist` makes the far-side test `diff² < bestDist` fail more often, pruning more subtrees. Going far-first would explore both sides at most nodes, erasing the speedup. So order is a pure performance optimization layered on a correct-either-way algorithm.

**Q21 — Why deletion is awkward, concretely.**
In a BST the in-order successor that replaces a deleted node is the min of the right subtree, found by walking left. In a k-d tree the replacement must be the **min on the deleted node's split axis**, and that min can live in *either* child (the other subtree was partitioned on a different axis, so it can still contain a smaller value on this axis). Finding it requires a recursive "find-min-on-axis" that searches both children whenever the current node's axis differs — costing O(n^{1−1/k}), not O(log n). That asymmetry is why most systems tombstone and rebuild instead.

**Q27 — Median vs midpoint split.**
Median split chooses the point of median *rank* on the axis → exactly balanced, height log n, but cells can be long thin rectangles for skewed data. Midpoint (or sliding-midpoint) split cuts at the geometric middle of the cell → cells stay squarer (better pruning for clustered data) but the tree can be unbalanced. SciPy's `cKDTree` uses sliding-midpoint; scikit-learn uses a spread-based median variant. The trade is balance (median) vs cell roundness (midpoint).

**Q17 — Range search pruning, in depth.**
At a node splitting on axis `a` at value `s`, the left subtree holds only points with coordinate `< s` on axis `a` and the right only `>= s`. So we descend left only if the query box can reach left of the line — `lo[a] <= s` — and right only if `hi[a] >= s`. If the box lies entirely on one side (`hi[a] < s` or `lo[a] > s`), the opposite child is skipped wholesale. A sharper version carries each node's bounding region and short-circuits: region fully inside the box → emit the whole subtree without per-point tests; region disjoint → prune; partial → recurse. That gives the `O(√n + m)` 2D bound.

**Q22 — Grid vs k-d tree.**
A uniform grid buckets points into fixed cells, giving O(1) lookups when density is uniform and the query radius matches the cell size. But for clustered data, most grid cells are empty (wasted memory) or a few are overloaded (slow). A k-d tree adapts: dense regions get deeper subtrees, sparse regions shallow ones, with exactly one node per point. The grid wins on *uniform, fully-dynamic* data (O(1) updates, trivial code); the k-d tree wins on *clustered or static* data and on memory.

**Q26 — Degradation.**
Two causes: (1) **dimension** — past ~10–20 dims the pruning test almost always fails (curse of dimensionality), so NN visits ~all nodes; (2) **balance** — sequential inserts build a tall tree of height n. Median build fixes (2); only switching algorithms (ball tree, HNSW, LSH) fixes (1).

---

<a name="senior"></a>
## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 29 | What is the curse of dimensionality for k-d trees? | Distances concentrate; pruning bound becomes tiny vs bestDist; query → O(n) past ~20 dims. |
| 30 | What's the rule of thumb for when a k-d tree helps? | Useful ⇔ `n >> 2^d`. |
| 31 | What do you use instead in high dimensions? | Approximate NN: HNSW (default), IVF, LSH; or ball/VP tree for moderate dims. |
| 32 | k-d tree vs ball tree? | Ball tree splits by hypersphere, adapts to non-axis/non-Euclidean metrics, better for moderate dims. |
| 33 | What is LSH and when do you use it? | Hashing where near points collide; approximate NN in hundreds/thousands of dims. |
| 34 | What is HNSW? | Hierarchical navigable small-world graph; O(log n) approximate NN, SOTA for vector search. |
| 35 | How do you handle a changing point set? | Double-buffer rebuilds, tombstone deletes, periodic rebuild; treat tree as read-only between rebuilds. |
| 36 | How do you scale NN beyond one machine? | Spatial sharding (by geohash/grid) with an overlap halo for boundary queries; replicate read-only shards. |
| 37 | Why is Euclidean distance on lat/lon wrong? | Longitude degrees shrink toward poles; Earth is curved. Project to planar, convert to 3D Cartesian, or use Haversine + ball tree. |
| 38 | Which metric tells you pruning is failing? | `nodes_visited_per_query` rising toward n. |
| 39 | Ray tracing: k-d tree or BVH? | k-d tree (SAH) for static scenes; BVH for animated scenes and GPU hardware. |

**Detailed answers:**

**Q29 — Curse of dimensionality.**
As dimension grows, the variance of pairwise distances shrinks relative to their mean (distance concentration). The nearest and farthest points become nearly equidistant, so `bestDist` is barely smaller than any candidate, and the per-axis pruning bound `|q[a]−s|` is negligible against it. Pruning almost never fires; the search visits a constant fraction of nodes — effectively O(n). Crossover is around d = 10–20.

**Q30 — The n >> 2^d rule, where it comes from.**
The expected-O(log n) NN bound has a hidden constant `c_k ≈ 2^k` (the number of orthant-neighbor cells whose region can intersect the query ball). For the expected cost `c_k·log n` to beat brute-force `n`, you need `2^k·log n < n`, i.e. `n >> 2^k`. At d=2 that's `n>>4` (trivial); at d=20, `n>>10^6` (often false); at d=128, never. This single inequality is the practical test for "will a k-d tree help here?"

**Q34 — HNSW, one level deeper.**
HNSW builds a multi-layer proximity graph: upper layers are sparse (long-range "express" links), lower layers dense. A query enters at the top, greedily hops to the closest node, descends a layer, repeats — like a skip list generalized to a metric space. Expected query is O(log n) with high recall, and it tolerates hundreds to thousands of dimensions because it relies on *graph connectivity*, not axis-aligned pruning (which dies in high dim). It is the default engine in modern vector databases (Qdrant, Milvus, Weaviate, pgvector's hnsw index).

**Q31 — High-dimensional alternatives.**
First reduce dimension if possible (PCA/UMAP/autoencoder → tens of dims → k-d tree works again). If the embedding can't be reduced, use approximate NN: **HNSW** for best recall/latency, **IVF-PQ** for memory efficiency at scale (FAISS), **LSH** for streaming or extreme dimensions. These are the engines behind vector databases.

**Q35 — Dynamic data.**
The dominant pattern is **double-buffering**: serve queries from tree A while building tree B from fresh data in the background, then atomically swap the pointer. Deletes are tombstoned and physically removed at the next rebuild. For per-second churn at scale, shard spatially or switch to an R-tree.

**Q32 — Ball tree vs k-d tree, in depth.**
A k-d tree splits with **axis-aligned hyperplanes**; its pruning bound is the per-axis distance `|q[a]−s|`. A ball tree splits points into nested **hyperspheres** (each node = center + radius); its pruning bound is `dist(q, center) − radius`, the triangle-inequality lower bound to any point in the ball. The ball-tree bound adapts to the data's actual shape rather than the coordinate axes, so it prunes better when dimensions are **correlated** (the cloud is a tilted ellipsoid, not axis-aligned) and it works for **any metric** satisfying the triangle inequality (cosine, Manhattan, Haversine), not just axis-decomposable Euclidean. The cost: ball construction is a bit heavier and the bound computation involves a full distance, not a single subtraction. Rule of thumb (and scikit-learn's heuristic): k-d tree for low `d` and axis-aligned Euclidean; ball tree for moderate `d`, correlated dimensions, or non-Euclidean metrics.

**Q37 — Why lat/lon Euclidean is wrong, in depth.**
Treating `(lat, lon)` as a Euclidean plane assumes one degree of longitude equals one degree of latitude in distance — true only at the equator. At latitude φ, a degree of longitude spans `cos φ` times the distance of a degree of latitude, shrinking to zero at the poles. So Euclidean NN over-weights longitude near the poles and returns wrong neighbors. Three fixes: (1) **project** to a local planar CRS (UTM) — accurate for city scale; (2) convert to **3D Cartesian on the unit sphere** and use a 3D Euclidean k-d tree — chord distance is monotonic in great-circle distance, so ordering is exact; (3) use a **ball tree with the Haversine metric** — k-d trees can't natively use Haversine because it isn't axis-decomposable.

---

<a name="professional"></a>
## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 40 | Prove median build gives height O(log n). | Each child ≤ ⌊n/2⌋ points; `T(n) ≤ 1 + T(n/2)` ⇒ `T(n) ≤ ⌈log₂ n⌉`. |
| 41 | Prove build is O(n log n). | `B(n) = 2B(n/2) + O(n)` (quickselect median); Master Theorem case 2. |
| 42 | Prove pruning is correct. | Any far point crosses the split plane, so `dist ≥ |q[a]−s|`; if that ≥ bestDist, skip is safe. Induction on subtrees. |
| 43 | Derive the 2D range-query bound. | A vertical line: `Q(n) = 2Q(n/4) + O(1)` ⇒ O(√n); four edges ⇒ O(√n + m). |
| 44 | State the expected NN bound and its constant. | O(log n) for fixed dim (FBF 1977), constant `c_k = Θ(2^k)`. |
| 45 | Formalize the curse of dimensionality. | Distance concentration (Beyer et al. 1999): `Dmax/Dmin → 1`; per-axis bound / bestDist → 0; visits → Θ(n). |
| 46 | Why O(n) worst case despite O(log n) height? | Balance bounds height, not pruning success; adversarial geometry makes the search ball cross every cell. |

**Detailed answers:**

**Q40 — Height proof.**
The median removes one point and splits the remaining `n−1` so each side has at most `⌊n/2⌋`. With `T(n) ≤ 1 + T(⌊n/2⌋)`, `T(0)=T(1)=0`, the subtree size halves each level, reaching 1 after `⌈log₂ n⌉` levels. So height ≤ `⌈log₂ n⌉`, independent of the point distribution because the median is rank-defined.

**Q42 — Pruning correctness.**
Invariant: after returning from node `v`, `best` is a nearest point among `subtree(v)` plus everything seen before. Inductive step: we update with `point(v)`, search near (induction covers it), and search far only if `(q[a]−s)² < bestDist²`. If the test fails, every far point `u` has `dist(q,u) ≥ |q[a]−s| ≥ bestDist` (its path to `q` crosses the split plane), so skipping loses nothing. At the root, `subtree = P`, so `best` is the global NN.

**Q41 — Build is O(n log n).**
Median selection (quickselect / `nth_element`) finds the split point in `O(m)` for a subtree of `m` points, then recurses on two halves of size ≤ `m/2`. The recurrence `B(n) = 2B(n/2) + O(n)` is the merge-sort recurrence; by the Master Theorem (a=2, b=2, f(n)=Θ(n), log_b a = 1) it solves to `Θ(n log n)`. If you *sort* at every level instead, each level costs `O(n log n)` over `log n` levels → `O(n log² n)`. The selection step is the whole difference.

**Q46 — O(n) worst case despite O(log n) height, in depth.**
Height (a count property) is bounded by median build, but pruning success is a *geometric* property the build does not control. The 2D **circle adversary** — all `n` points equidistant from `q` on a circle — makes `bestDist` equal to that common radius; every split line falls inside the circle, so the pruning test `|q[a]−s| ≥ bestDist` fails almost everywhere and the search recurses into both children at nearly every node: Θ(n). The same near-equidistance arises generically in high dimensions (distance concentration), which is why the bound is stated as *expected* O(log n), *worst-case* Θ(n).

**Q43 — 2D range bound.**
Count cells crossed by one edge of the query box (a vertical line). The root splits on x — the line lies on one x-side, entering one child. That child splits on y — the line crosses both y-children. Two levels: `Q(n) = 2Q(n/4) + O(1)`, Master Theorem (`log_4 2 = 1/2`) gives `O(√n)`. Four edges → `O(√n)`; add `O(m)` to report contained points.

---

<a name="challenge"></a>
## Coding Challenge — Build + Nearest Neighbor

> **Problem.** Given `n` 2D points, build a balanced k-d tree (median split, alternating axes). Then answer nearest-neighbor queries: for a query point, return the stored point with the smallest Euclidean distance (break ties by the smaller index). Implement build + nearest with correct branch-and-bound pruning. Verify against a brute-force reference.

**Constraints:** `1 ≤ n ≤ 10^5`, coordinates in `[-10^9, 10^9]`. Use squared distance to avoid overflow-free float issues; cast to `float64`/`double`. Expected: `O(n log n)` build, `O(log n)` average per query.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Point struct{ X, Y float64 }

type Node struct {
	P           Point
	Left, Right *Node
	Axis        int
}

func build(pts []Point, depth int) *Node {
	if len(pts) == 0 {
		return nil
	}
	axis := depth % 2
	sort.Slice(pts, func(i, j int) bool {
		if axis == 0 {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	mid := len(pts) / 2
	return &Node{
		P:     pts[mid],
		Axis:  axis,
		Left:  build(append([]Point{}, pts[:mid]...), depth+1),
		Right: build(append([]Point{}, pts[mid+1:]...), depth+1),
	}
}

func sq(a, b Point) float64 {
	dx, dy := a.X-b.X, a.Y-b.Y
	return dx*dx + dy*dy
}

func nearest(root *Node, q Point) (Point, float64) {
	var best Point
	bestD := -1.0
	var rec func(n *Node)
	rec = func(n *Node) {
		if n == nil {
			return
		}
		d := sq(q, n.P)
		if bestD < 0 || d < bestD {
			bestD, best = d, n.P
		}
		var diff float64
		if n.Axis == 0 {
			diff = q.X - n.P.X
		} else {
			diff = q.Y - n.P.Y
		}
		near, far := n.Right, n.Left
		if diff < 0 {
			near, far = n.Left, n.Right
		}
		rec(near)
		if diff*diff < bestD {
			rec(far)
		}
	}
	rec(root)
	return best, bestD
}

func main() {
	pts := []Point{{7, 2}, {5, 4}, {9, 6}, {2, 3}, {4, 7}, {8, 1}, {9, 9}}
	tree := build(append([]Point{}, pts...), 0)
	p, d := nearest(tree, Point{6, 5})
	fmt.Printf("nearest=(%.0f,%.0f) sqDist=%.0f\n", p.X, p.Y, d) // (5,4) 2
}
```

### Java

```java
import java.util.*;

public class KDTreeNN {
    static final class Node {
        double x, y;
        Node left, right;
        int axis;
        Node(double x, double y, int axis) { this.x = x; this.y = y; this.axis = axis; }
    }

    static Node build(double[][] pts, int lo, int hi, int depth) {
        if (lo >= hi) return null;
        int axis = depth % 2;
        Arrays.sort(pts, lo, hi, Comparator.comparingDouble(p -> p[axis]));
        int mid = (lo + hi) / 2;
        Node n = new Node(pts[mid][0], pts[mid][1], axis);
        n.left  = build(pts, lo, mid, depth + 1);
        n.right = build(pts, mid + 1, hi, depth + 1);
        return n;
    }

    static double[] best;
    static double bestD;

    static double sq(double qx, double qy, Node n) {
        double dx = qx - n.x, dy = qy - n.y;
        return dx * dx + dy * dy;
    }

    static void nearest(Node n, double qx, double qy) {
        if (n == null) return;
        double d = sq(qx, qy, n);
        if (d < bestD) { bestD = d; best = new double[]{n.x, n.y}; }
        double diff = (n.axis == 0) ? qx - n.x : qy - n.y;
        Node near = diff < 0 ? n.left : n.right;
        Node far  = diff < 0 ? n.right : n.left;
        nearest(near, qx, qy);
        if (diff * diff < bestD) nearest(far, qx, qy);
    }

    public static void main(String[] args) {
        double[][] pts = {{7,2},{5,4},{9,6},{2,3},{4,7},{8,1},{9,9}};
        Node tree = build(pts, 0, pts.length, 0);
        best = null; bestD = Double.POSITIVE_INFINITY;
        nearest(tree, 6, 5);
        System.out.printf("nearest=(%.0f,%.0f) sqDist=%.0f%n", best[0], best[1], bestD); // (5,4) 2
    }
}
```

### Python

```python
import math


class Node:
    __slots__ = ("p", "left", "right", "axis")

    def __init__(self, p, axis):
        self.p, self.left, self.right, self.axis = p, None, None, axis


def build(pts, depth=0):
    if not pts:
        return None
    axis = depth % 2
    pts.sort(key=lambda p: p[axis])
    mid = len(pts) // 2
    node = Node(pts[mid], axis)
    node.left = build(pts[:mid], depth + 1)
    node.right = build(pts[mid + 1:], depth + 1)
    return node


def sq(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def nearest(root, q):
    best = [None, math.inf]

    def rec(n):
        if n is None:
            return
        d = sq(q, n.p)
        if d < best[1]:
            best[0], best[1] = n.p, d
        diff = q[n.axis] - n.p[n.axis]
        near, far = (n.left, n.right) if diff < 0 else (n.right, n.left)
        rec(near)
        if diff * diff < best[1]:
            rec(far)

    rec(root)
    return best[0], best[1]


def brute(pts, q):
    return min(pts, key=lambda p: sq(q, p))


if __name__ == "__main__":
    pts = [(7, 2), (5, 4), (9, 6), (2, 3), (4, 7), (8, 1), (9, 9)]
    tree = build(list(pts))
    p, d = nearest(tree, (6, 5))
    assert p == brute(pts, (6, 5))
    print(f"nearest={p} sqDist={d}")  # (5, 4) 2
```

**Follow-ups the interviewer may ask:**
1. Extend to k-NN (bounded max-heap; prune on the k-th nearest).
2. Add range/radius search (different pruning bound).
3. Analyze why this degrades in 128 dimensions and what you'd use instead (HNSW/LSH).
4. Make it dynamic (double-buffer rebuild; scapegoat balancing).
5. Prove the pruning never skips the true nearest neighbor.

---

<a name="rapidfire"></a>
## Rapid-Fire Round (Quick Definitions)

Interviewers often warm up with quick one-liners. Be able to answer each in a sentence.

| Prompt | One-line answer |
|---|---|
| Splitting hyperplane | `{x : x[axis] = node.point[axis]}` — divides space at a node. |
| Why "balanced" matters | Bounds tree height to O(log n); does **not** by itself guarantee fast queries. |
| Tie-break on equal coordinates | Pick a consistent rule (`>=` goes right); keeps duplicates deterministic. |
| Squared vs true distance | Compare squared to skip `sqrt`; ordering is identical. |
| Build recurrence | `B(n) = 2B(n/2) + O(n)` → O(n log n). |
| Height recurrence | `T(n) = 1 + T(n/2)` → ⌈log₂ n⌉. |
| Range query 2D bound | O(√n + m). |
| Range query kD bound | O(n^{1−1/k} + m). |
| NN expected (low dim) | O(log n), constant ≈ 2^k. |
| NN worst case | O(n). |
| Curse threshold | Useful only when n ≫ 2^k. |
| Leaf bucket purpose | Stop splitting at ~16 points; scan linearly for cache locality. |
| k-d vs R-tree | k-d for in-memory points; R-tree for disk-resident rectangles, dynamic. |
| k-d vs ball tree | Axis-aligned boxes vs hyperspheres; ball tree for non-axis metrics. |
| Dynamic strategy | Double-buffer rebuild; tombstone deletes. |
| Geo metric fix | Project to planar, or 3D Cartesian on the sphere, or Haversine + ball tree. |

---

## Whiteboard Reasoning Example

> **Interviewer:** "You have 2 million 3D LiDAR points per frame at 15 Hz. For each point you need its nearest neighbor in the previous frame for ICP registration. Design it and give me the numbers."

**Strong answer, out loud:**
"Dimension is 3, so a k-d tree is exact and fast — no need for approximate methods. Per frame I build a fresh tree from the previous frame's 2M points: build is O(n log n) ≈ 2M·21 ≈ 4·10⁷ ops, a few tens of milliseconds with a quickselect bulk-load and a flat-array layout. Then I run 2M nearest-neighbor queries, each visiting ~c·log₂(2M) ≈ 4·21 ≈ 84 nodes, so ~1.7·10⁸ node visits total — well under the 66 ms frame budget on a few cores. I'd use leaf buckets of ~16 points for cache locality and squared distances to avoid sqrt. I would **not** update incrementally — rebuilding per frame is cheaper than maintaining balance and keeps the tree optimal. If dimension were 64 (a feature descriptor) instead of 3, pruning would collapse and I'd switch to FLANN's randomized k-d forest or an approximate method."

This answer hits: dimension check, build/query complexity with real numbers, layout/optimization choices, the static-rebuild decision, and the dimension caveat — the full senior arc.

---

## Common Interview Pitfalls to Avoid

1. **Forgetting the far-side recursion** when whiteboarding NN — the most-spotted bug.
2. **Pruning with the full node distance** instead of the perpendicular axis distance.
3. **Claiming O(log n) unconditionally** — always qualify "expected, low dimension."
4. **Suggesting a k-d tree for 768-dim embeddings** — name HNSW/LSH instead.
5. **Using raw Euclidean on lat/lon** — mention the projection/Haversine fix.
6. **Saying k-d trees self-balance** — they don't; you rebuild.
7. **Confusing the two "k"s** — dimension vs the k in k-NN.

---

## System-Design Mini-Round

Senior loops often pose an open-ended design prompt. Three common ones, with strong answers.

### Design 1 — "Nearest charging station" for an EV app

**Prompt:** 200k charging stations (2D), 20k lookups/sec at peak, stations rarely change (a few per day).

**Answer.** Dimension 2 → exact k-d tree, pruning ideal. 200k points: NN visits ~`4·18 ≈ 72` nodes, ~1 µs/query; 20k QPS = 20 ms CPU/sec ≈ 2% of a core. Single machine, easily. Stations change daily → rebuild offline nightly (O(n log n) ≈ tens of ms) and swap atomically; no dynamic balancing needed. Store in a flat array with leaf buckets (B=16) for cache locality. Add radius search for "stations within 10 km" using the same tree. Replicate read-only copies behind a load balancer for HA. **No need for ANN or sharding at this scale** — knowing when *not* to over-engineer is the signal.

### Design 2 — "Find similar images" over 50M 512-dim embeddings

**Prompt:** 50M images, each a 512-dim CNN embedding, "find 10 most similar."

**Answer.** Dimension 512 → a k-d tree is **useless** (curse of dimensionality; `n >> 2^512` is impossible). This is an approximate-nearest-neighbor problem. Use **HNSW** (hnswlib / a vector DB like Milvus/Qdrant) or **IVF-PQ** (FAISS) if memory is tight. Tune `efSearch`/`nprobe` for ~95–99% recall at the latency target. If embeddings can be PCA-reduced to ~32 dims without hurting recall, a k-d tree *could* return as an exact option — but at 512 dims raw, name HNSW immediately. The interviewer is checking that you recognize the dimension wall and reach for ANN, not that you can force a k-d tree.

### Design 3 — "Real-time multiplayer: who can each player see?"

**Prompt:** A game with 10k players moving continuously; each frame, for each player, find all players within view radius `R`.

**Answer.** Dimension 2 (or 3), 10k points, but **highly dynamic** (positions change every frame). Options: (a) rebuild a k-d tree per frame — 10k points builds in well under a millisecond, then run 10k radius searches; cheap enough for 60 Hz. (b) A **uniform grid** sized to `R` may beat the tree here because positions update every frame and players are roughly uniformly dense — bucket each player into a cell, check the 9 neighboring cells. Grid gives O(1) updates and O(1+m) queries with trivial code. The senior answer compares both and picks the grid for *uniform, fully-dynamic* data, the k-d tree for *clustered* data — citing exactly the grid-vs-k-d-tree trade-off from `middle.md` §8.

---

## Behavioral / Depth Probes

Interviewers test depth with "why" follow-ups. Be ready for:

- *"Why does exploring the near side first matter for performance but not correctness?"* — It tightens `bestDist` early, so the far-side test fires more often; correctness holds regardless of order because both sides are eventually tested when the bound demands it.
- *"Your NN got slow in production — walk me through debugging."* — Check `nodes_visited_per_query`; if rising toward n, check whether dimension grew (curse) or the tree drifted unbalanced (inserts). Fix: reduce dims / switch to ANN, or rebuild.
- *"How would you test a k-d tree implementation?"* — Property test against brute force on random points (NN/k-NN/range/radius must match exactly), plus edge cases: n=1, duplicates, query equal to a point, collinear points, high dimension.
- *"What changes for k-NN vs NN?"* — A bounded max-heap of size k replaces the single best; prune on the k-th nearest distance, with a `+∞` bound until the heap fills.

---

## One-Page Cheat Sheet for the Interview

Memorize this; it answers 80% of k-d tree questions:

```text
STRUCTURE
  BST over points; axis = depth mod k (cyclic) or argmax-spread axis
  node owns an axis-aligned cell; tree partitions space

BUILD                 median split (quickselect)  → O(n log n), height ⌈log₂ n⌉
NEAREST (low dim)     descend near, prune far if diff² < bestDist → exp. O(log n)
NEAREST (worst/high)  Θ(n)   ← curse of dimensionality, useful ⇔ n >> 2^k
k-NN                  bounded max-heap of size k; bound = k-th dist (+∞ until full)
RANGE (2D box)        O(√n + m);  RANGE (kD) O(n^{1−1/k} + m)
RADIUS                like NN with fixed bound r
SPACE                 O(n), one node per point

PRUNE TEST            |q[axis] − split|² < bestDist²   (axis distance, not full!)
ALWAYS                squared distances; near side first; build balanced

NOT FOR               high-dim embeddings → HNSW/LSH; disk rectangles → R-tree
DYNAMIC               double-buffer rebuild; tombstone deletes; not self-balancing
GEO                   3D Cartesian on sphere, or Haversine + ball tree
```

### Decision one-liner
"Low dimension, exact, mostly static → k-d tree. Moderate dim or non-axis metric → ball tree. High dimension → approximate (HNSW/IVF/LSH). Disk + rectangles + dynamic → R-tree. Uniform + fully dynamic → grid."

### Two traps in the decision one-liner
- A quadtree is *not* a k-d tree: it splits a region into **four equal quadrants** by space; a k-d tree splits on a **chosen point**, one axis at a time. Quadtrees can waste nodes on empty quadrants; k-d trees never do.
- "Low dimension" means the *effective* dimension after feature scaling and reduction — raw 1000-dim features that PCA-reduce to 12 are a k-d tree job; raw irreducible 768-dim embeddings are not.

### The three sentences that signal seniority
1. "I'd qualify O(log n) as *expected, low-dimensional* — worst case and high-dimensional are O(n)."
2. "Past ~20 dimensions I'd reduce dimensionality or switch to an approximate index; a k-d tree stops pruning."
3. "For changing data I'd double-buffer rebuilds rather than maintain balance incrementally — rebuild is cheap relative to query volume."

---

## Final Self-Check

Before walking into the interview, confirm you can do each of these from memory:

- [ ] Write `build` (median split, alternating axis) in your strongest language.
- [ ] Write `nearest` with the correct far-side pruning test (`diff² < bestDist`).
- [ ] State build O(n log n), NN expected O(log n)/worst O(n), range O(√n+m), space O(n).
- [ ] Explain the curse of dimensionality and the `n >> 2^k` rule in two sentences.
- [ ] Name the alternatives and when each wins: brute force, grid, quadtree, range tree, R-tree, ball tree, HNSW, LSH.
- [ ] Describe the double-buffered rebuild for dynamic data.
- [ ] Extend `nearest` to k-NN with a bounded max-heap, including the `+∞`-until-full bound.
- [ ] Sketch the pruning correctness proof (far point crosses the split plane ⇒ `dist ≥ |q[a]−s|`).

If all eight are solid, you can handle the full junior-through-staff range of k-d tree questions.

Next step: [tasks.md](./tasks.md)
