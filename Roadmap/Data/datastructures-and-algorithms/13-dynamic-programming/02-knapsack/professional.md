# Knapsack DP — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Optimal-Substructure Theorem (Proof for 0/1 Knapsack)
3. Correctness of the Tabular DP (Induction)
4. Correctness of the 1D Reverse-Iteration
5. Unbounded Knapsack and the Forward Iteration
6. Subset-Sum Reduction and NP-Completeness
7. Pseudo-Polynomiality and Weak NP-Hardness
8. Value-Indexed DP: Complexity and the Transpose
9. The FPTAS: Construction and Approximation Proof
10. Bounded Knapsack: Binary Splitting Correctness
11. The Greedy Fractional Optimum (Exchange Argument)
12. Lower Bounds and Hardness Landscape
13. Summary

---

## 1. Formal Definitions

Let there be `n` items. Item `i ∈ {1, …, n}` has integer weight `w_i ≥ 0` and integer value `v_i ≥ 0`. Let `W ∈ ℕ` be the knapsack capacity.

**Definition 1.1 (0/1 knapsack).** Choose `x ∈ {0,1}^n` to

```
maximize    Σ_{i=1}^n v_i x_i
subject to  Σ_{i=1}^n w_i x_i ≤ W,    x_i ∈ {0,1}.
```

Write `OPT(W)` for the optimal value, and more generally `OPT(i, c)` for the optimum using only items `{1, …, i}` with capacity `c`.

**Definition 1.2 (unbounded knapsack).** As above but `x_i ∈ ℕ` (any non-negative integer count).

**Definition 1.3 (bounded knapsack).** As above but `0 ≤ x_i ≤ c_i` for given counts `c_i ∈ ℕ`.

**Definition 1.4 (fractional knapsack).** As above but `x_i ∈ [0,1]` (a real fraction of each item).

**Definition 1.5 (subset-sum).** Given multiset `S = {a_1, …, a_n}` of positive integers and target `t`, decide whether some subset sums to exactly `t`. (This is the special 0/1 case `v_i = w_i = a_i`, target `W = t`, asking for value `= t`.)

**Definition 1.6 (DP table).** Let `f(i, c) = OPT(i, c)` denote the maximum value using the first `i` items with capacity budget `c`, with `f(0, c) = 0` for all `c ≥ 0` and `f(i, c) = -∞` for `c < 0` by convention. We prove `f` satisfies a recurrence (Theorem 2.1) and that the tabular fill computes it (Theorem 3.1).

**Notation.** Throughout, `n` is the item count, `W` the capacity, `b = ⌈log₂ W⌉` its bit-length, `V = Σ v_i` the total value, `v_max = max_i v_i`, and `[P]` the Iverson bracket (`1` if `P` holds, else `0`). "0/1" forbids repeats; "unbounded" permits unlimited copies.

**Definition 1.7 (Monotonicity of the value function).** `OPT(W)` is non-decreasing in `W`: a larger capacity admits a superset of feasible solutions. Formally, for `W' ≥ W`, every selection feasible for `W` is feasible for `W'`, so `OPT(W') ≥ OPT(W)`. This monotonicity is both a correctness invariant (the DP row must be non-decreasing left to right) and the property that lets the *value-indexed* DP answer "best value with weight `≤ W`" by a single scan for the largest achievable value whose minimum weight fits.

**Definition 1.8 (Dominance).** Item `i` *dominates* item `j` if `w_i ≤ w_j` and `v_i ≥ v_j` (lighter and at least as valuable). In any optimum, a dominated item `j` can be replaced by `i` without loss whenever `i` is unused; dominance pruning removes provably useless items before the DP and is a standard preprocessing step in production solvers (Pisinger).

---

## 2. The Optimal-Substructure Theorem (Proof for 0/1 Knapsack)

**Theorem 2.1 (Optimal substructure / recurrence).** For all `1 ≤ i ≤ n` and `c ≥ 0`,

```
f(i, c) = max( f(i-1, c),                       (skip item i)
               v_i + f(i-1, c - w_i) )          (take item i, only if w_i ≤ c)
```

with the take branch omitted (treated as `-∞`) when `w_i > c`, and base case `f(0, c) = 0`.

**Proof.** Fix `i ≥ 1` and `c ≥ 0`. Let `x* ∈ {0,1}^i` be an optimal selection over items `{1, …, i}` with `Σ w_j x*_j ≤ c`, achieving value `f(i, c)`. Two exhaustive, mutually exclusive cases:

*Case A: `x*_i = 0` (item `i` not chosen).* Then `x*` restricted to items `{1, …, i-1}` is feasible for capacity `c` and achieves the same value `f(i,c)`. Hence `f(i,c) ≤ f(i-1, c)`. Conversely any selection over `{1,…,i-1}` is also a selection over `{1,…,i}` (with `x_i = 0`), so `f(i-1,c) ≤ f(i,c)`. Thus when the optimum skips item `i`, `f(i,c) = f(i-1,c)`.

*Case B: `x*_i = 1` (item `i` chosen).* This requires `w_i ≤ c`. Remove item `i`: the remaining selection over `{1,…,i-1}` has weight `≤ c - w_i` and value `f(i,c) - v_i`. This remaining selection must itself be optimal for `(i-1, c - w_i)` — otherwise replacing it with a better one and re-adding item `i` would beat `x*`, contradicting optimality (this is the **cut-and-paste** argument). Hence `f(i,c) - v_i = f(i-1, c-w_i)`, i.e. `f(i,c) = v_i + f(i-1, c-w_i)`.

Since the optimum falls into exactly one case, and each case equals one of the two branches, the optimum equals the **larger** of the two branches (we may always *consider* both, and the infeasible take branch is `-∞`). Therefore `f(i,c) = max(f(i-1,c), v_i + f(i-1, c-w_i))`. ∎

**Remark (why cut-and-paste is the crux).** The argument that "the residual subproblem is itself solved optimally" is the defining property of dynamic programming. It holds here because the constraint is *separable*: the weight used by item `i` is independent of how the remaining capacity is used. This separability is exactly what *fails* for the simple-path / Hamiltonian problems, where the "remaining" choices depend on the *set* already visited — and it is why those are NP-hard with no pseudo-polynomial DP.

### 2.1 Worked Verification of the Recurrence

Take items `(w, v) = (2,3), (3,4), (4,5)` and `W = 5`. We verify `f(3, 5)` directly against the recurrence. By Theorem 2.1,

```
f(3, 5) = max( f(2, 5),                  # skip item 3
               5 + f(2, 5 - 4) )         # take item 3 (w_3 = 4 ≤ 5)
        = max( f(2, 5), 5 + f(2, 1) ).
```

We need `f(2, 5)` and `f(2, 1)`:

```
f(2, 5) = max( f(1, 5), 4 + f(1, 2) ) = max( 3, 4 + 3 ) = 7
f(2, 1) = f(1, 1) = 0          # w_2 = 3 > 1, take branch infeasible
f(1, 5) = max( f(0,5), 3 + f(0,3) ) = max(0, 3) = 3
f(1, 2) = max( f(0,2), 3 + f(0,0) ) = max(0, 3) = 3
```

