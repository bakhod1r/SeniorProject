# Activity Selection — Interview Preparation

> A tiered bank of questions (junior → middle → senior → professional/theory → behavioral) plus coding challenges in Go, Java, and Python. The recurring theme: *earliest finish time is the only optimal greedy key*, proven by an exchange argument, and the moment you add weights the greedy dies and DP takes over.

## Quick-Reference Cheat Sheet

```
PROBLEM:   max number of non-overlapping activities on one resource
ACTIVITY:  half-open interval [start, finish), start < finish
COMPATIBLE: f_A ≤ s_B  or  f_B ≤ s_A
ALGORITHM:  sort by finish ↑; lastEnd = -inf; take activity iff start >= lastEnd; lastEnd = finish
COMPLEXITY: O(n log n) sort + O(n) sweep = O(n log n);  O(1) extra space
WHY OPTIMAL: exchange argument / greedy stays ahead  (f(g_r) ≤ f(o_r) for all r)
WRONG KEYS: earliest start, shortest duration, fewest conflicts — all break
WEIGHTED:  greedy FAILS → DP  OPT(i) = max(OPT(i-1), v_i + OPT(p(i)))
PRE-SORTED: O(n);  BOUNDED INT TIMES: O(n + T) with counting sort
SIBLINGS:  interval partitioning (min rooms), EDF (min lateness), sweep line (max overlap)
```

Boundary reminder: half-open `[s, f)` ⇒ touching intervals are compatible ⇒ test with `start >= lastEnd`. Closed `[s, f]` ⇒ use `start > lastEnd`.

---

## Junior Questions (12 Q&A)

### J1. What does the Activity Selection problem ask?
Given `n` activities, each an interval `[start, finish)`, on a single resource that handles one activity at a time, select the **maximum number** of mutually non-overlapping activities.

### J2. State the greedy algorithm.
Sort by finish time ascending. Keep `lastEnd = −∞`. Scan in order; if an activity's `start ≥ lastEnd`, select it and set `lastEnd = finish`. The count of selected activities is the answer.

### J3. What is the greedy choice and why this one?
Among compatible remaining activities, pick the one that **finishes earliest**. Finishing earliest frees the resource soonest, leaving the most room for future activities — and it never costs you, since any alternative finishes at least as late.

### J4. What is the time and space complexity?
`O(n log n)` time, dominated by the sort; the sweep is `O(n)`. Space is `O(1)` extra (one `lastEnd` scalar) beyond the input.

### J5. When are two activities compatible?
When their intervals do not overlap: `f_A ≤ s_B` or `f_B ≤ s_A`. Under half-open `[s, f)`, touching (`f_A = s_B`) is compatible.

### J6. Why not sort by start time?
An activity that starts earliest can finish very late (`[0, 100)`) and block everything. Earliest-start is a classic *wrong* greedy.

### J7. Why not sort by shortest duration?
A short activity in the middle (`[3, 5)`) can straddle a boundary and block two longer compatible activities on either side. Shortest-duration is also wrong.

### J8. What does `lastEnd` represent?
The finish time of the most recently selected activity — the time the resource next becomes free. The next activity must start at or after it.

### J9. Does the algorithm give the count or the actual schedule?
Both are available: the running counter gives the count; recording each selected index gives the schedule (already in time order).

### J10. Walk through `[1,4), [3,5), [0,6), [5,7)`.
Finish-sorted already. Take `[1,4)` (lastEnd=4). Skip `[3,5)` (3<4) and `[0,6)` (0<4). Take `[5,7)` (5≥4, lastEnd=7). Answer: 2.

### J11. What happens with an empty input or a single activity?
Empty → 0. Single → 1. Handle the empty case before the loop.

### J12. How would you verify your implementation?
Write a brute-force subset enumerator (try all `2^n` subsets, keep compatible ones, take the largest) and compare to the greedy on random inputs with `n ≤ 18`.

