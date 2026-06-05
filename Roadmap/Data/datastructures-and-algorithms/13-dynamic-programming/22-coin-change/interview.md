# Coin Change (Unbounded Counting DP) — Interview Preparation

Coin Change is a favourite interview topic because it rewards a few crisp insights — *"`dp[v] = min(dp[v-c]+1)` for fewest coins; `dp[v] += dp[v-c]` for ways"* — and then tests whether you can (a) get the **loop order** right (coin-outer for combinations, amount-outer for permutations), (b) handle the **unreachable / `∞`** case cleanly, (c) explain **why greedy fails** on arbitrary coin systems with a counterexample, and (d) connect it to **unbounded knapsack**. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Recurrence / Tool | Complexity |
|----------|-------------------|------------|
| Fewest coins to make `V` | `dp[v]=min(dp[v],dp[v-c]+1)`, base `dp[0]=0` | `O(V·n)` |
| #combinations to make `V` | `dp[v]+=dp[v-c]`, **coin-outer**, base `dp[0]=1` | `O(V·n)` |
| #permutations to make `V` | `dp[v]+=dp[v-c]`, **amount-outer** | `O(V·n)` |
| Bounded supply (≤ `k_i` each) | binary-split into 0/1 items, backward sweep | `O(V·Σ log k_i)` |
| Min coins on canonical system | greedy (largest first) | `O(n log n)` |
| Huge `V`, tiny fixed coin set | recurrence + matrix exponentiation | `O(d³ log V)` |
| **Min coins on arbitrary system via greedy** | **WRONG — may be suboptimal** | — |

Loop-order rule (the thing they are testing):

```text
coin OUTER, amount INNER  =>  COMBINATIONS  (multiset; 1+2 == 2+1)
amount OUTER, coin INNER  =>  PERMUTATIONS  (sequence; 1+2 != 2+1)
```

Core algorithms:

```text
MIN:    dp[0]=0; dp[1..V]=INF
        for c in coins: for v in c..V: dp[v]=min(dp[v],dp[v-c]+1)
        answer = dp[V] (INF => -1)

COUNT:  dp[0]=1; dp[1..V]=0
        for c in coins: for v in c..V: dp[v]+=dp[v-c]   # coin-outer
        answer = dp[V]
```

Key facts:
- Base cases: min `dp[0]=0`; count `dp[0]=1` (one way to make zero — use nothing).
- `INF = amount + 1` (never `MAX_INT`, or `+1` overflows).
- Unreachable amount ⇒ min returns `-1`; count returns `0`.
- Counts overflow fast ⇒ take `mod p` if asked.
- Coin Change = **unbounded knapsack**.

---

## Junior Questions (12 Q&A)

### J1. What are the two classic coin-change problems?
(1) **Minimum coins** to make amount `V` exactly, and (2) the **number of ways** to make `V`. Both fill a `dp[0..V]` array; min uses `dp[v]=min(dp[v-c]+1)` and count uses `dp[v]+=dp[v-c]`.

### J2. What is the base case for each?
Min: `dp[0] = 0` (zero coins make zero), all other `dp[v] = ∞`. Count: `dp[0] = 1` (exactly one way to make zero — the empty selection), all other `dp[v] = 0`.

### J3. What does "unbounded" mean here?
Each denomination may be used **any number of times**. That is the default coin-change assumption and is why the inner sweep goes forward (allowing reuse).

### J4. Why might the min-coins answer be "impossible"?
If no combination of coins sums to `V` (e.g. coins `{2}`, amount `3`), `dp[V]` stays `∞`. You detect this and return `-1`.

### J5. What sentinel do you use for "infinity" and why not MAX_INT?
Use `INF = amount + 1` (or `1<<30`). `MAX_INT` is dangerous because `dp[v-c] + 1` would overflow to a negative number and corrupt the `min`.

### J6. What is the difference between combinations and permutations of coins?
A **combination** is a multiset — `1+2` and `2+1` are the *same*. A **permutation** is an ordered sequence — `1+2` and `2+1` are *different*. Classic coin change wants combinations.

