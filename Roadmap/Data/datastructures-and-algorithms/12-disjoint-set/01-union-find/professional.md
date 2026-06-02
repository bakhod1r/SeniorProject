# Union-Find — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness Proof — Find Returns the Canonical Representative; Union Preserves the Partition
3. Complexity Without Optimizations — Θ(n) Worst Case
4. Preview of the Near-Constant Amortized Bound — α(n)
5. Lower Bounds — Fredman–Saks Cell-Probe Ω(α(n))
6. Memory Layout and Cache Behavior
7. Average-Case and Randomized Analysis
8. Space-Time Trade-offs
9. Comparison with Alternatives (asymptotics + constants)
10. Open Problems and Research Directions
11. Summary

---

## 1. Formal Definition

A **disjoint-set** (union-find) data structure maintains a **partition** of a finite universe `U = {0, 1, …, n-1}` into disjoint blocks (sets) under a sequence of operations. The structure is represented by a **parent function** `parent : U → U` inducing a forest, plus the invariant that each block has a unique **representative** (root).

**Definition 1.1 (Parent forest).** Let `parent : U → U`. Define the *root* of `x` as the fixed point reached by iterating `parent`:
```
root(x) = x                  if parent(x) = x
root(x) = root(parent(x))    otherwise.
```
For `root` to be well-defined, the functional graph of `parent` (each node has out-degree 1) must contain **no cycles except self-loops at roots**. We call this the **acyclicity invariant**.

**Definition 1.2 (Induced partition).** Define `x ≡ y  ⟺  root(x) = root(y)`. This is an equivalence relation (reflexive, symmetric, transitive — see §2), and its equivalence classes are the blocks of the partition `P`.

**Definition 1.3 (Operations).**
- `MakeSet(x)`: set `parent(x) := x`, creating the singleton block `{x}`.
- `Find(x)`: return `root(x)`, the representative of `x`'s block.
- `Union(a, b)`: let `ra := root(a)`, `rb := root(b)`; if `ra ≠ rb`, set `parent(ra) := rb` (or `rb := ra`), merging the two blocks into one.

**Definition 1.4 (Configuration).** A *configuration* is a pair `(parent, P)` where `P` is the partition induced by `parent` per Definition 1.2. A configuration is **valid** iff the acyclicity invariant holds and exactly one node per block is a root.

We analyze the **naive** structure: `Union` links roots without balancing, and `Find` performs no compression. Optimizations (union by rank/size, path compression) are introduced as forward references and treated fully in the sibling topics `02-path-compression` and `03-union-by-rank`.

---

## 2. Correctness Proof — Find Returns the Canonical Representative; Union Preserves the Partition

### 2.1 `≡` is an equivalence relation

**Proposition 2.1.** The relation `x ≡ y ⟺ root(x) = root(y)` is an equivalence relation, provided the acyclicity invariant holds (so `root` is total).

**Proof.** *Reflexivity:* `root(x) = root(x)`. *Symmetry:* `root(x) = root(y) ⟹ root(y) = root(x)`. *Transitivity:* `root(x) = root(y)` and `root(y) = root(z)` give `root(x) = root(z)`. All three are immediate from equality being an equivalence relation on `U`. ∎

### 2.2 `Find` correctness via a loop invariant

```text
FIND(x):
  while parent[x] != x:
    x := parent[x]
  return x
```

**Loop invariant `Inv`:** at the top of each iteration, `root(x_current) = root(x_initial)`, where `x_initial` is the argument and `x_current` is the loop variable.

**Proof.**
- *Initialization.* Before the first iteration `x_current = x_initial`, so `Inv` holds trivially.
- *Maintenance.* Suppose `Inv` holds and `parent[x_current] ≠ x_current`. By Definition 1.1, `root(x_current) = root(parent[x_current])`. After `x_current := parent[x_current]`, the new `x_current` satisfies `root(x_current_new) = root(x_current_old) = root(x_initial)`, so `Inv` is preserved.
- *Termination.* By acyclicity, iterating `parent` from any node reaches a fixed point (a root) in finitely many steps — at most the depth of `x` in its tree. The loop exits when `parent[x_current] = x_current`, i.e., `x_current` is a root.
- *Postcondition.* At exit, `x_current` is a root and `root(x_current) = root(x_initial)`; since `x_current` is its own root, `x_current = root(x_initial)`. Thus `Find(x)` returns `root(x)`, the **canonical representative**, which is identical for all members of a block. ∎

