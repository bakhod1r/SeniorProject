# Kadane's Algorithm / Maximum Subarray — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the running-best recurrence and validate against the evaluation criteria.
> **Always test against a brute-force `O(n²)` oracle on small inputs — especially the all-negative case — before trusting the linear-time result.**

---

## Beginner Tasks (5)

### Task 1 — Plain Kadane (max-sum subarray)

**Problem.** Implement `maxSubarraySum(a)` returning the largest sum of any non-empty contiguous subarray. Handle all-negative arrays (the answer is the least-negative element). Use the two-variable Kadane recurrence.

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print the single maximum subarray sum.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `|a[i]| ≤ 10^4`.
- Initialize both running variables to `a[0]`; never to `0`.

**Hint.** `bestEndingHere = max(a[i], bestEndingHere + a[i])`, `bestSoFar = max(bestSoFar, bestEndingHere)`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func maxSubarraySum(a []int64) int64 {
	// TODO: initialize to a[0], loop from i=1
	return 0
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(reader, &n)
	a := make([]int64, n)
	for i := range a {
		fmt.Fscan(reader, &a[i])
	}
	fmt.Println(maxSubarraySum(a))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long maxSubarraySum(long[] a) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        System.out.println(maxSubarraySum(a));
    }
}
```

**Starter — Python.**
```python
import sys


def max_subarray_sum(a):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = [int(x) for x in data[1:1 + n]]
    print(max_subarray_sum(a))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on `[-2,1,-3,4,-1,2,1,-5,4]` → `6`.
- Correct on `[-3,-1,-2]` → `-1` (all-negative).
- Correct on a single element and on all-positive (sum of whole array).

---

### Task 2 — Max-sum subarray with indices

**Problem.** Extend Task 1 to also return the start and end indices `(l, r)` of the winning subarray. Track a candidate `start` that resets on every restart and record `(l, r)` whenever a new global best is set.

**Input / Output spec.**
- Read `n`, then `a`.
- Print `sum l r` (space-separated).

**Constraints.** `1 ≤ n ≤ 10^5`, `|a[i]| ≤ 10^4`.

**Hint.** When the recurrence chooses `a[i]` (restart), set `start = i`. When `bestEndingHere > bestSoFar`, record `bestL = start`, `bestR = i`.

**Reference oracle (Python) — validate against this.**
```python
def brute_idx(a):
    n = len(a)
    best, bl, br = a[0], 0, 0
    for l in range(n):
        s = 0
        for r in range(l, n):
            s += a[r]
            if s > best:
                best, bl, br = s, l, r
    return best, bl, br
```

**Evaluation criteria.**
- `[-2,1,-3,4,-1,2,1,-5,4]` → `6 3 6`.
- Reconstructed `sum(a[l..r])` equals the reported sum.
- Matches `brute_idx` on random small arrays.

---

### Task 3 — Empty-subarray-allowed variant

**Problem.** Implement `maxSubarrayAllowEmpty(a)` where choosing **nothing** (sum `0`) is permitted. Compare it side by side with the non-empty version from Task 1 to see they differ only on all-negative input.

**Input / Output spec.**
- Read `n`, then `a`.
- Print two values: the non-empty answer and the empty-allowed answer.

**Constraints.** `1 ≤ n ≤ 10^5`, `|a[i]| ≤ 10^4`.

**Hint.** Empty-allowed: `be = max(0, be + a[i])`, `best = max(best, be)`, starting `be = best = 0`. Equivalently `max(0, kadane(a))`.

**Worked check.** On `[-3,-1,-2]`: non-empty → `-1`, empty-allowed → `0`. On `[2,-1,3]`: both → `4`.

**Evaluation criteria.**
- The two answers agree whenever some element is `≥ 0`.
- They differ exactly on all-negative arrays (non-empty negative vs `0`).
- Both are `O(n)`.

---

### Task 4 — Brute-force oracle

**Problem.** Implement the `O(n²)` brute-force max-subarray (running inner sum, not `O(n³)` re-summing) to use as a test oracle for all later tasks.

**Input / Output spec.**
- Read `n`, then `a`. Print the maximum subarray sum.

**Constraints.** `1 ≤ n ≤ 2000` (the oracle is only for small inputs).

**Hint.** Outer loop `l`, inner loop `r` with a running sum `s += a[r]`; never reset `s` and re-add from `l`.

**Evaluation criteria.**
- Agrees with Kadane (Task 1) on random arrays of size `≤ 2000`, including all-negative.
- Uses a running inner sum (`O(n²)`), not nested re-summation (`O(n³)`).

---

### Task 5 — Count restarts

**Problem.** Run Kadane and count how many times the recurrence **restarts** (chooses `a[i]` over the extension). Output the maximum sum and the restart count. This builds intuition for where optimal subarrays begin.

