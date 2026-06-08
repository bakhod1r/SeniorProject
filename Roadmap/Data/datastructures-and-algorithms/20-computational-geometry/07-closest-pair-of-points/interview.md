# Closest Pair of Points — Interview Preparation

> Tiered Q&A (Junior → Middle → Senior → Professional) followed by a full coding challenge in Go, Java, and Python. Every answer is interview-length: enough to say out loud, not a textbook.

---

## Quick-Reference Cheat Sheet

| Fact | Value |
|------|-------|
| Brute force | O(n²) time, O(1) space |
| Divide & conquer | O(n log n) time, O(n) space |
| Sweep line + ordered set | O(n log n) |
| Randomized grid (Rabin) | O(n) expected |
| Lower bound (algebraic model) | Ω(n log n) |
| Strip width | 2·delta (delta on each side of the line) |
| Comparisons per strip point | ≤ 7 (a constant) |
| Recurrence | T(n) = 2T(n/2) + O(n) |
| Split by | rank (n/2), not raw x-value |
| Metric | Euclidean; use squared distance for comparisons |

---

## Junior Questions (12 Q&A)

### J1. What is the closest-pair-of-points problem?
Given `n` points in the plane, find the two distinct points with the minimum Euclidean distance between them.

### J2. What is the brute-force solution and its complexity?
Compute the distance for every pair and keep the smallest. There are `n(n-1)/2` pairs, so it is `O(n²)` time and `O(1)` extra space. It is trivially correct and makes a perfect test oracle.

### J3. Why do we use squared distance instead of actual distance?
`sqrt` is monotonic, so comparing `dx²+dy²` ranks pairs the same as comparing `sqrt(dx²+dy²)`. Skipping `sqrt` is faster and avoids floating-point error; you take the square root only once for the final reported answer.

### J4. What is the high-level idea of the divide-and-conquer algorithm?
Sort by `x`, split at the median line into left and right halves, recursively find the closest pair in each half, take `delta = min(left, right)`, then check a thin strip around the line for any cross pair closer than `delta`.

### J5. What does the algorithm have in common with merge sort?
The same split-in-half recursion with `log n` levels and a linear combine step, giving the same `T(n) = 2T(n/2) + O(n) = O(n log n)`. Merge sort merges sorted lists; closest pair scans a strip.

### J6. What is the "strip"?
The vertical band of width `2·delta` centered on the dividing line — `delta` to the left and `delta` to the right. It is the only region where a cross pair closer than `delta` can exist.

### J7. Why can a cross pair closer than delta only be in the strip?
If two points are closer than `delta`, their horizontal gap is also less than `delta`. Since the line sits between them, both are within `delta` of the line, i.e. inside the strip.

### J8. How many comparisons does each strip point need?
A constant — at most 7. After sorting the strip by `y`, each point only compares against the next few points whose `y` is within `delta`.

### J9. What is the time complexity of the divide-and-conquer algorithm?
`O(n log n)` for the optimal version (merge `y`-order during recursion). A simpler version that re-sorts the strip each call is `O(n log² n)`.

### J10. What happens with fewer than two points?
There is no pair, so the closest distance is undefined — return `+infinity` or raise an error. Guard this explicitly.

### J11. How do you handle duplicate (coincident) points?
Their distance is `0`, which is a perfectly valid closest pair. Make sure the loop can report a zero-distance pair; do not treat it as an error.

### J12 (analysis). Why sort the strip by `y` rather than `x`?
Because cross-pair candidates differ little in `x` (they are all near the line) but can differ in `y`. Sorting by `y` lets the early break "stop when the `y`-gap reaches `delta`" eliminate far-apart points, keeping the scan linear.

---

## Middle Questions (12 Q&A)

### M1. Prove the strip scan is O(n), not O(n²).
Each strip point `p`, looking at the `2δ`-wide × `δ`-tall box above it, sees at most a constant number of candidates: tile that box with `δ/2`-side cells; two points in one cell are `< δ` apart, but same-side points are `≥ δ` apart, so each cell holds ≤ 1 point. The box holds ≤ 8 cells → ≤ 7 candidates per point → `O(n)` total.

