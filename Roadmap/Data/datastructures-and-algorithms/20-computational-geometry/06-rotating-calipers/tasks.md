# Rotating Calipers — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Every task assumes the canonical pipeline: **build the convex hull first (`O(n log n)`), then run a rotating-calipers sweep (`O(n)`)**. Reuse the core primitives from the rest of this topic: the **cross product** (orientation / triangle area), **squared distance** (avoid `sqrt`), the **monotone antipodal pointer**, and the **CCW convention**.
> Hard rule throughout: calipers requires a **convex** polygon. If a task gives you raw points, hull them first.

---

## Beginner Tasks (5)

### Task 1 — Squared diameter of a convex polygon

**Statement.** Given a convex polygon in CCW order, return the **squared** diameter (max squared distance between any two vertices) using the rotating-calipers sweep. Do not build a hull — assume the input is already convex.

**Constraints.** `2 ≤ n ≤ 10^5`, integer coordinates, `|x|,|y| ≤ 10^9`. Use 64-bit integers; the sweep must be `O(n)`.

**Hints.** Initialize `j = 1`; advance `j` while `cross(p[i],p[i+1],p[j+1]) > cross(p[i],p[i+1],p[j])`. Check both `(p[i],p[j])` and `(p[i+1],p[j])`.

#### Go
```go
package main

func diameter2(p []struct{ X, Y int64 }) int64 {
	// implement the O(n) antipodal sweep here
	return 0
}

func main() {
	// test with (0,0),(4,0),(5,3),(1,4) -> expect 34
}
```

#### Java
```java
public class Task1 {
    record P(long x, long y) {}
    static long diameter2(P[] poly) {
        // implement the O(n) antipodal sweep here
        return 0;
    }
    public static void main(String[] args) {
        // test with (0,0),(4,0),(5,3),(1,4) -> expect 34
    }
}
```

#### Python
```python
def diameter2(poly):
    # implement the O(n) antipodal sweep here
    return 0

if __name__ == "__main__":
    # test with (0,0),(4,0),(5,3),(1,4) -> expect 34
    pass
```

- **Expected Output:** `34` for the sample.
- **Evaluation:** correctness vs an `O(n²)` brute force, linear complexity, integer-exactness.

---

### Task 2 — Brute-force diameter oracle

**Statement.** Implement an `O(n²)` diameter (max over all pairs) to serve as a **test oracle**. You will fuzz the `O(n)` calipers version against it.

**Constraints.** `n ≤ 2000` (oracle only). Return squared distance.

**Hints.** Two nested loops; track the max `dist2`. Keep it dead-simple and obviously correct.

#### Go
```go
func diameter2Brute(p []struct{ X, Y int64 }) int64 {
	// nested loops over all pairs
	return 0
}
```

#### Java
```java
static long diameter2Brute(P[] p) {
    // nested loops over all pairs
    return 0;
}
```

#### Python
```python
def diameter2_brute(p):
    # nested loops over all pairs
    return 0
```

- **Expected Output:** identical to Task 1 on convex inputs.
- **Evaluation:** correctness; used to validate later tasks.

---

### Task 3 — Width of a convex polygon

**Statement.** Given a convex polygon in CCW order, return its **width** (minimum distance between two parallel supporting lines) as a floating-point number.

**Constraints.** `3 ≤ n ≤ 10^5`. For each edge, find the antipodal vertex maximizing `|cross|`, then `width_i = |cross| / edgeLength`. Return the minimum.

**Hints.** Use the same monotone pointer as the diameter, but maximize `|cross(p[i],p[i+1],p[j])|`. Only divide by edge length at the end.

#### Go
```go
func width(p []struct{ X, Y float64 }) float64 {
	// edge-flush minimum; O(n)
	return 0
}
```

#### Java
```java
static double width(P[] p) {
    // edge-flush minimum; O(n)
    return 0;
}
```

#### Python
```python
def width(p):
    # edge-flush minimum; O(n)
    return 0.0
```

- **Expected Output:** for a `4×2` rectangle, `2.0`.
- **Evaluation:** correct edge-vertex distance; `O(n)`.

---

### Task 4 — Hull-then-diameter wrapper

**Statement.** Given **raw points** (possibly non-convex, with interior and duplicate points), compute the squared diameter. Build the convex hull, then call your Task 1 routine.

**Constraints.** `1 ≤ n ≤ 10^5`. Dedupe points. Handle `n = 1` (return 0) and `n = 2`.

