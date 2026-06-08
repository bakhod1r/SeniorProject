# Point-in-Polygon (PIP) — Interview Preparation

Point-in-polygon is the most-asked computational-geometry primitive in coding interviews, and it hides more depth than candidates expect. The `O(n)` ray-casting routine is short enough to whiteboard in two minutes, but the follow-ups — *why does odd-parity mean inside, how do you handle a vertex exactly on the ray, when do even-odd and winding disagree, how do you do it in `O(log n)` for a convex polygon, how do you scale to a million polygons* — are exactly where a candidate who memorized the snippet diverges from one who understands the geometry. This file is a curated, tiered question bank plus four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Problem | Is point `q` inside polygon `P`? | inside / outside / on-boundary |
| Default method | Ray casting (crossing number / even-odd) | shoot horizontal ray, count crossings |
| Verdict rule | **odd ⇒ inside, even ⇒ outside** | parity of crossings |
| Single-query time | **O(n)** | `n` = number of edges; worst-case optimal |
| Straddle test | `(ay > py) != (by > py)` | strict `>`, half-open, handles vertices + horizontals |
| Crossing-x | `ax + (py-ay)/(by-ay)*(bx-ax)` | count if `> px` |
| Winding number | signed count, **non-zero ⇒ inside** | direction-aware; Sunday's no-trig form |
| Even-odd vs winding | agree on simple polygons | differ on self-intersecting (pentagram center) |
| Convex polygon | **O(log n)** | binary search on the vertex fan |
| Many queries | trapezoidal map: O(log n) query, O(n) space, O(n log n) build | or slab: O(log n) query, O(n²) space |
| Many polygons | spatial index (grid/R-tree) → filter-and-refine | prune `m` polygons to `k` candidates |
| Key primitive | orientation / cross product `isLeft` | use exact predicates for robustness |

Skeleton (the version to write by default):

```text
inside = false
for each edge (a, b):                 # b is the previous vertex of a
    if (a.y > q.y) != (b.y > q.y):    # half-open straddle
        x = a.x + (q.y - a.y)/(b.y - a.y)*(b.x - a.x)
        if x > q.x:
            inside = not inside       # toggle parity
return inside
```

Mental anchor: **walk in from infinity; each edge you cross flips inside/outside — so parity is the answer.**

---

## Junior Questions (12 Q&A)

### J1. What is the point-in-polygon problem?
Given a polygon (an ordered list of vertices) and a query point, decide whether the point is inside the polygon, outside it, or exactly on its boundary. It powers map queries, hit-testing UI clicks, geofencing, and collision detection.

### J2. How does the ray-casting algorithm work?
Shoot a horizontal ray from the query point to the right and count how many polygon edges it crosses. If the count is **odd**, the point is inside; if **even** (including zero), it is outside. It runs in `O(n)` because you examine each edge once.

### J3. Why does odd parity mean "inside"?
Walk along the ray from infinity (definitely outside) back to the point. Each time you cross an edge you flip from outside to inside or back. An odd number of flips lands you inside; an even number returns you outside. So the parity of crossings equals the inside/outside state.

### J4. What is the time complexity of ray casting?
`O(n)` per query for a polygon with `n` edges — you test each edge once. It needs `O(1)` extra space. For a single query on an arbitrary polygon, this is worst-case optimal: you may have to look at every edge.

### J5. Does ray casting work on concave (non-convex) polygons?
Yes. The crossing-number rule does not assume convexity — it works on any simple polygon, dents and all. Convexity only matters if you want the faster `O(log n)` binary-search method.

### J6. Does the orientation (clockwise vs counter-clockwise) of the vertices matter?
For plain ray casting, no — the even-odd rule is orientation-independent. For the winding-number method and the convex binary-search method, orientation matters because they use signed (left/right) tests.

### J7. What is the straddle test and why `(ay > py) != (by > py)`?
It checks whether an edge spans the ray's height: one endpoint above `py` and the other at-or-below. Using strict `>` on both makes it a *half-open* test, so a vertex lying exactly at `py` is counted by exactly one of its two edges — preventing double-counting.

### J8. How do horizontal edges get handled?
A horizontal edge has `ay == by`, so `(ay > py) != (by > py)` is false — it contributes no crossing. That is correct (an edge parallel to the ray should not count), and it also means you never divide by `by - ay = 0`.

