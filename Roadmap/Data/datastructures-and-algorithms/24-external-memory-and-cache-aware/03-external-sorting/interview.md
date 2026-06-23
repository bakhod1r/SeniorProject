# External Sorting — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Classic: Sort 1 TB with 8 GB RAM](#the-classic-sort-1-tb-with-8-gb-ram)
3. [Run Formation & Replacement Selection](#run-formation--replacement-selection)
4. [The k-Way Merge](#the-k-way-merge)
5. [Variants & Systems](#variants--systems)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is external sorting and when do you need it? *(Easy)*

**Answer**: **External sorting** sorts a data set whose size `N` **exceeds internal memory** `M` (`N > M`), so it cannot all be held in RAM at once. The dominant cost is therefore not comparisons but **block transfers (I/Os)** between RAM and disk, analyzed in the [I/O model](../01-the-io-model/interview.md) with parameters `N` (size), `M` (memory), `B` (block size).

The workhorse is **external merge sort**: split the data into memory-sized chunks, sort each in RAM (a sorted **run**), then **merge** the runs back together with a streaming multiway merge. Everything is sequential I/O, which is what makes it fast on disk.

### Q2: Walk through external merge sort end to end. *(Medium)*

**Answer**: Two phases.

**1. Run formation.** Read `M` elements at a time into RAM, sort them in memory (free in the I/O model), write the sorted block back to disk as a **run**. This yields `⌈N/M⌉` sorted runs and costs one read + one write over the whole data = `Θ(N/B)` I/Os.

**2. Multiway merge.** Repeatedly merge runs into longer runs. Each pass merges up to `k = M/B − 1` runs at once, reading and writing all the data once = `Θ(N/B)` I/Os, and shrinks the run count by a factor of `k`. Starting from `N/M` runs, the number of merge passes is `⌈log_{M/B}(N/M)⌉`.

**Total** = (I/Os per pass) × (passes) = `Θ((N/B) · log_{M/B}(N/B))` = the **sort bound `sort(N)`**.

### Q3: Why is the total I/O cost Θ((N/B) log_{M/B}(N/B))? *(Medium)*

**Answer**: Every pass — run formation and each merge pass — streams the entire data set in and out exactly once, which is `Θ(N/B)` I/Os (the [scan bound](../01-the-io-model/interview.md)). The question is *how many passes*. Run formation produces `N/M` runs; each merge pass divides the run count by the fan-in `M/B`, so you need `log_{M/B}(N/M)` merge passes to collapse to a single run. Multiplying:

```
sort(N) = Θ( (N/B) · log_{M/B}(N/B) )
```

(`log_{M/B}(N/M)` and `log_{M/B}(N/B)` differ only by a constant additive term, so the asymptotic form uses `N/B`.) This matches the **proven I/O lower bound** for sorting, so external merge sort is **I/O-optimal**.

---

## The Classic: Sort 1 TB with 8 GB RAM

### Q4: How do you sort 1 TB of data with 8 GB of RAM? Count the passes. *(Hard — the marquee question)*

**Answer**: **External merge sort.** Take `N` ≈ 1 TB, `M` ≈ 8 GB of usable memory, and a block/buffer size such that the fan-in `M/B` is realistically ~1000 (a few-MB I/O buffer per run).

- **Run formation:** Read 8 GB, sort in RAM, write it back. `1 TB / 8 GB = 128` initial sorted runs. Cost: one read + one write pass.
- **Merge:** One pass merges up to `M/B − 1 ≈ 1000` runs. We have only 128 runs, so **a single merge pass** finishes the job (`128 < 1000`).

So the entire sort is **2 passes** over the data ≈ 2 reads + 2 writes. Plugging in: `⌈log_{M/B}(N/M)⌉ = ⌈log_{1000}(128)⌉ = 1` merge pass, confirming the count. **Headline: a terabyte sorts in 2–3 passes** because the base of the logarithm, `M/B`, is huge.

### Q5: What if RAM were much smaller — say only enough for fan-in 10? *(Medium)*

**Answer**: The number of passes is governed by the *base* of the logarithm, `M/B`. With `M/B = 10` and 128 runs, you need `⌈log_{10}(128)⌉ = 3` merge passes instead of 1 — so 4 passes total. Shrinking memory hurts you only **logarithmically**, which is why external sort degrades gracefully. The fan-in determines everything: more RAM (or larger blocks) means a higher fan-in, a larger log base, and fewer passes.

---

## Run Formation & Replacement Selection

### Q6: Why merge sort for disk and not quicksort? *(Medium)*

**Answer**: **Access pattern.** External merge sort is **all sequential I/O**: run formation streams blocks in and out, and merging reads each run sequentially through its input buffer. Sequential I/O on disk is ~100×–1000× cheaper than random I/O.

A disk-resident **quicksort** partitions around a pivot, scattering elements to *both ends* of a huge on-disk array — that is **random I/O** at every partition level, `Θ((N/B) log₂(N/B))` random accesses in the worst case. It also has the wrong logarithm base (`log₂` vs `log_{M/B}`), so it needs far more passes. Merge sort wins on both counts: sequential access and a fat log base.

### Q7: What is replacement selection and why does it give runs of average length 2M? *(Hard)*

**Answer**: **Replacement selection** is a smarter run-formation method that produces **longer initial runs** (fewer runs ⇒ possibly fewer merge passes). Keep a heap (priority queue) of `M` records in memory. Repeatedly:

1. Output the smallest record in the heap that is `≥` the last value written to the current run.
2. Replace it with the next input record. If the new record is **smaller** than the last output (it can't extend the current run), mark it as belonging to the *next* run and let it sink.
3. When all `M` records belong to the next run, close the current run and start a new one.

**Why average length 2M — the snowplow argument.** Picture a snowplow circling a loop at constant speed while snow falls uniformly. In steady state, snow lies on the loop in a wedge: deep ahead of the plow, none just behind it. The plow clears `2M` worth of snow per lap because at any instant there is, on average, `M` of snow on the loop plus the `M` that falls during the lap it takes to come around. Mapping back: the heap is the loop, incoming records are falling snow, and a run is one lap — so each run is on average **2M** records long for random input.

The catch: replacement selection produces runs via a heap and **random-ish output** of variable-length runs, and modern systems often prefer simple `M`-sized in-RAM quicksort runs because sequential bulk writes and predictable buffering matter more than halving the run count when fan-in is already in the thousands.

---

## The k-Way Merge

### Q8: Why is the merge fan-in M/B − 1 and not M? *(Medium)*

**Answer**: To merge `k` runs simultaneously you must keep **one input block resident per run** so you can stream each run sequentially, *plus* **one output block** to accumulate the merged result before writing it back. That's `k + 1` blocks of buffer, all of which must fit in memory:

```
(k + 1) · B ≤ M   ⟹   k ≤ M/B − 1
```

The `−1` is the **output buffer**. So the fan-in is `M/B − 1`, commonly written `Θ(M/B)`. Writing the bound with base `M` (`log_M`) instead of `M/B` is the single most common error — it ignores that each open run needs a full block of buffer.

### Q9: How do you merge k runs efficiently? *(Medium)*

**Answer**: At each step you must find the **minimum** across the `k` current run heads. A linear scan is `O(k)` per element — too slow for large fan-in. Instead use a **tournament tree**:

- A **loser tree** (a.k.a. tree of losers, Knuth's variant) or a **min-heap** over the `k` run heads.
- Each output step: emit the winner (global minimum), pull the next element from that run, and **re-play just one path** from that leaf to the root — `O(log k)` work, not `O(k)`.

Total comparison work is `O(N log k)`, and since `k ≤ M/B`, the per-element cost is small. The **loser tree** is preferred over a binary heap in practice: after the winner leaves, only one new element enters at a known leaf, so exactly one root-to-leaf path of `⌈log₂ k⌉` comparisons is replayed — fewer comparisons and better branch behavior than sift-down in a heap.

### Q10: What is a loser tree and why prefer it to a heap? *(Hard)*

**Answer**: A **loser tree** is a complete binary tournament over the `k` run heads. Each internal node stores the **loser** of the match played there (the larger key); the overall **winner** (minimum) sits at the top in a dedicated slot. After emitting the winner and feeding its replacement into that leaf, you replay matches **along the single path to the root**: at each node compare the incoming candidate against the stored loser, store the new loser, carry the winner upward. Exactly `⌈log₂ k⌉` comparisons, no more.

Versus a binary min-heap: a heap's sift-down does up to `2` comparisons per level (pick smaller child, then compare) and may follow a different path each time. The loser tree does `1` comparison per level along a fixed path, so it's roughly **2× fewer comparisons** and more predictable — which is why classic external-sort implementations and DB merge operators use it.

---

## Variants & Systems

### Q11: What is distribution sort and how is it the dual of merge sort? *(Hard)*

**Answer**: **Distribution sort** (external bucket/quicksort) is the **dual** of merge sort. Instead of *merging* sorted runs at the end, it *partitions* up front:

1. Pick `≈ M/B` **splitters** (pivots) that divide the key range into `M/B` buckets of roughly equal size.
2. Stream the data once, routing each element to its bucket's output block (one resident block per bucket) → `Θ(N/B)` I/Os per pass.
3. Recurse on each bucket; after `log_{M/B}(N/M)` levels each bucket fits in memory and is sorted in RAM.

Same `Θ((N/B) log_{M/B}(N/B))` cost as merge sort, with the recursion tree **inverted**: merge sort splits trivially and does work on the way *up* (merging); distribution sort does work on the way *down* (partitioning) and combines trivially (concatenation). The challenge is choosing balanced splitters — usually by sampling — to keep buckets even.

### Q12: How do you get the top-N items without a full sort? *(Easy)*

**Answer**: Use a **bounded min-heap of size N**. Stream the data once; for each element, if the heap has fewer than `N` items push it, else if the element beats the heap's minimum, pop-and-push. At the end the heap holds the top `N`. Cost is **one scan** (`Θ(N_total/B)` I/Os) and `O(N_total · log N)` CPU — far cheaper than the `log_{M/B}` passes of a full external sort. This is the standard implementation of `ORDER BY ... LIMIT N` (top-`k`) in databases and of partial-sort operators.

### Q13: Where does external sort show up in real systems? *(Medium)*

**Answer**: Everywhere data outgrows RAM:

- **Databases**: `ORDER BY`, `GROUP BY`, `DISTINCT`, and especially **sort-merge join** all use external merge sort when the input exceeds the sort buffer / `work_mem`. Top-`N` queries (`LIMIT`) use the bounded-heap trick.
- **Spark / MapReduce shuffle**: the shuffle phase sorts/partitions map output by key so reducers receive grouped data — a distributed external sort, spilling sorted runs to disk and merging them.
- **GNU `sort`**: classic external merge sort — splits input into memory-sized temp files (`-S` controls `M`), sorts each, and merges (`--batch-size` controls the merge fan-in `M/B`).
- **Log/analytics processing, building inverted indexes, deduplication** at scale.

See [B-tree I/O analysis](../04-b-tree-io-analysis/interview.md) for the indexed-access counterpart to sorted scans.

---

## Gotcha / Trick Questions

### Q14: "Does adding more RAM dramatically reduce the number of passes?" *(Medium)*

**Answer**: **Yes — but through the fan-in, not linearly.** More RAM (or larger blocks) increases the fan-in `M/B`, which is the **base** of the logarithm in the pass count `⌈log_{M/B}(N/M)⌉`. Because the base grows, passes drop fast: with `M/B` in the thousands you collapse hundreds of runs in a **single** merge pass, so almost any realistic sort finishes in **1–2 merge passes**. Doubling RAM rarely matters once you're already at 2 passes, but going from a tiny fan-in (10) to a large one (1000) takes you from ~3 passes to 1. The lever is the log base, and that's why the practical answer is nearly always "2–3 passes."

### Q15: "Is external merge sort I/O-optimal?" *(Hard)*

**Answer**: **Yes.** Its cost `Θ((N/B) log_{M/B}(N/B))` exactly matches the **I/O-model lower bound** for sorting (and for permuting in the relevant regime), proven by Aggarwal & Vitter via a counting/permutation argument. No external sorting algorithm can do asymptotically fewer block transfers. Distribution sort achieves the same bound from the dual direction. So the only room to improve is in **constants** — bigger blocks, async prefetch/double-buffering, compression, fewer passes by maximizing fan-in — not in the asymptotics.

### Q16: "Just use a B-tree / quicksort on disk — why bother with merge sort?" *(Medium)*

**Answer**: Both lose on **I/O access pattern**. Inserting `N` items one-by-one into a disk **B-tree** costs `Θ(N · log_B N)` I/Os of mostly **random** writes — orders of magnitude worse than `sort(N)`'s sequential streaming. A disk **quicksort** scatters elements randomly during partitioning and uses the worse `log₂` base. External merge sort is optimal precisely because it converts the whole problem into **sequential** scans and merges with a fat `log_{M/B}` base. Sorting then bulk-loading a B-tree is the standard fast path, *not* incremental insertion.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | When do you need external sort? | `N > M` — data exceeds RAM |
| 2 | Two phases? | Run formation + multiway merge |
| 3 | Number of initial runs? | `⌈N/M⌉` |
| 4 | Merge fan-in? | `M/B − 1` (the `−1` is the output buffer) |
| 5 | Number of merge passes? | `⌈log_{M/B}(N/M)⌉` |
| 6 | Total I/O cost? | `Θ((N/B) log_{M/B}(N/B))` = `sort(N)` |
| 7 | Why merge, not quicksort, on disk? | Sequential I/O vs random I/O |
| 8 | Passes to sort 1 TB with 8 GB? | ~2–3 (`log_{M/B}` is tiny) |
| 9 | Replacement selection average run length? | `2M` (snowplow argument) |
| 10 | Data structure for k-way merge? | Loser/tournament tree, `O(log k)`/element |
| 11 | Loser tree vs heap? | ~2× fewer comparisons, fixed path |
| 12 | Dual of merge sort? | Distribution (bucket) sort |
| 13 | Top-N without full sort? | Bounded min-heap of size `N`, one scan |
| 14 | Is external merge sort I/O-optimal? | Yes — matches the sort lower bound |
| 15 | Real systems using it? | DB sort/sort-merge join, Spark shuffle, GNU `sort` |

---

## Common Mistakes

1. **Writing the fan-in as `M` (so `log_M`)** instead of `M/B − 1` (`log_{M/B}`). Each open run needs a full block buffer, plus one output block.
2. **Forgetting the output buffer** — the `−1` in `M/B − 1`. You can hold `M/B` blocks total, one of which must be the output.
3. **Using quicksort intuition on disk.** Partitioning is random I/O; merge sort's sequential streaming is why it wins, not the comparison count.
4. **Misstating replacement selection's run length** as `M`. It's **`2M`** on average (snowplow), and only for roughly random input.
5. **Linear-scanning the run heads in the merge.** That's `O(k)` per element; use a loser tree / heap for `O(log k)`.
6. **Claiming more RAM helps linearly.** It raises the **log base** `M/B`; the effect on passes is logarithmic, and you're usually already at 1–2 passes.
7. **Thinking you can beat `sort(N)`.** It's the proven I/O lower bound — external merge sort is optimal; only constants are negotiable.

---

## Tips & Summary

- **Lead with the cost model**: "Data exceeds RAM, so we count *block transfers*, and we keep all access **sequential**." That framing justifies every design choice that follows.
- **Memorize the structure**: `⌈N/M⌉` runs from run formation, fan-in `M/B − 1`, `⌈log_{M/B}(N/M)⌉` merge passes, total `Θ((N/B) log_{M/B}(N/B))` = `sort(N)`.
- **Nail the 1 TB / 8 GB answer**: 128 runs, single merge pass (fan-in ~1000), **2 passes total** — and explain *why* via the fat log base.
- **Know the two named tricks**: **replacement selection** (runs of `2M`, snowplow argument) and the **loser tree** (`O(log k)` k-way merge, fewer comparisons than a heap).
- **State the duality**: distribution sort partitions first and is the mirror image of merge sort; both hit the same optimal bound.
- **Close with optimality**: external merge sort matches the I/O sorting lower bound, so it's I/O-optimal — and it's exactly what databases (sort-merge join), Spark/MapReduce shuffle, and GNU `sort` actually run.

**Related:** [The I/O Model — Interview](../01-the-io-model/interview.md) · [B-Tree I/O Analysis — Interview](../04-b-tree-io-analysis/interview.md) · [External Sorting — Middle](./middle.md)
