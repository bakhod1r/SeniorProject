# Fractional Knapsack — Interview Preparation

Fractional Knapsack is one of the most-asked greedy problems precisely because it sits at a fork: it *looks* like the famous NP-complete 0/1 Knapsack, but the tiny change "items are divisible" makes a simple greedy provably optimal. Interviewers love it because it tests (1) whether you reach for greedy and can *prove* it, (2) whether you know the contrast with 0/1 cold, and (3) whether you can implement a clean comparator-based fill. This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact | Statement |
|------|-----------|
| Goal | Max value in a capacity-`W` bag; items may be split. |
| Greedy key | density `ρ = value / weight`, sort **descending**. |
| Fill | Take whole while it fits; slice the one that does not; stop. |
| Optimality | Exchange argument — shift weight to denser item, value ↑ or `=`. |
| Why greedy works | **Divisibility** — you can move a sliver of weight. |
| Partial items | **At most one** item is taken fractionally. |
| Complexity | `O(n log n)` sort; `O(n)` value-only via quickselect. |
| Space | `O(1)` extra. |
| 0/1 contrast | Indivisible → greedy fails → DP `O(nW)`, NP-complete decision. |
| LP view | `max vᵀx, wᵀx ≤ W, 0 ≤ x ≤ 1`; critical density = dual/clearing price. |
| Bound | Fractional optimum ≥ 0/1 optimum (B&B upper bound). |

Build recipe:

```text
for each item: ρ = value / weight
sort items by ρ descending
remaining = W
for item in order:
    if weight <= remaining: take whole; remaining -= weight
    else: take fraction remaining/weight; break
```

Arithmetic choice:

```text
typical          -> float density, round output
exact ranking    -> cross-multiply  v_i*w_j ? v_j*w_i  (positive weights)
exact value      -> rational (Fraction / big.Rat)
money / bytes    -> fixed-point (cents / bytes)
value only, big n-> O(n) quickselect on critical density
```

---

## Junior Questions (12 Q&A)

### J1. What does the Fractional Knapsack problem ask?
Given items with values and weights and a bag of capacity `W`, choose how much of each item (any fraction from 0 to 1) to take so the total weight is `≤ W` and the total value is maximized.

### J2. What is the greedy strategy?
Compute each item's density `value/weight`, sort items from highest density to lowest, and fill the bag greedily — take each item whole while it fits, then take a fraction of the next item to exactly fill the remaining capacity.

### J3. What is "density" and why sort by it?
Density `= value/weight` is the value of one unit of weight of an item. Each unit of bag capacity is scarce, so you spend it on the most valuable-per-unit item first. That is why density, not raw value, is the sort key.

### J4. Why is taking a fraction allowed and important?
Because items are divisible, when the next item does not fully fit you take exactly the fraction that fills the bag (`remaining/weight`). This top-off is what lets greedy reach the true optimum.

### J5. How many items are taken fractionally in the optimal solution?
**At most one** — the item where the bag fills up. Everything before it is taken whole; everything after is not taken at all.

### J6. What is the time complexity?
`O(n log n)`, dominated by sorting items by density. The fill is `O(n)`. Space is `O(1)` beyond the item list.

### J7. Sort by value or by weight — which is correct?
Neither alone. Sort by the **ratio** `value/weight`. Sorting by value or weight individually gives wrong answers.

### J8. What happens if capacity exceeds the total weight of all items?
You take everything (all fractions = 1) and the answer is the sum of all values. The fractional branch is never reached.

### J9. What if a single item is heavier than the whole bag?
You take a fraction of just that item: value `= (W / weight) × value`.

### J10. Walk through `W=50` with items `(60,10), (100,20), (120,30)`.
Densities `6, 5, 4` (already sorted). Take `(60,10)` → value 60, remaining 40. Take `(100,20)` → value 160, remaining 20. `(120,30)` does not fit; take `20/30` of it → `+80`. Total **240**.

### J11. How is this different from the 0/1 Knapsack?
In 0/1 Knapsack items are indivisible (take whole or skip). There, greedy-by-density can be wrong and you need dynamic programming. The fractional version allows splitting, so greedy is optimal.

