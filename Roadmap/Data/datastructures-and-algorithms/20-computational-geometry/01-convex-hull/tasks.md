# Convex Hull (2D) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from this topic: the **orientation primitive** `cross(A,B,C)`, **Andrew's monotone chain**, deliberate **collinear handling** (`<= 0` drops, `< 0` keeps), and **integer arithmetic** for an exact sign.
> Hard rule throughout: prefer **integer coordinates** so the orientation test is exact, and use **64-bit** for the cross product to avoid overflow.

---

## Beginner Tasks (5)

### Task 1 — The orientation primitive

**Statement.** Implement `orient(A, B, C)` returning a positive value for a left turn (CCW), negative for a right turn (CW), and zero for collinear. Then write `turn(A, B, C)` returning the string `"left"`, `"right"`, or `"straight"`.

**Constraints.** Integer coordinates, `|x|,|y| ≤ 10^9`; use 64-bit. `O(1)`.

**Hints.**
- `orient = (Bx-Ax)(Cy-Ay) - (By-Ay)(Cx-Ax)`.
- Test on `A=(0,0), B=(1,0)` with `C=(0,1)` (left), `C=(0,-1)` (right), `C=(2,0)` (straight).

**Expected output.** `left`, `right`, `straight` for the three cases above.

**Evaluation.** Correct signs on hand-checked triples, no overflow, no floating point.

---

### Task 2 — Monotone chain convex hull

**Statement.** Implement Andrew's monotone chain. Input: a list of integer points. Output: the hull vertices in counter-clockwise order, dropping collinear points.

**Constraints.** `1 ≤ n ≤ 10^5`; `O(n log n)`.

**Hints.**
- Sort by `(x, y)`, dedup, guard `n < 3`.
- Lower then upper sweep; pop while `cross(top2, p) <= 0`.
- Concatenate, dropping the two shared endpoints.

**Expected output.** For `(0,0),(2,0),(2,2),(0,2),(1,1)` → `(0,0),(2,0),(2,2),(0,2)`.

**Evaluation.** Correct hull, CCW order, interior points removed.

---

### Task 3 — Keep collinear points

**Statement.** Modify Task 2 to **keep** points that lie on a hull edge (every boundary point becomes a hull vertex). Provide a `keepCollinear` flag.

**Constraints.** `O(n log n)`.

**Hints.** Change the pop condition from `<= 0` to `< 0` when `keepCollinear` is true.

**Expected output.** For `(0,0),(1,0),(2,0),(2,2),(0,2)` with keep → 5 vertices including `(1,0)`; with drop → 4 vertices.

**Evaluation.** Both conventions correct; flag toggles behavior.

---

### Task 4 — Polygon signed area (shoelace)

**Statement.** Given a polygon as an ordered list of integer points, return **twice its signed area** using the shoelace formula. Positive means the vertices are counter-clockwise.

**Constraints.** Exact integer result; `O(n)`.

**Hints.** `2·area = Σ (x_i · y_{i+1} - x_{i+1} · y_i)` over the cycle.

**Expected output.** For the unit square `(0,0),(1,0),(1,1),(0,1)` → `2`.

**Evaluation.** Exact integer, correct sign indicates orientation.

---

### Task 5 — Point in convex polygon (brute `O(h)`)

**Statement.** Given a CCW convex polygon and a query point, return `true` if the point is inside or on the boundary. Use the orientation test against every edge.

**Constraints.** `O(h)` per query.

**Hints.** The point is inside a CCW polygon iff `orient(edge_start, edge_end, p) >= 0` for **every** edge.

**Expected output.** For the unit square and point `(0.5, 0.5)` → `true`; `(2, 2)` → `false`.

**Evaluation.** Boundary points count as inside; correct on all edges.

---

## Intermediate Tasks (5)

### Task 6 — Brute-force hull verifier

**Statement.** Write an `O(n³)` reference hull: a point is a hull vertex iff there exists an ordered pair of other points such that all remaining points lie on one side of the directed line. Use it to verify your monotone chain on random inputs.

**Constraints.** `n ≤ 200` for the brute force; compare against Task 2.

**Hints.** For each candidate `p`, check if some directed line through two points keeps all others on one side and `p` on the boundary; simpler: for each ordered pair `(a,b)`, if all points have `orient(a,b,·) >= 0`, the edge `a→b` is a hull edge.

**Expected output.** "MATCH" across many random trials.

**Evaluation.** Catches off-by-one and collinear bugs by disagreement.

---

### Task 7 — Diameter via rotating calipers

**Statement.** Compute the squared diameter (largest squared distance between any two points) of a point set. Build the hull, then use rotating calipers in `O(h)`.

**Constraints.** `O(n log n)`; integer arithmetic (return squared distance to stay exact).

**Hints.**
- The farthest pair are both hull vertices.
- Advance the opposite pointer while the triangle area (cross) keeps increasing.

**Expected output.** For a `0..10` square's corners → `200` (diagonal² = `10²+10²`).

**Evaluation.** Matches the `O(n²)` all-pairs answer on random inputs.

---

### Task 8 — Gift wrapping (Jarvis march)

