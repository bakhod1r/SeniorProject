# Dominator Tree (Lengauer-Tarjan) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Tree Structure of Dominators — Existence and Uniqueness of `idom`
3. DFS Numbering and the Path Lemma
4. Semidominators — Definition and the Computation Theorem
5. The Dominator Theorem — Recovering `idom` from `semi`
6. The Link-Eval Forest and Path Compression
7. Complexity — `O(E·log V)` and `O(E·α(V))`
8. Correctness of the Iterative Dataflow Algorithm
9. Dominance Frontiers and SSA — Formal Treatment
10. Comparison with Alternatives
11. Worked Trace of the Lengauer-Tarjan Computation
12. Reference Implementations
13. Open Problems and Refinements
14. Summary

---

## 1. Formal Definitions

> This file develops the theory rigorously: the partial-order and chain structure that make `idom` unique, the DFS Path Lemma that lets numbers proxy "every path," the semidominator definition and its computation theorem, the Dominator Theorem that corrects `sdom` into `idom`, the link-eval/path-compression complexity, and the SSA dominance-frontier connection. Proofs follow Lengauer-Tarjan (1979) and Cytron et al. (1991); the unifying fact is Theorem 2.3 — **domination equals dominator-tree ancestry**.

Let `G = (V, E, r)` be a **flow graph**: a directed graph with a distinguished **root** (entry) `r ∈ V` such that every `v ∈ V` is reachable from `r`. (Unreachable vertices are assumed pruned; dominance is undefined for them.) A **path** `P : r ⇝ v` is a finite sequence of vertices joined by edges.

**Definition 1.1 (Dominance).** For `u, v ∈ V`, `u` **dominates** `v`, written `u ⪰ v`, iff every path `r ⇝ v` contains `u`. Write `u ≻ v` (`u` **strictly dominates** `v`) iff `u ⪰ v` and `u ≠ v`.

`⪰` is reflexive (`v ⪰ v`), transitive (if `u ⪰ w` and `w ⪰ v` then `u ⪰ v`), and antisymmetric (if `u ⪰ v` and `v ⪰ u` then `u = v`), hence a **partial order** on `V`. The root satisfies `r ⪰ v` for all `v`.

(Transitivity holds because every `r ⇝ v` path passes through `w` which in turn forces passage through `u`; antisymmetry because two mutually-dominating distinct vertices would each have to precede the other on every path, impossible.)

**Definition 1.2 (Immediate dominator).** The **immediate dominator** of `v ≠ r`, written `idom(v)`, is the unique vertex `u` with `u ≻ v` such that every `w ≻ v` satisfies `w ⪰ u`. (We prove existence and uniqueness in §2.) Equivalently, `idom(v)` is the `⪰`-greatest (closest to `v`) element of `SDom(v)`.

**Definition 1.3 (Dominator tree).** `T_D = (V, {(idom(v), v) : v ≠ r})` rooted at `r`. By Theorem 2.3, `T_D` is a tree, and `u ⪰ v` iff `u` is an ancestor of `v` in `T_D` (ancestor inclusive of `v`).

---

## 2. The Tree Structure of Dominators — Existence and Uniqueness of `idom`

**Lemma 2.1 (Strict dominators form a chain).** For any `v ≠ r`, the set `SDom(v) = {u : u ≻ v}` is totally ordered by `⪰`.

**Proof.** Let `a, b ∈ SDom(v)`; both lie on every `r ⇝ v` path. Suppose neither dominates the other. Then there is a path `P_a : r ⇝ a` avoiding `b` (else `b ⪰ a`), and a path `P_b : r ⇝ b` avoiding `a` (else `a ⪰ b`). Since `a ⪰ v`, extend `a` to `v` along some path `Q_a` (which contains `b`, as `b ⪰ v`); take the prefix of `Q_a` from `a` up to the *first* occurrence of `b`, then continue from `b` to `v` along a suffix of a path that reached `b` via `P_b`. More directly: consider walking any `r ⇝ v` path. Both `a` and `b` appear; say `a` appears before `b` on this path. Form `r ⇝ a` (prefix, avoiding `b` is not yet needed) — instead use the standard argument: take `P_b : r ⇝ b` avoiding `a`, then a path `b ⇝ v`. This composite `r ⇝ v` path reaches `v` and, on the `b ⇝ v` portion, must contain `a` (since `a ⪰ v`); but then `a` appears *after* `b`. Symmetrically, composing `P_a` then `a ⇝ v` puts `a` before `b`. Two `r ⇝ v` paths with `a, b` in opposite orders let us splice a path that reaches `v` containing *neither* `a` nor `b` past a chosen point — contradicting `a ⪰ v` or `b ⪰ v`. Hence one of `a ⪰ b`, `b ⪰ a` holds. ∎

**Corollary 2.2 (Existence and uniqueness of `idom`).** Every `v ≠ r` has a unique immediate dominator. `SDom(v)` is nonempty (it contains `r`) and, by Lemma 2.1, totally ordered, so it has a unique `⪰`-maximal-distance element — the one dominated by all others — namely `idom(v)`.

The chain structure is the crux: a *partial* order on strict dominators would admit two incomparable closest elements and no well-defined immediate dominator. Lemma 2.1 upgrades the partial order `⪰` (over all of `V`) to a *total* order *when restricted to* `SDom(v)`, and totality is exactly what guarantees a single closest dominator. This is also why the structure is a tree rather than a DAG: each vertex's strict dominators are linearly ordered, so each vertex has exactly one parent.

**Theorem 2.3 (Dominator tree).** Linking each `v ≠ r` to `idom(v)` yields a tree rooted at `r`, and `u ⪰ v` iff `u` is an ancestor of `v` in it.

**Proof.** Each `v ≠ r` has exactly one parent `idom(v)`, and `idom(v) ≻ v` so the parent is "closer to `r`" in the chain `SDom(v)`; following parents strictly ascends the finite poset and terminates at `r`, so there are no cycles — the structure is a tree. For the ancestry claim: by definition the chain `SDom(v) ∪ {v}` ordered by `⪰` is exactly `r = u_0 ≻ u_1 ≻ … ≻ u_m = v` with `u_{i+1}`'s immediate dominator `u_i`; these are precisely the ancestors of `v` in `T_D`. So `u ⪰ v ⟺ u ∈ SDom(v) ∪ {v} ⟺ u` is an ancestor of `v`. ∎

**Remark (this is not the DFS tree).** The dominator tree `T_D` is generally **distinct** from any DFS tree of `G`. In the diamond `r→a, r→b, a→c, b→c`, a DFS tree makes `a` (or `b`) the parent of `c`, but `idom(c) = r` — `c`'s dominator-tree parent jumps over the DFS parent. The two trees coincide only in degenerate cases (e.g. when `G` is itself a tree plus forward edges). Conflating them is the single most common conceptual error; the DFS tree is a *scaffold* for *computing* `T_D`, not `T_D` itself.

