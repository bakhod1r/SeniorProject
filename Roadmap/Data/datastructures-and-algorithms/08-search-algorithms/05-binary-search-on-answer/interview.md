# Binary Search on Answer — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for software engineering interviews at companies that ask DSA. Covers conceptual Q&A across levels and 8 coding challenges (all famous parametric-search problems) with full Go / Java / Python solutions.

---

## Section A — Conceptual Questions

### Junior level

**Q1. What is "binary search on the answer"?**
Instead of binary-searching an array, you binary-search the **space of possible answers**. You define a monotonic feasibility predicate `feasible(x): bool` over the answer space, then use the find-first-true template to locate the boundary. The answer is the smallest (or largest) value where the predicate flips.

**Q2. Why is monotonicity required?**
Binary search only works when the predicate's value sequence is `false…false true…true` (or vice versa). Without monotonicity, knowing `feasible(mid)` tells you nothing about `feasible(mid + 1)`, so you can't decide which half to discard. You get silent wrong answers.

**Q3. What are the four ingredients of a parametric search problem?**
(1) An answer space `[lo, hi]`. (2) A predicate `feasible(x)`. (3) Monotonicity of the predicate. (4) The search direction (find smallest true vs find largest true).

**Q4. What's the total time complexity?**
`O(log(hi - lo) × cost_of_feasible)`. Each iteration halves the answer space and runs one feasibility check.

**Q5. How do you pick `lo` and `hi`?**
`lo` is the smallest value that could possibly be the answer (often 1 or `min(input)`). `hi` is a value that's *clearly* feasible (often `max(input)` or `sum(input)`). Be generous; the log factor doesn't care.

**Q6. What problems are most famously solved by binary search on the answer?**
Koko Eating Bananas (LC 875), Capacity to Ship Packages (LC 1011), Aggressive Cows (SPOJ), Allocate Pages (GFG), Magnetic Force Between Two Balls (LC 1552), Split Array Largest Sum (LC 410), Find K-th Smallest Pair Distance (LC 719).

**Q7. How does this differ from plain binary search?**
Plain binary search looks for a target value in a sorted array (index space). Parametric search looks for the boundary of a monotonic predicate over the value space. The underlying find-first-true template is identical; only the domain interpretation changes.

### Middle level

**Q8. Walk me through Koko Eating Bananas (LC 875).**
Koko has piles, has `h` hours, eats `min(pile, k)` per hour from one pile. Find min `k`. Answer space `[1, max(piles)]`. Predicate `feasible(k) := "hours_needed(k) ≤ h"` where `hours_needed(k) = sum(ceil(pile / k) for pile in piles)`. Monotone in `k` because higher speed → fewer hours. Standard find-smallest-true template, O(n log(max(piles))).

**Q9. Why does "find largest" need `mid = lo + (hi - lo + 1) / 2`?**
The `+1` biases mid toward `hi`. Without it, when `lo = hi - 1` and `feasible(mid) = true`, we set `lo = mid = lo` — infinite loop. The `+1` ensures `mid > lo` always, so the `lo = mid` branch makes progress.

**Q10. How do you handle real-valued answers (e.g., distance with floats)?**
Use a fixed iteration count, typically 100. Each iteration halves the interval. After 100 iterations the precision is `(hi - lo) / 2^100`, far below `double` precision. Avoid `while hi - lo > eps` — denormals can cause infinite loops.

**Q11. How do you find the K-th smallest pair distance (LC 719)?**
Binary search on the distance `d`. Predicate `feasible(d) := "count of pairs with distance ≤ d is ≥ k"`. Counting uses a sliding window on the sorted array. Total O(n log n + n log(max)).

**Q12. When is parametric search NOT applicable?**
When the predicate is non-monotonic, when the answer is multi-dimensional, when the feasibility check is too expensive, or when the answer range is too small to justify the log overhead (just enumerate).

**Q13. What's the difference between parametric search and ternary search?**
Parametric: monotonic boolean predicate; finds boundary. Ternary: unimodal real function; finds maximum or minimum. Different problem shapes.

