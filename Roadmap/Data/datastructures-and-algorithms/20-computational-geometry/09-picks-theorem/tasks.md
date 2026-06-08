# Pick's Theorem and Lattice-Point Geometry — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the core ideas from the rest of this topic: the **shoelace formula** (`2A` exact integer), the **gcd boundary trick** (`B = Σ gcd(|dx|,|dy|)`), and **Pick's theorem** (`I = (2A − B + 2)/2`).
> Hard rules throughout: every vertex must be a lattice point, the polygon must be simple, and the formula is 2-D only.

---

## Beginner Tasks (5)

### Task 1 — Shoelace twice-area

**Statement.** Given a simple polygon as an ordered list of integer vertices, return `2A` (twice the area) as an exact integer using the shoelace formula. The answer must be non-negative regardless of vertex orientation.

**Constraints.**
- `3 ≤ n ≤ 10^5` vertices.
- `|x|, |y| ≤ 10^9` → use 64-bit (or big integers) for products.
- Time `O(n)`.

**Hints.**
- `2A = |Σ (x_i·y_{i+1} − x_{i+1}·y_i)|` with indices wrapping via `(i+1) % n`.
- Keep the sum in `2A` form; do not divide by 2.

#### Go

```go
package main

import "fmt"

func twiceArea(xs, ys []int64) int64 {
	// implement here
	return 0
}

func main() {
	fmt.Println(twiceArea([]int64{0, 4, 0}, []int64{0, 0, 3})) // expect 12
}
```

#### Java

```java
public class Task1 {
    static long twiceArea(long[] xs, long[] ys) {
        // implement here
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(twiceArea(new long[]{0, 4, 0}, new long[]{0, 0, 3})); // 12
    }
}
```

#### Python

```python
def twice_area(pts):
    # implement here
    return 0


if __name__ == "__main__":
    print(twice_area([(0, 0), (4, 0), (0, 3)]))  # expect 12
```

- **Expected Output:** `12` for the triangle `(0,0),(4,0),(0,3)`.
- **Evaluation:** correctness, integer-only arithmetic, handles clockwise input.

---

### Task 2 — Boundary points of one segment

**Statement.** Given two lattice points `p` and `q`, return the number of lattice points strictly between them (exclusive of both endpoints).

**Constraints.**
- `|coords| ≤ 10^9`.
- Use `gcd(|dx|, |dy|) − 1`.

**Hints.**
- `gcd(|dx|,|dy|)` counts lattice points excluding one endpoint; subtract 1 more to exclude the other.
- `gcd(d, 0) = d`.

#### Go

```go
package main

import "fmt"

func pointsStrictlyBetween(x1, y1, x2, y2 int64) int64 {
	// implement here
	return 0
}

func main() {
	fmt.Println(pointsStrictlyBetween(0, 0, 4, 2)) // expect 1 (the point (2,1))
}
```

#### Java

```java
public class Task2 {
    static long pointsStrictlyBetween(long x1, long y1, long x2, long y2) {
        // implement here
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(pointsStrictlyBetween(0, 0, 4, 2)); // 1
    }
}
```

#### Python

```python
def points_strictly_between(p, q):
    # implement here
    return 0


if __name__ == "__main__":
    print(points_strictly_between((0, 0), (4, 2)))  # expect 1
```

- **Expected Output:** `1` (only `(2,1)`).
- **Evaluation:** correct gcd usage, handles axis-aligned segments.

---

### Task 3 — Total boundary count `B`

**Statement.** Given a simple lattice polygon, return the total number of boundary lattice points `B = Σ gcd(|dx_e|, |dy_e|)` over all edges.

**Constraints.**
- `3 ≤ n ≤ 10^5`.
- Each corner counted exactly once.

**Hints.**
- Loop over edges with `(i+1) % n`; sum the per-edge gcd.

#### Go

```go
package main

import "fmt"

func boundaryPoints(xs, ys []int64) int64 {
	// implement here
	return 0
}

func main() {
	fmt.Println(boundaryPoints([]int64{0, 4, 0}, []int64{0, 0, 3})) // expect 8
}
```

#### Java

```java
public class Task3 {
    static long boundaryPoints(long[] xs, long[] ys) {
        // implement here
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(boundaryPoints(new long[]{0, 4, 0}, new long[]{0, 0, 3})); // 8
    }
}
```

#### Python

```python
def boundary_points(pts):
    # implement here
    return 0


if __name__ == "__main__":
    print(boundary_points([(0, 0), (4, 0), (0, 3)]))  # expect 8
```

- **Expected Output:** `8`.
- **Evaluation:** no double-counted corners, `gcd(d,0)=d` handled.

---

### Task 4 — Interior count via Pick

**Statement.** Given a simple lattice polygon, return the number of interior lattice points `I` using Pick's theorem, in integer-exact form `I = (2A − B + 2)/2`.

**Constraints.**
- Combine Tasks 1 and 3.
- The numerator must be even for valid input.

