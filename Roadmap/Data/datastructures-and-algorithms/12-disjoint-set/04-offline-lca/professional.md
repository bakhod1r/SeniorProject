# Offline LCA — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness Proof — the DSU Ancestor Invariant
3. Complexity `O((N + Q)·α(N))`
4. Comparison of LCA Methods (asymptotics)
5. Reduction LCA ↔ RMQ and Cartesian Trees
6. Cache and Memory Behavior
7. Average vs Worst Case
8. Space–Time Trade-offs: Offline Batch vs Online Preprocessing
9. Comparison (consolidated)
10. Open Problems and Advanced Directions
11. Summary

---

## 1. Formal Definition

Let `T = (V, E)` be a tree rooted at `r ∈ V`, with `|V| = N`. For `u ∈ V`, write `parent(u)` for its parent (`parent(r)` undefined) and `depth(u)` for the number of edges from `r` to `u`, so `depth(r) = 0`.

**Definition 1.1 (Ancestor).** `a` is an *ancestor* of `u`, written `a ⪰ u`, iff `a` lies on the unique path from `r` to `u`. Ancestry is reflexive: `u ⪰ u`. The set of ancestors of `u` is a chain `r = a₀ ⪰ a₁ ⪰ … ⪰ a_{depth(u)} = u`.

**Definition 1.2 (Lowest Common Ancestor).** For `u, v ∈ V`,
```text
LCA(u, v) = the unique node w such that w ⪰ u, w ⪰ v, and depth(w) is maximal.
```
Existence and uniqueness: the ancestor sets `A(u)` and `A(v)` are chains both containing `r`, so `A(u) ∩ A(v)` is a non-empty chain, and a finite chain has a unique deepest element.

**Definition 1.3 (Offline LCA problem).** Given `T`, `r`, and a set `Q = {(u₁,v₁), …, (u_m, v_m)}` of `m` pairs known *in advance*, output `LCA(u_i, v_i)` for every `i`. Answers may be produced in any order provided they are matched back to their indices.

