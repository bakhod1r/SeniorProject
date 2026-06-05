# Divide and Conquer DP Optimization — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the divide-and-conquer fill (the `compute(l, r, optL, optR)` recursion) and validate against the evaluation criteria.
> **Always test against a brute-force `O(K·n²)` oracle on small inputs, and assert the brute-force `opt` table is non-decreasing, before trusting the divide-and-conquer result.**

---

## Beginner Tasks (5)

### Task 1 — Single row fill via compute(l, r, optL, optR)

**Problem.** Given the previous-layer values `dpPrev[0..n]` and a cost function `C(k, j) = (P[j] − P[k])²` (squared segment sum, `P` the prefix-sum array), fill `dpCur[0..n]` where `dpCur[j] = min over k < j of ( dpPrev[k] + C(k, j) )` using the `compute` recursion. This is one DP layer.

**Input / Output spec.**
- Read `n`, then the array `a` (`n` ints), then `dpPrev` (`n+1` longs).
- Print `dpCur[0..n]` space-separated.

**Constraints.** `1 ≤ n ≤ 1000`, `0 ≤ a[i] ≤ 10^4`. (Small `n` so you can diff against the naive scan.)

**Hint.** `compute(0, n, 0, n)`; scan `k ∈ [optL, min(optR, mid-1)]`; recurse left `[optL, bestK]`, right `[bestK, optR]`.

**Starter — Go.**
```go
package main

import "fmt"

const INF = int64(1) << 62

var prefix, dpPrev, dpCur []int64

func cost(k, j int) int64 { s := prefix[j] - prefix[k]; return s * s }

func compute(l, r, optL, optR int) {
	// TODO: divide-and-conquer fill of dpCur[l..r]
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int64, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	prefix = make([]int64, n+1)
	for i := 0; i < n; i++ {
		prefix[i+1] = prefix[i] + a[i]
	}
	dpPrev = make([]int64, n+1)
	for i := range dpPrev {
		fmt.Scan(&dpPrev[i])
	}
	dpCur = make([]int64, n+1)
	for i := range dpCur {
		dpCur[i] = INF
	}
	compute(0, n, 0, n)
	for i, v := range dpCur {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final long INF = 1L << 62;
    static long[] prefix, dpPrev, dpCur;

    static long cost(int k, int j) { long s = prefix[j] - prefix[k]; return s * s; }

    static void compute(int l, int r, int optL, int optR) {
        // TODO
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        dpPrev = new long[n + 1];
        for (int i = 0; i <= n; i++) dpPrev[i] = sc.nextLong();
        dpCur = new long[n + 1];
        Arrays.fill(dpCur, INF);
        compute(0, n, 0, n);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i <= n; i++) { if (i > 0) sb.append(' '); sb.append(dpCur[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys

INF = 1 << 62


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    a = [int(next(data)) for _ in range(n)]
    prefix = [0] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] + a[i]
    dp_prev = [int(next(data)) for _ in range(n + 1)]
    dp_cur = [INF] * (n + 1)

    def cost(k, j):
        s = prefix[j] - prefix[k]
        return s * s

    def compute(l, r, opt_l, opt_r):
        pass  # TODO

    compute(0, n, 0, n)
    print(" ".join(map(str, dp_cur)))


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    main()
```

**Evaluation criteria.**
- `dpCur` matches the naive `O(n²)` scan exactly.
- Scans only `[optL, min(optR, mid-1)]` per call.
- Recurses with the narrowed windows `[optL, bestK]` and `[bestK, optR]`.

---

### Task 2 — Partition into K segments minimizing sum of squared sums

**Problem.** Given `a` (`n` ints) and `K`, split into exactly `K` contiguous non-empty segments minimizing the total of `(segment sum)²`. Output the minimum cost. Use divide-and-conquer over `K` layers.