### J12. How would you verify your implementation on small inputs?
Check known answers: `W=50,(60,10)(100,20)(120,30) → 240`; `W=10,(60,10) → 60`; `W=10,(100,20) → 50` (half). Also assert at most one fractional item and that capacity larger than total weight yields the sum of all values.

---

## Middle Questions (12 Q&A)

### M1. Prove that the greedy algorithm is optimal.
Exchange argument: take any optimal solution. If it does not match greedy, there is a denser item `a` taken less than greedy and a less-dense item `b` taken more. Move a small weight `δ` from `b` to `a`: total weight unchanged, value changes by `δ(ρ_a − ρ_b) ≥ 0`. So you never lose value while converging to greedy; therefore greedy is optimal.

### M2. Why does that proof fail for 0/1 Knapsack?
The proof transfers a *small amount* `δ` of weight, which requires fractions. In 0/1 each item is all-or-nothing, so the transfer is illegal and the argument collapses.

### M3. Give a counterexample where greedy fails for 0/1 Knapsack.
`W=50`, items `(60,10),(100,20),(120,30)`. 0/1 greedy-by-density takes the first two (value 160), can't fit the third. Optimum is the last two (`100+120=220`). Greedy (160) < optimal (220).

### M4. What is the 0/1 Knapsack DP recurrence and complexity?
`dp[i][c] = max(dp[i-1][c], dp[i-1][c-wᵢ] + vᵢ)`, filled over items `i` and capacities `c = 0..W`. Complexity `O(nW)` time, `O(W)` space with a rolling array. Pseudo-polynomial; the decision version is NP-complete.

### M5. Is the fractional optimum related to the 0/1 optimum?
Yes — the fractional optimum is an **upper bound** on the 0/1 optimum (the integer feasible set is a subset of the fractional one). This bound drives branch-and-bound for 0/1 Knapsack.

### M6. How do you avoid floating-point error in the density comparison?
Cross-multiply: compare `vᵢ·wⱼ` against `vⱼ·wᵢ` (valid for positive weights). This is exact integer arithmetic with no division.

### M7. How do you handle a zero-weight item?
Its density is infinite — take it fully for free. Filter such items out (adding their value) before sorting to avoid division by zero.

