# Lowest Common Ancestor — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness of Binary Lifting (the 2^k-ancestor decomposition)
3. The LCA ⟺ RMQ Equivalence (both directions)
4. Farach-Colton–Bender: O(N) Build / O(1) Query
5. Complexity Table with Proofs
6. Cache Behavior
7. Average-Case Analysis
8. Space–Time Trade-offs
9. Comparison with Alternatives
10. Open Problems (dynamic LCA, link-cut trees)
11. Summary

---

## 1. Formal Definition

Let `T = (V, E)` be a tree on `N = |V|` vertices, rooted at a distinguished vertex `r ∈ V`. The rooting induces a unique parent function `par : V \ {r} → V` and a strict partial order `≺` ("proper ancestor of"): `a ≺ v` iff `a` lies on the unique simple path from `r` to `v` and `a ≠ v`. Write `a ⪯ v` for `a ≺ v ∨ a = v`.

**Definition 1.1 (Depth).** `depth(r) = 0` and `depth(v) = depth(par(v)) + 1`. Equivalently, `depth(v)` is the number of edges on the `r`–`v` path.

**Definition 1.2 (Common ancestor).** `w` is a common ancestor of `u, v` iff `w ⪯ u` and `w ⪯ v`. The set `CA(u, v) = { w : w ⪯ u ∧ w ⪯ v }` is non-empty (it contains `r`).

**Definition 1.3 (LCA).** `LCA(u, v)` is the unique `w ∈ CA(u, v)` of maximum depth.

**Proposition 1.4 (Existence and uniqueness).** `LCA(u, v)` exists and is unique.

*Proof.* The set `A(v) = { w : w ⪯ v }` is precisely the vertices on the `r`–`v` path, which is **totally ordered** by `⪯` (each is the parent of the next). Hence `CA(u, v) = A(u) ∩ A(v)` is an intersection of two chains in the ancestor order and is itself a chain (a prefix of both, from `r` downward). A finite non-empty chain has a unique maximum-depth element. ∎

**Proposition 1.5 (Path-bend characterization).** The unique simple path between `u` and `v` is `u ⤳ LCA(u,v) ⤳ v`, and `LCA(u,v)` is its unique vertex of minimum depth. Consequently

```
dist(u, v) = depth(u) + depth(v) − 2 · depth(LCA(u, v)).
```

*Proof.* Let `ℓ = LCA(u,v)`. Since `ℓ ⪯ u` and `ℓ ⪯ v`, the `ℓ`–`u` and `ℓ`–`v` paths are vertex-disjoint except at `ℓ` (if they shared a deeper vertex `w`, then `w ⪯ u, w ⪯ v`, contradicting maximality of `ℓ`). Their concatenation is therefore a simple `u`–`v` path; by uniqueness of paths in a tree it is *the* path. Its minimum-depth vertex is `ℓ`, and its length is `(depth(u) − depth(ℓ)) + (depth(v) − depth(ℓ))`. ∎

---

## 2. Correctness of Binary Lifting

Binary lifting precomputes the **iterated-parent** function. Define `par^0 = id` on the extended function with `par(r) := r` (idempotent sentinel), and `par^{m}(v) = par(par^{m-1}(v))`.

**Definition 2.1 (Lifting table).** `up[k][v] = par^{2^k}(v)` for `0 ≤ k < ⌈log₂ N⌉`.

**Lemma 2.2 (Doubling recurrence).** `up[k][v] = up[k−1][ up[k−1][v] ]` for `k ≥ 1`.

*Proof.* `par^{2^k} = par^{2^{k-1}} ∘ par^{2^{k-1}}` because `2^k = 2^{k-1} + 2^{k-1}` and function iteration adds exponents: `par^{a+b} = par^a ∘ par^b`. The sentinel `par(r) = r` makes `par^m(r) = r` for all `m`, so the identity holds even past the root. ∎

**Lemma 2.3 (Binary decomposition of a climb).** For any `0 ≤ d ≤ depth(v)`, writing `d = Σ_{k ∈ S} 2^k` (binary representation, `S ⊆ {0,…,⌈log₂N⌉−1}`), the composition `∘_{k ∈ S} par^{2^k}` applied to `v` equals `par^d(v)`, the ancestor of `v` at depth `depth(v) − d`. The order of composition is irrelevant since all the maps are powers of the same function `par` and therefore commute.

