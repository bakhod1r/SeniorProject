# Rod Cutting (Unbounded DP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code or hints in all three languages. Implement the DP logic and validate against the evaluation criteria.
> **Always test against a brute-force recursive oracle on small `n` before trusting the DP on large inputs, and verify reconstruction with the invariants `Σ pieces == n` and `Σ price[pieces] == dp[n]`.**

---

## Beginner Tasks (5)

### Task 1 — Maximum revenue (value only)

**Problem.** Given a price table `price[1..n]` (with `price[0] = 0`) and rod length `n`, compute the maximum revenue using the recurrence `dp[len] = max_c (price[c] + dp[len-c])`, `dp[0] = 0`.

**Input / Output spec.**
- Read `n`, then `price[1], …, price[n]`.
- Print the single integer `dp[n]`.

**Constraints.**
- `1 ≤ n ≤ 10^4`, `0 ≤ price[i] ≤ 10^6`.
- Use 64-bit revenue.

**Hint.** Two nested loops; inner loop `c` from `1` to `len` *inclusive* (include the sell-whole option).

**Starter — Go.**
```go
package main

import "fmt"

func maxRevenue(price []int64, n int) int64 {
	// TODO: fill dp[0..n], return dp[n]
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	price := make([]int64, n+1)
	for i := 1; i <= n; i++ {
		fmt.Scan(&price[i])
	}
	fmt.Println(maxRevenue(price, n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long maxRevenue(long[] price, int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] price = new long[n + 1];
        for (int i = 1; i <= n; i++) price[i] = sc.nextLong();
        System.out.println(maxRevenue(price, n));
    }
}
```

**Starter — Python.**
```python
import sys


def max_revenue(price, n):
    # TODO
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    price = [0] + [int(next(data)) for _ in range(n)]
    print(max_revenue(price, n))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct `dp[n]`, verified against a hand calculation on the CLRS table.
- Inner loop reaches `c = len`.
- `O(n^2)`, 64-bit revenue.

---

### Task 2 — Reconstruct the cut list

**Problem.** Same input as Task 1, but also output the lengths of the pieces that achieve the maximum revenue, using a `choice[]` array and a backward walk.

**Input / Output spec.**
- Read `n`, then `price[1..n]`.
- Print `dp[n]` on the first line, then the cut lengths space-separated on the second.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hint.** In the inner loop, when a candidate beats `best`, store `choice[len] = c`. Then `len = n; while len > 0: emit choice[len]; len -= choice[len]`.

**Reference oracle (Python) — validate against this.**
```python
def rod_brute(price, n):
    if n == 0:
        return 0
    return max(price[c] + rod_brute(price, n - c) for c in range(1, n + 1))
```

**Evaluation criteria.**
- The emitted pieces sum to `n`.
- Their prices sum to `dp[n]`.
- `dp[n]` matches `rod_brute` for small `n`.

---

### Task 3 — Sell-whole detection

**Problem.** Given `price[1..n]` and `n`, determine whether selling the rod *whole* (one piece of length `n`) is an optimal choice. Print `YES` if `price[n] == dp[n]`, else `NO`.

**Input / Output spec.**
- Read `n`, then `price[1..n]`.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hint.** Compute `dp[n]` normally, then compare to `price[n]`. This tests that your inner loop includes `c = len`.

**Worked check.** For `price = [_,1,5,8,9]`, `n = 4`: `dp[4] = 10 > price[4] = 9`, so `NO`. For `price = [_,1,5,8,20]`, `n = 4`: `dp[4] = 20 = price[4]`, so `YES`.

**Evaluation criteria.**
- Correctly detects when whole is optimal (including ties).
- Matches brute force for small `n`.

---

### Task 4 — Top-down memoized version

**Problem.** Solve Task 1 using *top-down* recursion with memoization instead of bottom-up tabulation. Return `dp[n]`.

**Input / Output spec.**
- Read `n`, then `price[1..n]`. Print `dp[n]`.

**Constraints.** `1 ≤ n ≤ 5000` (keep recursion depth manageable; raise the limit if needed).

**Hint.** Use a memo array initialized to a sentinel (`-1` / `None`) distinct from `0` (a valid answer). `solve(0) = 0`.

**Reference oracle (Python).**
```python
def rod_brute(price, n):
    if n == 0:
        return 0
    return max(price[c] + rod_brute(price, n - c) for c in range(1, n + 1))