### J9. What happens for a point exactly on an edge?
The parity rule is ambiguous there — it is literally the dividing line. If your application needs a verdict, run an explicit on-segment check first (collinear via cross product, plus inside the edge's bounding box) and return a dedicated "boundary" result.

### J10. Why cast the ray to the right specifically?
Convention and simplicity — any fixed direction works. Rightward horizontal pairs naturally with the `x > px` crossing check. The half-open vertex rule handles the degenerate "ray through a vertex" case so you do not need to pick a random angle.

### J11. Do you count crossings or toggle a boolean?
Either works since you only need parity. Toggling a boolean (`inside = !inside`) is slightly faster and avoids a final `% 2`. A real counter is handy for debugging or visualization.

### J12. What is the closing edge and why do beginners forget it?
A polygon's edges include the segment from the last vertex back to the first. Beginners loop `i` from `0` to `n-2` and miss it. The fix: pair each vertex with the previous one (`j = n-1; for i: ...; j = i`) so the wrap-around edge is handled uniformly.

---

## Middle Questions (12 Q&A)

### M1. What is the winding number method?
Instead of counting crossings unsigned, you sum *signed* crossings: `+1` when an edge crosses the ray upward with the point on its left, `−1` when it crosses downward with the point on its right. The point is inside if the total (the winding number) is non-zero. It is `O(n)`, like ray casting, but direction-aware.

### M2. When do even-odd and winding-number rules disagree?
Only on **self-intersecting** polygons. For a simple polygon both agree everywhere. The classic example is a pentagram drawn as one self-crossing path: its central region is wound twice (`w = 2`), so the non-zero rule calls it inside while the even-odd rule (even crossings) calls it a hole/outside.

### M3. Which fill rules in SVG/PostScript correspond to these?
`fill-rule: evenodd` is the crossing-number/even-odd rule; `fill-rule: nonzero` is the winding-number rule. Non-zero is the more common default in rendering because it fills any wrapped region solid.

### M4. Why prefer Sunday's winding formula over summing `atan2` angles?
The `atan2` angle-sum is slow (trig per edge) and numerically fragile (accumulated float error near `0` vs `2π`). Sunday's version replaces trig with a cross-product sign test, so it is faster, integer-friendly, and far more robust — same `O(n)`.

### M5. How do you test a convex polygon in `O(log n)`?
Pick an anchor vertex `V0`; the other vertices form an angularly sorted fan. Binary-search for the wedge (triangle `V0 V_i V_{i+1}`) whose angular range contains the query, then do one orientation test against edge `V_i V_{i+1}`. Each step is a cross-product sign; total `O(log n)`. Requires a known-convex, consistently-oriented polygon.

### M6. What breaks if you use the convex method on a concave polygon?
The fan triangles from the anchor overlap or leave gaps, so the binary search isolates the wrong region and the final test is invalid. Always verify convexity first, or fall back to `O(n)` ray casting.

### M7. How do you handle a vertex exactly on the ray, rigorously?
The half-open straddle test `(ay > py) != (by > py)` is the practical fix. Formally it is what you get by applying *Simulation of Simplicity* — symbolically nudging the point infinitesimally so no vertex sits exactly on the ray — which guarantees each vertex is counted by exactly one incident edge.

### M8. Compare ray casting and winding for a single query.
Both are `O(n)` with near-identical constants. Ray casting adds a division per straddling edge; winding adds a cross product. Choose by *semantics* (even-odd vs non-zero fill, self-intersection handling), not micro-speed, for single queries.

### M9. How do you reject points quickly before the full test?
Bounding-box pre-check: if the point is outside the polygon's min/max box, return outside in `O(1)`. This is a big win when most queries are far outside, common in geofencing.

### M10. Is the winding-number sign meaningful?
Yes — its magnitude is how many times the boundary wraps the point, and its sign encodes net direction (CCW positive). For a simple polygon it is `+1` (CCW) or `−1` (CW) inside, `0` outside. For the non-zero rule you only test `!= 0`, so the sign does not change the verdict.

### M11. How do duplicate or zero-length edges affect the test?
A zero-length edge (`a == b`) never straddles (`ay == by`), so it is harmless to parity, but defensive code skips it. Collinear consecutive edges are fine for PIP and need no special handling, unlike convex-hull algorithms.

### M12. Why is the cross-product / `isLeft` primitive central?
It tells you which side of a directed edge the point is on (sign of a `2×2` determinant). The winding test, the convex binary search, and the on-edge boundary check all reduce to it — and making *it* exact/robust makes the whole PIP test robust.

---

## Senior Questions (10 Q&A)

### S1. How do you answer PIP against a million polygons per query?
Two-phase filter-and-refine. Build a spatial index (uniform grid, R-tree, or quadtree) over polygon bounding boxes; at query time, look up candidate polygons in `O(1)`/`O(log m)`, then run exact PIP only on the few survivors. This is how PostGIS `ST_Contains` works (GiST index, then exact predicate).

### S2. How do you accelerate many queries against one large polygon?
Preprocess it. **Slab decomposition** gives `O(log n)` queries but `O(n²)` space/build. **Trapezoidal maps** (Seidel) give `O(log n)` query, `O(n)` space, `O(n log n)` build, and index a whole planar subdivision — the production choice. For convex polygons, the `O(log n)` fan binary search needs only `O(n)` order info.

### S3. What is the trade-off between slab and trapezoidal decomposition?
Both query in `O(log n)`. Slab is deterministic but costs `O(n²)` space — fine for tiny polygons hit billions of times, infeasible for large ones. Trapezoidal maps cost `O(n)` space and `O(n log n)` randomized build and handle entire subdivisions, so they scale.

### S4. Why is floating-point robustness critical for adjacent regions?
A GPS point near a shared border between two adjacent polygons can be classified into both (double-claim) or neither (lost) due to rounding in the crossing/orientation math. That double-bills deliveries or drops geofence events. Fix with integer coordinates, exact predicates, and a deterministic boundary-ownership rule.

### S5. What is a deterministic boundary-ownership rule and why use it?
A global convention (e.g. a boundary point belongs to the polygon whose interior lies on a fixed side, like rasterization's top-left rule) so that *exactly one* of two adjacent polygons claims any boundary point. It guarantees a gap-free, overlap-free partition independent of float noise.

### S6. How do you make the orientation test robust?
Use Shewchuk's adaptive exact predicates: compute the determinant in double precision with an error bound; if the magnitude exceeds the bound the sign is certified, otherwise recompute at higher precision until the sign is determined. Fast in the common case, always correct. Or snap coordinates to integers so the test is exact integer arithmetic.

### S7. How does PIP relate to collision detection?
Identical structure: broad-phase (sweep-and-prune / BVH) prunes candidate pairs, narrow-phase runs exact containment/overlap tests. PIP is the 2D narrow-phase "is this point in this shape" primitive; the spatial index is the broad phase.

### S8. How does point-in-polygon generalize to 3D?
Point-in-polyhedron: shoot a ray and count how many triangular faces it pierces — odd means inside (face-parity, same Jordan logic). The crossing test becomes ray–triangle intersection; degeneracies (ray through a shared edge/vertex) are handled by ray perturbation or the **generalized winding number**, the 3D analog of the 2D winding number, robust even on non-watertight meshes.

### S9. What metrics would you monitor for a PIP service?
Query p99 latency, candidates-per-query (index quality), boundary-ambiguous rate, and especially **double-claim rate** (a point inside two disjoint adjacent polygons signals a robustness bug). Also index-rebuild duration and invalid-input (NaN/Inf) rate.

### S10. How do you handle GPS jitter on a fence boundary?
A point oscillating on a boundary (float noise + GPS error) can emit an enter/exit event storm. Add hysteresis/debouncing: require the point to be clearly inside/outside (beyond a margin or for several consecutive pings) before flipping the fence state.

---

## Professional Questions (8 Q&A)

### P1. Prove the crossing-number rule is correct.
The parity `cn(q, ρ) mod 2` is (a) independent of the general-position ray — rotating the ray changes `cn` only by even amounts across vertices/edges; (b) constant on each component of `ℝ² \ ∂P`; (c) flips across every single edge crossing; and (d) is `0` at infinity. Together these force exactly two regions — interior (`parity 1`) and exterior (`parity 0`) — which *is* the polygonal Jordan curve theorem, proving odd ⇒ inside.

### P2. State the relationship between crossing number and winding number.
`cn(q, ρ) ≡ w(q) (mod 2)` for any closed polygonal curve, because reducing the signed winding sum modulo 2 erases the `±` signs. Hence even-odd and non-zero rules agree exactly when `|w(q)| ∈ {0, 1}` — always true for simple polygons — and can differ only where `|w(q)| ≥ 2`.

### P3. Why is the half-open rule formally justified?
It is the closed-form of Edelsbrunner–Mücke's *Simulation of Simplicity*: symbolically perturbing the query point infinitesimally upward makes every vertex strictly above or below `py`, so the strict `>` assigns each on-ray vertex to exactly one edge and tilts horizontal edges to contribute no crossing. The algorithm computes the exact answer for a general-position polygon infinitesimally close to the input.

### P4. What is the lower bound for a single PIP query?
`Ω(n)`. An adversary can construct inputs where the answer depends on a single not-yet-examined edge, so any preprocessing-free algorithm must read `Ω(n)` edges in the worst case. Ray casting at `Θ(n)` is therefore optimal.

### P5. What is the lower bound for point location with preprocessing?
`Ω(log n)` query time in the comparison/algebraic-decision-tree model: a subdivision can encode a sorted set, so point location solves predecessor search, whose decision tree has height `≥ log₂(n+1)`. Trapezoidal maps and Kirkpatrick's hierarchy (`O(log n)` query, `O(n)` space) meet this bound.

### P6. What does Kirkpatrick's hierarchy achieve over trapezoidal maps?
The same optimal `O(log n)` query and `O(n)` space, but with *deterministic* `O(n)` preprocessing (via repeated removal of independent low-degree vertices and re-triangulation), versus the trapezoidal map's randomized `O(n log n)`. Trapezoidal maps win in practice for simplicity and generality across subdivisions.

### P7. Define the winding number via a contour integral.
`w(q) = (1/2π) ∮_{∂P} dθ`, the total angle the vector `(γ(t) − q)` sweeps as `γ` traverses the boundary once, divided by `2π`. It is an integer because `∂P` is closed. For a polygon it reduces to a sum of signed angles subtended by each edge at `q`, which Sunday's algorithm computes without trig using orientation signs.

### P8. How do you guarantee a consistent partition of the plane across many polygons?
Use exact orientation predicates (so signs never disagree near collinearity) plus a single global boundary-ownership convention. Then every point — interior or boundary — is assigned to exactly one region, yielding a partition with no overlaps and no gaps. This is the formal requirement behind senior-level "no double-claim".

---

## Behavioral / System-Design Prompts

- *"Design a geofencing service for a ride-share app handling 500k location pings/sec against 2M zones."* Discuss filter-and-refine, in-memory spatial index, lazy geometry loading, enter/exit hysteresis, robustness for shared borders, and capacity math.
- *"A customer reports being billed for two adjacent delivery zones at once."* Diagnose as a boundary double-claim from float rounding; propose integer coordinates + deterministic boundary ownership + exact predicates.
- *"How would you test a PIP implementation?"* Property-based tests (a point and its reflection across a known axis; points generated strictly inside via triangulation are always inside), boundary/vertex cases, self-intersecting polygons for even-odd vs winding, and cross-checking ray casting against winding number.

---

## Coding Challenge 1 — Ray-Casting PIP with Boundary

> Implement `classify(poly, q)` returning `"INSIDE"`, `"OUTSIDE"`, or `"BOUNDARY"`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

type Pt struct{ X, Y float64 }

const eps = 1e-9

func onSeg(p, a, b Pt) bool {
	cr := (b.X-a.X)*(p.Y-a.Y) - (b.Y-a.Y)*(p.X-a.X)
	if math.Abs(cr) > eps {
		return false
	}
	return p.X >= math.Min(a.X, b.X)-eps && p.X <= math.Max(a.X, b.X)+eps &&
		p.Y >= math.Min(a.Y, b.Y)-eps && p.Y <= math.Max(a.Y, b.Y)+eps
}

func classify(poly []Pt, q Pt) string {
	n := len(poly)
	for i := 0; i < n; i++ {
		if onSeg(q, poly[i], poly[(i+1)%n]) {
			return "BOUNDARY"
		}
	}
	in := false
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.Y > q.Y) != (b.Y > q.Y) {
			if a.X+(q.Y-a.Y)/(b.Y-a.Y)*(b.X-a.X) > q.X {
				in = !in
			}
		}
	}
	if in {
		return "INSIDE"
	}
	return "OUTSIDE"
}

