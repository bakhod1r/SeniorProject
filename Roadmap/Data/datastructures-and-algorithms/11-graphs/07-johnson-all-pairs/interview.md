# Johnson's Algorithm — Interview Preparation

Johnson's algorithm is a favorite "do you understand the *why*" interview topic: it composes two algorithms candidates already know (Bellman-Ford and Dijkstra) glued by a single clever transform (reweighting). Interviewers use it to probe whether you understand *feasible potentials*, *why reweighting preserves shortest paths*, and *when sparse-graph APSP beats the cubic Floyd-Warshall*. This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | All-pairs shortest path (APSP) |
| Time | `O(V·E·log V)` (binary heap); `O(V·E + V² log V)` (Fibonacci heap) |
| Space | `O(V²)` matrix (or `O(V+E)` on demand) |
| Negative edges | Supported (via reweighting) |
| Negative cycles | Detected by Bellman-Ford; input rejected |
| Best regime | **Sparse** graph with negative edges |
| Beats Floyd-Warshall when | `E < V²/log V` (sparse) |

The five steps:

```text
1. h[v] = 0 for all v             (implicit super-source q)
2. Bellman-Ford from q → h(v)     (reject if negative cycle)
3. w'(u,v) = w(u,v) + h(u) - h(v)  ≥ 0
4. Dijkstra from each s → δ'(s, ·)
5. δ(s,v) = δ'(s,v) - h(s) + h(v)
```

Key formulas:

```text
reweight:    w'(u,v) = w(u,v) + h(u) - h(v)
un-reweight: δ(s,v)  = δ'(s,v) - h(s) + h(v)
feasibility: h(v) ≤ h(u) + w(u,v)   ⇔   w'(u,v) ≥ 0
```

---

## Junior Questions (12 Q&A)

### J1. What problem does Johnson's algorithm solve?
It computes all-pairs shortest paths (APSP) on a **sparse** graph that may have **negative edge weights** (but no negative cycle). After it runs, you know the shortest distance between every ordered pair of vertices.

### J2. Why not just use Floyd-Warshall?
Floyd-Warshall is `O(V³)` regardless of density. On a sparse graph (`E ≈ V`), Johnson's `O(V·E·log V)` ≈ `O(V² log V)` is dramatically faster. Floyd-Warshall wins only on dense graphs (and is simpler there).

### J3. Why not just run Dijkstra from every vertex?
Dijkstra requires **non-negative** weights — its greedy "finalize the nearest vertex" logic breaks on negative edges. Johnson's first *reweights* the graph to make all edges non-negative, *then* runs Dijkstra from every vertex.

### J4. What is the reweighting formula?
`w'(u,v) = w(u,v) + h(u) - h(v)`, where `h(v)` is the *potential* of vertex `v` (its shortest distance from a virtual super-source, computed by Bellman-Ford).

### J5. What is the super-source?
A virtual extra vertex `q` connected to every real vertex with a weight-0 edge. Bellman-Ford from `q` gives each vertex its potential `h(v)`. In code you skip building it: just initialize `h[v] = 0` for all `v` and relax the real edges.

### J6. Why is each reweighted edge non-negative?
Bellman-Ford guarantees the triangle inequality `h(v) ≤ h(u) + w(u,v)`. Rearranged, `w(u,v) + h(u) - h(v) ≥ 0`, i.e. `w'(u,v) ≥ 0`.

### J7. Why does reweighting preserve shortest paths?
Along any path, the interior `h` terms telescope and cancel, leaving a length change of `h(start) - h(end)` — the **same constant for every path** between a fixed pair. Adding the same constant to all candidate paths cannot change which is shortest.

### J8. How do you recover the true distance after running Dijkstra?
Un-reweight: `δ(s,v) = δ'(s,v) - h(s) + h(v)`, where `δ'` is the reweighted distance Dijkstra returned.

### J9. How does Johnson's detect a negative cycle?
The Bellman-Ford potential pass detects it: if any edge can still be relaxed after `V` full passes, a negative cycle exists and the algorithm rejects the input (APSP is undefined).

### J10. What is the time complexity and which step dominates?
`O(V·E·log V)` with a binary heap. The `V` Dijkstra runs (`V × O(E log V)`) dominate; the single Bellman-Ford (`O(V·E)`) and reweighting (`O(E)`) are smaller.

