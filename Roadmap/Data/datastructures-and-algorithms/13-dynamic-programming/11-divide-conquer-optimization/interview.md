# Divide and Conquer DP Optimization — Interview Preparation

Divide-and-conquer DP optimization is a favourite mid-to-senior interview topic because it rewards a single crisp insight — *"when the optimal split `opt(i, j)` is monotone, fill the row with a divide-and-conquer recursion"* — and then tests whether you can (a) recognize the DP shape `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k, j) )`, (b) justify monotonicity via the quadrangle/Monge inequality, (c) write the `compute(l, r, optL, optR)` recursion correctly (windows and tie-breaks), and (d) distinguish it from its siblings Knuth (topic 12) and CHT (topic 10). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| DP shape this optimizes | layered `dp[i-1][k] + C(k, j)` | — |
| Optimal split monotone? | `opt(i, j) ≤ opt(i, j+1)` | — |
| Sufficient condition | quadrangle / Monge inequality on `C` | — |
| Fill one row | `compute(l, r, optL, optR)` | `O(n log n)` |
| Full DP, `K` layers | divide-and-conquer per layer | `O(K n log n)` |
| Interval DP `dp[i][k]+dp[k][j]` | **Knuth** (topic 12), two-sided bound | `O(n²)` |
| Linear cost `dp[k] + a[k]·x[j]` | **CHT** (topic 10), line envelope | `O(n)`–`O(n log n)` |
| All column minima in linear time | **SMAWK** (totally monotone matrix) | `O(n)` per layer |

The quadrangle (Monge) inequality:

```text
C(a, c) + C(b, d)  ≤  C(a, d) + C(b, c)      for all  a ≤ b ≤ c ≤ d
local form:  C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)
```

Core recursion:

```text
compute(l, r, optL, optR):
    if l > r: return
    mid = (l + r) / 2
    best = +INF; bestK = optL
    for k in [optL, min(optR, mid-1)]:        # k < mid (non-empty last segment)
        v = dp_prev[k] + C(k, mid)
        if v < best: best = v; bestK = k       # strict <, keep smallest k
    dp_cur[mid] = best
    compute(l, mid-1, optL, bestK)             # left: optima in [optL, bestK]
    compute(mid+1, r, bestK, optR)             # right: optima in [bestK, optR]
# one row O(n log n); total O(K n log n)
```

Key facts:
- Needs only **one-sided** monotonicity (Knuth needs two-sided).
- Quadrangle inequality on `C` ⟹ monotone `opt` ⟹ recursion is correct.
- Break ties toward the **smallest `k`**.
- Keep `C(k, j)` `O(1)` (prefix sums), else the asymptotics inflate.
- If `opt` is **not** monotone, the answer is silently wrong.

---

## Junior Questions (12 Q&A)

### J1. What DP shape does this optimize?
The layered partition recurrence `dp[i][j] = min over k < j of ( dp[i-1][k] + C(k, j) )`, where `i` is the number of segments, `j` the prefix length, `k` the split point, and `C(k, j)` the cost of the last segment `[k, j)`.

### J2. What is `opt(i, j)`?
The split point `k` that achieves the minimum for `dp[i][j]` — the argmin. If several `k` tie, we take the smallest by convention.

### J3. What property makes the optimization work?
Monotonicity of the optimal split: `opt(i, j) ≤ opt(i, j+1)`. As the right boundary `j` moves right, the best split point never moves left.

### J4. What is the time complexity, naive vs optimized?
Naive: `O(K n²)` (each of `n` columns scans up to `n` splits, over `K` layers). Optimized: `O(K n log n)` (each row filled by a divide-and-conquer recursion in `O(n log n)`).

### J5. Why is one row `O(n log n)`?
The recursion does `O(n)` total split-scanning work per level (the windows for the two halves overlap at one point) and there are `O(log n)` levels — the same accounting as merge sort.

### J6. What does `compute(l, r, optL, optR)` do?
It fills DP columns `l..r`, knowing their optima lie in `[optL, optR]`. It resolves the middle column by scanning that window, then recurses left and right with narrowed windows.

### J7. Why scan only `[optL, min(optR, mid-1)]` for the middle column?
`optL..optR` is the monotonicity window; `mid-1` enforces a non-empty last segment (`k < mid`). Take the tighter upper bound.

### J8. After finding `opt(mid)`, what windows do the halves get?
Left half (columns `< mid`): `[optL, opt(mid)]`. Right half (columns `> mid`): `[opt(mid), optR]`. They share the single endpoint `opt(mid)`.

### J9. How do you break ties among equal-cost split points?
Keep the smallest `k` (use strict `<` when comparing). This preserves the non-decreasing argmin invariant the recursion relies on.

### J10. What is the base case of the DP?
`dp[0][0] = 0` and `dp[0][j] = +∞` for `j > 0` — zero segments can only cover the empty prefix.

