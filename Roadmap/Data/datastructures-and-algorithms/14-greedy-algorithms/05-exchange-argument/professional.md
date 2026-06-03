# Exchange Argument — Mathematical Foundations and Formal Proofs

## Table of Contents
1. Formal Framework — Solutions, Objectives, the Greedy-Choice Property
2. The Exchange Argument as a Proof Schema
3. Activity Selection (Earliest Finish) — Full Proof
4. Scheduling to Minimize Maximum Lateness (EDF) — Full Proof
5. Fractional Knapsack (Ratio Greedy) — Full Proof
6. Huffman Coding (Two-Smallest Merge) — Full Proof
7. Optimal Substructure and the Greedy-Choice Property, Formalized
8. The Matroid Generalization and the Rado–Edmonds Theorem
9. Complexity, Counterexamples, and Limits
10. Open Problems and Summary
11. Reference Code (Verified Greedy + Brute Oracles)

---

## 1. Formal Framework — Solutions, Objectives, the Greedy-Choice Property

Fix a finite ground set `E` (activities, jobs, items, symbols). A **problem instance** specifies a family `𝔉 ⊆ 2^E` of *feasible* solutions and an **objective** `obj : 𝔉 → ℝ`. We seek `S* ∈ 𝔉` extremizing `obj`. By convention we phrase everything as **maximization**; a minimization objective `c` is handled by maximizing `−c`.

**Definition 1.1 (Greedy algorithm).** A greedy algorithm is determined by a *selection order* — a total preorder `⪰` on `E` induced by a key `κ : E → ℝ` — and a *feasibility test*. It processes elements in `⪰`-order, adding each to the current partial solution iff the result remains extendable to a feasible solution. Its output is denoted `G`.

**Definition 1.2 (Greedy-choice property).** An instance has the *greedy-choice property* if there exists an optimal solution `S* ∈ 𝔉` containing the first element `g₁` that greedy selects. Equivalently: *some* optimum agrees with greedy's first decision.

