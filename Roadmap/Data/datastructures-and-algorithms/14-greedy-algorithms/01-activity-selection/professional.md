# Activity Selection — Mathematical Foundations and Complexity Theory

## Table of Contents
1. [Formal Definitions — Activities, Compatibility, Objective](#1-formal-definitions--activities-compatibility-objective)
2. [The Greedy Algorithm (statement)](#2-the-greedy-algorithm-statement)
3. [Proof of Optimality via the Exchange Argument](#3-proof-of-optimality-via-the-exchange-argument)
4. [Proof via "Greedy Stays Ahead"](#4-proof-via-greedy-stays-ahead)
5. [Greedy-Choice Property and Optimal Substructure (formal)](#5-greedy-choice-property-and-optimal-substructure-formal)
6. [The Matroid / Interval-Structure View](#6-the-matroid--interval-structure-view)
7. [Complexity Analysis — Time, Space, Lower Bound](#7-complexity-analysis--time-space-lower-bound)
8. [The Weighted Generalization and Why Greedy Fails](#8-the-weighted-generalization-and-why-greedy-fails)
9. [Worked Instances and a Verified Reference Implementation](#9-worked-instances-and-a-verified-reference-implementation)
10. [Edge Cases and Degeneracies](#10-edge-cases-and-degeneracies)
11. [Relation to Other Interval Problems](#11-relation-to-other-interval-problems)
12. [Open / Advanced Directions and Summary](#12-open--advanced-directions-and-summary)

---

## 1. Formal Definitions — Activities, Compatibility, Objective

Let `S = {a_1, a_2, …, a_n}` be a set of **activities**. Each activity `a_i` is the half-open interval

```
a_i = [s_i, f_i)   with   s_i, f_i ∈ ℝ   and   s_i < f_i,
```

where `s_i` is the **start time** and `f_i` the **finish time**.

**Definition (compatibility).** Two activities `a_i` and `a_j` are **compatible** (non-overlapping) iff their intervals are disjoint:

```
[s_i, f_i) ∩ [s_j, f_j) = ∅   ⟺   f_i ≤ s_j   or   f_j ≤ s_i.
```

Under the half-open convention, activities that *touch* (`f_i = s_j`) are compatible. (For the closed-interval convention `[s_i, f_i]`, replace `≤` by `<` in the touching case; everything below carries through with that substitution.)

**Definition (mutually compatible set).** A subset `A ⊆ S` is **mutually compatible** iff every pair `a_i, a_j ∈ A` with `i ≠ j` is compatible. Equivalently, sorting `A` by start time, consecutive intervals satisfy `f_{(k)} ≤ s_{(k+1)}`.

**Definition (the problem).** The **Activity Selection Problem** is to find a mutually compatible subset `A* ⊆ S` of **maximum cardinality** `|A*|`. We seek `max { |A| : A ⊆ S, A mutually compatible }`. (This is the *unweighted* maximization; the weighted version is Section 8.)

WLOG assume the activities are indexed in nondecreasing finish-time order:

```
f_1 ≤ f_2 ≤ … ≤ f_n.
```

This ordering, obtainable by an `O(n log n)` sort, underlies every proof below.

---

## 2. The Greedy Algorithm (statement)

> **Earliest-Finish-Time (EFT) Greedy.** Sort activities so that `f_1 ≤ f_2 ≤ … ≤ f_n`. Maintain a "last finish" value `t`, initially `−∞`, and an output set `A = ∅`. Scan `i = 1 … n`; if `s_i ≥ t`, add `a_i` to `A` and set `t ← f_i`. Return `A`.

In pseudocode:

```
GREEDY-ACTIVITY-SELECTOR(s, f):          # f sorted ascending
    A = { a_1 }                          # always take the first (earliest finish)
    t = f_1
    for i = 2 to n:
        if s_i >= t:                     # compatible with the last selected
            A = A ∪ { a_i }
            t = f_i
    return A
```

We prove `A` is a mutually compatible set of maximum size.

**Validity (compatibility of the output).** Each added activity `a_i` satisfies `s_i ≥ t = f_j` where `a_j` was the previously added activity (the one whose finish set `t`). So consecutive selected activities satisfy `f_j ≤ s_i`, i.e. they are compatible; and since finishes are nondecreasing and each new `t` is the latest finish so far, *all* selected activities are pairwise compatible. Hence `A` is mutually compatible. ∎ (validity)

It remains to prove **optimality** — that no compatible set is larger.

---

## 3. Proof of Optimality via the Exchange Argument

This is the canonical proof (CLRS Theorem 16.1 in spirit), phrased as an exchange/swap argument.

**Lemma (greedy-choice).** Let `a_m` be the activity in `S` with the earliest finish time (`f_m = min_i f_i`; with the assumed ordering, `m = 1`). Then there exists a maximum-size mutually compatible subset of `S` that contains `a_m`.

**Proof.** Let `A*` be any maximum-size mutually compatible subset. Order `A*` by finish time and let `a_k` be its first (earliest-finishing) activity.

- If `a_k = a_m`, then `A*` already contains `a_m` and we are done.
- Otherwise, form `A' = (A* \ {a_k}) ∪ {a_m}`. We claim `A'` is mutually compatible and `|A'| = |A*|`.

Cardinality: we removed one activity and added one, so `|A'| = |A*|`.

Compatibility: every other activity `a_j ∈ A* \ {a_k}` finishes no earlier than `a_k` (since `a_k` was the earliest finisher in `A*`) and, being compatible with `a_k`, starts at `s_j ≥ f_k`. Because `a_m` has the globally earliest finish, `f_m ≤ f_k ≤ s_j`, so `a_m` is compatible with every such `a_j`. Thus `A'` is mutually compatible.

Therefore `A'` is a maximum-size compatible subset containing `a_m`. ∎ (lemma)

**Theorem (optimality of EFT greedy).** The set `A` returned by `GREEDY-ACTIVITY-SELECTOR` is a maximum-size mutually compatible subset of `S`.

**Proof.** By induction on `n = |S|`.

*Base case.* `n = 0`: the empty set is trivially optimal. `n = 1`: greedy returns `{a_1}`, which is optimal (size 1).

*Inductive step.* By the lemma, some optimal solution contains the earliest finisher `a_m = a_1`. Greedy selects `a_1` first. After selecting `a_1`, both greedy and that optimal solution must complete using only activities in

```
S' = { a_i ∈ S : s_i ≥ f_1 },
```

the activities compatible with `a_1`. The subproblem on `S'` is an Activity Selection Problem of strictly smaller size (`a_1 ∉ S'`). Greedy's remaining behavior is exactly `GREEDY-ACTIVITY-SELECTOR` on `S'` (the scan continues with `t = f_1`, accepting precisely the activities of `S'` that are compatible). By the induction hypothesis, greedy solves the `S'` subproblem optimally, returning a maximum compatible subset `A_{S'}`. Then

```
|A| = 1 + |A_{S'}| = 1 + OPT(S') = OPT(S),
```

where the last equality holds because an optimal solution of `S` containing `a_1` consists of `a_1` plus an optimal solution of `S'` (optimal substructure, Section 5). Hence `A` is optimal. ∎

The exchange step — swapping any optimal solution's first activity for the earliest finisher without changing size or validity — is the heart of the argument and the reason "earliest finish" is the correct greedy key.

---

## 4. Proof via "Greedy Stays Ahead"

An alternative, equally rigorous proof (Kleinberg–Tardos style) avoids induction-on-subproblems and instead compares greedy to an arbitrary optimal solution position by position.

Let greedy select `g_1, g_2, …, g_k` in order (so `f(g_1) ≤ f(g_2) ≤ … ≤ f(g_k)`), and let `o_1, o_2, …, o_m` be any optimal solution sorted by finish time. We prove greedy "stays ahead."

**Lemma (stay-ahead).** For all `r` with `1 ≤ r ≤ k`, `f(g_r) ≤ f(o_r)`.

**Proof by induction on `r`.**

*Base `r = 1`.* Greedy picks the activity with globally earliest finish, so `f(g_1) ≤ f(o_1)`.

*Step.* Assume `f(g_{r-1}) ≤ f(o_{r-1})`. Since `o_1, …, o_m` is compatible, `s(o_r) ≥ f(o_{r-1}) ≥ f(g_{r-1})` by the hypothesis. So `o_r` is compatible with greedy's first `r−1` selections, hence `o_r` was a *candidate* available to greedy at step `r` (its start is `≥` greedy's running `t = f(g_{r-1})`). Greedy chooses the candidate with the earliest finish, so `f(g_r) ≤ f(o_r)`. ∎ (lemma)

**Theorem.** `k = m`; greedy is optimal.

**Proof.** Suppose for contradiction `k < m`, i.e. optimal has strictly more activities. Consider `o_{k+1}`, which exists. By the stay-ahead lemma, `f(g_k) ≤ f(o_k)`. Optimal's compatibility gives `s(o_{k+1}) ≥ f(o_k) ≥ f(g_k)`. So `o_{k+1}` is compatible with all of greedy's `k` selections and its start is `≥` greedy's final `t = f(g_k)`. But then greedy's scan would have encountered `o_{k+1}` (or some activity finishing no later) and accepted it, contradicting that greedy stopped at `k`. Hence `k ≥ m`. Since greedy's output is a valid compatible set, `k ≤ m`. Therefore `k = m`. ∎

Both proofs establish the same result; the exchange argument is more local (swap one element), while stay-ahead is more global (track the running frontier). Interviewers accept either.

---

## 5. Greedy-Choice Property and Optimal Substructure (formal)

CLRS isolates two properties that any greedy-solvable problem exhibits; activity selection satisfies both.

**Greedy-choice property.** A globally optimal solution can be obtained by making a locally optimal (greedy) choice. *Formalized here:* the lemma of Section 3 — there is an optimal solution containing the earliest finisher `a_1`. This lets greedy commit to `a_1` immediately, never reconsidering.

**Optimal substructure.** An optimal solution to the problem contains within it optimal solutions to subproblems. *Formalized here:* if `A*` is optimal for `S` and `a_1 ∈ A*`, then `A* \ {a_1}` is optimal for the subproblem `S' = {a_i : s_i ≥ f_1}`. 

*Proof.* `A* \ {a_1} ⊆ S'` (every other activity of `A*` is compatible with `a_1`, so starts `≥ f_1`) and is mutually compatible. If some `B ⊆ S'` were compatible with `|B| > |A* \ {a_1}|`, then `B ∪ {a_1}` would be compatible (all of `B` starts `≥ f_1`) with `|B ∪ {a_1}| > |A*|`, contradicting optimality of `A*`. Hence `A* \ {a_1}` is optimal for `S'`. ∎

Together, greedy-choice + optimal substructure are exactly the hypotheses under which "make the greedy choice, recurse on the rest" yields a global optimum — and the induction of Section 3 is their mechanical consequence.

### 5.1 The dynamic-programming origin (and its collapse)

Before greedy is justified, the problem has a pure DP formulation that exposes the substructure with no greedy assumption. Add sentinels `a_0 = [−∞, 0)` and `a_{n+1} = [∞, ∞)`. For indices `0 ≤ i < j ≤ n+1`, let

```
S_{ij} = { a_k : f_i ≤ s_k  and  f_k ≤ s_j }
```

be the activities that start after `a_i` finishes and finish before `a_j` starts. Let `c[i][j] = |maximum compatible subset of S_{ij}|`. Then

```
c[i][j] = 0                                              if S_{ij} = ∅
c[i][j] = max_{a_k ∈ S_{ij}} ( c[i][k] + 1 + c[k][j] )   otherwise.
```

This is a correct `O(n³)`-time, `O(n²)`-space DP (it tries *every* activity `a_k` as the "split" inside `S_{ij}`). The **greedy theorem** proves the `max` is superfluous: the `a_k ∈ S_{ij}` with the smallest finish time is always a valid choice realizing the maximum, so `c[i][j] = c[i][m] + 1 + c[m][j]` for the earliest finisher `a_m`, and moreover `S_{im} = ∅` (no activity finishes before the earliest finisher in `S_{ij}` starts), so `c[i][m] = 0` and the recurrence linearizes to "take earliest, recurse right." The `O(n³)` DP collapses to the `O(n)` sweep. This collapse — from a cubic table to a linear scan — is the precise formal content of "the greedy-choice property holds here."

### 5.2 Substructure does NOT require greedy

A subtle point worth stressing: optimal substructure (Section 5) holds for the problem regardless of whether greedy is optimal. It is the *greedy-choice property* (Section 3's lemma) that is special. Many problems have optimal substructure but lack the greedy-choice property and therefore genuinely need the full DP (the weighted version is the immediate example). Distinguishing "has substructure" from "has greedy-choice" is the crux of deciding greedy-vs-DP.

---

## 6. The Matroid / Interval-Structure View

Activity selection is *not* a matroid optimization in the standard sense (the compatible sets do not form the independent sets of a matroid — they are not closed under taking subsets in a way that gives the exchange property matroids require for *weighted* greedy). This is precisely *why* the greedy works for the **unweighted** (maximum cardinality) objective but **fails** for arbitrary weights.

More precisely, the family of mutually compatible subsets forms an **independence system** (downward-closed: every subset of a compatible set is compatible), but it is generally **not a matroid** because the matroid exchange axiom fails. Consider three intervals where two short disjoint ones `{a, b}` and one long one `{c}` overlapping both are each independent; the exchange axiom would require augmenting `{c}` from the larger `{a, b}`, but neither `a` nor `b` can join `{c}` (both overlap `c`). The axiom fails, so the structure is not a matroid.

The consequence for theory: the **weighted greedy theorem for matroids** (Rado–Edmonds) does *not* apply, so sorting by weight and greedily adding does not maximize weighted value. Yet for the **unit-weight (cardinality)** objective, the *interval* structure has its own special exchange property — captured by the earliest-finish lemma — that rescues the greedy. Activity selection is thus a clean example of a problem where the *cardinality* greedy is optimal even though the underlying system is not a matroid, distinguishing it from genuinely matroidal problems like minimum spanning tree (where weighted greedy *is* optimal).

---

## 7. Complexity Analysis — Time, Space, Lower Bound

**Time.**

- Sorting by finish time: `O(n log n)` with any comparison sort.
- The greedy scan: a single pass with `O(1)` work per activity → `O(n)`.
- **Total: `O(n log n)`**, dominated by the sort.

If the input is **pre-sorted by finish time** (e.g. an online finish-ordered stream), the algorithm is `O(n)`. If finish times are **integers in `[0, T)`**, a counting/radix sort gives `O(n + T)`, which is `O(n)` when `T = O(n)`.

**Space.**

- The greedy uses `O(1)` auxiliary space beyond the input (one `t` scalar and a counter, or the output list of selected activities, `O(k) ⊆ O(n)` if you record them).
- An in-place sort adds `O(log n)` recursion stack (quicksort) or `O(n)` (merge sort).

**Lower bound.** Any comparison-based algorithm that *must distinguish the relative order of finish times* inherits the `Ω(n log n)` sorting lower bound: a reduction shows that solving activity selection on adversarial inputs lets you recover a sorted order, so `Ω(n log n)` comparisons are necessary in the comparison model. With non-comparison assumptions (bounded integer times), the `O(n + T)` counting-sort variant beats this, consistent with sorting's own non-comparison speedups. Hence the EFT greedy is **asymptotically optimal** in the comparison model.

**Brute force (for contrast).** Enumerating all `2^n` subsets and checking compatibility in `O(n)` each is `O(2^n · n)` — exponential, suitable only for `n ≤ ~20` or as a correctness oracle.

**A note on the `Ω(n log n)` reduction.** Given `n` distinct numbers `x_1, …, x_n` to sort, construct unit intervals `[x_i, x_i + 0)` — degenerate, so instead use `[2x_i, 2x_i + 1)` so that all are pairwise disjoint and an optimal selection of size `n` must process them in finish order, exposing the sorted permutation. Since sorting requires `Ω(n log n)` comparisons in the worst case, so does any comparison-based activity selector that reports a full optimal schedule of disjoint intervals. This confirms the EFT greedy's sort is not wasteful but information-theoretically required.

---

## 8. The Weighted Generalization and Why Greedy Fails

Attach a value `v_i > 0` to each activity. The **Weighted Interval Scheduling** problem asks for a mutually compatible subset maximizing `Σ v_i`.

**Greedy fails.** Sorting by finish (or by value, or by value/length) and greedily adding is not optimal. Counterexample:

```
a_1 = [0, 10), v = 5
a_2 = [1, 3),  v = 1
a_3 = [4, 6),  v = 1
```

EFT greedy on finish order takes `a_2` (finish 3) then `a_3` (finish 6), total value 2; the optimum is `{a_1}` with value 5. The earliest-finisher lemma of Section 3 breaks because removing the high-value `a_1` to insert an earlier finisher *reduces value* even though it preserves cardinality.

**The correct method (DP).** Sort by finish time. Define `p(i)` = the largest `j < i` with `f_j ≤ s_i` (the latest compatible predecessor; computable by binary search since finishes are sorted). Let `OPT(i)` be the maximum value using activities `{a_1, …, a_i}`. Then

```
OPT(0) = 0
OPT(i) = max( OPT(i−1),  v_i + OPT(p(i)) )       for i ≥ 1.
```

*Correctness (sketch).* Either `a_i` is in the optimal solution for `{a_1..a_i}` or it is not. If not, `OPT(i) = OPT(i−1)`. If yes, no activity `a_j` with `p(i) < j < i` can be in the solution (each overlaps `a_i`), so the rest of the solution is an optimum over `{a_1..a_{p(i)}}`, giving `v_i + OPT(p(i))`. Taking the max is correct by optimal substructure of the weighted problem. ∎

**Complexity.** Sort `O(n log n)`; `n` binary searches `O(n log n)`; table fill `O(n)`; reconstruction `O(n)`. Total `O(n log n)` time, `O(n)` space. The unweighted activity selection is the special case `v_i ≡ 1`, where `OPT` happens to equal the greedy's cardinality — but *only* because equal weights restore the cardinality structure.

### 8.1 Reference weighted DP with reconstruction

The DP below returns both the optimal value and the chosen set, and reduces to the greedy's answer when all weights are 1.

#### Python

```python
from bisect import bisect_right


def weighted_schedule(acts):
    """acts: list of (start, finish, value). Returns (best_value, chosen_indices
    into the SORTED-by-finish order)."""
    a = sorted(range(len(acts)), key=lambda i: acts[i][1])
    a = [acts[i] for i in a]
    n = len(a)
    finishes = [x[1] for x in a]
    p = [bisect_right(finishes, a[i][0], 0, i) - 1 for i in range(n)]
    dp = [0] * (n + 1)
    for i in range(1, n + 1):
        take = a[i - 1][2] + (dp[p[i - 1] + 1] if p[i - 1] >= 0 else 0)
        dp[i] = max(dp[i - 1], take)
    # reconstruct
    chosen, i = [], n
    while i > 0:
        take = a[i - 1][2] + (dp[p[i - 1] + 1] if p[i - 1] >= 0 else 0)
        if take >= dp[i - 1]:
            chosen.append(i - 1)
            i = p[i - 1] + 1
        else:
            i -= 1
    chosen.reverse()
    return dp[n], chosen


if __name__ == "__main__":
    weighted = [(0, 10, 5), (1, 3, 1), (4, 6, 1)]
    print(weighted_schedule(weighted))   # (5, [...]) — the single long high-value job

    unit = [(1, 4, 1), (3, 5, 1), (0, 6, 1), (5, 7, 1), (3, 8, 1), (5, 9, 1)]
    val, _ = weighted_schedule(unit)
    print("unit-weight value =", val)    # 2 — matches the cardinality greedy
```

This makes the boundary precise: the DP's `OPT` equals the EFT greedy's count *iff* all weights are equal; introduce any unequal weight and the DP can diverge from (and beat) the greedy.

### 8.2 Why no greedy key works for the weighted problem

It is worth recording that *every* one-pass greedy key fails for the weighted version, not just earliest finish:

- **By value (descending)** — picking the highest-value activity first can block two medium-value compatible activities whose sum is larger.
- **By value/length (density)** — a high-density short activity can straddle and exclude a slightly-lower-density pair that together dominate.
- **By earliest finish** — ignores value entirely, as the counterexample above shows.

No total order on single activities captures the combinatorial trade-off, which is precisely the signature of a problem that needs DP rather than greedy. The non-matroid structure of Section 6 is the formal reason such an order cannot exist.

---

## 9. Worked Instances and a Verified Reference Implementation

### 9.1 Worked instance of the exchange step

Consider `S` already finish-sorted:

```
a_1 = [1, 4)   a_2 = [3, 5)   a_3 = [0, 6)   a_4 = [5, 7)   a_5 = [3, 8)   a_6 = [5, 9)
```

Suppose an adversary proposes the "optimal" `A* = {a_2, a_4}` (sizes match the greedy's answer of 2, but its first activity is `a_2 = [3,5)`, not the earliest finisher `a_1 = [1,4)`). Apply the lemma's swap: `A' = (A* \ {a_2}) ∪ {a_1} = {a_1, a_4}`.

- Cardinality preserved: `|A'| = 2 = |A*|`.
- Compatibility: the remaining activity `a_4 = [5,7)` has `s_4 = 5 ≥ f_1 = 4`, so `a_1` is compatible with it. `A'` is valid.

The swap turned an optimal solution into one that *agrees with greedy's first choice*, exactly as the lemma promises. Recursing on `S' = {a_i : s_i ≥ 4} = {a_4, a_6}` (and `a_5 = [3,8)` excluded since `3 < 4`), greedy picks `a_4`, after which nothing starts `≥ 7`. Final greedy answer `{a_1, a_4}`, size 2, matches `OPT`.

### 9.2 Worked instance of stay-ahead

Greedy on the same `S` selects `g_1 = a_1 = [1,4)`, `g_2 = a_4 = [5,7)`. Any optimal `o_1, o_2` sorted by finish satisfies the lemma:

```
r = 1:  f(g_1) = 4  ≤  f(o_1)    (g_1 is the global earliest finisher)
r = 2:  f(g_2) = 7  ≤  f(o_2)    (o_2 starts ≥ f(o_1) ≥ 4, so it was available; greedy took the earliest)
```

No optimal solution can place its `r`-th finish before greedy's, so optimal cannot squeeze in a third activity that greedy missed — confirming `k = m = 2`.

### 9.3 A verified reference implementation

The reference below returns the maximum count and the selected indices, and includes a brute-force oracle so the optimality proof is *checkable* on random inputs. All three print `2` for the worked instance and pass an oracle assertion.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func eftGreedy(s, f []int) []int {
	n := len(s)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return f[order[a]] < f[order[b]] })
	chosen := []int{}
	t := -1 << 62
	for _, i := range order {
		if s[i] >= t {
			chosen = append(chosen, i)
			t = f[i]
		}
	}
	return chosen
}

// brute oracle: max compatible subset size via subset enumeration.
func brute(s, f []int) int {
	n := len(s)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		var iv [][2]int
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				iv = append(iv, [2]int{s[i], f[i]})
			}
		}
		sort.Slice(iv, func(a, b int) bool { return iv[a][1] < iv[b][1] })
		ok := true
		for k := 1; k < len(iv); k++ {
			if iv[k][0] < iv[k-1][1] { // overlap (half-open)
				ok = false
				break
			}
		}
		if ok && len(iv) > best {
			best = len(iv)
		}
	}
	return best
}

func main() {
	s := []int{1, 3, 0, 5, 3, 5}
	f := []int{4, 5, 6, 7, 8, 9}
	chosen := eftGreedy(s, f)
	fmt.Println("count =", len(chosen)) // 2
	if len(chosen) != brute(s, f) {
		panic("greedy != oracle")
	}
	fmt.Println("oracle OK")
}
```

#### Java

```java
import java.util.*;

public class Optimal {
    static List<Integer> eftGreedy(int[] s, int[] f) {
        int n = s.length;
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(f[a], f[b]));
        List<Integer> chosen = new ArrayList<>();
        long t = Long.MIN_VALUE;
        for (int i : order)
            if (s[i] >= t) { chosen.add(i); t = f[i]; }
        return chosen;
    }

    static int brute(int[] s, int[] f) {
        int n = s.length, best = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<int[]> iv = new ArrayList<>();
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) iv.add(new int[]{s[i], f[i]});
            iv.sort((a, b) -> Integer.compare(a[1], b[1]));
            boolean ok = true;
            for (int k = 1; k < iv.size(); k++)
                if (iv.get(k)[0] < iv.get(k - 1)[1]) { ok = false; break; }
            if (ok) best = Math.max(best, iv.size());
        }
        return best;
    }

    public static void main(String[] args) {
        int[] s = {1, 3, 0, 5, 3, 5};
        int[] f = {4, 5, 6, 7, 8, 9};
        List<Integer> chosen = eftGreedy(s, f);
        System.out.println("count = " + chosen.size()); // 2
        if (chosen.size() != brute(s, f)) throw new AssertionError("greedy != oracle");
        System.out.println("oracle OK");
    }
}
```

#### Python

```python
from itertools import combinations


def eft_greedy(s, f):
    order = sorted(range(len(s)), key=lambda i: f[i])
    chosen, t = [], float("-inf")
    for i in order:
        if s[i] >= t:
            chosen.append(i)
            t = f[i]
    return chosen


def brute(s, f):
    n = len(s)
    best = 0
    for r in range(n + 1):
        for comb in combinations(range(n), r):
            iv = sorted((s[i], f[i]) for i in comb)
            if all(a[1] <= b[0] for a, b in zip(iv, iv[1:])):
                best = max(best, r)
    return best


if __name__ == "__main__":
    s = [1, 3, 0, 5, 3, 5]
    f = [4, 5, 6, 7, 8, 9]
    chosen = eft_greedy(s, f)
    print("count =", len(chosen))      # 2
    assert len(chosen) == brute(s, f)  # optimality witnessed
    print("oracle OK")
```

**What it does:** the EFT greedy alongside a brute-force subset oracle, so the optimality theorem of Sections 3–4 is empirically witnessed on every input.
**Run:** `go run main.go` | `javac Optimal.java && java Optimal` | `python optimal.py`

---

## 10. Edge Cases and Degeneracies

- **Empty instance (`n = 0`).** The optimum is `∅`, size 0. Greedy returns `∅`.
- **Single activity.** Optimum size 1.
- **All pairwise overlapping** (e.g. `n` copies of `[0, 1)`, or a common point in all intervals). Optimum size 1; greedy keeps exactly one (the earliest finisher, with the pinned tie-break).
- **All pairwise disjoint.** Optimum size `n`; greedy keeps all.
- **Touching intervals** (`f_i = s_j`). Compatible under half-open; the test `s_j ≥ t` (with `≥`) accepts them. Under closed intervals use strict `>`.
- **Equal finish times.** The lemma uses "an" earliest finisher; any tie-break yields the same optimal cardinality. For reproducibility, pin a deterministic tie-break (e.g. by index). Note the *set* of chosen activities can differ across tie-breaks even though the *count* is invariant — relevant if downstream consumers depend on identity.
- **Zero-length intervals (`s_i = f_i`).** Degenerate; either forbid them (`s_i < f_i` required) or define them as points compatible with everything — document the choice, since it changes the count.
- **Real vs integer times.** The proofs use only the order relation `≤` on finish times, so they hold for reals; integer times additionally enable counting-sort speedups and dodge floating-point boundary ambiguity at `f_i = s_j`.
- **Unbounded / infinite endpoints.** A sentinel `[−∞, 0)` or `[∞, ∞)` (Section 5.1) is a proof device, not a real activity; in code, use a finite `−∞` surrogate (e.g. a large negative integer) for the initial `lastEnd` and never emit the sentinels.

---

## 11. Relation to Other Interval Problems

| Problem | Objective | Optimal method | Key structural fact |
|---------|-----------|----------------|---------------------|
| **Activity selection** | max count, 1 resource | EFT greedy `O(n log n)` | earliest-finisher exchange lemma |
| Weighted interval scheduling | max value, 1 resource | DP `O(n log n)` | optimal substructure on `p(i)` |
| Interval partitioning | schedule all, min resources | start-sorted min-heap greedy | min rooms = max overlap depth |
| Minimum lateness | min max lateness, 1 machine | Earliest Deadline First greedy | adjacent-swap exchange on deadlines |
| Maximum concurrency | peak overlap depth | endpoint sweep line `O(n log n)` | `+1`/`−1` on sorted endpoints |
| Interval point cover | min points stabbing all intervals | EFT-style greedy on finish | dual of selection (pick finishes as stab points) |

A notable duality: **interval point cover** (choose the fewest points so every interval contains one) is solved by *the same finish-sorted greedy* — repeatedly place a point at the earliest finish among uncovered intervals. The earliest-finish principle governs both selection and covering, a reflection of LP duality between the maximization and the covering formulations (detailed in Section 12.2).

The **interval-partitioning lower bound** (min resources `≥` max overlap depth) plus the heap greedy achieving it is the multi-resource sibling theorem; activity selection is its single-resource maximization counterpart.

---

## 12. Open / Advanced Directions and Summary

### 12.1 Advanced directions

- **Online competitive analysis.** With arbitrarily ordered arrivals and irrevocable decisions, no deterministic online algorithm is optimal; randomized and "secretary-style" variants admit competitive bounds. Finish-ordered arrival restores optimality (the offline greedy *is* the online sweep).
- **Geometric generalizations.** Selecting a maximum set of pairwise non-overlapping axis-parallel intervals generalizes to maximum independent set in interval graphs — solvable in `O(n log n)` (exactly this greedy), unlike general-graph MIS which is NP-hard. Activity selection is the algorithmic witness that *interval graphs* are perfect/tractable.
- **Weighted + multi-machine.** Combining values with `m` machines yields harder scheduling problems; some are polynomial (min-cost flow formulations), others NP-hard depending on constraints.
- **Stochastic / robust versions.** Uncertain durations or arrivals push the problem into stochastic optimization, where the deterministic greedy is only a heuristic.
- **Parameterized / approximation angles.** For NP-hard multi-dimensional generalizations (e.g. rectangle packing, multi-machine weighted scheduling), the one-dimensional activity-selection greedy becomes a subroutine inside approximation algorithms and LP-rounding schemes, retaining its earliest-finish heuristic value even where exact optimality is unattainable.

### 12.2 The covering dual in detail

The interval **point cover** dual deserves a precise statement. Given intervals `[s_i, f_i]`, choose the minimum number of points such that every interval contains at least one chosen point. The optimal greedy: sort by finish, repeatedly take the earliest finish among still-uncovered intervals as a stab point, then skip all intervals it covers. The size of this point set equals, by LP duality, the maximum number of pairwise-disjoint intervals — which is exactly the activity-selection optimum. So `max disjoint intervals = min stabbing points`, a clean min-max (König-type) equality that both greedies witness simultaneously. Recognizing that selection and covering are two faces of the same earliest-finish principle is a hallmark of a deep understanding of the problem.

### 12.3 Summary

The Activity Selection Problem — maximum-cardinality mutually compatible subset of intervals on one resource — is solved optimally by the **earliest-finish-time greedy**: sort by finish (`O(n log n)`), then sweep accepting any activity whose start is `≥` the last accepted finish (`O(n)`). Optimality has two standard proofs of the *same* fact: an **exchange argument** (any optimal solution's first activity can be swapped for the globally earliest finisher without losing size or validity, then recurse) and the **greedy-stays-ahead** lemma (`f(g_r) ≤ f(o_r)` for all `r`, so greedy never falls behind the optimum). The two enabling properties are the **greedy-choice property** (an optimum contains the earliest finisher) and **optimal substructure** (removing it leaves an optimum of the compatible-remainder subproblem). The structure is an independence system but **not a matroid**, which is exactly why the cardinality greedy succeeds while the *weighted* greedy fails — weights require the `O(n log n)` DP `OPT(i) = max(OPT(i−1), v_i + OPT(p(i)))`. The comparison-model lower bound `Ω(n log n)` makes the greedy asymptotically optimal, dropping to `O(n)` for pre-sorted or `O(n + T)` for bounded-integer times. Activity selection thus stands as the cleanest rigorous example of greedy optimality: a one-line algorithm, a two-line proof, and a precise boundary (cardinality vs weight, one resource vs many, count vs lateness) beyond which the greedy must yield to dynamic programming or a different greedy entirely.
