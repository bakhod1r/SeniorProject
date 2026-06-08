# Half-Plane Intersection — Interview Preparation

Half-plane intersection is the geometry interviewers reach for when they want to test whether you understand **convexity, duality, and linear programming** all at once — not just whether you can memorize a template. It is the dual of convex hull, the engine of 2D LP, and the answer to "polygon kernel / visibility" questions. The gotchas that separate a strong candidate from a weak one are sharp: the **both-end deque popping** (and *why* it differs from the convex-hull stack), the **parallel / unbounded / empty** cases, and **numerical robustness**. This file is a curated, tiered question bank with a multi-language coding challenge at the end.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Problem solved | Intersection of `m` half-planes `⋂{aᵢx+bᵢy ≤ cᵢ}` | A convex region. |
| Output | Convex polygon (bounded / unbounded / point / segment / empty) | Classify it. |
| Standard algorithm | Sort by angle + deque sweep | `O(m log m)`. |
| Why a deque | Angle is cyclic → boundary wraps past 180° | Pop from **both** ends. |
| Why hull uses a stack | `x` is linear → no wrap | One end suffices. |
| Side test | `cross(d, q − p) ≥ 0` | "q on allowed (left) side." |
| Corner | `inter(a,b) = a.p + a.d · cross(b.p−a.p, b.d)/cross(a.d, b.d)` | Divide-by-zero if parallel. |
| Unbounded handling | Add 4 big bounding-box half-planes | Edge on box ⇒ was unbounded. |
| Empty handling | Deque size < 3 after cleanup | Return EMPTY sentinel. |
| Incremental variant | Clip a polygon plane-by-plane | `O(m²)`, simple. |
| Dual problem | Convex hull (lower envelope ↔ upper hull) | Point–line duality. |
| 2D LP | Feasible region = intersection; optimum at a corner | Seidel: `O(m)` expected. |

Skeleton (the version to write by default):

```text
add bounding box; sort half-planes by atan2(d.y, d.x)
dq = empty deque
for h in sorted:
    if parallel to dq.back (same angle): keep tighter; continue
    while size>=2 and h.out(inter(dq[-1],dq[-2])): pop back
    while size>=2 and h.out(inter(dq[0], dq[1])):  pop front
    push back h
final cleanup front-vs-back; if size<3 -> EMPTY
corners = inter(dq[i], dq[i+1]) cyclically
```

Mental anchor: **half-plane intersection is convex hull turned inside-out** — sort by angle (not x), use a deque (not a stack), pop redundant corners (not non-left turns).

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a half-plane? | All points satisfying one linear inequality `a·x + b·y ≤ c`; one side of a line. |
| 2 | What does intersecting half-planes give you? | The set of points satisfying *all* the inequalities — a convex region. |
| 3 | Why is the result always convex? | Each half-plane is convex; intersection of convex sets is convex. |
| 4 | Can the result be empty? | Yes — contradictory constraints have no common point. |
| 5 | Can it be unbounded? | Yes — e.g. a wedge or strip; handle with a bounding box. |
| 6 | What's the one primitive used everywhere? | The cross product, for the side test and line intersection. |
| 7 | How do you test if a point is on the allowed side? | `cross(d, q − p) ≥ 0` (left of the directed boundary line). |
| 8 | What's the time complexity of the standard algorithm? | `O(m log m)`, dominated by the angular sort. |
| 9 | Why `log m`? | The initial sort by angle; the deque sweep itself is linear. |
| 10 | What data structure holds the active half-planes? | A deque (double-ended queue), kept sorted by angle. |
| 11 | Give a real use of half-plane intersection. | 2D LP feasibility, polygon visibility/kernel, convex clipping. |
| 12 | What's the simple-but-slow alternative? | Incremental clipping (Sutherland–Hodgman), `O(m²)`. |

### Selected junior answers

**Q1 — What is a half-plane?**
The set `{(x,y) : a·x + b·y ≤ c}` — every point on one side of the line `a·x + b·y = c`, including the line itself. It is infinite and convex.

**Q3 — Why is the result convex?**
A half-plane is a convex set (the segment between any two of its points stays inside). The intersection of any collection of convex sets is convex, so the half-plane intersection is convex — always a convex polygon (possibly unbounded/empty).

**Q7 — Side test.**
Represent the half-plane as a point `p` on its boundary plus a direction `d` along it, with "allowed = left of `d`." Then `q` is inside iff `cross(d, q − p) ≥ 0`. The sign of the cross product is the left/right turn test.

