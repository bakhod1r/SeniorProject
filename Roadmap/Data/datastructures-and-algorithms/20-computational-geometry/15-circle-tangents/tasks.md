# Circle Tangents — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Use `EPS = 1e-9` for floating-point comparisons. Prefer the **signed-distance** method (`a·x+b·y+c=0`, `a²+b²=1`) for common tangents so equal radii work.

---

## Beginner Tasks

**Task 1:** Implement `tangent_length(P, C, r)` returning `sqrt(d²−r²)`, or a "no tangent" sentinel when `P` is inside the circle (`d < r`). Handle the on-circle case (`d = r`) by returning `0`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

type Pt struct{ X, Y float64 }

const EPS = 1e-9

func tangentLength(p, c Pt, r float64) (float64, bool) {
	// implement here
	return 0, false
}

func main() {
	fmt.Println(tangentLength(Pt{5, 0}, Pt{0, 0}, 3)) // expect 4, true
	fmt.Println(tangentLength(Pt{1, 0}, Pt{0, 0}, 3)) // expect _, false (inside)
}
```

#### Java

```java
public class Task1 {
    static final double EPS = 1e-9;
    record Pt(double x, double y) {}

    static Double tangentLength(Pt p, Pt c, double r) {
        // implement here; return null if P is inside
        return null;
    }

    public static void main(String[] args) {
        System.out.println(tangentLength(new Pt(5,0), new Pt(0,0), 3)); // 4.0
        System.out.println(tangentLength(new Pt(1,0), new Pt(0,0), 3)); // null
    }
}
```

#### Python

```python
import math
EPS = 1e-9

def tangent_length(p, c, r):
    # implement here; return None if P is inside
    pass

if __name__ == "__main__":
    print(tangent_length((5, 0), (0, 0), 3))  # 4.0
    print(tangent_length((1, 0), (0, 0), 3))  # None
