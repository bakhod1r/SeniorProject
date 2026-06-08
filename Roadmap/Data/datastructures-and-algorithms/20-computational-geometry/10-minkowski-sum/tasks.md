# Minkowski Sum of Convex Polygons — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> A point is `(x, y)`; polygons are CCW with integer coordinates unless stated otherwise.
> Reusable primitives: `add`, `sub`, `cross`, `reorder` (rotate to bottom-most vertex), `minkowski`.

---

## Beginner Tasks

**Task 1: Translate a polygon (`A ⊕ {p}`).**
Implement `translate(poly, p)` returning every vertex shifted by `p`. This is the simplest Minkowski sum: summing with a single-point set is a pure translation.

#### Go

```go
package main

type Pt struct{ X, Y int64 }

func translate(poly []Pt, p Pt) []Pt {
	// implement here
	return nil
}

func main() {
	// translate([(0,0),(2,0),(0,2)], (5,1)) -> [(5,1),(7,1),(5,3)]
}
```

#### Java

```java
import java.util.*;

public class Task1 {
    record Pt(long x, long y) {}
    static List<Pt> translate(List<Pt> poly, Pt p) {
        // implement here
        return null;
    }
    public static void main(String[] args) { }
}
```

#### Python

```python
def translate(poly, p):
    # implement here
    pass

if __name__ == "__main__":
    print(translate([(0, 0), (2, 0), (0, 2)], (5, 1)))
    # [(5, 1), (7, 1), (5, 3)]
```

- **Constraints:** O(n). Works for empty polygon.
- **Expected Output:** each vertex shifted by `p`.
- **Evaluation:** correctness, handles empty input.

---

**Task 2: Reflect a polygon (`−B`).**
Implement `reflect(poly)` returning `B` flipped through the origin while preserving CCW order. Remember to negate **and** reverse.

- Provide starter code in all 3 languages.
- Constraints: O(n). Verify the result is still CCW (signed area positive).
- Expected: `reflect([(0,0),(1,0),(1,1),(0,1)])` → a CCW square in the third/origin region.

---

**Task 3: Bottom-most vertex reordering.**
Implement `reorder(poly)` that rotates a CCW polygon so it starts at the vertex with the lowest `y` (ties broken by lowest `x`). This is the normalization step the merge depends on.

- Provide starter code in all 3 languages.
- Constraints: O(n). Output must remain CCW and contain the same vertices in the same cyclic order.
- Expected: `reorder([(0,2),(0,0),(2,0)])` starts at `(0,0)`.

---

**Task 4: Cross-product edge-angle comparison.**
Implement `edgeLess(u, v)` returning true if edge vector `u` has a strictly smaller polar angle than `v`, using **only** the cross product (no `atan2`). Handle the half-plane split so the ordering is consistent over `[0, 2π)`.

- Provide starter code in all 3 languages.
- Constraints: O(1). No floating-point trig.
- Expected: `edgeLess((1,0),(0,1))` → true; `edgeLess((0,1),(1,0))` → false.

---

**Task 5: Minkowski sum of two triangles.**
Using `add`, `sub`, `cross`, `reorder`, implement `minkowski(a, b)` for two convex polygons and test it on two triangles. Print the resulting polygon.

- Provide starter code in all 3 languages.
- Constraints: O(n + m). Inputs convex and CCW.
- Expected: a convex polygon with ≤ 6 vertices.
- Evaluation: correctness vs hand computation.

---

## Intermediate Tasks

**Task 6: Brute-force oracle and cross-check.**
Implement `brute(a, b) = convexHull({ a+b : a∈A, b∈B })`. Then assert that `minkowski(a, b)` and `brute(a, b)` produce the same vertex set (after dropping collinear points) on 1000 random convex polygon pairs.

- Provide starter code in all 3 languages.
- Constraints: oracle is O(nm log nm); merge is O(n+m). Random convex polygons via hull of random points.
- Evaluation: both agree on all random cases.

---

**Task 7: Strip collinear vertices.**
Add a `clean(poly)` step that removes any vertex `B` where `cross(B−A, C−B) == 0` (A, C its neighbors). Use it to make `minkowski` output a strictly convex polygon.

- Provide starter code in all 3 languages.
- Constraints: O(n). Preserve CCW order and overall shape.
- Expected: the triangle+square example reduces from collinear-padded to its minimal vertex set.

---

**Task 8: Collision test via the origin.**
Implement `intersects(a, b)` = "is the origin inside `A ⊕ (−B)`?" using `reflect`, `minkowski`, and a point-in-convex-polygon test. Return whether two convex polygons overlap.

- Provide starter code in all 3 languages.
- Constraints: O(n + m). Touching counts as overlap.
- Expected: overlapping squares → true; disjoint squares → false.

---

**Task 9: Configuration-space obstacle.**
Implement `cspaceObstacle(obstacle, robot) = obstacle ⊕ (−robot)`. Given a square robot and a rectangular obstacle, output the inflated obstacle, then test whether a given reference point lies in free space.

