# Bipartite Matching — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Berge's Augmenting-Path Theorem — Proof
3. König's Theorem — Proof
4. Hall's Marriage Theorem — Proof and Deficiency Form
5. Hopcroft-Karp — the O(E√V) Phase-Count Proof
6. Hungarian Algorithm (Kuhn-Munkres) — Correctness
7. Cache and Memory-Hierarchy Behavior
8. Average-Case and Randomized Analysis
9. Space-Time Trade-offs
10. Comparison (asymptotics + constants)
11. Open Problems and Research Directions
12. Code: Hungarian Algorithm (Go / Java / Python)
13. Summary

---

## 1. Formal Definitions

Let `G = (L ∪ R, E)` be a bipartite graph with disjoint vertex parts `L`, `R` and `E ⊆ L × R`.

**Definition 1.1 (Matching).** A set `M ⊆ E` is a *matching* if no two edges of `M` share an endpoint; equivalently every vertex has degree ≤ 1 in the subgraph `(L ∪ R, M)`.

**Definition 1.2 (Saturation).** A vertex `x` is *`M`-saturated* (matched) if some edge of `M` is incident to it, otherwise *`M`-free* (exposed).

**Definition 1.3 (Alternating / augmenting path).** Relative to `M`, a path is *`M`-alternating* if its edges alternate between `E∖M` and `M`. It is *`M`-augmenting* if, in addition, both endpoints are `M`-free.

**Definition 1.4 (Symmetric difference).** For edge sets `A, B`, `A ⊕ B = (A∖B) ∪ (B∖A)`.

**Definition 1.5 (Vertex cover).** `C ⊆ L ∪ R` is a *vertex cover* if every edge of `E` has at least one endpoint in `C`. `τ(G)` denotes the minimum cover size.

**Definition 1.6 (Independent set).** `I ⊆ L ∪ R` is *independent* if no edge has both endpoints in `I`. `α(G)` denotes the maximum independent-set size. `ν(G)` denotes the maximum matching size.

