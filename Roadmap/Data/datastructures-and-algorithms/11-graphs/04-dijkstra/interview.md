# Dijkstra's Algorithm — Interview Preparation

Dijkstra's algorithm is the single most-asked weighted-graph algorithm in coding interviews. It is short enough to write on a whiteboard, it powers a whole family of problems (network delay, cheapest flights, path with maximum probability, swim in rising water, minimum effort path), and it has a handful of gotchas — the settled check, the non-negativity requirement, settle-on-pop-not-push, and integer overflow — that separate a candidate who memorized `heappush`/`heappop` from one who actually understands *why* the greedy choice is correct. This file is a curated question bank sorted by seniority, behavioral and system-design prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value | Notes |
|------|-------|-------|
| Problem solved | Single-source shortest path (SSSP) | One source to every vertex. |
| Hard requirement | **All edge weights ≥ 0** | Negative edge → use Bellman-Ford. |
| Core operation | **Relaxation** | `if dist[u]+w < dist[v]: dist[v]=dist[u]+w; prev[v]=u`. |
| Data structure | Min priority queue (binary heap) | `pop-min` selects the closest unsettled vertex. |
| Binary heap time | **O((V + E) log V)** | Sparse graphs (default). |
| Array-scan time | **O(V²)** | Dense graphs (`E ≈ V²`). |
| Fibonacci heap time | O(E + V log V) | Theoretical optimum, rarely worth it. |
| Space | O(V + E) | `dist`, `prev`, heap, adjacency. |
| Lazy deletion | Push duplicates, skip stale on pop | `if d > dist[u]: continue`. |
| Eager / decrease-key | One entry per vertex, indexed heap | Smaller heap, more code. |
| Settle moment | On **pop**, never on push | Settling on push ignores a later cheaper relaxation. |
| Path reconstruction | Walk `prev[]` from target to source, reverse | O(path length). |

Skeleton (lazy, the version to write by default):

```text
dist[*] = ∞;  dist[src] = 0;  prev[*] = -1
pq = [(0, src)]
while pq:
    (d, u) = pop-min(pq)
    if d > dist[u]: continue        # stale entry — already settled
    for (v, w) in adj[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            prev[v] = u
            push (dist[v], v)
```

Mental anchor: **Dijkstra is weighted BFS** — replace BFS's FIFO queue with a min-heap keyed on accumulated weight.

---

## Junior Questions (12 Q&A)

### J1. What problem does Dijkstra's algorithm solve?
It solves the single-source shortest-path problem on a graph with non-negative edge weights: given a source vertex `s`, it computes the shortest-path distance from `s` to every other vertex. With a predecessor array it also reconstructs the actual paths. The "cost" can be distance, time, money, or latency — anything that adds up along a path and is never negative.

### J2. What is relaxation?
Relaxation is the one update the whole algorithm is built on. For an edge `u → v` with weight `w`: `if dist[u] + w < dist[v]: dist[v] = dist[u] + w; prev[v] = u`. In plain terms: we found a route to `v` through `u` that is cheaper than anything we knew, so we lower `v`'s estimate and remember that we arrived via `u`. Initially every distance is `∞` except the source at `0`, and the algorithm relaxes edges until no improvement is possible.

### J3. Why must edge weights be non-negative?
The greedy choice — "the unsettled vertex with the smallest tentative distance already has its final distance" — is correct only because no path through a farther, still-unsettled vertex can come back cheaper. A negative edge would let a far-away detour suddenly undercut a distance you already locked in, breaking the "once settled, always settled" guarantee. With negative edges you must use Bellman-Ford instead.

### J4. What is the time complexity of Dijkstra?
With a binary-heap priority queue it is `O((V + E) log V)`, which is the default and best for sparse graphs. With a plain array scan to find the minimum each round it is `O(V²)`, which wins on dense graphs where `E ≈ V²`. A Fibonacci heap gives the theoretical `O(E + V log V)` but its constants rarely pay off.

### J5. Why does Dijkstra use a priority queue?
The core step is "pick the unsettled vertex with the smallest tentative distance." That is exactly a `pop-min` operation, which a min-heap does in `O(log n)`. Without a heap you would scan all vertices every round, giving `O(V²)`. The heap is what turns the `V²` scan into the `(V + E) log V` bound on sparse graphs.

### J6. What is a settled (finalized) vertex?
A settled vertex is one whose shortest distance is proven final and will never change. Dijkstra grows a settled set one vertex per iteration: each time it pops a non-stale vertex from the heap, that vertex is settled, and its outgoing edges are relaxed. The settled set is what the greedy invariant talks about.