### Senior level

**Q14. How would you find the optimal Kubernetes pod CPU request?**
Bisect CPU millicores in `[100, 8000]`. Predicate: run a 5-minute load test at the candidate setting, check whether p99 < SLO. Monotone (more CPU → lower latency). About 13 iterations × 5 min = ~65 min total. Mitigate noise by averaging multiple runs or using confidence-interval bisection.

**Q15. How do you calibrate a database query timeout?**
Collect a 24-hour query duration log, sort it. The smallest timeout `t` such that `≤ 0.1%` of queries exceed it is at index `n × 0.999`. A single bisection on the sorted distribution. In production, recalibrate weekly or on workload shifts.

**Q16. What happens if the production feasibility check is noisy?**
The predicate may not be strictly monotonic across small differences. Mitigations: (1) run the check multiple times and take the median, (2) use confidence-interval bisection (only commit when the CI is fully on one side), (3) bias toward safety (test against `SLO × 0.8` instead of `SLO`), (4) fall back to grid search.

**Q17. Why might monotonicity break in a real Kubernetes autoscaler?**
NUMA boundaries (CPU at 2 vs 3 cores changes scheduler behavior), warm-up effects, GC pressure transitions, external dependencies changing under the test, multi-tenant noise. Verify monotonicity on a control sweep before relying on bisection.

### Professional level

**Q18. State the lower bound for parametric search.**
`Ω(log N)` predicate evaluations in the worst case, where `N` is the answer-space size. Proof: decision-tree argument — there are `N` possible monotone predicates, and a binary decision tree distinguishing them has depth `≥ ⌈log₂ N⌉`. Bisection achieves this bound exactly.

**Q19. What is Megiddo's parametric search?**
A technique (1979) that breaks the log factor by simulating the inner feasibility algorithm symbolically in λ. Each comparison in the inner algorithm becomes a linear inequality in λ; solving all inequalities locates λ* in the same complexity as one inner-algorithm call. Used in minimum-mean-cycle, k-clustering, and linear programming.

**Q20. How does Dinkelbach's algorithm compare to bisection?**
Dinkelbach's algorithm is Newton's method on the parametric fractional objective. Quadratic convergence (instead of bisection's linear convergence) for smooth objectives, but requires differentiability and good starting points. For discrete combinatorial predicates, bisection is more robust. Used in maximum-density-subgraph and minimum-ratio-spanning-tree.

---

## Section B — Coding Challenges

### Challenge 1 — Koko Eating Bananas (LeetCode 875)

> Koko has `piles[]` bananas, `h` hours. Each hour she eats `min(pile, k)` from one pile. Find min integer `k`.

**Strategy:** parametric search on `k ∈ [1, max(piles)]`. Predicate: hours_needed(k) ≤ h.

**Go:**
```go
func minEatingSpeed(piles []int, h int) int {
    lo, hi := 1, 0
    for _, p := range piles { if p > hi { hi = p } }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if hoursNeeded(piles, mid) <= h { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
func hoursNeeded(piles []int, k int) int {
    h := 0
    for _, p := range piles { h += (p + k - 1) / k }
    return h
}
```

**Java:**
```java
public int minEatingSpeed(int[] piles, int h) {
    int lo = 1, hi = 0;
    for (int p : piles) if (p > hi) hi = p;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (hoursNeeded(piles, mid) <= h) hi = mid;
        else                              lo = mid + 1;
    }
    return lo;
}
private long hoursNeeded(int[] piles, int k) {
    long total = 0;
    for (int p : piles) total += (p + (long)k - 1) / k;
    return total;
}
```

**Python:**
```python
def minEatingSpeed(piles, h):
    def hours(k): return sum((p + k - 1) // k for p in piles)
    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        if hours(mid) <= h: hi = mid
        else: lo = mid + 1
    return lo
```

**Complexity:** O(n log(max(piles))).

---

### Challenge 2 — Capacity to Ship Packages Within D Days (LeetCode 1011)

> Find minimum truck capacity to ship weights in given order within D days.

**Go:**
```go
func shipWithinDays(weights []int, D int) int {
    lo, hi := 0, 0
    for _, w := range weights {
        if w > lo { lo = w }
        hi += w
    }
    days := func(cap int) int {
        d, load := 1, 0
        for _, w := range weights {
            if load+w > cap { d++; load = 0 }
            load += w
        }
        return d
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if days(mid) <= D { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

**Java:**
```java
public int shipWithinDays(int[] weights, int D) {
    int lo = 0, hi = 0;
    for (int w : weights) { if (w > lo) lo = w; hi += w; }
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (daysNeeded(weights, mid) <= D) hi = mid;
        else                                lo = mid + 1;
    }
    return lo;
}
private int daysNeeded(int[] w, int cap) {
    int days = 1, load = 0;
    for (int x : w) {
        if (load + x > cap) { days++; load = 0; }
        load += x;
    }
    return days;
}
```

**Python:**
```python
def shipWithinDays(weights, D):
    def days(cap):
        d, load = 1, 0
        for w in weights:
            if load + w > cap: d += 1; load = 0
            load += w
        return d
    lo, hi = max(weights), sum(weights)
    while lo < hi:
        mid = (lo + hi) // 2
        if days(mid) <= D: hi = mid
        else: lo = mid + 1
    return lo