### J11. What are the two building-block algorithms?
**Bellman-Ford** (one pass, computes potentials, tolerates negatives, detects negative cycles) and **Dijkstra** (run `V` times on the reweighted non-negative graph).

### J12 (analysis). When would Johnson's be the *wrong* choice?
If the graph is dense (use Floyd-Warshall), if all weights are non-negative (just run `V`× Dijkstra without reweighting), or if you only need one source (use a single Dijkstra or Bellman-Ford).

---

## Middle Questions (12 Q&A)

### M1. Define a feasible potential and its relationship to reweighting.
A potential `h` is *feasible* if `h(v) ≤ h(u) + w(u,v)` for every edge. This is equivalent to `w'(u,v) = w(u,v) + h(u) - h(v) ≥ 0`. So "feasible potential" and "all reduced weights non-negative" are the same condition.

### M2. Prove that reweighting preserves shortest paths.
For a path `p = v₀→…→vₖ`, `w'(p) = Σ[w(vᵢ,vᵢ₊₁) + h(vᵢ) - h(vᵢ₊₁)] = w(p) + h(v₀) - h(vₖ)`. The interior `h` terms cancel, so every `v₀→vₖ` path shifts by the same constant `h(v₀)-h(vₖ)`. Identical shift ⇒ identical argmin ⇒ shortest path preserved.

### M3. Why must the potentials come from a *super-source*, not a real vertex?
A real source might not reach every vertex, leaving some `h(v) = ∞`, which makes `w'(u,v)` ill-defined (∞−∞). The super-source has a 0-weight edge to *every* vertex, so it reaches all of them and every `h(v)` is finite.

### M4. Why does the super-source not change the answers?
It has only *outgoing* edges (no incoming), so it lies on no cycle and no original `s→t` path can route through it. It is a pure measurement device for potentials.

### M5. When does Johnson's beat Floyd-Warshall, exactly?
When `E·log V < V²`, i.e. roughly `E < V²/log V`. For `V=1000` (`log V ≈ 10`), Johnson's wins for `E < 100,000` — almost everything but near-complete graphs. The caveat is constants: Floyd-Warshall's cache-friendly loop can win wall-clock on moderately dense small graphs.

### M6. Why does Johnson's beat `V`× Bellman-Ford?
`V`× Bellman-Ford is `O(V²·E)`. Johnson's runs Bellman-Ford **once** (to share a potential) and replaces the other `V−1` runs with Dijkstras, turning `O(V²E)` into `O(VE log V)`. It amortizes one expensive negative-weight pass across all sources.

### M7. How is A* search related to Johnson's?
A* with a *consistent* heuristic `h` is exactly Dijkstra on the reweighted graph `w'(u,v) = w(u,v) + h(u) - h(v)`. A consistent heuristic *is* a feasible potential. So A* = Johnson's reweighting with a domain heuristic instead of a Bellman-Ford-computed potential.

### M8. What is the most common implementation bug?
Forgetting to **un-reweight** — returning `δ'` instead of `δ = δ' - h(s) + h(v)`. The distances come out systematically shifted and wrong.

### M9. Can you skip computing potentials in some cases?
Yes: if all weights are already non-negative, skip Bellman-Ford and reweighting entirely — just run `V`× Dijkstra. Johnson's overhead only pays off when negative edges are present.

### M10. How do you parallelize Johnson's?
The `V` Dijkstra runs are independent (read-only reweighted graph, disjoint output rows), so they fan out across threads/cores/nodes with no synchronization. Bellman-Ford (the potential phase) is sequential.

### M11. What invariant should you assert after reweighting?
Every `w'(u,v) ≥ 0`. A negative reduced weight means the potential is wrong (too few Bellman-Ford passes, sign error, or stale `h`). It is the single best debugging guard.

### M12 (analysis). Why is the reweighting not "free magic" for negative edges?
The difficulty is concentrated in the **one** Bellman-Ford pass that computes a feasible potential — exactly where the full cost of negative-weight SSSP is paid. Reweighting then *amortizes* that single pass across all `V` sources. The win is amortization, not elimination of negative-weight handling.

---

## Senior Questions (10 Q&A)

### S1. Compare Johnson's, Floyd-Warshall, and `V`×Dijkstra at scale.
Johnson's: `O(V·E·log V)`, handles negatives, best on **sparse + negatives**. Floyd-Warshall: `O(V³)`, handles negatives, best on **dense**. `V`×Dijkstra: `O(V·E·log V)`, **non-negative only**, best on **sparse non-negative**. Decision is density + presence of negatives.

