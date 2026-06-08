# Circle–Circle Intersection — Interview Preparation

Circle–circle intersection is a favorite geometry warm-up and a recurring building block in systems interviews (GPS/trilateration, collision detection, sensor coverage). It is short enough to code on a whiteboard, but it hides several gotchas that separate a candidate who memorized the formula from one who understands the geometry: the **`d` vs `r1+r2` / `|r1-r2|`** classification, the **a/h construction**, the **concentric divide-by-zero**, the **tangent radicand clamp**, and *why* you compare squared distances for collision. This file is a curated question bank by seniority, plus a coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Inputs | `(c1, r1)`, `(c2, r2)` | centers and radii |
| Center distance | `d = |c1 - c2|` | use `hypot` (overflow-safe) |
| Sum threshold | `r1 + r2` | beyond it ⇒ separate |
| Diff threshold | `|r1 - r2|` | below it ⇒ one inside other |
| Chord-foot distance | `a = (d² + r1² - r2²) / (2d)` | signed; measured from `c1` |
| Half chord | `h = sqrt(r1² - a²)` | clamp radicand to `≥ 0` |
| Foot point | `F = c1 + a·û`, `û = (c2-c1)/d` | on the center line |
| The points | `F ± h·n̂`, `n̂ = (-û.y, û.x)` | mirror across `c1c2` |
| # points | 0 / 1 / 2 / ∞ | by classification |
| Overlap test (fast) | `d² ≤ (r1 + r2)²` | no `sqrt`, integer-exact |
| Lens area | two circular segments | branch nested/separate first |
| Complexity | **O(1)** | no loops |

Classification (read `==`/`<`/`>` with `EPS`):
```
d == 0 and r1 == r2  -> Identical (∞)
d > r1 + r2          -> Separate (0)
d == r1 + r2         -> External tangent (1)
|r1-r2| < d < r1+r2  -> Two intersections (2)
d == |r1 - r2|       -> Internal tangent (1)
d < |r1 - r2|        -> One contains other (0)
```

Mental anchor: **one number, `d`, decides the relationship; the a/h recipe places the points.**

---

## Junior Questions (12 Q&A)

### J1. What does circle–circle intersection compute?
Given two circles, it answers two things: *what is their relationship* (separate, tangent, two crossings, one-inside-other, identical) and *where do they cross* (the 0, 1, or 2 intersection points). Both are constant-time computations driven by the distance `d` between the centers.

### J2. How do you classify the relationship?
Compute `d = |c1 - c2|` and compare it to `r1 + r2` (sum of radii) and `|r1 - r2|` (difference). If `d > r1+r2` they're separate; `d == r1+r2` externally tangent; `|r1-r2| < d < r1+r2` two crossings; `d == |r1-r2|` internally tangent; `d < |r1-r2|` one inside the other; and `d == 0` with equal radii means identical.

### J3. Why those two thresholds — `r1+r2` and `|r1-r2|`?
`r1 + r2` is the farthest the two boundaries can reach toward each other; beyond it they can't touch. `|r1 - r2|` is the gap the bigger radius must close to reach the smaller circle from inside; below it the small circle is fully contained. The "two-crossing" band is exactly between them.

### J4. What is the time complexity?
O(1). There are no loops — just a distance, a couple of comparisons, and (for the points) one square root. The difficulty is numerical care, not algorithmic complexity.

### J5. How do you find the intersection points once they cross?
The a/h construction. Compute `a = (d² + r1² - r2²)/(2d)`, the distance from `c1` to the foot of the common chord along the line of centers. Then `h = sqrt(r1² - a²)`, the half-length of the chord. The two points are `F ± h·n̂` where `F = c1 + a·û`, `û` is the unit vector from `c1` to `c2`, and `n̂` is its perpendicular.

### J6. What is the common chord?
The straight segment joining the two intersection points. It is perpendicular to the line joining the centers, and the two intersection points are mirror images across that center line — which is why the construction adds `+h` and `-h`.

### J7. Why must you be careful comparing `d` to the thresholds?
Because `d` is a floating-point number. `d == r1 + r2` almost never holds exactly even when the circles really are tangent. Use a tolerance: `abs(d - (r1+r2)) < EPS`. Tangency (the one-point cases) is the fragile boundary.

### J8. What happens with concentric circles (`d = 0`)?
The line of centers has no direction, and the a/h formula divides by `d`. You must special-case `d ≈ 0` *before* dividing: equal radii ⇒ identical (infinitely many points); unequal ⇒ one inside the other (no points).

### J9. How do you avoid a `NaN` from the square root?
Near tangency, `r1² - a²` can come out as a tiny negative number due to rounding. Clamp it: `h = sqrt(max(0, r1² - a²))`. Then `h ≈ 0` correctly yields the single tangent point.