```

- **Constraints:** O(1); use `math.hypot`; guard `sqrt` with `max(0, ·)`.
- **Expected Output:** `4` for the external point; "no tangent" for the interior point.
- **Evaluation:** correctness, inside-check, on-circle edge case.

---

**Task 2:** Implement `touch_points(P, C, r)` returning the two touch-points of the tangents from external point `P`, using `φ = atan2(P.y−C.y, P.x−C.x)` and `θ = acos(clamp(r/d, −1, 1))`. Return an empty result if `P` is inside.

- Provide starter code in all 3 languages.
- Constraints: clamp the `acos` argument; verify each touch-point `T` satisfies `(T−C)·(T−P) ≈ 0` (perpendicularity).
- Expected for `P=(5,0), C=(0,0), r=3`: `(1.8, 2.4)` and `(1.8, −2.4)`.

---

**Task 3:** Implement `classify_pair(C1, r1, C2, r2)` returning one of the strings `"nested"`, `"internally_tangent"`, `"overlapping"`, `"externally_tangent"`, `"separate"` based on `d` vs `r1±r2`. Use an epsilon band for the tangent cases.

- Provide starter code in all 3 languages.
- Constraints: compare with `EPS`; do not assume `r1 ≥ r2` (use `abs(r1−r2)`).
- Expected: `(0,0,3),(10,0,2) → "separate"`; `(0,0,3),(4,0,2) → "overlapping"`; `(0,0,5),(3,0,2) → "internally_tangent"`.

---

**Task 4:** Implement `count_common_tangents(C1, r1, C2, r2)` returning the integer `0..4`. Reuse `classify_pair` from Task 3 to map each relationship to its count.

- Provide starter code in all 3 languages.
- Constraints: O(1); the mapping is nested→0, internally_tangent→1, overlapping→2, externally_tangent→3, separate→4.
- Expected: matches the five classification cases above giving `4, 2, 1`.

---

**Task 5:** Implement `point_circle_position(P, C, r)` returning `"inside"`, `"on"`, or `"outside"` using **squared** distances only (`|P−C|²` vs `r²`) — no `sqrt`. This is the exact predicate that decides whether tangents exist.

- Provide starter code in all 3 languages.
- Constraints: compare `dx*dx+dy*dy` to `r*r` with `EPS`; for integer inputs this is exact.
- Expected: `(5,0),(0,0),3 → "outside"`; `(3,0),(0,0),3 → "on"`; `(1,0),(0,0),3 → "inside"`.

---

## Intermediate Tasks

**Task 6:** Implement the full `common_tangents(C1, r1, C2, r2)` via the signed-distance method, returning each tangent as a normalized `(a, b, c)`. Loop over the four `(σ1, σ2)` sign-pairs; for each, eliminate `c` to get `a·Δ = g`, solve `a²+b²=1`, and recover `c`. Deduplicate at tangency.

- Provide starter code in all 3 languages.
- Constraints: `sqrt(max(0, d²−g²))`; `break` after the single line when `h≈0`; normalize sign canonically before dedup.
- Expected: 4 lines for separate circles, 2 for overlapping, etc. Validate `|a·Cᵢ + c| ≈ rᵢ` for both circles on every line.

---

**Task 7:** Extend Task 6 to label each tangent as `"external"` or `"internal"` by checking whether the two signed distances `sd(C1,ℓ)` and `sd(C2,ℓ)` have the **same** sign (external) or **opposite** sign (internal). Return `(a, b, c, kind)`.

- Provide starter code in all 3 languages.
- Constraints: classify *after* solving, not by the `σ` convention.
- Expected for `(0,0,3),(10,0,2)`: 2 external + 2 internal.

---

**Task 8:** Implement `touch_points_on_tangent(C1, r1, C2, r2)` that, for every common tangent, returns the touch-point on each circle as the foot of the perpendicular: `Tᵢ = Cᵢ − sd(Cᵢ,ℓ)·(a,b)`.

- Provide starter code in all 3 languages.
- Constraints: line must be normalized; verify `|Tᵢ − Cᵢ| ≈ rᵢ`.
- Expected: each tangent yields two touch-points, one per circle, both lying on the line.

---

**Task 9:** Implement `belt_length(C1, r1, C2, r2)` for an **external (open)** belt over two pulleys: `2·sqrt(d²−(r1−r2)²) + r1·α + r2·β` with `α = π + 2·asin((r1−r2)/d)`, `β = π − 2·asin((r1−r2)/d)`. Return `None`/error if the pulleys overlap (`d ≤ |r1−r2|`).

- Provide starter code in all 3 languages.
- Constraints: clamp the `asin` argument; handle equal radii (`α = β = π`, belt = `2d + r·2π`... check the wrap).
- Expected for `r1=r2=1, d=4`: two straight runs of length 4 each plus half-circle wraps summing to `2π`.

---

**Task 10:** Implement `tangents_from_point_via_polar(P, C, r)` using the **chord-of-contact** (polar) line `(P−C)·(X−C) = r²` intersected with the circle. Compare its touch-points to the `acos` method from Task 2 for a point very close to the circle (`d = r·1.0001`) and report which is more accurate.

- Provide starter code in all 3 languages.
- Constraints: the polar method should stay well-conditioned where `acos` degrades.
- Expected: both agree away from the circle; the polar method is steadier as `r/d → 1`.

---

## Advanced Tasks

**Task 11:** Build a **tangent-graph edge set** for `n` disc obstacles: for every disc pair compute the (up to 4) common tangents, keep each straight tangent segment that does **not** pass through any other disc's interior, and return the surviving segments with their lengths. Use a point-to-segment distance for the collision test.

- Provide starter code in all 3 languages.
- Constraints: `O(n²)` pairs; collision test against all other discs is `O(n)` each (or use a spatial index for bonus credit).
- Expected: a list of `(P, Q, length)` edges forming the straight part of the tangent graph.

---

**Task 12:** Implement a `dubins_CSC(start, goal, rho)` that, given start/goal poses `(x, y, heading)` and turning radius `rho`, computes the length of the **RSR** path: build the right-turn circle at each pose, take the relevant **external** common tangent, and total `arc1 + straight + arc2`. (Compute only RSR; extend to all six types for bonus.)

- Provide starter code in all 3 languages.
- Constraints: equal-radius circles (`rho` both) — use the signed-distance tangent, never homothety.
- Expected: a finite length for poses whose turning circles admit the external tangent.

---

**Task 13:** Implement `inscribed_tangent_circle(C1, r1, C2, r2)`-style problem: given two external circles, find a line tangent to both, then find the circle tangent to that line and to both circles (an Apollonius-flavored sub-problem). For this task, restrict to: given an external common tangent line `ℓ`, return the touch-points and the midpoint of the segment between them.

- Provide starter code in all 3 languages.
- Constraints: reuse Task 8's foot-of-perpendicular.
- Expected: touch-points on `ℓ` for both circles and their midpoint.

---

**Task 14:** Implement `count_common_tangents_exact(C1, r1, C2, r2)` for **integer** inputs using only integer arithmetic: compare `d² = Δx²+Δy²` against `(r1−r2)²` and `(r1+r2)²` with exact `int64`/`BigInteger` comparisons — no floating point. Return `0..4`.

- Provide starter code in all 3 languages.
- Constraints: no `sqrt`, no `double`; guard against overflow (use 64-bit or big integers for large coordinates).
- Expected: identical counts to Task 4 but provably exact for integer inputs.

---

**Task 15:** Implement a **property-based test harness** that generates random circle pairs and verifies, for the output of `common_tangents` (Task 6): (a) the count matches `count_common_tangents_exact` (Task 14) when inputs are integers; (b) every returned line is at distance `rᵢ` from each center within tolerance; (c) no two returned lines are duplicates. Run 10,000 random cases.

- Provide starter code in all 3 languages.
- Constraints: include degenerate generators (equal radii, tangent, concentric, nested) in the random mix.
- Expected: all assertions pass across 10,000 cases; report any failing seed.

---

## Benchmark Task

> Compare performance across all 3 languages: how many circle pairs per second can you fully solve (all common tangents) with the signed-distance method?

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		pairs := make([][4]float64, n)
		for i := range pairs {
			pairs[i] = [4]float64{rand.Float64()*20 - 10, rand.Float64()*20 - 10,
				rand.Float64()*3 + 0.5, rand.Float64()*3 + 0.5}
		}
		start := time.Now()
		total := 0
		for _, p := range pairs {
			total += len(CommonTangents(Pt{0, 0}, p[2], Pt{p[0], p[1]}, p[3]))
		}
		el := time.Since(start)
		fmt.Printf("n=%8d: %7.2f ms  (%d tangents)\n", n, float64(el.Microseconds())/1000.0, total)
	}
}
```

