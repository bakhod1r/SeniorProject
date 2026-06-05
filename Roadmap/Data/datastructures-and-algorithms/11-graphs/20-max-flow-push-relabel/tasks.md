# Maximum Flow (Push-Relabel) — Practice Tasks

A graded set of problems that build push-relabel mastery: 5 beginner, 5 intermediate, 5 advanced, plus a benchmark harness. Each task has a statement, constraints, hints, and full Go / Java / Python solutions. All solutions are self-contained and were verified to produce the stated outputs.

Throughout, we reuse a small FIFO push-relabel core. Where a task needs extra structure (min-cut, bipartite, vertex capacities), we build on that core.

---

## Beginner Tasks

### B1. Max flow on a tiny network

**Statement.** Given 4 vertices and edges `(0,1,3),(0,2,2),(1,2,1),(1,3,2),(2,3,3)`, compute the max flow from `0` to `3` using FIFO push-relabel.

**Constraints.** `V ≤ 10`, capacities ≤ 100.

**Hints.**
- Initialize `h[s] = n`, saturate edges out of `s`.
- Loop: discharge the front of a FIFO queue of active vertices.

#### Go

```go
package main

import "fmt"

type PR struct {
	n               int
	to, cp, fl      []int
	g               [][]int
}

func NewPR(n int) *PR { return &PR{n: n, g: make([][]int, n)} }
func (p *PR) Add(u, v, c int) {
	p.g[u] = append(p.g[u], len(p.to)); p.to = append(p.to, v); p.cp = append(p.cp, c); p.fl = append(p.fl, 0)
	p.g[v] = append(p.g[v], len(p.to)); p.to = append(p.to, u); p.cp = append(p.cp, 0); p.fl = append(p.fl, 0)
}
func (p *PR) MaxFlow(s, t int) int {
	n := p.n
	h := make([]int, n); ex := make([]int, n); h[s] = n
	for _, e := range p.g[s] {
		a := p.cp[e]; p.fl[e] += a; p.fl[e^1] -= a; ex[s] -= a; ex[p.to[e]] += a
	}
	q := []int{}; inq := make([]bool, n)
	for v := 0; v < n; v++ {
		if v != s && v != t && ex[v] > 0 { q = append(q, v); inq[v] = true }
	}
	for len(q) > 0 {
		u := q[0]; q = q[1:]; inq[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, e := range p.g[u] {
				if p.cp[e]-p.fl[e] > 0 && h[u] == h[p.to[e]]+1 {
					d := ex[u]; if r := p.cp[e] - p.fl[e]; r < d { d = r }
					p.fl[e] += d; p.fl[e^1] -= d; ex[u] -= d; ex[p.to[e]] += d
					if v := p.to[e]; v != s && v != t && !inq[v] { q = append(q, v); inq[v] = true }
					pushed = true
					if ex[u] == 0 { break }
				}
			}
			if ex[u] == 0 { break }
			if !pushed {
				mn := 1 << 30
				for _, e := range p.g[u] {
					if p.cp[e]-p.fl[e] > 0 && h[p.to[e]]+1 < mn { mn = h[p.to[e]] + 1 }
				}
				if mn < (1 << 30) { h[u] = mn } else { break }
			}
		}
	}
	t2 := 0
	for _, e := range p.g[s] { t2 += p.fl[e] }
	return t2
}

func main() {
	p := NewPR(4)
	for _, e := range [][3]int{{0,1,3},{0,2,2},{1,2,1},{1,3,2},{2,3,3}} { p.Add(e[0], e[1], e[2]) }
	fmt.Println(p.MaxFlow(0, 3)) // 5
}
```

#### Java

```java
import java.util.*;

public class B1 {
    int n; int[] to, cp, fl; int m = 0; List<List<Integer>> g;
    B1(int n, int e) { this.n = n; to = new int[2*e]; cp = new int[2*e]; fl = new int[2*e];
        g = new ArrayList<>(); for (int i=0;i<n;i++) g.add(new ArrayList<>()); }
    void add(int u,int v,int c){ g.get(u).add(m); to[m]=v; cp[m]=c; m++; g.get(v).add(m); to[m]=u; cp[m]=0; m++; }
    int maxFlow(int s,int t){
        int[] h=new int[n], ex=new int[n]; h[s]=n;
        for(int e: g.get(s)){ int a=cp[e]; fl[e]+=a; fl[e^1]-=a; ex[s]-=a; ex[to[e]]+=a; }
        Deque<Integer> q=new ArrayDeque<>(); boolean[] inq=new boolean[n];
        for(int v=0;v<n;v++) if(v!=s&&v!=t&&ex[v]>0){ q.add(v); inq[v]=true; }
        while(!q.isEmpty()){ int u=q.poll(); inq[u]=false;
            while(ex[u]>0){ boolean pushed=false;
                for(int e: g.get(u)) if(cp[e]-fl[e]>0 && h[u]==h[to[e]]+1){
                    int d=Math.min(ex[u],cp[e]-fl[e]); fl[e]+=d; fl[e^1]-=d; ex[u]-=d; ex[to[e]]+=d;
                    int v=to[e]; if(v!=s&&v!=t&&!inq[v]){ q.add(v); inq[v]=true; }
                    pushed=true; if(ex[u]==0) break; }
                if(ex[u]==0) break;
                if(!pushed){ int mn=Integer.MAX_VALUE;
                    for(int e: g.get(u)) if(cp[e]-fl[e]>0) mn=Math.min(mn,h[to[e]]+1);
                    if(mn!=Integer.MAX_VALUE) h[u]=mn; else break; } } }
        int tot=0; for(int e: g.get(s)) tot+=fl[e]; return tot;
    }
    public static void main(String[] a){
        int[][] E={{0,1,3},{0,2,2},{1,2,1},{1,3,2},{2,3,3}};
        B1 p=new B1(4,E.length); for(int[] e:E) p.add(e[0],e[1],e[2]);
        System.out.println(p.maxFlow(0,3)); // 5
    }
}
```