### M2. Why split by rank instead of by x-value?
If you split by the median `x`-*value*, a column of points sharing that `x` can all land on one side, making one recursion of size near `n` and breaking the `O(n log n)` recurrence. Splitting at index `n/2` guarantees balanced halves.

### M3. How do you make the algorithm truly O(n log n)?
Return each sub-array already sorted by `y` and **merge** the two `y`-sorted halves in `O(n)` during combine, instead of re-sorting the strip. That keeps combine linear: `T(n)=2T(n/2)+O(n)=O(n log n)`.

### M4. Describe the sweep-line alternative.
Sort by `x`. Sweep left to right keeping an active set of points ordered by `y`. For each new point, evict points more than `delta` behind in `x`, query the active set for points within `[y-δ, y+δ]` (only `O(1)` of them), compare, update `delta`, then insert. `O(n log n)` with a balanced BST.

### M5. Divide-and-conquer vs sweep line — when pick which?
Same asymptotics. Pick sweep line for iterative code using a library ordered set (`TreeSet`, `SortedList`); pick divide-and-conquer to learn the strip technique or when it composes with other recursive geometry.

### M6. What metric assumptions does the strip argument make?
It uses the Euclidean triangle relationship `|dx| ≤ d` and `|dy| ≤ d`. For Manhattan or Chebyshev metrics the band still works but the per-point constant changes; the asymptotics survive.

### M7. How would you also return the actual pair, not just the distance?
Thread a `(distance, p, q)` triple through the recursion and strip scan, updating all three whenever a closer distance is found.

### M8. How do you test the fast algorithm?
Run brute force `O(n²)` on thousands of random inputs and assert equal distances. Include adversarial cases: duplicate `x`, all collinear, all identical, two points, tight clusters.

### M9. Why does re-sorting the strip cost you a log factor?
Re-sorting `O(n)` strip points by `y` is `O(n log n)` per call across `log n` levels → `O(n log² n)`. Merging pre-sorted halves is `O(n)` per call → `O(n log n)`.

### M10. What is the role of `delta` as an invariant?
`delta` is always the best distance among examined pairs; combine only lowers it. Correctness reduces to: the strip scan never misses a cross pair that could beat the current `delta`.

### M11. How does this extend to higher dimensions?
Split by a median hyperplane; the strip becomes a slab of width `2δ`; the packing lemma still bounds candidates per point by a constant `c(d)` (independent of `n`). Time stays `O(n log n)` for fixed `d`, with constants growing in `d`.

### M12 (analysis). Why is `O(n log² n)` often acceptable in practice?
The log² version is far simpler and, for `n` up to millions, the extra `log n` (~20) is a small constant relative to cache and constant-factor effects. Many production code bases ship it for readability.

---

## Senior Questions (10 Q&A)

### S1. How would you find the closest pair among millions of points fast?
Use the randomized **grid (Rabin)** method: hash points into a grid whose cell size is the running `delta`; each point checks only its 3×3 cell neighborhood. Expected `O(n)`, with excellent cache locality from contiguous grid storage.

### S2. Sketch why the grid method is O(n) expected.
Insert points in random order. `delta` shrinks only when a new point is in the current closest pair, which (over the random "last point") happens with probability `≤ 2/(i+1)` at step `i`; the `O(i)` rebuild cost times that probability is `O(1)` per step, summing to `O(n)`. Non-rebuild inserts are `O(1)` each.

### S3. How does this power a collision-detection broad phase?
Set the grid cell size to the interaction radius. Each entity only tests neighbors in its 3×3 (or 3×3×3 in 3-D) cell block, reducing "all pairs" `O(n²)` to `O(n)` candidate pairs, which the narrow phase resolves exactly. Recomputed each frame for moving bodies.

### S4. How is air-traffic conflict detection related?
It is "all pairs within separation minimum `S`." Bucket aircraft into a grid of cell size `S`; each aircraft checks its neighbor cells. The closest-pair distance itself is a monitored signal — dropping below `S` is a conflict alert.

### S5. What changes for a dynamic (insert/delete) point set?
Inserts stay easy (check neighborhood, maybe shrink-and-rehash). **Deletes are hard** when you remove the point defining `delta`, since the new minimum is non-local; practical systems use per-cell minima plus a global heap, or periodic full rebuilds, or Bespamyatnikh's `O(log n)`-update structure.

