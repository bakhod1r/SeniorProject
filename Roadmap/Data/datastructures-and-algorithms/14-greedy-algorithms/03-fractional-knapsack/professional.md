# Fractional Knapsack — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Instance, Feasible Region, Objective
2. The Greedy Algorithm (statement)
3. Optimality Proof via the Exchange Argument
4. Optimality via Linear Programming Duality
5. Structure of the Optimum — The Single Fractional Variable
6. Why Greedy Fails for 0/1 Knapsack
7. Complexity — Sorting, Selection, and Strong Polynomiality
8. The LP Relaxation Bound for 0/1 Branch-and-Bound
9. Numerical Analysis and Exact Arithmetic
10. Comparison with Alternatives
11. Open Problems and Summary
12. Reference Code (Exact greedy / O(n) selection, Go / Java / Python)

This file is the rigorous backbone for the topic: it states the linear program precisely, proves greedy optimality two independent ways (exchange and duality), characterizes the optimum's vertex structure, pins down the complexity (strongly polynomial; linear-time value), and explains the divisibility hypothesis that separates this easy problem from NP-complete 0/1 Knapsack — while showing how the fractional optimum nonetheless powers exact 0/1 solvers as the LP-relaxation bound.

---

## 1. Formal Definitions — Instance, Feasible Region, Objective

We develop the problem from first principles as a linear program, then prove the greedy algorithm optimal two independent ways.

**Definition 1.1 (Instance).** A Fractional Knapsack instance is a triple `(v, w, W)` where `v = (v₁, …, vₙ) ∈ ℝ₊ⁿ` are item values, `w = (w₁, …, wₙ) ∈ ℝ₊₊ⁿ` are strictly positive item weights, and `W ∈ ℝ₊` is the capacity.

**Definition 1.2 (Solution / feasible region).** A solution is a vector `x = (x₁, …, xₙ) ∈ [0,1]ⁿ`. It is *feasible* iff `Σᵢ wᵢ xᵢ ≤ W`. The feasible region is the polytope

```
P = { x ∈ ℝⁿ : 0 ≤ xᵢ ≤ 1 ∀i,  Σᵢ wᵢ xᵢ ≤ W }.
```

**Definition 1.3 (Objective).** Maximize the linear functional `f(x) = Σᵢ vᵢ xᵢ`. The problem is the linear program

```
maximize    vᵀ x
subject to  wᵀ x ≤ W,
            0 ≤ x ≤ 𝟙.
```

**Definition 1.4 (Density).** The density (efficiency) of item `i` is `ρᵢ = vᵢ / wᵢ`, the value per unit of weight. WLOG relabel items so `ρ₁ ≥ ρ₂ ≥ … ≥ ρₙ`; ties may be broken arbitrarily without affecting the optimal value.

**Definition 1.5 (Critical index).** Let `k` be the smallest index with `Σ_{i≤k} wᵢ ≥ W` (assuming `Σᵢ wᵢ ≥ W`; otherwise all items fit). Item `k` is the **critical item**, and `ρ_k` is the **critical density**. When the prefix weight equals `W` exactly, `k` is taken whole and there is no fractional item; otherwise `k` is the unique fractional item.

Because `P` is a bounded polytope and `f` is linear, an optimum is attained at a vertex of `P` (fundamental theorem of linear programming). This already foreshadows the structure of Section 5.

**Lemma 1.8 (well-posedness).** With `wᵢ > 0` for all `i` and `W ≥ 0`, `P` is non-empty (contains `0`), compact (closed and bounded, since `0 ≤ xᵢ ≤ 1`), and `f` is continuous; hence a maximizer exists by the extreme-value theorem. If additionally `vᵢ ≥ 0`, the optimum value is non-negative and `≤ Σᵢ vᵢ`.

*Proof.* `0 ∈ P` trivially. Boundedness follows from `x ∈ [0,1]ⁿ`; closedness from `P` being an intersection of closed half-spaces. Continuity of the linear `f` over a compact set guarantees a maximizer. The value bounds follow from `0 ≤ xᵢ ≤ 1` and `vᵢ ≥ 0`. ∎

**Remark 1.9 (why strictly positive weights).** The assumption `wᵢ > 0` is not cosmetic. A zero-weight item with `vᵢ > 0` has unbounded density and is *always* taken fully (it consumes no capacity), so it should be removed and its value added unconditionally before the analysis; otherwise `ρᵢ = vᵢ/wᵢ` is undefined. A zero-weight, zero-value item is inert. Handling these as a preprocessing step keeps every later statement (density order, critical item, duality) well-defined.

---

### 1.10 Notation summary

For reference throughout the file:

| Symbol | Meaning |
|--------|---------|
| `n` | number of items |
| `vᵢ, wᵢ` | value and (positive) weight of item `i` |
| `W` | knapsack capacity |
| `ρᵢ = vᵢ/wᵢ` | density of item `i` |
| `k` | critical index (first prefix weight `≥ W`) |
| `ρ_k` | critical density (`= λ`, the capacity dual price) |
| `x = (x₁,…,xₙ)` | solution; `xᵢ ∈ [0,1]` is the fraction of item `i` taken |
| `P` | feasible polytope `{x ∈ [0,1]ⁿ : wᵀx ≤ W}` |
| `f(x) = vᵀx` | objective (total value) |
| `λ, μ` | dual variables (capacity, upper bounds) |
| `τ` | — (unused; reserved) |