**Definition 1.4 (Tarjan's algorithm).** Maintain a DSU over `V` (each `find` returns a set representative), an array `ancestor[·]` indexed by representatives, and a boolean `visited[·]`. Execute the post-order DFS:

```text
TARJAN(u):
  MAKE-SET(u)                       # u in its own set
  ancestor[FIND(u)] := u
  for each child c of u:
    TARJAN(c)
    UNION(u, c)                     # merge c's finished subtree into u
    ancestor[FIND(u)] := u          # u still owns the merged set
  visited[u] := true
  for each query (u, w) ∈ Q:
    if visited[w]:
      output LCA(u, w) := ancestor[FIND(w)]
```

Each query is registered on *both* endpoints, so the pair `(u, w)` appears in `u`'s list and in `w`'s list; the `if visited[w]` guard ensures it is answered exactly once, when the second endpoint is processed.

We call a node **white** before `TARJAN` is entered on it, **gray** while it is on the recursion stack (entered, not yet finished), and **black** after `visited[u] := true`.

---

## 2. Correctness Proof — the DSU Ancestor Invariant

We prove that whenever the algorithm outputs `ancestor[FIND(w)]` for a query `(u, w)`, the value equals `LCA(u, w)`.

### 2.1 Structure of the gray set

**Lemma 2.1 (Gray path).** At any point during the DFS, the gray nodes form exactly the path from `r` to the node `g*` currently being processed (the deepest gray node). Equivalently, if `x` and `y` are both gray then one is an ancestor of the other.

*Proof.* The DFS recursion stack is, by definition, the sequence of currently-open calls `TARJAN(r) → TARJAN(g₁) → … → TARJAN(g*)`, and `TARJAN(c)` is only called from within `TARJAN(parent(c))`. Hence consecutive stack entries are parent–child, so the stack is a root-to-`g*` path. ∎

### 2.2 The invariant

For a non-white node `x`, define `lga(x)` = the **deepest gray ancestor of `x`** (which exists: `x` itself is gray if `x` is gray, otherwise some proper ancestor is gray — at minimum `r` is gray until the whole DFS ends).

**Theorem 2.2 (Ancestor invariant).** At every point during the DFS, for every non-white node `x`:
```text
ancestor[ FIND(x) ] = lga(x).
```
Moreover, two non-white nodes `x, y` satisfy `FIND(x) = FIND(y)` iff `lga(x) = lga(y)`; that is, the DSU sets are exactly the equivalence classes "share the same deepest gray ancestor."

*Proof.* We argue that the invariant is preserved by every state-changing operation of the algorithm: `MAKE-SET` + entry assignment, the post-`UNION` assignment, and the transition of a node from gray to black (which happens at `visited[u] := true`, with no DSU change but a change of `lga` for `u`'s subtree — handled by the subsequent union at the parent). We track the invariant across the lifecycle of a call `TARJAN(u)`.

**(a) Entry to `TARJAN(u)`.** `u` becomes gray and `MAKE-SET(u)` puts `u` in a singleton set; we set `ancestor[FIND(u)] = u`. Now `lga(u) = u` (since `u` is gray and is its own deepest ancestor), so the invariant holds for `u`. No other node's set or `lga` changed: entering `u` does not change the gray-ancestor of any node outside `{u}` (their deepest gray ancestor is unaffected because `u` is a *new* deepest gray node only for `u`'s own future subtree, which is still white). ✔

**(b) After `TARJAN(c)` returns and before `UNION(u, c)`.** By the inductive hypothesis applied to the recursive call, the invariant held throughout `TARJAN(c)`. When `TARJAN(c)` returns, `c` is black. Every node `y` in `c`'s subtree was, during `TARJAN(c)`, in a set with `ancestor = ` some gray descendant-or-equal of `c`. Now that `c` and its subtree are black, the deepest gray ancestor of each such `y` is `u` (because `c` is no longer gray, and `u` is the deepest gray node that is an ancestor of `y`, by Lemma 2.1). So the invariant momentarily *fails*: the DSU still has `c`'s subtree split into possibly several sets pointing at nodes inside `c`'s subtree, but their true `lga` is now `u`. The next two operations repair this.

**(c) `UNION(u, c)` then `ancestor[FIND(u)] = u`.** Crucially, an entire finished subtree is collapsed into a *single* DSU set across the recursion: when `TARJAN(c)` finishes, all of `c`'s descendants have already been unioned together within `c`'s subtree (by the same post-order unions one level down), so by the time control returns to `u`, `FIND(c)` represents the whole subtree of `c`. We `UNION(u, c)`, merging it with `u`'s current set (which holds `u` and any earlier-finished children's subtrees). After the union the merged set has a single representative `ρ = FIND(u) = FIND(c)`; we set `ancestor[ρ] = u`. Now *every* node in the merged set has deepest gray ancestor `u`: nodes in `u`'s prior set already had `lga = u`, and nodes in `c`'s subtree now have `lga = u` by part (b). So `ancestor[FIND(x)] = u = lga(x)` for all `x` in the merged set, and disjoint sets (other subtrees, not-yet-entered nodes) are untouched. The invariant is restored. ✔

**(d) `visited[u] := true` and query resolution.** Marking `u` black changes `lga` only for nodes whose deepest gray ancestor *was* `u` — but at this instant `u` has finished all children, so the only such node is `u` itself, and `u` will be unioned into `parent(u)` immediately after this call returns (step (c) one level up), which re-establishes the invariant for `u`. No DSU change occurs at the mark, so the invariant continues to hold for all already-merged sets. ✔

By induction over the DFS call tree, the invariant holds at every point. The set-equivalence claim follows because `ancestor[FIND(x)]` is a *function* of the representative and equals `lga(x)`; two nodes share a representative iff they were merged, which by the above happens iff they share the same deepest gray ancestor. ∎