### J7. Which loop order counts combinations?
**Coin-outer, amount-inner.** Each coin is fully processed before the next, so every multiset is built in one canonical order and counted once.

### J8. Which loop order counts permutations?
**Amount-outer, coin-inner.** Every amount reconsiders all coins as the last one, so ordered sequences are counted separately.

### J9. What is the time and space complexity?
`O(V·n)` time and `O(V)` space, where `V` is the amount and `n` the number of coins.

### J10. What is `dp[0]` for the counting variant and why is it `1`?
`dp[0] = 1` because there is exactly one way to make amount zero: select no coins (the empty multiset). Setting it to `0` would make every count zero.

### J11. Does greedy (largest coin first) always work?
No. It works for canonical systems (like real currency `{1,5,10,25}`) but fails for arbitrary sets. For `{1,3,4}` making `6`, greedy gives `4+1+1` (3 coins) but optimal is `3+3` (2 coins).

### J12 (analysis). Why is the naive recursion exponential and the DP not?
The recursion re-solves the same sub-amounts repeatedly (overlapping subproblems). The DP computes each `dp[v]` once and reuses it, collapsing exponential work into `O(V·n)`.

---

## Middle Questions (12 Q&A)

### M1. Prove that coin-outer counts combinations.
Let `f_i(v)` = ways to make `v` using coins `1..i`. Then `f_i(v) = f_{i-1}(v) + f_i(v-c_i)`: either don't use coin `i`, or use one more `c_i`. The coin-outer forward sweep computes exactly this layer by layer, so each multiset is counted once in non-decreasing coin order.

### M2. Why does amount-outer count permutations instead?
Amount-outer computes `g(v) = Σ_c g(v-c)`, classifying sequences by their **last** coin. Removing the last coin gives a bijection with sequences summing to `v-c`. Since the last coin can be any denomination at every amount, ordered sequences `1+2` and `2+1` are counted separately.

### M3. How do you reconstruct which coins achieve the minimum?
Store `parent[v]` = the coin that last improved `dp[v]`. After filling the table, walk back from `V`: repeatedly take `c = parent[v]`, record it, set `v -= c`, until `v = 0`.

### M4. What changes for bounded (limited-supply) coins?
Each coin usable at most `k_i` times. Binary-split it into `O(log k_i)` 0/1 items (chunks of size 1,2,4,…), then run the **0/1** DP with a **backward** sweep so each item is used at most once.

### M5. Why forward sweep for unbounded but backward for 0/1?
Forward: when you read `dp[v-c]` it has already been updated by coin `c` in this pass, modeling reuse. Backward: `dp[v-c]` still reflects the pre-coin state, so the coin is used at most once.

### M6. What is the smallest counterexample where greedy fails?
`{1,3,4}` at `V=6`: greedy `4+1+1` (3) vs optimal `3+3` (2). Memorize this — it is the canonical interview counterexample.

### M7. How is coin change related to knapsack?
It is **unbounded knapsack**: each coin is an item with weight `c_i`, usable unlimited times, target capacity exactly `V`. Min-coins minimizes item count; count-ways counts item multisets. Same recurrence, same sweep-direction rule (sibling `02-knapsack`).

### M8. How do you avoid overflow in the counting variant?
The count grows fast. If the problem asks "mod `10^9+7`", reduce `dp[v] %= MOD` after each `+=`. Otherwise use 64-bit or big integers. Min-coins never overflows (answer ≤ `V`).

### M9. What is the generating function for the number of combinations?
`Π_i 1/(1 - x^{c_i})`. The coefficient of `x^V` is the number of multisets summing to `V`. The product-over-coins structure is exactly why coin-outer counts combinations.

### M10. How do you count walks/ways of length AT MOST V or using at most m coins?
"At most `m` coins" adds a dimension: `dp[m][v]`. "Amounts `0..V`" can be done with a prefix sum or an augmented construction. The basic table gives *exactly* `V`.

