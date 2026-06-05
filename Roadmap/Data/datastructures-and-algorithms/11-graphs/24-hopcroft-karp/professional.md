# Hopcroft-Karp Algorithm — Mathematical Foundations and Complexity Theory

> **One-line summary:** This file proves Hopcroft-Karp's `O(E·√V)` running time rigorously: it establishes Berge's theorem, shows that flipping a *maximal set of vertex-disjoint shortest augmenting paths* makes the shortest augmenting-path length **strictly increase** each phase, and uses a symmetric-difference counting argument to bound the number of phases by `O(√V)`.

---

## Table of Contents

1. [Formal Definitions](#formal-definitions)
2. [Berge's Theorem (Correctness Foundation)](#berges-theorem)
3. [Symmetric Difference Structure](#symmetric-difference-structure)
4. [Phase Correctness — Shortest Path Length Strictly Increases](#phase-correctness)
5. [The O(√V) Phase Bound](#the-sqrt-v-phase-bound)
6. [Per-Phase Complexity and Total Running Time](#per-phase-complexity)
7. [Duality: Hopcroft-Karp as Dinic on Unit-Capacity Networks](#duality-dinic)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Summary](#summary)

---

## Formal Definitions

```text
Bipartite graph: G = (L ∪ R, E),  E ⊆ L × R.   V = |L ∪ R|,  E = |E|.

Matching M ⊆ E:  no two edges in M share an endpoint.
  A vertex is FREE (exposed) w.r.t. M if no edge of M is incident to it;
  otherwise it is MATCHED (saturated).

Alternating path P w.r.t. M:  a simple path whose edges alternate
  between E \ M and M.

Augmenting path P w.r.t. M:  an alternating path whose BOTH endpoints
  are free. (In bipartite G it has odd length, starts at a free L vertex
  and ends at a free R vertex, and has one more non-matching edge than
  matching edges.)

Symmetric difference:  for edge sets A, B,   A ⊕ B = (A \ B) ∪ (B \ A).
```

**Augmentation operation.** Given a matching `M` and an augmenting path `P`, define `M' = M ⊕ P`. Then `M'` is a matching with `|M'| = |M| + 1`. (Flipping `P`: matching edges become free, free edges become matching; the two free endpoints become matched; all internal vertices keep degree 1 in the matching.)

```text
Let ℓ(M) = length (number of edges) of a SHORTEST augmenting path
           w.r.t. M, or ∞ if none exists.
```

---

## Berge's Theorem

> **Theorem (Berge, 1957).** A matching `M` is maximum **if and only if** there is no augmenting path with respect to `M`.

**Proof.**

(⇒) If an augmenting path `P` exists, then `M ⊕ P` is a matching of size `|M| + 1`, so `M` is not maximum. Contrapositive: maximum ⇒ no augmenting path.

(⇐) Suppose `M` has no augmenting path but is not maximum; let `M*` be a maximum matching, `|M*| > |M|`. Consider `H = M ⊕ M*`. Every vertex has degree at most 2 in `H` (at most one edge from each of `M`, `M*`), so `H` is a disjoint union of **simple paths and even cycles**, with edges alternating between `M` and `M*`:

- Even cycles contribute equally to `M` and `M*`.
- Even-length paths contribute equally.
- An **odd-length path** has one more `M*`-edge than `M`-edge.

Since `|M*| > |M|`, at least one component must have more `M*`-edges than `M`-edges — necessarily an odd-length path `P`. Both endpoints of `P` are matched in `M*` but free in `M` (else `P` could be extended). Thus `P` alternates and has both endpoints free w.r.t. `M`: it is an augmenting path for `M`. Contradiction. Hence no augmenting path ⇒ `M` is maximum. ∎

**Consequence for the algorithm.** Hopcroft-Karp halts exactly when a BFS finds no augmenting path. By Berge, the matching is then maximum. Correctness is therefore independent of *how* paths are scheduled — only termination at "no augmenting path" matters.

---

## Symmetric Difference Structure

We will repeatedly use this structural lemma.

> **Lemma 1 (Decomposition).** For any two matchings `M`, `M*`, the graph `(V, M ⊕ M*)` consists of vertex-disjoint simple paths and simple cycles, each with edges alternating between `M` and `M*`. All cycles have even length.

**Proof.** Each vertex is incident to at most one `M`-edge and at most one `M*`-edge in `M ⊕ M*`, so its degree is ≤ 2. A graph with max degree 2 is a disjoint union of paths and cycles. Alternation follows because two consecutive edges at a vertex cannot both be from `M` (would share that vertex) nor both from `M*`. Bipartiteness forbids odd cycles. ∎

> **Corollary.** If `|M*| = |M| + k`, then `M ⊕ M*` contains **at least `k` vertex-disjoint augmenting paths** w.r.t. `M` (the odd-length paths with surplus `M*`-edges).

---

## Phase Correctness — Shortest Path Length Strictly Increases

This is the technical heart of Hopcroft-Karp. A **phase** does:

1. BFS from all free `L` vertices, computing layered distances; let `ℓ = ℓ(M)` be the shortest augmenting-path length found.
2. Find a **maximal** set `Φ = {P₁, …, Pₜ}` of *vertex-disjoint* augmenting paths, **each of length exactly `ℓ`** (the DFS only walks layer `k → k+1`).
3. Set `M ← M ⊕ (P₁ ∪ … ∪ Pₜ)`.

> **Theorem 2 (Strict increase).** Let `M` be the matching before a phase and `M'` the matching after. Then `ℓ(M') > ℓ(M)`. Equivalently, the shortest augmenting-path length strictly increases each phase.

We prove it via two lemmas.

> **Lemma 2a.** After augmenting along the maximal set `Φ` of shortest (length-`ℓ`) augmenting paths, **no augmenting path of length `ℓ` remains** w.r.t. `M'`.

**Proof sketch.** Suppose `Q` is an augmenting path of length `ℓ` w.r.t. `M'`. We show `Q` must share a vertex with some `Pᵢ ∈ Φ`; otherwise `Q` would have been a length-`ℓ` augmenting path *vertex-disjoint* from all of `Φ` w.r.t. the original `M` too, contradicting the **maximality** of `Φ`. (If `Q` touches none of the `Pᵢ`, then flipping `Φ` did not change any edge on `Q`, so `Q` was already augmenting for `M` and disjoint from `Φ`, so `Φ` could have included `Q` — not maximal.) A careful exchange argument (using that all `Pᵢ` and `Q` have the *same* minimal length `ℓ`) shows that any length-`ℓ` augmenting path for `M'` that intersects `Φ` would imply the existence of a *shorter* augmenting path for the original `M`, contradicting `ℓ = ℓ(M)`. Hence no length-`ℓ` augmenting path survives. ∎

> **Lemma 2b.** Augmentation along shortest paths never *decreases* the shortest augmenting-path length: `ℓ(M') ≥ ℓ(M)`.

**Proof sketch.** Let `Q` be any augmenting path for `M'`. Consider `M ⊕ M'` (which is exactly the union of the paths in `Φ`) together with `Q`. Analyzing `M ⊕ (M' ⊕ Q) = M ⊕ M'' ` where `|M''| = |M| + t + 1` (the new bigger matching), the decomposition (Lemma 1) yields `t + 1` vertex-disjoint augmenting paths for `M`, whose total length is at most the total length of the `Φ`-paths plus `|Q|`. Since each of the `t+1` augmenting paths for `M` has length ≥ `ℓ(M)`, a counting inequality forces `|Q| ≥ ℓ(M)`. Hence `ℓ(M') ≥ ℓ(M)`. ∎

Combining: by Lemma 2b `ℓ(M') ≥ ℓ(M)`, and by Lemma 2a no length-`ℓ(M)` path remains, so `ℓ(M') > ℓ(M)`. **Theorem 2 holds.** ∎

```text
Phase 1: ℓ = 1, 3, 5, ...   (strictly increasing, odd lengths)
         ℓ(M_0) < ℓ(M_1) < ℓ(M_2) < ...
```

The strict monotonicity is what makes phases "make progress" in a measurable currency: the shortest-path length.

---

## The O(√V) Phase Bound

> **Theorem 3 (Phase count).** Hopcroft-Karp performs `O(√V)` phases.

**Proof.** Run the algorithm for the first `⌈√V⌉` phases. By Theorem 2, after these phases the shortest augmenting-path length satisfies

```text
ℓ(M) ≥ ⌈√V⌉ + 1   (length increases by ≥ 2 each phase, paths are odd-length;
                    at minimum it increases by ≥ 1, which suffices)
```

so `ℓ(M) > √V`. Let `M` be the current matching and `M*` a maximum matching. By the Corollary to Lemma 1,

```text
M ⊕ M*  contains  (|M*| − |M|)  vertex-disjoint augmenting paths for M.
```

Each such augmenting path has length `≥ ℓ(M) > √V`, hence contains `> √V` vertices. Because the paths are **vertex-disjoint**, the total number of vertices they use is `> √V · (|M*| − |M|)`, and this cannot exceed `V`:

```text
√V · (|M*| − |M|) < V   ⇒   |M*| − |M| < √V.
```

So at most `√V − 1` augmenting paths remain. Each remaining phase increases `|M|` by **at least one** (a non-empty maximal set), so at most `√V` further phases finish the algorithm.

```text
Total phases  ≤  ⌈√V⌉  +  √V   =  O(√V).   ∎
```

The proof's beauty: the *same* threshold `√V` bounds both regimes — "early phases, paths still short" (at most `√V` of them) and "late phases, few paths left" (at most `√V` of them). Balancing the two halves at `√V` is the source of the exponent `5/2 = 2 + 1/2` in the original paper's title ("an `n^{5/2}` algorithm").

---

## Per-Phase Complexity and Total Running Time

> **Lemma 4.** A single phase runs in `O(E)` time.

**Proof.**

- **BFS:** a multi-source BFS over the bipartite graph visits each vertex once and scans each edge `O(1)` times: `O(V + E) = O(E)` (assuming `E ≥ V/2`; isolated vertices are dropped).
- **DFS (blocking step):** each edge is traversed at most a constant number of times across the entire phase. The key device is the dead-end prune `dist[u] = INF`: once a left vertex `u` fails to start any augmenting path, it is never re-entered this phase. The `dist[w] == dist[u] + 1` constraint means the DFS only moves "forward" in the layered DAG, so it cannot cycle. Charging each edge traversal to either an advance or a (one-time) retreat gives `O(E)` total DFS work per phase.

Hence each phase is `O(E)`. ∎

> **Theorem 5 (Total time).** Hopcroft-Karp runs in `O(E·√V)` time.

**Proof.** `O(√V)` phases (Theorem 3) × `O(E)` per phase (Lemma 4) = `O(E·√V)`. ∎

> **Space.** `O(V + E)`: adjacency lists `O(V + E)`, and the arrays `pairU`, `pairV`, `dist` are `O(V)`.

```text
Definition:  Phi(M) = ℓ(M)  is the potential we track per phase.
Each phase:  Phi strictly increases (Theorem 2).
Bounded by:  Phi ≤ V  (a simple path has ≤ V−1 edges).
Two-regime bound balances at √V (Theorem 3).
Cost per unit of Phi-progress: O(E).
Total: O(E·√V).
```

---

## Duality: Hopcroft-Karp as Dinic on Unit-Capacity Networks

> **Theorem 6.** Hopcroft-Karp is exactly Dinic's max-flow algorithm executed on the unit-capacity bipartite flow network, and its `O(E√V)` bound is the specialization of Dinic's `O(E·√V)` bound for unit-capacity graphs.

**Construction.** Build network `N`:

```text
source s --(cap 1)--> each u ∈ L
each u ∈ L --(cap 1)--> each neighbor v ∈ R   (original edges, directed)
each v ∈ R --(cap 1)--> sink t
```

**Equivalence.**

- An integral `s–t` flow of value `f` ⇔ a matching of size `f` (saturated middle edges are matched pairs).
- Dinic's **level graph** (BFS from `s`) ⇔ Hopcroft-Karp's **distance layers**.
- Dinic's **blocking flow** (a flow that saturates at least one edge on every `s–t` level path) ⇔ a **maximal set of vertex-disjoint shortest augmenting paths**.
- One Dinic phase (level graph + blocking flow) ⇔ one Hopcroft-Karp phase (BFS + DFS).

**The bound.** For unit-capacity networks, Dinic performs `O(√E)` or `O(√V)` phases. The classic argument (Even–Tarjan / Karzanov) shows that after `√V` phases the shortest `s–t` distance exceeds `√V`, and the residual flow value is `< √V` (each remaining augmenting path is long and vertex-disjoint) — the very same symmetric-difference counting we used in Theorem 3. Hence `O(√V)` phases, `O(E)` each, total `O(E√V)`. ∎

This duality means Hopcroft-Karp is not a lucky one-off: it is an instance of a general principle — **shortest-augmenting-path / blocking-flow methods on unit-capacity structures run in `O(E√V)`**.

---

## Worked Example — Watching the Invariant Hold

Theorems are easier to trust after a concrete trace. Take `L = {1,2,3}`, `R = {a,b,c}`, edges:

```text
1—a   1—b   2—a   3—b   3—c
```

**Initial:** `M = ∅`, all vertices free, `ℓ(∅) = 1` (any single unmatched edge to a free right vertex is an augmenting path of length 1).

**Phase 1.** BFS gives every free left vertex layer 0; all right vertices are free, so the shortest augmenting path has length `ℓ = 1`. A *maximal* disjoint set of length-1 paths:

```text
1—a (flip),  3—b (flip).      2—a blocked (a taken this phase).
M = {1—a, 3—b},  |M| = 2.
```

**Phase 2.** Now only `2` (left) and `c` (right) are free. BFS layers:

```text
d(2)=0  ->  a (d=1)  ->  1 (d=2)  ->  b (d=3)  ->  3 (d=4)  ->  c (free, d=5)
ℓ(M) = 5.        Check: 5 > 1.  ✓  (Theorem 2 — strict increase.)
```

DFS finds the single augmenting path `2–a–1–b–3–c` (length 5), flips it:

```text
M = {2—a, 1—b, 3—c},  |M| = 3.
```

**Phase 3.** No free left vertices remain. BFS returns `ℓ = ∞`. By Berge, `M` is maximum. `|M| = 3`.

The sequence `ℓ = 1, 5, ∞` is strictly increasing exactly as Theorem 2 guarantees. Note also that `√V = √6 ≈ 2.4`, and the algorithm used 2 working phases — consistent with the `O(√V)` bound (Theorem 3).

A second observation worth internalizing: phase 1 alone augmented **two** disjoint paths (`1—a` and `3—b`) in a *single* BFS+DFS round. Under Kuhn, those would have been two separate `O(E)` DFS searches launched from two different left vertices. Hopcroft-Karp's batching collapses them into one phase — the practical source of its speed, distinct from but reinforcing the asymptotic `√V` argument. The strict-increase invariant guarantees the *phase count* is small; the batching guarantees each phase *extracts many paths*. Together they yield `O(E√V)`.

One more sanity check against Theorem 3's counting: after phase 1, `|M| = 2` and `|M*| = 3`, so the deficit `|M*| − |M| = 1 < √V ≈ 2.4`. The bound predicts at most `⌈√V⌉ = 3` further phases; we needed exactly 1. Real inputs almost always finish well inside the worst-case envelope.

---

## Amortized View — The Potential Method

The phase analysis is cleanest as a potential argument over the *shortest-path length*.

```text
Potential:   Φ(M) = ℓ(M)  = length of a shortest augmenting path (∞ when none).
Range:       1 ≤ Φ ≤ V−1   while augmenting paths exist (a simple path
             has at most V−1 edges; bipartite augmenting paths are odd).

Per phase:   Φ strictly increases (Theorem 2):  ΔΦ ≥ 1 (in fact ≥ 2 for
             odd-length paths, since lengths jump over even values).
Work/phase:  O(E)  (Lemma 4).
```

Split the run at the threshold `Φ = √V`:

```text
Regime A (Φ ≤ √V):  at most √V phases, since ΔΦ ≥ 1 each phase.
                    Cost:  ≤ √V · O(E) = O(E√V).

Regime B (Φ >  √V):  matching deficit |M*|−|M| < √V (Theorem 3 counting),
                    so ≤ √V more phases (each adds ≥ 1 to |M|).
                    Cost:  ≤ √V · O(E) = O(E√V).

Total:  O(E√V).
```

The potential never needs to be *computed* — it is purely an accounting device. The algorithm only ever asks "does an augmenting path exist?" (the `dist[0] ≠ ∞` test). The potential exists in the proof, not the code.

---

## Why "Maximal" Suffices — A Closer Exchange Argument

It is worth dwelling on Lemma 2a, because the word *maximal* (not *maximum*) is the subtle linchpin.

```text
Claim:  After flipping a MAXIMAL disjoint set Φ of length-ℓ augmenting paths,
        every augmenting path Q for the new matching M' has length > ℓ.
```

**Argument.** Suppose for contradiction `|Q| = ℓ` (it cannot be `< ℓ` by Lemma 2b). Consider the edges of `Q` relative to the original `M`:

1. If `Q` is vertex-disjoint from every path in `Φ`, then none of `Q`'s edges were flipped, so `Q` was *already* a length-`ℓ` augmenting path for `M`, disjoint from `Φ`. But then `Φ ∪ {Q}` is a larger disjoint set of length-`ℓ` augmenting paths — contradicting that `Φ` was **maximal**.
2. If `Q` shares a vertex `x` with some `Pᵢ ∈ Φ`, trace `Q` and `Pᵢ` around `x`. Both have length exactly `ℓ` and meet the shortest-path layering. A standard interchange (swapping the tails of `Q` and `Pᵢ` at `x`) produces an augmenting path for the *original* `M` of length `< ℓ`, contradicting `ℓ = ℓ(M)` minimal.

Either branch is a contradiction, so no length-`ℓ` augmenting path survives. ∎

The takeaway: *maximum* would also work but is needlessly expensive (NP-hard-feeling, and certainly not `O(E)`). *Maximal* is `O(E)` to obtain greedily via the layered DFS and is provably enough. This is the exact same reason Dinic uses a *blocking* flow rather than a maximum flow per phase.

---

## The Layered Graph — Formal Invariants

The BFS builds an object we can reason about precisely. Define, after the BFS of a phase:

```text
For each vertex x, dist(x) = length of the shortest alternating path from
some free LEFT vertex to x that begins with an unmatched edge (∞ if none).

Layered graph  L_G  contains an edge x→y  iff
    (x,y) is admissible in the alternating sense  AND
    dist(y) = dist(x) + 1.
```

> **Invariant L1 (acyclicity).** `L_G` is a DAG. *Proof:* every edge strictly increases `dist`, so no cycle can return to its start. ∎

> **Invariant L2 (shortest-path completeness).** Every shortest augmenting path of the current matching is a source-to-NIL path in `L_G`. *Proof:* by definition of `dist`, any shortest augmenting path uses only `dist(y) = dist(x)+1` steps; conversely such a path has minimal length. ∎

> **Invariant L3 (DFS soundness).** The layered DFS, restricted to `dist[w] = dist[u]+1` edges, returns only augmenting paths of length exactly `ℓ = dist(NIL)`. *Proof:* immediate from L2 and the step constraint. ∎

These three invariants are what license the strict-increase theorem: the DFS is *guaranteed* to operate only on shortest augmenting paths, and (with the `dist[u]=INF` prune) to exhaust them maximally.

> **Invariant L4 (disjointness).** The paths the DFS returns in one phase are vertex-disjoint. *Proof:* once a right vertex `v` is matched within the phase, `pairV[v]` changes and the back-edge it offered is gone; once a left vertex `u` dead-ends, `dist[u]=INF` removes it from `L_G`. Hence no vertex is reused across two returned paths. ∎

---

## Termination — A Clean Induction

> **Theorem 7 (Termination).** Hopcroft-Karp terminates after `O(√V)` phases, and within each phase the DFS terminates.

**Proof.**

*Within a phase:* the DFS only follows `dist`-increasing edges in the DAG `L_G` (Invariant L1), and the `dist[u]=INF` prune monotonically shrinks the set of usable left vertices. A measure that strictly decreases each non-augmenting DFS step is `(number of left vertices with finite dist) × (max layer) − (edges already scanned)`; it is bounded below, so the DFS halts. Each phase does finite work `O(E)` (Lemma 4).

*Across phases:* by Theorem 2 the potential `Φ(M) = ℓ(M)` strictly increases per phase; it is integer-valued and bounded above by `V − 1`. A strictly increasing bounded integer sequence is finite, so the number of phases is finite — and Theorem 3 sharpens "finite" to `O(√V)`. ∎

This is the textbook shape of a termination proof: an integer potential, strictly monotone, bounded — therefore finite, with the bound made quantitative by the counting argument.

---

## Charging Argument for the `O(E)` Per-Phase DFS

Lemma 4 claimed the layered DFS costs `O(E)` per phase. Here is the explicit charging.

```text
Each DFS edge-traversal is one of:
  (a) an ADVANCE: step from u to w along an admissible edge (dist[w]=dist[u]+1).
  (b) a RETREAT:  backtrack from u after exhausting u's edges -> set dist[u]=INF.

Charge each ADVANCE to the edge it traverses.  Charge each RETREAT to the
left vertex it abandons.

- A left vertex is abandoned (RETREAT) at most once per phase (dist[u]=INF
  prevents re-entry):  ≤ |L| retreats  =>  O(V).
- An edge is advanced over O(1) times per phase, because after the path
  through it is committed or the head is abandoned, it is never re-scanned:
  ≤ O(E) advances.

Total DFS work per phase = O(V + E) = O(E).   (assuming E ≥ V/2). ∎
```

The whole engine of efficiency is the prune: without `dist[u]=INF`, a single dead-end vertex could be re-entered `Ω(deg)` times by every path that reaches it, and the phase would degrade toward `O(V·E)` — i.e. back to Kuhn.

---

## Generalization to Non-Bipartite Graphs

Hopcroft-Karp is the bipartite member of a family.

```text
Bipartite, cardinality:      Hopcroft-Karp        O(E√V)
General graph, cardinality:  Micali–Vazirani      O(E√V)
Bipartite, weighted:         Hungarian (KM)       O(V³)
General graph, weighted:     Edmonds (blossom)    O(V³) / O(V·E·log V) scaled
```

The obstruction in general graphs is **odd cycles ("blossoms")**: an alternating search can wrap around an odd cycle and the simple "layer `k → k+1`" DFS no longer guarantees a valid augmenting path. **Micali–Vazirani (1980)** extends Hopcroft-Karp by *contracting blossoms* on the fly during the layered phase search, recovering the same `O(E√V)` bound — but with substantially more intricate bookkeeping (double-DFS, bridge detection, blossom stacks). For interviews and most practice, the bipartite restriction is what makes the clean layered argument possible; remember that **bipartiteness is precisely what rules out odd cycles**, which is why the algorithm works.

---

## Hall's Marriage Theorem (Feasibility Certificate)

Hopcroft-Karp also *decides* whether a side can be fully saturated, and Hall's theorem characterizes exactly when.

> **Theorem (Hall, 1935).** A bipartite graph `G = (L ∪ R, E)` has a matching saturating all of `L` **iff** for every subset `S ⊆ L`,  `|N(S)| ≥ |S|`,  where `N(S)` is the set of right-neighbors of `S`.

**Connection to the algorithm.** If Hopcroft-Karp returns `|M| < |L|`, the unsaturated left vertices certify a **violating set**: take `S` = the left vertices reachable by alternating paths from any free left vertex; then `|N(S)| < |S|`, exactly Hall's failing condition. So the algorithm not only finds the maximum matching but, on failure to saturate `L`, hands you the *deficiency witness* `S`. The deficiency version states `max |M| = |L| − max_S (|S| − |N(S)|)` (the **defect form** of Hall's theorem), letting you read off precisely how many left vertices *cannot* be matched and why.

---

## LP Duality and König's Theorem

Maximum bipartite matching is a linear program, and its dual gives König's theorem — the deepest "free" consequence of a Hopcroft-Karp run.

```text
Primal (matching):           Dual (fractional vertex cover):
  max  Σ x_e                    min  Σ y_v
  s.t. Σ_{e ∋ v} x_e ≤ 1        s.t. y_u + y_v ≥ 1   ∀ edge (u,v)
       x_e ≥ 0                       y_v ≥ 0
```

> **Theorem 8 (Total unimodularity).** The constraint matrix of bipartite matching is **totally unimodular**; hence both the primal and dual LPs have **integral** optimal solutions. The integral primal optimum is a maximum matching; the integral dual optimum is a minimum vertex cover.

**Proof idea.** The incidence matrix of a bipartite graph is totally unimodular (every square submatrix has determinant in `{−1, 0, +1}`), because the rows can be 2-colored (`L` vs `R`) so each column has at most one `+1` per color class. Total unimodularity forces integral vertices of the LP polytope. ∎

> **Corollary (König, 1931).** In a bipartite graph, `max |matching| = min |vertex cover|`. This is LP strong duality plus integrality. Once Hopcroft-Karp gives the maximum matching, the alternating-reachability construction (`tasks.md` Task 7) extracts the dual-optimal minimum vertex cover in `O(E)`.

So a single `O(E√V)` run simultaneously certifies *both* the primal (the matching) and, via the dual, the minimum vertex cover — a primal-dual pair proving each other optimal.

This is the cleanest possible *certificate of optimality*: a verifier need not trust the algorithm. Given the matching `M` and the cover `C` with `|M| = |C|`, anyone can check in `O(E)` that `M` is a valid matching, `C` is a valid cover, and their equal sizes sandwich the optimum (`|M| ≤ OPT ≤ |C|`), forcing `|M| = OPT`. Production matchers can ship this certificate to make their output auditable.

---

## Counting and Enumeration Variants

The algorithm answers "what is the maximum?" Related decision/counting problems have different complexities — useful context for theory interviews.

| Problem | Complexity | Note |
|---------|-----------|------|
| Maximum matching size | `O(E√V)` | Hopcroft-Karp. |
| One maximum matching | `O(E√V)` | Read `pairU`. |
| Does a perfect matching exist? | `O(E√V)` | Size `= n`? Or Hall's condition. |
| **Count** perfect matchings | `#P-complete` | The permanent (Valiant, 1979) — *much* harder. |
| All edges in *some* maximum matching | `O(E√V)` | Strongly-connected-components on the residual. |
| Enumerate all maximum matchings | Output-sensitive | Uno's algorithm, polynomial delay. |

The sharp contrast — finding *one* maximum matching is polynomial (`O(E√V)`) while *counting* perfect matchings is `#P-complete` (the matrix permanent) — is a classic illustration that *optimization* and *counting* can sit on opposite sides of the tractability frontier.

---

## Lower Bounds and Optimality Context

```text
Trivial lower bound:  Ω(E)  — every edge may need to be examined.
Hopcroft-Karp:        O(E√V)  — a √V gap from the trivial bound.
```

Is `O(E√V)` optimal? In the *combinatorial* augmenting-path model it stood as the best general bound for decades. The picture changed with continuous/interior-point methods:

- **Mądry (2013)** gave `Õ(E^{10/7})` for unit-capacity max-flow (hence bipartite matching), beating `E√V` on sparse graphs.
- **Chen, Kyng, Liu, Peng, Probst Gutenberg, Sachdeva (2022)** achieved **almost-linear** `m^{1+o(1)}` max-flow, implying almost-linear maximum bipartite matching in theory.

These results are landmark *theoretical* advances but rely on heavy machinery (dynamic graph data structures, interior-point methods) and are not yet competitive in practice for typical inputs. **Hopcroft-Karp remains the practical default**: simple, deterministic, cache-friendly, and `O(E√V)` is fast enough for graphs with millions of edges.

```text
Practical decision:
  small graph            -> Kuhn (simplest)
  large/dense bipartite  -> Hopcroft-Karp (the default)
  need weights           -> Hungarian / min-cost flow
  general (non-bipartite)-> Micali–Vazirani / Blossom
  research / sparse huge  -> consider almost-linear max-flow
```

---

## Quantitative Worked Bound

To make the asymptotics concrete, instantiate the proof on a worst-case-flavored input.

```text
Setup:  balanced bipartite graph, |L| = |R| = n, so V = 2n.
        Dense edges:  E = Θ(n²).
```

By Theorem 3 the number of phases is `O(√V) = O(√(2n)) = O(√n)`. By Lemma 4 each phase is `O(E) = O(n²)`. Hence:

```text
Total time  =  O(√n) · O(n²)  =  O(n^{2.5}).
```

Contrast Kuhn: `O(V·E) = O(n · n²) = O(n³)`. The ratio is `n³ / n^{2.5} = √n`, the promised speedup. Plugging numbers:

| `n` | Phases `≈ √n` | Per phase `≈ n²` | Hopcroft-Karp `≈ n^{2.5}` | Kuhn `≈ n³` |
|-----|---------------|------------------|---------------------------|-------------|
| 100 | 10 | 10⁴ | 10⁵ | 10⁶ |
| 1,000 | ~32 | 10⁶ | ~3.2×10⁷ | 10⁹ |
| 10,000 | 100 | 10⁸ | 10¹⁰ | 10¹² |

The `n^{5/2}` in the original paper's title is exactly this `n^{2.5}` on dense inputs.

---

## Practical Constant Factors

Asymptotics hide constants that matter in production.

- **Phase count is usually far below `√V`.** The bound is worst-case. On random and on near-block-diagonal real graphs, the shortest-path length jumps by 2 each phase *and* most augmenting happens in the first 1–2 phases, so observed phase counts are often single digits even for `V` in the millions. Always measure.
- **BFS is `O(E)` but cache-sensitive.** Storing adjacency in a flat CSR (compressed sparse row) layout instead of nested lists improves locality 2–3× — the same trick as Floyd-Warshall's flat matrix.
- **Recursion vs. iteration.** The recursive DFS is cleaner but risks stack overflow on long chains; an explicit-stack DFS is both safer and typically faster.
- **Greedy warm start** removes the cheapest length-1 paths before any BFS, shaving a phase and a constant fraction of edges scanned.

```text
Engineering identity:  asymptotic class = O(E√V), but
                        wall-clock ≈ c · (phases_observed) · E,
                        and phases_observed ≪ √V on real graphs.
```

This is why a careful Hopcroft-Karp implementation routinely beats its own worst-case bound by a large margin — and why the `phases_per_run` metric (see `senior.md`) is the right production health signal.

---

## Comparison with Alternatives

| Attribute | Hopcroft-Karp | Kuhn | Dinic (general caps) | Hungarian |
|-----------|---------------|------|----------------------|-----------|
| Problem | Max-card. bipartite matching | Same | Max-flow | Weighted assignment |
| Worst-case time | `O(E·√V)` | `O(V·E)` | `O(V²E)` | `O(V³)` |
| Time on unit caps | `O(E·√V)` | — | `O(E·√V)` | — |
| Phases / iterations | `O(√V)` | `O(V)` | `O(V)` (gen.) / `O(√V)` (unit) | `O(V)` |
| Correctness basis | Berge + strict-increase | Berge | Max-flow min-cut | LP duality / Kuhn-Munkres |
| Deterministic? | Yes | Yes | Yes | Yes |
| Space | `O(V+E)` | `O(V+E)` | `O(V+E)` | `O(V²)` |

**Theoretical frontier.** For *general* (non-bipartite) graphs, Micali–Vazirani achieves `O(E√V)` for maximum matching via blossom contraction in the layered search — the natural generalization of Hopcroft-Karp. For *weighted* bipartite matching, the Hungarian algorithm is `O(V³)`; scaling/min-cost-flow methods reach `Õ(E√V · log(NW))`. Recent almost-linear-time max-flow results (Chen et al., 2022) imply near-linear maximum bipartite matching in theory, though Hopcroft-Karp remains the practical default.

---

## Summary

- **Correctness** rests on **Berge's theorem**: stop iff no augmenting path; the result is then a maximum matching, regardless of scheduling.
- **The key invariant** (Theorem 2): flipping a **maximal set of vertex-disjoint *shortest* augmenting paths** makes `ℓ(M)`, the shortest augmenting-path length, **strictly increase** each phase. Maximality is essential — it kills all surviving length-`ℓ` paths (Lemma 2a), while shortest-path augmentation never shortens `ℓ` (Lemma 2b).
- **The `O(√V)` phase bound** (Theorem 3) comes from a symmetric-difference counting argument: after `√V` phases the shortest path exceeds `√V`, so the remaining `≤ √V` vertex-disjoint long augmenting paths finish in `≤ √V` more phases.
- **Each phase is `O(E)`** (Lemma 4) via BFS + a layered DFS with `dist[u]=INF` pruning, giving **`O(E·√V)`** total (Theorem 5) and `O(V+E)` space.
- **Duality** (Theorem 6): it *is* Dinic on a unit-capacity bipartite network — the `O(E√V)` bound is a special case of the unit-capacity blocking-flow analysis.
- **Free theory:** the same run certifies the **minimum vertex cover** (König, via LP duality and total unimodularity, Theorem 8), decides saturation via **Hall's condition**, and on failure yields a deficiency witness.
- **Frontier:** `O(E√V)` is the combinatorial standard; Micali–Vazirani matches it for general graphs, and almost-linear max-flow beats it in theory — but Hopcroft-Karp remains the practical default. *Counting* perfect matchings, by contrast, is `#P-complete`.

The throughline: a single integer potential — **the shortest augmenting-path length** — strictly increasing each phase, bounded by `V`, balanced at `√V`, is the entire story behind the `n^{5/2}` running time.

---

**Next step:** Continue to [`interview.md`](./interview.md) to drill these proofs and the implementation under interview conditions, then [`tasks.md`](./tasks.md) for hands-on practice in Go, Java, and Python.