**Definition 1.6b (Matching parameters).** Throughout, `ν(G)` is the maximum matching size, `τ(G)` the minimum vertex cover size, and `α(G)` the maximum independent set size. We write `def(G)` for the Hall deficiency `max_{S⊆L}(|S| − |N(S)|)`. For bipartite `G` all four are computable in polynomial time; for general `G`, `τ` and `α` are NP-hard while `ν` remains polynomial (Edmonds' Blossom). This asymmetry is the single most important structural fact of the topic.

**Proposition 1.7 (Weak duality / cover lower bound).** For *any* matching `M` and any vertex cover `C`, `|M| ≤ |C|`, because each edge of `M` needs a distinct cover vertex (matching edges are disjoint, so no cover vertex covers two of them). Hence `ν(G) ≤ τ(G)` in every graph. König asserts equality in bipartite graphs.

**Proposition 1.8 (Gallai identity).** `α(G) + τ(G) = |V|`, because the complement of any vertex cover is an independent set and vice versa. Combined with König: `α(G) = |V| − ν(G)` in bipartite graphs.

---

**Remark 1.9 (Parity and the meaning of "alternating").** Because the graph is bipartite, any path alternates sides `L, R, L, R, …`. An `M`-alternating path that starts at a free `L`-vertex with a non-matching edge therefore ends, after an *odd* number of edges, at an `R`-vertex; it is augmenting iff that `R`-vertex is also free. This parity is why augmenting paths have odd edge-length and exactly one more non-matching than matching edge — the structural fact that makes "flip the path" increase `|M|` by precisely one. We use this repeatedly without restating it.

**Remark 1.10 (Notation for the proofs).** We write `M ⊕ M'` for symmetric difference (Def 1.4), `N(S)` for the neighborhood of a vertex set, and reserve the word *component* for a maximal connected subgraph of `M ⊕ M'`. Every proof below reduces to analyzing these components: their possible shapes (paths and even cycles) follow from the maximum-degree-2 property of a union of two matchings, which we establish once in §2 and reuse silently thereafter.

## 2. Berge's Augmenting-Path Theorem — Proof

**Theorem 2.1 (Berge, 1957).** A matching `M` in a graph `G` is maximum if and only if `G` has no `M`-augmenting path.

**Proof (⇒, contrapositive).** Suppose an `M`-augmenting path `P = v_0 e_1 v_1 … e_k v_k` exists, with `v_0, v_k` free and `e_1, e_3, …` in `E∖M`, `e_2, e_4, …` in `M`. Because the path starts and ends with a non-matching edge, `k` is odd and `P` has `(k+1)/2` non-matching and `(k−1)/2` matching edges. Set `M' = M ⊕ E(P)`. Each internal vertex `v_i` (`0 < i < k`) had exactly one `M`-edge on `P` and gets exactly one `M'`-edge on `P`, so `M'` is a valid matching; the endpoints `v_0, v_k` gain one edge each. Thus `|M'| = |M| + 1`, so `M` was not maximum.

**Proof (⇐).** Suppose `M` is not maximum; let `M*` be a matching with `|M*| > |M|`. Consider `H = M ⊕ M*`. In `H` every vertex has degree at most 2 (≤1 from `M`, ≤1 from `M*`), so every connected component of `H` is either a simple path or an even cycle, and along each component the edges alternate between `M` and `M*` (two `M`-edges at one vertex would violate the matching property, likewise for `M*`). Even cycles contain equally many `M` and `M*` edges. Since `|M*| − |M| = |M*∖M| − |M∖M*| > 0`, some component contains strictly more `M*` than `M` edges; being alternating and bounded-degree, such a component must be a path whose first and last edges are both in `M*`. Its endpoints are therefore unmatched by `M`, so it is an `M`-augmenting path. ∎

This theorem is the correctness certificate for Kuhn, Hopcroft-Karp, and the flow reduction alike: terminate exactly when no augmenting path remains.

---

## 3. König's Theorem — Proof

**Theorem 3.1 (König, 1931).** In a bipartite graph, `ν(G) = τ(G)`.

**Proof (constructive — yields the minimum cover).** Let `M` be a maximum matching (Berge guarantees no augmenting path). Define:

- `U` = set of `M`-free vertices in `L`.
- `Z` = set of all vertices reachable from `U` by `M`-alternating paths (start at `U`, take a non-matching edge `L→R`, then a matching edge `R→L`, repeat).

Let `Z_L = Z ∩ L`, `Z_R = Z ∩ R`. Define the candidate cover:

```
C = (L ∖ Z_L) ∪ Z_R
```

**Claim 1: `C` covers every edge.** Take any edge `(ℓ, r) ∈ E`.
- If `ℓ ∉ Z_L`, then `ℓ ∈ L∖Z_L ⊆ C`. Covered.
- If `ℓ ∈ Z_L`: then via a non-matching edge `r` is reachable, so `r ∈ Z_R ⊆ C`, *unless* `(ℓ, r) ∈ M`. But if `(ℓ, r) ∈ M` and `ℓ ∈ Z_L`, `ℓ` was reached from `R` by the matching edge `(r, ℓ)`, so `r ∈ Z_R ⊆ C`. Either way covered.

**Claim 2: `|C| = |M|`.** We show (a) every vertex of `C` is `M`-saturated, and (b) no matching edge has *both* endpoints in `C`. 
- (a) Every `ℓ ∈ L∖Z_L` is saturated: an unsaturated `ℓ` would be in `U ⊆ Z_L`, contradiction. Every `r ∈ Z_R` is saturated: an unsaturated `r ∈ Z_R` would complete an `M`-augmenting path from `U` to `r`, contradicting maximality (Berge).
- (b) Suppose `(ℓ, r) ∈ M` with `ℓ ∈ L∖Z_L` and `r ∈ Z_R`. Then `r ∈ Z_R` was reached, and from `r` the matching edge leads to `ℓ`, forcing `ℓ ∈ Z_L` — contradiction. So each matching edge contributes exactly one endpoint to `C`. 

Combining (a) and (b): `C` consists of one endpoint per matching edge, all saturated, so `|C| = |M|`. With weak duality `|M| ≤ τ(G) ≤ |C| = |M|`, equality holds throughout. ∎

The set `Z` is computed by exactly the alternating-reachability DFS shown in `middle.md`, recovering the optimal cover in `O(V+E)`.

---

## 4. Hall's Marriage Theorem — Proof and Deficiency Form

**Theorem 4.1 (Hall, 1935).** A bipartite graph has a matching saturating all of `L` iff for every `S ⊆ L`, `|N(S)| ≥ |S|`.

**Proof (⇐, via König).** The maximum matching size is `ν(G) = τ(G)`. Suppose `ν(G) < |L|`; let `C` be a minimum cover, `|C| = ν(G) < |L|`. Write `C = C_L ∪ C_R` with `C_L ⊆ L`, `C_R ⊆ R`. Consider `S = L ∖ C_L`. Then `|S| = |L| − |C_L|`. Every edge from `S` must be covered, but its `L`-endpoint is not in `C_L`, so its `R`-endpoint lies in `C_R`; hence `N(S) ⊆ C_R`, giving `|N(S)| ≤ |C_R|`. Then

```
|S| − |N(S)| ≥ (|L| − |C_L|) − |C_R| = |L| − |C| = |L| − ν(G) > 0,
```

so `|N(S)| < |S|`, violating Hall's condition. The (⇒) direction is immediate: a saturating matching gives `|S|` distinct neighbors for any `S`. ∎

**Corollary 4.2 (Deficiency / König-Ore).**

```
ν(G) = |L| − max_{S ⊆ L} ( |S| − |N(S)| ).
```

The maximizing `S` is the *bottleneck*; `def(G) = max_S(|S| − |N(S)|)` is the number of left vertices forced to remain unmatched. This is the formal basis for the "why was this rider unmatched" diagnostic in `senior.md`.

**Worked deficiency example.** Let `L = {1,2,3}` and `R = {a,b}` with edges `1-a, 2-a, 3-b`. Take `S = {1,2}`: `N(S) = {a}`, so `|S| − |N(S)| = 2 − 1 = 1`. No subset does better, so `def(G) = 1` and `ν(G) = |L| − 1 = 2`. Indeed a maximum matching is `{1-a, 3-b}` (or `{2-a, 3-b}`), leaving exactly one of `{1,2}` unmatched — the bottleneck set `{1,2}` competing for the single neighbor `a`.

---

## 5. Hopcroft-Karp — the O(E√V) Phase-Count Proof

Let `M_i` be the matching after phase `i`, and let `ℓ_i` be the length (edge count) of a shortest `M_i`-augmenting path.

**Lemma 5.1 (Lengths strictly increase).** `ℓ_{i+1} > ℓ_i`. Each phase augments along a *maximal set* of vertex-disjoint shortest augmenting paths of length `ℓ_i`; afterward, no augmenting path of length `ℓ_i` remains, so the next shortest is strictly longer. (Proof uses that the symmetric difference of `M_i` with the next maximum matching decomposes into alternating paths; any augmenting path shorter than or equal to `ℓ_i` would have shared a vertex with one already augmented, contradicting maximality of the chosen disjoint set.)

**Lemma 5.2 (Disjoint short paths are few).** Suppose at some point the shortest augmenting path has length `≥ 2k+1`. Let `M` be the current matching and `M*` a maximum matching. `M ⊕ M*` decomposes into `|M*| − |M|` vertex-disjoint augmenting paths. Each has length `≥ 2k+1`, hence uses `≥ k+1` vertices from one side… more precisely `≥ 2k+1` edges and thus `≥ k` matched edges, i.e. `≥ k` distinct vertices on each side. Since they are vertex-disjoint and there are at most `V` vertices total, `|M*| − |M| ≤ V/(k+1)`.

**Theorem 5.3.** Hopcroft-Karp runs in `O(E√V)`.

**Proof.** Run the algorithm for `√V` phases. By Lemma 5.1 the shortest augmenting path length strictly increases each phase, so after `√V` phases `ℓ ≥ √V`, i.e. `2k+1 ≥ √V`, giving `k ≥ (√V − 1)/2`. By Lemma 5.2 the number of *remaining* augmenting paths (hence remaining phases, since each phase augments at least one) is `≤ V/(k+1) = O(√V)`. So the total number of phases is `O(√V) + O(√V) = O(√V)`. Each phase is one BFS (`O(E)`) plus one DFS sweep (`O(E)` amortized, since the `dist[u]=∞` pruning ensures each edge is examined `O(1)` times per phase). Total `O(E√V)`. ∎

On *unit-capacity* networks this is exactly Dinic's bound, which is why the flow reduction (sibling `16-max-flow-edmonds-karp-dinic`) matches Hopcroft-Karp.

---

## 6. Hungarian Algorithm (Kuhn-Munkres) — Correctness

The **assignment problem**: given an `n×n` cost matrix `c`, find a perfect matching (permutation `σ`) minimizing `Σ_i c[i][σ(i)]`. This is *weighted* matching — Kuhn's cardinality algorithm does not solve it.

**Dual / potentials.** Maintain potentials `u[i]` (rows) and `v[j]` (columns) with the feasibility invariant:

```
u[i] + v[j] ≤ c[i][j]   for all i, j.
```

An edge `(i,j)` is *tight* if `u[i] + v[j] = c[i][j]`. The algorithm keeps a matching that uses only tight edges. By LP duality, `Σ u[i] + Σ v[j] ≤ cost(any assignment)`; if a *perfect* matching on tight edges exists, its cost equals `Σ u + Σ v`, certifying optimality.

**Theorem 6.1 (Correctness).** When the Hungarian algorithm terminates with a perfect matching on tight edges and feasible potentials, that matching is a minimum-cost perfect assignment.

**Proof.** Feasibility gives, for any perfect matching `σ`: `cost(σ) = Σ_i c[i][σ(i)] ≥ Σ_i (u[i] + v[σ(i)]) = Σ u + Σ v`. The returned matching `M` uses only tight edges, so `cost(M) = Σ u + Σ v`. Hence `cost(M) ≤ cost(σ)` for every perfect `σ` — `M` is optimal. ∎

**Why it terminates in `O(V³)`.** Each of the `n` rows is added to the matching via one shortest-augmenting-path search in the tight-edge subgraph; when no tight augmenting path exists, the potentials are updated by `Δ = min slack` over the alternating cut, which makes at least one new edge tight without breaking feasibility. Each row costs `O(n²)` (the slack-minimization scan), for `O(n³)` total. The standard `O(n³)` implementation (Jonker-Volgenant / the `minSlack` variant) appears in §12.

The Hungarian algorithm is equivalent to **min-cost max-flow** (sibling `18-min-cost-max-flow`) on the matching network with edge costs; the potentials are the flow's node prices and the tight-edge subgraph is the reduced-cost-zero graph.

---

## 6.5 LP Formulation and Total Unimodularity

The bipartite matching polytope explains *why* the combinatorial algorithms return integral optima. The LP relaxation of maximum matching is:

```
maximize    Σ_{(i,j)∈E} x_{ij}
subject to  Σ_j x_{ij} ≤ 1   for all i ∈ L
            Σ_i x_{ij} ≤ 1   for all j ∈ R
            x_{ij} ≥ 0
```

**Theorem 6.5.1 (Integrality).** For a *bipartite* graph, the constraint matrix of this LP is **totally unimodular** (every square submatrix has determinant in `{−1, 0, +1}`). Consequently every vertex of the polytope is integral, so the LP optimum equals the integer (combinatorial) optimum — no rounding gap. This fails for general graphs (the triangle's fractional optimum is `3/2`, exceeding the integral `1`), which is precisely why König and Hall are bipartite-only.

**Dual LP** (this is exactly the minimum vertex cover):

```
minimize    Σ_{i∈L} y_i + Σ_{j∈R} z_j
subject to  y_i + z_j ≥ 1   for all (i,j) ∈ E
            y_i, z_j ≥ 0
```

LP strong duality gives `max matching (fractional) = min cover (fractional)`; total unimodularity makes both integral; hence `ν(G) = τ(G)` — **König's theorem is LP duality plus total unimodularity.** The weighted assignment is the same machinery with an objective `Σ c_{ij} x_{ij}`; its dual variables are exactly the Hungarian potentials `u, v` of §6.

## 6.6 Worked Hungarian Trace

Run the `O(n³)` algorithm on the 3×3 cost matrix from §12:

```
      c0  c1  c2
 r0 [  4,  1,  3 ]
 r1 [  2,  0,  5 ]
 r2 [  3,  2,  2 ]
```

The dual potentials evolve so that the matched edges are tight (`u[i]+v[j] = c[i][j]`). The algorithm augments one row at a time:

- **Row 0:** cheapest entry is `c[0][1]=1`; tentatively assign `r0→c1`, potentials adjust so `u0+v1=1`.
- **Row 1:** cheapest is `c[1][1]=0`, but `c1` is taken by `r0`. The shortest-augmenting-path search in the tight subgraph relocates: `r1→c1`, pushing `r0→` its next-tightest `c0` or `c2`. Potential update raises a new tight edge.
- **Row 2:** augment into the remaining free column.

Final assignment: `r0→c1 (1)`, `r1→c0 (2)`, `r2→c2 (2)`, total `= 5`. The certificate is the potential vector with `Σu + Σv = 5`, proving by weak duality that no assignment costs less. The Go/Java/Python code in §12 reproduces exactly this `(5, [1,0,2])` result.

The key invariant to verify when debugging a Hungarian implementation: after every phase, `u[i]+v[j] ≤ c[i][j]` for *all* `i,j` (feasibility) and `=` on matched edges (tightness). A violated inequality means the `delta` update was computed over the wrong (used vs unused) column set.

---

## 7. Cache and Memory-Hierarchy Behavior

- **Adjacency lists** scatter neighbor accesses; the augmenting DFS chases pointers and incurs frequent cache misses on `matchR[v]` for popular `v`. **CSR layout** (contiguous `dst[]`) restores spatial locality for the neighbor scan, though `matchR[]` lookups remain random.
- **Hopcroft-Karp BFS** touches `dist[]` and `matchR[]` in near-random order; on graphs that fit in L2 this is fine, but at `V > 10⁶` the random `matchR[]` accesses dominate runtime — a memory-bound, not compute-bound, regime.
- **Hungarian** is `O(n²)` matrix-bound; the `minSlack` array gives sequential `O(n)` scans per phase with excellent locality, which is why dense `O(n³)` Hungarian is often faster in practice than its asymptotics suggest for `n ≤ 2000`.
- **Timestamp `visited`** (senior.md) avoids `O(V)` cache-polluting array clears per augmentation — a real constant-factor win.

---

## 7.5 Formal Correctness of the Min-Vertex-Cover Recovery

The `middle.md` recovery procedure deserves a rigorous statement, since it is the algorithmic content of König's proof.

**Procedure.** Given a maximum matching `M`, let `Z` be the set of vertices reachable from `M`-free left vertices by `M`-alternating paths (non-matching `L→R`, matching `R→L`). Output `C = (L∖Z) ∪ (R∩Z)`.

**Theorem 7.5.1.** `C` is a minimum vertex cover, and `|C| = |M|`, computed in `O(V+E)`.

**Proof of cover (no edge escapes `C`).** Suppose some edge `(ℓ,r)` is uncovered: `ℓ ∈ Z` and `r ∉ Z`. Since `ℓ ∈ Z∩L`, there is an alternating path from a free left vertex to `ℓ`. 
- If `(ℓ,r) ∉ M`: extend that path by the non-matching edge `(ℓ,r)` to reach `r`, so `r ∈ Z` — contradiction.
- If `(ℓ,r) ∈ M`: then `ℓ` was *entered* via the matching edge from `r`, so `r` precedes `ℓ` on the path and `r ∈ Z` — contradiction.
So no uncovered edge exists. ∎ (size argument as in §3, Claim 2.)

**Why `O(V+E)`:** the alternating reachability is a single graph search where each edge is traversed at most once in each direction. The matched-edge lookups are `O(1)` via `matchR/matchL` arrays. This recovery runs *after* the `O(E√V)` matching, so it is asymptotically free.

**Corollary 7.5.2 (Maximum independent set).** `I = (L∩Z) ∪ (R∖Z)` is a maximum independent set of size `|V| − |M|`. By Gallai (Prop 1.8) `α = |V| − τ = |V| − ν`, and `I` is precisely the complement of `C`. This gives a *polynomial* maximum-independent-set algorithm for bipartite graphs, in stark contrast to the NP-hardness of MIS on general graphs.

## 8. Average-Case and Randomized Analysis

- On a random bipartite graph `G(n,n,p)` with `p = c·ln n / n` above the threshold `c > 1`, a **perfect matching exists w.h.p.** (Erdős-Rényi threshold for matchings), and Kuhn finds it after `O(n)` augmentations with *short* paths, so the *average* runtime is far below `O(V·E)`.
- Hopcroft-Karp on random dense graphs uses `O(log V)`-ish phases in practice rather than `√V`; the worst case is realized only by adversarial "long alternating chain" constructions.
- Greedy pre-matching saturates a constant fraction (≈ `1 − e^{-c}`) of vertices instantly on random inputs, slashing the number of expensive DFS launches.
- For online arrival the **RANKING** algorithm achieves competitive ratio `1 − 1/e ≈ 0.632` in expectation, optimal among randomized online algorithms (Karp-Vazirani-Vazirani, 1990).

---

## 8.5 Concentration of the Augmenting-Path Length

A subtle average-case fact underpins the empirical speed of Kuhn on random inputs. On `G(n,n,p)` just above the perfect-matching threshold, the symmetric difference between a partial matching and a maximum one decomposes into augmenting paths whose lengths are, with high probability, `O(log n)` — not `Θ(n)`. The reason is expansion: above the threshold the graph is an expander, so alternating BFS reaches a free vertex within `O(log n)` layers. Hence each Kuhn augmentation explores `O(log n · avgdeg)` edges rather than `O(E)`, and the *total* expected work is `O(n · log n · avgdeg) = O(E log n)` — far below the `O(V·E)` worst case. This is why a textbook `O(V·E)` Kuhn routinely outruns its bound on real data, and why Hopcroft-Karp's phase count is `O(log n)`-ish in practice rather than `√V`. The worst case is realized only by adversarial "long alternating chain" gadgets that defeat expansion.

## 9. Space-Time Trade-offs

| Choice | Space | Time effect |
|--------|-------|-------------|
| Adjacency list vs matrix | `O(V+E)` vs `O(V²)` | matrix only worth it for dense `Hungarian` |
| CSR vs list-of-lists | same `O(V+E)`, lower constant | fewer cache misses on neighbor scan |
| Timestamp visited | `O(V)` extra ints | `O(1)` reset vs `O(V)` |
| Recursive vs iterative DFS | stack `O(V)` either way | iterative avoids overflow on long chains |
| Storing `matchL` and `matchR` | `O(V)` extra | `O(1)` partner lookup both directions |
| Caching the dual (cover/prices) | `O(V)` | free explainability, no recompute |

---

## 10. Comparison (asymptotics + constants)

| Algorithm | Time | Space | Constant factor | Notes |
|-----------|------|-------|-----------------|-------|
| Kuhn (DFS aug.) | `O(V·E)` | `O(V+E)` | tiny | best for clarity, small graphs |
| Hopcroft-Karp | `O(E√V)` | `O(V+E)` | small | production cardinality choice |
| Dinic (flow reduction) | `O(E√V)` unit-cap | `O(V+E)` | moderate | reuse of flow infra (sibling 16) |
| Hungarian (Kuhn-Munkres) | `O(V³)` | `O(V²)` | small for dense | the assignment problem |
| Min-cost max-flow | `O(V·E·log)` or SPFA-based | `O(V+E)` | moderate | weighted, capacitated (sibling 18) |
| Scaling/auction (weighted) | `O(E√V log(VC))` | `O(V+E)` | larger | best-known weighted bipartite |

The best known strongly-polynomial cardinality bipartite bound remains `O(E√V)`; weighted bipartite has scaling algorithms at `O(E√V log(VC))` (Gabow-Tarjan) for integer costs in `[0,C]`.

---

## 10.5 The Equivalence Web (formal summary)

These five problems are mutually polynomial-time reducible (and for bipartite graphs, *equal in value*), which is why mastering matching unlocks all of them:

```
   maximum matching  ν(G)
        |  König (TU + LP duality)
        v
   minimum vertex cover  τ(G) = ν(G)
        |  Gallai complement
        v
   maximum independent set  α(G) = |V| − ν(G)
        |  Dilworth (vertex split)
        v
   minimum DAG path cover  = N − ν(G_split)
        |  Hall (deficiency)
        v
   existence of L-saturating matching  ⟺  def(G) = 0
```

**Reduction sizes.** König and Gallai are `O(V+E)` post-processing of one matching. The DAG path-cover reduction *doubles* the vertex set (`x → x_out, x_in`) and maps each arc to one bipartite edge, so it is `O(V+E)` to build and one matching to solve. Hall's deficiency is read off the same alternating-reachability set `Z` used for the cover (`def = |Z∩L| − |Z∩R|` over the bottleneck component). None of these reductions changes the asymptotic class: everything stays `O(E√V)` for cardinality.

**Why weighted breaks the chain.** The moment edges carry costs, the dual objects become *fractional prices* (Hungarian `u,v`) rather than vertex sets, König/Gallai no longer apply directly, and the complexity jumps to `O(V³)` (Hungarian) or the flow bound (sibling `18-min-cost-max-flow`). The clean combinatorial duality is a property of the *cardinality* problem and its totally-unimodular polytope.

## 10.6 Numerical Stability and Integer Overflow (Hungarian)

A practical professional concern: the Hungarian potentials accumulate. With `n = 400` and costs up to `10⁹`, the running `u[i]+v[j]` sums can reach `~n · maxCost ≈ 4×10¹¹`, overflowing 32-bit integers. Use 64-bit accumulators (the code in §12 uses `int`/`long`/Python big-ints accordingly). For floating costs, prefer integer scaling (multiply by a fixed precision and round) to keep the tight-edge comparisons exact; floating equality on `u[i]+v[j] == c[i][j]` is fragile and can loop forever. This is the single most common production bug in Hungarian implementations after the used/unused column-set error noted in §6.6.

---

## 11. Open Problems and Research Directions

- **Beating `O(E√V)` for cardinality bipartite matching** in the worst case is a long-standing open problem in combinatorial settings; recent breakthroughs use **continuous optimization / interior-point + Laplacian solvers** to get near-linear-time *approximate* and even exact algorithms for bipartite matching and min-cost flow (Chen-Kyng-Liu-Peng-Probst-Gutenberg-Sachdeva, 2022, achieved almost-linear-time max-flow / min-cost-flow), which subsumes matching.
- **Dynamic matching** — maintaining a near-maximum matching under edge insertions/deletions with low update time — is very active; constant-approximation with polylog update time is known, exact dynamic maximum matching is hard.
- **Online and stochastic matching** — improving the `1−1/e` barrier under stochastic arrivals (the prophet/secretary matching variants).
- **Parallel / distributed exact matching** — work-efficient parallel algorithms remain elusive; most practical large-scale systems settle for approximate or LP-rounded solutions.

---

## 12. Code: Hungarian Algorithm (Go / Java / Python)

An `O(n³)` `minSlack` implementation solving the **minimum-cost assignment** on an `n×n` matrix. Returns the optimal cost and the assignment `colOf[i]`.

```go
package main

import "fmt"

const INF = 1 << 60

// Hungarian: minimum-cost perfect assignment on an n x n cost matrix.
// Returns total cost and rowAssign where rowAssign[i] = matched column.
func Hungarian(cost [][]int) (int, []int) {
	n := len(cost)
	u := make([]int, n+1) // row potentials
	v := make([]int, n+1) // column potentials
	p := make([]int, n+1) // p[j] = row assigned to column j (1-indexed; 0 = none)
	way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i
		j0 := 0
		minv := make([]int, n+1)
		used := make([]bool, n+1)
		for j := 0; j <= n; j++ {
			minv[j] = INF
		}
		for {
			used[j0] = true
			i0 := p[j0]
			delta := INF
			j1 := -1
			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := cost[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] {
						minv[j] = cur
						way[j] = j0
					}
					if minv[j] < delta {
						delta = minv[j]
						j1 = j
					}
				}
			}
			for j := 0; j <= n; j++ {
				if used[j] {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}
			j0 = j1
			if p[j0] == 0 {
				break
			}
		}
		for j0 != 0 {
			j1 := way[j0]
			p[j0] = p[j1]
			j0 = j1
		}
	}
	rowAssign := make([]int, n)
	total := 0
	for j := 1; j <= n; j++ {
		if p[j] != 0 {
			rowAssign[p[j]-1] = j - 1
			total += cost[p[j]-1][j-1]
		}
	}
	return total, rowAssign
}

func main() {
	cost := [][]int{
		{4, 1, 3},
		{2, 0, 5},
		{3, 2, 2},
	}
	c, a := Hungarian(cost)
	fmt.Println("min cost:", c, "assign:", a) // min cost: 5
}
```

```java
import java.util.*;

public class Hungarian {
    static final long INF = Long.MAX_VALUE / 4;

    // Minimum-cost assignment on n x n matrix; returns {cost, assignment...}.
    public static long solve(int[][] cost, int[] rowAssign) {
        int n = cost.length;
        long[] u = new long[n + 1], v = new long[n + 1];
        int[] p = new int[n + 1], way = new int[n + 1];
        for (int i = 1; i <= n; i++) {
            p[0] = i;
            int j0 = 0;
            long[] minv = new long[n + 1];
            boolean[] used = new boolean[n + 1];
            Arrays.fill(minv, INF);
            do {
                used[j0] = true;
                int i0 = p[j0], j1 = -1;
                long delta = INF;
                for (int j = 1; j <= n; j++) {
                    if (!used[j]) {
                        long cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                    }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                    else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        long total = 0;
        for (int j = 1; j <= n; j++)
            if (p[j] != 0) { rowAssign[p[j] - 1] = j - 1; total += cost[p[j] - 1][j - 1]; }
        return total;
    }

    public static void main(String[] args) {
        int[][] cost = {{4, 1, 3}, {2, 0, 5}, {3, 2, 2}};
        int[] assign = new int[cost.length];
        System.out.println("min cost: " + solve(cost, assign)); // 5
        System.out.println("assign: " + Arrays.toString(assign));
    }
}
```

```python
INF = float("inf")

def hungarian(cost):
    """Minimum-cost assignment on an n x n matrix. Returns (total, row_assign)."""
    n = len(cost)
    u = [0] * (n + 1)
    v = [0] * (n + 1)
    p = [0] * (n + 1)     # p[j] = row matched to column j (1-indexed; 0 = none)
    way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (n + 1)
        used = [False] * (n + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = INF
            j1 = -1
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
    row_assign = [0] * n
    total = 0
    for j in range(1, n + 1):
        if p[j]:
            row_assign[p[j] - 1] = j - 1
            total += cost[p[j] - 1][j - 1]
    return total, row_assign

if __name__ == "__main__":
    cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]]
    print(hungarian(cost))  # (5, [1, 0, 2])  -> rows pick cols 1,0,2 = 1+2+2 = 5
```

All three find the optimal assignment of cost **5** (row 0→col 1 = 1, row 1→col 0 = 2, row 2→col 2 = 2).

---

## 12.5 Verifying an Implementation

Before trusting any matching code, assert these invariants in tests — they catch the overwhelming majority of bugs:

- **Symmetry:** for every `v` with `matchR[v] = u`, also `matchL[u] = v`, and vice versa. A broken symmetry means a claim/relocation forgot to update one side.
- **Disjointness:** each left and each right vertex appears in at most one matched edge (`matchR` and `matchL` are partial injections).
- **Cardinality bound:** `|M| ≤ min(|L|, |R|)`.
- **Maximality certificate:** after termination, run one more augmenting search from each free left vertex; if any succeeds, the algorithm stopped early (Berge violated).
- **Cross-check:** Kuhn and Hopcroft-Karp must return the *same* size on every input (the matching itself may differ).
- **Hungarian duality:** `Σ u + Σ v == cost(returned assignment)` and feasibility `u[i]+v[j] ≤ c[i][j]` for all `i,j`.

A property-based test that generates random bipartite graphs and checks Kuhn == HK == flow-reduction size is the single highest-value test for this topic. Add a separate generator that builds graphs with a *known* deficiency (e.g. `k` left vertices wired to `k−1` shared right neighbors) so the test also pins the exact maximum size, not just cross-algorithm agreement.

## 13. Summary

- **Berge:** maximum ⇔ no augmenting path, proved via the symmetric-difference decomposition into alternating paths and even cycles.
- **König:** `ν = τ` in bipartite graphs, proved constructively by alternating reachability from free left vertices, recovering the optimal cover.
- **Hall:** `L`-saturation ⇔ `|N(S)| ≥ |S|`; the deficiency `max(|S| − |N(S)|)` is the exact unmatched count.
- **Hopcroft-Karp** is `O(E√V)` because shortest augmenting-path length strictly increases per phase and disjoint long paths are bounded by `V/k`, giving `O(√V)` phases.
- **Hungarian** solves the *weighted* assignment in `O(V³)` via dual potentials and tight edges; correctness is LP weak-duality made tight; it is min-cost flow specialized.
- Near-linear-time exact matching via continuous optimization, dynamic matching, and online stochastic matching are the live research frontiers.
- **Total unimodularity** of the bipartite incidence structure is the deep reason the LP relaxation is integral, making König exactly LP duality and explaining why all the cardinality dual objects (cover, independent set, path cover) are polynomially computable here but NP-hard in general graphs.
- Practical correctness rests on a small set of checkable invariants (matching symmetry, disjointness, the Berge maximality certificate, and Hungarian dual tightness); a property-based cross-check among Kuhn, Hopcroft-Karp, and the flow reduction is the strongest single test.
