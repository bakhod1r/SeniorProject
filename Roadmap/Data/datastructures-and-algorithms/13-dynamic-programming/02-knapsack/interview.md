# Knapsack DP — Interview Preparation

Knapsack is a favourite interview topic because it rewards a single crisp insight — *"for each item, take it or skip it, keep the better"* — and then tests whether you can (a) write the `O(n·W)` table cleanly, (b) collapse it to a 1D array with the **correct sweep direction**, (c) recognize the same skeleton behind subset-sum, partition, unbounded, and bounded variants, (d) explain *why greedy works for fractional but not 0/1*, and (e) reason about the pseudo-polynomial blow-up and when to reach for meet-in-the-middle or value-indexed DP. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Best value, 0/1 | take-or-skip DP | `O(n·W)` |
| Save memory (value only) | 1D array, **descending** sweep | `O(W)` space |
| Which items? | 2D table + back-trace | `O(n·W)` / `O(n)` trace |
| Unlimited copies | unbounded, **ascending** sweep | `O(n·W)` |
| Up to `c[i]` copies | bounded, binary splitting | `O(n·W·log c)` |
| Exact-sum reachable? | subset-sum (Boolean DP) | `O(n·S)` |
| Equal split? | partition → subset-sum `T/2` | `O(n·T)` |
| Fractional allowed | greedy by `v/w` ratio | `O(n log n)` |
| Huge `W`, few items | meet-in-the-middle | `O(2^{n/2}·n)` |
| Huge `W`, small values | value-indexed DP | `O(n·V_total)` |
| All large, approx OK | FPTAS | `O(n²/ε)` |

Core algorithm (1D, 0/1):

```text
dp = [0]*(W+1)
for each item (w_i, v_i):
    for c = W down to w_i:        # DESCENDING for 0/1
        dp[c] = max(dp[c], v_i + dp[c - w_i])
return dp[W]                       # O(n*W)
```

Key facts:
- **Take or skip:** `dp[i][w] = max(dp[i-1][w], v_i + dp[i-1][w-w_i])`.
- **Direction:** descending = 0/1 (each item once); ascending = unbounded (reusable).
- `O(n·W)` is **pseudo-polynomial** — exponential in the bits of `W`; knapsack is NP-hard.
- **Greedy is optimal for fractional, wrong for 0/1.**

---

## Junior Questions (12 Q&A)

### J1. What is the 0/1 knapsack problem?
You have a capacity `W` and `n` items, each with a weight and a value. Choose a subset whose total weight is `≤ W` to maximize total value, where each item is taken whole (1) or not at all (0). No fractions, no duplicates.

### J2. What is the recurrence?
`dp[i][w] = max(dp[i-1][w], v_i + dp[i-1][w - w_i])`. The first term skips item `i`; the second takes it (only if `w_i ≤ w`). The answer is `dp[n][W]`.

### J3. Why does take-or-skip cover all cases?
Any optimal packing either includes item `i` or it does not. If not, it equals the best packing of the first `i-1` items. If so, removing item `i` leaves the best packing of the first `i-1` items in capacity `w - w_i`. The `max` of both branches considers every possibility.

### J4. What are the base cases?
`dp[0][w] = 0` (no items → value 0) and `dp[i][0] = 0` (no capacity → pack nothing). The table is `(n+1) × (W+1)`.

### J5. What is the time and space complexity?
`O(n·W)` time and `O(n·W)` space for the 2D table, reducible to `O(W)` space with a 1D rolling array. The `n·W` cell updates dominate.

### J6. How do you reduce the space to `O(W)`?
Keep a single array `dp[w]` and sweep capacity **from high to low** for each item, so `dp[w - w_i]` still holds the previous item's value. This is the 1D 0/1 knapsack.

### J7. Why must the 1D 0/1 sweep go descending?
Descending guarantees `dp[w - w_i]` has not yet been updated this pass, so it represents "the rest of the bag *without* item `i`." Ascending would let item `i` be reused, turning 0/1 into unbounded.

### J8. How do you recover which items were chosen?
Trace back from `dp[n][W]`: for `i = n` down to `1`, if `dp[i][w] != dp[i-1][w]` the item was taken, so record it and subtract its weight; otherwise it was skipped.

### J9. What is unbounded knapsack and how does its code differ?
Unbounded allows unlimited copies of each item. The only code change from 0/1 is the sweep direction: **ascending** instead of descending, so an item can be reused within the same pass.