### 2.3 Query answers are correct

**Theorem 2.3.** When the algorithm outputs `ancestor[FIND(w)]` for query `(u, w)`, the output equals `LCA(u, w)`.

*Proof.* The output line runs inside `TARJAN(u)` after `visited[u] := true` but before `TARJAN(u)` returns — so `u` is still gray and is the deepest gray node (we are at the bottom of the current call). The guard `visited[w] = true` means `w` is black. By Theorem 2.2, `ancestor[FIND(w)] = lga(w)`, the deepest gray ancestor of `w`. Let `g = lga(w)`. We show `g = LCA(u, w)`:

- `g ⪰ w`: `g` is an ancestor of `w` by definition of `lga`.
- `g ⪰ u`: `g` is gray, hence on the root-to-`u` gray path (Lemma 2.1), hence an ancestor of `u`.
- *Maximal depth among common ancestors.* Let `c = LCA(u, w)`. Then `c ⪰ u` and `c ⪰ w`. Since `c ⪰ u` and `u` is gray, `c` is on the root-to-`u` path; is `c` gray? Every node on the root-to-`u` path is currently gray (Lemma 2.1), so yes, `c` is gray. Thus `c` is a *gray ancestor of `w`*, so `depth(c) ≤ depth(g)` because `g` is the *deepest* gray ancestor of `w`. Conversely `g` is a common ancestor of `u` and `w`, so `depth(g) ≤ depth(c)` because `c = LCA` is the deepest common ancestor. Hence `depth(g) = depth(c)`, and as both lie on the same root-to-`w` chain, `g = c`.

Therefore `ancestor[FIND(w)] = g = LCA(u, w)`. ∎

The symmetric argument covers the case where the roles of `u` and `w` are swapped (i.e. `w` finishes after `u`), because the query is stored on both endpoints and answered when the *second* endpoint is visited.

---

## 3. Complexity `O((N + Q)·α(N))`

We count DSU operations and DFS work, then apply the Tarjan–van Leeuwen DSU bound.

**DFS skeleton.** Each node is entered once and finished once; each edge is traversed once. This is `Θ(N)` excluding DSU calls.

**MAKE-SET.** `N` calls — one per node at entry. Each `O(1)`.

**UNION.** Exactly `N − 1` calls: every non-root node is unioned into its parent exactly once, in the parent's loop after the child finishes. (No node is unioned twice; the post-order guarantees each child contributes one union.)

**FIND.** Sources of `find`:
- `ancestor[FIND(u)] = u` at entry: `N` finds.
- `ancestor[FIND(u)] = u` after each union: `N − 1` finds.
- Inside each `UNION`: `O(1)` finds.
- Query resolution `ancestor[FIND(w)]`: each query is resolved once (its second endpoint), one find — but each query is *scanned* on both endpoints; the scan is `O(1)` per occurrence, and there are `2m` occurrences for `m` queries. So `Θ(N + Q)` finds total (counting the `2Q` query-list scans, of which `Q` perform a `find`).

**Theorem 3.1 (DSU bound; Tarjan 1975, Tarjan–van Leeuwen 1984).** With **path compression** and **union by rank (or size)**, any sequence of `f` `find`s interspersed with `n` `make-set`/`union` operations runs in `O((f + n)·α(n))` time, where `α` is the inverse Ackermann function. The bound is tight in the worst case for this class of separable pointer algorithms.

Applying it with `n = N` make-sets/unions and `f = Θ(N + Q)` finds:
```text
Total = Θ(N)                       [DFS skeleton]
      + O((N + Q)·α(N))            [DSU operations]
      = O((N + Q)·α(N)).           ∎
```

Since `α(N) ≤ 4` for every `N < 2^{2^{2^{2^{16}}}}` (astronomically larger than any physical input), the algorithm is *near-linear* and, for practical purposes, indistinguishable from `O(N + Q)`.