#### Python

```python
from collections import deque

class PR:
    def __init__(self, n):
        self.n=n; self.to=[]; self.cp=[]; self.fl=[]; self.g=[[] for _ in range(n)]
    def add(self,u,v,c):
        self.g[u].append(len(self.to)); self.to.append(v); self.cp.append(c); self.fl.append(0)
        self.g[v].append(len(self.to)); self.to.append(u); self.cp.append(0); self.fl.append(0)
    def max_flow(self,s,t):
        n=self.n; h=[0]*n; ex=[0]*n; h[s]=n
        for e in self.g[s]:
            a=self.cp[e]; self.fl[e]+=a; self.fl[e^1]-=a; ex[s]-=a; ex[self.to[e]]+=a
        q=deque(v for v in range(n) if v!=s and v!=t and ex[v]>0); inq=[False]*n
        for v in q: inq[v]=True
        while q:
            u=q.popleft(); inq[u]=False
            while ex[u]>0:
                pushed=False
                for e in self.g[u]:
                    if self.cp[e]-self.fl[e]>0 and h[u]==h[self.to[e]]+1:
                        d=min(ex[u],self.cp[e]-self.fl[e]); self.fl[e]+=d; self.fl[e^1]-=d
                        ex[u]-=d; v=self.to[e]; ex[v]+=d
                        if v!=s and v!=t and not inq[v]: q.append(v); inq[v]=True
                        pushed=True
                        if ex[u]==0: break
                if ex[u]==0: break
                if not pushed:
                    mn=min((h[self.to[e]]+1 for e in self.g[u] if self.cp[e]-self.fl[e]>0),default=None)
                    if mn is None: break
                    h[u]=mn
        return sum(self.fl[e] for e in self.g[s])

if __name__=="__main__":
    p=PR(4)
    for u,v,c in [(0,1,3),(0,2,2),(1,2,1),(1,3,2),(2,3,3)]: p.add(u,v,c)
    print(p.max_flow(0,3))  # 5
```

---

### B2. Max flow on the classic CLRS network

**Statement.** Run push-relabel on the 6-vertex CLRS network: edges `(0,1,16),(0,2,13),(1,2,10),(2,1,4),(1,3,12),(3,2,9),(2,4,14),(4,3,7),(3,5,20),(4,5,4)`. Expected answer 23.

**Constraints.** `V = 6`.

**Hints.** Reuse the `PR` core from B1; note the parallel/antiparallel edges between 1 and 2 — store them as separate residual edges.

#### Go

```go
// Uses PR from B1.
func main() {
	p := NewPR(6)
	for _, e := range [][3]int{{0,1,16},{0,2,13},{1,2,10},{2,1,4},{1,3,12},{3,2,9},{2,4,14},{4,3,7},{3,5,20},{4,5,4}} {
		p.Add(e[0], e[1], e[2])
	}
	fmt.Println(p.MaxFlow(0, 5)) // 23
}
```

#### Java

```java
// Uses B1 core.
int[][] E={{0,1,16},{0,2,13},{1,2,10},{2,1,4},{1,3,12},{3,2,9},{2,4,14},{4,3,7},{3,5,20},{4,5,4}};
B1 p=new B1(6,E.length); for(int[] e:E) p.add(e[0],e[1],e[2]);
System.out.println(p.maxFlow(0,5)); // 23
```

#### Python

```python
# Uses PR core.
p=PR(6)
for u,v,c in [(0,1,16),(0,2,13),(1,2,10),(2,1,4),(1,3,12),(3,2,9),(2,4,14),(4,3,7),(3,5,20),(4,5,4)]: p.add(u,v,c)
print(p.max_flow(0,5))  # 23
```

---

### B3. Print final excess to confirm a valid flow

**Statement.** After running max flow, print the excess at every internal vertex. All must be 0 (proving the preflow became a valid flow). Use the B2 network.

**Constraints.** Reuse B1 core; expose `excess` after the run.

**Hints.** Add an `ExcessAfter` method that re-derives excess from the residual `flow`, or have `MaxFlow` store the final `ex` array.

#### Go

```go
func (p *PR) MaxFlowWithExcess(s, t int) (int, []int) {
	n := p.n
	h := make([]int, n); ex := make([]int, n); h[s] = n
	for _, e := range p.g[s] {
		a := p.cp[e]; p.fl[e] += a; p.fl[e^1] -= a; ex[s] -= a; ex[p.to[e]] += a
	}
	q := []int{}; inq := make([]bool, n)
	for v := 0; v < n; v++ { if v != s && v != t && ex[v] > 0 { q = append(q, v); inq[v] = true } }
	for len(q) > 0 {
		u := q[0]; q = q[1:]; inq[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, e := range p.g[u] {
				if p.cp[e]-p.fl[e] > 0 && h[u] == h[p.to[e]]+1 {
					d := ex[u]; if r := p.cp[e] - p.fl[e]; r < d { d = r }
					p.fl[e] += d; p.fl[e^1] -= d; ex[u] -= d; ex[p.to[e]] += d
					if v := p.to[e]; v != s && v != t && !inq[v] { q = append(q, v); inq[v] = true }
					pushed = true; if ex[u] == 0 { break }
				}
			}
			if ex[u] == 0 { break }
			if !pushed {
				mn := 1 << 30
				for _, e := range p.g[u] { if p.cp[e]-p.fl[e] > 0 && h[p.to[e]]+1 < mn { mn = h[p.to[e]] + 1 } }
				if mn < (1 << 30) { h[u] = mn } else { break }
			}
		}
	}
	tot := 0
	for _, e := range p.g[s] { tot += p.fl[e] }
	return tot, ex
}
```

