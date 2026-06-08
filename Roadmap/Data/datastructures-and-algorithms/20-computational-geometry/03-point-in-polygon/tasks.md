# Point-in-Polygon (PIP) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from this topic: the half-open straddle test `(ay > py) != (by > py)`, the rightward crossing check `x_cross > px`, the signed **winding number**, the **cross-product / `isLeft`** orientation primitive, and the **filter-and-refine** pattern for many polygons.
> Golden rule throughout: **odd crossings → inside, even crossings → outside.**

---

## Beginner Tasks (5)

### Task 1 — Basic ray-casting PIP

**Statement.** Implement `pip(poly, q)` returning `true` if `q` is strictly inside the polygon `poly` (a list of `(x, y)` vertices), `false` otherwise. Use ray casting.

**Constraints.**
- `3 ≤ n ≤ 10^4` vertices.
- Coordinates are floats.
- `O(n)` per query, `O(1)` extra space.

**Hints.**
- Pair each vertex with the previous one (`j = n-1; for i: ...; j = i`) to include the closing edge.
- Use the strict half-open straddle test; toggle a boolean instead of counting.

#### Go

```go
package main

func pip(poly [][2]float64, q [2]float64) bool {
	// implement here
	return false
}

func main() {
	// pip([][2]float64{{0,0},{4,0},{4,4},{0,4}}, [2]float64{2,2}) == true
}
```

#### Java

```java
public class Task1 {
    static boolean pip(double[][] poly, double[] q) {
        // implement here
        return false;
    }
    public static void main(String[] args) {
        // pip(new double[][]{{0,0},{4,0},{4,4},{0,4}}, new double[]{2,2}) == true
    }
}
```

#### Python

```python
def pip(poly, q):
    # implement here
    return False

if __name__ == "__main__":
    assert pip([(0,0),(4,0),(4,4),(0,4)], (2,2)) is True
```

- **Expected Output:** `true` for `(2,2)`, `false` for `(5,5)`.
- **Evaluation:** correctness, closing-edge handled, half-open test used.

### Task 2 — Three-way classification

**Statement.** Extend Task 1 to `classify(poly, q)` returning `"INSIDE"`, `"OUTSIDE"`, or `"BOUNDARY"`. A point exactly on any edge (within `1e-9`) is `"BOUNDARY"`.

**Constraints.** Run the on-segment check before ray casting. `O(n)` per query.

**Hints.** On-segment = collinear (`cross ≈ 0`) AND inside the edge's bounding box.

Provide starter code in all 3 languages (signature `classify(poly, q) -> String`).

### Task 3 — Bounding-box fast reject

**Statement.** Implement `pipFast(poly, q)` that first computes the polygon's bounding box; if `q` is outside the box, return `false` in `O(1)` without scanning edges; otherwise run ray casting.

**Constraints.** Precompute the bbox once if you test many points (you may pass a precomputed bbox).

**Hints.** This is the single most effective cheap optimization for queries that are mostly outside.

Provide starter code in all 3 languages.

### Task 4 — Polygon area and orientation (sign of signed area)

**Statement.** Implement `signedArea(poly)` using the shoelace formula, and `isCCW(poly)` returning `true` if the vertices are counter-clockwise (positive signed area). This orientation is needed by the winding and convex tests.

**Constraints.** `O(n)`.

**Hints.** `2A = Σ (x_i * y_{i+1} − x_{i+1} * y_i)`; CCW ⇔ `A > 0`.

Provide starter code in all 3 languages.

### Task 5 — On-segment predicate

**Statement.** Implement `onSegment(p, a, b)` returning `true` if point `p` lies on the closed segment `a–b`. Use the cross product for collinearity plus a bounding-box containment check.

**Constraints.** `O(1)`. Tolerance `1e-9`.

**Hints.** `cross = (b-a) × (p-a)`; collinear if `|cross| ≤ eps`; then check `min ≤ p ≤ max` on both axes.

Provide starter code in all 3 languages.

---

## Intermediate Tasks (5)

### Task 6 — Winding number (non-zero rule)

**Statement.** Implement `windingNumber(poly, q)` returning the signed integer winding number, and `insideNonZero(poly, q)` returning `windingNumber != 0`. Use Sunday's no-trig method.

**Constraints.** `O(n)`. Must give correct results on self-intersecting polygons.

**Hints.** `+1` on an upward crossing with `q` to the left; `−1` on a downward crossing with `q` to the right. "Left" = `isLeft(a, b, q) > 0`.

Provide starter code in all 3 languages.

### Task 7 — Even-odd vs winding divergence test

**Statement.** Given a self-intersecting polygon (e.g. a pentagram traced as a single path) and a point at its center, implement both `evenOdd(poly, q)` and `insideNonZero(poly, q)` and print both verdicts to demonstrate they disagree.

