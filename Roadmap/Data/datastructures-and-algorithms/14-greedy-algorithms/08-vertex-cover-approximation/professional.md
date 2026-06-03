# Vertex Cover Approximation — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Cover, Matching, Independent Set
2. The Maximal-Matching Algorithm (statement)
3. Rigorous Proof of the 2-Approximation Bound
4. Tightness of the Factor 2
5. The LP Relaxation, Half-Integrality, and LP Rounding
6. König's Theorem (statement and proof sketch)
7. NP-Hardness and Inapproximability (1.36, UGC-2)
8. Parameterized Complexity and Kernelization
9. Space–Time Trade-offs
10. Comparison with Alternatives
11. Open Problems and Summary
12. Reference Code (Matching / FPT, Go / Java / Python)

---

## 1. Formal Definitions — Cover, Matching, Independent Set

Let `G = (V, E)` be a finite undirected simple graph with `|V| = n` and `|E| = m`. Self-loops are excluded; parallel edges may be collapsed without changing any cover.

**Definition 1.1 (Vertex cover).** A set `S ⊆ V` is a *vertex cover* if for every edge `(u, v) ∈ E`, `u ∈ S` or `v ∈ S`. Write `τ(G)` for the minimum size of a vertex cover (`OPT`).

**Definition 1.2 (Matching).** A set `M ⊆ E` is a *matching* if no two edges of `M` share an endpoint. `ν(G)` denotes the maximum matching size.

**Definition 1.3 (Maximal matching).** A matching `M` is *maximal* if no edge of `E \ M` can be added while preserving the matching property — equivalently, every edge of `G` has an endpoint matched by `M`. (Maximal ≠ maximum: a maximal matching need not be of maximum size.)

**Definition 1.4 (Independent set).** A set `I ⊆ V` is *independent* if no edge has both endpoints in `I`. `α(G)` denotes the maximum independent set size.

**Lemma 1.5 (Complementarity).** `S` is a vertex cover ⟺ `V \ S` is independent. Hence `τ(G) + α(G) = n`.

*Proof.* `S` covers every edge ⟺ no edge has both endpoints in `V \ S` ⟺ `V \ S` is independent. Taking minimum cover and maximum independent set, `τ + α = n`. ∎

**Lemma 1.6 (Matching lower bound).** For any matching `M`, `τ(G) ≥ |M|`.

*Proof.* The edges of `M` are pairwise vertex-disjoint. Any vertex cover must contain at least one endpoint of each `e ∈ M` (to cover `e`), and these endpoints are distinct across `M`, so the cover has at least `|M|` vertices. ∎

A consequence and the central duality: `ν(G) ≤ τ(G)` always (take `M` maximum). The gap can be strict for non-bipartite graphs (the triangle: `ν = 1 < 2 = τ`).

---

## 2. The Maximal-Matching Algorithm (statement)

**Algorithm (Gavril / Yannakakis).**

```
S ← ∅
while E has an edge (u, v) with u ∉ S and v ∉ S:
    S ← S ∪ {u, v}
return S
```

Let `M` be the set of edges `(u, v)` that triggered an addition. The algorithm runs in `O(n + m)` time and `O(n)` space (boolean membership array, single edge scan).

**Observation 2.1.** `M` is a maximal matching. *Disjoint:* a trigger requires both endpoints uncovered, after which both are covered, so no later trigger reuses them. *Maximal:* on termination no uncovered edge remains, so every edge has a covered (matched) endpoint.

**Observation 2.2.** `|S| = 2|M|` (each trigger adds exactly two new vertices).

---

## 3. Rigorous Proof of the 2-Approximation Bound

**Theorem 3.1.** The maximal-matching algorithm returns a vertex cover `S` with `|S| ≤ 2·τ(G)`.

*Proof.*

**(a) `S` is a vertex cover.** Suppose not: some edge `(u, v)` has `u ∉ S` and `v ∉ S` at termination. Then `(u, v)` is uncovered, so the `while` loop would not have terminated — contradiction. Hence every edge is covered.

**(b) Size bound.** By Observation 2.2, `|S| = 2|M|`. Since `M` is a matching, Lemma 1.6 gives `τ(G) ≥ |M|`, i.e. `|M| ≤ τ(G)`. Therefore

```
|S| = 2|M| ≤ 2·τ(G).   ∎
```