```

**Evaluation criteria.**
- Memo sentinel is not `0`.
- Each `dp[len]` computed once.
- Matches the bottom-up result and `rod_brute` on small `n`.

---

### Task 5 — Brute-force oracle

**Problem.** Implement the exponential brute-force `rod_brute(price, n)` that tries every first cut recursively (no memoization). You will reuse it to validate all later tasks.

**Input / Output spec.**
- Read `n`, then `price[1..n]`. Print `dp[n]`.

**Constraints.** `1 ≤ n ≤ 20` (exponential — keep `n` small).

**Hint.** `rod_brute(0) = 0`; otherwise `max over c in 1..n of price[c] + rod_brute(n - c)`.

**Evaluation criteria.**
- Correct on `n ≤ 20`.
- Agrees with the DP versions on shared small inputs.
- Documents that this is `O(2^n)` and only an oracle.

---

## Intermediate Tasks (5)

### Task 6 — Cost-per-cut variant

**Problem.** Each saw cut costs a fixed fee `cutCost`. Selling whole makes 0 cuts; an `m`-piece plan makes `m - 1` cuts. Maximize revenue minus total cut cost.

**Input / Output spec.**
- Read `n`, `cutCost`, then `price[1..n]`.
- Print the maximum profit.

**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ cutCost ≤ 10^6`.

**Hint.** `dp[len] = max_c (price[c] + dp[len-c] - (cutCost if c < len else 0))`. Charge the fee **only when `c < len`** (a remainder is severed).

**Reference oracle (Python).**
```python
def brute_cost(price, n, cut_cost):
    if n == 0:
        return 0
    best = float("-inf")
    for c in range(1, n + 1):
        fee = 0 if c == n else cut_cost
        best = max(best, price[c] + brute_cost(price, n - c, cut_cost) - fee)
    return best
```

**Evaluation criteria.**
- `cutCost = 0` reduces exactly to Task 1's answer.
- Matches `brute_cost` for small `n`.
- Selling whole is correctly free of fees.

---

### Task 7 — Offered-lengths only (O(n·m))

**Problem.** The price sheet offers only `m` distinct lengths (others are unsellable). Compute the max revenue iterating the inner loop over the `m` offered lengths only.

**Input / Output spec.**
- Read `n`, `m`, then `m` pairs `(length, price)`.
- Print the maximum revenue; if a length cannot be exactly filled by offered lengths, treat unfillable capacity as 0 revenue (carry forward).

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ m ≤ 100`.

**Hint.** `dp[len] = max over offered ℓ ≤ len of (price[ℓ] + dp[len-ℓ])`, with `dp[len]` defaulting to `dp[len-1]`-style carry or 0 if nothing fits. Complexity `O(n·m)`.

**Evaluation criteria.**
- Runs in `O(n·m)`; feasible for `n = 10^6`, `m = 100`.
- Matches the dense `O(n^2)` DP when all lengths `1..n` are offered.
- Handles capacities that no offered length divides.

---

### Task 8 — Count optimal cut plans

**Problem.** Count how many *distinct first-cut plans* achieve the maximum revenue `dp[n]` (counting plans by their sequence of choices), mod `10^9 + 7`.

**Input / Output spec.**
- Read `n`, then `price[1..n]`.
- Print the number of optimal plans mod `10^9 + 7`.

**Constraints.** `1 ≤ n ≤ 2000`.

**Hint.** Keep a second array `cnt[len]` = number of plans achieving `dp[len]`. When a cut `c` ties the current best, add `cnt[len-c]`; when it strictly beats, reset to `cnt[len-c]`. `cnt[0] = 1`.

**Reference oracle (Python).**
```python
def brute_count_optimal(price, n):
    from functools import lru_cache
    @lru_cache(None)
    def best(m):
        if m == 0:
            return 0
        return max(price[c] + best(m - c) for c in range(1, m + 1))
    @lru_cache(None)
    def cnt(m):
        if m == 0:
            return 1
        b = best(m)
        return sum(cnt(m - c) for c in range(1, m + 1) if price[c] + best(m - c) == b)
    return cnt(n)
