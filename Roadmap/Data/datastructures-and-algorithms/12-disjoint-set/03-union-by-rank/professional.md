# Union by Rank — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness — Partition Invariant and the Rank-Height Bound
3. The `O(log n)` Height Bound for Union-by-Rank Alone
4. The `O(α(n))` Combined Bound (Tarjan & van Leeuwen)
5. The Tight Lower Bound `Ω(α(n))`
6. Cache & Memory Layout
7. Average-Case / Randomized Linking
8. Space–Time Trade-offs: rank byte vs size int
9. Comparison with Alternatives
10. Open Problems
11. Summary

---

## 1. Formal Definition

Let `U = {0, 1, …, n−1}` be a universe of elements. A **disjoint-set forest** maintains a partition of `U` into blocks, represented by a parent function `parent : U → U`. Each block is a rooted tree; `x` is a **root** iff `parent(x) = x`. Define

```
find(x) = the unique root reachable from x by iterating parent.
```

**Definition 1.1 (Operations).**
- `makeset(x)`: `parent(x) := x`.
- `find(x)`: return the root of `x`'s tree.
- `union(x, y)`: let `rx = find(x)`, `ry = find(y)`; if `rx ≠ ry`, set `parent` of one root to the other (a *link*).

**Definition 1.2 (Rank).** Maintain `rank : U → ℕ`, with `rank(x) := 0` at `makeset`. The **union-by-rank** link rule for distinct roots `rx, ry`:

```
if    rank(rx) < rank(ry):  parent(rx) := ry
elif  rank(rx) > rank(ry):  parent(ry) := rx
else:                       parent(ry) := rx;  rank(rx) := rank(rx) + 1
```

**Definition 1.3 (Size).** Maintain `size : U → ℕ₊`, `size(x) := 1` at `makeset`. The **union-by-size** link rule for distinct roots, with `size(rx) ≥ size(ry)` (swap otherwise):

```
parent(ry) := rx;   size(rx) := size(rx) + size(ry)
```

**Definition 1.4 (Path compression).** During `find(x)`, after locating the root `r`, set `parent(z) := r` for every `z` on the path from `x` to `r`. (Variants: path halving / path splitting set each `parent(z) := parent(parent(z))`.)

The **standard optimized DSU** uses Definition 1.2 (or 1.3) together with Definition 1.4.

**Convention on rank under compression.** Ranks are **never decreased**. After a compression, `rank(x)` may strictly exceed the true height of the subtree at `x`. We henceforth treat `rank` as an abstract label satisfying the invariants of §2, *not* as the exact height.

---

## 2. Correctness — Partition Invariant and the Rank-Height Bound

### 2.1 Partition invariant

**Invariant `P`.** At all times the relation `x ≡ y ⟺ find(x) = find(y)` is an equivalence relation whose classes are exactly the maintained blocks.

**Proof.** `makeset` creates singleton classes (reflexive). `find` follows a functional parent chain in a finite forest with self-loops only at roots, so it terminates at a unique root; thus `≡` is well-defined and an equivalence relation (reflexive, symmetric, transitive via the shared root). `union(x,y)` links two roots, merging exactly the two classes of `x` and `y` and leaving all others untouched; a no-op when `find(x)=find(y)`. Path compression re-points nodes to their existing root, so `find` values are unchanged and `P` is preserved. ∎

### 2.2 Rank monotonicity invariants

The following are maintained by union-by-rank **with or without** path compression. Let `t` index time.

**Invariant `R1` (root ranks only rise).** For every element `x`, `rank(x)` is non-decreasing over time, and once `x` becomes a non-root it never becomes a root again, after which `rank(x)` is frozen.

*Proof.* `rank` is written only by the tie case of Def. 1.2, which increments. A node becomes a non-root only when linked under another root; the forest only ever adds links between roots, so a non-root stays a non-root, and its rank is never touched again. ∎

**Invariant `R2` (strict increase along parent edges).** If `parent(x) ≠ x` then `rank(parent(x)) > rank(x)`, and this strict inequality persists.

*Proof.* When `x` is linked under `y` it is because `rank(y) ≥ rank(x)`; in the equal case `rank(y)` is then incremented, giving `rank(y) > rank(x)` at the moment of linking. By `R1`, `rank(x)` is frozen thereafter while `rank(parent-side ancestors)` can only rise, so the inequality persists. Path compression sets `parent(x)` to an *ancestor* of the old parent, which by transitivity of `R2` has strictly larger rank than `x`; hence the inequality is preserved (indeed strengthened). ∎