func main() {
	sq := []Pt{{0, 0}, {4, 0}, {4, 4}, {0, 4}}
	fmt.Println(classify(sq, Pt{2, 2})) // INSIDE
	fmt.Println(classify(sq, Pt{5, 2})) // OUTSIDE
	fmt.Println(classify(sq, Pt{4, 2})) // BOUNDARY
}
```

#### Java

```java
public class Challenge1 {
    record Pt(double x, double y) {}
    static final double EPS = 1e-9;

    static boolean onSeg(Pt p, Pt a, Pt b) {
        double cr = (b.x()-a.x())*(p.y()-a.y()) - (b.y()-a.y())*(p.x()-a.x());
        if (Math.abs(cr) > EPS) return false;
        return p.x() >= Math.min(a.x(),b.x())-EPS && p.x() <= Math.max(a.x(),b.x())+EPS
            && p.y() >= Math.min(a.y(),b.y())-EPS && p.y() <= Math.max(a.y(),b.y())+EPS;
    }

    static String classify(Pt[] poly, Pt q) {
        int n = poly.length;
        for (int i = 0; i < n; i++)
            if (onSeg(q, poly[i], poly[(i+1)%n])) return "BOUNDARY";
        boolean in = false;
        for (int i = 0, j = n-1; i < n; j = i++) {
            Pt a = poly[i], b = poly[j];
            if ((a.y() > q.y()) != (b.y() > q.y())) {
                double x = a.x() + (q.y()-a.y())/(b.y()-a.y())*(b.x()-a.x());
                if (x > q.x()) in = !in;
            }
        }
        return in ? "INSIDE" : "OUTSIDE";
    }

