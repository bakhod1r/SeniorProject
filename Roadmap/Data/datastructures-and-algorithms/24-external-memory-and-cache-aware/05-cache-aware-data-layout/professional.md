# Cache-Aware Data Layout — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Data-Oriented Design in Game Engines: ECS, Archetypes, and the Measured Win](#data-oriented-design-in-game-engines-ecs-archetypes-and-the-measured-win)
3. [Columnar Analytics: Arrow, Parquet, and Vectorized Execution](#columnar-analytics-arrow-parquet-and-vectorized-execution)
4. [Concurrency and False Sharing in Production](#concurrency-and-false-sharing-in-production)
5. [Alignment, Prefetch, and NUMA First-Touch](#alignment-prefetch-and-numa-first-touch)
6. [Search Structure Layout: Eytzinger, CSB+, and FAST](#search-structure-layout-eytzinger-csb-and-fast)
7. [Methodology: Proving You Are Memory-Bound](#methodology-proving-you-are-memory-bound)
8. [Worked End-to-End: A False-Sharing Fix With Scaling Numbers](#worked-end-to-end-a-false-sharing-fix-with-scaling-numbers)
9. [Decision Framework](#decision-framework)
10. [Research and System Pointers](#research-and-system-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) established the discipline: data-oriented design as the architectural generalization of AoS→SoA, Chilimbi's cache-conscious structures, the Eytzinger/vEB/CSB+ layouts, space-filling curves, columnar storage with PAX, and NUMA first-touch. That is the *why* and the *vocabulary*. This tier is the *where and how in production* — the specific systems where data layout is the load-bearing performance decision, the measured wins they report, and the methodology that tells you whether layout is even your problem before you spend a week reorganizing memory.

The thesis has three parts. First, **layout decides real performance in exactly the places where the working set exceeds cache and the access pattern is a bulk sweep**: game-engine entity processing every frame, OLAP scans over billions of rows, and per-core hot counters under contention. In those three domains the layout is not a micro-optimization — it is the difference between scaling and not scaling, between a 60 FPS frame budget and dropped frames, between an interactive query and a coffee break. Second, **the wins are measurable and the mechanism is always the same**: convert a latency-bound, bandwidth-wasting random access pattern into a contiguous, prefetchable, SIMD-friendly stream, and watch IPC rise and LLC misses fall. Third — the professional's discipline — **you measure first**. Layout optimization has a real cost (it complicates code, fights abstraction, and is easy to get subtly wrong), so you confirm you are memory-bound with hardware counters and the roofline before you commit, and you know that on a compute-bound or already-prefetched loop the whole exercise buys nothing.

This file works through the three production domains (ECS, columnar analytics, false-sharing concurrency), the supporting techniques (alignment, prefetch, NUMA, implicit search layouts), the profiling methodology that gates all of it, and a runnable false-sharing benchmark with the scaling curve that makes the cost concrete.

---

## Data-Oriented Design in Game Engines: ECS, Archetypes, and the Measured Win

Game engines are the purest production case for data-oriented design, because the workload is brutal and regular: **transform thousands of entities, every field-by-field, sixty or more times a second**, inside a fixed ~16 ms frame budget. There is no room for the OOP object-graph tax.

### The OOP object graph and why it stalls

The naive engine is a `GameObject` hierarchy: each entity is a heap-allocated object holding `position`, `velocity`, `health`, `mesh*`, `ai_state*`, `transform`, and a vtable, scattered across the heap, often reached through a vector of `GameObject*`. The frame loop that integrates physics — `pos += vel * dt` over every entity — does the following per element: dereference a pointer (miss), pull a ~128–256 byte object into cache to use 24 bytes of it (bandwidth waste), and possibly dispatch a virtual call (indirect branch). The pointer-chase serializes the misses, the cold fields evict useful lines, and the loop runs at a small fraction of memory bandwidth. The senior tier named this cost model; the engine is where it bites hardest.

### The Entity-Component-System (ECS) and the AoS→SoA transformation

An **Entity-Component-System** rejects the object graph. An *entity* is just an ID. *Components* are plain data (`Position`, `Velocity`, `Health`), stored in **contiguous component arrays**, not inside objects. A *system* is a function that sweeps the arrays it needs (a physics system reads `Velocity`, writes `Position`) in a tight, branch-free loop over contiguous memory. This is AoS→SoA promoted to the engine's primary architecture: instead of an array of fat `GameObject`s, you have a `Position[]` and a `Velocity[]`, each densely packed, each swept linearly.

**Archetypes** are how mature ECS frameworks organize the arrays. An archetype is the set of component *types* an entity has; all entities sharing an archetype are stored together in chunked column arrays (a "table" of components). Iterating a query (`all entities with Position and Velocity`) becomes iterating the matching archetypes' chunks contiguously — a linear scan with perfect prefetch and no per-element type check (the type *is* the chunk you are in, the existential-processing idea from senior). The production frameworks:

- **Unity DOTS / ECS with the Burst compiler.** Archetype chunks (16 KiB by default) hold components column-wise; Burst compiles the C# system jobs to SIMD-vectorized native code over those contiguous chunks. Unity's own case studies report multi-fold throughput gains versus `MonoBehaviour` object code, driven by cache locality plus vectorization plus job-system parallelism — the canonical "the layout enabled the vectorizer" story.
- **EnTT** (C++): a sparse-set ECS where each component type owns a dense, contiguous array plus a sparse index; iteration over a component (or a multi-component view/group) is a contiguous scan. Widely used in shipping games for exactly the iteration locality.
- **Bevy ECS** (Rust): archetype/table storage with a query system that sweeps component columns; the same DOD payoff in a memory-safe language.

### The measured win

The mechanism, stated as a budget: an AoS `GameObject` sweep that uses 24 of 256 bytes per element runs at roughly 24/256 ≈ 9% of useful bandwidth and pays a dependent miss per element. The SoA component arrays pack ~5 `Position`s (12 B each) into a 64 B line, use every byte, stream linearly so the prefetcher hides latency, and feed the SIMD unit. The reported deltas in DOD talks and engine benchmarks are consistent: **large drops in L1/LLC cache misses, a several-fold rise in IPC (the core stops stalling and starts retiring), and end-to-end frame-time improvements that are frequently 3–10× on the hot entity loops.** Mike Acton's *"Data-Oriented Design and C++"* (CppCon 2014) is the canonical reference and the source of the framing — design for the *many*, organize by transformation, let position-in-array encode state. The senior tier ([`./senior.md`](./senior.md)) develops the discipline; the engine is the proof it pays.

---

## Columnar Analytics: Arrow, Parquet, and Vectorized Execution

If ECS is SoA at the engine scale, **columnar analytics is SoA at the dataset scale**, and it is the single most consequential cache-aware layout in data systems. The reason column stores dominate OLAP is exactly the AoS→SoA argument: an analytical query touches a few columns across millions of rows, so storing each column contiguously means the scan reads *only* the bytes it needs, and four compounding wins follow.

### The in-memory and on-disk formats

- **Apache Arrow** is the standardized **in-memory** columnar format: each column is a contiguous, type-specific buffer (values buffer + validity bitmap), explicitly laid out for SIMD and zero-copy sharing across process and language boundaries. Arrow is the lingua franca that lets engines exchange columnar data without serialization, and its memory layout *is* the cache-aware layout — aligned, contiguous, null-bitmap-separate so the values buffer is dense.
- **Parquet and ORC** are the **on-disk** columnar formats. They store data in row groups (PAX-style — see [`./senior.md`](./senior.md)); within a row group each column is a separate chunk, compressed and encoded, with per-chunk min/max statistics for predicate pushdown (skip a chunk whose `[min,max]` cannot satisfy the filter). The on-disk layout mirrors the in-memory one: columnar, so a scan reads only the projected columns' chunks from storage.

### Vectorized / batch execution

Modern OLAP engines do not process a row at a time; they process a **batch (vector) of a column at a time** — typically a cache-resident block of ~1k–8k values — through each operator. **DuckDB**, **ClickHouse**, and **Velox** (Meta's execution engine library, shared by Presto/Spark integrations) all run this vectorized model. The hot loop is a tight, branch-light scan over a contiguous column batch, which the compiler auto-vectorizes (or the engine hand-writes in SIMD intrinsics) to apply a predicate or aggregate to 8/16/32 lanes per instruction. The vector is sized to stay in L1/L2, so the operator is bandwidth-bound on contiguous memory, not latency-bound on scattered rows — the cache-aware design choice baked into the execution model.

### Compression as effective-bandwidth multiplier

A column of like-typed values compresses far better than a heterogeneous row, and crucially **operators can run directly on the encoded form**, saving both I/O and CPU:

- **Dictionary encoding** maps wide/repeated values to small integer codes; predicates compare codes, group-bys hash codes.
- **Run-length encoding (RLE)** crushes sorted or low-cardinality columns; aggregates sum over runs.
- **Bit-packing** stores integers in the minimum bits needed.
- **Frame-of-reference (FOR)** stores each value as a small delta from a block reference, then bit-packs the deltas — ideal for sorted or clustered numeric columns.

Compression multiplies effective bandwidth (more useful values per fetched byte) and shrinks the working set so more of it stays cache-resident — bandwidth and cache pressure improved at once.

### Late materialization

Because columns are separate, the engine applies predicates on a few columns, produces a **position/selection list** of surviving rows, and fetches the wide columns *only for those positions* — deferring (materializing) the heavy columns until late, so cold columns of rejected rows are never touched. This is existential-processing/DOD at query-engine scale, and it is why column stores win selective queries by a wide margin. The synthesis: **column stores dominate OLAP because the layout reads only touched columns, vectorizes the scan over contiguous batches, compresses each column heavily (and operates on the compressed form), and skips cold data via late materialization** — four wins from one layout decision, PAX being the row/column hybrid that gives the same benefit at page granularity for systems that also need fast row reconstruction.

---

## Concurrency and False Sharing in Production

The first two domains are about *using* bandwidth well in a single thread. Concurrency adds a different layout hazard that does not show up until you scale across cores: **false sharing** — two threads writing to distinct variables that happen to share one 64 B cache line, so the cache-coherence protocol ping-pongs the line between cores' caches even though there is no logical contention. The classic symptom: a perfectly parallel workload that *gets slower* as you add cores, or refuses to scale past two.

### Padding hot per-thread state to a cache line

The fix is to ensure each thread's frequently-written datum sits alone on its own cache line. The idioms:

- **C++:** `alignas(std::hardware_destructive_interference_size)` (the standard's name for the cache-line size to pad *against* false sharing; its sibling `hardware_constructive_interference_size` is the size to pack *into* one line) — or pad an array of per-thread counters so `sizeof(slot) == 64`.
- **Go:** pad structs with `_ [64]byte` or `_ [cacheLinePad]byte` fields; the runtime itself does this for per-P (per-processor) structures, and `sync.Pool`/scheduler internals are line-padded.
- **Java:** `@jdk.internal.vm.annotation.Contended` (formerly `@Contended`), which the JVM honors by padding the field to its own line. `java.util.concurrent.atomic.LongAdder` uses exactly this.

### The striped-counter / LongAdder pattern

A single shared atomic counter under high write contention is a scaling disaster — every increment is a coherence round trip on one line. The **striped counter** pattern (Java's `LongAdder`, Go's sharded counters, C++ per-thread accumulators) replaces it with an *array* of cells, each padded to its own line; a thread increments the cell it hashes to, and `sum()` adds the cells. Writes spread across lines (no contention), reads pay an O(cells) sum — the right trade when writes vastly outnumber reads, which is the common case for metrics and statistics. The same logic drives **per-core / per-slot layout** of locks and queues: a striped lock array, an MPMC ring buffer with each producer/consumer index on its own line, a sharded allocator with per-core freelists — all so the hot mutable index of one core never shares a line with another's.

### Real bugs

False sharing has tanked scaling in production repeatedly: a `struct` of per-thread statistics counters laid out as adjacent `int64`s (8 of them on one 64 B line) that turned an 8-core run into something slower than single-threaded; a lock-free queue whose head and tail indices shared a line so producer and consumer fought over it; framework thread pools whose per-worker state was densely packed. The fix is always the same and always cheap: pad to a line, or stripe. The cost is memory (a 64 B slot to hold an 8 B counter wastes 56 B per thread) — acceptable for the handful of genuinely hot, contended variables, *not* something to sprinkle everywhere, which is why you pad the *profiled* hot ones, not all of them.

---

## Alignment, Prefetch, and NUMA First-Touch

Three supporting techniques recur across all three domains.

**Cache-line-aligned allocation.** Hot data structures — ring-buffer slots, per-thread counters, SIMD operands — should start on a 64 B boundary so one logical object maps to whole lines (no straddling, predictable coherence). Use `alignas(64)`, `posix_memalign`/`aligned_alloc`, or `std::aligned_storage`; align SIMD arrays to the vector width (32 B for AVX2, 64 B for AVX-512) so loads are aligned and the compiler need not emit split-load fixups.

**SoA enabling auto-vectorization.** The deep reason DOD and columnar layouts vectorize and AoS does not: a SIMD instruction wants `N` consecutive same-typed values in one vector register. SoA *gives* that — `position.x[i..i+8]` is a contiguous, aligned run the compiler loads with one `vmovaps`. AoS scatters the same field across strided object slots, forcing a slow gather (or defeating vectorization entirely). **SoA is the layout that makes auto-vectorization legal and cheap**, which is why the engine and the query engine both adopt it — the layout is a prerequisite for the SIMD win, not a separate optimization.

**Software prefetch for pointer-heavy traversals.** When the access pattern is *not* a clean stream — a hash-table probe, a linked traversal, a graph BFS — the hardware prefetcher cannot predict the next address, and you can issue `__builtin_prefetch(addr, rw, locality)` (or `_mm_prefetch`) for an address you will need a few iterations ahead. The classic win is *prefetch-ahead in a loop over an index array*: while processing element `i`, prefetch the target of element `i+K` so its line arrives by the time you reach it. This requires you to know the future address early (an index/key you can hash now), and `K` must be tuned to the loop's per-iteration latency — too small and the prefetch is late, too large and it evicts before use. It is a sharp tool: measurable wins on pointer-chasing inner loops, easy to make worse if mistuned.

**NUMA first-touch placement.** On a multi-socket server, a page is physically placed on the node of the thread that *first writes* it (senior tier). The professional consequence: **initialize data with the same parallel decomposition that will process it**, so each thread first-touches the partition it will own and all later accesses are node-local. A single init thread that touches the whole array lands it all on one node, making every other thread's access remote and capping scaling — a bug that looks like a scaling problem but is a placement problem. Use `numactl`/`libnuma`/`mbind` to override when the natural touch order does not match the access pattern.

---

## Search Structure Layout: Eytzinger, CSB+, and FAST

When the hot structure is a *search* over sorted in-memory data, the layout of the same logical tree dominates the algorithm, and the professional move is often to **abandon pointers for an implicit array layout**.

**Eytzinger / implicit binary search.** Store the balanced BST in breadth-first order in an array (root at index 1, children of `i` at `2i`, `2i+1`) and search with the branch-free descent `i = 2*i + (x > a[i])`. Against `std::lower_bound` (sorted-array binary search), Eytzinger wins because (1) the hot root region is packed at the array's front and stays resident, (2) future probes `2i, 4i, …` are *known ahead* and prefetchable, so the dependent-miss chain that sorted-array search *serializes* becomes *pipelined*, and (3) the descent is branch-free, killing the famously-unpredictable binary-search mispredict. Khuong–Morin's *"Array Layouts for Comparison-Based Searching"* (2017) benchmarked this exhaustively and found Eytzinger-with-prefetch the practical winner on in-memory data — frequently ~2× over `std::lower_bound` at large `N`. The senior tier ([`./senior.md`](./senior.md)) derives the miss calculation.

**CSB+-trees / cache-line-sized nodes.** For a *dynamic* in-memory index, size the B+-tree node to a small number of cache lines and, per Rao–Ross's **CSB+-tree**, store a node's children *contiguously* so only one child-group pointer is stored instead of one per child — nearly doubling fanout (freed bytes hold keys), lowering height and lines-touched-per-search. The general principle: a node is a cache line; navigate within it by arithmetic, not stored pointers.

**FAST (Kim et al., SIGMOD 2010).** *"FAST: Fast Architecture Sensitive Tree search on modern CPUs and GPUs"* takes implicit layout to its conclusion: a binary tree laid out to be simultaneously **SIMD-blocked** (the top few levels fit a SIMD register, searched with vector compares), **cache-line-blocked**, and **page-blocked** — a hierarchy of implicit blockings, one per architectural level, all pointer-free arithmetic addressing. FAST is the cache-aware mirror of the cache-oblivious vEB idea, but it *names* every level (SIMD width, line size, page size) to extract maximum constant-factor throughput, and reports large speedups over conventional trees by exploiting SIMD + cache + TLB blocking together.

**When to go implicit.** Abandon pointers for an implicit/array layout when the structure is **read-mostly and the key set is static or rarely changes** (rebuilding an implicit array on update is expensive), the data is **in-memory** (the win is cache misses, not disk I/O), and search is hot enough to justify the rebuild cost on writes. For write-heavy or persistent indexes, keep the pointered B+-tree (or its LSM/`B^ε` cousin in [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md)).

---

## Methodology: Proving You Are Memory-Bound

This is the section that gates everything above. Layout optimization is expensive in engineering time and code clarity; the professional confirms it is the right lever before pulling it.

**Step 0 — roofline: memory-bound or compute-bound?** The roofline model plots attainable performance against **arithmetic intensity** (FLOPs or useful-ops per byte moved from memory). A kernel with low arithmetic intensity sits under the slanted "memory-bandwidth" roof — it is **memory-bound**, and improving layout (fewer bytes, better locality, more bandwidth utilization) raises performance. A kernel with high intensity sits under the flat "compute" roof — it is **compute-bound**, and no amount of layout work helps; you need better instruction selection or more cores. *Establish which regime you are in first.* Layout beats algorithm only when you are memory-bound and the algorithm is already near-optimal in op count.

**Step 1 — read the cache and TLB counters.** On Linux with `perf`:

```text
perf stat -e cycles,instructions,\
  L1-dcache-loads,L1-dcache-load-misses,\
  LLC-loads,LLC-load-misses,\
  dTLB-loads,dTLB-load-misses \
  ./bench

# Interpreting:
#   instructions / cycles                      -> IPC; low IPC + high misses => stalling on memory
#   LLC-load-misses / LLC-loads                -> last-level miss rate; misses that go to DRAM (the expensive ones)
#   L1-dcache-load-misses / L1-dcache-loads    -> L1 pressure
#   dTLB-load-misses / dTLB-loads              -> TLB pressure; high => working set spans too many pages
```

A high **LLC-load-miss** rate with **low IPC** is the signature of a memory-bound loop stalling on DRAM — exactly what better layout fixes. A high **dTLB-load-miss** rate says your working set is spread across too many pages (consider hugepages or a denser layout). For deterministic, machine-independent miss counts when comparing two layouts without hardware noise, use **cachegrind** (`valgrind --tool=cachegrind`). For deep attribution, **Intel VTune** (Memory Access analysis) and the **top-down methodology** (`toplev` / `perf`'s topdown events) decompose stalls into front-end / back-end / memory-bound buckets and tell you the fraction of cycles lost specifically to *memory* — the single number that justifies (or refutes) a layout project.

**Step 2 — identify the memory-bound loop.** Profile to the loop, confirm via top-down that its stalls are memory-bound (not branch-mispredict or front-end), then check whether it is *latency*-bound (pointer-chasing, dependent misses — fix with prefetch or implicit layout) or *bandwidth*-bound (streaming but wasting bytes — fix with SoA/columnar/compression). The fix follows the diagnosis.

**When layout beats algorithm — and when not.** Layout beats algorithm when the op count is already near-minimal and the bottleneck is the rate bytes arrive (the common case for sweeps, scans, and searches over large data on memory-wall hardware). Algorithm beats layout when you are doing asymptotically too much work — no layout saves an `O(N²)` loop that should be `O(N log N)`. **The cost of premature layout optimization is real**: SoA fragments code and fights readability, padding wastes memory, implicit layouts make updates expensive, and a layout tuned to one machine's line/page sizes can be wrong on the next. Measure that you are memory-bound, fix the algorithm first if it is wrong, *then* lay out to match the access pattern — and re-measure to prove the win (rising IPC, falling LLC misses), not assume it.

---

## Worked End-to-End: A False-Sharing Fix With Scaling Numbers

False sharing is the layout bug with the most dramatic, most reproducible scaling signature, so it makes the cleanest worked example. Below, `N` threads each increment their own counter in a tight loop. In the **unpadded** version the counters are adjacent `int64`s — eight to a 64 B line — so all threads pound one (or few) lines and coherence traffic serializes them. In the **padded** version each counter sits alone on its own line, so there is zero coherence contention and the work scales linearly. (Go; the same shape holds in C/C++ with `alignas(64)`.)

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const iters = 50_000_000

// --- UNPADDED: counters are adjacent int64s; 8 share one 64 B cache line. ---
type unpadded struct {
	c [8]int64 // all in 1–2 cache lines -> false sharing across threads
}

// --- PADDED: each counter is alone on its own 64 B cache line. ---
type paddedCounter struct {
	c   int64
	_   [56]byte // 8 (int64) + 56 (pad) = 64 -> one counter per line, no sharing
}
type padded struct {
	c [8]paddedCounter
}

func runUnpadded(n int) time.Duration {
	var u unpadded
	var wg sync.WaitGroup
	start := time.Now()
	for t := 0; t < n; t++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				atomic.AddInt64(&u.c[id], 1) // thread id writes its slot -> false sharing
			}
		}(t)
	}
	wg.Wait()
	return time.Since(start)
}

func runPadded(n int) time.Duration {
	var p padded
	var wg sync.WaitGroup
	start := time.Now()
	for t := 0; t < n; t++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				atomic.AddInt64(&p.c[id].c, 1) // each slot on its own line -> no sharing
			}
		}(t)
	}
	wg.Wait()
	return time.Since(start)
}

func main() {
	for _, n := range []int{1, 2, 4, 8} {
		un := runUnpadded(n)
		pa := runPadded(n)
		fmt.Printf("threads=%d  unpadded=%-8v padded=%-8v  speedup=%.2fx\n",
			n, un.Round(time.Millisecond), pa.Round(time.Millisecond),
			float64(un)/float64(pa))
	}
}
```

The shape of the result (exact numbers depend on the CPU; the *pattern* is the lesson) on a typical multi-core desktop:

```text
threads=1  unpadded=~210ms  padded=~210ms   speedup=~1.0x   # one writer: no sharing either way
threads=2  unpadded=~430ms  padded=~210ms   speedup=~2.0x   # unpadded already worse than 1 thread
threads=4  unpadded=~900ms  padded=~215ms   speedup=~4.2x   # unpadded ~4x slower; padded flat
threads=8  unpadded=~1900ms padded=~230ms   speedup=~8x     # unpadded scales NEGATIVELY
```

Read the two curves. The **padded** version is *flat* — total wall time barely moves as threads grow, because each thread does its 50M increments on its own line with no interference; that is perfect scaling of independent work. The **unpadded** version gets *worse with every added thread*: each increment requires acquiring the contended line exclusively (a coherence round trip), and with more threads fighting one line the per-increment cost climbs, so the program exhibits **negative scaling** — the textbook false-sharing signature. The fix cost 56 bytes per counter and one struct field. Confirm the mechanism with `perf stat -e cache-misses,LLC-load-misses ./bench`: the unpadded run shows LLC/coherence misses exploding with thread count while the padded run's stay flat — the counter evidence that the slowdown is the cache line, not the algorithm.

(For the AoS→SoA variant of this worked example, the same methodology applies: `perf stat` the AoS sweep, see ~90% wasted bandwidth and high LLC misses, transpose hot fields to SoA arrays, re-measure, and watch IPC rise as the loop auto-vectorizes — the engine win of the first section, in miniature.)

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Sweep many entities, one field at a time, every frame | **ECS / archetypes (SoA component arrays)** | Contiguous, prefetchable, vectorizable; the OOP object graph stalls (Acton DOD) |
| OLAP scan over few columns of many rows | **Columnar (Arrow in-mem, Parquet/ORC on disk) + vectorized exec** | Reads only touched columns; SIMD over batches; compression multiplies bandwidth |
| Need scans *and* fast row reconstruction | **PAX-style hybrid** (column-major within a row group) | Cache-efficient scan, in-page/row-group reconstruction ([`./senior.md`](./senior.md)) |
| Hot per-thread counter / atomic under contention | **Pad to a cache line** (`hardware_destructive_interference_size`, `@Contended`, Go pad) | Eliminates false sharing; the line stops ping-ponging |
| One shared counter, write-heavy | **Striped counter / LongAdder** (padded cells) | Spreads writes across lines; O(cells) read — fine when writes dominate |
| Lock / queue contended across cores | **Per-core / per-slot layout** (line-aligned indices) | Head/tail and per-worker state each on its own line |
| Hot loop over homogeneous data, want SIMD | **SoA + cache-line alignment** | SoA makes auto-vectorization legal; alignment avoids split loads |
| Pointer-chasing / hash-probe inner loop | **Software prefetch (`__builtin_prefetch`) ahead by K** | Hardware prefetcher can't predict; issue the miss early to overlap latency |
| Multi-socket parallel workload | **NUMA first-touch by partition** | Place each thread's data on its node; avoid remote-interconnect traffic |
| Read-mostly static in-memory search | **Eytzinger / implicit array; FAST for SIMD+cache+page** | Branch-free, prefetchable, pointer-free; beats `std::lower_bound` (Khuong–Morin; Kim et al.) |
| Dynamic in-memory index | **CSB+-tree / cache-line-sized nodes** | Contiguous child group → ~2× fanout → fewer lines per search |

Three rules of thumb:

1. **Measure before you reorganize memory.** Confirm memory-boundedness via the roofline and `perf` top-down; confirm it is *latency*-bound (→ prefetch/implicit layout) or *bandwidth*-bound (→ SoA/columnar/compression). Fix a wrong algorithm before any layout work — layout never rescues `O(N²)`.
2. **Pad the profiled hot variables, not everything.** False-sharing padding wastes memory and SoA fragments code; apply both only where the profile shows the contention or the bandwidth waste. Premature layout optimization is a real cost.
3. **Prove the win with counters, not vibes.** A successful layout change shows up as *rising IPC* and *falling LLC/dTLB misses* (and flat scaling curves for the concurrency fixes). If the counters do not move, you optimized the wrong thing.

---

## Research and System Pointers

- **Acton, M. (2014). "Data-Oriented Design and C++."** *CppCon.* The canonical DOD reference: transform-the-data premise, "where there's one, there's many," and the memory-wall cost argument behind ECS.
- **Chilimbi, T. M., Hill, M. D., & Larus, J. R. (1999). "Cache-Conscious Structure Layout / Definition."** *PLDI.* Structure splitting, field reordering, and instance clustering (`ccmalloc`) — the rigorous basis for hot/cold and SoA transforms.
- **Apache Arrow.** The standardized in-memory columnar format (contiguous typed buffers, separate validity bitmap, SIMD-aligned); the interchange layer beneath DuckDB, Velox, pandas/Polars, and Spark.
- **Boncz, P., Zukowski, M., & Nes, N. (2005). "MonetDB/X100: Hyper-Pipelining Query Execution."** *CIDR.* The vectorized columnar execution model behind DuckDB/ClickHouse/Velox.
- **Abadi, D., Boncz, P., Harizopoulos, S., et al. (2013). "The Design and Implementation of Modern Column-Oriented Database Systems."** *Foundations and Trends in Databases.* Compression (dictionary, RLE, bit-pack, FOR), late materialization, and why columns dominate OLAP.
- **Ailamaki, A., DeWitt, D. J., Hill, M. D., & Skounakis, M. (2001). "Weaving Relations for Cache Performance."** *VLDB.* **PAX** — the row/column hybrid page layout, ancestor of Parquet/ORC row groups.
- **Kim, C., et al. (2010). "FAST: Fast Architecture Sensitive Tree Search on Modern CPUs and GPUs."** *SIGMOD.* SIMD + cache-line + page-blocked implicit tree search; the architecture-sensitive pointer-free layout.
- **Khuong, P.-V., & Morin, P. (2017). "Array Layouts for Comparison-Based Searching."** *ACM JEA.* The definitive empirical case for Eytzinger-with-prefetch over `std::lower_bound`, B-tree, and vEB layouts.
- **Drepper, U. (2007). "What Every Programmer Should Know About Memory."** The exhaustive practitioner's reference for caches, NUMA, false sharing, prefetch, and the measurement methodology of this tier.
- **Williams, S., Waterman, A., & Patterson, D. (2009). "Roofline: An Insightful Visual Performance Model for Multicore Architectures."** *CACM.* The memory-bound-vs-compute-bound model that gates whether layout is your lever.
- **Yotov, K., et al. (2007). "An Experimental Comparison of Cache-Oblivious and Cache-Conscious Programs."** *SPAA.* The data behind "where hand-tuned aware layouts beat oblivious, and by how much."

---

## Key Takeaways

1. **Layout decides real performance in three production domains:** game-engine entity processing (every frame), OLAP scans (over billions of rows), and per-core hot counters (under contention). In each, the working set exceeds cache and the access is a bulk sweep, so the layout — not the instruction count — sets the time.
2. **ECS is AoS→SoA as engine architecture (Acton DOD).** Entities are IDs, components are contiguous column arrays grouped by **archetype**; systems sweep them linearly. Unity DOTS/Burst, EnTT, and Bevy report large drops in cache misses, several-fold IPC gains, and 3–10× frame-loop speedups over OOP object graphs, because the SoA layout streams, prefetches, and vectorizes where the object graph stalls.
3. **Columnar analytics is SoA at dataset scale (Arrow in-mem; Parquet/ORC on disk).** Column stores dominate OLAP via four compounding wins: read only touched columns, vectorized/batch execution over cache-resident column vectors (DuckDB/ClickHouse/Velox + SIMD), heavy compression operated on directly (dictionary, RLE, bit-packing, frame-of-reference), and late materialization. PAX is the row/column hybrid for systems needing both scans and reconstruction.
4. **False sharing is the concurrency layout bug, and padding/striping is the fix.** Pad hot per-thread counters/atomics to a cache line (`hardware_destructive_interference_size`, Go pad fields, Java `@Contended`); use the striped-counter/`LongAdder` pattern for write-heavy shared counts; lay locks and queue indices out per-core. The signature is negative scaling; the cure costs ~56 bytes per counter.
5. **Supporting techniques:** cache-line-aligned allocation; **SoA is what makes auto-vectorization legal** (consecutive same-typed values for one vector load); software prefetch ahead-by-K for pointer-chasing loops the hardware can't predict; **NUMA first-touch** — initialize with the parallel decomposition that will process the data, so each thread's pages are node-local.
6. **Implicit/array search layouts beat pointered ones for read-mostly in-memory search.** Eytzinger (branch-free, prefetchable, root packed front — ~2× over `std::lower_bound`, Khuong–Morin); CSB+/cache-line-sized nodes (contiguous child group → ~2× fanout); **FAST** (SIMD + cache + page blocking, Kim et al.). Abandon pointers when the key set is static, the data in-memory, and search hot enough to amortize rebuild cost.
7. **Methodology gates all of it.** Establish memory-bound vs compute-bound via the **roofline**; read `perf stat` (`LLC-load-misses`, `dTLB-load-misses`, IPC), cachegrind for deterministic counts, VTune / top-down for stall attribution. Layout beats algorithm only when op count is near-minimal and you are memory-bound; premature layout optimization is a real cost. Prove the win with rising IPC and falling misses — not assumption.

---

> **See also:** [`./senior.md`](./senior.md) for the DOD discipline, Chilimbi's structures, the Eytzinger/vEB/CSB+ derivations, space-filling curves, and NUMA first-touch · [`../02-cache-oblivious-algorithms/professional.md`](../02-cache-oblivious-algorithms/professional.md) for the parameter-free recursive counterpart to these cache-aware layouts (FFTW, recursive BLAS, Morton order) · [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md) for the on-disk B-tree / `B^ε` / LSM curve when the index is persistent and write-heavy · [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md) for the I/O model whose cache-line instantiation (`B = 64 B`) these layouts target
