# Parallel Prefix Sum (Scan) — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [GPU Scan: The Canonical High-Performance Primitive](#gpu-scan-the-canonical-high-performance-primitive)
   - [The Three-Level Pattern](#the-three-level-pattern)
   - [Bank-Conflict-Free Shared-Memory Blelloch](#bank-conflict-free-shared-memory-blelloch)
   - [Warp-Level Scan with Shuffle Intrinsics](#warp-level-scan-with-shuffle-intrinsics)
   - [Decoupled Look-Back: The Single-Pass Scan](#decoupled-look-back-the-single-pass-scan)
   - [Libraries and Why Scan Is THE Benchmark](#libraries-and-why-scan-is-the-benchmark)
3. [Scan as a Library Primitive in Data-Parallel Frameworks](#scan-as-a-library-primitive-in-data-parallel-frameworks)
4. [The Killer Applications](#the-killer-applications)
   - [Stream Compaction / Parallel Filter](#stream-compaction--parallel-filter)
   - [Radix Sort via Per-Digit Split](#radix-sort-via-per-digit-split)
   - [Histogram Offsets, CSR, Parsing, Variable-Length Output](#histogram-offsets-csr-parsing-variable-length-output)
5. [Performance Engineering: Scan Is Bandwidth-Bound](#performance-engineering-scan-is-bandwidth-bound)
6. [Numerical Care: Non-Associativity, Compensation, Overflow](#numerical-care-non-associativity-compensation-overflow)
7. [Worked End-to-End: A Stream-Compaction Pipeline](#worked-end-to-end-a-stream-compaction-pipeline)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: scan is the cheapest non-trivial dependency the parallel model allows, it is the *same* `NC¹` object as the carry chain of a binary adder, the named prefix networks (Kogge–Stone, Brent–Kung, Sklansky, Ladner–Fischer) sit on a provably-continuous depth–size frontier, segmented scan dissolves ragged data into one flat pass, and *any* first-order linear recurrence is a scan over the affine monoid. That is the right mental model, and this tier assumes it.

This tier answers a different question: **how is scan actually implemented in the systems that run it billions of times a second, and what do you do when you reach for it in production?** The honest thesis has three parts. First, scan is *the* benchmark primitive on GPUs — not because the arithmetic is hard (it is `n−1` additions) but because it is the hardest *easy* primitive to make bandwidth-optimal, and the techniques that win it (bank-conflict-free shared memory, warp shuffles, single-pass decoupled look-back) are the techniques that win every memory-bound kernel. Second, in real code you almost never write a scan; you *call* one — `cub::DeviceScan`, `thrust::inclusive_scan`, `std::inclusive_scan`, Rayon's `par_iter().scan`, `jax.lax.associative_scan` — and the professional skill is knowing *when the library parallelizes versus silently falls back to serial*. Third, scan's value is almost never the prefix array itself; it is **scan-then-scatter** — scan computes, in parallel, *where each element must go*, and a scatter moves it. Stream compaction, radix sort, CSR SpMV, and variable-length output allocation are all that one pattern.

The throughline of every section below is the senior tier's punchline made physical: **scan has essentially zero arithmetic intensity, so the only number that matters is how close you get to peak memory bandwidth.** Every production technique is a way to *touch memory fewer times*.

---

## GPU Scan: The Canonical High-Performance Primitive

The senior tier sketched the GPU mapping; here is the full engineering. A grid-wide scan over millions of elements must respect three hardware tiers — **warp** (32 lanes in lockstep), **block** (a few hundred threads sharing fast on-chip *shared memory*), and **grid** (thousands of blocks over device DRAM) — and the algorithm is a decomposition onto exactly those tiers.

### The Three-Level Pattern

The classical (multi-pass) GPU scan is the senior tier's blocked recipe pinned to the hardware:

```text
DEVICE-SCAN(x[0..n-1], +):

  # Level 1 — per-block scan in SHARED memory (one block per tile)
  Each block loads its tile of T elements into shared memory,
    runs a bank-conflict-free Blelloch up-sweep/down-sweep scan,
    writes the scanned tile back to global, and
    records the tile TOTAL in block_sums[blockIdx] in global memory.

  # Level 2 — scan the block sums (a second kernel, or recursion)
  block_offsets = EXCLUSIVE-SCAN(block_sums)        # B values, B = #blocks

  # Level 3 — add the per-block offset back (one kernel, fully parallel)
  Each block adds block_offsets[blockIdx] to every element of its scanned tile.
```

Level 1 and level 3 are embarrassingly parallel and communication-free; level 2 operates on only `B` block totals and recurses if `B` is itself large. The cost is the giveaway: this design **reads the input data roughly twice and writes it twice** (`~4n` global traffic) because level 1 writes scanned tiles that level 3 must re-read and rewrite. That `4n` versus the `2n` lower bound is exactly the slack the single-pass scan below recovers — and the reason it matters is that scan is bandwidth-bound, so a `2×` reduction in memory passes is very nearly a `2×` speedup.

### Bank-Conflict-Free Shared-Memory Blelloch

The per-block scan is Blelloch's work-efficient up-sweep/down-sweep (Brent–Kung) in shared memory — but the naïve version is crippled by **shared-memory bank conflicts**. Shared memory is divided into 32 banks; if `k` threads of a warp address the same bank in one instruction, those accesses *serialize* `k`-fold. Blelloch's sweeps use stride-`2ᵗ` access patterns (`a[2ᵗ(2j+2)−1] += a[2ᵗ(2j+1)−1]`), and at large strides every active thread lands on the same few banks — up to a 16- or 32-way conflict, silently throwing away most of the shared-memory bandwidth.

The standard fix (Harris–Sengupta–Owens, *GPU Gems 3* ch. 39) is a pure addressing trick: add a padding offset to every shared-memory index so consecutive logical elements straddle bank boundaries.

```text
#define LOG_NUM_BANKS 5                                   // 32 banks
#define CONFLICT_FREE_OFFSET(i)  ((i) >> LOG_NUM_BANKS)   // one pad word per 32

// every shared-memory access becomes:
ai = i + CONFLICT_FREE_OFFSET(i);                          // padded index
temp[ai] = ...                                             // spread across banks
```

This costs a little extra shared memory (one pad word per 32 elements) and recovers the theoretical `O(n)`-work, `O(log n)`-depth profile on real silicon. It is the canonical example of the senior-tier slogan — *every GPU optimization re-prices a cost the PRAM ignored* — here, the PRAM's "free shared memory" is false because the hardware has banks.

### Warp-Level Scan with Shuffle Intrinsics

Below the block, a 32-element scan should never touch shared memory at all. Threads within a warp execute in lockstep and can exchange registers directly via **shuffle intrinsics** (`__shfl_up_sync` on NVIDIA), giving a Kogge–Stone (step-doubling) scan in `log₂ 32 = 5` register-to-register steps with no shared memory and no barriers:

```text
// inclusive warp scan of `val`, lane = threadIdx.x & 31
for (int d = 1; d < 32; d <<= 1) {
    T up = __shfl_up_sync(0xffffffff, val, d);   // value from lane (lane - d)
    if (lane >= d) val += up;                     // masked: low lanes unaffected
}
// now val holds the inclusive prefix within the warp
```

This is precisely the senior tier's observation that Kogge–Stone's "minimum-depth but work-inflated" profile is *correct* at warp scale: 32 elements is too small for the `Θ(n log n)`-work penalty to matter, and the bounded fan-out and zero shared-memory traffic make it the fastest possible primitive. Modern block scans are built bottom-up from it: **warp scan → combine warp totals in shared memory → add warp offsets back**, the three-level pattern recursing one tier down.

### Decoupled Look-Back: The Single-Pass Scan

The decisive modern advance is **decoupled look-back** (Merrill & Garland 2016, the algorithm inside CUB), which collapses the three-level multi-pass scan into a *single sweep* over the data, hitting the `2n` bandwidth floor.

The classical design's waste is the separate level-2 pass: blocks compute their totals, a second kernel scans those totals, and a third pass adds offsets back — re-reading the data. Decoupled look-back fuses this by having blocks communicate their prefixes laterally, *without a global barrier*:

```text
Each block b, in one pass:
  1. Compute its local scan and local total (aggregate) in shared memory.
  2. Publish a "status flag" + value to a global descriptor for block b:
        AGGREGATE  — "my own total is ready" (published immediately)
        PREFIX     — "my inclusive prefix (incl. all predecessors) is ready"
  3. LOOK BACK over predecessors b-1, b-2, ... :
        - if predecessor has PREFIX ready: add it, STOP (it summarizes all earlier blocks)
        - if predecessor has only AGGREGATE: add it, keep walking further back
        - if predecessor not ready yet: spin briefly (decoupled — no global sync)
  4. exclusive_prefix = sum of looked-back values; publish own PREFIX = prefix + aggregate.
  5. Add exclusive_prefix to every local element and write out.
```

The cleverness is the **AGGREGATE/PREFIX distinction**: a block does not have to wait for the *complete* prefix of every predecessor; the moment it finds *one* predecessor whose full PREFIX is ready, that single value summarizes everything before it, and the look-back stops. Blocks proceed without a barrier — execution is "decoupled" — so the scan is a single read and single write of the data (`2n` traffic, the floor), typically within a few percent of the device's peak `copy` bandwidth. This is why, on modern GPUs, a well-tuned scan runs at nearly the same speed as a `memcpy`: arithmetically that is what it is.

### Libraries and Why Scan Is THE Benchmark

In production you call a library, not a kernel:

| Library | Call | What it ships |
|---|---|---|
| **CUB** | `cub::DeviceScan::ExclusiveSum` / `InclusiveScan` | decoupled look-back, warp-tuned, near-bandwidth — the reference |
| **Thrust** | `thrust::inclusive_scan` / `exclusive_scan` | high-level wrapper over CUB device scan |
| **ModernGPU** | `mgpu::scan` | the tiled "scan-then-spine" formulation, a teaching-grade fast scan |
| **rocPRIM / hipCUB** | `rocprim::inclusive_scan` | AMD's CUB-equivalent |

Scan is *the* benchmark primitive on GPUs for a specific reason: it is the simplest kernel whose naïve implementation is far from optimal. A `map` or a `copy` is trivially bandwidth-bound and any beginner hits peak; a `reduce` is nearly as easy. Scan has a genuine *cross-block dependency* — every output depends on all earlier inputs — so making it single-pass and barrier-free (decoupled look-back) is a real systems achievement, and the same skills (lockstep warps, bank-free layout, lateral communication without global sync) are what every other irregular primitive needs. If your scan hits bandwidth, your hardware and toolchain are healthy; it is the canary.

---

## Scan as a Library Primitive in Data-Parallel Frameworks

The practitioner reality on CPUs and in numeric frameworks is the same: you call a scan, and your job is to know *whether it actually parallelizes*.

- **C++17 `std::inclusive_scan` / `std::exclusive_scan`.** With an execution policy (`std::execution::par` or `par_unseq`) these are the standard parallel scans — typically a two-pass blocked scan (per-block reduce → scan block sums → per-block scan-with-offset) over a TBB/PPL work-stealing pool. **Caveat:** `std::partial_sum` is the *serial* prefix sum and never parallelizes — `inclusive_scan` exists precisely because `partial_sum`'s signature pins the left-to-right order. Also note `inclusive_scan` *requires* an associative (and, for `par`, ideally commutative) operator and may reorder; `partial_sum` does not.
- **Rust Rayon.** `par_iter().scan(...)` does **not** parallelize the way you might hope — Rayon's `scan` is sequential within the fold because of the carried state; the parallel idiom is an explicit reduce-then-rescan or a crate like `rayon`'s prefix combinators. This is the classic trap: the method exists on the parallel iterator but the operation is inherently stateful, so always check whether the adapter actually distributes.
- **NumPy `np.cumsum` / `np.cumprod`.** Single-threaded by default. NumPy's ufunc `accumulate` runs a tight serial C loop; it does *not* use BLAS threads or a parallel scan. For large arrays where scan is the bottleneck, move to a GPU (`cupy.cumsum`) or a parallel framework — do not expect cores from NumPy.
- **TensorFlow / JAX.** `tf.math.cumsum` and `jax.numpy.cumsum` compile (XLA) to a real log-depth parallel scan on GPU/TPU. JAX additionally exposes `jax.lax.associative_scan` — a *general* parallel scan over any associative binary op, the direct API embodiment of the senior tier's "find the monoid" reflex (it is what implements parallel RNN/SSM scans like the `S5`/Mamba linear recurrences).
- **Spark / Flink.** Running aggregates over windows (`Window.rowsBetween(unboundedPreceding, currentRow)`, Flink's `AggregateFunction` over a global accumulator) are scans across a *distributed* dataset. These parallelize across partitions but require a shuffle/exchange to carry the cross-partition prefix — the distributed analogue of level 2 (scan the block sums). A global running total over an unpartitioned stream serializes; a *partitioned* running total (per key) is embarrassingly parallel.

The decision rule across all of these: **the library parallelizes when it can prove the operator is associative and the cross-block prefix can be carried in a cheap second pass; it serializes when the API pins left-to-right order (`partial_sum`, `cumsum`) or when state is carried opaquely (Rayon `scan`).** Reach for the *named parallel scan* (`inclusive_scan` with `par`, `associative_scan`, `DeviceScan`), not the convenience accumulator.

---

## The Killer Applications

Scan's prefix array is rarely the deliverable. In production, scan is the *address-computation engine* behind a scatter. Three families dominate.

### Stream Compaction / Parallel Filter

This is the **#1 use of scan in practice**: keep only the elements satisfying a predicate, packed contiguously, in parallel. The pattern is exactly four steps, branch-free and perfectly load-balanced:

```text
COMPACT(in[0..n-1], keep_pred):
  1. flags[i]   = keep_pred(in[i]) ? 1 : 0           # map, O(1) depth, parallel
  2. offset[i]  = EXCLUSIVE-SCAN(flags, +)           # scan → destination index
  3. if flags[i]: out[ offset[i] ] = in[i]           # scatter, parallel
  4. total      = offset[n-1] + flags[n-1]           # the count, for free
```

The exclusive scan of the flag array gives, for each kept element, *the number of kept elements before it* — which is exactly its destination index in the output. No locks, no atomics, no per-thread output queues; the scan computes all `n` write addresses in one `O(log n)`-span pass and the scatter executes them in parallel. This is the workhorse of GPU `select`, `partition`, `remove_if`, `unique`, and `copy_if` (all of `thrust`/`cub`'s "stream compaction" family is this), and the same pattern compacts sparse results, culls invisible geometry in a renderer, and filters database rows in a columnar engine.

### Radix Sort via Per-Digit Split

The fastest GPU sorts (CUB's and Thrust's `radix_sort`) are scan all the way down. Radix sort processes keys one digit at a time, and each digit-pass is a **stable split** built on scan:

```text
RADIX-PASS(keys, digit d, radix R):     # R = 2^bits, e.g. 256 for 8-bit digits
  1. For each key, extract its d-th digit → bucket b in [0, R).
  2. Per tile, build a HISTOGRAM of bucket counts.
  3. SCAN the histograms (across buckets and across tiles) → for every (tile, bucket)
       the global offset where that tile's elements of that bucket begin.
  4. SCATTER each key to global_offset[bucket] + (rank within its tile's bucket),
       a per-element write address that a (segmented/multi-) scan produced.
```

Step 3 is the load-bearing scan: it turns local bucket counts into global write offsets so that, after the pass, all keys with digit value 0 precede all with value 1, stably. Iterating over digits from least- to most-significant sorts the whole array. Because every step is a scan-then-scatter — no comparisons, no branching on data — radix sort hits near-peak bandwidth and is why GPU sorts of `2³⁰` 32-bit keys run in milliseconds. See [`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md) for the full sorting treatment.

### Histogram Offsets, CSR, Parsing, Variable-Length Output

The same scan-as-address-computation drives a long tail of production kernels:

- **Histogram / bucketing offsets.** Counting elements per bucket gives counts; an **exclusive scan of the counts** gives the starting write offset of each bucket — the universal "convert counts to offsets" move (it is step 3 of radix sort generalized). Any "group these by key into contiguous runs" is a count-then-scan-then-scatter.
- **Sparse matrix (CSR) operations.** As developed at senior level, SpMV and other CSR row operations are **segmented scans** — the `row_ptr` array *is* a prefix-sum of row lengths, and per-row reductions are one flat segmented scan immune to row-length skew. Building CSR itself (from a coordinate list) is a scan of per-row nonzero counts.
- **Tokenization / parsing.** Lexing is a scan over the DFA-transition monoid (senior tier); the *output* — extracting variable-length tokens into a packed buffer — is stream compaction. Parallel CSV/JSON parsers (e.g. the techniques behind `simdjson`-style and GPU parsers) use scans to compute the start offset of every field.
- **Quicksort partition.** Splitting around a pivot is a segmented scan of the "less-than" flags producing each element's destination — Blelloch's data-parallel quicksort, the partition equivalent of stream compaction.
- **Variable-length output allocation — the general pattern.** When each parallel task produces a *variable* number of output items (a vertex expands to a variable number of neighbors in BFS frontier expansion; a triangle clips to a variable number of fragments; a record expands to variable matches in a join), the universal recipe is: **each thread computes its output count → exclusive-scan the counts → each thread writes at its scanned offset.** The scan converts "everyone wants to append" — which would need a contended atomic counter — into "everyone has a private, conflict-free output range." This single pattern eliminates the global atomic that would otherwise serialize the entire kernel, and it is the reason scan is foundational to parallel BFS, dynamic mesh refinement, and any producer of ragged output.

The unifying observation: **whenever parallel tasks must write into a shared output and need to know "where do I go?", the answer is a scan.** It replaces a serializing atomic with a parallel address computation.

---

## Performance Engineering: Scan Is Bandwidth-Bound

Everything above follows from one fact: scan does `Θ(n)` data movement and `Θ(n)` *trivial* compute (one `⊕` per element), so its arithmetic intensity is near zero and it sits firmly on the memory-bound diagonal of the roofline ([`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md)). The engineering reduces to a single objective: **touch memory as few times as possible, and touch it in the friendliest way.**

- **Minimize passes.** The dominant lever. A classic multi-pass GPU scan moves `~4n` bytes; single-pass decoupled look-back moves `2n` — and because the kernel is bandwidth-bound, that halving of traffic is nearly a halving of runtime *despite identical arithmetic*. On the CPU the analogue is the **two-pass partial-sums** scan: pass 1 computes each block's total (a reduce), a tiny serial scan of the `B` block totals, pass 2 re-scans each block adding its offset. Two passes over the data; the alternative single-pass approaches exist but two-pass is the cache-friendly default.
- **Maximize coalesced / sequential access.** On the GPU, the 32 lanes of a warp must read consecutive addresses so the hardware fuses them into one wide transaction; a strided or scattered access pattern multiplies the transaction count and tanks effective bandwidth. On the CPU, the scan should stream contiguously so the hardware prefetcher stays ahead and every cache line is fully used. Structure-of-arrays layout is non-negotiable for both.
- **Fuse with the producer/consumer.** Because the scan is bandwidth-bound, the worst thing you can do is materialize an intermediate array just to scan it. **Map-then-scan** (compute the flags *inside* the scan kernel's load) and **scan-then-scatter** (scatter *inside* the scan kernel's store) save entire passes over `n`. The whole stream-compaction pipeline above can often be a *single* fused kernel — load + predicate + scan + scatter — rather than four passes. Library `copy_if`/`partition` do exactly this fusion. The rule: never write a temporary you immediately re-read in a bandwidth-bound chain; fold the map and the scatter into the scan.
- **Occupancy and shared-memory limits (GPU).** The per-block tile size `T` is bounded by shared memory (the bank-conflict-free Blelloch scan needs `T + T/32` shared words) and by the occupancy needed to hide DRAM latency. Too large a tile starves occupancy (fewer resident blocks, latency exposed); too small a tile wastes the warp-shuffle efficiency and inflates the block count `B`. Production libraries auto-tune `T` per architecture — another reason to call CUB rather than hard-code.
- **Multicore CPU scan: cache-blocked + SIMD.** The two-pass scan is blocked to L2/L1 sizes so each block's data stays hot across its reduce and its re-scan; within a block the serial prefix is vectorized (SIMD prefix-sum kernels exist, though the carried dependency limits SIMD speedup to a small constant — the win is mostly from coalesced loads and the parallel block structure, not from vectorizing the recurrence itself).

The single most important number to report when you tune a scan is **achieved bandwidth as a fraction of peak**, not GFLOP/s. A good scan reaches 70–90% of `memcpy` bandwidth; if yours is far below, you have extra passes, uncoalesced access, or bank conflicts — not a compute problem.

---

## Numerical Care: Non-Associativity, Compensation, Overflow

The senior tier's exact-arithmetic story has a production asterisk: **floating-point addition is not associative**, and a parallel scan reorders the additions relative to the sequential left-to-right scan. Three consequences bite.

- **Reproducibility.** Two runs of the same parallel scan can produce *bit-different* results if the reduction tree shape varies (different block counts, different `B`, a non-deterministic work-stealing order). For a sum of `n` floats, the parallel tree order and the serial order generally differ in the last bits, and the *same* GPU scan on two different launch configurations may differ too. When bit-exact reproducibility matters (regulated finance, scientific validation, regression tests), you must either fix the reduction order, use a deterministic library mode (CUB/Thrust offer deterministic variants at a cost), or accept and document a tolerance. Never assert bit-equality between a parallel scan and `np.cumsum`.
- **Accuracy and compensated (Kahan) scan.** Naïve summation accumulates `O(n·ε)` worst-case error; large-`n` scans of values with widely varying magnitudes lose precision. **Kahan / compensated summation** carries a running correction term to recover most of the lost low-order bits, and it generalizes to scan — the monoid element becomes the `(sum, compensation)` pair and the combine does compensated addition. This raises the per-element work (still bandwidth-bound, so often nearly free) and dramatically improves accuracy. Interestingly, the *parallel tree* order is often *more* accurate than the serial order for large `n` (pairwise summation has `O(log n · ε)` error versus serial's `O(n · ε)`), so the parallel scan can be both faster and more accurate — but it will not match the serial result bit-for-bit.
- **Integer overflow.** A prefix sum of integers can overflow the element type even when every input is small — `offset[n-1]` is the *total*, which for a flag-count scan over `2³⁰` elements needs more than 32 bits. The classic production bug is a 32-bit offset array in a stream-compaction or histogram-offset pipeline silently wrapping at 4 G elements. Size the scan's accumulator type to the *total*, not the element, and prefer 64-bit offsets for large `n`. (This is also why CUB's offset types are templated and default to 64-bit for large inputs.)

The professional posture: scan in floating point is *order-dependent by nature*; choose your reduction order deliberately, use compensated arithmetic when accuracy matters, size integer accumulators for the total, and never rely on cross-implementation bit-equality.

---

## Worked End-to-End: A Stream-Compaction Pipeline

Here is a self-contained Go program implementing the canonical scan application — **stream compaction** (`copy_if`) — with a two-pass *parallel* scan, measured against the sequential filter. It shows the `flags → scan → scatter` structure, the block-scan-then-add-offset pattern, and the bandwidth-bound reality (the parallel version wins only at large `n`, and modestly, because it is memory-bound).

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// ---- Sequential baseline: filter in one pass. ----
func compactSerial(in []int32, keep func(int32) bool) []int32 {
	out := make([]int32, 0, len(in))
	for _, v := range in {
		if keep(v) {
			out = append(out, v)
		}
	}
	return out
}

// ---- Parallel compaction: flags -> two-pass scan -> scatter. ----
// Two-pass blocked exclusive scan of the predicate flags gives each kept
// element its destination index; the scatter writes in parallel, lock-free.
func compactParallel(in []int32, keep func(int32) bool, p int) []int32 {
	n := len(in)
	if n == 0 {
		return nil
	}
	blockSize := (n + p - 1) / p
	blockSums := make([]int64, p) // per-block count of kept elements
	localOff := make([]int64, n)  // exclusive prefix of flags WITHIN each block

	// PASS 1 (parallel): per-block local exclusive scan of flags; record block totals.
	var wg sync.WaitGroup
	for b := 0; b < p; b++ {
		wg.Add(1)
		go func(b int) {
			defer wg.Done()
			lo := b * blockSize
			hi := lo + blockSize
			if hi > n {
				hi = n
			}
			var run int64
			for i := lo; i < hi; i++ {
				localOff[i] = run // exclusive: count of kept BEFORE i in this block
				if keep(in[i]) {
					run++
				}
			}
			blockSums[b] = run // this block's total kept count
		}(b)
	}
	wg.Wait()

	// LEVEL 2 (serial, tiny): exclusive scan of the p block totals -> block offsets.
	blockOffset := make([]int64, p)
	var acc int64
	for b := 0; b < p; b++ {
		blockOffset[b] = acc
		acc += blockSums[b]
	}
	total := acc
	out := make([]int32, total)

	// PASS 2 (parallel): global index = blockOffset[b] + localOff[i]; scatter.
	for b := 0; b < p; b++ {
		wg.Add(1)
		go func(b int) {
			defer wg.Done()
			lo := b * blockSize
			hi := lo + blockSize
			if hi > n {
				hi = n
			}
			base := blockOffset[b]
			for i := lo; i < hi; i++ {
				if keep(in[i]) {
					out[base+localOff[i]] = in[i] // conflict-free write address
				}
			}
		}(b)
	}
	wg.Wait()
	return out
}

func main() {
	const n = 1 << 26 // ~67M int32 = 256 MB: far past cache, so DRAM-bound
	in := make([]int32, n)
	for i := range in {
		in[i] = int32(i)
	}
	keep := func(v int32) bool { return v%2 == 0 } // keep evens: ~50% selectivity

	timeIt := func(f func()) time.Duration {
		t := time.Now()
		f()
		return time.Since(t)
	}

	var sOut, pOut []int32
	ts := timeIt(func() { sOut = compactSerial(in, keep) })
	fmt.Printf("serial:   %-12v  kept=%d\n", ts, len(sOut))

	p := runtime.NumCPU()
	tp := timeIt(func() { pOut = compactParallel(in, keep, p) })
	fmt.Printf("parallel: %-12v  kept=%d  (P=%d)  speedup=%.2fx\n",
		tp, len(pOut), p, float64(ts)/float64(tp))

	// Correctness: parallel compaction must equal serial element-for-element.
	ok := len(sOut) == len(pOut)
	for i := 0; ok && i < len(sOut); i++ {
		ok = sOut[i] == pOut[i]
	}
	fmt.Printf("match=%v\n", ok)
}
```

**What the run demonstrates (numbers are machine-specific):**

1. **The scan-then-scatter structure is the whole algorithm.** Pass 1 computes `localOff` (an exclusive scan of flags within each block) and `blockSums`; level 2 scans the `p` block totals into `blockOffset`; pass 2 scatters using `blockOffset[b] + localOff[i]` as the conflict-free destination. *No locks, no atomics* — the scan replaced the global append counter with a private range per element. That is the entire point of scan as a primitive.
2. **Block-scan-then-add-offset is visible in code.** The two parallel passes plus the tiny serial middle scan are exactly the three levels of the GPU device scan, mapped onto CPU cores instead of thread-blocks. The middle scan over `p` totals is "scan the block sums"; pass 2 is "add the per-block offset back."
3. **The speedup is modest, and that is honest.** Compaction is bandwidth-bound (it reads 256 MB and writes ~128 MB, doing almost no arithmetic), so on a typical server the parallel version saturates the DRAM bus at 4–8 cores and tops out at single-digit speedup — *not* `P×`. This is the senior/professional throughline made measurable: scan-family kernels are limited by memory passes, not cores. A fused single-pass version (predicate inside pass 1's load, no separate `localOff` array) would cut traffic and beat this two-pass code — the "fuse with producer/consumer" lever from the performance section.

In production you would not write this: `thrust::copy_if`, `cub::DeviceSelect::If`, `std::copy_if` with `par`, or a columnar engine's filter operator all ship a fused, tuned version. The exercise shows the *mechanism* the library implements.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Need a prefix sum / running aggregate in production | **A library scan** (`std::inclusive_scan` par, `cub::DeviceScan`, `thrust`, `jax.lax.associative_scan`) | tuned, near-bandwidth, handles edge cases; rolling your own is a learning exercise |
| "Does this framework call parallelize?" | **Check the API contract** | `partial_sum`/`np.cumsum` are *serial*; Rayon `scan` is stateful-serial; reach for the *named parallel scan* |
| Filter / select / `copy_if` in parallel | **Stream compaction**: flags → exclusive scan → scatter | scan computes conflict-free write addresses; replaces a serializing atomic counter |
| Fast parallel sort of integers/keys | **Radix sort** (CUB/Thrust) — per-digit split via scan | each digit pass is histogram → scan → scatter; near-peak bandwidth ([`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md)) |
| Convert per-bucket counts to write offsets | **Exclusive scan of the counts** | the universal "counts → offsets" move (histogram, CSR build, bucketing) |
| Ragged per-group reduction (CSR SpMV, runs) | **Segmented scan** | one flat pass, immune to group-length skew (senior tier) |
| Each task emits a *variable* number of outputs | **Count → exclusive-scan → write at offset** | gives every task a private output range; kills the global append atomic |
| A GPU scan you wrote runs below ~70% of `memcpy` BW | **Check passes, coalescing, bank conflicts** | scan is bandwidth-bound; the problem is memory traffic, not compute |
| Want the fastest GPU scan | **Single-pass decoupled look-back** (CUB) | `2n` traffic vs `4n` multi-pass — nearly `2×` because bandwidth-bound |
| Bit-exact reproducibility required | **Fix the reduction order / deterministic mode** | FP scan is non-associative; parallel order ≠ serial order, by design |
| Accuracy-critical large-`n` sum | **Kahan / compensated scan**; mind **integer overflow** | compensated combine recovers low bits; size the accumulator to the *total* |
| Small input (thousands), latency-critical | **Stay on CPU** (or fuse into a kernel) | GPU launch + transfer cost dwarfs a tiny scan; scan it where the data already is |
| Large, regular, GPU-resident data | **GPU library scan** | thousands of lanes, coalesced, single-pass — this is scan's home turf |

Three rules of thumb:

1. **Call the library; reach for the *named parallel* scan.** `cub::DeviceScan` / `thrust` / `std::inclusive_scan(par)` / `jax.lax.associative_scan` are within a few percent of bandwidth. Beware the serial impostors: `partial_sum`, `np.cumsum`, Rayon `scan`.
2. **Scan's product is addresses, not sums.** The dominant use is **scan-then-scatter** — compaction, radix split, CSR, variable-length output. Whenever parallel tasks ask "where do I write?", the answer is a scan; it replaces a contended atomic with a parallel address computation.
3. **You are minimizing memory passes, not operations.** Scan is bandwidth-bound: fewer passes (single-pass look-back, two-pass CPU), coalesced access, and *fusion* of the map and scatter into the scan are the whole performance game. Report achieved bandwidth, not GFLOP/s.

---

## Research and System Pointers

- **Blelloch, G. E. (1990).** *Vector Models for Data-Parallel Computing*, MIT Press; and **"Scans as Primitive Parallel Operations,"** *IEEE Trans. Computers* 38(11), 1989. The foundation: scan as a unit-cost primitive, the work-efficient up/down-sweep, segmented scan, and the scan-based applications (compaction, quicksort, SpMV) productized here.
- **Sengupta, S., Harris, M., Zhang, Y., & Owens, J. D. (2007).** "Scan Primitives for GPU Computing." *Graphics Hardware.* The GPU segmented scan and the bank-conflict-free Blelloch implementation — the level-1 block scan above.
- **Harris, M., Sengupta, S., & Owens, J. D. (2007).** "Parallel Prefix Sum (Scan) with CUDA." *GPU Gems 3*, ch. 39. The canonical pedagogical GPU scan, including the `CONFLICT_FREE_OFFSET` padding trick reproduced here.
- **Merrill, D., & Garland, M. (2016).** "Single-pass Parallel Prefix Scan with Decoupled Look-back." NVIDIA tech report. The single-pass, `2n`-bandwidth scan with the AGGREGATE/PREFIX look-back protocol — the algorithm inside **CUB** `DeviceScan`.
- **CUB / Thrust / rocPRIM documentation.** `cub::DeviceScan`, `thrust::inclusive_scan`/`exclusive_scan`, `cub::DeviceSelect`, `cub::DeviceRadixSort` — the production implementations; their source is the reference for tile sizing, look-back, and offset-type selection.
- **Satish, N., Harris, M., & Garland, M. (2009).** "Designing Efficient Sorting Algorithms for Manycore GPUs." *IPDPS.* The radix-sort-via-scan split that underlies fast GPU sorts.
- **C++17 parallel algorithms (`<numeric>`, `<execution>`).** `inclusive_scan`/`exclusive_scan`/`transform_inclusive_scan` with execution policies — the standard-library parallel scan and the `partial_sum`-vs-`inclusive_scan` distinction.
- **JAX `lax.associative_scan` / `lax.scan`.** The general parallel scan over an arbitrary associative op — the "find the monoid" reflex as an API, used for parallel RNN/SSM (linear-recurrence) scans.

---

## Key Takeaways

1. **The production GPU scan is a three-level, then single-pass, story.** Per-block bank-conflict-free Blelloch in shared memory, warp scans via shuffle intrinsics, and — the modern advance — **decoupled look-back** (CUB) that fuses everything into one `2n`-bandwidth pass with no global barrier. Scan is *the* GPU benchmark primitive because it is the simplest kernel whose naïve form is far from optimal.
2. **In real code you call a scan, and the skill is knowing when it parallelizes.** `std::inclusive_scan(par)`, `cub::DeviceScan`, `thrust`, `jax.lax.associative_scan` are real parallel scans; `std::partial_sum`, `np.cumsum`, and Rayon `scan` are serial. Reach for the named parallel scan, not the convenience accumulator.
3. **Scan's deliverable is addresses, via scan-then-scatter.** Stream compaction (`flags → scan → scatter`, the #1 use), radix sort (per-digit histogram → scan → scatter), histogram/CSR offsets, and **variable-length output allocation** (count → scan → write at offset) are all one pattern: scan replaces a serializing atomic counter with a parallel, conflict-free address computation.
4. **Scan is memory-bandwidth-bound; you minimize passes, not operations.** Near-zero arithmetic intensity means single-pass look-back (`2n`) beats multi-pass (`4n`) almost `2×` despite identical adds. Coalesced/sequential access, cache-blocked two-pass CPU scan, and *fusing* the map and scatter into the scan are the levers. Report achieved bandwidth as a fraction of `memcpy`, not GFLOP/s.
5. **Floating-point scan is order-dependent — handle it deliberately.** Parallel reorder ≠ serial order, so results are not bit-reproducible by default (fix the order or use a deterministic mode); use **Kahan/compensated** scan when accuracy matters (the parallel tree is often *more* accurate for large `n`); and size integer accumulators to the *total*, not the element, to avoid the classic 32-bit offset overflow.

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier implements — the scan-vector model, the carry-monoid / prefix-network frontier, segmented scan, and recurrence-as-scan · [`../03-parallel-sorting-and-merging/professional.md`](../03-parallel-sorting-and-merging/professional.md) for radix sort and partition, scan's biggest consumers · [`../06-map-reduce-patterns/professional.md`](../06-map-reduce-patterns/professional.md) for the map/reduce siblings and the distributed running-aggregate (Spark/Flink) view · [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md) for the roofline and bandwidth-wall analysis that makes scan bandwidth-bound