**Statement.** Implement gift wrapping. Start at the leftmost point; repeatedly select the most-counter-clockwise next point until you return to the start. Report the hull and the number of orientation tests performed.

**Constraints.** `O(nh)`.

**Hints.** From current point `cur`, pick candidate `next`; for every other `p`, if `orient(cur, next, p) < 0` (p is more clockwise) update `next`.

**Expected output.** Same hull as monotone chain; test count scales with `n·h`.

**Evaluation.** Correct hull; demonstrate `O(nh)` by timing on small-`h` vs large-`h` inputs.

---

### Task 9 — Hull perimeter and area report

**Statement.** Given points, build the hull and report (a) the hull as CCW vertices, (b) its perimeter (floating point, sum of edge lengths), and (c) twice its area (exact integer).

**Constraints.** `O(n log n)`. Keep area exact (integer); perimeter may be float.

**Hints.** Perimeter = `Σ sqrt((dx)² + (dy)²)` over edges; area via Task 4.

**Expected output.** For the unit square → perimeter `4.0`, `2·area = 2`.

**Evaluation.** Area exact; perimeter within tolerance.

---

### Task 10 — Overflow-safe large coordinates

**Statement.** Build the hull for points with coordinates up to `±10^9`. Demonstrate that a 32-bit cross product gives a wrong answer on a crafted input, while 64-bit is correct.

**Constraints.** Show both the buggy (32-bit) and correct (64-bit) results.

**Hints.** Pick three near-collinear points with large coordinates whose 64-bit cross product is small but whose 32-bit computation overflows.

**Expected output.** 32-bit version produces a wrong sign / wrong hull; 64-bit is correct.

**Evaluation.** Clear demonstration of the overflow hazard and its fix.

---

## Advanced Tasks (5)

### Task 11 — Convex hull trick (line envelope)

**Statement.** Maintain the lower envelope of a set of lines `y = m·x + b` added in increasing slope order, supporting "minimum `y` at query `x`" queries. Use the monotone-chain pop idea on lines.

**Constraints.** `O(n)` to add `n` lines in slope order; `O(log n)` per query (or `O(1)` amortized for monotone queries).

**Hints.** A line is redundant if it never gives the minimum — detect via the intersection-`x` ordering, popping lines whose useful range vanishes (the same "non-left-turn pop" in dual space).

**Expected output.** Correct minima for a hand-built set of lines.

**Evaluation.** Matches a brute-force `min over all lines` on random queries.

---

### Task 12 — Minkowski sum of two convex polygons

**Statement.** Given two convex polygons in CCW order, compute their Minkowski sum (also convex) in `O(h1 + h2)` by merging edge vectors in angular order.

**Constraints.** Linear in total vertices.

**Hints.**
- Start both polygons at their lowest point.
- Repeatedly take the edge with the smaller polar angle; the sum's vertices accumulate edge vectors.

**Expected output.** For two unit squares → a `2×2` square (with possibly more listed vertices).

**Evaluation.** Result is convex and equals the brute-force sum of all vertex pairs' hull.

---

### Task 13 — Chan's algorithm (output-sensitive `O(n log h)`)

**Statement.** Implement Chan's algorithm: partition into groups, build mini-hulls, then gift-wrap using binary-search tangents, with the doubling-and-restart guess for `h`.

**Constraints.** `O(n log h)` expected; verify against monotone chain.

**Hints.**
- Group size `m = 2^(2^t)`, restart on failure.
- Tangent from a point to a convex polygon via binary search in `O(log m)`.
- Cap wrapping steps at `m`; if exceeded, increase `t`.

**Expected output.** Same hull as monotone chain; fewer operations when `h` is small.

**Evaluation.** Correctness vs monotone chain; demonstrate `O(n log h)` advantage on small-`h` inputs.

---

### Task 14 — Sharded hull (filter-and-refine)

**Statement.** Simulate an out-of-core hull: split points into `k` spatial tiles, compute each tile's local hull (dropping interior points), then merge all local hull vertices with a final monotone chain. Verify the result equals the single-pass hull.

**Constraints.** Correct global hull; report the data reduction (`Σ local-hull sizes` vs `n`).

**Hints.** Interior points of a tile can never be on the global hull, so discard them before merging.

**Expected output.** Global hull matches the direct computation; large reduction reported.

**Evaluation.** Correctness plus a meaningful reduction ratio.

---

### Task 15 — Robust hull with epsilon / snapping for float input

**Statement.** Given floating-point points, build a robust hull. Implement two strategies: (a) snap to an integer grid (multiply by a scale, round) then use exact integer monotone chain; (b) an epsilon-tolerant `orient`. Compare their outputs on near-collinear inputs.

**Constraints.** Output must be a valid simple convex polygon for all inputs.

**Hints.**
- Snapping: `p_int = (round(p.x * S), round(p.y * S))`.
- Epsilon: treat `|cross| < eps` as collinear; document how fragile `eps` is.
- Validate the output (signed area `> 0`, all turns consistent).

**Expected output.** Both produce valid hulls; discuss where epsilon misbehaves and snapping wins.

