# Articulation Points & Bridges — Senior Level

> Finding cut vertices and bridges is a 25-line DFS on a whiteboard. In production it becomes a reliability-analysis pipeline over a service-dependency or physical-topology graph with millions of nodes — and the moment that graph is deep, the recursive DFS that worked in the interview blows the stack. The senior job is the scaffolding: iterative traversal, large-graph batching, freshness of the snapshot, and turning "these are the cut vertices" into an alert an on-call engineer can act on.

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Design — Reliability Analysis](#2-system-design--reliability-analysis)
3. [Distributed and Large-Graph Computation](#3-distributed-and-large-graph-computation)
4. [Concurrency](#4-concurrency)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns — the Block-Cut Tree](#6-architecture-patterns--the-block-cut-tree)
7. [Code Examples — Iterative DFS](#7-code-examples--iterative-dfs)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning](#10-capacity-planning)
11. [Summary](#11-summary)

---

## 1. Introduction

At senior level the question is not "what is the criterion" but "where does cut-vertex / bridge analysis sit in my system, and what breaks when it does?" The algorithm is a static, single-machine, recursive `O(V + E)` DFS. That sentence already flags three production concerns:

- **Static** — it analyzes one snapshot. Your topology changes; the result goes stale.
- **Single-machine** — it assumes the whole graph fits in one process's memory.
- **Recursive** — it assumes the DFS depth fits in the call stack.

The interesting senior decisions are therefore:

1. How do I run this on a graph too deep for the recursion stack? (Iterative DFS.)
2. How do I keep the answer fresh as the topology changes without recomputing from scratch every second?
3. How do I turn "vertex X is an articulation point" into an actionable SPOF (single-point-of-failure) alert with context?
4. How big can the graph get before one machine is the wrong tool?
5. How do I observe and validate this in a live system?

This document answers those in production terms.

---

## 2. System Design — Reliability Analysis

### 2.1 What the analysis produces

Given a graph that models *something physical or logical*:

- **Service dependency graph** — vertices are services, edges are "calls" or "depends on." An articulation point is a service whose outage partitions the call graph. A bridge is a dependency whose failure isolates a subsystem.
- **Physical network topology** — vertices are routers/switches, edges are links. Articulation points are routers whose failure splits the network; bridges are links with no redundant path.
- **Power grid / pipeline** — vertices are substations/junctions, edges are lines/pipes. Cut vertices and bridges are exactly the single points of failure that reliability engineering exists to eliminate.

The output is two sets — cut vertices and bridges — plus, usually, the **block-cut tree** and **bridge tree** so that "is A→B routed through a SPOF?" becomes a tree query rather than a re-scan.

### 2.2 Pipeline shape

```mermaid
flowchart LR
    A[Topology source<br/>CMDB / service mesh / SNMP] --> B[Build undirected graph<br/>adjacency list]
    B --> C[Iterative DFS<br/>disc/low, O(V+E)]
    C --> D[Cut vertices + bridges]
    D --> E[Block-cut tree + bridge tree]
    E --> F[SPOF report + alerts + dashboards]
```

The expensive senior mistake is treating this as a one-off script. Topology drifts continuously; the value is in a *scheduled* (or event-driven) recomputation feeding a reliability dashboard, plus diffing against the previous run so you alert only on *new* single points of failure.

---

## 3. Distributed and Large-Graph Computation

`disc`/`low` DFS is inherently **sequential** — `low[u]` depends on the fully-explored subtrees of `u`'s children, which is an ordering constraint that does not parallelize cleanly. So the scaling story is mostly "fit it on one big machine and make the traversal cheap," with a few escape hatches.

- **Single fat node first.** A graph with 10⁸ edges as a CSR (compressed sparse row) adjacency structure is a few GB. One machine with enough RAM handles it with an iterative DFS in seconds to low minutes. This is almost always the right answer.
- **Partition by connected component.** Cut vertices and bridges are defined per component. If the graph has many components, analyze each independently and in parallel across cores or machines — embarrassingly parallel at the component boundary.
- **External-memory / streaming DFS.** When the graph does not fit in RAM, use a semi-external DFS (keep `disc`/`low`/`visited` in memory, stream the edge list from disk). Edge lists for 10⁹ edges fit on SSD; the in-memory side tables are `O(V)`.
- **Bridges via Union-Find (less sequential).** Bridges (not cut vertices) can be found with a DSU-based approach that is friendlier to out-of-core processing than a strict DFS, because it can process edges in a more flexible order.
- **Truly distributed (Pregel / Giraph / GraphX).** Vertex-centric frameworks can compute connectivity-style results, but `disc`/`low` DFS maps poorly to the bulk-synchronous model. In practice, distributed cut/bridge detection is rare; people partition into components or buy a bigger box.

---

## 4. Concurrency

The core DFS is single-threaded by nature. Concurrency shows up around it:

- **Parallel across components.** Launch one worker per connected component. No shared mutable state between components → trivially safe. This is the main parallelism available.
- **Read-mostly snapshot.** The analysis reads an immutable graph snapshot. Multiple consumers (the SPOF report, the dashboard, a what-if simulator) can read the resulting cut/bridge sets and trees concurrently with no locks — they are immutable outputs.
- **Pipeline concurrency.** While DFS runs on snapshot N, the ingestion stage can already be building snapshot N+1. Double-buffer the graph; swap the pointer atomically when the new analysis completes.
- **Do not try to parallelize a single DFS.** The `low` recurrence is a dependency chain. Forcing threads onto one traversal needs locks on `low[]`/`disc[]` and almost always runs slower than the sequential version due to contention and the loss of cache locality.

---

## 5. Comparison at Scale

| Approach | Cut vertices | Bridges | Parallelism | Memory | When |
|----------|--------------|---------|-------------|--------|------|
| Recursive `disc`/`low` DFS | yes | yes | per-component | `O(V)` + stack | Small/medium, depth-bounded graphs. |
| **Iterative `disc`/`low` DFS** | yes | yes | per-component | `O(V)` explicit stack | **Default at scale** — no stack-overflow risk. |
| DSU-based bridge finding | no | yes | edge-order flexible | `O(V)` | Bridges only, out-of-core friendly. |
| Remove-and-check oracle | yes | yes | per-removal | `O(V+E)` | Correctness testing only. |
| Dynamic / online structures | partial | yes | — | `O(V)`+ | Topology changes frequently (`30-online-bridges`). |

At scale, the recursive-vs-iterative choice is the one that actually bites: a 5-million-vertex path graph has DFS depth 5 million, which overflows every default stack. The iterative version is the same `O(V + E)` with an explicit stack that lives on the heap.

---

## 6. Architecture Patterns — the Block-Cut Tree

The block-cut tree (and bridge tree) is the senior-level *artifact* you persist and query, not the raw cut/bridge sets.

### 6.1 Why a tree

Downstream questions are almost always of the form:

- "Does the path from service A to service B traverse a single point of failure?"
- "How many critical links separate region A from region B?"
- "If I add one redundant link, which path of bridges collapses?"

On the raw graph these are searches. On the **block-cut tree** (cut vertices ↔ blocks) and **bridge tree** (2ECCs contracted, bridges as edges) they are **tree path queries** — `O(path length)` or `O(log n)` with LCA preprocessing (`13-lca`). Build the tree once per snapshot, answer thousands of reliability queries cheaply.

### 6.2 Diffing snapshots

Persist the cut/bridge sets and the trees per snapshot. On each recompute, diff against the previous:

- **New cut vertex** → a service/router that just *became* a SPOF. Alert.
- **Removed bridge** → redundancy was added; good news, log it.
- **Bridge count on a critical A–B path increased** → resilience regressed.

Diffing is what turns a periodic batch job into an early-warning system.

### 6.3 What-if simulation

Because the trees are small (one node per block / 2ECC), you can cheaply simulate "what if we add edge (x, y)?" by checking whether `x` and `y` are in different parts of the tree — adding that edge makes the entire tree-path between them 2-connected, removing every cut/bridge on it. This is how redundancy-planning tools recommend the *single* most valuable link to add.

### 6.4 Constructing and persisting the block-cut tree

The block-cut tree is built in the same DFS that finds cut vertices, using an edge stack (see the middle-level biconnected-components code). The persisted artifact is small and query-friendly:

```
BC-tree node types:
  BLOCK  b0  = {edges of biconnected component 0}   (a "room")
  BLOCK  b1  = {single bridge edge}                  (a one-edge room)
  CUT    c1  = articulation vertex v                 (a "doorway")

BC-tree edges connect each CUT node to every BLOCK that contains it:

        b0 ── c(service-A) ── b1 ── c(service-B) ── b2
       (DB     (gateway        (link  (cache         (web
        cluster) is a SPOF)    bridge) is a SPOF)     tier)
```

Reading this tree: any path between two service vertices that crosses a CUT node means that cut vertex (a doorway) is a single point of failure on every route between them. The number of BLOCK nodes a query path passes through is the number of independent failure domains it spans. Persist three columns per snapshot — `snapshot_id`, `node` (block id or cut vertex), `members` — plus the tree adjacency, and reliability queries become indexed lookups.

### 6.5 SPOF report shape

A useful single-point-of-failure report is not "vertex 4837 is an articulation point." It is contextual:

| field | example | source |
|-------|---------|--------|
| `spof_vertex` | `payments-gateway` | articulation set |
| `severity` | how many vertices get isolated if it fails | size of the subtrees it separates |
| `affected_services` | `[checkout, refunds, ledger]` | the smaller side of the cut |
| `blocks_joined` | `b0 (DB cluster), b3 (web tier)` | BC-tree neighbors |
| `suggested_fix` | "add link checkout↔ledger" | what-if simulation (6.3) |
| `first_seen_snapshot` | `2026-06-02T14:00` | diff history |

`severity` ranked by isolated-vertex count is what lets on-call triage: a cut vertex that isolates three leaf services is far less urgent than one that bisects the fleet 50/50.

---

## 7. Code Examples — Iterative DFS

The recursive DFS is correct but unusable on deep graphs. Here is an **iterative** articulation-point + bridge finder using an explicit stack, computing the same `disc`/`low`. The trick is to remember our position in each vertex's neighbor list (an iterator index) and to do the post-processing (`low[u] = min(low[u], low[child])` and the criteria) when we *return* to a vertex.

#### Go

```go
package main

import "fmt"

type Graph struct {
	n   int
	adj [][]int
}

func NewGraph(n int) *Graph { return &Graph{n: n, adj: make([][]int, n)} }
func (g *Graph) AddEdge(u, v int) {
	g.adj[u] = append(g.adj[u], v)
	g.adj[v] = append(g.adj[v], u)
}

func (g *Graph) Analyze() (map[int]bool, [][2]int) {
	disc := make([]int, g.n)
	low := make([]int, g.n)
	parent := make([]int, g.n)
	iter := make([]int, g.n) // next neighbor index to examine for each vertex
	for i := range disc {
		disc[i] = -1
		parent[i] = -1
	}
	timer := 0
	aps := map[int]bool{}
	var bridges [][2]int

	type frame struct{ u int }
	for s := 0; s < g.n; s++ {
		if disc[s] != -1 {
			continue
		}
		stack := []frame{{s}}
		disc[s], low[s] = timer, timer
		timer++
		rootChildren := 0

		for len(stack) > 0 {
			u := stack[len(stack)-1].u
			if iter[u] < len(g.adj[u]) {
				v := g.adj[u][iter[u]]
				iter[u]++
				if v == parent[u] {
					continue // skip the parent edge (no multi-edges assumed here)
				}
				if disc[v] == -1 {
					parent[v] = u
					disc[v], low[v] = timer, timer
					timer++
					if u == s {
						rootChildren++
					}
					stack = append(stack, frame{v})
				} else {
					if disc[v] < low[u] {
						low[u] = disc[v] // back edge
					}
				}
			} else {
				// done with u: pop and fold into parent
				stack = stack[:len(stack)-1]
				p := parent[u]
				if p != -1 {
					if low[u] < low[p] {
						low[p] = low[u]
					}
					if p != s && low[u] >= disc[p] {
						aps[p] = true
					}
					if low[u] > disc[p] {
						bridges = append(bridges, [2]int{p, u})
					}
				}
			}
		}
		if rootChildren >= 2 {
			aps[s] = true
		}
	}
	return aps, bridges
}

func main() {
	g := NewGraph(6)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}} {
		g.AddEdge(e[0], e[1])
	}
	aps, bridges := g.Analyze()
	fmt.Println("articulation points:", aps) // {1, 3}
	fmt.Println("bridges:", bridges)          // [[1 3]]
}
```

#### Java

```java
import java.util.*;

public class IterativeCuts {
    int n;
    List<List<Integer>> adj;
    IterativeCuts(int n) {
        this.n = n;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
    }
    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    Set<Integer> aps = new HashSet<>();
    List<int[]> bridges = new ArrayList<>();

    void analyze() {
        int[] disc = new int[n], low = new int[n], parent = new int[n], iter = new int[n];
        Arrays.fill(disc, -1);
        Arrays.fill(parent, -1);
        int timer = 0;
        for (int s = 0; s < n; s++) {
            if (disc[s] != -1) continue;
            Deque<Integer> stack = new ArrayDeque<>();
            disc[s] = low[s] = timer++;
            stack.push(s);
            int rootChildren = 0;
            while (!stack.isEmpty()) {
                int u = stack.peek();
                if (iter[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(iter[u]++);
                    if (v == parent[u]) continue;
                    if (disc[v] == -1) {
                        parent[v] = u;
                        disc[v] = low[v] = timer++;
                        if (u == s) rootChildren++;
                        stack.push(v);
                    } else {
                        low[u] = Math.min(low[u], disc[v]);
                    }
                } else {
                    stack.pop();
                    int p = parent[u];
                    if (p != -1) {
                        low[p] = Math.min(low[p], low[u]);
                        if (p != s && low[u] >= disc[p]) aps.add(p);
                        if (low[u] > disc[p]) bridges.add(new int[]{p, u});
                    }
                }
            }
            if (rootChildren >= 2) aps.add(s);
        }
    }

    public static void main(String[] args) {
        IterativeCuts g = new IterativeCuts(6);
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}};
        for (int[] e : edges) g.addEdge(e[0], e[1]);
        g.analyze();
        System.out.println("articulation points: " + g.aps);
        for (int[] b : g.bridges) System.out.println("bridge: " + b[0] + "-" + b[1]);
    }
}
```

#### Python

```python
import sys


def analyze(n, adj):
    disc = [-1] * n
    low = [0] * n
    parent = [-1] * n
    it = [0] * n
    timer = 0
    aps = set()
    bridges = []

    for s in range(n):
        if disc[s] != -1:
            continue
        disc[s] = low[s] = timer
        timer += 1
        stack = [s]
        root_children = 0
        while stack:
            u = stack[-1]
            if it[u] < len(adj[u]):
                v = adj[u][it[u]]
                it[u] += 1
                if v == parent[u]:
                    continue
                if disc[v] == -1:
                    parent[v] = u
                    disc[v] = low[v] = timer
                    timer += 1
                    if u == s:
                        root_children += 1
                    stack.append(v)
                else:
                    low[u] = min(low[u], disc[v])  # back edge
            else:
                stack.pop()
                p = parent[u]
                if p != -1:
                    low[p] = min(low[p], low[u])
                    if p != s and low[u] >= disc[p]:
                        aps.add(p)
                    if low[u] > disc[p]:
                        bridges.append((p, u))
        if root_children >= 2:
            aps.add(s)
    return aps, bridges


if __name__ == "__main__":
    n = 6
    adj = [[] for _ in range(n)]
    for u, v in [(0, 1), (1, 2), (2, 0), (1, 3), (3, 4), (4, 5), (5, 3)]:
        adj[u].append(v)
        adj[v].append(u)
    aps, bridges = analyze(n, adj)
    print("articulation points:", sorted(aps))  # [1, 3]
    print("bridges:", bridges)                    # [(1, 3)]
```

**Why it matters:** this version uses an explicit heap-allocated stack of depth `O(V)`, so a 10-million-vertex path graph that would crash the recursive version runs fine. The `iter[]` array remembers where each vertex left off in its neighbor list; the per-vertex post-processing on pop is where `low` is folded into the parent and the criteria are applied. For multi-edge safety, replace the parent-vertex skip with a parent-edge-id skip exactly as in the middle-level code.

---

## 8. Observability

A reliability analysis that runs silently is useless. Instrument it.

| Metric | Type | Why |
|--------|------|-----|
| `topology_vertices`, `topology_edges` | gauge | Detect graph growth that may break capacity assumptions. |
| `articulation_point_count` | gauge | The number of SPOF vertices. A rise is a resilience regression. |
| `bridge_count` | gauge | The number of critical links. Trend it over time. |
| `analysis_duration_seconds` | histogram | Detect when the graph outgrew the single-node budget. |
| `dfs_max_depth` | gauge | If it approaches recursion limits, you *must* be on the iterative path. |
| `new_spof_total` | counter | Diff vs previous snapshot — newly-introduced single points of failure. |
| `snapshot_staleness_seconds` | gauge | How old is the analyzed topology vs reality? |

The two most actionable signals are `new_spof_total` (something *became* critical since last run) and `snapshot_staleness_seconds` (are we analyzing reality or history?). Attach the offending vertex/edge ids and their block-cut-tree neighborhood to every SPOF alert so the on-call engineer has context, not just a number.

---

## 9. Failure Modes

### 9.1 Recursion-depth stack overflow

The classic. A long path or a deep DFS tree drives recursion depth to `O(V)`. Default stacks handle a few thousand to tens of thousands of frames; millions overflow. **Mitigation:** the iterative DFS above. In Go, also be aware goroutine stacks grow but still have a limit; in Java set `-Xss` only as a stopgap; in Python `setrecursionlimit` plus a larger thread stack is fragile — prefer iterative.

### 9.2 Stale snapshot

You alert (or fail to alert) based on a topology that no longer matches reality. **Mitigation:** event-driven recompute on topology change, or a short scheduling interval, plus the `snapshot_staleness_seconds` gauge with an alert threshold.

### 9.3 Treating a directed graph as undirected

Service-call graphs are often directed. Cut vertices/bridges are an *undirected* concept; if connectivity in your domain is directional, you need SCCs (`08-tarjan-scc`), not this. **Mitigation:** be explicit about whether reachability is symmetric. If "A depends on B" does not imply "B depends on A," do not symmetrize blindly.

### 9.4 Multi-edges and self-loops from messy topology data

Real CMDB/topology data has duplicate links and self-references. The naive parent-vertex skip then mis-reports bridges. **Mitigation:** parent-edge-id skip; drop self-loops during graph construction.

### 9.5 Disconnected input silently analyzed as one graph

If you only DFS from vertex 0, you miss everything in other components. **Mitigation:** loop over all vertices; report results per component.

### 9.6 Alert storms after a planned change

A planned topology change (decommissioning redundant links) can momentarily spike the SPOF count and page everyone. **Mitigation:** diff-based alerting with a maintenance-window suppression, and alert on the *delta* not the absolute count.

### 9.7 Off-by-one in the iterative low-fold

The most common *correctness* bug in production code is folding `low[u]` into the wrong parent in the iterative version. With a parent-vertex stack you must fold into `stack.peek()` *after* popping `u` (the new top is `u`'s parent), or equivalently track `parent[]` explicitly. A common mistake — folding into `parent[u]` while it is still stale, or applying the criteria on *enter* rather than on *pop* — silently misclassifies cut vertices on graphs with cross-subtree back edges. **Mitigation:** keep a brute-force remove-and-check oracle in the test suite and fuzz against random small graphs; the bug surfaces immediately.

### 9.8 Incident runbook — "new SPOF" page

When `new_spof_total` increments and pages on-call:

1. **Confirm freshness.** Check `snapshot_staleness_seconds`. If the snapshot is hours old, the SPOF may already be resolved — re-run the analysis on a fresh topology pull before acting.
2. **Read the severity.** Pull `affected_services` and the isolated-vertex count. A 50/50 bisection is sev-1; a three-leaf isolation is sev-3.
3. **Find the cause in the diff.** Compare against the previous snapshot's bridge/cut sets — which edge was *removed* (or which redundant path went down) to create this cut? That removed edge is usually the real incident.
4. **Apply the suggested fix or restore redundancy.** Either re-establish the lost redundant link, or add the what-if-recommended edge from the SPOF report. Verify the next analysis run shows the SPOF cleared.
5. **Suppress if planned.** If the change was a maintenance-window decommission, acknowledge and suppress rather than reverting.

---

## 10. Capacity Planning

### 10.1 Memory

Side tables are `O(V)`: `disc`, `low`, `parent`, `visited`, `iter` — five `int` arrays, ~20 bytes/vertex plus the adjacency structure (~`8·(2E)` bytes for an undirected CSR with 32-bit ids). For `V = 10⁷`, `E = 5·10⁷`:

- Side tables: `5 · 4 bytes · 10⁷ ≈ 200 MB`.
- CSR adjacency: `~8 bytes · 10⁸ endpoints ≈ 800 MB`.
- Total ~1 GB — comfortable on a single 8–16 GB machine.

### 10.2 Time

Linear in `V + E`. Practical throughput is roughly 10–100 M edges/second for an iterative DFS, dominated by random memory access into the adjacency structure. So `E = 10⁸` runs in ~1–10 seconds. A second pass for BCCs/trees doubles that at most.

### 10.3 Sizing table across scales

| Graph (V / E) | CSR adjacency | Side tables (5×int32) | Edge stack (BCC) | Iterative DFS time | Verdict |
|---------------|---------------|-----------------------|------------------|--------------------|---------|
| 10⁴ / 5·10⁴ | ~0.4 MB | ~0.2 MB | ~0.2 MB | < 1 ms | trivial, even recursive |
| 10⁶ / 5·10⁶ | ~40 MB | ~20 MB | ~20 MB | ~50–200 ms | single node, iterative |
| 10⁷ / 5·10⁷ | ~400 MB | ~200 MB | ~200 MB | ~1–5 s | single node, iterative |
| 10⁸ / 5·10⁸ | ~4 GB | ~2 GB | ~2 GB | ~10–60 s | fat node (16–32 GB) |
| 10⁹ / 5·10⁹ | ~40 GB | ~20 GB | streamed | minutes | semi-external / SSD |

The CSR figure assumes 32-bit endpoint ids (`8 bytes × 2E` for an undirected graph stored both directions). The recursive variant adds `O(depth)` call frames — fatal on the deep-graph rows, which is why every row from 10⁶ up specifies *iterative*. The edge stack is only allocated when you extract biconnected components / the block-cut tree; pure cut+bridge detection skips it.

### 10.4 When to leave the single node

Move off one machine only when:

- The graph genuinely exceeds RAM (≳ 10⁹ edges) → semi-external DFS streaming edges from SSD.
- You have *many* independent components/snapshots → fan out across workers, one component each.
- You need sub-second freshness on a constantly-mutating graph → dynamic/online bridge maintenance (`30-online-bridges`) instead of full recompute.

Until one of those is true, a single fat node with an iterative DFS is the right and simplest answer.

### 10.5 Recompute cadence and SLO budget

The freshness SLO drives the schedule, not the other way around. If the topology mutates every few minutes and your reliability SLO promises "SPOF alerts within 5 minutes of a change," then a 10⁷-edge graph analyzed in ~3 s leaves ample budget for a 1-minute cron — staleness stays well under target. But if you promise sub-second freshness on a constantly-churning graph, full recompute cannot keep up regardless of how fast a single pass is: at one mutation per 100 ms, even a 50 ms analysis falls behind, and you must switch to incremental/online bridge maintenance (`30-online-bridges`). The decision rule:

```
recompute_interval  >=  analysis_time  +  ingestion_time
staleness_p99       ~=  recompute_interval + analysis_time
if staleness_p99 > freshness_SLO:  go event-driven, then go online/dynamic
```

Event-driven recompute (trigger on a topology-change event rather than a fixed cron) cuts staleness to roughly `analysis_time` plus event-propagation latency, and is the usual middle ground before reaching for the dynamic structures.

---

## 11. Summary

- The algorithm is a static, sequential, recursive `O(V + E)` DFS — every production concern follows from those three words.
- **Go iterative.** The recursive `disc`/`low` DFS overflows on deep graphs; the explicit-stack version is the same complexity and the default at scale.
- Parallelism lives at the **component boundary**, not inside a single DFS — the `low` recurrence is a dependency chain.
- Persist the **block-cut tree** and **bridge tree**, not just the raw sets; they turn reliability questions into cheap tree-path queries and enable what-if redundancy planning.
- **Diff snapshots** to alert on *newly introduced* single points of failure, and track **staleness** so you are analyzing reality.
- A single fat node handles 10⁸-edge graphs in seconds; leave it only for out-of-RAM graphs, many independent snapshots, or sub-second freshness needs (which point to dynamic structures).
- Watch the traps: directed-graph confusion (use SCC), multi-edges/self-loops from messy data, disconnected input, and alert storms on planned changes.

References to study further: Tarjan's original 1972 paper; Hopcroft–Tarjan biconnected components; the relationship to Menger's theorem and `23-edge-vertex-connectivity`; and incremental/online bridge maintenance in `30-online-bridges`.
