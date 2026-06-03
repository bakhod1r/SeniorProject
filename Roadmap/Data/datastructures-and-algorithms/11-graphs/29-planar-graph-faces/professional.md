# Planar Graphs & Euler's Formula — Mathematical Foundations

## Table of Contents
1. Formal Definitions: Embeddings, Faces, Rotation Systems
2. Euler's Formula — Proof by Induction
3. The Edge Bound E ≤ 3V − 6 — Derivation
4. The Triangle-Free Bound E ≤ 2V − 4
5. Non-Planarity of K5 and K3,3 — Proofs
6. Kuratowski's and Wagner's Theorems
7. The Dual Graph — Formal Treatment
8. The Five-Color Theorem — Full Proof
9. The Four-Color Theorem — Statement and Discharging
10. Generalized Euler: V − E + F = 1 + C and Higher Genus
11. The Planar Separator Theorem
12. Linear-Time Planarity Testing — Algorithmic Foundations
13. Straight-Line Embeddings: Fáry, Tutte, and Schnyder
14. Counting Perfect Matchings: The FKT Algorithm
15. Rigorous Pitfalls and Boundary Conditions
16. Worked Computations and Classical Corollaries
17. The Algebraic View: Cycle Space, Cut Space, and Homology
18. Summary

---

## 1. Formal Definitions: Embeddings, Faces, Rotation Systems

**Definition 1.1 (Plane graph / embedding).** A *plane graph* is a drawing of a graph `G = (V, E)` in the plane `ℝ²` (or the sphere `S²`) in which vertices are distinct points, each edge is a simple arc joining its endpoints, no arc passes through a vertex other than its endpoints, and two arcs meet only at shared endpoints. A graph is **planar** if such a drawing exists. An embedding is the equivalence class of such drawings under homeomorphism of the surface.

**Definition 1.2 (Face).** The arcs of a plane graph partition `ℝ² ∖ (image of G)` into open connected regions called **faces**. Exactly one face is unbounded — the **outer face**. We write `F` for the set of faces and `f = |F|`.

**Definition 1.3 (Combinatorial embedding / rotation system).** A *rotation system* `ρ` assigns to each vertex `v` a cyclic permutation `ρ_v` of the edges (equivalently, the darts) incident to `v` — the cyclic clockwise order around `v`. A rotation system determines the faces combinatorially: define, on the set of darts (directed edges), the permutation
```
σ(u→v) = ρ_v applied to (v→u)   [the dart after the reverse, in v's rotation]
```
The orbits of `σ` are exactly the **face boundary walks**. Heffter–Edmonds principle: every rotation system of a connected graph corresponds to an embedding on some orientable surface, and on the sphere/plane iff Euler's formula yields genus 0.

**Definition 1.4 (Face degree).** The *degree* `deg(f)` of a face `f` is the length of its boundary walk (the size of the corresponding `σ`-orbit). A **bridge** (cut-edge) is traversed twice by the single face it borders, contributing 2 to that face's degree.

**Lemma 1.5 (Handshake for faces).**
```
Σ_{f ∈ F} deg(f) = 2|E|.
```
*Proof.* Each edge yields exactly two darts; each dart belongs to exactly one face boundary walk (one `σ`-orbit). Summing orbit lengths counts every dart once, i.e. `2|E|`. ∎

This lemma is the algebraic engine of §3 and §4.

---

## 2. Euler's Formula — Proof by Induction

**Theorem 2.1 (Euler 1750).** For a connected plane graph,
```
V − E + F = 2.
```

We give the standard induction on the number of edges; an alternative spanning-tree proof follows.

### 2.1 Induction on E

**Base case.** `E = 0`. Connectivity forces `V = 1` (a single isolated vertex), and the drawing has exactly one face (the outer face), so `F = 1`. Then `V − E + F = 1 − 0 + 1 = 2`. ✓

**Inductive step.** Assume the formula holds for all connected plane graphs with fewer than `E` edges, and let `G` be connected with `E ≥ 1` edges. Two cases:

- **Case A: `G` has a cycle.** Pick an edge `e` lying on a cycle. Removing `e` keeps `G − e` connected (the cycle provided an alternate path). In the drawing, `e` separated two *distinct* faces (an edge on a cycle borders two different faces); deleting it merges them into one. So `E` drops by 1 and `F` drops by 1, while `V` is unchanged. By the inductive hypothesis on `G − e`:
  ```
  V − (E − 1) + (F − 1) = 2   ⟹   V − E + F = 2.
  ```

- **Case B: `G` is acyclic**, i.e. a tree. A tree on `V` vertices has `E = V − 1` edges and its drawing has exactly one face (no cycle encloses a region), so `F = 1`. Then
  ```
  V − E + F = V − (V − 1) + 1 = 2. ✓
  ```
  (Equivalently, in the induction: a leaf edge `e` borders the same face on both sides; deleting it removes a leaf vertex and the edge, `V → V−1`, `E → E−1`, `F` unchanged; apply the hypothesis.)

Both cases preserve `V − E + F = 2`. ∎

### 2.2 Spanning-tree proof (sketch)

Take a spanning tree `T` of connected `G`; `T` has `V − 1` edges and the drawing of `T` alone has 1 face. Each of the remaining `E − (V − 1)` non-tree edges, added one at a time into the existing drawing, closes a cycle and thus splits one face into two, incrementing `F` by exactly 1. Starting from `F = 1` and adding `E − V + 1` edges:
```
F = 1 + (E − V + 1) = E − V + 2   ⟹   V − E + F = 2. ∎
```
This is also the algorithmic intuition behind the incremental `F += 1` per face split used in `senior.md`.

---

## 3. The Edge Bound E ≤ 3V − 6 — Derivation

**Theorem 3.1.** Every simple planar graph with `V ≥ 3` satisfies `E ≤ 3V − 6`.

*Proof.* If `E < V − 1` the graph is a forest and the bound is trivial, so assume `G` is connected with at least one cycle (else add edges to a maximal planar supergraph; the bound for the supergraph implies it for `G`). Fix any plane embedding. Since `G` is simple with `V ≥ 3`, every face boundary walk has length `≥ 3`: a face of degree 1 would require a self-loop, a face of degree 2 would require two parallel edges or a single edge bordered twice (a bridge in a graph with a cycle bounds a face of degree `≥ 3` on the cycle side). Hence `deg(f) ≥ 3` for all `f`. By Lemma 1.5,
```
2E = Σ_f deg(f) ≥ 3F   ⟹   F ≤ 2E/3.
```
Substitute into Euler `F = 2 − V + E`:
```
2 − V + E ≤ 2E/3
3(2 − V + E) ≤ 2E
6 − 3V + 3E ≤ 2E
E ≤ 3V − 6.  ∎
```