```

**Evaluation criteria.**
- `cnt[0] = 1`.
- Correct tie/strict-beat handling (add on tie, reset on strict beat).
- Matches `brute_count_optimal` for small `n`.

---

### Task 9 — Kerf material loss

**Problem.** Each cut destroys `κ` units of material *and* costs a fee `cutCost`. Cutting a length-`c` first piece off a length-`len` rod leaves `len - c - κ`. Maximize profit.

**Input / Output spec.**
- Read `n`, `cutCost`, `κ`, then `price[1..n]`.
- Print the maximum profit.

**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ κ ≤ 5`, `0 ≤ cutCost ≤ 10^6`.

**Hint.** `dp[len] = max(price[len], max over c with c+κ < len of price[c] + dp[len-c-κ] - cutCost)`. The `- κ` is material loss in the index; `- cutCost` is money.

**Evaluation criteria.**
- `κ = 0` reduces to Task 6 (cost-per-cut).
- Selling whole (no cut) loses no material and pays no fee.
- Matches a brute-force recursion for small `n`.

---

### Task 10 — Equivalence check vs unbounded knapsack

**Problem.** Implement an unbounded-knapsack solver `unbounded_knapsack(weights, values, W)` and verify it produces the same answer as your rod-cutting solver when mapped (`weight[i] = i`, `value[i] = price[i]`, `W = n`).

**Input / Output spec.**
- Read `n`, then `price[1..n]`.
- Build items `(weight=i, value=price[i])`, run the knapsack solver with `W = n`, print its result and assert it equals your `dp[n]`.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hint.** Unbounded knapsack: `K[w] = max(K[w-1], max_i value[i] + K[w-weight[i]])` over items with `weight[i] ≤ w`. With length-1 offered, `K[n] == dp[n]`.

**Evaluation criteria.**
- The two solvers agree on all test sizes.
- Code comment explains the mapping (rod cutting = unbounded knapsack).
- `O(n^2)` (or `O(n·m)` if restricting to offered lengths).

---

## Advanced Tasks (5)

### Task 11 — Bounded pieces (limited supply)

**Problem.** Each length `ℓ` may be used at most `limit[ℓ]` times. Maximize revenue. `limit[ℓ] = 0` means length `ℓ` is not sellable.

**Input / Output spec.**
- Read `n`, then `n` triples-ish: for each length `ℓ` in `1..n`, read `price[ℓ]` and `limit[ℓ]`.
- Print the maximum revenue.

**Constraints.** `1 ≤ n ≤ 2000`, `0 ≤ limit[ℓ] ≤ 100`.

**Hint.** Bounded knapsack: process lengths one at a time; for each, allow `0..limit[ℓ]` copies, reading from the table *before* that length was considered (snapshot + write to a new array). `O(n·Σ limit)`.

**Reference oracle (Python).**
```python
def brute_bounded(price, limit, n):
    from functools import lru_cache
    @lru_cache(None)
    def f(rem, ell):
        if ell == 0:
            return 0 if rem == 0 else float("-inf")
        best = f(rem, ell - 1)  # 0 copies of ell
        for q in range(1, limit[ell] + 1):
            if q * ell <= rem:
                best = max(best, q * price[ell] + f(rem - q * ell, ell - 1))
        return best
    # allow leftover by also trying not to fill exactly:
    return max(f(r, n) for r in range(n + 1))
```

**Evaluation criteria.**
- `limit[ℓ] = ∞` (large) reduces to plain rod cutting.
- Never uses a length beyond its cap.
- Matches `brute_bounded` for small `n`.