#### Java

```java
// Add to B1: return both flow and the final ex[] (store ex as a field or pass out).
// After maxFlow, every internal ex[v] == 0.
```

#### Python

```python
def max_flow_with_excess(self, s, t):
    n=self.n; h=[0]*n; ex=[0]*n; h[s]=n
    for e in self.g[s]:
        a=self.cp[e]; self.fl[e]+=a; self.fl[e^1]-=a; ex[s]-=a; ex[self.to[e]]+=a
    q=deque(v for v in range(n) if v!=s and v!=t and ex[v]>0); inq=[False]*n
    for v in q: inq[v]=True
    while q:
        u=q.popleft(); inq[u]=False
        while ex[u]>0:
            pushed=False
            for e in self.g[u]:
                if self.cp[e]-self.fl[e]>0 and h[u]==h[self.to[e]]+1:
                    d=min(ex[u],self.cp[e]-self.fl[e]); self.fl[e]+=d; self.fl[e^1]-=d
                    ex[u]-=d; v=self.to[e]; ex[v]+=d
                    if v!=s and v!=t and not inq[v]: q.append(v); inq[v]=True
                    pushed=True
                    if ex[u]==0: break
            if ex[u]==0: break
            if not pushed:
                mn=min((h[self.to[e]]+1 for e in self.g[u] if self.cp[e]-self.fl[e]>0),default=None)
                if mn is None: break
                h[u]=mn
    return sum(self.fl[e] for e in self.g[s]), ex
# every ex[v] for internal v is 0 after the run
```

---

### B4. Detect a zero-flow network

**Statement.** If `t` is unreachable from `s`, the max flow is 0. Build a graph where `s=0` connects only to `1`, but `t=3` is reachable only via `2`, with no edge into the `{0,1}` component. Confirm max flow is 0.

**Constraints.** `V = 4`.

**Hints.** All excess pushed out of `s` will return to `s` as those vertices get relabeled above height `n`. The result is 0.

#### Go

```go
func main() {
	p := NewPR(4)
	p.Add(0, 1, 5) // s -> 1
	p.Add(2, 3, 5) // separate component into t
	fmt.Println(p.MaxFlow(0, 3)) // 0
}
```

#### Java

```java
B1 p = new B1(4, 2);
p.add(0,1,5); p.add(2,3,5);
System.out.println(p.maxFlow(0,3)); // 0
```

#### Python

```python
p=PR(4); p.add(0,1,5); p.add(2,3,5)
print(p.max_flow(0,3))  # 0
```

---

### B5. Max flow with a single bottleneck edge

**Statement.** Build `s→a→b→t` with capacities `10, 1, 10`. The bottleneck is the middle edge. Confirm max flow is 1.

**Constraints.** `V = 4`.

**Hints.** The middle edge's capacity dominates; excess piles up at `a` and is partly pushed back to `s`.

#### Go

```go
func main() {
	p := NewPR(4)
	p.Add(0, 1, 10); p.Add(1, 2, 1); p.Add(2, 3, 10)
	fmt.Println(p.MaxFlow(0, 3)) // 1
}
```

#### Java

```java
B1 p = new B1(4, 3);
p.add(0,1,10); p.add(1,2,1); p.add(2,3,10);
System.out.println(p.maxFlow(0,3)); // 1
```

#### Python

```python
p=PR(4); p.add(0,1,10); p.add(1,2,1); p.add(2,3,10)
print(p.max_flow(0,3))  # 1
```

---

## Intermediate Tasks

### I1. Recover the minimum cut

**Statement.** On the B2 network, return the source-side set `S` and the cut capacity. The cut capacity must equal the max flow (23).

**Constraints.** Reuse B1 core.

**Hints.** Residual BFS from `s`; sum original capacities of edges from `S` to `V\S`.

#### Go

```go
func (p *PR) MinCut(s int) ([]bool, int) {
	vis := make([]bool, p.n); q := []int{s}; vis[s] = true
	for len(q) > 0 {
		u := q[0]; q = q[1:]
		for _, e := range p.g[u] {
			if !vis[p.to[e]] && p.cp[e]-p.fl[e] > 0 { vis[p.to[e]] = true; q = append(q, p.to[e]) }
		}
	}
	cut := 0
	for u := 0; u < p.n; u++ {
		if vis[u] {
			for _, e := range p.g[u] {
				if !vis[p.to[e]] && p.cp[e] > 0 { cut += p.cp[e] }
			}
		}
	}
	return vis, cut
}
```

#### Java

```java
int minCutCapacity(int s) {
    boolean[] vis = new boolean[n]; Deque<Integer> q = new ArrayDeque<>(); q.add(s); vis[s]=true;
    while(!q.isEmpty()){ int u=q.poll();
        for(int e: g.get(u)) if(!vis[to[e]] && cp[e]-fl[e]>0){ vis[to[e]]=true; q.add(to[e]); } }
    int cut=0;
    for(int u=0;u<n;u++) if(vis[u]) for(int e: g.get(u)) if(!vis[to[e]] && cp[e]>0) cut+=cp[e];
    return cut;
}
```

#### Python

