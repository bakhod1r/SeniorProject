# Knuth's DP Optimization (Knuth-Yao) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the interval-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(n³)` interval-DP oracle on small inputs, and assert `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]`, before trusting the `O(n²)` Knuth result.**

---

## Beginner Tasks (5)

### Task 1 — Prefix-summed range cost `W(i, j)`

**Problem.** Implement `W(i, j)` returning `Σ_{t=i}^{j} w_t` in `O(1)` using a precomputed prefix-sum array. This is the cost `C` used by every Knuth application below.

**Input / Output spec.**
- Read `n`, then `w[0..n-1]`, then `q` queries each `(i, j)`.
- For each query print `W(i, j)`.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ w_t ≤ 10^6`, `0 ≤ i ≤ j < n`.

**Hint.** `pre[0] = 0`, `pre[t+1] = pre[t] + w[t]`, `W(i, j) = pre[j+1] - pre[i]`. Use 64-bit.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	w := make([]int64, n)
	for i := range w {
		fmt.Scan(&w[i])
	}
	pre := make([]int64, n+1)
	// TODO: build prefix sums
	W := func(i, j int) int64 {
		// TODO: return pre[j+1] - pre[i]
		return 0
	}
	var q int
	fmt.Scan(&q)
	for ; q > 0; q-- {
		var i, j int
		fmt.Scan(&i, &j)
		fmt.Println(W(i, j))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] w = new long[n];
        for (int i = 0; i < n; i++) w[i] = sc.nextLong();
        long[] pre = new long[n + 1];
        // TODO: build prefix sums
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        for (int t = 0; t < q; t++) {
            int i = sc.nextInt(), j = sc.nextInt();
            sb.append(pre[j + 1] - pre[i]).append('\n'); // works once pre is filled
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    w = [int(next(data)) for _ in range(n)]
    pre = [0] * (n + 1)
    # TODO: build prefix sums
    q = int(next(data))
    out = []
    for _ in range(q):
        i, j = int(next(data)), int(next(data))
        out.append(str(pre[j + 1] - pre[i]))  # works once pre is filled
    print("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `O(1)` per query after `O(n)` precompute.
- Correct sums verified by hand on a small array.
- 64-bit accumulation (no overflow for `n·max(w)`).

---

### Task 2 — Naive `O(n³)` optimal BST

**Problem.** Given frequencies `freq[0..n-1]`, compute the minimum expected BST search cost `Σ freq[key]·depth(key)` (root depth 1) by the **naive** interval DP scanning all roots. This is your correctness oracle.

**Input / Output spec.**
- Read `n`, then `freq`.
- Print the minimum cost.

**Constraints.** `1 ≤ n ≤ 300`, `0 ≤ freq[i] ≤ 10^6`.

**Hint.** `dp[i][j] = W(i,j) + min_{r=i..j}(dp[i][r-1] + dp[r+1][j])`, empty child cost `0`. Fill by increasing length.

**Evaluation criteria.**
- Correct for `freq=[5,2,4] → 19`.
- `O(n³)`; matches a hand calculation on `n ≤ 3`.
- Used later as the oracle for the Knuth version.

---

### Task 3 — Knuth `O(n²)` optimal BST

**Problem.** Same as Task 2, but use Knuth's optimization: restrict the root loop to `[root[i][j-1], root[i+1][j]]`. Verify it matches the Task 2 oracle on random small inputs.

**Input / Output spec.**
- Read `n`, then `freq`. Print the minimum cost.

**Constraints.** `1 ≤ n ≤ 2000`, `0 ≤ freq[i] ≤ 10^6`.

**Hint.** Initialize `dp[i][i]=freq[i]`, `root[i][i]=i`. Fill by increasing length; the only change from naive is the loop bounds.

**Evaluation criteria.**
- Matches Task 2 for all random `n ≤ 12`.
- `O(n²)` (verify empirically that doubling `n` roughly quadruples time, not 8×).
- Asserts `root[i][j-1] ≤ root[i][j] ≤ root[i+1][j]`.

---

### Task 4 — Optimal adjacent stone merging

**Problem.** Given stone sizes `s[0..n-1]`, repeatedly merge two adjacent groups (cost = combined size); return the minimum total merge cost. Use Knuth's optimization.

**Input / Output spec.**
- Read `n`, then `s`. Print the minimum total cost.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ s[i] ≤ 10^6`.

