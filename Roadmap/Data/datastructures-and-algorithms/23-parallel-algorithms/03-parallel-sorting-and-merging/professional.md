# Parallel Sorting and Merging — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Sample Sort: The Practical Multicore and Distributed Winner](#sample-sort-the-practical-multicore-and-distributed-winner)
   - [Why One Round Plus Local Sort Beats Merge Networks at Scale](#why-one-round-plus-local-sort-beats-merge-networks-at-scale)
   - [Splitter Quality and Oversampling in Practice](#splitter-quality-and-oversampling-in-practice)
3. [Multicore Library Sorts](#multicore-library-sorts)
4. [GPU Sorting: Radix Is King](#gpu-sorting-radix-is-king)
5. [Distributed and External: TeraSort and the Sort Benchmark](#distributed-and-external-terasort-and-the-sort-benchmark)
6. [Engineering Reality: Sort Is Bandwidth-Bound](#engineering-reality-sort-is-bandwidth-bound)
7. [Worked End-to-End: A Parallel Sample Sort](#worked-end-to-end-a-parallel-sample-sort)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) settles the theory: sorting is in `NC¹`, the `Θ(log n)`-span / `Θ(n log n)`-work corner is reached by AKS (astronomical constant) and Cole's pipelined merge sort (usable but rarely deployed), the `log² n` plateau is where every practical algorithm lives, and **sample sort wins distributed sorting because of its one communication round and a provable `(1+ε)` load-balance guarantee from oversampling**, not because of its span. That is the right mental model and this tier assumes it.

This tier answers the operational question: **when you actually sort a billion keys — on a multicore box, on a GPU, or across a cluster — what code runs, how do you choose, and what is load-bearing?** The honest thesis has four parts. First, at scale the binding cost is **data movement, not comparisons**: parallel sort is communication- and bandwidth-bound, so the algorithm that minimizes memory passes and network rounds wins, which is why sample sort (one all-to-all) and radix sort (a few coalesced scatter passes) dominate the span-optimal comparison sorts. Second, on a multicore CPU you almost never write a parallel sort — you call `__gnu_parallel::sort`, `tbb::parallel_sort`, `std::sort(execution::par)`, Rayon `par_sort`, or `Arrays.parallelSort` — and the professional skill is knowing the **grain-size cutoff** below which they fall back to a serial sort, and whether they are in-place or out-of-place. Third, **on GPUs radix sort is the fastest sort that exists**, built entirely out of the per-digit split (scan-then-scatter, [`../02-parallel-prefix-sum-scan/professional.md`](../02-parallel-prefix-sum-scan/professional.md)); merge-path and bitonic fill the comparison and small-fixed niches. Fourth, **distributed sorting at TB–PB scale is a sample-partition external sort with the network as one more hierarchy level** — the Sort Benchmark (TeraSort, GraySort) is exactly this, and it connects directly to [`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md).

The throughline is the senior tier's punchline made physical: **span optimality is irrelevant in production because span is not the binding cost.** Communication rounds, memory bandwidth, and load balance are, and every production sort is engineered around those three.

---

## Sample Sort: The Practical Multicore and Distributed Winner

Sample sort is the algorithm behind essentially every scalable parallel sort: MPI's `MPI_Comm`-level sample sort, Spark's `sortByKey` / `repartitionAndSortWithinPartitions`, the partitioning phase of TeraSort, and the classic Sort Benchmark winners. Its shape is the senior tier's five steps, but here we care about *why* that shape is the production winner and *how* the steps are tuned.

```text
SAMPLE-SORT(keys, p):
  1. Each worker locally sorts (or just samples) its n/p keys.
  2. Choose p−1 SPLITTERS by OVERSAMPLING: gather a sample of size s·(p−1),
       sort it, take every s-th element. (s = oversampling ratio, tens–hundreds.)
  3. Each worker partitions its keys into p buckets by the splitters,
       then sends bucket k to worker k  — ONE all-to-all exchange.
  4. Each worker locally sorts the keys it received  — its bucket.
  5. Buckets concatenated in splitter order = globally sorted output.
```

The whole algorithm is **one communication round (step 3) wrapped in two local sorts (steps 1 and 4)**. Everything else — the sample, the splitter selection — is cheap metadata work on `O(s·p) ≪ n` elements.

### Why One Round Plus Local Sort Beats Merge Networks at Scale

The senior tier proved the load balance; the production point is the *communication accounting*. On any machine where data crosses a boundary — cores sharing a memory bus, nodes sharing a network — the cost model is not "count comparisons" but **count the rounds of data movement and the total volume moved** (the BSP / LogP / MapReduce-shuffle reality). Against that model:

- **Sample sort moves the data once.** Exactly one all-to-all in step 3; each key is sent to its bucket and never moves again. Total volume `Θ(n)`, rounds `= 1`.
- **A merge network (bitonic, odd–even) moves the data `Θ(log² n)` times.** Each of the `Θ(log² n)` comparator stages is a data exchange between partners; on a network that is `Θ(log² n)` rounds of all the data. Beautiful on-chip (oblivious, branch-free, [`./senior.md`](./senior.md)); fatal off-chip.
- **A naïve parallel merge sort moves the data `Θ(log p)` times** — one exchange per level of the merge tree. Better than bitonic, still `log p` rounds versus sample sort's one, and the final merges concentrate work toward the root (poor balance).

The arithmetic that follows: a `Θ(log² n)`-round network at `n = 10¹²`, `log₂ n ≈ 40`, pays `~1600` rounds of moving the whole dataset; sample sort pays one. Even granting the network smaller per-round volume, the round count alone is decisive — every round has latency, synchronization, and the risk of a straggler. **Sample sort converts the entire sort into "shuffle once, then everybody sorts locally," and local sort is a solved, cache-tuned, embarrassingly parallel problem.** This is the same structural reason the senior tier gives — sample sort optimizes the binding cost (rounds and balance), not the irrelevant one (comparison span) — now stated in the units a cluster actually bills you for.

There is a second, subtler win: **the local sorts in steps 1 and 4 run at full single-core speed on cache-resident data.** A bucket sized `~n/p` is chosen (via partition count) to fit in cache or memory, so each worker runs a tuned sequential sort (introsort, radix) with no synchronization, no false sharing, no remote access. The expensive, coordination-heavy part is a single shuffle; the bulk compute is local and trivially parallel. That division — one global exchange, all-local compute — is why sample sort is the skeleton of every scalable sort.

### Splitter Quality and Oversampling in Practice

The one thing that can wreck sample sort is **bad splitters → skewed buckets → a straggler bucket whose local sort dominates wall-clock** (the whole sort runs at the speed of the fullest bucket). Production handling:

- **Oversample.** Draw `s·(p−1)` sample keys, sort, take every `s`-th. The senior bound says `s = Θ((1/ε²)·log n)` gives every bucket `≤ (1+ε)·n/p` w.h.p.; in practice `s` in the tens to low hundreds gets `ε ≈ 0.1` for realistic `p`. The sample sort is `O(s·p)` work — negligible.
- **Handle duplicate-heavy keys.** Oversampling assumes distinct-ish keys; a key value with massive multiplicity (a hot key in `sortByKey`) can pile into one bucket no matter where splitters fall, because all its copies share a value and cannot be split. Mitigations: detect heavy hitters and give them dedicated buckets, or *salt* the key (append a tie-breaker) so equal keys spread across buckets, then strip the salt. This is the parallel-sort instance of the shuffle-skew problem ([`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md)).
- **Range vs sampled splitters.** TeraSort historically samples the input and writes the chosen splitters to a `_partition.lst` that every mapper reads, so all workers agree on identical boundaries — a deterministic, balanced range partition. Spark's `RangePartitioner` (the engine under `sortByKey`) does the same: it samples each partition (reservoir sampling, weighted by partition size) to estimate the key distribution, then picks range boundaries. Both are the oversampling splitter step productized.
- **Splitter broadcast cost.** With `p` workers there are `p−1` splitters; every worker needs all of them to partition. This is a tiny broadcast (`O(p)`), so splitter agreement is never the bottleneck — the data shuffle is.

The professional reflex on a slow `sortByKey` or sample sort is to check **bucket-size skew first**: a single fat partition is the usual culprit, and the fix is more partitions, better sampling, or salting hot keys — not a different algorithm.

---

## Multicore Library Sorts

On a single multicore box you call a library. Each ships a parallel sort with the same skeleton — recursively split work, sort pieces in parallel, **fall back to a tuned serial sort below a grain-size cutoff** — but they differ in algorithm, stability, and memory cost. Knowing these differences is the professional content.

| Library / call | Algorithm | Stable? | In-place? | Notes |
|---|---|---|---|---|
| **libstdc++ `__gnu_parallel::sort`** | multiway mergesort (default) **or** parallel quicksort/balanced quicksort (selectable) | mergesort variant stable | mergesort needs `O(n)` scratch; quicksort in-place | GNU "parallel mode"; tag dispatch picks the strategy |
| **Intel TBB `tbb::parallel_sort`** | parallel quicksort (work-stealing) | **not** stable | in-place | splits ranges, steals tasks; serial cutoff to `std::sort` |
| **C++17 `std::sort(std::execution::par)`** | implementation-defined (often TBB/PPL-backed) | **not** stable | typically in-place | `stable_sort(par)` for stability; needs a parallel backend linked |
| **Rust Rayon `par_sort` / `par_sort_unstable`** | parallel merge sort / parallel quicksort (pattern-defeating) | `par_sort` stable, `_unstable` not | stable needs scratch; unstable in-place | `_unstable` is faster and the usual choice |
| **Java `Arrays.parallelSort`** | parallel merge sort (fork/join) | **stable** | needs `O(n)` working array | falls back to `Arrays.sort` below `MIN_ARRAY_SORT_GRAN` (8192) |

Three engineering realities cut across all of them:

- **The grain-size cutoff is the dominant tuning knob.** Below some threshold (`Arrays.parallelSort`'s `8192`, TBB's task-grain heuristic, Rayon's block size), a parallel sort *is slower than a serial sort* because task spawning, work-stealing, and merge-buffer allocation cost more than they save. So every library recurses in parallel only until a subrange falls under the cutoff, then runs an optimized sequential sort (introsort / TimSort / pattern-defeating quicksort) on it. **For small `n` you should not parallelize at all** — the launch and coordination overhead dwarfs the sort. The cutoff is where the libraries encode this; if you roll your own, the single most important parameter is that threshold.
- **In-place vs out-of-place is a real memory cost.** Parallel *merge* sorts (libstdc++ multiway-merge, `Arrays.parallelSort`, Rayon stable `par_sort`) need an `O(n)` auxiliary buffer — sorting 8 GB of data needs ~16 GB resident. Parallel *quicksorts* (TBB, Rayon `par_sort_unstable`) are in-place (`O(log n)` stack). When memory is tight or `n` is huge, prefer the in-place unstable variant; when stability is required, pay for the buffer.
- **Stability is not free and not uniform.** `Arrays.parallelSort` and Rayon `par_sort` are stable (parallel merge sort preserves order); `tbb::parallel_sort`, `std::sort(par)`, and the `_unstable` variants are not. If your keys carry an implicit "first-seen wins" semantics (e.g. a secondary sort), you must pick a stable parallel sort or encode the original index as a tie-breaker into the key — the same normalization trick used in external sort.

The practical rule: **call the library, pick the variant by your stability and memory constraints, and trust its grain-size cutoff — but verify the parallel backend is actually linked** (`std::execution::par` silently runs serially if no parallel backend, e.g. TBB, is present; libstdc++ parallel mode needs `-fopenmp` and the right include).

---

## GPU Sorting: Radix Is King

On a GPU, the fastest sort that exists is **radix sort**, and it is fast because it is built entirely from the per-digit split — a counting histogram, a scan of the histogram, and a scatter — all of which are coalesced, branch-free, and bandwidth-saturating. The scan that turns per-bucket counts into global write offsets is the load-bearing primitive ([`../02-parallel-prefix-sum-scan/professional.md`](../02-parallel-prefix-sum-scan/professional.md)).

```text
GPU RADIX SORT (LSD, one pass per digit; digit = b bits, radix R = 2^b):
  for each digit position from least- to most-significant:
    1. Each tile computes a HISTOGRAM of its keys' digit values (R buckets).
    2. SCAN the histograms across buckets AND across tiles  → for every
         (tile, bucket) the global offset where its keys begin.       # scan-then-scatter
    3. SCATTER each key to global_offset[bucket] + rank-within-tile-bucket.
    (stable per digit ⟹ sorting LSD-first sorts the whole key)
```

- **CUB `DeviceRadixSort` / Thrust `sort`.** `cub::DeviceRadixSort::SortKeys` (and `SortPairs` for key-value) is the reference fastest GPU sort; `thrust::sort` dispatches to it for primitive keys. They process several bits per pass (commonly 4–8), use decoupled-look-back scans for the offset computation, and reach near-peak DRAM bandwidth — `2³⁰` 32-bit keys sort in single-digit milliseconds on a modern GPU. This is *the* default for any sortable-key type.
- **Merge sort (merge-path) for comparison / custom keys.** When keys are not radix-decomposable (custom comparators, large/variable keys, structs), radix does not apply and you use a parallel **merge sort** whose merge step is partitioned by **merge-path** (Green–McColl–Bader): the diagonal of the merge matrix is cut into `p` equal-work segments so every thread merges an independent, equal-sized slice with no contention. `thrust::sort` with a custom comparator, CUB's merge sort, and ModernGPU's `mergesort` use this. Slower than radix but general.
- **Bitonic for small / fixed sizes.** Batcher's bitonic network is the right tool for *small or fixed-size* sorts — sorting within a warp or block, sorting short fixed-length arrays, or as the per-tile sort inside a larger sort. Its value on a GPU is exactly the senior-tier obliviousness: a fixed, data-independent compare-exchange schedule means **no branch divergence** (every lane runs the same instructions), and its power-of-two strides map onto coalesced/shared-memory access. Oblivious networks "fit SIMT" because SIMT punishes divergence and rewards uniform control flow — bitonic has neither branch nor data-dependent step. The cost (`Θ(n log² n)` work) is irrelevant at the small `n` where it is used.

The decision on a GPU is mechanical: **radix if the key is radix-sortable (it almost always is — ints, floats via bit-twiddling, fixed strings), merge-path if you need a comparator, bitonic for tiny or fixed sizes or as a building block.** Reach for `cub::DeviceRadixSort` / `thrust::sort` first; you will rarely beat them.

---

## Distributed and External: TeraSort and the Sort Benchmark

At TB–PB scale, parallel sort *is* distributed external sort, and the canonical macro-benchmark is the **Sort Benchmark** (sortbenchmark.org): TeraSort, GraySort (sorting 100 TB), MinuteSort, CloudSort. A system that sorts well shuffles well, which is why these benchmarks are the reference for data-engine throughput.

The structure of every large-scale sort is identical, and it is sample sort with the network and disk as outer hierarchy levels:

```text
DISTRIBUTED SORT (TeraSort shape):
  1. SAMPLE the input across all nodes; choose p−1 range splitters
       (oversampled, written to a shared partition list all nodes read).
  2. PARTITION: each node routes each record to the node owning its key range
       — ONE all-to-all over the NETWORK (the shuffle).
  3. LOCAL EXTERNAL SORT: each node sorts its received partition; if it
       exceeds RAM, this is itself an external merge sort to local disk
       ([`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md)).
  4. Output: concatenate node outputs in splitter order = globally sorted.
```

- **MapReduce's sort-shuffle.** Hadoop MapReduce has a *mandatory* sort between map and reduce: mappers partition (hash of key) and sort their output, spill sorted runs, and merge them; reducers fetch their partition from every mapper over the network and merge the sorted streams. "Reduce sees keys in sorted order" is precisely the output contract of a distributed external sort; TeraSort is essentially the identity reduce over this machinery with a *range* partitioner substituted for the hash partitioner (so the global output is sorted, not just per-reducer).
- **The network as a hierarchy level.** The external-sort memory hierarchy (CPU cache → RAM → local disk) gains one more, slowest level: the network between nodes. The same discipline applies — **sequential, large, balanced transfers; one pass over the slowest level.** Step 2's shuffle is the one network pass; step 3's local sort spills sequentially to local disk. The whole design is "minimize traffic over each successively slower level, and traverse the slowest level exactly once."
- **What the record-holders optimize** is exactly the four things this tier keeps returning to: (1) **sequential I/O end to end** — read, shuffle, spill, write as large streams, never random; (2) **balanced partitions** — sample to pick range splitters so every node gets a near-equal share, because one fat partition is a straggler that caps throughput; (3) **overlap** — pipeline read, sort, network, and write so disk, CPU, and NIC are all busy at once; (4) **one pass over the network** — enough partitions/memory that the shuffle is a single distribute-then-merge, not a cascaded re-shuffle. Spark's 2014 100 TB GraySort record and Hadoop's earlier TeraSort runs are these four levers tuned to the metal.

The connection to external sorting is not an analogy — it is the same algorithm. Distributed sort = sample-partition (the distribution-sort step) + per-node external merge sort (the I/O-model step). See [`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md) for the local-node sort the cluster sort sits on top of.

---

## Engineering Reality: Sort Is Bandwidth-Bound

Every choice above follows from one fact, the same one that governs scan: a sort does `Θ(n log n)` *cheap* comparisons but `Θ(n)`-to-`Θ(n log n)` *data movement*, and on real machines the movement dominates. **Parallel sort is communication- and bandwidth-bound, not compute-bound.**

- **Data movement dominates.** A comparison is one cheap instruction; moving a key (or a record) across a cache line, a memory bus, or a network link costs orders of magnitude more and is the binding resource. This is why radix sort (which never compares, only counts and scatters) beats comparison sorts on a GPU, why sample sort (one shuffle) beats merge networks (`log² n` shuffles) on a cluster, and why the Sort Benchmark is won on I/O engineering, not algorithmic span. Report **achieved bandwidth as a fraction of peak** (DRAM, PCIe, or network), not comparisons/sec.
- **Load balance is the whole game in sample sort.** Skewed keys → an oversized bucket → a straggler whose local sort sets the wall-clock. Splitter quality (via oversampling) and heavy-hitter handling (dedicated buckets, salting) are how you keep every worker's share near `n/p`. The slowest worker, not the average, determines completion.
- **Stability and key normalization are per-record costs.** Records are not bare integers: comparators on multi-column / collated / variable-length keys can dominate CPU. The production fixes (normalized byte-comparable keys so `memcmp` orders them, abbreviated-key prefixes, sorting `(key, pointer)` pairs to move tiny elements) carry straight over from external sort. For stability, append the input index as a low-order key suffix — making any sort stable for the cost of a slightly wider key.
- **When NOT to parallelize.** For small `n`, a serial sort wins outright — the grain-size cutoff exists precisely because thread spawning, work-stealing, merge-buffer allocation, or a GPU launch + host↔device transfer all cost more than sorting a few thousand elements. Sort small inputs serially, in place, where the data already lives. The professional default is "serial below the cutoff, parallel above it, and the cutoff is a tuned constant (thousands), not a guess."
- **Memory: in-place vs out-of-place.** Parallel merge sorts buy stability and predictable balance at an `O(n)` scratch buffer; parallel quicksorts are in-place but unstable and can degrade on adversarial inputs (mitigated by pattern-defeating / introsort fallbacks). Choose by your memory budget and stability requirement, not by reflex.

The single most useful diagnostic when a parallel sort underperforms is to ask *which level of the hierarchy is saturated*: cores (rare — sort is not compute-bound), memory bandwidth (CPU sort of large data), PCIe/DRAM (GPU sort), or the network (distributed sort). The bottleneck is almost always the slowest data path, and the fix is fewer/larger/more-balanced transfers over it.

---

## Worked End-to-End: A Parallel Sample Sort

Here is a self-contained Go program implementing **sample sort** on a multicore CPU — sample splitters by oversampling, partition into `p` buckets, sort the buckets in parallel — measured against `sort.Slice`. It shows the splitter/load-balance mechanism and the grain-size cutoff, and it is honest about the bandwidth-bound speedup (modest, not `P×`).

```go
package main

import (
	"fmt"
	"math/rand"
	"runtime"
	"sort"
	"sync"
	"time"
)

// ---- Serial baseline. ----
func sortSerial(a []int64) {
	sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
}

// ---- Choose p-1 splitters by OVERSAMPLING. ----
// Draw s*(p-1) random samples, sort them, take every s-th element.
// Larger s -> splitters track the true quantiles -> tighter buckets.
func chooseSplitters(a []int64, p, s int) []int64 {
	if p <= 1 {
		return nil
	}
	m := s * (p - 1)
	sample := make([]int64, m)
	for i := range sample {
		sample[i] = a[rand.Intn(len(a))]
	}
	sort.Slice(sample, func(i, j int) bool { return sample[i] < sample[j] })
	sp := make([]int64, p-1)
	for k := 1; k < p; k++ {
		sp[k-1] = sample[k*s-1] // every s-th sample is a splitter
	}
	return sp
}

// bucketOf: index of the bucket a key falls into (binary search over splitters).
func bucketOf(splitters []int64, v int64) int {
	return sort.Search(len(splitters), func(i int) bool { return splitters[i] >= v })
}

// ---- Sample sort: splitters -> partition into p buckets -> sort buckets in parallel. ----
const parallelCutoff = 1 << 13 // grain size: below this, just sort serially.

func sampleSort(a []int64, p, s int) {
	n := len(a)
	if n <= parallelCutoff || p <= 1 {
		sortSerial(a) // serial below the cutoff: parallelism would lose to overhead
		return
	}
	splitters := chooseSplitters(a, p, s)

	// PASS 1 (parallel): each chunk counts how many of its keys fall in each bucket.
	chunk := (n + p - 1) / p
	counts := make([][]int, p) // counts[c][b] = keys in chunk c destined for bucket b
	var wg sync.WaitGroup
	for c := 0; c < p; c++ {
		wg.Add(1)
		go func(c int) {
			defer wg.Done()
			cnt := make([]int, p)
			for i := c * chunk; i < (c+1)*chunk && i < n; i++ {
				cnt[bucketOf(splitters, a[i])]++
			}
			counts[c] = cnt
		}(c)
	}
	wg.Wait()

	// Prefix-sum the per-(chunk,bucket) counts into exact write offsets (the "scan").
	bucketStart := make([]int, p+1) // global start index of each bucket in the output
	for b := 0; b < p; b++ {
		for c := 0; c < p; c++ {
			bucketStart[b+1] += counts[c][b]
		}
	}
	for b := 1; b <= p; b++ {
		bucketStart[b] += bucketStart[b-1]
	}
	// Per-(chunk,bucket) starting offset, scanned in (bucket, chunk) order.
	off := make([][]int, p)
	for c := range off {
		off[c] = make([]int, p)
	}
	for b := 0; b < p; b++ {
		acc := bucketStart[b]
		for c := 0; c < p; c++ {
			off[c][b] = acc
			acc += counts[c][b]
		}
	}

	// PASS 2 (parallel): scatter each key to its conflict-free destination.
	out := make([]int64, n)
	for c := 0; c < p; c++ {
		wg.Add(1)
		go func(c int) {
			defer wg.Done()
			cur := append([]int(nil), off[c]...) // private cursors, no contention
			for i := c * chunk; i < (c+1)*chunk && i < n; i++ {
				b := bucketOf(splitters, a[i])
				out[cur[b]] = a[i]
				cur[b]++
			}
		}(c)
	}
	wg.Wait()

	// PASS 3 (parallel): sort each bucket in place. Buckets are disjoint ranges.
	for b := 0; b < p; b++ {
		wg.Add(1)
		go func(b int) {
			defer wg.Done()
			sortSerial(out[bucketStart[b]:bucketStart[b+1]])
		}(b)
	}
	wg.Wait()
	copy(a, out)
}

func main() {
	const n = 1 << 25 // ~33M int64 = 256 MB: well past cache, DRAM-bound
	base := make([]int64, n)
	for i := range base {
		base[i] = rand.Int63()
	}
	p := runtime.NumCPU()
	const s = 64 // oversampling ratio

	timeIt := func(f func()) time.Duration {
		t := time.Now()
		f()
		return time.Since(t)
	}

	a1 := append([]int64(nil), base...)
	ts := timeIt(func() { sortSerial(a1) })
	fmt.Printf("serial sort.Slice: %v\n", ts)

	a2 := append([]int64(nil), base...)
	tp := timeIt(func() { sampleSort(a2, p, s) })
	fmt.Printf("sample sort:       %v  (P=%d, s=%d)  speedup=%.2fx\n",
		tp, p, s, float64(ts)/float64(tp))

	// Correctness + a peek at load balance.
	ok := sort.SliceIsSorted(a2, func(i, j int) bool { return a2[i] < a2[j] })
	fmt.Printf("sorted=%v\n", ok)
}
```

**What the run demonstrates (numbers are machine-specific):**

1. **The three phases are sample sort's whole structure.** `chooseSplitters` oversamples (`s·(p−1)` draws, every `s`-th is a splitter); pass 1 + the prefix sums compute each key's exact destination (the scan that converts per-bucket counts to write offsets — the same scan-then-scatter as radix sort); pass 2 scatters into disjoint, conflict-free bucket ranges with private cursors (no locks, no atomics); pass 3 sorts each bucket in parallel. That is steps 2–4 of the distributed algorithm mapped onto cores instead of nodes.
2. **The splitter / load-balance mechanism is visible.** With oversampling ratio `s = 64`, the splitters track the quantiles closely, so the `p` buckets come out near-equal and pass 3's parallel bucket sorts finish together. Drop `s` to `1` (no oversampling) and you would see bucket-size skew and a straggler bucket that lengthens pass 3 — the load-balance failure the senior tier's Chernoff bound rules out at high `s`.
3. **The cutoff matters.** `parallelCutoff` makes the function sort serially for small `n`; without it, sorting a few thousand elements would spawn goroutines and allocate buckets for nothing and lose to `sort.Slice`. This is the grain-size cutoff every library encodes.
4. **The speedup is modest, and that is honest.** Sorting 256 MB is bandwidth-bound: passes 1–2 stream the whole array twice through DRAM doing almost no arithmetic, so on a typical server the parallel version saturates the memory bus at a handful of cores and tops out at single-digit speedup — *not* `P×`. This is the engineering reality made measurable: parallel sort is limited by memory passes, not cores. A real library fuses the count and scatter and tunes bucket sizes to cache; the exercise shows the mechanism.

In production you would call `Arrays.parallelSort`, `tbb::parallel_sort`, Rayon `par_sort_unstable`, or `thrust::sort` — all ship a tuned, fused version of exactly this skeleton.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Distributed / multi-node / big-data sort | **Sample sort** (Spark `sortByKey`, MPI sample sort, TeraSort) | one all-to-all round + local sort; provable `(1+ε)` balance via oversampling |
| Multicore CPU, comparison keys, need stability | **`Arrays.parallelSort` / Rayon `par_sort` / `stable_sort(par)`** | parallel merge sort, stable; pay the `O(n)` scratch buffer |
| Multicore CPU, comparison keys, memory-tight | **`tbb::parallel_sort` / Rayon `par_sort_unstable`** | in-place parallel quicksort; faster, unstable |
| GPU, radix-sortable keys (ints, floats, fixed strings) | **`cub::DeviceRadixSort` / `thrust::sort`** | the fastest sort that exists; per-digit split, near-peak bandwidth |
| GPU, custom comparator / large keys | **Merge sort with merge-path** (`thrust::sort` + comparator) | general comparison sort; equal-work diagonal partition |
| GPU, small or fixed-size, or a sort building block | **Bitonic network** | oblivious → no branch divergence, coalesced strides; fits SIMT |
| TB–PB scale on a cluster | **Sample-partition + per-node external sort** | network = outer hierarchy level; one shuffle + local external merge |
| Small `n` (thousands or fewer) | **Serial sort below the grain-size cutoff** | thread/launch/transfer overhead dwarfs the sort; never parallelize |
| Skewed / duplicate-heavy keys | **Oversample harder; dedicate buckets or salt hot keys** | avoid the straggler bucket that caps wall-clock |
| Need bit-stable order across runs | **Stable parallel sort, or index-suffix the key** | parallel merge sort is stable; tie-break by input position |
| Span-optimal `O(log n)` is "needed" | **You almost never need it; use the plateau** | span is not the binding cost — communication/bandwidth is ([`./senior.md`](./senior.md)) |

Four rules of thumb:

1. **At scale, sample sort or radix sort — not a span-optimal comparison sort.** Sample sort wins distributed because of one communication round and a balance guarantee; radix wins on GPUs because it is comparison-free scan-then-scatter. Both minimize the binding cost (data movement), which is the whole game.
2. **Call the library; choose the variant by stability and memory.** `__gnu_parallel::sort`, `tbb::parallel_sort`, `std::sort(par)`, Rayon `par_sort[_unstable]`, `Arrays.parallelSort`, `cub`/`thrust` are tuned. Pick stable-vs-unstable and in-place-vs-buffered deliberately, and confirm the parallel backend is linked.
3. **The grain-size cutoff is the load-bearing knob, and small `n` should run serially.** Parallelism below the cutoff loses to overhead; the cutoff (thousands of elements) is a tuned constant, not a guess.
4. **You are minimizing data movement, not comparisons.** Report achieved bandwidth (DRAM / PCIe / network) as a fraction of peak; fix the saturated hierarchy level with fewer, larger, more-balanced transfers; guard splitter quality so no bucket becomes a straggler.

---

## Research and System Pointers

- **Blelloch, G. E., Leiserson, C. E., Maggs, B. M., Plaxton, C. G., Smith, S. J., & Zagha, M. (1991).** "A Comparison of Sorting Algorithms for the Connection Machine CM-2." *SPAA.* The empirical case that sample sort and radix sort beat bitonic at scale, with the load-balance analysis — the foundation of the "plateau wins" stance.
- **Frazer, W. D., & McKellar, A. C. (1970).** "Samplesort: A Sampling Approach to Minimal Storage Tree Sorting." *JACM.* The original sample sort and the oversampling idea this tier productizes.
- **Batcher, K. E. (1968).** "Sorting Networks and Their Applications." *AFIPS.* Bitonic and odd–even merge — the oblivious `Θ(log² n)` networks that survive on GPUs/SIMD for small/fixed sizes.
- **Cole, R. (1988).** "Parallel Merge Sort." *SIAM J. Computing* 17(4). The span-optimal `O(log n)` comparison sort — the theory this tier deliberately does *not* deploy, because span is not the binding cost.
- **Satish, N., Harris, M., & Garland, M. (2009).** "Designing Efficient Sorting Algorithms for Manycore GPUs." *IPDPS.* The radix-sort-via-scan split that underlies fast GPU sorts (CUB/Thrust).
- **Merrill, D., & Garland, M. (2016).** "Single-pass Parallel Prefix Scan with Decoupled Look-back." NVIDIA. The scan inside CUB's radix-sort offset computation; see [`../02-parallel-prefix-sum-scan/professional.md`](../02-parallel-prefix-sum-scan/professional.md).
- **Green, O., McColl, R., & Bader, D. A. (2012).** "GPU Merge Path — A GPU Merging Algorithm." *ICS.* The equal-work merge-path partition behind GPU comparison merge sort.
- **CUB / Thrust / ModernGPU documentation.** `cub::DeviceRadixSort`, `thrust::sort`, `mgpu::mergesort` — the production GPU sort implementations and the reference for digit width, tile sizing, and merge-path tuning.
- **Dean, J., & Ghemawat, S. (2004). "MapReduce."** *OSDI*; **TeraSort / GraySort** at sortbenchmark.org; **Spark 2014 100 TB GraySort record.** Distributed external sort at benchmark scale — sample-partition + per-node external sort, network as the outer hierarchy level.
- **Standard-library parallel sorts.** libstdc++ `__gnu_parallel::sort` (multiway mergesort / quicksort), Intel TBB `tbb::parallel_sort`, C++17 `<execution>` `std::sort`/`stable_sort`, Rust Rayon `par_sort`/`par_sort_unstable`, Java `Arrays.parallelSort` — the multicore sorts you actually call, with their stability, memory, and grain-size behavior.

---

## Key Takeaways

1. **Sample sort is the practical multicore/distributed winner because it minimizes data movement, not span.** One all-to-all round wrapped in two local sorts, with a provable `(1+ε)` load balance from oversampling, beats `Θ(log² n)`-round merge networks decisively off-chip. It is the skeleton of MPI sample sort, Spark `sortByKey`/`repartitionAndSortWithinPartitions`, TeraSort, and the Sort Benchmark winners — the expensive part is one shuffle, the bulk compute is local, cache-resident, and embarrassingly parallel.
2. **On multicore CPUs you call a library, and the variant matters.** `__gnu_parallel::sort` (multiway mergesort/quicksort), `tbb::parallel_sort` (in-place unstable quicksort), `std::sort(par)`, Rayon `par_sort`/`par_sort_unstable`, and `Arrays.parallelSort` (stable, `O(n)` buffer) differ in stability and memory; all share a **grain-size cutoff** below which they sort serially. Choose by stability and memory budget; verify the parallel backend is linked.
3. **On GPUs, radix sort is king.** Built from the per-digit split (histogram → scan → scatter, comparison-free, coalesced), `cub::DeviceRadixSort`/`thrust::sort` are the fastest sort that exists. Merge-path merge sort handles custom comparators; bitonic handles small/fixed sizes because oblivious networks fit SIMT (no branch divergence). Reach for radix first.
4. **Distributed/external sort is sample-partition + per-node external sort, with the network as one more hierarchy level.** MapReduce's sort-shuffle and TeraSort/GraySort are exactly this; the record-holders optimize sequential I/O, balanced partitions, overlap, and one network pass — the same external-sort discipline ([`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md)).
5. **Parallel sort is communication/bandwidth-bound — engineer the data movement.** Data movement dominates comparisons, so report achieved bandwidth, guard splitter quality and load balance against skewed/duplicate keys (oversample, salt hot keys), handle stability and key normalization as per-record costs, and **do not parallelize small `n`** — serial below the grain-size cutoff is the honest default.

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier deploys — `NC¹`, AKS/Cole optimality, the 0–1 principle, and the sample-sort oversampling/load-balance proof · [`../02-parallel-prefix-sum-scan/professional.md`](../02-parallel-prefix-sum-scan/professional.md) for the scan that powers the radix-sort per-digit split and the sample-sort offset computation · [`../../24-external-memory-and-cache-aware/03-external-sorting/professional.md`](../../24-external-memory-and-cache-aware/03-external-sorting/professional.md) for the per-node external merge sort that distributed sort sits on top of
