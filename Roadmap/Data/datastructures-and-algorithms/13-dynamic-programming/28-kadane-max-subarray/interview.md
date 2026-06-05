# Kadane's Algorithm / Maximum Subarray — Interview Preparation

Maximum-subarray is a favourite interview topic because it rewards a single crisp insight — *"the best subarray ending here is `max(a[i], bestEndingHere + a[i])`"* — and then tests whether you can (a) handle the all-negative case correctly, (b) reconstruct the indices, (c) recognize the same running-best recurrence behind the product, circular, and 2D variants, and (d) avoid confusing a subarray with a subsequence. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Max-sum contiguous subarray | Kadane: `be = max(a[i], be+a[i])` | `O(n)` time, `O(1)` space |
| Max-sum + start/end indices | Kadane + candidate-start tracking | `O(n)` |
| Max-product subarray | track running min **and** max | `O(n)` |
| Circular max-sum | `max(kadane, total − minSubarray)` + all-neg guard | `O(n)` |
| 2D max-sum submatrix | fix row band → Kadane on column sums | `O(R²·C)` |
| At most / at least `k` elements | prefix sums + windowed/lagged min | `O(n)` |
| `O(n log n)` alternative | divide & conquer (left/right/cross) | `O(n log n)` |
| **Best *subsequence* (gaps ok)** | **not Kadane — sum the positives** | `O(n)` |

Core algorithm:

```text
kadane(a):
    bestEndingHere = a[0]
    bestSoFar      = a[0]
    for i in 1 .. n-1:
        bestEndingHere = max(a[i], bestEndingHere + a[i])
        bestSoFar      = max(bestSoFar, bestEndingHere)
    return bestSoFar          # O(n) time, O(1) space
```

Key facts:
- **Initialize to `a[0]`, not `0`** — or the all-negative case wrongly returns `0`.
- **Restart** happens iff `bestEndingHere ≤ 0` (a negative prefix is never worth carrying).
- The answer is always a **real** non-empty subarray (classic contract).
- **Subarray = contiguous**; subsequence (gaps) is a different, easier problem.

---

## Junior Questions (12 Q&A)

### J1. What does Kadane's algorithm compute?
The maximum sum over all contiguous (non-empty) subarrays of an array, in a single `O(n)` pass with `O(1)` extra space.

### J2. What is the core recurrence?
`bestEndingHere = max(a[i], bestEndingHere + a[i])`. The best subarray ending at index `i` is either `a[i]` alone or the best run ending at `i-1` extended by `a[i]`.

### J3. Why two variables?
`bestEndingHere` is the best subarray *ending at the current index* (the DP state); `bestSoFar` is the best subarray *seen anywhere so far* (the running answer). Every subarray ends somewhere, so the max over all ending-here values is the global answer.

### J4. How should you initialize them?
Both to `a[0]`, then loop from `i = 1`. Initializing `bestSoFar = 0` is the classic bug — it returns a phantom `0` on all-negative arrays.

### J5. What is the answer for an all-negative array?
The single largest (least-negative) element. For `[-3, -1, -2]` the answer is `-1`. Correct `a[0]` initialization makes this fall out automatically.

### J6. When does the running sum "restart"?
When `bestEndingHere` (before adding `a[i]`) is negative, the recurrence picks `a[i]` alone — discarding the negative prefix. A negative prefix can only hurt a future subarray.

### J7. Subarray vs subsequence — what is the difference?
A subarray is contiguous (no gaps). A subsequence may skip elements. Kadane's solves the contiguous case; the best subsequence is trivially the sum of all positive elements.

### J8. What is the time and space complexity?
`O(n)` time (one pass), `O(1)` extra space (two scalars). This is asymptotically optimal — you must read every element at least once.

### J9. How do you handle the empty array?
There is no non-empty subarray; decide the contract — throw an error or return a documented sentinel. Do not silently return `0`.