**Corollary 2.3 (Rank upper-bounds height).** Along any root-to-leaf path, ranks strictly decrease by `R2`. Hence the height of a tree is at most the rank of its root. (Without compression this is tight up to the bound of §3; with compression heights can be far smaller, but the inequality `height ≤ rank(root)` still holds.) ∎

This corollary is *why we never repair ranks*: every analysis below needs only `R1`, `R2`, and the counting bound of §3 — all of which survive compression untouched.

---

## 3. The `O(log n)` Height Bound for Union-by-Rank Alone

We bound rank, hence height, in the **compression-free** forest.

**Lemma 3.1 (Subtree-size lower bound).** In a union-by-rank forest **without path compression**, any node `x` with `rank(x) = r` is the root of a subtree containing at least `2^r` nodes.

**Proof (induction on time / on `r`).**
*Base.* At `makeset`, `rank = 0` and the subtree has `1 = 2^0` node.
*Step.* `rank(x)` becomes `r` only via the tie case: two roots `x` and `y`, both of rank `r−1`, are linked (`y` under `x`), and `rank(x)` is set to `r`. By the inductive hypothesis each subtree had `≥ 2^{r−1}` nodes, so the merged subtree at `x` has `≥ 2^{r−1} + 2^{r−1} = 2^r` nodes. A non-tie link does not change `rank(x)` and only *adds* nodes beneath `x`, preserving the bound. ∎

**Theorem 3.2 (Maximum rank).** In a forest of `n` elements built by union-by-rank, every rank satisfies `r ≤ ⌊log₂ n⌋`.

**Proof.** By Lemma 3.1 a node of rank `r` commands `≥ 2^r` distinct nodes, all in `U`, so `2^r ≤ n`, giving `r ≤ ⌊log₂ n⌋`. ∎

**Corollary 3.3 (Operation cost).** Without compression, every tree has height `≤ ⌊log₂ n⌋` (Cor. 2.3 + Thm 3.2), so `find` and therefore `union` run in `O(log n)` worst case. The symmetric statement holds for union-by-size, replacing "rank `r` ⇒ `≥ 2^r` nodes" with "a node at depth `d` lies in a tree whose size at least doubled `d` times," again giving height `≤ ⌊log₂ n⌋`. ∎

**Remark 3.4.** Lemma 3.1's exact form (`size ≥ 2^rank`) holds only **without** compression. Compression can shrink a subtree while leaving the root's rank fixed, so afterward `size ≥ 2^rank` may fail. What survives is the weaker, sufficient fact used everywhere downstream: **ranks are bounded by `⌊log₂ n⌋` and strictly increase along parent edges** (`R2`, Thm 3.2). These two facts are *time-stable* because Thm 3.2's argument can be re-run at the moment each rank value is *created* (a tie among compression-free-or-not roots still merges two rank-`(r−1)` roots, each of which — by `R1` — acquired rank `r−1` at a time when it dominated `≥ 2^{r−1}` distinct elements that were assigned to it and never reassigned). The standard treatment (CLRS Lemma 21.x) formalizes this as: **at most `⌊n / 2^r⌋` nodes ever attain rank `r`.**

**Lemma 3.5 (Rank-class population, CLRS).** For each `r ≥ 0`, at most `⌊n / 2^r⌋` elements ever have rank exactly `r`, *including* under path compression.

**Proof idea.** When an element first reaches rank `r`, "charge" to it the `≥ 2^r` elements that were in its subtree at that instant (Lemma 3.1 applied at creation time, before any later compression). By `R1` an element's rank, once frozen as a non-root, never changes, and distinct rank-`r` creations charge disjoint element sets. Hence the number of rank-`r` elements times `2^r` is at most `n`. ∎

Lemma 3.5 is the bridge that lets the `O(α(n))` analysis of §4 tolerate compression.

---

## 4. The `O(α(n))` Combined Bound (Tarjan & van Leeuwen)

### 4.1 The inverse Ackermann function

Define the Ackermann-style hierarchy (one common normalization):

```
A_0(j)     = j + 1
A_{k+1}(j) = A_k^{(j+1)}(j)        # A_k applied j+1 times to j
```

`A_k` grows explosively in `k`: `A_1(j) ≈ 2j`, `A_2(j) ≈ 2^{j}·(j+1)`, `A_3` is tower-of-twos territory, `A_4` is beyond astronomical. The **inverse Ackermann function** is

```
α(n) = min { k ≥ 0 : A_k(1) ≥ n }   (one standard single-argument form).
```

