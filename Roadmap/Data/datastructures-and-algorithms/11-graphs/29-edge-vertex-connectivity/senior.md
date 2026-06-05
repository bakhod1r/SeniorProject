# Edge & Vertex Connectivity — Senior Level

> **One-line summary:** Connectivity is the formal language of fault tolerance. A senior engineer uses `λ` and `κ` to *quantify* redundancy in service meshes, network fabrics, and dependency graphs — turning "we think it's redundant" into an SLA-grade guarantee, and using Gomory–Hu trees and Stoer–Wagner at scale to find the weak cuts before an outage does.

---

## Table of Contents

1. [System Design: Reliability Analysis of Service & Network Graphs](#1-system-design-reliability-analysis-of-service--network-graphs)
2. [Large-Scale Considerations](#2-large-scale-considerations)
3. [Concurrency & Parallelism](#3-concurrency--parallelism)
4. [Comparison of Approaches](#4-comparison-of-approaches)
5. [Architecture & Integration](#5-architecture--integration)
6. [Reference Implementation](#6-reference-implementation)
7. [Observability & Metrics](#7-observability--metrics)
8. [Failure Modes](#8-failure-modes)
9. [Capacity Planning](#9-capacity-planning)
10. [Decision Guide](#10-decision-guide)
11. [Summary](#11-summary)

---

## 1. System Design: Reliability Analysis of Service & Network Graphs

The senior-level use of connectivity is not "solve a textbook graph" — it is **answering reliability questions about real infrastructure**. The shift in mindset is from "compute a number" to "build a continuously-running reliability sensor that turns the topology into measured fault-tolerance guarantees and names the weak spots." Three recurring shapes:

**Service dependency graph.** Vertices are microservices; an edge `A → B` means "A calls B." A vertex cut tells you which services, if simultaneously down, partition the call graph (orders can no longer reach payments). Here vertex connectivity `κ` is the headline number: it is the minimum number of *service* failures that severs a critical path. `κ = 1` flags a single point of failure — exactly the articulation points from sibling `11-articulation-points-bridges`.

**Physical / overlay network fabric.** Vertices are routers or availability zones; edges are links. Edge connectivity `λ` answers "how many link failures before the fabric splits?" Weighted edges (capacity, latency budget) make Stoer–Wagner the natural tool: the global min-cut is the cheapest way the network can bisect, and its value is your link-redundancy margin.

**Data-replication topology.** Vertices are replicas; edges are replication channels. A min-cut that isolates a set of replicas is a *split-brain risk*. The Gomory–Hu tree lets you query, for any pair of replicas, how many independent channels connect them — and therefore how many channel failures cause divergence.

**Clustering and segmentation.** The same min-cut machinery powers *partitioning* tasks: min-cut clustering splits a similarity graph at its weakest links, and image segmentation (graph-cut methods) separates foreground from background by computing an `s-t` min-cut where `s`/`t` are seed pixels. Here you are not measuring fragility but *exploiting* the cut to divide data — the algorithms are identical, only the interpretation differs. A senior engineer recognizes that "reliability weak point" and "natural cluster boundary" are the same min-cut wearing different hats.

The senior reframing: **connectivity = the size of the smallest disaster.** You compute it offline, periodically, against the live topology graph, and you alert when any cut drops below your fault-tolerance target `k`.

### Designing the analysis pipeline

```
topology source (service registry / SDN controller / config)
        │  scrape every N minutes
        ▼
build weighted undirected (or directed) graph
        │
        ▼
compute:  global min-cut (Stoer-Wagner)         → fabric resilience
          per-critical-pair cut (Gomory-Hu)     → path redundancy
          articulation points / bridges (DFS)   → k=1 hot spots
        │
        ▼
compare to target k; emit metrics + alerts; render the weak cut for humans
```

The deliverable is rarely a single number — it is the **weak cut itself** (which links/services), rendered so an on-call engineer can act.

### Worked case: a three-region service mesh

Consider a payments platform with three regions, each running `frontend → orders → payments → ledger`, cross-connected by a regional load balancer and a shared `auth` service. Modeling each instance as a vertex and each call edge as a link, you ask three questions:

1. **Global `λ`** — the cheapest set of links whose loss bisects the mesh. Stoer–Wagner returns, say, `λ = 2` with the weak cut being the two inter-region replication links. That means *two link failures* can split the mesh — below a `λ ≥ 3` target for a tier-1 platform.
2. **`κ(orders, ledger)`** — node-disjoint paths from orders to ledger. Node-splitting + flow returns `2`, and the Gomory–Hu tree shows the bottleneck is the single shared `auth` node, which every path traverses. `auth` is an articulation point: `κ` collapses to 1 once you require `auth` on the path.
3. **Articulation points** — the linear DFS flags `auth` and the regional LB instantly.

The *finding that matters* is not "`λ = 2`" but "`auth` is a single point of failure and the inter-region links are the weak cut." The remediation — add a redundant `auth` replica reachable by a disjoint path, and a third inter-region link — is read directly off the cut. After the change you re-run and confirm `κ ≥ 2` and `λ ≥ 3`.

---

## 2. Large-Scale Considerations

Real topology graphs range from hundreds of services to hundreds of thousands of network elements. The algorithm choice is dictated by scale and density.

- **Small & dense (`V ≤ a few thousand`, `E ≈ V²`):** Stoer–Wagner `O(V³)` is fine and dependency-free. A 2000-vertex dense graph is ~8·10⁹ operations — minutes, acceptable for an offline job.
- **Large & sparse (`V` in the 10⁵, `E ≈ cV`):** Stoer–Wagner's `O(V²)` matrix alone is 10¹⁰ entries — infeasible. Use sparse Dinic-based flow with the fix-source/vary-sink global recipe, and exploit early termination at the target `k`.
- **Massive (`V` in the millions):** exact global connectivity is impractical. Switch to **`k`-connectivity *testing*** (is `λ ≥ k`?) which stops each flow at `k` units, or to **sampling / Karger** for an estimate. Often you only need "no bridges, no articulation points" — a single linear-time DFS.

**Decomposition.** Large graphs are rarely uniformly dense. Real topologies are clustered — dense within a region, sparse between regions — so global structure (bridges between clusters) is cheap to find while the expensive dense work is confined to small components. Pre-decompose into biconnected / 2-edge-connected components (sibling 11) and analyze each component independently; the global min-cut is `min` over components' cuts plus the trivially-1 cuts at the gluing bridges/articulation points.

**Incrementality.** Topology changes are usually *small deltas* (a link added, a service drained). Recomputing from scratch every minute is wasteful at scale. Maintain the previous cut and only recompute when an edit touches the current min-cut region; sibling `30-online-bridges` covers the dynamic `k = 1` case.

**Memory is the wall, not time.** For the dense Stoer–Wagner variant the `O(V²)` weight matrix dominates. At `V = 10⁴` that is `10⁸` machine words — roughly 800 MB for `int64`, the practical ceiling on a single node. Time (`O(V³) ≈ 10¹²`) is large but *parallelizable across components*; memory is not. This inverts the usual intuition and pushes large graphs toward sparse adjacency-list flow regardless of asymptotic time.

**Numerical considerations.** When edges carry real-valued weights (latency budgets, bandwidth in Gbps), accumulate the maximum-adjacency weights in a type with enough range — summing many edge weights into a super-vertex can overflow 32-bit integers on large dense graphs. Prefer 64-bit accumulators, and for floating-point weights beware that ties in the max-adjacency selection become sensitive to rounding; break ties deterministically (lowest index) so runs are reproducible.

---

## 3. Concurrency & Parallelism

Connectivity jobs are batch/offline, which makes them embarrassingly parallelizable along several axes:

- **Per-pair flows are independent.** The fix-source/vary-sink global computation runs `V − 1` *independent* `s-t` flows. Distribute them across a worker pool; combine with a `min`-reduce. Gomory–Hu's `V − 1` flows are *sequential* (each depends on the evolving tree), so they do **not** parallelize the same way — a key distinction.
- **Stoer–Wagner is inherently sequential** (each phase merges based on the previous graph state), so parallelism lives *inside* a phase: the maximum-adjacency scan over `V` candidates can be parallelized, though the gain is modest below very large `V`.
- **Karger trials are independent and ideal for parallelism** — run thousands of contraction trials across cores/machines and take the global min. This is the most scalable exact-in-probability approach.
- **Read-only graph snapshot.** Because analysis is offline on a frozen snapshot, you avoid the locking nightmares of live mutation. Concurrency here is about *throughput* (more trials, more pairs), not shared-state correctness. See sibling concurrency material and the `concurrency-patterns` skill for worker-pool design.
- **Amdahl reality.** The fix-source/vary-sink global `λ` is `V − 1` independent flows, so it parallelizes near-linearly — but the *result merge* (`min`-reduce) and the topology ingest are serial. With ingest at, say, 5% of total time, the speedup ceiling is ~20× regardless of core count. For genuinely large analyses the bottleneck shifts to ingest and snapshot transfer, not the flows; profile before scaling the worker pool.

Caution: max-flow's residual graph is *mutated* during augmentation, so each parallel flow needs its **own copy** of the residual structure. Sharing it across threads is a classic data race.

A safe parallel pattern for the fix-source/vary-sink global `λ` distributes independent sinks across a worker pool, each worker cloning the immutable capacity template:

```go
func parallelGlobalLambda(n int, edges [][2]int, workers int) int {
    tasks := make(chan int, n)
    results := make(chan int, n)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for t := range tasks {
                // stEdgeConn builds its OWN capacity matrix — no shared mutable state
                results <- stEdgeConn(n, edges, 0, t)
            }
        }()
    }
    for t := 1; t < n; t++ {
        tasks <- t
    }
    close(tasks)
    go func() { wg.Wait(); close(results) }()
    best := 1 << 30
    for c := range results {
        if c < best {
            best = c
        }
    }
    return best
}
```

The correctness hinge is that `stEdgeConn` allocates a fresh matrix per call, so workers never touch shared residual state — only the read-only `edges` slice is shared. The `min`-reduce over `results` is order-independent, so the result is deterministic despite non-deterministic completion order.

---

## 4. Comparison of Approaches

| Approach | Scale sweet spot | Output | Parallel? | Operational cost |
|----------|------------------|--------|-----------|------------------|
| Stoer–Wagner | small-medium dense weighted | global `λ` + cut side | weakly (intra-phase) | self-contained, no flow infra |
| Flow per pair (Dinic) | sparse, any size with care | per-pair or global `λ` | yes (pairs independent) | needs robust flow impl |
| Gomory–Hu | many pairwise queries | all-pairs cut tree | no (sequential build) | one build amortizes queries |
| Karger / Karger–Stein | very dense, estimate-OK | global `λ` whp | yes (trials independent) | tune trial count vs confidence |
| Gomory–Hu (per-pair) | repeated pairwise queries | all-pairs cuts | no (sequential) | one build, unlimited cheap queries |
| Bridges / articulation DFS | the `k = 1` question | cut vertices/edges | trivially (per component) | linear, cheapest, run always |
| Even's `κ ≥ k` test | bounded vertex conn. check | boolean | yes (pairs) | early-exit flows |

A senior decision is rarely "which is asymptotically best" — it is "which gives the *actionable artifact* (the actual cut), at acceptable cost, on *this* topology, with the infra we already run." Bridges/articulation DFS is so cheap it should run on *every* snapshot regardless; the heavier global computation runs less frequently.

### A layered cadence

A mature setup layers the approaches by cost and frequency, not picking one:

| Layer | Runs | Cost | Catches |
|-------|------|------|---------|
| L1: bridge/articulation DFS | every snapshot (seconds) | `O(V+E)` | `k = 1` single points of failure |
| L2: `k`-connectivity test | every few minutes | `O(k·V)` flows, early-exit | "is `λ/κ ≥ target`?" regressions |
| L3: exact global cut | hourly / on big deltas | Stoer–Wagner `O(V³)` or flow | the precise weak cut + redundancy margin |
| L4: Gomory–Hu (per critical pair) | nightly / on demand | `V−1` flows | path redundancy for named pairs |

L1 and L2 are cheap enough to run constantly and catch most regressions; L3/L4 produce the detailed artifacts engineers use to plan. The key insight: you do not choose *one* algorithm, you stage them so the expensive exact computation runs only when the cheap tests suggest something changed.

---

## 5. Architecture & Integration

A connectivity-analysis subsystem typically slots into the reliability/observability stack:

```
┌────────────────────────────────────────────────────────────┐
│  Topology Ingest                                             │
│   - service registry (Consul/Eureka), SDN, IaC graph        │
│   - normalizes to a weighted (un)directed edge list         │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│  Connectivity Engine                                         │
│   - decompose into 2-edge-connected components               │
│   - Stoer-Wagner per component  → global λ + weak cut        │
│   - Gomory-Hu over critical pairs → path redundancy          │
│   - articulation/bridge DFS      → k=1 hotspots              │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│  Reporting & Alerting                                        │
│   - metric: min_cut_value, k_connectivity per critical pair  │
│   - alert: min_cut < target_k                                │
│   - render: highlight cut edges/vertices on topology map     │
└────────────────────────────────────────────────────────────┘
```

The pipeline shape matters because connectivity analysis is *read-heavy and bursty*: it scrapes a snapshot, does an intense burst of computation, and emits a small result. This argues for a stateless, horizontally-scalable worker that pulls a topology snapshot, runs the engine, and pushes metrics — rather than a long-lived stateful service. Snapshots are immutable, so workers need no coordination and can be scaled by snapshot age or graph size.

Integration principles:

- **Decouple ingest from analysis.** The graph builder should be a pure function `topology → graph`; the engine should not know where the topology came from. This lets you unit-test the engine on synthetic graphs.
- **Emit the cut as structured data**, not just a number — `{value, sideA, sideB, cut_edges}` — so downstream renderers and runbooks can use it.
- **Make `k` (the target) configurable per critical pair.** Payment↔ledger may demand `κ ≥ 3`; a best-effort analytics path may accept `κ = 1`. Store these targets as policy alongside the service catalog so the engine reads criticality from a single source of truth, not hardcoded thresholds.
- **Treat the engine as a library with a thin service shell.** The pure `graph → cut` core should be unit-testable in isolation and reusable from a CLI, a batch job, and the online service alike, so the same verified code path backs ad-hoc investigation and continuous monitoring.
- **Cache the Gomory–Hu tree** keyed by a topology hash; rebuild only on change. Querying the cached tree is `O(V)` per pair.
- **Version the snapshot and the result together.** Store the topology hash alongside the computed cut so a stale alert can be traced back to the exact graph it was computed on. Reliability findings that cannot be reproduced from a recorded snapshot are not actionable — an engineer must be able to re-render "the graph as it was when this fired."
- **Keep the engine pure and deterministic.** Given the same snapshot, the same cut must come out — no wall-clock, no unseeded randomness in the deterministic path. This makes results cacheable, diffable across runs, and trustworthy in a postmortem.

---

## 6. Reference Implementation

A production-leaning global-`λ` engine that decomposes by component and recovers the cut side. Shown in Go (the orchestration), Java, and Python (Stoer–Wagner with side recovery).

#### Go

```go
package main

import "fmt"

// Result carries both the cut value and one side of the partition.
type Result struct {
	Value int
	Side  []int // original vertices on one side of the best cut
}

func stoerWagnerWithSide(w [][]int) Result {
	n := len(w)
	g := make([][]int, n)
	for i := range g {
		g[i] = append([]int(nil), w[i]...)
	}
	// groups[v] = original vertices merged into super-vertex v
	groups := make([][]int, n)
	for i := range groups {
		groups[i] = []int{i}
	}
	alive := make([]bool, n)
	for i := range alive {
		alive[i] = true
	}
	best := 1 << 30
	var bestSide []int
	for phase := n; phase > 1; phase-- {
		weight := make([]int, n)
		added := make([]bool, n)
		prev, last := -1, -1
		for i := 0; i < phase; i++ {
			sel := -1
			for v := 0; v < n; v++ {
				if alive[v] && !added[v] && (sel == -1 || weight[v] > weight[sel]) {
					sel = v
				}
			}
			added[sel] = true
			prev, last = last, sel
			for v := 0; v < n; v++ {
				if alive[v] && !added[v] {
					weight[v] += g[sel][v]
				}
			}
		}
		if weight[last] < best {
			best = weight[last]
			bestSide = append([]int(nil), groups[last]...)
		}
		alive[last] = false
		groups[prev] = append(groups[prev], groups[last]...)
		for v := 0; v < n; v++ {
			g[prev][v] += g[last][v]
			g[v][prev] += g[v][last]
		}
	}
	return Result{Value: best, Side: bestSide}
}

func main() {
	edges := [][3]int{{0, 1, 2}, {0, 4, 3}, {1, 2, 3}, {1, 4, 2}, {1, 5, 2},
		{2, 3, 4}, {2, 6, 2}, {3, 6, 2}, {3, 7, 2}, {4, 5, 3}, {5, 6, 1}, {6, 7, 3}}
	n := 8
	w := make([][]int, n)
	for i := range w {
		w[i] = make([]int, n)
	}
	for _, e := range edges {
		w[e[0]][e[1]] += e[2]
		w[e[1]][e[0]] += e[2]
	}
	r := stoerWagnerWithSide(w)
	fmt.Printf("min cut = %d, side = %v\n", r.Value, r.Side) // 4
}
```

#### Java

```java
import java.util.*;

public class ConnectivityEngine {
    static int[] sideOfBest;
    static int stoerWagner(int[][] w) {
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        List<List<Integer>> groups = new ArrayList<>();
        for (int i = 0; i < n; i++) groups.add(new ArrayList<>(List.of(i)));
        boolean[] alive = new boolean[n];
        Arrays.fill(alive, true);
        int best = Integer.MAX_VALUE;
        for (int phase = n; phase > 1; phase--) {
            int[] weight = new int[n];
            boolean[] added = new boolean[n];
            int prev = -1, last = -1;
            for (int i = 0; i < phase; i++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v] && (sel == -1 || weight[v] > weight[sel])) sel = v;
                added[sel] = true;
                prev = last; last = sel;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v]) weight[v] += g[sel][v];
            }
            if (weight[last] < best) {
                best = weight[last];
                sideOfBest = groups.get(last).stream().mapToInt(Integer::intValue).toArray();
            }
            alive[last] = false;
            groups.get(prev).addAll(groups.get(last));
            for (int v = 0; v < n; v++) { g[prev][v] += g[last][v]; g[v][prev] += g[v][last]; }
        }
        return best;
    }

    public static void main(String[] args) {
        int[][] e = {{0,1,2},{0,4,3},{1,2,3},{1,4,2},{1,5,2},
                     {2,3,4},{2,6,2},{3,6,2},{3,7,2},{4,5,3},{5,6,1},{6,7,3}};
        int n = 8; int[][] w = new int[n][n];
        for (int[] x : e) { w[x[0]][x[1]] += x[2]; w[x[1]][x[0]] += x[2]; }
        System.out.println("min cut = " + stoerWagner(w) + ", side = " + Arrays.toString(sideOfBest));
    }
}
```

#### Python

```python
def stoer_wagner_with_side(w):
    n = len(w)
    g = [row[:] for row in w]
    groups = [[i] for i in range(n)]
    alive = [True] * n
    best, best_side = float("inf"), []
    for phase in range(n, 1, -1):
        weight = [0] * n
        added = [False] * n
        prev = last = -1
        for _ in range(phase):
            sel = -1
            for v in range(n):
                if alive[v] and not added[v] and (sel == -1 or weight[v] > weight[sel]):
                    sel = v
            added[sel] = True
            prev, last = last, sel
            for v in range(n):
                if alive[v] and not added[v]:
                    weight[v] += g[sel][v]
        if weight[last] < best:
            best, best_side = weight[last], groups[last][:]
        alive[last] = False
        groups[prev].extend(groups[last])
        for v in range(n):
            g[prev][v] += g[last][v]
            g[v][prev] += g[v][last]
    return best, sorted(best_side)


if __name__ == "__main__":
    edges = [(0,1,2),(0,4,3),(1,2,3),(1,4,2),(1,5,2),
             (2,3,4),(2,6,2),(3,6,2),(3,7,2),(4,5,3),(5,6,1),(6,7,3)]
    n = 8
    w = [[0]*n for _ in range(n)]
    for u, v, c in edges:
        w[u][v] += c; w[v][u] += c
    print(stoer_wagner_with_side(w))  # (4, [...])
```

**What it does:** computes the global min-cut *and* recovers one side of the partition by tracking which original vertices merged into the last super-vertex of the best phase.
**Run:** `go run main.go` | `javac ConnectivityEngine.java && java ConnectivityEngine` | `python engine.py`

---

## 7. Observability & Metrics

Treat connectivity as a first-class reliability signal:

- **`min_cut_value` (gauge)** per analyzed graph/component — the fabric's redundancy margin. Alert when below target `k`.
- **`k_connectivity{pair}` (gauge)** per critical service pair from the Gomory–Hu tree — path redundancy for that route.
- **`articulation_points_count` / `bridges_count`** — the `k = 1` hotspots; ideally zero for production-critical subgraphs.
- **`analysis_duration_seconds`** — guards against the `O(V³)` job blowing past its window as the topology grows. Alert when it approaches the scrape interval; that is the signal to decompose or switch to sparse flow.
- **`topology_delta_size`** — how much changed since last run; drives incremental recompute decisions.
- **`min_cut_trend`** — track the global cut value over time. A *slow decline* (e.g., `λ` drifting from 4 to 2 over weeks as links are decommissioned) is a leading indicator of accumulating fragility that no single-snapshot alert would catch. Trending the connectivity number turns reliability into a managed, observable quantity rather than a surprise discovered during an outage.

Render the weak cut on the topology map so the *meaning* is obvious: "these 2 links, if both fail, split us." A number without the cut is hard to act on. Tie alerts to runbooks that name the specific cut edges/vertices to harden.

Good observability for connectivity means an engineer can answer, at a glance: *how fragile are we, where is the weakest point, and is it getting worse?* The three signals above — value, cut location, and trend — answer exactly those three questions.

A minimal emitter that turns the connectivity result into metrics and an actionable alert payload:

```python
import json

def emit_connectivity_report(graph_id, value, side_a, side_b, cut_edges, target_k):
    report = {
        "graph": graph_id,
        "min_cut_value": value,
        "k_target": target_k,
        "healthy": value >= target_k,
        "weak_cut": {
            "edges": cut_edges,                # the links to harden
            "side_a_size": len(side_a),
            "side_b_size": len(side_b),
        },
    }
    # gauge for dashboards
    print(f"connectivity_min_cut{{graph=\"{graph_id}\"}} {value}")
    # alert when below the fault-tolerance target
    if value < target_k:
        print(json.dumps({"alert": "MinCutBelowTarget", "payload": report}))
    return report
```

The structured `weak_cut.edges` field is what a runbook consumes: "add a redundant link straddling this cut." Never alert on the bare value alone — always carry the cut so the responder knows *where* to act.

---

## 8. Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Stale topology snapshot | Cut computed on a graph that no longer matches reality | Hash + timestamp the snapshot; alert on staleness; recompute on change events |
| `O(V³)` job overruns window | Analysis never finishes as graph grows | Decompose by component; switch large/sparse graphs to flow + early-exit `k`-test |
| Directed graph fed to Stoer–Wagner | Wrong (undirected) answer silently | Validate symmetry of the weight matrix; route directed graphs to flow |
| Node-splitting mis-wired | Vertex connectivity stuck at 1 | Assert `s`/`t` internal capacity is ∞; unit-test against `Kₙ` (`κ = n−1`) |
| Correlated failures ignored | `κ = 3` reported but a single power domain kills all 3 | Model shared-fate as merged vertices / fate-sharing groups before analysis |
| Parallel flows sharing residual | Race, wrong cut values | Give each worker its own residual copy |
| Min-cut value masks *which* cut | Engineers can't act | Always emit the cut set, not just the value |
| Integer overflow in dense weights | Wrong (negative) cut value | 64-bit accumulators; assert non-negativity of phase weights |
| Self-loops / parallel edges mishandled | Cut value off by the loop/parallel count | Drop self-loops; sum parallel edges into capacity |

The most dangerous failure is **silent correctness loss**: a directed graph or a mis-wired split returns a *plausible* number that is wrong. Defend with invariant assertions and known-answer tests (`Kₙ`, a single bridge, a cycle).

### Defensive invariants worth asserting

- **Symmetry:** for undirected analysis, assert `w[i][j] == w[j][i]` before Stoer–Wagner. A single asymmetric entry silently corrupts the maximum-adjacency weights.
- **Cut ≤ δ:** the returned global `λ` must never exceed the minimum degree. If it does, the capacity matrix is wrong (likely a one-direction undirected edge).
- **Menger duality as a self-check:** when you compute `λ(s, t)` by flow, also decompose the flow into that many disjoint paths and verify they are genuinely disjoint and connect `s` to `t`. Equal cut size and path count is a *free* end-to-end correctness proof — if they disagree, the implementation is broken.
- **Node-split ∞ guard:** assert the internal `s`/`t` edges carry the sentinel ∞, not 1; a unit-test on `Kₙ` (expect `κ = n − 1`) catches the regression immediately.
- **Idempotence:** running the same snapshot twice must yield identical cuts; non-determinism signals an unstable tie-break or a shared-residual race.

---

## 9. Capacity Planning

Plan both the *compute budget* for the analysis and the *redundancy budget* it informs.

**Analysis compute.** Stoer–Wagner is `O(V³)`: a 1000-vertex dense component is ~10⁹ ops (~1 s in compiled code, seconds-to-minutes in Python). Budget memory at `O(V²)` for the matrix — 1000 vertices ≈ 8 MB of `int64`; 10⁴ vertices ≈ 800 MB, the practical ceiling for the dense variant. Beyond that, decompose or go sparse-flow.

**Redundancy budget (the output's purpose).** Connectivity directly sizes how much redundancy to buy. To survive `f` simultaneous failures you need `κ ≥ f + 1` (vertices) and `λ ≥ f + 1` (edges). The *cheapest* way to raise connectivity is to strengthen the current min-cut: add edges/nodes that straddle the weak cut the engine just found. Connectivity-augmentation theory says the minimum number of edges to raise `λ` from `a` to `b` can be computed (Watanabe–Nakamura, Frank), but in practice you greedily reinforce the reported cut and re-run.

**Frequency.** Run the cheap bridge/articulation DFS on every snapshot (seconds). Run the full global cut on a slower cadence (hourly/daily) or on significant topology deltas.

**Worker fleet sizing.** For the parallel fix-source/vary-sink approach, total work is `(V − 1)` flows. If each flow averages `T_flow` and you have `W` workers, wall-clock is `≈ (V − 1)·T_flow / W` plus serial ingest. To keep a 5000-vertex analysis under a 60-second window with `T_flow ≈ 50 ms`, you need `(5000·50ms)/60s ≈ 5` workers — modest. The fleet scales linearly until ingest dominates (Amdahl), so over-provisioning workers past ~20× the ingest fraction wastes capacity.

### A concrete sizing example

Suppose a tier-1 service must survive `f = 2` simultaneous zone failures, so the target is `κ ≥ 3`. The analysis on the current topology reports `κ = 2`, with the limiting separator being `{auth-east, auth-west}` — two `auth` replicas both reachable only through a shared regional gateway. To raise `κ` to 3 you must add a third internally-vertex-disjoint route between the affected pair. Connectivity-augmentation reasoning says: add one node (`auth-central`) plus the *minimum* set of edges that places it on a route disjoint from the existing two. The engine's reported separator tells you exactly which two routes already exist, so the new route must avoid both their interior vertices. After provisioning, re-run: the separator should grow to size 3, confirming `κ ≥ 3` and that the `f = 2` SLA is now met. The cost (one node + a few links) is the *minimum* because it precisely reinforces the discovered cut rather than blindly over-provisioning the whole mesh.

This is the senior payoff of computing connectivity exactly: redundancy spend is targeted at the measured weak point, not spread thinly across the system.

**Diminishing returns.** Raising connectivity has a cost curve worth modeling. Going from `λ = 1` to `λ = 2` (eliminating bridges) typically yields the largest reliability gain per dollar — a single-link outage is the most common real failure. Each further increment costs more (you must add edges across an ever-larger min-cut) for less marginal availability. Most production systems target `k = 2` or `k = 3` and stop; beyond that, correlated failures (a whole region, a bad deploy) dominate independent link/node failures, so additional graph-theoretic connectivity buys little real resilience. Use the connectivity number to *clear the cheap wins* (no bridges, no articulation points) and then shift the reliability budget to blast-radius reduction and correlated-failure mitigation.

---

## 10. Decision Guide

```
Is the question "k = 1?" (single point of failure)
   └─ yes → bridges / articulation DFS, O(V+E). Run on every snapshot.

Need exact global λ on an undirected weighted graph?
   ├─ dense, V ≤ ~5000 → Stoer-Wagner, recover the cut side.
   └─ large & sparse   → fix-source/vary-sink flow (Dinic), early-exit at k.

Need many pairwise min-cuts (clustering, path redundancy)?
   └─ Gomory-Hu tree: V-1 flows once, then O(V) per query.

Only need "is λ ≥ k?" not the exact value?
   └─ k-connectivity test with early-exit flows; Even's algorithm for κ ≥ k.

Graph is huge and an estimate suffices?
   └─ Karger / Karger-Stein, many parallel trials.

Vertex (not edge) connectivity?
   └─ node-split (v_in→v_out cap 1, ∞ for s/t) then any of the above.
```

The guide is a decision *tree*, not a ranking: the first matching branch wins. Most production reliability work terminates at the top two branches — "is `k = 1`?" and "is `λ/κ ≥ target`?" — and only escalates to exact global/all-pairs computation during deep capacity reviews or incident postmortems. Reserve the heavy machinery for when a cheap test has already flagged that something is worth a closer look.

---

### Anti-patterns to avoid

- **Treating `δ` as the answer.** Dashboards that report min-degree as "redundancy" are wrong whenever a bridge or articulation point exists. Always compute the actual cut.
- **One-size-fits-all `k`.** A global target ignores that different paths have different criticality. Make `k` per-pair.
- **Recomputing from scratch every tick.** Wasteful at scale; gate the expensive global cut behind cheap delta detection and the L1/L2 tests.
- **Alerting on the value without the cut.** Forces the on-call engineer to re-derive *where* the weakness is. Emit the structured cut.
- **Ignoring weights.** Modeling links as unit when they carry wildly different capacities/latency makes the "min cut" meaningless; use weighted Stoer–Wagner.

---

## 11. Summary

At the senior level, edge and vertex connectivity stop being graph trivia and become the **measurement layer of fault tolerance**. The deliverable is a sensor, not a number. You build a pipeline that ingests live topology, computes the global min-cut (Stoer–Wagner) and per-pair redundancy (Gomory–Hu), flags `k = 1` hotspots (bridges/articulation), and emits not just a number but the *actual weak cut* an engineer can harden. Scale dictates the tool: dense → Stoer–Wagner, sparse → flow with early exit, huge → Karger or pure `k`-testing. The recurring senior judgment is to produce *actionable artifacts*, defend against silent correctness loss (directed-vs-undirected, mis-wired splits, correlated failures), and let the discovered min-cut directly drive the redundancy budget.

In short: layer cheap continuous checks (bridges, `k`-tests) under periodic exact analysis (Stoer–Wagner, Gomory–Hu); always emit the *cut*, not just its value; trend the connectivity number to catch slow erosion; and reinforce precisely the weak cut the engine finds rather than over-provisioning the whole system. Connectivity is the rare graph algorithm whose output maps one-to-one onto a budget line item — spend it where the cut is.

Done well, this turns reliability from a reactive discipline (discovering single points of failure during outages) into a proactive, measured one (catching them in a dashboard before they fire).