### J7. What is the predecessor / `prev` array for?
`prev[v]` stores the vertex you came from on the best-known path to `v`, updated during every successful relaxation. After the algorithm finishes, you reconstruct the actual shortest path to a target by walking `prev[]` backward from the target to the source and reversing. Without it you only know distances, not the roads.

### J8. How do you reconstruct the path to a target?
Start at the target, repeatedly follow `prev[]` until you reach the source (marked by `prev = -1`), collecting vertices, then reverse the list. Cost is `O(path length) ≤ O(V)`. If `dist[target]` is still `∞`, the target is unreachable.

### J9. What is a stale entry in the heap?
In the lazy version you never update an existing heap entry; when you find a cheaper distance to `v` you just push a new `(dist[v], v)` pair, leaving the old larger pair in the heap. That old pair is "stale." When it eventually pops, the guard `if d > dist[u]: continue` discards it because `dist[u]` is already smaller. Stale entries are harmless precisely because the minimum always pops first.

### J10. Why settle a vertex on pop and not on push?
If you mark a vertex settled when you first push it, a later, cheaper relaxation of the same vertex gets ignored — you locked in a wrong distance. The smallest tentative distance for a vertex is only guaranteed when it actually reaches the front of the priority queue, i.e. on pop. So you settle on pop.

### J11. How is Dijkstra related to BFS?
Dijkstra is "weighted BFS." Plain BFS explores in waves of equal step-count because every edge costs 1, using a FIFO queue. Replace that FIFO queue with a min-priority-queue keyed on accumulated edge weight and BFS becomes Dijkstra. On an unweighted graph, Dijkstra produces the same answer as BFS but with unnecessary `log V` overhead — so use plain BFS there.

### J12 (analysis). Why does the `if d > dist[u]: continue` check matter?
That single line is the heart of lazy deletion. Without it you reprocess vertices whose distance was already finalized by a smaller entry, wasting time and — if combined with a buggy hand-rolled `visited` flag — producing wrong answers. With it, stale pops are skipped in O(1) and each vertex is "settled" exactly once. It is cheaper than maintaining a separate visited set, which is why the lazy version omits one.

---

## Middle Questions (12 Q&A)

### M1. Walk through the correctness argument for the settled invariant.
The invariant: when a vertex `u` is popped (and not stale), `dist[u]` equals the true shortest distance `δ(u)`. Suppose not — `δ(u) < dist[u]`. The true shortest path to `u` must leave the settled set at some edge `(x, y)` with `x` settled, `y` not. Then `δ(u) = δ(y) + (rest) ≥ δ(y) = dist[y]` because the rest of the path is non-negative. But `u` was chosen as the heap minimum, so `dist[u] ≤ dist[y]`. Combining gives `δ(u) ≥ dist[u]`, contradicting `δ(u) < dist[u]`. The step "(rest) ≥ 0" is exactly where non-negativity is used.

### M2. Lazy deletion vs eager decrease-key — what is the trade-off?
Both give identical answers and the same `O((V + E) log V)` bound. Lazy: on improvement, push a duplicate; the heap holds up to `O(E)` entries; skip stale on pop. No per-vertex bookkeeping — simplest and usually fastest on sparse graphs. Eager: keep one entry per vertex and `decreaseKey` in place; the heap holds at most `O(V)` entries; requires an *indexed* heap that maps vertex → heap position, updated on every swap. More code, marginally better on dense graphs, more cache traffic for the index map.

### M3. When is the `O(V²)` array variant better than the heap variant?
On dense graphs where `E ≈ V²`. There, `O(V²)` beats `O((V + E) log V) = O(V² log V)`. The array variant scans all vertices each round to find the unsettled minimum (`O(V)` per round, `O(V²)` total) and relaxes edges in `O(1)` each. It is also trivially simple — no heap. Adjacency-matrix dense graphs are the textbook case.

### M4. How do you handle "cheapest path with at most K stops"?
Expand the state from `vertex` to `(vertex, stops_used)`. Run Dijkstra over that state space; because adding an edge only increases cost (non-negative), cost-ordered exploration is valid, and the first time you pop `dst` you have the cheapest path satisfying `stops ≤ K`. The alternative is a Bellman-Ford-style relaxation bounded to `K+1` rounds, which is often preferred when stops dominate. Both are accepted answers to LeetCode "Cheapest Flights Within K Stops."

### M5. How do you do multi-criteria (lexicographic) shortest paths?
Make the heap key a tuple, e.g. `(total_cost, total_stops)`, and relax on it. Tuples compare lexicographically, so the heap settles by cost first and breaks ties by stops. The settled check compares the full tuple. This generalizes "minimize cost, then minimize stops" and underlies constrained shortest-path variants.