**Hint.** `dp[i][j] = W(i,j) + min_k(dp[i][k] + dp[k+1][j])`, `dp[i][i]=0`. Same skeleton as optimal BST.

**Worked check.** `[10,20,30] → 90`; `[1,2,3,4] → 19`.

**Starter — Go.**
```go
package main

import "fmt"

const INF = int64(1) << 60

func mergeStones(s []int64) int64 {
	n := len(s)
	pre := make([]int64, n+1)
	for i := 0; i < n; i++ {
		pre[i+1] = pre[i] + s[i]
	}
	dp := make([][]int64, n)
	opt := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int64, n)
		opt[i] = make([]int, n)
		opt[i][i] = i
	}
	// TODO: fill by increasing length; window [opt[i][j-1], opt[i+1][j]];
	//       dp[i][j] = min(dp[i][k]+dp[k+1][j]) + (pre[j+1]-pre[i])
	return dp[0][n-1]
}

func main() { fmt.Println(mergeStones([]int64{10, 20, 30})) }
```

**Starter — Java.**
```java
public class Task4 {
    static final long INF = 1L << 60;
    static long mergeStones(long[] s) {
        int n = s.length;
        long[] pre = new long[n + 1];
        for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + s[i];
        long[][] dp = new long[n][n];
        int[][] opt = new int[n][n];
        for (int i = 0; i < n; i++) opt[i][i] = i;
        // TODO: fill by length; restricted window; C = pre[j+1]-pre[i]
        return dp[0][n - 1];
    }
    public static void main(String[] a) { System.out.println(mergeStones(new long[]{10, 20, 30})); }
}
```

**Starter — Python.**
```python
INF = float("inf")


def merge_stones(s):
    n = len(s)
    pre = [0] * (n + 1)
    for i, v in enumerate(s):
        pre[i + 1] = pre[i] + v
    dp = [[0] * n for _ in range(n)]
    opt = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    # TODO: fill by length; window [opt[i][j-1], opt[i+1][j]]; C = pre[j+1]-pre[i]
    return dp[0][n - 1]


if __name__ == "__main__":
    print(merge_stones([10, 20, 30]))
```

**Evaluation criteria.**
- Correct on the worked checks.
- Matches a brute-force `O(n³)` merge DP for small `n`.
- `O(n²)`.

---

### Task 5 — Verify QI and monotonicity of a cost

**Problem.** Implement `verify(C, n)` returning whether `C(i, j)` satisfies the adjacent quadrangle inequality `C(i,j)+C(i+1,j+1) ≤ C(i,j+1)+C(i+1,j)` (for valid indices) **and** monotonicity `C(i+1,j) ≤ C(i,j)`, `C(i,j-1) ≤ C(i,j)`.

**Input / Output spec.**
- Given a cost (e.g. a prefix-summed range sum) and `n`, print `true`/`false` for each property.

**Constraints.** `1 ≤ n ≤ 1000`.

**Hint.** A non-negative range sum should return `true` for both. Try injecting a negative weight and confirm monotonicity becomes `false`.

**Evaluation criteria.**
- Returns `(true, true)` for a non-negative range sum.
- Returns monotonicity `false` when a weight is negative.
- `O(n²)` checks (adjacent form).

---

## Intermediate Tasks (5)

### Task 6 — Reconstruct the optimal BST tree

**Problem.** Solve optimal BST with Knuth's optimization and also return, for each subtree `[i, j]`, its root. Reconstruct the tree and verify its weighted-depth cost equals `dp[0][n-1]`.

**Constraints.** `1 ≤ n ≤ 2000`.

**Hint.** Store `root[i][j]` during the DP. Recurse: `root[i][j]` is the root, recurse into `[i, root-1]` and `[root+1, j]`. Re-evaluate the tree's cost as a round-trip check.

**Evaluation criteria.**
- Reconstructed cost equals the DP cost (round-trip).
- Tree respects BST ordering (in-order traversal yields `0..n-1`).
- `O(n²)` solve, `O(n)` reconstruct.