### S2. How do you serve a Johnson's-backed APSP service in production?
Separate the **potential phase** (Bellman-Ford, sequential, the negative-cycle gate) from the **Dijkstra fan-out** (parallel). Cache the potentials `h` and reweighted graph as a versioned immutable artifact; serve either the full `V²` matrix (`O(1)` queries) or Dijkstra **on demand** per source (`O(E log V)`), reusing the cached `h`.

### S3. The graph changed. Can you patch the matrix like Floyd-Warshall's `O(V²)` edge-decrease trick?
No. A weight **decrease** can violate `h(v) ≤ h(u) + w(u,v)`, turning some `w'` negative and invalidating Dijkstra. You must **recompute the potentials** (at least the Bellman-Ford phase). This is a key operational difference from Floyd-Warshall.

### S4. What single metric best catches a Johnson's bug in production?
`min reweighted edge ≥ 0`. If it ever goes negative, the potentials are stale or wrong (and every distance is corrupted). No generic shortest-path metric catches this.

### S5. How do you avoid the `O(V²)` memory wall on a large sparse graph?
Serve **on demand**: compute potentials once (`O(V+E)` resident), then run Dijkstra only for queried sources. You never materialize the `V²` matrix — a major advantage over Floyd-Warshall for large sparse graphs.

### S6. Why does Johnson's distribute better than Floyd-Warshall?
After the (sequential) potential phase, the `V` Dijkstras are fully independent on a read-only graph — shard sources across nodes with **near-zero communication**. Distributed Floyd-Warshall must broadcast a pivot row/column every round (`O(V³)` bytes total).

### S7. Where is Johnson's reweighting used *inside* a larger algorithm?
Min-cost max-flow (successive shortest paths): the residual graph has negative back-edge costs, so an initial Bellman-Ford makes the potential feasible, then each augmentation uses **Dijkstra** with potentials updated incrementally (`h(v) += δ'(s,v)`), keeping reduced costs non-negative.

### S8. How do you guard against a torn artifact during a refresh?
Version the potential vector `h` and the reweighted graph **together**; build the new pair off to the side, validate (`w' ≥ 0`, no negative cycle), then swap atomically (read-copy-update). Never mutate `h` or the edges in place, or un-reweighting will use an inconsistent `h`.

### S9. The Bellman-Ford potential phase dominates wall-clock. What do you do?
Use a queue-based (SPFA) Bellman-Ford that re-relaxes only changed vertices, parallelize Bellman-Ford passes with a barrier, or substitute a modern near-linear negative-weight SSSP algorithm. The fan-out is already parallel, so optimizing the sequential setup matters when it is the critical path.

### S10 (analysis). What is the theoretically optimal Johnson's complexity, and why?
With a Fibonacci heap each Dijkstra is `O(E + V log V)`, giving total `O(V·E + V² log V)`. On sparse graphs that is `O(V² log V)` — within a `log V` factor of the `Ω(V²)` output-size lower bound (you must emit `V²` distances), so it is essentially optimal for sparse APSP.

---

## Professional Questions (8 Q&A)

### P1. State and prove that a feasible potential exists iff there is no negative cycle.
(⇐) No negative cycle ⇒ super-source distances `h(v)=δ(q,v)` are finite and satisfy the triangle inequality, hence feasible. (⇒) If feasible `h` exists, summing `w'(u,v)≥0` around any cycle telescopes the `h` terms to 0, leaving `w(C) ≥ 0` — no negative cycle. (Lemma 2.2 in `professional.md`.)

### P2. Prove that reweighting preserves shortest paths formally.
For path `p=v₀→…→vₖ`: `w'(p) = w(p) + h(v₀) - h(vₖ)` by telescoping. The shift `h(v₀)-h(vₖ)` is path-independent for fixed endpoints, so `argmin_p w'(p) = argmin_p w(p)`, and `δ'(s,t) = δ(s,t) + h(s) - h(t)` (Theorem 3.1 / Corollary 3.2).

### P3. Why is the super-source distance function a *feasible* potential?
For any edge `(u,v)`, `h(v) = δ(q,v) ≤ δ(q,u) + w(u,v) = h(u) + w(u,v)` — the triangle inequality for shortest distances from a fixed source. That is exactly the feasibility condition (Lemma 4.2).