**Evaluation.** Validity on adversarial near-collinear inputs; a clear robustness discussion.

---

## Benchmark Task

> Compare convex hull performance across all 3 languages and across algorithms (monotone chain vs gift wrapping) as `n` and `h` vary. Use two input families: a random "blob" (small `h`) and points on a circle (`h = n`).

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"
)

type Point struct{ X, Y int64 }

func cross(a, b, c Point) int64 {
	return (b.X-a.X)*(c.Y-a.Y) - (b.Y-a.Y)*(c.X-a.X)
}

func monotone(pts []Point) []Point {
	sort.Slice(pts, func(i, j int) bool {
		if pts[i].X != pts[j].X {
			return pts[i].X < pts[j].X
		}
		return pts[i].Y < pts[j].Y
	})
	n := len(pts)
	if n < 3 {
		return pts
	}
	h := make([]Point, 0, 2*n)
	for _, p := range pts {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	lo := len(h) + 1
	for i := n - 2; i >= 0; i-- {
		p := pts[i]
		for len(h) >= lo && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	return h[:len(h)-1]
}

func circle(n int) []Point {
	pts := make([]Point, n)
	for i := 0; i < n; i++ {
		a := 2 * math.Pi * float64(i) / float64(n)
		pts[i] = Point{int64(1e6 * math.Cos(a)), int64(1e6 * math.Sin(a))}
	}
	return pts
}

func blob(n int) []Point {
	pts := make([]Point, n)
	for i := range pts {
		pts[i] = Point{int64(rand.Intn(1000)), int64(rand.Intn(1000))}
	}
	return pts
}

func main() {
	for _, n := range []int{1000, 10000, 100000} {
		for name, gen := range map[string]func(int) []Point{"blob": blob, "circle": circle} {
			data := gen(n)
			start := time.Now()
			for i := 0; i < 10; i++ {
				cp := append([]Point(nil), data...)
				monotone(cp)
			}
			el := time.Since(start)
			fmt.Printf("%-7s n=%7d: %.3f ms\n", name, n, float64(el.Milliseconds())/10.0)
		}
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    record Point(long x, long y) {}

    static long cross(Point a, Point b, Point c) {
        return (b.x() - a.x()) * (c.y() - a.y()) - (b.y() - a.y()) * (c.x() - a.x());
    }

    static List<Point> monotone(List<Point> in) {
        List<Point> pts = new ArrayList<>(in);
        pts.sort((p, q) -> p.x() != q.x()
                ? Long.compare(p.x(), q.x()) : Long.compare(p.y(), q.y()));
        int n = pts.size();
        if (n < 3) return pts;
        List<Point> h = new ArrayList<>();
        for (Point p : pts) {
            while (h.size() >= 2 && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        int lo = h.size() + 1;
        for (int i = n - 2; i >= 0; i--) {
            Point p = pts.get(i);
            while (h.size() >= lo && cross(h.get(h.size()-2), h.get(h.size()-1), p) <= 0)
                h.remove(h.size() - 1);
            h.add(p);
        }
        h.remove(h.size() - 1);
        return h;
    }

    static List<Point> circle(int n) {
        List<Point> p = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            double a = 2 * Math.PI * i / n;
            p.add(new Point((long)(1e6 * Math.cos(a)), (long)(1e6 * Math.sin(a))));
        }
        return p;
    }

    static List<Point> blob(int n) {
        Random r = new Random(1);
        List<Point> p = new ArrayList<>();
        for (int i = 0; i < n; i++) p.add(new Point(r.nextInt(1000), r.nextInt(1000)));
        return p;
    }

    public static void main(String[] args) {
        for (int n : new int[]{1000, 10000, 100000}) {
            for (String name : new String[]{"blob", "circle"}) {
                List<Point> data = name.equals("blob") ? blob(n) : circle(n);
                long start = System.nanoTime();
                for (int i = 0; i < 10; i++) monotone(data);
                long el = System.nanoTime() - start;
                System.out.printf("%-7s n=%7d: %.3f ms%n", name, n, el / 10.0 / 1_000_000);
            }
        }
    }
}
```

#### Python

```python
import math
import random
import timeit


def cross(a, b, c):
    return (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])


def monotone(points):
    pts = sorted(points)
    n = len(pts)
    if n < 3:
        return pts
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def circle(n):
    return [(round(1e6 * math.cos(2*math.pi*i/n)),
             round(1e6 * math.sin(2*math.pi*i/n))) for i in range(n)]


def blob(n):
    return [(random.randint(0, 999), random.randint(0, 999)) for _ in range(n)]


if __name__ == "__main__":
    for n in (1000, 10000, 100000):
        for name, gen in (("blob", blob), ("circle", circle)):
            data = gen(n)
            t = timeit.timeit(lambda: monotone(list(data)), number=10)
            print(f"{name:<7} n={n:>7}: {t/10*1000:.3f} ms")
```

> **What to observe.** Monotone chain stays `O(n log n)` for both blob and circle. On the circle (`h = n`) a gift-wrapping implementation would blow up to `O(n²)`; on the blob (`h` tiny) gift wrapping becomes competitive. This is the practical face of output sensitivity.
