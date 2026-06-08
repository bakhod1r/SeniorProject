# Circle–Line Intersection — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse one small vector toolkit (`sub`, `add`, `scale`, `dot`, `norm`) across tasks rather than reinventing it each time.

---

## Beginner Tasks

**Task 1: Count intersection points (no points, no sqrt).**
Write `count(cx, cy, r, ax, ay, bx, by)` that returns `0`, `1`, or `2` — the number of points where the **infinite line** through `A`, `B` meets the circle — **without** computing the points and **without** a square root in the count path. Compare `d²` with `r²`.

#### Go

```go
package main

func count(cx, cy, r, ax, ay, bx, by float64) int {
	// hint: cross = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax)
	//       d² = cross² / |AB|²  ; compare d² with r²
	return 0
}

func main() {
	// expect 2, 1, 0 for lines at y=3, y=5, y=7 vs circle (0,0,5)
}
```

#### Java

```java
public class Task1 {
    static int count(double cx, double cy, double r,
                     double ax, double ay, double bx, double by) {
        return 0; // implement: compare d² with r²
    }
    public static void main(String[] args) { }
}
```

#### Python

```python
def count(cx, cy, r, ax, ay, bx, by):
    # compare d² with r²; return 0, 1, or 2
    return 0


if __name__ == "__main__":
    pass
```

- **Constraints:** no `sqrt` in the count path; use an epsilon for the `d² == r²` (tangent) case.
- **Expected Output:** `2, 1, 0` for the three horizontal lines above.
- **Evaluation:** correctness, no sqrt, tangent handled.

---

**Task 2: Distance from the centre to the line.**
Write `distToLine(cx, cy, ax, ay, bx, by)` returning the perpendicular distance `d`. Reject a degenerate line (`A == B`) by returning a sentinel (e.g. `-1`).

- Provide starter code in all 3 languages.
- Constraints: use `|cross| / |AB|`; handle `|AB| == 0`.
- Test: centre `(0,0)`, line `y=3` → `d = 3`; line through centre → `d = 0`.

---

**Task 3: Foot of perpendicular.**
Write `foot(cx, cy, ax, ay, bx, by)` returning the point `F` on the line closest to the centre, via projection `t = ((C-A)·dir)/(dir·dir)`, `F = A + t·dir`.

- Constraints: handle `A == B`.
- Test: circle `(0,0)`, line `(-6,3)→(6,3)` → `F = (0,3)`. Verify `|C - F| == d` from Task 2.

---

**Task 4: Two points of a secant (geometric method).**
Write `secantPoints(cx, cy, r, ax, ay, bx, by)` that returns the two intersection points of the **infinite line** with the circle, assuming `d < r`. Use `F` (Task 3) and `h = sqrt(r² - d²)`: `P = F ± h·û`.

- Constraints: assume the caller guarantees a true secant; still guard the sqrt with `max(0, …)`.
- Test: circle `(0,0,5)`, line `y=3` → `(4,3)` and `(-4,3)`. Verify each lies on the circle.

---

**Task 5: Full classify-and-return.**
Combine Tasks 1–4 into `circleLine(cx, cy, r, ax, ay, bx, by)` that returns a list of 0, 1, or 2 points for the **infinite line**, collapsing the tangent case to one point.

- Constraints: one function, all three cases; tangent via `h < eps`.
- Test against all examples from `junior.md` (secant, tangent, miss, diameter through centre).

---

## Intermediate Tasks

**Task 6: Circle–segment (clamp to [0,1]).**
Write `circleSegment(...)` that returns only the intersection points whose parameter `t` lies in `[0, 1]`, sorted by `t`. Reuse the quadratic method.

- Provide starter code in all 3 languages.
- Test: segment `(0,0)→(3,0)` vs circle `(0,0,5)` → `0` points (ends inside); `(0,0)→(10,0)` → one point `(5,0)`.

---