---

### Task 7 — Optimal BST with miss probabilities (dummy keys)

**Problem.** Extend optimal BST with **dummy** keys `d_0, …, d_n` (probabilities of searching for a value *between* keys). Cost is `Σ p_key·depth(key) + Σ q_dummy·depth(dummy)`. Solve in `O(n²)` with Knuth.

**Constraints.** `1 ≤ n ≤ 2000`, probabilities scaled to non-negative integers.

**Hint.** `W(i, j) = Σ p[i..j] + Σ q[i..j+1]` (still a non-negative range sum, so QI + monotone hold). The DP indices range over key/dummy slots; the root window monotonicity is unchanged.

**Reference oracle (Python sketch).**
```python
def naive_obst_dummy(p, q):
    # p[0..n-1] key freqs, q[0..n] dummy freqs; W = sum p + sum q over range.
    # dp[i][j] over dummy-bounded intervals; scan ALL roots. O(n^3) oracle.
    ...
```

**Evaluation criteria.**
- Matches the `O(n³)` oracle including dummy terms for small `n`.
- `O(n²)`.
- Documents that `W` remains a non-negative range sum.

---

### Task 8 — Generic Knuth solver parameterized by `C`

**Problem.** Implement `knuth(n, base, C)` solving `dp[i][j] = C(i,j) + min_k(dp[i][k] + dp[k+1][j])`, `dp[i][i]=base(i)`, with the restricted window. Return `dp` and `opt`. Reuse it for optimal BST and stone merging by passing different `base`/`C`.

**Constraints.** `1 ≤ n ≤ 2000`.

**Hint.** Keep `C` a closure over prefix sums. The same engine should reproduce Task 3 and Task 4 results.

**Evaluation criteria.**
- One function solves both optimal BST and stone merging.
- Matches the dedicated solvers.
- Optionally calls a verifier (Task 5) before enabling the window.

---

### Task 9 — Empirical `O(n³)` vs `O(n²)` scaling

**Problem.** Benchmark the naive and Knuth optimal-BST solvers across `n ∈ {50, 100, 200, 400, 800}` on the same seeded random frequencies. Confirm Knuth scales `~n²` and naive `~n³`.

**Constraints.** Same seed across all three languages.

**Hint.** Time only the solve (not generation). Report a table; the ratio of consecutive Knuth times should approach `4×` per doubling, naive `8×`.

**Starter — Python.**
```python
import random
import time


def gen(n, seed):
    r = random.Random(seed)
    return [r.randint(0, 1000) for _ in range(n)]


def naive(freq):
    # TODO: O(n^3) optimal BST
    return 0


def knuth(freq):
    # TODO: O(n^2) optimal BST
    return 0


def main():
    print("n      naive_ms     knuth_ms")
    for n in [50, 100, 200, 400, 800]:
        f = gen(n, 42)
        t0 = time.perf_counter(); knuth(f); kt = (time.perf_counter() - t0) * 1000
        if n <= 400:
            t0 = time.perf_counter(); naive(f); nt = (time.perf_counter() - t0) * 1000
            print(f"{n:<6d} {nt:<12.2f} {kt:<12.2f}")
        else:
            print(f"{n:<6d} {'(skipped)':<12} {kt:<12.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed → same frequencies across Go/Java/Python.
- Knuth time roughly quadruples per doubling of `n`; naive roughly octuples.
- Both produce identical costs on the shared inputs (where naive runs).

---

### Task 10 — Assert the opt-bound holds

**Problem.** Solve optimal BST with the naive `O(n³)` DP, record the full `opt`/`root` table, and assert `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` for **all** `i < j`. Run on many random instances to empirically confirm monotonicity.

**Constraints.** `1 ≤ n ≤ 60`, thousands of random instances.

**Hint.** Use the *smallest* optimal root on ties (consistent tie-break). If the assertion ever fails, either the tie-break is inconsistent or the cost is not QI/monotone.

**Evaluation criteria.**
- Assertion passes on all random non-negative-frequency instances.
- Demonstrates a *failure* when a negative weight is injected (monotonicity broken).
- Confirms the optimization's precondition empirically.

---

## Advanced Tasks (5)

### Task 11 — Optimal alphabetic tree (leaf-weighted)

**Problem.** Given leaf weights `w[0..n-1]` in fixed order, build a binary tree whose leaves are the weights *in order* minimizing `Σ w_i · depth(leaf_i)`. Solve with the interval DP `dp[i][j] = W(i,j) + min_k(dp[i][k] + dp[k+1][j])`, `W = Σ w[i..j]`, via Knuth `O(n²)`.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ w_i ≤ 10^6`.

