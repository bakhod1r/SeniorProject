# Minimum Spanning Tree — Senior Level

> **One-line summary:** At scale, the MST stops being a textbook loop and becomes a systems problem: which algorithm survives graphs that do not fit in RAM, how do you compute it across a cluster (Borůvka / GHS), how do you parallelize the per-component minimum, and how do you keep it correct and observable when the input is dynamic, weighted by noisy real-world costs, and occasionally disconnected.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Design with MST](#2-system-design-with-mst)
3. [Distributed and Parallel MST](#3-distributed-and-parallel-mst)
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

A senior engineer rarely writes Kruskal from scratch for a homework graph. The MST shows up embedded in larger systems: a clustering pipeline over hundreds of millions of feature vectors, a network-topology planner choosing the cheapest backbone across data centers, a fraud-graph segmentation job, or a hierarchical-clustering service that recomputes single-linkage dendrograms nightly. The questions change accordingly:

- The edge set is `Θ(V²)` (a complete metric graph) and cannot be materialized — how do you build an MST without ever listing all edges?
- The graph spans many machines — how do you compute an MST when no single node sees all edges?
- The weights come from a feature pipeline with retries and partial failures — how do you keep the result deterministic and reproducible?
- The graph is occasionally disconnected — what does "MST" even return, and does the downstream consumer handle a forest?

This level treats the MST as a component in a system, with the attendant concerns of distribution, concurrency, observability, failure handling, and capacity.

---

## 2. System Design with MST

### Network / Topology Design

A backbone planner models data centers as vertices and candidate links as weighted edges (weight = leased-line cost, latency, or `$/Gbps`). MST gives the cheapest fully-connected backbone. In practice you augment it:

- **Redundancy:** a pure MST is a tree — a single link failure partitions it. Real designs take MST + the cheapest `k` extra edges per cut, or solve a survivable-network (2-edge-connected) variant. MST is the *baseline cost floor*.
- **Capacity constraints:** if links have bandwidth caps, you move to *capacitated* spanning trees (NP-hard) and use MST as a warm start.
- **Steiner points:** if you may add relay nodes, the true optimum is a Steiner tree; MST is a `2`-approximation to it.

### Clustering Pipelines

Single-linkage clustering at scale:

1. Build a (possibly approximate) `k`-NN graph instead of the full `Θ(V²)` graph — each point keeps edges to its `k` nearest neighbors. This makes the graph **sparse** (`E = kV`) and Kruskal/Borůvka practical.
2. Compute the MST of that sparse graph.
3. Cut the heaviest `c−1` edges to get `c` clusters, or keep the full dendrogram (sorted MST edges = the merge order).

The `k`-NN approximation is the key scaling trick: it turns an `O(V²)` problem into an `O(kV log V)` one, trading a small accuracy loss for tractability. Approximate-NN structures (HNSW, FAISS) feed this stage.

---

## 3. Distributed and Parallel MST

When the graph does not fit on one machine, **Borůvka is the algorithm of choice** because its core step — "each component picks its cheapest outgoing edge" — is a *reduction* that parallelizes and distributes naturally. Kruskal's global sort and Prim's single growing tree are inherently sequential and central; Borůvka is not.

### Parallel Borůvka (shared-memory / GPU)

Each round:

1. **Min-reduce per component:** for every vertex, find the lightest edge to a different component (a segmented reduction).
2. **Resolve mirror edges:** edge `(a,b)` chosen by both endpoints — keep one copy (lowest edge id wins).
3. **Union / contract:** merge components (a concurrent Union-Find or a pointer-jumping relabel).
4. Repeat until one component.

`O(log V)` rounds; each round is data-parallel over `E`. GPU implementations of MST (e.g., in Gunrock) are Borůvka-based for exactly this reason.

### GHS — Distributed MST (Gallager–Humblet–Spira, 1983)

The canonical *message-passing* distributed MST algorithm, where each vertex is an autonomous processor that only knows its incident edges and exchanges messages with neighbors:

- Fragments (components) grow by each finding their **minimum-weight outgoing edge (MWOE)** and merging across it — Borůvka's idea, realized asynchronously with no global coordinator.
- Fragments carry a **level** and an **id**; merge/absorb rules use levels to keep the tree of merges balanced and avoid cycles.
- Cost: `O(V log V)` messages and `O(V log V)` time — asymptotically optimal in the message count for this model.

GHS underpins MST results in sensor networks and ad-hoc wireless topology control, where there is genuinely no central machine.

### Big-Graph / External-Memory MST

- **MapReduce / Spark:** iterate Borůvka rounds; each round is a `map` (emit per-component candidate min edges) + `reduce` (pick the min) + a relabel join. Components shrink geometrically, so the data shuffled shrinks each round — a few rounds dominate cost.
- **External memory:** when `E` exceeds RAM, sort edges on disk (external merge sort) and stream them through Kruskal with an in-memory Union-Find (only `O(V)` state needed). This is the classic out-of-core MST.
- **Edge sampling (Karger-Klein-Tarjan idea):** sample a fraction of edges, build a partial forest, and discard edges that are provably non-MST (heavier than the path in the sampled forest), shrinking the problem before the expensive pass.

---

## 4. Concurrency

- **Concurrent Union-Find** is the contended structure in parallel Kruskal/Borůvka. Lock-free Union-Find with `CAS` on the parent pointer and atomic union-by-rank exists, but contention on hot roots is real. Partition-then-merge (each thread builds a local forest, then merge forests) often beats fine-grained locking.
- **Per-component min-reduction** is naturally lock-free: each thread proposes a candidate min edge into a per-component slot using an atomic min/CAS.
- **Determinism:** parallel MST must break weight ties deterministically (by edge id) or different runs produce different — though equally optimal — trees. For reproducible clustering output this matters; downstream diffs explode if the tree is nondeterministic.
- **Prim does not parallelize well** — the single growing frontier serializes the algorithm. Do not try to thread Prim; reach for Borůvka.

---

## 5. Comparison at Scale

| Scenario | Recommended approach | Why |
|----------|----------------------|-----|
| Sparse, fits in RAM, edge list | Kruskal + fast Union-Find | Simple, cache-friendly, near-linear. |
| Dense / complete metric graph | Reduce to `k`-NN graph, then Borůvka/Kruskal | Avoid materializing `Θ(V²)` edges. |
| Multi-machine, edges partitioned | Distributed Borůvka (Spark/MapReduce) | Geometric component shrink; few rounds. |
| Message-passing / sensor net | GHS | No central coordinator; optimal message count. |
| GPU / many-core | Parallel Borůvka | Per-round data parallelism. |
| `E` > RAM, single box | External-memory Kruskal (disk sort + UF) | Only `O(V)` in-core state. |

Rule of thumb: **sequential → Kruskal/Prim; parallel/distributed → Borůvka/GHS.**

---

## 6. Architecture Patterns

- **Materialize-once, query-many:** build the MST (or full sorted-edge dendrogram) in a batch job; serve clustering cuts (`k`) as cheap reads — cutting `k−1` heaviest edges is `O(k)` once edges are sorted.
- **Incremental / dynamic MST:** if edges are added over time, maintain the MST with link-cut trees (`O(log V)` per edge insertion via the second-best-swap idea). Edge deletion is harder; fully dynamic MST is `O(√E)` per update with classic results.
- **Approximation as a stage:** MST is frequently a *subroutine* (TSP, Steiner, clustering). Architect it as a swappable component with a clear `graph → tree` contract so you can replace exact MST with an approximate `k`-NN MST without touching consumers.
- **Idempotent recompute:** make the MST job deterministic (sorted, tie-broken by id) so reruns after partial failure produce byte-identical output, enabling safe retries.

---

## 7. Code Examples

### Example 1: Streaming / External-Memory Kruskal

Process edges from an iterator (could be a disk-backed sorted stream), keeping only `O(V)` Union-Find state in memory. Works when the edge list is far larger than RAM.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"sort"
	"strings"
)

type DSU struct{ p, r []int }

func NewDSU(n int) *DSU {
	d := &DSU{p: make([]int, n), r: make([]int, n)}
	for i := range d.p {
		d.p[i] = i
	}
	return d
}
func (d *DSU) Find(x int) int {
	for d.p[x] != x {
		d.p[x] = d.p[d.p[x]]
		x = d.p[x]
	}
	return x
}
func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.r[ra] < d.r[rb] {
		ra, rb = rb, ra
	}
	d.p[rb] = ra
	if d.r[ra] == d.r[rb] {
		d.r[ra]++
	}
	return true
}

