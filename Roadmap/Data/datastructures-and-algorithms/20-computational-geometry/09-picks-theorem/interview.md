# Pick's Theorem and Lattice-Point Geometry — Interview Preparation

Pick's theorem is a favorite in coding interviews and competitive programming because it compresses a whole class of "count the integer points" problems into one tiny identity, `Area = I + B/2 − 1`, backed by two cheap computations: the **shoelace formula** for area and a **gcd per edge** for the boundary count. Candidates who only memorized the formula stumble on the gotchas — keeping arithmetic integer (`2A` form), the lattice-vertex and simplicity preconditions, the gcd boundary trick, holes (`+h`), and the fact that **none of this works in 3-D** (the Reeve tetrahedron). This file is a tiered question bank plus an end-to-end coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Pick's theorem | `A = I + B/2 − 1` | `I` interior pts, `B` boundary pts. |
| Interior count | `I = A − B/2 + 1 = (2A − B + 2)/2` | Integer-exact. |
| Twice area (shoelace) | `2A = |Σ(x_i·y_{i+1} − x_{i+1}·y_i)|` | Always an integer for lattice polygon. |
| Boundary count | `B = Σ gcd(|dx_e|, |dy_e|)` | One gcd per edge; `gcd(d,0)=d`. |
| Total lattice pts | `I + B = (2A + B + 2)/2` | Interior + boundary. |
| Holes (`h` of them) | `A = I + B/2 − 1 + h` | Standard Pick assumes `h = 0`. |
| Precondition 1 | **All vertices lattice points** | Else formula invalid. |
| Precondition 2 | **Simple polygon** | No self-intersection. |
| Dimension | **2-D only** | Reeve tetrahedron kills 3-D. |
| Time | `O(n log C)` | `n` vertices, `C` max coordinate. |

Skeleton (the version to write by default):

```text
2A = abs( sum over edges of x1*y2 - x2*y1 )       # shoelace, integer
B  = sum over edges of gcd(|x2-x1|, |y2-y1|)       # boundary
I  = (2A - B + 2) // 2                             # Pick, exact
```

Mental anchor: **shoelace gives area, gcd gives boundary, Pick converts between area and interior count.**

---

## Junior Questions (12 Q&A)

### J1. State Pick's theorem.
For a simple polygon whose vertices are all lattice points (integer coordinates), `Area = I + B/2 − 1`, where `I` is the number of lattice points strictly inside the polygon and `B` is the number of lattice points on its boundary (including corners).

### J2. What are `I` and `B` exactly?
`I` counts lattice points strictly *inside* the polygon — not touching any edge. `B` counts lattice points lying *on* the boundary, which includes the polygon's corners and any grid point an edge passes through. Every lattice point in or on the polygon is counted in exactly one of the two.

### J3. How do you compute the area of a lattice polygon?
Use the shoelace formula: `2A = |Σ (x_i·y_{i+1} − x_{i+1}·y_i)|` over consecutive vertices (wrapping the last back to the first), then `A = 2A/2`. For lattice vertices, `2A` is always an integer, so the computation is exact.

### J4. How do you count the boundary lattice points `B`?
For each edge from `(x1,y1)` to `(x2,y2)`, the number of lattice points on it (excluding one endpoint) is `gcd(|x2−x1|, |y2−y1|)`. Sum that over all edges; because each edge excludes one endpoint, every corner is counted exactly once, giving the total `B`.

### J5. Why does `gcd` count boundary points?
Writing `dx = g·a`, `dy = g·b` with `g = gcd(|dx|,|dy|)` and `gcd(a,b)=1`, the lattice points on the segment occur at fractions `j/g` of the way along, for `j = 0..g`. That is `g+1` points including both ends, or `g` excluding one. The coprime step `(a,b)` is the smallest lattice step along the edge.

### J6. How do you get the interior count `I` from area and boundary?
Rearrange Pick: `I = A − B/2 + 1`. In integer-only form, `I = (2A − B + 2)/2`. The numerator is always even for a valid lattice polygon, so the division is exact.

### J7. Give a quick example.
Triangle `(0,0), (4,0), (0,3)`. Shoelace: `2A = 12`, so `A = 6`. Boundary: `gcd(4,0)+gcd(4,3)+gcd(0,3) = 4+1+3 = 8`. Interior: `I = 6 − 8/2 + 1 = 3`. Check Pick: `3 + 4 − 1 = 6 = A`. ✓