### J10. What is subset-sum and how is it knapsack?
Subset-sum asks whether a subset sums to exactly `S`. It is 0/1 knapsack with `value = weight` and a Boolean table: `dp[s]` is true iff some subset hits sum `s`.

### J11. Can knapsack handle an item heavier than the capacity?
Yes — it simply can never be taken. The guard `if w_i <= w` (or looping only down to `w_i`) skips it. You can also drop such items up front.

### J12 (analysis). Why is brute force `O(2^n)` and DP `O(n·W)`?
Brute force tries every subset — `2^n` of them. DP instead reuses overlapping subproblems "best value for first `i` items, capacity `w`," of which there are only `n·W`, each computed in `O(1)`.

---

## Middle Questions (12 Q&A)

### M1. Prove the 1D descending sweep is correct for 0/1.
Before processing item `i`, `dp[w] = f(i-1, w)` for all `w`. Sweeping descending, when we update `dp[w]`, the operand `dp[w - w_i]` (index `< w`) has not been written yet, so it is still `f(i-1, w-w_i)`. Thus `dp[w] = max(f(i-1,w), v_i + f(i-1,w-w_i)) = f(i,w)`. Each item is used at most once.

### M2. When is layered DP (2D) better than the 1D array?
When you need to **reconstruct** the chosen items. The 1D array overwrites its history, so the back-trace needs the full 2D table (or a decision-bit array). For value-only queries, prefer 1D.

### M3. What is bounded knapsack and how do you solve it efficiently?
Each item is available in `c_i` copies. Naively expanding all copies is `O(n·W·max_c)`. **Binary splitting** represents `c_i` as chunks `1, 2, 4, …, remainder`, each a 0/1 pseudo-item, giving `O(n·W·log max_c)` — any count `0..c_i` is reachable by a subset of chunks.

### M4. How is partition a knapsack problem?
Partition asks whether items split into two equal-sum groups. If the total `T` is odd it is impossible; otherwise it is subset-sum to `T/2`. Same descending 0/1 Boolean DP.

### M5. Why is greedy optimal for fractional but wrong for 0/1?
Fractional lets you split items, so the exchange argument holds: always prefer higher value/weight density, topping off with a fraction. For 0/1 you cannot split, so a high-density heavy item may not fit, forcing a worse global choice. Counterexample: weights `[10,20,30]`, values `[60,100,120]`, `W=50` — greedy gives 160, optimal is 220.

### M6. How do you count the number of subsets summing to `S`?
Replace the Boolean `or` with integer `+=` and start `dp[0] = 1`: `dp[s] += dp[s - x]` swept descending. `dp[S]` is the count (take it mod a prime if it can overflow).

### M7. What changes between 0/1 and unbounded in one line?
The capacity sweep direction. 0/1: `for w = W down to w_i` (descending). Unbounded: `for w = w_i up to W` (ascending). Descending reads the old row (item once); ascending reads the new row (item reusable).

### M8. How do you avoid overflow in value sums?
Use 64-bit accumulators for the values. For subset *counts*, the number of subsets can be astronomical — take the count modulo a prime like `10^9 + 7`.

### M9. What is the minimum subset-sum difference, and how does knapsack solve it?
It asks for the partition minimizing `|sum_A - sum_B|`. Run subset-sum up to `T/2`, find the largest reachable `s ≤ T/2`; the answer is `T - 2s`. Same DP, different read-out.

### M10. How does the choice of indexing dimension matter?
Weight-indexed DP is `O(n·W)`; value-indexed DP ("min weight to reach value `v`") is `O(n·V_total)`. Pick whichever dimension is smaller — they are transposes of the same DP. This handles huge `W` with small values.

### M11. Why can't you reconstruct from the 1D array directly?
Each item's update overwrites `dp[w]` in place, destroying the per-item history the back-trace needs. You need the 2D table, a decision-bit array, or Hirschberg's linear-space method.

### M12 (analysis). Why is `O(n·W)` called pseudo-polynomial?
`W` is a number written in `log W` bits, so `O(n·W) = O(n·2^{log W})` is exponential in the *bit-length* of the input. It is polynomial in the numeric value of `W`, not in the input size — the definition of pseudo-polynomial.

---

## Senior Questions (10 Q&A)

