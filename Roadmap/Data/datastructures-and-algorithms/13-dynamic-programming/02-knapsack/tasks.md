# Knapsack DP — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the knapsack DP logic and validate against the evaluation criteria.
> **Always test against a brute-force subset oracle on small inputs before trusting the DP result.**

---

## Beginner Tasks (5)

### Task 1 — 0/1 knapsack best value (2D table)

**Problem.** Given `n` items with weights `w[i]` and values `v[i]` and capacity `W`, compute the maximum total value of a subset with total weight `≤ W`. Use the 2D DP table.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines each `w[i] v[i]`.
- Print the single best value `dp[n][W]`.

**Constraints.**
- `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^4`, `1 ≤ w[i], v[i] ≤ 10^5`.
- Use 64-bit accumulation for values.

**Hint.** `dp[i][w] = max(dp[i-1][w], v[i] + dp[i-1][w - w[i]])` when `w[i] ≤ w`.

**Starter — Go.**
```go
package main

import "fmt"

func knapsack01(weight, value []int, W int) int {
	// TODO: fill (n+1)x(W+1) table; return dp[n][W]
	return 0
}

func main() {
	var n, W int
	fmt.Scan(&n, &W)
	weight := make([]int, n)
	value := make([]int, n)
	for i := 0; i < n; i++ {
		fmt.Scan(&weight[i], &value[i])
	}
	fmt.Println(knapsack01(weight, value, W))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int knapsack01(int[] weight, int[] value, int W) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), W = sc.nextInt();
        int[] weight = new int[n], value = new int[n];
        for (int i = 0; i < n; i++) { weight[i] = sc.nextInt(); value[i] = sc.nextInt(); }
        System.out.println(knapsack01(weight, value, W));
    }
}
```

**Starter — Python.**
```python
import sys


def knapsack01(weight, value, W):
    # TODO
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n, W = int(next(data)), int(next(data))
    weight = [0] * n
    value = [0] * n
    for i in range(n):
        weight[i] = int(next(data))
        value[i] = int(next(data))
    print(knapsack01(weight, value, W))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct value, verified by hand on the 3-item `W=5` example (answer 7).
- `dp[0][*] = 0`, `dp[*][0] = 0` handled.
- `O(n·W)`.

---

### Task 2 — 0/1 knapsack with 1D array (descending)

**Problem.** Same as Task 1 but use a single 1D array `dp[0..W]` swept **descending** for `O(W)` memory.

**Input / Output spec.** Same as Task 1.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ W ≤ 10^5`.

**Hint.** `for w := W; w >= weight[i]; w--`. If you sweep ascending you silently solve *unbounded* knapsack instead — a great thing to test.

**Reference oracle (Python).**
```python
def brute01(weight, value, W):
    n = len(weight)
    best = 0
    for mask in range(1 << n):
        tw = tv = 0
        for i in range(n):
            if mask & (1 << i):
                tw += weight[i]; tv += value[i]
        if tw <= W:
            best = max(best, tv)
    return best
```

**Evaluation criteria.**
- Matches the 2D table from Task 1 on all inputs.
- Matches `brute01` for `n ≤ 18`.
- Uses descending sweep (verify it does NOT reuse items).

---

### Task 3 — Reconstruct chosen items

**Problem.** Given the 0/1 knapsack instance, output the maximum value AND the sorted list of chosen item indices (0-based). Use the 2D table back-trace.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i]`.
- Print the best value on line 1, then the chosen indices space-separated on line 2.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^4`.

**Hint.** Back-trace: for `i = n` down to `1`, if `dp[i][w] != dp[i-1][w]` the item was taken — record it and `w -= weight[i-1]`.

**Worked check.** For `weight=[2,3,4], value=[3,4,5], W=5`, the value is 7 and the chosen items are `{0,1}` (weights 2+3=5). Confirm the chosen weights never exceed `W` and their values sum to the reported best value.

**Evaluation criteria.**
- Chosen weights sum to `≤ W`; chosen values sum to the reported best value.
- Matches a brute-force argmax subset for `n ≤ 18`.
- Handles ties deterministically (document your tie-break).

---

### Task 4 — Subset-sum feasibility

**Problem.** Given `n` positive integers and a target `S`, decide whether some subset sums to exactly `S`. Use the Boolean 1D DP.

**Input / Output spec.**
- Read `n`, `S`, then `n` integers.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ S ≤ 10^5`, `1 ≤ a[i] ≤ 1000`.

**Hint.** `dp[0] = true`; for each `x`, sweep `s` from `S` down to `x`: `dp[s] = dp[s] or dp[s - x]`.

**Reference oracle (Python).**
```python
def brute_subset_sum(nums, S):
    n = len(nums)
    for mask in range(1 << n):
        if sum(nums[i] for i in range(n) if mask & (1 << i)) == S:
            return True
    return False
