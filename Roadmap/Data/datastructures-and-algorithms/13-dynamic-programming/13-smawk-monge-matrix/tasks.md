# SMAWK Algorithm and Monge Matrices — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**, with identical outputs across all three on the same seeded inputs.
> The recurring theme: a **totally monotone** (Monge) matrix has a non-decreasing staircase of row minima, and SMAWK finds all of them in `O(n + m)`. Always validate against a brute-force `O(n·m)` oracle and assert the staircase before trusting SMAWK on large inputs.

---

## Beginner Tasks

**Task 1: Brute-force all row minima (the oracle).**
Given an `n × m` matrix `A` (materialized), return an array `argmin` where `argmin[i]` is the column of row `i`'s minimum (smallest column on ties).

#### Go

```go
package main

func bruteRowMinima(A [][]int64) []int {
	// for each row, scan all columns, keep the smallest column on ties
	return nil
}

func main() {
	// A = {{5,3,9,12},{6,4,7,10},{8,7,5,6},{11,10,8,6}} → [1 1 2 3]
}
```

#### Java

```java
public class Task1 {
    static int[] bruteRowMinima(long[][] A) {
        // scan every cell of every row
        return null;
    }
    public static void main(String[] args) { }
}
```

#### Python

```python
def brute_row_minima(A):
    # scan every cell of every row; strict < keeps smallest column
    pass

if __name__ == "__main__":
    pass
```

- **Constraints:** `O(n·m)`. Break ties toward the smaller column.
- **Expected Output:** for the matrix above, `[1, 1, 2, 3]`.
- **Evaluation:** correctness, tie-handling, empty/single-row/single-column cases.

**Task 2: Check the staircase property.**
Given the `argmin` array from Task 1, return `true` iff it is non-decreasing (`argmin[i] ≤ argmin[i+1]` for all `i`). This is the runtime symptom of total monotonicity.

- Provide starter code in all 3 languages.
- Constraints: `O(n)`. Return `false` on the first violation.
- Test on a deliberately non-monotone matrix and confirm it returns `false`.

**Task 3: Verify the Monge condition on a small matrix.**
Given a materialized `n × m` matrix, return `true` iff it satisfies the **local** quadrangle inequality `A[i][j] + A[i+1][j+1] ≤ A[i][j+1] + A[i+1][j]` for all adjacent `i, j`.

- Provide starter code in all 3 languages.
- Constraints: `O(n·m)`. This local check implies the full Monge condition.
- Confirm that a Monge matrix returns `true` and a hand-broken one returns `false`.

**Task 4: Implement the REDUCE step.**
Given rows, an ordered column list, and an entry function `f(i, j)`, return the surviving columns after REDUCE (`≤ #rows` of them). Use the stack mechanic.

- Provide starter code in all 3 languages.
- Constraints: `O(#columns)`. Push only while `stack.size < #rows`.
- Test: on the Task-1 matrix with all 4 rows and columns, REDUCE should drop column 0.

**Task 5: Squared-segment-sum cost via prefix sums.**
Write an `O(1)` cost function `cost(k, j) = (P[j] − P[k])²` for an array `a`, building prefix sums `P` once. Then build the implicit DP-matrix entry `A[j][k] = g[k] + cost(k, j)` with `+∞` for `k ≥ j`.

- Provide starter code in all 3 languages.
- Constraints: prefix sums `O(n)` once; each `cost` call `O(1)`; use 64-bit.
- Expected: for `a = [1,3,2,4]`, `cost(0,2) = (1+3)² = 16`, `cost(2,4) = (2+4)² = 36`.

---

## Intermediate Tasks

**Task 6: Full SMAWK row minima.**
Implement recursive SMAWK (REDUCE + INTERPOLATE) that returns `argmin[i]` for every row of a totally monotone matrix, given an `O(1)` entry function. Validate against the Task-1 oracle on random small Monge matrices.

- Provide starter code in all 3 languages.
- Constraints: `O(n + m)` entry accesses. Smallest-column tie-break.
- Expected: identical output to `brute_row_minima` on every Monge test matrix.

**Task 7: One DP layer via SMAWK.**
Given a previous-layer array `g` and the squared cost, compute the next layer `dp[j] = min_{k<j} ( g[k] + (P[j]−P[k])² )` for all `j`, using SMAWK over the implicit matrix.

- Provide starter code in all 3 languages.
- Constraints: `O(n)` per layer. Pad forbidden cells with `+∞`.
- Test: with `g = [0, ∞, ∞, ∞, ∞]` and `a = [1,3,2,4]`, layer 1 is `[·, 1, 16, 36, 100]`.

**Task 8: Minimum-cost K-partition.**
Partition `a` into exactly `K` contiguous segments minimizing `Σ (segment sum)²`, running each layer with SMAWK. Return the minimum cost.

- Provide starter code in all 3 languages.
- Constraints: `O(K·n)`. Roll two rows for `O(n)` memory.
- Expected: `a=[1,3,2,4], K=2 → 52`; `K=1 → 100`; `K=4 → 30`.

**Task 9: SMAWK vs divide-and-conquer agreement.**
Implement (or reuse) the `O(n log n)` divide-and-conquer row-minima fill (sibling topic `12`) and assert it produces the **same** argmins as SMAWK on random Monge matrices.

- Provide starter code in all 3 languages.
- Constraints: both must match the brute-force oracle and each other.
- Report which is faster at `n = 10^3, 10^4, 10^5`.

