# Job Scheduling (Job Sequencing with Deadlines) — Interview Preparation

Job Sequencing with Deadlines is a staple greedy interview problem. It is simple to state, has a deceptively subtle "latest slot" twist, admits two distinct optimal algorithms (slot-based and heap-based), and connects to deep theory (matroids, EDF). Interviewers use it to probe whether you can (a) state and justify a greedy, (b) prove optimality, (c) optimize with union-find, and (d) generalize to `k` machines. This file is a curated bank of tiered Q&A, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact | Statement |
|------|-----------|
| Model | `n` jobs, each profit `p_i` + deadline `d_i`; unit time; one machine; one job/slot. |
| Goal | Maximize total profit of on-time jobs. |
| Greedy (slot) | Sort by **descending profit**; place each in the **latest free slot ≤ deadline**; drop if none. |
| Greedy (heap) | Sort by **ascending deadline**; min-heap of profits; `len<d` push, else evict-if-richer. |
| Why optimal | Feasible sets form a **matroid**; profit-descending greedy = matroid greedy. |
| Feasibility (Hall) | `S` feasible iff `#{jobs with deadline ≤ t} ≤ t` for all `t`. |
| Slot lookup | linear scan `O(D)`  or  **union-find** `O(α(n))`. |
| Complexity | `O(n log n)` (union-find or heap); `O(nD)` (linear scan). |
| Slots needed | at most `min(max deadline, n)`. |
| `k` machines | slot capacity `k`; heap threshold `k·d`. |

Build recipe (slot-based, per job `(p, d)` in descending profit):

```text
s = latest free slot <= d        # linear scan or union-find
if s exists:  take s; profit += p; count++
else:         drop the job
```

Arithmetic / structure choice:

```text
small dense deadlines, need slots -> array union-find
huge/sparse deadlines, need slots -> hash-map union-find / compression
value or set only, huge deadlines -> deadline-sorted min-heap
```

---

## Junior Questions (12 Q&A)

### J1. State the job sequencing problem.
You have `n` jobs; each takes one unit of time, pays a profit, and has a deadline. One machine runs one job per time slot. A job earns its profit only if completed at or before its deadline. Maximize total profit.

### J2. What is the greedy strategy?
Sort jobs by **descending profit**. Process them in that order; place each job in the **latest free time slot at or before its deadline**. If no such slot is free, drop the job.

### J3. Why sort by descending profit?
So the most valuable jobs get first claim on the limited slots. If two jobs compete for the same slot, the richer one should win — considering it first guarantees that.

### J4. Why place a job in its *latest* free slot instead of the earliest?
To keep early slots open for jobs with tight (small) deadlines that have no other option. Packing front-to-back would block those jobs and lose profit.

