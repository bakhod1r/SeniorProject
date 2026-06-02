# Bellman-Ford Algorithm — Interview Preparation

Bellman-Ford is the shortest-path algorithm interviewers reach for when they want to test whether you understand *relaxation* rather than memorize an API. It is small enough to write on a whiteboard, yet it carries real subtlety: why exactly `V-1` rounds, why a single extra round detects a negative cycle, why Dijkstra cannot do this, and how the same machinery powers currency-arbitrage detection, difference constraints, and distance-vector routing. This file is a curated question bank sorted by seniority, plus behavioral prompts and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Value |
|------|-------|
| Problem solved | Single-source shortest paths (SSSP) with possibly negative weights |
| Time | `O(V·E)` worst case; `O(k·E)` with early termination (`k` = hop-diameter + 1) |
| Space | `O(V + E)` — `dist[]`, `pred[]`, plus the edge list |
| Relaxation rounds | exactly `V - 1` |
| Detection rounds | `1` more; any relaxation ⇒ negative cycle reachable from source |
| Handles negatives | **Yes** (Dijkstra cannot) |
| Detects negative cycle | **Yes** (uniquely useful) |
| DAG special case | relax in topological order, `O(V + E)` |
| Beats Dijkstra when | edges can be negative or you need cycle detection |

The core operation in one line:

```text
relax(u, v, w):  if dist[u] != INF and dist[u] + w < dist[v]:
                     dist[v] = dist[u] + w;  pred[v] = u
```

The whole algorithm:

```text
init:    dist[src] = 0, others = INF
repeat:  V-1 rounds { relax every edge }   (stop early if a round changes nothing)
detect:  one more round; if any edge still relaxes => negative cycle
```

---

## Junior Questions (12 Q&A)

### J1. What problem does Bellman-Ford solve?
It computes single-source shortest paths: given a weighted directed graph and a source vertex, it finds the cheapest distance from the source to every other vertex. Its distinguishing feature is that edge weights **may be negative**, which Dijkstra cannot handle. As a bonus, it can detect whether a negative-weight cycle is reachable from the source.

### J2. What is edge relaxation?
Relaxation is the single update the algorithm repeats. For a directed edge `u → v` with weight `w`, if `dist[u] + w < dist[v]`, you have found a cheaper route to `v`, so you set `dist[v] = dist[u] + w` (and record `pred[v] = u`). Relaxation can only ever lower a distance, never raise it, so distances march monotonically downward toward their true values.

### J3. Why does the algorithm run `V-1` rounds?
A shortest path in a graph with `V` vertices is simple (no repeated vertices) when there is no negative cycle, so it uses at most `V-1` edges. One full pass over all edges propagates correct distances one extra hop. After `V-1` passes, every shortest path of up to `V-1` edges is settled. Fewer rounds could miss the longest shortest path; more rounds are wasted unless you are detecting a cycle.

### J4. How does Bellman-Ford detect a negative cycle?
After the `V-1` relaxation rounds, run **one more** pass over all edges. If no negative cycle is reachable, the distances are final and nothing relaxes. If any edge `u → v` still satisfies `dist[u] + w < dist[v]`, that improvement cannot come from a longer simple path — those are done — so it must come from a cycle that keeps lowering cost: a negative cycle.

### J5. Why can't Dijkstra handle negative weights?
Dijkstra greedily picks the unvisited vertex with the smallest `dist`, declares it "settled," and never revisits it. That is only correct when no future path can be cheaper, which holds when all weights are `≥ 0`. With a negative edge, a vertex you already settled might later be reachable more cheaply through an unexplored negative edge — but Dijkstra never reconsiders it, so it returns a wrong answer. Bellman-Ford never settles anything permanently; it keeps relaxing every edge.

### J6. What is the time and space complexity?
Time is `O(V·E)`: `V-1` rounds, each relaxing all `E` edges. Space is `O(V + E)`: `dist[]` and `pred[]` are `O(V)`, and the edge list is `O(E)`. On a dense graph where `E ≈ V²`, that is `O(V³)`. Dijkstra is faster at `O(E log V)` but cannot handle negatives.

### J7. What data structure does Bellman-Ford need?
Just a flat **edge list** — an array of `(u, v, w)` triples — plus a `dist[]` array and optionally a `pred[]` array. Unlike Dijkstra, it needs no priority queue. That simplicity is part of why it is the natural choice for distributed routing and as a subroutine inside larger algorithms.

