# Knuth's DP Optimization (Knuth-Yao) — Interview Preparation

Knuth's optimization is a favourite for interviews that want to test depth on dynamic programming, because it rewards a single crisp insight — *"under the quadrangle inequality, the optimal split is monotone, so `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, which shrinks the `k`-loop and turns `O(n³)` into `O(n²)`"* — and then checks whether you can (a) state the recurrence shape it applies to, (b) explain the telescoping that yields `O(n²)`, (c) verify the conditions on the cost `C`, (d) distinguish it from divide-and-conquer optimization, and (e) implement optimal BST / optimal merge cleanly. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `dp[i][j] = C(i,j) + min_k(dp[i][k] + dp[k+1][j])`, `C` QI+monotone | Knuth's optimization | `O(n²)` |
| Optimal binary search tree | Knuth (root window) | `O(n²)` |
| Optimal adjacent file/stone merging | Knuth (split window) | `O(n²)` |
| `dp[t][i] = min_k(dp[t-1][k] + C(k,i))`, layered | D&C optimization (topic 11) | `O(kn log n)` |
| `dp[i] = min_j(dp[j] + b_j·a_i)`, linear | convex-hull trick / Li Chao | `O(n log n)` |
| Generic interval DP, no QI | naive | `O(n³)` |
| **Count simple paths / Huffman / non-adjacent merge** | **not Knuth** | — |

The opt-bound and the window:

```text
opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]
=> inner loop: for k in [opt[i][j-1], opt[i+1][j]]
=> windows telescope per length => O(n^2) total
```

Core algorithm:

```text
for length = 1 .. n-1:
    for i = 0 .. n-1-length:
        j = i + length
        dp[i][j] = INF
        for k = opt[i][j-1] .. opt[i+1][j]:   # restricted window
            v = dp[i][k] + dp[k+1][j] + C(i, j)
            if v < dp[i][j]: dp[i][j] = v; opt[i][j] = k
```

Key facts:
- **Conditions:** `C` must satisfy the **quadrangle inequality** `C(a,c)+C(b,d) ≤ C(a,d)+C(b,c)` (a ≤ b ≤ c ≤ d) **and** monotonicity on intervals.
- **Non-negative range sums** (`C = Σ w_t`, `w_t ≥ 0`) satisfy both automatically — QI with equality.
- **Fill by increasing interval length** so both `opt` neighbors are ready.
- The speedup is **amortized**: per interval the window can be wide, but per length the windows telescope to `O(n)`.

---

## Junior Questions (12 Q&A)

### J1. What recurrence does Knuth's optimization speed up?
The two-sided interval DP `dp[i][j] = C(i,j) + min over i ≤ k < j of (dp[i][k] + dp[k+1][j])`, where a subproblem on interval `[i, j]` splits into a left part `[i, k]` and a right part `[k+1, j]`, plus a per-interval cost `C(i, j)`. The canonical example is the optimal binary search tree.

### J2. What is the speedup?
From `O(n³)` (naive: `O(n²)` intervals × `O(n)` split candidates) to `O(n²)`. A full factor of `n`, just by restricting the inner loop.

### J3. What is the key fact that makes it work?
The optimal split is monotone: `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`. So instead of scanning all `k ∈ [i, j-1]`, you scan only the window between the two already-computed neighbors' optima.

### J4. What is `opt[i][j]`?
The split point `k` (or the BST root) that achieves the minimum for interval `[i, j]`. You store it both for the speedup (it bounds the next window) and for reconstructing the optimal tree/order.

### J5. Why must you fill the table by increasing interval length?
Because `opt[i][j]` is bounded by `opt[i][j-1]` and `opt[i+1][j]`, which are intervals exactly one shorter. Filling by increasing length guarantees both are already computed when you reach `[i, j]`.

### J6. What is the optimal binary search tree problem?
Given keys with access frequencies, build a BST minimizing the expected search cost `Σ freq[key] × depth(key)`. Frequent keys should be near the root. It is Knuth's original 1971 application of this technique.

### J7. What is the cost `C(i, j)` for optimal BST?
`W(i, j) = Σ freq[i..j]`, the total frequency of the keys in the range — the penalty for everyone in `[i, j]` going one level deeper when you pick a root. It is a non-negative range sum.

