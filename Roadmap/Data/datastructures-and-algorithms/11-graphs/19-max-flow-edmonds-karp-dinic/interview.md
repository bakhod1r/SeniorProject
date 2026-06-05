# Maximum Flow (Edmonds-Karp & Dinic) — Interview Preparation

Maximum flow is a top-tier interview topic because it is *expressive*: a single algorithm models bipartite matching, disjoint paths, project selection, segmentation, and scheduling. Interviewers love it because the hard part is rarely the code — it is recognizing that a disguised problem *is* a flow problem, modeling it correctly (capacities, vertex-splitting, super-source/sink), and reasoning about the Max-Flow Min-Cut duality. This file is a curated bank of questions by seniority, plus behavioral/system-design prompts and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | Fact |
|---------|------|
| Capacity constraint | `0 ≤ f(u,v) ≤ c(u,v)` |
| Conservation | inflow = outflow for all `v ≠ s, t` |
| Residual forward | `c_f(u,v) = c(u,v) − f(u,v)` |
| Residual reverse | `c_f(v,u) = f(u,v)` (lets you cancel flow) |
| Augmenting path | `s→t` path in residual graph, all caps `> 0` |
| Bottleneck | `min` residual along the path |
| Ford-Fulkerson | *method*: augment until no path remains |
| Edmonds-Karp | FF + BFS shortest path → `O(VE²)` |
| Dinic | level graph + blocking flow → `O(V²E)`; `O(E√V)` unit-cap/bipartite |
| Max-Flow Min-Cut | max flow value = min cut capacity |
| Min-cut set `S` | vertices reachable from `s` in residual graph after termination |
| Integrality | integer caps ⇒ integer optimum |
| Reverse-edge trick | store paired; `reverse(e) = e ^ 1` |

Modeling toolbox:

```text
vertex capacity   → split v into v_in --cap--> v_out
multiple sources  → super-source S* → each source (cap ∞ or supply)
multiple sinks    → each sink → super-sink T* (cap ∞ or demand)
bipartite match   → s→left(1), left→right(1), right→t(1); maxflow = matching
edge-disjoint     → all edge caps = 1; maxflow = #paths (Menger)
vertex-disjoint   → split vertices cap 1, then edge-disjoint
project selection → s→profit(p), cost(p)→t, prereq p→q cap ∞; answer = ΣprofitsPos − mincut
```

---

## Junior Questions (12 Q&A)

### J1. What is the maximum flow problem?
Given a directed graph with non-negative edge capacities, a source `s`, and a sink `t`, find the greatest total amount of flow that can be routed from `s` to `t` such that no edge exceeds its capacity and every intermediate vertex conserves flow (inflow = outflow). The answer is a single number (the max-flow value) and an assignment of flow to edges.

### J2. What is a residual graph and why do we need it?
The residual graph captures the *remaining* capacity. For each edge `(u,v)` with flow `f` and capacity `c`, it has a forward residual edge `(u,v)` of capacity `c − f` (spare room) and a reverse residual edge `(v,u)` of capacity `f` (flow we can cancel). We need it because pushing flow on a reverse edge lets us *undo* an earlier suboptimal decision, which is what makes the greedy augmenting-path method find the global optimum.

### J3. What is an augmenting path?
A path from `s` to `t` in the residual graph where every edge has positive residual capacity. We can increase the flow by the path's bottleneck (the minimum residual along it).

### J4. What is the Ford-Fulkerson method?
A general strategy: while an augmenting path from `s` to `t` exists in the residual graph, push the bottleneck amount of flow along it; stop when no path remains. It is a *method*, not a specific algorithm, because it does not specify how to find the path.

### J5. How is Edmonds-Karp different from Ford-Fulkerson?
Edmonds-Karp is Ford-Fulkerson that always picks the *shortest* augmenting path (fewest edges), found by BFS. This choice gives a polynomial `O(VE²)` bound independent of capacities, whereas arbitrary-path Ford-Fulkerson can be exponential or even fail to terminate with irrational capacities.

