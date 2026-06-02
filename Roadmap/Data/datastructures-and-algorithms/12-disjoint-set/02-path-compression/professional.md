# Path Compression — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition of Each Variant
2. Correctness Proof — Compression Preserves the Partition
3. Amortized Analysis of Path Compression Alone
4. Combined with Union-by-Rank → O(α(n)) (Tarjan's Theorem)
5. Lower Bounds
6. Cache Behavior
7. Randomized / Average-Case Analysis
8. Variant Trade-offs (halving vs splitting vs full)
9. Comparison
10. Open Problems and Research Directions
11. Summary

---

## 1. Formal Definition of Each Variant

A **disjoint-set forest** on ground set `V = {0, …, n−1}` is a function `parent: V → V` whose functional graph is a forest of in-trees: every node has out-degree 1, and a node `r` is a **root** iff `parent(r) = r` (a self-loop). For `x ∈ V`, define the **find-path**
```
P(x) = (x₀ = x, x₁ = parent(x), x₂ = parent²(x), …, x_k = root(x)),
```
where `x_k` is the unique root reachable from `x` and `k = depth(x)` is its depth. `find(x)` returns `x_k`. The three compression rules differ only in how they rewrite `parent` along `P(x)`.

**Definition 1.1 (Full path compression).** After computing `r = x_k`, set
```
parent(xᵢ) := r   for all i = 0, …, k−1.
```
Every node on the path points directly at the root. Realized either recursively (`parent(x) := find(parent(x))`) or by an explicit two-pass loop.

**Definition 1.2 (Path halving).** Traverse `P(x)`; at each visited node set its parent to its current grandparent and advance two levels:
```
while parent(x) ≠ x:
    parent(x) := parent(parent(x))
    x := parent(x)
```
Exactly the odd-indexed nodes `x₀, x₂, x₄, …` get rewritten, each to its grandparent.

**Definition 1.3 (Path splitting).** Traverse `P(x)`; rewrite *every* node to its current grandparent, advancing one level:
```
while parent(x) ≠ x:
    next := parent(x)
    parent(x) := parent(parent(x))
    x := next
```
Every node `x₀, x₁, …, x_{k−2}` gets rewritten to its grandparent `x_{i+2}`.

**Remark 1.4 (One-pass vs two-pass).** Full compression is two-pass: it must locate `r` before it can publish `parent(xᵢ) := r`. Halving and splitting are one-pass and *online*: each rewrite depends only on a node's parent and grandparent, which are known the moment the node is visited. This locality is what makes halving/splitting recursion-free and concurrency-friendly (see [`senior.md`](./senior.md)).

---

## 2. Correctness Proof — Compression Preserves the Partition

The semantic object a DSU represents is the **partition** `Π` of `V` induced by the connectivity relation `x ∼ y ⇔ root(x) = root(y)`. We prove every compression rule leaves `Π` invariant, i.e., `find` returns the same representative before and after compression and the equivalence classes are unchanged.

**Lemma 2.1 (Ancestor-preserving writes).** Each of the three rules only ever sets `parent(v)` to a node `w` that is a **proper ancestor of `v` on `P(v)`** at the moment of the write.

*Proof.* Full compression sets `parent(xᵢ) := r = x_k`, and `x_k` is an ancestor of `xᵢ` by definition of the path. Halving and splitting set `parent(xᵢ) := parent(parent(xᵢ)) = x_{i+2}`, the grandparent, which is an ancestor of `xᵢ`. In all cases the new parent lies strictly above `v` on the same root-to-`v` path. ∎

**Theorem 2.2 (Representative invariance).** For every `v ∈ V`, `root(v)` is unchanged by any compression rule.

*Proof.* By Lemma 2.1, every write replaces an edge `v → parent(v)` with an edge `v → w` where `w` is an ancestor of `v` in the *same* tree. Such a write cannot change the root reachable from `v`: `w` and the old `parent(v)` share the same root (both ancestors of `v` lie on the path to the same `x_k`), and following `v → w → … → root` reaches the identical root. No write ever connects two distinct trees or disconnects a node from its tree; it only short-circuits within one tree. Hence `root(v)` — and therefore the entire partition `Π` — is invariant. ∎

**Corollary 2.3 (No cycles introduced).** Compression never creates a directed cycle other than the root self-loop. Since every new edge points to a strict ancestor, the parent relation remains acyclic on non-roots; the forest structure is preserved.

**Corollary 2.4 (Depth is non-increasing).** For every node `v`, `depth(v)` after a compression is `≤ depth(v)` before it. Full compression sets depths on the path to 1; halving/splitting at least halve the depth of rewritten nodes. This monotone decrease is the engine of the amortized analysis in §3–§4.

---

## 3. Amortized Analysis of Path Compression Alone

Here we analyze compression with **arbitrary (unweighted) union** — i.e., `union` links one root under the other with no rank/size rule. The classical results:

**Theorem 3.1 (Compression alone, arbitrary union).** A sequence of `m` `find` operations interleaved with up to `n−1` arbitrary unions on `n` elements, using **full path compression**, runs in
```
O((m + n) · log n)   total,   i.e.   Θ(log n) amortized per find in the worst case.
```

*Proof sketch (potential / accounting).* Assign to each node `v` a potential equal to a function of its depth. A union (arbitrary) can increase a tree's height by at most 1 per merge, so over `n−1` unions the maximum height is `O(n)` in the absolute worst case — but the *amortized* charge to finds is bounded as follows. Each `find(x)` that walks a path of length `ℓ` performs `ℓ` pointer follows. Of these, all but `O(log n)` re-point a node to a strictly higher ancestor, *permanently* reducing that node's future contribution. Charge the `O(log n)` "near-root" steps to the find itself, and charge each remaining step to the node it compresses; a node can be charged this way at most `O(log n)` times before it reaches the root, because each such charge moves it closer to the root by a factor that telescopes logarithmically. Summing gives `O((m+n) log n)`. ∎

A sharper, tight statement (Tarjan & van Leeuwen, 1984) refines the constant depending on the *exact* union discipline.

**Theorem 3.2 (Compression alone with union-by-size, no rank ordering of finds).** If unions are done by *size* (smaller tree under larger) but you analyze compression's contribution separately, the per-operation amortized cost of compression with union-by-size is
```
Θ( log n / log( 1 + m/n ) )      for m finds over n elements,
```
which for `m = Θ(n)` is `Θ(log n / log log n)`. This is the classic "Θ(log n / log log n) with union by size" bound: compression alone, even paired with a balanced union, does *not* reach inverse-Ackermann — you need the *interaction* of both balancing the union AND compressing, analyzed jointly, to get `α(n)`.

**Takeaway.** Compression alone (arbitrary union): `Θ(log n)` amortized. Compression alone with union-by-size: `Θ(log n / log log n)`. Only the *joint* analysis of compression **and** union-by-rank reaches `Θ(α(n))` (§4). These three regimes are genuinely different and the distinction is a favorite exam question.

---

## 4. Combined With Union-by-Rank → O(α(n)) (Tarjan's Theorem)

### 4.1 The inverse Ackermann function

Define Ackermann's function (one standard form):
```
A_0(x)     = x + 1
A_{k+1}(x) = A_k^{(x+1)}(x)        (apply A_k  x+1 times to x)
```
so `A_1(x) = 2x+1`, `A_2(x) ≈ 2^{x+1}·(x+1) − 1`, `A_3` is tower-of-exponentials tall, `A_4(1)` already exceeds the number of atoms in the universe. The **inverse Ackermann function** is
```
α(n) = min { k ≥ 1 : A_k(1) ≥ n }.
```
For all `n ≤ A_4(1)` — i.e., every conceivable input — `α(n) ≤ 4`. It grows, unboundedly but absurdly slowly; for practical purposes it is a small constant.

(CLRS uses a closely related two-argument `α(m, n)`; the single-argument `α(n)` above and Tarjan's original `α` differ by bookkeeping but agree in asymptotic class.)

### 4.2 The theorem

**Theorem 4.1 (Tarjan, 1975).** A sequence of `m ≥ n` `union` and `find` operations on `n` elements, using **union by rank** and **path compression** (full, halving, or splitting), runs in total time
```
O(m · α(m, n)),
```
i.e., `Θ(α(n))` amortized per operation. This is the famous near-linear bound.

*Citation:* R. E. Tarjan, "Efficiency of a good but not linear set union algorithm," *Journal of the ACM* 22(2):215–225, 1975. The matching lower bound for the pointer-machine model is Tarjan (1979) / Fredman & Saks (1989); see §5.

### 4.3 Proof structure (the partition-by-rank / "ranks into blocks" argument)

The standard proof (CLRS Ch. 21, following Tarjan) uses a potential function based on **ranks** and the multi-level structure of `α`.

1. **Ranks are monotone and sparse.** With union by rank, a root's rank only increases, and at most `n / 2^r` nodes ever attain rank `r`. Ranks along any root-to-node path are strictly increasing. Crucially, compression *does not change ranks* — it only makes real heights smaller than the rank bound (rank becomes an upper bound on height, see [`middle.md`](./middle.md)). So the rank analysis is unaffected by which compression variant you use.

2. **Level partition.** Partition the possible ranks into "levels" indexed by `0, 1, …, α(n)` using the Ackermann hierarchy: node `x` with parent `p` is at *level* `j` where `j` is the largest value such that `rank(p) ≥ A_j(rank(x))`. Because ranks grow so fast relative to `A_j`, every node has a level in `{0, …, α(n)}`.

3. **Potential / charging.** Assign each node a potential that decreases whenever a compression step moves the node "up a level." Each `find` is charged `O(α(n))` directly (one unit per level it crosses) plus a charge to each node it compresses. A node can be charged by compression at most `O(A_{j}(·))`-many times before it is promoted to the next level; summed over all `α(n)` levels and all `n` nodes, the total compression charge is `O(n · α(n))`.

4. **Sum.** Direct find charges contribute `O(m · α(n))`; node-compression charges contribute `O(n · α(n))`; union contributes `O(m)`. Total `O(m · α(m,n))`. ∎ (sketch)

The single most important structural fact: **rank balances the tree so that few nodes ever get high rank, and compression repeatedly promotes nodes through the `α(n)` Ackermann levels, with each level absorbing only a bounded amount of work per node.**

### 4.4 Why all three compression variants give the same bound

The proof above never uses *which* ancestor a node is re-pointed to — only that (a) ranks strictly increase up any path, and (b) each compression write moves a node strictly closer to the root (Corollary 2.4), promoting it through levels. Full, halving, and splitting all satisfy (b). Tarjan & van Leeuwen (1984) proved this rigorously: **full compression, halving, and splitting each combine with union by rank (or size) to give `O(m · α(m,n))`.** They differ only in constant factors (§8).

---

## 5. Lower Bounds

**Theorem 5.1 (Tarjan 1979; Fredman–Saks 1989).** In the pointer-machine / cell-probe model, any data structure for the disjoint-set union problem requires `Ω(m · α(m, n))` total time on a sequence of `m` operations over `n` elements. Hence the Tarjan upper bound of §4 is **asymptotically optimal** — you cannot beat inverse Ackermann in these models.

*Significance:* `α(n)` is not an artifact of a particular algorithm or proof; it is intrinsic to the problem. This is one of the rare natural problems whose tight complexity is a slowly-growing-but-non-constant function. Fredman & Saks established the lower bound via the *chronogram* technique in the cell-probe model; it applies even to the *separable* pointer machine.

**Corollary 5.2.** No combination of compression variant and union discipline can achieve `O(m)` (truly linear) worst-case total time for arbitrary interleavings. The `α(n)` factor is unavoidable.

(Special structured cases — e.g., when the union tree is known offline, or in the *incremental* setting with restrictions — admit linear-time algorithms: Gabow & Tarjan 1985 gave an `O(m)` algorithm for the special case where the union operations form a tree known in advance. But for the general online problem, `Ω(m α(m,n))` holds.)

---

## 6. Cache Behavior

The complexity model above counts pointer follows; real performance is dominated by **cache misses**, and here compression's effect is dramatic.

- **Before compression**, a `find` on a depth-`d` node performs `d` dependent loads of `parent[·]`. Because the path nodes are scattered across the array (union links arbitrary indices), each hop is likely a cache miss: `Θ(d)` misses.
- **After compression**, the node points directly (or nearly) at the root: subsequent finds are 1–2 dependent loads, `O(1)` misses.

So compression converts a chain of `d` dependent cache misses into a single load. This is why, empirically, the *first* sweep of finds over a freshly-built deep forest is slow (cache-miss bound) and every later sweep is fast.

**Splitting vs halving cache cost per call:** both read `parent[x]` and `parent[parent[x]]` per step; splitting writes once per step, halving writes once per two steps. On write-heavy interconnects halving issues fewer store operations, marginally cheaper; on read-bound workloads they are indistinguishable. Layout matters more than variant: a contiguous `int[] parent` beats pointer-chasing objects by a large constant.

---

## 7. Randomized / Average-Case Analysis

**Theorem 7.1 (Doyle & Rivest 1976; Knuth & Schönhage 1978).** Under union by rank with path compression, on *random* sequences of operations the expected per-operation cost is `O(α(n))`, with the average path length per find tending to a small constant. Knuth & Schönhage analyzed the *average* number of nodes on the find-path under random unions and found it `Θ(1)` amortized once compression is active.

**Average path length dynamics.** Empirically and in expectation, after `Θ(n)` finds over `n` elements the average find-path length is below 2; the structure self-flattens. This is the quantity to monitor in production (see `senior.md` §8): if the measured average path length does not decay, either union-by-rank is missing or compression is being silently dropped.

**Smoothed / adversarial gap.** The worst-case `α(n)` and the average `O(1)` differ only by the inverse-Ackermann factor, which is itself ≤ 4 in practice — so unlike, say, quicksort, there is little practical daylight between average and worst case for DSU. Both are effectively constant.

---

## 8. Variant Trade-offs (halving vs splitting vs full)

All three give identical asymptotics (`Θ(α(n))` with rank, `Θ(log n)` alone with arbitrary union). They differ in *constants* and *engineering properties*:

| Property | Full compression | Path halving | Path splitting |
|---|---|---|---|
| Passes | 2 | 1 | 1 |
| Recursion / extra stack | yes (recursive) or O(1) (two-pass loop) | none | none |
| Pointer writes per call | one per node on path | one per ~2 nodes | one per node on path |
| Pointer reads per call | path length | ~2 per step | ~2 per step |
| Result of a single call | path perfectly flat | depth halved | each node → grandparent |
| Concurrency-friendly | no (needs root first) | yes | **yes (preferred)** |
| Stack-overflow risk | yes if recursive | no | no |
| Typical constant factor | slightly higher (two passes) | **lowest writes** | low |

**Empirical ranking (single-threaded):** on random workloads the three are within ~5–15% of each other; halving usually edges ahead on write-bound machines because it issues the fewest stores, while full compression can win on pure read-then-reuse patterns because it flattens in one shot. The differences are small enough that **engineering properties (no recursion, concurrency-safety) usually decide the choice, not raw speed** — which is why production code overwhelmingly uses halving or splitting.

Tarjan & van Leeuwen (1984), *"Worst-case analysis of set union algorithms," JACM 31(2):245–281*, is the definitive reference proving all variant × union-discipline combinations and their precise constants.

---

## 9. Comparison

| Find strategy | Union discipline | Amortized / op | Tightness |
|---|---|---|---|
| Naive (no compression) | arbitrary | Θ(n) worst | — |
| Naive (no compression) | by rank/size | Θ(log n) | tight |
| Full / halving / splitting | arbitrary | Θ(log n) | tight (Tarjan–van Leeuwen) |
| Full / halving / splitting | by size, finds analyzed alone | Θ(log n / log log n) | tight |
| Full / halving / splitting | by rank/size, joint | **Θ(α(m,n))** | tight (Tarjan 1975 / lower bound Fredman–Saks 1989) |

The progression `Θ(n) → Θ(log n) → Θ(log n / log log n) → Θ(α(n))` precisely traces how much each ingredient buys: balanced union alone gives `log n`; compression alone gives `log n`; compression + balanced union *together* give `α(n)`. Neither ingredient alone suffices for inverse-Ackermann.

---

## 10. Open Problems and Research Directions

1. **Persistent / retroactive DSU with compression-like speed.** Compression is incompatible with cheap persistence (§3, `senior.md`). Whether a fully persistent DSU can achieve `o(log n)` per operation in the pointer machine is not fully settled; current persistent and rollback structures sit at `Θ(log n)`.

2. **Concurrent DSU optimal bounds.** Jayanti, Tarjan & Boix-Adserà (2019) gave concurrent union-find with provable amortized bounds; whether the sequential `α(n)` is matchable under linearizable concurrency with `p` processors, and the exact dependence on `p`, remains an active area.

3. **Decremental / fully-dynamic connectivity.** DSU handles only *incremental* (union-only) connectivity. Fully dynamic connectivity with edge deletions has `O(log² n / log log n)`-ish bounds (Holm–de Lichtenberg–Thorup; Wulff-Nilsen); closing the gap to the incremental `α(n)` is open.

4. **Beating the cell-probe lower bound in restricted models.** Gabow–Tarjan's `O(m)` offline result shows structure helps; characterizing exactly which restrictions permit linear time is ongoing.

5. **Tight constants for the variants.** While Tarjan–van Leeuwen settled the asymptotics, the *exact* optimal constant for the `α(n)` bound, and which compression × union pair minimizes it, is still refined in subsequent work (e.g., the "linking by index/coin-flipping" analyses).

---

## 11. Summary

- **Formally**, all three compression rules only ever re-point a node to one of its current ancestors (Lemma 2.1), which makes them partition-preserving (Theorem 2.2) and depth-non-increasing (Corollary 2.4).
- **Compression alone** with arbitrary union is `Θ(log n)` amortized; with union-by-size analyzed separately it is `Θ(log n / log log n)`. Neither reaches inverse-Ackermann.
- **Compression + union-by-rank, analyzed jointly**, is `Θ(α(m,n))` (Tarjan 1975), and this is **optimal** in the pointer-machine / cell-probe model (Tarjan 1979, Fredman–Saks 1989). The `α(n)` factor is intrinsic, not removable.
- **The inverse Ackermann function** `α(n) ≤ 4` for every input that can physically exist, so the bound is "constant for all practical purposes" while being provably non-constant.
- **All three variants share the same asymptotics**; they differ only in constants and engineering properties — full is two-pass and recursion-prone, halving and splitting are one-pass, recursion-free, and concurrency-friendly (splitting especially).
- **Cache behavior** is where compression's value is most visible: it collapses a chain of dependent cache misses into a single load.
- The canonical references: Tarjan (1975) for the upper bound, Tarjan & van Leeuwen (1984) for the variant analysis, Fredman & Saks (1989) for the lower bound, and CLRS Chapter 21 for the textbook treatment. See sibling `03-union-by-rank` for the union side of the joint proof.
