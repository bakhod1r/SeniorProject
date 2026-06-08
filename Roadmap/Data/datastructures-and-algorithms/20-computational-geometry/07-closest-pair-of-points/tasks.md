# Closest Pair of Points — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Start every solution by writing a brute-force version, then validate the optimized one against it on random inputs.

---

## Beginner Tasks

**Task 1:** Implement the brute-force `O(n²)` closest pair from scratch. Return both the minimum distance and the two points achieving it. Use **squared distance** internally and take `sqrt` only once at the end.

#### Go

```go
package main

import "math"

type Point struct{ X, Y float64 }

func bruteForce(pts []Point) (Point, Point, float64) {
	// TODO: nested loops over all pairs, track min squared distance
	return Point{}, Point{}, math.Inf(1)
}

func main() {
	// TODO: test with [(0,0),(3,4)] -> dist 5.0
}
```

#### Java

```java
public class Task1 {
    record Point(double x, double y) {}

    static double bruteForce(Point[] pts) {
        // TODO: nested loops, squared distance, sqrt at the end
        return Double.POSITIVE_INFINITY;
    }

    public static void main(String[] args) {
        // TODO: test
    }
}
```

#### Python

```python
import math


def brute_force(pts):
    # TODO: nested loops over all pairs; return (dist, (p, q))
    return math.inf, None


if __name__ == "__main__":
    print(brute_force([(0, 0), (3, 4)]))  # expect ~5.0
```

- **Constraints:** `n ≥ 2`; handle duplicate points (distance 0).
- **Expected Output:** the closest distance and the pair.
- **Evaluation:** correctness, single `sqrt`, edge cases (2 points, duplicates).

---

**Task 2:** Write a `euclidean(a, b)` and a `sqEuclidean(a, b)` helper in all three languages. Demonstrate that ranking pairs by squared distance gives the same order as ranking by true distance (print a small table for 4 points).

- Constraints: no `sqrt` inside `sqEuclidean`.
- Goal: internalize the squared-distance optimization.

---

**Task 3:** Given points, **sort them by `x`, breaking ties by `y`**, and print the sorted order. Then split the sorted list at index `n/2` (rank split) and print the median line `x`-coordinate. This is the setup phase of divide-and-conquer.

- Constraints: split by **rank**, not by `x`-value.
- Edge case: verify behavior when several points share the same `x`.

---

**Task 4:** Build the **strip**: given a sorted-by-`x` point list, a median `x`, and a `delta`, return the sub-list of points with `|x - midX| < delta`. Then sort that strip by `y` and print it.

- Constraints: use strict `<` for the band test.
- Test: a vertical column of points should all appear in the strip.

---

**Task 5:** Implement the **early-break strip scan** in isolation: given a `y`-sorted strip and a `delta`, find the closest pair *within the strip* by comparing each point only against the following points whose `y`-gap is `< delta`. Count how many distance comparisons you perform and print it.

- Constraints: the inner loop must `break` as soon as `dy ≥ delta`.
- Goal: see the ≤ 7 bound in action on clustered input.

---

## Intermediate Tasks

**Task 6:** Implement the full **divide-and-conquer** closest pair (`O(n log² n)` is acceptable here: re-sort the strip by `y` each call). Validate it against your Task 1 brute force on 1,000 random inputs of size 50–500. Provide starter code in all three languages.

- Constraints: assert the two algorithms agree to within `1e-9`.
- Evaluation: correctness across random + adversarial inputs.

---

**Task 7:** Upgrade Task 6 to the **optimal `O(n log n)`** version by returning each sub-array sorted by `y` and **merging** the halves instead of re-sorting the strip. Confirm the answer is unchanged and benchmark both versions at `n = 100,000`.

- Constraints: only one `x`-sort, at the top.
- Deliverable: a timing comparison `log n` vs `log² n`.

---

**Task 8:** Implement the **sweep-line + ordered-set** algorithm. Sort by `x`; maintain an active set keyed by `(y, x)`; for each point evict those with `x` too far behind, range-query `[y-δ, y+δ]`, compare, then insert. Use `TreeSet` (Java), `sortedcontainers.SortedList` (Python), and a balanced structure or sorted slice (Go).

- Constraints: `O(n log n)` overall.
- Test: matches brute force on random inputs including duplicate `y`.

