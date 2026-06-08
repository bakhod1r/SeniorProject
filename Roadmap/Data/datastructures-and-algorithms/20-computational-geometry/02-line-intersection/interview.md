# Line and Segment Intersection — Interview Preparation

Segment intersection is the most-asked computational-geometry primitive in interviews. It is short enough to derive on a whiteboard, it underpins a whole family of problems (rectangle overlap, polygon clipping, point-in-polygon via ray casting, the sweep line), and it has a handful of gotchas — the collinear cases, the parallel/coincident split, integer overflow, and the float-vs-exact trade-off — that separate a candidate who memorized a snippet from one who understands *why* the cross product is the right tool. This file is a curated bank sorted by seniority, plus behavioral/system-design prompts and an end-to-end coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Core primitive | **Orientation** `Orient(a,b,c)=(b−a)×(c−a)` | sign = left(+) / right(−) / collinear(0) |
| Cross product (2-D) | `u×v = u_x v_y − u_y v_x` | a scalar; no division |
| Proper crossing | `o1≠o2 AND o3≠o4` | each segment straddles the other's line |
| Boundary cases | any `oᵢ==0` + on-segment | endpoint touch / T-junction |
| Collinear overlap | all four `==0` | 1-D interval overlap on dominant axis |
| Intersection point | `t = (e×d₂)/(d₁×d₂)`, `point = p₁+t·d₁` | `e = p₃−p₁` |
| Parallel flag | `d₁×d₂ == 0` (denominator 0) | parallel or coincident |
| Decision exactness | integer ⇒ exact, no division | overflow needs ≥ `2b+3` bits |
| All-pairs | `O(n²)` brute, `O((n+k) log n)` sweep | output-sensitive → `05-sweep-line` |

Skeleton (the version to write by default):

```text
cross(a,b,c) = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)
o1,o2 = sign cross(p1,p2,p3), sign cross(p1,p2,p4)
o3,o4 = sign cross(p3,p4,p1), sign cross(p3,p4,p2)
if o1!=o2 and o3!=o4: return true                  # proper crossing
for each oi==0: if endpoint on the other segment: return true   # boundary
return false
```

Mental anchor: **the orientation test is geometry's comparison operator** — sorting needs only "a<b?", intersection needs only "left or right of this line?".

---

## Junior Questions (14 Q&A)

### J1. What does the 2-D cross product compute, and why do we only use its sign?
For vectors `u, v`, `u×v = u_x v_y − u_y v_x`. Its magnitude is twice the signed area of the triangle they span; its **sign** tells you whether `v` is counter-clockwise (+) or clockwise (−) from `u`. For intersection we only need the sign — left, right, or collinear — so we never divide and the answer is exact with integers.

### J2. How does the orientation test decide which side of a line a point is on?
`Orient(a,b,c) = (b−a)×(c−a)`. Walking along the directed line `a→b`, the sign tells you whether `c` is to your left (`+`, CCW), right (`−`, CW), or exactly on the line (`0`). It is one cross product — three multiplies and a subtraction.

### J3. State the rule for two segments properly crossing.
Each segment must straddle the other's supporting line: `p₃` and `p₄` on opposite sides of line `p₁p₂`, and `p₁` and `p₂` on opposite sides of line `p₃p₄`. In code: `o1 != o2 && o3 != o4`, where the four `o`s are the orientations of each endpoint against the other segment.

### J4. Why doesn't the four-orientation rule alone always work?
It misses cases where an orientation is exactly `0`, i.e. an endpoint lies *on* the other segment's line (endpoint touch, T-junction, or full collinear overlap). You add an **on-segment** check: if `oᵢ == 0` and that endpoint is within the other segment's bounding box, they intersect.

### J5. How do you check whether a collinear point lies on a segment?
Once you know the point is collinear with the segment (cross product `0`), test that its `x` is between the endpoints' `x`s and its `y` between their `y`s: `min(ax,bx) ≤ px ≤ max(ax,bx)` and likewise for `y`. No division needed.

### J6. Why avoid slope (`y = mx + b`) for intersection?
Vertical lines have infinite slope, parallel lines make you divide by zero, and slope comparisons reintroduce floating point. The cross-product approach handles every orientation uniformly with no division.

### J7. What's the time complexity of testing one pair of segments?
`O(1)` — a fixed number of cross products and comparisons. The interesting complexity is the *many-segment* problem, which the sweep line addresses.