The proof is the two-line interplay of an *upper bound on the algorithm* (`|S| = 2|M|`) and a *lower bound on the optimum* (`τ ≥ |M|`), both flowing from the single structural fact that `M` is a vertex-disjoint set of edges. This is why "take both endpoints" is essential: it is what makes the triggered edges a matching, which is what licenses `τ ≥ |M|`.

### 3.1 Worked instance of the bound

Take the 5-cycle-plus-chord `G` on `{0,1,2,3,4}` with edges `01, 12, 23, 34, 40, 13`, scanned in that order.

```
trigger 01 → S = {0,1}, M = {01}
12 covered (1∈S)
trigger 23 → S = {0,1,2,3}, M = {01,23}
34, 40, 13 covered
```

`|M| = 2`, `|S| = 4`. The true optimum is `{1,3,4}` of size `τ = 3`. Check the chain: `|M| = 2 ≤ τ = 3` (Lemma 1.6) and `|S| = 4 ≤ 2τ = 6` (Theorem 3.1). Both inequalities hold with room to spare — the worst case (`|S| = 2τ`) is not attained here.

### 3.2 The bound holds for *every* maximal matching

The proof never used *which* edges triggered, only that they form a matching. So **any** maximal matching `M` yields a cover `2|M| ≤ 2τ`. Different scan orders give different (valid) 2-approximations; the guarantee is order-independent even though the output set is not.

---

## 4. Tightness of the Factor 2

**Theorem 4.1.** The factor 2 is tight for the maximal-matching algorithm: there exist graphs where `|S| = 2·τ(G)` exactly.

*Proof (perfect matching witness).* Let `G` be a single edge `K_2`. The algorithm triggers on it, returning `S = {u, v}`, `|S| = 2`. But `τ(K_2) = 1` (either endpoint covers the edge). So `|S| = 2 = 2·τ`. More generally, a disjoint union of `k` edges (a perfect matching on `2k` vertices) gives `|S| = 2k` while `τ = k`, achieving `2·τ` for every `k`. ∎

So no analysis of this algorithm can prove a factor below 2. To do better requires either a different algorithm (none beats `2 − o(1)` in general — Section 7) or structural assumptions (bipartite → König, Section 6).

**Remark (slight improvements).** The best known *general* approximation factor is `2 − Θ(1/√(log n))` (Karakostas, building on Halperin), an `o(1)` improvement over 2 — confirming that breaking the `2` barrier by a *constant* is, conjecturally, impossible (Section 7).

---

## 5. The LP Relaxation, Half-Integrality, and LP Rounding

**Definition 5.1 (Cover LP).** With weights `w: V → ℝ_{≥0}` (unit weights for unweighted cover):

```
(IP)  min Σ_v w_v x_v   s.t.  x_u + x_v ≥ 1  ∀(u,v)∈E,   x_v ∈ {0,1}
(LP)  min Σ_v w_v x_v   s.t.  x_u + x_v ≥ 1  ∀(u,v)∈E,   0 ≤ x_v ≤ 1
```

`LP*` denotes the LP optimum. Since every integer cover is LP-feasible, `LP* ≤ τ_w(G)` (`= OPT` in the weighted sense).

**Theorem 5.2 (LP rounding 2-approximation).** Let `x*` be an optimal LP solution. The set `S = { v : x*_v ≥ ½ }` is a vertex cover with `w(S) ≤ 2·LP* ≤ 2·OPT`.

*Proof.* **Feasibility:** for each edge, `x*_u + x*_v ≥ 1` forces `max(x*_u, x*_v) ≥ ½`, so an endpoint is selected; the edge is covered. **Bound:** every `v ∈ S` has `x*_v ≥ ½`, hence `1 ≤ 2x*_v`, so `w(S) = Σ_{v∈S} w_v ≤ Σ_{v∈S} w_v·2x*_v ≤ 2·Σ_v w_v x*_v = 2·LP*`. ∎

**Theorem 5.3 (Half-integrality, Nemhauser–Trotter 1975).** The vertex-cover LP has an optimal solution with `x*_v ∈ {0, ½, 1}` for all `v`.

*Proof idea.* Given any optimal `x*`, perturb the non-half-integral coordinates: set `V_{>½} = {v : x*_v > ½}`, `V_{<½} = {v : x*_v < ½}`, and shift `x_v ← x_v + ε` on `V_{>½}` and `x_v ← x_v − ε` on `V_{<½}` (and the reverse). Both perturbations preserve every edge constraint (each edge has either two `=½` endpoints, or an endpoint `>½` matched against one `≥0`), and one of the two directions does not increase the objective. Pushing `ε` to the boundary makes a coordinate hit `{0, ½, 1}`; iterate. ∎