### J8. What does a unit triangle (vertices `(0,0),(1,0),(0,1)`) give?
`A = ½`, `I = 0`, `B = 3`. Pick: `0 + 3/2 − 1 = ½`. ✓ This "primitive triangle" of area `½` is the building block of the whole theorem.

### J9. Why keep arithmetic in `2A` form?
Because `2A` (the raw shoelace sum's absolute value) is always an integer, while `A` may be a half-integer. Working in `2A` avoids floating-point and the `0.5` rounding bugs that plague naive implementations. Divide by 2 only at the very end.

### J10. What are the two preconditions?
(1) Every vertex must be a lattice point (integer coordinates). (2) The polygon must be simple — no self-intersections. Violate either and the formula gives nonsense.

### J11. What is `gcd(d, 0)`?
It is `d`. So a horizontal or vertical edge of length `d` contributes `d` boundary points, which is correct — there are `d` lattice steps along it.

### J12 (analysis). Why is Pick faster than counting points directly?
Direct counting scans every cell in the bounding box: `O(W·H)`, which explodes for large polygons. Pick costs `O(n)` in the number of vertices and is *independent of the polygon's size* — a triangle spanning a billion units costs the same as a tiny one.

---

## Middle Questions (12 Q&A)

### M1. Derive `I = (2A − B + 2)/2` from Pick's theorem.
Start from `A = I + B/2 − 1`. Multiply by 2: `2A = 2I + B − 2`. Solve for `I`: `2I = 2A − B + 2`, so `I = (2A − B + 2)/2`. Since Pick guarantees `2A − B + 2 = 2I`, the numerator is even and the division is exact.

### M2. How do you count interior points of a triangle without the full polygon machinery?
A triangle's `2A` is `|cross product|` of two edge vectors: `|(bx−ax)(cy−ay) − (cx−ax)(by−ay)|`. Its `B` is the sum of three edge gcds. Then `I = (2A − B + 2)/2`. No general polygon loop needed.

### M3. How do you count *all* lattice points (interior plus boundary)?
`I + B = (2A − B + 2)/2 + B = (2A + B + 2)/2`. Equivalently, evaluate the Ehrhart polynomial at `t=1`: `L(1) = A + B/2 + 1 = I + B`.

### M4. A polygon's vertices are clockwise. What happens?
The shoelace sum comes out negative. Take the absolute value: `2A = |sum|`. Orientation does not affect `I` or `B`, only the *sign* of the signed area.

### M5. How does Pick change for a polygon with holes?
`A = I + B/2 − 1 + h`, where `h` is the number of holes, `B` counts lattice points on all boundary loops (outer and inner), and `I` excludes hole interiors. Each hole adds `+1` because it is an extra closed loop (its own Euler-characteristic contribution).

### M6. Why does the parity of `2A − B + 2` matter?
For a valid lattice polygon, `2A − B + 2 = 2I` is even. If your computed `2A − B + 2` is odd, the input is invalid — a non-lattice vertex or a self-intersection. It is a free, `O(1)` validity check.

### M7. When does Pick fail and what replaces it?
It fails for non-lattice vertices (use per-column lattice counting or Ehrhart/floor-sum formulas), self-intersecting polygons (must be simple), and any 3-D problem (use Ehrhart polynomials, not a `(I,B)` formula). For holes, add `+h` rather than abandoning Pick.

### M8. How does Pick relate to the shoelace formula?
They are complementary. Shoelace computes `A` from vertices. Pick relates `A` to the lattice counts `I` and `B`. The standard pipeline is: shoelace → `A`, gcd-sum → `B`, then Pick → `I`. Neither replaces the other.

### M9. What is a primitive (unimodular) triangle and why does it matter?
A lattice triangle whose only lattice points are its 3 vertices (`I=0, B=3`). Its area is exactly `1/2`. Pick's proof triangulates any lattice polygon into such triangles and adds up areas — they are the atoms of the theorem.

### M10. How do you avoid overflow with large coordinates?
The shoelace term `x_i·y_{i+1}` can reach `C²`; the sum reaches `n·C²`. For `C=10^9, n=10^5` that overflows 64-bit. Fixes: use 64-bit when safe, shift all vertices by the first vertex to shrink magnitudes, or escalate to big integers (`BigInteger`/`math/big`/Python int).

### M11. What is the connection between the gcd boundary trick and the Farey sequence?
Both are governed by coprimality. The lattice points visible from the origin are the coprime pairs `(p,q)`, which are exactly the Farey fractions `p/q`. A segment's interior lattice points correspond to non-coprime steps; the gcd measures how many times the primitive step `(dx/g, dy/g)` fits. So gcd boundary counting and Farey/Stern–Brocot enumeration are two views of the same coprimality structure.

### M12 (analysis). Why is `2A` guaranteed to be an integer?
Each shoelace term `x_i·y_{i+1} − x_{i+1}·y_i` is a difference of products of integers (lattice coordinates), hence an integer; the sum of integers is an integer; absolute value preserves integrality. So `2A ∈ ℤ`, which is the foundation of the exact-integer pipeline.

---

## Senior Questions (10 Q&A)

### S1. How does Pick's theorem appear in image analysis?
A binary region's traced contour is a lattice polygon (pixels are lattice points). Pick gives the continuous enclosed area `A = I + B/2 − 1` and, separately, the pixel count `I + B`. The difference `B/2 + 1` is the boundary half-pixel correction. Pick's integer-exactness makes the measurement bit-for-bit reproducible across hardware — valuable for medical imaging and regression testing.

### S2. Pixel count vs polygon area — which does a consumer want?
It depends. "How many sensor cells fired" wants `I + B` (the pixel count). "What is the physical area in mm²" wants the continuous `A`. They differ by `B/2 + 1`. Exposing both and documenting which downstream metric needs which prevents a classic off-by-half-boundary bug.

### S3. How do you make a Pick computation robust at extreme scale?
With lattice inputs there is no precision problem — only magnitude. Shift vertices by `v₀` to shrink coordinates, use 64-bit while `2n·C² < 2^63`, and escalate to big integers otherwise. Add the `(2A − B + 2)` parity gate to catch silent overflow (which usually breaks parity) and invalid input.

### S4. What is a unimodular transformation and why is it useful here?
An integer matrix with determinant `±1` maps `ℤ²` bijectively to itself, so it preserves `I`, `B`, and `A` of any lattice polygon. You can apply one to rotate or shear a problem into a convenient orientation (e.g. axis-align an edge) without changing the answer — a common simplification for lattice-counting problems.

### S5. State the Ehrhart polynomial for a 2-D lattice polygon and connect it to Pick.
`L(t) = A·t² + (B/2)·t + 1` counts lattice points in the `t`-fold dilation. At `t=1`, `L(1) = A + B/2 + 1 = I + B`, which rearranges to Pick's `A = I + B/2 − 1`. So Pick is the `t=1` slice of Ehrhart, and the polynomial's coefficients are area, half-boundary, and the Euler characteristic `1`.

### S6. Why does Pick's theorem not generalize to 3-D?
The Reeve tetrahedron `conv{(0,0,0),(1,0,0),(0,1,0),(1,1,r)}` has `I=0` and `B=4` for *every* `r`, but volume `r/6` — infinitely many volumes from one fixed `(I,B)`. No function `vol = f(I,B)` can do that, so no Pick-type formula exists in 3-D. You need the full Ehrhart polynomial (multiple dilations) or Barvinok's algorithm.

### S7. How would you validate a Pick implementation in production?
Parity gate (`2A − B + 2` even), simplicity check (no self-intersection), and a sampled cross-check against a brute-force grid scan on small inputs (ground truth). Track `parity_fail_rate` and `bigint_escalation_rate`; a non-zero parity-fail rate means an upstream producer is emitting non-lattice or non-simple polygons.

### S8. What is the fallback when preconditions are violated?
For non-lattice vertices, per-column lattice counting (`O(W·n)`) or rational-polytope formulas. For self-intersection, fix the tracer or use a grid scan. The architecture is: fast exact Pick for the common case, validator, and a slower-but-correct fallback so the system degrades gracefully instead of returning silent garbage.

### S9. How do holes interact with the boundary count?
With `h` holes, `B` must include lattice points on *all* boundary components, and `I` must exclude points inside the holes. Then `A = I + B/2 − 1 + h`. Forgetting the `+h` (or miscounting hole boundaries) is the usual bug.

### S10 (analysis). Why is integer-exactness a bigger deal in lattice geometry than in general computational geometry?
Most computational-geometry algorithms (orientation tests, line intersection) fight floating-point round-off and need epsilon tuning. Pick on lattice inputs is *entirely integer*: `2A` and `B` are exact, so results are deterministic and reproducible. That eliminates a whole category of robustness bugs — the only remaining concern is overflow (a magnitude issue, not a precision one).

---

## Professional Questions (8 Q&A)

### P1. Prove the gcd boundary-count formula.
Let `dx = g·a`, `dy = g·b` with `g = gcd(|dx|,|dy|)`, `gcd(a,b)=1`. A point `p + λ(dx,dy)` is a lattice point iff `λ·g ∈ ℤ`. Using `ma + nb = 1`, `λg = m(λga) + n(λgb) ∈ ℤ`, so `λ ∈ {0, 1/g, …, 1}`. That gives `g+1` lattice points including both endpoints, `g` excluding one. Summing over edges (each excluding one endpoint) counts each corner once → `B = Σ gcd`.

### P2. Prove Pick's theorem via Euler's formula.
Triangulate the polygon into `T` primitive triangles (area `1/2` each). The planar graph has `V = I + B` vertices, `F = T + 1` faces. Counting edge–triangle incidences gives `2E = 3T + B`. Euler `V − E + F = 2` becomes `(I+B) − (3T+B)/2 + (T+1) = 2`, simplifying to `T = 2I + B − 2`. Since `A = T/2`, `A = I + B/2 − 1`. The `−1` is the disk's Euler characteristic `χ = 1`.

### P3. Why does a primitive triangle have area exactly 1/2?
Translate a vertex to the origin; edge vectors `u, v`. Primitivity (no lattice points but the 3 vertices) forces `{u,v}` to be a basis of `ℤ²`, so `|det(u,v)| = 1` and `area = ½|det| = 1/2`. Equivalently, the fundamental parallelogram of `ℤu+ℤv` contains no extra lattice point, meaning `ℤu+ℤv = ℤ²`.

### P4. State and interpret the additivity of the Pick functional.
Define `Pick(Q) = I(Q) + B(Q)/2 − 1`. If `Q = Q₁ ∪ Q₂` glued along a shared lattice edge with `k` lattice points, then `I(Q) = I(Q₁)+I(Q₂)+(k−2)` and `B(Q) = B(Q₁)+B(Q₂)−2(k−2)−2`, and these combine to `Pick(Q) = Pick(Q₁)+Pick(Q₂)`. Additivity plus the primitive-triangle base case gives Pick for all lattice polygons by induction.

### P5. State Ehrhart–Macdonald reciprocity and connect it to Pick.
`L_P(−t) = (−1)^d L_{P°}(t)`, where `P°` is the open interior. For `d=2, t=1`: `L_P(−1) = L_{P°}(1) = I`. Computing `L_P(−1) = A·1 − B/2 + 1 = A − B/2 + 1 = I` — exactly the rearranged Pick formula. Reciprocity is the deep reason interior and boundary counts have the symmetric Pick relationship.

### P6. Walk through the Reeve tetrahedron's volume and counts.
`T_r = conv{(0,0,0),(1,0,0),(0,1,0),(1,1,r)}`. `vol = (1/6)|det[(1,0,0),(0,1,0),(1,1,r)]| = r/6`. Its only lattice points are the 4 vertices, so `I=0, B=4` for all `r≥1`. Since `(I,B)` is constant but volume varies, no `(I,B)`-formula for volume can exist in 3-D. Reeve introduced these to motivate Ehrhart theory.

### P7. Derive the holes-corrected Pick formula.
Re-run the Euler derivation with region Euler characteristic `χ = 1 − h` (disk with `h` punctures) instead of `χ = 1`. The constant becomes `−χ = −(1−h) = −1 + h`, giving `A = I + B/2 − 1 + h`. The additive constant in every Pick/Ehrhart statement is `−χ`.

### P8 (analysis). What is the exactness/overflow analysis of the integer pipeline?
`2A` and `B` are integers; `2A − B + 2 = 2I` is even, so `I` is exact with no rounding. The overflow bound is `|2A| ≤ 2n·C²`; choose 64-bit when `2n·C² < 2^63`, else big integers. Vertex-shifting by `v₀` reduces effective `C` to the polygon's diameter. Parity failure flags both invalid input and silent overflow.

---

## Behavioral / Problem-Solving Questions (5 short)

### B1. When did you choose Pick's theorem (or reject it) for a real problem?
Look for a structured story: the problem (e.g. counting integer points in a region, measuring an image blob), why the inputs were lattice points, the alternatives (grid scan, integration), and what tipped the decision (size-independence, integer-exactness). A strong answer mentions validating preconditions and a fallback for invalid input.

### B2. Explain Pick's theorem to a junior who has never seen it.
Draw graph paper, a triangle on grid crossings, point at the inside dots (`I`) and the on-the-line dots (`B`), and show `Area = I + B/2 − 1` matches `½·base·height`. Then show the two helpers: shoelace for area, gcd for boundary. The clarity of the explanation is the signal.

### B3. A teammate applied Pick to a polygon with floating-point vertices and got a fractional interior count. Diagnose.
The vertices are not lattice points, so Pick simply does not apply — the `2A − B + 2` numerator came out odd/fractional. Either snap to the lattice (if that is meaningful) or switch to per-column lattice counting / a rational-polytope formula. Add a parity/integer-vertex validation gate so this is caught automatically.

### B4. How would you test a Pick implementation?
Known-answer shapes: unit triangle (`A=½,I=0,B=3`), unit square (`A=1,I=0,B=4`), a big right triangle. Randomized differential testing against a brute-force grid scan on small polygons. Edge cases: clockwise orientation, collinear (degenerate), horizontal/vertical edges (`gcd(d,0)=d`), and a polygon with a hole.

### B5. Someone proposes extending your 2-D lattice-area service to 3-D volumes "with the same idea." Respond.
Politely stop them: Pick does not generalize to 3-D — the Reeve tetrahedron proves no `(I,B)`→volume formula exists. The correct 3-D tool is Ehrhart polynomials (count lattice points in dilations, read volume off the leading coefficient) or Barvinok's algorithm for general counting. Set expectations on the added complexity.

---

## Coding Challenge

### Challenge — Lattice-Point Census of a Simple Polygon

Given a simple polygon as an ordered list of integer vertices, return a triple `(A2, B, I)` where `A2 = 2·Area` (exact integer), `B` is the number of boundary lattice points, and `I` is the number of interior lattice points via Pick's theorem. Then return the total number of lattice points inside or on the polygon (`I + B`). Vertices may be given clockwise or counter-clockwise. Handle large coordinates safely.

> All three solutions use the integer-only pipeline: shoelace for `2A`, gcd-sum for `B`, and `I = (2A − B + 2)/2`.

#### Go

```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		a = -a
	}
	return a
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// latticeCensus returns (2A, B, I, total) for a simple lattice polygon.
func latticeCensus(xs, ys []int64) (twoA, B, I, total int64) {
	n := len(xs)
	var area2, boundary int64
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		area2 += xs[i]*ys[j] - xs[j]*ys[i]
		boundary += gcd(abs64(xs[j]-xs[i]), abs64(ys[j]-ys[i]))
	}
	twoA = abs64(area2)
	B = boundary
	I = (twoA - B + 2) / 2 // Pick
	total = I + B
	return
}

func main() {
	// Triangle (0,0),(4,0),(0,3): 2A=12, B=8, I=3, total=11
	xs := []int64{0, 4, 0}
	ys := []int64{0, 0, 3}
	a2, b, i, t := latticeCensus(xs, ys)
	fmt.Printf("2A=%d B=%d I=%d total=%d\n", a2, b, i, t) // 12 8 3 11

	// Square (0,0),(4,0),(4,4),(0,4): 2A=32, B=16, I=9, total=25
	xs2 := []int64{0, 4, 4, 0}
	ys2 := []int64{0, 0, 4, 4}
	a2, b, i, t = latticeCensus(xs2, ys2)
	fmt.Printf("2A=%d B=%d I=%d total=%d\n", a2, b, i, t) // 32 16 9 25
}
```

#### Java

```java
public class LatticeCensus {
    static long gcd(long a, long b) {
        while (b != 0) { long t = a % b; a = b; b = t; }
        return Math.abs(a);
    }

    // Returns {2A, B, I, total} for a simple lattice polygon.
    static long[] census(long[] xs, long[] ys) {
        int n = xs.length;
        long area2 = 0, boundary = 0;
        for (int i = 0; i < n; i++) {
            int j = (i + 1) % n;
            area2 += xs[i] * ys[j] - xs[j] * ys[i];
            boundary += gcd(Math.abs(xs[j] - xs[i]), Math.abs(ys[j] - ys[i]));
        }
        long twoA = Math.abs(area2);
        long I = (twoA - boundary + 2) / 2; // Pick
        return new long[]{twoA, boundary, I, I + boundary};
    }

    public static void main(String[] args) {
        long[] r1 = census(new long[]{0, 4, 0}, new long[]{0, 0, 3});
        System.out.printf("2A=%d B=%d I=%d total=%d%n", r1[0], r1[1], r1[2], r1[3]); // 12 8 3 11

        long[] r2 = census(new long[]{0, 4, 4, 0}, new long[]{0, 0, 4, 4});
        System.out.printf("2A=%d B=%d I=%d total=%d%n", r2[0], r2[1], r2[2], r2[3]); // 32 16 9 25
    }
}
```

#### Python

```python
from math import gcd


def lattice_census(pts):
    """Return (2A, B, I, total) for a simple lattice polygon."""
    n = len(pts)
    area2 = boundary = 0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area2 += x1 * y2 - x2 * y1
        boundary += gcd(abs(x2 - x1), abs(y2 - y1))
    two_a = abs(area2)
    interior = (two_a - boundary + 2) // 2  # Pick
    return two_a, boundary, interior, interior + boundary


if __name__ == "__main__":
    print(lattice_census([(0, 0), (4, 0), (0, 3)]))             # (12, 8, 3, 11)
    print(lattice_census([(0, 0), (4, 0), (4, 4), (0, 4)]))     # (32, 16, 9, 25)
    print(lattice_census([(0, 0), (10**9, 0), (0, 10**9)]))     # exact at scale
```

**Expected output (all three languages):** the triangle yields `2A=12, B=8, I=3, total=11`; the square yields `2A=32, B=16, I=9, total=25`.

---

### Challenge 2 — Lattice Points Strictly Below a Line Segment

Given a line segment from `(0,0)` to `(n, m)` with positive integers `n, m`, count the number of lattice points `(x, y)` with `1 ≤ x ≤ n−1` that lie **strictly below** the segment and **strictly above** the x-axis (`y ≥ 1`). This is the interior count of the right triangle `(0,0), (n,0), (n,m)`, which Pick gives directly — and it equals the floor sum `Σ_{x=1}^{n-1} floor(m·x / n)` minus the on-line points, a classic number-theory identity tied to the Stern–Brocot / Euclidean recursion.

> The Pick route is `O(1)` after computing `gcd(n,m)`; the floor-sum route is the brute-force check.

#### Go

```go
package main

import "fmt"

func gcd2(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		a = -a
	}
	return a
}

// belowSegment counts interior lattice points of triangle (0,0),(n,0),(n,m).
func belowSegment(n, m int) int {
	// 2A = n*m ; B = gcd(n,0)+gcd(0,m)+gcd(n,m) = n + m + gcd(n,m)
	twoA := n * m
	b := n + m + gcd2(n, m)
	return (twoA - b + 2) / 2 // Pick interior
}

// bruteFloorSum independently counts strictly-below, strictly-above-axis points.
func bruteFloorSum(n, m int) int {
	total := 0
	for x := 1; x < n; x++ {
		// points y with 1 <= y, and y strictly below the line y = m*x/n
		yMax := (m*x - 1) / n // strictly below => y < m*x/n
		if yMax >= 1 {
			total += yMax
		}
	}
	return total
}

func main() {
	fmt.Println(belowSegment(4, 3), bruteFloorSum(4, 3)) // 3 3
	fmt.Println(belowSegment(6, 4), bruteFloorSum(6, 4)) // matches
}
```

#### Java

```java
public class BelowSegment {
    static int gcd(int a, int b) {
        while (b != 0) { int t = a % b; a = b; b = t; }
        return Math.abs(a);
    }

    static int belowSegment(int n, int m) {
        int twoA = n * m;
        int b = n + m + gcd(n, m);
        return (twoA - b + 2) / 2;
    }

    static int bruteFloorSum(int n, int m) {
        int total = 0;
        for (int x = 1; x < n; x++) {
            int yMax = (m * x - 1) / n;
            if (yMax >= 1) total += yMax;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(belowSegment(4, 3) + " " + bruteFloorSum(4, 3)); // 3 3
        System.out.println(belowSegment(6, 4) + " " + bruteFloorSum(6, 4));
    }
}
```

#### Python

```python
from math import gcd


def below_segment(n, m):
    two_a = n * m
    b = n + m + gcd(n, m)
    return (two_a - b + 2) // 2  # Pick interior


def brute_floor_sum(n, m):
    total = 0
    for x in range(1, n):
        y_max = (m * x - 1) // n   # strictly below the line
        if y_max >= 1:
            total += y_max
    return total


if __name__ == "__main__":
    print(below_segment(4, 3), brute_floor_sum(4, 3))  # 3 3
    print(below_segment(6, 4), brute_floor_sum(6, 4))  # match
```

**Expected output:** `below_segment(4,3) == brute_floor_sum(4,3) == 3`. The Pick formula and the floor sum agree for all positive `n, m` — a satisfying cross-check that connects lattice geometry to number theory.

---

## Common Pitfalls

1. **Dividing the shoelace sum by 2 too early** — lose the integer guarantee; keep `2A`.
2. **Forgetting `abs()`** — clockwise polygons give a negative area.
3. **Double-counting corners** in the boundary sum — `gcd` per edge already excludes one endpoint; do not add corners again.
4. **Applying Pick to non-lattice vertices** — only valid for integer coordinates.
5. **Ignoring the simplicity precondition** — self-intersecting polygons break the formula.
6. **Forgetting `+h` for holes** — undercounts area by the number of holes.
7. **Integer overflow** on `x_i·y_{i+1}` at large coordinates — use 64-bit or big integers, shift by `v₀`.
8. **Confusing `I + B` (pixel count) with `A` (continuous area)** — they differ by `B/2 + 1`.
9. **Assuming a 3-D analogue exists** — the Reeve tetrahedron proves it does not.
10. **Skipping the parity check** — `2A − B + 2` must be even; odd means invalid input or overflow.

---

## Follow-Up Deep Dives (6 Q&A)

These are the "tell me more" probes that follow a correct surface answer — they separate memorization from understanding.

### F1. You said `I = (2A − B + 2)/2`. Prove the numerator is always even.
From Pick, `A = I + B/2 − 1`, so `2A = 2I + B − 2`, giving `2A − B + 2 = 2I`. That is `2` times an integer, hence even. The practical consequence: if your computed `2A − B + 2` is odd, the input is *not* a valid lattice polygon (non-integer vertex or self-intersection), so the parity test is a free correctness gate.

### F2. Walk me through why a primitive triangle has area exactly 1/2.
A primitive lattice triangle has no lattice points except its 3 vertices. Translate one vertex to the origin; the two edge vectors `u, v` must form a *basis* of `ℤ²` (otherwise the fundamental parallelogram would enclose an extra lattice point, contradicting primitivity). A basis of `ℤ²` has `|det(u, v)| = 1`, and triangle area is `½|det(u, v)| = 1/2`. This is the atomic building block of Pick's proof.

### F3. How does Pick's `−1` constant arise?
It is the negative Euler characteristic of a disk: `χ(disk) = 1`, and Pick's constant is `−χ`. The Euler-formula proof makes this explicit — `V − E + F = 2` for the triangulation yields `T = 2I + B − 2`, where the `−2` carries the `χ = 1`. For a region with `h` holes, `χ = 1 − h`, and the constant becomes `−1 + h`, giving `A = I + B/2 − 1 + h`. The same constant reappears as the `+1` constant term of the Ehrhart polynomial.

### F4. Connect Pick to the Ehrhart polynomial precisely.
The 2-D Ehrhart polynomial is `L(t) = A·t² + (B/2)·t + 1`, counting lattice points in the `t`-fold dilation. Evaluate at `t = 1`: `L(1) = A + B/2 + 1`. But `L(1)` literally counts all lattice points `= I + B`. Setting them equal and solving gives `A = I + B/2 − 1` — Pick. So Pick is the `t = 1` slice of Ehrhart, and Ehrhart–Macdonald reciprocity `L(−1) = I` is the rearranged interior formula. Ehrhart generalizes Pick to all dimensions and to scaled copies.

### F5. Why exactly does the Reeve tetrahedron kill 3-D Pick?
`T_r = conv{(0,0,0),(1,0,0),(0,1,0),(1,1,r)}` has only its 4 vertices as lattice points — `I = 0, B = 4` — for *every* `r ≥ 1`, yet its volume is `r/6`. A formula `vol = f(I, B)` would have to output `1/6, 2/6, 3/6, …` from the single fixed input `(0, 4)`, which is impossible for a function. So no `(I, B)`-style volume formula can exist in 3-D. The root cause: in 2-D, lattice-emptiness forces determinant `±1` hence area `1/2`; in 3-D, an empty tetrahedron can have arbitrarily large determinant. Higher dimensions need Ehrhart polynomials, not Pick.

### F6. When would you store the Ehrhart polynomial instead of just running Pick?
When you need lattice counts for *many integer scalings* of the same shape — e.g. a region examined at multiple resolutions, or a parameterized family `tP`. Computing `(A, B/2, 1)` once (`O(n)`) then evaluating `L(t)` is `O(1)` per scale, versus rebuilding the dilated polygon and re-running Pick each time. For a single shape at scale 1, plain Pick is simpler and you would not bother.

---

## Rapid-Fire Round (one-liners)

Short questions an interviewer fires to probe fluency. Answer in a sentence.

| # | Question | Answer |
|---|----------|--------|
| R1 | Area of the unit triangle? | `1/2` (`I=0, B=3`). |
| R2 | `gcd(0, 5)`? | `5`. |
| R3 | Boundary points of a `6×6` axis square? | `4·6 = 24`. |
| R4 | Interior points of a `6×6` axis square? | `(6−1)² = 25`. |
| R5 | Is `2A` always even? | No — `2A` is an integer; `A` may be a half-integer. |
| R6 | Is `2A − B + 2` always even? | Yes — it equals `2I`. |
| R7 | What does each hole add to Pick? | `+1` (Euler characteristic). |
| R8 | Pick in 3-D? | Does not exist (Reeve tetrahedron). |
| R9 | Ehrhart polynomial of a 2-D lattice polygon? | `A t² + (B/2) t + 1`. |
| R10 | `L(1)` equals? | `I + B` (all lattice points). |
| R11 | `L(−1)` equals? | `I` (reciprocity). |
| R12 | Clockwise vertices break the area? | No — just take `abs()` of the shoelace sum. |
| R13 | Cost of Pick vs polygon size? | Independent of size; `O(n)` in vertices. |
| R14 | Two preconditions? | Lattice vertices + simple polygon. |
| R15 | gcd's role? | Counts boundary lattice points per edge. |
| R16 | `2A` of triangle from cross product? | `|det| = |(b−a)×(c−a)|`. |
| R17 | Does a self-loop edge affect `B`? | Degenerate; not a valid simple polygon. |
| R18 | Total points `I + B` formula? | `(2A + B + 2)/2`. |
| R19 | Minimal positive lattice-triangle area? | `1/2` (primitive triangle). |
| R20 | Counting lattice points, dimension in input? | #P-hard. |

---

## When Pick Is the Wrong Tool — Decision Table

A senior signal is knowing when *not* to reach for Pick. Memorize this.

| Input property | Use instead | Reason |
|----------------|-------------|--------|
| Non-integer vertices | Per-column count / Ehrhart floor-sum | Pick needs lattice vertices |
| Self-intersecting polygon | Decompose into simple pieces | "simple" precondition |
| Need the *list* of interior points | Grid scan / per-column enumeration | Pick gives only counts |
| Polygon with holes | Pick + `+h` | hole-corrected formula |
| 3-D volume from lattice pts | Ehrhart / Barvinok | Reeve tetrahedron |
| Count in `t`-scaled copies | Ehrhart polynomial | `L(t) = A t² + (B/2) t + 1` |
| Real-coordinate area only | Plain shoelace | no lattice counting needed |

---

## What Interviewers Are Really Testing

- **Do you know *why* the formula holds?** Reciting `A = I + B/2 − 1` is easy; explaining the primitive-triangle / Euler-formula intuition (and that the `−1` is an Euler characteristic) shows depth.
- **The integer pipeline.** Writing the `2A` shoelace, the gcd boundary sum, and `I = (2A − B + 2)/2` unprompted signals real understanding versus memorization.
- **Preconditions and limits.** Naming lattice-vertices, simplicity, holes (`+h`), and the 3-D impossibility (Reeve) is senior-level judgment.
- **Robustness.** Handling clockwise orientation, overflow, degenerate cases, and the pixel-count-vs-area distinction shows production maturity.
- **Problem recognition.** Spotting that "count integer points in this triangle/polygon" *is* a Pick problem — and when it is *not* (non-lattice, 3-D) — is the core skill.
- **Communication.** Walking the small worked example (shoelace → gcd-sum → Pick → sanity-check) clearly matters as much as the code.