### J8. What are the two conditions on `C`?
The quadrangle inequality (`C(a,c)+C(b,d) ≤ C(a,d)+C(b,c)` for `a ≤ b ≤ c ≤ d`) and monotonicity (`[b,c] ⊆ [a,d]` ⇒ `C(b,c) ≤ C(a,d)`). Both hold automatically for a non-negative range sum.

### J9. Does the speedup change the answer?
No. It computes exactly the same `dp` values; the window provably contains the true optimal split, so the restricted minimum equals the full minimum.

### J10. How do you compute `C(i, j) = Σ w[i..j]` fast?
Prefix sums: `pre[j+1] - pre[i]` in `O(1)` after an `O(n)` precompute. Recomputing the sum in the loop would reintroduce an `O(n)` factor and ruin the `O(n²)`.

### J11. What is another application besides optimal BST?
Optimal adjacent file/stone merging: merge adjacent groups, each merge costs the combined size; minimize total cost. The cost is again a non-negative range sum, so Knuth gives `O(n²)`.

### J12 (analysis). Why is the total work `O(n²)` and not `O(n³)` even though a window can be wide?
For a fixed interval length, the windows of consecutive intervals **telescope**: the upper bound of one interval's window equals the lower bound of the next's. So their combined width is `O(n)` per length, and over `n` lengths it is `O(n²)`.

---

## Middle Questions (12 Q&A)

### M1. State and explain the quadrangle inequality.
`C(a,c) + C(b,d) ≤ C(a,d) + C(b,c)` for `a ≤ b ≤ c ≤ d`. Intuitively, two "overlapping" intervals cost no more than the "nested" widest+narrowest pair. It is the discrete analogue of concavity (the concave Monge condition), and it is the exact hypothesis that forces the optimal split to be monotone.

### M2. How do you check QI for a new cost function without `O(n⁴)` work?
Check the *adjacent* form: `C(i,j) + C(i+1,j+1) ≤ C(i,j+1) + C(i+1,j)` for all `i < j`. This `O(n²)` set of inequalities is equivalent to full QI. Check monotonicity similarly on adjacent intervals.

### M3. Why is a non-negative range sum always QI and monotone?
QI: both sides equal `Σ_{[a,d]} + Σ_{[b,c]}` (each covers the overlap the same number of times), so QI holds with *equality*. Monotone: a sub-interval sum of non-negative weights is no larger than the bigger interval's sum.