```

**Evaluation criteria.**
- `dp[0]` true (empty subset); `S = 0` → YES.
- Matches `brute_subset_sum` for `n ≤ 18`.
- Descending sweep (0/1 — each number used at most once).

---

### Task 5 — Unbounded knapsack (max value)

**Problem.** Same items as Task 1, but each item may be taken **unlimited** times. Compute the max value within capacity `W`. Use the 1D array swept **ascending**.

**Input / Output spec.** Same as Task 1.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^4`, `1 ≤ w[i] ≤ W` (no zero-weight items).

**Hint.** `for w := weight[i]; w <= W; w++`. Ascending lets `dp[w - w[i]]` already include copies of item `i`.

**Evaluation criteria.**
- For a single item `(w=2, v=3)` and `W=7`, the answer is `9` (three copies, capacity 6).
- Ascending sweep (verify items ARE reused).
- Matches a brute-force "best of all multisets" for tiny `W`.

---

## Intermediate Tasks (5)

### Task 6 — Bounded knapsack via binary splitting

**Problem.** Each item `i` is available in `c[i]` copies. Compute the max value within capacity `W`. Use binary splitting (do NOT expand all copies).

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i] c[i]`.
- Print the best value.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ W ≤ 10^4`, `1 ≤ c[i] ≤ 10^6`.

**Hint.** Split `c[i]` into chunks `1, 2, 4, …, remainder`; each chunk of size `m` is a 0/1 pseudo-item of weight `m·w[i]`, value `m·v[i]`. Total `O(n·W·log max_c)`.

**Reference oracle (Python).**
```python
def brute_bounded(weight, value, count, W):
    # expand all copies, then brute-force (only for tiny inputs)
    items = []
    for w, v, c in zip(weight, value, count):
        items += [(w, v)] * c
    n = len(items)
    best = 0
    for mask in range(1 << n):
        tw = tv = 0
        for i in range(n):
            if mask & (1 << i):
                tw += items[i][0]; tv += items[i][1]
        if tw <= W:
            best = max(best, tv)
    return best
```

**Evaluation criteria.**
- Matches `brute_bounded` for tiny inputs (few small counts).
- Runs in `O(n·W·log max_c)` — large counts do NOT blow up.
- Verify a single item with `c` copies matches taking up to `min(c, W // w)` copies.

---

### Task 7 — Partition into two equal-sum subsets

**Problem.** Given positive integers, decide whether they split into two subsets of equal sum.

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ a[i] ≤ 100`.

**Hint.** If `total` is odd → NO. Else subset-sum to `total/2` (Task 4).

**Evaluation criteria.**
- `[1,5,11,5]` → YES; `[1,2,3,5]` → NO.
- Odd total → NO without running the DP.
- Matches a brute-force partition check for `n ≤ 18`.

---

### Task 8 — Count subsets summing to S

**Problem.** Given `n` positive integers and target `S`, count the number of subsets summing to exactly `S`, modulo `10^9 + 7`.

**Input / Output spec.**
- Read `n`, `S`, then `n` integers.
- Print the count mod `10^9 + 7`.

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ S ≤ 10^4`, `1 ≤ a[i] ≤ 1000`.

**Hint.** `dp[0] = 1`; for each `x`, sweep `s` descending: `dp[s] = (dp[s] + dp[s - x]) % MOD`. The empty subset counts for `S = 0`.

**Reference oracle (Python).**
```python
def brute_count(nums, S):
    n = len(nums)
    cnt = 0
    for mask in range(1 << n):
        if sum(nums[i] for i in range(n) if mask & (1 << i)) == S:
            cnt += 1
    return cnt
```

**Evaluation criteria.**
- Matches `brute_count` for `n ≤ 18`.
- `S = 0` returns 1 (the empty subset) — unless the problem excludes it (document your choice).
- Counts reduced mod `10^9 + 7`.

---

### Task 9 — Fractional knapsack (greedy)

**Problem.** Items may be taken in any fraction `0 ≤ f ≤ 1`. Compute the maximum value within capacity `W`. Use the greedy ratio algorithm.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i]`.
- Print the max value as a real number with 6 decimal places.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ W ≤ 10^9`, `1 ≤ w[i], v[i] ≤ 10^6`.

**Hint.** Sort by `v[i]/w[i]` descending; take whole items until one does not fit, then take a fraction of it to fill `W` exactly. `O(n log n)`.

**Worked check.** `weight=[10,20,30], value=[60,100,120], W=50` → fractional optimum is `240.000000` (all of items 0,1 and `2/3` of item 2), which is ≥ the 0/1 optimum of 220. Use this contrast to confirm greedy is fractional-only.