### 2.3 `Union` preserves the partition invariant

**Proposition 2.2.** If `(parent, P)` is valid and `ra = root(a) ≠ rb = root(b)`, then after `parent[ra] := rb` the new configuration is valid, its partition `P'` equals `P` with the blocks of `a` and `b` merged, and all other blocks unchanged.

**Proof.**
*Acyclicity preserved.* The only changed edge is `ra → rb`. Before the change `ra` was a root (a self-loop `ra → ra`), and `rb` lies in a *different* tree (since `ra ≠ rb` and they were distinct roots, their trees were disjoint). Redirecting `ra`'s self-loop to `rb` adds an edge between two previously disjoint trees, which cannot create a cycle: a cycle would require a path from `rb` back to `ra`, but `rb`'s tree contained no node of `ra`'s tree. Hence the functional graph remains acyclic except for self-loops at roots, and `rb` is now the unique root of the merged tree.

*Partition effect.* For any `x`, `root'(x)` (under the new `parent`) equals `rb` if `root(x) ∈ {ra, rb}`, and equals `root(x)` otherwise — because only nodes whose old root was `ra` now route through the new edge to `rb`. Therefore the blocks of `a` and `b` (those with old root `ra` or `rb`) merge into a single block with representative `rb`, and every other block is untouched. Membership of `a` and `b`: `root'(a) = rb = root'(b)`, so `a ≡' b` as required.

*No-op case.* If `ra = rb`, no edge changes; `P' = P`. The structure correctly leaves the partition (and any component counter) unchanged. ∎

**Corollary 2.3 (Counter correctness).** Maintaining `count := count − 1` exactly when `ra ≠ rb` keeps `count` equal to the number of blocks of `P`, since each effective union reduces the block count by exactly one and no-ops leave it fixed.

---

## 3. Complexity Without Optimizations — Θ(n) Worst Case

### 3.1 Per-operation cost is the path length

`Find(x)` performs work proportional to `depth(x)` (the number of parent-edges from `x` to its root). `Union(a, b)` performs two `Find`s plus `O(1)`. Hence the cost of every operation is governed by the maximum depth attainable in the forest.

### 3.2 The degenerate-chain lower bound

**Theorem 3.1.** Without balancing, there exists a sequence of `n−1` `Union` operations producing a tree of height `n−1`, after which a single `Find` costs `Θ(n)`.

**Proof (adversary construction).** Use the linking rule `parent[root(a)] := root(b)` and feed:
```
Union(0, 1)  →  parent[0] = 1
Union(1, 2)  →  parent[1] = 2
Union(2, 3)  →  parent[2] = 3
   ⋮
Union(n−2, n−1) → parent[n−2] = n−1
```
After step `k`, the tree is the chain `0 → 1 → … → k`, since each union links the current chain's root (which is `k−1` before the call resolves, becoming `k`) under the next element's root. Inductively, after `n−1` unions the forest is a single path `0 → 1 → … → n−1` of height `n−1`. Now `Find(0)` traverses all `n−1` edges, costing `Θ(n)`. ∎

**Corollary 3.2.** A sequence of `m` operations on this degenerate structure costs `Θ(m · n)` in the worst case — for example `n−1` unions to build the chain followed by `m − (n−1)` repeated `Find(0)` calls, each `Θ(n)`.

### 3.3 Why this is tight

`Find` cannot exceed the height of the tree, and a tree on `n` nodes has height at most `n−1`. The construction in Theorem 3.1 attains this, so the worst-case per-`Find` bound is exactly `Θ(n)`. This is the precise deficiency the optimizations remove.

---

## 4. Preview of the Near-Constant Amortized Bound — α(n)

The two standard optimizations, treated fully in `02-path-compression` and `03-union-by-rank`, transform the worst case into an essentially constant amortized cost. We state the results; proofs are deferred to those topics.

**Theorem 4.1 (Union by rank/size alone).** If every `Union` attaches the tree of smaller rank (or size) under the larger, then every tree on `k` nodes has height `≤ ⌊log₂ k⌋`, so each `Find`/`Union` costs `O(log n)` worst case.