**Corollary 3.2 (Average degree).** A simple planar graph has average degree `< 6`:
```
(1/V) Σ_v deg(v) = 2E/V ≤ (6V − 12)/V < 6.
```
**Corollary 3.3 (Min-degree-5).** Every simple planar graph has a vertex of degree `≤ 5`. *Proof.* If every vertex had degree `≥ 6`, then `2E = Σ deg(v) ≥ 6V`, i.e. `E ≥ 3V > 3V − 6`, contradicting Theorem 3.1. ∎ This corollary is the hinge of the Five-Color proof (§8).

**Definition 3.4 (Maximal planar / triangulation).** A simple planar graph is *maximal planar* if no edge can be added preserving planarity. For `V ≥ 3` these are exactly the **triangulations**: every face (including the outer) is a triangle, and equality `E = 3V − 6`, `F = 2V − 4` holds.

---

## 4. The Triangle-Free Bound E ≤ 2V − 4

**Theorem 4.1.** Every simple planar graph with `V ≥ 3` and no triangles (girth `≥ 4`; in particular every bipartite planar graph) satisfies `E ≤ 2V − 4`.

*Proof.* In a triangle-free simple graph, no face boundary can be a 3-cycle, so every face has degree `≥ 4`. Lemma 1.5 gives
```
2E = Σ_f deg(f) ≥ 4F   ⟹   F ≤ E/2.
```
Into Euler `F = 2 − V + E`:
```
2 − V + E ≤ E/2
2(2 − V + E) ≤ E
4 − 2V + 2E ≤ E
E ≤ 2V − 4.  ∎
```

**Generalization (girth `g`).** A simple planar graph of girth `g` (length of shortest cycle) with at least one cycle satisfies
```
E ≤ (g / (g − 2)) · (V − 2).
```
For `g = 3` this is `3(V−2) = 3V − 6`; for `g = 4`, `2(V−2) = 2V − 4`; for `g = 5`, `(5/3)(V − 2)`. *Proof.* Every face has degree `≥ g`, so `2E ≥ gF`, `F ≤ 2E/g`; substitute into Euler and solve. ∎

---

## 5. Non-Planarity of K5 and K3,3 — Proofs

**Theorem 5.1.** `K5` is not planar.

*Proof.* `K5` is simple with `V = 5`, `E = C(5,2) = 10`. The bound (Theorem 3.1) requires `E ≤ 3V − 6 = 9`. But `10 > 9`, contradiction. Hence no plane embedding exists. ∎

**Theorem 5.2.** `K3,3` is not planar.

*Proof.* `K3,3` is simple, bipartite (hence triangle-free), with `V = 6`, `E = 9`. The triangle-free bound (Theorem 4.1) requires `E ≤ 2V − 4 = 8`. But `9 > 8`, contradiction. ∎

Note that `K3,3` *passes* the generic bound `3V − 6 = 12`; this is precisely why the sharper triangle-free bound is indispensable. Both `K5` and `K3,3` are **minimal** non-planar in the sense that deleting any edge makes them planar — they are the two Kuratowski obstructions.

**Theorem 5.3 (Thickness 2).** Both `K5` and `K3,3` decompose into two planar subgraphs (e.g. a Hamiltonian cycle plus the remaining edges), so their *thickness* is 2 — they route on two layers, the basis of the via lower bound in `senior.md`.

---

## 6. Kuratowski's and Wagner's Theorems

**Definition 6.1 (Subdivision).** A *subdivision* of `H` replaces each edge of `H` by a path (inserting degree-2 vertices). `G` *contains a subdivision of* `H` if some subgraph of `G` is a subdivision of `H`.

**Definition 6.2 (Minor).** `H` is a *minor* of `G` if `H` can be obtained from a subgraph of `G` by contracting edges.

**Theorem 6.3 (Kuratowski 1930).** A graph `G` is planar **if and only if** it contains no subdivision of `K5` and no subdivision of `K3,3`.

**Theorem 6.4 (Wagner 1937).** A graph `G` is planar **if and only if** it has neither `K5` nor `K3,3` as a *minor*.

These two characterizations are equivalent for the specific forbidden graphs `K5`, `K3,3`. (In general, a `K_{3,3}`-subdivision and a `K_{3,3}`-minor coincide because `K3,3` is cubic; for `K5`, a `K5`-minor may yield only a `K5`- or `K3,3`-*subdivision*, but either way non-planarity follows.)

*Proof idea (necessity).* Both `K5` and `K3,3` are non-planar (§5). Planarity is preserved under taking subgraphs, subdivisions (degree-2 vertices do not affect crossings), and minors (deletion and contraction both preserve planar embeddability). So a planar graph can contain neither as a subdivision/minor.

