# Cache-Oblivious Algorithms — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the ideal-cache model `(M, B)` with optimal replacement and full associativity, the tall-cache assumption `M = Ω(B²)`, recursive matrix transpose and multiply, the **van Emde Boas (vEB) layout** giving `Θ(log_B N)` search, and the funnelsort *overview*
- [The I/O Model — Senior](../01-the-io-model/senior.md) — the two-level `(N, M, B)` model, the four canonical bounds, the sorting/permuting lower bounds proved by permutation-counting, and the buffer-tree batched-update bound
- [External Sorting — Senior](../03-external-sorting/senior.md) — `(M/B)`-way external merge sort, the cache-*aware* target funnelsort must match obliviously
- [B-Tree I/O Analysis — Senior](../04-b-tree-io-analysis/senior.md) — the cache-aware `Θ(log_B N)` search structure whose oblivious counterpart (the cache-oblivious B-tree) is built here

## Table of Contents

1. [What Senior-Level Cache-Obliviousness Is About](#what-senior-level-cache-obliviousness-is-about)
2. [Funnelsort in Full: the k-Funnel and Lazy Merging](#funnelsort-in-full-the-k-funnel-and-lazy-merging)
3. [The Funnelsort I/O Recurrence](#the-funnelsort-io-recurrence)
4. [Lazy Funnelsort and Distribution Sort](#lazy-funnelsort-and-distribution-sort)
5. [The Packed-Memory Array and Ordered-File Maintenance](#the-packed-memory-array-and-ordered-file-maintenance)
6. [The Cache-Oblivious B-Tree: vEB over a PMA](#the-cache-oblivious-b-tree-veb-over-a-pma)
7. [Cache-Oblivious Priority Queues: the Funnel Heap](#cache-oblivious-priority-queues-the-funnel-heap)
8. [The Necessity of the Tall-Cache Assumption](#the-necessity-of-the-tall-cache-assumption)
9. [Cache-Oblivious vs Cache-Aware: the Permuting Separation](#cache-oblivious-vs-cache-aware-the-permuting-separation)
10. [Parallel and Multicore Cache-Obliviousness](#parallel-and-multicore-cache-obliviousness)
11. [Decision Framework](#decision-framework)
12. [Research Pointers](#research-pointers)
13. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Cache-Obliviousness Is About

The middle level establishes that cache-oblivious algorithms *exist*: a parameter-free, divide-and-conquer program, analyzed in the ideal-cache model of Frigo, Leiserson, Prokop, and Ramachandran (1999), can match the cache-*aware* I/O bound *simultaneously for all `M` and `B`*, because recursion automatically tiles the memory hierarchy at every scale. It shows the mechanism on three static problems — transpose, multiply, and the vEB search layout — and previews funnelsort as the oblivious sorter.

Senior-level cache-obliviousness is about the part the overview defers: **the deep machinery and the *dynamic* structures**, and the **limits** of the paradigm. Four threads:

1. **Optimal oblivious sorting is real, and its analysis is subtle.** Funnelsort attains `Θ((N/B) log_{M/B}(N/B))` — the [I/O sorting lower bound](../01-the-io-model/senior.md) — with no knowledge of `M` or `B`. But the proof rests on a non-obvious structural device, the recursively-laid-out **`k`-funnel** (a `k`-merger), and on the **tall-cache assumption** in an essential, not cosmetic, way. The senior obligation is to see *where* the `log_{M/B}` factor is manufactured by a parameter-blind recursion, and *why* `M = Ω(B²)` is the hinge.

2. **Static obliviousness was the easy half; dynamic obliviousness is the achievement.** A static vEB layout searches in `Θ(log_B N)`, but it is frozen — you cannot insert. Making it *dynamic* required a second idea, the **packed-memory array (PMA)** and its **ordered-file maintenance**, which Bender, Demaine, and Farach-Colton (2000) combined with the vEB layout to build the **cache-oblivious B-tree**: `Θ(log_B N)` search *and* `Θ(log_B N + (log²N)/B)` amortized updates, obliviously. This is the central senior result of the topic.

3. **The paradigm has provable limits.** Brodal and Fagerberg (2003) proved the tall-cache assumption is *necessary* — some problems (oblivious sorting among them) provably cannot be solved optimally without it — and, more sharply, that **permuting separates cache-oblivious from cache-aware**: no cache-oblivious algorithm matches the cache-aware permuting bound across all regimes. Cache-obliviousness is *almost* free, but not entirely. Knowing where the seam is is what distinguishes a senior treatment from a marketing one.

4. **It composes with priority queues and with parallelism.** The **funnel heap** (Brodal–Fagerberg) gives a cache-oblivious priority queue at `Θ((1/B) log_{M/B}(N/B))` amortized per operation — respecting the sorting bound, exactly as the buffer tree does cache-*aware*. And cache-obliviousness composes with work-stealing to give algorithms that are simultaneously processor- *and* hierarchy-portable.

The unifying senior stance: **cache-obliviousness trades a known knowledge — `M` and `B` — for a structural discipline (recursive layout) that re-creates the right tiling at every scale, and the price of that trade is a tall-cache regularity condition plus one provable inability (permuting).**

---

## Funnelsort in Full: the k-Funnel and Lazy Merging

External merge sort, cache-*aware*, sorts by repeatedly performing `(M/B)`-way merges — the fan-in is *chosen* to be `M/B`. Funnelsort cannot name `M/B`. Its trick is to replace the single explicit `(M/B)`-way merge with a recursively-structured merger — the **`k`-funnel**, also called a **`k`-merger** — whose recursive layout makes it behave, *at whatever scale fits in cache*, like a memory-sized merge, without ever knowing what that scale is.

### The top-level recursion

> **Funnelsort (Frigo–Leiserson–Prokop–Ramachandran 1999).** To sort `N` elements:
> 1. Split the input into `N^{1/3}` contiguous segments of `N^{2/3}` elements each.
> 2. **Recursively** funnelsort each segment.
> 3. **Merge** the `N^{1/3}` now-sorted segments using an `N^{1/3}`-funnel.

The fan-out `N^{1/3}` and segment size `N^{2/3}` are not arbitrary; they are exactly what makes the funnel's buffer space (below) fit alongside the recursion and what makes the I/O recurrence close to the sorting bound. The whole subtlety is in step 3 — the funnel.

### The k-funnel: a √k-funnel of √k-funnels

A **`k`-funnel** is a device that merges `k` sorted input streams into one sorted output stream of length `k³`. It is built recursively:

> **Structure of a `k`-funnel.** A `k`-funnel is a complete binary tree of binary mergers with `k` leaves (inputs) and one root (output). It is decomposed at the middle level into:
> - one **top `√k`-funnel** (the upper half of the tree), whose `√k` outputs feed
> - `√k` **buffers**, each of size `k^{3/2}`, feeding
> - `√k` **bottom `√k`-funnels** (the lower half), whose combined `k` leaves are the funnel's inputs.

The buffers between the two halves are the load-bearing invention. Each of the `√k` middle buffers holds up to `k^{3/2}` elements; the total buffer space of a `k`-funnel satisfies `S(k) = √k · k^{3/2} + (√k + 1)·S(√k)`, which solves to `S(k) = Θ(k²)`. A `k`-funnel therefore occupies `Θ(k²)` space and is **laid out in memory recursively, van-Emde-Boas style**: the top funnel, then the buffers, then each bottom funnel, each block itself recursively laid out. This contiguous recursive layout is precisely what lets *some* level of the funnel's own recursion fit a sub-funnel into cache, whatever `B` and `M` are.

### Lazy / buffered merging: how the funnel runs

The funnel is driven by a single recursive routine, `Fill`, invoked on the root:

```text
FILL(node v):                          # v is a binary merger with an output buffer
    while v's output buffer is not full:
        if either input buffer of v is empty:
            FILL(child feeding that empty input)   # recursively refill lazily
        perform one merge step:
            move the smaller of the two front elements to v's output buffer
```

The merging is **lazy** (a.k.a. *buffered*): a node does work only when its output buffer is demanded, and it refills an input buffer only when that input runs dry. Work is therefore done in **bursts of buffer-sized chunks**, not element-by-element across the whole tree. This burstiness is what gives the funnel its locality: when `Fill` is invoked on a sub-funnel whose entire footprint fits in cache, it runs to completion entirely in cache, paying I/O only to stream its inputs and outputs — exactly the behavior an `(M/B)`-way merge has, manufactured obliviously.

The senior point: **the buffers convert a global, fine-grained merge into a recursively-nested set of local, coarse-grained merges**, and the recursive layout guarantees that one nesting level coincides with the cache size. The funnel does not *choose* its fan-in; the recursion *discovers* the right effective fan-in at runtime, per hierarchy level.

### Why "lazy" is the load-bearing word

Contrast the lazy schedule with the obvious *eager* one — "always keep every buffer full." Eager merging would touch the whole tree on every output element, scattering accesses across the funnel's `Θ(k²)` footprint and destroying locality the moment the funnel exceeds the cache. Laziness instead concentrates work: a single `Fill` on the root drives down only as far as needed, and when it reaches a sub-funnel whose footprint fits in cache, that sub-funnel's *entire* `Fill` completes before control returns — all its internal buffer-shuffling happens in cache, charged to I/O only once for the load. The buffer between the top and bottom halves is sized at `Θ(k^{3/2})` precisely so that a bottom funnel, once filled, supplies enough output (its buffer is large relative to its own footprint) to amortize the I/O of having loaded it. **The buffer size and the laziness are co-designed: the buffer is big enough that each "load this sub-funnel into cache" event pays for itself across many output elements**, which is the discrete event the funnel lemma's amortization counts.

---

## The Funnelsort I/O Recurrence

The whole funnelsort analysis reduces to one lemma about the `k`-funnel, then a top-level recurrence. This is the worked piece.

### The funnel lemma

> **Lemma.** Under the tall-cache assumption `M = Ω(B²)`, a `k`-funnel with `k ≤ M^{1/3}` (so the funnel and one block per input fit in cache) merges its `k` inputs into `k³` output elements using
> ```text
>    O( (k³ / B) · log_{M/B}(k³/B)  +  k )
> ```
> block I/Os.

**Why.** Pick the largest sub-funnel size `c` such that a `c`-funnel *plus one block for each of its `c` inputs* fits in cache — i.e. `c² + cB = O(M)`. Under the tall-cache assumption `M = Ω(B²)`, this gives `c = Θ(√M)`. By the recursive vEB layout, a `c`-funnel occupies `Θ(c²) = Θ(M)` contiguous memory, so it loads in `O(c²/B + c) = O(M/B)` I/Os and thereafter runs entirely in cache. A `c`-funnel emits `c³` elements per "load," so it amortizes its `O(M/B)` loading cost over `c³` outputs: `O(1/B + 1/c²)` I/Os per element. Streaming `k³` elements through the funnel, viewed as a tree of `c`-funnels of height `O((log k)/(log c))`, charges each element `O((log k)/(log c) · (1/B))` plus the boundary terms. Substituting `c = Θ(√M)` turns `1/log c` into `1/log √M = Θ(1/log M)`, and careful accounting (the tall-cache step is what makes the per-element block-loading cost `1/B` rather than `1`) yields the `log_{M/B}` base. The `+ k` covers touching each input stream at least once.

The single most important line: **the tall-cache assumption is what guarantees `c = Θ(√M)` rather than `c = Θ(M/B)` or worse**, and it is `c = Θ(√M)` that makes a `c`-funnel both (a) cache-resident and (b) able to use a *full block* per input. Lose tall-cache and the funnel can no longer keep one block per input resident, and the bound degrades.

### The top-level recurrence

Let `Q(N)` be the I/O cost of funnelsort on `N` elements. Step 1 splits into `N^{1/3}` subproblems of size `N^{2/3}`; step 3 merges them with an `N^{1/3}`-funnel. Check the sizing: an `N^{1/3}`-funnel has `k = N^{1/3}` inputs and emits `k³ = (N^{1/3})³ = N` elements — exactly the input size, so the funnel is correctly dimensioned to merge all `N^{1/3}` sorted segments in one pass. By the funnel lemma the merge costs `O((N/B) log_{M/B}(N/B) + N^{1/3})`. Hence:

```text
   Q(N)  =  N^{1/3} · Q(N^{2/3})  +  O( (N/B) · log_{M/B}(N/B)  +  N^{1/3} ).
```

**Base case.** When `N ≤ αM` for a suitable constant `α` (the subproblem fits in cache), `Q(N) = O(N/B + 1)` — it loads once and sorts in cache. The recursion stops there.

**Solving.** The merge term `(N/B) log_{M/B}(N/B)` dominates the additive `N^{1/3}` at every level, and the recursion has the shape of a balanced divide-and-conquer where each level does linear-in-`N/B` work scaled by the local log factor. Summing the geometric series of subproblem sizes against the per-level merge cost — and using the base case to truncate at `N = Θ(M)`, removing the recursion levels below cache size — collapses the recurrence to:

```text
   Q(N)  =  O( (N/B) · log_{M/B}(N/B) ).
```

This **matches the Aggarwal–Vitter sorting lower bound** from [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) — and funnelsort achieves it *without naming `M` or `B`*, contingent only on `M = Ω(B²)`. The cache-aware external merge sort hits the same bound by *choosing* fan-in `M/B`; funnelsort hits it by *discovering* the right effective fan-in at the `c = Θ(√M)` level of the funnel's own recursion. Same target, same constant up to the tall-cache slack, different knowledge.

### Grounding the recurrence in numbers

It is worth instantiating the abstraction once. Take `M = 2²⁰` elements (a few-MB cache) and `B = 2¹⁰` elements — comfortably tall, since `M/B = 2¹⁰ ≫ B`... no: `B² = 2²⁰ = M`, so this sits *exactly* at the tall-cache boundary `M = Θ(B²)`; a real L1-over-cacheline ratio is far tallier, but this choice makes the arithmetic clean. The cache-resident funnel size is `c = Θ(√M) = Θ(2¹⁰)`, so a `c`-funnel keeps `c = 2¹⁰` input streams resident with one block of `B = 2¹⁰` each — `c·B = 2²⁰ = M`, the whole cache, which is exactly the budget. A single resident `c`-funnel thus performs an effective `2¹⁰`-way merge in cache, identical to what a cache-aware sorter with `M/B = 2¹⁰` would *choose*. The number of nested funnel levels needed to merge `N` elements is `log_c N = (log N)/(log c) = (log N)/10`, and converting the base gives the `log_{M/B}` form. The lesson the numbers make concrete: **the funnel does not approximate the `(M/B)`-way merge — at the `c = Θ(√M)` level it *reproduces it exactly*, having found `M` and `B` without being told them.**

---

## Lazy Funnelsort and Distribution Sort

### Lazy funnelsort (Brodal–Fagerberg 2002)

The original funnelsort is correct but fiddly: the `k ≤ M^{1/3}` size restriction on funnels, and the requirement that all of a funnel's outputs be consumed before refilling, complicate both implementation and proof. **Lazy funnelsort** (Brodal and Fagerberg, *"Cache Oblivious Distribution Sweeping"*, 2002) is a simplification that has become the standard formulation:

- It relaxes the strict "merge exactly `k³` then stop" discipline to the purely **lazy** `Fill` shown above — a node produces output only on demand and refills inputs only when empty, with **no global synchronization** of how much each funnel has emitted.
- This removes the `k ≤ M^{1/3}` constraint and lets the same recurrence go through with a cleaner amortized argument, while preserving the `O((N/B) log_{M/B}(N/B))` bound under tall-cache.

Lazy funnelsort is the version actually implemented and benchmarked (and the one underpinning cache-oblivious *distribution sweeping* for computational-geometry problems — orthogonal line-segment intersection, batched range queries — where the funnel replaces the merge step of a classic sweepline). The senior takeaway: **the lazy formulation is to funnelsort what the lazy buffer-flush is to the buffer tree — a demand-driven schedule that achieves the same amortized I/O with far less bookkeeping.**

### Distribution sort as the alternative

Funnelsort is the *merge-based* oblivious sorter. There is a *distribution-based* alternative — **cache-oblivious distribution sort**, also from the 1999 FLPR paper — analogous to how quicksort/bucket-sort relate to merge sort:

> **Cache-oblivious distribution sort.** Recursively partition the `N` elements into `Θ(√N)` buckets by `Θ(√N)` carefully chosen pivots (so each bucket gets `O(√N)` elements with high probability / by a balancing step), recursively sort each bucket, and concatenate. The pivot selection and the distribution step are themselves done with a recursive, oblivious *distribution* primitive that streams elements into buckets while maintaining the tall-cache locality.

The distribution step is the delicate part: naively scattering `N` elements into `√N` buckets is a *permutation*, and — as the separation result below shows — permuting cannot be done obliviously at scan cost. The cache-oblivious distribution sort sidesteps this by recursively sizing the distribution so each level's scatter stays within the tall-cache locality envelope, again achieving `O((N/B) log_{M/B}(N/B))`. In practice **funnelsort (merge-based) is preferred** — its constants are smaller and its locality is more robust — but distribution sort matters as proof that the bound is reachable by both algorithmic families, mirroring the merge-vs-distribution duality of internal sorting.

### Distribution sweeping: the geometry payoff

Lazy funnelsort's real practical reach is not sorting per se but **cache-oblivious distribution sweeping** (Brodal–Fagerberg 2002), the oblivious analogue of the classic *plane-sweep* paradigm. A plane-sweep solves a batched geometry problem — orthogonal line-segment intersection, batched orthogonal range searching, all-nearest-neighbors, rectangle stabbing — by sweeping a line across the plane and maintaining a status structure of active objects. The cache-aware external version (Goodrich–Tsay–Vengroff–Vitter's *distribution sweeping*) recursively splits the plane into `Θ(M/B)` vertical slabs and sweeps; the **cache-oblivious** version replaces that fixed `Θ(M/B)`-way split with a **`k`-funnel-driven recursive split**, so the slab count auto-tunes to the cache exactly as funnelsort's fan-in does.

The result is a family of geometry algorithms running in `O((N/B) log_{M/B}(N/B) + T/B)` I/Os (where `T` is the output/report size) — the `sort(N)` class — *obliviously*. The senior point: **the funnel is not a sorting gadget, it is a reusable cache-oblivious `k`-way merge primitive**, and any algorithm whose external-memory version is built around a multiway merge or multiway distribution (sorting, priority queues, plane-sweeps, segment problems) inherits an oblivious version by swapping the explicit `(M/B)`-way step for a funnel. This is why funnelsort, not distribution sort, became the load-bearing construction of the field.

---

## The Packed-Memory Array and Ordered-File Maintenance

The static vEB layout searches in `Θ(log_B N)` but is immutable. To make a *dynamic* cache-oblivious dictionary we need a way to maintain `N` elements **in sorted order in a contiguous array**, supporting insertions and deletions, while keeping the array *almost* contiguous so that scans and the vEB layout over it stay cache-efficient. That is the **ordered-file maintenance (OFM)** problem, and its solution is the **packed-memory array (PMA)**.

### The structure

> **Packed-memory array.** Store `N` ordered elements in an array of size `Θ(N)` (a constant density factor of slack), keeping them in sorted order with **gaps** (empty slots) interspersed so that any contiguous window of the array is neither too dense nor too sparse. An insertion places the new element in its sorted position and, if that locally violates the density bounds, **rebalances** a surrounding window by evenly respreading its elements.

The density discipline is hierarchical. View the array as a complete binary tree of nested windows (sizes `Θ(log N), 2 log N, …, N`). Each tree level has a **density threshold** — an upper and lower bound on how full a window at that level may be — and the thresholds *tighten toward the leaves and loosen toward the root* (a geometric "density gradient"). On insert, walk up from the leaf window containing the insertion point until you find a window within its thresholds, then evenly redistribute the elements of that window.

### The density gradient, concretely

Let the window-tree have height `h = Θ(log N)` levels, indexed `0` (leaf windows, size `Θ(log N)`) up to `h` (the whole array). Assign each level `ℓ` an upper density threshold `τ_ℓ` and lower threshold `ρ_ℓ` that interpolate *linearly* between fixed leaf and root constants:

```text
   upper:  τ_ℓ  =  τ_h  +  (τ_0 − τ_h) · (h − ℓ)/h        (e.g. τ_0 = 1.0  down to  τ_h = 0.5)
   lower:  ρ_ℓ  =  ρ_h  −  (ρ_h − ρ_0) · (h − ℓ)/h        (e.g. ρ_0 = 0.0  up to    ρ_h = 0.25)
```

A window is "in balance" iff its actual density lies in `[ρ_ℓ, τ_ℓ]`. The gradient is what makes the amortization work: when an insert overflows a leaf window's `τ_0`, we walk up to the *nearest ancestor still within its (looser) `τ_ℓ`* and respread that ancestor evenly. Because the per-level threshold gap `τ_ℓ − τ_{ℓ−1} = (τ_0 − τ_h)/h = Θ(1/log N)` is the slack created by one respread, a window at level `ℓ` cannot overflow again until `Θ((1/log N)·|window|)` further inserts have landed in it. That "inserts-until-next-rebalance" count is exactly the denominator of the amortized charge, and it is what turns the worst-case `Θ(N)` respread of the whole array into `O(log² N)` *amortized*.

### The cost

> **OFM / PMA bound (Itai–Konheim–Rodeh 1981; Bender–Demaine–Farach-Colton 2000; Willard).** A PMA supports insert/delete in
> ```text
>    O(log² N)  amortized element moves   and   O(1 + (log² N)/B)  amortized I/Os,
> ```
> while keeping the elements in sorted order in `Θ(N)` contiguous space.

The `log² N` is the signature cost of ordered-file maintenance: the amortized analysis charges `O(log N)` levels of potential rebalancing, each amortizing the respread of `O(log N)` elements per insert (the potential argument against the density gradient above), for `O(log² N)` moves amortized. Because a rebalance respreads a **contiguous** window, those `O(log² N)` moves touch `O(1 + (log² N)/B)` blocks — the moves are sequential, so blocking helps, and this is where the `/B` comes from. The `O(1)` term accounts for the rebalance possibly being smaller than a block. Note the bound is *parameter-free*: nowhere did the PMA name `B`, yet the contiguity of its rebalances makes the I/O cost automatically `B`-efficient — the same obliviousness principle as the funnel, now applied to a dynamic array.

The PMA is the dynamic substrate. Scanning it in order is `O(N/B)` (the gaps add only a constant factor because density is bounded below), and — crucially — it can be **searched obliviously in `Θ(log_B N)`** when overlaid with the vEB-laid-out index, which is the next section.

---

## The Cache-Oblivious B-Tree: vEB over a PMA

Combining the two ideas — the static vEB search layout and the dynamic PMA — yields the **cache-oblivious B-tree** of Bender, Demaine, and Farach-Colton (*"Cache-Oblivious B-Trees"*, FOCS 2000), with the dynamization refined by Brodal, Fagerberg, and Jacob (2002). This is the oblivious answer to the [cache-aware B-tree](../04-b-tree-io-analysis/senior.md).

### The construction

> **Cache-oblivious B-tree (Bender–Demaine–Farach-Colton 2000).** Store the `N` keys in sorted order in a **packed-memory array**. Build a complete **balanced binary search tree** over the PMA slots (the tree's leaves are the PMA positions), and lay that tree out in memory in **van Emde Boas order**. Searches descend the vEB-laid tree; insertions update the PMA (rebalancing a window) and then patch the affected portion of the vEB index.

The two layers cooperate:

- **The vEB-laid tree gives oblivious search.** As established at the middle level, a height-`h` balanced tree laid out by recursively splitting at the middle level into a top tree and `√` -many bottom trees, stored contiguously top-then-bottoms, is traversed root-to-leaf in `Θ(log_B N)` I/Os for *every* `B`, because some recursion level has subtrees of `Θ(B)` size that are block-aligned. The leaves point into the PMA.
- **The PMA gives oblivious dynamism.** Insert into the PMA (cost `O(1 + (log²N)/B)` I/Os to rebalance a contiguous window), then *rebuild the vEB index over exactly the rebalanced window* — the keys in the index are derived bottom-up from the PMA leaves, so only the part of the tree above the moved window changes.

### The bounds

> **Theorem (Bender–Demaine–Farach-Colton 2000; Brodal–Fagerberg–Jacob 2002).** The cache-oblivious B-tree supports
> ```text
>    search:  Θ( log_B N )                     I/Os
>    insert/delete:  Θ( log_B N + (log² N)/B ) I/Os, amortized
>    range query of k elements:  Θ( log_B N + k/B )
> ```
> all *without knowledge of `M` or `B`*, requiring only the tall-cache assumption.

**Reading the update bound.** The `log_B N` is the search to find the insertion point (descend the vEB tree). The `(log²N)/B` is the PMA rebalance — the ordered-file maintenance cost — *plus* the index patch, which is dominated by the same window. In the realistic regime where `B` is large (`B = Ω(log²N / log_B N)`), the `(log²N)/B` term is absorbed and updates cost an effectively-optimal `Θ(log_B N)` — matching the cache-aware B-tree's update cost obliviously. Only for small blocks does the `(log²N)/B` overhead surface. Worst-case (de-amortized) variants exist (Bender–Cole–Demaine–Farach-Colton–Zito), trading the amortized PMA bound for a worst-case one at constant-factor cost.

**A trace of one insertion.** Following a single insert through both layers makes the cooperation concrete:

```text
INSERT(key x):
  1. SEARCH:    descend the vEB-laid index from the root to the PMA slot
                where x belongs.                          # Θ(log_B N) I/Os
  2. PLACE:     write x into a gap at that PMA position (if a gap is adjacent).
  3. REBALANCE: if the leaf window now exceeds its density τ_0,
                walk up to the nearest ancestor window within its τ_ℓ
                and respread that window's elements evenly.   # O(1 + (log²N)/B) I/Os
  4. PATCH:     recompute the index keys above exactly the respread window,
                bottom-up from the moved PMA leaves.       # subsumed by the window
```

Steps 3 and 4 touch the *same* contiguous region, so their costs do not stack — the index patch rides along on the blocks the rebalance already pulled in. This is why the update bound is `Θ(log_B N + (log²N)/B)` and not `Θ(log_B N · (log²N)/B)`: the two layers share a working set.

**Why this is the marquee dynamic result.** The static vEB layout (middle level) was a *layout trick*. Making it dynamic required solving ordered-file maintenance — an entirely separate, decade-older problem (Itai–Konheim–Rodeh, Willard) — and recognizing that a PMA's *contiguity* is exactly what a vEB index needs underneath it. The cache-oblivious B-tree is the proof that the full cache-aware B-tree functionality — search, insert, delete, range — survives parameter-blindness up to the tall-cache condition and a small-block `(log²N)/B` term. It is also the template for the **cache-oblivious string B-tree** and oblivious dynamic dictionaries that followed: the recurring recipe is *"a parameter-free static layout (vEB) over a parameter-free dynamic substrate (PMA)."*

---

## Cache-Oblivious Priority Queues: the Funnel Heap

The last classic dynamic structure is the **cache-oblivious priority queue**, achieving the same per-operation amortized cost as the cache-*aware* buffer-tree-based priority queue.

> **Theorem (Brodal–Fagerberg 2002, the funnel heap; also Arge–Bender–Demaine–Holland-Minkley–Munro 2002).** A cache-oblivious priority queue supports `insert`, `delete-min`, and `delete` in
> ```text
>    O( (1/B) · log_{M/B}(N/B) )   I/Os amortized per operation.
> ```

This is `sort(N)/N` per operation — exactly the [buffer-tree batched bound](../01-the-io-model/senior.md), reached obliviously. Processing `N` operations costs `Θ(sort(N))`, so the priority queue **respects the sorting bound**: you cannot do `N` priority-queue operations faster than you can sort, and the funnel heap meets that floor.

### The structure, briefly

The **funnel heap** (Brodal–Fagerberg) is built directly from the `k`-merger of funnelsort: it is a sequence of `k`-funnels of geometrically increasing size, linked into a single tree, with insertion buffers at the top. The key invariants:

- **Inserts** drop into a small top buffer; when it fills, its contents are merged (via a small funnel) into the next-larger level — lazily, exactly like a buffer flush.
- **Larger levels are larger funnels**, so elements migrate downward through funnels of increasing size, each migration amortizing its cost over the funnel's output volume — the same `Θ(1/B · log_{M/B})` per element that the funnel lemma delivers.
- **Delete-min** reads from the top of the structure, which the lazy merging keeps populated with the global minimum's neighborhood.

The funnel heap is, in effect, **funnelsort run incrementally as a data structure**: the same recursively-laid funnels, the same lazy buffered merging, the same tall-cache-dependent locality, but driven online by insert/delete-min instead of by a one-shot sort. This is why its bound is the sorting bound per element — it *is* an online sorter. The senior connection: the buffer tree, the cache-aware external priority queue, and the funnel heap are three realizations of one idea — *batch updates through buffers so each element pays `sort(N)/N`* — differing only in whether they name `M` and `B` (buffer tree: yes; funnel heap: no).

---

## The Necessity of the Tall-Cache Assumption

Every optimal result above carries the rider "under the tall-cache assumption `M = Ω(B²)`." A senior reader must know whether that is a *convenience* of the proofs or a *genuine necessity*. Brodal and Fagerberg settled it: **it is a necessity.**

> **Theorem (Brodal–Fagerberg, "On the Limits of Cache-Obliviousness," STOC 2003).** There is no cache-oblivious comparison-based sorting algorithm that achieves the optimal `O((N/B) log_{M/B}(N/B))` I/O bound for *all* combinations of `M` and `B`. In particular, no cache-oblivious sorter is optimal when the cache is **not** tall — when `B` is allowed to be as large as `Θ(M)` (a "flat" cache, `M = Θ(B)`).

### What the theorem says, precisely

The result is a *separation between cache-oblivious and cache-aware sorting in the flat-cache regime*. A cache-*aware* algorithm told `M = Θ(B)` can still sort optimally (it adapts its fan-in). A cache-*oblivious* algorithm, forced to behave well at *all* `(M, B)` simultaneously, **cannot** be optimal when `M = Θ(B)` — there is a specific adversarial `(M, B)` pair on which any fixed oblivious sorting strategy provably pays more than `O((N/B) log_{M/B}(N/B))`.

The intuition: an oblivious algorithm commits to *one* memory-access pattern (one recursive layout, one schedule) that must serve every `(M, B)`. The funnelsort lemma needed `c = Θ(√M)` so that a cache-resident funnel could keep *one full block per input* — that requires `M ≥ c·B = Θ(√M · B)`, i.e. `M = Ω(B²)`. When `M = Θ(B)`, a cache holds only `O(1)` blocks, so a multi-way merge can keep at most `O(1)` input streams' blocks resident, and no fixed oblivious schedule can simulate the high-fan-in merge the bound demands. A cache-aware algorithm escapes by knowing it is in the flat regime and choosing a different (binary, or external-memory-of-its-own) strategy; the oblivious one has no such fork.

### Why this matters

- **It justifies the rider.** Every "optimal cache-oblivious" claim for sorting, distribution, transpose, and the funnel heap is *conditioned* on tall-cache, and that condition is not removable — it is the precise boundary of what obliviousness can achieve for these problems.
- **It is benign in practice.** Real hierarchies are emphatically tall: an L1 of 32 KiB over 64-byte lines has `M/B ≈ 512`, and `M ≈ 512·B ≫ B²`-comfortably in element terms; the same holds at every level out to disk. The flat-cache adversary is a theoretical regime, not a machine. But the *honest* senior statement is "optimal under `M = Ω(B²)`, provably not without it," never an unqualified "optimal."

The structural lesson generalizes: **a cache-oblivious algorithm must succeed against a quantifier — `for all (M, B)` — that a cache-aware algorithm gets to instantiate.** Most of the time the recursion satisfies the quantifier for free; the tall-cache necessity theorem marks the place where it cannot.

---

## Cache-Oblivious vs Cache-Aware: the Permuting Separation

The tall-cache necessity is a separation *within* sorting (flat vs tall). There is a second, sharper separation that holds even with tall caches and even for a problem *easier* than sorting: **permuting**.

Recall from [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) the cache-aware permuting bound: `perm(N) = Θ(min(N, (N/B) log_{M/B}(N/B)))` — permuting costs the *minimum* of the naive `N` (move each element once) and the sorting cost. The cache-aware algorithm achieves this by *checking which branch wins*: if `B log(M/B) ≥ log(N/B)` it moves elements one at a time for `O(N)` I/Os; otherwise it sorts-by-destination for `sort(N)`.

> **Theorem (Brodal–Fagerberg 2003).** There is **no** cache-oblivious algorithm for permuting that achieves `O(min(N, sort(N)))` I/Os for all `M` and `B`. Cache-oblivious permuting is *strictly* harder than cache-aware permuting in some regime.

### Why permuting, of all things

The proof exploits exactly the `min` that defines the cache-aware bound. The two branches — `N` and `sort(N)` — cross over at a value of `B` and `M/B` that the cache-aware algorithm *can test* and the cache-oblivious algorithm *cannot*. An oblivious algorithm must commit to one access pattern; if it behaves like "move one at a time" it pays `Θ(N)` even in regimes where `sort(N) ≪ N`, and if it behaves like "sort by destination" it pays `Θ(sort(N))` even in regimes where `N ≪ sort(N)`. Because it cannot see `M` and `B`, it cannot pick the smaller branch per machine, and an adversary chooses the `(M, B)` that punishes whichever branch the fixed strategy resembles. The cache-aware algorithm's single `if` statement is precisely the power the oblivious model is denied.

### The honest general statement

This crystallizes the boundary of the entire paradigm:

> **For *most* problems, cache-oblivious algorithms match cache-aware ones to within constant factors** — sorting (tall cache), FFT, matrix transpose and multiply, searching (`log_B N`), the B-tree, the priority queue. **For permuting, they provably cannot** match the cache-aware bound across all regimes; and for sorting, the match requires the tall-cache assumption (also provably necessary).

So the marketing claim "cache-oblivious is as good as cache-aware" is *true with two named exceptions*: it needs tall caches (necessary, Brodal–Fagerberg) and it cannot match cache-aware *permuting* (also Brodal–Fagerberg). A senior engineer states the claim *with* its exceptions; the exceptions are the difference between a folk belief and a theorem. The practical upshot is mild — permuting is rarely the operation you obliviously optimize, and real caches are tall — but the conceptual upshot is sharp: **`M` and `B` carry exactly one bit of irreducible power, the ability to choose between two branches at their crossover, and permuting is the problem that forces that choice.**

---

## Parallel and Multicore Cache-Obliviousness

Cache-obliviousness was conceived for the *sequential* memory hierarchy, but it extends to multicore — and the extension is one of its most attractive properties, because the same parameter-blindness that handles unknown `B` and `M` also handles an unknown *number of cores* and an unknown *shared/private cache split*.

### The model and the result

Multicore machines have a hierarchy that is partly **private** (each core's L1/L2) and partly **shared** (a common L3 / last-level cache). A cache-aware parallel algorithm would have to tune to the private sizes, the shared size, *and* the core count — a brittle three-way tuning. The cache-oblivious approach instead pairs a recursive, parameter-free algorithm with a **work-stealing scheduler** (the Cilk model: a fork-join program whose `spawn`/`sync` recursion is scheduled by randomized work-stealing).

> **Theorem (Frigo–Strumpen; Blelloch–Gibbons–Simhadri and successors).** A cache-oblivious fork-join algorithm with sequential cache complexity `Q(N; M, B)` and span (critical-path length) `S(N)`, scheduled by randomized work-stealing on `P` processors, incurs **shared-cache** misses `Q(N; M, B) + O(P · (M/B) · S(N))` and **private-cache** misses bounded by the sequential `Q` plus a steal-proportional overhead.

The `(M, B)`-obliviousness is preserved across the hierarchy: the recursion that tiled the sequential cache *also* generates parallelism (each recursive split is a `spawn`), so the same divide-and-conquer simultaneously (a) tiles every memory level and (b) exposes `Θ(N/M)`-ish parallelism. The extra term `O(P·(M/B)·S(N))` is the cost of steals "polluting" caches — bounded because work-stealing has provably few steals (`O(P·S)` whp), and each steal pollutes at most a cache's worth.

### The takeaway

The senior framing: **a well-designed cache-oblivious divide-and-conquer is a "two-for-one" — its recursion is simultaneously the source of cache-locality and the source of fork-join parallelism**, and a work-stealing scheduler turns the first into the second with provably small overhead. This is why cache-oblivious matrix multiply and sort port to multicore essentially unchanged, where cache-aware blocked code must re-tune block sizes to the private/shared split. The cost is the same as in the sequential case: tall-cache regularity, and constant factors that a hand-tuned cache-aware-plus-thread-tuned implementation can still beat on a *fixed* machine. The trade is, once again, **portability and multi-level/multi-core optimality versus single-machine peak constants.**

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Sort portably, optimal at every hierarchy level | **(Lazy) funnelsort** (needs `M = Ω(B²)`) | `Θ((N/B) log_{M/B}(N/B))` obliviously; discovers fan-in at the `c=Θ(√M)` funnel level |
| Sort on a fixed machine, one dominant level | **Cache-aware `(M/B)`-way merge sort** ([external sorting](../03-external-sorting/senior.md)) | Tunes fan-in to actual `M/B`; smaller constants than a funnel |
| Dynamic ordered dictionary, portable | **Cache-oblivious B-tree** (vEB over PMA) | `Θ(log_B N)` search, `Θ(log_B N + (log²N)/B)` update, obliviously |
| Dynamic ordered dictionary, fixed machine | **Cache-aware B-tree** ([b-tree analysis](../04-b-tree-io-analysis/senior.md)) | Node = page; no `(log²N)/B` PMA overhead, tighter constants |
| Maintain `N` items in sorted contiguous order with inserts | **Packed-memory array / OFM** | `O(1 + (log²N)/B)` amortized I/Os; the substrate under the oblivious B-tree |
| Priority queue / `N` ops, portable | **Funnel heap** (Brodal–Fagerberg) | `O((1/B) log_{M/B}(N/B))` per op — the sorting bound, obliviously |
| Geometry: sweepline with a merge step, portable | **Cache-oblivious distribution sweeping** (lazy funnel) | Replaces the sweepline merge with a funnel; `sort(N)`-class I/O |
| Multicore, unknown private/shared split & core count | **Cache-oblivious fork-join + work-stealing** | Recursion gives locality *and* parallelism; `(M,B,P)`-portable |
| Permuting where the regime matters | **Cache-aware permute** (test the `min` branch) | Obliviousness *provably* cannot match `min(N, sort(N))` here (Brodal–Fagerberg) |
| Flat cache `M = Θ(B)` (theoretical) | **Cache-aware** | Oblivious sorting is *provably* non-optimal without tall cache |

Two rules of thumb:

1. **Claim "optimal" only with the tall-cache rider.** Every oblivious optimality result above holds under `M = Ω(B²)` and *provably fails* for sorting/permuting in the flat regime (Brodal–Fagerberg). On real (tall) hardware the rider is satisfied; in a proof or an interview, state it.
2. **Choose oblivious for portability and multi-level/multi-core reach, cache-aware for peak constants on a fixed machine.** They are two points on a tuning–generality spectrum, not competitors — exactly as in the [I/O model](../01-the-io-model/senior.md). Permuting is the one problem where the spectrum is a genuine gap, not a constant.

---

## Research Pointers

- **Frigo, M., Leiserson, C. E., Prokop, H., & Ramachandran, S. (1999). "Cache-Oblivious Algorithms."** *FOCS 1999 / ACM TALG 8(1), 2012.* The founding paper: the ideal-cache model, the tall-cache assumption, **funnelsort** and the `k`-merger, distribution sort, and the LRU/OPT and full-associativity reductions.
- **Prokop, H. (1999). "Cache-Oblivious Algorithms."** *M.S. thesis, MIT.* The original detailed development of funnelsort and the `k`-funnel I/O analysis.
- **Bender, M. A., Demaine, E. D., & Farach-Colton, M. (2000/2005). "Cache-Oblivious B-Trees."** *FOCS 2000 / SICOMP 35(2).* The vEB-layout-over-PMA dynamic dictionary: `Θ(log_B N)` search and `Θ(log_B N + (log²N)/B)` amortized update.
- **Brodal, G. S., Fagerberg, R., & Jacob, R. (2002). "Cache-Oblivious Search Trees via Binary Trees of Small Height."** *SODA.* A refined, cleaner dynamization of the cache-oblivious search tree.
- **Brodal, G. S., & Fagerberg, R. (2002). "Cache Oblivious Distribution Sweeping."** *ICALP.* **Lazy funnelsort** and its application to cache-oblivious computational geometry (distribution sweeping).
- **Brodal, G. S., & Fagerberg, R. (2002). "Funnel Heap — A Cache Oblivious Priority Queue."** *ISAAC.* The funnel heap: `O((1/B) log_{M/B}(N/B))` amortized per operation.
- **Arge, L., Bender, M. A., Demaine, E. D., Holland-Minkley, B., & Munro, J. I. (2002/2007). "Cache-Oblivious Priority Queue and Graph Algorithm Applications."** *STOC / SICOMP.* An alternative cache-oblivious priority queue and its use in oblivious graph algorithms.
- **Brodal, G. S., & Fagerberg, R. (2003). "On the Limits of Cache-Obliviousness."** *STOC.* The **necessity of the tall-cache assumption** for oblivious sorting, and the **permuting separation** between cache-oblivious and cache-aware.
- **Itai, A., Konheim, A. G., & Rodeh, M. (1981). "A Sparse Table Implementation of Priority Queues."** *ICALP.* The origin of the packed-memory / ordered-file maintenance idea (`O(log²N)` amortized moves).
- **Bender, M. A., Cole, R., Demaine, E. D., Farach-Colton, M., & Zito, J. (2002). "Two Simplified Algorithms for Maintaining Order in a List."** *ESA.* Worst-case ordered-file maintenance underpinning de-amortized cache-oblivious B-trees.
- **Frigo, M., & Strumpen, V. (2009). "The Cache Complexity of Multithreaded Cache Oblivious Algorithms."** *Theory of Computing Systems.* Cache-obliviousness under work-stealing on parallel machines.
- **Blelloch, G. E., Gibbons, P. B., & Simhadri, H. V. (2010). "Low Depth Cache-Oblivious Algorithms."** *SPAA.* Span-and-cache trade-offs for multicore cache-oblivious algorithms.
- **Demaine, E. D. (2002). "Cache-Oblivious Algorithms and Data Structures."** *Lecture notes, EEF Summer School.* The standard accessible survey tying the whole topic together.

---

## Key Takeaways

1. **Funnelsort sorts obliviously in `Θ((N/B) log_{M/B}(N/B))` via the `k`-funnel.** A `k`-funnel is a `√k`-funnel of `√k`-funnels separated by `Θ(k^{3/2})`-size buffers, occupying `Θ(k²)` space in **recursive (vEB) layout**, driven by **lazy buffered merging** (`Fill`). The funnel lemma — a `c = Θ(√M)` sub-funnel fits in cache with one block per input *because of tall-cache* — feeds the recurrence `Q(N) = N^{1/3}Q(N^{2/3}) + O((N/B)log_{M/B}(N/B))`, which collapses to the [Aggarwal–Vitter sorting bound](../01-the-io-model/senior.md). **Lazy funnelsort** (Brodal–Fagerberg 2002) is the standard simplification; **distribution sort** is the merge-vs-distribution dual.
2. **The cache-oblivious B-tree (Bender–Demaine–Farach-Colton 2000) makes the static vEB layout dynamic.** A **packed-memory array** maintains `N` keys in sorted contiguous order at `O(1 + (log²N)/B)` amortized I/Os (ordered-file maintenance, density-gradient rebalancing), and a **vEB-laid balanced tree over the PMA** gives `Θ(log_B N)` search. Together: `Θ(log_B N)` search, `Θ(log_B N + (log²N)/B)` amortized update, `Θ(log_B N + k/B)` range — obliviously.
3. **The funnel heap (Brodal–Fagerberg 2002) is funnelsort run online.** A cache-oblivious priority queue at `O((1/B) log_{M/B}(N/B))` amortized per op — `sort(N)/N`, the same buffer-tree batched floor, reached obliviously; `N` operations cost `Θ(sort(N))`.
4. **The tall-cache assumption `M = Ω(B²)` is provably necessary (Brodal–Fagerberg 2003).** No cache-oblivious sorter is optimal for *all* `(M, B)`; in the flat regime `M = Θ(B)` a cache holds `O(1)` blocks and no fixed oblivious schedule can simulate the required high-fan-in merge. Real hierarchies are tall, so the rider is benign — but it is a theorem, not a convenience.
5. **Permuting separates cache-oblivious from cache-aware (Brodal–Fagerberg 2003).** Cache-aware permuting is `Θ(min(N, sort(N)))` by *testing* which branch wins; an oblivious algorithm cannot see `M, B` to choose, so an adversary punishes its fixed branch. The honest general claim: **oblivious matches aware to constants for *most* problems (sorting under tall cache, FFT, transpose, multiply, search, B-tree, priority queue) — with two named exceptions: tall-cache is required, and permuting cannot be matched.**
6. **Cache-obliviousness extends to multicore for free.** A recursive fork-join algorithm's divide-and-conquer is *simultaneously* the source of cache-locality and of parallelism; under randomized **work-stealing** the cache complexity is the sequential `Q(N; M, B)` plus an `O(P·(M/B)·S(N))` steal-pollution term — `(M, B, P)`-portable, where cache-aware-plus-thread-tuned code must re-tune. The eternal trade: **portability and multi-level/multi-core optimality versus single-machine peak constants.**

---

> **See also:** [`./middle.md`](./middle.md) for the ideal-cache model, recursive transpose/multiply, the static vEB layout, and the funnelsort overview · [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) for the sorting/permuting lower bounds these algorithms target and the buffer-tree batched bound · [`../03-external-sorting/senior.md`](../03-external-sorting/senior.md) for the cache-aware `(M/B)`-way merge sort funnelsort matches · [`../04-b-tree-io-analysis/senior.md`](../04-b-tree-io-analysis/senior.md) for the cache-aware B-tree and the `B^ε`/LSM write-optimization curve