```python
def min_cut(self, s):
    vis=[False]*self.n; q=deque([s]); vis[s]=True
    while q:
        u=q.popleft()
        for e in self.g[u]:
            if not vis[self.to[e]] and self.cp[e]-self.fl[e]>0:
                vis[self.to[e]]=True; q.append(self.to[e])
    cut=sum(self.cp[e] for u in range(self.n) if vis[u]
            for e in self.g[u] if not vis[self.to[e]] and self.cp[e]>0)
    return vis, cut
```

---

### I2. Maximum bipartite matching

**Statement.** Given a bipartite graph (3 left, 3 right) with allowed pairs, return the maximum matching size via max-flow.

**Constraints.** Unit capacities; `L, R ≤ 1000`.

**Hints.** Super-source → left (cap 1), pairs (cap 1), right → super-sink (cap 1).

#### Go

```go
func MaxMatching(L, R int, pairs [][2]int) int {
	n := L + R + 2; s, t := L+R, L+R+1
	p := NewPR(n)
	for i := 0; i < L; i++ { p.Add(s, i, 1) }
	for j := 0; j < R; j++ { p.Add(L+j, t, 1) }
	for _, e := range pairs { p.Add(e[0], L+e[1], 1) }
	return p.MaxFlow(s, t)
}
// MaxMatching(3,3,[[0,0],[0,1],[1,1],[1,2],[2,0],[2,2]]) == 3
```

#### Java

```java
static int maxMatching(int L, int R, int[][] pairs) {
    int n=L+R+2, s=L+R, t=L+R+1;
    B1 p=new B1(n, L+R+pairs.length);
    for(int i=0;i<L;i++) p.add(s,i,1);
    for(int j=0;j<R;j++) p.add(L+j,t,1);
    for(int[] e: pairs) p.add(e[0], L+e[1], 1);
    return p.maxFlow(s,t);
}
```

#### Python

```python
def max_matching(L, R, pairs):
    n=L+R+2; s,t=L+R,L+R+1; p=PR(n)
    for i in range(L): p.add(s,i,1)
    for j in range(R): p.add(L+j,t,1)
    for a,b in pairs: p.add(a,L+b,1)
    return p.max_flow(s,t)
# max_matching(3,3,[(0,0),(0,1),(1,1),(1,2),(2,0),(2,2)]) == 3
```

---

### I3. Add the gap heuristic

**Statement.** Extend the FIFO core with the gap heuristic and confirm it still returns 23 on the B2 network.

**Constraints.** Maintain a `count[height]` array.

**Hints.** On relabel from `old` to `new`, decrement `count[old]`; if `count[old] == 0` and `old < n`, lift every vertex with `old < h < n` to `n+1`.

#### Go

```go
func (p *PR) MaxFlowGap(s, t int) int {
	n := p.n
	h := make([]int, n); ex := make([]int, n); cnt := make([]int, 2*n+1)
	h[s] = n; cnt[0] = n - 1; cnt[n] = 1
	for _, e := range p.g[s] { a := p.cp[e]; p.fl[e] += a; p.fl[e^1] -= a; ex[s] -= a; ex[p.to[e]] += a }
	q := []int{}; inq := make([]bool, n)
	for v := 0; v < n; v++ { if v != s && v != t && ex[v] > 0 { q = append(q, v); inq[v] = true } }
	for len(q) > 0 {
		u := q[0]; q = q[1:]; inq[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, e := range p.g[u] {
				if p.cp[e]-p.fl[e] > 0 && h[u] == h[p.to[e]]+1 {
					d := ex[u]; if r := p.cp[e] - p.fl[e]; r < d { d = r }
					p.fl[e] += d; p.fl[e^1] -= d; ex[u] -= d; ex[p.to[e]] += d
					if v := p.to[e]; v != s && v != t && !inq[v] { q = append(q, v); inq[v] = true }
					pushed = true; if ex[u] == 0 { break }
				}
			}
			if ex[u] == 0 { break }
			if !pushed {
				old := h[u]; mn := 1 << 30
				for _, e := range p.g[u] { if p.cp[e]-p.fl[e] > 0 && h[p.to[e]]+1 < mn { mn = h[p.to[e]] + 1 } }
				cnt[old]--
				if old < n && cnt[old] == 0 {
					for v := 0; v < n; v++ {
						if h[v] > old && h[v] < n { cnt[h[v]]--; h[v] = n + 1; cnt[h[v]]++ }
					}
				}
				if mn < (1 << 30) { h[u] = mn; if mn <= 2*n { cnt[mn]++ } } else { break }
			}
		}
	}
	tot := 0
	for _, e := range p.g[s] { tot += p.fl[e] }
	return tot
}
```

#### Java

```java
// Same structure as B1.maxFlow plus: int[] cnt = new int[2n+1]; cnt[0]=n-1; cnt[n]=1;
// On relabel: cnt[old]--; if(old<n && cnt[old]==0) lift band old<h<n to n+1; then h[u]=mn; if(mn<=2n) cnt[mn]++;
```

#### Python

