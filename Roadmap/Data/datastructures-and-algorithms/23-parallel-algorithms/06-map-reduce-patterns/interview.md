# MapReduce Patterns — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Combiners & Aggregation](#combiners--aggregation)
3. [Joins & Design Patterns](#joins--design-patterns)
4. [The Shuffle & Skew](#the-shuffle--skew)
5. [Theory & Spark](#theory--spark)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: "Explain MapReduce with word count." *(Easy)*

**Answer**: MapReduce is a three-phase skeleton — **map → shuffle → reduce**:

- **`map(k, v) → [(k2, v2)]`** runs in parallel over input splits. For word count, each map reads a document and emits `(word, 1)` for every word.
- **Shuffle** — the framework **groups all emitted pairs by key `k2`**, so every `(word, 1)` for the same word lands at the same reducer as `(word, [1, 1, 1, …])`. This is a global, all-to-all regroup.
- **`reduce(k2, [v2]) → [(k3, v3)]`** runs in parallel over keys. For word count it sums the list: `(word, count)`.

```
"the cat sat" ─map→ (the,1)(cat,1)(sat,1)
"the dog"     ─map→ (the,1)(dog,1)
                    ── shuffle (group by word) ──
        the→[1,1]  cat→[1]  sat→[1]  dog→[1]
                    ── reduce (sum) ──
        the→2  cat→1  sat→1  dog→1
```

The **map** and **reduce** are *your* code; everything else is the framework.

### Q2: What does the framework do for you? *(Easy)*

**Answer**: The whole point is that you write two pure functions and the runtime handles the hard distributed-systems plumbing:

- **Parallelism & scheduling** — splits the input, launches mappers/reducers across the cluster, places tasks near their data (**data locality**).
- **The shuffle** — partitioning, sorting, and the all-to-all network transfer that groups values by key (the expensive part, see [Q9](#q9-why-is-the-shuffle-the-bottleneck-medium)).
- **Fault tolerance** — a failed task is simply **re-executed** on another node (map/reduce are deterministic and side-effect-free, so re-running is safe); stragglers get **speculative** duplicate execution.

You give up control over *how* it runs in exchange for not writing any of that. The constraint that makes it work: map and reduce must be **deterministic and side-effect-free**, so any task can be retried anywhere.

---

## Combiners & Aggregation

### Q3: What is a combiner and why does it help? *(Medium)*

**Answer**: A **combiner** is a **map-side mini-reduce**: it pre-aggregates a mapper's output *before* it crosses the network. In word count, instead of emitting `(the,1)` a thousand times, a mapper that saw "the" 1000 times emits `(the,1000)`.

**Why it helps**: it cuts **shuffle traffic** — the dominant cost. Shrinking the data each mapper ships reduces network bytes, reducer-side sorting, and skew. It is a pure optimization: correct output is identical with or without it, only faster.

**Critical caveat**: the combiner is run **opportunistically** — zero, one, or many times, on partial subsets, at the framework's discretion. Your logic must be correct for *any* of those, which leads straight to [Q4](#q4-what-must-be-true-of-reduce-for-a-combiner-to-be-correct-medium).

### Q4: What must be true of `reduce` for a combiner to be correct? *(Medium)*

**Answer**: The aggregation must be **associative and commutative**. Because the combiner re-groups and re-orders values arbitrarily before the reducer ever sees them:

- **Associative** — `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)`: regrouping must not change the result, since combining happens in unpredictable batches.
- **Commutative** — `a ⊕ b = b ⊕ a`: reordering must not change the result, since the framework gives no ordering guarantee within a group.

`sum`, `count`, `min`, `max` qualify — the combiner is just the reducer itself. This is the same **monoid** requirement as parallel reduce: see [../04-parallel-reduce-and-map/interview.md](../04-parallel-reduce-and-map/interview.md).

### Q5: Why can't average use a plain combiner? *(Medium)*

**Answer**: Because **average is not associative**: `avg(avg(a, b), c) ≠ avg(a, b, c)`. If a combiner partially averages a mapper's values and the reducer averages those partial averages, you get the wrong number — averaging averages double-counts unevenly.

**The fix — carry the algebra that *is* associative.** Emit and combine `(sum, count)` pairs instead of raw values:

```
combiner/reducer: (s1,c1) ⊕ (s2,c2) = (s1+s2, c1+c2)   // associative + commutative
final reduce:     mean = total_sum / total_count        // divide only at the end
```

This is the general trick: to make a **non-associative** aggregate combinable, find an associative **intermediate state** (here `(sum, count)`) and project to the answer only at the final step. Variance (carry `(sum, sum², count)`) and "top-K" (carry a partial heap) work the same way.

---

## Joins & Design Patterns

### Q6: Reduce-side vs map-side (broadcast) join — when do you use each? *(Hard)*

**Answer**: Two ways to join datasets `R` and `S` on a key:

- **Reduce-side (repartition) join** — map both `R` and `S`, emitting the **join key** as `k2` (tag each value with its source). The shuffle co-locates matching rows at the same reducer, which emits the cross-product per key. **Cost: shuffle *both* datasets** — fully general (works for any two large tables) but pays the full shuffle on both sides.
- **Map-side / broadcast join** — when **one side is small enough to fit in memory**, ship a full copy of the small table to *every* mapper. Each mapper joins its split of the large table against the in-memory copy locally. **Cost: replicate the small table; shuffle *neither***. No shuffle of the big table at all.

**Rule**: if one side fits in memory → **broadcast join** (replicate the small one, avoid the shuffle entirely). If both are large → **reduce-side join** (you must shuffle both). Picking broadcast when you can is one of the biggest shuffle savings available — see [Q10](#q10-how-do-you-reduce-shuffle-cost-medium).

### Q7: Name the standard MapReduce design patterns. *(Medium)*

**Answer**: A small vocabulary covers most jobs:

- **Summarization** — group-by aggregations (count/sum/min/max/average). Combiner-friendly; word count is the archetype.
- **Filtering / sampling** — map emits only records passing a predicate; often **map-only** (no reduce phase needed).
- **Top-K** — each mapper keeps a local top-K (a combiner with a bounded heap), reducer merges the per-mapper heaps. Avoids shipping everything.
- **Inverted index** — map emits `(term, docID)`; reduce gathers the **posting list** per term. The foundation of search engines.
- **Join** — reduce-side vs broadcast ([Q6](#q6-reduce-side-vs-map-side-broadcast-join--when-do-you-use-each-hard)).
- **Secondary sort** — to get reduce values arriving **sorted**, fold the sort field into a **composite key** and partition on the natural key only, so the shuffle's sort does the work for free.

The meta-point: MapReduce is a **skeleton**; these patterns are how you express real computation by choosing *what map emits as the key*.

---

## The Shuffle & Skew

### Q9: Why is the shuffle the bottleneck? *(Medium)*

**Answer**: The shuffle is a **full distributed sort plus an all-to-all network transfer**. Grouping by key means every reducer must receive every value for its keys from every mapper, so:

- **Network** — it is the only **all-to-all** phase; `M` mappers each send to `R` reducers, and intermediate data crosses the wire (often the largest data movement in the job).
- **Sort** — grouping by key requires sorting the intermediate data on both map and reduce sides (a distributed merge sort, see [../03-parallel-sorting-and-merging/interview.md](../03-parallel-sorting-and-merging/interview.md)).
- **Disk** — classic Hadoop **spills intermediate output to local disk** and re-reads it, adding I/O on top of network.

Map and reduce are embarrassingly parallel and scale linearly; the shuffle is the synchronization barrier where the cluster's network and disk become the wall. Every serious optimization targets the shuffle.

### Q10: How do you reduce shuffle cost? *(Medium)*

**Answer**: Move less data across the wire:

1. **Combiners / map-side aggregation** — pre-aggregate before shipping ([Q3](#q3-what-is-a-combiner-and-why-does-it-help-medium)). Often the single biggest win.
2. **Prefer `reduceByKey` over `groupByKey`** — `reduceByKey` combines on the map side (it *has* a combiner); `groupByKey` ships **every raw value** to the reducer and then aggregates. Same result, vastly different shuffle ([Q14](#q14-is-groupbykey-fine-medium)).
3. **Broadcast joins** — replicate the small table instead of shuffling both ([Q6](#q6-reduce-side-vs-map-side-broadcast-join--when-do-you-use-each-hard)).
4. **Filter/project early** — drop rows and columns *before* the shuffle so you ship less.
5. **Tune partitioning** — a good partitioner balances reducer load and avoids skew ([Q11](#q11-what-is-data-skew-and-how-do-you-handle-it-hard)).

### Q11: What is data skew, and how do you handle it? *(Hard)*

**Answer**: **Skew** is when keys are unevenly distributed — a few "hot" keys hold most of the values. After the shuffle, the reducer assigned a hot key gets a giant value list while others idle. That **one straggler reducer** dominates wall-clock; the job is as slow as its most-loaded reducer, and the hot partition may even **OOM**.

**Fixes**:

- **Salting** — append a random suffix to the hot key (`key#0 … key#N`) so its values spread across `N` reducers, then do a **second stage** that strips the salt and combines the `N` partial results. This is **two-stage aggregation**: partial-aggregate the salted keys in parallel, then final-aggregate the de-salted partials. Requires an associative aggregate.
- **Isolate / broadcast the hot keys** — handle the few skewed keys with a separate broadcast join while the rest take the normal path.
- **Better partitioner** — for known skew, a custom partitioner spreads load deliberately.

The partitioner (which key → which reducer, default `hash(key) mod R`) is where skew is born and fixed.

---

## Theory & Spark

### Q12: What does the MRC / MPC model measure? *(Hard)*

**Answer**: **MapReduce-class (MRC)** and **Massively Parallel Computation (MPC)** are theoretical models that abstract a MapReduce/Spark cluster. They measure two resources:

- **Rounds** — the number of map-shuffle-reduce **synchronization rounds**. Each round has a global all-to-all shuffle and barrier, so **rounds are the expensive currency** — the metric you minimize. Good algorithms run in `O(1)` or `O(log n)` rounds.
- **Local memory** — each of the `p` machines holds only `O(n^ε)` data (sublinear, `ε < 1`), so nothing fits on one node — that's what forces the distributed shuffle.

The model captures the real cost: a round is a network barrier, so an algorithm's quality is judged by **round complexity** vs the memory-per-machine budget. This mirrors the [work–span](../04-parallel-reduce-and-map/interview.md) idea but at cluster scale, where the shuffle barrier — not arithmetic — is the cost.

### Q13: Why is MapReduce bad for iterative algorithms, and what fixes it? *(Hard)*

**Answer**: Classic Hadoop MapReduce **materializes every stage to HDFS (disk)**. An iterative algorithm — PageRank, k-means, gradient descent — is a *loop* of MapReduce rounds, and each iteration **reads the entire dataset back from disk and writes it out again**. The data is re-read from disk every round even though it hasn't changed, so disk I/O dominates and 100 iterations means 100 full disk round-trips.

**The fix — keep working data in memory across rounds. This is Spark.** Spark models the job as a **DAG of transformations** on **RDDs/DataFrames** that can be **cached in RAM** and reused across iterations. The dataset is loaded once and stays resident, so each iteration hits memory, not disk — often **10–100× faster** for iterative workloads. Fault tolerance comes from **lineage** (recompute a lost partition from its recorded ancestry) instead of disk checkpoints. Spark also **pipelines** narrow transformations within a stage, shuffling only at stage boundaries — fewer materializations than Hadoop's rigid map-then-reduce.

---

## Gotcha / Trick Questions

### Q14: "Is `groupByKey` fine?" *(Medium)*

**Answer**: **Usually no — prefer `reduceByKey` (or `aggregateByKey`).** Both can compute the same per-key aggregate, but:

- **`groupByKey`** ships **every raw value** across the shuffle, then aggregates on the reduce side. No map-side combiner → maximum network traffic, and the full value list for a key must fit in one reducer's memory → **OOM on skewed keys**.
- **`reduceByKey`** applies the (associative, commutative) reduce **on the map side first** (it *is* a combiner), shuffling only one partial per key per partition.

For an aggregation, `reduceByKey` shuffles dramatically less. Reach for `groupByKey` only when you genuinely need the full grouped collection (and even then, reconsider). "I'd use `reduceByKey` so the combine happens map-side" is the answer the interviewer wants.

### Q15: "MapReduce vs Spark?" *(Medium)*

**Answer**: Same shuffle-based programming model; different **execution engine**:

- **Hadoop MapReduce** — rigid map→shuffle→reduce, **materializes to disk** between every stage. Robust, simple, but slow for anything multi-stage or iterative.
- **Spark** — a **DAG** of transformations over **in-memory** RDDs/DataFrames, with lineage-based fault tolerance and pipelined narrow stages. Caches data across iterations → far faster for **iterative** (ML, graph) and **interactive** workloads.

Crisp framing: *Spark is MapReduce generalized to a cached, in-memory DAG.* It removed the per-stage disk write that crippled iterative jobs ([Q13](#q13-why-is-mapreduce-bad-for-iterative-algorithms-and-what-fixes-it-hard)). The model (map/shuffle/reduce, combiners, partitioners, the shuffle-as-bottleneck) is unchanged — which is why these patterns transfer directly.

### Q16: "Just throw more reducers at a slow job — that fixes it, right?" *(Medium)*

**Answer**: **Not if the problem is skew.** More reducers spreads *distinct keys* across more machines, but a **single hot key still lands on one reducer** — adding reducers leaves it just as overloaded while the new reducers sit idle. The job is bottlenecked on the one fat partition, not on reducer count. The real fixes are **salting / two-stage aggregation** to split the hot key, or a **combiner** to shrink it before the shuffle ([Q11](#q11-what-is-data-skew-and-how-do-you-handle-it-hard)). More parallelism helps *balanced* load; it does nothing for *imbalanced* load.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | The three phases? | map → shuffle → reduce |
| 2 | `map` signature? | `(k, v) → [(k2, v2)]` |
| 3 | `reduce` signature? | `(k2, [v2]) → [(k3, v3)]` |
| 4 | What does shuffle do? | Groups all values by key `k2` (all-to-all) |
| 5 | What does the framework give you? | Parallelism, shuffle, fault tolerance (re-exec) |
| 6 | Why is re-execution safe? | map/reduce are deterministic & side-effect-free |
| 7 | What is a combiner? | Map-side mini-reduce; cuts shuffle traffic |
| 8 | Combiner correctness needs? | **Associative + commutative** aggregate |
| 9 | Why no plain-average combiner? | `avg` isn't associative — carry `(sum, count)` |
| 10 | Partitioner default? | `hash(key) mod R` → which reducer |
| 11 | Reduce-side join cost? | Shuffle **both** datasets |
| 12 | Broadcast join cost? | Replicate the **small** table; shuffle neither |
| 13 | When broadcast join? | One side fits in memory |
| 14 | The bottleneck phase? | **Shuffle** = distributed sort + all-to-all |
| 15 | Cut shuffle by? | Combiners, `reduceByKey`, broadcast, filter early |
| 16 | What is skew? | Hot keys → one overloaded straggler reducer |
| 17 | Skew fix? | **Salting** / two-stage aggregation |
| 18 | MRC/MPC measures? | **Rounds** (expensive) vs memory/machine |
| 19 | Why MR bad for iteration? | Re-reads disk every round |
| 20 | Iteration fix? | **Spark** — in-memory DAG, cache across rounds |
| 21 | `groupByKey` vs `reduceByKey`? | Prefer `reduceByKey` — it combines map-side |
| 22 | Secondary sort trick? | Composite key + partition on natural key |

---

## Common Mistakes

1. **Assuming the combiner always runs (or runs once).** It runs **0, 1, or many** times on partial data — your logic must be correct regardless, which is *why* it needs to be associative + commutative.
2. **Putting `average` (or any non-associative aggregate) in a combiner.** Carry an associative state — `(sum, count)` — and divide only at the end.
3. **Shuffling both tables when one is small.** Use a **broadcast/map-side join** to avoid shuffling the big table entirely.
4. **Reaching for `groupByKey`.** It ships every raw value and OOMs on skew; `reduceByKey`/`aggregateByKey` combine map-side.
5. **Ignoring skew.** A few hot keys make one reducer the whole job's bottleneck; salt them or two-stage the aggregation.
6. **"Add more reducers" as the universal fix.** Useless against a single hot key — that's a skew problem, not a parallelism problem.
7. **Running iterative algorithms on classic Hadoop.** Each round re-reads disk; use Spark's cached in-memory DAG.
8. **Forgetting the shuffle is a sort.** Grouping by key *is* a distributed sort — the cost center of every job.

---

## Tips & Summary

- **Open with the skeleton**: "map emits `(k2, v2)`, the framework **shuffles to group by key**, reduce folds each group — and the framework hands you parallelism, the shuffle, and fault tolerance for free." That one sentence frames every follow-up.
- **Make the combiner = monoid point**: a combiner is a map-side mini-reduce that cuts shuffle traffic, **correct only when the aggregate is associative + commutative**. Average needs `(sum, count)` — the canonical non-associative-fix. Same idea as [parallel reduce](../04-parallel-reduce-and-map/interview.md).
- **Have the join rule cold**: small side fits in memory → **broadcast** (shuffle nothing); both large → **reduce-side** (shuffle both).
- **Name the shuffle as the bottleneck and *why***: it's a **distributed sort + all-to-all + disk spill**. Then list the levers: combiners, `reduceByKey` over `groupByKey`, broadcast joins, filter early.
- **Diagnose skew on sight**: hot keys → one straggler reducer → **salting / two-stage aggregation**. "More reducers won't fix a single hot key" is a senior tell.
- **Close with theory + Spark**: MRC/MPC count **rounds** (the expensive barrier); classic MapReduce re-reads disk every round, so **Spark's in-memory DAG** wins for iterative work. See [./middle.md](./middle.md) for depth.

**Related:** [Parallel Reduce and Map — Interview](../04-parallel-reduce-and-map/interview.md) · [Parallel Sorting & Merging — Interview](../03-parallel-sorting-and-merging/interview.md) · [MapReduce Patterns — Middle](./middle.md)