### S1. How would you solve knapsack with `W = 10^{12}` and `n = 40`?
The table is infeasible (`10^{12}` columns). Use **meet-in-the-middle**: split items in half, enumerate all `2^{20}` subsets of each, sort one half by weight with prefix-max value, and for each subset of the other half binary-search the best complement. `O(2^{n/2}·n) ≈ 4·10^7`, independent of `W`.

### S2. How would you solve knapsack with huge `W` but each value `≤ 100`?
**Value-indexed DP**: tabulate `cost[v]` = minimum weight to achieve value `v`, in `O(n·V_total)`. The capacity appears only in the final scan `cost[v] ≤ W`, so a huge `W` costs nothing.

### S3. Explain the FPTAS for 0/1 knapsack.
Scale values by `K = ε·v_max / n`, round down to `v'_i = ⌊v_i/K⌋`, run exact value-indexed DP on the scaled values, output the true value of that selection. The rounding loses at most `ε·OPT`, giving `(1-ε)·OPT` in `O(n²/ε)`. It works *because* the pseudo-polynomial value DP can be made polynomial by shrinking `V_total`.

### S4. Why does knapsack have an FPTAS but bin-packing does not?
Knapsack is *weakly* NP-hard — it has a pseudo-polynomial DP, which scaling turns polynomial. Bin-packing (and 3-Partition) are *strongly* NP-hard: NP-hard even with polynomially bounded numbers, so no pseudo-polynomial DP exists to scale, hence no FPTAS unless P = NP.

### S5. How do you reconstruct chosen items when `n·W` integers won't fit in memory?
Use a decision-*bit* array (`n·W` bits, 8× smaller than ints), or Hirschberg's divide-and-conquer: split the item set, find the optimal capacity split, recurse — `O(n·W)` time and `O(W)` space.

### S6. What is the most efficient bounded-knapsack algorithm?
The monotonic-deque method: for each item, process capacities in residue classes mod `w_i`, maintaining a sliding-window maximum of size `c_i` with a deque in amortized `O(1)`. This gives `O(n·W)`, removing the `log max_c` factor of binary splitting. Binary splitting is the pragmatic default; the deque is the tight bound.

### S7. How do you verify correctness when the instance is too large to brute-force?
Keep a brute-force subset oracle for `n ≤ 20` and compare. Add property tests: `dp` non-decreasing in `W`, 1D result == 2D result, value-indexed == weight-indexed, and the fractional-greedy relaxation as a valid upper bound (`fractional ≥ 0/1 optimum`) you can assert even in production.

### S8. What are the main performance levers in the inner loop?
1D flat array (cache-friendly), tight loop bound (`w ≥ w_i`), dropping oversized items, and — for subset-sum *feasibility* — a bitset with `dp |= dp << w_i`, processing 64 capacities per instruction (~64× speedup).

### S9. Your knapsack job is OOMing in production. How do you investigate?
A 2D `int` table is `4·n·W` bytes — check whether `W` ballooned. Switch to the 1D array if you do not need reconstruction; use decision bits or Hirschberg if you do. Confirm the dimension router chose the right algorithm (table vs MITM vs value-indexed) for the instance's numeric shape.

### S10 (analysis). Why is the `n·W` product essentially unavoidable?
Under the Strong Exponential Time Hypothesis, recent fine-grained results show subset-sum (hence knapsack) cannot beat the `O(n·t)` product by a polynomial factor across all regimes. The pseudo-polynomial bound is conditionally tight, not a weakness of a naive algorithm.

---

## Professional Questions (8 Q&A)

### P1. Design a budget-allocation service: pick projects (cost, ROI) maximizing ROI within a budget.
This is 0/1 knapsack with weight = cost, value = ROI, capacity = budget. If the budget is in dollars (huge `W`) but ROIs are small integers, use value-indexed DP. If costs are coarse (few distinct buckets), use the table. Cache the DP per budget tier; log the fractional-relaxation upper bound for monitoring.

### P2. How do you handle real-valued (non-integer) weights?
The table is indexed by integer capacity, so scale weights to integers by a common denominator (e.g. cents instead of dollars). If scaling explodes `W`, switch to a comparison-based search (meet-in-the-middle) or an LP/branch-and-bound formulation that does not need integer indexing.

