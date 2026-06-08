# Circle Tangents — Interview Preparation

Circle tangents show up in interviews wherever geometry meets pathfinding: "how many common tangents do two circles have?", "find the tangent length from a point", "shortest path around a circular obstacle", and the Dubins-path family for self-driving and robotics rounds. The whole topic rests on one fact — **the radius to a touch-point is perpendicular to the tangent** — and a single classification table (`0..4` common tangents by `d` vs `r1±r2`). This file is a tiered question bank (junior → professional), behavioral/design prompts, and a full coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Core fact | **Radius ⟂ tangent at the touch-point** | Everything derives from this right angle. |
| Tangents from external point | **2**, length `sqrt(d²−r²)` | `d = dist(P,C)`, need `d > r`. |
| Half-angle at center | `θ = acos(r/d)` | Touch-points at `C + r(cos(φ±θ), sin(φ±θ))`. |
| Point inside circle (`d<r`) | **0 tangents** | `sqrt` of negative → check first. |
| Point on circle (`d=r`) | **1 tangent**, length 0 | Touch-point = `P`. |
| Common tangents | **0..4** | 2 external + 2 internal at most. |
| External (direct) | Centers same side, `σ1=σ2` | Exist iff `d ≥ |r1−r2|`. |
| Internal (transverse) | Centers opposite sides, `σ1=−σ2` | Exist iff `d ≥ r1+r2`. |
| Robust method | **Signed-distance `a·Cᵢ+c=σᵢrᵢ`, `a²+b²=1`** | No equal-radius blow-up. |
| Touch-point from line | `T = C − sd(C,ℓ)·(a,b)` | Foot of perpendicular. |
| Complexity | **O(1)** per pair | `O(n²)` to build a tangent graph. |

The 0–4 count (assume `r1 ≥ r2`, `d = dist(C1,C2)`):

```text
d < r1 − r2        → 0   (nested)
d = r1 − r2        → 1   (internally tangent)
r1−r2 < d < r1+r2  → 2   (overlapping, external only)
d = r1 + r2        → 3   (externally tangent)
d > r1 + r2        → 4   (separate)
```

Mental anchor: **common tangents are the dual of circle–circle intersection** — same two thresholds `r1±r2`, mirrored counts (`0,1,2,1,0` points ↔ `0,1,2,3,4` tangents).

---

## Junior Questions (14 Q&A)

### J1. What is a tangent line to a circle?
A line that touches the circle at exactly one point — the *point of tangency* or *touch-point* — without crossing into the interior. At that point the radius drawn to the touch-point is perpendicular to the tangent line.

### J2. Why is the radius perpendicular to the tangent at the touch-point?
The touch-point is the *closest* point of the tangent line to the center (every other point on the line is outside the circle, hence farther than `r`). The closest point on a line to an external point is always the foot of the perpendicular, so the radius to the touch-point is perpendicular to the line.

### J3. How many tangents can you draw from a point to a circle?
It depends on the point: **2** if the point is outside the circle (`d > r`), exactly **1** if it is on the circle (`d = r`), and **0** if it is inside (`d < r`).

### J4. What is the tangent length from an external point?
`L = sqrt(d² − r²)`, where `d` is the distance from the point to the center and `r` is the radius. It comes from the right triangle formed by the point, the center, and the touch-point, with the right angle at the touch-point: `L² + r² = d²`.

### J5. Derive the tangent-length formula.
Let `P` be external, `T` a touch-point. Triangle `PTC` has a right angle at `T` (radius ⟂ tangent). Hypotenuse `PC = d`, leg `CT = r`, leg `PT = L`. Pythagoras: `L² + r² = d²`, so `L = sqrt(d² − r²)`.

### J6. What happens if the point is inside the circle?
There are no real tangents. `d < r` makes `d² − r² < 0`, so `sqrt(d²−r²)` is imaginary. You must check `d > r` before computing and report "no tangent."