**Hints.** Use monotone-chain hull (see *01-convex-hull*). Drop collinear points so the calipers loop is clean.

#### Go
```go
func diameter2Raw(pts []struct{ X, Y int64 }) int64 {
	// hull, then diameter2
	return 0
}
```

#### Java
```java
static long diameter2Raw(List<P> pts) {
    // hull, then diameter2
    return 0;
}
```

#### Python
```python
def diameter2_raw(pts):
    # hull, then diameter2
    return 0
```

- **Expected Output:** interior point `(2,2)` in `(0,0),(4,0),(5,3),(1,4),(2,2)` must not change the answer (`34`).
- **Evaluation:** hull correctness + diameter correctness.

---

### Task 5 — Farthest pair indices

**Statement.** Extend Task 1 to return the **pair of points** (their coordinates) achieving the diameter, not just the distance.

**Constraints.** Same as Task 1. If multiple pairs tie, returning any one is acceptable.

**Hints.** Track `(bestA, bestB)` alongside `best`. Update them whenever you update the maximum.

#### Go
```go
func farthestPair(p []struct{ X, Y int64 }) (a, b struct{ X, Y int64 }) {
	return
}
```

#### Java
```java
static P[] farthestPair(P[] p) {
    return new P[]{ null, null };
}
```

#### Python
```python
def farthest_pair(p):
    return None, None
```

- **Expected Output:** for the sample, the pair `(0,0)` and `(5,3)`.
- **Evaluation:** correct pair; ties handled gracefully.

---

## Intermediate Tasks (5)

### Task 6 — Minimum-area enclosing rectangle (area only)

**Statement.** Given a convex polygon, return the **area** of the minimum-area enclosing rectangle. Use the flush-edge theorem: try each edge as the base orientation.

**Constraints.** `3 ≤ n ≤ 10^4` (an `O(n²)` projection version is acceptable here; `O(n)` four-caliper version earns full marks).

**Hints.** For each edge, project all vertices onto the edge direction and its normal; the area is the product of the two spans. Take the minimum.

#### Go
```go
func minAreaRect(poly []struct{ X, Y float64 }) float64 {
	return 0
}
```

#### Java
```java
static double minAreaRect(P[] poly) {
    return 0;
}
```

#### Python
```python
def min_area_rect(poly):
    return 0.0
```

- **Expected Output:** for an axis-aligned `4×2` rectangle, `8.0`.
- **Evaluation:** correct theorem application; bonus for `O(n)`.

---

### Task 7 — Minimum-perimeter enclosing rectangle

**Statement.** Same setup as Task 6, but minimize **perimeter** `2(w + h)` instead of area. Note: the optimal orientation may differ from the min-area one.

**Constraints.** `3 ≤ n ≤ 10^4`.

**Hints.** Reuse the per-edge projection; change the objective to `2*(spanU + spanN)`.

#### Go
```go
func minPerimeterRect(poly []struct{ X, Y float64 }) float64 {
	return 0
}
```

#### Java
```java
static double minPerimeterRect(P[] poly) {
    return 0;
}
```

#### Python
```python
def min_perimeter_rect(poly):
    return 0.0
```

- **Expected Output:** for the `4×2` rectangle, `12.0`.
- **Evaluation:** correct objective; compare orientation with Task 6.

---

### Task 8 — Return the OBB (oriented bounding box)

**Statement.** Extend Task 6 to return the full **oriented bounding box**: center, the unit axis direction (the winning edge direction), and the two half-extents. This is the OBB used in collision systems.

**Constraints.** `3 ≤ n ≤ 10^4`.

**Hints.** When you find the minimum-area edge, record `minU,maxU,minN,maxN` and the edge unit direction; reconstruct center and corners from them.

#### Go
```go
type OBB struct {
	CX, CY     float64
	AX, AY     float64 // unit axis
	HalfU, HalfN float64
}
func minAreaOBB(poly []struct{ X, Y float64 }) OBB { return OBB{} }
```

#### Java
```java
record OBB(double cx, double cy, double ax, double ay, double halfU, double halfN) {}
static OBB minAreaOBB(P[] poly) { return null; }
```

#### Python
```python
def min_area_obb(poly):
    # return dict with center, axis, half_extents
    return {}
```

- **Expected Output:** an OBB whose 4 corners contain all polygon vertices and whose area equals Task 6's answer.
- **Evaluation:** geometric correctness of the reconstructed box.

---

### Task 9 — Maximum distance between two convex polygons

**Statement.** Given two convex polygons `P` and `Q`, return the **maximum** squared distance between a vertex of `P` and a vertex of `Q`.