*Proof idea (sufficiency).* The hard direction. The standard modern proof (via 3-connected reductions) shows: every 3-connected graph with no `K5` or `K3,3` minor has a *convex* planar embedding (Tutte's spring/barycentric embedding), and a general graph reduces to its 3-connected components via a block-cut and SPQR decomposition; if every piece is planar and free of the obstructions, the pieces glue into a planar embedding. Full proofs occupy a chapter of Diestel; we cite rather than reproduce.

**Theorem 6.5 (Robertson–Seymour, context).** Wagner's theorem is the genus-0 special case of the Graph Minor Theorem: every minor-closed family is characterized by a *finite* set of forbidden minors. Planar graphs have exactly two (`K5`, `K3,3`); toroidal (genus-1) graphs have a known but enormous obstruction set (over 17,000 minors).

**Algorithmic note.** Kuratowski/Wagner give a *witness* (an embedded `K5`/`K3,3` subdivision or minor) certifying non-planarity. Linear-time planarity testers (Hopcroft–Tarjan 1974 path-addition; Booth–Lueker PQ-trees; de Fraysseix–Rosenstiehl Left-Right; Boyer–Myrvold edge-addition) decide planarity in `O(V)` and can extract such a witness in `O(V)`; naive minor search is `O(V³)`–`O(V⁶)`.

---

## 7. The Dual Graph — Formal Treatment

**Definition 7.1 (Dual).** Given a connected plane graph `G` with embedding, the **dual** `G*` has vertex set `F` (the faces of `G`) and, for each edge `e` of `G` bordering faces `f, g`, an edge `e*` of `G*` joining `f` and `g`. A bridge `e` (with `f = g`) yields a self-loop in `G*`.

**Proposition 7.2 (Counts).** `V* = F`, `E* = E`, `F* = V`, and `G*` is connected and planar. Euler's formula is *self-dual*:
```
V* − E* + F* = F − E + V = 2.
```

**Proposition 7.3 (Double dual).** For a connected plane graph, `(G*)* ≅ G` (with the natural embedding on the sphere). On the plane the outer face must be tracked; on the sphere the symmetry is exact.

**Proposition 7.4 (Cycle–cut duality).** A set of edges forms a **cycle** in `G` if and only if the corresponding dual edges form a **minimal edge cut (bond)** in `G*`, and vice versa. *Consequence:* the cycle space of `G` equals the cut space of `G*`. This duality underlies planar **max-flow / min-cut**: an `s–t` min-cut in a planar graph corresponds to a shortest cycle separating `s` from `t` in (an augmented) dual, solvable by a single shortest-path computation — far faster than general max-flow (see `16-max-flow-edmonds-karp-dinic`).

**Proposition 7.5 (Coloring duality).** A *proper face coloring* of `G` (adjacent faces get different colors) is exactly a *proper vertex coloring* of `G*`. The Four-Color Theorem about maps is the statement that `G*` (a planar graph) is 4-vertex-colorable. This is the formal bridge to `27-graph-coloring`.

---

## 8. The Five-Color Theorem — Full Proof

**Theorem 8.1 (Heawood 1890).** Every simple planar graph is 5-vertex-colorable.

*Proof (by induction on `V`).* For `V ≤ 5` color each vertex distinctly. Assume the claim for all simple planar graphs with fewer than `V` vertices, and let `G` be a simple planar graph on `V` vertices. We may assume `G` is a triangulation (adding edges only makes coloring harder; a coloring of a supergraph restricts to `G`).

By Corollary 3.3, `G` has a vertex `v` with `deg(v) ≤ 5`.

**Case 1: `deg(v) ≤ 4`.** Delete `v`. By induction `G − v` has a proper 5-coloring. The neighbors of `v` use at most 4 colors, so a fifth color is free for `v`. Color `v` with it. ✓

**Case 2: `deg(v) = 5`.** Delete `v` and 5-color `G − v` by induction. If `v`'s five neighbors use `≤ 4` colors, a free color remains — done. Otherwise the five neighbors `v₁, v₂, v₃, v₄, v₅` (in clockwise embedded order around `v`) use all 5 colors `c₁, …, c₅` respectively. We free a color via a **Kempe chain**.

Consider neighbors `v₁` (color `c₁`) and `v₃` (color `c₃`). Look at the subgraph `H₁₃` induced by vertices colored `c₁` or `c₃` (the `c₁/c₃` **Kempe chain**).

- **If `v₁` and `v₃` lie in different connected components of `H₁₃`:** swap colors `c₁ ↔ c₃` throughout the component containing `v₁`. This keeps the coloring proper and recolors `v₁` to `c₃`. Now color `c₁` is unused among `v`'s neighbors, so assign `c₁` to `v`. ✓
- **If `v₁` and `v₃` lie in the same component:** there is a path `P₁₃` from `v₁` to `v₃` using only colors `c₁, c₃`. Together with `v`, this path encloses either `v₂` or both `v₄, v₅` (by the planar embedding — the cycle `v–v₁–P₁₃–v₃–v` separates the plane). Now consider the `c₂/c₄` Kempe chain `H₂₄` between `v₂` (color `c₂`) and `v₄` (color `c₄`). Because `v₂` is separated from `v₄` by the closed curve `v–v₁–P₁₃–v₃–v` (one is inside, one is outside) and any `c₂/c₄` path would have to cross `P₁₃` — impossible, since `P₁₃` uses only colors `c₁, c₃`, disjoint from `{c₂, c₄}` — the vertices `v₂` and `v₄` lie in **different** components of `H₂₄`. Swap `c₂ ↔ c₄` in `v₂`'s component; now `c₂` is free among `v`'s neighbors, so assign `c₂` to `v`. ✓

In every case `v` receives a color, completing a proper 5-coloring of `G`. ∎

The proof is fully constructive and runs in polynomial time (each Kempe swap is `O(V)`, applied `O(V)` times → `O(V²)`; with care, `O(V)` amortized). The crucial planar fact used is the Jordan-curve separation of the two Kempe chains, which fails on non-planar surfaces.

---

## 9. The Four-Color Theorem — Statement and Discharging

**Theorem 9.1 (Appel–Haken 1976; Robertson–Sanders–Seymour–Thomas 1997).** Every simple planar graph is 4-vertex-colorable. Equivalently, every plane map is 4-face-colorable (Proposition 7.5).

Unlike the Five-Color Theorem, no short proof is known. The proof structure is:

1. **Reducible configurations.** Identify a finite set of subgraph "configurations" each of which cannot appear in a *minimal counterexample* (a smallest graph needing 5 colors): if such a configuration appears, a coloring of a smaller graph extends to it (Kempe-chain style arguments, mechanized).
2. **Unavoidable set.** Prove via the **discharging method** that every planar triangulation must contain at least one configuration from the set — so a minimal counterexample is impossible.

**Discharging in one paragraph.** Assign each vertex a charge `6 − deg(v)`. By Corollary 3.2 and Euler's formula, the total charge is
```
Σ_v (6 − deg(v)) = 6V − 2E = 6V − 2E.
```
For a triangulation `E = 3V − 6`, so the total is `6V − 2(3V − 6) = 12 > 0`. Positive total charge forces some low-degree vertices (positive charge concentrates on degree `≤ 5` vertices). **Discharging rules** then redistribute charge (moving fixed amounts across edges) without changing the total; after redistribution, every vertex with positive charge must sit inside one of the reducible configurations. Since total charge stays `+12 > 0`, at least one such configuration is unavoidable. The Appel–Haken proof used 1,936 configurations (later 1,482); the 1997 reproof reduced to 633 and verified reducibility by computer. The Euler-formula identity `Σ(6 − deg(v)) = 12` is the seed of the entire argument.

**Remark.** The Five-Color Theorem (§8) is the strongest bound provable by hand; the gap to four colors is genuinely hard and remains the most famous computer-assisted proof in mathematics. For coloring algorithms and the chromatic number of general graphs, see `27-graph-coloring`.

---

## 10. Generalized Euler: V − E + F = 1 + C and Higher Genus

**Theorem 10.1 (Disconnected plane graphs).** A plane graph with `C` connected components satisfies
```
V − E + F = 1 + C.
```

*Proof.* Apply Theorem 2.1 to each component `Gᵢ` embedded in the plane. Component `Gᵢ` with `Vᵢ`, `Eᵢ` and viewed *in isolation* has `Fᵢ` faces with `Vᵢ − Eᵢ + Fᵢ = 2`. But when all `C` components are drawn together in one plane, they *share a single outer face*. Summing the isolated identities counts the outer face `C` times instead of once:
```
Σᵢ (Vᵢ − Eᵢ + Fᵢ) = 2C
V − E + (F + (C − 1)) = 2C        [the shared outer face was over-counted C−1 times]
V − E + F = 2C − (C − 1) = C + 1.  ∎
```
For `C = 1` this is Euler's formula. A forest (`E = V − C`, `F = 1`) gives `V − (V − C) + 1 = C + 1`. ✓

**Theorem 10.2 (Euler–Poincaré, orientable genus `g`).** A connected graph cellularly embedded on an orientable surface of genus `g` (a sphere with `g` handles) satisfies
```
V − E + F = 2 − 2g.
```
The quantity `χ = 2 − 2g` is the **Euler characteristic** of the surface: `χ = 2` for the sphere/plane (`g = 0`), `χ = 0` for the torus (`g = 1`), `χ = −2` for the genus-2 surface. The **genus of a graph** is the minimum `g` over all surfaces on which it embeds without crossings; planar = genus 0. (Non-orientable surfaces use `χ = 2 − k` for the connected sum of `k` projective planes.)

**Corollary 10.3 (Genus lower bound).** Rearranging with `F ≤ 2E/3` (every face degree `≥ 3`):
```
g ≥ ⌈ (E − 3V + 6) / 6 ⌉   for a simple connected graph.
```
For `K5`: `(10 − 15 + 6)/6 = 1/6`, so `g ≥ 1` — `K5` is *toroidal* (embeds on the torus), confirming it is non-planar but barely so. For `K7`: `(21 − 21 + 6)/6 = 1`, and indeed `K7` embeds on the torus (the famous 7-color torus map).

**Theorem 10.4 (Heawood bound, context).** On a surface of genus `g ≥ 1`, the chromatic number of any embedded graph is at most
```
H(g) = ⌊ (7 + √(1 + 48g)) / 2 ⌋,
```
which is tight for all `g ≥ 1` (Ringel–Youngs 1968). For the torus `g = 1` this gives 7, matching `K7`. The plane case `g = 0` would give 4, but the formula is *not* proven by Heawood's method there — that gap is exactly the Four-Color Theorem.

---

## 11. The Planar Separator Theorem

**Theorem 11.1 (Lipton–Tarjan 1979).** Every `n`-vertex planar graph `G` has a vertex set `S` (a **separator**) with `|S| ≤ 2√2 · √n ≈ 2.83√n` whose removal partitions `V ∖ S` into two sets `A`, `B` with no edge between them and `|A|, |B| ≤ 2n/3`.

*Proof sketch.* Root a BFS tree and let `L_i` be the set of vertices at BFS level `i`. The level sizes sum to `n`, so there exist levels close to the "middle" whose removal already balances the graph; a counting argument finds a level `ℓ` with `|L_ℓ| ≤ √n` such that the levels above and below are each `≤ 2n/3`-ish. If one level does not suffice, one chooses two levels `ℓ₁ < ℓ₂` with small combined size and contracts the parts above `ℓ₁` and below `ℓ₂` to single vertices; the middle band is an outerplanar-like graph in which a fundamental cycle of a spanning tree, of length `≤ 2√n` (bounded using `E ≤ 3V − 6` and the BFS-depth structure), serves as the separator. The constant `2√2` comes from optimizing these two contributions. The **key planar inputs are**: (i) the edge bound `E ≤ 3V − 6` (sparsity), and (ii) the Jordan-curve property — a cycle in a planar embedding separates the plane, hence the graph. Neither holds for general graphs, which is why no `o(n)` separator exists for, e.g., expanders. ∎

**Corollary 11.2 (Recursive separation).** Applying Theorem 11.1 recursively yields a separator hierarchy of depth `O(log n)`; the total separator size at each level forms a geometric series summing to `O(√n)` at the top. This is the engine behind:

- **Nested dissection** (George 1973; Lipton–Rose–Tarjan 1979): solving an `n`-variable sparse symmetric linear system arising from a planar (e.g. 2-D finite-element) mesh in `O(n^{1.5})` time and `O(n log n)` fill, versus `O(n³)` dense Gaussian elimination.
- **Sub-exponential planar algorithms**: many NP-hard problems (independent set, vertex cover, Hamiltonicity) admit `2^{O(√n)}`-time exact algorithms on planar graphs via separator-based divide-and-conquer — impossible in general under the Exponential Time Hypothesis.
- **`O(n log n)` all-pairs / `O(n)` single-source** shortest paths variants on planar graphs (Henzinger–Klein–Rao–Subramanian; Frederickson), built on separator decompositions.

**Theorem 11.3 (Cycle separator, Miller 1986).** Every 2-connected planar graph with maximum face size `d` has a *simple cycle* separator of size `O(√(d·n))` giving a `2/3`-balanced split. For triangulations (`d = 3`) this is `O(√n)`. The cycle form is what nested-dissection solvers and planar-graph data structures actually use, because a cycle separator respects the embedding (inside vs outside the cycle = the two parts).

The separator theorem is, in a precise sense, a *quantitative* descendant of Euler's formula: the `√n` size is forced by the linear edge bound, and the balance is forced by Jordan-curve separation — the same two facts that drive every other result in this file.

---

## 12. Linear-Time Planarity Testing — Algorithmic Foundations

Deciding planarity exactly in `O(V)` (recall `E = O(V)` for planar candidates, and we reject `E > 3V − 6` first in `O(1)`) is a landmark result. We summarize the three main algorithmic lineages and the invariants they maintain; full pseudocode is the subject of the linked references rather than this file.

### 12.1 Path addition (Hopcroft–Tarjan 1974)

The first `O(V)` algorithm. It decomposes the graph into a DFS tree plus back edges, then adds **paths** (a tree path closed by a back edge) one at a time, maintaining a partition of already-embedded pieces into "left" and "right" of the current spine. The data structure tracks, for each piece, the interval of attachment points; a conflict between two pieces that cannot both be placed on the same side without crossing signals non-planarity. The amortized `O(1)` per edge relies on a careful "lowpoint" ordering (the same lowpoint machinery used in `08-tarjan-scc` and `11-articulation-points-bridges`).

### 12.2 Vertex addition / PQ-trees (Lempel–Even–Cederbaum 1967; Booth–Lueker 1976)

Process vertices in an **st-numbering** order (a numbering where every vertex except `s, t` has both a lower- and higher-numbered neighbor). At each step, the set of edges "dangling" toward not-yet-added vertices must be arrangeable in a consistent cyclic order around the current boundary. The admissible orders are exactly those representable by a **PQ-tree** — a tree with **P-nodes** (children freely permutable) and **Q-nodes** (children orderable only forward or reversed). Each vertex addition performs a *template-matching reduction* on the PQ-tree; Booth–Lueker proved the total reduction cost is `O(V)` amortized. Failure of a reduction certifies non-planarity. PQ-trees also yield the embedding (rotation system).

### 12.3 Left-Right / edge addition (de Fraysseix–Rosenstiehl; Boyer–Myrvold 2004)

The modern algorithms of choice. The **Left-Right (LR) criterion** characterizes planarity purely in terms of the DFS tree: a graph is planar iff its back edges can be 2-colored ("left"/"right") such that, for every pair of back edges that "fork" along a tree path, a parity constraint holds (formally, the *return edges* form a consistent constraint graph that is 2-colorable). Boyer–Myrvold's **edge-addition** method incrementally embeds, flipping "biconnected components" (via a Q-node-like structure) as needed, and on failure extracts a Kuratowski `K5`/`K3,3` subdivision in `O(V)`. These are simpler to implement correctly than PQ-trees and are what libraries (OGDF, Boost.Graph's `boyer_myrvold_planarity_test`) ship.

