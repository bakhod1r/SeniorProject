# Minimum Enclosing Circle — Interview Preparation

The minimum enclosing circle (MEC) is a favorite computational-geometry interview problem because it has a deceptively simple statement, one beautiful structural fact (**the answer is determined by 2 or 3 points**), and a slick randomized algorithm (**Welzl, expected O(n)**) that separates candidates who memorized a formula from those who understand *why* it works. This file is a tiered question bank — junior through professional — plus behavioral and system-design prompts and a complete coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Problem | Smallest circle covering all points | Unique answer. |
| Also called | Smallest enclosing circle, min bounding circle, **1-center** | Same thing. |
| Key fact | Determined by **2 or 3** boundary points | The 2-or-3-points lemma. |
| 2-point circle | Diameter: center = midpoint, r = dist/2 | Used when 2 points are antipodal. |
| 3-point circle | Circumcircle (perpendicular-bisector intersection) | Collinear → no finite circle. |
| Naive time | **O(n⁴)** / pruned **O(n³)** | Enumerate pair + triple circles. |
| Welzl time | **expected O(n)** | Randomized incremental. |
| Megiddo time | **O(n)** worst case | Deterministic prune-and-search. |
| Framework | **LP-type**, combinatorial dimension 3 | `d+1` in `R^d`. |
| High dim | Bădoiu–Clarkson `(1+ε)`, core-set `O(1/ε)` | Welzl constant ~`(d+1)!`. |
| Inside test | `dist(c,p) ≤ r + eps` | Compare squared to skip sqrt. |
| Gotcha | Shuffle before Welzl; relative `eps` | No shuffle → adversarial O(n²). |

Skeleton (move-to-front Welzl — the version to write by default):

```text
shuffle(points)
c = circle(points[0], 0)
for i in 1..n-1:
    if points[i] inside c: continue
    c = circle(points[i], 0)                       # points[i] on boundary
    for j in 0..i-1:
        if points[j] inside c: continue
        c = from2(points[i], points[j])            # i, j on boundary
        for k in 0..j-1:
            if points[k] inside c: continue
            c = from3(points[i], points[j], points[k])  # 3 on boundary
```

Mental anchor: **only 2 or 3 points ever matter; rebuild only when a point falls outside.**

---

## Worked Whiteboard Example

Interviewers often ask you to compute a small MEC by hand. Practice this exact flow on `A=(0,0), B=(4,0), C=(2,3)`:

```text
1. Try the widest pair as a diameter. Widest is A–B (distance 4).
   Circle: center (2,0), r=2.
2. Check the third point C=(2,3): dist((2,0),(2,3)) = 3 > 2 → C is OUTSIDE.
3. Two points are not enough; build the circumcircle of A,B,C.
   d = 2*(0*(0-3)+4*(3-0)+2*(0-0)) = 24  (nonzero → not collinear).
   cx = (0*(0-3)+16*(3-0)+13*0)/24 = 48/24 = 2
   cy = (0*(2-4)+16*(0-2)+13*(4-0))/24 = (-32+52)/24 ≈ 0.833
   center ≈ (2, 0.833), r = dist(center, A) ≈ 2.166
4. Verify all three on the boundary (they are) → MEC is the circumcircle.
```

Talking points to say out loud while solving: *"I try the diameter of the two extreme points first; if the rest fit, done in the 2-point case. If one sticks out, that point joins the boundary and I move to the 3-point circumcircle."* This narration signals you understand the 2-or-3-points lemma, not just the formulas.

---

## Junior Questions (12 Q&A)

### J1. What is the minimum enclosing circle?
The smallest circle (smallest radius) that contains every point of a given set, where points may be inside or exactly on the boundary. It is **unique**. It is also called the smallest enclosing circle, minimum bounding circle, or 1-center.

### J2. How is it different from the centroid?
The centroid (average of the points) minimizes the *sum of squared distances*. The MEC center minimizes the *maximum* distance to any point. They are generally different points. A common beginner mistake is to use the centroid as the circle center — it doesn't give the smallest covering circle.

