# Manhattan & Chebyshev Distances — Interview Preparation

> Tiered question bank (Junior → Middle → Senior → Professional) plus a multi-language coding challenge. Each answer is written to be *spoken* in an interview: state the result, then the one-line reason.

---

## Quick-Reference Cheat Sheet

| Concept | Statement |
|---------|-----------|
| Manhattan (L1) | `|dx| + |dy|` — taxi on a grid — diamond ball |
| Chebyshev (L∞) | `max(|dx|, |dy|)` — chess king — square ball |
| Euclidean (L2) | `√(dx²+dy²)` — bird — circle ball |
| Ordering | `L∞ ≤ L2 ≤ L1` (nested balls: square ⊇ circle ⊇ diamond) |
| The rotation | `u = x+y, v = x-y` ⇒ `L1(p,q) = L∞(T(p), T(q))` |
| Inverse | `x = (u+v)/2, y = (u-v)/2` (always integer: `u+v = 2x`) |
| Key lemma | `max(|a+b|, |a-b|) = |a| + |b|` |
| Max L1 distance | `max(range(x+y), range(x-y))` in `O(n)` |
| Min Σ L1 | per-axis **median** (not mean!) |
| Manhattan MST | 8-octant sweep ⇒ `≤ 8n` edges ⇒ `O(n log n)` |
| √2 caveat | metric L1↔L∞ exact; Euclidean lengths × √2 |

---

## Junior Questions (12 Q&A)

### J1. What is Manhattan distance and how is it computed?
The L1 metric: `|x1−x2| + |y1−y2|` — the sum of the absolute per-axis differences. It models movement on a grid where diagonals are not allowed (a taxi driving city blocks).

### J2. What is Chebyshev distance?
The L∞ metric: `max(|x1−x2|, |y1−y2|)` — the larger of the two axis differences. It models a chess king, for whom a diagonal move costs the same as a straight move, so the bottleneck is the longer axis.

### J3. How do Manhattan, Euclidean, and Chebyshev relate in size?
For any two points, `L∞ ≤ L2 ≤ L1`. Their unit balls nest: the L∞ square contains the L2 circle contains the L1 diamond.

### J4. What does the L1 unit ball look like?
A **diamond** — a square rotated 45°, with vertices on the axes at `(±1, 0)` and `(0, ±1)`. It is the set `|x| + |y| ≤ 1`.

### J5. What does the L∞ unit ball look like?
An **axis-aligned square** `[-1, 1]²`, i.e. `max(|x|, |y|) ≤ 1`.

### J6. Why prefer Manhattan/Chebyshev over Euclidean in some problems?
They are integer-exact (no square root), faster to compute, and they match grid/chessboard movement models. Euclidean introduces floating point and is wrong when movement is grid-constrained.

### J7. State the 45° rotation trick.
Replace `(x, y)` with `(u, v) = (x + y, x − y)`. Then the Manhattan distance between two points equals the Chebyshev distance between their transformed versions: diamonds become axis-aligned squares.

### J8. Why is the rotation useful?
Squares are axis-separable: you can handle the `u` and `v` directions independently with simple min/max or sorting. That turns awkward "diamond" problems (like farthest pair under L1) into easy per-axis range computations.

### J9. Compute Manhattan and Chebyshev between (1,1) and (4,5).
`dx = 3, dy = 4`. Manhattan = `3 + 4 = 7`. Chebyshev = `max(3, 4) = 4`. (Euclidean = 5, so `4 ≤ 5 ≤ 7`.)

### J10. How do you invert the rotation?
`x = (u + v)/2`, `y = (u − v)/2`. It is always integer because `u + v = (x+y)+(x−y) = 2x` is even.

### J11. Is Manhattan distance a valid metric?
Yes — it is non-negative (zero only for identical points), symmetric, and satisfies the triangle inequality (it comes from the L1 norm, which is subadditive).

