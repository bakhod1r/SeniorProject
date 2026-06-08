# Manhattan & Chebyshev Distances — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Recurring theme: when an L1 ("diamond") problem looks awkward, rotate with `u = x+y, v = x-y` into an L∞ ("square") problem that separates per axis.

---

## Beginner Tasks (5)

### Task 1 — The three distance functions

Implement `manhattan(p, q)`, `chebyshev(p, q)`, and `euclidean(p, q)` for 2-D integer points. Verify the ordering `L∞ ≤ L2 ≤ L1` holds on several inputs.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func absI(x int) int { if x < 0 { return -x }; return x }
func maxI(a, b int) int { if a > b { return a }; return b }

func manhattan(p, q [2]int) int { return absI(p[0]-q[0]) + absI(p[1]-q[1]) }
func chebyshev(p, q [2]int) int { return maxI(absI(p[0]-q[0]), absI(p[1]-q[1])) }
func euclidean(p, q [2]int) float64 {
	dx, dy := float64(p[0]-q[0]), float64(p[1]-q[1])
	return math.Sqrt(dx*dx + dy*dy)
}

func main() {
	p, q := [2]int{1, 1}, [2]int{4, 5}
	fmt.Println(manhattan(p, q), chebyshev(p, q), euclidean(p, q)) // 7 4 5
}
```

#### Java

```java
public class Task1 {
    static int manhattan(int[] p, int[] q) { return Math.abs(p[0]-q[0]) + Math.abs(p[1]-q[1]); }
    static int chebyshev(int[] p, int[] q) { return Math.max(Math.abs(p[0]-q[0]), Math.abs(p[1]-q[1])); }
    static double euclidean(int[] p, int[] q) { return Math.hypot(p[0]-q[0], p[1]-q[1]); }

    public static void main(String[] args) {
        int[] p = {1, 1}, q = {4, 5};
        System.out.println(manhattan(p, q) + " " + chebyshev(p, q) + " " + euclidean(p, q));
    }
}
```

#### Python

```python
import math

def manhattan(p, q): return abs(p[0]-q[0]) + abs(p[1]-q[1])
def chebyshev(p, q): return max(abs(p[0]-q[0]), abs(p[1]-q[1]))
def euclidean(p, q): return math.hypot(p[0]-q[0], p[1]-q[1])

if __name__ == "__main__":
    p, q = (1, 1), (4, 5)
    print(manhattan(p, q), chebyshev(p, q), euclidean(p, q))  # 7 4 5.0
```

- **Constraints:** integer coords; assert `chebyshev ≤ euclidean ≤ manhattan`.
- **Expected Output:** `7 4 5`.
- **Evaluation:** correctness of all three; correct ordering assertion.

### Task 2 — Rotation round-trip

Implement `rotate(x,y) -> (x+y, x-y)` and `unrotate(u,v) -> ((u+v)/2,(u-v)/2)`. Assert that `unrotate(rotate(x,y)) == (x,y)` for 1000 random integer points. Provide starter code in all 3 languages.

- **Constraints:** coordinates in `[-10^6, 10^6]`; use 64-bit for `u`, `v`.
- **Expected Output:** "all 1000 round-trips OK".
- **Evaluation:** correctness; handles negatives; no overflow.

### Task 3 — Verify the rotation identity

For 1000 random point pairs, assert `manhattan(p,q) == chebyshev(rotate(p), rotate(q))`. This is the core invariant of the topic.

- **Constraints:** coords in `[-10^5, 10^5]`.
- **Expected Output:** "identity holds for all pairs".
- **Evaluation:** correct rotation; correct chebyshev on rotated coords.

### Task 4 — Chessboard king moves

Given two squares on an infinite chessboard, return the number of king moves between them (Chebyshev distance). Then return the number of *rook-style* (4-connected) moves (Manhattan distance). Provide starter code in all 3 languages.

- **Constraints:** coordinates `0 ≤ x, y < 10^9`.
- **Expected Output:** for `(0,0)` to `(3,4)`: king = `4`, rook = `7`.
- **Evaluation:** correct metric choice for each movement model.

### Task 5 — Which metric? Classify movement models

Write a function `heuristic(model)` returning the correct admissible metric name for a grid movement model: `"4-connected" -> "manhattan"`, `"8-connected-unit" -> "chebyshev"`, `"any-angle" -> "euclidean"`. Explain in a comment why using Manhattan on an 8-connected grid is inadmissible.

- **Constraints:** handle an unknown model by returning `"euclidean"` (always admissible).
- **Expected Output:** mapping table prints correctly.
- **Evaluation:** correct mapping; correct admissibility explanation.

---

## Intermediate Tasks (5)

### Task 6 — Maximum Manhattan distance in O(n)

Given `n` points, return the maximum `|dx|+|dy|` over all pairs, using the rotation (no `O(n²)` loop). Provide starter code in all 3 languages.

#### Go

```go
package main