**Corollary 5.4 (NT kernel).** Let `P_0 = {x*_v = 0}`, `P_1 = {x*_v = 1}`, `P_½ = {x*_v = ½}`. There is a minimum cover containing all of `P_1` and none of `P_0`; the problem reduces to the subgraph induced by `P_½`, which has `≤ 2·OPT` vertices. This yields a **kernel of size ≤ 2k** for the parameterized problem (Section 8).

This is the deep payoff of the LP view: it is not merely a second 2-approximation, it *structurally decomposes* the instance into "must-take," "never-take," and an undecided half-integral core.

---

## 6. König's Theorem (statement and proof sketch)

**Theorem 6.1 (König 1931 / Egerváry).** In a bipartite graph `G`, `τ(G) = ν(G)` — the minimum vertex cover equals the maximum matching.

*Proof sketch (via augmenting paths / max-flow min-cut).* `τ ≥ ν` holds for all graphs (Lemma 1.6 with `M` maximum). For the reverse on bipartite `G` with sides `L, R`:

1. Compute a maximum matching `M` (Hopcroft–Karp, `O(m√n)`).
2. Let `U ⊆ L` be the `M`-unmatched left vertices. Let `Z` be all vertices reachable from `U` by *alternating paths* (non-matching edges `L→R`, matching edges `R→L`).
3. Define `C = (L \ Z) ∪ (R ∩ Z)`.

*`C` is a cover:* an uncovered edge would join `L ∩ Z` to `R \ Z`. If `(ℓ, r)` with `ℓ ∈ L∩Z`, `r ∈ R\Z`: the edge is either matching or non-matching. A non-matching edge from `ℓ ∈ Z` would put `r ∈ Z` (contradiction); a matching edge would mean `ℓ` was reached *via* `r`, so `r ∈ Z` (contradiction). Hence no such edge — `C` covers `E`.

*`|C| = |M|`:* every vertex of `C` is matched (an unmatched `L`-vertex is in `U ⊆ Z`, so not in `L\Z`; an unmatched `R`-vertex is unreachable, so not in `R∩Z`), and no matching edge has *both* endpoints in `C` (one endpoint argument via the alternating structure). So `C` injects into `M`, giving `|C| ≤ |M| = ν`. Combined with `τ ≥ ν` and `C` a cover (`τ ≤ |C|`): `τ = ν`. ∎

**Why bipartiteness is essential.** The argument relies on no *odd* cycles: alternating paths cannot "close up." The triangle `K_3` is the minimal counterexample — `ν(K_3) = 1` but `τ(K_3) = 2` — so König is strictly false on non-bipartite graphs. König is equivalent (via LP duality) to the integrality of the bipartite cover LP: for bipartite `G` the constraint matrix is totally unimodular, so `LP* = τ` is an integer and the half-integral `½`'s never appear.

---

## 7. NP-Hardness and Inapproximability (1.36, UGC-2)

**Theorem 7.1 (Karp 1972).** Minimum vertex cover (decision form: "is `τ(G) ≤ k`?") is NP-complete.

*Proof idea.* Membership in NP: a cover of size `≤ k` is a poly-checkable certificate. Hardness: reduce from CLIQUE/INDEPENDENT SET via Lemma 1.5 — `G` has an independent set of size `≥ n − k` iff `G` has a vertex cover of size `≤ k`, and independent set is NP-hard. ∎

So no polynomial algorithm computes `τ(G)` exactly unless P = NP, justifying approximation.

**Theorem 7.2 (APX-hardness; Dinur–Safra 2005).** It is NP-hard to approximate minimum vertex cover within any factor below `1.3606`. (Earlier: Håstad gave `7/6 ≈ 1.166`; Dinur–Safra improved it to `10√5 − 21 ≈ 1.3606`.)

*Significance.* Vertex cover is **APX-complete**: it has a constant-factor approximation (2) but no PTAS — there is a fixed `c > 1` below which approximation is NP-hard. The gap between the achievable `2 − o(1)` and the hardness `1.36` is one of the famous open intervals in approximation theory.

**Theorem 7.3 (UGC-hardness; Khot–Regev 2008).** Assuming the **Unique Games Conjecture (UGC)**, it is NP-hard to approximate minimum vertex cover within `2 − ε` for every `ε > 0`.