### M11. Why can't you just take min-coins mod p?
Because `min` of residues is meaningless — `min(3, 1000000005)` after a wrong modulus could pick the wrong representative. Min-coins answers are small (≤ `V`) and never need a modulus; only counting does.

### M12 (analysis). What does "pseudo-polynomial" mean for coin change?
`O(V·n)` is polynomial in the numeric value `V`, but `V` is given in `O(log V)` bits, so it is exponential in the input *size*. At `V = 10^9` the table does not fit in memory — that is the pseudo-polynomial trap.

---

## Senior Questions (10 Q&A)

### S1. How do you count ways for an astronomically large `V`?
For a fixed small coin set, `N(V)` satisfies a linear recurrence (its generating function is rational). Encode it as a companion matrix and use **matrix exponentiation** in `O(d³ log V)` (or Kitamasa `O(d² log V)`), where `d` is the recurrence order. Take everything mod `p`.

### S2. How do you decide whether greedy is safe for a given coin system?
Run **Pearson's** canonicity test (`O(n³)`, independent of `V`): the smallest counterexample, if any, lies in a bounded window `(c_3, c_{n-1}+c_n)`; compare greedy vs DP there. If no mismatch, the system is canonical and greedy is provably optimal. Re-run whenever a denomination changes.

### S3. How do you handle exact counts that exceed 64 bits?
Use big integers, or run the DP under several coprime primes and reconstruct via **CRT** (each prime is an independent, parallelizable pass). Estimate magnitude (`N(V) ~ V^{n-1}/((n-1)!·Πc_i)`) to choose the number of primes.

### S4. Design a change-making service. What are the key decisions?
Validate the coin set (positive, distinct, contains 1 or handle unreachable amounts); bound `V` against the memory budget; cache the canonicity verdict so you know if greedy is legal; pick the objective/order/supply triple explicitly; log it with each result for observability.

### S5. How do you make one implementation serve min, count-combinations, and count-permutations?
Parameterize by an objective (combine = `min`+`+1` or `+`), an order (coin-outer vs amount-outer), and a supply (forward vs backward sweep). The skeleton barely changes; encapsulating the order prevents the silent permutations-for-combinations bug.

### S6. When is greedy the wrong choice even though it is fast?
On any non-canonical or user-configurable coin system; on counting problems (greedy answers minimization only); and when amounts may be unreachable and you need the exact `-1`. Default to DP unless canonicity is verified.

### S7. How do you verify correctness when `V` is too large to brute-force?
Keep a brute-force recursive oracle for small `V` and compare entrywise. Add property tests: `ways(0)=1`, `minCoins(0)=0`, `permutations ≥ combinations`, greedy==DP on a canonical set, and greedy≠DP on `{1,3,4}`. Cross-language determinism with the same modulus is another check.

### S8. What are the main performance levers in the DP?
Flat primitive arrays (not boxed types), start the inner loop at `c`, dedupe and drop coins `> V`, reduce mod only in counting, keep `dp[]` a single contiguous allocation for cache locality. Parallelize across CRT primes and independent queries, not within a sweep (sequential dependency).

### S9. How do you compute the number of ways using *at most* `k_i` of each coin?
Bounded change. Use the generating-function product `Π (1 - x^{(k_i+1)c_i})/(1 - x^{c_i})` mod `x^{V+1}`, or binary-split each coin into 0/1 items and run the 0/1 counting DP (backward sweep).

### S10 (analysis). Why is the change-making decision problem NP-complete but the DP still useful?
"Is `M(V) ≤ t`?" is weakly NP-complete (Lueker 1975) for arbitrary systems — no algorithm polynomial in `log V` is expected. The DP is **pseudo-polynomial** (`O(V·n)`), which is tractable whenever `V` is moderate, exactly like knapsack and subset-sum.

---

## Professional Questions (8 Q&A)