### J10. What's the fast way to check just "do they overlap?"
Compare squared distances: `d² ≤ (r1 + r2)²`. This skips the `sqrt` entirely and, for integer coordinates, is exact. It's the standard collision broad-phase test when you don't need the actual points.

### J11. How many intersection points can two circles have?
Zero (separate or nested), one (tangent, external or internal), two (proper crossing), or infinitely many (identical circles). For distinct circles it's at most two.

### J12 (analysis). Why are the two points mirror images across the line of centers?
Both circles are symmetric about the line through their centers, so their intersection set is too. The construction encodes this: the foot `F` lies on that line, and `±h` along the perpendicular produces the symmetric pair. When `h = 0` the pair collapses to one point on the line — tangency.

### J13. Walk a concrete example: `(0,0),5` and `(8,0),5`.
`d = 8`, `r1+r2 = 10`, `|r1-r2| = 0`. Since `0 < 8 < 10`, two intersections. `a = (64+25-25)/16 = 4`, `h = sqrt(25-16) = 3`. Direction `û = (1,0)`, perpendicular `n̂ = (0,1)`, foot `F = (4,0)`, points `(4,3)` and `(4,-3)`. Verify: `4²+3² = 25 = 5²` on both circles. ✓

### J14. What does a radius-0 circle mean here?
A radius-0 circle is just a point. It "intersects" the other circle only if that point lies exactly on the other circle's boundary, i.e. `d == r_other`. It's a degenerate but valid input worth special-casing for clarity.

---

## Middle Questions (12 Q&A)

### M1. Derive the `a` formula.
Put `c1` at the origin and `c2` at `(d, 0)`. The circles are `x²+y²=r1²` and `(x-d)²+y²=r2²`. Subtract: `x² - (x-d)² = r1² - r2²`, i.e. `2dx - d² = r1² - r2²`, so `x = (d² + r1² - r2²)/(2d) = a`. Then `y² = r1² - a² = h²`. Mapping back to the real frame gives the points.

### M2. What is the radical axis?
The locus of points with equal *power* to both circles, where power is `|P - c|² - r²`. Subtracting the two circle equations cancels the quadratic terms and leaves a linear equation — that line is the radical axis. For intersecting circles it's the common-chord line; it's always perpendicular to the line of centers and crosses it at distance `a` from `c1`.

### M3. How do you compute the area of the overlap (lens)?
The lens is the sum of two circular segments, one cut from each circle by the common chord. Each segment is *sector minus triangle*. A clean closed form: `r1²·acos((d²+r1²-r2²)/(2·d·r1)) + r2²·acos((d²+r2²-r1²)/(2·d·r2)) - ½·sqrt((-d+r1+r2)(d+r1-r2)(d-r1+r2)(d+r1+r2))`. Branch out the nested and separate cases first or `acos` gets an out-of-range argument.

### M4. What's the lens area when one circle contains the other?
It's the whole smaller disk: `π·min(r1, r2)²`. And when they're separate (or externally tangent), it's `0`. You must handle these two cases explicitly before the `acos` formula, which is only valid in the proper two-crossing band.

### M5. Can `a` be negative? What does that mean?
Yes. `a` is a *signed* distance from `c1` along the direction to `c2`. When `r2` is much larger than `r1`, the chord foot sits *behind* `c1` and `a < 0`. The formula still works; just don't assume `a` lies between the centers.

### M6. What's the difference between external and internal tangent?
External tangent (`d = r1 + r2`): the circles touch from outside, the point on the segment between the centers. Internal tangent (`d = |r1 - r2|`): one circle touches the other from inside, the point on the center line but outside the segment. Both give `h = 0` and a single point; the algebra (`a = r1` when `r1 > r2`) is the same.

### M7. How is this related to circle–line intersection?
A line is a circle of infinite radius. Circle–line intersection is the limiting case and uses the same idea: project the center onto the line to get the foot, then Pythagoras for the half-chord. The radical-axis/common-chord machinery degenerates accordingly.

### M8. Why prefer the squared-distance test for collision?
It avoids `sqrt`, which is slower and introduces floating-point error. For integer coordinates, `d² ≤ (r1+r2)²` is exact — no epsilon needed. You only compute `sqrt` after a confirmed hit, to get the penetration depth `(r1+r2) - d` and contact normal.

### M9. How do you make the intersection numerically stable when `r1 ≈ r2`?
The numerator `d² + r1² - r2²` subtracts two near-equal large squares, causing cancellation. Factor it: `d² + (r1-r2)(r1+r2)`. Similarly compute `h² = (r1-a)(r1+a)` instead of `r1² - a²`. Both avoid forming and subtracting large squares, preserving precision.

### M10. How do you handle a zero-radius circle?
A radius-0 circle is a point. It "intersects" another circle iff that point lies on the other circle, i.e. `d == r_other` (within EPS). The general a/h formula still degenerates correctly, but it's clearer to special-case it.

