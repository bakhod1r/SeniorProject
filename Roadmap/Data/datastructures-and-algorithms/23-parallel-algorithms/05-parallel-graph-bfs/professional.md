# Parallel Graph Processing — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Think-Like-a-Vertex: Pregel, Giraph, and the BSP Model](#think-like-a-vertex-pregel-giraph-and-the-bsp-model)
   - [The Superstep = a Parallel Round](#the-superstep--a-parallel-round)
   - [Spark GraphX: Pregel on RDDs](#spark-graphx-pregel-on-rdds)
   - [The High-Diameter Tax](#the-high-diameter-tax)
3. [Shared-Memory Frameworks: Ligra, GraphIt, GAP, Galois](#shared-memory-frameworks-ligra-graphit-gap-galois)
4. [Graphs as Sparse Linear Algebra: GraphBLAS](#graphs-as-sparse-linear-algebra-graphblas)
5. [GPU Graph Processing: Gunrock and the Load-Balancing Problem](#gpu-graph-processing-gunrock-and-the-load-balancing-problem)
6. [The Core Engineering Reality: Memory-Latency-Bound and Irregular](#the-core-engineering-reality-memory-latency-bound-and-irregular)
7. [Worked End-to-End: Direction-Optimizing BFS on CSR](#worked-end-to-end-direction-optimizing-bfs-on-csr)
8. [Decision Framework](#decision-framework)
9. [Research and System Pointers](#research-and-system-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) settled the *theory*: pointer jumping is the master technique, connected components and MST are `O(log n)`-span via hooking + contraction, SSSP is the hard member of the tractable family (delta-stepping), `P-completeness` walls off lex-DFS / max-flow / lex-MIS, and — the unifying idea — graphs *are* sparse linear algebra: BFS is repeated masked SpMV over the `(∨, ∧)` semiring, SSSP over `(min, +)`. That is the algebra. This tier assumes all of it.

This tier answers a different question: **how do parallel graph algorithms actually run in production systems, and what do you reach for when you have a real graph and real hardware?** The honest thesis has three parts. First, there is no single "parallel graph framework" — there are *four distinct programming models* (think-like-a-vertex BSP, shared-memory frontier, sparse linear algebra, GPU), and the professional skill is matching the model to the graph and the cluster, because the wrong choice can be an order of magnitude slower or simply not fit in memory. Second, **graph algorithms are memory-latency-bound and irregular** — random access with no locality, load imbalance from power-law degree distributions, and a span floor set by the diameter — so the real wins come from *data layout* (CSR/CSC), *direction optimization*, *vertex reordering*, and *load balancing*, not from adding cores. A graph kernel that ignores these tops out far below peak no matter how many threads you throw at it. Third, the choice of model is dominated by **scale and diameter**: a graph that fits in one machine's RAM should almost never run on a distributed BSP framework, and a high-diameter graph punishes any superstep-counted model.

The throughline of every section is the senior punchline made physical: **a graph traversal does `O(V + E)` work but its arithmetic intensity is near zero and its access pattern is a random walk over memory — so you are bound by memory latency and the diameter, and every production technique is a way to convert random access into sequential access, balance skewed work, or cut the number of rounds.**

---

## Think-Like-a-Vertex: Pregel, Giraph, and the BSP Model

The first production model for *graphs too big for one machine* is **think-like-a-vertex** (TLAV), introduced by Google's **Pregel** (Malewicz et al., 2010) and reimplemented open-source as **Apache Giraph** (the engine that ran Facebook's trillion-edge graph). The programmer writes a single `compute()` function from the perspective of *one vertex*; the framework runs it for every vertex, in parallel, across a cluster.

The execution model is **Bulk Synchronous Parallel** (Valiant's BSP — see the BSP framing in [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md)). Computation proceeds in **supersteps**, and within one superstep every active vertex, in parallel:

1. **receives** the messages sent to it in the *previous* superstep,
2. **computes** — updates its own value using those messages (the user's `compute()`),
3. **sends** messages along its out-edges (to be delivered next superstep),
4. optionally **votes to halt** — becoming inactive until a future message reactivates it.

Between supersteps there is a **global barrier**: no message sent in superstep `t` is visible until superstep `t+1`, and every vertex finishes step `t` before any vertex starts `t+1`. The algorithm terminates when *all* vertices have voted to halt and no messages are in flight.

```text
PREGEL PageRank — the canonical compute():

  compute(vertex, incoming_messages):
    if superstep >= 1:
      sum = Σ over incoming_messages           # neighbors' rank contributions
      vertex.value = 0.15/N + 0.85 * sum       # the PageRank update
    if superstep < MAX:
      n = vertex.num_out_edges
      send_to_all_neighbors(vertex.value / n)  # split rank across out-edges
    else:
      vertex.vote_to_halt()
```

### The Superstep = a Parallel Round

The conceptual key — and the bridge back to the senior tier — is that **one superstep is exactly one parallel round of the algorithm**. A Pregel BFS does one superstep *per BFS level*: superstep `k` activates the frontier at distance `k`, each frontier vertex messages its neighbors their distance, and the barrier between supersteps is the level-synchronous boundary. Connected components by label propagation does one superstep per round of "take the min label among my neighbors." SSSP (Bellman–Ford style) does one superstep per relaxation wave. This is the BSP cost model of [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md) made into an API: each superstep is a `(compute, communicate, barrier)` triple, and the algorithm's **superstep count is its span in rounds** while the per-superstep message volume is its communication cost. Pregel is BSP with the "vertices" as the parallel units and "messages" as the communication.

TLAV is well-suited to the algorithms whose senior analysis showed a small round count over a sparse structure: **PageRank** (converges in tens of supersteps), **connected components** (label propagation), **single-source shortest paths**, and graph statistics that fit the "every vertex aggregates from its neighbors, repeatedly" shape. The framework handles partitioning (hash or edge-cut the vertices across machines), message routing, fault tolerance (checkpoint the vertex state every few supersteps and replay on machine failure), and the barrier — the programmer writes only `compute()`.

### Spark GraphX: Pregel on RDDs

**Spark GraphX** brings the Pregel model into the Spark ecosystem: the graph is a pair of RDDs (a vertex RDD and an edge RDD), and GraphX exposes a `Pregel` operator plus the lower-level `aggregateMessages` primitive (the "send messages along edges, then reduce per destination vertex" core of one superstep). Its advantage is *integration* — graph processing sits inside a larger Spark dataflow pipeline (ETL, joins, ML), so you can build a graph from a Spark SQL query and feed PageRank results into MLlib without leaving the cluster. Its cost is Spark's: the JVM, RDD serialization, and a heavier per-superstep overhead than a native C++ engine like Giraph. GraphX is the right call when graph processing is *one stage of a bigger Spark job*; it is rarely the fastest standalone graph engine.

### The High-Diameter Tax

The defining weakness of every BSP/Pregel system is the **diameter**. The superstep count is bounded *below* by the number of rounds the algorithm needs, and for traversal-style algorithms that is the graph **diameter `D`** — and each superstep pays a *global barrier* (the slowest machine in the cluster gates every other machine) plus message-passing latency. On a **low-diameter** graph (social networks, web graphs — `D ≈ 6–20` even at billions of vertices, the "small-world" property), this is fine: a few dozen barriers. On a **high-diameter** graph (road networks with `D` in the thousands, meshes, chains, long pipelines), Pregel is *brutal*: thousands of supersteps, each a near-empty frontier of a few vertices doing trivial work while the whole cluster stalls at a barrier. The barriers dominate; utilization collapses; a computation that is `O(V + E)` work runs for `O(D)` synchronized rounds of almost nothing. This is the senior `O(D · log n)`-span observation turned into a wall-clock catastrophe — the *diameter is the span, and BSP charges a full global barrier per unit of span*. The lesson: **TLAV/BSP is for big, low-diameter graphs; for high-diameter graphs it is the wrong model**, and asynchronous (GraphLab-style) or shared-memory engines that do not pay a global barrier per round are dramatically better.

---

## Shared-Memory Frameworks: Ligra, GraphIt, GAP, Galois

When the graph **fits in one machine's RAM** — and modern servers hold a terabyte, enough for graphs with tens of billions of edges in CSR — the right model is usually **shared-memory**, not distributed. A single multi-socket machine sharing one address space avoids the network entirely, avoids the per-superstep barrier of BSP, and gets *huge* multicore speedups by exploiting the frontier and direction optimization directly. This is where the senior tier's frontier algebra becomes the dominant production abstraction.

**Ligra** (Shun & Blelloch, 2013) is the canonical shared-memory graph framework, and its design is *exactly* the senior frontier model expressed as two primitives:

- **`edgeMap(G, frontier, f)`** — apply the update function `f` to every edge out of (or into) the current frontier, producing the next frontier. This is one SpMV / one BFS level / one relaxation wave.
- **`vertexMap(frontier, f)`** — apply `f` to every vertex in the frontier (a filter or per-vertex update).

The load-bearing feature is that **direction optimization is built into `edgeMap`**: Ligra automatically switches between **push** (sparse mode: iterate the frontier's out-edges, scatter — cheap when the frontier is small) and **pull** (dense mode: iterate *unvisited* vertices' in-edges and check whether any in-neighbor is in the frontier — cheap when the frontier is large, because most vertices find a frontier neighbor and stop early). This is Beamer's direction-optimizing BFS (the `Aᵀ ⊗ f` row-vs-column choice of the senior tier) generalized to *any* `edgeMap` and chosen automatically by frontier density each round. With it, BFS / connected components / PageRank / betweenness centrality are each a handful of lines and run within a small factor of hand-tuned code — the framework provides the parallelism, the frontier bookkeeping, and the direction switch.

The neighbors in this design space sharpen the trade-offs:

- **GraphIt** (Zhang et al., 2018, MIT) is a graph **DSL** whose signature move is *separating the algorithm from the schedule*. You write the algorithm once (the BFS, the PageRank) in a high-level language, then write a **separate schedule** that specifies the implementation strategy — push vs pull, dense vs sparse frontier representation, vertex parallelism vs edge-aware load balancing, vertex reordering, NUMA placement, cache/bitvector layout. The same algorithm compiles to wildly different code for different graphs by changing only the schedule, and GraphIt's autotuner searches the schedule space. This is the explicit acknowledgment that **the optimal strategy depends on the graph** (degree distribution, diameter, density) and the machine — the same algorithm wants push on a road network and pull on a social network.
- **The GAP Benchmark Suite** (Beamer, Asanović, Patterson) is the *reference* for what "fast" means: high-quality, optimized shared-memory C++ implementations of six kernels (BFS, SSSP, PageRank, connected components, betweenness centrality, triangle counting) plus standard input graphs. It exists so that a new framework's claimed speedup is measured against a *genuinely optimized* baseline, not a naive one — and the GAP baselines already use CSR, direction optimization, and good load balancing, so beating them is the real bar.
- **Galois** (Pingali et al., UT Austin) targets the *irregular* and *amorphous data-parallel* algorithms that frontier frameworks handle awkwardly — algorithms with dynamic worklists, priority scheduling, and speculative parallelism (delta-stepping SSSP, mesh refinement, some graph analytics). Its `Galois::for_each` operates over a *worklist* with a custom scheduling policy, and it provides a runtime that handles the conflict detection and load balancing for these less-structured computations.

The common thread: shared-memory frameworks win because they **exploit the frontier (do work proportional to active edges, not all edges) and direction optimization (push/pull), with no network and no global barrier per round** — and they get 10–50× multicore speedups on graphs that fit in RAM. The first question on any graph problem is therefore: *does it fit in one machine?* If yes, a shared-memory framework almost always beats a distributed one.

---

## Graphs as Sparse Linear Algebra: GraphBLAS

The senior tier's deepest idea — *graphs are sparse matrices, BFS/SSSP are SpMV over a semiring* — has a production realization: **GraphBLAS**, the standard API (Kepner et al., 2016) and its reference implementation **SuiteSparse:GraphBLAS** (Tim Davis), the engine inside RedisGraph and the Python `python-graphblas`. The premise is that you stop writing traversal code entirely and instead write graph algorithms as a few lines of **masked sparse matrix operations**.

The mapping is exactly the senior algebra:

- The graph is the **sparse adjacency matrix `A`**.
- The frontier is a **sparse vector `f`**.
- One BFS step is `f = Aᵀ ⊗ f` over the `(∨, ∧)` (`LOR`/`LAND`) semiring — an `mxv` (matrix-times-vector) call. One SSSP relaxation is the *same* `mxv` over the `(min, +)` (`MIN_PLUS`) semiring. PageRank is `mxv` over the real `(+, ×)` semiring. This is the per-element map (`⊗`) folded by a per-target reduce (`⊕`) — the parallel reduce machinery of [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) applied per matrix row.
- **The frontier-as-sparse-vector and the mask are the load-bearing features.** GraphBLAS operations take an optional **mask**: `mxv(w, mask, ...)` writes results *only* where the mask is set (or, with complement, only where it is unset). BFS uses the visited-set as a *complemented mask* so the SpMV computes the next frontier *and excludes already-visited vertices in one fused operation* — no separate filter pass. Because `f` is sparse, `mxv` does **sparse-matrix × sparse-vector** work, proportional to the edges leaving the frontier, summing to `O(V + E)` over all levels.

```text
GraphBLAS BFS (one level), conceptually:

  GrB_vxm(frontier,            # output: next frontier
          GrB_DESC_RSC,        # descriptor: replace, structural-complement mask
          visited,             # mask (complemented): skip visited vertices
          GrB_LOR_LAND_BOOL,   # the (∨, ∧) semiring
          frontier, A)         # f times A
  GrB_assign(visited, frontier, ...)   # fold survivors into visited
```

Why this maps cleanly to optimized parallel kernels: **SpMV is one of the most-studied kernels in all of high-performance computing.** Decades of work on cache blocking, CSR/CSC/DCSC format selection, NUMA-aware partitioning, and load balancing for sparse matrices transfer *directly* to graphs the moment you phrase the algorithm as `mxv`. SuiteSparse:GraphBLAS ships a heavily tuned, multithreaded `mxv` with automatic format and "saxpy-vs-dot" strategy selection, and even automatic push/pull (it picks the SpMV direction by frontier density, the same direction optimization as Ligra). You write the algebra; the library brings the HPC engineering. The trade-off, as at senior level: the algebra hides constant factors and the masking/format bookkeeping is intricate, so GraphBLAS shines when you want *one tuned kernel reused across many algorithms* (and especially inside a database like RedisGraph, where a query compiles to a sequence of masked matrix ops) rather than for squeezing the last few percent out of one specific traversal.

---

## GPU Graph Processing: Gunrock and the Load-Balancing Problem

GPUs offer enormous memory bandwidth (terabytes/sec) and massive parallelism, which *should* be ideal for the `O(V + E)`-work, bandwidth-hungry graph kernels. The catch is that graphs are **irregular**, and GPUs punish irregularity harder than CPUs. **Gunrock** (Wang et al., 2016) is the reference GPU graph framework, and its design is a sustained answer to one problem: **load balancing the frontier expansion across thousands of threads.**

The core difficulty is **skewed degree distributions**. In a power-law (scale-free) graph, a handful of vertices have millions of edges while most have a handful. The naive mapping — **one thread per frontier vertex**, each thread loops over its vertex's out-edges — is a disaster: within a warp of 32 threads, 31 may finish their 3-edge vertices in a few cycles while one thread grinds through a million-edge hub, and the whole warp waits for it (SIMT lockstep). Utilization craters. The alternatives and the real fix:

- **Per-vertex parallelism** (thread-per-vertex): simple, but catastrophic load imbalance on skewed graphs — the hub-vertex problem above.
- **Per-edge parallelism** (thread-per-edge): perfectly balanced work, but it requires *materializing* the frontier's edge list and a way to map a flat edge index back to its source vertex — overhead, and it over-parallelizes low-degree frontiers.
- **Load-balanced search / merge-based mapping** (Gunrock's approach, drawn from Merrill–Garland and Baxter's *moderngpu*): treat the frontier expansion as a **merge** problem. Build the prefix-sum of the frontier vertices' degrees (a scan — see the scan/reduce machinery), giving the total edge count and the start offset of each vertex's edges. Then assign a *fixed, equal* chunk of the flattened edge space to each thread/block and, via a binary search ("load-balanced search") into the offset array, recover which source vertex each edge belongs to. Now **every thread processes the same number of edges regardless of degree skew**, the hub's million edges are spread evenly across many threads, and the warp stays balanced.

Gunrock frames everything as composable **frontier operators** — `advance` (expand the frontier along edges, where the load balancing lives), `filter` (cull/compact the frontier, e.g. remove visited), and `compute` (per-element work) — so BFS, SSSP, PageRank, and connected components are short operator pipelines, like Ligra but for the GPU.

Two more GPU-specific realities compound the difficulty:

- **Memory coalescing on irregular access.** A warp achieves peak bandwidth only when its 32 lanes read *consecutive* addresses (one fused wide transaction). Graph traversal reads neighbor lists at scattered offsets and reads neighbor *data* at random vertex IDs — the archetypal *uncoalesced* access. Each scattered read becomes its own transaction; effective bandwidth collapses to a fraction of peak. CSR helps (a vertex's neighbor list *is* contiguous, so reading one vertex's edges coalesces), but the gather of neighbor *values* by ID remains random. This is the same cache-unfriendly random access that hurts CPUs (next section), magnified because the GPU's whole performance model assumes coalesced access.
- **The frontier on the GPU.** Maintaining the frontier — compacting the next-level vertices into a dense array, deduplicating, deciding push vs pull — must itself be done in parallel with scans and atomics, and is a meaningful fraction of the runtime. Gunrock and similar engines spend real effort on efficient frontier compaction and on choosing a bitmap vs a queue representation by density.

The honest summary: **a GPU can crush a graph traversal when the work is well load-balanced and the access partially coalesces, but the irregularity (degree skew, random gathers, frontier management) means a naive GPU graph kernel often loses to a good CPU one.** The framework's entire value is in solving the load-balancing and coalescing problems you would otherwise re-derive.

---

## The Core Engineering Reality: Memory-Latency-Bound and Irregular

Strip away the frameworks and one fact governs every parallel graph system: **graph algorithms are memory-latency-bound and irregular.** Unpack each word, because each maps to a specific production technique.

**Memory-latency-bound (not compute-bound, often not even bandwidth-bound).** A BFS does `O(V + E)` trivial integer operations — almost no arithmetic. Its arithmetic intensity is near zero, so like reduce ([`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md)) it lives on the memory side of the roofline. But unlike reduce — which streams memory *sequentially* and so is bandwidth-bound — graph traversal **chases pointers**: reading a vertex's neighbors, then jumping to *those* vertices' data at scattered addresses. This is random access, so each access is a **cache miss that exposes full DRAM latency** (~100 ns), and the bottleneck is the *latency* of dependent loads, not the *bandwidth* of streaming. You cannot hide that latency by adding cores past the point where memory-level parallelism saturates; the graph just doesn't have enough independent work per cache line.

**Irregular.** Three irregularities, each with a fix:

- **No locality (random access).** Vertex IDs are arbitrary; a vertex's neighbors are scattered across memory. Every neighbor visit is likely a cache miss. *Fix:* **CSR/CSC layout** — store the graph as a compressed-sparse-row structure (an offsets array and a flat, sorted neighbor array) so that *one vertex's entire neighbor list is contiguous and reads coalesce/prefetch well* (see [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)). CSR is the *non-negotiable* baseline layout for every framework above. Plus **vertex reordering** (renumber vertices by a locality-improving order — degree-sorting, BFS/Cuthill–McKee order, or a community-clustering order like Gorder/RCM) so that vertices touched together sit near each other in memory, turning some random accesses into cache hits. Reordering alone can give 1.5–3× on the same algorithm.
- **Load imbalance from skewed degrees.** Power-law graphs have hub vertices with vastly more edges than average; static "equal vertices per thread" partitioning gives one thread 1000× the work. *Fix:* **edge-balanced load balancing** — partition by *edges*, not vertices (the load-balanced/merge-based mapping of the GPU section; dynamic work-stealing on CPUs), so every thread gets equal edge work regardless of degree skew.
- **The diameter limits span.** A level-synchronous traversal needs `D` rounds, and on a high-diameter graph that is a long serial chain of rounds with little parallelism per round (the BSP high-diameter tax). *Fix:* **direction optimization** (push/pull) cuts the *work* per round but not the *count*; for the count, you accept the diameter (BFS/CC on low-diameter graphs are fine) or restructure (delta-stepping's bucketing for SSSP, batched linear-algebra for some kernels).

The single most important professional correction: **"more cores" is rarely the answer to a slow graph kernel.** A parallel BFS on a badly-laid-out graph saturates the memory subsystem at a few cores and stops scaling — exactly the memory-wall ceiling reduce hits. The real wins, in rough order of impact, are: **(1) CSR/CSC layout** (contiguous neighbor lists), **(2) direction optimization** (push/pull to cut per-round work), **(3) vertex reordering** (improve locality), **(4) edge-balanced load balancing** (kill degree-skew imbalance), and **(5) the right model for the scale and diameter** (shared-memory for in-RAM, BSP only for big low-diameter graphs). Cores come last.

---

## Worked End-to-End: Direction-Optimizing BFS on CSR

Here is a self-contained Go program: a **level-synchronous BFS on a CSR graph** with a **direction-optimizing top-down/bottom-up switch**, measured on two synthetic graphs — a **small-world** graph (low diameter) and a **chain** (high diameter) — to show the frontier behavior, the switch point, and the *diameter effect* that punishes round-counted models.

```go
package main

import (
	"fmt"
	"math/rand"
)

// ---- CSR graph: the non-negotiable production layout. ----
// offsets[v]..offsets[v+1] is the slice of `neighbors` that are v's out-edges.
// One vertex's neighbor list is CONTIGUOUS → reads prefetch well.
type CSR struct {
	offsets   []int32 // len n+1
	neighbors []int32 // len = 2*m for an undirected graph
	n         int
}

func (g *CSR) deg(v int32) int { return int(g.offsets[v+1] - g.offsets[v]) }

// ---- TOP-DOWN (push) step: iterate the frontier, scatter to unvisited neighbors.
// Work ∝ edges OUT of the frontier. Cheap when the frontier is SMALL.
func topDown(g *CSR, frontier []int32, dist []int32, level int32) ([]int32, int) {
	var next []int32
	edgesExamined := 0
	for _, u := range frontier {
		s, e := g.offsets[u], g.offsets[u+1]
		edgesExamined += int(e - s)
		for _, v := range g.neighbors[s:e] {
			if dist[v] < 0 { // unvisited
				dist[v] = level + 1
				next = append(next, v)
			}
		}
	}
	return next, edgesExamined
}

// ---- BOTTOM-UP (pull) step: iterate UNVISITED vertices, look for a frontier parent.
// Each unvisited vertex stops at its FIRST frontier in-neighbor (early exit).
// Cheap when the frontier is LARGE (most unvisited vertices find a parent fast).
func bottomUp(g *CSR, inFrontier []bool, dist []int32, level int32) ([]bool, int, int) {
	nextFrontier := make([]bool, g.n)
	edgesExamined, nextCount := 0, 0
	for v := int32(0); v < int32(g.n); v++ {
		if dist[v] >= 0 {
			continue // already visited
		}
		s, e := g.offsets[v], g.offsets[v+1]
		for _, u := range g.neighbors[s:e] {
			edgesExamined++
			if inFrontier[u] { // a parent in the current frontier
				dist[v] = level + 1
				nextFrontier[v] = true
				nextCount++
				break // EARLY EXIT — the bottom-up win
			}
		}
	}
	return nextFrontier, edgesExamined, nextCount
}

// ---- Direction-optimizing BFS: switch top-down ↔ bottom-up by frontier density.
// Heuristic (Beamer): go bottom-up when the frontier's out-edges (mf) exceed a
// fraction of the unexplored edges (mu); return to top-down when the frontier shrinks.
func bfs(g *CSR, src int32, verbose bool) []int32 {
	dist := make([]int32, g.n)
	for i := range dist {
		dist[i] = -1
	}
	dist[src] = 0
	frontier := []int32{src}
	var level int32 = 0
	totalEdges := int(g.offsets[g.n]) // == len(neighbors)

	for len(frontier) > 0 {
		// edges leaving the frontier (mf) vs edges still unexplored (mu, approx)
		mf := 0
		for _, u := range frontier {
			mf += g.deg(u)
		}
		visited := 0
		for _, d := range dist {
			if d >= 0 {
				visited++
			}
		}
		mu := totalEdges - 0 // rough proxy for unexplored edge mass
		_ = visited

		// Beamer's switching condition: dense frontier → bottom-up.
		goBottomUp := mf*14 > mu // alpha tuning factor ≈ 14

		var examined int
		if goBottomUp {
			inFrontier := make([]bool, g.n)
			for _, u := range frontier {
				inFrontier[u] = true
			}
			nf, ex, cnt := bottomUp(g, inFrontier, dist, level)
			examined = ex
			frontier = frontier[:0]
			for v := int32(0); v < int32(g.n); v++ {
				if nf[v] {
					frontier = append(frontier, v)
				}
			}
			if verbose {
				fmt.Printf("  level %2d  [BOTTOM-UP]  frontier=%-8d edges=%-9d next=%d\n",
					level, mf, examined, cnt)
			}
		} else {
			nf, ex := topDown(g, frontier, dist, level)
			examined = ex
			if verbose {
				fmt.Printf("  level %2d  [TOP-DOWN ]  frontier=%-8d edges=%-9d next=%d\n",
					level, len(frontier), examined, len(nf))
			}
			frontier = nf
		}
		level++
	}
	return dist
}

// ---- Synthetic small-world graph (low diameter): ring + random long-range edges.
func makeSmallWorld(n, k int, seed int64) *CSR {
	rng := rand.New(rand.NewSource(seed))
	adj := make([][]int32, n)
	add := func(a, b int32) { adj[a] = append(adj[a], b); adj[b] = append(adj[b], a) }
	for v := 0; v < n; v++ { // ring lattice: each vertex to its k nearest
		for j := 1; j <= k; j++ {
			add(int32(v), int32((v+j)%n))
		}
	}
	for v := 0; v < n; v++ { // random rewiring → small-world short paths
		if rng.Float64() < 0.1 {
			add(int32(v), int32(rng.Intn(n)))
		}
	}
	return toCSR(adj, n)
}

// ---- Chain (path) graph (HIGH diameter): 0-1-2-...-(n-1). Diameter = n-1.
func makeChain(n int) *CSR {
	adj := make([][]int32, n)
	for v := 0; v < n-1; v++ {
		adj[v] = append(adj[v], int32(v+1))
		adj[v+1] = append(adj[v+1], int32(v))
	}
	return toCSR(adj, n)
}

func toCSR(adj [][]int32, n int) *CSR {
	g := &CSR{offsets: make([]int32, n+1), n: n}
	for v := 0; v < n; v++ {
		g.offsets[v+1] = g.offsets[v] + int32(len(adj[v]))
	}
	g.neighbors = make([]int32, g.offsets[n])
	for v := 0; v < n; v++ {
		copy(g.neighbors[g.offsets[v]:], adj[v])
	}
	return g
}

func diameterLevels(dist []int32) int32 {
	var mx int32
	for _, d := range dist {
		if d > mx {
			mx = d
		}
	}
	return mx
}

func main() {
	const n = 200_000

	sw := makeSmallWorld(n, 4, 42)
	fmt.Println("SMALL-WORLD graph (low diameter) — BFS from 0:")
	dsw := bfs(sw, 0, true)
	fmt.Printf("  => levels (eccentricity) = %d   (few rounds: small-world)\n\n",
		diameterLevels(dsw))

	chain := makeChain(n)
	fmt.Println("CHAIN graph (high diameter) — BFS from 0 (showing first/last few):")
	dch := bfs(chain, 0, false) // verbose off: it would print n-1 lines
	fmt.Printf("  => levels (eccentricity) = %d   (== n-1: the DIAMETER EFFECT)\n",
		diameterLevels(dch))
	fmt.Printf("  Each level is ONE superstep/round. The chain needs %d rounds of\n", n-1)
	fmt.Printf("  a 1-vertex frontier — top-down throughout (frontier never densifies),\n")
	fmt.Printf("  no bottom-up switch, and a round-counted (BSP/Pregel) engine would\n")
	fmt.Printf("  pay %d global barriers. The small-world graph needed only %d.\n",
		n-1, diameterLevels(dsw))
}
```

**What the run demonstrates:**

1. **CSR is the layout, and the frontier is the loop bound.** Every step iterates either the frontier's out-edges (top-down) or the unvisited vertices' in-edges (bottom-up), reading *contiguous* CSR neighbor slices. Work per level is proportional to *active* edges, not all edges — the senior frontier model, made concrete.
2. **The direction switch fires on the dense frontier.** On the small-world graph, the frontier explodes after a couple of levels (low diameter, high expansion); once `mf·14 > mu` the BFS flips to **bottom-up**, where each unvisited vertex stops at its *first* frontier parent (the `break`), so the giant middle levels examine far fewer edges than top-down would. As the frontier shrinks at the end, it flips back to top-down. This is Beamer's heuristic and the single biggest constant-factor win on low-diameter graphs.
3. **The diameter effect is stark.** The small-world graph finishes in a *handful* of levels — a few rounds, the small-world property. The chain takes **`n−1` levels**, each with a frontier of *exactly one vertex*: no expansion, so no bottom-up switch ever fires, and a round-counted engine (Pregel/Giraph) would pay `n−1` global barriers for `O(n)` total work. This is the **high-diameter tax** made measurable: the same `O(V+E)` work costs a few rounds on one graph and `Θ(n)` rounds on the other, and *that round count is what a BSP framework charges a barrier for*.
4. **Direction optimization helps only when the frontier densifies.** The chain never benefits — its frontier is always one vertex, always top-down. Push/pull is a *low-diameter* optimization; it does nothing for the diameter-bound case. The fix for high diameter is a different model (asynchronous, or bucketed like delta-stepping), not a better BFS direction.

In production you would not write this loop: Ligra's `edgeMap`, GraphBLAS's masked `mxv`, or Gunrock's `advance` ship the direction-optimized, load-balanced, CSR-backed version. The exercise shows the *mechanism* — frontier, CSR, the push/pull switch — and the *diameter wall* the model choice must respect.

---

## Decision Framework

| Situation | Reach for | Why |
|---|---|---|
| Graph **fits in one machine's RAM** (even tens of billions of edges) | **Shared-memory framework** (Ligra / GraphIt / Galois / GAP-style) | no network, no per-round barrier; 10–50× multicore via frontier + push/pull |
| Graph too big for one machine; **low diameter** (social, web) | **Pregel / Giraph** (TLAV/BSP) | distributes vertices; few supersteps because diameter is small |
| Graph processing is **one stage of a Spark pipeline** | **Spark GraphX** | Pregel API integrated with RDDs/SQL/MLlib; pay Spark overhead for integration |
| Graph has **high diameter** (road network, mesh, chain) | **NOT BSP/Pregel** — shared-memory or async (GraphLab-style) | BSP pays a global barrier per round; high diameter ⇒ thousands of stalled rounds |
| You want **one tuned kernel across many algorithms** | **GraphBLAS** (SuiteSparse) | BFS=`(∨,∧)`, SSSP=`(min,+)`, PageRank=`(+,×)` as masked `mxv`; HPC SpMV engineering for free |
| Algorithm is a **masked SpMV** and lives inside a DB/query | **GraphBLAS** (e.g. RedisGraph) | query compiles to a sequence of masked matrix ops |
| Massive throughput, **well-structured / moderate-skew** graph, GPU available | **Gunrock** (GPU) | huge bandwidth + load-balanced `advance`; but irregularity can lose to CPU |
| **Power-law / hub-heavy** graph on GPU | **Load-balanced (merge-based) mapping**, not thread-per-vertex | degree skew + SIMT lockstep ⇒ thread-per-vertex stalls the whole warp |
| Traversal / reachability (BFS, CC, PageRank), low diameter | **Direction-optimizing BFS** (push/pull) on **CSR** | cut per-round edge work; the biggest constant-factor win |
| Slow graph kernel, "just add cores" isn't helping | **Fix layout first**: CSR/CSC, vertex reordering, edge-balanced partition | memory-latency-bound + irregular; cores saturate memory early |
| SSSP on a parallel machine | **Delta-stepping** (Galois-style worklist) | Dijkstra is sequential; bucketing by `distance/Δ` recovers parallelism |
| Need to know if your framework is actually fast | **Benchmark against GAP** | GAP baselines already use CSR + direction-opt + load balancing |

Three rules of thumb:

1. **Pick the model by scale and diameter before anything else.** In-RAM ⇒ shared-memory (Ligra/GraphIt). Too big *and* low-diameter ⇒ Pregel/Giraph. High-diameter ⇒ never plain BSP. Reusing one kernel across algorithms ⇒ GraphBLAS. Massive throughput on a tractable graph with a GPU ⇒ Gunrock — knowing it can lose to a good CPU on irregular graphs.
2. **The win is in memory access and load balance, not cores.** Graph traversal is memory-latency-bound and irregular: **CSR/CSC layout, direction optimization, vertex reordering, and edge-balanced load balancing** ([`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)) move the needle; adding threads past the memory wall does not.
3. **The diameter is your span, and BSP charges a barrier for every unit of it.** A superstep is a parallel round; the round count is the diameter for traversals; direction optimization cuts per-round *work* but not the *count*. Match the model to the diameter, and restructure (delta-stepping, batched algebra) when the round count itself is the problem.

---

## Research and System Pointers

- **Malewicz, G., et al. (2010).** "Pregel: A System for Large-Scale Graph Processing." *SIGMOD.* The think-like-a-vertex / BSP-superstep model; the foundation of Giraph, GraphX, and the whole TLAV family. Read for `compute()`, messages, vote-to-halt, and the barrier.
- **Apache Giraph.** The open-source Pregel reimplementation that ran Facebook's trillion-edge graph; the production reference for distributed BSP graph processing.
- **Gonzalez, J., et al. (2014).** "GraphX: Graph Processing in a Distributed Dataflow Framework." *OSDI.* Pregel/`aggregateMessages` on Spark RDDs — graph processing integrated into a dataflow pipeline. (Predecessor: GraphLab / PowerGraph, Gonzalez et al. 2012, for the asynchronous, vertex-cut, high-diameter-friendly alternative to BSP.)
- **Shun, J., & Blelloch, G. E. (2013).** "Ligra: A Lightweight Graph Processing Framework for Shared Memory." *PPoPP.* `edgeMap` / `vertexMap` with built-in direction optimization — the canonical shared-memory frontier framework.
- **Zhang, Y., et al. (2018).** "GraphIt: A High-Performance Graph DSL." *OOPSLA.* The algorithm/schedule separation and autotuned schedule space — the explicit statement that the optimal strategy depends on the graph and machine.
- **Beamer, S., Asanović, K., & Patterson, D. (2015).** "The GAP Benchmark Suite." And **Beamer et al. (2012)**, "Direction-Optimizing Breadth-First Search," *SC* — the push/pull hybrid and the optimized baselines every framework is measured against.
- **Pingali, K., et al. (2011).** "The Tao of Parallelism in Algorithms" / the **Galois** system. Amorphous data-parallelism, worklist scheduling, and speculative parallelism for irregular graph algorithms.
- **Kepner, J., & Gilbert, J. (2011).** *Graph Algorithms in the Language of Linear Algebra*, SIAM; **Kepner et al. (2016)**, the **GraphBLAS** API; **Davis, T. (2019)**, "Algorithm 1000: SuiteSparse:GraphBLAS." Graphs as masked SpMV over semirings — the production realization of the senior linear-algebra view. (See [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) for the underlying parallel map-reduce kernel.)
- **Wang, Y., et al. (2016).** "Gunrock: A High-Performance Graph Processing Library on the GPU." *PPoPP.* The frontier-operator (`advance`/`filter`/`compute`) model and the load-balanced GPU traversal.
- **Merrill, D., Garland, M., & Grimshaw, A. (2012).** "Scalable GPU Graph Traversal." *PPoPP.* The merge-based / load-balanced-search edge mapping that solves degree-skew imbalance on the GPU — the technique behind Gunrock's `advance`.
- **Wei, H., et al. (2016) / Gorder; Cuthill–McKee (1969).** Vertex-reordering for locality — renumbering vertices so co-accessed ones sit near each other in CSR, a 1.5–3× constant-factor win independent of the algorithm.

---

## Key Takeaways

1. **There are four production models, chosen by scale and diameter.** **Think-like-a-vertex / BSP** (Pregel, Giraph, GraphX) distributes vertices and runs in supersteps — a superstep *is* a parallel round (the BSP model of [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md)) — great for big *low-diameter* graphs (PageRank, CC, SSSP), brutal on high-diameter ones because it pays a global barrier per round. **Shared-memory** frameworks (Ligra's `edgeMap`/`vertexMap`, GraphIt's algorithm/schedule split, Galois, GAP) win on graphs that fit in RAM with frontier + direction optimization and no network. **GraphBLAS** expresses everything as masked semiring SpMV. **GPU** (Gunrock) brings bandwidth but demands load balancing.
2. **The superstep = a parallel round, and the diameter is the round count.** Pregel does one superstep per BFS level / relaxation wave / label-propagation round; its superstep count is the algorithm's span in rounds, which for traversals is the **diameter**. Low-diameter (small-world) graphs need a few supersteps; high-diameter (chains, roads) need thousands of barrier-stalled near-empty rounds — the high-diameter tax that rules BSP out for those graphs.
3. **Graphs are sparse linear algebra in production, not just in theory.** GraphBLAS / SuiteSparse implements BFS as masked `mxv` over `(∨, ∧)`, SSSP over `(min, +)`, PageRank over `(+, ×)`, with the **frontier as a sparse vector** and the **visited-set as a complemented mask** — so decades of tuned SpMV engineering (the parallel map-reduce of [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md)) carry straight over, including automatic push/pull.
4. **GPU graph processing is a load-balancing problem.** Skewed (power-law) degrees + SIMT lockstep make thread-per-vertex stall the whole warp on hub vertices; Gunrock's **merge-based / load-balanced-search** mapping spreads edges evenly so every thread does equal work. Coalescing on irregular gathers and parallel frontier compaction are the other GPU-specific costs — and the irregularity means a naive GPU kernel can lose to a good CPU one.
5. **Graph algorithms are memory-latency-bound and irregular — so layout, not cores, is the lever.** Near-zero arithmetic intensity + pointer-chasing random access ⇒ bound by dependent-load latency and the diameter, not compute or even bandwidth. The real wins, in order: **CSR/CSC layout** (contiguous neighbor lists — [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md)), **direction optimization** (push/pull), **vertex reordering** (locality), and **edge-balanced load balancing** (degree skew). "More cores" is last and usually doesn't help past the memory wall.
6. **The worked BFS makes the model trade-offs measurable.** A direction-optimizing BFS on CSR flips to bottom-up when the frontier densifies (the Beamer win, huge on the small-world graph) but never switches on the chain — whose `n−1` single-vertex levels are the diameter effect that would cost a BSP engine `n−1` global barriers. Direction optimization is a low-diameter optimization; the high-diameter case needs a different model.

---

> **See also:** [`./senior.md`](./senior.md) for the theory this tier implements — pointer jumping, Shiloach–Vishkin, Borůvka, delta-stepping, the GraphBLAS semiring view, and `P-completeness` · [`../04-parallel-reduce-and-map/professional.md`](../04-parallel-reduce-and-map/professional.md) for the parallel SpMV/reduce kernel that GraphBLAS's `mxv` and every frontier reduction is built on · [`../01-models-pram-work-span/professional.md`](../01-models-pram-work-span/professional.md) for the BSP cost model that makes a Pregel superstep a parallel round · [`../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md`](../../24-external-memory-and-cache-aware/05-cache-aware-data-layout/professional.md) for CSR/CSC and the cache-aware layout that turns random graph access into contiguous reads