### J3. How many points lie on the boundary of the MEC?
Always **2 or 3**. If two points are "antipodal" (a diameter) and everyone else fits, that's the 2-point case; otherwise three points pin it via their circumcircle. Never more than 3.

### J4. What is the MEC of two points?
The circle whose diameter is the segment between them: center is the midpoint, radius is half their distance.

### J5. What is a circumcircle?
The unique circle passing through three non-collinear points. Its center (circumcenter) is equidistant from all three and is found by intersecting the perpendicular bisectors of two sides.

### J6. What happens if three points are collinear?
There is no finite circumcircle (the perpendicular bisectors are parallel). In code, the circumcircle determinant `d` is ~0; you must guard against division by zero and fall back to the diameter circle of the two extreme points.

### J7. How do you test whether a point is inside a circle?
Check `dist(center, p) ≤ r`. To avoid the slow `sqrt`, compare squared distances: `(px-cx)² + (py-cy)² ≤ r²`. Use a small tolerance `eps` at the boundary.

### J8. What's the time complexity of the naive approach?
The MEC is some pair-circle or triple-circle. Enumerating all `O(n³)` triples and checking each against all `n` points is `O(n⁴)`; a pruned version is `O(n³)`. Fine for tiny inputs, hopeless at scale.

### J9. Why compare squared distances instead of actual distances?
`sqrt` is expensive and the inside test runs in the hottest loop. Since both sides are non-negative and squaring preserves order, `dx²+dy² ≤ r²` gives the same answer as `dist ≤ r` without the `sqrt`.

### J10. What is the MEC of a single point? Of zero points?
A single point: that point with radius 0. Zero points: radius 0 by convention (or "undefined"). Handle these as explicit base cases so code doesn't crash.

### J11. Can a point strictly inside the set affect the MEC?
No — only boundary (support) points determine the circle. Interior points are irrelevant to its size. That's exactly why a fast algorithm is possible.

### J12. Name a real-world use of the MEC.
A game engine wraps a 3-D model in a bounding sphere for cheap collision pre-checks; a planner places one tower/facility to minimize the worst-case distance to any customer (the 1-center); clustering uses it to estimate a cluster's radius.

---

## Middle Questions (14 Q&A)

### M1. Describe Welzl's algorithm in one paragraph.
Shuffle the points, then add them one at a time, keeping the MEC of those seen so far. When a new point is already inside the current circle, do nothing. When it falls outside, it *must* be on the boundary of the new circle, so recompute the MEC of the earlier points with this point fixed on the boundary. The recursion bottoms out when the boundary set hits 3 points (a circumcircle) or the points run out. Expected time is `O(n)`.

### M2. Why must a point that falls outside the current circle be on the new boundary?
If it weren't on the boundary (i.e. strictly inside the new optimum), then removing it wouldn't change the optimum — but the old circle (which excluded it) would then already be optimal, contradicting that the point was outside. So it has to be a support point.

### M3. Why is Welzl's expected time O(n)?
At step `i`, the probability the `i`-th point (random order) is one of the ≤ 3 boundary points of the first `i` points is at most `3/i`. A rebuild costs `O(i)`. So expected work is `Σ (3/i)·O(i) = Σ O(3) = O(n)`. The `1/i` probability cancels the `O(i)` cost.

### M4. What is the move-to-front heuristic?
When a point is found outside, move it to the front of the list. Points that recently violated the circle tend to be near the boundary and likely to matter again, so trying them earlier settles the circle faster. It keeps expected `O(n)`, improves constants, and enables a clean iterative (non-recursive) implementation.

### M5. Why shuffle the input?
The expected-`O(n)` bound is over random orderings. Without shuffling, an adversarial or sorted input can drive the cost toward `O(n²)`. There is no bad *input* — only an unlikely bad *shuffle* — but only if you actually shuffle.

### M6. Is Welzl's result deterministic even though the algorithm is randomized?
Yes. The MEC is unique, so the *answer* is always the same; only the *runtime path* (and thus the speed) varies with the random order.