**Input / Output spec.**
- Read `n`, `K`, then `a`.
- Print the minimum total cost.

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`, `0 ≤ a[i] ≤ 10^4`.

**Hint.** Base case `dp[0][0] = 0`, else `+∞`. Loop `K` layers, each calling `compute(0, n, 0, n)`. Roll two rows.

**Reference oracle (Python) — validate with this.**
```python
def brute_partition(a, K):
    INF = 1 << 62
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x
    dp = [[INF] * (n + 1) for _ in range(K + 1)]
    dp[0][0] = 0
    for i in range(1, K + 1):
        for j in range(1, n + 1):
            for k in range(j):
                if dp[i - 1][k] < INF:
                    dp[i][j] = min(dp[i][j], dp[i - 1][k] + (pre[j] - pre[k]) ** 2)
    return dp[K][n]
```

**Evaluation criteria.**
- Matches `brute_partition` for small `n`, `K`.
- `K = 1` gives `(Σa)²`; `K = n` gives `Σ a[i]²`.
- `O(K n log n)`.

---

### Task 3 — Verify monotonicity of opt empirically

**Problem.** Given `a`, `K`, and a cost function, build the brute-force `opt` table and return `true` iff `opt[i][j-1] ≤ opt[i][j]` for every layer `i` and column `j` (i.e. divide-and-conquer is applicable).

**Input / Output spec.**
- Read `n`, `K`, then `a`. Use cost `C(k, j) = (P[j] − P[k])²`.
- Print `true` or `false`.

**Constraints.** `1 ≤ K ≤ n ≤ 300`.

**Hint.** Compute `dp` and `opt` with the naive `O(K n²)` fill, breaking ties toward the smaller `k`. Then scan the `opt` table for any decrease.

**Worked check.** For the squared cost, the answer is always `true` (it is Monge). Construct a deliberately non-Monge cost (e.g. `C(k, j) = −(P[j] − P[k])²`) to see the check return `false`.

**Evaluation criteria.**
- Returns `true` for the squared (Monge) cost.
- Returns `false` for a constructed non-Monge cost.
- Ties broken toward the smaller `k` in the oracle.

---

### Task 4 — K = 1 and K = n sanity cases

**Problem.** Using your Task 2 solver, verify the two trivial layer counts: `K = 1` must give `C(0, n) = (Σa)²`, and `K = n` must give `Σ a[i]²` (each element its own segment). Output both values.

**Input / Output spec.**
- Read `n`, then `a`.
- Print two numbers: the `K=1` cost and the `K=n` cost.

**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ a[i] ≤ 10^4`.

**Hint.** No special-casing needed if the recursion and base case are right; just call the solver with `K=1` and `K=n`. Confirm the split ranges allow `k = j-1` when `K = n`.

**Evaluation criteria.**
- `K=1` result equals `(Σa)²`.
- `K=n` result equals `Σ a[i]²`.
- Both produced by the same general solver (no hard-coding).

---

### Task 5 — Reconstruct the optimal cuts

**Problem.** Extend Task 2 to also output the segment boundaries of an optimal partition. Record `opt[i][mid]` inside `compute`, then backtrack from `(K, n)`.

**Input / Output spec.**
- Read `n`, `K`, then `a`.
- Print the minimum cost, then the list of segments `[k, j)` in left-to-right order.

**Constraints.** `1 ≤ K ≤ n ≤ 10^4`.

**Hint.** Keep the full `opt[i][j]` table (`O(K n)` memory). Backtrack: `k = opt[i][j]`, emit `[k, j)`, set `j = k`, `i -= 1`, repeat.

**Evaluation criteria.**
- The reported segments re-sum to the reported cost.
- Segments are contiguous, non-empty, and cover `[0, n)`.
- Exactly `K` segments are emitted.

---

## Intermediate Tasks (5)

### Task 6 — Optimal 1-D k-means (minimum total within-segment SSE)

**Problem.** Partition `n` **sorted** real numbers into `K` contiguous clusters minimizing total within-cluster sum of squared deviations from each cluster mean. Output the minimum SSE.

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`, values in `[−10^6, 10^6]`.

**Hint.** `C(k, j) = (Σx²) − (Σx)²/(j−k)` via prefix sums of `x` and `x²`. Monge cost → divide-and-conquer. Use `double`; mind floating-point comparison (`<` is fine for argmin).

**Reference oracle (Python).**
```python
def brute_kmeans(x, K):
    INF = float("inf")
    n = len(x)
    p1 = [0.0] * (n + 1); p2 = [0.0] * (n + 1)
    for i, v in enumerate(x):
        p1[i + 1] = p1[i] + v
        p2[i + 1] = p2[i] + v * v
    def cost(k, j):
        c = j - k
        s = p1[j] - p1[k]
        return (p2[j] - p2[k]) - s * s / c
    dp = [[INF] * (n + 1) for _ in range(K + 1)]
    dp[0][0] = 0.0
    for i in range(1, K + 1):
        for j in range(1, n + 1):
            for k in range(j):
                if dp[i - 1][k] < INF:
                    dp[i][j] = min(dp[i][j], dp[i - 1][k] + cost(k, j))
    return dp[K][n]