### J13. What if all activities overlap each other?
You can pick only one (the earliest finisher). Answer is 1.

### J14. What if all activities are pairwise disjoint?
You pick all of them. Answer is `n`.

### J15. Does the order of equal-finish activities matter for the count?
No. Any tie-break gives the same maximum count, though the specific *set* chosen may differ.

---

## Middle Questions (12 Q&A)

### M1. Prove informally that earliest-finish is optimal.
"Greedy stays ahead": the `r`-th greedy activity finishes no later than the `r`-th activity of any optimal solution (`f(g_r) ≤ f(o_r)`). So greedy never falls behind and fits at least as many activities — hence exactly the optimum.

### M2. What is the exchange argument here?
Take any optimal solution; its earliest-finishing activity can be swapped for the *globally* earliest finisher without reducing size or breaking compatibility. Recursing proves greedy is optimal.

### M3. What is the greedy-choice property vs optimal substructure?
Greedy-choice: some optimum contains the earliest finisher (so committing to it is safe). Optimal substructure: after removing it, the rest is an optimum of the compatible-remainder subproblem.

### M4. What changes when activities have values?
You want max total value, not count. The greedy **fails** — a single high-value long activity can beat many low-value short ones. Use the weighted-interval DP.

### M5. State the weighted DP.
Sort by finish; `p(i)` = latest activity finishing `≤ s_i` (binary search). `OPT(i) = max(OPT(i−1), v_i + OPT(p(i)))`. `O(n log n)` time, `O(n)` space.

### M6. How is interval partitioning different?
Different objective: schedule **all** activities using the **fewest resources**. Sort by start, use a min-heap of resource free-times. The answer equals the maximum overlap depth.

### M7. What is the minimum-lateness variant?
Each job has a deadline; minimize the maximum lateness on one machine. Optimal greedy is **Earliest Deadline First**, proven by an adjacent-swap exchange argument — same proof shape, different key.

### M8. When can the algorithm run online in O(1)?
If activities arrive **already finish-ordered** and decisions are irrevocable: keep `lastEnd`, accept each arrival iff `start ≥ lastEnd`. Optimal, `O(1)` memory.

### M9. How do you handle the half-open vs closed boundary?
Half-open `[s, f)`: touching is compatible → `start >= lastEnd`. Closed `[s, f]`: touching conflicts → `start > lastEnd`. Pick one convention and keep it everywhere.

### M10. Can you beat O(n log n)?
If times are bounded integers in `[0, T)`, counting sort gives `O(n + T)`. If pre-sorted, `O(n)`. Otherwise `Ω(n log n)` is a comparison-model lower bound.

### M11. Why is the structure not a matroid?
The compatible sets form a downward-closed independence system but fail the matroid exchange axiom (two disjoint short intervals cannot augment a long overlapping one). That is exactly why the *weighted* greedy fails.

### M12. How do you reconstruct the schedule for the DP?
Walk the `dp` table backward: at `i`, if `v_i + dp[p(i)] ≥ dp[i−1]`, activity `i` is chosen (jump to `p(i)`); else move to `i−1`.

### M13. How does "Non-overlapping Intervals" (min removals) relate?
Minimum removals `= n − (max compatible set)`. Run the same EFT greedy to count the keepable set, subtract from `n`. This is the LeetCode framing of the same problem.

### M14. How does "Minimum Number of Arrows to Burst Balloons" relate?
It is the covering dual: the minimum number of stab points equals the maximum number of disjoint intervals. The same finish-sorted greedy solves it — place an arrow at each chosen finish.

---

## Senior Questions (10 Q&A)

### S1. Design a meeting-room "max bookings" service.
Pipeline: ingest → normalize all times to UTC epoch-ms half-open → validate (`start < finish`, dedup) → strategy-select by objective contract (`count` ⇒ EFT greedy) → solve (sort by finish + ID tie-break, sweep) → respond with schedule + metadata → cache on the canonical interval-set hash → observe.