### P4. Derive Johnson's complexity with both binary and Fibonacci heaps.
Bellman-Ford `O(VE)`, reweight `O(E)`, `V` Dijkstras, un-reweight `O(V²)`. Binary heap: each Dijkstra `O(E log V)` ⇒ total `O(V·E·log V)`. Fibonacci heap: each `O(E + V log V)` ⇒ total `O(V·E + V² log V)`. The fan-out dominates both.

### P5. How does the incremental-potential update in min-cost flow stay feasible?
After computing reduced-cost Dijkstra distances `δ'(s,v)`, update `h(v) ← h(v) + δ'(s,v)`. Shortest-path tree edges have reduced cost 0, so their residual reversals also have reduced cost 0 under the new `h`; non-tree edges stay `≥ 0` by the triangle inequality on the new distances. Hence the next residual graph's reduced costs remain non-negative (Lemma 7.1).

### P6. What is the lower bound for APSP, and how close is Johnson's?
Any APSP algorithm must output `Θ(V²)` distances, so `Ω(V²)` is unconditional. On sparse graphs Johnson's (Fibonacci) is `O(V² log V)` — within a `log V` factor of optimal. On dense graphs, the APSP conjecture (`n^{3-o(1)}`) applies and Johnson's offers no advantage over Floyd-Warshall.

### P7. Can a modern algorithm replace the Bellman-Ford phase?
Yes. Recent near-linear `Õ(E)` negative-weight SSSP algorithms (Bernstein–Nanongkai–Wulff-Nilsen) can compute the feasible potential, replacing the `O(VE)` Bellman-Ford. The fan-out (`V` Dijkstras) then becomes the sole bottleneck, giving `Õ(V·E + V² log V)`.

### P8 (analysis). Why can't you reweight a graph that has a negative cycle to make Dijkstra work?
A negative cycle means no feasible potential exists (P1). Any reweighting either leaves some edge with `w' < 0` (Dijkstra invalid) or would require an `h` violating feasibility around the cycle. The cycle's negativity is invariant under reweighting (`w'(C) = w(C)` since cycle `h` terms cancel), so it cannot be "reweighted away."

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about choosing an algorithm for a shortest-path workload with negative weights.
Look for: identifying the graph as sparse with negative edges, ruling out Dijkstra (negatives) and Floyd-Warshall (density/cube), landing on Johnson's, and noting the negative-cycle gate. Strong answers cite `V`, `E`, query pattern, and the `O(VE log V)` vs `O(V³)` tradeoff.

### B2. Design a service answering shortest routes on a logistics graph with "credit" (negative) edges.
Johnson's fits: compute potentials once, serve on-demand Dijkstra per queried source (avoid the `V²` matrix on a large sparse graph). Discuss versioned `(h, reweighted graph)` artifact, recompute on edge change, negative-cycle detection as a publish gate, and the `min reweighted edge ≥ 0` invariant.

### B3. Your distances are systematically off by a constant per source. Diagnose.
Almost certainly a missing or wrong **un-reweighting** step (`δ = δ' - h(s) + h(v)`). The shift is exactly `h(s) - h(v)`, the telescoping constant. Check that you apply it to finite distances only and that `h` matches the reweighted graph version.

### B4. A junior asks "why not always use Floyd-Warshall — it's simpler?"
Explain the regime: Floyd-Warshall is `O(V³)` and `O(V²)` memory, fine for dense small graphs but wasteful on large sparse ones where Johnson's `O(VE log V)` and `O(V+E)` on-demand footprint dominate. Use it to teach matching algorithm to density.

### B5. Edge weights change frequently. How does that affect a Johnson's service?
A change (especially a decrease) can invalidate the potentials, forcing a Bellman-Ford recompute — you cannot patch one matrix cell. Debounce change storms into one recompute, monitor `min reweighted edge`, and consider fully on-demand (potentials + Dijkstra per query) if mutation outpaces rebuilds.

---

## Coding Challenges

### Challenge 1: All-Pairs Shortest Paths With Negative Edges (Core Johnson's)

**Problem.** Given a sparse directed graph with `n` vertices and weighted edges (weights may be negative), return the all-pairs shortest-distance matrix. If a negative cycle exists, report it. Use `Infinity`/`INF` for unreachable pairs.