**Constraints.** Hard-code a pentagram polygon. Show even-odd = outside, non-zero = inside for the center.

**Hints.** A 5-pointed star path: vertices at angles `90°, 90°+144°, 90°+288°, …` around a circle, connected in that "skip-one" order.

Provide starter code in all 3 languages.

### Task 8 — Convex polygon in O(log n)

**Statement.** Implement `inConvex(poly, q)` for a convex, counter-clockwise polygon using binary search on the vertex fan from `poly[0]`. Compare its answer to `O(n)` ray casting on random points to verify.

**Constraints.** `O(log n)` per query after assuming convex input. Validate against ray casting on ≥ 1000 random points.

**Hints.** Quick-reject if `q` is right of `V0→V1` or left of `V0→V_{n-1}`; binary search the wedge; final orientation test on `V_lo→V_hi`.

Provide starter code in all 3 languages.

### Task 9 — Batch count with bounding-box filter

**Statement.** Implement `countInside(poly, points)` returning how many of `points` are inside `poly`. Precompute the bbox once and reject out-of-box points in `O(1)` before ray casting.

**Constraints.** `m` points, polygon size `n`. Target `O(m·n)` worst case but `O(1)` per far-outside point.

**Hints.** Compute bbox once, loop points, reject then ray-cast.

Provide starter code in all 3 languages.

### Task 10 — Distance to polygon boundary

**Statement.** Implement `distanceToBoundary(poly, q)` returning the minimum distance from `q` to any edge of the polygon (a point-to-segment distance, min over edges). Useful for geofence hysteresis margins.

**Constraints.** `O(n)`.

**Hints.** Point-to-segment distance: project `q` onto each segment, clamp the parameter `t` to `[0,1]`, measure the distance to the clamped point. Take the minimum.

Provide starter code in all 3 languages.

---

## Advanced Tasks (5)

### Task 11 — Uniform-grid spatial index for many polygons

**Statement.** Build a `Grid` that buckets polygons by bounding-box into uniform cells, with `query(q)` returning the IDs of all polygons containing `q`. Use filter-and-refine: hash `q` to its cell, then exact-test only the candidates.

**Constraints.** `m` polygons. Query should touch `O(k)` candidates where `k` is the cell occupancy, then `O(n)` exact test each. Insert each polygon into every cell its bbox overlaps.

**Hints.** Cell key = `(floor(x/cell), floor(y/cell))`. Store per-polygon bbox for a second reject before ray casting.

Provide starter code in all 3 languages (a `Grid` type with `insert` and `query`).

### Task 12 — Slab decomposition for O(log n) queries

**Statement.** Preprocess one polygon into horizontal **slabs** (a horizontal cut at every vertex `y`). Within each slab, store the crossing edges sorted by `x`. Implement `query(q)` that binary-searches the slab by `q.y` then binary-searches the sorted edges by `q.x` to decide inside/outside in `O(log n)`.

**Constraints.** Build `O(n²)` time/space acceptable. Query `O(log n)`.

**Hints.** Inside a slab every relevant edge spans it top-to-bottom, so its `x` at the slab's mid-height gives a stable sort key; the parity of how many sorted edges are left of `q.x` is the answer.

Provide starter code in all 3 languages.

### Task 13 — Robust orientation with integer coordinates

**Statement.** Re-implement the winding-number test using **integer** coordinates so the orientation determinant is computed in exact 64-bit (or big-integer) arithmetic with no floating point. Demonstrate it gives a stable verdict for a point exactly on the line between two adjacent quantized polygons (no double-claim).

**Constraints.** Coordinates are integers; the orientation cross product must not overflow (use 64-bit or big-int as needed).

**Hints.** With integer inputs, `isLeft` is an exact integer expression; `> 0`, `= 0`, `< 0` are exact, so boundary classification is deterministic.

Provide starter code in all 3 languages.

### Task 14 — Polygon with holes (donut)

**Statement.** Support a polygon with **holes**: an outer ring plus one or more inner (hole) rings. A point is inside iff it is inside the outer ring AND outside every hole. Implement `pipWithHoles(outer, holes, q)`.

**Constraints.** Use ray casting on each ring. `O(total edges)`.

**Hints.** Equivalent trick: ray-cast against the concatenation of all rings and use overall parity — a point in a hole gets an extra crossing pair flipping it back to "outside". Implement the explicit outer-AND-not-any-hole version for clarity, and optionally verify it matches the combined-parity version.

Provide starter code in all 3 languages.

### Task 15 — 3D point-in-polyhedron (face parity)