### M8. Can you compute the answer without sorting?
Yes. The value depends only on the **critical density** (the partial item's density). A quickselect-style partition finds it in `O(n)` expected time, summing the prefix without a full sort — useful when you only need the value.

### M9. State the problem as a linear program.
`maximize Σ vᵢxᵢ` subject to `Σ wᵢxᵢ ≤ W` and `0 ≤ xᵢ ≤ 1`. Greedy returns the LP optimum, a vertex of the feasible polytope, with at most one fractional coordinate.

### M10. What is the minimization mirror of this problem?
"Buy at least `T` units at minimum cost" with divisible goods: sort by **cost-per-unit ascending** and fill from the cheapest. Same greedy structure, reversed key.

### M11. Does increasing capacity ever decrease the optimal value?
No — the value is monotonically non-decreasing in `W`. More capacity can only let you take more value.

### M12. If two items have equal density, does the order matter?
Not for the total value — equal-density items are interchangeable per unit weight. It can matter for a deterministic *plan* (which item to slice), so break ties consistently (e.g., by index).

---

## Senior Questions (10 Q&A)

### S1. Design a budget-allocation service backed by Fractional Knapsack.
Share a density-ranking primitive. For value-only queries use the `O(n)` quickselect on the critical density; for plans, sort once and reuse. Use fixed-point arithmetic for money/bytes, cache by a canonical `(items, W)` hash, and expose the critical density `ρ*` as the clearing price. Assert the partial-item invariant and capacity utilization.

### S2. How do you get an `O(n)` algorithm instead of `O(n log n)`?
Quickselect around the critical density: partition items into denser/equal/less-dense around a random pivot, recurse into the side holding the capacity boundary. Expected `O(n)`; median-of-medians pivots give worst-case `O(n)`.

### S3. What does the critical density mean economically?
It is the LP **dual variable** on the capacity constraint — the marginal value of one more unit of capacity, i.e., the clearing/market-clearing price. Everything above it is fully served, below it dropped, the marginal item partially served (water-filling analogy).

### S4. How would you run this over data too large to sort in memory?
Build a density **histogram** in one streaming pass, binary-search the critical-density bucket across (possibly sharded) histograms, then a second pass takes everything above it and slices within it. Two passes, constant memory, trivially parallel across shards.

### S5. How do you make the result bit-reproducible across machines?
Use integer/fixed-point arithmetic and exact cross-multiplication for ordering; avoid float reductions (order-sensitive). Cache only deterministic results.

### S6. What do you monitor in production?
Allocation latency by `n`, the critical-density distribution (clearing price drift), capacity utilization (fraction of `W` filled), the partial-item count (must be ≤ 1), and periodic float-vs-exact divergence checks.

### S7. When is Fractional Knapsack the wrong tool?
When items are indivisible (use 0/1 DP), value is non-linear in the fraction (convex optimization), or there are multiple capacities/constraints (LP/ILP). Greedy assumes a single capacity and linear, divisible value.

### S8. How does it relate to solving 0/1 Knapsack exactly?
The fractional optimum is the LP-relaxation upper bound at each branch-and-bound node. A fast, exact Fractional Knapsack is the inner loop that prunes the 0/1 search tree.

### S9. How do you handle an online/streaming version where you must commit immediately?
Approximate the offline greedy with a threshold policy: serve a request iff its density exceeds an estimated `ρ*`, adapting the threshold as the budget depletes — the basis of ad-budget pacing and rate shaping.

### S10. What is the worst-case input for the quickselect variant and how do you guard?
Adversarial pivots cause `O(n²)`. Guard with median-of-medians (deterministic `O(n)`) or introselect — fall back to a sort after too many unbalanced partitions.

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove optimality via LP duality.
The dual of `max vᵀx, wᵀx ≤ W, x ≤ 𝟙, x ≥ 0` is `min Wλ + 𝟙ᵀμ, wᵢλ + μᵢ ≥ vᵢ, λ,μ ≥ 0`. Set `λ = ρ_k` (critical density) and `μᵢ = wᵢ·max(0, ρᵢ − ρ_k)`. This dual is feasible and satisfies complementary slackness with greedy's primal, certifying optimality by strong duality.

### P2. Why does the optimum have at most one fractional variable?
The feasible region is a polytope; an LP optimum lies at a vertex where `n` independent constraints are tight. At most one coordinate can avoid a tight `{0,1}` bound when the capacity constraint is also tight — that is the single fractional item.

### P3. What is the complexity class of Fractional vs 0/1 Knapsack?
Fractional is **strongly polynomial** (`O(n log n)` or `O(n)`), independent of `W`'s magnitude. 0/1's decision version is **NP-complete**; its DP is pseudo-polynomial `O(nW)` (exponential in the bit-length of `W`).

### P4. How do you compute the value in worst-case linear time?
Weighted selection with median-of-medians pivots: partition around the median-of-medians density, recurse into the side containing the capacity boundary. Each level removes a constant fraction, giving `Θ(n)` worst case.

### P5. Why is cross-multiplication exact and when can it overflow?
`vᵢ/wᵢ > vⱼ/wⱼ ⟺ vᵢwⱼ > vⱼwᵢ` for positive weights — no division, exact in integers. With `v, w < 2³¹` products fit in 64 bits; beyond that use 128-bit or big integers.

### P6. Connect Fractional Knapsack to matroid greedy.
It is the continuous analogue of greedy over an independence system. The optimality (densest-first) parallels the matroid greedy underlying Kruskal's MST: both are instances of "greedy is optimal over a suitably structured feasible region."

### P7. How well-conditioned is the optimal value as a function of `W`?
It is piecewise-linear, monotone, and Lipschitz with constant `ρ_max`; the slope at `W` equals the critical density `ρ_k`. Small perturbations of `W` change the value by at most `ρ_max·|ΔW|` — well-conditioned, no catastrophic cancellation.

### P8. How is the relaxation used to build an FPTAS for 0/1 Knapsack?
By rounding/scaling item values and using the fractional/DP structure, one obtains a fully polynomial-time approximation scheme for 0/1 Knapsack achieving `(1−ε)·OPT` in `O(n³/ε)`-style time. The fractional relaxation provides the bound that makes the scheme's guarantees provable.

---

## Behavioral Questions (5)

### B1. Tell me about a time you recognized a greedy structure in a messy real problem.
*Structure (STAR):* describe a resource-allocation task (budget/bandwidth/compute) that looked complicated (Situation/Task), recognizing it was Fractional Knapsack — divisible resources ranked by value-per-unit (Action), and shipping an `O(n log n)`/`O(n)` allocator with a correctness proof and invariants (Result). Emphasize *spotting divisibility* as the unlock.

### B2. Describe a time you had to prove an algorithm was correct, not just that it passed tests.
Talk through presenting the exchange argument (or LP duality) for the greedy choice, why "it passed the cases I tried" was insufficient for a money-handling allocator, and how the proof plus the partial-item invariant gave the team confidence.

### B3. Tell me about avoiding a tempting-but-wrong shortcut.
Describe resisting the urge to apply density greedy to an *indivisible* (0/1) allocation, recognizing the counterexample, and switching to DP/branch-and-bound — while still using the fractional bound to prune. The lesson: the seductive wrong answer is the dangerous one.

### B4. How did you explain a subtle algorithmic distinction to a non-expert?
Explain how you taught "fractional vs 0/1" using the gold-dust-vs-suitcases analogy, then showed the `240 vs 220` numeric example, tailoring depth to the audience.

### B5. A time you optimized something already "fast enough."
Describe replacing an `O(n log n)` sort with an `O(n)` quickselect when only the value was needed at large `n`, measuring the win, and keeping the sort path for plans — matching the algorithm to the actual query.

---

## Coding Challenges

### Challenge 1 — Maximum Value (basic greedy)

**Problem.** Given `n` items `(value, weight)` and capacity `W`, return the maximum value obtainable when items may be split. Print with 4 decimals.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func fractionalKnapsack(W float64, vals, wts []float64) float64 {
	idx := make([]int, len(vals))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool {
		return vals[idx[a]]/wts[idx[a]] > vals[idx[b]]/wts[idx[b]]
	})
	remaining, total := W, 0.0
	for _, i := range idx {
		if wts[i] <= remaining {
			total += vals[i]
			remaining -= wts[i]
		} else {
			total += remaining / wts[i] * vals[i]
			break
		}
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", fractionalKnapsack(50,
		[]float64{60, 100, 120}, []float64{10, 20, 30})) // 240.0000
}
```

#### Java

```java
import java.util.*;