### J8. What's the bounding-box pre-check and why use it?
If the two segments' axis-aligned bounding boxes don't overlap, they can't intersect — four comparisons reject the pair before any orientation math. It's the cheap broad-phase filter that makes brute-force all-pairs bearable.

### J9. With integer coordinates, is the yes/no test exact?
Yes — it uses only multiplication and subtraction, no division, so there is no round-off. The only caveat is **overflow**: products of large coordinates can exceed 32-bit range, so use 64-bit (or wider) accumulators.

### J10. What does it mean when the intersection denominator is zero?
The two direction vectors are parallel (`d₁×d₂ = 0`), so the lines are parallel or coincident and there is no single intersection point. You must check this *before* dividing to find the point.

### J11. Does a shared endpoint count as an intersection?
Mathematically the segments share that point, so by the on-segment rule it counts. Whether your application *reports* it is a policy decision you should make explicitly and document.

### J12. How do you find the actual intersection point once you know they cross?
Solve `p₁ + t·d₁ = p₃ + u·d₂` for `t` via Cramer's rule: `t = (e×d₂)/(d₁×d₂)` with `e = p₃−p₁`, then the point is `p₁ + t·d₁`. This is the one place division enters.

### J13. What are the four canonical cases you should always test?
Proper crossing (the X), endpoint touch / T-junction, collinear overlap, and disjoint. Any correct implementation gets all four right.

### J14. Where does segment intersection show up in real software?
Game collision (does the bullet path hit a wall?), GIS map overlay (combining two vector layers), CAD touch detection, robot motion planning, and polygon clipping.

---

## Middle Questions (12 Q&A)

### M1. Derive the intersection point from the parametric form.
Set `p₁ + t·d₁ = p₃ + u·d₂` with `d₁=p₂−p₁`, `d₂=p₄−p₃`. This is two scalar equations in `t,u`. The determinant is `d₁×d₂`; by Cramer's rule `t = ((p₃−p₁)×d₂)/(d₁×d₂)` and `u = ((p₃−p₁)×d₁)/(d₁×d₂)`. The segments cross iff `0≤t≤1` and `0≤u≤1`.

### M2. How do you distinguish parallel from coincident lines?
Both have `d₁×d₂ = 0`. To split: test whether `p₃` lies on line `p₁p₂`, i.e. `cross(d₁, p₃−p₁) == 0`. If yes the lines coincide (collinear) — do an interval-overlap test; if no, they are strictly parallel with no intersection.

### M3. Give the three representations of a line and when each is best.
Two-point (`P,Q`) — natural for segments/polygons. Point-direction (`P,d`) — natural for rays and motion. Implicit `ax+by=c` — natural for half-planes, clipping, and distance formulas. The implicit normal `(a,b)` and the cross-product sign are the same orientation information.

### M4. Convert two points to implicit form and explain the normal.
`a = Q_y−P_y`, `b = P_x−Q_x`, `c = a·P_x + b·P_y`. The vector `(a,b)` is normal to the line; `a·X+b·Y−c` is proportional to the signed distance of `(X,Y)` from the line, and its sign equals the orientation of `(X,Y)` relative to `P→Q`.

### M5. How do you compute point-to-line and point-to-segment distance?
Point to line: `|cross(A,B,P)| / |B−A|` — area over base = height. Point to segment: project `P` onto the line with `t = dot(P−A,B−A)/dot(B−A,B−A)`, **clamp** `t` to `[0,1]`, then distance to `A + t(B−A)`. The clamp is what makes it a *segment* distance, not a line distance.

### M6. Why "decide with integers, locate with floats"?
The crossing *decision* is a degree-2 determinant — exact in integers, no round-off. The intersection *coordinate* requires division and is inherently fractional. Separating them keeps the fragile part (the decision) exact and confines floating point to the unavoidable coordinate.

### M7. How do you handle collinear overlap correctly?
When all four orientations are `0`, project both segments onto the dominant axis (x unless the line is vertical, then y), sort each into an interval, and intersect the intervals. Empty ⇒ disjoint; a single point ⇒ they touch; a range ⇒ they share a sub-segment.

### M8. What's the difference between ray-segment and segment-segment intersection?
Same math, but the ray has `t ≥ 0` with no upper bound instead of `t ∈ [0,1]`. Ray casting (used in point-in-polygon) counts how many polygon edges a ray crosses.

