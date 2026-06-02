# Eulerian Path & Circuit — Senior Level

> Hierholzer is `O(E)` and almost never the bottleneck. At scale the hard parts are elsewhere: a de Bruijn graph for a human genome has billions of edges that do not fit in one machine's RAM, the "graph" is full of sequencing errors and repeats that must be cleaned before any Euler tour is meaningful, and the recursion/stack depth can reach the edge count. This document is about Eulerian construction as a component of a real system, not as a textbook loop.

## Table of Contents
1. [Introduction](#1-introduction)
2. [System Design: Assemblers and Route Optimization](#2-system-design-assemblers-and-route-optimization)
3. [Distributed and Large-Graph Eulerian Construction](#3-distributed-and-large-graph-eulerian-construction)
4. [Concurrency](#4-concurrency)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Code Examples](#7-code-examples)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning](#10-capacity-planning)
11. [Summary](#11-summary)

---

## 1. Introduction

At senior level the question is not "how does Hierholzer work" but "where does an Euler tour sit in my pipeline, and what breaks around it?" The algorithm is a linear scan over edges. That description tells you the real constraints:

- It needs the **entire edge set addressable** — random access into adjacency lists. At billions of edges that is a memory-layout and possibly an out-of-core problem.
- It is **inherently sequential** in its naive form: the splice order depends on which edges remain.
- Its correctness depends on **upstream graph cleanliness** — in genome assembly the raw de Bruijn graph is *not* Eulerian until errors and tips are pruned.
- Its recursive form has **stack depth = O(E)**; on a 3-billion-edge graph that is an instant overflow.

The interesting senior decisions are therefore: how to represent a graph too big for one node, how to make the construction robust to a graph that *almost* satisfies the conditions, and how to instrument a multi-hour assembly so an operator can see progress and detect a stall.

---

## 2. System Design: Assemblers and Route Optimization

### 2.1 Genome assembler pipeline

```mermaid
flowchart LR
    A[Raw reads<br/>100s of GB] --> B[k-mer counting<br/>filter low-count]
    B --> C[de Bruijn graph<br/>build + compact]
    C --> D[Error cleanup<br/>tip/bubble removal]
    D --> E[Eulerian path<br/>per component]
    E --> F[Contigs / scaffolds]
    style E fill:#ffe8e8,stroke:#dc2626
```

The Euler tour (red) is a single stage in a long pipeline. The stages around it dominate runtime: `k`-mer counting touches every base of every read; error cleanup iterates the graph repeatedly; the Euler tour itself is one linear pass per connected component. Production assemblers (SPAdes, ABySS, Velvet) spend most of their wall-clock outside Hierholzer.

A crucial design point: the real graph is **rarely Eulerian**. Coverage gaps, sequencing errors, and repeated regions break the in/out balance. So assemblers do not demand a single Euler path — they extract **maximal unambiguous paths** (unitigs) and emit many contigs, deferring the "join them" step to scaffolding with extra information (paired reads, long reads). The pure Eulerian-path idea is the *conceptual* core; the implementation relaxes it heavily.

### 2.2 Route optimization (Chinese Postman at scale)

For street-sweeping, snow-plowing, drone inspection, or meter reading over a city:

- The graph is small enough to fit in memory (a city has ~10⁵–10⁶ edges).
- The graph is **not** Eulerian, so the cost is in the **min-weight matching** of odd vertices (`O(V³)` blossom), not the tour.
- Real constraints — one-way streets (directed Postman, harder), vehicle capacity, time windows, multiple vehicles — push this toward a vehicle-routing solver where the Euler tour is the final "make it a single closed walk" step.

The senior insight: in routing, Hierholzer is the *cheap* finishing move; the optimization is upstream (matching, partitioning).

---

## 3. Distributed and Large-Graph Eulerian Construction

A human de Bruijn graph at `k = 31` can have on the order of **10⁹–10¹⁰** edges. Strategies when it does not fit in one machine's RAM:

### 3.1 Graph compaction first

Most of a de Bruijn graph is **non-branching chains** (paths of degree-2 vertices). Compact each maximal chain into a single edge ("unitig"). This shrinks the graph by orders of magnitude *before* any Euler tour, often enough to fit in memory. This is the single most important large-graph technique and is essentially free correctness-wise (a chain has a unique traversal).

### 3.2 Partition by connected component

Eulerian construction is independent per connected component. Identify components (a distributed connected-components pass, e.g., label propagation on Spark/GraphX), then process each component on whatever node holds it. Components in assembly graphs are numerous and mostly small after compaction, giving natural parallelism.

### 3.3 Out-of-core / streaming

When even one component is too large, stream adjacency from disk with an external-memory traversal. The `iter[v]` pointer pattern is friendly here: each edge is touched once, so a well-ordered on-disk adjacency yields mostly sequential I/O.

### 3.4 What does *not* distribute well

The **splice order** of Hierholzer is a sequential dependency: you cannot trivially compute the final walk's order in parallel across a single component, because each cycle's insertion point depends on the rest. Practical systems sidestep this by emitting unitigs (independent) and stitching with side information, rather than insisting on one global Euler tour.

---

## 4. Concurrency

### 4.1 Parallelism across components

The clean win: run one worker per connected component. No shared state, no locks. This is embarrassingly parallel and is how multi-threaded assemblers get speedup on the tour stage.

### 4.2 Within a single component

Hierholzer on one component is hard to parallelize because:
- The `used[edge]` flags are shared mutable state — concurrent traversal would race on which thread claims an edge.
- The splice structure is sequential.

A relaxed approach: partition the component's *cycles* (an even graph decomposes into edge-disjoint cycles), find cycles in parallel, then merge — but the merge is sequential and tricky. In practice, per-component parallelism is enough; intra-component parallelism is rarely worth the complexity.

### 4.3 Read-only sharing

If multiple queries run Euler tours over the *same* immutable graph (e.g., generating several de Bruijn sequences), the adjacency lists are read-only and the only per-run mutable state is `iter[]` and `used[]`. Give each worker its own copies; the graph stays shared and cache-warm.

---

## 5. Comparison at Scale

| Approach | Edges feasible | Memory | Notes |
|----------|----------------|--------|-------|
| In-memory iterative Hierholzer | up to ~10⁸ on a big node | `O(V + E)` | The default. Linear, cache-friendly with flat arrays. |
| Recursive Hierholzer | small only | `O(E)` stack | Stack overflow on long trails. Avoid in production. |
| Compaction + per-component | 10⁹–10¹⁰ after compaction | reduced | Standard assembler approach. |
| Out-of-core streaming | beyond RAM | `O(V)` in RAM | I/O-bound; needs good on-disk adjacency layout. |
| Fleury | tiny / teaching | `O(V + E)` | `O(E²)` — never at scale. |

For routing-scale graphs (≤10⁶ edges) any in-memory method is instant; the comparison only matters for assembly-scale graphs.

---

## 6. Architecture Patterns

### 6.1 Validate-clean-construct

```
        +-----------+     +-----------+     +-----------+     +-----------+
reads ->|  build    |---->| validate  |---->|  clean    |---->| Euler /   |
        |  graph    |     | balance   |     | tips,bubbles|   | unitigs   |
        +-----------+     +-----------+     +-----------+     +-----------+
```

Never run Hierholzer on a freshly built biological graph; it will fail the balance check or produce a meaningless tour. The validate and clean stages are where engineering effort goes.

### 6.2 Component-sharded workers

A coordinator assigns connected components to a worker pool; each worker runs an independent in-memory Hierholzer and streams its result back. Components are sized so each fits a worker's memory; oversized components fall back to streaming.

### 6.3 Idempotent, checkpointed stages

Each pipeline stage writes its output (compacted graph, component list, per-component tours) to durable storage so a crash resumes from the last checkpoint rather than re-reading hundreds of GB of raw reads.

---

## 7. Code Examples

### 7.1 Go — overflow-safe iterative Hierholzer for huge graphs

```go
package euler

// Trail builds an Eulerian trail over a directed graph given as adjacency
// slices. It is fully iterative (no recursion) so it survives trails of length
// O(E) without stack overflow. Returns the vertex sequence, or ok=false if the
// graph is not Eulerian / not connected on its edge-bearing vertices.
func Trail(adj [][]int32, numEdges int) (trail []int32, ok bool) {
	n := len(adj)
	out := make([]int, n)
	in := make([]int, n)
	for u := range adj {
		out[u] = len(adj[u])
		for _, v := range adj[u] {
			in[v]++
		}
	}

	start, plus, minus := -1, 0, 0
	for v := 0; v < n; v++ {
		d := out[v] - in[v]
		switch {
		case d == 1:
			plus++
			start = v
		case d == -1:
			minus++
		case d != 0:
			return nil, false
		}
		if start == -1 && out[v] > 0 {
			start = v
		}
	}
	if !((plus == 0 && minus == 0) || (plus == 1 && minus == 1)) {
		return nil, false
	}
	if start == -1 {
		return []int32{}, numEdges == 0
	}

	iter := make([]int32, n)
	// preallocate stack and output to avoid reallocations on huge graphs
	stack := make([]int32, 0, numEdges+1)
	trail = make([]int32, 0, numEdges+1)
	stack = append(stack, int32(start))
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if int(iter[v]) < len(adj[v]) {
			w := adj[v][iter[v]]
			iter[v]++
			stack = append(stack, w)
		} else {
			trail = append(trail, v)
			stack = stack[:len(stack)-1]
		}
	}
	if len(trail) != numEdges+1 {
		return nil, false // disconnected: not all edges used
	}
	for i, j := 0, len(trail)-1; i < j; i, j = i+1, j-1 {
		trail[i], trail[j] = trail[j], trail[i]
	}
	return trail, true
}
```

Notes for review:
- `int32` vertices halve memory vs `int` on huge graphs — at 10⁹ vertices that is gigabytes saved.
- Stack and output are preallocated to `numEdges+1`; reallocation churn is a real cost at scale.
- The `iter[]` pointer guarantees each edge is touched once: total work is strictly `O(E)`.

### 7.2 Java — per-component parallel driver

```java
import java.util.*;
import java.util.concurrent.*;

public class ParallelEuler {
    // Runs an independent Eulerian trail on each weakly-connected component,
    // in parallel. Returns a trail per component (or null if a component is
    // not Eulerian).
    public static List<int[]> trailsPerComponent(List<int[]>[] adj) throws Exception {
        int n = adj.length;
        int[] comp = new int[n];
        Arrays.fill(comp, -1);
        List<List<Integer>> components = new ArrayList<>();
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1 || adj[s].isEmpty()) continue;
            List<Integer> members = new ArrayList<>();
            Deque<Integer> dq = new ArrayDeque<>();
            dq.push(s); comp[s] = components.size();
            while (!dq.isEmpty()) {
                int v = dq.pop();
                members.add(v);
                for (int[] e : adj[v]) {
                    if (comp[e[0]] == -1) { comp[e[0]] = comp[v]; dq.push(e[0]); }
                }
            }
            components.add(members);
        }

        ExecutorService pool = Executors.newWorkStealingPool();
        List<Future<int[]>> futures = new ArrayList<>();
        for (List<Integer> members : components) {
            futures.add(pool.submit(() -> hierholzer(adj, members)));
        }
        List<int[]> result = new ArrayList<>();
        for (Future<int[]> f : futures) result.add(f.get());
        pool.shutdown();
        return result;
    }

    // Directed Hierholzer restricted to one component's vertex set.
    private static int[] hierholzer(List<int[]>[] adj, List<Integer> members) {
        Map<Integer, Integer> iter = new HashMap<>();
        int start = members.get(0);
        Deque<Integer> stack = new ArrayDeque<>();
        ArrayList<Integer> trail = new ArrayList<>();
        stack.push(start);
        int edgeCount = 0;
        for (int v : members) edgeCount += adj[v].size();
        while (!stack.isEmpty()) {
            int v = stack.peek();
            int i = iter.getOrDefault(v, 0);
            if (i < adj[v].size()) {
                iter.put(v, i + 1);
                stack.push(adj[v].get(i)[0]);
            } else {
                trail.add(stack.pop());
            }
        }
        if (trail.size() != edgeCount + 1) return null;
        Collections.reverse(trail);
        return trail.stream().mapToInt(Integer::intValue).toArray();
    }
}
```

### 7.3 Python — streaming validation before construction

```python
def is_eulerian_directed(out_deg, in_deg, reachable_from_start, total_v_with_edges):
    """Cheap pre-check: balance + connectivity. Returns (ok, start_vertex)."""
    start, plus, minus = None, 0, 0
    for v in out_deg:
        d = out_deg[v] - in_deg.get(v, 0)
        if d == 1:
            plus += 1
            start = v
        elif d == -1:
            minus += 1
        elif d != 0:
            return False, None
    for v in in_deg:
        if v not in out_deg and in_deg[v] - 0 not in (0,) and (in_deg[v]) == 1:
            minus += 1
    if not ((plus == 0 and minus == 0) or (plus == 1 and minus == 1)):
        return False, None
    if start is None:
        start = next(iter(out_deg), None)
    # connectivity: all edge-bearing vertices reachable from start
    if reachable_from_start != total_v_with_edges:
        return False, None
    return True, start
```

The point of this stage in a large pipeline is to **fail fast and cheaply** (a degree scan and one reachability pass) before committing to an expensive construction over billions of edges.

---

## 8. Observability

A multi-hour Euler-based pipeline is opaque without instrumentation. Wire these from the start.

| Metric | Type | Why |
| --- | --- | --- |
| `graph_edges_total` | gauge | Size after each compaction stage; detects ineffective compaction. |
| `components_total` | gauge | Number of connected components to process. |
| `component_max_edges` | gauge | The biggest component decides peak memory and stall risk. |
| `euler_edges_consumed` | counter | Progress within a component (against its edge count). |
| `euler_balance_violations` | counter | Vertices failing in/out balance — graph-cleanup quality signal. |
| `euler_stage_duration_seconds` | histogram | Where the pipeline actually spends time. |
| `disconnected_components_dropped` | counter | Components that did not yield a full trail. |

The most useful single signal is `euler_edges_consumed / component_edges`: if it stalls, the traversal is stuck (almost always a graph that is not actually Eulerian, or a memory thrash).

---

## 9. Failure Modes

### 9.1 Graph not actually Eulerian
Raw biological graphs fail balance constantly. Mitigation: pre-validate and route non-Eulerian components to the unitig extractor instead of demanding a single tour.

### 9.2 Recursion stack overflow
Recursive Hierholzer on a long path overflows at depth `O(E)`. Mitigation: always use the iterative stack form. This is the single most common production crash for naive implementations.

### 9.3 Disconnected components masquerading as Eulerian
All-even degrees but two components → partial trail. Mitigation: assert `len(trail) == E + 1`; never trust the degree check alone.

### 9.4 Memory blow-up on a giant component
One repeat-rich component can dominate memory. Mitigation: compaction first; out-of-core streaming for the residual giant; cap and shard.

### 9.5 Multigraph edge double-use
Undirected parallel edges marked used by endpoint pair rather than edge ID get traversed twice. Mitigation: per-edge IDs, always.

### 9.6 Non-determinism breaking reproducibility
Hierholzer's output depends on adjacency order; two runs differ. For reproducible science, **fix the adjacency order** (sort) so the tour is deterministic.

---

## 10. Capacity Planning

### 10.1 Memory

Working assumptions for an in-memory directed graph:
- Adjacency as a flat `int32` slice: 4 bytes per arc.
- `iter[]`, `in[]`, `out[]`: `O(V)` ints.
- Output trail: `E + 1` vertices.

For `E = 10⁸` arcs: `~0.4 GB` adjacency + `~0.4 GB` output (int32) ≈ **under 1 GB** — comfortably single-node. For `E = 10¹⁰` raw, you **must** compact first; post-compaction graphs are typically 10²–10³× smaller.

### 10.2 Time

Hierholzer is `~O(E)` with a small constant (a push and a pop per edge). On a modern core, expect tens to low hundreds of millions of edges per second in a compiled language; the bottleneck is memory bandwidth on the adjacency scan, not arithmetic.

### 10.3 Sizing example

A bacterial genome (~5 Mbp) at `k = 31`: a few million `k`-mers, graph fits in tens of MB, Euler/unitig stage runs in well under a second. A human genome (~3 Gbp): build/clean/compact dominate (hours, hundreds of GB peak); the tour stage per component is negligible by comparison. Plan capacity for the **build and cleanup**, not for Hierholzer.

### 10.4 When to leave the single node

Move to a distributed build (Spark/GraphX or a dedicated assembler's MPI mode) when raw `k`-mer counts exceed single-node RAM during graph construction — which happens *before* the Euler stage, not at it.

---

## 11. Summary

- Hierholzer is a linear-time finishing move; the engineering lives upstream (graph build, validation, error cleanup, compaction).
- Always iterative — recursive Hierholzer overflows at depth `O(E)` and is the classic production crash.
- Large graphs (genome assembly) are tamed by **compaction** then **per-component** parallelism; intra-component parallelism rarely pays off because the splice order is sequential.
- Real graphs are usually *not* Eulerian; robust systems emit unitigs and defer joining, rather than insisting on one global tour.
- Validate cheaply (balance + one reachability pass) before committing to construction; assert `len(trail) == E + 1` to catch disconnection.
- Instrument `edges_consumed / component_edges` to detect stalls; fix adjacency order for reproducibility.
- Capacity is dominated by graph *construction*, not by the Euler tour — plan memory and time accordingly.

References worth studying: Pevzner, Tang & Waterman (2001) on the Eulerian path approach to DNA assembly; the SPAdes and ABySS papers; cp-algorithms "Finding the Eulerian path"; sibling topics *08-tarjan-scc* and *11-articulation-points-bridges*.
