# Maximum Flow (Edmonds-Karp & Dinic) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a reference solution in all three languages. A shared Dinic/Edmonds-Karp template is reused; only the *modeling* changes per task — which is the real skill.

---

## Shared Template

Most tasks reuse a Dinic max-flow engine. Memorize this once; each task is then a *modeling* exercise on top of it.

```text
add_edge(u, v, c): push forward edge (cap c) and reverse edge (cap 0), paired so reverse(e)=e^1
bfs(s, t):         build level graph by BFS distance; return whether t is reachable
dfs(u, t, f):      push blocking flow along level edges using current-arc it[]
max_flow(s, t):    repeat { bfs; reset it; while dfs pushes, add to flow } until t unreachable
```

---

## Beginner Tasks (5)

### Task 1 — Compute Max Flow on a Given Network

**Problem.** Read a directed network with capacities, a source `s`, and a sink `t`. Output the maximum flow value.

**Input / Output spec.**
- First line: `V E s t`.
- Next `E` lines: `u v c` (directed edge `u→v` with capacity `c`).
- Output: a single integer, the max-flow value.

**Constraints.**
- `2 ≤ V ≤ 500`, `1 ≤ E ≤ 10⁴`, `0 ≤ c ≤ 10⁹`.

**Hint.** Use the paired-edge representation and Dinic. Remember the reverse edge starts at capacity 0.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = int(1 << 60)

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
		for { f := d.dfs(s, t, INF); if f == 0 { break }; flow += f }
	}
	return flow
}
func min(a, b int) int { if a < b { return a }; return b }