**Lemma 2.4 (Dominator-tree path = forced vertices).** For `v ≠ r`, the vertices on the `T_D` path from `r` to `v` are **exactly** the vertices that appear on *every* `r ⇝ v` path. 

**Proof.** By Theorem 2.3, those tree-path vertices are exactly `{u : u ⪰ v}`, and by Definition 1.1 each such `u` lies on every `r ⇝ v` path. Conversely, any vertex on every `r ⇝ v` path dominates `v` by definition, hence is an ancestor in `T_D`. ∎

This lemma is the formal content behind the "single point of failure" application: deleting any non-leaf `T_D` vertex `u` disconnects all of `u`'s `T_D`-descendants from `r`, because every path to them was forced through `u`.

---

## 3. DFS Numbering and the Path Lemma

Run DFS from `r`, assigning each vertex a **preorder number** `dfnum(v) ∈ {0, …, n-1}` (smaller = visited earlier). Let `parent(v)` be the DFS-tree parent. Write `u →* v` for "DFS-tree ancestor," and note `u →* v ⟹ dfnum(u) ≤ dfnum(v)` (but not conversely).

**Lemma 3.1 (Path Lemma).** Let `u, v ∈ V` with `dfnum(u) ≤ dfnum(v)`. Then any path `P : u ⇝ v` contains a vertex `w` that is a DFS-tree ancestor of both `u` and `v` (in particular `w = u` if `u →* v`).

**Proof.** Standard DFS theory: the vertices with `dfnum` in `[dfnum(u), dfnum(v)]` whose DFS intervals contain `dfnum(v)` form a chain of ancestors. Any path from a lower-or-equal-numbered vertex to `v` must "enter" the DFS subtree containing `v` through a common ancestor, because cross/forward/back edge structure forbids jumping into a subtree except via an ancestor's edges. The first vertex of `P` already in `v`'s ancestor chain is the required `w`. ∎

**Corollary 3.1.1 (Semidominator candidates are ancestors).** Combining the Path Lemma with Definition 4.1: a vertex `u` witnessing `sdom(v)` reaches `v` through intermediates all numbered above `v`; by the Path Lemma the witnessing path must contain a common DFS-ancestor of `u` and `v`, and minimality of `dfnum(u)` forces `u` itself to be that ancestor. Hence every semidominator candidate is a DFS-ancestor of `v` with smaller `dfnum` — the property that makes `sdom(v)` a meaningful "how high can the immediate dominator be" estimate rather than an arbitrary predecessor.

This lemma is what lets DFS numbers proxy the global "every path" condition: the semidominator below is defined entirely from `dfnum` and is computable in near-linear time, yet captures dominance structure.

**Edge classification under DFS.** With preorder `dfnum` and the interval `[dfnum(v), maxDfnum(v)]` of each vertex's subtree, every edge `(u, w)` falls into one of four classes:
- **Tree edge:** `w` was discovered via this edge (`parent(w) = u`).
- **Forward edge:** `w` is a proper descendant of `u` not reached via a tree edge — `dfnum(u) < dfnum(w)` and `w` in `u`'s subtree.
- **Back edge:** `w` is an ancestor of `u` — `dfnum(w) ≤ dfnum(u)` and `u` in `w`'s subtree. Back edges are exactly the loop-defining edges.
- **Cross edge:** neither is an ancestor of the other; necessarily `dfnum(w) < dfnum(u)` (DFS never leaves a cross edge pointing "forward" to an unrelated higher subtree).

This taxonomy is what makes the two cases in Theorem 4.3 exhaustive: a predecessor edge `(u, v)` either has `dfnum(u) < dfnum(v)` (tree/forward/back-from-above giving a direct `sdom` candidate) or `dfnum(u) > dfnum(v)` (a cross or descendant edge, handled by `EVAL`). No third case exists (`dfnum(u) = dfnum(v)` is impossible for distinct vertices, and `u = v` would be a self-loop, irrelevant to dominators).

**Subtree intervals.** Assigning each vertex `v` both `dfnum(v)` (entry time) and `maxDfnum(v)` (largest `dfnum` in its DFS subtree) gives an `O(1)` ancestor test in the *DFS* tree: `u` is a DFS-ancestor of `w` iff `dfnum(u) ≤ dfnum(w) ≤ maxDfnum(u)`. Lengauer-Tarjan uses exactly this interval reasoning when deciding whether a predecessor is "above" or "below" a vertex, and the same interval trick — applied later to the *dominator* tree (the Euler-tour `tin`/`tout` of `senior.md` §2.2) — yields `O(1)` *domination* queries. The two interval structures (DFS-tree and dominator-tree) are different and must not be confused; the first is a computation scaffold, the second the query index.

---

## 4. Semidominators — Definition and the Computation Theorem

**Definition 4.1 (Semidominator).** For `v ≠ r`,

```
sdom(v) = min{ dfnum(u) : there is a path u = v_0 → v_1 → … → v_k = v (k ≥ 1)
                          with dfnum(v_i) > dfnum(v) for all 0 < i < k }
```

(We conflate a vertex with its `dfnum` when taking `min`.) The path may be a single edge (`k = 1`, no intermediates, condition vacuous). Intuitively, `sdom(v)` is the highest-up (smallest `dfnum`) vertex reaching `v` through a "valley" of strictly higher-numbered intermediates.

**Lemma 4.2 (Semidominator bounds).** For all `v ≠ r`:
(a) `sdom(v)` is a proper DFS-tree ancestor of `v`, so `dfnum(sdom(v)) < dfnum(v)`.
(b) `idom(v) →* sdom(v) →* v` in the DFS tree, i.e. `dfnum(idom(v)) ≤ dfnom(sdom(v))`.

**Proof sketch.** (a) The witnessing path `u ⇝ v` has all intermediates above `v`; by the Path Lemma the path enters `v`'s ancestor chain, and the minimality of `dfnum(u)` forces `u` to be an ancestor of `v`. (b) Any path from `r` to `v` must reach `sdom(v)`'s level; one shows `idom(v)` cannot lie strictly between `sdom(v)` and `v` because the `sdom`-witnessing path provides a route to `v` avoiding any such intermediate, contradicting domination. The full argument is the Semidominator Lemma of Lengauer-Tarjan (1979, Lemma 4). ∎

**Theorem 4.3 (Semidominator computation).** For `v ≠ r`,

```
sdom(v) = min(  { dfnum(u) : (u, v) ∈ E and dfnum(u) < dfnum(v) }
             ∪  { sdom(EVAL(u)) : (u, v) ∈ E and dfnum(u) > dfnum(v) }  )
```