```

**Complexity:** O(n log(sum(weights))).

---

### Challenge 3 — Split Array Largest Sum (LeetCode 410)

> Split nums into m non-empty contiguous subarrays minimizing the largest subarray sum.

**Go:**
```go
func splitArray(nums []int, m int) int {
    lo, hi := 0, 0
    for _, x := range nums { if x > lo { lo = x }; hi += x }
    feasible := func(S int) bool {
        parts, cur := 1, 0
        for _, x := range nums {
            if cur+x > S { parts++; cur = 0 }
            cur += x
        }
        return parts <= m
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) { hi = mid } else { lo = mid + 1 }
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
        if (canSplit(nums, m, mid)) hi = mid;
        else                         lo = (int)(mid + 1);
    }
    return lo;
}
private boolean canSplit(int[] nums, int m, long S) {
    int parts = 1;
    long cur = 0;
    for (int x : nums) {
        if (cur + x > S) { parts++; cur = 0; }
        cur += x;
    }
    return parts <= m;
}
```

**Python:**
```python
def splitArray(nums, m):
    def feasible(S):
        parts, cur = 1, 0
        for x in nums:
            if cur + x > S: parts += 1; cur = 0
            cur += x
        return parts <= m
    lo, hi = max(nums), sum(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid): hi = mid
        else: lo = mid + 1
    return lo
```

**Complexity:** O(n log(sum(nums))).

---

### Challenge 4 — Aggressive Cows (SPOJ AGGRCOW)

> Place k cows in stalls to maximize the minimum pairwise distance.

**Go:**
```go
import "sort"

func aggressiveCows(stalls []int, k int) int {
    sort.Ints(stalls)
    feasible := func(d int) bool {
        count, last := 1, stalls[0]
        for i := 1; i < len(stalls); i++ {
            if stalls[i]-last >= d {
                count++
                last = stalls[i]
                if count >= k { return true }
            }
        }
        return false
    }
    lo, hi := 1, stalls[len(stalls)-1]-stalls[0]
    for lo < hi {
        mid := lo + (hi-lo+1)/2     // find LARGEST
        if feasible(mid) { lo = mid } else { hi = mid - 1 }
    }
    return lo
}
```

**Java:**
```java
public int aggressiveCows(int[] stalls, int k) {
    java.util.Arrays.sort(stalls);
    int lo = 1, hi = stalls[stalls.length - 1] - stalls[0];
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        if (canPlace(stalls, k, mid)) lo = mid;
        else                          hi = mid - 1;
    }
    return lo;
}
private boolean canPlace(int[] s, int k, int d) {
    int count = 1, last = s[0];
    for (int i = 1; i < s.length; i++) {
        if (s[i] - last >= d) {
            count++; last = s[i];
            if (count >= k) return true;
        }
    }
    return false;
}
```

**Python:**
```python
def aggressive_cows(stalls, k):
    stalls.sort()
    def feasible(d):
        count, last = 1, stalls[0]
        for x in stalls[1:]:
            if x - last >= d:
                count += 1; last = x
                if count >= k: return True
        return False
    lo, hi = 1, stalls[-1] - stalls[0]
    while lo < hi:
        mid = (lo + hi + 1) // 2     # find LARGEST: bias UP
        if feasible(mid): lo = mid
        else: hi = mid - 1
    return lo