**Hint.** This is the same range-sum cost, so Knuth applies. (Note: the specialized Hu-Tucker/Garsia-Wachs algorithms solve this in `O(n log n)` — mention them, but implement the `O(n²)` Knuth version here.)

**Evaluation criteria.**
- Matches a brute-force `O(n³)` tree DP for small `n`.
- `O(n²)`.
- Comment notes the existence of `O(n log n)` specialized algorithms.

---

### Task 12 — Knuth vs D&C optimization classifier

**Problem.** Given a description of a recurrence (two-sided interval vs one-sided layered) and constraints, implement `classify(recurrence)` returning one of `KNUTH`, `DC_OPT`, `CONVEX_HULL`, `NAIVE`, or `NOT_APPLICABLE` (e.g. `C` not QI). Justify each.

**Cases to handle.**
- `dp[i][j] = C(i,j) + min_k(dp[i][k]+dp[k+1][j])`, `C` QI+monotone → `KNUTH` (`O(n²)`).
- `dp[t][i] = min_k(dp[t-1][k]+C(k,i))`, `C` QI → `DC_OPT` (`O(kn log n)`).
- `dp[i] = min_j(dp[j]+b_j·a_i)`, linear → `CONVEX_HULL` (`O(n log n)`).
- two-sided but `C` not QI/monotone → `NAIVE` (`O(n³)`).
- simple-path counting / Huffman → `NOT_APPLICABLE`.

**Hint.** Encode the decision rules from `middle.md` §Comparison and `professional.md` §10. The discriminator is the recurrence *shape*, then the conditions on `C`.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification cites the recurrence shape and the complexity.
- The `NOT_APPLICABLE` branch explains *why* (no QI / wrong structure).

---

### Task 13 — Stone merging into groups of `K` (variant)

**Problem.** Generalize stone merging so that only merges of exactly `K` adjacent groups are allowed (LeetCode-1000 style). When `K=2` this is Task 4. Decide whether Knuth's optimization still applies and implement the correct DP.

**Constraints.** `2 ≤ K ≤ 6`, `1 ≤ n ≤ 200`.

**Hint.** For general `K`, the DP gains a "number of remaining piles mod (K-1)" dimension; the cost is still a range sum but the recurrence shape changes. Analyze whether the two-sided opt-bound still holds; document your finding (the plain Knuth window does not directly apply to the `K`-ary variant — explain why).

**Evaluation criteria.**
- Correct merge cost for `K=2` (matches Task 4) and small `K>2` cases.
- Written analysis of whether/why Knuth's window applies to the `K`-ary variant.
- Cites the feasibility condition `(n-1) mod (K-1) == 0`.

---

### Task 14 — Cross-language determinism harness

**Problem.** Implement optimal BST (Knuth) in Go, Java, and Python with an **identical tie-break** (smallest optimal root). On a battery of seeded random inputs, assert all three produce the same cost *and* the same `root` table.

**Constraints.** `1 ≤ n ≤ 200`, identical seed/PRNG behavior documented.

**Hint.** Tie-breaking is the subtle part: only update `opt` on a *strict* improvement (`v < dp[i][j]`), never on equality, so the smallest root wins. Confirm the `root` tables match byte-for-byte across languages.

**Evaluation criteria.**
- Identical cost across all three languages on every seeded input.
- Identical `root` tables (consistent tie-break).
- A documented note on why tie-break consistency is required for matching `opt`.

---

### Task 15 — Detect when Knuth is unsafe and fall back

