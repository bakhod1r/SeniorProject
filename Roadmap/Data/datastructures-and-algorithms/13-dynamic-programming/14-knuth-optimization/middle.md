# Knuth's DP Optimization (Knuth-Yao) — Middle Level

> **Focus:** the opt-bound inequality `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` and *why* it makes the length-ordered DP run in `O(n²)`; the exact conditions on `C` (quadrangle inequality + monotonicity) and how to check them; how Knuth's optimization differs from divide-and-conquer optimization (sibling topic `11`) and the convex-hull trick.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Opt-Bound Inequality and Length-Order Iteration](#the-opt-bound-inequality-and-length-order-iteration)
4. [Conditions on C: How to Check Them](#conditions-on-c-how-to-check-them)
5. [Comparison with Alternatives](#comparison-with-alternatives)
6. [Advanced Patterns](#advanced-patterns)
7. [Applications: Optimal BST and Optimal Merging](#applications-optimal-bst-and-optimal-merging)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: under the right conditions, `opt[i][j]` is monotone, so restrict the `k`-loop to `[opt[i][j-1], opt[i+1][j]]` and the DP drops from `O(n³)` to `O(n²)`. At middle level you start asking the engineering questions that decide whether the speedup is *correct* and *actually fast*:

- *Why* exactly is the optimal split monotone, and what is the precise chain of implications (QI on `C` ⇒ QI on `dp` ⇒ monotone `opt`)?
- The opt-bound says `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`. How does that, combined with **length-order iteration**, telescope into `O(n²)` — and not, say, `O(n² log n)`?
- What are the **two conditions** on `C` (quadrangle inequality and monotonicity), and how do I *check* them for a new problem before I trust the window?
- How is this different from **divide-and-conquer optimization** (topic `11`), which *also* exploits a monotone optimal split? They look similar — when do I reach for which?

These are the questions that separate "I memorized the window bounds" from "I can recognize a Knuth-optimizable DP in the wild and prove it correct."

---

## Deeper Concepts

### The recurrence and the `opt` table

Knuth's optimization targets the two-sided interval recurrence

```
dp[i][j] = C(i, j) + min over i ≤ k < j of ( dp[i][k] + dp[k+1][j] )      (j > i)
dp[i][i] = base(i)                                                          (base case)
```

Define `opt[i][j]` as the *smallest* `k` attaining the minimum (smallest for a deterministic tie-break). The optimization rests on a single structural claim:

> **Opt-bound.** `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`.

Everything else — the loop bounds, the telescoping, the `O(n²)` — is mechanical once you accept this claim. The claim itself follows from `dp` satisfying the quadrangle inequality, which in turn follows from `C` satisfying it (the full implication chain is proved in [`professional.md`](./professional.md); here we use it).

### The quadrangle inequality (QI)

A function `f` on intervals satisfies the **quadrangle inequality** if for all `a ≤ b ≤ c ≤ d`:

```
f(a, c) + f(b, d)  ≤  f(a, d) + f(b, c)
```

Read it as: the two "crossing/overlapping" intervals `(a,c)` and `(b,d)` together cost **no more** than the "nested" pair `(a,d)` (widest) and `(b,c)` (narrowest). This is the discrete analogue of *concavity* / the **Monge condition** on a matrix. It is the exact hypothesis that forces the optimal split to be monotone.

### Monotonicity (on intervals)

`f` is **monotone on intervals** if `[b, c] ⊆ [a, d]` implies `f(b, c) ≤ f(a, d)` — shrinking an interval never increases its cost. For optimal BST, `C = W` is a sum of non-negative frequencies, so a sub-interval's sum is no larger: monotonicity holds.

QI + monotonicity on `C` together imply QI on `dp` (Yao's theorem), and QI on `dp` implies the opt-bound. That is the logical spine of the whole topic.

### The implication chain at a glance

```
C satisfies QI  ──┐
                  ├──► dp satisfies QI ──► opt is monotone ──► O(n²) windowed DP
C is monotone  ───┘
   (Yao's theorem)      (crossing argument)   (telescoping)
```

Each arrow is a theorem proved in [`professional.md`](./professional.md). At middle level you do not need to reproduce the proofs, but you must know *which* hypotheses feed *which* conclusion: both QI and monotonicity of `C` are needed for the first arrow (this is the precise difference from D&C optimization, which needs only QI for its one-sided recurrence). Forgetting the monotonicity requirement and applying Knuth to a non-monotone cost is a real, silent bug.

---

## The Opt-Bound Inequality and Length-Order Iteration

### Why length order is mandatory

`opt[i][j]` is bounded by `opt[i][j-1]` and `opt[i+1][j]`. Both are intervals of length `(j-i) - 1`, i.e. *exactly one shorter* than `[i, j]`. So if you fill the table by **increasing interval length**, both bounds are guaranteed to be ready when you need them:

```
for length = 1 .. n-1:                 # length = j - i
    for i = 0 .. n-1-length:
        j = i + length
        lo = opt[i][j-1]               # length-1 shorter: already done
        hi = opt[i+1][j]               # length-1 shorter: already done
        dp[i][j] = INF
        for k = lo .. hi:              # the restricted window
            v = dp[i][k] + dp[k+1][j] + C(i, j)
            if v < dp[i][j]:
                dp[i][j] = v
                opt[i][j] = k
```

Any other fill order (e.g. by `i` then `j`) breaks the guarantee — you would read `opt` values that have not been computed yet.

### The telescoping argument (`O(n²)`)

Fix a length `L`. The total inner-loop work over all length-`L` intervals is the sum of window widths:

```
Σ over i ( opt[i+1][i+L] − opt[i][i+L-1] + 1 )
```

Split this into the `+1` terms and the difference terms. The `+1` terms sum to `(number of length-L intervals) = n − L ≤ n`. The difference terms **telescope**: with `i` ranging, `opt[1][1+L] − opt[0][L-1] + opt[2][2+L] − opt[1][L] + …`. The `opt[i+1][i+L]` of one term and the `opt[i][i+L-1]` of the *next* term are *almost* the same index family, and summing across `i` collapses to `(last upper bound) − (first lower bound) ≤ n`. So the total for length `L` is `O(n)`.

There are `n` distinct lengths, so the grand total is **`O(n) × n = O(n²)`**. The crucial point: the *per-interval* window can be wide, but the windows for a fixed length **overlap and telescope**, so their *combined* width is `O(n)`, not `O(n²)`.

### A worked telescoping illustration

Suppose for length `L` the `opt` values are `opt[0][L-1]=0, opt[1][L]=2, opt[2][L+1]=2, opt[3][L+2]=5`. The windows for length `L+1` intervals are:

```
[0,2] width 3
[2,2] width 1
[2,5] width 4
```

Naively each could be up to `n` wide, but their *sum* is `3 + 1 + 4 = 8`, and the upper ends `2, 2, 5` minus the lower ends `0, 2, 2` plus counts telescope to `≈ 5 − 0 + 3 = 8`. The bound `(last hi) − (first lo) + count` controls it. Across all lengths this stays `O(n²)`.

### A common misconception about the bound

A frequent mistake is to reason "each interval's window can be `O(n)` wide, there are `O(n²)` intervals, so it is `O(n³)`." That bounds each window *independently* and misses the telescoping. The correct accounting is *per length*: the windows of all intervals of a fixed length **share endpoints** (`hi` of interval `i` equals `lo` of interval `i+1`), so their combined width is `O(n)`, not `O(n²)`. The per-interval window being occasionally wide is fine — what matters is that across a diagonal the wide windows must be "paid for" by narrow ones, because the `opt` values are monotone along the diagonal and cannot all be spread out. This subtle amortized reasoning is the single most important thing to internalize at middle level; without it you cannot convince yourself (or an interviewer) that the speedup is real.

### Empirical confirmation

The cleanest way to *see* `O(n²)` is to instrument the solver: count the total candidates the inner loop actually evaluates. For random optimal-BST inputs you will observe the count grows like `c · n²` (not `n³`), and the per-length window-width sums each stay `≤ 2n`. The benchmark task in [`tasks.md`](./tasks.md) (Task B) does exactly this and prints the ratio `naive_candidates / knuth_candidates ≈ Θ(n)`, the empirical signature of the dropped factor.

---

## Conditions on C: How to Check Them

You may only restrict the loop if `C` satisfies **both** conditions. Here is a practical checklist.

### Condition 1 — Quadrangle inequality

```
C(a, c) + C(b, d) ≤ C(a, d) + C(b, c)   for all a ≤ b ≤ c ≤ d
```

How to verify, in order of preference:

1. **Recognize a known QI form.** If `C(i, j) = Σ_{t=i}^{j} w_t` with `w_t ≥ 0` (a non-negative range sum), QI holds — in fact with **equality** (both sides equal `Σ_{a..d} + Σ_{b..c}`). This covers optimal BST and optimal merging directly.
2. **Use the "adjacent" reduction.** QI for all `a ≤ b ≤ c ≤ d` is equivalent to QI on *adjacent* arguments: `C(i, j) + C(i+1, j+1) ≤ C(i, j+1) + C(i+1, j)` for all `i < j`. Checking this `O(n²)` set of inequalities is enough (proof in `professional.md`). This is a cheap programmatic test.
3. **Brute-force on small instances.** In a unit test, enumerate all `a ≤ b ≤ c ≤ d` and assert the inequality. Combine with random fuzzing.

### Condition 2 — Monotonicity

```
C(b, c) ≤ C(a, d)   whenever a ≤ b ≤ c ≤ d   (i.e. [b,c] ⊆ [a,d])
```

For a non-negative range sum this is immediate. For a general `C`, again test programmatically on adjacent intervals: `C(i+1, j) ≤ C(i, j)` and `C(i, j-1) ≤ C(i, j)` for all `i ≤ j`.

### A worked QI check

Take weights `w = [3, 1, 4]`, `C(i, j) = Σ w[i..j]`. The adjacent QI for `i=0, j=1` reads `C(0,1) + C(1,2) ≤ C(0,2) + C(1,1)`. Compute: `C(0,1) = 4`, `C(1,2) = 5`, `C(0,2) = 8`, `C(1,1) = 1`. Left `= 4 + 5 = 9`; right `= 8 + 1 = 9`. **Equality** — as Lemma 2.2 predicts for range sums (QI holds with equality, never strictly). Monotonicity: `C(1,2) = 5 ≤ C(0,2) = 8` ✓ and `C(0,1) = 4 ≤ C(0,2) = 8` ✓. Both conditions pass, so Knuth applies. This hand check is exactly what the programmatic verifier automates over all `i, j`.

### What you get if both hold

By Yao's theorem (proved in `professional.md`):

- `dp` itself satisfies the quadrangle inequality, and
- `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` (the opt-bound),

so the restricted-window DP is **correct** and runs in `O(n²)`.

### Beyond range sums

The range-sum case is the common one, but Knuth works for *any* QI + monotone `C`. A useful non-obvious example: `C(i, j) = (Σ w[i..j])²` (squared range sum, non-negative weights) also satisfies QI and monotonicity (the algebra reduces to `−2xy ≤ 0`; see `professional.md` §11.5). Such squared costs appear in segment-partition interval DPs. The takeaway: do not assume "only range sums" — run the verifier or do the algebra, and you may find the optimization applies more broadly than you expected.

### A programmatic verifier

```python
def satisfies_qi(C, n):
    # adjacent-argument form is sufficient
    for i in range(n):
        for j in range(i + 1, n):
            if C(i, j) + C(i + 1, j + 1) > C(i, j + 1) + C(i + 1, j):
                return False
    return True


def is_monotone(C, n):
    for i in range(n):
        for j in range(i + 1, n):
            if C(i + 1, j) > C(i, j) or C(i, j - 1) > C(i, j):
                return False
    return True
```

Run both before enabling the window in any new application.

---

## Comparison with Alternatives

### Knuth's optimization vs divide-and-conquer optimization (topic `11`)

Both exploit a *monotone optimal split*, but they target **different recurrence shapes**.

| | **Knuth's optimization** | **D&C optimization (topic 11)** |
|--|--------------------------|----------------------------------|
| Recurrence | `dp[i][j] = C(i,j) + min_{i≤k<j}(dp[i][k] + dp[k+1][j])` | `dp[t][i] = min_{k<i}(dp[t-1][k] + C(k, i))` |
| State | an **interval** `[i, j]` (two-sided split) | a position `i` (often with a *layer* `t`) |
| Monotone fact | `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` | `opt[t][i]` nondecreasing in `i` |
| Condition | QI **and** monotonicity on `C` | QI on `C` (or "`opt` monotone" empirically) |
| Speedup | `O(n³) → O(n²)` | `O(kn²) → O(kn log n)` |
| Fill strategy | by increasing interval length | recursive divide-and-conquer over the `k`-range |
| Canonical app | optimal BST, optimal merging | layered partition DP (split array into `k` segments) |

The deciding question: **does my subproblem split into a *left* and a *right* sub-interval that both recurse (Knuth), or does it reference a *previous layer* `dp[t-1][k]` plus a cost (D&C)?** Optimal BST is two-sided ⇒ Knuth. "Partition an array into `k` contiguous groups minimizing cost" is layered ⇒ D&C.

### Knuth vs convex-hull trick / Li Chao tree

The **convex-hull trick** (CHT) speeds up `dp[i] = min_j (dp[j] + b_j · a_i)` where the transition is a *linear* function of `i`. That is a different structure entirely — it needs the cost to be linear in a query variable, not a Monge interval cost. Use CHT for "line-shaped" transitions; use Knuth for two-sided interval DPs with a Monge `C`.

### Summary decision table

| Recurrence form | Tool | Result |
|-----------------|------|--------|
| `dp[i][j] = C(i,j) + min_k (dp[i][k] + dp[k+1][j])`, `C` QI+monotone | **Knuth** | `O(n²)` |
| `dp[t][i] = min_k (dp[t-1][k] + C(k,i))`, `C` QI / `opt` monotone | **D&C opt** | `O(kn log n)` |
| `dp[i] = min_j (dp[j] + b_j·a_i)`, lines | **CHT / Li Chao** | `O(n log n)` |
| general interval DP, no QI | none | stays `O(n³)` |
| `dp[i][j] = min_k(dp[i][k] + dp[k+1][j] + C(i,j,k))`, `C` depends on `k` | none (e.g. matrix chain) | stays `O(n³)` |

### The litmus test in one question

When you see an interval DP, ask: *"Is the added cost `C(i, j)` (independent of the split `k`), and is it a non-negative range sum (or otherwise QI + monotone)?"* If yes to both → Knuth, `O(n²)`. If the cost depends on `k` (matrix chain's `p[i]·p[k+1]·p[j+1]`), Knuth does **not** apply — the optimal split is not monotone and the DP stays `O(n³)`. This single question separates the Knuth-optimizable interval DPs from the look-alikes, and it is the first thing to check before reaching for the window.

---

## Advanced Patterns

### Pattern: generic Knuth solver parameterized by `C`

Factor `C` out so the same engine serves optimal BST, optimal merging, and any other QI+monotone interval DP.

```python
def knuth(n, base, C):
    """dp[i][j] = C(i,j) + min_{i<=k<j}(dp[i][k]+dp[k+1][j]); base(i)=dp[i][i]."""
    INF = float("inf")
    dp = [[0] * n for _ in range(n)]
    opt = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = base(i)
        opt[i][i] = i
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            lo, hi = opt[i][j - 1], opt[i + 1][j]
            for k in range(lo, hi + 1):
                v = dp[i][k] + dp[k + 1][j] + C(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = k
    return dp, opt
```

### Pattern: reconstruct the optimal structure

`opt[i][j]` is the split (or root). Recurse to print the tree / merge order:

```python
def reconstruct(opt, i, j):
    if i > j:
        return None
    k = opt[i][j]
    return {"split": k, "left": reconstruct(opt, i, k), "right": reconstruct(opt, k + 1, j)}
```

### Pattern: the BST root indexing variant

For optimal BST the split is the *root* `r` with children `[i, r-1]` and `[r+1, j]`. The opt-bound becomes `root[i][j-1] ≤ root[i][j] ≤ root[i+1][j]` — same monotonicity, indices shifted. Keep the convention consistent across the whole solve.

---

## Applications: Optimal BST and Optimal Merging

### Optimal binary search tree (Knuth's original, 1971)

Given keys with access frequencies `freq[0..n-1]`, build a BST minimizing the expected search cost `Σ freq[key] × depth(key)`. The DP:

```
dp[i][j] = W(i, j) + min over root r in [i, j] of ( dp[i][r-1] + dp[r+1][j] )
W(i, j)  = freq[i] + … + freq[j]   (non-negative range sum ⇒ QI + monotone)
```

Because `W` is a non-negative range sum, QI and monotonicity hold automatically, and Knuth's optimization gives `O(n²)`. This is the textbook example because Knuth invented the technique precisely to solve it efficiently.

### Optimal file merging (a.k.a. optimal merge cost / stone merging)

You have `n` files (or "stones") in a row with sizes `s[0..n-1]`. Repeatedly merge two **adjacent** groups; merging a group of total size `S` costs `S`. Find the minimum total merge cost. The DP:

```
dp[i][j] = W(i, j) + min over k in [i, j-1] of ( dp[i][k] + dp[k+1][j] )
W(i, j)  = s[i] + … + s[j]   (the cost of the final merge that joins the two halves)
```

Again `W` is a non-negative range sum ⇒ QI + monotone ⇒ `O(n²)` via Knuth. (Note: this is the *adjacent*-merge cost problem; the *non-adjacent* version is Huffman coding, solved greedily in `O(n log n)` — a different problem.)

Both applications share the same skeleton; only `base` and the interpretation differ.

### Optimal alphabetic / leaf-weighted trees

A third member of the family: given leaf weights `w[0..n-1]` in **fixed order**, build a binary tree whose leaves are those weights in order, minimizing `Σ w_i · depth(leaf_i)`. The DP is identical (`C = Σ w` range sum), so Knuth gives `O(n²)`. This is the alphabetic-tree problem; note that specialized algorithms (Hu-Tucker, Garsia-Wachs) solve it in `O(n log n)` by exploiting extra structure, but the `O(n²)` Knuth solution is far simpler to implement and correct. When `n` is in the thousands, Knuth is usually the pragmatic choice; reach for Hu-Tucker only when `n²` memory or time is genuinely prohibitive.

### What ties them together

All three — optimal BST, adjacent merging, alphabetic trees — are "build a binary structure over a *contiguous range*, paying a range-sum cost per internal node." That shared shape is exactly why the same `knuth(n, base, C)` engine (above) solves all of them by swapping only `base` and `C`. Recognizing this family in a problem statement is the practical skill: if you can phrase it as "split a contiguous range into a left and right part, pay a range sum," you almost certainly have a Knuth-optimizable `O(n²)` solution.

---

## Code Examples

### Optimal file merging — naive `O(n³)` vs Knuth `O(n²)`, all three languages

#### Go

```go
package main

import "fmt"

const INF = int64(1) << 60

func mergeCostKnuth(s []int64) int64 {
	n := len(s)
	pre := make([]int64, n+1)
	for i := 0; i < n; i++ {
		pre[i+1] = pre[i] + s[i]
	}
	W := func(i, j int) int64 { return pre[j+1] - pre[i] }

	dp := make([][]int64, n)
	opt := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int64, n)
		opt[i] = make([]int, n)
		opt[i][i] = i // dp[i][i] = 0 (single file, no merge)
	}
	for length := 1; length < n; length++ {
		for i := 0; i+length < n; i++ {
			j := i + length
			dp[i][j] = INF
			lo, hi := opt[i][j-1], opt[i+1][j]
			for k := lo; k <= hi; k++ {
				if v := dp[i][k] + dp[k+1][j] + W(i, j); v < dp[i][j] {
					dp[i][j] = v
					opt[i][j] = k
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	fmt.Println(mergeCostKnuth([]int64{10, 20, 30})) // 90
}
```

#### Java

```java
public class MergeCost {
    static final long INF = 1L << 60;

    static long mergeCostKnuth(long[] s) {
        int n = s.length;
        long[] pre = new long[n + 1];
        for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + s[i];

        long[][] dp = new long[n][n];
        int[][] opt = new int[n][n];
        for (int i = 0; i < n; i++) opt[i][i] = i; // dp[i][i] = 0
        for (int len = 1; len < n; len++)
            for (int i = 0; i + len < n; i++) {
                int j = i + len;
                dp[i][j] = INF;
                int lo = opt[i][j - 1], hi = opt[i + 1][j];
                long w = pre[j + 1] - pre[i];
                for (int k = lo; k <= hi; k++) {
                    long v = dp[i][k] + dp[k + 1][j] + w;
                    if (v < dp[i][j]) { dp[i][j] = v; opt[i][j] = k; }
                }
            }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(mergeCostKnuth(new long[]{10, 20, 30})); // 90
    }
}
```

#### Python

```python
INF = float("inf")


def merge_cost_naive(s):
    n = len(s)
    pre = [0] * (n + 1)
    for i, v in enumerate(s):
        pre[i + 1] = pre[i] + v
    W = lambda i, j: pre[j + 1] - pre[i]
    dp = [[0] * n for _ in range(n)]
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            for k in range(i, j):                      # ALL splits
                dp[i][j] = min(dp[i][j], dp[i][k] + dp[k + 1][j] + W(i, j))
    return dp[0][n - 1]


def merge_cost_knuth(s):
    n = len(s)
    pre = [0] * (n + 1)
    for i, v in enumerate(s):
        pre[i + 1] = pre[i] + v
    W = lambda i, j: pre[j + 1] - pre[i]
    dp = [[0] * n for _ in range(n)]
    opt = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            lo, hi = opt[i][j - 1], opt[i + 1][j]       # restricted window
            for k in range(lo, hi + 1):
                v = dp[i][k] + dp[k + 1][j] + W(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = k
    return dp[0][n - 1]


if __name__ == "__main__":
    s = [10, 20, 30]
    assert merge_cost_naive(s) == merge_cost_knuth(s)
    print(merge_cost_knuth(s))  # 90
```

For `[10, 20, 30]`: merge 10+20=30 (cost 30), then 30+30=60 (cost 60) → total `90`. Knuth and naive agree.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `C` not QI | Window excludes the true optimum; answer too large. | Verify QI (adjacent form) before enabling the window. |
| `C` not monotone | Same — opt-bound fails. | Verify monotonicity; for non-negative range sums it is automatic. |
| Wrong fill order | Reads uninitialized `opt[i][j-1]`/`opt[i+1][j]`. | Fill by increasing interval length, always. |
| `O(n)` cost recompute | `O(n²)` silently becomes `O(n³)`. | Prefix-sum `C` to `O(1)` per query. |
| Inconsistent ties | Monotonicity of `opt` breaks for larger intervals. | Always pick the smallest (or always largest) optimal `k`. |
| Overflow | `dp` exceeds 32-bit. | Use `int64`/`long`. |

---

## Performance Analysis

| `n` | Naive `O(n³)` | Knuth `O(n²)` |
|-----|---------------|---------------|
| 100 | 10⁶ | 10⁴ |
| 500 | 1.25 × 10⁸ | 2.5 × 10⁵ |
| 1000 | 10⁹ (seconds) | 10⁶ (instant) |
| 5000 | 1.25 × 10¹¹ (minutes) | 2.5 × 10⁷ (well under a second) |
| 10000 | 10¹² (infeasible) | 10⁸ (≈ a second) |

The single factor of `n` saved is the difference between `n ≈ 500` and `n ≈ 10000` being feasible. The constant factor is the same simple inner loop in both; the only change is the loop bounds, so the speedup is "free" once the conditions are verified.

```python
import time, random

def bench(n):
    s = [random.randint(1, 100) for _ in range(n)]
    t0 = time.perf_counter(); merge_cost_knuth(s)
    return time.perf_counter() - t0
# Knuth at n=2000 finishes in well under a second; naive would take many seconds.
```

The biggest correctness lever is the **verification step**; the biggest performance lever is the **prefix-summed `C`** (never recompute the range sum in the loop).

---

## Best Practices

- **Verify QI + monotonicity** (adjacent form is sufficient) before enabling the window — make it a unit test.
- **Fill by increasing interval length** so both `opt` neighbors are ready.
- **Prefix-sum `C`** to keep each cost query `O(1)`; otherwise you lose the speedup.
- **Break ties consistently** (smallest optimal `k`) to preserve `opt` monotonicity.
- **Keep a naive `O(n³)` oracle** and assert equality on random small inputs in CI.
- **Pick one indexing convention** (generic split vs BST root) and use it everywhere to avoid off-by-one bugs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The DP table filled diagonal-by-diagonal (increasing interval length).
> - The **restricted window** `[opt[i][j-1], opt[i+1][j]]` shown against the full `[i, j]` range, so you can see how few candidates are actually scanned.
> - The running tally of "candidates scanned" demonstrating the telescoping to `O(n²)`.

---

## Summary

Knuth's optimization works because, under the quadrangle inequality and monotonicity of the per-interval cost `C`, the optimal split is **monotone**: `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`. Filling the interval DP by **increasing length** makes both bounds available, so the inner `k`-loop is restricted to that window. The window widths, summed over all intervals of a fixed length, **telescope** to `O(n)`, giving `O(n²)` total across all `n` lengths — a clean factor-of-`n` win over the naive `O(n³)`. The two conditions on `C` are checkable (adjacent-argument QI and monotonicity; both automatic for non-negative range sums), and they distinguish Knuth's optimization from **divide-and-conquer optimization** (topic `11`), which targets the *layered* recurrence `dp[t][i] = min_k(dp[t-1][k] + C(k, i))` rather than the two-sided interval split. Recognize the shape, verify the conditions, restrict the loop — and an `O(n³)` interval DP becomes `O(n²)` with a one-line change.

The middle-level mental model to carry forward: the optimization is *amortized*, not per-interval. Do not be alarmed that a single window can be wide — what guarantees `O(n²)` is that along each diagonal the windows tile (the upper bound of one is the lower bound of the next). And before applying any of it, run the litmus test: *is the added cost `C(i, j)` independent of the split, and QI + monotone (a non-negative range sum being the easy yes)?* If so, you have an `O(n²)` solution; if the cost depends on `k` (like matrix chain), you do not, no matter how similar the recurrence looks.