Items are assumed relabeled into non-increasing density order `ρ₁ ≥ ρ₂ ≥ … ≥ ρₙ` unless stated otherwise. The single standing assumption — strictly positive weights — is what makes every density well-defined and every breakpoint of the value function sharp.

---

## 2. The Greedy Algorithm (statement)

**Algorithm 2.1 (Density Greedy).**
1. Sort items so that `ρ₁ ≥ ρ₂ ≥ … ≥ ρₙ`.
2. Initialize `remaining ← W`, `x ← 0`.
3. For `i = 1, …, n`:
   - if `wᵢ ≤ remaining`: set `xᵢ ← 1`, `remaining ← remaining − wᵢ`;
   - else: set `xᵢ ← remaining / wᵢ`, `remaining ← 0`, and stop.
4. Return `x` and value `vᵀ x`.

Explicitly, the greedy solution is

```
xᵢ = 1                         for i < k        (taken whole)
x_k = (W − Σ_{i<k} wᵢ) / w_k   for i = k        (the single fraction)
xᵢ = 0                         for i > k        (rejected)
```

with value `Σ_{i<k} vᵢ + x_k v_k`.

---

## 3. Optimality Proof via the Exchange Argument

**Theorem 3.1.** The greedy solution `x*` of Algorithm 2.1 is optimal for the Fractional Knapsack LP.

We give two complementary proofs. This section proves it by an **exchange argument**; Section 4 proves it by **LP duality** (constructing matching primal/dual solutions). Both are standard and worth knowing.

*Proof (exchange).*
Assume `Σᵢ wᵢ ≥ W` (else all items fit, `x* = 𝟙` is trivially optimal). Let `y` be any optimal solution. We show `f(y) ≤ f(x*)`, hence `f(y) = f(x*)`.

**Step 1 — An optimum is tight.** If `Σᵢ wᵢ yᵢ < W`, some item `j` has `yⱼ < 1` (since not all weight is used and total supply exceeds `W`). Increasing `yⱼ` by a feasible `ε > 0` raises the objective by `ε vⱼ > 0` (values positive), contradicting optimality of `y`. Hence `wᵀ y = W`. Likewise `wᵀ x* = W` by construction.

**Step 2 — Bubble `y` toward `x*`.** Suppose `y ≠ x*`. Let `i` be the smallest index with `yᵢ ≠ x*ᵢ`. By the greedy form, `x*ᵢ ≥ yᵢ` cannot fail "downward" for `i < k`... we argue directly: there must exist indices `a < b` (so `ρ_a ≥ ρ_b`) with `y_a < 1` and `y_b > 0` such that greedy would prefer `a`. Concretely pick `a = min{ i : yᵢ < x*ᵢ }` and `b = max{ i : yᵢ > x*ᵢ }`. Greedy fills denser items first, so `a < b` and `ρ_a ≥ ρ_b`.

Define a transfer of weight `δ = min( (x*_a − y_a)·w_a, (y_b − x*_b)·w_b ) > 0`. Move `δ` units of weight from `b` to `a`:

```
y_a ← y_a + δ / w_a,    y_b ← y_b − δ / w_b.
```

Feasibility is preserved (total weight unchanged, both coordinates stay in `[0,1]` by the choice of `δ`). The value change is

```
Δf = δ·(v_a / w_a) − δ·(v_b / w_b) = δ·(ρ_a − ρ_b) ≥ 0.
```

So the objective does not decrease, and `y` now agrees with `x*` in at least one more coordinate (either `y_a = x*_a` or `y_b = x*_b`). After finitely many such transfers, `y = x*`, with the objective never having decreased. Therefore `f(x*) ≥ f(y)`. Since `y` was optimal, `f(x*) = f(y)`, and `x*` is optimal. ∎

**Remark 3.2 (the load-bearing hypothesis).** Step 2 transfers a *continuous* amount `δ` of weight. This requires `x_a, x_b` to vary continuously in `[0,1]` — i.e., **divisibility**. In 0/1 Knapsack the variables are restricted to `{0,1}`, the transfer is illegal, and the proof collapses (Section 6).

---

### 3.1 A fully worked exchange transfer

To make Theorem 3.1 concrete, trace one transfer numerically. Take `W = 50`, items `A=(60,10)`, `B=(100,20)`, `C=(120,30)` (densities `6, 5, 4`). Greedy's `x* = (1, 1, 2/3)` with value `240`. Suppose an adversary proposes the (still optimal-weight) solution `y = (1, 1/2, 1)`: it takes all of `A` (10), half of `B` (10), all of `C` (30) — total weight `50`, value `60 + 50 + 120 = 230`. This is feasible but *not* optimal; let us watch the exchange repair it.

The smallest index where `y` disagrees with `x*` is `B` (`y_B = 1/2 < x*_B = 1`); the largest where `y` exceeds `x*` is `C` (`y_C = 1 > x*_C = 2/3`). So `a = B`, `b = C`, with `ρ_B = 5 ≥ ρ_C = 4`. Transfer `δ = min((1 − 1/2)·20, (1 − 2/3)·30) = min(10, 10) = 10` units of weight from `C` to `B`:

```
y_B ← 1/2 + 10/20 = 1   (B now whole)
y_C ← 1   − 10/30 = 2/3 (C now two-thirds)
Δvalue = 10·(5 − 4) = +10  →  value 230 + 10 = 240.
```

After one transfer `y = (1, 1, 2/3) = x*`, value `240`, weight unchanged at `50`. The single swap closed the entire `10`-point gap, exactly as the theorem predicts (and `Δvalue = δ(ρ_a − ρ_b) ≥ 0`). This is the proof in miniature: every deviation from greedy is a recoverable transfer toward a denser item, and recovery never costs value.