### M6. How would you find the shortest path that *maximizes* a product (e.g. probability)?
Some problems multiply weights in `[0, 1]` instead of adding. Use a *max*-heap on the product and relax with `>`: `if d * p > prob[v]: prob[v] = d * p; push`. The greedy choice still holds because multiplying by a value in `[0, 1]` never increases the running product — that is the analogue of "non-negative." LeetCode "Path with Maximum Probability" is the canonical instance.

### M7. How do you run Dijkstra on a grid without building an adjacency list?
Treat each cell `(r, c)` as a vertex and generate its 4 (or 8) neighbors on the fly. The edge weight is the entry cost of the target cell or a per-move cost. The `dist` table is a 2-D array. This powers "swim in rising water," "path with minimum effort," and "minimum cost to make at least one valid path." Same push/pop/relax/skip-stale skeleton.

### M8. When do you choose A* over Dijkstra?
When you have a single target and an admissible, consistent heuristic `h` (e.g. straight-line distance for road routing). A* relaxes on `dist[u] + w + h(v)` instead of `dist[u] + w`, steering exploration toward the goal and expanding far fewer vertices. With `h = 0`, A* *is* Dijkstra — that is the precise relationship. Dijkstra is A* with a useless (zero) heuristic.

### M9. How do you stop Dijkstra early for a single target?
Break the moment you pop the target vertex from the heap: its distance is already final (settled-on-pop invariant). You do not need to drain the rest of the queue. This is a common optimization for point-to-point queries and is the foundation of bidirectional Dijkstra, which runs the search from both ends and meets in the middle.

### M10. Why can integer overflow bite Dijkstra, and how do you prevent it?
If you initialize `dist` to a sentinel close to the integer maximum and then compute `dist[u] + w`, the sum can overflow and wrap to a negative number, corrupting comparisons. Fixes: use a 64-bit accumulator, choose a sentinel like `1e18` that is large but far from `int64` overflow, and never relax *from* an `∞` node — the settled check already prevents popping `∞` vertices, so a correct loop never adds to infinity.

### M11. How do you adapt Dijkstra for an undirected graph?
Add both directions of every edge to the adjacency list: for an undirected edge `{u, v, w}` push `(v, w)` into `adj[u]` and `(u, w)` into `adj[v]`. A frequent bug is adding only one direction, silently turning the graph directed and missing paths. The algorithm itself is unchanged.

### M12 (analysis). Why is the lazy version's `O(E log E)` the same as `O((V + E) log V)`?
The lazy heap holds up to one entry per relaxation that improved a distance, so up to `O(E)` pushes and pops, each `O(log E)`. Since `E ≤ V²`, `log E ≤ 2 log V`, so `O(E log E) = O(E log V)`. Adding the `V` pops for the initial entries gives `O((V + E) log V)`. The duplicate entries cost a constant factor, not an asymptotic one.

---

## Senior Questions (10 Q&A)

### S1. Plain Dijkstra explores in all directions. How do you make a single source-to-target query faster?
Three standard tools. Goal-directed search (A*/ALT) prunes exploration away from the target using a heuristic or precomputed landmark lower bounds. Bidirectional Dijkstra runs from source and target simultaneously and stops when the frontiers meet, roughly halving the explored disk. Preprocessing indexes (contraction hierarchies, hub labels, CRP) answer queries in microseconds by precomputing shortcuts. Which one depends on whether the graph is static, how high the QPS is, and your latency SLA.

### S2. When are contraction hierarchies the wrong choice?
When the graph or its weights change frequently — for example, live traffic that updates every minute. CH bakes shortcuts into a static index, and any topology change forces expensive re-preprocessing. The customizable variant CRP (Customizable Route Planning) exists precisely to split expensive topology preprocessing from cheap metric customization, so you can rebuild only the weights when traffic changes.

### S3. How do you parallelize a single Dijkstra query?
The classic approach is Δ-stepping: bucket tentative distances into width-`Δ` ranges and process a whole bucket's relaxations in parallel, since vertices within `Δ` of each other can be settled without a strict global order. Choosing `Δ` trades parallelism (large `Δ`, more concurrency, more re-relaxations) against work (small `Δ`, closer to sequential Dijkstra). It is the standard parallel SSSP algorithm and a common senior-level discussion point.

### S4. At 100M edges, what actually dominates Dijkstra's runtime?
Memory bandwidth, not comparisons. The inner loop does random access into adjacency and distance arrays, so cache misses dominate. Mitigations: store edges in flat struct-of-arrays / CSR (compressed sparse row) layout for locality, reorder vertices to improve spatial locality (e.g. by a space-filling curve on geographic coordinates), and prefer a cache-friendly d-ary heap. The asymptotic complexity is unchanged; the constant factor is everything.

