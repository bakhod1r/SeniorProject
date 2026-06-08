# Voronoi Diagram & Delaunay Triangulation — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Compare squared distances (avoid `sqrt`), orient triangles CCW, and handle degeneracies. Test on a square, an equilateral triangle, points on a circle (cocircular), and collinear points.

## Beginner Tasks

**Task 1:** Implement the **orientation test** `orient2d(a, b, c)` and use it to classify three points as left-turn / right-turn / collinear. Then write `isCCW(a, b, c)`.

#### Go

```go
package main

func orient2d(a, b, c [2]float64) float64 {
	// return (b-a) x (c-a)
	return 0
}

func main() {
	// classify (0,0),(1,0),(0,1)  -> left turn (CCW)
}
```

#### Java

```java
public class Task1 {
    static double orient2d(double[] a, double[] b, double[] c) {
        return 0; // (b-a) x (c-a)
    }
    public static void main(String[] args) {
        // classify (0,0),(1,0),(0,1)
    }
}
```

#### Python

```python
def orient2d(a, b, c):
    return 0.0  # (b-a) x (c-a)

if __name__ == "__main__":
    pass  # classify (0,0),(1,0),(0,1)
```

- **Constraints:** pure function, no library. Test all three signs.
- **Expected Output:** `(0,0),(1,0),(0,1)` → left turn (positive).
- **Evaluation:** correct sign convention, collinear handled.

**Task 2:** Implement `circumcenter(a, b, c)` and `circumradius2(a, b, c)` (squared radius). Return an error/None for collinear input.
- Verify: for the right triangle `(0,0),(2,0),(0,2)` the circumcenter is `(1,1)` and `r² = 2`.

**Task 3:** Implement the **in-circle test** `inCircle(a, b, c, d)` as the reduced 3×3 determinant. Return `+1 / 0 / -1`.
- Verify: `(0,0),(2,0),(0,2)` with `d=(0.5,0.5)` → inside (`+1`); with `d=(3,3)` → outside (`-1`); with a cocircular point → `0`.

**Task 4:** Given a list of sites and a query point `q`, return the index of the **nearest site** by brute force (squared distance). This is point-location in the Voronoi diagram, done the slow way.
- Constraints: handle ties deterministically (smallest index wins).

**Task 5:** Given two sites `p` and `q`, compute the **perpendicular bisector** as a line `ax + by = c`. Print the line, and verify a sampled midpoint lies on it.
- This is one Voronoi edge between two sites.

## Intermediate Tasks

**Task 6:** Implement **Bowyer–Watson** Delaunay triangulation from scratch (super-triangle, cavity deletion, re-triangulation, super-triangle removal). Return the list of triangles as index triples.
- Constraints: `n ≤ 1000`; de-duplicate identical points first.
- Validate: triangle count `≤ 2n − 5`.

**Task 7:** Implement **Lawson's edge-flip legalization**: given an arbitrary triangulation, repeatedly flip illegal edges until it is Delaunay. Count the flips performed.
- Test: start from a non-Delaunay triangulation of a square (diagonal through the "wrong" pair) and confirm exactly one flip fixes it (after perturbing to break cocircularity).

**Task 8:** From a Delaunay triangulation, **dualize to the Voronoi diagram**: output the circumcenter of each triangle (Voronoi vertices) and, for each internal Delaunay edge, the Voronoi edge connecting the two adjacent circumcenters.
- Note unbounded cells (hull edges have only one adjacent triangle).

**Task 9:** Build the **Euclidean Minimum Spanning Tree** by running Kruskal on the Delaunay edges only. Compare its total length against a brute-force `O(n²)` MST on the complete graph and assert equality.
- This demonstrates EMST ⊆ Delaunay.

**Task 10:** Compute the **all-nearest-neighbors** map (each site → its nearest other site) using only Delaunay edges, and verify against brute force.
- Constraints: prove every nearest-neighbor pair appears as a Delaunay edge on your test inputs.

## Advanced Tasks

**Task 11:** Implement an **adaptive in-circle predicate**: fast `double` estimate guarded by an error bound, falling back to exact arithmetic (`big.Rat` / `BigDecimal` / `fractions.Fraction`) when the estimate is near zero. Show a constructed near-cocircular input where naive `double` gives the wrong sign but your adaptive version is correct.

**Task 12:** Implement the **lifting-to-paraboloid duality** check: lift sites to `(x, y, x²+y²)`, compute the **lower convex hull** in 3D, project its faces, and verify the projected triangles equal your Bowyer–Watson Delaunay triangulation on random inputs.

**Task 13:** Compute the **largest empty circle** whose center lies inside the convex hull: scan all Voronoi vertices, for each find the distance to its nearest site (its circumradius), and return the maximum. Verify the returned circle contains no site strictly inside.

**Task 14:** Implement a **randomized incremental** Delaunay build with a simple **point-location walk** (start from the last triangle, walk toward the new point across edges). Insert in random order. Benchmark against Bowyer–Watson on `n = 200, 2000, 20000` and show the asymptotic improvement.

**Task 15:** Implement a basic **constrained Delaunay triangulation (CDT)**: given a set of points and a set of required segments, build the Delaunay triangulation, then force each constraint segment to appear as an edge (flip out crossing edges along the segment). Verify all constraints are present and the rest is as-Delaunay-as-possible.

## Benchmark Task

> Compare Delaunay construction time across all 3 languages for growing `n` (random points in a square). Use the same Bowyer–Watson implementation in each.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{100, 500, 1000, 2000, 4000}
	for _, n := range sizes {
		pts := make([]Pt, n) // reuse your Pt + delaunay()
		for i := range pts {
			pts[i] = Pt{rand.Float64() * 1000, rand.Float64() * 1000}
		}
		start := time.Now()
		_ = delaunay(pts)
		fmt.Printf("n=%6d: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {100, 500, 1000, 2000, 4000};
        Random rng = new Random(42);
        for (int n : sizes) {
            List<Pt> pts = new ArrayList<>();
            for (int i = 0; i < n; i++)
                pts.add(new Pt(rng.nextDouble()*1000, rng.nextDouble()*1000));
            long start = System.nanoTime();
            DelaunayChallenge.delaunay(pts); // reuse your build
            long ns = System.nanoTime() - start;
            System.out.printf("n=%6d: %.1f ms%n", n, ns / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random
import time

# reuse your delaunay(pts)
sizes = [100, 500, 1000, 2000, 4000]
for n in sizes:
    pts = [(random.uniform(0, 1000), random.uniform(0, 1000)) for _ in range(n)]
    start = time.perf_counter()
    delaunay(pts)
    print(f"n={n:6d}: {(time.perf_counter()-start)*1000:.1f} ms")
```

> Expected: naive Bowyer–Watson grows roughly quadratically. After Task 14, re-run with the randomized-incremental + walk version and observe the near-`O(n log n)` curve. Note the constant-factor differences between the three languages and the impact of `sqrt`-free distance comparisons.
