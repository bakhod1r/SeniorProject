# Parallel Reduce and Map — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Library Map+Reduce: The APIs and Their Contract](#library-mapreduce-the-apis-and-their-contract)
   - [The Associativity / Identity Contract](#the-associativity--identity-contract)
   - [C++17 `std::reduce` / `std::transform_reduce`](#c17-stdreduce--stdtransform_reduce)
   - [Rust Rayon, Intel TBB, Java Streams, .NET PLINQ](#rust-rayon-intel-tbb-java-streams-net-plinq)
   - [Go: Manual Goroutines + Sharded Partials](#go-manual-goroutines--sharded-partials)
3. [GPU Reductions: The Canonical Bandwidth-Bound Primitive](#gpu-reductions-the-canonical-bandwidth-bound-primitive)
   - [The Grid-Stride → Block → Warp → Final Pattern](#the-grid-stride--block--warp--final-pattern)
   - [Why Reduction Is Memory-Bandwidth-Bound](#why-reduction-is-memory-bandwidth-bound)
   - [CUB, Thrust, and Calling the Library](#cub-thrust-and-calling-the-library)
4. [All-Reduce in Distributed Training](#all-reduce-in-distributed-training)
5. [The MapReduce Framework Lineage (vs the Primitive)](#the-mapreduce-framework-lineage-vs-the-primitive)
6. [Engineering Reality: False Sharing, FP Non-Determinism, Tree vs Atomics](#engineering-reality-false-sharing-fp-non-determinism-tree-vs-atomics)
7. [Worked End-to-End: Padded Two-Level Reduce vs False Sharing](#worked-end-to-end-padded-two-level-reduce-vs-false-sharing)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: reduce is the image of a monoid, map-reduce-over-a-semiring is an entire shelf of graph algorithms, reduce sits in `NC¹` with a span-optimal `O(log n)` tree, distributed all-reduce is a `2n`-bytes-per-node bandwidth problem, and floating-point `+` is commutative-but-not-associative so the reduction tree shape *is* the accuracy and reproducibility story. That is the right mental model and this tier assumes it.

This tier answers a different question: **how are map and reduce actually wired into the systems that run them — Rayon, TBB, the C++17 parallel algorithms, NCCL, CUB — and what do you do when you reach for one in production?** The honest thesis has three parts. First, in real code you almost never *write* a reduce; you *call* one (`std::reduce`, `rayon::reduce`, `tbb::parallel_reduce`, `cub::DeviceReduce`, `nccl AllReduce`), and the professional skill is knowing the **associativity/identity contract** each API demands and exactly what breaks — silently, with wrong numbers, not a crash — when you violate it. Second, on a single accelerator reduce is the *canonical bandwidth-bound primitive*: `Θ(n)` reads, ~0 compute, so the only number that matters is the fraction of peak memory bandwidth you hit, and every optimization is a way to read each input exactly once, coalesced. Third, the single most important reduce in modern computing is the **gradient all-reduce** of data-parallel deep-learning training — it dominates the communication cost of every distributed training run, and ring all-reduce is the bandwidth-optimal schedule that makes it tractable.

The throughline of every section is the senior punchline made physical: **reduce has essentially zero arithmetic intensity, so the win is in memory passes and communication bytes, not operations — and the operator had better be associative, or the parallel reorder gives you the wrong answer.**

---

## Library Map+Reduce: The APIs and Their Contract

### The Associativity / Identity Contract

Every parallel map+reduce API requires the *same* algebraic contract, stated in the senior tier as "a monoid," and every API documents it in its own words:

- **Associativity is mandatory.** The library splits the range into chunks, reduces each chunk on a different thread, and combines the partials in an implementation-defined grouping. `(a ⊕ b) ⊕ c` and `a ⊕ (b ⊕ c)` must agree, or the result depends on the (non-deterministic) chunking. *Violating this does not throw — it returns a silently wrong number.*
- **Commutativity is often *also* required by these APIs** (more than the bare theory demands). Because work-stealing schedulers combine partials *in the order they finish*, several APIs (`std::reduce`, PLINQ's `.Aggregate` with a combiner, atomic-accumulator paths) require the operator to be **both associative and commutative**. `std::accumulate` is the *serial*, left-to-right, order-pinned fold; `std::reduce` is its parallel sibling and explicitly demands commutativity — which is exactly why **non-commutative reduces like string concatenation must not use `std::reduce`** (use `std::accumulate`, or a reduce variant that preserves order).
- **The identity must be a true identity.** APIs that take an explicit init value (`std::reduce(first, last, init, op)`, Java's `reduce(identity, accumulator, combiner)`) require `op(identity, x) == x`. A wrong "identity" (e.g. `0` for a `max`-reduce, or `init` counted once per chunk) corrupts the result by however many chunks the scheduler chose. The classic bug: passing a non-identity seed to a parallel reduce, so the seed is folded in `p` times instead of once.

The professional rule across all of them: **reach for the parallel reduce only when your operator is a commutative monoid; use the order-preserving serial fold otherwise.** Mean and variance are computed not by a non-monoidal `avg` but by reducing the `(sum, count)` (or Welford `(count, mean, M2)`) monoid and finishing at the end.

### C++17 `std::reduce` / `std::transform_reduce`

The standard library ships the primitive directly:

```cpp
#include <numeric>
#include <execution>

// reduce: parallel, REQUIRES associative AND commutative op (and a true identity).
double total = std::reduce(std::execution::par, v.begin(), v.end(), 0.0, std::plus<>{});

// transform_reduce: the FUSED map+reduce — apply a unary/binary map, then reduce.
// No intermediate array is materialized: the map is folded into the reduce's load.
double sumsq = std::transform_reduce(
    std::execution::par_unseq, v.begin(), v.end(),
    0.0, std::plus<>{}, [](double x){ return x * x; });

// dot product: the canonical binary transform_reduce (a (+,×) semiring map-reduce).
double dot = std::transform_reduce(
    std::execution::par, a.begin(), a.end(), b.begin(), 0.0);
```

`std::transform_reduce` is the API embodiment of the senior tier's "map step is the `⊗`, reduce step is the `⊕`": it is a semiring map-reduce, and crucially it **fuses** — it never materializes the mapped array, so the bandwidth-bound chain reads the input once. `std::reduce` with `std::execution::par` typically runs over a TBB or PPL work-stealing pool; `par_unseq` additionally permits SIMD vectorization within a chunk. The contract caveat is sharp: unlike `std::accumulate`, `std::reduce` **may reorder and re-group**, so it requires commutativity and a true identity, and its floating-point result will generally differ from `accumulate`'s in the low bits (see §6).

### Rust Rayon, Intel TBB, Java Streams, .NET PLINQ

The same primitive across the mainstream parallel runtimes, each with its own contract surface:

- **Rust Rayon.** `v.par_iter().map(|x| f(x)).reduce(|| identity, |a, b| a ⊕ b)` — the closure `|| identity` produces the monoid identity (called once per empty sub-range), and the combine must be associative. `par_iter().sum()` / `.product()` are the specialized fast paths. Rayon's `reduce` is a genuine parallel divide-and-conquer over its work-stealing pool; it is the cleanest expression of the map-reduce contract in a systems language. (Contrast Rayon's `.scan`, which — as the scan file notes — is *serial* because of carried state; `.reduce` is the truly parallel one.)
- **Intel TBB `parallel_reduce`.** TBB exposes the **split/join body** form directly, which makes the two-level structure of the senior tier explicit in the type system:

  ```cpp
  struct SumBody {
      double sum = 0.0;
      const double* data;
      void operator()(const tbb::blocked_range<size_t>& r) {
          for (size_t i = r.begin(); i != r.end(); ++i) sum += data[i];  // local fold
      }
      SumBody(SumBody& s, tbb::split) : sum(0.0), data(s.data) {}  // SPLIT: new identity
      void join(const SumBody& rhs) { sum += rhs.sum; }            // JOIN: combine ⊕
  };
  // tbb::parallel_reduce(blocked_range<size_t>(0,n), body);  →  body.sum
  ```

  The **splitting constructor** seeds a fresh accumulator at the identity for a stolen sub-range; `operator()` does the per-chunk sequential fold; `join` is the monoid combine. This is the two-level (block-then-combine) recipe of the senior tier as an API: each is exactly identity / `⊕`-on-elements / `⊕`-on-partials.
- **Java parallel streams.** `list.parallelStream().map(this::f).reduce(identity, accumulator, combiner)`. The three-argument form names the contract explicitly: `identity` must satisfy `combiner(identity, u) == u`; `accumulator` folds an element into a partial; `combiner` merges two partials and must be **associative and compatible** with the accumulator (`combiner(u, accumulator(identity, t)) == accumulator(u, t)`). Violating the combiner contract is the canonical Java parallel-stream bug — correct serially, wrong (and non-deterministically wrong) in parallel. Use `Collectors.summingDouble` / `summarizingDouble` for the `(sum,count,min,max)` monoid rather than rolling a fragile combiner.
- **.NET PLINQ.** `source.AsParallel().Select(f).Aggregate(seed, (acc, x) => acc ⊕ x, (a, b) => a ⊕ b, r => r)` — the four-argument `Aggregate` takes a **per-thread seed**, a per-thread accumulator, a **combiner of per-thread results**, and a final projection. The two-accumulator shape is again the two-level reduce; the per-thread seed must be the identity and the combiner associative+commutative. `.Sum()` / `.Average()` are the tuned fast paths.

### Go: Manual Goroutines + Sharded Partials

Go has no parallel-reduce in its standard library, so the idiom is hand-rolled and it makes the two-level structure unavoidably explicit: **shard the input across `P` goroutines, each computes a private partial, then a tiny serial fold combines the `P` partials.** The discipline that matters in production is that each goroutine's partial must live in its *own* cache line (no shared accumulator, no slice of adjacent counters) — otherwise false sharing destroys the speedup (§6, §7). The worked example in §7 is exactly this pattern, measured against a false-sharing version.

---

## GPU Reductions: The Canonical Bandwidth-Bound Primitive

On a single accelerator the algorithm is unchanged (a tree), but the engineering is dominated by one fact established at senior level: **reduce is memory-bound, not compute-bound.** It performs `n` reads, `n−1` trivial `⊕`s, and produces *one* output — arithmetic intensity ≈ 0 — so on the roofline it lives entirely on the bandwidth-bound side. The whole performance question is: *did I read each input exactly once, coalesced, at peak DRAM bandwidth?*

### The Grid-Stride → Block → Warp → Final Pattern

The production GPU reduction is a four-level decomposition onto the SIMT hierarchy — **grid-stride load → block reduce in shared memory → warp shuffle → final atomic or second pass** — and each level exists to read memory fewer or friendlier times:

```text
DEVICE-REDUCE(x[0..n-1], +):

  # Level 1 — GRID-STRIDE LOAD (each thread serially folds many elements)
  Each thread t accumulates a private register sum over a strided slice:
      acc = identity
      for i = global_id ; i < n ; i += total_threads:   # grid-stride: COALESCED
          acc += x[i]                                    # each global read used once
  # Brent's principle: do the cheap SEQUENTIAL fold per thread (serial is free),
  # the parallel tree only across the few partials that remain.

  # Level 2 — BLOCK REDUCE (shared-memory tree)
  Write acc to shared memory; tree-reduce within the block with SEQUENTIAL
  addressing (stride halving), which avoids shared-memory bank conflicts.

  # Level 3 — WARP REDUCE (shuffle, no shared memory, no barriers)
  The final 32 values reduce register-to-register in 5 steps:
      for (int d = 16; d > 0; d >>= 1)
          val += __shfl_down_sync(0xffffffff, val, d);   # lockstep, barrier-free

  # Level 4 — FINAL COMBINE
  One value per block remains. Either:
    (a) atomicAdd that value into a single global accumulator  (one pass, but
        order-nondeterministic → not bit-reproducible for floats), or
    (b) write per-block partials to an array and launch a tiny SECOND kernel
        to reduce the B partials (deterministic grouping, reproducible).
```

The `__shfl_down_sync` warp reduce is the load-bearing trick: lanes exchange registers directly with no shared-memory traffic and no `__syncthreads`, because a warp executes in lockstep — a Kogge–Stone-shaped tree where the work-inflated/min-depth profile is correct precisely because 32 elements is too small for the work penalty to bite. The Mark Harris *Optimizing Parallel Reduction in CUDA* optimization sequence (sequential addressing, first-add-during-load, last-warp unrolling, `__restrict__`, grid-stride) exists *entirely* to push a bandwidth-bound kernel toward peak bandwidth — not to save a single arithmetic op.

### Why Reduction Is Memory-Bandwidth-Bound

The roofline argument in one line: reduction does `Θ(n)` reads and `Θ(n)` *trivial* compute, so its arithmetic intensity (flops/byte) is near zero and it sits on the memory-bound diagonal. The achievable time is `≈ n · sizeof(elem) / peak_bandwidth`, and a well-tuned reduce runs at nearly the speed of a `memcpy` of the input — arithmetically, that is what it is. To hit peak you need three things:

- **Coalescing.** The 32 lanes of a warp must read consecutive addresses so the hardware fuses them into one wide transaction; the grid-stride pattern guarantees this. A strided or scattered access multiplies transactions and tanks effective bandwidth.
- **Enough blocks (occupancy).** You need many resident blocks to hide DRAM latency; too few blocks and the memory latency is exposed rather than overlapped. A reduce over millions of elements should launch enough blocks to saturate every SM, each folding many elements via the grid stride.
- **Vectorized loads.** Reading `float4` / `int4` (128-bit) per instruction issues fewer, wider memory transactions and raises achieved bandwidth toward peak — the standard last few percent on a bandwidth-bound kernel.

The single number to report when you tune a GPU reduce is **achieved bandwidth as a fraction of peak**, not GFLOP/s. A good reduce reaches 80–95% of `memcpy` bandwidth; far below that means uncoalesced access, too few blocks, or a materialized intermediate — not a compute problem.

### CUB, Thrust, and Calling the Library

In production you call a library, not a kernel:

| Library | Call | What it ships |
|---|---|---|
| **CUB** | `cub::DeviceReduce::Sum` / `::Reduce` (custom op) | grid-stride, warp-tuned, near-bandwidth — the reference device reduce |
| **CUB** | `cub::BlockReduce` / `cub::WarpReduce` | the block- and warp-level building blocks for your own kernels |
| **Thrust** | `thrust::reduce` / `thrust::transform_reduce` | high-level wrappers over CUB; `transform_reduce` is the **fused** map+reduce |
| **rocPRIM / hipCUB** | `rocprim::reduce` | AMD's CUB-equivalent |

`thrust::transform_reduce(d.begin(), d.end(), map_fn, init, plus)` is the fused semiring map-reduce — it folds the map into the load so no mapped array is materialized, saving an entire pass over `n` on a bandwidth-bound chain. The rule mirrors the scan file: **call the library; it is within a few percent of peak bandwidth and handles tile sizing, coalescing, and bank-conflict-free layout that you would otherwise re-derive.**

---

## All-Reduce in Distributed Training

The single most important reduce in modern computing is the **gradient all-reduce** of data-parallel deep-learning training. In data-parallel training, every one of `p` workers holds a full copy of the model and a different shard of the minibatch; each computes gradients on its shard, and before the optimizer step **every worker must hold the *average* of all `p` gradient vectors** — an all-reduce (sum, then scale by `1/p`) of a vector of `n` floats, where `n` is the parameter count (often hundreds of millions to billions). This collective runs *every minibatch*, and for large models it is **the dominant communication cost of the entire training run** — which is why getting it right is worth more than almost any other systems optimization in ML.

**Ring all-reduce is the bandwidth-optimal schedule** (Patarasuk–Yuan; popularized for DL by Baidu, then standard in NCCL and Horovod). As derived at senior level, it decomposes all-reduce into **reduce-scatter + all-gather**, arranges the `p` workers in a logical ring, and in each of `2(p−1)` steps every node sends and receives exactly `n/p` words — so each node moves a total of `≈ 2n` words, **independent of `p`**. That `p`-independence is the whole point: adding workers does not increase the bytes any single node must push, so the bandwidth term is optimal. The cost in the `α`/`β` model is `T_ring = 2(p−1)·α + 2·(p−1)/p·n·β + (p−1)/p·n·γ` — the bandwidth term flat in `p`, the price being a latency term `2(p−1)·α` linear in `p`.

The alternatives trade the axes:

| Schedule | Latency (steps) | Bytes/node | Best when |
|---|---|---|---|
| Naïve reduce + broadcast | `O(log p)` | `O(p·n)` at root — **bottleneck** | never at scale |
| **Ring** (NCCL / Horovod / Baidu) | `2(p−1)·α` (linear) | `≈ 2n` — optimal, `p`-independent | **large gradient vectors, moderate `p`** |
| Recursive halving-doubling | `2 log₂ p · α` (log) | `≈ 2n` — optimal | small/medium vectors, large `p` (latency-bound) |
| Tree | `2 log₂ p · α` | up to `O(n log p)` | tiny messages (pure latency) |

Because gradient vectors are *enormous*, the bandwidth term dominates and ring wins despite its `O(p)` latency. Two production realities sharpen this:

- **NCCL is the implementation, and it switches schedules.** NVIDIA's collective library auto-selects ring vs tree (and tree-based "double-binary-tree" all-reduce for very large `p`) by message size and topology, and goes **hierarchical**: a ring/tree *within* a node over NVLink (where `β` is tiny) and a different schedule *across* nodes over InfiniBand/Ethernet (where `α`, `β` are orders of magnitude larger). Horovod (Sergeev–Del Balso) wraps NCCL/MPI to bolt ring all-reduce onto TensorFlow/PyTorch with minimal code change; PyTorch DDP calls NCCL directly.
- **Overlap all-reduce with backprop — the decisive optimization.** Gradients become available layer-by-layer as backpropagation flows from the output to the input. Rather than wait for the *entire* backward pass and then all-reduce one giant vector, frameworks **bucket** gradients and launch the all-reduce of each bucket *as soon as its gradients are ready*, so communication of earlier layers overlaps with computation of later layers. With enough overlap the communication is nearly hidden behind the backward compute, which is what makes data-parallel training scale near-linearly until the per-step gradient bytes saturate the interconnect. The `reduce-scatter + all-gather` decomposition is also what **ZeRO / FSDP** exploit: shard the optimizer state and parameters so that a reduce-scatter (not a full all-reduce) suffices for gradients and an all-gather reconstructs parameters on demand, trading communication for memory.

The senior synthesis holds operationally: distributed reduce is a `2n`-bytes-per-node bandwidth problem; the schedule only chooses *how* the `2n` is paid, and the framework's job is to overlap it with compute so it costs nothing on the wall clock.

---

## The MapReduce Framework Lineage (vs the Primitive)

There is a name collision worth pinning down precisely. **MapReduce** (Dean & Ghemawat, Google, 2004; Hadoop, Spark) is a *distributed batch-processing framework* whose stages — **map → shuffle → reduce** — are *named after* the map and reduce primitives of this topic but are not the same thing. The framework's `map` emits `(key, value)` pairs; the **shuffle** partitions and sorts those pairs by key across the cluster; the framework's `reduce` is a *per-key* aggregation — i.e. the **reduce-by-key / segmented reduce** of the senior tier, not a single global fold. A **combiner** in MapReduce is a *local reduce* run on each mapper's output before the shuffle to shrink network traffic, and (as the senior tier stresses) it is correct only because the operator is an associative-*and-commutative* monoid, since partial groups arrive across the network in nondeterministic order.

The relationship to the primitive is exact: the framework's reduce phase *is* a distributed reduce-by-key, the combiner *is* a local pre-reduction, and the requirement that `avg` be carried as the `(sum, count)` monoid (never reduced directly) is the same monoid-spotting discipline. But this file keeps its focus on the **map/reduce primitive** — the in-process, single-node, or collective-communication building block — and defers the framework's shuffle, partitioner design, fault tolerance, and dataflow framing to [`../06-map-reduce-patterns/professional.md`](../06-map-reduce-patterns/professional.md). The one-line takeaway: *MapReduce-the-framework is the primitive scaled across a cluster with a shuffle in the middle; everything else here is the primitive itself.*

---

## Engineering Reality: False Sharing, FP Non-Determinism, Tree vs Atomics

Four production hazards turn a textbook-correct reduce into a slow or wrong one.

**Reductions do not scale past memory bandwidth.** Because reduce is bandwidth-bound, throwing more cores at it stops helping once the cores collectively saturate the memory bus — typically at a handful of cores on a single socket, *not* at `P`. A parallel reduce that reads a multi-hundred-MB array tops out at single-digit speedup on a typical server, and that is the honest ceiling, not a bug. The lever is *fewer/friendlier memory passes* (fuse the map into the load via `transform_reduce`; never materialize an intermediate), not more threads.

**False sharing in naive per-thread accumulators.** The standard bug in a hand-rolled two-level reduce: store the `P` per-thread partials in adjacent slots of one array (`partials[tid]`). Adjacent `int64`/`float64` slots share a 64-byte cache line, so when thread *i* updates `partials[i]` it invalidates the line in every other core's cache — the cores ping-pong the line on the coherence bus and the "parallel" reduce runs *slower* than serial. The fix is to **pad each accumulator to its own cache line** (align to 64 bytes, or wrap each in a struct padded to a full line), so writes never collide. This is a special case of cache-aware data layout — see [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md). The cleanest fix of all is to keep each thread's accumulator in a *register/local variable* and write it to shared memory only once at the end (what TBB's split/join body and Rayon's `reduce` do for you).

**Floating-point non-determinism.** Float `+` is not associative, so **a parallel reduce ≠ the sequential reduce bit-for-bit**, and *two runs of the same parallel reduce can differ* if the chunking, thread count, or atomic-arrival order changes the addition grouping. Three consequences and their handling:

- *Accuracy is usually better in parallel.* The balanced (pairwise) tree has error `O(ε log n)` versus the naïve sequential loop's `O(ε n)` — so the parallel reduce is typically *more* accurate, just not equal to the serial result. When more is needed, use **Kahan/compensated** summation as a `(sum, comp)` monoid (nearly free on a bandwidth-bound reduce, since arithmetic is not the bottleneck), or pairwise+Kahan.
- *Reproducibility is a separate axis.* When bit-exact reproducibility matters (regression tests, debugging "why did loss diverge only on 16 GPUs?", regulated finance), you must **fix the reduction tree** — fixed chunking, fixed combine order, *no* atomics — or use a deterministic library mode (deterministic cuDNN/NCCL), or a reproducible/exact summation (superaccumulators; Demmel–Nguyen). Never assert bit-equality between a parallel reduce and the serial fold.

**Choosing tree vs atomics.** The final-combine decision in a GPU (or sharded CPU) reduce:

- **Tree** (per-block partials → second kernel, or shared-memory tree) gives a *deterministic grouping* (you control the addition order → reproducible), reads memory coalesced, and has no contention. It is the default for a faithful float sum.
- **Atomics** (`atomicAdd` into one global accumulator) are simpler and single-pass, but they *serialize* on the contended cell and make the addition order *nondeterministic* → not bit-reproducible. Atomics win only when contention is genuinely low (a histogram with many buckets where blocks scatter across many counters) and reproducibility is not required. A single-accumulator float sum via atomics is a trap.

**Map fusion to avoid intermediates.** Because the whole chain is bandwidth-bound, the worst thing is to materialize a mapped array just to reduce it: `map` writes `n`, then `reduce` reads `n` — two extra passes. **Fuse** the map into the reduce's load (`transform_reduce`, `thrust::transform_reduce`, folding `f(x)` inside the grid-stride accumulate) so the input is read once and the mapped value is consumed in-register. This is the same "never write a temporary you immediately re-read" rule the scan file states; on a bandwidth-bound kernel, fusion is the single highest-leverage optimization after coalescing.

---

## Worked End-to-End: Padded Two-Level Reduce vs False Sharing

Here is a self-contained Go program implementing the canonical two-level parallel reduce — **sum of `n` `float64`s** — three ways: a sequential baseline, a *false-sharing* version (per-thread partials packed into adjacent array slots), and a *padded* version (each accumulator on its own cache line, the production pattern). It demonstrates (1) the two-level structure (per-thread partials → serial combine), (2) the false-sharing cliff, and (3) the floating-point order effect — the parallel sum does not equal the serial sum bit-for-bit.

```go
package main

import (
	"fmt"
	"math"
	"runtime"
	"sync"
	"time"
)

// ---- Sequential baseline: a single left-fold. Defines the reference ORDER. ----
func sumSerial(x []float64) float64 {
	var s float64
	for _, v := range x {
		s += v
	}
	return s
}

// ---- BAD: per-thread partials packed adjacently → FALSE SHARING. ----
// partials[tid] and partials[tid+1] share a 64-byte cache line; every write
// invalidates the line in the other cores → coherence ping-pong.
func sumFalseSharing(x []float64, p int) float64 {
	partials := make([]float64, p) // adjacent float64s: 8 per cache line
	block := (len(x) + p - 1) / p
	var wg sync.WaitGroup
	for t := 0; t < p; t++ {
		wg.Add(1)
		go func(t int) {
			defer wg.Done()
			lo, hi := t*block, (t+1)*block
			if hi > len(x) {
				hi = len(x)
			}
			for i := lo; i < hi; i++ {
				partials[t] += x[i] // writes hammer a shared cache line
			}
		}(t)
	}
	wg.Wait()
	var total float64
	for _, v := range partials {
		total += v
	}
	return total
}

// ---- GOOD: each accumulator in a register/local; one write at the end. ----
// No shared mutable state during the hot loop → no false sharing.
func sumPadded(x []float64, p int) float64 {
	partials := make([]float64, p)
	block := (len(x) + p - 1) / p
	var wg sync.WaitGroup
	for t := 0; t < p; t++ {
		wg.Add(1)
		go func(t int) {
			defer wg.Done()
			lo, hi := t*block, (t+1)*block
			if hi > len(x) {
				hi = len(x)
			}
			var local float64 // private accumulator: lives in a register
			for i := lo; i < hi; i++ {
				local += x[i]
			}
			partials[t] = local // ONE write to shared memory, after the loop
		}(t)
	}
	wg.Wait()
	var total float64 // serial combine of the p partials (tiny)
	for _, v := range partials {
		total += v
	}
	return total
}

func main() {
	const n = 1 << 26 // ~67M float64 = 512 MB: far past cache, DRAM-bound
	x := make([]float64, n)
	for i := range x {
		x[i] = 1.0 / float64(i%7+1) // varied magnitudes → visible FP reorder
	}
	p := runtime.NumCPU()

	timeIt := func(f func() float64) (float64, time.Duration) {
		t := time.Now()
		r := f()
		return r, time.Since(t)
	}

	sSum, sT := timeIt(func() float64 { return sumSerial(x) })
	fSum, fT := timeIt(func() float64 { return sumFalseSharing(x, p) })
	pSum, pT := timeIt(func() float64 { return sumPadded(x, p) })

	fmt.Printf("serial:        %-12v  sum=%.10f\n", sT, sSum)
	fmt.Printf("false-sharing: %-12v  sum=%.10f  speedup=%.2fx\n",
		fT, fSum, float64(sT)/float64(fT))
	fmt.Printf("padded:        %-12v  sum=%.10f  speedup=%.2fx\n",
		pT, pSum, float64(sT)/float64(pT))

	// The FP-order effect: parallel sum ≠ serial sum, by ~ULPs, NOT a bug.
	fmt.Printf("padded vs serial bit-equal? %v   abs diff = %g\n",
		pSum == sSum, math.Abs(pSum-sSum))
}
```

**What the run demonstrates (numbers are machine-specific):**

1. **The two-level structure is the whole algorithm.** Each goroutine folds its block into a *private* accumulator (the per-thread reduce), then a tiny serial loop combines the `P` partials (the combine `⊕`). This is the senior tier's block-then-combine recipe and TBB's split/join body, hand-rolled in Go.
2. **False sharing is a measurable cliff.** `sumFalseSharing` writes `partials[t]` in the hot loop, so adjacent threads' accumulators share cache lines and the cores ping-pong them on the coherence bus; it often runs *slower than serial* despite using every core. `sumPadded` keeps each accumulator in a local (register) and writes to shared memory exactly once, eliminating the contention — and it is the only version that actually speeds up. The lesson: never write per-thread state into a shared, densely-packed array in the hot loop.
3. **The speedup is modest, and that is honest.** Summing 512 MB is bandwidth-bound: even the padded version saturates the DRAM bus at a few cores and tops out at single-digit speedup, not `P×`. Reduce-family kernels are limited by memory passes, not cores — the throughline made measurable.
4. **The parallel sum is not bit-equal to the serial sum.** `pSum == sSum` is `false` and the difference is a few ULPs: the parallel reduce re-associates the additions (a different tree shape), and float `+` is not associative. This is *not a bug* — and the parallel pairwise grouping is typically *more* accurate than the serial left-fold. If you need bit-reproducibility, fix the tree; if you need accuracy, use Kahan.

In production you would not write this: `std::reduce`/`transform_reduce` with `par`, `rayon::par_iter().sum()`, `tbb::parallel_reduce`, or `cub::DeviceReduce` ship the padded, tuned, fused version. The exercise shows the *mechanism* — and the two failure modes (false sharing, FP non-determinism) — the library handles for you.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Sum / max / custom fold of an in-memory collection | **A library reduce** (`std::reduce` par, `rayon::reduce`, `tbb::parallel_reduce`, PLINQ `Aggregate`) | tuned, two-level, contract-checked; rolling your own invites false sharing |
| Map then reduce (dot product, sum-of-squares, norm) | **Fused `transform_reduce`** (C++17 / Thrust) | no intermediate array — one pass over `n` on a bandwidth-bound chain |
| "Is my operator OK for this API?" | **Check it is a commutative monoid** | `std::reduce`/PLINQ/atomics need assoc *and* commute; non-commutative (concat) → use `std::accumulate` |
| Mean / variance / multiple stats in one pass | **Reduce the `(sum,count)` / Welford monoid** | `avg` is not a monoid; carry the tuple, finish at the end |
| Large GPU-resident reduction | **`cub::DeviceReduce` / `thrust::reduce`** | grid-stride, warp-shuffle, coalesced, near-peak bandwidth |
| Building a custom GPU kernel that needs a reduce | **`cub::BlockReduce` / `cub::WarpReduce`** | the block/warp building blocks, bank-conflict-free and tuned |
| Final combine on GPU, reproducibility required | **Tree (second pass)**, not atomics | atomics serialize + nondeterministic order → not bit-reproducible |
| Final combine, low contention, reproducibility not needed | **Atomics** (e.g. many-bucket histogram) | single pass; contention low when targets are scattered |
| Average gradients across GPUs/nodes | **Ring all-reduce via NCCL** (Horovod/DDP) | bandwidth-optimal `2n` bytes/node, `p`-independent; overlap with backprop |
| Small reduction across many nodes (latency-bound) | **Recursive halving-doubling / tree** (library picks) | `2 log p` steps beat ring's `2(p−1)` when bandwidth term is small |
| Hand-rolled CPU reduce (e.g. Go) | **Private per-thread accumulators, pad to a cache line** | avoid false sharing; one shared write at the end |
| Reduce stopped scaling past a few cores | **Accept it — you hit the memory wall** | reduce is bandwidth-bound; fuse the map / cut passes, don't add threads |
| Bit-reproducibility across differing `p` | **Fixed reduction tree / deterministic mode / exact summation** | parallel reorder ≠ serial; choose the order deliberately |

Three rules of thumb:

1. **Call the library; respect the contract.** `std::reduce`/`rayon`/`tbb::parallel_reduce`/`cub::DeviceReduce`/`nccl AllReduce` are tuned and within a few percent of the relevant ceiling. Reach for the parallel reduce only when your operator is a commutative monoid; use the order-preserving serial fold otherwise.
2. **You are minimizing memory passes and communication bytes, not operations.** Reduce is bandwidth-bound: fuse the map (`transform_reduce`), read each input once coalesced, and pad per-thread accumulators to kill false sharing. On a cluster, the gradient all-reduce is `2n` bytes/node — overlap it with backprop.
3. **Floating point is order-dependent — handle it deliberately.** Parallel reorder ≠ serial, so default to *not* bit-reproducible; the parallel pairwise tree is usually *more* accurate; use Kahan when accuracy matters and a fixed tree (or exact summation) when reproducibility matters.

---

## Research and System Pointers

- **Dean, J., & Ghemawat, S. (2004).** "MapReduce: Simplified Data Processing on Large Clusters." *OSDI.* The framework whose map → shuffle → reduce stages are named after — but distinct from — the primitive of this file; combiners as local reductions. (Framework detail: [`../06-map-reduce-patterns/professional.md`](../06-map-reduce-patterns/professional.md).)
- **Blelloch, G. E. (1990).** *Vector Models for Data-Parallel Computing*, MIT Press. `reduce`/`scan`/`map` as unit-cost data-parallel primitives, segmented operations, and the scan-vector model — the algebraic foundation productized here.
- **Harris, M. (2007).** "Optimizing Parallel Reduction in CUDA." NVIDIA. The canonical GPU reduction optimization sequence (sequential addressing, first-add-during-load, warp unrolling, grid-stride) — all bandwidth, not arithmetic.
- **NVIDIA CUB / Thrust documentation.** `cub::DeviceReduce`, `cub::BlockReduce`, `cub::WarpReduce`, `thrust::reduce` / `thrust::transform_reduce` — the production single-GPU reductions; their source is the reference for tile sizing, shuffle reductions, and the fused map-reduce.
- **Patarasuk, P., & Yuan, X. (2009).** "Bandwidth Optimal All-reduce Algorithms for Clusters of Workstations." *JPDC.* The bandwidth-optimal **ring all-reduce** — the schedule Baidu and then NCCL/Horovod made the standard for distributed deep learning.
- **Sergeev, A., & Del Balso, M. (2018).** "Horovod: fast and easy distributed deep learning in TensorFlow." The ring-all-reduce wrapper (over NCCL/MPI) that popularized bandwidth-optimal gradient averaging in mainstream ML.
- **Thakur, R., Rabenseifner, R., & Gropp, W. (2005).** "Optimization of Collective Communication Operations in MPICH." *IJHPCA.* Recursive halving-doubling, the `α`/`β` cost model, and message-size/`p` schedule switching for all-reduce.
- **NCCL (NVIDIA Collective Communications Library) documentation.** Ring vs (double-binary-)tree all-reduce, hierarchical intra-node (NVLink) vs inter-node schedules, and the `reduce-scatter + all-gather` decomposition behind ZeRO/FSDP.
- **C++17 parallel algorithms (`<numeric>`, `<execution>`).** `std::reduce` / `std::transform_reduce` with execution policies — the standard parallel reduce, the fused map-reduce, and the `accumulate`-vs-`reduce` (order-pinned vs commutative) distinction.
- **Kahan, W. (1965); Higham, N. J. (2002).** Compensated summation and the `O(ε n)` naïve vs `O(ε log n)` pairwise error analysis — the numerical basis for "parallel is usually more accurate."

---

## Key Takeaways

1. **In real code you call a reduce, and the skill is the contract.** `std::reduce`/`transform_reduce`, `rayon::reduce`/`sum`, `tbb::parallel_reduce` (split/join body), Java `reduce(identity, accumulator, combiner)`, PLINQ `Aggregate`, and Go's hand-rolled sharded partials all require a **commutative monoid** with a true identity. Violations don't crash — they return silently wrong, non-deterministic numbers. Non-commutative folds (concat) must use the order-pinned serial path (`std::accumulate`).
2. **The production GPU reduce is grid-stride → block → warp-shuffle → final.** Each thread serially folds many coalesced reads (Brent), a shared-memory tree reduces the block, `__shfl_down` reduces the warp barrier-free, and a final atomic or second pass combines. `cub::DeviceReduce`/`BlockReduce`/`WarpReduce` and `thrust::reduce`/`transform_reduce` ship it at near-peak bandwidth.
3. **Reduction is memory-bandwidth-bound.** `Θ(n)` reads, ~0 compute → it lives on the memory roofline; a good reduce runs at `memcpy` speed. Hit peak via coalescing, enough blocks, and vectorized loads; report achieved bandwidth, not GFLOP/s. It does **not** scale past the memory bus — single-digit speedup is the honest ceiling.
4. **Gradient all-reduce dominates data-parallel training, and ring all-reduce is the answer.** `2n` bytes/node, `p`-independent (reduce-scatter + all-gather), via NCCL/Horovod; **overlap it with backprop** by bucketing gradients so communication hides behind later-layer compute. The same decomposition powers ZeRO/FSDP.
5. **MapReduce-the-framework ≠ the primitive.** map → shuffle → reduce is a distributed batch framework whose reduce is a per-key (reduce-by-key) aggregation and whose combiner is a local reduce; the primitive itself is the in-process / collective building block. Framework detail lives in [`../06-map-reduce-patterns/professional.md`](../06-map-reduce-patterns/professional.md).
6. **Engineering reality: pad accumulators, fuse the map, choose tree vs atomics deliberately, and respect FP order.** False sharing turns a naive per-thread-partials reduce slower-than-serial (pad to a cache line — [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)); map fusion (`transform_reduce`) saves whole passes; trees are reproducible and atomics are not; and the parallel reduce is *more* accurate than the serial loop but not bit-equal — fix the tree (or use exact summation) when reproducibility is required.

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier implements — monoids/semirings, reduce in `NC¹`, the homomorphism view, and the ring all-reduce bandwidth derivation · [`../02-parallel-prefix-sum-scan/professional.md`](../02-parallel-prefix-sum-scan/professional.md) for scan, reduce's "keep every prefix" sibling, and the same GPU bandwidth-bound engineering · [`../06-map-reduce-patterns/professional.md`](../06-map-reduce-patterns/professional.md) for the MapReduce *framework* — shuffle, combiners, partitioners, and the distributed dataflow framing · [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md) for the cache-line padding that kills false sharing in per-thread accumulators