    public static void main(String[] args) {
        Pt[] sq = { new Pt(0,0), new Pt(4,0), new Pt(4,4), new Pt(0,4) };
        System.out.println(classify(sq, new Pt(2,2))); // INSIDE
        System.out.println(classify(sq, new Pt(5,2))); // OUTSIDE
        System.out.println(classify(sq, new Pt(4,2))); // BOUNDARY
    }
}
```

#### Python

```python
EPS = 1e-9

def on_seg(p, a, b):
    cr = (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])
    if abs(cr) > EPS:
        return False
    return (min(a[0],b[0])-EPS <= p[0] <= max(a[0],b[0])+EPS and
            min(a[1],b[1])-EPS <= p[1] <= max(a[1],b[1])+EPS)

def classify(poly, q):
    n = len(poly)
    for i in range(n):
        if on_seg(q, poly[i], poly[(i+1)%n]):
            return "BOUNDARY"
    inside = False
    j = n-1
    for i in range(n):
        ax, ay = poly[i]; bx, by = poly[j]
        if (ay > q[1]) != (by > q[1]):
            if ax + (q[1]-ay)/(by-ay)*(bx-ax) > q[0]:
                inside = not inside
        j = i
    return "INSIDE" if inside else "OUTSIDE"

if __name__ == "__main__":
    sq = [(0,0),(4,0),(4,4),(0,4)]
    print(classify(sq, (2,2)))  # INSIDE
    print(classify(sq, (5,2)))  # OUTSIDE
    print(classify(sq, (4,2)))  # BOUNDARY
