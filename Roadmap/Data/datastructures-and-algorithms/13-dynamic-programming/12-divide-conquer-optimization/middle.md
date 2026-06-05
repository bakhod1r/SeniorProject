# Divide and Conquer DP Optimization — Middle Level

> **Focus:** Why `opt(i, j)` is monotone, how the `compute(l, r, optL, optR)` recursion exploits it to fill a row in `O(n log n)`, how the quadrangle/Monge inequality *guarantees* that monotonicity, and exactly how this technique differs from Knuth optimization (sibling `12`) and the Convex Hull Trick (sibling `10`).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The compute Recursion in Detail](#the-compute-recursion-in-detail)
4. [The Quadrangle / Monge Sufficient Condition](#the-quadrangle--monge-sufficient-condition)
5. [Comparison with Knuth and CHT](#comparison-with-knuth-and-cht)
6. [Advanced Patterns](#advanced-patterns)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: when `opt(i, j)` is monotone, you can fill a DP row in `O(n log n)` with a divide-and-conquer recursion. At middle level you start asking the engineering and correctness questions that decide whether your solution is *fast* **and** *right*:

- *Why* is `opt(i, j)` monotone, and what exactly does the recursion exploit about it?
- What is the precise shape of `compute(l, r, optL, optR)`, and why is the total work `O(n log n)` per layer?
- What property of the cost function `C` guarantees monotonicity, so I don't have to gamble?
- How is this different from Knuth optimization (which also uses monotone `opt`) and from the Convex Hull Trick (which also speeds up `dp[k] + …`)?
- How do I handle "exactly `K` segments" vs "at most `K`", reconstruction of the cuts, and the layer loop?

These are the questions that separate "I copied the `compute` template" from "I can recognize when it applies, prove it, and adapt it."

---

## Deeper Concepts

### The DP and its argmin, restated

We are optimizing, for each layer `i` and column `j`:

```
dp[i][j] = min over k in [0, j) of ( dp[i-1][k] + C(k, j) )
opt(i, j) = the minimizing k (smallest on ties)
```

The naive evaluation is `O(n²)` per layer because each of the `n` columns scans up to `n` split points. The optimization rests entirely on this claim:

> **Monotonicity:** `opt(i, j) ≤ opt(i, j + 1)` for all `j`, within a fixed layer `i`.

If this holds, the `n` argmins of a row are a non-decreasing sequence. That means: if I know the argmin at the *middle* column is `p`, then every column to the left has its argmin in `[·, p]` and every column to the right has its argmin in `[p, ·]`. The search space for each column is *bounded by its neighbors' answers*. Divide-and-conquer turns this bounding into a `log n`-depth recursion.

### Why monotone argmins imply `O(n log n)`

Consider filling columns `l..r` with known argmin window `[optL, optR]`. We compute the middle column `mid` by scanning `[optL, optR]` — cost proportional to `optR - optL + 1`. We then split into two subproblems:

- left: columns `l..mid-1` with window `[optL, opt(mid)]`,
- right: columns `mid+1..r` with window `[opt(mid), optR]`.

The two windows **overlap only at the single point `opt(mid)`**, so the total window length scanned at one recursion *level* is `O(optR - optL) = O(n)` across all calls at that level. There are `O(log n)` levels (each halves the column range). Hence `O(n log n)` per row. This is the same accounting as merge sort: `O(n)` work per level, `log n` levels.

### What "non-decreasing argmin" buys, geometrically

Picture the `n × n` matrix `M[k][j] = dp[i-1][k] + C(k, j)`. We want, for each column `j`, the row `k` achieving the column minimum. Monotonicity says these minimizing rows form a "staircase" that never goes up as `j` increases. A matrix whose column minima are non-decreasing in this way is called **totally monotone** (see [`professional.md`](./professional.md) and the SMAWK connection). Divide-and-conquer optimization is the simple `O(n log n)` way to find all column minima of such a matrix; SMAWK does it in `O(n)` but is fiddlier.

### The intuition behind monotonicity in one picture

Why should the best split drift rightward? Think of two competing split points `k₁ < k₂` for the last segment. As `j` grows, both candidate segments `[k₁, j)` and `[k₂, j)` grow, but the *longer* one `[k₁, j)` grows "more expensively" under a Monge cost (its marginal cost of extension is larger). At some column the cheaper-predecessor advantage of `k₁` is overtaken by the cheaper-extension advantage of `k₂`, and the optimum flips from `k₁` to `k₂` — and once it flips, it never flips back, because the Monge inequality guarantees the crossover is one-directional. The quadrangle inequality is exactly the algebraic statement "the two cost curves cross at most once, and in the right direction." That single-crossing property is the whole reason a binary-search-like recursion can prune the search space.

### Reading the recurrence as column minima

It is worth internalizing the matrix view because it connects this technique to the broader Monge-matrix literature. Define `M[k][j] = dp[i-1][k] + C(k, j)` for `k < j` and `+∞` otherwise. Then:

- `dp[i][j]` is the **minimum of column `j`** of `M`.
- `opt(i, j)` is the **row index** of that column minimum (smallest on ties).
- Monotonicity of `opt` is exactly "the column-minimum row indices are non-decreasing."

So filling one DP row *is* the classical problem "find all column minima of a totally monotone matrix." Divide-and-conquer optimization is one algorithm for it; SMAWK is the asymptotically optimal one. Recognizing this lets you reuse a single mental model across optimal BSTs, the assignment problem on Monge matrices, and 1-D clustering.

---

## The compute Recursion in Detail

Here is the recursion with every subtlety annotated.

```
compute(l, r, optL, optR):
    if l > r:                       # empty column range — nothing to do
        return
    mid = (l + r) / 2               # the column we resolve fully now
    best = +INF
    bestK = optL                    # default argmin if nothing better found
    hi = min(optR, mid - 1)         # last segment must be non-empty: k < mid
    for k = optL .. hi:
        if dp_prev[k] == +INF:      # impossible predecessor — skip (avoids overflow)
            continue
        v = dp_prev[k] + C(k, mid)
        if v < best:                # strict < keeps the SMALLEST tying k
            best = v
            bestK = k
    dp_cur[mid] = best
    compute(l, mid - 1, optL, bestK)    # left: argmins lie in [optL, bestK]
    compute(mid + 1, r, bestK, optR)    # right: argmins lie in [bestK, optR]
```

Key invariants and why each line matters:

1. **`mid = (l + r) / 2`** — we resolve the middle column *fully* (scanning its whole allowed window) so its argmin can split the work for both halves.
2. **`hi = min(optR, mid - 1)`** — two upper bounds combine: the monotonicity window says `k ≤ optR`, and the "non-empty last segment" rule says `k ≤ mid - 1`. Take the tighter one.
3. **Strict `<`** — on ties we keep the smaller `k`. This is essential: the recursion passes `bestK` as both the right bound of the left half and the left bound of the right half, and the monotone-argmin theory assumes the *smallest* argmin. Using `≤` (keeping the larger `k`) can corrupt the windows.
4. **`compute(l, mid-1, optL, bestK)`** — the left half's columns are all `< mid`, so their argmins are `≤ opt(mid) = bestK`; and they are `≥ optL` (inherited). So their window is `[optL, bestK]`.
5. **`compute(mid+1, r, bestK, optR)`** — symmetric: right-half columns are `> mid`, argmins `≥ bestK`, `≤ optR`.

The top-level call is `compute(0, n, 0, n)` (or restricted to valid columns for the layer). Each layer calls it once, reading `dp_prev` and writing `dp_cur`, then the rows are swapped.

### Worked recursion trace (columns 1..7, k-window 0..7)

```
compute(1,7, 0,7): mid=4, scan k in [0,4] → opt(4)=2
    compute(1,3, 0,2): mid=2, scan k in [0,2] → opt(2)=1
        compute(1,1, 0,1): mid=1, scan k in [0,1] → opt(1)=0
        compute(3,3, 1,2): mid=3, scan k in [1,2] → opt(3)=2
    compute(5,7, 2,7): mid=6, scan k in [2,6] → opt(6)=4
        compute(5,5, 2,4): mid=5, scan k in [2,4] → opt(5)=3
        compute(7,7, 4,7): mid=7, scan k in [4,7] → opt(7)=5
```

Total split-point checks: `5 + 3 + 2 + 2 + 5 + 3 + 4 = 24`, versus the naive `1+2+3+4+5+6+7 = 28` — and the gap widens dramatically as `n` grows (`O(n log n)` vs `O(n²)`). The resulting argmins `opt = (·, 0, 1, 2, 2, 3, 4, 5)` are non-decreasing, as required.

---

## The Quadrangle / Monge Sufficient Condition

You cannot *assume* `opt` is monotone — you must justify it. The cleanest sufficient condition is on the cost function `C`.

**Definition (Quadrangle Inequality / Monge condition).** A cost `C` satisfies the quadrangle inequality if for all `a ≤ b ≤ c ≤ d`:

```
C(a, c) + C(b, d)  ≤  C(a, d) + C(b, c)
```

Read it as: two "inner/nested" intervals are no more expensive than two "outer/crossing" ones. (An equivalent, often-easier-to-check local form: `C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)` for all `a < c`.)

**Theorem (informal).** If `C` satisfies the quadrangle inequality, then the function `f_j(k) = dp[i-1][k] + C(k, j)` has a non-decreasing argmin in `j`; i.e. `opt(i, j) ≤ opt(i, j+1)`. Hence divide-and-conquer optimization is correct.

The proof is in [`professional.md`](./professional.md). Intuitively: the quadrangle inequality prevents the "best cut" from ever wanting to jump backward — if it were optimal to cut earlier for a larger `j`, the inequality would let you swap to a cheaper non-crossing configuration, contradiction.

### Costs that satisfy it

- **Sum of a convex function over the segment.** If `C(k, j) = Σ_{t=k}^{j-1} w(t, j)` where `w` is "nice," many such costs are Monge. The squared-segment-sum `(P[j] - P[k])²` from the running example satisfies it.
- **`C(k, j) = (P[j] - P[k])²`** (squared range sum) — Monge.
- **Cost = number of pairs / inversions inside `[k, j)`** — Monge in several classic problems.
- **Entropy-like or log-based segment penalties** — frequently Monge.

### How to check in practice

1. **Prove it algebraically** from the closed form of `C` (best, but sometimes hard).
2. **Check the local form** `C(a,c) + C(a+1,c+1) ≤ C(a,c+1) + C(a+1,c)` — it implies the full quadrangle inequality and is a single clean inequality.
3. **Verify empirically** — build the brute-force `opt` table on random inputs and assert `opt[j] ≤ opt[j+1]`. This does not *prove* it, but it catches mistakes cheaply and is mandatory in tests (see senior).

---

## Comparison with Knuth and CHT

All three (this topic, Knuth, CHT) speed up a DP `min/max` transition. They apply to *different* DP shapes and rest on *different* structural properties. Confusing them is the most common conceptual error.

| | DP shape | Structural property | Per-layer / total cost | Cost function form |
|---|----------|---------------------|------------------------|--------------------|
| **Divide & Conquer (this)** | `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k,j) )` | **one-sided** monotone argmin: `opt(i,j) ≤ opt(i,j+1)` | `O(n log n)` per layer, `O(K n log n)` total | arbitrary `C` (just Monge) |
| **Knuth (topic 12)** | `dp[i][j] = min_{i<k<j} ( dp[i][k] + dp[k][j] ) + C(i,j)` | **two-sided** monotone argmin: `opt(i,j-1) ≤ opt(i,j) ≤ opt(i+1,j)` | `O(n²)` total (from `O(n³)`) | `C` Monge **and** monotone |
| **CHT (topic 10)** | `dp[j] = min_k ( dp[k] + a[k]·x[j] + b[k] )` | cost factors into **lines**; lower/upper envelope | `O(n log n)` or `O(n)` total | strictly **linear** in a query value |

### Versus Knuth (sibling `12`)

Knuth optimizes the **interval** DP where a cell combines two *smaller cells of the same DP* (`dp[i][k] + dp[k][j]`) — think optimal BST, matrix-chain-like, or merging-stones problems. It needs the **two-sided** bound `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, which lets you fill the table by increasing interval length and only scan between two precomputed bounds. Divide-and-conquer optimizes the **layered** DP where a cell builds on the *previous layer* (`dp[i-1][k] + C(k, j)`) and needs only the **one-sided** bound. Different recurrence, different bound, different fill order.

### Versus the Convex Hull Trick (sibling `10`)

CHT applies when each predecessor `k` contributes a **line** `y = a[k]·x + (dp[k] + b[k])` evaluated at a query `x[j]`, and you want the minimum over lines at each query. It maintains a hull/envelope of lines and answers each query in `O(log n)` (or `O(1)` if queries are monotone). Divide-and-conquer optimization does **not** require the cost to be linear — `C(k, j)` can be any Monge function — but in exchange it does not get below `O(n log n)` per layer and does not support arbitrary online queries. If your cost happens to be linear, CHT is usually the better tool; if it is a general Monge cost, divide-and-conquer is the one that applies.

### Quick decision rule

```
Is the recurrence dp[i-1][k] + C(k,j) (layered)?      → maybe Divide & Conquer
   Is C linear in a query value x[j]?                 → use CHT (topic 10)
   Else is opt monotone (Monge C)?                    → use Divide & Conquer (this)
Is the recurrence dp[i][k] + dp[k][j] + C (interval)? → use Knuth (topic 12)
```

### A worked side-by-side on the same cost

Consider the squared-segment-sum cost `C(k, j) = (P[j] − P[k])²` and the layered DP `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k, j) )`. All of the following are true simultaneously, which is why this cost is the canonical teaching example:

- **Divide-and-conquer applies** because `C` is Monge (the quadrangle inequality holds; see the one-line proof in [`professional.md`](./professional.md)). Cost: `O(n log n)` per layer.
- **CHT applies** because expanding `(P[j] − P[k])² = P[j]² − 2P[k]·P[j] + P[k]²` shows the `k`-dependent part `−2P[k]·P[j] + (dp[i-1][k] + P[k]²)` is *linear in `P[j]`* — a line with slope `−2P[k]`. Cost: `O(n)` per layer with monotone queries.
- **Knuth does NOT apply** because the recurrence is layered (`dp[i-1][k] + C`), not interval (`dp[i][k] + dp[k][j]`). There is no second smaller cell of the same DP to combine.

So for this exact cost, you would *prefer CHT* (it is faster, `O(n)`), but divide-and-conquer is the more general fallback that also works for Monge costs with no linear structure. The lesson: applicability is not exclusive — when several tools apply, pick the fastest; when the cost is a general Monge function with no line decomposition, divide-and-conquer is often the only one of the three that works.

---

## Advanced Patterns

### Pattern: Reconstructing the optimal segmentation

Store the chosen split at every cell in an `opt[i][j]` table (one `int` per cell), then backtrack from `(K, n)`.

```
cuts = []
i, j = K, n
while i > 0:
    k = optTable[i][j]
    cuts.append((k, j))     # segment [k, j) is the i-th segment
    j = k
    i -= 1
cuts.reverse()
```

This costs `O(K·n)` extra memory but lets you output the actual partition, not just its cost.

### Pattern: "At most `K`" instead of "exactly `K`"

If segments are allowed to be free/empty or you want the best over `1..K` layers, either (a) add a zero-cost "stay" transition, or (b) take `min over i in 1..K of dp[i][n]`. The recursion itself is unchanged; only the base case and answer cell move.

### Pattern: Layer loop with rolled rows

```
init dp_prev = base (dp[0][*])
for i in 1..K:
    reset dp_cur to +INF
    compute(0, n, 0, n)          # writes dp_cur from dp_prev
    swap(dp_prev, dp_cur)
answer = dp_prev[n]
```

Memory `O(n)` if you do not need reconstruction.

### Pattern: Maximization with the inverse quadrangle inequality

For *maximization* DPs `dp[i][j] = max_{k<j} ( dp[i-1][k] + C(k, j) )`, the relevant condition is the **inverse** quadrangle inequality `C(a,c) + C(b,d) ≥ C(a,d) + C(b,c)` (the `≥` flips). Under it, the *argmax* is non-decreasing in `j`, and the same `compute` recursion works with `max` in place of `min`, identity `−INF` instead of `+INF`, and the strict comparison reversed (`v > best`). Costs built from a *concave* function of segment length are typically inverse-Monge. Everything else — the windows, the `O(n log n)` accounting — is identical.

### Pattern: Penalized single-row variant (drop the layer index)

When the objective is "minimize total cost `+ β · (number of segments)`" rather than "exactly `K` segments," the layer index disappears: `dp[j] = min_{k<j} ( dp[k] + C(k, j) + β )`. This is a *single-row* DP — but note `dp[j]` now depends on `dp[k]` of the *same* row. It is still solvable by divide-and-conquer when `C` is Monge, but requires care: you cannot fill all columns independently because `dp[k]` for `k < mid` must already be known. The standard fix is to combine divide-and-conquer with a different ordering (or use CHT if the cost is linear). For the *layered* "exactly `K`" form, this complication does not arise because `dp_prev` is fully known before the row starts.

---

## Code Examples

### Reusable `compute` with prefix-sum cost (squared segment sums)

This is the same engine as `junior.md`, factored so `compute` reads two module-level rows and a pluggable `cost`.

#### Go

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

func solve(a []int, K int) int64 {
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
	fmt.Println(solve([]int{1, 3, 2, 4}, 2)) // 52
}
```

#### Java

```java
import java.util.Arrays;

public class DCDPMiddle {
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

    static long solve(int[] a, int K) {
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
        System.out.println(solve(new int[]{1, 3, 2, 4}, 2)); // 52
    }
}
```

#### Python

```python
import sys

INF = 1 << 62


def solve(a, K):
    n = len(a)
    prefix = [0] * (n + 1)
    for i, x in enumerate(a):
        prefix[i + 1] = prefix[i] + x

    def cost(k, j):
        s = prefix[j] - prefix[k]
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
    print(solve([1, 3, 2, 4], 2))  # 52
```

### Brute-force oracle that also returns the `opt` table

Use this to validate the `dp` values **and** to assert monotonicity of `opt`.

#### Python

```python
def brute(a, K):
    INF = 1 << 62
    n = len(a)
    pre = [0] * (n + 1)
    for i, x in enumerate(a):
        pre[i + 1] = pre[i] + x

    def cost(k, j):
        s = pre[j] - pre[k]
        return s * s

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
    # monotonicity assertion
    for i in range(1, K + 1):
        for j in range(2, n + 1):
            assert opt[i][j - 1] <= opt[i][j], (i, j, opt[i])
    return dp[K][n]
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `opt` not monotone | Divide-and-conquer skips the true optimum; wrong answer, no crash. | Prove the quadrangle inequality, or assert monotonicity in tests. |
| Tie broken toward larger `k` | Windows passed to halves become inconsistent; subtle wrong answers. | Use strict `<`, keep the smallest `k`. |
| `hi` not clamped to `mid-1` | Allows an empty last segment `k = mid`; bad `C` evaluation. | `hi = min(optR, mid - 1)`. |
| Overflow adding to `INF` | `INF + cost` wraps around to a small value, looks "best." | Skip `k` when `dp_prev[k] >= INF`. |
| Deep recursion | Stack overflow at large `n`. | Raise recursion limit, or use an explicit stack of `(l, r, optL, optR)`. |
| Cost evaluated in `O(n)` | Total blows up to `O(K n² log n)`. | Precompute prefix sums so `C` is `O(1)`. |

---

## Performance Analysis

| `n` | naive row `O(n²)` | D&C row `O(n log n)` | speedup |
|-----|-------------------|----------------------|---------|
| 1 000 | 1 000 000 | ~10 000 | ~100× |
| 10 000 | 100 000 000 | ~130 000 | ~770× |
| 100 000 | 10 000 000 000 | ~1 700 000 | ~5 900× |
| 1 000 000 | 10¹² (infeasible) | ~20 000 000 | feasible |

With `K` layers the totals are `O(K n²)` vs `O(K n log n)`. For `n = 10^5` and `K = 100`, that is `10^{12}` vs ~`1.7·10^8` — the difference between "times out" and "runs in well under a second."

The dominant cost is the split-point scanning: `O(n log n)` evaluations of `C` per layer. Because each `C` call is `O(1)` with prefix sums, the constant factor is small. The recursion's overhead (function calls) is negligible compared to the arithmetic.

```python
# Sanity benchmark sketch (CPython):
# n = 10^5, K = 10 finishes comfortably; the same with the naive O(n^2)
# per layer would be ~10^{11} operations — minutes to hours.
```

The single biggest practical win is keeping `C(k, j)` truly `O(1)`; the second is rolling two rows so memory stays `O(n)`.

---

## Best Practices

- **Confirm monotonicity first.** Either prove the quadrangle inequality or assert `opt[j] ≤ opt[j+1]` on random inputs. Never deploy unverified.
- **Keep `C` `O(1).`** Precompute prefix sums (and prefix sums of squares if needed).
- **Break ties toward the smallest `k`** so the recursion windows stay valid.
- **Clamp `hi = min(optR, mid-1)`** to forbid empty last segments.
- **Roll two rows** for `O(n)` memory; keep an `opt` table only if you must reconstruct cuts.
- **Test against the brute-force oracle** on small `n` and small `K`, diffing every `dp` cell.
- **Know your sibling tools** — reach for Knuth on interval DPs, CHT on linear costs, and this on Monge layered DPs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `compute(l, r, optL, optR)` call tree: which column is `mid`, which split window `[optL, optR]` is scanned.
> - The argmin `opt(mid)` being locked in and splitting the window for the left and right recursive calls.
> - A live counter of split-point checks (D&C) versus the naive `O(n²)` scan count, making the speedup visible.

---

## Summary

Divide-and-conquer DP optimization fills a layered partition row `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k, j) )` in `O(n log n)` by exploiting the **monotonicity of the optimal split point** `opt(i, j) ≤ opt(i, j+1)`. The `compute(l, r, optL, optR)` recursion resolves the middle column by scanning only its window `[optL, min(optR, mid-1)]`, then recurses left with `[optL, opt(mid)]` and right with `[opt(mid), optR]`; the windows overlap at a single point, giving `O(n)` work per level and `O(log n)` levels. The **quadrangle (Monge) inequality** `C(a,c)+C(b,d) ≤ C(a,d)+C(b,c)` on the cost is the clean sufficient condition that *guarantees* this monotonicity. It is distinct from **Knuth optimization** (sibling `12`, interval DP `dp[i][k]+dp[k][j]`, two-sided bound, `O(n²)`) and the **Convex Hull Trick** (sibling `10`, linear cost, envelope of lines). Always tie-break toward the smaller `k`, keep `C` evaluable in `O(1)`, and verify monotonicity before trusting the result.