---

## 4. Optimality via Linear Programming Duality

The LP

```
(P)  max vᵀx   s.t.  wᵀx ≤ W,  x ≤ 𝟙,  x ≥ 0
```

has dual

```
(D)  min  W·λ + 𝟙ᵀμ
     s.t. wᵢ·λ + μᵢ ≥ vᵢ   for all i,
          λ ≥ 0,  μ ≥ 0.
```

Here `λ` is the (scalar) dual on the capacity constraint and `μ` the duals on the upper bounds `xᵢ ≤ 1`.

**Theorem 4.1.** Set `λ = ρ_k` (the critical density) and `μᵢ = max(0, vᵢ − ρ_k wᵢ) = wᵢ·max(0, ρᵢ − ρ_k)`. Together with greedy's `x*`, this primal–dual pair satisfies complementary slackness, certifying optimality.

*Proof sketch.* **Dual feasibility:** `wᵢλ + μᵢ = wᵢρ_k + wᵢ max(0, ρᵢ − ρ_k) = wᵢ max(ρ_k, ρᵢ) ≥ wᵢρᵢ = vᵢ`. And `λ, μ ≥ 0`. **Complementary slackness:**
- For `i` with `ρᵢ > ρ_k` (taken whole, `x*ᵢ = 1`): `μᵢ = vᵢ − ρ_k wᵢ > 0` pairs with the tight bound `x*ᵢ = 1`; and the dual constraint is tight (`wᵢλ + μᵢ = vᵢ`), consistent with `x*ᵢ > 0`.
- For `i` with `ρᵢ < ρ_k` (rejected, `x*ᵢ = 0`): `μᵢ = 0`, and the dual constraint is slack (`wᵢρ_k > vᵢ`), consistent with `x*ᵢ = 0`.
- For the critical item `k` (`0 ≤ x*_k ≤ 1`): `μ_k = 0` and the dual constraint is tight (`w_kρ_k = v_k`), so any `x*_k ∈ [0,1]` is allowed; capacity is tight so `λ = ρ_k > 0` pairs with `wᵀx* = W`.

All complementary-slackness conditions hold, so by strong LP duality `x*` is primal-optimal. ∎

**Corollary 4.2 (shadow price).** `λ = ρ_k` is the marginal value of one extra unit of capacity: `∂(optimal value)/∂W = ρ_k` (where differentiable). This is the senior-level "clearing price" interpretation.

### 4.1 A fully worked duality certificate

Return to `W = 50`, `A=(60,10)`, `B=(100,20)`, `C=(120,30)`, densities `6, 5, 4`. The critical item is `C` (prefix weights `10, 30, 60`; the first `≥ 50` is at `C`), so `ρ_k = 4` and `λ = 4`.

Compute `μᵢ = wᵢ·max(0, ρᵢ − ρ_k)`:

```
μ_A = 10·max(0, 6 − 4) = 20
μ_B = 20·max(0, 5 − 4) = 20
μ_C = 30·max(0, 4 − 4) = 0
```

**Dual objective:** `W·λ + Σ μᵢ = 50·4 + (20 + 20 + 0) = 200 + 40 = 240`.

**Primal objective:** greedy value `= 240` (from §3.1).

Primal `=` dual `= 240` confirms optimality by strong duality, *with an explicit certificate* `(λ, μ)` anyone can check in `O(n)` without re-running the algorithm. **Dual feasibility check:** `w_A λ + μ_A = 40 + 20 = 60 = v_A` ✓ (tight, `x_A = 1`); `w_B λ + μ_B = 80 + 20 = 100 = v_B` ✓ (tight, `x_B = 1`); `w_C λ + μ_C = 120 + 0 = 120 = v_C` ✓ (tight, `x_C ∈ (0,1)`). All constraints are satisfied and complementary slackness holds. This is the gold standard for *verifying* a claimed optimum: produce the dual certificate and check primal = dual.

---

## 5. Structure of the Optimum — The Single Fractional Variable

**Proposition 5.1.** There is an optimal solution with **at most one** fractional coordinate `xᵢ ∈ (0,1)`; all others are `0` or `1`.

*Proof.* `P` has `n+1` constraints beyond sign restrictions (`n` upper bounds plus 1 capacity). At a vertex of `P`, at least `n` linearly independent constraints are tight. The `n` bound constraints `xᵢ ∈ {0,1}` can be tight for at most `n` coordinates; if the capacity constraint is also tight, at most one coordinate can avoid having a tight bound — that is the single fractional variable. Since an optimum is attained at a vertex (Definition 1.4 remark), the claim follows. The greedy `x*` *is* this vertex: only `x_k` is (generically) fractional. ∎

**Remark 5.2.** Generic instances have exactly one fractional item; degenerate ones (where the prefix weight hits `W` exactly) have *zero* fractional items. Never two — a frequently tested fact.

**Corollary 5.3 (uniqueness of value, non-uniqueness of plan).** The optimal *value* is unique (it is the maximum of a concave function over a convex set). The optimal *plan* need not be: if several items share the critical density `ρ_k`, the residual capacity can be distributed among them in infinitely many ways, all achieving the same value. Thus reporting "the" plan requires a tie-breaking convention, while reporting "the" value is unambiguous — a distinction that matters for reproducibility (an implementation detail elevated to a correctness concern in `senior.md`).