### 12.4 Why `O(V)` and not `O(V log V)`

All three avoid sorting and avoid re-examining settled structure: the lowpoint/st-numbering preorders the work so each edge is touched `O(1)` amortized times, and the PQ-tree / constraint-graph updates are themselves amortized `O(1)` per edge by a potential argument (each reduction either embeds an edge or shrinks the tree). The `O(1)` edge-bound pre-filter guarantees `E < 3V`, so "linear in edges" is "linear in vertices."

| Algorithm | Year | Mechanism | Produces embedding | Produces `K5`/`K3,3` witness |
|-----------|------|-----------|--------------------|------------------------------|
| Hopcroft–Tarjan | 1974 | path addition | with extra work | with extra work |
| Booth–Lueker (PQ-tree) | 1976 | vertex addition | yes | yes |
| de Fraysseix–Rosenstiehl (LR) | 1985 | back-edge constraints | yes | yes |
| Boyer–Myrvold | 2004 | edge addition | yes | yes (native, `O(V)`) |

**Lower bound.** Planarity testing is `Ω(V)` trivially (must read the graph). In the algebraic decision tree / pointer-machine model the linear bound is optimal; no asymptotic improvement is possible.

---

## 13. Straight-Line Embeddings: Fáry, Tutte, and Schnyder