**Task 7: Circle–ray, nearest hit.**
Write `rayHit(ox, oy, dx, dy, cx, cy, r)` returning the parameter `t >= 0` of the **first** point the ray meets, or `-1` for a miss. Handle the **origin-inside** case (return the exit root `t2`).

- Constraints: `t1 <= t2`; if `t2 < 0` miss; if `t1 >= 0` return `t1`; else return `t2`.
- Test: origin `(0,0)`, dir `(1,0)`, circle `(10,0,2)` → `t = 8`; circle `(0,0,5)` (origin at centre) → `t = 5`.

---

**Task 8: Quadratic method with the discriminant.**
Reimplement the secant/tangent/miss classification using `a, b, c, Δ` directly (not the geometric `d` test). Print `Δ` alongside the count so you can see the sign drive the result.

- Constraints: use the **halved-`b`** form `b' = f·D`, `Δ' = b'² - a·c`.
- Test: confirm `Δ' = 9216/4 = 2304` (or equivalent) for the `y=3` secant; `Δ' = 0` for the `y=5` tangent.

---

**Task 9: Chord length and the surface normals.**
For a secant, return the **chord length** (`2h`) and the two outward **unit normals** `(P - C)/r` at the intersection points. These are what a collision/refraction system consumes.

- Constraints: assume `d < r`; verify each normal has length `1`.
- Test: circle `(0,0,5)`, line `y=3` → chord length `8`; normals `(4/5, 3/5)` and `(-4/5, 3/5)`.

---

**Task 10: Exact integer count.**
For **integer** inputs `cx, cy, r, ax, ay, bx, by`, decide the count `0/1/2` with **no floating point** — compute `a = D·D`, `b' = f·D`, `c = f·f - r²`, `Δ' = b'² - a·c` in integers and return `sign(Δ')`.

- Constraints: use 64-bit (or wider) integers; Python's big ints are automatic. Watch overflow.
- Test: design integer secant / tangent / miss cases and verify the exact sign matches the float version.

---

## Advanced Tasks

**Task 11: Cancellation-free quadratic solver.**
Implement `stableRoots(a, bHalf, c)` returning the sorted `t` roots using `q = -(bHalf + sign(bHalf)·√Δ'); t1 = q/a; t2 = c/q`. Compare against the naive `(-b ± √Δ)/(2a)` on an input engineered to cause cancellation (large `b'`, tiny `Δ'`) and report the digits of difference.

- Provide starter code in all 3 languages.
- Constraints: handle `bHalf == 0` (degenerates to `±√(-c/a)`), tangent (`Δ' ≈ 0`), and miss.
- Test: construct `a, b', c` with `b' ≈ 1e8` and `Δ' ≈ 1e-3`; show the naive method loses precision on the smaller root.

---

**Task 12: Ray vs many circles with a broad-phase.**
Given `n` circles, intersect a ray against all of them and return the **nearest** hit, but first cull each circle with a **ray-vs-AABB** slab test (AABB = `[cx-r, cx+r] × [cy-r, cy+r]`). Count how many exact tests the broad-phase saved.

- Constraints: report `(t, circleIndex)` and the `cull_ratio = culled / n`.
- Test: 1000 circles, most off-axis; verify the cull ratio is high (> 0.9) and the nearest hit matches a brute-force pass.

---

