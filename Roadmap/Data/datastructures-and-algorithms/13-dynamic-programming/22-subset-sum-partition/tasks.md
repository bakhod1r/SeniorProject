# Subset Sum and Partition DP — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the subset-sum / partition DP logic and validate against the evaluation criteria.
> **Always test against a brute-force `2ⁿ` subset-enumeration oracle on small inputs before trusting the DP result.**

---

## Beginner Tasks (5)

### Task 1 — Subset-sum decision

**Problem.** Implement `subsetSum(nums, target)` returning `true` iff some subset of the non-negative integers `nums` sums to exactly `target`. Use the 1D boolean DP with the downward scan.

**Input / Output spec.**
- Read `n`, `target`, then `n` integers.
- Print `true` or `false`.

**Constraints.**
- `1 ≤ n ≤ 1000`, `0 ≤ target ≤ 10^5`, `0 ≤ nums[i] ≤ target`.

**Hint.** Seed `dp[0] = true`. Scan `t` from `target` down to `v` so each item is used at most once.

**Starter — Go.**
```go
package main

import "fmt"

func subsetSum(nums []int, target int) bool {
	// TODO: dp[0]=true; for each v, scan t from target down to v: dp[t] |= dp[t-v]
	return false
}

func main() {
	var n, target int
	fmt.Scan(&n, &target)
	nums := make([]int, n)
	for i := range nums {
		fmt.Scan(&nums[i])
	}
	fmt.Println(subsetSum(nums, target))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean subsetSum(int[] nums, int target) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), target = sc.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();
        System.out.println(subsetSum(nums, target));
    }
}
```

**Starter — Python.**
```python
import sys


def subset_sum(nums, target):
    # TODO
    return False


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    target = int(next(data))
    nums = [int(next(data)) for _ in range(n)]
    print(str(subset_sum(nums, target)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `dp[0] = true` seeded.
- Downward scan (no item reuse) — verify against brute force.
- `O(n·target)` time, `O(target)` space.

---

### Task 2 — Partition equal subset sum

**Problem.** Given non-negative integers, output `true` iff they can be split into two subsets of equal sum. Reduce to subset-sum at `S/2`.

**Input / Output spec.**
- Read `n`, then `n` integers. Print `true`/`false`.

**Constraints.** `1 ≤ n ≤ 200`, `1 ≤ nums[i] ≤ 100`.

**Hint.** Compute `S`. If `S` is odd, print `false` immediately. Otherwise run subset-sum to `S/2`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_partition(nums):
    n = len(nums)
    total = sum(nums)
    for mask in range(1 << n):
        s = sum(nums[i] for i in range(n) if mask & (1 << i))
        if 2 * s == total:
            return True
    return False
```

**Evaluation criteria.**
- Odd total short-circuits to `false`.
- Matches `brute_partition` for `n ≤ 18`.
- `O(n·S)`.

---

### Task 3 — Count subsets summing to T

**Problem.** Count the number of subsets of `nums` summing to exactly `target`, modulo `10^9 + 7`. Use the integer DP `cnt[t] += cnt[t-v]`.

**Input / Output spec.**
- Read `n`, `target`, then `n` integers. Print the count mod `p`.

**Constraints.** `1 ≤ n ≤ 1000`, `0 ≤ target ≤ 10^5`.

**Hint.** Seed `cnt[0] = 1`. Reduce mod `p` after each `+=`. Watch how a `0` in the array doubles every count.

**Worked check.** `nums = [1,2,3], target = 3` → `2` (`{3}` and `{1,2}`). For `nums = [0,1], target = 1` → `2` (`{1}` and `{0,1}`, because `0` can be in or out).

**Evaluation criteria.**
- `cnt[0] = 1` seeded; reduced mod `p`.
- Matches brute-force subset count for small `n`.
- `O(n·target)`.

---

### Task 4 — Minimum subset sum difference

**Problem.** Partition `nums` into two subsets minimizing `|S1 − S2|`. Output the minimum difference.