// StreamingKruskal assumes the scanner yields edges already sorted by weight,
// each line "w u v". Only O(V) state is held in memory.
func StreamingKruskal(n int, sc *bufio.Scanner) (int64, int) {
	dsu := NewDSU(n)
	var total int64
	used := 0
	for sc.Scan() {
		var w, u, v int
		fmt.Sscanf(sc.Text(), "%d %d %d", &w, &u, &v)
		if dsu.Union(u, v) {
			total += int64(w)
			if used++; used == n-1 {
				break
			}
		}
	}
	return total, used
}

func main() {
	// In production the input is a sorted on-disk file; here we sort in-memory for the demo.
	raw := [][3]int{{3, 0, 2}, {6, 0, 1}, {5, 1, 2}, {1, 1, 4}, {8, 1, 3}, {4, 3, 4}, {7, 2, 4}}
	sort.Slice(raw, func(i, j int) bool { return raw[i][0] < raw[j][0] })
	var b strings.Builder
	for _, e := range raw {
		fmt.Fprintf(&b, "%d %d %d\n", e[0], e[1], e[2])
	}
	total, used := StreamingKruskal(5, bufio.NewScanner(strings.NewReader(b.String())))
	fmt.Printf("MST weight=%d edges=%d\n", total, used) // 13, 4
}
```

#### Java

```java
import java.util.*;