A planar graph can be drawn with curved edges, but a much stronger fact holds.

**Theorem 13.1 (Wagner 1936; Fáry 1948; Stein 1951).** Every simple planar graph has a planar embedding in which **every edge is a straight line segment**.

*Proof idea.* Triangulate the graph (add edges to make it maximal planar; straight-line-embed the triangulation, then delete the added edges). Induct on `V`: a triangulation on `V ≥ 4` vertices has an internal vertex `v` of degree `≤ 5` (Corollary 3.3) whose neighborhood forms a polygon; remove `v`, recursively draw the smaller triangulation (re-triangulating the hole), then place `v` at a point inside the now-empty polygon — possible because a simple polygon always has a point seeing all its vertices (its kernel is nonempty for the small star-shaped holes that arise). ∎

**Theorem 13.2 (Tutte 1963, spring embedding).** Let `G` be a 3-connected planar graph with a distinguished face fixed as a convex polygon. Place every other vertex at the **centroid of its neighbors** (solve the linear system `xᵥ = avg of neighbors' x`, likewise `y`). The result is a planar straight-line embedding with all internal faces convex. The proof reduces to showing the harmonic (barycentric) coordinates never create a crossing — a maximum-principle argument. This is the mathematical seed of every force-directed layout (`neato`, d3-force) and of discrete harmonic maps in geometry processing.

**Theorem 13.3 (Schnyder 1990, grid drawing).** Every simple planar graph on `V` vertices has a planar straight-line embedding on the integer grid `[0, V−2] × [0, V−2]` (so `O(V²)` area), computable in `O(V)` time. The construction uses a **Schnyder wood**: a partition of the internal edges of a triangulation into three trees rooted at the three outer vertices, such that around every internal vertex the edges appear in a fixed cyclic pattern of the three colors. Each vertex's coordinates are face counts in the three "regions" the wood induces; the area bound `(V−2)²` is tight.

These theorems matter because they convert the *combinatorial* fact "planar" into a *geometric* drawing with a polynomial-area guarantee — the foundation of `senior.md`'s layout engines. The Euler-formula corollary "min degree ≤ 5" appears again in Fáry's induction, and the face count `F = 2V − 4` of a triangulation is exactly Schnyder's coordinate range.

---

## 14. Counting Perfect Matchings: The FKT Algorithm

Counting perfect matchings (the **permanent** of the adjacency-like matrix) is `#P`-complete for general graphs (Valiant 1979). For **planar** graphs it is polynomial — one of the most striking payoffs of an embedding.

**Theorem 14.1 (Fisher–Kasteleyn–Temperley 1961–67).** The number of perfect matchings of a planar graph `G` can be computed in `O(V^{3})` (matrix) time via the **Pfaffian** of a skew-symmetric matrix derived from a special edge orientation.

**Definition 14.2 (Pfaffian orientation).** An orientation of `G` is *Pfaffian* if every **even alternating cycle** that admits a perfect matching of the rest has an **odd** number of edges directed each way ("oddly oriented"). For such an orientation, forming the skew-symmetric matrix `A` with `A[i][j] = +1` if `i→j`, `−1` if `j→i`, `0` otherwise, the number of perfect matchings equals `√(det A) = |Pf(A)|`.

**Theorem 14.3 (Kasteleyn).** Every planar graph admits a Pfaffian orientation, and it can be found in `O(V + E)` time **from a planar embedding**: orient a spanning tree arbitrarily, then process faces of the embedding in a BFS order of the dual, orienting each face's last edge so that the face has an odd number of clockwise-directed edges. The **planar embedding's faces are exactly what make this consistent** — the dual-BFS order ensures every face constraint can be satisfied, which fails on non-planar graphs (general graphs need not have any Pfaffian orientation).

The determinant/Pfaffian is computed in `O(V^{ω})` (`ω` the matrix-multiplication exponent) or `O(V^3)` by Gaussian elimination. *This is the canonical "the embedding does real algorithmic work" result*: without the faces, there is no way to construct the orientation, and the problem reverts to `#P`-hard. Applications include statistical mechanics (the dimer model / Ising model on planar lattices) and counting spanning structures.

**Relation to other counting.** Contrast with **Kirchhoff's matrix-tree theorem** (sibling `24-kirchhoff-theorem`), which counts *spanning trees* via a determinant for *all* graphs; FKT is the planar-only analogue for *perfect matchings*, and the planarity is essential precisely because the Pfaffian orientation is built face-by-face.

---

## 15. Rigorous Pitfalls and Boundary Conditions

The clean statement `V − E + F = 2` hides several boundary conditions that a rigorous treatment must pin down. We collect the failure cases and the exact hypotheses each result needs.

**P1 — Connectivity is non-negotiable for `= 2`.** Theorem 2.1 *requires* connectivity. The correct general statement is `V − E + F = 1 + C` (Theorem 10.1). A common error is to "prove" a graph non-planar by getting `V − E + F ≠ 2` when in fact the graph is disconnected and the value is `1 + C`. *Always establish `C` first.*