### J8. How do you initialize the distance array?
Set `dist[src] = 0` and `dist[v] = +∞` for every other vertex. Infinity is a sentinel meaning "not yet reached." In code, use a large constant with headroom (for example `MAX/4`) so that adding an edge weight does not overflow, and guard every relaxation with `dist[u] != INF`.

### J9. What does the `dist[u] != INF` guard protect against?
If `u` has not been reached yet, `dist[u]` is the infinity sentinel. Adding a weight to it produces a meaningless value, and with a real "large number" sentinel it can overflow into a negative number that looks like a fantastic path. Guarding with `dist[u] != INF` ensures you only relax from vertices that actually have a finite known distance.

### J10. How do you reconstruct the actual shortest path, not just its length?
Keep a `pred[]` (predecessor) array. Whenever you relax `u → v`, set `pred[v] = u`. To recover the path to a target, walk `pred` backward from the target to the source, then reverse. Only do this when no negative cycle exists, otherwise `pred` may form a loop.

### J11. What is early termination and why use it?
If a full round relaxes no edge, distances have converged and you can stop immediately, even before round `V-1`. It is a one-boolean optimization (`changed = false` at the top of each round): if nothing changes, break. On easy graphs this turns the `O(VE)` worst case into something far cheaper, and it costs nothing to add.

### J12. When should you NOT use Bellman-Ford?
When all weights are non-negative, use Dijkstra — it is asymptotically faster. When the graph is a DAG, relax in topological order in `O(V+E)`. When the graph is unweighted, use BFS. Bellman-Ford earns its keep specifically when negative weights are possible or when you must detect a negative cycle.

---

## Middle Questions (12 Q&A)

### M1. Prove that after `k` rounds, distances are correct for paths of at most `k` edges.
By induction on `k`. Base: after 0 rounds, `dist[src] = 0` (empty path) and all others `∞`, correct for 0-edge paths. Step: assume after round `k` every shortest path of `≤ k` edges is correct. Take any shortest path to `v` of `≤ k+1` edges with last edge `u → v`; its prefix to `u` has `≤ k` edges, so `dist[u]` was correct before round `k+1`. Round `k+1` relaxes `u → v`, so `dist[v]` becomes `dist[u] + w`, the optimum. Relaxation never overshoots, giving equality.

### M2. How do you *locate* a negative cycle, not just detect it?
After `V-1` rounds, run one more pass; if edge `u → v` relaxes, set `x = v`. Step the `pred` pointers from `x` exactly `V` times — because you stepped back more than the longest simple path, you are guaranteed to land *inside* the cycle. From that vertex, follow `pred` until you return to it; that closed walk is the negative cycle. Reverse for forward order.

### M3. What is SPFA and how does it relate to Bellman-Ford?
SPFA (Shortest Path Faster Algorithm) is the queue-based variant, originally Moore's contribution. Instead of re-relaxing every edge each round, it keeps a FIFO queue of "active" vertices whose distance just improved and only relaxes their outgoing edges. A vertex is enqueued at most once at a time (an `inQueue` flag prevents duplicates). On random and sparse graphs it is often close to `O(E)`, but its worst case is still `O(VE)`.

### M4. How does SPFA detect a negative cycle?
Count how many times each vertex is relaxed into (dequeued and processed). If any vertex is relaxed `≥ V` times, a negative cycle is reachable, because in a cycle-free graph a vertex's distance can improve at most `V-1` times. Bail out the moment a count hits `V`.

### M5. Why is SPFA considered a "trap" at scale?
Its average-case speed tempts engineers to use it as a drop-in replacement, but adversarial inputs — layered zigzag graphs, certain negative lattices — reliably force the full `O(VE)`, spiking CPU and timing out judges or services. It offers no worst-case improvement over plain Bellman-Ford. The safe default for guaranteed performance is `O(VE)` Bellman-Ford with early termination, or Dijkstra if weights are non-negative.

### M6. How do you detect currency arbitrage with Bellman-Ford?
Model each currency as a vertex and each exchange rate `r` from `i` to `j` as an edge with weight `-log(r)`. A cycle whose rate product exceeds 1 (profitable) becomes a cycle whose weight sum is negative. Initialize all distances to 0 (every currency is a potential start), run `V-1` rounds, then a detection pass. Any relaxation in the detection pass means a negative cycle exists — arbitrage.

### M7. What are difference constraints and how does Bellman-Ford solve them?
A system of constraints of the form `x_j - x_i ≤ c` can be solved as a shortest-path problem. Model each constraint as an edge `i → j` with weight `c`. Add a super-source with 0-weight edges to every variable, run Bellman-Ford, and read `x_i = dist[i]` as a feasible assignment. If a negative cycle exists, the system is infeasible. Schedulers and timing-analysis tools use exactly this.