Hence `f(3,5) = max(7, 5 + 0) = 7`, achieved by skipping item 3 and taking items 1, 2 (weights `2 + 3 = 5`, value `3 + 4 = 7`). This matches the brute-force enumeration over all `2^3 = 8` subsets — the empirical anchor for the inductive proof of Theorem 3.1.

### 2.2 The Multiplication-Free Structure

Unlike the matrix-power walk theorem (where concatenation *multiplies* counts), knapsack's optimal substructure uses only `max` and `+`: the value of a packing is the *sum* of chosen item values, and the optimum over choices is a `max`. This places knapsack in the **(max, +) semiring** view — the same algebra as longest-path DP — but on a *layered* state space (one layer per item, capacities as the state). The acyclicity of the layering (item `i` depends only on item `i-1`) is what guarantees the DP terminates without a fixed-point iteration, in contrast to shortest-path closures that must iterate until convergence.

---

## 3. Correctness of the Tabular DP (Induction)

**Theorem 3.1.** The bottom-up fill

```
for c in 0..W:  dp[0][c] = 0
for i in 1..n:
  for c in 0..W:
    dp[i][c] = dp[i-1][c]
    if w_i <= c: dp[i][c] = max(dp[i][c], v_i + dp[i-1][c - w_i])
```

computes `dp[i][c] = f(i, c)` for all `i, c`, and in particular `dp[n][W] = OPT(W)`.

**Proof (induction on `i`).** *Base `i = 0`:* `dp[0][c] = 0 = f(0,c)` by definition. *Step:* assume `dp[i-1][c] = f(i-1,c)` for all `c`. For each `c`, the fill computes exactly `max(dp[i-1][c], v_i + dp[i-1][c-w_i])` (with the take branch guarded by `w_i ≤ c`, and `c - w_i ≥ 0` in that branch). By the inductive hypothesis this is `max(f(i-1,c), v_i + f(i-1,c-w_i))`, which equals `f(i,c)` by Theorem 2.1. Hence `dp[i][c] = f(i,c)` for all `c`. By induction the claim holds for all `i`, so `dp[n][W] = f(n,W) = OPT(W)`. ∎

**Complexity.** The fill is two nested loops of sizes `n` and `W+1`, each iteration `O(1)`: `Θ(n·W)` time, `Θ(n·W)` space (or `Θ(W)` with the rolling array, Section 4).

**Reconstruction correctness.** After the fill, the back-trace

```
c = W
for i = n down to 1:
    if dp[i][c] != dp[i-1][c]:  take i;  c -= w_i
```

recovers an optimal selection. *Proof:* `dp[i][c] ≠ dp[i-1][c]` implies (Theorem 2.1) the max was achieved strictly by the take branch, so item `i` is in *some* optimum for `(i,c)`; we commit to it and recurse on `(i-1, c-w_i)`, which the table guarantees is solved optimally. If `dp[i][c] = dp[i-1][c]`, an optimum for `(i,c)` exists without item `i`, so skipping is safe. By induction the assembled set is optimal. ∎

**Subtlety in the back-trace.** The test `dp[i][c] ≠ dp[i-1][c]` correctly identifies *a* taken item but may differ from another optimum when ties exist (two distinct subsets achieving the same value). The reconstruction is *an* optimal solution, not necessarily *the* lexicographically smallest. To enforce a tie-break (e.g. fewest items, or smallest indices), augment the DP to store a secondary key, or prefer the skip branch on ties (which the strict inequality `>` in the fill already does — skip is written first and only overwritten on a strict improvement). This determinism matters in testing: two correct implementations may report different item sets unless the tie-break is pinned.

### 3.1 Why the Fill Order Is Valid

The fill computes `dp[i][·]` using only `dp[i-1][·]`. A *topological* argument confirms the order: define a dependency from cell `(i, c)` to `(i-1, c)` and `(i-1, c-w_i)`. All dependencies point to row `i-1`, strictly below in item-index, so processing rows in increasing `i` (and any column order within a row) respects every dependency. There is no intra-row dependency in the 2D version — which is *why* the column order is free in 2D, and *why* the column order becomes load-bearing only in the 1D collapse (Section 4), where row `i-1` and row `i` share storage.

---

## 4. Correctness of the 1D Reverse-Iteration

The rolling-array implementation keeps a single vector `g[c]` overwritten per item. We prove the **descending** sweep computes 0/1 knapsack.

**Setup.** Before processing item `i`, the invariant is `g[c] = f(i-1, c)` for all `c`. Processing item `i` sweeps `c` from `W` down to `w_i`:

```
for c = W down to w_i:
    g[c] = max(g[c], v_i + g[c - w_i])
```

**Theorem 4.1.** After the descending sweep for item `i`, `g[c] = f(i, c)` for all `c`.

**Proof.** Fix `c`. When the sweep reaches index `c`, consider the two operands:

- `g[c]` (left operand) has **not yet been written** in this sweep (we descend, and `c` is processed before any index `< c`). So `g[c] = f(i-1, c)` still holds — the old value.
- `g[c - w_i]` (right operand): since `c - w_i < c` and we descend, index `c - w_i` is processed *after* `c`. Therefore it also has **not yet been written**, so `g[c - w_i] = f(i-1, c - w_i)` — the old value.

Hence the update computes `max(f(i-1,c), v_i + f(i-1, c-w_i)) = f(i,c)` by Theorem 2.1, and writes it to `g[c]`. Indices `c < w_i` are untouched, where `f(i,c) = f(i-1,c)` (item cannot be taken), preserving the invariant there too. Thus after the sweep `g[c] = f(i,c)` for all `c`. By induction over items, `g[W] = f(n,W) = OPT(W)`. ∎

**Why ascending is wrong for 0/1.** If we swept `c` ascending, index `c - w_i < c` would be processed *before* `c`, so `g[c - w_i]` would already equal `f(i, c-w_i)` (the **new** value, possibly already containing item `i`). The update would then read a value that *includes* item `i`, allowing item `i` to be selected a second time. The result is the unbounded recurrence (Section 5), not 0/1. The iteration direction is therefore not a stylistic choice but a correctness requirement, pinned precisely by which operand must be "old."