### S6. When does a uniform grid fail, and what replaces it?
Skewed density: dense regions overload cells (back toward `O(n²)` within a cell) and sparse regions waste memory. Switch to a **k-d tree** / BVH or a multi-resolution grid.

### S7. How do you distribute closest pair across machines?
Partition the plane into vertical slabs; give each node its slab plus a `delta`-wide **halo** of the neighbor's border points; compute local closest pairs; reconcile boundary strips (the distributed analog of the combine). The halo must be ≥ the global `delta`, possibly requiring a second tightening pass.

### S8. What are the main numerical-robustness traps?
Catastrophic cancellation on large coordinates (recenter near origin), squared-distance overflow (use 64-bit/int128 or exact integers), ties up to `ε` (define a tolerance or use exact integer arithmetic), and off-by-one in the 3×3 neighbor loop.

### S9. Grid vs sweep line vs divide-and-conquer at scale — wall-clock?
Grid usually wins on uniform data due to contiguous-memory locality; sweep line's balanced-BST chases pointers and suffers cache misses; divide-and-conquer is dominated by its `x`-sort. Asymptotics tie three ways (grid `O(n)` expected aside); constants decide.

### S10 (analysis). Why doesn't the grid's `O(n)` violate the `Ω(n log n)` lower bound?
The lower bound holds in the **algebraic decision tree** model (only `+,-,*,/,sqrt`, comparisons). The grid uses the **floor** function / hashing, which lies outside that model. Different model, no contradiction.

---

## Professional Questions (8 Q&A)

### P1. State and prove the recurrence for divide-and-conquer.
With a one-time `x`-sort, each call does `O(1)` split, `2T(n/2)` recursion, `O(n)` merge of `y`-order, and `O(n)` strip scan (packing lemma). So `T(n)=2T(n/2)+O(n)`, which by the Master Theorem (case 2) is `Θ(n log n)`.

### P2. Prove the constant-points-in-strip lemma precisely.
In the `2δ×δ` box above a strip point, tile with `δ/2`-side cells aligned to the line. Two points in one cell are at most `δ/√2 < δ` apart; same-side points are `≥ δ` apart, so each cell holds ≤ 1 point. The box has ≤ 8 cells, so ≤ 7 other points per strip point. Hence the scan is `O(|strip|)`.

### P3. Give the lower-bound proof.
Reduce from **element distinctness** (Ω(n log n), Ben-Or 1983): map reals `a_i` to points `(a_i, 0)`; then the minimum gap is `0` iff some `a_i` repeat. A faster-than-`n log n` closest pair would solve element distinctness faster, a contradiction. So closest pair is `Ω(n log n)` in the algebraic model.

### P4. Why is the divide-and-conquer algorithm optimal?
Its `Θ(n log n)` matches the `Ω(n log n)` lower bound in the same (algebraic/comparison) model, so no algorithm in that model can be asymptotically faster.

### P5. Walk through the backwards-analysis for Rabin's `O(n)`.
Random insertion order; at step `i+1`, `delta` decreases (forcing an `O(i)` rebuild) only if the last-inserted point is in the closest pair of the first `i+1` points — probability `≤ 2/(i+1)`. Expected rebuild cost per step `= O(i)·2/(i+1) = O(1)`; summed `O(n)`. Plus `O(n)` for cheap inserts.

### P6. How does the algorithm and its bound change in `R^d`?
Median-hyperplane split, `2δ` slab, packing constant `c(d)` (independent of `n`, exponential in `d`). Time stays `O(n log n)` for fixed `d`; the grid method stays `O(n)` expected with `3^d` neighbor cells.

### P7. Discuss the dynamic closest-pair complexity.
Fully dynamic with `O(log n)` per update in fixed dimension is achievable (Bespamyatnikh 1998) via fair-split trees / grid hierarchies. The hard direction is deletion of the defining point, which can change the global minimum non-locally.

### P8. Why is closest pair "in the same class" as sorting?
Element distinctness `≤` closest pair `≤` sorting, and all three are `Θ(n log n)` in the comparison/algebraic model. Closest pair therefore sits exactly at the sorting barrier — neither easier nor harder asymptotically.

---

## Applications Round (6 Q&A)