**Statement.** Given a closed triangle mesh (a list of triangles) and a query point in 3D, decide inside/outside by shooting a ray (e.g. `+x` direction) and counting **ray–triangle** intersections — odd means inside. Implement `inPolyhedron(triangles, q)`.

**Constraints.** Use Möller–Trumbore ray–triangle intersection. Handle the simple non-degenerate case; you may perturb the ray direction slightly to avoid edge/vertex hits.

**Hints.** For each triangle, run Möller–Trumbore against the ray from `q`; count hits with `t > 0`. The 2D parity logic lifts directly to 3D face-parity.

Provide starter code in all 3 languages.

---

## Benchmark Task

> Compare ray casting vs winding number across all 3 languages on a fixed polygon and a large batch of random query points.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

type Pt struct{ X, Y float64 }

func rayCast(poly []Pt, q Pt) bool {
	in, n := false, len(poly)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.Y > q.Y) != (b.Y > q.Y) && a.X+(q.Y-a.Y)/(b.Y-a.Y)*(b.X-a.X) > q.X {
			in = !in
		}
	}
	return in
}

func main() {
	// Build a regular n-gon
	for _, n := range []int{8, 64, 512, 4096} {
		poly := make([]Pt, n)
		for i := 0; i < n; i++ {
			ang := 2 * 3.14159265 * float64(i) / float64(n)
			poly[i] = Pt{50 + 40*cos(ang), 50 + 40*sin(ang)}
		}
		qs := make([]Pt, 100000)
		for i := range qs {
			qs[i] = Pt{rand.Float64() * 100, rand.Float64() * 100}
		}
		start := time.Now()
		cnt := 0
		for _, q := range qs {
			if rayCast(poly, q) {
				cnt++
			}
		}
		fmt.Printf("n=%5d: %d inside, %v\n", n, cnt, time.Since(start))
	}
}

// simple cos/sin to keep it self-contained-ish (use math in real code)
func cos(x float64) float64 { return mathCos(x) }
func sin(x float64) float64 { return mathSin(x) }
```

#### Java

```java
import java.util.*;

public class Benchmark {
    record Pt(double x, double y) {}
    static boolean rayCast(Pt[] poly, Pt q) {
        boolean in = false; int n = poly.length;
        for (int i = 0, j = n-1; i < n; j = i++) {
            Pt a = poly[i], b = poly[j];
            if ((a.y() > q.y()) != (b.y() > q.y()) &&
                a.x() + (q.y()-a.y())/(b.y()-a.y())*(b.x()-a.x()) > q.x()) in = !in;
        }
        return in;
    }
    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int n : new int[]{8, 64, 512, 4096}) {
            Pt[] poly = new Pt[n];
            for (int i = 0; i < n; i++) {
                double a = 2*Math.PI*i/n;
                poly[i] = new Pt(50 + 40*Math.cos(a), 50 + 40*Math.sin(a));
            }
            Pt[] qs = new Pt[100000];
            for (int i = 0; i < qs.length; i++)
                qs[i] = new Pt(rnd.nextDouble()*100, rnd.nextDouble()*100);
            long start = System.nanoTime();
            int cnt = 0;
            for (Pt q : qs) if (rayCast(poly, q)) cnt++;
            System.out.printf("n=%5d: %d inside, %.3f ms%n",
                n, cnt, (System.nanoTime()-start)/1_000_000.0);
        }
    }
}
```

#### Python

```python
import math, random, time

def ray_cast(poly, q):
    inside, n, j = False, len(poly), len(poly)-1
    for i in range(n):
        ax, ay = poly[i]; bx, by = poly[j]
        if (ay > q[1]) != (by > q[1]):
            if ax + (q[1]-ay)/(by-ay)*(bx-ax) > q[0]:
                inside = not inside
        j = i
    return inside

if __name__ == "__main__":
    random.seed(1)
    for n in [8, 64, 512, 4096]:
        poly = [(50 + 40*math.cos(2*math.pi*i/n),
                 50 + 40*math.sin(2*math.pi*i/n)) for i in range(n)]
        qs = [(random.random()*100, random.random()*100) for _ in range(100_000)]
        start = time.perf_counter()
        cnt = sum(1 for q in qs if ray_cast(poly, q))
        print(f"n={n:5d}: {cnt} inside, {(time.perf_counter()-start)*1000:.3f} ms")
```

**Run:** `go run main.go` | `javac Benchmark.java && java Benchmark` | `python bench.py`

**What to observe:** runtime scales linearly with `n` (each query is `O(n)`), and Go/Java are roughly an order of magnitude faster than CPython for this tight numeric loop. Try adding the bounding-box pre-filter and re-measure — the count of inside points stays the same but throughput jumps because far-outside points reject in `O(1)`.