```

**Evaluation criteria.**
- Matches `brute_kmeans` within `1e-6` for small inputs.
- `K = n` gives SSE `= 0`.
- `O(K n log n)`.

---

### Task 7 — Minimum cost to split into K segments with "length penalty"

**Problem.** Split `a` into `K` contiguous segments; a segment `[k, j)` costs `(P[j] − P[k]) · (j − k)` (sum times length). Minimize the total. First verify this cost is Monge (Task 3), then solve with divide-and-conquer.

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`, `0 ≤ a[i] ≤ 10^4`.

**Hint.** Compute `C(k, j)` in `O(1)` from prefix sums. Confirm monotonicity empirically before trusting the fast version; if it fails, the technique does not apply for this cost on this input.

**Evaluation criteria.**
- Empirical monotonicity check passes (or the task reports the cost as inapplicable with justification).
- Matches the brute-force oracle for small inputs.
- `O(K n log n)` when applicable.

---

### Task 8 — At-most-K segments (best over 1..K layers)

**Problem.** Split `a` into **at most** `K` contiguous segments (squared-sum cost), minimizing total cost. Since more segments can only lower the squared-sum cost, the answer is `dp[K][n]`; but implement it generally by taking `min over i in 1..K of dp[i][n]` so the same code handles costs where more segments are not always better.

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`.

**Hint.** Keep each layer's `dp[i][n]` as you go and take the running minimum. Do not roll away a row whose `[n]` you still need, or capture it before swapping.

**Evaluation criteria.**
- Returns `min_{1 ≤ i ≤ K} dp[i][n]`.
- For squared-sum cost, equals `dp[K][n]`.
- Matches brute force for small inputs.

---

### Task 9 — Explicit-stack compute (no recursion)

**Problem.** Reimplement the `compute` fill using an explicit stack of `(l, r, optL, optR)` frames instead of recursion, so it works for `n = 10^6` without stack-depth limits. Solve Task 2 with it.

**Constraints.** `1 ≤ K ≤ 200`, `1 ≤ n ≤ 10^6`, `0 ≤ a[i] ≤ 10^4`.

**Hint.** Push `(0, n, 0, n)`; pop a frame, resolve `mid`, push the two child frames. Functionally identical to the recursion.

**Evaluation criteria.**
- No recursion in the fill.
- Matches the recursive version on shared inputs.
- Completes `n = 10^6`, `K = 200` within the time limit.

---

### Task 10 — Count split-point evaluations (measure the speedup)

**Problem.** Instrument both the naive `O(n²)` fill and the divide-and-conquer fill to count how many `(k, mid)` cost evaluations each performs for one layer. Report both counts for `n ∈ {100, 1000, 10000}` and confirm the divide-and-conquer count is `O(n log n)`.

**Constraints.** `1 ≤ n ≤ 10^4` (so the naive count is feasible).

**Hint.** Increment a counter at each `cost(k, mid)` call. Naive should be `≈ n²/2`; divide-and-conquer should be `≈ c · n log₂ n` for a small constant `c`.

**Evaluation criteria.**
- Naive count ≈ `n(n+1)/2`.
- D&C count grows like `n log n`, far below `n²` for large `n`.
- Both fills produce identical `dpCur`.

---

## Advanced Tasks (5)

### Task 11 — SMAWK linear-time row fill

**Problem.** Replace the `O(n log n)` divide-and-conquer per-layer fill with the SMAWK algorithm, achieving `O(n)` per layer for the totally-monotone cost matrix `M[k][j] = dpPrev[k] + C(k, j)`. Solve Task 2 in `O(K n)`.

**Constraints.** `1 ≤ K ≤ 500`, `1 ≤ n ≤ 10^6`.

**Hint.** SMAWK alternates REDUCE (discard rows that can never be a column minimum) and INTERPOLATE (recurse on even columns, fill odd). Handle the `k < j` staircase by padding impossible entries with `+∞`. Validate against the divide-and-conquer version entrywise.

**Evaluation criteria.**
- Matches the divide-and-conquer result on all shared inputs.
- Per layer is `O(n)` (measurably faster than `O(n log n)` for large `n`).
- Correctly handles the `k < j` restriction.

---

### Task 12 — Maximization variant (anti-Monge / inverse quadrangle)

**Problem.** Split `a` into `K` segments to **maximize** the total of `(segment sum)²` — wait, that is trivially achieved by one segment. Instead, maximize the total of a concave per-segment reward `R(k, j) = (P[j] − P[k])^{0.5}` (square root of segment sum), which satisfies the **inverse** quadrangle inequality, giving a non-decreasing argmax. Implement the `max` version of divide-and-conquer.

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`, `0 ≤ a[i] ≤ 10^4`.