```

**Complexity:** O(n log n + n log(stalls[-1] - stalls[0])).

---

### Challenge 5 — Magnetic Force Between Two Balls (LeetCode 1552)

> Place m balls in given positions to maximize minimum pairwise distance.

Identical to Aggressive Cows. Sort positions, find largest `d` with `feasible(d) = true`.

**Python:**
```python
def maxDistance(position, m):
    position.sort()
    def feasible(d):
        count, last = 1, position[0]
        for p in position[1:]:
            if p - last >= d:
                count += 1; last = p
                if count >= m: return True
        return False
    lo, hi = 1, position[-1] - position[0]
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if feasible(mid): lo = mid
        else: hi = mid - 1
    return lo
```

**Go:**
```go
import "sort"

func maxDistance(position []int, m int) int {
    sort.Ints(position)
    feasible := func(d int) bool {
        count, last := 1, position[0]
        for i := 1; i < len(position); i++ {
            if position[i]-last >= d {
                count++; last = position[i]
                if count >= m { return true }
            }
        }
        return false
    }
    lo, hi := 1, position[len(position)-1]-position[0]
    for lo < hi {
        mid := lo + (hi-lo+1)/2
        if feasible(mid) { lo = mid } else { hi = mid - 1 }
    }
    return lo
}
```

**Java:**
```java
public int maxDistance(int[] position, int m) {
    java.util.Arrays.sort(position);
    int lo = 1, hi = position[position.length - 1] - position[0];
    while (lo < hi) {
        int mid = lo + (hi - lo + 1) / 2;
        if (canPlace(position, m, mid)) lo = mid;
        else                            hi = mid - 1;
    }
    return lo;
}
private boolean canPlace(int[] p, int m, int d) {
    int count = 1, last = p[0];
    for (int i = 1; i < p.length; i++) {
        if (p[i] - last >= d) {
            count++; last = p[i];
            if (count >= m) return true;
        }
    }
    return false;
}
```

---

### Challenge 6 — Smallest Divisor Given a Threshold (LeetCode 1283)

> Choose smallest integer divisor `d` such that `sum(ceil(nums[i] / d)) ≤ threshold`.

**Strategy:** parametric search on `d ∈ [1, max(nums)]`.

**Python:**
```python
def smallestDivisor(nums, threshold):
    def feasible(d):
        return sum((x + d - 1) // d for x in nums) <= threshold
    lo, hi = 1, max(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid): hi = mid
        else: lo = mid + 1
    return lo
```

**Go:**
```go
func smallestDivisor(nums []int, threshold int) int {
    hi := 0
    for _, x := range nums { if x > hi { hi = x } }
    feasible := func(d int) bool {
        total := 0
        for _, x := range nums { total += (x + d - 1) / d }
        return total <= threshold
    }
    lo := 1
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

**Java:**
```java
public int smallestDivisor(int[] nums, int threshold) {
    int lo = 1, hi = 0;
    for (int x : nums) if (x > hi) hi = x;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        long total = 0;
        for (int x : nums) total += (x + mid - 1) / mid;
        if (total <= threshold) hi = mid;
        else                    lo = mid + 1;
    }
    return lo;
}
```

**Complexity:** O(n log(max(nums))).

---

### Challenge 7 — Find K-th Smallest Pair Distance (LeetCode 719)

> Find the k-th smallest |nums[i] - nums[j]| among all pairs.

**Strategy:** sort `nums`, then binary-search on the distance value. Predicate: count of pairs with distance ≤ d is ≥ k.

**Python:**
```python
def smallestDistancePair(nums, k):
    nums.sort()
    n = len(nums)
    def count_le(d):
        count, left = 0, 0
        for right in range(n):
            while nums[right] - nums[left] > d: left += 1
            count += right - left
        return count
    lo, hi = 0, nums[-1] - nums[0]
    while lo < hi:
        mid = (lo + hi) // 2
        if count_le(mid) >= k: hi = mid
        else: lo = mid + 1
    return lo
```

**Go:**
```go
import "sort"

func smallestDistancePair(nums []int, k int) int {
    sort.Ints(nums)
    n := len(nums)
    countLE := func(d int) int {
        count, left := 0, 0
        for right := 0; right < n; right++ {
            for nums[right]-nums[left] > d { left++ }
            count += right - left
        }
        return count
    }
    lo, hi := 0, nums[n-1]-nums[0]
    for lo < hi {
        mid := lo + (hi-lo)/2
        if countLE(mid) >= k { hi = mid } else { lo = mid + 1 }
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

**Complexity:** O(n log n + n log(max - min)).

---

### Challenge 8 — Minimum Days to Make m Bouquets (LeetCode 1482)

> `bloomDay[i]` is the day flower `i` blooms. To make a bouquet, take `k` adjacent bloomed flowers. Find min day to make `m` bouquets, or -1 if impossible.

**Strategy:** parametric on the day `d`. Predicate: with all flowers bloomed by day `d`, can we form `m` bouquets of `k` adjacent flowers?

**Python:**
```python
def minDays(bloomDay, m, k):
    if m * k > len(bloomDay): return -1
    def feasible(d):
        bouquets, run = 0, 0
        for b in bloomDay:
            if b <= d:
                run += 1
                if run == k:
                    bouquets += 1
                    run = 0
            else:
                run = 0
        return bouquets >= m
    lo, hi = min(bloomDay), max(bloomDay)
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid): hi = mid
        else: lo = mid + 1
    return lo
```

**Go:**
```go
func minDays(bloomDay []int, m, k int) int {
    if m*k > len(bloomDay) { return -1 }
    lo, hi := bloomDay[0], bloomDay[0]
    for _, b := range bloomDay {
        if b < lo { lo = b }
        if b > hi { hi = b }
    }
    feasible := func(d int) bool {
        bouquets, run := 0, 0
        for _, b := range bloomDay {
            if b <= d {
                run++
                if run == k { bouquets++; run = 0 }
            } else {
                run = 0
            }
        }
        return bouquets >= m
    }
    for lo < hi {
        mid := lo + (hi-lo)/2
        if feasible(mid) { hi = mid } else { lo = mid + 1 }
    }
    return lo
}
```

**Java:**
```java
public int minDays(int[] bloomDay, int m, int k) {
    if ((long)m * k > bloomDay.length) return -1;
    int lo = Integer.MAX_VALUE, hi = 0;
    for (int b : bloomDay) { if (b < lo) lo = b; if (b > hi) hi = b; }
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (feasibleBouquets(bloomDay, m, k, mid)) hi = mid;
        else                                       lo = mid + 1;
    }
    return lo;
}
private boolean feasibleBouquets(int[] bloomDay, int m, int k, int d) {
    int bouquets = 0, run = 0;
    for (int b : bloomDay) {
        if (b <= d) {
            run++;
            if (run == k) { bouquets++; run = 0; }
        } else {
            run = 0;
        }
    }
    return bouquets >= m;
}
```

**Complexity:** O(n log(max - min)).

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Forgetting the `+1` in `mid` for find-largest
When using the find-largest-true template, `mid = lo + (hi - lo) / 2` (no `+1`) and `lo = mid` causes infinite loops when `lo = hi - 1`. Always use `mid = lo + (hi - lo + 1) / 2` for find-largest.

### Pitfall 2 — Non-monotonic predicate
The predicate must be monotonic. Verify with small inputs: walk through `feasible(1), feasible(2), …, feasible(N)` and confirm `false…false true…true` pattern. If not, parametric search is invalid.

### Pitfall 3 — Wrong direction template
"Find smallest k such that …" → standard template. "Find largest k such that …" → +1 in mid, swap branches. Mixing them returns wrong answers, often off by one.

### Pitfall 4 — Picking `hi` too tight
If `hi` itself is infeasible, the search returns wrong. Always make `hi` provably feasible (e.g., `sum(weights)` for partition problems).

### Pitfall 5 — Integer overflow in feasibility sum
In Java/Go, summing `n=10^5` values of `10^9` overflows `int32`. Use `long` / `int64`. Python is immune.

### Pitfall 6 — Using `math.ceil(p / k)` instead of `(p + k - 1) // k`
Float division is slow and imprecise. Always use integer arithmetic for integer predicates.