Because `A_4(1)` already exceeds `2^{2^{2^{2^{16}}}}`, we have **`α(n) ≤ 4` for every `n ≤ 2^{2^{2^{2^{16}}}}`** — i.e. for any `n` that could be represented in the observable universe. Thus `α(n)` is, for engineering purposes, a constant `≤ 4`.

### 4.2 The theorem

**Theorem 4.1 (Tarjan 1975; Tarjan & van Leeuwen 1984).** A sequence of `m` `find`/`union` operations on `n` elements, using **union by rank (or size) together with path compression** (or path halving / splitting), runs in total time

```
O( (m + n) · α(m + n, n) )   =   O( (m + n) · α(n) ),
```

i.e. **`O(α(n))` amortized per operation**. The same holds for path halving and path splitting; it holds for "union by rank" and "union by size," and for any linking-by-index rule that keeps ranks satisfying `R1`,`R2`,Lemma 3.5.

### 4.3 Proof structure: the rank / level / iter potential

We sketch the canonical amortized argument (CLRS / Tarjan), which is the part to internalize.

**Setup.** Fix the final maximum rank; by Thm 3.2 / Lemma 3.5 all ranks are in `[0, ⌊log₂ n⌋]`. Each `find(x)` walks `x → parent(x) → … → root`, then compresses. We pay `O(1)` for each node on the path; total work is `O(path length)` summed over all finds. The whole game is bounding `Σ path length`.

**Two functions on non-root nodes** (with `p(x) := parent(x)`), defined using the *frozen* ranks (legitimate by `R1`):

- **`level(x)`** = the largest integer `k` such that `rank(p(x)) ≥ A_k(rank(x))`. It measures "how explosively bigger the parent's rank is." `level(x) ∈ {0, 1, …, α(n)}`, because once `k` reaches `α(n)` we have `A_k(rank(x)) ≥ A_{α}(1) ≥ n > rank(p(x))` is impossible, capping `level`.
- **`iter(x)`** = the largest `i` such that applying `A_{level(x)}` `i` times to `rank(x)` still does not exceed `rank(p(x))`. It refines `level`. `iter(x) ∈ {1, …, rank(x)}`.

**Potential function.** Assign each non-root node `x` the potential

```
Φ(x) = ( α(n) − level(x) ) · rank(x)  −  iter(x).
```

Roots and rank-0 nodes get a fixed `Φ = α(n)·rank(x)`. One verifies `0 ≤ Φ(x) ≤ α(n)·rank(x)`.

**Key monotonicity lemma.** Whenever a node `x` is *not* the root and *not* a child of the root, and a `find` passes through it and compresses it, **`p(x)` is replaced by a strictly higher-rank ancestor**. This either (a) strictly increases `level(x)`, or (b) keeps `level(x)` fixed but strictly increases `iter(x)`. Either way **`Φ(x)` strictly decreases by at least 1.** (This is the heart of the proof: each compressed node "pays for itself" out of its own potential.)

**Charging / bucketing argument.** Consider one `find` of path length `L`. Mark the nodes on the path:
- The root and the child of the root: at most `2` nodes — charge to the operation, `O(1)` each.
- For the remaining `L − 2` interior nodes, **bucket them by `level(x) ∈ {0,…,α(n)}`**. Within each level bucket, at most one node per *distinct rank value* can be charged to the operation directly; all the others have the property above and hence **each pays one unit of its own `Φ`**, which strictly drops. Since there are `α(n)+1` levels and ranks lie in `[0, log n]`, the number of nodes charged to the *operation* is `O(α(n))`; every other node on the path is charged to its own potential decrease.

**Accounting.** Total cost = `Σ_ops O(α(n))` (direct charges) + `Σ_nodes (total decrease in Φ over all time)`. The initial total potential is `O(n · α(n) · log n)`... and here the *bucketing by level* is exactly what tightens this to `O((m+n)·α(n))`: the careful version (CLRS Thm 21.14) shows the amortized cost per operation is `O(α(n))`, not `O(α(n) log n)`, because `Φ` decreases are bounded by the number of *level/iter* refinements, of which there are `O(α(n))` per node across its lifetime. Summing gives

```
Total = O( (m + n) · α(n) ).  ∎ (structure)
```

**Reader's takeaway.** The proof needs three time-stable facts about ranks: they start at 0, strictly increase along parent edges (`R2`), and obey the population bound (Lemma 3.5). All three survive path compression *because we never decrease ranks* — which is precisely the justification for the "don't fix ranks" rule stated informally at junior/middle level.

