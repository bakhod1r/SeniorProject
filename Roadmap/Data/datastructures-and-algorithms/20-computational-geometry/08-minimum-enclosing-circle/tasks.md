# Minimum Enclosing Circle — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from the rest of this topic: the **inside test** (`dist(c,p) ≤ r + eps`), the **two primitives** (`from2` diameter circle, `from3` circumcircle), the **2-or-3-points** fact, **move-to-front Welzl** (expected `O(n)`), and the `O(n³)` **brute force** as your correctness oracle.
> Hard rules throughout: always **shuffle** before Welzl, always **compare with a tolerance** (never raw float `==`), and always **guard the collinear case** in `from3`.

---

## Beginner Tasks (5)

### Task 1 — Inside test

**Statement.** Implement `inside(center, r, p)` returning whether point `p` lies inside or on the circle. Use a tolerance `eps = 1e-9`. Provide a squared-distance variant `inside_sq` that avoids `sqrt`.

**Constraints.** O(1). Boundary points (distance exactly `r`) must count as inside.

**Hints.** Compare `dx² + dy²` against `r² + eps` for the squared version.

#### Go
```go
package main

func insideSq(cx, cy, r, px, py float64) bool {
	// implement: (px-cx)^2 + (py-cy)^2 <= r^2 + eps
	return false
}

func main() {}
```

#### Java
```java
public class Task1 {
    static boolean insideSq(double cx, double cy, double r, double px, double py) {
        // implement
        return false;
    }
    public static void main(String[] args) {}
}
```

#### Python
```python
EPS = 1e-9

def inside_sq(cx, cy, r, px, py):
    # implement
    return False

if __name__ == "__main__":
    print(inside_sq(0, 0, 2, 1, 1))  # True
```

- **Expected Output:** `inside_sq(0,0,2,1,1) -> True`; `inside_sq(0,0,2,2,0) -> True` (on boundary); `inside_sq(0,0,2,3,0) -> False`.
- **Evaluation:** correctness, boundary handling, no `sqrt` in the squared variant.

---

### Task 2 — Diameter circle (`from2`)

**Statement.** Given two points, return the smallest circle with both on its boundary: center = midpoint, radius = half the distance.

**Constraints.** O(1). Works for coincident points (radius 0).

**Hints.** `center = ((ax+bx)/2,(ay+by)/2)`, `r = dist(a,b)/2`.

#### Go
```go
func from2(ax, ay, bx, by float64) (cx, cy, r float64) {
	// implement
	return
}
```

#### Java
```java
static double[] from2(double ax, double ay, double bx, double by) {
    // return {cx, cy, r}
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def from2(a, b):
    # return (center, radius)
    pass
```

- **Expected Output:** `from2((0,0),(4,0)) -> center (2,0), r 2`.
- **Evaluation:** correct midpoint and radius; coincident-point case gives r=0.

---

### Task 3 — Circumcircle (`from3`) with collinear guard

**Statement.** Given three points, return the unique circumcircle, or `None`/`null`/`ok=false` if they are collinear (`|d| < eps`).

**Constraints.** O(1). Must not divide by zero.

**Hints.** `d = 2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))`; if `|d|<eps` they're collinear.

#### Go
```go
func from3(ax, ay, bx, by, cx, cy float64) (ox, oy, r float64, ok bool) {
	// implement; ok=false if collinear
	return
}
```

#### Java
```java
static double[] from3(double ax, double ay, double bx, double by, double cx, double cy) {
    // return null if collinear, else {ox, oy, r}
    return null;
}
```

#### Python
```python
def from3(a, b, c):
    # return (center, radius) or None if collinear
    pass
```

- **Expected Output:** `from3((0,0),(4,0),(0,3)) -> center (2,1.5), r 2.5`; `from3((0,0),(1,1),(2,2)) -> None` (collinear).
- **Evaluation:** correct circumcenter; collinear case returns the "no circle" signal, never crashes.

---

### Task 4 — Brute-force MEC (`O(n³)`)

**Statement.** Implement the brute-force MEC: try every pair-circle and triple-circle, keep the smallest one that covers all points. This is your correctness oracle.

**Constraints.** `n ≤ 200`. `O(n³)`. Handle `n = 0` (r=0) and `n = 1`.

**Hints.** A circle covers `P` iff every point passes the inside test with tolerance.

#### Go
```go
func bruteMEC(pts [][2]float64) (cx, cy, r float64) {
	// try all pairs (from2) and triples (from3); keep smallest covering circle
	return
}
```