### M9. When is `O(n²)` brute force actually the right choice?
When `n` is small (constant factors dominate) or when the output `k` is near `n²` (almost everything crosses) so the sweep line's `log n` factor only adds overhead. The sweep wins when intersections are *sparse*.

### M10. How would you choose an epsilon for float comparisons?
Tie it to the coordinate magnitude and the operation's degree — a fixed absolute epsilon mis-classifies both large and tiny coordinates. Better: use a relative/scaled epsilon, or avoid the problem with integer or adaptive-exact predicates.

### M11. Two segments share exactly one endpoint and are collinear — what happens?
All orientations are `0`; the interval overlap is a single point. Report it as a "touch," distinct from a proper crossing or a range overlap.

### M12. How do you avoid recomputing work when you need both the decision and the point?
The orientation cross products and the intersection denominator are the same primitives — compute the four orientations to decide, and reuse `d₁×d₂` as the denominator for the point. Don't run two separate passes.

### M13. Two rectangles — do they overlap? How does this relate?
Axis-aligned rectangle overlap is a pure interval test per axis (no cross product needed). *Rotated* rectangle (or general convex polygon) overlap uses the Separating Axis Theorem: project both onto each edge normal; they overlap iff the projections overlap on every axis. The per-edge "which side" test is again an orientation predicate.

### M14. How would you find where a segment exits a rectangle (clipping)?
Cohen–Sutherland or Liang–Barsky clipping. Liang–Barsky is parametric: for each of the four rectangle edges, compute the `t` at which the segment crosses it, then intersect the `[t_enter, t_exit]` interval. It's the parametric intersection idea applied four times — no division until the final point.

### M15. What's the winding-number method and how does it use orientation?
For point-in-polygon, the winding number sums the signed angle subtended by each edge as seen from the point — equivalently, it counts signed orientation crossings of a ray. A nonzero winding number means inside. It's more robust than even-odd ray casting for self-intersecting polygons, and each step is an orientation sign.

---

## Senior Questions (8 Q&A)

### S1. Design the intersection stage of a GIS map-overlay engine.
Broad phase: build an STR-tree / R-tree (or snapped uniform grid) over one layer; query each segment of the other layer by bounding box to get candidates. Narrow phase: run an exact (snap-rounded integer or adaptive-exact) predicate on candidates. Emit intersection *events* into a stream the arrangement/topology builder consumes. Exactness is mandatory because an inconsistent predicate produces non-planar output that breaks polygon reconstruction.

### S2. Why is exactness a correctness (not performance) requirement at scale?
A float predicate that flips sign near zero gives inconsistent answers — A crosses B, B is on line C, but the recomputed vertex says otherwise — violating planarity. Downstream code that walks the arrangement then loops forever or emits slivers. Exact predicates guarantee a consistent, valid topology.

### S3. Float vs exact-integer vs adaptive-exact vs rational — when each?
Float+epsilon for real-time collision (speed wins, small error invisible). Exact integer for snapped/bounded data (CP, snapped GIS). Adaptive-exact (Shewchuk/CGAL) for continuous coordinates needing both speed and guaranteed correctness. Rational (`big.Rat`) for CAD/symbolic where coordinates are unbounded and a wrong sign corrupts the model.

### S4. Batch all-pairs vs sweep line — how do you decide?
The sweep is output-sensitive: `O((n+k) log n)`. If `k` is small relative to `n²` (sparse intersections), the sweep wins. If `k ≈ n²` (dense), the `log n` factor makes brute force better. Also consider dynamics: a spatial-index batch handles moving/changing data better than a one-shot sweep.

### S5. How do you parallelize intersection?
Pairwise tests are embarrassingly parallel and read-only: build the index once, make it immutable, partition candidate *pairs* (not segments) across workers, collect per-worker lists, merge. The sweep line itself is sequential (event order); parallelize it across spatial strips and stitch boundaries.

### S6. What's the broad-phase blowup failure and how do you fix it?
A few very long segments span the whole grid, landing in every cell, restoring `O(n²)`. Fix by splitting long segments, or using a hierarchical index (R-tree/quadtree) that adapts to segment length instead of a flat grid.