### J5. How many time slots do you ever need?
At most the maximum deadline — and never more than `n` (you can't schedule more jobs than you have). Cap the slot array at `min(max deadline, n)`.

### J6. What happens to a job that finds no free slot?
It is dropped and earns nothing. Because we processed in profit-descending order, dropped jobs are never more valuable than scheduled ones.

### J7. Walk through `{(100,2),(19,1),(27,2),(25,1),(15,3)}`.
Sorted by profit: 100/d2, 27/d2, 25/d1, 19/d1, 15/d3. Place 100→slot2, 27→slot1, 25→(slot1 taken)drop, 19→drop, 15→slot3. Scheduled {100,27,15}, profit **142**, 3 jobs.

### J8. What is the time complexity of the simple version?
Sorting is `O(n log n)`; the linear slot scan is `O(n·D)` where `D` is the max deadline, so `O(n log n + nD)`. The union-find version is `O(n log n)`.

### J9. How do you store the slots?
A boolean array `slot[1..D]`, 1-indexed (slot 0 unused). `slot[t] = true` means occupied. For each job, scan from its deadline down to 1 for the first free slot.

### J10. What if all deadlines are 1?
Only one job (the highest profit) can be scheduled; all others are dropped, since they all need the single slot 1.

### J11. Does this greedy also work for jobs with different durations?
No. The clean greedy relies on **unit-length** jobs. Variable durations make the problem much harder (generally NP-hard for the weighted case).

### J12. How would you verify your implementation?
Brute force: for small `n` (≤ 10–12), try all subsets, keep feasible ones (check the Hall condition or attempt an assignment), and take the max profit. Compare to the greedy. Also use known cases like the walkthrough (142).

---

## Middle Questions (12 Q&A)

### M1. There's a heap-based algorithm too. Describe it.
Sort jobs by **ascending deadline**. Keep a **min-heap of accepted profits**. For each job `(p,d)`: if the heap has fewer than `d` jobs, push `p`; else if the smallest accepted profit `< p`, evict it and push `p`; else skip. At the end, the heap holds the optimal set.

### M2. Why does the heap method work?
Processing in deadline order guarantees that when you reach deadline `d`, every job in the heap fits in slots `1..d`. The invariant is "the heap is the most profitable feasible set using slots `1..currentDeadline`." Swapping a cheaper accepted job for a richer feasible one never breaks feasibility and only increases profit.

### M3. When do you prefer heap-based over slot-based?
When deadlines are **large or sparse** (e.g. epoch timestamps): the heap uses `O(n)` memory with no dependence on `D`, while the slot array needs `O(D)`. Also when you only need the chosen set / max profit, not the concrete slot assignment.

### M4. When do you prefer slot-based?
When deadlines are **small and dense**, or when you need the **actual schedule** (which job runs in which slot). The union-find slot allocator is `O(n α(n))` and gives you the timeline directly.

### M5. How does union-find speed up finding the latest free slot?
`parent[t]` points to the latest free slot `≤ t`. `find(d)` returns it in near-`O(1)` amortized (path compression). After taking slot `s`, set `parent[s] = s-1` so future queries skip it. The `n` lookups cost `O(n α(n))`.

### M6. What's the sentinel for "no slot available"?
Slot 0. It is never a valid time unit; when all early slots are gone, `find` chains down to 0, signaling rejection. `parent[0] = 0`.

### M7. How do you extend to `k` identical machines?
Each slot can hold `k` jobs. In the slot method, allow up to `k` jobs per slot (counter instead of boolean). In the heap method, accept while the heap holds fewer than `k·d` jobs. Still optimal — the structure remains a matroid.

### M8. How do you maximize the *number* of jobs instead of profit?
Set all profits equal (to 1). The greedy then maximizes the count of feasible jobs — equivalently a maximum bipartite matching between jobs and slots (the Moore-Hodgson setting).

### M9. State the feasibility condition for a set of jobs.
A set is feasible iff for every threshold `t`, the number of jobs with deadline `≤ t` is `≤ t` (Hall's condition). This is what lets latest-first and earliest-first placement both succeed when any feasible schedule exists.

### M10. How do you handle ties in profit?
Define a deterministic tie-break (e.g. by ascending deadline, then job id). The optimal *profit* is unique, but the chosen *set* and *schedule* may not be; a documented tie-break makes results reproducible.

### M11. What's the memory cost of each method, concretely?
Slot array union-find: `O(D)`. Hash-map union-find: `O(n)`. Heap: `O(n)`. For `D ≈ 10⁹` with `n = 10⁶`, the array is ~1 GB (impractical); heap/hash use a few MB.

### M12. How do you reconstruct the schedule from the heap method?
The heap gives only the chosen profits/set. To get "job X in slot Y," re-run a slot assignment (union-find or earliest-first) over just the accepted jobs.

---

## Senior Questions (12 Q&A)

### S1. Prove the greedy is optimal via an exchange argument.
Order greedy set `S` and optimal `O` by profit; let `k` be the highest-profit job where they differ. If `k ∈ O \ S`, greedy rejected `k` only because slots `1..d_k` were full of higher-profit jobs (all in `O`), making `O` infeasible — contradiction. If `k ∈ S \ O`, swap a lower-profit (≤ `p_k`) job of `O` for `k`, keeping feasibility and not decreasing profit. Iterating turns `O` into `S` without losing profit, so `P(S) = P(O)`.

### S2. Why is job sequencing a matroid?
Take jobs as the ground set and feasible sets as independent sets. It satisfies: `∅` feasible (I1); subsets of feasible sets are feasible (I2); and the exchange axiom (I3) — if `|A|<|B|` are feasible, some job in `B\A` can be added to `A` (proved via the Hall counting condition). It is the **transversal matroid** of the jobs↔slots bipartite graph.

### S3. How does the matroid view explain optimality?
The matroid-greedy (Rado-Edmonds) theorem says sorting by descending weight and adding each element that preserves independence yields a maximum-weight basis. Job sequencing's feasibility is a matroid and profit is the weight, so the profit-descending greedy is exactly this — provably optimal.

### S4. What's the union-find complexity and why?
`O(n α(n))` amortized for the `n` slot lookups, where `α` is the inverse Ackermann function (≤ 4 in practice). It follows from Tarjan's path-compression analysis; the restricted "union toward decreasing index" form is even simpler to bound.

### S5. How do you handle deadlines that are huge epoch timestamps?
Don't allocate `O(D)`. Options: (a) hash-map union-find with lazy `parent[t]=t` init, `O(n)` memory; (b) coordinate-compress deadlines to ranks and union-find over `1..n`; (c) use the heap method if you only need value/set.

### S6. Relate this to EDF (Earliest Deadline First).
EDF runs the ready task with the earliest deadline and is the optimal uniprocessor policy for *feasibility*. The heap-based job-sequencing variant is essentially **EDF with profit-based eviction**: deadline order plus dropping the least valuable job when over capacity — optimizing *value* among feasible sets rather than just feasibility.

### S7. Where does the polynomial tractability end?
Exactly where the feasibility system stops being a matroid: **unit times on `k` identical machines** stays `O(n log n)`. Variable processing times (weighted `1||ΣwⱼUⱼ`) become **NP-hard** (pseudo-poly DP + FPTAS); precedence/conflicts also generally leave P.

### S8. How do you parallelize a scheduling service?
Across independent batches (per tenant/window) — each is a pure function with its own union-find/heap, so it is data-parallel across a worker pool. Within a single batch the greedy is sequential (shared slot state), but the dominant sort can be parallelized for very large `n`.

### S9. What's the most dangerous failure mode in production?
A **valid but sub-optimal** schedule from a subtle bug (sorting ascending, scanning earliest-first). It never crashes — it just quietly earns less. Mitigate by cross-checking two independent optimal methods (slot vs heap) on sampled batches.

### S10. How do you make the output deterministic across languages?
Fix a total order for the sort: profit descending, then deadline ascending, then job id. Without it, equal-profit ties resolve differently across sort implementations, yielding different (but equally optimal) schedules.

### S11. Counting-sort optimization?
If deadlines (or profits) are bounded integers `≤ n`, replace the comparison sort with counting/radix sort: `O(n)`. Combined with union-find, the whole pipeline becomes `O(n)` time, `O(n)` space — optimal.

### S12. Min-cost flow alternative — when?
When constraints get richer than plain deadlines — machine eligibility, job conflicts, or two simultaneous matroid constraints — model jobs↔slots as a flow/matching and solve via min-cost flow or matroid intersection. Slower than greedy but handles cases the greedy cannot.

---

## Expert Questions (6 Q&A)

### E1. Prove the Hall feasibility condition.
(⇒) Jobs with deadline `≤ t` occupy distinct slots `≤ t`; only `t` exist, so their count `≤ t`. (⇐) If `#{d_i ≤ t} ≤ t` for all `t`, sort by deadline and place each into the earliest free slot; the `k`-th job with deadline `≤ d` has `k ≤ #{d_i ≤ d} ≤ d`, so a slot `≤ d` is free. This is Hall's marriage theorem on the jobs↔slots bipartite graph.

### E2. Show the heap and slot methods compute the same optimum.
Both compute a maximum-weight basis of the same transversal matroid. A matroid's max-weight basis has a **unique total weight** (though possibly non-unique elements). The slot method orders by weight descending (matroid greedy directly); the heap method orders by deadline and maintains the max-weight feasible set incrementally via exchanges — also a max-weight basis. Equal weight follows.

### E3. Derive the `O(n α(n))` bound for the interval union-find.
The structure only unions adjacent indices toward decreasing slot number and never splits. Each `find` with path compression amortizes to `O(α(n))` by Tarjan's potential argument; because unions are restricted to a line (slot `s` → `s-1`), one can also give a direct near-linear bound: total path-compression work over `n` operations on a universe of `m` slots is `O((n+m) α(m))`.

### E4. How does the analysis change for `k` machines?
Feasibility becomes `#{d_i ≤ t} ≤ k·t`. The independent sets still satisfy (I1)–(I3) (a `k`-fold transversal/partition-style matroid), so greedy remains optimal. The union-find caps each slot at `k` consumptions before chaining to `s-1`; complexity stays `O(n log n)`.

### E5. What is the competitive ratio story for the online version?
When jobs arrive online (deadlines/profits revealed over time) and decisions are irrevocable, no deterministic algorithm is optimal; the problem is studied via competitive analysis. Profit-weighted online scheduling with deadlines has known constant-competitive randomized algorithms under bounded value ratios; the offline matroid greedy is the benchmark (OPT).

### E6. Connect to weighted bipartite matching and LP duality.
Maximum-profit job sequencing is a maximum-weight bipartite matching (jobs↔slots) whose constraint matrix is totally unimodular, so the LP relaxation is integral. The matroid greedy is a combinatorial certificate of optimality; LP duality gives an alternative proof and the complementary-slackness conditions that the latest-slot schedule satisfies.

---

## Behavioral & Communication Prompts

- **Explain the algorithm to a non-technical PM.** Practice the "freelance gigs, one per day, each due by some date, each paying a fee — do the highest-paying ones and slot each as late as allowed" framing.
- **Defend the 'latest slot' choice.** Be ready to give a concrete two-job counterexample showing earliest-first loses profit.
- **Justify your data-structure choice.** Articulate when you'd reach for union-find vs a heap based on the deadline range, and state the memory trade-off explicitly.
- **Describe a bug you'd guard against.** The "sorted ascending / scanned earliest-first" silent sub-optimality, and how cross-checking two methods catches it.
- **Scope a real system.** Talk through an ad-impression allocator: validation, batching, allocator choice, metrics (realized profit, rejection rate), and capacity for `k` slots.

---

## Coding Challenge 1 — Maximum Profit Job Sequencing (Union-Find)

**Problem.** Given `jobs` as `(profit, deadline)`, return `(count, maxProfit)` using the profit-descending union-find greedy. `1 ≤ n ≤ 10⁵`, `1 ≤ deadline ≤ n`, `1 ≤ profit ≤ 10⁹`.

**Approach.** Sort by descending profit; union-find over slots `1..maxDeadline`; for each job allocate `find(deadline)`, chain to `s-1`.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

type Job struct{ Profit, Deadline int }

func find(par []int, x int) int {
	for par[x] != x {
		par[x] = par[par[x]]
		x = par[x]
	}
	return x
}

func maxProfit(jobs []Job) (int, int64) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Profit > jobs[j].Profit })
	maxD := 0
	for _, j := range jobs {
		if j.Deadline > maxD {
			maxD = j.Deadline
		}
	}
	par := make([]int, maxD+1)
	for i := range par {
		par[i] = i
	}
	count := 0
	var profit int64
	for _, j := range jobs {
		s := find(par, j.Deadline)
		if s > 0 {
			par[s] = s - 1
			count++
			profit += int64(j.Profit)
		}
	}
	return count, profit
}