### S5. How do you serve a graph that does not fit on one machine?
Partition the graph (METIS-style edge-cut minimization) across machines, run boundary-aware Dijkstra with cross-partition messages, and cache shortest paths between partition boundary nodes (an "overlay" graph). Hub-labeling precomputes, for each vertex, a small label set so any query is a label intersection — extremely fast but with large preprocessing and storage. The right answer depends on read/write ratio and update frequency.

### S6. How does Dijkstra appear inside min-cost max-flow?
The successive-shortest-paths algorithm repeatedly finds the cheapest augmenting path in the residual graph and pushes flow along it. Residual edges can have negative reduced costs, which would break Dijkstra, so Johnson-style potentials (vertex prices) reweight edges to be non-negative, letting Dijkstra serve as the inner shortest-path engine. This is a common "where else have you seen Dijkstra" follow-up.

### S7. How is Prim's MST related to Dijkstra?
Structurally identical skeleton — same priority queue, same settle-on-pop, same stale-skip. The only difference is the relaxation key: Dijkstra relaxes with `dist[u] + w` (accumulated path cost), Prim relaxes with just `w` (the single edge cost crossing the cut), because an MST cares about the cheapest edge into the tree, not the path length back to a root. Knowing this shows you understand the algorithmic family, not just one recipe.

### S8. How would you observe and alarm on a production routing service?
Track p50/p95/p99 query latency, settled-vertices-per-query (a spike means the heuristic degraded or the graph changed), heap size distribution, cache-miss rate, and a "routing quality" canary comparing live answers against a known-correct offline Dijkstra on sampled queries. Alarm on latency SLA breaches and on quality drift, which usually signals a bad map update or a stale index.

### S9. What are common failure modes at scale?
Unreachable targets returning `∞` mishandled as a numeric distance; integer overflow on huge weight sums; a stale preprocessing index after a map update silently returning wrong routes; heap memory blowup from unbounded lazy duplicates on pathological inputs; and negative weights sneaking in from a data pipeline bug (currency rebates, elevation deltas) that silently corrupt answers. Each needs explicit validation at the data boundary.

### S10 (analysis). Why does the Fibonacci heap rarely beat a binary heap in practice for Dijkstra?
Fibonacci heaps achieve O(1) amortized `decreaseKey` and O(E + V log V) total, but each node carries several pointers and a mark bit, and `extract-min` consolidation chases pointers across non-contiguous memory, causing cache misses. For realistic `V` and `E`, a contiguous-array binary or 4-ary heap finishes faster despite the worse asymptotic bound. The empirical study by Cherkassky, Goldberg, and Radzik (1996) confirms this on real road graphs.

---

## Professional Questions (8 Q&A)

### P1. Design a continental-scale routing engine (50M nodes, 125M edges, sub-100ms SLA).
Layer the service. Tier 1: live Dijkstra for graphs that fit in RAM with per-query metric changes. Tier 2: goal-directed (A*/ALT/bidirectional) for moderate QPS. Tier 3: a preprocessed index (CH or CRP) for very high QPS and static topology. Store the graph in CSR layout in shared memory, separate topology preprocessing from metric customization (CRP) so traffic updates are cheap, and front it with a query cache for popular origin-destination pairs. Discuss memory budget, preprocessing cost, and update cadence.

### P2. How do you keep a routing index fresh under live traffic?
Use CRP: precompute the partition and overlay topology once (expensive, hours), then recompute only the metric (edge weights) when traffic changes (cheap, seconds). Roll out new metrics atomically with a version pointer so in-flight queries see a consistent snapshot. Keep the previous version warm for instant rollback if the new metric produces anomalous routes flagged by the quality canary.

### P3. How would you A/B test a new routing algorithm safely?
Shadow the new algorithm: run it alongside production on a fraction of traffic, compare route cost and latency, and never serve its results until quality matches. Define guardrail metrics (route cost regression, p99 latency, "route looks insane" detector comparing against straight-line distance). Ramp gradually by region. Keep the old engine as instant fallback behind a feature flag.

### P4. A data pipeline bug introduced a few negative edge weights. What happens and how do you catch it?
Dijkstra does not crash — it silently returns wrong (too-small or inconsistent) distances because a vertex may be settled before a later negative edge would have lowered it. Catch it with a validation gate at graph load that rejects or flags `w < 0`, plus a periodic consistency audit that re-checks sampled routes with Bellman-Ford, which tolerates negatives. Alarm on any negative weight reaching the serving layer.

### P5. How do you bound memory and latency for adversarial inputs?
Cap the heap size and abort with a clear error if it exceeds a threshold (pathological graphs can pile up lazy duplicates). Use the eager indexed heap when worst-case memory must be `O(V)` rather than `O(E)`. Add a per-query settled-vertices budget and a wall-clock deadline so a single expensive query cannot starve the service. Pre-allocate the distance and heap arrays to avoid GC pauses.