**Input / Output spec.**
- Read `n`, then `n` integers. Print the minimum difference.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ nums[i] ≤ 1000`.

**Hint.** Subset-sum up to `half = S/2`; scan downward for the largest reachable `sA`; answer `S − 2·sA`.

**Worked check.** `[1,6,11,5]` → `1`. `[1,2,3,9]` → `3`. The answer always has the same parity as `S`.

**Evaluation criteria.**
- Uses the complement trick `S − 2·s*`.
- Answer has the same parity as `S`.
- Matches brute force for small `n`.

---

### Task 5 — Target Sum (+/- assignment count)

**Problem.** Count assignments of `+`/`−` to each element so the signed sum equals `target`, mod `10^9 + 7`. Reduce to counting subsets summing to `(S + target)/2`.

**Input / Output spec.**
- Read `n`, `target`, then `n` integers. Print the count mod `p`.

**Constraints.** `1 ≤ n ≤ 1000`, `|target| ≤ S`, `0 ≤ nums[i] ≤ 1000`.

**Hint.** Return `0` if `S + target` is odd or `S < |target|`. Otherwise count subsets summing to `(S + target)/2`.

**Evaluation criteria.**
- `findTargetSumWays([1,1,1,1,1], 3) == 5`.
- Handles `target` larger than `S` (returns `0`).
- Matches brute-force `±` enumeration for small `n`.

---

## Intermediate Tasks (5)

### Task 6 — Reconstruct the chosen subset

**Problem.** Given `nums` and `target`, return one subset (the actual elements, by index) that sums to `target`, or report none exists. Use the 2D table and walk backward.

**Constraints.** `1 ≤ n ≤ 500`, `0 ≤ target ≤ 10^4`.

**Hint.** Build `dp[i][t]`. After confirming `dp[n][target]`, walk from `i = n` down: if `dp[i-1][t]` is already true, item `i-1` was skipped; else it was taken — record it and set `t -= nums[i-1]`.

**Reference oracle (Python).**
```python
def brute_subset(nums, target):
    n = len(nums)
    for mask in range(1 << n):
        if sum(nums[i] for i in range(n) if mask & (1 << i)) == target:
            return [i for i in range(n) if mask & (1 << i)]
    return None
```

**Evaluation criteria.**
- Returned indices' values sum to `target`.
- Returns "none" exactly when no subset exists.
- Reconstruction is `O(n)` after the `O(n·target)` table.

---

### Task 7 — Bitset-accelerated subset-sum

**Problem.** Decide subset-sum to `target` using a big-integer bitset: `B |= B << v`, then test bit `target`. Compare wall-clock time against the boolean-array DP on a large `target`.

**Constraints.** `1 ≤ n ≤ 2000`, `0 ≤ target ≤ 10^6`.

**Hint.** Initialize `B = 1`. Optionally mask `B` to `target+1` bits after each shift to bound memory. Use `BigInteger` (Java), `math/big.Int` (Go), Python `int`.

**Evaluation criteria.**
- Matches the boolean-array DP decision exactly.
- Bit `target` of `B` is the answer.
- Measurably faster than the explicit loop for large `target` (report the speedup).

---

### Task 8 — Subset-sum with a cardinality constraint

**Problem.** Decide whether **exactly `m`** items sum to `target` (a count constraint on top of the sum). Use a 2D DP `dp[c][t]` (using exactly `c` items, summing to `t`).

**Constraints.** `1 ≤ n ≤ 300`, `0 ≤ m ≤ n`, `0 ≤ target ≤ 10^4`.

**Hint.** This is NOT plain subset-sum. Add a cardinality dimension: `dp[c][t] |= dp[c-1][t-v]` (take item `v` as the `c`-th). Seed `dp[0][0] = true`. Scan both `c` and `t` downward for the 1D-compressed version.

**Reference oracle (Python).**
```python
def brute_exact_m(nums, m, target):
    from itertools import combinations
    for combo in combinations(nums, m):
        if sum(combo) == target:
            return True
    return False
```

**Evaluation criteria.**
- Distinguishes "any subset" from "exactly `m` items".
- Matches `brute_exact_m` for small `n`.
- `O(n·m·target)`.

---

### Task 9 — Minimum-difference partition with reconstruction

**Problem.** For min-difference partition, output BOTH the minimum difference AND the two subsets (by index). Use subset-sum to `S/2` with reconstruction.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ nums[i] ≤ 1000`.

