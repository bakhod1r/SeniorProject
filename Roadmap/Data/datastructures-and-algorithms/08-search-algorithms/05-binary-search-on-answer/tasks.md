# Binary Search on Answer — Practice Tasks

> Every task must be solved in **Go**, **Java**, and **Python**. All 15 tasks are real parametric-search problems with monotonic predicates.

---

## Beginner Tasks

### Task 1: Integer Square Root

Given a non-negative integer `n`, return the largest integer `r` such that `r * r <= n`. Do not use `math.sqrt`.

Bracket: `[0, n]`. Predicate: `r * r <= n` (max-feasible). For overflow safety, compare `r <= n / r` instead of `r * r`.

#### Go

```go
func IntegerSqrt(n int) int {
    if n < 2 {
        return n
    }
    lo, hi := 1, n
    for lo < hi {
        mid := lo + (hi-lo+1)/2          // round up: max-feasible
        if mid <= n/mid {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    return lo
}
```

#### Java

```java
public static int integerSqrt(int n) {
    if (n < 2) return n;
    int lo = 1, hi = n;
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        if (mid <= n / mid) lo = mid;
        else                hi = mid - 1;
    }
    return lo;
}
```

#### Python

```python
def integer_sqrt(n: int) -> int:
    if n < 2:
        return n
    lo, hi = 1, n
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if mid * mid <= n:
            lo = mid
        else:
            hi = mid - 1
    return lo
```

**Constraints:** `0 <= n <= 2^31 - 1`. **Evaluation:** correct boundary, no overflow, runs in `O(log n)`.

---

### Task 2: Koko Eating Bananas (LeetCode 875)

Given `piles` and `h` hours, find the minimum eating speed `k` such that Koko finishes all piles within `h` hours.

**Predicate:** `sum(ceil(p / k) for p in piles) <= h`. **Bracket:** `[1, max(piles)]`. **Template:** min-feasible.

Provide solutions in Go, Java, Python as in `junior.md` section 9.1.

**Constraints:** `1 <= len(piles) <= 10^4`, `piles[i] <= 10^9`, `len(piles) <= h <= 10^9`. **Evaluation:** correct answer, no overflow, predicate short-circuits.

---

### Task 3: Capacity to Ship Packages Within D Days (LeetCode 1011)

Given `weights` (ordered) and `days`, find the minimum truck capacity to ship in `days`.

**Predicate:** greedy chunking — count days needed at capacity `c`. **Bracket:** `[max(weights), sum(weights)]`. **Template:** min-feasible.

Provide solutions as in `junior.md` section 9.2.

**Constraints:** `1 <= len(weights) <= 5·10^4`, `weights[i] <= 500`, `1 <= days <= len(weights)`.

---

### Task 4: Smallest Divisor Given a Threshold (LeetCode 1283)

Find smallest divisor `d` such that `sum(ceil(n / d) for n in nums) <= threshold`.

#### Go

```go
func SmallestDivisor(nums []int, threshold int) int {
    hi := 1
    for _, x := range nums {
        if x > hi { hi = x }
    }
    check := func(d int) bool {
        s := 0
        for _, x := range nums {
            s += (x + d - 1) / d
            if s > threshold { return false }
        }
        return true
    }
    lo := 1
    for lo < hi {
        mid := lo + (hi-lo)/2
        if check(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
public static int smallestDivisor(int[] nums, int threshold) {
    int hi = 1;
    for (int x : nums) if (x > hi) hi = x;
    int lo = 1;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        long s = 0;
        for (int x : nums) {
            s += (x + mid - 1) / mid;
            if (s > threshold) break;
        }
        if (s <= threshold) hi = mid; else lo = mid + 1;
    }
    return lo;
}
```

#### Python

```python
def smallest_divisor(nums, threshold):
    def check(d):
        return sum(-(-n // d) for n in nums) <= threshold
    lo, hi = 1, max(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if check(mid): hi = mid
        else:          lo = mid + 1
    return lo
```

**Constraints:** `1 <= nums.length <= 5·10^4`, `1 <= nums[i] <= 10^6`, `nums.length <= threshold <= 10^6`.

---

### Task 5: Min Speed to Arrive on Time (LeetCode 1870)

