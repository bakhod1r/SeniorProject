# Interval Scheduling Variations — Professional Level

> The professional level is about **proof**. Each variation is optimal for a precise reason, and a professional can write the argument down rigorously: the **exchange argument** for activity selection and for Earliest-Deadline-First, the **depth lower bound = greedy upper bound** sandwich for interval partitioning, and the **optimal-substructure recurrence** (with binary-search correctness) for weighted interval scheduling. We also nail down the complexity of every step, the half-open-interval formalism, and the exact boundary where these problems stop being polynomially exact.

## Table of Contents
1. [Formal Setup and Notation](#1-formal-setup-and-notation)
2. [Activity Selection: Greedy-Stays-Ahead and Exchange Proofs](#2-activity-selection)
3. [Minimizing Maximum Lateness: The EDF Exchange Argument](#3-minimizing-maximum-lateness-edf)
4. [Interval Partitioning: The Depth Lower Bound](#4-interval-partitioning-the-depth-lower-bound)
5. [Weighted Interval Scheduling: Optimal Substructure & Binary Search](#5-weighted-interval-scheduling)
6. [Complexity Analysis of Every Variation](#6-complexity-analysis)
7. [The Boundary of Polynomial Exactness](#7-the-boundary-of-polynomial-exactness)
8. [Reference Implementations with Reconstruction](#8-reference-implementations-with-reconstruction)
9. [Verification Harness](#9-verification-harness)
10. [Summary](#10-summary)

---

## 1. Formal Setup and Notation

Let the input be `n` intervals `I = {1, …, n}`, interval `i = [s_i, f_i)` with `s_i < f_i`, treated as **half-open** so that intervals sharing only an endpoint (`f_i = s_j`) are **compatible** (non-overlapping). Two intervals `i, j` **conflict** iff `s_i < f_j` and `s_j < f_i`.

For weighted problems each `i` carries weight `w_i > 0` (we allow the WLOG assumption `w_i > 0`; non-positive-weight intervals are never beneficial to take and can be dropped).

For lateness problems each job `j` has processing time `t_j > 0` and deadline `d_j`; a schedule on one machine assigns each job a start `σ_j` with no two jobs overlapping; its completion is `C_j = σ_j + t_j` and its **lateness** is `ℓ_j = max(0, C_j − d_j)`. We assume a *non-preemptive, no-idle* machine — and prove below that idling never helps.

Objectives:

- **Activity selection:** maximize `|S|` over compatible `S ⊆ I`.
- **Weighted interval scheduling:** maximize `Σ_{i∈S} w_i` over compatible `S`.
- **Interval partitioning:** minimize `k` such that `I` can be `k`-colored with no two conflicting intervals sharing a color.
- **Minimize maximum lateness:** minimize `L_max = max_j ℓ_j` over all single-machine schedules.

Define the **depth** `D = max_t |{ i : s_i ≤ t < f_i }|`, the maximum number of intervals live at any instant.

---

## 2. Activity Selection

**Algorithm.** Sort by finish time so `f_1 ≤ f_2 ≤ … ≤ f_n`. Greedily scan; maintain `lastEnd`. Take interval `i` iff `s_i ≥ lastEnd`, then set `lastEnd = f_i`.

### 2.1 Greedy-stays-ahead proof

**Claim.** The greedy set `G = {g_1, g_2, …, g_k}` (in selection order) is maximum.

**Lemma (stays ahead).** Let `O = {o_1, …, o_m}` be any optimal solution sorted by finish time. Then for every `r ≤ k`, `f_{g_r} ≤ f_{o_r}`.

*Proof by induction on `r`.* Base `r = 1`: greedy picks the globally earliest-finishing interval, so `f_{g_1} ≤ f_{o_1}`. Inductive step: assume `f_{g_{r-1}} ≤ f_{o_{r-1}}`. Since `O` is compatible, `s_{o_r} ≥ f_{o_{r-1}} ≥ f_{g_{r-1}}`, so `o_r` is compatible with greedy's first `r−1` picks and was available when greedy chose `g_r`. Greedy picks the earliest-finishing available interval, hence `f_{g_r} ≤ f_{o_r}`. ∎

**Theorem.** `k = m`. Suppose `m > k`. By the lemma `f_{g_k} ≤ f_{o_k}`, and `o_{k+1}` exists with `s_{o_{k+1}} ≥ f_{o_k} ≥ f_{g_k} = lastEnd`. Then `o_{k+1}` was available after greedy's last pick, so greedy would not have stopped — contradiction. Hence `k = m` and greedy is optimal. ∎

### 2.2 Exchange-argument view

Equivalently: take any optimal `O` whose first interval is not greedy's `g_1`. Replace `O`'s earliest-finishing interval with `g_1` (which finishes no later, so it cannot conflict with anything `O` kept after it). The result is still compatible, same size, and agrees with greedy on the first pick. Induct. This is the canonical *exchange argument* (`05-exchange-argument`).

### 2.3 Why sorting by finish, not start or length

Sorting by **start** can force an early long interval that blocks many; sorting by **length** (shortest first) fails on `[0,4) , [3,5) , [4,8)` where the short middle interval blocks the two compatible long ones. Only the finish-time order admits the stays-ahead lemma.

---

## 3. Minimizing Maximum Lateness (EDF)

**Algorithm.** Sort jobs by deadline `d_1 ≤ d_2 ≤ … ≤ d_n`; run them back-to-back from `t = 0` with no idle time.

### 3.1 No idle time and no inversions

**Fact 1 (no idle).** There is an optimal schedule with no idle gaps: shifting all jobs earlier to remove a gap cannot increase any completion time, so cannot increase any lateness. ∎

**Definition.** An **inversion** is a pair `(i, j)` scheduled with `i` before `j` but `d_i > d_j`.

**Fact 2 (EDF has no inversions).** The deadline-sorted schedule has zero inversions. Conversely, any no-idle schedule with no inversions has the same `L_max` as EDF (jobs with equal deadlines are interchangeable without changing the maximum lateness). ∎

### 3.2 The exchange lemma

**Lemma.** Swapping two **adjacent inverted** jobs does not increase `L_max`.

*Proof.* Let a no-idle schedule run `… a, b …` with `a` immediately before `b` and `d_a > d_b` (an inversion). Let the block occupy `[τ, τ + t_a + t_b)`. Before the swap: `C_a = τ + t_a`, `C_b = τ + t_a + t_b`. After swapping to `… b, a …`: `C'_b = τ + t_b`, `C'_a = τ + t_a + t_b`. All other jobs are unaffected (the block's total span is unchanged).

Compare the maximum lateness of the two swapped jobs:

- `ℓ'_b = max(0, C'_b − d_b) = max(0, τ + t_b − d_b) ≤ max(0, τ + t_a + t_b − d_b) = ℓ_b`. So `b`'s lateness does not increase.
- `ℓ'_a = max(0, C'_a − d_a) = max(0, τ + t_a + t_b − d_a)`. Now `C'_a = C_b` (both equal `τ + t_a + t_b`), and since `d_a > d_b`, `C'_a − d_a < C_b − d_b`, hence `ℓ'_a < max(0, C_b − d_b) = ℓ_b`.

Therefore `max(ℓ'_a, ℓ'_b) ≤ max(ℓ_a, ℓ_b)`: the new pair's maximum lateness is at most the old pair's maximum, and no other job changed. So `L_max` does not increase. ∎

### 3.3 The theorem

**Theorem.** EDF minimizes `L_max`.

*Proof.* Take an optimal no-idle schedule `O` (Fact 1). If `O` has an inversion, it has an *adjacent* inversion (any inversion implies two adjacent jobs `i, j` with `d_i > d_j`). By the lemma, swapping them does not increase `L_max`, and it strictly reduces the number of inversions. Repeat: after finitely many swaps we reach a schedule with no inversions and `L_max` no larger than `O`'s — i.e. EDF (Fact 2). Since `O` was optimal, EDF is optimal. ∎

This is the **exchange argument requested for the professional level**, written in full.

---

## 4. Interval Partitioning: The Depth Lower Bound

**Algorithm.** Sort by start; maintain a min-heap of end times of open rooms; reuse the earliest-freeing room when `heap.min ≤ s_i`, else open a new room. Let `k_greedy` be the number of rooms opened.

### 4.1 Lower bound: `k* ≥ D`

**Lemma (depth lower bound).** Any valid partition uses at least `D` rooms, where `D` is the depth.

*Proof.* Let `t*` be an instant with `D` intervals live: `s_i ≤ t* < f_i` for `D` distinct intervals. These `D` intervals pairwise conflict (they all contain `t*`), so no two may share a room. Hence any valid coloring assigns them `D` distinct colors, requiring `k* ≥ D`. ∎

In graph terms: the intervals form an **interval graph**; `D` is the size of its largest **clique** (a set of mutually overlapping intervals all containing a common point — by the Helly property of intervals on a line, pairwise overlap implies a common point). Any proper coloring needs at least `ω = D` colors.

### 4.2 Upper bound: `k_greedy ≤ D`

**Lemma.** The greedy opens at most `D` rooms.

*Proof.* Suppose greedy opens a new room while processing interval `i` (sorted by start). It does so only because every currently-open room's end time is `> s_i`, i.e. every open room holds an interval `j` with `s_j ≤ s_i` (processed earlier, start-sorted) and `f_j > s_i`. Each such `j` therefore contains the instant `s_i` (since `s_j ≤ s_i < f_j`), and so does `i` itself. If greedy now has `c` rooms open including the new one, that means `c` intervals all contain `s_i` — so the depth at `s_i` is at least `c`. Thus whenever the room count reaches `c`, depth `≥ c`, giving `k_greedy ≤ D`. ∎

### 4.3 The theorem

**Theorem.** `k_greedy = k* = D`. The greedy is optimal and the optimum equals the depth.

*Proof.* By §4.1, `k* ≥ D`. By §4.2, `k_greedy ≤ D`. Since greedy is a valid partition, `k* ≤ k_greedy ≤ D ≤ k*`, forcing equality throughout. ∎

**Corollary (interval graphs are perfect).** For interval graphs, chromatic number `χ` equals clique number `ω` (both `= D`), and an optimal coloring is found greedily in `O(n log n)` — in contrast to general graph coloring, which is NP-hard. This is the structural reason lecture-hall assignment is easy.

---

## 5. Weighted Interval Scheduling

**Algorithm.** Sort by finish `f_1 ≤ … ≤ f_n`. Define `p(j) = max{ i : f_i ≤ s_j }` (0 if none). Compute

```
OPT(0) = 0
OPT(j) = max( OPT(j-1),  w_j + OPT(p(j)) ).
```

The answer is `OPT(n)`.

### 5.1 Optimal substructure

**Lemma.** Let `O_j` be an optimal compatible subset of `{1, …, j}` (finish-sorted). Either `j ∉ O_j`, in which case `O_j` is optimal for `{1, …, j-1}`; or `j ∈ O_j`, in which case `O_j \ {j}` is an optimal compatible subset of `{1, …, p(j)}`.

*Proof.* If `j ∉ O_j`, then `O_j ⊆ {1,…,j-1}` and its optimality there is immediate (any better subset of `{1,…,j-1}` would beat `O_j`). If `j ∈ O_j`, every other `i ∈ O_j` is compatible with `j`, so `f_i ≤ s_j` (because intervals are finish-sorted and conflict with `j` would mean `f_i > s_j` and `s_i < f_j`; the finish-sorted compatible-before set is exactly `{1,…,p(j)}`). Hence `O_j \ {j} ⊆ {1,…,p(j)}`. If some subset `B ⊆ {1,…,p(j)}` had weight `> w(O_j) − w_j`, then `B ∪ {j}` (compatible, since all of `B` finishes ≤ `s_j`) would beat `O_j` — contradiction. So `O_j \ {j}` is optimal for `{1,…,p(j)}`. ∎

### 5.2 Correctness of the recurrence

**Theorem.** `OPT(j)` as defined equals the maximum weight of a compatible subset of `{1,…,j}`.

*Proof by strong induction on `j`.* Base `OPT(0)=0` trivially. For `j ≥ 1`, by the lemma the optimum either excludes `j` (value `OPT(j-1)` by induction) or includes `j` (value `w_j + OPT(p(j))` by induction, since `p(j) < j`). The optimum is the better of the two, which is exactly `max(OPT(j-1), w_j + OPT(p(j)))`. ∎

### 5.3 Correctness of binary search for `p(j)`

**Claim.** Because intervals are sorted by finish time, `p(j) = max{ i : f_i ≤ s_j }` is computable by binary search on the array `[f_1, …, f_{j-1}]` in `O(log n)`.

*Proof.* `f_1 ≤ … ≤ f_{j-1}` is sorted ascending, and the predicate `f_i ≤ s_j` is **monotone** (true for a prefix, false after). Binary search returns the largest index satisfying it. The set `{ i < j : f_i ≤ s_j }` is exactly the intervals that finish at or before `j` starts — equivalently those compatible with `j` *and* preceding it in finish order. (Any `i < j` with `f_i ≤ s_j` is compatible with `j`; conversely any `i` compatible with `j` and with `f_i ≤ f_j` satisfies `f_i ≤ s_j` or overlaps — finish-sort guarantees the clean prefix.) ∎

### 5.4 Reconstruction

To recover the chosen set, backtrack from `j = n`: if `w_j + OPT(p(j)) ≥ OPT(j-1)`, include `j` and recurse on `p(j)`; else recurse on `j-1`. `O(n)`.

### 5.5 Why no greedy works

**Claim.** No comparison-based greedy that commits one interval at a time using a fixed key (finish, weight, density, …) is optimal for weighted interval scheduling.

*Sketch.* For any fixed key, construct an adversarial instance: place one interval that the key prefers but whose selection blocks a strictly heavier compatible pair. (E.g. for finish-key: `A[0,2) w=1, B[2,4) w=1, C[0,4) w=100`; finish-greedy takes `A,B = 2`, optimum is `C = 100`. For weight-key: `A[0,3) w=2, B[3,6) w=2, C[2,4) w=3`; weight-greedy takes `C=3`, optimum is `A,B=4`.) Each fixed key has such a counterexample, so optimality requires the DP's *global* look-back via `OPT(p(j))`. ∎

---

## 6. Complexity Analysis

| Variation | Sort | Core work | Total time | Space |
|-----------|------|-----------|------------|-------|
| Activity selection | `O(n log n)` | `O(n)` sweep | `O(n log n)` | `O(1)` extra (plus output) |
| Min max lateness (EDF) | `O(n log n)` | `O(n)` sweep | `O(n log n)` | `O(1)` extra |
| Interval partitioning (heap) | `O(n log n)` | `O(n log D)` heap ops | `O(n log n)` | `O(D)` heap |
| Interval partitioning (sweep) | `O(n log n)` (event sort) | `O(n)` prefix sum | `O(n log n)` | `O(n)` events |
| Weighted interval scheduling | `O(n log n)` | `O(n)` DP + `O(n log n)` searches | `O(n log n)` | `O(n)` dp + p[] |

All four are `Θ(n log n)` in the comparison model, and the sort is the asymptotic bottleneck for each. **Lower bound:** activity selection is `Ω(n log n)` because it can decide *element distinctness* of finish times in the comparison-sort model; the others inherit comparable lower bounds. If keys are integers in a bounded range you can radix-sort to `O(n + U)` and shave the log — relevant when timestamps are small compressed integers (the senior-level coordinate compression).

**Heap-size refinement.** In partitioning the heap holds at most `D` ends, so each heap op is `O(log D) ≤ O(log n)`; total heap cost `O(n log D)`. When `D ≪ n` (shallow but long schedules) this is a real constant-factor win over `O(n log n)`.

---

## 7. The Boundary of Polynomial Exactness

A professional must know exactly where these clean results stop:

| Problem | Status | Algorithm |
|---------|--------|-----------|
| Max count compatible | P, `O(n log n)` | greedy by finish |
| Max weight compatible (1 resource) | P, `O(n log n)` | DP + binary search |
| Min rooms (partition all) | P, `O(n log n)` | depth / heap |
| Min `L_max` (1 machine) | P, `O(n log n)` | EDF |
| Min number of late jobs (1 machine) | P, `O(n log n)` | Moore–Hodgson (greedy + max-heap) |
| Min `L_max` with release times (1 machine) | **NP-hard** | branch & bound |
| Min weighted completion time (1 machine, no deadlines) | P | Smith's rule (WSPT) |
| Min `L_max` on `m ≥ 2` identical machines | **NP-hard** | approximation / ILP |
| Min makespan on `m ≥ 2` machines | **NP-hard** | LPT 4/3-approx, PTAS exists |
| Max weight compatible on `k` resources | P (min-cost flow) | flow / matching |

The fragile line: adding **release times**, a **second machine**, or a **sum-of-tardiness** objective frequently flips a polynomial problem to NP-hard. The four core variations sit safely on the polynomial side precisely because they are single-resource (or unbounded-resource partition) with a min-max or additive-on-one-line objective.

---

## 8. Reference Implementations with Reconstruction

Production-grade weighted scheduling **with set reconstruction**, plus EDF returning the optimal order. All three print `weight=8 chosen=[A,C] order=[...]` style output (exact below). The weighted demo uses `A[1,3]w=5, B[2,5]w=6, C[4,6]w=5, D[6,7]w=4` → optimum `{A, C, D}` worth `5+5+4 = 14`? Let us let the code state the truth; we assert it in §9.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Job struct {
	id             string
	start, finish  int
	weight         int
}

// weightedWithSet returns optimal value and the chosen ids.
func weightedWithSet(jobs []Job) (int, []string) {
	s := append([]Job(nil), jobs...)
	sort.Slice(s, func(i, j int) bool { return s[i].finish < s[j].finish })
	n := len(s)
	p := make([]int, n+1) // 1-based; p[j] in [0..j-1]
	for j := 1; j <= n; j++ {
		lo, hi, ans := 0, j-1, 0
		for lo <= hi {
			mid := (lo + hi) / 2
			if mid == 0 || s[mid-1].finish <= s[j-1].start {
				ans = mid
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
		p[j] = ans
	}
	dp := make([]int, n+1)
	for j := 1; j <= n; j++ {
		take := s[j-1].weight + dp[p[j]]
		if take > dp[j-1] {
			dp[j] = take
		} else {
			dp[j] = dp[j-1]
		}
	}
	// reconstruct
	var chosen []string
	j := n
	for j > 0 {
		take := s[j-1].weight + dp[p[j]]
		if take >= dp[j-1] {
			chosen = append([]string{s[j-1].id}, chosen...)
			j = p[j]
		} else {
			j--
		}
	}
	return dp[n], chosen
}

// edfOrder returns the optimal run order (ids) and the resulting max lateness.
func edfOrder(jobs [][3]interface{}) ([]string, int) {
	type J struct {
		id       string
		length   int
		deadline int
	}
	js := make([]J, len(jobs))
	for i, j := range jobs {
		js[i] = J{j[0].(string), j[1].(int), j[2].(int)}
	}
	sort.SliceStable(js, func(a, b int) bool { return js[a].deadline < js[b].deadline })
	t, worst := 0, 0
	order := make([]string, 0, len(js))
	for _, j := range js {
		t += j.length
		if t-j.deadline > worst {
			worst = t - j.deadline
		}
		order = append(order, j.id)
	}
	return order, worst
}

func main() {
	jobs := []Job{
		{"A", 1, 3, 5}, {"B", 2, 5, 6}, {"C", 4, 6, 5}, {"D", 6, 7, 4},
	}
	val, set := weightedWithSet(jobs)
	fmt.Printf("weighted optimum=%d chosen=%v\n", val, set)

	order, worst := edfOrder([][3]interface{}{
		{"J1", 3, 6}, {"J2", 2, 8}, {"J3", 1, 9}, {"J4", 4, 9}, {"J5", 3, 14}, {"J6", 2, 15},
	})
	fmt.Printf("EDF order=%v maxLateness=%d\n", order, worst)
}
```

#### Java

```java
import java.util.*;

public class WeightedProof {
    record Job(String id, int start, int finish, int weight) {}

    static Object[] weightedWithSet(List<Job> in) {
        List<Job> s = new ArrayList<>(in);
        s.sort(Comparator.comparingInt(Job::finish));
        int n = s.size();
        int[] p = new int[n + 1];
        for (int j = 1; j <= n; j++) {
            int lo = 0, hi = j - 1, ans = 0;
            while (lo <= hi) {
                int mid = (lo + hi) / 2;
                if (mid == 0 || s.get(mid - 1).finish() <= s.get(j - 1).start()) { ans = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            p[j] = ans;
        }
        int[] dp = new int[n + 1];
        for (int j = 1; j <= n; j++)
            dp[j] = Math.max(dp[j - 1], s.get(j - 1).weight() + dp[p[j]]);
        LinkedList<String> chosen = new LinkedList<>();
        for (int j = n; j > 0; ) {
            int take = s.get(j - 1).weight() + dp[p[j]];
            if (take >= dp[j - 1]) { chosen.addFirst(s.get(j - 1).id()); j = p[j]; }
            else j--;
        }
        return new Object[]{dp[n], chosen};
    }

    static Object[] edfOrder(int[][] jobs, String[] ids) {
        Integer[] idx = new Integer[jobs.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, Comparator.comparingInt(a -> jobs[a][1])); // by deadline
        int t = 0, worst = 0;
        List<String> order = new ArrayList<>();
        for (int i : idx) { t += jobs[i][0]; worst = Math.max(worst, t - jobs[i][1]); order.add(ids[i]); }
        return new Object[]{order, worst};
    }

    public static void main(String[] args) {
        List<Job> jobs = List.of(new Job("A",1,3,5), new Job("B",2,5,6),
                                 new Job("C",4,6,5), new Job("D",6,7,4));
        Object[] r = weightedWithSet(jobs);
        System.out.println("weighted optimum=" + r[0] + " chosen=" + r[1]);

        int[][] j = {{3,6},{2,8},{1,9},{4,9},{3,14},{2,15}};
        String[] ids = {"J1","J2","J3","J4","J5","J6"};
        Object[] e = edfOrder(j, ids);
        System.out.println("EDF order=" + e[0] + " maxLateness=" + e[1]);
    }
}
```

#### Python

```python
from bisect import bisect_right


def weighted_with_set(jobs):
    """jobs: list of (id, start, finish, weight). Returns (value, chosen_ids)."""
    s = sorted(jobs, key=lambda x: x[2])  # by finish
    n = len(s)
    finishes = [s[i][2] for i in range(n)]
    p = [0] * (n + 1)
    for j in range(1, n + 1):
        p[j] = bisect_right(finishes, s[j - 1][1], 0, j - 1)  # count finish<=start in prefix
    dp = [0] * (n + 1)
    for j in range(1, n + 1):
        dp[j] = max(dp[j - 1], s[j - 1][3] + dp[p[j]])
    chosen, j = [], n
    while j > 0:
        if s[j - 1][3] + dp[p[j]] >= dp[j - 1]:
            chosen.append(s[j - 1][0])
            j = p[j]
        else:
            j -= 1
    return dp[n], list(reversed(chosen))


def edf_order(jobs):
    """jobs: list of (id, length, deadline). Returns (order_ids, max_lateness)."""
    s = sorted(jobs, key=lambda x: x[2])  # by deadline
    t, worst, order = 0, 0, []
    for jid, length, deadline in s:
        t += length
        worst = max(worst, t - deadline)
        order.append(jid)
    return order, worst


if __name__ == "__main__":
    jobs = [("A", 1, 3, 5), ("B", 2, 5, 6), ("C", 4, 6, 5), ("D", 6, 7, 4)]
    val, chosen = weighted_with_set(jobs)
    print(f"weighted optimum={val} chosen={chosen}")
    order, worst = edf_order([("J1", 3, 6), ("J2", 2, 8), ("J3", 1, 9),
                              ("J4", 4, 9), ("J5", 3, 14), ("J6", 2, 15)])
    print(f"EDF order={order} maxLateness={worst}")
```

**What it does:** weighted interval scheduling that returns the *chosen set* (via backtracking), and EDF that returns the *optimal order* and its max lateness.
**Run:** `go run main.go` | `javac WeightedProof.java && java WeightedProof` | `python proof.py`

For the data `A[1,3]w5, B[2,5]w6, C[4,6]w5, D[6,7]w4`: finish-sorted is `A,B,C,D`. `A`&`C`&`D` are mutually compatible (`3≤4`, `6≤6`) → `5+5+4=14`. `B` conflicts with `A` (overlap `[2,3)`) and with `C` (overlap `[4,5)`). So optimum is `{A,C,D}=14`, beating any set containing `B`. The code prints `weighted optimum=14 chosen=['A','C','D']`.

---

## 9. Verification Harness

Every proof above should be backed by an exhaustive oracle on small `n`.

```python
from itertools import combinations, permutations


def overlaps(a, b):
    return a[0] < b[1] and b[0] < a[1]   # half-open conflict


def brute_weight(jobs):  # jobs: (id, s, f, w)
    best, bestset = 0, []
    for r in range(len(jobs) + 1):
        for sub in combinations(jobs, r):
            ok = all(not overlaps(sub[i][1:3], sub[j][1:3])
                     for i in range(len(sub)) for j in range(i + 1, len(sub)))
            if ok and sum(x[3] for x in sub) > best:
                best = sum(x[3] for x in sub)
                bestset = [x[0] for x in sub]
    return best, bestset


def brute_lateness(jobs):  # jobs: (id, length, deadline)
    best = float("inf")
    for perm in permutations(jobs):
        t, worst = 0, 0
        for _id, length, d in perm:
            t += length
            worst = max(worst, t - d)
        best = min(best, worst)
    return best


def brute_depth(intervals):  # (s, f)
    pts = sorted({x for iv in intervals for x in iv})
    best = 0
    for i in range(len(pts)):
        t = pts[i]
        best = max(best, sum(1 for s, f in intervals if s <= t < f))
    return best


if __name__ == "__main__":
    import random
    for _ in range(2000):
        n = random.randint(1, 8)
        ivs = []
        for k in range(n):
            s = random.randint(0, 8)
            f = s + random.randint(1, 5)
            ivs.append((chr(65 + k), s, f, random.randint(1, 9)))
        bw, _ = brute_weight(ivs)
        from_dp, _ = weighted_with_set(ivs)   # from §8 reference
        assert bw == from_dp, (ivs, bw, from_dp)
    print("weighted DP matches brute force on 2000 random instances")
```

Analogous loops check EDF against `brute_lateness`, the heap min-rooms against `brute_depth`, and greedy count against the exhaustive subset oracle. If all four agree across thousands of random tiny instances, the proofs are corroborated empirically.

---

## 9.5 Formal Edge-Case and Tie-Break Analysis

A professional must prove the algorithms remain correct at the boundaries, not just on the typical case.

### 9.5.1 Half-open vs closed and the touch point

Under the **half-open** convention `[s, f)`, intervals with `f_i = s_j` are compatible. The overlap predicate `s_i < f_j ∧ s_j < f_i` is *strict* on both sides, so a shared endpoint yields `s_i < f_j` false (when `f_j = s_i`) and the pair is non-conflicting. Every proof above used this:

- **Partitioning lower bound (§4.1)** needs the `D` overlapping intervals to *strictly* contain a common instant `t*` with `s_i ≤ t* < f_i`. At a touch point `f_i = s_j`, no single instant is shared, so touching intervals are *not* counted together in depth — consistent with them sharing a room.
- **Heap reuse condition** `heap.min ≤ s_i` (with `≤`, not `<`) is exactly the half-open rule: a room freeing at time `t` may be reused by an interval starting at `t`.

Switching to **closed** intervals `[s, f]` flips every touch point: change the predicate to `s_i ≤ f_j ∧ s_j ≤ f_i` and the heap reuse to `heap.min < s_i`. The proofs carry over verbatim with these substitutions; only the boundary classification changes. The professional pins one convention per system and audits both the sort comparator and the overlap test for agreement.

### 9.5.2 Ties in the sort key

| Variation | Tie among equal keys | Effect on correctness |
|-----------|----------------------|-----------------------|
| Activity selection (equal finish) | Any order | None — the stays-ahead lemma uses `f` values, equal finishers are interchangeable. |
| Weighted (equal finish) | Any order | None — `OPT` depends on values, not the tie order; `p(j)` is well-defined since the predicate is on `f ≤ s`. |
| Partitioning (equal start) | Any order | None on the *count*; the room *assignment* may differ but all are optimal colorings. |
| EDF (equal deadline) | Any order | None — Fact 2 states equal-deadline jobs are interchangeable without changing `L_max`. |

So **every variation is tie-robust for correctness**; ties matter only for *reproducibility* of the specific witness (which set, which coloring, which order). Production systems impose a deterministic tiebreak (e.g. secondary sort by id) for auditability, not for optimality.

### 9.5.3 Degenerate inputs

- **`n = 0`:** all objectives are `0` (count, rooms, lateness, weight). Each proof's base case holds vacuously.
- **Zero-length interval `[s, s)`:** under half-open it contains no instant, conflicts with nothing, contributes nothing to depth, and is always compatible. The DP may take it for its weight; the partition places it freely.
- **A job with `t_j = 0` (EDF):** completes instantly; never increases the clock; its lateness is `max(0, σ_j − d_j)` where `σ_j` is whatever instant it runs — the exchange lemma still holds (the block span is `t_a + t_b`, unaffected by a zero length).
- **Negative weights (weighted):** the `max(skip, take)` recurrence simply never *takes* a net-negative addition, so dropping non-positive-weight intervals up front is a valid, optimality-preserving preprocessing step — matching the WLOG `w_i > 0` assumption of §1.

These boundary proofs are what separate "passes the sample tests" from "provably correct on all inputs," and they are exactly the cases the §9 oracle should be seeded with.

### 9.5.4 A note on numerical exactness

All four algorithms are *integer-exact* when times and weights are integers: activity selection and partitioning only compare and count; EDF only adds processing times; weighted scheduling only adds weights and compares. There is no division, no floating point, hence no rounding error — unlike the determinant kernels of some other topics. The only overflow risk is the EDF clock or a weight sum exceeding the integer width; use 64-bit accumulators and the results are bit-exact and reproducible. This integer-exactness is *why* these problems make excellent regression oracles for each other: the brute-force and the fast version must agree to the last digit, with no tolerance band, so any discrepancy is a genuine bug rather than a precision artifact.

---

## 10. Summary

Each interval-scheduling variation is optimal for a precise, provable reason, and the professional owns the argument. **Activity selection** is optimal by the *greedy-stays-ahead* induction (greedy's `r`-th finish is never later than the optimum's), equivalently a one-swap exchange — and it works only because of the finish-time order. **EDF** minimizes the maximum lateness by the *adjacent-inversion exchange lemma*: swapping an inverted adjacent pair never raises `L_max`, so removing all inversions reaches the deadline-sorted schedule without harm. **Interval partitioning** is pinned between a *lower bound* — the depth `D` forces at least `D` rooms because the busiest instant's intervals pairwise conflict — and an *upper bound* — the greedy never opens more than `D` rooms — giving `k* = D` and, as a corollary, that interval graphs are perfect (`χ = ω`, optimally colorable in polynomial time). **Weighted interval scheduling** rests on *optimal substructure* (`OPT(j) = max(OPT(j-1), w_j + OPT(p(j)))`), with `p(j)` correct because the finish-sorted compatible-before set is a clean monotone prefix amenable to binary search; no fixed greedy key can be optimal, which is *why* DP is mandatory. Every variation is `Θ(n log n)`, sort-bounded, and reconstructible. Finally, the professional knows the fragile boundary where adding release times, a second machine, or a tardiness-sum objective flips these polynomial gems into NP-hard problems — and backs every claim with an exhaustive small-`n` oracle.
</content>