### P6. How do you serve "k alternative routes" rather than just the optimal one?
Use a k-shortest-paths method: Yen's algorithm (repeatedly run Dijkstra on the graph with selected edges removed to force divergence) for simple paths, or Eppstein's for paths allowing repeats. Add penalties for overlap so the alternatives are meaningfully different, not three near-identical roads. Cache the base shortest-path tree to avoid recomputing it for each alternative.

### P7. How do you handle time-dependent edge weights (rush hour)?
Model the weight as a function of departure time, `w(u, v, t)`. Time-dependent Dijkstra relaxes with `dist[v] = arrival(u→v, dist[u])`, which requires the FIFO / non-overtaking property (leaving later never arrives earlier) for correctness. Precompute travel-time profiles per edge and interpolate. This is how realistic ETA-aware routing works.

### P8 (analysis). Why is bidirectional Dijkstra's stopping condition subtle?
You cannot stop the instant the two searches first touch a common vertex — the optimal path may route through a vertex neither search has settled yet. The correct condition: stop when the sum of the two frontier minimums (`top_forward + top_backward`) is at least the best meeting cost found so far (`μ`). Until then, a shorter meeting path could still exist. Getting this wrong yields paths that look right on most inputs but are occasionally suboptimal — a classic interview trap.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you picked Dijkstra (or rejected it) for a real problem.
Look for a structured story: the problem (e.g. cheapest delivery route, lowest-latency service mesh path), the alternatives considered (BFS, Bellman-Ford, A*, Floyd-Warshall), the criteria (weight sign, graph density, single vs all-pairs, QPS), and why Dijkstra (or something else) won. Strong answers cite what was measured and a surprise — e.g. discovering negative weights forced a switch to Bellman-Ford.

### B2. Design a GPS routing feature for a ride-hailing app.
Dijkstra/A* on the road graph is the engine, but the system around it matters: live traffic as dynamic edge weights, time-dependent travel times, ETA accuracy, caching popular routes, and graceful degradation when the index is stale. Discuss the static-vs-live tier choice (CH/CRP), how you update weights without downtime, and how you validate route quality. Strong candidates draw the architecture and name the trade-offs.

### B3. Design a network-latency-aware service router.
Model services as a weighted graph (latency = weight), run Dijkstra to pick lowest-latency paths, and discuss what changes from road routing: weights fluctuate constantly (so re-run cheaply or use Δ-bounded recompute), failures remove edges live, and you may need k-alternatives for failover. Mention that for tiny meshes Floyd-Warshall all-pairs may be simpler than repeated single-source Dijkstra.

### B4. A junior asks: "Why not always use Dijkstra for shortest paths?" How do you respond?
Dijkstra is the right tool for *one* situation: non-negative weights, single source. It is wrong for negative edges (Bellman-Ford), wasteful on unweighted graphs (plain BFS is simpler and faster), overkill on {0,1} weights (0-1 BFS with a deque), and not the best fit for all-pairs on dense graphs (Floyd-Warshall). Teach choosing the algorithm by the input's properties, not by familiarity.

### B5. Your routing service started returning wrong routes after a map update. How do you investigate?
First check whether the preprocessing index went stale relative to the new topology — the most common cause. Then audit the data pipeline for negative or corrupted weights, and run the quality canary that compares served routes against a fresh offline Dijkstra on sampled queries. Add a version pointer so you can roll back the index instantly, and a load-time validation gate that rejects negative weights before they reach serving.

---

## Coding Challenges

### Challenge 1 — Network Delay Time

A network of `n` nodes labeled `1..n` and a list of `times[i] = (u, v, w)` meaning a signal from `u` to `v` takes `w`. Send a signal from node `k`. Return the time for **all** nodes to receive it, or `-1` if some node never does. This is plain single-source Dijkstra: the answer is the maximum finalized distance.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)         { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func networkDelayTime(times [][]int, n, k int) int {
	const INF = int(1e18)
	adj := make([][][2]int, n+1)
	for _, t := range times {
		adj[t[0]] = append(adj[t[0]], [2]int{t[1], t[2]})
	}
	dist := make([]int, n+1)
	for i := range dist {
		dist[i] = INF
	}
	dist[k] = 0
	h := &pq{{0, k}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue // stale
		}
		for _, e := range adj[cur.node] {
			if nd := cur.dist + e[1]; nd < dist[e[0]] {
				dist[e[0]] = nd
				heap.Push(h, item{nd, e[0]})
			}
		}
	}
	ans := 0
	for i := 1; i <= n; i++ {
		if dist[i] == INF {
			return -1
		}
		if dist[i] > ans {
			ans = dist[i]
		}
	}
	return ans
}

