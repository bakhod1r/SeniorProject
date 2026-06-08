# Convex Hull (2D) — Interview Preparation

The convex hull is the gateway problem for computational-geometry interviews. It is short enough to whiteboard, it rests on a single primitive — the **orientation (cross-product) test** — and it carries a cluster of gotchas (collinear handling, integer-vs-float exactness, the `Ω(n log n)` lower bound, output-sensitive `O(n log h)`) that separate a candidate who memorized monotone chain from one who understands *why* it works. This file is a tiered question bank (junior → professional), behavioral and system-design prompts, and a full coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Problem | Smallest convex polygon containing all points | Report hull vertices in CCW order. |
| Core primitive | **`orient(A,B,C) = (Bx-Ax)(Cy-Ay) - (By-Ay)(Cx-Ax)`** | Sign: `>0` left/CCW, `<0` right/CW, `=0` collinear. |
| Default algorithm | **Andrew's monotone chain** | Sort by `(x,y)`, two sweeps, pop non-left turns. |
| Monotone / Graham time | `O(n log n)` | Dominated by the sort. |
| Gift wrapping (Jarvis) | `O(nh)` | `h` = hull size; `O(n²)` worst. |
| QuickHull | `O(n log n)` avg, `O(n²)` worst | Divide by side of a line. |
| Chan's algorithm | **`O(n log h)`** | Output-sensitive optimum. |
| Lower bound | **`Ω(n log n)`** | Reduction from sorting (parabola). |
| Exactness | Integer coords ⇒ exact sign | Use 64-bit to avoid overflow. |
| Collinear convention | `<= 0` drops, `< 0` keeps | Match the consumer. |

Skeleton (monotone chain, the version to write by default):

```text
sort points by (x, y); dedup
lower = []; for p in points:      while |lower|≥2 and orient(lower[-2],lower[-1],p)≤0: pop;  push p
upper = []; for p in reversed:    while |upper|≥2 and orient(upper[-2],upper[-1],p)≤0: pop;  push p
hull  = lower[:-1] + upper[:-1]   # drop the two shared endpoints
```

Mental anchor: **every 2D geometry decision is "left turn, right turn, or straight?" — the sign of one cross product.**

---

## Junior Questions (14 Q&A)

### J1. What is a convex hull?
The convex hull of a set of points is the smallest convex polygon that contains all of them — picture a rubber band stretched around a board of nails. Every input point is on the boundary or inside it, and the boundary never bends inward. Its vertices are a subset of the input points (the "extreme" ones).

### J2. What is the orientation / cross-product test?
For three points `A, B, C`, `orient(A,B,C) = (Bx-Ax)(Cy-Ay) - (By-Ay)(Cx-Ax)`. Its sign tells you the turn direction going `A → B → C`: positive means a left turn (counter-clockwise), negative a right turn (clockwise), zero means the three are collinear. It equals twice the signed area of triangle `ABC`.

### J3. Why use the cross product instead of angles?
Angles need `atan2`, division, and floating point — slow and imprecise. The cross product is one subtraction of two products. With integer coordinates it is computed exactly, so the sign (which is all the algorithm uses) is always correct, with no rounding.

### J4. Describe Andrew's monotone chain.
Sort the points by `x` (then `y`). Sweep left-to-right building the lower hull: keep a stack, and while the top two points plus the new point make a non-left turn, pop. Then sweep right-to-left for the upper hull with the same rule. Concatenate the two chains, dropping the duplicated endpoints. It runs in `O(n log n)`, dominated by the sort.

### J5. What is the time complexity of monotone chain and why?
`O(n log n)`. The sort is `O(n log n)`; the two sweeps are `O(n)` total because each point is pushed once and popped at most once. So the sort dominates.

### J6. What does it mean to "pop" a point?
A popped point is a dent — it lies inside or on the boundary line formed by its neighbors, so it cannot be a hull corner. When the last three points make a non-left turn, the middle one is the dent and gets removed from the stack.

### J7. How do you handle fewer than 3 points?
0, 1, or 2 points are their own hull (a point or a segment). Guard for `n < 3` at the top and return the points directly, because the pop loop assumes at least two points on the stack.