### P3. The instance has `n = 10^5`, `W = 10^9`, values up to `10^9`. What now?
All dimensions are large — no exact polynomial method exists. Use the **FPTAS** for a `(1-ε)` guarantee in `O(n²/ε)`, or exploit special structure (e.g. few distinct weights, divisible weights). Confirm with the LP relaxation as an upper bound on how good any answer can be.

### P4. How do you debug "the knapsack value is wrong" in production?
Run the brute-force oracle on the same small inputs and diff. Check the three usual suspects: wrong sweep direction (ascending for 0/1 → over-counts), off-by-one in table dimensions (`W+1` columns), and overflow in value sums. Assert `dp` is non-decreasing in `W` and that the value never exceeds the fractional relaxation.

### P5. When is greedy the right production choice?
Only for the **fractional** problem (divisible resources: pouring liquids, allocating continuous budget), where greedy by density is exact and `O(n log n)`. For indivisible items, greedy is wrong; it serves only as the LP upper bound for branch-and-bound pruning. State the divisibility assumption explicitly.

### P6. How do you parallelize a batch of knapsack queries on the same items?
If queries share the item set but differ in `W`, run one DP up to `max(W)` and answer each query by reading `dp[W_q]` (the 1D array's prefix is monotone). For the FPTAS across many `ε`, each run is independent. The inner DP itself is sequential per item, but queries parallelize trivially.

### P7. How do automata/string-counting problems relate to bounded knapsack?
"Make exact change with limited coins" is bounded knapsack (coins = items, counts = available quantity, target = amount). "Number of ways to reach a sum" is the counting subset-sum DP. These are all the same lattice DP with the value semantics swapped (max / Boolean / count).

### P8 (analysis). Why does indexing by the smaller of `W` and `V` matter, and what is the limit?
Weight-indexed is `O(n·W)`, value-indexed is `O(n·V)`; both are pseudo-polynomial in their respective parameter. Choosing `min(W, V)` minimizes work. The limit is when *both* are large — then no pseudo-polynomial route works and you must approximate (FPTAS) or use meet-in-the-middle if `n` is small.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you recognized a problem was secretly knapsack.
Look for a concrete story: a resource-allocation or selection task framed in business terms, the realization that it reduces to "maximize value within a capacity," choosing weight- vs value-indexing based on which number was small, and verifying against a brute-force oracle. Strong answers mention the pseudo-polynomial check before committing to the table.

### B2. A teammate used greedy for a 0/1 selection and shipped a suboptimal result. How do you handle it?
Explain the fractional-vs-0/1 distinction with the small counterexample (`weights [10,20,30]`, `values [60,100,120]`, `W=50`: greedy 160 vs optimal 220). Note greedy is only valid when items are divisible. Offer the DP as the exact fix and the fractional value as a useful upper bound. Frame it as a teaching moment.

### B3. Design a feature that picks the best set of features to ship within an engineering-capacity budget.
This is 0/1 knapsack: features = items, effort = weight, expected impact = value, sprint capacity = `W`. Discuss integer-effort estimates, the value-indexed flip if impact scores are small, reconstruction to produce the actual feature list, and the LP relaxation as a "best possible" sanity bound for stakeholders.

### B4. How would you explain knapsack DP to a junior engineer?
Start from the backpack analogy: a weight-limited bag, items with weight and value. Walk the take-or-skip decision for each item, building a table where each cell asks "is it better to skip this item or take it and use the rest of the bag for the others?" Then show the 1D space trick and warn loudly about the descending sweep. Lead with the two gotchas: pseudo-polynomial blow-up and greedy-is-wrong-for-0/1.

### B5. Your knapsack-based recommender is too slow at scale. How do you investigate?
Profile the `n·W` product — is `W` huge? If values are small, flip to value-indexed DP. If `n` is small and `W` huge, switch to meet-in-the-middle. If all are large, move to the FPTAS with a tunable `ε`. Confirm you use the 1D array and a tight inner loop; verify reconstruction is not forcing a full 2D table when only the value is needed.

---

## Coding Challenges

### Challenge 1: 0/1 Knapsack — Best Value with Reconstruction

**Problem.** Given `n` items with integer weights and values and capacity `W`, return the maximum value and the list of chosen item indices.

**Example.**
```text
weight = [2,3,4], value = [3,4,5], W = 5  ->  value 7, items {0,1}
```

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ W ≤ 10^5`, integer weights/values.

**Optimal.** 2D table DP, `O(n·W)` time; back-trace for reconstruction.

**Go.**
```go
package main

import "fmt"

func knapsack01(weight, value []int, W int) (int, []int) {
	n := len(weight)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, W+1)
	}
	for i := 1; i <= n; i++ {
		wi, vi := weight[i-1], value[i-1]
		for w := 0; w <= W; w++ {
			dp[i][w] = dp[i-1][w]
			if wi <= w {
				if t := vi + dp[i-1][w-wi]; t > dp[i][w] {
					dp[i][w] = t
				}
			}
		}
	}
	chosen := []int{}
	w := W
	for i := n; i >= 1; i-- {
		if dp[i][w] != dp[i-1][w] {
			chosen = append(chosen, i-1)
			w -= weight[i-1]
		}
	}
	return dp[n][W], chosen
}

