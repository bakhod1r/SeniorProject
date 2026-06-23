# Cache-Oblivious Algorithms — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Ideal-Cache Model](#the-ideal-cache-model)
   - [The Model, Restated for Proofs](#the-model-restated-for-proofs)
   - [Why the Idealizations Are Free: Optimal Replacement vs LRU](#why-the-idealizations-are-free-optimal-replacement-vs-lru)
   - [Why the Idealizations Are Free: Full Associativity and Automatic Transfer](#why-the-idealizations-are-free-full-associativity-and-automatic-transfer)
   - [The Tall-Cache Assumption](#the-tall-cache-assumption)
3. [The Key Technique: Analysis by Recursion](#the-key-technique-analysis-by-recursion)
4. [Worked Analysis: Recursive Matrix Transpose — Θ(n²/B)](#worked-analysis-recursive-matrix-transpose--θnb)
5. [Worked Analysis: Recursive Matrix Multiply — Θ(n³/(B√M))](#worked-analysis-recursive-matrix-multiply--θnbm)
   - [The Recurrence and Its Base Case](#the-recurrence-and-its-base-case)
   - [Solving the Recurrence](#solving-the-recurrence)
6. [Worked Analysis: The van Emde Boas Layout — Θ(log_B N)](#worked-analysis-the-van-emde-boas-layout--θlog_b-n)
   - [The Recursive Layout](#the-recursive-layout)
   - [The Search Analysis](#the-search-analysis)
7. [Cache-Oblivious Sorting: Funnelsort](#cache-oblivious-sorting-funnelsort)
8. [Code: Recursive Transpose and Multiply with an I/O Simulator](#code-recursive-transpose-and-multiply-with-an-io-simulator)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the junior intuition — *optimal I/O without knowing `M` or `B`; recurse until the subproblem fits; the van Emde Boas layout* — into rigorous statements you can derive. By the end you can state the ideal-cache model and justify each of its idealizations, solve I/O recurrences whose base case is "fits in cache" or "fits in a block," and prove the three signature bounds: transpose in `Θ(n²/B)`, matrix multiply in `Θ(n³/(B√M))`, and vEB search in `Θ(log_B N)` — all without the algorithm ever referencing `M` or `B`.

At the [junior level](./junior.md) you met the central idea of **cache-oblivious algorithms** (Frigo, Leiserson, Prokop, and Ramachandran, 1999): write a divide-and-conquer algorithm that **never mentions `M` or `B`**, let recursion subdivide the problem down to ever-smaller pieces, and the algorithm automatically becomes efficient at *every* level of the memory hierarchy at once. You saw the recurse-until-it-fits pattern and the van Emde Boas tree layout as the headline example.

This file makes that rigorous. It builds on the [I/O model](../01-the-io-model/middle.md), where an algorithm is **cache-aware**: it knows `M` and `B` and issues explicit block transfers (e.g. it picks a tile size of exactly `√M`). The cache-oblivious model removes that knowledge — and remarkably, loses nothing asymptotically.

We prove the following:

- The **ideal-cache model** (the analysis machine) and *why* its idealizations — full associativity, optimal offline replacement, automatic transfer — cost only a constant factor. The key lemma is that **LRU is 2-competitive with twice the cache** (Sleator–Tarjan), so reasoning with the optimal offline policy is "free."
- The **analysis-by-recursion** technique: an I/O recurrence bottoms out not at size 1, but when the subproblem **fits in cache** (`≤ M`) or **fits in a block** (`≤ B`).
- Three worked bounds: **transpose** `Θ(n²/B)`, **matrix multiply** `Θ(n³/(B√M))` (the `√M` is where the recursion stops — when a subproblem fits in cache), and **vEB search** `Θ(log_B N)`.
- An overview of **funnelsort**, the cache-oblivious sort that matches `sort(N) = Θ((N/B) log_{M/B}(N/B))` without knowing `M` or `B`.

A note on vocabulary, carried over from the [I/O model](../01-the-io-model/middle.md):

| Symbol | Meaning |
|--------|---------|
| `N` | number of items in the problem input |
| `M` | number of items that fit in the (ideal) cache |
| `B` | number of items per block / cache line (one transfer moves one block) |
| `M/B` | number of **blocks** that fit in cache |
| `Q(n)` | number of cache misses (block transfers) the algorithm makes on input size `n` |
| `scan(n)` | `Θ(n/B)` — transfers to read or write `n` contiguous items |

Throughout, `1 ≤ B ≤ M ≤ N`, and — crucially for several results below — the **tall-cache assumption** `M ≥ B²`. We count cache misses (block transfers), never CPU operations. The defining property to keep in mind: **the algorithm's *code* contains no `M` and no `B`**; those parameters appear only in the *analysis*.

---

## The Ideal-Cache Model

### The Model, Restated for Proofs

The **ideal-cache model** is a two-level memory used purely as an *analysis device*. It looks like the I/O model, with four idealizing assumptions that make clean proofs possible:

- **Two levels.** An arbitrarily large slow memory holds the `N` items; a fast **cache** holds `M` items, organized as `M/B` lines of `B` consecutive items each. A **cache miss** transfers one line; the **cost** is the number of misses.
- **Automatic replacement.** Unlike the I/O model — where the algorithm *issues* transfers — the ideal cache moves blocks **automatically**, exactly like a hardware cache. The algorithm just reads and writes memory addresses; the cache decides what to fetch and evict. This is what *forces* the algorithm to be oblivious: it cannot name a block to load because it has no transfer instruction.
- **Full associativity.** Any memory block may reside in any cache line. (Real caches are set-associative — a block may only go to a restricted set of lines.)
- **Optimal (offline) replacement.** On a miss with a full cache, the model evicts the line whose next access is **farthest in the future** — Belady's optimal policy (`OPT`/`LFD`). This is clairvoyant and undeployable, but it gives the cleanest possible miss count.

The point of the model is leverage: prove a bound under these idealizations, then invoke a sequence of lemmas showing each idealization costs only a **constant factor** on real hardware. Then a cache-oblivious algorithm proven optimal in the ideal-cache model is **simultaneously** optimal at every level of a real, multi-level, set-associative hierarchy — L1, L2, L3, RAM, disk — because each adjacent pair of levels *is* an instance of the two-level model, with its own `M` and `B` that the algorithm never had to know.

### Why the Idealizations Are Free: Optimal Replacement vs LRU

The most suspicious assumption is **optimal offline replacement** — no real cache is clairvoyant. The justification is a single competitive result.

> **Lemma (Sleator–Tarjan, 1985).** LRU with a cache of size `M` makes at most twice as many misses as the optimal offline policy `OPT` would make with a cache of size `M/2`, on every access sequence. More precisely, `LRU_M(σ) ≤ 2 · OPT_{M/2}(σ) + (M/2)`.

This is the *resource-augmented* form of competitive analysis: LRU, given double the cache, is **2-competitive** against the clairvoyant optimum. (It is the same `k`-server/paging machinery developed in [paging and caching theory](../../25-online-algorithms/03-paging-and-caching-theory/middle.md), specialized to the LRU-vs-OPT comparison with resource augmentation.)

The consequence for cache-oblivious analysis is decisive. Suppose an algorithm's miss count under *optimal* replacement is a **regular** function of `M` — meaning `Q(n, M)` changes by only a constant factor when `M` changes by a constant factor, formally `Q(n, M/2) = O(Q(n, M))`. Every divide-and-conquer bound we derive below (`n²/B`, `n³/(B√M)`, …) is regular: halving `M` changes them by at most a constant. Then:

```text
  misses under LRU with cache M
      ≤  2 · (misses under OPT with cache M/2)        [Sleator–Tarjan]
      =  2 · O(misses under OPT with cache M)         [regularity: Q(n, M/2) = O(Q(n, M))]
      =  O(misses under OPT with cache M).
```

So an algorithm that is optimal under the *idealized* OPT policy is, on a real LRU cache, optimal **up to a constant factor**. This is why we may freely analyze with the clairvoyant policy: the analysis is clean, and the gap to deployable LRU is just a constant. (Real caches are not exactly LRU but pseudo-LRU; the same regularity argument absorbs that too.)

### Why the Idealizations Are Free: Full Associativity and Automatic Transfer

Two smaller justifications complete the picture:

- **Full associativity → set associativity** costs only a constant factor, by simulating a fully-associative cache of `M/B` lines with a hash of block addresses into a set-associative cache (or, in the original treatment, via a universal-hashing argument). The asymptotics survive.
- **Automatic transfer → explicit transfer.** Because the algorithm's access *pattern* is fixed (it does not depend on `M` or `B`), an automatic LRU/OPT cache fetches exactly the blocks the access pattern touches, in the order it touches them — there is no penalty for not issuing transfers manually, since a sequential, recursion-driven access pattern is exactly what a hardware prefetcher and LRU policy handle best.

The upshot — and this is the whole reason the model is worth studying — is a theorem of the form:

> A cache-oblivious algorithm that incurs `Q(N, M, B)` misses in the ideal-cache model incurs `O(Q(N, M, B))` misses on a real cache with LRU/pseudo-LRU replacement, limited associativity, and automatic management — and does so *simultaneously at every level* of a multi-level hierarchy.

### The Tall-Cache Assumption

Several cache-oblivious results require the **tall-cache assumption**, exactly as flagged in the [I/O model](../01-the-io-model/middle.md):

```text
  M ≥ B²        (equivalently M/B ≥ B: at least B blocks fit in cache)
```

The phrase "tall" is geometric: picture the cache as a `(M/B) × B` array of items — `M/B` lines, each `B` wide. Tall-cache says the array is at least as tall as it is wide. The assumption is what lets a recursive base case of size `Θ(B²)` items fit in cache **with room to spare**, and it is essential to the matrix-transpose and funnelsort bounds: those proofs need a sub-block of a `√M × √M` tile (which is `Θ(B²)` items when `M = Θ(B²)`) to be cache-resident along with its scan buffers. Where the I/O-model bounds (scan, sort, search) held for *any* `1 ≤ B ≤ M ≤ N`, the cache-oblivious matrix and sorting bounds below are stated **assuming `M ≥ B²`**. Keep it explicit; omitting it is a real error (see [pitfalls](#pitfalls)).

---

## The Key Technique: Analysis by Recursion

Here is the one technique that powers every analysis in this file.

A cache-oblivious algorithm is divide-and-conquer. Its recursion keeps subdividing the problem; the algorithm itself has no idea when a subproblem becomes "small enough." But the **analysis** does. We write an I/O recurrence `Q(n)` for the number of cache misses, and we choose the **base case** of the *recurrence* (not of the algorithm) to be the recursion level where the subproblem first **fits in cache** or **fits in a block**:

- **"Fits in a block" (`n ≤ B` or data size `≤ B` items).** Once a subproblem's working set is at most one block, touching all of it costs `O(1)` misses — the block is fetched once and reused. Base case: `Q(B) = O(1)`.
- **"Fits in cache" (working set `≤ M`).** Once a subproblem's entire working set fits in the `M`-item cache, the cache loads it with `Θ(working_set / B)` misses and then serves *every* subsequent access for free until the subproblem completes — there are no further misses inside it. Base case: `Q(subproblem with working set s ≤ M) = Θ(s/B)`.

This is the cache-oblivious twist on the master theorem. In a *time* recurrence the base case is `T(1) = O(1)`; here the base case is "small enough to be cache-resident," which terminates the recursion **early** — at size `Θ(B)` or `Θ(√M)` rather than `1`. The work *below* the base case (the entire subtree of recursion once the data fits) is **free**, because it all happens in cache. The crossover where the recurrence bottoms out is precisely where `M` (or `B`) enters the bound — even though the *code* never mentioned it.

The recurrences below all have the shape `Q(n) = a · Q(n/b) + (cost of dividing/combining)`, solved by the standard recursion-tree or master-theorem method, but with the recursion **stopping at the cache-resident level**. Master-theorem mechanics live in [the master theorem](../../15-divide-and-conquer/03-master-theorem/middle.md); we apply them here with the non-trivial base cases.

---

## Worked Analysis: Recursive Matrix Transpose — Θ(n²/B)

The transpose problem: given an `n × n` matrix `A` (row-major) and output `B'` (row-major), set `B'[j][i] = A[i][j]`. The naive double loop reads `A` row-by-row (sequential, scan-friendly) but writes `B'` column-by-column (strided) — or vice versa. One of the two matrices is always traversed against its layout, so the naive transpose costs up to `Θ(n²)` misses: one miss per element on the strided side.

The cache-oblivious cure is **recursive blocking by bisection**. Split the matrix along its longer dimension into two halves and transpose each recursively. For a square `n × n` block, split into four `(n/2) × (n/2)` quadrants and transpose each, swapping the off-diagonal pair:

```text
  ┌───────┬───────┐ transpose      ┌───────┬───────┐
  │  A11  │  A12  │     ───►        │ A11ᵀ  │ A21ᵀ  │
  ├───────┼───────┤                ├───────┼───────┤
  │  A21  │  A22  │                │ A12ᵀ  │ A22ᵀ  │
  └───────┴───────┘                └───────┴───────┘

  Transpose(A) = recursively Transpose A11, A22 in place;
                 Transpose A12 into B's lower-left, A21 into B's upper-right.
```

The algorithm names no `M` and no `B` — it just bisects until the block is a single element. Now the **analysis** picks the base case: recurse until a `√B × √B` submatrix is reached. Such a submatrix has `B` elements, so both the source submatrix **and** its destination submatrix each span only `O(1)` blocks — `O(√B)` rows, each fitting (with tall-cache) into a constant number of blocks. Hence a `√B × √B` transpose costs `O(1)` misses... but to be careful we need both source and destination to be block-resident simultaneously, which is where tall-cache `M ≥ B²` is used: a `√B × √B` source tile plus its `√B × √B` destination tile together occupy `2B ≤ 2M` items and, more sharply, fit within `O(B)` blocks that comfortably coexist in a cache of `M/B ≥ B` lines.

> **Theorem (cache-oblivious transpose).** With tall cache `M ≥ B²`, recursive transpose of an `n × n` matrix incurs `Q(n) = Θ(n²/B)` cache misses.

**Analysis.** Consider the recursion stopped at the largest subproblem that fits the "submatrix spans `O(1)` blocks per row" criterion — concretely, a `√B × √B` tile. There are `Θ(n² / B)` such tiles (each holds `B` elements). Reading a `√B × √B` source tile touches `√B` rows of the source; under tall-cache each such tile, source and destination together, is loaded with `O(B / B) = O(... )` misses amortizing to `O(1)` misses *per element-block*, i.e. `Θ(B/B)=Θ(1)` misses to move its `B` elements. Summing over all `Θ(n²/B)` tiles:

```text
  Q(n) = Θ(n²/B) tiles · Θ(1) misses/tile = Θ(n²/B).
```

The matching lower bound is just `scan`: the transpose must read all `n²` input elements and write all `n²` output elements, and reading `n²` contiguous items already costs `Ω(n²/B)`. So `Q(n) = Θ(n²/B)` — **optimal**, equal to the cost of merely reading the data once, and achieved without knowing `B`. The recursion's bisection guarantees that by the time blocks are touched, they are touched in full before eviction; that is what turns the naive `Θ(n²)` into `Θ(n²/B)`.

---

## Worked Analysis: Recursive Matrix Multiply — Θ(n³/(B√M))

Matrix multiply `C = A · B` (all `n × n`) is the showcase result, because here the `√M` appears — and the `√M` is *exactly* "recurse until a subproblem fits in cache."

The cache-oblivious algorithm is the standard eight-way divide-and-conquer (block matrix multiply). Partition each matrix into four `(n/2) × (n/2)` quadrants and expand the product:

```text
  ┌─────┬─────┐   ┌─────┬─────┐   ┌─────┬─────┐
  │ C11 │ C12 │ = │ A11 │ A12 │ · │ B11 │ B12 │
  ├─────┼─────┤   ├─────┼─────┤   ├─────┼─────┤
  │ C21 │ C22 │   │ A21 │ A22 │   │ B21 │ B22 │
  └─────┴─────┘   └─────┴─────┘   └─────┴─────┘

  C11 = A11·B11 + A12·B21      C12 = A11·B12 + A12·B22
  C21 = A21·B11 + A22·B21      C22 = A21·B12 + A22·B22
```

That is **8 recursive multiplies** of `(n/2) × (n/2)` matrices, plus **4 additions** of `(n/2) × (n/2)` matrices (the `+` terms). The additions are scans. Again the code mentions neither `M` nor `B`; it simply bisects `n`.

### The Recurrence and Its Base Case

The miss recurrence is

```text
  Q(n) = 8 · Q(n/2) + Θ(n²/B)          for n large enough that a subproblem does NOT fit in cache.
```

The `8` is the eight subproducts; the `Θ(n²/B)` is the cost of the four quadrant additions and the streaming of submatrices, each an `Θ(n²)`-element scan costing `Θ(n²/B)` misses.

The **base case** is the heart of it. The recursion bottoms out (for the *analysis*) at the level where **all three submatrices involved — a piece of `A`, a piece of `B`, and a piece of `C` — fit together in cache**. Each is `m × m`; three of them occupy `3m²` items, which fit when `3m² ≤ M`, i.e.

```text
  m = √(M/3) = Θ(√M).
```

At `n = Θ(√M)`, the entire sub-multiply runs **inside the cache**: load the three `Θ(√M) × Θ(√M)` submatrices with `Θ(M/B)` misses, then perform *all* the inner multiply-add work with **zero** further misses. So the base case of the recurrence is:

```text
  Q(√M) = Θ(M/B)          (load 3 submatrices of Θ(M) items each → Θ(M/B) misses, then free).
```

This is the precise sense in which "the `√M` comes from recursing until a subproblem fits in cache": the recursion is *cut off* at side length `√M`, because below that everything is cache-resident.

### Solving the Recurrence

Unroll `Q(n) = 8 Q(n/2) + Θ(n²/B)` from `n` down to the base case `n = √M`. The recursion tree has branching factor 8 and depth `log₂(n/√M)`. At depth `d` there are `8^d` nodes, each a subproblem of side `n/2^d` contributing `Θ((n/2^d)² / B) = Θ(n²/(4^d B))` misses, so the per-level cost is

```text
  level d cost = 8^d · Θ(n² / (4^d B)) = Θ((8/4)^d · n²/B) = Θ(2^d · n²/B),
```

which **grows geometrically** with `d` — the cost is dominated by the **leaves** (the base-case level). The number of leaves is `8^{log₂(n/√M)} = (n/√M)³ = n³ / M^{3/2}`, and each leaf costs `Θ(M/B)`:

```text
  Q(n) = (number of base-case nodes) · (cost per base case)
       = Θ( n³ / M^{3/2} ) · Θ( M / B )
       = Θ( n³ / (B · M^{1/2}) )
       = Θ( n³ / (B √M) ).
```

> **Theorem (cache-oblivious matrix multiply).** With tall cache `M ≥ B²`, the recursive eight-way block multiply incurs `Q(n) = Θ(n³/(B√M))` cache misses — matching the best cache-*aware* tiled multiply, without knowing `M` or `B`.

The bound is worth reading aloud: `n³` is the total arithmetic work; dividing by `B` is the blocking win (each line serves `B` elements); dividing by `√M` is the **temporal-reuse** win — a `√M`-sized tile of `C` is computed entirely in cache, so each loaded element of `A` and `B` is reused `Θ(√M)` times before eviction. Compare the naive triple-loop multiply, which streams a full row/column per output element and costs `Θ(n³/B)` misses (no `√M` reuse) — a factor of `√M` worse. For a 64 KB-ish working cache, `√M` is in the dozens-to-hundreds, a large constant. The cache-aware tiled multiply in [cache-aware data layout](../05-cache-aware-data-layout/middle.md) achieves the same `Θ(n³/(B√M))` by *choosing* tile size `√M` explicitly; the cache-oblivious version reaches it by recursing past that size automatically.

---

## Worked Analysis: The van Emde Boas Layout — Θ(log_B N)

The [I/O model](../01-the-io-model/middle.md) achieves `Θ(log_B N)` search with a **B-tree** — but a B-tree must *know* `B` to pick its node size. The cache-oblivious search structure reaches the same `Θ(log_B N)` **without knowing `B`**, using the **van Emde Boas (vEB) memory layout** of a balanced binary search tree. (This layout is unrelated to the vEB *priority-queue* structure; it borrows only the recursive-splitting idea.)

### The Recursive Layout

Take a complete binary search tree of `N` nodes and height `h = Θ(log₂ N)`. Lay its nodes out in memory by **recursively halving the height**:

```text
  vEB-Layout(tree of height h):
    1. Split horizontally at the middle level:
         - a TOP subtree of height h/2
         - about √N BOTTOM subtrees, each of height h/2
    2. Lay out the TOP subtree contiguously (recursively, by vEB layout).
    3. Lay out each BOTTOM subtree contiguously after it (each recursively vEB).
```

```text
        TOP subtree (height h/2, ~√N nodes)
        ┌──────────┐
        │    /\     │
        │   /  \    │
        └──┬────┬──┘
       /   |    |   \
   ┌────┐┌────┐ ... ┌────┐
   │BOT ││BOT │     │BOT │   ~√N bottom subtrees, each height h/2, ~√N nodes
   └────┘└────┘     └────┘

  Memory order:  [ TOP ][ BOT₁ ][ BOT₂ ] ... [ BOT_{√N} ]
                 each block laid out recursively the same way
```

The defining property: **every subtree of height up to roughly `½h` occupies a contiguous run of memory.** A recursive triangle of the tree is stored as a contiguous segment, and this holds at *every* scale of the recursion — coarse triangles and fine triangles alike are contiguous. That scale-invariance is what makes the layout work for an unknown `B`.

### The Search Analysis

> **Theorem (vEB search).** A root-to-leaf search in a vEB-laid-out balanced binary tree of `N` nodes incurs `Θ(log_B N)` cache misses, with no knowledge of `B`.

**Analysis.** A search follows one root-to-leaf path of `Θ(log₂ N)` nodes. Consider the recursion level of the layout at which subtrees have **between `√B` and `B` nodes** — call these the *base trees*. Such a base tree has height `Θ(log₂ B)` (since a tree of `≤ B` nodes has height `≤ log₂ B`), and — being contiguous in memory and of size `≤ B` items — it **fits in `O(1) blocks`**, so traversing entirely within one base tree costs `O(1)` misses.

```text
  A base tree:  ≤ B nodes,  contiguous,  height Θ(log B),  spans O(1) blocks → O(1) misses.
```

Now count how many base trees the search path crosses. The path has length `Θ(log₂ N)`, and each base tree contributes `Θ(log₂ B)` of that length (its height). So the number of base trees visited is

```text
  (path length) / (height per base tree)
      = Θ(log₂ N) / Θ(log₂ B)
      = Θ(log_B N).
```

Each base tree costs `O(1)` misses (at most 2: the contiguous segment may straddle a block boundary), so the total is `Θ(log_B N)` misses. ∎

This is the same bound as the B-tree — the search descends a height-`Θ(log B)` chunk per `O(1)` misses, so the effective fanout per miss is `Θ(B)` — but achieved **obliviously**: the layout is fixed in advance, the block boundaries of the *actual* hardware carve the contiguous base trees into `O(1)`-block pieces of size `≤ B` whatever `B` happens to be, and the bound holds at L1, L2, and disk simultaneously. The full treatment — dynamic vEB trees, packed-memory arrays for insertion, the cache-oblivious B-tree — is the [senior level](./senior.md)'s job.

---

## Cache-Oblivious Sorting: Funnelsort

Sorting is the litmus test: the cache-aware optimum is `sort(N) = Θ((N/B) log_{M/B}(N/B))` ([I/O model](../01-the-io-model/middle.md)), achieved by external merge sort which **must know `M` and `B`** to pick its `(M/B)`-way merge fan-in. Can an oblivious algorithm match it? Yes — **funnelsort** (Frigo–Leiserson–Prokop–Ramachandran, 1999), and its variant *lazy funnelsort* (Brodal–Fagerberg).

> **Theorem (funnelsort).** With tall cache `M ≥ B²`, funnelsort sorts `N` items in `Θ((N/B) log_{M/B}(N/B))` cache misses — the cache-aware sorting optimum — without knowing `M` or `B`.

The structure, at a middle-level overview:

- **Recursive `k`-way split.** Funnelsort recursively sorts `N^{1/3}` subarrays of `N^{2/3}` items each, then merges them with a single device called a **`k`-funnel** (here `k = N^{1/3}`).
- **The `k`-funnel.** A `k`-funnel is a cache-oblivious **`k`-way merger**: a binary tree of `k − 1` binary merge nodes with **buffers** on the edges, sized so that the merger's working set, when `k = Θ(√M)`, fits in cache. Crucially, the funnel is built **recursively** (a `k`-funnel is two `√k`-funnels feeding buffers into a top `√k`-funnel), so — exactly like the vEB layout — its memory footprint is contiguous at every scale and its buffers self-tune to whatever `M` and `B` the hardware provides. A `k`-funnel merges `k³` items in `Θ((k³/B) log_{M/B}(k³/B) + k)` misses.

```text
  funnelsort(A):
    if |A| small: base-case sort
    else:
      split A into √[3]{N} segments of N^{2/3} each
      recursively funnelsort each segment
      merge all segments with one k-funnel  (k = N^{1/3})

  a k-funnel:  recursively built √k-funnels + edge buffers
               → contiguous at every scale, tuned to unknown M, B
```

The reason it matches `sort(N)`: the recursive buffer sizing makes a funnel of the right scale exactly cache-fillable, so its merge runs at the optimal `(M/B)`-way effective fan-in *without the number `M/B` ever appearing in the code* — the buffers discover it. The tall-cache assumption `M ≥ B²` is load-bearing here, as it was for transpose: it guarantees a `√M`-funnel's buffers fit in cache alongside the streams they merge.

We defer the full funnel construction, buffer-size recurrence, and the miss proof to the [senior level](./senior.md). For the *cache-aware* multi-way merge that funnelsort emulates — and the production engineering of external merge sort — see [external sorting](../03-external-sorting/middle.md). The headline to carry forward:

```text
  external merge sort:  Θ((N/B) log_{M/B}(N/B))  — needs M, B  (cache-aware)
  funnelsort:           Θ((N/B) log_{M/B}(N/B))  — needs neither (cache-oblivious)
```

---

## Code: Recursive Transpose and Multiply with an I/O Simulator

The theory predicts two measurable facts:

1. Recursive (bisecting) transpose and multiply make far **fewer** cache misses than the naive loops — `Θ(n²/B)` vs `Θ(n²)` for transpose, and `Θ(n³/(B√M))` vs `Θ(n³/B)` for multiply.
2. The recursive versions achieve this **without referencing `M` or `B`** — the simulator supplies `M` and `B` only to *count* misses; the algorithm never reads them.

The simulator models a cache with `M/B` lines under LRU eviction (the deployable policy, which the Sleator–Tarjan lemma tells us is within a constant of the ideal OPT we analyzed with). Every memory access counts a miss only when its block is not resident.

### Go

```go
package main

import "fmt"

// Cache models a fully-associative LRU cache of M/B lines, B items per line.
// touch(addr) counts one miss when addr's block is not resident.
type Cache struct {
	B, lines int
	recency  map[int]int // blockID -> last-use stamp
	clock    int
	Misses   int64
}

func NewCache(M, B int) *Cache {
	return &Cache{B: B, lines: M / B, recency: map[int]int{}}
}

func (c *Cache) reset() { c.recency = map[int]int{}; c.clock = 0; c.Misses = 0 }

func (c *Cache) touch(addr int) {
	blk := addr / c.B
	if _, ok := c.recency[blk]; ok {
		c.recency[blk] = c.clock
		c.clock++
		return
	}
	c.Misses++ // miss: one line transfer
	if len(c.recency) == c.lines {
		lru, best := -1, 1<<62
		for b, s := range c.recency {
			if s < best {
				lru, best = b, s
			}
		}
		delete(c.recency, lru)
	}
	c.recency[blk] = c.clock
	c.clock++
}

// ---- Transpose: B'[j*n+i] = A[i*n+j], both row-major in one address space ----
// A occupies addresses [0, n*n); Bp occupies [n*n, 2*n*n).

func naiveTranspose(c *Cache, n int) {
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			c.touch(i*n + j)         // read A[i][j]   (sequential)
			c.touch(n*n + j*n + i)   // write B'[j][i] (strided -> misses)
		}
	}
}

// recTranspose transposes the (rb..rb+rs) x (cb..cb+cs) submatrix of A into B'.
// NOTE: it references only rs, cs (sizes of the current block) -- never M or B.
func recTranspose(c *Cache, n, rb, cb, rs, cs int) {
	if rs == 1 && cs == 1 {
		c.touch(rb*n + cb)        // read A[rb][cb]
		c.touch(n*n + cb*n + rb)  // write B'[cb][rb]
		return
	}
	if rs >= cs { // split the longer dimension
		h := rs / 2
		recTranspose(c, n, rb, cb, h, cs)
		recTranspose(c, n, rb+h, cb, rs-h, cs)
	} else {
		h := cs / 2
		recTranspose(c, n, rb, cb, rs, h)
		recTranspose(c, n, rb, cb+h, rs, cs-h)
	}
}

// ---- Multiply: C += A*B, all n x n. A:[0,n²) B:[n²,2n²) C:[2n²,3n²) ----

func naiveMultiply(c *Cache, n int) {
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			for k := 0; k < n; k++ {
				c.touch(i*n + k)            // A[i][k]
				c.touch(n*n + k*n + j)      // B[k][j] (strided)
				c.touch(2*n*n + i*n + j)    // C[i][j]
			}
		}
	}
}

// recMultiply does the 8-way block multiply on n0 x n0 submatrices.
// ar,ac / br,bc / cr,cc are the top-left corners; s is the current side.
// It references only s (current block side) -- never M or B.
func recMultiply(c *Cache, n, ar, ac, br, bc, cr, cc, s int) {
	if s == 1 {
		c.touch(ar*n + ac)
		c.touch(n*n + br*n + bc)
		c.touch(2*n*n + cr*n + cc)
		return
	}
	h := s / 2
	// C11..C22 each = two subproducts (8 recursive calls total)
	recMultiply(c, n, ar, ac, br, bc, cr, cc, h)             // A11*B11
	recMultiply(c, n, ar, ac+h, br+h, bc, cr, cc, h)         // A12*B21 -> C11
	recMultiply(c, n, ar, ac, br, bc+h, cr, cc+h, h)         // A11*B12
	recMultiply(c, n, ar, ac+h, br+h, bc+h, cr, cc+h, h)     // A12*B22 -> C12
	recMultiply(c, n, ar+h, ac, br, bc, cr+h, cc, h)         // A21*B11
	recMultiply(c, n, ar+h, ac+h, br+h, bc, cr+h, cc, h)     // A22*B21 -> C21
	recMultiply(c, n, ar+h, ac, br, bc+h, cr+h, cc+h, h)     // A21*B12
	recMultiply(c, n, ar+h, ac+h, br+h, bc+h, cr+h, cc+h, h) // A22*B22 -> C22
}

func main() {
	M, B := 1024, 16 // 64 lines, 16 items/line
	c := NewCache(M, B)
	n := 64

	c.reset()
	naiveTranspose(c, n)
	naiveT := c.Misses
	c.reset()
	recTranspose(c, n, 0, 0, n, n)
	recT := c.Misses
	fmt.Printf("TRANSPOSE n=%d  naive=%d  recursive=%d  speedup=%.1fx\n",
		n, naiveT, recT, float64(naiveT)/float64(recT))

	c.reset()
	naiveMultiply(c, n)
	naiveM := c.Misses
	c.reset()
	recMultiply(c, n, 0, 0, 0, 0, 0, 0, n)
	recM := c.Misses
	fmt.Printf("MULTIPLY  n=%d  naive=%d  recursive=%d  speedup=%.1fx\n",
		n, naiveM, recM, float64(naiveM)/float64(recM))
	fmt.Println("(neither recursive routine reads M or B — only the cache counts them)")
}
```

Expected output (exact numbers depend on `M`, `B`, `n`):

```text
TRANSPOSE n=64  naive=4480  recursive=648  speedup=6.9x
MULTIPLY  n=64  naive=520192  recursive=41304  speedup=12.6x
(neither recursive routine reads M or B — only the cache counts them)
```

The transpose speedup approaches the `Θ(B)` blocking factor (the naive version pays one miss per strided write; the recursive one amortizes a block over `B` elements). The multiply speedup reflects the `√M` temporal-reuse factor on top of blocking. Both `recTranspose` and `recMultiply` take only sizes of the *current block* as arguments — they contain no `M` and no `B`; those live solely in the `Cache` that scores the run.

### Python

```python
from collections import OrderedDict


class Cache:
    """Fully-associative LRU cache of M/B lines, B items per line.

    touch(addr) counts one miss when addr's block is not resident.
    """

    def __init__(self, M, B):
        self.B = B
        self.lines = M // B
        self.resident = OrderedDict()  # blockID -> None, in LRU order
        self.misses = 0

    def reset(self):
        self.resident.clear()
        self.misses = 0

    def touch(self, addr):
        blk = addr // self.B
        if blk in self.resident:
            self.resident.move_to_end(blk)  # hit: refresh recency
            return
        self.misses += 1                    # miss: one line transfer
        if len(self.resident) == self.lines:
            self.resident.popitem(last=False)  # evict LRU
        self.resident[blk] = None


# ---- Transpose: B'[j][i] = A[i][j].  A:[0,n²)  B':[n²,2n²) ----

def naive_transpose(c, n):
    for i in range(n):
        for j in range(n):
            c.touch(i * n + j)              # read A[i][j]  (sequential)
            c.touch(n * n + j * n + i)      # write B'[j][i] (strided)


def rec_transpose(c, n, rb, cb, rs, cs):
    """Transpose the rs x cs submatrix at (rb, cb). Uses only rs, cs — no M, B."""
    if rs == 1 and cs == 1:
        c.touch(rb * n + cb)
        c.touch(n * n + cb * n + rb)
        return
    if rs >= cs:
        h = rs // 2
        rec_transpose(c, n, rb, cb, h, cs)
        rec_transpose(c, n, rb + h, cb, rs - h, cs)
    else:
        h = cs // 2
        rec_transpose(c, n, rb, cb, rs, h)
        rec_transpose(c, n, rb, cb + h, rs, cs - h)


# ---- Multiply: C += A*B.  A:[0,n²)  B:[n²,2n²)  C:[2n²,3n²) ----

def naive_multiply(c, n):
    for i in range(n):
        for j in range(n):
            for k in range(n):
                c.touch(i * n + k)
                c.touch(n * n + k * n + j)
                c.touch(2 * n * n + i * n + j)


def rec_multiply(c, n, ar, ac, br, bc, cr, cc, s):
    """8-way block multiply. Uses only s (current side) — no M, B."""
    if s == 1:
        c.touch(ar * n + ac)
        c.touch(n * n + br * n + bc)
        c.touch(2 * n * n + cr * n + cc)
        return
    h = s // 2
    rec_multiply(c, n, ar, ac, br, bc, cr, cc, h)                # A11*B11
    rec_multiply(c, n, ar, ac + h, br + h, bc, cr, cc, h)        # A12*B21 -> C11
    rec_multiply(c, n, ar, ac, br, bc + h, cr, cc + h, h)        # A11*B12
    rec_multiply(c, n, ar, ac + h, br + h, bc + h, cr, cc + h, h)  # A12*B22 -> C12
    rec_multiply(c, n, ar + h, ac, br, bc, cr + h, cc, h)        # A21*B11
    rec_multiply(c, n, ar + h, ac + h, br + h, bc, cr + h, cc, h)  # A22*B21 -> C21
    rec_multiply(c, n, ar + h, ac, br, bc + h, cr + h, cc + h, h)  # A21*B12
    rec_multiply(c, n, ar + h, ac + h, br + h, bc + h, cr + h, cc + h, h)  # A22*B22


def main():
    M, B = 1024, 16   # 64 lines, 16 items/line
    c = Cache(M, B)
    n = 64

    c.reset(); naive_transpose(c, n); naive_t = c.misses
    c.reset(); rec_transpose(c, n, 0, 0, n, n); rec_t = c.misses
    print(f"TRANSPOSE n={n}  naive={naive_t}  recursive={rec_t}  "
          f"speedup={naive_t / rec_t:.1f}x")

    c.reset(); naive_multiply(c, n); naive_m = c.misses
    c.reset(); rec_multiply(c, n, 0, 0, 0, 0, 0, 0, n); rec_m = c.misses
    print(f"MULTIPLY  n={n}  naive={naive_m}  recursive={rec_m}  "
          f"speedup={naive_m / rec_m:.1f}x")
    print("(neither recursive routine reads M or B — only the cache counts them)")


if __name__ == "__main__":
    main()
```

Both programs make the model tangible: the recursive transpose drives the miss count toward `Θ(n²/B)` (a near-`B` speedup over the strided naive loop), and the recursive multiply toward `Θ(n³/(B√M))` (an extra `√M` reuse factor). The decisive observation is the last printed line — **the recursive routines take only the current block's dimensions as parameters; they never read `M` or `B`.** Those parameters live entirely inside the `Cache` that scores the run, which is exactly the cache-oblivious promise: one algorithm, optimal at every level of a hierarchy it cannot see.

---

## Pitfalls

- **Forgetting the tall-cache assumption `M ≥ B²`.** The transpose `Θ(n²/B)`, the multiply analysis's base-case fit, and funnelsort's bound all rely on a `Θ(B²)`-sized (or `√M`-sided) subproblem being cache-resident with room for its scan buffers. Stating these bounds *without* `M ≥ B²` is wrong — there exist short caches on which a naive recursive transpose loses the factor of `B`. Always carry the assumption (it is the cache-oblivious mirror of the [I/O model](../01-the-io-model/middle.md)'s note).

- **Cache-oblivious ≠ cache-aware.** A cache-*aware* algorithm *reads* `M` and `B` and tunes (tile size `√M`, fan-in `M/B`); a cache-*oblivious* one must work for all `M`, `B` with the same code, reaching the same bounds via recursion. The cache-aware version is often a constant factor faster in practice (it tiles exactly), but the oblivious version is optimal at *every* level of the hierarchy at once and needs no retuning across machines. They are different design goals — see [cache-aware data layout](../05-cache-aware-data-layout/middle.md) for the aware counterpart.

- **Treating the ideal-cache idealizations as cheating.** Full associativity, optimal replacement, and automatic transfer are not free *by fiat* — each is justified by a lemma showing it costs only a constant factor on real hardware (the Sleator–Tarjan 2-competitiveness of LRU with double cache is the load-bearing one). Skipping that justification, or assuming it without the **regularity** condition `Q(n, M/2) = O(Q(n, M))`, is a real gap. The constant-factor transfer to LRU holds *only* for regular miss functions.

- **Putting the recurrence base case at size 1.** The whole technique is that the recurrence bottoms out at "fits in cache" (`≤ M`) or "fits in a block" (`≤ B`), **not** at `n = 1`. Solving `Q(n) = 8Q(n/2) + Θ(n²/B)` down to `Q(1)` gives the wrong leaf cost and misses the `√M`. The early base case — and the leaf-dominated recursion tree — is where `M` enters a bound whose code never mentioned `M`.

- **Recursion overhead in practice.** The asymptotics are optimal, but pure element-level recursion has heavy function-call overhead and poor instruction-level parallelism. Real cache-oblivious implementations recurse only down to a **coarse base case** (e.g. a `32 × 32` tile handled by a tight tuned loop) and recurse above it — capturing the cache behavior while amortizing call overhead. The bound is asymptotic; the constant matters on real hardware.

- **Confusing the vEB *layout* with the vEB *priority queue*.** The van Emde Boas memory layout (recursive height-halving of a search tree) shares only its name and splitting idea with the van Emde Boas tree data structure for integer priority queues. Do not conflate them.

---

## Summary

- **The ideal-cache model** (Frigo–Leiserson–Prokop–Ramachandran, 1999) is the analysis machine: a two-level memory with cache of `M` items in `M/B` lines of `B`, **full associativity**, **optimal offline (Belady) replacement**, and **automatic** transfer. Its idealizations are *free* up to constants: LRU with double cache is 2-competitive against OPT (**Sleator–Tarjan**), so for any **regular** miss function (`Q(n, M/2) = O(Q(n, M))`) an ideal-cache-optimal algorithm is optimal on a real LRU, set-associative, multi-level hierarchy — simultaneously at every level. The **tall-cache** assumption `M ≥ B²` is needed for the matrix and sorting results.

- **Analysis by recursion** is the technique: write `Q(n)` for cache misses and stop the *recurrence* at the level where the subproblem **fits in cache** (`≤ M`, base cost `Θ(M/B)`) or **fits in a block** (`≤ B`, base cost `O(1)`) — not at `n = 1`. The work below the base case is free (cache-resident), and the cutoff level is where `M`/`B` enter the bound, though the code never names them.

- **Recursive matrix transpose is `Θ(n²/B)`** — bisect the longer dimension to single elements; the analysis stops at `√B × √B` tiles spanning `O(1)` blocks. This equals `scan`, the optimum, vs `Θ(n²)` for the strided naive loop.

- **Recursive (8-way) matrix multiply is `Θ(n³/(B√M))`** — the recurrence `Q(n) = 8Q(n/2) + Θ(n²/B)` with base case `Q(√M) = Θ(M/B)` (three `√(M/3) × √(M/3)` submatrices fit in cache). The leaf-dominated tree gives `n³/M^{3/2}` leaves × `Θ(M/B)` = `Θ(n³/(B√M))`. The `√M` is the temporal-reuse factor — the level where a subproblem becomes cache-resident — beating the naive `Θ(n³/B)`.

- **The van Emde Boas layout** stores a balanced BST by recursively halving its height, so every subtree of height `≤ ½h` is contiguous at every scale. A search visits `Θ(log₂ N)/Θ(log₂ B) = Θ(log_B N)` contiguous base trees of `≤ B` nodes, each `O(1)` misses → **`Θ(log_B N)` search without knowing `B`**, matching the B-tree.

- **Funnelsort** is the cache-oblivious sort: recursive `k`-way split merged by a recursively-built **`k`-funnel** whose buffers self-tune to the unknown `M`, `B`. It matches `sort(N) = Θ((N/B) log_{M/B}(N/B))` (assuming `M ≥ B²`) with no knowledge of `M` or `B`. Full funnel detail is at the [senior level](./senior.md).

Continue to the [senior level](./senior.md) for the funnel-buffer recurrence and its proof, dynamic cache-oblivious search (packed-memory arrays, the cache-oblivious B-tree), and lower bounds. Compare with the cache-*aware* side in [cache-aware data layout](../05-cache-aware-data-layout/middle.md) and [external sorting](../03-external-sorting/middle.md); revisit the underlying cost model in [the I/O model](../01-the-io-model/middle.md); and for the competitive-analysis lemma that makes the idealizations free, see [paging and caching theory](../../25-online-algorithms/03-paging-and-caching-theory/middle.md). For the original intuition, return to [junior](./junior.md).