### Pitfall 7 — Real-valued bisection with epsilon convergence
`while hi - lo > eps:` can loop forever due to floating-point edge cases. Use a fixed iteration count (e.g., 100).

### Pitfall 8 — Reusing state across `feasible` calls
The predicate must be pure. State leakage (a counter declared outside the function but updated inside) causes nondeterministic results.

### Pitfall 9 — Confusing "≥" with ">"
For find-smallest-true, the predicate is "value ≤ S" → set `hi = mid` when true. If you accidentally use "value < S", you'll be off by one on the boundary.

### Pitfall 10 — Returning `mid` instead of `lo`
The boundary is in `lo` at loop exit (`lo == hi`). `mid` is whatever was last tested, often not the answer.

---

## Section D — Mock Interview Drill (45 minutes)

A typical parametric-search interview will combine:
1. **Warmup** (5 min): "Tell me what binary search is. Now tell me what binary-search-on-the-answer is."
2. **Easy parametric** (10 min): Koko Eating Bananas or Smallest Divisor.
3. **Medium parametric** (15 min): Capacity to Ship Packages or Split Array Largest Sum.
4. **Hard parametric** (10 min): K-th Smallest Pair Distance or Aggressive Cows (note the find-largest variant).
5. **Discussion** (5 min): "What if the predicate isn't strictly monotonic? What if it's noisy? What if the answer is a real number?"