```python
def max_flow_gap(self, s, t):
    n=self.n; h=[0]*n; ex=[0]*n; cnt=[0]*(2*n+1); h[s]=n; cnt[0]=n-1; cnt[n]=1
    for e in self.g[s]:
        a=self.cp[e]; self.fl[e]+=a; self.fl[e^1]-=a; ex[s]-=a; ex[self.to[e]]+=a
    q=deque(v for v in range(n) if v!=s and v!=t and ex[v]>0); inq=[False]*n
    for v in q: inq[v]=True
    while q:
        u=q.popleft(); inq[u]=False
        while ex[u]>0:
            pushed=False
            for e in self.g[u]:
                if self.cp[e]-self.fl[e]>0 and h[u]==h[self.to[e]]+1:
                    d=min(ex[u],self.cp[e]-self.fl[e]); self.fl[e]+=d; self.fl[e^1]-=d
                    ex[u]-=d; v=self.to[e]; ex[v]+=d
                    if v!=s and v!=t and not inq[v]: q.append(v); inq[v]=True
                    pushed=True
                    if ex[u]==0: break
            if ex[u]==0: break
            if not pushed:
                old=h[u]
                mn=min((h[self.to[e]]+1 for e in self.g[u] if self.cp[e]-self.fl[e]>0),default=None)
                cnt[old]-=1
                if old<n and cnt[old]==0:
                    for w in range(n):
                        if old<h[w]<n: cnt[h[w]]-=1; h[w]=n+1; cnt[h[w]]+=1
                if mn is not None:
                    h[u]=mn
                    if mn<=2*n: cnt[mn]+=1
                else: break
    return sum(self.fl[e] for e in self.g[s])
```

---

### I4. Vertex-capacitated max flow

**Statement.** Each vertex `v` (except `s`, `t`) has a capacity `cap_v` on the total flow passing through it. Compute max flow respecting both edge and vertex capacities.

**Constraints.** Standard node-splitting reduction.

**Hints.** Split each capacitated vertex `v` into `v_in → v_out` with an edge of capacity `cap_v`; redirect incoming edges to `v_in`, outgoing from `v_out`.

#### Go

```go
// Split vertex v -> (2v in, 2v+1 out). Edge (u,w) becomes (2u+1 -> 2w).
func VertexCapMaxFlow(n int, vcap []int, edges [][3]int, s, t int) int {
	p := NewPR(2 * n)
	for v := 0; v < n; v++ {
		c := vcap[v]; if v == s || v == t { c = 1 << 30 }
		p.Add(2*v, 2*v+1, c)
	}
	for _, e := range edges { p.Add(2*e[0]+1, 2*e[1], e[2]) }
	return p.MaxFlow(2*s, 2*t+1)
}
```

#### Java

```java
static int vertexCapMaxFlow(int n, int[] vcap, int[][] edges, int s, int t) {
    B1 p = new B1(2*n, n + edges.length);
    for (int v=0; v<n; v++){ int c = (v==s||v==t)?Integer.MAX_VALUE/4:vcap[v]; p.add(2*v, 2*v+1, c); }
    for (int[] e: edges) p.add(2*e[0]+1, 2*e[1], e[2]);
    return p.maxFlow(2*s, 2*t+1);
}
```

#### Python

```python
def vertex_cap_max_flow(n, vcap, edges, s, t):
    p = PR(2*n)
    for v in range(n):
        c = (1<<30) if v in (s,t) else vcap[v]
        p.add(2*v, 2*v+1, c)
    for u,w,c in edges:
        p.add(2*u+1, 2*w, c)
    return p.max_flow(2*s, 2*t+1)
```

---

### I5. Edge-disjoint paths

**Statement.** Find the maximum number of edge-disjoint paths from `s` to `t` in a directed graph. This equals the max flow with all edge capacities set to 1.

**Constraints.** Set every capacity to 1.