*Significance.* Under UGC, the trivial-looking factor 2 is **optimal** — no polynomial algorithm beats `2 − ε`. This is the strongest possible statement: the simple maximal-matching algorithm is, conditionally, the best one can do up to lower-order terms. The matching 2-approximation is thus not a placeholder for something cleverer; it is conjecturally tight.

```mermaid
flowchart LR
    A["Achievable: 2 − Θ(1/√log n)"] --> B["? open interval ?"]
    B --> C["NP-hard below 1.3606 (Dinur–Safra)"]
    C --> D["UGC-hard below 2 − ε (Khot–Regev)"]
```

The picture: unconditionally we know hardness only up to `1.36`; conditionally (UGC) the hardness rises all the way to `2`, matching the algorithm.

---

## 8. Parameterized Complexity and Kernelization

**Definition 8.1 (Parameterized problem).** `p-VERTEX-COVER`: given `(G, k)`, decide `τ(G) ≤ k`, parameterized by `k`.

**Theorem 8.2 (FPT).** `p-VERTEX-COVER ∈ FPT`: solvable in `O(2^k·(n+m))` by bounded-search-tree branching.

*Proof.* Pick an edge `(u, v)`; every cover contains `u` or `v`. Recurse on `(G−u, k−1)` and `(G−v, k−1)`. The tree has depth `≤ k`, branching 2, so `≤ 2^{k+1}` leaves, each `O(n+m)` work. ∎

**Theorem 8.3 (Improved branching).** Branching on a vertex `v` of degree `≥ 3` ("include `v`, budget `k−1`" vs "exclude `v`, include all `deg(v) ≥ 3` neighbors, budget `k − deg(v)`") yields recurrences `T(k) ≤ T(k−1) + T(k−3)`, solving to `O(1.466^k)`; refined rule sets reach `O(1.2738^k)` (Chen–Kanj–Xia).

**Theorem 8.4 (Linear kernel, Nemhauser–Trotter).** `p-VERTEX-COVER` admits a kernel with `≤ 2k` vertices: solve the LP (half-integral, Theorem 5.3), fix the `0`/`1` vertices, and keep only the `½`-vertices. If more than `2k` vertices remain at value `½`, answer *no* (the LP bound `LP* > k` implies `OPT > k`). A crown-decomposition argument also gives a `2k`-vertex kernel combinatorially.

**Corollary 8.5.** Kernelize in poly time to `≤ 2k` vertices, then branch in `O(1.2738^k)`: the exponential cost is fully confined to the small parameter, which is why FPT is the right tool when `OPT` is small (the bioinformatics regime of `senior.md`).

### 8.0a LP duality: the matching bound *is* weak LP duality

The matching lower bound `τ ≥ |M|` and the LP route are not separate facts — they are two sides of LP duality. The **dual** of the cover LP is the **fractional matching LP**:

```
(primal, cover)    min Σ_v x_v   s.t.  x_u + x_v ≥ 1,  x_v ≥ 0
(dual,  matching)  max Σ_e y_e   s.t.  Σ_{e ∋ v} y_e ≤ 1,  y_e ≥ 0
```

The dual variable `y_e` is a *fractional* weight on edge `e`, constrained so the weights at each vertex sum to ≤ 1 — a *fractional matching*. By weak LP duality, any feasible fractional matching value is `≤ LP* ≤ τ`. An *integral* matching `M` (set `y_e = 1` on `M`, `0` elsewhere) is a feasible dual solution of value `|M|`, recovering `τ ≥ |M|` as a special case. So the maximal-matching algorithm and the LP rounding algorithm are the *same* 2-approximation viewed combinatorially vs fractionally; the matching is just an integral dual certificate. For bipartite graphs the primal and dual LPs are both integral (total unimodularity), and strong duality collapses to König's `τ = ν`.

### 8.1 The bigger picture

Vertex cover is the *flagship* FPT problem — the example every parameterized-complexity course opens with — precisely because it combines a clean branching, a linear kernel, and real applications where `k ≪ n`. Contrast with its complement, *independent set* (parameterized by solution size), which is **W[1]-hard** and not believed to be FPT: minimizing the small cover is parameterized-tractable while maximizing the large independent set is not, a sharp asymmetry mirroring the approximation gap (2 vs no constant factor).

---

## 8b. The Gavril–Yannakakis Analysis and Its Limits

**Proposition 8b.1 (no instance-independent improvement).** For the maximal-matching algorithm there is no fixed `c < 2` with `|S| ≤ c·τ` on all graphs (Theorem 4.1, the disjoint-edge witness). However, the *per-instance* ratio `|S| / τ` can be characterized.

