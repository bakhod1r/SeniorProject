# Job Scheduling (Job Sequencing with Deadlines) — Middle Level

> **One-line summary:** Beyond "sort by profit and place latest-first," the middle level explains *why* the greedy is correct (a peek at the exchange argument), *when* to choose the **slot-based** array/union-find method versus the **heap-based** eviction method, how the two are really the same optimum reached from opposite directions, and how to extend the problem to multiple machines, profit-vs-count objectives, and large-deadline inputs.

---

## Table of Contents

1. [Recap and Framing](#recap-and-framing)
2. [Why the Greedy Is Correct (Intuition)](#why-the-greedy-is-correct-intuition)
3. [Variant A — Slot-Based (Array / Union-Find)](#variant-a--slot-based-array--union-find)
4. [Variant B — Heap-Based (Min-Heap Eviction)](#variant-b--heap-based-min-heap-eviction)
5. [Slot-Based vs Heap-Based: When to Use Which](#slot-based-vs-heap-based-when-to-use-which)
6. [Side-by-Side Trace: Both Methods on the Same Input](#side-by-side-trace-both-methods-on-the-same-input)
7. [Decision Flow for Picking a Variant](#decision-flow-for-picking-a-variant)
8. [Code: Heap-Based and Slot-Based (Go / Java / Python)](#code-heap-based-and-slot-based)
9. [Extensions: Multiple Machines, Maximize Count, Weighted](#extensions-multiple-machines-maximize-count-weighted)
10. [Performance Analysis](#performance-analysis)
11. [Common Misconceptions](#common-misconceptions)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Best Practices](#best-practices)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Recap and Framing

At the junior level we learned the recipe: **sort jobs by descending profit**, then place each in the **latest free slot** at or before its deadline, dropping any job that has no free slot. A boolean slot array plus a downward linear scan gives an `O(n²)` implementation that is correct and easy to read.

The middle level answers the questions a thoughtful engineer asks next:

1. *Why* is "richest first, latest slot" actually optimal? (An exchange-argument sketch; the full proof lives in `professional.md`.)
2. There is a completely different-looking algorithm — **sort by deadline ascending and keep a min-heap of accepted profits, evicting the smallest when over capacity.** Why does *that* also give the optimum?
3. **Which variant should I ship** — slot-based or heap-based — and on what inputs?
4. How do I extend the model to **`k` machines**, to **maximize the number of jobs** instead of profit, or to large/sparse deadlines?

We carry the verified greedy from junior level and deepen both the *why* and the *engineering choice*.

---

## Why the Greedy Is Correct (Intuition)

Two facts make the greedy optimal. The full, rigorous treatment (exchange argument + matroid) is in `professional.md`; here is the intuition worth carrying.

**Fact 1 — Feasibility is monotone and the "latest slot" rule never hurts.** Suppose the set of jobs we have accepted so far is *feasible* (each can sit in a distinct slot `≤` its deadline). When a new job arrives and we place it in the **latest** free slot `≤` its deadline, we change the schedule as little as possible: we occupy the one slot least likely to be needed by a future tight-deadline job. Placing it any earlier could only block a job that *needs* an early slot — never the reverse. So "latest slot" keeps the accepted set feasible while maximizing remaining flexibility.

**Fact 2 — Considering jobs in profit-descending order means a swap can never help.** Imagine the optimal solution `OPT` and our greedy solution `G` differ. Take the highest-profit job where they disagree. Because greedy considered that job first (descending profit) and either scheduled it or found no slot, you can **exchange** a lower-profit job in `OPT` for this higher-profit one without losing feasibility — strictly improving or matching `OPT`. Repeating the exchange transforms `OPT` into `G` without ever decreasing profit, so `G` is optimal.

The deep reason both facts hold simultaneously is that the **feasible sets of jobs form a matroid** (the "transversal matroid" of jobs-to-slots). On a matroid, the greedy algorithm that picks elements by descending weight is *always* optimal. That single sentence is the whole theory; `professional.md` makes it precise.

> **Takeaway:** profit-descending = the matroid-greedy weight order; latest-slot = the feasibility-preserving way to add an element. Together they yield the maximum-weight independent set, i.e. the maximum profit.

---

## Variant A — Slot-Based (Array / Union-Find)

This is the junior-level method, made fast. Sort by descending profit. Keep slots `1..D`. For each job, find the latest free slot `≤` its deadline.

- **Linear scan:** scan `t = deadline … 1`, take the first free slot. `O(n·D)` total.
- **Union-Find:** maintain `parent[t]` = "the latest free slot `≤ t`." `find(deadline)` returns it in near-`O(1)`; after taking slot `t`, set `parent[t] = find(t-1)` so the slot is "skipped" next time. `O(n α(n))` total.

The union-find version is the canonical fast solution and is developed in detail in `senior.md`. Conceptually:

```
find(t):           # latest free slot <= t, or 0 if none
    while parent[t] != t: t = parent[t]   # with path compression
    return t

for each job (p, d) in descending profit:
    s = find(d)
    if s > 0:
        accept; profit += p
        parent[s] = s - 1   # slot s now points to the slot left of it
```

Slot-based naturally answers **"which slot does each job run in?"** because it maintains an explicit timeline.

---

## Variant B — Heap-Based (Min-Heap Eviction)

A different and equally valid strategy, often cleaner when deadlines are large or you only care about the chosen *set*:

1. **Sort jobs by deadline, ascending.**
2. Walk jobs in deadline order, maintaining a **min-heap of the profits of currently accepted jobs.**
3. For job `(p, d)`:
   - If the heap currently holds **fewer than `d`** jobs, we still have room before this deadline — **push `p`**.
   - Else the heap is "full" up to time `d` (already `d` jobs each fitting by their deadlines). If the **smallest** accepted profit is **less than `p`**, **evict it and push `p`** (swap a cheaper job for this richer one). Otherwise **skip** this job.

At the end, the heap contains exactly the profits of the optimal set, and their sum is the maximum profit.

**Why it works:** processing in deadline order guarantees that when we reach deadline `d`, every job currently in the heap fits within `[1..d]` slots. The invariant *"the heap holds the most profitable feasible set using slots `1..currentDeadline`"* is maintained: if a new job is richer than our current weakest, swapping strictly improves the total without breaking feasibility (the heap size never exceeds the current deadline). This is the classic **"k-th most profitable so far"** exchange, and it produces the same optimum as the slot-based method — reached by scanning deadlines forward and pruning, rather than scanning profits down and placing.

```
sort jobs by deadline ascending
heap = min-heap of profits
for (p, d) in jobs:
    if len(heap) < d:
        push p
    elif heap.top() < p:
        pop; push p
sum(heap) = max profit;  len(heap) = jobs done
```

---

## Slot-Based vs Heap-Based: When to Use Which

| Dimension | Slot-Based (array / union-find) | Heap-Based (min-heap eviction) |
|-----------|--------------------------------|--------------------------------|
| Sort key | **Descending profit** | **Ascending deadline** |
| Core structure | Boolean slot array / union-find over `1..D` | Min-heap of accepted profits |
| Time | `O(n·D)` scan / `O(n α(n))` union-find | `O(n log n)` (sort + heap ops) |
| Space | `O(D)` (one slot per time unit) | `O(n)` (heap holds ≤ jobs accepted) |
| Large deadlines (`D ≫ n`) | Array wastes `O(D)` memory; **cap at `n`** or use a map-backed union-find | **No `D` dependence** — heap size ≤ `n`. Preferred. |
| Recovers slot assignment? | **Yes** — explicit timeline. | No — only the chosen set/profits (you'd reconstruct separately). |
| Sparse / huge deadlines | Needs coordinate compression | Naturally handles huge `d` (only compares to heap size) |
| Conceptual clarity | "Pack the timeline latest-first" | "Keep the richest feasible set so far" |
| Typical interview answer | Union-find for the `O(n α(n))` flex | Heap when deadlines are large/sparse |

**Rule of thumb:**

- Need the **actual schedule (which job in which slot)** or have **small, dense deadlines** → **slot-based** (union-find for speed).
- Have **large or sparse deadlines**, only need the **max profit / chosen set**, or want a clean `O(n log n)` with no `D` term → **heap-based**.

Both are optimal; they are two routes to the same maximum. A great interview move is to mention both and pick based on the deadline range.

---

## Side-by-Side Trace: Both Methods on the Same Input

Let us run **both** algorithms on the same five jobs and watch them converge to profit `142`.

| Job | Profit | Deadline |
|-----|-------|----------|
| a   | 100   | 2        |
| b   | 19    | 1        |
| c   | 27    | 2        |
| d   | 25    | 1        |
| e   | 15    | 3        |

### Slot-based (profit-descending, latest free slot)

Sorted by profit: `a(100,d2), c(27,d2), d(25,d1), b(19,d1), e(15,d3)`. Slots `[_, _, _]` (indices 1..3).

| Step | Job | Latest free slot ≤ d | Action | Slots | Profit |
|------|-----|----------------------|--------|-------|--------|
| 1 | a (100, d2) | 2 | take 2 | `[_, a, _]` | 100 |
| 2 | c (27, d2)  | 1 | take 1 | `[c, a, _]` | 127 |
| 3 | d (25, d1)  | none | drop  | `[c, a, _]` | 127 |
| 4 | b (19, d1)  | none | drop  | `[c, a, _]` | 127 |
| 5 | e (15, d3)  | 3 | take 3 | `[c, a, e]` | **142** |

Scheduled set `{a, c, e}`.

### Heap-based (deadline-ascending, min-heap eviction)

Sorted by deadline: `b(19,d1), d(25,d1), a(100,d2), c(27,d2), e(15,d3)`. Heap = min-heap of profits.

| Step | Job | `len(heap)` vs `d` | Action | Heap (profits) | Sum |
|------|-----|--------------------|--------|----------------|-----|
| 1 | b (19, d1) | 0 < 1 | push 19 | `{19}` | 19 |
| 2 | d (25, d1) | 1 = 1, top 19 < 25 | evict 19, push 25 | `{25}` | 25 |
| 3 | a (100, d2) | 1 < 2 | push 100 | `{25, 100}` | 125 |
| 4 | c (27, d2) | 2 = 2, top 25 < 27 | evict 25, push 27 | `{27, 100}` | 127 |
| 5 | e (15, d3) | 2 < 3 | push 15 | `{15, 27, 100}` | **142** |

Final heap holds profits `{100, 27, 15}` — **the same set** `{a, c, e}` and the **same profit 142**.

Notice the two methods *reached the optimum differently*: the slot method tentatively committed `d`/`b` only to find no room, while the heap method *evicted* the cheaper `19` and `25` as richer competitors arrived. The end state is identical because both compute the maximum-weight basis of the same matroid (see `professional.md`).

---

## Decision Flow for Picking a Variant

```mermaid
flowchart TD
    A[Job sequencing instance] --> B{Need the concrete<br/>slot assignment?}
    B -->|Yes| C{Deadlines small/dense<br/>D ≈ O(n)?}
    C -->|Yes| D[Array union-find<br/>O(n α(n)), O(D) mem]
    C -->|No, huge/sparse| E[Hash-map union-find<br/>or coordinate compression]
    B -->|No, value/set only| F{Deadlines huge/sparse?}
    F -->|Yes| G[Heap eviction<br/>O(n log n), O(n) mem]
    F -->|No| H[Either works;<br/>heap is simplest]
```

This flow encodes the whole middle-level judgment: the **slot methods** give you a timeline but pay `O(D)` memory (array) or a hashing constant (map); the **heap method** gives only the chosen set/value but is `O(n)` memory and immune to deadline magnitude. When in doubt and you only need the profit, reach for the heap.

---

## Code: Heap-Based and Slot-Based

Both variants below schedule the same jobs and print `count = 3, profit = 142`. The heap-based one sorts by deadline; the slot-based one sorts by profit and uses union-find.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

type Job struct{ Profit, Deadline int }

// ---- Heap-based (sort by deadline, min-heap of profits) ----
type MinHeap []int

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func scheduleHeap(jobs []Job) (int, int) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Deadline < jobs[j].Deadline })
	h := &MinHeap{}
	heap.Init(h)
	for _, j := range jobs {
		if h.Len() < j.Deadline {
			heap.Push(h, j.Profit)
		} else if h.Len() > 0 && (*h)[0] < j.Profit {
			heap.Pop(h)
			heap.Push(h, j.Profit)
		}
	}
	count, profit := h.Len(), 0
	for _, p := range *h {
		profit += p
	}
	return count, profit
}

// ---- Slot-based (sort by profit, union-find latest free slot) ----
func find(parent []int, x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func scheduleSlot(jobs []Job) (int, int) {
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Profit > jobs[j].Profit })
	maxD := 0
	for _, j := range jobs {
		if j.Deadline > maxD {
			maxD = j.Deadline
		}
	}
	parent := make([]int, maxD+1)
	for i := range parent {
		parent[i] = i
	}
	count, profit := 0, 0
	for _, j := range jobs {
		s := find(parent, j.Deadline)
		if s > 0 {
			parent[s] = s - 1
			count++
			profit += j.Profit
		}
	}
	return count, profit
}

func main() {
	jobs := []Job{{100, 2}, {19, 1}, {27, 2}, {25, 1}, {15, 3}}
	c1, p1 := scheduleHeap(append([]Job(nil), jobs...))
	c2, p2 := scheduleSlot(append([]Job(nil), jobs...))
	fmt.Printf("heap: count = %d, profit = %d\n", c1, p1) // 3, 142
	fmt.Printf("slot: count = %d, profit = %d\n", c2, p2) // 3, 142
}
```

#### Java

```java
import java.util.*;

public class JobSchedulingMid {
    static class Job {
        int profit, deadline;
        Job(int p, int d) { profit = p; deadline = d; }
    }

    // Heap-based: sort by deadline, min-heap of accepted profits.
    static int[] scheduleHeap(Job[] jobs) {
        Arrays.sort(jobs, Comparator.comparingInt(a -> a.deadline));
        PriorityQueue<Integer> heap = new PriorityQueue<>(); // min-heap
        for (Job j : jobs) {
            if (heap.size() < j.deadline) {
                heap.add(j.profit);
            } else if (!heap.isEmpty() && heap.peek() < j.profit) {
                heap.poll();
                heap.add(j.profit);
            }
        }
        int count = heap.size(), profit = 0;
        for (int p : heap) profit += p;
        return new int[]{count, profit};
    }

    static int find(int[] parent, int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    // Slot-based: sort by profit, union-find latest free slot.
    static int[] scheduleSlot(Job[] jobs) {
        Arrays.sort(jobs, (a, b) -> b.profit - a.profit);
        int maxD = 0;
        for (Job j : jobs) maxD = Math.max(maxD, j.deadline);
        int[] parent = new int[maxD + 1];
        for (int i = 0; i <= maxD; i++) parent[i] = i;
        int count = 0, profit = 0;
        for (Job j : jobs) {
            int s = find(parent, j.deadline);
            if (s > 0) { parent[s] = s - 1; count++; profit += j.profit; }
        }
        return new int[]{count, profit};
    }

    public static void main(String[] args) {
        Job[] base = {
            new Job(100, 2), new Job(19, 1), new Job(27, 2),
            new Job(25, 1), new Job(15, 3)
        };
        int[] h = scheduleHeap(base.clone());
        int[] s = scheduleSlot(base.clone());
        System.out.printf("heap: count = %d, profit = %d%n", h[0], h[1]); // 3, 142
        System.out.printf("slot: count = %d, profit = %d%n", s[0], s[1]); // 3, 142
    }
}
```

#### Python

```python
import heapq


def schedule_heap(jobs):
    """jobs: list of (profit, deadline). Sort by deadline; min-heap eviction."""
    jobs = sorted(jobs, key=lambda j: j[1])  # ascending deadline
    heap = []  # min-heap of accepted profits
    for p, d in jobs:
        if len(heap) < d:
            heapq.heappush(heap, p)
        elif heap and heap[0] < p:
            heapq.heapreplace(heap, p)
    return len(heap), sum(heap)


def find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def schedule_slot(jobs):
    """Sort by profit; union-find latest free slot."""
    jobs = sorted(jobs, key=lambda j: -j[0])
    max_d = max((d for _, d in jobs), default=0)
    parent = list(range(max_d + 1))
    count = profit = 0
    for p, d in jobs:
        s = find(parent, d)
        if s > 0:
            parent[s] = s - 1
            count += 1
            profit += p
    return count, profit


if __name__ == "__main__":
    base = [(100, 2), (19, 1), (27, 2), (25, 1), (15, 3)]
    print("heap:", schedule_heap(base))  # (3, 142)
    print("slot:", schedule_slot(base))  # (3, 142)
```

**What it does:** the heap version sorts by deadline and keeps the most profitable feasible set; the slot version sorts by profit and uses union-find to grab the latest free slot. Both yield the same optimum.
**Run:** `go run main.go` | `javac JobSchedulingMid.java && java JobSchedulingMid` | `python jobs_mid.py`

---

## Extensions: Multiple Machines, Maximize Count, Weighted

### `k` Machines (k jobs per time unit)

If you have `k` identical machines, each time slot can hold **`k`** jobs. In the slot-based method, replace the boolean `slot[t]` with a counter `used[t]` allowed up to `k`; the latest "slot with capacity" is the target. In the heap-based method, a job at deadline `d` may be accepted while the heap holds fewer than `k·d` jobs (the timeline has `k·d` machine-slots up to time `d`). Both stay optimal because the underlying structure is still a matroid (now a "partition-by-capacity" transversal matroid).

### Maximize the **Number** of Jobs (ignore profit)

Set every profit to 1 (or sort by deadline and greedily fit each job into any free slot `≤ d`). The heap-based method with all-equal profits degenerates to "accept while there is room before the deadline," yielding the maximum **count** of feasible jobs — the classic *maximum number of jobs that can be done* variant.

### Weighted / Profit-Maximizing Confirmation

The default problem **is** the weighted variant (profit = weight). Maximizing the number of jobs is the special case profit ≡ 1. So a single matroid-greedy implementation, parameterized by the weight, covers both: pass real profits to maximize profit, pass `1`s to maximize count.

### Penalties Instead of Deadlines (Lawler/Moore framing)

A dual formulation minimizes **total penalty of late jobs** rather than maximizing on-time profit. Minimizing lateness penalty is equivalent to maximizing on-time profit (penalty of dropped jobs = total profit − scheduled profit). The same greedy solves both; you just report the complementary quantity.

---

## Performance Analysis

| Method | Sort | Schedule | Total time | Space |
|--------|------|----------|-----------|-------|
| Linear scan | `O(n log n)` | `O(n·D)` | `O(n log n + n·D)` | `O(D)` |
| Union-find slot | `O(n log n)` | `O(n α(n))` | `O(n log n)` | `O(D)` (or `O(n)` capped) |
| Heap eviction | `O(n log n)` | `O(n log n)` | `O(n log n)` | `O(n)` |

Observations:

- When `D` is **small and dense**, all three are fine; union-find is fastest by a constant.
- When `D` is **large or sparse** (e.g. deadlines up to `10⁹`), the slot array becomes infeasible. **Heap-based wins** — its memory is bounded by `n`, not `D`. (Or use coordinate-compressed / hash-map union-find for the slot method.)
- The sort is the common floor; you cannot beat `O(n log n)` without exploiting structure (e.g. integer deadlines bounded by `n` → counting sort gives `O(n + D)` overall for the linear-scan total).

A worked sizing: `n = 10⁶` jobs with deadlines up to `10⁹`. The slot array (`10⁹` booleans ≈ 1 GB) is impractical; the heap method uses `O(n)` ≈ a few MB and runs the whole thing in one `O(n log n)` pass — the clear production choice.

### A note on the union-find constant

The union-find slot method is `O(n α(n))` *after* the sort, but in practice the `α(n)` term is so close to constant that the wall-clock cost is dominated entirely by the `O(n log n)` sort. Empirically, for `n = 10⁶` dense-deadline jobs, the sort consumes well over 90% of the runtime and the union-find pass is a thin near-linear sweep. This is why "the sort is the floor" — optimizing the slot lookup past union-find buys nothing measurable; only replacing the comparison sort (with counting/radix sort when keys are bounded) moves the needle, dropping the total to `O(n)`.

### Why the heap method has no `D` term

The heap never stores slots — it stores at most `min(n, D)` accepted profits, and the comparison `len(heap) < d` only ever reads the *current* count against the current deadline. No array indexed by time exists, so a deadline of `10⁹` costs exactly the same as a deadline of `10`. That structural independence from `D` is the single most important reason to prefer the heap when deadlines are timestamps.

---

## Common Misconceptions

1. **"The two methods can give different profits."** They cannot. Both compute the maximum-weight basis of the same matroid; the *profit* is provably identical (the chosen *set* may differ only when profits tie). If your two implementations disagree on profit, one has a bug — usually a sort-direction or eviction-comparison error.
2. **"Heap-based ignores the latest-slot idea."** It does not ignore it — it *encodes* it implicitly. Processing in deadline order with a size cap of `d` is exactly the feasibility condition "at most `d` jobs with deadline ≤ `d`." The heap never needs to reason about *which* slot because it only tracks *how many* fit.
3. **"You must use union-find for correctness."** Union-find is purely a *speed* optimization over the linear scan; both produce the identical schedule. Correctness comes from the greedy order, not the data structure.
4. **"Eviction in the heap loses a job permanently and might be wrong."** Evicting the cheapest accepted job when a richer feasible one arrives is exactly the optimal exchange. The evicted job was the least valuable member of a full set; swapping it for something richer can only improve the total.
5. **"Maximizing count and maximizing profit need different algorithms."** They are the same algorithm with weights set to `1` versus real profits. One parameterized implementation covers both.

---

## Edge Cases & Pitfalls

- **Mixing the two sort keys.** Slot-based sorts by **profit**, heap-based sorts by **deadline**. Swapping them silently breaks the algorithm — double-check which variant you wrote.
- **Heap "fewer than `d`" off-by-one.** The condition is `len(heap) < d` (strict), because `d` slots `1..d` exist before this deadline. Using `<=` over-admits.
- **Heap eviction equality.** Use `heap.top() < p` (strict). Replacing on equality wastes work and may flip tie outcomes; document the tie rule.
- **Large deadlines in the slot method.** Cap the slot array at `n` (you can never schedule more than `n` jobs) or compress coordinates; otherwise you allocate `O(D)`.
- **Recovering the schedule from the heap method.** The heap gives only the chosen *set*; to print "job X in slot Y," re-run a slot assignment over the chosen jobs.
- **`k`-machine capacity.** Forgetting to scale the heap-size threshold to `k·d` (or the slot capacity to `k`) yields a wrong, under-filled schedule.
- **All-equal profits.** Both methods still work, but the optimal **set** may be non-unique; only the **count** is well-defined. Fix a tie-break for determinism.

---

## Best Practices

- Pick the variant by the **deadline range**: dense/small → slot+union-find; large/sparse → heap. Write a comment explaining the choice.
- Keep a brute-force oracle (`n ≤ 12`) that tries all subsets and validates feasibility; test **both** variants against it and against each other.
- Parameterize by weight so the same code maximizes profit (real weights) or count (weights = 1).
- For the slot method, cap slots at `min(max_deadline, n)`; for the heap method, you need no cap.
- Document the tie-break (profit ties in slot method, deadline ties in heap method) so results are reproducible across Go/Java/Python.
- Separate "compute the optimal set/profit" from "produce a concrete slot assignment" — different callers need different outputs.

---

## Cheat Sheet

| | Slot-Based | Heap-Based |
|--|-----------|-----------|
| Sort | descending profit | ascending deadline |
| Structure | slot array / union-find | min-heap of profits |
| Accept rule | latest free slot `≤ d` | `len<d` push, else evict-if-richer |
| Time | `O(n α(n))` | `O(n log n)` |
| Best when | dense `D`, need slots | large/sparse `D`, set only |

Invariants:

```
slot-based : accepted set stays feasible; latest slot preserves flexibility
heap-based : heap = most-profitable feasible set using slots 1..currentDeadline
both       : maximum-weight independent set of the jobs-to-slots matroid
k machines : slot capacity k  /  heap threshold k·d
max count  : set all profits to 1
```

---

## Summary

The middle level reframes job sequencing as a **matroid-greedy**: profit-descending is the weight order, latest-slot is the feasibility-preserving insertion, and together they reach the maximum-weight independent set — the maximum profit. Crucially, there are **two** correct implementations. The **slot-based** method sorts by profit and packs an explicit timeline (linear scan `O(n²)`, union-find `O(n α(n))`), giving you the actual schedule and excelling when deadlines are small and dense. The **heap-based** method sorts by deadline and maintains a min-heap of accepted profits, evicting the cheapest when over capacity (`O(n log n)`), excelling when deadlines are large or sparse and you only need the chosen set. Both extend cleanly to `k` machines (scale capacity), to maximizing count (weights = 1), and to penalty-minimization duals. Choose by the deadline range, verify against a brute-force oracle, and you have a robust, optimal scheduler. The rigorous optimality proof and the matroid formalism follow in `professional.md`; the production-scale engineering follows in `senior.md`.

---

## Worked Counterexample: Why Earliest-Slot Fails

To cement the "latest slot" rule, here is a minimal input where placing jobs in the **earliest** free slot loses profit, while latest-first earns the optimum.

Jobs: `a(100, d2), b(10, d1)`.

**Latest-first (correct).** Sort by profit: `a, b`. Place `a` in latest free slot ≤ 2 → slot **2**. Place `b` in latest free slot ≤ 1 → slot **1**. Both scheduled, profit `110`.

**Earliest-first (buggy).** Place `a` in earliest free slot ≤ 2 → slot **1**. Now `b` needs a free slot ≤ 1, but slot 1 is taken → `b` is **dropped**. Profit `100`.

The earliest-first variant needlessly consumed slot 1 — the *only* slot `b` could ever use — for a job (`a`) that had an alternative. Latest-first preserves the scarce early slots for the jobs that have no choice. This two-job example is the cleanest way to defend the rule in an interview.

---

## Further Reading

- *Algorithm Design* (Kleinberg & Tardos), §4.2 — exchange arguments for scheduling to minimize lateness.
- *Introduction to Algorithms* (CLRS), §16.5 — "A task-scheduling problem as a matroid."
- *Combinatorial Optimization* (Schrijver) — transversal matroids and matroid greedy.
- GeeksforGeeks — "Job Sequencing Problem" and "Job Sequencing using Disjoint Set Union."
- Sibling topic `10-heaps` — priority queues used in the heap-based variant.
- Sibling topic `senior.md` — union-find slot allocation and real scheduling systems.
- Sibling topic `professional.md` — the full exchange-argument and matroid proof.
</content>
</invoke>