### J10. What about a single-element array?
The answer is that element. The `a[0]` initialization handles it for free; the loop body never runs.

### J11. Can sums overflow?
Yes. For large `n` and large magnitudes, use 64-bit accumulators (`int64`/`long`). A 32-bit int overflows around `2.1×10^9`.

### J12 (analysis). Why is Kadane `O(n)` and not `O(n²)`?
Because it never re-sums a range. By keeping `bestEndingHere`, each new element is incorporated in `O(1)` — one add and one compare — so the whole array is processed in linear time, versus enumerating all `O(n²)` ranges.

---

## Middle Questions (12 Q&A)

### M1. Prove Kadane's correctness in one paragraph.
Let `f(r)` = best subarray sum ending at `r`. Then `f(r) = max(a_r, f(r-1)+a_r)` (a subarray ending at `r` is either the singleton `a_r` or an extension of one ending at `r-1`). By induction, `bestEndingHere = f(r)` after step `r`, and `bestSoFar = max_{s≤r} f(s)`. Since every subarray ends somewhere, the final `bestSoFar = max_r f(r)` is the global maximum.

### M2. How do you recover the start and end indices?
Track a `start` index that resets to `i` whenever the run restarts (chooses `a[i]`). When `bestEndingHere` sets a new `bestSoFar`, record `bestL = start`, `bestR = i`.

### M3. How do you solve the maximum-*product* subarray?
Track both a running min and a running max. A negative `a[i]` swaps their roles (a very negative product times a negative becomes a large positive). `curMax = max(a[i], curMax·a[i], curMin·a[i])` and symmetrically for `curMin`.

### M4. Why doesn't a max-only sweep work for products?
Because `[-2, 3, -4]` has best product `24`, formed by multiplying two negatives. A max-only sweep would discard the running `-6` and miss it. You must remember the smallest product too.

### M5. How do you solve the circular maximum subarray?
The answer is `max(plainKadane, total − minSubarray)`. A wrapping subarray's complement is a non-wrapping minimum-sum subarray, so maximizing the wrap = total minus the minimum subarray. Guard: if all elements are negative, return the plain Kadane result (the wrap would be empty).

### M6. Why is the all-negative guard needed in the circular case?
If every element is negative, `total − minSubarray = 0`, which corresponds to removing everything — the empty subarray, which is invalid. So you fall back to the least-negative element.

### M7. How does the 2D maximum-sum submatrix reduce to Kadane?
Fix a top row and a bottom row, collapse the columns between them into a 1D array of column sums, and run Kadane on that. The max over all `O(R²)` row pairs is the answer. `O(R²·C)`.

### M8. How do you keep the 2D column collapse fast?
Accumulate `colSum[c] += grid[bottom][c]` incrementally as `bottom` grows — never re-sum a band from scratch. Each row pair then costs `O(C)`.

### M9. When would you transpose the grid in the 2D variant?
When `R > C`. Transposing puts the squared `O(R²)` factor on the smaller dimension, giving `O(min(R,C)² · max(R,C))` — a big win for tall-thin grids.

### M10. Describe the divide-and-conquer solution and its complexity.
Split in half; the best subarray is in the left, in the right, or crosses the midpoint (best suffix of left + best prefix of right, found by linear scan). `T(n) = 2T(n/2) + O(n) = O(n log n)`. Slower than Kadane but parallelizes and supports segment-tree range queries.

### M11. How do you avoid overflow in the product variant?
Use 64-bit; products explode fast (~63 doublings reach `2^63`). For larger ranges, use overflow detection, big integers, or compare in log-space (losing exactness).

### M12 (analysis). Is there a faster-than-`O(n)` algorithm?
No. Any correct algorithm must inspect every element (an adversary can make an unread element arbitrarily large), so `Ω(n)` is a lower bound and Kadane's `Θ(n)` is optimal.

---

## Senior Questions (10 Q&A)