### S7. Robotics inverts the trade-off — explain.
A missed collision (false negative) can crash a robot; a false positive only makes it cautious. So planners *inflate* obstacles (Minkowski sum with the robot radius) and use conservative predicates biased toward "collision." Intersection is deliberately pessimistic.

### S8. What's snap-rounding and what does it buy you?
Quantize all coordinates to a fixed integer grid at ingest. Intersections compute exactly in integers, results snap back to grid points. You trade a bounded, known geometric perturbation for guaranteed topological consistency — used by GEOS OverlayNG.

---

## Professional Questions (6 Q&A)

### P1. Prove the straddle lemma underlying the crossing predicate.
Define `f(c) = Orient(p₁,p₂,c)/|p₂−p₁|`, the signed distance of `c` from the oriented line. `f` is affine, positive on one open half-plane, negative on the other, zero on the line. Since `|p₂−p₁|>0`, `sign f(c)=sign Orient(p₁,p₂,c)`. Hence `p₃,p₄` are strictly on opposite sides iff `o1,o2` differ in sign. Apply symmetrically for the other segment; both straddles ⇒ unique interior crossing. (Full proof in `professional.md` §3.)

### P2. Why does the integer orientation predicate overflow `int64`, and when is it safe?
For coordinates in `[−2^b,2^b]`, differences are `b+1` bits, products `2b+2` bits, and the determinant `2b+3` bits. For 32-bit coords (`b=31`) that's 65 bits — overflows `int64`, needs 128-bit. For `b≤30`, 63 bits fit. So "int64 is exact" holds only when `2b+3 ≤ 63`, i.e. coordinates up to ~`2^30`.

### P3. How do adaptive exact predicates achieve float speed with guaranteed correctness?
Compute the determinant and a certified forward-error bound `E = O(ε·(|t₁|+|t₂|))` in fast float. If `|result| > E`, the sign is certified — return it (the common case). Otherwise recompute incrementally with error-free transformations (TwoSum/TwoProduct), tightening `E`, up to exact arithmetic. Almost all inputs stop at the first step, so it's near-float speed yet always exact (Shewchuk 1997).

### P4. What is Simulation of Simplicity and what does it guarantee?
A symbolic infinitesimal perturbation of each coordinate by distinct powers of `ε`. Degenerate predicates (exact zero) become polynomials in `ε`; their sign is the sign of the lowest-order nonzero term — always determinate. Guarantees: every predicate returns ±1 (never 0, so case analysis is total and topology stays valid), and on non-degenerate input the answer is unchanged. Zero extra cost when non-degenerate.

### P5. State the complexity bounds for reporting all intersections.
Brute force `O(n²)`. Bentley-Ottmann `O((n+k) log n)`, `O(n)` space, output-sensitive. Chazelle-Edelsbrunner / Balaban `O(n log n + k)`, optimal. Lower bound `Ω(n log n + k)`: `Ω(k)` to output, `Ω(n log n)` by reduction from element distinctness in the algebraic decision-tree model.

### P6. Why is only the final division inexact in the point computation?
By Cramer's rule the determinant (decision) and the numerators are degree-2 polynomials in the integer inputs — exactly evaluable. The coordinate is their quotient, a rational. So every *decision* is exact and round-off is confined to the single final division — the formal basis for "decide exactly, locate approximately" (CGAL's exact-predicates / inexact-constructions kernel).

### P7. What is the condition number of the intersection point, and what does it mean geometrically?
The point is `numerator/det` with `det = |d₁||d₂| sin θ`, `θ` the angle between the lines. So sensitivity `∝ 1/|sin θ|`: as lines approach parallel, `det → 0` and the point becomes ill-conditioned — it shoots off toward infinity, and tiny input changes move it enormously. This is unavoidable in any arithmetic (even exact rationals give correct-but-huge coordinates); the practical fix is to treat `|det|` below a threshold as parallel.

### P8. Prove the on-segment predicate is exact and equivalent to t ∈ [0,1].
For a collinear point `c = a + t(b−a)`, the bounding-box condition `min(a_x,b_x) ≤ c_x ≤ max(a_x,b_x)` on the non-constant axis is equivalent to `0 ≤ t ≤ 1`; the other axis is consistent by collinearity. If `a_x = b_x` (vertical), the y-condition decides. The predicate uses only comparisons — no arithmetic — so it is exact for any coordinate type.