**Hint.** Find `s*` (largest reachable `≤ S/2`) via the 2D table, reconstruct the subset summing to `s*`; the rest is the other half. Difference `= S − 2·s*`.

**Evaluation criteria.**
- The two reported subsets are a true partition (disjoint, cover all items).
- Their sum difference equals the reported minimum.
- Matches brute force for small `n`.

---

### Task 10 — Meet-in-the-middle subset-sum

**Problem.** Decide subset-sum to `target` for `n ≤ 40` but `target` up to `10^{14}` (table-DP infeasible). Use meet-in-the-middle: enumerate both halves' sums, sort one, binary-search complements.

**Constraints.** `1 ≤ n ≤ 40`, `0 ≤ target ≤ 10^{14}`, values up to `10^{12}`.

**Hint.** Split into halves of `~n/2`. Generate all `2^{n/2}` subset sums of each. For each left sum `sL`, binary-search the right list for `target − sL`. `O(2^{n/2} n)`, independent of `target`. (See sibling `15-divide-and-conquer/06`.)

**Reference oracle (Python).**
```python
def brute_subset_sum(nums, target):
    n = len(nums)
    for mask in range(1 << n):
        if sum(nums[i] for i in range(n) if mask & (1 << i)) == target:
            return True
    return False
```

**Evaluation criteria.**
- Returns the correct decision for huge `target` where the DP can't allocate a table.
- Matches `brute_subset_sum` for `n ≤ 20`.
- `O(2^{n/2} n)` time; no structure of size `target` allocated.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact subset count across two primes

**Problem.** Count subsets summing to `target` when the true count may exceed `10^9 + 7`. Run the counting DP under two coprime primes (`10^9 + 7` and `998244353`) and reconstruct the exact value below their product via CRT.

**Constraints.** `1 ≤ n ≤ 60`, `0 ≤ target ≤ 10^5`. Guarantee the true count `< p₁·p₂`.

**Hint.** Run the identical counting DP twice (once per prime), then apply two-prime CRT. The runs are independent and parallelizable.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- Recovers counts larger than a single prime for small `n` where the true count is known.
- Both modular runs equal `(true count) mod pᵢ`.
- `crt2` output matches the exact count when below `p₁·p₂`.

---

### Task 12 — Partition into k equal subsets (bitmask)

**Problem.** Decide whether `nums` can be split into `k` subsets each summing to `S/k`. Use bitmask DP (or backtracking with pruning) over the set of used items.

**Constraints.** `1 ≤ n ≤ 16`, `1 ≤ k ≤ n`, `1 ≤ nums[i] ≤ 10^4`.

**Hint.** Reject if `S % k != 0` or `max > S/k`. `dp[mask]` = current bucket fill (mod `target`) using items in `mask`; add an unused item that fits, roll to a new bucket at `target`. This is the bitmask method of **sibling topic `06`** — `O(2ⁿ n)`.

**Reference oracle (Python).**
```python
def brute_k_partition(nums, k):
    S = sum(nums)
    if S % k != 0:
        return False
    target = S // k
    buckets = [0] * k
    nums.sort(reverse=True)
    def dfs(i):
        if i == len(nums):
            return all(b == target for b in buckets)
        for j in range(k):
            if buckets[j] + nums[i] <= target:
                buckets[j] += nums[i]
                if dfs(i + 1):
                    return True
                buckets[j] -= nums[i]
                if buckets[j] == 0:
                    break
        return False
    return dfs(0)
```

**Evaluation criteria.**
- Rejects `S % k != 0` and `max > target` up front.
- Matches `brute_k_partition` for `n ≤ 12`.
- Documents that `k`-way partition is NP-hard (not pseudo-polynomial like two-way).

---

### Task 13 — Linear-space subset reconstruction (Hirschberg)

**Problem.** Reconstruct a subset summing to `target` using only `O(target)` extra memory (not the full `O(n·target)` 2D table). Use a divide-and-conquer recursion on item halves around a midpoint sum split.