### S2. What is the riskiest decision in such a service?
Picking the **objective**. The EFT greedy is correct only for max-count; using it for a value or min-rooms objective ships a plausible but wrong schedule. Make the objective an explicit typed contract.

### S3. How do you scale to billions of intervals?
The cost is the **sort**. Use parallel or external merge sort by finish, then a single streaming sweep (constant memory, `O(n)`). The sweep itself is sequential — do not parallelize it; parallelize the sort feeding it.

### S4. Why can't the sweep be parallelized?
Each decision reads `lastEnd`, which depends on all earlier accepted activities — a strict dependency chain. Parallelism lives in the sort and in independent per-resource problems, not the sweep.

### S5. What do you instrument in production?
Solve-latency by `n`, objective-mode counter, rejected-interval rate, selection ratio, cache hit ratio, and — most important — an oracle cross-check on small inputs plus a "no two selected overlap" assertion, since failures are silent.

### S6. How do you make results cacheable?
Pin a deterministic tie-break on equal finish times (e.g. by ID) and use integer epoch units. Then the output is reproducible and safe to cache on a canonical hash of the normalized interval multiset + objective.

### S7. What is the dominant failure mode and why is it dangerous?
A **silently sub-optimal or subtly invalid schedule** — wrong sort key, `>`/`>=` boundary bug, or wrong objective. There is no crash; the answer just looks right and is one activity short or overlapping. Guard with oracle + overlap assertions.

### S8. How do you handle messy time inputs?
Normalize everything to one monotonic unit (UTC epoch-ms) and half-open before the kernel. DST "fall back" can invert intervals; validate `start < finish` post-normalization and reject degenerates.

### S9. Capacity for a 5,000 req/s reservation service, n ≤ 500?
The kernel is ~`4.5×10³` comparisons/solve, trivial. The real cost is parsing, time normalization, and serialization. Size for I/O; cache aggressively on the interval-set hash.

### S10. When is the EFT greedy the wrong tool?
Whenever the objective is not max-count-on-one-resource: values (DP), minimum resources (interval partition), minimum lateness (EDF), or maximum concurrency (sweep line). Same intervals, different algorithm.

---

## Professional / Theory Questions (8 Q&A)

### P1. Give the full exchange-argument proof.
Lemma: any maximum compatible set `A*` can have its earliest-finishing activity `a_k` replaced by the globally earliest finisher `a_m` (`A' = A* \ {a_k} ∪ {a_m}`) — same size, still compatible because every other activity starts `≥ f_k ≥ f_m`. So some optimum contains `a_m`. Theorem: induct — greedy picks `a_m`, then solves the compatible-remainder subproblem optimally by hypothesis; optimal substructure gives `|A| = 1 + OPT(S') = OPT(S)`.

### P2. Give the greedy-stays-ahead proof.
Induct on `r`: `f(g_1) ≤ f(o_1)` (global earliest). Step: `o_r` starts `≥ f(o_{r−1}) ≥ f(g_{r−1})`, so it was available; greedy took the earliest finisher, so `f(g_r) ≤ f(o_r)`. If optimal had more activities, `o_{k+1}` would still be available to greedy after its `k` picks — contradiction. Hence equal size.

### P3. Why does the O(n³) DP collapse to O(n)?
The DP `c[i][j] = max_k (c[i][k] + 1 + c[k][j])` over splits `a_k ∈ S_{ij}` is provably maximized by the earliest finisher `a_m`, for which `S_{im} = ∅` (so `c[i][m]=0`). The recurrence becomes "take earliest, recurse right," i.e. the linear sweep.

### P4. State the comparison lower bound.
`Ω(n log n)`: sorting reduces to activity selection on disjoint intervals (recovering finish order recovers the sorted permutation), so any comparison-based selector that reports a full optimal disjoint schedule needs `Ω(n log n)` comparisons. The greedy's sort is information-theoretically necessary.