**Proposition 8b.2 (per-instance ratio).** `|S| / τ(G) = 2|M| / τ(G)`, and since `|M| ≤ ν ≤ τ`, the ratio is `2·(|M|/τ) ≤ 2`. It is exactly 2 iff `|M| = τ`, which for a maximal matching `M` means the maximal matching is maximum *and* equals the cover number — characteristic of graphs that are unions of edges (every component a single edge or "edge-dominated"). For graphs far from this (dense graphs, graphs with high-degree hubs), `|M| ≪ τ` is impossible (since `τ ≤ 2|M|` from the cover side too), but `2|M|/τ` typically sits well below 2.

**Proposition 8b.3 (tight pairing with the lower bound).** Combining the cover and matching sides: for *any* maximal matching, `|M| ≤ τ ≤ 2|M|`. So the maximal matching size `|M|` *brackets* the optimum within a factor of 2 from both directions — it is simultaneously a lower bound (`τ ≥ |M|`) and, via the cover it induces, an upper bound (`τ ≤ 2|M|`). This two-sided bracketing is the cleanest statement of what one linear pass buys you: the optimum is pinned to the interval `[|M|, 2|M|]`.

This is why reporting `|M|` (or a larger matching) as a *certificate* is principled: it is a genuine, proof-carrying lower bound, and the gap `[|M|, 2|M|]` is the exact uncertainty the algorithm leaves.

---

## 9. Space–Time Trade-offs

| Method | Time | Space | Quality |
|--------|------|-------|---------|
| Maximal-matching 2-approx | `O(n + m)` | `O(n)` | `≤ 2·OPT` |
| LP rounding | LP solve (poly) | `O(n + m)` | `≤ 2·OPT`, weighted |
| König (bipartite) | `O(m√n)` | `O(n + m)` | exact (`= OPT`) |
| FPT branching | `O(1.2738^k·(n+m))` | `O(k + n)` | exact |
| NT kernel + branch | `poly + O(1.2738^k·k)` | `O(n + m)` | exact |
| Brute force | `O(2^n·m)` | `O(n)` | exact |

The fundamental trade-off: **a constant-factor (2) cover is linear-time, but exactness costs either polynomial structure (bipartite/König), small-parameter exponential (FPT), or full exponential (brute force/ILP)**. The 2-approximation is the production sweet spot for general graphs; FPT is the sweet spot when `OPT` is small.

---

## 10. Comparison with Alternatives

| Task | Matching 2-approx | Alternative | Asymptotics |
|------|-------------------|-------------|-------------|
| Unweighted ≤2·OPT cover | `O(n+m)` | LP rounding | LP solve (slower, same factor) |
| Weighted cover | n/a | LP rounding 2-approx | poly LP |
| Bipartite exact | ≤2·OPT | König (max matching) | `O(m√n)` exact |
| Small exact cover | ≤2·OPT | FPT branch (+NT kernel) | `O(1.27^k·n)` exact |
| Sub-2 factor | — | Karakostas `2 − Θ(1/√log n)` | poly, `o(1)` gain only |
| Beat 1.36 | impossible (NP-hard) | — | Dinur–Safra lower bound |
| Beat 2 − ε | impossible under UGC | — | Khot–Regev |
| Max independent set (complement) | n/a | (no constant-factor approx) | inapproximable unless P=NP |

The recurring theme: vertex cover is the rare hard problem with a *simple, conjecturally optimal* constant-factor approximation, an *exact* polynomial algorithm on a key subclass (bipartite, König), and a *flagship FPT* exact algorithm when the answer is small — while its complement (independent set) is hard on every one of these axes.

---

## 11. Open Problems and Summary

### 10.1 The approximation-preserving reductions (L-reductions)

The APX-completeness of vertex cover (Section 7) is established via *L-reductions* — approximation-preserving reductions that carry hardness from one APX problem to another. Vertex cover L-reduces to and from bounded-degree variants and MAX-SAT-style problems, placing it firmly in the APX-complete class. The practical upshot for an engineer: because vertex cover is APX-*complete*, a PTAS for it (a `(1+ε)`-approximation for every `ε`) would imply a PTAS for *every* APX problem, collapsing the class — which is why no PTAS exists unless P = NP. So the constant-factor barrier is not a failure of imagination; it is a structural property of the whole class, and the 2-approximation lives right at (or, under UGC, exactly at) that barrier.

### 10.2 Bounded-degree special cases