### A1. Where does closest pair appear in a game engine?
In the **broad phase** of collision detection: a uniform grid or BVH narrows millions of body pairs down to `O(n)` candidates that *could* touch, which the narrow phase resolves exactly. The closest-pair locality argument (only compare spatially adjacent objects) is exactly what makes 60-fps physics feasible.

### A2. How is it used in air-traffic control?
As "all pairs within the separation minimum `S`." Aircraft are bucketed into a grid of cell size `S`; each aircraft checks its 3×3 (or 3×3×3 with altitude) cell block. The minimum pairwise distance is monitored — dropping below `S` raises a conflict alert.

### A3. How does clustering use it?
Agglomerative (hierarchical) clustering repeatedly merges the two **closest** clusters; the very first merge is the closest pair of points. A spatial index keeps each merge sub-quadratic instead of rescanning all pairs.

### A4. What about n-body / physics simulation?
The minimum inter-body distance bounds the largest numerically stable integration timestep. Simulators recompute it (often from the same quad/octree used for force approximation) and shrink `Δt` when two bodies get close.

### A5. How would you de-duplicate near-identical GPS coordinates at scale?
"Find all pairs within radius `r`" — bucket points into a grid of cell size `r`, compare only within the 3×3 neighborhood, stream out the duplicate pairs. This turns an `O(n²)` dedup into roughly `O(n)` for uniformly spread data.

### A6. Why not just always use a k-d tree?
A k-d tree is great for repeated nearest-neighbor and range queries on a *static* set, but it rebalances poorly when points move every tick, and it chases pointers (poor cache locality). For a uniformly dense, frequently-updated set, a flat grid is simpler and faster; closest pair specifically only needs the grid.

---

## Coding Challenge (3 Languages)

### Challenge: Closest Pair of Points

> Given `n` points, return the minimum Euclidean distance between any two of them. Implement the `O(n log n)` divide-and-conquer algorithm (merge by `y`). Must handle duplicate `x`-coordinates, collinear points, and coincident points (distance 0).
>
> **Input:** a list of `(x, y)` points (`2 ≤ n ≤ 200,000`).
> **Output:** the closest distance, accurate to 1e-6.
> **Examples:**
> - `[(0,0),(3,4)]` → `5.0`
> - `[(1,3),(2,7),(3,1),(5,5),(6,8),(7,2),(8,6),(9,4)]` → `2.2360...`
> - `[(0,0),(0,0),(5,5)]` → `0.0` (duplicate)

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

type Point struct{ X, Y float64 }

func dist(a, b Point) float64 {
	dx, dy := a.X-b.X, a.Y-b.Y
	return math.Sqrt(dx*dx + dy*dy)
}

// closest returns (minDist, ySorted) for px (sorted by X).
func closest(px []Point) (float64, []Point) {
	n := len(px)
	if n <= 3 {
		best := math.Inf(1)
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				best = math.Min(best, dist(px[i], px[j]))
			}
		}
		ys := append([]Point(nil), px...)
		sort.Slice(ys, func(i, j int) bool { return ys[i].Y < ys[j].Y })
		return best, ys
	}
	mid := n / 2
	midX := px[mid].X
	dl, yl := closest(px[:mid])
	dr, yr := closest(px[mid:])
	delta := math.Min(dl, dr)

	// merge y-sorted halves
	ys := make([]Point, 0, n)
	i, j := 0, 0
	for i < len(yl) && j < len(yr) {
		if yl[i].Y <= yr[j].Y {
			ys = append(ys, yl[i]); i++
		} else {
			ys = append(ys, yr[j]); j++
		}
	}
	ys = append(ys, yl[i:]...)
	ys = append(ys, yr[j:]...)

	var strip []Point
	for _, p := range ys {
		if math.Abs(p.X-midX) < delta {
			strip = append(strip, p)
		}
	}
	for a := 0; a < len(strip); a++ {
		for b := a + 1; b < len(strip) && strip[b].Y-strip[a].Y < delta; b++ {
			delta = math.Min(delta, dist(strip[a], strip[b]))
		}
	}
	return delta, ys
}

func ClosestPair(pts []Point) float64 {
	px := append([]Point(nil), pts...)
	sort.Slice(px, func(i, j int) bool { return px[i].X < px[j].X })
	d, _ := closest(px)
	return d
}