*Proof.* `Σ_{k∈S} 2^k = d` and `par^{a} ∘ par^{b} = par^{a+b}`. ∎

**Theorem 2.4 (Query correctness).** The lift-then-climb procedure returns `LCA(u, v)`.

*Proof.* WLOG `depth(u) ≥ depth(v)`. Step 1 replaces `u` by `par^{depth(u)−depth(v)}(u)`, its ancestor at depth `depth(v)`; call it `u'`. By Prop. 1.5, `LCA(u,v) = LCA(u',v)` because lifting `u` to the LCA's depth or above never changes the common-ancestor set's maximum as long as we stop at depth `depth(v) ≥ depth(LCA)`.

If `u' = v`, then `v ⪯ u`, so `LCA = v = u'`; return it.

Otherwise `u' ≠ v` and both have depth `depth(v) > depth(LCA)`. Maintain the **invariant** that after processing bit `k`, both current nodes are strict descendants of `LCA` at equal depth. For `k` from `⌈log₂N⌉−1` down to `0`: if `up[k][u'] ≠ up[k][v]`, the `2^k`-ancestors are distinct, hence both lie strictly below `LCA` (a common ancestor would force equality), so jumping both by `2^k` preserves the invariant; if they are equal, that common `2^k`-ancestor is `⪰ LCA`, so jumping would violate the invariant and we skip it. After the loop, no further bit can be taken without making them equal, i.e. both are at depth `depth(LCA) + 1` — they are the two distinct children of `LCA` on the `u` and `v` branches. Therefore `up[0][u'] = par(u') = LCA`. ∎

**Complexity.** Build fills `⌈log₂N⌉` rows of `N` entries each via Lemma 2.2: `Θ(N log N)` time and space. Each query does one `O(log N)` lift plus an `O(log N)` climb: `Θ(log N)`.

---

## 3. The LCA ⟺ RMQ Equivalence

The Range Minimum Query problem: preprocess an array `A[0..m−1]` to answer `RMQ(i, j) = argmin_{i ≤ t ≤ j} A[t]`.

### 3.1 LCA ⟶ ±1 RMQ (via the Euler tour)

Perform a DFS, appending the current vertex to a sequence `E` on entry and after returning from each child. `E` has length `2N − 1`. Let `D[i] = depth(E[i])` and `first[v] = min { i : E[i] = v }`.

**Theorem 3.1.** For `u ≠ v`, `LCA(u, v) = E[ argmin_{ first[u] ≤ t ≤ first[v] } D[t] ]` (assuming `first[u] ≤ first[v]`).

*Proof.* Between positions `first[u]` and `first[v]` the Euler walk goes from `u` to `v`. Any vertex `w` appearing in this range satisfies `LCA(u,v) ⪯ w` is *not* required; rather, the walk stays within the subtree rooted at `LCA(u,v)` (it cannot exit that subtree without passing through `LCA(u,v)`, which would require leaving via its parent edge — impossible between two of its descendants without first visiting `LCA(u,v)` itself). Thus every vertex in the range is a descendant of `LCA(u,v)`, so has depth `≥ depth(LCA(u,v))`, and `LCA(u,v)` itself appears in the range (the walk from `u` to `v` must pass through it). Hence the minimum depth in the range is `depth(LCA(u,v))`, attained at `LCA(u,v)`. ∎

**The ±1 property.** Consecutive Euler entries are parent–child or child–parent, so `|D[i+1] − D[i]| = 1`. This restricted RMQ ("±1 RMQ" or "RMB", Range Min with ±1 steps) is what enables the linear-time method in §4.

### 3.2 RMQ ⟶ LCA (via the Cartesian tree)

**Definition 3.2 (Cartesian tree).** Given `A[0..m−1]` with distinct values (break ties by index), the Cartesian tree is the binary tree whose root is `argmin A`, with left subtree the Cartesian tree of the elements before the minimum and right subtree that of the elements after.

**Theorem 3.3.** `RMQ(i, j)` on `A` equals the index `LCA(i, j)` in the Cartesian tree of `A` (treating array positions as node ids).