**Corollary 4.2 (Space-time of the rolling array).** The 1D algorithm uses `Θ(W)` space and `Θ(n·W)` time, the same time as the 2D table but `Θ(n)`-factor less space. It cannot, however, reconstruct the selection (Section 3's back-trace needs the per-row history). The space-optimal *reconstruction* therefore requires either `Θ(n·W)` decision bits or Hirschberg's divide-and-conquer (next).

**Hirschberg reconstruction.** Split the items into halves `A` (first `n/2`) and `B` (rest). Compute, for every capacity `c`, the best value `f_A(c)` using only `A` (forward 1D DP) and `f_B(W-c)` using only `B` (backward 1D DP). The optimal split capacity is `c* = argmax_c (f_A(c) + f_B(W-c))`, found in `O(W)`. Recurse on `(A, c*)` and `(B, W - c*)`. The recurrence `T(n, W) = O(n·W) + T(n/2, c*) + T(n/2, W - c*)` solves to `O(n·W)` time and `O(W)` space, recovering the full selection. This is the exact analogue of linear-space sequence alignment, and it is the production answer when `n·W` integers will not fit but `Θ(W)` will.

---

## 5. Unbounded Knapsack and the Forward Iteration

For unbounded knapsack define `h(c) = max value with capacity c using any non-negative counts of all items`.

**Theorem 5.1 (Unbounded recurrence).** `h(c) = max( h(c-1)-style..., )` — more usefully, processing items one at a time with `g_asc`:

```
for each item i:
  for c = w_i up to W:
    g[c] = max(g[c], v_i + g[c - w_i])
```

computes the unbounded optimum in `g[W]`.

**Proof.** When the ascending sweep reaches `c`, index `c - w_i < c` was already processed in this same sweep, so `g[c - w_i]` already reflects *any number* of copies of item `i` (and all previously processed items). Thus `v_i + g[c - w_i]` represents "use one more copy of item `i` on top of an already-item-`i`-permitting solution for `c - w_i`." Inductively `g[c]` ranges over all multisets of items fitting `c`. Formally, let `h_i(c)` be the optimum using items `{1,…,i}` with unlimited copies; the sweep maintains `g[c] = h_i(c)`, and `h_i(c) = max(h_{i-1}(c), v_i + h_i(c - w_i))` — note the second term references `h_i` (same item allowed again), which the *ascending* read of the just-updated `g[c-w_i]` supplies exactly. ∎

**The structural contrast.** 0/1 needs the recurrence to reference `f(i-1, ·)` (item excluded), forcing the old value, hence descending. Unbounded needs `h_i(·)` (item still allowed), forcing the new value, hence ascending. The two algorithms differ in *one token* of code — the loop bound direction — and Sections 4–5 prove this is dictated entirely by which recurrence index (`i-1` vs `i`) the take branch must reference.

### 5.1 A Counting Lemma for the Direction Bug

To make the direction requirement quantitative, consider a single item `(w, v)` swept over an empty `dp` of capacity `W`.

**Lemma 5.2.** A descending 0/1 sweep sets `dp[c] = v` exactly for `c ∈ [w, W]` (one copy), whereas an ascending sweep sets `dp[c] = ⌊c/w⌋ · v` (as many copies as fit).

**Proof.** *Descending:* when index `c` is updated, `dp[c-w]` is still `0` (old value), so `dp[c] = max(0, v + 0) = v` for `c ≥ w`. No chaining occurs because lower indices are updated later. *Ascending:* `dp[c] = max(dp[c], v + dp[c-w])` with `dp[c-w]` already updated this pass; by induction `dp[c-w] = ⌊(c-w)/w⌋·v`, so `dp[c] = (⌊(c-w)/w⌋ + 1)·v = ⌊c/w⌋·v`. ∎

This lemma is a precise diagnostic: if a "0/1" implementation returns `⌊W/w⌋·v` for a single item instead of `v`, the sweep direction is reversed. It is the formal content behind the "ascending silently becomes unbounded" warning repeated throughout the topic, and it gives a one-item unit test that pins the bug exactly.

---

## 6. Subset-Sum Reduction and NP-Completeness

**Theorem 6.1.** Subset-sum (Definition 1.5) reduces to 0/1 knapsack in linear time; hence the decision version of 0/1 knapsack is NP-hard.

**Proof.** Given a subset-sum instance `(a_1, …, a_n; t)`, build a knapsack instance with `w_i = v_i = a_i` and capacity `W = t`. Ask whether the optimum value equals `t`. A subset has weight `≤ t` and value `= t` iff its elements sum to exactly `t` (since value = weight). So the subset-sum answer is "yes" iff knapsack's optimum value is `t`. The reduction is `O(n)`. Subset-sum is NP-complete (Karp 1972, by reduction from 3-SAT via Exact-Cover/3-Partition lineage), so 0/1 knapsack's decision version is NP-hard. ∎

**Theorem 6.2 (Membership in NP).** The 0/1 knapsack decision problem ("is there a subset with value ≥ `V` and weight ≤ `W`?") is in NP: a selection `x` is a polynomial-size certificate, verifiable in `O(n)` by summing weights and values. Combined with Theorem 6.1, the decision problem is **NP-complete**. ∎

**Remark (the reduction preserves structure).** The subset-sum-to-knapsack reduction in Theorem 6.1 is *parsimonious* in a useful sense: the number of subsets summing to `t` equals the number of knapsack selections of value exactly `t` and weight `≤ t` (since value = weight forces weight = `t`). Hence even the **counting** versions correspond: `#`subset-sum reduces to `#`knapsack, so counting optimal knapsack solutions is `#P`-hard. This is why the "number of ways" variant (counting subsets hitting a sum) is handled by the *counting* DP (`dp[s] += dp[s-x]`) rather than any closed form — it is a genuinely `#P`-hard quantity, tractable only because the numbers are small (pseudo-polynomial again).

**Corollary 6.3.** The optimization version is NP-hard, and unless P = NP there is no algorithm polynomial in the *input length* `(n + b)` where `b = log W`. The `O(n·W)` DP is not a counterexample because it is polynomial in `W = 2^b`, not in `b` — see Section 7.

### 6.1 Worked Reduction Instance

Subset-sum instance: `a = (3, 34, 4, 12, 5, 2)`, target `t = 9`. Build knapsack with `w_i = v_i = a_i`, `W = 9`, and ask whether `OPT = 9`. The knapsack DP fills `dp[s]` over `s ∈ [0, 9]`; after processing all items, `dp[9] = 9` because the subset `{4, 5}` (or `{3, 4, 2}`) sums to exactly `9`, achieving value `9` at weight `9 ≤ 9`. Hence the subset-sum answer is "yes." Had no subset summed to `9`, the optimum value would be `< 9` (the best value reachable with weight `≤ 9` that equals its own weight), and the answer "no." This explicit instance shows the reduction is a *literal re-labeling*: the knapsack table *is* the subset-sum reachability table when `v_i = w_i`, which is why the two problems share the same `O(n·t)` DP and the same weak NP-hardness.

---

## 7. Pseudo-Polynomiality and Weak NP-Hardness

**Definition 7.1 (Pseudo-polynomial).** An algorithm is *pseudo-polynomial* if its running time is bounded by a polynomial in the numeric **value** of the largest number in the input (here `W` or `V`), equivalently exponential in the input's **bit-length**.

**Proposition 7.2.** The `O(n·W)` knapsack DP is pseudo-polynomial: with `b = ⌈log₂ W⌉`, the running time is `Θ(n·2^b)`, exponential in `b`.

**Proof.** The input encodes `W` in `Θ(b)` bits. The DP performs `Θ(n·W) = Θ(n·2^b)` operations. As a function of the input length `Θ(n + b + Σ log v_i)`, this is exponential in the `b` component. ∎

**Definition 7.3 (Weak vs strong NP-hardness).** A problem is *weakly* NP-hard if it is NP-hard but admits a pseudo-polynomial algorithm (so it becomes polynomial when the numbers are bounded by a polynomial in `n`). It is *strongly* NP-hard if it remains NP-hard even when all numbers are polynomially bounded (no pseudo-polynomial algorithm unless P = NP).

**Theorem 7.4.** 0/1 knapsack and subset-sum are **weakly** NP-hard.

**Proof.** They are NP-hard (Theorem 6.1) and admit the pseudo-polynomial `O(n·W)` (resp. `O(n·t)`) DP (Theorem 3.1). Hence weakly NP-hard. Equivalently: if `W ≤ poly(n)`, the DP is genuinely polynomial. ∎

**Contrast.** 3-Partition and bin-packing (in the strong sense) are *strongly* NP-hard — no pseudo-polynomial algorithm exists unless P = NP. Knapsack's weakness is precisely what enables the FPTAS (Section 9): a strongly NP-hard problem cannot have an FPTAS unless P = NP, but a weakly NP-hard one with a pseudo-polynomial DP often can. This is the deep link between pseudo-polynomiality and approximability.

### 7.1 The Unary-Encoding View

Another lens on pseudo-polynomiality: an algorithm is pseudo-polynomial iff it is polynomial when numbers are written in **unary** (a number `W` written as `W` tally marks takes `W` symbols, so `O(n·W)` is linear in that encoding). Weak NP-hardness then says "hard in binary, easy in unary." Subset-sum is the cleanest example: in binary it is NP-complete; in unary it is in P (the `O(n·t)` DP is linear in the unary input length). The whole pseudo-polynomial story is the gap between these two encodings, and it is exactly why competitive-programming knapsack problems always *bound* `W` (e.g. `W ≤ 10^5`): they are implicitly promising the unary-feasible regime.

### 7.2 Strongly Polynomial Special Cases

Some structural restrictions make knapsack *genuinely* polynomial:

- **Equal weights** (`w_i = w` for all `i`): sort by value, take the `⌊W/w⌋` most valuable. `O(n log n)`.
- **Equal values** (`v_i = v`): take the `⌊W/?⌋` lightest items that fit; greedily pack lightest-first. `O(n log n)`.
- **Two distinct weights**, or **divisible** weight sets (each weight divides the next): number-theoretic structure collapses the DP.

These are not exceptions to NP-hardness — they are restricted instance families where the hardness reduction (Theorem 6.1) cannot be embedded. Recognizing such structure in a real instance can turn an apparently exponential problem polynomial, a worthwhile check before reaching for the table.

### 7.3 The Parameterized View

Knapsack's tractability is best understood through *which parameter* is bounded:

| Bounded parameter | Resulting complexity | Mechanism |
|-------------------|----------------------|-----------|
| `W` (capacity) | `O(n·W)` | weight-indexed DP |
| `V` (total value) | `O(n·V)` | value-indexed DP |
| `n` (item count) | `O(2^{n/2}·n)` | meet-in-the-middle |
| number of distinct weights `d` | `O(poly · ∏ counts)` | grouped DP |
| `1/ε` (accuracy) | `O(n²/ε)` | FPTAS |

This is the parameterized-complexity statement that knapsack is **FPT** (fixed-parameter tractable) in *each* of `W`, `V`, and `n` individually, but **not** polynomial in the input length (where all three are encoded compactly). The senior decision tree (`senior.md`) is exactly a router over these parameter-bounded regimes: identify which parameter is small in *this* instance, and invoke the matching FPT algorithm. No single algorithm dominates because no single parameter is always small; the art is reading the instance.

---

## 8. Value-Indexed DP: Complexity and the Transpose

Instead of "max value within capacity `c`," tabulate "min weight to achieve value `v`."

**Definition 8.1.** `cost(i, v) = ` minimum total weight of a subset of `{1,…,i}` whose value is *exactly* `v` (or `+∞` if unachievable), with `cost(0, 0) = 0`, `cost(0, v>0) = +∞`.

**Theorem 8.2 (Value recurrence).** `cost(i, v) = min( cost(i-1, v), w_i + cost(i-1, v - v_i) )` (take branch only for `v ≥ v_i`), and `OPT(W) = max { v : cost(n, v) ≤ W }`.

**Proof.** Symmetric to Theorem 2.1: an optimal minimum-weight way to reach value `v` over `{1,…,i}` either omits item `i` (`cost(i-1,v)`) or includes it, contributing `w_i` and leaving the minimum-weight way to reach `v - v_i` over `{1,…,i-1}` (`w_i + cost(i-1, v-v_i)`); the cut-and-paste argument shows the residual is itself optimal. The optimum value for capacity `W` is the largest `v` whose minimum achieving weight fits. ∎

**Complexity.** `Θ(n·V)` time and `Θ(V)` space (1D, descending), where `V = Σ v_i`. The capacity `W` appears *only* in the final scan, so this is polynomial even for `W = 2^{1000}`.

**Proposition 8.3 (Choose the smaller dimension).** Weight-indexed DP costs `Θ(n·W)`; value-indexed costs `Θ(n·V)`. Choosing `min(W, V)` gives `O(n · min(W, V))`. Both are pseudo-polynomial — in `W` and in `V` respectively — and the two are *transposes* of the same lattice DP (swap the roles of the two additive resources). ∎

### 8.1 Worked Value-Indexed Example

Same items `(2,3), (3,4), (4,5)`, `W = 5`. Total value `V = 12`. Tabulate `cost[v]`:

```
init: cost[0]=0, cost[1..12]=∞
item (w=2,v=3): cost[3]=2
item (w=3,v=4): cost[4]=3, cost[7]=min(∞, 3+2)=5
item (w=4,v=5): cost[5]=4, cost[8]=min(∞,4+3)=7, cost[12]=min(∞,4+5)=9
```

The reachable `(v, cost)` pairs include `(7, 5)` (items 1+2, weight 5) and `(9, ...)` would need weight `> 5`. Scanning for the largest `v` with `cost[v] ≤ W = 5`: `cost[7] = 5 ≤ 5`, and no larger `v` has `cost ≤ 5`. So `OPT = 7`, matching Section 2.1. Note the capacity `W = 5` entered only in the final scan `cost[v] ≤ 5` — had `W` been `10^{18}`, the table would be identical and the scan would simply return the largest reachable value, `9` (all three items).

### 8.2 Both Are Special Cases of a 2-Resource Lattice

Define `g(i; a, b)` = `1` if items `{1,…,i}` admit a selection of total weight exactly `a` and total value exactly `b`. The full `(weight, value)` reachability lattice is `O(n·W·V)` — too large. Weight-indexed DP projects this lattice onto the weight axis (keeping max value per weight); value-indexed DP projects onto the value axis (keeping min weight per value). Each projection discards one dimension, and which projection is cheaper depends on which axis is shorter. This is the precise sense in which the two DPs are *transposes*: they are the two axis-projections of one underlying two-resource feasibility lattice, and the FPTAS (Section 9) is a *third* move — coarsening the value axis so its projection becomes short.

---

## 9. The FPTAS: Construction and Approximation Proof

**Definition 9.1 (FPTAS).** A *fully polynomial-time approximation scheme* for a maximization problem is an algorithm that, for every `ε > 0`, returns a value `≥ (1-ε)·OPT` in time polynomial in both the input length and `1/ε`.

**Construction.** Let `v_max = max_i v_i` and set scale `K = ε·v_max / n`. Define rounded values `v'_i = ⌊ v_i / K ⌋`. Run the *exact* value-indexed DP (Section 8) on the `v'_i` to find a subset `S'` maximizing rounded value subject to weight `≤ W`. Output the **true** value `Σ_{i∈S'} v_i`.

**Theorem 9.2 (Approximation guarantee).** The output satisfies `Σ_{i∈S'} v_i ≥ (1-ε)·OPT`.

**Proof.** Let `S*` be the exact optimum, `OPT = Σ_{i∈S*} v_i`. For any item, `K·v'_i ≤ v_i < K·(v'_i + 1)`, so `0 ≤ v_i - K·v'_i < K`. Summing over the at-most-`n` items of any feasible set,

```
Σ_{i∈S} v_i - K · Σ_{i∈S} v'_i  <  n·K = ε·v_max.
```

Since `S'` is optimal for the rounded values and `S*` is feasible,

```
K·Σ_{i∈S'} v'_i  ≥  K·Σ_{i∈S*} v'_i  >  Σ_{i∈S*} v_i - n·K  =  OPT - ε·v_max.
```

And `Σ_{i∈S'} v_i ≥ K·Σ_{i∈S'} v'_i` (since `v_i ≥ K v'_i`). Chaining,

```
Σ_{i∈S'} v_i ≥ OPT - ε·v_max.
```

Finally `OPT ≥ v_max` (the single most valuable item is always feasible when `w_{argmax} ≤ W`; if it is not, drop infeasible items first, after which `OPT ≥ v_max` holds for the reduced instance). Hence `Σ_{i∈S'} v_i ≥ OPT - ε·OPT = (1-ε)·OPT`. ∎

**Theorem 9.3 (Running time).** The scaled total value is `V' = Σ v'_i ≤ n·⌊v_max/K⌋ = n·⌊n/ε⌋ = O(n²/ε)`. The value-indexed DP runs in `O(n·V') = O(n³/ε)` (refinable to `O(n²/ε)` with `V'` bounded by `n·v_max/K` more tightly). Both are polynomial in `n` and `1/ε`, so this is an FPTAS. ∎

**Remark (the rounding must be *down*).** Rounding `v'_i = ⌊v_i/K⌋` (floor, not round-to-nearest) is essential for the *one-sided* error bound `0 ≤ v_i - K v'_i < K` in Theorem 9.2. Rounding up or to nearest would allow `K v'_i > v_i`, so the scaled DP could prefer a selection whose *true* value is worse, breaking the `(1-ε)` guarantee. The floor guarantees the scaled value never overstates the true value, so the scaled optimum's true value is a valid lower bound on `OPT` up to the bounded loss. This is a subtle but load-bearing detail of the FPTAS construction.

**Remark (scaling weights instead).** One can dually build an FPTAS by scaling *weights* and using the weight-indexed DP, but it is messier: scaling weights can make an infeasible selection appear feasible (rounding a weight down may let it "fit" when it does not), requiring a feasibility correction. Scaling *values* never affects feasibility — the weight constraint is untouched — which is why the standard FPTAS scales values, not weights. The choice of which resource to coarsen is dictated by which one appears in the *constraint* (weight) versus the *objective* (value): coarsen the objective.

**Why weak NP-hardness permits it.** The FPTAS exists *because* knapsack has a pseudo-polynomial value-indexed DP (Section 8). Scaling values caps `V'` at `poly(n, 1/ε)`, making the otherwise-pseudo-polynomial DP genuinely polynomial. A strongly NP-hard problem has no pseudo-polynomial DP to scale, which is why (by a theorem of Garey-Johnson) it cannot have an FPTAS unless P = NP.

### 9.1 Worked FPTAS Trace

Items `(w, v) = (10, 60), (20, 100), (30, 120)`, `W = 50`, `ε = 0.5`. Here `v_max = 120`, `n = 3`, so `K = ε·v_max/n = 0.5·120/3 = 20`. Rounded values:

```
v'_1 = ⌊60/20⌋  = 3
v'_2 = ⌊100/20⌋ = 5
v'_3 = ⌊120/20⌋ = 6
```

Run value-indexed DP on `v' = (3, 5, 6)`, weights `(10, 20, 30)`, `W = 50`. Reachable: items 2+3 give scaled value `5+6=11` at weight `50 ≤ 50`. That selection's **true** value is `100 + 120 = 220`. The exact optimum is also `220` (items 2, 3), so this run is exact here; the guarantee only promises `≥ (1-0.5)·220 = 110`. A tighter `ε` (smaller `K`) would preserve more value distinctions at higher DP cost — the `1/ε` trade-off made concrete. Note `V' = 3+5+6 = 14`, far below the worst-case `n²/ε = 9/0.5 = 18` bound of Theorem 9.3.

### 9.2 The FPTAS Cannot Be Strengthened to an FPTAS for Strong NP-Hard Variants

**Proposition 9.4.** The *multi-dimensional* (multiple capacity constraints) knapsack is strongly NP-hard and admits no FPTAS unless P = NP.

**Proof idea.** With `d ≥ 2` independent weight dimensions, the problem encodes problems (such as independent set on bounded instances) that remain hard with polynomially bounded numbers; the value DP would need to index a `d`-dimensional capacity grid, `O(n · W_1 · … · W_d)`, which scaling cannot collapse because there is no single value axis whose coarsening bounds all dimensions. By Garey-Johnson, strong NP-hardness rules out an FPTAS unless P = NP. ∎

This sharply delimits the FPTAS: it is a property of the *single-constraint* knapsack's weak NP-hardness, lost the moment a second independent resource constraint is added.

### 9.3 PTAS vs FPTAS vs Constant-Factor

It is worth placing the FPTAS in the approximation hierarchy:

| Class | Guarantee | Time dependence on `1/ε` | Knapsack? |
|-------|-----------|--------------------------|-----------|
| Constant-factor | fixed ratio (e.g. 1/2) | none | greedy-by-density gives 1/2 |
| PTAS | `(1-ε)` for any `ε` | possibly `n^{1/ε}` (exponential in `1/ε`) | yes (weaker) |
| **FPTAS** | `(1-ε)` for any `ε` | **polynomial in `1/ε`** | **yes** (the gold standard) |

Knapsack has an FPTAS — the strongest possible (a problem with an FPTAS is "as approximable as it gets" for an NP-hard problem). The simple greedy (take density-sorted whole items, or the single best item, whichever is larger) already gives a `1/2`-approximation in `O(n log n)`; the FPTAS refines this to any desired accuracy at polynomial cost in `1/ε`. The existence of an FPTAS (not merely a PTAS) is again a consequence of the pseudo-polynomial DP — a PTAS-only problem lacks the dynamic-programming scaffold that scaling can polynomially bound.

---

## 10. Bounded Knapsack: Binary Splitting Correctness

**Theorem 10.1.** For an item available in `c` copies, replacing it by 0/1 pseudo-items of multiplicities `1, 2, 4, …, 2^{k}, r` where `k = ⌊log₂(c+1)⌋ - 1` and `r = c - (2^{k+1} - 1) ≥ 0` lets a subset of these chunks realize *every* integer count in `{0, 1, …, c}`, and no count exceeds `c`.

**Proof.** The powers `1, 2, …, 2^k` can form any integer in `[0, 2^{k+1} - 1]` by binary representation. Adding the remainder chunk `r` (where `0 ≤ r ≤ 2^{k+1} - 1` by choice of `k`) extends the reachable range to `[0, 2^{k+1} - 1 + r] = [0, c]`: for any target `m ∈ [0, c]`, if `m ≤ 2^{k+1} - 1` use the powers alone; otherwise take `r` and represent `m - r ∈ [0, 2^{k+1} - 1]` with the powers. No subset exceeds `c` because the total of all chunks is exactly `c`. Each chunk of multiplicity `m_j` becomes a 0/1 item of weight `m_j·w` and value `m_j·v`, so a chosen subset of chunks corresponds to taking that many copies — exactly the bounded constraint. ∎

**Complexity.** `O(log c)` chunks per item, so `O(Σ_i log c_i)` pseudo-items and `O(n·W·log max_c)` overall. ∎

### 10.1 The Optimal Deque Bound

**Theorem 10.2.** Bounded knapsack can be solved in `O(n·W)`, removing the `log max_c` factor.

**Proof sketch.** Fix item `(w, v, c)`. Partition capacities by residue `r = c mod w` into classes `r, r+w, r+2w, …`. Within a class, write the index as `r + j·w`; the recurrence "take between 0 and `c` copies" becomes

```
dp[r + j·w] = max_{0 ≤ t ≤ min(j, c)} ( old[r + (j-t)·w] + t·v ).
```

Substituting `g(j) = old[r + j·w] - j·v` turns this into `dp[r+j·w] = j·v + max_{j-c ≤ s ≤ j} g(s)` — a **sliding-window maximum** of window size `c+1` over the sequence `g(0), g(1), …`. A monotonic deque maintains the window max in amortized `O(1)` per index. Each capacity is visited once per item, so the total is `O(n·W)`. ∎

The `- j·v` normalization (and adding `+ j·v` back) is the crux: it converts the count-dependent additive term into a pure windowed max, which is what makes the deque applicable. This is the same transformation used in the "sliding window maximum" pattern (sibling `stack-queue-patterns`), instantiated on the knapsack residue classes.

### 10.2 Why Binary Splitting Is Near-Optimal in Practice

Although Theorem 10.2 gives `O(n·W)`, binary splitting's `O(n·W·log max_c)` is usually the pragmatic choice because (a) its constant factor is tiny — it is just ordinary 0/1 DP over `O(log c)` pseudo-items — while the deque method's per-item bookkeeping (residue classes, deque push/pop, the `±j·v` normalization) has a larger constant; and (b) `log max_c ≤ ~30` even for `max_c = 10^9`, so the asymptotic gap is a small factor. The deque method wins decisively only when `max_c` is genuinely enormous *and* the instance is tight on time. The chunk decomposition `c = 1 + 2 + … + 2^k + r` is also numerically robust: each pseudo-item's weight `m·w` and value `m·v` fit in 64 bits as long as `c·w` and `c·v` do, which the input constraints normally guarantee.

---

## 11. The Greedy Fractional Optimum (Exchange Argument)

**Theorem 11.1.** For fractional knapsack, sorting items by density `ρ_i = v_i / w_i` descending and filling greedily (whole high-density items, then a fraction of the first that does not fit) yields the optimum.

**Proof (exchange argument).** Index items so `ρ_1 ≥ ρ_2 ≥ … ≥ ρ_n`. The greedy solution `g` fills capacity with the densest weight first. Let `o` be any optimal solution. If `o ≠ g`, there exist indices `a < b` (so `ρ_a ≥ ρ_b`) with `o` allocating *less* weight to `a` than `g` does and *more* to `b`. Move an infinitesimal weight `δ` from `b` to `a` in `o`: the value changes by `δ(ρ_a - ρ_b) ≥ 0`, so `o` does not worsen and the total weight is unchanged (still feasible). Repeating drives `o` toward `g` without decreasing value, so `g` is optimal. ∎

**Why this fails for 0/1.** The exchange moves a *fraction* of weight, which 0/1 forbids (`x_i ∈ {0,1}`). When items are indivisible, swapping a fraction of a high-density heavy item for a low-density light one is not an available move, so the local exchange need not preserve feasibility or improve value. Concretely, weights `(10, 20, 30)`, values `(60, 100, 120)`, `W = 50`: densities `(6, 5, 4)`; greedy 0/1 takes items 1, 2 (value 160), but the optimum is items 2, 3 (value 220). The greedy *fractional* value here is `240` (take all of 1, 2 and `2/3` of 3) — an upper bound on the 0/1 optimum, never the 0/1 answer. This LP-relaxation bound is exactly what branch-and-bound knapsack solvers use to prune.

**Theorem 11.2 (LP relaxation = fractional optimum).** The linear program

```
max  Σ v_i x_i   s.t.   Σ w_i x_i ≤ W,   0 ≤ x_i ≤ 1
```

is the LP relaxation of the 0/1 integer program (Definition 1.1), and its optimum equals the greedy fractional value of Theorem 11.1.

**Proof.** The LP has an optimal *basic feasible* solution with at most one fractional variable (a basic solution to a single packing constraint plus box constraints has at most one variable strictly between its bounds). Ordering by density and saturating greedily produces exactly such a vertex: all higher-density variables at `1`, all lower at `0`, one split. By LP duality / the exchange argument (Theorem 11.1) no feasible point beats it. Hence `LP-OPT = greedy-fractional`. ∎

**Corollary 11.3 (Integrality gap and bounding).** `OPT_{0/1} ≤ LP-OPT`, and the gap is at most one item's value: `LP-OPT - OPT_{0/1} < v_max` (drop the single fractional item from the LP solution to obtain a feasible integer solution losing `< v_max`). This bounded gap is the theoretical justification for using the LP value as both a branch-and-bound upper bound and the `OPT ≥ v_max` fact used in the FPTAS proof (Theorem 9.2).

**Corollary 11.4 (A 1/2-approximation).** Let `G` be the value of the density-greedy *integer* prefix (whole items until one does not fit) and `v_max` the single most valuable feasible item. Then `max(G, v_max) ≥ OPT_{0/1} / 2`.

**Proof.** The LP optimum is `G + f·v_b` where `v_b ≤ v_max` is the boundary item and `f ∈ [0,1)` its fraction. Then `OPT_{0/1} ≤ LP-OPT = G + f·v_b < G + v_max ≤ 2·max(G, v_max)`. Hence `max(G, v_max) > OPT_{0/1}/2`. ∎

This is the constant-factor baseline the FPTAS (Section 9) refines. It also justifies the standard FPTAS preprocessing assumption `OPT ≥ v_max`: the single best item is always a feasible lower bound, so dropping items heavier than `W` and taking `v_max` as a floor is sound.

---

### 11.4 Branch-and-Bound Correctness

A practical exact solver for large 0/1 knapsack is **branch-and-bound** using the LP bound. At each node, items are fixed in/out; the LP relaxation of the remaining free items gives an upper bound on any completion. A node is pruned when its LP bound does not exceed the best integer solution found.

**Proposition 11.5 (Soundness).** Branch-and-bound with the LP bound returns the exact optimum.

**Proof.** The LP bound (Theorem 11.2) is a *valid* upper bound: no integer completion of a node can exceed its LP relaxation, since every integer solution is LP-feasible. Pruning a node whose bound `≤` incumbent therefore discards only suboptimal completions. The search exhausts the (finite) branch tree otherwise, so the incumbent at termination is optimal. ∎

The branching order — typically by density, fixing the most-fractional item first — does not affect correctness, only efficiency. Pisinger's expanding-core algorithms refine this with dominance and a small "core" of uncertain items, achieving practical exact solution of instances where the `n·W` table is infeasible.

### 11.5 Why the LP Bound Is the Right Pruning Function

Among all polynomial-time upper bounds for a branch-and-bound node, the LP relaxation is the *tightest* one obtainable from relaxing integrality alone (Theorem 11.2 shows it equals the fractional optimum, and no integer solution can exceed it). Cheaper bounds exist — e.g. summing all remaining values, or a density-times-capacity estimate — but they are looser and prune fewer nodes. The LP bound's `O(n)` evaluation per node (after sorting items by density once, the bound is a prefix-sum plus one fractional term) makes it the standard pruning function. The trade-off is classic: a tighter bound costs more per node but visits fewer nodes; for knapsack the LP bound is the empirically dominant choice, which is why production exact solvers (Pisinger, Martello-Toth) build on it rather than on weaker estimates.

---

## 12. Lower Bounds and Hardness Landscape

**Theorem 12.1 (No polynomial exact algorithm unless P = NP).** Since 0/1 knapsack is NP-hard (Theorem 6.1), no algorithm runs in time polynomial in `(n + log W + Σ log v_i)` unless P = NP.

**Theorem 12.2 (Conditional lower bound on the DP).** Under the **Strong Exponential Time Hypothesis (SETH)**, subset-sum (hence 0/1 knapsack) has no `O((n + t)^{1-δ})`-style algorithm beating the pseudo-polynomial product by a polynomial factor for all parameter regimes; more precisely, recent fine-grained results (Abboud-Bringmann-Hermelin-Shabtay and Künnemann-Paturi-Schneider) show the `O(n·t)` subset-sum DP is essentially optimal under SETH up to subpolynomial factors. The takeaway: the `n·W` (or `n·t`) product is not an artifact of a naive algorithm — it is conditionally tight.

**What this rules out and what it does not.** SETH-based hardness says you cannot shave the *product* `n·t` to `(n·t)^{1-δ}` in general. It does *not* forbid faster algorithms for *special* parameter regimes: Bringmann's `O(n + t)` (near-linear in `t`) randomized subset-sum and the `O(n + t · polylog)` deterministic variants exploit FFT-style convolution of the reachable-sums bitset, beating the textbook `O(n·t)` when `t` dominates `n`. These do not contradict Theorem 12.2 because they trade the `n` factor for additive `t`, valid only when the parameters are arranged favorably. The practical lesson: the schoolbook `O(n·W)` table is conditionally optimal as a *worst-case product*, but bitset/convolution tricks (Section 6 of `senior.md`) win large constant or even polynomial factors in the common `t ≫ n` regime.

**A note on the (max, +) algebra.** Knapsack's recurrence lives in the `(max, +)` semiring (Section 2.2), which — unlike the counting `(+, ×)` semiring of walk-counting — is *idempotent* (`max(a, a) = a`). Idempotency is why the value function *saturates* (it is bounded by `Σ v_i`, reached once all items fit) rather than growing without bound, and why no modulus is ever needed for knapsack values (they are bounded by `V`, not exponential in `n`). The contrast with walk-counting's geometric blow-up is instructive: there the non-idempotent `+` forces a modulus; here idempotent `max` keeps values bounded, and the difficulty is purely combinatorial (which subset), not numeric (overflow).

| Problem | Complexity | Note |
|---------|-----------|------|
| 0/1 knapsack (decision) | NP-complete | weakly NP-hard |
| 0/1 knapsack DP (weight) | `Θ(n·W)` | pseudo-poly; conditionally tight |
| value-indexed DP | `Θ(n·V)` | transpose; pseudo-poly |
| meet-in-the-middle | `O(2^{n/2}·n)` | exact, any `W` |
| FPTAS | `O(n²/ε)` | `(1-ε)`-approx |
| fractional knapsack | `O(n log n)` | greedy, exact, LP-relaxation |
| bounded (binary split) | `O(n·W·log max_c)` | exact |
| bounded (deque) | `O(n·W)` | exact, tight |
| 3-Partition / bin-packing | strongly NP-hard | no FPTAS unless P = NP |

**The organizing principle.** Knapsack sits on the boundary between tractable and intractable: it is NP-hard (so no fast exact algorithm in general) yet *weakly* so (pseudo-polynomial DP exists), which in turn is precisely the property that yields an FPTAS. The fractional relaxation is polynomial and provides the bounding function for exact branch-and-bound. Everything in this topic — table DP, value-indexed DP, FPTAS, meet-in-the-middle, the greedy fractional bound — is a different response to *which numeric parameter is small*.

### 12.1 Meet-in-the-Middle: Correctness and Complexity

**Theorem 12.3.** The meet-in-the-middle algorithm (split items into halves `L`, `R`; enumerate all subsets of each; for each `L`-subset of weight `w_L ≤ W`, add the best `R`-subset of weight `≤ W - w_L`) computes the exact 0/1 optimum in `O(2^{n/2} · n)` time and space.

**Proof.** Every subset `S ⊆ [n]` decomposes uniquely as `S = S_L ⊎ S_R` with `S_L ⊆ L`, `S_R ⊆ R`. Its weight is `w(S_L) + w(S_R)` and value `v(S_L) + v(S_R)`. The algorithm iterates over all `S_L` and, for each, maximizes `v(S_R)` subject to `w(S_R) ≤ W - w(S_L)` — which is exactly the best completion. Taking the max over all `S_L` therefore considers every feasible `S` and returns the optimum. *Complexity:* generating each half is `O(2^{n/2} · (n/2))`; sorting `R` by weight is `O(2^{n/2} · n/2)`; the prefix-max makes each `L`-query an `O(log 2^{n/2}) = O(n)` binary search, `O(2^{n/2} · n)` total. ∎

**Why it beats the table for huge `W`.** The complexity has *no* `W` factor — `W` appears only as a comparison bound. So MITM is the exact method of choice precisely in the regime where the pseudo-polynomial table fails: `n` small, `W` astronomically large. It is the exponential-in-`n` counterpart to the table's exponential-in-`log W`, and the two cover complementary regions of the `(n, log W)` plane.

**The crossover frontier.** Equating the two costs, `n·W ≈ 2^{n/2}·n`, gives `W ≈ 2^{n/2}`. Below this capacity the table wins; above it MITM wins. For `n = 40` the crossover is `W ≈ 2^{20} ≈ 10^6`; for `n = 50` it is `W ≈ 2^{25} ≈ 3·10^7`. This frontier is the precise quantitative answer to "table or meet-in-the-middle?", and it is why the senior decision tree (sibling `senior.md`) routes by *both* `n` and `W`, not either alone. Neither method dominates; they are complementary halves of the exact-algorithm toolkit, joined at `W ≈ 2^{n/2}`.

### 12.2 Where Knapsack Sits Among Related Problems

| Problem | Relation to knapsack | Complexity |
|---------|---------------------|-----------|
| Subset-sum | knapsack with `v_i = w_i` | weakly NP-hard, `O(n·t)` |
| Partition | subset-sum to `T/2` | weakly NP-hard |
| Coin change (min coins) | unbounded knapsack, minimize count | `O(n·amount)` |
| Rod cutting | unbounded knapsack on lengths | `O(n·L)` |
| Bin packing | repeated knapsack (dual) | strongly NP-hard |
| Multi-constraint knapsack | `d` capacity dims | strongly NP-hard, no FPTAS |

The unifying recurrence — pick or skip each item, accumulating an additive resource — is what makes rod cutting, coin change, and subset-sum *the same algorithm* with different objective semantics (max value / min count / Boolean reachability). The hardness *jumps* only when a second independent constraint is added (multi-dimensional) or when the problem becomes a covering/packing dual (bin packing), both of which cross from weak to strong NP-hardness and lose the FPTAS.

---

## 13. Summary

- **Optimal substructure** (Theorem 2.1): `f(i,c) = max(f(i-1,c), v_i + f(i-1, c-w_i))`, proved by the cut-and-paste argument on the residual subproblem; the constraint's *separability* is what makes DP apply.
- **Tabular correctness** (Theorem 3.1): straightforward induction on `i`; `Θ(n·W)` time. Reconstruction by the row-difference back-trace is provably optimal.
- **1D reverse-iteration** (Theorem 4.1): the descending sweep keeps both operands at their *previous-item* values (`f(i-1, ·)`), which is exactly the 0/1 recurrence; ascending would read the *new* value and silently produce unbounded knapsack (Section 5). The direction is a correctness requirement, not style.
- **NP-completeness** (Section 6): subset-sum reduces to 0/1 knapsack (`w_i = v_i = a_i`, `W = t`), and the decision problem is in NP, hence NP-complete.
- **Pseudo-polynomiality** (Section 7): `O(n·W) = O(n·2^b)` is exponential in the bit-length of `W`; knapsack is *weakly* NP-hard, polynomial only when numbers are polynomially bounded.
- **Value-indexed DP** (Section 8): the transpose, `O(n·V)`, polynomial even for astronomically large `W`; choose `min(W, V)`.
- **FPTAS** (Section 9): scale values by `K = ε v_max/n`, run value-indexed DP exactly, output true value; loses at most `ε·OPT`, runs in `O(n²/ε)`. Exists *because* of the pseudo-polynomial DP — the hallmark of weak NP-hardness.
- **Binary splitting** (Section 10): `O(log c)` chunks per item realize every count `0..c` exactly; the monotonic-deque method (Theorem 10.2) removes the `log` factor via a sliding-window-max normalization, at a larger constant.
- **Fractional / LP** (Section 11): density-sorted greedy is the LP-relaxation optimum, with integrality gap `< v_max`; it is exact for the fractional problem and a pruning bound for 0/1 branch-and-bound.
- **Meet-in-the-middle** (Section 12.1): `O(2^{n/2}·n)`, exact, `W`-independent; complementary to the table at the frontier `W ≈ 2^{n/2}`.
- **Greedy fractional** (Section 11): exchange argument proves density-sorted greedy optimal for the *fractional* relaxation; it fails for 0/1 because fractional moves are forbidden, but it gives the LP upper bound used in branch-and-bound.
- **Hardness landscape** (Section 12): the `n·W` product is conditionally tight under SETH; knapsack's weak NP-hardness is exactly the boundary property enabling the FPTAS, distinguishing it from strongly NP-hard bin-packing.

### Complexity Cheat Table

| Task | Method | Complexity | Exact? |
|------|--------|-----------|--------|
| 0/1 value | weight-indexed DP | `O(n·W)` | exact (pseudo-poly) |
| 0/1 value, small `V` | value-indexed DP | `O(n·V)` | exact (pseudo-poly) |
| 0/1, huge `W`, small `n` | meet-in-the-middle | `O(2^{n/2}·n)` | exact |
| 0/1, all large | FPTAS | `O(n²/ε)` | `(1-ε)`-approx |
| unbounded | forward-sweep DP | `O(n·W)` | exact |
| bounded | binary split / deque | `O(n·W·log c)` / `O(n·W)` | exact |
| fractional | greedy by density | `O(n log n)` | exact |
| subset-sum | Boolean DP | `O(n·t)` | exact (pseudo-poly) |

### Closing Notes

- **Optimal substructure** (Section 2) rests on the *separability* of the weight constraint; the cut-and-paste argument is the same one that fails for visited-set problems, which is the structural reason knapsack is in `FPTAS`-land while Hamiltonian-path counting is in `#P`.
- **The direction lemma** (Section 5.1): a single-item descending sweep yields `v`, ascending yields `⌊W/w⌋·v` — a precise unit test for the most common implementation bug.
- **The two pseudo-polynomial DPs** (Sections 3, 8) are axis-projections of one `(weight, value)` feasibility lattice; the FPTAS coarsens the value axis to make its projection polynomial.
- **Weak NP-hardness** (Section 7) is exactly "hard in binary, easy in unary," and it is the precondition for both the pseudo-polynomial DP and the FPTAS; strong NP-hardness (multi-dimensional knapsack, bin packing) destroys both.
- **The LP relaxation** (Section 11) equals the greedy fractional optimum, has integrality gap `< v_max`, and supplies the bound that makes exact branch-and-bound practical on instances where the table is infeasible.
- **The (max, +) idempotency** (Section 12) keeps knapsack values bounded by `Σ v_i` — no modulus ever needed — unlike the geometrically exploding counting semiring of walk-counting; knapsack's difficulty is combinatorial (which subset), not numeric (overflow).

The single thread through all of it: every algorithm in this topic is a response to *which numeric parameter is small*. Optimal substructure (Section 2) makes the DP possible; weak NP-hardness (Section 7) makes it pseudo-polynomial and the FPTAS possible; the LP relaxation (Section 11) bounds the exact search; and the hardness landscape (Section 12) marks exactly where — at a second constraint — all of this tractability evaporates.

Foundational references: Karp (1972) for NP-completeness of subset-sum/knapsack; Garey & Johnson, *Computers and Intractability*, for weak vs strong NP-hardness and the FPTAS-existence theorem; Ibarra & Kim (1975) and Lawler (1979) for the knapsack FPTAS; Vazirani, *Approximation Algorithms*, Ch. 8 for the FPTAS exposition; Horowitz & Sahni (1974) for meet-in-the-middle; Pisinger (1997, 1999) for expanding-core exact algorithms and the balanced-knapsack DP; Kellerer, Pferschy & Pisinger, *Knapsack Problems*, for the comprehensive treatment; and fine-grained lower bounds (Künnemann-Paturi-Schneider, Abboud et al.) for the conditional tightness of `n·W`. Sibling topics: `13-dynamic-programming` (the DP framework), `14-greedy-algorithms` (the fractional exchange argument), and `stack-queue-patterns` (the monotonic deque used in Theorem 10.2).