### M4. Walk through the implication chain that proves correctness.
`C` is QI + monotone ⇒ (Yao's theorem) `dp` is QI ⇒ (crossing argument) `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` ⇒ the window contains the true optimum ⇒ the restricted scan is correct and runs in `O(n²)`.

### M5. How does Knuth's optimization differ from divide-and-conquer optimization?
Knuth targets the *two-sided* interval recurrence `dp[i][j] = C(i,j) + min_k(dp[i][k] + dp[k+1][j])` and gives `O(n²)`. D&C optimization (topic `11`) targets the *one-sided layered* recurrence `dp[t][i] = min_k(dp[t-1][k] + C(k,i))` and gives `O(kn log n)`. Both use a monotone optimal split, but the recurrence shape and the complexity differ.

### M6. Why does Knuth need monotonicity of `C` but D&C optimization does not?
For the two-sided recurrence, `dp` only inherits QI (and hence monotone `opt`) if `C` is *also* monotone (Yao's theorem). The one-sided D&C recurrence's `opt` monotonicity follows from QI of `C` alone, because the previous-layer term is a fixed function, not a recursively coupled interval.

### M7. How do you reconstruct the optimal tree?
Recurse on the `opt` table: `opt[i][j]` is the root/split; recurse into `[i, opt[i][j]-1]` and `[opt[i][j]+1, j]` (BST root form) or `[i, opt[i][j]]` and `[opt[i][j]+1, j]` (generic split). It is `O(n)`.

### M8. Why must tie-breaking be consistent?
The monotone-opt theorem holds for a fixed tie-break (e.g. smallest optimal `k`). Mixing rules can produce an `opt` that violates the sandwich `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, which corrupts the window for larger intervals.

### M9. What is the space complexity?
`O(n²)` for the `dp` table and `O(n²)` for the `opt` table. The optimization does not reduce space — only time. At large `n`, the `n²` memory can become the binding constraint.

### M10. When is Knuth's optimization the wrong tool?
When the recurrence is not the two-sided interval form (it might be layered ⇒ D&C, or linear ⇒ convex-hull trick); when `C` is not QI/monotone (e.g. negative weights break monotonicity); or when `n` is so small the naive `O(n³)` is simpler and fine.

### M11. Optimal adjacent merging vs Huffman coding — what's the difference?
Optimal *adjacent* merging only merges neighbors, so order is fixed and the structure is an interval DP (Knuth, `O(n²)`). Huffman coding merges *any* two groups, which is a different combinatorial object solved greedily in `O(n log n)`. Do not use Knuth for Huffman.

### M12 (analysis). Why can't Knuth's optimization reach `O(n log n)` like D&C?
The two-sided recurrence has `Θ(n²)` interval cells, each needing its own minimization, coupled along the length axis. The optimization removes only the inner `O(n)` scan; the `Θ(n²)` cell count remains. D&C has fewer effective minima per layer and a recursion that exploits monotonicity globally.

---

## Senior Questions (10 Q&A)

### S1. How do you verify Knuth applies to a brand-new problem?
Confirm the recurrence is the two-sided interval form, then verify `C` satisfies QI and monotonicity using the `O(n²)` adjacent-argument checks. For non-negative range sums, cite the range-sum lemma instead of testing. Additionally, run the `O(n³)` oracle on random instances and assert `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`.

### S2. What is the danger of applying Knuth when the conditions fail?
The restricted window may exclude the true optimum and return a *larger* value — no crash, no warning, just a silently wrong-but-plausible answer. The technique is exact-or-wrong with no graceful degradation, which is why verification matters.

### S3. What numeric concerns arise?
`dp` for optimal BST reaches `≈ n²·F` (frequency-weighted depth), which overflows 32-bit; use 64-bit for both `dp` and the prefix sums. Keep `INF < MAX/2` so `dp[i][k] + dp[k+1][j]` cannot overflow when both are `INF` transiently. Avoid floating point for exact integer costs (ties become fuzzy).

### S4. How does this relate to Monge matrices and total monotonicity?
QI is exactly the concave Monge condition. The cost matrices in the DP are totally monotone, so their row minima (optimal splits) are monotone. SMAWK finds all row minima of a totally monotone matrix in `O(m+n)`; for the two-sided recurrence the cell coupling prevents a single SMAWK pass, leaving the amortized window scan at `O(n²)`.

### S5. How would you handle very large `n` where the `O(n²)` table doesn't fit?
Use `int32` for `opt`; the `int64` `dp` table is the heavy part (800 MB at `n=10⁴`). If the problem is the specific alphabetic/leaf-weighted tree, switch to Hu-Tucker or Garsia-Wachs (`O(n log n)`, no `n²` table). Otherwise, the two-sided interval DP fundamentally needs the table.

### S6. How do you test a Knuth implementation?
Equality against the `O(n³)` oracle on thousands of random small inputs; an opt-bound assertion (`opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`); a QI/monotonicity verifier on `C`; a reconstruction round-trip (cost of reconstructed tree equals `dp[0][n-1]`); cross-language determinism with a fixed tie-break.

### S7. Optimal BST with miss/dummy probabilities — does Knuth still apply?
Yes. The cost becomes `W(i,j) = Σ keys + Σ dummies` over the range, still a non-negative range sum, so QI and monotonicity hold and the root window `root[i][j-1] ≤ root[i][j] ≤ root[i+1][j]` is valid. The DP indices include the dummy slots, but the structure is unchanged.

### S8. Sketch Yao's theorem (QI on `C` ⇒ QI on `dp`).
Induct on interval length; reduce to the adjacent QI of `dp`. Split on whether the two optimal sub-splits `y, z` satisfy `z ≤ y` or `z > y`; choose valid suboptimal splits for the left side; the difference reduces to QI of `C` (handles the additive cost) plus the inductive QI of `dp` (handles the recursive terms), with monotonicity of `C` keeping the exchanged splits valid.

### S9. Why is the complexity `O(n²)` and not just "smaller"? Give the telescoping.
For fixed length `L`, total inner work is `Σ_i (opt[i+1][i+L] − opt[i][i+L-1] + 1)`. The `+1`s sum to `≤ n`; the differences telescope because `opt[i+1][i+L]` (upper bound of interval `i`) equals the lower bound of interval `i+1`, so the sum collapses to `opt[last] − opt[first] ≤ n`. Thus `O(n)` per length, `O(n²)` total.

### S10 (analysis). Is `O(n²)` optimal for this DP?
For any algorithm that materializes the full `dp` table, yes — there are `Θ(n²)` intervals so it is `Ω(n²)`. Specialized `O(n log n)` algorithms (Hu-Tucker, Garsia-Wachs) exist for the alphabetic-tree variant but exploit extra structure and do not compute the table; they are not instances of Knuth's optimization.

---

## Professional Questions (8 Q&A)

### P1. Design a service that builds optimal BSTs for query-autocomplete dictionaries that change daily.
Each rebuild is one `O(n²)` Knuth solve over the day's frequencies (a non-negative range sum, so no per-build verification needed). Cache the `opt` table for reconstruction. For very large dictionaries, partition by prefix bucket and build per-bucket trees, or fall back to Mehlhorn's near-optimal `O(n)` heuristic if `n²` memory is prohibitive. Store frequencies as 64-bit; recompute prefix sums per build.

### P2. The interview gives you a novel interval cost `C`. How do you decide whether to use Knuth?
First classify the recurrence shape (two-sided interval ⇒ candidate for Knuth). Then verify QI and monotonicity via the adjacent-argument `O(n²)` checks, or recognize `C` as a non-negative range sum. If both hold, apply the window. If unsure, run the `O(n³)` oracle and assert the opt-bound on random + adversarial instances before committing.

### P3. Your `O(n²)` solution is timing out at `n = 50000`. What's happening and what do you do?
`n² = 2.5 × 10⁹` is genuinely large, and the `int64` `dp` table is `≈ 20 GB` — likely the real blocker is memory, not just time. Options: confirm the problem truly needs an exact optimal BST over all `n`; use the `O(n log n)` Hu-Tucker/Garsia-Wachs if it is the alphabetic-tree variant; or exploit problem-specific structure. The two-sided interval DP has no general sub-`O(n²)` form.

### P4. How do you debug "the Knuth answer is wrong"?
Diff against the `O(n³)` oracle on the exact failing input (shrunk to a minimal case). Check the three usual suspects: `C` not actually QI/monotone (run the verifier), wrong fill order (must be by length), and inconsistent tie-breaking. Assert the opt-bound holds; if it fails, the conditions are violated and Knuth is unsafe for this `C`.

### P5. When is the cost `C` *not* a range sum but Knuth still applies?
When `C` provably satisfies QI and monotonicity by some other argument — e.g. certain costs of the form `C(i,j) = f(j) - g(i)` with appropriate convexity, or costs derived from a concave Monge matrix. The range-sum case is the common one, but the technique works for any QI+monotone `C`; you just have to prove it rather than cite the range-sum lemma.

### P6. How would you parallelize the Knuth DP?
Within a fixed interval length `L`, all cells `[i, i+L]` depend only on shorter intervals, so they are mutually independent and can be computed in parallel across `i`. The lengths themselves are sequential. This gives a per-diagonal data-parallel decomposition, effective on multicore for large `n`.

### P7. Explain the optimal-BST instance proof (Knuth-Yao) precisely.
The DP is `dp[i][j] = W(i,j) + min_root(dp[i][r-1] + dp[r+1][j])` with `W(i,j) = Σ freq[i..j] ≥ 0`. `W` is a non-negative range sum, so QI holds with equality (overlap counting) and monotonicity holds (non-negative weights). By Yao's theorem `dp` is QI, so the root is monotone, so the windowed DP is `O(n²)`. This is exactly Knuth's 1971 result re-derived through Yao's general 1980 framework.

### P8 (analysis). Why is the monotonicity hypothesis the precise dividing line from D&C optimization?
The two-sided recurrence couples `dp` to itself on both the left and right sub-intervals; for `dp` to inherit QI (and thus monotone `opt`), Yao's proof needs `C` monotone to keep exchanged splits valid. The one-sided D&C recurrence references a *fixed* previous layer, so its optimal split is monotone from QI of `C` alone. That single structural difference — coupled vs fixed — is why the two techniques have different preconditions and complexities.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you turned an `O(n³)` DP into something feasible.
Look for: recognizing the two-sided interval shape, identifying the cost as a non-negative range sum, verifying (or citing) QI + monotonicity, applying the opt-window, and measuring the speedup. Strong answers mention keeping the `O(n³)` oracle to validate and the 64-bit overflow care.

### B2. A teammate applied Knuth's window to a cost with negative weights and shipped a wrong result. How do you handle it?
Explain calmly that monotonicity fails for negative weights, so the opt-bound theorem does not hold and the window can skip the true optimum. Show a tiny counterexample where `opt` jumps outside the window. Recommend the verifier as a CI guard and frame it as a teaching moment about the exact-or-silently-wrong nature of the technique.

### B3. Design a feature that arranges menu items / shelf items to minimize average access cost.
This is optimal BST (or an alphabetic-tree variant if order must be preserved). Build the frequency model from usage logs, run the `O(n²)` Knuth solve, reconstruct the tree from `opt`. Discuss daily rebuilds as frequencies drift, 64-bit costs, and falling back to `O(n log n)` Hu-Tucker if the catalog is huge.

### B4. How would you explain Knuth's optimization to a junior engineer?
Use the library analogy: the best "center" (root) of a shelf range drifts smoothly as you extend the range, never jumping around, so you only re-search between the two neighbors' centers instead of the whole shelf. Lead with the two gotchas: it only works when the cost is "smooth" (QI + monotone), and you must fill the table by increasing interval length.

### B5. Your DP job's memory is blowing up at scale. How do you investigate?
The `O(n²)` `dp` and `opt` tables dominate; check whether `n` grew. Use `int32` for `opt`. Confirm you are not also keeping the naive table around. For the alphabetic-tree case, switch to an `O(n log n)` algorithm with linear memory. Profile allocations; the fix is usually a smaller `opt` type or a different algorithm for large `n`.

---

## Coding Challenges

### Challenge 1: Optimal Binary Search Tree

**Problem.** Given `n` keys with access frequencies `freq[0..n-1]`, compute the minimum expected search cost of a BST, where the cost is `Σ freq[key] × depth(key)` (root at depth 1). Use Knuth's optimization for `O(n²)`.

**Example.**
```text
freq = [5, 2, 4]  ->  19
freq = [34, 8, 50] -> the optimal weighted-depth cost
```

**Constraints.** `1 ≤ n ≤ 2000`, `0 ≤ freq[i] ≤ 10^6`.

**Brute force.** `O(n³)` interval DP scanning all roots.

**Optimal.** Knuth's optimization, `O(n²)`.

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 60

func optimalBST(freq []int64) int64 {
	n := len(freq)
	if n == 0 {
		return 0
	}
	pre := make([]int64, n+1)
	for i := 0; i < n; i++ {
		pre[i+1] = pre[i] + freq[i]
	}
	W := func(i, j int) int64 { return pre[j+1] - pre[i] }

	dp := make([][]int64, n)
	opt := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int64, n)
		opt[i] = make([]int, n)
		dp[i][i] = freq[i]
		opt[i][i] = i
	}
	for length := 1; length < n; length++ {
		for i := 0; i+length < n; i++ {
			j := i + length
			dp[i][j] = INF
			lo, hi := opt[i][j-1], opt[i+1][j]
			for r := lo; r <= hi; r++ {
				var left, right int64
				if r > i {
					left = dp[i][r-1]
				}
				if r < j {
					right = dp[r+1][j]
				}
				if v := left + right + W(i, j); v < dp[i][j] {
					dp[i][j] = v
					opt[i][j] = r
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	fmt.Println(optimalBST([]int64{5, 2, 4})) // 19
}
```

**Java.**
```java
public class OptimalBST {
    static final long INF = 1L << 60;

    static long optimalBST(long[] freq) {
        int n = freq.length;
        if (n == 0) return 0;
        long[] pre = new long[n + 1];
        for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + freq[i];
        long[][] dp = new long[n][n];
        int[][] opt = new int[n][n];
        for (int i = 0; i < n; i++) { dp[i][i] = freq[i]; opt[i][i] = i; }
        for (int len = 1; len < n; len++)
            for (int i = 0; i + len < n; i++) {
                int j = i + len;
                dp[i][j] = INF;
                int lo = opt[i][j - 1], hi = opt[i + 1][j];
                long w = pre[j + 1] - pre[i];
                for (int r = lo; r <= hi; r++) {
                    long left = (r > i) ? dp[i][r - 1] : 0;
                    long right = (r < j) ? dp[r + 1][j] : 0;
                    long v = left + right + w;
                    if (v < dp[i][j]) { dp[i][j] = v; opt[i][j] = r; }
                }
            }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(optimalBST(new long[]{5, 2, 4})); // 19
    }
}
```

**Python.**
```python
INF = float("inf")


def optimal_bst(freq):
    n = len(freq)
    if n == 0:
        return 0
    pre = [0] * (n + 1)
    for i, f in enumerate(freq):
        pre[i + 1] = pre[i] + f
    W = lambda i, j: pre[j + 1] - pre[i]
    dp = [[0] * n for _ in range(n)]
    opt = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    for i in range(n):
        dp[i][i] = freq[i]
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            lo, hi = opt[i][j - 1], opt[i + 1][j]
            for r in range(lo, hi + 1):
                left = dp[i][r - 1] if r > i else 0
                right = dp[r + 1][j] if r < j else 0
                v = left + right + W(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = r
    return dp[0][n - 1]


if __name__ == "__main__":
    print(optimal_bst([5, 2, 4]))  # 19
```

---

### Challenge 2: Optimal File Merging (Stone Merging)

**Problem.** Given `n` stones in a row with sizes `s[0..n-1]`, you repeatedly merge two **adjacent** groups; merging a group of total size `S` costs `S`. Return the minimum total cost. Use Knuth's optimization.

**Example.**
```text
s = [10, 20, 30] -> 90   (merge 10+20=30 cost 30, then 30+30=60 cost 60)
s = [1, 2, 3, 4] -> 19
```

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ s[i] ≤ 10^6`.

**Optimal.** Knuth's optimization, `O(n²)`.

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 60

func mergeStones(s []int64) int64 {
	n := len(s)
	if n <= 1 {
		return 0
	}
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
		opt[i][i] = i
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
	fmt.Println(mergeStones([]int64{10, 20, 30}))   // 90
	fmt.Println(mergeStones([]int64{1, 2, 3, 4}))   // 19
}
```

**Java.**
```java
public class MergeStones {
    static final long INF = 1L << 60;

    static long mergeStones(long[] s) {
        int n = s.length;
        if (n <= 1) return 0;
        long[] pre = new long[n + 1];
        for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + s[i];
        long[][] dp = new long[n][n];
        int[][] opt = new int[n][n];
        for (int i = 0; i < n; i++) opt[i][i] = i;
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
        System.out.println(mergeStones(new long[]{10, 20, 30})); // 90
        System.out.println(mergeStones(new long[]{1, 2, 3, 4})); // 19
    }
}
```

**Python.**
```python
INF = float("inf")


def merge_stones(s):
    n = len(s)
    if n <= 1:
        return 0
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
            lo, hi = opt[i][j - 1], opt[i + 1][j]
            for k in range(lo, hi + 1):
                v = dp[i][k] + dp[k + 1][j] + W(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = k
    return dp[0][n - 1]


if __name__ == "__main__":
    print(merge_stones([10, 20, 30]))  # 90
    print(merge_stones([1, 2, 3, 4]))  # 19
```

---

### Challenge 3: Verify Conditions and Solve, or Fall Back

**Problem.** Given a cost function `C(i, j)` for an interval DP and the size `n`, decide whether Knuth's optimization is safe (verify QI + monotonicity). If safe, solve with the `O(n²)` window; otherwise solve with the naive `O(n³)` DP. Return the cost `dp[0][n-1]` and which path was taken.

**Approach.** Run the adjacent-argument QI and monotonicity checks (`O(n²)`). Branch on the result.

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 60

func verify(C func(i, j int) int64, n int) bool {
	for i := 0; i < n; i++ {
		for j := i + 1; j < n-0; j++ {
			if j+1 < n {
				if C(i, j)+C(i+1, j+1) > C(i, j+1)+C(i+1, j) {
					return false
				}
			}
			if C(i+1, j) > C(i, j) || C(i, j-1) > C(i, j) {
				return false
			}
		}
	}
	return true
}

func solve(C func(i, j int) int64, base []int64, knuth bool) int64 {
	n := len(base)
	dp := make([][]int64, n)
	opt := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int64, n)
		opt[i] = make([]int, n)
		dp[i][i] = base[i]
		opt[i][i] = i
	}
	for length := 1; length < n; length++ {
		for i := 0; i+length < n; i++ {
			j := i + length
			dp[i][j] = INF
			lo, hi := i, j-1
			if knuth {
				lo, hi = opt[i][j-1], opt[i+1][j]
			}
			for k := lo; k <= hi; k++ {
				if v := dp[i][k] + dp[k+1][j] + C(i, j); v < dp[i][j] {
					dp[i][j] = v
					opt[i][j] = k
				}
			}
		}
	}
	return dp[0][n-1]
}