```

---

## Coding Challenge 2 — Winding Number (non-zero rule)

> Return `True` if `q` is inside under the non-zero rule. Works on self-intersecting polygons.

#### Go

```go
package main

import "fmt"

type P struct{ X, Y float64 }

func isLeft(a, b, p P) float64 {
	return (b.X-a.X)*(p.Y-a.Y) - (b.Y-a.Y)*(p.X-a.X)
}

func windingInside(poly []P, q P) bool {
	wn, n := 0, len(poly)
	for i := 0; i < n; i++ {
		a, b := poly[i], poly[(i+1)%n]
		if a.Y <= q.Y {
			if b.Y > q.Y && isLeft(a, b, q) > 0 {
				wn++
			}
		} else if b.Y <= q.Y && isLeft(a, b, q) < 0 {
			wn--
		}
	}
	return wn != 0
}

func main() {
	sq := []P{{0, 0}, {4, 0}, {4, 4}, {0, 4}}
	fmt.Println(windingInside(sq, P{2, 2})) // true
	fmt.Println(windingInside(sq, P{5, 5})) // false
}
```

#### Java

```java
public class Challenge2 {
    record P(double x, double y) {}
    static double isLeft(P a, P b, P p) {
        return (b.x()-a.x())*(p.y()-a.y()) - (b.y()-a.y())*(p.x()-a.x());
    }
    static boolean windingInside(P[] poly, P q) {
        int wn = 0, n = poly.length;
        for (int i = 0; i < n; i++) {
            P a = poly[i], b = poly[(i+1)%n];
            if (a.y() <= q.y()) {
                if (b.y() > q.y() && isLeft(a,b,q) > 0) wn++;
            } else if (b.y() <= q.y() && isLeft(a,b,q) < 0) wn--;
        }
        return wn != 0;
    }
    public static void main(String[] args) {
        P[] sq = { new P(0,0), new P(4,0), new P(4,4), new P(0,4) };
        System.out.println(windingInside(sq, new P(2,2))); // true
        System.out.println(windingInside(sq, new P(5,5))); // false
    }
}
```

#### Python

```python
def is_left(a, b, p):
    return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])

