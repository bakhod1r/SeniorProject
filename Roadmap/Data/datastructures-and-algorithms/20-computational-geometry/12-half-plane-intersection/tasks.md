# Half-Plane Intersection — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from the rest of this topic: the **side test** `cross(d, q − p) ≥ 0`, the **two-line corner** `inter(a, b)`, the **angle-sort + deque sweep**, the **bounding box** for unbounded regions, and the **size < 3** check for empty regions.
> Convention throughout: a half-plane is `(point P, direction D)` with the **allowed side to the left of D**. Build half-planes from `a·x + b·y ≤ c` with `D = (−b, a)` and a point on the line.

---

## Beginner Tasks (5)

### Task 1 — The side test

**Statement.** Implement `satisfies(h, q)` that returns `true` iff point `q` is on the allowed side of half-plane `h` (on the line counts as inside). Then, given a list of half-planes and a query point, return whether the point satisfies *all* of them.

**Constraints.**
- Use `cross(d, q − p) ≥ −EPS` with `EPS = 1e-9`.
- `O(m)` for the all-check.

**Hints.**
- The sign of the cross product is the whole test.
- "On the line" (`cross == 0`) is inside for a closed half-plane.

#### Go
```go
func satisfies(h HP, q Vec) bool { /* cross(h.D, q-h.P) >= -1e-9 */ return false }
func main() {}
```

#### Java
```java
public class Task1 {
    static boolean satisfies(HP h, double qx, double qy) { return false; }
    public static void main(String[] args) {}
}
```

#### Python
```python
def satisfies(h, q):
    # cross(h.dx, h.dy, q[0]-h.px, q[1]-h.py) >= -1e-9
    pass
```

- **Expected Output:** `true` only when the point is inside every half-plane.
- **Evaluation:** correct sign handling, on-line inclusion, epsilon use.

---

### Task 2 — Build a half-plane from an inequality

**Statement.** Implement `from_ineq(a, b, c)` returning the `(P, D)` half-plane for `a·x + b·y ≤ c`, allowed side on the left of `D`. Verify with a known interior point.

**Constraints.**
- Pick `P` robustly (divide by the larger of `|a|, |b|`).
- `D = (−b, a)`.

**Hints.**
- Test: `from_ineq(1, 0, 4)` is `x ≤ 4`; the point `(0,0)` must be inside, `(5,0)` outside.

Provide starter code in all 3 languages (signature `from_ineq(a, b, c) -> HP`).

- **Expected Output:** a half-plane whose `satisfies` agrees with the raw inequality.
- **Evaluation:** correct direction/flip, robust point choice.

---

### Task 3 — Intersect two boundary lines

**Statement.** Implement `inter(a, b)` returning the intersection point of the boundary lines of two half-planes, and return a sentinel (or flag) when they are parallel.

**Constraints.**
- Parallel ⇔ `|cross(a.D, b.D)| < 1e-12`.
- Do not divide when parallel.

**Hints.**
- `t = cross(b.P − a.P, b.D) / cross(a.D, b.D)`, then `a.P + t·a.D`.

Provide starter code in all 3 languages.

- **Expected Output:** the crossing point, or "parallel."
- **Evaluation:** correct formula, parallel guard (no divide-by-zero).

---

### Task 4 — Incremental clip (Sutherland–Hodgman)

**Statement.** Start from a large box polygon and clip it by a single half-plane, keeping only the part on the allowed side. Return the new polygon's vertices.

**Constraints.**
- `O(k)` where `k` is the polygon size.
- Add an edge–line intersection point whenever an edge crosses the boundary.

**Hints.**
- For each edge `(cur, nxt)`: keep `cur` if inside; if `cur` and `nxt` differ in side, add the crossing point.

Provide starter code in all 3 languages (signature `clip(poly, h) -> poly`).

- **Expected Output:** the clipped polygon (possibly empty).
- **Evaluation:** correct in/out transitions, crossing-point insertion.

---

### Task 5 — Full intersection via repeated clipping (O(m²))

**Statement.** Using Task 4's `clip`, intersect `m` half-planes by clipping a big box polygon once per half-plane. Return the final polygon or "empty."

**Constraints.**
- `O(m²)` total.
- Start from a box covering `±BIG`.

**Hints.**
- Loop over half-planes, reassigning `poly = clip(poly, h)`.
- If `poly` becomes empty, the region is empty.

Provide starter code in all 3 languages.

- **Expected Output:** the feasible polygon, or "empty."
- **Evaluation:** correct loop, empty detection, matches the fast solver on simple inputs.