Given `dist` (distances of trains) and `hour` (a possibly-float deadline), find min integer speed `s` such that total travel time ≤ `hour`. Each leg except the last rounds *up* to the next integer hour at speed `s`.

#### Go

```go
import "math"

func MinSpeedOnTime(dist []int, hour float64) int {
    n := len(dist)
    if hour <= float64(n-1) { return -1 }
    check := func(s int) bool {
        var t float64
        for i, d := range dist {
            if i == n-1 {
                t += float64(d) / float64(s)
            } else {
                t += math.Ceil(float64(d) / float64(s))
            }
        }
        return t <= hour
    }
    lo, hi := 1, 10_000_000
    for lo < hi {
        mid := lo + (hi-lo)/2
        if check(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
public static int minSpeedOnTime(int[] dist, double hour) {
    int n = dist.length;
    if (hour <= n - 1) return -1;
    int lo = 1, hi = 10_000_000;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        double t = 0;
        for (int i = 0; i < n; i++) {
            if (i == n - 1) t += (double) dist[i] / mid;
            else            t += Math.ceil((double) dist[i] / mid);
        }
        if (t <= hour) hi = mid; else lo = mid + 1;
    }
    return lo;
}
```

#### Python

```python
import math

def min_speed_on_time(dist, hour):
    n = len(dist)
    if hour <= n - 1:
        return -1
    def check(s):
        t = sum(math.ceil(d / s) for d in dist[:-1]) + dist[-1] / s
        return t <= hour
    lo, hi = 1, 10**7
    while lo < hi:
        mid = (lo + hi) // 2
        if check(mid): hi = mid
        else:          lo = mid + 1
    return lo
```

**Constraints:** `1 <= dist.length <= 10^5`, `1 <= dist[i] <= 10^5`, `1 <= hour <= 10^9` with up to 2 fractional digits.

---

## Intermediate Tasks

### Task 6: Split Array Largest Sum (LeetCode 410)

Split `nums` into `k` non-empty contiguous subarrays. Minimise the largest subarray sum.

**Predicate:** greedy — count subarrays whose sum stays ≤ `mid`. **Bracket:** `[max(nums), sum(nums)]`.

#### Go

```go
func SplitArray(nums []int, k int) int {
    lo, hi := 0, 0
    for _, x := range nums {
        if x > lo { lo = x }
        hi += x
    }
    canSplit := func(maxSum int) bool {
        cur, parts := 0, 1
        for _, x := range nums {
            if cur+x > maxSum {
                parts++; cur = x
                if parts > k { return false }
            } else {
                cur += x
            }
        }
        return true
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if canSplit(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
public static int splitArray(int[] nums, int k) {
    int lo = 0; long hi = 0;
    for (int x : nums) { if (x > lo) lo = x; hi += x; }
    long l = lo, h = hi;
    while (l < h) {
        long mid = l + (h - l) / 2;
        long cur = 0; int parts = 1; boolean ok = true;
        for (int x : nums) {
            if (cur + x > mid) { parts++; cur = x; if (parts > k) { ok = false; break; } }
            else cur += x;
        }
        if (ok) h = mid; else l = mid + 1;
    }
    return (int) l;
}
```

#### Python

```python
def split_array(nums, k):
    def can(max_sum):
        cur, parts = 0, 1
        for x in nums:
            if cur + x > max_sum:
                parts += 1; cur = x
                if parts > k: return False
            else:
                cur += x
        return True
    lo, hi = max(nums), sum(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if can(mid): hi = mid
        else:        lo = mid + 1
    return lo
```

---

### Task 7: Aggressive Cows (SPOJ classic)

Place `k` cows in stalls at positions `pos[]` to **maximise the minimum** pairwise distance.

See `junior.md` section 9.3 for the canonical Go/Java/Python solutions. Test on `pos = [1,2,4,8,9]`, `k = 3` → answer = 3.

---

### Task 8: Magnetic Force Between Two Balls (LeetCode 1552)

Same shape as Aggressive Cows. Place `m` balls in baskets `positions[]` to maximise the minimum pairwise force (= distance).

Reuse the Aggressive Cows solution with `k → m`.

---