*Proof.* In the Cartesian tree, the subtree of a node spans a contiguous index range, and a node's value is the minimum of its subtree's range. For positions `i, j`, their LCA `w` is the shallowest node whose subtree-range contains both, i.e. the smallest range `[lo, hi] ⊇ {i, j}` that is itself a subtree — which is exactly the range whose minimum lies between `i` and `j`. The root of that subtree carries the minimum value, so its index is `argmin_{i..j} A`. ∎

The Cartesian tree is built in `O(m)` by a left-to-right scan maintaining the right spine on a stack. Combined with §3.1 this shows LCA and RMQ are **linearly equivalent**: an `O(f(N))/O(g(N))` solution for one yields the same bounds for the other up to `O(N)` additive build.

---

## 4. Farach-Colton–Bender: O(N) Build / O(1) Query

Bender & Farach-Colton, *The LCA Problem Revisited* (LATIN 2000), give a method with `O(N)` preprocessing and `O(1)` query, optimal in both. The reduction chain is: **LCA → ±1 RMQ → block decomposition**.

### 4.1 Setup

From §3.1, reduce LCA on `T` to ±1 RMQ on `D[0..m−1]`, `m = 2N − 1`, where `|D[i+1] − D[i]| = 1`.

### 4.2 Block decomposition

Partition `D` into blocks of size `b = ½ log₂ m`. There are `⌈m / b⌉ = O(m / log m)` blocks.

**Top level.** Let `B[j]` be the minimum value of block `j` (and remember its position). Build a sparse table over `B`: `O((m/log m) · log(m/log m)) = O(m)` space and time, answering any *block-aligned* range min in `O(1)`.

**Bottom level (the trick).** A query range `[i, j]` overlaps at most two partial end blocks plus a span of whole blocks. The whole-block span is handled by the top sparse table. The two partial blocks need *in-block* RMQ. There are only `2^{b−1} = 2^{(½ log m) − 1} = O(√m)` distinct **±1 difference patterns** of a block (each block is determined up to an additive constant by its `b−1` ±1 steps). Precompute, for each of the `O(√m)` patterns and each of the `O(b²)` sub-ranges, the in-block argmin: total `O(√m · b² ) = O(√m · log² m) = o(m)` space and time.

### 4.3 Query

For `RMQ(i, j)`:
1. If `i, j` are in the same block, look up the block's pattern table: `O(1)`.
2. Otherwise: in-block suffix-min of `i`'s block, in-block prefix-min of `j`'s block (pattern tables), and the whole-block span between them (top sparse table). Combine three `O(1)` values: `O(1)`.

**Theorem 4.1.** Farach-Colton–Bender answers LCA in `O(1)` after `O(N)` preprocessing using `O(N)` space.

*Proof sketch.* Euler tour and Cartesian-tree-free reduction are `O(N)`. The top sparse table is `O((m/b) log(m/b)) = O(m)` since `b = Θ(log m)` cancels the log. The bottom tables are `o(m)` by the `O(√m)` distinct-pattern bound. Each query combines `O(1)` table lookups. ∎

The `O(√m)`-pattern observation is the crux: because consecutive depths differ by exactly ±1, a length-`b` block is fully described by `b−1` sign bits, so there are only `2^{b−1} = O(√m)` block shapes to tabulate — sub-linear, hence "free."

---

## 5. Complexity Table with Proofs

| Method | Build | Query | Space | Key proof |
| --- | --- | --- | --- | --- |
| Naive equalize+climb | `O(N)` (one DFS) | `O(H)` ≤ `O(N)` | `O(N)` | `H` = height; climb is one parent step per level. |
| Binary lifting | `Θ(N log N)` | `Θ(log N)` | `Θ(N log N)` | Thm 2.4; `log N` rows, `log N` jumps. |
| Euler + sparse RMQ | `Θ(N log N)` | `Θ(1)` | `Θ(N log N)` | Thm 3.1 + sparse-table `O(1)` overlap query. |
| Euler + ±1 RMQ (FCB) | `Θ(N)` | `Θ(1)` | `Θ(N)` | Thm 4.1; `O(√m)` block patterns. |
| Tarjan offline (union-find) | `Θ((N+Q) α(N))` | amortized `Θ(α(N))` | `Θ(N+Q)` | union-find with path compression + union by rank. |
| Heavy-light decomposition | `Θ(N)` | `Θ(log N)` | `Θ(N)` | any path splits into `O(log N)` chains. |