On graphs of maximum degree `Δ`, slightly better than 2 is achievable: a `2 − 2/Δ + o(1)`-style factor via LP/SDP rounding, and for `Δ = 3` (cubic graphs) covers within `≈ 1.5·OPT`. These exploit that low-degree graphs have a richer combinatorial structure (e.g., more matching slack). The hardness also softens: for `Δ = 3` the inapproximability threshold drops below the general `1.36`. This degree-parameterized landscape is why a production system that *knows* its graphs are sparse/low-degree may route them to a specialized solver for a better factor — another instance of "structure beats the generic bound."

---

## 11. Open Problems and Summary

### 11.0 The Unique Games Conjecture, in one paragraph

The conditional hardness of `2 − ε` rests on the **Unique Games Conjecture (UGC)** of Khot (2002): roughly, that a certain constraint-satisfaction problem (each constraint is a bijection/permutation between two variables' label sets) is NP-hard to *approximately* satisfy — distinguishing "almost all constraints satisfiable" from "almost none." UGC is itself open and is one of the central conjectures in complexity theory; subexponential-time algorithms for unique games (Arora–Barak–Steurer) are known, but no polynomial refutation. Its relevance here: *if* UGC holds, then Khot–Regev's reduction makes vertex cover NP-hard to approximate within `2 − ε`, certifying the trivial matching algorithm as optimal. So the status of "is 2 the best possible?" is *yes, conditionally* — tied to one of the deepest open problems in theoretical computer science.

### 11.1 Open / advanced directions

1. **Closing the `[1.36, 2]` gap unconditionally** — is vertex cover NP-hard to approximate within `2 − ε` *without* assuming UGC? The UGC itself is open; resolving it would settle the exact approximability.
2. **Better FPT bases** — the branching base has crept from `1.466` toward `1.2738`; the true infimum (and whether `O(1.2^k)` is reachable) is open.
3. **Smaller kernels** — `2k` vertices is classic; whether `(2 − ε)k` vertices is achievable is tied to the approximation lower bounds (a `(2 − ε)`-kernel would imply a `(2 − ε)`-approximation, conjecturally impossible).
4. **Weighted half-integrality at scale** — fast (near-linear) solvers for the cover LP on huge sparse graphs, avoiding general LP machinery.
5. **Dynamic vertex cover** — maintaining a `(2 + ε)`-approximate cover under edge insertions/deletions in poly-log update time; active in dynamic-graph-algorithms research.

### 11.2 Historical and complexity placement

| Result | Author(s), year | Significance |
|--------|-----------------|--------------|
| König's theorem | König / Egerváry, 1931 | bipartite: min cover = max matching |
| Matching 2-approximation | folklore / Gavril, Yannakakis, 1970s | linear-time ≤ 2·OPT |
| NP-completeness | Karp, 1972 | one of the original 21 NP-complete problems |
| Half-integrality / NT kernel | Nemhauser–Trotter, 1975 | LP `{0,½,1}` structure; `2k` kernel |
| Håstad hardness `7/6` | Håstad, 2001 | first strong inapproximability |
| Dinur–Safra `1.3606` | Dinur–Safra, 2005 | best unconditional hardness |
| `2−ε` under UGC | Khot–Regev, 2008 | factor 2 conjecturally optimal |
| `O(1.2738^k)` FPT | Chen–Kanj–Xia, 2010 | state-of-the-art exact branching |
| `2 − Θ(1/√log n)` | Karakostas, 2009 | best algorithmic factor |

Vertex cover is the canonical example in complexity of a problem that is *simultaneously* NP-hard, 2-approximable, conjecturally not better-than-2 approximable, exactly solvable on bipartite graphs, and FPT — a single problem touching approximation, parameterized complexity, LP duality, and the UGC.

### 11.3 Summary

- **Definitions.** Cover `S` touches every edge; matching `M` is vertex-disjoint edges; `τ + α = n` (cover/independent-set complementarity, Lemma 1.5); `τ ≥ |M|` (matching lower bound, Lemma 1.6).
- **Algorithm.** Maximal-matching: take both endpoints of each uncovered edge; `|S| = 2|M| ≤ 2τ` (Theorem 3.1), and the factor 2 is **tight** (Theorem 4.1, the disjoint-edges witness).
- **LP route.** Round `x_v ≥ ½` for a *weighted* 2-approx (Theorem 5.2); the LP is **half-integral** (`{0,½,1}`, Theorem 5.3), giving the NT `2k` kernel.
- **Bipartite.** König: `τ = ν`, exact in `O(m√n)`; false on odd cycles (triangle).
- **Hardness.** NP-complete (Karp); no approx below `1.36` (Dinur–Safra); no `2 − ε` under UGC (Khot–Regev) — the matching 2-approx is conjecturally optimal.
- **FPT.** `O(1.2738^k·n)` exact branching with a `2k` kernel; vertex cover is the flagship FPT problem, while its complement (independent set) is W[1]-hard.

König (1931) tied bipartite covers to matchings; Karp (1972) placed the general problem among the original NP-complete problems; Nemhauser–Trotter (1975) exposed the half-integral LP structure; Dinur–Safra and Khot–Regev pinned the inapproximability; Chen–Kanj–Xia sharpened the FPT base. The maximal-matching algorithm — two endpoints per uncovered edge — remains the simple, linear, conjecturally optimal heart of it all.

---

## 12. Reference Code (Matching / FPT)

Exact minimum vertex cover via FPT branching, cross-checked against the maximal-matching 2-approximation (which must satisfy `approx ≤ 2·exact`). Verified: 5-cycle-plus-chord exact `= 3`, approx `= 4`; `K_4` exact `= 3`, approx `= 4`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func matchingCover(n int, edges [][2]int) []int {
	inc := make([]bool, n)
	for _, e := range edges {
		if !inc[e[0]] && !inc[e[1]] {
			inc[e[0]], inc[e[1]] = true, true
		}
	}
	c := []int{}
	for i := 0; i < n; i++ {
		if inc[i] {
			c = append(c, i)
		}
	}
	return c
}

// exactMinCover: smallest cover size via FPT branching, returns the set.
func exactMinCover(n int, edges [][2]int) []int {
	var solve func(chosen []bool, budget int) []bool
	solve = func(chosen []bool, budget int) []bool {
		u, v := -1, -1
		for _, e := range edges {
			if e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]] {
				u, v = e[0], e[1]
				break
			}
		}
		if u == -1 {
			return chosen // covered
		}
		if budget == 0 {
			return nil
		}
		c1 := append([]bool(nil), chosen...)
		c1[u] = true
		if r := solve(c1, budget-1); r != nil {
			return r
		}
		c2 := append([]bool(nil), chosen...)
		c2[v] = true
		return solve(c2, budget-1)
	}
	for k := 0; k <= n; k++ {
		if r := solve(make([]bool, n), k); r != nil {
			out := []int{}
			for i := 0; i < n; i++ {
				if r[i] {
					out = append(out, i)
				}
			}
			sort.Ints(out)
			return out
		}
	}
	return nil
}

