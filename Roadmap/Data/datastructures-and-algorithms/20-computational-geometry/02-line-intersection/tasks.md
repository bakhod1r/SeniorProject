# Line and Segment Intersection — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from the rest of this topic: the **cross-product orientation test**, the **straddle rule** (`o1≠o2 && o3≠o4`), the **on-segment** check for collinear cases, the **Cramer/determinant** point formula, and the discipline **decide in integers, locate in floats**.
> Hard rule throughout: do the *decision* with exact integer arithmetic where possible, and never divide before checking the determinant is nonzero.

---

## Beginner Tasks (5)

### Task 1 — Orientation primitive

**Statement.** Implement `orientation(a, b, c)` returning `+1` (CCW / left), `-1` (CW / right), or `0` (collinear), using only the cross product. Then print the orientation of three test triples.

**Constraints.** Integer coordinates up to `10^6`; use 64-bit accumulators. No division, no slopes.

**Hints.** `cross = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)`; return its sign.

#### Go
```go
package main

import "fmt"

func orientation(ax, ay, bx, by, cx, cy int64) int {
	// TODO: return sign of the cross product
	return 0
}

func main() {
	fmt.Println(orientation(0, 0, 4, 0, 2, 3))  // +1 (left)
	fmt.Println(orientation(0, 0, 4, 0, 2, -3)) // -1 (right)
	fmt.Println(orientation(0, 0, 4, 0, 2, 0))  //  0 (collinear)
}
```

#### Java
```java
public class Task1 {
    static int orientation(long ax, long ay, long bx, long by, long cx, long cy) {
        // TODO: return sign of the cross product
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(orientation(0,0,4,0,2,3));   // +1
        System.out.println(orientation(0,0,4,0,2,-3));  // -1
        System.out.println(orientation(0,0,4,0,2,0));   //  0
    }
}
```

#### Python
```python
def orientation(a, b, c):
    # TODO: return sign of the cross product
    return 0


if __name__ == "__main__":
    print(orientation((0, 0), (4, 0), (2, 3)))   # 1
    print(orientation((0, 0), (4, 0), (2, -3)))  # -1
    print(orientation((0, 0), (4, 0), (2, 0)))   # 0
```

- **Expected Output:** `1`, `-1`, `0`.
- **Evaluation:** correct signs, integer-only arithmetic, no division.

---

### Task 2 — Do two segments intersect? (yes/no)

**Statement.** Implement `segmentsIntersect(p1,p2,p3,p4)` returning a boolean. Cover the general crossing rule **and** all four collinear/on-segment boundary cases.

**Constraints.** Integer coordinates. Must return `true` for endpoint touches and collinear overlaps.

**Hints.** Compute the four orientations; if `o1!=o2 && o3!=o4` return true; otherwise for each `oi==0` test on-segment.