### J8. What is gift wrapping (Jarvis march)?
Start at a guaranteed hull point (the leftmost), then repeatedly pick the next hull vertex as the "most clockwise" point relative to the current edge, until you return to the start. Each step scans all `n` points; you do one step per hull vertex, so it is `O(nh)`. Simple and intuitive but slow when the hull is large.

### J9. What is `h`?
`h` is the number of points on the hull — the output size. It ranges from `2` (all collinear) up to `n` (e.g., points on a circle). Gift wrapping's `O(nh)` depends on it; monotone chain's `O(n log n)` does not.

### J10. Why must the cross product use 64-bit integers?
Two coordinate differences multiplied can exceed 32-bit range even when the coordinates themselves fit. Overflow silently flips the sign and corrupts the hull. Use `int64` / `long` (or wider for very large coordinates).

### J11. What is a collinear degeneracy?
Three or more points lying on one straight line — the cross product is exactly zero. You must decide whether the middle point counts as a hull vertex (`< 0` keeps it) or is dropped (`<= 0` drops it). Unhandled, collinear runs can break naive code.

### J12. How do you reconstruct the hull polygon?
Monotone chain *is* the reconstruction — the stack contents in order are the boundary vertices. Concatenate lower and upper chains (dropping the two shared endpoints) and you have the polygon in counter-clockwise order.

### J13. Give a real-world use of the convex hull.
A bounding shell for collision detection (test the cheap hull before the full shape), the smallest region enclosing a set of GPS points in GIS, the outline of a cluster in pattern recognition, or preprocessing for finding the farthest pair of points (diameter).

### J14. What happens if all points are collinear?
The "hull" degenerates to a line segment, not a polygon with area. Detect it (every `orient == 0`) and decide your contract — typically return the two extreme endpoints.

### J15. In what order does monotone chain return the hull?
Counter-clockwise, starting from the leftmost (bottom-most on ties) point. The lower chain goes left to right along the bottom, the upper chain goes right to left along the top; concatenated they form one CCW cycle.

### J16. What does "twice the signed area" mean and why use it?
The shoelace formula `Σ(x_i·y_{i+1} - x_{i+1}·y_i)` gives exactly twice the polygon's area. We keep the factor of 2 because with integer coordinates `2·area` is always an integer, so it stays exact. A positive value means the vertices are listed counter-clockwise.

---

## Middle Questions (14 Q&A)

### M1. Prove (sketch) why popping non-left turns gives the hull.
Walk a convex polygon counter-clockwise: you only ever turn left (or go straight). So during the left-to-right sweep, any point that makes a non-left turn with its predecessors is a dent and cannot be on the lower hull. Since the new point is always the rightmost so far, a dropped point can never become extreme again — one linear pass suffices.

### M2. Monotone chain vs Graham scan — which and why?
Both are `O(n log n)`. Monotone chain sorts by coordinate; Graham scan sorts by polar angle around a pivot. Monotone chain is preferred because the coordinate sort avoids Graham's trickiest part — breaking ties among points at the same angle (which need a distance tiebreak). Same orientation test, fewer edge cases.