### P1. Prove the optimal substructure of min-coins.
If an optimal representation of `V` uses coin `c_k`, removing one `c_k` yields a representation of `V-c_k` of cardinality `M(V)-1`. If a cheaper representation of `V-c_k` existed, appending `c_k` would beat `M(V)` — contradiction. So the subproblem is solved optimally, giving `M(V) = 1 + min_{c≤V} M(V-c)`.

### P2. Give the generating-function proof that coin-outer counts combinations.
The combination count has GF `G_N(x) = Π_i 1/(1-x^{c_i})`; expanding each geometric factor as `Σ_{a_i} x^{a_i c_i}` and taking `[x^V]` counts tuples `(a_1,…,a_n)` with `Σ a_i c_i = V` — exactly multisets. The product-over-coins is the coin-outer loop. Permutations have GF `1/(1-Σ_i x^{c_i})` (sequence construction), which is the amount-outer loop.

### P3. How does the rational generating function justify the matrix-exponentiation route for huge `V`?
A rational GF `P(x)/Q(x)` with `deg Q = d` forces its coefficients to obey a linear recurrence of order `≤ d`. Encoding the recurrence as a companion matrix and powering it by binary exponentiation computes `N(V)` in `O(d³ log V)` — the same machinery as fixed-length walk counting (`11-graphs/32-paths-fixed-length`).

### P4. State and justify Pearson's canonicity result.
A system is canonical iff greedy is optimal for all `V`. Pearson (2005) proved the smallest counterexample, if any, lies in a bounded window determined by the two largest coins, so checking that finite window (greedy vs DP) decides canonicity in `O(n³)` — no infinite search. Adding a coin can flip the verdict.

### P5. What is the Frobenius number and how does it bound reachability?
For coprime coins, the Frobenius number `g(C)` is the largest non-representable amount; for two coins `g(a,b)=ab-a-b`. Every larger amount is representable. With `gcd(C)=g>1`, only multiples of `g` are reachable. This resolves reachability for large `V` in `O(1)` after a gcd check.

### P6. Why is min-coins loop-order independent but counting is not?
`min` is idempotent and order-insensitive: re-relaxing an already-optimal cell changes nothing, so coin-outer and amount-outer both reach `M(V)`. Counting uses `+`, which is *not* idempotent — the order in which contributions accumulate determines whether you count multisets or sequences.

### P7. How would you count combinations exactly for `V` up to `10^6` under a prime modulus, and verify it?
Coin-outer 1D DP with `dp[v] = (dp[v] + dp[v-c]) % p`. Verify against a brute-force recursion for small `V`, against the closed form for two coins (`⌊V/2⌋+1` for `{1,2}`), and via the permutations≥combinations inequality. Cross-check across two primes with CRT if exactness beyond one prime is needed.

### P8 (analysis). Why does the bounded GF use the factor `(1 - x^{(k_i+1)c_i})/(1-x^{c_i})`?
The numerator subtracts (inclusion-exclusion) every representation that uses coin `c_i` more than `k_i` times; the quotient is the finite geometric series `1 + x^{c_i} + … + x^{k_i c_i}`. Multiplying these per-coin factors mod `x^{V+1}` is exactly the bounded counting DP, realized concretely by binary-splitting into 0/1 items.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you caught a subtle off-by-one or loop-order bug.
Look for a concrete story: a counting feature returning numbers that were "close but wrong", a property test (permutations ≥ combinations) or oracle comparison that flagged it, the realization that the loops were swapped, and the fix plus a regression test pinning the loop order.

### B2. A teammate used greedy for change-making and a customer got too many coins. How do you handle it?
Explain canonicity calmly with the `{1,3,4}`→`6` counterexample. Note that greedy is only safe on canonical systems and that the deployed denominations may not be. Propose running Pearson's test when the coin set is configured, defaulting to DP otherwise, and adding a regression test. Frame it as a systems lesson, not blame.

### B3. Design a feature that tells users the fewest bills/coins to withdraw for an amount.
This is min-coins. Discuss: is the ATM's denomination set canonical (usually yes by design — verify)? bounded supply (the ATM has limited bills of each kind — bounded change)? unreachable amounts (return an error or round)? Mention greedy as the fast path once canonicity and supply are confirmed, DP as the safe fallback.