### M7. Why recurse no deeper than 3 boundary points?
Three boundary points already determine a circle uniquely (the circumcircle solves the 3 unknowns `cx, cy, r`). A 4th constraint would be redundant, so the recursion stops at `|R| = 3`.

### M8. When would you use the recursive vs iterative form?
Recursive is clearer for understanding but is `O(n)` deep and can overflow the stack for large `n`. The iterative move-to-front form is stack-safe and slightly faster — use it in production.

### M9. How do you handle the collinear case inside the circumcircle routine?
Detect it via the determinant `|d| < eps`. Then there's no finite circumcircle; return the diameter circle of the widest of the three pairs (the one that, being largest, encloses the third collinear point).

### M10. How would you test an MEC implementation?
Write the `O(n³)` brute force as an oracle and compare radii on thousands of random point sets within a tolerance. Also test degenerate inputs: all identical, all collinear, exactly 2 points, points on a perfect circle.

### M11. What's the relationship to the convex hull?
All MEC boundary points are convex-hull points, so you *could* compute the hull (`O(n log n)`) and run MEC on it. But Welzl is already `O(n)`, so this usually doesn't help — know the fact, don't over-engineer.

### M12. What is the LP-type framework, briefly?
An abstraction of linear programming covering many geometric optimizations (MEC, smallest ellipsoid, polytope distance) characterized by *monotonicity* and *locality*, with a *combinatorial dimension* = max basis size. MEC has combinatorial dimension 3, which is why Welzl's generic LP-type algorithm runs in `O(3!·n) = O(n)`.

### M13. How does the MEC behave with one far outlier?
The radius balloons to cover it — correct behavior for a min-max objective, but undesirable for noisy data. For robustness you'd use a `k`-enclosing variant (cover `n−k` points, dropping the `k` worst).

### M14. Compare Welzl to the naive method.
Naive enumerates all `O(n³)` triples (and pairs) and checks coverage — `O(n⁴)`/`O(n³)`. Welzl grows the answer incrementally and only rebuilds on the rare "outside" event, giving expected `O(n)`. Welzl is the default; naive is for teaching and as a correctness oracle.

### M15. What's the space complexity of Welzl?
`O(n)`: the recursive form's call stack is up to `n` deep, and you store the point array. The iterative move-to-front form uses `O(n)` for the array but only `O(1)` auxiliary state — no deep stack — which is why it's preferred for large inputs.

### M16. Can the MEC center fall outside the convex hull of the points?
No. The center is a convex combination of the support points (it lies in the convex hull of the ≤3 boundary points, which are hull vertices), so it is always inside the convex hull of the input.

---

## Senior Questions (12 Q&A)

### S1. How would you build bounding spheres for a physics engine at 60 fps?
Compute exact MEC once at load for static colliders. For dynamic/deforming meshes, use a cheaper approximation (Ritter, ~2 passes, within ~5–20% of optimal) or a conservative *refit* that only grows the sphere. Don't recompute exact MEC every frame for everything; amortize via a bounding-volume hierarchy.

### S2. Welzl vs Ritter for bounding spheres?
Both are `O(n)`, but Ritter has tiny constants and no degenerate-handling burden at the cost of a non-minimal (looser) sphere. Welzl gives the *tightest* sphere but with larger constants and float-robustness work. For per-frame dynamic objects, Ritter usually wins; for static, Welzl's tightness pays off.

### S3. How do you make MEC numerically robust?
Use a **relative** `eps` (scaled to coordinate magnitude), guard the collinear case in the circumcircle, **translate points to the centroid** before computing (avoids precision loss at large coordinates), deduplicate coincident points, and for certified use employ **exact predicates** (Shewchuk) for the in-circle test.

### S4. How does the problem change in 3-D and higher?
The boundary set grows to ≤ `d+1` points (≤ 4 in 3-D). Welzl still gives expected `O(n)` for fixed `d`, but the constant grows like `(d+1)!`, so it's practical only to ~10–20 dimensions. Beyond that, use `(1+ε)`-approximation.