### M8. Why a super-source, and when do you need it?
Plain Bellman-Ford only detects negative cycles **reachable from the source**. If you need to find a negative cycle *anywhere* in the graph, add a virtual super-source with 0-weight edges to all vertices (or equivalently initialize every `dist` to 0). Now every vertex is reachable, so any negative cycle becomes detectable.

### M9. Bellman-Ford versus Dijkstra versus Floyd-Warshall — when each?
Bellman-Ford: SSSP with negatives and cycle detection, `O(VE)`. Dijkstra: SSSP with non-negative weights, faster at `O(E log V)`. Floyd-Warshall: all-pairs shortest paths on a small/dense graph, `O(V³)`, also handles negatives and detects negative cycles via a negative diagonal. Choose by the problem: single-source vs all-pairs, and whether negatives are present.

### M10. How does Bellman-Ford fit into Johnson's all-pairs algorithm?
Johnson's computes all-pairs shortest paths on a sparse graph with negative edges. It adds a super-source, runs **Bellman-Ford once** to get a potential `h[v]`, reweights every edge to `w'(u,v) = w(u,v) + h[u] - h[v]` (now all non-negative), then runs **Dijkstra** from each vertex. Bellman-Ford is the negative-handling front end; Dijkstra is the fast back end.

### M11. Why use strict `<` and not `<=` in the relaxation check?
With `<=`, equal-cost "updates" would be treated as changes, so the `changed` flag would keep firing, the algorithm would never converge, and early termination would never trigger. Strict `<` ensures you only count genuine improvements, which is what makes convergence and early stopping correct.

### M12. How does the DAG special case change things?
If the graph is acyclic, you do not need `V-1` rounds at all. Topologically sort the vertices, then relax each vertex's outgoing edges once in that order. Because every edge goes from an earlier to a later vertex in topological order, a single pass settles all distances in `O(V+E)`. This also trivially handles negative weights since a DAG has no cycles.

---

## Senior Questions (10 Q&A)

### S1. Why is Bellman-Ford the basis of distance-vector routing?
Its relaxation is **local**: a vertex computes `dist[v] = min over in-edges of (dist[u] + w)` knowing only its neighbors' current estimates. No global view or global priority queue is required, unlike Dijkstra. Routers can therefore run it in a distributed, asynchronous fashion — each periodically advertises its distance vector and relaxes against neighbors' vectors. This is exactly how RIP works.

### S2. What is the count-to-infinity problem?
It is the defining failure of distributed Bellman-Ford. When a link to a destination goes down, a neighbor may still advertise a stale route that secretly loops back through the failed node. Each router increments its metric one step per exchange — 3, 4, 5, … — slowly "counting up to infinity" (RIP caps it at 16). The root cause is that a node cannot tell that a neighbor's advertised route passes back through itself.

### S3. How do you mitigate count-to-infinity?
Common mitigations: a low metric cap (16 = infinity in RIP) so it terminates; **split horizon** (do not advertise a route back to the neighbor you learned it from); **poison reverse** (advertise such routes with infinite metric explicitly); **triggered updates** (advertise immediately on change); and **hold-down timers** (ignore better news about a recently-down route). These patch the symptom; the structural cure is to move to path-vector (BGP) or link-state (OSPF).

### S4. Can Bellman-Ford be parallelized?
Yes, cleanly. Within a round, relaxing all edges is a set of `min` updates into `dist[]`. Edges are independent reads of `dist[u]` and writes to `dist[v]`; the writes are `min`-reductions done with atomic compare-and-swap loops or `atomicMin`. Rounds are separated by a barrier. This maps well to GPUs: edges become threads, `dist` lives in global memory.

### S5. Why is it safe to read a stale `dist[u]` during parallel relaxation?
Because relaxation is **monotone**: distances only decrease, and never below the true shortest path. Reading a slightly larger (stale) `dist[u]` only delays an improvement to a later round; it never produces a wrong final answer. This same tolerance for stale reads is precisely what makes the asynchronous distributed version converge at all.

### S6. What observability signals matter when Bellman-Ford runs as infrastructure?
For a routing daemon: a destination's metric increasing monotonically is count-to-infinity in progress, visible before the cap is hit; route flaps indicate instability; advertisement rate reveals triggered-update bursts; time-to-converge is the key SLO. For a batch job: rounds-to-converge, total relaxations, and the negative-cycle detector firing.

### S7. Compare distance-vector, path-vector, and link-state at scale.
Distance-vector (Bellman-Ford, RIP): each node knows only neighbors, slow convergence, can count to infinity. Path-vector (BGP): carries the full AS path, so a router rejects any route already containing its own AS — loop-free, internet-scale. Link-state (Dijkstra, OSPF/IS-IS): each node floods full topology and runs SPF locally, fast and loop-free per computation. The scalable answers deliberately abandon pure distance-vector.

### S8. How does the `INF` sentinel cause production bugs?
If `INF` is too small (for example `Integer.MAX_VALUE`) and you relax from an unreachable vertex without the guard, `INF + w` overflows to a negative number masquerading as a great path, poisoning every downstream distance. The fix is `INF = MAX/4` for headroom plus the `dist[u] != INF` guard, enforced in code review.

### S9. What happens if a "should-be-non-negative" graph gets a negative edge by bug?
Distances can diverge toward `-∞`. In a batch job the detection pass fires and you catch it. In a streaming/online system it can silently corrupt every dependent distance before anyone notices. The mitigation is to validate edge weights at ingestion and assert non-negativity wherever the domain requires it.

### S10. Where does Bellman-Ford sit inside min-cost max-flow?
It (or SPFA) finds the shortest-cost augmenting path in the residual graph, where residual edges can have negative cost. After the first iteration, Johnson-style potentials make all reduced costs non-negative, so the implementation switches to Dijkstra for speed. Bellman-Ford absorbs the initial negativity exactly once.

---

## Professional Questions (8 Q&A)

### P1. How do you architect Bellman-Ford as an offline batch analyzer?
Load the edge list, run `V-1` rounds plus a detection pass, emit distances and any negative cycle. It is stateless, deterministic, and restartable, which makes it trivial to operate. This is the most common production use of the centralized algorithm: arbitrage detection, constraint feasibility checks, and graph audits. Capacity is `Θ(rounds × E)`; with early termination, `rounds` is usually small on real graphs.

### P2. What is Yen's improvement and why does it matter in practice?
Yen (1970) partitions edges by a vertex ordering into forward (`u < v`) and backward (`u > v`) sets and relaxes forward edges in increasing order, then backward edges in decreasing order, each round. A single sweep then propagates *all* improvements in one direction within a round, roughly halving the number of rounds to about `V/2`. It is deterministic and never worse than `O(VE)`, making it the safe "fast Bellman-Ford" alternative to SPFA.

### P3. How do you size a single-machine Bellman-Ford for `V = 10^7`, `E = 10^8`?
Memory: edge list at 8-byte entries is roughly 0.9 GB, `dist[]` plus `pred[]` is about 0.16 GB. Relaxation is a memory-bound scan; expect on the order of `10^8`–`10^9` relaxations per second per core, cache-bound on the random `dist[]` accesses. Use 64-bit distances, early termination, and consider a semi-external layout (keep `dist[]` in RAM, stream edges from disk) for graphs that exceed memory.

### P4. Why is Bellman-Ford memory-latency-bound, and how do you improve cache behavior?
The inner loop streams sequentially over the edge list (good spatial locality) but does random reads and writes into `dist[]` over `V` slots. When `V` exceeds cache, each relaxation costs up to two cache misses on `dist`, which dominates. Sorting edges by `u` improves read-side temporal locality; grouping by `v` helps the write side — you cannot optimize both, so profile.

### P5. How would you build an online/incremental negative-cycle detector?
Plain Bellman-Ford is a batch algorithm. For streaming edge insertions, maintain potentials and re-run a bounded SPFA from affected vertices, capping per-vertex relaxations at `V` to detect a newly formed cycle. This underpins incremental difference-constraint solvers (for example, in schedulers). The amortized bounds here are an active research area; for hard guarantees, periodic full recomputation is simpler.

### P6. What is the modern theoretical frontier for negative-weight SSSP?
Bernstein, Nanongkai & Wulff-Nilsen (FOCS 2022) gave a randomized near-linear `Õ(E · log²V · log W)` algorithm for negative-weight SSSP — the first to break the long-standing `O(VE)` barrier with a combinatorial approach, using low-diameter decomposition and recursive scaling/reweighting. Follow-ups (Bringmann–Cassis–Fischer 2023) simplified and partly de-randomized it. Constants are large, so plain Bellman-Ford with Yen/early-stop still wins in practice at current graph sizes.

### P7. How do you choose between SPFA and deterministic Bellman-Ford in a real service?
Default to deterministic `O(VE)` Bellman-Ford with early termination when correctness and worst-case latency matter — its bound is guaranteed. Reach for SPFA only when you have measured a real average-case need and can tolerate the `O(VE)` tail, and even then cap per-vertex relaxations to fail fast. If weights are non-negative, sidestep the question entirely and use Dijkstra.

### P8. How do you debug "distances are wrong and hugely negative" in production?
This almost always means relaxation from an unreachable vertex with a too-small `INF` (overflow), or a genuine negative cycle. First assert the `dist[u] != INF` guard and a headroom sentinel. Then run the detection pass and, if it fires, extract the cycle via `pred`-chasing to find the offending edges. Validate edge weights at ingestion to catch a stray negative edge in a domain that should be non-negative.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose Bellman-Ford over Dijkstra.
Look for a structured story: the problem had negative weights or required cycle detection (arbitrage, constraint feasibility, residual costs in flow), the candidate considered Dijkstra and rejected it because of the negative edges, weighed the `O(VE)` cost against the problem size, and added early termination or Yen's halving. Strong answers cite what was measured and the trade-off accepted.

### B2. Design an arbitrage-detection service for a currency exchange.
The standard answer is a batch Bellman-Ford over a `-log(rate)` graph. Discuss data freshness (rates change by the second, so re-run on a short cadence), floating-point epsilon to avoid false positives, extracting the actual trade cycle to report, and acting on results before the window closes. Discuss failover and idempotency since it is a stateless batch job, and how you would alert on a detected cycle.

### B3. Design a routing protocol for a small campus network.
Distance-vector (RIP-style) is acceptable for small, slow-changing networks. Discuss the count-to-infinity risk and the mitigations you would enable (split horizon, poison reverse, triggered updates, hold-down). Then explain why you would move to OSPF (link-state) as the network grows past a handful of hops, and what observability (monotone metric growth, route flaps, convergence time) you would wire up.

### B4. A junior asks: "Why not always use Bellman-Ford so I never worry about negative weights?"
Because it is asymptotically slower: `O(VE)` versus Dijkstra's `O(E log V)`. On a graph that is guaranteed non-negative, paying that overhead for safety you do not need is premature pessimization. Teach choosing the algorithm by the problem's guarantees: Dijkstra for non-negative, DAG relaxation for acyclic, BFS for unweighted, Bellman-Ford precisely when negatives or cycle detection are on the table.

### B5. Your team's SPFA-based service is intermittently timing out. How do you investigate?
SPFA's `O(VE)` worst case is the prime suspect. Add a per-vertex relaxation counter and a metric for rounds-to-converge; when timeouts occur, check whether a vertex is being re-enqueued an abnormal number of times, which signals an adversarial or pathological input. The fix is to cap per-vertex relaxations and fall back to deterministic Bellman-Ford or Dijkstra. Discuss reproducing with the captured input and adding a regression test.

---

## Coding Challenges

### Challenge 1: Cheapest Flights Within K Stops

**Problem.** There are `n` cities connected by `flights[i] = [from, to, price]`. Find the cheapest price from `src` to `dst` using **at most `k` stops** (so at most `k+1` edges). Return `-1` if there is no such route.

**Example.**

```text
n = 4, flights = [[0,1,100],[1,2,100],[2,0,100],[1,3,600],[2,3,200]]
src = 0, dst = 3, k = 1
Answer: 700   // 0->1->3 costs 700; 0->1->2->3 uses 2 stops, not allowed
```

**Constraints.** `1 <= n <= 100`, `0 <= flights.length <= n*(n-1)`, `1 <= price <= 10^4`, `0 <= k < n`.

**Why Bellman-Ford.** The "at most `k` stops" cap is exactly Bellman-Ford's "at most `k+1` edges" guarantee after `k+1` rounds. Run `k+1` rounds, but relax from a **snapshot** of the previous round's distances so each round adds at most one more edge.

**Go.**

```go
package main

