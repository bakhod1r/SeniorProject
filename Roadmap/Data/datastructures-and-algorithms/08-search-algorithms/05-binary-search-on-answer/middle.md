# Binary Search on Answer — Middle Level

> **Audience:** Engineers comfortable with the five-step recipe from `junior.md` who want the harder problem family — real-valued bisection, predicate engineering, K-th order statistics, partition-into-k problems, and the "non-obvious" parametric problems where spotting the predicate is the entire puzzle. Prerequisite: `junior.md`.

This document covers the **harder application layer** of parametric search. We deep-dive five interview-grade problems: **Split Array Largest Sum** (LC 410) with the elegant `max(lo) = max(arr), hi = sum(arr)` formulation, **Allocate Minimum Number of Pages** (the Indian interview classic), **Magnetic Force Between Two Balls** (LC 1552), **Find K-th Smallest Pair Distance** (LC 719) which combines two binary searches, and **Median of Two Sorted Arrays** (LC 4) recast as parametric search. We then cover **real-valued binary search** with full discussion of precision, fixed-iteration vs epsilon convergence, and the pathological floating-point cases that bite production code. Finally, we compare parametric search with **ternary search** and **answer enumeration** to clarify when each wins.

---

## Table of Contents

1. [Split Array Largest Sum (LC 410) — Worked End-to-End](#split-array)
2. [Allocate Minimum Number of Pages — Same Pattern, Different Vocab](#allocate-pages)
3. [Magnetic Force Between Two Balls (LC 1552) — Max-Min Distance](#magnetic-force)
4. [Find K-th Smallest Pair Distance (LC 719) — Search on Distance](#kth-pair-distance)
5. [Median of Two Sorted Arrays (LC 4) as Parametric Search](#median-two-sorted)
6. [Real-Valued Binary Search — Precision and Iteration Count](#real-valued)
7. [When NOT to Use Parametric — Ternary Search and Enumeration](#when-not)
8. [Predicate Engineering — Making `feasible(x)` Fast](#predicate-engineering)

---

<a name="split-array"></a>
## 1. Split Array Largest Sum (LC 410) — Worked End-to-End

> Given an integer array `nums[]` and an integer `m`, split `nums` into `m` non-empty contiguous subarrays. Find the split that **minimizes the largest sum** among the subarrays. Return that minimized maximum sum.

Example: `nums = [7,2,5,10,8]`, `m = 2`. Best split: `[7,2,5,10]` and `[8]` with sums `24, 8` → max = 24. Or `[7,2,5]` and `[10,8]` with sums `14, 18` → max = 18. Answer: 18.

### 1.1 Step 1 — Phrase as parametric search

"Find the **smallest** `S` such that we can partition `nums` into `m` contiguous chunks each with sum ≤ `S`."

### 1.2 Step 2 — Answer space

- **`lo = max(nums)`**. Why? Each chunk contains at least one element, so the chunk with that element has sum ≥ `max(nums)`. The minimum possible max-sum is at least `max(nums)`.
- **`hi = sum(nums)`**. Why? One giant chunk with everything always works (with `m = 1`, but it's a safe upper bound). For `m ≥ 1`, max-sum ≤ sum(nums).

### 1.3 Step 3 — Predicate

`feasible(S) := "can we partition nums into ≤ m contiguous chunks each with sum ≤ S?"`

Greedy: walk through `nums`, accumulate the current chunk's sum. When adding the next element would exceed `S`, start a new chunk. Count chunks. If chunks ≤ `m`, return true.

```python
def feasible(S):
    parts, cur = 1, 0
    for x in nums:
        if cur + x > S:
            parts += 1
            cur = 0
        cur += x
    return parts <= m
```

### 1.4 Step 4 — Monotonicity

If `S` works (feasible with `≤ m` chunks), then `S + 1` works too — every chunk that fit under budget `S` still fits under `S+1`, and we won't need more chunks. ∎

### 1.5 Step 5 — Solve

```python
def split_array(nums, m):
    def feasible(S):
        parts, cur = 1, 0
        for x in nums:
            if cur + x > S:
                parts += 1
                cur = 0
            cur += x
        return parts <= m

    lo, hi = max(nums), sum(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Go:**
```go
func SplitArray(nums []int, m int) int {
    lo, hi := 0, 0
    for _, x := range nums {
        if x > lo {
            lo = x
        }
        hi += x
    }
    feasible := func(S int) bool {
        parts, cur := 1, 0
        for _, x := range nums {
            if cur+x > S {
                parts++
                cur = 0
            }
            cur += x
        }
        return parts <= m
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public int splitArray(int[] nums, int m) {
    int lo = 0;
    long hi = 0;
    for (int x : nums) { if (x > lo) lo = x; hi += x; }
    while (lo < hi) {
        long mid = lo + (hi - lo) / 2;
        if (feasible(nums, m, mid)) hi = mid;
        else                         lo = (int)(mid + 1);
    }
    return lo;
}
private boolean feasible(int[] nums, int m, long S) {
    int parts = 1;
    long cur = 0;
    for (int x : nums) {
        if (cur + x > S) { parts++; cur = 0; }
        cur += x;
    }
    return parts <= m;
}
```

### 1.6 Complexity

- Answer space: `sum(nums) - max(nums)` ≤ `n × max(value)` ≤ `10^9` typically.
- Iterations: `log₂(10^9) ≈ 30`.
- Cost per `feasible`: O(n).
- **Total: O(n log(sum(nums)))**.

The DP solution for the same problem is **O(n² m)** — feasible only for small `n`. Parametric search handles `n = 10^5` effortlessly.

### 1.7 Why this is the "platonic ideal" parametric problem

Split Array Largest Sum is the cleanest example of the technique because:
- The answer space `[max(nums), sum(nums)]` is natural and tight.
- The predicate is a simple greedy scan.
- Monotonicity is intuitively obvious.
- The DP alternative exists but is much slower.

If you can solve LC 410 in 15 minutes from scratch, you have internalized the technique.

---

<a name="allocate-pages"></a>
## 2. Allocate Minimum Number of Pages — Same Pattern, Different Vocab

> Given `n` books with `pages[i]` pages each (in order) and `k` students, allocate **contiguous** subsets of books to students such that no book is shared and every student gets at least one book. Minimize the **maximum** pages any student reads. Return that minimum.

This is the Indian-interview classic. The wording obscures that it is **exactly** Split Array Largest Sum with `m = k` and `nums = pages`. The trick of recognizing the problem under a new vocabulary is itself a high-value skill.

### Mapping

| Allocate Pages | Split Array Largest Sum |
|---|---|
| books `pages[]` | `nums[]` |
| `k` students | `m` chunks |
| max pages any student reads | largest subarray sum |
| minimize that max | minimize that max |

Code is identical to §1. The only "trap" is the edge case `n < k` — you can't give every student at least one book if there aren't enough; return -1 or some sentinel.

```python
def allocate_pages(pages, k):
    if len(pages) < k:
        return -1
    # exactly Split Array
    def feasible(S):
        parts, cur = 1, 0
        for p in pages:
            if p > S:
                return False         # single book exceeds budget — impossible
            if cur + p > S:
                parts += 1
                cur = 0
            cur += p
        return parts <= k

    lo, hi = max(pages), sum(pages)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Lesson:** when you see a new "min-max" or "max-min" optimization problem, try mapping it to Split Array first. If contiguous partitioning is the structure, you're done.

---

<a name="magnetic-force"></a>
## 3. Magnetic Force Between Two Balls (LC 1552) — Max-Min Distance

> Given `position[]` (positions on a number line) and `m` balls, place the `m` balls into distinct positions such that the **minimum** pairwise distance between any two balls is **maximized**. Return that maximum minimum distance.

This is Aggressive Cows under a new name. The "max-min" structure is the giveaway.

### 3.1 Predicate

After sorting `position[]`, define:

`feasible(d) := "can we place m balls in positions such that consecutive (sorted) balls are ≥ d apart?"`

Greedy: place the first ball at `position[0]`. For each subsequent position, if it's ≥ `d` away from the last placed ball, place a new ball there. Count placements. If count ≥ m, return true.

### 3.2 Monotonicity (decreasing)

If `feasible(d)` is true, then `feasible(d - 1)` is also true — a smaller spacing is easier. The predicate looks like `true, true, …, true, false, false, …, false`. We want the **largest** `d` with `feasible(d) = true` → **find largest true** template (with the `+1` in mid).

### 3.3 Code

**Python:**
```python
def max_distance(position, m):
    position.sort()

    def feasible(d):
        count, last = 1, position[0]
        for p in position[1:]:
            if p - last >= d:
                count += 1
                last = p
                if count >= m:
                    return True
        return False

    lo, hi = 1, position[-1] - position[0]
    while lo < hi:
        mid = (lo + hi + 1) // 2     # find LARGEST: bias up
        if feasible(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo
```

**Go:**
```go
import "sort"

func MaxDistance(position []int, m int) int {
    sort.Ints(position)
    feasible := func(d int) bool {
        count, last := 1, position[0]
        for i := 1; i < len(position); i++ {
            if position[i]-last >= d {
                count++
                last = position[i]
                if count >= m {
                    return true
                }
            }
        }
        return false
    }
    lo, hi := 1, position[len(position)-1]-position[0]
    for lo < hi {
        mid := lo + (hi-lo+1)/2     // bias UP
        if feasible(mid) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return lo
}
```

**Java:**
```java
import java.util.Arrays;

public int maxDistance(int[] position, int m) {
    Arrays.sort(position);
    int lo = 1, hi = position[position.length - 1] - position[0];
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        if (canPlace(position, m, mid)) lo = mid;
        else                            hi = mid - 1;
    }
    return lo;
}
private boolean canPlace(int[] pos, int m, int d) {
    int count = 1, last = pos[0];
    for (int i = 1; i < pos.length; i++) {
        if (pos[i] - last >= d) {
            count++;
            last = pos[i];
            if (count >= m) return true;
        }
    }
    return false;
}
```

### 3.4 Why the `+1` is required

When the loop reaches `lo = 4, hi = 5` and `feasible(mid)` is true:
- Without `+1`: `mid = (4+5)//2 = 4`, set `lo = mid = 4`. No progress. Infinite loop.
- With `+1`: `mid = (4+5+1)//2 = 5`, set `lo = mid = 5`. Loop exits with `lo = hi = 5`. Correct.

The `+1` shifts mid toward `hi`, ensuring progress on the `lo = mid` branch.

---

<a name="kth-pair-distance"></a>
## 4. Find K-th Smallest Pair Distance (LC 719) — Search on Distance

> Given an integer array `nums[]`, compute the **k-th smallest** distance among all pairs. The distance of a pair `(a, b)` is `|a - b|`.

Example: `nums = [1, 3, 1]`, `k = 1`. Pairs: `(1,3), (1,1), (3,1)`. Distances: `2, 0, 2`. Sorted: `0, 2, 2`. 1st smallest = 0.

### 4.1 Naive

Generate all `C(n, 2)` distances, sort, return the k-th. `O(n² log n)` time, `O(n²)` space. For `n = 10^4`, that's 10^8 distances — too slow and too memory-heavy.

### 4.2 Parametric framing

The k-th smallest distance is the **smallest `d`** such that **at least `k` pairs have distance ≤ `d`**.

So: `feasible(d) := "count of pairs with distance ≤ d is at least k"`. Monotone in `d` (more pairs satisfy as `d` grows). Find smallest true → standard template.

### 4.3 Counting pairs ≤ d

After sorting `nums`, we count pairs `(i, j)` with `i < j` and `nums[j] - nums[i] ≤ d` using a **sliding window** (two pointers):

```python
def count_pairs_le(nums, d):
    nums_sorted = sorted(nums)
    n = len(nums_sorted)
    count, left = 0, 0
    for right in range(n):
        while nums_sorted[right] - nums_sorted[left] > d:
            left += 1
        count += right - left
    return count
```

This is O(n) after the O(n log n) sort. The outer binary search runs O(log max(nums)) iterations. Total: **O(n log n + n log(max(nums)))** — typically dominated by the sort.

### 4.4 Full solution

**Python:**
```python
def smallest_distance_pair(nums, k):
    nums.sort()
    n = len(nums)

    def count_le(d):
        count, left = 0, 0
        for right in range(n):
            while nums[right] - nums[left] > d:
                left += 1
            count += right - left
        return count

    lo, hi = 0, nums[-1] - nums[0]
    while lo < hi:
        mid = (lo + hi) // 2
        if count_le(mid) >= k:
            hi = mid
        else:
            lo = mid + 1
    return lo
```

**Go:**
```go
import "sort"

func SmallestDistancePair(nums []int, k int) int {
    sort.Ints(nums)
    n := len(nums)
    countLE := func(d int) int {
        count, left := 0, 0
        for right := 0; right < n; right++ {
            for nums[right]-nums[left] > d {
                left++
            }
            count += right - left
        }
        return count
    }
    lo, hi := 0, nums[n-1]-nums[0]
    for lo < hi {
        mid := lo + (hi-lo)/2
        if countLE(mid) >= k {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

**Java:**
```java
public int smallestDistancePair(int[] nums, int k) {
    java.util.Arrays.sort(nums);
    int n = nums.length;
    int lo = 0, hi = nums[n - 1] - nums[0];
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (countLE(nums, mid) >= k) hi = mid;
        else                          lo = mid + 1;
    }
    return lo;
}
private int countLE(int[] nums, int d) {
    int count = 0, left = 0;
    for (int right = 0; right < nums.length; right++) {
        while (nums[right] - nums[left] > d) left++;
        count += right - left;
    }
    return count;
}
```

### 4.5 Lesson

The technique generalizes:
- Want the **k-th** something? Binary search on **the value** of that something.
- The predicate becomes "count of items ≤ x is ≥ k".
- Counting "items ≤ x" is often a clever subroutine (sliding window, prefix sums, BIT).

This pattern shows up in **K-th smallest in a sorted matrix** (LC 378), **K-th smallest in a multiplication table** (LC 668), **Find the K-th smallest sum of pairs** (LC 373 variants), and many others. The skeleton is identical; only `count_le(x)` changes.

---

<a name="median-two-sorted"></a>
## 5. Median of Two Sorted Arrays (LC 4) as Parametric Search

> Two sorted arrays `a[]` of size `m` and `b[]` of size `n`. Find the median of the combined array in `O(log(min(m, n)))`.

The optimal solution is **parametric search on the partition position** — not on the median value.

### 5.1 The partition idea

The median splits the combined sorted array into two equal halves. We seek a "partition point" `i` in `a` and a corresponding `j = (m + n + 1) // 2 - i` in `b` such that:

- `a[i-1] <= b[j]` (everything to the left of the partition is ≤ everything to the right)
- `b[j-1] <= a[i]`

Once we find this `(i, j)`, the median is:
- If `m + n` is odd: `max(a[i-1], b[j-1])`.
- If `m + n` is even: `(max(a[i-1], b[j-1]) + min(a[i], b[j])) / 2`.

### 5.2 The predicate

`feasible(i) := "a[i-1] <= b[j] AND b[j-1] <= a[i]"` where `j = half - i`.

Tricky: this is **not** monotonic in the strict sense — it's true at exactly one `i` (modulo ties). But the **direction** of failure tells us which way to move:
- If `a[i-1] > b[j]`: `i` is too big — move left.
- If `b[j-1] > a[i]`: `i` is too small — move right.

This is parametric search where the predicate has **three** outcomes (left-shift, accept, right-shift) instead of two. The structure is still binary search, just with a slightly cleverer branching.

### 5.3 Code

**Python:**
```python
def find_median_sorted_arrays(a, b):
    if len(a) > len(b):
        a, b = b, a
    m, n = len(a), len(b)
    half = (m + n + 1) // 2
    lo, hi = 0, m
    INF = float('inf')
    while lo <= hi:
        i = (lo + hi) // 2
        j = half - i
        aL = a[i - 1] if i > 0 else -INF
        aR = a[i]     if i < m else  INF
        bL = b[j - 1] if j > 0 else -INF
        bR = b[j]     if j < n else  INF
        if aL <= bR and bL <= aR:
            if (m + n) % 2:
                return max(aL, bL)
            return (max(aL, bL) + min(aR, bR)) / 2
        elif aL > bR:
            hi = i - 1
        else:
            lo = i + 1
```

**Go:**
```go
import "math"

func FindMedianSortedArrays(a, b []int) float64 {
    if len(a) > len(b) {
        a, b = b, a
    }
    m, n := len(a), len(b)
    half := (m + n + 1) / 2
    lo, hi := 0, m
    inf := math.MaxInt32
    for lo <= hi {
        i := (lo + hi) / 2
        j := half - i
        aL, aR := -inf, inf
        if i > 0 {
            aL = a[i-1]
        }
        if i < m {
            aR = a[i]
        }
        bL, bR := -inf, inf
        if j > 0 {
            bL = b[j-1]
        }
        if j < n {
            bR = b[j]
        }
        if aL <= bR && bL <= aR {
            if (m+n)%2 == 1 {
                if aL > bL {
                    return float64(aL)
                }
                return float64(bL)
            }
            leftMax, rightMin := aL, aR
            if bL > leftMax {
                leftMax = bL
            }
            if bR < rightMin {
                rightMin = bR
            }
            return float64(leftMax+rightMin) / 2.0
        } else if aL > bR {
            hi = i - 1
        } else {
            lo = i + 1
        }
    }
    return 0
}
```

**Java:**
```java
public double findMedianSortedArrays(int[] a, int[] b) {
    if (a.length > b.length) { int[] t = a; a = b; b = t; }
    int m = a.length, n = b.length, half = (m + n + 1) / 2;
    int lo = 0, hi = m;
    while (lo <= hi) {
        int i = (lo + hi) / 2;
        int j = half - i;
        int aL = i == 0 ? Integer.MIN_VALUE : a[i - 1];
        int aR = i == m ? Integer.MAX_VALUE : a[i];
        int bL = j == 0 ? Integer.MIN_VALUE : b[j - 1];
        int bR = j == n ? Integer.MAX_VALUE : b[j];
        if (aL <= bR && bL <= aR) {
            if (((m + n) & 1) == 1) return Math.max(aL, bL);
            return (Math.max(aL, bL) + Math.min(aR, bR)) / 2.0;
        } else if (aL > bR) hi = i - 1;
        else                lo = i + 1;
    }
    return 0;
}
```

### 5.4 Why this counts as parametric search

We're searching the **answer space** `i ∈ [0, m]` — the partition position. The "predicate" is the partition validity. The structure is exactly binary search on the answer, with a slightly richer predicate that tells us not just "feasible / infeasible" but also which direction to move on failure. Median of Two Sorted Arrays is parametric search in disguise.

---

<a name="real-valued"></a>
## 6. Real-Valued Binary Search — Precision and Iteration Count

When the answer is a real number (a distance, a time, a rate that need not be an integer), the integer template breaks: `lo` and `hi` are floats, and `lo + 1 = lo` after enough iterations (the gap collapses below `eps`). We need a different convergence criterion.

### 6.1 The fixed-iteration template

```python
def parametric_float(lo, hi, feasible):
    for _ in range(100):
        mid = (lo + hi) / 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2
```

100 iterations halves the interval 2^100 ≈ 10^30 times. Starting from `[0, 10^9]`, the final width is `10^9 / 10^30 = 10^{-21}` — far below `double` precision (~10^{-15}).

### 6.2 Why fixed iterations beat epsilon convergence

The naive form:
```python
while hi - lo > 1e-9:
    mid = (lo + hi) / 2
    ...
```

is **dangerous** because:
- For very small `lo, hi` close to zero, denormals can cause `hi - lo` to stay flat.
- Floating-point representation may have `mid == lo` or `mid == hi` exactly, but `hi - lo > eps` still, looping forever.
- Different platforms/compilers handle subnormals differently.

A fixed iteration count is **bulletproof**: 100 (or even 50) iterations is enough to reach `double` precision on any reasonable input, and the loop always terminates.

### 6.3 Choosing the iteration count

- **50 iterations** → 1e-15 relative precision. Enough for `double` precision in most engineering contexts.
- **100 iterations** → 1e-30 — way past `double` precision, but cheap. Good default.
- **200+ iterations** — overkill, but sometimes seen in competitive programming as a "definitely enough" choice.

The cost is O(iterations × predicate_cost). 100 × O(n) is fine for n up to 10^6.

### 6.4 Worked example — Cube root

> Find `r` such that `r * r * r = x` with precision ≥ 1e-9.

```python
def cbrt(x):
    sign = 1 if x >= 0 else -1
    x = abs(x)
    lo, hi = 0.0, max(1.0, x)
    for _ in range(100):
        mid = (lo + hi) / 2
        if mid * mid * mid > x:
            hi = mid
        else:
            lo = mid
    return sign * (lo + hi) / 2
```

**Go:**
```go
import "math"

func Cbrt(x float64) float64 {
    sign := 1.0
    if x < 0 {
        sign = -1.0
        x = -x
    }
    lo, hi := 0.0, math.Max(1.0, x)
    for i := 0; i < 100; i++ {
        mid := (lo + hi) / 2
        if mid*mid*mid > x {
            hi = mid
        } else {
            lo = mid
        }
    }
    return sign * (lo + hi) / 2
}
```

**Java:**
```java
public double cbrt(double x) {
    double sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    double lo = 0, hi = Math.max(1.0, x);
    for (int i = 0; i < 100; i++) {
        double mid = (lo + hi) / 2;
        if (mid * mid * mid > x) hi = mid;
        else                     lo = mid;
    }
    return sign * (lo + hi) / 2;
}
```

### 6.5 Real-valued problems in production

Most real-valued bisection in practice happens in:
- **Game physics**: finding the exact time of collision between moving bodies (continuous collision detection).
- **Engineering simulation**: root finding for equations of state, solubility, equilibrium.
- **Image processing**: optimal threshold, exposure curve calibration.
- **Optimization**: finding the gain that produces a specific output level in a control system.
- **Financial modeling**: implied volatility (Black-Scholes inverse), yield curve calibration.

In each, the predicate is a slow simulation, and the "answer" is a continuous parameter. Bisection is the workhorse.

### 6.6 Avoiding catastrophe

- **Always sandwich**: pick `lo` and `hi` such that `feasible(lo) = false` and `feasible(hi) = true`. If both are the same, bisection can't make progress.
- **For functions with multiple roots**: bisection finds *some* root, not necessarily the smallest. If you need the smallest, narrow the interval first.
- **For oscillating predicates** (not strictly monotone): bisection is invalid. Use Newton's method with careful starts, or grid-search + local refinement.

---

<a name="when-not"></a>
## 7. When NOT to Use Parametric — Ternary Search and Enumeration

Parametric search isn't always the right tool. Two close cousins:

### 7.1 Ternary search

When the function you're optimizing is **unimodal** (increases then decreases, or vice versa) instead of monotonic, ternary search finds the optimum:

```python
def ternary_search_max(lo, hi, f, iterations=100):
    for _ in range(iterations):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

Used for:
- Finding the apex of a parabola.
- Optimizing a single parameter where the cost function is convex (or unimodal).
- Maximizing throughput as a function of one tunable knob (with monotone-up then monotone-down).

**Key distinction:** parametric uses a *boolean* predicate; ternary uses a real-valued *function* with a single peak/valley.

### 7.2 Direct enumeration

If the answer space is small (≤ 10^4 or so), just **enumerate** every candidate and find the best. No binary search needed.

For example: "find the smallest k ∈ [1, 100] such that …". 100 candidates × O(n) check = O(100 n) — done. Binary search would save you from 100 to ~7 evaluations, often not worth the complexity.

**Rule of thumb:** if `answer_range × predicate_cost` < 10^7 operations, enumerate. Otherwise, binary search.

### 7.3 When you should reach for DP instead

If the answer depends on **multiple** parameters (e.g., "find the best partition where each partition has cost ≤ S AND the number of partitions is exactly K"), parametric search on `S` alone may not work — the K constraint isn't naturally monotonic. Dynamic programming handles multi-objective optimization more cleanly.

That said: **many "DP problems" are also "parametric search on the answer" problems**. LC 410, LC 1011, LC 1102 (Path With Maximum Minimum Value) all have DP solutions and parametric solutions; the parametric is usually faster and simpler once you see it.

### 7.4 Quick decision tree

```
Is the answer a single number?               → maybe parametric
Is there a fast feasibility check?           → likely parametric
Is the predicate monotonic?                  → DEFINITELY parametric
Is the function unimodal but not monotonic?  → ternary search
Are there multiple objectives?               → DP
Is the answer range small?                   → enumerate
```

---

<a name="predicate-engineering"></a>
## 8. Predicate Engineering — Making `feasible(x)` Fast

The runtime of parametric search is `O(log(range) × feasible_cost)`. The log factor is fixed at ~30–60. Speeding up `feasible(x)` is where real engineering happens.

### 8.1 Greedy first, optimize later

Most predicates start as a greedy O(n) scan. That's usually enough. If `n = 10^5` and you do 30 iterations, you're at 3 × 10^6 — well under a 1-second budget.

### 8.2 Prefix sums to avoid recomputation

If `feasible(x)` repeatedly asks "sum from i to j", precompute a **prefix sum array** once before the binary search. Each query becomes O(1) instead of O(n).

Example: Split Array Largest Sum. Instead of accumulating a running sum inside `feasible`, precompute `prefix[i] = sum(nums[0..i])` once. Each chunk sum is `prefix[j] - prefix[i]`. Still O(n) per `feasible`, but with smaller constants and no risk of accidentally re-allocating the running sum buffer.

### 8.3 Avoid floating-point in integer predicates

Replace `math.ceil(p / k)` with `(p + k - 1) // k`. Replace `math.floor(p / k)` with `p // k`. Always faster, always exact. Don't mix floats and integers in predicates.

### 8.4 Two-pointer / sliding window inside `feasible`

For pairwise-distance and similar problems (LC 719), use two pointers to count in O(n) what a naive double loop would count in O(n²). The sliding-window inner loop is the difference between O(n log n) and O(n² log n) — which means feasible vs not feasible.

### 8.5 Memoize `feasible(x)` only if x repeats

`feasible(x)` is called once per binary-search iteration with **distinct** `x`. Memoization rarely helps. Don't add caching boilerplate unless you've profiled and confirmed repeated calls.

### 8.6 Pre-sort inputs once

If `feasible` requires sorted input (Aggressive Cows, Magnetic Force), sort **once** before the binary search, never inside `feasible`. Sorting inside the predicate turns O(n) into O(n log n) per call, total O(n log² n × log range) — usually too slow.

### 8.7 Avoid early-failure branches that hurt average case

In Aggressive Cows, you can `return False` early if `count` reaches a value that proves infeasibility, but be careful: in `feasible(d)`, returning `True` as soon as `count >= m` is the only safe early-exit. Premature `return False` based on heuristics can corrupt results.

### 8.8 Profile if it matters

If your `feasible` is dominating runtime and you've already squeezed it, consider:
- **SIMD vectorization** (in C/C++/Rust, often via libraries) for the inner loop.
- **Parallel feasibility evaluation** — if you can split the input into independent shards, each shard's contribution is independent and combinable.
- **Approximate predicate** — if you have an O(log n) approximation that's directionally correct, use it for the first ~half of iterations, then switch to exact for the final convergence.

For interview / competitive contexts, none of these matter — vanilla O(n) is fine. For production capacity-planning loops with `n = 10^9` and many binary searches per second, they do.

---

## Cheat Sheet — Pattern Selection

```
Find min capacity / speed / time / budget         → smallest-true template
Find max distance / max-min / min-max             → largest-true template (with +1)
K-th smallest of pairs/products/sums              → binary search on the value + count_le
Partition into k chunks with balanced max-sum     → smallest-true on max-sum
Median of two sorted arrays                       → binary search on partition position
Real-valued answer (cube root, time, etc)         → fixed iteration count (100)
Unimodal function optimum                         → ternary search
Tiny answer range (≤ 10^4)                        → enumerate, no binary search
Multi-objective optimization                      → DP, not parametric
```

---

## Further Reading

- **Errichto** — "Binary Search the Answer" tutorial (YouTube + Codeforces blog). Walks through LC 410, 1011, 1283 step by step.
- **Aakash Verma** / **Aditya Verma's** YouTube binary-search-on-answer playlist. Indian-style interview prep, very thorough.
- **Competitive Programmer's Handbook** by Antti Laaksonen, §3.3 (Binary search). Free PDF.
- **LeetCode tag** — "binary-search". Filter by difficulty Medium/Hard and look for problems whose title contains "minimum / maximum / smallest / largest". 80% are parametric.
- Continue with `senior.md` for production use cases (Kubernetes autoscaling, scheduler tuning, rate-limit calibration, database query timeout tuning) and `professional.md` for Megiddo's parametric-search theory and lower bounds.