### M11. Why does dilution of precision (GDOP) matter here?
When two circles cross at a *shallow* angle (centers nearly collinear with the crossing), a tiny error in `d` or the radii moves the intersection point a lot — the configuration is ill-conditioned. In trilateration this is GDOP: prefer anchors that make the circles cross near-perpendicularly.

### M12b. How would you disambiguate the two intersection points in 2-D trilateration?
Two circles give two candidates. Use a third constraint: a third anchor circle (the right one passes near exactly one candidate), a domain prior (the target must be inside the building / on the road), or a motion prior (the candidate consistent with the previous position and max speed). Without a third piece of information, the two-circle problem is genuinely ambiguous.

### M12 (analysis). Why can't you compute a tangent point to full precision?
At tangency, `h² = (r1 - a)(r1 + a)` with `a ≈ r1`, so `(r1 - a)` is a difference of near-equal numbers — its relative error is O(1). Then `h = sqrt(h²)` inherits that error. This is intrinsic conditioning, not a bug: you can reliably *detect* tangency but not pin the touch point to machine precision.

---

## Senior Questions (10 Q&A)

### S1. How does circle–circle intersection power trilateration?
Each known distance to an anchor is a circle: "I'm somewhere on this circle." Two circles give two candidate positions; a third disambiguates. That's 2-D GPS/positioning in a nutshell. The exact two-circle intersection is the noiseless kernel; real systems are over-determined and noisy (next question).

### S2. Real range measurements are noisy and the circles don't meet cleanly. What do you do?
Switch from exact intersection to least squares. Subtracting pairs of circle equations linearizes the system (the radical-axis trick), giving a closed-form linear-LS estimate — the radical center. For best accuracy, refine with nonlinear least squares (Gauss–Newton/Levenberg–Marquardt) minimizing `Σ(|P-c_i| - r_i)²`, seeded by the linear solution, with a robust loss to reject outlier (NLOS) anchors.

### S3. How do you scale "which of n circles overlap which" past O(n²)?
Add a broad-phase. Bucket circles into a uniform grid (cell ≈ 2·max-radius), a quadtree, or sweep-and-prune on AABB intervals; only test pairs sharing or neighboring a cell. That turns O(n²) into roughly O(n + k) where k is the actual overlap count. The narrow-phase stays the O(1) squared-distance test.

### S4. How do you avoid fast objects tunneling through each other?
Continuous collision detection. For two moving disks, solve `|c1(t) - c2(t)|² = (r1 + r2)²` for the earliest `t` in `[0,1]` — a quadratic in time. It's still O(1) per pair but never misses a crossing that happens *between* frames.

### S5. Where does precision go in the a/h construction, and how do you defend it?
Three spots: `a`'s numerator (cancellation when `r1 ≈ r2` → factor it), `h`'s radicand (cancellation near tangency → factor and clamp), and division by `d` (blows up near concentric → branch). Also shift the origin to the local centroid before computing when coordinates are large, to avoid losing digits in `d²`.

### S6. How do you choose the tolerance EPS?
Scale it to the data: `EPS_eff = EPS · max(1, |c1|, |c2|, r1, r2)`. A fixed `1e-9` is meaningless if coordinates are in millions or micrometers. Use the scaled tolerance for all boundary tests so classification is stable and doesn't flicker as a circle moves.

### S7. How would you get a *certified* (exact) classification?
Avoid `sqrt`: classification reduces to the signs of two polynomials, `S+ = (r1+r2)² - d²` and `S- = d² - (r1-r2)²`, with `d²` expanded from coordinates. For integer or rational inputs these signs are computable exactly with big integers — no epsilon. The intersection *points* are irrational, so they can't be exact in float, but the *case* can be certified (CGAL-style filtered predicates do exactly this).

### S8. How do you observe a positioning or collision service?
Track LS residual, GDOP (geometry quality), anchors-used, and how often you fell back to "closest approach" when circles missed. For collision, track narrow-phase tests vs actual collision pairs — if tests balloon while real pairs stay flat, your broad-phase grid is mis-sized for the current radius distribution.

### S9. What are the main failure modes at scale?
No-intersection-under-noise (project to closest approach instead of stalling), near-concentric anchors (divide-by-zero, de-dup them), high GDOP (collinear geometry, report and reject), tangency misclassification (scaled EPS), broad-phase mis-sizing (wrong cell size → O(n²) again), tunneling (need CCD), and outlier/NLOS ranges (robust loss/RANSAC).

### S10 (analysis). Why is the linear-LS trilateration solve essentially the radical center?
Each pairwise subtraction of circle equations is a radical axis (a line). Stacking several and solving in the least-squares sense finds the point closest to all those lines — which, for three circles with no noise, is exactly their common radical center. So noisy trilateration is the statistically-robust generalization of "intersect the radical axes."