func main() {
	in := bufio.NewReader(os.Stdin)
	var V, E, s, t int
	fmt.Fscan(in, &V, &E, &s, &t)
	d := NewDinic(V)
	for i := 0; i < E; i++ {
		var u, v, c int
		fmt.Fscan(in, &u, &v, &c)
		d.AddEdge(u, v, c)
	}
	fmt.Println(d.MaxFlow(s, t))
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task1 {
    static int n; static int[] to, cap; static List<List<Integer>> head;
    static int[] level, it; static int cnt = 0;
    static void init(int N, int m) {
        n = N; to = new int[2*m]; cap = new int[2*m]; cnt = 0;
        head = new ArrayList<>(); for (int i=0;i<n;i++) head.add(new ArrayList<>());
    }
    static void addEdge(int u,int v,int c){ head.get(u).add(cnt);to[cnt]=v;cap[cnt++]=c;
        head.get(v).add(cnt);to[cnt]=u;cap[cnt++]=0; }
    static boolean bfs(int s,int t){ level=new int[n];Arrays.fill(level,-1);level[s]=0;
        Deque<Integer> q=new ArrayDeque<>();q.add(s);
        while(!q.isEmpty()){int u=q.poll();for(int e:head.get(u))
            if(cap[e]>0&&level[to[e]]<0){level[to[e]]=level[u]+1;q.add(to[e]);}}
        return level[t]>=0; }
    static int dfs(int u,int t,int f){ if(u==t)return f;
        for(;it[u]<head.get(u).size();it[u]++){int e=head.get(u).get(it[u]),v=to[e];
            if(cap[e]>0&&level[v]==level[u]+1){int p=dfs(v,t,Math.min(f,cap[e]));
                if(p>0){cap[e]-=p;cap[e^1]+=p;return p;}}}
        return 0; }
    static int maxFlow(int s,int t){int flow=0;while(bfs(s,t)){it=new int[n];int f;
        while((f=dfs(s,t,Integer.MAX_VALUE))>0)flow+=f;}return flow;}
    public static void main(String[] a){
        Scanner sc=new Scanner(System.in);
        int V=sc.nextInt(),E=sc.nextInt(),s=sc.nextInt(),t=sc.nextInt();
        init(V,E);
        for(int i=0;i<E;i++) addEdge(sc.nextInt(),sc.nextInt(),sc.nextInt());
        System.out.println(maxFlow(s,t));
    }
}
```

**Reference — Python.**
```python
import sys
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
                if p > 0: self.cap[e] -= p; self.cap[e^1] += p; return p
            self.it[u] += 1
        return 0
    def max_flow(self, s, t):
        sys.setrecursionlimit(1 << 25); flow = 0
        while self.bfs(s, t):
            self.it = [0]*self.n
            while (f := self.dfs(s, t, float("inf"))): flow += f
        return flow


def main():
    data = sys.stdin.read().split()
    idx = 0
    def nxt():
        nonlocal idx; idx += 1; return int(data[idx-1])
    V, E, s, t = nxt(), nxt(), nxt(), nxt()
    d = Dinic(V)
    for _ in range(E):
        d.add_edge(nxt(), nxt(), nxt())
    print(d.max_flow(s, t))


main()
```

---

### Task 2 — Verify a Claimed Flow

**Problem.** Given a network and a claimed flow `f` on each edge, verify that it is a valid flow: capacity constraints and conservation hold. Output `VALID` or `INVALID`.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Check `0 ≤ f(e) ≤ c(e)` per edge, then for each vertex except `s`/`t` check inflow = outflow. No max-flow needed.

**Reference — Python.**
```python
def verify(V, edges, s, t):
    # edges: list of (u, v, c, f)
    inflow = [0]*V; outflow = [0]*V
    for u, v, c, f in edges:
        if not (0 <= f <= c):
            return "INVALID"
        outflow[u] += f; inflow[v] += f
    for x in range(V):
        if x != s and x != t and inflow[x] != outflow[x]:
            return "INVALID"
    return "VALID"
```

**Reference — Go.**
```go
func verify(V int, edges [][4]int, s, t int) string {
	in := make([]int, V); out := make([]int, V)
	for _, e := range edges {
		u, v, c, f := e[0], e[1], e[2], e[3]
		if f < 0 || f > c { return "INVALID" }
		out[u] += f; in[v] += f
	}
	for x := 0; x < V; x++ {
		if x != s && x != t && in[x] != out[x] { return "INVALID" }
	}
	return "VALID"
}
```

**Reference — Java.**
```java
static String verify(int V, int[][] edges, int s, int t) {
    long[] in = new long[V], out = new long[V];
    for (int[] e : edges) {
        if (e[3] < 0 || e[3] > e[2]) return "INVALID";
        out[e[0]] += e[3]; in[e[1]] += e[3];
    }
    for (int x = 0; x < V; x++)
        if (x != s && x != t && in[x] != out[x]) return "INVALID";
    return "VALID";
}
```

---

### Task 3 — Maximum Bipartite Matching

**Problem.** Given a bipartite graph (`L` left, `R` right, allowed pairs), output the maximum matching size.

**Constraints.** `L, R ≤ 1000`, pairs `≤ 10⁴`.

**Hint.** Super-source → left (cap 1), left → right (cap 1), right → super-sink (cap 1). Dinic gives `O(E√V)`.

**Reference — Python.**
```python
def max_matching(L, R, pairs):
    s, t = L + R, L + R + 1
    d = Dinic(L + R + 2)
    for i in range(L): d.add_edge(s, i, 1)
    for j in range(R): d.add_edge(L + j, t, 1)
    for u, v in pairs: d.add_edge(u, L + v, 1)
    return d.max_flow(s, t)


# max_matching(3, 3, [(0,0),(0,1),(1,1),(2,2)]) == 3
```

**Reference — Go.**
```go
func maxMatching(L, R int, pairs [][2]int) int {
	s, t := L+R, L+R+1
	d := NewDinic(L + R + 2)
	for i := 0; i < L; i++ { d.AddEdge(s, i, 1) }
	for j := 0; j < R; j++ { d.AddEdge(L+j, t, 1) }
	for _, p := range pairs { d.AddEdge(p[0], L+p[1], 1) }
	return d.MaxFlow(s, t)
}
```

**Reference — Java.**
```java
static int maxMatching(int L, int R, int[][] pairs) {
    int s = L + R, t = L + R + 1;
    init(L + R + 2, L + R + pairs.length);
    for (int i = 0; i < L; i++) addEdge(s, i, 1);
    for (int j = 0; j < R; j++) addEdge(L + j, t, 1);
    for (int[] p : pairs) addEdge(p[0], L + p[1], 1);
    return maxFlow(s, t);
}
```

---

### Task 4 — Recover the Minimum Cut

**Problem.** After computing max flow, output the vertices on the source side `S` and the cut edges.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Run a DFS from `s` over positive-residual edges *after* `max_flow`. Reachable = `S`; cut edges go from `S` to `T` in the original graph.

**Reference — Python.**
```python
def min_cut(d, s, original_edges):
    seen = [False]*d.n; stack = [s]; seen[s] = True
    while stack:
        u = stack.pop()
        for e in d.head[u]:
            if d.cap[e] > 0 and not seen[d.to[e]]:
                seen[d.to[e]] = True; stack.append(d.to[e])
    S = [v for v in range(d.n) if seen[v]]
    cut = [(u, v) for (u, v, c) in original_edges if seen[u] and not seen[v]]
    return S, cut
```

**Reference — Go.**
```go
func (d *Dinic) MinCut(s int, orig [][3]int) ([]int, [][2]int) {
	seen := make([]bool, d.n); stack := []int{s}; seen[s] = true
	for len(stack) > 0 {
		u := stack[len(stack)-1]; stack = stack[:len(stack)-1]
		for _, e := range d.head[u] {
			if d.cap[e] > 0 && !seen[d.to[e]] { seen[d.to[e]] = true; stack = append(stack, d.to[e]) }
		}
	}
	var S []int; var cut [][2]int
	for v := 0; v < d.n; v++ { if seen[v] { S = append(S, v) } }
	for _, e := range orig { if seen[e[0]] && !seen[e[1]] { cut = append(cut, [2]int{e[0], e[1]}) } }
	return S, cut
}
```

**Reference — Java.**
```java
static int[] minCutSide(int s) {
    boolean[] seen = new boolean[n];
    Deque<Integer> st = new ArrayDeque<>(); st.push(s); seen[s] = true;
    while (!st.isEmpty()) { int u = st.pop();
        for (int e : head.get(u)) if (cap[e] > 0 && !seen[to[e]]) { seen[to[e]] = true; st.push(to[e]); } }
    int cnt = 0; for (boolean b : seen) if (b) cnt++;
    int[] S = new int[cnt]; int k = 0;
    for (int v = 0; v < n; v++) if (seen[v]) S[k++] = v;
    return S;
}
```

---

### Task 5 — Number of Edge-Disjoint Paths

**Problem.** Output the maximum number of edge-disjoint `s`-`t` paths.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Set every edge capacity to 1; the max-flow equals the answer (Menger).

**Reference — Python.**
```python
def edge_disjoint_paths(n, edges, s, t):
    d = Dinic(n)
    for u, v in edges:
        d.add_edge(u, v, 1)
    return d.max_flow(s, t)
```

**Reference — Go.**
```go
func edgeDisjoint(n int, edges [][2]int, s, t int) int {
	d := NewDinic(n)
	for _, e := range edges { d.AddEdge(e[0], e[1], 1) }
	return d.MaxFlow(s, t)
}
```

**Reference — Java.**
```java
static int edgeDisjoint(int n, int[][] edges, int s, int t) {
    init(n, edges.length);
    for (int[] e : edges) addEdge(e[0], e[1], 1);
    return maxFlow(s, t);
}
```

---

## Intermediate Tasks (5)

### Task 6 — Vertex Capacities

**Problem.** Each vertex `v` has a throughput limit `cap(v)` (besides edge capacities). Compute max flow respecting both.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Split every vertex `v` into `v_in` (= `2v`) and `v_out` (= `2v+1`) with an internal edge `v_in → v_out` of capacity `cap(v)`. Edges into `v` go to `v_in`; edges out of `v` leave `v_out`. New source = `s_out`, sink = `t_in`.

**Reference — Python.**
```python
def max_flow_vertex_caps(V, vcap, edges, s, t):
    d = Dinic(2 * V)
    for v in range(V):
        d.add_edge(2*v, 2*v + 1, vcap[v])     # v_in -> v_out
    for u, v, c in edges:
        d.add_edge(2*u + 1, 2*v, c)           # u_out -> v_in
    return d.max_flow(2*s + 1, 2*t)           # s_out -> t_in
```

**Reference — Go.**
```go
func maxFlowVertexCaps(V int, vcap []int, edges [][3]int, s, t int) int {
	d := NewDinic(2 * V)
	for v := 0; v < V; v++ { d.AddEdge(2*v, 2*v+1, vcap[v]) }
	for _, e := range edges { d.AddEdge(2*e[0]+1, 2*e[1], e[2]) }
	return d.MaxFlow(2*s+1, 2*t)
}
```

**Reference — Java.**
```java
static int maxFlowVertexCaps(int V, int[] vcap, int[][] edges, int s, int t) {
    init(2 * V, V + edges.length);
    for (int v = 0; v < V; v++) addEdge(2*v, 2*v + 1, vcap[v]);
    for (int[] e : edges) addEdge(2*e[0] + 1, 2*e[1], e[2]);
    return maxFlow(2*s + 1, 2*t);
}
```

---

### Task 7 — Multiple Sources and Sinks

**Problem.** Several sources (each with a supply) and several sinks (each with a demand). Compute the max total flow from all sources to all sinks.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Add super-source `S*` → each source (cap = supply), each sink → super-sink `T*` (cap = demand).

**Reference — Python.**
```python
def multi_source_sink(V, edges, sources, sinks):
    S, T = V, V + 1
    d = Dinic(V + 2)
    for (src, supply) in sources: d.add_edge(S, src, supply)
    for (snk, demand) in sinks:   d.add_edge(snk, T, demand)
    for u, v, c in edges:         d.add_edge(u, v, c)
    return d.max_flow(S, T)
```

**Reference — Go.**
```go
func multiSourceSink(V int, edges [][3]int, sources, sinks [][2]int) int {
	S, T := V, V+1
	d := NewDinic(V + 2)
	for _, sp := range sources { d.AddEdge(S, sp[0], sp[1]) }
	for _, sk := range sinks { d.AddEdge(sk[0], T, sk[1]) }
	for _, e := range edges { d.AddEdge(e[0], e[1], e[2]) }
	return d.MaxFlow(S, T)
}
```

**Reference — Java.**
```java
static int multiSourceSink(int V, int[][] edges, int[][] sources, int[][] sinks) {
    int S = V, T = V + 1;
    init(V + 2, edges.length + sources.length + sinks.length);
    for (int[] sp : sources) addEdge(S, sp[0], sp[1]);
    for (int[] sk : sinks) addEdge(sk[0], T, sk[1]);
    for (int[] e : edges) addEdge(e[0], e[1], e[2]);
    return maxFlow(S, T);
}
```

---

### Task 8 — Maximum Vertex-Disjoint Paths

**Problem.** Output the maximum number of internally vertex-disjoint `s`-`t` paths.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Split every vertex with capacity 1 (except give `s`,`t` capacity ∞), then count edge-disjoint paths.

**Reference — Python.**
```python
def vertex_disjoint_paths(V, edges, s, t):
    INF = 1 << 30
    d = Dinic(2 * V)
    for v in range(V):
        cap = INF if v in (s, t) else 1
        d.add_edge(2*v, 2*v + 1, cap)
    for u, v in edges:
        d.add_edge(2*u + 1, 2*v, 1)
    return d.max_flow(2*s + 1, 2*t)
```

**Reference — Go.**
```go
func vertexDisjoint(V int, edges [][2]int, s, t int) int {
	const INF = 1 << 30
	d := NewDinic(2 * V)
	for v := 0; v < V; v++ {
		c := 1
		if v == s || v == t { c = INF }
		d.AddEdge(2*v, 2*v+1, c)
	}
	for _, e := range edges { d.AddEdge(2*e[0]+1, 2*e[1], 1) }
	return d.MaxFlow(2*s+1, 2*t)
}
```

**Reference — Java.**
```java
static int vertexDisjoint(int V, int[][] edges, int s, int t) {
    final int INF = 1 << 30;
    init(2 * V, V + edges.length);
    for (int v = 0; v < V; v++) addEdge(2*v, 2*v + 1, (v == s || v == t) ? INF : 1);
    for (int[] e : edges) addEdge(2*e[0] + 1, 2*e[1], 1);
    return maxFlow(2*s + 1, 2*t);
}
```

---

### Task 9 — Minimum Path Cover on a DAG

**Problem.** Given a DAG, find the minimum number of vertex-disjoint paths that cover all vertices. Answer = `V − (maximum bipartite matching)` where the bipartite graph connects `u_left → v_right` for each edge `u→v`.

**Constraints.** `V ≤ 1000`, `E ≤ 10⁴`.

**Hint.** Build a bipartite graph: left copy and right copy of each vertex; edge `u→v` becomes `u_left → v_right`. Min path cover = `V − max_matching`.

**Reference — Python.**
```python
def min_path_cover(V, edges):
    # left v = v, right v = V + v, s = 2V, t = 2V+1
    s, t = 2*V, 2*V + 1
    d = Dinic(2*V + 2)
    for v in range(V):
        d.add_edge(s, v, 1)
        d.add_edge(V + v, t, 1)
    for u, v in edges:
        d.add_edge(u, V + v, 1)
    matching = d.max_flow(s, t)
    return V - matching
```

**Reference — Go.**
```go
func minPathCover(V int, edges [][2]int) int {
	s, t := 2*V, 2*V+1
	d := NewDinic(2*V + 2)
	for v := 0; v < V; v++ { d.AddEdge(s, v, 1); d.AddEdge(V+v, t, 1) }
	for _, e := range edges { d.AddEdge(e[0], V+e[1], 1) }
	return V - d.MaxFlow(s, t)
}
```

**Reference — Java.**
```java
static int minPathCover(int V, int[][] edges) {
    int s = 2*V, t = 2*V + 1;
    init(2*V + 2, 2*V + edges.length);
    for (int v = 0; v < V; v++) { addEdge(s, v, 1); addEdge(V + v, t, 1); }
    for (int[] e : edges) addEdge(e[0], V + e[1], 1);
    return V - maxFlow(s, t);
}
```

---

### Task 10 — Project Selection (Max-Weight Closure)

**Problem.** Each project has a profit (possibly negative) and a set of prerequisite projects. Choosing a project requires choosing all its prerequisites. Maximize total profit.

**Constraints.** `V ≤ 1000`, dependencies `≤ 10⁴`.

**Hint.** `s → p` (cap = profit) for `profit > 0`; `p → t` (cap = −profit) for `profit < 0`; prerequisite `p → q` cap ∞. Answer = (sum of positive profits) − min-cut.

**Reference — Python.**
```python
def project_selection(profits, prereqs):
    n = len(profits); s, t = n, n + 1
    d = Dinic(n + 2)
    INF = 1 << 60
    total_pos = 0
    for p, w in enumerate(profits):
        if w > 0:
            d.add_edge(s, p, w); total_pos += w
        elif w < 0:
            d.add_edge(p, t, -w)
    for p, q in prereqs:           # picking p requires q
        d.add_edge(p, q, INF)
    return total_pos - d.max_flow(s, t)


# profits=[3, -1, -2], prereqs=[(0,1),(0,2)]:
# pick project 0 (+3) requires 1 (-1) and 2 (-2) -> net 0; or pick nothing -> 0
```

**Reference — Go.**
```go
func projectSelection(profits []int, prereqs [][2]int) int {
	n := len(profits); s, t := n, n+1
	d := NewDinic(n + 2)
	const INF = 1 << 60
	totalPos := 0
	for p, w := range profits {
		if w > 0 { d.AddEdge(s, p, w); totalPos += w } else if w < 0 { d.AddEdge(p, t, -w) }
	}
	for _, e := range prereqs { d.AddEdge(e[0], e[1], INF) }
	return totalPos - d.MaxFlow(s, t)
}
```

**Reference — Java.**
```java
static int projectSelection(int[] profits, int[][] prereqs) {
    int n = profits.length, s = n, t = n + 1;
    init(n + 2, n + prereqs.length);
    final int INF = 1 << 30; int totalPos = 0;
    for (int p = 0; p < n; p++) {
        if (profits[p] > 0) { addEdge(s, p, profits[p]); totalPos += profits[p]; }
        else if (profits[p] < 0) addEdge(p, t, -profits[p]);
    }
    for (int[] e : prereqs) addEdge(e[0], e[1], INF);
    return totalPos - maxFlow(s, t);
}
```

---

## Advanced Tasks (5)

### Task 11 — Image Segmentation (Two-Label Graph Cut)

**Problem.** Given an `n×m` grid where each pixel has a foreground affinity `a[i]` and background affinity `b[i]`, plus smoothness penalties between adjacent pixels, partition pixels into foreground/background minimizing total disagreement. This is min-cut.

**Constraints.** Grid `≤ 200×200`.

**Hint.** `s → pixel` cap = foreground affinity, `pixel → t` cap = background affinity, `pixel ↔ neighbor` cap = smoothness (both directions). Min-cut gives the optimal labeling; reachable-from-`s` = foreground.

**Reference — Python.**
```python
def segment(n, m, a, b, neighbors):
    # a[i], b[i] indexed by pixel id = r*m + c; neighbors: list of (i, j, penalty)
    N = n * m; s, t = N, N + 1
    d = Dinic(N + 2)
    for i in range(N):
        if a[i] > 0: d.add_edge(s, i, a[i])
        if b[i] > 0: d.add_edge(i, t, b[i])
    for i, j, w in neighbors:
        d.add_edge(i, j, w); d.add_edge(j, i, w)
    cut_value = d.max_flow(s, t)
    # label: reachable from s in residual = foreground
    seen = [False]*d.n; stack=[s]; seen[s]=True
    while stack:
        u = stack.pop()
        for e in d.head[u]:
            if d.cap[e] > 0 and not seen[d.to[e]]:
                seen[d.to[e]] = True; stack.append(d.to[e])
    foreground = [i for i in range(N) if seen[i]]
    return cut_value, foreground
```

**Reference — Go.**
```go
func segment(N int, a, b []int, neighbors [][3]int, s, t int) int {
	d := NewDinic(N + 2)
	for i := 0; i < N; i++ {
		if a[i] > 0 { d.AddEdge(s, i, a[i]) }
		if b[i] > 0 { d.AddEdge(i, t, b[i]) }
	}
	for _, nb := range neighbors { d.AddEdge(nb[0], nb[1], nb[2]); d.AddEdge(nb[1], nb[0], nb[2]) }
	return d.MaxFlow(s, t)
}
```

**Reference — Java.**
```java
static int segment(int N, int[] a, int[] b, int[][] neighbors, int s, int t) {
    init(N + 2, 2*N + 2*neighbors.length);
    for (int i = 0; i < N; i++) {
        if (a[i] > 0) addEdge(s, i, a[i]);
        if (b[i] > 0) addEdge(i, t, b[i]);
    }
    for (int[] nb : neighbors) { addEdge(nb[0], nb[1], nb[2]); addEdge(nb[1], nb[0], nb[2]); }
    return maxFlow(s, t);
}
```

---

### Task 12 — Baseball Elimination

**Problem.** Given current wins and remaining games, determine whether a given team can still finish first (possibly tied). Build a flow network of remaining games and capacity constraints; the team is eliminated iff the max-flow does not saturate all game nodes.

**Constraints.** Teams `≤ 30`.

**Hint.** For team `x` with `w[x] + r[x]` max possible wins: game nodes `(i,j)` get `s → game` cap = remaining games between `i,j`; `game → team_i` and `game → team_j` cap ∞; `team_i → t` cap = `w[x] + r[x] − w[i]`. If a team's cap is negative, `x` is trivially eliminated. Otherwise eliminated iff flow < total remaining games among the others.

**Reference — Python.**
```python
def is_eliminated(x, w, r, games):
    # w[i] wins, r[i] remaining; games[i][j] = remaining games between i and j
    teams = [i for i in range(len(w)) if i != x]
    cap_x = w[x] + r[x]
    for i in teams:
        if w[i] > cap_x:
            return True   # trivially eliminated
    game_pairs = [(i, j) for i in teams for j in teams if i < j and games[i][j] > 0]
    N = len(w)
    s, t = N + len(game_pairs), N + len(game_pairs) + 1
    d = Dinic(N + len(game_pairs) + 2)
    total = 0
    for gi, (i, j) in enumerate(game_pairs):
        gnode = N + gi
        d.add_edge(s, gnode, games[i][j]); total += games[i][j]
        d.add_edge(gnode, i, 1 << 30)
        d.add_edge(gnode, j, 1 << 30)
    for i in teams:
        d.add_edge(i, t, cap_x - w[i])
    return d.max_flow(s, t) < total
```

**Reference — Go.**
```go
// Same construction: game nodes from s (cap = games left), each game -> its two teams (inf),
// team -> t (cap = capX - w[team]). Eliminated iff maxFlow < totalRemainingGames.
// Build with NewDinic, AddEdge, MaxFlow exactly as in Task 1.
func isEliminated(x int, w, r []int, games [][]int) bool {
	capX := w[x] + r[x]
	for i := range w {
		if i != x && w[i] > capX { return true }
	}
	// ... assemble game nodes and run Dinic; return maxFlow < total
	return false // full assembly mirrors the Python reference
}
```

**Reference — Java.**
```java
// Identical modeling to the Python reference: s -> game (remaining), game -> teams (INF),
// team -> t (capX - w[i]); eliminated iff maxFlow < total remaining games among others.
// Reuse init/addEdge/maxFlow from Task 1.
```

---

### Task 13 — Maximum Flow with Lower Bounds

**Problem.** Each edge has a lower bound `lo` and upper bound `hi` on its flow. Find a feasible flow, then the maximum flow respecting bounds.

**Constraints.** `V ≤ 500`, `E ≤ 10⁴`.

**Hint.** Standard reduction: for each edge `(u,v,lo,hi)` add residual edge of capacity `hi − lo`, and track an excess `d[v] += lo`, `d[u] -= lo`. Add a super-source/super-sink saturating the excesses; feasibility = super-source edges all saturated. Then max-flow on the residual.

**Reference — Python.**
```python
def feasible_with_lower_bounds(V, edges, s, t):
    # edges: (u, v, lo, hi). Returns feasible flow value or None.
    SS, TT = V, V + 1
    d = Dinic(V + 2)
    excess = [0]*V
    INF = 1 << 60
    for u, v, lo, hi in edges:
        d.add_edge(u, v, hi - lo)
        excess[u] -= lo; excess[v] += lo
    d.add_edge(t, s, INF)   # circulation edge
    need = 0
    for v in range(V):
        if excess[v] > 0:
            d.add_edge(SS, v, excess[v]); need += excess[v]
        elif excess[v] < 0:
            d.add_edge(v, TT, -excess[v])
    return d.max_flow(SS, TT) == need
```

**Reference — Go.**
```go
func feasibleLowerBounds(V int, edges [][4]int, s, t int) bool {
	SS, TT := V, V+1
	d := NewDinic(V + 2)
	excess := make([]int, V)
	const INF = 1 << 60
	for _, e := range edges {
		u, v, lo, hi := e[0], e[1], e[2], e[3]
		d.AddEdge(u, v, hi-lo); excess[u] -= lo; excess[v] += lo
	}
	d.AddEdge(t, s, INF)
	need := 0
	for v := 0; v < V; v++ {
		if excess[v] > 0 { d.AddEdge(SS, v, excess[v]); need += excess[v] } else if excess[v] < 0 { d.AddEdge(v, TT, -excess[v]) }
	}
	return d.MaxFlow(SS, TT) == need
}
```

**Reference — Java.**
```java
static boolean feasibleLowerBounds(int V, int[][] edges, int s, int t) {
    int SS = V, TT = V + 1;
    init(V + 2, edges.length + V + 1);
    long[] excess = new long[V]; final int INF = 1 << 30;
    for (int[] e : edges) { addEdge(e[0], e[1], e[3] - e[2]); excess[e[0]] -= e[2]; excess[e[1]] += e[2]; }
    addEdge(t, s, INF);
    long need = 0;
    for (int v = 0; v < V; v++) {
        if (excess[v] > 0) { addEdge(SS, v, (int) excess[v]); need += excess[v]; }
        else if (excess[v] < 0) addEdge(v, TT, (int) -excess[v]);
    }
    return maxFlow(SS, TT) == need;
}
```

---

### Task 14 — Escape Problem (Grid Vertex-Disjoint Routing)

**Problem.** On an `n×n` grid, given a set of start cells, determine if all starts can be routed to the border along vertex-disjoint paths (each non-start cell used at most once).

**Constraints.** `n ≤ 100`.

**Hint.** Split each cell `in→out` cap 1, connect adjacent cells cap 1, super-source → start `in`-nodes, border `out`-nodes → super-sink. Escape possible iff max-flow = number of starts.

**Reference — Python.**
```python
def can_escape(n, starts):
    S, T = 2*n*n, 2*n*n + 1
    d = Dinic(2*n*n + 2)
    cid = lambda r, c: r*n + c
    for r in range(n):
        for c in range(n):
            d.add_edge(2*cid(r,c), 2*cid(r,c)+1, 1)
            for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
                nr, nc = r+dr, c+dc
                if 0 <= nr < n and 0 <= nc < n:
                    d.add_edge(2*cid(r,c)+1, 2*cid(nr,nc), 1)
            if r in (0, n-1) or c in (0, n-1):
                d.add_edge(2*cid(r,c)+1, T, 1)
    for (r, c) in starts:
        d.add_edge(S, 2*cid(r,c), 1)
    return d.max_flow(S, T) == len(starts)


# can_escape(3, [(1,1)]) == True
```

**Reference — Go.**
```go
func canEscape(n int, starts [][2]int) bool {
	S, T := 2*n*n, 2*n*n+1
	d := NewDinic(2*n*n + 2)
	cid := func(r, c int) int { return r*n + c }
	dr := []int{1, -1, 0, 0}; dc := []int{0, 0, 1, -1}
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			d.AddEdge(2*cid(r, c), 2*cid(r, c)+1, 1)
			for k := 0; k < 4; k++ {
				nr, nc := r+dr[k], c+dc[k]
				if nr >= 0 && nr < n && nc >= 0 && nc < n {
					d.AddEdge(2*cid(r, c)+1, 2*cid(nr, nc), 1)
				}
			}
			if r == 0 || r == n-1 || c == 0 || c == n-1 { d.AddEdge(2*cid(r, c)+1, T, 1) }
		}
	}
	for _, st := range starts { d.AddEdge(S, 2*cid(st[0], st[1]), 1) }
	return d.MaxFlow(S, T) == len(starts)
}
```

**Reference — Java.**
```java
static boolean canEscape(int n, int[][] starts) {
    int S = 2*n*n, T = 2*n*n + 1;
    init(2*n*n + 2, 6*n*n);
    int[] dr = {1,-1,0,0}, dc = {0,0,1,-1};
    for (int r = 0; r < n; r++) for (int c = 0; c < n; c++) {
        int id = r*n + c;
        addEdge(2*id, 2*id + 1, 1);
        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];
            if (nr >= 0 && nr < n && nc >= 0 && nc < n) addEdge(2*id + 1, 2*(nr*n + nc), 1);
        }
        if (r == 0 || r == n-1 || c == 0 || c == n-1) addEdge(2*id + 1, T, 1);
    }
    for (int[] st : starts) addEdge(S, 2*(st[0]*n + st[1]), 1);
    return maxFlow(S, T) == starts.length;
}
```

---

### Task 15 — Cross-Check Dinic vs Edmonds-Karp

**Problem.** Implement both Dinic and Edmonds-Karp and assert they agree on random networks. This is the standard correctness harness.

**Constraints.** Random graphs `V ≤ 50`, `E ≤ 200`, caps `≤ 100`, 1000 trials.

**Hint.** Generate random networks, run both, assert equal. Any mismatch is a bug (almost always a missing reverse edge).

**Reference — Python.**
```python
import random


