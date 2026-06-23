# MapReduce Patterns — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Lineage: Hadoop → Spark → Flink](#the-lineage-hadoop--spark--flink)
   - [Hadoop MapReduce: Map/Shuffle/Reduce on Disk](#hadoop-mapreduce-mapshufflereduce-on-disk)
   - [Spark: RDDs, the DAG of Stages, In-Memory Caching](#spark-rdds-the-dag-of-stages-in-memory-caching)
   - [Flink: Streaming-First Dataflow](#flink-streaming-first-dataflow)
   - [When You Still See Each](#when-you-still-see-each)
3. [The Patterns As You Actually Run Them](#the-patterns-as-you-actually-run-them)
   - [ETL, Group-By Aggregation, and the Combiner](#etl-group-by-aggregation-and-the-combiner)
   - [Joins: Broadcast vs Shuffle](#joins-broadcast-vs-shuffle)
   - [Sessionization, Top-N, Inverted Index, Dedup](#sessionization-top-n-inverted-index-dedup)
4. [The Shuffle Is the Bottleneck](#the-shuffle-is-the-bottleneck)
5. [Data Skew: The #1 Production Problem](#data-skew-the-1-production-problem)
6. [Fault Tolerance and Execution](#fault-tolerance-and-execution)
7. [Batch vs SQL vs Streaming vs Graph/ML](#batch-vs-sql-vs-streaming-vs-graphml)
8. [Worked End-to-End: Combiner, Broadcast Join, and a Skew Fix](#worked-end-to-end-combiner-broadcast-join-and-a-skew-fix)
9. [Decision Framework](#decision-framework)
10. [Research and System Pointers](#research-and-system-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) settles the theory: MapReduce is a *model of computation* whose cost is **round complexity** under sublinear per-machine memory (the MRC / MPC models), `NC` simulates into `O(polylog)` rounds, low-round design is filtering/coresets, connectivity sits between `O(log log n)` (round compression) and a conjectured `Ω(log n)` lower bound, and the shuffle is a distributed sort whose two costs are total communication and load. That is the right mental model and this tier assumes it.

This tier answers the operational question: **when you actually write a Spark job — or maintain a Hadoop one, or argue for a SQL or Flink pipeline instead — what code runs, how do you choose, and what is load-bearing in production?** The honest thesis has four parts. First, the **lineage matters**: Hadoop MapReduce (map/shuffle/reduce spilling to HDFS) is the disk-bound ancestor; Spark (RDDs/DataFrames, a DAG of stages, in-memory caching) is `10–100×` faster for iterative and interactive work because it does *not* re-materialize to disk every round; Flink is the streaming-first dataflow engine; and SQL engines (Spark SQL, Trino, Hive) sit on top and let an *optimizer* pick the joins and aggregations you would otherwise hand-write. Second, the **patterns are concrete** — ETL, group-by with a combiner, broadcast vs shuffle join, sessionization, top-N, inverted index, dedup — and the professional skill is knowing the *one* variant of each that does not move the whole dataset (`reduceByKey` not `groupByKey`; broadcast not shuffle when one side is small). Third, **the shuffle is the bottleneck** — it is a distributed sort plus an all-to-all network transfer ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)), so every optimization is a way to move fewer bytes across it. Fourth, **data skew — a few hot keys overloading one reducer/partition — is the single most common production failure**, and you must recognize it and fix it (salting, two-stage aggregation, skew-join handling, adaptive execution).

The throughline of every section is the senior punchline made physical: **the binding cost is data movement across the shuffle, not the arithmetic in your map and reduce functions — so you win by cutting shuffle bytes (combiners, broadcast joins, partition pruning) and by keeping no single reducer overloaded (skew handling).**

---

## The Lineage: Hadoop → Spark → Flink

The "MapReduce pattern" you run today is rarely Google's 2004 framework verbatim — it is one of three engines descended from it. Knowing which one you are on, and why, is the difference between a 20-minute job and a 6-hour one.

### Hadoop MapReduce: Map/Shuffle/Reduce on Disk

The original (Dean–Ghemawat 2004; Apache Hadoop) is a strict three-phase pipeline over HDFS:

```text
HADOOP MAPREDUCE (one job):
  MAP:     each mapper reads an HDFS input split, emits (key, value) pairs.
           Output is partitioned (by key hash) and SORTED, then SPILLED to local disk.
  SHUFFLE: each reducer FETCHES its partition from every mapper's local disk
           over the network, then MERGES the sorted runs.  (all-to-all + sort)
  REDUCE:  reducer sees keys in sorted order; folds each key-group;
           writes output back to HDFS (replicated ×3).
```

Three facts define its performance character. (1) **It materializes to disk between every stage** — map output spills to local disk, reduce output writes replicated to HDFS — so a job is bounded by disk and network I/O, not CPU. (2) **It is one map and one reduce per job**; a multi-step pipeline (or an iterative algorithm) is a *chain of jobs*, each re-reading the previous job's HDFS output. (3) **The sort between map and reduce is mandatory** — "the reducer sees keys in sorted order" is the contract — which is why a Hadoop job *is* a distributed external sort with a fold bolted on ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)). This disk-everywhere design makes Hadoop robust at huge scale on cheap disks and fatal for iteration (50 iterations of PageRank = 50 jobs, each re-reading the whole graph from replicated disk).

### Spark: RDDs, the DAG of Stages, In-Memory Caching

Apache Spark (Zaharia et al., 2012) keeps the map/shuffle/reduce shape but changes *what persists between steps*:

- **RDD → DataFrame/Dataset.** The **Resilient Distributed Dataset** is a partitioned, immutable, in-memory collection built by a chain of transformations. Modern Spark code uses the higher-level **DataFrame/Dataset** API (a typed/relational table over RDDs) so the **Catalyst** optimizer can plan it like SQL; RDDs are the lower-level escape hatch. The headline win: an RDD/DataFrame can be `cache()`d in cluster memory and reused across steps, so iterative and interactive workloads do not re-read disk — the `10–100×` speedup over Hadoop on those workloads, *with the same number of shuffle rounds*.
- **The DAG of stages.** Spark builds a **DAG of transformations** and splits it into **stages at shuffle boundaries**. Transformations are either **narrow** — each output partition depends on *one* input partition (`map`, `filter`, `mapPartitions`, a partitioned `join`); these are pipelined within a stage with no network — or **wide** — each output partition depends on *many* input partitions (`reduceByKey`, `groupByKey`, a shuffle `join`, `repartition`, `distinct`); a wide transformation **forces a shuffle and ends a stage**. A stage is a chain of narrow transformations executed without crossing the network; the shuffle between stages is the expensive part. Reading a Spark job's stage count and shuffle-read/write bytes in the UI is the core diagnostic skill.
- **Lazy evaluation + actions.** Transformations are lazy (they build the DAG); an **action** (`count`, `collect`, `write`) triggers execution. This lets Catalyst optimize the whole DAG before any data moves — pushing filters down, pruning columns, choosing join strategies.

### Flink: Streaming-First Dataflow

Apache Flink (Carbone et al., 2015) inverts the model: it is **streaming-first**, treating batch as a bounded stream. Records flow through a pipelined operator dataflow *without* a mandatory per-stage barrier, with native windowing, true event-time processing (watermarks), and stateful operators checkpointed for exactly-once semantics. Where Spark Structured Streaming runs streaming as a series of small batches (micro-batch; "continuous" mode exists but micro-batch is the default), Flink is a genuine record-at-a-time engine. For unbounded, low-latency, stateful stream processing (sessionization on a live clickstream, fraud scoring, real-time aggregation) Flink is the reference; for large bounded batch, Spark and the SQL engines dominate.

### When You Still See Each

| Engine | You still see it for | Why |
|---|---|---|
| **Raw Hadoop MapReduce** | legacy ETL, huge stable batch jobs, `distcp`, jobs where disk-robustness > speed | predates Spark in many shops; disk-everywhere survives node failure cheaply |
| **Spark (DataFrame/SQL)** | the default for batch + interactive analytics, ML feature pipelines, iterative graph/ML | in-memory caching, Catalyst optimizer, one engine for SQL + code + ML + streaming |
| **SQL engines** (Spark SQL, Trino/Presto, Hive, BigQuery) | analyst-facing queries, ad-hoc joins/aggregations, anything expressible declaratively | the optimizer picks join/aggregation strategy; you write *what*, not *how* |
| **Flink** | low-latency stateful streaming, event-time windowing, exactly-once stream ETL | true streaming, native windows/watermarks, fine-grained state |

The professional default in 2020s data engineering: **express it in SQL (Spark SQL / Trino) and let the optimizer plan it; drop to the Spark DataFrame API when you need control the optimizer can't give; drop to RDDs only for genuinely custom partitioning/combining; reach for Flink when latency and streaming state are the requirement; maintain raw Hadoop only where it already runs.**

---

## The Patterns As You Actually Run Them

The senior pattern catalogue, written as the code you run and the one trap each pattern hides.

### ETL, Group-By Aggregation, and the Combiner

**ETL** is the bread-and-butter map-reduce: *map* parses, cleans, validates, and projects each record (a narrow, shuffle-free transformation); *reduce* aggregates. The map side is embarrassingly parallel and cheap; the cost is whatever shuffle the aggregation forces.

**Group-by aggregation** is where the single most important production rule lives:

```text
GROUP BY user_id, SUM(amount):

  WRONG  — groupByKey():   shuffles EVERY value to the reducer, then sums there.
           Network volume ≈ the whole dataset; the reducer can OOM on a hot key.

  RIGHT  — reduceByKey(_ + _) / aggregateByKey:  applies a COMBINER (map-side
           partial sum) BEFORE the shuffle, so each partition sends ONE partial
           per key.  Network volume ≈ (#partitions × #distinct keys), not #rows.
```

`reduceByKey` (and `aggregateByKey`, which lets the combiner's accumulator type differ from the input — e.g. carrying `(sum, count)` for an average) runs a **map-side combine**: a local pre-reduction in each partition before anything crosses the network. This is correct only because the operator is an **associative-and-commutative monoid** — combiner partials arrive across the network in nondeterministic order, exactly the requirement spelled out in [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md). `groupByKey` skips the combiner and ships every value; on a hot key it ships *all* of that key's values to one reducer and OOMs. **The rule: never `groupByKey` to then aggregate — use `reduceByKey`/`aggregateByKey`.** (DataFrame `groupBy().agg(sum)` does the combine automatically; this is one reason to prefer the DataFrame API.) For averages, carry the `(sum, count)` monoid and divide at the end — `avg` is not a monoid, the same monoid-spotting discipline as [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md).

### Joins: Broadcast vs Shuffle

The join strategy choice is the highest-leverage decision in a data pipeline, and it turns on *the size of the smaller table*:

| Strategy | When | Mechanism | Shuffle |
|---|---|---|---|
| **Broadcast (map-side) join** | one side is small (fits in executor memory, ~tens–hundreds of MB) | replicate the small table to *every* node; each node joins its big-table partition locally | **none** for the big table — only a one-time broadcast |
| **Shuffle (sort-merge) join** | both sides are big | partition *both* tables by the join key, so matching keys land on the same reducer; sort each partition; merge | **both** tables shuffled — the expensive case |

A **broadcast join** (a.k.a. map-side join) takes the small table, ships one copy to every executor (a one-time `O(small)` broadcast), and then every big-table partition is joined locally with no shuffle of the big table at all. A **shuffle / sort-merge join** must partition *both* tables by the join key so that all rows with a given key meet on one reducer — which is a full distributed sort of both inputs, exactly the partition-then-merge of [`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md). The win from broadcasting is enormous: shuffling a 1 TB fact table is hours of network; broadcasting a 50 MB dimension table is seconds. Spark auto-selects a broadcast join when it *knows* a side is below `spark.sql.autoBroadcastJoinThreshold` (default 10 MB) — but it only knows that if statistics are accurate, which is why **`broadcast(df)` hints and good table stats are routine production tuning.** The honest failure mode: broadcast a table that is *not* actually small and you OOM every executor. Sort-merge join is the safe default when both sides are large or sizes are unknown.

### Sessionization, Top-N, Inverted Index, Dedup

- **Sessionization / windowing.** Group events by user, sort by timestamp, and split into sessions where the inter-event gap exceeds a threshold (e.g. 30 min). In batch Spark: `Window.partitionBy(user).orderBy(ts)` with a `lag` to detect gaps and a running sum to assign session IDs. In streaming (Flink/Structured Streaming): a native **session window** with a gap timeout. The shuffle is the `partitionBy(user)` — and a power-user with millions of events is the skew case (§5).
- **Top-N per group.** "Top 10 products per category." The cheap version does *not* sort every group globally: do a **partial top-N per partition** (a bounded heap of size N — a combiner that keeps only N candidates), shuffle only those candidates, then a final top-N per group. `groupByKey().sortBy` materializes whole groups and is the anti-pattern; `Window.partitionBy(cat).orderBy(desc(metric))` with `row_number() <= N`, or `reduceByKey` over a bounded heap, is the production form.
- **Inverted index / building search indexes.** The canonical MapReduce job (the one Google built it for): *map* each document to `(term, doc_id)` pairs; *reduce* groups by term to produce each term's posting list. A combiner deduplicates and pre-aggregates term frequencies per mapper. This is `reduceByKey` over postings, and the shuffle volume is the total term-occurrence count — combiners cut it sharply.
- **Dedup / distinct.** `distinct()` is a wide transformation — it shuffles to colocate equal values. For exact distinct *counts* this is unavoidable; for approximate counts, **HyperLogLog** (`approx_count_distinct`) is a mergeable sketch (a monoid!) that combines per-partition with near-zero shuffle — the standard production choice when an estimate within ~2% is acceptable. Exact dedup of records uses `dropDuplicates(keys)`, which shuffles by those keys.

---

## The Shuffle Is the Bottleneck

Every pattern above reduces to one question: *how many bytes cross the shuffle, and is it balanced?* The shuffle is a **distributed sort plus an all-to-all network transfer** ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)): map output is partitioned by key, written and sorted, then every reducer fetches its partition from every mapper. It is the single most expensive thing a data pipeline does, and the binding cost is the same one the whole parallel-algorithms track keeps returning to — **data movement, not computation.**

Why it dominates, and the levers that shrink it:

- **Narrow vs wide is the cost boundary.** A **narrow** transformation (`map`, `filter`, partitioned `join`) is shuffle-free — each output partition reads one input partition, pipelined in-memory within a stage. A **wide** transformation (`reduceByKey`, `groupByKey`, shuffle `join`, `repartition`, `distinct`) crosses the network. *Every* shuffle is a stage boundary, a barrier, a sort, and an all-to-all transfer. The first optimization is always: **do I actually need this wide transformation, or can I restructure to avoid it?**
- **Combiners / map-side reduce.** `reduceByKey`/`aggregateByKey` pre-aggregate in each partition before the shuffle, cutting shuffle volume from `O(rows)` to `O(partitions × distinct keys)` — the most important single lever, and the reason `groupByKey` is banned for aggregation.
- **Broadcast joins** eliminate the big table's shuffle entirely (above).
- **Partition pruning and predicate/projection pushdown.** Read less to begin with: partitioned tables (e.g. by date) and columnar formats (Parquet/ORC) let the engine **skip files** that can't match a filter and read only the needed columns. Filtering *before* a shuffle shrinks the bytes that get sorted and transferred. Pushdown is automatic in Spark SQL / DataFrames, manual if you hand-roll RDDs — another reason to stay declarative.
- **Shuffle spill to disk.** Each reducer buffers its incoming partition in memory; when it exceeds the memory fraction, Spark **spills to local disk** (and merges spilled runs, exactly external sort). Spill is the visible symptom of an oversized partition — it turns a fast in-memory shuffle into a disk-bound one. Heavy spill on one task is usually skew (§5), not a global memory shortage.
- **Number of partitions.** Too few → huge partitions that spill and don't parallelize; too many → scheduler overhead and tiny shuffle files. `spark.sql.shuffle.partitions` (default 200) is a routine tuning knob, increasingly automated by Adaptive Query Execution (§5).

The professional reflex when a job is slow: **open the stage view, find the stage with the largest shuffle read, and ask whether it can be made narrow (broadcast join, combiner, prune partitions) or whether one task is reading far more than its peers (skew).**

---

## Data Skew: The #1 Production Problem

Skew is where well-written pipelines die in production. The shuffle distributes work by key, so if a few keys carry a disproportionate share of the rows — `GROUP BY country` where 90% of traffic is one country; a join on a "celebrity" user with millions of followers; a `NULL` join key matching everything — those keys' values all land on **one** reducer/partition. That one task runs for hours while the other 199 finished in minutes; the job's wall-clock is set by the slowest task (a *straggler*), and the hot partition may simply OOM because a key-group cannot exceed a machine's memory.

The symptom is unmistakable in the Spark UI: **one task in a stage with 100× the shuffle-read bytes and duration of the median task, often with heavy disk spill.** The fixes, in rough order of preference:

- **Combiner / map-side pre-aggregation first.** For an associative-commutative aggregate (sum, count, min/max, top-N, HLL), `reduceByKey`/`aggregateByKey` collapses each partition's contribution to a hot key to *one* partial before the shuffle, so the reducer receives `O(#partitions)` values per key instead of `O(rows)`. This often defuses aggregation skew with no extra work. (It does *not* help skewed **joins** — there is no pre-reduction there.)
- **Salting / key-splitting.** Append a random suffix `r ∈ {0..R−1}` to the hot key so its rows spread across `R` partitions; aggregate each `(key, r)` shard in parallel; then a **second stage** strips the salt and merges the `R` partials. This trades one extra round for balance — the explicit rounds-vs-load tradeoff. Apply salting *selectively* to detected heavy hitters (full salting penalizes the cold keys).
- **Skew-join handling.** For a skewed join, **split the hot keys out and broadcast them**: broadcast-join the rows with hot keys (the small replicated side handles the explosion) and sort-merge-join the rest. Spark's `salt-and-explode` skew-join pattern replicates the hot key's rows on the small side `R` ways and salts the big side to match.
- **Adaptive Query Execution (AQE).** Spark 3+ AQE detects skewed shuffle partitions *at runtime* (using actual partition statistics from the completed map stage) and **automatically splits** an oversized partition into smaller ones (`spark.sql.adaptive.skewJoin.enabled`), and coalesces tiny ones, and switches sort-merge joins to broadcast when a side turns out small. AQE handles a large fraction of skew transparently and is the first thing to enable; the manual techniques are for what it misses.

The professional rule: **assume skew exists, look for the straggler task first when a job is slow, and reach for AQE → combiner → salting → skew-join in that order.** Skew, not algorithmic complexity, is what turns a 20-minute job into a job that never finishes.

---

## Fault Tolerance and Execution

At thousand-node scale, machines fail and stragglers are endemic *every run*, so the engines build recovery and slow-task mitigation into the execution model.

- **Deterministic task re-run on failure.** Both Hadoop and Spark assume map/reduce tasks are **deterministic functions of their input partition**, so a failed (or lost) task is simply **re-run** on another node — recomputing the same output. Determinism is the load-bearing assumption: a task with a side effect or a nondeterministic order can produce a different result on retry and corrupt the output. (This is why non-idempotent writes and `rand()` without a seed are production hazards.)
- **Lineage-based recovery in Spark.** Spark does not replicate intermediate data to disk for fault tolerance; instead each RDD/DataFrame records its **lineage** — the deterministic recipe of transformations that built it. A lost partition is **recomputed** from its parents, not restored from a replica. This is what makes in-memory caching *and* fault tolerance compatible — the insight that lets Spark skip Hadoop's disk-materialization.
- **Checkpointing for long lineages.** Lineage recovery is cheap for a short DAG but ruinous for a long iterative one — recomputing partition 17 of iteration 50 may require replaying all 50 iterations. So for long-lineage / iterative jobs you **`checkpoint()`** periodically: write the RDD to reliable storage (HDFS/S3) and **truncate the lineage** to that checkpoint, so recovery replays only from there. Streaming engines (Structured Streaming, Flink) checkpoint operator state continuously for exactly-once recovery — Flink's distributed snapshots (Chandy–Lamport style) are the reference.
- **Speculative execution for stragglers.** A single slow task (a failing disk, a hot node, skew) holds up the whole stage because the stage ends at a barrier. Both engines run **speculative execution**: when a task runs far slower than its stage's median, a *duplicate copy* is launched on another node, and whichever finishes first wins (the other is killed). Speculation hides transient stragglers — but it does **not** fix skew (a skewed task is slow *everywhere* because it has more data; the speculative copy is equally slow). Distinguishing "slow node" (speculation helps) from "skewed data" (speculation wastes resources; fix the partitioning) is a real operational skill.

The synthesis: **deterministic tasks make re-run and lineage recovery sound; checkpointing bounds the recovery cost of long lineages; speculation hides node-level stragglers but not data skew.** These are why a 10,000-task job survives the dozen failures and stragglers it *will* hit every run.

---

## Batch vs SQL vs Streaming vs Graph/ML

Choosing the right tool is more consequential than tuning the wrong one. The axes:

- **MapReduce-style batch (Spark RDD / hand-written map-reduce).** Use when the transformation is genuinely custom — bespoke partitioning, a non-relational combiner, a parsing/cleaning step no SQL function expresses. The cost is that *you* choose the join and aggregation strategy and *you* must avoid `groupByKey` and pick broadcast vs shuffle. Power and responsibility.
- **SQL (declarative — Spark SQL, Trino, BigQuery, Hive).** The default for anything expressible relationally. You write *what* you want; the **optimizer** picks join order, join strategy (broadcast vs sort-merge), aggregation placement (combiner), and predicate/projection pushdown — and with cost-based optimization and AQE it often beats hand-written code, because it has statistics you don't. Prefer SQL/DataFrames unless you need control the optimizer can't express.
- **Streaming (Flink / Spark Structured Streaming).** Use when data is **unbounded** and latency matters — real-time aggregation, sessionization on a live clickstream, fraud scoring, alerting. The model shifts to windows (tumbling/sliding/session), event-time + watermarks (handling late data), and continuously-checkpointed state. Flink for true low-latency record-at-a-time and rich state; Structured Streaming (micro-batch) for unifying with an existing Spark batch codebase.
- **Graph / ML frameworks.** Iterative algorithms (PageRank, connected components, k-means, gradient descent) are the workload classic MapReduce mangles by re-reading from disk each iteration. Use a think-like-a-vertex engine (Pregel/Giraph/GraphX, or specialized graph DBs) or an ML framework — and the **iterative-algorithm caveat is the decisive point: Spark's in-memory caching (`cache()` the static graph/dataset once) beats re-reading it from disk every iteration**, which is the entire reason Spark displaced Hadoop for ML and graph work (`10–100×`). If you find yourself chaining N MapReduce jobs over static data, you want caching, not more jobs.

The one-line guide: **declarative SQL by default → DataFrame API when you need control → RDD/custom map-reduce for genuinely custom logic → streaming for unbounded low-latency → a graph/ML engine (or cached-RDD Spark) for iteration.** And: *iterative ⇒ cache the static data in memory; never re-read it from disk per round.*

---

## Worked End-to-End: Combiner, Broadcast Join, and a Skew Fix

The program below (Spark-like pseudocode, faithful to the PySpark DataFrame/RDD APIs) runs the three patterns this tier turns on — a **group-by-aggregate with a combiner** (vs the `groupByKey` anti-pattern), a **broadcast vs shuffle join**, and a **skewed-key problem with a salting fix** — and *measures the shuffle volume difference* each one makes. The numbers are illustrative of the mechanism, not a benchmark.

```python
from pyspark.sql import functions as F
from pyspark.sql.functions import broadcast, col, lit, concat, rand, floor

# events: ~1e9 rows  (user_id, country, amount)   — the big fact table
# users:  ~1e5 rows  (user_id, name)              — a small dimension table
events = spark.read.parquet("s3://.../events")   # partitioned by date (pruning)
users  = spark.read.parquet("s3://.../users")

# ---------- 1. GROUP-BY AGGREGATE: combiner vs groupByKey ----------

# ANTI-PATTERN: groupByKey ships EVERY value to the reducer.
#   shuffle volume ≈ #rows = 1e9 amounts crossing the network. A hot country OOMs.
bad = (events.rdd
       .map(lambda r: (r.country, r.amount))
       .groupByKey()                       # WIDE: every value shuffled
       .mapValues(sum))

# RIGHT: reduceByKey applies a map-side COMBINER (partial sum per partition).
#   shuffle volume ≈ (#partitions × #distinct countries) ≈ 200 × 200 = 40_000 partials.
good = (events.rdd
        .map(lambda r: (r.country, r.amount))
        .reduceByKey(lambda a, b: a + b))  # combiner runs BEFORE the shuffle

# Idiomatic DataFrame form: the combine is automatic.
agg = events.groupBy("country").agg(F.sum("amount").alias("total"))
#   shuffle of ~1e9 rows  →  ~tens of partials per country.  ~1e9 / 40_000 ≈ 25_000× less.

# ---------- 2. JOIN: broadcast (map-side) vs shuffle (sort-merge) ----------

# SHUFFLE / SORT-MERGE JOIN: partitions BOTH tables by user_id.
#   shuffle volume ≈ |events| + |users| ≈ 1e9 + 1e5 rows sorted + transferred.  Hours.
shuffle_join = events.join(users, on="user_id", how="inner")

# BROADCAST (MAP-SIDE) JOIN: replicate the SMALL users table to every executor.
#   shuffle volume of the big table = 0.  One-time broadcast of ~1e5 rows.  Seconds.
broadcast_join = events.join(broadcast(users), on="user_id", how="inner")
#   Spark auto-broadcasts when it KNOWS users < autoBroadcastJoinThreshold (10 MB);
#   the broadcast() hint forces it when stats are missing.  Trap: broadcasting a
#   table that is NOT small OOMs every executor — use sort-merge if size is unknown.

# ---------- 3. SKEW: one hot key overloads one reducer, and the salting fix ----------

# Suppose 90% of events are country = "US".  groupBy("country") sends 9e8 rows to
# ONE reducer/partition -> that task runs for hours (straggler) or OOMs, while the
# other partitions finish in minutes.  Symptom in the UI: one task with 100× the
# shuffle-read bytes and duration of the median.

R = 64  # salt buckets: split the hot key across 64 partitions

# STAGE 1: salt the key so "US" spreads across R reducers, aggregate each shard.
stage1 = (events
    .withColumn("salt", floor(rand() * R))                 # random suffix 0..R-1
    .groupBy("country", "salt")                            # ("US", 0..63) = 64 keys
    .agg(F.sum("amount").alias("partial")))                # each shard is ~1/R the load

# STAGE 2: strip the salt, merge the R partials per country (tiny: R rows per key).
result = (stage1
    .groupBy("country")
    .agg(F.sum("partial").alias("total")))                 # balanced; no straggler

# In practice: enable AQE skew handling first — it splits oversized shuffle
# partitions at runtime with no code change:
#   spark.conf.set("spark.sql.adaptive.enabled", "true")
#   spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
# Salt manually only for the heavy hitters AQE misses.
```

**What the program demonstrates:**

1. **The combiner cuts shuffle traffic by orders of magnitude.** `groupByKey` ships all `~1e9` amounts across the network and concentrates a hot country on one reducer; `reduceByKey` (and the DataFrame `groupBy().agg`) pre-sums in each of `~200` partitions, so only `~200 × #countries` partials cross — roughly `25,000×` less shuffle volume for the same answer, and no single-key OOM. This is the senior tier's "combiner = commutative-monoid pre-reduction" made into the single most important coding rule.
2. **Broadcast join eliminates the big table's shuffle entirely.** The sort-merge join partitions and sorts *both* tables by `user_id` — a full distributed sort of `~1e9` rows. The broadcast join ships one `~1e5`-row copy of `users` to every executor and joins locally with zero big-table shuffle: hours → seconds. The trap is symmetric — broadcasting a table that isn't actually small OOMs every executor, so sort-merge is the safe default when sizes are unknown.
3. **Skew is the straggler, and salting restores balance.** With 90% of rows on `"US"`, the un-salted group-by sends `~9e8` rows to one reducer — a single task that runs for hours or OOMs while the rest idle. Salting splits `"US"` across `R = 64` shards (each `~1/R` the load), aggregates them in parallel, and a tiny second stage merges the `R` partials. The cost is one extra round; the payoff is a balanced job. AQE does this automatically at runtime for the common cases — enable it first, salt manually only for what it misses.

In production you would write the DataFrame/SQL forms (`groupBy().agg`, `broadcast()`, AQE on) and let Catalyst plan the combiner, the broadcast decision, and skew splitting; the RDD/manual code here exposes the *mechanism* the optimizer applies for you.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| New batch or interactive pipeline | **Spark SQL / DataFrame API** | Catalyst picks joins/aggregations/pushdown; in-memory; one engine for SQL+ML+streaming |
| Expressible relationally (joins, group-bys, filters) | **Declarative SQL** | the optimizer beats hand-tuned code — it has the statistics |
| Genuinely custom partitioning / combiner / parsing | **Spark RDD / custom map-reduce** | the escape hatch; *you* must avoid `groupByKey` and choose the join |
| Group-by aggregation | **`reduceByKey`/`aggregateByKey` or `groupBy().agg`** — never `groupByKey` | map-side combiner cuts shuffle from `O(rows)` to `O(partitions×keys)`; no hot-key OOM |
| Average / multi-stat aggregate | **carry `(sum, count)` / a monoid accumulator** | `avg` is not a monoid; combine the tuple, finish at the end |
| Join, one side small (≲ 100 MB) | **Broadcast (map-side) join** (`broadcast(df)`) | no big-table shuffle; hours → seconds; needs accurate stats |
| Join, both sides big or sizes unknown | **Shuffle / sort-merge join** | safe default; broadcasting a non-small table OOMs executors |
| Distinct count, approximate OK | **`approx_count_distinct` (HyperLogLog)** | mergeable sketch (a monoid) → near-zero shuffle vs exact `distinct` |
| Top-N per group | **partial top-N per partition (bounded heap) → final top-N** | a combiner; never `groupByKey().sort` whole groups |
| Slow job, find the cause | **stage view: largest shuffle-read stage; straggler task?** | bottleneck is shuffle volume or skew, ~never CPU |
| One task 100× slower / OOMs | **Skew: AQE → combiner → salting → skew-join** | hot key on one reducer; fix the partitioning, not the cluster size |
| Iterative algorithm (PageRank, k-means, ML) | **Spark with `cache()` the static data; or a graph/ML engine** | in-memory reuse beats re-reading disk per round (`10–100×`) |
| Unbounded data, low latency | **Flink** (or Spark Structured Streaming) | windows, event-time/watermarks, checkpointed state; true streaming = Flink |
| Long-lineage / iterative job | **`checkpoint()` periodically** | truncates lineage so recovery doesn't replay all iterations |
| Legacy huge stable batch on HDFS | **Keep raw Hadoop MapReduce** | disk-robust; not worth porting if it runs |

Four rules of thumb:

1. **Stay declarative; let the optimizer pick.** Spark SQL / DataFrames choose the combiner, the join strategy, and pushdown from statistics you don't have. Drop to RDDs only for genuinely custom logic — and then never `groupByKey` to aggregate.
2. **You are minimizing shuffle bytes, not function calls.** The shuffle is a distributed sort + all-to-all transfer ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)); cut it with combiners, broadcast joins, partition pruning, and projection pushdown; prefer narrow transformations over wide ones.
3. **Assume skew and look for the straggler first.** One hot key on one reducer is the #1 production failure; enable AQE, then combiner / salting / skew-join. Skew, not big-O, decides whether the job finishes.
4. **Iterative ⇒ cache in memory; unbounded ⇒ stream.** Spark's `cache()` beats Hadoop's disk re-read on iteration (`10–100×`); Flink/Structured Streaming with windows + watermarks beats batch for live, low-latency data.

---

## Research and System Pointers

- **Dean, J., & Ghemawat, S. (2004).** "MapReduce: Simplified Data Processing on Large Clusters." *OSDI.* The original programming model — map, shuffle, reduce, combiners, speculative execution — and the disk-based execution that Spark later superseded for iteration.
- **Zaharia, M., et al. (2012).** "Resilient Distributed Datasets: A Fault-Tolerant Abstraction for In-Memory Cluster Computing." *NSDI.* **Spark / RDDs** — in-memory caching across stages, narrow vs wide dependencies, the DAG of stages, and **lineage**-based fault tolerance; the `10–100×` iterative speedup.
- **Armbrust, M., et al. (2015).** "Spark SQL: Relational Data Processing in Spark." *SIGMOD.* The **Catalyst** optimizer, DataFrame/Dataset API, cost-based join selection (broadcast vs sort-merge), predicate/projection pushdown — and the basis for Adaptive Query Execution.
- **Carbone, P., et al. (2015).** "Apache Flink: Stream and Batch Processing in a Single Engine." The streaming-first dataflow model, event-time/watermarks, windowing, and distributed-snapshot (Chandy–Lamport) checkpointing for exactly-once state.
- **Dean, J., & Barroso, L. A. (2013).** "The Tail at Scale." *CACM.* Stragglers, speculative execution, and tail-latency mitigation at thousand-node scale — why slow-task handling is built into the execution model.
- **Spark documentation — the shuffle, AQE, and join strategies.** `reduceByKey` vs `groupByKey`, the shuffle write/read and spill, broadcast vs sort-merge join, `spark.sql.shuffle.partitions`, and **Adaptive Query Execution** (runtime skew-join splitting and partition coalescing) — the production tuning surface.
- **Lattanzi, S., Moseley, B., Suri, S., & Vassilvitskii, S. (2011).** "Filtering: A Method for Solving Graph Problems in MapReduce." *SPAA.* The round-minimizing / shrink-to-one-machine theory ([`./senior.md`](./senior.md)) behind why iterative and graph workloads need the in-memory engines.
- **Malewicz, G., et al. (2010).** "Pregel: A System for Large-Scale Graph Processing." *SIGMOD.* Think-like-a-vertex / BSP supersteps with in-memory vertex state — the answer (with Spark/GraphX) to MapReduce's iteration problem.
- **Blanas, S., et al. (2010).** "A Comparison of Join Algorithms for Log Processing in MapReduce." *SIGMOD.* Broadcast/map-side vs reduce-side (sort-merge) joins in MapReduce, the skew handling, and when each wins — the empirical basis for the join decision.

---

## Key Takeaways

1. **The lineage decides your performance ceiling: Hadoop → Spark → Flink.** Hadoop MapReduce materializes to disk between every stage (robust, but fatal for iteration); Spark keeps RDDs/DataFrames in memory across a **DAG of stages split at shuffle boundaries**, giving `10–100×` on iterative/interactive work; Flink is streaming-first dataflow. SQL engines sit on top and let an optimizer plan joins/aggregations. Stay declarative by default; drop to RDDs only for custom logic.
2. **Run the patterns the cheap way: combiner, not `groupByKey`.** Group-by uses `reduceByKey`/`aggregateByKey`/`groupBy().agg` (a map-side combiner — a commutative monoid, [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md)), never `groupByKey`; averages carry `(sum, count)`; top-N is a per-partition bounded heap; distinct counts use HyperLogLog when approximate is OK.
3. **Joins: broadcast when one side is small, sort-merge when both are big.** A broadcast (map-side) join replicates the small table and shuffles the big one **zero** times (hours → seconds); a shuffle/sort-merge join partitions and sorts *both* tables ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)). Broadcasting a non-small table OOMs executors — sort-merge is the safe default when sizes are unknown.
4. **The shuffle is the bottleneck — a distributed sort + all-to-all transfer.** Narrow (map-only) transforms are cheap; wide (shuffle) transforms are expensive and end a stage. Cut shuffle bytes with combiners, broadcast joins, partition pruning, and projection pushdown; watch shuffle-read bytes and disk spill in the stage view.
5. **Data skew is the #1 production problem.** A few hot keys overload one reducer/partition — one straggler task runs for hours or OOMs while the rest idle. Recognize it (one task with 100× the shuffle bytes/duration) and fix it: **AQE → combiner → salting/key-splitting → skew-join** (broadcast the hot keys).
6. **Execution survives failure and stragglers because tasks are deterministic.** Deterministic tasks make re-run and Spark's **lineage** recovery sound; **checkpoint** long lineages so recovery doesn't replay every iteration; **speculative execution** hides node-level stragglers (but not skew — a skewed task is slow everywhere).
7. **Pick the tool by workload shape.** Declarative SQL by default → DataFrames for control → RDD/custom for bespoke logic → **streaming** (Flink/Structured Streaming, windows + watermarks) for unbounded low-latency data → a graph/ML engine for iteration. The iterative caveat is decisive: **`cache()` the static data in memory; never re-read it from disk per round.**

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier deploys — the MRC/MPC round-complexity model, PRAM simulation, filtering/coresets, the connectivity round bounds, and the shuffle's communication-vs-load cost · [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) for the map/reduce primitive, the combiner as a commutative-monoid pre-reduction, and `reduceByKey` as a distributed reduce-by-key · [`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md) for the shuffle as a distributed sort, sample-sort partitioning, sort-merge joins, and the skew-as-unbalanced-bucket failure mode