### P5. Why does the weighted greedy fail, formally?
The independence system of compatible sets is not a matroid, so the Rado–Edmonds weighted-greedy theorem does not apply. No total order on single activities captures the combinatorial value trade-off; DP is required.

### P6. State and justify the weighted DP recurrence.
`OPT(i) = max(OPT(i−1), v_i + OPT(p(i)))`, `p(i)` = latest `j` with `f_j ≤ s_i`. Either `a_i` is excluded (`OPT(i−1)`) or included (no activity between `p(i)` and `i` can coexist, so `v_i + OPT(p(i))`). Optimal substructure makes the max correct.

### P7. What is the covering dual?
Min number of points stabbing all intervals = max number of pairwise-disjoint intervals (a König-type min-max equality). The same finish-sorted greedy solves both; it reflects LP duality between the maximization and the covering LP.

### P8. Does optimal substructure alone justify greedy?
No. Substructure holds for the weighted version too, yet greedy fails there. The extra ingredient is the **greedy-choice property** (an optimum contains the earliest finisher), which holds for the unweighted problem but not the weighted one.

---

## Behavioral Questions (5)

### B1. Tell me about replacing an exponential approach with a polynomial one.
Frame: a naive subset/brute-force scheduler (`O(2^n)`) was timing out; recognizing the problem as activity selection let you ship the `O(n log n)` greedy. Emphasize verifying optimality against the old brute force on small inputs before trusting it.

### B2. Describe a bug caused by an interval-boundary mistake.
Frame: back-to-back bookings (`finish == next start`) were being wrongly rejected because of a strict `>` under a half-open convention. The fix (`>=`) plus a regression test on touching intervals. Lesson: pin the interval convention explicitly.

### B3. How did you decide between greedy and DP for a scheduling feature?
Frame: stakeholders initially said "schedule the most meetings"; once values/priorities entered, you recognized the greedy would be silently wrong and switched to the weighted DP. Emphasize pinning the *objective* before coding.

### B4. Explain a hard algorithm to a non-expert teammate.
Frame: explaining why "earliest finish" beats "earliest start" using the room-booking analogy and a single counterexample (`[0,100)` blocks everything). Concrete, minimal, memorable.

### B5. A time you wrote a verification harness before trusting code.
Frame: you built a brute-force oracle and property checks (no selected overlap, deterministic output) and wired them into CI, catching a wrong sort key that passed every functional test because the greedy never crashes.

---

## Coding Challenges

### Challenge 1 — Maximum Number of Compatible Activities (count + schedule)

Sort by finish, sweep with `lastEnd`. Return the count and the selected original indices.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func selectActivities(start, finish []int) (int, []int) {
	n := len(start)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return finish[order[a]] < finish[order[b]] })
	chosen := []int{}
	lastEnd := -1 << 62
	for _, i := range order {
		if start[i] >= lastEnd {
			chosen = append(chosen, i)
			lastEnd = finish[i]
		}
	}
	return len(chosen), chosen
}

func main() {
	start := []int{1, 3, 0, 5, 3, 5}
	finish := []int{4, 5, 6, 7, 8, 9}
	cnt, ids := selectActivities(start, finish)
	fmt.Println("count =", cnt, "ids =", ids) // 2, [0 3]
}
```

#### Java

```java
import java.util.*;

public class Challenge1 {
    static int[] order;
    static int[] select(int[] start, int[] finish) {
        int n = start.length;
        Integer[] ord = new Integer[n];
        for (int i = 0; i < n; i++) ord[i] = i;
        Arrays.sort(ord, (a, b) -> Integer.compare(finish[a], finish[b]));
        List<Integer> chosen = new ArrayList<>();
        long lastEnd = Long.MIN_VALUE;
        for (int i : ord)
            if (start[i] >= lastEnd) { chosen.add(i); lastEnd = finish[i]; }
        return chosen.stream().mapToInt(Integer::intValue).toArray();
    }
    public static void main(String[] args) {
        int[] start = {1, 3, 0, 5, 3, 5};
        int[] finish = {4, 5, 6, 7, 8, 9};
        int[] ids = select(start, finish);
        System.out.println("count = " + ids.length + " ids = " + Arrays.toString(ids)); // 2 [0,3]
    }
}
```

#### Python

```python
def select_activities(start, finish):
    order = sorted(range(len(start)), key=lambda i: finish[i])
    chosen, last_end = [], float("-inf")
    for i in order:
        if start[i] >= last_end:
            chosen.append(i)
            last_end = finish[i]
    return len(chosen), chosen