import "fmt"

func findCheapestPrice(n int, flights [][]int, src, dst, k int) int {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round <= k; round++ {
		snapshot := make([]int, n)
		copy(snapshot, dist)
		for _, f := range flights {
			u, v, w := f[0], f[1], f[2]
			if snapshot[u] != INF && snapshot[u]+w < dist[v] {
				dist[v] = snapshot[u] + w
			}
		}
	}
	if dist[dst] == INF {
		return -1
	}
	return dist[dst]
}

func main() {
	flights := [][]int{{0, 1, 100}, {1, 2, 100}, {2, 0, 100}, {1, 3, 600}, {2, 3, 200}}
	fmt.Println(findCheapestPrice(4, flights, 0, 3, 1)) // 700
}
```

**Java.**

```java
import java.util.*;

public class CheapestFlights {
    public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
        final int INF = 1 << 30;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round <= k; round++) {
            int[] snapshot = dist.clone();
            for (int[] f : flights) {
                int u = f[0], v = f[1], w = f[2];
                if (snapshot[u] != INF && snapshot[u] + w < dist[v]) {
                    dist[v] = snapshot[u] + w;
                }
            }
        }
        return dist[dst] == INF ? -1 : dist[dst];
    }

    public static void main(String[] args) {
        int[][] flights = {{0, 1, 100}, {1, 2, 100}, {2, 0, 100}, {1, 3, 600}, {2, 3, 200}};
        System.out.println(new CheapestFlights().findCheapestPrice(4, flights, 0, 3, 1)); // 700
    }
}
```

**Python.**

```python
def find_cheapest_price(n, flights, src, dst, k):
    INF = float("inf")
    dist = [INF] * n
    dist[src] = 0
    for _ in range(k + 1):
        snapshot = dist[:]            # freeze previous round
        for u, v, w in flights:
            if snapshot[u] + w < dist[v]:
                dist[v] = snapshot[u] + w
    return -1 if dist[dst] == INF else dist[dst]