*Proof sketch.* A node's depth grows by one only when its tree is the smaller side of a union, and each such event at least doubles the size of the tree containing it. A tree of `n` nodes doubles at most `log₂ n` times. (Full proof in `03-union-by-rank`.)

**Theorem 4.2 (Tarjan 1975 — combined optimizations).** With union by rank *and* path compression, any sequence of `m` `MakeSet`/`Find`/`Union` operations on `n` elements (with `m ≥ n`) runs in total time
```
O(m · α(m, n)),
```
where `α(m, n)` is the inverse of the Ackermann function — a function that grows so slowly that `α(m, n) ≤ 4` for every `n` writable in the physical universe.

**Definition 4.3 (Inverse Ackermann, informal).** Let `A(i, j)` denote the Ackermann function. Then `α(m, n) = min { i ≥ 1 : A(i, ⌊m/n⌋) > log₂ n }`. Because `A` grows astronomically in its first argument, `α` is effectively a small constant: `α(n) ≤ 4` for `n` up to `A(4,4)`, a number larger than the count of atoms in the observable universe.

**Remark 4.4.** Path compression *alone* (no union by rank) gives `Θ((m) · log_{1+m/n} n)` amortized — better than `O(log n)` for dense operation sequences but not the full inverse-Ackermann bound. Union by rank *alone* gives `O(log n)` worst case. Only the *combination* achieves `O(α(n))`. The interplay is the subject of the sibling topics.

---

## 5. Lower Bounds — Fredman–Saks Cell-Probe Ω(α(n))

The inverse-Ackermann upper bound is not an artifact of a particular algorithm; it is essentially optimal.

**Theorem 5.1 (Tarjan 1979; Tarjan & van Leeuwen 1984).** In the **pointer machine** model with **separation** (a node may only follow stored pointers, no address arithmetic), any union-find algorithm requires `Ω(m · α(m, n))` time for `m` operations on `n` elements. Hence the rank-plus-compression algorithm is optimal among pointer-machine algorithms.

**Theorem 5.2 (Fredman & Saks 1989).** In the stronger **cell-probe** model (where the algorithm may read and write `O(log n)`-bit memory cells with arbitrary addressing, charging only for probes), the *amortized* number of cell probes per operation for the union-find problem is
```
Ω(α(n)),
```
matching the upper bound. Fredman and Saks proved this via their **chronogram method**, partitioning the operation sequence into epochs of geometrically growing length and showing that, with constant probability, an operation must probe a cell last written in an "old" epoch, forcing `Ω(α(n))` probes amortized.

**Interpretation.** The inverse-Ackermann factor is **inherent to the problem**, not to the data structure. No amount of cleverness — even with full random access and word-level tricks — reduces incremental union-find below `Θ(α(n))` amortized per operation in this model. (Caveat: these bounds are for the *online, incremental* problem. The *offline* problem, where the entire operation sequence is known in advance, admits a **linear-time** `O(m)` algorithm — Gabow & Tarjan 1985 — by exploiting precomputed structure; see §10.)

---

## 6. Memory Layout and Cache Behavior

### 6.1 Implicit array representation

The structure is two `int` arrays, `parent[0..n-1]` and (optionally) `rank[]`/`size[]`. No pointers, no per-node allocation. Space is exactly `n` words for `parent` plus `n` for the balancing array — `Θ(n)` with a small constant.

### 6.2 Cache cost of `Find`

A `Find` chases `parent[x] → parent[parent[x]] → …`. Each step is a random read into the `parent` array. For a tree of height `h`, an uncompressed `Find` incurs up to `h` cache misses when the indices are scattered (no spatial locality between a node and its parent).

**Proposition 6.1.** After path compression, repeated `Find`s on the same element become near-`O(1)` cache misses because the path collapses to length `O(α(n))`. This is one reason compression matters in practice beyond its asymptotic effect: it converts a chain of cache misses into a handful.

### 6.3 Layout tactics

- **Single `int32[]`** for `parent` (and encode rank in the high bits or a second short array) maximizes elements per cache line.
- **Dense index remapping** of external keys to `[0, n)` preserves locality; hashing object identities destroys it.
- **Path halving / path splitting** compress incrementally with a single pass and no recursion stack, friendlier to the cache and the branch predictor than two-pass full compression.