### S11. How do you weight anchors of unequal quality?
Weight each range constraint by `1/σ_i²`, the inverse variance, so trustworthy (near, line-of-sight) anchors dominate the fit: `argmin Σ (1/σ_i²)(|p−c_i|−r_i)²`. When variances are unknown, heuristics like `1/r_i` (closer is usually better) or dropping anchors whose post-fit residual exceeds `kσ` work well. This is the difference between a fit dragged off by one multipath-corrupted tower and a robust one.

### S12. If you can choose which anchors to use, how do you choose?
Pick the subset that minimizes GDOP, not the strongest signals. Greedily start with the two anchors whose circles cross most perpendicularly, then add anchors that most reduce `trace((JᵀJ)⁻¹)`. Anchors surrounding the target beat a strong cluster on one side — geometry usually matters more than signal strength for position accuracy.

---

## Professional Questions (8 Q&A)

### P1. Prove the reality condition for the intersection points.
The points are real iff `h² = r1² - a² ≥ 0`, i.e. `a² ≤ r1²`. Substituting `a = (d²+r1²-r2²)/(2d)` and simplifying the two-sided inequality `|d² + r1² - r2²| ≤ 2 d r1` yields `|d - r1| ≤ r2` and the symmetric bound, which together give `|r1 - r2| ≤ d ≤ r1 + r2`. That is exactly the secant/tangent band; outside it `h²<0` and there are no real points.

### P2. Derive the lens-area formula and show the triangle terms collapse.
The common chord splits the lens into two segments. Segment `i` = sector − triangle = `r_i²·θ_i - ½ r_i² sin 2θ_i` with `θ1 = acos(a/r1)`, `θ2 = acos((d-a)/r2)`. The triangle parts are `½ r1² sin2θ1 = a·h` and `½ r2² sin2θ2 = (d-a)·h`; summing gives `d·h`, which equals twice the area of triangle `c1 c2 P`, i.e. `½·sqrt(Heron product)`. Hence `Area = r1²θ1 + r2²θ2 - ½·sqrt((-d+r1+r2)(d+r1-r2)(d-r1+r2)(d+r1+r2))`.

### P3. Why does conditioning degrade near concentric and near tangent?
From `a = (d²+r1²-r2²)/(2d)`, `∂a/∂r ∝ 1/d`, so error amplification grows as `d→0` (concentric → high GDOP). From `h = sqrt(r1²-a²)`, `∂h/∂a = -a/h → ∞` as `h→0` (tangent). The first is the source of trilateration instability with close anchors; the second makes tangent-point coordinates intrinsically imprecise.

### P4. How would a robust geometry library represent the intersection points?
Not as floats. The points lie in a quadratic field extension `ℚ(√·)` — irrational even for integer inputs. Libraries keep them as algebraic numbers (root representations) or use root-separation interval arithmetic, refining precision only when a downstream comparison is ambiguous. Classification, by contrast, uses exact-sign polynomial predicates (`S+`, `S-`) that need no `sqrt`.

### P5. Generalize to spheres in 3-D.
Two spheres intersect (when `|r1-r2| < d < r1+r2`) in a *circle*, not points. The same `a = (d²+r1²-r2²)/(2d)` gives the plane of intersection (perpendicular to the center line at distance `a`), and `h = sqrt(r1²-a²)` is now the *radius* of that intersection circle, centered at `c1 + a·û`. The radical axis becomes a radical plane; this is the basis of 3-D GPS trilateration.

### P6. Design a sensor-coverage analyzer for a million disks.
Build a spatial index (uniform grid for similar radii, hierarchical grid or loose quadtree for varied radii). For overlap queries use the squared-distance narrow-phase; for total covered area, build the arrangement of the disks (whose vertices are circle–circle intersection points) and integrate arc contributions. Parallelize over grid cells; use a Z-order layout for cache locality; report progress and handle degenerate concentric/tangent inputs explicitly.

### P7. How do you keep classification stable for a moving circle near a boundary?
Use a scaled tolerance `EPS_eff` and treat any configuration within `EPS_eff` of a boundary as the boundary case. This prevents "chatter" — a moving circle flickering between "secant" and "tangent" frame to frame. For certified stability, use exact-sign predicates with a floating-point filter that falls back to exact arithmetic only in the ambiguous band.

### P8. Why do two circles really have *four* intersections, and where are two of them?
By Bézout's theorem two conics (degree 2 each) meet in `2·2 = 4` points over the complex projective plane. Every circle passes through the two *circular points at infinity* `(1, ±i, 0)`, so any two circles automatically share those two — leaving the two affine points we compute. When the circles are apart, those two affine points are a complex-conjugate pair (the discriminant `r1²−a² < 0`); "no real intersection" means "the intersection is complex." This is why subtracting the equations drops to a line: the shared degree-2 behavior at the circular points cancels.

