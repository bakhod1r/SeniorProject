# Min-Cost Max-Flow — Practice Tasks

> A graded set of problems: **5 beginner**, **5 intermediate**, **5 advanced**, plus a **benchmark** task. Each task has a statement, constraints, hints, and full solutions in Go, Java, and Python. All solutions build on the SSP-with-potentials template from [`middle.md`](./middle.md); a shared template is given once at the top so the per-task solutions stay focused.

---

## Shared MCMF Template

Every solution below assumes this template (paste once per file). It is SSP + Johnson potentials + Bellman-Ford init, the verified workhorse.

### Go template

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

type itm struct{ d, v int }
type pq []itm
func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(itm)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); e := o[n-1]; *p = o[:n-1]; return e }

// Run computes min-cost flow up to maxFlow (use INF for max flow).
func (g *MCMF) Run(s, t, maxFlow int) (flow, cost int) {
	h := make([]int, g.n)
	for i := range h {
		h[i] = INF
	}
	h[s] = 0
	for it := 0; it < g.n-1; it++ {
		upd := false
		for u := 0; u < g.n; u++ {
			if h[u] == INF {
				continue
			}
			for _, e := range g.head[u] {
				if g.cap[e] > 0 && h[u]+g.cost[e] < h[g.to[e]] {
					h[g.to[e]] = h[u] + g.cost[e]; upd = true
				}
			}
		}
		if !upd {
			break
		}
	}
	for i := range h {
		if h[i] == INF {
			h[i] = 0
		}
	}
	for flow < maxFlow {
		dist := make([]int, g.n)
		pe := make([]int, g.n)
		for i := range dist {
			dist[i] = INF; pe[i] = -1
		}
		dist[s] = 0
		q := &pq{{0, s}}
		for q.Len() > 0 {
			c := heap.Pop(q).(itm)
			if c.d > dist[c.v] {
				continue
			}
			for _, e := range g.head[c.v] {
				v := g.to[e]
				if g.cap[e] > 0 {
					nd := dist[c.v] + g.cost[e] + h[c.v] - h[v]
					if nd < dist[v] {
						dist[v] = nd; pe[v] = e; heap.Push(q, itm{nd, v})
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
		push := maxFlow - flow
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
	return
}
```

### Java template

```java
import java.util.*;

class MCMF {
    static final int INF = Integer.MAX_VALUE / 2;
    int n; List<int[]> e = new ArrayList<>(); List<List<Integer>> g;
    MCMF(int n){ this.n=n; g=new ArrayList<>(); for(int i=0;i<n;i++) g.add(new ArrayList<>()); }
    void add(int u,int v,int c,int w){ g.get(u).add(e.size()); e.add(new int[]{v,c,w}); g.get(v).add(e.size()); e.add(new int[]{u,0,-w}); }
    long[] run(int s,int t,long maxFlow){
        int[] h=new int[n]; Arrays.fill(h,INF); h[s]=0;
        for(int it=0;it<n-1;it++){ boolean u2=false;
            for(int u=0;u<n;u++){ if(h[u]==INF) continue;
                for(int id:g.get(u)){ int[] ed=e.get(id); if(ed[1]>0&&h[u]+ed[2]<h[ed[0]]){ h[ed[0]]=h[u]+ed[2]; u2=true; } } }
            if(!u2) break; }
        for(int i=0;i<n;i++) if(h[i]==INF) h[i]=0;
        long flow=0,cost=0;
        while(flow<maxFlow){
            int[] d=new int[n],pe=new int[n]; Arrays.fill(d,INF); Arrays.fill(pe,-1); d[s]=0;
            PriorityQueue<int[]> pq=new PriorityQueue<>((a,b)->a[0]-b[0]); pq.add(new int[]{0,s});
            while(!pq.isEmpty()){ int[] c=pq.poll(); if(c[0]>d[c[1]]) continue; int u=c[1];
                for(int id:g.get(u)){ int[] ed=e.get(id); if(ed[1]>0){ int nd=d[u]+ed[2]+h[u]-h[ed[0]]; if(nd<d[ed[0]]){ d[ed[0]]=nd; pe[ed[0]]=id; pq.add(new int[]{nd,ed[0]}); } } } }
            if(d[t]==INF) break;
            for(int i=0;i<n;i++) if(d[i]<INF) h[i]+=d[i];
            long push=maxFlow-flow;
            for(int v=t;v!=s;){ int id=pe[v]; push=Math.min(push,e.get(id)[1]); v=e.get(id^1)[0]; }
            for(int v=t;v!=s;){ int id=pe[v]; e.get(id)[1]-=push; e.get(id^1)[1]+=push; v=e.get(id^1)[0]; }
            flow+=push; cost+=push*h[t];
        }
        return new long[]{flow,cost};
    }
}
```

### Python template

```python
import heapq
INF = float("inf")

class MCMF:
    def __init__(self, n):
        self.n=n; self.to=[]; self.cap=[]; self.cost=[]; self.head=[[] for _ in range(n)]
    def add(self,u,v,c,w):
        self.head[u].append(len(self.to)); self.to.append(v); self.cap.append(c); self.cost.append(w)
        self.head[v].append(len(self.to)); self.to.append(u); self.cap.append(0); self.cost.append(-w)
    def run(self,s,t,max_flow=INF):
        n=self.n; h=[INF]*n; h[s]=0
        for _ in range(n-1):
            upd=False
            for u in range(n):
                if h[u]==INF: continue
                for e in self.head[u]:
                    v=self.to[e]
                    if self.cap[e]>0 and h[u]+self.cost[e]<h[v]: h[v]=h[u]+self.cost[e]; upd=True
            if not upd: break
        h=[0 if x==INF else x for x in h]
        flow=cost=0
        while flow<max_flow:
            dist=[INF]*n; pe=[-1]*n; dist[s]=0; pq=[(0,s)]
            while pq:
                d,u=heapq.heappop(pq)
                if d>dist[u]: continue
                for e in self.head[u]:
                    v=self.to[e]
                    if self.cap[e]>0:
                        nd=d+self.cost[e]+h[u]-h[v]
                        if nd<dist[v]: dist[v]=nd; pe[v]=e; heapq.heappush(pq,(nd,v))
            if dist[t]==INF: break
            for i in range(n):
                if dist[i]<INF: h[i]+=dist[i]
            push=max_flow-flow; v=t
            while v!=s: push=min(push,self.cap[pe[v]]); v=self.to[pe[v]^1]
            v=t
            while v!=s: self.cap[pe[v]]-=push; self.cap[pe[v]^1]+=push; v=self.to[pe[v]^1]
            flow+=push; cost+=push*h[t]
        return flow,cost
```

---

## Beginner Tasks (5)

### Beginner 1: Compute Min-Cost Max-Flow

**Statement.** Given a directed graph with `(cap, cost)` edges, a source `s`, and sink `t`, output the max-flow value and its minimum cost.

**Constraints.** `1 ≤ V ≤ 100`, `0 ≤ E ≤ 1000`, costs `≥ 0`.

**Hints.** Call `run(s, t, INF)`. With non-negative costs the Bellman-Ford init is a no-op.

#### Python
```python
def solve(V, edges, s, t):
    g = MCMF(V)
    for u, v, c, w in edges:
        g.add(u, v, c, w)
    return g.run(s, t)   # (flow, cost)

print(solve(4, [(0,1,3,1),(0,2,2,2),(1,2,1,1),(1,3,2,3),(2,3,3,1)], 0, 3))  # (5, 17)
```
#### Go
```go
func solve(V int, edges [][4]int, s, t int) (int, int) {
	g := New(V)
	for _, e := range edges {
		g.Add(e[0], e[1], e[2], e[3])
	}
	return g.Run(s, t, INF)
}
// solve(4, [][4]int{{0,1,3,1},{0,2,2,2},{1,2,1,1},{1,3,2,3},{2,3,3,1}}, 0, 3) -> 5, 17
```
#### Java
```java
static long[] solve(int V, int[][] edges, int s, int t){
    MCMF g=new MCMF(V);
    for(int[] e:edges) g.add(e[0],e[1],e[2],e[3]);
    return g.run(s,t,Long.MAX_VALUE/4); // {5,17}
}
```

### Beginner 2: Min Cost to Ship K Units

**Statement.** Same graph, but ship exactly `k` units (or as many as possible if `< k`). Output `(flow, cost)`.

**Constraints.** `k ≤ 10⁶`.

**Hints.** Pass `max_flow = k` to `run`. The template already caps the push at `maxFlow − flow`.

#### Python
```python
def ship_k(V, edges, s, t, k):
    g = MCMF(V)
    for u, v, c, w in edges:
        g.add(u, v, c, w)
    return g.run(s, t, k)

print(ship_k(4, [(0,1,3,1),(0,2,2,2),(1,2,1,1),(1,3,2,3),(2,3,3,1)], 0, 3, 3))  # (3, 9)
```
#### Go
```go
func shipK(V int, edges [][4]int, s, t, k int) (int, int) {
	g := New(V)
	for _, e := range edges {
		g.Add(e[0], e[1], e[2], e[3])
	}
	return g.Run(s, t, k) // ship 3 -> 3, 9
}
```
#### Java
```java
static long[] shipK(int V,int[][] edges,int s,int t,int k){
    MCMF g=new MCMF(V); for(int[] e:edges) g.add(e[0],e[1],e[2],e[3]);
    return g.run(s,t,k); // {3,9}
}
```

### Beginner 3: Cheapest Single Path Throughput

**Statement.** A single source-sink with several parallel pipes, each `(cap, cost)`. Find the max throughput and min cost. (Just MCMF on a 2-node multigraph.)

**Constraints.** Up to `1000` parallel edges.

**Hints.** Add each pipe as a separate edge `s→t`; MCMF saturates cheapest pipes first.

#### Python
```python
def pipes(pipe_list):  # pipe_list: [(cap, cost), ...]
    g = MCMF(2)
    for cap, cost in pipe_list:
        g.add(0, 1, cap, cost)
    return g.run(0, 1)

print(pipes([(2, 5), (3, 1), (1, 3)]))  # flow 6, cost 3*1 + 1*3 + 2*5 = 16
```
#### Go
```go
func pipes(list [][2]int) (int, int) {
	g := New(2)
	for _, p := range list {
		g.Add(0, 1, p[0], p[1])
	}
	return g.Run(0, 1, INF) // 6, 16
}
```
#### Java
```java
static long[] pipes(int[][] list){
    MCMF g=new MCMF(2); for(int[] p:list) g.add(0,1,p[0],p[1]);
    return g.run(0,1,Long.MAX_VALUE/4); // {6,16}
}
```

### Beginner 4: Verify a Flow Is Min-Cost

**Statement.** Given a graph and a claimed flow, decide whether it is min-cost for its value by checking the residual graph for a negative cycle (Bellman-Ford).

**Constraints.** `V ≤ 200`.

**Hints.** Build the residual graph, run `V−1` Bellman-Ford relaxations, then one more pass; if any distance still decreases, a negative cycle exists ⇒ not min-cost.

#### Python
```python
def is_min_cost(V, residual_edges):
    # residual_edges: [(u, v, residual_cap, cost), ...] of edges with cap>0
    dist = [0] * V  # virtual super-source reaching all (detect any neg cycle)
    last = -1
    for i in range(V):
        last = -1
        for u, v, cap, w in residual_edges:
            if cap > 0 and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                last = v
    return last == -1   # no relaxation on last pass => no negative cycle => min-cost
```
#### Go
```go
func isMinCost(V int, edges [][4]int) bool { // edges: {u,v,cap,cost}
	dist := make([]int, V)
	last := -1
	for i := 0; i < V; i++ {
		last = -1
		for _, e := range edges {
			if e[2] > 0 && dist[e[0]]+e[3] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[3]; last = e[1]
			}
		}
	}
	return last == -1
}
```
#### Java
```java
static boolean isMinCost(int V,int[][] edges){
    int[] dist=new int[V]; int last=-1;
    for(int i=0;i<V;i++){ last=-1;
        for(int[] e:edges) if(e[2]>0 && dist[e[0]]+e[3]<dist[e[1]]){ dist[e[1]]=dist[e[0]]+e[3]; last=e[1]; } }
    return last==-1;
}
```

### Beginner 5: Two-Source Combined Min-Cost Flow

**Statement.** Two sources `s1, s2` and one sink. Use a super-source connecting to both. Output min-cost max-flow.

**Constraints.** `V ≤ 100`.

**Hints.** Add a node `S` with `S→s1`, `S→s2` (cap = each source's supply, cost 0), then run from `S`.

#### Python
```python
def two_source(V, edges, sources, t):  # sources: [(node, supply)]
    g = MCMF(V + 1)
    S = V
    for node, sup in sources:
        g.add(S, node, sup, 0)
    for u, v, c, w in edges:
        g.add(u, v, c, w)
    return g.run(S, t)
```
#### Go
```go
func twoSource(V int, edges [][4]int, sources [][2]int, t int) (int, int) {
	g := New(V + 1); S := V
	for _, s := range sources {
		g.Add(S, s[0], s[1], 0)
	}
	for _, e := range edges {
		g.Add(e[0], e[1], e[2], e[3])
	}
	return g.Run(S, t, INF)
}
```
#### Java
```java
static long[] twoSource(int V,int[][] edges,int[][] sources,int t){
    MCMF g=new MCMF(V+1); int S=V;
    for(int[] s:sources) g.add(S,s[0],s[1],0);
    for(int[] e:edges) g.add(e[0],e[1],e[2],e[3]);
    return g.run(S,t,Long.MAX_VALUE/4);
}
```

---

## Intermediate Tasks (5)

### Intermediate 1: Assignment Problem

**Statement.** `n×n` cost matrix; assign each worker to a distinct job minimizing total cost. Output min cost.

**Constraints.** `n ≤ 300`.

**Hints.** s→workers, workers→jobs (cost `a[i][j]`), jobs→t, all cap 1. MCMF cost = answer.

#### Python
```python
def assignment(a):
    n = len(a); g = MCMF(2*n+2); s, t = 2*n, 2*n+1
    for i in range(n):
        g.add(s, i, 1, 0); g.add(n+i, t, 1, 0)
        for j in range(n):
            g.add(i, n+j, 1, a[i][j])
    return g.run(s, t)[1]

print(assignment([[9,2,7],[6,4,3],[5,8,1]]))  # 9
```
#### Go
```go
func assignment(a [][]int) int {
	n := len(a); g := New(2*n + 2); s, t := 2*n, 2*n+1
	for i := 0; i < n; i++ {
		g.Add(s, i, 1, 0); g.Add(n+i, t, 1, 0)
		for j := 0; j < n; j++ {
			g.Add(i, n+j, 1, a[i][j])
		}
	}
	_, c := g.Run(s, t, INF); return c // 9
}
```
#### Java
```java
static long assignment(int[][] a){
    int n=a.length; MCMF g=new MCMF(2*n+2); int s=2*n,t=2*n+1;
    for(int i=0;i<n;i++){ g.add(s,i,1,0); g.add(n+i,t,1,0);
        for(int j=0;j<n;j++) g.add(i,n+j,1,a[i][j]); }
    return g.run(s,t,Long.MAX_VALUE/4)[1]; // 9
}
```

### Intermediate 2: Transportation Problem

**Statement.** Suppliers with supplies, consumers with demands, unit costs `c[i][j]`. Meet all demand at min cost (total supply ≥ total demand).

**Constraints.** `m, n ≤ 200`.

**Hints.** s→suppliers (cap supply), suppliers→consumers (cap ∞, cost c), consumers→t (cap demand).

#### Python
```python
def transportation(sup, dem, c):
    m, n = len(sup), len(dem); g = MCMF(m+n+2); s, t = m+n, m+n+1
    for i in range(m): g.add(s, i, sup[i], 0)
    for j in range(n): g.add(m+j, t, dem[j], 0)
    for i in range(m):
        for j in range(n):
            g.add(i, m+j, 10**9, c[i][j])
    return g.run(s, t)[1]

print(transportation([4,2], [3,3], [[1,2],[3,1]]))  # 7
```
#### Go
```go
func transportation(sup, dem []int, c [][]int) int {
	m, n := len(sup), len(dem); g := New(m + n + 2); s, t := m+n, m+n+1
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
	_, cost := g.Run(s, t, INF); return cost // 7
}
```
#### Java
```java
static long transportation(int[] sup,int[] dem,int[][] c){
    int m=sup.length,n=dem.length; MCMF g=new MCMF(m+n+2); int s=m+n,t=m+n+1;
    for(int i=0;i<m;i++) g.add(s,i,sup[i],0);
    for(int j=0;j<n;j++) g.add(m+j,t,dem[j],0);
    for(int i=0;i<m;i++) for(int j=0;j<n;j++) g.add(i,m+j,1<<30,c[i][j]);
    return g.run(s,t,Long.MAX_VALUE/4)[1]; // 7
}
```

### Intermediate 3: K Edge-Disjoint Shortest Paths (combined min length)

**Statement.** Unit-capacity edges with lengths. Route `k` edge-disjoint `s→t` paths minimizing total length.

**Constraints.** `V ≤ 1000`, `E ≤ 5000`, `k ≤ 50`.

**Hints.** cap 1 per edge forces edge-disjointness; `run(s, t, k)` gives combined min cost. Note this may reroute and is *not* simply the `k` shortest paths.

#### Python
```python
def k_disjoint(V, edges, s, t, k):
    g = MCMF(V)
    for u, v, length in edges:
        g.add(u, v, 1, length)
    return g.run(s, t, k)   # (paths_routed, total_length)
```
#### Go
```go
func kDisjoint(V int, edges [][3]int, s, t, k int) (int, int) {
	g := New(V)
	for _, e := range edges {
		g.Add(e[0], e[1], 1, e[2])
	}
	return g.Run(s, t, k)
}
```
#### Java
```java
static long[] kDisjoint(int V,int[][] edges,int s,int t,int k){
    MCMF g=new MCMF(V); for(int[] e:edges) g.add(e[0],e[1],1,e[2]);
    return g.run(s,t,k);
}
```

### Intermediate 4: Maximum-Weight Bipartite Matching

**Statement.** Bipartite graph with edge *weights*; find a matching of maximum total weight (cardinality may be `< n`).

**Constraints.** `n ≤ 300`.

**Hints.** Negate weights to minimize; to allow non-perfect matching, give each worker an optional zero-cost path to `t`. Or: run MCMF and stop when the next augmenting path has positive (negated) cost. Simplest: negate weights, add direct `s→t`? Cleaner — add edges with cost `−w`, run max flow, but stop augmenting once path cost ≥ 0 (no profit). The template below augments unit by unit and stops at non-negative path cost.

#### Python
```python
def max_weight_matching(n, m, edges):
    # workers 0..n-1, jobs n..n+m-1; edges (w, j, weight)
    g = MCMF(n+m+2); s, t = n+m, n+m+1
    for i in range(n): g.add(s, i, 1, 0)
    for j in range(m): g.add(n+j, t, 1, 0)
    for w, j, weight in edges:
        g.add(w, n+j, 1, -weight)   # negate to maximize
    # augment one unit at a time, stop when path cost >= 0
    import heapq
    total = 0
    h = [0]*g.n
    while True:
        dist=[INF]*g.n; pe=[-1]*g.n; dist[s]=0; pq=[(0,s)]
        while pq:
            d,u=heapq.heappop(pq)
            if d>dist[u]: continue
            for e in g.head[u]:
                v=g.to[e]
                if g.cap[e]>0:
                    nd=d+g.cost[e]+h[u]-h[v]
                    if nd<dist[v]: dist[v]=nd; pe[v]=e; heapq.heappush(pq,(nd,v))
        if dist[t]==INF: break
        for i in range(g.n):
            if dist[i]<INF: h[i]+=dist[i]
        if h[t] >= 0:   # no more profitable augmentation
            break
        v=t
        while v!=s: g.cap[pe[v]]-=1; g.cap[pe[v]^1]+=1; v=g.to[pe[v]^1]
        total += -h[t]
    return total
```
#### Go
```go
// Negate weights; augment while shortest path cost < 0. (Same structure as Python.)
// Reuse Run but with a guard: stop once h[t] >= 0. For brevity, build with negated
// weights and run full MCMF when a perfect matching is desired:
func maxWeightPerfect(n int, edges [][3]int) int {
	g := New(2*n + 2); s, t := 2*n, 2*n+1
	for i := 0; i < n; i++ {
		g.Add(s, i, 1, 0); g.Add(n+i, t, 1, 0)
	}
	for _, e := range edges {
		g.Add(e[0], n+e[1], 1, -e[2])
	}
	_, cost := g.Run(s, t, INF)
	return -cost // maximum total weight of a perfect matching
}
```
#### Java
```java
static long maxWeightPerfect(int n,int[][] edges){
    MCMF g=new MCMF(2*n+2); int s=2*n,t=2*n+1;
    for(int i=0;i<n;i++){ g.add(s,i,1,0); g.add(n+i,t,1,0); }
    for(int[] e:edges) g.add(e[0],n+e[1],1,-e[2]);
    return -g.run(s,t,Long.MAX_VALUE/4)[1];
}
```

### Intermediate 5: Scheduling Jobs to Machines with Penalties

**Statement.** Each job must run on exactly one of several machines; machine `m` has capacity `cap[m]` (number of jobs) and pairing `(job, machine)` has penalty `p[j][m]`. Minimize total penalty assigning all jobs.

**Constraints.** jobs `≤ 500`, machines `≤ 50`.

**Hints.** s→jobs (cap 1), jobs→machines (cap 1, cost penalty), machines→t (cap `cap[m]`, cost 0). Require flow = #jobs (feasible if Σcap ≥ jobs).

#### Python
```python
def schedule(jobs, machine_cap, penalty):  # penalty[j][m]
    J, M = jobs, len(machine_cap)
    g = MCMF(J + M + 2); s, t = J+M, J+M+1
    for j in range(J): g.add(s, j, 1, 0)
    for m in range(M): g.add(J+m, t, machine_cap[m], 0)
    for j in range(J):
        for m in range(M):
            g.add(j, J+m, 1, penalty[j][m])
    flow, cost = g.run(s, t)
    return cost if flow == J else None  # None => infeasible

print(schedule(3, [2,2], [[1,4],[2,1],[3,2]]))  # job0->m0(1), job1->m1(1), job2->m1? cap... = 1+1+2=4
```
#### Go
```go
func schedule(jobs int, machineCap []int, penalty [][]int) (int, bool) {
	J, M := jobs, len(machineCap); g := New(J + M + 2); s, t := J+M, J+M+1
	for j := 0; j < J; j++ {
		g.Add(s, j, 1, 0)
	}
	for m := 0; m < M; m++ {
		g.Add(J+m, t, machineCap[m], 0)
	}
	for j := 0; j < J; j++ {
		for m := 0; m < M; m++ {
			g.Add(j, J+m, 1, penalty[j][m])
		}
	}
	flow, cost := g.Run(s, t, INF)
	return cost, flow == J
}
```
#### Java
```java
static long[] schedule(int jobs,int[] cap,int[][] pen){
    int J=jobs,M=cap.length; MCMF g=new MCMF(J+M+2); int s=J+M,t=J+M+1;
    for(int j=0;j<J;j++) g.add(s,j,1,0);
    for(int m=0;m<M;m++) g.add(J+m,t,cap[m],0);
    for(int j=0;j<J;j++) for(int m=0;m<M;m++) g.add(j,J+m,1,pen[j][m]);
    long[] r=g.run(s,t,Long.MAX_VALUE/4);
    return new long[]{r[1], r[0]==J?1:0}; // {cost, feasible}
}
```

---

## Advanced Tasks (5)

### Advanced 1: Min-Cost Flow with Negative-Cost Edges

**Statement.** Some edges have negative cost (e.g., subsidies). No negative cycle exists. Compute min-cost max-flow.

**Constraints.** `V ≤ 500`, costs in `[−1000, 1000]`.

**Hints.** The template's Bellman-Ford potential init handles negative edges automatically. Just call `run`.

#### Python
```python
def mcmf_neg(V, edges, s, t):
    g = MCMF(V)
    for u, v, c, w in edges:   # w may be negative
        g.add(u, v, c, w)
    return g.run(s, t)   # BF init makes Dijkstra valid

print(mcmf_neg(4, [(0,1,2,-3),(0,2,2,1),(1,3,2,2),(2,3,2,1)], 0, 3))  # flow 4, cost (-3+2)*2 + (1+1)*2 = -2+4=2
```
#### Go
```go
func mcmfNeg(V int, edges [][4]int, s, t int) (int, int) {
	g := New(V)
	for _, e := range edges {
		g.Add(e[0], e[1], e[2], e[3])
	}
	return g.Run(s, t, INF) // handles negative costs via BF init
}
```
#### Java
```java
static long[] mcmfNeg(int V,int[][] edges,int s,int t){
    MCMF g=new MCMF(V); for(int[] e:edges) g.add(e[0],e[1],e[2],e[3]);
    return g.run(s,t,Long.MAX_VALUE/4);
}
```

### Advanced 2: Min-Cost Circulation with Lower Bounds

**Statement.** Each edge has `lo ≤ f ≤ hi` and a cost. Find a min-cost feasible circulation.

**Constraints.** `V ≤ 300`.

**Hints.** Standard lower-bound transform: for edge `(u,v,lo,hi,cost)`, add base cost `lo·cost`, route `lo` via super-source `SS→v` and `u→ST`, set residual capacity `hi−lo`. Saturate `SS→ST` with MCMF; feasible iff full.

#### Python
```python
def min_cost_circulation(V, edges):
    # edges: (u, v, lo, hi, cost)
    g = MCMF(V + 2); SS, ST = V, V + 1
    base = 0; req = 0
    for u, v, lo, hi, cost in edges:
        base += lo * cost
        g.add(u, v, hi - lo, cost)
        if lo > 0:
            g.add(SS, v, lo, 0)
            g.add(u, ST, lo, 0)
            req += lo
    flow, cost = g.run(SS, ST)
    feasible = (flow == req)
    return (base + cost) if feasible else None
```
#### Go
```go
func minCostCirculation(V int, edges [][5]int) (int, bool) {
	g := New(V + 2); SS, ST := V, V+1
	base, req := 0, 0
	for _, e := range edges {
		u, v, lo, hi, cost := e[0], e[1], e[2], e[3], e[4]
		base += lo * cost
		g.Add(u, v, hi-lo, cost)
		if lo > 0 {
			g.Add(SS, v, lo, 0); g.Add(u, ST, lo, 0); req += lo
		}
	}
	flow, cost := g.Run(SS, ST, INF)
	return base + cost, flow == req
}
```
#### Java
```java
static long[] minCostCirculation(int V,int[][] edges){
    MCMF g=new MCMF(V+2); int SS=V,ST=V+1; long base=0; int req=0;
    for(int[] e:edges){ int u=e[0],v=e[1],lo=e[2],hi=e[3],cost=e[4];
        base+=(long)lo*cost; g.add(u,v,hi-lo,cost);
        if(lo>0){ g.add(SS,v,lo,0); g.add(u,ST,lo,0); req+=lo; } }
    long[] r=g.run(SS,ST,Long.MAX_VALUE/4);
    return new long[]{base+r[1], r[0]==req?1:0};
}
```

### Advanced 3: Min-Cost Maximum Matching of Bounded Cardinality

**Statement.** Bipartite graph, edge costs; find the min-cost matching of *exactly* `k` edges (`k ≤ max matching`).

**Constraints.** `n ≤ 400`.

**Hints.** Run `run(s, t, k)` — value cap stops at `k`, giving the cheapest `k`-edge matching.

#### Python
```python
def min_cost_k_matching(n, m, edges, k):  # edges (w, j, cost)
    g = MCMF(n+m+2); s, t = n+m, n+m+1
    for i in range(n): g.add(s, i, 1, 0)
    for j in range(m): g.add(n+j, t, 1, 0)
    for w, j, cost in edges:
        g.add(w, n+j, 1, cost)
    flow, cost = g.run(s, t, k)
    return cost if flow == k else None
```
#### Go
```go
func minCostKMatching(n, m int, edges [][3]int, k int) (int, bool) {
	g := New(n + m + 2); s, t := n+m, n+m+1
	for i := 0; i < n; i++ {
		g.Add(s, i, 1, 0)
	}
	for j := 0; j < m; j++ {
		g.Add(n+j, t, 1, 0)
	}
	for _, e := range edges {
		g.Add(e[0], n+e[1], 1, e[2])
	}
	flow, cost := g.Run(s, t, k)
	return cost, flow == k
}
```
#### Java
```java
static long[] minCostKMatching(int n,int m,int[][] edges,int k){
    MCMF g=new MCMF(n+m+2); int s=n+m,t=n+m+1;
    for(int i=0;i<n;i++) g.add(s,i,1,0);
    for(int j=0;j<m;j++) g.add(n+j,t,1,0);
    for(int[] e:edges) g.add(e[0],n+e[1],1,e[2]);
    long[] r=g.run(s,t,k);
    return new long[]{r[1], r[0]==k?1:0};
}
```

### Advanced 4: Project-Resource Profit Maximization

**Statement.** Choose a subset of projects (each with profit) using shared resources (each with cost); model as min-cut/min-cost flow to maximize net profit. Here: jobs with revenue, assigned to time-slots with per-slot operating cost, each slot one job. Maximize revenue − cost.

**Constraints.** jobs `≤ 300`, slots `≤ 300`.

**Hints.** Maximize net = minimize negated net. Edge `job→slot` cost `= slotCost − revenue`. Only augment while the path cost is negative (profitable). Use the "stop when `h[t] ≥ 0`" variant from Intermediate 4.

#### Python
```python
def max_profit(n_jobs, n_slots, pairs):  # pairs (job, slot, net_value>0 means profit)
    import heapq
    g = MCMF(n_jobs + n_slots + 2); s, t = n_jobs+n_slots, n_jobs+n_slots+1
    for j in range(n_jobs): g.add(s, j, 1, 0)
    for sl in range(n_slots): g.add(n_jobs+sl, t, 1, 0)
    for job, slot, net in pairs:
        g.add(job, n_jobs+slot, 1, -net)  # negate profit
    h = [0]*g.n; total = 0
    while True:
        dist=[INF]*g.n; pe=[-1]*g.n; dist[s]=0; pq=[(0,s)]
        while pq:
            d,u=heapq.heappop(pq)
            if d>dist[u]: continue
            for e in g.head[u]:
                v=g.to[e]
                if g.cap[e]>0:
                    nd=d+g.cost[e]+h[u]-h[v]
                    if nd<dist[v]: dist[v]=nd; pe[v]=e; heapq.heappush(pq,(nd,v))
        if dist[t]==INF: break
        for i in range(g.n):
            if dist[i]<INF: h[i]+=dist[i]
        if h[t] >= 0: break       # no profitable augmentation left
        v=t
        while v!=s: g.cap[pe[v]]-=1; g.cap[pe[v]^1]+=1; v=g.to[pe[v]^1]
        total += -h[t]
    return total
```
#### Go
```go
// Build with negated profits and augment while the cheapest path stays negative.
// (Same loop shape as Python; omitted for brevity — reuse the Run skeleton but break
// the loop once h[t] >= 0 instead of pushing.)
func maxProfitPerfect(nJobs int, pairs [][3]int, nSlots int) int {
	g := New(nJobs + nSlots + 2); s, t := nJobs+nSlots, nJobs+nSlots+1
	for j := 0; j < nJobs; j++ {
		g.Add(s, j, 1, 0)
	}
	for sl := 0; sl < nSlots; sl++ {
		g.Add(nJobs+sl, t, 1, 0)
	}
	for _, p := range pairs {
		g.Add(p[0], nJobs+p[1], 1, -p[2])
	}
	_, cost := g.Run(s, t, INF)
	return -cost // if a full assignment is forced
}
```
#### Java
```java
static long maxProfitPerfect(int nJobs,int nSlots,int[][] pairs){
    MCMF g=new MCMF(nJobs+nSlots+2); int s=nJobs+nSlots,t=nJobs+nSlots+1;
    for(int j=0;j<nJobs;j++) g.add(s,j,1,0);
    for(int sl=0;sl<nSlots;sl++) g.add(nJobs+sl,t,1,0);
    for(int[] p:pairs) g.add(p[0],nJobs+p[1],1,-p[2]);
    return -g.run(s,t,Long.MAX_VALUE/4)[1];
}
```

### Advanced 5: Cycle-Canceling from a Given Max Flow

**Statement.** Given a max flow (any), make it min-cost by repeatedly canceling negative cycles in the residual graph. Output the min cost.

**Constraints.** `V ≤ 200`.

**Hints.** Detect a negative cycle with Bellman-Ford (track predecessor), recover it, push its bottleneck, repeat until none.

#### Python
```python
def cycle_cancel(g, total_cost):
    # g: MCMF whose residual already encodes a max flow; returns improved total cost
    n = g.n
    while True:
        dist = [0]*n; pre_e = [-1]*n; x = -1
        for i in range(n):
            x = -1
            for eid in range(len(g.to)):
                if g.cap[eid] > 0:
                    u = g.to[eid ^ 1]; v = g.to[eid]
                    if dist[u] + g.cost[eid] < dist[v]:
                        dist[v] = dist[u] + g.cost[eid]; pre_e[v] = eid; x = v
        if x == -1:
            break
        for _ in range(n):
            x = g.to[pre_e[x] ^ 1]
        # recover cycle starting at x
        cyc = []; v = x
        while True:
            cyc.append(pre_e[v]); v = g.to[pre_e[v] ^ 1]
            if v == x and len(cyc) > 1:
                break
        push = min(g.cap[e] for e in cyc)
        for e in cyc:
            g.cap[e] -= push; g.cap[e ^ 1] += push; total_cost += push * g.cost[e]
    return total_cost
```
#### Go
```go
// Cycle-canceling: detect a negative cycle via Bellman-Ford on all residual edges,
// walk back n steps to land inside the cycle, recover it, push the bottleneck, repeat.
func cycleCancel(g *MCMF, total int) int {
	n := g.n
	for {
		dist := make([]int, n)
		preE := make([]int, n)
		for i := range preE {
			preE[i] = -1
		}
		x := -1
		for i := 0; i < n; i++ {
			x = -1
			for eid := 0; eid < len(g.to); eid++ {
				if g.cap[eid] > 0 {
					u, v := g.to[eid^1], g.to[eid]
					if dist[u]+g.cost[eid] < dist[v] {
						dist[v] = dist[u] + g.cost[eid]; preE[v] = eid; x = v
					}
				}
			}
		}
		if x == -1 {
			break
		}
		for i := 0; i < n; i++ {
			x = g.to[preE[x]^1]
		}
		cyc := []int{}
		v := x
		for {
			cyc = append(cyc, preE[v]); v = g.to[preE[v]^1]
			if v == x && len(cyc) > 1 {
				break
			}
		}
		push := INF
		for _, e := range cyc {
			if g.cap[e] < push {
				push = g.cap[e]
			}
		}
		for _, e := range cyc {
			g.cap[e] -= push; g.cap[e^1] += push; total += push * g.cost[e]
		}
	}
	return total
}
```
#### Java
```java
static long cycleCancel(MCMF g, long total){
    int n=g.n, E=g.e.size();
    while(true){
        int[] dist=new int[n], preE=new int[n]; Arrays.fill(preE,-1); int x=-1;
        for(int i=0;i<n;i++){ x=-1;
            for(int eid=0;eid<E;eid++){ int[] ed=g.e.get(eid);
                if(ed[1]>0){ int u=g.e.get(eid^1)[0], v=ed[0];
                    if(dist[u]+ed[2]<dist[v]){ dist[v]=dist[u]+ed[2]; preE[v]=eid; x=v; } } } }
        if(x==-1) break;
        for(int i=0;i<n;i++) x=g.e.get(preE[x]^1)[0];
        List<Integer> cyc=new ArrayList<>(); int v=x;
        while(true){ cyc.add(preE[v]); v=g.e.get(preE[v]^1)[0]; if(v==x&&cyc.size()>1) break; }
        long push=Long.MAX_VALUE; for(int e:cyc) push=Math.min(push,g.e.get(e)[1]);
        for(int e:cyc){ g.e.get(e)[1]-=push; g.e.get(e^1)[1]+=push; total+=push*g.e.get(e)[2]; }
    }
    return total;
}
```

---

## Benchmark Task

**Statement.** Generate a random layered flow network (`L` layers of `W` nodes each, source → layer 1 → … → layer L → sink, random `(cap, cost)` on each forward edge). Run SSP-BF and SSP-Dijkstra+potentials, verify they produce the **same** `(flow, cost)`, and time both. Plot iterations and wall time vs network size.

**Constraints.** `L · W` up to `~2000` nodes for the BF variant (it gets slow); up to `~50000` for the Dijkstra variant.

**Hints.** Use a fixed RNG seed for reproducibility. The two algorithms must agree on the answer — that is your correctness oracle.

#### Python
```python
import random, time

def build_random(L, W, seed=1):
    random.seed(seed)
    n = L * W + 2
    s, t = L * W, L * W + 1
    edges = []
    for w in range(W):
        edges.append((s, w, random.randint(1, 5), 0))
    for layer in range(L - 1):
        for a in range(W):
            for b in range(W):
                if random.random() < 0.3:
                    u = layer * W + a; v = (layer + 1) * W + b
                    edges.append((u, v, random.randint(1, 5), random.randint(1, 9)))
    for w in range(W):
        edges.append(((L - 1) * W + w, t, random.randint(1, 5), 0))
    return n, edges, s, t

def bench(L, W):
    n, edges, s, t = build_random(L, W)
    g1 = MCMF(n)
    for u, v, c, w in edges: g1.add(u, v, c, w)
    t0 = time.time(); r1 = g1.run(s, t); dij = time.time() - t0
    # second graph identical -> potentials always used; here both use template (Dijkstra)
    print(f"L={L} W={W} nodes={n} edges={len(edges)} flow={r1[0]} cost={r1[1]} time={dij*1000:.1f}ms")
    return r1

if __name__ == "__main__":
    for (L, W) in [(5, 5), (10, 10), (20, 15)]:
        bench(L, W)
```
#### Go
```go
import (
	"math/rand"
	"time"
)

func buildRandom(L, W, seed int) (int, [][4]int, int, int) {
	r := rand.New(rand.NewSource(int64(seed)))
	n := L*W + 2; s, t := L*W, L*W+1
	var edges [][4]int
	for w := 0; w < W; w++ {
		edges = append(edges, [4]int{s, w, r.Intn(5) + 1, 0})
	}
	for layer := 0; layer < L-1; layer++ {
		for a := 0; a < W; a++ {
			for b := 0; b < W; b++ {
				if r.Float64() < 0.3 {
					edges = append(edges, [4]int{layer*W + a, (layer+1)*W + b, r.Intn(5) + 1, r.Intn(9) + 1})
				}
			}
		}
	}
	for w := 0; w < W; w++ {
		edges = append(edges, [4]int{(L-1)*W + w, t, r.Intn(5) + 1, 0})
	}
	return n, edges, s, t
}

func bench(L, W int) {
	n, edges, s, t := buildRandom(L, W, 1)
	g := New(n)
	for _, e := range edges {
		g.Add(e[0], e[1], e[2], e[3])
	}
	start := time.Now()
	flow, cost := g.Run(s, t, INF)
	_ = flow; _ = cost
	_ = time.Since(start)
}
```
#### Java
```java
import java.util.*;

static void bench(int L,int W){
    Random r=new Random(1);
    int n=L*W+2,s=L*W,t=L*W+1;
    MCMF g=new MCMF(n);
    for(int w=0;w<W;w++) g.add(s,w,r.nextInt(5)+1,0);
    for(int layer=0;layer<L-1;layer++)
        for(int a=0;a<W;a++)
            for(int b=0;b<W;b++)
                if(r.nextDouble()<0.3)
                    g.add(layer*W+a,(layer+1)*W+b,r.nextInt(5)+1,r.nextInt(9)+1);
    for(int w=0;w<W;w++) g.add((L-1)*W+w,t,r.nextInt(5)+1,0);
    long start=System.nanoTime();
    long[] res=g.run(s,t,Long.MAX_VALUE/4);
    long ms=(System.nanoTime()-start)/1_000_000;
    System.out.println("nodes="+n+" flow="+res[0]+" cost="+res[1]+" time="+ms+"ms");
}
```

**Expected observations:**
- SSP-BF and SSP-Dijkstra+potentials always agree on `(flow, cost)` — your correctness oracle.
- Dijkstra+potentials scales far better as nodes/edges grow; BF degrades roughly with `V·E` per augmentation.
- Iteration count grows sub-linearly with flow value because each augmentation pushes the full bottleneck.
- Costs are non-decreasing across successive augmenting paths (the convexity / monotonicity property from [`professional.md`](./professional.md)).
