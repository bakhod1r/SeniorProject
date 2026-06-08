# k-d Tree — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Always test against a brute-force O(n) reference on random points: the nearest/range/radius results must match exactly.

## Beginner Tasks

**Task 1:** Implement a balanced 2D k-d tree from scratch (no libraries). Build by **median split** with alternating x/y axes, then implement `nearest(q)` returning the closest stored point and its squared distance.

#### Go
```go
package main

type Point struct{ X, Y float64 }
type Node struct {
	P           Point
	Left, Right *Node
	Axis        int
}

func build(pts []Point, depth int) *Node {
	// implement: median split, axis = depth % 2
	return nil
}

func nearest(root *Node, q Point) (Point, float64) {
	// implement: descend near, prune far with diff*diff < bestD
	return Point{}, 0
}

func main() {
	// build, then nearest({6,5}) on the 7-point example → (5,4), 2
}
```

#### Java
```java
public class Task1 {
    static final class Node { double x, y; Node left, right; int axis; }

    static Node build(double[][] pts, int lo, int hi, int depth) {
        // implement
        return null;
    }

    static double[] nearest(Node root, double qx, double qy) {
        // implement
        return null;
    }

    public static void main(String[] args) {
        // build, then nearest(6,5) → (5,4)
    }
}
```

#### Python
```python
class Node:
    __slots__ = ("p", "left", "right", "axis")

def build(pts, depth=0):
    # implement: median split, axis = depth % 2
    pass

def nearest(root, q):
    # implement: descend near, prune far with diff*diff < best
    pass

if __name__ == "__main__":
    pts = [(7,2),(5,4),(9,6),(2,3),(4,7),(8,1),(9,9)]
    # build, then nearest((6,5)) → ((5,4), 2)
```

- **Constraints:** correct O(n log n) build, correct pruning. Test with `n=1`, duplicates, query equal to a stored point.
- **Expected Output:** `nearest((6,5))` returns `(5,4)` with squared distance `2`.
- **Evaluation:** correctness vs brute force, pruning present, alternating axes.

**Task 2:** Add an `insert(p)` that descends and attaches `p` as a leaf (accepting that the tree may unbalance). Verify nearest-neighbor still returns correct results after several inserts. Provide starter code in all 3 languages.
- Constraints: must preserve the alternating-axis BST invariant.

**Task 3:** Implement `printTree` that draws the tree with each node's point and split axis (`[x]`/`[y]`), indented by depth. Use it to visually confirm your build is balanced.

**Task 4:** Implement **squared-distance** comparison correctly: write `sqDist` and confirm `nearest` never calls `sqrt`. Add an optional `nearestDistance(q)` that returns the *true* (sqrt) distance only for the final answer.

**Task 5:** Write a **brute-force** `nearestBrute(pts, q)` and a randomized test harness that generates 1000 random point sets and 100 random queries each, asserting `nearest == nearestBrute`. This harness is reused by all later tasks.

## Intermediate Tasks

**Task 6:** Implement **k-nearest-neighbors** `knn(q, k)` using a bounded **max-heap** of size `k`. Prune the far subtree only when the heap is full and `diff*diff >= heap.top.dist`. Return the `k` points sorted by ascending distance. Provide starter code in all 3 languages.
- Constraints: expected O(k + log n); correct `+∞` bound until the heap fills.

**Task 7:** Implement **orthogonal range search** `rangeSearch(lo, hi)` returning all points inside the inclusive axis-aligned box. Prune a child when the box does not cross that side of the split line. Verify against brute force.

**Task 8:** Implement **radius search** `radiusSearch(q, r)` returning all points within Euclidean distance `r` of `q`. Prune the far side when `diff*diff > r*r`. Test with `r=0` (only exact matches) and `r` covering the whole cloud.

**Task 9:** Replace the per-level **sort** with **quickselect** (`nth_element`) median finding so build is O(n log n) instead of O(n log² n). Benchmark both builds on n = 10⁵ points and report the speedup.

**Task 10:** Generalize your tree from 2D to **k-D** (arbitrary dimension). Use `axis = depth mod k` and loop over all coordinates in `sqDist` and the split comparison. Confirm correctness in 3D against brute force.

## Advanced Tasks

**Task 11:** Implement **deletion** correctly: to delete a node, find the **minimum on its split axis** in the appropriate subtree and replace (the k-d analogue of BST successor splicing). Verify the tree remains a valid k-d tree after a sequence of deletes. Provide starter code in all 3 languages.
- Constraints: must not naively splice; use a recursive find-min-on-axis helper.

**Task 12:** Implement a **double-buffered dynamic k-d tree**: serve queries from the "live" tree while a background goroutine/thread rebuilds a fresh tree from the updated point set, then atomically swap. Demonstrate that no query ever observes a partially-built tree.

**Task 13:** Demonstrate the **curse of dimensionality** empirically. For dimensions d ∈ {2, 4, 8, 16, 32}, build a k-d tree on n = 10⁵ uniform random points, instrument `nodesVisited` per NN query, and plot/print the fraction of nodes visited vs d. Confirm it rises toward 1.0 as d grows.

**Task 14:** Implement the **widest-spread split rule**: at each node choose the axis with the largest coordinate range among the subtree's points (instead of cyclic `depth mod k`). Compare `nodesVisited` against the cyclic rule on clustered (non-uniform) data.

**Task 15:** Build a **2D nearest-café service**: load 100k random `(lat, lon)` points, convert them to 3D Cartesian on the unit sphere, build a 3D k-d tree, and answer "nearest café to this location" queries. Verify that 3D-Cartesian NN matches great-circle (Haversine) nearest on a sample of queries.

## Benchmark Task

> Compare nearest-neighbor query performance across all 3 languages and across dimensions, to feel both the O(log n) win in low dim and the curse-of-dimensionality degradation.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, d := range []int{2, 4, 8, 16, 32} {
		n := 100000
		pts := make([]Point, n) // adapt Point to d dims (use []float64)
		_ = pts
		_ = rand.Float64
		start := time.Now()
		// build tree of dimension d, run 10000 NN queries
		elapsed := time.Since(start)
		fmt.Printf("d=%2d n=%d: %.2f us/query\n", d, n,
			float64(elapsed.Microseconds())/10000)
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] dims = {2, 4, 8, 16, 32};
        int n = 100000;
        Random rng = new Random(42);
        for (int d : dims) {
            // build tree of dimension d, run 10000 NN queries
            long start = System.nanoTime();
            // ...
            long elapsed = System.nanoTime() - start;
            System.out.printf("d=%2d n=%d: %.2f us/query%n", d, n,
                elapsed / 10000.0 / 1000.0);
        }
    }
}
```

#### Python
```python
import random
import time


def benchmark():
    for d in (2, 4, 8, 16, 32):
        n = 100_000
        pts = [tuple(random.random() for _ in range(d)) for _ in range(n)]
        # build tree of dimension d
        q = tuple(random.random() for _ in range(d))
        start = time.perf_counter()
        for _ in range(10_000):
            pass  # nearest(tree, q)
        elapsed = time.perf_counter() - start
        print(f"d={d:2d} n={n}: {elapsed / 10_000 * 1e6:.2f} us/query")


if __name__ == "__main__":
    benchmark()
```

**Expected observation:** query time stays near-constant (O(log n)) at d = 2–4, then climbs sharply toward the brute-force O(n) cost by d = 32 — the curse of dimensionality made measurable. Cross-reference `professional.md` §6 for the theory.