### P9 (analysis). Why is the factored form `d² + (r1-r2)(r1+r2)` numerically superior?
Computing `r1² - r2²` directly forms two large squares (`~max(r²)`) and subtracts them; the absolute rounding error is `~ε_mach·max(r²)`, which can dwarf the true (small) result when `r1≈r2`. The factored form `(r1-r2)(r1+r2)` has error `~ε_mach·|r1-r2|·(r1+r2)` — orders of magnitude smaller when the radii are large but close. A concrete case: `r1=r2=10⁶`, the direct form can carry absolute error `~2e-4`; the factored form is exact (`0`).

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used a geometric primitive in a real system.
Look for a concrete story: the problem (collision in a game/robotics sim, indoor positioning, coverage analysis), the primitive (circle/disk overlap), the alternative considered (full physics vs simple disk test), and a measured outcome (e.g. switching to squared-distance + grid broad-phase cut frame time by N×). Bonus for a surprise — a concentric/tangent edge case that bit you.

### B2. Design an indoor positioning system from Wi-Fi/BLE distances.
Each access point gives a distance → a circle. Core is trilateration (circle intersection). Discuss: noise and NLOS handling (robust LS, outlier rejection), anchor geometry/GDOP, the linear-LS seed + nonlinear refine pipeline, fallback when circles don't meet, and reporting a covariance so consumers know the uncertainty. Draw the pipeline.

### B3. Design the collision system for a 2-D game with 100k agents.
Model agents as disks. Broad-phase (uniform grid or sweep-and-prune) to prune to O(n+k) candidate pairs; narrow-phase squared-distance test; resolve with separation/impulse. Discuss CCD for fast projectiles (quadratic-in-time test), grid cell sizing vs radius distribution, and parallelizing over cells. Mention you only compute `sqrt` on confirmed hits.

### B4. A junior asks "why not just use `==` to check if two circles are tangent?" How do you respond?
Floating-point distances almost never equal the threshold exactly, so `==` will say "not tangent" when they really are (or vice versa). Use a tolerance scaled to the data, and prefer formulating boundary tests as polynomial sign checks (`(r1+r2)² - d²`) which avoid `sqrt` and, for integer inputs, can be exact. Teach choosing the comparison by the data's nature, not habit.

### B5. Your positioning service started returning wild locations. How do you investigate?
First check geometry/GDOP — collinear or near-concentric anchors make the solve ill-conditioned. Then audit for outlier ranges (NLOS multipath reporting too-long distances) and check the EPS scaling against the coordinate magnitude. Look at the fallback counter (circles missing under noise). Add a residual/GDOP guardrail that flags or rejects low-confidence fixes before serving.

### B6. How would you test a circle-intersection implementation thoroughly?
Three property-based checks beat a handful of examples. (1) Round-trip incidence: for any computed point, assert it lies on both circles to a scaled residual — catches sign and swap errors. (2) Exact oracle: generate integer circles, classify exactly via the polynomial signs `(r1+r2)²−d²` and `d²−(r1−r2)²`, and assert the float classifier agrees away from the boundary band. (3) Area invariants: lens area is in `[0, π·min(r)²]`, decreases monotonically as `d` grows through the secant band, and hits the boundary limits — catches the forgotten nested/separate branch.

### B7. A teammate's collision code is slow at 50k agents. What do you look at first?
Almost certainly the broad-phase, not the circle test. If they're testing all `C(n,2)` pairs that's `O(n²)` — 1.25 billion tests at 50k agents. Add a uniform grid or sweep-and-prune so only nearby pairs reach the narrow-phase, turning it into `O(n + k)`. Also confirm they use the squared-distance test (no `sqrt`) in the inner loop and only compute contact data on confirmed hits.

---

## Rapid-Fire Round (15 one-liners)

Quick-recall questions an interviewer may fire to probe breadth. Answer in a sentence.

| # | Question | Answer |
|---|----------|--------|
| 1 | Distance formula for `d`? | `sqrt((x2-x1)² + (y2-y1)²)`, ideally via `hypot`. |
| 2 | Threshold for "touching from outside"? | `d = r1 + r2`. |
| 3 | Threshold for "one inside the other"? | `d = |r1 - r2|`. |
| 4 | Formula for `a`? | `(d² + r1² - r2²)/(2d)`. |
| 5 | Formula for `h`? | `sqrt(r1² - a²)`. |
| 6 | What is the common chord? | The segment joining the two intersection points, ⟂ to `c1c2`. |
| 7 | Max intersection points for distinct circles? | Two. |
| 8 | When are there infinitely many? | Identical circles (`d=0`, `r1=r2`). |
| 9 | Fast overlap test? | `d² ≤ (r1+r2)²`, no `sqrt`. |
| 10 | Lens area of nested circles? | `π·min(r1,r2)²`. |
| 11 | Lens area when separate? | `0`. |
| 12 | Radical axis is perpendicular to what? | The line of centers `c1c2`. |
| 13 | Power of a point w.r.t. a circle? | `|P - c|² - r²`. |
| 14 | Sphere–sphere intersection shape (3-D)? | A circle (radius `h`, in a plane at distance `a`). |
| 15 | Why factor `r1² - r2²`? | Avoid cancellation when `r1 ≈ r2`. |