---

### Task 12 — Bounded with binary splitting

**Problem.** Solve Task 11 efficiently when caps are large by binary-splitting each bounded length into `O(log limit[ℓ])` pseudo-items, then running 0/1 knapsack. Target `O(n·Σ log limit[ℓ])`.

**Input / Output spec.**
- Same I/O as Task 11.
- Print the maximum revenue.

**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ limit[ℓ] ≤ 10^6`.

**Hint.** Decompose `limit[ℓ]` into `1, 2, 4, …, 2^k, r` (with `r = limit - (2^{k+1}-1)`); each pseudo-item is a 0/1 item of weight `(copies)·ℓ`, value `(copies)·price[ℓ]`. Run 0/1 knapsack (iterate capacity *descending*).

**Evaluation criteria.**
- Matches Task 11's answer on shared inputs.
- Asymptotically `O(n·Σ log limit[ℓ])`; handles caps up to `10^6`.
- Correct 0/1 descending-capacity update (no reuse of a pseudo-item).

---

### Task 13 — Many rods, one price sheet (cached fill)

**Problem.** Given one price sheet and `Q` rod-length queries, answer each query's max revenue (and optionally its cut list) by filling `dp[]` once up to the maximum queried length, then looking up.

**Input / Output spec.**
- Read `n_max`, then `price[1..n_max]`, then `Q`, then `Q` query lengths.
- For each query, print the max revenue.

**Constraints.** `1 ≤ n_max ≤ 10^4`, `1 ≤ Q ≤ 10^5`.

**Hint.** Fill `dp[0..n_max]` once (`O(n_max^2)` or `O(n_max·m)`). Each query is an `O(1)` lookup; reconstruction is `O(len)` per query using the shared `choice[]`.

**Evaluation criteria.**
- The DP is filled exactly once, reused across all queries.
- Per-query value lookup is `O(1)`.
- Matches per-query independent DP on small inputs.

---

### Task 14 — Profit with a minimum sellable length

**Problem.** Pieces shorter than `Lmin` cannot be sold (they are scrap, value 0, and still consume length). Maximize revenue subject to every *sold* piece having length `≥ Lmin`; leftover scrap is allowed.

**Input / Output spec.**
- Read `n`, `Lmin`, then `price[1..n]` (treat `price[ℓ] = 0` for `ℓ < Lmin` as unsellable).
- Print the maximum revenue.

**Constraints.** `1 ≤ n ≤ 10^4`, `1 ≤ Lmin ≤ n`.

**Hint.** Allow the recurrence to *carry capacity forward* without selling: `dp[len] = max(dp[len-1], max over ℓ ≥ Lmin, ℓ ≤ len of price[ℓ] + dp[len-ℓ])`. The `dp[len-1]` term models leaving one unit as scrap.

**Evaluation criteria.**
- Never "sells" a piece shorter than `Lmin`.
- Correctly leaves scrap when no profitable long piece fits.
- Matches a brute-force recursion that respects `Lmin` for small `n`.

---

### Task 15 — Classify the right tool

**Problem.** Given a problem description with constraints `(n, reuse_semantics, objective)`, return one of: `ROD_CUTTING_UNBOUNDED`, `KNAPSACK_0_1`, `BOUNDED_KNAPSACK`, `COIN_CHANGE`, or `INFEASIBLE_GREEDY` (where a tempting greedy is wrong). Justify each.

**Constraints / cases to handle.**
- Reusable lengths, maximize revenue → `ROD_CUTTING_UNBOUNDED`.
- Each length usable once → `KNAPSACK_0_1`.
- Capped usage per length → `BOUNDED_KNAPSACK`.
- Minimize count / count ways to reach a total → `COIN_CHANGE`.
- "Greedily cut the highest price-density length" on an arbitrary table → `INFEASIBLE_GREEDY` (give a counterexample).

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The greedy trap is the instructive case: density-greedy fails because of the remainder.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INFEASIBLE_GREEDY` branch supplies a concrete counterexample where greedy underperforms the DP.
- Justification cites the right recurrence and complexity.