### J12 (analysis). Why must you wrap differences in `abs`?
Without it, `dx + dy` can be negative and is not a distance. Distance is the sum of *magnitudes*, so each axis term must be `|dx|`, `|dy|`.

### J13. What is the Manhattan distance from a point to itself?
Zero — `|0| + |0| = 0`. All three metrics give zero for identical points; that is the "identity of indiscernibles" axiom of a metric.

### J14. Give a quick sanity check that L∞ ≤ L1 always.
`max(|dx|, |dy|) ≤ |dx| + |dy|` because the larger of two non-negative numbers is at most their sum. Equality holds exactly when one of `dx, dy` is zero.

---

## Middle Questions (12 Q&A)

### M1. Prove the rotation identity in one or two lines.
Let `dx, dy` be the differences. Then `du = dx+dy`, `dv = dx−dy`, and `max(|dx+dy|, |dx−dy|) = |dx| + |dy|` by the lemma `max(|a+b|,|a−b|) = |a|+|b|`. The right side is exactly L1.

### M2. State and justify the key lemma.
`max(|a+b|, |a−b|) = |a| + |b|`. If `a, b` share a sign, `|a+b| = |a|+|b|` wins; if opposite signs, `|a−b| = |a|+|b|` wins. Either way the max is `|a|+|b|`.

### M3. How do you find the maximum Manhattan distance over n points in O(n)?
Rotate: compute `u = x+y` and `v = x−y` for all points. The answer is `max(maxU − minU, maxV − minV)`. One linear pass tracking four min/max values.

### M4. Why does that work?
Max L1 = max over pairs of `max(|du|, |dv|)`; since `max` distributes over pairs, it equals `max(max|du|, max|dv|)`, and on one axis the largest absolute difference is just `max − min` (the range).

### M5. Which point minimizes the total Manhattan distance to a set, and why?
The coordinate-wise **median** — median of x's and median of y's, independently. Manhattan distance separates into `Σ|xi−cx| + Σ|yi−cy|`, and the 1-D sum of absolute deviations is minimized at the median (slope/derivative balances when equal counts lie on each side).

### M6. Why the median and not the mean?
The **mean** minimizes the sum of *squared* deviations (L2²); the **median** minimizes the sum of *absolute* deviations (L1). Different objectives, different optima.

### M7. What is the √2 scaling caveat?
The matrix `M = [[1,1],[1,-1]]` has `MᵀM = 2I`, so it scales Euclidean lengths by `√2`. But the *metric* identity `L1 = L∞∘T` is exact — no `√2` — because the L∞ ball is not round and absorbs the stretch.

### M8. Does the rotation trick generalize to 3D?
Not as a single rotation. In k-D, max L1 distance uses `2^{k-1}` sign patterns `±x±y±z…`; in 2D that is just `x+y` and `x−y`. The clean "one rotation" picture is special to the plane.

### M9. When is Chebyshev the natural metric?
King-move games (8-connected, diagonal cost 1), image morphology (dilation/erosion with king neighborhoods), and "within k in every dimension" bounding-box checks.

### M10. Convert a Chebyshev problem to Manhattan — how?
Apply `T⁻¹`-style rotation: `(x, y) → ((x+y)/2, (x−y)/2)` (or `(x+y, x−y)` with a factor). L∞ in the original becomes L1 in the rotated frame, useful when grid/rook reasoning is easier than king reasoning.

### M11. Why do L1 distances tie so often?
The L1 ball has flat slanted sides, so many points sit at exactly equal distance. For a unique nearest neighbor you must add an explicit secondary tie-break (e.g., Euclidean or lexicographic).

### M12 (analysis). Why is L1 separable but L2 not?
`L1 = |dx| + |dy|` is a *sum* of per-axis terms — separable. `L2 = √(dx²+dy²)` has a square root coupling the axes, so it cannot be split into independent per-axis subproblems.