---

## Coding Challenge (3 Languages)

### Challenge — Classify, intersect, and measure overlap

> Implement a function that, given two circles, returns: (1) their relationship as a label, (2) the list of intersection points (0, 1, or 2), and (3) the area of their overlap. Handle the concentric, tangent, and nested cases robustly. Each solution must produce the expected output for the test cases.
>
> Expected for `((0,0),5)` and `((8,0),5)`: relation `TwoPoints`, points `(4,-3),(4,3)`, lens area `≈ 8.1751`.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

const EPS = 1e-9

type Pt struct{ X, Y float64 }
type Circle struct {
	C Pt
	R float64
}

func d(a, b Pt) float64 { return math.Hypot(a.X-b.X, a.Y-b.Y) }

func classify(c1, c2 Circle) string {
	dd := d(c1.C, c2.C)
	sum := c1.R + c2.R
	diff := math.Abs(c1.R - c2.R)
	switch {
	case dd < EPS && diff < EPS:
		return "Identical"
	case dd > sum+EPS:
		return "Separate"
	case math.Abs(dd-sum) <= EPS:
		return "ExternallyTangent"
	case dd < diff-EPS:
		return "OneContainsOther"
	case math.Abs(dd-diff) <= EPS:
		return "InternallyTangent"
	default:
		return "TwoPoints"
	}
}

func intersect(c1, c2 Circle) []Pt {
	dd := d(c1.C, c2.C)
	sum, diff := c1.R+c2.R, math.Abs(c1.R-c2.R)
	if dd > sum+EPS || dd < diff-EPS || (dd < EPS && diff < EPS) {
		return nil
	}
	// Factored numerator to avoid cancellation when r1 ~ r2.
	a := (dd*dd + (c1.R-c2.R)*(c1.R+c2.R)) / (2 * dd)
	h := math.Sqrt(math.Max(0, (c1.R-a)*(c1.R+a)))
	ux, uy := (c2.C.X-c1.C.X)/dd, (c2.C.Y-c1.C.Y)/dd
	fx, fy := c1.C.X+a*ux, c1.C.Y+a*uy
	if h < EPS {
		return []Pt{{fx, fy}}
	}
	pts := []Pt{{fx - h*uy, fy + h*ux}, {fx + h*uy, fy - h*ux}}
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	return pts
}

func lensArea(c1, c2 Circle) float64 {
	dd := d(c1.C, c2.C)
	r1, r2 := c1.R, c2.R
	if dd >= r1+r2-EPS {
		return 0
	}
	if dd <= math.Abs(r1-r2)+EPS {
		rm := math.Min(r1, r2)
		return math.Pi * rm * rm
	}
	p1 := r1 * r1 * math.Acos((dd*dd+r1*r1-r2*r2)/(2*dd*r1))
	p2 := r2 * r2 * math.Acos((dd*dd+r2*r2-r1*r1)/(2*dd*r2))
	t := (-dd + r1 + r2) * (dd + r1 - r2) * (dd - r1 + r2) * (dd + r1 + r2)
	p3 := 0.5 * math.Sqrt(math.Max(0, t))
	return p1 + p2 - p3
}

func main() {
	c1 := Circle{Pt{0, 0}, 5}
	c2 := Circle{Pt{8, 0}, 5}
	fmt.Println(classify(c1, c2))            // TwoPoints
	fmt.Println(intersect(c1, c2))           // [{4 -3} {4 3}]
	fmt.Printf("%.4f\n", lensArea(c1, c2))   // 8.1751
}
```

#### Java

```java
import java.util.*;

public class CircleIntersection {
    static final double EPS = 1e-9;

    record Pt(double x, double y) {}
    record Circle(double cx, double cy, double r) {}

    static double d(Circle a, Circle b) {
        return Math.hypot(a.cx() - b.cx(), a.cy() - b.cy());
    }

    static String classify(Circle c1, Circle c2) {
        double dd = d(c1, c2), sum = c1.r() + c2.r(), diff = Math.abs(c1.r() - c2.r());
        if (dd < EPS && diff < EPS) return "Identical";
        if (dd > sum + EPS) return "Separate";
        if (Math.abs(dd - sum) <= EPS) return "ExternallyTangent";
        if (dd < diff - EPS) return "OneContainsOther";
        if (Math.abs(dd - diff) <= EPS) return "InternallyTangent";
        return "TwoPoints";
    }

