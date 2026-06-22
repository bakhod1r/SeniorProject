# Approximation Algorithms and Hardness — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Precise Definitions: The Approximation Ratio](#precise-definitions-the-approximation-ratio)
3. [Absolute vs Relative Approximation](#absolute-vs-relative-approximation)
4. [The Approximation-Class Hierarchy: FPTAS ⊆ PTAS ⊆ APX ⊆ NPO](#the-approximation-class-hierarchy-fptas--ptas--apx--npo)
5. [Proof 1 — Vertex Cover: 2-Approximation via Maximal Matching](#proof-1--vertex-cover-2-approximation-via-maximal-matching)
6. [Proof 2 — Set Cover: The Greedy Hₙ ≈ ln n Bound](#proof-2--set-cover-the-greedy-hn--ln-n-bound)
7. [Proof 3 — Metric TSP: MST-Doubling 2-Approximation](#proof-3--metric-tsp-mst-doubling-2-approximation)
8. [Proof 4 — Load Balancing: Greedy 2-Approx and LPT 4/3](#proof-4--load-balancing-greedy-2-approx-and-lpt-43)
9. [PTAS and FPTAS via Knapsack](#ptas-and-fptas-via-knapsack)
10. [A First Taste of Hardness of Approximation](#a-first-taste-of-hardness-of-approximation)
11. [Code: Knapsack FPTAS and Vertex-Cover 2-Approx](#code-knapsack-fptas-and-vertex-cover-2-approx)
12. [Pitfalls](#pitfalls)
13. [Summary](#summary)

---

## Introduction

> Focus: turn "approximation ratio" from a slogan into a quantity you can *prove*, and meet the first reason some ratios are provably unbeatable.

At the [junior level](./junior.md) you collected the intuition: when a problem is NP-complete you stop chasing the exact optimum and instead build a fast algorithm that comes *provably close*, measured by an **approximation ratio**. You saw greedy vertex cover and greedy set cover wave their hands at "about 2" and "about log n." This file makes those numbers exact. We will:

- state the **α-approximation** definition precisely, separately for minimization and maximization, and distinguish **absolute** from **relative** guarantees;
- lay out the **FPTAS ⊆ PTAS ⊆ APX ⊆ NPO** hierarchy that classifies *how well* a problem can be approximated;
- **prove**, end to end, four ratios — Vertex Cover (2), Set Cover (Hₙ ≈ ln n), Metric TSP (2 via MST-doubling, with Christofides' 3/2 and the 2020 sub-3/2 result named), and Load Balancing (greedy 2, LPT 4/3);
- build a **PTAS** and then an **FPTAS** for Knapsack by *rounding*, working the error analysis line by line;
- take a first rigorous look at **hardness of approximation** — gap problems, why APX-hard problems admit "no PTAS unless P = NP," and the MAX-3SAT 7/8 threshold.

This builds directly on [reductions and NP-completeness](../07-reductions-and-np-completeness/middle.md) (a problem is "hard" because you reduced from a known-hard one) and on the class definitions in [complexity classes P and NP](../06-complexity-classes-p-np/middle.md). The PCP theorem and Unique Games machinery behind the hardness results are deferred to the [senior level](./senior.md); here we only need the *shape* of those arguments.

---

## Precise Definitions: The Approximation Ratio

An **optimization problem** has, for each instance `x`, a set of feasible solutions, each with a non-negative **cost** (or **value**). Let `OPT(x)` be the optimal cost. An algorithm `ALG` is **polynomial-time** and on input `x` outputs some feasible solution of cost `ALG(x)`. We measure how far `ALG(x)` strays from `OPT(x)`.

The catch is that "ratio" means different things for *minimization* (we want small cost; `ALG` can only overshoot) and *maximization* (we want large value; `ALG` can only undershoot). The convention below normalizes both so that **the ratio is always ≥ 1 and "closer to 1 is better."**

> **α-approximation (minimization), `α ≥ 1`.** For every instance `x`,
> ```text
> ALG(x)  ≤  α · OPT(x).
> ```
> The algorithm never costs more than `α` times the optimum.

> **α-approximation (maximization), `α ≥ 1`.** For every instance `x`,
> ```text
> ALG(x)  ≥  (1/α) · OPT(x).
> ```
> The algorithm always achieves at least a `1/α` fraction of the optimum.

Two reading conventions coexist in the literature, and mixing them is a classic source of confusion:

- **Normalized (`α ≥ 1`)** — the one above. A "2-approximation" for a *max* problem returns at least `OPT/2`.
- **Fractional (`ρ ≤ 1` for max)** — some authors say a max problem has a "`1/2`-approximation" meaning the same thing. Then "closer to 1 is better" and the ratio sits in `(0, 1]`.

We use the **normalized `α ≥ 1`** convention throughout, so every ratio in this file — vertex cover's 2, set cover's `ln n`, Christofides' 3/2 — is a number `≥ 1`, and "ALG within a factor α of OPT" reads the same regardless of whether we minimize or maximize.

```text
   minimization:   OPT  ≤  ALG  ≤  α·OPT          (overshoot bounded)
   maximization:   OPT  ≥  ALG  ≥  OPT/α          (undershoot bounded)
                    └──────────────┘
              ALG is "within factor α" of OPT in both cases
```

The guarantee must hold for **every** instance — it is a *worst-case* promise, not an average. This is the single most important property and the one beginners erode first (see [pitfalls](#pitfalls)).

---

## Absolute vs Relative Approximation

The ratio above is a **relative** (multiplicative) guarantee. A weaker-looking but sometimes stronger cousin is the **absolute** (additive) guarantee.

> **Absolute approximation.** `ALG` is an absolute `k`-approximation if for all `x`,
> ```text
> | ALG(x) − OPT(x) |  ≤  k
> ```
> for a *constant* `k` independent of the instance.

Absolute guarantees are rare and precious, because for most NP-hard problems even an additive constant is impossible unless P = NP (you could *scale* the instance to amplify a constant additive error into a multiplicative one). A famous exception is **edge coloring**: Vizing's theorem says any graph needs either `Δ` or `Δ+1` colors (`Δ` = max degree), and a polynomial algorithm achieves `Δ+1` — an absolute `1`-approximation, even though deciding between `Δ` and `Δ+1` is NP-complete. **Planar graph coloring** is similar: 4 colors always suffice (Four Color Theorem) and are findable in polynomial time, while the optimum (3 vs 4) is NP-hard — an absolute `1`-approximation.

For most of this file, "approximation" means **relative**. Keep the distinction sharp: a relative `2`-approximation on an instance with `OPT = 1000` may be off by 1000; an absolute `1`-approximation is off by 1 no matter how large the instance.

---

## The Approximation-Class Hierarchy: FPTAS ⊆ PTAS ⊆ APX ⊆ NPO

Just as decision problems sort into P, NP, NP-complete, optimization problems sort by *how well they can be approximated in polynomial time*. The universe is **NPO** (NP optimization problems), and inside it sits a nested hierarchy.

> - **PTAS (Polynomial-Time Approximation Scheme).** A problem is in PTAS if for **every fixed `ε > 0`** there is a polynomial-time `(1 + ε)`-approximation. The runtime is polynomial in `n` *for each fixed `ε`*, but `ε` may sit in the exponent — e.g. `O(n^{1/ε})` is allowed. You can get arbitrarily close to optimal, but the price of "closer" can be brutal.
>
> - **FPTAS (Fully Polynomial-Time Approximation Scheme).** Stronger: a `(1 + ε)`-approximation running in time polynomial in **both `n` and `1/ε`** — e.g. `O(n³ / ε)`. Now "twice as accurate" only costs a constant factor more work. This is the gold standard of approximability.
>
> - **APX.** Problems admitting a polynomial-time `c`-approximation for **some fixed constant `c`** (not necessarily arbitrarily close to 1). Vertex Cover (`c = 2`) and Metric TSP (`c = 3/2`) live here.
>
> - **NPO.** All NP optimization problems. Includes problems with no constant-factor approximation at all (general TSP, where even an `α`-approximation is NP-hard for *any* α).

The containments are strict under the assumption `P ≠ NP`:

```text
   FPTAS  ⊆  PTAS  ⊆  APX  ⊆  NPO        (each ⊆ is strict if P ≠ NP)

   FPTAS   Knapsack, Subset-Sum                 (poly in n and 1/ε)
   PTAS    Euclidean TSP, Bin Packing(asympt.)  (poly in n per fixed ε)
   APX     Vertex Cover, Metric TSP, MAX-3SAT   (some fixed constant c)
   NPO     General TSP, Set Cover*, Clique      (no constant factor, or ln n / n^{1-ε})
```

> \*Set Cover is technically *not* in APX: its best ratio is `Θ(ln n)`, which grows with the instance, so it sits in NPO but outside APX. Likewise CLIQUE cannot be approximated within `n^{1−ε}`.

Two structural facts you will use:

- **APX-hardness.** A problem is **APX-hard** if every APX problem reduces to it by an *approximation-preserving* reduction. An APX-hard problem **has no PTAS unless P = NP** — you cannot push its ratio arbitrarily close to 1. Vertex Cover, Metric TSP, and MAX-3SAT are APX-hard.
- The boundary between "has a PTAS" and "APX-hard but constant-approximable" is exactly the line that **hardness of approximation** draws, and the PCP theorem is the tool that draws it. We return to this in the [last section](#a-first-taste-of-hardness-of-approximation).

---

## Proof 1 — Vertex Cover: 2-Approximation via Maximal Matching

**Problem.** Given an undirected graph `G = (V, E)`, find a minimum **vertex cover** — a smallest set `C ⊆ V` such that every edge has at least one endpoint in `C`. Minimum vertex cover is NP-hard (it is the optimization version of the NP-complete decision problem from [the reductions file](../07-reductions-and-np-completeness/middle.md)).

The clean 2-approximation is **not** the naïve "repeatedly pick the highest-degree vertex" greedy (that one is *not* 2-approximate — it can be off by `Θ(log n)`). The correct algorithm is built on a **maximal matching**.

> **Algorithm (Matching-VC).**
> ```text
> C ← ∅
> while G has an uncovered edge (u, v):
>     add BOTH u and v to C
>     remove all edges incident to u or v
> return C
> ```

The edges `(u, v)` we pick form a **matching** `M` (no two share a vertex — once `u, v` are added, all their incident edges vanish, so the next picked edge is vertex-disjoint from them). And `M` is **maximal**: we stop only when no edge is uncovered, i.e. every remaining edge touches `C`.

**Claim.** `Matching-VC` returns a valid cover of size `≤ 2·OPT`.

*Proof.*

**(Validity)** When the loop ends, every edge has been removed, which happens only when one of its endpoints entered `C`. So every edge has an endpoint in `C` — `C` is a vertex cover.

**(Size = 2|M|)** Each iteration adds exactly 2 vertices and picks exactly 1 matching edge. So `|C| = 2|M|`.

**(Lower bound `OPT ≥ |M|`)** This is the heart. `M` is a set of vertex-disjoint edges. *Any* vertex cover — including the optimal `C*` — must cover every edge of `M`. Because the edges of `M` are pairwise disjoint, no single vertex can cover two of them. Therefore `C*` needs **at least one distinct vertex per matching edge**:
```text
   |C*| = OPT  ≥  |M|.
```

**(Combine)** `|C| = 2|M| ≤ 2·OPT`. ∎

```text
   matching edges (disjoint):   e1=(a,b)   e2=(c,d)   e3=(e,f)
   OPT must cover each  →  needs ≥1 vertex per ei  →  OPT ≥ |M| = 3
   ALG takes both endpoints     →  |C| = 2|M| = 6  ≤  2·OPT
```

This is the prototypical approximation proof: bound `ALG` *above* in terms of some quantity (`2|M|`) and bound `OPT` *below* by the **same** quantity (`|M|`), then divide. The matching `M` is a **lower-bound witness** for `OPT` — a recurring trick. The ratio 2 is essentially tight for this algorithm: a complete bipartite graph `K_{n,n}` has `OPT = n` but a perfect matching makes `Matching-VC` return all `2n` vertices.

---

## Proof 2 — Set Cover: The Greedy Hₙ ≈ ln n Bound

**Problem.** Given a universe `U` of `n` elements and a family `S = {S₁, …, S_m}` of subsets whose union is `U`, find the fewest subsets whose union is `U`. Minimum Set Cover is NP-hard.

> **Algorithm (Greedy-SC).**
> ```text
> C ← ∅;  covered ← ∅
> while covered ≠ U:
>     pick the set S that covers the MOST still-uncovered elements
>     add S to C;  covered ← covered ∪ S
> return C
> ```

**Claim.** `Greedy-SC` returns a cover of size at most `Hₙ · OPT`, where `Hₙ = 1 + 1/2 + 1/3 + ⋯ + 1/n ≈ ln n` is the `n`-th harmonic number.

*Proof (the charging / cost argument).* Distribute one unit of "blame" across the elements as they get covered, then total the blame two ways.

**Setup — cost shares.** When the greedy step picks a set `S` that covers `k` *newly* covered elements, charge each of those `k` elements a **price**
```text
   price(e) = 1 / k        for each newly covered element e.
```
Across the whole run, the greedy picks exactly `|C|` sets, and each picked set distributes a total price of `k · (1/k) = 1` among its new elements. Summing,
```text
   |C|  =  Σ_{e ∈ U} price(e).                              (★)
```
The total prices equal the number of sets chosen — each set "pays for itself" by spreading one unit of cost over its new elements.

**Key bound — each set's prices total `≤ H_{|S|}`.** Take *any* set `S` in the family with `|S| = s` elements. We bound the total price charged to `S`'s elements over the algorithm's run. Order `S`'s elements `e₁, e₂, …, e_s` by the time greedy covers them (latest first: `e₁` covered last). Consider the moment just before greedy covers `eᵢ`. At that point at least `i` of `S`'s elements are still uncovered (namely `e₁, …, eᵢ`). Since `S` itself is *available* and would cover ≥ `i` uncovered elements, the greedy choice (which is maximal) covers **at least `i`** new elements. So when `eᵢ` is covered, it is part of a set covering `≥ i` new elements, hence
```text
   price(eᵢ)  ≤  1/i.
```
Summing over `S`'s elements:
```text
   Σ_{e ∈ S} price(e)  ≤  1/1 + 1/2 + ⋯ + 1/s  =  H_s  ≤  H_n.    (♦)
```

**Combine via the optimal cover.** Let `C* = {S*₁, …, S*_{OPT}}` be an optimal cover. Every element belongs to at least one `S*ⱼ`, so summing (♦) over the optimal sets *covers every element at least once*:
```text
   Σ_{e ∈ U} price(e)  ≤  Σ_{j=1}^{OPT} Σ_{e ∈ S*ⱼ} price(e)
                       ≤  Σ_{j=1}^{OPT} H_n  =  OPT · H_n.
```
Plug into (★):
```text
   |C|  =  Σ_{e ∈ U} price(e)  ≤  H_n · OPT.                 ∎
```

```text
   Hₙ = 1 + 1/2 + ⋯ + 1/n
   ln(n+1) ≤ Hₙ ≤ 1 + ln n        ⇒   Hₙ = ln n + Θ(1) ≈ ln n
   greedy returns ≤ (ln n)·OPT sets.
```

So greedy set cover is an `Hₙ ≈ ln n`-approximation. This is **not** a constant — the ratio grows with `n` — which is exactly why Set Cover lives in NPO but **outside APX**. And it is essentially optimal: a celebrated hardness result (Dinur–Steurer, building on PCP) shows no polynomial algorithm beats `(1 − o(1)) ln n` unless P = NP. The greedy is, asymptotically, the best you can do.

---

## Proof 3 — Metric TSP: MST-Doubling 2-Approximation

**Problem.** **Metric TSP**: given `n` cities with pairwise distances `d` satisfying the **triangle inequality** `d(a, c) ≤ d(a, b) + d(b, c)` (and symmetry), find a minimum-length tour visiting every city exactly once and returning to start. *General* TSP (no triangle inequality) admits **no** constant approximation unless P = NP — so the metric restriction is what makes constant factors possible.

> **Algorithm (Double-Tree).**
> ```text
> 1. Build a minimum spanning tree T of the cities.
> 2. "Double" every edge of T → a multigraph in which every vertex has even degree.
> 3. Find an Eulerian circuit W of the doubled tree (exists: connected, all-even-degree).
> 4. Shortcut W into a Hamiltonian tour H: walk W, skipping any already-visited city.
> 5. return H
> ```

**Claim.** `Double-Tree` returns a tour `H` with `len(H) ≤ 2·OPT`.

*Proof.* Four inequalities chained together.

**(1) `len(T) ≤ OPT`.** Take the optimal tour and delete any one edge: the result is a spanning *path*, which is in particular a spanning tree (a connected acyclic spanning subgraph). The MST is the minimum-weight spanning tree, so `len(T) ≤ len(that path) ≤ len(optimal tour) = OPT`. (Deleting an edge only shortens.) Thus **`len(T) ≤ OPT`.**

**(2) Doubling costs `2·len(T)`.** The doubled multigraph has every original edge twice, so its total weight is `2·len(T)`. Every vertex now has even degree (each original incidence is duplicated), and the graph is connected, so by **Euler's theorem** an Eulerian circuit `W` exists that traverses each (doubled) edge exactly once. Hence
```text
   len(W) = 2·len(T) ≤ 2·OPT.
```

**(3) Shortcutting does not increase length (triangle inequality).** The Euler circuit `W` visits some cities multiple times. To turn it into a Hamiltonian tour, walk `W` and whenever it would revisit a city, *skip ahead* to the next unvisited city — replacing a sub-path `a → b → c` (with `b` already visited) by the direct edge `a → c`. By the **triangle inequality**, `d(a, c) ≤ d(a, b) + d(b, c)`, so each shortcut can only *shorten* the walk. Therefore
```text
   len(H) ≤ len(W).
```

**(Combine)** `len(H) ≤ len(W) = 2·len(T) ≤ 2·OPT`. ∎

```text
   OPT tour ──drop one edge──▶ spanning tree  ⇒  len(T) ≤ OPT
   T ──double──▶ Euler circuit W,  len(W) = 2 len(T) ≤ 2 OPT
   W ──shortcut (Δ-ineq.)──▶ tour H,  len(H) ≤ len(W) ≤ 2 OPT
```

Both load-bearing facts deserve a name: **MST is a lower bound on OPT** (step 1), and **the triangle inequality lets you shortcut for free** (step 3). Remove either and the proof collapses — which is precisely why general (non-metric) TSP has no constant approximation.

### Christofides and the 2020 breakthrough

Doubling the tree is wasteful: it makes *every* vertex even by duplicating *all* edges, when only the **odd-degree** vertices of `T` need fixing. **Christofides' algorithm** (1976) instead computes a minimum-weight **perfect matching** on just the odd-degree vertices of `T` and adds it to `T`. A short argument (the odd vertices form an even-sized set, and `OPT` restricted to them splits into two matchings, so the min matching costs `≤ OPT/2`) gives `len(T) + matching ≤ OPT + OPT/2`, hence after Eulerian shortcutting:

> **Christofides: a `3/2`-approximation for Metric TSP.**

This stood as the best known ratio for **44 years**. In **2020, Karlin, Klein, and Oveis Gharan** gave a randomized algorithm with ratio `3/2 − ε` for a tiny but explicit `ε ≈ 10^{-36}` — the first improvement on 3/2, proving that 3/2 is *not* the natural barrier. The exact optimal constant for Metric TSP remains open; the [senior level](./senior.md) discusses the (unproven) conjecture that `4/3` is achievable.

---

## Proof 4 — Load Balancing: Greedy 2-Approx and LPT 4/3

**Problem.** **Makespan minimization on identical machines**: given `m` machines and `n` jobs with processing times `p₁, …, p_n`, assign each job to a machine to minimize the **makespan** — the load (sum of times) of the busiest machine. NP-hard (it generalizes PARTITION).

> **Algorithm (List-Scheduling / Greedy).** Process jobs in arbitrary order; assign each job to the machine that is **currently least loaded**.

**Claim.** Greedy list-scheduling is a 2-approximation: `ALG ≤ 2·OPT` (more precisely `≤ (2 − 1/m)·OPT`).

*Proof.* We need two lower bounds on `OPT`:
```text
   (LB1)  OPT ≥ (1/m) · Σ pⱼ          (the average load; someone carries ≥ average)
   (LB2)  OPT ≥ max_j pⱼ              (the largest single job lands somewhere)
```
Let machine `M_i` finish last, with final load `L = ALG`, and let job `j` be the **last** job placed on `M_i`. At the moment `j` was assigned, `M_i` was the *least*-loaded machine, with load `L − pⱼ`. Since `M_i` was the minimum, *every* machine had load `≥ L − pⱼ` at that instant, so the total work already placed is `≥ m·(L − pⱼ)`. That total is at most `Σ pₖ`:
```text
   m·(L − pⱼ) ≤ Σ pₖ   ⇒   L − pⱼ ≤ (1/m)·Σ pₖ ≤ OPT      (by LB1)
   pⱼ ≤ OPT                                                 (by LB2)
   ⇒  L = (L − pⱼ) + pⱼ ≤ OPT + OPT = 2·OPT.               ∎
```
(The sharper `(2 − 1/m)` comes from using `(1/m)·Σ_{k≠j} pₖ` for the first term.)

> **LPT (Longest Processing Time first).** Sort jobs *descending*, then greedily assign each to the least-loaded machine. **LPT is a `4/3`-approximation** (precisely `(4/3 − 1/(3m))·OPT`).

*Proof idea.* Re-run the argument with the last-finishing job `j`. Because LPT sorts descending, when `j` is placed every machine already holds a job `≥ pⱼ`; if `M_i` still had the smallest load, either `pⱼ ≤ OPT/3` (so the additive `pⱼ` term is small) or `j` is among the `≤ m` largest jobs and `OPT` itself is forced up. A short case analysis turns the `+OPT` slack of the greedy proof into `+OPT/3`, yielding `4/3`. Sorting longest-first front-loads the big, makespan-determining jobs while the machines are empty, so the *last* job — the one that sets the makespan — is small.

The lesson generalizes: greedy's worst case is "a big job arrives last onto an already-balanced load"; sorting descending defuses exactly that, trading a tiny `O(n log n)` sort for a ratio drop from 2 to 4/3.

---

## PTAS and FPTAS via Knapsack

Knapsack is the cleanest place to *see* a scheme built, because both the exact DP and the rounding trick are short.

**Problem.** **0/1 Knapsack**: `n` items, item `i` has integer value `vᵢ` and weight `wᵢ`; a capacity `W`. Choose a subset maximizing total value subject to total weight `≤ W`. NP-hard (decision version reduces from SUBSET-SUM).

### Step 1 — Exact DP "by value"

The textbook DP is "by weight": `dp[i][w]` = best value using the first `i` items within weight `w`, in `O(nW)`. We need the **dual** DP, indexed **by value**, because rounding *values* is what makes the scheme work.

Let `V = Σ vᵢ` (an upper bound on any achievable value) and `v_max = max vᵢ`. Define
```text
   minWeight[i][v] = the minimum total weight of a subset of the first i items
                     whose total value is EXACTLY v.
```
Transition (include item `i` or not):
```text
   minWeight[i][v] = min( minWeight[i-1][v],                         # skip item i
                          minWeight[i-1][v - vᵢ] + wᵢ )              # take item i
```
The answer is the **largest `v`** with `minWeight[n][v] ≤ W`. The value axis ranges over `0 … V`, and since `V ≤ n·v_max`, the table has `O(n·V) = O(n²·v_max)` cells, each `O(1)`:

> **Exact value-DP runs in `O(n²·v_max)`.**

This is **pseudo-polynomial**: polynomial in `n` and in the *numeric value* `v_max`, but `v_max` can be exponential in its bit-length, so this is *not* a polynomial-time algorithm. (Same trap as SUBSET-SUM's `O(nt)` DP in [the reductions file](../07-reductions-and-np-completeness/middle.md).) The FPTAS *removes* the `v_max` dependence by shrinking the values.

### Step 2 — Rounding to an FPTAS

The idea: the `O(n²·v_max)` runtime is bad only because values can be huge. So **scale every value down**, discarding low-order bits, run the exact DP on the small rounded values, and bound the error introduced.

Fix the target accuracy `ε > 0`. Define a scaling factor
```text
   K = (ε · v_max) / n
```
and round each value **down**:
```text
   v'ᵢ = ⌊ vᵢ / K ⌋.
```
Run the exact value-DP on the rounded values `v'ᵢ` (weights and capacity unchanged), and output the item set `S` it selects.

**Runtime.** The new maximum value is `v'_max = ⌊v_max/K⌋ ≤ v_max/K = n/ε`. The value-DP runs in `O(n²·v'_max) = O(n² · n/ε) = O(n³/ε)`:

> **The rounded DP runs in `O(n³/ε)` — polynomial in both `n` and `1/ε`. That is an FPTAS.**

**Error analysis.** Let `S` be the set our algorithm returns and `S*` an optimal set (for the *original* values). We show `value(S) ≥ (1 − ε)·OPT`.

Multiplying the rounded values back by `K` *undershoots* each original value, but by less than `K` per item (floor discards `< K`):
```text
   K·v'ᵢ  =  K·⌊vᵢ/K⌋   satisfies   vᵢ − K  <  K·v'ᵢ  ≤  vᵢ.        (†)
```
Our DP **optimizes the rounded objective exactly**, so among all feasible sets it maximizes `Σ_{i} v'ᵢ`; in particular it does at least as well as `S*` on the rounded values:
```text
   Σ_{i∈S} v'ᵢ  ≥  Σ_{i∈S*} v'ᵢ.                                   (‡)
```
Now bound the *true* value of `S` from below:
```text
   value(S) = Σ_{i∈S} vᵢ
            ≥ Σ_{i∈S} K·v'ᵢ                       (by † right side, vᵢ ≥ K·v'ᵢ)
            ≥ Σ_{i∈S*} K·v'ᵢ                      (by ‡, scaled by K > 0)
            >  Σ_{i∈S*} (vᵢ − K)                  (by † left side, K·v'ᵢ > vᵢ − K)
            =  OPT − |S*|·K
            ≥  OPT − n·K                          (|S*| ≤ n)
            =  OPT − ε·v_max.                      (K = ε·v_max / n)
```
Finally `OPT ≥ v_max` — the single most valuable item alone is a feasible solution (assuming `wᵢ ≤ W`; otherwise drop it in preprocessing). So `ε·v_max ≤ ε·OPT`, giving
```text
   value(S)  ≥  OPT − ε·OPT  =  (1 − ε)·OPT.       ∎
```

That `(1 − ε)·OPT` is a `(1 + ε')`-approximation in the normalized sense (`1/(1−ε) ≤ 1 + 2ε` for small `ε`). We have built, from one rounding step, a scheme that for **any** `ε` runs in time **polynomial in `n` and `1/ε`** and lands within `(1 − ε)` of optimal:

```text
   accuracy knob ε  ──▶  K = εv_max/n  ──▶  values shrink to ≤ n/ε
   exact DP on small values  ──▶  O(n³/ε)  ──▶  value ≥ (1−ε)OPT
```

**Why this is an FPTAS and not "just" a PTAS.** A PTAS only promises polynomial-in-`n` per fixed `ε` — the `1/ε` could sit in the exponent (`n^{1/ε}`), so `ε = 0.01` might mean `n^{100}`. Here `1/ε` appears as a *factor*, so halving the error merely doubles the work. Knapsack having an FPTAS is the strongest positive approximability result a problem can have.

---

## A First Taste of Hardness of Approximation

So far every result was *positive* — "here is an algorithm with ratio α." The deeper theory proves *negative* results: **"no polynomial algorithm achieves ratio better than β, unless P = NP."** The senior file develops the PCP machinery; here we need only the *logical shape*.

### Gap problems

The bridge from "exact NP-hardness" to "approximation hardness" is the **gap problem**. For a maximization problem and constants `a > b`, define a *promise* decision problem:

> **GAP-Π[a, b].** Given an instance promised to satisfy **either** `OPT ≥ a` (a YES) **or** `OPT ≤ b` (a NO) — never anything strictly between — decide which.

The key observation: **a good approximation algorithm solves the gap problem.**

> **Lemma (gap ⇒ inapproximability).** Suppose `GAP-Π[a, b]` is NP-hard. Then Π has no polynomial-time `(a/b)`-approximation unless P = NP.

*Proof.* Suppose an `α`-approximation `ALG` existed with `α < a/b`. Run it on a gap instance.
- If it is a YES instance (`OPT ≥ a`), then `ALG ≥ OPT/α > b` — output exceeds `b`.
- If it is a NO instance (`OPT ≤ b`), then `ALG ≤ OPT ≤ b` — output is at most `b`.

So thresholding `ALG`'s output at `b` distinguishes YES from NO in polynomial time, deciding the NP-hard gap problem — forcing P = NP. ∎

The ratio `a/b` is exactly the **size of the gap**. Inapproximability is therefore a hunt for problems whose *exact* hardness can be amplified into a *gap*: NP-hardness must persist even when YES and NO instances are pulled far apart in objective value. **Producing such gaps is precisely what the PCP theorem does** — it shows 3SAT remains NP-hard even when you only need to distinguish "fully satisfiable" from "at most a `(7/8 + δ)`-fraction satisfiable."

### MAX-3SAT and the 7/8 threshold

**MAX-3SAT**: given a 3-CNF formula, satisfy as *many* clauses as possible. Two facts bracket it exactly:

- **Positive — a 7/8-approximation is trivial.** Assign each variable true/false **uniformly at random**. A 3-literal clause is *unsatisfied* only when all three literals are false: probability `(1/2)³ = 1/8`. So each clause is satisfied with probability `7/8`, and by linearity of expectation a random assignment satisfies `(7/8)·m` clauses in expectation. Since `OPT ≤ m`, this is a `7/8`-approximation (derandomizable by the method of conditional expectations into a deterministic algorithm). So MAX-3SAT ∈ APX with ratio `8/7`.

- **Negative — you cannot beat 7/8 (Håstad, 2001).** Using the PCP theorem, Håstad proved that for every `ε > 0`, it is **NP-hard** to distinguish satisfiable 3-CNFs from those where at most a `(7/8 + ε)`-fraction of clauses can be satisfied. By the gap lemma, **no polynomial `(7/8 + ε)`-approximation exists unless P = NP.**

```text
   trivial random assignment:   satisfies ≥ 7/8 of clauses      (upper-achievable)
   Håstad 2001 (via PCP):       7/8 + ε is NP-hard               (un-improvable)
   ⇒  7/8 is the EXACT approximation threshold for MAX-3SAT.
```

A "dumb" random algorithm is provably **optimal**. This is the signature of hardness-of-approximation: the easy algorithm and the hardness bound meet at the *same* constant, pinning the threshold exactly.

### Why APX-hard ⇒ no PTAS

The gap lemma also explains the [hierarchy](#the-approximation-class-hierarchy-fptas--ptas--apx--npo). A problem is **APX-hard** when there is a fixed gap that is NP-hard to close — say no `(1 + δ₀)`-approximation for some specific `δ₀ > 0`. A **PTAS** would, by definition, supply a `(1 + ε)`-approximation for *every* `ε`, including `ε < δ₀` — contradicting the hardness. Hence:

> **No APX-hard problem has a PTAS unless P = NP.**

Vertex Cover (no better than `≈ 1.36`, conjecturally `2`, NP-hard), Metric TSP, and MAX-3SAT are all APX-hard — their constant-factor algorithms above are, up to the exact constant, the best polynomial algorithms possible. The Unique Games Conjecture sharpens many of these thresholds (e.g. it would make Vertex Cover's `2` tight); that, and the PCP theorem itself, are [senior-level](./senior.md) material.

---

## Code: Knapsack FPTAS and Vertex-Cover 2-Approx

Two runnable demonstrations. The first builds the Knapsack FPTAS and **empirically confirms** `value ≥ (1 − ε)·OPT` against a brute-force optimum. The second runs Matching-VC and confirms `|C| ≤ 2·OPT`.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

// ---- Exact knapsack (brute force) for the ground-truth OPT ----------------
func knapExact(v, w []int, W int) int {
	n := len(v)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		sw, sv := 0, 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				sw += w[i]
				sv += v[i]
			}
		}
		if sw <= W && sv > best {
			best = sv
		}
	}
	return best
}

// ---- Knapsack FPTAS: round values, run exact value-DP ---------------------
// Returns the true value of the selected set. Guarantee: >= (1-eps)*OPT,
// runtime O(n^2 * vmax') = O(n^3 / eps).
func knapFPTAS(v, w []int, W int, eps float64) int {
	n := len(v)
	vmax := 0
	for _, x := range v {
		if x > vmax {
			vmax = x
		}
	}
	if vmax == 0 {
		return 0
	}
	K := eps * float64(vmax) / float64(n)
	if K < 1e-12 {
		K = 1e-12
	}
	vp := make([]int, n) // rounded-down values
	total := 0
	for i := range v {
		vp[i] = int(float64(v[i]) / K) // floor
		total += vp[i]
	}
	// minWeight[val] = min weight to achieve EXACTLY rounded-value `val`.
	const INF = 1 << 60
	minW := make([]int, total+1)
	for i := range minW {
		minW[i] = INF
	}
	minW[0] = 0
	for i := 0; i < n; i++ {
		for val := total; val >= vp[i]; val-- { // 0/1: iterate downward
			if minW[val-vp[i]]+w[i] < minW[val] {
				minW[val] = minW[val-vp[i]] + w[i]
			}
		}
	}
	// Largest rounded value that fits; recover its TRUE value.
	bestRounded := 0
	for val := total; val >= 0; val-- {
		if minW[val] <= W {
			bestRounded = val
			break
		}
	}
	// Reconstruct selected items to report true value.
	trueVal, rem, cap := 0, bestRounded, W
	for i := n - 1; i >= 0; i-- {
		_ = cap
	}
	// Simple re-derivation: recompute with reconstruction.
	trueVal = reconstructTrueValue(v, w, vp, W, bestRounded, total)
	_ = rem
	return trueVal
}

// recompute which items realize bestRounded with weight <= W, sum true values.
func reconstructTrueValue(v, w, vp []int, W, target, total int) int {
	n := len(v)
	const INF = 1 << 60
	minW := make([][]int, n+1)
	for i := range minW {
		minW[i] = make([]int, total+1)
		for j := range minW[i] {
			minW[i][j] = INF
		}
		minW[i][0] = 0
	}
	for i := 1; i <= n; i++ {
		for val := 0; val <= total; val++ {
			minW[i][val] = minW[i-1][val]
			if val >= vp[i-1] && minW[i-1][val-vp[i-1]]+w[i-1] < minW[i][val] {
				minW[i][val] = minW[i-1][val-vp[i-1]] + w[i-1]
			}
		}
	}
	// walk back from (n, target)
	val, trueVal := target, 0
	for i := n; i >= 1; i-- {
		if minW[i][val] != minW[i-1][val] { // item i-1 was taken
			trueVal += v[i-1]
			val -= vp[i-1]
		}
	}
	_ = W
	return trueVal
}

func main() {
	v := []int{60, 100, 120, 40, 70, 15}
	w := []int{10, 20, 30, 8, 14, 4}
	W := 50
	opt := knapExact(v, w, W)
	for _, eps := range []float64{0.5, 0.25, 0.1} {
		approx := knapFPTAS(v, w, W, eps)
		ratio := float64(approx) / float64(opt)
		fmt.Printf("eps=%.2f  OPT=%d  FPTAS=%d  ratio=%.3f  >=(1-eps)? %v\n",
			eps, opt, approx, ratio, ratio >= 1-eps-1e-9)
	}
	vertexCoverDemo()
}

// ---- Vertex Cover: Matching-VC 2-approx -----------------------------------
func vertexCoverDemo() {
	// graph as edge list
	type E struct{ u, v int }
	n := 6
	edges := []E{{0, 1}, {0, 2}, {1, 3}, {2, 3}, {3, 4}, {4, 5}}

	// Matching-VC: take both endpoints of each uncovered edge.
	inC := make([]bool, n)
	for _, e := range edges {
		if !inC[e.u] && !inC[e.v] {
			inC[e.u] = true
			inC[e.v] = true
		}
	}
	cover := []int{}
	for i, b := range inC {
		if b {
			cover = append(cover, i)
		}
	}

	// brute-force OPT for comparison
	opt := n
	for mask := 0; mask < (1 << n); mask++ {
		ok := true
		for _, e := range edges {
			if mask&(1<<e.u) == 0 && mask&(1<<e.v) == 0 {
				ok = false
				break
			}
		}
		if ok {
			c := 0
			for i := 0; i < n; i++ {
				if mask&(1<<i) != 0 {
					c++
				}
			}
			if c < opt {
				opt = c
			}
		}
	}
	sort.Ints(cover)
	fmt.Printf("VC: cover=%v size=%d  OPT=%d  <=2*OPT? %v\n",
		cover, len(cover), opt, len(cover) <= 2*opt)
}
```

### Python

```python
from itertools import combinations


# ---- Exact knapsack (brute force) for ground-truth OPT --------------------
def knap_exact(v, w, W):
    n, best = len(v), 0
    for mask in range(1 << n):
        sw = sum(w[i] for i in range(n) if mask & (1 << i))
        sv = sum(v[i] for i in range(n) if mask & (1 << i))
        if sw <= W and sv > best:
            best = sv
    return best


# ---- Knapsack FPTAS: round values, exact value-DP -------------------------
# Guarantee: returned true value >= (1 - eps) * OPT.  Time O(n^3 / eps).
def knap_fptas(v, w, W, eps):
    n = len(v)
    vmax = max(v)
    if vmax == 0:
        return 0
    K = eps * vmax / n
    vp = [int(x / K) for x in v]          # floor(v_i / K)
    total = sum(vp)
    INF = float("inf")
    # min_w[val] = min weight to hit EXACTLY rounded value `val`
    min_w = [INF] * (total + 1)
    min_w[0] = 0
    take = [[False] * (total + 1) for _ in range(n)]
    # We need reconstruction, so keep a 2D table.
    dp = [[INF] * (total + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(1, n + 1):
        for val in range(total + 1):
            dp[i][val] = dp[i - 1][val]
            if val >= vp[i - 1] and dp[i - 1][val - vp[i - 1]] + w[i - 1] < dp[i][val]:
                dp[i][val] = dp[i - 1][val - vp[i - 1]] + w[i - 1]
    # largest rounded value that fits
    best_rounded = max(val for val in range(total + 1) if dp[n][val] <= W)
    # backtrack to sum TRUE values
    val, true_val = best_rounded, 0
    for i in range(n, 0, -1):
        if dp[i][val] != dp[i - 1][val]:   # item i-1 taken
            true_val += v[i - 1]
            val -= vp[i - 1]
    return true_val


# ---- Vertex Cover: Matching-VC 2-approx -----------------------------------
def matching_vc(n, edges):
    in_c = [False] * n
    for (u, x) in edges:
        if not in_c[u] and not in_c[x]:
            in_c[u] = in_c[x] = True
    return [i for i in range(n) if in_c[i]]


def vc_opt(n, edges):
    for k in range(n + 1):
        for subset in combinations(range(n), k):
            s = set(subset)
            if all(u in s or x in s for (u, x) in edges):
                return k
    return n


def main():
    v = [60, 100, 120, 40, 70, 15]
    w = [10, 20, 30, 8, 14, 4]
    W = 50
    opt = knap_exact(v, w, W)
    for eps in (0.5, 0.25, 0.1):
        approx = knap_fptas(v, w, W, eps)
        ratio = approx / opt
        print(f"eps={eps:<4}  OPT={opt}  FPTAS={approx}  "
              f"ratio={ratio:.3f}  >=(1-eps)? {ratio >= 1 - eps - 1e-9}")

    n, edges = 6, [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (4, 5)]
    cover = matching_vc(n, edges)
    opt_vc = vc_opt(n, edges)
    print(f"VC: cover={cover} size={len(cover)}  OPT={opt_vc}  "
          f"<=2*OPT? {len(cover) <= 2 * opt_vc}")


if __name__ == "__main__":
    main()
```

Both programs confirm the guarantees empirically: the FPTAS value is always `≥ (1 − ε)·OPT` (and for small `ε` it usually *is* the optimum, since the rounding error rarely changes which set wins on a tiny instance), and Matching-VC's cover is always `≤ 2·OPT`. The code makes the proofs falsifiable: if a run ever printed `False`, either the algorithm or our analysis would be wrong. The structural lesson mirrors [the reductions file](../07-reductions-and-np-completeness/middle.md) — the *exact* solvers (`knap_exact`, `vc_opt`) are exponential brute forces, while the approximation algorithms are polynomial and come with a *proven* worst-case promise that the random tests merely illustrate.

---

## Pitfalls

**1. Getting the ratio direction backwards.** For *minimization* the guarantee is `ALG ≤ α·OPT` (ALG can only be too big); for *maximization* it is `ALG ≥ OPT/α` (ALG can only be too small). Writing `ALG ≥ α·OPT` for a min problem is nonsense (every feasible solution satisfies it). Always sanity-check: does "α" bound the *bad* direction the algorithm can err in?

**2. The "greedy is optimal" fallacy.** Greedy *vertex cover by max-degree* is **not** a 2-approximation — it is `Θ(log n)`. Greedy set cover *is* `ln n` but is **not** constant. Greedy *list-scheduling* is 2, not optimal. Greedy producing a *valid* solution says nothing about its ratio; the ratio needs a proof against a *lower bound on OPT* (matching size, MST weight, average load). Never assume "the obvious greedy" hits a good constant — derive it.

**3. Confusing worst-case ratio with instance-specific performance.** The approximation ratio is a *worst-case* promise over *all* instances. On *your* data a 2-approximation may routinely land within 1% of optimal — but the guarantee you can *cite* is still 2. Conversely, a single adversarial instance (e.g. `K_{n,n}` for Matching-VC) realizes the worst case. Do not report empirical closeness as if it were the proven bound, and do not distrust the algorithm because one instance hits the bound — that is the bound doing its job.

**4. Forgetting the triangle inequality / metric assumption.** The TSP 2- and 3/2-approximations rely on the triangle inequality for shortcutting. On *general* TSP they give no guarantee at all — general TSP has *no* constant-factor polynomial approximation unless P = NP. Always check whether your distance function is metric before quoting Christofides.

**5. Calling a pseudo-polynomial DP "polynomial."** The `O(n²·v_max)` Knapsack value-DP and the `O(nW)` weight-DP are *pseudo*-polynomial — polynomial in numeric magnitude, exponential in bit-length. The FPTAS exists precisely to convert this into genuinely polynomial `O(n³/ε)`. Quoting the pseudo-poly DP as "polynomial" repeats the SUBSET-SUM trap from [the reductions file](../07-reductions-and-np-completeness/middle.md).

**6. Expecting a PTAS for an APX-hard problem.** If a problem is APX-hard (Vertex Cover, Metric TSP, MAX-3SAT), there is a fixed constant below which approximation is NP-hard — so **no PTAS exists** unless P = NP. Chasing a `(1 + ε)`-scheme for such a problem is chasing P = NP. Know which side of the APX/PTAS line your problem sits on before optimizing for accuracy.

**7. Mis-stating the FPTAS error.** The Knapsack FPTAS returns `≥ (1 − ε)·OPT`, *not* "within ε absolute" and *not* "the optimum minus ε." The error is *relative* and rides on `OPT ≥ v_max`; if you forget the preprocessing that drops items with `wᵢ > W`, the bound `OPT ≥ v_max` can fail.

---

## Summary

- **α-approximation** is a worst-case promise: for minimization `ALG ≤ α·OPT`; for maximization `ALG ≥ OPT/α` (normalized so `α ≥ 1`, "closer to 1 is better"). **Absolute** (additive) guarantees `|ALG − OPT| ≤ k` are rarer and stronger; edge/planar coloring are the classic examples.
- The approximability hierarchy **FPTAS ⊆ PTAS ⊆ APX ⊆ NPO** classifies *how well* a problem can be approximated: FPTAS = `(1+ε)` in time poly(`n`, `1/ε`); PTAS = poly(`n`) per fixed `ε`; APX = some fixed constant; NPO = everything. Containments are strict if `P ≠ NP`.
- **Vertex Cover, 2-approx:** take both endpoints of a maximal matching `M`. `ALG = 2|M|` and `OPT ≥ |M|` (disjoint edges each need a distinct cover vertex) ⇒ `ALG ≤ 2·OPT`. The matching is a *lower-bound witness* for OPT.
- **Set Cover, Hₙ ≈ ln n:** greedy charges each newly covered element `1/k`; each set's prices total `≤ H_s ≤ H_n`; summing over an optimal cover gives `|C| ≤ Hₙ·OPT`. Non-constant ratio ⇒ Set Cover ∉ APX, and `(1−o(1)) ln n` is NP-hard to beat.
- **Metric TSP, 2-approx:** `len(T) ≤ OPT` (drop a tour edge → spanning tree), double `T` (cost `2·len(T)`, Eulerian), shortcut by the triangle inequality (free) ⇒ `len(H) ≤ 2·OPT`. **Christofides** (1976) improves to **3/2** via a min-matching on odd-degree vertices; **Karlin–Klein–Oveis Gharan (2020)** broke 3/2 by a tiny `ε`.
- **Load Balancing:** greedy list-scheduling is `2`-approx (`L − pⱼ ≤ avg ≤ OPT` and `pⱼ ≤ OPT`); sorting **longest-first (LPT)** tightens this to **4/3** by ensuring the makespan-setting last job is small.
- **Knapsack FPTAS:** the exact *value-DP* runs in pseudo-poly `O(n²·v_max)`; rounding values by `K = εv_max/n` shrinks `v_max` to `n/ε`, giving `O(n³/ε)`, and the floor-error analysis (`vᵢ − K < K·v'ᵢ ≤ vᵢ`, optimality on rounded values, `OPT ≥ v_max`) yields `value ≥ (1−ε)·OPT`.
- **Hardness of approximation:** an NP-hard **gap problem** GAP-Π[a, b] forbids any `(a/b)`-approximation unless P = NP. APX-hard ⇒ **no PTAS**. **MAX-3SAT** is pinned exactly: a trivial random assignment achieves `7/8`, and Håstad (2001, via PCP) showed `7/8 + ε` is NP-hard — the easy algorithm is provably optimal.

Continue to the [senior level](./senior.md) for the PCP theorem, approximation-preserving (PTAS/L/AP) reductions, the Unique Games Conjecture and its sharp thresholds, LP/SDP rounding and Goemans–Williamson MAX-CUT, and the primal-dual method. Back to the [junior level](./junior.md) for the ground intuition, or sideways to [reductions and NP-completeness](../07-reductions-and-np-completeness/middle.md) and [complexity classes P and NP](../06-complexity-classes-p-np/middle.md) for the hardness foundations these approximation results stand on.