public class Challenge1 {
    static double fractionalKnapsack(double W, double[] vals, double[] wts) {
        Integer[] idx = new Integer[vals.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) ->
            Double.compare(vals[b] / wts[b], vals[a] / wts[a]));
        double remaining = W, total = 0.0;
        for (int i : idx) {
            if (wts[i] <= remaining) { total += vals[i]; remaining -= wts[i]; }
            else { total += remaining / wts[i] * vals[i]; break; }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", fractionalKnapsack(50,
            new double[]{60, 100, 120}, new double[]{10, 20, 30})); // 240.0000
    }
}
```

#### Python

```python
def fractional_knapsack(W, vals, wts):
    idx = sorted(range(len(vals)), key=lambda i: vals[i] / wts[i], reverse=True)
    remaining, total = W, 0.0
    for i in idx:
        if wts[i] <= remaining:
            total += vals[i]; remaining -= wts[i]
        else:
            total += remaining / wts[i] * vals[i]; break
    return total


if __name__ == "__main__":
    print(f"{fractional_knapsack(50, [60, 100, 120], [10, 20, 30]):.4f}")  # 240.0000
```

---

### Challenge 2 — Return the Take-Plan (which fractions)

**Problem.** Return both the max value and the fraction taken of each *original* item (index-aligned). At most one fraction should be in `(0,1)`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func plan(W float64, vals, wts []float64) (float64, []float64) {
	idx := make([]int, len(vals))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool {
		return vals[idx[a]]/wts[idx[a]] > vals[idx[b]]/wts[idx[b]]
	})
	frac := make([]float64, len(vals))
	remaining, total := W, 0.0
	for _, i := range idx {
		if wts[i] <= remaining {
			frac[i] = 1
			total += vals[i]
			remaining -= wts[i]
		} else {
			frac[i] = remaining / wts[i]
			total += frac[i] * vals[i]
			break
		}
	}
	return total, frac
}

func main() {
	v, f := plan(50, []float64{60, 100, 120}, []float64{10, 20, 30})
	fmt.Printf("%.1f %.4f\n", v, f) // 240.0 [1 1 0.6667]
}
```