func main() {
	s := []int64{10, 20, 30}
	pre := []int64{0, 10, 30, 60}
	C := func(i, j int) int64 { return pre[j+1] - pre[i] }
	base := []int64{0, 0, 0}
	ok := verify(C, len(s))
	fmt.Println("knuth safe:", ok, "cost:", solve(C, base, ok)) // true 90
}
```

**Java.**
```java
import java.util.function.BiFunction;

public class VerifyAndSolve {
    static final long INF = 1L << 60;

    static boolean verify(BiFunction<Integer, Integer, Long> C, int n) {
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++) {
                if (j + 1 < n &&
                    C.apply(i, j) + C.apply(i + 1, j + 1) > C.apply(i, j + 1) + C.apply(i + 1, j))
                    return false;
                if (C.apply(i + 1, j) > C.apply(i, j) || C.apply(i, j - 1) > C.apply(i, j))
                    return false;
            }
        return true;
    }

    static long solve(BiFunction<Integer, Integer, Long> C, long[] base, boolean knuth) {
        int n = base.length;
        long[][] dp = new long[n][n];
        int[][] opt = new int[n][n];
        for (int i = 0; i < n; i++) { dp[i][i] = base[i]; opt[i][i] = i; }
        for (int len = 1; len < n; len++)
            for (int i = 0; i + len < n; i++) {
                int j = i + len;
                dp[i][j] = INF;
                int lo = knuth ? opt[i][j - 1] : i;
                int hi = knuth ? opt[i + 1][j] : j - 1;
                for (int k = lo; k <= hi; k++) {
                    long v = dp[i][k] + dp[k + 1][j] + C.apply(i, j);
                    if (v < dp[i][j]) { dp[i][j] = v; opt[i][j] = k; }
                }
            }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        long[] pre = {0, 10, 30, 60};
        BiFunction<Integer, Integer, Long> C = (i, j) -> pre[j + 1] - pre[i];
        long[] base = {0, 0, 0};
        boolean ok = verify(C, 3);
        System.out.println("knuth safe: " + ok + " cost: " + solve(C, base, ok)); // true 90
    }
}
```

**Python.**
```python
INF = float("inf")


