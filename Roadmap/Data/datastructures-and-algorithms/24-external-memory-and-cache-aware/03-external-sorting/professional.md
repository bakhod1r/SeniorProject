# External Sorting — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Database SORT Operator](#the-database-sort-operator)
   - [Where Sort Appears in a Query Plan](#where-sort-appears-in-a-query-plan)
   - [PostgreSQL tuplesort: In-Memory Quicksort vs Spilling](#postgresql-tuplesort-in-memory-quicksort-vs-spilling)
   - [Top-N: The Bounded-Heap Shortcut](#top-n-the-bounded-heap-shortcut)
   - [SQL Server / Oracle Sort Areas](#sql-server--oracle-sort-areas)
   - [The Optimizer's Sort-vs-Hash Decision](#the-optimizers-sort-vs-hash-decision)
3. [Big-Data Shuffle = Distributed External Sort](#big-data-shuffle--distributed-external-sort)
   - [MapReduce and the Sort Phase](#mapreduce-and-the-sort-phase)
   - [Spark Sort-Based Shuffle and the ExternalSorter](#spark-sort-based-shuffle-and-the-externalsorter)
   - [The Sort Benchmark: TeraSort, GraySort, CloudSort](#the-sort-benchmark-terasort-graysort-cloudsort)
4. [Engineering the Sort](#engineering-the-sort)
5. [The SSD-Era External Sort](#the-ssd-era-external-sort)
6. [Key Handling: Normalization, Stability, Pointers](#key-handling-normalization-stability-pointers)
7. [Worked End-to-End: A Production-Flavored External Sorter](#worked-end-to-end-a-production-flavored-external-sorter)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) maps the *space* of optimal external sorts: merge sort, its distribution-sort dual, parameter-free funnelsort, the parallel-disk bound, the shuffle, and the snowplow. All of it is correct, and it is the right mental model. This tier answers the operational question that follows: **when PostgreSQL prints `external merge Disk: 64200kB`, when a Spark stage spends 80% of its wall-clock in shuffle, or when you must hand-roll a sorter that streams 500 GB through 8 GB of RAM on NVMe — what does external sort actually look like in production, and what decisions are load-bearing?**

The thesis: external sort is not a textbook curiosity, it is the *single most-run heavy algorithm in data infrastructure*. Every `ORDER BY` without an index, every `GROUP BY` and `DISTINCT` the planner resolves by sorting, every sort-merge join, every B-tree bulk-load, and every MapReduce/Spark shuffle is an external sort. The engineering reality has four recurring themes that the asymptotic bound hides: (1) for realistic memory, **the answer is one or two passes**, so the entire game is *maximizing fan-in and overlapping I/O with compute*, not minimizing passes; (2) **most "sorts" should not be full sorts** — top-N, early aggregation, and pre-sorted inputs each kill a pass or the whole sort; (3) **the constants are everything** — sequential vs scattered writes, read-ahead buffer sizing, run compression; and (4) **keys are not integers** — normalization, collation, stability, and (key, pointer) indirection dominate the per-record cost in real systems.

This file walks the two production homes of external sort — the database SORT operator and the big-data shuffle — then the engineering levers, the SSD-era recalculation, key handling, and a runnable, instrumented sorter that demonstrates the one-to-two-pass result for realistic `M`.

---

## The Database SORT Operator

A relational engine's external sort is exposed as a physical plan operator — a **Sort node** — that other operators consume. It is the most-instrumented external sort in existence, and reading its behavior off `EXPLAIN ANALYZE` is the fastest way to internalize the theory.

### Where Sort Appears in a Query Plan

The optimizer inserts a Sort node wherever an operator needs ordered input that no index supplies:

- **`ORDER BY`** on a non-indexed column (or after a join that destroyed index order).
- **`GROUP BY` / aggregation**, when the planner chooses *group aggregate* (sort then collapse adjacent equal-key runs) over *hash aggregate*.
- **`DISTINCT`** and `UNION` (dedup), resolvable by sort-then-uniq or by hash.
- **Sort-merge join input** — both sides sorted on the join key, then merged in one linear pass (see the join cost comparison in [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)).
- **Index build / `CREATE INDEX`** — a B-tree is bulk-loaded by sorting all keys and packing leaves bottom-up, far cheaper than `N` random insertions ([`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md)).
- **Window functions** with `ORDER BY` / `PARTITION BY`, and merge-append for partition-wise scans.

In each case the Sort node is the external merge sort of the middle/senior tiers, parameterized by one knob: the memory budget.

### PostgreSQL tuplesort: In-Memory Quicksort vs Spilling

PostgreSQL's `tuplesort.c` is the canonical, readable production external sorter. Its state machine is worth knowing exactly:

1. **In-memory phase.** Tuples accumulate in a memory array bounded by **`work_mem`** (default a conservative 4 MB; routinely raised to 64–256 MB for analytic queries). If all tuples fit, the sort finishes entirely in RAM. PostgreSQL uses an introsort-flavored **quicksort** here (with insertion sort for small partitions, and specialized comparators — see key handling below). `EXPLAIN ANALYZE` reports `Sort Method: quicksort  Memory: 25kB`.

2. **Spill / run formation.** If the input exceeds `work_mem`, tuplesort transitions to **external sort**: it sorts the current in-memory load into a *run*, writes it to a temporary tape file, and continues forming runs. Historically PostgreSQL used **replacement selection** (a heap) to stretch the first run; since PostgreSQL 10 it forms runs by quicksorting full `work_mem` loads, because — exactly as [`./senior.md`](./senior.md) argues — on modern hardware a cache-friendly quicksort of a large memory load beats the heap's poor locality, and the lost pass is bought back by cheap RAM. `EXPLAIN ANALYZE` reports `Sort Method: external merge  Disk: 64200kB`.

3. **Bounded tape merge.** The runs are merged `k`-way in a final pass (a heap/tournament over the run heads), where the fan-in is bounded by how many run buffers fit in `work_mem`. If the run count exceeds the fan-in, PostgreSQL does additional merge passes — but with `work_mem` of even tens of MB and modern data sizes, **one merge pass is the overwhelming common case** (see the worked section). The `log temp file` server behavior (`log_temp_files = 0`) emits a log line for every spill file created, which is the production signal that a query is sorting on disk: a flood of temp-file logs is the cue to raise `work_mem` or add an index.

The operational chain is: `work_mem` *is* the model's `M`; `M` sets the merge fan-in `M/B`; fan-in sets the pass count. Doubling `work_mem` does not "make the sort twice as fast" — it raises the fan-in, which usually only matters at the threshold between one and two passes, and (more often) determines whether the sort spills *at all*.

### Top-N: The Bounded-Heap Shortcut

The single highest-value optimization in the operator is **bounded sort** for `ORDER BY ... LIMIT N`. When the planner knows only the top `N` rows are needed, it never does a full sort. Instead it maintains a **bounded heap of size `N`** (a max-heap on the sort key for an ascending top-N): scan the input once, push each row, and when the heap exceeds `N`, pop the worst. The cost is `Θ(input/B)` I/Os — *one scan, no spill* — and `O(input · log N)` comparisons, versus a full `Θ(sort(N))`. PostgreSQL reports `Sort Method: top-N heapsort  Memory: 30kB`. This is the external-memory instance of *never sort what you can select* ([`./senior.md`](./senior.md)): a `LIMIT 100` over a billion rows touches the data once and keeps 100 rows resident, never spilling. The professional reflex on seeing a slow `ORDER BY ... LIMIT` is to confirm the planner actually chose top-N heapsort and not a full external sort feeding a Limit on top.

### SQL Server / Oracle Sort Areas

The same machine wears different names. **SQL Server** runs sorts against a workspace memory grant negotiated by the optimizer before execution; an underestimated grant causes a *sort spill* to `tempdb`, surfaced as a `Sort Warning` and a yellow-triangle warning in the actual execution plan — the SQL Server analogue of PostgreSQL's temp-file log. **Oracle** historically exposed `sort_area_size`; modern Oracle uses **automatic PGA management** (`pga_aggregate_target`), and a sort that exceeds its work-area allotment becomes *one-pass* (single merge) or *multi-pass* (cascaded merges) and spills to a temporary tablespace, reported in `V$SQL_WORKAREA` as optimal / one-pass / multi-pass executions. Every engine encodes the same three regimes — **in-memory, one-pass, multi-pass** — and the tuning goal everywhere is to keep sorts in the first or second regime.

### The Optimizer's Sort-vs-Hash Decision

For grouping and joining, the optimizer chooses between a **sort-based** and a **hash-based** physical operator, and the choice is a direct I/O-cost comparison ([`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)):

- **Grouping/distinct:** *hash aggregate* (build a hash table keyed by group, one scan, `Θ(N/B)` if the table fits in `M`) vs *group aggregate* (sort, then collapse runs, `Θ(sort(N))`). Hash wins when the number of distinct groups is small enough to fit in memory; sort wins when groups are numerous (hash table would spill), when the input is *already sorted* on the key (sort term drops to zero), or when sorted output is wanted downstream.
- **Joins:** *hash join* (`~3(|R|+|S|)` for a one-pass GRACE partition) vs *sort-merge join* (`sort(R)+sort(S)+|R|+|S|`). Hash join is the default for large unordered equijoins; sort-merge wins when one or both inputs arrive pre-sorted (e.g. via an index or an upstream sort), when the join is on an inequality with an ordering, or when the merged output's order is reused by a later `ORDER BY`.

The deciding asymmetry: **sort produces order as a reusable byproduct; hash does not.** A plan that sorts once and rides that order through a join *and* an `ORDER BY` *and* a `GROUP BY` can beat a plan that hashes each independently. This is why cost-based optimizers track "interesting orders" (the System-R idea): an order produced by one operator can make a downstream sort free.

---

## Big-Data Shuffle = Distributed External Sort

Scale external sort across a cluster and the slowest "tape" becomes another machine reached over the network. The shuffle between stages *is* a distributed external sort: partition by key, then sort within partition. [`./senior.md`](./senior.md) frames why this is structurally a *distribution* sort (no global merge bottleneck); this tier covers what the engines actually do.

### MapReduce and the Sort Phase

Classic Hadoop MapReduce has a **mandatory sort** between map and reduce. Each map task writes key-value outputs into an in-memory circular buffer (`mapreduce.task.io.sort.mb`); when it crosses a spill threshold (`mapreduce.map.sort.spill.percent`, ~0.80), a background thread **partitions** records (hash of key mod #reducers), **sorts** each partition's records in memory, and **spills** a sorted file to local disk. After the map finishes, its several spill files are **merged** into one partitioned, sorted output — external merge sort on the mapper. Reducers then **fetch** their partition from every mapper over the network and perform a final **merge** of those sorted streams, delivering each reduce key with its values *grouped and in sorted order*. The framework guarantee "reduce sees keys in sorted order" is precisely the output contract of an external sort; the "sort phase" is not optional decoration, it is the core data movement.

### Spark Sort-Based Shuffle and the ExternalSorter

Spark replaced its early hash-based shuffle with **sort-based shuffle** (default since Spark 1.2) for the same reason single-machine sorts prefer merge: hash shuffle opened one output file *per reduce partition per map task* (`M × R` files), exhausting file descriptors and scattering writes. Sort-based shuffle has each map task write **one partitioned, sorted file plus an index** of partition offsets. The engine:

- **`ExternalSorter`** buffers records in memory; when memory pressure (tracked by the unified memory manager, `spark.memory.fraction`) forces it, it **spills** sorted runs to disk and later merges them — the textbook spill/merge loop. If a map-side aggregation or ordering is requested, it sorts by `(partitionId, key)`; otherwise by `partitionId` alone, sorting within partition only when required.
- **`UnsafeShuffleWriter`** (the *tungsten-sort* / serialized path) is the optimized variant: it sorts **compact 8-byte pointer-records** (a packed partition id + a pointer into serialized record pages) rather than deserialized objects, and merges spills by concatenating already-serialized bytes. Sorting pointers instead of payloads is the (key, pointer) indirection of the key-handling section, applied at cluster scale, and it is why this path is dramatically faster and cache-friendlier.

A reduce task then fetches its partition's blocks from every map output across the network and merges them. The network is simply the outermost level of the hierarchy: a partition that does not fit in reduce memory spills and merges again. **Skew** — one partition far larger than the rest — is the dominant production failure: it makes one reducer's per-partition `N` blow past `M`, causing heavy spill and a straggler that dominates wall-clock. The fixes (more partitions, salting hot keys, adaptive query execution's skew-join handling) are all moves to keep each partition's `N` near `M`.

### The Sort Benchmark: TeraSort, GraySort, CloudSort

The **Sort Benchmark** (sortbenchmark.org — TeraSort, GraySort sorting 100 TB, MinuteSort, CloudSort, the energy-efficient JouleSort) exists because *a system that sorts well shuffles well*. Record-holders (Hadoop's 2008/2009 TeraSort runs, Spark's 2014 100 TB GraySort record) optimize exactly the four things this file keeps returning to:

- **Sequential I/O end to end** — read input, spill, and write output as large sequential streams; never random.
- **Balanced partitions** — sample the data first to choose **range splitters** so every node/partition gets a near-equal share (the sample-sort splitter problem of [`./senior.md`](./senior.md)); imbalance creates stragglers that cap throughput.
- **Overlap** — pipeline read, sort/compute, network transfer, and write so the disk, CPU, and NIC are all busy at once; the winning systems are bottlenecked on the slowest resource, not on serialization between phases.
- **One pass over the network** — choose enough memory/partitions that the shuffle is a single distribute-then-merge, not a cascaded re-shuffle.

The benchmark is a distributed external sort distilled to its essentials, which is why it is *the* macro-benchmark for data engines.

---

## Engineering the Sort

Between the asymptotic bound and a fast sorter sits a set of constant-factor decisions that decide whether you hit the one-pass result and saturate the device.

- **Run formation: quicksort vs replacement selection.** Quicksort a full `M`-load (cache-friendly, sequential, data-independent, runs of length `M`) is the modern default. Replacement selection (a loser/tournament tree producing expected-`2M` runs, [`./senior.md`](./senior.md)) is worth it only for *near-sorted* input (giant or single runs) or *variable-length* records; on random fixed-size data its heap locality loses to quicksort.

- **Fan-in vs read-ahead buffer, the central trade-off.** Memory `M` during the merge is split between (a) **fan-in** — more runs merged at once means fewer passes — and (b) **read-ahead buffers** — larger per-run buffers mean larger sequential reads and effective prefetch. These compete for the same RAM. A merge with fan-in `F` keeps `F` input buffers plus output buffers resident; raising `F` shrinks each buffer, shrinking each read and risking a return to small random I/O. The professional choice is *the largest fan-in whose per-run buffer still yields a comfortably sequential read* (hundreds of KB to a few MB per run on disk), because passes are nearly always 1–2 and the marginal pass saving from a huge fan-in is worth less than keeping reads sequential.

- **Double-buffering / async I/O.** Overlap the merge's compute with its I/O: while the CPU consumes one buffer of a run, asynchronously prefetch the next (double-buffering), and while writing output, fill the next output buffer. This hides I/O latency behind comparison work and is what turns the model's "`N/B` I/Os" from `N/B` *stalls* into a streaming pipeline limited by device bandwidth.

- **Compressing runs.** Spilled runs can be compressed (LZ4/Snappy/Zstd) before writing and decompressed on read. Since external sort is I/O-bound and CPUs have spare cycles during merge, **trading CPU for I/O usually wins**: compressed runs cut bytes written and read, often the dominant cost. Spark, MapReduce, and several DB temp-file paths compress spills by default.

- **Early aggregation.** If the sort feeds a `GROUP BY ... SUM/COUNT`, aggregate *partially* during run formation: combine equal-key records within each in-memory load before spilling, so runs carry already-reduced partial aggregates. This shrinks every run and every byte merged — for high-duplicate group keys it can collapse the data by orders of magnitude before any I/O. (This is exactly MapReduce's *combiner*.)

- **Spill thresholds and the merge tree.** Spilling too eagerly makes many tiny runs (more to merge); too lazily risks OOM. Engines spill at a memory-pressure threshold and form runs of ~`M`. When the **number of runs exceeds the fan-in**, you cannot merge them all in one pass: build a **merge tree** (cascaded merge) — merge groups of `F` runs into longer runs, then merge those, each level a full `Θ(N/B)` scan, for `⌈log_F(#runs)⌉` levels. The whole point of large fan-in is to make this tree one level deep.

---

## The SSD-Era External Sort

Flash storage rewrites several constants without overturning the model.

- **Seek penalty mostly gone → fan-in/buffer math relaxes.** On HDD, a small per-run read buffer was punishing because each non-sequential read paid a ~10 ms seek, forcing large buffers and thus limiting fan-in. On SSD/NVMe random reads are only modestly slower than sequential (often within 2–5×), so you can afford **smaller per-run buffers and therefore much higher fan-in** — pushing more sorts into a single merge pass. The trade-off curve shifts decisively toward "more fan-in, fewer passes."

- **Write amplification and endurance favor fewer passes.** Each external-sort pass *writes* the data once. On SSD, writes consume the finite program/erase endurance budget and incur write amplification from the FTL's garbage collection ([`../01-the-io-model/professional.md`](../01-the-io-model/professional.md)). A two-pass sort writes the dataset twice; a one-pass sort once. So the SSD era adds a *write-cost* reason — beyond latency — to minimize passes: **fewer passes = less flash wear**. This reinforces large fan-in and run compression (fewer bytes written).

- **NVMe parallelism.** NVMe exposes deep, many-queue parallelism; a single thread issuing one I/O at a time leaves the device idle. The sorter must keep many requests in flight (async I/O, io_uring, multiple buffers per run, parallel merge of independent run groups) to saturate the drive — the practical instance of the Parallel Disk Model's `D` ([`./senior.md`](./senior.md)).

- **Still sequential-favoring.** Despite all this, large sequential reads/writes remain cheaper per byte (better throughput, lower WAF) than scattered small ones. SSDs *narrow* the sequential-vs-random gap; they do not erase it. The sorter's bias toward big sequential run reads and writes survives.

---

## Key Handling: Normalization, Stability, Pointers

In production the comparator, not the merge, often dominates CPU, and records are not uniform integers.

- **Normalized / binary sort keys.** The standard trick is to encode each record's sort key into a **fixed-length, byte-comparable** binary string so that `memcmp` order equals the desired order — folding in sign handling, endianness, multi-column ordering, descending columns (bit-invert), and **collation**. PostgreSQL's *abbreviated keys* are a partial form: pack a prefix of the (possibly expensive, e.g. locale-collated `strcoll`) key into a machine word, compare those words first, and fall back to the full comparator only on ties. This converts an expensive, branchy comparator into a cheap word compare for the common case — a large constant-factor win, especially for text under ICU collations.

- **Variable-length records and (key, pointer) sorting.** Rather than shuffling full variable-length payloads through every pass, sort **(normalized-key, pointer)** pairs: small, fixed-size, cache-friendly sort elements that reference the full record (in a memory page, a spill file, or by row id). Spark's `UnsafeShuffleWriter` sorting 8-byte pointer-records is exactly this. The payload is dereferenced only when emitting final output. The cost: an extra indirection (and a random fetch) at emit time — usually a fine trade because the *sort* moves far fewer bytes.

- **Multi-column keys and collation.** A composite `ORDER BY a, b DESC, c` is encoded as the concatenation of each column's normalized encoding (with `b` bit-inverted for descending), so a single `memcmp` resolves the whole tuple in priority order. Collation rules (case, accent, locale) are baked into the normalization so the byte order is correct without per-comparison locale calls.

- **Stability.** A stable sort preserves input order among equal keys. External merge sort is stable if each merge **breaks ties toward the earlier-origin run**; the universal cheap trick is to **append the input position as a low-order key suffix** during normalization, making any sort stable at the cost of a slightly wider key. Stability matters for layered sorts (sort by secondary, then stably by primary) and for `ORDER BY` semantics that downstream logic relies on.

---

## Worked End-to-End: A Production-Flavored External Sorter

Below is a self-contained Go external sorter that exercises the production decisions: **quicksort run formation**, **spill files**, a **`k`-way loser-tree merge with read-ahead**, a **top-N shortcut**, and **instrumentation** (passes, I/Os, bytes) so you can watch the one-to-two-pass result for realistic `M`. It sorts `int64` keys (stand-ins for normalized keys) but the structure is exactly a real engine's.

```go
package main

import (
	"bufio"
	"container/heap"
	"encoding/binary"
	"fmt"
	"math/rand"
	"os"
	"sort"
)

// ---- instrumentation: count the I/O the model charges for ----
type Stats struct{ runs, mergePasses, blocksRead, blocksWritten int }

const B = 4096                 // block size in bytes (the model's B)
const recBytes = 8            // one int64 key per record
const recsPerBlock = B / recBytes

// ---- run formation: quicksort full M-loads, spill each as a sorted run ----
func formRuns(in []int64, M int, st *Stats) []string {
	var files []string
	for off := 0; off < len(in); off += M {
		end := off + M
		if end > len(in) {
			end = len(in)
		}
		chunk := append([]int64(nil), in[off:end]...)
		sort.Slice(chunk, func(i, j int) bool { return chunk[i] < chunk[j] }) // quicksort load
		f, _ := os.CreateTemp("", "run-*.bin")
		w := bufio.NewWriterSize(f, B)
		buf := make([]byte, recBytes)
		for _, v := range chunk {
			binary.LittleEndian.PutUint64(buf, uint64(v))
			w.Write(buf)
		}
		w.Flush()
		f.Close()
		files = append(files, f.Name())
		st.runs++
		st.blocksWritten += (len(chunk) + recsPerBlock - 1) / recsPerBlock
	}
	return files
}

// ---- a run reader with read-ahead: refills a block-sized buffer ----
type runReader struct {
	r    *bufio.Reader
	f    *os.File
	st   *Stats
	cur  int64
	done bool
}

func openRun(name string, st *Stats) *runReader {
	f, _ := os.Open(name)
	// read-ahead buffer sized to a block: large sequential reads, prefetch-friendly
	rr := &runReader{r: bufio.NewReaderSize(f, B), f: f, st: st}
	rr.next()
	return rr
}

func (rr *runReader) next() {
	buf := make([]byte, recBytes)
	if _, err := rr.r.Read(buf); err != nil {
		rr.done = true
		rr.f.Close()
		return
	}
	rr.cur = int64(binary.LittleEndian.Uint64(buf))
	rr.st.blocksRead++ // approximate: one charge per record-read; bufio batches the real I/O
}

// ---- loser-tree stand-in: a min-heap over run heads (same selection job) ----
type headHeap []*runReader

func (h headHeap) Len() int            { return len(h) }
func (h headHeap) Less(i, j int) bool  { return h[i].cur < h[j].cur }
func (h headHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *headHeap) Push(x interface{}) { *h = append(*h, x.(*runReader)) }
func (h *headHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// ---- k-way merge of runs into one output run ----
func mergeRuns(files []string, out string, st *Stats) string {
	h := &headHeap{}
	for _, name := range files {
		rr := openRun(name, st)
		if !rr.done {
			heap.Push(h, rr)
		}
	}
	f, _ := os.Create(out)
	w := bufio.NewWriterSize(f, B)
	buf := make([]byte, recBytes)
	for h.Len() > 0 {
		top := heap.Pop(h).(*runReader)
		binary.LittleEndian.PutUint64(buf, uint64(top.cur))
		w.Write(buf)
		st.blocksWritten++ // approximate per-record; bufio batches the real block writes
		top.next()
		if !top.done {
			heap.Push(h, top)
		}
	}
	w.Flush()
	f.Close()
	for _, name := range files { // tidy temp runs
		os.Remove(name)
	}
	return out
}

// ---- cascaded merge: respect a fan-in cap, build a merge tree if needed ----
func externalSort(in []int64, M, fanIn int, st *Stats) string {
	runs := formRuns(in, M, st)
	for len(runs) > 1 {
		st.mergePasses++
		var next []string
		for i := 0; i < len(runs); i += fanIn {
			end := i + fanIn
			if end > len(runs) {
				end = len(runs)
			}
			out, _ := os.CreateTemp("", "merge-*.bin")
			out.Close()
			next = append(next, mergeRuns(runs[i:end], out.Name(), st))
		}
		runs = next
	}
	return runs[0]
}

// ---- top-N shortcut: one scan, bounded heap, NO spill ----
type maxHeap []int64

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] } // max on top
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *maxHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func topN(in []int64, N int) []int64 {
	h := &maxHeap{}
	for _, v := range in {
		if h.Len() < N {
			heap.Push(h, v)
		} else if v < (*h)[0] { // better than current worst
			(*h)[0] = v
			heap.Fix(h, 0)
		}
	}
	res := make([]int64, h.Len())
	for i := len(res) - 1; i >= 0; i-- {
		res[i] = heap.Pop(h).(int64)
	}
	return res
}

func main() {
	N := 4_000_000              // records
	in := make([]int64, N)
	for i := range in {
		in[i] = rand.Int63()
	}

	// Realistic M: memory holds, say, 500k records (~4 MB of keys).
	M := 500_000
	fanIn := 64                 // large fan-in -> aim for a single merge pass

	st := &Stats{}
	externalSort(in, M, fanIn, st)
	fmt.Printf("FULL SORT   N=%d  M=%d  fan-in=%d\n", N, M, fanIn)
	fmt.Printf("  runs formed    = %d\n", st.runs)         // ceil(N/M) = 8
	fmt.Printf("  merge passes   = %d\n", st.mergePasses)  // 1 (8 runs <= fan-in 64)
	fmt.Printf("  blocks written = %d\n", st.blocksWritten)
	fmt.Printf("  blocks read    = %d\n", st.blocksRead)

	// Top-100: one scan, no spill, no merge.
	top := topN(in, 100)
	fmt.Printf("TOP-100     smallest=%d ... 100th=%d  (one scan, zero spill)\n",
		top[0], top[99])
}
```

**What it demonstrates, and the arithmetic that matters.** With `N = 4,000,000` and `M = 500,000`, run formation produces `⌈N/M⌉ = 8` runs. With a fan-in of 64, **all 8 runs merge in a single pass** — `mergePasses = 1`. This is the realistic case: even when `M` is a small fraction of `N`, the run count is tiny and a generous fan-in collapses the merge to one pass, so the *entire* sort reads the data ~twice (once to form runs, once to merge) and writes it ~twice. To force two merge passes you would need the run count to exceed the fan-in — e.g. `N/M > 64`, i.e. `N > 64M`, meaning the input is 64× the memory. For `M` of a few hundred MB that is tens of GB before a second pass appears; the senior bound's `log_{M/B}` is, for realistic `(M, B)`, **1 or 2**. The `topN` call shows the shortcut: 100 smallest from 4M records via one scan and a 100-element heap — never sorting the other 3,999,900, the operator-level top-N that should replace most `ORDER BY ... LIMIT` sorts.

Choosing fan-in here is the central engineering knob (above): pick it as large as your per-run read-ahead buffer allows while staying sequential. At fan-in 64 with a block-sized buffer per run, 8 runs merge in one pass; the marginal value of raising fan-in further is nil until the dataset grows past 64× memory.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| `ORDER BY` / non-indexed sort larger than memory | **External merge sort**; size `work_mem` / sort area | `M` sets fan-in → pass count; usually 1–2 passes |
| `ORDER BY ... LIMIT N` | **Top-N bounded heap** (`top-N heapsort`) | One scan, no spill; `Θ(N/B)` not `Θ(sort(N))` |
| `GROUP BY` / `DISTINCT`, few groups, fit in `M` | **Hash aggregate** | One scan; no sort needed |
| `GROUP BY` / `DISTINCT`, many groups or pre-sorted input | **Sort + group aggregate** | Hash table would spill; reuse existing order |
| Large unordered equijoin, ample memory | **Hash join** | `~3(|R|+|S|)` one pass; no order needed |
| Inputs pre-sorted, or sorted output reused downstream | **Sort-merge join** | Drop a sort term; order is a reusable byproduct |
| Distributed group-by / join at scale | **Shuffle = partition + per-partition sort**; sample for balanced splitters | No global merge; sort ≡ shuffle ([`./senior.md`](./senior.md)) |
| Spill-heavy Spark/MapReduce stage | **More partitions / fix skew / raise executor memory** | Keep per-partition `N` near `M`; kill stragglers |
| Near-sorted or variable-length input | **Replacement selection** run formation | Adaptive giant runs; handles variable length |
| Random fixed-size, abundant RAM | **Quicksort full `M`-loads** | Cache-friendly; data-independent; sequential spill |
| Expensive comparator (text/collation) | **Normalized / abbreviated keys** | Cheap word compare in the common case |
| Big variable-length payloads | **Sort (key, pointer) pairs** | Move tiny sort elements; dereference at emit |
| SSD / NVMe target | **Higher fan-in, fewer passes, compress runs** | Less write amplification and wear; saturate queues |

Four rules of thumb:

1. **Assume one or two passes.** For realistic `M`, `log_{M/B}` is 1–2. Optimize the *constants* — sequential I/O, read-ahead, overlap, compression — not the pass count.
2. **Don't sort what you can select or hash.** Top-N is a bounded heap; distinct/group with few keys is a hash; the `k`-th element is selection. Full sort is the fallback, not the default.
3. **Spend the memory on fan-in, then on buffers.** Raise fan-in until reads stop being comfortably sequential; on SSD that point is much higher than on HDD.
4. **Order is a reusable asset.** Sort-merge and index order can serve a join *and* an `ORDER BY` *and* a group-by from one sort; track interesting orders the way the optimizer does.

---

## Research and System Pointers

- **Graefe, G. (1993). "Query Evaluation Techniques for Large Databases."** *ACM Computing Surveys* 25(2). The encyclopedic treatment of the database SORT operator, sort-vs-hash for grouping and joins, and external sorting inside a DBMS.
- **Graefe, G. (2006). "Implementing Sorting in Database Systems."** *ACM Computing Surveys* 38(3). The definitive practitioner's reference: run formation, fan-in vs buffer trade-offs, normalized keys, top-N, and dozens of production refinements — the single best read for this tier.
- **PostgreSQL source: `src/backend/utils/sort/tuplesort.c`.** A readable, production external sorter: in-memory quicksort, spill, bounded tape merge, top-N heapsort, and (PG10+) the move away from replacement selection. Pair with `work_mem` and `log_temp_files` docs.
- **Dean, J., & Ghemawat, S. (2004). "MapReduce: Simplified Data Processing on Large Clusters."** *OSDI.* The sort phase as the framework's core data-movement contract.
- **Apache Spark shuffle documentation and source** (`ExternalSorter`, `SortShuffleManager`, `UnsafeShuffleWriter`). Sort-based shuffle, spill files, serialized pointer-record sorting, and the unified memory manager.
- **Zaharia, M., et al. (2012). "Resilient Distributed Datasets."** *NSDI*, and the **Spark 2014 GraySort / 100 TB sort record** write-up — distributed external sort at benchmark scale.
- **Sort Benchmark (sortbenchmark.org).** TeraSort, GraySort, MinuteSort, CloudSort, JouleSort — the rules and record holders that codify sequential I/O, balanced partitions, and overlap.
- **Aggarwal, A., & Vitter, J. S. (1988). "The I/O Complexity of Sorting and Related Problems."** *CACM* 31(9). The bound whose `log_{M/B}` factor is, for production `(M, B)`, the "one-or-two passes" this file is built around.
- **Nyberg, C., et al. (1995). "AlphaSort: A Cache-Sensitive Parallel External Sort."** *VLDB Journal.* The classic that put cache behavior, key-prefix sorting, and pointer sorting at the center of fast external sorting.

---

## Key Takeaways

1. **External sort is the database SORT operator.** It backs `ORDER BY`, `GROUP BY`, `DISTINCT`, sort-merge join input, and index builds. `work_mem` (PostgreSQL) / sort area (SQL Server, Oracle) *is* the model's `M`: it sets the merge fan-in, the pass count, and whether the sort spills at all. `Sort Method: external merge Disk: …kB` and the `log_temp_files` flood are the production signals.
2. **For realistic memory, the answer is one or two passes.** The senior `log_{M/B}` factor is 1–2 for production `(M, B)`, so the game is constants — sequential I/O, read-ahead buffers, double-buffering/async overlap, run compression, early aggregation — not minimizing an already-tiny pass count.
3. **Top-N and sort-vs-hash are the highest-value operator decisions.** `ORDER BY ... LIMIT N` should be a bounded-heap top-N (one scan, no spill), never a full sort; grouping/joins choose sort vs hash by I/O cost, with sort winning when input is pre-sorted or its *order is reused downstream* (hash produces no reusable order).
4. **The big-data shuffle is a distributed external sort.** MapReduce's mandatory sort phase and Spark's sort-based shuffle (ExternalSorter spill/merge, UnsafeShuffleWriter sorting pointer-records) are partition-then-sort; the network is the outermost hierarchy level; skew that pushes a partition's `N` past `M` is the dominant failure. TeraSort/GraySort benchmark exactly this because sorting well *is* shuffling well.
5. **The SSD era shifts the math toward fewer passes and higher fan-in.** Less seek penalty allows smaller per-run buffers and bigger fan-in; write amplification and endurance add a *write-cost* reason to minimize passes; NVMe parallelism demands many in-flight I/Os — but large sequential access still wins.
6. **Keys are not integers.** Normalized/abbreviated binary keys turn expensive collated comparators into word compares; (key, pointer) sorting moves tiny elements and dereferences payloads at emit; multi-column and descending keys fold into one `memcmp`; stability is a free input-position key suffix.

---

> **See also:** [`./senior.md`](./senior.md) for the distribution-sort dual, funnelsort, the parallel-disk bound, the shuffle, and the snowplow · [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md) for the SORT operator in the optimizer, sort-merge vs hash join, and the storage-reality constants · [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md) for the bulk-loaded B-tree index build that external sort feeds