func complete(k int) [][2]int {
	var e [][2]int
	for i := 0; i < k; i++ {
		for j := i + 1; j < k; j++ {
			e = append(e, [2]int{i, j})
		}
	}
	return e
}

func main() {
	g := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}}
	fmt.Println("approx:", len(matchingCover(5, g)), " exact:", len(exactMinCover(5, g))) // 4 3
	fmt.Println("K4 approx:", len(matchingCover(4, complete(4))),
		" exact:", len(exactMinCover(4, complete(4)))) // 4 3
}
```

#### Java

```java
import java.util.*;

public class VertexCoverExact {
    static int N;
    static int[][] E;

    static List<Integer> matchingCover(int n, int[][] edges) {
        boolean[] inc = new boolean[n];
        for (int[] e : edges)
            if (!inc[e[0]] && !inc[e[1]]) { inc[e[0]] = true; inc[e[1]] = true; }
        List<Integer> c = new ArrayList<>();
        for (int i = 0; i < n; i++) if (inc[i]) c.add(i);
        return c;
    }

    static boolean[] solve(boolean[] chosen, int budget) {
        int u = -1, v = -1;
        for (int[] e : E)
            if (e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]]) { u = e[0]; v = e[1]; break; }
        if (u == -1) return chosen;
        if (budget == 0) return null;
        boolean[] c1 = chosen.clone(); c1[u] = true;
        boolean[] r1 = solve(c1, budget - 1);
        if (r1 != null) return r1;
        boolean[] c2 = chosen.clone(); c2[v] = true;
        return solve(c2, budget - 1);
    }

    static List<Integer> exactMinCover(int n, int[][] edges) {
        N = n; E = edges;
        for (int k = 0; k <= n; k++) {
            boolean[] r = solve(new boolean[n], k);
            if (r != null) {
                List<Integer> out = new ArrayList<>();
                for (int i = 0; i < n; i++) if (r[i]) out.add(i);
                return out;
            }
        }
        return null;
    }

    static int[][] complete(int k) {
        List<int[]> e = new ArrayList<>();
        for (int i = 0; i < k; i++) for (int j = i + 1; j < k; j++) e.add(new int[]{i, j});
        return e.toArray(new int[0][]);
    }

    public static void main(String[] args) {
        int[][] g = {{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}};
        System.out.println("approx: " + matchingCover(5, g).size()
                + " exact: " + exactMinCover(5, g).size());                 // 4 3
        System.out.println("K4 approx: " + matchingCover(4, complete(4)).size()
                + " exact: " + exactMinCover(4, complete(4)).size());       // 4 3
    }
}
```

#### Python

```python
def matching_cover(n, edges):
    inc = [False] * n
    for u, v in edges:
        if not inc[u] and not inc[v]:
            inc[u] = inc[v] = True
    return [i for i in range(n) if inc[i]]