**Task 10: Reconstruct the partition.**
Extend Task 8 to also return the actual segment boundaries, by storing the argmin (optimal split) at each `(layer, j)` and backtracking from `(K, n)`.

- Provide starter code in all 3 languages.
- Constraints: `O(K·n)` extra memory for the argmin table.
- Test: recompute the reconstructed partition's cost and assert it equals the DP answer.

---

## Advanced Tasks

**Task 11: Optimal 1-D k-means (Ckmeans.1d.dp).**
Given sorted points `x` and `K`, partition into `K` contiguous clusters minimizing total within-cluster SSE, using SMAWK per layer with the Monge SSE cost `SSE(k,j) = (Σx²) − (Σx)²/(j−k)` (prefix sums of `x` and `x²`).

- Provide starter code in all 3 languages.
- Constraints: `O(K·n)` after an `O(n log n)` sort. Use floating point carefully (or scaled integers).
- Test: cluster `[1, 2, 3, 10, 11, 12]` into `K=2` → clusters `{1,2,3}` and `{10,11,12}`.

**Task 12: Negative-entry stress test.**
Build the squared-cost DP matrix for arrays containing **negative** values, run SMAWK *and* the brute-force oracle, and detect when they disagree (the cost is Monge only when `P` is monotone).

- Provide starter code in all 3 languages.
- Constraints: fuzz with random signed arrays; report the first disagreement.
- Deliverable: a short note explaining why negative entries can break the Monge property.

**Task 13: Online 1D/1D via monotone pointer.**
Solve `dp[j] = min_{k<j} ( dp[k] + (P[j]−P[k])² )` (a single self-referential row) where each `dp[j]` depends on earlier `dp[k]`. Use an online scheme (monotone-pointer / online CHT) — offline SMAWK does not apply because the matrix is defined online.

- Provide starter code in all 3 languages.
- Constraints: `O(n)` or `O(n log n)`; explain why offline SMAWK fails here.
- Test against an `O(n²)` brute force on small inputs.

**Task 14: Array-based `O(n + m)` SMAWK (no hash maps).**
Reimplement SMAWK using index arrays only (no `map`/`HashMap`/`dict`) so the constant factor is minimal, and benchmark it against the map-based version at `n = 10^6`.

- Provide starter code in all 3 languages.
- Constraints: strictly `O(n + m)`; avoid per-call allocations on the hot path.
- Report the speedup over the map-based implementation.

**Task 15: Benchmark — brute vs divide-and-conquer vs SMAWK.**
For one DP layer (squared cost), measure brute `O(n²)`, divide-and-conquer `O(n log n)`, and SMAWK `O(n + m)` across `n ∈ {10³, 10⁴, 10⁵, 10⁶}`. Report the crossover points and confirm SMAWK's near-linear scaling.

- Provide starter code in all 3 languages.
- Constraints: same seeded input across all three languages; do not time array generation; average ≥ 3 runs.
- Deliverable: a table of times and a note on the measured `n + m` vs `n log n` vs `n²` scaling, and on whether SMAWK's `log`-factor win over divide-and-conquer justified its complexity.

---

## Benchmark Task

> Compare one-layer row-minima performance across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		a := make([]int, n)
		for i := range a {
			a[i] = (i*1103515245 + 12345) & 0xffff // deterministic, non-negative
		}
		start := time.Now()
		// run one SMAWK layer on the squared-cost matrix here
		_ = a
		elapsed := time.Since(start)
		fmt.Printf("n=%8d: %.3f ms\n", n, float64(elapsed.Microseconds())/1000.0)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = (i * 1103515245 + 12345) & 0xffff;
            long start = System.nanoTime();
            // run one SMAWK layer here
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%8d: %.3f ms%n", n, elapsed / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import time

sizes = [1000, 10000, 100000, 1000000]
for n in sizes:
    a = [((i * 1103515245 + 12345) & 0xffff) for i in range(n)]
    start = time.perf_counter()
    # run one SMAWK layer on the squared-cost matrix here
    elapsed = time.perf_counter() - start
    print(f"n={n:>8}: {elapsed*1000:.3f} ms")
```

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Run the `O(n·m)` row-minima oracle on small inputs, diff entrywise, and only then trust SMAWK on large inputs.
- **Assert the staircase.** Build the brute-force argmins and confirm `argmin[i] ≤ argmin[i+1]`. A non-totally-monotone matrix gives a silent wrong answer.
- **Keep the entry `O(1)`.** Precompute prefix sums (and prefix sums of squares for SSE). An `O(n)` cost evaluation destroys the asymptotics.
- **Pad forbidden cells with `+∞`.** The DP matrix is upper-triangular (`k < j`); `+∞` keeps it totally monotone.
- **Break ties toward the smallest column.** Use strict `<` in the argmin so the staircase stays non-decreasing.
- **Roll two rows** for `O(n)` memory; keep the argmin table only when you must reconstruct cuts.
- **Mind overflow.** Squared/variance costs grow fast; use 64-bit (or wider) and `INF < MAX/2`; skip `∞` predecessors before adding.
- **Know your siblings and alternatives.** Divide-and-conquer (topic `12`) for a simpler `O(n log n)`, Knuth (topic `14`) for interval DPs, CHT (topic `10`) for linear costs, LARSCH for online 1D/1D.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