### J6. What is the time complexity of Edmonds-Karp and Dinic?
Edmonds-Karp is `O(VE²)`. Dinic is `O(V²E)` in general and `O(E√V)` on unit-capacity or bipartite graphs. Both are independent of the capacity values.

### J7. Why must reverse edges start at capacity zero?
The reverse edge represents cancellable flow, and initially no flow has been pushed, so there is nothing to cancel. As you push `b` units forward on `(u,v)`, you add `b` to the reverse `(v,u)`'s residual capacity, enabling future cancellation.

### J8. What is the bottleneck of an augmenting path?
The minimum residual capacity over all edges on the path. It is the most flow you can push along that path in one augmentation.

### J9. What is a cut, and what is the min-cut?
An `s`-`t` cut partitions vertices into `S` (containing `s`) and `T` (containing `t`); its capacity is the total capacity of edges from `S` to `T`. The min-cut is the cut of smallest capacity. By Max-Flow Min-Cut, it equals the max-flow value.

### J10. How do you recover the min-cut after computing max flow?
Run BFS/DFS from `s` in the *residual* graph (over edges with positive residual capacity). The reachable set is `S`; everything else is `T`. The original edges from `S` to `T` form the min-cut, and their total capacity equals the max-flow value.

### J11. Why does the algorithm terminate with integer capacities?
Each augmentation increases the flow value by an integer bottleneck (a min of integer residuals), so the value strictly increases by at least 1 each time and is bounded by the finite max-flow value. Edmonds-Karp/Dinic give even stronger capacity-independent bounds.

### J12. Name three problems that reduce to max flow.
Bipartite matching, the number of edge-disjoint `s`-`t` paths (Menger), and project selection / maximum-weight closure. Others: image segmentation, baseball elimination, vertex-disjoint paths, and bandwidth routing.

---

## Middle Questions (12 Q&A)

### M1. Why is Edmonds-Karp `O(VE²)`?
Two facts: BFS distances from `s` in the residual graph never decrease across augmentations (monotonicity), and each edge becomes the bottleneck (critical) at most `O(V)` times, because between two saturations its distance from `s` rises by at least 2. With `O(E)` edges each critical `O(V)` times, there are `O(VE)` augmentations, each costing `O(E)` for the BFS → `O(VE²)`.

### M2. What is a level graph in Dinic's algorithm?
After a BFS from `s`, each vertex gets a level = its BFS distance. The level graph keeps only edges `(u,v)` with `level[v] = level[u] + 1`. It is a DAG containing exactly the edges that lie on *some* shortest `s`-`t` path.

### M3. What is a blocking flow?
A flow in the level graph such that every `s`-`t` path has at least one saturated edge — you cannot push more along any shortest path. Dinic computes a blocking flow per phase via DFS.

### M4. What is the current-arc optimization and why does it matter?
Each vertex keeps a pointer `it[u]` into its adjacency list. During the blocking-flow DFS, once an edge is exhausted or proven useless, the pointer advances past it and never revisits it *within the phase*. This makes each phase cost `O(VE)` instead of `O(VE²)`, giving Dinic its `O(V²E)` bound. The pointer is reset each phase.

### M5. Why is Dinic `O(E√V)` on unit-capacity / bipartite graphs?
After `O(√V)` phases the shortest `s`-`t` distance exceeds `√V`, so at most `O(√V)` augmenting paths remain (each path consumes more than `√V` vertices out of `V`). Each phase or remaining augmentation costs `O(E)`, totaling `O(E√V)`. This matches Hopcroft-Karp.

### M6. How do you model a vertex capacity?
Split the vertex `v` into `v_in` and `v_out` with an internal edge `v_in → v_out` of capacity equal to the vertex limit. Route all incoming edges to `v_in` and all outgoing edges from `v_out`. The internal edge enforces the vertex's throughput.