func main() {
	pts := []Point{{1, 3}, {2, 7}, {3, 1}, {5, 5}, {6, 8}, {7, 2}, {8, 6}, {9, 4}}
	fmt.Printf("%.4f\n", ClosestPair(pts))                       // 2.2360
	fmt.Printf("%.1f\n", ClosestPair([]Point{{0, 0}, {3, 4}}))    // 5.0
	fmt.Printf("%.1f\n", ClosestPair([]Point{{0, 0}, {0, 0}, {5, 5}})) // 0.0
}
```

#### Java

```java
import java.util.*;

public class ClosestPair {
    record Point(double x, double y) {}

    static double dist(Point a, Point b) {
        double dx = a.x() - b.x(), dy = a.y() - b.y();
        return Math.sqrt(dx * dx + dy * dy);
    }

    static double closest(Point[] px, int lo, int hi, List<Point> ys) {
        int n = hi - lo;
        if (n <= 3) {
            double best = Double.POSITIVE_INFINITY;
            for (int i = lo; i < hi; i++)
                for (int j = i + 1; j < hi; j++)
                    best = Math.min(best, dist(px[i], px[j]));
            for (int i = lo; i < hi; i++) ys.add(px[i]);
            ys.sort(Comparator.comparingDouble(Point::y));
            return best;
        }
        int mid = lo + n / 2;
        double midX = px[mid].x();
        List<Point> yl = new ArrayList<>(), yr = new ArrayList<>();
        double delta = Math.min(closest(px, lo, mid, yl), closest(px, mid, hi, yr));

        int i = 0, j = 0;
        while (i < yl.size() && j < yr.size())
            ys.add(yl.get(i).y() <= yr.get(j).y() ? yl.get(i++) : yr.get(j++));
        while (i < yl.size()) ys.add(yl.get(i++));
        while (j < yr.size()) ys.add(yr.get(j++));

        List<Point> strip = new ArrayList<>();
        for (Point p : ys) if (Math.abs(p.x() - midX) < delta) strip.add(p);
        for (int a = 0; a < strip.size(); a++)
            for (int b = a + 1; b < strip.size()
                    && strip.get(b).y() - strip.get(a).y() < delta; b++)
                delta = Math.min(delta, dist(strip.get(a), strip.get(b)));
        return delta;
    }

    static double closestPair(Point[] pts) {
        Point[] px = pts.clone();
        Arrays.sort(px, Comparator.comparingDouble(Point::x));
        return closest(px, 0, px.length, new ArrayList<>());
    }

    public static void main(String[] args) {
        Point[] a = {
            new Point(1,3), new Point(2,7), new Point(3,1), new Point(5,5),
            new Point(6,8), new Point(7,2), new Point(8,6), new Point(9,4)
        };
        System.out.printf("%.4f%n", closestPair(a));                        // 2.2360
        System.out.printf("%.1f%n", closestPair(new Point[]{new Point(0,0), new Point(3,4)})); // 5.0
        System.out.printf("%.1f%n", closestPair(new Point[]{new Point(0,0), new Point(0,0), new Point(5,5)})); // 0.0
    }
}
```

#### Python

```python
import math


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def closest_pair(pts):
    px = sorted(pts, key=lambda p: p[0])

    def rec(px):
        n = len(px)
        if n <= 3:
            best = math.inf
            for i in range(n):
                for j in range(i + 1, n):
                    best = min(best, dist(px[i], px[j]))
            return best, sorted(px, key=lambda p: p[1])
        mid = n // 2
        mid_x = px[mid][0]
        dl, yl = rec(px[:mid])
        dr, yr = rec(px[mid:])
        delta = min(dl, dr)

        ys, i, j = [], 0, 0
        while i < len(yl) and j < len(yr):
            if yl[i][1] <= yr[j][1]:
                ys.append(yl[i]); i += 1
            else:
                ys.append(yr[j]); j += 1
        ys.extend(yl[i:]); ys.extend(yr[j:])

        strip = [p for p in ys if abs(p[0] - mid_x) < delta]
        for a in range(len(strip)):
            b = a + 1
            while b < len(strip) and strip[b][1] - strip[a][1] < delta:
                delta = min(delta, dist(strip[a], strip[b]))
                b += 1
        return delta, ys

    return rec(px)[0]