**Drill questions to practice aloud:**
- *"Walk me through Koko Eating Bananas. What's the answer space? What's the predicate? Why is it monotonic?"*
- *"For Aggressive Cows, why is the `+1` in `mid` necessary?"*
- *"How do you find the K-th smallest pair distance? Why use a sliding window inside the predicate?"*
- *"How would you adapt parametric search if the feasibility check is noisy (a load test)?"*
- *"What's the lower bound for parametric search? Why?"*

Memorize the **five-step recipe** (phrase as min/max, identify answer space, define predicate, prove monotonicity, plug into template) and the **two template variants** (find smallest, find largest with `+1`). With those, 90% of interview parametric-search questions become mechanical.

---

## Section E — Recognition Patterns

The interviewer is likely asking a parametric-search problem if you see any of these phrases in the problem statement:

| Phrase | Likely template |
|---|---|
| "Minimum X such that …" | find smallest true |
| "Maximum X such that …" | find largest true |
| "Smallest divisor / speed / capacity / time" | find smallest true |
| "Max-min distance / min-max load" | find largest / smallest true |
| "Fewest workers / fewest days" | find smallest true (predicate: count ≤ budget) |
| "Largest median / minimum that works" | find largest true |
| "K-th smallest of {something computable}" | binary search on the value + count_le predicate |
| "Allocate / partition into k chunks" | smallest-true on the max-chunk-size |
| "Place k items to optimize spacing" | largest-true on the spacing |

If the problem **doesn't** match one of these, it's likely DP, greedy, or graph — not parametric. Don't force the tool.

---

## Closing

Parametric search is the most-asked Hard problem family in 2025 interviews — Meta, Amazon, Google all use Koko / Ship Packages / Split Array variants weekly. **Master the five-step recipe and the two template variants** and you'll solve them on autopilot. The interviewer's signal is the phrase "minimum / maximum X such that …" — once you hear it, your brain should produce the answer-space binary search template within seconds.