#### Java

```java
import java.util.*;

public class Challenge2 {
    static double plan(double W, double[] vals, double[] wts, double[] frac) {
        Integer[] idx = new Integer[vals.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(vals[b] / wts[b], vals[a] / wts[a]));
        double remaining = W, total = 0.0;
        for (int i : idx) {
            if (wts[i] <= remaining) { frac[i] = 1; total += vals[i]; remaining -= wts[i]; }
            else { frac[i] = remaining / wts[i]; total += frac[i] * vals[i]; break; }
        }
        return total;
    }

    public static void main(String[] args) {
        double[] f = new double[3];
        double v = plan(50, new double[]{60, 100, 120}, new double[]{10, 20, 30}, f);
        System.out.printf("%.1f %s%n", v, Arrays.toString(f));
    }
}
```

#### Python

```python
def plan(W, vals, wts):
    idx = sorted(range(len(vals)), key=lambda i: vals[i] / wts[i], reverse=True)
    frac = [0.0] * len(vals)
    remaining, total = W, 0.0
    for i in idx:
        if wts[i] <= remaining:
            frac[i] = 1.0; total += vals[i]; remaining -= wts[i]
        else:
            frac[i] = remaining / wts[i]; total += frac[i] * vals[i]; break
    return total, frac


if __name__ == "__main__":
    v, f = plan(50, [60, 100, 120], [10, 20, 30])
    print(v, [round(x, 4) for x in f])  # 240.0 [1, 1, 0.6667]
```

---

### Challenge 3 — Exact Ranking (no floating-point in comparisons)

**Problem.** Items have **integer** values and weights. Rank by density using cross-multiplication (no float division) and return the value; the only float is the final slice.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func exactRank(W int64, v, w []int64) float64 {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	// v[a]/w[a] > v[b]/w[b]  <=>  v[a]*w[b] > v[b]*w[a]
	sort.Slice(idx, func(a, b int) bool {
		return v[idx[a]]*w[idx[b]] > v[idx[b]]*w[idx[a]]
	})
	remaining := W
	total := 0.0
	for _, i := range idx {
		if w[i] <= remaining {
			total += float64(v[i])
			remaining -= w[i]
		} else {
			total += float64(remaining) / float64(w[i]) * float64(v[i])
			break
		}
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", exactRank(50, []int64{60, 100, 120}, []int64{10, 20, 30})) // 240
}
```

#### Java

```java
import java.util.*;

public class Challenge3 {
    static double exactRank(long W, long[] v, long[] w) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Long.compare(v[b] * w[a], v[a] * w[b])); // descending
        long remaining = W; double total = 0.0;
        for (int i : idx) {
            if (w[i] <= remaining) { total += v[i]; remaining -= w[i]; }
            else { total += (double) remaining / w[i] * v[i]; break; }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", exactRank(50,
            new long[]{60, 100, 120}, new long[]{10, 20, 30})); // 240
    }
}
```

#### Python

```python
import functools