### S5. How do you compute an approximate MEB in high dimensions?
Bădoiu–Clarkson: start at a point, repeatedly move the center a `1/(i+1)` step toward the farthest point. After `O(1/ε²)` iterations you have a `(1+ε)`-approximate ball, in `O(n d / ε²)` time — independent of the `(d+1)!` blowup. Equivalently, a **core-set** of only `O(1/ε)` points determines the approximate ball.

### S6. What is a core-set and why does it matter?
A small subset whose MEB `(1+ε)`-approximates the whole set's MEB, with size `O(1/ε)` **independent of `n` and `d`**. It's what makes high-dimensional and streaming MEB tractable: you summarize unbounded data with a constant-size sketch.

### S7. How would you maintain an enclosing ball over a data stream?
Keep a small `ε`-coreset and merge coresets hierarchically (merge-reduce), giving a `(1+ε)`-ball in bounded memory. A simpler online option: keep the current ball and expand minimally toward any arriving outside point (Ritter-style), which over-estimates but uses `O(1)` per point.

### S8. The MEC center is which facility-location objective?
The **1-center**: minimize the maximum distance to any demand point. Contrast with the geometric median (minimize sum of distances, Weiszfeld) and the centroid (minimize sum of squares).

### S9. How does k-center relate to MEC?
MEC is the exact `k = 1` case. General `k`-center (place `k` facilities, minimize max distance to nearest) is NP-hard; the standard 2-approximation is Gonzalez's farthest-point greedy.

### S10. What is the weighted 1-center?
Minimize `max w_i · dist(c, p_i)` — points have priorities/populations. Still LP-type, still expected `O(n)` (Megiddo). Used when some demand points matter more than others.

### S11. What's the "smallest enclosing ball of balls" and where is it used?
Enclose disks/spheres rather than points; each contributes the constraint `dist(c, c_i) + r_i ≤ r`. It's how a bounding-volume hierarchy merges two child spheres into the smallest parent sphere. Same LP-type machinery.

### S12. What metric pitfalls arise in facility location?
Euclidean MEC assumes straight-line distance. Real siting uses road networks, obstacles, or Manhattan/Chebyshev metrics. Euclidean MEC is a relaxation; you then snap to feasible nodes and re-optimize, or solve in the correct metric.