public class StreamingKruskal {
    static int[] parent, rank_;
    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }
    static boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank_[ra] < rank_[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank_[ra] == rank_[rb]) rank_[ra]++;
        return true;
    }

    // Consumes an iterator of {w,u,v} pre-sorted by weight. Holds only O(V) state.
    static long[] streamingKruskal(int n, Iterator<int[]> sortedEdges) {
        parent = new int[n]; rank_ = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0; int used = 0;
        while (sortedEdges.hasNext()) {
            int[] e = sortedEdges.next();
            if (union(e[1], e[2])) { total += e[0]; if (++used == n - 1) break; }
        }
        return new long[]{total, used};
    }

    public static void main(String[] args) {
        List<int[]> edges = new ArrayList<>(List.of(
            new int[]{3,0,2}, new int[]{6,0,1}, new int[]{5,1,2},
            new int[]{1,1,4}, new int[]{8,1,3}, new int[]{4,3,4}, new int[]{7,2,4}));
        edges.sort(Comparator.comparingInt(e -> e[0]));   // disk sort in production
        long[] r = streamingKruskal(5, edges.iterator());
        System.out.println("MST weight=" + r[0] + " edges=" + r[1]); // 13, 4
    }
}
```

#### Python

```python
from typing import Iterator, Tuple


def streaming_kruskal(n: int, sorted_edges: Iterator[Tuple[int, int, int]]):
    """sorted_edges yields (w, u, v) already sorted by w (e.g. from a sorted file).
    Only O(V) Union-Find state is held in memory."""
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return False
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        return True

    total, used = 0, 0
    for w, u, v in sorted_edges:
        if union(u, v):
            total += w
            used += 1
            if used == n - 1:
                break
    return total, used


if __name__ == "__main__":
    edges = [(3, 0, 2), (6, 0, 1), (5, 1, 2), (1, 1, 4), (8, 1, 3), (4, 3, 4), (7, 2, 4)]
    edges.sort()                              # external merge sort in production
    print(streaming_kruskal(5, iter(edges)))  # (13, 4)
```

### Example 2: One Parallel Borůvka Round (per-component MWOE reduction)

The reduction step that distributes/parallelizes. Shown single-threaded for clarity; each component's min is an independent reduction you can fan out.

#### Python

```python
def boruvka_round(n, edges, parent):
    """One Borůvka round: each component finds its min outgoing edge, then merge.
    Returns (added_weight, components_merged). `parent` is mutated."""
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    # --- REDUCE phase (parallelizable): cheapest outgoing edge per component ---
    cheapest = {}
    for (u, v, w) in edges:
        ru, rv = find(u), find(v)
        if ru == rv:
            continue
        # tie-break by (w, edge tuple) so the round is deterministic across machines
        key = (w, u, v)
        if ru not in cheapest or key < cheapest[ru][0]:
            cheapest[ru] = (key, w, u, v)
        if rv not in cheapest or key < cheapest[rv][0]:
            cheapest[rv] = (key, w, u, v)

    # --- MERGE phase ---
    added, merged = 0, 0
    for _, w, u, v in cheapest.values():
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            added += w
            merged += 1
    return added, merged