**Input / Output spec.**
- Read `n`, then `a`. Print `maxSum restartCount`.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** A restart occurs when `bestEndingHere ≤ 0` before adding `a[i]` (equivalently when `a[i] > bestEndingHere + a[i]`).

**Worked check.** On an all-positive array there are `0` restarts. On `[-1,-1,-1]` every step after the first restarts (`2` restarts for `n=3`).

**Evaluation criteria.**
- `0` restarts on all-positive input.
- `n-1` restarts on strictly-decreasing all-negative input.
- Max sum still matches Task 1.

---

## Intermediate Tasks (5)

### Task 6 — Maximum-product subarray

**Problem.** Implement `maxProduct(a)` returning the maximum product of any non-empty contiguous subarray. Track both a running min and a running max; swap their roles on negative elements; reset on zeros.

**Constraints.** `1 ≤ n ≤ 2·10^4`, products fit in 64-bit.

**Hint.** On `a[i] < 0`, swap `curMax`/`curMin` first, then `curMax = max(a[i], curMax*a[i])`, `curMin = min(a[i], curMin*a[i])`.

**Reference oracle (Python).**
```python
def brute_product(a):
    n = len(a)
    best = a[0]
    for l in range(n):
        p = 1
        for r in range(l, n):
            p *= a[r]
            best = max(best, p)
    return best
```

**Evaluation criteria.**
- `[2,3,-2,4]` → `6`, `[-2,3,-4]` → `24`, `[-2,0,-1]` → `0`.
- Matches `brute_product` on random small arrays (including negatives and zeros).
- `O(n)`.

---

### Task 7 — Circular maximum subarray

**Problem.** Implement `maxCircular(a)` for a circular array where a subarray may wrap from the end to the front. Use `max(maxKadane, total − minKadane)` with the all-negative guard.

**Constraints.** `1 ≤ n ≤ 3·10^4`, `|a[i]| ≤ 3·10^4`.

**Hint.** Compute `total`, max-Kadane, and min-Kadane in one pass. If the max-Kadane result is `< 0`, return it (all-negative → wrap empty).

**Reference oracle (Python).**
```python
def brute_circular(a):
    n = len(a)
    best = a[0]
    for l in range(n):
        s = 0
        for length in range(1, n + 1):     # lengths 1..n
            s += a[(l + length - 1) % n]
            best = max(best, s)
    return best
```

**Evaluation criteria.**
- `[5,-3,5]` → `10`, `[1,-2,3,-2]` → `3`, `[-3,-2,-3]` → `-2`.
- Matches `brute_circular` on random small arrays.
- Single `O(n)` pass.

---

### Task 8 — 2D maximum-sum submatrix

**Problem.** Implement `maxSubmatrix(grid)` returning the maximum sum over all rectangular submatrices. Fix each row band, collapse to column sums incrementally, and run 1D Kadane. Transpose if `R > C`.

**Constraints.** `1 ≤ R, C ≤ 300`.

**Hint.** `O(R²·C)`. Keep an `O(C)` `colSum` band; add `grid[bottom][c]` as `bottom` grows; never re-sum a band.

**Reference oracle (Python) — small grids only.**
```python
def brute_submatrix(g):
    R, C = len(g), len(g[0])
    best = g[0][0]
    for t in range(R):
        for b in range(t, R):
            for l in range(C):
                s = 0
                for r in range(l, C):
                    for i in range(t, b + 1):
                        s += g[i][r]
                    best = max(best, s)
    return best
```

**Evaluation criteria.**
- Returns `29` on the canonical `4×5` example.
- Matches `brute_submatrix` on random `≤ 6×6` grids.
- Transposes tall-thin grids so the squared factor is the smaller dimension.

---

### Task 9 — Divide-and-conquer max-subarray

**Problem.** Implement the `O(n log n)` divide-and-conquer maximum-subarray (left / right / crossing cases). Use it to cross-check Kadane on large random arrays.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Split at `mid`; recurse on halves; compute the crossing max as `bestSuffix(left) + bestPrefix(right)` via two linear scans from the middle outward.

**Evaluation criteria.**
- Matches Kadane (Task 1) on random arrays, including all-negative.
- Recursion depth is `O(log n)`; crossing scan is `O(n)` per level.
- A short note comparing measured runtime to Kadane (it should be slower).

---

### Task 10 — Max-sum subarray with at most k elements

**Problem.** Implement `maxAtMostK(a, k)` returning the maximum sum over non-empty contiguous subarrays of length `≤ k`. Use prefix sums plus a monotonic-deque windowed minimum, not the bare recurrence.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ k ≤ n`, `|a[i]| ≤ 10^4`.

**Hint.** Subarray `a[l..r]` sum `= P[r+1] − P[l]`. For endpoint `r`, minimize `P[l]` over `l ∈ [r−k+1, r]` with a deque, then `best = max(best, P[r+1] − minPrefixInWindow)`.

**Reference oracle (Python).**
```python
def brute_at_most_k(a, k):
    n = len(a)
    best = a[0]
    for l in range(n):
        s = 0
        for r in range(l, min(l + k, n)):
            s += a[r]
            best = max(best, s)
    return best