if __name__ == "__main__":
    flights = [[0, 1, 100], [1, 2, 100], [2, 0, 100], [1, 3, 600], [2, 3, 200]]
    print(find_cheapest_price(4, flights, 0, 3, 1))  # 700
```

**Follow-up.** Why the snapshot? Without it, a single round could chain several edges (relaxing `u → v` then immediately using the new `dist[v]` to relax `v → x`), violating the "at most one more edge per round" invariant and undercounting stops. The snapshot enforces that each round adds exactly one hop.

---

### Challenge 2: Detect a Negative Cycle

**Problem.** Given a directed weighted graph as an edge list, return `true` if it contains a negative-weight cycle **anywhere** (not necessarily reachable from a fixed source).

**Example.**

```text
n = 3, edges = [[0,1,1],[1,2,-1],[2,0,-1]]
cycle 0->1->2->0 has weight 1 + (-1) + (-1) = -1 < 0  =>  true
```

**Constraints.** `1 <= n <= 2000`, weights fit in 32-bit signed integers.

**Key trick.** To find a cycle anywhere, initialize **all** distances to 0 (equivalent to a super-source with 0-weight edges to every vertex). Then `V-1` rounds plus one detection round.

**Go.**

```go
package main

import "fmt"

type Edge struct{ From, To, W int }

