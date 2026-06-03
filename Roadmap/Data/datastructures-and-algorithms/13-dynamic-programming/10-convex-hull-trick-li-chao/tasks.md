# Convex Hull Trick (CHT) and Li Chao Tree — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the envelope logic and validate against the evaluation criteria.
> **Always test against a brute-force `min_j(m_j·x+b_j)` oracle (and, for DP tasks, the `O(n²)` whole-DP oracle) on small inputs before trusting the fast structure.**

---

## Beginner Tasks (5)

### Task 1 — Brute-force lower envelope (the oracle)

**Problem.** Implement `bruteMin(lines, x)` returning `min over all (m, b) in lines of (m·x + b)`. This is the `O(n)`-per-query reference every later task validates against.

**Input / Output spec.**
- Read `n`, then `n` lines each as two integers `m b`, then `q`, then `q` query x-values.
- For each query, print `bruteMin(lines, x)`.

**Constraints.**
- `1 ≤ n, q ≤ 1000`, `|m|, |b|, |x| ≤ 10⁶`.
- Use 64-bit values (`m·x` reaches `10¹²`).

**Hint.** A single loop over the lines per query. No cleverness — this is the gold standard.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func bruteMin(m, b []int64, x int64) int64 {
	// TODO: minimum over all lines of m[i]*x + b[i]
	return 0
}