---

## Intermediate Tasks (5)

### Task 6 — The O(m log m) angular-sweep solver

**Statement.** Implement the full deque-sweep half-plane intersection: add a bounding box, sort by angle, sweep with both-end popping, final cleanup, and return corners (or "empty").

**Constraints.**
- `O(m log m)`.
- Pop from **both** ends; guard `size < 3`.

**Hints.**
- Sort by `atan2(D.y, D.x)`; tie-break by which is tighter.
- After the loop, run the final front/back cleanup.

Provide starter code in all 3 languages (signature `hpi(planes) -> poly | None`).

- **Expected Output:** the polygon corners in cyclic order, or "empty."
- **Evaluation:** correct both-end popping, parallel skip, empty handling.

---

### Task 7 — Classify the result

**Statement.** Extend Task 6 to classify the output as `EMPTY`, `UNBOUNDED`, `POINT`, `SEGMENT`, or `BOUNDED`.

**Constraints.**
- `UNBOUNDED` ⇔ an output edge lies on the bounding box.
- `POINT`/`SEGMENT` ⇔ near-zero area.

**Hints.**
- Compare a corner's `|coord|` to `0.9·BIG` to detect box-incident edges.
- Use the shoelace formula for area; near-zero ⇒ degenerate.

Provide starter code in all 3 languages.

- **Expected Output:** one of the five classification labels (+ corners when applicable).
- **Evaluation:** complete partition, correct degeneracy thresholds.

---

### Task 8 — 2D linear programming

**Statement.** Given constraints `aᵢ·x + bᵢ·y ≤ cᵢ` and objective `(ox, oy)`, return `INFEASIBLE`, `UNBOUNDED`, or the maximum objective value with its optimal corner.

**Constraints.**
- Feasibility = non-empty intersection.
- Optimum at a corner; `UNBOUNDED` if the optimum sits on a box edge.

**Hints.**
- Reuse Task 7's classification.
- Scan corners for the max of `ox·x + oy·y`.

Provide starter code in all 3 languages.

- **Expected Output:** `INFEASIBLE` / `UNBOUNDED` / `(maxValue, corner)`.
- **Evaluation:** correct feasibility, optimum at vertex, unbounded detection.

---

### Task 9 — Polygon kernel

**Statement.** Given a simple polygon (CCW), compute its **kernel** — the set of points that see the entire polygon — as a half-plane intersection of the interior side of every edge. Report whether the polygon is star-shaped.

**Constraints.**
- One half-plane per edge (interior on the left for CCW input).
- `O(n log n)`.

**Hints.**
- Edge `(a → b)` gives a half-plane with `P = a`, `D = b − a`.
- Non-empty kernel ⇒ star-shaped.

Provide starter code in all 3 languages.

- **Expected Output:** the kernel polygon (or "empty" → not star-shaped).
- **Evaluation:** correct edge orientation, reuse of the solver.

---

### Task 10 — Area of the feasible region

**Statement.** Compute the area of the bounded feasible region defined by a set of half-planes. Return `0` for empty/degenerate and `∞` (or a flag) for unbounded.

**Constraints.**
- Use the shoelace formula on the corner list.
- Detect unbounded via Task 7.

**Hints.**
- Shoelace: `0.5·|Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|`.

Provide starter code in all 3 languages.

- **Expected Output:** the polygon area, or `0` / unbounded flag.
- **Evaluation:** correct shoelace, correct handling of non-bounded cases.

---

## Advanced Tasks (5)

### Task 11 — Robust integer-predicate solver

**Statement.** Reimplement the sweep so that all *combinatorial decisions* (side test, parallel detection) use **exact integer arithmetic** when inputs are integers, computing floating-point corner coordinates only at the end.

**Constraints.**
- Integer `cross` for the side test (exact sign).
- Floats only for output positions.

**Hints.**
- Keep half-planes as integer `(P, D)`; the side test never rounds.
- Intersection coordinates are rational; emit doubles last.

Provide starter code in all 3 languages.

- **Expected Output:** the same polygon as Task 6, but with provably-consistent decisions.
- **Evaluation:** no float in decisions, correct on near-degenerate integer inputs.

---

### Task 12 — Seidel's randomized incremental LP

**Statement.** Implement Seidel's `O(m)` expected-time 2D LP: shuffle constraints, maintain the optimum, and re-solve a 1D LP on a line when a constraint is violated. Return `INFEASIBLE` / `UNBOUNDED` / optimum.