**Sparse-table `O(1)` overlap.** For idempotent operators (min, max, gcd), `RMQ(i,j) = min( sparse[k][i], sparse[k][j − 2^k + 1] )` with `k = ⌊log₂(j − i + 1)⌋`; the two ranges of length `2^k` cover `[i,j]` with overlap, and idempotence makes double-counting harmless — hence one comparison, `O(1)`.

**Lower bound.** Any LCA structure needs `Ω(N)` space to store the tree and `Ω(1)` query; FCB matches both. Under the cell-probe / pointer-machine models, `O(N)`/`O(1)` is optimal, so FCB is asymptotically the end of the line for the static problem.

---

## 6. Cache Behavior

- **Binary lifting** query performs up to `2 log N` reads of `up[k][·]`, each into a different row → up to `2 log N` cache misses for large `N` (rows are `N` apart in memory). This is the dominant real-world cost and the reason FCB / Euler+RMQ are faster per query despite identical asymptotics.
- **Euler + sparse table** query is two reads into one sparse-table level plus a `first[]` lookup — `O(1)` misses, very cache-friendly. The build, however, touches `Θ(N log N)` memory.
- **FCB** query touches a couple of small precomputed tables that fit in L1/L2 for realistic `N`, plus one top-table read — excellent locality.
- **Layout trick:** transpose binary lifting to `up[v][k]` (node-major) when queries on a node access several `k` for the same `v`; this packs a node's jump pointers into one cache line and helps the lift phase.

For `N ≲ 10^5` everything fits in L2/L3 and the asymptotically slower binary lifting is often the *fastest in wall-clock* because of its tiny constant and simple code.

---

## 7. Average-Case Analysis

The naive equalize+climb costs `O(H)` where `H` is tree height. For a **uniformly random labeled tree** (Cayley model) the expected height is `Θ(√N)`; for a **random recursive tree** or a **random binary search tree** it is `Θ(log N)`. So the naive method is `Θ(log N)` *expected* on balanced-ish random trees but `Θ(N)` worst case (a path).

For binary lifting and Euler+RMQ the cost is input-independent: `Θ(log N)` and `Θ(1)` respectively, regardless of tree shape. There is no average-case improvement to extract — the work is the same on a path and on a star. The only data-dependent variation is **cache behavior**: deep trees produce longer climbs in the naive method and worse locality.

For **query distributions**, if queries are dominated by ancestor–descendant pairs (one node above the other), binary lifting frequently exits early after the lift step (`u == v`), giving an effective `O(1)`-ish average. Skewed query locality also improves cache hit rates across the `up[][]` rows.

---

## 8. Space–Time Trade-offs

| Want | Pay | Structure |
| --- | --- | --- |
| Minimal space, simple code | `O(N)` query | naive parent pointers + `depth` |
| `O(log N)` query, flexible (k-th anc., path agg.) | `O(N log N)` space | binary lifting |
| `O(1)` query, static | `O(N log N)` space | Euler + sparse table |
| `O(1)` query **and** `O(N)` space | high constant, complex | Farach-Colton–Bender |
| `O(α)` query, all queries known | no online support | Tarjan offline |
| dynamic tree | `O(log N)` amortized | link-cut tree |

Binary lifting's `O(N log N)` space is its main weakness; FCB removes the `log N` factor at the cost of implementation complexity and worse practical constants for small `N`. The **sweet spot for production** is binary lifting (simplicity + flexibility) unless query volume or memory pressure forces the `O(1)`/`O(N)` regime.

A hybrid: store only `tin`/`tout` (`2N` ints) for `O(1)` **ancestor tests**, and fall back to binary lifting only for full LCA — common in algorithms (e.g., auxiliary trees) that need many ancestor tests but few LCAs.

---

## 9. Comparison with Alternatives