def exact_rank(W, v, w):
    def cmp(a, b):  # descending by density via cross-multiplication
        lhs, rhs = v[a] * w[b], v[b] * w[a]
        return -1 if lhs > rhs else (1 if lhs < rhs else 0)

    idx = sorted(range(len(v)), key=functools.cmp_to_key(cmp))
    remaining, total = W, 0.0
    for i in idx:
        if w[i] <= remaining:
            total += v[i]; remaining -= w[i]
        else:
            total += remaining / w[i] * v[i]; break
    return total


if __name__ == "__main__":
    print(f"{exact_rank(50, [60, 100, 120], [10, 20, 30]):.4f}")  # 240
```

---

### Challenge 4 — Fractional Bound + 0/1 Optimum (the contrast)

**Problem.** Given integer items and capacity `W`, print both the fractional optimum (greedy) and the 0/1 optimum (DP), and confirm `fractional ≥ 0/1`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func frac(W int, v, w []int) float64 {
	idx := make([]int, len(v))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return v[idx[a]]*w[idx[b]] > v[idx[b]]*w[idx[a]] })
	rem, total := W, 0.0
	for _, i := range idx {
		if w[i] <= rem {
			total += float64(v[i])
			rem -= w[i]
		} else {
			total += float64(rem) / float64(w[i]) * float64(v[i])
			break
		}
	}
	return total
}

func opt01(W int, v, w []int) int {
	dp := make([]int, W+1)
	for i := range v {
		for c := W; c >= w[i]; c-- {
			if dp[c-w[i]]+v[i] > dp[c] {
				dp[c] = dp[c-w[i]] + v[i]
			}
		}
	}
	return dp[W]
}

func main() {
	v, w := []int{60, 100, 120}, []int{10, 20, 30}
	fmt.Printf("fractional=%.1f  0/1=%d\n", frac(50, v, w), opt01(50, v, w)) // 240.0  220
}
```

#### Java

```java
import java.util.*;

public class Challenge4 {
    static double frac(int W, int[] v, int[] w) {
        Integer[] idx = new Integer[v.length];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Long.compare((long) v[b] * w[a], (long) v[a] * w[b]));
        int rem = W; double total = 0;
        for (int i : idx) {
            if (w[i] <= rem) { total += v[i]; rem -= w[i]; }
            else { total += (double) rem / w[i] * v[i]; break; }
        }
        return total;
    }

    static int opt01(int W, int[] v, int[] w) {
        int[] dp = new int[W + 1];
        for (int i = 0; i < v.length; i++)
            for (int c = W; c >= w[i]; c--)
                dp[c] = Math.max(dp[c], dp[c - w[i]] + v[i]);
        return dp[W];
    }

    public static void main(String[] args) {
        int[] v = {60, 100, 120}, w = {10, 20, 30};
        System.out.printf("fractional=%.1f  0/1=%d%n", frac(50, v, w), opt01(50, v, w));
    }
}
```

#### Python

```python
import functools


def frac(W, v, w):
    idx = sorted(range(len(v)),
                 key=functools.cmp_to_key(
                     lambda a, b: (v[b] * w[a]) - (v[a] * w[b])))  # descending density
    rem, total = W, 0.0
    for i in idx:
        if w[i] <= rem:
            total += v[i]; rem -= w[i]
        else:
            total += rem / w[i] * v[i]; break
    return total


def opt01(W, v, w):
    dp = [0] * (W + 1)
    for vi, wi in zip(v, w):
        for c in range(W, wi - 1, -1):
            dp[c] = max(dp[c], dp[c - wi] + vi)
    return dp[W]


if __name__ == "__main__":
    v, w = [60, 100, 120], [10, 20, 30]
    f, o = frac(50, v, w), opt01(50, v, w)
    print(f"fractional={f:.1f}  0/1={o}")  # 240.0  220
    assert f >= o
```

---

### Challenge 5 — O(n) Value via Quickselect (no full sort)

**Problem.** Return the maximum value in `O(n)` expected time by partitioning around the critical density rather than sorting. Validate against the sort-based answer.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

type It struct{ v, w int64 }

func denser(a, b It) bool { return a.v*b.w > b.v*a.w }