```

**Evaluation criteria.**
- Matches `brute_at_most_k` on random small arrays for various `k`.
- `k = n` reproduces plain Kadane.
- `O(n)` with the deque.

---

## Advanced Tasks (5)

### Task 11 — Max-sum subarray with at least k elements

**Problem.** Implement `maxAtLeastK(a, k)` returning the maximum sum over non-empty contiguous subarrays of length `≥ k`. Use prefix sums plus a lagged running minimum.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ k ≤ n`.

**Hint.** For endpoint `r ≥ k−1`, feasible left endpoints are `l ∈ [0, r−k+1]`. Maintain `minPrefix = min over l ≤ r−k+1 of P[l]`, updated by absorbing `P[r−k+1]` as `r` advances; `best = max(best, P[r+1] − minPrefix)`.

**Reference oracle (Python).**
```python
def brute_at_least_k(a, k):
    n = len(a)
    best = None
    for l in range(n):
        s = 0
        for r in range(l, n):
            s += a[r]
            if r - l + 1 >= k:
                best = s if best is None else max(best, s)
    return best
```

**Evaluation criteria.**
- Matches `brute_at_least_k` on random small arrays for various `k`.
- `k = 1` reproduces plain Kadane.
- `O(n)`, `O(1)` extra space beyond the prefix array.

---

### Task 12 — Streaming / online Kadane

**Problem.** Implement a `KadaneStream` type supporting `push(x)` and `query()` that returns the maximum subarray sum over all elements pushed so far, in `O(1)` per operation and `O(1)` total state.

**Constraints.** Up to `10^7` pushes; `|x| ≤ 10^9` (use 64-bit).

**Hint.** Keep `bestEndingHere`, `bestSoFar`, and a `started` flag. The first push initializes both to `x`; subsequent pushes apply the recurrence.

**Evaluation criteria.**
- `query()` after pushing `[-2,1,-3,4,-1,2,1,-5,4]` returns `6`.
- `O(1)` per push, no buffering of the stream.
- Correct on an all-negative stream (returns the least-negative element pushed).

---

### Task 13 — Segment-tree range max-subarray queries

**Problem.** Build a segment tree whose nodes store `(total, bestPrefix, bestSuffix, best)` and support: (a) `query(l, r)` returning the max-subarray sum within `a[l..r]`, and (b) `update(i, v)` setting `a[i] = v`. Both `O(log n)`.

**Constraints.** `1 ≤ n ≤ 2·10^5`, up to `2·10^5` mixed queries/updates.

**Hint.** Merge rule: `best = max(L.best, R.best, L.bestSuffix + R.bestPrefix)`; `bestPrefix = max(L.bestPrefix, L.total + R.bestPrefix)`; symmetric for `bestSuffix`; `total = L.total + R.total`.

**Evaluation criteria.**
- `query(0, n-1)` equals plain Kadane over the whole array.
- Point updates reflect immediately in subsequent queries.
- Matches a brute-force range-Kadane on random small inputs.
- `O(log n)` per operation.

---

### Task 14 — 2D submatrix with reconstruction

**Problem.** Extend Task 8 to also return the bounding rectangle `(top, bottom, left, right)` of the maximum-sum submatrix.

**Constraints.** `1 ≤ R, C ≤ 300`.

**Hint.** Run an index-tracking Kadane (Task 2) on each `colSum` band; when it beats the global best, record `top`, `bottom`, and the band's Kadane `(l, r)` as `left`, `right`.

**Degree-of-care check.** On the canonical `4×5` grid the answer is `29` with rectangle `top=1, bottom=3, left=1, right=3`. Recompute the rectangle's sum and assert it equals `29`.

**Evaluation criteria.**
- Returns sum `29` and the correct rectangle on the canonical grid.
- Reconstructed rectangle sum equals the reported value.
- Matches a brute-force reconstruction on small grids.

---

### Task 15 — Classify the right tool

**Problem.** Implement `classify(n, k_or_dims, query_type)` (or write a short analysis) that, given a problem description, returns one of: `KADANE_1D`, `KADANE_PRODUCT`, `KADANE_CIRCULAR`, `KADANE_2D`, `BOUNDED_LENGTH`, `SEGMENT_TREE`, or `TRIVIAL_SUBSEQUENCE`. Justify each decision.

