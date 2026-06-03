# Interval Scheduling Variations — Interview Preparation

> A tiered bank of 48 questions and answers — from "what is activity selection" to "prove EDF optimal" and "why does greedy fail on weighted scheduling" — followed by full coding challenges (including LeetCode **Meeting Rooms II** and **Non-overlapping Intervals**) in Go, Java, and Python. Use the question tiers to self-assess: junior should answer Tier 1–2, mid Tier 3, senior/staff Tier 4–5.

## Table of Contents
1. [Tier 1 — Fundamentals (Q1–Q12)](#tier-1--fundamentals)
2. [Tier 2 — Choosing the Right Variation (Q13–Q22)](#tier-2--choosing-the-right-variation)
3. [Tier 3 — Algorithm Mechanics (Q23–Q33)](#tier-3--algorithm-mechanics)
4. [Tier 4 — Proofs & Optimality (Q34–Q42)](#tier-4--proofs--optimality)
5. [Tier 5 — Systems & Scale (Q43–Q48)](#tier-5--systems--scale)
6. [Coding Challenge 1 — Meeting Rooms II](#coding-challenge-1--meeting-rooms-ii)
7. [Coding Challenge 2 — Non-overlapping Intervals](#coding-challenge-2--non-overlapping-intervals)
8. [Coding Challenge 3 — Weighted Interval Scheduling](#coding-challenge-3--weighted-interval-scheduling)
9. [Coding Challenge 4 — Minimize Maximum Lateness](#coding-challenge-4--minimize-maximum-lateness)
10. [Rapid-Fire Review](#rapid-fire-review)

---

## Tier 1 — Fundamentals

**Q1. What is the basic activity-selection problem?**
Given `n` intervals each with a start and finish time, select the maximum *number* of mutually non-overlapping (compatible) intervals. The greedy solution sorts by finish time and repeatedly takes the next interval whose start is `≥` the last taken finish.

**Q2. Why sort by finish time, not start time?**
The interval that finishes earliest leaves the most room for the rest. Sorting by start can let one long early interval block many later ones. Sorting by finish admits the "greedy stays ahead" optimality proof; other keys do not.

**Q3. When are two intervals "compatible"?**
They do not overlap. Under the half-open `[start, end)` convention, `a` and `b` conflict iff `a.start < b.finish && b.start < a.finish`; intervals that merely touch (`a.end == b.start`) are compatible.

**Q4. What are the four main interval-scheduling variations?**
(1) Activity selection — max count (greedy by finish). (2) Weighted interval scheduling — max value (DP). (3) Interval partitioning — fewest rooms for all intervals (min-heap of end times). (4) Minimize maximum lateness — order on one machine by deadline (EDF).

**Q5. What is the time complexity of activity selection?**
`O(n log n)`, dominated by the sort; the sweep is `O(n)`.

**Q6. What does "interval partitioning" ask?**
Assign *every* interval to a "room" (machine/track) so that no room holds two overlapping intervals, using the fewest rooms possible.

**Q7. What is the "depth" of a set of intervals?**
The maximum number of intervals that are simultaneously live (overlap) at any single point in time. It equals the minimum number of rooms needed for partitioning.

**Q8. What does EDF stand for and what does it do?**
Earliest-Deadline-First: schedule jobs in increasing order of deadline. It minimizes the maximum lateness on a single machine.

**Q9. Define lateness.**
For a job with deadline `d` completing at time `f`, lateness `= max(0, f − d)`. A job finishing before its deadline has lateness 0.

**Q10. Which variation does NOT use greedy?**
Weighted interval scheduling. It requires dynamic programming; no fixed greedy rule is optimal when intervals carry differing weights and you select a subset.

**Q11. What is "Non-overlapping Intervals" (LeetCode 435) in terms of activity selection?**
It asks for the minimum number of intervals to *remove* so the rest are non-overlapping. That equals `n − (max compatible subset)` = `n − activity_selection`.

**Q12. What data structure powers interval partitioning?**
A min-heap of the end times of currently-busy rooms. The minimum tells you which room frees up soonest, so you can reuse it.

---

## Tier 2 — Choosing the Right Variation

**Q13. A calendar app wants to book the most meetings into one room. Which algorithm?**
Activity selection (greedy by finish time) — maximize the count of compatible meetings.

**Q14. Now it wants the *most valuable* meetings (each has a priority) in one room. Which algorithm?**
Weighted interval scheduling (DP) — maximize total value, not count.

**Q15. The app wants to know how many rooms to rent so every requested meeting fits. Which algorithm?**
Interval partitioning — the answer is the depth (max overlap), found with the min-heap or a sweep line.

**Q16. A printer has due-dated jobs; minimize the worst overdue. Which algorithm?**
EDF — sort by deadline, run in that order; minimizes the maximum lateness.

**Q17. How do you decide greedy vs DP for an interval problem?**
Ask: am I *selecting a subset* AND do intervals carry *differing weights I maximize*? If both yes → DP. Otherwise (count, partitioning, lateness) greedy works.

**Q18. What's the litmus test that an interval problem is partitioning, not selection?**
You must accommodate *all* intervals (none are rejected); you only choose how many resources. Selection problems reject some intervals.

**Q19. Why might someone wrongly use greedy on a weighted problem?**
Because the unweighted greedy is so clean, people assume "sort by finish and take" generalizes. It does not: a single heavy interval can be worth more than several light ones it overlaps, or vice versa.

**Q20. "Schedule jobs on k machines to fit all of them" — which concept?**
Interval partitioning feasibility: all jobs fit on `k` machines iff `depth ≤ k`. Compute depth via a sweep and compare to `k`.

**Q21. Which variation maps to LeetCode 1235 "Maximum Profit in Job Scheduling"?**
Weighted interval scheduling — exactly the `OPT(j) = max(OPT(j-1), w_j + OPT(p(j)))` DP with binary search.

**Q22. Does EDF help minimize the *number* of late jobs?**
No. EDF minimizes the *maximum* lateness. Minimizing the *number* of late jobs is the Moore–Hodgson algorithm (a different greedy with a max-heap). Match the exact objective.

---

## Tier 3 — Algorithm Mechanics

**Q23. Write the weighted-interval DP recurrence.**
Sort by finish. `p(j)` = last index `i<j` with `finish_i ≤ start_j`. Then `OPT(j) = max(OPT(j-1), w_j + OPT(p(j)))`, `OPT(0)=0`, answer `OPT(n)`.

**Q24. How is `p(j)` computed efficiently?**
Binary search on the finish-sorted array: the predicate `finish_i ≤ start_j` is monotone (true on a prefix), so binary search finds the largest such `i` in `O(log n)`.

**Q25. Walk through the min-heap partitioning algorithm.**
Sort intervals by start. For each interval: if the heap's minimum end time ≤ this start, pop it (reuse that room); push this interval's end. Track the heap's peak size — that's the room count.

**Q26. Why does the heap's peak size equal the depth?**
A new room is opened only when all current rooms are busy, i.e. that many intervals overlap right then. So peak rooms = max simultaneous overlap = depth.

**Q27. Give the sweep-line method for depth (no heap).**
Make `+1` events at starts and `−1` at ends; sort by time (with `−1` before `+1` at ties for half-open); track a running sum; the maximum is the depth.

**Q28. In EDF, why is running jobs back-to-back with no idle gaps safe?**
Removing idle time only shifts completion times earlier, which can only decrease lateness. So an optimal schedule with no idle exists.

**Q29. How do you reconstruct the chosen set in weighted scheduling?**
Backtrack from `j=n`: if `w_j + OPT(p(j)) ≥ OPT(j-1)`, job `j` was taken — record it and jump to `p(j)`; else move to `j-1`.

**Q30. What's the complexity of all four variations?**
Each is `O(n log n)` (sort-dominated). Weighted uses `O(n)` extra space for `dp`; partitioning's heap holds at most `depth` elements.

**Q31. How do touching intervals affect the room count?**
Under `[start,end)`, `a.end == b.start` means they *don't* overlap, so they can share a room. Under `[start,end]`, they overlap and need separate rooms. The convention changes the answer at touch points.

**Q32. For "Non-overlapping Intervals" (min removals), what's the greedy?**
Sort by finish; greedily keep intervals whose start ≥ last kept finish (activity selection); the removals are `n − kept`.

**Q33. Compare the heap and sweep-line approaches to partitioning.**
Both are `O(n log n)` and give the same room *count*. The sweep is simplest for the count; the heap additionally yields a concrete room *assignment* per interval.

---

## Tier 4 — Proofs & Optimality

**Q34. Prove EDF minimizes maximum lateness (exchange argument).**
Take an optimal no-idle schedule. If it has an inversion (job `a` before `b` with `d_a > d_b`), it has an *adjacent* one. Swap them: `b` finishes earlier so its lateness doesn't increase; `a` now finishes where `b` did, and since `d_a > d_b`, `a`'s lateness < the pair's old max. So `L_max` doesn't increase, and inversions strictly decrease. Repeating reaches the deadline-sorted (EDF) schedule with `L_max` no worse than optimal — so EDF is optimal.

**Q35. Prove activity selection's greedy is optimal (stays-ahead).**
By induction, greedy's `r`-th chosen interval finishes no later than the `r`-th interval of any optimal solution. If the optimum had more intervals, after greedy's last pick an optimal interval would still be available (its start ≥ greedy's last finish), so greedy wouldn't have stopped — contradiction. Hence greedy matches the optimum's size.

**Q36. Prove min rooms = depth.**
*Lower bound:* at the busiest instant `D` intervals overlap and pairwise conflict, so need `D` distinct rooms → `k* ≥ D`. *Upper bound:* greedy opens a new room only when all current rooms are busy, meaning that many intervals overlap then, so it never exceeds `D` → `k_greedy ≤ D`. Sandwich: `k* = D`.

**Q37. Why does no greedy work for weighted interval scheduling?**
For any fixed greedy key (finish, weight, density), there's an adversarial instance where the preferred interval blocks a strictly heavier compatible set. Optimality needs the DP's global look-back `OPT(p(j))`, which a one-shot greedy can't do.

**Q38. What's the "optimal substructure" of weighted scheduling?**
An optimal solution on `{1..j}` either excludes `j` (and is optimal on `{1..j-1}`) or includes `j` (and the rest is optimal on `{1..p(j)}`). This justifies the `max(skip, take)` recurrence.

**Q39. Why are interval graphs easy to color while general graphs are NP-hard?**
Interval graphs are *perfect*: chromatic number = clique number = depth. The greedy partition achieves it in `O(n log n)`. General graph coloring has no such structure and is NP-hard.

**Q40. Why must binary search use the finish-sorted array, not start-sorted?**
`p(j)` needs the last interval finishing at or before `start_j`. Sorting by finish makes finishes monotone, so the predicate `finish ≤ start_j` is a clean prefix — exactly what binary search exploits.

**Q41. Is the `O(n log n)` bound tight?**
Yes in the comparison model: activity selection can decide element distinctness of finish times, which is `Ω(n log n)`. With small integer timestamps you can radix-sort to `O(n + U)`.

**Q42. Show a counterexample where sorting by length fails for activity selection.**
`[0,4), [3,5), [4,8)`. Shortest-first takes `[3,5)`, blocking both `[0,4)` and `[4,8)` (it overlaps both) → 1 interval. Finish-first takes `[0,4)` then `[4,8)` → 2. Length order is wrong.

---

## Tier 5 — Systems & Scale

**Q43. How would you support a live room-booking service with cancellations?**
A min-heap can't delete interior ends, so use a **range-add / range-max segment tree** over coordinate-compressed time: insert = `+1` on `[s,e)`, cancel = `−1`, the root holds live depth, all `O(log n)`. Admission = tentatively add, check max over the span ≤ k, roll back if not.

**Q44. What's the cardinal safety property of a scheduler, and how do you enforce it?**
Never double-book: no resource hosts two overlapping committed intervals. Enforce by making the check-depth-and-commit step *atomic* (lock or CAS on a versioned node); a race here is a correctness sev-1.

**Q45. How do you parallelize a batch interval scheduler?**
Connected components of the overlap graph are independent — partition by component and schedule each on its own worker. For multi-resource, shard by resource id so per-resource structures are contended only by their own requests.

**Q46. Where do these problems stop being polynomial?**
Adding release times (min `L_max` with releases is NP-hard), a second machine (min `L_max` on ≥2 machines is NP-hard), or a sum-of-tardiness objective. Makespan load balancing on `m` machines is NP-hard (LPT is a 4/3-approx).

**Q47. How is EDF used in real-time operating systems?**
As the optimal single-core deadline scheduler: if any schedule meets all deadlines, EDF does. Admission uses the utilization bound `Σ t_i/period_i ≤ 1` — the temporal analog of the depth bound.

**Q48. How do you make booking decisions reproducible for audit/billing?**
Impose a total order on requests (timestamp + tiebreak id) so replays produce identical accept/reject outcomes — essential for "who got the room" disputes. Cache only deterministic decisions.

---

## Coding Challenge 1 — Meeting Rooms II

**Problem (LeetCode 253).** Given meeting intervals `[[s,e), ...]`, return the minimum number of conference rooms required.

**Approach.** Interval partitioning: sort by start, min-heap of end times, peak heap size = answer (= depth).

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type MinHeap []int

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MinHeap) Pop() interface{} {
	o := *h
	v := o[len(o)-1]
	*h = o[:len(o)-1]
	return v
}

func minMeetingRooms(intervals [][]int) int {
	if len(intervals) == 0 {
		return 0
	}
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
	h := &MinHeap{}
	heap.Init(h)
	best := 0
	for _, iv := range intervals {
		if h.Len() > 0 && (*h)[0] <= iv[0] {
			heap.Pop(h)
		}
		heap.Push(h, iv[1])
		if h.Len() > best {
			best = h.Len()
		}
	}
	return best
}

func main() {
	fmt.Println(minMeetingRooms([][]int{{0, 30}, {5, 10}, {15, 20}})) // 2
	fmt.Println(minMeetingRooms([][]int{{7, 10}, {2, 4}}))            // 1
}
```

#### Java

```java
import java.util.*;

public class MeetingRoomsII {
    public int minMeetingRooms(int[][] intervals) {
        if (intervals.length == 0) return 0;
        Arrays.sort(intervals, Comparator.comparingInt(a -> a[0]));
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        int best = 0;
        for (int[] iv : intervals) {
            if (!pq.isEmpty() && pq.peek() <= iv[0]) pq.poll();
            pq.add(iv[1]);
            best = Math.max(best, pq.size());
        }
        return best;
    }

    public static void main(String[] args) {
        MeetingRoomsII s = new MeetingRoomsII();
        System.out.println(s.minMeetingRooms(new int[][]{{0,30},{5,10},{15,20}})); // 2
        System.out.println(s.minMeetingRooms(new int[][]{{7,10},{2,4}}));          // 1
    }
}
```

#### Python

```python
import heapq


def min_meeting_rooms(intervals):
    if not intervals:
        return 0
    intervals.sort(key=lambda x: x[0])
    heap, best = [], 0
    for s, e in intervals:
        if heap and heap[0] <= s:
            heapq.heappop(heap)
        heapq.heappush(heap, e)
        best = max(best, len(heap))
    return best


if __name__ == "__main__":
    print(min_meeting_rooms([[0, 30], [5, 10], [15, 20]]))  # 2
    print(min_meeting_rooms([[7, 10], [2, 4]]))             # 1
```

---

## Coding Challenge 2 — Non-overlapping Intervals

**Problem (LeetCode 435).** Given intervals, return the minimum number to remove so the rest are non-overlapping.

**Approach.** Activity selection by finish time; removals = `n − kept`. (Here `[a,b]` touching at endpoints is allowed in LeetCode's variant, so reuse `start >= lastEnd`.)

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
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][1] < intervals[j][1] })
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
	fmt.Println(eraseOverlapIntervals([][]int{{1, 2}, {1, 2}, {1, 2}}))         // 2
	fmt.Println(eraseOverlapIntervals([][]int{{1, 2}, {2, 3}}))                 // 0
}
```

#### Java

```java
import java.util.*;

public class NonOverlapping {
    public int eraseOverlapIntervals(int[][] intervals) {
        if (intervals.length == 0) return 0;
        Arrays.sort(intervals, Comparator.comparingInt(a -> a[1]));
        int kept = 0, lastEnd = Integer.MIN_VALUE;
        for (int[] iv : intervals) {
            if (iv[0] >= lastEnd) { kept++; lastEnd = iv[1]; }
        }
        return intervals.length - kept;
    }

    public static void main(String[] args) {
        NonOverlapping s = new NonOverlapping();
        System.out.println(s.eraseOverlapIntervals(new int[][]{{1,2},{2,3},{3,4},{1,3}})); // 1
        System.out.println(s.eraseOverlapIntervals(new int[][]{{1,2},{1,2},{1,2}}));       // 2
        System.out.println(s.eraseOverlapIntervals(new int[][]{{1,2},{2,3}}));             // 0
    }
}
```

#### Python

```python
def erase_overlap_intervals(intervals):
    if not intervals:
        return 0
    intervals.sort(key=lambda x: x[1])
    kept, last_end = 0, float("-inf")
    for s, e in intervals:
        if s >= last_end:
            kept += 1
            last_end = e
    return len(intervals) - kept


if __name__ == "__main__":
    print(erase_overlap_intervals([[1, 2], [2, 3], [3, 4], [1, 3]]))  # 1
    print(erase_overlap_intervals([[1, 2], [1, 2], [1, 2]]))          # 2
    print(erase_overlap_intervals([[1, 2], [2, 3]]))                  # 0
```

---

## Coding Challenge 3 — Weighted Interval Scheduling

**Problem (LeetCode 1235 "Maximum Profit in Job Scheduling").** Given `startTime[]`, `endTime[]`, `profit[]`, return the maximum profit from non-overlapping jobs.

**Approach.** Sort by finish; DP `OPT(j) = max(OPT(j-1), profit_j + OPT(p(j)))` with binary search for `p(j)`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func jobScheduling(startTime, endTime, profit []int) int {
	n := len(startTime)
	type Job struct{ s, e, p int }
	jobs := make([]Job, n)
	for i := 0; i < n; i++ {
		jobs[i] = Job{startTime[i], endTime[i], profit[i]}
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].e < jobs[j].e })
	dp := make([]int, n+1)
	for j := 1; j <= n; j++ {
		// p(j): last index i<j (1-based) with end_i <= start_j
		lo, hi, p := 0, j-1, 0
		for lo <= hi {
			mid := (lo + hi) / 2
			if mid == 0 || jobs[mid-1].e <= jobs[j-1].s {
				p = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		take := jobs[j-1].p + dp[p]
		if take > dp[j-1] {
			dp[j] = take
		} else {
			dp[j] = dp[j-1]
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(jobScheduling([]int{1, 2, 3, 3}, []int{3, 4, 5, 6}, []int{50, 10, 40, 70})) // 120
	fmt.Println(jobScheduling([]int{1, 2, 3, 4, 6}, []int{3, 5, 10, 6, 9}, []int{20, 20, 100, 70, 60})) // 150
}
```

#### Java

```java
import java.util.*;

public class JobScheduling {
    public int jobScheduling(int[] startTime, int[] endTime, int[] profit) {
        int n = startTime.length;
        int[][] jobs = new int[n][3];
        for (int i = 0; i < n; i++) jobs[i] = new int[]{startTime[i], endTime[i], profit[i]};
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1])); // by end
        int[] dp = new int[n + 1];
        for (int j = 1; j <= n; j++) {
            int lo = 0, hi = j - 1, p = 0;
            while (lo <= hi) {
                int mid = (lo + hi) / 2;
                if (mid == 0 || jobs[mid - 1][1] <= jobs[j - 1][0]) { p = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            dp[j] = Math.max(dp[j - 1], jobs[j - 1][2] + dp[p]);
        }
        return dp[n];
    }

    public static void main(String[] args) {
        JobScheduling s = new JobScheduling();
        System.out.println(s.jobScheduling(new int[]{1,2,3,3}, new int[]{3,4,5,6}, new int[]{50,10,40,70})); // 120
        System.out.println(s.jobScheduling(new int[]{1,2,3,4,6}, new int[]{3,5,10,6,9}, new int[]{20,20,100,70,60})); // 150
    }
}
```

#### Python

```python
from bisect import bisect_right


def job_scheduling(start_time, end_time, profit):
    jobs = sorted(zip(end_time, start_time, profit))  # by end
    ends = [j[0] for j in jobs]
    n = len(jobs)
    dp = [0] * (n + 1)
    for j in range(1, n + 1):
        e, s, p = jobs[j - 1]
        idx = bisect_right(ends, s, 0, j - 1)   # count of ends <= s in prefix
        dp[j] = max(dp[j - 1], p + dp[idx])
    return dp[n]


if __name__ == "__main__":
    print(job_scheduling([1, 2, 3, 3], [3, 4, 5, 6], [50, 10, 40, 70]))            # 120
    print(job_scheduling([1, 2, 3, 4, 6], [3, 5, 10, 6, 9], [20, 20, 100, 70, 60])) # 150
```

---

## Coding Challenge 4 — Minimize Maximum Lateness

**Problem.** Given jobs `(length, deadline)` to run on one machine, output the EDF order and the minimum achievable maximum lateness.

**Approach.** Sort by deadline; sweep a clock; lateness `= max(0, finish − deadline)`; track the max.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func minMaxLateness(jobs [][2]int) (order []int, maxLate int) {
	idx := make([]int, len(jobs))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return jobs[idx[a]][1] < jobs[idx[b]][1] })
	t := 0
	for _, i := range idx {
		t += jobs[i][0]
		if t-jobs[i][1] > maxLate {
			maxLate = t - jobs[i][1]
		}
		order = append(order, i)
	}
	return
}

func main() {
	jobs := [][2]int{{3, 6}, {2, 8}, {1, 9}, {4, 9}, {3, 14}, {2, 15}}
	order, late := minMaxLateness(jobs)
	fmt.Println("order(idx) =", order, " maxLateness =", late) // maxLateness = 1
}
```

#### Java

```java
import java.util.*;

public class MinMaxLateness {
    static Object[] minMaxLateness(int[][] jobs) {
        Integer[] idx = new Integer[jobs.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, Comparator.comparingInt(a -> jobs[a][1])); // by deadline
        int t = 0, maxLate = 0;
        List<Integer> order = new ArrayList<>();
        for (int i : idx) {
            t += jobs[i][0];
            maxLate = Math.max(maxLate, t - jobs[i][1]);
            order.add(i);
        }
        return new Object[]{order, maxLate};
    }

    public static void main(String[] args) {
        int[][] jobs = {{3,6},{2,8},{1,9},{4,9},{3,14},{2,15}};
        Object[] r = minMaxLateness(jobs);
        System.out.println("order(idx) = " + r[0] + "  maxLateness = " + r[1]); // 1
    }
}
```

#### Python

```python
def min_max_lateness(jobs):
    order = sorted(range(len(jobs)), key=lambda i: jobs[i][1])  # by deadline
    t, max_late = 0, 0
    for i in order:
        t += jobs[i][0]
        max_late = max(max_late, t - jobs[i][1])
    return order, max_late


if __name__ == "__main__":
    jobs = [(3, 6), (2, 8), (1, 9), (4, 9), (3, 14), (2, 15)]
    order, late = min_max_lateness(jobs)
    print("order(idx) =", order, " maxLateness =", late)  # 1
```

---

## Rapid-Fire Review

| Prompt | Answer |
|--------|--------|
| Max count of compatible intervals | Greedy by finish time |
| Max weight of compatible subset | DP + binary search (greedy WRONG) |
| Fewest rooms for all intervals | Min-heap of end times = depth |
| Minimize max lateness | EDF (sort by deadline) |
| Min intervals to remove | `n − activity_selection` |
| Meeting Rooms II | Interval partitioning (heap) |
| Non-overlapping Intervals | Activity selection complement |
| Max Profit in Job Scheduling | Weighted interval DP |
| depth = | max overlap = min rooms = clique # of interval graph |
| EDF proof technique | Adjacent-inversion exchange argument |
| Activity selection proof | Greedy stays ahead (induction) |
| Why interval graphs color easily | They're perfect: χ = ω = depth |
| Complexity of all variations | `O(n log n)` (sort-bounded) |
| Half-open overlap test | `a.s < b.f && b.s < a.f` |
| When P → NP-hard | release times / ≥2 machines / total tardiness |
| Live depth with cancellations | range-add/range-max segment tree |
| Cardinal scheduler safety | atomic check-and-commit (no double-book) |
| Multi-machine "fits in k?" | `depth ≤ k` |
| EDF minimizes | the *maximum* lateness (not count of late jobs) |
| Min # of late jobs | Moore–Hodgson (different greedy) |

**Final tip:** in an interview, first *classify* the problem out loud — "this is interval partitioning because we must place all intervals and only choose the room count" — then state the engine, then code. Interviewers grade the classification as much as the code, because choosing greedy-vs-DP correctly is the entire skill this topic tests.
</content>