    static List<Pt> intersect(Circle c1, Circle c2) {
        double dd = d(c1, c2), sum = c1.r() + c2.r(), diff = Math.abs(c1.r() - c2.r());
        if (dd > sum + EPS || dd < diff - EPS || (dd < EPS && diff < EPS))
            return List.of();
        double a = (dd * dd + (c1.r() - c2.r()) * (c1.r() + c2.r())) / (2 * dd);
        double h = Math.sqrt(Math.max(0, (c1.r() - a) * (c1.r() + a)));
        double ux = (c2.cx() - c1.cx()) / dd, uy = (c2.cy() - c1.cy()) / dd;
        double fx = c1.cx() + a * ux, fy = c1.cy() + a * uy;
        if (h < EPS) return List.of(new Pt(fx, fy));
        List<Pt> pts = new ArrayList<>(List.of(
            new Pt(fx - h * uy, fy + h * ux),
            new Pt(fx + h * uy, fy - h * ux)));
        pts.sort(Comparator.comparingDouble(Pt::x).thenComparingDouble(Pt::y));
        return pts;
    }

    static double lensArea(Circle c1, Circle c2) {
        double dd = d(c1, c2), r1 = c1.r(), r2 = c2.r();
        if (dd >= r1 + r2 - EPS) return 0;
        if (dd <= Math.abs(r1 - r2) + EPS) {
            double rm = Math.min(r1, r2);
            return Math.PI * rm * rm;
        }
        double p1 = r1 * r1 * Math.acos((dd * dd + r1 * r1 - r2 * r2) / (2 * dd * r1));
        double p2 = r2 * r2 * Math.acos((dd * dd + r2 * r2 - r1 * r1) / (2 * dd * r2));
        double t = (-dd + r1 + r2) * (dd + r1 - r2) * (dd - r1 + r2) * (dd + r1 + r2);
        double p3 = 0.5 * Math.sqrt(Math.max(0, t));
        return p1 + p2 - p3;
    }

    public static void main(String[] args) {
        Circle c1 = new Circle(0, 0, 5), c2 = new Circle(8, 0, 5);
        System.out.println(classify(c1, c2));               // TwoPoints
        System.out.println(intersect(c1, c2));              // [(4,-3),(4,3)]
        System.out.printf("%.4f%n", lensArea(c1, c2));      // 8.1751
    }
}
```

#### Python

```python
import math

EPS = 1e-9


def d(c1, c2):
    return math.hypot(c1[0][0] - c2[0][0], c1[0][1] - c2[0][1])


def classify(c1, c2):
    (_, r1), (_, r2) = c1, c2
    dd, s, diff = d(c1, c2), r1 + r2, abs(r1 - r2)
    if dd < EPS and diff < EPS:
        return "Identical"
    if dd > s + EPS:
        return "Separate"
    if abs(dd - s) <= EPS:
        return "ExternallyTangent"
    if dd < diff - EPS:
        return "OneContainsOther"
    if abs(dd - diff) <= EPS:
        return "InternallyTangent"
    return "TwoPoints"


def intersect(c1, c2):
    (p1, r1), (p2, r2) = c1, c2
    dd, s, diff = d(c1, c2), r1 + r2, abs(r1 - r2)
    if dd > s + EPS or dd < diff - EPS or (dd < EPS and diff < EPS):
        return []
    a = (dd * dd + (r1 - r2) * (r1 + r2)) / (2 * dd)   # factored numerator
    h = math.sqrt(max(0.0, (r1 - a) * (r1 + a)))       # factored radicand
    ux, uy = (p2[0] - p1[0]) / dd, (p2[1] - p1[1]) / dd
    fx, fy = p1[0] + a * ux, p1[1] + a * uy
    if h < EPS:
        return [(fx, fy)]
    return sorted([(fx - h * uy, fy + h * ux), (fx + h * uy, fy - h * ux)])


def lens_area(c1, c2):
    (_, r1), (_, r2) = c1, c2
    dd = d(c1, c2)
    if dd >= r1 + r2 - EPS:
        return 0.0
    if dd <= abs(r1 - r2) + EPS:
        rm = min(r1, r2)
        return math.pi * rm * rm
    p1 = r1 * r1 * math.acos((dd * dd + r1 * r1 - r2 * r2) / (2 * dd * r1))
    p2 = r2 * r2 * math.acos((dd * dd + r2 * r2 - r1 * r1) / (2 * dd * r2))
    t = (-dd + r1 + r2) * (dd + r1 - r2) * (dd - r1 + r2) * (dd + r1 + r2)
    p3 = 0.5 * math.sqrt(max(0.0, t))
    return p1 + p2 - p3