### M7. How do you handle multiple sources and sinks?
Add a super-source `S*` with edges to every real source (capacity ∞ or the source's supply), and a super-sink `T*` with edges from every real sink. Run max-flow from `S*` to `T*`.

### M8. How does bipartite matching reduce to max flow, and what does the answer mean?
Add `s → each left vertex` (cap 1), `each allowed pair left→right` (cap 1), `each right vertex → t` (cap 1). The integral max-flow equals the maximum matching size; the saturated `left→right` edges are the matched pairs. Integrality guarantees the flow is 0/1 on these edges.

### M9. When would you prefer push-relabel over Dinic?
On dense graphs, push-relabel (highest-label or FIFO) is often faster in practice and parallelizes better because its operations are local (push to a neighbor, relabel a vertex). Dinic's augmenting-path structure is sequential. For sparse/unit-capacity/matching, Dinic is the better default.

### M10. What goes wrong if you forget reverse edges?
You compute a *maximal* flow (no more simple augmenting path) that may be strictly less than the *maximum*, because you cannot reroute earlier commitments. This is the single most common max-flow bug.

### M11. What is capacity scaling and when do you use it?
Process capacities from high bit to low: maintain a threshold `Δ` (a power of two) and only use residual edges with capacity `≥ Δ`, running Dinic, then halving `Δ`. It bounds the work by `O(VE log U)`, useful when capacities `U` are astronomically large but the graph is small.

### M12. How is project selection / max-weight closure solved with min-cut?
Connect `s` to each profitable project (cap = profit) and each costly project to `t` (cap = cost), with prerequisite edges `p → q` of capacity ∞. The maximum profit = (sum of all positive profits) − (min cut). Infinite prerequisite edges force any cut to respect dependencies.

---

## Senior Questions (10 Q&A)

### S1. How do you scale max flow beyond one machine?
First prune aggressively (reachability trim, chain contraction, zero-cap removal) — the relevant core is usually orders of magnitude smaller. If it still does not fit, use parallel push-relabel (local operations parallelize on multi-core/GPU) for exact flow, graph partitioning for segmentation-style locality, or LP/`(1±ε)`-approximate flow when exactness is not required.

### S2. Can you parallelize a single Dinic run?
Not easily. Augmenting-path methods are sequential: each augmentation depends on the residual left by the last, and the blocking-flow DFS mutates shared capacities. Parallelism comes from running *independent instances* concurrently, or from switching the whole algorithm to push-relabel, whose preflow model was designed for parallelism.

### S3. How do you keep a flow-based assignment fresh as the graph changes?
Either recompute on a consistent snapshot periodically, or warm-start: on a capacity *increase* the old flow stays feasible and you just look for new augmenting paths; on a *decrease below current usage* you cancel the excess along reverse edges, then re-augment. Guard incremental state with a periodic full recompute.

### S4. What observability signals matter for a flow service?
The saturation ratio `flow / demand` (the headline SLI), the min-cut capacity and its binding edges (the actionable bottleneck), augmentations/phases per run (anomaly detection), solve latency p99, and post-prune graph size. Log the binding cut every run — it answers "why isn't more being scheduled?".

### S5. How do you bound a flow computation in a request path?
Wrap it with a deadline checked between BFS phases (a consistent state). On timeout, return the partial flow accumulated so far, or fall back to the previous assignment or a fast greedy matching. Never let an adversarial graph block a request indefinitely.

### S6. What is the difference between max flow and min-cost max flow?
Max flow maximizes quantity. Min-cost max flow adds a per-unit cost on each edge and finds the maximum flow of minimum total cost (reverse edges carry negated cost). It augments along *cheapest* paths (Bellman-Ford/SPFA, or Johnson potentials + Dijkstra) instead of shortest-by-edges. Optimality criterion: no negative-cost cycle in the residual graph.

### S7. How do you stabilize assignments across recomputes?
Among equal-value optima, bias toward the previous assignment (warm-start or lexicographic tie-break). Otherwise tiny supply/demand changes cause large churn in matches, which destabilizes downstream consumers.

### S8. What are the main failure modes of a production flow system?
Stale snapshots (assignment references vanished supply), graph blow-up (OOM), adversarial graphs (latency explosion), modeling bugs (missing reverse edge → systematic under-counting), assignment thrash, and integer overflow in residuals.

### S9. Why is the min-cut often more useful than the flow value in production?
The cut identifies the *binding constraints* — the exact edges/vertices limiting throughput. For capacity planning, traffic engineering, and quota systems, the actionable output is "provision these specific links/quotas," which is precisely the cut, not the scalar flow value.

### S10. How do you test a max-flow implementation?
Test the CLRS network (answer 23), a direct `s→t` edge, and disconnected `s`/`t` (answer 0). Cross-check Dinic against Edmonds-Karp on random small graphs. Verify the min-cut capacity equals the flow value. Keep a worst-case layered fixture to guard latency.

---

## Professional / Theory Questions (8 Q&A)

### P1. State and prove the Max-Flow Min-Cut theorem.
The following are equivalent: (1) `f` is maximum; (2) no augmenting path in `G_f`; (3) `|f| = c(S,T)` for some cut. `(1)⇒(2)`: an augmenting path would raise the value. `(2)⇒(3)`: let `S` = vertices reachable from `s` in `G_f`; every forward edge from `S` to `T` is saturated and no flow returns, so `f(S,T) = c(S,T) = |f|`. `(3)⇒(1)`: weak duality (`|f| ≤ c(S,T)` for all cuts) makes any flow attaining a cut capacity maximum. Hence max-flow = min-cut.

### P2. Why is the BFS distance monotone in Edmonds-Karp?
Suppose an augmentation decreased `δ(s,v)` for some `v`; take the closest such `v`. Its predecessor `u` on the new shortest path either had an edge in the old residual graph (giving a contradiction by the triangle inequality) or the edge `(u,v)` was newly created by pushing on `(v,u)`, which (since paths are shortest) forces `δ_new(s,v) = δ_old(s,v) + 2`, also a contradiction. Hence distances never decrease.

### P3. Prove Dinic runs in `O(V²E)`.
Each phase's blocking flow strictly increases the shortest `s`-`t` distance (a blocking flow saturates every shortest path, and reverse edges cannot create a shorter one). Distances range over `1..V−1`, so there are `O(V)` phases. Each blocking flow costs `O(VE)` with the current-arc optimization (each edge retreated past once, each augmentation `O(V)` path work, `≤ E` augmentations). Total `O(V) · O(VE) = O(V²E)`.

### P4. State the integrality theorem and its significance.
If all capacities are integers, there is a maximum flow that is integer-valued, and the standard algorithms produce it (each bottleneck is a min of integers). Significance: it lets flow model discrete problems *exactly* — bipartite matching, disjoint paths — because the optimum is guaranteed to be a 0/integer assignment, not a fractional one.

### P5. What is flow decomposition?
Any flow decomposes into at most `E` simple `s`-`t` paths plus at most `E` cycles whose flows sum to `f`. It bridges the numeric flow and the combinatorial paths (e.g., extracting actual routes or matched pairs) and underpins the `O(√V)`-paths argument for unit-capacity Dinic.

### P6. Why can arbitrary-path Ford-Fulkerson fail to terminate?
With irrational capacities, a pathological choice of augmenting paths can push ever-smaller amounts that converge to a value strictly below the true max-flow, never terminating (Ford & Fulkerson's golden-ratio counterexample). BFS (Edmonds-Karp) and Dinic avoid this because their bounds depend only on `V` and `E`, not on capacity values.

### P7. What is the significance of the Chen et al. 2022 result?
It gives the first almost-linear-time `m^{1+o(1)}` algorithm for max-flow and min-cost flow on graphs with polynomially-bounded integer capacities, via interior-point methods with a dynamic min-ratio-cycle data structure. It essentially closes the long-standing asymptotic gap (the trivial lower bound is `Ω(E)`), though it is not yet practical.

### P8. How does Menger's theorem follow from Max-Flow Min-Cut?
Set all edge capacities to 1. The integral max-flow `k` decomposes into `k` edge-disjoint `s`-`t` paths, and by Max-Flow Min-Cut `k` equals the minimum number of edges separating `s` from `t`. The vertex-disjoint version follows after splitting each vertex into an `in→out` edge of capacity 1.

---

## Behavioral / System-Design Questions (5)

### B1. Describe a time you chose a simpler approach over a "correct" but heavy one.
Strong answer: recognizing that a matching problem could be solved with a greedy heuristic at 99% quality in 1 ms versus exact min-cost flow at 50 ms, and choosing the heuristic for a latency-critical path while keeping exact flow for the nightly batch. Shows judgment about when optimality is worth its cost.

### B2. Design a ride/rider matching service.
Discuss: bipartite graph per round (riders × eligible drivers), unit capacities, snapshot pinning at round start, Dinic for plain matching or min-cost flow if minimizing ETA, stability across rounds (warm-start), deadline + fallback, and observability (saturation ratio, binding cut). Mention scaling by region shards run in parallel.

### B3. Design a quota/fair-share allocation system.
Model demands and capacities as a flow with lower bounds (minimum guaranteed allocation), use super-source/sink, recover the min-cut to identify binding quotas, and expose the cut as the provisioning signal. Discuss feasibility checking (does a flow satisfy all lower bounds?) and periodic recompute vs incremental.

### B4. How would you debug "the scheduler isn't placing enough jobs"?
Pull the logged binding min-cut from the last run — it names the limiting edges/vertices directly. Check the saturation ratio trend, verify no modeling regression (missing reverse edge causing under-counting), and confirm the graph snapshot matches reality. The cut almost always *is* the answer.

### B5. Trade-offs: exact flow vs approximate at scale?
If a downstream consumer commits the assignment as a contract (a match, a placement), you need exact integral flow. If it feeds a self-correcting control loop (admission control, provisioning), a `(1±ε)`-approximate flow is acceptable and may be the only tractable option at 10⁹ edges. State the rule and the consequence of getting it wrong.

---

## Coding Challenges

### Challenge 1 — Maximum Bipartite Matching via Flow

**Problem.** Given a bipartite graph with `L` left nodes, `R` right nodes, and a list of allowed pairs, return the maximum matching size.

#### Go

```go
package main

import "fmt"

type Dinic struct {
	n         int
	to, cap   []int
	head      [][]int
	level, it []int
}

func NewDinic(n int) *Dinic { return &Dinic{n: n, head: make([][]int, n)} }
func (d *Dinic) AddEdge(u, v, c int) {
	d.head[u] = append(d.head[u], len(d.to)); d.to = append(d.to, v); d.cap = append(d.cap, c)
	d.head[v] = append(d.head[v], len(d.to)); d.to = append(d.to, u); d.cap = append(d.cap, 0)
}
func (d *Dinic) bfs(s, t int) bool {
	d.level = make([]int, d.n)
	for i := range d.level { d.level[i] = -1 }
	d.level[s] = 0
	q := []int{s}
	for len(q) > 0 {
		u := q[0]; q = q[1:]
		for _, e := range d.head[u] {
			if d.cap[e] > 0 && d.level[d.to[e]] < 0 {
				d.level[d.to[e]] = d.level[u] + 1; q = append(q, d.to[e])
			}
		}
	}
	return d.level[t] >= 0
}
func (d *Dinic) dfs(u, t, f int) int {
	if u == t { return f }
	for ; d.it[u] < len(d.head[u]); d.it[u]++ {
		e := d.head[u][d.it[u]]; v := d.to[e]
		if d.cap[e] > 0 && d.level[v] == d.level[u]+1 {
			if p := d.dfs(v, t, min(f, d.cap[e])); p > 0 {
				d.cap[e] -= p; d.cap[e^1] += p; return p
			}
		}
	}
	return 0
}
func (d *Dinic) MaxFlow(s, t int) int {
	flow := 0
	for d.bfs(s, t) {
		d.it = make([]int, d.n)
		for { f := d.dfs(s, t, 1<<60); if f == 0 { break }; flow += f }
	}
	return flow
}
func min(a, b int) int { if a < b { return a }; return b }

func main() {
	L, R := 3, 3
	pairs := [][2]int{{0, 0}, {0, 1}, {1, 1}, {2, 2}}
	s, t := L+R, L+R+1
	d := NewDinic(L + R + 2)
	for i := 0; i < L; i++ { d.AddEdge(s, i, 1) }
	for j := 0; j < R; j++ { d.AddEdge(L+j, t, 1) }
	for _, p := range pairs { d.AddEdge(p[0], L+p[1], 1) }
	fmt.Println(d.MaxFlow(s, t)) // 3
}
```

#### Java

```java
import java.util.*;

public class Matching {
    int n; int[] to, cap; List<List<Integer>> head; int[] level, it; int cnt;
    Matching(int n, int m) {
        this.n = n; to = new int[2*m]; cap = new int[2*m];
        head = new ArrayList<>(); for (int i=0;i<n;i++) head.add(new ArrayList<>());
    }
    void addEdge(int u,int v,int c){ head.get(u).add(cnt);to[cnt]=v;cap[cnt++]=c;
        head.get(v).add(cnt);to[cnt]=u;cap[cnt++]=0; }
    boolean bfs(int s,int t){ level=new int[n];Arrays.fill(level,-1);level[s]=0;
        Deque<Integer> q=new ArrayDeque<>();q.add(s);
        while(!q.isEmpty()){int u=q.poll();for(int e:head.get(u))
            if(cap[e]>0&&level[to[e]]<0){level[to[e]]=level[u]+1;q.add(to[e]);}}
        return level[t]>=0; }
    int dfs(int u,int t,int f){ if(u==t)return f;
        for(;it[u]<head.get(u).size();it[u]++){int e=head.get(u).get(it[u]),v=to[e];
            if(cap[e]>0&&level[v]==level[u]+1){int p=dfs(v,t,Math.min(f,cap[e]));
                if(p>0){cap[e]-=p;cap[e^1]+=p;return p;}}}
        return 0; }
    int maxFlow(int s,int t){int flow=0;while(bfs(s,t)){it=new int[n];int f;
        while((f=dfs(s,t,Integer.MAX_VALUE))>0)flow+=f;}return flow;}
    public static void main(String[] a){
        int L=3,R=3,s=L+R,t=L+R+1;
        Matching d=new Matching(L+R+2,4+L+R);
        for(int i=0;i<L;i++)d.addEdge(s,i,1);
        for(int j=0;j<R;j++)d.addEdge(L+j,t,1);
        int[][] pairs={{0,0},{0,1},{1,1},{2,2}};
        for(int[] p:pairs)d.addEdge(p[0],L+p[1],1);
        System.out.println(d.maxFlow(s,t)); // 3
    }
}
```

#### Python

```python
from collections import deque


class Dinic:
    def __init__(self, n):
        self.n = n; self.to = []; self.cap = []; self.head = [[] for _ in range(n)]
    def add_edge(self, u, v, c):
        self.head[u].append(len(self.to)); self.to.append(v); self.cap.append(c)
        self.head[v].append(len(self.to)); self.to.append(u); self.cap.append(0)
    def bfs(self, s, t):
        self.level = [-1]*self.n; self.level[s] = 0; q = deque([s])
        while q:
            u = q.popleft()
            for e in self.head[u]:
                if self.cap[e] > 0 and self.level[self.to[e]] < 0:
                    self.level[self.to[e]] = self.level[u]+1; q.append(self.to[e])
        return self.level[t] >= 0
    def dfs(self, u, t, f):
        if u == t: return f
        while self.it[u] < len(self.head[u]):
            e = self.head[u][self.it[u]]; v = self.to[e]
            if self.cap[e] > 0 and self.level[v] == self.level[u]+1:
                p = self.dfs(v, t, min(f, self.cap[e]))
                if p > 0:
                    self.cap[e] -= p; self.cap[e^1] += p; return p
            self.it[u] += 1
        return 0
    def max_flow(self, s, t):
        flow = 0
        while self.bfs(s, t):
            self.it = [0]*self.n
            while (f := self.dfs(s, t, float("inf"))):
                flow += f
        return flow


def max_matching(L, R, pairs):
    s, t = L + R, L + R + 1
    d = Dinic(L + R + 2)
    for i in range(L): d.add_edge(s, i, 1)
    for j in range(R): d.add_edge(L + j, t, 1)
    for u, v in pairs: d.add_edge(u, L + v, 1)
    return d.max_flow(s, t)


print(max_matching(3, 3, [(0, 0), (0, 1), (1, 1), (2, 2)]))  # 3
```

### Challenge 2 — Minimum Cut Partition

**Problem.** After computing max flow, output the set `S` of vertices on the source side of the min-cut, and the cut edges. Run a search from `s` over positive-residual edges; reachable vertices are `S`.

#### Go

```go
func (d *Dinic) MinCutSide(s int) []bool {
	seen := make([]bool, d.n)
	stack := []int{s}
	seen[s] = true
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, e := range d.head[u] {
			if d.cap[e] > 0 && !seen[d.to[e]] {
				seen[d.to[e]] = true
				stack = append(stack, d.to[e])
			}
		}
	}
	return seen // seen[v] == true  <=>  v in S
}
```

#### Java

```java
boolean[] minCutSide(int s) {
    boolean[] seen = new boolean[n];
    Deque<Integer> stack = new ArrayDeque<>();
    stack.push(s); seen[s] = true;
    while (!stack.isEmpty()) {
        int u = stack.pop();
        for (int e : head.get(u))
            if (cap[e] > 0 && !seen[to[e]]) { seen[to[e]] = true; stack.push(to[e]); }
    }
    return seen; // seen[v] == true  <=>  v in S
}
```

#### Python

```python
def min_cut_side(dinic, s):
    seen = [False] * dinic.n
    stack = [s]; seen[s] = True
    while stack:
        u = stack.pop()
        for e in dinic.head[u]:
            if dinic.cap[e] > 0 and not seen[dinic.to[e]]:
                seen[dinic.to[e]] = True; stack.append(dinic.to[e])
    return [v for v in range(dinic.n) if seen[v]]
```

**Key point.** This must run *after* `max_flow`, on the *residual* graph (`cap[e] > 0`), not the original graph. The reachable set is the source side; the cut edges are the original edges from a reachable to a non-reachable vertex, and their total capacity equals the max-flow value.

### Challenge 3 — Maximum Edge-Disjoint Paths

**Problem.** Return the maximum number of edge-disjoint `s`-`t` paths in a directed graph. By Menger, set every edge capacity to 1 and compute max flow. The integral max-flow equals the path count, and flow decomposition recovers the actual paths.

#### Go

```go
func edgeDisjointPaths(n int, edges [][2]int, s, t int) int {
	d := NewDinic(n)
	for _, e := range edges {
		d.AddEdge(e[0], e[1], 1) // unit capacity per edge
	}
	return d.MaxFlow(s, t)
}

// edgeDisjointPaths(4, [][2]int{{0,1},{1,3},{0,2},{2,3}}, 0, 3) == 2
```

#### Java

```java
int edgeDisjointPaths(int n, int[][] edges, int s, int t) {
    Matching d = new Matching(n, edges.length);
    for (int[] e : edges) d.addEdge(e[0], e[1], 1); // unit capacity
    return d.maxFlow(s, t);
}
// edgeDisjointPaths(4, new int[][]{{0,1},{1,3},{0,2},{2,3}}, 0, 3) == 2
```

#### Python

```python
def edge_disjoint_paths(n, edges, s, t):
    d = Dinic(n)
    for u, v in edges:
        d.add_edge(u, v, 1)   # unit capacity per edge
    return d.max_flow(s, t)


# Two edge-disjoint paths s->1->3 and s->2->3
print(edge_disjoint_paths(4, [(0,1),(1,3),(0,2),(2,3)], 0, 3))  # 2
```

**Why capacity 1?** A unit capacity on each edge means each edge can be used by at most one of the chosen paths, which is exactly edge-disjointness. For *vertex*-disjoint paths, additionally split each internal vertex into `in→out` with capacity 1 (see Challenge 4's vertex-splitting), then the same construction counts vertex-disjoint paths.

### Challenge 4 — Escape Problem / Grid Flow

**Problem.** Given an `n×n` grid where some cells are start points, can you route all starts to the border using vertex-disjoint paths (each non-start cell used by at most one path)? Model: split every cell into `in→out` with capacity 1 (vertex capacity), connect adjacent cells with capacity-1 edges, a super-source to all start `in`-nodes, and all border `out`-nodes to a super-sink. The escape is possible iff max-flow equals the number of starts.

#### Python

```python
def can_escape(n, starts):
    # cell (r,c): in = 2*(r*n+c), out = in+1
    S, T = 2 * n * n, 2 * n * n + 1
    d = Dinic(2 * n * n + 2)
    cid = lambda r, c: r * n + c
    for r in range(n):
        for c in range(n):
            d.add_edge(2*cid(r,c), 2*cid(r,c)+1, 1)  # vertex capacity 1
            for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
                nr, nc = r+dr, c+dc
                if 0 <= nr < n and 0 <= nc < n:
                    d.add_edge(2*cid(r,c)+1, 2*cid(nr,nc), 1)
            if r in (0, n-1) or c in (0, n-1):
                d.add_edge(2*cid(r,c)+1, T, 1)        # border -> sink
    for (r, c) in starts:
        d.add_edge(S, 2*cid(r,c), 1)                  # source -> start cell
    return d.max_flow(S, T) == len(starts)


print(can_escape(3, [(1, 1)]))  # True — center can escape
```

(Go and Java mirror the same vertex-splitting construction; only the Dinic boilerplate differs.)

---

## Common Pitfalls

1. **Forgetting reverse edges** — yields a maximal but not maximum flow. The #1 bug.
2. **Reverse edge with nonzero initial capacity** — must start at 0.
3. **Not resetting `it[]` per Dinic phase** — DFS skips valid edges; flow too small.
4. **Computing the min-cut on the original graph** — must use the residual graph after termination.
5. **Using arbitrary-path DFS** — risks exponential time / non-termination; use BFS or Dinic.
6. **Modeling vertex capacities as edge capacities directly** — must split the vertex.
7. **Recursion depth in Python Dinic** — raise the limit or use an explicit stack on deep level graphs.
8. **Integer overflow** in the bottleneck sentinel — use a safe large `INF`.

---

## What Interviewers Are Really Testing

- **Recognition.** Can you see that a matching, scheduling, or partition problem *is* a flow problem? This is 80% of the difficulty.
- **Modeling correctness.** Do you split vertices for vertex capacities, add super-source/sink for multiple terminals, and set unit capacities for matching/disjoint-paths?
- **Duality fluency.** Do you understand that max-flow = min-cut, and can you produce and *use* the cut?
- **Implementation discipline.** Reverse edges via the paired-edge trick, current-arc optimization, residual-graph min-cut recovery — do you write these without bugs?
- **Judgment.** Do you pick Dinic vs Edmonds-Karp vs push-relabel sensibly, bound the run with a deadline, and know when an approximation or a cheaper matcher suffices?

A candidate who memorized "Dinic = BFS + DFS" but cannot model bipartite matching or recover a cut will not pass; one who reasons cleanly from the flow/cut duality and models the disguised problem correctly will.

> **Final tip.** When stuck on a problem that smells like flow, ask three questions: *What is the resource being routed? What are the capacities? What does the cut mean?* If you can answer those, the reduction usually writes itself — and stating the min-cut interpretation out loud signals real understanding to the interviewer.