**Task 13: Continuous collision — time of impact.**
A circular body of radius `rb` moves from `C0` to `C1` over a timestep. A static wall is the segment `W0`–`W1`. Find the earliest fraction `t ∈ [0,1]` at which the body touches the wall (inflate the wall by `rb` and intersect the centre's swept segment), or report no impact.

- Constraints: handle face hits and corner (endpoint) hits; return the contact normal too.
- Test: a body moving straight at a wall should report `t` < 1 and a normal opposing the motion; a glancing path should report no impact.

---

**Task 14: Robust tangency in a local frame.**
Write a classifier that (a) translates so the circle centre is at the origin, (b) normalises the direction (`a = 1`), and (c) decides `0/1/2` using a **relative** tolerance `|Δ| <= τ·(|b'|² + |a c|)`. Demonstrate it on a near-tangent input where a fixed absolute epsilon gives the wrong count.

- Constraints: compare the local-frame relative-tolerance classifier against a naive absolute-epsilon one.
- Test: pick `d` within `1e-7·r` of `r`; show the naive version flips the count under a coordinate shift while the robust one does not.

---

**Task 15: All intersections of a ray path through a circle field (CSG-style).**
Given a ray and `n` circles, return **all** entry/exit `t` values sorted, labelled enter/exit (using the sign of the dot of the direction with the surface normal). This is the basis of constructive-solid-geometry boolean operations on discs.

- Constraints: each circle contributes up to two `t` values with `t >= 0`; sort the merged list; tag enter vs exit.
- Test: a ray passing through 3 overlapping circles should produce an interleaved, sorted enter/exit sequence consistent with the geometry.

---

## Benchmark Task

> Compare performance across all 3 languages: how fast can each test a ray against `n` circles (no broad-phase, scalar narrow-phase only)? This isolates the cost of the core circle–line arithmetic.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"time"
)

func rayHit(ox, oy, dx, dy, cx, cy, r float64) bool {
	fx, fy := ox-cx, oy-cy
	a := dx*dx + dy*dy
	bh := fx*dx + fy*dy
	c := fx*fx + fy*fy - r*r
	disc := bh*bh - a*c
	if disc < 0 {
		return false
	}
	t := (-bh - math.Sqrt(disc)) / a
	return t >= 0
}

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		start := time.Now()
		hits := 0
		for i := 0; i < n; i++ {
			if rayHit(0, 0, 1, 0, float64(i%100), float64(i%50), 5) {
				hits++
			}
		}
		fmt.Printf("n=%8d: %.3f ms (hits=%d)\n", n,
			float64(time.Since(start).Microseconds())/1000.0, hits)
	}
}
```

#### Java

```java
public class Benchmark {
    static boolean rayHit(double ox, double oy, double dx, double dy,
                          double cx, double cy, double r) {
        double fx = ox - cx, fy = oy - cy;
        double a = dx * dx + dy * dy;
        double bh = fx * dx + fy * dy;
        double c = fx * fx + fy * fy - r * r;
        double disc = bh * bh - a * c;
        if (disc < 0) return false;
        double t = (-bh - Math.sqrt(disc)) / a;
        return t >= 0;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int n : sizes) {
            long start = System.nanoTime();
            int hits = 0;
            for (int i = 0; i < n; i++)
                if (rayHit(0, 0, 1, 0, i % 100, i % 50, 5)) hits++;
            System.out.printf("n=%8d: %.3f ms (hits=%d)%n",
                n, (System.nanoTime() - start) / 1e6, hits);
        }
    }
}
```

#### Python

```python
import math
import timeit


def ray_hit(ox, oy, dx, dy, cx, cy, r):
    fx, fy = ox - cx, oy - cy
    a = dx * dx + dy * dy
    bh = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = bh * bh - a * c
    if disc < 0:
        return False
    t = (-bh - math.sqrt(disc)) / a
    return t >= 0


def run(n):
    for i in range(n):
        ray_hit(0, 0, 1, 0, i % 100, i % 50, 5)


if __name__ == "__main__":
    for n in (1_000, 10_000, 100_000, 1_000_000):
        t = timeit.timeit(lambda: run(n), number=1)
        print(f"n={n:>8}: {t*1000:.3f} ms")
```

**What to observe:** roughly linear scaling in `n`; Go and Java run this arithmetic-heavy loop an order of magnitude faster than Python. Then add the broad-phase from Task 12 and re-measure — the cull ratio, not the per-test speed, is what unlocks large `n`.