---

**Task 9:** Return the **actual closest pair** (both points), not just the distance, from your divide-and-conquer implementation. Thread a `(distance, p, q)` triple through the recursion and the strip scan.

- Constraints: ties may return any valid closest pair.
- Edge case: coincident points must return that zero-distance pair.

---

**Task 10:** Add an **integer-exact** mode: when all coordinates are integers, compute squared distances as 64-bit integers and never use floating point until the final reported distance. Compare results against the float version on inputs with large coordinates (up to `±10^7`).

- Constraints: guard against 32-bit overflow; use 64-bit.
- Goal: numerical robustness for integer inputs.

---

## Advanced Tasks

**Task 11:** Implement the **randomized grid (Rabin)** closest pair in `O(n)` expected time. Insert points in random order, maintain a grid hashed at the current `delta`, check each point's 3×3 cell neighborhood, and rebuild the grid when `delta` shrinks. Provide starter code in all three languages.

- Constraints: cell key = `(floor(x/delta), floor(y/delta))`.
- Evaluation: matches divide-and-conquer; measure rebuild count (should be `O(log n)`).

---

**Task 12:** Extend closest pair to **3-D**: split by a median plane on `x`, build a `2δ`-wide slab, and within the slab compare each point against neighbors within `δ` in both `y` and `z`. Validate against a 3-D brute force.

- Constraints: the per-point candidate count is a (larger) constant.
- Goal: see the strip generalize to a slab.

---

**Task 13:** Implement an **incremental / streaming** closest pair: points arrive one at a time; after each arrival, output the current closest distance in `O(1)` expected using the grid keyed at the running `delta` (shrink-and-rehash on improvement).

- Constraints: insert-only stream; no deletions.
- Test: feed 1,000,000 streamed points; verify the final answer matches a batch run.

---

**Task 14:** Implement **all pairs within radius `r`** (a generalization used in collision/air-traffic): given a fixed `r`, report every pair at distance `< r`. Use a uniform grid of cell size `r` so each point checks only its 3×3 neighborhood.

- Constraints: output size can be large; stream results, don't materialize `O(n²)`.
- Edge case: choose `r` so the answer is sparse; verify against brute force.

---

**Task 15:** Build a **property-based / fuzz test harness** that generates random point sets (uniform, clustered, collinear, all-duplicate, single vertical line) and asserts that brute force, divide-and-conquer, sweep line, and the grid method all agree to within `1e-9`. Report the first failing seed if any.

- Constraints: at least 5 input distributions; thousands of trials.
- Goal: confidence that all four implementations are correct and consistent.

---

## Benchmark Task

> Compare brute force vs divide-and-conquer vs grid across all three languages. Generate uniform random points and time each method.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 5000, 25000, 100000}
	for _, n := range sizes {
		pts := make([]Point, n)
		for i := range pts {
			pts[i] = Point{rand.Float64() * 1e6, rand.Float64() * 1e6}
		}
		start := time.Now()
		_ = ClosestPair(pts) // your O(n log n) implementation
		fmt.Printf("n=%7d: dc=%.2f ms\n", n, float64(time.Since(start).Microseconds())/1000)
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 5000, 25000, 100000};
        Random rnd = new Random(1);
        for (int n : sizes) {
            Point[] pts = new Point[n];
            for (int i = 0; i < n; i++)
                pts[i] = new Point(rnd.nextDouble()*1e6, rnd.nextDouble()*1e6);
            long start = System.nanoTime();
            closestPair(pts); // your O(n log n) implementation
            System.out.printf("n=%7d: dc=%.2f ms%n", n, (System.nanoTime()-start)/1e6);
        }
    }
}
```

#### Python

```python
import random, time

sizes = [1000, 5000, 25000, 100000]
for n in sizes:
    pts = [(random.random()*1e6, random.random()*1e6) for _ in range(n)]
    start = time.perf_counter()
    closest_pair(pts)  # your O(n log n) implementation
    print(f"n={n:7d}: dc={(time.perf_counter()-start)*1000:.2f} ms")
```

**Reporting:** plot or tabulate the times. You should see brute force grow quadratically (run it only up to `n ≈ 5,000`), divide-and-conquer grow like `n log n`, and the grid method grow nearly linearly with the smallest constant on uniform data.