def winding_inside(poly, q):
    wn, n = 0, len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i+1)%n]
        if a[1] <= q[1]:
            if b[1] > q[1] and is_left(a, b, q) > 0:
                wn += 1
        elif b[1] <= q[1] and is_left(a, b, q) < 0:
            wn -= 1
    return wn != 0

if __name__ == "__main__":
    sq = [(0,0),(4,0),(4,4),(0,4)]
    print(winding_inside(sq, (2,2)))  # True
    print(winding_inside(sq, (5,5)))  # False
```

---

## Coding Challenge 3 — Convex Polygon in O(log n)

> Given a convex CCW polygon, test containment in `O(log n)`.

#### Go

```go
package main

import "fmt"

type Q struct{ X, Y float64 }

func cr(o, a, b Q) float64 {
	return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X)
}

func inConvex(poly []Q, q Q) bool {
	n := len(poly)
	if n < 3 || cr(poly[0], poly[1], q) < 0 || cr(poly[0], poly[n-1], q) > 0 {
		return false
	}
	lo, hi := 1, n-1
	for hi-lo > 1 {
		m := (lo + hi) / 2
		if cr(poly[0], poly[m], q) >= 0 {
			lo = m
		} else {
			hi = m
		}
	}
	return cr(poly[lo], poly[hi], q) >= 0
}

func main() {
	poly := []Q{{0, 0}, {4, 0}, {5, 3}, {2, 5}, {-1, 3}}
	fmt.Println(inConvex(poly, Q{2, 2})) // true
	fmt.Println(inConvex(poly, Q{9, 9})) // false
}
```

#### Java

```java
public class Challenge3 {
    record Q(double x, double y) {}
    static double cr(Q o, Q a, Q b) {
        return (a.x()-o.x())*(b.y()-o.y()) - (a.y()-o.y())*(b.x()-o.x());
    }
    static boolean inConvex(Q[] poly, Q q) {
        int n = poly.length;
        if (n < 3 || cr(poly[0],poly[1],q) < 0 || cr(poly[0],poly[n-1],q) > 0) return false;
        int lo = 1, hi = n-1;
        while (hi - lo > 1) {
            int m = (lo + hi) / 2;
            if (cr(poly[0], poly[m], q) >= 0) lo = m; else hi = m;
        }
        return cr(poly[lo], poly[hi], q) >= 0;
    }
    public static void main(String[] args) {
        Q[] poly = { new Q(0,0), new Q(4,0), new Q(5,3), new Q(2,5), new Q(-1,3) };
        System.out.println(inConvex(poly, new Q(2,2))); // true
        System.out.println(inConvex(poly, new Q(9,9))); // false
    }
}
```

#### Python

```python
def cr(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])

def in_convex(poly, q):
    n = len(poly)
    if n < 3 or cr(poly[0],poly[1],q) < 0 or cr(poly[0],poly[-1],q) > 0:
        return False
    lo, hi = 1, n-1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if cr(poly[0], poly[m], q) >= 0:
            lo = m
        else:
            hi = m
    return cr(poly[lo], poly[hi], q) >= 0

if __name__ == "__main__":
    poly = [(0,0),(4,0),(5,3),(2,5),(-1,3)]
    print(in_convex(poly, (2,2)))  # True
    print(in_convex(poly, (9,9)))  # False