def verify(C, n):
    for i in range(n):
        for j in range(i + 1, n):
            if j + 1 < n and C(i, j) + C(i + 1, j + 1) > C(i, j + 1) + C(i + 1, j):
                return False
            if C(i + 1, j) > C(i, j) or C(i, j - 1) > C(i, j):
                return False
    return True


def solve(C, base, knuth):
    n = len(base)
    dp = [[0] * n for _ in range(n)]
    opt = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    for i in range(n):
        dp[i][i] = base[i]
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            lo, hi = (opt[i][j - 1], opt[i + 1][j]) if knuth else (i, j - 1)
            for k in range(lo, hi + 1):
                v = dp[i][k] + dp[k + 1][j] + C(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = k
    return dp[0][n - 1]


if __name__ == "__main__":
    pre = [0, 10, 30, 60]
    C = lambda i, j: pre[j + 1] - pre[i]
    base = [0, 0, 0]
    ok = verify(C, 3)
    print("knuth safe:", ok, "cost:", solve(C, base, ok))  # True 90
```

---

### Challenge 4: Reconstruct the Optimal BST Structure

**Problem.** Solve optimal BST with Knuth's optimization and additionally return the tree structure (which key is the root of each subtree). Verify the reconstructed tree's weighted-depth cost equals `dp[0][n-1]`.

**Approach.** Build the `opt`/`root` table during the DP, then recurse: `root[i][j]` is the subtree root; recurse into `[i, root-1]` and `[root+1, j]`.

**Python.**
```python
INF = float("inf")


def optimal_bst_with_tree(freq):
    n = len(freq)
    pre = [0] * (n + 1)
    for i, f in enumerate(freq):
        pre[i + 1] = pre[i] + f
    W = lambda i, j: pre[j + 1] - pre[i]
    dp = [[0] * n for _ in range(n)]
    root = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    for i in range(n):
        dp[i][i] = freq[i]
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            dp[i][j] = INF
            lo, hi = root[i][j - 1], root[i + 1][j]
            for r in range(lo, hi + 1):
                left = dp[i][r - 1] if r > i else 0
                right = dp[r + 1][j] if r < j else 0
                v = left + right + W(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    root[i][j] = r
    def build(i, j):
        if i > j:
            return None
        r = root[i][j]
        return (r, build(i, r - 1), build(r + 1, j))
    return dp[0][n - 1], build(0, n - 1)


def cost_of(tree, freq, depth=1):
    if tree is None:
        return 0
    r, left, right = tree
    return freq[r] * depth + cost_of(left, freq, depth + 1) + cost_of(right, freq, depth + 1)


if __name__ == "__main__":
    freq = [5, 2, 4]
    cost, tree = optimal_bst_with_tree(freq)
    print("cost:", cost, "tree:", tree)
    assert cost_of(tree, freq) == cost   # reconstruction round-trip
```

**Go.**
```go
package main

import "fmt"

const INF = int64(1) << 60

func solve(freq []int64) (int64, [][]int) {
	n := len(freq)
	pre := make([]int64, n+1)
	for i := 0; i < n; i++ {
		pre[i+1] = pre[i] + freq[i]
	}
	W := func(i, j int) int64 { return pre[j+1] - pre[i] }
	dp := make([][]int64, n)
	root := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int64, n)
		root[i] = make([]int, n)
		dp[i][i] = freq[i]
		root[i][i] = i
	}
	for length := 1; length < n; length++ {
		for i := 0; i+length < n; i++ {
			j := i + length
			dp[i][j] = INF
			lo, hi := root[i][j-1], root[i+1][j]
			for r := lo; r <= hi; r++ {
				var left, right int64
				if r > i {
					left = dp[i][r-1]
				}
				if r < j {
					right = dp[r+1][j]
				}
				if v := left + right + W(i, j); v < dp[i][j] {
					dp[i][j] = v
					root[i][j] = r
				}
			}
		}
	}
	return dp[0][n-1], root
}