**Proposition 5.4 (sensitivity / parametric optimum).** As `W` increases through a breakpoint `W_j = Σ_{i≤j} wᵢ`, the critical item changes from `j` to `j+1`, the fractional coordinate jumps from `x_j` reaching `1` to `x_{j+1}` starting at `0`, and the dual price drops from `ρ_j` to `ρ_{j+1}`. Between breakpoints the optimal *basis* (which items are whole / fractional / rejected) is constant. This piecewise structure is what makes the parametric problem (value as a function of `W`) solvable by a single sort plus binary search per query.

---

## 6. Why Greedy Fails for 0/1 Knapsack

**0/1 Knapsack** restricts `x ∈ {0,1}ⁿ`:

```
max vᵀx   s.t.  wᵀx ≤ W,   x ∈ {0,1}ⁿ.
```

**Proposition 6.1.** Density greedy is not optimal for 0/1 Knapsack; its approximation ratio is unbounded.

*Proof by counterexample.* `W = 50`; items `A=(60,10)`, `B=(100,20)`, `C=(120,30)`, densities `6.0, 5.0, 4.0`. Greedy takes `A, B` (weight 30, value 160); `C` (weight 30) does not fit and cannot be split, so greedy halts at 160. The optimum is `{B, C}` (weight 50, value 220). Greedy/optimum `= 160/220 ≈ 0.73`. Scaling a "decoy" small dense item against one large valuable item drives the ratio toward 0; e.g., `W = M`, items `(2, 1)` and `(M, M)` — greedy takes the density-2 item then cannot fit the big one, achieving `2` vs optimum `M`, ratio `2/M → 0`. ∎

**Why the proofs of Section 3–4 break:**
- *Exchange (3.1):* the transfer of `δ` weight requires continuous `xᵢ`; with `xᵢ ∈ {0,1}` it is infeasible.
- *Duality (4.1):* the LP relaxation's optimum (the fractional value) is generally **strictly greater** than the integer optimum; there is an *integrality gap*. The dual certificate certifies the LP value, not the integer value.

**Complexity contrast.** 0/1-Knapsack's decision version is **NP-complete** (Karp, 1972). Its standard DP runs in `O(nW)` — pseudo-polynomial (exponential in the *bit-length* of `W`). Fractional Knapsack is **strongly polynomial** (Section 7). The relaxation does not merely simplify the algorithm; it lowers the complexity class.

**Theorem 6.4 (no constant-factor greedy for 0/1).** For any fixed item-ordering heuristic (by density, value, weight, or any function of a single item), there is a 0/1 instance on which greedy-by-that-order achieves an arbitrarily small fraction of the optimum.

*Proof sketch.* Such heuristics commit to or skip items based only on per-item statistics, ignoring the *combinatorial fit* among items. The decoy construction of Prop 6.1 (`(2,1)` against `(M,M)`) defeats density and value orderings; symmetric constructions defeat weight orderings. Since the optimal selection depends on the global subset-sum structure (which is what makes the problem NP-complete), no single-item ranking can capture it. ∎

This theorem is the formal statement of "there is no clever sort that fixes 0/1 greedy" — the temptation `middle.md` warns against, here proved impossible.

---

### 6.1 The integrality gap, quantified

**Definition 6.2 (integrality gap).** For a 0/1-Knapsack instance `I`, the gap is `g(I) = OPT_frac(I) / OPT₀₁(I) ≥ 1`.

**Proposition 6.3.** The integrality gap of the LP relaxation is at most `2` in a useful sense: a simple rounding of the fractional optimum yields a 0/1 solution of value at least `OPT_frac / 2`, hence at least `OPT₀₁ / 2`.

*Proof.* The fractional optimum takes whole items `1..k−1` (value `V = Σ_{i<k} vᵢ`) plus a fraction of the critical item `k` (value `≤ v_k`). So `OPT_frac ≤ V + v_k`. Consider two candidate 0/1 solutions: (a) the prefix `{1, …, k−1}` with value `V`, and (b) the single item `{k}` with value `v_k` (feasible since `w_k ≤ W` for the critical item). The better of the two has value `max(V, v_k) ≥ (V + v_k)/2 ≥ OPT_frac/2 ≥ OPT₀₁/2`. ∎

This `½`-approximation is the seed of the **FPTAS** for 0/1 Knapsack: scaling values by `⌊vᵢ · n/(ε·v_max)⌋` and running the DP on scaled values yields a `(1−ε)`-approximation in `O(n³/ε)` time, with the fractional/greedy structure providing the bound that controls the rounding error.

### 6.2 Where exactly the exchange transfer becomes illegal

It is worth pinpointing the failure precisely. In Theorem 3.1's transfer, we set `y_a ← y_a + δ/w_a` and `y_b ← y_b − δ/w_b` for some `δ ∈ (0, …]`. Feasibility of the *new* point requires `y_a + δ/w_a ≤ 1` and `y_b − δ/w_b ≥ 0` — both satisfiable for small `δ` in `[0,1]ⁿ`. In `{0,1}ⁿ`, the only feasible moves are `y_a: 0→1` and `y_b: 1→0`, i.e., `δ = w_a` *and simultaneously* `δ = w_b` — possible only in the degenerate case `w_a = w_b`. For generic weights no legal transfer exists, the local-improvement argument has no move to make, and the greedy point is *not* reachable from an arbitrary integer point by value-non-decreasing swaps. This is the exact algebraic reason divisibility is indispensable.

---

## 7. Complexity — Sorting, Selection, and Strong Polynomiality