func maxValue(W int64, items []It) float64 {
	its := append([]It(nil), items...)
	total := 0.0
	cap := W
	for len(its) > 0 && cap > 0 {
		piv := its[rand.Intn(len(its))]
		var H, E, L []It
		var wH int64
		for _, it := range its {
			switch {
			case denser(it, piv):
				H = append(H, it)
				wH += it.w
			case denser(piv, it):
				L = append(L, it)
			default:
				E = append(E, it)
			}
		}
		if wH >= cap {
			its = H
			continue
		}
		for _, it := range H {
			total += float64(it.v)
		}
		cap -= wH
		done := false
		for _, it := range E {
			if it.w <= cap {
				total += float64(it.v)
				cap -= it.w
			} else {
				total += float64(cap) / float64(it.w) * float64(it.v)
				cap = 0
				done = true
				break
			}
		}
		if done || cap == 0 {
			break
		}
		its = L
	}
	return total
}

func main() {
	fmt.Printf("%.4f\n", maxValue(50, []It{{60, 10}, {100, 20}, {120, 30}})) // 240
}
```

#### Java

```java
import java.util.*;

public class Challenge5 {
    record It(long v, long w) {}
    static boolean denser(It a, It b) { return a.v() * b.w() > b.v() * a.w(); }

    static double maxValue(long W, List<It> items) {
        List<It> its = new ArrayList<>(items);
        double total = 0; long cap = W; Random rng = new Random(7);
        while (!its.isEmpty() && cap > 0) {
            It piv = its.get(rng.nextInt(its.size()));
            List<It> H = new ArrayList<>(), E = new ArrayList<>(), L = new ArrayList<>();
            long wH = 0;
            for (It it : its) {
                if (denser(it, piv)) { H.add(it); wH += it.w(); }
                else if (denser(piv, it)) L.add(it);
                else E.add(it);
            }
            if (wH >= cap) { its = H; continue; }
            for (It it : H) total += it.v();
            cap -= wH;
            boolean done = false;
            for (It it : E) {
                if (it.w() <= cap) { total += it.v(); cap -= it.w(); }
                else { total += (double) cap / it.w() * it.v(); cap = 0; done = true; break; }
            }
            if (done || cap == 0) break;
            its = L;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", maxValue(50,
            List.of(new It(60,10), new It(100,20), new It(120,30)))); // 240
    }
}
```

#### Python

```python
import random


def denser(a, b):
    return a[0] * b[1] > b[0] * a[1]


def max_value(W, items):
    its, total, cap = list(items), 0.0, W
    while its and cap > 0:
        piv = its[random.randrange(len(its))]
        H = [x for x in its if denser(x, piv)]
        L = [x for x in its if denser(piv, x)]
        E = [x for x in its if not denser(x, piv) and not denser(piv, x)]
        wH = sum(x[1] for x in H)
        if wH >= cap:
            its = H; continue
        total += sum(x[0] for x in H); cap -= wH
        done = False
        for v, w in E:
            if w <= cap:
                total += v; cap -= w
            else:
                total += cap / w * v; cap = 0; done = True; break
        if done or cap == 0:
            break
        its = L
    return total


if __name__ == "__main__":
    print(f"{max_value(50, [(60,10),(100,20),(120,30)]):.4f}")  # 240
```

---

## Final Tips

- **Lead with the greedy key.** Say "sort by `value/weight` descending" immediately — interviewers want to hear *density*, not value or weight.
- **Volunteer the proof.** A one-line exchange argument ("shift weight to the denser item, value can't drop") signals depth.
- **Nail the contrast.** State unprompted that this fails for 0/1 Knapsack and *why* (divisibility), with the `240 vs 220` example ready.
- **Mention the structure.** "At most one item is taken fractionally" is a crisp, memorable fact.
- **Know the optimization.** Bring up the `O(n)` quickselect on the critical density for value-only queries — it impresses at the senior bar.
- **Handle edge cases out loud.** Zero-weight items, `W=0`, `W ≥ Σw`, a single oversized item.
- **Watch the comparison.** Use `weight <= remaining` (an exactly-fitting item is taken whole), and `break` after the slice.
</content>
