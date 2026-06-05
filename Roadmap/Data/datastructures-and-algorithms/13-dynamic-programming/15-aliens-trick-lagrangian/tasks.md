# Aliens Trick (Lagrangian Relaxation) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Recurring tools: a **penalized DP** returning `(f(λ), count)`, a **binary search on `λ`**, a **target-`k` recovery** `f(λ) − λ·k`, and a **count-indexed `O(k·DP)` oracle** plus a **convexity check** for verification.

---

## Beginner Tasks

**Task 1: Penalized single-row partition DP.**
Implement `solve(a, λ)` that, for the squared-segment-sum cost `(P[j]−P[t])²`, returns `(f(λ), count)` where `f(λ) = min over any number of segments of ( total cost + λ·(#segments) )` and `count` is the number of segments on the optimal path (ties → **fewer** segments). Use a plain `O(n²)` DP.

#### Go

```go
package main

func solve(a []int, lambda int64) (int64, int) {
	// build prefix sums; DP g[j] = min_{t<j}(g[t] + (P[j]-P[t])^2 + lambda)
	// track cnt[j]; break ties toward fewer segments
	return 0, 0
}

func main() {
	// example: solve([]int{1,3,2,4}, 20) -> (92, 2)
}
```

#### Java

```java
public class Task1 {
    static long[] solve(int[] a, long lambda) {
        // return {f(lambda), count}
        return new long[]{0, 0};
    }
    public static void main(String[] args) {
        // solve({1,3,2,4}, 20) -> {92, 2}
    }
}
```

#### Python

```python
def solve(a, lam):
    # return (f(lam), count); ties -> fewer segments
    return 0, 0

if __name__ == "__main__":
    print(solve([1, 3, 2, 4], 20))  # (92, 2)
```

- **Constraints:** `1 ≤ n ≤ 2000`. Use 64-bit. Verify `solve([1,3,2,4], 20) == (92, 2)`.
- **Expected Output:** `(92, 2)`.
- **Evaluation:** correct penalty addition, count tracking, tie-break toward fewer.

**Task 2: Recover `opt(k)` from a known `λ`.**
Given `solve` from Task 1 and a `λ` you are told yields `count == k`, implement `recover(a, λ, k)` returning `f(λ) − λ·k`. Confirm `recover([1,3,2,4], 20, 2) == 52`.
- Provide starter code in all 3 languages.
- Constraints: `O(n²)` is fine. Emphasize subtracting `λ·k` with the **target** `k`.

**Task 3: Count-indexed brute-force oracle.**
Implement `opt_table(a)` returning `opt[k]` for all `k = 0..n` via the count-indexed DP `dp[i][j] = min_{t<j}(dp[i-1][t] + (P[j]-P[t])²)`, `opt[k] = dp[k][n]`. Use this as the ground truth for later tasks.
- Constraints: `1 ≤ n ≤ 300` (it is `O(n³)`/`O(k·n²)`).
- Expected: `opt_table([1,3,2,4])[2] == 52`.

**Task 4: Convexity checker.**
Using `opt_table` from Task 3, implement `is_convex(a)` that returns `True` iff the first differences `opt[k] − opt[k−1]` (over feasible `k`) are non-decreasing. Print the differences.
- Constraints: small `n`. Test on `[1,3,2,4]` and on a hand-made non-convex example.

**Task 5: Full Aliens search (integer `λ`).**
Combine Tasks 1, 2: implement `aliens(a, K)` that binary-searches the smallest `λ` with `count(λ) ≤ K` over `[0, (sum)²]`, then returns `f(λ) − λ·K`. Validate against `opt_table` for every `K`.
- Provide starter code in all 3 languages.
- Constraints: `1 ≤ n ≤ 2000`, `1 ≤ K ≤ n`. Expected: `aliens([1,3,2,4], k)` matches `opt_table[...][k]` for all `k`.

---

## Intermediate Tasks

**Task 6: CHT-accelerated penalized DP.**
Rewrite the penalized solver to `O(n)` using the **Convex Hull Trick**: expand `(P[j]−P[t])² = P[j]² − 2P[t]P[j] + P[t]²`, treat `−2P[t]·P[j] + (g[t]+P[t]²+λ)` as a line of slope `−2P[t]` queried at `x = P[j]` (queries are monotone since `P` is non-decreasing for non-negative inputs). Carry the segment count with each line.
- Provide starter code in all 3 languages.
- Constraints: `1 ≤ n ≤ 2·10^5`. Must match the `O(n²)` solver on random tests.

**Task 7: Maximization variant.**
Solve "partition into exactly `K` segments **maximizing** the sum of `(segment length)·(segment sum)`" (or another concave-`opt` objective you justify). Use **`−λ`** per segment, non-decreasing `cnt(λ)`, and recovery `f(λ) + λ·K`. Verify against a count-indexed oracle.
- Constraints: justify why `opt(k)` is concave for your chosen objective.

**Task 8: Collinear-edge handling.**
Construct an input (or objective) whose `opt(k)` has a **collinear stretch** so that `cnt(λ)` jumps over some target `k`. Show that the naive "find `λ` with `cnt == k`" search loops/fails, while the **boundary search + target-`k` recovery** returns the correct `opt(k)`. Print both behaviors.
- Provide starter code in all 3 languages.
- Constraints: include an assertion that target-`k` recovery equals the oracle's `opt[k]`.