**Constraints.**
- Expected `O(m)`; random shuffle each run.
- 1D sub-LP on the violated constraint's line.

**Hints.**
- Bound the search with a big box so the objective is initially bounded.
- When constraint `i` is violated, project all earlier constraints onto its line and solve the resulting interval LP.

Provide starter code in all 3 languages.

- **Expected Output:** the LP optimum, matching Task 8.
- **Evaluation:** correct 1D restriction, expected-linear behavior, matches the HPI-based LP.

---

### Task 13 — Intersection of two convex polygons

**Statement.** Intersect two convex polygons by treating each polygon's edges as half-planes and intersecting all of them. Return the resulting convex polygon.

**Constraints.**
- Both polygons CCW; each edge → one interior half-plane.
- `O((n + m) log(n + m))` via the sweep.

**Hints.**
- Concatenate both edge-half-plane lists and run `hpi`.
- The result is the overlap region.

Provide starter code in all 3 languages.

- **Expected Output:** the overlap polygon (or "empty" if disjoint).
- **Evaluation:** correct half-plane extraction, empty handling for disjoint polygons.

---

### Task 14 — Largest inscribed axis-aligned square (feasibility search)

**Statement.** Given a convex region as half-planes, find (to a tolerance) the side length of the largest axis-aligned square that fits inside. Use binary search on the side length plus a half-plane feasibility test.

**Constraints.**
- Binary search on `s`; for each `s`, shrink each half-plane inward by `s/2` (offset `c`) and test feasibility.
- `O(m log m · log(range/tol))`.

**Hints.**
- A square of side `s` fits iff its center lies in the region eroded by `s/2` along each constraint's normal.
- Erosion of `a·x + b·y ≤ c` by `r` is `a·x + b·y ≤ c − r·|(a,b)|`.

Provide starter code in all 3 languages.

- **Expected Output:** the maximal side length within tolerance.
- **Evaluation:** correct erosion offset, monotone feasibility, binary-search convergence.

---

### Task 15 — Streaming / incremental constraints

**Statement.** Support adding half-planes one at a time and querying the current feasible region after each addition, sharing work across additions where possible. Compare your approach to recomputing from scratch.

**Constraints.**
- Each query returns the current region's classification + corners.
- Discuss (in comments) the amortized cost vs full recompute.

**Hints.**
- The simplest correct approach: maintain the current polygon and clip by each new half-plane (`O(current size)` per add).
- Note when a single new constraint makes the region empty.

Provide starter code in all 3 languages.

- **Expected Output:** the region after each insertion; empty once constraints contradict.
- **Evaluation:** correct incremental updates, clear cost analysis in comments.

---

## Benchmark Task

> Compare the `O(m log m)` deque sweep against the `O(m²)` incremental clip across input sizes, in all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{100, 1000, 5000, 20000} {
		planes := make([]HP, n)
		for i := range planes {
			a := rand.Float64() * 2 * math.Pi
			planes[i] = HP{Vec{math.Cos(a) * 100, math.Sin(a) * 100}, Vec{-math.Sin(a), math.Cos(a)}}
		}
		start := time.Now()
		hpi(planes) // your O(m log m) solver
		fmt.Printf("m=%6d: %.3f ms\n", n, float64(time.Since(start).Microseconds())/1000)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        for (int n : new int[]{100, 1000, 5000, 20000}) {
            java.util.List<HP> planes = new java.util.ArrayList<>();
            for (int i = 0; i < n; i++) {
                double a = Math.random() * 2 * Math.PI;
                planes.add(new HP(Math.cos(a)*100, Math.sin(a)*100, -Math.sin(a), Math.cos(a)));
            }
            long s = System.nanoTime();
            hpi(planes); // your O(m log m) solver
            System.out.printf("m=%6d: %.3f ms%n", n, (System.nanoTime()-s)/1e6);
        }
    }
}
```

#### Python

```python
import math, random, time

for n in [100, 1000, 5000, 20000]:
    planes = []
    for _ in range(n):
        a = random.uniform(0, 2 * math.pi)
        planes.append(HP(math.cos(a)*100, math.sin(a)*100, -math.sin(a), math.cos(a)))
    s = time.perf_counter()
    hpi(planes)  # your O(m log m) solver
    print(f"m={n:>6}: {(time.perf_counter()-s)*1000:.3f} ms")
```

> Expect the sweep to scale ~`m log m` and the clip to scale ~`m²`. For large `m` in Python, replace list `pop(0)` with `collections.deque` to keep the front-pop `O(1)`.