if __name__ == "__main__":
    start = [1, 3, 0, 5, 3, 5]
    finish = [4, 5, 6, 7, 8, 9]
    print(select_activities(start, finish))  # (2, [0, 3])
```

---

### Challenge 2 — Maximum Non-Overlapping Intervals (LeetCode "Non-overlapping Intervals" flavor)

Given intervals, return the minimum number to **remove** so the rest are non-overlapping. Equivalently `n − (max compatible set)`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func eraseOverlapIntervals(intervals [][]int) int {
	if len(intervals) == 0 {
		return 0
	}
	sort.Slice(intervals, func(a, b int) bool { return intervals[a][1] < intervals[b][1] })
	kept, lastEnd := 0, -1<<62
	for _, iv := range intervals {
		if iv[0] >= lastEnd {
			kept++
			lastEnd = iv[1]
		}
	}
	return len(intervals) - kept
}

func main() {
	fmt.Println(eraseOverlapIntervals([][]int{{1, 2}, {2, 3}, {3, 4}, {1, 3}})) // 1
}
```

#### Java

```java
import java.util.*;

public class Challenge2 {
    static int eraseOverlapIntervals(int[][] intervals) {
        if (intervals.length == 0) return 0;
        Arrays.sort(intervals, (a, b) -> Integer.compare(a[1], b[1]));
        int kept = 0; long lastEnd = Long.MIN_VALUE;
        for (int[] iv : intervals)
            if (iv[0] >= lastEnd) { kept++; lastEnd = iv[1]; }
        return intervals.length - kept;
    }
    public static void main(String[] args) {
        System.out.println(eraseOverlapIntervals(
            new int[][]{{1,2},{2,3},{3,4},{1,3}})); // 1
    }
}
```

#### Python

```python
def erase_overlap_intervals(intervals):
    if not intervals:
        return 0
    intervals.sort(key=lambda iv: iv[1])
    kept, last_end = 0, float("-inf")
    for s, f in intervals:
        if s >= last_end:
            kept += 1
            last_end = f
    return len(intervals) - kept


if __name__ == "__main__":
    print(erase_overlap_intervals([[1, 2], [2, 3], [3, 4], [1, 3]]))  # 1
```

---

### Challenge 3 — Weighted Interval Scheduling (when greedy fails, use DP)

