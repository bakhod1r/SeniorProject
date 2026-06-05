# Subset Sum and Partition DP — Middle Level

> **Focus:** Beyond "can we?", the same table answers "how many?", "how balanced can the split be?", and "into `k` equal groups?". Plus the `std::bitset` / big-integer speedup that runs the boolean DP at `O(n·T / w)`, when meet-in-the-middle wins instead, and how to recover the actual chosen items.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Counting Subsets with a Given Sum](#counting-subsets-with-a-given-sum)
4. [Minimum-Difference Partition](#minimum-difference-partition)
5. [Partition into k Equal Subsets](#partition-into-k-equal-subsets)
6. [The Bitset Speedup](#the-bitset-speedup)
7. [Meet-in-the-Middle for Large T](#meet-in-the-middle-for-large-t)
8. [Reconstructing the Chosen Subset](#reconstructing-the-chosen-subset)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: `dp[t]` decides whether a subset sums to `t`, and equal-partition is just subset-sum to `S/2`. At middle level you start asking the questions that decide whether your solution is *correct, fast, and complete*:

- How do I count *how many* subsets reach `T`, not just whether one does?
- How do I find the split that **minimizes** `|S1 − S2|` when no exact half exists?
- How do I partition into **`k`** equal groups, not just two?
- How do I make the boolean DP **64× faster** with bitsets?
- When is the target `T` so large that `O(n·T)` dies, and **meet-in-the-middle** becomes the right tool?
- How do I recover **which items** were chosen, not just that a subset exists?

These are the questions that separate "I memorized the partition trick" from "I can pick the right subset-sum variant for the problem in front of me."

---

## Deeper Concepts

### The reachable-sums recurrence, restated

Let `dp_i[t]` be `true` iff a subset of the first `i` items sums to `t`. Then:

```
dp_0[t] = [t == 0]                       (only the empty subset, summing to 0)
dp_i[t] = dp_{i-1}[t]  OR  dp_{i-1}[t - aᵢ]   (skip item i, or take it)
```

Compressing the first index away gives the 1D array, *provided* we iterate `t` downward so `dp[t - aᵢ]` still holds the `dp_{i-1}` value. This single recurrence — with `OR` replaced by `+`, `min`, or other operators — generalizes to every variant below.

### One table, several questions

| Replace the cell type / operator | Question answered |
|----------------------------------|-------------------|
| boolean, `OR` | Is `t` reachable? (decision) |
| integer count, `+` | How many subsets sum to `t`? |
| boolean, then scan reachable sums | Which split minimizes `|S1 − S2|`? |
| bitset (1 bit per `t`), `OR` via shift | Decision, 64× faster |
| bitmask over items + DFS/DP | Partition into `k` equal groups |

The structure — "skip or take, accumulate over items" — never changes; only what we store in each cell and how we combine does.

### The complement trick for partition

If a subset `A` sums to `sA`, its complement sums to `S − sA`. So the two-way split difference is `|sA − (S − sA)| = |S − 2·sA|`. Minimizing this over all reachable `sA` is the heart of the **minimum-difference partition** (Section 4). Equal partition is the special case where some reachable `sA = S/2` makes the difference `0`.

---

## Counting Subsets with a Given Sum

Swap the boolean for an integer count and `OR` for `+`. Let `cnt[t]` = number of subsets summing to `t`.

```
cnt[0] = 1                                 (the empty subset)
for each item v:
    for t = T down to v:
        cnt[t] += cnt[t - v]               (mod p if asked)
```

The base `cnt[0] = 1` counts the empty subset. Each item either is left out (the count for `t` is unchanged) or is included (adds `cnt[t - v]` ways). The downward scan again ensures each item is used at most once. Counts can grow exponentially, so problems usually ask for the answer **modulo a prime** like `10^9 + 7`; reduce after each `+=`.

> **Note on duplicates and zeros.** If the array contains zeros, each `0` *doubles* the count of every reachable sum (it can be in or out without changing the sum). The integer DP handles this automatically; the boolean DP ignores it. Be deliberate about whether the empty subset should be counted.

This counting DP also underlies the classic **"Target Sum"** problem (assign `+`/`−` to each element to hit a target) — which reduces to counting subsets with a particular sum, shown in `interview.md`.

---

## Minimum-Difference Partition

When the array cannot be split exactly in half, we want the split minimizing `|S1 − S2|`. Using the complement trick, run subset-sum up to `S/2`, then find the **largest reachable sum `sA ≤ S/2`**. The best difference is `S − 2·sA`.

```
S = sum(nums)
run boolean subset-sum dp[0..S/2]
best = S
for sA = S/2 down to 0:
    if dp[sA]:
        best = S - 2*sA
        break            # first reachable sA from the top is the closest to S/2
return best
```

Because `sA` and `S − sA` straddle `S/2`, the reachable sum closest to `S/2` (from below) gives the most balanced partition. The whole thing is one subset-sum pass plus a linear scan — `O(n·S)` time, `O(S)` space. (This is LeetCode "Last Stone Weight II" / "Minimum Subset Sum Difference".)

---

## Partition into k Equal Subsets

Splitting into `k` groups of equal sum is genuinely harder than two-way. First the cheap rejections:

- If `S % k != 0`, impossible → `false`.
- Let `target = S / k`. If any single element exceeds `target`, impossible.

Then we must actually *assign* elements to `k` buckets, each filling to `target`. The standard approach is **bitmask DP / backtracking** over which elements are used:

- **Bitmask DP:** `dp[mask]` = the remainder (`current bucket fill mod target`) achievable using exactly the elements in `mask`. Transition by adding an unused element if it doesn't overflow the current bucket; when a bucket hits `target`, it rolls over to the next. `O(2ⁿ · n)` time, `O(2ⁿ)` space — feasible for `n ≤ ~16–20`.
- **Backtracking with pruning:** sort descending, try to fill `k` buckets greedily with strong pruning (skip duplicates, fail fast if the largest remaining can't fit). Often much faster in practice despite the same worst case.

This `k`-way variant is covered in depth in **sibling topic `06-partition-k-equal-subsets`** — the bitmask state, the rollover transition, and the pruning heuristics all live there. The pointer matters: two-way partition is pseudo-polynomial subset-sum; `k`-way is exponential-in-`n` bitmask DP.

```
canPartitionKSubsets(nums, k):
    S = sum(nums)
    if S % k != 0: return false
    target = S / k
    if max(nums) > target: return false
    # bitmask DP or backtracking over assignments  (see topic 06)
    ...
```

---

## The Bitset Speedup

The boolean subset-sum DP has a beautiful acceleration. Represent the whole `dp` array as the **bits of one big integer** `B`: bit `t` of `B` is `1` iff sum `t` is reachable. Then taking an item `v` is a single operation:

```
B |= (B << v)
```

Shifting `B` left by `v` moves every reachable sum `t` to position `t + v`; OR-ing back in means "every old sum, plus every old-sum-plus-`v`." This processes **64 sums per machine word per instruction**, turning the `O(n·T)` inner loop into `O(n·T / w)` where `w` is the word width (64). In C++ this is `std::bitset<T+1>`; in Python, Java, Go you use a big-integer (`int`, `BigInteger`, `math/big.Int`). Initialize `B = 1` (only bit 0 set — the empty subset).

```python
def subset_sum_bitset(nums, target):
    B = 1                      # bit 0 set: sum 0 reachable
    for v in nums:
        B |= B << v
    return (B >> target) & 1   # is bit `target` set?
```

The constant-factor win is real and large — for `T` in the hundreds of thousands, the bitset version is the difference between feasible and not. (For equal-partition you can even mask `B` to `target+1` bits after each shift to bound memory.)

---

## Meet-in-the-Middle for Large T

When `T` is **huge** (say up to `10^14`) but `n` is **small** (say `n ≤ 40`), `O(n·T)` is hopeless — the table is far too wide. The right tool is **meet-in-the-middle**:

1. Split the array into two halves of `~n/2` items each.
2. Enumerate **all** `2^{n/2}` subset sums of the left half into a sorted list `L`, and all `2^{n/2}` of the right half into `R`.
3. For each sum `sL ∈ L`, binary-search `R` for `T − sL`. If found, a subset summing to `T` exists.

This costs `O(2^{n/2} · n)` time and `O(2^{n/2})` space — independent of `T`. For `n = 40`, `2^{20} ≈ 10^6` per half: easily feasible, whereas `T = 10^{14}` would need a table of `10^{14}` cells. The full divide-and-conquer treatment (and the "two-pointer over both sorted halves" refinement for closest-sum variants) lives in **sibling topic `15-divide-and-conquer/06`**.

**Rule of thumb:** small `n`, huge `T` → meet-in-the-middle; moderate `T`, larger `n` → the `O(n·T)` DP (bitset-accelerated).

### Worked MITM trace

`nums = [3, 34, 4, 12]`, `target = 38`. Split into `L = [3, 34]`, `R = [4, 12]`.

- `Σ_L = {0, 3, 34, 37}`
- `Σ_R = {0, 4, 12, 16}` (sorted)

For each `sL ∈ Σ_L`, search `Σ_R` for `38 − sL`:
- `sL = 0` → need `38`: not in `Σ_R`.
- `sL = 3` → need `35`: not in `Σ_R`.
- `sL = 34` → need `4`: **found** (`{4}`). So `{34, 4}` sums to `38`. 

We never built a width-`38` table per se, but more importantly the method is `O(2^{n/2})` regardless of how large `target` is — if `target` were `38_000_000_000` the trace is identical, just different numbers. That value-independence is the whole point.

---

## Reconstructing the Chosen Subset

The boolean/count DP says *whether*/`how many*; to recover *which items*, keep enough history to walk backward.

**Option A — 2D table.** Store `dp[i][t]` for all `i`. After confirming `dp[n][T]`, walk from `i = n` down: if `dp[i-1][T]` is already `true`, item `i-1` was *not needed* (skip it); otherwise item `i-1` *was* taken, so record it and set `T -= nums[i-1]`.

**Option B — parent pointers on the 1D array.** Track, for each reachable sum, the item that first reached it. Lighter than the full 2D table but trickier to get right with the downward scan.

```python
def subset_with_sum(nums, target):
    n = len(nums)
    dp = [[False] * (target + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = True
    for i in range(1, n + 1):
        v = nums[i - 1]
        for t in range(target + 1):
            dp[i][t] = dp[i - 1][t] or (t >= v and dp[i - 1][t - v])
    if not dp[n][target]:
        return None
    chosen, t = [], target
    for i in range(n, 0, -1):
        if not dp[i - 1][t]:            # item i-1 was necessary
            chosen.append(nums[i - 1])
            t -= nums[i - 1]
    return chosen[::-1]
```

Reconstruction costs `O(n·T)` space for the 2D table and `O(n)` for the backward walk.

### Worked reconstruction trace

For `nums = [1, 5, 11, 5]`, `target = 11`: after building `dp[i][t]`, we have `dp[4][11] = true`. Walk backward:

- `i = 4` (item `5`): is `dp[3][11]` true? Yes (subset `{11}` from the first three items). So item `5` (index 3) was **not** needed — skip it.
- `i = 3` (item `11`): is `dp[2][11]` true? No (`{1,5}` can't reach `11`). So item `11` **was** taken — record it, `t = 11 - 11 = 0`.
- `i = 2` (item `5`): is `dp[1][0]` true? Yes (empty subset). Skip.
- `i = 1` (item `1`): is `dp[0][0]` true? Yes. Skip.

Recovered subset: `{11}`. Its complement `{1, 5, 5}` also sums to `11` — the equal partition. The backward walk is deterministic: at each step, "did the sum stay reachable without this item?" decides skip vs take.

---

## Code Examples

### Counting subsets that sum to T (mod p), in three languages

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func countSubsets(nums []int, target int) int64 {
	cnt := make([]int64, target+1)
	cnt[0] = 1 // empty subset
	for _, v := range nums {
		for t := target; t >= v; t-- {
			cnt[t] = (cnt[t] + cnt[t-v]) % MOD
		}
	}
	return cnt[target]
}

func main() {
	fmt.Println(countSubsets([]int{1, 1, 2, 3}, 4)) // subsets summing to 4
}
```

#### Java

```java
public class CountSubsets {
    static final long MOD = 1_000_000_007L;

    static long countSubsets(int[] nums, int target) {
        long[] cnt = new long[target + 1];
        cnt[0] = 1; // empty subset
        for (int v : nums) {
            for (int t = target; t >= v; t--) {
                cnt[t] = (cnt[t] + cnt[t - v]) % MOD;
            }
        }
        return cnt[target];
    }

    public static void main(String[] args) {
        System.out.println(countSubsets(new int[]{1, 1, 2, 3}, 4));
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def count_subsets(nums, target):
    cnt = [0] * (target + 1)
    cnt[0] = 1                      # empty subset
    for v in nums:
        for t in range(target, v - 1, -1):
            cnt[t] = (cnt[t] + cnt[t - v]) % MOD
    return cnt[target]


if __name__ == "__main__":
    print(count_subsets([1, 1, 2, 3], 4))
```

### Minimum subset-sum difference, in three languages

#### Go

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

#### Java

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

#### Python

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

### Bitset subset-sum decision (big-integer), in three languages

#### Go

```go
package main

import (
	"fmt"
	"math/big"
)

func subsetSumBitset(nums []int, target int) bool {
	B := big.NewInt(1) // bit 0 set: sum 0 reachable
	for _, v := range nums {
		shifted := new(big.Int).Lsh(B, uint(v))
		B.Or(B, shifted)
	}
	return B.Bit(target) == 1
}

func main() {
	fmt.Println(subsetSumBitset([]int{1, 5, 11, 5}, 11)) // true
}
```

#### Java

```java
import java.math.BigInteger;

public class SubsetSumBitset {
    static boolean subsetSumBitset(int[] nums, int target) {
        BigInteger B = BigInteger.ONE; // bit 0 set
        for (int v : nums) {
            B = B.or(B.shiftLeft(v));
        }
        return B.testBit(target);
    }

    public static void main(String[] args) {
        System.out.println(subsetSumBitset(new int[]{1, 5, 11, 5}, 11)); // true
    }
}
```

#### Python

```python
def subset_sum_bitset(nums, target):
    B = 1                       # bit 0 set: sum 0 reachable
    for v in nums:
        B |= B << v
    return (B >> target) & 1 == 1


if __name__ == "__main__":
    print(subset_sum_bitset([1, 5, 11, 5], 11))  # True
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Counting overflows | Subset counts grow exponentially. | Reduce mod `p` after each `+=`; use 64-bit. |
| Min-diff returns total always | Forgot `dp[0] = true`, so no `sA` is reachable. | Seed the empty subset. |
| `k`-partition false positive | Used two-way subset-sum for `k > 2`. | Use bitmask DP / backtracking (topic `06`). |
| Bitset uses too much memory | Big integer grows to `S` bits unbounded. | Mask `B` to `target+1` bits after each shift. |
| MITM too slow | Used it when `T` is moderate, not `n` small. | MITM only for small `n`, huge `T`. |
| Zeros double the count silently | `0` can be in or out. | Decide whether zeros/empty subset should count. |
| Reconstruction wrong with 1D array | Backward walk needs per-item history. | Use the 2D table for reconstruction. |

---

## Performance Analysis

| Variant | Time | Space | Best when |
|---------|------|-------|-----------|
| Boolean decision (1D) | `O(n·T)` | `O(T)` | moderate `T` |
| Boolean decision (bitset) | `O(n·T / 64)` | `O(T / 64)` | moderate-to-large `T`, decision only |
| Counting subsets | `O(n·T)` | `O(T)` | "how many" questions |
| Min-difference partition | `O(n·S)` | `O(S)` | balanced split |
| `k`-equal partition (bitmask) | `O(2ⁿ · n)` | `O(2ⁿ)` | `n ≤ ~20`, small `k` |
| Meet-in-the-middle | `O(2^{n/2} · n)` | `O(2^{n/2})` | `n ≤ ~40`, huge `T` |
| Reconstruction (2D) | `O(n·T)` | `O(n·T)` | need the actual items |

```text
Decision rule by (n, T):
  T moderate (≤ ~10^6)          -> O(n·T) DP, bitset-accelerated
  T huge, n ≤ ~40               -> meet-in-the-middle  (15-divide-and-conquer/06)
  need k equal groups           -> bitmask DP / backtracking (topic 06)
  need count / min-diff         -> integer / boolean DP variant above
```

The single biggest constant-factor win for the *decision* problem is the bitset trick: a 64× speedup with almost no code. The single biggest *asymptotic* decision is `n` vs `T` — it picks DP versus meet-in-the-middle.

---

## Best Practices

- **Pick the variant by the question:** decision → boolean; "how many" → integer count; balanced split → min-difference scan; `k` groups → bitmask (topic `06`).
- **Reach for the bitset** whenever you only need the decision and `T` is large — it is almost free.
- **Switch to meet-in-the-middle** the moment `T` is huge and `n` is small; never try to allocate a `10^{14}`-wide table.
- **Reduce counts mod `p`** consistently and use 64-bit accumulators.
- **Reuse the core `subset_sum`/`count_subsets` routine**; partition, target-sum, and min-difference all build on it.
- **Test every variant against brute force** on random small arrays.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The boolean `dp` row filling item by item, with newly reachable sums lighting up
> - The `dp[t] |= dp[t-v]` shift-and-OR shown as the bitset operation `B |= B << v`
> - The partition target `S/2` (or the closest reachable sum for min-difference) highlighted in green
> - Step / Run / Reset to watch each item unlock new sums

---

## Summary

The boolean subset-sum table is a chassis you can re-skin. Swap the cell to an integer and `OR` to `+` and you **count** subsets summing to `T`. Use the complement trick (`|S − 2·sA|`) and scan reachable sums to find the **minimum-difference** partition. Pack the table into the bits of one big integer and `B |= B << v` runs the decision at `O(n·T / w)` — a 64× win. When `T` is huge but `n` small, abandon the table entirely for **meet-in-the-middle** (`15-divide-and-conquer/06`). When you need `k` equal groups rather than two, it becomes a **bitmask DP** (sibling topic `06`). And to recover *which* items, keep a 2D table and walk backward. Master these five re-skins and one piece of DP machinery solves a whole family of partition and subset-sum problems.

---

## Further Reading

- LeetCode 416 "Partition Equal Subset Sum", 494 "Target Sum", 1049 "Last Stone Weight II" (min-difference), 698 "Partition to K Equal Sum Subsets".
- Sibling topic `06-partition-k-equal-subsets` — the bitmask `k`-way generalization in depth.
- Sibling topic `15-divide-and-conquer/06` — meet-in-the-middle for huge `T`, small `n`.
- cp-algorithms.com — "Knapsack" and the `std::bitset` subset-sum acceleration.
- `professional.md` (this topic) — the generating-function view `Π(1 + x^{aᵢ})` and the NP-completeness / pseudo-polynomial proof.