**P2 — The edge bounds need simplicity.** Theorems 3.1 and 4.1 assume **no self-loops and no parallel edges**. A multigraph can have arbitrarily many edges on few vertices while remaining planar (e.g. two vertices joined by `k` parallel arcs is planar with `E = k ≫ 3V − 6 = 0`). The bounds are statements about *simple* graphs; normalize first or they are vacuous.

**P3 —`V ≥ 3` is required.** For `V = 1` the bound `3V − 6 = −3` is negative and meaningless; for `V = 2`, `3V − 6 = 0` would forbid the single edge `K2`, which is planar. The proofs use "every face has degree ≥ 3," which needs at least a triangle's worth of structure. Treat `V < 3` as trivially planar by convention.

**P4 — Face degree ≥ 3 needs a cycle.** The step "`deg(f) ≥ 3`" in Theorem 3.1 silently assumes the graph has a cycle (so faces are bounded by genuine closed walks). A tree has one face of degree `2(V−1)` (every edge traversed twice), and the bound is reached only by extending to a maximal planar supergraph. The rigorous proof adds edges to a triangulation, bounds *that*, and notes deletion only decreases `E`.

**P5 — The outer face is a face.** In every count above, `F` includes the unbounded face. On the *sphere* there is no distinguished outer face and the symmetry is clean; on the *plane* one must remember it. Embedding the graph on `S²` (one-point compactification) is the standard way to make the outer face "just another face" and recover full duality (Proposition 7.3).

**P6 — Embedding-dependence of face structure, not face count.** For a *connected* graph, `F` is invariant (it equals `E − V + 2` regardless of embedding). But which walks bound which faces, the degree sequence of faces, and the dual graph **can** differ between inequivalent embeddings of a non-3-connected graph. *Whitney's theorem* (1932): a 3-connected planar graph has a **unique** embedding (up to reflection) on the sphere, so for 3-connected graphs even the face *structure* is canonical. Below 3-connectivity, the dual is embedding-dependent.

**P7 — Subdivision vs minor subtlety.** Kuratowski uses *subdivisions*; Wagner uses *minors*. They coincide for `K3,3` (cubic, so any minor model uses degree-3 branch vertices that force a subdivision) but a `K5`-*minor* may only certify a `K5`- or `K3,3`-*subdivision*. Stating "contains `K5` as a subgraph" is wrong — non-planarity is about subdivisions/minors, not subgraphs.

These conditions are exactly the ones the junior- and interview-level pitfalls warn about, here promoted to precise hypotheses on each theorem.

---

## 16. Worked Computations and Classical Corollaries

We close the theory with fully worked instances that verify every formula above and connect to classical results.

### 16.1 The Platonic solids satisfy `V − E + F = 2`