### B4. How would you explain combinations vs permutations to a junior?
Use coins: a *pile* of `1+2` is the same pile as `2+1` (combination), but *dropping* a 1 then a 2 differs from dropping 2 then 1 (permutation). Then map it to loops: coin-outer freezes a coin before moving on (one pile order = combinations); amount-outer reconsiders every coin each time (every drop order = permutations).

### B5. Your counting job is overflowing/using too much memory. How do you investigate?
Check whether `V` ballooned (pseudo-polynomial trap — `dp[]` is `O(V)`). Confirm you are reducing mod `p` (or using big ints) so counts don't overflow. Verify a single flat primitive array, not boxed objects. For huge `V` with a small coin set, switch to the recurrence/matrix route. Profile allocations and the array width.

---

## Coding Challenges

### Challenge 1: Minimum Number of Coins

**Problem.** Given coins (unbounded supply) and an amount, return the fewest coins to make the amount exactly, or `-1` if impossible.

**Example.**
```text
coins = [1,2,5], amount = 11  ->  3   (5+5+1)
coins = [2],     amount = 3   ->  -1
coins = [1,3,4], amount = 6   ->  2   (3+3)  // greedy would give 3
```

**Constraints.** `1 ≤ #coins ≤ 100`, `0 ≤ amount ≤ 10^4`.

**Optimal.** DP, `O(amount · #coins)`.

**Go.**
```go
package main

import "fmt"

func coinChange(coins []int, amount int) int {
	const INF = 1 << 30
	dp := make([]int, amount+1)
	for v := 1; v <= amount; v++ {
		dp[v] = INF
	}
	for _, c := range coins {
		for v := c; v <= amount; v++ {
			if dp[v-c]+1 < dp[v] {
				dp[v] = dp[v-c] + 1
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
	fmt.Println(coinChange([]int{1, 3, 4}, 6))  // 2
}
```

**Java.**
```java
public class MinCoins {
    static int coinChange(int[] coins, int amount) {
        final int INF = 1 << 30;
        int[] dp = new int[amount + 1];
        java.util.Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int c : coins)
            for (int v = c; v <= amount; v++)
                if (dp[v - c] + 1 < dp[v]) dp[v] = dp[v - c] + 1;
        return dp[amount] >= INF ? -1 : dp[amount];
    }

    public static void main(String[] args) {
        System.out.println(coinChange(new int[]{1, 2, 5}, 11)); // 3
        System.out.println(coinChange(new int[]{2}, 3));        // -1
        System.out.println(coinChange(new int[]{1, 3, 4}, 6));  // 2
    }
}
```

**Python.**
```python
def coin_change(coins, amount):
    INF = float("inf")
    dp = [INF] * (amount + 1)
    dp[0] = 0
    for c in coins:
        for v in range(c, amount + 1):
            if dp[v - c] + 1 < dp[v]:
                dp[v] = dp[v - c] + 1
    return -1 if dp[amount] == INF else dp[amount]


if __name__ == "__main__":
    print(coin_change([1, 2, 5], 11))  # 3
    print(coin_change([2], 3))         # -1
    print(coin_change([1, 3, 4], 6))   # 2
```

---

### Challenge 2: Number of Ways (Combinations)

**Problem.** Count the number of coin **combinations** that make the amount (order does not matter), modulo `10^9 + 7`.

**Example.**
```text
coins = [1,2,5], amount = 5  ->  4   ({5},{1,1,1,2},{1,2,2},{1,1,1,1,1})
coins = [2],     amount = 3  ->  0
```

**Constraints.** `1 ≤ #coins ≤ 100`, `0 ≤ amount ≤ 5000`.