if __name__ == "__main__":
    print(f"{closest_pair([(1,3),(2,7),(3,1),(5,5),(6,8),(7,2),(8,6),(9,4)]):.4f}")  # 2.2360
    print(f"{closest_pair([(0,0),(3,4)]):.1f}")          # 5.0
    print(f"{closest_pair([(0,0),(0,0),(5,5)]):.1f}")    # 0.0
```

**Follow-ups the interviewer may ask:**
- Return the actual pair, not just the distance (thread a `(d, p, q)` triple).
- Make it `O(n)` expected with the grid method (describe Rabin's algorithm).
- Extend to 3-D (median hyperplane, slab, `3^d` neighbor cells).
- Prove the strip scan is linear (the packing lemma).

---

## Variations and Related Problems (6 Q&A)

### V1. Closest pair under the Manhattan (L1) metric — what changes?
The strip/grid logic still holds; only the cell geometry changes. Under L1, `|dx| + |dy| < δ` defines a diamond, but the packing argument gives a (different) constant per cell, so it stays `O(n log n)` / `O(n)`. (See sibling *16-manhattan-chebyshev*.)

### V2. *Farthest* pair instead of closest?
Different problem: the farthest pair lies on the **convex hull**, so compute the hull (sibling *01-convex-hull*) then use **rotating calipers** (sibling *06-rotating-calipers*) in `O(n log n)`. Divide-and-conquer-by-strip does not apply.

### V3. k closest pairs?
Maintain a size-`k` max-heap of the smallest distances while running the same strip/grid scan; report the heap at the end. The candidate generation is unchanged.

### V4. Closest pair between two separate sets (bichromatic)?
"Closest red-blue pair." A grid or k-d tree still works; the strip scan just restricts comparisons to opposite-colored points. Useful in matching and nearest-facility problems.

### V5. All nearest neighbors (each point's nearest)?
A superset of closest pair. A k-d tree or the same divide-and-conquer framework answers it in `O(n log n)`; the global closest pair is then the minimum over all these nearest-neighbor distances.

### V6. Approximate closest pair in high dimensions?
Exact methods suffer the curse of dimensionality (constants exponential in `d`). Use **locality-sensitive hashing (LSH)** for a `(1+ε)`-approximation in sub-quadratic time — the practical choice for high-dimensional vectors.

---

## Mock Interview Walkthrough

A realistic exchange you can rehearse end to end.

**Interviewer:** "Given points on a plane, find the closest two. What's your first thought?"

**You:** "Brute force is `O(n²)` — check every pair, track the minimum squared distance. I'd write that first as a baseline and test oracle. But it won't scale, so the target is the `O(n log n)` divide-and-conquer."

**Interviewer:** "Walk me through the fast one."

**You:** "Sort by x once. Split at the median *rank* into left and right halves — rank, not value, so duplicate x-coordinates can't dump everything on one side. Recurse to get `dL` and `dR`, set `delta = min(dL, dR)`. The answer is either one of those or a pair straddling the line. A straddling pair closer than `delta` must lie within `delta` of the line horizontally — so I keep only the strip of width `2δ`."

**Interviewer:** "That strip could still be `O(n)` points. Isn't the scan quadratic?"

**You:** "No — and that's the key insight. I sort the strip by y. For each point, a closer partner must be within `delta` in y too, so I scan forward and break as soon as the y-gap reaches `delta`. The number of points in that `2δ × δ` window is bounded by a constant — at most 7 — because two points in a `δ/2` cell would be closer than `δ`, but same-side points are already `≥ δ` apart. So each point does `O(1)` work and the combine is `O(n)`."

**Interviewer:** "Complexity?"

**You:** "`T(n) = 2T(n/2) + O(n) = O(n log n)`, provided I merge the y-sorted halves during recursion rather than re-sorting the strip each call — otherwise it's `O(n log² n)`. And `O(n log n)` is optimal in the comparison model: closest pair is `Ω(n log n)` by reduction from element distinctness."

**Interviewer:** "Can you beat `n log n`?"

**You:** "Yes, in expectation — Rabin's randomized grid is `O(n)` expected. It hashes points into a grid sized at the running `delta` and checks only the 3×3 cell neighborhood. It beats the lower bound because it uses the floor function for hashing, which the algebraic-model lower bound forbids."

**Interviewer:** "Edge cases?"

**You:** "Fewer than two points → undefined, I guard it. Duplicates → distance 0, a valid answer. All collinear or a vertical line of points → still correct; the strip just holds more points but the y-scan stays bounded. Integer coordinates → I'd use exact 64-bit squared distance to avoid float issues entirely."

---

## Whiteboard Tips and Edge Cases

When you have to do this live, a clean derivation beats a memorized constant.

| Trap | What to say / do |
|------|------------------|
| Forgetting `sqrt` placement | "I compare squared distances and `sqrt` only the final answer." |
| Splitting by x-value | "I split by **rank** `n/2`, so duplicate x can't unbalance the recursion." |
| Quoting "7" without justifying | "Each strip point sees ≤ a constant number ahead because same-side points are ≥ δ apart and can't crowd a δ/2-cell grid." |
| Re-sorting the strip | "I merge the y-sorted halves during recursion to stay at `O(n log n)`." |
| n < 2 | "I guard it: fewer than two points has no pair." |
| Duplicate points | "Distance 0 is a valid answer, not an error." |
| Asked for `O(n)` | "Only with hashing — Rabin's randomized grid — which steps outside the comparison model that the `Ω(n log n)` bound assumes." |

**The 30-second pitch** (memorize this shape):
> "Sort by x. Recurse on halves to get `delta`. A cross pair beating `delta` must sit in the width-`2δ` strip and within `δ` in y, and the geometry caps the candidates per point at a constant — so the combine is linear and the whole thing is `O(n log n)`, which is optimal by reduction from element distinctness."

---

## Complexity Derivation Drill

Interviewers love asking you to *derive*, not recall. Practice writing this:

```text
T(n) = 2 T(n/2) + O(n)        # two halves + linear combine (merge + strip)
     = O(n log n)             # Master Theorem case 2