**Constraints / cases to handle.**
- Max-sum contiguous, single answer → `KADANE_1D`.
- Max-product contiguous → `KADANE_PRODUCT`.
- Wrap-around array → `KADANE_CIRCULAR`.
- Best rectangle in a grid → `KADANE_2D`.
- Length `≤ k` or `≥ k` constraint → `BOUNDED_LENGTH`.
- Range queries with updates → `SEGMENT_TREE`.
- Gaps allowed (subsequence) → `TRIVIAL_SUBSEQUENCE` (sum the positives).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is `TRIVIAL_SUBSEQUENCE`: if gaps are allowed it is not a Kadane problem at all.

**Evaluation criteria.**
- Correctly classifies all seven canonical cases.
- The `TRIVIAL_SUBSEQUENCE` branch explicitly notes the answer is `Σ max(a_i, 0)`.
- Justification cites the right complexity (`O(n)`, `O(R²C)`, `O(log n)`/query).

---

## Benchmark Task

### Task B — Kadane vs divide-and-conquer vs brute force

**Problem.** Empirically compare three max-subarray implementations on random arrays (fixed seed):

- **(a) Brute force** running inner sum — `O(n²)`.
- **(b) Divide & conquer** — `O(n log n)`.
- **(c) Kadane** — `O(n)`.

Measure wall-clock time for `n ∈ {10³, 10⁴, 10⁵, 10⁶}` (skip brute force beyond `n = 10⁴`). Report a table and confirm the asymptotic ordering.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_array(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(-100, 100) for _ in range(n)]


def kadane(a):
    # TODO: O(n)
    return a[0]


def divide_conquer(a):
    # TODO: O(n log n)
    return a[0]


def brute(a):
    # TODO: O(n^2) running inner sum
    return a[0]


def bench(fn, a) -> float:
    start = time.perf_counter()
    fn(a)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n         brute_ms      dc_ms        kadane_ms")
    for n in [1_000, 10_000, 100_000, 1_000_000]:
        a = gen_array(n, 42)
        kd = [bench(kadane, a) for _ in range(3)]
        dc = [bench(divide_conquer, a) for _ in range(3)]
        if n <= 10_000:
            br = [bench(brute, a) for _ in range(3)]
            print(f"{n:<9d} {mean_ms(br):<13.2f} {mean_ms(dc):<12.2f} {mean_ms(kd):<10.2f}")
        else:
            print(f"{n:<9d} {'(skipped)':<13} {mean_ms(dc):<12.2f} {mean_ms(kd):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- Kadane (c) is fastest; brute force (a) blows up quadratically; divide & conquer (b) sits between.
- Kadane completes `n = 10⁶` in well under a second in a compiled language.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: confirm all three produce identical answers and note the measured asymptotic ordering.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Run it on small `n`, diff entrywise, and only then trust the linear-time version on large data. Include the all-negative case every time.
- **Initialize to `a[0]`, never `0`** (unless the task is the empty-allowed variant). This is the single most common bug.
- **Restart means `a[i]` alone.** When `bestEndingHere ≤ 0`, drop the prefix — it can only hurt.
- **Subarray = contiguous.** If a task secretly allows gaps, it is a subsequence problem and the answer is `Σ max(a_i, 0)`.
- **Mind overflow.** Use 64-bit accumulators for sums (`n·max|a[i]|`) and especially products (which explode in ~63 steps).
- **For products, track min and max.** A negative element flips them; zeros sever the product.
- **For circular, include the all-negative guard.** `total − minSubarray` is invalid when everything is negative.
- **For 2D, accumulate the band incrementally and transpose tall-thin grids.**
- **Reuse one tested `kadane`** for the sum-based variants; parameterize the rest around it.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.

---

## Shared Regression Vectors

Use these hand-verified values as a fast self-check before running the oracle. Any implementation matching all of them is almost certainly correct:

```
Task 1  maxSubarraySum([-2,1,-3,4,-1,2,1,-5,4])  = 6
Task 1  maxSubarraySum([-3,-1,-2])               = -1
Task 1  maxSubarraySum([2,1,3,4])                = 10
Task 2  with indices on the first array          = (6, 3, 6)
Task 6  maxProduct([2,3,-2,4]) / [-2,3,-4] / [-2,0,-1] = 6 / 24 / 0
Task 7  maxCircular([5,-3,5]) / [1,-2,3,-2] / [-3,-2,-3] = 10 / 3 / -2
Task 8  maxSubmatrix(4x5 canonical)              = 29
Task 10 maxAtMostK([1,-3,2,1,-1], 2)             = 3
Task 11 maxAtLeastK([1,-3,2,1,-1], 3)            = (best length-≥3 window)
Task 13 query(0, n-1)                            = plain Kadane over whole array
```

Wire these into a small test harness in each language; they exercise the all-negative case, the product sign-flip, the circular guard, the 2D band, and the bounded-length windows — the five places implementations most often break.