func main() {
	times := [][]int{{2, 1, 1}, {2, 3, 1}, {3, 4, 1}}
	fmt.Println(networkDelayTime(times, 4, 2)) // 2
}
```

#### Java
```java
import java.util.*;

public class NetworkDelay {
    public int networkDelayTime(int[][] times, int n, int k) {
        final long INF = Long.MAX_VALUE / 4;
        List<int[]>[] adj = new List[n + 1];
        for (int i = 1; i <= n; i++) adj[i] = new ArrayList<>();
        for (int[] t : times) adj[t[0]].add(new int[]{t[1], t[2]});

        long[] dist = new long[n + 1];
        Arrays.fill(dist, INF);
        dist[k] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, k});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0]; int u = (int) cur[1];
            if (d > dist[u]) continue;            // stale
            for (int[] e : adj[u]) {
                long nd = d + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    pq.add(new long[]{nd, e[0]});
                }
            }
        }
        long ans = 0;
        for (int i = 1; i <= n; i++) {
            if (dist[i] == INF) return -1;
            ans = Math.max(ans, dist[i]);
        }
        return (int) ans;
    }

    public static void main(String[] args) {
        int[][] times = {{2, 1, 1}, {2, 3, 1}, {3, 4, 1}};
        System.out.println(new NetworkDelay().networkDelayTime(times, 4, 2)); // 2
    }
}
```

#### Python
```python
import heapq