if __name__ == "__main__":
    edges = [(0, 2, 3), (0, 1, 6), (1, 2, 5), (1, 4, 1), (1, 3, 8), (3, 4, 4), (2, 4, 7)]
    n = 5
    parent = list(range(n))
    total = 0
    while True:
        add, merged = boruvka_round(n, edges, parent)
        total += add
        if merged == 0:
            break
    print("MST weight:", total)  # 13
```

The Go/Java equivalents follow the same two-phase shape (reduce per-component MWOE, then union). The reduce phase is where you fan out across threads/executors, each owning a partition of the edge list and proposing candidate minima into atomic per-component slots.

---

## 8. Observability

- **Counters per Borůvka round:** components remaining, edges added, edges still live. A healthy run shows components roughly halving each round; if not, you have a tie-breaking or merge bug.
- **MST weight + edge count** as the headline metric: a correct connected result has exactly `V−1` edges; fewer means a forest (alarm if connectivity was expected).
- **Bottleneck (max MST edge weight)** is a useful SLO for clustering — a spike means the data has an outlier cluster gap.
- **Determinism check:** hash the sorted MST edge set; identical inputs must produce identical hashes across runs and machines.
- **Phase timing:** for Kruskal, sort time vs union time; sort almost always dominates, so optimization effort goes there (radix sort, pre-sorted input).
- **Union-Find depth / path-compression effectiveness:** track average `find` steps; a regression signals a missing union-by-rank.

---

## 9. Failure Modes

- **Disconnected graph (the big one):** there is no spanning *tree*. You get `< V−1` edges and a *forest*. Decide explicitly: (a) return the forest with a `components` count, (b) raise a domain error, or (c) add virtual zero-weight edges to a super-node if the consumer demands a single tree. Silent forests cause the worst downstream bugs (a clustering job that "succeeds" but every component is its own cluster).
- **Non-deterministic ties:** parallel/distributed runs that do not break ties by id produce different MSTs each run, breaking reproducibility and caching.
- **Weight overflow:** summing millions of large weights in 32-bit — use 64-bit accumulators.
- **Floating-point weights:** `NaN` poisons comparisons; near-equal floats make uniqueness/tie logic fragile. Quantize or use integer microcosts.
- **Borůvka cycle on equal weights:** without consistent tie-breaking two components mutually select edges forming a cycle in one round — always re-`find` before union and use a total order on edges.
- **Stale `k`-NN graph:** if the approximate neighbor graph omits the true cheapest cross-cluster edge, the MST is wrong; monitor the fraction of MST edges that came from approximate vs exact neighbors.

---

## 10. Capacity Planning

- **Memory:** Kruskal needs the edge list (`O(E)`) plus `O(V)` Union-Find; if `E` does not fit, sort on disk and stream (only `O(V)` resident). Array-Prim needs `O(V²)` for the matrix — infeasible past ~50k vertices (2.5B cells); use a `k`-NN sparse graph instead.
- **Time budget:** Kruskal ≈ `c · E log E` dominated by sort; on `10^8` edges expect tens of seconds single-threaded — radix sort or parallel sort to cut it. Borůvka ≈ `log V` passes over `E`.
- **Distributed shuffle:** Borůvka on Spark shuffles `O(E)` round 1, then geometrically less; the first round dominates network cost — co-partition edges by component to minimize cross-machine traffic.
- **`k`-NN sizing:** clustering quality vs cost is governed by `k`. `k = O(log V)` neighbors usually preserves the MST's important edges while keeping `E = O(V log V)`.
- **Determinism cost:** stable tie-breaking adds a secondary sort key — negligible time, large reproducibility payoff.

---

## 11. Summary

At scale the MST is a systems component, not a loop. Sequential builds use Kruskal (sparse, sortable, external-memory-friendly with `O(V)` resident state) or array-Prim (dense, in-memory). Parallel and distributed builds use **Borůvka** — its per-component minimum-outgoing-edge step is a reduction that maps onto threads, GPUs, and MapReduce, finishing in `O(log V)` geometrically-shrinking rounds — or **GHS** for true message-passing settings with no coordinator. The dominant real-world tricks are reducing dense `Θ(V²)` metric graphs to sparse `k`-NN graphs, breaking weight ties deterministically for reproducibility, and handling disconnected input as an explicit forest rather than a silent failure. Observability centers on per-round component shrink, the `V−1` edge invariant, MST weight/bottleneck, and a determinism hash.