**Evaluation criteria.**
- Fractional value ≥ the 0/1 DP value on the same instance (relaxation bound).
- Correct fractional top-off on the boundary item.
- `O(n log n)`.

---

### Task 10 — Coin change: minimum coins (unbounded)

**Problem.** Given coin denominations (unlimited supply) and an amount, return the minimum number of coins, or `-1` if impossible.

**Input / Output spec.**
- Read `n`, `amount`, then `n` coin values.
- Print the minimum coin count or `-1`.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ amount ≤ 10^4`, `1 ≤ coin ≤ 10^4`.

**Hint.** Unbounded DP minimizing count: `dp[0] = 0`, `dp[a] = min(dp[a], dp[a-coin] + 1)`, swept **ascending**.

**Reference oracle (Python).**
```python
def brute_coin(coins, amount):
    INF = float("inf")
    best = [INF] * (amount + 1)
    best[0] = 0
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a and best[a - c] + 1 < best[a]:
                best[a] = best[a - c] + 1
    return -1 if best[amount] == INF else best[amount]
```

**Evaluation criteria.**
- `[1,2,5], 11` → 3; `[2], 3` → -1.
- Ascending sweep (coins reusable).
- Matches `brute_coin`.

---

## Advanced Tasks (5)

### Task 11 — Knapsack with huge W (meet-in-the-middle)

**Problem.** Solve 0/1 knapsack with small `n` and huge `W`. Return the best value.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i]`.
- Print the best value.

**Constraints.** `1 ≤ n ≤ 40`, `1 ≤ W ≤ 10^{18}`, `1 ≤ w[i], v[i] ≤ 10^9`.

**Hint.** Split items in half; enumerate all `2^{n/2}` subsets of each half; sort one half by weight with prefix-max value; for each subset of the other half, binary-search the best complement under the remaining budget. `O(2^{n/2}·n)`.

**Evaluation criteria.**
- Matches the table DP on instances where `W` is small enough for both.
- Runs in well under a second for `n = 40`, any `W`.
- Prunes dominated pairs in the sorted half (optional but recommended).

---

### Task 12 — Value-indexed DP for huge W, small values

**Problem.** Solve 0/1 knapsack where `W` is huge but total value is small. Return the best value.

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i]`.
- Print the best value.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^{18}`, `1 ≤ v[i] ≤ 100`, `1 ≤ w[i] ≤ 10^{18}`.

**Hint.** Tabulate `cost[v]` = minimum weight to achieve value `v`, in `O(n·V_total)` where `V_total = Σ v[i]`. Answer = max `v` with `cost[v] ≤ W`. The capacity only appears in the final scan.

**Reference oracle (Python).**
```python
def value_indexed(weight, value, W):
    Vtot = sum(value)
    INF = float("inf")
    cost = [INF] * (Vtot + 1)
    cost[0] = 0
    for wi, vi in zip(weight, value):
        for v in range(Vtot, vi - 1, -1):     # 0/1 descending
            if cost[v - vi] + wi < cost[v]:
                cost[v] = cost[v - vi] + wi
    return max(v for v in range(Vtot + 1) if cost[v] <= W)
```

**Evaluation criteria.**
- Matches the table DP when `W` is small enough for both.
- Handles `W = 10^{18}` instantly (capacity never indexes the table).
- `O(n·V_total)`.

---

### Task 13 — FPTAS for 0/1 knapsack

**Problem.** Implement a `(1-ε)`-approximation for 0/1 knapsack by value scaling. Return the approximate value and verify it is within `ε` of the exact optimum on small instances.

**Input / Output spec.**
- Read `n`, `W`, `ε` (as a float), then `n` lines `w[i] v[i]`.
- Print the approximate best value (the TRUE value of the chosen subset).

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^9`, `1 ≤ v[i] ≤ 10^9`, `0 < ε < 1`.

**Hint.** Scale `K = ε·v_max / n`, round `v'[i] = ⌊v[i]/K⌋`, run exact value-indexed DP on the scaled values, reconstruct the subset, return its true value. `V_total' ≤ n²/ε`.

**Evaluation criteria.**
- Approximate value ≥ `(1-ε)` × exact optimum (compare against the table DP on small instances).
- Running time grows as `O(n²/ε)`.
- Document why the FPTAS exists (knapsack is weakly NP-hard; the value DP is pseudo-polynomial).

---

### Task 14 — Bounded knapsack via monotonic deque (O(n·W))

**Problem.** Solve bounded knapsack in `O(n·W)` using the monotonic-deque sliding-window-max method (no `log max_c` factor).

**Input / Output spec.**
- Read `n`, `W`, then `n` lines `w[i] v[i] c[i]`.
- Print the best value.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ W ≤ 10^5`, `1 ≤ c[i] ≤ 10^9`.