### P9. Derive the size of the arrangement of n segments with k crossings.
By Euler's formula on the induced planar graph: `V = 2n + k`, `E = n + 2k` (each crossing splits two edges), `F = E − V + 2 = k − n + 2`. Total features `Θ(n + k)`, so building the arrangement needs `Ω(n + k)` time/space — the output-sensitive floor the optimal algorithms meet.

### P10. When does randomized incremental construction beat the sweep line?
RIC achieves the same optimal `O(n log n + k)` *expected* time, is simpler to make robust (fewer ordered comparisons that can go wrong numerically), and gives an incremental/online structure plus trapezoidal point location for free. The sweep is deterministic and slightly simpler to reason about for the pure reporting problem. Both consume the identical orientation/intersection predicates.

---

## Behavioral & System-Design Prompts

- *"Tell me about a time a floating-point bug bit you."* Frame the near-zero sign-flip problem and how you moved the decision to integers or an exact predicate.
- *"How would you design a collision system for a 60 fps game?"* Broad phase (grid/BVH/sweep-and-prune exploiting temporal coherence) + narrow phase (float predicate + epsilon); 16 ms budget.
- *"A map overlay produces sliver polygons. Diagnose."* Predicate inconsistency → non-planar arrangement; fix with snap-rounding or exact predicates; add a topology-repair count metric.
- *"You must choose between exact and fast. Walk me through the decision."* Tie to domain: real-time vs CAD vs GIS; the float / int / adaptive-exact / rational ladder.

---

## Coding Challenge (3 Languages)

### Challenge: Segment Intersection with Point

> Given two segments by their endpoints, return one of:
> - `"none"` — they do not intersect,
> - `"point x y"` — they cross (or touch) at a single point,
> - `"overlap"` — they are collinear and share more than one point.
>
> Use integer coordinates for the *decision* (exact) and compute the point as a reduced fraction so the output is exact. Handle proper crossings, endpoint touches, collinear overlap, parallel, and disjoint.
>
> **Examples:**
> `(1,1)-(4,4)` × `(1,4)-(4,1)` → `point 5/2 5/2`
> `(0,0)-(2,0)` × `(3,0)-(5,0)` → `none` (collinear, disjoint)
> `(0,0)-(4,0)` × `(2,0)-(6,0)` → `overlap`
> `(0,0)-(1,1)` × `(0,1)-(1,2)` → `none` (parallel)

#### Go

```go
package main

import "fmt"

type P struct{ X, Y int64 }

func cross(o, a, b P) int64 {
	return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X)
}
func sgn(v int64) int {
	if v > 0 { return 1 }
	if v < 0 { return -1 }
	return 0
}
func onSeg(a, b, p P) bool {
	return min(a.X, b.X) <= p.X && p.X <= max(a.X, b.X) &&
		min(a.Y, b.Y) <= p.Y && p.Y <= max(a.Y, b.Y)
}
func gcd(a, b int64) int64 {
	if a < 0 { a = -a }
	if b < 0 { b = -b }
	for b != 0 { a, b = b, a%b }
	return a
}
func frac(n, d int64) string {
	if d < 0 { n, d = -n, -d }
	g := gcd(n, d)
	if g == 0 { g = 1 }
	n, d = n/g, d/g
	if d == 1 { return fmt.Sprintf("%d", n) }
	return fmt.Sprintf("%d/%d", n, d)
}

func solve(p1, p2, p3, p4 P) string {
	d1 := P{p2.X - p1.X, p2.Y - p1.Y}
	d2 := P{p4.X - p3.X, p4.Y - p3.Y}
	den := d1.X*d2.Y - d1.Y*d2.X
	if den == 0 {
		// Parallel or collinear.
		if cross(p1, p2, p3) != 0 {
			return "none"
		}
		// Collinear: project onto dominant axis.
		key := func(p P) int64 { if d1.X != 0 { return p.X }; return p.Y }
		lo := func(a, b int64) int64 { if a < b { return a }; return b }
		hi := func(a, b int64) int64 { if a > b { return a }; return b }
		l := hi(lo(key(p1), key(p2)), lo(key(p3), key(p4)))
		h := lo(hi(key(p1), key(p2)), hi(key(p3), key(p4)))
		if l > h { return "none" }
		if l == h {
			// single shared point — find it among endpoints
			for _, p := range []P{p1, p2, p3, p4} {
				if key(p) == l { return fmt.Sprintf("point %d %d", p.X, p.Y) }
			}
		}
		return "overlap"
	}
	// General case.
	ex, ey := p3.X-p1.X, p3.Y-p1.Y
	tNum := ex*d2.Y - ey*d2.X
	uNum := ex*d1.Y - ey*d1.X
	// t,u in [0,1] with den's sign accounted for
	in := func(num int64) bool {
		if den > 0 { return 0 <= num && num <= den }
		return den <= num && num <= 0
	}
	if !in(tNum) || !in(uNum) {
		return "none"
	}
	// point = p1 + (tNum/den) * d1
	px := frac(p1.X*den+tNum*d1.X, den)
	py := frac(p1.Y*den+tNum*d1.Y, den)
	return "point " + px + " " + py
}

func main() {
	fmt.Println(solve(P{1, 1}, P{4, 4}, P{1, 4}, P{4, 1})) // point 5/2 5/2
	fmt.Println(solve(P{0, 0}, P{2, 0}, P{3, 0}, P{5, 0})) // none
	fmt.Println(solve(P{0, 0}, P{4, 0}, P{2, 0}, P{6, 0})) // overlap
	fmt.Println(solve(P{0, 0}, P{1, 1}, P{0, 1}, P{1, 2})) // none
	_ = onSeg
}
```