| Structure | Build | Query | Space | Online | Dynamic | Path aggregates |
| --- | --- | --- | --- | --- | --- | --- |
| Naive | `O(N)` | `O(H)` | `O(N)` | yes | no | no |
| Binary lifting | `O(N log N)` | `O(log N)` | `O(N log N)` | yes | no | yes (extend table) |
| Euler + sparse RMQ | `O(N log N)` | `O(1)` | `O(N log N)` | yes | no | no |
| FCB (±1 RMQ) | `O(N)` | `O(1)` | `O(N)` | yes | no | no |
| Tarjan offline | `O((N+Q)α)` | `O(α)` amort. | `O(N+Q)` | **no** | no | no |
| HLD + seg tree | `O(N)` | `O(log N)` (LCA) / `O(log² N)` (path query) | `O(N)` | yes | **yes** | **yes, updatable** |
| Link-cut tree | `O(N)` | `O(log N)` amort. | `O(N)` | yes | **yes** | yes |
| Euler tour tree | `O(N)` | `O(log N)` | `O(N)` | yes | **yes (connectivity)** | with augmentation |

The decision tree: *static, read static aggregates* → binary lifting / FCB; *static, updatable path aggregates* → HLD; *fully dynamic forest* → link-cut tree; *batch, plain LCA* → Tarjan offline.

---

## 10. Open Problems and Research Directions

1. **Fully dynamic LCA with optimal bounds.** Link-cut trees (Sleator–Tarjan 1983) and Euler-tour trees give `O(log N)` amortized LCA under edge insert/delete and re-root. Whether `O(1)` worst-case query is achievable under polylog updates in the pointer-machine model remains open; known structures trade query time for update time.

2. **Dynamic LCA under leaf insertions only.** Cole & Hariharan (2005) and later work give nearly-constant amortized LCA when the tree only grows at the leaves (incremental forests), relevant to suffix-tree construction. Tight worst-case bounds for richer update sets are not settled.

3. **Succinct LCA.** Sadakane (2002) and Navarro–Sadakane give LCA in `O(1)` using `2N + o(N)` bits (succinct, near information-theoretic minimum) via balanced-parenthesis representations and range-min-max trees. Closing the lower-order `o(N)` terms and matching practical speed to FCB is ongoing.

4. **Parallel / external-memory LCA.** Optimal work-depth parallel LCA and cache-oblivious LCA (matching the sorting/permuting I/O bound) have known constructions; whether the constants can be made competitive with sequential FCB on real hardware is largely empirical and open.

5. **LCA on DAGs.** Generalizing LCA to directed acyclic graphs (where a node may have multiple "lowest" common ancestors) is harder; all-pairs LCA on a DAG relates to Boolean matrix multiplication, with the best bounds `O(N^ω)` (`ω` the matrix-multiplication exponent) and improvements an active area.

---

## 11. Summary

- **Definition.** `LCA(u,v)` is the unique maximum-depth common ancestor; it exists and is unique because ancestor sets are chains (Prop. 1.4), and it characterizes tree distance (Prop. 1.5).
- **Binary lifting** is correct because iterated parents compose (`par^{a+b} = par^a ∘ par^b`), so any climb decomposes into power-of-two jumps; the high-to-low climb keeps both nodes strictly below the LCA until they reach its children (Thm 2.4). Build `Θ(N log N)`, query `Θ(log N)`.
- **LCA and RMQ are linearly equivalent**: LCA reduces to ±1 RMQ via the Euler tour (Thm 3.1), and RMQ reduces to LCA via the Cartesian tree (Thm 3.3).
- **Farach-Colton–Bender** exploits the ±1 structure: blocks of size `½ log m` have only `O(√m)` distinct patterns, making in-block tables sub-linear and giving optimal `O(N)`/`O(1)` (Thm 4.1).
- **Cache** behavior, not asymptotics, decides the winner for moderate `N`: binary lifting's simple code often beats FCB below `~10^5` despite more cache misses per query.
- **Trade-offs** span naive `O(N)`-query/`O(N)`-space up to FCB `O(1)`-query/`O(N)`-space; dynamic trees need link-cut trees, batch queries favor Tarjan offline, and updatable path aggregates favor HLD.
- Bender–Farach-Colton (2000) settled the static problem optimally; the open frontier is dynamic, succinct, parallel, and DAG generalizations.