**Optimal.** Coin-outer DP, `O(amount · #coins)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func change(coins []int, amount int) int64 {
	dp := make([]int64, amount+1)
	dp[0] = 1
	for _, c := range coins { // coin-outer => combinations
		for v := c; v <= amount; v++ {
			dp[v] = (dp[v] + dp[v-c]) % MOD
		}
	}
	return dp[amount]
}

func main() {
	fmt.Println(change([]int{1, 2, 5}, 5)) // 4
	fmt.Println(change([]int{2}, 3))       // 0
}
```

**Java.**
```java
public class CountWays {
    static final long MOD = 1_000_000_007L;

    static long change(int[] coins, int amount) {
        long[] dp = new long[amount + 1];
        dp[0] = 1;
        for (int c : coins)              // coin-outer => combinations
            for (int v = c; v <= amount; v++)
                dp[v] = (dp[v] + dp[v - c]) % MOD;
        return dp[amount];
    }

    public static void main(String[] args) {
        System.out.println(change(new int[]{1, 2, 5}, 5)); // 4
        System.out.println(change(new int[]{2}, 3));       // 0
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def change(coins, amount):
    dp = [0] * (amount + 1)
    dp[0] = 1
    for c in coins:                      # coin-outer => combinations
        for v in range(c, amount + 1):
            dp[v] = (dp[v] + dp[v - c]) % MOD
    return dp[amount]


if __name__ == "__main__":
    print(change([1, 2, 5], 5))  # 4
    print(change([2], 3))        # 0
```

---

### Challenge 3: Bounded Coin Change (limited supply, combinations)

**Problem.** Each coin `coins[i]` is available at most `counts[i]` times. Count the number of combinations making the amount, modulo `10^9 + 7`. Use binary splitting into 0/1 items.

**Example.**
```text
coins=[1,2], counts=[2,1], amount=3 -> 1   (only {1,2}; cannot use 1 thrice)
```

**Constraints.** `1 ≤ #coins ≤ 50`, `1 ≤ counts[i] ≤ 10^4`, `0 ≤ amount ≤ 2000`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func boundedChange(coins, counts []int, amount int) int64 {
	var items []int
	for i, c := range coins {
		k := counts[i]
		chunk := 1
		for k > 0 {
			take := chunk
			if take > k {
				take = k
			}
			items = append(items, c*take)
			k -= take
			chunk *= 2
		}
	}
	dp := make([]int64, amount+1)
	dp[0] = 1
	for _, w := range items {
		for v := amount; v >= w; v-- { // backward => each item once
			dp[v] = (dp[v] + dp[v-w]) % MOD
		}
	}
	return dp[amount]
}

func main() {
	fmt.Println(boundedChange([]int{1, 2}, []int{2, 1}, 3)) // 1
}
```

**Java.**
```java
import java.util.*;

public class BoundedChange {
    static final long MOD = 1_000_000_007L;

    static long boundedChange(int[] coins, int[] counts, int amount) {
        List<Integer> items = new ArrayList<>();
        for (int i = 0; i < coins.length; i++) {
            int k = counts[i], chunk = 1;
            while (k > 0) {
                int take = Math.min(chunk, k);
                items.add(coins[i] * take);
                k -= take;
                chunk *= 2;
            }
        }
        long[] dp = new long[amount + 1];
        dp[0] = 1;
        for (int w : items)
            for (int v = amount; v >= w; v--)   // backward => each item once
                dp[v] = (dp[v] + dp[v - w]) % MOD;
        return dp[amount];
    }