### S13. How would you monitor an MEC service in production?
Track the radius distribution (step changes signal upstream data corruption — MEC's outlier sensitivity becomes a free data-quality alarm), the degenerate-fallback rate (collinear/duplicate inputs), compute latency p99, and any `NaN`/`Inf` count. Sample 1% of requests and verify the approximate radius against exact to catch quality regressions.

### S14. On a sphere (geographic scale), is planar MEC valid?
No. For small regions it's a fine approximation, but at continental scale distance is geodesic. You either solve the smallest spherical cap directly or project to a locally-conformal metric CRS (e.g. UTM) first — never run MEC on raw lat/long degrees, whose scale is anisotropic.

---

## Professional Questions (8 Q&A)

### P1. State and prove the 2-or-3-points lemma.
The support set has size 2 (antipodal diameter) or is pinned by 3 points (circumcircle). Proof: at the optimal center, `0 ∈ conv{ (c*−p)/r* : p support }` (a point can't be moved to reduce the max distance). One support vector can't contain 0; two force antipodality; otherwise Carathéodory in `R²` says 0 is a combination of ≤ 3 vectors, so ≤ 3 points pin the circle.

### P2. Prove Welzl runs in expected O(n) (backwards analysis).
Fix `R` (size `j`). At step `i`, the second recursive call fires iff the `i`-th point (random order) is a support point of `MEC` of the first `i` points subject to `R` — at most `3−j` such points, so probability ≤ `(3−j)/i`. A rebuild costs `O(i)`. Expected cost `Σ ((3−j)/i)·O(i) = Σ O(3−j) = O(n)`. Summing the three levels keeps it `O(n)`.

### P3. Why is MEC unique?
If two distinct centers achieved the min radius `r*`, both disks enclose `P`, so `P` lies in their lens-shaped intersection, which fits inside a strictly smaller disk centered at the midpoint with radius `sqrt(r*² − d²/4) < r*` — contradicting minimality.

### P4. Explain MEC as an LP-type problem.
Constraints = points; value = MEC radius of a subset. **Monotonicity** (superset needs ≥ radius) and **locality** (a point violating the optimum of a set violates the equal-radius optimum of a subset) hold; combinatorial dimension = max basis size = 3 (the support set). This places MEC in the same family as LP, smallest ellipsoid, and polytope distance, and gives Welzl/Clarkson algorithms for free.

### P5. Sketch Megiddo's deterministic O(n) algorithm.
Prune-and-search: pair up points; for each pair, the optimum lies on one side of their perpendicular bisector; use a linear-time median of the bisector parameters to discard a constant fraction of points per `O(n)` round (each pruned pair has one provable non-support point). The geometric series `T(n) = T(cn) + O(n)` gives `O(n)`, deterministic and worst-case — but with large constants, so Welzl is faster in practice.

### P6. What is the lower bound, and why no `Ω(n log n)`?
`Ω(n)`: any algorithm reading `< n` points can be fooled by an unread outlier. Unlike closest-pair, MEC doesn't need to *order* points, only find ≤ 3 of them, so the algebraic-decision-tree `Ω(n log n)` argument doesn't apply. Both Welzl (expected) and Megiddo (worst case) match `Θ(n)`.

### P7. Why does the Welzl constant blow up as `(d+1)!` in high dimensions?
The combinatorial dimension (max basis / support size) is `d+1` in `R^d`, and the generic LP-type recursion's expected cost carries a factorial in the combinatorial dimension. So fixed-`d` linearity holds, but the constant is `(d+1)!` — prohibitive past `d ≈ 30`, motivating core-set approximation.

### P8. What is the core-set size bound for `(1+ε)`-MEB and why is it remarkable?
`O(1/ε)` (Bădoiu–Har-Peled–Indyk), **independent of `n` and `d`**. Remarkable because a constant-size subset captures the enclosing ball of arbitrarily many points in arbitrarily high dimensions — the foundation of scalable and streaming MEB.

### P9. State the optimality (KKT-like) condition at the MEC center.
`0 ∈ conv{ (c*−p)/r* : p is a support point }` — the zero vector lies in the convex hull of the unit vectors from the center to the boundary points. Geometrically, the support points "surround" the center so no movement direction reduces the maximum distance. This is the subgradient optimality condition for minimizing the convex max-of-distances function.

### P10. Why is insertion into a dynamic MEC easy but deletion hard?
Insertion: a new point is either inside (no change) or a support point (bounded rebuild) — expected `O(1)` amortized via Welzl. Deletion: removing a *support* point can change the entire basis and the optimum arbitrarily, so there's no cheap local fix; fully-dynamic MEC with sub-linear deletes is an open problem. A practical workaround is caching the ≤3-point basis and re-verifying in `O(n)` only when needed.

### P11. How does the in-circle predicate connect MEC to Delaunay triangulation?
Both rely on the same degree-4 in-circle determinant testing whether a point lies inside the circle through three others. Delaunay maximizes the minimum angle by flipping on this predicate; MEC's circumcircle base case evaluates the same geometry. Shewchuk's adaptive exact predicates make both numerically robust at near-float speed.

### P12. Sketch the Frank-Wolfe view of Bădoiu–Clarkson.
Minimizing the convex `f(c) = max_p ‖c−p‖²` by conditional-gradient steps: each iteration moves the center a `1/(i+1)` fraction toward the current farthest point (the linear-minimization oracle). After `O(1/ε²)` steps the radius is within `(1+ε)`, and the farthest points visited form the `O(1/ε)` core-set — all independent of dimension.

---

## Behavioral & System-Design Prompts

- *"Walk me through choosing exact vs approximate MEC for an ML anomaly-detection radius in 128-D."* — High `d` ⇒ Welzl's `(d+1)!` constant is impractical; use Bădoiu–Clarkson `(1+ε)` with a small core-set; discuss the `ε` vs latency trade-off.
- *"Your bounding spheres cause physics jitter on deforming meshes. Debug it."* — Exact MEC recomputed per frame is non-monotone (shrinks/grows); switch to conservative refit (grow-only) or Ritter; check degenerate `NaN`.
- *"A single GPS outlier blew up our coverage radius. Fix it."* — min-max sensitivity; move to `k`-enclosing (drop `k` outliers) or robust pre-filtering.
- *"Design a service that, given a region's customers, suggests one warehouse location."* — 1-center = MEC center; but discuss road-network vs Euclidean distance, weighting by demand, and snapping to feasible sites.

---

## Coding Challenge (3 Languages)

### Challenge: Smallest Enclosing Circle

> Given `n` points in the plane, return the center `(cx, cy)` and radius `r` of the minimum enclosing circle. Implement **move-to-front Welzl** in expected `O(n)`. Handle `n = 0` (radius 0), `n = 1`, collinear inputs, and duplicates. Match within `1e-6`.
>
> Example: points `[(0,0), (4,0), (2,3), (2,1)]` → center `(2.000, 0.833)`, radius `2.166`.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

type Point struct{ X, Y float64 }
type Circle struct {
	C Point
	R float64
}

const eps = 1e-9

func dist(a, b Point) float64 {
	return math.Hypot(a.X-b.X, a.Y-b.Y)
}
func inside(c Circle, p Point) bool { return dist(c.C, p) <= c.R+eps }

func from2(a, b Point) Circle {
	return Circle{Point{(a.X + b.X) / 2, (a.Y + b.Y) / 2}, dist(a, b) / 2}
}

func from3(a, b, c Point) Circle {
	d := 2 * (a.X*(b.Y-c.Y) + b.X*(c.Y-a.Y) + c.X*(a.Y-b.Y))
	if math.Abs(d) < eps {
		best := from2(a, b)
		for _, cc := range []Circle{from2(a, c), from2(b, c)} {
			if cc.R > best.R {
				best = cc
			}
		}
		return best
	}
	a2 := a.X*a.X + a.Y*a.Y
	b2 := b.X*b.X + b.Y*b.Y
	c2 := c.X*c.X + c.Y*c.Y
	ux := (a2*(b.Y-c.Y) + b2*(c.Y-a.Y) + c2*(a.Y-b.Y)) / d
	uy := (a2*(c.X-b.X) + b2*(a.X-c.X) + c2*(b.X-a.X)) / d
	center := Point{ux, uy}
	return Circle{center, dist(center, a)}
}

// SmallestEnclosingCircle: move-to-front Welzl, expected O(n).
func SmallestEnclosingCircle(pts []Point) Circle {
	p := append([]Point{}, pts...)
	rand.Shuffle(len(p), func(i, j int) { p[i], p[j] = p[j], p[i] })
	if len(p) == 0 {
		return Circle{}
	}
	c := Circle{p[0], 0}
	for i := 1; i < len(p); i++ {
		if inside(c, p[i]) {
			continue
		}
		c = Circle{p[i], 0}
		for j := 0; j < i; j++ {
			if inside(c, p[j]) {
				continue
			}
			c = from2(p[i], p[j])
			for k := 0; k < j; k++ {
				if inside(c, p[k]) {
					continue
				}
				c = from3(p[i], p[j], p[k])
			}
		}
	}
	return c
}

func main() {
	pts := []Point{{0, 0}, {4, 0}, {2, 3}, {2, 1}}
	c := SmallestEnclosingCircle(pts)
	fmt.Printf("center=(%.3f, %.3f) r=%.3f\n", c.C.X, c.C.Y, c.R)
	// center=(2.000, 0.833) r=2.166
}
```

#### Java

```java
import java.util.*;

public class SmallestEnclosingCircle {
    static final double EPS = 1e-9;
    record Point(double x, double y) {}
    record Circle(double cx, double cy, double r) {
        boolean contains(Point p) {
            return Math.hypot(p.x() - cx, p.y() - cy) <= r + EPS;
        }
    }

    static double dist(Point a, Point b) { return Math.hypot(a.x()-b.x(), a.y()-b.y()); }

    static Circle from2(Point a, Point b) {
        return new Circle((a.x()+b.x())/2, (a.y()+b.y())/2, dist(a, b)/2);
    }

    static Circle from3(Point a, Point b, Point c) {
        double d = 2 * (a.x()*(b.y()-c.y()) + b.x()*(c.y()-a.y()) + c.x()*(a.y()-b.y()));
        if (Math.abs(d) < EPS) {
            Circle best = from2(a, b);
            for (Circle cc : new Circle[]{from2(a, c), from2(b, c)})
                if (cc.r() > best.r()) best = cc;
            return best;
        }
        double a2 = a.x()*a.x()+a.y()*a.y(), b2 = b.x()*b.x()+b.y()*b.y(), c2 = c.x()*c.x()+c.y()*c.y();
        double ux = (a2*(b.y()-c.y()) + b2*(c.y()-a.y()) + c2*(a.y()-b.y())) / d;
        double uy = (a2*(c.x()-b.x()) + b2*(a.x()-c.x()) + c2*(b.x()-a.x())) / d;
        return new Circle(ux, uy, Math.hypot(ux-a.x(), uy-a.y()));
    }

    static Circle solve(Point[] input) {
        Point[] p = input.clone();
        Collections.shuffle(Arrays.asList(p));
        if (p.length == 0) return new Circle(0, 0, 0);
        Circle c = new Circle(p[0].x(), p[0].y(), 0);
        for (int i = 1; i < p.length; i++) {
            if (c.contains(p[i])) continue;
            c = new Circle(p[i].x(), p[i].y(), 0);
            for (int j = 0; j < i; j++) {
                if (c.contains(p[j])) continue;
                c = from2(p[i], p[j]);
                for (int k = 0; k < j; k++) {
                    if (c.contains(p[k])) continue;
                    c = from3(p[i], p[j], p[k]);
                }
            }
        }
        return c;
    }

    public static void main(String[] args) {
        Point[] pts = { new Point(0,0), new Point(4,0), new Point(2,3), new Point(2,1) };
        Circle c = solve(pts);
        System.out.printf("center=(%.3f, %.3f) r=%.3f%n", c.cx(), c.cy(), c.r());
        // center=(2.000, 0.833) r=2.166
    }
}
```

#### Python

```python
import math
import random

EPS = 1e-9


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def inside(circle, p):
    (cx, cy), r = circle
    return math.hypot(p[0] - cx, p[1] - cy) <= r + EPS


def from2(a, b):
    return (((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), dist(a, b) / 2)


def from3(a, b, c):
    d = 2 * (a[0]*(b[1]-c[1]) + b[0]*(c[1]-a[1]) + c[0]*(a[1]-b[1]))
    if abs(d) < EPS:
        return max((from2(a, b), from2(a, c), from2(b, c)), key=lambda cc: cc[1])
    a2, b2, c2 = (a[0]**2+a[1]**2), (b[0]**2+b[1]**2), (c[0]**2+c[1]**2)
    ux = (a2*(b[1]-c[1]) + b2*(c[1]-a[1]) + c2*(a[1]-b[1])) / d
    uy = (a2*(c[0]-b[0]) + b2*(a[0]-c[0]) + c2*(b[0]-a[0])) / d
    return ((ux, uy), dist((ux, uy), a))


def smallest_enclosing_circle(points):
    """Move-to-front Welzl, expected O(n)."""
    p = points[:]
    random.shuffle(p)
    if not p:
        return ((0.0, 0.0), 0.0)
    c = (p[0], 0.0)
    for i in range(1, len(p)):
        if inside(c, p[i]):
            continue
        c = (p[i], 0.0)
        for j in range(i):
            if inside(c, p[j]):
                continue
            c = from2(p[i], p[j])
            for k in range(j):
                if inside(c, p[k]):
                    continue
                c = from3(p[i], p[j], p[k])
    return c


if __name__ == "__main__":
    pts = [(0, 0), (4, 0), (2, 3), (2, 1)]
    (cx, cy), r = smallest_enclosing_circle(pts)
    print(f"center=({cx:.3f}, {cy:.3f}) r={r:.3f}")
    # center=(2.000, 0.833) r=2.166
```

**Follow-ups the interviewer may ask:**
- *"Prove your inner loops are expected `O(n)` total."* → backwards analysis, `3/i` rebuild probability.
- *"Why shuffle?"* → guards against adversarial order degrading to `O(n²)`.
- *"Make it deterministic worst-case `O(n)`."* → Megiddo's prune-and-search.
- *"Extend to 3-D bounding spheres."* → ≤ 4 support points; or Bădoiu–Clarkson for high `d`.
- *"How do you test it?"* → compare against the `O(n³)` brute force on random inputs within `1e-6`.

---

## Common Interview Pitfalls

| Pitfall | Why it loses points | Fix |
|---------|--------------------|-----|
| Using the centroid as the center | Centroid minimizes mean-square, not max distance | State the 1-center / min-max objective explicitly |
| Forgetting to shuffle | Reviewer asks "what's the worst case?" and you can't answer | Shuffle, and explain "no bad input, only a bad shuffle" |
| `<` instead of `≤ + eps` | Boundary points rejected → infinite expansion or wrong circle | Always compare with a tolerance |
| No collinear guard in `from3` | Divide-by-zero crash on a live demo | Check `|d| < eps`, fall back to widest pair |
| Claiming `O(n log n)` is the lower bound | Wrong — MEC is `Θ(n)` | MEC needs no ordering, so it beats the sorting floor |
| Recursing for huge `n` | Stack overflow | Use the iterative move-to-front form |
| Saying "4 or more points define it" | Misstates the lemma | It's always exactly 2 or 3 |

A strong candidate writes the iterative move-to-front version, shuffles, uses a tolerance, guards the collinear case, and can recite the `3/i` argument for expected `O(n)`. That combination — correct code plus the *why* — is what distinguishes a hire-level answer.

---

## Testing Snippet (validate any answer)

Whatever you implement, validating against the `O(n³)` brute force on random inputs catches almost every bug. Mention this proactively in interviews — it signals engineering maturity:

```python
import random

def agree(n=12, trials=2000):
    for _ in range(trials):
        pts = [(random.uniform(-50, 50), random.uniform(-50, 50)) for _ in range(n)]
        fast = smallest_enclosing_circle(pts)   # Welzl
        slow = brute_mec(pts)                    # O(n^3) oracle
        if abs(fast[1] - slow[1]) > 1e-6:
            return False, pts                    # found a counterexample
        # invariant: every point must be inside the returned circle
        for p in pts:
            if not inside(fast, p):
                return False, pts
    return True, None

# print(agree())  # -> (True, None)
```

Two invariants checked: (1) the radius matches the oracle within `1e-6`, and (2) every input point is genuinely enclosed. Run with degenerate seeds too (all collinear, all identical, exactly 2 points) to exercise the fallback paths.

---

## One-Sentence Summaries (rapid review)

- **What:** smallest circle covering all points; unique; the 1-center.
- **Key fact:** determined by 2 or 3 boundary points (the 2-or-3-points lemma).
- **Primitives:** diameter circle (2 points), circumcircle (3 points).
- **Algorithm:** Welzl — incremental, rebuild only on "outside," expected `O(n)`.
- **Why fast:** `Pr[rebuild at step i] ≤ 3/i`, cancelling the `O(i)` rebuild cost.
- **Refinement:** move-to-front — same bound, better constant, iterative.
- **Deterministic:** Megiddo's prune-and-search, worst-case `O(n)`.
- **Framework:** LP-type, combinatorial dimension 3 (`d+1` in `R^d`).
- **High dim:** Bădoiu–Clarkson `(1+ε)`, core-set size `O(1/ε)`.
- **Lower bound:** `Θ(n)` — no `n log n` barrier.

---

**Next step:** Continue to [`tasks.md`](./tasks.md) for graded practice problems (beginner, intermediate, advanced) in Go, Java, and Python.
