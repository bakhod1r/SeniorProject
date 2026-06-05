# Matrix Chain Multiplication (MCM) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the interval-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force recursive oracle on small chains before trusting the DP on larger inputs.**
> Conventions: the dimension array `p` has `n+1` entries; matrix `Aᵢ` (1-indexed) has shape `p[i-1] × p[i]`; multiplying `p×q` by `q×r` costs `p·q·r`.

---

## Beginner Tasks (5)

### Task 1 — Cost of a single matrix multiply

**Problem.** Implement `cost(p, q, r)` returning the number of scalar multiplications to multiply a `p × q` matrix by a `q × r` matrix. Then read three integers and print the cost.

**Input / Output spec.**
- Read `p`, `q`, `r`.
- Print `p·q·r`.

**Constraints.** `1 ≤ p, q, r ≤ 10⁴`. Use 64-bit to avoid overflow.

**Hint.** The result matrix is `p × r`; the inner dimension `q` is summed over and disappears.

**Starter — Go.**
```go
package main

import "fmt"

func cost(p, q, r int64) int64 {
	// TODO: return p*q*r (64-bit)
	return 0
}

func main() {
	var p, q, r int64
	fmt.Scan(&p, &q, &r)
	fmt.Println(cost(p, q, r))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long cost(long p, long q, long r) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong(), q = sc.nextLong(), r = sc.nextLong();
        System.out.println(cost(p, q, r));
    }
}
```

**Starter — Python.**
```python
import sys


def cost(p, q, r):
    # TODO
    return 0


def main():
    p, q, r = map(int, sys.stdin.read().split())
    print(cost(p, q, r))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct product for sample `(10, 20, 30) → 6000`.
- 64-bit arithmetic (no overflow for `10⁴` dimensions).

---

### Task 2 — Brute-force minimum cost (the oracle)

**Problem.** Implement a recursive `brute(p, i, j)` that returns the minimum cost to multiply `Aᵢ…Aⱼ` by trying every split, with no memoization. This is your correctness oracle for later tasks.

**Input / Output spec.**
- Read `n`, then `p` (`n+1` integers).
- Print `brute(p, 1, n)`.

**Constraints.** `1 ≤ n ≤ 12` (exponential — keep `n` small).

**Hint.** Base case `i == j` returns `0`. Otherwise minimize over `k` of `brute(i,k) + brute(k+1,j) + p[i-1]·p[k]·p[j]`.

**Worked check.** For `p = [40,20,30,10,30]`, the answer is `26000`.

**Evaluation criteria.**
- Returns `0` for `n = 1`.
- Matches `26000` on the sample chain.
- Used only to validate the DP versions; never run for large `n`.

---

### Task 3 — Bottom-up minimum cost

**Problem.** Implement `minCost(p)` using the bottom-up interval DP filled by increasing chain length. Return `dp[1][n]`.

**Input / Output spec.**
- Read `n`, then `p`.
- Print the minimum number of scalar multiplications.

**Constraints.** `1 ≤ n ≤ 500`, dimensions up to `10⁴`.

**Hint.** Loop `L = 2..n`, then `i`, set `j = i+L-1`, initialize `dp[i][j] = ∞`, minimize over `k`. Use 64-bit.

**Reference oracle (Python) — use this to validate.**
```python
import functools


def brute(p):
    n = len(p) - 1

    @functools.lru_cache(maxsize=None)
    def f(i, j):
        if i == j:
            return 0
        return min(f(i, k) + f(k + 1, j) + p[i - 1] * p[k] * p[j]
                   for k in range(i, j))
    return f(1, n)
```

**Starter — Go (fill in the inner loop).**
```go
package main

import (
	"fmt"
	"math"
)

func minCost(p []int) int64 {
	n := len(p) - 1
	dp := make([][]int64, n+1)
	for i := range dp {
		dp[i] = make([]int64, n+1)
	}
	for L := 2; L <= n; L++ {
		for i := 1; i+L-1 <= n; i++ {
			j := i + L - 1
			dp[i][j] = math.MaxInt64
			// TODO: for k := i; k < j; k++ { compute cost, keep min }
		}
	}
	return dp[1][n]
}