### M13. A diamond-shaped range query ("within Manhattan r of q") is slow on my k-d tree. Fix it.
Rotate the whole index to `(u, v) = (x+y, x−y)`. The diamond `|x−qx|+|y−qy| ≤ r` becomes the axis-aligned square `|u−qu| ≤ r AND |v−qv| ≤ r`, which a k-d tree or 2-D range tree handles natively as a rectangle query.

### M14. How would you find the maximum Chebyshev distance over n points?
Directly: `max(range(x), range(y))` where `range = max − min` per axis — no rotation needed, because L∞ is *already* max-separable in the original coordinates. (It is L1 that needs rotating to become max-separable.)

---

## Senior Questions (10 Q&A)

### S1. Which metric is the correct A* heuristic on a 4-connected grid?
**Manhattan.** With no diagonal moves, the cheapest obstacle-free path is `|dx|+|dy|`. It is the *tightest* admissible heuristic there, so A* expands the fewest nodes.

### S2. And on an 8-connected grid with unit diagonal cost?
**Chebyshev** (`max(|dx|,|dy|)`). Manhattan would overestimate (counting a diagonal as two moves), making it inadmissible and producing suboptimal paths.

### S3. What happens if you use Manhattan on an 8-connected grid?
It overestimates the true cost ⇒ heuristic inadmissible ⇒ A* may return a non-optimal path, *and* it is slower. Always match the heuristic to the movement model.

### S4. How do you build a Manhattan MST efficiently?
The complete graph is `O(n²)`. By the octant theorem, each point only needs its nearest neighbor in each of 8 octants ⇒ `≤ 8n` candidate edges. Generate them via 4 reflected coordinate sweeps (sort by `x+y`, Fenwick suffix-min on `x−y`), then run Kruskal: `O(n log n)`.

### S5. Why do octants reduce the edge set?
Within a 45° cone, if `q` is closer to `p` than `r` is, then `q–r` is shorter than `p–r`. By the MST cycle property, `p–r` can be exchanged for the lighter `q–r`, so `p` never needs more than its single nearest neighbor per octant.

### S6. In VLSI, why is L1 the relevant metric?
Chip wires run on orthogonal metal layers (horizontal/vertical), never diagonally. Wire length, half-perimeter wire length (HPWL = box width + height), and the routing scaffold (Manhattan/Rectilinear MST → Steiner tree) are all L1 quantities.

### S7. How do you place one warehouse minimizing total delivery distance on a grid city?
The coordinate-wise median (per-axis, weighted by demand). It is separable, so you compute a streaming/weighted median per axis — scalable to billions of points. Never the centroid.

### S8. What is HPWL and why is it cheap?
Half-Perimeter Wire Length = `(maxX − minX) + (maxY − minY)` for a net's pins. It is an axis-separable bounding-box estimate, `O(pins)`, used as the inner cost function in chip placement.

### S9. What observability signals catch metric misuse?
A spike in `astar_nodes_expanded` on 8-connected maps (often Manhattan left in by mistake), any `heuristic_admissibility_violation > 0`, `mst_candidate_edges/n > 8` (octant sweep bug), and `rotation_overflow_events > 0` (`x+y` overflowed 32-bit).

### S10 (analysis). Is the Manhattan MST algorithm optimal?
Yes, `Θ(n log n)`, and that is optimal: Manhattan MST solves element distinctness (project to a line; distinct iff no zero-length MST edge), which has an `Ω(n log n)` algebraic-decision-tree lower bound.

### S11. How does an L1 Voronoi diagram differ from a Euclidean one, and how would you build it?
Euclidean bisectors are straight lines; L1 bisectors are piecewise-linear and can include whole 2-D equidistant regions (diamonds tangent along a face). Build it by rotating to `(u, v)` so the diagram becomes an L∞ Voronoi diagram with axis-aligned/45° bisectors, then run a sweep — `O(n log n)`.

### S12. When is Chebyshev the natural model in image processing?
Morphological dilation/erosion with a 3×3 (king) structuring element grows/shrinks regions by one in Chebyshev distance per pass. The distance transform under L∞ counts king-moves to the nearest feature pixel and is computable in two linear raster passes.