#### Java
```java
static double[] bruteMEC(double[][] pts) {
    // return {cx, cy, r}
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def brute_mec(pts):
    # return (center, radius)
    pass
```

- **Expected Output:** `brute_mec([(0,0),(4,0),(2,3),(2,1)]) -> center ~(2,0.833), r ~2.166`.
- **Evaluation:** tests both pairs and triples; uses `≤ r + eps` in the coverage check.

---

### Task 5 — MEC of two and three points

**Statement.** Write a `trivial(points)` helper that returns the MEC of 0, 1, 2, or 3 points directly (the base case of Welzl). For 3 points, fall back to the widest pair if they're collinear.

**Constraints.** O(1). Inputs of size 0–3 only.

**Hints.** Dispatch on `len(points)`: empty → r=0; 1 → r=0; 2 → `from2`; 3 → `from3` (or widest pair if collinear).

#### Go
```go
func trivial(pts [][2]float64) (cx, cy, r float64) {
	// dispatch on len(pts)
	return
}
```

#### Java
```java
static double[] trivial(double[][] pts) {
    // dispatch on pts.length
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def trivial(pts):
    # dispatch on len(pts)
    pass
```

- **Expected Output:** `trivial([]) -> r 0`; `trivial([(1,1)]) -> center (1,1), r 0`; `trivial([(0,0),(4,0)]) -> center (2,0), r 2`.
- **Evaluation:** all four cases handled; collinear triple handled gracefully.

---

## Intermediate Tasks (5)

### Task 6 — Recursive Welzl

**Statement.** Implement the recursive `welzl(P, R)` and a top-level `mec(points)` that shuffles then calls `welzl(points, [])`. Validate against `brute_mec` on 1000 random sets.

**Constraints.** Expected `O(n)`. Match brute force within `1e-6`.

**Hints.** Base case: `P` empty or `|R| = 3` → `trivial(R)`. Otherwise pop a point, recurse, and if it's outside, recurse again forcing it onto the boundary.

#### Go
```go
func welzl(P, R [][2]float64) (cx, cy, r float64) {
	// implement recursive Welzl
	return
}
```

#### Java
```java
static double[] welzl(List<double[]> P, List<double[]> R) {
    // implement
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def welzl(P, R):
    # implement recursive Welzl
    pass
```

- **Expected Output:** matches `brute_mec` on all random tests.
- **Evaluation:** correct recursion structure; agreement with the oracle.

---

### Task 7 — Move-to-front iterative Welzl

**Statement.** Implement the stack-safe, three-nested-pass move-to-front Welzl. Confirm it handles `n = 1_000_000` without stack overflow.

**Constraints.** Expected `O(n)`. No recursion.

**Hints.** Outer loop adds each point; on violation, restart an inner pass that grows the boundary set from 1 to 2 to 3.

#### Go
```go
func mecMTF(pts [][2]float64) (cx, cy, r float64) {
	// three nested passes
	return
}
```

#### Java
```java
static double[] mecMTF(double[][] pts) {
    // three nested passes
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def mec_mtf(pts):
    # three nested passes
    pass
```

- **Expected Output:** identical radius to `welzl` within `1e-6`; runs on 1M points.
- **Evaluation:** no recursion; correct, linear-time behavior.

---

### Task 8 — Degenerate inputs

**Statement.** Make your MEC robust to: all points identical, all collinear, exactly 2 points, points on a perfect circle, and duplicates. Return the correct MEC for each.

**Constraints.** Must not crash, divide by zero, or return `NaN`.

**Hints.** Collinear → diameter of the two extreme points. Identical points → r=0. Use a relative `eps` if coordinates are large.

#### Go
```go
func robustMEC(pts [][2]float64) (cx, cy, r float64) {
	// handle degeneracies
	return
}
```

#### Java
```java
static double[] robustMEC(double[][] pts) {
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def robust_mec(pts):
    pass
```

- **Expected Output:** collinear `[(0,0),(2,0),(4,0)]` → center `(2,0)`, r `2`; identical `[(1,1),(1,1)]` → r `0`.
- **Evaluation:** every degenerate case returns a sensible, finite circle.

---

### Task 9 — 1-center facility location

**Statement.** Given customer coordinates, return the location (MEC center) that minimizes the maximum distance to any customer, and report that maximum distance (the radius).

**Constraints.** `O(n)`. Report both the site and the worst-case distance.

**Hints.** This is exactly the MEC center and radius — no new algorithm needed.

#### Go
```go
func bestFacility(customers [][2]float64) (siteX, siteY, worstDist float64) {
	// MEC center + radius
	return
}
```