### J11. How do you make the cost `C(k, j)` fast?
Precompute prefix sums so a segment's sum (or squared sum, etc.) is `O(1)`. The whole `O(K n log n)` analysis assumes `C` is `O(1)`.

### J12 (analysis). What happens if `opt` is not monotone?
The recursion prunes search ranges that may contain the true optimum, so you get a wrong answer — with no crash. That is why you must verify monotonicity (often via the quadrangle inequality) before applying the technique.

---

## Middle Questions (12 Q&A)

### M1. State the quadrangle (Monge) inequality.
For all `a ≤ b ≤ c ≤ d`: `C(a, c) + C(b, d) ≤ C(a, d) + C(b, c)`. Nested pairs are no more expensive than crossing pairs. It is a sufficient condition for `opt` to be monotone.

### M2. Why does the quadrangle inequality imply monotone `opt`?
Suppose `opt(j) = p`. For any `k < p`, applying QI with `(a, b, c, d) = (k, p, j, j+1)` plus the fact that `p` beats `k` at column `j` shows `p` also beats `k` at column `j+1`. So no smaller split is better at `j+1`, forcing `opt(j+1) ≥ p`.

### M3. What is the local form of the quadrangle inequality, and why use it?
`C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)`. It is equivalent to the full QI but is a single clean inequality, far easier to verify algebraically.

### M4. Give a cost function that satisfies QI.
`C(k, j) = (P[j] − P[k])²` (squared segment sum), where `P` is the prefix-sum array. Cluster sum-of-squared-errors on sorted points is another.

### M5. How is this different from Knuth optimization?
Knuth (topic 12) optimizes the *interval* DP `dp[i][j] = min_{i<k<j} ( dp[i][k] + dp[k][j] ) + C(i, j)` using the *two-sided* bound `opt(i, j-1) ≤ opt(i, j) ≤ opt(i+1, j)`, giving `O(n²)`. Divide-and-conquer optimizes the *layered* DP and needs only the *one-sided* bound.

### M6. How is this different from the Convex Hull Trick?
CHT (topic 10) requires the cost to factor into **lines** `dp[k] + a[k]·x[j] + b[k]` and maintains a hull/envelope. Divide-and-conquer works for any Monge cost, not just linear ones, but does not get below `O(n log n)` per layer.

### M7. Walk through the `compute` recursion's correctness invariant.
Invariant: when `compute(l, r, optL, optR)` is called, every column in `[l, r]` has its optimum in `[optL, optR]`. Resolving `mid` finds `bestK = opt(mid)`; monotonicity then guarantees left-half optima are `≤ bestK` and right-half optima `≥ bestK`, preserving the invariant for the recursive calls.

### M8. How do you reconstruct the actual segmentation?
Store `opt[i][j] = bestK` as you fill, then backtrack from `(K, n)`: repeatedly take `k = opt[i][j]`, record segment `[k, j)`, set `j = k`, `i -= 1`.

### M9. How do you save memory in the layer loop?
Row `i` depends only on row `i-1`, so keep two arrays `dpPrev`, `dpCur` and swap them each layer. Memory drops from `O(K n)` to `O(n)` (unless you need the `opt` table for reconstruction).