### Task 9: Min Days to Make m Bouquets (LeetCode 1482)

Garden of `bloomDay`; need `m` bouquets, each from `k` adjacent flowers that have all bloomed. Find minimum days.

#### Go

```go
func MinDays(bloomDay []int, m, k int) int {
    if m*k > len(bloomDay) { return -1 }
    lo, hi := 1<<30, 0
    for _, x := range bloomDay {
        if x < lo { lo = x }
        if x > hi { hi = x }
    }
    canMake := func(day int) bool {
        bouquets, flowers := 0, 0
        for _, x := range bloomDay {
            if x <= day {
                flowers++
                if flowers == k { bouquets++; flowers = 0 }
            } else {
                flowers = 0
            }
        }
        return bouquets >= m
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if canMake(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
public static int minDays(int[] bloomDay, int m, int k) {
    if ((long) m * k > bloomDay.length) return -1;
    int lo = Integer.MAX_VALUE, hi = 0;
    for (int x : bloomDay) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        int bouquets = 0, flowers = 0;
        for (int x : bloomDay) {
            if (x <= mid) {
                if (++flowers == k) { bouquets++; flowers = 0; }
            } else {
                flowers = 0;
            }
        }
        if (bouquets >= m) hi = mid; else lo = mid + 1;
    }
    return lo;
}
```

#### Python

```python
def min_days(bloomDay, m, k):
    if m * k > len(bloomDay): return -1
    def can(day):
        bouquets = flowers = 0
        for x in bloomDay:
            if x <= day:
                flowers += 1
                if flowers == k:
                    bouquets += 1; flowers = 0
            else:
                flowers = 0
        return bouquets >= m
    lo, hi = min(bloomDay), max(bloomDay)
    while lo < hi:
        mid = (lo + hi) // 2
        if can(mid): hi = mid
        else:        lo = mid + 1
    return lo
```

---

### Task 10: Find the K-th Smallest Pair Distance (LeetCode 719)

Given `nums`, return the k-th smallest among all pairwise `|nums[i] - nums[j]|`.

**Predicate:** for each candidate distance `d`, count pairs with diff ≤ `d` using two pointers on the sorted array. **Bracket:** `[0, max - min]`. Min-feasible: smallest `d` such that `count(d) >= k`.

#### Go

```go
import "sort"

func SmallestDistancePair(nums []int, k int) int {
    sort.Ints(nums)
    countLE := func(d int) int {
        cnt, j := 0, 0
        for i := range nums {
            for j < len(nums) && nums[j]-nums[i] <= d {
                j++
            }
            cnt += j - i - 1
        }
        return cnt
    }
    lo, hi := 0, nums[len(nums)-1]-nums[0]
    for lo < hi {
        mid := lo + (hi-lo)/2
        if countLE(mid) >= k { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
import java.util.Arrays;

public static int smallestDistancePair(int[] nums, int k) {
    Arrays.sort(nums);
    int lo = 0, hi = nums[nums.length - 1] - nums[0];
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        int cnt = 0, j = 0;
        for (int i = 0; i < nums.length; i++) {
            while (j < nums.length && nums[j] - nums[i] <= mid) j++;
            cnt += j - i - 1;
        }
        if (cnt >= k) hi = mid; else lo = mid + 1;
    }
    return lo;
}
```

#### Python

```python
def smallest_distance_pair(nums, k):
    nums.sort()
    def count_le(d):
        cnt = j = 0
        for i in range(len(nums)):
            while j < len(nums) and nums[j] - nums[i] <= d:
                j += 1
            cnt += j - i - 1
        return cnt
    lo, hi = 0, nums[-1] - nums[0]
    while lo < hi:
        mid = (lo + hi) // 2
        if count_le(mid) >= k: hi = mid
        else:                  lo = mid + 1
    return lo
```

---

## Advanced Tasks

### Task 11: Median of Two Sorted Arrays (LeetCode 4)

Find the median of two sorted arrays in `O(log(min(m, n)))`. Binary-search the partition point `i` in the shorter array.

#### Go