---

## 7. Average-Case and Randomized Analysis

### 7.1 Random unions without balancing

**Theorem 7.1 (Knuth & Schönhage 1978; Bollobás & Simon 1993).** If the `n−1` unions that connect `n` elements are chosen uniformly at random (random *spanning-tree* model), the **expected** height of the resulting naive QuickUnion tree is `Θ(log n)`, and the expected cost of a random `Find` is `Θ(log n)` — even *without* balancing.

This explains a common empirical observation: naive QuickUnion often behaves acceptably on "random-looking" inputs, while still admitting the `Θ(n)` adversarial worst case of §3. The degenerate chain requires an *adversarial* union order.

### 7.2 Expected analysis with random linking by index

**Proposition 7.2.** "Union by random priority" (assign each element a random rank and always link the lower-priority root under the higher) achieves expected height `O(log n)` with high probability, matching union by size/rank in expectation while avoiding the explicit size bookkeeping. This is occasionally used when the balancing array is too costly to maintain.

### 7.3 Average path length under compression

Under union by rank plus path compression, the *average* path length traversed across a random sequence is `O(α(n))` amortized (Theorem 4.2), and concentration results (Jayanti, Tarjan & Boix-Adserà 2019) give sharp bounds on the distribution, not merely the mean — relevant for tail-latency-sensitive systems.

---

## 8. Space-Time Trade-offs

| Variant | Extra space beyond `parent[]` | `Find` | `Union` | Notes |
|---|---|---|---|---|
| Naive QuickUnion | 0 | `Θ(n)` worst | `Θ(n)` worst | Minimal space, bad worst case. |
| Union by size | `n` words (`size[]`) | `O(log n)` | `O(log n)` | `size[]` doubles as component-size query. |
| Union by rank | `n` *small* ints (`rank ≤ log n`, fits in a byte) | `O(log n)` | `O(log n)` | Cheaper than `size[]` if you don't need sizes. |
| + path compression | as above | `O(α(n))` am. | `O(α(n))` am. | Optimal; `rank` becomes an upper bound, not exact height. |
| Persistent (immutable) DSU | `O(log n)` per update (path copying) | `O(log n)` | `O(log n)` | Enables historical queries; loses array locality. |
| QuickFind (labels) | `n` (the label array *is* the structure) | `O(1)` | `O(n)` | Fast query, ruinous union. |

The dominant trade-off: spend `O(n)` extra words on `size`/`rank` to convert the `Θ(n)` worst case into `O(log n)`, then spend essentially nothing more (compression mutates the existing `parent[]`) to reach `O(α(n))`. The persistent variant trades the flat-array locality for time travel.

---

## 9. Comparison with Alternatives (asymptotics + constants)

### 9.1 Operation costs

| Structure | add edge / union | same-set query | delete edge | space/elem | bound type |
|---|---|---|---|---|---|
| Naive QuickUnion | `Θ(n)` | `Θ(n)` | — | 1 word | worst |
| Union by rank/size | `O(log n)` | `O(log n)` | — | 2 words | worst |
| Rank + path compression | `O(α(n))` | `O(α(n))` | — | 2 words | amortized |
| QuickFind (labels) | `O(n)` | `O(1)` | — | 1 word | worst |
| Adjacency + BFS/DFS | `O(1)` store | `O(n+m)` | `O(1)` | `O(n+m)` | worst |
| Euler-tour trees | `O(log n)` | `O(log n)` | `O(log n)` | `O(n)` ptrs | amortized |
| Link-cut trees | `O(log n)` | `O(log n)` | `O(log n)` | `O(n)` ptrs | amortized |
| HDT dynamic connectivity | `O(log² n)` am. | `O(log n)` | `O(log² n)` am. | `O(n + m)` | amortized |

`n` = elements, `m` = edges/operations. The defining gap: Union-Find with compression is *the* fastest structure for **incremental (insertion-only)** connectivity, at `O(α(n))`, but it is the *only* row that cannot delete. Every structure that supports deletion pays at least `O(log n)`.

### 9.2 Constant factors