func main() {
	v, items := knapsack01([]int{2, 3, 4}, []int{3, 4, 5}, 5)
	fmt.Println(v, items) // 7 [1 0]
}
```

**Java.**
```java
import java.util.*;

public class Knapsack01 {
    static int solve(int[] weight, int[] value, int W, List<Integer> chosen) {
        int n = weight.length;
        int[][] dp = new int[n + 1][W + 1];
        for (int i = 1; i <= n; i++) {
            int wi = weight[i - 1], vi = value[i - 1];
            for (int w = 0; w <= W; w++) {
                dp[i][w] = dp[i - 1][w];
                if (wi <= w) dp[i][w] = Math.max(dp[i][w], vi + dp[i - 1][w - wi]);
            }
        }
        int w = W;
        for (int i = n; i >= 1; i--) {
            if (dp[i][w] != dp[i - 1][w]) { chosen.add(i - 1); w -= weight[i - 1]; }
        }
        return dp[n][W];
    }

    public static void main(String[] args) {
        List<Integer> chosen = new ArrayList<>();
        int v = solve(new int[]{2, 3, 4}, new int[]{3, 4, 5}, 5, chosen);
        System.out.println(v + " " + chosen); // 7 [1, 0]
    }
}
```

**Python.**
```python
def knapsack01(weight, value, W):
    n = len(weight)
    dp = [[0] * (W + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        wi, vi = weight[i - 1], value[i - 1]
        for w in range(W + 1):
            dp[i][w] = dp[i - 1][w]
            if wi <= w:
                dp[i][w] = max(dp[i][w], vi + dp[i - 1][w - wi])
    chosen, w = [], W
    for i in range(n, 0, -1):
        if dp[i][w] != dp[i - 1][w]:
            chosen.append(i - 1)
            w -= weight[i - 1]
    return dp[n][W], chosen


if __name__ == "__main__":
    print(knapsack01([2, 3, 4], [3, 4, 5], 5))  # (7, [1, 0])
```

---

### Challenge 2: Partition Equal Subset Sum

**Problem.** Given positive integers, decide whether they can be split into two subsets of equal sum.

**Example.**
```text
[1,5,11,5] -> true   ({1,5,5} and {11})
[1,2,3,5]  -> false
```

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ nums[i] ≤ 100`.

**Optimal.** Subset-sum to `total/2`, `O(n·total)`; 1D Boolean DP, descending.

**Go.**
```go
package main

import "fmt"

func canPartition(nums []int) bool {
	total := 0
	for _, x := range nums {
		total += x
	}
	if total%2 != 0 {
		return false
	}
	S := total / 2
	dp := make([]bool, S+1)
	dp[0] = true
	for _, x := range nums {
		for s := S; s >= x; s-- { // descending, 0/1
			if dp[s-x] {
				dp[s] = true
			}
		}
	}
	return dp[S]
}

func main() {
	fmt.Println(canPartition([]int{1, 5, 11, 5})) // true
	fmt.Println(canPartition([]int{1, 2, 3, 5}))  // false
}
```

**Java.**
```java
public class Partition {
    static boolean canPartition(int[] nums) {
        int total = 0;
        for (int x : nums) total += x;
        if (total % 2 != 0) return false;
        int S = total / 2;
        boolean[] dp = new boolean[S + 1];
        dp[0] = true;
        for (int x : nums)
            for (int s = S; s >= x; s--)      // descending, 0/1
                if (dp[s - x]) dp[s] = true;
        return dp[S];
    }

    public static void main(String[] args) {
        System.out.println(canPartition(new int[]{1, 5, 11, 5})); // true
        System.out.println(canPartition(new int[]{1, 2, 3, 5}));  // false
    }
}
```

**Python.**
```python
def can_partition(nums):
    total = sum(nums)
    if total % 2:
        return False
    S = total // 2
    dp = [False] * (S + 1)
    dp[0] = True
    for x in nums:
        for s in range(S, x - 1, -1):     # descending, 0/1
            if dp[s - x]:
                dp[s] = True
    return dp[S]


if __name__ == "__main__":
    print(can_partition([1, 5, 11, 5]))  # True
    print(can_partition([1, 2, 3, 5]))   # False
```

---

### Challenge 3: Coin Change — Minimum Coins (Unbounded)

**Problem.** Given coin denominations (unlimited supply) and an amount, return the minimum number of coins to make the amount, or `-1` if impossible.

**Example.**
```text
coins = [1,2,5], amount = 11 -> 3   (5 + 5 + 1)
coins = [2], amount = 3      -> -1
```

**Constraints.** `1 ≤ coins.length ≤ 100`, `1 ≤ amount ≤ 10^4`.

**Optimal.** Unbounded knapsack flavor: minimize count, **ascending** sweep, `O(n·amount)`.

**Go.**
```go
package main

import "fmt"

func coinChange(coins []int, amount int) int {
	const INF = 1 << 30
	dp := make([]int, amount+1)
	for i := 1; i <= amount; i++ {
		dp[i] = INF
	}
	for _, c := range coins {
		for a := c; a <= amount; a++ { // ASCENDING for unbounded
			if dp[a-c]+1 < dp[a] {
				dp[a] = dp[a-c] + 1
			}
		}
	}
	if dp[amount] >= INF {
		return -1
	}
	return dp[amount]
}

func main() {
	fmt.Println(coinChange([]int{1, 2, 5}, 11)) // 3
	fmt.Println(coinChange([]int{2}, 3))        // -1
}
```

**Java.**
```java
import java.util.*;

public class CoinChange {
    static int coinChange(int[] coins, int amount) {
        int INF = 1 << 30;
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int c : coins)
            for (int a = c; a <= amount; a++)   // ASCENDING for unbounded
                if (dp[a - c] + 1 < dp[a]) dp[a] = dp[a - c] + 1;
        return dp[amount] >= INF ? -1 : dp[amount];
    }

    public static void main(String[] args) {
        System.out.println(coinChange(new int[]{1, 2, 5}, 11)); // 3
        System.out.println(coinChange(new int[]{2}, 3));        // -1
    }
}
```

**Python.**
```python
def coin_change(coins, amount):
    INF = float("inf")
    dp = [0] + [INF] * amount
    for c in coins:
        for a in range(c, amount + 1):    # ASCENDING for unbounded
            if dp[a - c] + 1 < dp[a]:
                dp[a] = dp[a - c] + 1
    return -1 if dp[amount] == INF else dp[amount]


if __name__ == "__main__":
    print(coin_change([1, 2, 5], 11))  # 3
    print(coin_change([2], 3))         # -1
```

---

### Challenge 4: Knapsack with Huge Capacity (Meet-in-the-Middle)

**Problem.** Solve 0/1 knapsack when `n` is small (≤ 40) but `W` can be up to `10^{18}`. Return the best value.

**Approach.** Split items into two halves, enumerate all `2^{n/2}` subsets of each, sort one half by weight with prefix-max value, and for each subset of the other half binary-search the best complement. `O(2^{n/2}·n)`.

**Python.**
```python
from bisect import bisect_right


def knapsack_mitm(weight, value, W):
    n = len(weight)
    half = n // 2

    def gen(ws, vs):
        m = len(ws)
        out = []
        for mask in range(1 << m):
            tw = tv = 0
            for i in range(m):
                if mask & (1 << i):
                    tw += ws[i]
                    tv += vs[i]
            out.append((tw, tv))
        return out

    L = gen(weight[:half], value[:half])
    R = gen(weight[half:], value[half:])
    R.sort()
    # prefix-max of value over sorted-by-weight R
    pref = []
    best = -1
    rw = []
    for w, v in R:
        best = max(best, v)
        rw.append(w)
        pref.append(best)
    ans = 0
    for wl, vl in L:
        budget = W - wl
        if budget < 0:
            continue
        idx = bisect_right(rw, budget) - 1
        if idx >= 0:
            ans = max(ans, vl + pref[idx])
    return ans


if __name__ == "__main__":
    print(knapsack_mitm([10, 20, 30, 40], [60, 100, 120, 240],
                        10 ** 18))  # 520 (all fit)
```

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func knapsackMITM(weight, value []int64, W int64) int64 {
	n := len(weight)
	half := n / 2
	gen := func(ws, vs []int64) [][2]int64 {
		m := len(ws)
		out := make([][2]int64, 0, 1<<m)
		for mask := 0; mask < (1 << m); mask++ {
			var tw, tv int64
			for i := 0; i < m; i++ {
				if mask&(1<<i) != 0 {
					tw += ws[i]
					tv += vs[i]
				}
			}
			out = append(out, [2]int64{tw, tv})
		}
		return out
	}
	L := gen(weight[:half], value[:half])
	R := gen(weight[half:], value[half:])
	sort.Slice(R, func(a, b int) bool { return R[a][0] < R[b][0] })
	for i := 1; i < len(R); i++ {
		if R[i][1] < R[i-1][1] {
			R[i][1] = R[i-1][1]
		}
	}
	var ans int64
	for _, l := range L {
		budget := W - l[0]
		if budget < 0 {
			continue
		}
		lo, hi, idx := 0, len(R)-1, -1
		for lo <= hi {
			mid := (lo + hi) / 2
			if R[mid][0] <= budget {
				idx = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		if idx >= 0 {
			if c := l[1] + R[idx][1]; c > ans {
				ans = c
			}
		}
	}
	return ans
}

func main() {
	fmt.Println(knapsackMITM([]int64{10, 20, 30, 40},
		[]int64{60, 100, 120, 240}, 1_000_000_000_000_000_000)) // 520
}
```

**Java.**
```java
import java.util.*;

public class KnapsackMITM {
    static long[][] gen(long[] ws, long[] vs) {
        int m = ws.length;
        long[][] out = new long[1 << m][2];
        for (int mask = 0; mask < (1 << m); mask++) {
            long tw = 0, tv = 0;
            for (int i = 0; i < m; i++)
                if ((mask & (1 << i)) != 0) { tw += ws[i]; tv += vs[i]; }
            out[mask][0] = tw; out[mask][1] = tv;
        }
        return out;
    }

    static long solve(long[] weight, long[] value, long W) {
        int n = weight.length, half = n / 2;
        long[][] L = gen(Arrays.copyOfRange(weight, 0, half),
                         Arrays.copyOfRange(value, 0, half));
        long[][] R = gen(Arrays.copyOfRange(weight, half, n),
                         Arrays.copyOfRange(value, half, n));
        Arrays.sort(R, (a, b) -> Long.compare(a[0], b[0]));
        for (int i = 1; i < R.length; i++)
            if (R[i][1] < R[i - 1][1]) R[i][1] = R[i - 1][1];
        long ans = 0;
        for (long[] l : L) {
            long budget = W - l[0];
            if (budget < 0) continue;
            int lo = 0, hi = R.length - 1, idx = -1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (R[mid][0] <= budget) { idx = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            if (idx >= 0) ans = Math.max(ans, l[1] + R[idx][1]);
        }
        return ans;
    }

    public static void main(String[] args) {
        System.out.println(solve(new long[]{10, 20, 30, 40},
            new long[]{60, 100, 120, 240}, 1_000_000_000_000_000_000L)); // 520
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"For each item, take it or skip it, keep the better — `dp[i][w] = max(dp[i-1][w], v_i + dp[i-1][w-w_i])`, `O(n·W)`."*
- Immediately flag the two gotchas: **descending sweep for 0/1** (ascending = unbounded) and **`O(n·W)` is pseudo-polynomial**.
- If asked about huge `W`, reach for **meet-in-the-middle** (small `n`) or **value-indexed DP** (small values).
- If asked about approximation, mention the **FPTAS** (`O(n²/ε)`) and that it works because knapsack is *weakly* NP-hard.
- Keep the **greedy counterexample** (`[10,20,30]`, `[60,100,120]`, `W=50`) handy to explain why greedy fails for 0/1 but is exact for fractional.
- Always offer to verify against a brute-force subset oracle on small inputs.
