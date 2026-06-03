# Set Cover Approximation — Middle Level

> **One-line summary:** Beyond "pick the biggest set each round," the middle level explains *what the approximation ratio `H(n) = ln(n)+1` actually means*, contrasts the **greedy** algorithm with the **LP-relaxation + rounding** alternative, generalizes to **weighted set cover** (minimize total cost, where greedy picks the best *cost-per-newly-covered-element*), and connects Set Cover to its cousins (vertex cover, max coverage, dominating set).

---

## Table of Contents

1. [Recap and Framing](#recap-and-framing)
2. [What the Approximation Ratio Actually Means](#what-the-approximation-ratio-actually-means)
3. [Why Greedy Achieves H(n) — The Charging Intuition](#why-greedy-achieves-hn--the-charging-intuition)
4. [Weighted Set Cover](#weighted-set-cover)
5. [The LP Relaxation and Why It Helps](#the-lp-relaxation-and-why-it-helps)
6. [Greedy vs LP Rounding — Two Roads to a Cover](#greedy-vs-lp-rounding--two-roads-to-a-cover)
7. [Relatives: Vertex Cover, Max Coverage, Dominating Set](#relatives-vertex-cover-max-coverage-dominating-set)
8. [Code: Weighted Greedy Set Cover (Go / Java / Python)](#code-weighted-greedy-set-cover)
9. [Performance Analysis](#performance-analysis)
10. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
11. [Best Practices](#best-practices)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Recap and Framing

At the junior level we learned the recipe: while elements remain uncovered, pick the set covering the most still-uncovered elements, mark them, repeat. It runs in roughly `O(m·n)` and is guaranteed to use at most `H(n) = ln(n)+1` times OPT sets.

The middle level answers the questions a thoughtful engineer asks next:

1. What does an **approximation ratio** of `H(n)` *really* guarantee — and what does it *not*?
2. *Why* does greedy hit exactly `H(n)`? (The "charging" intuition, before the full proof.)
3. Real instances have **costs** — set `A` costs $10, set `B` costs $3. How does greedy change?
4. There is a completely different approach via **linear programming** — what is it, and when is it better?
5. Set Cover has famous **relatives** (vertex cover, max coverage). How do they connect?

We carry the verified `O(m·n)` greedy from junior level and generalize its selection rule and arithmetic.

---

## What the Approximation Ratio Actually Means

An algorithm is a **ρ-approximation** for a minimization problem if, on **every** input, it returns a solution whose cost is at most `ρ` times the optimal cost:

```
ALG(input) ≤ ρ · OPT(input)   for all inputs.
```

For greedy set cover, `ρ = H(n) = 1 + 1/2 + … + 1/n ≈ ln(n) + 1`. Read this carefully — there are three subtleties that trip people up:

1. **It is a worst-case guarantee, not an average.** On a typical instance greedy is usually *far* better than `ln(n)·OPT` — often within a few percent of optimal. The ratio bounds the *worst* input, which adversaries construct deliberately.

2. **`n` is the universe size, not the number of sets.** The bound depends on `|U| = n`. (A tighter, often-quoted bound is `H(d)` where `d` is the size of the *largest set* — since the first set greedy can pick has at most `d` elements. `H(d) ≤ H(n)`, so it is sharper when sets are small.)

3. **The ratio is essentially tight.** There exist instances where greedy really uses `≈ ln(n)·OPT` sets (the "halving" constructions). So you cannot prove a constant-factor guarantee for greedy — the `ln(n)` growth is real, not an artifact of a loose proof. And by Feige's theorem, *no* polynomial algorithm does asymptotically better unless P = NP.

A worked feel for the numbers:

```
n = 100        → H(n) ≈ 5.19    (ln 100 ≈ 4.6)
n = 10,000     → H(n) ≈ 9.79
n = 1,000,000  → H(n) ≈ 14.39
```

So even for a million elements, greedy is at worst ~14× optimal — and usually much closer.

---

## Why Greedy Achieves H(n) — The Charging Intuition

The full proof lives in `professional.md`; here is the intuition every middle engineer should carry.

**Setup.** Let `OPT` be the minimum number of sets. At any moment, suppose `r` elements remain uncovered. Those `r` elements *can* be covered by OPT sets (the optimal solution covers them, among others). By pigeonhole, **some** set covers at least `r / OPT` of the remaining elements.

**Greedy's pick is at least that good.** Greedy chooses the maximum-gain set, so it covers **at least** `r / OPT` new elements. Hence the uncovered count drops from `r` to at most `r · (1 − 1/OPT)`.

**Charging.** Give each element a "price" equal to `1 / (gain of the set that covered it)`. When a set with gain `g` is chosen, it covers `g` elements, each charged `1/g`, so the set contributes exactly `1` to the total price — meaning **total price = number of sets greedy used.** Now bound the price element-by-element: the `k`-th-to-last element to be covered is paid for by a set whose gain is at least `(remaining)/OPT`, and summing these prices over all elements telescopes into

```
total price ≤ OPT · (1 + 1/2 + … + 1/n) = OPT · H(n).
```

So `greedy = total price ≤ H(n) · OPT`. The harmonic number appears because the prices look like `OPT/r, OPT/(r−1), …` — a harmonic series. This "dual fitting / charging" argument is the standard way to prove greedy guarantees and is worth internalizing.

---

## Weighted Set Cover

Real instances rarely minimize *count*. Each set `Sᵢ` has a **cost** `c(Sᵢ)` (dollars, energy, latency), and we minimize the **total cost** of a cover. Unit costs recover the unweighted problem.

The greedy rule generalizes beautifully. Instead of "most elements covered," pick the set with the best **cost-effectiveness** — the lowest **cost per newly covered element**:

```
choose the set minimizing   c(Sᵢ) / (number of still-uncovered elements in Sᵢ).
```

Equivalently, each newly covered element is "charged" `c(Sᵢ) / gain` — the same charging quantity as before, now weighted by cost.

> **Weighted Greedy.**
> While elements remain uncovered:
> - For each set, compute `ratio = cost / (uncovered elements it contains)`.
> - Pick the set with the **smallest** ratio.
> - Add it; mark its elements covered.

**Guarantee.** Weighted greedy is also an `H(n)`-approximation (and `H(d)` with `d` the largest set). The charging argument carries over: each element pays at most `c/gain` at the moment it is covered, and these payments sum to at most `H(n)·OPT`. This is the same `ln(n)+1` ratio — weights do not hurt the bound.

**Tiny worked example.**

```
U = {1,2,3,4},  costs in [..]
S0 = {1,2,3}  cost 3   → ratio 3/3 = 1.0   ← best (lowest)
S1 = {1,2}    cost 1   → ratio 1/2 = 0.5
S2 = {3,4}    cost 1   → ratio 1/2 = 0.5
```

Round 1: S1 and S2 tie at `0.5`; pick S1 (cost 1, covers {1,2}). Remaining = {3,4}.
Round 2: S2 ratio `1/2 = 0.5` (covers {3,4}), S0 ratio `3/1 = 3`. Pick S2 (cost 1). Total cost = **2**, covering everything — cheaper than the single S0 (cost 3). Greedy by *count* would have grabbed S0 first; greedy by *cost-effectiveness* finds the cheaper plan.

---

## The LP Relaxation and Why It Helps

Set Cover has a clean **integer linear program (ILP)**. Introduce a 0/1 variable `xᵢ` for each set (1 = chosen):

```
minimize     Σᵢ c(Sᵢ) · xᵢ
subject to   Σ_{i : e ∈ Sᵢ} xᵢ ≥ 1     for every element e   (e is covered)
             xᵢ ∈ {0, 1}.
```

Solving this ILP exactly is NP-hard (it *is* set cover). The trick of approximation algorithms is to **relax** the integrality constraint `xᵢ ∈ {0,1}` to `xᵢ ∈ [0, 1]` — a real-valued **linear program (LP)**, which *is* solvable in polynomial time. The LP optimum `OPT_LP` is a **lower bound** on the true `OPT` (relaxing constraints can only lower the minimum):

```
OPT_LP ≤ OPT.
```

This lower bound is the engine of LP-based approximation: if we can round the fractional LP solution back to integers without inflating the cost too much, we get a provable guarantee *measured against `OPT_LP`*, hence against `OPT`.

Two standard rounding routes:

1. **Frequency-based rounding (deterministic).** Let `f` be the maximum **frequency** — the largest number of sets any single element belongs to. Round up every `xᵢ ≥ 1/f` to 1. This yields an **`f`-approximation**. (For **vertex cover**, every element/edge has frequency exactly `f = 2`, giving the famous 2-approximation.)

2. **Randomized rounding.** Independently include set `i` with probability `xᵢ`, repeat `O(log n)` rounds to ensure every element is covered w.h.p. This yields an **`O(log n)`-approximation** — the same order as greedy, via a totally different mechanism.

The **integrality gap** of the LP — the worst-case ratio `OPT / OPT_LP` — is `Θ(log n)`, which is *why* no LP-rounding approach beats greedy's `ln n` in general, and why both land at `Θ(log n)`.

---

## Greedy vs LP Rounding — Two Roads to a Cover

| Aspect | Greedy | LP relaxation + rounding |
|--------|--------|--------------------------|
| Idea | Pick best cost-effectiveness each round | Solve fractional LP, round to integers |
| Ratio (general) | `H(n) = ln(n)+1` | `O(log n)` (randomized) or `f` (frequency) |
| Best when | General instances; simplicity; speed | Low frequency `f` (e.g. vertex cover, `f=2`) |
| Needs an LP solver | No | Yes (or a combinatorial primal-dual variant) |
| Speed | `~O(m·n)` or `O(total·log m)` | LP solve can dominate; primal-dual is fast |
| Lower bound used | Implicit (charging) | Explicit `OPT_LP` certificate |
| Determinism | Deterministic | Randomized (rounding) or deterministic (frequency) |

**Rule of thumb:**

- General set cover, want it simple and fast → **greedy** (`ln n`).
- Every element is in few sets (small frequency `f`) → **LP frequency rounding** gives an `f`-approximation, which beats `ln n` when `f` is a small constant (vertex cover: `f = 2`).
- Want a certified lower bound alongside the solution → **LP** gives `OPT_LP` for free; greedy does not (though the **primal-dual** method gives greedy-like guarantees *with* a dual certificate).

The two are not enemies: the **primal-dual** schema unifies them — greedy can be seen as constructing a feasible LP dual while it covers, which is exactly how its guarantee is proved (dual fitting).

---

## Relatives: Vertex Cover, Max Coverage, Dominating Set

Set Cover is the hub of a family of covering problems:

| Problem | Relation to Set Cover | Best known approx |
|---------|----------------------|-------------------|
| **Vertex Cover** | Special case: universe = edges, each vertex is the set of edges it touches → frequency `f = 2`. | `2` (LP/matching); `2 − o(1)` is essentially optimal under UGC. |
| **Dominating Set** | Equivalent to set cover (each vertex's closed neighborhood is a set). | `ln(n) + 1` (greedy). |
| **Max k-Coverage** | *Maximize* elements covered using exactly `k` sets (a knapsack-flavored dual). | `1 − 1/e ≈ 0.632` (greedy, tight). |
| **Weighted Set Cover** | Generalization with set costs. | `H(n)` (cost-effectiveness greedy). |
| **Set Multicover** | Each element must be covered `≥ rₑ` times. | `H(n)` (greedy generalizes). |

The **Max k-Coverage** sibling deserves a note: it flips the objective — instead of "cover everything with fewest sets," it asks "cover the most elements with a *budget* of `k` sets." Greedy (pick the highest-gain set `k` times) gives a **`1 − 1/e ≈ 63%`** guarantee there, which is also tight unless P = NP. This `1 − 1/e` factor comes from the **submodularity** of the coverage function — covering has *diminishing returns*, and greedy on a monotone submodular function under a cardinality constraint always achieves `1 − 1/e`. Set Cover and Max Coverage are the two faces of the same submodular coin.

---

## Code: Weighted Greedy Set Cover

We implement **weighted** greedy: each round pick the set minimizing `cost / (newly covered elements)`. With all costs `= 1` this reduces to the unweighted "max gain" rule. All three programs solve the same instance and print the chosen sets and total cost.

#### Go

```go
package main

import "fmt"

// weightedGreedySetCover picks, each round, the set with the lowest
// cost-per-newly-covered-element. Returns chosen indices and total cost.
func weightedGreedySetCover(n int, sets [][]int, cost []float64) ([]int, float64) {
	covered := make([]bool, n)
	numCovered := 0
	var chosen []int
	total := 0.0

	for numCovered < n {
		best := -1
		bestRatio := 0.0
		for i, s := range sets {
			gain := 0
			for _, e := range s {
				if !covered[e] {
					gain++
				}
			}
			if gain == 0 {
				continue
			}
			ratio := cost[i] / float64(gain)
			if best == -1 || ratio < bestRatio {
				bestRatio = ratio
				best = i
			}
		}
		if best == -1 {
			break // infeasible: no set covers any remaining element
		}
		chosen = append(chosen, best)
		total += cost[best]
		for _, e := range sets[best] {
			if !covered[e] {
				covered[e] = true
				numCovered++
			}
		}
	}
	return chosen, total
}

func main() {
	sets := [][]int{
		{0, 1, 2}, // S0
		{0, 1},    // S1
		{2, 3},    // S2
	}
	cost := []float64{3, 1, 1}
	chosen, total := weightedGreedySetCover(4, sets, cost)
	fmt.Println("chosen:", chosen, "total cost:", total) // [1 2] 2
}
```

#### Java

```java
import java.util.*;

public class WeightedGreedy {
    // Weighted greedy set cover: lowest cost-per-new-element each round.
    static Object[] cover(int n, int[][] sets, double[] cost) {
        boolean[] covered = new boolean[n];
        int numCovered = 0;
        List<Integer> chosen = new ArrayList<>();
        double total = 0.0;

        while (numCovered < n) {
            int best = -1;
            double bestRatio = 0.0;
            for (int i = 0; i < sets.length; i++) {
                int gain = 0;
                for (int e : sets[i]) if (!covered[e]) gain++;
                if (gain == 0) continue;
                double ratio = cost[i] / gain;
                if (best == -1 || ratio < bestRatio) { bestRatio = ratio; best = i; }
            }
            if (best == -1) break; // infeasible
            chosen.add(best);
            total += cost[best];
            for (int e : sets[best])
                if (!covered[e]) { covered[e] = true; numCovered++; }
        }
        return new Object[]{chosen, total};
    }

    public static void main(String[] args) {
        int[][] sets = {{0, 1, 2}, {0, 1}, {2, 3}};
        double[] cost = {3, 1, 1};
        Object[] r = cover(4, sets, cost);
        System.out.println("chosen: " + r[0] + " total cost: " + r[1]); // [1, 2] 2.0
    }
}
```

#### Python

```python
def weighted_greedy_set_cover(n, sets, cost):
    """Each round, pick the set with the lowest cost / newly-covered-count.
    Returns (chosen indices, total cost)."""
    covered = [False] * n
    num_covered = 0
    chosen, total = [], 0.0

    while num_covered < n:
        best, best_ratio = -1, 0.0
        for i, s in enumerate(sets):
            gain = sum(1 for e in s if not covered[e])
            if gain == 0:
                continue
            ratio = cost[i] / gain
            if best == -1 or ratio < best_ratio:
                best_ratio, best = ratio, i
        if best == -1:
            break  # infeasible
        chosen.append(best)
        total += cost[best]
        for e in sets[best]:
            if not covered[e]:
                covered[e] = True
                num_covered += 1
    return chosen, total


if __name__ == "__main__":
    sets = [[0, 1, 2], [0, 1], [2, 3]]
    cost = [3, 1, 1]
    chosen, total = weighted_greedy_set_cover(4, sets, cost)
    print("chosen:", chosen, "total cost:", total)  # [1, 2] 2.0
```

**What it does:** generalizes greedy to costs — picks the most cost-effective set (lowest cost per newly covered element) each round, achieving the same `H(n)` ratio against total cost.
**Run:** `go run main.go` | `javac WeightedGreedy.java && java WeightedGreedy` | `python weighted.py`

---

## Worked Comparison — Greedy vs LP Lower Bound on One Instance

It helps to see all the pieces on a single small instance. Take:

```
U = {0,1,2,3,4,5}
S0 = {0,1,2}   cost 1
S1 = {2,3,4}   cost 1
S2 = {4,5}     cost 1
S3 = {0,1,2,3,4,5}  cost 2.6   (covers everything, but expensive)
```

**Greedy by cost-effectiveness.**
- Round 1 ratios: `S0 → 1/3 ≈ 0.33`, `S1 → 1/3`, `S2 → 1/2`, `S3 → 2.6/6 ≈ 0.43`. Tie between S0 and S1 at `0.33`; pick S0. Covered `{0,1,2}`.
- Round 2: `S1 → 1/2` (new {3,4}), `S2 → 1/2` (new {4,5}), `S3 → 2.6/3 ≈ 0.87`. Tie S1/S2; pick S1. Covered `{0,1,2,3,4}`.
- Round 3: `S2 → 1/1 = 1` (only 5 new), `S3 → 2.6/1`. Pick S2. Covered all. **Total cost = 3.**

**The single set S3** alone covers everything at cost `2.6` — *cheaper* than greedy's `3`. This shows greedy is not optimal: it committed to small cost-effective sets early and missed the bulk discount. OPT here is `2.6` (just S3), so greedy/OPT `= 3/2.6 ≈ 1.15` — well within `H(6) ≈ 2.45`.

**The LP lower bound.** The LP can set `x₃ = 1` (fractionally choosing only S3) for `OPT_LP ≤ 2.6`, or spread weight across S0,S1,S2. The LP optimum here is `2.6` (integral), certifying `OPT = 2.6`. Greedy's `3` is provably within the `H(n)` factor of this certified bound. In a service, emitting `OPT_LP` alongside greedy's cost tells the consumer "you are within 15% of optimal here" — far more actionable than a bare number.

**Lesson.** Greedy's cost-effectiveness rule is *myopic*: it never sees the bulk discount of a large expensive set until the cheaper sets are exhausted. The `H(n)` guarantee bounds how badly this myopia can hurt, and the LP bound *quantifies* it per instance.

---

## When Greedy Beats LP Rounding and Vice Versa — A Mental Model

A compact way to remember the trade-off:

- **Greedy wins on simplicity and generality.** No LP solver, no rounding, deterministic, `O(m·n)`. For an arbitrary instance with no special structure, greedy's `ln n` is as good as it gets, so the extra machinery of LP buys nothing.
- **LP rounding wins when frequency is low.** If every element lives in at most `f` sets, frequency rounding gives an `f`-approximation. When `f` is a small constant — emphatically `f = 2` for vertex cover — this *beats* `ln n` for any non-trivial `n`. The LP "sees" the low-frequency structure that greedy is blind to.
- **LP wins when you need a certificate.** The fractional optimum `OPT_LP` is a *proof* of a lower bound. Greedy's dual-fitting gives one too, but the LP's is exact (no `H(n)` slack). When a stakeholder asks "how do you know this is near-optimal?", the LP answers directly.
- **Both lose to exact methods on small instances.** If `m` is small, an ILP solver returns the true OPT; neither approximation is needed.

The unifying lens is the **primal-dual schema**: greedy implicitly builds a feasible LP *dual* (the element prices) as it covers, and its guarantee is proved by comparing that dual to the primal LP. So greedy and LP rounding are two algorithmic surfaces over the same LP-duality foundation, which is exactly why both bottom out at the LP's `Θ(log n)` integrality gap.

---

## Performance Analysis

| Variant | Selection rule | Time | Notes |
|---------|---------------|------|-------|
| Unweighted greedy (naive scan) | max uncovered count | `O(rounds · Σ\|Sᵢ\|)` ≈ `O(m·n)` worst case | Recomputes every set's gain each round. |
| Weighted greedy (naive scan) | min cost/gain | same | One division per set per round. |
| Lazy greedy (priority queue) | submodular lazy eval | `O(Σ\|Sᵢ\| · log m)` typical | Re-evaluate only the top candidate; see `senior.md`. |
| Bitset greedy (small `n`) | `popcount(set & ~covered)` | `O(rounds · m · n/64)` | Word-parallel gain; great when `n ≤ few thousand`. |
| LP relaxation + rounding | solve LP, round | LP solve (poly, but heavy) + `O(m·n)` round | Used for low-frequency instances (vertex cover). |

**Key takeaways:**

- Building "covered" tracking and counting gains is the whole cost; there is no hidden `O(V³)`-style kernel.
- The naive version recomputes *all* gains every round — wasteful when most gains do not change. The **lazy greedy** (priority queue exploiting submodularity) avoids this and is the scalable default (`senior.md`).
- For small universes, **bitsets** make a single gain a `popcount` — often 10–50× faster than element-by-element loops.
- Weighting adds only a division per candidate; it does not change the asymptotics.

---

## The Tight Example — Why `ln n` Is Real, Not a Proof Artifact

A middle engineer should be able to *construct* an instance where greedy is `Θ(log n)` worse than optimal, to internalize that the bound is intrinsic.

**Construction.** Let `U = {1, …, n}` with `n = 2^k`. Provide two optimal sets `A` (the even-indexed half) and `B` (the odd-indexed half) — together `{A, B}` covers `U`, so `OPT = 2`. Now add "lure" sets `T₁, T₂, …` where `Tⱼ` covers a block of size strictly larger than what `A` or `B` would *newly* add at round `j`. Engineered carefully (Johnson 1974), greedy picks `T₁, T₂, …, T_k` — about `log₂ n` sets — before finishing, because each lure has the highest current gain at its round. Result:

```
greedy ≈ log₂ n sets,   OPT = 2,   ratio ≈ (log₂ n)/2 = Θ(log n).
```

**Why it matters.** This is not a loose-analysis artifact: greedy genuinely makes `log n` myopic choices. The lesson generalizes — *any* purely greedy/local method on set cover can be fooled into the `ln n` regime, and Feige's theorem (`professional.md`) says *no* polynomial method escapes it. So when you see `ln n`, treat it as the true price of the problem, not a weakness of greedy.

**Practical reassurance.** Real instances almost never look like the lure construction; they are not adversarially engineered. Greedy on real data is typically within a small constant of OPT. The tight example is a *worst case* that bounds the damage, not a prediction of typical behavior.

---

## A Note on Ties and Tie-Breaking

Because multiple sets can share the maximum gain (or minimum cost-effectiveness), the **tie-break rule** is part of the algorithm's definition, not an afterthought:

- **Determinism.** Fix a rule — smallest index, or among equal ratios the one with the largest absolute gain — so the same input always yields the same cover. This matters for caching, reproducible CI test selection, and debuggable behavior.
- **Quality.** Different tie-breaks can produce different-sized covers. None violates the `H(n)` guarantee, but a good secondary criterion (prefer larger sets, or sets covering rarer elements) often yields covers closer to OPT in practice.
- **The "rare element" heuristic.** A useful refinement: among tied sets, prefer the one covering an element of *low frequency* (few sets contain it). Such elements are "hard to cover" and forcing them in early avoids being cornered into an expensive set later. This does not change the worst-case bound but improves typical results.

These are judgment calls layered on top of the provable core; the guarantee holds regardless, but the *realized* quality depends on them.

---

## Edge Cases & Pitfalls

- **Infeasible instance** → some element is in no set; greedy stalls (every remaining gain is 0). Detect and report "no cover exists."
- **Zero-cost sets (weighted)** → a set with `cost = 0` and positive gain has ratio `0` and is always picked first; usually correct, but guard against `0/0` when its gain is also 0.
- **Cost-per-element with ties** → multiple sets share the minimal ratio; deterministic tie-break (smallest index, or largest gain) keeps results reproducible.
- **Floating-point ratio comparisons** → comparing `cost/gain` with `<` can mis-order near-equal ratios; compare cross-multiplied integers `cᵢ·gainⱼ` vs `cⱼ·gainᵢ` when exactness matters.
- **Frequency `f` confusion (LP)** → `f` is the max number of sets an *element* lives in, not the set size. Getting it wrong breaks the `f`-approximation rounding.
- **Max-coverage vs set-cover mixup** → max-coverage maximizes elements under a budget of `k` sets (`1−1/e` guarantee); set cover minimizes sets to cover all (`H(n)`). Different objectives.
- **Reusing original sizes** → still the #1 bug; always count *uncovered* elements.

---

## Best Practices

- Default to **weighted greedy with cost-effectiveness** even for unit costs — it is the general form and degenerates correctly.
- Keep a **brute-force exact** solver and known checks (single-set-covers-all → 1; `n` singletons → `n`) as regression tests.
- Compare ratios by **cross-multiplication** (`cᵢ·gⱼ` vs `cⱼ·gᵢ`) to avoid floating-point mis-ordering when costs/gains are integers.
- For low-frequency instances (each element in few sets), consider **LP frequency rounding** — an `f`-approximation can beat `ln n`.
- Compute and log the **LP lower bound** (or the dual from primal-dual) when you need a *certificate* of near-optimality, not just a solution.
- Decide **maximize-coverage vs minimize-sets** explicitly; they share code but optimize different objectives with different guarantees.
- Recognize **submodularity** — coverage has diminishing returns, which is exactly why greedy works and why lazy evaluation is correct.

---

## Cheat Sheet

```
Unweighted greedy   : pick set with MAX uncovered count        → H(n)-approx
Weighted greedy     : pick set with MIN cost / uncovered count → H(n)-approx
H(n) = 1 + 1/2 + ... + 1/n ≈ ln(n) + 1   (also H(d), d = largest set size)
ILP                 : min Σ cᵢxᵢ s.t. Σ_{e∈Sᵢ} xᵢ ≥ 1, xᵢ∈{0,1}
LP relaxation       : xᵢ ∈ [0,1]  → OPT_LP ≤ OPT  (lower bound, poly-time)
Frequency rounding  : round xᵢ ≥ 1/f to 1 → f-approx (vertex cover: f=2 → 2-approx)
Randomized rounding : include i w.p. xᵢ, repeat O(log n) → O(log n)-approx
Integrality gap     : Θ(log n)  → why nothing beats ln n in general
Max k-coverage      : maximize coverage with k sets → greedy gives 1 − 1/e ≈ 0.632
```

| Question | Tool |
|----------|------|
| Cover all, fewest sets | unweighted greedy, `H(n)` |
| Cover all, cheapest cost | weighted greedy (cost-effectiveness) |
| Each element in ≤ f sets | LP frequency rounding, `f`-approx |
| Want a certified lower bound | LP relaxation / primal-dual dual |
| Max elements with k sets | greedy max-coverage, `1−1/e` |
| Vertex cover (f = 2) | LP/matching, `2`-approx |

---

## Summary

The middle level turns the greedy recipe into understanding. An **approximation ratio** `H(n) = ln(n)+1` is a *worst-case* promise: greedy never exceeds `ln(n)+1` times OPT, and that bound is essentially tight. The ratio falls out of a **charging argument** — each covered element pays `1/gain`, and these prices telescope into a harmonic sum. **Weighted set cover** generalizes the rule to "minimum cost per newly covered element," keeping the same `H(n)` guarantee. A different route, **LP relaxation**, solves the fractional problem in polynomial time for a lower bound `OPT_LP ≤ OPT`, then rounds — giving an `f`-approximation when frequencies are low (the source of vertex cover's `2`) or an `O(log n)`-approximation via randomized rounding. Greedy and LP rounding both land at `Θ(log n)` because the LP **integrality gap** is `Θ(log n)`. And the whole family — vertex cover, dominating set, max coverage — is unified by **submodularity**: coverage has diminishing returns, which is precisely why the greedy choice is provably good. The selection rule and the arithmetic are the knobs; the `O(m·n)` scan is the engine.

---

## Worked Numerical Feel for `H(n)` vs `ln(n)`

It is worth seeing how tight `H(n) ≈ ln(n) + 1` (and the even-tighter `H(n) ≈ ln n + 0.577`) really is:

| `n` | `ln(n)` | `H(n)` (exact) | `ln(n) + 1` |
|-----|---------|----------------|-------------|
| 10 | 2.30 | 2.93 | 3.30 |
| 100 | 4.61 | 5.19 | 5.61 |
| 1,000 | 6.91 | 7.49 | 7.91 |
| 10,000 | 9.21 | 9.79 | 10.21 |
| 1,000,000 | 13.82 | 14.39 | 14.82 |

Two takeaways: (1) `H(n)` is sandwiched between `ln n` and `ln n + 1`, hugging `ln n + 0.577`; (2) the guarantee grows *logarithmically*, so even astronomically large universes have a small multiplicative bound. A billion elements gives `H(n) ≈ 21.3` — a 21× worst-case factor for a problem with a billion items is remarkably mild, and real instances are usually a small constant. This slow growth is why greedy set cover is *practically* excellent despite being only `Θ(log n)`-approximate in theory.

The `H(d)` refinement (with `d` the largest set size) is often much tighter: if every set has at most `d = 20` elements, the bound is `H(20) ≈ 3.6` regardless of how large `n` is. So when sets are small, greedy is within a small constant of optimal, *provably* — a fact worth checking before assuming the worst-case `ln n`.

---

## Further Reading

- Vazirani, *Approximation Algorithms*, Ch. 2 & 13 — greedy and LP-based set cover, primal-dual.
- Williamson & Shmoys, *The Design of Approximation Algorithms*, Ch. 1, 7 — LP rounding, primal-dual schema.
- Nemhauser, Wolsey & Fisher (1978) — submodular maximization and the `1 − 1/e` guarantee.
- CLRS §35.3 — greedy set cover; §35.1 — vertex cover 2-approximation.
- Sibling topics: vertex cover, max coverage, and the LP-rounding family in `14-greedy-algorithms`.
- Krause & Golovin, "Submodular Function Maximization" — survey tying coverage to submodularity.
- Chvátal (1979), "A greedy heuristic for the set-covering problem" — the weighted `H(n)` analysis.
- Johnson (1974), "Approximation algorithms for combinatorial problems" — the original greedy bound and tight instances.

---

## Self-Check Questions

Before moving to the senior level, make sure you can answer these:

1. **Why is `H(n)` a *worst-case* and not an *average* guarantee?** (Because it holds for every input including adversarial ones; typical inputs are far better.)
2. **What changes between unweighted and weighted greedy?** (The selection rule: max gain becomes min `cost/gain`; the `H(n)` guarantee is unchanged.)
3. **Why does the LP give a *lower* bound on OPT?** (Relaxing `xᵢ ∈ {0,1}` to `[0,1]` enlarges the feasible region, so the minimum can only drop: `OPT_LP ≤ OPT`.)
4. **When does LP frequency rounding beat greedy?** (When the max frequency `f` is a small constant — e.g. `f = 2` for vertex cover gives a 2-approximation, better than `ln n`.)
5. **Why do greedy and LP rounding both land at `Θ(log n)`?** (Because the LP's integrality gap is `Θ(log n)` — a fundamental barrier neither can cross with this LP.)
6. **What is the `1 − 1/e` factor and where does it come from?** (Max-coverage's greedy guarantee, arising from the diminishing returns / submodularity of the coverage function.)

If any answer is unclear, re-read the corresponding section above — these are exactly the distinctions an interviewer or a system-design review will probe.

A final framing to carry forward: greedy, weighted greedy, LP rounding, and max-coverage are not four separate algorithms but **one submodular idea seen through four lenses** — pick the locally best marginal gain, and let diminishing returns guarantee the result is globally near-optimal.
</content>