#### Java
```java
static double[] bestFacility(double[][] customers) {
    // {siteX, siteY, worstDist}
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def best_facility(customers):
    # return (site, worst_distance)
    pass
```

- **Expected Output:** for a square's 4 corners, the site is the center and `worstDist` is the half-diagonal.
- **Evaluation:** correctly equates 1-center with MEC; reports worst-case distance.

---

### Task 10 — Property test harness

**Statement.** Write a test that, for thousands of random point sets, asserts: (a) every input point is inside the returned MEC, and (b) the radius matches `brute_mec` within `1e-6`. Also assert there's no strictly smaller covering circle by checking ≥ 2 points sit on the boundary.

**Constraints.** Use a fixed RNG seed for reproducibility.

**Hints.** "On the boundary" means `|dist(c,p) - r| < 1e-6`.

#### Go
```go
func propertyTest(trials int) bool {
	// returns true if all invariants hold
	return false
}
```

#### Java
```java
static boolean propertyTest(int trials) {
    return false;
}
```

#### Python
```python
def property_test(trials=5000):
    # assert containment, oracle agreement, >=2 boundary points
    return False
```

- **Expected Output:** `property_test() -> True`.
- **Evaluation:** all three invariants checked; catches off-by-eps and missing-triple bugs.

---

## Advanced Tasks (5)

### Task 11 — 3-D minimum enclosing ball (exact Welzl)

**Statement.** Generalize Welzl to 3-D: the support set has up to **4** points, and the base case solves a sphere through 4 points (or falls back to fewer). Validate on random 3-D clouds against a brute `O(n⁴)` checker for small `n`.

**Constraints.** Expected `O(n)` for fixed dimension 3.

**Hints.** Sphere through 4 points = solve a 3×3 linear system from the pairwise equidistance equations; guard the coplanar/degenerate case.

#### Go
```go
func meb3D(pts [][3]float64) (cx, cy, cz, r float64) {
	// Welzl with up to 4 boundary points
	return
}
```

#### Java
```java
static double[] meb3D(double[][] pts) {
    // {cx, cy, cz, r}
    return new double[]{0, 0, 0, 0};
}
```

#### Python
```python
def meb_3d(pts):
    # return (center3, radius)
    pass
```

- **Expected Output:** for the 8 corners of a unit cube, center `(0.5,0.5,0.5)`, r `≈ 0.866`.
- **Evaluation:** correct 4-point sphere solve; degenerate handling; oracle agreement.

---

### Task 12 — Bădoiu–Clarkson `(1+ε)`-approximation

**Statement.** Implement the frank-wolfe MEB approximation in any dimension: repeatedly move the center a `1/(i+1)` step toward the current farthest point, for `O(1/ε²)` iterations. Compare the radius to exact MEC in 2-D.

**Constraints.** `O(n d / ε²)`. Radius within factor `(1+ε)`.

**Hints.** After the loop, set `r = max distance from center to any point`.

#### Go
```go
func approxMEB(pts [][]float64, iters int) (center []float64, r float64) {
	// frank-wolfe iteration
	return
}
```

#### Java
```java
static Object[] approxMEB(double[][] pts, int iters) {
    // {center[], radius}
    return new Object[]{new double[0], 0.0};
}
```

#### Python
```python
def approx_meb(pts, iters=200):
    # return (center, radius)
    pass
```

- **Expected Output:** in 2-D, radius within ~1% of exact MEC after enough iterations.
- **Evaluation:** converges; works in arbitrary dimension; correct final radius.

---

### Task 13 — Streaming enclosing circle (online over-estimate)

**Statement.** Implement an online algorithm that consumes points one at a time and maintains a *guaranteed* enclosing circle in `O(1)` per point by expanding minimally toward any arriving outside point (Ritter-style). Compare its final radius to exact MEC.

**Constraints.** `O(1)` per point, `O(1)` memory. Result is an over-estimate.

**Hints.** On an outside point `p` at distance `d > r`: new radius `(r+d)/2`, move center toward `p` by `(d-r)/2`.

#### Go
```go
type Stream struct{ cx, cy, r float64; init bool }
func (s *Stream) Add(px, py float64) {
	// expand toward p if outside
}
```

#### Java
```java
static class Stream {
    double cx, cy, r; boolean init;
    void add(double px, double py) {
        // expand if outside
    }
}
```

#### Python
```python
class Stream:
    def __init__(self):
        self.c, self.r, self.init = None, 0.0, False
    def add(self, p):
        # expand toward p if outside
        pass
```

- **Expected Output:** final radius ≥ exact MEC radius, typically within ~10–20%.
- **Evaluation:** truly online, bounded memory, always encloses all seen points.

