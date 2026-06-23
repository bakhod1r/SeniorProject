# Cache-Oblivious Algorithms — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Mechanism: Recurse Until It Fits](#the-mechanism-recurse-until-it-fits)
3. [van Emde Boas Layout & Search](#van-emde-boas-layout--search)
4. [Sorting: Funnelsort](#sorting-funnelsort)
5. [Trade-offs & Gotchas](#trade-offs--gotchas)
6. [Rapid-Fire Q&A](#rapid-fire-qa)
7. [Common Mistakes](#common-mistakes)
8. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What does "cache-oblivious" mean, and how is it different from cache-aware? *(Easy)*

**Answer**: A **cache-oblivious** algorithm achieves an optimal number of I/Os in the [I/O model](../01-the-io-model/interview.md) **without using the parameters `M` (memory size) or `B` (block size) anywhere in its code**. It is not tuned for any particular cache; it never reads, branches on, or assumes a value of `M` or `B`. Yet its I/O complexity matches what an optimally tuned algorithm would achieve.

A **cache-aware** (also called *cache-conscious* or *external-memory*) algorithm **knows `M` and `B`** and bakes them in — e.g. a B-tree chooses node size = `B`, external merge sort chooses fan-in = `M/B`. It is tuned for one specific block size.

The distinction is whether the block/memory parameters appear in the algorithm. Cache-oblivious code looks like an ordinary recursive algorithm; the locality emerges *automatically* from its structure rather than from explicit blocking. The model and term are due to Frigo, Leiserson, Prokop, and Ramachandran (1999).

### Q2: What is the ideal-cache model, and why is the tall-cache assumption needed? *(Medium)*

**Answer**: The **ideal-cache model** is the I/O model plus two idealizations used to analyze cache-oblivious algorithms:

- A **two-level hierarchy** of size `M`, block size `B`, where the cache is **fully associative** and uses the **optimal (offline) replacement policy** (Belady's MIN).
- The algorithm is analyzed as if it knows nothing about `M` or `B`.

The **tall-cache assumption** is `M ≥ B²` (more generally `M = Ω(B²)`): the cache holds at least `B²` elements, i.e. at least `B` full blocks. Many cache-oblivious bounds (notably funnelsort and matrix algorithms) **require** it. Intuition: when you recurse down to a subproblem that "just fits," you want it to occupy `Θ(M/B)` blocks so the algorithm can keep enough simultaneous blocks resident to stream efficiently. If the cache were short (`M < B²`), a single row or run might not fit alongside the buffers it needs, and the analysis breaks. Real hardware satisfies `M ≥ B²` comfortably (e.g. `B ≈ 64 B` cache line, `M` = megabytes of L2/L3), so the assumption is mild.

### Q3: Why is one cache-oblivious algorithm optimal at L1, L2, L3, and RAM all at once? *(Medium)*

**Answer**: Because the algorithm's I/O bound holds for **every** `(M, B)` pair simultaneously — it was proven without ever fixing those values. The real memory hierarchy is a *stack* of two-level caches: L1↔L2, L2↔L3, L3↔RAM, RAM↔disk, each with its own `(M, B)`. A cache-aware algorithm tuned for, say, the L3 block size is mistuned for every other level. A cache-oblivious algorithm, being optimal for *all* `(M, B)`, is therefore **optimal at every level of the hierarchy at the same time** — and stays optimal when the hardware changes, since nothing was hard-coded. This portability across an entire fractal hierarchy is the whole payoff. See [./middle.md](./middle.md).

---

## The Mechanism: Recurse Until It Fits

### Q4: Why does divide-and-conquer give automatic locality ("recurse until it fits")? *(Medium)*

**Answer**: A divide-and-conquer algorithm keeps halving (or otherwise shrinking) the problem. As recursion descends, the subproblem size passes through **every scale** — and in particular, at some level of the recursion the subproblem becomes small enough to fit in `M` (and one level deeper, small enough to fit in `B`). The algorithm never *names* that level, but it inevitably reaches it.

Once a subproblem fits in cache, **all its remaining work touches only resident data**, costing no further I/Os until the subproblem completes. So the I/Os are paid essentially once per subtree-that-fits, and the recursion structure automatically "blocks" the computation at the right granularity for whatever `M` and `B` happen to be. That is the entire trick: *the recursion crosses the fits-in-cache threshold for free, at exactly the right size, without knowing where the threshold is.*

### Q5: Walk the I/O analysis of recursive matrix transpose, Θ(n²/B). *(Hard)*

**Answer**: Naively transposing an `n×n` matrix (`B[j][i] = A[i][j]`) reads `A` row-major but writes `B` column-major (or vice versa), so one of the two access patterns strides across rows and pays **one I/O per element** → `Θ(n²)` I/Os. Terrible.

**Cache-oblivious version**: recursively split the larger dimension and transpose blocks. Conceptually, partition `A` into four quadrants and recurse:

```
transpose(A) = swap-and-transpose the four sub-quadrants
```

recursing until a submatrix is small. The base case is reached when a `k×k` submatrix **fits in cache**, i.e. `k² = Θ(M)` (and crucially each of its rows of length `k ≤ √M` sits within `O(k/B)` blocks, using the tall cache `M ≥ B²` so a row spans at most a constant number of blocks). At that point the submatrix and its transpose together occupy `Θ(M/B)` blocks; reading both in and writing out costs `Θ(M/B)` I/Os and finishes that subtree.

Counting: there are `Θ(n²/M)` such base-case submatrices, each costing `Θ(M/B)` I/Os, for a total of `Θ(n²/M · M/B) = Θ(n²/B)` I/Os. This matches the scan bound — you cannot do better than reading both matrices once — and the algorithm achieved it **without referencing `M` or `B`**.

### Q6: Why is recursive matrix multiply Θ(n³/(B√M))? *(Hard)*

**Answer**: Multiply `n×n` matrices by the standard recursive `2×2` block decomposition: split each matrix into four quadrants and recurse on the 8 sub-multiplications (plus 4 additions). Recurse until three `k×k` submatrices — a block of `A`, a block of `B`, and the accumulating block of `C` — **all fit in cache simultaneously**, i.e. `3k² = Θ(M)`, so `k = Θ(√M)`.

At that base case, the standard `O(k³)` block-multiply runs entirely in cache after loading `Θ(k²) = Θ(M)` elements, costing `Θ(M/B)` I/Os (read three blocks, exploiting `M ≥ B²` so each row stays within `O(k/B)` blocks). The number of such base-case multiplications follows the recursion `T(n) = 8·T(n/2)`, bottoming out at size `k = √M`, giving `(n/√M)³ = n³/M^{3/2}` base cases.

Total I/Os: `(n³/M^{3/2}) · Θ(M/B) = Θ(n³/(B·M^{1/2})) = Θ(n³/(B√M))`. This matches the Hong–Kung lower bound for matrix multiply in the I/O model — and the `√M` factor (the cache "buys" a `√M`-fold reduction) is exactly the same win a hand-tiled cache-aware multiply gets, but here it came for free from recursion. Compare a naive triple loop, which thrashes at `Θ(n³)` I/Os when the matrix exceeds cache.

---

## van Emde Boas Layout & Search

### Q7: Why does the vEB layout give Θ(log_B N) search without knowing B? *(Hard)*

**Answer**: The **van Emde Boas (vEB) layout** stores a complete binary search tree of `N` nodes in an array using a recursive split. Take a tree of height `h`; cut it at the **middle level** into a top "recursive subtree" of height `h/2` and roughly `√N` bottom subtrees each of height `h/2`. Lay out the top subtree first (recursively in vEB order), then each bottom subtree (recursively in vEB order), contiguously. Recurse all the way down.

**Why a root-to-leaf search costs `Θ(log_B N)`**: Consider the recursive level at which subtrees have height `≈ log B`, hence size `≈ B`, hence **fit in one block**. The root-to-leaf path of length `log₂ N` passes through `(log₂ N)/(log₂ B) = log_B N` such block-sized subtrees. Each one is contiguous in the layout, so traversing it costs at most `O(1)` block transfers (it spans `O(1)` blocks). Therefore the whole path costs `O(log_B N)` I/Os — and this holds for **every** `B`, because the recursive splitting created contiguous subtrees at *every* size scale, including whatever `B` turns out to be. The layout never mentions `B`; the right granularity is present at some recursion level automatically.

### Q8: Why does a BFS/level-order array layout give only Θ(log₂ N) transfers? *(Medium)*

**Answer**: In a **BFS (level-order)** array layout, the children of a node sit far apart — node `i`'s children are at `2i` and `2i+1`, so as you descend the search path, the gap between consecutive nodes on the path **doubles each level**. Near the bottom of the tree, consecutive nodes on a root-to-leaf path are spaced more than `B` apart, so **each step down loads a fresh block**. The path has length `log₂ N`, giving `Θ(log₂ N)` I/Os.

The vEB layout fixes precisely this: by storing recursively-contiguous subtrees, it keeps `Θ(log B)` consecutive path-nodes packed into one block, cutting the transfer count by a `log₂ B` factor down to `log_B N`. This is the *same* asymptotic win a B-tree gets over a binary tree on disk (see [../04-b-tree-io-analysis/interview.md](../04-b-tree-io-analysis/interview.md)), except the vEB layout achieves it **cache-obliviously** — with no node-size parameter.

---

## Sorting: Funnelsort

### Q9: What does funnelsort achieve, and why does it need the tall-cache assumption? *(Hard)*

**Answer**: **Funnelsort** is a cache-oblivious sorting algorithm that attains the optimal external sort bound:

```
Θ((N/B) · log_{M/B}(N/B)) = Θ(sort(N))
```

— matching cache-aware external merge sort, but **without knowing `M` or `B`**. It is a recursive merge sort whose merging is done by a **`k`-funnel**: a balanced binary merge tree of `√N`-way structure with buffers of carefully chosen (recursively defined) sizes between sub-mergers, laid out in vEB order so the funnel itself is cache-efficient. The algorithm sorts `N^{1/3}` subarrays recursively, then merges them with an `N^{1/3}`-funnel. (Lazy funnelsort, due to Brodal and Fagerberg, simplifies the construction.)

**Why it needs the tall cache (`M ≥ B²`)**: the funnel's efficiency relies on a sufficiently large `k`-funnel fitting in cache *together with one block from each of its `k` input streams*. That requires the cache to hold `Θ(k)` blocks at the relevant scale, i.e. `M = Ω(B²)`. Without the tall-cache assumption, the funnel's buffers and the per-stream input blocks cannot all be resident, the merge stops streaming optimally, and the `log_{M/B}` factor is lost. This is the same structural reason matrix algorithms invoke `M ≥ B²`: you need *enough blocks*, not just enough bytes, resident at once. It is a known result that optimal cache-oblivious sorting is **impossible without** some tall-cache-style assumption.

---

## Trade-offs & Gotchas

### Q10: "Is cache-oblivious always faster than cache-aware?" *(Hard)*

**Answer**: **No.** Cache-oblivious wins on **portability and multi-level optimality**, not on raw constant factors at a single level.

- A **cache-aware** algorithm nails *one* level's exact block size: a B-tree picks node size = `B`, a tiled multiply picks tile = `√M`. With the parameter known exactly, it eliminates slack and is often **faster by a constant factor** at that level.
- A **cache-oblivious** algorithm pays for generality: extra **recursion overhead** (function calls, index arithmetic), and it can only be optimal *up to constants* at every level rather than perfectly tuned at one. Its asymptotic I/O bound matches, but the hidden constant is usually larger.

So the trade-off is: cache-aware = best constant at the level you tuned, but brittle (re-tune per machine, mistuned at other hierarchy levels); cache-oblivious = optimal at *every* level and *every* machine simultaneously, portable, future-proof, but typically a constant factor slower than a perfectly-tuned cache-aware competitor at any single level. In practice, well-engineered cache-oblivious code (e.g. recursive matrix multiply, funnelsort) is competitive and sometimes wins precisely *because* it is good at all levels at once, while a single-level-tuned routine suffers at the others.

### Q11: What practical overheads hurt cache-oblivious algorithms, and how are they mitigated? *(Medium)*

**Answer**: The two big ones:

- **Recursion overhead**: cache-oblivious algorithms recurse all the way to tiny subproblems, and deep recursion to size-1 base cases means lots of call overhead and poor instruction-level parallelism near the leaves.
- **Index/address arithmetic**: vEB and funnel layouts require nontrivial computation to map logical positions to array offsets, which can dominate when the actual data movement is cheap.

The standard mitigation is **base-case coarsening (recursion truncation)**: stop recursing at a tuned threshold (e.g. a `32×32` or `64×64` block for matrix multiply) and switch to a tight iterative kernel for the base case. This keeps the favorable I/O structure of the recursion while amortizing call overhead and enabling vectorization. Note the irony: coarsening reintroduces a *tuned constant*, making the implementation slightly cache-aware in its base case — a pragmatic hybrid. It changes constants, not the asymptotic I/O bound.

### Q12: "If it never uses M or B, how can it possibly be optimal — isn't it guessing?" *(Medium)*

**Answer**: It isn't guessing — it's being optimal *at every scale at once*, so no guess is needed. The recursion physically produces subproblems of **every size**, and at whatever size equals the (unknown) `M` or `B`, the data is already laid out contiguously and accessed locally. The analysis then *proves* the I/O count is optimal for an arbitrary `(M, B)` by reasoning about the recursion level where subproblems hit that size. The algorithm doesn't need to find the threshold because it does the right thing on *both* sides of it. The cleverness is in the **layout and recursion structure** (vEB ordering, funnel buffers, quadrant recursion) that make "good at every scale" achievable, plus the **tall-cache assumption** that guarantees enough blocks are resident at the critical scale.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Cache-oblivious means? | Optimal I/Os without using `M` or `B` in the code |
| 2 | Cache-aware means? | Knows `M`, `B`; tuned for one block size |
| 3 | The analysis model? | Ideal-cache model (full associativity, optimal eviction) |
| 4 | Tall-cache assumption? | `M ≥ B²` (cache holds ≥ `B` full blocks) |
| 5 | Why optimal at all cache levels? | Bound holds for every `(M, B)` simultaneously |
| 6 | Core mechanism? | Divide-and-conquer → "recurse until it fits" |
| 7 | Recursive matrix transpose I/O? | `Θ(n²/B)` |
| 8 | Recursive matrix multiply I/O? | `Θ(n³/(B√M))` |
| 9 | vEB layout search? | `Θ(log_B N)` |
| 10 | BFS/level-order layout search? | `Θ(log₂ N)` — `log₂ B` worse |
| 11 | Funnelsort bound? | `Θ((N/B) log_{M/B}(N/B)) = sort(N)` |
| 12 | Does funnelsort need tall cache? | Yes — else `log_{M/B}` factor is lost |
| 13 | Cache-oblivious B-tree built from? | vEB layout + packed-memory array |
| 14 | Always faster than cache-aware? | No — cache-aware often wins by a constant at one level |
| 15 | Main practical overheads? | Recursion + index arithmetic |
| 16 | Standard mitigation? | Base-case coarsening (recursion truncation) |
| 17 | Who introduced the model? | Frigo, Leiserson, Prokop, Ramachandran (1999) |

---

## Common Mistakes

1. **Thinking cache-oblivious means "ignores caches."** It's the opposite — it's optimal for caches *without naming their parameters*. The locality is structural.
2. **Forgetting the tall-cache assumption.** `M ≥ B²` is required for optimal cache-oblivious sorting and the matrix bounds; dropping it breaks the analysis.
3. **Claiming cache-oblivious always beats cache-aware.** Cache-aware nails one level's block size and is often faster by a constant; cache-oblivious wins on portability and multi-level optimality.
4. **Stating matrix multiply as `Θ(n³/B)`.** The `√M` factor is the whole point: `Θ(n³/(B√M))` — the cache holds a `√M × √M` block.
5. **Saying vEB search is `log₂ N` I/Os.** It's `Θ(log_B N)`; the level-order/BFS layout is the one that costs `log₂ N` transfers.
6. **Ignoring recursion overhead / skipping base-case coarsening.** Recursing to size 1 is slow in practice; coarsen the base case to a tuned iterative kernel (constants only — the bound is unchanged).
7. **Confusing "optimal at every level" with "perfectly tuned at one level."** Cache-oblivious is optimal *up to constants* everywhere, not constant-optimal anywhere.

---

## Tips & Summary

- **Lead with the definition**: "Optimal I/Os *without `M` or `B` in the code* — so optimal at every cache level and on every machine at once." This single line frames the entire topic and its trade-off.
- **Explain the mechanism in one phrase**: "recurse until it fits" — divide-and-conquer passes through every size scale, so it crosses the fits-in-cache threshold for free without knowing where it is.
- **Memorize the four headline bounds cold**: transpose `Θ(n²/B)`, multiply `Θ(n³/(B√M))`, vEB search `Θ(log_B N)`, funnelsort `Θ((N/B) log_{M/B}(N/B))`. Note that each matches its cache-aware counterpart.
- **Always cite the tall-cache assumption** (`M ≥ B²`) for funnelsort and the matrix bounds, and explain it as "enough *blocks* resident, not just enough bytes."
- **Get the trade-off right**: cache-aware = best constant at one tuned level but brittle; cache-oblivious = optimal at every level and portable but a constant factor slower per level. Mention **base-case coarsening** as the pragmatic bridge.
- **Tie it to the hierarchy**: the memory system is a fractal stack of two-level caches; cache-oblivious code is the one algorithm that is simultaneously good for L1, L2, L3, RAM, and disk — and stays good when the hardware changes.

**Related:** [The I/O Model — Interview](../01-the-io-model/interview.md) · [B-Tree I/O Analysis — Interview](../04-b-tree-io-analysis/interview.md) · [Cache-Oblivious Algorithms — Middle](./middle.md)
