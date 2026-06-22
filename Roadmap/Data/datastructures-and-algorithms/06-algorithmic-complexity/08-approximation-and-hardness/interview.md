# Approximation and Hardness — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Applied: Proving Approximation Ratios](#applied-proving-approximation-ratios)
3. [Gotcha / Trick Questions](#gotcha--trick-questions)
4. [Rapid-Fire Q&A](#rapid-fire-qa)
5. [Common Mistakes](#common-mistakes)
6. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: Define an α-approximation algorithm. Mind the min/max direction. *(Medium — the #1 slip)*

**Answer**: An **α-approximation algorithm** runs in polynomial time and returns a solution provably within a factor `α` of the optimum `OPT`, on *every* input. The inequality direction flips with the objective:

- **Minimization** (e.g., Vertex Cover, Set Cover, TSP): `ALG ≤ α · OPT`, with `α ≥ 1`. Smaller `α` is better; `α = 1` is exact.
- **Maximization** (e.g., MAX-CUT, MAX-3SAT): `ALG ≥ α · OPT`, with `α ≤ 1`. Larger `α` is better; `α = 1` is exact.

The classic slip is writing `ALG ≤ α · OPT` for a maximization problem — that bound is trivially true and meaningless. Always ask "which side am I bounding?" The guarantee is **worst-case**: it holds for *all* inputs, not on average. (Some authors normalize maximization ratios to `≥ 1` too — state your convention.)

### Q2: What are PTAS and FPTAS, and how do they differ? *(Medium)*

**Answer**: Both are families of algorithms parameterized by an accuracy `ε > 0`, producing a `(1 + ε)`-approximation (min) or `(1 − ε)`-approximation (max).

- **PTAS** (Polynomial-Time Approximation Scheme): for *each fixed* `ε`, runs in time polynomial in `n`. The catch — `ε` may appear in the **exponent**, e.g. `O(n^{1/ε})`. So accuracy gets arbitrarily good but the cost explodes as `ε → 0`.
- **FPTAS** (Fully Polynomial-Time Approximation Scheme): runs in time polynomial in **both** `n` *and* `1/ε`, e.g. `O(n³/ε)`. This is the strongest practical guarantee short of exact poly time.

**Difference in one line**: PTAS allows `1/ε` in the exponent; FPTAS forbids it (it must appear polynomially). Knapsack has an FPTAS; many geometric problems have only a PTAS.

### Q3: Order the approximation classes FPTAS, PTAS, APX. *(Medium)*

**Answer**: For minimization problems with bounded objective,

```
FPTAS ⊆ PTAS ⊆ APX
```

- **FPTAS**: approximable to any `1 + ε` with cost poly in `n` and `1/ε`.
- **PTAS**: approximable to any `1 + ε`, cost poly in `n` per fixed `ε`.
- **APX**: approximable to *some* constant factor `α > 1`, but not necessarily to every `1 + ε`.

The inclusions are **strict** unless `P = NP`. Vertex Cover ∈ APX (2-approx) but ∉ PTAS (it's APX-hard). Knapsack ∈ FPTAS. Set Cover ∉ APX (its best ratio is `ln n`, which grows with `n`). See [./middle.md](./middle.md) for the full hierarchy.

### Q4: What does "APX-hard" / "no PTAS unless P=NP" mean? *(Hard)*

**Answer**: A problem is **APX-hard** if every APX problem reduces to it via an approximation-preserving reduction (a **PTAS reduction** / L-reduction). The key consequence: **an APX-hard problem has no PTAS unless `P = NP`.** Intuitively, there is a *constant* threshold below which approximation becomes NP-hard — you can get within some fixed `α`, but driving the ratio to `1 + ε` for arbitrarily small `ε` is as hard as solving the problem exactly.

So "Vertex Cover is APX-hard" means: a 2-approximation exists, but no scheme can do `1.0001`-approximation in poly time (unless `P = NP`). APX-hardness is the approximation analogue of NP-hardness — it pins a *hardness of approximation* floor. See [../07-reductions-and-np-completeness/interview.md](../07-reductions-and-np-completeness/interview.md) for the reduction machinery it builds on.

### Q5: How do you prove a LOWER bound on approximability? Sketch the gap-reduction idea. *(Hard)*

**Answer**: You prove **inapproximability** with a **gap-producing (gap) reduction**. The idea: reduce an NP-hard decision problem to your optimization problem so that

- "yes" instances map to instances with `OPT ≥ c`, and
- "no" instances map to instances with `OPT ≤ s`, with `s < c`.

If a poly-time `α`-approximation with `α < c/s` existed, it could *distinguish* the two cases — its output would fall in different ranges — thereby deciding the original NP-hard problem in poly time. Contradiction (unless `P = NP`). The ratio `c/s` is the **gap**, and it becomes the inapproximability factor.

The deep engine that *manufactures* such gaps from scratch is the **PCP theorem** (next question). Without PCP, most constant-factor lower bounds are simply unknown.

### Q6: State the PCP theorem and why it matters for approximation. *(Hard)*

**Answer**: The **PCP theorem** (Arora–Safra, Arora–Lund–Motwani–Sudan–Szegedy, 1992) states:

> `NP = PCP(O(log n), O(1))` — every NP problem has a proof that a verifier can check by reading only a **constant** number of randomly chosen bits, using `O(log n)` random bits, accepting correct proofs always and incorrect proofs with probability `< 1/2`.

**Why it matters**: PCP is equivalent to the existence of a **constant gap** for MAX-3SAT — it is NP-hard to distinguish formulas where all clauses are satisfiable from those where only a `(1 − δ)` fraction is. This single gap, propagated through approximation-preserving reductions, yields hardness-of-approximation results across the board (Set Cover `ln n`, MAX-3SAT `7/8`, etc.). PCP is to inapproximability what Cook–Levin is to NP-completeness: the **root** that bootstraps every gap. See [./senior.md](./senior.md).

---

## Applied: Proving Approximation Ratios

### Q7: Prove the Vertex Cover 2-approximation. *(Medium — classic whiteboard)*

**Answer**: **Algorithm**: find any **maximal matching** `M` (greedily pick edges with no shared endpoint until none remain); output **all endpoints** of `M`.

**It's a valid cover**: if some edge `e` were uncovered, neither endpoint is in `M`'s endpoints, so `e` shares no vertex with any matched edge — we could add `e` to `M`, contradicting maximality. So every edge is covered.

**The ratio is 2**: the `|M|` matching edges are vertex-disjoint, and *any* vertex cover must include **at least one endpoint of each** — so `OPT ≥ |M|`. Our cover uses exactly `2|M|` vertices. Therefore

```
ALG = 2|M| ≤ 2 · OPT.
```

It's a clean 2-approximation, `O(E)` time. Note the proof never computes `OPT` — it *lower-bounds* it via the matching. That lower-bounding move is the heart of nearly every approximation proof.

### Q8: Why is greedy Set Cover an `H_n ≈ ln n`-approximation? *(Hard)*

**Answer**: **Greedy**: repeatedly pick the set covering the most still-uncovered elements, until all `n` are covered.

**Charging argument**: when an element is first covered by a chosen set covering `k` new elements, charge it cost `1/k`. The total cost equals the number of sets chosen. Consider the elements in the order greedy covers them. At the step where `r` elements remain uncovered, the optimal solution covers all `r` with `OPT` sets, so *some* available set covers `≥ r/OPT` of them — greedy picks one at least that good, charging each newly covered element `≤ OPT/r`. Summing over all `n` elements in reverse coverage order gives

```
ALG ≤ OPT · (1 + 1/2 + ⋯ + 1/n) = OPT · H_n ≤ OPT · (ln n + 1).
```

So greedy is an `H_n`-approximation. Remarkably, this is **essentially optimal**: it is NP-hard to approximate Set Cover within `(1 − o(1)) ln n` (Dinur–Steurer 2014, via PCP), so the simple greedy is the best you can hope for asymptotically.

### Q9: Give the metric-TSP MST-doubling 2-approximation. *(Medium)*

**Answer**: Assume the **metric** TSP (edge weights satisfy the triangle inequality). **Algorithm**:

1. Build a minimum spanning tree `T` of the complete graph.
2. **Double** every edge of `T` to get an Eulerian multigraph; take an Euler tour.
3. **Shortcut** repeated vertices (skip already-visited ones) to get a Hamiltonian tour. Shortcutting only *shrinks* length by the triangle inequality.

**Ratio**: any tour minus one edge is a spanning tree, so `MST ≤ OPT`. Doubling gives `2·MST`, and shortcutting can't increase it:

```
ALG ≤ 2 · MST ≤ 2 · OPT.
```

A 2-approximation. **Christofides** improves this to **3/2** by adding a minimum-weight perfect matching on the odd-degree vertices of `T` (instead of doubling all edges), producing a cheaper Eulerian graph. Both require the triangle inequality — see [Q13](#q13-can-we-2-approximate-general-non-metric-tsp-medium).

### Q10: Sketch the Knapsack FPTAS. *(Hard)*

**Answer**: 0/1 Knapsack has an exact DP that is `O(n · V)` where `V` is the total **value** — pseudo-polynomial, since `V` can be exponential in the input bit-length. The FPTAS trades a little accuracy for genuine poly time by **scaling down the values**:

1. Let `v_max` be the largest item value. Choose scaling factor `K = ε · v_max / n`.
2. Round each value down: `v'_i = ⌊v_i / K⌋`.
3. Run the exact value-based DP on the small `v'_i`. The DP now runs in `O(n² / ε)` because the scaled total value is `O(n / ε)`.

**Why it's `(1 − ε)`**: each item loses at most `K` in value to rounding; the optimal solution has `≤ n` items, so the chosen set loses at most `n·K = ε·v_max ≤ ε·OPT`. Hence `ALG ≥ (1 − ε)·OPT`, in time poly in `n` and `1/ε` — an **FPTAS**. (Knapsack is only *weakly* NP-hard, which is exactly why an FPTAS is possible; strongly NP-hard problems admit no FPTAS unless `P = NP`.)

---

## Gotcha / Trick Questions

### Q11: "Is a 2-approximation always within 2× in practice?" *(Medium)*

**Answer**: The factor 2 is a **worst-case guarantee**, not the typical result. On most real inputs a "2-approximation" lands far closer to `OPT` — often within a few percent — because the worst case requires an adversarial structure that rarely occurs. The bound is a *promise* ("never worse than 2×"), not a *prediction* ("about 2× on average"). Conversely, the bound is **tight**: there *exist* instances forcing the algorithm to nearly `2·OPT` (e.g., Vertex Cover on a perfect matching of disjoint edges, where greedy-matching takes all `2|M|` vertices but `OPT = |M|`). Worst-case ratio and empirical performance are different axes — say so.

### Q12: "Does an approximation algorithm ever return the exact optimum?" *(Easy)*

**Answer**: **Yes — frequently — but with no guarantee.** Nothing stops a 2-approximation from outputting `OPT` on a given input; the ratio only *caps* how bad it can get. What it cannot do is *certify* optimality: you usually can't tell, in poly time, whether a returned solution happens to be optimal (that would often be NP-hard itself). So "approximation" bounds the error ceiling; it never forbids being exactly right. The two notions — *being* optimal vs *knowing* you are — are distinct.

### Q13: Can we 2-approximate general (non-metric) TSP? *(Medium)*

**Answer**: **No — general TSP has no constant-factor approximation unless `P = NP`.** A poly-time `α`-approximation for arbitrary edge weights could be used to decide Hamiltonian Cycle: build a graph with weight 1 on existing edges and a huge weight `M ≫ α·n` on non-edges; a Hamiltonian cycle gives a tour of cost `n`, while any non-Hamiltonian tour costs `≥ M`. An `α`-approximation would separate the cases, deciding an NP-complete problem. The triangle inequality is precisely what rescues approximability — that's why MST-doubling and Christofides require the **metric** assumption.

### Q14: "Why can't every NP-hard problem be approximated well?" *(Hard)*

**Answer**: Because approximating some problems is *itself* NP-hard — proven via **PCP / gap reductions**. PCP creates a constant gap (e.g., distinguishing fully-satisfiable MAX-3SAT from `7/8`-satisfiable is NP-hard), and approximation-preserving reductions spread that gap to other problems. The result is a **spectrum of approximability**:

- **FPTAS** (Knapsack) — approximable arbitrarily well.
- **APX** (Vertex Cover, metric TSP) — constant factor, no PTAS.
- **Logarithmic** (Set Cover) — best ratio grows as `ln n`.
- **No constant factor / essentially inapproximable** (general TSP, MAX-Clique within `n^{1−ε}`).

"NP-hard to solve" and "NP-hard to approximate" are separate facts; PCP is what lets us prove the latter.

### Q15: MAX-CUT's `0.878` — where does it come from and why might it be optimal? *(Hard)*

**Answer**: The **Goemans–Williamson** algorithm solves a semidefinite-programming (SDP) relaxation of MAX-CUT, then **rounds** by picking a random hyperplane through the origin to split the unit vectors into two sides. Analyzing the expected number of cut edges yields the constant

```
α_GW = min_{0 ≤ θ ≤ π}  (2/π) · θ / (1 − cos θ) ≈ 0.87856,
```

so `E[ALG] ≥ 0.878 · OPT` — a 0.878-approximation (maximization, so `≥`). Why might it be **optimal**? Under the **Unique Games Conjecture (UGC)**, it is NP-hard to approximate MAX-CUT within any factor *better* than `α_GW` (Khot–Kindler–Mossel–O'Donnell). So if UGC holds, GW is the best possible poly-time algorithm — the SDP rounding exactly matches the hardness threshold. UGC similarly implies Vertex Cover is hard to approximate within `2 − ε`, matching the trivial 2-approximation.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | α-approx, minimization bound? | `ALG ≤ α · OPT`, `α ≥ 1` |
| 2 | α-approx, maximization bound? | `ALG ≥ α · OPT`, `α ≤ 1` |
| 3 | PTAS vs FPTAS difference? | FPTAS is poly in `1/ε` too; PTAS may have `1/ε` in the exponent |
| 4 | Class containments? | `FPTAS ⊆ PTAS ⊆ APX` (strict unless `P = NP`) |
| 5 | Vertex Cover ratio (matching)? | 2 (all endpoints of a maximal matching) |
| 6 | Why `OPT ≥ |M|` for VC? | Each matching edge needs a distinct cover vertex |
| 7 | Greedy Set Cover ratio? | `H_n ≈ ln n` |
| 8 | Metric TSP MST-doubling ratio? | 2 |
| 9 | Christofides ratio? | 3/2 |
| 10 | Knapsack approximation class? | FPTAS, `O(n²/ε)` via value scaling |
| 11 | MAX-3SAT inapproximability? | NP-hard beyond `7/8` (PCP) |
| 12 | Set Cover lower bound? | `(1 − o(1)) ln n`, NP-hard |
| 13 | MAX-CUT GW ratio? | `≈ 0.878` (SDP + hyperplane rounding) |
| 14 | UGC ⇒ Vertex Cover hardness? | No `2 − ε` approximation |
| 15 | What does PCP give us? | A constant gap ⇒ hardness of approximation |
| 16 | General (non-metric) TSP? | No constant-factor approx unless `P = NP` |
| 17 | APX-hard means? | No PTAS unless `P = NP` |

---

## Common Mistakes

1. **Flipping the min/max inequality.** Minimization bounds *above* (`ALG ≤ α·OPT`); maximization bounds *below* (`ALG ≥ α·OPT`). Writing `≤` for a max problem gives a vacuous bound.
2. **Treating the ratio as typical, not worst-case.** A 2-approximation guarantees `≤ 2·OPT` always; it usually does far better in practice. The bound is a ceiling, not an average.
3. **Confusing PTAS and FPTAS.** Only FPTAS is polynomial in `1/ε`. Knapsack has an FPTAS; many geometric problems have only a PTAS.
4. **Applying MST-doubling / Christofides to non-metric TSP.** Both *require* the triangle inequality; general TSP has no constant-factor approximation.
5. **Saying "approximation never finds the optimum."** It often does — it just can't *guarantee* or *certify* it.
6. **Forgetting to lower-bound `OPT`.** Every ratio proof hinges on a poly-computable bound on `OPT` (matching size, MST weight) — you never compute `OPT` directly.
7. **Assuming all NP-hard problems are equally (in)approximable.** They span FPTAS → APX → `ln n` → no-constant; PCP/UGC pin down each floor.

---

## Tips & Summary

- **Fix the direction first.** Before any approximation argument, write down whether it's min (`ALG ≤ α·OPT`) or max (`ALG ≥ α·OPT`). Half of all approximation slips are a flipped inequality.
- **Memorize the canonical ratios**: Vertex Cover **2** (maximal matching), Set Cover **`ln n`** (greedy), metric TSP **2** (MST-doubling) / **3/2** (Christofides), Knapsack **FPTAS**, MAX-CUT **0.878** (GW), MAX-3SAT **7/8**. These are the constants interviewers expect on sight.
- **Lead every ratio proof by lower-bounding `OPT`** with something you *can* compute — a matching, an MST, an LP/SDP relaxation. That single move is the skeleton of the proof.
- **Name the hardness engine**: PCP manufactures the constant gap; gap/PTAS reductions spread it; UGC sharpens specific thresholds (MAX-CUT 0.878, Vertex Cover `2 − ε`). Mentioning PCP and UGC signals depth.
- **Separate "worst-case ratio" from "empirical performance"** explicitly — and "being optimal" from "certifying optimality." Both distinctions catch out weaker candidates.
- **Tie approximability to NP-hardness type**: weakly NP-hard (Knapsack) → FPTAS possible; strongly NP-hard → no FPTAS. It connects this topic back to [../07-reductions-and-np-completeness/interview.md](../07-reductions-and-np-completeness/interview.md).

**Related:** [Reductions & NP-Completeness — Interview](../07-reductions-and-np-completeness/interview.md) · [Complexity Classes P and NP — Interview](../06-complexity-classes-p-np/interview.md) · [Approximation & Hardness — Middle](./middle.md) · [Approximation & Hardness — Senior](./senior.md)
