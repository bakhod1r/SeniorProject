# Subset Sum and Partition DP — Interview Preparation

Subset-sum and partition are interview favourites because they reward a single crisp insight — *"`dp[t]` = can a subset reach sum `t`, filled by `dp[t] |= dp[t-v]` scanned high→low"* — and then test whether you can (a) reduce equal-partition to subset-sum at `S/2`, (b) keep it correct with the downward scan, (c) recognize the count, min-difference, and `±`-target variants of the same table, (d) know the pseudo-polynomial caveat and when meet-in-the-middle wins, and (e) avoid reusing each item twice. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Can a subset sum to `T`? | boolean DP `dp[t] |= dp[t-v]` | `O(n·T)` |
| Equal partition into two halves? | subset-sum to `S/2` (after parity check) | `O(n·S)` |
| Count subsets summing to `T` | integer DP `cnt[t] += cnt[t-v]` | `O(n·T)` |
| Minimum `|S1 − S2|` | subset-sum to `S/2`, scan for top reachable | `O(n·S)` |
| Target Sum (`±` to reach `target`) | count subset-sum to `(S+target)/2` | `O(n·S)` |
| Decision, large `T` | bitset `B |= B << v` | `O(n·T / 64)` |
| Decision, huge `T`, small `n` | meet-in-the-middle | `O(2^{n/2} n)` |
| Partition into `k` equal subsets | bitmask DP / backtracking | `O(2ⁿ n)` |
| **Count *simple* `k`-way size-constrained** | **strongly NP-hard** | — |

Core algorithm:

```text
subsetSum(nums, T):
    dp = bool[T+1]; dp[0] = true        # empty subset
    for v in nums:
        for t = T down to v:            # downward => each item once
            dp[t] = dp[t] OR dp[t - v]
    return dp[T]                         # O(n*T) time, O(T) space

canPartition(nums):
    S = sum(nums)
    if S odd: return false
    return subsetSum(nums, S/2)
```

Key facts:
- **`dp[0] = true`** — the empty subset; the seed everything grows from.
- **Scan `t` from `T` down to `v`** — upward would reuse each item (unbounded knapsack).
- **Equal partition** needs `S` even, then a subset summing to `S/2`.
- **`O(n·T)` is pseudo-polynomial** — fast only when `T` is moderate; subset-sum is NP-complete.

---

## Junior Questions (12 Q&A)

### J1. What does `dp[t]` represent in subset-sum?
A boolean: `dp[t]` is `true` iff *some* subset of the items processed so far sums to exactly `t`. After processing all items, `dp[T]` answers "can a subset reach `T`?".

### J2. What is the base case and why?
`dp[0] = true`. The empty subset sums to `0`, so `0` is always reachable. It is the seed: every other reachable sum is built from it. Forget it and the whole table stays `false`.

### J3. What is the update rule for a new item `v`?
`dp[t] = dp[t] OR dp[t - v]`. Either `t` was already reachable (skip `v`), or `t - v` was reachable and adding `v` reaches `t` (take `v`).

### J4. Why iterate `t` from high to low in the 1D array?
So each item is used at most once. Scanning downward means `dp[t - v]` still holds the value from *before* this item was added. Upward would let `v` chain into itself (`t-v → t → t+v`), reusing the same item — that's unbounded knapsack.