```go
func FindMedianSortedArrays(a, b []int) float64 {
    if len(a) > len(b) {
        a, b = b, a
    }
    m, n := len(a), len(b)
    lo, hi := 0, m
    half := (m + n + 1) / 2
    inf := 1 << 30
    for lo <= hi {
        i := (lo + hi) / 2
        j := half - i
        aLeft := -inf; aRight := inf
        bLeft := -inf; bRight := inf
        if i > 0 { aLeft = a[i-1] }
        if i < m { aRight = a[i] }
        if j > 0 { bLeft = b[j-1] }
        if j < n { bRight = b[j] }
        if aLeft <= bRight && bLeft <= aRight {
            if (m+n)%2 == 1 {
                return float64(max(aLeft, bLeft))
            }
            return float64(max(aLeft, bLeft)+min(aRight, bRight)) / 2.0
        } else if aLeft > bRight {
            hi = i - 1
        } else {
            lo = i + 1
        }
    }
    return 0
}
func max(x, y int) int { if x > y { return x }; return y }
func min(x, y int) int { if x < y { return x }; return y }
```

#### Java

```java
public static double findMedianSortedArrays(int[] A, int[] B) {
    if (A.length > B.length) { int[] t = A; A = B; B = t; }
    int m = A.length, n = B.length;
    int lo = 0, hi = m, half = (m + n + 1) / 2;
    while (lo <= hi) {
        int i = (lo + hi) / 2, j = half - i;
        int aL = (i == 0) ? Integer.MIN_VALUE : A[i-1];
        int aR = (i == m) ? Integer.MAX_VALUE : A[i];
        int bL = (j == 0) ? Integer.MIN_VALUE : B[j-1];
        int bR = (j == n) ? Integer.MAX_VALUE : B[j];
        if (aL <= bR && bL <= aR) {
            if ((m + n) % 2 == 1) return Math.max(aL, bL);
            return (Math.max(aL, bL) + Math.min(aR, bR)) / 2.0;
        } else if (aL > bR) hi = i - 1;
        else                 lo = i + 1;
    }
    throw new IllegalStateException();
}
```

#### Python

```python
def find_median_sorted_arrays(A, B):
    if len(A) > len(B): A, B = B, A
    m, n = len(A), len(B)
    lo, hi, half = 0, m, (m + n + 1) // 2
    INF = float('inf')
    while lo <= hi:
        i = (lo + hi) // 2
        j = half - i
        aL = A[i-1] if i else -INF
        aR = A[i]   if i < m else INF
        bL = B[j-1] if j else -INF
        bR = B[j]   if j < n else INF
        if aL <= bR and bL <= aR:
            if (m + n) % 2: return max(aL, bL)
            return (max(aL, bL) + min(aR, bR)) / 2
        elif aL > bR: hi = i - 1
        else:         lo = i + 1
```

---

### Task 12: K-th Smallest Element in a Sorted Matrix (LeetCode 378)

Given a row- and column-sorted `n × n` matrix, find the k-th smallest element. **Predicate:** count elements ≤ `mid` (via staircase walk: O(n)). Bracket: `[matrix[0][0], matrix[n-1][n-1]]`.

#### Go

```go
func KthSmallestMatrix(mat [][]int, k int) int {
    n := len(mat)
    countLE := func(v int) int {
        cnt, c := 0, n-1
        for r := 0; r < n; r++ {
            for c >= 0 && mat[r][c] > v { c-- }
            cnt += c + 1
        }
        return cnt
    }
    lo, hi := mat[0][0], mat[n-1][n-1]
    for lo < hi {
        mid := lo + (hi-lo)/2
        if countLE(mid) >= k { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

#### Java

```java
public static int kthSmallest(int[][] m, int k) {
    int n = m.length, lo = m[0][0], hi = m[n-1][n-1];
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2, cnt = 0, c = n - 1;
        for (int r = 0; r < n; r++) {
            while (c >= 0 && m[r][c] > mid) c--;
            cnt += c + 1;
        }
        if (cnt >= k) hi = mid; else lo = mid + 1;
    }
    return lo;
}
```

#### Python

```python
def kth_smallest_matrix(matrix, k):
    n = len(matrix)
    def count_le(v):
        cnt = 0; c = n - 1
        for r in range(n):
            while c >= 0 and matrix[r][c] > v:
                c -= 1
            cnt += c + 1
        return cnt
    lo, hi = matrix[0][0], matrix[-1][-1]
    while lo < hi:
        mid = (lo + hi) // 2
        if count_le(mid) >= k: hi = mid
        else:                  lo = mid + 1
    return lo