- Provide starter code in all 3 languages (mirror Task 1's structure).
- **Test cases:** the X `(1,1)-(4,4)` × `(1,4)-(4,1)` → true; disjoint `(0,0)-(2,0)` × `(3,1)-(3,5)` → false; T-junction `(0,0)-(4,0)` × `(2,0)-(2,3)` → true.
- **Evaluation:** all four canonical cases correct.

---

### Task 3 — Bounding-box pre-check

**Statement.** Implement `boxesOverlap(p1,p2,p3,p4)` that returns whether the two segments' axis-aligned bounding boxes overlap. Use it as a fast reject *before* the orientation test in a combined function.

**Constraints.** Four comparisons only; `O(1)`.

**Hints.** Boxes overlap iff `max(x of A) ≥ min(x of B)` and the symmetric conditions on both axes.

- Provide starter code in all 3 languages.
- **Expected:** disjoint-box pairs short-circuit to `false` without calling `orientation`.
- **Evaluation:** correctness plus demonstrable early reject (print a counter of orientation calls saved).

---

### Task 4 — Point-to-line distance

**Statement.** Given a line through `A,B` and a point `P`, compute the perpendicular distance using `|cross(A,B,P)| / |B-A|`.

**Constraints.** Float output; integer inputs allowed. `A != B`.

**Hints.** Numerator is the absolute cross product (twice the area); denominator is the base length `sqrt((Bx-Ax)^2 + (By-Ay)^2)`.

- Provide starter code in all 3 languages.
- **Test:** line `(0,0)-(4,0)`, point `(2,3)` → `3.0`.
- **Evaluation:** correct formula, no slope computation.

---

### Task 5 — Point-to-segment distance (clamped)

**Statement.** Extend Task 4 to a *segment*: project `P` onto line `AB`, clamp the projection parameter `t` to `[0,1]`, and return the distance to the clamped nearest point.

**Constraints.** Handle the degenerate `A == B` case (distance to the single point).

**Hints.** `t = dot(P-A, B-A)/dot(B-A, B-A)`; clamp; nearest `= A + t*(B-A)`.

- Provide starter code in all 3 languages.
- **Test:** segment `(0,0)-(4,0)`, point `(6,0)` → `2.0` (clamped to endpoint `B`); point `(2,3)` → `3.0`.
- **Evaluation:** correct clamping behavior at both ends and in the middle.

---

## Intermediate Tasks (5)

### Task 6 — Intersection point via Cramer's rule

**Statement.** Implement `intersectionPoint(p1,p2,p3,p4)` returning the crossing point as floats, or a sentinel (`None`/null) if the segments do not cross. Use the parametric determinant; check `det != 0` before dividing.

**Constraints.** Return the point only when `0 ≤ t ≤ 1` and `0 ≤ u ≤ 1`.

**Hints.** `det = d1 × d2`; `t = (e×d2)/det` with `e = p3-p1`; point `= p1 + t*d1`.

- Provide starter code in all 3 languages.
- **Test:** `(1,1)-(4,4)` × `(1,4)-(4,1)` → `(2.5, 2.5)`; parallel → sentinel.
- **Evaluation:** no division before the parallel check; correct in-range gating.

---

### Task 7 — Full five-way classification

**Statement.** Return one of `CROSS` (with point), `TOUCH`, `OVERLAP`, `PARALLEL`, `NONE`. Distinguish distinct-parallel from collinear, and within collinear distinguish disjoint / single-touch / range-overlap.

**Constraints.** Integer decision; project collinear segments onto the dominant axis for the interval test.

**Hints.** After `det==0`, test `cross(d1, p3-p1)` to split parallel vs collinear; then 1-D interval intersection.

- Provide starter code in all 3 languages.
- **Test:** four cases from `interview.md`'s challenge.
- **Evaluation:** every branch reachable and correct.

---

### Task 8 — Exact rational intersection point

**Statement.** Compute the intersection point as a **reduced fraction** (exact), not a float. Output `"px/py"` form, reducing with `gcd`.

**Constraints.** Use `big.Rat` (Go), `BigInteger`/manual gcd (Java), `fractions.Fraction` (Python). No floating point anywhere.

**Hints.** Numerator and denominator are degree-2 integer polynomials; reduce by `gcd`.

- Provide starter code in all 3 languages.
- **Test:** `(0,0)-(3,3)` × `(0,3)-(3,0)` → `3/2, 3/2`.
- **Evaluation:** exact output, fully reduced, no round-off.

---

### Task 9 — Line-line intersection from implicit form

**Statement.** Given two lines as `a1 x + b1 y = c1` and `a2 x + b2 y = c2`, compute their intersection (or report parallel). Then write a converter from two-point form to implicit form and test the round-trip.

**Constraints.** `det = a1 b2 − a2 b1`; parallel iff `det == 0`.

**Hints.** Converter: `a = Qy-Py`, `b = Px-Qx`, `c = a*Px + b*Py`.

- Provide starter code in all 3 languages.
- **Test:** lines through `(0,0)-(4,4)` and `(0,4)-(4,0)` → `(2,2)`.
- **Evaluation:** correct conversion and intersection; parallel detected.

---

### Task 10 — Ray-segment intersection

**Statement.** Given a ray (origin + direction) and a segment, return the hit point or `None`. The ray has `t ≥ 0` (no upper bound); the segment has `u ∈ [0,1]`.

**Constraints.** Reuse the determinant; handle parallel.

**Hints.** Same Cramer setup; accept iff `t ≥ 0` and `0 ≤ u ≤ 1`.

- Provide starter code in all 3 languages.
- **Test:** ray from `(0,0)` dir `(1,0)` vs segment `(3,-1)-(3,2)` → `(3,0)`; ray pointing away → `None`.
- **Evaluation:** correct `t ≥ 0` gating (this is the ray-casting building block for point-in-polygon).

---

## Advanced Tasks (5)

### Task 11 — All-pairs intersection (brute force + bbox prefilter)

**Statement.** Given `n` segments, return all intersecting pairs `(i,j)`. Apply the bounding-box pre-check before the exact test.

**Constraints.** `O(n²)` worst case acceptable; the prefilter must skip clearly-disjoint pairs.

**Hints.** Loop `i < j`; `if !boxesOverlap: continue; if intersects: record`.

- Provide starter code in all 3 languages.
- **Test:** a small set with a known answer set; print sorted pairs.
- **Evaluation:** correctness; report how many pairs the prefilter rejected.

---

### Task 12 — Grid-indexed batch intersection

**Statement.** Replace the `O(n²)` outer loop with a uniform-grid broad phase: bucket each segment into the grid cells its bounding box touches, then test only co-located pairs (dedup pairs across shared cells).

**Constraints.** Choose cell size near the mean segment length; dedup `(i,j)` pairs.

**Hints.** See `senior.md` §10 for the structure; use a `seen` set to avoid testing a pair twice.

- Provide starter code in all 3 languages.
- **Test:** verify the result equals Task 11's on the same input.
- **Evaluation:** identical result set; demonstrably fewer predicate calls than brute force on a sparse input.

---

### Task 13 — Robust near-collinear classification (float vs exact)

**Statement.** Build a test harness that feeds *nearly* collinear triples to (a) a naive float orientation and (b) an exact integer orientation, and counts disagreements. Demonstrate the float version flipping sign near zero.

**Constraints.** Generate inputs where the true determinant is tiny but nonzero.

**Hints.** Scale integer coordinates up, compute exact sign as ground truth, compare to a float computation that suffers cancellation.

- Provide starter code in all 3 languages.
- **Expected:** a nonzero disagreement count for the naive float predicate; zero for the exact one.
- **Evaluation:** the harness convincingly shows the robustness gap (motivates `professional.md`'s adaptive predicates).

---

### Task 14 — Polygon self-intersection check

**Statement.** Given a polygon as an ordered list of vertices (closed), determine whether it is **simple** (no two non-adjacent edges intersect). Adjacent edges sharing an endpoint do *not* count.

**Constraints.** Use the segment-intersection predicate; skip adjacent edge pairs and the wrap-around pair.

**Hints.** For edges `i` and `j`, skip if they share a vertex (`|i-j| ≤ 1` or the first/last wrap). Otherwise test intersection.

- Provide starter code in all 3 languages.
- **Test:** a convex pentagon → simple; a bowtie quadrilateral → self-intersecting.
- **Evaluation:** correct adjacency handling; correct simple/non-simple verdict.

---

### Task 15 — Segment intersection count via the predicate (toward sweep line)

**Statement.** Count the total number of intersecting pairs among `n` segments two ways: (1) brute force, (2) a grid-indexed batch. Verify they agree, then write a short note on when you would switch to the Bentley-Ottmann **sweep line** (`05-sweep-line`) instead.

**Constraints.** Counts must match exactly on random inputs.

**Hints.** This is the bridge to `05-sweep-line`: the sweep wins when `k` (number of intersections) is small relative to `n²`.

- Provide starter code in all 3 languages.
- **Expected:** equal counts; a written explanation of the output-sensitive trade-off.
- **Evaluation:** agreement on randomized tests + a correct articulation of when the sweep line pays off.

---

## Benchmark Task

> Compare performance across all 3 languages: time the all-pairs intersection count as `n` grows, confirming the `O(n²)` curve (doubling `n` quadruples the time).

#### Go

```go
package main

import (
	"fmt"
	"time"
)

type P struct{ X, Y int64 }

func cross(o, a, b P) int64 { return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X) }
func sgn(v int64) int {
	if v > 0 { return 1 }
	if v < 0 { return -1 }
	return 0
}
func inter(s0, s1, t0, t1 P) bool {
	o1, o2 := sgn(cross(s0, s1, t0)), sgn(cross(s0, s1, t1))
	o3, o4 := sgn(cross(t0, t1, s0)), sgn(cross(t0, t1, s1))
	return o1 != o2 && o3 != o4
}

func main() {
	sizes := []int{100, 200, 400, 800, 1600}
	for _, n := range sizes {
		segs := make([][2]P, n)
		for i := 0; i < n; i++ {
			segs[i] = [2]P{{int64(i), 0}, {int64(n - i), int64(n)}}
		}
		start := time.Now()
		count := 0
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				if inter(segs[i][0], segs[i][1], segs[j][0], segs[j][1]) {
					count++
				}
			}
		}
		fmt.Printf("n=%5d count=%-7d %v\n", n, count, time.Since(start))
	}
}
```

#### Java

```java
public class Benchmark {
    static long cross(long ox, long oy, long ax, long ay, long bx, long by) {
        return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
    }
    static int sgn(long v) { return Long.compare(v, 0); }
    static boolean inter(long[] s0, long[] s1, long[] t0, long[] t1) {
        int o1 = sgn(cross(s0[0],s0[1], s1[0],s1[1], t0[0],t0[1]));
        int o2 = sgn(cross(s0[0],s0[1], s1[0],s1[1], t1[0],t1[1]));
        int o3 = sgn(cross(t0[0],t0[1], t1[0],t1[1], s0[0],s0[1]));
        int o4 = sgn(cross(t0[0],t0[1], t1[0],t1[1], s1[0],s1[1]));
        return o1 != o2 && o3 != o4;
    }
    public static void main(String[] args) {
        int[] sizes = {100, 200, 400, 800, 1600};
        for (int n : sizes) {
            long[][][] segs = new long[n][2][2];
            for (int i = 0; i < n; i++) {
                segs[i][0] = new long[]{i, 0};
                segs[i][1] = new long[]{n - i, n};
            }
            long start = System.nanoTime();
            int count = 0;
            for (int i = 0; i < n; i++)
                for (int j = i + 1; j < n; j++)
                    if (inter(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) count++;
            System.out.printf("n=%5d count=%-7d %.2f ms%n",
                    n, count, (System.nanoTime() - start) / 1e6);
        }
    }
}
```

#### Python

```python
import time


def cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])


def sgn(v):
    return (v > 0) - (v < 0)


def inter(s0, s1, t0, t1):
    o1, o2 = sgn(cross(s0, s1, t0)), sgn(cross(s0, s1, t1))
    o3, o4 = sgn(cross(t0, t1, s0)), sgn(cross(t0, t1, s1))
    return o1 != o2 and o3 != o4


if __name__ == "__main__":
    for n in (100, 200, 400, 800, 1600):
        segs = [((i, 0), (n - i, n)) for i in range(n)]
        start = time.perf_counter()
        count = 0
        for i in range(n):
            si = segs[i]
            for j in range(i + 1, n):
                sj = segs[j]
                if inter(si[0], si[1], sj[0], sj[1]):
                    count += 1
        print(f"n={n:>5} count={count:<7} {(time.perf_counter()-start)*1000:.2f} ms")
```

**Goal:** observe the quadratic growth, then argue (Task 15) where the `O((n+k) log n)` sweep line (`05-sweep-line`) overtakes brute force as `n` grows and `k` stays sparse.