def exact_min_cover(n, edges):
    def solve(chosen, budget):
        u = v = -1
        for a, b in edges:
            if a != b and a not in chosen and b not in chosen:
                u, v = a, b
                break
        if u == -1:
            return chosen
        if budget == 0:
            return None
        r = solve(chosen | {u}, budget - 1)
        if r is not None:
            return r
        return solve(chosen | {v}, budget - 1)

    for k in range(n + 1):
        r = solve(set(), k)
        if r is not None:
            return sorted(r)
    return None


def complete(k):
    return [(i, j) for i in range(k) for j in range(i + 1, k)]


if __name__ == "__main__":
    g = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 3)]
    print("approx:", len(matching_cover(5, g)), " exact:", len(exact_min_cover(5, g)))  # 4 3
    print("K4 approx:", len(matching_cover(4, complete(4))),
          " exact:", len(exact_min_cover(4, complete(4))))                               # 4 3
    # invariant: the 2-approx is never worse than twice the exact optimum
    assert len(matching_cover(5, g)) <= 2 * len(exact_min_cover(5, g))
```

**What it does:** computes the exact minimum vertex cover via FPT branching and the maximal-matching 2-approximation, demonstrating `approx ≤ 2·exact`.
**Run:** `go run main.go` | `javac VertexCoverExact.java && java VertexCoverExact` | `python vertex_cover_exact.py`

### 12.0 A worked trace of the FPT branching

To make the branching concrete, trace `exactMinCover` on the triangle `K_3` (`edges = {01, 12, 02}`), iterating `k`:

- `k = 0`: first uncovered edge `01`, budget 0 ⇒ **no**.
- `k = 1`: edge `01`. Branch include `0` (budget 0): next uncovered edge `12`, budget 0 ⇒ no. Branch include `1` (budget 0): next uncovered edge `02`, budget 0 ⇒ no. Both fail ⇒ **no**.
- `k = 2`: edge `01`. Branch include `0` (budget 1): next uncovered `12`. Branch include `1` (budget 0): all covered (`0,1` cover `01,12,02`) ⇒ **yes**, cover `{0,1}`.

So `τ(K_3) = 2`, returned as `{0, 1}`. The trace shows why iterating `k` upward is essential: the first `k` that yields *yes* is the exact optimum. It also shows the `2^k` tree shape — at each level we branched on the two endpoints of one uncovered edge. On `K_3` the tree is tiny; on a graph with `OPT = 40` it would have up to `2^{40}` leaves without the high-degree branching and kernelization refinements of Section 8.

### 12.1 Implementation notes

- **Iterate `k` from 0 upward** so the first feasible budget *is* `τ(G)`; jumping straight to `k = n` finds *a* cover but not the *minimum* without further pruning.
- **Pick *any* uncovered edge** to branch on; correctness does not depend on the choice, but a *high-degree* vertex (Theorem 8.3) drastically shrinks the tree — swap the edge-scan for a degree-based pick to go from `2^k` to `1.47^k`.
- **Kernelize first** (NT/LP) on large instances: fix the `{0,1}` LP vertices, branch only on the `½`-core of `≤ 2k` vertices.
- **The `approx ≤ 2·exact` assertion** is a powerful regression oracle: it must hold on *every* graph; a violation is a bug in either routine.
- **Self-loops** force their vertex into any cover; pre-add such vertices and drop the loops before branching.

These five notes are the difference between a textbook snippet and a solver you can trust on real instances.