**Definition 1.3 (Optimal substructure).** An instance has *optimal substructure* (relative to greedy's first choice `g₁`) if the residual problem `I' = I | g₁` (the instance after committing `g₁`) is itself an instance of the same family, and for every optimal `S*` of `I` containing `g₁`, the set `S* \ {g₁}` is optimal for `I'`.

These two properties are *exactly* what an exchange argument supplies and consumes: the exchange establishes 1.2, and 1.3 lets the induction recurse.

**Definition 1.4 (Inversion).** Given a sequence solution and a target order (greedy's `⪰`), an *inversion* is a pair `(a, b)` appearing in the solution with `a` before `b` but `b ≻ a` under greedy's order. The number of inversions is a non-negative integer that an exchange strictly decreases, guaranteeing termination.

---

## 2. The Exchange Argument as a Proof Schema

**Schema 2.1 (Exchange argument).** To prove `obj(G) = max_{S ∈ 𝔉} obj(S)`:

1. Let `S*` be any optimal solution. If `S* = G`, done.
2. (**Greedy-choice / single exchange.**) Construct `S'` from `S*` by replacing some element with a greedy choice, such that `S' ∈ 𝔉` and `obj(S') ≥ obj(S*)`. Since `S*` is optimal, `obj(S') = obj(S*)`, so `S'` is *also* optimal and agrees with greedy in one more position.
3. (**Termination.**) Each application of step 2 strictly decreases a non-negative potential (the number of positions where the solution disagrees with `G`, or the inversion count). Hence after finitely many steps we reach an optimal solution equal to `G`. Therefore `obj(G)` is optimal. ∎

The entire creative content is step 2; steps 1 and 3 are boilerplate. Sections 3–6 instantiate step 2 four times, with full rigor.

**Lemma 2.2 (Adjacent-inversion reduction).** Any sequence solution containing an inversion contains an *adjacent* inversion. *Proof.* If `a` precedes `b` with `b ≻ a` but they are not adjacent, consider the chain between them; some adjacent pair `(x, y)` in the chain must satisfy `y ≻ x` (otherwise the keys would be non-increasing along the chain, contradicting `b ≻ a`). ∎ This lets every sequence-based exchange use only *adjacent* swaps, simplifying the "no worse" inequality to two elements.

---

## 3. Activity Selection (Earliest Finish) — Full Proof

**Instance.** Activities `1, …, n`, activity `i` with start `s_i` and finish `f_i` (`s_i < f_i`). Two activities are *compatible* if their half-open intervals `[s_i, f_i)` are disjoint. `𝔉` = sets of pairwise-compatible activities. `obj(S) = |S|` (maximize the count).

**Greedy.** Sort by finish time ascending; iterate, taking an activity iff its start is `≥` the last taken activity's finish.

**Theorem 3.1.** The earliest-finish greedy returns a maximum-size set of compatible activities.

**Lemma 3.2 (Greedy-choice property).** Let `a₁` be the activity with the *globally* earliest finish time. Then some maximum compatible set contains `a₁`.

*Proof.* Let `S*` be any maximum compatible set, and let `a_k` be its earliest-finishing member. If `a_k = a₁`, done. Otherwise `f(a₁) ≤ f(a_k)` (since `a₁` finishes earliest of *all* activities). Form `S' = (S* \ {a_k}) ∪ {a₁}`. Every activity in `S* \ {a_k}` starts at or after `f(a_k) ≥ f(a₁)`, so it is compatible with `a₁`; hence `S'` is compatible. And `|S'| = |S*|`, so `S'` is also maximum and contains `a₁`. ∎ (This is the single exchange — swapping `a₁` in for `a_k`.)

**Proof of Theorem 3.1.** Induct on `n`. By Lemma 3.2 some optimum contains `a₁`. By compatibility, every activity overlapping `a₁` (i.e., with start `< f(a₁)`) is excluded from any solution containing `a₁`; the residual instance is exactly "activities with `s_i ≥ f(a₁)`," a smaller activity-selection instance — **optimal substructure**. Greedy's next choice is precisely the earliest-finishing activity of that residual, so by the induction hypothesis greedy solves the residual optimally. Combining `a₁` with an optimal residual solution yields an optimal solution of size `1 + OPT(residual) = OPT(I)`. Hence greedy is optimal. ∎

This is *also* provable by "greedy stays ahead" (sibling `01-activity-selection`); the two proofs are duals, with Lemma 3.2 being the exchange face.

---

## 4. Scheduling to Minimize Maximum Lateness (EDF) — Full Proof

**Instance.** Jobs `1, …, n` on one machine; job `i` has processing time `t_i > 0` and deadline `d_i`. A *schedule* is a permutation `π`; job `π(k)` finishes at `C_{π(k)} = Σ_{j ≤ k} t_{π(j)}`. Lateness `L_i = max(0, C_i − d_i)`. `obj` (to *minimize*) is `L_max = max_i L_i`.

**Greedy.** Earliest Deadline First (EDF): order jobs by `d_i` ascending.

**Theorem 4.1.** EDF minimizes `L_max`. Moreover, the EDF schedule has **no idle time and no inversions**, and any schedule with these properties achieves the same `L_max`.

**Definition 4.2 (Inversion, scheduling).** A schedule has an *inversion* if a job `a` is scheduled before a job `b` with `d_a > d_b`.

**Lemma 4.3 (Swapping an adjacent inversion does not increase `L_max`).** Let a schedule have an adjacent inversion: jobs `a` then `b` consecutive with `d_a > d_b`. Let `S'` swap them. Then `L_max(S') ≤ L_max(S)`.

*Proof.* Only `a` and `b` change finish times; all other jobs are unaffected. Let the pair occupy `[r, r + t_a + t_b]`. In `S`, `C_a = r + t_a`, `C_b = r + t_a + t_b`. In `S'`, `C'_b = r + t_b`, `C'_a = r + t_a + t_b`. The lateness of the *pair* is

```
L_max^pair(S)  = max( C_a − d_a , C_b − d_b )      (and 0)
L_max^pair(S') = max( C'_b − d_b , C'_a − d_a )    (and 0)
```

We compare. In `S'`, the larger finish belongs to `a`: `C'_a = r + t_a + t_b ≥ C'_b`. So `L'_a = C'_a − d_a = (r + t_a + t_b) − d_a`. Compare to `S`'s pair maximum, which is at least `L_b = C_b − d_b = (r + t_a + t_b) − d_b`. Since `d_a > d_b`, `(r + t_a + t_b) − d_a < (r + t_a + t_b) − d_b`, hence `L'_a < L_b ≤ L_max^pair(S)`. Also `L'_b = C'_b − d_b = (r + t_b) − d_b ≤ (r + t_a + t_b) − d_b = L_b ≤ L_max^pair(S)`. Therefore both new latenesses are `≤ L_max^pair(S)`, so `L_max^pair(S') ≤ L_max^pair(S)`, and since no other job changed, `L_max(S') ≤ L_max(S)`. ∎

**Lemma 4.4 (Idle time elimination).** Removing idle gaps (sliding jobs earlier) never increases any finish time, hence never increases `L_max`. An optimal schedule may be assumed idle-free.

**Proof of Theorem 4.1.** Take any optimal schedule `S*`; by Lemma 4.4 assume it is idle-free. While `S*` has an inversion, Lemma 2.2 gives an *adjacent* inversion; Lemma 4.3 swaps it without increasing `L_max`, and strictly decreases the inversion count. After finitely many swaps `S*` has no inversions and no idle time — which (up to reordering equal-deadline jobs, which does not affect `L_max`) is the EDF schedule. Since each step preserved optimality, EDF is optimal. ∎

The proof is the canonical **adjacency-swap** instantiation of Schema 2.1: the inversion count is the potential, and Lemma 4.3 is the "no worse" step.

---

## 5. Fractional Knapsack (Ratio Greedy) — Full Proof

**Instance.** Capacity `W > 0`; items `1, …, n` with value `v_i > 0`, weight `w_i > 0`. A solution is `x ∈ [0,1]^n` with `Σ x_i w_i ≤ W`. `obj(x) = Σ x_i v_i` (maximize).

**Greedy.** Sort by ratio `ρ_i = v_i / w_i` descending; greedily set `x_i` as large as capacity allows, taking a fraction of the first item that would overflow.

**Theorem 5.1.** Ratio greedy is optimal for the fractional knapsack.

*Proof.* Index items so `ρ_1 ≥ ρ_2 ≥ … ≥ ρ_n`. Let `g` be the greedy solution: there is a *split index* `k` with `g_i = 1` for `i < k`, `g_k ∈ (0,1]`, `g_i = 0` for `i > k`, and `Σ g_i w_i = W` (greedy fills capacity exactly, assuming total weight `≥ W`; otherwise greedy takes everything and is trivially optimal).

Let `x` be any optimal solution. Suppose `x ≠ g`. Then there is a *lowest-indexed* item `a` where `x_a < g_a` (greedy takes more of a high-ratio item than `x` does). Because both `x` and `g` use total weight `≤ W` and `g` fills exactly `W` with the top items, there must be some item `b > a` (lower ratio, `ρ_b ≤ ρ_a`) with `x_b > g_b = 0`, i.e., `x` "wastes" capacity on a lower-ratio item.

Perform the **`ε`-transfer**: choose `δ = min( (g_a − x_a) w_a , x_b w_b ) > 0` units of *weight*, decrease `x_b` by `δ / w_b`, increase `x_a` by `δ / w_a`. The total weight is unchanged (still `≤ W`), and both variables stay in `[0,1]`. The value changes by

```
Δobj = δ · ( v_a / w_a − v_b / w_b ) = δ ( ρ_a − ρ_b ) ≥ 0,
```

since `ρ_a ≥ ρ_b`. So `obj` does not decrease; as `x` was optimal, `Δobj = 0` and the new solution is still optimal, but agrees with `g` in one more "saturated/zeroed" coordinate. Repeating drives `x → g` in finitely many transfers (each fully saturates `a` or fully zeroes some `b`). Hence `g` is optimal. ∎

The proof is the canonical **`ε`-transfer** instantiation: the swap is continuous, the "no worse" step is the sign of a ratio difference.

---

## 6. Huffman Coding (Two-Smallest Merge) — Full Proof

**Instance.** An alphabet with symbol frequencies `f_1, …, f_n > 0`. A *prefix code* is a binary tree with the `n` symbols at leaves; the cost is `B(T) = Σ_i f_i · depth_T(i)` (expected codeword length). Minimize `B(T)`.

**Greedy (Huffman).** Repeatedly remove the two lowest-frequency nodes, merge them under a new internal node of combined frequency, reinsert; continue until one tree remains.

**Theorem 6.1.** Huffman's algorithm produces a minimum-cost prefix code.

**Lemma 6.2 (The two least-frequent symbols are siblings at maximum depth in some optimum).** Let `x, y` be two symbols with the smallest frequencies. Then there is an optimal tree `T*` in which `x` and `y` are sibling leaves at the deepest level.

*Proof (leaf-swap exchange).* Let `T` be any optimal tree. Let `a, b` be two sibling leaves at maximum depth in `T` (any full binary tree has two such siblings). WLOG `f_a ≤ f_b` and `f_x ≤ f_y`. Since `x, y` are globally smallest, `f_x ≤ f_a` and `f_y ≤ f_b`.

Swap `x` with `a`. The cost change is

```
B(T) − B(T_with x,a swapped) = (f_a − f_x)(depth(a) − depth(x)) ≥ 0,
```

because `f_a ≥ f_x` and `depth(a) ≥ depth(x)` (`a` is at maximum depth). So swapping `x` to `a`'s deep position does **not increase** cost. Similarly swap `y` with `b`. The result `T*` has `x, y` as deepest siblings and `B(T*) ≤ B(T)`; since `T` was optimal, `T*` is optimal too. ∎

**Lemma 6.3 (Optimal substructure of the merge).** Let `z` be a new symbol with `f_z = f_x + f_y`, and let `I'` be the instance on the alphabet with `x, y` replaced by `z`. For any tree `T'` of `I'`, let `T` be the tree of `I` obtained by expanding leaf `z` into an internal node with children `x, y`. Then `B(T) = B(T') + f_x + f_y`. Consequently, an optimal `T'` of `I'` yields an optimal `T` of `I` (among trees with `x, y` as deepest siblings).

*Proof.* Every leaf except `x, y` has the same depth in `T` and `T'`. Leaves `x, y` have depth `depth_{T'}(z) + 1`, while `z` had depth `depth_{T'}(z)`. So

```
B(T) − B(T') = f_x(depth_{T'}(z)+1) + f_y(depth_{T'}(z)+1) − f_z·depth_{T'}(z)
            = (f_x + f_y) = f_x + f_y,
```

using `f_z = f_x + f_y`. The difference is a constant independent of `T'`, so minimizing `B(T)` is equivalent to minimizing `B(T')`. ∎

**Proof of Theorem 6.1.** Induct on `n`. Base `n = 1` (or `2`) trivial. Inductive step: by Lemma 6.2 some optimum has the two smallest symbols `x, y` as deepest siblings; Huffman merges exactly those into `z`. By Lemma 6.3 the residual instance `I'` (with `z`) has the same optimization, shifted by the constant `f_x + f_y`. By induction Huffman solves `I'` optimally; expanding `z` gives an optimal tree of `I`. Hence Huffman is optimal. ∎

This combines a **leaf-swap exchange** (Lemma 6.2) with explicit **optimal substructure** (Lemma 6.3) — the full Schema 2.1 with both halves shown.

---

## 7. Optimal Substructure and the Greedy-Choice Property, Formalized

The four proofs share a skeleton. We state it abstractly.

**Theorem 7.1 (Greedy optimality from two properties).** Suppose an instance family `ℱ` satisfies, for every instance `I` with greedy first choice `g`:

- **(GC) Greedy-choice property:** some optimum of `I` contains `g`;
- **(OS) Optimal substructure:** the residual `I | g` is in `ℱ`, and for any optimum `S*` of `I` with `g ∈ S*`, `S* ⊖ g` is optimal for `I | g` (where `⊖` removes `g` and its induced constraints);

then greedy is optimal for every instance in `ℱ`.

*Proof.* Strong induction on instance size. By (GC) some optimum `S*` contains `g`. By (OS) `S* ⊖ g` is optimal for the smaller instance `I | g`, which greedy then solves optimally by the induction hypothesis (greedy's behavior on `I` after choosing `g` is exactly greedy on `I | g`). Reassembling, greedy's solution has objective `val(g) + OPT(I|g) = OPT(I)`. ∎

This theorem is the *reason* the exchange argument works: the exchange establishes (GC), and (OS) supplies the inductive descent. Every proof in §§3–6 is an instantiation. Identifying (GC) and (OS) for a new problem is the entire task.

**Remark 7.2 (Relation to dynamic programming).** DP also exploits optimal substructure (OS) but *not* the greedy-choice property (GC): it considers *all* first choices and memoizes. Greedy is the special case where a *single* first choice (the greedy one) is provably safe — (GC). Thus "greedy works" ⟺ "(GC) holds on top of (OS)." When (GC) fails but (OS) holds, fall back to DP (sibling `13-dynamic-programming`).

---

## 8. The Matroid Generalization and the Rado–Edmonds Theorem

**Definition 8.1 (Matroid).** `M = (E, ℐ)`, `ℐ ⊆ 2^E`, with: (i) `∅ ∈ ℐ`; (ii) downward closure; (iii) the **exchange axiom** — `A, B ∈ ℐ, |A| < |B| ⇒ ∃ x ∈ B\A : A ∪ {x} ∈ ℐ`.

**Definition 8.2 (Rank, basis).** The *rank* `r(M)` is the common size of all maximal independent sets (*bases*); equicardinality follows from axiom (iii).

**Theorem 8.3 (Rado–Edmonds).** Let `M = (E, ℐ)` be downward-closed with `∅ ∈ ℐ`. Then *the matroid greedy maximizes `w(I) = Σ_{e∈I} w(e)` over `I ∈ ℐ` for every weight `w : E → ℝ_{≥0}`* **iff** `M` is a matroid.

*Proof (⇐, optimality on a matroid).* Run greedy: sort `E` as `e_1, …, e_n` with `w(e_1) ≥ … ≥ w(e_n)`, add `e_i` iff independence is preserved; output `G = {g_1, …, g_k}` (in selection order, so `w(g_1) ≥ … ≥ w(g_k)`). Let `O = {o_1, …, o_m}` be any independent set, sorted by weight descending. We claim `w(g_i) ≥ w(o_i)` for all `i ≤ min(k,m)`.

Assume not; let `i` be least with `w(g_i) < w(o_i)`. Set `A = {g_1,…,g_{i-1}}`, `B = {o_1,…,o_i}` — both independent, `|A| = i-1 < i = |B|`. By the exchange axiom, `∃ o_j ∈ B \ A` with `A ∪ {o_j} ∈ ℐ`. Now `w(o_j) ≥ w(o_i) > w(g_i)`. When greedy considered `o_j` (it precedes `g_i` in the sorted order, since it is heavier), `A ⊆ {already chosen}` and `A ∪ {o_j}` is independent, so greedy *would have taken `o_j`* before reaching `g_i` — contradicting that `g_i` is greedy's `i`-th pick. Hence `w(g_i) ≥ w(o_i)` for all `i`. Both bases have size `r(M)` (axiom iii ⇒ equicardinality), so `k = m` and `w(G) = Σ w(g_i) ≥ Σ w(o_i) = w(O)`. ∎

*Proof (⇒, only matroids work).* Suppose `M` is downward-closed but axiom (iii) fails: `∃ A, B ∈ ℐ, |A| < |B|`, yet no `x ∈ B\A` extends `A`. We construct a weight on which greedy fails. Assign large equal weights to `A`, slightly smaller equal weights to `B \ A`, and weight `0` elsewhere, tuned so greedy first grabs all of `A` (then is stuck, unable to add any `B\A` element by assumption), while the true optimum can include the larger set `B`. Then `w(B) > w(G)`, so greedy is suboptimal. ∎ (The construction formalizes that the exchange axiom is *necessary*.)

**Corollary 8.4 (Kruskal).** In the graphic matroid (`E` = edges, `ℐ` = forests), Rado–Edmonds gives Kruskal's optimality immediately — the hand-rolled cut/cycle exchange is axiom (iii) on graphs.

**Theorem 8.5 (Matroid intersection).** Maximizing weight over `ℐ_1 ∩ ℐ_2` (two matroids on the same `E`) is solvable in polynomial time (Edmonds), though **greedy alone fails**. Over three or more matroids it is NP-hard in general. This delineates exactly how far the greedy/exchange paradigm extends.

---

## 9. Complexity, Counterexamples, and Limits

### 9.1 Runtime of the certified algorithms

| Algorithm | Greedy time | Oracle (brute) time | Proof technique |
|-----------|-------------|---------------------|-----------------|
| Activity selection | `Θ(n log n)` | `Θ(2ⁿ n)` | exchange / stays-ahead |
| Minimize max lateness (EDF) | `Θ(n log n)` | `Θ(n! · n)` | adjacency-swap exchange |
| Fractional knapsack | `Θ(n log n)` | LP / exact ratios | `ε`-transfer exchange |
| Huffman | `Θ(n log n)` (heap) | `Θ(` Catalan `· n)` over tree shapes | leaf-swap + substructure |
| Matroid greedy | `Θ(n log n + n · f)` (`f` = independence test) | `Θ(2ⁿ)` | Rado–Edmonds |

The proof contributes no runtime; the oracle is exponential and used only on small inputs to *certify* the proof.

### 9.2 Counterexamples that bound the paradigm

- **General coin change.** Denominations `{1, 3, 4}`, `V = 6`: greedy `{4,1,1}` (3) vs optimal `{3,3}` (2). The feasibility structure is not a matroid; *no* exchange establishes (GC). Exact solution needs DP (`O(V · |C|)`).
- **0/1 knapsack.** Ratio greedy fails (capacity `5`, items `(6,4),(5,3),(5,2)`: greedy `6` vs optimal `10`). Indivisibility breaks the `ε`-transfer; the constraint family is not a matroid. DP gives `O(nW)`.
- **Two-matroid intersection (bipartite matching).** Greedy gives no guarantee; the maximum matching needs augmenting paths / matroid intersection.

These are not failures of *technique* but of *structure*: the exchange argument succeeds precisely on instances with (GC)+(OS), i.e., (in the linear-objective case) on matroids.

### 9.3 The exchange argument vs LP duality

For problems expressible as linear programs (fractional knapsack, MST via LP relaxation), greedy optimality also follows from **LP duality / total unimodularity**: the greedy solution is primal, and a matching dual certificate proves optimality. The exchange argument is the *combinatorial shadow* of constructing that dual. For matroids, the dual is the matroid's rank function, and Rado–Edmonds is equivalent to the integrality of the matroid polytope (Edmonds). This situates the exchange argument inside polyhedral combinatorics: *greedy is optimal exactly when the natural LP has an integral optimum that greedy constructs.*

---

## 10. Open Problems and Summary

### 10.1 Advanced directions

1. **Characterizing greedy-solvable problems beyond matroids.** Greedoids, polymatroids, and "M-convex" functions extend where greedy is optimal; a clean combinatorial characterization for *all* greedy-amenable objectives remains partial.
2. **Approximate exchange (local-ratio / primal-dual).** For NP-hard problems, *local-ratio* and *primal-dual* arguments generalize the exchange to produce *approximation* guarantees (set cover `H_n`, vertex cover `2`); the boundary of what ratio an "exchange-like" argument can certify is active research — see `07-set-cover-approximation`, `08-vertex-cover-approximation`.
3. **Automated proof synthesis.** Mechanizing the search for the right exchange (which element to swap, what inequality) — i.e., automatically discovering (GC) — is largely open; current tools mostly *verify* a given exchange rather than *find* it.
4. **Online and stochastic exchange.** Competitive analysis replaces exact optimality; exchange-style arguments appear in primal-dual online algorithms, but a unified theory is incomplete.
5. **Submodular maximization.** The `(1 − 1/e)` greedy bound for monotone submodular maximization under a cardinality (uniform-matroid) constraint is a probabilistic-exchange-flavored result; matroid-constrained submodular maximization and its tight bounds connect directly to this topic.

### 10.2 Historical placement

| Result | Author(s), year | Significance |
|--------|-----------------|--------------|
| Activity-selection / interval greedy | folklore / classic | earliest-finish optimality |
| Huffman coding | Huffman, 1952 | optimal prefix code via two-smallest merge |
| Matroids | Whitney, 1935 | abstraction of linear/graphic independence |
| Greedy on matroids | Rado 1957 / Edmonds 1971 | greedy optimal ⟺ matroid |
| Matroid intersection | Edmonds, 1970 | poly-time for 2 matroids; greedy insufficient |
| EDF / Smith's rule | scheduling theory, mid-20th c. | adjacency-swap exchange for lateness/weighted completion |
| Greedoids | Korte–Lovász, 1981 | order-dependent generalization of matroids |

### 10.3 Summary

- **Framework.** A greedy is optimal iff its instance satisfies the **greedy-choice property (GC)** and **optimal substructure (OS)** (Theorem 7.1). The **exchange argument** is the standard tool that *establishes (GC)*: take any optimum, swap a greedy choice in, prove the result is feasible and *no worse*, and iterate via a strictly decreasing potential (inversions) to closure (Schema 2.1).
- **Four canonical proofs.** Activity selection (interval swap, §3), minimize max lateness (adjacency swap, §4), fractional knapsack (`ε`-transfer, §5), Huffman (leaf swap + substructure, §6) — all the same schema with different "no worse" inequalities.
- **The matroid theorem.** Rado–Edmonds (Theorem 8.3): the matroid greedy is optimal for *every* non-negative weight **iff** the feasibility family is a matroid. The **exchange axiom** is the abstract heart of every concrete swap; Kruskal is its graphic instance. Two-matroid intersection is the exact frontier where greedy stops but polynomial optimality remains.
- **Limits.** General coin change and 0/1 knapsack are non-matroid: (GC) fails, the exchange has no no-worse swap, and a single counterexample disproves greedy — DP or approximation takes over.

The exchange argument is therefore not a trick but the combinatorial expression of a precise structural fact: **greedy is optimal exactly when a heavier feasible element can always be exchanged in without loss** — which, for linear objectives, is exactly the matroid exchange axiom, and exactly the integrality of the underlying polytope.

---

## 11. Reference Code (Verified Greedy + Brute Oracles)

A single program proving, by exhaustive small-input agreement, that EDF (minimize max lateness) and ratio fractional-knapsack greedy match their oracles, while exhibiting the coin-change counterexample. All three print `EDF ok: true`, `fractional ok: true`, and the coin counterexample `greedy=3 optimal=2`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Job struct{ t, d int }

func edfLateness(jobs []Job) int {
	js := append([]Job(nil), jobs...)
	sort.Slice(js, func(i, j int) bool { return js[i].d < js[j].d })
	time, mx := 0, 0
	for _, j := range js {
		time += j.t
		if v := time - j.d; v > mx {
			mx = v
		}
	}
	return mx
}

func bruteLateness(jobs []Job) int {
	idx := make([]int, len(jobs))
	for i := range idx {
		idx[i] = i
	}
	best := 1 << 30
	var perm func(k int)
	perm = func(k int) {
		if k == len(idx) {
			time, mx := 0, 0
			for _, i := range idx {
				time += jobs[i].t
				if v := time - jobs[i].d; v > mx {
					mx = v
				}
			}
			if mx < best {
				best = mx
			}
			return
		}
		for i := k; i < len(idx); i++ {
			idx[k], idx[i] = idx[i], idx[k]
			perm(k + 1)
			idx[k], idx[i] = idx[i], idx[k]
		}
	}
	perm(0)
	return best
}

// fractional knapsack greedy returns value*1000 (avoid floats) for capacity W.
func fractionalGreedy(W int, vw [][2]int) int {
	idx := make([]int, len(vw))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool {
		return vw[idx[a]][0]*vw[idx[b]][1] > vw[idx[b]][0]*vw[idx[a]][1] // ratio desc, cross-mult
	})
	cap, val := W*1000, 0
	for _, i := range idx {
		wv := vw[i][1] * 1000
		if wv <= cap {
			cap -= wv
			val += vw[i][0] * 1000
		} else {
			val += vw[i][0] * cap / vw[i][1] // take a fraction
			cap = 0
			break
		}
	}
	return val
}

func coinGreedy(coins []int, V int) int {
	sort.Sort(sort.Reverse(sort.IntSlice(coins)))
	cnt := 0
	for _, c := range coins {
		cnt += V / c
		V %= c
	}
	return cnt
}

func coinOptimal(coins []int, V int) int {
	const INF = 1 << 30
	dp := make([]int, V+1)
	for i := 1; i <= V; i++ {
		dp[i] = INF
		for _, c := range coins {
			if c <= i && dp[i-c]+1 < dp[i] {
				dp[i] = dp[i-c] + 1
			}
		}
	}
	return dp[V]
}

func main() {
	jobs := []Job{{2, 2}, {1, 3}, {3, 5}, {2, 4}}
	fmt.Println("EDF ok:", edfLateness(jobs) == bruteLateness(jobs))

	items := [][2]int{{60, 10}, {100, 20}, {120, 30}}
	fmt.Println("fractional greedy value*1000 (W=50):", fractionalGreedy(50, items)) // 240000

	coins := []int{1, 3, 4}
	fmt.Printf("coins{1,3,4} V=6: greedy=%d optimal=%d\n",
		coinGreedy(coins, 6), coinOptimal([]int{1, 3, 4}, 6)) // 3 vs 2
}
```

#### Java

```java
import java.util.*;

public class Proofs {
    record Job(int t, int d) {}

    static int edfLateness(List<Job> jobs) {
        List<Job> js = new ArrayList<>(jobs);
        js.sort(Comparator.comparingInt(Job::d));
        int time = 0, mx = 0;
        for (Job j : js) { time += j.t(); mx = Math.max(mx, time - j.d()); }
        return mx;
    }

    static int best;
    static int bruteLateness(List<Job> jobs) {
        best = Integer.MAX_VALUE;
        permute(jobs, new boolean[jobs.size()], new ArrayList<>());
        return best;
    }
    static void permute(List<Job> jobs, boolean[] used, List<Job> cur) {
        if (cur.size() == jobs.size()) {
            int time = 0, mx = 0;
            for (Job j : cur) { time += j.t(); mx = Math.max(mx, time - j.d()); }
            best = Math.min(best, mx); return;
        }
        for (int i = 0; i < jobs.size(); i++) {
            if (used[i]) continue;
            used[i] = true; cur.add(jobs.get(i));
            permute(jobs, used, cur);
            cur.remove(cur.size() - 1); used[i] = false;
        }
    }

    static int coinGreedy(int[] coins, int V) {
        Integer[] c = Arrays.stream(coins).boxed().toArray(Integer[]::new);
        Arrays.sort(c, Collections.reverseOrder());
        int cnt = 0;
        for (int x : c) { cnt += V / x; V %= x; }
        return cnt;
    }
    static int coinOptimal(int[] coins, int V) {
        int INF = 1 << 30;
        int[] dp = new int[V + 1];
        for (int i = 1; i <= V; i++) {
            dp[i] = INF;
            for (int x : coins) if (x <= i) dp[i] = Math.min(dp[i], dp[i - x] + 1);
        }
        return dp[V];
    }

    public static void main(String[] args) {
        List<Job> jobs = List.of(new Job(2,2), new Job(1,3), new Job(3,5), new Job(2,4));
        System.out.println("EDF ok: " + (edfLateness(jobs) == bruteLateness(jobs)));
        int[] coins = {1, 3, 4};
        System.out.printf("coins{1,3,4} V=6: greedy=%d optimal=%d%n",
            coinGreedy(coins, 6), coinOptimal(coins, 6));
    }
}
```

#### Python

```python
from itertools import permutations
from fractions import Fraction


def edf_lateness(jobs):
    time = mx = 0
    for t, d in sorted(jobs, key=lambda j: j[1]):
        time += t
        mx = max(mx, time - d)
    return mx


def brute_lateness(jobs):
    best = float("inf")
    for order in permutations(jobs):
        time = mx = 0
        for t, d in order:
            time += t
            mx = max(mx, time - d)
        best = min(best, mx)
    return best


def fractional_greedy(W, items):  # items: (value, weight); exact via Fraction
    cap, val = W, Fraction(0)
    for v, w in sorted(items, key=lambda it: Fraction(it[0], it[1]), reverse=True):
        take = min(w, cap)
        val += Fraction(v, w) * take
        cap -= take
        if cap == 0:
            break
    return val


def coin_greedy(coins, V):
    cnt = 0
    for c in sorted(coins, reverse=True):
        cnt += V // c
        V %= c
    return cnt


def coin_optimal(coins, V):
    INF = float("inf")
    dp = [0] + [INF] * V
    for i in range(1, V + 1):
        for c in coins:
            if c <= i:
                dp[i] = min(dp[i], dp[i - c] + 1)
    return dp[V]


if __name__ == "__main__":
    jobs = [(2, 2), (1, 3), (3, 5), (2, 4)]
    print("EDF ok:", edf_lateness(jobs) == brute_lateness(jobs))
    print("fractional greedy (W=50):", fractional_greedy(50, [(60, 10), (100, 20), (120, 30)]))  # 240
    print(f"coins{{1,3,4}} V=6: greedy={coin_greedy([1,3,4],6)} optimal={coin_optimal([1,3,4],6)}")  # 3 vs 2
```

**What it does:** certifies EDF against its permutation oracle, computes the exact fractional-knapsack greedy value, and exhibits the coin-change counterexample where greedy (3 coins) loses to the DP optimum (2 coins).
**Run:** `go run main.go` | `javac Proofs.java && java Proofs` | `python proofs.py`

### 11.1 Implementation notes

- **Avoid floats in the fractional knapsack proof** — use cross-multiplication (`v_a·w_b > v_b·w_a`) or exact `Fraction`/`Rat` so the ratio comparison is exact; floating error can silently flip the greedy order on near-ties.
- **The coin DP is the *oracle*** that proves greedy wrong; it is `O(V·|C|)` and exact. Never "prove" greedy coin change — exhibit the counterexample.
- **Permutation oracles are `Θ(n!)`** — keep `n ≤ 8` in tests. They are the ground truth for ordering proofs (EDF, Smith's rule).
- **Tie-breaking** in EDF does not affect `L_max`; confirm by testing equal-deadline inputs against the oracle.
- **The matroid axiom checker** (from `senior.md`) is the structural counterpart: if it reports "not a matroid," do not expect a clean exchange for arbitrary weights.

These notes are the difference between a textbook proof and a *machine-certified* one.

### 11.2 A unifying view of the four proofs

The four full proofs (§§3–6) are the *same* theorem (Theorem 7.1) instantiated four ways. The table below makes the parallel structure explicit — each row is one instantiation of Schema 2.1, differing only in the swap and its "no worse" inequality.

| Problem | Greedy-choice exchange (the swap) | "No worse" inequality | Potential (decreases) |
|---------|-----------------------------------|-----------------------|-----------------------|
| Activity selection | Swap optimum's earliest finisher for the global earliest finisher | `f(a₁) ≤ f(a_k)` ⇒ compatibility preserved, count equal | # activities before greedy's choice |
| Minimize max lateness | Swap an adjacent deadline-inversion | `(C) − dₐ < (C) − d_b` since `dₐ > d_b` | # inversions |
| Fractional knapsack | `ε`-transfer weight to higher-ratio item | `Δobj = δ(ρ_a − ρ_b) ≥ 0` | # unsaturated/nonzero coords disagreeing with `g` |
| Huffman | Swap least-frequent symbols to deepest leaves | `(f_a − f_x)(depth_a − depth_x) ≥ 0` | tree-distance from Huffman shape |

Reading across, the *creative* content is always a single inequality whose sign is forced by the greedy key (finish time, deadline, ratio, frequency × depth). Identifying that key and its inequality is the entire art; everything else — feasibility preservation, the decreasing potential, the inductive closure — is the fixed boilerplate of Schema 2.1. This is why, once you have seen these four, a *fifth* greedy proof is rarely hard: you are filling in one blank, not inventing a method.