---

## Professional Questions (8 Q&A)

### P1. Prove `T(x,y)=(x+y,x−y)` is an isometry from (ℝ²,L1) to (ℝ²,L∞).
For `w = p−q = (dx,dy)`, `T(p)−T(q) = (dx+dy, dx−dy)`, so `L∞ = max(|dx+dy|,|dx−dy|) = |dx|+|dy| = L1` by the lemma. The map is a linear bijection (`det = −2`), hence a bijective isometry.

### P2. Why no √2 in the metric identity but √2 in lengths?
`MᵀM = 2I`, so `M = √2·R` for an orthogonal `R`; Euclidean lengths scale by `√2`. The L∞ ball is not round, so the √2 stretch is exactly the difference between the diamond's and square's "reach," cancelling in the metric. The identity `‖Mw‖_∞ = ‖w‖_1` is exact.

### P3. Prove the coordinate-wise median minimizes Σ L1.
`Σ L1 = Σ|xi−cx| + Σ|yi−cy|` separates. Each term is convex piecewise-linear with derivative `#{below} − #{above}`, which is negative below the median and positive above; the subgradient contains 0 at the median. Minimize each axis independently ⇒ `(median_x, median_y)`.

### P4. Why does the L2 1-median lack a closed form?
`Σ‖p−c‖_2` does not separate (the root couples coordinates); its minimizer (geometric median) is not expressible by radicals for general `n ≥ 5` and is computed by Weiszfeld iteration. This is the structural payoff of L1's separability.

### P5. State the k-D max-L1-distance theorem.
`max ‖p−q‖_1 = max over 2^{k-1} sign vectors s (s_1=+1) of (max_p⟨s,p⟩ − min_p⟨s,p⟩)`, because `‖p−q‖_1 = max_s⟨s,p−q⟩` and the max/range commute. The 2-D case `s∈{(+,+),(+,−)}` is the rotation.

### P6. Prove the octant exchange lemma underlying Manhattan MST.
In a 45° cone `{Δx ≥ Δy ≥ 0}` of `p`, if `L1(p,q) ≤ L1(p,r)` with both in the cone, the cone constraint forces coordinate-wise monotonicity so `L1(q,r) = L1(p,r) − L1(p,q) < L1(p,r)`. Hence by the MST cycle property `p–r` is exchangeable for `q–r`, so only the per-octant nearest neighbor can be an MST edge.

### P7. Give the Manhattan MST complexity and its lower bound.
`O(n log n)`: 4 sweeps with a Fenwick (`O(n log n)`), `≤ 8n` edges, Kruskal `O(n α(n))` after an `O(n log n)` sort. Lower bound `Ω(n log n)` via reduction from element distinctness — so it is optimal.

### P8. Where does the L1/L∞ relationship sit in the ℓ^p family?
L1 (`p=1`, diamond) and L∞ (`p=∞`, square) are the two convex extremes of `1 ≤ p ≤ ∞`; balls nest `B_1 ⊆ B_2 ⊆ B_∞`, and `lim_{p→∞}‖·‖_p = ‖·‖_∞`. The 45° rotation is the unique linear map in the plane exchanging these two corner norms.

---

## Coding Challenge (3 Languages)

### Challenge: Maximum Manhattan Distance + Best Meeting Point