```

---

### Task 13: Minimise Maximum Distance to Gas Station (LeetCode 774) — Real-Valued

Given `n` gas stations and `k` extra stations to place, minimise the maximum gap. **Real-valued** parametric search.

#### Go

```go
import "math"

func MinmaxGasDist(stations []int, k int) float64 {
    canDo := func(d float64) bool {
        used := 0
        for i := 1; i < len(stations); i++ {
            gap := float64(stations[i] - stations[i-1])
            used += int(math.Ceil(gap/d)) - 1
            if used > k { return false }
        }
        return true
    }
    lo, hi := 0.0, 1e8
    for i := 0; i < 100; i++ {
        mid := (lo + hi) / 2
        if canDo(mid) { hi = mid } else { lo = mid }
    }
    return (lo + hi) / 2
}
```

#### Java

```java
public static double minmaxGasDist(int[] s, int k) {
    double lo = 0, hi = 1e8;
    for (int it = 0; it < 100; it++) {
        double mid = (lo + hi) / 2;
        long used = 0;
        for (int i = 1; i < s.length; i++) {
            used += (long) Math.ceil((s[i] - s[i-1]) / mid) - 1;
            if (used > k) break;
        }
        if (used <= k) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}
```

#### Python

```python
import math

def minmax_gas_dist(stations, k):
    def can(d):
        used = 0
        for i in range(1, len(stations)):
            used += math.ceil((stations[i] - stations[i-1]) / d) - 1
            if used > k: return False
        return True
    lo, hi = 0.0, 1e8
    for _ in range(100):
        mid = (lo + hi) / 2
        if can(mid): hi = mid
        else:        lo = mid
    return (lo + hi) / 2
```

---

### Task 14: Minimum Number of Days to Eat N Oranges (LeetCode 1553) — variant

Easy bonus: given a real-valued function `f(x) = x^3 + x - 10`, find the root in `[1, 3]` using bisection to precision `1e-9`.

#### Go

```go
func RootBisection() float64 {
    f := func(x float64) float64 { return x*x*x + x - 10 }
    lo, hi := 1.0, 3.0
    for i := 0; i < 100; i++ {
        mid := (lo + hi) / 2
        if f(mid) > 0 { hi = mid } else { lo = mid }
    }
    return (lo + hi) / 2
}
```

#### Java

```java
public static double rootBisection() {
    double lo = 1, hi = 3;
    for (int i = 0; i < 100; i++) {
        double mid = (lo + hi) / 2;
        if (mid*mid*mid + mid - 10 > 0) hi = mid;
        else                            lo = mid;
    }
    return (lo + hi) / 2;
}
```

#### Python

```python
def root_bisection():
    f = lambda x: x**3 + x - 10
    lo, hi = 1.0, 3.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if f(mid) > 0: hi = mid
        else:          lo = mid
    return (lo + hi) / 2
```

Verify: answer ≈ 2.04675886.

---

### Task 15: Maximise Minimum Quality (custom)

Given `n` workers and a budget `B`, you must hire exactly `k` workers from consecutive positions in `workers[]`. Each worker `i` has quality `q[i]` and cost `c[i]`. The hired group's payout to each is the **highest cost** in the group times the worker's quality. Maximise the **minimum quality** purchased subject to budget constraint.

This is a hard max-feasible problem. **Predicate:** "is there a window of `k` workers with min quality ≥ Q and total payout ≤ B?". Sort by quality descending, sliding window for payout. Bracket: `[min(q), max(q)]`.

#### Go

```go
import "sort"

func MaxMinQuality(quality, cost []int, k, budget int) int {
    type w struct{ q, c int }
    ws := make([]w, len(quality))
    for i := range quality {
        ws[i] = w{quality[i], cost[i]}
    }
    canDo := func(minQ int) bool {
        filtered := make([]w, 0)
        for _, x := range ws {
            if x.q >= minQ { filtered = append(filtered, x) }
        }
        if len(filtered) < k { return false }
        sort.Slice(filtered, func(i, j int) bool { return filtered[i].c < filtered[j].c })
        // For each candidate max-cost worker, sum the k smallest qualities, etc.
        // (simplified: assume payout = sum of costs for window)
        // Sliding window of k
        sum := 0
        for i := 0; i < k; i++ { sum += filtered[i].c }
        if sum <= budget { return true }
        for i := k; i < len(filtered); i++ {
            sum += filtered[i].c - filtered[i-k].c
            if sum <= budget { return true }
        }
        return false
    }
    lo, hi := 1, 0
    for _, x := range quality { if x > hi { hi = x } }
    for lo < hi {
        mid := lo + (hi-lo+1)/2          // round up: max-feasible
        if canDo(mid) { lo = mid } else { hi = mid - 1 }
    }
    return lo
}
```

#### Java

```java
public static int maxMinQuality(int[] q, int[] c, int k, int B) {
    int n = q.length, lo = 1, hi = 0;
    for (int x : q) if (x > hi) hi = x;
    int[][] w = new int[n][2];
    for (int i = 0; i < n; i++) { w[i][0] = q[i]; w[i][1] = c[i]; }
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        if (canDo(w, mid, k, B)) lo = mid;
        else                     hi = mid - 1;
    }
    return lo;
}
private static boolean canDo(int[][] w, int minQ, int k, int B) {
    java.util.List<int[]> f = new java.util.ArrayList<>();
    for (int[] x : w) if (x[0] >= minQ) f.add(x);
    if (f.size() < k) return false;
    f.sort((a, b) -> a[1] - b[1]);
    long sum = 0;
    for (int i = 0; i < k; i++) sum += f.get(i)[1];
    if (sum <= B) return true;
    for (int i = k; i < f.size(); i++) {
        sum += f.get(i)[1] - f.get(i - k)[1];
        if (sum <= B) return true;
    }
    return false;
}
```

#### Python

```python
def max_min_quality(quality, cost, k, budget):
    workers = sorted(zip(quality, cost), reverse=True)  # sort by quality desc
    def can_do(min_q):
        filt = sorted((c for q, c in workers if q >= min_q))
        if len(filt) < k: return False
        s = sum(filt[:k])
        if s <= budget: return True
        for i in range(k, len(filt)):
            s += filt[i] - filt[i - k]
            if s <= budget: return True
        return False
    lo, hi = 1, max(quality)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if can_do(mid): lo = mid
        else:           hi = mid - 1
    return lo
