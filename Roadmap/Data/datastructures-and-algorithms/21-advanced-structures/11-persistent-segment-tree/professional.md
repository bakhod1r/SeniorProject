# Persistent Segment Tree — Mathematical Foundations and Complexity Theory

> **Read time: ~55 minutes** · **Audience:** Engineers and competitors who want the *proofs*: why path copying costs exactly Θ(log n) nodes per update, the precise total-space derivation, a correctness proof of the k-th descent, the **fat-node** method for full persistence with its O(1)-amortized-space bound, and a rigorous complexity comparison against wavelet/merge-sort trees.

This file is the formal capstone. We prove the structural and complexity claims that earlier files asserted: that an update creates `⌈log₂ n⌉ + 1` new nodes (no more, no less), that total space after `m` updates is `Θ(n + m log n)`, that the two-version descent correctly returns the k-th order statistic, and that the **fat-node** transformation gives full persistence at O(1) amortized space and O(log m) read overhead per node. We close with cache-oblivious notes and a deterministic-vs-randomized comparison.

---

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Path-Copying Cost — Θ(log n) New Nodes per Update (Proof)](#path-copying-proof)
3. [Total Space Complexity Derivation](#space-derivation)
4. [Worked Numeric Verification of the Bounds](#worked)
5. [Correctness of the K-th Descent (Loop Invariant)](#kth-correctness)
6. [Correctness of the Subtraction (Linearity Lemma)](#subtraction-lemma)
7. [Full Persistence — The Fat-Node Method](#fat-nodes)
8. [Amortized Analysis of Fat Nodes (Potential Method)](#amortized)
9. [Randomized & Expected-Cost View](#randomized)
10. [Cache-Oblivious / I/O Analysis](#cache)
11. [Comparison with Alternatives (Formal)](#comparison)
12. [Lower Bounds and What Persistence Cannot Cheat](#lower-bounds)
13. [Summary](#summary)

---

<a name="formal-definition"></a>
## 1. Formal Definition

A **partially persistent segment tree** over a monoid `(M, ⊕, e)` (identity `e`) on index universe `[0, n)` is a sequence of immutable rooted binary trees `T_0, T_1, …, T_m`, each a *full segment tree* on `[0, n)`:

```
Each T_t is a set of nodes. A node u has:
  • a range  range(u) = [lo(u), hi(u)]   (derivable by recursion, not stored)
  • a value  val(u) ∈ M = ⊕ over array entries in range(u) for version t
  • children left(u), right(u) splitting [lo,hi] at mid = ⌊(lo+hi)/2⌋ (null iff lo=hi)

Roots:   root(T_t) addresses version t;  pick(t) = root(T_t) is O(1).
Update:  upd(t, i, δ) produces T_{t+1} that equals T_t except a[i] ⊕= δ.
Invariant I:  for every node u, val(u) = ⊕_{j ∈ range(u)} a_t[j]   (aggregate consistency).
Sharing:  if a subtree's underlying array slice is identical across T_t and T_{t+1},
          the two trees reference the SAME physical node (structural sharing).
```

Partial persistence: `upd` may only extend the *latest* version (`t = m`). Reads `query(t, l, r)` are permitted for any `t ∈ [0, m]`.

### 1.0 Version-indexed semantics

Formally, let `a_t ∈ M^n` denote the logical array at version `t`. The structure maintains the function

```
val : Nodes × {0,…,m} → M,   val(u, t) = ⊕_{j ∈ range(u)} a_t[j],
```

but stores it *sparsely*: a node object `u` physically created at version `t₀` holds `val(u, t₀)`, and it is referenced by every version `t ≥ t₀` for which `range(u)`'s slice of the array is unchanged. The roots index recovers any version's view: `query(t, l, r)` is the ordinary segment-tree fold starting from `root(T_t)`. Correctness of partial persistence reduces to a single invariant: **a node reachable from `root(T_t)` stores `val(·, t)`** — which holds because path copying re-creates exactly the nodes whose `val(·, t)` differs from `val(·, t−1)`.

### 1.1 The monoid requirement

The aggregate must form a **monoid** `(M, ⊕, e)`: `⊕` associative with identity `e`. Associativity is required because the tree groups children left-to-right; the query trichotomy combines partial results in a fixed parenthesization that must equal the linear fold over the segment. Commutativity is **not** required — the tree preserves index order, so non-commutative `⊕` (matrix product, string concatenation) is permitted. For the k-th application the monoid is `(ℤ≥0, +, 0)` (counts), which is a commutative monoid; subtraction is well-defined because counts live in a **group** `(ℤ, +, 0)`, and it is precisely the group structure (invertibility) that licenses `version[r] − version[l−1]`. This is why *sum/count* aggregates support the prefix-difference trick while *min/max* (a monoid but not a group) do **not** — you cannot subtract two minima to get the minimum of a sub-range.

### 1.2 Why min/max needs the full descent, not subtraction

A consequence worth stating formally: for a non-invertible monoid like min, `version[r]` and `version[l−1]` cannot be subtracted to isolate `a[l..r]`. Order statistics on a min-aggregate would instead need the *range* query to descend with the trichotomy on the position axis (an ordinary range-min on a chosen version), which persistence still supports per version — but the *k-th-by-value* trick specifically requires the additive (group) structure of counts. Keep this distinction crisp: **persistence is monoid-generic; the k-th subtraction trick is group-specific.**

---

<a name="path-copying-proof"></a>
## 2. Path-Copying Cost — Θ(log n) New Nodes per Update (Proof)

**Theorem 1.** Let `T` be a segment tree on `[0, n)` of height `h = ⌈log₂ n⌉`. A point update at index `i` via path copying allocates exactly `h + 1` new nodes (the root-to-leaf path to the leaf covering `i`), and no others. Hence the number of new nodes is `Θ(log n)`.

**Proof.**
Define the update recursion `U(u, lo, hi, i, δ)` returning a new node:

```
U(u, lo, hi, i, δ):
  if lo = hi:                       allocate leaf u'  (1 node)
      return u'
  mid = ⌊(lo+hi)/2⌋
  if i ≤ mid:  c = U(left(u), lo, mid, i, δ);   u' = node(c, right(u))
  else:        c = U(right(u), mid+1, hi, i, δ); u' = node(left(u), c)
  return u'                          (1 node)
```

Let `N(lo, hi)` be the number of allocations `U` performs on a range of width `w = hi − lo + 1`.

- **Base case** `w = 1` (`lo = hi`): exactly **1** allocation (the leaf). `N(1) = 1`.
- **Inductive step** `w > 1`: `U` allocates **1** node (`u'`) and recurses into **exactly one** child (the side containing `i`). The chosen child has width `⌈w/2⌉` or `⌊w/2⌋`, each ≤ `⌈w/2⌉`. The *other* child is shared (0 allocations). Thus `N(w) = 1 + N(w')` with `w' ≤ ⌈w/2⌉`.

Unrolling: the width halves each step, so the recursion has depth equal to the height of the path from the root range `[0, n)` to the leaf, which is exactly `⌈log₂ n⌉`. Therefore

```
N(n) = 1 + 1 + … + 1   (one per level, root level through leaf level)
     = (⌈log₂ n⌉)  +  1   =  h + 1.
```

Each allocated node does O(1) work (set value + two child pointers, one inherited). Lower bound: every node on the path *must* be re-allocated because its `val` changes (its range contains `i`), and an immutable structure cannot modify the old node — so at least `h+1` allocations are necessary. Hence the count is **exactly** `h + 1 = Θ(log n)`. ∎

**Corollary.** Update time is `Θ(log n)` (allocations dominate; each is O(1)). Query time is `Θ(log n)` by the standard segment-tree argument (≤ `4⌈log₂ n⌉` nodes visited), unchanged by persistence since it only follows pointers.

---

<a name="space-derivation"></a>
## 3. Total Space Complexity Derivation

**Theorem 2.** After building `T_0` and performing `m` updates, the total number of allocated nodes is

```
S(n, m) = |T_0| + Σ_{t=1}^{m} (h_t + 1)
        = (2n − 1) + m·(⌈log₂ n⌉ + 1)
        = Θ(n + m log n).
```

**Proof.**
`T_0` is a full segment tree on `n` leaves: a binary tree with `n` leaves and `n − 1` internal nodes has `2n − 1` nodes (for non-powers of two the ragged tree has ≤ `2n − 1` ≤ `4n` nodes; we use the tight `2n − 1` for the balanced case and `O(n)` in general). By **Theorem 1**, each of the `m` updates adds exactly `⌈log₂ n⌉ + 1` nodes, none reclaimed (partial persistence keeps all versions). Summation gives the stated total. Asymptotically `Θ(n + m log n)`. ∎

**Two regimes.**
- **m = Θ(n)** (e.g., one version per array element — the k-th application): `S = Θ(n log n)`.
- **Lazy-empty optimization:** if `T_0` is all-`e` (empty), share a single sentinel for every all-`e` subtree and split only on first insert. Then `T_0` costs `O(1)` and the first insert into a fresh path still costs `h+1`, giving `S = Θ(m log n)` — the `n` term vanishes. This is the standard contest optimization and the basis of the senior arena.

**Comparison to naive full-copy.** Copying the whole tree per version costs `Σ |T_t| = Θ(n·m)`. The ratio is `Θ(n·m) / Θ(m log n) = Θ(n / log n)` — for `n = 10^6`, about `5·10^4×` more memory. Path copying's advantage is precisely this `n / log n` factor.

### 3.0 Growth shape: linear-with-log slope

The total node count `S(m) = (2n−1) + m(⌈log₂ n⌉ + 1)` is **affine** in `m`: a constant intercept `2n−1` (the initial tree) plus a constant slope `⌈log₂ n⌉ + 1` per version. This is the defining advantage — adding a version costs a *fixed* `log n` nodes regardless of `m`, so memory grows predictably and you can size capacity exactly (senior §12). Contrast the naive full-copy whose slope is `2n` per version (steeper by a factor of `n/log n`):

```
nodes
  ^
  |                                  naive: slope 2n  /
  |                                                  /
  |                                                 /
  |                            path-copy: slope log n
  |                       _____________----------
  | 2n ___---------
  +----------------------------------------------> versions m
```

Both are linear in `m`, but the slopes differ by `n/log n`. That single ratio is the entire reason the structure exists.

### 3.1 Build-of-`T_0` via the recursion tree / Master theorem

Building version 0 alone obeys

```
B(n) = 2·B(n/2) + Θ(1)        # two recursive builds + O(1) to make the node
```

With `a = 2, b = 2, f(n) = Θ(1) = Θ(n^{log_b a − ε}) = Θ(n^{1−ε})`, this is **Master-theorem Case 1**, giving `B(n) = Θ(n^{log_2 2}) = Θ(n)`. So building the initial tree is linear; the `log n` factor in the *total* space comes solely from the `m` subsequent path-copying updates, not from the build. This cleanly separates the two cost sources: `Θ(n)` build + `Θ(m log n)` updates = `Θ(n + m log n)`.

### 3.2 Per-operation complexity summary

| Operation | Time | New nodes | Reads-only? |
|---|---|---|---|
| Build `T_0` | `Θ(n)` | `Θ(n)` | — |
| Point update → new version | `Θ(log n)` | `⌈log₂ n⌉ + 1` | no (allocates) |
| Range aggregate query (one version) | `Θ(log n)` | `0` | yes |
| Order-statistic (k-th) query | `Θ(log n)` | `0` | yes |
| Switch version | `Θ(1)` | `0` | yes |
| Total, `m` updates | — | `Θ(n + m log n)` | — |

---

<a name="worked"></a>
## 4. Worked Numeric Verification of the Bounds

Theorems are easier to trust after a concrete count. Take `n = 8` (a power of two, so `h = log₂ 8 = 3`), value axis `[0, 7]`, building **one version per inserted element** (`m = 8`), lazy-empty version 0.

**Per-update allocation (Theorem 1).** Each insert walks root `[0,7]` → `[0,3]` or `[4,7]` → … → a leaf: that is levels `[0,7], [0,3], [0,1], [0,0]` — **4 nodes** `= h + 1 = 3 + 1`. ✓ Every single insert, regardless of which leaf, allocates exactly 4.

**Total nodes (Theorem 2, lazy-empty).**

```
version 0: 1 sentinel node
inserts 1..8: 8 × 4 = 32 new nodes
total = 1 + 32 = 33 nodes
```

Compare the **non-lazy** build: `T_0` full tree = `2·8 − 1 = 15` nodes, plus `8 × 4 = 32` → `47`. And the **naive full-copy**: `Σ_{t=0}^{8} |T_t| = 9 × 15 = 135` nodes — already 3–4× larger at `n=8`, and the gap grows like `n / log n`.

**Scaling check at `n = m = 10^6`** (`h = 20`):

```
lazy-empty total ≈ m·(h+1) = 10^6 × 21 = 2.1·10^7 nodes
non-lazy total   ≈ 2n + m·(h+1) = 2·10^6 + 2.1·10^7 ≈ 2.3·10^7 nodes
naive full-copy  ≈ m·2n = 10^6 × 2·10^6 = 2·10^12 nodes
ratio (naive / path) ≈ 2·10^12 / 2.1·10^7 ≈ 9.5·10^4 ≈ n / log n = 10^6 / 20 = 5·10^4
```

The measured ratio matches the predicted `Θ(n / log n)` factor (within the constant from `2n` vs `2nm` exact counts). This is the empirical face of Theorem 2.

---

<a name="kth-correctness"></a>
## 5. Correctness of the K-th Descent (Loop Invariant)

**Setup.** Value axis compressed to ranks `[0, D)`. `version[i]` is a count tree where `cnt(u, i) = #{ j ≤ i : rank(a_j) ∈ range(u) }`. For a query `(l, r, k)` define, for any node `u`,

```
c(u) = cnt(u, r) − cnt(u, l−1) = #{ j ∈ [l, r] : rank(a_j) ∈ range(u) }.
```

This is well-defined and additive because counts are linear in the version index and corresponding nodes of `version[l−1]` and `version[r]` cover the same `range(u)` (§2.4 of middle.md).

**Algorithm.**
```
KTH(uL, uR, lo, hi, k):           # uL ∈ version[l−1], uR ∈ version[r], same range
  if lo = hi: return lo
  mid = ⌊(lo+hi)/2⌋
  L = cnt(left(uR)) − cnt(left(uL))      # = c(left node)
  if k ≤ L:  return KTH(left(uL),  left(uR),  lo,    mid, k)
  else:      return KTH(right(uL), right(uR), mid+1, hi,  k − L)
```

**Claim.** `KTH` returns the rank `g` such that `value[g]` is the k-th smallest element of `a[l..r]`, for all `1 ≤ k ≤ c(root) = r − l + 1`.

**Invariant I.** At every call `KTH(uL, uR, lo, hi, k)`, the k-th smallest element of `a[l..r]` whose rank lies in `[lo, hi]` is the overall k-th smallest of `a[l..r]`, **and** `1 ≤ k ≤ c(node covering [lo,hi])`.

**Base case (top call).** `[lo, hi] = [0, D−1]` covers all ranks; `c(root) = r−l+1 ≥ k ≥ 1` by the query precondition. So I holds.

**Inductive step.** Assume I at `(lo, hi, k)`. Let `L = c(left child)` = number of elements of `a[l..r]` with rank in `[lo, mid]`. The `c(left)+c(right)` elements of `a[l..r]` in `[lo,hi]`, listed in increasing rank, place all `L` left-half elements before any right-half element.
- If `k ≤ L`: the k-th of them lies in the left half, and its position among left-half elements is still `k`. So recursing with `(left, lo, mid, k)` preserves I (and `1 ≤ k ≤ L = c(left)`).
- If `k > L`: the first `L` elements are exhausted; the k-th overall is the `(k−L)`-th right-half element. Recursing with `(right, mid+1, hi, k−L)` preserves I, and `1 ≤ k−L ≤ c(right)` since `k ≤ c(node) = L + c(right)`.

**Termination.** Each step strictly halves `hi − lo + 1`; after `⌈log₂ D⌉` steps `lo = hi`.

**Postcondition.** At a leaf `lo = hi = g`, by I the k-th smallest of `a[l..r]` has rank `g`, so `value[g]` is the answer. Total work `Θ(log D) = Θ(log n)`. ∎

### 5.1 Fully worked descent with the invariant annotated

`a = [3, 1, 4, 1, 5]`, ranks `1→0, 3→1, 4→2, 5→3`, `D = 4`. Query: 2nd smallest of `a[2..4] = [1,4,1]`, so `rootL = version[1]`, `rootR = version[4]`, `k = 2`.

Diff counts `version[4] − version[1]` over buckets `{1,3,4,5}` = `[2,0,1,0]`, i.e. the multiset `{1, 1, 4}`. Annotated trace:

```
call (lo=0, hi=3, k=2)        # I: 2nd smallest with rank in [0,3] is the global 2nd. 1≤2≤c=3. ✓
  mid = 1
  leftCnt = c(ranks 0..1) = (#1 + #3) = 2 + 0 = 2
  k=2 ≤ 2 → recurse LEFT, k stays 2
call (lo=0, hi=1, k=2)        # I: 2nd smallest with rank in [0,1] is global 2nd. 1≤2≤c=2. ✓
  mid = 0
  leftCnt = c(rank 0) = #1 = 2
  k=2 ≤ 2 → recurse LEFT, k stays 2
call (lo=0, hi=0, k=2)        # leaf, rank 0
  return rank 0 → value[0] = 1
```

Answer `1`. Check: sorted `a[2..4] = [1,1,4]`, 2nd smallest = `1`. ✓ The invariant held at every call (the `1 ≤ k ≤ c` bound is annotated), and termination was in `⌈log₂ 4⌉ = 2` internal steps.

### 5.2 Edge of the invariant: k at the boundary

Two boundary cases the proof must cover:
- **k = 1** (minimum): always takes the leftmost non-empty bucket. At each node, if `leftCnt ≥ 1` go left; the descent funnels to the smallest present value.
- **k = r−l+1** (maximum): `k` exceeds every `leftCnt` until the rightmost non-empty bucket, where `k − (accumulated left counts) = 1` at the leaf. The invariant's `1 ≤ k − L ≤ c(right)` bound guarantees we never overshoot the array's largest element.

---

<a name="subtraction-lemma"></a>
## 6. Correctness of the Subtraction (Linearity Lemma)

The k-th descent relies on `c(u) = cnt(u, r) − cnt(u, l−1)` being the *exact* count of `a[l..r]` in `range(u)`. We prove it cleanly.

**Lemma (prefix linearity).** For every node `u` and indices `0 ≤ p ≤ q ≤ n`,

```
cnt(u, q) − cnt(u, p) = #{ j ∈ (p, q] : rank(a_j) ∈ range(u) }.
```

**Proof.** By construction `version[i] = version[i−1] + 𝟙[bucket of a_i]`, so for any node `u`,

```
cnt(u, i) = cnt(u, i−1) + [ rank(a_i) ∈ range(u) ].
```

Telescoping from `p` to `q`:

```
cnt(u, q) − cnt(u, p) = Σ_{i=p+1}^{q} [ rank(a_i) ∈ range(u) ]
                      = #{ j ∈ (p, q] : rank(a_j) ∈ range(u) }.   ∎
```

Setting `p = l−1, q = r` gives `c(u) = #{ j ∈ [l, r] : rank(a_j) ∈ range(u) }`, exactly what the descent assumes. Crucially this holds for **every** node simultaneously, including the two children, so `leftCount = c(left) = cnt(left, r) − cnt(left, l−1)` is correct at every level.

**Alignment corollary.** `cnt(u, ·)` is taken over the *same* `range(u)` in both versions because both `version[l−1]` and `version[r]` recurse with identical `mid = ⌊(lo+hi)/2⌋` splits. Hence the node we reach by the same left/right turns in both trees covers the same value interval — even when one is a fresh path-copy and the other an old shared node. The subtraction is therefore well-typed.

---

<a name="fat-nodes"></a>
## 7. Full Persistence — The Fat-Node Method

Path copying gives **partial** persistence cheaply, and even **full** persistence for trees specifically (keep a root per version, update from any root — each update is still `O(log n)` new nodes, but now the *number of versions can blow up* if every node is updated independently). The classical alternative achieving **O(1) amortized space per update for full persistence of arbitrary pointer structures** is the **fat-node** method of Driscoll, Sarnak, Sleator, and Tarjan (1989).

**Idea.** Instead of cloning a node on every change, let each node be "fat": it stores its original fields plus a **list of modifications**, each tagged with the **version** in which it took effect:

```
FatNode {
  baseLeft, baseRight, baseVal           # version-0 fields
  mods: list of (version v, field f, newValue x)   # ordered by version
}
read(node, field, v):
  among mods with mods.version ≤ v and field = f, take the one with the LARGEST version;
  if none, return base field.            # O(log m) by binary search on version
write(node, field, v, x):
  append (v, field, x) to mods.          # O(1) amortized space
```

**Read cost.** A field read does a binary search over the modification list by version: `O(log m)` per node access, so a root-to-leaf traversal costs `O(log n · log m)`. (For partial persistence of *bounded in-degree* structures, the **node-copying** refinement of Driscoll et al. recovers `O(1)` amortized space *and* `O(1)` access overhead, giving `O(log n)` reads — but it is more intricate; fat nodes are the conceptually clean version.)

**Full-persistence version DAG.** Versions form a tree (any version can be updated). A linear "version order" is imposed via an **order-maintenance** structure so that "`mods.version ≤ v`" comparisons make sense across branches.

| Method | Space / update | Read overhead | Persistence | Notes |
|---|---|---|---|---|
| **Path copying** | O(log n) | none (O(log n) traversal) | partial (and trees: full) | simplest; what contests use |
| **Fat nodes** | **O(1) amortized** | O(log m) per node | **full** | global mod lists, version order |
| **Node copying** (Driscoll et al.) | O(1) amortized | O(1) per node | partial (bounded in-degree) | optimal; intricate |

**Worked fat-node read.** Suppose a node's `val` field has mods `[(v=2, 5), (v=7, 9), (v=11, 4)]` and base `val = 0`. A read at version `v = 8` binary-searches for the largest version `≤ 8` → `(v=7, 9)` → returns `9`. A read at `v = 1` finds no mod `≤ 1` → returns base `0`. A read at `v = 20` returns the latest, `4`. Each read is `O(log(#mods)) = O(log m)`. Path copying avoids this entirely: the version's root already points at the node holding the correct value, so a read is a plain pointer dereference — the reason path copying gives `O(log n)` reads while fat nodes give `O(log n · log m)`.

### 7.1 Confluent persistence — the fourth level

Beyond full persistence lies **confluent persistence**: versions can be *combined* (e.g., concatenating two persistent ropes), so the version "history" is a DAG, not a tree. Fiat and Kaplan (2003) showed confluent persistence can incur an exponential blow-up in naive schemes and gave bounds parameterized by the DAG's "effective depth". The persistent segment tree as used for range-k-th never needs confluence — its versions form a simple linear chain — but knowing the hierarchy `ephemeral ⊂ partial ⊂ full ⊂ confluent` lets you place any persistence requirement precisely and avoid over-engineering. For this structure, **partial** is the correct and cheapest level.

```mermaid
graph LR
    E[Ephemeral<br/>one version] --> P[Partial<br/>read any, write latest<br/>linear chain]
    P --> F[Full<br/>read+write any<br/>version tree]
    F --> C[Confluent<br/>versions merge<br/>version DAG]
    P -.->|path copying| M1[O(log n)/update]
    F -.->|fat nodes| M2[O(1) amort. space,<br/>O(log m) read]
    C -.->|effective-depth bound| M3[possible blow-up]
    style P fill:#1f6f43,color:#fff
```

The highlighted node is the level the range-k-th application lives at.

### 7.2 Iterative descent and its complexity

The recursive `kth` can be rewritten as a non-branching `while` loop (it only ever recurses into one child), eliminating call-stack overhead and the risk of stack overflow:

```
function kth_iter(L, R, lo, hi, k):
    while lo < hi:
        mid = ⌊(lo+hi)/2⌋
        leftCnt = cnt(left(R)) − cnt(left(L))
        if k ≤ leftCnt: R, L, hi = left(R),  left(L),  mid
        else:           k, R, L, lo = k−leftCnt, right(R), right(L), mid+1
    return lo
```

The loop runs exactly `⌈log₂ D⌉` iterations, each `O(1)`, so the time is `Θ(log n)` with `O(1)` auxiliary space (no recursion stack) — strictly better constants than the recursive form and the recommended production version.

The same iterative descent in all three languages (arena form, `cnt/lc/rc` arrays):

#### Go
```go
func kthIter(cnt, lc, rc []int32, L, R int32, lo, hi, k int) int {
    for lo < hi {
        mid := (lo + hi) / 2
        leftCnt := int(cnt[lc[R]] - cnt[lc[L]])
        if k <= leftCnt {
            L, R, hi = lc[L], lc[R], mid
        } else {
            k, L, R, lo = k-leftCnt, rc[L], rc[R], mid+1
        }
    }
    return lo
}
```

#### Java
```java
static int kthIter(int[] cnt, int[] lc, int[] rc, int L, int R, int lo, int hi, int k) {
    while (lo < hi) {
        int mid = (lo + hi) >>> 1;
        int leftCnt = cnt[lc[R]] - cnt[lc[L]];
        if (k <= leftCnt) { L = lc[L]; R = lc[R]; hi = mid; }
        else { k -= leftCnt; L = rc[L]; R = rc[R]; lo = mid + 1; }
    }
    return lo;
}
```

#### Python
```python
def kth_iter(cnt, lc, rc, L, R, lo, hi, k):
    while lo < hi:
        mid = (lo + hi) // 2
        left_cnt = cnt[lc[R]] - cnt[lc[L]]
        if k <= left_cnt:
            L, R, hi = lc[L], lc[R], mid
        else:
            k, L, R, lo = k - left_cnt, rc[L], rc[R], mid + 1
    return lo
```

---

<a name="amortized"></a>
## 8. Amortized Analysis of Fat Nodes (Potential Method)

**Claim.** With the fat-node method, `m` updates cost `O(m)` total space (i.e., `O(1)` amortized per update), for a structure of bounded out-degree (here, ≤ 2 children + 1 value = 3 fields per node).

**Potential method.** Let `Φ(D)` = total number of `mods` entries currently stored across all nodes. Each update writes `O(1)` fields along the affected path — but in the **fat-node** scheme a single logical update appends one `mod` per *changed field*. For a segment-tree point update, that is one changed `val` per node on the path, i.e., `Θ(log n)` mods, not `O(1)`.

To get `O(1)` amortized for *general* pointer structures, the theorem is stated per **pointer change**, not per high-level operation: each elementary `write(node, field, v, x)` appends exactly **one** `mod` record, so

```
actual cost c_i (one field write) = 1 mod appended
ΔΦ = +1                            (one more mod stored)
amortized a_i = c_i + ΔΦ = O(1).
```

Summed over all elementary writes, total space = total number of field writes = `O(#writes)`. A segment-tree update performs `Θ(log n)` field writes, so it uses `Θ(log n)` fat-node space — the **same** asymptotic as path copying for this structure. The fat-node win is for structures where most updates touch `O(1)` fields (e.g., linked lists, search-tree rotations), where it beats path copying's `Θ(log n)`.

**Read-side potential.** No reclamation, so reads don't change `Φ`; their `O(log m)` cost is worst-case, not amortized. ∎

**Takeaway.** For a **segment tree**, path copying and fat nodes both cost `Θ(log n)` space per point update; path copying additionally gives `O(log n)` (no per-node `log m`) reads, which is why it is the method of choice here. Fat nodes matter when you need *full* persistence or your base structure changes `O(1)` fields per update.

---

<a name="randomized"></a>
## 9. Randomized & Expected-Cost View

Persistent segment trees are deterministic, but two probabilistic analyses are worth stating because they appear in interviews and in mixed structures.

### 9.1 Expected nodes touched by a k-th query on random data
A k-th query always touches exactly `⌈log₂ D⌉` internal nodes plus a leaf (the descent never branches) — this is **deterministic**, not random. So unlike a randomized BST, there is no variance in query cost: `Pr[T(query) = c·log D] = 1`. The only randomness in practice is cache behavior, addressed in §10.

### 9.2 Expected sharing under random updates
Suppose update indices are i.i.d. uniform on `[0, n)`. The expected number of *distinct* paths after `m` updates governs how much physical memory is unique vs. logically shared. By the standard balls-in-bins argument, the expected number of leaves touched at least once after `m` updates is

```
E[touched leaves] = n·(1 − (1 − 1/n)^m) ≈ n·(1 − e^{−m/n}).
```

For `m = n`, that is `≈ n(1 − 1/e) ≈ 0.63 n` distinct leaves — but **every** update still allocates a *full fresh path* (Theorem 1 is worst-case-equal-to-best-case), so total nodes remain `Θ(m log n)` regardless of collisions. Sharing happens *across versions* (old version keeps the old path), not *within* a version's allocation count. The randomness only tells us how the *logical* histogram fills, not the allocation total.

### 9.3 Chernoff bound for bucket loads (sizing leaves)
If you want a high-probability bound on the maximum count in any single value bucket (e.g., to choose an integer width for `cnt`), with `m` uniform inserts over `D` buckets the expected per-bucket load is `μ = m/D`, and

```
Pr[ load(bucket) ≥ (1+δ)μ ] ≤ e^{−μδ²/3}.
```

Choosing `δ` so the right side is `≤ 1/D` guarantees, by a union bound over `D` buckets, that **no** bucket exceeds `(1+δ)μ` with probability `≥ 1 − 1/poly`. This certifies that `int32` counts never overflow for realistic `m`, `D` — a small but real engineering use of a tail bound.

---

<a name="cache"></a>
## 10. Cache-Oblivious / I/O Analysis

Parameters: `N` nodes, cache size `M`, block size `B`.

- **Pointer-chasing layout** (heap-allocated nodes): a root-to-leaf traversal touches `log n` nodes scattered in memory → `Θ(log n)` cache misses, one per level. No locality across versions.
- **Arena layout** (bump-allocated, append-order): nodes created together in one update are contiguous, so the freshly-copied path of one version is cache-friendly *to build*, but a *query* still jumps across levels created at different times → still `Θ(log n)` misses in the worst case.
- **Van Emde Boas / recursive layout** could lower a *single static* tree to `O(log_B n)` block transfers, but persistence's incremental, version-interleaved allocation defeats a clean vEB layout. In practice the **wavelet tree** wins on I/O: its bit-packed levels give `O(log σ)` work with near-sequential bit scans, far better constants than `log n` pointer hops.

So for I/O-bound or cache-sensitive workloads, prefer a wavelet tree; the persistent segment tree's strength is *online versioning*, not cache efficiency.

### 10.1 External-memory (I/O model) cost of the k-th query

In the standard external-memory model (cache/RAM = `M`, block = `B`), a k-th query reads one node per level of the descent over **two** roots. Because consecutive levels are allocated at different times in an arena (the path for version `r` and the path for version `l−1` were built at different points in history), the accesses are not block-local: the query incurs `Θ(log n)` block transfers. There is no way to lay out a *retained, version-interleaved* set of paths so that an arbitrary two-version descent is block-local — the versions a query touches are chosen at query time. This is a fundamental reason succinct structures (wavelet trees, whose levels are contiguous bit-vectors) dominate the persistent segment tree on I/O-bound k-th workloads, despite identical word-RAM asymptotics.

### 10.2 Why the build is cache-friendlier than the queries

Counterintuitively, *building* all versions is more cache-friendly than *querying* them: each `insert` allocates its `log n` new nodes consecutively at the arena tip (a bump allocation), so the write stream is sequential and the path is temporally local. Queries, however, chase pointers across the whole arena's history. If your workload is build-heavy and query-light (e.g., precompute once, few lookups), the persistent tree's constants are fine; if query-heavy and memory-bound, reconsider the wavelet tree.

---

<a name="comparison"></a>
## 11. Comparison with Alternatives (Formal)

| Attribute | Persistent segtree (path copy) | Wavelet tree | Merge-sort tree | Fat-node (full persist) |
|---|---|---|---|---|
| Build time | Θ(n log n) | Θ(n log σ) | Θ(n log n) | Θ(n) base + writes |
| Space | Θ(n log n) | **Θ(n log σ)** bits, compact | Θ(n log n) | Θ(#writes) |
| Range k-th | **Θ(log n)** | **Θ(log σ)** | Θ(log² n) | Θ(log n · log m) |
| Range count ≤ x | Θ(log n) | Θ(log σ) | Θ(log² n) | Θ(log n · log m) |
| Online | yes | yes | yes | yes |
| Persistence | partial | none | none | **full** |
| Deterministic | yes | yes | yes | yes |
| Cache I/O per query | Θ(log n) misses | Θ(log σ) near-seq | Θ(log² n) | Θ(log n · log m) |

`σ` = alphabet/value-axis size (≤ n). When `σ ≈ n`, wavelet and persistent trees have the same `log` factor, but the wavelet tree's constant and memory are smaller; the persistent tree's edge is **versioning** and easy weighting.

---

<a name="lower-bounds"></a>
## 12. Lower Bounds and What Persistence Cannot Cheat

- **Space lower bound.** Any structure answering arbitrary `(l, r)` order-statistic queries online on a static array must encode enough to recover, for each prefix, the multiset — information-theoretically `Ω(n log σ)` bits. Wavelet trees meet this; persistent segment trees use `Θ(n log n)` *words* (`Θ(n log n · log n)` bits), a `log n` factor above optimal — the price of pointer nodes vs. bit-packing.
- **Per-update lower bound.** By Theorem 1's necessity argument, any *immutable-node* persistent structure must allocate ≥ (number of nodes whose value changes) per update; for a point update that is the full path, `Ω(log n)`. You cannot beat `Θ(log n)` space per update with immutable nodes — fat/node-copying only helps when fewer fields change.
- **Query lower bound.** Comparison-based order statistics over an interval are `Ω(log n)` in the cell-probe / decision-tree sense for the dynamic case; the persistent tree matches it.

So persistence is asymptotically optimal *per update* among immutable-node schemes, and optimal *per query*; its only "overhead" is the `log n`-words-vs-bits gap versus succinct structures.

### 12.1 A formal note on the `O(n log n)` build as a batch operation

Building all `n+1` prefix versions does `n` updates, each `Θ(log n)`, so the build is `Θ(n log n)` time and space. One might ask whether a *batch* build could do better than `n` independent updates — could we amortize the path copies? The answer is **no** asymptotically: each prefix `version[i]` differs from `version[i−1]` in exactly the path to `a_i`'s bucket, and these paths are *distinct version states* that must all be retained (partial persistence keeps every version). By Theorem 2 the total node count is `Θ(n log n)`, and you cannot represent `n` distinct retained histograms over `D = Θ(n)` buckets in `o(n log n)` words while supporting `O(log n)` subtraction queries — that would beat the `Ω(n log σ)`-bits bound in *words*. The wavelet tree's compactness comes from bit-packing, not from a better build asymptotic.

### 12.1.1 Formal statement of the build-batch claim

**Proposition.** Maintaining all `n+1` prefix histograms of an array over `D` value buckets, with `O(log n)`-time range-count/order-statistic queries and full version retention, requires `Ω(n log D)` words in the pointer-machine model.

**Argument sketch.** Each version must be distinguishable and independently queryable in `O(log n)`. There are `n` distinct nontrivial prefixes; the difference between consecutive versions is `Θ(log D)` words (the path), and these differences are *retained* (partial persistence). Summing the retained increments gives `Ω(n log D)`. A structure using `o(n log D)` words would, by a counting/encoding argument, be unable to reconstruct the `n` distinct histograms while answering `O(log n)` queries on each — contradicting the per-query lower bound combined with retention. The wavelet tree escapes only by leaving the pointer-machine model (bit-packing into `Θ(n log σ)` *bits*, i.e. `Θ(n log σ / w)` words on a `w`-bit RAM). ∎ (sketch)

### 12.2 What "persistence cannot cheat" means precisely

Persistence buys **time-travel for free relative to the work already done**, but it cannot:

1. **Lower the per-query order-statistic cost** below `Ω(log n)` (cell-probe lower bound).
2. **Lower the per-update node count** below the changed-value path with immutable nodes.
3. **Match succinct space** (`Θ(n log σ)` *bits*) — pointer nodes cost `Θ(n log n)` *words*.
4. **Give range *updates* for free** — basic persistence is point-update only; lazy + persistence multiplies memory.

These four are the hard limits. Within them, path copying is the optimal mechanism for *versioned aggregate-over-interval* structures.

---

<a name="summary"></a>
## 13. Summary

- **Theorem 1:** a point update via path copying allocates **exactly `⌈log₂ n⌉ + 1`** new nodes — necessary (changed values force re-allocation) and sufficient (one child shared each level). Update is `Θ(log n)`.
- **Theorem 2:** total space after `m` updates is **`Θ(n + m log n)`** (`Θ(m log n)` with lazy-empty), versus `Θ(nm)` for naive full copies — an `n/log n` saving.
- The **k-th descent** is proven correct by a loop invariant: at each level `leftCount = cnt_R(left) − cnt_L(left)` decides left/right, decrementing `k`, in `Θ(log n)`.
- **Full persistence** uses **fat nodes** (O(1) amortized space *per field write*, O(log m) read overhead) or node-copying (O(1) both, intricate); for segment trees both match path copying's `Θ(log n)` per update, so path copying — with cheaper reads — is preferred.
- Persistence is **optimal per update** (immutable-node) and **per query**, paying only a `log n`-words-vs-bits gap to succinct wavelet trees and offering versioning none of them do.

---

## Further Reading

- **Sarnak, N., Tarjan, R.E.**, *Planar Point Location Using Persistent Search Trees*, Communications of the ACM 29(7), 1986 — introduces path copying for persistence.
- **Driscoll, J.R., Sarnak, N., Sleator, D.D., Tarjan, R.E.**, *Making Data Structures Persistent*, Journal of Computer and System Sciences 38(1), 1989 — partial vs full persistence, fat-node and node-copying methods, the O(1)-amortized bounds.
- **Okasaki, C.**, *Purely Functional Data Structures*, Cambridge University Press, 1998 — persistence and structural sharing from the functional-programming side; amortization under persistence (the "banker's"/"physicist's" methods).
- **Demaine, E.**, *MIT 6.851 Advanced Data Structures*, lectures on persistence — formal treatment of partial/full/confluent/functional persistence and their bounds.
- **Fiat, A., Kaplan, H.**, *Making Data Structures Confluently Persistent*, J. Algorithms 48(1), 2003 — the confluent case and its blow-up bounds.
- **CP-Algorithms**, *Persistent Segment Tree* and *K-th order statistic on a segment* — implementation-focused derivations matching this file's algorithms.

---

## Appendix — Proof Obligations Checklist

When you implement or present a persistent segment tree at a professional level, these are the claims you should be able to defend on demand:

| Claim | Where proven | One-line justification |
|---|---|---|
| Update allocates exactly `⌈log₂ n⌉+1` nodes | §2 (Theorem 1) | `N(w)=1+N(⌈w/2⌉)`, `N(1)=1`; necessity from changed values |
| Total space `Θ(n + m log n)` | §3 (Theorem 2) | `(2n−1) + m(⌈log₂ n⌉+1)` |
| Build of `T_0` is `Θ(n)` | §3.1 | Master theorem Case 1 |
| Numbers match at `n=8` and `n=10^6` | §4 | direct count, predicted `n/log n` ratio |
| k-th descent correct | §5 (invariant) | left-count split, induction, leaf maps to rank |
| Subtraction isolates `a[l..r]` | §6 (linearity lemma) | telescoping; counts form a group |
| min/max can't use subtraction | §1.2, §6 | monoid without inverse |
| Fat nodes: O(1) amortized space/write, O(log m) read | §7–§8 (potential) | one mod per write; binary search on version |
| Iterative `kth` is `Θ(log n)`, `O(1)` space | §7.2 | non-branching loop, `⌈log₂ D⌉` iterations |
| Optimal per-update & per-query among immutable-node schemes | §12 | path-must-be-copied + cell-probe bound |

If you can walk an interviewer through any row of this table from memory, you have mastered the theory of this structure.

### Closing perspective

The persistent segment tree is a small, sharp instance of a large idea: **immutability plus structural sharing buys cheap versioning**. The proofs above pin down exactly what "cheap" means — `Θ(log n)` per version, `Θ(n + m log n)` total — and exactly what persistence *cannot* buy: it does not lower the order-statistic query bound, does not reach succinct space, and does not grant free range updates. Within those limits, path copying is provably optimal for versioned aggregate-over-interval queries, and the same proofs transfer, with different fan-out and monoid, to every copy-on-write tree in production systems. Knowing the bounds *and* their tightness is what separates using the structure from understanding it.

---

**Next step:** Apply the theory in [`interview.md`](./interview.md) (tiered Q&A plus the range-k-th coding challenge) and [`tasks.md`](./tasks.md) (graded build/query/k-th exercises in Go, Java, and Python).
