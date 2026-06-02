# Minimum Spanning Tree — Professional Level

> **One-line summary:** The MST is one of the few classic problems where the gap between "easy `O(E log V)`" and "is there a deterministic linear-time algorithm?" is still partly open. This level gives the formal definition, rigorous correctness proofs of the cut and cycle properties (and that they make Kruskal and Prim optimal via a single exchange argument), exact complexity per data structure, and the modern frontier: Karger–Klein–Tarjan's expected-linear randomized MST, Chazelle's `O(E α(E,V))` deterministic algorithm, and the still-unresolved question of optimal deterministic MST.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [Correctness Proofs](#2-correctness-proofs)
3. [Complexity by Data Structure](#3-complexity-by-data-structure)
4. [Karger–Klein–Tarjan: Expected Linear Time](#4-kargerkleintarjan-expected-linear-time)
5. [Chazelle: Near-Linear Deterministic](#5-chazelle-near-linear-deterministic)
6. [Cache Behavior](#6-cache-behavior)
7. [Average-Case Analysis](#7-average-case-analysis)
8. [Space-Time Trade-offs](#8-space-time-trade-offs)
9. [Comparison](#9-comparison)
10. [Open Problems](#10-open-problems)
11. [Summary](#11-summary)

---

## 1. Formal Definition

Let `G = (V, E, w)` be a connected, undirected graph with a weight function `w : E → ℝ`. A **spanning tree** `T ⊆ E` is an acyclic, connected subgraph touching all of `V`; it has exactly `|V| − 1` edges. A **minimum spanning tree** is a spanning tree minimizing

```
w(T) = Σ_{e ∈ T} w(e).
```

Properties used throughout:

- The set of forests of `G` forms the independent sets of a **graphic matroid** `M(G)`. An MST is a **minimum-weight basis** of that matroid. This is *the* reason the greedy algorithm is optimal: the greedy algorithm computes a minimum-weight basis of *any* matroid, and MST is the matroid special case (Rado–Edmonds theorem).
- If `G` is disconnected, replace "tree" with "forest"; the **minimum spanning forest (MSF)** is the union of per-component MSTs and has `|V| − c` edges for `c` components.
- If all weights are distinct, the MST is **unique** (proved below).

---

## 2. Correctness Proofs

### 2.1 Cut Property (safe-edge theorem)

> **Theorem (Cut Property).** Let `A ⊆ E` be a subset of edges contained in some MST of `G`. Let `(S, V∖S)` be any cut such that no edge of `A` crosses it. Let `e` be a minimum-weight edge crossing `(S, V∖S)`. Then `A ∪ {e}` is contained in some MST.

**Proof (exchange argument).** Let `T` be an MST with `A ⊆ T`. If `e ∈ T`, then `A ∪ {e} ⊆ T` and we are done. Otherwise `T ∪ {e}` contains exactly one cycle `C`, and `e ∈ C`. Because `e` crosses the cut, traversing `C` we must cross the cut an even number of times, so there is another edge `e' ∈ C` crossing `(S, V∖S)`, `e' ≠ e`. Since no edge of `A` crosses the cut, `e' ∉ A`. The graph `T' = (T ∖ {e'}) ∪ {e}` is again a spanning tree (removing `e'` breaks the unique cycle). Its weight is

```
w(T') = w(T) − w(e') + w(e) ≤ w(T),    since w(e) ≤ w(e').
```

As `T` is minimum, `w(T') = w(T)`, so `T'` is also an MST, and `A ∪ {e} ⊆ T'`. ∎

### 2.2 Cycle Property

> **Theorem (Cycle Property).** Let `C` be a cycle in `G` and let `e` be an edge of `C` with `w(e) > w(f)` for every other edge `f ∈ C`. Then `e` belongs to no MST.

**Proof.** Suppose some MST `T` contains `e`. Removing `e` splits `T` into components `X` and `Y`. The cycle `C` minus `e` is a path connecting `e`'s endpoints, so it crosses the `(X, Y)` cut on some edge `e' ≠ e`, with `w(e') < w(e)` by hypothesis. Then `T' = (T ∖ {e}) ∪ {e'}` is a spanning tree with `w(T') = w(T) − w(e) + w(e') < w(T)`, contradicting minimality of `T`. ∎

### 2.3 Kruskal Correctness

Kruskal processes edges in nondecreasing weight order, adding `e=(u,v)` iff `u, v` are currently in different trees. **Claim:** every added edge is safe. Consider the moment Kruskal adds `e`. Let `A` be the edges added so far (a forest, contained in some MST by induction). Let `S` be the tree of `A` containing `u`. No edge of `A` crosses the cut `(S, V∖S)` (else `u` and the other side would already be merged). Among all edges crossing this cut, `e` has minimum weight: any lighter crossing edge would have been processed earlier and — joining two then-different trees — would already have merged them, contradicting that `S` is exactly `u`'s current tree. By the cut property, `e` is safe. Edges Kruskal *rejects* close a cycle and are (by ascending order) the heaviest on that cycle, hence excluded by the cycle property. ∎

### 2.4 Prim Correctness

Prim maintains a single tree `A` over a vertex set `S`. At each step it adds the minimum-weight edge crossing `(S, V∖S)`. No edge of `A` crosses that cut (all of `A` is inside `S`). By the cut property, each added edge is safe, so the invariant "`A ⊆ some MST`" is preserved; after `|V|−1` additions `A` is a spanning tree, hence an MST. ∎

### 2.5 Uniqueness

> **Theorem.** If all edge weights are distinct, the MST is unique.

**Proof.** Suppose two distinct MSTs `T₁ ≠ T₂`. Let `e` be the **minimum-weight** edge in their symmetric difference, WLOG `e ∈ T₁ ∖ T₂`. Adding `e` to `T₂` creates a cycle `C`; `C` has an edge `f ∉ T₁` (else `T₁` would contain the cycle). Then `e, f` are both in the symmetric difference, and since weights are distinct and `e` is the minimum such, `w(e) < w(f)`. Swapping gives `T₂ ∖ {f} ∪ {e}`, a spanning tree of strictly smaller weight than `T₂` — contradiction. ∎

---

## 3. Complexity by Data Structure

| Algorithm | Data structure | Time | Notes |
|-----------|----------------|------|-------|
| Kruskal | comparison sort + Union-Find (path compression + union by rank) | `O(E log E + E α(V))` = `O(E log V)` | Sort dominates; UF passes are `O(E α(V))` ≈ linear. |
| Kruskal | radix/counting sort (bounded integer weights) + UF | `O(E α(V))` | Effectively linear when weights sort in `O(E)`. |
| Prim | binary heap (lazy or eager) | `O(E log V)` | `E` decrease-key/push, each `O(log V)`. |
| Prim | `d`-ary heap | `O(E log_d V)` with `d = E/V` → `O(E log_{E/V} V)` | Tunes for density. |
| Prim | Fibonacci heap | `O(E + V log V)` | `E` decrease-keys at `O(1)` amortized, `V` extract-mins at `O(log V)`. |
| Prim | array (no heap) | `O(V²)` | Best for dense `E = Θ(V²)`. |
| Borůvka | component labels + per-round scan | `O(E log V)` | `O(log V)` rounds, `O(E)` each. |
| Borůvka + Prim hybrid | — | `O(E log log V)` | Run a few Borůvka rounds, then Prim on the contracted graph. |
| Fredman–Tarjan | Fibonacci heap, bounded-size Prim passes | `O(E log* V)` | Iterated Prim with size caps. |
| Gabow et al. | — | `O(E log β(E,V))` | `β` = min `i` with `log^{(i)} V ≤ E/V`. |
| Chazelle | soft heaps | `O(E α(E,V))` | Best known *deterministic*. |
| Karger–Klein–Tarjan | random sampling + Borůvka | `O(E)` **expected** | Best known randomized. |

The **inverse Ackermann** `α(V)` from Union-Find is ≤ 4 for any conceivable `V`, so Kruskal's non-sort work is linear for all practical purposes (Union-Find detail in sibling *12-disjoint-set*).

---

## 4. Karger–Klein–Tarjan: Expected Linear Time

KKT (1995) is a **randomized** MST algorithm running in `O(E)` *expected* time. It rests on the **MST verification / sampling** machinery:

1. **Borůvka contraction:** run 2 Borůvka steps, contracting the graph; this removes at least `3/4` of the vertices and halves them at least twice, cutting `V` by `≥ 4×`.
2. **Random sampling:** include each remaining edge independently with probability `1/2`, forming subgraph `H`. Recursively compute the MSF `F` of `H`.
3. **`F`-heavy edge discard:** an edge `e=(u,v)` is **`F`-heavy** if `w(e)` exceeds the maximum weight on the `u→v` path in `F`; by the cycle property such edges are *not* in the MST and can be discarded. A key sampling lemma proves the expected number of `F`-*light* edges that survive is `O(V)`.
4. **Recurse** on the surviving (light) edges.

The verification step — testing `F`-heaviness for all edges in `O(E)` — uses **Komlós's** linear MST-verification algorithm (deciding, for each non-tree edge, the max edge on its tree path) combined with King's simplification. The recurrence solves to `O(E)` expected. KKT is the closest thing we have to "MST in linear time" and is unconditional in its randomness assumptions (it works for any input, using internal coin flips).

---

## 5. Chazelle: Near-Linear Deterministic

Chazelle (2000) gives a **deterministic** MST algorithm in `O(E · α(E,V))` time, where `α` is the inverse Ackermann function — within an inverse-Ackermann factor of linear. The engine is the **soft heap**, a priority queue that achieves `O(1)` amortized operations by allowing a controlled fraction of *corrupted* keys (keys whose stored value is artificially inflated). By tolerating bounded corruption, Chazelle bypasses the comparison lower bound that would otherwise force `Θ(E log V)`. Pettie and Ramachandran (2002) later gave a **provably optimal** deterministic MST algorithm whose running time equals the decision-tree complexity of the problem — but the *exact* asymptotic value of that complexity is unknown, which is precisely why "deterministic linear-time MST" remains open (Section 10).

These algorithms are of theoretical importance; in practice Kruskal/Prim/Borůvka dominate because their constants are tiny and `log V ≤ ~30` for any real graph.

---

## 6. Cache Behavior

- **Kruskal** is cache-friendly in its sort phase (sequential scans, good for radix/merge sort), but the **Union-Find** `find`s perform pointer-chasing with poor locality. Path compression flattens trees, improving locality over time; union by rank keeps trees shallow.
- **Array-Prim** is the most cache-friendly variant: the inner loops sweep the contiguous `minEdge[]` array linearly, with predictable prefetching and no pointer indirection — a major reason it beats heap-Prim on dense graphs even at equal asymptotic class.
- **Heap-Prim** suffers from heap sift operations that jump across the array by factors of 2 (parent/child index gaps), defeating prefetch on large heaps, plus adjacency-list pointer chasing.
- **Borůvka** streams the edge list per round — excellent sequential locality — but the per-component min-slot updates scatter writes; partitioning edges by component improves it.

For very large graphs, a **CSR (compressed sparse row)** edge layout plus Borůvka maximizes streaming bandwidth, which is why GPU MST is Borůvka-on-CSR.

---

## 7. Average-Case Analysis

- **Random weights, fixed graph:** if edge weights are i.i.d. continuous random variables, the MST's *structure* depends only on the weight *ordering*, not magnitudes — so any property invariant under monotone weight transforms is determined combinatorially.
- **Random graph `G(n, p)`:** the expected MST weight of the complete graph `K_n` with i.i.d. `Uniform(0,1)` weights tends to **`ζ(3) ≈ 1.202`** as `n → ∞` (Frieze's theorem, 1985) — a striking constant independent of `n`. Generalizes to `Σ 1/k³` style results for other weight distributions.
- **Expected Borůvka rounds:** on random graphs the component count drops faster than the worst-case halving, so the practical round count is often `< log V`.
- **Kruskal early-stop:** with random weights the `V−1`-th accepted edge typically appears well before the end of the sorted list, so the early break saves a constant fraction of union calls.

---

## 8. Space-Time Trade-offs

| Choice | Space | Time | When |
|--------|-------|------|------|
| Kruskal in-memory | `O(E)` edges + `O(V)` UF | `O(E log E)` | `E` fits in RAM. |
| Kruskal external | `O(V)` resident | `O(E log E)` (disk sort) | `E` ≫ RAM. |
| Array-Prim | `O(V²)` (matrix) or `O(V)` (+ adjacency) | `O(V²)` | Dense graphs. |
| Heap-Prim lazy | `O(E)` heap entries | `O(E log V)` | Sparse, simple. |
| Heap-Prim eager | `O(V)` heap + `O(V)` index map | `O(E log V)` | Memory-tight sparse. |
| Fibonacci-Prim | `O(E)` | `O(E + V log V)` | Theoretical dense optimum. |
| Borůvka | `O(E)` | `O(E log V)` | Parallel/distributed. |

The recurring trade is **heap entries vs decrease-key bookkeeping**: lazy Prim trades `O(E)` extra heap space (stale entries) for simplicity; eager Prim spends an index map to cap entries at `O(V)`.

---

## 9. Comparison

| Algorithm | Time | Det.? | Practical niche |
|-----------|------|-------|-----------------|
| Kruskal | `O(E log V)` | yes | sparse, edge lists, external memory |
| Prim (heap) | `O(E log V)` | yes | general sparse |
| Prim (array) | `O(V²)` | yes | dense / complete graphs |
| Prim (Fibonacci) | `O(E + V log V)` | yes | dense, theory |
| Borůvka | `O(E log V)` | yes | parallel / GPU / distributed |
| Fredman–Tarjan | `O(E log* V)` | yes | theory |
| Chazelle | `O(E α(E,V))` | yes | best deterministic, theory |
| Karger–Klein–Tarjan | `O(E)` expected | no (randomized) | best known overall, theory |

In every real benchmark, the winner among the first five is decided by **density and input format**, not by the `O(...)` — the asymptotic classes are nearly identical and the constants and cache behavior decide.

---

## 10. Open Problems

- **Deterministic linear-time MST.** Is there an `O(E)` *deterministic* MST algorithm? Chazelle's `O(E α(E,V))` and Pettie–Ramachandran's *provably optimal* algorithm bracket the answer, but the optimal algorithm's running time equals an unknown decision-tree complexity. Whether that complexity is `Θ(E)` is **open** — arguably the most famous open question in classical algorithm design.
- **Optimal parallel MST.** Tight bounds for MST in the PRAM and MPC (massively-parallel-computation) models, especially round-complexity lower bounds for sparse graphs, remain active.
- **Fully dynamic MST.** Maintaining an MST under edge insertions *and* deletions: best deterministic is `O(√E)`-ish amortized via classic results; whether `polylog` per update is achievable deterministically is open (randomized polylog exists).
- **Soft-heap derandomization.** Can the randomized KKT linear time be matched deterministically without the inverse-Ackermann slack?

---

## 11. Summary

Formally the MST is the minimum-weight basis of the graphic matroid, and a single **exchange argument** proves the **cut property** (lightest edge across an `A`-free cut is safe) and **cycle property** (strictly heaviest cycle edge is excluded), which together make Kruskal, Prim, and Borůvka optimal; distinct weights force uniqueness. Complexity is `O(E log V)` for all three classic algorithms (Kruskal's non-sort work being `O(E α(V))`, effectively linear), `O(V²)` for array-Prim on dense graphs, and `O(E + V log V)` for Fibonacci-Prim. The research frontier is **Karger–Klein–Tarjan's `O(E)` expected-time randomized** algorithm (Borůvka contraction + edge sampling + linear-time `F`-heavy verification) and **Chazelle's `O(E α(E,V))` deterministic** algorithm via soft heaps, with **deterministic linear-time MST** still the headline open problem. In practice, density, input format, and cache behavior — not the asymptotics — pick the winner, and that winner is almost always plain Kruskal, array-Prim, or Borůvka.