**Hints.**
- `I = (twiceArea − boundary + 2) // 2`.

#### Go

```go
package main

import "fmt"

func interiorPoints(xs, ys []int64) int64 {
	// implement here (reuse twiceArea, boundaryPoints)
	return 0
}

func main() {
	fmt.Println(interiorPoints([]int64{0, 4, 0}, []int64{0, 0, 3})) // expect 3
}
```

#### Java

```java
public class Task4 {
    static long interiorPoints(long[] xs, long[] ys) {
        // implement here
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(interiorPoints(new long[]{0, 4, 0}, new long[]{0, 0, 3})); // 3
    }
}
```

#### Python

```python
def interior_points(pts):
    # implement here
    return 0


if __name__ == "__main__":
    print(interior_points([(0, 0), (4, 0), (0, 3)]))  # expect 3
```

- **Expected Output:** `3`.
- **Evaluation:** integer-exact, parity assumption documented.

---

### Task 5 — Verify Pick against a brute-force grid scan

**Statement.** For a small lattice polygon (bounding box ≤ `50×50`), compute `I` by Pick AND by scanning every grid cell with a point-in-polygon test, and assert the two match.

**Constraints.**
- Brute force is `O(W·H·n)`; only for tiny polygons.
- Use ray-casting or the cross-product winding test for point-in-polygon.

**Hints.**
- A point on the boundary should be excluded from the *interior* count.
- This is your correctness oracle for the rest of the topic.

#### Go

```go
package main

import "fmt"

func interiorBrute(xs, ys []int64) int64 {
	// scan bounding box; count strictly-interior lattice points
	return 0
}

func main() {
	xs := []int64{0, 4, 0}
	ys := []int64{0, 0, 3}
	fmt.Println(interiorBrute(xs, ys)) // expect 3 (matches Pick)
}
```

#### Java

```java
public class Task5 {
    static long interiorBrute(long[] xs, long[] ys) {
        // scan bounding box
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(interiorBrute(new long[]{0, 4, 0}, new long[]{0, 0, 3})); // 3
    }
}
```

#### Python

```python
def interior_brute(pts):
    # scan bounding box, strict point-in-polygon test
    return 0


if __name__ == "__main__":
    print(interior_brute([(0, 0), (4, 0), (0, 3)]))  # expect 3
```

- **Expected Output:** matches Pick's `I` (e.g. `3`).
- **Evaluation:** correct point-in-polygon, boundary excluded from interior.

---

## Intermediate Tasks (5)

### Task 6 — Lattice points inside a triangle

**Statement.** Given three lattice points, return the number of interior lattice points using `2A = |cross|` and the three-edge gcd boundary, then Pick.

**Hints.** `2A = |(bx−ax)(cy−ay) − (cx−ax)(by−ay)|`; `B = ` sum of three edge gcds.

Provide starter code in all 3 languages (signature `interiorInTriangle(ax,ay,bx,by,cx,cy)`), expected `3` for `(0,0),(4,0),(0,3)`.

### Task 7 — Solve for the missing quantity

**Statement.** Given any two of `{A, I, B}`, compute the third using Pick. Implement three functions: `areaFrom(I,B)`, `interiorFrom(A,B)`, `boundaryFrom(A,I)`.

**Hints.** `A = I + B/2 − 1`, `I = A − B/2 + 1`, `B = 2(A − I + 1)`. Work in `2A` form to stay integer.

Provide starter code in all 3 languages. Test: `A=6, B=8 → I=3`; `I=3, B=8 → A=6`; `A=6, I=3 → B=8`.

### Task 8 — Total lattice points (interior + boundary)

**Statement.** Given a simple lattice polygon, return `I + B = (2A + B + 2)/2` — every lattice point inside or on the polygon.

**Hints.** Compute `2A` and `B` once; `total = (2A + B + 2)//2`.

Provide starter code in all 3 languages. Test: triangle `(0,0),(4,0),(0,3)` → `11`.

### Task 9 — Polygon with one hole

**Statement.** Given an outer simple lattice polygon and one inner lattice-polygon hole, compute the material area using `A = I + B/2 − 1 + h` with `h = 1`. Return `(A, I, B)`.

**Hints.** `B` sums boundary points of *both* loops; `I` excludes points inside the hole. Use the hole-corrected formula.

Provide starter code in all 3 languages. Test: outer `4×4` square with a unit-square hole at its center.

### Task 10 — Validity / parity checker

**Statement.** Given a vertex list, return `true` only if `2A − B + 2` is even (a necessary condition for a valid simple lattice polygon). Use it to reject malformed input.

**Hints.** Reuse `2A` and `B`; check `(2A − B + 2) % 2 == 0`.

Provide starter code in all 3 languages. Test: valid triangle → `true`; an intentionally inconsistent `(I,B,A)` triple → `false`.

---

## Advanced Tasks (5)

### Task 11 — Overflow-safe big-integer Pick

