# The I/O Model — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Databases: The Canonical Application of the I/O Model](#databases-the-canonical-application-of-the-io-model)
   - [The Buffer Pool Is M, the Page Is B](#the-buffer-pool-is-m-the-page-is-b)
   - [Why Indexes Are B+-Trees](#why-indexes-are-b-trees)
   - [External Sort for ORDER BY and Merge Joins](#external-sort-for-order-by-and-merge-joins)
   - [Join Algorithms in the I/O Model](#join-algorithms-in-the-io-model)
   - [The Optimizer Costs Plans in I/Os: Scan vs Index Crossover](#the-optimizer-costs-plans-in-ios-scan-vs-index-crossover)
3. [Big Data: Why "Sort" Is the Workhorse](#big-data-why-sort-is-the-workhorse)
4. [Storage Reality: HDD, SSD, and Write Amplification](#storage-reality-hdd-ssd-and-write-amplification)
5. [The Model's Predictive Wins and Its Blind Spots](#the-models-predictive-wins-and-its-blind-spots)
6. [Practical Engineering: Measuring and Fixing I/O](#practical-engineering-measuring-and-fixing-io)
7. [Worked End-to-End: A Plan Coster in I/Os](#worked-end-to-end-a-plan-coster-in-ios)
8. [Decision Framework](#decision-framework)
9. [Research Pointers](#research-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: the sorting bound `Θ((N/B) log_{M/B}(N/B))` is an information-theoretic theorem, permuting costs as much as sorting, the cache-oblivious model meets every bound at once, and the Brodal–Fagerberg curve dictates the entire B-tree / `B^ε`-tree / LSM design space. That theory is correct and it is the right mental model. This tier answers a different question: **when you sit in front of PostgreSQL's `EXPLAIN ANALYZE`, a Spark job spilling to disk, or an NVMe device that lies about its costs, which parts of the I/O model are load-bearing, which parts are wrong, and what do you actually do?**

The thesis is blunt. The I/O model is the single most predictive piece of theory a storage or data engineer carries: it correctly predicts that production databases index with B+-trees, sort externally, scan sequentially, and cost query plans in pages, *because it correctly identifies that a block transfer — not a comparison — is the unit of cost*. But the basic two-level model is also wrong in three production-critical ways: it charges nothing for **write amplification** (the killer cost on SSDs and LSM-trees), it ignores **prefetching and parallelism** (which make sequential scans far cheaper than the model's `N/B` suggests on real hardware), and it stops at the RAM↔disk boundary, missing the CPU-cache effects where cache-oblivious design takes over. A professional uses the model as the default cost framework and *knows when to reach for a richer one*.

This file works through the three places the model meets production — databases, big-data shuffles, and physical storage — then is honest about its blind spots, gives a measurement-and-fixing checklist, and ends with a runnable plan coster that prices scan / index / sort-merge / hash-join in I/Os and picks the cheapest, exactly as a query optimizer does.

---

## Databases: The Canonical Application of the I/O Model

A relational database is the I/O model made flesh. Every structural decision in a storage engine — page size, index type, join algorithm, optimizer cost formula — is a direct reading of `(N, M, B)`.

### The Buffer Pool Is M, the Page Is B

The **buffer pool** (PostgreSQL `shared_buffers`, InnoDB `innodb_buffer_pool_size`, Oracle's buffer cache) is exactly the model's internal memory `M`: a fixed pool of frames holding recently-touched pages, managed by a replacement policy (CLOCK / sampled-LRU variants — see [`../../25-online-algorithms/03-paging-and-caching-theory/professional.md`](../../25-online-algorithms/03-paging-and-caching-theory/professional.md)). The **page** is exactly the block `B`: the atomic unit the engine reads from and writes to storage. Page size is a deliberate `B` choice, typically **4–16 KB** — PostgreSQL 8 KB, InnoDB 16 KB, SQL Server 8 KB. It is small enough to keep read amplification low (you do not drag 1 MB to read one 200-byte row) and large enough to amortize the per-I/O fixed cost (seek + rotational latency on HDD, command overhead + flash-page granularity on SSD).

The model's cost accounting *is* the database's: the engine counts logical and physical block reads (`pg_stat`'s `heap_blks_read` / `heap_blks_hit`, `EXPLAIN (ANALYZE, BUFFERS)`'s `shared hit`/`read`). A "buffer hit" is a free access in `M`; a "buffer read" is a billable I/O. The entire game of database tuning is raising the fraction of accesses that land in `M`.

### Why Indexes Are B+-Trees

The model predicts the index structure with no freedom left. Searching a set of `N` keys costs `Θ(log_B N)` I/Os because each block read can partition the search range into `B+1` parts (a block of `B` separator keys splits the key universe into `B+1` gaps). A binary search tree — fan-out 2 — costs `Θ(log₂ N)` I/Os, one per level; a B+-tree with node = page and fan-out `Θ(B)` costs `Θ(log_B N)`, a factor of `log₂ B ≈ 10` fewer I/Os for a 16 KB node. For `N = 10⁹` rows and fan-out ~500, a B+-tree is **~3–4 levels**: a point lookup is 3–4 I/Os, and the top two levels almost always live in the buffer pool, so the *physical* cost is often one or two reads. This is the operational reason **every general-purpose database indexes with B+-trees** rather than red-black trees or hash tables: the I/O model says fan-out must match the information a page carries. The full derivation, including the `B^ε`/LSM write-optimized descendants, is in [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md).

B+-trees specifically (keys-and-pointers in internal nodes, all data in a linked leaf chain) over plain B-trees because the leaf chain gives `Θ(N/B)` **range scans** — `ORDER BY`, `BETWEEN`, index-range conditions — at the scan floor, sequentially, which is exactly what relational workloads demand.

### External Sort for ORDER BY and Merge Joins

When a query says `ORDER BY` on a column with no usable index, or `GROUP BY`, or `DISTINCT`, or feeds a sort-merge join, and the input exceeds `work_mem` / `sort_buffer_size`, the engine runs **external merge sort**: form `N/M` sorted runs of size `M`, then merge `M/B`-way until one run remains, for `Θ((N/B) log_{M/B}(N/B))` I/Os. This is not an analogy — PostgreSQL's `tuplesort.c` is a textbook polyphase/`k`-way external merge sort, and `EXPLAIN ANALYZE` will literally report `external merge Disk: 64200kB` when it spills. The size of `work_mem` directly sets the model's `M`, which sets the merge fan-in `M/B`, which sets the number of passes. The full treatment is in [`../03-external-sorting/professional.md`](../03-external-sorting/professional.md).

### Join Algorithms in the I/O Model

A join over relations `R` (size `|R|` pages) and `S` (size `|S|` pages, `|R| ≤ |S|`) is the I/O model's richest case study, because the three classic algorithms are three different ways to beat the naïve quadratic I/O cost.

**Naïve nested-loop join** reads `S` once for every *tuple* of `R` — catastrophic, `O(|R|_{tuples} · |S|)`. No engine does this.

**Block nested-loop join (BNLJ)** uses memory as a window: load as many pages of `R` as fit in `M` (`M − 2` blocks), then scan all of `S` once against that block. Cost:

```text
   BNLJ I/Os  =  |R|  +  ⌈ |R| / (M − 2) ⌉ · |S|.
```

When the smaller relation fits entirely in memory (`|R| ≤ M − 2`), this collapses to `|R| + |S|` — a single scan of each. BNLJ is the fallback when no equality predicate exists (e.g. a band/inequality join) and the inner side has no index.

**Index nested-loop join (INLJ)**: if `S` has a B+-tree index on the join key, probe it once per `R` tuple: `|R| + |R|_{tuples} · log_B |S|`. This wins precisely when `R` is small (few probes) and `S` is large and indexed — the canonical OLTP join.

**Sort-merge join (SMJ)** sorts both relations on the join key, then merges in a single linear pass. Cost:

```text
   SMJ I/Os  =  sort(R) + sort(S) + |R| + |S|
             =  Θ( (|R|/B) log_{M/B}(|R|/B) + (|S|/B) log_{M/B}(|S|/B) ).
```

If an input is already sorted (e.g. arrives in index order), drop its sort term — this is why an index on the join key can make SMJ nearly free on one side. SMJ also produces sorted output, which a downstream `ORDER BY` or merge can reuse.

**GRACE / hybrid hash join (HHJ)** is the workhorse for large, unsorted, equijoins. Phase 1 — **partition**: hash both relations on the join key into `P` partitions chosen so each partition of the *build* side fits in `M`; write all partitions to disk. Phase 2 — **build & probe**: for each partition, load the build side into an in-memory hash table and stream the probe side through it. Cost when one partitioning pass suffices:

```text
   GRACE hash join  =  3 · (|R| + |S|)        (read once, write once, read once).
```

If the build side is too large to partition into memory-sized pieces in one pass, you **recurse** (re-partition the overflowing partitions) — each recursion level adds `2(|R|+|S|)`. **Hybrid** hash join keeps the first partition resident in memory so it never spills, shaving I/Os when `M` is comfortably larger than one partition. This is the I/O model's permuting-by-hash made practical: partitioning is a data-dependent scatter, which the model warns costs `Θ(sort)` in the worst case, but a *single* hash pass linearizes it when `M` is large enough — the whole point of choosing `P ≈ |R|/M`.

The hierarchy of which join wins is exactly an I/O-cost comparison:

| Join | I/O cost (one pass) | Wins when |
| --- | --- | --- |
| Index nested-loop | `|R| + |R|_{tuples}·log_B|S|` | `R` small, `S` large & indexed on key |
| Block nested-loop | `|R| + ⌈|R|/(M−2)⌉·|S|` | small input fits in `M`; non-equi join |
| Sort-merge | `sort(R)+sort(S)+|R|+|S|` | inputs large; one/both pre-sorted; need sorted output |
| GRACE/hybrid hash | `3(|R|+|S|)` (1 pass) | large equijoin, no useful order, ample `M` |

### The Optimizer Costs Plans in I/Os: Scan vs Index Crossover

The cost-based optimizer is, at heart, the worked example of this whole file: it enumerates plans and assigns each an estimated cost dominated by I/Os (PostgreSQL's `seq_page_cost`, `random_page_cost`, `cpu_tuple_cost` are literally per-I/O and per-tuple weights). The single most important crossover it computes is **sequential scan vs index scan**.

A sequential scan of a table of `T` pages costs `T` *sequential* I/Os. An index scan returning `s` selected rows costs roughly `log_B N` to descend plus up to `s` *random* heap fetches (one per matching row, unless the index is covering or the heap is correlated/clustered). Because each random heap fetch can be a full random I/O, the index scan only wins when selectivity is high enough:

```text
   index scan wins  ⟺  log_B N + s · random_page_cost  <  T · seq_page_cost.
```

With `random_page_cost / seq_page_cost ≈ 4` (PostgreSQL's HDD-era default) the crossover is famously around **5–10% selectivity**: below it, fetch the few rows via the index; above it, just scan the whole table sequentially. This is why "add an index" does *not* speed up a query that returns half the table — the planner correctly chooses the seq scan, because `s` random I/Os exceed `T` sequential ones. On SSD the ratio narrows (set `random_page_cost` closer to `1.1`), pushing the crossover toward higher selectivity — a direct, measurable consequence of the storage-reality section below. See also [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md).

---

## Big Data: Why "Sort" Is the Workhorse

Scale the I/O model out across a cluster and the disk↔RAM hierarchy gains a third, slower rung: **the network**. A node reads from local disk, but to combine data across nodes it must move bytes over the network, which sits between local RAM and (sometimes) local disk in cost. The model still holds; you just count network transfers alongside disk I/Os.

**MapReduce / Spark `shuffle` is external sort plus partition.** Between the map and reduce stages, every map output is partitioned by key (hash of the key mod `R` reducers), sorted/grouped within each partition, spilled to local disk, then pulled across the network by reducers that merge the incoming sorted runs. That is precisely run-formation + partition + `M/B`-way merge — external merge sort with the merge inputs arriving over the network. This is why **sort is the canonical big-data benchmark**: **TeraSort** (sort 1 TB, later 100 TB / the Gray-sort and CloudSort contests) is a benchmark *because the shuffle is a distributed external sort*, so a system that sorts well shuffles well, and shuffle is the cost center of nearly every join, group-by, and aggregation. "Sort is the workhorse" is not a slogan — it is the observation that the dominant distributed-data primitive *is* the I/O model's sort.

**Spilling to disk is the model's `N > M` case, made operational.** When a partition's build side, a hash aggregation's table, or a sort's working set exceeds the executor's memory (`spark.executor.memory` × `spark.memory.fraction`), Spark **spills** sorted runs to local disk and merges them — the same `N/M` runs the external-sort proof produces. An engineer who sees heavy spill metrics is watching `M` be too small for the per-partition `N`; the fixes (more memory, more partitions to shrink per-partition `N`, better key distribution to avoid skew) are all moves in the I/O model.

**Columnar formats are blocked-and-transposed for I/O optimality.** Analytic queries touch few columns of many rows. A row-major layout forces you to read every column's bytes to scan one column — read amplification. **Parquet** and **ORC** store data column-by-column within row groups / stripes (typically ~128 MB blocks), so a `SELECT SUM(price)` reads only the `price` column's pages, slashing `N/B` by the fraction of columns touched. They add per-block min/max statistics and Bloom filters for **predicate pushdown** (skip a whole block whose min/max excludes the filter), turning a scan into a far smaller scan. This is the I/O model's blocking principle applied to the *layout*: arrange bytes so the unit you read (a column chunk) matches the unit you query, and the effective `N/B` drops by both the column-projection factor and the block-skipping factor. Columnar compression compounds it — fewer physical bytes per logical value means more values per block `B`.

---

## Storage Reality: HDD, SSD, and Write Amplification

The model abstracts storage into "one block I/O costs 1." Real devices make that abstraction more or less accurate, and the differences dictate engine design.

**HDD: the model's `sequential ≫ random` is brutally literal.** A spinning disk pays a **seek** (move the head, ~5–10 ms) plus rotational latency (~2–4 ms at 7200 RPM) for each *random* I/O, but streams contiguous data at **100s of MB/s** once positioned. A random 4 KB read is ~100–200 I/Os per second; a sequential read of the same device is ~100,000 4 KB blocks/second. The ratio between random and sequential is **two to three orders of magnitude**. This is *why* the I/O model exists and why every classical external-memory structure is built to convert random access into sequential: B-tree fan-out to minimize the count of random descents, external sort to turn a random permutation into sequential merges, log-structured writes to make all writes append sequentially.

**SSD / NVMe: no seek, but the asymmetry survives in a new form.** Flash has no moving head, so random reads are only modestly slower than sequential (often within 2–5×, not 100×). The model's "sequential ≫ random" is *less extreme but still holds*, for three reasons the basic model never mentions:

- **Flash is paged and erased in blocks.** You read/program at the page granularity (4–16 KB) but can only *erase* at the erase-block granularity (often 1–4 MB, many pages). You cannot overwrite a page in place; you must write to a fresh page and mark the old one stale.
- **Write amplification and garbage collection.** Because of erase-before-write, the **flash translation layer (FTL)** garbage-collects: it relocates still-live pages out of a victim erase block so the block can be erased and reused. The ratio of physical writes the device performs to logical writes the host issued is **write amplification (WAF)**. Random and small writes scatter live data, raising WAF (sometimes 3–10×); large sequential writes keep erase blocks uniformly hot/cold and keep WAF near 1. **TRIM** lets the host tell the FTL which logical blocks are free so GC need not relocate dead data.
- **Endurance.** Each flash cell tolerates a finite number of program/erase cycles; write amplification directly consumes that endurance budget. On SSDs, *writes are a scarce resource* in a way the symmetric I/O model never models.

The professional consequence: **the basic I/O model is read-centric and charges writes the same as reads, but on real storage — especially SSD — a write costs more than a read, and a small random write can cost many times a large sequential one.** Write amplification is a first-class cost the model misses.

**Append-only / log-structured design is the engineering response.** If small in-place updates are expensive (HDD seeks, SSD write amplification), then *never update in place*: append all writes sequentially to a log and reconcile later. This is the design of **LSM-trees** (RocksDB, Cassandra, LevelDB): buffer writes in a memtable, flush sorted runs (SSTables) sequentially, and compact them in the background by merging — every write to the device is sequential, which is gentle on both HDD seeks and SSD GC. The price is **read and space amplification** (a point read may probe multiple levels; compaction temporarily duplicates data) and *compaction-driven write amplification* — the writes the I/O model's read-centric view doesn't see. The three amplifications — read, write, space — and the LSM/B-tree tradeoff between them are exactly the **RUM conjecture** (Athanassoulis et al.): you can optimize at most two of read, update, and memory/space at once. The full LSM treatment, where it exists, is in [`../../21-advanced-structures/04-lsm-tree/professional.md`](../../21-advanced-structures/04-lsm-tree/professional.md); the theoretical curve it sits on is in [`./senior.md`](./senior.md).

---

## The Model's Predictive Wins and Its Blind Spots

A professional must hold both halves honestly: the I/O model earns its place by *predicting real systems*, and it must be supplemented where it lies.

**What the model predicts correctly — and these are big wins:**

- **B-trees as the universal index.** `Θ(log_B N)` with fan-out `Θ(B)` is exactly why databases and filesystems use B+-trees. Predicted, not discovered.
- **External merge sort and its configuration.** That `work_mem` (the `M`) controls the merge fan-in and pass count is a direct model consequence used daily in tuning.
- **Blocking everywhere.** Page-at-a-time I/O, columnar row groups, log segments, RAID stripe units — all are the model's "amortize the per-I/O cost over `B` elements" applied at different scales.
- **The sequential-vs-random gulf and the scan/index crossover.** The optimizer's cost model is the I/O model with calibrated constants.

**What the model misses — and when to reach for a richer model:**

- **Prefetching / readahead.** Real OSes and engines detect sequential access and prefetch ahead, so a sequential scan's *latency* is hidden behind computation — the model counts `N/B` I/Os but the wall-clock cost is far below `N/B × per-I/O-latency`. The model is right about the *count* and wrong about implying each costs a full stall. When prefetch is in play, optimize for *sequentiality* (so prefetch engages), not just I/O count.
- **Parallelism / multiple disks.** One disk is the model's assumption; RAID arrays, multi-channel NVMe, and distributed storage transfer many blocks per step. The **Parallel Disk Model** (Vitter–Shriver) adds the `D` disks and the load-balancing constraint the basic model ignores; reach for it when stripe placement or per-disk contention matters (see [`./senior.md`](./senior.md)).
- **CPU-cache effects below RAM.** Once data fits in RAM, the relevant hierarchy is L1/L2/L3↔RAM, with `B` = cache line (~64 B) and `M` = cache size. The two-level I/O model with disk parameters says nothing here; **cache-oblivious algorithms** optimize *every* level at once and are the right tool for in-memory, cache-bound work. See [`../02-cache-oblivious-algorithms/professional.md`](../02-cache-oblivious-algorithms/professional.md).
- **Write amplification and the read/write asymmetry.** As above: the symmetric model undercounts writes on SSD and LSM systems. Reach for amplification-aware analysis (RUM) when the workload is write-heavy or endurance-bound.

The rule: **use the I/O model as the default cost framework; switch models when the dominant cost is prefetch-hidden latency (think sequentiality), parallel-disk balance (PDM), CPU-cache locality (cache-oblivious), or write amplification (RUM/amplification analysis).**

---

## Practical Engineering: Measuring and Fixing I/O

Theory is only useful if you can find and fix the I/O bottleneck on a live system.

**Measuring I/Os — instrument before you tune:**

- **`iostat -x 1`** — per-device throughput (`rkB/s`, `wkB/s`), IOPS (`r/s`, `w/s`), average request size (`rareq-sz`), queue depth (`aqu-sz`), and `%util`. Small average request size + high IOPS = a random-I/O pattern; large request size = sequential. `%util` near 100% with high `await` means the device is the bottleneck.
- **`blktrace` / `blkparse` / `iowatcher`** — block-layer tracing to see the *actual* LBA access pattern; confirm whether your "sequential" scan is really sequential after the filesystem and scheduler are done with it.
- **`EXPLAIN (ANALYZE, BUFFERS)`** (PostgreSQL) / `EXPLAIN ANALYZE` (others) — the database's own I/O accounting: `shared hit` (free, in `M`), `shared read` (billable I/O), `external merge Disk: …kB` (a sort spilled), `Rows Removed by Filter` (work you read but threw away). This is the single highest-leverage tool for query-level I/O.
- **`perf stat` / `perf record`** with `cache-misses`, `LLC-load-misses` — for the *below-RAM* layer, where the I/O model hands off to cache-oblivious reasoning.

**Fixing I/O — the levers, in order of leverage:**

1. **Size `M` to the working set.** Raise the buffer pool / `shared_buffers` / `work_mem` so the hot set and sort buffers live in memory. The biggest single win is converting billable reads into buffer hits. Beware over-sizing `work_mem` per-operation — it multiplies across concurrent sorts.
2. **Choose block/page size deliberately.** Larger pages amortize per-I/O overhead for scan-heavy workloads but raise read amplification for point lookups. Match `B` to the access granularity.
3. **Design for sequential access.** Cluster tables on the access key, keep indexes correlated with heap order, use append-only writes, lay out analytic data columnar. Sequentiality lets prefetch hide latency and keeps SSD write amplification near 1.
4. **Batch random I/O.** Convert many small random I/Os into one large sequential pass: bulk-load instead of row-by-row insert, group lookups and sort by key before fetching (the buffer-tree / sort-then-scan idea), use covering indexes to avoid random heap fetches.
5. **Respect the read/write asymmetry.** On SSD, prefer write-optimized structures (LSM) for write-heavy workloads; monitor write amplification and provision endurance.

**Checklist — "is this workload I/O-bound, and how do I fix it?"**

```text
[ ] Is the device the bottleneck?  iostat: %util ≈ 100% and await high → yes.
[ ] Random or sequential?          small rareq-sz + high IOPS → random (expensive).
[ ] Is M too small?                buffer-hit ratio low; sorts/joins spilling to disk.
[ ] Read or write bound?           iostat r/s vs w/s; SSD: also check write amplification.
[ ] Reading data you discard?      EXPLAIN: "Rows Removed by Filter" high → missing index/predicate pushdown.
[ ] Wrong plan at the crossover?   seq scan where index expected (or vice versa) → fix selectivity estimate / random_page_cost.
Fixes, in order: grow M → make access sequential → batch random I/O → write-optimize if write-bound.
```

---

## Worked End-to-End: A Plan Coster in I/Os

Here is a self-contained Python program that does what a query optimizer's heart does: given relation sizes and the system's `(M, B)`, it costs scan / index / sort-merge / hash-join plans **in I/Os** and picks the cheapest. It makes the abstract formulas above executable and shows the crossovers shifting as you change memory and selectivity.

```python
import math

# --- system parameters: the I/O model's (M, B), in *pages* and elements ---
class System:
    def __init__(self, mem_pages, fanout):
        self.M = mem_pages          # buffer/work memory, in pages  (the model's M/B)
        self.fanout = fanout        # B-tree fan-in ~ Theta(B); merge fan-in ~ M/B

    def passes(self, n_pages):       # external-sort merge passes: log_{M/B}(n/M)
        runs = max(1, n_pages / self.M)
        return max(1, math.ceil(math.log(runs, max(2, self.M - 1))))

# --- cost models, all in block I/Os ---
def cost_seq_scan(R_pages):
    return R_pages

def cost_external_sort(sys, n_pages):
    # run formation (read+write) + merge passes (read+write each)
    return 2 * n_pages + 2 * n_pages * sys.passes(n_pages)

def cost_index_scan(sys, N_rows, selected_rows, rows_per_page):
    descent = math.ceil(math.log(max(2, N_rows), sys.fanout))
    random_heap_fetches = selected_rows          # worst case: 1 random I/O / row
    return descent + random_heap_fetches

def cost_block_nested_loop(sys, R_pages, S_pages):
    chunks = math.ceil(R_pages / max(1, sys.M - 2))
    return R_pages + chunks * S_pages

def cost_sort_merge_join(sys, R_pages, S_pages, R_sorted=False, S_sorted=False):
    c = R_pages + S_pages                        # the final merge pass
    if not R_sorted: c += cost_external_sort(sys, R_pages)
    if not S_sorted: c += cost_external_sort(sys, S_pages)
    return c

def cost_grace_hash_join(sys, R_pages, S_pages):
    # one partitioning pass if the build side partitions into M-sized pieces
    parts = math.ceil(R_pages / max(1, sys.M))
    levels = max(1, math.ceil(math.log(max(2, parts), max(2, sys.M))))
    return (2 * levels + 1) * (R_pages + S_pages)  # ~3(|R|+|S|) at levels=1

def best_join(sys, R_pages, S_pages, S_indexed=False,
              N_rows_S=0, R_rows=0, rows_per_page=0):
    plans = {
        "block-nested-loop": cost_block_nested_loop(sys, R_pages, S_pages),
        "sort-merge":        cost_sort_merge_join(sys, R_pages, S_pages),
        "grace-hash":        cost_grace_hash_join(sys, R_pages, S_pages),
    }
    if S_indexed:
        descent = math.ceil(math.log(max(2, N_rows_S), sys.fanout))
        plans["index-nested-loop"] = R_pages + R_rows * descent
    winner = min(plans, key=plans.get)
    return winner, plans

def best_access(sys, R_pages, N_rows, rows_per_page, selectivity, RANDOM=4):
    selected = max(1, int(N_rows * selectivity))
    seq = cost_seq_scan(R_pages)
    idx = (math.ceil(math.log(max(2, N_rows), sys.fanout))
           + selected * RANDOM)               # weight random fetches like the planner
    return ("seq-scan", seq) if seq <= idx else ("index-scan", idx), {"seq": seq, "index": idx}

if __name__ == "__main__":
    sys = System(mem_pages=200, fanout=500)
    R_pages, S_pages = 10_000, 1_000_000
    N_rows_S = S_pages * 100                   # 100 rows/page

    print("== Join coster (I/Os) ==")
    w, plans = best_join(sys, R_pages, S_pages, S_indexed=True,
                         N_rows_S=N_rows_S, R_rows=R_pages * 100)
    for p, c in sorted(plans.items(), key=lambda kv: kv[1]):
        print(f"  {p:20s} {c:>14,d}")
    print(f"  -> optimizer picks: {w}\n")

    print("== Scan vs index crossover, as selectivity grows ==")
    for sel in (0.001, 0.01, 0.05, 0.10, 0.50):
        (choice, _), costs = best_access(sys, R_pages, N_rows_S//100, 100, sel)
        print(f"  selectivity {sel:6.3f}: seq={costs['seq']:>10,d} "
              f"index={costs['index']:>12,d} -> {choice}")
```

Running it reproduces the two crossovers this file is built around. For the join, with the smaller side `R` indexable on the large side `S`, **index-nested-loop** or **grace-hash** wins depending on `R`'s size and `M`; sort-merge wins when both inputs are large and unsorted output order is wanted. For the access path, the printout shows **seq-scan** chosen at low selectivity flipping to... no — the opposite, and that is the lesson: with `random_page_cost = 4`, the index wins only at *low* selectivity (few random fetches), and the plan flips to **seq-scan around 5–10% selectivity** as the `selected × RANDOM` term overtakes the `R_pages` sequential cost. Lower `RANDOM` to `1.1` (an SSD) and the crossover moves to higher selectivity — the storage-reality section made executable. The whole program is ~70 lines and *is*, structurally, a miniature cost-based optimizer.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Point/range lookups on disk-resident data | **B+-tree index** | `Θ(log_B N)` I/Os; leaf chain gives `Θ(N/B)` ranges |
| `ORDER BY` / `GROUP BY` / `DISTINCT` larger than `work_mem` | **External merge sort**; size `work_mem` | `M` sets fan-in → pass count ([`../03-external-sorting/professional.md`](../03-external-sorting/professional.md)) |
| Large equijoin, no order needed, ample `M` | **GRACE/hybrid hash join** | `~3(|R|+|S|)` one pass |
| Both inputs large, one pre-sorted, sorted output wanted | **Sort-merge join** | reuse existing order; drop a sort term |
| Small `R`, large indexed `S` | **Index nested-loop join** | few `log_B|S|` probes |
| `SELECT` returning > ~10% of a table | **Sequential scan** (let the planner choose it) | random fetches exceed sequential scan cost |
| Write-heavy on SSD | **LSM / log-structured** | sequential appends; control write amplification ([`./senior.md`](./senior.md)) |
| Analytic scans over few columns | **Columnar (Parquet/ORC) + predicate pushdown** | read only touched columns; skip blocks by min/max |
| Distributed group-by/join at scale | **Shuffle = external sort + partition**; tune partitions/skew | sort is the workhorse; spilling = `N>M` |
| Data fits in RAM, cache-bound | **Cache-oblivious / cache-aware layout** | switch to L1/L2 `(M,B)` ([`../02-cache-oblivious-algorithms/professional.md`](../02-cache-oblivious-algorithms/professional.md)) |

Three rules of thumb:

1. **Count block I/Os first, then correct for reality.** Get the model's I/O count, then adjust for prefetch (sequential is cheaper than the count implies), parallel disks (`/D`), and write amplification (writes cost more than reads on SSD/LSM).
2. **Grow `M` before anything else.** The highest-leverage tuning move is making the working set and sort buffers fit in memory, converting reads into hits and avoiding spills.
3. **Design for sequentiality and batch random I/O.** Sequential access engages prefetch, keeps SSD write amplification near 1, and is 10–100× cheaper per byte than random on HDD; turn random workloads into sorted sequential passes wherever the structure allows.

---

## Research Pointers

- **Aggarwal, A., & Vitter, J. S. (1988). "The Input/Output Complexity of Sorting and Related Problems."** *CACM* 31(9). The founding two-level `(N, M, B)` model and the tight sort/permute bounds underpinning every cost formula here.
- **Vitter, J. S. (2008). "Algorithms and Data Structures for External Memory."** *Foundations and Trends in Theoretical CS* (and the 2001 *ACM Computing Surveys* version). The definitive survey of the field; the canonical reference for I/O-efficient databases, sorting, and indexing.
- **Graefe, G. (1993). "Query Evaluation Techniques for Large Databases."** *ACM Computing Surveys* 25(2). The encyclopedic treatment of join algorithms (block/index nested-loop, sort-merge, GRACE/hybrid hash), external sorting in DBMSs, and I/O-cost-based query evaluation — the practical companion to the I/O theory.
- **Athanassoulis, M., et al. (2016). "Designing Access Methods: The RUM Conjecture."** *EDBT.* The read–update–memory amplification tradeoff that names the write-amplification cost the basic I/O model omits; the framework for B-tree-vs-LSM decisions.
- **O'Neil, P., Cheng, E., Gawlick, D., & O'Neil, E. (1996). "The Log-Structured Merge-Tree (LSM-Tree)."** *Acta Informatica* 33. The write-optimized, append-only design that turns small random writes into sequential merges — the engineering response to write amplification.
- **Selinger, P. G., et al. (1979). "Access Path Selection in a Relational Database Management System."** *SIGMOD.* The original cost-based optimizer (System R) — where costing plans in I/Os and the scan-vs-index crossover were born.
- **Frigo, M., Leiserson, C. E., Prokop, H., & Ramachandran, S. (1999). "Cache-Oblivious Algorithms."** *FOCS.* The model that takes over below RAM, where the disk-tuned I/O model stops predicting; see [`../02-cache-oblivious-algorithms/professional.md`](../02-cache-oblivious-algorithms/professional.md).

---

## Key Takeaways

1. **A database is the I/O model made flesh:** the buffer pool is `M`, the page (4–16 KB) is `B`, indexes are B+-trees because `Θ(log_B N)` with fan-out `Θ(B)` minimizes random descents, and the optimizer costs every plan in block I/Os. None of this is analogy — it is the model predicting the system.
2. **Join algorithms are three ways to beat quadratic I/O:** block nested-loop (`|R| + ⌈|R|/(M−2)⌉·|S|`), sort-merge (`sort(R)+sort(S)+|R|+|S|`), and GRACE/hybrid hash (`~3(|R|+|S|)` in one pass). Which wins is a literal I/O-cost comparison the optimizer performs.
3. **The scan-vs-index crossover (~5–10% selectivity on HDD) is pure I/O accounting:** an index's random heap fetches eventually exceed a sequential scan's cost; on SSD the lower `random_page_cost` pushes the crossover higher. Adding an index does not help a query that returns half the table.
4. **In big data, sort is the workhorse:** MapReduce/Spark shuffle *is* external sort + partition, which is why TeraSort benchmarks the whole system; spilling to disk is the model's `N > M` case; columnar formats (Parquet/ORC) are the blocking principle applied to layout, cutting effective `N/B` by column projection and block-skipping.
5. **The model's `sequential ≫ random` holds on SSD too — less extreme but real — and the model's blind spot is writes:** flash's erase-before-write forces garbage collection and **write amplification**, a first-class cost the symmetric I/O model never charges. Append-only/log-structured (LSM) design is the response; the RUM conjecture names the read/update/memory tradeoff.
6. **Use the I/O model as the default cost framework and switch when it lies:** reach for prefetch-aware reasoning (optimize sequentiality), the Parallel Disk Model (multiple disks), cache-oblivious analysis (CPU caches below RAM), or amplification analysis (write-heavy SSD/LSM). Measure with `iostat`, `blktrace`, `EXPLAIN (ANALYZE, BUFFERS)`, and `perf`; fix by growing `M`, making access sequential, and batching random I/O.

---

> **See also:** [`./senior.md`](./senior.md) for the lower-bound theory and the Brodal–Fagerberg curve · [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md) for B+-trees and write-optimized indexes in practice · [`../03-external-sorting/professional.md`](../03-external-sorting/professional.md) for the external sort engines behind `ORDER BY` and sort-merge · [`../02-cache-oblivious-algorithms/professional.md`](../02-cache-oblivious-algorithms/professional.md) for the model that takes over below RAM · [`../../25-online-algorithms/03-paging-and-caching-theory/professional.md`](../../25-online-algorithms/03-paging-and-caching-theory/professional.md) for the buffer-pool replacement policies that manage `M`