**Q8 — Time complexity.**
`O(m log m)`. The sort by angle dominates; the deque sweep is `O(m)` because each half-plane is pushed once and popped at most once. The `O(m²)` figure refers to the simpler incremental-clip variant, not the standard sweep.

**Q11 — Real use.**
The canonical one is **2D linear programming**: every `≤` constraint is a half-plane, the feasible region is their intersection, and the optimum sits at a corner. Others: the **kernel** of a polygon (points that see the whole room), convex **clipping** (cut a shape to a convex window), and any "find the region satisfying all these linear rules" task.

**Q12 — The slow alternative.**
Incremental clipping (Sutherland–Hodgman): start with a big box polygon and clip it by one half-plane at a time, keeping the allowed side. Each clip is `O(current polygon size) ≤ O(m)`, and there are `m` clips, so `O(m²)`. Simpler to code and reuses the clip-against-convex-window primitive — fine for small `m`.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Walk through the angle-sort + deque algorithm. | Sort by angle; pop redundant back/front corners; push; cleanup. |
| 2 | Why a deque and not a stack? | Angle is cyclic → boundary wraps past 180° → pop both ends. |
| 3 | Why does convex hull get away with a stack? | `x` is a linear order; the hull chain never wraps. |
| 4 | How do you handle parallel half-planes? | Same direction → keep tighter; opposite → strip or empty. |
| 5 | How do you handle unbounded regions? | Add 4 big bounding-box half-planes; box-incident edge ⇒ unbounded. |
| 6 | How do you detect an empty region? | Deque size < 3 after the final cleanup. |
| 7 | Prove the sweep is linear (ignoring the sort). | Each half-plane pushed once, popped ≤ once → ≤ 2m ops (aggregate). |
| 8 | What's the redundancy test exactly? | `h.out(inter(dq[-1], dq[-2]))` → pop back; symmetric for front. |
| 9 | How does this relate to 2D linear programming? | Feasible region = intersection; optimum at a vertex. |
| 10 | When choose `O(m²)` clip over `O(m log m)`? | Small `m`, clarity, or reusing the clip-against-window primitive. |
| 11 | Why must all half-planes share one orientation convention? | The side test's sign meaning is convention-dependent. |
| 12 | What goes wrong if you call `inter` on parallel lines? | Division by zero (`cross(d1,d2)=0`); detect parallels first. |
| 13 | How do you reconstruct the polygon from the final deque? | Corners = `inter(dq[i], dq[i+1])` in cyclic order. |
| 14 | Why sort by `atan2` rather than slope? | `atan2` distinguishes opposite directions; slope does not. |

### Selected middle answers

**Q2 — Why a deque, not a stack?**
Half-planes are sorted by *angle*, which is a cyclic coordinate `(−π, π]`. As the directions sweep past 180°, the feasible boundary "wraps around," so the oldest half-plane (front) and the newest (back) become cyclic neighbors. A new constraint can invalidate corners at **both** ends, so you must pop from both — that's a deque. Convex hull sorts points by `x`, a *linear* coordinate; the chain never wraps, so a stack (one end) is enough. The cyclic-vs-linear distinction is the whole reason for the data-structure difference.

**Q4 — Parallel half-planes.**
Detect by equal angle (`cross(d_i, d_j) ≈ 0`). If they point the **same** way, one is redundant — keep the tighter (more restrictive) one. If they point **opposite** ways, either they overlap (a valid strip, keep both) or they leave a gap (the region is **empty**). Detect parallels *before* calling the intersection routine to avoid divide-by-zero.

**Q7 — Linearity of the sweep.**
Use the aggregate (potential) method with `Φ = |deque|`. Each of the `m` half-planes is pushed exactly once. A pop strictly decreases `Φ`, and `Φ ≥ 0` starting from `0`, so total pops ≤ total pushes ≤ `m`. Hence ≤ `2m` deque operations — `O(m)`. The only super-linear cost is the `O(m log m)` sort.

**Q5 — Unbounded regions.**
Add four enormous bounding-box half-planes (`x ≥ −BIG`, `x ≤ BIG`, `y ≥ −BIG`, `y ≤ BIG`) before sorting. The sweep then always returns a finite polygon. Afterward, check whether any output edge lies on a bounding-box line — if so, the *true* region was unbounded in that direction. Choose `BIG` large enough never to clip a real region but small enough to avoid float blow-up in corner computations.