**Sorting-based.** Sorting by density is `Θ(n log n)` comparisons; the fill is `Θ(n)`. Total `Θ(n log n)` time, `Θ(1)` extra space (or `Θ(n)` for the plan).

**Lower bound.** If we demand the full sorted-by-density order, `Ω(n log n)` comparisons are required (sorting lower bound). But computing only the optimal **value** does *not* require the full order:

**Theorem 7.1 (Linear-time value).** The optimal value can be computed in `Θ(n)` worst-case time (deterministic) and `O(n)` expected time (randomized), without sorting.

*Proof.* The value depends only on partitioning items at the critical density `ρ_k`. This is a **weighted selection** problem: repeatedly pick a pivot density `p`, partition into `{> p}`, `{= p}`, `{< p}`, and recurse into the side containing the capacity boundary (the `Heavier` side if its weight `≥ remaining`, else absorb it and recurse into `Lighter` with reduced capacity). With random pivots the expected subproblem size shrinks geometrically: `E[T(n)] = E[T(≤ 3n/4)] + O(n) = O(n)`. Replacing random pivots with the **median-of-medians** pivot (Blum–Floyd–Pratt–Rivest–Tarjan) guarantees a constant fractional reduction per level, yielding `Θ(n)` worst case. ∎

**Strong polynomiality.** The running time `O(n)` (or `O(n log n)`) depends only on `n`, not on the magnitude of `W`, `vᵢ`, or `wᵢ`. Fractional Knapsack is therefore **strongly polynomial** — in stark contrast to 0/1's pseudo-polynomial `O(nW)`.

**Theorem 7.2 (recurrence for the randomized selection).** Let `T(n)` be the expected number of comparisons of the weighted-selection algorithm on `n` items. Partitioning around a uniformly random pivot, the rank of the capacity boundary is uniform, and the recursed side has expected size `≤ 3n/4` with probability `≥ 1/2`. Hence

```
T(n) ≤ T(3n/4) + c·n   in expectation, giving   T(n) = O(n)
```

by the same analysis as randomized quickselect (the geometric sum `c·n·(1 + 3/4 + 9/16 + …) = 4c·n`). The variance is bounded, and with median-of-medians pivots the `3n/4` bound becomes deterministic (`7n/10` per level), giving worst-case `Θ(n)`.

**Remark 7.3 (why the weighted twist does not change the bound).** Ordinary quickselect finds the element of a given *rank*; here the boundary is defined by a *cumulative weight* threshold `W` rather than a count. The partition step still splits the multiset by the pivot density and computes the partition's *total weight* in the same `O(size)` pass; the decision "recurse left or absorb-and-recurse-right" uses that weight. No extra asymptotic cost is incurred — the weighted boundary is found in the same linear time as an unweighted rank.

### 7.4 A note on comparison-model lower bounds

Computing the optimal *value* in `o(n)` time is impossible in the comparison model: any algorithm must inspect every item at least once, since omitting an item that turns out to be the densest changes the answer. So `Θ(n)` is optimal for the value. For the *full sorted plan*, the `Ω(n log n)` sorting lower bound applies. The selection algorithm threads this needle: it computes the value (and, with extra bookkeeping, the plan) without paying the sorting `log n` factor, because the value does not require total order — only the partition at `ρ*`.

| Quantity | Sort-based | Selection-based |
|----------|------------|-----------------|
| Time (value + plan) | `Θ(n log n)` | `Θ(n log n)` (still need order for full plan) |
| Time (value only) | `Θ(n log n)` | `Θ(n)` worst case (MoM), `O(n)` expected |
| Space | `Θ(1)` extra | `Θ(1)`–`Θ(n)` (partition scratch) |
| Sensitivity to `W` | none | none |

---

### 7.6 Average-case and cache behavior

**Average-case running time.** Both the sort and the selection are insensitive to input *distribution* in their asymptotic time: the sort is `Θ(n log n)` regardless, and randomized selection is `Θ(n)` expected over its internal coin flips, *independent* of the input ordering (the randomization decouples adversarial inputs from worst-case behavior). The fill pass is always exactly one linear scan. There are no input-dependent blow-ups once randomized pivoting is used.

**Cache and memory hierarchy.** The sort-based algorithm has excellent locality: after sorting (which modern introsort does cache-efficiently), the fill is a single sequential scan — ideal for prefetching. The selection algorithm's three-way partition is also sequential per level, but its repeated passes over shrinking subarrays touch progressively less data, so the working set fits in cache sooner. For very large `n`, the selection's `Θ(n)` total *element touches* (`n + 3n/4 + 9n/16 + … = 4n`) means roughly four sequential passes — still bandwidth-friendly. The dominant practical cost at scale is memory bandwidth, not arithmetic; this is why an in-place partition (no per-level allocation) materially outperforms the allocating version on `n ≈ 10⁸`.

**Branch prediction.** The fill loop's `if (wᵢ ≤ remaining)` is taken for every item until the single slice, then the loop breaks — a near-perfectly predictable branch (one mispredict at the end). The selection's pivot comparisons are the only data-dependent branches; with random pivots they are ~50/50 and thus mispredict-prone, a constant-factor cost that the asymptotic win over sorting still dominates for large `n`.

---

## 7.7 Space–Time Trade-offs