func show(root [][]int, i, j int) string {
	if i > j {
		return "."
	}
	r := root[i][j]
	return fmt.Sprintf("(%d %s %s)", r, show(root, i, r-1), show(root, r+1, j))
}

func main() {
	freq := []int64{5, 2, 4}
	cost, root := solve(freq)
	fmt.Println("cost:", cost, "tree:", show(root, 0, len(freq)-1))
}
```

**Java.**
```java
public class OptimalBSTTree {
    static final long INF = 1L << 60;
    static int[][] root;

    static long solve(long[] freq) {
        int n = freq.length;
        long[] pre = new long[n + 1];
        for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + freq[i];
        long[][] dp = new long[n][n];
        root = new int[n][n];
        for (int i = 0; i < n; i++) { dp[i][i] = freq[i]; root[i][i] = i; }
        for (int len = 1; len < n; len++)
            for (int i = 0; i + len < n; i++) {
                int j = i + len;
                dp[i][j] = INF;
                int lo = root[i][j - 1], hi = root[i + 1][j];
                long w = pre[j + 1] - pre[i];
                for (int r = lo; r <= hi; r++) {
                    long left = (r > i) ? dp[i][r - 1] : 0;
                    long right = (r < j) ? dp[r + 1][j] : 0;
                    long v = left + right + w;
                    if (v < dp[i][j]) { dp[i][j] = v; root[i][j] = r; }
                }
            }
        return dp[0][n - 1];
    }

    static String show(int i, int j) {
        if (i > j) return ".";
        int r = root[i][j];
        return "(" + r + " " + show(i, r - 1) + " " + show(r + 1, j) + ")";
    }

    public static void main(String[] args) {
        long[] freq = {5, 2, 4};
        long cost = solve(freq);
        System.out.println("cost: " + cost + " tree: " + show(0, freq.length - 1));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Two-sided interval DP with a QI + monotone cost ⇒ `opt` is monotone (`opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`) ⇒ restrict the `k`-loop ⇒ `O(n²)`."*
- Immediately flag the two gotchas: **verify QI + monotonicity** (automatic for non-negative range sums), and **fill by increasing interval length**.
- If asked how it differs from D&C optimization, give the recurrence shapes: two-sided `dp[i][k] + dp[k+1][j]` (Knuth, `O(n²)`) vs layered `dp[t-1][k] + C(k,i)` (D&C, `O(kn log n)`).
- Explain the `O(n²)` via the **telescoping**: per-length window widths sum to `O(n)` because the upper bound of one window equals the lower bound of the next.
- Always offer to verify against a brute-force `O(n³)` oracle on small inputs, and to assert the opt-bound holds.
