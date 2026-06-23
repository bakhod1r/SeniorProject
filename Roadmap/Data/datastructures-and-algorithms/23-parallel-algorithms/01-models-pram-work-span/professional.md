# Models of Parallel Computation: PRAM and Work–Span — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Work–Span Is the Mental Model for Every Real Framework](#workspan-is-the-mental-model-for-every-real-framework)
3. [Measuring Work and Span in Practice](#measuring-work-and-span-in-practice)
4. [The Reality the PRAM Ignores](#the-reality-the-pram-ignores)
   - [Memory Bandwidth: The Real Ceiling](#memory-bandwidth-the-real-ceiling)
   - [NUMA, Cache Coherence, and False Sharing](#numa-cache-coherence-and-false-sharing)
   - [The Roofline Model](#the-roofline-model)
   - [Synchronization, Imbalance, Oversubscription](#synchronization-imbalance-oversubscription)
5. [Granularity Control: The One Knob That Matters Most](#granularity-control-the-one-knob-that-matters-most)
6. [GPU / SIMT as a PRAM-Like Model](#gpu--simt-as-a-pram-like-model)
7. [Amdahl and Gustafson in Engineering Decisions](#amdahl-and-gustafson-in-engineering-decisions)
8. [Worked End-to-End: A Parallel Reduction and Its Ceilings](#worked-end-to-end-a-parallel-reduction-and-its-ceilings)
9. [Decision Framework](#decision-framework)
10. [Research Pointers](#research-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: `NC` classifies what is efficiently parallelizable, `P`-completeness names the inherently sequential, the Cook–Dwork–Reischuk and Beame–Håstad bounds floor the span, and the Blumofe–Leiserson work-stealing theorem promises `E[T_P] ≤ T₁/P + O(T∞)` on a real decentralized scheduler. That theory is correct and it is the right mental model. This tier answers a different question: **when you reach for Cilk, OpenMP tasks, Intel TBB, Rust Rayon, Java's `ForkJoinPool`, Go goroutines, or C++ `std::async` / parallel algorithms, which parts of work–span actually carry over, where does the PRAM lie to you, and what do you tune?**

The thesis is blunt. Work–span is the single most useful design abstraction a parallel engineer holds: `spawn`/`sync` *is* the DAG, every modern runtime is a work-stealing scheduler that delivers `T₁/P + O(T∞)`, and your job is to expose enough parallelism (`T₁/T∞ ≫ P`) and let the scheduler map it. But the PRAM — and the naïve reading of work–span — is wrong in the ways that decide whether you get speedup at all: it charges **nothing for memory bandwidth** (the true ceiling for reductions and scans), nothing for **NUMA** or **cache coherence** or **false sharing**, nothing for **synchronization and barriers**, and it assumes tasks are free, ignoring **granularity** — the cutoff knob that, in practice, separates a 7× speedup from a 0.3× slowdown. A professional designs in work–span and *knows which physical cost is going to be the real wall*.

This file works through that gap: how `spawn`/`sync` maps to each framework, how to *measure* work and span (Cilkscale) and read strong/weak scaling curves, why you don't get linear speedup (bandwidth, NUMA, coherence, sync, imbalance, granularity), the granularity cutoff, the GPU as a PRAM-like machine, Amdahl/Gustafson as engineering decisions, and a runnable parallel reduction that hits its bandwidth and granularity ceilings on real hardware.

---

## Work–Span Is the Mental Model for Every Real Framework

The work–span model is not an academic abstraction you leave behind when you write code — it is *exactly* the contract every task-parallel runtime implements. The mapping is mechanical:

- **`spawn` / fork** creates a new vertex in the DAG that *may* run in parallel with its continuation. It is a hint, not a thread: the runtime decides whether anyone actually steals it.
- **`sync` / join** is a DAG edge that forces the spawned subtree to complete before the continuation proceeds. It is where the critical path's dependencies are declared.
- **The DAG you write is `T₁` and `T∞`.** Total work `T₁` is the sum of all vertices (the serial running time, when no spawn is stolen); span `T∞` is the longest dependency chain. Parallelism is `T₁/T∞`.
- **The runtime is a randomized work-stealing scheduler** delivering `E[T_P] ≤ T₁/P + O(T∞)` — the Blumofe–Leiserson bound from [`./senior.md`](./senior.md). You do not schedule; you expose parallelism and the scheduler maps it. Deep mechanics — per-core deques, LIFO-own/FIFO-steal, the steal count `O(P·T∞)` — are in [`../07-fork-join-and-work-stealing/professional.md`](../07-fork-join-and-work-stealing/professional.md).

Every mainstream framework is this model wearing different syntax:

| Framework | `spawn` | `sync` | Scheduler |
|---|---|---|---|
| **Cilk / OpenCilk** | `cilk_spawn` | `cilk_sync` | randomized work-stealing (the reference implementation) |
| **OpenMP tasks** | `#pragma omp task` | `#pragma omp taskwait` / `taskgroup` | work-stealing task pool |
| **Intel TBB** | `task_group::run`, `parallel_invoke` | `task_group::wait` | work-stealing (the `tbb::task` arena) |
| **Rust Rayon** | `rayon::join(a, b)`, `spawn` | implicit at `join` return | work-stealing (Crossbeam deques) |
| **Java `ForkJoinPool`** | `ForkJoinTask::fork` | `join()` | Doug Lea's work-stealing pool (also backs parallel streams) |
| **Go** | `go f()` | `sync.WaitGroup` / `errgroup.Group.Wait` | `M:N` goroutine scheduler with per-P run queues + stealing |
| **C++17** | `std::async(launch::async, …)`, `std::par` policies | `future::get`, algorithm return | implementation work-stealing pool (TBB/PPL) |

Two practitioner notes about this table. First, **Go is the partial outlier**: goroutines are stackful and the scheduler steals, but goroutines are designed for *concurrency* (independent, possibly-blocking tasks) more than for *fork–join data parallelism*. For CPU-bound divide-and-conquer in Go you still write the fork–join DAG by hand — spawn goroutines, fan-in with a `WaitGroup` or, when any branch can error, `golang.org/x/sync/errgroup` (which adds first-error propagation and context cancellation). The work–span analysis is identical; only the steal discipline and the lack of a structured `sync` differ. Second, **the high-level parallel constructs are sugar over the same DAG**: `rayon::par_iter().sum()`, OpenMP `#pragma omp parallel for reduction(+:s)`, a Java parallel-stream `.reduce`, and `std::reduce(std::execution::par, …)` all *generate* a balanced reduction tree of work `Θ(n)` and span `Θ(log n)` — exactly the `NC¹` scan/reduce DAG from [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md). You design for high `T₁/T∞`; the runtime maps it. That is the whole game.

---

## Measuring Work and Span in Practice

You cannot tune what you do not measure, and the two numbers that predict your scaling — `T₁` and `T∞` — are *machine-independent properties of your program's DAG*, not of any particular run. That is precisely what makes them measurable cheaply.

**Cilkview / Cilkscale.** The Cilk toolchain ships a scalability analyzer (Cilkview, now **Cilkscale** in OpenCilk) that instruments a fork–join program and computes, from a *single serial-ish run*, the actual work `T₁`, the actual span `T∞`, and therefore the parallelism `T₁/T∞`. Because Brent's bound brackets every parallel run by `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞`, Cilkscale turns those two measured numbers into a **predicted speedup curve** — an upper bound `T₁/T_P ≤ min(P, T₁/T∞)` and a lower (greedy-scheduler) bound — *before you ever run on the full machine*. The single most useful output is the parallelism number: if `T₁/T∞ = 50` and you are deploying on 64 cores, the tool is telling you in advance that you will saturate around 50× and cores 51–64 will sit idle on the span. This is the work–span model paying rent: a prediction, not a postmortem.

**Strong scaling (Amdahl regime).** Fix the problem size; vary `P`. Plot speedup `S(P) = T_1 / T_P` against `P`. The ideal is the diagonal `S = P`; the gap between your curve and the diagonal is everything the PRAM ignored. A strong-scaling curve that **bends over and flattens** is the empirical signature of either the span term `T∞` (insufficient parallelism — you've hit `T₁/T∞`) or a serial bottleneck (Amdahl's serial fraction). A curve that *peaks and then declines* as `P` grows is the signature of **overhead overtaking work** — synchronization, false sharing, or memory-bandwidth saturation, none of which the speedup model predicts.

**Weak scaling (Gustafson regime).** Grow the problem with `P` so the *work per processor stays constant*, and plot the time. Ideal weak scaling is a **flat line** (constant time as both `n` and `P` grow together). Weak scaling tests whether your algorithm's overhead grows sub-linearly with `P`; it is the right metric when the real goal is "solve a bigger problem in the same time" (the Gustafson view) rather than "solve this problem faster" (the Amdahl view).

**Finding the serial bottleneck empirically.** Amdahl's law inverted is a diagnostic. If you measure `S(P)` at a few values of `P`, you can *solve for* the serial fraction `f`: from `S(P) = 1 / (f + (1−f)/P)`, two measurements pin down `f`. A measured `f = 0.1` means your ceiling is `1/f = 10×` no matter how many cores you buy — and now you know to go *profile the 10%*, not add hardware. Pair this with a profiler (`perf`, VTune, the Go `pprof`, a flame graph) to locate the serial region: a lock everyone contends, an `I/O` step, a non-parallelized prefix, a `reduce` whose tree you accidentally serialized.

```text
Strong scaling, fixed n:           Weak scaling, n grows with P:
 S(P)                               T_P
  | ideal  /                         |
  |       /                          |____________  ideal (flat)
  |      /  ___ measured (bends      |        ____/  measured (overhead grows)
  |     /  /    at T1/Too, then      |   ____/
  |    / _/     bandwidth wall)      |__/
  +----------- P                     +----------- P
```

---

## The Reality the PRAM Ignores

The PRAM (and the bare work–span model) assumes uniform, unit-cost, infinite-bandwidth shared memory and free synchronization. Real machines violate every clause, and the violations — not the span — are usually why your speedup is sublinear. Here are the ones that bite, in rough order of how often they are the actual ceiling.

### Memory Bandwidth: The Real Ceiling

This is the one practitioners underestimate most. A modern socket has *many* cores sharing **one** memory subsystem with a fixed aggregate bandwidth (tens to low-hundreds of GB/s). For a **memory-bound** kernel — and reductions, scans, `map`, `saxpy`, and most streaming numeric work *are* memory-bound, doing `O(1)` arithmetic per byte loaded — adding cores past the point where they collectively saturate the memory bus buys nothing. The work–span model says a `Θ(n)`-work, `Θ(log n)`-span reduction scales to `T₁/T∞ ≈ n/log n` processors; the memory bus says it scales to "however many cores it takes to hit peak `GB/s`," which on a typical server is **4–8 cores, not 64**. Your beautiful `O(log n)`-span tree saturates the bus and then flatlines. This is the number-one reason a parallel sum does not get 32× on 32 cores — and it is *completely invisible* to the PRAM, which charges one unit per memory access regardless of contention.

### NUMA, Cache Coherence, and False Sharing

- **NUMA (Non-Uniform Memory Access).** On a multi-socket machine, memory is partitioned: each socket's cores access *local* DRAM fast and *remote* DRAM (across the interconnect — UPI/Infinity Fabric) markedly slower (often 1.5–2× latency, lower bandwidth). The PRAM's "uniform memory" is a lie across sockets. The practical rule is **first-touch allocation**: memory is physically placed on the NUMA node of the core that first writes it, so you must initialize data *in parallel, from the cores that will later use it* — a serial init loop pins all data on node 0 and then 3 of 4 sockets pay remote latency forever. NUMA-aware partitioning (each thread owns a contiguous, locally-allocated slice) is often a larger win than any algorithmic change.
- **Cache coherence and false sharing.** Cores keep coherent caches via a protocol (MESI/MOESI) that invalidates a cache line when any core writes it. **False sharing** is when two cores write *different* variables that happen to live on the *same 64-byte cache line*: every write ping-pongs the line between cores, serializing what looks parallel and adding latency-bound coherence traffic. The classic instance: an array `partial_sums[P]` of per-thread accumulators, packed tight — adjacent threads' counters share a line and the loop runs *slower* with more threads. The fix is padding/alignment to a cache line, the cache-aware data-layout discipline detailed in [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md). False sharing is the most common "I parallelized it and it got slower" bug.

### The Roofline Model

The roofline (Williams–Waterman–Patterson) is the one diagram that unifies "compute-bound vs memory-bound" and tells you whether parallelizing *can* help. Plot attainable performance (FLOP/s, log scale) against **arithmetic intensity** `I` = FLOPs performed per byte moved from memory (log scale):

```text
 FLOP/s
   |          ____________  peak compute (flat roof)
   |         /
   |        /  <- ridge point: I* = peak_FLOPs / peak_bandwidth
   |   ____/
   |  / slope = peak memory bandwidth (the "roofline")
   | /
   +-------------------------- arithmetic intensity I (FLOP/byte)
        reduce/scan/saxpy        dense matmul, n-body
        (low I, memory-bound)    (high I, compute-bound)
```

A kernel with intensity below the **ridge point** `I*` is **memory-bound**: it sits on the diagonal, its performance is `I × bandwidth`, and *adding cores does not help once the bus saturates* — you must raise intensity (blocking, fusion, better layout) or accept the ceiling. A kernel above `I*` is **compute-bound**: it can use the flat compute roof, and more cores / wider SIMD *do* help. The first question to ask before parallelizing a kernel is "where does it sit on the roofline?" — because for memory-bound work (most reductions and scans), the answer "more cores" is usually wrong and the answer is "improve locality and intensity."

### Synchronization, Imbalance, Oversubscription

- **Synchronization / barrier overhead.** Locks, atomics, and barriers cost real cycles and, worse, serialize. A barrier across `P` cores costs `Ω(log P)` at best and stalls everyone on the slowest arriver. The PRAM's free lockstep synchrony is its second-biggest lie after bandwidth. Minimize barriers; prefer lock-free reductions (per-thread accumulate, then one combine) over a shared atomic.
- **Load imbalance.** The work–span bound assumes work is divisible; if one task does 10× the work of its siblings, the critical path is that task and `P−1` cores idle waiting. Work-stealing fixes *some* imbalance automatically (idle cores steal), which is exactly why over-decomposing into more, smaller tasks than cores helps — but only down to the granularity floor below.
- **Oversubscription.** Spawning vastly more OS threads than cores causes context-switch thrash and cache pollution. Task frameworks avoid this by construction (tasks ≠ threads; a fixed worker pool sized to cores runs millions of tasks). The Go scheduler's `GOMAXPROCS`, Rayon's thread pool, and the `ForkJoinPool` parallelism level all default to core count for this reason. Hand-rolled `std::thread`-per-task is the classic oversubscription mistake.

---

## Granularity Control: The One Knob That Matters Most

Of every practical lever, **grain size** is the one you tune first and that moves performance most. The work–span model assumes a spawn is free; it is not — a `spawn`/`sync` pair costs tens to low-hundreds of cycles (deque push/pop, frame allocation, the steal protocol). If your base case is a single element, you pay that overhead *per element* and the scheduling cost swamps the actual work: a parallel sum that spawns down to one number can run **10–100× slower** than the serial loop, all overhead.

The fix is a **cutoff / grain size**: stop recursing and run the base case *serially* once the subproblem is below a threshold `G`.

```text
parallel_reduce(lo, hi):
    if hi - lo <= G:                 # GRAIN-SIZE CUTOFF
        return serial_reduce(lo, hi) # tight, vectorizable, no spawn overhead
    mid = (lo + hi) / 2
    L = spawn parallel_reduce(lo, mid)
    R =       parallel_reduce(mid, hi)
    sync
    return combine(L, R)
```

The tension is exact. Span grows only logarithmically with finer grain, but **spawn overhead grows linearly** as `O(n/G)` spawns. So you want `G` *large enough* that per-task work (`G` elements) dwarfs the spawn cost (amortizing the ~100-cycle overhead over `G` units of real work), and *small enough* that you still produce `≫ P` tasks for the work-stealer to balance load. The sweet spot is typically **thousands of elements or a few microseconds of work per leaf** — well above one element, well below `n/P`. Concretely: choose `G` so the serial base case runs for roughly **1–10 μs**, giving thousands of tasks on a large machine while making spawn overhead a sub-1% tax. TBB's `simple_partitioner` takes an explicit grain size; `auto_partitioner` and Rayon adapt it dynamically; OpenMP's `taskloop grainsize(G)` and Cilk's `cilk_for` reducer-grain expose it directly. Getting `G` right is usually worth more than any other single tuning move, and it is the first thing to sweep when a parallel algorithm underperforms.

---

## GPU / SIMT as a PRAM-Like Model

The GPU is the closest thing in production to a real PRAM — thousands of threads over a shared memory — which is exactly why data-parallel primitives (`map`, `reduce`, `scan`) port to it so naturally and why the same DAG analysis applies. But its execution model, **SIMT** (Single Instruction, Multiple Threads), adds constraints the PRAM never had.

- **Massive parallelism, lockstep warps.** A GPU runs thousands of threads, grouped into **warps** (32 threads on NVIDIA, 32/64 "wavefronts" on AMD) that execute *one instruction in lockstep*. This is nearly the synchronous-PRAM dream — until threads in a warp **diverge**: if a branch sends some warp lanes one way and some the other, the hardware *serializes* both paths, masking off the inactive lanes. Branch divergence within a warp is the SIMT analogue of load imbalance, and it can halve (or worse) effective throughput. Data-parallel `map`/`reduce`/`scan` with uniform control flow map beautifully; irregular, data-dependent branching (graph traversal with varying degree, ragged work per element) maps badly.
- **Coalesced memory.** Like the CPU, the GPU is bandwidth-bound for low-intensity kernels — but it adds **coalescing**: when the 32 threads of a warp access *consecutive* addresses, the hardware fuses them into one wide memory transaction; scattered accesses become many transactions and tank bandwidth. The GPU rewards *exactly* the contiguous, structure-of-arrays layout that the cache-aware layout discipline ([`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)) recommends — locality is even more load-bearing here than on the CPU.
- **Programming models.** CUDA (NVIDIA), SYCL / oneAPI and OpenCL (portable), and the higher-level `thrust` / `rocPRIM` / `CUB` libraries ship production `reduce`/`scan`/`sort` that are textbook `O(log n)`-span tree algorithms tuned for coalescing and shared-memory tiling.
- **When the GPU wins, and when it doesn't.** Data-parallel, high-arithmetic-intensity, regular-control-flow work (dense linear algebra, convolutions, large uniform `map`/`reduce`/`scan`, Monte Carlo) is where the GPU's thousands of lanes pay off. Irregular, branchy, pointer-chasing, low-parallelism, or transfer-dominated work (small inputs where the `PCIe`/`NVLink` copy cost exceeds the compute) often runs *slower* than a good multicore CPU. The decision is the same roofline-plus-divergence calculus: high intensity + regular access + uniform control flow → GPU; irregular branching or small data → CPU.

---

## Amdahl and Gustafson in Engineering Decisions

The two laws are not trivia; they are the *go / no-go gate* on whether to parallelize at all, and which scaling goal to chase.

**Amdahl — the question "is it even worth it?"** If a fraction `f` of the work is irreducibly serial, the maximum speedup is `1/f` no matter how many cores you throw at it. `f = 0.05` caps you at `20×`; `f = 0.25` caps you at `4×`. Before writing a line of parallel code, estimate `f`: profile, find the parallelizable fraction, and compute the ceiling. **If the parallel fraction is small, don't parallelize — optimize the serial path instead.** And there is a second, sharper Amdahl gate for the kernels in this file: *even if the parallel fraction is large, if the kernel is memory-bound, the ceiling is not `1/f` but the bandwidth wall* — a memory-bound reduction with `f ≈ 0` still tops out at ~4–8× because the bus, not the serial fraction, is the limit. Ask both: *is the parallel fraction large?* **and** *is it compute-bound or memory-bound?*

**Gustafson — the question "what's the real goal?"** Gustafson observes that in practice we don't hold the problem fixed and add cores; we *grow the problem* to fill the cores (bigger meshes, more data, higher resolution). If the serial part is constant and the parallel part scales with `n`, then as `n` and `P` grow together the serial fraction *shrinks* and speedup grows nearly linearly. This is the **weak-scaling** worldview, and it is the right one for most real workloads (rendering, simulation, training, batch analytics): the deliverable is "handle a bigger workload in the same wall-clock time," not "make this fixed job faster." Choose your metric to match your goal — **strong scaling (Amdahl) when latency on a fixed problem matters; weak scaling (Gustafson) when throughput on a growing problem matters** — and report the one your stakeholders actually care about.

---

## Worked End-to-End: A Parallel Reduction and Its Ceilings

Here is a self-contained Go program that fork–joins a sum with a grain-size cutoff, measures speedup vs `P`, and demonstrates the two ceilings this file is built around: the **granularity** floor (too-fine tasks make it slower) and the **memory-bandwidth** wall (more cores stop helping). It also predicts the Amdahl ceiling and compares it to measurement.

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// parReduceSum sums data[lo:hi] by fork-join recursion with a grain-size cutoff.
// grain G = the threshold below which we stop spawning and sum serially.
func parReduceSum(data []float64, grain int) float64 {
	n := len(data)
	if n <= grain { // GRAIN-SIZE CUTOFF: tight serial loop, no goroutine overhead
		s := 0.0
		for _, v := range data {
			s += v
		}
		return s
	}
	mid := n / 2
	var left float64
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // spawn: left half may run in parallel
		defer wg.Done()
		left = parReduceSum(data[:mid], grain)
	}()
	right := parReduceSum(data[mid:], grain) // continuation runs the right half
	wg.Wait()                                // sync: join before combining
	return left + right                      // combine
}

func serialSum(data []float64) float64 {
	s := 0.0
	for _, v := range data {
		s += v
	}
	return s
}

func timeIt(f func()) time.Duration {
	start := time.Now()
	f()
	return time.Since(start)
}

func main() {
	const n = 1 << 26 // ~67M floats = 512 MB: far larger than any cache (forces DRAM traffic)
	data := make([]float64, n)
	// NUMA note: initialize in the SAME pattern we later read (first-touch placement).
	for i := range data {
		data[i] = 1.0
	}

	base := timeIt(func() { _ = serialSum(data) })
	fmt.Printf("serial T1 = %v\n\n", base)

	// (1) GRANULARITY SWEEP at full parallelism: too-fine grain is pure overhead.
	runtime.GOMAXPROCS(runtime.NumCPU())
	fmt.Println("== Grain-size sweep (GOMAXPROCS = all cores) ==")
	for _, g := range []int{1, 1 << 4, 1 << 10, 1 << 16, 1 << 20} {
		d := timeIt(func() { _ = parReduceSum(data, g) })
		fmt.Printf("  grain=%8d  time=%-12v  speedup=%.2fx\n", g, d, float64(base)/float64(d))
	}

	// (2) STRONG SCALING at a good grain: speedup vs P, watch it bend at the bandwidth wall.
	const goodGrain = 1 << 16 // ~65k elements/leaf: ~microseconds of work, <1% spawn tax
	fmt.Println("\n== Strong scaling (fixed n, vary P), grain = 65536 ==")
	for _, p := range []int{1, 2, 4, 8, 16, runtime.NumCPU()} {
		runtime.GOMAXPROCS(p)
		d := timeIt(func() { _ = parReduceSum(data, goodGrain) })
		fmt.Printf("  P=%3d  time=%-12v  speedup=%.2fx  (ideal %d.00x)\n",
			p, d, float64(base)/float64(d), p)
	}

	// (3) AMDAHL prediction vs measurement: solve for the serial fraction f.
	runtime.GOMAXPROCS(2)
	t2 := timeIt(func() { _ = parReduceSum(data, goodGrain) })
	s2 := float64(base) / float64(t2) // measured speedup at P=2
	// S(2) = 1 / (f + (1-f)/2)  =>  f = (2 - S2) / S2  (clamped at 0)
	f := (2 - s2) / s2
	if f < 0 {
		f = 0
	}
	fmt.Printf("\n== Amdahl ==\n  measured S(2)=%.2fx -> implied serial f=%.3f -> ceiling 1/f=%.1fx\n",
		s2, f, 1/f)
}
```

**What the run shows (qualitatively — exact numbers are machine-specific):**

1. **Granularity ceiling.** `grain=1` is *catastrophic* — sub-1× speedup, often 10–50× *slower* than serial — because every leaf spawns a goroutine and the scheduler overhead swamps a single addition. As grain climbs past ~`2^10`, the spawn tax amortizes and speedup rises, plateauing once leaves are large enough that overhead is negligible. This is the grain-size knob in action: the *same algorithm* ranges from "much worse than serial" to "good speedup" purely on the cutoff.
2. **Bandwidth wall.** With a good grain, strong scaling rises nicely to ~4–8 cores and then **bends and flattens** — not because of span (`T₁/T∞` for a 67M-element reduction is enormous, ~`n/log n ≈ 3M`) but because summing 512 MB is **memory-bound**: once enough cores saturate the DRAM bus, additional cores read no faster. The PRAM predicts near-linear scaling to millions of processors; the memory bus caps it at single-digit speedup. This *is* the roofline's memory-bound diagonal, measured.
3. **Amdahl back-out.** Solving `S(2)` for `f` recovers a small but nonzero serial fraction (allocation, the final combine, scheduler ramp-up) and prints the implied ceiling `1/f`. Comparing that predicted ceiling to the measured plateau from step 2 is the empirical-Amdahl diagnostic — and when the measured plateau (set by bandwidth) is *below* the Amdahl ceiling (set by `f`), you have *proven* the bottleneck is bandwidth, not serial code, and that adding cores or reducing `f` won't help — only improving locality/intensity will.

The whole program is ~80 lines and is, structurally, a miniature scaling study: grain sweep, strong-scaling curve, Amdahl back-out. The production version of this reduction — work-efficiency, the scan generalization, and the tree's `O(log n)` span — is in [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md).

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Designing any parallel algorithm | **Work–span DAG**: compute `T₁`, `T∞`, parallelism `T₁/T∞` | the framework-independent contract; aim for `T₁/T∞ ≫ P` ([`../07-fork-join-and-work-stealing/professional.md`](../07-fork-join-and-work-stealing/professional.md)) |
| Fork–join in C/C++ | **Cilk / OpenMP tasks / TBB / `std::par`** | work-stealing runtimes deliver `T₁/P + O(T∞)` for free |
| Fork–join in Rust / Java | **Rayon `join`/`par_iter`** / **`ForkJoinPool`** | same DAG, same bound; high-level iterators generate the reduce tree |
| Concurrent/branchy tasks in Go | **goroutines + `errgroup`** | `M:N` stealing scheduler; `errgroup` adds first-error + cancellation |
| "Will parallelizing help at all?" | **Amdahl + roofline** | check parallel fraction *and* compute- vs memory-bound first |
| Parallel algorithm runs *slower* than serial | **Coarsen the grain size first** | too-fine tasks make spawn overhead dominate — the #1 cause |
| Speedup bends/flattens early | **Suspect the memory-bandwidth wall** | reductions/scans are memory-bound; cores past bus saturation are idle |
| Got *slower* with more threads | **Hunt false sharing / oversubscription** | pad accumulators to a cache line; size pool to cores ([`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)) |
| Multi-socket machine | **NUMA-aware first-touch + local partitioning** | init data in parallel from the owning cores; avoid remote DRAM |
| Predict speedup before full run | **Cilkscale**: measure `T₁`, `T∞` → `T₁/T∞` | parallelism number tells you the saturation point in advance |
| "Fixed job faster" vs "bigger job same time" | **Strong (Amdahl)** vs **weak (Gustafson)** scaling | match the metric to the actual goal; report that one |
| Regular, high-intensity, uniform-control-flow data parallelism | **GPU (CUDA / SYCL / thrust / CUB)** | thousands of lanes; needs coalesced access, no warp divergence |
| Irregular, branchy, small, or transfer-dominated work | **Stay on multicore CPU** | divergence + copy cost sink the GPU |

Three rules of thumb:

1. **Design in work–span, debug in physical reality.** Expose high parallelism (`T₁/T∞ ≫ P`) so the scheduler has room, then assume the *actual* ceiling is bandwidth, NUMA, false sharing, sync, or granularity — not span. Measure to find which.
2. **Tune grain size before anything else.** The cutoff that stops recursion and runs a serial base case is the highest-leverage knob; target ~1–10 μs of work per leaf. A too-fine grain alone can turn a 7× speedup into a 0.2× slowdown.
3. **Ask Amdahl *and* roofline before parallelizing.** Is the parallel fraction large *and* is the kernel compute-bound? If the fraction is small, optimize the serial path; if it's memory-bound, improve locality/intensity — in both cases adding cores is the wrong move.

---

## Research Pointers

- **Blumofe, R. D., & Leiserson, C. E. (1999). "Scheduling Multithreaded Computations by Work Stealing."** *JACM* 46(5). The `E[T_P] ≤ T₁/P + O(T∞)` theorem and `O(P·S₁)` space bound — the proof that every framework in this file delivers the work–span contract on a decentralized scheduler.
- **Frigo, M., Leiserson, C. E., & Randall, K. H. (1998). "The Implementation of the Cilk-5 Multithreaded Language."** *PLDI.* The work-first principle, the THE deque protocol, and the runtime design that all modern task schedulers (TBB, Rayon, `ForkJoinPool`) descend from.
- **He, Y., Leiserson, C. E., & Leiserson, W. M. (2010). "The Cilkview Scalability Analyzer."** *SPAA.* How measuring `T₁` and `T∞` from one run predicts the speedup curve — the tool behind the "measure work and span in practice" section (now OpenCilk's Cilkscale).
- **Williams, S., Waterman, A., & Patterson, D. (2009). "Roofline: An Insightful Visual Performance Model for Multicore Architectures."** *CACM* 52(4). The arithmetic-intensity / bandwidth-roof model that decides whether more cores can help — the formal basis of "memory-bound vs compute-bound."
- **Amdahl, G. (1967)** and **Gustafson, J. (1988).** The fixed-problem speedup ceiling `1/f` and its strong/weak-scaling resolution — the go/no-go gate on parallelizing at all.
- **Drepper, U. (2007). "What Every Programmer Should Know About Memory."** The definitive practitioner reference for NUMA, cache coherence, and false sharing — the physical costs the PRAM omits.
- **Robison, A., Voss, M., & Kim, A. — Intel TBB; Lea, D. — `java.util.concurrent.ForkJoinPool`; Rayon (Stone et al.).** Production work-stealing runtimes; their docs are the practical companion to the theory here.
- **NVIDIA CUDA C++ Programming Guide** (SIMT, warps, coalescing) and **Harris, M. "Optimizing Parallel Reduction in CUDA."** The GPU reduction as a tuned `O(log n)`-span tree — the SIMT section made concrete.

---

## Key Takeaways

1. **Work–span is the framework-independent design contract.** `spawn`/`sync` *is* the DAG; Cilk, OpenMP tasks, TBB, Rayon, `ForkJoinPool`, Go goroutines+`errgroup`, and `std::par` are all work-stealing schedulers delivering `T₁/P + O(T∞)`. You expose high parallelism (`T₁/T∞ ≫ P`) and let the runtime map it; high-level `par_iter`/`reduce`/`reduction` constructs generate the `Θ(n)`-work, `Θ(log n)`-span tree for you.
2. **Measure `T₁` and `T∞` — they're machine-independent and predictive.** Cilkscale computes work, span, and parallelism from one run and predicts the speedup curve. Strong scaling (fixed `n`, vary `P`) exposes the span/serial ceiling; weak scaling (grow `n` with `P`) tests overhead growth; inverting Amdahl backs out the serial fraction `f`.
3. **The PRAM's lies are where speedup dies.** Memory **bandwidth** is the real ceiling for reductions/scans (4–8 cores saturate the bus, not 64); **NUMA**, **cache coherence**, and **false sharing** punish bad layout; **barriers/locks** serialize; **load imbalance** idles cores; **oversubscription** thrashes. None of these are in the work–span bound — measure to find which one is your wall.
4. **Granularity is the knob that matters most.** A grain-size cutoff that runs the base case serially below a threshold is the difference between a 0.2× slowdown and a 7× speedup. Target ~1–10 μs of work per leaf: large enough to amortize spawn overhead, small enough to give the stealer `≫ P` tasks.
5. **The roofline decides whether cores help.** Below the ridge point a kernel is memory-bound and more cores do nothing once the bus saturates — improve locality/intensity instead; above it, compute-bound work scales. Ask Amdahl (is the parallel fraction large?) *and* roofline (is it compute-bound?) before parallelizing.
6. **The GPU is a PRAM-like SIMT machine.** Thousands of lockstep-warp threads make data-parallel `map`/`reduce`/`scan` with coalesced access and uniform control flow fly (CUDA/SYCL/thrust/CUB); branch divergence and irregular access or small/transfer-bound data sink it back below a good multicore CPU.

---

> **See also:** [`./senior.md`](./senior.md) for `NC`, `P`-completeness, PRAM lower bounds, and the work-stealing theorem · [`../07-fork-join-and-work-stealing/professional.md`](../07-fork-join-and-work-stealing/professional.md) for the deque mechanics and steal protocol behind the schedulers · [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) for the production reduce/map/scan primitives whose DAG this file schedules · [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md) for the layout discipline that fixes false sharing, NUMA, and coalescing