**Hint.** For each item, process capacities in residue classes mod `w[i]`. Within a class, maintain a deque of `(j, dp[r + j·w[i]] - j·v[i])`; the window of size `c[i]` gives the best number of copies; add `j·v[i]` back. The `- j·v[i]` normalization is the crux.

**Evaluation criteria.**
- Matches the binary-splitting result from Task 6 on all inputs.
- Runs in `O(n·W)` — independent of `max_c`.
- Correct residue-class handling and window size `c[i]`.

---

### Task 15 — Decide the right knapsack algorithm

**Problem.** Implement `classify(n, W, Vtotal, divisible, copies)` that returns the best algorithm for an instance: one of `TABLE_DP`, `VALUE_INDEXED`, `MEET_IN_MIDDLE`, `FRACTIONAL_GREEDY`, `FPTAS`. Justify each rule.

**Constraints / cases to handle.**
- Small `n·W` → `TABLE_DP`.
- Huge `W`, small `Vtotal` → `VALUE_INDEXED`.
- Huge `W`, small `n` (≤ 40), large values → `MEET_IN_MIDDLE`.
- Items divisible (fractional allowed) → `FRACTIONAL_GREEDY`.
- All large, approximate acceptable → `FPTAS`.

**Hint.** Encode the decision tree from `senior.md`. The trap is choosing the table when `W` is huge — always check `n·W` (or `n·Vtotal`) feasibility first.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification cites the right complexity (`O(n·W)`, `O(n·V)`, `O(2^{n/2}·n)`, `O(n log n)`, `O(n²/ε)`).
- The FPTAS branch notes the `(1-ε)` guarantee and weak NP-hardness.

---

## Benchmark Task

### Task B — Table DP vs Meet-in-the-Middle crossover

**Problem.** Empirically find where meet-in-the-middle overtakes the table DP as `W` grows, for fixed `n = 36`. Implement two workloads on a random instance (fixed seed):

- **(a) Table DP:** `O(n·W)` (only for `W` small enough to fit memory/time).
- **(b) Meet-in-the-middle:** `O(2^{n/2}·n)`, independent of `W`.

Measure wall-clock time for `W ∈ {10^3, 10^5, 10^7, 10^9, 10^{12}}` (use the huge `W` only for MITM). Report a table and identify the crossover `W`.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_instance(n: int, seed: int):
    r = random.Random(seed)
    weight = [r.randint(1, 10 ** 6) for _ in range(n)]
    value = [r.randint(1, 10 ** 6) for _ in range(n)]
    return weight, value


def table_dp(weight, value, W) -> int:
    # TODO: O(n*W) 1D DP, descending
    return 0


def mitm(weight, value, W) -> int:
    # TODO: meet-in-the-middle, O(2^{n/2} * n)
    return 0


def bench(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    n = 36
    weight, value = gen_instance(n, 42)
    print("W              table_dp_ms       mitm_ms")
    for W in [10 ** 3, 10 ** 5, 10 ** 7, 10 ** 9, 10 ** 12]:
        rb = [bench(mitm, weight, value, W) for _ in range(3)]
        if W <= 10 ** 7:
            ra = [bench(table_dp, weight, value, W) for _ in range(3)]
            print(f"{W:<14d} {mean_ms(ra):<17.2f} {mean_ms(rb):<10.2f}")
        else:
            print(f"{W:<14d} {'(skipped)':<17} {mean_ms(rb):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same instance across Go, Java, and Python.
- Table DP (a) wins for small `W`; MITM (b) wins for large `W`. Report the crossover `W`.
- MITM completes for `W = 10^{12}` in well under a second; the table is infeasible there.
- Report includes the mean across at least 3 runs and does not time instance generation.
- Writeup: a short note on the measured crossover and how it compares to the theoretical `n·W ≈ 2^{n/2}·n`, i.e. `W ≈ 2^{n/2}`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every task above ships with (or references) a slow subset/expansion oracle. Run it on small `n` and small `W`, diff, then trust the DP on large inputs.
- **Pin the modulus and the `INF` sentinel as named constants.** Use `MOD = 10^9 + 7` and `INF = MAX/4`; never inline magic numbers.
- **Get the sweep direction right.** Descending for 0/1 (item once); ascending for unbounded (item reusable). This is the single most copied-wrong detail.
- **Index by the smaller dimension.** Weight-indexed is `O(n·W)`; value-indexed is `O(n·V)`. For huge `W` with small values, flip.
- **Mind overflow.** Use 64-bit value accumulation; take subset counts mod a prime.
- **Never use greedy for 0/1.** Greedy by ratio is exact only for the fractional variant; for 0/1 it is at best an upper bound, not the answer.
- **Reuse the `knapsack`/`mat`-style core.** Most bugs live in the inner update and its loop bound; write it once, test it hard, parameterize the rest.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