func main() {
	var n int
	fmt.Scan(&n)
	p := make([]int, n+1)
	for i := range p {
		fmt.Scan(&p[i])
	}
	fmt.Println(minCost(p))
}
```

**Starter — Java (fill in the inner loop).**
```java
import java.util.*;

public class Task3 {
    static long minCost(int[] p) {
        int n = p.length - 1;
        long[][] dp = new long[n + 1][n + 1];
        for (int L = 2; L <= n; L++) {
            for (int i = 1; i + L - 1 <= n; i++) {
                int j = i + L - 1;
                dp[i][j] = Long.MAX_VALUE;
                // TODO: for (int k = i; k < j; k++) { ... }
            }
        }
        return dp[1][n];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] p = new int[n + 1];
        for (int i = 0; i <= n; i++) p[i] = sc.nextInt();
        System.out.println(minCost(p));
    }
}
```

**Evaluation criteria.**
- `n = 1` returns `0`; `[10,20,30]` returns `6000`.
- Matches `brute` for random chains with `n ≤ 12`.
- `O(n³)` time, `O(n²)` space.

---

### Task 4 — Print the optimal parenthesization

**Problem.** Extend Task 3 to also record a split table and print the optimal parenthesization as a string like `((A1(A2A3))A4)`.

**Input / Output spec.**
- Read `n`, then `p`.
- Print the minimum cost on line 1 and the parenthesization on line 2.

**Constraints.** `1 ≤ n ≤ 500`.

**Hint.** Record `split[i][j] = k` whenever `dp[i][j]` improves. Reconstruct: `parens(i,j)` prints `Ai` if `i==j`, else `( parens(i,split) parens(split+1,j) )`.

**Worked check.** `p = [40,20,30,10,30]` → cost `26000`, order `((A1(A2A3))A4)`.

**Evaluation criteria.**
- The printed grouping has exactly `n-1` multiplies and uses each matrix once.
- Re-summing the costs of the printed multiplies equals the reported cost (replay check).
- `n = 1` prints `A1` with cost `0`.

---

### Task 5 — Top-down memoized minimum cost

**Problem.** Implement `minCost(p)` with memoized recursion (top-down). Return the minimum cost. Confirm it matches the bottom-up version.

**Input / Output spec.**
- Read `n`, then `p`.
- Print the minimum cost.

**Constraints.** `1 ≤ n ≤ 300` (mind recursion depth).

**Hint.** Cache by `(i, j)`. Base case `i == j → 0`. Each interval is solved once, so it's `O(n³)` like bottom-up.

**Evaluation criteria.**
- Identical output to Task 3 on all inputs.
- Each interval computed once (verify with a call counter on small `n`).
- Handles `n = 1` and `n = 2` correctly.

---

## Intermediate Tasks (5)

### Task 6 — Iterative (stack-based) reconstruction

**Problem.** Reconstruct the optimal parenthesization without recursion, using an explicit stack, so a deeply unbalanced split tree cannot overflow the call stack.

**Constraints.** `1 ≤ n ≤ 10⁵` (split table given/precomputed; only reconstruction is timed).

**Hint.** Push `(i, j, closing)` tuples. Pop: if `closing`, emit `)`; if `i==j`, emit `Ai`; else push the closing marker, then right `[k+1,j]`, then left `[i,k]`, and emit `(`.

**Evaluation criteria.**
- Output string identical to recursive reconstruction.
- No recursion; bounded auxiliary stack.
- Works on a left-leaning split table (`split[i][j] = i` for all intervals).

---

### Task 7 — Worst-order cost (maximum)

**Problem.** Compute both the minimum and the maximum scalar-multiplication cost over all parenthesizations of a chain, and print their ratio. This quantifies how much the order matters.

**Constraints.** `1 ≤ n ≤ 500`.

**Hint.** Run the same DP twice: once with `min`, once with `max` (initialize the max table to `0` / `-∞` appropriately and take the maximum over `k`).

**Worked check.** For `[40,20,30,10,30]`, min `26000`, max `69000`, ratio `≈ 2.65`.

**Evaluation criteria.**
- Min matches Task 3; max matches a brute-force max-oracle for `n ≤ 12`.
- Ratio printed to a sensible precision.
- Both directions use the identical interval-DP skeleton.

---

### Task 8 — Minimum-weight convex polygon triangulation

**Problem.** Given `m` vertex weights `w[0..m-1]` of a convex polygon, find the minimum total triangulation weight where triangle `(a,b,c)` weighs `w[a]·w[b]·w[c]`. Show it equals the MCM answer when `w = p`.

**Constraints.** `3 ≤ m ≤ 500`, weights up to `10⁴`.

**Hint.** `dp[i][j]` = min weight to triangulate vertices `i..j`; minimize over `k ∈ (i,j)` of `dp[i][k] + dp[k][j] + w[i]·w[k]·w[j]`. Answer is `dp[0][m-1]`.

**Reference oracle (Python).**
```python
import math


def brute_tri(w, i, j):
    if j - i < 2:
        return 0
    return min(brute_tri(w, i, k) + brute_tri(w, k, j) + w[i] * w[k] * w[j]
               for k in range(i + 1, j))
# brute_tri(w, 0, len(w)-1) for small m
```

**Evaluation criteria.**
- For `w = [40,20,30,10,30]`, returns `26000` (matches MCM).
- Matches `brute_tri` for `m ≤ 10`.
- `O(m³)`.

---

### Task 9 — Pluggable cost function

**Problem.** Generalize the DP to accept a `combineCost(p, i, k, j)` callback instead of hard-coding `p[i-1]·p[k]·p[j]`. Demonstrate with two cost models: schoolbook and a "small-intermediate-penalty" model `p[i-1]·p[k]·p[j] + p[i-1]·p[j]` (charging for materializing the result).

**Constraints.** `1 ≤ n ≤ 300`.

**Hint.** Pass the function into the DP. The recurrence, fill order, and reconstruction are unchanged; only the cost term varies.

**Evaluation criteria.**
- With the schoolbook callback, output matches Task 3.
- The alternate cost model produces a valid (possibly different) optimum.
- The DP code contains no hard-coded `p·q·r` — only the callback does.

---

### Task 10 — Peak-memory-optimal order (min-max)

**Problem.** Instead of minimizing total FLOPs, minimize the *largest intermediate matrix size* produced by any multiply. The size of the result of sub-chain `[i,j]` is `p[i-1]·p[j]`. Return the minimal achievable peak.

**Constraints.** `1 ≤ n ≤ 300`.

**Hint.** `dp[i][j] = min over k of max(dp[i][k], dp[k+1][j], p[i-1]·p[j])`. Note the optimum generally differs from the min-FLOPs optimum.

**Evaluation criteria.**
- For some chains, the min-peak order differs from the min-FLOPs order (demonstrate one).
- `dp[i][i] = 0` (a leaf matrix produces no intermediate).
- Matches a brute-force min-max oracle for `n ≤ 10`.

---

## Advanced Tasks (5)

### Task 11 — Full DP with replay verification

**Problem.** Compute the optimal cost and parenthesization, then independently **replay** the reconstructed plan: walk the implicit tree post-order, sum each multiply's `p·q·r`, and assert the total equals `dp[1][n]`. Print "OK" if they match.

**Constraints.** `1 ≤ n ≤ 500`.

**Hint.** The replay walks the split tree; at each internal node the left sub-product is `p[i-1]×p[k]`, the right is `p[k]×p[j]`, so the node costs `p[i-1]·p[k]·p[j]`. This catches a split table that drifted from the cost table.

**Evaluation criteria.**
- Replay sum equals `dp[1][n]` for all valid inputs.
- Detects an intentionally corrupted split table (e.g., set `split` outside the improvement guard) by failing the assertion.
- `O(n³)` DP, `O(n)` replay.

---

### Task 12 — Hu-Shing awareness: DP vs near-linear

**Problem.** Implement the `O(n³)` DP and benchmark it for growing `n`. Then write a short analysis (in comments) of when Hu-Shing's `O(n log n)` would be worth implementing, including the polygon-triangulation reframing. You do NOT need to implement Hu-Shing — only the DP and the analysis.

**Constraints.** `1 ≤ n ≤ 2000` for the benchmark.

**Hint.** Map the chain to an `(n+1)`-gon with vertex weights `p[0..n]`; triangulations biject with parenthesizations. State the crossover `n` where `n³` becomes painful in your environment.

**Evaluation criteria.**
- DP times reported for several `n` (e.g., 100, 500, 1000, 2000).
- Analysis correctly states `O(n³)` vs `O(n log n)` and the triangulation isomorphism.
- Analysis notes that Knuth's generic `O(n²)` does NOT apply to MCM (split-dependent cost).

---

### Task 13 — Cached plans across repeated chains

**Problem.** You receive `Q` queries, each a dimension array `p`. Many share the same dimension signature. Answer each query's minimum cost, but compute the DP only once per distinct signature (cache by the tuple of dimensions).

**Constraints.** `1 ≤ Q ≤ 10⁴`, each `n ≤ 200`.

**Hint.** Key a hash map by the immutable dimension tuple; on a cache miss, run the DP and store; on a hit, return the cached cost. The plan, once computed, is read-only.

**Evaluation criteria.**
- Distinct signatures trigger exactly one DP run each.
- Repeated signatures hit the cache (verify with a miss counter).
- Total work scales with distinct signatures, not `Q`.

---

### Task 14 — Boolean parenthesization variant

**Problem.** Given a boolean expression of literals (`T`/`F`) separated by operators (`&`, `|`, `^`), count the number of ways to parenthesize it so it evaluates to `True`, mod `1003`. This is the same interval-DP skeleton with a combine rule over (trueCount, falseCount) pairs at each split.

**Constraints.** Up to 200 operators.

**Hint.** `dp[i][j]` holds `(ways_true, ways_false)` for the sub-expression. For each split operator `k`, combine the left/right true/false counts per the operator's truth table, summing over splits. Reduce mod `1003`.

**Reference (Python skeleton).**
```python
MOD = 1003


def count_true(symbols, ops):
    n = len(symbols)
    # dpT[i][j], dpF[i][j] over operand range [i, j]
    # TODO: fill by increasing range, combining at each operator k
    ...
```

**Evaluation criteria.**
- `T|T&F^T` (one standard sample) returns the known count.
- Matches a brute-force parenthesization enumerator for ≤ 8 operands.
- Reduces mod `1003` and uses the interval-DP fill order.

---

### Task 15 — Classify the right tool

**Problem.** Given a problem description with parameters `(operation_type, n, commutative?, needs_grouping?)`, return one of: `INTERVAL_DP_MCM`, `SUBSET_DP_JOIN`, `HU_SHING`, `GREEDY_HEURISTIC`, or `BRUTE_FORCE_OK`. Justify each decision.

**Constraints / cases to handle.**
- Non-commutative chain, moderate `n`, needs grouping → `INTERVAL_DP_MCM`.
- Commutative joins, small `n` (≤ 12) → `SUBSET_DP_JOIN`.
- Non-commutative chain, huge `n` (thousands) → `HU_SHING`.
- Commutative, large `n` (> 20) → `GREEDY_HEURISTIC`.
- Any operation, `n ≤ 6` → `BRUTE_FORCE_OK` (teaching/validation).

**Hint.** Encode the decision rules from `senior.md` and `professional.md`. The key fork is commutativity: contiguous-only → interval DP; commutative → subset DP / heuristics.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification cites the right complexity (`O(n³)`, `O(3ⁿ)`, `O(n log n)`).
- Notes the commutativity fork explicitly.

---

## Benchmark Task

### Task B — Brute force vs DP crossover

**Problem.** Empirically find the `n` at which the `O(n³)` DP overtakes brute-force enumeration. Implement both on random dimension arrays (fixed seed):

- **(a) Brute force:** recursive split, no memo — `O(Catalan(n-1))`.
- **(b) Bottom-up DP:** `O(n³)`.
- **(c) Top-down memo:** `O(n³)`.

Measure wall-clock time for `n ∈ {5, 8, 10, 12, 14, 50, 200}` (run brute force only where it finishes). Report a table and identify where brute force becomes infeasible.

**Starter — Python.**
```python
import random
import time
import functools
from typing import List

MOD = None


def gen_dims(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(1, 100) for _ in range(n + 1)]


def brute(p):
    n = len(p) - 1

    def f(i, j):
        if i == j:
            return 0
        return min(f(i, k) + f(k + 1, j) + p[i - 1] * p[k] * p[j]
                   for k in range(i, j))
    return f(1, n)


def dp_bottom_up(p):
    # TODO: O(n^3) bottom-up
    return 0


def memo_top_down(p):
    # TODO: O(n^3) memoized recursion
    return 0


def bench(fn, p) -> float:
    start = time.perf_counter()
    fn(p)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n     brute_ms        dp_ms         memo_ms")
    for n in [5, 8, 10, 12, 14, 50, 200]:
        p = gen_dims(n, 42)
        d = [bench(dp_bottom_up, p) for _ in range(3)]
        m = [bench(memo_top_down, p) for _ in range(3)]
        if n <= 14:
            b = [bench(brute, p) for _ in range(3)]
            print(f"{n:<5d} {mean_ms(b):<15.3f} {mean_ms(d):<13.3f} {mean_ms(m):<13.3f}")
        else:
            print(f"{n:<5d} {'(skipped)':<15} {mean_ms(d):<13.3f} {mean_ms(m):<13.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same dimension array across Go, Java, and Python.
- Brute force becomes infeasible around `n ≈ 14–16` (Catalan blow-up); DP and memo stay fast through `n = 200`.
- DP and memo agree on the cost for every `n`.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on where brute force dies and why (`Catalan(n-1) ≈ 4ⁿ/n^{1.5}`).

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Run it on small `n` (≤ 12), diff against the DP, and only then trust the DP on large inputs.
- **Pin conventions as named constants.** Matrices are 1-indexed `A₁..Aₙ`; `p` has `n+1` entries; `Aᵢ` is `p[i-1] × p[i]`.
- **Get the indexing right.** The cost term is `p[i-1]·p[k]·p[j]` — left endpoint contributes `p[i-1]`, not `p[i]`.
- **Fill by chain length.** Iterate `L = 2..n`, then `i`, then `k`. Never loop `i, j` directly (you'd read uncomputed sub-intervals). Or memoize top-down.
- **Store the split table** whenever the parenthesization is the deliverable, and set cost and split together inside the improvement guard.
- **Mind overflow.** Use 64-bit (`long`/`int64`) for the cost and `dp` entries; `p·q·r` overflows 32-bit for realistic dimensions.
- **Know the boundary.** Matrix chains are non-commutative → interval DP. Commutative problems (joins) need subset DP. Simple `O(n³)` is not optimal for the literal chain — Hu-Shing gives `O(n log n)`.

## Worked Reference Outputs

Use these to sanity-check your implementations before running the larger validations:

| Input `p` | min cost | optimal order | worst cost |
|-----------|----------|---------------|------------|
| `[10,20,30]` | 6000 | `(A1A2)` | 6000 |
| `[40,20,30,10,30]` | 26000 | `((A1(A2A3))A4)` | 69000 |
| `[10,30,5,60]` | 4500 | `((A1A2)A3)` | 27000 |
| `[5,4,6,2,7]` | 158 | `((A1(A2A3))A4)` | 280 |
| `[30,35,15,5,10,20,25]` | 15125 | `((A1(A2A3))((A4A5)A6))` | (varies) |

The `[30,35,15,5,10,20,25]` chain is the classic CLRS example; its optimum `15125` is a standard reference value. If your code reproduces all rows above, the core recurrence and reconstruction are almost certainly correct.

## Common Pitfalls Checklist

Before submitting any task, verify:

- [ ] `n = len(p) - 1` (not `len(p)`).
- [ ] Cost term is `p[i-1]·p[k]·p[j]` (left endpoint uses `p[i-1]`).
- [ ] Table filled by chain length `L`, shortest first.
- [ ] `dp[i][j]` initialized to a large sentinel before the `k` loop.
- [ ] `split[i][j]` set *inside* the improvement guard, together with `dp[i][j]`.
- [ ] 64-bit arithmetic for the cost and `dp` entries.
- [ ] Reconstruction base case `i == j` returns the leaf, never indexes `split`.
- [ ] `n = 1` handled (cost 0, order `A1`).
- [ ] Replay check passes: re-summed plan cost equals `dp[1][n]`.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