```

---

## Coding Challenge 4 — Batch Queries with a Bounding-Box Filter

> Given a polygon and many query points, return how many are inside. Reject via bbox first.

#### Go

```go
package main

import "fmt"

type V struct{ X, Y float64 }

func ray(poly []V, q V) bool {
	in, n := false, len(poly)
	for i, j := 0, len(poly)-1; i < n; j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.Y > q.Y) != (b.Y > q.Y) && a.X+(q.Y-a.Y)/(b.Y-a.Y)*(b.X-a.X) > q.X {
			in = !in
		}
	}
	return in
}

func countInside(poly []V, qs []V) int {
	mnx, mny, mxx, mxy := 1e18, 1e18, -1e18, -1e18
	for _, p := range poly {
		if p.X < mnx { mnx = p.X }
		if p.X > mxx { mxx = p.X }
		if p.Y < mny { mny = p.Y }
		if p.Y > mxy { mxy = p.Y }
	}
	c := 0
	for _, q := range qs {
		if q.X < mnx || q.X > mxx || q.Y < mny || q.Y > mxy {
			continue
		}
		if ray(poly, q) {
			c++
		}
	}
	return c
}

func main() {
	poly := []V{{0, 0}, {6, 0}, {6, 6}, {0, 6}}
	qs := []V{{1, 1}, {3, 3}, {7, 7}, {5, 5}, {-1, 2}}
	fmt.Println(countInside(poly, qs)) // 3
}
```

#### Java

```java
public class Challenge4 {
    record V(double x, double y) {}
    static boolean ray(V[] poly, V q) {
        boolean in = false; int n = poly.length;
        for (int i = 0, j = n-1; i < n; j = i++) {
            V a = poly[i], b = poly[j];
            if ((a.y() > q.y()) != (b.y() > q.y()) &&
                a.x() + (q.y()-a.y())/(b.y()-a.y())*(b.x()-a.x()) > q.x()) in = !in;
        }
        return in;
    }
    static int countInside(V[] poly, V[] qs) {
        double mnx=1e18, mny=1e18, mxx=-1e18, mxy=-1e18;
        for (V p : poly) {
            mnx=Math.min(mnx,p.x()); mxx=Math.max(mxx,p.x());
            mny=Math.min(mny,p.y()); mxy=Math.max(mxy,p.y());
        }
        int c = 0;
        for (V q : qs) {
            if (q.x()<mnx||q.x()>mxx||q.y()<mny||q.y()>mxy) continue;
            if (ray(poly, q)) c++;
        }
        return c;
    }
    public static void main(String[] args) {
        V[] poly = { new V(0,0), new V(6,0), new V(6,6), new V(0,6) };
        V[] qs = { new V(1,1), new V(3,3), new V(7,7), new V(5,5), new V(-1,2) };
        System.out.println(countInside(poly, qs)); // 3
    }
}
```

#### Python

```python
def ray(poly, q):
    inside, n, j = False, len(poly), len(poly)-1
    for i in range(n):
        ax, ay = poly[i]; bx, by = poly[j]
        if (ay > q[1]) != (by > q[1]):
            if ax + (q[1]-ay)/(by-ay)*(bx-ax) > q[0]:
                inside = not inside
        j = i
    return inside

def count_inside(poly, qs):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    mnx, mxx, mny, mxy = min(xs), max(xs), min(ys), max(ys)
    c = 0
    for q in qs:
        if q[0] < mnx or q[0] > mxx or q[1] < mny or q[1] > mxy:
            continue
        if ray(poly, q):
            c += 1
    return c

if __name__ == "__main__":
    poly = [(0,0),(6,0),(6,6),(0,6)]
    qs = [(1,1),(3,3),(7,7),(5,5),(-1,2)]
    print(count_inside(poly, qs))  # 3
```

**Run:** `go run main.go` | `javac File.java && java File` | `python file.py`

---

## Final Tips

- Default to ray casting; reach for winding number when the polygon may self-intersect or you need non-zero fill.
- Always state the straddle test as `(ay > py) != (by > py)` and explain the half-open rationale unprompted — it signals you understand the degeneracies.
- Mention the bounding-box pre-filter and the convex `O(log n)` optimization as natural follow-ups.
- For scale questions, structure the answer as filter-and-refine (spatial index) + per-polygon decomposition + robustness, in that order.
- If asked about correctness, anchor on the Jordan-curve "walk in from infinity, each crossing flips state" argument.