### M10. What is the connection to totally monotone matrices and SMAWK?
The matrix `M[k][j] = dp[i-1][k] + C(k, j)` is totally monotone when `C` is Monge, so its column minima have non-decreasing row indices. SMAWK finds all column minima in `O(n)` (vs divide-and-conquer's `O(n log n)`), but is more complex to implement.

### M11. When would you NOT use this technique?
When the cost is not Monge (optimum not monotone), when the cost is linear (use CHT), when the recurrence is interval-shaped (use Knuth), or when `n` is tiny (the naive `O(n²)` is simpler).

### M12 (analysis). Why do the left and right windows overlap at exactly one index?
The left half gets `[optL, bestK]` and the right `[bestK, optR]`; both include `bestK`. This single shared point means the summed window length at each recursion level is `O(n)`, which is what gives `O(n log n)` per row.

---

## Senior Questions (10 Q&A)

### S1. How do you confirm the technique even applies to a given cost?
Prove the quadrangle inequality (ideally the local form) algebraically. If you cannot, verify empirically: build a brute-force `opt` table and assert `opt[j] ≤ opt[j+1]` over many random and edge-case inputs. Treat empirical checks as strong tests, not proofs.

### S2. What is the dangerous failure mode, and how do you guard against it?
A non-Monge cost gives non-monotone `opt`, so the recursion returns a *plausible but wrong* number with no crash. Guard with a CI monotonicity assertion on the brute-force `opt` table, and fuzz edge inputs (all-equal arrays, single huge element, `K=1`, `K=n`) where Monge proofs often slip.

### S3. What if the cost function is not `O(1)`?
Then a layer is `O(c · n log n)`. Look first for a closed form via prefix sums (and prefix sums of squares for variance/SSE). If only incremental computation is possible, use Mo-like add/remove pointers carefully (the access pattern is not monotone, so naive movement can be `O(n²)`), or switch to SMAWK.

### S4. How do you handle recursion depth for `n = 10^6`?
In Go/Java the stack grows, so depth `O(log n)` is fine. In Python, raise `sys.setrecursionlimit` or convert `compute` to an explicit stack of `(l, r, optL, optR)` frames to avoid both the limit and per-frame overhead.

### S5. How do you reconstruct cuts when `K·n` is too large to store the `opt` table?
Use Hirschberg-style divide-and-conquer over the layers: recursively solve half the layers on half the array, reconstructing with `O(n)` memory instead of `O(K n)`, trading some time for space.

### S6. When is SMAWK worth the extra complexity over divide-and-conquer?
When the `log n` factor is decisive — very large `n`, or `K` also large so the `log n` multiplies through every layer. SMAWK reaches the optimal `O(K n)`; divide-and-conquer is `O(K n log n)` but simpler and often faster for moderate `n` due to lower constants.

### S7. How does overflow bite, and how do you prevent it?
Squared/variance costs grow like `O((Σ)²)`, which for large `n` and large values exceeds 64-bit. Bound the worst-case cost up front and pick `int64`, `int128`, or big integers. A silent overflow inside `C` is a classic source of a wrong-but-plausible answer.

### S8. What is the connection to 1-D k-means?
Partitioning sorted points into `K` clusters minimizing total within-cluster SSE is exactly this DP, because cluster-SSE on sorted data is Monge. This yields an *optimal* polynomial-time 1-D k-means (Wang-Song's `Ckmeans.1d.dp`), in `O(K n log n)` or `O(K n)` with SMAWK.

### S9. How do you decide between CHT and divide-and-conquer when both apply?
If the cost is linear in a query value (e.g. squared segment sum expands to a line in `P[j]`), CHT can reach `O(n)` per layer and supports online insertion — prefer it. If the cost is a general Monge function with no linear structure, only divide-and-conquer applies.

### S10 (analysis). Why is divide-and-conquer not asymptotically optimal, and does it matter?
The read lower bound is `Ω(n)` per layer, achieved by SMAWK in `O(n)`; divide-and-conquer is `O(n log n)`, a `log n` factor above. In practice the `log n ≤ ~20` factor is often outweighed by SMAWK's implementation complexity and worse cache behavior, so divide-and-conquer is the pragmatic default.

---

## Professional Questions (8 Q&A)

### P1. Design a service that optimally segments a long sensor stream into `K` regimes.
Model as `dp[i][j] = min_k ( dp[i-1][k] + SSE(k, j) )` with cluster-SSE cost (Monge). Precompute prefix sums of values and squares once (`O(n)`). Fill each of `K` layers with `compute` in `O(n log n)`. Roll two rows for `O(n)` memory; keep an `opt` table only if the customer needs the regime boundaries. Validate the Monge property in CI and bound the cost magnitude to avoid overflow.

### P2. The cost is empirically Monge on your samples but the judge fails. What happened?
Almost certainly a corner of the input domain where Monge breaks (negative values, zero-length segments, ties) or a cost-function overflow. Re-run the brute-force oracle and monotonicity assertion on the failing-style inputs, fuzz edge cases, and check the cost type width. Empirical Monge on samples is not a proof.

### P3. Your `n = 10^6`, `K = 500` job is too slow. What do you do?
Confirm `C` is `O(1)` (the usual culprit is an accidental `O(n)` cost). If still slow, switch the per-layer column-minima search from divide-and-conquer `O(n log n)` to SMAWK `O(n)`, removing the `log n` factor across all 500 layers. Ensure rolled rows and flat-array layout for cache; consider parallelizing across independent random restarts if applicable.

### P4. How do you debug "the segmentation cost is wrong" in production?
Run the brute-force `O(K n²)` oracle on the same small input and diff every `dp` cell, plus assert the oracle's `opt` table is non-decreasing (catches an inapplicable cost). Check the three usual suspects: wrong base case, unclamped `hi` (empty segment), and tie-break toward the larger `k`. Unit-test `C(k, j)` against a naive segment computation.

### P5. When is the technique simply the wrong choice?
When the recurrence is interval-shaped `dp[i][k] + dp[k][j]` (use Knuth), when the cost is linear (use CHT, often faster), when the optimum is provably not monotone (no speedup exists; use naive `O(n²)`), or when `n` is small enough that the naive fill is simpler and fast enough.

### P6. How do you parallelize a batch of independent segmentation problems?
Each problem (different array / `K`) is independent — distribute across workers. Within one problem the layer loop is sequential (row `i` needs row `i-1`), but the per-layer `compute` calls on disjoint column ranges are independent and can be parallelized if needed, though the arithmetic is usually fast enough that the layer-level parallelism across problems dominates.

### P7. How do the quadrangle inequality, total monotonicity, and SMAWK relate?
QI on `C` makes the cost matrix `M[k][j] = dp[i-1][k] + C(k, j)` totally monotone (the `g(k)` terms cancel in the Monge check). Total monotonicity means column-minimum row indices are non-decreasing — exactly the monotone-`opt` property. SMAWK is the `O(n)` algorithm for column minima of any totally monotone matrix; divide-and-conquer is the simpler `O(n log n)` alternative.

### P8 (analysis). Prove the per-layer complexity is `O(n log n)`.
At each recursion depth the calls partition the columns, so they involve `O(n)` columns total. The summed window length at a depth increases by only `1` per split (the halves share one endpoint), so it stays `O(n)`. Depth is `O(log n)` because each call halves its column range. `O(n)` work × `O(log n)` depths = `O(n log n)` cost evaluations per layer.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow `O(n²)` DP with a faster algorithm.
Look for a concrete story: a partition/segmentation task with large `n`, a profile showing the inner split-scan dominating, the insight that the cost was Monge (so `opt` is monotone), and the measured speedup. Strong answers mention verifying monotonicity against a brute-force oracle and guarding against the silent-wrong-answer failure mode.

### B2. A teammate applied divide-and-conquer optimization to a cost that turned out not to be Monge. How do you handle it?
Explain calmly that the technique requires monotone `opt`, guaranteed only by the quadrangle inequality, and that without it the result is silently wrong. Show the failing monotonicity assertion on a small input as evidence. Propose either proving/using a Monge cost or falling back to the naive `O(n²)`. Frame it as "this is a correctness precondition we must check," not blame.

### B3. Design a feature that finds optimal piecewise-constant approximations of a time series.
This is segmented regression: `dp[i][j] = min_k ( dp[i-1][k] + SSE(k, j) )` with cluster-SSE (Monge), solved in `O(K n log n)`. Discuss choosing `K` (or sweeping `K` with an elbow/penalty), prefix sums of values and squares for `O(1)` cost, memory rolling, and reconstructing the breakpoints for the user.

### B4. How would you explain divide-and-conquer DP optimization to a junior engineer?
Use the ribbon-cutting analogy: cutting a ribbon of length `j` into pieces, the best place for the last cut drifts rightward as `j` grows. So once you know the best last cut for the middle length, you have bounded where it can be for the shorter and longer lengths — no need to re-check everything. Lead with the two gotchas: it only works when the optimum is monotone, and that requires the Monge cost condition.

### B5. Your segmentation job is consuming too much memory at scale. How do you investigate?
Check whether you are storing all `K` rows (`O(K n)`) when only the cost is needed — roll two rows for `O(n)`. If reconstruction needs the `opt` table and `K·n` is huge, use Hirschberg layer-splitting. Confirm you reuse the `dpCur` buffer per layer rather than reallocating, and use flat arrays. Profile allocations; the fix is usually rolled rows plus buffer reuse.

---

## Coding Challenges

### Challenge 1: Partition Array into K Segments Minimizing Sum of Squared Segment Sums

**Problem.** Given an array `a` of `n` integers and an integer `K`, split `a` into exactly `K` contiguous non-empty segments to minimize the total cost, where each segment's cost is the **square of its sum**. Return the minimum total cost.

**Example.**
```text
a = [1, 3, 2, 4], K = 2  ->  52   (split [1,3] | [2,4]: 4^2 + 6^2 = 16 + 36 = 52)
a = [1, 1, 1, 1], K = 2  ->  8    (split [1,1] | [1,1]: 2^2 + 2^2 = 8)
```

**Constraints.** `1 ≤ K ≤ n ≤ 10^5`, `0 ≤ a[i] ≤ 10^4`.

**Brute force.** `O(K n²)` — scan every split for every column.

**Optimal.** Divide-and-conquer optimization, `O(K n log n)`. The cost `(P[j] − P[k])²` is Monge, so `opt` is monotone.

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 62

var (
	prefix        []int64
	dpPrev, dpCur []int64
)

func cost(k, j int) int64 {
	s := prefix[j] - prefix[k]
	return s * s
}

func compute(l, r, optL, optR int) {
	if l > r {
		return
	}
	mid := (l + r) / 2
	best, bestK := INF, optL
	hi := optR
	if hi > mid-1 {
		hi = mid - 1
	}
	for k := optL; k <= hi; k++ {
		if dpPrev[k] >= INF {
			continue
		}
		if v := dpPrev[k] + cost(k, mid); v < best {
			best, bestK = v, k
		}
	}
	dpCur[mid] = best
	compute(l, mid-1, optL, bestK)
	compute(mid+1, r, bestK, optR)
}

func partition(a []int, K int) int64 {
	n := len(a)
	prefix = make([]int64, n+1)
	for i, x := range a {
		prefix[i+1] = prefix[i] + int64(x)
	}
	dpPrev = make([]int64, n+1)
	dpCur = make([]int64, n+1)
	for j := range dpPrev {
		dpPrev[j] = INF
	}
	dpPrev[0] = 0
	for i := 0; i < K; i++ {
		for j := range dpCur {
			dpCur[j] = INF
		}
		compute(0, n, 0, n)
		dpPrev, dpCur = dpCur, dpPrev
	}
	return dpPrev[n]
}

func main() {
	fmt.Println(partition([]int{1, 3, 2, 4}, 2)) // 52
	fmt.Println(partition([]int{1, 1, 1, 1}, 2)) // 8
}
```

**Java.**
```java
import java.util.Arrays;

public class PartitionK {
    static final long INF = 1L << 62;
    static long[] prefix, dpPrev, dpCur;

    static long cost(int k, int j) {
        long s = prefix[j] - prefix[k];
        return s * s;
    }

    static void compute(int l, int r, int optL, int optR) {
        if (l > r) return;
        int mid = (l + r) / 2;
        long best = INF;
        int bestK = optL, hi = Math.min(optR, mid - 1);
        for (int k = optL; k <= hi; k++) {
            if (dpPrev[k] >= INF) continue;
            long v = dpPrev[k] + cost(k, mid);
            if (v < best) { best = v; bestK = k; }
        }
        dpCur[mid] = best;
        compute(l, mid - 1, optL, bestK);
        compute(mid + 1, r, bestK, optR);
    }

    static long partition(int[] a, int K) {
        int n = a.length;
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        dpPrev = new long[n + 1];
        dpCur = new long[n + 1];
        Arrays.fill(dpPrev, INF);
        dpPrev[0] = 0;
        for (int i = 0; i < K; i++) {
            Arrays.fill(dpCur, INF);
            compute(0, n, 0, n);
            long[] t = dpPrev; dpPrev = dpCur; dpCur = t;
        }
        return dpPrev[n];
    }

    public static void main(String[] args) {
        System.out.println(partition(new int[]{1, 3, 2, 4}, 2)); // 52
        System.out.println(partition(new int[]{1, 1, 1, 1}, 2)); // 8
    }
}
```

**Python.**
```python
import sys

INF = 1 << 62


def partition(a, K):
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x

    def cost(k, j):
        s = pre[j] - pre[k]
        return s * s

    dp_prev = [INF] * (n + 1)
    dp_prev[0] = 0
    dp_cur = [INF] * (n + 1)

    def compute(l, r, opt_l, opt_r):
        if l > r:
            return
        mid = (l + r) // 2
        best, best_k = INF, opt_l
        hi = min(opt_r, mid - 1)
        for k in range(opt_l, hi + 1):
            if dp_prev[k] >= INF:
                continue
            v = dp_prev[k] + cost(k, mid)
            if v < best:
                best, best_k = v, k
        dp_cur[mid] = best
        compute(l, mid - 1, opt_l, best_k)
        compute(mid + 1, r, best_k, opt_r)

    for _ in range(K):
        for j in range(n + 1):
            dp_cur[j] = INF
        compute(0, n, 0, n)
        dp_prev, dp_cur = dp_cur, dp_prev
    return dp_prev[n]


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    print(partition([1, 3, 2, 4], 2))  # 52
    print(partition([1, 1, 1, 1], 2))  # 8
```

---

### Challenge 2: Optimal 1-D K-Means (Minimum Total Within-Segment SSE)

**Problem.** Given `n` real numbers and `K`, partition the **sorted** array into `K` contiguous clusters minimizing total within-cluster sum of squared deviations from each cluster's mean. Return the minimum SSE.

**Example.**
```text
x = [1, 2, 10, 11], K = 2  ->  1.0   (clusters {1,2} and {10,11}, each SSE = 0.5)
```

**Approach.** `C(k, j) = Σx² − (Σx)²/(j−k)`, `O(1)` from prefix sums of `x` and `x²`. This cost is Monge, so divide-and-conquer applies. `O(K n log n)`.

**Go.**
```go
package main

import "fmt"

const INF = 1e18

var (
	pre1, pre2    []float64 // prefix sums of x and x^2
	dpPrev, dpCur []float64
)

func cost(k, j int) float64 {
	cnt := float64(j - k)
	s := pre1[j] - pre1[k]
	sq := pre2[j] - pre2[k]
	return sq - s*s/cnt
}

func compute(l, r, optL, optR int) {
	if l > r {
		return
	}
	mid := (l + r) / 2
	best, bestK := INF, optL
	hi := optR
	if hi > mid-1 {
		hi = mid - 1
	}
	for k := optL; k <= hi; k++ {
		if dpPrev[k] >= INF {
			continue
		}
		if v := dpPrev[k] + cost(k, mid); v < best {
			best, bestK = v, k
		}
	}
	dpCur[mid] = best
	compute(l, mid-1, optL, bestK)
	compute(mid+1, r, bestK, optR)
}

func kmeans1d(x []float64, K int) float64 {
	n := len(x)
	pre1 = make([]float64, n+1)
	pre2 = make([]float64, n+1)
	for i, v := range x {
		pre1[i+1] = pre1[i] + v
		pre2[i+1] = pre2[i] + v*v
	}
	dpPrev = make([]float64, n+1)
	dpCur = make([]float64, n+1)
	for j := range dpPrev {
		dpPrev[j] = INF
	}
	dpPrev[0] = 0
	for i := 0; i < K; i++ {
		for j := range dpCur {
			dpCur[j] = INF
		}
		compute(0, n, 0, n)
		dpPrev, dpCur = dpCur, dpPrev
	}
	return dpPrev[n]
}

func main() {
	fmt.Printf("%.4f\n", kmeans1d([]float64{1, 2, 10, 11}, 2)) // 1.0000
}
```

**Java.**
```java
import java.util.Arrays;

public class KMeans1D {
    static final double INF = 1e18;
    static double[] pre1, pre2, dpPrev, dpCur;

    static double cost(int k, int j) {
        double cnt = j - k;
        double s = pre1[j] - pre1[k];
        double sq = pre2[j] - pre2[k];
        return sq - s * s / cnt;
    }

    static void compute(int l, int r, int optL, int optR) {
        if (l > r) return;
        int mid = (l + r) / 2;
        double best = INF;
        int bestK = optL, hi = Math.min(optR, mid - 1);
        for (int k = optL; k <= hi; k++) {
            if (dpPrev[k] >= INF) continue;
            double v = dpPrev[k] + cost(k, mid);
            if (v < best) { best = v; bestK = k; }
        }
        dpCur[mid] = best;
        compute(l, mid - 1, optL, bestK);
        compute(mid + 1, r, bestK, optR);
    }

    static double kmeans1d(double[] x, int K) {
        int n = x.length;
        pre1 = new double[n + 1];
        pre2 = new double[n + 1];
        for (int i = 0; i < n; i++) {
            pre1[i + 1] = pre1[i] + x[i];
            pre2[i + 1] = pre2[i] + x[i] * x[i];
        }
        dpPrev = new double[n + 1];
        dpCur = new double[n + 1];
        Arrays.fill(dpPrev, INF);
        dpPrev[0] = 0;
        for (int i = 0; i < K; i++) {
            Arrays.fill(dpCur, INF);
            compute(0, n, 0, n);
            double[] t = dpPrev; dpPrev = dpCur; dpCur = t;
        }
        return dpPrev[n];
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", kmeans1d(new double[]{1, 2, 10, 11}, 2)); // 1.0000
    }
}
```

**Python.**
```python
import sys

INF = float("inf")


def kmeans1d(x, K):
    n = len(x)
    pre1 = [0.0] * (n + 1)
    pre2 = [0.0] * (n + 1)
    for i, v in enumerate(x):
        pre1[i + 1] = pre1[i] + v
        pre2[i + 1] = pre2[i] + v * v

    def cost(k, j):
        cnt = j - k
        s = pre1[j] - pre1[k]
        sq = pre2[j] - pre2[k]
        return sq - s * s / cnt

    dp_prev = [INF] * (n + 1)
    dp_prev[0] = 0.0
    dp_cur = [INF] * (n + 1)

    def compute(l, r, opt_l, opt_r):
        if l > r:
            return
        mid = (l + r) // 2
        best, best_k = INF, opt_l
        hi = min(opt_r, mid - 1)
        for k in range(opt_l, hi + 1):
            if dp_prev[k] >= INF:
                continue
            v = dp_prev[k] + cost(k, mid)
            if v < best:
                best, best_k = v, k
        dp_cur[mid] = best
        compute(l, mid - 1, opt_l, best_k)
        compute(mid + 1, r, best_k, opt_r)

    for _ in range(K):
        for j in range(n + 1):
            dp_cur[j] = INF
        compute(0, n, 0, n)
        dp_prev, dp_cur = dp_cur, dp_prev
    return dp_prev[n]


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    print(round(kmeans1d([1, 2, 10, 11], 2), 4))  # 1.0
```

---

### Challenge 3: Partition Cost with Reconstruction of the Cuts

**Problem.** Same as Challenge 1 (squared-segment-sum cost), but also return the list of segment boundaries `[k, j)` of an optimal partition, not just the cost.

**Approach.** Record `opt[i][mid] = bestK` inside `compute`, then backtrack from `(K, n)`. `O(K n log n)` time, `O(K n)` memory for the `opt` table.

**Python.**
```python
import sys

INF = 1 << 62


def partition_with_cuts(a, K):
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x

    def cost(k, j):
        s = pre[j] - pre[k]
        return s * s

    dp_prev = [INF] * (n + 1)
    dp_prev[0] = 0
    dp_cur = [INF] * (n + 1)
    opt = [[0] * (n + 1) for _ in range(K + 1)]

    def compute(layer, l, r, opt_l, opt_r):
        if l > r:
            return
        mid = (l + r) // 2
        best, best_k = INF, opt_l
        hi = min(opt_r, mid - 1)
        for k in range(opt_l, hi + 1):
            if dp_prev[k] >= INF:
                continue
            v = dp_prev[k] + cost(k, mid)
            if v < best:
                best, best_k = v, k
        dp_cur[mid] = best
        opt[layer][mid] = best_k
        compute(layer, l, mid - 1, opt_l, best_k)
        compute(layer, mid + 1, r, best_k, opt_r)

    for i in range(1, K + 1):
        for j in range(n + 1):
            dp_cur[j] = INF
        compute(i, 0, n, 0, n)
        dp_prev, dp_cur = dp_cur, dp_prev

    cuts = []
    j, i = n, K
    while i > 0:
        k = opt[i][j]
        cuts.append((k, j))
        j, i = k, i - 1
    cuts.reverse()
    return dp_prev[n], cuts


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    print(partition_with_cuts([1, 3, 2, 4], 2))  # (52, [(0, 2), (2, 4)])
```

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 62

var (
	prefix        []int64
	dpPrev, dpCur []int64
	opt           [][]int
	layer         int
)

func cost(k, j int) int64 { s := prefix[j] - prefix[k]; return s * s }

func compute(l, r, optL, optR int) {
	if l > r {
		return
	}
	mid := (l + r) / 2
	best, bestK := INF, optL
	hi := optR
	if hi > mid-1 {
		hi = mid - 1
	}
	for k := optL; k <= hi; k++ {
		if dpPrev[k] >= INF {
			continue
		}
		if v := dpPrev[k] + cost(k, mid); v < best {
			best, bestK = v, k
		}
	}
	dpCur[mid] = best
	opt[layer][mid] = bestK
	compute(l, mid-1, optL, bestK)
	compute(mid+1, r, bestK, optR)
}

func partitionWithCuts(a []int, K int) (int64, [][2]int) {
	n := len(a)
	prefix = make([]int64, n+1)
	for i, x := range a {
		prefix[i+1] = prefix[i] + int64(x)
	}
	dpPrev = make([]int64, n+1)
	dpCur = make([]int64, n+1)
	opt = make([][]int, K+1)
	for i := range opt {
		opt[i] = make([]int, n+1)
	}
	for j := range dpPrev {
		dpPrev[j] = INF
	}
	dpPrev[0] = 0
	for i := 1; i <= K; i++ {
		layer = i
		for j := range dpCur {
			dpCur[j] = INF
		}
		compute(0, n, 0, n)
		dpPrev, dpCur = dpCur, dpPrev
	}
	cuts := [][2]int{}
	j, i := n, K
	for i > 0 {
		k := opt[i][j]
		cuts = append([][2]int{{k, j}}, cuts...)
		j, i = k, i-1
	}
	return dpPrev[n], cuts
}

func main() {
	c, cuts := partitionWithCuts([]int{1, 3, 2, 4}, 2)
	fmt.Println(c, cuts) // 52 [[0 2] [2 4]]
}
```

**Java.**
```java
import java.util.*;

public class PartitionCuts {
    static final long INF = 1L << 62;
    static long[] prefix, dpPrev, dpCur;
    static int[][] opt;
    static int layer;

    static long cost(int k, int j) { long s = prefix[j] - prefix[k]; return s * s; }

    static void compute(int l, int r, int optL, int optR) {
        if (l > r) return;
        int mid = (l + r) / 2;
        long best = INF;
        int bestK = optL, hi = Math.min(optR, mid - 1);
        for (int k = optL; k <= hi; k++) {
            if (dpPrev[k] >= INF) continue;
            long v = dpPrev[k] + cost(k, mid);
            if (v < best) { best = v; bestK = k; }
        }
        dpCur[mid] = best;
        opt[layer][mid] = bestK;
        compute(l, mid - 1, optL, bestK);
        compute(mid + 1, r, bestK, optR);
    }

    public static void main(String[] args) {
        int[] a = {1, 3, 2, 4};
        int K = 2, n = a.length;
        prefix = new long[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
        dpPrev = new long[n + 1];
        dpCur = new long[n + 1];
        opt = new int[K + 1][n + 1];
        Arrays.fill(dpPrev, INF);
        dpPrev[0] = 0;
        for (int i = 1; i <= K; i++) {
            layer = i;
            Arrays.fill(dpCur, INF);
            compute(0, n, 0, n);
            long[] t = dpPrev; dpPrev = dpCur; dpCur = t;
        }
        Deque<int[]> cuts = new ArrayDeque<>();
        int j = n, i = K;
        while (i > 0) {
            int k = opt[i][j];
            cuts.push(new int[]{k, j});
            j = k; i--;
        }
        System.out.print(dpPrev[n] + " ");
        for (int[] c : cuts) System.out.print(Arrays.toString(c));
        System.out.println(); // 52 [0, 2][2, 4]
    }
}
```

---

### Challenge 4: Detect Whether Divide-and-Conquer Optimization Applies

**Problem.** Given a small array `a` and `K`, build the brute-force `opt` table and decide whether the optimal split is monotone (so divide-and-conquer is valid). Return `true`/`false`. This is the empirical applicability check every senior engineer runs before trusting the fast version.

**Approach.** Compute `dp` and `opt` with the naive `O(K n²)` fill, then assert `opt[i][j-1] ≤ opt[i][j]` for every layer and column.

**Python.**
```python
def is_monotone(a, K, cost):
    INF = 1 << 62
    n = len(a)
    dp = [[INF] * (n + 1) for _ in range(K + 1)]
    opt = [[0] * (n + 1) for _ in range(K + 1)]
    dp[0][0] = 0
    for i in range(1, K + 1):
        for j in range(1, n + 1):
            best, best_k = INF, 0
            for k in range(j):
                if dp[i - 1][k] >= INF:
                    continue
                v = dp[i - 1][k] + cost(k, j)
                if v < best:
                    best, best_k = v, k
            dp[i][j], opt[i][j] = best, best_k
    for i in range(1, K + 1):
        for j in range(2, n + 1):
            if opt[i][j - 1] > opt[i][j]:
                return False
    return True


if __name__ == "__main__":
    pre = [0]
    for x in [1, 3, 2, 4]:
        pre.append(pre[-1] + x)
    sq = lambda k, j: (pre[j] - pre[k]) ** 2
    print(is_monotone([1, 3, 2, 4], 2, sq))  # True (squared cost is Monge)
```

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 62

func isMonotone(a []int, K int, cost func(k, j int) int64) bool {
	n := len(a)
	dp := make([][]int64, K+1)
	opt := make([][]int, K+1)
	for i := range dp {
		dp[i] = make([]int64, n+1)
		opt[i] = make([]int, n+1)
		for j := range dp[i] {
			dp[i][j] = INF
		}
	}
	dp[0][0] = 0
	for i := 1; i <= K; i++ {
		for j := 1; j <= n; j++ {
			best, bestK := INF, 0
			for k := 0; k < j; k++ {
				if dp[i-1][k] >= INF {
					continue
				}
				if v := dp[i-1][k] + cost(k, j); v < best {
					best, bestK = v, k
				}
			}
			dp[i][j], opt[i][j] = best, bestK
		}
	}
	for i := 1; i <= K; i++ {
		for j := 2; j <= n; j++ {
			if opt[i][j-1] > opt[i][j] {
				return false
			}
		}
	}
	return true
}

func main() {
	a := []int{1, 3, 2, 4}
	pre := make([]int64, len(a)+1)
	for i, x := range a {
		pre[i+1] = pre[i] + int64(x)
	}
	cost := func(k, j int) int64 { s := pre[j] - pre[k]; return s * s }
	fmt.Println(isMonotone(a, 2, cost)) // true
}
```

**Java.**
```java
import java.util.Arrays;
import java.util.function.BiFunction;

public class CheckMonotone {
    static final long INF = 1L << 62;

    static boolean isMonotone(int[] a, int K, BiFunction<Integer, Integer, Long> cost) {
        int n = a.length;
        long[][] dp = new long[K + 1][n + 1];
        int[][] opt = new int[K + 1][n + 1];
        for (long[] row : dp) Arrays.fill(row, INF);
        dp[0][0] = 0;
        for (int i = 1; i <= K; i++)
            for (int j = 1; j <= n; j++) {
                long best = INF; int bestK = 0;
                for (int k = 0; k < j; k++) {
                    if (dp[i - 1][k] >= INF) continue;
                    long v = dp[i - 1][k] + cost.apply(k, j);
                    if (v < best) { best = v; bestK = k; }
                }
                dp[i][j] = best; opt[i][j] = bestK;
            }
        for (int i = 1; i <= K; i++)
            for (int j = 2; j <= n; j++)
                if (opt[i][j - 1] > opt[i][j]) return false;
        return true;
    }

    public static void main(String[] args) {
        int[] a = {1, 3, 2, 4};
        long[] pre = new long[a.length + 1];
        for (int i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
        BiFunction<Integer, Integer, Long> cost =
            (k, j) -> { long s = pre[j] - pre[k]; return s * s; };
        System.out.println(isMonotone(a, 2, cost)); // true
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"When `opt(i, j)` is monotone — guaranteed by the quadrangle inequality on `C` — fill each DP row with `compute(l, r, optL, optR)` in `O(n log n)`, total `O(K n log n)`."*
- Immediately flag the precondition: **it only works if `opt` is monotone**, and the answer is *silently wrong* otherwise.
- State the quadrangle inequality and offer the local form as the practical check.
- Distinguish the siblings: **Knuth** (interval DP, two-sided bound), **CHT** (linear cost, line envelope), **SMAWK** (linear-time column minima).
- Always offer to verify against a brute-force oracle and a monotonicity assertion on small inputs.
- Remember the implementation details: clamp `hi = min(optR, mid-1)`, break ties to the **smallest** `k`, keep `C` `O(1)` with prefix sums.
