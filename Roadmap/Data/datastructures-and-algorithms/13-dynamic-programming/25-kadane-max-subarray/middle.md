# Kadane's Algorithm / Maximum Subarray — Middle Level

> **Focus:** Going beyond the one-line recurrence — reconstructing the winning subarray's indices, the maximum-*product* variant (where signs make you track both a running min and max), the circular wrap-around version, the 2D maximum-sum submatrix via Kadane over column sums, and the `O(n log n)` divide-and-conquer alternative as a contrast.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Index Reconstruction](#index-reconstruction)
4. [Maximum-Product Subarray](#maximum-product-subarray)
5. [Circular Maximum Subarray](#circular-maximum-subarray)
6. [2D Maximum-Sum Submatrix](#2d-maximum-sum-submatrix)
7. [Divide-and-Conquer Contrast](#divide-and-conquer-contrast)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: `bestEndingHere = max(a[i], bestEndingHere + a[i])`, track the global maximum, and watch the all-negative initialization. At middle level you start asking the questions that turn "I can compute the sum" into "I can solve the whole family":

- The interviewer says *"great, now give me the start and end indices, not just the sum."* How do you reconstruct without a second pass?
- What changes when the operation is **product** instead of sum? (Hint: two negatives make a positive, so the smallest running value can suddenly become the largest.)
- The array is **circular** — the best subarray may wrap from the end back to the front. How do you handle the wrap in `O(n)`?
- The input is a **2D grid** and you want the best rectangular submatrix. Can Kadane's help?
- There is an elegant `O(n log n)` **divide-and-conquer** solution in CLRS — why is it slower than Kadane's, and what does it teach?

These are the variations that separate "I memorized Kadane's" from "I understand the running-best recurrence well enough to bend it."

---

## Deeper Concepts

### The recurrence, restated as DP

Let `f(i)` be the maximum sum of a subarray ending at index `i`. Then:

```
f(0) = a[0]
f(i) = max( a[i], f(i-1) + a[i] )     for i ≥ 1
answer = max over i of f(i)
```

This is a textbook 1D dynamic program with **optimal substructure** (the best run ending at `i` is built from the best run ending at `i-1`) and a constant-size state (only `f(i-1)` matters). The space collapses to two scalars. Every variant below is a twist on this same skeleton: change the operator, change the domain (circular, 2D), or add bookkeeping (indices).

### Why a negative prefix is discarded

If `f(i-1) < 0`, then `f(i-1) + a[i] < a[i]`, so the recurrence picks `a[i]` — it *restarts the run*. This is the formal version of "never carry a losing prefix forward." That restart point is exactly where the optimal subarray begins, which is the key to reconstruction.

---

## Index Reconstruction

To recover the actual subarray `a[l..r]`, not just its sum, track a **candidate start** index that resets every time the run restarts:

- Maintain `start` = the index where the current run began.
- When the recurrence *restarts* (chooses `a[i]` over `bestEndingHere + a[i]`), set `start = i`.
- Whenever `bestEndingHere` beats `bestSoFar`, record `bestL = start`, `bestR = i`.

The subtlety: update `bestL/bestR` **only** when you set a new global best, and use the `start` *as it is at that moment*. This yields the leftmost-then-earliest optimal subarray on ties (you can adjust tie-breaking by using `≥` vs `>`).

```python
def max_subarray_with_indices(a):
    best_ending_here = a[0]
    best_so_far = a[0]
    start = 0
    best_l, best_r = 0, 0
    for i in range(1, len(a)):
        if a[i] > best_ending_here + a[i]:
            best_ending_here = a[i]
            start = i               # restart: new candidate start
        else:
            best_ending_here = best_ending_here + a[i]
        if best_ending_here > best_so_far:
            best_so_far = best_ending_here
            best_l, best_r = start, i
    return best_so_far, best_l, best_r
```

On `a = [-2, 1, -3, 4, -1, 2, 1, -5, 4]` this returns `(6, 3, 6)` — sum `6`, indices `3..6`, exactly the subarray `[4, -1, 2, 1]`.

**Tie-breaking note.** Using strict `>` for the global-best update (as above) records the *first* endpoint that attains the maximum and the *latest* restart before it — i.e. the earliest, shortest optimal subarray. If you instead want the longest optimal subarray, or the last one, you adjust the comparison (`≥`) and the start-tracking accordingly. Whatever you choose, *document it*: two correct Kadane implementations can legitimately return different index pairs on a tie, and a downstream consumer comparing them will see a spurious "bug" if the tie-break is unspecified. (The formal characterization is in [`professional.md`](./professional.md) §11b.)

---

## Maximum-Product Subarray

Now the operator is **multiplication**. The naive instinct — "track the running max product" — fails, because a large *negative* product can become the *largest* product the moment it is multiplied by another negative number. Example: `[-2, 3, -4]`. The best product is `(-2)·3·(-4) = 24`, but a max-only sweep would discard the running `-6` after the first two elements and miss it.

**The fix: carry both a running maximum and a running minimum.** When the current element is negative, the roles swap — the smallest (most negative) product becomes the largest after multiplying by a negative.

```
curMax = max(a[i], curMax * a[i], curMin * a[i])
curMin = min(a[i], curMax_old * a[i], curMin_old * a[i])
```

You must compute both from the *old* values, so capture them before overwriting (or swap `curMax`/`curMin` when `a[i] < 0`, then extend). Zeros reset both to `a[i]` naturally, because `max(0, …)`/`min(0, …)` will pick up the standalone element on the next step.

```python
def max_product_subarray(a):
    cur_max = cur_min = best = a[0]
    for i in range(1, len(a)):
        x = a[i]
        if x < 0:
            cur_max, cur_min = cur_min, cur_max   # negative flips the roles
        cur_max = max(x, cur_max * x)
        cur_min = min(x, cur_min * x)
        best = max(best, cur_max)
    return best
```

On `[-2, 3, -4]` this returns `24`; on `[2, 3, -2, 4]` it returns `6` (the prefix `[2, 3]`); on `[-2, 0, -1]` it returns `0` (a zero severs the product). The all-negative and zero-containing cases are exactly where the min-tracking earns its keep.

---

## Circular Maximum Subarray

In a **circular** array the subarray may wrap around: e.g., in `[5, -3, 5]` the best wrap subarray is `a[2], a[0] = 5 + 5 = 10`. There are two cases:

1. **Non-wrapping** — the answer is plain Kadane's `maxSum`.
2. **Wrapping** — the chosen subarray wraps the ends, which means the *complement* (the unchosen middle) is a contiguous subarray with the **minimum** sum. So the best wrapping sum is `total − minSubarraySum`.

The answer is `max(maxSum, total − minSum)`, with **one crucial edge case**: if *all* elements are negative, then `total − minSum` equals `0` (you would have removed everything), which corresponds to the empty subarray — invalid. In that case `maxSum` itself (the least-negative element) is the answer.

```python
def max_circular_subarray(a):
    total = 0
    cur_max = best_max = a[0]
    cur_min = best_min = a[0]
    for i in range(len(a)):
        x = a[i]
        total += x
        if i == 0:
            continue
        cur_max = max(x, cur_max + x)
        best_max = max(best_max, cur_max)
        cur_min = min(x, cur_min + x)
        best_min = min(best_min, cur_min)
    if best_max < 0:                  # all-negative: wrap would be empty
        return best_max
    return max(best_max, total - best_min)
```

On `[5, -3, 5]` → `10`; on `[-3, -2, -3]` → `-2` (the all-negative guard fires); on `[3, -1, 2, -1]` → `4`.

---

## 2D Maximum-Sum Submatrix

Given an `R × C` integer grid, find the rectangular submatrix with the maximum sum. The trick is to **reduce 2D to 1D**: fix a pair of rows `(top, bottom)`, collapse the columns between them into a 1D array of column sums, and run Kadane's on that 1D array. The Kadane answer is the best submatrix whose vertical extent is exactly `top..bottom`. Take the maximum over all `O(R²)` row pairs.

To make the column collapse fast, accumulate column sums incrementally as `bottom` increases, so each `(top, bottom)` pair costs only `O(C)` to update plus `O(C)` for Kadane's:

```
for top in 0 .. R-1:
    colSum = [0] * C
    for bottom in top .. R-1:
        for c in 0 .. C-1:
            colSum[c] += grid[bottom][c]      # extend the band downward
        best = max(best, kadane(colSum))      # 1D Kadane on the band's column sums
```

This is `O(R² · C)` time and `O(C)` space (just the `colSum` band). When `R ≤ C`, fix the dimension with fewer entries on the *outer* loops (transpose if needed) so the squared factor is the smaller side: prefer `O(min(R,C)² · max(R,C))`.

---

## Divide-and-Conquer Contrast

The CLRS divide-and-conquer maximum-subarray splits the array in half and observes that the best subarray is one of three things:

1. entirely in the **left** half,
2. entirely in the **right** half, or
3. **crossing** the midpoint.

Cases 1 and 2 are recursive calls; case 3 is found by scanning left from the mid for the best suffix and right from the mid for the best prefix, then joining them — an `O(n)` merge. The recurrence is `T(n) = 2T(n/2) + O(n)`, giving `O(n log n)`.

```python
def max_subarray_dc(a, lo, hi):
    if lo == hi:
        return a[lo]
    mid = (lo + hi) // 2
    left = max_subarray_dc(a, lo, mid)
    right = max_subarray_dc(a, mid + 1, hi)
    # best suffix ending at mid
    s, best_left = 0, float("-inf")
    for i in range(mid, lo - 1, -1):
        s += a[i]
        best_left = max(best_left, s)
    # best prefix starting at mid+1
    s, best_right = 0, float("-inf")
    for i in range(mid + 1, hi + 1):
        s += a[i]
        best_right = max(best_right, s)
    cross = best_left + best_right
    return max(left, right, cross)
```

**Why is it slower than Kadane's?** It is `O(n log n)` vs Kadane's `O(n)`, and it uses `O(log n)` stack space vs `O(1)`. It is worth knowing for three reasons: (a) it is a classic interview question in its own right, (b) it parallelizes cleanly (the two halves are independent), and (c) it generalizes to segment-tree nodes that store `(total, bestPrefix, bestSuffix, bestSubarray)`, enabling `O(log n)` *range* maximum-subarray queries on a mutable array — something plain Kadane's cannot do.

---

## Comparison with Alternatives

### Approaches to the 1D maximum-subarray problem

| Approach | Time | Space | Good when |
|----------|------|-------|-----------|
| Brute force (all `l, r`, re-sum) | `O(n³)` | `O(1)` | never except as a teaching baseline |
| Brute force + running inner sum / prefix sums | `O(n²)` | `O(1)`/`O(n)` | tiny `n`, or as a test oracle |
| Divide & conquer | `O(n log n)` | `O(log n)` | need parallelism or range queries (segment tree) |
| **Kadane's** | `O(n)` | `O(1)` | the default — single pass, streamable |

### Variant complexities at a glance

| Variant | Method | Time | Space |
|---------|--------|------|-------|
| Max sum + indices | Kadane + start tracking | `O(n)` | `O(1)` |
| Max product | dual min/max Kadane | `O(n)` | `O(1)` |
| Circular max sum | `max(kadane, total − minKadane)` | `O(n)` | `O(1)` |
| 2D max-sum submatrix | row-pair + 1D Kadane | `O(R²·C)` | `O(C)` |
| Range max-subarray queries | segment tree of D&C nodes | `O(log n)`/query, `O(n)` build | `O(n)` |

The lesson: **the plain `O(n)` Kadane's is the default, and most variants keep `O(n)`** by changing the operator or adding a few variables. The 2D version pays an `O(R²)` factor only because there are `O(R²)` row bands to try; each band is still solved by `O(C)` Kadane's.

---

## Code Examples

### Maximum-Product Subarray — Go, Java, Python

#### Go

```go
package main

import "fmt"

func maxProduct(a []int) int {
	curMax, curMin, best := a[0], a[0], a[0]
	for i := 1; i < len(a); i++ {
		x := a[i]
		if x < 0 {
			curMax, curMin = curMin, curMax // negative flips roles
		}
		if x > curMax*x {
			curMax = x
		} else {
			curMax = curMax * x
		}
		if x < curMin*x {
			curMin = x
		} else {
			curMin = curMin * x
		}
		if curMax > best {
			best = curMax
		}
	}
	return best
}

func main() {
	fmt.Println(maxProduct([]int{-2, 3, -4}))   // 24
	fmt.Println(maxProduct([]int{2, 3, -2, 4})) // 6
	fmt.Println(maxProduct([]int{-2, 0, -1}))   // 0
}
```

#### Java

```java
public class MaxProduct {
    static int maxProduct(int[] a) {
        int curMax = a[0], curMin = a[0], best = a[0];
        for (int i = 1; i < a.length; i++) {
            int x = a[i];
            if (x < 0) {                      // negative flips roles
                int tmp = curMax; curMax = curMin; curMin = tmp;
            }
            curMax = Math.max(x, curMax * x);
            curMin = Math.min(x, curMin * x);
            best = Math.max(best, curMax);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxProduct(new int[]{-2, 3, -4}));   // 24
        System.out.println(maxProduct(new int[]{2, 3, -2, 4})); // 6
        System.out.println(maxProduct(new int[]{-2, 0, -1}));   // 0
    }
}
```

#### Python

```python
def max_product(a):
    cur_max = cur_min = best = a[0]
    for i in range(1, len(a)):
        x = a[i]
        if x < 0:
            cur_max, cur_min = cur_min, cur_max  # negative flips roles
        cur_max = max(x, cur_max * x)
        cur_min = min(x, cur_min * x)
        best = max(best, cur_max)
    return best


if __name__ == "__main__":
    print(max_product([-2, 3, -4]))    # 24
    print(max_product([2, 3, -2, 4]))  # 6
    print(max_product([-2, 0, -1]))    # 0
```

### 2D Maximum-Sum Submatrix — Go, Java, Python

#### Go

```go
package main

import "fmt"

func kadane(a []int) int {
	be, best := a[0], a[0]
	for i := 1; i < len(a); i++ {
		if a[i] > be+a[i] {
			be = a[i]
		} else {
			be = be + a[i]
		}
		if be > best {
			best = be
		}
	}
	return best
}

func maxSubmatrix(g [][]int) int {
	R, C := len(g), len(g[0])
	best := g[0][0]
	for top := 0; top < R; top++ {
		colSum := make([]int, C)
		for bottom := top; bottom < R; bottom++ {
			for c := 0; c < C; c++ {
				colSum[c] += g[bottom][c]
			}
			if v := kadane(colSum); v > best {
				best = v
			}
		}
	}
	return best
}

func main() {
	g := [][]int{
		{1, 2, -1, -4, -20},
		{-8, -3, 4, 2, 1},
		{3, 8, 10, 1, 3},
		{-4, -1, 1, 7, -6},
	}
	fmt.Println(maxSubmatrix(g)) // 29
}
```

#### Java

```java
public class MaxSubmatrix {
    static int kadane(int[] a) {
        int be = a[0], best = a[0];
        for (int i = 1; i < a.length; i++) {
            be = Math.max(a[i], be + a[i]);
            best = Math.max(best, be);
        }
        return best;
    }

    static int maxSubmatrix(int[][] g) {
        int R = g.length, C = g[0].length, best = g[0][0];
        for (int top = 0; top < R; top++) {
            int[] colSum = new int[C];
            for (int bottom = top; bottom < R; bottom++) {
                for (int c = 0; c < C; c++) colSum[c] += g[bottom][c];
                best = Math.max(best, kadane(colSum));
            }
        }
        return best;
    }

    public static void main(String[] args) {
        int[][] g = {
            {1, 2, -1, -4, -20},
            {-8, -3, 4, 2, 1},
            {3, 8, 10, 1, 3},
            {-4, -1, 1, 7, -6},
        };
        System.out.println(maxSubmatrix(g)); // 29
    }
}
```

#### Python

```python
def kadane(a):
    be = best = a[0]
    for i in range(1, len(a)):
        be = max(a[i], be + a[i])
        best = max(best, be)
    return best


def max_submatrix(g):
    R, C = len(g), len(g[0])
    best = g[0][0]
    for top in range(R):
        col_sum = [0] * C
        for bottom in range(top, R):
            for c in range(C):
                col_sum[c] += g[bottom][c]
            best = max(best, kadane(col_sum))
    return best


if __name__ == "__main__":
    g = [
        [1, 2, -1, -4, -20],
        [-8, -3, 4, 2, 1],
        [3, 8, 10, 1, 3],
        [-4, -1, 1, 7, -6],
    ]
    print(max_submatrix(g))  # 29
```

The `29` answer is the submatrix spanning rows 1–3, columns 1–3: `[-3,4,2; 8,10,1; -1,1,7]` summing to `29`.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| All-negative array in circular variant | `total − minSum` returns `0` (empty subarray) | Guard: if `bestMax < 0`, return `bestMax`. |
| Product variant, only max tracked | Misses positive products formed from two negatives | Track both `curMin` and `curMax`; swap on negative. |
| Reconstruction off-by-one | Updated indices on every step, not only on new best | Record `bestL/bestR` only when a new global best is set. |
| 2D with empty grid / jagged rows | Index out of range | Validate `R > 0`, `C > 0`, all rows equal length. |
| Overflow in 2D column sums | Band sums exceed 32-bit | Use 64-bit accumulators for `colSum` and Kadane. |
| Product overflow | Repeated multiplication explodes | Use 64-bit; for huge products consider logs or detect overflow. |

---

## Performance Analysis

| Variant | `n` (or `R×C`) | Operations | Practical note |
|---------|----------------|-----------|----------------|
| 1D Kadane | `10^7` | ~`10^7` | well under a second |
| Max product | `10^7` | ~`10^7` (× 2 states) | still linear, tiny constant |
| Circular | `10^7` | ~`2·10^7` (max + min pass) | one combined pass |
| 2D submatrix | `R = C = 300` | `~300² · 300 ≈ 2.7·10^7` | sub-second |
| 2D submatrix | `R = C = 1000` | `~10^9` | seconds; consider transpose so squared factor is smaller side |
| Divide & conquer | `10^7` | `~10^7 · log₂(10^7) ≈ 2.3·10^8` | ~10–20× slower than Kadane |

The 2D method's cost is dominated by the `O(R²)` row-band loop. If the grid is tall and thin (`R ≫ C`), **transpose it** so the squared factor falls on the smaller dimension: cost becomes `O(min(R,C)² · max(R,C))`. The 1D variants are all linear with a small constant; the divide-and-conquer's `log n` factor and recursion overhead make it noticeably slower in practice despite being "elegant."

---

## Best Practices

- **Reuse one tested `kadane`** for sum-based variants (1D, 2D, circular-max half); parameterize the rest around it.
- **For products, never track only the max** — the min/max swap on negatives is the entire correctness argument.
- **For circular, always include the all-negative guard** — it is the only edge case, and it is easy to forget.
- **For 2D, accumulate `colSum` incrementally** as `bottom` grows; do not re-sum the band from scratch (that adds an `O(R)` factor).
- **Transpose tall-thin 2D grids** so the `O(R²)` factor is the smaller dimension.
- **Validate against brute force** on small inputs for every variant before trusting it on large data.
- **Use 64-bit accumulators** for sums and especially products, which overflow fast.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level relevance of the animation:
> - Watch the *restart* moments (when `bestEndingHere` chooses `a[i]` over the extension) — those are exactly the reconstruction start points.
> - The best-so-far window highlight shows the reconstructed `(l, r)` interval forming as the sweep proceeds.
> - The high-water-mark behavior of `bestSoFar` mirrors how the circular and 2D variants reuse the same per-band sweep.

---

## Summary

Kadane's `O(n)` recurrence is the seed for a whole family of problems. **Index reconstruction** adds a candidate-`start` pointer that resets on every restart and is recorded whenever a new global best is set. The **maximum-product** variant must carry *both* a running min and a running max, because multiplying by a negative turns the smallest product into the largest. The **circular** variant computes `max(plainKadane, total − minSubarray)`, with a mandatory guard for the all-negative case (where the wrap would empty the array). The **2D submatrix** problem reduces to 1D by fixing a row band, collapsing it into column sums, and running Kadane's — `O(R²·C)`, with a transpose trick for tall-thin grids. The **divide-and-conquer** `O(n log n)` solution is slower than Kadane's but parallelizes and generalizes to segment-tree range queries. Master the running-best recurrence and each variant is a small, principled twist on it.

---

## Appendix: Variant Decision Guide

When a problem lands on your desk, this is the fast triage:

| The problem says… | Reach for | Key detail |
|-------------------|-----------|------------|
| "best contiguous sum" | plain Kadane | init to `a[0]`, not `0` |
| "…and tell me where" | Kadane + start tracking | reset `start` on restart; record on new best |
| "best contiguous **product**" | dual min/max Kadane | swap min/max on negative; zeros sever |
| "…and the array **wraps**" | `max(kadane, total − minKadane)` | all-negative guard returns plain max |
| "best **rectangle** in a grid" | row-band + 1D Kadane | `O(R²C)`; transpose tall-thin grids |
| "length **≤ k** or **≥ k**" | prefix sums + windowed/lagged min | bare recurrence has no length notion |
| "support **range queries**" | segment tree of `(total,pre,suf,best)` | `O(log n)` per query/update |
| "gaps are allowed" | **not Kadane** | answer is `Σ max(a_i, 0)` |

The single most common mistake across all of these is reusing the *sum* mindset for the *product* problem — the sign-flip is not optional. The second most common is forgetting the circular all-negative guard. Keep those two front of mind and the variant family becomes routine.