**Example.**
```text
n = 4, edges = [(0,1,-2),(1,2,-1),(2,3,2),(0,3,10),(3,1,4)]
dist[0] = [0, -2, -3, -1]   (0→1→2→3 beats direct 0→3=10)
```

**Approach.** Bellman-Ford for potentials (reject on negative cycle), reweight, Dijkstra from each source, un-reweight.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
)

const INF = math.MaxInt64 / 4

type edge struct{ to, w int }
type hi struct{ node, d int }
type mh []hi

func (h mh) Len() int            { return len(h) }
func (h mh) Less(a, b int) bool  { return h[a].d < h[b].d }
func (h mh) Swap(a, b int)       { h[a], h[b] = h[b], h[a] }
func (h *mh) Push(x interface{}) { *h = append(*h, x.(hi)) }
func (h *mh) Pop() interface{}   { o := *h; n := len(o); x := o[n-1]; *h = o[:n-1]; return x }

func johnson(n int, edges [][3]int) ([][]int, bool) {
	adj := make([][]edge, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], edge{e[1], e[2]})
	}
	h := make([]int, n)
	for it := 0; it <= n; it++ {
		changed := false
		for u := 0; u < n; u++ {
			for _, e := range adj[u] {
				if h[u]+e.w < h[e.to] {
					h[e.to] = h[u] + e.w
					changed = true
					if it == n {
						return nil, false // negative cycle
					}
				}
			}
		}
		if !changed {
			break
		}
	}
	radj := make([][]edge, n)
	for u := 0; u < n; u++ {
		for _, e := range adj[u] {
			radj[u] = append(radj[u], edge{e.to, e.w + h[u] - h[e.to]})
		}
	}
	dist := make([][]int, n)
	for s := 0; s < n; s++ {
		dp := dijkstra(n, radj, s)
		dist[s] = make([]int, n)
		for v := 0; v < n; v++ {
			if dp[v] >= INF {
				dist[s][v] = INF
			} else {
				dist[s][v] = dp[v] - h[s] + h[v]
			}
		}
	}
	return dist, true
}

func dijkstra(n int, radj [][]edge, src int) []int {
	d := make([]int, n)
	for i := range d {
		d[i] = INF
	}
	d[src] = 0
	pq := &mh{{src, 0}}
	for pq.Len() > 0 {
		x := heap.Pop(pq).(hi)
		if x.d > d[x.node] {
			continue
		}
		for _, e := range radj[x.node] {
			if d[x.node]+e.w < d[e.to] {
				d[e.to] = d[x.node] + e.w
				heap.Push(pq, hi{e.to, d[e.to]})
			}
		}
	}
	return d
}

func main() {
	d, ok := johnson(4, [][3]int{{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {0, 3, 10}, {3, 1, 4}})
	fmt.Println(ok, d[0]) // true [0 -2 -3 -1]
}
```

**Java.**

```java
import java.util.*;

public class JohnsonAPSP {
    static final int INF = Integer.MAX_VALUE / 4;

    static int[][] johnson(int n, int[][] edges) {
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] e : edges) adj[e[0]].add(new int[]{e[1], e[2]});
        int[] h = new int[n];
        for (int it = 0; it <= n; it++) {
            boolean changed = false;
            for (int u = 0; u < n; u++)
                for (int[] e : adj[u])
                    if (h[u] + e[1] < h[e[0]]) {
                        h[e[0]] = h[u] + e[1];
                        changed = true;
                        if (it == n) return null; // negative cycle
                    }
            if (!changed) break;
        }
        List<int[]>[] radj = new List[n];
        for (int u = 0; u < n; u++) {
            radj[u] = new ArrayList<>();
            for (int[] e : adj[u]) radj[u].add(new int[]{e[0], e[1] + h[u] - h[e[0]]});
        }
        int[][] dist = new int[n][n];
        for (int s = 0; s < n; s++) {
            int[] dp = dijkstra(n, radj, s);
            for (int v = 0; v < n; v++)
                dist[s][v] = (dp[v] >= INF) ? INF : dp[v] - h[s] + h[v];
        }
        return dist;
    }

    static int[] dijkstra(int n, List<int[]>[] radj, int src) {
        int[] d = new int[n];
        Arrays.fill(d, INF);
        d[src] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[1] - b[1]);
        pq.add(new int[]{src, 0});
        while (!pq.isEmpty()) {
            int[] c = pq.poll();
            if (c[1] > d[c[0]]) continue;
            for (int[] e : radj[c[0]])
                if (d[c[0]] + e[1] < d[e[0]]) {
                    d[e[0]] = d[c[0]] + e[1];
                    pq.add(new int[]{e[0], d[e[0]]});
                }
        }
        return d;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {0, 3, 10}, {3, 1, 4}};
        System.out.println(Arrays.toString(johnson(4, edges)[0])); // [0, -2, -3, -1]
    }
}
```

**Python.**

```python
import heapq