**Hint.** Use `max` in `compute`, identity `−INF` off the optimum, and keep the smallest tying `k`. Verify the argmax is non-decreasing empirically (inverse-Monge cost). Use `double`.

**Evaluation criteria.**
- Matches a brute-force `max` oracle for small inputs.
- Empirical monotonicity (of argmax) check passes for the concave reward.
- Documents the inverse-quadrangle condition in a comment.

---

### Task 13 — CHT cross-check on the squared cost

**Problem.** The squared-segment-sum cost `(P[j] − P[k])²` expands to a line in `P[j]`, so the Convex Hull Trick (sibling `10`) also applies. Implement *both* the divide-and-conquer solver and a CHT solver for Task 2, and assert they produce identical results across random inputs.

**Constraints.** `1 ≤ K ≤ 200`, `1 ≤ n ≤ 10^5`.

**Hint.** For CHT, each predecessor `k` is a line with slope `−2 P[k]` and intercept `dpPrev[k] + P[k]²`; query at `P[j]`, add `P[j]²` after. With monotone slopes and queries, the hull is `O(n)` per layer.

**Evaluation criteria.**
- D&C and CHT agree on all random inputs.
- CHT per layer is `O(n)` (monotone case); D&C is `O(n log n)`.
- A short note explains why both apply (the cost is simultaneously Monge and linear in `P[j]`).

---

### Task 14 — Hirschberg-style reconstruction in O(n) memory

**Problem.** Reconstruct the optimal `K`-segment partition (Task 5) using only `O(n)` memory (not the full `O(K n)` `opt` table), via divide-and-conquer over the layers. Useful when both `K` and `n` are large.

**Constraints.** `1 ≤ K ≤ 1000`, `1 ≤ n ≤ 10^5`, `K · n` too large to store the `opt` table comfortably.

**Hint.** Recursively: solve the first `K/2` layers forward and the last `K/2` layers backward, find the best meeting column `m`, record it, then recurse on `(left K/2, [0, m])` and `(right K/2, [m, n])`. Memory `O(n)`, time `O(K n log n)` (extra `log` from the layer recursion).

**Evaluation criteria.**
- Reconstructs a valid optimal partition using `O(n)` working memory.
- Segments re-sum to the optimal cost.
- Matches the full-`opt`-table reconstruction's cost (the partition may differ if there are ties, but the cost must match).

---

### Task 15 — Classify which optimization applies

**Problem.** Given a problem description with its recurrence shape and cost structure, classify which optimization to use. Implement `classify(shape, cost_kind)` returning one of: `DIVIDE_CONQUER`, `KNUTH`, `CHT`, `SMAWK`, `NAIVE`, or `INAPPLICABLE` (non-monotone optimum). Justify each.