func hasNegativeCycle(n int, edges []Edge) bool {
	dist := make([]int, n) // all zero: virtual super-source
	for round := 0; round < n-1; round++ {
		changed := false
		for _, e := range edges {
			if dist[e.From]+e.W < dist[e.To] {
				dist[e.To] = dist[e.From] + e.W
				changed = true
			}
		}
		if !changed {
			return false
		}
	}
	for _, e := range edges {
		if dist[e.From]+e.W < dist[e.To] {
			return true
		}
	}
	return false
}

func main() {
	edges := []Edge{{0, 1, 1}, {1, 2, -1}, {2, 0, -1}}
	fmt.Println(hasNegativeCycle(3, edges)) // true
}
```

**Java.**

```java
public class NegativeCycle {
    public boolean hasNegativeCycle(int n, int[][] edges) {
        long[] dist = new long[n]; // all zero: virtual super-source
        for (int round = 0; round < n - 1; round++) {
            boolean changed = false;
            for (int[] e : edges) {
                if (dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                    changed = true;
                }
            }
            if (!changed) return false;
        }
        for (int[] e : edges) {
            if (dist[e[0]] + e[2] < dist[e[1]]) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, -1}, {2, 0, -1}};
        System.out.println(new NegativeCycle().hasNegativeCycle(3, edges)); // true
    }
}
```

**Python.**

```python
def has_negative_cycle(n, edges):
    dist = [0] * n                    # all zero: virtual super-source
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            return False
    return any(dist[u] + w < dist[v] for u, v, w in edges)


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, -1), (2, 0, -1)]
    print(has_negative_cycle(3, edges))  # True
