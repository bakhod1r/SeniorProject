# Min-Cost Max-Flow — Interview Preparation

> **One-line summary:** Everything you need to walk into an interview on Min-Cost Max-Flow: a quick-reference cheat sheet, 42 graded Q&A (12 junior, 12 middle, 10 senior, 8 professional), 5 behavioral / system-design prompts, and 3–4 full coding challenges (assignment problem, transportation, min-cost flow of value k, min-cost to connect) in Go, Java, and Python.

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (12 Q&A)](#middle-questions-12-qa)
4. [Senior Questions (10 Q&A)](#senior-questions-10-qa)
5. [Professional Questions (8 Q&A)](#professional-questions-8-qa)
6. [Behavioral / System-Design Questions (5)](#behavioral--system-design-questions-5)
7. [Coding Challenges](#coding-challenges)
8. [Common Pitfalls in Interviews](#common-pitfalls-in-interviews)
9. [What Interviewers Are Really Testing](#what-interviewers-are-really-testing)

---

## Quick-Reference Cheat Sheet

| Item | Value |
|------|-------|
| **Problem** | Among all max flows `s→t`, find the one of minimum total cost (or min-cost flow of a target value `k`). |
| **Edge data** | `(capacity, cost-per-unit)`. |
| **Reverse edge** | `cap = 0`, `cost = −cost`, paired at index `e ^ 1`. |
| **Core algorithm** | Successive Shortest Paths (SSP): repeatedly augment along the **cheapest** `s→t` residual path. |
| **Shortest-path engine** | Bellman-Ford / SPFA (handles negatives), or Dijkstra + potentials (fast). |
| **Potential / reduced cost** | `c'(u,v) = c(u,v) + h[u] − h[v]`; keeps Dijkstra valid (`c' ≥ 0`). |
| **Potential update** | `h[v] += dist[v]` each iteration. |
| **SSP-BF complexity** | `O(V · E · F)`. |
| **SSP-Dijkstra complexity** | `O(F · (E + V log V))`. |
| **Optimality criterion** | A flow is min-cost iff its residual graph has **no negative-cost cycle**. |
| **Cycle-canceling** | Start from any max flow; cancel negative cycles until none remain. |
| **Assignment problem** | s→workers (cap1), workers→jobs (cap1, cost `a[i][j]`), jobs→t (cap1); MCMF gives min-cost perfect matching. |
| **Hungarian** | `O(n³)` specialization of SSP+potentials for assignment. |
| **Negative edges** | Init potentials with one Bellman-Ford pass. |
| **Value `k`** | Cap each push at `k − flow`; stop at `flow == k`. |
| **Cost recovery (potentials)** | real path cost = `h[t] − h[s]` after update. |

**One-liner pseudocode:**
```
while cheapest s→t path exists:
    f = bottleneck; apply f (cap[e]-=f, cap[e^1]+=f)
    total_flow += f; total_cost += f * pathCost
```

---

## Junior Questions (12 Q&A)

**Q1. What does Min-Cost Max-Flow compute?**
A. Among all maximum flows from `s` to `t`, the one with the **smallest total cost**, where each edge has a capacity and a per-unit cost. It answers "push the most, as cheaply as possible."

**Q2. How is MCMF different from plain max-flow?**
A. Plain max-flow finds *any* maximum flow (cost irrelevant). MCMF finds the *cheapest* maximum flow. Each edge carries two numbers (cap + cost) instead of one.

**Q3. What is the cost of an edge in MCMF?**
A. The **price paid per unit of flow** sent along it. If you send `f` units on an edge with cost `c`, you pay `f · c`.

**Q4. What is the total cost being minimized?**
A. `Σ f(e) · c(e)` summed over all edges.

**Q5. What is the Successive Shortest Paths algorithm in one sentence?**
A. Repeatedly find the **cheapest** `s→t` path in the residual graph and push as much flow as possible along it, until no path remains.

**Q6. Why does the reverse edge have negated cost?**
A. Pushing flow on the reverse edge *undoes* one unit on the forward edge, so it should *refund* the cost — adding `−c`. This lets the algorithm reroute flow more cheaply later.

**Q7. Why can't we always use plain Dijkstra for the cheapest path?**
A. The residual graph can have **negative-cost reverse edges**, and Dijkstra requires non-negative weights. Use Bellman-Ford/SPFA, or Dijkstra with potentials.

**Q8. What is the bottleneck of an augmenting path?**
A. The **minimum residual capacity** along the path — the most flow you can push through it in one augmentation.

**Q9. How do you update total cost after pushing `f` along a path of cost `d`?**
A. `total_cost += f * d`.

**Q10. How do you solve min-cost flow of exactly `k` units?**
A. Run SSP but cap each push at `k − flow` and stop when `flow == k`.

**Q11. Give a real-world example of MCMF.**
A. Shipping goods from warehouses to stores: each road has a truck-capacity and a toll/fuel cost; MCMF finds the maximum throughput at minimum total cost. Also: assigning workers to jobs at minimum cost.

**Q12. What is the time complexity of SSP with Bellman-Ford?**
A. `O(V · E · F)` where `F` is the max-flow value: at most `F` augmentations, each a `O(V·E)` shortest-path computation.

---

## Middle Questions (12 Q&A)

**Q1. What is a reduced cost?**
A. For potentials `h`, `c'(u,v) = c(u,v) + h[u] − h[v]`. With good potentials it is always `≥ 0`, so Dijkstra works.

**Q2. Why does minimizing reduced cost minimize real cost?**
A. Along any `s→t` path the reduced length equals the real length plus the constant `h[s] − h[t]`. The constant is identical for all paths, so the orderings coincide.

**Q3. How do you initialize potentials?**
A. If all costs are non-negative, `h = 0`. If negative edges exist, run **one Bellman-Ford pass** computing shortest distances from `s`; those distances are valid potentials.

**Q4. How are potentials maintained after each augmentation?**
A. `h[v] += dist[v]` for each reachable vertex, where `dist` is the reduced-cost shortest distance from Dijkstra.

**Q5. Why does `h[v] += dist[v]` keep reduced costs non-negative?**
A. Dijkstra guarantees `dist[v] ≤ dist[u] + c'(u,v)`, which after the update gives `c'_{new}(u,v) ≥ 0`. New reverse edges come from tight (zero-reduced-cost) edges, so their reverse is also `0 ≥ 0`.

**Q6. Compare SSP-BF vs SSP-Dijkstra+potentials.**
A. Same answer; BF tolerates negatives but is `O(V·E)` per iteration; Dijkstra+potentials is `O(E log V)` per iteration but needs a BF init when negatives exist.

**Q7. What is cycle-canceling?**
A. Compute *any* max flow, then repeatedly find and cancel **negative-cost cycles** in the residual graph; when none remain, the flow is min-cost.

**Q8. State the optimality criterion for min-cost flow.**
A. A flow of value `y` is min-cost iff its residual graph contains **no negative-cost cycle**.

**Q9. How do you model the assignment problem as MCMF?**
A. s→each worker (cap 1, cost 0); each worker→each job (cap 1, cost `a[i][j]`); each job→t (cap 1, cost 0). MCMF value `n` = perfect matching; cost = optimal assignment cost.

**Q10. What's the complexity of SSP+potentials for assignment?**
A. `F = n`, edges `O(n²)`, so `O(n · n² · log n) = O(n³ log n)`; Hungarian removes the log: `O(n³)`.

**Q11. Why prefer SPFA over textbook Bellman-Ford?**
A. SPFA (queue-based) only re-processes vertices whose distance changed, so it is far faster on typical graphs (same worst case).

**Q12. After updating potentials, what is the real cost of the augmenting path?**
A. `h[t] − h[s]` (with `h[s]` usually 0), so you add `push * (h[t] − h[s])` to total cost.

---

## Senior Questions (10 Q&A)

**Q1. How would you architect an MCMF-backed matching service?**
A. Builder (domain → graph) → pure deterministic Solver (SSP+potentials) → Decoder (read edge flows → decisions) → Action layer. Keep the solver pure/in-process; treat cost as tunable policy; prune edges at the builder.

**Q2. MCMF doesn't parallelize well — why, and what do you do?**
A. SSP is sequential (each augmentation depends on the prior residual graph). Parallelize *around* it: parallel cost-matrix construction, parallel independent shard solves, pipeline stages. For exact parallel flow, use auction or cost-scaling, not parallel SSP.

**Q3. How do you scale MCMF to web scale (e.g., ride matching)?**
A. **Geographic/temporal sharding** — solve weakly-coupled regions independently; near-optimal because cross-region edges are rare/expensive. Offload to an LP solver only when side constraints exceed pure flow.

**Q4. How do you handle infeasibility (demand > supply)?**
A. Model unmet demand explicitly with a high-cost dummy edge so the solve always completes; then observe the shortfall rather than crashing.

**Q5. What is warm-starting and when does it help?**
A. Persist the previous flow and potentials; on a small input delta, re-route only affected paths instead of solving cold. 10–100× faster for high-frequency incremental updates.

**Q6. What observability would you add?**
A. Augmentation count, per-phase latency, `|V|/|E|` after pruning, requested vs achieved flow, per-edge cost breakdown (explainability/audit), objective over time.

**Q7. How do you guarantee bounded latency under load?**
A. Always return *something* within budget: exact solve when possible, otherwise greedy fallback; shard; cap graph size; warm-start.

**Q8. When would you NOT use hand-rolled MCMF?**
A. When the model has side constraints breaking pure flow, or instances are huge — offload to a tuned LP/MIP solver (HiGHS, OR-Tools, Gurobi) with parallel barrier/simplex.

**Q9. How do you ensure deterministic, auditable results?**
A. Stable edge ordering for tie-breaking, pure solver function, versioned cost policy, logged per-edge flow assignments.

**Q10. How do you capacity-plan solver workers?**
A. Solves are independent: `workers = ⌈Q · T / 1000⌉` for `Q` solves/sec at `T` ms each; size for p99 graph size (bursty), keep ~2× headroom; sharding multiplies throughput.

---

## Professional Questions (8 Q&A)

**Q1. Prove that augmenting along the cheapest path preserves min-cost optimality.**
A. With potentials = shortest distances in `G_f`, every residual edge has reduced cost `≥ 0`. Augmenting saturates tight (zero-reduced-cost) edges and creates reverse edges also of reduced cost 0. So `G_{f'}` has all reduced costs `≥ 0`, hence every cycle has real cost `≥ 0` (telescoping), so no negative cycle — which by the optimality criterion means `f'` is min-cost.

**Q2. State and prove the optimality criterion.**
A. A flow is min-cost iff no negative residual cycle. (⇒) A negative cycle could be canceled to lower cost at the same value, contradiction. (⇐) For any same-value flow `f*`, `f* − f` is a circulation = sum of residual cycles, all `≥ 0` cost, so `cost(f*) ≥ cost(f)`.

**Q3. Why exactly does `h[v] += dist[v]` preserve `c' ≥ 0`?**
A. `c'_{new}(u,v) = c'_{old}(u,v) + dist[u] − dist[v] ≥ 0` because Dijkstra gives `dist[v] ≤ dist[u] + c'_{old}(u,v)`. Created reverse edges come from tight edges (`c'=0`), so they are 0.

**Q4. What is the relationship between MCMF and LP duality?**
A. The potentials are the **dual variables** (node prices). Reduced cost = 0 is **complementary slackness**: an edge carries flow only if its reduced cost is zero. Optimality = primal flow + dual potentials satisfying complementary slackness.

**Q5. How does Hungarian relate to SSP?**
A. Hungarian is SSP+potentials specialized to the complete bipartite assignment graph; potentials are the row/column labels, tight edges form the equality subgraph, and each phase is one shortest-augmenting-path step. `O(n³)`.

**Q6. Why is min-cost flow integral when inputs are integral?**
A. The constraint matrix is **totally unimodular**, so basic feasible LP solutions are integral; SSP with integer caps also produces integer flow directly.

**Q7. What is the convexity property of `Φ(x)` and why does it matter?**
A. `Φ(x)` = min cost of a flow of value `x` is convex piecewise-linear; equivalently successive shortest-path costs are non-decreasing. It justifies early stopping for value-`k` and explains SSP's correctness via marginal costs.

**Q8. What is the best known asymptotic complexity for min-cost flow?**
A. It is strongly polynomial (Orlin); recent work (Chen et al. 2022) achieves **almost-linear `m^{1+o(1)}`** time via interior-point methods + dynamic data structures. SSP+potentials and network simplex dominate in practice.

---

## Behavioral / System-Design Questions (5)

**B1. Describe a time you chose a non-obvious algorithm to solve a business problem.**
A. Frame it: a problem stated as "assign X to Y minimizing cost" that you recognized as min-cost matching; explain the reduction, why greedy was insufficient (no global optimum), and the measurable improvement in total cost.

**B2. Design a driver–rider matching system.**
A. Batch loop every few seconds; build a bipartite-ish graph (drivers↔riders within radius), cost = ETA + fairness penalty, cap 1; solve MCMF per geographic shard; decode assignments; fall back to greedy on timeout. Discuss latency SLA vs batch-size trade-off.

**B3. How would you explain to a non-technical stakeholder why one assignment was chosen over another?**
A. Use the per-edge cost breakdown audit log: "this pairing cost 3 less in total ETA across all riders, even though one individual rider waited slightly longer." Emphasize the *global* objective.

**B4. A teammate proposes greedy matching to cut latency. How do you respond?**
A. Acknowledge the latency win; quantify the optimality loss with a shadow comparison; propose a hybrid — exact MCMF within budget, greedy fallback only on timeout — so you keep quality when you can afford it.

**B5. Your MCMF service occasionally times out at peak. Walk through your response.**
A. First ensure graceful degradation (greedy fallback). Then diagnose: graph size blowup? Add edge pruning. Sequential solve too slow? Shard geographically and warm-start. Add alerts on `|E|` and p99 latency. Capacity-plan for p99, not average.

---

## Coding Challenges

### Challenge 1: Assignment Problem (min-cost perfect matching)

**Problem.** Given an `n×n` cost matrix, assign each worker to a distinct job minimizing total cost. Return the minimum cost.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type MCMF struct {
	n             int
	to, cap, cost []int
	head          [][]int
}

func New(n int) *MCMF { return &MCMF{n: n, head: make([][]int, n)} }
func (g *MCMF) Add(u, v, c, w int) {
	g.head[u] = append(g.head[u], len(g.to)); g.to = append(g.to, v); g.cap = append(g.cap, c); g.cost = append(g.cost, w)
	g.head[v] = append(g.head[v], len(g.to)); g.to = append(g.to, u); g.cap = append(g.cap, 0); g.cost = append(g.cost, -w)
}

type it struct{ d, v int }
type pq []it
func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(it)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); e := o[n-1]; *p = o[:n-1]; return e }

func (g *MCMF) Run(s, t int) (int, int) {
	h := make([]int, g.n)
	flow, cost := 0, 0
	for {
		dist := make([]int, g.n)
		pe := make([]int, g.n)
		for i := range dist {
			dist[i] = INF; pe[i] = -1
		}
		dist[s] = 0
		q := &pq{{0, s}}
		for q.Len() > 0 {
			c := heap.Pop(q).(it)
			if c.d > dist[c.v] {
				continue
			}
			for _, e := range g.head[c.v] {
				v := g.to[e]
				if g.cap[e] > 0 {
					nd := dist[c.v] + g.cost[e] + h[c.v] - h[v]
					if nd < dist[v] {
						dist[v] = nd; pe[v] = e; heap.Push(q, it{nd, v})
					}
				}
			}
		}
		if dist[t] == INF {
			break
		}
		for i := range h {
			if dist[i] < INF {
				h[i] += dist[i]
			}
		}
		push := INF
		for v := t; v != s; {
			e := pe[v]
			if g.cap[e] < push {
				push = g.cap[e]
			}
			v = g.to[e^1]
		}
		for v := t; v != s; {
			e := pe[v]; g.cap[e] -= push; g.cap[e^1] += push; v = g.to[e^1]
		}
		flow += push; cost += push * h[t]
	}
	return flow, cost
}

func assignment(a [][]int) int {
	n := len(a)
	g := New(2*n + 2)
	s, t := 2*n, 2*n+1
	for i := 0; i < n; i++ {
		g.Add(s, i, 1, 0)
		g.Add(n+i, t, 1, 0)
		for j := 0; j < n; j++ {
			g.Add(i, n+j, 1, a[i][j])
		}
	}
	_, cost := g.Run(s, t)
	return cost
}

func main() {
	a := [][]int{{9, 2, 7}, {6, 4, 3}, {5, 8, 1}}
	fmt.Println(assignment(a)) // 9
}
```

#### Java

```java
import java.util.*;

public class Assignment {
    static final int INF = Integer.MAX_VALUE / 2;
    int n; List<int[]> e = new ArrayList<>(); List<List<Integer>> g;
    Assignment(int n){ this.n=n; g=new ArrayList<>(); for(int i=0;i<n;i++) g.add(new ArrayList<>()); }
    void add(int u,int v,int c,int w){ g.get(u).add(e.size()); e.add(new int[]{v,c,w}); g.get(v).add(e.size()); e.add(new int[]{u,0,-w}); }
    int[] run(int s,int t){
        int[] h=new int[n]; int flow=0,cost=0;
        while(true){
            int[] d=new int[n],pe=new int[n]; Arrays.fill(d,INF); Arrays.fill(pe,-1); d[s]=0;
            PriorityQueue<int[]> pq=new PriorityQueue<>((x,y)->x[0]-y[0]); pq.add(new int[]{0,s});
            while(!pq.isEmpty()){
                int[] c=pq.poll(); if(c[0]>d[c[1]]) continue; int u=c[1];
                for(int id:g.get(u)){ int[] ed=e.get(id); if(ed[1]>0){ int nd=d[u]+ed[2]+h[u]-h[ed[0]]; if(nd<d[ed[0]]){ d[ed[0]]=nd; pe[ed[0]]=id; pq.add(new int[]{nd,ed[0]}); } } }
            }
            if(d[t]==INF) break;
            for(int i=0;i<n;i++) if(d[i]<INF) h[i]+=d[i];
            int push=INF; for(int v=t;v!=s;){ int id=pe[v]; push=Math.min(push,e.get(id)[1]); v=e.get(id^1)[0]; }
            for(int v=t;v!=s;){ int id=pe[v]; e.get(id)[1]-=push; e.get(id^1)[1]+=push; v=e.get(id^1)[0]; }
            flow+=push; cost+=push*h[t];
        }
        return new int[]{flow,cost};
    }
    static int solve(int[][] a){
        int n=a.length; Assignment m=new Assignment(2*n+2); int s=2*n,t=2*n+1;
        for(int i=0;i<n;i++){ m.add(s,i,1,0); m.add(n+i,t,1,0); for(int j=0;j<n;j++) m.add(i,n+j,1,a[i][j]); }
        return m.run(s,t)[1];
    }
    public static void main(String[] x){
        System.out.println(solve(new int[][]{{9,2,7},{6,4,3},{5,8,1}})); // 9
    }
}
```

#### Python

```python
import heapq
INF = float("inf")

class MCMF:
    def __init__(self, n):
        self.n=n; self.to=[]; self.cap=[]; self.cost=[]; self.head=[[] for _ in range(n)]
    def add(self,u,v,c,w):
        self.head[u].append(len(self.to)); self.to.append(v); self.cap.append(c); self.cost.append(w)
        self.head[v].append(len(self.to)); self.to.append(u); self.cap.append(0); self.cost.append(-w)
    def run(self,s,t):
        h=[0]*self.n; flow=cost=0
        while True:
            dist=[INF]*self.n; pe=[-1]*self.n; dist[s]=0; pq=[(0,s)]
            while pq:
                d,u=heapq.heappop(pq)
                if d>dist[u]: continue
                for e in self.head[u]:
                    v=self.to[e]
                    if self.cap[e]>0:
                        nd=d+self.cost[e]+h[u]-h[v]
                        if nd<dist[v]: dist[v]=nd; pe[v]=e; heapq.heappush(pq,(nd,v))
            if dist[t]==INF: break
            for i in range(self.n):
                if dist[i]<INF: h[i]+=dist[i]
            push=INF; v=t
            while v!=s: push=min(push,self.cap[pe[v]]); v=self.to[pe[v]^1]
            v=t
            while v!=s: self.cap[pe[v]]-=push; self.cap[pe[v]^1]+=push; v=self.to[pe[v]^1]
            flow+=push; cost+=push*h[t]
        return flow,cost

def assignment(a):
    n=len(a); g=MCMF(2*n+2); s,t=2*n,2*n+1
    for i in range(n):
        g.add(s,i,1,0); g.add(n+i,t,1,0)
        for j in range(n): g.add(i,n+j,1,a[i][j])
    return g.run(s,t)[1]

print(assignment([[9,2,7],[6,4,3],[5,8,1]]))  # 9
```

(All-non-negative costs, so `h=0` init suffices here.)

### Challenge 2: Transportation Problem

**Problem.** `m` suppliers with supplies `sup[i]`, `n` consumers with demands `dem[j]`, unit shipping cost `c[i][j]`. Ship to meet all demand at minimum cost (assume total supply ≥ total demand). Return min cost.

#### Python

```python
def transportation(sup, dem, c):
    m, n = len(sup), len(dem)
    g = MCMF(m + n + 2)
    s, t = m + n, m + n + 1
    for i in range(m):
        g.add(s, i, sup[i], 0)
    for j in range(n):
        g.add(m + j, t, dem[j], 0)
    for i in range(m):
        for j in range(n):
            g.add(i, m + j, 10**9, c[i][j])
    return g.run(s, t)[1]

print(transportation([4, 2], [3, 3], [[1, 2], [3, 1]]))  # 7
```

#### Go

```go
func transportation(sup, dem []int, c [][]int) int {
	m, n := len(sup), len(dem)
	g := New(m + n + 2)
	s, t := m+n, m+n+1
	for i := 0; i < m; i++ {
		g.Add(s, i, sup[i], 0)
	}
	for j := 0; j < n; j++ {
		g.Add(m+j, t, dem[j], 0)
	}
	for i := 0; i < m; i++ {
		for j := 0; j < n; j++ {
			g.Add(i, m+j, 1<<30, c[i][j])
		}
	}
	_, cost := g.Run(s, t)
	return cost // 7 for the example
}
```

#### Java

```java
static int transportation(int[] sup, int[] dem, int[][] c) {
    int m = sup.length, n = dem.length;
    Assignment g = new Assignment(m + n + 2); // reuse MCMF skeleton
    int s = m + n, t = m + n + 1;
    for (int i = 0; i < m; i++) g.add(s, i, sup[i], 0);
    for (int j = 0; j < n; j++) g.add(m + j, t, dem[j], 0);
    for (int i = 0; i < m; i++)
        for (int j = 0; j < n; j++)
            g.add(i, m + j, 1 << 30, c[i][j]);
    return g.run(s, t)[1]; // 7
}
```

### Challenge 3: Min-Cost Flow of Value K

**Problem.** Find the cheapest way to push exactly `k` units `s→t` (return `(flow, cost)`; flow may be `< k` if infeasible).

#### Python

```python
def min_cost_k(g, s, t, k):
    h = [0] * g.n
    flow = cost = 0
    while flow < k:
        dist = [INF] * g.n; pe = [-1] * g.n; dist[s] = 0; pq = [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]: continue
            for e in g.head[u]:
                v = g.to[e]
                if g.cap[e] > 0:
                    nd = d + g.cost[e] + h[u] - h[v]
                    if nd < dist[v]: dist[v] = nd; pe[v] = e; heapq.heappush(pq, (nd, v))
        if dist[t] == INF: break
        for i in range(g.n):
            if dist[i] < INF: h[i] += dist[i]
        push = k - flow; v = t
        while v != s: push = min(push, g.cap[pe[v]]); v = g.to[pe[v] ^ 1]
        v = t
        while v != s: g.cap[pe[v]] -= push; g.cap[pe[v] ^ 1] += push; v = g.to[pe[v] ^ 1]
        flow += push; cost += push * h[t]
    return flow, cost
```

(Go/Java: identical to the `Run` loop with `maxFlow = k` and `push = min(push, k - flow)` — exactly the `Solve(src, snk, maxFlow)` signature in [`senior.md`](./senior.md).)

### Challenge 4: Min-Cost to Send K Edge-Disjoint Paths

**Problem.** In a graph where each edge has unit capacity and a length, find the minimum total length to route `k` edge-disjoint `s→t` paths.

#### Python

```python
def k_disjoint_paths(n, edges, s, t, k):
    g = MCMF(n)
    for u, v, length in edges:
        g.add(u, v, 1, length)   # unit capacity => edge-disjoint
    return min_cost_k(g, s, t, k)  # (paths_routed, total_length)
```

The unit capacities force distinct edges per path; MCMF of value `k` yields the cheapest `k` edge-disjoint paths jointly (not the same as `k` independent shortest paths — the reverse edges allow rerouting for a cheaper combined solution).

---

## Common Pitfalls in Interviews

- **Forgetting the negated reverse-edge cost.** State it explicitly; it is the #1 correctness bug.
- **Using Dijkstra without potentials** on the residual graph — wrong because of negative reverse edges.
- **Confusing capacity and cost** when modeling — narrate which is which as you build the graph.
- **Claiming max-flow alone minimizes cost** — it does not; only MCMF picks the cheapest maximum.
- **Ignoring overflow** — use 64-bit for cost (`F × maxCost`).
- **Not initializing potentials with Bellman-Ford** when negative edges exist.

---

## What Interviewers Are Really Testing

- **Modeling skill:** can you *recognize* a disguised min-cost flow (assignment, transportation, scheduling) and write the reduction? This is the highest-signal ability.
- **Understanding of the residual graph and negated reverse edges** — the conceptual core.
- **Knowing why Dijkstra needs potentials** and being able to explain the reduced-cost invariant.
- **Complexity awareness:** `O(V·E·F)` vs `O(F·(E+V log V))`, and the `F ≤ V` shortcut for unit-capacity.
- **Judgment at scale:** when to shard, warm-start, or offload to an LP solver, and how to degrade gracefully.
- **Communication:** narrating the build → solve → decode pipeline and explaining results to stakeholders.