**Remark (weaker DSU heuristics).** Path compression *alone* gives `O((N+Q) log N)` worst case; union by rank *alone* gives `O((N+Q) log N)`. Only the combination yields `α`. The correctness proof of §2 does **not** depend on which DSU heuristic is used — only the time bound does — so a sloppy DSU produces correct answers, just slower.

---

## 4. Comparison of LCA Methods (asymptotics)

| Method | Preprocessing | Per query | Online | Space | Notes |
|--------|---------------|-----------|--------|-------|-------|
| Naive climb (equalize depths) | `O(N)` (depths) | `O(N)` | Yes | `O(N)` | Trivial; only for tiny inputs. |
| **Tarjan offline (this topic)** | — | `α(N)` amortized | **No** | `O(N + Q)` | Whole batch; near-linear total. |
| Binary lifting | `O(N log N)` | `O(log N)` | Yes | `O(N log N)` | Gives `k`-th ancestor too. |
| Euler tour + sparse table RMQ | `O(N log N)` | `O(1)` | Yes | `O(N log N)` | RMQ over depths of the Euler array. |
| Euler tour + **Farach-Colton–Bender** RMQ | `O(N)` | `O(1)` | Yes | `O(N)` | The `±1`-RMQ trick exploits that adjacent Euler depths differ by `±1`; blockwise sparse table + precomputed block patterns. |
| Heavy-Light Decomposition | `O(N)` | `O(log N)` | Yes | `O(N)` | Generalizes to path aggregates/updates with a segment tree (`O(log² N)`). |
| Link-Cut Trees | `O(N)` | `O(log N)` amortized | Yes | `O(N)` | Supports a *dynamic* (changing) forest. |

Two methods achieve the asymptotic optimum of `⟨O(N), O(1)⟩` for the *online* problem: Euler+FCB and (offline) Tarjan's amortized-`α` total which is `O(N+Q)` overall. Tarjan trades the ability to answer online for the simplest near-linear *batch* solution and the smallest memory footprint.

---

## 5. Reduction LCA ↔ RMQ and Cartesian Trees

LCA and Range Minimum Query (RMQ) are **linearly equivalent**: each reduces to the other in `O(N)` time.

### 5.1 LCA → RMQ (Euler tour)

Perform a DFS recording the **Euler tour** `eulerNode[0..2N−2]` (each node appended on entry and after each child returns) and `eulerDepth[i] = depth(eulerNode[i])`. For each node `x` let `first[x]` be any index where `x` appears. Then
```text
LCA(u, v) = eulerNode[ argmin_{ i ∈ [first[u], first[v]] } eulerDepth[i] ].
```
The Euler depth array has the **`±1` property**: consecutive entries differ by exactly `±1`. This special structure is what Farach-Colton & Bender (2000) exploit to get `⟨O(N), O(1)⟩` RMQ (block decomposition into `(½ log N)`-sized blocks, a sparse table over block minima, and a precomputed table over all `O(√N)` block *shapes*).

### 5.2 RMQ → LCA (Cartesian tree)

Given an array `a[0..N−1]`, its **Cartesian tree** is the binary tree whose in-order traversal yields the original index order and which is a min-heap on values (parent value ≤ child values). It is built in `O(N)` with a stack. Then
```text
RMQ(i, j) = position of the minimum in a[i..j] = LCA( node_i, node_j )
```
in the Cartesian tree. Consequently a **batch** of RMQ queries can be answered by building the Cartesian tree (`O(N)`) and running Tarjan offline LCA (`O((N+Q)α(N))`) — a fully offline `O(N+Q)`-ish RMQ.

### 5.3 Consequence

Because of this equivalence, an `O(N)`-build, `O(1)`-query online LCA exists (Euler+FCB), and symmetrically an `O(N)`-build, `O(1)`-query RMQ exists. Tarjan's offline method is the *batch* corner of the same design space.

---

## 6. Cache and Memory Behavior

The kernel touches three families of memory:

1. **Adjacency** — read sequentially in DFS order if children are stored contiguously; near-optimal streaming.
2. **DSU arrays** (`parent`, `rank`, `ancestor`) — *random* access driven by `find`. This is the cache-unfriendly part. Path compression flattens trees so later `find`s touch fewer cells, improving locality over time.
3. **Query buckets** — accessed at each node's post-visit; locality depends on how nodes are ordered.

**Layout optimization.** Relabel nodes by **DFS-entry order** (Euler index). Then a subtree is a contiguous index range, so the DSU's `parent[child] = parent_id` writes and the `ancestor` reads cluster, and query buckets for nearby nodes share cache lines. Empirically this can cut runtime 1.5–2× on large trees versus arbitrary labeling.

**Memory total.** `parent, rank, ancestor, visited` ≈ 4 words/node; query buckets ≈ 2 records/query. So `Θ(N + Q)` words — the smallest among all LCA methods (binary lifting and sparse-table both pay `Θ(N log N)`).

---

## 7. Average vs Worst Case

The DSU bound `α(N)` is amortized and is the *worst case* for the operation sequence class; there is no separate "average case" speedup to leading order — the inverse-Ackermann factor is already effectively constant.

What *does* vary with the input:

- **Tree height** governs stack depth (recursion or explicit). Random trees have `Θ(√N)` expected height (random recursive tree / Cayley-style models give `Θ(log N)` for some models, `Θ(√N)` for others); adversarial path trees have height `N`. The *time* bound is unaffected (still `O((N+Q)α(N))`), but stack *space* swings from `O(log N)` to `O(N)`.
- **Query distribution** affects only constant factors via cache behavior, not the asymptotic bound.
- **`find` path lengths** shrink as path compression accumulates; the first finds in a run are the most expensive, later ones near-`O(1)`.

So Tarjan is unusually robust: its time complexity is the *same* near-linear bound on best, average, and worst inputs; only stack space is input-sensitive.

---

## 8. Space–Time Trade-offs: Offline Batch vs Online Preprocessing

Let `m = |Q|`. Total cost models:

- **Tarjan offline:** `Θ((N + m)·α(N))` time, `Θ(N + m)` space, but **all `m` queries must be present before any answer**.
- **Online structure (binary lifting):** `Θ(N log N)` build + `Θ(m log N)` queries, `Θ(N log N)` space, answers available as queries arrive.
- **Online structure (Euler+FCB):** `Θ(N)` build + `Θ(m)` queries, `Θ(N)` space, online.

The crossover analysis:

- If `m = Θ(N)` (queries scale with the tree) and the batch is available, Tarjan's `Θ(N·α(N))` beats binary lifting's `Θ(N log N)` and ties Euler+FCB's `Θ(N)` while using *less* memory than either of the `log N`-space methods.
- If queries **stream over time**, Tarjan is disqualified regardless of asymptotics — its offline requirement is binding. Pay the one-time build of an online structure.
- If you will run **many batches** against the *same static tree*, amortize an online build once (`Θ(N)` with FCB) and answer each batch in `Θ(m)`; re-running Tarjan repays the `Θ(N)` DFS each time.

Thus the trade-off is governed by (i) availability of the full batch and (ii) the number of query batches per tree, far more than by the `α(N)` vs `log N` vs `O(1)` distinction.

---

## 9. Comparison (consolidated)

| Criterion | Tarjan offline | Binary lifting | Euler + FCB | HLD | Link-cut |
|-----------|----------------|----------------|-------------|-----|----------|
| Total for one batch of `m≈N` | `Θ(N α(N))` | `Θ(N log N)` | `Θ(N)` | `Θ(N log N)` | `Θ(N log N)` |
| Per-query (online) | n/a | `O(log N)` | `O(1)` | `O(log N)` | `O(log N)` am. |
| Memory | `Θ(N+Q)` (least) | `Θ(N log N)` | `Θ(N)` | `Θ(N)` | `Θ(N)` |
| Online | No | Yes | Yes | Yes | Yes |
| Dynamic tree | No | No | No | partial | **Yes** |
| Path aggregates/updates | No | No | No | **Yes** | **Yes** |
| Implementation effort | Lowest (reuses DSU) | Low–medium | High (FCB blocks) | High | Highest |