### J7. How do you find the actual touch-points?
With `φ = atan2(P.y−C.y, P.x−C.x)` (direction from center to point) and `θ = acos(r/d)`, the touch-points are `C + r·(cos(φ±θ), sin(φ±θ))`. Equivalently, intersect the circle with the circle drawn on diameter `PC` (Thales' circle).

### J8. What is a common tangent?
A line that is tangent to **two** circles at once. Two circles can share 0, 1, 2, 3, or 4 common tangents depending on how they are positioned relative to each other.

### J9. What is the difference between external and internal common tangents?
**External (direct)** tangents keep both circles on the *same* side — they do not pass between the circles. **Internal (transverse)** tangents pass *between* the circles, crossing the segment joining the centers.

### J10. How many common tangents do two separate (non-touching, non-overlapping) circles have?
**Four**: two external and two internal.

### J11. How many common tangents do two overlapping circles have?
**Two**, both external. The internal tangents disappear as soon as the circles start to intersect.

### J12. What is the time complexity of computing tangents?
**O(1)** — it is closed-form arithmetic on a constant number of points and radii. There is no input size to scan; processing `n` circles is just `O(n)` times the constant work.

### J13. What is the connection between circle tangents and circle–circle intersection?
They share the *same* classification by `d` vs `r1+r2` and `|r1−r2|`. As two circles go nested → internally tangent → overlapping → externally tangent → separate, the intersection-point count goes `0,1,2,1,0` while the common-tangent count goes `0,1,2,3,4`. Tangents are the "touch" dual of intersection's "cross."

### J14 (analysis). Why do you clamp the argument of `acos` to `[-1, 1]`?
Because `r/d` can round to a value like `1.0000000002` in floating point, and `acos` of anything `> 1` returns `NaN`. Clamping `r/d` to `[-1, 1]` keeps the on-circle case (`d = r`, `r/d = 1`, `θ = 0`) numerically safe.

---

## Middle Questions (14 Q&A)

### M1. State the signed-distance formulation of a common tangent.
A line `a·x + b·y + c = 0` with `a²+b²=1` is tangent to circle `i` iff the signed distance from its center equals `±rᵢ`: `a·Cᵢx + b·Cᵢy + c = σᵢrᵢ`. Choosing `σ1=σ2` gives external tangents, `σ1=−σ2` internal. Solving the four sign-pairs yields all common tangents.

### M2. How do you reduce the common-tangent system to one equation?
Subtract the two tangency equations to eliminate `c`: `a·Δx + b·Δy = g` where `Δ = C2−C1` and `g = σ2r2 − σ1r1`. Combined with `a²+b²=1`, this is a unit vector with prescribed projection onto `Δ`, giving up to two solutions: `n = (g/d)û + h·û⊥`, `h = ±sqrt(1−(g/d)²)`.

### M3. What is the existence condition for each tangent type?
External (`|g| = |r1−r2|`): exist iff `|r1−r2| ≤ d`. Internal (`|g| = r1+r2`): exist iff `r1+r2 ≤ d`. The square root `sqrt(d²−g²)` is real exactly when `|g| ≤ d`, which gives the whole 0–4 table.

### M4. Walk through the full 0–4 count.
Assume `r1 ≥ r2`. `d < r1−r2`: nested → 0. `d = r1−r2`: internally tangent → 1 (the externals merge). `r1−r2 < d < r1+r2`: overlapping → 2 external. `d = r1+r2`: externally tangent → 3 (the internals merge). `d > r1+r2`: separate → 4.

### M5. Why does the signed-distance method handle equal radii but the homothety method does not?
The external homothety center is `E = (r2C1 − r1C2)/(r2−r1)` — its denominator is `r2−r1`, which is **zero** when `r1=r2`, sending `E` to infinity (the external tangents become parallel). The signed-distance method instead has `g = 0` for equal-radius externals, giving `n ⟂ Δ` directly, with no division by the radius difference.

### M6. What are the homothety (similarity) centers and what passes through them?
The external center `E` (external division of `C1C2` in ratio `r1:r2`) lies on every external common tangent; the internal center `I = (r2C1 + r1C2)/(r1+r2)` lies on every internal common tangent. So you can also get the tangents by drawing tangents *from* these centers to either circle.

### M7. How do you compute the touch-point once you have the tangent line?
The touch-point on circle `i` is the foot of the perpendicular from `Cᵢ`: `Tᵢ = Cᵢ − (a·Cᵢx + b·Cᵢy + c)·(a, b)`. Because `(a,b)` is the unit normal, you move from the center by the signed distance along it, landing on the line at distance `rᵢ`.

### M8. What is the chord of contact (polar line), and why is it useful?
The two touch-points of the tangents from an external point `P` lie on the *polar line* `(P−C)·(X−C) = r²`. Intersecting the circle with this single linear equation gives the touch-points directly — and it is better-conditioned than the `acos` method when `P` is near the circle (`r/d ≈ 1`).

### M9. Why must you classify external/internal *after* solving rather than trusting the sign convention?
Different placements of `σ` on the right-hand side flip which `(σ1,σ2)` pair labels external vs internal. The convention is easy to get backwards. The reliable rule: after computing the line, a tangent is *external* iff both signed distances `sd(Cᵢ,ℓ)` have the **same** sign, *internal* iff opposite.

### M10. How do you avoid emitting duplicate tangents at tangency?
At external/internal tangency the discriminant `h = sqrt(d²−g²)` is 0, so the `±h` solutions coincide. Use `sqrt(max(0, d²−g²))` and `break` after producing the single line for that sign-pair, then deduplicate lines on `(a,b,c)` with a tolerance.

### M11. Two circles with `r1=5, r2=2`, centers 3 apart. How many tangents?
`r1 − r2 = 3 = d`. So `d = r1 − r2`: they are **internally tangent** → exactly **1** common tangent.

### M12. How do you compute common tangents for concentric circles?
You cannot have any (unless they are identical): a line tangent to the inner circle always cuts the outer one. Detect `d ≈ 0` (different radii) and return zero common tangents.

### M13. When should you compare squared distances instead of actual distances?
When you only need the *count* / classification, compare `d²` with `(r1±r2)²` to skip the `sqrt` — faster and, for integer inputs, exact. Only compute `sqrt`/`acos` when you need the actual lines or touch-points.

### M14 (analysis). Why are the common-tangent count and intersection-point count governed by the same thresholds?
Both reduce to the sign of the discriminants `d²−(r1−r2)²` and `d²−(r1+r2)²`. Intersection solves the two circle equations (a chord); tangents solve `sd = σr` for a line; in both cases the same two quadratic discriminants flip the solution count. That shared algebra is exactly the duality between the two classification tables.

---

## Senior Questions (10 Q&A)

### S1. What is a tangent graph and what is it used for?
For circular (disc) obstacles, the shortest collision-free path consists of straight **tangent segments** between discs and **arcs** along disc boundaries. A tangent graph has touch-points as nodes, common-tangent segments and boundary arcs as weighted edges, with edges that cut other discs filtered out. Dijkstra/A* over it yields the provably shortest path — the disc analogue of the polygon visibility graph.

### S2. How does Dubins-path planning use circle tangents?
A car with minimum turning radius `ρ` has the shortest path of type `CSC` or `CCC`. The straight `S` segment is a **common tangent** between the two minimum-radius turning circles (one at the start pose, one at the goal): `LSL`/`RSR` use external tangents, `LSR`/`RSL` use internal tangents. You enumerate the six candidates, compute each tangent, and take the shortest valid total.

### S3. Why is the equal-radius case unavoidable in Dubins planning?
Both turning circles have radius `ρ`, so every Dubins tangent computation is between two **equal-radius** circles — exactly the case where external tangents are parallel and the homothety center is at infinity. A homothety-based tangent routine divides by zero on every call; you must use the signed-distance method.

### S4. Compute a belt length over two pulleys.
External (open) belt: `length = 2·sqrt(d²−(r1−r2)²) + r1·α + r2·β`, with wrap angles `α = π + 2asin((r1−r2)/d)`, `β = π − 2asin((r1−r2)/d)`. The two straight runs are external tangents; the arcs are the wrap on each pulley between the touch-points. Crossed belt uses internal tangents and `r1+r2`.

### S5. How do you keep a tangent-graph build fast as obstacle count grows?
Building all pairwise tangents is `O(n²)`. The killer is collision-filtering each tangent against all discs (`O(n³)` naive). Use a spatial index (kd-tree or grid) so each tangent only tests nearby discs, and cache the static disc-to-disc graph if only start/goal change, adding their tangents in `O(n)` per query.

### S6. What degeneracies threaten tangent computations at scale?
Near-tangent circles (count flickers 2↔3), equal radii (parallel externals / infinite center), point on circle (touch-points collapse), collinear centers (ties), and near-duplicate discs. Mitigate with epsilon bands, the signed-distance method, exact sign predicates, conservative obstacle inflation, and deterministic tie-breaks.

### S7. Why use exact predicates if coordinates are computed in floating point?
The *coordinates* of a tangent can be approximate, but the *combinatorial decisions* (how many tangents, which side of a tangent a center is on, whether a segment clears a disc) must be consistent. A wrong sign there corrupts the whole graph. Compute those signs with integer/extended-precision arithmetic (squared-distance comparisons need no `sqrt`).

### S8. How do you treat a robot of nonzero radius among disc obstacles?
Inflate every obstacle disc by the robot radius (a Minkowski sum) and plan the robot as a point. Tangents are then computed against the inflated discs. Add an extra safety margin `ε` so "barely clears" becomes "comfortably clears" under floating point.

### S9. How do external vs internal tangents map to the direction a path wraps a disc?
If the path wraps both discs the same rotational way (CCW–CCW or CW–CW), it rides an **external** tangent between them. If it wraps them oppositely (CCW–CW), it rides an **internal** tangent. Each ordered disc pair thus offers up to four candidate bitangents, each tagged with the wrap orientation at both ends.

### S10. When would you abandon exact tangent geometry for sampling-based planning?
When the configuration space is high-dimensional or obstacles are not circular — the closed-form tangent geometry no longer applies. Then RRT*/PRM give asymptotically optimal paths over arbitrary obstacles, trading exactness for generality.

### S11. Derive the external common-tangent segment length and explain the equal-radius case.
`L_ext = sqrt(d² − (r1−r2)²)`. The two external touch-radii are parallel (both perpendicular to the same line), forming a right trapezoid `C1T1T2C2`; projecting `C1C2 = d` onto the radius direction gives `r1−r2` and onto the tangent direction gives `L_ext`, so `d² = (r1−r2)² + L_ext²`. When `r1=r2`, `L_ext = d`: the tangent segment is exactly the center-line length and the tangents are parallel to `C1C2` (angle to center line `sin ψ = (r1−r2)/d = 0`).

### S12. How do you cache a tangent graph so per-query cost drops?
If obstacles are static and only `S`/`G` move, precompute the disc-to-disc tangent graph once (`O(n²)` build). Per query, add only the tangents from `S` and `G` to each disc — `O(n)` new edges — and run Dijkstra/A*. This turns each query from `O(n²)` into `O(n)` edge construction plus the search.

### S13. What is the "director circle" and where does it appear in practice?
The locus of points from which the two tangents to a circle `(C, r)` are mutually perpendicular is a concentric circle of radius `r√2` (the diagonal of the square formed by `PC` and the two radii). More generally the locus where tangents subtend a fixed angle `2α` is the concentric circle of radius `r/sin α`. This is the geometry behind "from how far does a round object span exactly θ degrees of my view?" — a visibility/camera-placement question.

### S14. How do you verify a planned tangent-arc path is actually collision-free?
Re-check every straight tangent segment against all discs using point-to-segment distance (`< r` ⇒ collision), and every arc against the discs it does not belong to. If anything violates, the `ε` inflation margin was too small — increase it and replan. Emit `path_collision_violations` as a metric that must stay zero in production.

---

## Professional Questions (8 Q&A)

### P1. Prove there are exactly two tangents from an external point.
Touch-points satisfy `∠PTC = 90°`, so they lie on the Thales circle with diameter `PC` (center `M=(P+C)/2`, radius `d/2`). The touch-points are `◯(C,r) ∩ Thales`. Two circles meet in 0/1/2 points; the intersection condition `|d/2 − r| < d/2 < d/2 + r` holds iff `0 < r < d`, which is true for an external point. Hence exactly two intersection points → two tangents. ∎

### P2. Prove the 0–4 count theorem.
Eliminating `c` gives `a·Δ = g` with `a²+b²=1`, solvable iff `|g| ≤ d`, with 2 solutions when `|g| < d`, 1 when `|g| = d`, 0 when `|g| > d`. For externals `|g| = |r1−r2|`; for internals `|g| = r1+r2`. Plugging the five `d`-regimes (nested, internally tangent, overlapping, externally tangent, separate) gives external counts `0,1,2,2,2` and internal counts `0,0,0,1,2`, summing to `0,1,2,3,4`. ∎

### P3. Prove every external tangent passes through the external similarity center.
Let `H` be the homothety about `E` with ratio `r2/r1` mapping `◯1 → ◯2`. `H` maps a tangent line of `◯1` to a parallel tangent line of `◯2`. If `ℓ` is tangent to both, `H(ℓ)` must equal `ℓ` (same line), so `ℓ` is invariant under `H`, which forces `ℓ` to pass through the fixed point `E`. Internal tangents: same with the negative-ratio homothety about `I`. ∎

### P4. Prove the chord-of-contact (polar) theorem.
`T` is a touch-point iff `(T−C)·(T−P) = 0` (radius ⟂ tangent). Expand: `(T−C)·((T−C)−(P−C)) = |T−C|² − (T−C)·(P−C) = r² − (P−C)·(T−C) = 0`, giving `(P−C)·(T−C) = r²`. So both touch-points lie on the line `(P−C)·(X−C)=r²` (the polar of `P`), intersected with the circle. ∎

### P5. Why does the `acos` touch-point formula lose precision near `r/d = 1`, and what is the fix?
`d(acos)/dx = −1/sqrt(1−x²)` diverges as `x = r/d → 1`, so small input error in `r/d` is hugely amplified in `θ`. The polar-line method computes touch-points as a *linear* intersection with the circle, with no such singularity — it is well-conditioned exactly where the trig form is worst. Prefer the polar form for ill-conditioned (point-near-circle) inputs.

### P6. How do you classify the count with no floating point at all?
For integer centers and radii, `d² = Δx²+Δy²` and `(r1±r2)²` are integers; the count is decided by the exact integer signs of `d²−(r1−r2)²` and `d²−(r1+r2)²`. No `sqrt`, no rounding — the classification is provably correct.

### P7. How do you resolve collinear-center degeneracies deterministically?
Use Simulation of Simplicity: perturb each input by a fixed-order infinitesimal `εᵢ`, breaking all ties consistently. The unperturbed answer is recovered for non-degenerate inputs, and degenerate ones get a single deterministic resolution — essential for reproducible tangent graphs.

### P8. Relate the common-tangent discriminant to the circle-intersection discriminant.
Circle–circle intersection point count is fixed by the sign of `d²−(r1−r2)²` (≥0 needed) and `(r1+r2)²−d²` (≥0 needed); the chord exists when both hold. The tangent count per type is fixed by `d²−g²` with `g∈{±(r1−r2),±(r1+r2)}`. Both tables are driven by the *same* two quadratics `d²−(r1±r2)²`, which is precisely why the classifications coincide and the counts are dual. ∎

---

## Behavioral & System-Design Prompts

- *"Walk me through how you would build a planner that routes a drone around circular no-fly zones."* — Inflate zones by drone radius, build a tangent graph (bitangents + boundary arcs), spatial-index the collision filter, run A* with Euclidean heuristic, validate the output path is collision-free under an `ε` margin.
- *"Your tangent code returns NaN intermittently in production. How do you debug it?"* — Reproduce with the offending circle pair; check the three NaN sources (point inside circle, `acos` argument >1, division by `d≈0`); add the inside-check, clamp, and concentric guard; add a `nan_tangents_total` metric that must stay zero.
- *"A teammate used the homothety method and it crashes on identical-radius obstacles. What do you recommend?"* — Switch to the signed-distance method which has no equal-radius singularity; explain `E → ∞` when `r1=r2`.
- *"How would you test tangent code?"* — Property tests: every returned line is at distance `rᵢ` from each center; every touch-point satisfies `(T−C)·(T−P)=0`; the count matches the integer classification; randomized circles cross-checked against a brute-force angle sweep.

---

## Coding Challenge (3 Languages)

### Challenge: All Common Tangents of Two Circles

> Given two circles `(C1, r1)` and `(C2, r2)`, return **all** common tangent lines, each as a normalized triple `(a, b, c)` with `a²+b²=1` representing `a·x+b·y+c=0`. Return them in any order. The count must be `0..4` and match the geometric classification. Use the signed-distance method so equal radii work.
>
> Validation: each returned line must satisfy `|a·Cᵢx + b·Cᵢy + c| = rᵢ` for both circles (within tolerance).

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

type Pt struct{ X, Y float64 }
type Line struct{ A, B, C float64 }

const EPS = 1e-9

func CommonTangents(c1 Pt, r1 float64, c2 Pt, r2 float64) []Line {
	dx, dy := c2.X-c1.X, c2.Y-c1.Y
	d2 := dx*dx + dy*dy
	var out []Line
	if d2 < EPS {
		return out // concentric (or identical): no isolated common tangent
	}
	for _, s1 := range []float64{1, -1} {
		for _, s2 := range []float64{1, -1} {
			g := s1*r1 - s2*r2
			if d2 < g*g-EPS {
				continue
			}
			xn := g / d2
			h := math.Sqrt(math.Max(0, d2-g*g)) / d2
			for _, sign := range []float64{1, -1} {
				a := dx*xn + sign*dy*h
				b := dy*xn - sign*dx*h
				c := s1*r1 - (a*c1.X + b*c1.Y)
				out = append(out, normalize(Line{a, b, c}))
				if h < EPS {
					break
				}
			}
		}
	}
	return dedup(out)
}

func normalize(l Line) Line {
	n := math.Hypot(l.A, l.B)
	if n < EPS {
		return l
	}
	// canonical sign so duplicates compare equal
	if l.A < -EPS || (math.Abs(l.A) < EPS && l.B < 0) {
		n = -n
	}
	return Line{l.A / n, l.B / n, l.C / n}
}

func dedup(ls []Line) []Line {
	sort.Slice(ls, func(i, j int) bool {
		if math.Abs(ls[i].A-ls[j].A) > 1e-7 {
			return ls[i].A < ls[j].A
		}
		if math.Abs(ls[i].B-ls[j].B) > 1e-7 {
			return ls[i].B < ls[j].B
		}
		return ls[i].C < ls[j].C
	})
	var out []Line
	for _, l := range ls {
		if len(out) == 0 || math.Abs(out[len(out)-1].A-l.A) > 1e-6 ||
			math.Abs(out[len(out)-1].B-l.B) > 1e-6 || math.Abs(out[len(out)-1].C-l.C) > 1e-6 {
			out = append(out, l)
		}
	}
	return out
}

func main() {
	for _, tc := range []struct {
		c1     Pt
		r1     float64
		c2     Pt
		r2     float64
		expect int
	}{
		{Pt{0, 0}, 3, Pt{10, 0}, 2, 4}, // separate
		{Pt{0, 0}, 3, Pt{4, 0}, 2, 2},  // overlapping
		{Pt{0, 0}, 3, Pt{5, 0}, 2, 3},  // externally tangent
		{Pt{0, 0}, 5, Pt{3, 0}, 2, 1},  // internally tangent
		{Pt{0, 0}, 5, Pt{1, 0}, 2, 0},  // nested
		{Pt{0, 0}, 2, Pt{8, 0}, 2, 4},  // equal radii, separate
	} {
		got := CommonTangents(tc.c1, tc.r1, tc.c2, tc.r2)
		fmt.Printf("expect %d, got %d  %v\n", tc.expect, len(got), len(got) == tc.expect)
	}
}
```

#### Java

```java
import java.util.*;

public class CommonTangents {
    static final double EPS = 1e-9;
    record Pt(double x, double y) {}
    record Line(double a, double b, double c) {}

    static List<Line> commonTangents(Pt c1, double r1, Pt c2, double r2) {
        double dx = c2.x()-c1.x(), dy = c2.y()-c1.y(), d2 = dx*dx + dy*dy;
        List<Line> out = new ArrayList<>();
        if (d2 < EPS) return out;
        for (double s1 : new double[]{1,-1})
            for (double s2 : new double[]{1,-1}) {
                double g = s1*r1 - s2*r2;
                if (d2 < g*g - EPS) continue;
                double xn = g/d2, h = Math.sqrt(Math.max(0, d2-g*g))/d2;
                for (double sign : new double[]{1,-1}) {
                    double a = dx*xn + sign*dy*h, b = dy*xn - sign*dx*h;
                    double c = s1*r1 - (a*c1.x() + b*c1.y());
                    out.add(normalize(new Line(a,b,c)));
                    if (h < EPS) break;
                }
            }
        return dedup(out);
    }

    static Line normalize(Line l) {
        double n = Math.hypot(l.a(), l.b());
        if (n < EPS) return l;
        if (l.a() < -EPS || (Math.abs(l.a()) < EPS && l.b() < 0)) n = -n;
        return new Line(l.a()/n, l.b()/n, l.c()/n);
    }

    static List<Line> dedup(List<Line> ls) {
        ls.sort(Comparator.comparingDouble(Line::a).thenComparingDouble(Line::b).thenComparingDouble(Line::c));
        List<Line> out = new ArrayList<>();
        for (Line l : ls) {
            Line last = out.isEmpty() ? null : out.get(out.size()-1);
            if (last == null || Math.abs(last.a()-l.a())>1e-6 ||
                Math.abs(last.b()-l.b())>1e-6 || Math.abs(last.c()-l.c())>1e-6) out.add(l);
        }
        return out;
    }

    public static void main(String[] args) {
        int[][] none = {};
        Object[][] cases = {
            {new Pt(0,0),3.0,new Pt(10,0),2.0,4},
            {new Pt(0,0),3.0,new Pt(4,0),2.0,2},
            {new Pt(0,0),3.0,new Pt(5,0),2.0,3},
            {new Pt(0,0),5.0,new Pt(3,0),2.0,1},
            {new Pt(0,0),5.0,new Pt(1,0),2.0,0},
            {new Pt(0,0),2.0,new Pt(8,0),2.0,4},
        };
        for (Object[] tc : cases) {
            int got = commonTangents((Pt)tc[0],(double)tc[1],(Pt)tc[2],(double)tc[3]).size();
            System.out.printf("expect %d, got %d  %b%n", (int)tc[4], got, got == (int)tc[4]);
        }
    }
}
```

#### Python

```python
import math

EPS = 1e-9


def common_tangents(c1, r1, c2, r2):
    dx, dy = c2[0] - c1[0], c2[1] - c1[1]
    d2 = dx * dx + dy * dy
    if d2 < EPS:
        return []
    out = []
    for s1 in (1, -1):
        for s2 in (1, -1):
            g = s1 * r1 - s2 * r2
            if d2 < g * g - EPS:
                continue
            xn = g / d2
            h = math.sqrt(max(0.0, d2 - g * g)) / d2
            for sign in (1, -1):
                a = dx * xn + sign * dy * h
                b = dy * xn - sign * dx * h
                c = s1 * r1 - (a * c1[0] + b * c1[1])
                out.append(_normalize((a, b, c)))
                if h < EPS:
                    break
    return _dedup(out)


def _normalize(line):
    a, b, c = line
    n = math.hypot(a, b)
    if n < EPS:
        return line
    if a < -EPS or (abs(a) < EPS and b < 0):
        n = -n
    return (a / n, b / n, c / n)


def _dedup(ls):
    ls.sort()
    out = []
    for l in ls:
        if not out or any(abs(out[-1][i] - l[i]) > 1e-6 for i in range(3)):
            out.append(l)
    return out


if __name__ == "__main__":
    cases = [
        ((0, 0), 3, (10, 0), 2, 4),  # separate
        ((0, 0), 3, (4, 0), 2, 2),   # overlapping
        ((0, 0), 3, (5, 0), 2, 3),   # externally tangent
        ((0, 0), 5, (3, 0), 2, 1),   # internally tangent
        ((0, 0), 5, (1, 0), 2, 0),   # nested
        ((0, 0), 2, (8, 0), 2, 4),   # equal radii, separate
    ]
    for c1, r1, c2, r2, expect in cases:
        got = len(common_tangents(c1, r1, c2, r2))
        print(f"expect {expect}, got {got}  {got == expect}")
```

**Expected output (all three):** each line prints `expect N, got N  true` — `4, 2, 3, 1, 0, 4`.

**Discussion points the interviewer may probe:**
- Why the signed-distance method instead of homothety? (Equal radii: the last test case.)
- How do you classify external vs internal? (Sign agreement of the two signed distances.)
- How do you avoid duplicate lines at tangency? (`break` on `h≈0`, plus canonical normalization.)
- What is the complexity? (`O(1)` — four sign-pairs, constant work each.)

---

## Bonus Challenge: Tangent Length and Touch-Points from a Point

> Given a circle `(C, r)` and a point `P`, return the tangent length and the two touch-points, or report that `P` is inside the circle. Validate each touch-point with the perpendicularity check `(T−C)·(T−P) ≈ 0`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

type Pt struct{ X, Y float64 }

func tangentsFromPoint(p, c Pt, r float64) (length float64, touch []Pt, ok bool) {
	d := math.Hypot(p.X-c.X, p.Y-c.Y)
	if d < r-1e-9 {
		return 0, nil, false // inside
	}
	length = math.Sqrt(math.Max(0, d*d-r*r))
	phi := math.Atan2(p.Y-c.Y, p.X-c.X)
	th := math.Acos(math.Max(-1, math.Min(1, r/d)))
	touch = []Pt{
		{c.X + r*math.Cos(phi+th), c.Y + r*math.Sin(phi+th)},
		{c.X + r*math.Cos(phi-th), c.Y + r*math.Sin(phi-th)},
	}
	return length, touch, true
}

func main() {
	L, ts, ok := tangentsFromPoint(Pt{5, 0}, Pt{0, 0}, 3)
	fmt.Println(ok, L, ts) // true 4 [{1.8 2.4} {1.8 -2.4}]
}
```

#### Java

```java
public class TangentsFromPoint {
    record Pt(double x, double y) {}

    static double[] solve(Pt p, Pt c, double r) {
        double d = Math.hypot(p.x()-c.x(), p.y()-c.y());
        if (d < r - 1e-9) return null; // inside
        double L = Math.sqrt(Math.max(0, d*d - r*r));
        double phi = Math.atan2(p.y()-c.y(), p.x()-c.x());
        double th = Math.acos(Math.max(-1, Math.min(1, r/d)));
        return new double[]{ L,
            c.x()+r*Math.cos(phi+th), c.y()+r*Math.sin(phi+th),
            c.x()+r*Math.cos(phi-th), c.y()+r*Math.sin(phi-th) };
    }

    public static void main(String[] args) {
        double[] res = solve(new Pt(5,0), new Pt(0,0), 3);
        System.out.printf("L=%.1f  T1=(%.1f,%.1f) T2=(%.1f,%.1f)%n",
            res[0], res[1], res[2], res[3], res[4]);
    }
}
```

#### Python

```python
import math


def tangents_from_point(p, c, r):
    d = math.hypot(p[0]-c[0], p[1]-c[1])
    if d < r - 1e-9:
        return None  # inside
    L = math.sqrt(max(0.0, d*d - r*r))
    phi = math.atan2(p[1]-c[1], p[0]-c[0])
    th = math.acos(max(-1.0, min(1.0, r/d)))
    touch = [
        (c[0]+r*math.cos(phi+th), c[1]+r*math.sin(phi+th)),
        (c[0]+r*math.cos(phi-th), c[1]+r*math.sin(phi-th)),
    ]
    return L, touch


if __name__ == "__main__":
    print(tangents_from_point((5, 0), (0, 0), 3))  # (4.0, [(1.8, 2.4), (1.8, -2.4)])
```

**Expected output:** length `4`, touch-points `(1.8, 2.4)` and `(1.8, −2.4)`. The inside case (`P=(1,0)`) returns the "no tangent" sentinel.

## Professional Bonus Questions

### PB1. What is the power of a point, and how does it relate to tangents?
`pow(P) = |P−C|² − r² = d² − r²`. It equals the squared tangent length `L²`, and its sign classifies the point: `>0` outside (two tangents), `=0` on (one), `<0` inside (none). It is also the constant `(P→A)(P→B)` along any secant, so the tangent is the secant's degenerate limit `A=B`.

### PB2. How many circles are tangent to three given circles, and how does that connect here?
Up to **eight** (Apollonius' problem) — one per sign-combination `2³` of the constraints `|X−Cᵢ| = R ± rᵢ`. A common tangent of two circles is the special case where the third constraint is a "line at infinity," i.e. one given circle has infinite radius. The two-line tangent system here is the linear shadow of that quadratic problem.

### PB3. For a belt over n equal-radius pulleys, what is the arc contribution and why?
Exactly `2πr`, independent of arrangement. The belt makes one full turn enclosing the convex hull of the discs, so all wrap angles sum to `2π`; with equal radius `r` the arc length is `2πr` regardless of layout. Only the straight tangent segments depend on the placement.

## Summary

Circle tangent interviews reward a candidate who can (1) state and *use* the radius-⟂-tangent fact, (2) derive `sqrt(d²−r²)` from the right triangle, (3) reproduce the `0..4` count from `d` vs `r1±r2`, and (4) explain *why* the signed-distance method beats the homothety method (equal radii). Senior rounds push into tangent graphs, Dubins paths, and robustness near degeneracy; professional rounds want the existence-discriminant proof of the count and the homothety-invariance proof that tangents concur at similarity centers. Memorize the cheat-sheet table, code the signed-distance solver until it is automatic, and always handle the inside-the-circle and equal-radius cases out loud.