where, processing vertices in **decreasing `dfnum`**, `EVAL(u)` returns the vertex of minimum `sdom` on the DFS-tree path from `u` up to (but not including) the highest vertex already processed (the "forest root" of `u`'s current link-eval tree).

**Proof.** Consider the `sdom`-witnessing path `u = v_0 → … → v_k = v`. Look at its last edge `(v_{k-1}, v)`. Two cases on `dfnum(v_{k-1})`:
- If `dfnum(v_{k-1}) < dfnum(v)`, then `v_{k-1} = v_0 = u` (the path has no high intermediate, `k=1`), contributing `dfnum(u)` directly — the first set.
- If `dfnum(v_{k-1}) > dfnum(v)`, the prefix `v_0 → … → v_{k-1}` is itself a witness path showing some vertex reaches `v_{k-1}` through high intermediates; minimizing over these is exactly `sdom(EVAL(v_{k-1}))`, because by the time we process `v` (largest `dfnum` first), all vertices with `dfnum > dfnum(v)` are already in the forest and `EVAL` returns the minimum-`sdom` ancestor among them. The second set captures this.
Taking the `min` over all predecessors `u` of `v` and both cases gives `sdom(v)`. The decreasing-`dfnum` processing order is what guarantees the needed `sdom` values are already final when `EVAL` is called. ∎

---

## 5. The Dominator Theorem — Recovering `idom` from `semi`

`sdom` is only a lower bound on `idom` (Lemma 4.2b). The correction is the **Dominator Theorem**.

**Theorem 5.1 (Lengauer-Tarjan Dominator Theorem).** Let `v ≠ r`. Let `u` be the vertex of minimum `sdom` (by `dfnum`) on the DFS-tree path from `sdom(v)` **exclusive** down to `v` **inclusive** (formally, `u = EVAL(v)` at the moment `v` is removed from `sdom(v)`'s bucket). Then:

```
idom(v) =  sdom(v)        if sdom(u) == sdom(v)     (Rule 1)
        =  idom(u)        if sdom(u) <  sdom(v)     (Rule 2)
```

**Proof.** Let `z = sdom(v)`, an ancestor of `v` (Lemma 4.2a). Consider the DFS-tree path `z = w_0 → w_1 → … → w_t = v`. Define `u` as the `w_i` (`i ≥ 1`) minimizing `sdom(w_i)`.

*Rule 1 (`sdom(u) = sdom(v) = z`).* We claim `z` dominates `v`. Every `r ⇝ v` path must pass through `z` (one shows any path avoiding `z` would give a vertex on `z→…→v` a semidominator strictly above `z`, contradicting `sdom(u) = z` minimal on the path). Since `z = sdom(v)` is the deepest dominator forced by the semidominator structure and nothing strictly between `z` and `v` dominates `v`, `idom(v) = z`.

*Rule 2 (`sdom(u) < z`).* Here some `w_i` on the path has a semidominator strictly above `z`, so `z` does **not** dominate `v` — there is a route to `v` skirting below `z` via `u`. One proves `idom(v) = idom(u)`: any dominator of `u` dominates `v` (because all paths to `v` of the relevant form pass through `u`'s dominators), and `idom(u)` is the closest such. The equality follows by the chain structure (Lemma 2.1) and the minimality of `u`'s `sdom`. The full case analysis is Lengauer-Tarjan (1979), Theorem 4 and Corollary 1. ∎

**Why a lower bound, not equality.** Lemma 4.2(b) gives `dfnum(idom(v)) ≤ dfnum(sdom(v))` — `sdom` never sinks below `idom`, but it can sit above. The geometric picture: `sdom(v)` is the highest *single-shortcut origin* into `v` over a high-numbered valley, while `idom(v)` must dominate *all* routes, including ones that re-enter below `sdom(v)` through a sibling subtree. When such a sibling route exists, `idom(v)` is pulled down to a common dominator (an interior `u`'s `idom`), and Rule 2 detects it via the strict inequality `sdom(u) < sdom(v)`. When no such route exists, `sdom(v)` already is the closest forced vertex and Rule 1 applies. The Dominator Theorem is precisely the case split on whether such a lowering route exists, decided locally by comparing `sdom(EVAL(v))` against `sdom(v)`.

**Corollary 5.1.1 (Determinism).** Both rules and the `EVAL` minimum are deterministic given the DFS, so `idom` is uniquely determined regardless of predecessor-scan order within a vertex. Different valid DFS orders can produce different `dfnum`/`sdom` values, but the *final* `idom` array is invariant — it is a property of `G` and `r`, not of the DFS. This invariance is exactly what the differential tester (§12.3) checks across randomized DFS orders.

**Corollary 5.2 (Two-pass realization).** Process `v` in increasing `dfnum`; whenever Rule 2 tentatively set `idom(v) = u`, replace it by `idom(v) = idom(idom(v))` — valid because `idom(u)` is already final when `v` is reached. After the sweep, all `idom(v)` are correct.

**Why two passes and not a fixpoint.** Naively, one might fear that correcting `idom(v)` to `idom(u)` could cascade — what if `idom(u)` was itself deferred? It cannot, because deferrals are resolved in strictly increasing `dfnum`, and `dfnum(idom(u)) < dfnum(u) < dfnum(v)`: by the time we reach `v`, both `u` and `idom(u)` are settled. Hence a single forward sweep with one pointer redirect per deferred vertex suffices — no iteration, no worklist, no fixpoint. This linearity is what separates Lengauer-Tarjan's `idom` reconstruction from the iterative dataflow method's repeated sweeps, and it is the structural payoff of the DFS numbering: ordering by `dfnum` linearizes the dependency among deferred corrections.

The algorithm therefore computes, in one reverse-`dfnum` pass, `sdom` and the *tentative* `idom` (storing `u` for deferred cases), then in one forward pass finalizes the deferred ones via Corollary 5.2.

**Why the bucket mechanism realizes "the path from `sdom(v)` to `v`."** Theorem 5.1 needs `u = EVAL(v)` to range over exactly the DFS-tree path from `sdom(v)` (exclusive) down to `v`. The algorithm achieves this implicitly: when processing `v` we place `v` into `bucket[sdom(v)]`; we only *process* that bucket when we later reach the vertex `sdom(v)` itself (in decreasing `dfnum`, `sdom(v)` is processed after `v` because `dfnum(sdom(v)) < dfnum(v)`). At that moment, every vertex with `dfnum` strictly between `sdom(v)` and `v` has already been `LINK`ed into the forest, so `EVAL(v)` walks precisely the path from `v` up to (but not into) `sdom(v)`'s tree, returning its minimum-`sdom` vertex. This is the correspondence that makes the implementation match the theorem: **the bucket of `z` is the set of vertices whose `sdom` is `z`, processed exactly when the forest contains all vertices below `z`.**

**Idempotence of Corollary 5.2.** The forward finalize `idom(v) ← idom(idom(v))` is applied once per deferred vertex in increasing `dfnum`. Because `dfnum(idom(v)) < dfnum(v)` always (the immediate dominator is a strict, hence higher, DFS-ancestor — Lemma 4.2), the target `idom(idom(v))` is finalized *before* `v` is reached. A single replacement therefore suffices; no iteration to a fixpoint is needed. This is the structural reason Lengauer-Tarjan is two linear passes rather than an iterated relaxation.

---

## 6. The Link-Eval Forest and Path Compression

The operations `LINK` and `EVAL` maintain a forest that is a subgraph of the DFS tree, built bottom-up as vertices are processed in decreasing `dfnum`.

**Definition 6.1.** Maintain a forest with each tree rooted at a "processed boundary." For vertex `v`:
- `LINK(parent(v), v)`: add `v` to its parent's tree (set `ancestor[v] = parent(v)`).
- `EVAL(v)`: if `v` is a tree root, return `v`; else return the vertex `x` on the path from `v` to its tree root (exclusive of the root) minimizing `sdom(x)`.

**Path compression.** After `EVAL(v)`, redirect every `ancestor` pointer on the traversed path directly toward the tree root, carrying along the running minimum-`sdom` `label`. This is identical to Union-Find path compression: a vertex's `label` records the minimum-`sdom` vertex seen on its compressed path.

```
compress(v):
    if ancestor[ancestor[v]] != null:
        compress(ancestor[v])
        if sdom(label[ancestor[v]]) < sdom(label[v]):
            label[v] = label[ancestor[v]]
        ancestor[v] = ancestor[ancestor[v]]
eval(v):
    if ancestor[v] == null: return v
    compress(v)
    return label[v]
```

**Balanced linking.** The sophisticated variant additionally links by subtree **size**, attaching the smaller tree under the larger and re-rooting labels. This is what reduces the amortized bound from `O(log V)` to `O(α(V))`.

---

## 7. Complexity — `O(E·log V)` and `O(E·α(V))`

**Theorem 7.1.** Lengauer-Tarjan with path compression but unbalanced linking runs in `O(E · log V)` time. With balanced linking (union by size) it runs in `O(E · α(V))`, where `α` is the inverse Ackermann function.

**Proof.** The DFS is `O(V + E)`. Phase 2 examines each edge once (`O(E)` predecessor scans) and performs one `EVAL` per edge plus one `LINK` per vertex — `O(E)` link-eval operations total. The cost of `m` interspersed `LINK`/`EVAL` operations on `n` elements with path compression alone is `O(m · log n)` (Tarjan's analysis of compression-only union-find on tree-structured operations); with balanced linking it is `O(m · α(m, n))`. With `m = O(E)` and `n = V`:

```
T(V, E) = O(V + E) + O(E · log V)      (compression only)
        = O(V + E) + O(E · α(V))       (compression + balanced linking)
```

The bucket and finalize passes are `O(V)`. Hence the totals above. ∎

**Theorem 7.2 (Space).** `O(V + E)`: the adjacency lists plus `O(V)` integer arrays (`dfnum`, `vertex`, `parent`, `semi`, `idom`, `ancestor`, `label`) and the buckets (`O(V)` total across all vertices). No structure exceeds linear size.

**Detailed amortized accounting.** Over the whole run the forest performs exactly `n - 1` `LINK`s (one per non-root vertex when processed) and `O(m)` `EVAL`s (at most one per scanned predecessor edge plus one per bucket entry). Charge each `EVAL` its compression work; the standard union-find potential argument gives total compression work `O(k · α(k, n))` with balanced linking, or `O(k · log n)` with compression alone, for `k` operations on `n` elements. With `k = O(m)`, `n = V`:

| Variant | per-`EVAL` (amortized) | Total |
|---|---|---|
| No compression | `O(depth)` | `O(m · V)` |
| Path compression only | `O(log V)` | `O(m · log V)` |
| Compression + union by size | `O(α(V))` | `O(m · α(V))` |

The DFS, predecessor scans, bucket bookkeeping, and two finalize passes are each `O(V + E)`, so the link-eval term dominates and sets the overall bound. Note there is **no numeric payload**: every operation is an integer comparison or pointer follow, so no arithmetic-width factor hides in the analysis — a structural contrast with weighted shortest-path algorithms.

**Remark (the α(V) story).** `α(V) ≤ 4` for every `V < 2^{2^{2^{2^{16}}}}`, an astronomically large bound, so `O(E·α(V))` is "linear in practice." Lengauer-Tarjan was one of the earliest non-trivial algorithms whose complexity is governed by the inverse Ackermann function, predating much of the union-find amortized literature it now shares with.

**Linear-time refinement.** Buchsbaum, Kaplan, Rogers & Westbrook (1998, 2008) gave a genuinely `O(V + E)` dominator algorithm by replacing the link-eval bottleneck with a clever microtree/macrotree decomposition; Georgiadis, Tarjan & Werneck refined the practical constants. These remove even the `α(V)` factor but are seldom implemented because Lengauer-Tarjan and the iterative method are already fast enough.

**Where the `log V` vs `α(V)` gap comes from.** With path compression alone, a sequence of `EVAL` operations along DFS-tree paths is a special case of Tarjan's "union-find on a tree with compression," whose amortized cost per operation is `Θ(log n)` in the worst case when links are *not* balanced — a long chain repeatedly compressed costs logarithmically. Adding **union by size** (always link the smaller-rank tree below the larger) bounds the rank of any element by `log n` and triggers Tarjan's classic inverse-Ackermann analysis: `m` find/union operations on `n` elements cost `O(m·α(m, n))`. Lengauer-Tarjan's `EVAL`/`LINK` are exactly this access pattern, so the same bound transfers verbatim. The practical consequence is small — `log V` and `α(V)` differ by less than a factor of ~6 even at `V = 10⁹` — which is *why* the simple compression-only version is the one most often coded: the engineering simplicity outweighs the asymptotic improvement that balanced linking buys.

**Lower bound context.** Computing dominators requires reading every edge (an edge can change an `idom`), so `Ω(V + E)` is a trivial lower bound, and Buchsbaum et al. match it. Thus the dominator problem is *settled* asymptotically: the question is purely constants and simplicity, which is the senior engineering conversation, not a theoretical one.

**Comparison-only model.** Every operation in Lengauer-Tarjan is a `dfnum` comparison, an array index, or a pointer follow — there is no arithmetic on edge weights because dominators carry no numeric data. This places the problem firmly in the unit-cost RAM with no word-width caveats, and it is why the constant factors are so small in practice: the inner loop of the link-eval phase is branch-light integer comparison, friendlier to the branch predictor and cache than the heap operations of a Dijkstra-based method or the wide accumulations of a shortest-path relaxation.

---

## 8. Correctness of the Iterative Dataflow Algorithm

The iterative method solves the dataflow equations

```
Dom(r) = {r}
Dom(v) = {v} ∪ ⋂_{p ∈ pred(v)} Dom(p)      (v ≠ r)
```

**Theorem 8.1.** Iterating these equations from `Dom(v) = V` (for `v ≠ r`) to a fixpoint yields `Dom(v) = {u : u ⪰ v}`.

**Proof.** The equations are **monotone** over the lattice of subsets of `V` ordered by `⊇` (meet = `∩`), which has finite height `n`, so iteration converges to the **greatest fixpoint** (since we start at the top `V` and only remove elements). 

*Soundness:* one shows by induction on iteration that every computed `Dom(v)` contains all true dominators of `v` — a true dominator lies on every path so it survives every intersection. 

*Completeness:* at the fixpoint, suppose `u ∈ Dom(v)` but `u` is not a true dominator; then there is an `r ⇝ v` path avoiding `u`. Walk it; at each step the dataflow value is intersected over predecessors, and the path provides a predecessor whose `Dom` excludes `u`, so `u` would have been removed — contradiction. Hence the fixpoint equals exactly the dominator sets. The Kildall framework (1973) gives this as a standard monotone-dataflow result; Cooper-Harvey-Kennedy (2001) realize it efficiently with the `idom`-only representation and the `intersect` (two-finger NCA on RPO numbers) operation. ∎

**Lattice and termination.** The domain is `(2^V, ⊇)` with meet `∩`, top `V`, bottom `∅`; it has height `|V| = n`, so any strictly-decreasing chain has length `≤ n`. The transfer functions `f_v(X) = {v} ∪ ⋂_{p} X_p` are monotone (more input ⇒ more output under `⊇`) and the system is a standard monotone framework, so chaotic iteration converges to the greatest fixpoint in finitely many steps. Starting from `Dom = V` (top) and only ever removing elements guarantees we approach the GFP from above, which is the *correct* fixpoint here (the least fixpoint, starting from `∅`, would be wrong — it would under-approximate dominators).

**Why the greatest, not least, fixpoint.** Dominators are a *must* analysis ("`u` is on *every* path"), and must-analyses take the greatest fixpoint with meet = intersection. Initializing non-root sets to `∅` and growing would compute a *may* property instead. This is the standard must-vs-may distinction in dataflow: the lattice direction and initial value encode which one you get, and getting it backwards is a classic dataflow bug that produces plausible-but-wrong dominator sets.

**Relation to the structural definition.** Theorem 8.1's set-based `Dom(v)` and the link-eval algorithm's `idom(v)` are two computations of the *same* mathematical object (Definition 1.1). The dataflow version computes the full dominator *sets* directly; `idom(v)` is recovered as the strict dominator of maximal `|Dom|` (the deepest one), or equivalently the immediate predecessor of `v` in the chain of Lemma 2.1. Lengauer-Tarjan computes `idom` directly and reconstructs sets only on demand (a dominator-tree ancestor walk). Both satisfy Theorem 2.3, so a differential test comparing the two `idom` arrays (§12.3) is a complete correctness check: agreement on `idom` implies agreement on the entire dominance relation, since `⪰` is exactly tree ancestry.

**Convergence speed.** Processing vertices in **reverse postorder** bounds the number of sweeps by `d + 2`, where `d` is the **loop-connectedness** (max number of back edges on any cycle-free path) of the CFG. For **reducible** graphs `d` is small (often 1–3), so the iterative algorithm is effectively linear in practice — the reason it beats Lengauer-Tarjan's wall-clock on real code despite the worse `O(V·E)` worst case on irreducible inputs.

**The `intersect` operation is an NCA on RPO numbers.** Cooper-Harvey-Kennedy represent `Dom(v)` implicitly by the single value `idom[v]` and replace set-intersection with a two-finger walk:

```text
intersect(a, b):
  while a != b:
    while rpoNum[a] > rpoNum[b]: a = idom[a]   # deeper finger climbs
    while rpoNum[b] > rpoNum[a]: b = idom[b]
  return a
```

This computes the **nearest common ancestor of `a` and `b` in the partially-built dominator tree**, which is precisely `⋂ Dom` for those two predecessors. Correctness rests on the invariant that, in reverse postorder, `rpoNum` is consistent with dominator-tree depth (a dominator has a strictly smaller RPO number than what it dominates), so "climb the larger RPO number" always moves toward the root and the fingers meet at the deepest common dominator. Each `intersect` is `O(tree height)`, and across a sweep the total is `O(E · height)`; the `d + 2` sweep bound then gives the practical near-linear behavior. The whole-set lattice formulation (Theorem 8.1) and this finger-walk realization compute the same fixpoint — the latter is just an `O(V)`-space encoding of the former.

---

## 9. Dominance Frontiers and SSA — Formal Treatment

**Definition 9.1 (Dominance frontier).** `DF(u) = { w : u ⪰ pred(w) for some predecessor of w, and ¬(u ≻ w) }`. Equivalently, `w ∈ DF(u)` iff `u` dominates some predecessor of `w` but does not strictly dominate `w`.

**Definition 9.2 (Iterated dominance frontier).** `DF⁺(S)` is the least fixpoint of `DF⁺(S) = DF(S ∪ DF⁺(S))` where `DF(S) = ⋃_{u∈S} DF(u)`.

**Theorem 9.3 (Cytron et al., φ-placement).** For a variable `x` with definition set `D_x` (blocks assigning `x`), the **minimal** set of blocks needing a φ-function for `x` (under the "definitions everywhere" assumption) is exactly `DF⁺(D_x ∪ {r})`.

**Proof idea.** A φ is needed at `w` iff two distinct definitions of `x` reach `w` along different CFG paths and merge there — precisely the condition that `w` is on the dominance frontier of a defining block (the influence of one definition "ends" at `w`). Closing under iteration accounts for the φ itself being a new definition. Cytron-Ferrante-Rosen-Wegman-Zadeck (1991) prove minimality and give an `O(|E| + Σ|DF|)` algorithm. ∎

This is the formal bridge from the dominator tree to SSA: **`idom` → `DF` → `DF⁺` → φ sites → dominator-tree-preorder renaming**, all near-linear.

**Minimality and the "definitions everywhere" assumption.** Theorem 9.3's minimality is conditional: it places the fewest φ-functions assuming every block that needs a name *might* define the variable (the standard SSA-construction model). With **liveness pruning**, φs whose result is dead are removed, giving *pruned* SSA — still correct, fewer φs, but requiring a liveness pass. The iterated-frontier characterization is what makes φ-placement a *closed-form* set rather than an iterative search: you compute `DF⁺` once and place exactly those φs, instead of repeatedly inserting and re-checking.

**Complexity of φ-placement.** Computing all dominance frontiers is `O(|V| + Σ_u |DF(u)|)`, and `Σ |DF(u)|` is `O(E)` for reducible graphs but can be `Θ(V²)` for adversarial irreducible ones (a known worst case). The iterated frontier `DF⁺(D_x)` is computed by a worklist that touches each frontier edge a bounded number of times, so total φ-placement across all variables is near-linear in the IR size for typical programs — the reason SSA construction is considered "free" in practice despite the quadratic worst case.

### 9.1 Dominance frontier via the dominator tree (CFRWZ formulation)

The bottom-up CFRWZ computation expresses `DF(u)` as a union of a **local** and an **up** component:

```text
DF(u) = DF_local(u) ∪ ⋃_{c child of u in dom tree} DF_up(u, c)

DF_local(u) = { w ∈ succ(u) : idom(w) ≠ u }            # CFG successors u doesn't strictly dominate
DF_up(u, c) = { w ∈ DF(c) : idom(w) ≠ u }              # frontier of a child that u doesn't dominate
```

Processing the dominator tree bottom-up, each node's frontier is assembled from its CFG successors plus the "escaped" frontiers of its dominator-tree children. This formulation makes the `O(Σ|DF|)` bound transparent: every frontier element is added a constant number of times. The Cooper-Harvey-Kennedy edge-walk (used in `tasks.md` Task 8) computes the same sets more simply but with the `O(E · height)` cost; the two agree, and the choice is again simplicity vs guaranteed bound.

---

## 10. Comparison with Alternatives

| Method | Time | Handles irreducible | Output | Notes |
|--------|------|---------------------|--------|-------|
| Iterative dataflow (CHK) | `O(V·E)` worst, ~`O(E·d)` reducible | yes | `idom` | Tiny constant; default in LLVM-era compilers. |
| Lengauer-Tarjan (simple) | `O(E·log V)` | yes | `idom` | Path compression only. |
| Lengauer-Tarjan (sophisticated) | `O(E·α(V))` | yes | `idom` | Balanced linking; near-linear. |
| Semi-NCA (Georgiadis) | `O(E·α(V))`-ish, fast in practice | yes | `idom` | Hybrid; LLVM uses it. |
| Buchsbaum et al. | `O(V + E)` | yes | `idom` | Truly linear; rarely implemented. |
| Bitset `Dom` sets | `O(V·E / w)` | yes | full `Dom` | When you need full dominator *sets*. |
| Semi-NCA (Georgiadis-Tarjan-Werneck) | `O(E·α(V))`, fast constants | yes | `idom` | LLVM's choice; simpler than LT. |
| Allen-Cocke interval analysis | `O(V·E)` | reducible only | `idom` | Historical; fails on irreducible CFGs. |

For dense small CFGs all near-linear methods are sub-millisecond; the choice is **worst-case guarantee vs implementation simplicity** (see `senior.md` §6).

### 10.1 Semi-NCA — the modern hybrid

The Semi-NCA algorithm (Georgiadis, in his thesis and with Tarjan/Werneck) is what LLVM ships. It computes `sdom` exactly as Lengauer-Tarjan does (DFS numbering + link-eval), but instead of the bucket-and-two-rules `idom` reconstruction, it derives `idom` directly via a **nearest-common-ancestor** computation on a *partial* dominator tree built in DFS-number order. The result is simpler to implement than full Lengauer-Tarjan (no buckets, no deferred-rule bookkeeping), empirically faster on real CFGs (better constants and cache behavior), and still `O(E·α(V))`-class. Its existence is the practical resolution of the "asymptotics vs constants" tension: rather than choosing between the slow-but-simple iterative method and the fast-but-intricate Lengauer-Tarjan, Semi-NCA captures most of both — which is why it displaced classic Lengauer-Tarjan in production compilers.

### 10.2 What "irreducible" costs each method

A graph is **reducible** iff every retreating edge (target already on the DFS stack) is a back edge (target dominates source); equivalently, it has no "multiple-entry loop." Structured source (no arbitrary `goto`) produces reducible CFGs. On reducible graphs the iterative method's sweep count `d + 2` is tiny, so it is near-linear; Lengauer-Tarjan/Semi-NCA are near-linear unconditionally. On **irreducible** graphs (machine-generated code, decompiled binaries, some coroutine lowerings), the iterative method's `d` can grow large, pushing toward its `O(V·E)` worst case, while Lengauer-Tarjan/Semi-NCA retain `O(E·α(V))`. This is the precise technical reason a static-analysis tool over arbitrary binaries prefers Lengauer-Tarjan, and a frontend for a structured language can safely use the iterative method.

---

## 11. Worked Trace of the Lengauer-Tarjan Computation

Take the flow graph (entry `r = 0`): `0→1, 0→2, 1→3, 2→3, 3→4, 3→5, 4→5`.

**DFS from 0**, taking lower-numbered successors first, yields `dfnum`:

```
vertex:  0  1  2  3  4  5
dfnum:   0  1  5  2  3  4
parent:  -  0  0  1  3  4
```

(DFS path: `0→1→3→4→5`, backtrack, then `0→2`. So `dfnum`: 0,1,3,4,5 along the spine and 2 gets number 5.) For clarity relabel by `dfnum` order `vertex[]`: `vertex[0]=0, vertex[1]=1, vertex[2]=3, vertex[3]=4, vertex[4]=5, vertex[5]=2`.

**Phase 2 — compute `sdom` in decreasing `dfnum`** (process `vertex[5], …, vertex[1]`):

- **`w = 2` (dfnum 5):** predecessor `0` (dfnum 0 < 5) → candidate `0`. `sdom(2) = 0`. Bucket[0] += 2. LINK(0, 2).
- **`w = 5` (dfnum 4):** predecessors `3` (dfnum 2 < 4) → candidate `3`; `4` (dfnum 3 < 4) → candidate `4`. `min` by dfnum → `3` (dfnum 2). `sdom(5) = 3`. Bucket[3] += 5. LINK(4, 5). Process bucket of parent(5)=4: empty.
- **`w = 4` (dfnum 3):** predecessor `3` (dfnum 2 < 3) → candidate `3`. `sdom(4) = 3`. Bucket[3] += 4. LINK(3, 4). Process bucket of parent(4)=3: empty.
- **`w = 3` (dfnum 2):** predecessors `1` (dfnum 1 < 2) → candidate `1`; `2` (dfnum 5 > 2) → `sdom(EVAL(2))`. `EVAL(2)` returns `2` (its `sdom = 0`). Candidate `dfnum 0`. `min(1, 0) → 0`. `sdom(3) = 0`. Bucket[0] += 3. LINK(1, 3). Process bucket of parent(3)=1: empty.
- **`w = 1` (dfnum 1):** predecessor `0` (dfnum 0 < 1) → candidate `0`. `sdom(1) = 0`. Bucket[0] += 1. LINK(0, 1). Process bucket of parent(1)=0 — but we process buckets when we reach the *semidominator* vertex. At the end, process bucket[0] = {2, 3, 1}: for each `v`, `u = EVAL(v)`; set tentative idom.

**Bucket processing for sdom = 0** (vertices 1, 2, 3): each `EVAL` returns a vertex whose `sdom` is `0`, so by Rule 1, `idom(1) = idom(2) = idom(3) = 0`.

**Bucket for sdom = 3** (vertices 4, 5): `EVAL(4)` and `EVAL(5)` — for `4`, `sdom(EVAL(4)) = sdom(4) = 3 = sdom(4)` → Rule 1, `idom(4) = 3`. For `5`, `EVAL(5)` returns the min-`sdom` vertex on its path; `sdom = 3 = sdom(5)` → Rule 1, `idom(5) = 3`.

**Phase 4 — finalize:** no deferrals here (all Rule 1), so the `idom` array is already final:

```
idom(0)=0  idom(1)=0  idom(2)=0  idom(3)=0  idom(4)=3  idom(5)=3
```

matching the by-definition analysis in `junior.md`. The semidominator of `3` jumping to `0` (because predecessor `2`'s `EVAL` carried `sdom=0` up over the high-numbered detour) is exactly the mechanism that produced the *flat* dominator tree — no per-path enumeration required. The conceptual heart, worth restating: Lengauer-Tarjan never enumerates paths (which would be exponential); it computes one *number* per vertex (`sdom`) from purely local edge and DFS-number comparisons, and the Dominator Theorem certifies that those local numbers reconstruct the global "unavoidable on every path" relation exactly. The DFS numbering is the bridge that turns a global property into a locally computable one — the same idea that makes Tarjan's SCC and bridge algorithms work from lowlink numbers.

### 11.1 When deferral (Rule 2) actually fires

The diamond resolves entirely by Rule 1, so it does not exercise the correction. Rule 2 fires precisely when an **interior vertex** of the DFS path from `sdom(v)` down to `v` has a strictly smaller `sdom` than `v` — meaning `sdom(v)` *overshoots* and the true `idom(v)` lies below it, at `idom(u)` for that interior witness `u`. The canonical minimal example (Lengauer-Tarjan 1979, Fig. 1) has a vertex whose `sdom` points at the root but whose `idom` is a mid-tree vertex reached only through a deeper `EVAL` minimum. In such a graph, Phase 3 stores the tentative `idom(v) = u` (the `EVAL` witness), and Phase 4 — sweeping in increasing `dfnum` — replaces it with `idom(u)`, which is already final because `dfnum(idom(u)) < dfnum(u) ≤ dfnum(v)`. The single replacement (no iteration) is the idempotence guarantee of §5: every deferral is a one-shot pointer redirect to an already-settled dominator. This is what lets the entire algorithm be two linear passes rather than an iterated relaxation — and it is the part most reimplementations get subtly wrong, which is why the differential tester of §12.3 (and `tasks.md` Task 11) is non-optional for a production Lengauer-Tarjan.

---

## 12. Reference Implementations

Code order: Go, Java, Python. (The full simple Lengauer-Tarjan in three languages is in `middle.md`; here we give the **idom→postdom reuse** and the **iterative-dataflow oracle** used to verify correctness.)

A practical note on the three implementations: the full simple Lengauer-Tarjan appears in `middle.md` and `interview.md` Challenge 1; the *sophisticated* (balanced-linking) variant is a `tasks.md` exercise (Task 12). The two snippets below are the pieces a professional implementation adds beyond the core: **post-dominator reuse** (so you never fork a second algorithm) and **differential verification** (so you catch the bug-prone deferral logic). Code order is Go, Java, Python.

**Verification is the load-bearing practice.** The single most valuable thing a professional implementation ships is the differential tester: by Corollary 5.1.1 the `idom` array is DFS-order-invariant, and by Theorem 2.3 it determines the entire dominance relation, so agreement between a fast implementation and the trivial iterative oracle across thousands of randomized small CFGs *certifies* the fast path. Most real Lengauer-Tarjan bugs live in the deferral/finalize logic (§5) or in path compression, and they surface only on specific irreducible or deeply-nested shapes that hand-written unit tests miss but random generation hits.

### 12.1 Go — post-dominators by reversing the graph

```go
package main

import "fmt"

// postDominators computes idom on the reversed graph with `exit` as root.
// Reuses any dominator routine `dom(n, succ, root) []int`.
func postDominators(n int, succ [][]int, exit int,
	dom func(int, [][]int, int) []int) []int {
	rev := make([][]int, n)
	for u := 0; u < n; u++ {
		for _, v := range succ[u] {
			rev[v] = append(rev[v], u) // reverse every edge
		}
	}
	return dom(n, rev, exit) // post-dominators = dominators of the reverse graph
}

func main() {
	// single-exit CFG; exit = 5
	succ := [][]int{{1, 2}, {3}, {3}, {4, 5}, {5}, {}}
	pd := postDominators(6, succ, 5, iterativeDom)
	fmt.Println(pd) // post-idom array (exit-rooted)
}

// iterativeDom: the simple O(V·E) oracle (see middle.md for the full body).
func iterativeDom(n int, succ [][]int, r int) []int {
	// ... reverse-postorder iterative dataflow (omitted; identical to junior.md) ...
	return nil
}
```

### 12.2 Java — debug verifier (fast result vs O(V·E) oracle)

```java
public final class DomVerify {
    // assertEqual confirms a fast idom matches the trivial oracle on the same graph.
    static boolean verify(int[] fastIdom, int[] oracleIdom) {
        if (fastIdom.length != oracleIdom.length) return false;
        for (int v = 0; v < fastIdom.length; v++)
            if (fastIdom[v] != oracleIdom[v]) {
                System.err.println("MISMATCH at " + v + ": fast=" + fastIdom[v]
                                   + " oracle=" + oracleIdom[v]);
                return false;
            }
        return true;
    }
    // In CI: run both algorithms on thousands of random CFGs and assert verify(...).
}
```

### 12.3 Python — random-CFG differential tester

```python
import random


def brute_force_idom(n, succ, r):
    """O(exponential-ish) oracle for tiny graphs: idom by enumerating dominators
    via reachability-after-removal. Correct by definition; use only for small n."""
    def reachable(blocked):
        seen, stack = {r} - {blocked}, [r] if r != blocked else []
        seen = set()
        if r != blocked:
            seen.add(r); stack = [r]
        else:
            stack = []
        while stack:
            u = stack.pop()
            for v in succ[u]:
                if v != blocked and v not in seen:
                    seen.add(v); stack.append(v)
        return seen

    full = reachable(blocked=-1)
    dom = {v: set() for v in full}
    for v in full:
        for u in full:
            if v not in reachable(blocked=u):  # removing u disconnects v -> u dominates v
                dom[v].add(u)
        dom[v].add(v)
    idom = [-1] * n
    idom[r] = r
    for v in full:
        if v == r:
            continue
        strict = dom[v] - {v}
        # idom = the strict dominator dominated by all others (max by |dom|)
        idom[v] = max(strict, key=lambda u: len(dom[u]))
    return idom


def random_cfg(n):
    succ = [[] for _ in range(n)]
    for v in range(1, n):
        succ[random.randint(0, v - 1)].append(v)  # ensure reachability via spanning tree
    for _ in range(n):
        u, v = random.randint(0, n - 1), random.randint(1, n - 1)
        if v not in succ[u]:
            succ[u].append(v)
    return succ


if __name__ == "__main__":
    # Differential test: compare Lengauer-Tarjan (from middle.md) against the oracle.
    for _ in range(1000):
        n = random.randint(2, 8)
        succ = random_cfg(n)
        oracle = brute_force_idom(n, succ, 0)
        # from middle.md: LengauerTarjan(n, succ).run(0) -> compare to `oracle`
        # assert lt == oracle
    print("differential tests defined (wire in your LT implementation)")
```

---

## 13. Open Problems and Refinements

The static dominator problem is asymptotically closed (linear-time algorithms exist matching the trivial lower bound), so the open questions are about *dynamic* maintenance, *simpler* linear algorithms, and *new applications* — not about beating a lower bound.

1. **Truly linear without microtrees in practice.** Buchsbaum et al. achieve `O(V+E)`, but the constants and complexity keep Lengauer-Tarjan/Semi-NCA as the practical choice. Whether a *simple* linear-time dominator algorithm exists is more an engineering than a theoretical question.

2. **Fully dynamic dominators.** Maintaining the dominator tree under arbitrary edge insertions *and* deletions with good worst-case bounds remains active research. Incremental (insertions-only) algorithms are well understood; the decremental and fully-dynamic cases are harder, with bounds still being improved.

3. **2-vertex/2-edge connectivity via dominators.** Italiano, Georgiadis, and others use dominator trees (on `G` and its reverse) to compute strong-bridge and strong-articulation points and 2-connectivity in directed graphs in linear time — a non-compiler frontier where dominators are the key tool. The reduction: in a strongly connected `G`, a vertex `v` is a strong articulation point iff `v` is a non-trivial dominator (has a child in the dominator tree) in the tree rooted at some `s` *or* in the tree of the reverse graph rooted at `s`. This turns a "remove each vertex and re-test strong connectivity" `O(V(V+E))` computation into two linear dominator builds — the same machinery reused on `G` and `G^R`.

4. **Low-high orders and independent spanning trees.** The dominator tree underlies the construction of two independent spanning trees and "low-high" orders used in reliability and certifying algorithms.

5. **Parallel/GPU dominators.** Work-efficient parallel dominator computation (for very large generated CFGs or graph-analytics workloads) is less mature than parallel BFS/SCC; the inherently sequential reverse-`dfnum` dependency is the obstacle, mirroring the layer dependency in other DFS-numbered algorithms. The iterative dataflow formulation *is* naturally data-parallel (relax all vertices each sweep), which is why GPU/SIMD dominator implementations for graph analytics favor it over Lengauer-Tarjan despite the worse asymptotic sweep bound — parallelism beats the constant factor at scale.

6. **Certifying dominators.** A *certifying* algorithm outputs, alongside `idom`, a witness that lets a checker verify correctness in linear time without re-running the algorithm. For dominators, the witness is a pair of independent spanning trees (derived from the dominator tree's "low-high" order); the checker confirms the trees are vertex-disjoint paths, certifying domination. This matters for high-assurance compilers (e.g. CompCert-style verified toolchains) where the dominator computation itself need not be proven correct if its output is independently checked.

7. **Dominators in graph databases and dataflow systems.** Beyond compilers, "what is unavoidable from a single source" appears in provenance tracking, build-dependency analysis, and network reliability at scale; efficient *batched* and *distributed* dominator computation over very large graphs is an active engineering frontier, distinct from the per-function compiler setting.

### 13.1 The fine-grained-complexity placement

Unlike all-pairs shortest paths — which sits in a subcubic-equivalence class with an open `n^{3-o(1)}` conjecture — the dominator problem is **asymptotically closed**: it is solvable in `O(V + E)` (Buchsbaum et al.), matching the trivial `Ω(V + E)` read-every-edge lower bound. There is no open asymptotic question for static dominators. The live research is entirely in (a) **dynamic** maintenance (insertions/deletions with sublinear update), (b) **simplicity** (a clean linear algorithm without microtree machinery), and (c) **applications** (directed 2-connectivity, independent spanning trees, reliability). This is a useful contrast for a candidate to draw: not every classical problem has a famous open lower-bound question; some, like dominators, are theoretically settled and remain interesting purely for constants and uses.

---

## 14. Summary

The dominator tree turns a global "every path passes through" relation into a local, near-linearly-computable tree structure. The theory below is what certifies that the fast algorithm computes the right thing.

- **Definitions.** `u ⪰ v` iff every `r ⇝ v` path contains `u`; `idom(v)` is the unique closest strict dominator; `idom` edges form the **dominator tree**, and `⪰` equals tree ancestry (Theorem 2.3).
- **Structure.** Strict dominators form a chain (Lemma 2.1), giving existence and uniqueness of `idom` (Corollary 2.2).
- **Semidominators.** `sdom(v)`, defined from `dfnum` (Definition 4.1), is a computable lower bound on `idom` (Lemma 4.2) and obeys the predecessor/`EVAL` recurrence (Theorem 4.3).
- **Dominator Theorem.** `idom` is recovered from `sdom` by the two-rule correction (Theorem 5.1) plus a forward finalize pass (Corollary 5.2).
- **Complexity.** Link-eval with path compression gives `O(E·log V)`; balanced linking gives `O(E·α(V))` (Theorem 7.1), `O(V+E)` space (Theorem 7.2). Buchsbaum et al. reach truly linear.
- **Iterative dataflow.** The monotone-dataflow fixpoint is correct (Theorem 8.1) and converges in `d+2` reverse-postorder sweeps, near-linear on reducible CFGs.
- **SSA.** φ-placement is the iterated dominance frontier `DF⁺(D_x ∪ {r})` (Theorem 9.3) — the formal compiler payoff of the dominator tree.
- **Not the DFS tree.** The dominator tree is distinct from any DFS tree (Remark after Theorem 2.3); the DFS is a scaffold for computation, and `idom(v)` routinely jumps over the DFS parent.
- **Must-analysis fixpoint.** The iterative method computes the *greatest* fixpoint with meet = intersection from the top `V`; the lattice direction encodes "every path" (must), and reversing it silently computes the wrong (may) property.

- **No path enumeration.** The algorithm computes one number (`sdom`) per vertex from local comparisons; the Dominator Theorem certifies these reconstruct the global relation exactly — DFS numbering is the bridge.
- **Settled asymptotics.** Unlike APSP, dominators are theoretically closed: `Θ(V + E)` is achievable (Buchsbaum et al.) and matches the trivial lower bound. Open work is in dynamic maintenance, simplicity, and applications — not lower bounds.
- **Verification.** Because `⪰` equals dominator-tree ancestry (Theorem 2.3), differential-testing the `idom` array against the iterative oracle across randomized DFS orders is a *complete* correctness check (Corollary 5.1.1) — essential given how bug-prone the deferral logic is.
- **Two passes, no fixpoint.** Lengauer-Tarjan's `idom` reconstruction is exactly two linear passes (reverse-`dfnum` to compute `sdom` and tentative `idom`, forward-`dfnum` to finalize deferrals with one redirect each), because `dfnum` linearizes the dependency among corrections (Corollary 5.2) — the structural contrast with the iterative method's repeated sweeps.

Prosser (1959) introduced dominators; Lengauer-Tarjan (1979) gave the near-linear algorithm and its theorems; Cooper-Harvey-Kennedy (2001) the practical iterative method; Cytron et al. (1991) the SSA/dominance-frontier connection; Buchsbaum et al. (1998/2008) the linear-time refinement; Georgiadis-Tarjan(-Werneck) the Semi-NCA hybrid that LLVM ships; and Italiano et al. the modern directed-connectivity applications. The algorithm is over forty years old, rests on the inverse Ackermann function, and remains the backbone of program analysis.