| Approach | Time | Extra space | Produces |
|----------|------|-------------|----------|
| Sort + fill | `Θ(n log n)` | `Θ(1)` (in-place sort) or `Θ(n)` (index sort) | value **and** full plan |
| Sort once + prefix sums + binary search | `Θ(n log n)` preprocess, `Θ(log n)` per query | `Θ(n)` (prefix arrays) | value for many `W` on a fixed set |
| Randomized selection (in place) | `Θ(n)` expected | `Θ(1)` | value (plan with extra pass) |
| Median-of-medians selection | `Θ(n)` worst case | `Θ(n)` (recursion/scratch) | value, deterministic |
| Streaming histogram | `Θ(n)` time, 2 passes | `Θ(B)` buckets | approximate value, constant memory |
| Exact rational | `Θ(n log n)` + big-int cost | `Θ(n)` | exact value, no float error |

The trade-off space is governed by three questions: *do you need the plan or just the value?* (plan favors sort), *one query or many on a fixed set?* (many favors prefix sums), and *exact or approximate, in-memory or streaming?* (exact-rational vs histogram). No single approach dominates; the professional skill is selecting by query profile.

---

## 8. The LP Relaxation Bound for 0/1 Branch-and-Bound

Although greedy is wrong for 0/1 Knapsack, the fractional optimum is the *engine* of exact 0/1 solvers.

**Proposition 8.1.** For any 0/1-Knapsack instance, `OPT₀₁ ≤ OPT_frac`. The fractional optimum is an upper bound on the integer optimum.

*Proof.* `{0,1}ⁿ ⊆ [0,1]ⁿ`, so the integer feasible set is contained in the LP feasible set; maximizing over a larger set cannot decrease the optimum. ∎

**Branch-and-bound use.** Dantzig's classic 0/1 solver branches on the critical item `x_k ∈ {0,1}`. At each node it computes the **fractional bound** (greedy on the remaining items/capacity) in `O(n)` (or `O(log n)` with a presorted structure). If a node's fractional bound does not exceed the best integer solution found, the subtree is pruned. The *tighter* the fractional bound, the more pruning — which is why a fast, exact Fractional Knapsack is the inner loop of practical 0/1 solvers. The "solve the easy relaxation to bound the hard integer problem" pattern generalizes to all of integer programming.

**Proposition 8.2 (the bound is the tightest single-constraint LP bound).** Among all relaxations that keep only the capacity constraint and relax integrality, the Fractional Knapsack optimum is the *exact* LP optimum, hence the tightest possible bound of this form. No cheaper relaxation (e.g., "sum of all values" or "value of densest item × capacity / its weight") is as tight; the fractional optimum dominates them all while remaining computable in linear time.

*Proof.* The fractional optimum is, by definition, the maximum of the same objective over the LP feasible region containing the integer region; any valid upper bound on the integer optimum derived from this single constraint must be `≥ OPT_frac` if it is to be valid for the LP too, and `OPT_frac` itself is valid (Prop 8.1) and achieved, so it is the least such bound. ∎

This is why Dantzig's bound, not a cruder one, is the standard: it is simultaneously the tightest single-constraint bound and linear-time to compute — a rare and exploitable combination.

---

## 9. Numerical Analysis and Exact Arithmetic

**Density comparison.** Comparing `vᵢ/wᵢ` vs `vⱼ/wⱼ` via floating-point division introduces relative error `O(ε)` per operation and can mis-order near-tied densities. The exact alternative is **cross-multiplication**: `vᵢ wⱼ ⋛ vⱼ wᵢ` (valid since weights are positive), which is exact in integer arithmetic. With `vᵢ, wᵢ < 2³¹`, products fit in 64 bits; for larger inputs use 128-bit or big integers.

**The slice.** The single division `x_k = remaining / w_k` is unavoidable and concentrates all the floating error. If the contract demands exactness, return `x_k` as the rational `remaining / w_k` and the value `Σ_{i<k} vᵢ + (remaining·v_k)/w_k` as an exact fraction (`big.Rat` / `Fraction`).

**Conditioning.** The optimal value is a Lipschitz-continuous, monotone function of `W` (slope `ρ_k`), so it is well-conditioned: a perturbation `ΔW` changes the value by at most `ρ_max·|ΔW|`. There is no catastrophic cancellation in the sum; the only sensitivity is at density ties, handled by exact comparison.

**Proposition 9.1 (value as a piecewise-linear concave function of `W`).** Let `f(W)` be the optimal value as a function of capacity. Then `f` is continuous, non-decreasing, piecewise-linear, and **concave**, with breakpoints at the prefix weights `W_j = Σ_{i≤j} wᵢ` (in density order) and slope `ρ_j` on the segment `(W_{j−1}, W_j)`.

*Proof.* On `(W_{j−1}, W_j)` the critical item is `j`, so a marginal unit of capacity is filled with density `ρ_j`; hence the slope is `ρ_j`. Since densities are non-increasing (`ρ₁ ≥ ρ₂ ≥ …`), the slopes decrease as `W` grows — that is concavity. Continuity holds because at each breakpoint the previous item finishes exactly as the next begins. ∎

**Corollary 9.2.** Concavity means *diminishing marginal value of capacity*: the first units of capacity buy the densest value, later units buy less. This is the economic content of the shadow price `λ = ρ_k` decreasing in `W`, and it is why over-provisioning capacity has diminishing returns — a fact reusable in capacity-planning arguments (`senior.md`).

### 9.3 Overflow analysis for cross-multiplication