**Constraints.** `n, m ≤ 10^5`. Aim for `O(n + m)` with anti-parallel calipers; an `O(n·m)` version is accepted for partial credit.

**Hints.** The max distance is between two vertices that are extreme in opposite directions. Sweep a caliper on `P` and an anti-parallel one on `Q` together.

#### Go
```go
func maxDist2(P, Q [][2]int64) int64 { return 0 }
```

#### Java
```java
static long maxDist2(long[][] P, long[][] Q) { return 0; }
```

#### Python
```python
def max_dist2(P, Q):
    return 0
```

- **Expected Output:** matches an `O(n·m)` brute force on random convex pairs.
- **Evaluation:** correctness; linear version earns full marks.

---

### Task 10 — Elongation metric

**Statement.** Compute the **elongation** of a convex polygon, defined as `diameter / width`. This single number distinguishes round shapes (≈1) from sliver shapes (large). Reuse Tasks 1 and 3.

**Constraints.** `3 ≤ n ≤ 10^5`. Take square roots only at the end.

**Hints.** `elongation = sqrt(diameter2) / width`. Guard `width > 0` (collinear input).

#### Go
```go
func elongation(poly []struct{ X, Y float64 }) float64 { return 0 }
```

#### Java
```java
static double elongation(P[] poly) { return 0; }
```

#### Python
```python
def elongation(poly):
    return 0.0
```

- **Expected Output:** for a square, `≈ √2 ≈ 1.414`; for a long thin rectangle, large.
- **Evaluation:** correct combination of diameter and width.

---

## Advanced Tasks (5)

### Task 11 — Robust calipers with degeneracy guard

**Statement.** Harden your diameter sweep: detect non-convex or degenerate input by counting pointer advances. If advances exceed `2n`, raise/return an error instead of looping forever.

**Constraints.** `2 ≤ n ≤ 10^5`. Must terminate on adversarial non-convex input.

**Hints.** Increment a counter on each `j` advance; check `> 2*n`. Also early-return for `n < 3` collinear hulls.

#### Go
```go
func diameter2Safe(p []struct{ X, Y int64 }) (int64, error) { return 0, nil }
```

#### Java
```java
static long diameter2Safe(P[] p) { /* throw on degeneracy */ return 0; }
```

#### Python
```python
def diameter2_safe(p):
    # raise ValueError on non-convex/degenerate input
    return 0
```

- **Expected Output:** correct value on convex input; error on a dart/arrowhead polygon.
- **Evaluation:** no infinite loops; loud failure on bad input.

---

### Task 12 — Closest distance between two convex polygons

**Statement.** Given two **disjoint** convex polygons, return the **minimum** distance between them (closest approach). Use rotating calipers to find the closest vertex–edge or edge–edge feature.

**Constraints.** `n, m ≤ 10^5`. Return the actual (float) distance. `O(n + m)` target.

**Hints.** Find the bottom vertex of `P` and top vertex of `Q`, then co-rotate anti-parallel calipers, evaluating point-to-segment distances at each step.

#### Go
```go
func minPolyDist(P, Q [][2]float64) float64 { return 0 }
```

#### Java
```java
static double minPolyDist(double[][] P, double[][] Q) { return 0; }
```

#### Python
```python
def min_poly_dist(P, Q):
    return 0.0
```

- **Expected Output:** matches an `O(n·m)` point/edge brute force.
- **Evaluation:** correct feature handling (vertex-vertex, vertex-edge, edge-edge).

---

### Task 13 — Batch shape metrics (parallel)

**Statement.** Given a list of raw point sets, compute `{diameter2, width, minRectArea}` for each, **in parallel**. Each shape is independent: hull + one sweep producing all metrics.

**Constraints.** Thousands of shapes, each up to `10^4` points. Use goroutines / parallel streams / a process pool.

**Hints.** Make `analyze(points)` a pure function. Fan out; no shared mutable state. The hull dominates cost.

#### Go
```go
func analyzeBatch(shapes [][]struct{ X, Y int64 }) []struct {
	D2 int64
	W, RectArea float64
} {
	return nil
}
```

#### Java
```java
record Metrics(long d2, double w, double rectArea) {}
static List<Metrics> analyzeBatch(List<List<P>> shapes) { return null; }
```

#### Python
```python
def analyze_batch(shapes):
    # ProcessPoolExecutor; return list of dicts
    return []
```