**Problem.** Build `solve(C, base, n)` that first verifies QI + monotonicity (Task 5). If both hold, use the `O(n²)` window; otherwise fall back to the naive `O(n³)` DP. Return the cost and which path was taken. Construct one input where the verifier correctly forces the naive fallback (e.g. a cost with a negative weight) and confirm both paths give the *same* correct answer (the naive path being the ground truth).

**Constraints.** `1 ≤ n ≤ 100`.

**Hint.** The naive fallback must always be correct (it scans all splits). The point is that Knuth on a non-QI cost would be *wrong*, so the verifier protects you. Show a concrete cost where Knuth-window and naive disagree, proving the fallback necessary.

**Evaluation criteria.**
- Verifier correctly gates: QI+monotone → window; else → naive.
- A demonstrated case where applying the window naively would give a wrong answer.
- The fallback path matches the brute-force ground truth.

---

## Benchmark Task

### Task B — Window-width histogram (visualizing the telescoping)

**Problem.** Instrument the Knuth optimal-BST solver to record, for each interval, the window width `hi - lo + 1` actually scanned. Produce (a) the total candidates scanned (should be `O(n²)`, far below the naive `O(n³) = Σ (j-i)`), and (b) a per-length sum of window widths confirming each length contributes `O(n)`.

**Starter — Python.**
```python
def knuth_instrumented(freq):
    n = len(freq)
    pre = [0] * (n + 1)
    for i, f in enumerate(freq):
        pre[i + 1] = pre[i] + f
    W = lambda i, j: pre[j + 1] - pre[i]
    INF = float("inf")
    dp = [[0] * n for _ in range(n)]
    opt = [[i if i == j else 0 for j in range(n)] for i in range(n)]
    for i in range(n):
        dp[i][i] = freq[i]
    total = 0
    per_length = [0] * n
    for length in range(1, n):
        for i in range(n - length):
            j = i + length
            lo, hi = opt[i][j - 1], opt[i + 1][j]
            width = hi - lo + 1
            total += width
            per_length[length] += width
            dp[i][j] = INF
            for r in range(lo, hi + 1):
                left = dp[i][r - 1] if r > i else 0
                right = dp[r + 1][j] if r < j else 0
                v = left + right + W(i, j)
                if v < dp[i][j]:
                    dp[i][j] = v
                    opt[i][j] = r
    naive_total = sum((j - i + 1) for length in range(1, n) for i in range(n - length) for j in [i + length])
    return dp[0][n - 1], total, naive_total, per_length


if __name__ == "__main__":
    import random
    freq = [random.randint(0, 1000) for _ in range(400)]
    cost, total, naive_total, per_len = knuth_instrumented(freq)
    print("cost:", cost)
    print("knuth candidates scanned:", total)
    print("naive candidates would be:", naive_total)
    print("max per-length window sum:", max(per_len), "(should be O(n), n =", len(freq), ")")
```

**Evaluation criteria.**
- Same seed → same frequencies across Go, Java, and Python.
- Total Knuth candidates scanned is `O(n²)` and dramatically below the naive `O(n³)` count.
- Per-length window-width sum is `O(n)` (confirming the telescoping argument empirically).
- Report includes the ratio `naive_total / knuth_total ≈ Θ(n)`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force `O(n³)` oracle first.** Run it on small `n`, diff the cost (and ideally the `opt` table), and only then trust the `O(n²)` Knuth version on large `n`.
- **Verify QI + monotonicity** (Task 5) for any non-trivial cost. For non-negative range sums it is automatic; for anything else, prove or test it.
- **Fill by increasing interval length** so both `opt[i][j-1]` and `opt[i+1][j]` are computed before `opt[i][j]`.
- **Prefix-sum the cost `C`** to `O(1)` per query; recomputing the range sum in the loop silently reverts to `O(n³)`.
- **Use 64-bit** for `dp` and prefix sums; optimal-BST costs reach `≈ n²·F`.
- **Break ties consistently** (smallest optimal split — update only on strict improvement) so `opt` stays monotone and reconstruction is deterministic.
- **Pin `INF` below `MAX/2`** so two `INF` sub-`dp` values do not overflow when summed transiently.
- **Never apply the window without checking the conditions** — a non-QI cost yields a silently wrong answer (Task 15).

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