**Statement.** Implement the full `(2A, B, I)` pipeline using big integers (Go `math/big`, Java `BigInteger`, Python native int), shifting vertices by `v₀` to shrink magnitudes. Must be exact for coordinates up to `10^{18}`.

**Hints.** Subtract the first vertex from all vertices before the shoelace sum; gcd stays on the un-shifted edge deltas. Parity-check the result.

Provide starter code in all 3 languages. Test: right triangle `(0,0),(10^{18},0),(0,10^{18})` returns exact counts.

### Task 12 — Ehrhart polynomial of a lattice polygon

**Statement.** Given a lattice polygon, return its 2-D Ehrhart polynomial coefficients `(A, B/2, 1)` so that `L(t) = A·t² + (B/2)·t + 1` counts lattice points in the `t`-dilation. Verify `L(1) = I + B`.

**Hints.** `A` and `B/2` come straight from shoelace and the boundary sum (keep `A` as a rational `2A/2`). Evaluate at `t=1,2,3` and cross-check against a brute-force scan of the dilated polygon.

Provide starter code in all 3 languages. Test: unit square coefficients `(1, 2, 1)` → `L(t) = t² + 2t + 1 = (t+1)²`.

### Task 13 — Lattice points under a line segment (floor-sum)

**Statement.** Count lattice points strictly below the segment from `(0,0)` to `(n, m)` and above the x-axis (a right-triangle lattice count), using Pick on the triangle `(0,0),(n,0),(n,m)` and cross-checking with a floor sum `Σ_{x=1}^{n-1} floor(m·x/n)`.

**Hints.** Pick gives the interior count directly; the floor sum is the number-theoretic identity (connected to the Stern–Brocot / Euclidean-like recursion).

Provide starter code in all 3 languages. Test: `(n,m) = (4,3)` → interior count `3`.

### Task 14 — Reeve tetrahedron demonstration

**Statement.** Implement a 3-D function that, for `r = 1..10`, computes the volume `r/6` of the Reeve tetrahedron `conv{(0,0,0),(1,0,0),(0,1,0),(1,1,r)}` and verifies its lattice-point counts are `I=0, B=4` for every `r`. Print a table demonstrating that constant `(I,B)` yields varying volume — i.e. that no Pick formula exists in 3-D.

**Hints.** Volume via the scalar triple product `/6`. Lattice-emptiness can be asserted (no need for a full scan at this scale) or verified by scanning the small bounding box.

Provide starter code in all 3 languages. Expected: a table where `I,B` are constant but volume = `1/6, 2/6, …, 10/6`.

### Task 15 — Robust lattice-measurement service

**Statement.** Build a function that takes a polygon, validates it (≥3 vertices, integer coords, parity), escalates to big integers when `2n·C²` risks 64-bit overflow, and returns `(A, I, B)` or a structured error. Fall back to a per-column lattice count when a vertex is non-integer.

**Hints.** Combine Tasks 10, 11, and a per-column counter. Decide the int64 threshold from `n` and the max coordinate.

Provide starter code in all 3 languages. Test: a mix of valid lattice polygons, an overflowing one (escalates), and an invalid one (errors or falls back).

---

## Benchmark Task

> Compare performance of the Pick pipeline across all 3 languages, and against a brute-force grid scan to show size-independence.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	sizes := []int{10, 100, 1000, 10000, 100000}
	for _, n := range sizes {
		// build an n-vertex simple lattice polygon (e.g. a staircase or fan)
		xs := make([]int64, n)
		ys := make([]int64, n)
		for i := 0; i < n; i++ {
			xs[i] = int64(i)
			ys[i] = int64((i * 7) % 1000)
		}
		start := time.Now()
		for r := 0; r < 100; r++ {
			_ = twiceArea(xs, ys) // from your Task 1 solution
		}
		fmt.Printf("n=%7d: %v\n", n, time.Since(start)/100)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10, 100, 1000, 10000, 100000};
        for (int n : sizes) {
            long[] xs = new long[n], ys = new long[n];
            for (int i = 0; i < n; i++) { xs[i] = i; ys[i] = (i * 7L) % 1000; }
            long start = System.nanoTime();
            for (int r = 0; r < 100; r++) Task1.twiceArea(xs, ys);
            System.out.printf("n=%7d: %.3f ms%n", n,
                    (System.nanoTime() - start) / 100.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import timeit


def make_polygon(n):
    return [(i, (i * 7) % 1000) for i in range(n)]


for n in [10, 100, 1_000, 10_000, 100_000]:
    pts = make_polygon(n)
    t = timeit.timeit(lambda: twice_area(pts), number=100)  # from Task 1
    print(f"n={n:>7}: {t / 100 * 1000:.3f} ms")
```

> **Observation to record:** Pick's cost grows with the *number of vertices*, not the polygon's *size*. A 3-vertex triangle spanning `10^9 × 10^9` runs as fast as one spanning `3 × 3`, while a brute-force grid scan on the former would need `10^{18}` cell tests — completely infeasible. That contrast is the whole point of Pick's theorem.