def johnson(n, edges):
    INF = float("inf")
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    h = [0] * n
    for it in range(n + 1):
        changed = False
        for u in range(n):
            for v, w in adj[u]:
                if h[u] + w < h[v]:
                    h[v] = h[u] + w
                    changed = True
                    if it == n:
                        return None  # negative cycle
        if not changed:
            break
    radj = [[(v, w + h[u] - h[v]) for v, w in adj[u]] for u in range(n)]
    out = []
    for s in range(n):
        d = _dijkstra(n, radj, s)
        out.append([d[v] - h[s] + h[v] if d[v] < INF else INF for v in range(n)])
    return out


def _dijkstra(n, radj, src):
    INF = float("inf")
    d = [INF] * n
    d[src] = 0
    pq = [(0, src)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > d[u]:
            continue
        for v, w in radj[u]:
            if du + w < d[v]:
                d[v] = du + w
                heapq.heappush(pq, (d[v], v))
    return d


if __name__ == "__main__":
    edges = [(0, 1, -2), (1, 2, -1), (2, 3, 2), (0, 3, 10), (3, 1, 4)]
    print(johnson(4, edges)[0])  # [0, -2, -3, -1]
```

**Follow-up.** What if the graph were dense? Switch to Floyd-Warshall (`O(V³)`, simpler). What if all weights were non-negative? Drop reweighting and run `V`×Dijkstra directly.

---

### Challenge 2: Compute the Feasible Potential Only (Reweighting Setup)

**Problem.** Given a directed graph with possibly-negative weights, return a feasible potential `h` (so that `w(u,v) + h(u) - h(v) ≥ 0` for every edge), or report a negative cycle. This is the reusable core of Johnson's and min-cost flow.

**Approach.** Bellman-Ford from the implicit super-source (`h[v]=0`), with a detection pass.

**Go.**

```go
package main

import "fmt"

func feasiblePotential(n int, edges [][3]int) ([]int, bool) {
	h := make([]int, n) // implicit super-source: h[v] = 0
	for it := 0; it <= n; it++ {
		changed := false
		for _, e := range edges {
			if h[e[0]]+e[2] < h[e[1]] {
				h[e[1]] = h[e[0]] + e[2]
				changed = true
				if it == n {
					return nil, false // negative cycle
				}
			}
		}
		if !changed {
			break
		}
	}
	return h, true
}

func main() {
	h, ok := feasiblePotential(4, [][3]int{{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {3, 1, 4}})
	fmt.Println(ok, h) // true [0 -2 -3 -1]
}
```

**Java.**

```java
import java.util.*;

public class FeasiblePotential {
    static int[] potential(int n, int[][] edges) {
        int[] h = new int[n]; // implicit super-source
        for (int it = 0; it <= n; it++) {
            boolean changed = false;
            for (int[] e : edges)
                if (h[e[0]] + e[2] < h[e[1]]) {
                    h[e[1]] = h[e[0]] + e[2];
                    changed = true;
                    if (it == n) return null; // negative cycle
                }
            if (!changed) break;
        }
        return h;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {3, 1, 4}};
        System.out.println(Arrays.toString(potential(4, edges))); // [0, -2, -3, -1]
    }
}
```

**Python.**

```python
def feasible_potential(n, edges):
    h = [0] * n  # implicit super-source
    for it in range(n + 1):
        changed = False
        for u, v, w in edges:
            if h[u] + w < h[v]:
                h[v] = h[u] + w
                changed = True
                if it == n:
                    return None  # negative cycle
        if not changed:
            break
    return h


if __name__ == "__main__":
    edges = [(0, 1, -2), (1, 2, -1), (2, 3, 2), (3, 1, 4)]
    print(feasible_potential(4, edges))  # [0, -2, -3, -1]
```

**Follow-up.** Verify feasibility by asserting `w + h[u] - h[v] >= 0` for every edge. This subroutine, reused with incremental updates, is the engine of min-cost-flow's Dijkstra-based augmentation.

---

### Challenge 3: Shortest Path From One Source on a Graph With Negatives, Fast Repeated Queries

**Problem.** You will be asked for shortest distances from many different sources on a fixed sparse graph with negative edges. Precompute once so each query is a single Dijkstra. Return distances from a queried source.

**Approach.** Compute potentials once; cache the reweighted graph; per query run Dijkstra and un-reweight — `O(E log V)` per query after `O(V·E)` setup.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
)

const INF = math.MaxInt64 / 4

type edge struct{ to, w int }
type hi struct{ node, d int }
type mh []hi

func (h mh) Len() int            { return len(h) }
func (h mh) Less(a, b int) bool  { return h[a].d < h[b].d }
func (h mh) Swap(a, b int)       { h[a], h[b] = h[b], h[a] }
func (h *mh) Push(x interface{}) { *h = append(*h, x.(hi)) }
func (h *mh) Pop() interface{}   { o := *h; n := len(o); x := o[n-1]; *h = o[:n-1]; return x }

type Service struct {
	n    int
	h    []int
	radj [][]edge
}

func NewService(n int, edges [][3]int) (*Service, bool) {
	adj := make([][]edge, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], edge{e[1], e[2]})
	}
	h := make([]int, n)
	for it := 0; it <= n; it++ {
		changed := false
		for u := 0; u < n; u++ {
			for _, e := range adj[u] {
				if h[u]+e.w < h[e.to] {
					h[e.to] = h[u] + e.w
					changed = true
					if it == n {
						return nil, false
					}
				}
			}
		}
		if !changed {
			break
		}
	}
	radj := make([][]edge, n)
	for u := 0; u < n; u++ {
		for _, e := range adj[u] {
			radj[u] = append(radj[u], edge{e.to, e.w + h[u] - h[e.to]})
		}
	}
	return &Service{n, h, radj}, true
}

func (s *Service) From(src int) []int {
	d := make([]int, s.n)
	for i := range d {
		d[i] = INF
	}
	d[src] = 0
	pq := &mh{{src, 0}}
	for pq.Len() > 0 {
		x := heap.Pop(pq).(hi)
		if x.d > d[x.node] {
			continue
		}
		for _, e := range s.radj[x.node] {
			if d[x.node]+e.w < d[e.to] {
				d[e.to] = d[x.node] + e.w
				heap.Push(pq, hi{e.to, d[e.to]})
			}
		}
	}
	out := make([]int, s.n)
	for v := 0; v < s.n; v++ {
		if d[v] >= INF {
			out[v] = INF
		} else {
			out[v] = d[v] - s.h[src] + s.h[v]
		}
	}
	return out
}

func main() {
	svc, _ := NewService(4, [][3]int{{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {0, 3, 10}, {3, 1, 4}})
	fmt.Println(svc.From(0)) // [0 -2 -3 -1]
	fmt.Println(svc.From(3)) // [.. 4 3 0] style row from vertex 3
}
```

**Java.**

```java
import java.util.*;

public class JohnsonService {
    static final int INF = Integer.MAX_VALUE / 4;
    final int n;
    final int[] h;
    final List<int[]>[] radj;

    JohnsonService(int n, int[][] edges) {
        this.n = n;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] e : edges) adj[e[0]].add(new int[]{e[1], e[2]});
        int[] hh = new int[n];
        for (int it = 0; it <= n; it++) {
            boolean changed = false;
            for (int u = 0; u < n; u++)
                for (int[] e : adj[u])
                    if (hh[u] + e[1] < hh[e[0]]) {
                        hh[e[0]] = hh[u] + e[1];
                        changed = true;
                        if (it == n) throw new IllegalStateException("negative cycle");
                    }
            if (!changed) break;
        }
        this.h = hh;
        this.radj = new List[n];
        for (int u = 0; u < n; u++) {
            radj[u] = new ArrayList<>();
            for (int[] e : adj[u]) radj[u].add(new int[]{e[0], e[1] + hh[u] - hh[e[0]]});
        }
    }

    int[] from(int src) {
        int[] d = new int[n];
        Arrays.fill(d, INF);
        d[src] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[1] - b[1]);
        pq.add(new int[]{src, 0});
        while (!pq.isEmpty()) {
            int[] c = pq.poll();
            if (c[1] > d[c[0]]) continue;
            for (int[] e : radj[c[0]])
                if (d[c[0]] + e[1] < d[e[0]]) {
                    d[e[0]] = d[c[0]] + e[1];
                    pq.add(new int[]{e[0], d[e[0]]});
                }
        }
        int[] out = new int[n];
        for (int v = 0; v < n; v++) out[v] = (d[v] >= INF) ? INF : d[v] - h[src] + h[v];
        return out;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, -2}, {1, 2, -1}, {2, 3, 2}, {0, 3, 10}, {3, 1, 4}};
        JohnsonService svc = new JohnsonService(4, edges);
        System.out.println(Arrays.toString(svc.from(0))); // [0, -2, -3, -1]
    }
}
```

**Python.**

```python
import heapq


class JohnsonService:
    def __init__(self, n, edges):
        self.n = n
        adj = [[] for _ in range(n)]
        for u, v, w in edges:
            adj[u].append((v, w))
        h = [0] * n
        for it in range(n + 1):
            changed = False
            for u in range(n):
                for v, w in adj[u]:
                    if h[u] + w < h[v]:
                        h[v] = h[u] + w
                        changed = True
                        if it == n:
                            raise ValueError("negative cycle")
            if not changed:
                break
        self.h = h
        self.radj = [[(v, w + h[u] - h[v]) for v, w in adj[u]] for u in range(n)]

    def from_(self, src):
        INF = float("inf")
        d = [INF] * self.n
        d[src] = 0
        pq = [(0, src)]
        while pq:
            du, u = heapq.heappop(pq)
            if du > d[u]:
                continue
            for v, w in self.radj[u]:
                if du + w < d[v]:
                    d[v] = du + w
                    heapq.heappush(pq, (d[v], v))
        return [d[v] - self.h[src] + self.h[v] if d[v] < INF else INF
                for v in range(self.n)]


if __name__ == "__main__":
    svc = JohnsonService(4, [(0, 1, -2), (1, 2, -1), (2, 3, 2), (0, 3, 10), (3, 1, 4)])
    print(svc.from_(0))  # [0, -2, -3, -1]
```

**Follow-up.** This is the production-favored "potentials-as-cache" shape: one `O(V·E)` setup, then `O(E log V)` per source. Emphasize that the cached `h` is reused across every query — the entire reason Johnson's amortizes well.

---

## Common Pitfalls in Interviews

- **Forgetting to un-reweight.** Returning `δ'` instead of `δ = δ' - h(s) + h(v)`. The single most common Johnson's bug.
- **Using a real source for potentials.** Unreachable vertices get `h=∞`; use the implicit super-source (`h[v]=0`).
- **Skipping negative-cycle detection.** Then Dijkstra runs on a graph with negative reduced weights and silently lies.
- **Too few Bellman-Ford passes.** Potentials don't converge; some `w'` stay negative.
- **Building the super-source with incoming edges.** `q` must have only *outgoing* 0-weight edges.
- **Un-reweighting `INF`.** Overflow/garbage; only adjust finite distances.
- **Using Johnson's on a dense graph.** Floyd-Warshall is simpler and faster there.
- **Not recognizing the pattern.** Missing that A* and min-cost-flow reweighting are the same feasible-potential idea.

---

## What Interviewers Are Really Testing

A Johnson's question rarely checks whether you can recite five steps. It probes three deeper things. First, **composition and reduction maturity**: do you see Johnson's as Bellman-Ford + reweighting + `V`×Dijkstra, and can you justify *why* the reweighting `w' = w + h(u) - h(v)` keeps edges non-negative (triangle inequality) and preserves shortest paths (telescoping cancellation)? That reasoning, not the code, separates understanding from memorization. Second, **algorithm selection by density**: do you reach for Johnson's exactly when the graph is sparse with negative edges, and correctly route to Floyd-Warshall (dense), plain `V`×Dijkstra (non-negative), or a single SSSP (one source) otherwise? Picking the wrong tool is an instant red flag. Third, **the connections**: that a *feasible potential* is the unifying object behind Johnson's, A* (consistent heuristic), and min-cost flow (incremental potentials). The strongest candidates also reach for production realities — potentials-as-cache, the `min reweighted edge ≥ 0` invariant, the `O(V²)` memory wall avoided by on-demand serving, and the negative-cycle gate — demonstrating they can take a textbook algorithm all the way to a running service.