The exact comparison `vᵢ wⱼ ⋛ vⱼ wᵢ` multiplies two input quantities. If `0 ≤ vᵢ, wᵢ < 2^b`, each product is `< 2^{2b}`. For 64-bit signed arithmetic, `2b ≤ 63` requires `b ≤ 31`, i.e., inputs `< 2³¹ ≈ 2.1·10⁹`. Beyond that, promote to 128-bit (e.g., `__int128`, Go `math/bits.Mul64`, Java `Math.multiplyHigh`) or arbitrary precision. The slice value `(remaining · v_k)/w_k` similarly needs a wide intermediate `remaining · v_k` before division; compute it in the widest integer type, or as an exact rational, to avoid overflow and rounding simultaneously.

---

## 10. Comparison with Alternatives

| Problem | Optimal method | Complexity | Greedy optimal? |
|---------|----------------|------------|-----------------|
| Fractional Knapsack | Density greedy / selection | `O(n log n)` / `O(n)` | **Yes** |
| 0/1 Knapsack | DP / branch-and-bound | `O(nW)` pseudo-poly; NP-complete | No |
| Bounded (≤ qᵢ copies) | Density greedy | `O(n log n)` | Yes (still divisible) |
| Unbounded fractional | Take all of the single densest item | `O(n)` | Yes (trivial) |
| Multi-dimensional (several capacities) | LP / ILP | poly (LP) / NP-hard (ILP) | No |
| Non-linear value | Convex optimization | varies | No |
| Min-cost to reach target | Density greedy (ascending cost) | `O(n log n)` | Yes (mirror image) |
| Online fractional | Threshold on estimated `ρ*` | `O(1)` per arrival | competitive, not exact |
| Streaming value | Histogram around `ρ*` | `O(n)`, 2 passes | approximate |