func main() {
	r := bufio.NewReader(os.Stdin)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	var n int
	fmt.Fscan(r, &n)
	m := make([]int64, n)
	b := make([]int64, n)
	for i := 0; i < n; i++ {
		fmt.Fscan(r, &m[i], &b[i])
	}
	var q int
	fmt.Fscan(r, &q)
	for ; q > 0; q-- {
		var x int64
		fmt.Fscan(r, &x)
		fmt.Fprintln(w, bruteMin(m, b, x))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long bruteMin(long[] m, long[] b, long x) {
        // TODO
        return 0;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] m = new long[n], b = new long[n];
        for (int i = 0; i < n; i++) { m[i] = sc.nextLong(); b[i] = sc.nextLong(); }
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) sb.append(bruteMin(m, b, sc.nextLong())).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def brute_min(lines, x):
    # TODO: min over (m, b) of m*x + b
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    lines = [(int(next(data)), int(next(data))) for _ in range(n)]
    q = int(next(data))
    out = [str(brute_min(lines, int(next(data)))) for _ in range(q)]
    print("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct minimum for every query, verified by hand on a 2-line example.
- 64-bit arithmetic (no overflow at `|m|,|x| ≤ 10⁶`).
- Used later as the oracle for Tasks 2–5+.

---

### Task 2 — Monotone CHT (slopes decreasing, queries increasing)

**Problem.** Build a monotone CHT for **min** queries. `addLine(m, b)` is called with non-increasing slopes; `query(x)` is called with non-decreasing `x` (use the moving pointer). Answer each query in amortized `O(1)`.

**Input / Output spec.**
- Read `n` lines (given in non-increasing slope order), then `q` queries (given in non-decreasing x order). Print each query result.

**Constraints.** `1 ≤ n, q ≤ 10⁵`, `|m|, |b| ≤ 10⁶`, `|x| ≤ 10⁶`.

**Hint.** Maintain a deque of `(m, b)`. On insert, pop the back while the bad-line test `(b3-b1)(m1-m2) ≤ (b2-b1)(m1-m3)` says the middle is useless. On query, advance the pointer while the next line is `≤` the current at `x`.

**Reference snippet (Python core) — fill the TODOs.**
```python
class MonotoneCHT:
    def __init__(self):
        self.ls = []   # (m, b)
        self.ptr = 0

    @staticmethod
    def _bad(l1, l2, l3):
        return (l3[1]-l1[1])*(l1[0]-l2[0]) <= (l2[1]-l1[1])*(l1[0]-l3[0])

    def add(self, m, b):
        while len(self.ls) >= 2 and self._bad(self.ls[-2], self.ls[-1], (m, b)):
            self.ls.pop()
        self.ls.append((m, b))
        self.ptr = min(self.ptr, len(self.ls) - 1)

    def query(self, x):
        at = lambda i: self.ls[i][0]*x + self.ls[i][1]
        while self.ptr + 1 < len(self.ls) and at(self.ptr + 1) <= at(self.ptr):
            self.ptr += 1
        return at(self.ptr)
```

**Evaluation criteria.**
- Matches `bruteMin` from Task 1 for all queries.
- Insert is amortized `O(1)`; query is amortized `O(1)`.
- Cross-multiplied (integer) bad-line test, no floats.
- Equal-slope lines pre-filtered (keep smaller intercept) so the cross test never sees a zero denominator.

---

### Task 3 — CHT with binary-search query

**Problem.** Same monotone-slope insertion as Task 2, but queries arrive in **arbitrary** order. Implement binary search over the deque's breakpoints to answer each query in `O(log n)`.

**Input / Output spec.**
- Read `n` lines (non-increasing slopes), then `q` queries (any order). Print each result.

**Constraints.** `1 ≤ n, q ≤ 10⁵`, `|m|, |b|, |x| ≤ 10⁶`.

**Hint.** The deque's lines are slope-sorted, so their pairwise breakpoints are sorted. Binary-search for the line that owns the interval containing `x`; compare with the cross-multiplied test to avoid float intersection points.

**Evaluation criteria.**
- Matches `bruteMin` for arbitrary query order.
- `O(log n)` per query.
- Correctly handles a single line (envelope of size 1).

---

### Task 4 — Li Chao tree (min)

**Problem.** Implement a Li Chao tree over integer `x ∈ [-10⁶, 10⁶]` supporting `add(m, b)` and `query(x)` (minimum) in `O(log C)`, arbitrary insert/query order.

**Input / Output spec.**
- Read a sequence of operations: `1 m b` = add line; `2 x` = query, print the min. Mixed order.

**Constraints.** `1 ≤ #ops ≤ 2·10⁵`, `|m|, |b| ≤ 10⁶`, `|x| ≤ 10⁶`.

**Hint.** Each node stores one line, best at the node midpoint. Insert: compare at midpoint, keep the lower, recurse the loser into the side where it can still win. Query: take the min along the root-to-leaf path. Use `mid = l + (r-l)/2`.

**Reference snippet (Python core) — fill the TODOs.**
```python
INF = 1 << 62

class LiChao:
    def __init__(self, xlo, xhi):
        self.xlo, self.xhi = xlo, xhi
        self.M, self.B, self.lc, self.rc = [0], [INF], [-1], [-1]

    def _at(self, i, x):
        return INF if self.B[i] == INF else self.M[i]*x + self.B[i]

    def add(self, m, b):
        # TODO: recursive insert from node 0 over [xlo, xhi]
        ...

    def query(self, x):
        # TODO: walk root-to-leaf taking the min along the path
        ...
```

**Evaluation criteria.**
- Matches `bruteMin` after each query.
- Arbitrary insert/query interleaving handled.
- `O(log C)` per operation; correct `INF` sentinel guarded in `_at`.
- `mid = l + (r-l)//2` used (overflow-safe midpoint).

---

### Task 5 — Max line container via negation

**Problem.** Build a **maximum** line container: `addLine(m, b)` and `query(x)` returning the max of all lines at `x`. Implement it by negating into a min structure (CHT or Li Chao).

**Input / Output spec.**
- Read ops as in Task 4 but `query` prints the maximum.

**Constraints.** `1 ≤ #ops ≤ 2·10⁵`, `|m|, |b|, |x| ≤ 10⁶`.

**Hint.** Insert `(-m, -b)` into the min structure; return `-query_min(x)`. Verify `max(|x|, 3)` behaviour by adding `y=x`, `y=-x`, `y=3`.

**Evaluation criteria.**
- Matches a brute-force `max_j(m_j·x+b_j)` oracle.
- Negation done consistently for both line and result.
- No separate max-comparison logic (reuse the proven min code).

---

## Intermediate Tasks (5)

### Task 6 — Minimum-cost partition DP (CHT)

**Problem.** Given sorted `x[0..n-1]` and costs `cost[0..n-1]`, compute `dp[i] = min_{j<i}(dp[j] + (x[i]-x[j])²) + cost[i]`, `dp[0]=cost[0]`. Output `dp[n-1]`. Use a monotone CHT.

**Constraints.** `1 ≤ n ≤ 2·10⁵`, `0 ≤ x[i] ≤ 10⁶` (strictly increasing), `0 ≤ cost[i] ≤ 10⁶`.

**Hint.** Line for `j`: slope `-2x[j]`, intercept `dp[j]+x[j]²`. Query at `x[i]`, add `x[i]²+cost[i]`. Slopes decreasing, queries increasing → pointer CHT.

**Reference oracle (Python).**
```python
def dp_brute(x, cost):
    n = len(x)
    INF = float("inf")
    dp = [INF] * n
    dp[0] = cost[0]
    for i in range(1, n):
        for j in range(i):
            dp[i] = min(dp[i], dp[j] + (x[i] - x[j]) ** 2 + cost[i])
    return dp[n - 1]
```

**Worked first steps.** With `x = [0,2,5,7]`, `cost = [0,1,2,1]`: `dp[0] = 0`. Line for `j=0`: slope `-2·0 = 0`, intercept `0 + 0 = 0`. `dp[1] = x[1]² + cost[1] + query(x[1]) = 4 + 1 + (0·2 + 0) = 5`. Add line for `j=1`: slope `-2·2 = -4`, intercept `5 + 4 = 9`. `dp[2] = 25 + 2 + min(0·5+0, -4·5+9) = 27 + min(0, -11) = 27 - 11 = 16`. Continue similarly; cross-check every `dp[i]` against `dp_brute`.

**Evaluation criteria.**
- Matches `dp_brute` for small `n` (the whole-DP oracle).
- `O(n)` total via the monotone CHT.
- `i`-only term `x[i]²+cost[i]` factored out of the min and added back.
- Slopes `-2x[j]` are non-increasing (since `x` increases) and queries `x[i]` non-decreasing — the monotone preconditions hold.

---

### Task 7 — Frog jump with constant penalty

**Problem.** Heights `h[0..n-1]` (non-increasing). Jump cost `i→j` (`j>i`) is `(h[i]-h[j])² + C`. Minimize total cost from `0` to `n-1`. Output the cost.

**Constraints.** `1 ≤ n ≤ 2·10⁵`, `0 ≤ h[i] ≤ 10⁶` (non-increasing), `0 ≤ C ≤ 10⁹`.

**Hint.** `dp[j] = min_{i<j}(dp[i]+(h[i]-h[j])²)+C`. Line for `i`: slope `-2h[i]`, intercept `dp[i]+h[i]²`. Query at `h[j]`; queries `h[j]` decreasing → either reverse direction or use binary-search query.

**Evaluation criteria.**
- Matches the `O(n²)` brute DP for small `n`.
- Correct handling of the non-increasing query order (pointer direction or binary search).
- 64-bit arithmetic; `(h[i]-h[j])²` up to `10¹²`.

---

### Task 8 — Line container with arbitrary slopes (Li Chao or dynamic CHT)

**Problem.** `addLine(m, b)` with slopes in **arbitrary** order, `query(x)` for min, interleaved. The monotone CHT does not apply. Use a Li Chao tree (or dynamic CHT).

**Constraints.** `1 ≤ #ops ≤ 2·10⁵`, `|m| ≤ 10⁹`, `|b| ≤ 10¹²`, `|x| ≤ 10⁶`.

**Hint.** Li Chao handles arbitrary slope order natively and avoids the cross-product overflow (note `|m|` is large). Choose `INF` below the overflow threshold; guard the sentinel in `at()`.

**Evaluation criteria.**
- Matches `bruteMin` with arbitrary slopes.
- No overflow at `|m|=10⁹`, `|x|=10⁶`, `|b|=10¹²` (`m·x` up to `10¹⁵`).
- Arbitrary insert/query interleaving.

---

### Task 9 — Segment insertion in a Li Chao tree

**Problem.** Extend the Li Chao tree to insert a line valid only on `[lo, hi]` (`addSegment(m, b, lo, hi)`), plus `query(x)` for min. Lines outside `[lo,hi]` must not affect a query at points outside their range.

**Constraints.** `1 ≤ #ops ≤ 5·10⁴`, `|m|,|b| ≤ 10⁶`, `x, lo, hi ∈ [-10⁶, 10⁶]`.

**Hint.** Decompose `[lo,hi]` into the `O(log C)` canonical segment-tree nodes; run a line-insert within each subtree. Cost `O(log² C)` per segment; queries stay `O(log C)`.

**Reference oracle (Python).**
```python
def brute_seg_min(segments, x):
    INF = float("inf")
    best = INF
    for m, b, lo, hi in segments:
        if lo <= x <= hi:
            best = min(best, m * x + b)
    return best
```

**Evaluation criteria.**
- Matches `brute_seg_min` (a line only contributes where its range covers `x`).
- `O(log² C)` per segment insert.
- Correct canonical-node decomposition.

---

### Task 10 — Recognize whether CHT applies (linearization)

**Problem.** Given a transition cost `C(j, i)` as a formula, decide whether it linearizes into `m_j·x_i + b_j` and, if so, output the `(m_j, b_j, x_i, g(i))` decomposition. Handle these cases:
- `(x_i - x_j)²` → linearizable.
- `a·x_i·x_j + f(j) + h(i)` → linearizable.
- `|x_i - x_j|` (absolute value) → NOT linearizable as a single line (it is two lines / a V-shape).
- `(x_i - x_j)³` → NOT a single line.

**Constraints.** Symbolic/analysis task; implement `classify(formula)` returning the decomposition or `NOT_LINEARIZABLE`.

**Hint.** Expand and group: terms depending only on `i` go into `g(i)`; the coefficient of `x_i` (as a function of `j`) is the slope; the rest is the intercept. If `x_i` appears non-linearly (square, abs, cube), it is not a single line.

**Evaluation criteria.**
- Correctly decomposes the two linearizable cases.
- Correctly flags the two non-linearizable cases.
- Notes that `|x_i-x_j|` would need a *max/min of two* line families, not one.

---

## Advanced Tasks (5)

### Task 11 — Overflow-safe CHT for large coefficients

**Problem.** Implement a monotone CHT whose bad-line test is overflow-safe when `|m|, |b| ≤ 2·10⁹` (so the cross-product reaches `~10¹⁸·10¹⁸ = 10³⁶`). Use a 128-bit intermediate for the comparison.

**Constraints.** `1 ≤ n, q ≤ 10⁵`, `|m|, |b| ≤ 2·10⁹`, `|x| ≤ 10⁹`.

**Hint.** In Go use `math/bits.Mul64`; in Java use `BigInteger` for the comparison (or `Math.multiplyHigh`); in Python overflow is automatic. Compare `(b3-b1)(m1-m2)` vs `(b2-b1)(m1-m3)` in 128 bits.

**Evaluation criteria.**
- Matches `bruteMin` (run with Python big-ints) for adversarial large-coefficient inputs.
- The cross-product never overflows the 64-bit path; 128-bit comparison verified.
- Evaluation `m·x` also stays within range or uses wide types.

---

### Task 12 — Argmin recovery and path reconstruction

**Problem.** Solve Task 6's partition DP but also output the **sequence of indices** `j` that forms the optimal partition (the chosen predecessors), not just the cost. Attach the originating index to each line.

**Constraints.** `1 ≤ n ≤ 10⁵`, same ranges as Task 6.

**Hint.** Store `(m, b, j)` per line; when a query returns the best line, record `parent[i] = j`. Backtrack from `n-1` to `0` via `parent`. For the Li Chao variant, attach `j` to each node's line.

**Evaluation criteria.**
- Reconstructed path's total cost equals the DP value.
- `parent` chain reaches the base state.
- Tie-break documented (which `j` is chosen on equal cost).

---

### Task 13 — Offline line-add-and-remove via D&C over time (kinetic)

**Problem.** Lines are inserted and later removed (each line active during a time interval `[t_in, t_out)`). Answer `query(x)` at a given time `t`, returning the min over lines active at `t`. Solve **offline** with divide-and-conquer over the time axis plus a Li Chao tree.

**Constraints.** `1 ≤ #lines, #queries ≤ 5·10⁴`, time `t ∈ [0, T)` with `T ≤ 10⁵`, `|m|,|b| ≤ 10⁶`, `|x| ≤ 10⁶`.

**Hint.** Build a segment tree over time; insert each line into the `O(log T)` canonical time-nodes covering `[t_in, t_out)`. DFS the time tree maintaining a Li Chao tree (push lines on entry); answer each query at its time leaf. Lines are added but never removed within a DFS branch (the structure need not support deletion).

**Evaluation criteria.**
- Matches a brute-force "loop over lines active at `t`" oracle.
- `O((#lines + #queries) log T log C)` total.
- No online deletion needed (deletions simulated by the time decomposition).

---

### Task 14 — CHT vs D&C optimization on the same problem

**Problem.** Solve `dp[i] = min_{j<i}(dp[j] + (x[i]-x[j])²) + cost[i]` (Task 6's problem) **two ways**: (a) monotone CHT, (b) divide-and-conquer optimization (using that the optimal `j` is monotone). Verify both give identical results and compare their running times.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** For (b), the single-layer D&C optimization recursion `solve(lo, hi, optlo, opthi)` computes `dp` for indices in `[lo,hi]` knowing the optimal predecessor lies in `[optlo, opthi]`. This needs the *previous layer*'s `dp` — restructure as a layered DP or use the fact that here the predecessor is any earlier index (monotone argmin from the Monge cost).

**Evaluation criteria.**
- Both methods produce identical `dp[n-1]`.
- CHT is `O(n)`; D&C optimization is `O(n log n)`.
- Writeup: when each is preferable (CHT when the cost linearizes; D&C when only monotone argmin, no line form).

---

### Task 15 — Decide the right optimization for a problem

**Problem.** Implement `classify(problem)` that, given `(transition_shape, cost_property, n, k)`, returns one of `CHT_LICHAO`, `DC_OPTIMIZATION`, `KNUTH`, `PLAIN_DP`, or `NOT_APPLICABLE`, with justification. Handle:
- `dp[i]=min_j(m_j·x_i+b_j)`, large `n` → `CHT_LICHAO`.
- layered `dp_t[i]=min_k(dp_{t-1}[k]+C(k,i))`, Monge cost, argmin monotone → `DC_OPTIMIZATION`.
- interval `dp[i][j]=min_k(dp[i][k]+dp[k+1][j])+w(i,j)`, quadrangle inequality → `KNUTH`.
- small `n` or non-monotone cost → `PLAIN_DP`.
- simple-path / non-DP-optimizable structure → `NOT_APPLICABLE`.

**Constraints.** Analysis/classification task.

**Hint.** Encode the decision rules from `middle.md` and `professional.md`: line form → CHT; Monge layered with monotone argmin → D&C; Monge interval-merge → Knuth.

**Decision rules to encode.**
```text
if transition is dp[i] = g(i) + min_j(m_j*x_i + b_j)         → CHT_LICHAO
elif layered dp_t[i]=min_k(dp_{t-1}[k]+C(k,i)), C Monge,
     opt(i) monotone                                          → DC_OPTIMIZATION
elif interval dp[i][j]=min_k(dp[i][k]+dp[k+1][j])+w(i,j),
     w satisfies quadrangle inequality                        → KNUTH
elif n small or cost not optimizable                          → PLAIN_DP
else (e.g. simple-path / no exploitable structure)            → NOT_APPLICABLE
```

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification cites the right complexity (`O(n log n)`/`O(n)`, `O(kn log n)`, `O(n²)`, `O(n²)`/`O(n³)`).
- Distinguishes CHT (linearizable) from D&C (Monge but not necessarily linear).
- The `CHT_LICHAO` branch applies the "degree-1 in the query variable" test from `professional.md` Section 10.3.

---

## Benchmark Task

### Task B — Monotone CHT vs Li Chao vs naive crossover

**Problem.** Empirically compare three implementations on the partition DP (Task 6) for `n ∈ {10³, 10⁴, 10⁵, 10⁶}` (fixed seed): (a) naive `O(n²)` DP, (b) monotone CHT `O(n)`, (c) Li Chao `O(n log C)`. Measure wall-clock time and report a table; identify where naive becomes infeasible and how CHT and Li Chao compare.

**Starter — Python.**
```python
import random
import time

INF = float("inf")


def gen(n, seed):
    r = random.Random(seed)
    x = sorted(set(r.randint(0, 10**6) for _ in range(n)))
    cost = [r.randint(0, 10**6) for _ in range(len(x))]
    return x, cost


def dp_naive(x, cost):
    n = len(x)
    dp = [INF] * n
    dp[0] = cost[0]
    for i in range(1, n):
        best = INF
        for j in range(i):
            best = min(best, dp[j] + (x[i] - x[j]) ** 2)
        dp[i] = best + cost[i]
    return dp[-1]


def dp_cht(x, cost):
    # TODO: monotone CHT, O(n)
    return 0


def dp_lichao(x, cost):
    # TODO: Li Chao tree, O(n log C)
    return 0


def bench(fn, x, cost):
    t = time.perf_counter()
    val = fn(x, cost)
    return val, (time.perf_counter() - t) * 1000.0


def main():
    print("n         naive_ms     cht_ms      lichao_ms")
    for n in [1000, 10000, 100000, 1000000]:
        x, cost = gen(n, 42)
        cht_v, cht_t = bench(dp_cht, x, cost)
        li_v, li_t = bench(dp_lichao, x, cost)
        if n <= 10000:
            na_v, na_t = bench(dp_naive, x, cost)
            assert na_v == cht_v == li_v, (na_v, cht_v, li_v)
            print(f"{n:<9d} {na_t:<12.2f} {cht_t:<11.2f} {li_t:<.2f}")
        else:
            assert cht_v == li_v
            print(f"{n:<9d} {'(skipped)':<12} {cht_t:<11.2f} {li_t:<.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same instance across Go, Java, and Python.
- Naive (a) infeasible by `n=10⁵`; CHT (b) and Li Chao (c) handle `n=10⁶`.
- All three agree on small `n` (correctness before timing).
- Report the mean across ≥3 runs; do not time generation.
- Writeup: CHT beats Li Chao on constants (no `log C`), but Li Chao wins when slopes/queries are not monotone.

---

## General Guidance for All Tasks

- **Always validate against the brute oracle first.** Every task references `bruteMin` (structure-level) and DP tasks add the `O(n²)` whole-DP oracle. Run them on small inputs, diff, then trust the fast version.
- **Use the cross-multiplied (integer) bad-line test**; never compute float intersection points in the hot path.
- **Pick one min/max convention** — for max, negate `(m, b)` and the answer; never hand-edit comparison directions.
- **Size integer types deliberately.** `m·x` can reach `10¹⁵`+; the CHT cross-product can reach `10³⁶` — use 128-bit intermediates (Task 11) or Li Chao (which avoids it).
- **Factor out the `i`-only term.** Only the linear-in-`x_i` part is the line; `x_i²` (and similar) come out of the min and are added back.
- **Verify the monotone precondition** before using the pointer query; otherwise binary-search or use Li Chao.
- **Default to Li Chao for arbitrary order**; use the monotone CHT only when slopes and queries are provably sorted and the constant factor matters.
- **Differentially test two structures.** Where a task allows it, run a min-CHT and a Li Chao tree on the same inputs and assert equal values; disagreement localizes the bug.
- **Pre-filter equal slopes** in the monotone CHT (keep the smaller intercept) so the cross test never divides by — or multiplies in — a zero denominator.
- **Use the overflow worksheet** (`senior.md` Section 2.4): compute `max|m|·max|x|+max|b|` for evaluation and `(2·max|b|)·(2·max|m|)` for the cross test before choosing integer widths.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