### J5. How does equal partition reduce to subset-sum?
Two equal halves each sum to `S/2`, where `S` is the total. So ask: is there a subset summing to `S/2`? First reject odd `S` (can't halve an odd number into two equal integers).

### J6. What is the time and space complexity?
`O(n·T)` time and `O(T)` space (1D array), where `T` is the target value. For partition, `T = S/2`, so `O(n·S)`.

### J7. Why is the brute force `O(2ⁿ)`?
There are `2ⁿ` subsets; checking each sum is `O(n)`. The DP avoids re-summing overlapping subsets by tabulating reachable sums.

### J8. Can subset-sum handle negative numbers?
Not directly — the standard array-indexed DP assumes non-negative values (indices `0..T`). Negatives need an offset/shift or a different formulation.

### J9. What does the DP *not* tell you?
*Which* items form the subset. The boolean table only says whether one exists; reconstruction needs a 2D table or a parent trail.

### J10. What happens for target `T = 0`?
`dp[0]` is `true` by construction (empty subset), so subset-sum to `0` is always reachable.

### J11. If the total `S` is odd, what is the partition answer?
`false`, immediately. Two equal integer halves must sum to an even number. No DP needed.

### J12 (analysis). Why is `O(n·T)` not considered polynomial?
Because `T` is a *value*, encoded in `log T` bits. `O(n·T)` is exponential in `log T`, so it is "pseudo-polynomial": fast only when `T` is numerically small.

---

## Middle Questions (12 Q&A)

### M1. Prove the subset-sum recurrence is correct.
Induction on items. Base: `dp_0[t]` is `true` only for `t = 0`. Step: a subset of the first `i` items either excludes item `i` (`dp_{i-1}[t]`) or includes it (`dp_{i-1}[t - aᵢ]`); these cases are exhaustive and disjoint, so `dp_i[t] = dp_{i-1}[t] OR dp_{i-1}[t - aᵢ]`.

### M2. How do you count subsets summing to `T`?
Swap the boolean for an integer and `OR` for `+`: `cnt[t] += cnt[t - v]`, with `cnt[0] = 1`. Reduce mod `p` since counts grow up to `2ⁿ`.

### M3. How do you find the minimum `|S1 − S2|` partition?
Run subset-sum up to `S/2`, then scan downward for the largest reachable `sA ≤ S/2`. The minimum difference is `S − 2·sA` (complement trick: the other half is `S − sA`).

### M4. How does the Target Sum problem (`±` signs) reduce to subset-sum?
Let `P` be the positive-sign subset, `N` the negative. `P − N = target` and `P + N = S`, so `P = (S + target)/2`. Count subsets summing to `(S + target)/2` (requires `S + target` even and non-negative).

### M5. What is the bitset speedup?
Store `dp` as the bits of a big integer `B`. One item is `B |= B << v` — 64 sums per instruction, `O(n·T / w)`. Initialize `B = 1` (bit 0). Boolean decision only; can't pack counts.

### M6. When does meet-in-the-middle beat the DP?
When `T` is huge but `n` is small (≤ ~40). Enumerate all `2^{n/2}` sums of each half, sort one, binary-search complements. `O(2^{n/2} n)`, independent of `T`. (Sibling `15-divide-and-conquer/06`.)

### M7. How do you partition into `k` equal subsets?
Reject if `S % k != 0` or `max > S/k`. Then assign items to `k` buckets via bitmask DP (`dp[mask]` = current bucket fill) or backtracking with pruning — `O(2ⁿ n)`, NP-hard. (Sibling topic `06`.)

### M8. How do you reconstruct the chosen subset?
Keep a 2D table `dp[i][t]`. After confirming `dp[n][T]`, walk backward: if `dp[i-1][t]` is already `true`, item `i-1` was skipped; else it was taken, record it and set `t -= nums[i-1]`.

### M9. Why does scanning `t` upward break the 1D DP?
Upward, `dp[t - v]` may already reflect *this* item being taken, so `v` gets used again at `t`, then `t + v`, etc. — it counts multisets, the unbounded-knapsack semantics, not subsets.

### M10. How do zeros in the array affect counting?
Each `0` doubles every reachable sum's count (in or out without changing the sum). The integer DP handles it automatically; be deliberate about whether to count the empty subset.

### M11. Why can't subset-sum DP count *size-constrained* `k`-partitions efficiently?
Two-way partition is pseudo-polynomial, but size-constrained 3-partition is *strongly* NP-complete — no pseudo-polynomial DP exists unless `P = NP`. You need bitmask/exponential methods.

### M12 (analysis). What bounds the number of subsets summing to `T`?
At most `2ⁿ` (all subsets). Counts can be exponential, which is why counting problems demand a modulus and 64-bit accumulators.

---

## Senior Questions (10 Q&A)

### S1. How do you decide between DP, bitset, and meet-in-the-middle?
Gate on value magnitude. Moderate `T` → 1D DP (bitset if decision-only, 64× win). Huge `T`, small `n` (≤ 40) → meet-in-the-middle (`O(2^{n/2} n)`, ignores `T`). Both large → NP-hard; approximate (FPTAS) or reformulate.

### S2. Why is subset-sum NP-complete yet the DP "solves" it?
The DP is `O(n·T)` — pseudo-polynomial, exponential in the bit-length `log T`. It is fast only for small values. There is no `poly(n, log T)` algorithm unless `P = NP`.

### S3. How do you keep counts exact when they exceed 64 bits?
Run the counting DP under several coprime primes and recombine with CRT — each prime run is independent and parallelizable. Estimate the magnitude (`≤ 2ⁿ`) to choose the number of primes.

### S4. How do you reconstruct the subset without `O(n·T)` memory?
Hirschberg-style linear-space recursion (recurse on item halves around a midpoint sum split), `O(T)` memory and `O(n·T)` time — the same trick as linear-space LCS. Or recompute on demand from the 1D table.

### S5. How would you implement minimum-difference partition for load balancing?
Subset-sum up to `half = S/2`, bitset-accelerated; the answer is `S − 2·(highest set bit ≤ half)`. For *which* jobs go where, keep reconstruction state. Note `k > 2` machines is a different NP-hard problem (scheduling / `k`-partition), not this DP.

### S6. What's the failure mode of using two-way subset-sum for `k > 2`?
It silently answers the wrong question — two-way subset-sum can't enforce `k` balanced buckets. Detect `k > 2` and route to bitmask DP / LPT scheduling (topic `06`).

### S7. How do you verify correctness when the input is large?
Keep a brute-force `2ⁿ` oracle for `n ≤ 20` and compare decisions/counts. Property tests: `dp[0]` is `true`, `count[t] > 0 ⇔ dp[t]`, partition matches `S even AND dp[S/2]`, bitset agrees with the explicit loop, MITM agrees with DP where both feasible.

### S8. When is the bitset speedup unavailable?
For counting (integer cells) and weighted/min-plus optimization — a single bit can't hold a count or an optimum. Bitset accelerates the Boolean decision only.

### S9. How would you handle both `n` and values being large?
Exact subset-sum is intractable. Use the FPTAS for the optimization variant (largest subset sum `≤ T`): trim the reachable-sums list to within `(1±ε)`, keeping size polynomial in `n/ε` for an `(1−ε)`-approximation. The exact decision has no such scheme.

### S10 (analysis). Why does the downward scan enforce the 0/1 constraint, formally?
When `t` decreases from `T`, every index `t' < t` is still unmodified at the moment we process `t`, so `dp[t - v]` holds the pre-item (`dp_{i-1}`) value — matching the exclude/include recurrence and using item `i` at most once. Upward would read an already-updated (`dp_i`) value, reusing the item.

---

## Professional Questions (8 Q&A)

### P1. Design a service that decides "can these credits exactly cover charge `T`" over arbitrary inputs.
Validate non-negativity and bound `T`. Gate on magnitude: moderate `T` → bitset DP; huge `T` small `n` → MITM; reject the both-large NP-hard regime (or offer an approximate "closest coverage"). Cap table width so a hostile input can't OOM the service.

### P2. The partition answer must be exact and the count may exceed `10^{18}`. What do you do?
Run the counting DP under multiple coprime primes and CRT-combine. Each modular run is independent (parallelize). Estimate magnitude via `2ⁿ` to size the prime set.

### P3. Your subset-sum table is `10^{12}` cells. What went wrong and how do you fix it?
Pseudo-polynomial blow-up: values are too large. If `n` is small (≤ 40), switch to meet-in-the-middle (independent of `T`). If both are large, the exact problem is intractable — use the FPTAS or reformulate the requirement.

### P4. How do you debug "the subset-sum result is wrong" in production?
Run the brute-force `2ⁿ` oracle on the same small inputs and diff. Check the three usual suspects: scan direction (upward reuses items), missing `dp[0]`, and (for partition) the parity gate. Verify the count-vs-decision invariant.

### P5. When is min-difference partition the wrong tool?
When you actually need `k > 2` balanced groups (that's NP-hard scheduling, not two-way subset-sum), or when a cardinality constraint exists ("exactly `m` items") which needs a second DP dimension `dp[m][t]`. State the model explicitly.

### P6. How do you parallelize a batch of subset-sum / partition queries on one item set?
For counting, the CRT primes are independent jobs. For many `(s, T)` decision queries sharing the array, build the reachable-sums bitset once (`B`) and answer each query with a `O(1)` bit test. Independent queries distribute across workers.

### P7. How does subset-sum counting connect to generating functions?
The number of subsets summing to `t` is `[x^t] Π(1 + x^{aᵢ})`. Each factor encodes "item out (`1`) or in (`x^{aᵢ}`)". The counting DP is exactly this product truncated to degree `T`; the decision DP is the same product over the Boolean semiring.

### P8 (analysis). Why is 2-way partition pseudo-poly-tractable but 3-partition strongly NP-complete?
2-way `PARTITION` has the `O(n·S)` DP (weakly NP-complete, unary-tractable). Size-constrained `3-PARTITION` is *strongly* NP-complete: it stays hard even when numbers are polynomially bounded, so no pseudo-polynomial DP can exist unless `P = NP`. The size constraint destroys the simple reachable-sums tractability.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you reduced a problem to a known DP.
Look for a concrete story: recognizing that "balance two carts of boxes" was equal-partition / min-difference subset-sum, the reduction to subset-sum at `S/2`, the pseudo-polynomial check on value magnitude, and the measured outcome. Strong answers mention validating against brute force and the bitset speedup.

### B2. A teammate used two-way subset-sum to balance load across 5 servers and shipped a wrong result. How do you handle it?
Explain calmly that two-way subset-sum can't enforce 5 balanced buckets — that's the `k`-partition / makespan-scheduling problem, NP-hard, needing bitmask DP or LPT approximation. Offer a tiny counterexample. Frame it as a teaching moment and propose the correct algorithm (topic `06`).

### B3. Design a feature that splits a shared bill into two fair halves.
This is min-difference partition: subset-sum to `S/2`, report `S − 2·s*` and the actual item assignment (reconstruction). Discuss the parity gate, the pseudo-polynomial caveat if amounts are huge (use cents, bound the total), and what "fair" means if an exact half is impossible.

### B4. How would you explain subset-sum DP to a junior engineer?
Start with the coin analogy: `dp[t]` = "can I make exactly `t` cents with some coins?". Show the update `dp[t] |= dp[t-coin]`. Lead with the two gotchas: scan downward (don't reuse a coin) and seed `dp[0] = true`. Then show equal-partition as subset-sum to half the total.

### B5. Your partition job is using too much memory at scale. How do you investigate?
The table is `O(T)`; check whether `T` (= value magnitude) ballooned — that's the pseudo-polynomial trap. Switch to bitset (`O(T/64)`) for decision, or MITM if `n` is small. If reconstruction is the culprit, use Hirschberg linear-space instead of the full 2D table.

---

## Coding Challenges

### Challenge 1: Partition Equal Subset Sum

**Problem.** Given an array of non-negative integers, return `true` iff it can be split into two subsets with equal sum.

**Example.**
```text
[1,5,11,5] -> true   ({11}, {1,5,5})
[1,2,3,5]  -> false  (total 11 is odd)
```

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ nums[i] ≤ 100`.

**Brute force.** Enumerate `2ⁿ` subsets — infeasible for large `n`.

**Optimal.** Subset-sum to `S/2`, `O(n·S)`.

**Go.**
```go
package main

import "fmt"

func canPartition(nums []int) bool {
	total := 0
	for _, v := range nums {
		total += v
	}
	if total%2 != 0 {
		return false
	}
	target := total / 2
	dp := make([]bool, target+1)
	dp[0] = true
	for _, v := range nums {
		for t := target; t >= v; t-- {
			if dp[t-v] {
				dp[t] = true
			}
		}
		if dp[target] {
			return true
		}
	}
	return dp[target]
}

func main() {
	fmt.Println(canPartition([]int{1, 5, 11, 5})) // true
	fmt.Println(canPartition([]int{1, 2, 3, 5}))  // false
}
```

**Java.**
```java
public class CanPartition {
    static boolean canPartition(int[] nums) {
        int total = 0;
        for (int v : nums) total += v;
        if (total % 2 != 0) return false;
        int target = total / 2;
        boolean[] dp = new boolean[target + 1];
        dp[0] = true;
        for (int v : nums) {
            for (int t = target; t >= v; t--) {
                if (dp[t - v]) dp[t] = true;
            }
            if (dp[target]) return true;
        }
        return dp[target];
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
    if total % 2 != 0:
        return False
    target = total // 2
    dp = [False] * (target + 1)
    dp[0] = True
    for v in nums:
        for t in range(target, v - 1, -1):
            if dp[t - v]:
                dp[t] = True
        if dp[target]:
            return True
    return dp[target]


if __name__ == "__main__":
    print(can_partition([1, 5, 11, 5]))  # True
    print(can_partition([1, 2, 3, 5]))   # False
```

---

### Challenge 2: Count Subsets with a Given Sum

**Problem.** Given non-negative integers and a target `T`, return the number of subsets summing to exactly `T`, modulo `10^9 + 7`.

**Example.**
```text
nums=[1,1,2,3], T=4 -> 3   ({1,3},{1,3},{2,1,1}... count distinct index-subsets)
```

**Constraints.** `1 ≤ n ≤ 1000`, `0 ≤ T ≤ 10^5`.

**Optimal.** Integer DP `cnt[t] += cnt[t-v]`, `O(n·T)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func countSubsets(nums []int, target int) int64 {
	cnt := make([]int64, target+1)
	cnt[0] = 1
	for _, v := range nums {
		for t := target; t >= v; t-- {
			cnt[t] = (cnt[t] + cnt[t-v]) % MOD
		}
	}
	return cnt[target]
}

func main() {
	fmt.Println(countSubsets([]int{1, 1, 2, 3}, 4)) // 3
}
```

**Java.**
```java
public class CountSubsets {
    static final long MOD = 1_000_000_007L;

    static long countSubsets(int[] nums, int target) {
        long[] cnt = new long[target + 1];
        cnt[0] = 1;
        for (int v : nums) {
            for (int t = target; t >= v; t--) {
                cnt[t] = (cnt[t] + cnt[t - v]) % MOD;
            }
        }
        return cnt[target];
    }

    public static void main(String[] args) {
        System.out.println(countSubsets(new int[]{1, 1, 2, 3}, 4)); // 3
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def count_subsets(nums, target):
    cnt = [0] * (target + 1)
    cnt[0] = 1
    for v in nums:
        for t in range(target, v - 1, -1):
            cnt[t] = (cnt[t] + cnt[t - v]) % MOD
    return cnt[target]


if __name__ == "__main__":
    print(count_subsets([1, 1, 2, 3], 4))  # 3
```

---

### Challenge 3: Minimum Subset Sum Difference

**Problem.** Partition the array into two subsets minimizing the absolute difference of their sums. Return the minimum difference.

**Example.**
```text
[1,6,11,5] -> 1   ({1,5,6} sum 12, {11} sum 11)
```

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ nums[i] ≤ 1000`.

**Optimal.** Subset-sum to `S/2`, then scan for the highest reachable sum; answer `S − 2·s*`, `O(n·S)`.

**Go.**
```go
package main

import "fmt"

func minSubsetDiff(nums []int) int {
	total := 0
	for _, v := range nums {
		total += v
	}
	half := total / 2
	dp := make([]bool, half+1)
	dp[0] = true
	for _, v := range nums {
		for t := half; t >= v; t-- {
			if dp[t-v] {
				dp[t] = true
			}
		}
	}
	for sA := half; sA >= 0; sA-- {
		if dp[sA] {
			return total - 2*sA
		}
	}
	return total
}

func main() {
	fmt.Println(minSubsetDiff([]int{1, 6, 11, 5})) // 1
}
```

**Java.**
```java
public class MinSubsetDiff {
    static int minSubsetDiff(int[] nums) {
        int total = 0;
        for (int v : nums) total += v;
        int half = total / 2;
        boolean[] dp = new boolean[half + 1];
        dp[0] = true;
        for (int v : nums) {
            for (int t = half; t >= v; t--) {
                if (dp[t - v]) dp[t] = true;
            }
        }
        for (int sA = half; sA >= 0; sA--) {
            if (dp[sA]) return total - 2 * sA;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(minSubsetDiff(new int[]{1, 6, 11, 5})); // 1
    }
}
```

**Python.**
```python
def min_subset_diff(nums):
    total = sum(nums)
    half = total // 2
    dp = [False] * (half + 1)
    dp[0] = True
    for v in nums:
        for t in range(half, v - 1, -1):
            if dp[t - v]:
                dp[t] = True
    for sA in range(half, -1, -1):
        if dp[sA]:
            return total - 2 * sA
    return total


if __name__ == "__main__":
    print(min_subset_diff([1, 6, 11, 5]))  # 1
```

---

### Challenge 4: Target Sum (assign +/- to reach a target)

**Problem.** Given non-negative integers and a target `target`, count the ways to assign `+`/`−` to each element so the signed sum equals `target`, modulo `10^9 + 7`.

**Approach.** Let `P` = elements assigned `+`, `N` = assigned `−`. Then `P − N = target` and `P + N = S`, so `P = (S + target)/2`. The answer is the number of subsets summing to `(S + target)/2` (return `0` if `S + target` is odd or `< 0`). This reduces Target Sum to **counting subset-sum**.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func findTargetSumWays(nums []int, target int) int64 {
	total := 0
	for _, v := range nums {
		total += v
	}
	if target > total || target < -total || (total+target)%2 != 0 {
		return 0
	}
	subTarget := (total + target) / 2
	cnt := make([]int64, subTarget+1)
	cnt[0] = 1
	for _, v := range nums {
		for t := subTarget; t >= v; t-- {
			cnt[t] = (cnt[t] + cnt[t-v]) % MOD
		}
	}
	return cnt[subTarget]
}

func main() {
	fmt.Println(findTargetSumWays([]int{1, 1, 1, 1, 1}, 3)) // 5
}
```

**Java.**
```java
public class TargetSum {
    static final long MOD = 1_000_000_007L;

    static long findTargetSumWays(int[] nums, int target) {
        int total = 0;
        for (int v : nums) total += v;
        if (target > total || target < -total || (total + target) % 2 != 0) return 0;
        int subTarget = (total + target) / 2;
        long[] cnt = new long[subTarget + 1];
        cnt[0] = 1;
        for (int v : nums) {
            for (int t = subTarget; t >= v; t--) {
                cnt[t] = (cnt[t] + cnt[t - v]) % MOD;
            }
        }
        return cnt[subTarget];
    }

    public static void main(String[] args) {
        System.out.println(findTargetSumWays(new int[]{1, 1, 1, 1, 1}, 3)); // 5
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def find_target_sum_ways(nums, target):
    total = sum(nums)
    if target > total or target < -total or (total + target) % 2 != 0:
        return 0
    sub_target = (total + target) // 2
    cnt = [0] * (sub_target + 1)
    cnt[0] = 1
    for v in nums:
        for t in range(sub_target, v - 1, -1):
            cnt[t] = (cnt[t] + cnt[t - v]) % MOD
    return cnt[sub_target]


if __name__ == "__main__":
    print(find_target_sum_ways([1, 1, 1, 1, 1], 3))  # 5
```

---

## Final Tips

- Lead with the one-liner: *"`dp[t]` = can a subset reach sum `t`; fill it with `dp[t] |= dp[t-v]` scanned high→low; equal-partition is subset-sum to `S/2`."*
- Immediately flag the two gotchas: **scan downward** (don't reuse items) and **seed `dp[0] = true`**.
- For counting / Target Sum, use `cnt[t] += cnt[t-v]` and the `(S+target)/2` reduction.
- For min-difference, use the complement trick: best difference `= S − 2·s*` for the highest reachable `s* ≤ S/2`.
- Mention the **pseudo-polynomial caveat** and **meet-in-the-middle** for huge `T` / small `n`; mention **bitmask DP** (topic `06`) for `k`-way.
- Always offer to verify against a brute-force `2ⁿ` oracle on small inputs.