#### Java

```java
public class SegInter {
    static long cross(long ox, long oy, long ax, long ay, long bx, long by) {
        return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
    }
    static long gcd(long a, long b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b != 0) { long t = a % b; a = b; b = t; }
        return a;
    }
    static String frac(long n, long d) {
        if (d < 0) { n = -n; d = -d; }
        long g = gcd(n, d); if (g == 0) g = 1;
        n /= g; d /= g;
        return d == 1 ? Long.toString(n) : n + "/" + d;
    }

    static String solve(long[] p1, long[] p2, long[] p3, long[] p4) {
        long d1x = p2[0]-p1[0], d1y = p2[1]-p1[1];
        long d2x = p4[0]-p3[0], d2y = p4[1]-p3[1];
        long den = d1x*d2y - d1y*d2x;
        if (den == 0) {
            if (cross(p1[0],p1[1], p2[0],p2[1], p3[0],p3[1]) != 0) return "none";
            boolean xAxis = d1x != 0;
            long k1 = xAxis ? p1[0] : p1[1], k2 = xAxis ? p2[0] : p2[1];
            long k3 = xAxis ? p3[0] : p3[1], k4 = xAxis ? p4[0] : p4[1];
            long lo = Math.max(Math.min(k1,k2), Math.min(k3,k4));
            long hi = Math.min(Math.max(k1,k2), Math.max(k3,k4));
            if (lo > hi) return "none";
            if (lo == hi) {
                for (long[] p : new long[][]{p1,p2,p3,p4}) {
                    long key = xAxis ? p[0] : p[1];
                    if (key == lo) return "point " + p[0] + " " + p[1];
                }
            }
            return "overlap";
        }
        long ex = p3[0]-p1[0], ey = p3[1]-p1[1];
        long tNum = ex*d2y - ey*d2x;
        long uNum = ex*d1y - ey*d1x;
        if (!within(tNum, den) || !within(uNum, den)) return "none";
        String px = frac(p1[0]*den + tNum*d1x, den);
        String py = frac(p1[1]*den + tNum*d1y, den);
        return "point " + px + " " + py;
    }
    static boolean within(long num, long den) {
        return den > 0 ? (0 <= num && num <= den) : (den <= num && num <= 0);
    }

    public static void main(String[] args) {
        System.out.println(solve(new long[]{1,1}, new long[]{4,4}, new long[]{1,4}, new long[]{4,1})); // point 5/2 5/2
        System.out.println(solve(new long[]{0,0}, new long[]{2,0}, new long[]{3,0}, new long[]{5,0})); // none
        System.out.println(solve(new long[]{0,0}, new long[]{4,0}, new long[]{2,0}, new long[]{6,0})); // overlap
        System.out.println(solve(new long[]{0,0}, new long[]{1,1}, new long[]{0,1}, new long[]{1,2})); // none
    }
}
```

#### Python