def network_delay_time(times, n, k):
    INF = float("inf")
    adj = [[] for _ in range(n + 1)]
    for u, v, w in times:
        adj[u].append((v, w))
    dist = [INF] * (n + 1)
    dist[k] = 0
    pq = [(0, k)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue  # stale
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    ans = max(dist[1:])
    return -1 if ans == INF else ans


if __name__ == "__main__":
    print(network_delay_time([(2, 1, 1), (2, 3, 1), (3, 4, 1)], 4, 2))  # 2
```

---

### Challenge 2 — Cheapest Flights Within K Stops

`n` cities, `flights[i] = (from, to, price)`, find the cheapest price from `src` to `dst` using **at most** `K` stops, or `-1`. The state is `(cost, city, stops)`; cost-ordered exploration is valid because adding a flight only increases cost.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type fitem struct{ cost, city, stops int }
type fpq []fitem

func (p fpq) Len() int           { return len(p) }
func (p fpq) Less(i, j int) bool { return p[i].cost < p[j].cost }
func (p fpq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *fpq) Push(x any)        { *p = append(*p, x.(fitem)) }
func (p *fpq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func findCheapestPrice(n int, flights [][]int, src, dst, k int) int {
	adj := make([][][2]int, n)
	for _, f := range flights {
		adj[f[0]] = append(adj[f[0]], [2]int{f[1], f[2]})
	}
	h := &fpq{{0, src, 0}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(fitem)
		if cur.city == dst {
			return cur.cost
		}
		if cur.stops > k {
			continue
		}
		for _, e := range adj[cur.city] {
			heap.Push(h, fitem{cur.cost + e[1], e[0], cur.stops + 1})
		}
	}
	return -1
}

func main() {
	flights := [][]int{{0, 1, 100}, {1, 2, 100}, {0, 2, 500}}
	fmt.Println(findCheapestPrice(3, flights, 0, 2, 1)) // 200
	fmt.Println(findCheapestPrice(3, flights, 0, 2, 0)) // 500
}
```

#### Java
```java
import java.util.*;

public class CheapestFlights {
    public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] f : flights) adj[f[0]].add(new int[]{f[1], f[2]});

        // {cost, city, stops}
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, src, 0});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int cost = cur[0], city = cur[1], stops = cur[2];
            if (city == dst) return cost;
            if (stops > k) continue;
            for (int[] e : adj[city]) {
                pq.add(new int[]{cost + e[1], e[0], stops + 1});
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] flights = {{0, 1, 100}, {1, 2, 100}, {0, 2, 500}};
        CheapestFlights cf = new CheapestFlights();
        System.out.println(cf.findCheapestPrice(3, flights, 0, 2, 1)); // 200
        System.out.println(cf.findCheapestPrice(3, flights, 0, 2, 0)); // 500
    }
}
```

#### Python
```python
import heapq


def find_cheapest_price(n, flights, src, dst, k):
    adj = [[] for _ in range(n)]
    for u, v, w in flights:
        adj[u].append((v, w))
    pq = [(0, src, 0)]  # (cost, city, stops)
    while pq:
        cost, city, stops = heapq.heappop(pq)
        if city == dst:
            return cost
        if stops > k:
            continue
        for v, w in adj[city]:
            heapq.heappush(pq, (cost + w, v, stops + 1))
    return -1


if __name__ == "__main__":
    flights = [(0, 1, 100), (1, 2, 100), (0, 2, 500)]
    print(find_cheapest_price(3, flights, 0, 2, 1))  # 200
    print(find_cheapest_price(3, flights, 0, 2, 0))  # 500
```

---

### Challenge 3 — Path with Maximum Probability

An undirected graph where edge `(a, b)` succeeds with probability `succProb[i]`. Find the path from `start` to `end` that **maximizes** the product of probabilities. Use a *max*-heap on the product; the greedy choice holds because each factor is in `[0, 1]`.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type pitem struct {
	prob float64
	node int
}
type maxpq []pitem

func (p maxpq) Len() int            { return len(p) }
func (p maxpq) Less(i, j int) bool  { return p[i].prob > p[j].prob } // max-heap
func (p maxpq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *maxpq) Push(x any)         { *p = append(*p, x.(pitem)) }
func (p *maxpq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func maxProbability(n int, edges [][]int, succProb []float64, start, end int) float64 {
	type e struct {
		to int
		p  float64
	}
	adj := make([][]e, n)
	for i, ed := range edges {
		adj[ed[0]] = append(adj[ed[0]], e{ed[1], succProb[i]})
		adj[ed[1]] = append(adj[ed[1]], e{ed[0], succProb[i]}) // undirected
	}
	best := make([]float64, n)
	best[start] = 1.0
	h := &maxpq{{1.0, start}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(pitem)
		if cur.node == end {
			return cur.prob
		}
		if cur.prob < best[cur.node] {
			continue // stale
		}
		for _, nb := range adj[cur.node] {
			if np := cur.prob * nb.p; np > best[nb.to] {
				best[nb.to] = np
				heap.Push(h, pitem{np, nb.to})
			}
		}
	}
	return 0.0
}

func main() {
	edges := [][]int{{0, 1}, {1, 2}, {0, 2}}
	fmt.Println(maxProbability(3, edges, []float64{0.5, 0.5, 0.2}, 0, 2)) // 0.25
}
```

#### Java
```java
import java.util.*;

public class MaxProbPath {
    public double maxProbability(int n, int[][] edges, double[] succProb, int start, int end) {
        List<double[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < edges.length; i++) {
            adj[edges[i][0]].add(new double[]{edges[i][1], succProb[i]});
            adj[edges[i][1]].add(new double[]{edges[i][0], succProb[i]}); // undirected
        }
        double[] best = new double[n];
        best[start] = 1.0;
        // max-heap on probability
        PriorityQueue<double[]> pq = new PriorityQueue<>((a, b) -> Double.compare(b[0], a[0]));
        pq.add(new double[]{1.0, start});
        while (!pq.isEmpty()) {
            double[] cur = pq.poll();
            double p = cur[0]; int u = (int) cur[1];
            if (u == end) return p;
            if (p < best[u]) continue;            // stale
            for (double[] nb : adj[u]) {
                int v = (int) nb[0];
                double np = p * nb[1];
                if (np > best[v]) {
                    best[v] = np;
                    pq.add(new double[]{np, v});
                }
            }
        }
        return 0.0;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {0, 2}};
        System.out.println(new MaxProbPath().maxProbability(
                3, edges, new double[]{0.5, 0.5, 0.2}, 0, 2)); // 0.25
    }
}
```

#### Python
```python
import heapq


def max_probability(n, edges, succ_prob, start, end):
    adj = [[] for _ in range(n)]
    for (a, b), p in zip(edges, succ_prob):
        adj[a].append((b, p))
        adj[b].append((a, p))  # undirected
    best = [0.0] * n
    best[start] = 1.0
    pq = [(-1.0, start)]  # negate for max-heap via heapq
    while pq:
        neg_p, u = heapq.heappop(pq)
        p = -neg_p
        if u == end:
            return p
        if p < best[u]:
            continue  # stale
        for v, w in adj[u]:
            np = p * w
            if np > best[v]:
                best[v] = np
                heapq.heappush(pq, (-np, v))
    return 0.0


if __name__ == "__main__":
    print(max_probability(3, [(0, 1), (1, 2), (0, 2)], [0.5, 0.5, 0.2], 0, 2))  # 0.25
```

---

### Challenge 4 — Swim in Rising Water

Given an `n × n` grid where `grid[r][c]` is the elevation, water level rises over time. At time `t` you can move to an adjacent cell if both cells have elevation ≤ `t`. Return the least time to reach `(n-1, n-1)` from `(0, 0)`. This is a "minimmax path" Dijkstra: the path cost is the **maximum** cell on the path, and we minimize that maximum.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type gitem struct{ t, r, c int }
type gpq []gitem

func (p gpq) Len() int           { return len(p) }
func (p gpq) Less(i, j int) bool { return p[i].t < p[j].t }
func (p gpq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *gpq) Push(x any)        { *p = append(*p, x.(gitem)) }
func (p *gpq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func swimInWater(grid [][]int) int {
	n := len(grid)
	seen := make([][]bool, n)
	for i := range seen {
		seen[i] = make([]bool, n)
	}
	h := &gpq{{grid[0][0], 0, 0}}
	seen[0][0] = true
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(gitem)
		if cur.r == n-1 && cur.c == n-1 {
			return cur.t
		}
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < n && !seen[nr][nc] {
				seen[nr][nc] = true
				nt := cur.t
				if grid[nr][nc] > nt {
					nt = grid[nr][nc] // path cost = max cell so far
				}
				heap.Push(h, gitem{nt, nr, nc})
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{{0, 2}, {1, 3}}
	fmt.Println(swimInWater(grid)) // 3
}
```

#### Java
```java
import java.util.*;

public class SwimInWater {
    public int swimInWater(int[][] grid) {
        int n = grid.length;
        boolean[][] seen = new boolean[n][n];
        // {time, r, c}, min-heap on time
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{grid[0][0], 0, 0});
        seen[0][0] = true;
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int t = cur[0], r = cur[1], c = cur[2];
            if (r == n - 1 && c == n - 1) return t;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n && !seen[nr][nc]) {
                    seen[nr][nc] = true;
                    pq.add(new int[]{Math.max(t, grid[nr][nc]), nr, nc});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 2}, {1, 3}};
        System.out.println(new SwimInWater().swimInWater(grid)); // 3
    }
}
```

#### Python
```python
import heapq


def swim_in_water(grid):
    n = len(grid)
    seen = [[False] * n for _ in range(n)]
    pq = [(grid[0][0], 0, 0)]  # (time, r, c)
    seen[0][0] = True
    while pq:
        t, r, c = heapq.heappop(pq)
        if r == n - 1 and c == n - 1:
            return t
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and not seen[nr][nc]:
                seen[nr][nc] = True
                heapq.heappush(pq, (max(t, grid[nr][nc]), nr, nc))
    return -1


if __name__ == "__main__":
    print(swim_in_water([[0, 2], [1, 3]]))  # 3
```

---

## Common Pitfalls

1. **Using Dijkstra on negative weights.** It compiles, runs, and lies. Validate `w ≥ 0` at the boundary; use Bellman-Ford otherwise.
2. **Forgetting the settled check `if d > dist[u]: continue`.** Leads to reprocessing and, with buggy visited logic, wrong answers.
3. **Settling on push instead of pop.** A later cheaper relaxation gets ignored. Settle only when the vertex pops.
4. **Integer overflow on `dist[u] + w`.** Use 64-bit, a sentinel like `1e18`, and never relax from an `∞` node.
5. **Forgetting both directions on undirected graphs.** Add `(v,w)` to `adj[u]` *and* `(u,w)` to `adj[v]`.
6. **Pushing unconditionally.** Only push when `nd < dist[v]`; otherwise the heap bloats with junk.
7. **Returning distances when the task wants the path.** Maintain `prev[]` and reconstruct.
8. **Using Dijkstra on unweighted graphs.** Plain BFS is simpler and faster; the `log V` is pure overhead.
9. **Mishandling unreachable targets.** Decide up front whether `∞` becomes `-1`, an exception, or stays `∞`.
10. **Treating the minimax/probability variants like a standard sum.** Maximum-on-path and product-of-probabilities need a different relaxation operator and heap direction.

---

## What Interviewers Are Really Testing

- **Do you know *why* the greedy choice works?** Anyone can recite the loop. The non-negativity argument (settling the closest unsettled vertex can never be beaten by a route through farther unsettled vertices) is the real signal.
- **Settle-on-pop and the stale check.** Whether you write `if d > dist[u]: continue` and settle on pop, unprompted, reveals real understanding versus memorized syntax.
- **Algorithm selection.** Can you say when to reach for BFS, 0-1 BFS, A*, Bellman-Ford, or Floyd-Warshall instead? Choosing by the input's properties (weight sign, density, single vs all-pairs) is senior-level judgment.
- **State expansion.** "Cheapest within K stops" and grid/minimax problems test whether you can generalize the vertex to a richer state `(vertex, extra)` and keep the greedy argument valid.
- **Edge cases.** Overflow, undirected edge duplication, unreachable targets, self-loops, zero-weight edges — handling these without prompting shows production maturity.
- **Communication.** Walking the small worked example (init, pop-min, relax, skip stale, reconstruct) clearly is as important as the code. Interviewers want to follow your reasoning, not just see a finished loop.