---

## Benchmark Task

### Task B — Dense O(n^2) vs offered-lengths O(n·m)

**Problem.** Empirically compare the dense `O(n^2)` fill against the offered-lengths `O(n·m)` fill on the same price sheet (with `m` distinct sellable lengths embedded in a length-`n` rod). Show the crossover where restricting to offered lengths wins.

Measure wall-clock time for `n ∈ {1000, 5000, 20000}` with `m ∈ {10, 50}` offered lengths (fixed seed).

**Starter — Python.**
```python
import random
import time


def gen_offers(n, m, seed):
    r = random.Random(seed)
    lengths = sorted(r.sample(range(1, n + 1), m))
    return {ell: r.randint(1, 1000) for ell in lengths}


def dense_fill(price_dense, n):
    # TODO: O(n^2) over all c in 1..len
    return 0


def offered_fill(offers, n):
    # TODO: O(n*m) over offered lengths only
    return 0


def bench(fn, *args, runs=3):
    best = float("inf")
    for _ in range(runs):
        start = time.perf_counter()
        fn(*args)
        best = min(best, time.perf_counter() - start)
    return best * 1000.0


def main():
    for n in (1000, 5000, 20000):
        for m in (10, 50):
            offers = gen_offers(n, m, 42)
            price_dense = [0] * (n + 1)
            for ell, p in offers.items():
                price_dense[ell] = p
            t_dense = bench(dense_fill, price_dense, n)
            t_off = bench(offered_fill, offers, n)
            print(f"n={n:<6d} m={m:<3d} dense_ms={t_dense:<10.2f} offered_ms={t_off:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same offers across Go, Java, and Python.
- The `O(n·m)` fill matches the dense fill's `dp[n]` (with unsellable lengths priced 0).
- Offered-lengths fill is dramatically faster as `n` grows; report the measured speedup.
- Report includes the best-of-3 timing and does not time graph/offer generation.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every value/profit task above ships with (or references) a slow recursive oracle. Run it on small `n`, diff, then trust the DP on large `n`.
- **Get `dp[0] = 0` right** and include the sell-whole option (`c = len`); these two are the most common beginner bugs.
- **Charge cut fees only on `c < len`** and subtract kerf `κ` from the *remainder index* — model both money and material loss.
- **Distinguish unbounded / bounded / 0-1** up front; the wrong loop structure silently gives wrong answers.
- **Verify reconstruction** with `Σ pieces == n` and `Σ price[pieces] == dp[n]`.
- **Use 64-bit revenue**; pin `MOD = 10^9 + 7` and any `INF`/sentinel as named constants distinct from legitimate values.
- **Restrict the inner loop to offered lengths** for large `n` (`O(n·m)`), and remember the real cutting-stock problem is NP-hard.

## Suggested Order and Difficulty Map

Work the tasks roughly in this order; each builds on the previous:

| Task | Builds on | Core skill exercised |
|------|-----------|----------------------|
| 1 | — | the recurrence + base case |
| 2 | 1 | reconstruction via `choice[]` |
| 3 | 1 | sell-whole detection (loop range) |
| 4 | 1 | top-down memoization + sentinel |
| 5 | — | the brute-force oracle (reused everywhere) |
| 6 | 1, 5 | cost-per-cut (`c < len` guard) |
| 7 | 1 | offered-lengths `O(n·m)` |
| 8 | 1, 5 | counting optimal plans (tie/reset) |
| 9 | 6 | kerf material loss |
| 10 | 1 | knapsack equivalence |
| 11 | 5 | bounded knapsack |
| 12 | 11 | binary splitting |
| 13 | 1, 2 | cached fill for many queries |
| 14 | 7 | minimum sellable length / carry-forward |
| 15 | all | choosing the right tool |
| B | 1, 7 | empirical crossover benchmark |

The single most important habit across all tasks: write Task 5 (the oracle) first and call it from every other task's tests. A DP that disagrees with the oracle on a small input is wrong, full stop — fix it before scaling up.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