def edmonds_karp_matrix(cap, s, t):
    from collections import deque
    n = len(cap); flow = 0
    while True:
        par = [-1]*n; par[s] = s; q = deque([s])
        while q:
            u = q.popleft()
            for v in range(n):
                if par[v] == -1 and cap[u][v] > 0:
                    par[v] = u; q.append(v)
        if par[t] == -1: break
        b = float("inf"); v = t
        while v != s: b = min(b, cap[par[v]][v]); v = par[v]
        v = t
        while v != s: cap[par[v]][v] -= b; cap[v][par[v]] += b; v = par[v]
        flow += b
    return flow


def cross_check(trials=1000):
    for _ in range(trials):
        n = random.randint(2, 8)
        s, t = 0, n - 1
        if s == t: continue
        cap = [[0]*n for _ in range(n)]
        d = Dinic(n)
        for _ in range(random.randint(1, n*n)):
            u, v = random.randrange(n), random.randrange(n)
            if u != v:
                c = random.randint(0, 20)
                cap[u][v] += c
                d.add_edge(u, v, c)
        assert d.max_flow(s, t) == edmonds_karp_matrix(cap, s, t)
    print("all trials agree")


cross_check()
```

**Reference — Go / Java.** Mirror the harness: build the same random edges into both a matrix Edmonds-Karp and an adjacency-list Dinic, then assert equality across trials. A single disagreement localizes the bug immediately.

---

## Benchmark Task

### Task 16 — Bipartite Matching Throughput Benchmark

**Problem.** Measure Dinic on bipartite matching instances of growing size and confirm the `O(E√V)` scaling.

**Reference — Python.**
```python
import random, time