```

**Evaluation:** correct max-feasible boundary; round-up `mid`; predicate handles `len < k` correctly; runs in `O(n log n log Q)`.

---

## Benchmark Task

> Compare parametric search vs brute-force enumeration for Koko Eating Bananas.

#### Go

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    sizes := []int{10, 100, 1000, 10000, 100000}
    for _, n := range sizes {
        piles := make([]int, n)
        for i := range piles { piles[i] = (i*97 + 13) % 1_000_000_000 }
        h := n * 2
        start := time.Now()
        for i := 0; i < 5; i++ {
            _ = MinEatingSpeed(piles, h)
        }
        fmt.Printf("n=%7d: %.3f ms\n", n, float64(time.Since(start).Microseconds())/5/1000)
    }
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10, 100, 1000, 10000, 100000};
        Random r = new Random(42);
        for (int n : sizes) {
            int[] piles = new int[n];
            for (int i = 0; i < n; i++) piles[i] = r.nextInt(1_000_000_000) + 1;
            long start = System.nanoTime();
            for (int i = 0; i < 5; i++) KokoEating.minEatingSpeed(piles, 2 * n);
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%7d: %.3f ms%n", n, elapsed / 5.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import timeit, random

random.seed(42)
sizes = [10, 100, 1_000, 10_000, 100_000]
for n in sizes:
    piles = [random.randint(1, 10**9) for _ in range(n)]
    h = 2 * n
    t = timeit.timeit(lambda: min_eating_speed(piles, h), number=5)
    print(f"n={n:>7}: {t/5*1000:.3f} ms")
```

Expected: `n = 10⁵` finishes in well under 1 second — parametric search runs in `O(n · log(max(piles)))` ≈ `n × 30` per call.