**Connection to matroids.** Fractional Knapsack is a special case of LP over a polymatroid-like region; the greedy optimality is the continuous analogue of the matroid greedy (which underlies Kruskal's MST). Recognizing the LP/matroid structure is the unifying theme behind "when greedy works."

**A unifying one-liner.** Greedy is optimal exactly when the feasible region has the structure that makes "always take the locally best available element" globally correct — a matroid for combinatorial problems, a suitably simple polytope for this LP. Fractional Knapsack is the cleanest continuous instance of that principle, which is why it is the canonical teaching example.

### 10.1 A taxonomy of "knapsack" problems by tractability

It helps to situate Fractional Knapsack in the full family, ordered by hardness:

| Variant | Constraint structure | Best known | Class |
|---------|---------------------|------------|-------|
| **Fractional** | one capacity, `x ∈ [0,1]ⁿ`, linear value | greedy `O(n)`/`O(n log n)` | P (strongly poly) |
| Unbounded fractional | one capacity, `x ≥ 0` | take all of densest, `O(n)` | P |
| Bounded fractional | per-item supply caps, divisible | greedy `O(n log n)` | P |
| **0/1** | one capacity, `x ∈ {0,1}ⁿ` | DP `O(nW)`; FPTAS | NP-complete (decision) |
| Bounded 0/1 (multiple copies) | per-item integer caps | DP / FPTAS | NP-complete |
| Multidimensional 0/1 | several capacities, integer `x` | no FPTAS (for ≥2 dims, unless P=NP) | NP-complete, harder |
| Quadratic knapsack | pairwise interaction terms | heuristics / B&B | NP-hard |

The cliff is the divisibility relaxation: everything in the top three rows (divisible) is polynomial; everything below (integer) is NP-complete or worse. Fractional Knapsack sits at the easy summit, and its value is the LP bound that makes the hard rows *attackable* via branch-and-bound and approximation.

### 10.2 Relationship to the simplex method

Solving the Fractional Knapsack LP with a general simplex solver would also return the greedy answer, but greedy *is* the specialized simplex for this constraint matrix. The constraint matrix `[wᵀ; I]` (one capacity row plus the identity for upper bounds) is so structured that the optimal vertex is found by a single sort + sweep rather than iterative pivoting. The "entering variable" rule of simplex (most-improving reduced cost) corresponds exactly to "take the densest remaining item," and the "leaving variable" (binding constraint) corresponds to "this item hit its upper bound or the capacity ran out." Seeing greedy as a one-pass simplex demystifies why it returns a vertex with a single fractional coordinate — that is the generic structure of an LP optimum with `n+1` constraints.

---

## 11. Open Problems and Summary

Fractional Knapsack is *solved* — there is no open complexity question for the basic problem. The interesting frontiers are in its **relatives and embeddings**:

- **Online fractional knapsack** with adversarial/stochastic arrivals: optimal competitive ratios for threshold policies (related to the secretary and one-way-trading problems).
- **Robust / distributionally-robust** variants where `(v, w)` are uncertain.
- **Streaming `ρ*` estimation** with provable `(1±ε)` guarantees and minimal memory (quantile sketches).
- **Tight integrality gaps** and rounding schemes that turn the fractional optimum into provably-good 0/1 solutions (the basis of FPTAS for 0/1 Knapsack).
- **Dynamic / incremental** maintenance: when items are inserted/deleted or `W` changes, recompute the optimum in `o(n)` using balanced-BST or segment-tree structures over densities, supporting `O(log n)` updates and queries.
- **Parallel and external-memory** lower bounds: how few passes / how little communication suffice to find the critical density in distributed settings (connections to streaming quantile lower bounds).

**A note on what is *not* open.** The basic problem admits no improvement past `Θ(n)` for the value (every item must be read) and `Θ(n log n)` for the full sorted plan (sorting lower bound). These are matched by the algorithms above, so the *core* problem is settled in the comparison model. The research life of the topic is entirely in its embeddings — online, robust, streaming, and as the relaxation engine for integer programs.

**Summary.** Fractional Knapsack is the linear program `max vᵀx, wᵀx ≤ W, 0 ≤ x ≤ 𝟙`, solved exactly by sorting items by density `vᵢ/wᵢ` and filling greedily — optimal by either an **exchange argument** (transfer weight toward denser items; non-negative value change) or **LP duality** (the critical density `ρ_k` is the dual price certifying complementary slackness). The optimum is a polytope vertex with **at most one fractional variable**. The problem is **strongly polynomial** — `Θ(n log n)` to sort, `Θ(n)` to compute the value via median-of-medians selection — independent of `W`. The decisive hypothesis throughout is **divisibility**: it powers the exchange transfer and the LP relaxation, and its absence is exactly what makes **0/1 Knapsack** NP-complete and greedy non-optimal. Yet the fractional optimum remains essential there too, as the **upper bound** driving branch-and-bound. The whole topic is a microcosm of algorithm design: relax, solve the relaxation greedily, and use it to attack the integer problem.

---

## 12. Reference Code (Exact greedy / O(n) selection, Go / Java / Python)

Exact greedy using cross-multiplication for ordering (no float in comparisons) and exact-rational value, alongside the `O(n)` selection value. Both report `240` for the canonical instance.

#### Go

```go
package main

import (
	"fmt"
	"math/big"
	"sort"
)

type Item struct{ v, w int64 }

// exactGreedy returns the optimal value as an exact rational big.Rat.
func exactGreedy(W int64, items []Item) *big.Rat {
	s := append([]Item(nil), items...)
	// order by density descending via cross-multiplication (exact)
	sort.Slice(s, func(i, j int) bool { return s[i].v*s[j].w > s[j].v*s[i].w })
	total := new(big.Rat)
	remaining := W
	for _, it := range s {
		if it.w <= remaining {
			total.Add(total, new(big.Rat).SetInt64(it.v))
			remaining -= it.w
		} else {
			// fraction = remaining/it.w of value it.v -> (remaining*it.v)/it.w
			frac := new(big.Rat).SetFrac(big.NewInt(remaining*it.v), big.NewInt(it.w))
			total.Add(total, frac)
			break
		}
	}
	return total
}

func main() {
	items := []Item{{60, 10}, {100, 20}, {120, 30}}
	r := exactGreedy(50, items)
	f, _ := r.Float64()
	fmt.Printf("exact = %s ≈ %.4f\n", r.RatString(), f) // 240
}
```

#### Java

```java
import java.util.*;

public class FractionalProof {
    record Item(long v, long w) {}

    // Exact greedy; returns value as a double but orders via cross-multiplication.
    static double exactGreedy(long W, List<Item> items) {
        List<Item> s = new ArrayList<>(items);
        s.sort((a, b) -> Long.compare(b.v() * a.w(), a.v() * b.w())); // descending density
        double total = 0.0; long remaining = W;
        for (Item it : s) {
            if (it.w() <= remaining) { total += it.v(); remaining -= it.w(); }
            else { total += (double) (remaining * it.v()) / it.w(); break; }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.printf("%.4f%n", exactGreedy(50,
            List.of(new Item(60,10), new Item(100,20), new Item(120,30)))); // 240
    }
}
```

#### Python

```python
from fractions import Fraction


def exact_greedy(W, items):
    """Optimal value as an exact Fraction; orders by cross-multiplication."""
    import functools

    def cmp(a, b):  # descending by density a.v/a.w vs b.v/b.w
        lhs, rhs = a[0] * b[1], b[0] * a[1]
        return -1 if lhs > rhs else (1 if lhs < rhs else 0)

    s = sorted(items, key=functools.cmp_to_key(cmp))
    total, remaining = Fraction(0), W
    for v, w in s:
        if w <= remaining:
            total += v
            remaining -= w
        else:
            total += Fraction(remaining * v, w)
            break
    return total


if __name__ == "__main__":
    r = exact_greedy(50, [(60, 10), (100, 20), (120, 30)])
    print(f"exact = {r} ≈ {float(r):.4f}")  # 240
```

**What it does:** computes the exact optimal value with rational arithmetic and order determined by exact cross-multiplication — the certificate-grade implementation matching the duality proof.
**Run:** `go run main.go` | `javac FractionalProof.java && java FractionalProof` | `python proof.py`

### 12.1 Why rational arithmetic here

The exact-rational implementation matters precisely for the *certificate* use case. When the optimum is reported to a downstream verifier (a grader, an auditor, a proof-checker), a float `239.99999997` is not acceptable as evidence of `240`. The rational path makes the whole-item sum an exact integer and the slice an exact fraction `remaining·v_k/w_k`, so the reported value is *provably* correct, and the dual certificate `(λ, μ)` (§4.1) can be checked with `primal == dual` as an exact equality rather than an approximate one. The cost — big-integer arithmetic — is `O(n)` rational operations with operand sizes bounded by the bit-lengths of the inputs times `n`; for the contract-grade use cases where it matters, this cost is negligible against the value of an unimpeachable answer.

### 12.2 Closing synthesis

The reference code, the exchange proof, the duality certificate, and the complexity analysis are four views of one object: a linear program so structured that a sort-and-sweep is its exact solver, its dual price is a single density, its optimum is a polytope vertex with one fractional coordinate, and its value is computable in linear time. Every practical concern downstream — reproducibility, streaming, bounding 0/1 — is a corollary of that structure. Master the structure and the rest follows.
</content>