```python
from math import gcd


def cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])


def frac(n, d):
    if d < 0:
        n, d = -n, -d
    g = gcd(abs(n), abs(d)) or 1
    n, d = n // g, d // g
    return str(n) if d == 1 else f"{n}/{d}"


def solve(p1, p2, p3, p4):
    d1 = (p2[0]-p1[0], p2[1]-p1[1])
    d2 = (p4[0]-p3[0], p4[1]-p3[1])
    den = d1[0]*d2[1] - d1[1]*d2[0]

    if den == 0:                                  # parallel or collinear
        if cross(p1, p2, p3) != 0:
            return "none"
        ax = 0 if d1[0] != 0 else 1               # dominant axis
        k = lambda p: p[ax]
        lo = max(min(k(p1), k(p2)), min(k(p3), k(p4)))
        hi = min(max(k(p1), k(p2)), max(k(p3), k(p4)))
        if lo > hi:
            return "none"
        if lo == hi:
            for p in (p1, p2, p3, p4):
                if k(p) == lo:
                    return f"point {p[0]} {p[1]}"
        return "overlap"

    e = (p3[0]-p1[0], p3[1]-p1[1])
    t_num = e[0]*d2[1] - e[1]*d2[0]
    u_num = e[0]*d1[1] - e[1]*d1[0]
    within = (lambda x: 0 <= x <= den) if den > 0 else (lambda x: den <= x <= 0)
    if not within(t_num) or not within(u_num):
        return "none"
    px = frac(p1[0]*den + t_num*d1[0], den)
    py = frac(p1[1]*den + t_num*d1[1], den)
    return f"point {px} {py}"


if __name__ == "__main__":
    print(solve((1, 1), (4, 4), (1, 4), (4, 1)))  # point 5/2 5/2
    print(solve((0, 0), (2, 0), (3, 0), (5, 0)))  # none
    print(solve((0, 0), (4, 0), (2, 0), (6, 0)))  # overlap
    print(solve((0, 0), (1, 1), (0, 1), (1, 2)))  # none
```

**Why this is a good interview answer:** the decision (`den`, `tNum`, `uNum`) is computed entirely in integers — exact, no round-off — and the point is emitted as a reduced fraction, so even the coordinate is exact. The `within` helper compares numerators against the denominator without dividing, sidestepping both overflow-by-division and float error. All five cases (cross, touch, overlap, parallel, disjoint) are covered.

---

### Follow-up Challenge: Minimum distance between two segments

> Common follow-up to the intersection challenge: return the **minimum distance** between two segments. If they intersect, the answer is `0`; otherwise it is the smallest of the four endpoint-to-segment distances. This exercises the clamped point-to-segment projection from `middle.md`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func dot(ax, ay, bx, by float64) float64 { return ax*bx + ay*by }

// pointSeg returns the distance from P to segment AB (clamped projection).
func pointSeg(px, py, ax, ay, bx, by float64) float64 {
	abx, aby := bx-ax, by-ay
	denom := dot(abx, aby, abx, aby)
	t := 0.0
	if denom > 0 {
		t = dot(px-ax, py-ay, abx, aby) / denom
		t = math.Max(0, math.Min(1, t))
	}
	cx, cy := ax+t*abx, ay+t*aby
	return math.Hypot(px-cx, py-cy)
}

func cross(ox, oy, ax, ay, bx, by float64) float64 {
	return (ax-ox)*(by-oy) - (ay-oy)*(bx-ox)
}
func segsCross(a, b, c, d [2]float64) bool {
	o1 := cross(a[0], a[1], b[0], b[1], c[0], c[1])
	o2 := cross(a[0], a[1], b[0], b[1], d[0], d[1])
	o3 := cross(c[0], c[1], d[0], d[1], a[0], a[1])
	o4 := cross(c[0], c[1], d[0], d[1], b[0], b[1])
	return (o1 > 0) != (o2 > 0) && (o3 > 0) != (o4 > 0)
}

func segSegDist(a, b, c, d [2]float64) float64 {
	if segsCross(a, b, c, d) {
		return 0
	}
	return math.Min(math.Min(
		pointSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
		pointSeg(b[0], b[1], c[0], c[1], d[0], d[1])),
		math.Min(
			pointSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
			pointSeg(d[0], d[1], a[0], a[1], b[0], b[1])))
}