```

**Follow-up.** To return the actual cycle vertices, record `pred[v] = u` on each relaxation; if the detection round relaxes into `x`, step `pred` `n` times to land inside the cycle, then follow `pred` until it repeats.

---

### Challenge 3: Currency Arbitrage

**Problem.** Given an `n × n` matrix of exchange rates where `rate[i][j]` is the units of currency `j` you get per unit of `i`, determine whether a sequence of trades exists that returns to the starting currency with **more money than you began with** (arbitrage).

**Example.**

```text
rate = [[1.0, 0.5, 0.2],
        [2.0, 1.0, 0.5],
        [5.0, 2.0, 1.0]]
Some cycle multiplies to > 1  =>  arbitrage exists  =>  true
```

**Constraints.** `2 <= n <= 100`, rates are positive floats.

**Key trick.** Edge weight `w(i→j) = -log(rate[i][j])`. A cycle whose rate product exceeds 1 has a negative weight sum. Use an epsilon in the comparison to avoid floating-point false positives. Initialize all distances to 0.

**Go.**

```go
package main

import (
	"fmt"
	"math"
)

func hasArbitrage(rate [][]float64) bool {
	n := len(rate)
	type E struct {
		u, v int
		w    float64
	}
	var edges []E
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if i != j {
				edges = append(edges, E{i, j, -math.Log(rate[i][j])})
			}
		}
	}
	dist := make([]float64, n) // all zero
	const eps = 1e-12
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e.u]+e.w < dist[e.v]-eps {
				dist[e.v] = dist[e.u] + e.w
			}
		}
	}
	for _, e := range edges {
		if dist[e.u]+e.w < dist[e.v]-eps {
			return true
		}
	}
	return false
}

func main() {
	rate := [][]float64{
		{1.0, 0.5, 0.2},
		{2.0, 1.0, 0.5},
		{5.0, 2.0, 1.0},
	}
	fmt.Println(hasArbitrage(rate))
}
```

**Java.**

```java
public class Arbitrage {
    public boolean hasArbitrage(double[][] rate) {
        int n = rate.length;
        double[] dist = new double[n]; // all zero
        final double eps = 1e-12;
        for (int round = 0; round < n - 1; round++) {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (i == j) continue;
                    double w = -Math.log(rate[i][j]);
                    if (dist[i] + w < dist[j] - eps) dist[j] = dist[i] + w;
                }
            }
        }
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (i == j) continue;
                double w = -Math.log(rate[i][j]);
                if (dist[i] + w < dist[j] - eps) return true;
            }
        }
        return false;
    }

    public static void main(String[] args) {
        double[][] rate = {
            {1.0, 0.5, 0.2},
            {2.0, 1.0, 0.5},
            {5.0, 2.0, 1.0}
        };
        System.out.println(new Arbitrage().hasArbitrage(rate));
    }
}
```

**Python.**

```python
import math


def has_arbitrage(rate):
    n = len(rate)
    edges = [(i, j, -math.log(rate[i][j]))
             for i in range(n) for j in range(n) if i != j]
    dist = [0.0] * n                  # all zero: any currency may start
    eps = 1e-12
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] + w < dist[v] - eps:
                dist[v] = dist[u] + w
    return any(dist[u] + w < dist[v] - eps for u, v, w in edges)


if __name__ == "__main__":
    rate = [[1.0, 0.5, 0.2],
            [2.0, 1.0, 0.5],
            [5.0, 2.0, 1.0]]
    print(has_arbitrage(rate))
```

**Follow-up.** To print the trade sequence, keep `pred[]`, find the relaxing vertex in the detection pass, walk back `n` steps to enter the cycle, then collect vertices around it. Beware floating-point: for exact results, use scaled integers or rational rates instead of `-log`.

---

### Challenge 4: Shortest Path with Negative Weights and Reachability of `-∞`

**Problem.** Given a directed graph with possibly negative weights, return `dist[]` from `src`, where `dist[v]` is `-∞` if `v` is reachable from a negative cycle, `+∞` if unreachable, and the finite shortest distance otherwise.

**Example.**

```text
n = 4
edges = [[0,1,1],[1,2,-1],[2,1,-1],[1,3,5]]
1 and 2 form a negative cycle (1->2->1 = -2), and 3 is reachable from it.
dist = [0, -inf, -inf, -inf]   (0 is the source)
```

**Constraints.** `1 <= n <= 10^4`, weights fit in 32-bit signed integers.

**Key idea.** Run the standard `V-1` rounds for finite distances. Then run `V-1` more rounds; any vertex relaxed during this second phase is on or downstream of a negative cycle — mark it `-∞` and propagate.

**Go.**

```go
package main

import "fmt"

type Edge struct{ From, To, W int }

