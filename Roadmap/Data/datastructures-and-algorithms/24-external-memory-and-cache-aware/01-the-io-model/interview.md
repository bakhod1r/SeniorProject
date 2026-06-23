# The I/O Model — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Four Bounds](#the-four-bounds)
3. [Applied: Databases & Real Hardware](#applied-databases--real-hardware)
4. [Gotcha / Trick Questions](#gotcha--trick-questions)
5. [Rapid-Fire Q&A](#rapid-fire-qa)
6. [Common Mistakes](#common-mistakes)
7. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is the I/O model and why use it instead of the RAM model? *(Easy)*

**Answer**: The **I/O model** (also the **External-Memory** or **DAM — Disk Access Machine** model, due to Aggarwal & Vitter, 1988) abstracts a two-level memory hierarchy: a small fast **internal memory** and an unbounded slow **external memory** (disk). Data moves between them only in **fixed-size blocks**. The cost of an algorithm is the **number of block transfers (I/Os)** it performs; **CPU computation on data already in internal memory is free**.

The **RAM model** charges 1 per primitive operation and assumes uniform memory-access cost. That assumption is a lie on real hardware: a cache miss or a disk seek costs *hundreds to millions* of times more than an in-register operation. When the data set dwarfs RAM (or even L3), the running time is dominated by **data movement, not arithmetic** — and the RAM model is blind to it. The I/O model measures the thing that actually matters, so it correctly predicts that a B-tree crushes a balanced binary tree on disk even though both are `O(log n)` in the RAM model.

### Q2: Define the parameters N, M, B and the cost measure. *(Easy)*

**Answer**:

- **N** — the **problem size** (number of elements / records).
- **M** — the number of elements that fit in **internal memory** (the cache / RAM).
- **B** — the **block size**: the number of elements transferred per I/O.

The invariant is `1 ≤ B ≤ M ≤ N` (often `M < N`, otherwise the whole problem fits in memory and external cost is just `O(N/B)` to read it once). The **cost** is the count of block transfers; an algorithm that touches data only in memory pays nothing extra. Two derived quantities recur everywhere: the **scan bound** `scan(N) = Θ(N/B)` and the **sort bound** `sort(N) = Θ((N/B) log_{M/B}(N/B))`.

### Q3: What does "an I/O is the unit of cost and computation is free" mean? *(Medium)*

**Answer**: It is a deliberate, useful **simplification**: we pretend every CPU operation on resident data costs 0 and count *only* block transfers. This is justified because on the hierarchy levels the model targets — RAM↔disk, or cache↔RAM — one I/O is so much more expensive than one CPU op that the CPU work is noise. By zeroing it out we get clean, comparable bounds that isolate the dominant cost.

The mental discipline this forces: **stop counting operations, start counting how many times data crosses the slow boundary.** An algorithm that does more arithmetic but far fewer block transfers wins. This is the opposite instinct from RAM-model thinking, and internalizing it is the whole point.

---

## The Four Bounds

### Q4: Why is scanning Θ(N/B)? *(Easy)*

**Answer**: To read (or write) `N` contiguous elements, each I/O brings in a full block of `B` elements, so you need `⌈N/B⌉ = Θ(N/B)` I/Os — and you cannot do better, because every element must cross the boundary at least once and each transfer carries at most `B` of them. This is the cheapest non-trivial primitive: a **linear scan over contiguous data**. The lesson is that the `1/B` factor is *free speedup* you get purely from sequential access — touching `N` elements one-at-a-time at random would cost `Θ(N)` I/Os, a factor of `B` worse.

### Q5: Derive the external sorting bound Θ((N/B) log_{M/B}(N/B)). *(Hard)*

**Answer**: This is **external merge sort**. Two phases:

**1. Run formation.** Read internal-memory-sized chunks of `M` elements, sort each in memory (free), write it back as a sorted **run**. This produces `N/M` sorted runs and costs one scan in + one scan out = `Θ(N/B)` I/Os.

**2. Multiway merge.** Repeatedly merge runs. The fan-in is **`M/B`, not `M`**: to merge `k` runs you need one input block per run resident simultaneously (plus one output block), so `k ≤ M/B`. Each merge pass reads and writes the entire data set once = `Θ(N/B)` I/Os and reduces the run count by a factor of `M/B`. Starting from `N/M` runs, the number of passes is:

```
log_{M/B}(N/M) = Θ(log_{M/B}(N/B))
```

Total = (I/Os per pass) × (number of passes) = `Θ((N/B) · log_{M/B}(N/B))` = **`sort(N)`**. This is a proven *lower bound* too (via a permutation / comparison argument), so the bound is tight. The base-`(M/B)` logarithm is the crux: with realistic `M/B` in the thousands, `log_{M/B}` is **tiny** — usually 2 or 3 passes even for terabytes — which is why external sort is so fast in practice.

### Q6: Why is searching Θ(log_B N) and not log₂ N? *(Medium)*

**Answer**: A **B-tree** stores `Θ(B)` keys per node, so one node fills one block — one I/O brings in `B` keys and lets you make a `(B+1)`-way branching decision. The tree therefore has height `Θ(log_B N)`, and a search costs one I/O per level = **`Θ(log_B N)`** block transfers.

A balanced **binary** tree branches 2-way per node; in the worst case each node is on a different block, so a search costs `Θ(log₂ N)` I/Os. The win is the change of logarithm base:

```
log_B N = log₂ N / log₂ B
```

so the B-tree is a factor of `log₂ B` faster in I/Os. With `B = 1000`, that's ~10× fewer disk accesses — and on disk, accesses are the entire cost. See [../04-b-tree-io-analysis/interview.md](../04-b-tree-io-analysis/interview.md) for the full analysis.

### Q7: Why is permuting "almost as hard as sorting"? *(Hard)*

**Answer**: **Permuting** means: given `N` elements and a target permutation `π`, produce the elements in order `π`. You'd think it's easier than sorting (the destination is *given*, no comparisons needed), but in the external-memory model:

```
permute(N) = Θ(min(N, sort(N)))
```

Two regimes. **(a)** You can move elements one at a time, paying 1 I/O each → `Θ(N)`. **(b)** You can route them in bulk via the sorting machinery → `Θ(sort(N))`. The optimum is the minimum. The surprise is that for any realistic parameters, `sort(N) = (N/B) log_{M/B}(N/B) ≪ N` (because `log_{M/B} ≪ B`), so **permuting costs `Θ(sort(N))` — essentially as much as a full sort.** The deep reason: the bottleneck in external memory is not *deciding* the order but *physically relocating* data across blocks, and a permutation scatters elements just as badly as a sort does. The fact that you can't permute faster than you can sort is a hallmark result of the model.

---

## Applied: Databases & Real Hardware

### Q8: Why do databases use B+-trees instead of balanced binary trees? *(Medium)*

**Answer**: Because the index lives on **disk**, and disk cost is counted in I/Os. A binary tree has height `log₂ N` and (worst case) one I/O per level. A **B+-tree** packs hundreds to thousands of keys per node — one node = one disk page — giving height `log_B N` and the same number of I/Os as its height. Concretely, with `B ≈ 1000` and a billion keys, a B+-tree is **~3 levels deep** (≈3 I/Os per lookup) versus **~30 levels** for a binary tree (≈30 I/Os). A 10× reduction in disk accesses is a 10× speedup where it counts.

Two extra B+-tree wins: **(1)** all data lives in the leaves, linked sequentially, so **range scans are sequential I/O** (cheap); **(2)** the high fan-out keeps the top levels small enough to stay cached, so most lookups touch disk only for the leaf.

### Q9: Why is sequential I/O so much faster than random I/O? *(Medium)*

**Answer**: On a spinning disk, a **random** access pays a mechanical **seek** (move the head, ~milliseconds) plus rotational latency before any data transfers; a **sequential** access reads the next physically adjacent block with no seek. The ratio is often **100×–1000×**. On **SSDs** there's no head, but random access still loses to sequential: it can't exploit read-ahead, hits more flash-translation-layer overhead, and gets less benefit from large-block transfers and parallelism across chips.

The I/O model captures this implicitly: it charges per *block*, and sequential algorithms amortize each seek over a whole block of `B` useful elements (the `1/B` factor in `scan(N)`), while random per-element access wastes most of every block. **Design rule: turn random access into sequential access whenever possible** — it's the single biggest external-memory optimization, and it's exactly why external merge sort (all sequential streaming) beats, say, a disk-resident quicksort with random partitioning.

### Q10: How would you sort 1 TB with 8 GB of RAM? Count the passes. *(Hard)*

**Answer**: **External merge sort.** Say records make `N` ≈ 1 TB of data, `M` ≈ 8 GB of usable memory, block size `B` such that `M/B` (the merge fan-in) is, say, ~1000 (a few-MB I/O buffer per run is realistic).

- **Run formation:** Read 8 GB at a time, sort in RAM, write back. `1 TB / 8 GB = 128` initial sorted runs. Cost: 1 read + 1 write pass over the data.
- **Merge:** Each pass merges up to `M/B ≈ 1000` runs into one. With only 128 runs, **a single merge pass** suffices (`128 < 1000`).

So the whole sort is **2 passes** over the data (form runs, then one merge) ≈ 2 reads + 2 writes = `Θ(N/B)` I/Os with a tiny constant. Plug into the formula: `log_{M/B}(N/M) = log_{1000}(128) < 1` ⟹ rounds up to 1 merge pass, confirming the count. The headline: **terabytes sort in 2–3 passes** because `log_{M/B}` is so small. If RAM were tiny (say `M/B = 10`), you'd need `log_{10}(128) ≈ 3` merge passes instead. See [../03-external-sorting/interview.md](../03-external-sorting/interview.md).

---

## Gotcha / Trick Questions

### Q11: "Isn't the I/O model obsolete now that we have SSDs and tons of RAM?" *(Hard)*

**Answer**: **No.** The model describes a *gap between two memory levels*, and that gap **exists at every level of the hierarchy** — it never went away, it just moved. SSDs shrank the RAM↔storage gap but didn't close it (random vs sequential still differs ~10–100×). And the *same* model, with different `M` and `B`, governs **CPU caches**: L1↔L2↔L3↔RAM are exactly a fast-small / slow-large pair transferring fixed-size **cache lines** (`B` ≈ 64 bytes). A "cache miss" is just an I/O at a different level.

So the model is more relevant than ever: it's why **cache-aware** and **cache-oblivious** algorithms (which optimize for the CPU-cache hierarchy without even knowing `M` and `B`) matter for in-memory, RAM-fits performance. More RAM doesn't help if your access pattern thrashes L3. The hierarchy is fractal; the I/O model is its theory. See [./middle.md](./middle.md).

### Q12: "Counting operations vs counting I/Os" — what's the trap? *(Medium)*

**Answer**: The trap is **reflexively analyzing in the RAM model** — counting comparisons or arithmetic ops — when the cost is data movement. Quicksort does `Θ(N log N)` *comparisons* (great in the RAM model) but its random partitioning causes `Θ(N log N)` *random I/Os* in the worst case on disk — far worse than external merge sort's `Θ((N/B) log_{M/B}(N/B))` *sequential* I/Os, even though both are "`N log N` algorithms." Two algorithms with identical RAM-model complexity can differ by orders of magnitude in I/Os. **Always ask which boundary the data crosses and how many times**, not how many operations run.

### Q13: "The merge fan-in is M, right?" *(Medium)*

**Answer**: **No — it's `M/B`.** To `k`-way merge you must hold **one block from each of the `k` runs in memory simultaneously** (plus an output block), so `k · B ≤ M`, giving `k ≤ M/B`. People who write `log_M` instead of `log_{M/B}` for the sort bound have made exactly this error. The block buffering is what costs the `B` factor: you can't keep `M` *runs* open, only `M/B` of them, because each open run needs a full block of buffer space. This is the single most common mistake in stating the external-sort bound.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | What does DAM stand for? | Disk Access Machine (the I/O model) |
| 2 | The three parameters? | `N` (size), `M` (memory), `B` (block) |
| 3 | The cost measure? | Number of block transfers (I/Os); CPU is free |
| 4 | Scan bound? | `Θ(N/B)` |
| 5 | Sort bound? | `Θ((N/B) log_{M/B}(N/B))` |
| 6 | Search bound (B-tree)? | `Θ(log_B N)` |
| 7 | Permute bound? | `Θ(min(N, sort(N)))` |
| 8 | Merge fan-in? | `M/B`, **not** `M` |
| 9 | Why B-tree beats binary tree on disk? | Height `log_B N` vs `log₂ N` → factor `log₂ B` fewer I/Os |
| 10 | Why is permuting hard? | Relocating data across blocks costs as much as sorting |
| 11 | Sequential vs random I/O ratio (disk)? | ~100×–1000× |
| 12 | Passes to sort 1 TB with 8 GB RAM? | ~2–3 (`log_{M/B}` is tiny) |
| 13 | Does the model apply to CPU caches? | Yes — `B` = cache line, levels = L1/L2/L3/RAM |
| 14 | Cache-oblivious means? | Optimal I/Os without knowing `M`, `B` |
| 15 | Constraint among parameters? | `1 ≤ B ≤ M ≤ N` |

---

## Common Mistakes

1. **Writing `log_M` instead of `log_{M/B}`** for the sort bound. The fan-in is `M/B` because every open run needs a full block buffer.
2. **Analyzing on-disk algorithms in the RAM model.** Count I/Os, not comparisons; two `N log N` algorithms can differ by a factor of `B`.
3. **Forgetting the `1/B` factor in scanning.** Sequential access gets `Θ(N/B)`; element-at-a-time random access is `Θ(N)` — a factor of `B` worse.
4. **Thinking permuting is cheaper than sorting.** It's `Θ(min(N, sort(N)))` — for realistic parameters that's `Θ(sort(N))`.
5. **Claiming the model is obsolete with SSDs/big RAM.** The hierarchy persists at every level; the same model governs CPU caches.
6. **Confusing `log_B N` (B-tree height) with `log₂ N` (binary height).** The base change is the whole point — it's a `log₂ B` factor.
7. **Quoting the sort bound without noting `log_{M/B}` is tiny.** In practice it's 2–3; the bound looks scary but real sorts take a handful of passes.

---

## Tips & Summary

- **Lead with the cost model**: "We count *block transfers*, not operations — CPU work on resident data is free." This single sentence reframes every subsequent answer correctly.
- **Memorize the four bounds cold**: scan `Θ(N/B)`, sort `Θ((N/B) log_{M/B}(N/B))`, search `Θ(log_B N)`, permute `Θ(min(N, sort(N)))`. Interviewers expect these on sight, with the `M/B` (not `M`) base.
- **Always derive the sort bound from external merge sort**: run formation (`N/M` runs) + `(M/B)`-way merge (`log_{M/B}` passes). Naming the `M/B` fan-in shows you understand the block-buffering constraint.
- **Tie every bound to the `1/B` and base-change intuition**: blocking buys a factor of `B` on scans and a base-`B` log on searches — that's where all the savings live.
- **Connect theory to systems**: B+-tree indexes, sequential vs random I/O, "sort a TB in 2 passes." Concrete numbers (`B ≈ 1000` → 3-level B-tree vs 30-level binary tree) land harder than asymptotics.
- **Have the SSD/cache rebuttal ready**: the model isn't about disks specifically, it's about *any* fast-small / slow-large pair — including CPU caches, which is why cache-oblivious algorithms exist.

**Related:** [External Sorting — Interview](../03-external-sorting/interview.md) · [B-Tree I/O Analysis — Interview](../04-b-tree-io-analysis/interview.md) · [The I/O Model — Middle](./middle.md)