### S1. Is Kadane's a streaming algorithm?
Yes — it processes each element once with `O(1)` state, so it answers "best subarray over the prefix seen so far" online. It cannot answer fixed-width sliding-window queries (it can't evict old elements); for that use a monotonic deque over prefix sums or a segment tree.

### S2. How do you parallelize / distribute maximum-subarray?
Compute a summary `(total, bestPrefix, bestSuffix, best)` per chunk; these merge associatively (`best = max(L.best, R.best, L.suffix + R.prefix)`). Fold chunks in any order — this is the divide-and-conquer node as a monoid, and the basis for segment-tree range queries.

### S3. What is the empty-subarray contract and why does it matter?
Whether the empty subarray (sum `0`) is a valid answer. Non-empty (init to `a[0]`) and empty-allowed (`max(0, kadane)`) are *different problems* that agree on every input except all-negative. Shipping the wrong one is a silent bug; pin it to the business requirement.

### S4. How do you solve "max-sum subarray with at most `k` elements"?
Via prefix sums: the best subarray ending at `r` of length `≤ k` is `P[r+1] − min(P[l])` over the window `l ∈ [r−k+1, r]`. Maintain that windowed minimum with a monotonic deque — `O(n)`. The bare recurrence has no length notion, so you work in prefix-sum space.

### S5. How do you make one implementation serve sum, product, and circular?
Factor out the combine operator and the initialization. Sum uses `+`/`max`; product carries a `(min, max)` pair with a sign swap; circular runs max-Kadane and min-Kadane together. Bake index reconstruction into the core so every caller gets `(value, l, r)`.

### S6. What numeric hazards appear at scale?
Sum overflow (size the accumulator to `n·max|a[i]|`), product overflow (explodes in ~63 steps), float catastrophic cancellation (use Kahan summation in the accumulation), and never use unsigned types (the negative-prefix logic relies on signed comparison).

### S7. How do you verify correctness on huge or live inputs?
Keep an `O(n²)` brute-force oracle for small `n` and diff. Property-test: all-negative, single-element, all-positive, reconstruction round-trip (`sum(a[l..r]) == value`), and merge associativity for the distributed variant.

### S8. When is the 2D `O(R²·C)` reduction the wrong tool?
On enormous grids (`10^4 × 10^4`) where `O(R²C)` is infeasible, or when only an approximate / fixed-size hot region is needed. Then use 2D prefix sums with a bounded sliding window, FFT correlation for fixed kernels, or downsampling. State that exact arbitrary-size max-submatrix has no known subquadratic algorithm.

### S9. How does the product variant handle zeros?
A zero collapses all three candidates (`a[i]`, `curMax·a[i]`, `curMin·a[i]`) to `0`, severing the product; the next index restarts from its own singleton. No special-casing needed — the recurrence handles it.

### S10 (analysis). Why is the segment monoid associative, and why does it matter?
Expanding `merge(merge(L,M),R)` and `merge(L,merge(M,R))` gives the same expression using associativity of `+`/`max` and distributivity `c + max(x,y) = max(c+x, c+y)`. Associativity is what makes divide-and-conquer split-point-independent, enables `O(log n)` range maximum-subarray queries with point updates, and lets distributed shards merge in any order.

---

## Professional Questions (8 Q&A)

### P1. Design a service that reports the most profitable holding window over a price stream.
Run streaming Kadane in `O(1)` state, returning `(value, startIndex, endIndex)`. Decide the contract: must the user hold ≥1 day (non-empty) or may they decline (empty-allowed)? Log the window indices for auditability, size accumulators for the worst-case sum, and for "best window in the last `W` days" use a deque-over-prefix-sums rather than plain Kadane.

### P2. The input grid is `5000 × 5000`. The `O(R²·C)` submatrix scan is too slow. What do you do?
Transpose if non-square so the squared factor is the smaller side; accumulate the column band incrementally; parallelize across the outer `top` loop (independent iterations). If still infeasible, relax to an approximate or fixed-rectangle-size formulation using 2D prefix sums, or downsample. Be explicit that exact arbitrary-size is inherently quadratic.

### P3. How do you debug "the max-subarray answer is wrong" in production?
Run the `O(n²)` oracle on the exact small input and diff. Check the three usual suspects: wrong initialization (`0` vs `a[0]`, breaks all-negative), wrong contract (empty allowed?), and overflow (32-bit on large sums / products). Verify reconstruction: recomputed `sum(a[l..r])` must equal the reported value.

### P4. How would you support range maximum-subarray queries on a mutable array?
Build a segment tree whose nodes store `(total, bestPrefix, bestSuffix, best)` and merge with the associative rule. Queries and point updates are `O(log n)`. This is the divide-and-conquer monoid materialized as a data structure — plain Kadane cannot answer arbitrary range queries.

### P5. When is matrix/2D Kadane the wrong choice and what replaces it?
When the rectangle size is fixed (use 2D prefix sums + sliding window, `O(R·C)`), when approximation suffices, or when the grid is too large for `O(R²C)`. Also when the "submatrix" need not be contiguous — that is a different problem entirely.

### P6. How do you handle floating-point arrays in a long-running stream?
The `max` comparisons are exact; only the `bestEndingHere + x` accumulation drifts. Use compensated (Kahan) summation in that step for long streams. Document that sums of large opposite-sign values can lose precision; if exactness matters, use rationals or scaled integers.

### P7. How do bounded-length constraints change the algorithm?
"At most `k`" needs a windowed minimum of the prefix array (monotonic deque, `O(n)`); "at least `k`" needs a lagged running minimum (`O(n)`, `O(1)` space). The bare `be = max(a[i], be+a[i])` recurrence cannot express length, so you reformulate via `S(l,r) = P[r+1] − P[l]` and constrain the feasible `l`.

### P8 (analysis). Why is the subsequence version trivial but the subarray version not?
A subsequence (gaps allowed) lets you cherry-pick every non-negative element: the answer is `Σ max(a_i, 0)` in `O(n)` with no DP. Contiguity forbids skipping a negative element stranded inside a strong run, which is exactly what forces the `f(r-1)` dependence and makes Kadane's recurrence necessary.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` scan with a linear algorithm.
Look for a concrete story: a "best window" computation that was quadratic, a profile showing it dominating, the insight that the best-ending-here state makes it linear (Kadane), and the measured speedup. Strong answers mention validating against the old slow version and handling the all-negative / overflow edge cases.

### B2. A teammate's max-subarray returns 0 for a dataset that is all losses. How do you handle it?
Diagnose calmly: they almost certainly initialized `bestSoFar = 0`, which silently returns a phantom `0` on all-negative input. Explain the two contracts (non-empty vs empty-allowed), confirm which the requirement wants, and fix the initialization. Frame it as the single most common Kadane bug, not a blame moment.

### B3. Design a feature that finds the brightest rectangular region of a heatmap.
This is the 2D maximum-sum submatrix: fix row bands, collapse to column sums, Kadane each band, `O(R²·C)`. Discuss transposing for tall-thin grids, incremental band accumulation, parallelizing the outer loop, and falling back to fixed-size prefix-sum windows if the grid is huge.

### B4. How would you explain Kadane's to a junior engineer?
Use the profit-streak analogy: scanning daily P&L, keep "the best streak ending today," and if the running streak ever goes negative, abandon it and start fresh right here. Track the best streak ever seen. Lead with the two gotchas: initialize to the first element (not 0), and it only works for *contiguous* runs.

### B5. Your max-subarray job is using too much memory at scale. How do you investigate?
1D Kadane is `O(1)` — if memory is high, you are probably materializing prefix arrays or per-band submatrices in the 2D variant (keep only the `O(C)` band). For range queries, confirm the segment tree is built once, not per query. Profile allocations; the fix is usually keeping the rolling state instead of arrays.

---

## Coding Challenges

### Challenge 1: Maximum Subarray Sum with Indices

**Problem.** Given an integer array `a`, return the maximum sum of any non-empty contiguous subarray **and** its start/end indices. Handle all-negative arrays correctly.

**Example.**
```text
a = [-2, 1, -3, 4, -1, 2, 1, -5, 4]  ->  sum 6, indices (3, 6)   [4,-1,2,1]
a = [-3, -1, -2]                      ->  sum -1, indices (1, 1)  [-1]
```

**Constraints.** `1 ≤ n ≤ 10^6`, `|a[i]| ≤ 10^9` (use 64-bit sums).

**Optimal.** Kadane with candidate-start tracking, `O(n)` time, `O(1)` space.

**Go.**
```go
package main

import "fmt"

func maxSubarrayIdx(a []int64) (int64, int, int) {
	be, best := a[0], a[0]
	start, bestL, bestR := 0, 0, 0
	for i := 1; i < len(a); i++ {
		if a[i] > be+a[i] {
			be = a[i]
			start = i // restart: new candidate start
		} else {
			be += a[i]
		}
		if be > best {
			best = be
			bestL, bestR = start, i
		}
	}
	return best, bestL, bestR
}

func main() {
	a := []int64{-2, 1, -3, 4, -1, 2, 1, -5, 4}
	s, l, r := maxSubarrayIdx(a)
	fmt.Println(s, l, r) // 6 3 6

	b := []int64{-3, -1, -2}
	s, l, r = maxSubarrayIdx(b)
	fmt.Println(s, l, r) // -1 1 1
}
```

**Java.**
```java
public class MaxSubarrayIdx {
    static long[] solve(long[] a) {
        long be = a[0], best = a[0];
        int start = 0, bestL = 0, bestR = 0;
        for (int i = 1; i < a.length; i++) {
            if (a[i] > be + a[i]) {
                be = a[i];
                start = i;            // restart
            } else {
                be += a[i];
            }
            if (be > best) {
                best = be;
                bestL = start; bestR = i;
            }
        }
        return new long[]{best, bestL, bestR};
    }

    public static void main(String[] args) {
        long[] a = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
        long[] r = solve(a);
        System.out.println(r[0] + " " + r[1] + " " + r[2]); // 6 3 6

        long[] b = {-3, -1, -2};
        r = solve(b);
        System.out.println(r[0] + " " + r[1] + " " + r[2]); // -1 1 1
    }
}
```

**Python.**
```python
def max_subarray_idx(a):
    be = best = a[0]
    start = best_l = best_r = 0
    for i in range(1, len(a)):
        if a[i] > be + a[i]:
            be = a[i]
            start = i               # restart
        else:
            be += a[i]
        if be > best:
            best = be
            best_l, best_r = start, i
    return best, best_l, best_r


if __name__ == "__main__":
    print(max_subarray_idx([-2, 1, -3, 4, -1, 2, 1, -5, 4]))  # (6, 3, 6)
    print(max_subarray_idx([-3, -1, -2]))                      # (-1, 1, 1)
```

---

### Challenge 2: Maximum Product Subarray

**Problem.** Given an integer array `a`, return the maximum product of any non-empty contiguous subarray.

**Example.**
```text
a = [2, 3, -2, 4]  ->  6    (subarray [2,3])
a = [-2, 3, -4]    ->  24   ((-2)*3*(-4))
a = [-2, 0, -1]    ->  0
```

**Constraints.** `1 ≤ n ≤ 2·10^4`, products fit in 64-bit for the test data.

**Optimal.** Dual min/max Kadane, `O(n)` time, `O(1)` space.

**Go.**
```go
package main

import "fmt"

func maxProduct(a []int64) int64 {
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
	fmt.Println(maxProduct([]int64{2, 3, -2, 4})) // 6
	fmt.Println(maxProduct([]int64{-2, 3, -4}))   // 24
	fmt.Println(maxProduct([]int64{-2, 0, -1}))   // 0
}
```

**Java.**
```java
public class MaxProduct {
    static long maxProduct(long[] a) {
        long curMax = a[0], curMin = a[0], best = a[0];
        for (int i = 1; i < a.length; i++) {
            long x = a[i];
            if (x < 0) { long t = curMax; curMax = curMin; curMin = t; }
            curMax = Math.max(x, curMax * x);
            curMin = Math.min(x, curMin * x);
            best = Math.max(best, curMax);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxProduct(new long[]{2, 3, -2, 4})); // 6
        System.out.println(maxProduct(new long[]{-2, 3, -4}));   // 24
        System.out.println(maxProduct(new long[]{-2, 0, -1}));   // 0
    }
}
```

**Python.**
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
    print(max_product([2, 3, -2, 4]))  # 6
    print(max_product([-2, 3, -4]))    # 24
    print(max_product([-2, 0, -1]))    # 0
```

---

### Challenge 3: Maximum Sum Circular Subarray

**Problem.** Given a circular integer array `a`, return the maximum sum of a non-empty subarray that may wrap from the end to the front.

**Example.**
```text
a = [1, -2, 3, -2]  ->  3
a = [5, -3, 5]      ->  10   (wrap: a[2], a[0])
a = [-3, -2, -3]    ->  -2   (all-negative guard)
```

**Constraints.** `1 ≤ n ≤ 3·10^4`, `|a[i]| ≤ 3·10^4`.

**Optimal.** `max(maxKadane, total − minKadane)` with all-negative guard, `O(n)`.

**Go.**
```go
package main

import "fmt"

func maxCircular(a []int64) int64 {
	var total int64
	curMax, bestMax := a[0], a[0]
	curMin, bestMin := a[0], a[0]
	total = a[0]
	for i := 1; i < len(a); i++ {
		x := a[i]
		total += x
		if x > curMax+x {
			curMax = x
		} else {
			curMax += x
		}
		if curMax > bestMax {
			bestMax = curMax
		}
		if x < curMin+x {
			curMin = x
		} else {
			curMin += x
		}
		if curMin < bestMin {
			bestMin = curMin
		}
	}
	if bestMax < 0 { // all negative: wrap would be empty
		return bestMax
	}
	if wrap := total - bestMin; wrap > bestMax {
		return wrap
	}
	return bestMax
}

func main() {
	fmt.Println(maxCircular([]int64{1, -2, 3, -2})) // 3
	fmt.Println(maxCircular([]int64{5, -3, 5}))     // 10
	fmt.Println(maxCircular([]int64{-3, -2, -3}))   // -2
}
```

**Java.**
```java
public class MaxCircular {
    static long maxCircular(long[] a) {
        long total = a[0];
        long curMax = a[0], bestMax = a[0];
        long curMin = a[0], bestMin = a[0];
        for (int i = 1; i < a.length; i++) {
            long x = a[i];
            total += x;
            curMax = Math.max(x, curMax + x);
            bestMax = Math.max(bestMax, curMax);
            curMin = Math.min(x, curMin + x);
            bestMin = Math.min(bestMin, curMin);
        }
        if (bestMax < 0) return bestMax;           // all-negative guard
        return Math.max(bestMax, total - bestMin);
    }

    public static void main(String[] args) {
        System.out.println(maxCircular(new long[]{1, -2, 3, -2})); // 3
        System.out.println(maxCircular(new long[]{5, -3, 5}));     // 10
        System.out.println(maxCircular(new long[]{-3, -2, -3}));   // -2
    }
}
```

**Python.**
```python
def max_circular(a):
    total = a[0]
    cur_max = best_max = a[0]
    cur_min = best_min = a[0]
    for i in range(1, len(a)):
        x = a[i]
        total += x
        cur_max = max(x, cur_max + x)
        best_max = max(best_max, cur_max)
        cur_min = min(x, cur_min + x)
        best_min = min(best_min, cur_min)
    if best_max < 0:               # all-negative guard
        return best_max
    return max(best_max, total - best_min)


if __name__ == "__main__":
    print(max_circular([1, -2, 3, -2]))  # 3
    print(max_circular([5, -3, 5]))      # 10
    print(max_circular([-3, -2, -3]))    # -2
```

---

### Challenge 4: Maximum Sum Submatrix

**Problem.** Given an `R × C` integer grid, return the maximum sum over all non-empty rectangular submatrices.

**Example.**
```text
grid = [[1,2,-1,-4,-20],
        [-8,-3,4,2,1],
        [3,8,10,1,3],
        [-4,-1,1,7,-6]]   ->  29   (rows 1-3, cols 1-3)
```

**Constraints.** `1 ≤ R, C ≤ 300`.

**Optimal.** Row-band reduction + 1D Kadane, `O(R²·C)`.

**Go.**
```go
package main

import "fmt"

func kadane(a []int64) int64 {
	be, best := a[0], a[0]
	for i := 1; i < len(a); i++ {
		if a[i] > be+a[i] {
			be = a[i]
		} else {
			be += a[i]
		}
		if be > best {
			best = be
		}
	}
	return best
}

func maxSubmatrix(g [][]int64) int64 {
	R, C := len(g), len(g[0])
	best := g[0][0]
	for top := 0; top < R; top++ {
		colSum := make([]int64, C)
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
	g := [][]int64{
		{1, 2, -1, -4, -20},
		{-8, -3, 4, 2, 1},
		{3, 8, 10, 1, 3},
		{-4, -1, 1, 7, -6},
	}
	fmt.Println(maxSubmatrix(g)) // 29
}
```

**Java.**
```java
public class MaxSubmatrix {
    static long kadane(long[] a) {
        long be = a[0], best = a[0];
        for (int i = 1; i < a.length; i++) {
            be = Math.max(a[i], be + a[i]);
            best = Math.max(best, be);
        }
        return best;
    }

    static long maxSubmatrix(long[][] g) {
        int R = g.length, C = g[0].length;
        long best = g[0][0];
        for (int top = 0; top < R; top++) {
            long[] colSum = new long[C];
            for (int bottom = top; bottom < R; bottom++) {
                for (int c = 0; c < C; c++) colSum[c] += g[bottom][c];
                best = Math.max(best, kadane(colSum));
            }
        }
        return best;
    }

    public static void main(String[] args) {
        long[][] g = {
            {1, 2, -1, -4, -20},
            {-8, -3, 4, 2, 1},
            {3, 8, 10, 1, 3},
            {-4, -1, 1, 7, -6},
        };
        System.out.println(maxSubmatrix(g)); // 29
    }
}
```

**Python.**
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
            row = g[bottom]
            for c in range(C):
                col_sum[c] += row[c]
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

---

## Final Tips

- Lead with the one-liner: *"`bestEndingHere = max(a[i], bestEndingHere + a[i])`, track the global max; `O(n)` time, `O(1)` space."*
- Immediately flag the two gotchas: **initialize to `a[0]` (all-negative)** and **subarray means contiguous, not subsequence**.
- For **product**, say "track min and max because a negative flips them." For **circular**, say "`total − minSubarray`, with an all-negative guard." For **2D**, say "fix a row band, Kadane the column sums."
- Offer **index reconstruction** proactively — interviewers almost always ask for it next.
- Mention the **`O(n log n)` divide-and-conquer** and the **segment-tree monoid** as the path to range queries, and note Kadane is the optimal `O(n)` default.
- Always offer to verify against a brute-force `O(n²)` oracle on small inputs, especially the all-negative case.