**Task 9: At-most-`k`.**
Implement `at_most_k(a, K)` = `min_{c ≤ K} opt(c)` for the squared-segment-sum cost. Solve it via Aliens (search `λ ≥ 0`, take the boundary) and verify against `min(opt_table(a)[1..K])`.
- Constraints: `1 ≤ n ≤ 2000`. Discuss why, for convex `opt`, the minimum over `c ≤ K` is at `c = K` or the global min count.

**Task 10: Reconstruction of the cuts.**
Extend the Aliens solver to record the chosen predecessor at each `g[j]` (at the found `λ`) and reconstruct the actual segmentation. Note when the reconstructed count differs from `K` (collinear edge) and, if so, split/merge within the stretch to produce an exactly-`K` witness.
- Provide starter code in all 3 languages.
- Constraints: print the segments and assert they re-cost to `opt[K]`.

---

## Advanced Tasks

**Task 11: IOI-Aliens-style problem (max profit, exactly `k`).**
Model and solve a problem of the form "choose exactly `k` non-overlapping intervals from `n` candidates maximizing total profit," where the per-`k` DP is `O(k·n)` but the penalized DP (pay `−λ` per chosen interval) is `O(n)`. Implement Aliens + the `O(n)` inner DP and verify convexity of `opt(k)` empirically.
- Provide starter code in all 3 languages.
- Constraints: `n` up to `2·10^5`, `k` up to `n`. Total `O(n log(range))`.

**Task 12: Aliens + Divide & Conquer inner.**
For a **Monge** cost that does **not** factor into lines (e.g. within-segment SSE with a non-linear form, or a custom Monge cost), solve each penalized `f(λ)` with the **Divide & Conquer** recursion (sibling topic 12) in `O(n log n)`. Wrap it in the Aliens binary search.
- Constraints: `1 ≤ n ≤ 10^5`. Total `O(n log n · log(range))`. Verify against the `O(n²)` solver on small inputs.

**Task 13: Overflow-safe large inputs.**
Take `n = 2·10^5` with values up to `10^4`. Compute the worst-case magnitudes of `f(λ)` and `λ·K`, choose an appropriate integer type (`int64` vs big-int), and bound `hi` tightly (max single-segment cost). Demonstrate a case where a too-wide `hi` overflows `int64` during recovery and your tightened bound fixes it.
- Provide starter code in all 3 languages.
- Constraints: include the magnitude calculation as a comment; assert no overflow.

**Task 14: Real-`λ` version with tolerance.**
Solve a continuous-cost variant (non-integer `opt(k)`, e.g. a floating SSE objective) by binary-searching a `double` `λ` for a fixed ~80 iterations, stopping on iteration count (not on `cnt == k`), and rounding the recovered answer if it should be integral. Compare stability against the integer-`λ` version on integer inputs.
- Constraints: discuss catastrophic cancellation in SSE and use a stable/scaled-integer cost where possible.

**Task 15: Property-test battery + benchmark.**
Build a test harness that, for many random small inputs and all `k`, asserts: (a) `aliens(a,k) == opt_table(a)[k]` (value), (b) `opt_table` increments are non-decreasing (convexity), (c) recovery invariance (`f(λ1)−λ1·k == f(λ2)−λ2·k` for two valid `λ`), and (d) reconstructed cuts re-cost to `opt[k]`. Then benchmark the `O(n²)`-inner vs the CHT-inner Aliens across `n`.
- Provide starter code in all 3 languages.
- Constraints: the harness must catch a deliberately introduced non-convex objective and a deliberately wrong recovery (using the probed count instead of `k`).

---

## Benchmark Task

> Compare performance of the `O(n²)`-inner Aliens against the `O(n)` CHT-inner Aliens across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func aliensQuadratic(a []int, K int) int64 { /* O(n^2) inner */ return 0 }
func aliensCHT(a []int, K int) int64       { /* O(n) inner   */ return 0 }

func main() {
	sizes := []int{1000, 2000, 5000, 10000, 20000}
	for _, n := range sizes {
		data := make([]int, n)
		for i := range data {
			data[i] = (i*7919 + 13) % 1000
		}
		K := n / 2
		start := time.Now()
		aliensCHT(data, K)
		fmt.Printf("n=%6d (CHT): %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
public class Benchmark {
    static long aliensQuadratic(int[] a, int K) { return 0; } // O(n^2) inner
    static long aliensCHT(int[] a, int K) { return 0; }       // O(n) inner

    public static void main(String[] args) {
        int[] sizes = {1000, 2000, 5000, 10000, 20000};
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = (i * 7919 + 13) % 1000;
            int K = n / 2;
            long start = System.nanoTime();
            aliensCHT(data, K);
            System.out.printf("n=%6d (CHT): %.3f ms%n", n, (System.nanoTime() - start) / 1e6);
        }
    }
}
```

#### Python

```python
import timeit


def aliens_quadratic(a, K):  # O(n^2) inner
    return 0


def aliens_cht(a, K):        # O(n) inner
    return 0


if __name__ == "__main__":
    for n in [1000, 2000, 5000, 10000, 20000]:
        data = [(i * 7919 + 13) % 1000 for i in range(n)]
        K = n // 2
        t = timeit.timeit(lambda: aliens_cht(data, K), number=3)
        print(f"n={n:>6} (CHT): {t / 3 * 1000:.3f} ms")
```

> **What to observe:** the CHT-inner version is `O(n log(range))` — roughly linear in `n` with a small `log(range)` constant and **no `K` factor** — while the `O(n²)`-inner version grows quadratically and the count-indexed baseline grows as `O(K·n…)`. Plot runtime vs `n` for both and confirm the `K`-independence of the Aliens approach by also varying `K` at fixed `n`.