> Given `n` points, return a pair:
> 1. the **maximum Manhattan distance** between any two points (via the 45° rotation, in `O(n)`), and
> 2. the **minimum total Manhattan distance** from a single optimal meeting point (per-axis median).
>
> Constraints: `1 ≤ n ≤ 10^5`, coordinates fit in 32-bit; use 64-bit for the rotated sums. Both parts must avoid the `O(n²)` brute force for part 1.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func absI(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// maxManhattan: O(n) via u=x+y, v=x-y; answer = max(range(u), range(v)).
func maxManhattan(pts [][2]int) int {
	if len(pts) < 2 {
		return 0
	}
	const POS = int(1 << 62)
	minU, maxU, minV, maxV := POS, -POS, POS, -POS
	for _, p := range pts {
		u := p[0] + p[1]
		v := p[0] - p[1]
		if u < minU {
			minU = u
		}
		if u > maxU {
			maxU = u
		}
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	ru, rv := maxU-minU, maxV-minV
	if ru > rv {
		return ru
	}
	return rv
}

// minTotalManhattan: per-axis median minimizes Σ L1.
func minTotalManhattan(pts [][2]int) int {
	n := len(pts)
	xs := make([]int, n)
	ys := make([]int, n)
	for i, p := range pts {
		xs[i], ys[i] = p[0], p[1]
	}
	sort.Ints(xs)
	sort.Ints(ys)
	mx, my := xs[n/2], ys[n/2]
	total := 0
	for _, p := range pts {
		total += absI(p[0]-mx) + absI(p[1]-my)
	}
	return total
}

func main() {
	pts := [][2]int{{1, 1}, {4, 5}, {6, 2}, {2, 8}}
	fmt.Println(maxManhattan(pts), minTotalManhattan(pts)) // 10 <total>
}
```

#### Java

```java
import java.util.Arrays;

public class ManhattanChallenge {

    static long maxManhattan(int[][] pts) {
        if (pts.length < 2) return 0;
        long minU = Long.MAX_VALUE, maxU = Long.MIN_VALUE;
        long minV = Long.MAX_VALUE, maxV = Long.MIN_VALUE;
        for (int[] p : pts) {
            long u = (long) p[0] + p[1];
            long v = (long) p[0] - p[1];
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        return Math.max(maxU - minU, maxV - minV);
    }

    static long minTotalManhattan(int[][] pts) {
        int n = pts.length;
        int[] xs = new int[n], ys = new int[n];
        for (int i = 0; i < n; i++) { xs[i] = pts[i][0]; ys[i] = pts[i][1]; }
        Arrays.sort(xs);
        Arrays.sort(ys);
        int mx = xs[n / 2], my = ys[n / 2];
        long total = 0;
        for (int[] p : pts)
            total += Math.abs(p[0] - mx) + Math.abs(p[1] - my);
        return total;
    }

    public static void main(String[] args) {
        int[][] pts = {{1, 1}, {4, 5}, {6, 2}, {2, 8}};
        System.out.println(maxManhattan(pts) + " " + minTotalManhattan(pts));
    }
}
```

#### Python

```python
def max_manhattan(points):
    """O(n) farthest pair under L1 via the 45-degree rotation."""
    if len(points) < 2:
        return 0
    us = [x + y for x, y in points]
    vs = [x - y for x, y in points]
    return max(max(us) - min(us), max(vs) - min(vs))


def min_total_manhattan(points):
    """Minimum total L1 from one point = per-axis median."""
    xs = sorted(p[0] for p in points)
    ys = sorted(p[1] for p in points)
    mx, my = xs[len(xs) // 2], ys[len(ys) // 2]
    return sum(abs(x - mx) + abs(y - my) for x, y in points)


if __name__ == "__main__":
    pts = [(1, 1), (4, 5), (6, 2), (2, 8)]
    print(max_manhattan(pts), min_total_manhattan(pts))  # 10 <total>
```

**Test cases:**

| Input | max Manhattan | min total L1 |
|-------|---------------|--------------|
| `[(1,1),(4,5),(6,2),(2,8)]` | `10` (P3–P4) | median (4,2) → `4+5+4+6` etc. |
| `[(0,0)]` | `0` | `0` |
| `[(0,0),(0,0)]` | `0` | `0` |
| `[(-3,-3),(3,3)]` | `12` | `0` (either point) |

**Follow-ups the interviewer may ask:**
- Generalize part 1 to 3-D (answer: `2^{3-1}=4` sign patterns `x+y+z, x+y−z, x−y+z, x−y−z`).
- Make part 2 weighted (answer: weighted median per axis).
- Make part 2 `O(n)` (answer: quickselect instead of sort).
- Why median and not mean for part 2 (answer: L1 vs L2² objective).

**Run:** `go run main.go` | `javac ManhattanChallenge.java && java ManhattanChallenge` | `python challenge.py`

---

## Whiteboard Derivations (be ready to write these)

Interviewers often ask you to *derive*, not just recall. Practice writing each of these from a blank board.

### D1. The rotation identity, fully

```
Goal:  |dx| + |dy|  =  max(|dx+dy|, |dx−dy|)

Case 1: dx, dy same sign (say both ≥ 0)
        |dx+dy| = dx+dy = |dx|+|dy|        ← this is the max
        |dx−dy| = |dx−dy| ≤ dx+dy
        ⇒ max = |dx|+|dy|  ✓

Case 2: opposite signs (say dx ≥ 0 ≥ dy)
        |dx−dy| = dx−dy = |dx|+|dy|        ← this is the max
        |dx+dy| = |dx+dy| ≤ |dx|+|dy|
        ⇒ max = |dx|+|dy|  ✓

Both cases ⇒ identity holds. Set u=x+y, v=x−y to read it as L1 = L∞∘T.
```

### D2. Max-L1 splits into two ranges

```
max over pairs |dx|+|dy|
  = max over pairs max(|du|,|dv|)            [identity, du=dx+dy etc.]
  = max( max|du| , max|dv| )                 [max distributes over the pair-max]
  = max( maxU−minU , maxV−minV )             [1-D max |a_i−a_j| = range]
```

### D3. Median minimizes Σ|x − c|

```
f(c) = Σ |x_i − c|,  derivative (off the data points):
  f'(c) = #{x_i < c} − #{x_i > c}
  f' < 0  while more points are above c  → push c right
  f' > 0  while more points are below c  → push c left
  f' = 0  when counts balance            → c = median
Even n: f' = 0 across [x_{n/2}, x_{n/2+1}] → any point there is optimal.
```

### D4. Why the octant pruning gives ≤ 8n MST edges

```
Two points q, r in the same 45° octant of p, with d(p,q) ≤ d(p,r):
  the cone forces d(q,r) < d(p,r).
⇒ edge (p,r) is the heaviest in the cycle p–q–r…  ⇒ not in MST (cycle property).
⇒ p only ever needs its NEAREST neighbor per octant.
8 octants × n points = ≤ 8n candidate edges  ⇒  Kruskal in O(n log n).
```

---

## Rapid-Fire (one-liners)

| Prompt | Answer |
|--------|--------|
| Manhattan ball shape | diamond |
| Chebyshev ball shape | axis-aligned square |
| Euclidean ball shape | circle |
| Ordering of the three | L∞ ≤ L2 ≤ L1 |
| Rotation formula | u = x+y, v = x−y |
| Inverse | x = (u+v)/2, y = (u−v)/2 |
| L1 → which metric after rotation? | L∞ (Chebyshev) |
| Min Σ L1 placement | per-axis median |
| Min Σ L2² placement | centroid (mean) |
| Min Σ L2 placement | geometric median (iterative) |
| 4-connected A* heuristic | Manhattan |
| 8-connected (unit diag) A* heuristic | Chebyshev |
| 8-connected (√2 diag) A* heuristic | octile |
| Manhattan MST complexity | O(n log n) |
| Candidate edges in Manhattan MST | ≤ 8n |
| Max L1 distance complexity | O(n) via rotation |
| Does the rotation work in 3-D? | no (octahedron ≠ cube) |
| 3-D max-L1 method | 2^{k−1}=4 sign patterns |
| Are L1/L∞ integer-exact? | yes (no sqrt) |
| Overflow risk in rotation | x+y near INT_MAX → use 64-bit |
| HPWL formula | (maxX−minX) + (maxY−minY) |
| Dual norm of L1 | L∞ (and vice versa) |
| Bishop moves are rook moves in… | (u, v) = (x+y, x−y) space |
| L1 1-median as a program | linear program (LP) |
| L2 1-median as a program | second-order cone program (SOCP) |
| RSMT (Steiner) complexity | NP-hard |
| Manhattan MST vs RSMT | MST is a 3/2-approx scaffold |
| Expected Manhattan MST weight (n uniform pts) | Θ(√n) |

---

## Behavioral / Modeling Questions

### B1. A teammate placed a depot at the average of all delivery coordinates and trucks drive on a grid. What's wrong?
The average (centroid) minimizes total *squared* Euclidean distance, not total grid-travel. For grid (Manhattan) travel the optimum is the coordinate-wise **median**. On skewed demand the centroid can sit far from the median, inflating total mileage. Recommend switching to per-axis (weighted) median.

### B2. Your A* pathfinder returns slightly-too-long paths on a map that allows diagonal moves. Diagnose.
Almost certainly an **inadmissible heuristic**: Manhattan was left in place on an 8-connected grid, where it overestimates the remaining cost (it double-counts diagonals). Switch to Chebyshev (unit diagonals) or octile (√2 diagonals). Add a test asserting `h(n) ≤ true_cost(n)` on random pairs.

### B3. You must answer millions of "points within Manhattan radius r" queries on a static set. Approach?
Precompute rotated coordinates `(u, v) = (x+y, x−y)` once. The diamond query becomes an axis-aligned square `[qu−r,qu+r]×[qv−r,qv+r]`, which a 2-D range tree or k-d tree on `(u, v)` answers in `O(log n + k)`. The rotation turns an un-indexable diamond into an indexable box.

### B4. The interviewer asks for the *closest* pair under L1 instead of farthest. Does the rotation still help?
Yes, but differently. Farthest is a single range read-off; closest needs a sweep. Rotate to L∞, then run a plane sweep ordered by `u` with a BST keyed on `v`, comparing only points within the current best `v`-band. The rotation makes that band axis-aligned. Complexity `O(n log n)`.

---

## Traps and Gotchas (interviewers love these)

### T1. "Just rotate and compute Euclidean distance — same thing, right?"
No. The rotation `(x,y) → (x+y, x−y)` makes L1 equal L∞ of the rotated points — **not** L2. And it scales Euclidean lengths by `√2`. If you compute Euclidean distance in the rotated frame you get neither the original L1 nor a useful quantity. Keep the metric you actually want straight.

### T2. "Use the mean to minimize total grid travel."
Trap. The mean (centroid) minimizes Σ of *squared* L2; the **median** minimizes Σ L1. On a grid the answer is the per-axis median. Stating "mean" here is the single most common wrong answer.

### T3. "Manhattan heuristic is always safe for A*."
Trap. It is admissible only on **4-connected** grids. On 8-connected grids it overestimates and breaks optimality. Match heuristic to movement model.

### T4. "The rotation trick generalizes to 3-D with u=x+y+z."
Trap. There is no single linear map turning 3-D L1 into 3-D L∞ (octahedron ≠ cube). Use `2^{k−1}` sign patterns for k-D max distance.

### T5. "Integer coordinates, so no overflow worries."
Trap. `u = x + y` can overflow 32-bit even when `x, y` individually fit. Widen rotated sums to 64-bit.

### T6. "Manhattan MST needs all O(n²) edges."
Trap. The octant theorem cuts it to ≤ 8n candidate edges, giving O(n log n). Mentioning this distinguishes a senior answer.

---

## Extended Scenario Questions

### E1. Design a "nearest store" service where customers and stores are on a city grid (Manhattan travel), 50M stores, millions of queries/sec.
Precompute store coordinates rotated to `(u, v)`. Build a k-d tree (or grid bucket index) on `(u, v)`. A nearest-neighbor query under L1 becomes nearest under L∞ in the rotated space; the L∞ ball is an axis-aligned square, so branch-and-bound pruning in the k-d tree uses simple per-axis interval tests. Shard by `u`-range across machines; each shard answers locally and a coordinator takes the min. State the tie-break (multiple equidistant stores) explicitly — L1 ties are frequent.

### E2. A chip placer must estimate total wire length for 10⁶ nets every optimization iteration.
Use **HPWL** per net = `(maxX − minX) + (maxY − minY)` over its pins — `O(pins)` and axis-separable. Maintain incremental min/max per net so a single pin move updates HPWL in `O(1)` amortized. This is exactly the L∞-style range arithmetic the rotation produces, applied to the original axes. The true optimum (Rectilinear Steiner tree) is NP-hard; HPWL is the cheap, monotone surrogate that drives placement.

### E3. You need reproducible geometric hashing across heterogeneous servers.
Use L1/L∞ (integer-exact) rather than L2 (platform-dependent `sqrt` rounding). Rotated coordinates `(x+y, x−y)` stay integers, so distance comparisons and bucket keys are bit-identical everywhere — critical for deduplication and consensus on geometric data.

### E4. Estimate the wire budget for a chip with 1M randomly placed terminals before routing.
The expected Manhattan MST weight on `n` uniform points in a unit square scales as `Θ(√n)`, and it concentrates tightly around its mean (bounded-difference / McDiarmid). So you can multiply `√n` by the empirical per-area constant and a chip's physical dimensions to budget total wire length up front — no need to route first.

### E5. A game needs both 4-connected and 8-connected pathfinding on the same map.
Parameterize the heuristic: a single A* with a pluggable `h` (Manhattan for 4-connected, octile for 8-connected with √2 diagonals, Chebyshev for unit diagonals). Keep movement-model→heuristic as a config table, assert admissibility in tests, and you reuse one engine for both modes with provably optimal paths.

---

## Self-Test Checklist (rate yourself before the interview)

Can you, from memory and on a whiteboard:

1. Write all three distance formulas and draw their unit balls? (junior)
2. State and prove `max(|a+b|,|a−b|) = |a|+|b|`? (middle)
3. Solve max-Manhattan-distance in O(n) and explain why the max splits? (middle)
4. Prove the median minimizes Σ|x−c| via the slope/derivative argument? (middle)
5. Pick the correct A* heuristic for 4- vs 8-connected grids and justify admissibility? (senior)
6. Explain the octant pruning to ≤ 8n edges for Manhattan MST? (senior)
7. Sketch the sweep (sort by x+y, Fenwick suffix-min on x−y) finding per-octant nearest? (senior)
8. Prove the rotation is an L1→L∞ isometry and explain the √2? (professional)
9. Explain why the rotation has no clean 3-D analogue (octahedron ≠ cube)? (professional)
10. State the LP / dual-norm view (L1 and L∞ are Hölder duals)? (professional)

If you can do 1–7 cold, you are ready for most interviews; 8–10 distinguish a specialist.

**Most common single mistake to avoid:** answering "mean/centroid" for the L1 facility problem. The correct answer is the **coordinate-wise median**. If you only remember one thing from this whole topic for a behavioral/modeling round, make it that — it separates candidates who have actually used these metrics from those who have only memorized formulas.

**Two-sentence elevator summary** (memorize this for the opening of any answer): "Manhattan distance is `|dx|+|dy|` (a diamond), Chebyshev is `max(|dx|,|dy|)` (a square), and the 45° rotation `u=x+y, v=x−y` turns one into the other. That rotation makes diamond problems separable per axis, so max-Manhattan-distance drops from O(n²) to O(n) and the Manhattan MST drops from O(n²) to O(n log n)."

> Final reminder: the rotation links L1 and L∞ **only in 2-D**; in higher dimensions fall back to the `2^{k−1}` sign-pattern enumeration. Bringing that caveat up unprompted signals real depth.

---

**Next step:** drill the patterns in [`tasks.md`](./tasks.md).