Why combine is O(n):
  - merging two y-sorted halves:        O(n)
  - filtering strip (one pass):         O(n)
  - strip scan, <=7 comparisons/point:  O(n)

Why <=7: the box above a strip point is 2*delta wide, delta tall.
  Tile with (delta/2)-cells -> <=8 cells, <=1 point each
  (two in a cell would be < delta apart, but same-side points are >= delta).
  So <=7 OTHER points -> O(1) per point.

Lower bound: element distinctness (Omega(n log n)) reduces to closest pair
  via a_i -> (a_i, 0). So closest pair is Omega(n log n) -> DC is optimal.
```

---

## Rapid-Fire Round (quick answers)

| Q | A |
|---|---|
| Metric used? | Euclidean (squared for comparisons). |
| Strip width? | `2δ` (δ each side of the line). |
| Sort strip by? | `y`, then early-break when `dy ≥ δ`. |
| Split criterion? | rank `n/2`, not x-value. |
| Optimal trick? | merge y-order instead of re-sorting. |
| Faster than `n log n`? | randomized grid `O(n)` expected (Rabin). |
| Why grid escapes the bound? | uses `floor`/hashing, outside algebraic model. |
| Lower bound source? | element distinctness, `Ω(n log n)`. |
| Higher dim? | median hyperplane + `2δ` slab; const `c(d)`. |
| Dynamic? | grid shrink-and-rehash for inserts; deletes are hard. |
| Best test oracle? | brute force `O(n²)`. |
| Collision use? | grid cell = interaction radius, 3×3 neighbor scan. |

---

## One-Minute Recap Before the Interview

- **Brute force** `O(n²)` first — it is the oracle, never skip it.
- **Divide & conquer** `O(n log n)`: sort by x, split by **rank**, `delta = min(dL, dR)`, scan the **`2δ` strip** in y-order with the constant-comparison early break.
- **Merge y-order** during recursion to avoid the `log²` factor.
- **Sweep line** is the iterative `O(n log n)` alternative (ordered set window).
- **Randomized grid** is `O(n)` expected — only because it uses hashing.
- **`Ω(n log n)`** lower bound via element distinctness makes the DC algorithm optimal in the comparison model.
- Edge cases: `n < 2`, duplicates (distance 0), collinear, vertical column.

---

Next step: [tasks.md](./tasks.md) — graded practice problems in all three languages.