### M3. When does gift wrapping actually win?
When `h` is small. `O(nh) < O(n log n)` exactly when `h < log n`. For a point cloud with only a handful of extreme points among millions, gift wrapping (or Chan's) beats monotone chain. On points on a circle (`h = n`), gift wrapping degrades to `O(n²)`.

### M4. How do you handle duplicate points?
Deduplicate before building (sort + unique, or a set). Duplicates create zero-length edges and confuse the collinear pop logic.

### M5. Explain the integer-vs-float exactness issue.
The algorithm only needs the *sign* of `orient`. With integers the sign is exact. With `double`, near-collinear triples produce a tiny cross product, and catastrophic cancellation in the subtraction can flip the sign — causing a wrong pop, a non-convex or self-intersecting hull, or an infinite loop. Prefer integers, snap to a grid, or use exact predicates.

### M6. What is the `<= 0` vs `< 0` choice in the pop test?
`<= 0` pops collinear points too (minimal hull — only true corners). `< 0` keeps collinear boundary points (every point on an edge is listed). Choose based on the consumer: rotating calipers usually want the minimal hull; boundary queries may want all points.

### M7. How would you verify your hull is correct?
Check it is a valid convex polygon: signed area `> 0` (CCW, non-zero), every consecutive triple turns left (`orient >= 0`), no duplicate vertices. For testing, compare against a brute-force `O(n³)` hull (a point is extreme iff some line through it has all others on one side) on random inputs.

### M8. How does QuickHull work?
Take the leftmost and rightmost points; the line between them splits the rest into two sides. On each side, find the farthest point from the line — it is a hull vertex — and recurse on the two sub-regions it forms. Average `O(n log n)`, worst case `O(n²)` (like quicksort's pivot pathology).

### M9. What is the convex hull trick and how does it relate?
The convex hull trick maintains the lower/upper envelope of a set of *lines* to answer "min/max value at `x`" in `O(log n)`, accelerating certain DPs from `O(n²)` to `O(n log n)`. It is the same monotone-chain machinery applied to lines instead of points.

### M10. How do you find the diameter (farthest pair) of a point set?
The farthest pair are both hull vertices. Build the hull, then use **rotating calipers** — walk two antipodal pointers around the hull in `O(h)`. Total `O(n log n)`. Checking all pairs would be `O(n²)`.

### M11. What coordinate range needs 128-bit arithmetic?
If `|coord| ≤ U`, the cross product magnitude is `≤ 8U²`. For `U ≈ 10^9`, that needs ~64 bits (`int64`). For `U ≈ 10^18`, ~125 bits — use 128-bit or big integers.

### M12. Why is the lower bound `Ω(n log n)`?
Map each number `x` to the point `(x, x²)` on a parabola. All such points are hull vertices, and the lower hull lists them in increasing `x` — i.e., sorted. So a faster-than-`O(n log n)` hull would sort faster than `O(n log n)`, which is impossible. Hull is at least as hard as sorting.

### M13. How do you test whether a point is left/right of a directed line?
Compute `orient(A, B, P)` where `A→B` is the directed line. Positive means `P` is to the left, negative to the right, zero on the line. This single-sign test powers QuickHull's region split, point-in-polygon, and half-plane intersection.

### M14. Why might QuickHull be preferred over monotone chain despite a worse worst case?
On random or roughly uniform data, QuickHull's expected time is `O(n log n)` with excellent cache locality (it partitions contiguously like quicksort) and it discards interior points early, so in practice it is often faster. The `O(n²)` worst case (points on a slowly curving arc) is rare for real data. Monotone chain is still the safer default because its `O(n log n)` is guaranteed.

---

## Senior Questions (10 Q&A)

### S1. How do you compute the hull of 100 million points that do not fit in memory?
Shard the plane into spatial tiles; compute each tile's local hull independently (dropping all interior points — they can never be on the global hull); then merge the local hulls. The union of local hull vertices is tiny, so a final in-memory monotone chain finishes it. This is filter-and-refine, exploiting that the hull of a union equals the hull of the sub-hulls.

### S2. How do you maintain a hull as points stream in?
Insertion-only: an incremental hull (test each new point inside/outside; if outside, add it and remove the vertices it shadows). With deletions: a true dynamic structure — Overmars–van Leeuwen at `O(log² n)` per update, or Chan's dynamic hull at `O(log^{1+ε} n)`. Pragmatically, batch updates and rebuild periodically unless the SLA forbids it.

### S3. What makes a hull implementation "robust"?
It returns a valid simple convex polygon for *every* input — including collinear runs, duplicates, all-collinear, and near-collinear floats — without crashing or looping. Achieved via exact predicates (integer arithmetic or Shewchuk's adaptive `orient2d`), consistent degeneracy tie-breaking, overflow-safe arithmetic, and an output-validation pass.

### S4. When is the convex hull the wrong answer?
When you need a tight outline that bends inward (use a concave hull / alpha shape), a quick axis-aligned bounding box (use an AABB), the smallest enclosing circle (Welzl's), or interior structure (Delaunay triangulation). The convex hull over-includes empty space for coastlines, routes, and non-convex clusters.

### S5. How does the hull parallelize?
Along the divide-and-conquer seam: parallel-sort, split into vertical strips, compute each strip's hull on a separate core, then merge adjacent hulls pairwise by finding the upper and lower tangent bridges (`O(h)` per merge). Distributed (Spark): map tiles to local hulls (huge data reduction), reduce by hulling the union of local vertices.

### S6. What changes in 3D?
The output is a polyhedron of triangular faces, not a vertex cycle. The orientation primitive becomes a `3×3`/`4×4` determinant (which side of a plane). QuickHull 3D and incremental methods run in `O(n log n)` expected. Robustness is harder. Use a vetted library (`qhull`, CGAL) — do not hand-roll it.

### S7. What GIS-specific pitfalls exist?
Lat/lon is spherical — project to a planar CRS (UTM) before running the planar algorithm, especially near the poles or antimeridian. Also, `h` is usually tiny for geographic data, making sharded reduction extremely effective and even gift wrapping attractive.

### S8. How do you guard against a self-intersecting hull in production?
Use exact predicates so branch decisions are never inconsistent, and add a cheap `O(h)` validation pass before handing the hull to consumers. Alert on validation failures; in production, degrade gracefully (e.g., fall back to a bounding box) rather than emitting an invalid polygon.

### S9. What metrics would you monitor?
Build latency p99, the ratio `h/n` (a spike signals noisy or pathological input), degenerate-input counts, overflow-guard hits, dynamic-hull rebuild rate, and — most important — validation-failure count, the canary for a robustness bug.

### S10. How do collision engines use the hull?
A convex hull is a cheap outer shell. If two hulls do not intersect, the underlying shapes do not either (fast reject). Hulls feed GJK and SAT, the standard convex-collision algorithms in physics engines. Decomposing a concave shape into convex pieces (each with its own hull) extends this to general geometry.

---

## Professional Questions (8 Q&A)

### P1. State and prove the loop invariant for monotone chain.
Invariant: at the start of iteration `k`, the stack `H` is exactly the lower hull of `{p_1,...,p_{k-1}}`, every consecutive triple turning strictly left. Base: empty stack = lower hull of empty set. Step: the new rightmost point `p_k` forces any top vertex making a non-left turn to be non-extreme (a supporting line now passes below it), so popping is mandatory and lossless; pushing `p_k` (the new right endpoint, hence extreme) restores the invariant. Termination: `n` iterations, total pops `≤ n`. Postcondition: `H` is the lower hull of all of `P`. The upper hull is symmetric.

### P2. Prove the `Ω(n log n)` lower bound.
Reduce sorting to hull: map `x_i ↦ (x_i, x_i²)`. The parabola is strictly convex, so all `n` points are hull vertices, and reading the lower chain left-to-right yields the `x_i` in sorted order. The map is `O(n)`. A hull algorithm running in `o(n log n)` would sort in `o(n log n)`, contradicting the algebraic-decision-tree sorting bound. Hence hull is `Ω(n log n)`.

### P3. Explain Chan's `O(n log h)` algorithm.
Partition into `n/m` groups of size `m`; build each group's hull by Graham/monotone in `O(n log m)`. Run gift wrapping over the whole set, finding the next vertex's tangent from each mini-hull by binary search in `O(log m)`, so each wrap step is `O((n/m) log m)` and `h` steps cost `O(h(n/m) log m)`. With `m ≈ h`, one round is `O(n log m)`. Since `h` is unknown, guess `m = 2^(2^t)`, doubling the exponent and restarting on failure; success occurs at `t ≈ log log h`, and the geometric sum of round costs is `O(n log h)`.

### P4. Why is Chan's algorithm optimal?
There is a matching `Ω(n log h)` lower bound for output-sensitive hull computation. Chan's `O(n log h)` meets it, and since `h ≤ n` it is never worse than `O(n log n)` — strictly better when `h ≪ n`. It is the canonical output-sensitive-optimal algorithm.

### P5. What is the Exact Geometric Computation paradigm?
Algorithm control flow depends only on the *signs* of a few predicates (here, `orient`). If every predicate sign is evaluated exactly, the algorithm takes the same branch path as it would over the reals — provably correct and never inconsistent — even if coordinate *constructions* are approximate. Robustness bugs come from inexact predicate signs, not from approximate coordinates.

### P6. How do Shewchuk's adaptive predicates work?
Compute `orient` in fast floating point with an a-priori error bound; if `|result|` exceeds the bound, the sign is certified — return it. Otherwise recompute with progressively higher precision (exact expansion arithmetic) until the sign is determined. The cheap path almost always certifies, so expected cost is near the naive version, but the sign is always correct.

### P7. What is Simulation of Simplicity?
A symbolic-perturbation scheme (Edelsbrunner–Mücke) that conceptually adds an infinitesimal `(ε^{2^i}, ε^{2^{2^i}})` to point `p_i`, guaranteeing no two coincide and no three are collinear. Degenerate predicates (`orient = 0`) are resolved by the sign of the first non-zero term of a polynomial in `ε`. It gives consistent, deterministic tie-breaking for all degeneracies without special-casing — and is never actually computed numerically.

### P8. Why does naive floating point fail near collinearity, formally?
`orient` subtracts two products of similar magnitude. Each product carries relative error `≤ ε_mach`, but subtracting nearly equal quantities causes catastrophic cancellation: the absolute error can exceed the true (tiny) value, making `sign(orient)` unreliable precisely when points are near-collinear — exactly the cases that decide hull membership.

---

## Behavioral & System-Design Prompts

- *Walk me through choosing a hull algorithm for a real product.* Discuss `n`, expected `h`, integer vs float inputs, in-memory vs out-of-core, streaming vs batch, and the robustness/validation strategy.
- *A teammate's hull occasionally returns a self-intersecting polygon.* Diagnose: floating-point predicate sign flips or integer overflow; fix with exact predicates / integer snapping and add a validation pass.
- *Design a service that returns the convex hull of live vehicle GPS positions.* Cover CRS projection, dynamic vs batch-rebuild, caching with invalidation, and SLA-driven freshness.
- *When would you reject the convex hull and propose a concave hull?* Coastlines, delivery zones around roads, non-convex clusters — anywhere the convex hull over-includes empty area.

---

## Coding Challenge (3 Languages)

### Challenge: Convex Hull + Polygon Area

> Given `n` points with **integer** coordinates, compute the convex hull (monotone chain, drop collinear) in counter-clockwise order, and return **twice the area** of the hull polygon (an exact integer via the shoelace formula). Return the hull vertices and `2·area`.
>
> Constraints: `1 ≤ n ≤ 2·10^5`, `|x|, |y| ≤ 10^9`. Use 64-bit arithmetic. Time `O(n log n)`.
>
> Example: points `(0,0),(4,0),(4,4),(0,4),(1,1),(2,2),(3,1)` → hull `(0,0),(4,0),(4,4),(0,4)`, `2·area = 32`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Point struct{ X, Y int64 }

func cross(a, b, c Point) int64 {
	return (b.X-a.X)*(c.Y-a.Y) - (b.Y-a.Y)*(c.X-a.X)
}

// ConvexHull: monotone chain, drops collinear points, returns CCW order.
func ConvexHull(pts []Point) []Point {
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	// dedup
	u := pts[:0]
	var last Point
	for i, p := range pts {
		if i == 0 || p != last {
			u = append(u, p)
			last = p
		}
	}
	pts = u
	n := len(pts)
	if n < 3 {
		return pts
	}
	h := make([]Point, 0, 2*n)
	for _, p := range pts { // lower
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	lo := len(h) + 1
	for i := n - 2; i >= 0; i-- { // upper
		p := pts[i]
		for len(h) >= lo && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	return h[:len(h)-1]
}

// twiceArea: shoelace formula, exact integer (= 2 * polygon area).
func twiceArea(poly []Point) int64 {
	var s int64
	for i := 0; i < len(poly); i++ {
		a, b := poly[i], poly[(i+1)%len(poly)]
		s += a.X*b.Y - a.Y*b.X
	}
	if s < 0 {
		s = -s
	}
	return s
}

func main() {
	pts := []Point{{0, 0}, {4, 0}, {4, 4}, {0, 4}, {1, 1}, {2, 2}, {3, 1}}
	hull := ConvexHull(pts)
	fmt.Println("Hull:", hull)             // (0,0)(4,0)(4,4)(0,4)
	fmt.Println("2*area:", twiceArea(hull)) // 32
}
```

#### Java

```java
import java.util.*;

public class Solution {
    record Point(long x, long y) {}

    static long cross(Point a, Point b, Point c) {
        return (b.x() - a.x()) * (c.y() - a.y()) - (b.y() - a.y()) * (c.x() - a.x());
    }

    static List<Point> convexHull(List<Point> input) {
        TreeSet<Point> set = new TreeSet<>((p, q) ->
                p.x() != q.x() ? Long.compare(p.x(), q.x()) : Long.compare(p.y(), q.y()));
        set.addAll(input); // sort + dedup
        List<Point> pts = new ArrayList<>(set);
        int n = pts.size();
        if (n < 3) return pts;
        List<Point> h = new ArrayList<>();
        for (Point p : pts) {
            while (h.size() >= 2 && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        int lo = h.size() + 1;
        for (int i = n - 2; i >= 0; i--) {
            Point p = pts.get(i);
            while (h.size() >= lo && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        h.remove(h.size() - 1);
        return h;
    }

    static long twiceArea(List<Point> poly) {
        long s = 0;
        int m = poly.size();
        for (int i = 0; i < m; i++) {
            Point a = poly.get(i), b = poly.get((i + 1) % m);
            s += a.x() * b.y() - a.y() * b.x();
        }
        return Math.abs(s);
    }

    public static void main(String[] args) {
        List<Point> pts = List.of(new Point(0,0), new Point(4,0), new Point(4,4),
                new Point(0,4), new Point(1,1), new Point(2,2), new Point(3,1));
        List<Point> hull = convexHull(pts);
        System.out.println("Hull: " + hull);
        System.out.println("2*area: " + twiceArea(hull)); // 32
    }
}
```

#### Python

```python
def cross(a, b, c):
    return (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])


def convex_hull(points):
    pts = sorted(set(points))
    n = len(pts)
    if n < 3:
        return pts
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def twice_area(poly):
    s = 0
    m = len(poly)
    for i in range(m):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % m]
        s += ax * by - ay * bx
    return abs(s)


if __name__ == "__main__":
    pts = [(0, 0), (4, 0), (4, 4), (0, 4), (1, 1), (2, 2), (3, 1)]
    hull = convex_hull(pts)
    print("Hull:", hull)            # [(0,0),(4,0),(4,4),(0,4)]
    print("2*area:", twice_area(hull))  # 32
```

**Follow-ups the interviewer may ask:**
- *Keep collinear points instead.* Change the pop test from `<= 0` to `< 0`.
- *Return the actual area.* Divide `2·area` by 2 (it may be a half-integer; keep it as a fraction or float only at the very end).
- *Handle all-collinear input.* Detect when the hull has `< 3` vertices and return the segment.
- *Make it output-sensitive.* Describe Chan's `O(n log h)` (no need to implement under time pressure).

---

### Bonus Challenge: Farthest Pair (Diameter) via Rotating Calipers

> Given `n` integer points, return the **squared** distance of the farthest pair (kept squared to stay exact). Build the hull, then walk antipodal pointers around it in `O(h)`. Total `O(n log n)`.
>
> Example: corners of a `10×10` square → diagonal² = `200`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Point struct{ X, Y int64 }

func cross(a, b, c Point) int64 {
	return (b.X-a.X)*(c.Y-a.Y) - (b.Y-a.Y)*(c.X-a.X)
}
func dist2(a, b Point) int64 {
	dx, dy := a.X-b.X, a.Y-b.Y
	return dx*dx + dy*dy
}

func hull(pts []Point) []Point {
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	n := len(pts)
	if n < 3 {
		return pts
	}
	h := make([]Point, 0, 2*n)
	for _, p := range pts {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	lo := len(h) + 1
	for i := n - 2; i >= 0; i-- {
		p := pts[i]
		for len(h) >= lo && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	return h[:len(h)-1]
}

func diameter2(pts []Point) int64 {
	hl := hull(pts)
	m := len(hl)
	if m < 2 {
		return 0
	}
	if m == 2 {
		return dist2(hl[0], hl[1])
	}
	var best int64
	j := 1
	for i := 0; i < m; i++ {
		ni := (i + 1) % m
		// advance j while the triangle area grows (antipodal walk)
		area := func(k int) int64 {
			return abs64(cross(hl[i], hl[ni], hl[k%m]))
		}
		for area(j+1) > area(j) {
			j = (j + 1) % m
		}
		if d := dist2(hl[i], hl[j]); d > best {
			best = d
		}
		if d := dist2(hl[ni], hl[j]); d > best {
			best = d
		}
	}
	return best
}
func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	pts := []Point{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {5, 5}}
	fmt.Println("diameter^2:", diameter2(pts)) // 200
}
```

#### Java

```java
import java.util.*;

public class Diameter {
    record Point(long x, long y) {}

    static long cross(Point a, Point b, Point c) {
        return (b.x() - a.x()) * (c.y() - a.y()) - (b.y() - a.y()) * (c.x() - a.x());
    }
    static long dist2(Point a, Point b) {
        long dx = a.x() - b.x(), dy = a.y() - b.y();
        return dx * dx + dy * dy;
    }

    static List<Point> hull(List<Point> in) {
        List<Point> pts = new ArrayList<>(in);
        pts.sort((p, q) -> p.x() != q.x()
                ? Long.compare(p.x(), q.x()) : Long.compare(p.y(), q.y()));
        int n = pts.size();
        if (n < 3) return pts;
        List<Point> h = new ArrayList<>();
        for (Point p : pts) {
            while (h.size() >= 2 && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        int lo = h.size() + 1;
        for (int i = n - 2; i >= 0; i--) {
            Point p = pts.get(i);
            while (h.size() >= lo && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        h.remove(h.size() - 1);
        return h;
    }

    static long diameter2(List<Point> pts) {
        List<Point> h = hull(pts);
        int m = h.size();
        if (m < 2) return 0;
        if (m == 2) return dist2(h.get(0), h.get(1));
        long best = 0;
        int j = 1;
        for (int i = 0; i < m; i++) {
            int ni = (i + 1) % m;
            while (Math.abs(cross(h.get(i), h.get(ni), h.get((j + 1) % m)))
                 > Math.abs(cross(h.get(i), h.get(ni), h.get(j))))
                j = (j + 1) % m;
            best = Math.max(best, Math.max(dist2(h.get(i), h.get(j)), dist2(h.get(ni), h.get(j))));
        }
        return best;
    }

    public static void main(String[] args) {
        List<Point> pts = List.of(new Point(0,0), new Point(10,0), new Point(10,10),
                new Point(0,10), new Point(5,5));
        System.out.println("diameter^2: " + diameter2(pts)); // 200
    }
}
```

#### Python

```python
def cross(a, b, c):
    return (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])


def dist2(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2


def hull(points):
    pts = sorted(set(points))
    n = len(pts)
    if n < 3:
        return pts
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def diameter2(points):
    h = hull(points)
    m = len(h)
    if m < 2:
        return 0
    if m == 2:
        return dist2(h[0], h[1])
    best, j = 0, 1
    for i in range(m):
        ni = (i + 1) % m
        while abs(cross(h[i], h[ni], h[(j + 1) % m])) > abs(cross(h[i], h[ni], h[j])):
            j = (j + 1) % m
        best = max(best, dist2(h[i], h[j]), dist2(h[ni], h[j]))
    return best


if __name__ == "__main__":
    pts = [(0, 0), (10, 0), (10, 10), (0, 10), (5, 5)]
    print("diameter^2:", diameter2(pts))  # 200
```

This is the canonical "hull as a building block" pattern: the expensive part (`O(n log n)`) is the hull; the calipers walk is a cheap linear pass that exploits the hull's convex, CCW structure.

---

**Next step:** [tasks.md](./tasks.md) — 15 graded practice tasks (5 beginner, 5 intermediate, 5 advanced) plus a cross-language benchmark.
