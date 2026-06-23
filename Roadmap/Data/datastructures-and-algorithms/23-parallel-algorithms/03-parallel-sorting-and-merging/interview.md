# Parallel Sorting and Merging — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Parallel Merge & Merge Sort](#parallel-merge--merge-sort)
3. [Sorting Networks](#sorting-networks)
4. [The Theory Results: Cole & AKS](#the-theory-results-cole--aks)
5. [The Practical Sorts: Sample Sort & Radix](#the-practical-sorts-sample-sort--radix)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: "How do you merge two sorted arrays in parallel?" *(Medium)*

**Answer**: Merging *looks* serial — a two-pointer walk where each output position depends on the last comparison. The parallel trick is **co-ranking** (a.k.a. **merge-path** or **rank-by-search**): for every output index `k`, compute *directly* — without walking — how many elements of `A` and of `B` precede it.

For an element `A[i]`, its position in the merged output is `i + rank(A[i], B)`, where `rank(x, B)` is the count of `B`-elements less than `x`, found by **binary search** in `B` in `O(log n)` time. Do this for every element **in parallel**:

```
for all i in parallel:  out[i + rank(A[i], B)] = A[i]
for all j in parallel:  out[j + rank(B[j], A)] = B[j]
```

- **Span**: `Θ(log n)` — one binary search per element, all independent.
- **Work**: `Θ(n log n)` naively (a search per element), but the **co-ranking** refinement makes it **`Θ(n)` work, `Θ(log n)` span** — work-optimal.

The clean version (Q2) splits the merge into `Θ(n/log n)` independent chunks of `Θ(log n)` each via a **single** diagonal binary search, so total search work is `Θ(n)`, not `Θ(n log n)`.

### Q2: What is co-ranking / the merge path, and why does it give `Θ(n)` work? *(Hard)*

**Answer**: View the merge as a monotone lattice path on an `|A| × |B|` grid: a horizontal step consumes an `A`-element, a vertical step a `B`-element. The **merge path** is the staircase separating "already output" from "not yet output." A **co-rank** for output index `k` is the unique pair `(i, j)` with `i + j = k` that sits on the path — i.e. the split point of both inputs feeding the first `k` outputs.

Finding `(i, j)` for a given `k` is a **binary search along the anti-diagonal** `i + j = k`: `O(log n)` per query. To merge work-optimally:

1. Pick `Θ(n / log n)` evenly spaced output indices `k`.
2. Co-rank each (binary search) → `Θ((n/log n) · log n) = Θ(n)` total search work.
3. Each adjacent pair of co-ranks bounds an **independent serial merge** of `Θ(log n)` elements, run in parallel.

Total **work `Θ(n)`**, **span `Θ(log n)`** (the search depth plus the per-chunk serial merge). This is *the* canonical work-optimal parallel merge.

---

## Parallel Merge & Merge Sort

### Q3: Give the work and span of parallel merge sort. *(Medium)*

**Answer**: Recursively sort the two halves **in parallel**, then **merge in parallel** (Q1–Q2):

```
T₁(n)  = 2·T₁(n/2) + Θ(n)        → Θ(n log n)   [work]
T∞(n)  = T∞(n/2)   + Θ(log n)    → Θ(log² n)    [span]
```

- **Work**: `Θ(n log n)` — same recurrence as serial merge sort; **work-optimal**.
- **Span**: `Θ(log² n)` — `log n` levels of recursion, each contributing a `Θ(log n)` parallel-merge span.
- **Parallelism**: `T₁/T∞ = Θ(n log n / log² n) = Θ(n / log n)`.

The span sums the recursion depth times the merge span: `Θ(log n) · Θ(log n) = Θ(log² n)`. The work recurrence is independent of whether the merge is parallel — it's still `Θ(n log n)`.

### Q4: Why is the span `Θ(log² n)` and not `Θ(log n)`? *(Hard)*

**Answer**: Because the **merges are nested across levels**, not run all at once. There are `Θ(log n)` levels of recursion (tree height), and the critical path must pass through **one parallel merge per level**. Even though each level's merge has span only `Θ(log n)` (Q2), the top-level merge cannot begin until its two children's merges finish — so the spans **add along the recursion depth**:

```
T∞ = Σ over log n levels of Θ(log n) = Θ(log² n).
```

The `log n` merges lie on the critical path sequentially; you cannot overlap level-`k`'s merge with level-`(k+1)`'s. Getting down to `Θ(log n)` span requires **pipelining** the merges across levels so they run concurrently — exactly **Cole's merge sort** (Q7). The naive recursive structure pays `log n × log n`.

---

## Sorting Networks

### Q5: What is a sorting network, and what is the 0–1 principle? *(Medium)*

**Answer**: A **sorting network** is a fixed, data-**oblivious** circuit of **compare-exchange** gates (each wire-pair `(a, b)` becomes `(min, max)`). The sequence of comparisons is hard-wired — *independent of the input values* — so it has no branches and a fixed depth.

The **0–1 principle**: *a comparison network sorts every input of arbitrary numbers correctly **if and only if** it sorts every input of 0s and 1s correctly.* 

**Why it's useful**: it collapses verification from checking all `n!` permutations to checking only `2ⁿ` binary inputs — and, more importantly, lets you *prove correctness combinatorially* by reasoning about thresholds. (Proof sketch: if some monotone function `f` and input `x` were sorted wrong, applying `f` to thresholds yields a 0–1 input the network also fails — since compare-exchange commutes with any monotone `f`.) It is the standard tool for proving bitonic, Batcher, and AKS networks correct.

### Q6: Give the depth and work of Batcher's bitonic sort, and is it work-efficient? *(Hard)*

**Answer**: **Bitonic sort** (and Batcher's odd–even mergesort) are **oblivious** sorting networks built from a **bitonic merger** of depth `Θ(log n)`, applied over `Θ(log n)` merge stages:

- **Depth (span)**: `Θ(log² n)` — `log n` merge stages, each of depth `log n`.
- **Work**: `Θ(n log² n)` — each of the `Θ(log² n)` levels has `Θ(n)` compare-exchanges.

**Is it work-efficient? No.** `Θ(n log² n)` work is a `log n` factor above the `Θ(n log n)` serial optimum. You trade work-efficiency for two prizes: it is **oblivious** (no data-dependent control flow, no branches) and has a **fixed, predictable communication pattern**. That is exactly what suits **GPUs and hardware**: lock-step SIMD lanes, no divergence, deterministic memory access, and easy pipelining. For moderate `n` on a GPU, the simplicity and branch-freedom often beat a theoretically work-efficient sort that diverges.

---

## The Theory Results: Cole & AKS

### Q7: State Cole's parallel merge sort result. *(Hard)*

**Answer**: **Cole's merge sort** (1988) achieves **`Θ(log n)` span with `Θ(n log n)` work** — i.e. it is **work-optimal *and* span-optimal** simultaneously, on the EREW/CREW PRAM. It beats the naive `Θ(log² n)`-span merge sort (Q4) by a full `log n` factor.

The key idea is **pipelined merging**: instead of waiting for a level's merges to finish before the parent starts, each node forwards **samples** of its partially-merged output upward, so every level of the merge tree makes progress **simultaneously**. With `O(1)` amortized work per level-step, the `log n` levels overlap into `Θ(log n)` total span rather than stacking to `Θ(log² n)`.

In interviews: cite Cole as the existence proof that **comparison sorting is in NC with optimal `Θ(n log n)` work and `Θ(log n)` span**. It's elegant but intricate; the contrast with the simple `Θ(log² n)` sort is the point.

### Q8: What is the AKS sorting network, and why isn't it used? *(Hard)*

**Answer**: The **AKS network** (Ajtai–Komlós–Szemerédi, 1983) is a sorting **network** of **depth `Θ(log n)`** and **`Θ(n log n)` size** — asymptotically optimal depth for an oblivious network (matching the `Ω(log n)` fan-in lower bound). It settled the theoretical question of whether `O(log n)`-depth sorting networks exist.

**Why nobody uses it**: the **hidden constant is astronomical** — the `Θ(log n)` depth carries a constant in the thousands (it relies on expander graphs). For any realistic `n`, Batcher's `Θ(log² n)`-depth bitonic network is **far** smaller and faster. AKS is the textbook **"galactic algorithm"**: asymptotically superior, practically useless. The honest takeaway: for real hardware, the *constant* matters, and `log² n` with a tiny constant beats `log n` with a colossal one until `n` is absurd.

---

## The Practical Sorts: Sample Sort & Radix

### Q9: How does sample sort work, and why is it the practical parallel/distributed sort? *(Hard)*

**Answer**: **Sample sort** is a parallel generalization of quicksort with **`p − 1` pivots** chosen so the `p` resulting buckets are roughly equal, giving a sort in essentially **one communication round**:

1. **Sample**: each of `p` processors locally sorts (or partial-sorts) its `n/p` elements and draws a sample (e.g. `s` evenly spaced "splitters"). **Oversample** — take `s ≫ 1` per processor — to make the split balanced with high probability.
2. **Choose splitters**: gather all samples, sort them, pick `p − 1` global splitters that partition the key range into `p` near-equal buckets.
3. **Bucket & exchange**: each processor bins its local elements by splitter (binary search → bucket) and does **one all-to-all** sending bucket `b` to processor `b`.
4. **Local sort**: each processor sorts the bucket it received. Concatenating the buckets in order yields the globally sorted array.

**Why it wins in practice**: it minimizes the expensive resource — **communication**. One all-to-all round versus the `Θ(log n)` rounds a merge-tree sort needs. **Oversampling** controls **load balance** (the dominant failure mode of distributed sorts). It maps cleanly to MPI clusters, multicore, and out-of-core data, which is why MPI sample sort, Spark/Hadoop terasort-style sorts, and many multicore `parallel_sort` implementations are sample-sort-based.

### Q10: How is radix sort parallelized? *(Medium)*

**Answer**: Radix sort is **non-comparison** — it processes keys digit-by-digit and **stably scatters** by the current digit. The serial scatter uses a running per-bucket count; in parallel that running count becomes a **scan (prefix sum)**:

1. **Histogram**: count occurrences of each digit value (per processor, then combined).
2. **Exclusive scan** over the histogram → the **starting offset** of each bucket.
3. **Per-element scan** within a bucket → each key's exact destination index.
4. **Scatter** every key to its computed index — stable and fully parallel.

So each digit-pass is `Θ(n)` work and `Θ(log n)` span (the scan dominates), repeated for `d` digits → `Θ(d·n)` work. This is **the** GPU sort: branch-light, memory-coalesced, and built entirely on the scan primitive — see [../02-parallel-prefix-sum-scan/interview.md](../02-parallel-prefix-sum-scan/interview.md). The catch: it needs fixed-width, radix-decomposable keys (integers, floats via bit-twiddling), not arbitrary comparators.

---

## Gotcha / Trick Questions

### Q11: "Which parallel sort would you actually use in production?" *(Medium)*

**Answer**: **"It depends on the platform" — name the three regimes:**

- **Distributed / multi-node (MPI, Spark)** → **sample sort**. Minimizes communication (one all-to-all round); oversampling handles load balance.
- **GPU / SIMD** → **radix sort** for integer-ish keys (scan-based, branch-light, coalesced); **bitonic** for small `n` or when obliviousness/in-register sorting matters.
- **Multicore CPU (a library call)** → a **work-stealing parallel merge/quick sort** (e.g. `std::sort`'s parallel `std::execution::par`, Intel TBB `parallel_sort`, Rust `rayon::par_sort`), typically a parallel-quicksort/merge hybrid.

The trap is naming a *theoretically* optimal sort (Cole, AKS) — those never ship. Production sorts optimize the **real** bottleneck: communication (distributed), branch divergence + memory coalescing (GPU), or cache + scheduling overhead (multicore).

### Q12: "Bitonic sort has `Θ(log² n)` depth — so is it work-efficient?" *(Hard)*

**Answer**: **No.** Conflating *depth* with *work* is the mistake. Bitonic's **depth (span) is `Θ(log² n)`**, but its **work is `Θ(n log² n)`** — a `log n` factor above the `Θ(n log n)` comparison-sort optimum. Every one of the `Θ(log² n)` levels performs `Θ(n)` compare-exchanges, so total work is `Θ(n log² n)`, not `Θ(n log n)`.

You accept this extra work because bitonic is **oblivious**: a fixed comparison pattern with no data-dependent branches, ideal for SIMD/GPU/hardware where divergence and irregular memory access cost more than the extra comparisons. So: **low depth, but not work-optimal** — the opposite trade-off from Cole's sort (work-optimal *and* `Θ(log n)` span, but intricate and not oblivious).

### Q13: "Parallel merge is just running serial merge with threads, right?" *(Medium)*

**Answer**: **No.** Serial merge is a two-pointer walk where output `k` depends on the comparison that produced output `k−1` — a strict `Θ(n)`-length dependency chain, **span `Θ(n)`**, no parallelism at all. You can't just "add threads": there's nothing independent to hand them.

Parallelizing requires **breaking the dependency** via co-ranking (Q1–Q2): compute each element's output position *directly* by binary-searching its rank in the other array, so all positions are independent. That's what drops the span to `Θ(log n)`. The insight — *replace the running pointer with an independent rank query* — is the same move as turning a serial scan into a parallel one (replace a running accumulator with a tree).

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Parallel merge work & span? | `Θ(n)` work, `Θ(log n)` span (co-ranking) |
| 2 | How to parallelize a merge? | Co-rank / merge-path: binary-search each element's rank |
| 3 | Parallel merge sort work? | `Θ(n log n)` — work-optimal |
| 4 | Parallel merge sort span? | `Θ(log² n)` (naive recursion) |
| 5 | Why `log² n` not `log n`? | `log n` levels × `log n` merge span (nested) |
| 6 | 0–1 principle? | Sorts all inputs ⟺ sorts all 0–1 inputs |
| 7 | Bitonic / Batcher depth? | `Θ(log² n)` |
| 8 | Bitonic work? | `Θ(n log² n)` — **not** work-efficient |
| 9 | Why oblivious networks for GPU/HW? | No branches, fixed comm pattern, SIMD-friendly |
| 10 | Cole's merge sort? | `Θ(log n)` span, `Θ(n log n)` work — work-optimal |
| 11 | How does Cole get `log n` span? | Pipelined merging across levels |
| 12 | AKS network depth? | `Θ(log n)` — but galactic constant |
| 13 | Why isn't AKS used? | Astronomical hidden constant (expanders) |
| 14 | Sample sort rounds? | ~one all-to-all communication round |
| 15 | Sample sort load balance via? | **Oversampling** the splitters |
| 16 | Parallel radix sort built on? | **Scan** (prefix sum) for bucket offsets |
| 17 | Sort for distributed? | **Sample sort** |
| 18 | Sort for GPU integers? | **Radix sort** |
| 19 | Sort for multicore library? | Parallel quick/merge (e.g. `parallel_sort`) |

---

## Common Mistakes

1. **Calling serial merge "parallelizable with threads."** Its `Θ(n)` dependency chain has no parallelism; you must co-rank to break it.
2. **Confusing depth with work.** Bitonic is `Θ(log² n)` depth **and** `Θ(n log² n)` work — *not* work-efficient. Depth ≠ work.
3. **Quoting merge-sort span as `Θ(log n)`.** The naive recursion is `Θ(log² n)`; only **Cole's** pipelined sort hits `Θ(log n)`.
4. **Treating AKS as practical.** `Θ(log n)` depth with a galactic constant — Batcher's `Θ(log² n)` wins for all realistic `n`.
5. **Forgetting to oversample in sample sort.** Too few samples → skewed buckets → load imbalance, the dominant cost in distributed sorts.
6. **Thinking radix needs comparisons.** It's non-comparison; it scatters by digit using a **scan** for offsets — but needs fixed-width keys.
7. **Naming a galactic sort in a systems interview.** Production uses sample/radix/parallel-merge, not Cole or AKS.

---

## Tips & Summary

- **Open the merge question with co-ranking**: "Serial merge is a serial pointer-walk; I break the dependency by binary-searching each element's **rank** in the other array — `Θ(n)` work, `Θ(log n)` span via the merge-path." That one sentence shows you know the model.
- **Have the merge-sort bounds cold**: work `Θ(n log n)` (optimal), span `Θ(log² n)` — and *explain* the `log² n` as `log n` levels × `log n` merge span. Then mention **Cole** as the `Θ(log n)`-span pipelined improvement.
- **Use the 0–1 principle to prove networks correct**: checking `2ⁿ` binary inputs, not `n!` permutations — the standard tool for bitonic/AKS.
- **Frame networks by their trade-off**: oblivious + branch-free + fixed communication → GPU/hardware, but `Θ(n log² n)` work (bitonic) is **not** work-efficient. Obliviousness, not asymptotics, is why they ship.
- **Treat AKS as the canonical galactic algorithm**: optimal `Θ(log n)` depth, useless constant. Constants matter on real hardware.
- **Name the practical sort by platform**: **sample sort** (distributed, one comm round, oversample for balance), **radix** (GPU, scan-based), **parallel quick/merge** (multicore library). This is what separates a systems answer from a textbook one. See [./middle.md](./middle.md) and [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md).

**Related:** [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) · [Parallel Prefix-Sum / Scan — Interview](../02-parallel-prefix-sum-scan/interview.md) · [Parallel Sorting & Merging — Middle](./middle.md)