On modern hardware, an optimized DSU `union`/`connected` is a handful of array reads and one or two writes — single-digit nanoseconds amortized when the working set is cache-resident. The inverse-Ackermann factor is invisible in practice; for any realistic `n`, you can treat operations as constant-time. By contrast, link-cut and Euler-tour structures carry large pointer-chasing constants and only win when deletions are mandatory.

### 9.3 The offline linear-time result

**Theorem 9.1 (Gabow & Tarjan 1985).** If the entire sequence of union and find operations is known in advance (the *offline* problem) and the union forest is given, union-find can be solved in `O(m + n)` total time — strictly linear, beating the online `Ω(m · α(n))` lower bound. The algorithm uses a static tree decomposition into micro-trees and table lookups. This is the basis of offline-LCA via Tarjan's algorithm (see this section's sibling topic `04-offline-lca`).

---

## 10. Open Problems and Research Directions

1. **Optimal concurrent union-find.** Jayanti & Tarjan (2016, 2021) gave randomized concurrent algorithms with near-optimal amortized work, but tight bounds for deterministic wait-free union-find with path compression remain an active area.

2. **Dynamic connectivity gap.** The best fully-dynamic (insert *and* delete) connectivity bound is `O(log² n / log log n)` amortized (Wulff-Nilsen, improving Holm–de Lichtenberg–Thorup). Whether `O(log n)` worst-case per operation is achievable for general dynamic connectivity is open.

3. **Tight constants in α.** The exact constant in front of `α(m, n)` for rank + compression, and whether simpler compression heuristics (halving, splitting) match the optimal constant, are studied but not fully settled (Tarjan & van Leeuwen 1984 classified the heuristics; refinements continue).

4. **Persistent and retroactive union-find.** Efficient *retroactive* DSU — answering "what if this past union had not happened?" — without full recomputation is partially solved; optimal retroactive connectivity is open.

5. **Distributed / external-memory union-find.** I/O-optimal and communication-optimal connected-components remain refined (e.g., Andoni et al. on MPC round complexity for connectivity). The exact round/work trade-off is open.

6. **Parallel union-find.** Work-efficient parallel connectivity with `o(log n)` depth and linear work, robust under adversarial scheduling, is an ongoing line (concurrent hooking-and-compression, as in Shiloach–Vishkin descendants).

---

## 11. Summary

The disjoint-set structure occupies a uniquely sharp point in data-structure theory:

- **Formal core.** A parent forest with the acyclicity invariant; the induced relation `root(x) = root(y)` is provably an equivalence relation, `Find` returns the canonical representative (loop-invariant proof, §2.2), and `Union` provably preserves the partition while merging exactly two blocks (§2.3).
- **Naive bound.** Without balancing, an adversarial union order builds a height-`(n−1)` chain, forcing `Θ(n)` per `Find` and `Θ(m·n)` overall (§3) — a tight worst case.
- **Optimized bound.** Union by rank gives `O(log n)`; adding path compression yields Tarjan's `O(m · α(m, n))` total, where `α ≤ 4` for all practical `n` (§4). Proofs are developed in `02-path-compression` and `03-union-by-rank`.
- **Lower bound.** The inverse-Ackermann factor is inherent: `Ω(α(n))` amortized in the cell-probe model (Fredman–Saks 1989) and `Ω(m·α)` in the pointer machine (Tarjan 1979) (§5).
- **Offline escape.** Knowing the operations in advance breaks the online lower bound: Gabow–Tarjan (1985) solve it in linear `O(m+n)` time (§9.3), enabling offline-LCA.
- **Trade-offs.** `Θ(n)` extra space for `rank`/`size` converts linear worst case to logarithmic; compression then reaches near-constant for free; persistence buys time travel at the cost of array locality (§8).

Galler & Fischer (1964) introduced the equivalence algorithm; Tarjan (1975) proved the inverse-Ackermann upper bound and (1979) the pointer-machine lower bound; Fredman & Saks (1989) proved the matching cell-probe lower bound; Gabow & Tarjan (1985) gave the offline linear algorithm; CLRS Chapter 21 remains the canonical pedagogical reference. The structure is sixty years old, fits in twenty lines, and is provably optimal in its model — a rare combination in algorithm design.