---

## 10. Open Problems and Advanced Directions

1. **Dynamic LCA.** Maintaining LCA under edge insertions/deletions and node additions is solved by **link-cut trees** (Sleator–Tarjan 1983) in `O(log N)` amortized, and by Euler-tour trees for some operations. Tight worst-case bounds for fully-dynamic LCA with the smallest constants remain an engineering target.

2. **Offline LCA with updates.** Mixing topology updates *and* a known query batch (an offline dynamic setting) can sometimes beat the fully-online link-cut bound via divide-and-conquer on the timeline (offline incremental DSU "small-to-large on time"), but a clean general result is open.

3. **Cache-oblivious / external-memory offline LCA.** While Euler+FCB is cache-aware, an optimal cache-oblivious *offline* LCA matching the sorting-style `O((N/B) log_{M/B}(N/B))` I/O bound for arbitrary query ordering is not fully pinned down.

4. **Parallel offline LCA.** A single tree's DFS is inherently sequential along the gray path; work-efficient parallel LCA (e.g. via Euler-tour + parallel RMQ, or tree contraction à la Miller–Reif) achieves `O(log N)` depth and `O(N + Q)` work, but a *DSU-based* parallel Tarjan with comparable bounds and small constants is not standard.

5. **Lower bounds.** In the cell-probe / pointer-machine models, LCA (equivalently RMQ) has matching `Ω(N)`-build, `Ω(1)`-query lower bounds for the static online problem; the offline batch problem's complexity is `Θ(N + Q)` up to the unavoidable `α` from the separable-pointer DSU lower bound (Tarjan 1979, Fredman–Saks 1989 for the cell-probe inverse-Ackermann lower bound on Union-Find).

---

## 11. Summary

- **Definition.** `LCA(u,v)` is the deepest common ancestor; offline LCA answers a known batch of pairs.
- **Algorithm.** A post-order DFS that `UNION`s each child's finished subtree into its parent and answers a query when its second endpoint is visited, reading `ancestor[FIND(other)]`.
- **Correctness** rests on one invariant: every non-white node sits in the DSU set owned by its **deepest gray (still-open) ancestor**; when one endpoint is gray-and-deepest and the other is black, that owner is exactly the LCA (Theorems 2.2–2.3).
- **Complexity** is `O((N+Q)·α(N))` — `N` make-sets, `N−1` unions, `Θ(N+Q)` finds under the Tarjan–van Leeuwen DSU bound — near-linear and effectively `O(N+Q)`.
- **Equivalence.** LCA ↔ RMQ via Euler tour (the `±1` array enabling Farach-Colton–Bender `⟨O(N),O(1)⟩`) and via Cartesian trees; offline RMQ batches reduce to Tarjan.
- **Trade-off.** Tarjan is the smallest-memory near-linear *batch* method; it loses to online structures only because it cannot answer queries that arrive over time. The deciding factor is offline availability and batches-per-tree, not the `α` vs `log N` vs `O(1)` gap.
- **Frontier.** Dynamic LCA (link-cut trees), offline-with-updates, parallel/cache-oblivious variants, and the cell-probe lower bounds that make the `α` factor genuinely unavoidable for Union-Find-based approaches.

References: Tarjan (1979) *Applications of Path Compression on Balanced Trees*, JACM; Tarjan & van Leeuwen (1984) *Worst-case Analysis of Set Union Algorithms*, JACM; Bender & Farach-Colton (2000) *The LCA Problem Revisited*, LATIN; Gabow & Tarjan (1985) linear-time special-case Union-Find; Sleator & Tarjan (1983) *Self-adjusting Binary Search Trees / link-cut trees*; CLRS Ch. 21 (Disjoint Sets).