    public static void main(String[] args) {
        System.out.println(boundedChange(new int[]{1, 2}, new int[]{2, 1}, 3)); // 1
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def bounded_change(coins, counts, amount):
    items = []
    for c, k in zip(coins, counts):
        chunk = 1
        while k > 0:
            take = min(chunk, k)
            items.append(c * take)
            k -= take
            chunk *= 2
    dp = [0] * (amount + 1)
    dp[0] = 1
    for w in items:
        for v in range(amount, w - 1, -1):   # backward => each item once
            dp[v] = (dp[v] + dp[v - w]) % MOD
    return dp[amount]


if __name__ == "__main__":
    print(bounded_change([1, 2], [2, 1], 3))  # 1
```

---

### Challenge 4: Greedy vs DP (detect a counterexample)

**Problem.** Given a coin system (containing `1`) and a bound `L`, return the smallest amount `≤ L` where greedy (largest-first) is suboptimal, or `-1` if greedy matches the DP everywhere up to `L`.

**Example.**
```text
coins=[1,3,4], L=10 -> 6   (greedy 4+1+1=3, optimal 3+3=2)
coins=[1,5,10,25], L=100 -> -1 (canonical)
```

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func greedyCount(desc []int, v int) int {
	cnt := 0
	for _, c := range desc {
		cnt += v / c
		v %= c
	}
	return cnt
}

func firstCounterexample(coins []int, L int) int {
	const INF = 1 << 30
	desc := append([]int(nil), coins...)
	sort.Sort(sort.Reverse(sort.IntSlice(desc)))
	dp := make([]int, L+1)
	for v := 1; v <= L; v++ {
		dp[v] = INF
		for _, c := range coins {
			if c <= v && dp[v-c]+1 < dp[v] {
				dp[v] = dp[v-c] + 1
			}
		}
		if greedyCount(desc, v) != dp[v] {
			return v
		}
	}
	return -1
}

func main() {
	fmt.Println(firstCounterexample([]int{1, 3, 4}, 10))      // 6
	fmt.Println(firstCounterexample([]int{1, 5, 10, 25}, 100)) // -1
}
```

**Java.**
```java
import java.util.*;

public class GreedyVsDP {
    static int greedyCount(int[] desc, int v) {
        int cnt = 0;
        for (int c : desc) { cnt += v / c; v %= c; }
        return cnt;
    }

    static int firstCounterexample(int[] coins, int L) {
        final int INF = 1 << 30;
        int[] desc = coins.clone();
        Arrays.sort(desc);
        for (int i = 0; i < desc.length / 2; i++) {
            int t = desc[i]; desc[i] = desc[desc.length - 1 - i]; desc[desc.length - 1 - i] = t;
        }
        int[] dp = new int[L + 1];
        for (int v = 1; v <= L; v++) {
            dp[v] = INF;
            for (int c : coins)
                if (c <= v && dp[v - c] + 1 < dp[v]) dp[v] = dp[v - c] + 1;
            if (greedyCount(desc, v) != dp[v]) return v;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstCounterexample(new int[]{1, 3, 4}, 10));       // 6
        System.out.println(firstCounterexample(new int[]{1, 5, 10, 25}, 100)); // -1
    }
}
```

**Python.**
```python
def greedy_count(desc, v):
    cnt = 0
    for c in desc:
        cnt += v // c
        v %= c
    return cnt


def first_counterexample(coins, L):
    INF = 1 << 30
    desc = sorted(coins, reverse=True)
    dp = [0] + [INF] * L
    for v in range(1, L + 1):
        for c in coins:
            if c <= v and dp[v - c] + 1 < dp[v]:
                dp[v] = dp[v - c] + 1
        if greedy_count(desc, v) != dp[v]:
            return v
    return -1


if __name__ == "__main__":
    print(first_counterexample([1, 3, 4], 10))        # 6
    print(first_counterexample([1, 5, 10, 25], 100))  # -1
```

---

## Final Tips

- Lead with the two one-liners: *"`dp[v]=min(dp[v-c]+1)` for fewest coins; `dp[v]+=dp[v-c]` for ways."*
- Immediately flag the loop-order rule: **coin-outer = combinations, amount-outer = permutations.**
- For min-coins, handle **impossible** explicitly (`∞ ⇒ -1`) and use `INF = amount + 1`, never `MAX_INT`.
- If asked about greedy, give the **`{1,3,4}` → `6`** counterexample and mention **canonical systems** / Pearson's test.
- Connect it to **unbounded knapsack** and mention the **forward vs backward sweep** for unbounded vs bounded.
- Always offer to verify against a brute-force recursive oracle on small inputs.