---

### Task 14 — Smallest enclosing circle of circles (ball-of-balls)

**Statement.** Given `n` disks `(c_i, r_i)`, find the smallest disk enclosing all of them. A point `x` is enclosed by the result iff every disk fits: `dist(result.c, c_i) + r_i ≤ result.r`. Adapt Welzl with the "distance + radius" constraint.

**Constraints.** Expected `O(n)`. Used for bounding-volume-hierarchy merges.

**Hints.** Replace the point inside-test with the disk-inside-test; the boundary primitives now solve "two/three disks tangent internally."

#### Go
```go
type Disk struct{ X, Y, R float64 }
func mecOfDisks(disks []Disk) (cx, cy, r float64) {
	// Welzl adapted to disks
	return
}
```

#### Java
```java
record Disk(double x, double y, double r) {}
static double[] mecOfDisks(Disk[] disks) {
    return new double[]{0, 0, 0};
}
```

#### Python
```python
def mec_of_disks(disks):
    # disks: list of (x, y, r); return (center, radius)
    pass
```

- **Expected Output:** for two disks, the result spans from the far edge of one to the far edge of the other along their center line.
- **Evaluation:** disk inside-test correct; reduces to point-MEC when all `r_i = 0`.

---

### Task 15 — Benchmark Welzl vs brute force

**Statement.** Benchmark move-to-front Welzl against the `O(n³)` brute force across input sizes; show Welzl scales linearly while brute force explodes. (Cap brute force at `n ≤ 300`.)

**Constraints.** Report wall-clock per size for both.

**Hints.** Use random points in a `1000×1000` box; warm up before timing.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{100, 300, 1000, 10000, 100000} {
		pts := make([][2]float64, n)
		for i := range pts {
			pts[i] = [2]float64{rand.Float64() * 1000, rand.Float64() * 1000}
		}
		start := time.Now()
		mecMTF(pts) // Welzl
		fmt.Printf("welzl n=%6d: %v\n", n, time.Since(start))
	}
}
```

#### Java
```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        Random rng = new Random();
        for (int n : new int[]{100, 300, 1000, 10000, 100000}) {
            double[][] pts = new double[n][2];
            for (int i = 0; i < n; i++) { pts[i][0] = rng.nextDouble()*1000; pts[i][1] = rng.nextDouble()*1000; }
            long t0 = System.nanoTime();
            mecMTF(pts);
            System.out.printf("welzl n=%6d: %.2f ms%n", n, (System.nanoTime()-t0)/1e6);
        }
    }
}
```

#### Python
```python
import random, time

for n in (100, 300, 1000, 10000, 100000):
    pts = [(random.random()*1000, random.random()*1000) for _ in range(n)]
    t0 = time.perf_counter()
    mec_mtf(pts)  # Welzl
    print(f"welzl n={n:>6}: {(time.perf_counter()-t0)*1000:.2f} ms")
```

- **Expected Output:** Welzl roughly 10× slower per 10× points (linear); brute force ~1000× slower per 10× points (cubic).
- **Evaluation:** demonstrates the linear vs cubic gap empirically.

---

## Benchmark Task

> Compare performance across all 3 languages on the same large random input.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{10000, 100000, 1000000} {
		pts := make([][2]float64, n)
		for i := range pts {
			pts[i] = [2]float64{rand.Float64() * 1000, rand.Float64() * 1000}
		}
		start := time.Now()
		mecMTF(pts)
		fmt.Printf("n=%7d: %.3f ms\n", n, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java
```java
import java.util.*;

public class BenchAll {
    public static void main(String[] args) {
        Random rng = new Random();
        for (int n : new int[]{10000, 100000, 1000000}) {
            double[][] pts = new double[n][2];
            for (int i = 0; i < n; i++) { pts[i][0] = rng.nextDouble()*1000; pts[i][1] = rng.nextDouble()*1000; }
            long t0 = System.nanoTime();
            mecMTF(pts);
            System.out.printf("n=%7d: %.3f ms%n", n, (System.nanoTime()-t0)/1e6);
        }
    }
}
```

#### Python
```python
import random, time

for n in (10_000, 100_000, 1_000_000):
    pts = [(random.random()*1000, random.random()*1000) for _ in range(n)]
    t0 = time.perf_counter()
    mec_mtf(pts)
    print(f"n={n:>7}: {(time.perf_counter()-t0)*1000:.3f} ms")
```

Expect linear scaling in all three. Go and Java will be fastest; Python slower by a constant factor but still linear. If any shows super-linear growth, you forgot to shuffle or are re-scanning all points each step.