if __name__ == "__main__":
    c1, c2 = ((0, 0), 5), ((8, 0), 5)
    print(classify(c1, c2))                  # TwoPoints
    print(intersect(c1, c2))                 # [(4.0, -3.0), (4.0, 3.0)]
    print("%.4f" % lens_area(c1, c2))        # 8.1751
```

---

## Common Pitfalls

1. **Using `==` on floating-point distances** — tangency needs a scaled `EPS` tolerance.
2. **Dividing by `d` without checking `d ≈ 0`** — concentric circles produce `Inf`/`NaN`.
3. **Forgetting `|r1 - r2|`** — only checking `r1 + r2` misses nested and internal-tangent cases.
4. **Letting `sqrt` see a negative radicand** — clamp `r1² - a²` (or its factored form) to `≥ 0`.
5. **Calling `acos` without branching nested/separate first** — out-of-range argument → `NaN`.
6. **Returning two identical points for a tangent** — detect `h ≈ 0` and return one point.
7. **Cancellation when `r1 ≈ r2`** — factor `r1² - r2²` and `r1² - a²`.
8. **Treating overlap-area as if circles always cross** — handle containment (`π·min(r)²`) and separation (`0`).
9. **Unscaled EPS at large/small coordinate magnitudes** — scale tolerance to the data.
10. **Computing `sqrt` for a pure overlap boolean** — use `d² ≤ (r1+r2)²` instead.

---

## What Interviewers Are Really Testing

- **Do you reach for `d` vs `r1+r2`/`|r1-r2|` immediately?** That single comparison is the whole classification; naming it unprompted signals understanding.
- **The a/h construction and *why* it works.** Anyone can memorize the formula; deriving it by subtracting the two circle equations (the radical-axis idea) shows depth.
- **Numerical maturity.** Concentric divide-by-zero, tangent radicand clamp, scaled EPS, and the squared-distance shortcut separate production-ready candidates from textbook ones.
- **Systems instinct.** Connecting the primitive to trilateration/GPS (least squares, GDOP) and collision (broad-phase + narrow-phase, CCD) is senior-level judgment.
- **Edge-case discipline.** Zero radius, identical circles, nested disks, near-tangency — handling these without prompting shows real-world readiness.
- **Communication.** Walking the small worked example (compute `d`, classify, find `a` and `h`, verify the points) clearly matters as much as the code.

---

## A 60-Second Whiteboard Script

If asked to "implement circle intersection," narrate this so the interviewer follows your reasoning:

1. "First the relationship: I compute `d` between centers and compare to `r1+r2` and `|r1-r2|` — that gives me separate / tangent / two-points / nested / identical in O(1)."
2. "I'll guard the concentric case `d ≈ 0` before any division, since the construction divides by `d`."
3. "For the points I use the a/h construction: `a = (d²+r1²-r2²)/(2d)` walks along the center line to the chord foot; `h = sqrt(r1²-a²)` steps perpendicular. The two points are `F ± h·n̂`."
4. "I clamp the radicand to `≥ 0` so a near-tangent rounding wobble can't produce NaN, and treat `h ≈ 0` as a single tangent point."
5. "If they only want overlap yes/no, I'd skip the `sqrt` and compare `d² ≤ (r1+r2)²` — faster and exact for integers."
6. "I'd test it with a round-trip check: both points must lie on both circles."

Hitting all six — classify, concentric guard, a/h, clamp, squared-distance shortcut, round-trip test — demonstrates exactly the production maturity interviewers are listening for, and it takes under a minute before you even write code.

---

## Scenario Drills (3)

Short open-ended prompts to rehearse out loud.

### D1. "Two GPS-like circles cross at a very shallow angle. What worries you?"
Conditioning. A shallow crossing (`d` near `r1+r2`, i.e. near-tangent) means a tiny range error moves the intersection a lot — high GDOP. I'd flag the fix as low-confidence, prefer anchors that cross near-perpendicularly, and if forced to report, attach a large covariance so consumers know the uncertainty along the chord direction is poor.

### D2. "You must compute the overlap area of 10,000 disks. Plan it."
Don't do `O(n²)` pairwise lens areas — that double-counts and is slow. Build the arrangement of the circle boundaries (vertices are pairwise intersection points, found via a grid broad-phase to avoid `O(n²)` candidate pairs), then integrate arc contributions per face with a Green's-theorem line integral. Use robust/filtered predicates so one bad intersection point doesn't corrupt the topology. It's output-sensitive: `~O((n+k) log n)`.

### D3. "A circle is moving; classification flickers between secant and tangent each frame. Fix it."
That's `ε` chatter at the boundary. Use a tolerance scaled to the data and treat anything within `ε_eff` of the threshold as the boundary case (tangent), so it doesn't oscillate. For certified stability, classify by the integer/polynomial sign predicates with a float filter that falls back to exact arithmetic only in the ambiguous band — no flicker, exact verdict.