**Q9 — Relation to 2D LP.**
A 2D LP maximizes `c·x` subject to `m` linear `≤` constraints. Each constraint is a half-plane; the feasible region is their intersection. The optimum of a linear objective over a convex polygon is always attained at a **vertex** (or along an edge), so: run half-plane intersection, then evaluate the objective at each corner and take the best — `O(m)` after the `O(m log m)` intersection. If you only need feasibility or one optimum, Seidel's randomized LP does it in `O(m)` expected.

**Q12 — Parallel lines in `inter`.**
The corner formula divides by `cross(d1, d2)`, which is `0` when the two boundary lines are parallel — a divide-by-zero. So detect parallelism first (equal angle, or `|cross(d1,d2)| < EPS`) and branch: same direction → keep the tighter constraint; opposite direction → either a valid strip or an empty region.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a 2D LP feasibility service. | Validate/normalize, choose Seidel vs HPI, classify, observe. |
| 2 | When use Seidel's randomized LP instead of HPI? | Need only feasibility/one optimum → `O(m)` expected, not the region. |
| 3 | How do you compute a polygon's kernel? | Intersect the interior half-plane of every edge; `O(n log n)`. |
| 4 | What is the kernel, in plain terms? | Points that see the whole polygon; non-empty ⇒ star-shaped. |
| 5 | How do you make the geometry numerically robust? | Exact integer predicates for decisions; floats only for output coords. |
| 6 | How do you choose `BIG` for the bounding box? | Big enough not to clip real regions, small enough to avoid float blow-up. |
| 7 | How do you report an unbounded LP objective? | Optimum lands on a box edge ⇒ unbounded; don't return the box corner. |
| 8 | What's the API contract for degenerate output? | Always classify: BOUNDED/UNBOUNDED/EMPTY/POINT/SEGMENT. |
| 9 | Where does half-plane intersection sit in a clipping pipeline? | Convex window clipping; precompute window half-planes, clip per polygon. |
| 10 | How would you cache results across changing objectives? | Materialize region once; scan/relocate optimum over corners per objective. |
| 11 | What metrics would you monitor in production? | Result-kind distribution, p99 latency, parallel-pair count, NaN rejects. |

### Selected senior answers

**Q2 — Seidel vs HPI.**
If the caller needs the *shape* of the feasible region (to display, clip, or report active constraints), materialize it with the deque sweep — `O(m log m)`. If the caller only needs *yes/no feasibility* or *one optimal point*, use Seidel's randomized incremental LP: add constraints in random order, keep the running optimum, and when a constraint is violated re-solve a 1D LP on its line. By backward analysis (and Helly's theorem giving combinatorial dimension 3 in 2D), it runs in `O(m)` *expected* time — strictly cheaper than `O(m log m)` and it sidesteps materializing a possibly-unbounded region.

**Q3 — Polygon kernel.**
Walk the polygon's edges CCW. Each edge, extended to a line, has an interior side; that's a half-plane. The **kernel** is the intersection of all `n` edge half-planes — `O(n log n)` via the deque sweep. If non-empty, the polygon is star-shaped and any kernel point sees the entire polygon (guard placement, camera positioning). Empty kernel ⇒ no single point sees everything.

**Q5 — Robustness.**
Floating-point geometry can flip a corner inside/outside under noise, changing the whole classification. The disciplined fix: keep all **combinatorial decisions** (which half-plane is redundant, is the region empty) on **exact** predicates — integer cross products are exact, or use adaptive-precision/rational arithmetic — and compute floating-point **coordinates** of corners only at the very end for display. Decisions stay provably consistent; only rendered positions carry harmless float error.