**Constraints.** `1 ≤ n ≤ 5000`, `0 ≤ target ≤ 10^5`.

**Hint.** Compute forward reachable sums for the first half and backward reachable sums for the second; find a split sum `sL + sR = target`; recurse into each half. `O(n·target)` time, `O(target)` space — the same idea as linear-space LCS.

**Evaluation criteria.**
- Peak extra memory is `O(target)`, not `O(n·target)`.
- The returned subset sums to `target`.
- Matches the 2D-table reconstruction's existence decision.

---

### Task 14 — FPTAS for largest subset sum ≤ T

**Problem.** When both `n` and values are large, exact subset-sum is intractable. Implement the trimming FPTAS that returns a subset sum `s ≤ T` with `s ≥ (1 − ε)·OPT`.

**Constraints.** `1 ≤ n ≤ 1000`, `T` up to `10^{12}`, `0 < ε ≤ 0.5`.

**Hint.** Maintain a sorted list of reachable sums `≤ T`. After adding each item, **trim**: drop any sum within a `(1 + ε/(2n))` factor of a smaller retained sum. The list stays size `O((n/ε)·log T)`.

**Evaluation criteria.**
- Returned sum is `≤ T` and `≥ (1 − ε)·OPT` (compare against exact MITM on small instances).
- List size stays polynomial in `n/ε`.
- Larger `ε` runs faster with looser approximation.

---

### Task 15 — Decide which subset-sum technique applies

**Problem.** Given a problem's parameters `(n, valueBound, queryType)`, return one of `BOOLEAN_DP`, `BITSET_DP`, `MEET_IN_MIDDLE`, `K_PARTITION_BITMASK`, `FPTAS`, or `INTRACTABLE`, and justify each. Implement `classify(...)` or write a short analysis.

**Constraints / cases to handle.**
- Moderate `T`, decision → `BOOLEAN_DP` (or `BITSET_DP` if `T` large but `< ~10^7`).
- Huge `T`, `n ≤ 40`, decision → `MEET_IN_MIDDLE`.
- `k > 2` equal groups → `K_PARTITION_BITMASK`.
- Both `n` and values large, optimization → `FPTAS`.
- Size-constrained 3-partition with large values → `INTRACTABLE` (strongly NP-hard).

**Hint.** Encode the decision rules from `senior.md` and `professional.md`. The gate is **value magnitude vs `n`**, not `n` alone.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The `INTRACTABLE` branch cites strong NP-completeness of size-constrained partition.
- Justification references the right complexity (`O(n·T)`, `O(n·T/64)`, `O(2^{n/2} n)`, `O(2ⁿ n)`, `O(n²/ε)`).

---

## Benchmark Task

### Task B — Boolean array DP vs bitset DP crossover

**Problem.** Empirically measure the speedup of the bitset DP over the boolean-array DP for subset-sum decision. Implement two workloads on a random array (fixed seed):

- **(a) Boolean-array DP:** `for v: for t=T..v: dp[t] |= dp[t-v]` — `O(n·T)`.
- **(b) Bitset DP:** `for v: B |= B << v` — `O(n·T / 64)`.

Measure wall-clock for `n = 1000` across `T ∈ {10^3, 10^4, 10^5, 10^6}`. Report a table and the measured speedup factor.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_array(n: int, hi: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(1, hi) for _ in range(n)]


def boolean_dp(nums, target) -> bool:
    # TODO: dp[0]=True; downward scan
    return False


def bitset_dp(nums, target) -> bool:
    # TODO: B=1; B |= B << v; test bit target
    return False