func main() {
	fmt.Printf("%.3f\n", segSegDist([2]float64{0, 0}, [2]float64{2, 0},
		[2]float64{0, 1}, [2]float64{2, 1})) // 1.000
	fmt.Printf("%.3f\n", segSegDist([2]float64{0, 0}, [2]float64{2, 2},
		[2]float64{0, 2}, [2]float64{2, 0})) // 0.000 (cross)
}
```

#### Java

```java
public class SegDist {
    static double pointSeg(double px, double py, double ax, double ay, double bx, double by) {
        double abx = bx - ax, aby = by - ay;
        double denom = abx * abx + aby * aby;
        double t = 0;
        if (denom > 0) {
            t = ((px - ax) * abx + (py - ay) * aby) / denom;
            t = Math.max(0, Math.min(1, t));
        }
        double cx = ax + t * abx, cy = ay + t * aby;
        return Math.hypot(px - cx, py - cy);
    }
    static double cross(double ox, double oy, double ax, double ay, double bx, double by) {
        return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
    }
    static boolean cross(double[] a, double[] b, double[] c, double[] d) {
        boolean s1 = cross(a[0],a[1],b[0],b[1],c[0],c[1]) > 0;
        boolean s2 = cross(a[0],a[1],b[0],b[1],d[0],d[1]) > 0;
        boolean s3 = cross(c[0],c[1],d[0],d[1],a[0],a[1]) > 0;
        boolean s4 = cross(c[0],c[1],d[0],d[1],b[0],b[1]) > 0;
        return s1 != s2 && s3 != s4;
    }
    static double dist(double[] a, double[] b, double[] c, double[] d) {
        if (cross(a, b, c, d)) return 0;
        return Math.min(Math.min(
            pointSeg(a[0],a[1], c[0],c[1], d[0],d[1]),
            pointSeg(b[0],b[1], c[0],c[1], d[0],d[1])),
            Math.min(
            pointSeg(c[0],c[1], a[0],a[1], b[0],b[1]),
            pointSeg(d[0],d[1], a[0],a[1], b[0],b[1])));
    }
    public static void main(String[] args) {
        System.out.printf("%.3f%n", dist(new double[]{0,0}, new double[]{2,0},
                                          new double[]{0,1}, new double[]{2,1})); // 1.000
        System.out.printf("%.3f%n", dist(new double[]{0,0}, new double[]{2,2},
                                          new double[]{0,2}, new double[]{2,0})); // 0.000
    }
}
```

#### Python

```python
import math


def point_seg(p, a, b):
    abx, aby = b[0]-a[0], b[1]-a[1]
    denom = abx*abx + aby*aby
    t = 0.0
    if denom > 0:
        t = ((p[0]-a[0])*abx + (p[1]-a[1])*aby) / denom
        t = max(0.0, min(1.0, t))
    cx, cy = a[0]+t*abx, a[1]+t*aby
    return math.hypot(p[0]-cx, p[1]-cy)


def cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])


def segs_cross(a, b, c, d):
    s = lambda o, x, y: cross(o, x, y) > 0
    return (s(a, b, c) != s(a, b, d)) and (s(c, d, a) != s(c, d, b))


def seg_seg_dist(a, b, c, d):
    if segs_cross(a, b, c, d):
        return 0.0
    return min(point_seg(a, c, d), point_seg(b, c, d),
              point_seg(c, a, b), point_seg(d, a, b))


if __name__ == "__main__":
    print(round(seg_seg_dist((0,0),(2,0),(0,1),(2,1)), 3))  # 1.0
    print(round(seg_seg_dist((0,0),(2,2),(0,2),(2,0)), 3))  # 0.0
```

**Why this is a good answer:** it composes two primitives from the topic — the crossing test (zero distance) and the clamped point-to-segment projection — and correctly reduces the segment-segment distance to the minimum over four endpoint-to-segment distances when they don't cross. That four-way reduction is the standard trick interviewers look for.

---

## Final Tips

- Lead with the **orientation primitive**; everything else follows from it.
- Say "I'll **decide in integers, locate in floats**" — it signals robustness awareness instantly.
- Always mention the **collinear/boundary cases** unprompted; forgetting them is the classic rejection.
- Know that *all intersections* is the **sweep-line** problem (`05-sweep-line`) and that it's output-sensitive.
- Never reach for slopes; if you write `y = mx + b` on the board, expect "what about a vertical line?"

---

**Next step:** [tasks.md](./tasks.md) — 15 graded practice tasks (beginner → advanced) plus a cross-language benchmark, all in Go, Java, and Python.