**Q4 — The kernel in plain terms.**
The kernel of a polygon is the set of points from which you can see *every* point of the polygon — stand anywhere in the kernel and no wall blocks your view of any other wall. A polygon with a non-empty kernel is **star-shaped**. It is exactly the intersection of the interior half-plane of every edge, so it is a half-plane-intersection problem. Empty kernel means no single vantage point sees the whole room (you'd need multiple guards).

**Q6 — Choosing `BIG`.**
Too small and the box clips a genuinely large feasible region, giving a wrong answer; too large and the corner coordinates (especially where a steep line meets the box) overflow or lose precision. Scale `BIG` to the input magnitude — for coordinates up to ~`1e6`, `1e9` in double precision is a safe middle ground. Then treat any output vertex near `±BIG` as "at infinity."

**Q8 — Degenerate-output API contract.**
Never return a bare polygon and let the caller guess. Classify into a complete partition: `EMPTY` (no feasible point), `POINT`/`SEGMENT` (zero-area degenerate), `UNBOUNDED` (an edge touches the box), and `BOUNDED` (a genuine polygon). Each downstream consumer — a renderer, an LP optimizer, a guard placer — handles these differently, so the classification is part of the contract.

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the deque sweep correct. | Angular-monotonicity + live-corner invariants; induction. |
| 2 | State and justify the deque invariants. | (I1) sorted angles; (I2) each adjacent pair is a live vertex. |
| 3 | Prove the `Ω(m log m)` lower bound. | Reduce sorting via tangent lines to a parabola. |
| 4 | Explain the duality with convex hull formally. | Point–line duality; lower envelope ↔ upper hull; deque ↔ stack. |
| 5 | Why does the deque replace the hull's stack? | Cyclic (angle) vs linear (x) sweep coordinate → wrap-around. |
| 6 | How does Helly's theorem give `O(m)` LP? | Combinatorial dimension 3 in 2D; ≤3 constraints witness infeasibility. |
| 7 | Derive Seidel's `O(m)` expected time. | Backward analysis: `Pr[move] ≤ 2/i`, `Σ O(i)·2/i = O(m)`. |
| 8 | Classify all degenerate outputs. | EMPTY/POINT/SEGMENT/UNBOUNDED/BOUNDED — a complete partition. |
| 9 | How do robust predicates preserve the proof? | Exact-sign predicates make decisions match the exact-arithmetic proof. |
| 10 | What is an LP-type problem and how does this fit? | Monotone objective + small combinatorial dimension; `O(δ!·m)`. |

### Selected professional answers

**Q3 — `Ω(m log m)` lower bound.**
Reduce from sorting. Given reals `x₁,…,xₘ`, take the tangent lines to `y = x²` at `(xᵢ, xᵢ²)`: `y = 2xᵢ·x − xᵢ²`. Intersect the half-planes `y ≥ 2xᵢx − xᵢ²`. The boundary is the lower envelope of these tangents, and because they are tangents to a convex curve, the envelope's edges appear in **sorted order of `xᵢ`**. Reading the intersection boundary therefore sorts the inputs. Sorting is `Ω(m log m)` in the algebraic decision tree model, so half-plane intersection is too — making the angular sweep optimal.

**Q4 — Duality.**
Under `D: (a,b) ↦ y = a·x − b`, "point above line" ↔ "dual line below dual point." The **upper convex hull of `n` dual points** equals the **lower envelope of the `n` primal lines** = boundary of the intersection of "below-line" half-planes. So convex hull and half-plane intersection are the same algorithm in dual coordinates. The container differs only because the sweep coordinate differs: hull sorts by linear `x` (monotone chain, stack); intersection sorts by cyclic angle (wraps once around `2π`, deque).

**Q7 — Seidel's expected time.**
Process constraints in random order, maintaining the optimum vertex `v`. When constraint `i` is violated, `v` must move onto `∂Hᵢ`, costing an `O(i)` 1D LP. By backward analysis, the probability that constraint `i` (the last added among the first `i`) is one of the ≤ 2 constraints defining the optimum is `≤ 2/i` (Helly: in 2D the optimum is pinned by at most 2 constraints plus the objective). So `E[work] = Σᵢ O(i)·(2/i) = Σᵢ O(1) = O(m)`.

**Q2 — The deque invariants.**
Two invariants, maintained after each half-plane is processed. **(I1) Angular monotonicity:** the deque, read front-to-back, is sorted by angle, spanning less than `2π`. **(I2) Live-corner property:** every adjacent pair `(dq[i], dq[i+1])` intersects at a point that lies inside *all* currently-retained half-planes — i.e. it is a genuine vertex of the running region. Adding a new (largest-angle) half-plane pops any corner it excludes from both ends, restoring both invariants by a convex-chain argument. At termination the corners read off the deque are exactly the vertices of `⋂ Hᵢ`.

**Q5 — Deque vs stack, formally.**
Convex hull sorts points by the **linear** coordinate `x`; the resulting chain is monotone in `x` and never wraps, so each new point can only invalidate the *recent* end — a stack suffices. Half-plane intersection sorts by **angle**, a coordinate on the circle `(−π, π]`; as directions sweep past `π` the boundary wraps cyclically, so a new constraint can invalidate corners at the recent *and* the oldest end. That two-ended invalidation is exactly a deque. The invariant `θ(back) − θ(front) < 2π` guarantees we traverse the cycle once and never re-admit a popped plane.

**Q10 — LP-type problems.**
An LP-type (or "generalized LP") problem is an abstraction of optimization where you have a monotone objective `w` over subsets of constraints satisfying *monotonicity* (`w(A) ≤ w(B)` for `A ⊆ B`) and *locality*. Its difficulty is governed by the **combinatorial dimension** `δ` — the max number of constraints needed to pin the optimum. 2D LP has `δ = 3`, and Sharir–Welzl show such problems solve in `O(δ!·m)` expected time, i.e. `O(m)` for fixed `δ`. Half-plane *feasibility/optimization* is the canonical LP-type problem; the full-boundary version is not (it asks for `Θ(m)` output, not `O(1)` witnesses).

---

## Behavioral / System-Design Prompts

- *"We model a robot's safe operating region as ~10k linear constraints, updated 100×/sec. Design the pipeline."* — Discuss incremental updates, Seidel for feasibility, caching the region, robustness on sensor noise, latency SLAs.
- *"Your geometry service sometimes returns a polygon, sometimes 'empty', sometimes crashes on certain inputs. Diagnose."* — Likely a parallel-divide or missing bounding box; add classification, exact predicates, input validation.
- *"How would you test a half-plane-intersection implementation you can't fully trust?"* — Cross-check against the `O(m²)` clip on random inputs; property tests (every corner satisfies every constraint; result convex); degenerate fixtures.

---

## Variations You Might Be Asked to Code

These are common "now extend it" follow-ups after the base intersection. Know the one-line idea for each.

| Variation | Idea | Cost |
|-----------|------|------|
| Intersect two convex polygons | Treat every edge of both as a half-plane; run the sweep | `O((n+m) log(n+m))` |
| Polygon kernel | Each edge → interior half-plane; intersect | `O(n log n)` |
| 2D LP optimum | Intersect constraints, scan corners for max `c·x` | `O(m log m)` |
| Is a point set's constraint system feasible? | Run HPI; empty ⇔ infeasible | `O(m log m)` (or `O(m)` Seidel) |
| Largest inscribed circle (convex region) | Erode each half-plane by `r`; binary search `r` on feasibility | `O(m log m · log(1/ε))` |
| Convex clip a stream of polygons | Precompute window half-planes; Sutherland–Hodgman per polygon | `O(k)` per polygon |
| Area of feasible region | Intersect, then shoelace over corners | `O(m log m)` |

### Worked follow-up: largest inscribed circle

A frequent senior twist: *"find the largest circle that fits inside the feasible region."* The center is the point maximizing the **minimum distance to all constraint lines** — itself an LP. Erode each half-plane `a·x+b·y ≤ c` inward by `r` (replace `c` with `c − r·√(a²+b²)`), and binary-search the largest `r` for which the eroded system is still feasible. Each feasibility check is one half-plane intersection (or a Seidel call), so the total is `O(m log m · log(range/ε))`. This reuses the exact primitives from this topic — no new machinery.

---

## Rapid-Fire Round

Short questions an interviewer fires to probe depth:

- *Is the intersection always convex?* Yes — intersection of convex sets.
- *Can it have a hole?* No — convex sets have no holes.
- *Max number of edges with `m` half-planes?* `m` (each contributes at most one edge).
- *What if all `m` half-planes are identical?* The region is that single half-plane (unbounded); dedup to one.
- *Two half-planes — what's the result?* A wedge, a strip, a half-plane, or empty — never bounded.
- *Why `atan2` not `y/x` for the angle?* `atan2` distinguishes opposite directions and avoids division by zero.
- *Does the order of input half-planes matter?* No for the result; the algorithm sorts them. Order only affects Seidel's expected time (hence the random shuffle).
- *Is the empty case the same as the degenerate-point case?* No — empty means no point; a single point is a valid (zero-area) region. Classify them separately.

---

## Common Interview Traps

1. **Saying "use a stack like convex hull."** Wrong — angle is cyclic, you need a **deque** with both-end popping.
2. **Forgetting the bounding box.** Unbounded inputs then crash or return nonsense.
3. **Calling `inter` on parallel lines.** Division by zero; detect parallels by equal angle first.
4. **Not handling empty.** Reading corners from a deque of size < 3 yields garbage.
5. **Inconsistent epsilon.** Different tolerances in the sort and the side test contradict each other.
6. **Confusing it with convex hull of points.** Hull wraps points; intersection cuts a region — duals, not the same input.
7. **Claiming `O(m log m)` is optimal for feasibility.** Only for the *boundary*; feasibility is `O(m)` via Seidel.

---

## Coding Challenge (3 Languages)

### Challenge: Feasibility + maximize a linear objective

> Given `m` constraints `aᵢ·x + bᵢ·y ≤ cᵢ` and an objective `(ox, oy)`, decide whether the system is feasible, and if so return the maximum value of `ox·x + oy·y` over the feasible region. Assume a bounded region for the objective (bounding box guards it). Build each half-plane from the inequality, intersect, then scan the corners.
>
> Example: constraints `x ≥ 0` (`−x ≤ 0`), `y ≥ 0` (`−y ≤ 0`), `x + y ≤ 4`; objective `(1, 2)` → feasible, max `= 8` at corner `(0, 4)`.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

type Vec struct{ X, Y float64 }

func sub(a, b Vec) Vec       { return Vec{a.X - b.X, a.Y - b.Y} }
func cross(a, b Vec) float64 { return a.X*b.Y - a.Y*b.X }

type HP struct{ P, D Vec }

func (h HP) angle() float64 { return math.Atan2(h.D.Y, h.D.X) }
func (h HP) out(q Vec) bool { return cross(h.D, sub(q, h.P)) < -1e-9 }

func inter(a, b HP) Vec {
	t := cross(sub(b.P, a.P), b.D) / cross(a.D, b.D)
	return Vec{a.P.X + a.D.X*t, a.P.Y + a.D.Y*t}
}

// fromIneq builds a half-plane for a*x + b*y <= c (allowed = left of D).
func fromIneq(a, b, c float64) HP {
	var p Vec
	if math.Abs(a) > math.Abs(b) {
		p = Vec{c / a, 0}
	} else {
		p = Vec{0, c / b}
	}
	// inward normal is (-a,-b); direction with allowed-on-left is (-b, a)
	return HP{p, Vec{-b, a}}
}

func solve(planes []HP, obj Vec) (bool, float64) {
	const BIG = 1e9
	hp := append([]HP{}, planes...)
	hp = append(hp, fromIneq(-1, 0, BIG), fromIneq(1, 0, BIG),
		fromIneq(0, -1, BIG), fromIneq(0, 1, BIG))
	sort.Slice(hp, func(i, j int) bool {
		if math.Abs(hp[i].angle()-hp[j].angle()) < 1e-9 {
			return cross(hp[i].D, sub(hp[j].P, hp[i].P)) < 0
		}
		return hp[i].angle() < hp[j].angle()
	})
	dq := []HP{}
	for _, h := range hp {
		if len(dq) > 0 && math.Abs(dq[len(dq)-1].angle()-h.angle()) < 1e-9 {
			continue
		}
		for len(dq) >= 2 && h.out(inter(dq[len(dq)-1], dq[len(dq)-2])) {
			dq = dq[:len(dq)-1]
		}
		for len(dq) >= 2 && h.out(inter(dq[0], dq[1])) {
			dq = dq[1:]
		}
		dq = append(dq, h)
	}
	for len(dq) >= 3 && dq[0].out(inter(dq[len(dq)-1], dq[len(dq)-2])) {
		dq = dq[:len(dq)-1]
	}
	if len(dq) < 3 {
		return false, 0
	}
	best := math.Inf(-1)
	for i := range dq {
		p := inter(dq[i], dq[(i+1)%len(dq)])
		if v := obj.X*p.X + obj.Y*p.Y; v > best {
			best = v
		}
	}
	return true, best
}

func main() {
	planes := []HP{fromIneq(-1, 0, 0), fromIneq(0, -1, 0), fromIneq(1, 1, 4)}
	ok, val := solve(planes, Vec{1, 2})
	fmt.Println(ok, val) // true 8
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static double cross(double ax, double ay, double bx, double by){ return ax*by - ay*bx; }
    static class HP {
        double px, py, dx, dy;
        HP(double px,double py,double dx,double dy){this.px=px;this.py=py;this.dx=dx;this.dy=dy;}
        double angle(){ return Math.atan2(dy, dx); }
        boolean out(double qx,double qy){ return cross(dx,dy,qx-px,qy-py) < -1e-9; }
    }
    static double[] inter(HP a, HP b){
        double t = cross(b.px-a.px, b.py-a.py, b.dx, b.dy) / cross(a.dx, a.dy, b.dx, b.dy);
        return new double[]{a.px+a.dx*t, a.py+a.dy*t};
    }
    static HP fromIneq(double a, double b, double c){
        double px, py;
        if (Math.abs(a) > Math.abs(b)) { px = c/a; py = 0; } else { px = 0; py = c/b; }
        return new HP(px, py, -b, a);
    }
    static double[] solve(List<HP> planes, double ox, double oy){
        final double BIG = 1e9;
        List<HP> hp = new ArrayList<>(planes);
        hp.add(fromIneq(-1,0,BIG)); hp.add(fromIneq(1,0,BIG));
        hp.add(fromIneq(0,-1,BIG)); hp.add(fromIneq(0,1,BIG));
        hp.sort((a,b)-> Math.abs(a.angle()-b.angle())<1e-9
            ? (cross(a.dx,a.dy,b.px-a.px,b.py-a.py)<0?-1:1) : Double.compare(a.angle(),b.angle()));
        List<HP> dq = new ArrayList<>();
        for (HP h: hp){
            if (!dq.isEmpty() && Math.abs(dq.get(dq.size()-1).angle()-h.angle())<1e-9) continue;
            while (dq.size()>=2){ double[] p=inter(dq.get(dq.size()-1),dq.get(dq.size()-2));
                if (h.out(p[0],p[1])) dq.remove(dq.size()-1); else break; }
            while (dq.size()>=2){ double[] p=inter(dq.get(0),dq.get(1));
                if (h.out(p[0],p[1])) dq.remove(0); else break; }
            dq.add(h);
        }
        while (dq.size()>=3){ double[] p=inter(dq.get(dq.size()-1),dq.get(dq.size()-2));
            if (dq.get(0).out(p[0],p[1])) dq.remove(dq.size()-1); else break; }
        if (dq.size()<3) return new double[]{0, Double.NaN};
        double best = -1e18;
        for (int i=0;i<dq.size();i++){ double[] p=inter(dq.get(i), dq.get((i+1)%dq.size()));
            best = Math.max(best, ox*p[0]+oy*p[1]); }
        return new double[]{1, best};
    }
    public static void main(String[] args){
        List<HP> planes = new ArrayList<>(List.of(fromIneq(-1,0,0), fromIneq(0,-1,0), fromIneq(1,1,4)));
        double[] r = solve(planes, 1, 2);
        System.out.println((r[0]==1) + " " + r[1]); // true 8.0
    }
}
```

#### Python

```python
import math
from functools import cmp_to_key


def cross(ax, ay, bx, by):
    return ax * by - ay * bx


class HP:
    def __init__(self, px, py, dx, dy):
        self.px, self.py, self.dx, self.dy = px, py, dx, dy
    def angle(self):
        return math.atan2(self.dy, self.dx)
    def out(self, q):
        return cross(self.dx, self.dy, q[0] - self.px, q[1] - self.py) < -1e-9


def inter(a, b):
    t = cross(b.px - a.px, b.py - a.py, b.dx, b.dy) / cross(a.dx, a.dy, b.dx, b.dy)
    return (a.px + a.dx * t, a.py + a.dy * t)


def from_ineq(a, b, c):
    p = (c / a, 0.0) if abs(a) > abs(b) else (0.0, c / b)
    return HP(p[0], p[1], -b, a)  # allowed = left of direction (-b, a)


def solve(planes, obj):
    BIG = 1e9
    hp = list(planes) + [from_ineq(-1, 0, BIG), from_ineq(1, 0, BIG),
                         from_ineq(0, -1, BIG), from_ineq(0, 1, BIG)]

    def cmp(a, b):
        if abs(a.angle() - b.angle()) < 1e-9:
            return -1 if cross(a.dx, a.dy, b.px - a.px, b.py - a.py) < 0 else 1
        return -1 if a.angle() < b.angle() else 1

    hp.sort(key=cmp_to_key(cmp))
    dq = []
    for h in hp:
        if dq and abs(dq[-1].angle() - h.angle()) < 1e-9:
            continue
        while len(dq) >= 2 and h.out(inter(dq[-1], dq[-2])):
            dq.pop()
        while len(dq) >= 2 and h.out(inter(dq[0], dq[1])):
            dq.pop(0)
        dq.append(h)
    while len(dq) >= 3 and dq[0].out(inter(dq[-1], dq[-2])):
        dq.pop()
    if len(dq) < 3:
        return (False, None)
    best = -math.inf
    for i in range(len(dq)):
        p = inter(dq[i], dq[(i + 1) % len(dq)])
        best = max(best, obj[0] * p[0] + obj[1] * p[1])
    return (True, best)


if __name__ == "__main__":
    planes = [from_ineq(-1, 0, 0), from_ineq(0, -1, 0), from_ineq(1, 1, 4)]
    print(solve(planes, (1, 2)))  # (True, 8.0)
```

**What it does:** builds half-planes from raw inequalities, intersects them, and maximizes a linear objective over the feasible region's corners — a self-contained 2D LP.
**Run:** `go run main.go` | `javac Solution.java && java Solution` | `python solution.py`

---

## How to Drive the Whiteboard Solution

A clean order of operations when asked to implement this live:

1. **State the representation.** "I'll store each half-plane as a point on its boundary plus a direction, with allowed = left of the direction." This pre-empts the orientation confusion that sinks most attempts.
2. **Write the two primitives first.** The side test `cross(d, q−p) ≥ 0` and the corner `inter(a,b)`. Everything else calls these.
3. **Add the bounding box.** Mention up front that it keeps unbounded regions finite — interviewers love that you anticipated it.
4. **Sort by angle**, then the **deque loop** with back-pop, front-pop, push.
5. **Final cleanup + size check.** Close the cycle; if `< 3`, report empty.
6. **Read corners.** `inter(dq[i], dq[i+1])` cyclically.
7. **Test on a known case.** The unit square or the `x≥0, y≥0, x+y≤4` triangle — verify the corners by hand.

Narrate the *why* of the deque at step 4: "I use a deque, not a stack like convex hull, because angle is cyclic and the boundary can wrap past 180°, invalidating both ends." That single sentence demonstrates real understanding.

### Complexity you should state without hesitation

```text
Standard (full region):   O(m log m) time, O(m) space   — sort dominates.
Incremental clip:         O(m²) time                      — simpler fallback.
Feasibility / one optimum: O(m) expected (Seidel)         — boundary not needed.
```

### Red flags interviewers watch for

- Using a stack and getting wrap-around cases wrong.
- Dividing in `inter` without a parallel guard.
- No empty/unbounded handling.
- Scattered, inconsistent epsilons.
- Confusing this with "convex hull of points" — they are duals, not the same input.

---

## Rapid-Fire Round

Short questions to test instant recall — say the answer in one breath.

- **Q.** Why a deque and not a stack? **A.** Half-planes sorted by angle can be made redundant from *both* ends, so you pop front and back.
- **Q.** What is the time complexity, and what dominates it? **A.** `O(m log m)` — the angle sort dominates; the deque pass is linear.
- **Q.** What does an empty result mean? **A.** The constraints are infeasible (no point satisfies all half-planes).
- **Q.** How do you detect an unbounded region? **A.** Add four bounding-box half-planes; if the result touches them, the true region was unbounded.
- **Q.** What is the dual of half-plane intersection? **A.** Convex hull of points — same algorithm shape, dual input.
- **Q.** Two half-planes with the same angle — which do you keep? **A.** The more restrictive one (smaller offset on the allowed side); discard the other.
- **Q.** Where do you allow floats and where not? **A.** Coordinates may be float; the side/orientation *decisions* should use exact predicates.
- **Q.** When is feasibility cheaper than full construction? **A.** Seidel's randomized LP decides feasibility in expected `O(m)` without building the boundary.

---

## Final Tips

- Lead with the **mental anchor**: "half-plane intersection is convex hull turned inside-out."
- Volunteer the **deque-vs-stack** insight unprompted — it signals you understand *why*, not just *how*.
- Name the three failure cases — **parallel, unbounded, empty** — before the interviewer asks.
- If asked for feasibility only, mention **Seidel's `O(m)`** to show you know the boundary-construction lower bound doesn't bind.
- For robustness, say "exact predicates for decisions, floats only for coordinates."

---

**Next step:** [tasks.md](./tasks.md) — graded practice tasks (beginner → advanced) in Go, Java, and Python.