func main() {
	jobs := []Job{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}}
	c, p := maxProfit(jobs)
	fmt.Printf("count = %d, profit = %d\n", c, p) // 3, 142
}
```

#### Java
```java
import java.util.*;

public class Challenge1 {
    static int find(int[] par, int x) {
        while (par[x] != x) { par[x] = par[par[x]]; x = par[x]; }
        return x;
    }
    static long[] maxProfit(int[][] jobs) { // jobs[i] = {profit, deadline}
        Arrays.sort(jobs, (a, b) -> b[0] - a[0]);
        int maxD = 0;
        for (int[] j : jobs) maxD = Math.max(maxD, j[1]);
        int[] par = new int[maxD + 1];
        for (int i = 0; i <= maxD; i++) par[i] = i;
        long count = 0, profit = 0;
        for (int[] j : jobs) {
            int s = find(par, j[1]);
            if (s > 0) { par[s] = s - 1; count++; profit += j[0]; }
        }
        return new long[]{count, profit};
    }
    public static void main(String[] args) {
        int[][] jobs = {{100,2},{19,1},{27,2},{25,1},{15,3}};
        long[] r = maxProfit(jobs);
        System.out.println("count = " + r[0] + ", profit = " + r[1]); // 3, 142
    }
}
```

#### Python
```python
def find(par, x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def max_profit(jobs):
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    par = list(range(max_d + 1))
    count = profit = 0
    for p, d in jobs:
        s = find(par, d)
        if s > 0:
            par[s] = s - 1
            count += 1
            profit += p
    return count, profit


if __name__ == "__main__":
    jobs = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
    print(max_profit(jobs))  # (3, 142)
```

---

## Coding Challenge 2 — Heap-Based Maximum Profit (Large Deadlines)

**Problem.** Same as Challenge 1 but deadlines may be up to `10⁹` (sparse). Return `(count, maxProfit)` using the deadline-sorted min-heap eviction method, which uses only `O(n)` memory.

**Approach.** Sort by ascending deadline; maintain a min-heap of accepted profits; if `len(heap) < d` push, else if `heap.top < p` evict and push.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type Job struct {
	Profit   int
	Deadline int
}
type MinHeap []int

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MinHeap) Pop() interface{} {
	o := *h
	n := len(o)
	v := o[n-1]
	*h = o[:n-1]
	return v
}

func maxProfitHeap(jobs []Job) (int, int64) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Deadline < jobs[j].Deadline })
	h := &MinHeap{}
	for _, j := range jobs {
		if h.Len() < j.Deadline {
			heap.Push(h, j.Profit)
		} else if h.Len() > 0 && (*h)[0] < j.Profit {
			heap.Pop(h)
			heap.Push(h, j.Profit)
		}
	}
	var profit int64
	for _, p := range *h {
		profit += int64(p)
	}
	return h.Len(), profit
}

func main() {
	jobs := []Job{{100, 2}, {19, 1}, {27, 2}, {25, 3}, {15, 1000000000}}
	c, p := maxProfitHeap(jobs)
	fmt.Printf("count = %d, profit = %d\n", c, p) // 4, 167
}
```

#### Java
```java
import java.util.*;

public class Challenge2 {
    static long[] maxProfitHeap(int[][] jobs) { // {profit, deadline}
        Arrays.sort(jobs, Comparator.comparingInt(a -> a[1]));
        PriorityQueue<Integer> h = new PriorityQueue<>();
        for (int[] j : jobs) {
            if (h.size() < j[1]) h.add(j[0]);
            else if (!h.isEmpty() && h.peek() < j[0]) { h.poll(); h.add(j[0]); }
        }
        long profit = 0;
        for (int p : h) profit += p;
        return new long[]{h.size(), profit};
    }
    public static void main(String[] args) {
        int[][] jobs = {{100,2},{19,1},{27,2},{25,3},{15,1000000000}};
        long[] r = maxProfitHeap(jobs);
        System.out.println("count = " + r[0] + ", profit = " + r[1]); // 4, 167
    }
}
```

#### Python
```python
import heapq


def max_profit_heap(jobs):
    jobs = sorted(jobs, key=lambda j: j[1])
    h = []
    for p, d in jobs:
        if len(h) < d:
            heapq.heappush(h, p)
        elif h and h[0] < p:
            heapq.heapreplace(h, p)
    return len(h), sum(h)


if __name__ == "__main__":
    jobs = [(100, 2), (19, 1), (27, 2), (25, 3), (15, 1_000_000_000)]
    print(max_profit_heap(jobs))  # (4, 167)
```

Note: with a deadline of 10⁹ the heap caps at `min(n, d)` = `n`, so memory stays `O(n)` — the array slot method would try to allocate 10⁹ slots and fail.

---

## Coding Challenge 3 — Brute-Force Oracle (Verification)

**Problem.** For `n ≤ 12`, compute the maximum profit by trying every subset and testing feasibility via the Hall condition. Use it to validate Challenges 1 and 2.

**Approach.** Enumerate subsets via bitmask; for each, sort by deadline and check that the `k`-th job (1-indexed) has deadline `≥ k`; track max profit.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func feasible(ds []int) bool {
	sort.Ints(ds)
	for i, d := range ds {
		if d < i+1 { // i+1-th job needs a slot <= d, requires d >= i+1
			return false
		}
	}
	return true
}

func brute(jobs [][2]int) int { // jobs[i] = {profit, deadline}
	n := len(jobs)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		var ds []int
		sum := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				ds = append(ds, jobs[i][1])
				sum += jobs[i][0]
			}
		}
		if feasible(ds) && sum > best {
			best = sum
		}
	}
	return best
}