import "fmt"

func maxManhattan(pts [][2]int) int {
	if len(pts) < 2 {
		return 0
	}
	const P = int(1 << 62)
	minU, maxU, minV, maxV := P, -P, P, -P
	for _, p := range pts {
		u, v := p[0]+p[1], p[0]-p[1]
		if u < minU { minU = u }
		if u > maxU { maxU = u }
		if v < minV { minV = v }
		if v > maxV { maxV = v }
	}
	ru, rv := maxU-minU, maxV-minV
	if ru > rv { return ru }
	return rv
}

func main() { fmt.Println(maxManhattan([][2]int{{1, 1}, {4, 5}, {6, 2}, {2, 8}})) } // 10
```

#### Java

```java
public class Task6 {
    static long maxManhattan(int[][] pts) {
        if (pts.length < 2) return 0;
        long minU = Long.MAX_VALUE, maxU = Long.MIN_VALUE, minV = Long.MAX_VALUE, maxV = Long.MIN_VALUE;
        for (int[] p : pts) {
            long u = (long) p[0] + p[1], v = (long) p[0] - p[1];
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        return Math.max(maxU - minU, maxV - minV);
    }
    public static void main(String[] args) {
        System.out.println(maxManhattan(new int[][]{{1,1},{4,5},{6,2},{2,8}})); // 10
    }
}
```

#### Python

```python
def max_manhattan(points):
    if len(points) < 2:
        return 0
    us = [x + y for x, y in points]
    vs = [x - y for x, y in points]
    return max(max(us) - min(us), max(vs) - min(vs))

if __name__ == "__main__":
    print(max_manhattan([(1, 1), (4, 5), (6, 2), (2, 8)]))  # 10
```

- **Constraints:** `n ≤ 10^5`; must be `O(n)`.
- **Expected Output:** `10`.
- **Evaluation:** linear time; 64-bit rotated sums; matches brute force on small inputs.

### Task 7 — Best meeting point (minimize total L1)

Return the minimum total Manhattan distance from a single chosen point (per-axis median). Provide starter code in all 3 languages.

- **Constraints:** `n ≤ 10^5`; use median, not mean.
- **Expected Output:** for `[(1,1),(2,2),(3,3)]` → meeting at `(2,2)`, total `4`.
- **Evaluation:** correct median; verify against brute-force candidate scan on small inputs.

### Task 8 — Maximum Chebyshev distance in O(n)

Given `n` points, return the maximum `max(|dx|,|dy|)` over all pairs in `O(n)`. (Hint: max Chebyshev = `max(range(x), range(y))` directly — no rotation needed; explain why.)

- **Constraints:** `n ≤ 10^5`.
- **Expected Output:** for `[(0,0),(3,4),(1,9)]` → `9`.
- **Evaluation:** correct per-axis range; clear explanation in comments.

### Task 9 — Rotate then KD-tree-free nearest neighbor box

After rotating all points to `(u, v)`, answer Q queries: for each query point, return the maximum Manhattan distance to any point in the set, in `O(1)` per query after `O(n)` preprocessing. (Hint: precompute the `(u,v)` bounding box; farthest is at a corner.)

- **Constraints:** `n, Q ≤ 10^5`.
- **Expected Output:** correct farthest-distance per query.
- **Evaluation:** `O(1)` queries; correct corner logic.

### Task 10 — Convert Chebyshev grid to Manhattan grid

Given a set of points and a king (8-connected) movement model, transform coordinates so that king distances become rook (Manhattan) distances, and verify on random pairs that `chebyshev(p,q) == manhattan(T(p), T(q)) / scale` with the correct scale. Provide starter code in all 3 languages.

- **Constraints:** integer coords; pick a transform/scale that keeps integers where possible.
- **Expected Output:** "conversion verified".
- **Evaluation:** correct transform direction (L∞→L1); correct scale handling.

---

## Advanced Tasks (5)

### Task 11 — Manhattan Minimum Spanning Tree

Implement the `O(n log n)` Manhattan MST using the 8-octant sweep (4 reflected passes + Fenwick suffix-min). Return the total tree weight. Provide starter code in all 3 languages. (Reference the full implementation in `senior.md`.)

#### Go

```go
// Starter: see senior.md for the full 4-pass + Fenwick implementation.
package main

import "fmt"

func manhattanMST(coords [][2]int) int {
	// 1) For each of 4 reflective orientations, sweep sorted by x+y,
	//    query Fenwick keyed on (x-y) for nearest in that octant.
	// 2) Collect <= 8n candidate edges.
	// 3) Sort by Manhattan weight, run Kruskal + DSU.
	// TODO: implement
	return 0
}

func main() { fmt.Println(manhattanMST([][2]int{{0, 0}, {2, 2}, {3, 10}, {5, 2}, {7, 0}})) }
```

#### Java

```java
// Starter: see senior.md for the full implementation.
public class Task11 {
    static int manhattanMST(int[][] coords) {
        // 4 passes -> Fenwick suffix-min on (x-y) sorted by (x+y) -> Kruskal
        return 0; // TODO
    }
    public static void main(String[] args) {
        System.out.println(manhattanMST(new int[][]{{0,0},{2,2},{3,10},{5,2},{7,0}}));
    }
}
```

#### Python

```python
# Starter: see senior.md for the full implementation.
def manhattan_mst(coords):
    # 4 passes -> Fenwick suffix-min on (x-y) sorted by (x+y) -> Kruskal + DSU
    return 0  # TODO

if __name__ == "__main__":
    print(manhattan_mst([(0, 0), (2, 2), (3, 10), (5, 2), (7, 0)]))
```

- **Constraints:** `n ≤ 2·10^5`; must be `O(n log n)`.
- **Expected Output:** correct MST weight (validate against `O(n²)` Kruskal on small inputs).
- **Evaluation:** correct octant sweep; `≤ 8n` candidate edges; Kruskal correctness.

### Task 12 — k-dimensional maximum L1 distance

Generalize Task 6 to `k` dimensions: the answer is the max over `2^{k-1}` sign patterns of the range of `Σ s_i · coord_i`. Provide starter code in all 3 languages.

- **Constraints:** `k ≤ 5`, `n ≤ 10^5`; complexity `O(2^{k-1} · n)`.
- **Expected Output:** matches `O(n²·k)` brute force on small inputs.
- **Evaluation:** correct sign-pattern enumeration (fix first sign `+`); 64-bit sums.

### Task 13 — Weighted 1-median on a grid

Each point has an integer demand weight `w_i`. Place one facility minimizing `Σ w_i · L1(p_i, c)`. Return the minimum total weighted distance. (Hint: weighted median per axis — the coordinate where cumulative weight first reaches half the total.)

- **Constraints:** `n ≤ 10^5`, weights up to `10^4`.
- **Expected Output:** correct weighted-median placement and cost.
- **Evaluation:** correct weighted median per axis; verify against brute force.

### Task 14 — Manhattan distance with diagonal moves allowed (cost game)

On an 8-connected grid, the minimum number of moves to a target with unit-cost diagonals is the Chebyshev distance. Now suppose diagonals cost `2` and straight moves cost `1`: derive and implement the minimum cost (it equals the Manhattan distance, since diagonals become strictly worse). Then implement the case where diagonals cost `1` and straights cost `1` (Chebyshev). Provide starter code in all 3 languages.

- **Constraints:** integer coords; reason about when each metric applies.
- **Expected Output:** correct cost for both cost models on test pairs.
- **Evaluation:** correct metric derivation per cost model.

### Task 15 — A* on a grid with the right heuristic

Implement A* on a 2-D grid with obstacles. Accept a movement model (`4-connected` or `8-connected`) and automatically select the admissible heuristic (Manhattan or Chebyshev). Return the optimal path cost. Provide starter code in all 3 languages.

- **Constraints:** grid up to `1000×1000`; heuristic must be admissible for the chosen model.
- **Expected Output:** optimal cost; using the wrong heuristic (intentionally) should demonstrably return a suboptimal/over-long path on a crafted test.
- **Evaluation:** correct heuristic selection; A* optimality; admissibility test passes.

---

## Benchmark Task

> Compare the `O(n)` rotation-based max-Manhattan-distance against the `O(n²)` brute force across input sizes, in all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func absI(x int) int { if x < 0 { return -x }; return x }

func bruteMax(pts [][2]int) int {
	best := 0
	for i := 0; i < len(pts); i++ {
		for j := i + 1; j < len(pts); j++ {
			d := absI(pts[i][0]-pts[j][0]) + absI(pts[i][1]-pts[j][1])
			if d > best { best = d }
		}
	}
	return best
}

func fastMax(pts [][2]int) int {
	const P = int(1 << 62)
	minU, maxU, minV, maxV := P, -P, P, -P
	for _, p := range pts {
		u, v := p[0]+p[1], p[0]-p[1]
		if u < minU { minU = u }
		if u > maxU { maxU = u }
		if v < minV { minV = v }
		if v > maxV { maxV = v }
	}
	ru, rv := maxU-minU, maxV-minV
	if ru > rv { return ru }
	return rv
}

func main() {
	for _, n := range []int{100, 1000, 4000} {
		pts := make([][2]int, n)
		for i := range pts { pts[i] = [2]int{rand.Intn(1e6), rand.Intn(1e6)} }
		t := time.Now(); bruteMax(pts); fmt.Printf("n=%5d brute %v\n", n, time.Since(t))
		t = time.Now(); fastMax(pts); fmt.Printf("n=%5d fast  %v\n", n, time.Since(t))
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    static int bruteMax(int[][] p) {
        int best = 0;
        for (int i = 0; i < p.length; i++)
            for (int j = i + 1; j < p.length; j++)
                best = Math.max(best, Math.abs(p[i][0]-p[j][0]) + Math.abs(p[i][1]-p[j][1]));
        return best;
    }
    static long fastMax(int[][] p) {
        long mU = Long.MAX_VALUE, MU = Long.MIN_VALUE, mV = Long.MAX_VALUE, MV = Long.MIN_VALUE;
        for (int[] q : p) {
            long u = (long) q[0] + q[1], v = (long) q[0] - q[1];
            mU = Math.min(mU, u); MU = Math.max(MU, u);
            mV = Math.min(mV, v); MV = Math.max(MV, v);
        }
        return Math.max(MU - mU, MV - mV);
    }
    public static void main(String[] args) {
        Random r = new Random();
        for (int n : new int[]{100, 1000, 4000}) {
            int[][] p = new int[n][2];
            for (int i = 0; i < n; i++) { p[i][0] = r.nextInt(1_000_000); p[i][1] = r.nextInt(1_000_000); }
            long t = System.nanoTime(); bruteMax(p);
            System.out.printf("n=%5d brute %.3f ms%n", n, (System.nanoTime()-t)/1e6);
            t = System.nanoTime(); fastMax(p);
            System.out.printf("n=%5d fast  %.3f ms%n", n, (System.nanoTime()-t)/1e6);
        }
    }
}
```

#### Python

```python
import random, time

def brute_max(pts):
    best = 0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            best = max(best, abs(pts[i][0]-pts[j][0]) + abs(pts[i][1]-pts[j][1]))
    return best

def fast_max(pts):
    us = [x + y for x, y in pts]
    vs = [x - y for x, y in pts]
    return max(max(us) - min(us), max(vs) - min(vs))

for n in (100, 1000, 4000):
    pts = [(random.randint(0, 10**6), random.randint(0, 10**6)) for _ in range(n)]
    t = time.time(); brute_max(pts); print(f"n={n:5d} brute {time.time()-t:.4f}s")
    t = time.time(); fast_max(pts);  print(f"n={n:5d} fast  {time.time()-t:.4f}s")
```

- **Expected observation:** brute force grows ~quadratically; the rotation stays effectively flat. By `n = 4000` the gap is large (thousands-fold at `n = 10^5`).
- **Evaluation:** both return identical maxima; timing curves confirm `O(n²)` vs `O(n)`.