Maximize total value of a compatible set. Demonstrates the DP that supersedes the greedy.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func maxValue(intervals [][3]int) int { // {start, finish, value}
	a := append([][3]int(nil), intervals...)
	sort.Slice(a, func(i, j int) bool { return a[i][1] < a[j][1] })
	n := len(a)
	p := make([]int, n)
	for i := 0; i < n; i++ {
		lo, hi, best := 0, i-1, -1
		for lo <= hi {
			mid := (lo + hi) / 2
			if a[mid][1] <= a[i][0] {
				best = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		p[i] = best
	}
	dp := make([]int, n+1)
	for i := 1; i <= n; i++ {
		take := a[i-1][2]
		if p[i-1] >= 0 {
			take += dp[p[i-1]+1]
		}
		if take > dp[i-1] {
			dp[i] = take
		} else {
			dp[i] = dp[i-1]
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(maxValue([][3]int{{0, 10, 5}, {1, 3, 1}, {4, 6, 1}})) // 5
}
```

#### Java

```java
import java.util.*;

public class Challenge3 {
    static int maxValue(int[][] iv) { // {start, finish, value}
        int[][] a = Arrays.stream(iv).map(int[]::clone).toArray(int[][]::new);
        Arrays.sort(a, (x, y) -> Integer.compare(x[1], y[1]));
        int n = a.length;
        int[] p = new int[n];
        for (int i = 0; i < n; i++) {
            int lo = 0, hi = i - 1, best = -1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (a[mid][1] <= a[i][0]) { best = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            p[i] = best;
        }
        int[] dp = new int[n + 1];
        for (int i = 1; i <= n; i++) {
            int take = a[i - 1][2] + (p[i - 1] >= 0 ? dp[p[i - 1] + 1] : 0);
            dp[i] = Math.max(dp[i - 1], take);
        }
        return dp[n];
    }
    public static void main(String[] args) {
        System.out.println(maxValue(new int[][]{{0,10,5},{1,3,1},{4,6,1}})); // 5
    }
}
```

#### Python

```python
from bisect import bisect_right

def max_value(iv):  # iv: list of (start, finish, value)
    a = sorted(iv, key=lambda x: x[1])
    finishes = [x[1] for x in a]
    n = len(a)
    p = [bisect_right(finishes, a[i][0], 0, i) - 1 for i in range(n)]
    dp = [0] * (n + 1)
    for i in range(1, n + 1):
        take = a[i - 1][2] + (dp[p[i - 1] + 1] if p[i - 1] >= 0 else 0)
        dp[i] = max(dp[i - 1], take)
    return dp[n]


if __name__ == "__main__":
    print(max_value([(0, 10, 5), (1, 3, 1), (4, 6, 1)]))  # 5
```

---

### Challenge 4 — Brute-Force Oracle (verify the greedy)

#### Python

```python
from itertools import combinations

def brute(intervals):
    n = len(intervals)
    for r in range(n, -1, -1):
        for comb in combinations(range(n), r):
            iv = sorted(intervals[i] for i in comb)
            if all(a[1] <= b[0] for a, b in zip(iv, iv[1:])):
                return r
    return 0


if __name__ == "__main__":
    iv = [(1, 4), (3, 5), (0, 6), (5, 7), (3, 8), (5, 9)]
    print(brute(iv))  # 2 — matches the greedy
```

---

## Common Pitfalls

- Sorting by start or duration instead of **finish** — the cardinal mistake.
- `>` vs `>=` boundary error on touching intervals — flips the answer.
- Forgetting to update `lastEnd` after a selection.
- Assuming the greedy solves the **weighted** version — it does not; use DP.
- Mutating the activity array when the caller needs original indices.
- Not handling the empty input (`0`) or single activity (`1`).
- Parallelizing the sweep (the `lastEnd` dependency forbids it) — parallelize the sort.

---

## What Interviewers Are Really Testing

- **Can you pick the right greedy key and *prove* it?** Stating "earliest finish" is table stakes; the exchange / stay-ahead argument is the differentiator.
- **Do you know the boundary where greedy breaks?** Weighted ⇒ DP, multi-resource ⇒ partition, lateness ⇒ EDF. Recognizing the objective is the senior skill.
- **Can you reason about complexity and lower bounds?** `O(n log n)`, `O(n)` pre-sorted, `O(n + T)` bounded ints, `Ω(n log n)` comparison bound.
- **Do you handle conventions and edge cases?** Half-open vs closed, ties, empty input, back-to-back compatibility.
- **Do you verify?** A brute-force oracle and overlap assertions, because greedy failures are silent.

Master the four-line algorithm, one counterexample for each wrong key, and either optimality proof, and you can carry any activity-selection interview from the junior screen to the system-design round.

A final tip: when an interviewer presents *any* problem phrased over time intervals, your first move is to ask "what is the objective — count, value, rooms, lateness, or concurrency?" Naming the objective out loud both demonstrates the senior instinct and routes you to the correct algorithm before you write a line of code.