Euler discovered the formula on polyhedra; the 1-skeleton of every convex polyhedron is a 3-connected planar graph (Steinitz's theorem), so all five Platonic solids obey it exactly:

| Solid | `V` | `E` | `F` | `V − E + F` | face type |
|-------|-----|-----|-----|-------------|-----------|
| Tetrahedron | 4 | 6 | 4 | **2** | triangles (= `K4`) |
| Cube | 8 | 12 | 6 | **2** | squares |
| Octahedron | 6 | 12 | 8 | **2** | triangles |
| Dodecahedron | 20 | 30 | 12 | **2** | pentagons |
| Icosahedron | 12 | 30 | 20 | **2** | triangles |

**Steinitz's theorem (1922).** A graph is the edge graph of some convex 3-polytope **iff** it is simple, planar, and 3-connected. So "convex polyhedron" and "3-connected planar graph" are the same objects — and by Whitney (P6) each has a unique embedding, which is why the table is unambiguous.

**Derivation of the regular-polyhedra count.** A regular polyhedron has every vertex of degree `q` and every face of degree `p`. Then `pF = 2E` (face handshake) and `qV = 2E` (vertex handshake). Substituting `V = 2E/q`, `F = 2E/p` into Euler:
```
2E/q − E + 2E/p = 2   ⟹   1/p + 1/q = 1/2 + 1/E > 1/2.
```
The integer solutions with `p, q ≥ 3` of `1/p + 1/q > 1/2` are exactly `(3,3), (3,4), (4,3), (3,5), (5,3)` — the five Platonic solids, no more. Euler's formula *proves there are exactly five regular polyhedra*. This is the oldest and most famous corollary.

### 16.2 A non-planar verification: `K6` minus a perfect matching

Consider `K_{3,3}` again but verify via the dual count of an attempted embedding. Any drawing must have `F = E − V + 2 = 9 − 6 + 2 = 5` faces *if* it were planar. But each face would need degree ≥ 4 (triangle-free), so `Σ deg(f) ≥ 4·5 = 20 > 2E = 18` — contradiction. The face count an embedding *would* require is itself inconsistent with the face-handshake, a second independent proof of non-planarity complementing §5.

### 16.3 Triangulation equality, checked

A maximal planar graph (triangulation) on `V = 10`:
```
E = 3V − 6 = 24,   F = 2V − 4 = 16.
Check Euler:  10 − 24 + 16 = 2. ✓
Check face handshake (all triangles):  Σ deg(f) = 3·16 = 48 = 2·24 = 2E. ✓
Check average degree:  2E/V = 48/10 = 4.8 < 6. ✓
```
Every invariant in this document agrees on the densest possible simple planar graph.

### 16.4 Genus check: `K5` and `K7` on the torus

For `K5`: `g ≥ ⌈(E − 3V + 6)/6⌉ = ⌈(10 − 15 + 6)/6⌉ = ⌈1/6⌉ = 1`. On the torus (`χ = 0`) a cellular embedding needs `V − E + F = 0`, so `F = E − V = 10 − 5 = 5` faces. The face-handshake then requires `Σ deg(f) = 2E = 20` spread over 5 faces — average degree 4, so the torus embedding of `K5` is *not* a triangulation (some faces are quadrilaterals). The genus bound is tight: `K5` is the smallest non-planar graph and is toroidal.

For `K7`: `g ≥ ⌈(21 − 21 + 6)/6⌉ = 1`, and `K7` famously triangulates the torus: `V − E + F = 7 − 21 + F = 0 ⟹ F = 14`, with `2E = 42 = 3·14` — all triangles. This is the embedding behind the 7-coloring of the torus (Heawood bound `H(1) = 7`), the higher-genus analogue of the Four-Color Theorem.

### 16.5 The prism family `Y_n` (a parametric check)

The `n`-prism `Y_n` (two `n`-cycles joined by a "rung" between corresponding vertices — the cube is `Y_4`) is 3-regular and planar for all `n ≥ 3`:
```
V = 2n,   E = 3n   (each of 2n vertices has degree 3, so 2E = 6n)
F = E − V + 2 = 3n − 2n + 2 = n + 2.
```
The `n + 2` faces are: the two `n`-gon "caps" plus the `n` rectangular side faces. Check the face handshake: two faces of degree `n` and `n` faces of degree 4 give `Σ deg(f) = 2n + 4n = 6n = 2E`. ✓ This parametric family verifies Euler's formula for arbitrarily large planar graphs in closed form — the cube (`n = 4`: `V = 8, E = 12, F = 6`) is the row in §16.1.

### 16.6 A self-dual example

The `n`-pyramid (wheel `W_n`: an `n`-cycle plus a hub joined to all `n` rim vertices) has `V = n + 1`, `E = 2n`, `F = n + 1`. Notice `V = F` — the wheel is **self-dual**: `W_n* ≅ W_n`. Euler check: `(n+1) − 2n + (n+1) = 2`. ✓ Self-dual planar graphs are exactly those where the dual construction returns an isomorphic graph, and they always satisfy `V = F`, forcing `E = 2V − 2` via Euler. The smallest is `W_3 = K_4`, the self-dual tetrahedron (`V = F = 4`, `E = 6`).

### 16.7 Bipartite planar saturation

A bipartite planar graph hits its bound `E = 2V − 4` exactly when every face is a quadrilateral (a *quadrangulation*). For the `m × n` grid graph (`V = mn`, `E = 2mn − m − n`, bipartite): the bounded faces are the `(m−1)(n−1)` unit squares, so `F = (m−1)(n−1) + 1`. Euler check: `mn − (2mn − m − n) + ((m−1)(n−1) + 1) = mn − 2mn + m + n + mn − m − n + 1 + 1 = 2`. ✓ The grid is *not* edge-saturated (`E < 2V − 4` for the open grid because the boundary faces are large), but a quadrangulation of the sphere reaches equality — confirming the `2V − 4` bound is tight precisely on all-quadrilateral embeddings, mirroring how `3V − 6` is tight on triangulations.

These computations are the ground truth that the code in `junior.md`, `middle.md`, and `tasks.md` reproduces programmatically.

---

## 17. The Algebraic View: Cycle Space, Cut Space, and Homology

Euler's formula has a clean linear-algebra incarnation that explains *why* the numbers are what they are.

**Definition 17.1 (Edge space over GF(2)).** Let `ℰ = GF(2)^E` be the vector space whose vectors are subsets of edges (symmetric difference = addition). The **cycle space** `𝒵` is the subspace spanned by the edge sets of cycles; the **cut space** `𝒞` is spanned by the edge sets of vertex cuts (bonds).

**Theorem 17.2 (Dimensions).** For a connected graph,
```
dim 𝒵 = E − V + 1   (the cycle rank / first Betti number, β₁)
dim 𝒞 = V − 1        (the cut rank)
dim 𝒵 + dim 𝒞 = E,   and  𝒵 = 𝒞^⊥  (orthogonal complements).
```

*Proof.* A spanning tree has `V − 1` edges; each of the remaining `E − V + 1` non-tree edges defines a unique **fundamental cycle**, and these are independent and span `𝒵`, giving `dim 𝒵 = E − V + 1`. The fundamental cuts of tree edges span `𝒞` with dimension `V − 1`. Orthogonality (`every cycle meets every cut in an even number of edges`) gives `𝒵 = 𝒞^⊥`. ∎

**Connection to Euler.** The cycle rank `β₁ = E − V + 1` is *exactly* `F − 1` for a connected plane graph (the number of **bounded** faces), because Euler's formula says `F = E − V + 2`, so `F − 1 = E − V + 1 = dim 𝒵`. In topological terms: the bounded faces form a basis of the first homology of the plane graph's complement, and the cycle space is the homology `H₁`. **Euler's formula is the statement `β₀ − β₁ + β₂ = χ`** (the Euler–Poincaré relation) specialized to a 2-sphere where `β₀ = 1` (connected), `β₂ = 1` (one enclosed "inside"), and `β₁ = E − V + 1` — giving `χ = 1 − (E − V + 1) + 1 = V − E + 2 − ... ` reorganized into `V − E + F = 2` once each independent cycle is identified with a face.

**Theorem 17.3 (Planar duality is GF(2)-orthogonality).** For a connected *plane* graph, the cycle space of `G` equals the cut space of its dual `G*`, and vice versa:
```
𝒵(G) = 𝒞(G*),   𝒞(G) = 𝒵(G*).
```
This is Proposition 7.4 (cycle ↔ cut) recast as a vector-space isomorphism. It is *the* reason planar `s–t` min-cut reduces to shortest separating cycle: a minimum cut in `G` is a minimum-weight cycle in `G*`, and shortest cycles are far easier than minimum cuts.

**Corollary 17.4 (Counting via the cycle rank).** The number of independent cycles `E − V + 1` bounds the complexity of many planar algorithms: a planar graph's cycle rank is `≤ 2V − 5` (since `E ≤ 3V − 6`), so any algorithm enumerating a cycle basis runs in `O(V)` space. For the dual, the cut rank `V* − 1 = F − 1 = E − V + 1` agrees — duality makes the two ranks swap, as the theorem demands.

This algebraic perspective is why Euler's formula is not a coincidence of small examples but a homological invariant: `V − E + F` *must* equal the Euler characteristic of the surface, for the same reason that `β₀ − β₁ + β₂` is a topological invariant independent of triangulation. It also explains §11's separator theorem (the cycle space's geometry on a planar graph is what bounds separator size) and §14's FKT algorithm (the Pfaffian lives on the cycle space of the embedding).

### 17.5 Worked cycle-space example

Take the square-plus-diagonal from `junior.md`: vertices `{a, b, c, d}`, edges `{ab, bc, cd, da, ac}`, so `V = 4`, `E = 5`, connected. Predictions:
```
dim 𝒵 = E − V + 1 = 5 − 4 + 1 = 2   (two independent cycles)
dim 𝒞 = V − 1 = 3
F (bounded faces) = dim 𝒵 = 2,  total F = 2 + 1 = 3   (matches Euler E − V + 2 = 3)
```
A cycle basis: the two triangles `{ab, bc, ca}` and `{ac, cd, da}` (note the diagonal `ac` appears in both). Their symmetric difference is `{ab, bc, cd, da}` — the outer square, the third cycle, confirming the basis spans a 2-dimensional space (the outer square is the sum of the two triangles over GF(2)).

The **bounded faces are exactly a cycle basis**: the two triangular faces. This is the concrete content of "bounded faces span `H₁`," and it is why a planar graph's face structure is not arbitrary — the faces *must* number `E − V + 2` because the cycle space *must* have dimension `E − V + 1`.

### 17.6 The Euler characteristic as a rank identity

Stacking the dimensions:
```
E = dim 𝒵 + dim 𝒞 = (E − V + 1) + (V − 1).         (always true)
```
For a *plane* graph, `dim 𝒵 = F − 1` (bounded faces) and adding the outer face plus the "single connected component" gives
```
V − E + F = V − E + (dim 𝒵 + 1) = V − E + (E − V + 1) + 1 = 2.
```
So Euler's formula is *algebraically forced* by the rank-nullity theorem applied to the boundary operator `∂: GF(2)^E → GF(2)^V`. The kernel of `∂` is the cycle space (dimension `E − V + 1`), its image has dimension `V − 1` (a connected graph), and rank-nullity reads `E = (E − V + 1) + (V − 1)` — the linear-algebraic shadow of `V − E + F = 2`. No drawing is needed; the formula is a theorem about a `2 × 2` chain complex.

The payoff of this view is conceptual closure: the *combinatorial* face count (`junior.md`), the *algorithmic* face trace (`middle.md`), the *systems* invariant `V − E + F = 1 + C` (`senior.md`), and the *topological* Euler characteristic of this section are four faces of one identity. Whether you compute `F` by arithmetic, by walking darts, by maintaining a DCEL, or by taking the rank of a boundary matrix, you get the same number — because it is an invariant of the surface, not of the method.

---

## 18. Summary

- **Definitions.** An embedding is captured combinatorially by a **rotation system**; faces are the orbits of the dart permutation `σ`, and the face-handshake `Σ deg(f) = 2E` (Lemma 1.5) is the algebraic engine of every edge bound.
- **Euler.** `V − E + F = 2` for connected plane graphs, proved by induction on edges (remove a cycle edge: `E, F` each drop by 1) or via a spanning tree (each of the `E − V + 1` non-tree edges splits a face).
- **Edge bounds.** `Σ deg(f) = 2E` with `deg(f) ≥ 3` gives `E ≤ 3V − 6`; with `deg(f) ≥ 4` (triangle-free) gives `E ≤ 2V − 4`; girth `g` generalizes to `E ≤ (g/(g−2))(V − 2)`. These bounds prove `K5` (`10 > 9`) and `K3,3` (`9 > 8`) non-planar in one line each, and yield Corollary 3.3 (a degree-`≤ 5` vertex always exists).
- **Characterization.** Kuratowski (no `K5`/`K3,3` subdivision) and Wagner (no `K5`/`K3,3` minor) make non-planarity decidable; linear-time testers (`O(V)`) plus witness extraction supersede naive minor search.
- **Duality.** `G*` has `V* = F, E* = E, F* = V`; cycles ↔ cuts, face-coloring ↔ vertex-coloring — the formal link to map coloring and planar min-cut.
- **Coloring.** The **Five-Color Theorem** has a clean Kempe-chain proof resting on the degree-`≤ 5` corollary and Jordan-curve separation; the **Four-Color Theorem** needs the discharging method, seeded by the identity `Σ (6 − deg(v)) = 12`, and a computer-checked unavoidable set of reducible configurations.
- **Generalizations.** Disconnected: `V − E + F = 1 + C`; genus `g`: `V − E + F = 2 − 2g`, with `K5`, `K7` toroidal and Heawood's bound `⌊(7 + √(1 + 48g))/2⌋` giving the chromatic number of every surface except the still-special plane.
- **Separators.** Lipton–Tarjan gives an `O(√n)` balanced separator (forced by the linear edge bound + Jordan-curve separation), enabling nested dissection (`O(n^{1.5})` sparse solves) and `2^{O(√n)}` exact algorithms.
- **Algorithmics.** Linear-time planarity testing (`O(V)`) via path addition (Hopcroft–Tarjan), PQ-trees (Booth–Lueker), or edge addition (Boyer–Myrvold); straight-line drawings exist (Fáry) on an `O(V²)` grid (Schnyder) and via barycentric coordinates (Tutte).
- **Counting.** Perfect matchings, `#P`-hard in general, are polynomial on planar graphs via the FKT Pfaffian-orientation algorithm — built face-by-face from the embedding.
- **Hypotheses.** Each result has sharp boundary conditions: connectivity for `= 2`, simplicity for the edge bounds, `V ≥ 3`, the outer face always counted, and subdivision/minor (not subgraph) for Kuratowski/Wagner; 3-connected graphs have unique embeddings (Whitney).

Euler (1750) gave the formula; Kuratowski (1930) and Wagner (1937) the characterization; Heawood (1890) the Five-Color Theorem and the surface chromatic bound; Appel–Haken (1976) and Robertson–Sanders–Seymour–Thomas (1997) the Four-Color Theorem; Hopcroft–Tarjan (1974) linear-time testing. The subject is 275 years old, fits its core results in two inequalities, and still anchors map coloring, circuit layout, and surface topology.

### Annotated references for further depth

- **Diestel, *Graph Theory* (5th ed.), Ch. 4 "Planar Graphs."** The cleanest modern proofs of Euler's formula, Kuratowski, Wagner, and the uniqueness of 3-connected embeddings (Whitney). The chapter develops planarity via 3-connected reductions — the route sketched in §6.
- **West, *Introduction to Graph Theory*, Ch. 6.** Gentler than Diestel; full Five-Color proof with the Kempe-chain bookkeeping of §8 spelled out, plus the discharging primer for §9.
- **Mohar & Thomassen, *Graphs on Surfaces*.** The authoritative reference for the genus theory of §10, the Euler–Poincaré relation, and Heawood's map-coloring theorem on arbitrary surfaces.
- **Hopcroft & Tarjan (1974), "Efficient planarity testing," JACM 21(4).** The original linear-time algorithm of §12.1.
- **Boyer & Myrvold (2004), "On the cutting edge: simplified O(n) planarity by edge addition," JGAA 8(3).** The practical algorithm behind Boost and OGDF, with native Kuratowski extraction (§12.3).
- **Lipton & Tarjan (1979), "A separator theorem for planar graphs," SIAM J. Appl. Math. 36.** The separator theorem of §11 and its nested-dissection consequences.
- **Schnyder (1990), "Embedding planar graphs on the grid," SODA.** The `O(V²)`-area straight-line drawing of §13.3 via Schnyder woods.
- **Kasteleyn (1967), "Graph theory and crystal physics."** The FKT Pfaffian method of §14, in its original statistical-mechanics setting.
- **Appel & Haken (1977) and Robertson–Sanders–Seymour–Thomas (1997).** The two computer-assisted proofs of the Four-Color Theorem (§9); the latter is the one most implementations follow.

For sibling topics: `27-graph-coloring` (chromatic number algorithms and the coloring consequences of §§8–9), `24-kirchhoff-theorem` (the spanning-tree determinant contrasted with FKT in §14), `11-articulation-points-bridges` (the lowpoint machinery reused by planarity testers in §12), and `16-max-flow-edmonds-karp-dinic` (the general max-flow that planar dual min-cut, §7 and §17.3, beats).