- **Expected Output:** per-shape metrics identical to sequential computation.
- **Evaluation:** correctness + genuine parallelism + no data races.

---

### Task 14 — Smallest enclosing rectangle of a point set

**Statement.** Given **raw points**, return the minimum-area enclosing rectangle's area and orientation. Build the hull, then run the min-rectangle sweep. This is the end-to-end OBB-fitting task.

**Constraints.** `1 ≤ n ≤ 10^5`. Handle collinear (area 0) and single-point (area 0) cases.

**Hints.** Hull → for each hull edge, build the axis-aligned box in the rotated frame → minimum area.

#### Go
```go
func smallestRect(pts []struct{ X, Y float64 }) (area, angle float64) { return }
```

#### Java
```java
static double[] smallestRect(List<P> pts) { return new double[]{0, 0}; }
```

#### Python
```python
def smallest_rect(pts):
    return 0.0, 0.0  # area, angle
```

- **Expected Output:** for points forming a tilted rectangle, area equals the true tilted area (much smaller than the AABB).
- **Evaluation:** correct hull + flush-edge theorem; degenerate handling.

---

### Task 15 — Fuzz harness: calipers vs brute force

**Statement.** Write a harness that generates **random convex polygons** (e.g. random points → hull), runs both the `O(n)` calipers diameter and the `O(n²)` brute oracle (Task 2), and asserts they match over thousands of trials. Report any mismatch with the failing polygon.

**Constraints.** ≥ 1000 trials, polygon sizes up to a few hundred. Include edge cases: squares, regular polygons (ties), collinear inputs.

**Hints.** Random-point hull guarantees convex CCW input. Seed the RNG for reproducibility. A single mismatch usually means a `>` vs `>=` bug.

#### Go
```go
func fuzz(trials int) error {
	// generate convex polys; compare diameter2 vs diameter2Brute
	return nil
}
```

#### Java
```java
static void fuzz(int trials) {
    // generate convex polys; assert diameter2 == diameter2Brute
}
```

#### Python
```python
def fuzz(trials=1000):
    # generate convex polys; assert diameter2 == diameter2_brute
    pass
```

- **Expected Output:** all trials pass; on injected bug, prints the failing polygon.
- **Evaluation:** robust generator, meaningful edge cases, clear failure reporting.

---

## Benchmark Task

> Compare performance across all 3 languages: `O(n)` calipers diameter vs `O(n²)` brute force, on a regular `n`-gon (already convex, so no hull needed).

#### Go

```go
package main

import (
	"fmt"
	"math"
	"time"
)

type P struct{ X, Y int64 }

func regular(n int) []P {
	p := make([]P, n)
	for i := 0; i < n; i++ {
		a := 2 * math.Pi * float64(i) / float64(n)
		p[i] = P{int64(1e6 * math.Cos(a)), int64(1e6 * math.Sin(a))}
	}
	return p
}

func main() {
	for _, n := range []int{100, 1000, 10000, 100000} {
		poly := regular(n)
		start := time.Now()
		for k := 0; k < 50; k++ {
			diameter2(poly) // your O(n) sweep
		}
		fmt.Printf("n=%7d: %.3f ms\n", n, float64(time.Since(start).Milliseconds())/50.0)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    record P(long x, long y) {}

    static P[] regular(int n) {
        P[] p = new P[n];
        for (int i = 0; i < n; i++) {
            double a = 2 * Math.PI * i / n;
            p[i] = new P((long)(1e6*Math.cos(a)), (long)(1e6*Math.sin(a)));
        }
        return p;
    }

    public static void main(String[] args) {
        for (int n : new int[]{100, 1000, 10000, 100000}) {
            P[] poly = regular(n);
            long start = System.nanoTime();
            for (int k = 0; k < 50; k++) diameter2(poly); // your O(n) sweep
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%7d: %.3f ms%n", n, elapsed / 50.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import math, timeit

def regular(n):
    return [(round(1e6*math.cos(2*math.pi*i/n)),
             round(1e6*math.sin(2*math.pi*i/n))) for i in range(n)]

for n in (100, 1_000, 10_000, 100_000):
    poly = regular(n)
    t = timeit.timeit(lambda: diameter2(poly), number=50)  # your O(n) sweep
    print(f"n={n:>7}: {t/50*1000:.3f} ms")
```

**What to observe:** the `O(n)` sweep scales linearly (doubling `n` doubles time), while a brute-force `O(n²)` version quadruples — at `n = 100000` brute force is impractical while calipers stays in milliseconds. Confirm both produce identical squared diameters before timing.