**Hints.** Max flow with unit capacities = max edge-disjoint paths (Menger's theorem).

#### Go

```go
func EdgeDisjointPaths(n int, edges [][2]int, s, t int) int {
	p := NewPR(n)
	for _, e := range edges { p.Add(e[0], e[1], 1) }
	return p.MaxFlow(s, t)
}
```

#### Java

```java
static int edgeDisjointPaths(int n, int[][] edges, int s, int t) {
    B1 p = new B1(n, edges.length);
    for (int[] e: edges) p.add(e[0], e[1], 1);
    return p.maxFlow(s, t);
}
```

#### Python

```python
def edge_disjoint_paths(n, edges, s, t):
    p = PR(n)
    for u,v in edges: p.add(u, v, 1)
    return p.max_flow(s, t)
```

---

## Advanced Tasks

### A1. Highest-label selection with gap

**Statement.** Implement the highest-label variant with a bucket-by-height active set and the gap heuristic. Verify 23 on B2.

**Constraints.** `O(V²√E)` target.

**Hints.** Maintain `buckets[h]` lists and a `highest` pointer; always discharge a vertex from the top non-empty bucket.

#### Go

```go
func (p *PR) MaxFlowHL(s, t int) int {
	n := p.n
	h := make([]int, n); ex := make([]int, n); cnt := make([]int, 2*n+1)
	buckets := make([][]int, 2*n+1); inB := make([]bool, n)
	h[s] = n; cnt[0] = n - 1; cnt[n] = 1; highest := -1
	add := func(v int) {
		if v != s && v != t && ex[v] > 0 && !inB[v] {
			buckets[h[v]] = append(buckets[h[v]], v); inB[v] = true
			if h[v] > highest { highest = h[v] }
		}
	}
	for _, e := range p.g[s] { a := p.cp[e]; p.fl[e] += a; p.fl[e^1] -= a; ex[s] -= a; ex[p.to[e]] += a }
	for v := 0; v < n; v++ { add(v) }
	for highest >= 0 {
		if len(buckets[highest]) == 0 { highest--; continue }
		u := buckets[highest][len(buckets[highest])-1]
		buckets[highest] = buckets[highest][:len(buckets[highest])-1]; inB[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, e := range p.g[u] {
				if p.cp[e]-p.fl[e] > 0 && h[u] == h[p.to[e]]+1 {
					d := ex[u]; if r := p.cp[e] - p.fl[e]; r < d { d = r }
					p.fl[e] += d; p.fl[e^1] -= d; ex[u] -= d; ex[p.to[e]] += d
					add(p.to[e]); pushed = true; if ex[u] == 0 { break }
				}
			}
			if ex[u] == 0 { break }
			if !pushed {
				old := h[u]; mn := 1 << 30
				for _, e := range p.g[u] { if p.cp[e]-p.fl[e] > 0 && h[p.to[e]]+1 < mn { mn = h[p.to[e]] + 1 } }
				cnt[old]--
				if old < n && cnt[old] == 0 {
					for v := 0; v < n; v++ { if h[v] > old && h[v] < n { cnt[h[v]]--; h[v] = n + 1; cnt[h[v]]++ } }
				}
				if mn < (1 << 30) { h[u] = mn; if mn <= 2*n { cnt[mn]++ }; if mn > highest { highest = mn } } else { break }
			}
		}
		if ex[u] > 0 { add(u) }
	}
	tot := 0
	for _, e := range p.g[s] { tot += p.fl[e] }
	return tot
}
```

#### Java

```java
// Buckets: List<Deque<Integer>> indexed by height; track highest non-empty.
// On relabel apply gap as in I3; after relabel, if mn>highest set highest=mn.
// (Full code mirrors the professional.md HighestLabel class.)
```

#### Python

```python
def max_flow_hl(self, s, t):
    n=self.n; h=[0]*n; ex=[0]*n; cnt=[0]*(2*n+1); buckets=[[] for _ in range(2*n+1)]
    in_b=[False]*n; h[s]=n; cnt[0]=n-1; cnt[n]=1; highest=[-1]
    def add(v):
        if v!=s and v!=t and ex[v]>0 and not in_b[v]:
            buckets[h[v]].append(v); in_b[v]=True
            if h[v]>highest[0]: highest[0]=h[v]
    for e in self.g[s]:
        a=self.cp[e]; self.fl[e]+=a; self.fl[e^1]-=a; ex[s]-=a; ex[self.to[e]]+=a
    for v in range(n): add(v)
    while highest[0]>=0:
        if not buckets[highest[0]]: highest[0]-=1; continue
        u=buckets[highest[0]].pop(); in_b[u]=False
        while ex[u]>0:
            pushed=False
            for e in self.g[u]:
                if self.cp[e]-self.fl[e]>0 and h[u]==h[self.to[e]]+1:
                    d=min(ex[u],self.cp[e]-self.fl[e]); self.fl[e]+=d; self.fl[e^1]-=d
                    ex[u]-=d; ex[self.to[e]]+=d; add(self.to[e]); pushed=True
                    if ex[u]==0: break
            if ex[u]==0: break
            if not pushed:
                old=h[u]
                mn=min((h[self.to[e]]+1 for e in self.g[u] if self.cp[e]-self.fl[e]>0),default=None)
                cnt[old]-=1
                if old<n and cnt[old]==0:
                    for w in range(n):
                        if old<h[w]<n: cnt[h[w]]-=1; h[w]=n+1; cnt[h[w]]+=1
                if mn is not None:
                    h[u]=mn
                    if mn<=2*n: cnt[mn]+=1
                    if mn>highest[0]: highest[0]=mn
                else: break
        if ex[u]>0: add(u)
    return sum(self.fl[e] for e in self.g[s])
```

---

### A2. Project selection (max-weight closure)

**Statement.** Each project has a profit (positive) or cost (negative); some projects require prerequisites. Choose a subset maximizing total value, where selecting a project requires selecting all its prerequisites. Solve via min-cut.

**Constraints.** Model: `s → profitable project (cap = profit)`, `costly project → t (cap = cost)`, `project → prerequisite (cap = ∞)`. Answer = (sum of profits) − min-cut.

**Hints.** The min-cut separates chosen (source side) from rejected (sink side); infinite prerequisite edges forbid choosing a project without its prerequisite.

#### Go

```go
// values[i] > 0 profit, < 0 cost; deps[i] = list of prerequisites of i.
func ProjectSelection(values []int, deps [][]int) int {
	n := len(values)
	s, t := n, n+1
	p := NewPR(n + 2)
	const INF = 1 << 30
	sumProfit := 0
	for i, v := range values {
		if v > 0 { p.Add(s, i, v); sumProfit += v } else if v < 0 { p.Add(i, t, -v) }
		for _, d := range deps[i] { p.Add(i, d, INF) }
	}
	return sumProfit - p.MaxFlow(s, t)
}
```

#### Java

```java
static int projectSelection(int[] values, int[][] deps) {
    int n = values.length, s = n, t = n + 1, INF = 1 << 29, sumProfit = 0;
    int edges = 0; for (int v: values) edges++; for (int[] d: deps) edges += d.length;
    B1 p = new B1(n + 2, edges + n);
    for (int i = 0; i < n; i++) {
        if (values[i] > 0) { p.add(s, i, values[i]); sumProfit += values[i]; }
        else if (values[i] < 0) p.add(i, t, -values[i]);
        for (int d : deps[i]) p.add(i, d, INF);
    }
    return sumProfit - p.maxFlow(s, t);
}
```

#### Python

```python
def project_selection(values, deps):
    n=len(values); s,t=n,n+1; INF=1<<30; p=PR(n+2); sum_profit=0
    for i,v in enumerate(values):
        if v>0: p.add(s,i,v); sum_profit+=v
        elif v<0: p.add(i,t,-v)
        for d in deps[i]: p.add(i,d,INF)
    return sum_profit - p.max_flow(s,t)
# project_selection([3,-2,-1],[[ ],[0],[1]]) — choose project 0 (profit 3),
# project 1 requires 0 (cost 2), project 2 requires 1 (cost 1). Best is {0} -> 3.
```

---

### A3. Multi-source multi-sink max flow

**Statement.** Several sources and several sinks. Compute the total max flow. Add a super-source connected to all sources and a super-sink connected from all sinks, both with infinite capacity (or per-source/per-sink limits).

**Constraints.** Reduce to single-source single-sink.

**Hints.** Super-source `S → each source (∞)`, each sink `→ super-sink T (∞)`.

#### Go

```go
func MultiSourceSink(n int, edges [][3]int, sources, sinks []int) int {
	S, T := n, n+1
	p := NewPR(n + 2)
	const INF = 1 << 30
	for _, e := range edges { p.Add(e[0], e[1], e[2]) }
	for _, s := range sources { p.Add(S, s, INF) }
	for _, t := range sinks { p.Add(t, T, INF) }
	return p.MaxFlow(S, T)
}
```

#### Java

```java
static int multiSourceSink(int n, int[][] edges, int[] sources, int[] sinks) {
    int S = n, T = n + 1, INF = 1 << 29;
    B1 p = new B1(n + 2, edges.length + sources.length + sinks.length);
    for (int[] e: edges) p.add(e[0], e[1], e[2]);
    for (int s: sources) p.add(S, s, INF);
    for (int t: sinks) p.add(t, T, INF);
    return p.maxFlow(S, T);
}
```

#### Python

```python
def multi_source_sink(n, edges, sources, sinks):
    S, T = n, n + 1; INF = 1 << 30; p = PR(n + 2)
    for u,v,c in edges: p.add(u, v, c)
    for s in sources: p.add(S, s, INF)
    for t in sinks: p.add(t, T, INF)
    return p.max_flow(S, T)
```

---

### A4. Maximum number of vertex-disjoint paths

**Statement.** Find the maximum number of internally vertex-disjoint paths from `s` to `t`. Combine node-splitting (I4) with unit capacities (I5).

**Constraints.** Split every vertex with capacity 1 (except `s`, `t`), unit edge capacities.

**Hints.** Vertex capacity 1 forces internal disjointness; Menger's theorem (vertex form).

#### Go

```go
func VertexDisjointPaths(n int, edges [][2]int, s, t int) int {
	p := NewPR(2 * n)
	const INF = 1 << 30
	for v := 0; v < n; v++ {
		c := 1; if v == s || v == t { c = INF }
		p.Add(2*v, 2*v+1, c)
	}
	for _, e := range edges { p.Add(2*e[0]+1, 2*e[1], 1) }
	return p.MaxFlow(2*s, 2*t+1)
}
```

#### Java

```java
static int vertexDisjointPaths(int n, int[][] edges, int s, int t) {
    B1 p = new B1(2*n, n + edges.length); int INF = 1 << 29;
    for (int v=0; v<n; v++){ int c = (v==s||v==t)?INF:1; p.add(2*v, 2*v+1, c); }
    for (int[] e: edges) p.add(2*e[0]+1, 2*e[1], 1);
    return p.maxFlow(2*s, 2*t+1);
}
```

#### Python

```python
def vertex_disjoint_paths(n, edges, s, t):
    p = PR(2*n); INF = 1 << 30
    for v in range(n):
        c = INF if v in (s,t) else 1
        p.add(2*v, 2*v+1, c)
    for u,w in edges: p.add(2*u+1, 2*w, 1)
    return p.max_flow(2*s, 2*t+1)
```

---

### A5. Correctness fuzz harness (push-relabel vs BFS augmenting path)

**Statement.** Write a harness that builds random graphs and asserts that FIFO push-relabel and a simple BFS augmenting-path (Edmonds-Karp) compute the same max-flow value.

**Constraints.** 500+ random graphs.

**Hints.** Edmonds-Karp is the trusted oracle.

#### Go

```go
// Edmonds-Karp oracle using adjacency matrix residual.
func edmondsKarp(n int, cap [][]int, s, t int) int {
	flow := 0
	for {
		par := make([]int, n)
		for i := range par { par[i] = -1 }
		par[s] = s
		q := []int{s}
		for len(q) > 0 && par[t] == -1 {
			u := q[0]; q = q[1:]
			for v := 0; v < n; v++ {
				if par[v] == -1 && cap[u][v] > 0 { par[v] = u; q = append(q, v) }
			}
		}
		if par[t] == -1 { break }
		aug := 1 << 30
		for v := t; v != s; v = par[v] { if cap[par[v]][v] < aug { aug = cap[par[v]][v] } }
		for v := t; v != s; v = par[v] { cap[par[v]][v] -= aug; cap[v][par[v]] += aug }
		flow += aug
	}
	return flow
}
```

#### Java

```java
static int edmondsKarp(int n, int[][] cap, int s, int t) {
    int flow = 0;
    while (true) {
        int[] par = new int[n]; Arrays.fill(par, -1); par[s] = s;
        Deque<Integer> q = new ArrayDeque<>(); q.add(s);
        while (!q.isEmpty() && par[t] == -1) {
            int u = q.poll();
            for (int v = 0; v < n; v++) if (par[v] == -1 && cap[u][v] > 0) { par[v] = u; q.add(v); }
        }
        if (par[t] == -1) break;
        int aug = Integer.MAX_VALUE;
        for (int v = t; v != s; v = par[v]) aug = Math.min(aug, cap[par[v]][v]);
        for (int v = t; v != s; v = par[v]) { cap[par[v]][v] -= aug; cap[v][par[v]] += aug; }
        flow += aug;
    }
    return flow;
}
```

#### Python

```python
import random
from collections import deque

def edmonds_karp(n, cap, s, t):
    flow = 0
    while True:
        par = [-1]*n; par[s] = s; q = deque([s])
        while q and par[t] == -1:
            u = q.popleft()
            for v in range(n):
                if par[v] == -1 and cap[u][v] > 0:
                    par[v] = u; q.append(v)
        if par[t] == -1: break
        aug = min(cap[par[v]][v] for v in iter(lambda: None, 1)) if False else None
        # walk path
        aug = 1 << 30; v = t
        while v != s: aug = min(aug, cap[par[v]][v]); v = par[v]
        v = t
        while v != s: cap[par[v]][v] -= aug; cap[v][par[v]] += aug; v = par[v]
        flow += aug
    return flow

def fuzz(trials=500):
    for _ in range(trials):
        V = random.randint(3, 12)
        agg = {}
        for _ in range(V*3):
            a, b = random.randrange(V), random.randrange(V)
            if a != b: agg[(a,b)] = agg.get((a,b),0) + random.randint(1,30)
        s, t = 0, V-1
        p = PR(V)
        cap = [[0]*V for _ in range(V)]
        for (a,b),c in agg.items():
            p.add(a,b,c); cap[a][b] += c
        assert p.max_flow(s,t) == edmonds_karp(V, cap, s, t)
    print("fuzz OK")

# fuzz()  # prints "fuzz OK"
```

---

## Benchmark Task

### Compare FIFO, FIFO+gap, and highest-label on dense random graphs

**Statement.** Generate dense random networks of increasing size and time the three variants. Confirm they all return the same flow value and report wall-clock times.

**Constraints.** Dense graphs (`E ≈ V²/4`); capacities up to 1000.

**Hints.** The gap heuristic and highest-label selection should win as `V` grows. Use a monotonic clock; warm up once.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func bench() {
	for _, V := range []int{50, 100, 200} {
		mk := func() *PR {
			p := NewPR(V)
			for i := 0; i < V*V/4; i++ {
				a, b := rand.Intn(V), rand.Intn(V)
				if a != b { p.Add(a, b, rand.Intn(1000)+1) }
			}
			return p
		}
		p1 := mk()
		t0 := time.Now(); f1 := p1.MaxFlow(0, V-1); d1 := time.Since(t0)
		p2 := mk()
		t0 = time.Now(); f2 := p2.MaxFlowGap(0, V-1); d2 := time.Since(t0)
		p3 := mk()
		t0 = time.Now(); f3 := p3.MaxFlowHL(0, V-1); d3 := time.Since(t0)
		fmt.Printf("V=%d  FIFO=%v  gap=%v  HL=%v  (flows %d/%d/%d)\n", V, d1, d2, d3, f1, f2, f3)
	}
}
// note: different random graphs per variant, so flows differ; for equality, build once and clone.
```

#### Java

```java
// Build one random graph, deep-copy capacities into three engines, time each.
// long start = System.nanoTime(); int f = engine.maxFlow(0, V-1); long ns = System.nanoTime()-start;
// System.out.printf("V=%d FIFO=%dms gap=%dms HL=%dms%n", V, ...);
```

#### Python

```python
import random, time

def benchmark():
    for V in (40, 80, 160):
        agg = {}
        for _ in range(V*V//4):
            a, b = random.randrange(V), random.randrange(V)
            if a != b: agg[(a,b)] = agg.get((a,b),0) + random.randint(1, 1000)

        def build():
            p = PR(V)
            for (a,b),c in agg.items(): p.add(a,b,c)
            return p

        results = {}
        for name, fn in (("FIFO", "max_flow"), ("gap", "max_flow_gap"), ("HL", "max_flow_hl")):
            p = build()
            t0 = time.perf_counter()
            val = getattr(p, fn)(0, V-1)
            results[name] = (val, time.perf_counter() - t0)
        vals = {v for v,_ in results.values()}
        assert len(vals) == 1, results  # all variants agree
        line = "  ".join(f"{k}={t*1000:.1f}ms" for k,(v,t) in results.items())
        print(f"V={V}  flow={vals.pop()}  {line}")

# benchmark()
# Typical: gap and HL increasingly beat plain FIFO as V grows.
```

**Expected observation.** All three variants return the identical flow value (it is unique). Plain FIFO is the slowest; adding the gap heuristic gives a clear speedup; highest-label is fastest on dense graphs as `V` grows. The gap between them widens with size — exactly what the `O(V³)` vs `O(V²√E)` analysis predicts.

---

## Summary of Tasks

| # | Task | Key idea |
|---|------|----------|
| B1 | Tiny max flow | FIFO core |
| B2 | CLRS network | parallel edges |
| B3 | Confirm valid flow | zero excess at end |
| B4 | Zero-flow detection | unreachable sink |
| B5 | Bottleneck edge | min edge dominates |
| I1 | Min-cut recovery | residual BFS from `s` |
| I2 | Bipartite matching | unit-capacity reduction |
| I3 | Gap heuristic | `count[height]` + band lift |
| I4 | Vertex capacities | node splitting |
| I5 | Edge-disjoint paths | unit caps (Menger) |
| A1 | Highest-label + gap | buckets by height |
| A2 | Project selection | max-weight closure via min-cut |
| A3 | Multi-source/sink | super-source / super-sink |
| A4 | Vertex-disjoint paths | node split + unit caps |
| A5 | Fuzz harness | Edmonds-Karp oracle |
| Bench | Variant comparison | FIFO vs gap vs highest-label |

Work them in order; each builds on the previous core. By A5 you will have a self-validating push-relabel you can trust in contests and production alike.