func main() {
	jobs := [][2]int{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}}
	fmt.Println("brute max profit =", brute(jobs)) // 142
}
```

#### Java
```java
import java.util.*;

public class Challenge3 {
    static boolean feasible(List<Integer> ds) {
        Collections.sort(ds);
        for (int i = 0; i < ds.size(); i++)
            if (ds.get(i) < i + 1) return false;
        return true;
    }
    static int brute(int[][] jobs) {
        int n = jobs.length, best = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<Integer> ds = new ArrayList<>();
            int sum = 0;
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) { ds.add(jobs[i][1]); sum += jobs[i][0]; }
            if (feasible(ds) && sum > best) best = sum;
        }
        return best;
    }
    public static void main(String[] args) {
        int[][] jobs = {{100,2},{19,1},{27,2},{25,1},{15,3}};
        System.out.println("brute max profit = " + brute(jobs)); // 142
    }
}
```

#### Python
```python
from itertools import combinations


def feasible(ds):
    ds = sorted(ds)
    return all(d >= i + 1 for i, d in enumerate(ds))


def brute(jobs):
    n = len(jobs)
    best = 0
    for r in range(n + 1):
        for comb in combinations(range(n), r):
            ds = [jobs[i][1] for i in comb]
            if feasible(ds):
                best = max(best, sum(jobs[i][0] for i in comb))
    return best


if __name__ == "__main__":
    jobs = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
    print("brute max profit =", brute(jobs))  # 142
```

---

## Final Tips

- **Lead with the greedy and the 'latest slot' insight** — interviewers want to see you justify, not just recite.
- **Offer both algorithms** (slot/union-find and heap) and pick by the deadline range; it signals depth.
- **State the optimality argument** — at least the exchange sketch; mention the matroid for senior roles.
- **Get the boundaries right** — slots are 1-indexed, deadlines `≥ 1`, cap slots at `min(D, n)`, define a tie-break.
- **Always verify** — describe the brute-force oracle and the Hall feasibility check; mention cross-checking the two methods.
- **Know where it breaks** — variable durations → NP-hard; only-feasibility → EDF; richer constraints → min-cost flow.
</content>
</invoke>