def bench(fn, nums, target) -> float:
    start = time.perf_counter()
    fn(nums, target)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    n = 1000
    print("T           boolean_ms      bitset_ms       speedup")
    for T in [1_000, 10_000, 100_000, 1_000_000]:
        nums = gen_array(n, max(1, T // n), 42)
        ra = [bench(boolean_dp, nums, T) for _ in range(3)]
        rb = [bench(bitset_dp, nums, T) for _ in range(3)]
        a, b = mean_ms(ra), mean_ms(rb)
        print(f"{T:<11d} {a:<15.2f} {b:<15.2f} {a / max(b, 1e-9):<.1f}x")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- Bitset DP (b) is consistently faster, approaching a ~64× speedup as `T` grows.
- Both produce identical decisions.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on the measured speedup vs the theoretical `w = 64` factor and where overhead erodes it.

---

### Task B2 — GCD compression and parity gating

**Problem.** Wrap the subset-sum decision with two cheap preprocessing steps and measure how often they short-circuit on random inputs:

- **Parity gate (partition):** reject odd totals before any DP.
- **GCD compression:** if `g = gcd(values)` divides the target, divide everything by `g` to shrink the table by a factor `g`; if it does not divide the target, return `false` immediately.

Measure, over 1000 random instances, the fraction resolved or shrunk by each step, and the table-width reduction from GCD compression.

**Constraints.** `1 ≤ n ≤ 1000`, values drawn from various ranges (small, large, all-even, common-factor).

**Hint.** `g = gcd(a₁,…,aₙ)`; reachable sums are all multiples of `g`. Compress with `nums[i] //= g`, `target //= g`.

**Evaluation criteria.**
- Parity gate rejects exactly the odd-total partition instances.
- GCD compression shrinks the table by the measured factor `g` with identical decisions.
- For `gcd = 1` inputs, compression is a no-op (correctly does nothing).
- Report the fraction of instances each preprocessing step resolves or shrinks.

---

## General Guidance for All Tasks

- **Always validate against the brute-force `2ⁿ` oracle first.** Every decision/count task ships with (or references) a slow enumeration oracle. Run it on small `n`, diff, and only then trust the DP on large inputs.
- **Pin the modulus and `INF`/word constants as named constants.** Use `MOD = 10^9 + 7`; never inline magic numbers.
- **Seed the base case.** `dp[0] = true` (decision) / `cnt[0] = 1` (count). The most common bug is a dead table from a missing base case.
- **Scan `t` downward** (`T` down to `v`) in the 1D array — upward reuses each item (unbounded knapsack).
- **Check value magnitude before reaching for the DP.** `O(n·T)` is pseudo-polynomial; huge `T` needs MITM (small `n`) or the FPTAS (both large).
- **Use 64-bit accumulators** for totals and counts; reduce counts mod `p` every step.
- **Never use two-way subset-sum for `k > 2`.** `k`-equal partition is bitmask DP / scheduling (topic `06`), strongly NP-hard in the size-constrained case.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.

---

## Difficulty Map

| Task | Topic | Core technique | Complexity |
|------|-------|----------------|-----------|
| 1 | subset-sum decision | 1D boolean DP, downward scan | `O(n·T)` |
| 2 | equal partition | subset-sum to `S/2` + parity gate | `O(n·S)` |
| 3 | count subsets | integer DP `cnt[t] += cnt[t-v]` | `O(n·T)` |
| 4 | min-difference | complement trick `S − 2s*` | `O(n·S)` |
| 5 | Target Sum | count to `(S+target)/2` | `O(n·S)` |
| 6 | reconstruction | 2D table + backward walk | `O(n·T)` |
| 7 | bitset acceleration | `B |= B << v` | `O(n·T/64)` |
| 8 | cardinality constraint | 2D `dp[c][t]` | `O(n·m·T)` |
| 9 | min-diff + reconstruct | DP + Hirschberg/2D | `O(n·S)` |
| 10 | meet-in-the-middle | half enumeration + search | `O(2^{n/2} n)` |
| 11 | exact via CRT | multi-prime counting | `O(n·T)` per prime |
| 12 | `k`-equal partition | bitmask DP (topic 06) | `O(2ⁿ n)` |
| 13 | linear-space reconstruct | Hirschberg recursion | `O(n·T)` time, `O(T)` space |
| 14 | FPTAS | reachable-sum trimming | `O(n²/ε)` |
| 15 | technique classifier | decision rules | — |
| B / B2 | benchmarks | bitset speedup, preprocessing | — |

Work them roughly in order: 1–5 cement the core table and its variants, 6–10 add reconstruction and the large-`T` escape, 11–15 reach production-grade exactness, scale, and judgement.