func shortestPaths(n int, edges []Edge, src int) []int {
	const INF = 1 << 60
	const NEG = -(1 << 60)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e.From] != INF && dist[e.From]+e.W < dist[e.To] {
				dist[e.To] = dist[e.From] + e.W
			}
		}
	}
	// Second phase: anything that still relaxes is -inf.
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e.From] != INF && dist[e.From]+e.W < dist[e.To] {
				dist[e.To] = NEG
			}
			if dist[e.From] == NEG && dist[e.To] != INF {
				dist[e.To] = NEG
			}
		}
	}
	return dist
}

func main() {
	edges := []Edge{{0, 1, 1}, {1, 2, -1}, {2, 1, -1}, {1, 3, 5}}
	fmt.Println(shortestPaths(4, edges, 0)) // large negatives mark -inf
}
```

**Java.**

```java
public class NegInfPaths {
    public long[] shortestPaths(int n, int[][] edges, int src) {
        final long INF = 1L << 60, NEG = -(1L << 60);
        long[] dist = new long[n];
        java.util.Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round < n - 1; round++) {
            for (int[] e : edges) {
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                }
            }
        }
        for (int round = 0; round < n - 1; round++) {
            for (int[] e : edges) {
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) dist[e[1]] = NEG;
                if (dist[e[0]] == NEG && dist[e[1]] != INF) dist[e[1]] = NEG;
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, -1}, {2, 1, -1}, {1, 3, 5}};
        System.out.println(java.util.Arrays.toString(new NegInfPaths().shortestPaths(4, edges, 0)));
    }
}
```

**Python.**

```python
def shortest_paths(n, edges, src):
    INF = float("inf")
    NEG = float("-inf")
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):                 # finite shortest paths
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    for _ in range(n - 1):                 # propagate -inf
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = NEG
            if dist[u] == NEG and dist[v] != INF:
                dist[v] = NEG
    return dist


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, -1), (2, 1, -1), (1, 3, 5)]
    print(shortest_paths(4, edges, 0))  # [0, -inf, -inf, -inf]
```

**Follow-up.** The second phase needs `V-1` rounds (not one) because the `-∞` marking must propagate downstream from the cycle along paths of up to `V-1` edges, exactly mirroring the first phase's propagation argument.

---

## Common Pitfalls in Interviews

- **Forgetting the `dist[u] != INF` guard.** Relaxing from an unreachable vertex overflows a small `INF` into a negative number that looks like a great path. This is the single most common bug.
- **Using `<=` instead of `<`.** Equal-cost "updates" keep the `changed` flag firing forever, so the algorithm never converges and early termination never fires.
- **Running `V` rounds instead of `V-1`.** Harmless to correctness but blurs the line with the detection pass; running `V-2` misses the longest shortest path.
- **Confusing "negative cycle reachable from source" with "anywhere."** Plain Bellman-Ford only sees what the source reaches; initialize all distances to 0 (a super-source) to find a cycle anywhere.
- **Reconstructing a path while a negative cycle exists.** `pred` may loop forever; guard reconstruction with the detection result.
- **Forgetting the snapshot in the K-stops variant.** Without freezing the previous round, a single round chains multiple edges and the stop count is wrong.
- **Floating-point arbitrage false positives.** Comparing `-log` values with bare `<` triggers spurious cycles; subtract an epsilon, or use scaled integers.
- **Reaching for SPFA on a judged problem.** Adversarial inputs force `O(VE)` and time out; the deterministic `O(VE)` version with early stop is the safe answer.

---

## What Interviewers Are Really Testing

A Bellman-Ford question rarely checks whether you can recite the relaxation line; it checks three deeper things. First, do you understand **why** the algorithm is correct? The `V-1` bound, the induction "after `k` rounds, all paths of `≤ k` edges are settled," and the one-extra-round detection argument are the litmus tests that separate someone who memorized the loops from someone who can derive them. Second, can you **recognize the pattern in disguise**? The cheapest-flights-within-K-stops problem, currency arbitrage, and difference constraints are all Bellman-Ford wearing a costume; spotting the reduction is the real skill. Third, can you reason about **trade-offs and failure modes**? Why not Dijkstra, why SPFA is a trap at scale, how the `INF` sentinel overflows, why a super-source matters, and how the algorithm shows up as distance-vector routing with its count-to-infinity pathology. The best answers also reflect on production realities — what to monitor (monotone metric growth, rounds-to-converge, the cycle detector), how to validate inputs, and when to fall back to a deterministic bound. Bellman-Ford is small enough that you can demonstrate all of these dimensions in a single conversation, which is exactly why interviewers like it.