- Provide starter code in all 3 languages.
- Constraints: O(n + m) to inflate, O(k) per point query.
- Expected: the inflated obstacle is larger than the original by the robot's extent.

---

**Task 10: Polygon ⊕ disk approximation (offsetting).**
Approximate a disk of radius `r` by a regular `k`-gon and compute `poly ⊕ disk_k(r)` to offset a convex polygon outward. Report the chord error `r(1 − cos(π/k))` for `k = 8, 16, 32`.

- Provide starter code in all 3 languages.
- Constraints: O((n + k)) merge. Coordinates may be floating-point here.
- Expected: vertex count grows; chord error shrinks as `k` increases.

---

## Advanced Tasks

**Task 11: Support-function GJK origin test.**
Implement the 2-D GJK overlap test using only `support_A(d) − support_B(−d)` — never building the sum. Compare results and speed against Task 8's materialized approach on 10⁴ random pairs.

- Provide starter code in all 3 languages.
- Constraints: O(k(n+m)) with a small iteration cap; add a margin so touching terminates.
- Evaluation: agrees with Task 8 on all cases; fewer allocations.

---

**Task 12: Penetration depth via expansion (mini-EPA).**
Extend Task 11: when the origin is inside `A ⊕ (−B)`, find the closest boundary point of the (lazily-evaluated) difference to the origin to recover penetration depth and contact normal.

- Provide starter code in all 3 languages.
- Constraints: iterate, expanding toward the boundary; stop within tolerance `ε`.
- Expected: for two unit squares overlapping by 0.3, depth ≈ 0.3 along the overlap axis.

---

**Task 13: Non-convex sum by decomposition.**
Given two simple (possibly non-convex) polygons, triangulate each, Minkowski-sum every triangle pair, and Boolean-union the results. Output the (possibly non-convex) sum and report the piece count `pq`.

- Provide starter code in all 3 languages.
- Constraints: worst case O(n²m²). You may use a simple ear-clipping triangulation.
- Evaluation: correctness on an L-shape ⊕ a square; sanity-check area.

---

**Task 14: Minkowski difference (erosion).**
Implement `erode(a, b) = A ⊖ B = ⋂_{b∈B}(A − b)` for convex `A`, `B` as an intersection of half-planes shifted inward by `B`'s support in each of `A`'s edge normals. Demonstrate that `erode(a, b) ≠ minkowski(a, reflect(b))`.

- Provide starter code in all 3 languages.
- Constraints: O(n·m) or better. Result is convex (possibly empty).
- Expected: eroding a big square by a small square yields a smaller centered square; the reflection-sum yields a *bigger* square — proving they differ.

---

**Task 15: Sum of `k` convex polygons.**
Compute `P₁ ⊕ P₂ ⊕ … ⊕ P_k` by folding the pairwise merge. Analyze the growth of the vertex count and total time. Then optimize: since `⊕` is associative and commutative, all edge vectors of all `k` polygons can be merged in one angular sort.

- Provide starter code in all 3 languages.
- Constraints: naive fold O(k · total_vertices); single-merge O(total · log total) or O(total) if pre-sorted.
- Evaluation: both methods agree; the single merge is faster for large `k`.

---

## Benchmark Task

> Compare the edge-merge against the all-pairs-hull oracle across sizes and across all 3 languages. Generate convex `n`-gons (hull of random points or a regular polygon) and time `minkowski` vs `brute`.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	sizes := []int{16, 64, 256, 1024, 4096}
	for _, n := range sizes {
		a := regularPolygon(n) // convex CCW n-gon
		b := regularPolygon(n)
		start := time.Now()
		for i := 0; i < 50; i++ {
			_ = minkowski(a, b)
		}
		el := float64(time.Since(start).Microseconds()) / 50.0 / 1000.0
		fmt.Printf("n=%5d  merge: %.3f ms\n", n, el)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {16, 64, 256, 1024, 4096};
        for (int n : sizes) {
            List<Pt> a = regularPolygon(n), b = regularPolygon(n);
            long start = System.nanoTime();
            for (int i = 0; i < 50; i++) minkowski(a, b);
            long el = System.nanoTime() - start;
            System.out.printf("n=%5d  merge: %.3f ms%n", n, el / 50.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import timeit

for n in (16, 64, 256, 1024, 4096):
    a = regular_polygon(n)
    b = regular_polygon(n)
    t = timeit.timeit(lambda: minkowski(a, b), number=50)
    print(f"n={n:>5}  merge: {t/50*1000:.3f} ms")
    # Optionally compare against brute(a, b) for small n only — it is O(nm log nm).
```

**Expected trend:** the merge scales linearly (doubling `n` ≈ doubles the time), while the all-pairs oracle scales near-quadratically and becomes impractical past a few hundred vertices. Record the crossover `n` where the merge wins decisively.
