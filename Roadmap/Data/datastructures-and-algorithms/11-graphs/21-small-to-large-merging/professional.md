# Small-to-Large Merging — Mathematical Foundations and Complexity Theory

## Table of Contents
1. [Formal Statement](#1-formal-statement)
2. [The Amortized O(N log N) Merging Proof](#2-the-amortized-on-log-n-merging-proof)
3. [The DSU-on-Tree O(N log N) Proof](#3-the-dsu-on-tree-on-log-n-proof)
4. [Light-Edge Counting and Path Depth](#4-light-edge-counting-and-path-depth)
5. [Comparison with Merge-Sort-Tree and Persistent Structures](#5-comparison-with-merge-sort-tree-and-persistent-structures)
6. [Cache Behaviour and the Hidden Constant](#6-cache-behaviour-and-the-hidden-constant)
7. [Average-Case and Best-Case Analysis](#7-average-case-and-best-case-analysis)
8. [Space-Time Trade-offs](#8-space-time-trade-offs)
9. [Comparison with Alternatives (Asymptotics + Constants)](#9-comparison-with-alternatives-asymptotics--constants)
10. [Open Problems and Research Directions](#10-open-problems-and-research-directions)
11. [Summary](#11-summary)

---

## 1. Formal Statement

We work over a *disjoint-set-merging* abstraction and its tree specialization.

**Definition 1.1 (Mergeable collection).** Let `U` be a universe of elements. A *mergeable collection* supports:
- `singleton(x)` — create a collection `{x}`, cost `O(1)`.
- `size(A)` — return `|A|`, cost `O(1)`.
- `mergeInto(A, B)` — insert every element of `B` into `A`, cost `Θ(|B| · c_ins)` where `c_ins` is the per-insertion cost of the underlying structure (`O(1)` for hashing, `O(log |A|)` for a balanced tree).

**Definition 1.2 (Small-to-large discipline).** A merge of two collections `A, B` is performed *small-to-large* if it is implemented as: if `|A| < |B|` swap the handles `A ↔ B` (cost `O(1)`), then `mergeInto(A, B)`. The result handle is `A`. Equivalently, the algorithm always iterates over the smaller collection.

**Definition 1.3 (Merge schedule).** A *merge schedule* on `N` initial singletons is a binary tree `T` with `N` leaves; each internal node represents one merge of the two collections produced by its children. The total work is `Σ_{internal v} size(smaller child of v) · c_ins` under the small-to-large discipline.

**Definition 1.4 (Rooted tree, heavy child).** Let `G` be a rooted tree on `N` nodes. For node `u` with children `C(u)`, define `sz(u) = 1 + Σ_{c ∈ C(u)} sz(c)`. The *heavy child* `h(u) = argmax_{c ∈ C(u)} sz(c)` (ties broken by an arbitrary fixed rule); edges to non-heavy children are *light*.

**Theorem 1.5 (Main bounds).**
1. Any small-to-large merge schedule on `N` singletons performs `O(N log N)` element insertions; total time `O(N log N · c_ins)`.
2. DSU on tree answers subtree-aggregate queries for all `N` nodes with `O(N log N)` `add`/`remove` operations; total time `O(N log N · c_op)` where `c_op` is the cost of one add/remove (`O(1)` for an array-backed counter).

We prove both. The key is the same doubling/halving invariant viewed from two directions.

**Notation conventions used throughout.**

| Symbol | Meaning |
|--------|---------|
| `N` | number of nodes (or initial singletons) |
| `U` | size of the value/color domain after compression |
| `sz(u)` | number of nodes in the subtree rooted at `u` |
| `h(u)` | heavy child of `u`; `argmax_{c} sz(c)` |
| `L(w)` | number of light edges on the path from `w` to the root |
| `c_ins`, `c_op` | per-insertion / per-add-remove cost of the underlying structure |
| `tin[u], tout[u]` | Euler-tour in/out timestamps; `subtree(u) = order[tin[u] .. tout[u])` |
| `Φ` | potential function (Theorem 2.5) |

All logarithms are base 2 unless noted. "Amortized" is in the aggregate (charging) sense; no randomization is assumed except in the explicitly-labelled average-case subsection.

---

## 2. The Amortized O(N log N) Merging Proof

**Theorem 2.1.** Under the small-to-large discipline, the total number of element insertions over any merge schedule on `N` singletons is at most `N · ⌊log₂ N⌋`.

**Proof (potential / charging argument).** We charge each insertion to the element being inserted. Consider a fixed element `x ∈ U`. Let the sequence of collections that contained `x`, in chronological order, be `S₀ ⊂ S₁ ⊂ … ⊂ S_m`, where `S₀ = {x}` (the singleton) and a new `S_{i+1}` is created exactly when `x` is *inserted* during a merge — i.e., `x` was in the smaller operand.

When `x` is inserted (transition `S_i → S_{i+1}`), it was in the smaller of two operands. Let the smaller have size `a = |S_i|` and the larger have size `b ≥ a`. The merged collection has size

```
|S_{i+1}| = a + b ≥ a + a = 2a = 2|S_i|.
```

Hence `|S_i| ≥ 2^i · |S₀| = 2^i`. Since every collection is a subset of `U` restricted to the `N` elements present, `|S_m| ≤ N`, giving `2^m ≤ N`, i.e. `m ≤ log₂ N`. So `x` is inserted at most `⌊log₂ N⌋` times.

Summing the charge over all `N` elements:

```
total insertions = Σ_{x} (#times x inserted) ≤ Σ_{x} ⌊log₂ N⌋ = N⌊log₂ N⌋.   ∎
```

**Corollary 2.2.** With `c_ins = O(1)` (hash set/map, array counter), the small-to-large merge runs in `O(N log N)`. With `c_ins = O(log N)` (balanced BST / ordered map, since inserting into a structure of size `≤ N` costs `O(log N)`), it runs in `O(N log² N)`.

**Remark 2.3 (Tightness).** The bound `Θ(N log N)` is tight. Take `N = 2^k` and a *balanced* merge schedule (a perfect binary merge tree): at level `ℓ` from the leaves there are `2^{k-ℓ}` merges each of two equal collections of size `2^{ℓ-1}`, contributing `2^{k-ℓ} · 2^{ℓ-1} = 2^{k-1}` insertions per level, across `k` levels: `k · 2^{k-1} = Θ(N log N)`. So no smarter charging can improve the worst case; the discipline is asymptotically optimal among comparison-free set unions.

**Remark 2.4 (Why "smaller into larger" and not the reverse).** Without the size check, the adversary forces `1 + 2 + ⋯ + (N-1) = Θ(N²)`. The size check is precisely what guarantees the doubling, which is precisely what bounds `m ≤ log₂ N`. It is the entire content of the theorem.

**Theorem 2.5 (Potential-function restatement).** The same bound follows from a potential argument that some readers prefer. Define the potential of a configuration of collections `{S₁, …, S_k}` as

```
Φ = Σ_j |S_j| · log₂(N / |S_j|)   ≥ 0.
```

Initially every collection is a singleton, so `Φ₀ = N · log₂ N`. When two collections of sizes `a ≤ b` merge into one of size `a + b`, the change in potential is

```
ΔΦ = (a+b)·log₂(N/(a+b)) − a·log₂(N/a) − b·log₂(N/b).
```

A short calculation (convexity of `x ↦ x log(N/x)` is *not* what we need; rather we bound the work directly) shows the *amortized* cost — actual insertions `a` plus `ΔΦ` — is `≤ a·(1 − log₂((a+b)/a)) ≤ 0` whenever `a + b ≥ 2a`, i.e. always under small-to-large. Hence total actual work `≤ Φ₀ − Φ_final ≤ Φ₀ = N log₂ N`. The potential view makes it manifest that *no* sequence of small-to-large merges can exceed the initial potential, independent of the merge tree's shape.

**Worked numeric example.** Take `N = 8` singletons and a perfectly balanced merge tree. Level 1: four merges of `1+1`, each `1` move → `4` moves. Level 2: two merges of `2+2`, each `2` moves → `4` moves. Level 3: one merge of `4+4`, `4` moves → `4` moves. Total `12 = 8·log₂8 / 2 · ... ` — precisely `Σ_{ℓ=1}^{3} 8/2 = 3·4 = 12 = (N/2)·log₂N`. Each element was moved exactly `log₂ 8 = 3` times. This matches the bound `N log₂ N = 24` with the tighter realized value `12`; the factor-of-2 gap is because at each level only half the elements (those in the smaller operand) move, but asymptotically both are `Θ(N log N)`.

---

## 3. The DSU-on-Tree O(N log N) Proof

The DSU-on-tree algorithm (keep the heavy child's global structure, re-add light subtrees) does **not** merge collections; it `add`s and `remove`s individual nodes from one global structure. Its cost is bounded by a *dual* of the previous argument.

**Theorem 3.1.** The total number of `add` operations performed by DSU on tree is at most `N · (⌊log₂ N⌋ + 1)`. The number of `remove` operations is at most the number of `add` operations. Hence total work is `O(N log N · c_op)`.

**Proof.** Recall the algorithm: at node `u`, the heavy child's contribution is *retained* (never removed when returning to `u`), and each light child's subtree is *re-added* node by node. A node `w` is added once at the leaf level when it is first reached, and then re-added every time it lies in a *light* subtree of some ancestor that is being processed.

Precisely, `w` is `add`-ed once for each ancestor `a` of `w` (including `w` itself) such that the edge from `a` toward `w` is a *light* edge — plus once for `w` itself. Equivalently, `w` is added exactly `1 + L(w)` times, where `L(w)` is the number of light edges on the path from `w` to the root.

So total adds `= Σ_w (1 + L(w)) = N + Σ_w L(w)`.

By Lemma 4.1 below, `L(w) ≤ log₂ N` for every `w`. Therefore

```
total adds ≤ N + N·log₂ N = N(1 + log₂ N) = O(N log N).
```

Each retained subtree is removed at most once (when its `keep` flag is false), so removes `≤` adds. With an array-backed counter `c_op = O(1)`, total time is `O(N log N)`.   ∎

**Remark 3.2 (No second log).** Crucially, DSU on tree pays `O(1)` per add — there is *no merge*, hence no per-operation `log`. This is the asymptotic separation from the naive ordered-map small-to-large (`O(N log² N)` by Corollary 2.2). The naive form pays `log N` *per insertion* into an ordered structure; DSU on tree replaces those insertions with array increments.

---

## 4. Light-Edge Counting and Path Depth

**Lemma 4.1 (Light-edge bound).** For any node `w` in a rooted tree on `N` nodes, the number of light edges on the path from `w` to the root is at most `⌊log₂ N⌋`.

**Proof.** Let the path from the root `r = a₀, a₁, …, a_d = w`. Suppose the edge `(a_i, a_{i+1})` is *light*. Then `a_{i+1}` is not the heavy child of `a_i`, so there exists a child `h` of `a_i` (the heavy one) with `sz(h) ≥ sz(a_{i+1})`. Since both `h` and `a_{i+1}` are disjoint subtrees of `a_i`,

```
sz(a_i) ≥ sz(a_{i+1}) + sz(h) ≥ 2·sz(a_{i+1}).
```

Thus traversing a light edge from `a_i` down to `a_{i+1}` at least *halves* the subtree size. Each light edge on the root-to-`w` path halves the running subtree size, starting from `sz(r) = N` and ending at `sz(w) ≥ 1`. After `k` light edges the size is `≤ N / 2^k`, and it must stay `≥ 1`, so `N/2^k ≥ 1 ⇒ k ≤ log₂ N`.   ∎

**Corollary 4.2.** The two `log N`s — the merge doubling (Theorem 2.1) and the light-edge halving (Lemma 4.1) — are the *same* fact stated for ascent vs descent. Doubling caps how often an element moves *up* a merge tree; halving caps how often a node sits in a light subtree on the way *down*. Both yield `O(N log N)` total work.

**Proposition 4.3 (Heavy-path decomposition).** The heavy edges partition the tree into vertex-disjoint *heavy paths*. There are at most `N` heavy paths, and any root-to-node path crosses at most `log₂ N + 1` distinct heavy paths (one boundary crossing per light edge). This is exactly the structure exploited by **14-heavy-light-decomposition**; DSU on tree uses only the light-edge count, not the explicit path structure.

**Corollary 4.4 (Exact add count formula).** Let `light(v)` be `1` if the edge `(parent(v), v)` is light and `0` otherwise (the root has `light = 0`). Then the total number of `add` operations DSU on tree performs is exactly

```
Σ_v ( 1 + Σ_{a is a strict ancestor of v} light(child of a on the path to v) )
  = N + Σ_{light edges e=(p,c)} sz(c),
```

because each node `c` below a light edge is re-added together with its whole subtree once for that edge. Therefore `total adds = N + Σ_{light e=(p,c)} sz(c)`. Each light child satisfies `sz(c) ≤ sz(p)/2`, and summing `sz` over light edges telescopes to `≤ N log₂ N`. This exact formula is the right thing to *instrument in production*: track the realized left-hand side and compare against `N⌈log₂ N⌉`; a violation pinpoints a broken heavy-child choice.

**Remark 4.5 (Tie-breaking is free).** When two children have equal subtree size, either may be designated heavy; Lemma 4.1 still holds because the *other* (light) child has size `≤ sz(parent)/2`. Thus the algorithm is correct and `O(N log N)` regardless of the tie-break rule — useful, because a deterministic tie-break (e.g., smallest index) makes runs reproducible for the determinism check discussed in `senior.md`.

---

## 5. Comparison with Merge-Sort-Tree and Persistent Structures

### 5.1 Merge-sort tree

A *merge-sort tree* stores, at each segment-tree node over an Euler-flattened array, the sorted multiset of values in that range. Building it is `Θ(N log N)` space and time; a subtree (range) query for "count of values ≤ k" is `O(log² N)`. Compared to small-to-large:

| Aspect | Small-to-large / DSU-on-tree | Merge-sort tree |
|--------|------------------------------|-----------------|
| Build time | `O(N log N)` | `O(N log N)` |
| Space | `O(N)` (DSU) or `O(N)` peak (merge) | `Θ(N log N)` |
| Per-query | amortized `O(1)` (offline) | `O(log² N)` (online) |
| Online? | no | yes |
| Aggregate type | any add/remove-maintainable | order statistics over ranges |

Small-to-large wins on space and on offline throughput; merge-sort tree wins when queries are online and order-statistic-shaped.

### 5.2 Persistent / mergeable structures

A *persistent segment tree merged along the tree* (so-called "segment tree merging") achieves the same subtree-aggregate result by merging value-indexed segment trees smaller-into-larger, in `O(N log U)` time and `O(N log U)` space, where `U` is the value domain. The merge of two such trees is itself amortized `O(size of overlap)`, and the same doubling argument bounds the total. This is the structure of choice when you need *order statistics or value-range queries* per subtree (not just counts), at the cost of `O(N log U)` memory.

**Theorem 5.1 (Segment-tree-merging cost).** Merging two value-indexed segment trees touches only nodes present in *both*; charging each touched node to its disappearance, the total merge work over the whole tree is `O(N log U)`.

*Sketch.* Every internal segment-tree node that is destroyed by a merge is destroyed once; the number of nodes ever created is `O(N log U)` (each of the `N` insertions creates `O(log U)` nodes); so total destruction = total creation = `O(N log U)`.   ∎

This is the persistent/union-find-style generalization the topic alludes to: the same smaller-into-larger schedule underlies DSU union-by-size, set merging, and segment-tree merging.

---

## 6. Cache Behaviour and the Hidden Constant

Asymptotics hide a large constant difference among the `O(N log N)` variants:

- **Per-node hash maps (naive small-to-large).** Each insertion is a hash computation, a probe, possible rehash, and pointer-chasing through bucket arrays. Effective cost per insertion is tens of nanoseconds with frequent cache misses. The recursion stack holds many live maps, thrashing the L2/L3 cache.
- **Global array counter (DSU on tree).** Each `add` is `cnt[val[u]]++` plus two `cntOfCount[]` updates — three array accesses. With value compression to `[0, U)` and `U` small, these stay resident in cache. This is why DSU-on-tree routinely beats per-node merging by 3–8× despite identical `O(N log N)`.
- **Euler-order locality.** Adding a light subtree as the contiguous range `[tin[v], tout[v])` walks `order[]` sequentially — a prefetch-friendly linear scan, far better than re-descending the tree (random pointer access).

**Model 6.1 (Cache-aware cost).** Let `M` be cache size in elements and `B` block size. The DSU-on-tree global counter incurs `O(N log N / B)` cache misses in the amortized I/O model when `U ≤ M` (counters stay cached) — versus `O(N log N)` misses for pointer-chasing maps. The constant, not the exponent, decides production viability.

**Proposition 6.2 (Branch behaviour).** The `add`/`remove` operations contain a data-dependent branch (`if cnt[c] == 0`). On adversarial inputs that alternate 0↔1 transitions, the branch predictor mispredicts at a rate approaching 50%, costing ~15–20 cycles per miss. Two mitigations: (a) make the update branchless using arithmetic on `cnt[c]` (e.g., `distinct += (cnt[c] == 0)` compiles to a `setcc`), and (b) keep `cnt` in a `uint16`/`uint32` array so more counters fit per cache line. Neither changes the asymptotics; both can halve wall-clock on hot loops.

**Proposition 6.3 (Why per-node maps thrash).** In the naive form, at recursion depth `d` there are up to `d` live hash maps on the stack, each with its own bucket array. The working set is `Σ_{live maps} bucket_capacity`, which can exceed `L2` even when the *data* fits, because hash maps over-allocate (load factor < 1) and pad. Empirically the naive form's last-level-cache miss rate is 3–10× the DSU-on-tree form's on the same logical workload, which is the dominant term in the observed 3–8× wall-clock gap.

---

## 7. Average-Case and Best-Case Analysis

**Best case (chain / "bamboo").** A path graph has exactly one heavy path and *zero* light edges below the root. By Theorem 3.1, total adds `= N + 0 = N`: DSU on tree is `Θ(N)`. The merge form is likewise `Θ(N)` (each merge is `{x}` into a growing set, smaller-into-larger keeps the singleton as smaller). The adversarial `O(N²)` case for the *naive un-checked* merge becomes the *best* case once the size check is present — a striking illustration of why the check matters.

**Best case for adversary against naive (no check).** A chain where you always merge the big accumulated set into the next singleton: `Θ(N²)`.

**Average case (random labelled tree).** For a uniformly random rooted tree (e.g., a random recursive tree), the expected number of light edges on a root-to-leaf path is `Θ(log N)`, matching the worst case up to constants; expected total adds remain `Θ(N log N)`. For random *binary* trees the expected depth is `Θ(√N)` but the light-edge count is still `O(log N)` by Lemma 4.1, so the bound is robust to tree shape.

**Worst case.** A complete binary tree maximizes light-edge counts at `Θ(log N)` for the deepest `Θ(N)` nodes, realizing the `Θ(N log N)` lower bound (mirrors Remark 2.3).

**Caterpillar / star analysis.** A *star* (root with `N−1` leaves) has all leaf edges light, but each light subtree has size `1`, so `Σ_{light} sz(c) = N − 1` and total adds `= N + (N−1) = Θ(N)` — again linear, because heavy/light only matters when light subtrees are *large*. A *caterpillar* (a spine with one leaf hanging off each spine node) is likewise `Θ(N)`. The `Θ(N log N)` worst case genuinely requires the recursive halving of a balanced tree; "wide but shallow" and "deep but thin" shapes are both linear. This is why real hierarchical data (org charts, file systems), which are usually shallow and bushy, run far below the worst-case bound in practice.

**Distributional remark.** For the random recursive tree (each new node attaches to a uniformly random existing node), the expected subtree size of a node at insertion-rank `k` is `Θ(N/k)`, and the expected number of large light edges on a path is `Θ(log N)`; a Chernoff-style concentration shows the realized add count is `N log N · (1 + o(1))` with high probability. So even "typical" inputs sit near the worst case asymptotically, differing only in constant.

---

## 8. Space-Time Trade-offs

| Variant | Time | Space | Notes |
|---------|------|-------|-------|
| Naive per-node hash merge | `O(N log N)` | `O(N)` peak + map overhead × live stack | Simple, parallelizable per subtree, memory-heavy |
| DSU on tree, global counter | `O(N log N)` | `O(U + N)` | Best constant; sequential; needs Euler arrays |
| Ordered-map merge | `O(N log² N)` | `O(N)` | Enables order-statistic queries per subtree |
| Segment-tree merging | `O(N log U)` | `O(N log U)` | Full value-range/order-statistic queries |
| Merge-sort tree (online) | `O(N log N)` build, `O(log² N)`/query | `O(N log U/B)` ≈ `O(N log N)` | Online, range order statistics |

The fundamental trade is **memory for query power**: counters give `O(1)` exact counts in `O(N)` space; segment-tree merging gives order statistics in `O(N log U)` space. There is no `o(N log N)`-time exact algorithm for the general distinct-subtree problem in the comparison model, by the lower bound below.

**Proposition 8.1 (Informal lower bound).** Reporting, for every node, the number of distinct values in its subtree requires `Ω(N log N)` time in the comparison/algebraic-decision-tree model when values come from an unbounded domain, by reduction from element distinctness applied along a star plus chain construction. Thus the `O(N log N)` of small-to-large is optimal up to constants for the general problem.

**Proof of Proposition 8.1 (reduction sketch).** Given `n` values `x₁, …, x_n` for the *element distinctness* problem (decide whether all are distinct, which has the classic `Ω(n log n)` algebraic-decision-tree lower bound), build a tree: a root `r` with `n` children `c₁, …, c_n`, where `c_i` carries value `x_i`. The number of distinct values in `subtree(r)` equals `n` iff all `x_i` are distinct. A subroutine that reports per-subtree distinct counts in `T(N)` time, with `N = n + 1`, decides element distinctness in `T(n+1) + O(n)`. Since element distinctness needs `Ω(n log n)`, we get `T(N) = Ω(N log N)`. The chain variant (each `c_i` on a path) forces the same bound while also stressing recursion depth, completing the construction. ∎

**Corollary 8.2 (Bounded domain escape).** The lower bound assumes an unbounded comparison domain. If values lie in `[0, U)` with `U = O(N)`, distinct-per-subtree can in principle use radix/counting tricks; DSU on tree already exploits this by using an array `cnt[]` rather than comparisons, achieving `O(N log N)` with `O(1)` per op. The `log N` here is *structural* (the light-edge count), not a comparison-sorting `log` — a subtle but important distinction when arguing optimality.

**Space lower bound.** Any algorithm that materialises all `N` per-node answers needs `Ω(N)` output space; the working space of DSU on tree is `O(U + N)` which is optimal up to the `U` term (unavoidable if you keep exact counts). Sketch-based methods trade this exactness for `o(U)` space, which is the only way below the `Ω(U)` exact-counting floor.

---

## 9. Comparison with Alternatives (Asymptotics + Constants)

| Method | Build | Query | Space | Online | Constant factor |
|--------|-------|-------|-------|--------|-----------------|
| Naive merge (no check) | — | — | `O(N)` | no | `Θ(N²)` — unusable |
| Small-to-large (hash) | `O(N log N)` | offline `O(1)` | `O(N)` | no | medium (hash) |
| DSU on tree (array) | `O(N log N)` | offline `O(1)` | `O(U+N)` | no | **low (array)** |
| Small-to-large (ordered) | `O(N log² N)` | offline `O(1)` | `O(N)` | no | high (BST) |
| Segment-tree merging | `O(N log U)` | per-query `O(log U)` | `O(N log U)` | partial | high (pointers) |
| Euler + Fenwick (sums) | `O(N log N)` | `O(log N)` | `O(N)` | **yes** | low |
| Euler + Mo's | `O((N+Q)√N)` | amortized | `O(N)` | no | medium |
| **15-centroid-decomposition** | `O(N log N)` | depends | `O(N log N)` | no | medium — *paths*, not subtrees |
| **14-heavy-light-decomposition** | `O(N)` | `O(log² N)` | `O(N)` | **yes** | low — *paths* |

### 9.1 Reference implementation (count distinct per subtree, all three languages)

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	maxColor := 0
	for i := range color {
		fmt.Fscan(rd, &color[i])
		if color[i] > maxColor {
			maxColor = color[i]
		}
	}
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b)
		a--; b--
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	sz := make([]int, n)
	heavy := make([]int, n)
	tin := make([]int, n)
	tout := make([]int, n)
	order := make([]int, n)
	timer := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1
		tin[u] = timer; order[timer] = u; timer++
		best := 0
		for _, v := range adj[u] {
			if v == p { continue }
			size(v, u)
			sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v }
		}
		tout[u] = timer
	}
	size(0, -1)
	cnt := make([]int, maxColor+1)
	distinct := 0
	ans := make([]int, n)
	add := func(u int) { if cnt[color[u]] == 0 { distinct++ }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { distinct-- } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] {
			if v != p && v != heavy[u] { dfs(v, u, false) }
		}
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for t := tin[v]; t < tout[v]; t++ { add(order[t]) }
			}
		}
		ans[u] = distinct
		if !keep {
			for t := tin[u]; t < tout[u]; t++ { rem(order[t]) }
		}
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class ProofRef {
    static List<List<Integer>> adj;
    static int[] color, sz, heavy, tin, tout, order, cnt, ans;
    static int timer = 0, distinct = 0;

    static void size(int u, int p) {
        sz[u] = 1; heavy[u] = -1;
        tin[u] = timer; order[timer] = u; timer++;
        int best = 0;
        for (int v : adj.get(u)) {
            if (v == p) continue;
            size(v, u); sz[u] += sz[v];
            if (sz[v] > best) { best = sz[v]; heavy[u] = v; }
        }
        tout[u] = timer;
    }
    static void add(int u){ if(cnt[color[u]]==0) distinct++; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) distinct--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u])
            for(int t=tin[v];t<tout[v];t++) add(order[t]);
        ans[u]=distinct;
        if(!keep) for(int t=tin[u];t<tout[u];t++) rem(order[t]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n];
        tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new int[n];
        int maxColor=0;
        for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>maxColor) maxColor=color[i]; }
        cnt=new int[maxColor+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder();
        for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    color = [int(data[p + i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[p]) - 1; b = int(data[p + 1]) - 1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz = [0]*n; heavy = [-1]*n; tin = [0]*n; tout = [0]*n; order = [0]*n
    timer = [0]
    def size(u, par):
        sz[u] = 1; tin[u] = timer[0]; order[timer[0]] = u; timer[0] += 1
        best = 0
        for v in adj[u]:
            if v == par: continue
            size(v, u); sz[u] += sz[v]
            if sz[v] > best: best = sz[v]; heavy[u] = v
        tout[u] = timer[0]
    size(0, -1)
    cnt = [0]*(max(color)+1); state = {"d": 0}; ans = [0]*n
    def add(u):
        if cnt[color[u]] == 0: state["d"] += 1
        cnt[color[u]] += 1
    def rem(u):
        cnt[color[u]] -= 1
        if cnt[color[u]] == 0: state["d"] -= 1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v != par and v != heavy[u]: dfs(v, u, False)
        if heavy[u] != -1: dfs(heavy[u], u, True)
        add(u)
        for v in adj[u]:
            if v != par and v != heavy[u]:
                for t in range(tin[v], tout[v]): add(order[t])
        ans[u] = state["d"]
        if not keep:
            for t in range(tin[u], tout[u]): rem(order[t])
    dfs(0, -1, False)
    sys.stdout.write(" ".join(map(str, ans)))

main()
```

---

### 9.2 Algebraic view: which aggregates are admissible

The technique is parametric in the *aggregate* it maintains. To formalise what may be plugged in, separate two interfaces.

**Definition 9.3 (Mergeable monoid).** A summary type `M` is a *mergeable monoid* if it has an identity `e`, an associative commutative `⊕ : M × M → M`, and a `singleton : U → M`. The subtree summary is `agg(subtree(u)) = ⊕_{w ∈ subtree(u)} singleton(value(w))`. The *naive* small-to-large requires only `⊕`, computed by iterating the smaller multiset into the larger — so any commutative monoid whose merge can be done by absorbing one element at a time works (set union, multiset union, sum, max, gcd, bitwise-or, count-of-distinct, Bloom/HLL union).

**Definition 9.4 (Add/remove group action).** DSU on tree requires more: an `add : M × U → M` and `remove : M × U → M` that are mutual inverses, plus a query `read : M → A`. This is strictly stronger — it demands the summary be *decrementable*. Distinct-count, frequency, sum, and `Σ C(cnt,2)` are decrementable; `max` is *not* (you cannot remove an element and recover the previous max in `O(1)` without extra bookkeeping). When the aggregate is not decrementable, you must either (a) fall back to the naive merge form, or (b) augment the structure (e.g., `cntOfCount` buckets to make `max` decrementable, as in `senior.md`).

**Proposition 9.5.** If `add`/`remove` each cost `O(1)`, DSU on tree runs in `O(N log N)`. If they cost `O(c)`, it runs in `O(N c log N)`. This is the precise statement of why the array-counter form (`c = O(1)`) dominates and why the ordered-map merge (`c = O(log N)`) is `O(N log² N)`.

### 9.3 A complexity trace on a concrete tree

Consider the complete binary tree on `N = 7` nodes (root `1`, children `2,3`; `2` has `4,5`; `3` has `6,7`). Subtree sizes: `sz(1)=7, sz(2)=sz(3)=3, sz(4..7)=1`. Heavy children: pick `2` for `1` (tie with `3`, break by index), `4` for `2`, `6` for `3`.

Light edges and their subtree sizes:
- edge `(1,3)`: `sz(3) = 3`
- edge `(2,5)`: `sz(5) = 1`
- edge `(3,7)`: `sz(7) = 1`

By Corollary 4.4, `total adds = N + Σ sz(light child) = 7 + (3 + 1 + 1) = 12`. The budget `N⌈log₂7⌉ = 7·3 = 21`, so `12 ≤ 21` ✓. Compare with the realized worst case on this exact tree if the heavy child were chosen *wrong* (say always the smaller-index leaf side): light subtrees could include `sz = 3` twice plus larger contributions, climbing toward the quadratic regime on deeper instances. The `12` vs `21` gap also shows the bound is not tight on small `N`; tightness is asymptotic.

### 9.35 Decision table: which form for which aggregate

| Aggregate query (per subtree) | Decrementable? | Recommended form | Bound |
|-------------------------------|----------------|------------------|-------|
| Number of distinct values | yes (0↔1 transitions) | DSU on tree, array `cnt` | `O(N log N)` |
| Most frequent count (mode size) | yes (with `cntOfCount`) | DSU on tree | `O(N log N)` |
| Sum of modal values | yes (with `sumByFreq`) | DSU on tree | `O(N log N)` |
| Sum of distinct values | yes (0↔1 transitions) | DSU on tree | `O(N log N)` |
| Number of equal-value pairs `Σ C(cnt,2)` | yes (`pairs ± cnt`) | DSU on tree | `O(N log N)` |
| k-th smallest value | no (needs order) | segment-tree merging | `O(N log U)` |
| Count of values in `[l, r]` | no (needs order) | segment-tree merging / ordered merge | `O(N log U)` or `O(N log² N)` |
| Max value | not `O(1)`-decrementable | naive merge (max monoid) | `O(N log N)` |
| Set union as an explicit object | n/a (you want the object) | naive merge | `O(N log N)` |

The pattern: *count-like* aggregates over a bounded domain are decrementable and go to DSU on tree with an array; *order-statistic* aggregates need an ordered structure and pay an extra `log`.

### 9.4 Relationship to offline dynamic connectivity

Small-to-large merging is the *acyclic, monotone* special case of offline incremental connectivity. In full offline dynamic connectivity (edges inserted *and* deleted) one uses a segment tree over time plus a rollback DSU, paying `O(log T)` extra. When there are no deletions and the union structure is a tree processed bottom-up, that machinery collapses to plain union-by-size — i.e., small-to-large. Recognising this places the technique inside the broader family: union-by-size (incremental), rollback DSU (offline with deletions), link-cut trees (fully dynamic). Each adds a `log` for the extra power it buys.

## 10. Open Problems and Research Directions

- **Online subtree distinct counts in `o(√N)` per update.** No known structure matches the offline `O(1)`-per-query of DSU on tree while supporting value updates; subtree distinct under updates is conjectured to require `Ω(√N)`-ish per operation (related to dynamic graph connectivity lower bounds).
- **Parallel DSU on tree.** The sequential global-counter form resists parallelization. Work-efficient parallel small-to-large with `O(log N)` span on the naive (per-subtree) form is known via prefix-style merging, but a practical parallel DSU-on-tree with the array-counter constant is open in practice.
- **Cache-oblivious small-to-large.** Whether the Euler-range add can be made cache-*oblivious* (optimal misses without knowing `B`) while preserving the `O(1)` per-op constant is unexplored.
- **Persistent set merging lower bounds.** Segment-tree merging is `O(N log U)`; whether `O(N log N)` (independent of `U`) is achievable for full order-statistic subtree queries with persistence remains an interesting question.
- **Generalization to DAGs.** Small-to-large is exact only on trees; on DAGs with shared subtrees the merge double-counts. Approximate sketch-based merging (HLL) restores near-linear time at the cost of accuracy.
- **Tighter constants via weight-balanced merges.** The doubling argument uses the crude `a + b ≥ 2a`. For specific merge-tree shapes (e.g., Huffman-like by size) the realized total can be analysed more finely; whether a provably optimal *order* of merges (beyond smaller-into-larger) reduces the constant for a fixed multiset of sizes is a small open combinatorial question.
- **Lower bounds for decrementable aggregates.** Distinct-count is `Ω(N log N)`; for *additive* decrementable aggregates (plain sums) an Euler-tour prefix sum is `O(N)`. The precise boundary — which decrementable aggregates admit `o(N log N)` per-subtree algorithms — is not fully characterised.
- **External-memory small-to-large.** A cache-oblivious or I/O-optimal variant matching the `O(N log N / B)` lower bound while keeping `O(1)` amortized per op is not known to be implemented in practice, though the Euler-range add is a promising primitive.
- **Incremental tree edits.** When the tree changes by a single edge insertion or subtree move, recomputing all answers from scratch is `O(N log N)`. Whether an `o(N log N)` *incremental* recomputation exists for distinct-per-subtree under structural edits — without falling back to a fully dynamic structure — is open and practically relevant for slowly-mutating hierarchies (org charts, file systems).

---

### 10.1 Correctness as a loop invariant

For completeness, state the DSU-on-tree correctness as an invariant maintained over the recursion.

**Invariant (I).** *At the moment `dfs(u, keep)` is about to record the answer for `u`, the global structure contains exactly the multiset `{ value(w) : w ∈ subtree(u) }` and nothing else.*

**Proof that (I) holds.** Induct on subtree height.
- *Base.* A leaf `u`: no children, so after `add(u)` the structure (which was empty on entry by the inductive clearing of siblings) holds exactly `{value(u)} = subtree(u)`.
- *Step.* For internal `u`: light children are processed with `keep=false`, so by the inductive clearing each leaves the structure exactly as it found it (empty contribution net). The heavy child is processed with `keep=true`; by the induction hypothesis applied to it, after its `dfs` returns the structure contains exactly `subtree(heavy[u])` (it is *not* cleared). We then `add(u)`, giving `subtree(heavy[u]) ∪ {value(u)}`. Then for each light child `v` we add every node of `subtree(v)` via its Euler range, giving `⋃_v subtree(v) ∪ subtree(heavy[u]) ∪ {value(u)} = subtree(u)`. Invariant (I) holds when we record. ∎

**Proof that clearing restores the precondition.** If `keep=false`, after recording we remove every node of `subtree(u)` (its Euler range), returning the structure to exactly what it was on entry to `dfs(u, …)` — which the caller relied upon for the next sibling. If `keep=true`, we deliberately *do not* clear, because the caller (the parent, for whom `u` is the heavy child) wants `subtree(u)` retained. This is precisely the asymmetry that removes the per-merge cost.

### 10.2 Frontier directions

Beyond the items below, two practical frontiers are worth noting. First, **GPU / SIMD batch merging**: the naive per-subtree form's independent merges are a natural fit for data-parallel hardware, but the irregular set sizes defeat naive vectorisation; bucketed radix merging is an active engineering area. Second, **approximate DSU on tree** using mergeable sketches (KMV, HLL, Count-Min) gives `O(N · sketch_size)` time independent of the value domain, trading exactness for both speed and the ability to merge across machine boundaries — the bridge to the distributed regime in `senior.md`.

## 11. Summary

The two headline bounds rest on one geometric fact viewed twice. **Theorem 2.1**: under the smaller-into-larger discipline an element's container at least doubles on every move, so it moves `≤ log₂ N` times, giving `O(N log N)` total insertions — and `O(N log² N)` if each insertion itself costs `O(log N)` in an ordered structure. **Theorem 3.1 + Lemma 4.1**: DSU on tree adds each node once per light edge above it, and there are `≤ log₂ N` light edges on any root path (each halves the subtree size), giving `O(N log N)` `add`s with no per-operation `log` — the asymptotic and constant-factor win over ordered-map merging. Both are tight (`Θ(N log N)` on balanced trees, `Θ(N)` on chains), optimal up to constants by the element-distinctness lower bound, and they share their schedule with DSU union-by-size and segment-tree merging — the broader family of persistent, smaller-into-larger structures.

The practitioner's distilled checklist:

1. **Establish the four preconditions** before reaching for the technique: the queries are *offline*, *subtree*-shaped, the aggregate is *non-invertible* (or not easily prefix-summable), and the data fits one machine. Fail any one and a different tool (Euler+Fenwick, HLD, centroid decomposition, distributed sketches) wins.
2. **Pick the form by decrementability** (Definition 9.4 and the §9.35 table): array-counter DSU on tree for count-like aggregates, ordered/segment-tree merging for order statistics, naive merge for explicit set objects or non-decrementable monoids.
3. **Guard the heavy-child invariant** with the exact add-count formula of Corollary 4.4 — `total adds = N + Σ_{light} sz(c) ≤ N⌈log₂ N⌉` — turned into a runtime assertion. Its violation is the only way the asymptotics silently break.
4. **Optimise the constant, not the exponent**: compress values to a dense range, keep one global flat counter, add light subtrees via Euler ranges, and consider branchless updates. The `3–8×` gap between the naive map form and the array form is entirely constant-factor, dominated by cache behaviour (Propositions 6.2–6.3).

These four moves convert the elegant amortized bound into a fast, correct, production-ready routine.

In one sentence: *small-to-large is union-by-size lifted onto a rooted tree, and its `O(N log N)` is the price of never copying a large container into a small one.*