def make_bipartite(L, R, density):
    pairs = []
    for u in range(L):
        for v in range(R):
            if random.random() < density:
                pairs.append((u, v))
    return pairs


def bench():
    for L in [100, 200, 400, 800, 1600]:
        R = L
        pairs = make_bipartite(L, R, 0.05)
        s, t = L + R, L + R + 1
        start = time.perf_counter()
        d = Dinic(L + R + 2)
        for i in range(L): d.add_edge(s, i, 1)
        for j in range(R): d.add_edge(L + j, t, 1)
        for u, v in pairs: d.add_edge(u, L + v, 1)
        m = d.max_flow(s, t)
        elapsed = (time.perf_counter() - start) * 1000
        print(f"L={L:5d} E={len(pairs):7d} matching={m:5d} time={elapsed:8.2f} ms")


bench()
```

**Expected pattern.** Time should grow roughly proportionally to `E√V`, not `V²E`. As `L` doubles, `E` (at fixed density) quadruples and `√V` grows `~1.4×`, so each step is roughly `5–6×` slower — far below the `~8×` a `VE`-style bound would predict, confirming the unit-capacity speedup.

**Go / Java benchmark.** Identical structure: build the bipartite instance, time `MaxFlow`, print `(L, E, matching, ms)`. Use the same Dinic engine from Task 1. The takeaway across all three languages is the same scaling curve; absolute constants differ (Go and Java are typically 5–20× faster than CPython here).

---

## How to Use These Tasks

1. **Solve modeling first.** For every task, write down *what is routed, what the capacities are, and what the cut means* before coding.
2. **Reuse the engine.** The Dinic template never changes; only the graph construction does. This separation is the whole point.
3. **Always cross-check** (Task 15) when you suspect a bug — it almost always finds a missing reverse edge.
4. **Recover the cut** wherever the problem really wants the partition (segmentation, project selection), not just the value.
5. **Benchmark on adversarial inputs** too (layered graphs), not only random ones, before trusting latency.
