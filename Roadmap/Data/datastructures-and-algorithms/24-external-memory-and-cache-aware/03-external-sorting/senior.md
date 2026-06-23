# External Sorting — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — external merge sort, the `(M/B)`-way merge, run formation, replacement selection and the loser/tournament tree, and the bound `Θ((N/B) log_{M/B}(N/B))`
- [The I/O Model — Senior](../01-the-io-model/senior.md) — the two-level `(N, M, B)` model, the permutation-counting lower bound for sorting, and `perm(N) = Θ(min(N, sort(N)))`
- [Cache-Oblivious Algorithms — Senior](../02-cache-oblivious-algorithms/senior.md) — the ideal-cache model, the tall-cache assumption, and funnelsort
- [Lower Bounds and Adversary Arguments — Senior](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/senior.md) — the discipline that a lower bound is a statement about a *model*, instantiated here as the counting argument that forces the sorting bound

## Table of Contents

1. [What Senior-Level External Sorting Is About](#what-senior-level-external-sorting-is-about)
2. [Distribution Sort: the Dual of Merge Sort](#distribution-sort-the-dual-of-merge-sort)
3. [Sample Sort and the Splitter-Selection Problem](#sample-sort-and-the-splitter-selection-problem)
4. [Cache-Oblivious Sorting: Funnelsort](#cache-oblivious-sorting-funnelsort)
5. [The Sorting Lower Bound and Why Both Algorithms Are Optimal](#the-sorting-lower-bound-and-why-both-algorithms-are-optimal)
6. [Parallel and Multi-Disk External Sorting](#parallel-and-multi-disk-external-sorting)
7. [External Sorting Across a Cluster: the Shuffle](#external-sorting-across-a-cluster-the-shuffle)
8. [Replacement Selection Deep: the 2M Snowplow](#replacement-selection-deep-the-2m-snowplow)
9. [Variants: Strings, Duplicates, Stability, Top-K](#variants-strings-duplicates-stability-top-k)
10. [Worked Piece: The Distribution-Sort I/O Recurrence](#worked-piece-the-distribution-sort-io-recurrence)
11. [Decision Framework](#decision-framework)
12. [Research Pointers](#research-pointers)
13. [Key Takeaways](#key-takeaways)

---

## What Senior-Level External Sorting Is About

The middle level establishes the *workhorse*: external merge sort. Form `N/M` sorted runs (sorting `M`-element chunks in RAM, or stretching runs with replacement selection), then merge `M/B`-at-a-time over `log_{M/B}(N/B)` passes. That algorithm meets the I/O bound and is what every production sort actually runs. The middle level is "here is the algorithm that works."

Senior-level external sorting is about *the space of optimal algorithms around merge sort*, *why merge sort wins in practice anyway*, and *what changes when the machine stops being one disk*. Five threads run through it:

1. **Merge sort is not the only optimal algorithm — it has an exact dual.** **Distribution sort** (external quicksort / sample sort) partitions into `Θ(√(M/B))` buckets by sampled splitters and recurses, achieving the *same* `Θ((N/B) log_{M/B}(N/B))` bound by a recursion that mirrors merge sort's pass structure term-for-term. Knowing both, and *why* merge sort is usually preferred despite the tie, is the senior baseline.
2. **The bound is reachable without knowing `M` or `B`.** Brodal and Fagerberg's **funnelsort** (a cache-oblivious distribution-like merge) hits `Θ((N/B) log_{M/B}(N/B))` with no machine parameters in the code — the sorting counterpart to the search structures in [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md).
3. **Optimality is a *theorem*, and both algorithms meet it.** The lower bound `Ω((N/B) log_{M/B}(N/B))` is the permutation-counting argument of [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md); merge sort and distribution sort are both *optimal*, so the choice between them is about constant factors, write patterns, and parallelism — not asymptotics.
4. **One disk is a fiction.** Real sorts run on `D` disks (the **Parallel Disk Model**, Vitter–Shriver) or across a cluster (the MapReduce/Spark **shuffle** *is* distributed external sort). The `D`-fold speedup is *conditional* on solving a disk-scheduling / load-balancing problem that naïve striping fails — the subject of Greed Sort and Balance Sort.
5. **Records are not uniform integers.** Variable-length strings, heavy duplicates, and the demand for *stability* each bend the analysis. Knowing where the clean bound leaks — the prefix problem for string sort, the duplicate-skew problem for distribution sort — is the senior's edge.

The unifying stance: *external sorting has a single optimal cost, two dual ways to reach it, a parameter-free cousin, and a parallel generalization whose hardness lives entirely in load balancing.* Everything below is an instance of that map.

---

## Distribution Sort: the Dual of Merge Sort

Merge sort and quicksort are duals in RAM: merge sort does no work on the way down and all the work merging up; quicksort does all the work partitioning down and none coming up. The duality survives into external memory.

> **Distribution sort (external).** Choose `S = Θ(√(M/B))` **splitters** `x_1 < x_2 < ⋯ < x_{S−1}` that partition the key range into `S` buckets of roughly `N/S` elements each. Scan the input once, routing each element to its bucket's output buffer; flush buffers to disk in blocks. Recurse on each bucket until a bucket fits in memory (`≤ M`), then sort it internally. Concatenate the sorted buckets — they are already in global order.

### Why the fan-out is `√(M/B)`, not `M/B`

The merge-sort fan-in is `M/B`: in a merge you keep *one* input block from each of `M/B` runs plus an output block, and `(M/B + 1)` blocks fit in `M`. Distribution sort is asymmetric — you read *one* input stream but write to *all* `S` buckets at once, so you must keep one output block per bucket resident. That alone caps `S ≤ M/B`. The tighter `√(M/B)` cap comes from the *splitter-selection* requirement: to pick `S` splitters that partition well, the algorithm samples and sorts a sample of size `Θ(S²)`-ish in memory, and the cleanest analyses (Aggarwal–Vitter; Nodine–Vitter) take `S = Θ(√(M/B))` so that both the output buffers *and* the splitter machinery fit comfortably, and so each level reduces problem size by a `√(M/B)` factor. With fan-out `√(M/B)`, the number of levels is

```text
   log_{√(M/B)} (N/M)  =  2 · log_{M/B} (N/M)  =  Θ( log_{M/B}(N/B) ),
```

twice as many levels as merge sort's passes — but each level still costs `Θ(N/B)` I/Os (one scan to route), so the product is the *same* `Θ((N/B) log_{M/B}(N/B))`. The factor-of-2 in levels is exactly cancelled by `√(M/B)` being the square root: `log_{√x} = 2 log_x`. This term-for-term cancellation is the algebraic heart of the duality.

### Why merge sort is usually preferred

Both are optimal, yet practice overwhelmingly chooses merge sort. The reasons are about *constants and access patterns*, not asymptotics:

- **Sequential writes.** Merge sort's output in each pass is one long sequential stream per run — perfectly sequential I/O, which is what disks and SSDs reward most. Distribution sort writes to `S` buckets *interleaved*, scattering writes across `S` regions; even buffered, this is more seek-prone and less friendly to the write path. On spinning disks this is decisive; on SSDs it raises write amplification and stresses the FTL.
- **No data-dependent imbalance.** Merge sort's pass cost is `N/B` *regardless of the data*. Distribution sort's bucket sizes depend on splitter quality and on duplicates; a skewed partition makes some buckets huge and the recursion deeper, requiring the sampling safeguards below to stay optimal *with high probability* rather than deterministically.
- **Simplicity and predictability.** Merge sort has one tuning knob (fan-in) and a flat, analyzable I/O profile; ops teams can size buffers and predict pass count exactly.

### Why distribution sort is not dead: parallelism

Distribution sort's one structural advantage is **independence**: after the partition pass, the `S` buckets are *disjoint* and can be sorted on `S` different machines/disks/cores with **zero coordination**. Merge sort's final merge is a *serial bottleneck* — the last pass funnels all data through one merge. This is precisely why **every distributed sort is a distribution sort**: the MapReduce/Spark shuffle (Section 7) partitions by key range or hash, then sorts partitions independently. At cluster scale, "sequential writes" matters less than "no global merge step," and the duality flips: distribution sort wins.

---

## Sample Sort and the Splitter-Selection Problem

The quality of distribution sort hinges entirely on the splitters. Perfect splitters give buckets of size exactly `N/S`; bad splitters give skew, deeper recursion, and lost optimality. **Sample sort** is the standard randomized solution.

> **Sample sort.** Draw a random sample of `s = Θ(S log N)` elements ("oversampling ratio" `Θ(log N)` per splitter). Sort the sample (it fits in memory). Pick every `(s/S)`-th element of the sorted sample as a splitter. With these splitters, every bucket has size `O((N/S))` with high probability.

### The splitter-selection problem stated precisely

The goal is `S − 1` splitters such that **no bucket exceeds `c · N/S`** for a small constant `c`. With a *single* sample per splitter the variance is too high — an unlucky draw yields an oversized bucket. The fix is **oversampling**: draw `ρ · S` samples for oversampling factor `ρ`, sort them, and take every `ρ`-th as a splitter. A Chernoff bound on the number of input elements falling between consecutive *sorted-sample* order statistics shows that `ρ = Θ(log N)` makes `Pr[some bucket > c·N/S] ≤ 1/poly(N)`. This is the same oversampling analysis that underlies parallel sample sort (Blelloch et al.) and the regular sampling of Shi–Schaeffer's PSRS.

The cost accounting: the sample has size `Θ(S log N) = Θ(√(M/B) · log N)`, which must fit in `M` — true for any realistic `M`, since `√(M/B) ≪ M`. Sorting the sample is internal work, free in the I/O model. The result is a distribution sort whose levels are *balanced with high probability*, restoring the deterministic-looking `Θ((N/B) log_{M/B}(N/B))` bound as an expected (and w.h.p.) bound.

### Deterministic splitter selection

If a deterministic guarantee is required, splitters can be chosen by a *deterministic sampling* scheme: split the input into groups, sort each group, sample regularly from each, then recursively select splitters from the pooled regular samples (the multi-way generalization of median-of-medians). This trades the simplicity of randomization for a worst-case bound, at higher constant factors. In external memory, the randomized scheme is almost always used; the deterministic one matters mainly for adversarial-input guarantees.

---

## Cache-Oblivious Sorting: Funnelsort

Distribution sort and merge sort both *know* `M` and `B` — they set the fan-out to `√(M/B)` or `M/B`. The cache-oblivious challenge is to hit the same bound *with no `M` or `B` in the code*.

> **Funnelsort (Frigo–Leiserson–Prokop–Ramachandran 1999; lazy funnelsort, Brodal–Fagerberg 2002).** Recursively split the `N` elements into `N^{1/3}` segments of `N^{2/3}` each; sort each recursively; then merge all `N^{1/3}` sorted segments using a **`k`-merger** (a "funnel") — a recursively laid-out binary-merge tree with buffers sized so that, *whatever* `B` is, the merge moves data block-efficiently.

The engine is the **`k`-merger**: a complete binary tree of binary mergers with `k` input streams and one output, with internal buffers whose sizes grow geometrically toward the root and whose layout follows the **van Emde Boas recursion** (split the tree at half its height; lay out the top recursively, then each bottom subtree recursively, contiguously). A `k`-merger outputs `k³` elements in `O((k³/B) log_{M/B}(k³/B) + k)` I/Os. Funnelsort feeds its recursively-sorted segments into a `Θ(N^{1/3})`-merger, and the recursion solves to

```text
   Sort(N)  =  O( (N/B) · log_{M/B}(N/B) )    — optimal, parameter-free.
```

The mechanism mirrors the senior I/O-model story: at *some* level of the recursion the subproblem fits in cache and the buffers span the right number of blocks — the recursion *auto-tunes* the fan-in to whatever `M`, `B` the hardware has. Crucially, funnelsort **requires the tall-cache assumption `M = Ω(B²)`**; Brodal and Fagerberg proved tall-cache is *necessary* for any cache-oblivious sorting algorithm to be optimal. **Lazy funnelsort** (Brodal–Fagerberg 2002) simplifies the original by filling buffers on demand rather than eagerly, with the same bound and much smaller constants — it is the practical form. The full development, including the vEB layout and the `k³` merger analysis, is in [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md).

The senior point: funnelsort proves the I/O sorting bound is reachable *obliviously*, so it is optimal at *every* level of a multilevel hierarchy at once — but its scattered, pointer-following buffer traversals make its constants larger than a well-tuned merge sort's, so in production it is chosen for portability and multi-level optimality, not raw single-level throughput.

---

## The Sorting Lower Bound and Why Both Algorithms Are Optimal

That merge sort *and* distribution sort *and* funnelsort all land on `Θ((N/B) log_{M/B}(N/B))` is not a coincidence — it is forced by a lower bound that no comparison-based external algorithm can escape.

> **Theorem (Aggarwal–Vitter, 1988).** Sorting `N` elements in the comparison-based I/O model requires
> ```text
>    Ω( (N/B) · log_{M/B}(N/B) )
> ```
> block I/Os.

The proof is the permutation-counting argument developed in full in [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) and is the I/O-model instance of the model-bound-via-invariant discipline of [`../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/senior.md`](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/senior.md). In one paragraph: track the number of input orderings still *consistent* with everything the algorithm has observed. Each block *read* lets the algorithm interleave `B` arriving elements among the `M` resident ones — multiplying the number of distinguishable orderings by at most `binom(M, B) · B! = 2^{O(B log(M/B))}`. A *write* reveals nothing (factor `1`). To go from `N!` consistent orderings down to one, the product of per-I/O factors must reach `N!`:

```text
   ( 2^{O(B log(M/B))} )^{t}  ≥  N!  ⟹  t · O(B log(M/B)) ≥ Θ(N log N)
   ⟹  t = Ω( (N/B) · log_{M/B}(N/B) ).
```

Reading the two factors: `N/B` is the **scan floor** (you must touch each element, `B` at a time); `log_{M/B}(N/B)` is the **number of passes/levels** — each pass collapses `M/B` runs (merge) or splits into `√(M/B)` buckets (distribution), and you need that many to go from `N/B` singletons to one global order.

**Why all three are optimal.** Merge sort achieves `O((N/B) log_{M/B}(N/B))` by `log_{M/B}(N/B)` passes of cost `N/B` (Section 10 of the I/O-model file, and the middle level here). Distribution sort achieves it by `2 log_{M/B}(N/B)` levels of cost `N/B` (Section 10 below). Funnelsort achieves it obliviously. The lower bound is the *same* for all of them, so each is **asymptotically optimal**; the differences are entirely in constant factors, write sequentiality, and parallelizability. This is the senior's licence to choose merge sort by default *without sacrificing optimality* — there is nothing asymptotically better to give up. (The bound is comparison-based; integer/radix external sorts can beat it by exploiting key bits, exactly as hashing escapes the RAM `Ω(n log n)` — the "name the model" caveat applies verbatim.)

---

## Parallel and Multi-Disk External Sorting

A single disk is a modeling convenience. Real high-throughput sorts run on `D` disks (a RAID array, a multi-channel SSD, or many drives), and the interesting theory is *how to keep all `D` disks busy*.

> **Parallel Disk Model (Vitter–Shriver, 1994).** `D` independent disks, each transferring one block per parallel I/O step; a single parallel I/O moves up to `D·B` elements (one block per disk). The sorting bound becomes
> ```text
>    Θ( (N / (D·B)) · log_{M/B}(N/B) )
> ```
> *parallel* I/O steps — the `D` divides the linear term because `D` disks scan in parallel.

The bound looks like a free `D`-fold speedup, but achieving it is a genuine problem because of **disk-scheduling / load balancing**: a parallel I/O only achieves the `D`-fold transfer if it draws (nearly) one block from *every* disk. The merge phase breaks naïve schemes — at a given moment the merge may need the next blocks of many runs that, under simple **disk striping** (block `i` on disk `i mod D`), happen to live on the same disk, serializing what should be parallel.

### Disk striping and its limitation

The simplest layout, **disk striping**, treats the `D` disks as one logical disk of block size `D·B` and runs ordinary `(M/(DB))`-way merge sort on it. This is trivially correct and load-balanced, but the *effective* block size is now `D·B`, so the fan-in is `M/(DB)` instead of `M/B`, and the pass count is `log_{M/(DB)}(N/(DB))` — *larger* than the optimal `log_{M/B}(N/B)` when `D` is large. Striping wastes the log factor: it is optimal only up to the loss in fan-in. For large `D` this is asymptotically suboptimal.

### Greed Sort and Balance Sort

Achieving the *true* optimal parallel bound — full `D`-fold speedup *and* fan-in `M/B` — required new algorithms that decouple the merge from a rigid striping:

- **Greed Sort (Nodine–Vitter, 1995).** A deterministic, optimal parallel-disk merge sort. It performs a two-pass "approximate then correct" merge: a *greedy* pass reads from whichever disks are most able to supply the next-needed blocks (greedily balancing the read load across disks), producing a sequence that is *almost* sorted (each element within a bounded distance of its final position), followed by a cleanup pass that finishes the sort. Greed Sort was the first to achieve the optimal `Θ((N/DB) log_{M/B}(N/B))` parallel I/O bound deterministically.
- **Balance Sort (Nodine–Vitter, 1993).** An earlier distribution-based optimal parallel-disk sort that maintains a *balanced* assignment of each run's blocks across the `D` disks as it distributes, ensuring every parallel I/O can draw evenly. It achieves the optimal bound by construction of a balanced layout rather than greedy correction.

The randomized alternative — **randomized cycling / RCD** (Vitter–Hutchinson; Dementiev–Sanders) — places the blocks of each run on disks by a random cyclic permutation, which makes disk conflicts rare with high probability and is what fast practical libraries (e.g. STXXL) actually implement. The senior framing: in the PDM, the *sorting* is solved (it's merge or distribution sort); the research content is entirely in the **block-to-disk assignment** that keeps the `D`-fold parallelism real, and Greed/Balance Sort are the deterministic optima while randomized cycling is the practical workhorse.

---

## External Sorting Across a Cluster: the Shuffle

Push the hierarchy one level out: the slowest "memory" is now *another machine's disk reached over the network*. Sorting `N` records spread across a cluster of machines is **distributed external sorting**, and it is exactly a distribution sort whose buckets are *network destinations*.

The MapReduce/Spark **shuffle is distributed external sort**:

1. **Local sort + partition (the map / distribution pass).** Each machine reads its local input, computes a partition key (range or hash), and writes records into per-destination spill files — a distribution-sort partition pass, but the buckets are the `R` reducers/partitions. Locally, when a buffer fills, it is sorted and spilled; the spills are merged — *external merge sort on each mapper*.
2. **Transfer (the network as a hierarchy level).** Each partition's data is sent to the machine responsible for it. This all-to-all transfer is the shuffle; the network bandwidth and the `M·N` number of connections are the dominant cost, the analogue of the disk-scheduling problem one level up.
3. **Merge (the reduce pass).** Each receiver merges the sorted runs arriving from all senders — an `(#senders)`-way external merge — producing its partition in sorted order. Concatenating partitions in key order yields global order, exactly as in distribution sort.

This is why **distribution sort, not merge sort, is the template at cluster scale**: there is no global merge bottleneck — the `R` partitions are independent, just as distribution sort's buckets are. The famous sort benchmarks (TeraSort, GraySort, Spark's 2014 record sorting 100 TB) are *exactly* this pipeline: range-partition by sampled splitters (sample sort, Section 3, choosing the splitters by sampling across machines), shuffle, then local merge sort. The splitter-selection problem becomes choosing range boundaries so each reducer gets a balanced share — the same oversampling story, now protecting against *stragglers* (one overloaded reducer dominates wall-clock time) rather than recursion depth. Every level of the storage hierarchy — registers, cache, RAM, local disk, remote disk — is just another `(M, B)` boundary, and the network is the outermost one.

---

## Replacement Selection Deep: the 2M Snowplow

Run formation by "sort `M`-element chunks" produces runs of length exactly `M`. **Replacement selection** produces *longer* runs — expected `2M` on random input — reducing the number of initial runs and thus potentially the merge pass count. The middle level introduces the loser/tournament tree implementation; the senior content is *the `2M` analysis and when it actually helps*.

### The snowplow argument

> **Theorem (Knuth, after E. F. Moore).** Replacement selection on a uniformly random permutation produces runs of expected length `2M`.

The intuition is the **snowplow** (Knuth's image). Picture a snowplow circling a circular road at constant speed; snow falls uniformly. At steady state, snow is piled ahead of the plow and clear behind it. The plow pushes a *constant amount* of snow, and the total snow on the road is twice what the plow holds, because snow falls both behind (cleared, will be plowed next lap) and ahead (still to be plowed this lap).

Map it to replacement selection. Memory holds `M` records (the heap of the loser tree). The current run's "minimum acceptable key" advances like the plow. When a new input record arrives:

- if its key `≥` the last key emitted, it belongs to the **current** run — it can still be plowed this lap (snow ahead of the plow);
- if its key `<` the last emitted, it belongs to the **next** run — it is "frozen," held in memory but not emitted yet (snow already fallen behind the plow, to be cleared next lap).

At steady state on random input, half the `M` resident records belong to the current run and half to the next; but as the current run drains, records that arrive go into it as long as their key exceeds the emission frontier. Summing the snow plowed over one full lap, the plow moves `2M` worth of records before the heap fills entirely with next-run records and a new run must start. Formally, model the emission frontier as a point sweeping `[0,1)`; a fresh uniform key lands ahead of the frontier (current run) with probability equal to the fraction of the range still ahead, and integrating the expected run length over the sweep gives `E[run length] = 2M`.

### When replacement selection helps — and when it does not

The `2M` runs halve the *number* of initial runs (`N/2M` instead of `N/M`), shaving the merge passes from `log_{M/B}(N/M)` to `log_{M/B}(N/2M)` — a saving of *one merge pass* in the best case, since `log_{M/B}(N/2M) = log_{M/B}(N/M) − log_{M/B}(2)`. For large `M/B` that is a sub-pass fractional saving — often not worth it. The honest senior accounting:

- **Near-sorted input is where it shines.** On input that is already nearly sorted (or reverse-runs), replacement selection produces *enormously* long runs — potentially a *single* run for fully sorted input, collapsing run formation to one pass and eliminating *all* merge passes. This is the real payoff: replacement selection is **adaptive** to existing order, whereas chunk-sort is oblivious to it.
- **Random input: marginal.** On random data the `2×` run length saves at most one merge pass, and the cost is real: replacement selection reads/writes in a less cache-friendly heap pattern (a loser tree of `M` elements with poor locality) and historically interfered with read-ahead and large sequential I/O. Modern sorts often *prefer* chunk-sort with large `M` (quicksort/radix on a full memory load) precisely because its sequential scan and cache behavior beat the heap, and because doubling `M` via cheap RAM buys the missing pass directly.
- **Variable-length records.** Replacement selection naturally handles variable-length records (the heap holds whatever fits), which is one reason it persisted in classic tape-era and database sorts.

So replacement selection is a *conditional* win: take it for near-sorted or partially-ordered input and for variable-length records; skip it for random fixed-size data on a machine with abundant RAM, where a large-`M` chunk sort is simpler and faster.

---

## Variants: Strings, Duplicates, Stability, Top-K

The clean `Θ((N/B) log_{M/B}(N/B))` bound assumes fixed-size records and atomic, equal-cost comparisons. Real workloads break those assumptions in instructive ways.

### Sorting variable-length records and strings

Strings break the "one comparison = `O(1)`" assumption: comparing two long strings can scan many blocks, and a string longer than `B` does not fit in a single block. **External string sorting** must therefore charge for *character* accesses, not just record comparisons. The key technique is the **LCP (longest-common-prefix) exploitation** of the multikey / three-way radix family: once two strings are known to share a prefix, never re-compare that prefix. The relevant bound (Arge, Ferragina, Grossi, Vitter, 1997) separates the I/O cost into a term for distributing the strings and a term proportional to the total length of the *distinguishing prefixes* — sorting strings costs `Θ((N/B) log_{M/B}(N/B))` in *string moves* plus the cost of scanning enough characters to make all strings distinguishable. Long shared prefixes (URLs, paths) make the second term dominate, and string-specific layouts (storing only distinguishing prefixes in the sort buffers, with pointers to the full strings) are how production string sorts stay efficient. Variable-length records more generally are handled by sorting *pointers/keys* (key normalization, below) and dereferencing the payload only when emitting.

### Key normalization

The standard production trick to restore the clean model: **normalize** each record's sort key into a fixed-length, byte-comparable binary string (encode multi-field keys, collation, signs, and endianness so that `memcmp` order equals the desired order). Then sort the normalized keys (fixed-size, comparison `= memcmp`, cache-friendly) carrying a pointer to the full record. This converts arbitrary-comparator, variable-length sorting back into the fixed-size model the bound assumes, and is why databases compute "sort keys" once up front.

### Sorting with duplicates

Heavy duplication is dangerous for **distribution sort**: if a single value's multiplicity exceeds a bucket's target size, that value cannot be split by splitters, and the bucket overflows the recursion. The fix is **three-way partitioning** (Dutch-national-flag-style: `< pivot`, `= pivot`, `> pivot`) so that equal-to-splitter elements form their own already-sorted bucket and are removed from recursion. Merge sort is naturally robust to duplicates (equal keys merge fine). The complexity-theoretic refinement: when the input has only `d` distinct values, sorting needs only `Θ((N/B) log_{M/B} d)`-style cost (the entropy of the multiset), reachable by partition-based methods — a genuine improvement when `d ≪ N`.

### Stable external sort

A sort is **stable** if equal-key records retain their input order. External merge sort is stable *if* each merge breaks ties toward the run with the earlier-origin records — concretely, tag each record with its global input index (or process runs in order and prefer the earlier run on ties). Distribution sort is *not* naturally stable (routing to buckets scrambles equal-key order) unless equal keys carry a tiebreak index. The cheap universal trick: **append the original position as a low-order key suffix** during key normalization, making any sort stable at the cost of a wider key. Stability matters for multi-pass sorting (sort by secondary key, then stably by primary) and for database `ORDER BY` semantics.

### Top-K and partial sort versus full sort

If you only need the `K` smallest (or a sorted prefix), a *full* sort is wasteful. **External top-K**:

- For `K ≤ M`: a single scan maintaining a bounded heap (or a threshold filter) of the best `K` seen costs `Θ(N/B)` I/Os — *one scan*, no sorting bound at all. This is the external version of "selection beats sorting."
- For `K > M`: combine *external selection* (find the `K`-th smallest by a median-of-medians / quickselect-style distribution pass, `Θ(N/B)` I/Os) to threshold, then sort only the `≤ K` qualifying elements, `Θ((K/B) log_{M/B}(K/B))`. Total `Θ(N/B + sort(K))` — far below `sort(N)` when `K ≪ N`.

The senior rule: **never sort what you can select.** Top-K, "find the median," and "k-th smallest" are `Θ(N/B)` scan/selection problems, not `Θ(sort(N))` sorting problems; reaching for a full sort to answer them is the most common external-memory waste.

---

## Worked Piece: The Distribution-Sort I/O Recurrence

To see distribution sort meet the lower bound exactly, set up and solve its I/O recurrence and confirm it lands on `Θ((N/B) log_{M/B}(N/B))`.

### The recurrence

Let `T(n)` be the number of I/Os to distribution-sort `n` elements with memory `M`, block size `B`, and fan-out `S = √(M/B)`.

**Base case.** When `n ≤ M`, the whole subproblem fits in memory; read it (`n/B` I/Os), sort internally (free), write it (`n/B` I/Os): `T(n) = Θ(n/B)` for `n ≤ M`.

**Partition step.** For `n > M`: choose `S = √(M/B)` splitters (sample-sort sampling — internal cost, plus an `O(n/B)`-or-less sampling scan), then *scan* the `n` elements once, routing each to one of `S` output buffers and flushing buffers in blocks. Reading `n` elements costs `n/B`; writing them to `S` buckets costs `n/B` (each element written once). So the partition step is `Θ(n/B)` I/Os. Recurse on `S` buckets, each of size `≈ n/S` (balanced w.h.p. by oversampling):

```text
   T(n)  =  S · T(n/S)  +  Θ(n/B),      T(n) = Θ(n/B) for n ≤ M.
```

### Solving it

Unroll. At recursion depth `i`, there are `S^i` subproblems each of size `n/S^i`, and each contributes `Θ((n/S^i)/B)` to the partition cost at that level. So the *total partition cost per level* is

```text
   S^i · Θ( (n/S^i) / B )  =  Θ( n/B )      — independent of i.
```

Every level costs `Θ(n/B)` I/Os (one effective scan of all data, spread across the buckets). The recursion stops when `n/S^L ≤ M`, i.e. at depth

```text
   L  =  log_S (n/M)  =  log_{√(M/B)} (n/M)  =  2 · log_{M/B} (n/M).
```

Total cost = (cost per level) × (number of levels), plus the base-case scans (one more `Θ(n/B)` level):

```text
   T(n)  =  Θ(n/B) · ( L + 1 )
         =  Θ(n/B) · ( 2 log_{M/B}(n/M) + 1 )
         =  Θ( (n/B) · log_{M/B}(n/B) ).
```

The `log_{M/B}(n/M)` and `log_{M/B}(n/B)` differ by the additive constant `log_{M/B}(M/B) = 1`, absorbed by `Θ`.

### Confronting the lower bound

The lower bound is `Ω((N/B) log_{M/B}(N/B))`; distribution sort achieves `O((N/B) log_{M/B}(N/B))`. **They match — distribution sort is asymptotically optimal, exactly like merge sort.** Two senior observations close the loop:

1. **The `√` and the `2` cancel.** Distribution sort runs `2 log_{M/B}(N/B)` levels — *twice* merge sort's pass count — but each level is a single scan, so the only difference from merge sort is a constant factor of `~2` in passes, precisely because the fan-out `√(M/B)` is the square root of merge sort's fan-in. The duality is exact: `log_{√x} N = 2 log_x N`. Neither algorithm beats the other asymptotically.
2. **The fan-out is the whole game, again.** Just as merge sort's optimality hinges on fan-in `M/B` (not 2), distribution sort's hinges on fan-out `√(M/B)` (not 2). A binary external quicksort (fan-out 2) would do `log_2(N/M)` levels — a factor `log_2(M/B)` worse — exactly the penalty a binary merge sort pays. Both algorithms convert *all of memory* into parallelism at each level; that conversion is what buys the base-`(M/B)` logarithm.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Default external sort, one machine, RAM↔disk | **External merge sort**, fan-in `M/B`, large buffers | Sequential writes, data-independent pass cost, one tuning knob |
| Distributed / cluster sort | **Distribution sort** (range/hash partition → shuffle → local merge) | No global merge bottleneck; buckets sort independently (this *is* the shuffle) |
| Portable / multi-level-optimal sort | **Funnelsort / lazy funnelsort** (needs `M ≥ B²`) | Hits the bound with no `M, B` in code; optimal at every hierarchy level |
| Multiple disks / RAID, want `D×` speedup | **Greed Sort / Balance Sort** (deterministic) or **randomized cycling** (practical) | Striping wastes the log factor; these keep fan-in `M/B` *and* balance disks |
| Near-sorted or partially-ordered input | **Replacement selection** for run formation | Adaptive: produces giant runs (possibly one), collapsing merge passes |
| Random fixed-size input, abundant RAM | **Chunk-sort runs** (quicksort/radix on full `M`) | Cache-friendly scan beats the loser-tree heap; just enlarge `M` |
| Variable-length / string keys | **Key normalization** + LCP-aware string sort | Restores fixed-size model; charges only for distinguishing prefixes |
| Heavy duplicates | **3-way partition** distribution sort, or merge sort | Removes equal-to-splitter elements from recursion; merge sort is naturally robust |
| Need stability | **Merge sort** (tie toward earlier run) or **position-suffix key** | Distribution sort scrambles equal-key order unless tiebroken |
| Only the `K` best, or the `k`-th element | **External selection / bounded heap**, *not* a full sort | `Θ(N/B)` scan/selection ≪ `Θ(sort(N))`; never sort what you can select |

Two rules of thumb:
1. **Merge by default, distribute to parallelize.** Both are optimal; merge sort wins single-machine constants (sequential writes), distribution sort wins distributed/parallel settings (no global merge). Choose by *where* the work runs, not by asymptotics.
2. **Match the run-formation method to the input's order.** Replacement selection for near-sorted/variable-length; large-`M` chunk-sort for random fixed-size. The `2M` snowplow is a marginal win on random data and a huge win on ordered data.

---

## Research Pointers

- **Aggarwal, A., & Vitter, J. S. (1988). "The Input/Output Complexity of Sorting and Related Problems."** *CACM* 31(9). The founding paper: the two-level model, the tight sorting lower bound, *and the original external distribution sort* alongside merge sort.
- **Vitter, J. S., & Shriver, E. A. M. (1994). "Algorithms for Parallel Memory I & II."** *Algorithmica* 12. The Parallel Disk Model (`D` disks) and the framework for optimal multi-disk external sorting.
- **Nodine, M. H., & Vitter, J. S. (1995). "Greed Sort: Optimal Deterministic Sorting on Parallel Disks."** *JACM* 42(4). The first deterministic optimal parallel-disk sort; the greedy approximate-then-correct merge.
- **Nodine, M. H., & Vitter, J. S. (1993). "Deterministic Distribution Sort in Shared and Distributed Memory Multiprocessors" / Balance Sort.** *SPAA.* The balanced-distribution optimal parallel-disk sort.
- **Frigo, M., Leiserson, C. E., Prokop, H., & Ramachandran, S. (1999). "Cache-Oblivious Algorithms."** *FOCS 1999 / ACM TALG 2012.* Funnelsort and the `k`-merger; optimal sorting with no machine parameters.
- **Brodal, G. S., & Fagerberg, R. (2002). "Cache Oblivious Distribution Sweeping" and lazy funnelsort.** *ICALP.* Lazy funnelsort (small constants) and (2003, SODA) the proof that the **tall-cache assumption is necessary** for cache-oblivious sorting.
- **Arge, L., Ferragina, P., Grossi, R., & Vitter, J. S. (1997). "On Sorting Strings in External Memory."** *STOC.* The I/O complexity of external string sorting and the distinguishing-prefix accounting.
- **Vitter, J. S. (2001/2008). "External Memory Algorithms and Data Structures: Dealing with Massive Data."** *ACM Computing Surveys* / monograph. The definitive survey, including distribution vs merge sort and the parallel-disk results.
- **Dementiev, R., Kettner, L., & Sanders, P. (2008). "STXXL: Standard Template Library for XXL Data Sets."** *Software: Practice & Experience.* Randomized-cycling parallel-disk sorting as actually engineered.
- **Knuth, D. E. *The Art of Computer Programming, Vol. 3: Sorting and Searching.*** §5.4. Replacement selection, the loser/tournament tree, and the snowplow `2M` analysis.

---

## Key Takeaways

1. **Distribution sort is the exact dual of merge sort and equally optimal.** Partition into `S = Θ(√(M/B))` buckets by sampled splitters and recurse; the `√` makes the level count `2 log_{M/B}(N/B)`, twice merge sort's passes, but each level is one scan, so the product is the same `Θ((N/B) log_{M/B}(N/B))` (Aggarwal–Vitter 1988). The `log_{√x} = 2 log_x` cancellation is the heart of the duality.
2. **Merge sort wins single-machine, distribution sort wins distributed.** Merge sort's writes are sequential and its pass cost is data-independent; distribution sort scatters writes but has *no global merge bottleneck*, so its disjoint buckets parallelize perfectly. The MapReduce/Spark **shuffle is distribution sort** — sample-sort partition, network transfer, local merge.
3. **Funnelsort hits the bound obliviously.** Lazy funnelsort (Brodal–Fagerberg 2002) sorts in `Θ((N/B) log_{M/B}(N/B))` with no `M, B` in the code via a vEB-laid-out `k`-merger, optimal at every hierarchy level at once — requiring the **tall-cache assumption `M = Ω(B²)`**, which they proved *necessary*.
4. **The lower bound `Ω((N/B) log_{M/B}(N/B))` makes all three optimal.** The permutation-counting argument (each read multiplies distinguishable orderings by `2^{O(B log(M/B))}`) forces the bound; merge, distribution, and funnelsort all meet it, so the choice among them is constants, write patterns, and parallelism — never asymptotics.
5. **Parallel external sorting's hardness is load balancing, not sorting.** The Parallel Disk Model (Vitter–Shriver 1994) gives `Θ((N/DB) log_{M/B}(N/B))`, but naïve striping wastes the log factor; **Greed Sort** and **Balance Sort** (Nodine–Vitter) are the deterministic optima and randomized cycling is the practical workhorse that keeps all `D` disks busy.
6. **Replacement selection yields expected-`2M` runs (the snowplow) and is adaptive.** Worth it for near-sorted input (giant runs, fewer/zero merge passes) and variable-length records; marginal on random fixed-size data, where a large-`M` cache-friendly chunk-sort is simpler and faster.
7. **Don't sort what you can select, normalize, or stabilize cheaply.** Top-K / `k`-th element are `Θ(N/B)` selection problems, not sorts; string/variable-length sorting reduces to the clean model via **key normalization** and LCP-aware prefixes; **stability** is a free position-suffix key; heavy duplicates need 3-way partitioning to protect distribution sort.

---

> **See also:** [`./middle.md`](./middle.md) for external merge sort, replacement selection, and the loser tree · [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) for the permutation-counting sorting lower bound and the Parallel Disk Model · [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md) for funnelsort, the `k`-merger, and the tall-cache assumption · [`../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/senior.md`](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/senior.md) for the lower-bound-is-a-model discipline
