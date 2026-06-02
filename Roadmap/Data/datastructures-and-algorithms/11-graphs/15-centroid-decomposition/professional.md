# Centroid Decomposition — Professional Level

> **One-line summary:** A rigorous treatment of the centroid: existence and the `≤ N/2` bound (Jordan), the `O(log N)` centroid-tree height as a direct consequence of strict halving, the path-decomposition theorem (every `u–v` path crosses the centroid-tree LCA of `u, v` exactly once), and the `O(N log N)` build bound from the fact that each vertex appears in `O(log N)` levels.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [Existence and the ≤ N/2 Property](#2-existence-and-the--n2-property)
3. [O(log N) Centroid-Tree Depth](#3-olog-n-centroid-tree-depth)
4. [The Path-Decomposition Theorem](#4-the-path-decomposition-theorem)
5. [Build Complexity O(N log N)](#5-build-complexity-on-log-n)
6. [Cache Behavior](#6-cache-behavior)
7. [Average-Case](#7-average-case)
8. [Space-Time Trade-offs](#8-space-time-trade-offs)
9. [Comparison](#9-comparison)
10. [Open Problems](#10-open-problems)
11. [Summary](#11-summary)

---

## 1. Formal Definition

Let `T = (V, E)` be a tree with `|V| = N`. For a vertex `v`, removing `v` yields a forest `T − v` whose components we denote `C₁(v), …, C_{deg(v)}(v)`.

**Definition (centroid).** A vertex `c ∈ V` is a **centroid** of `T` if
```
max_i |Cᵢ(c)|  ≤  ⌊N / 2⌋.
```
Equivalently, define the *weight* `w(v) = max_i |Cᵢ(v)|`. A centroid is a vertex minimizing `w`. (The classical statement uses `⌊N/2⌋`; some texts use `N/2` with real division — they coincide because component sizes are integers and the bound is tight only when `N` is even.)

**Definition (centroid decomposition).** Recursively: let `c` be a centroid of `T`. The centroid tree `CT(T)` is the tree rooted at `c` whose subtrees are `CT(C₁(c)), …, CT(C_k(c))`, with each child centroid linked to `c` as its parent.

**Definition (centroid level).** `level(v)` is the depth of `v` in `CT(T)` (root at depth 0). Equivalently, the number of decomposition steps before `v` itself becomes a centroid.

We root `T` arbitrarily to compute subtree sizes; the centroid notion is *root-independent* (it depends only on `T`, not on the chosen root).

---

## 2. Existence and the ≤ N/2 Property

**Theorem 1 (Jordan, 1869).** Every tree `T` with `N ≥ 1` vertices has at least one centroid, and at most two. If two centroids exist, they are adjacent.

**Proof of existence and the bound.** Root `T` at an arbitrary vertex `r` and compute subtree sizes `s(v)`. Start at `r` and repeatedly move to the child `u` whose subtree is *strictly* largest **whenever** `s(u) > ⌊N/2⌋`. We claim this process halts at a centroid.

Consider the vertex `c` where it halts: every child `u` of `c` has `s(u) ≤ ⌊N/2⌋`. The component of `T − c` going "upward" (toward the root) has size `N − s(c)`. We must show `N − s(c) ≤ ⌊N/2⌋`.

The process moved into `c` because, at `c`'s parent `p`, the subtree `s(c) > ⌊N/2⌋` (that is the only reason we descended into `c`). Hence `s(c) > ⌊N/2⌋ ≥ N/2`, so `N − s(c) < N/2 ≤ ⌊N/2⌋ + 1`, giving `N − s(c) ≤ ⌊N/2⌋`. Combined with every child component `≤ ⌊N/2⌋`, *all* components of `T − c` are `≤ ⌊N/2⌋`. Thus `c` is a centroid. ∎

**Proof of "at most two, and adjacent."** Suppose `c₁` and `c₂` are both centroids. Orient the edge between adjacent vertices toward the larger side. For any vertex `v`, the unique edge incident to `v` lying on the path toward the *heavy* side points "down" the weight gradient. A centroid is a local minimum of `w`. One shows `w` is "unimodal" along any path: it strictly decreases toward a centroid and strictly increases away from it. Two distinct local minima of a unimodal function on a path tree can only be adjacent (where the function value ties). If `N` is odd there is a unique centroid; if `N` is even there may be two adjacent centroids, each leaving one component of exactly `N/2` on the side of the other. A full unimodality argument: for adjacent `u, v`, `w(u) − w(v)` changes sign by exactly the edge orientation, so at most one adjacent pair can tie at the minimum. ∎

**Corollary.** The centroid leaves *every* component with `≤ ⌊N/2⌋` vertices — this halving is what drives all subsequent complexity bounds.

---

## 3. O(log N) Centroid-Tree Depth

**Theorem 2.** The height of `CT(T)` is at most `⌊log₂ N⌋ + 1`, i.e. `O(log N)`.

**Proof.** Let `v` be any vertex and let `N₀ > N₁ > … > N_{L}` be the sizes of the nested sequence of components that contain `v` at successive decomposition levels, where `N₀ = N` and `v` becomes a centroid at level `L` (so `N_L = 1` at the moment `v` is chosen, or `v` is in the size-1 residual). By Theorem 1's bound, at each step the component containing `v` is one of the `≤ ⌊Nᵢ/2⌋` pieces, hence
```
N_{i+1} ≤ ⌊Nᵢ / 2⌋ ≤ Nᵢ / 2.
```
Therefore `N_i ≤ N / 2ⁱ`. Since `N_L ≥ 1`, we need `N / 2^L ≥ 1`, i.e. `L ≤ log₂ N`. Counting the root level, `level(v) = L ≤ ⌊log₂ N⌋`, and the height is `≤ ⌊log₂ N⌋ + 1`. ∎

**Corollary (per-vertex level membership).** Each vertex belongs to exactly `level(v) + 1 ≤ ⌊log₂ N⌋ + 1 = O(log N)` centroid components — one per level it survives. This is the quantity that bounds total work.

---

## 4. The Path-Decomposition Theorem

This is the structural theorem that makes centroid decomposition *useful*.

**Theorem 3 (Path–LCA).** For any two vertices `u, v ∈ V`, let `c = LCA_{CT}(u, v)` be their lowest common ancestor in the centroid tree. Then:

1. `c` lies on the unique tree path `P(u, v)` in `T`.
2. `c` is the **unique** vertex on `P(u, v)` that is a centroid-tree ancestor of both `u` and `v`.
3. Equivalently, `c` is the *highest-level* (closest-to-root) centroid lying on `P(u, v)`.

**Proof.**
*(Existence / part 1.)* Consider the decomposition levels. Let `c` be the first centroid (smallest level) whose removal separates `u` from `v` — i.e. the first level at which `u` and `v` cease to be in the same component (this includes the case where the chosen centroid *is* `u` or `v`). Before that level, `u` and `v` are in a common component `C`, so the whole path `P(u, v)` lies in `C` (a component is connected and a tree path between two of its vertices stays inside it). At the level where `c` is the centroid of `C`, removing `c` splits `u` and `v` apart, which forces `c ∈ P(u, v)` (the only way deleting a single vertex disconnects two vertices in a tree is if that vertex lies on the path between them). So `c` lies on `P(u, v)`.

*(`c` is the centroid-tree LCA / part 2.)* At every level `< level(c)`, `u` and `v` share a component, hence share the same centroid ancestor at that level — these are the common ancestors of `u` and `v` in `CT`. At level `level(c)`, the centroid `c` is still a common ancestor (both `u` and `v` are in `C`, whose centroid is `c`). At level `> level(c)`, `u` and `v` are in different components, so they have no further common ancestor. Thus `c` is the deepest common ancestor — `LCA_{CT}(u, v)`.

*(Uniqueness / part 3.)* Suppose another centroid `c' ≠ c` on `P(u, v)` were also a common centroid-tree ancestor of both `u` and `v`. A centroid-tree ancestor of `u` is, by construction, a vertex whose component (at its level) contains `u`. If `c'` is an ancestor of both, then at level `level(c')` both `u, v` lie in `c'`'s component, so they were not yet separated — meaning `level(c') < level(c)` or `c' = c`. But then `c'` is an ancestor of `c` in `CT`; an ancestor of the LCA that also lies on `P(u,v)` cannot be a *common descendant-side* centroid on the path without coinciding with `c`. Removing `c` already separated `u, v`; any higher centroid `c'` on the path is an ancestor of `c`, and on the path the centroids form a chain ordered by level, with exactly one of them — `c` — being the separating one. Hence `c` is the unique such vertex. ∎

**Algorithmic consequence (no double counting).** Define, for each unordered pair `{u, v}`, the "owner" centroid `own(u, v) = LCA_{CT}(u, v)`. The map `own` partitions all `C(N, 2)` pairs (and hence all simple paths) by owner. Therefore
```
Σ_{c ∈ V}  ( # paths whose owner is c )  =  total # paths,
```
each path counted **exactly once**. The per-centroid count "paths through `c` that lie in `c`'s component, with the two endpoints in different child branches (or one endpoint = c)" is precisely the set of paths owned by `c`. The inclusion–exclusion subtraction (whole component minus each branch) computes exactly this set, which is why it neither misses nor double-counts.

---

## 5. Build Complexity O(N log N)

**Theorem 4.** The centroid tree can be built in `O(N log N)` time and `O(N)` space.

**Proof.** Finding the centroid of a component of size `n` costs `O(n)`: one DFS to compute residual subtree sizes, one descent to the centroid. Removing it and recursing partitions the component into pieces of total size `n − 1 < n`.

Charge the `O(n)` cost of processing a component to the vertices in that component: each vertex in a size-`n` component pays `O(1)`. By the Corollary to Theorem 2, a fixed vertex `v` is a member of exactly `level(v) + 1 = O(log N)` components across the whole decomposition. Hence the total charge to `v` over all levels is `O(log N)`, and summing over all vertices,
```
total time = Σ_v O(log N) = O(N log N).
```
Space is `O(N)` for `adj`, `size`, `removed`, `cparent`; the recursion stack is `O(height of size-DFS)`, which is `O(N)` in the worst case (a path tree) unless an explicit-stack iterative DFS bounds it. The *output* (centroid tree) is `O(N)` edges. ∎

**Tightness.** The bound is tight: on a balanced tree each of the `log N` levels does `Θ(N)` aggregate work, giving `Θ(N log N)`. Lower bound: any algorithm that, for each level, recomputes sizes over the residual tree must touch each surviving vertex once per level, and there are `Θ(N log N)` (vertex, level) incidences on a balanced tree.

**Note on weighted variants and storage.** If, per centroid, we *store* the distance of every component vertex (for radius/count queries), we materialize `Σ_v O(log N) = O(N log N)` distance entries, matching the time bound and giving `O(N log N)` space for that augmented index.

---

## 6. Cache Behavior

- The build is **DFS-bound**: subtree-size and centroid-finding passes traverse adjacency lists. With CSR (compressed-sparse-row) adjacency, each level streams the residual edges; cache behavior is that of a tree DFS — poor temporal locality across distant vertices but good when sibling edges are contiguous.
- The `removed[]` guard introduces a branch per neighbor; on skewed trees the branch is predictable (mostly "not removed" early, mostly "removed" late), which is friendly to branch predictors.
- The augmented per-centroid sorted distance arrays are **scan-friendly**: queries binary-search contiguous arrays, giving good locality for the radius-count pattern.
- Storing `cparent[]` as a flat `int` array makes the `O(log N)` ancestor walk a pointer-chase of length `≤ height`; for hot queries this is a handful of cache lines.

---

## 7. Average-Case

- On a **uniformly random labeled tree** (Cayley), the expected height is still `O(log N)` for the centroid tree (the `≤ N/2` halving is worst-case, not average — the centroid tree height is `O(log N)` *always*). What varies by input is the *constant*: balanced inputs reach the `⌊log₂ N⌋` bound, while bushy random trees often have slightly smaller centroid-tree height.
- Average per-component fan-out equals the average degree of centroids, which is `< 2` amortized (the centroid tree has `N − 1` edges over `N` nodes like any tree).
- For counting applications, the **distribution of distances** per centroid governs the constant in `O(N log N)` vs `O(N log² N)`: when distances are bounded by a small diameter, frequency-array counting beats sorting.

---

## 8. Space-Time Trade-offs

| Variant | Time | Space | Supports |
|---------|------|-------|----------|
| Plain CT (`cparent[]` only) | build `O(N log N)` | `O(N)` | static counting via on-the-fly DFS; ancestor walks |
| CT + per-vertex ancestor distances | build `O(N log N)` | `O(N log N)` | `O(log N)` distance to any ancestor; nearest-marked |
| CT + per-centroid sorted distance arrays | build `O(N log N)` | `O(N log N)` | `O(log² N)` radius/count queries |
| CT + per-centroid Fenwick over distance | build `O(N log N)` | `O(N log N)` | dynamic count-within-radius, `O(log² N)` update |

The recurring trade is **memory `O(N)` vs `O(N log N)`**: materializing per-level distance data costs the extra `log N` factor in space but unlocks `O(log² N)` queries/updates without per-query DFS.

---

## 9. Comparison

| Structure | Query class | Build | Per op | Dynamic topology? |
|-----------|-------------|-------|--------|-------------------|
| **Centroid decomposition** | distance counting, nearest-marked, path-property counting | `O(N log N)` | `O(log²N)` | No (rebuild) |
| **Heavy-Light Decomposition (14)** | path-aggregate query/update (sum/max/assign on `u–v`) | `O(N)` | `O(log²N)` | No (rebuild) |
| **Link-Cut Trees** | path-aggregate **with** link/cut | `O(N)` | `O(log N)` amort. | **Yes** |
| **Mo's algorithm on trees** | offline path queries (frequency/distinct) | — | `O((N+Q)√N)` | No |
| **LCA index (13)** | pairwise distance only | `O(N)` / `O(N log N)` | `O(1)`/`O(log N)` | No |

Centroid decomposition is the unique fit for "count/aggregate over the *set of paths*" and "distance-radius" queries; HLD/LCT handle aggregates *along a single given path*; Mo handles offline path-frequency queries when no clean per-centroid decomposition exists. They are complementary, not interchangeable.

---

## 10. Open Problems

- **Fully-dynamic centroid decomposition.** No known structure maintains a centroid tree under `O(polylog N)` edge insertions/deletions while preserving the `O(log N)` height *and* the per-centroid augmentation; topology change generally forces rebuild. Top-trees and LCT give dynamic *path* aggregates but not the centroid-LCA path-partition property cheaply.
- **Optimal distance-counting.** Whether "count pairs at distance `≤ K`" admits `O(N)` (no log) on arbitrary weighted trees is open in the comparison/algebraic models; CD gives `O(N log N)`–`O(N log² N)`.
- **Cache-oblivious / external-memory CD.** A provably `O((N/B) log_{M/B}(N/B))`-I/O build is not standard; the DFS-driven build is not naturally I/O-efficient.
- **Parallel depth.** Building CT with optimal work `O(N log N)` and polylog span on a PRAM/CREW model, given centroid-finding's sequential descent, is subtle.

---

## 11. Summary

Centroid decomposition rests on four precise facts. **(1)** Jordan's theorem guarantees a centroid exists, leaving every component `≤ ⌊N/2⌋` (Theorem 1). **(2)** Strict halving forces the centroid tree's height to `≤ ⌊log₂ N⌋ + 1` and each vertex into `O(log N)` levels (Theorem 2). **(3)** The path-decomposition theorem (Theorem 3) shows every `u–v` path crosses `LCA_{CT}(u, v)` exactly once, which partitions all paths by owner-centroid and is the rigorous basis for counting without double-counting (resolved by inclusion–exclusion). **(4)** Because each vertex appears in `O(log N)` components and each component costs linear work, the build is `O(N log N)` in `O(N)` space (Theorem 4). These bounds are worst-case and shape-independent, which is exactly why the structure is both theoretically clean and operationally predictable; its principal limitation remains static topology, leaving fully-dynamic centroid decomposition an open problem.