---

## 5. The Tight Lower Bound `Ω(α(n))`

The `O(α(n))` bound is **not** an artifact of a weak analysis — it is essentially optimal.

**Theorem 5.1 (Tarjan 1979; Cell-probe / pointer-machine lower bound).** In the **separable pointer machine** model, any algorithm for the disjoint-set-union problem requires `Ω(m · α(m, n))` time on some sequence of `m` operations over `n` elements. Hence amortized `Ω(α(n))` per operation; **no pointer-machine DSU can be amortized `O(1)`.**

**Theorem 5.2 (Fredman & Saks 1989; cell-probe model).** In the cell-probe model with words of `O(log n)` bits, the union-find problem (and the closely related list-splitting / partial-sums problems) requires `Ω(α(n))` amortized time per operation. This strengthens Theorem 5.1 to a model that permits arbitrary computation on machine words, ruling out clever bit-tricks as a route to `O(1)`.

**Consequences.**
- The Tarjan–van Leeuwen `O(α(n))` upper bound is tight to within constant factors in both the pointer-machine and cell-probe models.
- `O(1)` amortized union-find is **impossible** in these standard models; the inverse Ackermann factor is intrinsic to the problem, not to the algorithm.
- (Caveat) In *restricted* settings — e.g. the **incremental / interval union-find** of Gabow & Tarjan (1985), where the union structure is known in advance to be a tree of intervals — `O(1)` *is* achievable, because the lower bound's adversary cannot be realized. The general bound stands.

---

## 6. Cache & Memory Layout

DSU is dominated by random access into `parent[]`, so memory behavior matters as much as the `α(n)` factor.

- **Array-of-structs vs struct-of-arrays.** Keeping `parent[]`, `rank[]`/`size[]` as *separate* arrays (SoA) is usually better: `find` touches only `parent[]` on the hot path, so it streams one array; `union` touches the balancing array only at the two roots. Interleaving `{parent, rank}` per element (AoS) wastes a cache line during compression-heavy `find`.
- **Compression improves locality over time.** Path halving/splitting shorten chains, so later `find`s touch fewer, hotter cache lines. This is a *practical* reason halving often beats full compression: it compresses incrementally with one pass and no second walk.
- **Rank as a byte.** `rank ≤ ⌊log₂ n⌋ ≤ 64`, so a `uint8` `rank[]` is exact for any conceivable `n`, packing 64 ranks per cache line — negligible footprint and great locality.
- **False sharing in concurrent DSU.** Two cores updating ranks/sizes of roots that share a cache line contend. Pad or shard hot roots; or use union-by-random (§7) to avoid mutable balancing fields entirely.

---

## 7. Average-Case / Randomized Linking

**Union by random index ("union by rank-less linking").** Assign each element an independent uniform priority `π(x) ∈ [0,1)` at `makeset`; on union, the root with the **larger `π`** becomes the parent. No mutable `rank`/`size` is needed.

**Theorem 7.1.** With random-priority linking (no compression), the expected height of any tree on `k` nodes is `O(log k)`; more precisely the structure is distributed like a random binary-search-tree / treap, giving expected depth `≈ 2 ln k` and `O(log k)` with high probability.

**Why it matters.** Random linking removes the read-modify-write on `rank`/`size` during `union`, which is the chief source of CAS contention in lock-free DSU (§ senior). The cost is that the height bound is *expected*, not worst-case, and you lose free component sizes. Combined with path compression, randomized linking also achieves `O(α(n))` *expected* amortized (Goel, Khanna, Larkin, Tarjan, 2014, analyze randomized linking + splitting and show near-optimal bounds).

**Average-case under random unions.** If the union sequence itself is random (uniform pair each step), even *naive* linking yields `O(log n)` expected height; balancing's worst-case guarantee is what protects against *adversarial* sequences, which is what the `Ω(α(n))` lower bound exploits.

---

## 8. Space–Time Trade-offs: rank byte vs size int

| Field | Width that suffices | Bytes for `n=10⁹` | Extra capability |
|-------|--------------------|--------------------|------------------|
| `parent` | `int32` (`n < 2³¹`) | 4 GB | required |
| `rank` | `uint8` (max ~64) | 1 GB | none beyond balancing |
| `size` | `int32` (`n < 2³¹`) or `int64` | 4–8 GB | component cardinality, "largest component," percolation, weighted merges |