**Constraints / cases to handle.**
- Layered `dp[i-1][k] + C(k,j)`, Monge `C`, large `n` → `DIVIDE_CONQUER` (or `SMAWK` if `O(n)` needed).
- Layered with linear cost `dp[k] + a[k]·x[j]` → `CHT`.
- Interval `dp[i][k] + dp[k][j] + C(i,j)`, Monge + monotone → `KNUTH`.
- Layered, non-Monge cost, small `n` → `NAIVE`.
- Cost provably non-monotone optimum, no structure → `INAPPLICABLE`.

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. Recurrence shape decides Knuth vs the layered family; cost structure (linear vs general Monge) decides CHT vs divide-and-conquer.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The `INAPPLICABLE` branch cites the non-monotone-optimum reason.
- Justifications reference the right complexity (`O(K n log n)`, `O(K n)`, `O(n²)`, `O(n)`, `O(K n²)`).

---

## Benchmark Task

### Task B — Naive O(n²) vs Divide-and-Conquer crossover

**Problem.** Empirically find the `n` at which divide-and-conquer overtakes the naive `O(n²)` fill for one DP layer, on a random array (fixed seed). Implement two workloads:

- **(a) Naive layer fill:** for each `j`, scan all `k < j` — `O(n²)`.
- **(b) Divide-and-conquer layer fill:** `compute(0, n, 0, n)` — `O(n log n)`.

Measure wall-clock time for `n ∈ {100, 1000, 10000, 100000, 1000000}` (use the huge `n` only for the divide-and-conquer method). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time
from typing import List

INF = 1 << 62


def gen_prefix(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    pre = [0] * (n + 1)
    for i in range(n):
        pre[i + 1] = pre[i] + r.randint(0, 10_000)
    return pre


def gen_dp_prev(n: int) -> List[int]:
    dp = [INF] * (n + 1)
    dp[0] = 0
    return dp


def naive_fill(prefix, dp_prev):
    n = len(prefix) - 1
    dp = [INF] * (n + 1)
    for j in range(1, n + 1):
        best = INF
        for k in range(j):
            if dp_prev[k] < INF:
                s = prefix[j] - prefix[k]
                best = min(best, dp_prev[k] + s * s)
        dp[j] = best
    return dp


def dc_fill(prefix, dp_prev):
    # TODO: divide-and-conquer compute(0, n, 0, n); O(n log n)
    n = len(prefix) - 1
    return [INF] * (n + 1)


def bench(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n            naive_ms          dc_ms")
    for n in [100, 1000, 10_000, 100_000, 1_000_000]:
        prefix = gen_prefix(n, 42)
        dp_prev = gen_dp_prev(n)
        rb = [bench(dc_fill, prefix, dp_prev) for _ in range(3)]
        if n <= 10_000:
            ra = [bench(naive_fill, prefix, dp_prev) for _ in range(3)]
            print(f"{n:<12d} {mean_ms(ra):<17.2f} {mean_ms(rb):<14.2f}")
        else:
            print(f"{n:<12d} {'(skipped)':<17} {mean_ms(rb):<14.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same prefix array across Go, Java, and Python.
- Naive (a) wins for tiny `n`; divide-and-conquer (b) wins as `n` grows. Report the crossover `n`.
- Divide-and-conquer completes `n = 10^6` in well under a second; naive is infeasible there.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on the measured crossover and how it compares to the theoretical `n log n` vs `n²`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every task references a slow `O(K n²)` oracle. Run it on small `n` and `K`, diff entrywise, and only then trust divide-and-conquer on large `n`.
- **Assert monotonicity of `opt`.** Before applying the technique to any cost, build the brute-force `opt` table and confirm `opt[i][j-1] ≤ opt[i][j]`. A non-Monge cost gives a silent wrong answer.
- **Keep `C(k, j)` `O(1)`.** Precompute prefix sums (and prefix sums of squares for SSE). An `O(n)` cost evaluation destroys the asymptotics.
- **Clamp the split range.** `hi = min(optR, mid - 1)` enforces a non-empty last segment; forgetting it admits a bogus empty segment.
- **Break ties toward the smallest `k`.** Use strict `<` in the argmin; this keeps the recursion windows valid and reconstruction deterministic.
- **Roll two rows** for `O(n)` memory; keep the `opt` table only when you must reconstruct cuts.
- **Mind overflow.** Squared/variance costs grow fast; use 64-bit (or wider) and a sentinel `INF` comfortably below the type max. Skip `INF` predecessors before adding.
- **Know your siblings.** Knuth (topic 12) for interval DPs, CHT (topic 10) for linear costs, SMAWK for linear-time column minima.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