#### Java

```java
import java.util.concurrent.ThreadLocalRandom;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        var rnd = ThreadLocalRandom.current();
        for (int n : sizes) {
            long start = System.nanoTime();
            long total = 0;
            for (int i = 0; i < n; i++) {
                double x = rnd.nextDouble(-10, 10), y = rnd.nextDouble(-10, 10);
                double r1 = rnd.nextDouble(0.5, 3.5), r2 = rnd.nextDouble(0.5, 3.5);
                total += CommonTangents.commonTangents(
                    new CommonTangents.Pt(0,0), r1, new CommonTangents.Pt(x,y), r2).size();
            }
            long el = System.nanoTime() - start;
            System.out.printf("n=%8d: %7.2f ms  (%d)%n", n, el/1e6, total);
        }
    }
}
```

#### Python

```python
import random
import time

sizes = [1_000, 10_000, 100_000, 1_000_000]
for n in sizes:
    cases = [(random.uniform(-10, 10), random.uniform(-10, 10),
              random.uniform(0.5, 3.5), random.uniform(0.5, 3.5)) for _ in range(n)]
    start = time.perf_counter()
    total = sum(len(common_tangents((0, 0), r1, (x, y), r2)) for x, y, r1, r2 in cases)
    el = time.perf_counter() - start
    print(f"n={n:>8}: {el*1000:7.2f} ms  ({total} tangents)")
```

- **Goal:** confirm the per-pair work is constant (linear total in `n`); compare Go/Java/Python constants.
- **Evaluation:** correct totals, linear scaling, and a short note on where each language's overhead comes from (allocation of the result slice/list dominates).