- **Union by rank** total ≈ `5n` bytes; **union by size** ≈ `8n` (or `12n` with 64-bit sizes).
- **Both yield identical asymptotics** (`O(α(n))`): the choice is purely memory-vs-features.
- **Overflow note.** `rank` never overflows a `uint8`. `size` sums can overflow `int32` once `n > 2³¹`; use `int64` for huge universes.
- **Time is identical to first order** — the balancing array is read at two roots per union and written at one; neither dominates the `find` cost.

Rule: **prefer size unless you are memory-bound**, since the marginal `3n` bytes buy a metric you frequently need anyway.

---

## 9. Comparison with Alternatives

| Scheme | `find` worst case | `find` amortized | `union` | Extra space | Bound type |
|--------|-------------------|------------------|---------|-------------|-----------|
| Naive link, no compress | `O(n)` | `O(n)` | `O(n)` | 0 | worst |
| Union by rank/size, no compress | `O(log n)` | `O(log n)` | `O(log n)` | `n` (byte/int) | worst |
| Path compression, no balancing | `O(n)` | `O(log n)` | `O(log n)` am. | 0 | amortized |
| **Rank/size + compression** | `O(log n)` | **`O(α(n))`** | `O(α(n))` am. | `n` | amortized, **optimal** |
| Random link + splitting | `O(log n)` exp. | `O(α(n))` exp. | `O(α(n))` exp. | 0 | expected, optimal |
| Interval union-find (Gabow–Tarjan) | — | `O(1)` | `O(1)` | `O(n)` | amortized (restricted) |

Path compression *without* balancing already gives amortized `O(log n)` (Tarjan & van Leeuwen show `Θ(log n)` amortized for compression-only); it is the *combination* with rank/size that drops the exponent to `α(n)`.

---

## 10. Open Problems

1. **Exact constants.** The precise constant in front of `α(n)` differs between full compression, path halving, and path splitting; pinning down the optimal linking+compression pairing's constant factor is still refined in the literature (Patwary, Blelloch, et al., experimental; Goel–Khanna–Larkin–Tarjan, theoretical).
2. **Persistence with optimal bounds.** Fully-persistent or confluently-persistent union-find with `O(α(n))` per operation and small space is not fully resolved; the rollback variant gives `O(log n)` without compression.
3. **Deletions.** Union-find with element/edge **deletions** (true dynamic connectivity with deletions) cannot use plain DSU; the best general structures are `O(log² n)`-ish (Holm–de Lichtenberg–Thorup). Whether DSU-like `α(n)` bounds are reachable with deletions in restricted models is open.
4. **Parallel / concurrent optimality.** The exact span/work trade-off for wait-free concurrent union-find matching the sequential `α(n)` work bound is an active area (Jayanti–Tarjan–Boix-Adserà give wait-free analyses; optimality questions remain).
5. **Lower bounds in richer models.** Whether `Ω(α(n))` is unavoidable in models stronger than cell-probe (with structured parallelism or nonstandard word operations) is not fully settled.

---

## 11. Summary

- **Rank** is a non-decreasing label satisfying: starts at 0; strictly increases along parent edges (`R2`); at most `⌊n/2^r⌋` elements ever reach rank `r` (Lemma 3.5). These are the *only* facts the complexity proofs use, and all three survive path compression — which is exactly why **ranks are never decremented** even though they over-estimate height after compression.
- **Alone**, union by rank/size bounds height by `⌊log₂ n⌋` (Lemma 3.1: a rank-`r` root commands `≥ 2^r` nodes), giving worst-case `O(log n)`.
- **Combined** with path compression, the **Tarjan–van Leeuwen** theorem gives amortized `O(α(n))` per operation, proved by the rank/level/iter potential with a level-bucketing charging argument — effectively constant since `α(n) ≤ 4` for any physical `n`.
- The bound is **tight**: Tarjan (1979, pointer machine) and Fredman–Saks (1989, cell-probe) prove `Ω(α(n))` amortized, so `O(1)` union-find is impossible in standard models.
- **Rank vs size** are asymptotically identical; size costs ~`3n` more bytes but yields component cardinalities and merges cleanly in distributed settings. **Random linking** trades worst-case for expected bounds and removes mutable balancing fields, easing concurrency.

Key references: Tarjan (1975) "Efficiency of a good but not linear set union algorithm"; Tarjan & van Leeuwen (1984) "Worst-case analysis of set union algorithms"; Tarjan (1979) lower bound; Fredman & Saks (1989) "The cell probe complexity of dynamic data structures"; CLRS Chapter 21; Goel, Khanna, Larkin & Tarjan (2014) on randomized linking.
