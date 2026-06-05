# Edge & Vertex Connectivity — Practice Tasks

> **One-line summary:** Fifteen graded problems (5 beginner, 5 intermediate, 5 advanced) plus a benchmark, each with a statement, constraints, hints, and full Go / Java / Python solutions covering `λ`, `κ`, Menger, node-splitting, Stoer–Wagner, Gomory–Hu, and `k`-connectivity testing.

---

## Table of Contents

- [Beginner](#beginner)
  - [B1. Minimum Degree Bound](#b1-minimum-degree-bound)
  - [B2. Is the Graph Connected?](#b2-is-the-graph-connected)
  - [B3. s-t Edge Connectivity](#b3-s-t-edge-connectivity)
  - [B4. Count Edge-Disjoint Paths](#b4-count-edge-disjoint-paths)
  - [B5. Detect a Bridge (λ = 1)](#b5-detect-a-bridge-λ--1)
- [Intermediate](#intermediate)
  - [I1. s-t Vertex Connectivity (Node Splitting)](#i1-s-t-vertex-connectivity-node-splitting)
  - [I2. Global Edge Connectivity via Flow](#i2-global-edge-connectivity-via-flow)
  - [I3. Stoer–Wagner Global Min-Cut](#i3-stoerwagner-global-min-cut)
  - [I4. Recover the Cut Edges](#i4-recover-the-cut-edges)
  - [I5. k-Edge-Connectivity Test (early exit)](#i5-k-edge-connectivity-test-early-exit)
- [Advanced](#advanced)
  - [A1. Global Vertex Connectivity κ(G)](#a1-global-vertex-connectivity-κg)
  - [A2. Gomory–Hu Tree (Gusfield)](#a2-gomoryhu-tree-gusfield)
  - [A3. Minimum Edges to Make 2-Edge-Connected](#a3-minimum-edges-to-make-2-edge-connected)
  - [A4. Weighted Min-Cut Partition Recovery](#a4-weighted-min-cut-partition-recovery)
  - [A5. Karger Randomized Min-Cut](#a5-karger-randomized-min-cut)
- [Benchmark](#benchmark)

---

## Beginner

### B1. Minimum Degree Bound

**Statement.** Given an undirected graph as `n` and an edge list, return `δ(G)`, the minimum degree. This is the cheap upper bound on both `λ` and `κ`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ m ≤ 2·10⁵`. No self-loops.

**Hints.**
- Count the degree of each vertex by scanning edges once.
- An isolated vertex has degree 0, so `δ` can be 0.

#### Go

```go
package main

import "fmt"

func minDegree(n int, edges [][2]int) int {
	deg := make([]int, n)
	for _, e := range edges {
		deg[e[0]]++
		deg[e[1]]++
	}
	best := deg[0]
	for _, d := range deg {
		if d < best {
			best = d
		}
	}
	return best
}

func main() {
	fmt.Println(minDegree(4, [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}})) // 1 (vertex 3)
}
```

#### Java

```java
public class MinDegree {
    static int minDegree(int n, int[][] edges) {
        int[] deg = new int[n];
        for (int[] e : edges) { deg[e[0]]++; deg[e[1]]++; }
        int best = deg[0];
        for (int d : deg) best = Math.min(best, d);
        return best;
    }
    public static void main(String[] a) {
        System.out.println(minDegree(4, new int[][]{{0,1},{1,2},{2,0},{1,3}})); // 1
    }
}
```

#### Python

```python
def min_degree(n, edges):
    deg = [0] * n
    for u, v in edges:
        deg[u] += 1
        deg[v] += 1
    return min(deg)


if __name__ == "__main__":
    print(min_degree(4, [(0, 1), (1, 2), (2, 0), (1, 3)]))  # 1
```

---

### B2. Is the Graph Connected?

**Statement.** Return `True` if the undirected graph is connected (`λ ≥ 1`), else `False`. Disconnected graphs have `λ = κ = 0`.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hints.**
- A single BFS/DFS from vertex 0; check all vertices visited.
- `n = 1` is connected by convention.

#### Go

```go
package main

import "fmt"

func isConnected(n int, edges [][2]int) bool {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	seen := make([]bool, n)
	stack := []int{0}
	seen[0] = true
	count := 1
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, v := range adj[u] {
			if !seen[v] {
				seen[v] = true
				count++
				stack = append(stack, v)
			}
		}
	}
	return count == n
}

func main() {
	fmt.Println(isConnected(4, [][2]int{{0, 1}, {1, 2}, {2, 3}})) // true
}
```

#### Java

```java
import java.util.*;

public class Connected {
    static boolean isConnected(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) { adj.get(e[0]).add(e[1]); adj.get(e[1]).add(e[0]); }
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(0); seen[0] = true; int count = 1;
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int v : adj.get(u)) if (!seen[v]) { seen[v] = true; count++; st.push(v); }
        }
        return count == n;
    }
    public static void main(String[] a) {
        System.out.println(isConnected(4, new int[][]{{0,1},{1,2},{2,3}})); // true
    }
}
```

#### Python

```python
def is_connected(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    seen = [False] * n
    stack = [0]
    seen[0] = True
    count = 1
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if not seen[v]:
                seen[v] = True
                count += 1
                stack.append(v)
    return count == n


if __name__ == "__main__":
    print(is_connected(4, [(0, 1), (1, 2), (2, 3)]))  # True
```

---

### B3. s-t Edge Connectivity

**Statement.** Return the minimum number of edges to delete to disconnect `s` from `t`, i.e. `λ(s, t)`, using unit-capacity max-flow.

**Constraints.** `2 ≤ n ≤ 500`. Undirected.

**Hints.**
- Capacity 1 in *both* directions per undirected edge.
- Each augmenting path adds exactly 1 to the flow.

#### Go

```go
package main

import "fmt"

func stEdgeConn(n int, edges [][2]int, s, t int) int {
	cap := make([][]int, n)
	for i := range cap {
		cap[i] = make([]int, n)
	}
	for _, e := range edges {
		cap[e[0]][e[1]]++
		cap[e[1]][e[0]]++
	}
	flow := 0
	for {
		parent := make([]int, n)
		for i := range parent {
			parent[i] = -1
		}
		parent[s] = s
		q := []int{s}
		for len(q) > 0 && parent[t] == -1 {
			u := q[0]
			q = q[1:]
			for v := 0; v < n; v++ {
				if parent[v] == -1 && cap[u][v] > 0 {
					parent[v] = u
					q = append(q, v)
				}
			}
		}
		if parent[t] == -1 {
			break
		}
		for v := t; v != s; v = parent[v] {
			cap[parent[v]][v]--
			cap[v][parent[v]]++
		}
		flow++
	}
	return flow
}

func main() {
	fmt.Println(stEdgeConn(6, [][2]int{{0, 1}, {1, 5}, {0, 2}, {2, 3}, {3, 4}, {4, 5}, {1, 3}}, 0, 5)) // 2
}
```

#### Java

```java
import java.util.*;

public class StEdgeConn {
    static int conn(int n, int[][] edges, int s, int t) {
        int[][] cap = new int[n][n];
        for (int[] e : edges) { cap[e[0]][e[1]]++; cap[e[1]][e[0]]++; }
        int flow = 0;
        while (true) {
            int[] p = new int[n]; Arrays.fill(p, -1); p[s] = s;
            Deque<Integer> q = new ArrayDeque<>(); q.add(s);
            while (!q.isEmpty() && p[t] == -1) {
                int u = q.poll();
                for (int v = 0; v < n; v++)
                    if (p[v] == -1 && cap[u][v] > 0) { p[v] = u; q.add(v); }
            }
            if (p[t] == -1) break;
            for (int v = t; v != s; v = p[v]) { cap[p[v]][v]--; cap[v][p[v]]++; }
            flow++;
        }
        return flow;
    }
    public static void main(String[] a) {
        System.out.println(conn(6, new int[][]{{0,1},{1,5},{0,2},{2,3},{3,4},{4,5},{1,3}}, 0, 5)); // 2
    }
}
```

#### Python

```python
from collections import deque


def st_edge_conn(n, edges, s, t):
    cap = [[0] * n for _ in range(n)]
    for u, v in edges:
        cap[u][v] += 1
        cap[v][u] += 1
    flow = 0
    while True:
        p = [-1] * n
        p[s] = s
        q = deque([s])
        while q and p[t] == -1:
            u = q.popleft()
            for v in range(n):
                if p[v] == -1 and cap[u][v] > 0:
                    p[v] = u
                    q.append(v)
        if p[t] == -1:
            break
        v = t
        while v != s:
            cap[p[v]][v] -= 1
            cap[v][p[v]] += 1
            v = p[v]
        flow += 1
    return flow


if __name__ == "__main__":
    print(st_edge_conn(6, [(0,1),(1,5),(0,2),(2,3),(3,4),(4,5),(1,3)], 0, 5))  # 2
```

---

### B4. Count Edge-Disjoint Paths

**Statement.** Return the maximum number of edge-disjoint `s-t` paths. By Menger this equals `λ(s, t)`, so it is the same computation as B3 — the point is to *recognize the equivalence*.

**Constraints.** `2 ≤ n ≤ 500`.

**Hints.**
- Do not write a separate path-enumeration; reuse the flow.
- The flow value is the answer; you do not need to list the paths.

#### Go

```go
package main

import "fmt"

// reuse stEdgeConn from B3
func main() {
	fmt.Println(stEdgeConn(4, [][2]int{{0, 1}, {0, 2}, {1, 2}, {2, 3}, {3, 0}}, 0, 2)) // 3
}
```

#### Java

```java
public class DisjointCount {
    public static void main(String[] a) {
        // StEdgeConn.conn(...) from B3 is identical; Menger guarantees equality.
        System.out.println(StEdgeConn.conn(4, new int[][]{{0,1},{0,2},{1,2},{2,3},{3,0}}, 0, 2)); // 3
    }
}
```

#### Python

```python
# from B3 import st_edge_conn — identical by Menger's theorem
if __name__ == "__main__":
    print(st_edge_conn(4, [(0,1),(0,2),(1,2),(2,3),(3,0)], 0, 2))  # 3
```

---

### B5. Detect a Bridge (λ = 1)

**Statement.** Return `True` if the connected undirected graph has a bridge (so `λ = 1`), else `False`, using the linear-time DFS low-link method.

**Constraints.** `1 ≤ n ≤ 10⁵`. Connected.

**Hints.**
- `low[v] > disc[u]` after recursing means `(u, v)` is a bridge.
- Skip the immediate parent edge (handle multi-edges with edge-ids if needed).

#### Go

```go
package main

import "fmt"

func hasBridge(n int, edges [][2]int) bool {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	found := false
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u] = timer
		low[u] = timer
		timer++
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] > disc[u] {
					found = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	dfs(0, -1)
	return found
}

func main() {
	fmt.Println(hasBridge(4, [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}})) // true (edge 1-3)
}
```

#### Java

```java
import java.util.*;

public class HasBridge {
    static int[] disc, low; static List<List<Integer>> adj; static int timer; static boolean found;
    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) found = true;
            } else low[u] = Math.min(low[u], disc[v]);
        }
    }
    static boolean hasBridge(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) { adj.get(e[0]).add(e[1]); adj.get(e[1]).add(e[0]); }
        disc = new int[n]; low = new int[n]; Arrays.fill(disc, -1);
        timer = 0; found = false; dfs(0, -1);
        return found;
    }
    public static void main(String[] a) {
        System.out.println(hasBridge(4, new int[][]{{0,1},{1,2},{2,0},{1,3}})); // true
    }
}
```

#### Python

```python
import sys


def has_bridge(n, edges):
    sys.setrecursionlimit(1 << 20)
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    found = [False]

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    found[0] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    return found[0]


if __name__ == "__main__":
    print(has_bridge(4, [(0, 1), (1, 2), (2, 0), (1, 3)]))  # True
```

---

## Intermediate

### I1. s-t Vertex Connectivity (Node Splitting)

**Statement.** Return `κ(s, t)` for non-adjacent `s, t` using node-splitting + unit max-flow. If `s, t` are adjacent, return `n − 1` by convention.

**Constraints.** `2 ≤ n ≤ 300`.

**Hints.**
- `v_in = 2v`, `v_out = 2v+1`; internal cap 1 (∞ for `s, t`).
- Edge `{u,v}` → `u_out → v_in` and `v_out → u_in` with ∞.
- Source `2s+1`, sink `2t`.

#### Go

```go
package main

import "fmt"

const INF = 1 << 29

func stVertexConn(n int, edges [][2]int, s, t int) int {
	adj := make(map[int]bool)
	for _, e := range edges {
		if (e[0] == s && e[1] == t) || (e[0] == t && e[1] == s) {
			return n - 1
		}
		adj[e[0]*n+e[1]] = true
	}
	_ = adj
	N := 2 * n
	cap := make([][]int, N)
	for i := range cap {
		cap[i] = make([]int, N)
	}
	for v := 0; v < n; v++ {
		if v == s || v == t {
			cap[2*v][2*v+1] = INF
		} else {
			cap[2*v][2*v+1] = 1
		}
	}
	for _, e := range edges {
		cap[2*e[0]+1][2*e[1]] = INF
		cap[2*e[1]+1][2*e[0]] = INF
	}
	src, snk := 2*s+1, 2*t
	flow := 0
	for {
		parent := make([]int, N)
		for i := range parent {
			parent[i] = -1
		}
		parent[src] = src
		q := []int{src}
		for len(q) > 0 && parent[snk] == -1 {
			u := q[0]
			q = q[1:]
			for v := 0; v < N; v++ {
				if parent[v] == -1 && cap[u][v] > 0 {
					parent[v] = u
					q = append(q, v)
				}
			}
		}
		if parent[snk] == -1 {
			break
		}
		b := INF
		for v := snk; v != src; v = parent[v] {
			if cap[parent[v]][v] < b {
				b = cap[parent[v]][v]
			}
		}
		for v := snk; v != src; v = parent[v] {
			cap[parent[v]][v] -= b
			cap[v][parent[v]] += b
		}
		flow += b
	}
	return flow
}

func main() {
	fmt.Println(stVertexConn(4, [][2]int{{0, 1}, {1, 2}, {0, 3}, {3, 2}}, 0, 2)) // 2
}
```

#### Java

```java
import java.util.*;

public class StVertexConn {
    static final int INF = 1 << 29;
    static int conn(int n, int[][] edges, int s, int t) {
        for (int[] e : edges)
            if ((e[0]==s&&e[1]==t)||(e[0]==t&&e[1]==s)) return n - 1;
        int N = 2 * n;
        int[][] cap = new int[N][N];
        for (int v = 0; v < n; v++) cap[2*v][2*v+1] = (v==s||v==t)?INF:1;
        for (int[] e : edges) { cap[2*e[0]+1][2*e[1]] = INF; cap[2*e[1]+1][2*e[0]] = INF; }
        int src = 2*s+1, snk = 2*t, flow = 0;
        while (true) {
            int[] p = new int[N]; Arrays.fill(p, -1); p[src] = src;
            Deque<Integer> q = new ArrayDeque<>(); q.add(src);
            while (!q.isEmpty() && p[snk] == -1) {
                int u = q.poll();
                for (int v = 0; v < N; v++) if (p[v]==-1 && cap[u][v]>0){ p[v]=u; q.add(v); }
            }
            if (p[snk] == -1) break;
            int b = INF;
            for (int v = snk; v != src; v = p[v]) b = Math.min(b, cap[p[v]][v]);
            for (int v = snk; v != src; v = p[v]) { cap[p[v]][v]-=b; cap[v][p[v]]+=b; }
            flow += b;
        }
        return flow;
    }
    public static void main(String[] a) {
        System.out.println(conn(4, new int[][]{{0,1},{1,2},{0,3},{3,2}}, 0, 2)); // 2
    }
}
```

#### Python

```python
from collections import deque

INF = 1 << 29


def st_vertex_conn(n, edges, s, t):
    for u, v in edges:
        if {u, v} == {s, t}:
            return n - 1
    N = 2 * n
    cap = [[0] * N for _ in range(N)]
    for v in range(n):
        cap[2 * v][2 * v + 1] = INF if v in (s, t) else 1
    for u, v in edges:
        cap[2 * u + 1][2 * v] = INF
        cap[2 * v + 1][2 * u] = INF
    src, snk = 2 * s + 1, 2 * t
    flow = 0
    while True:
        p = [-1] * N
        p[src] = src
        q = deque([src])
        while q and p[snk] == -1:
            u = q.popleft()
            for v in range(N):
                if p[v] == -1 and cap[u][v] > 0:
                    p[v] = u
                    q.append(v)
        if p[snk] == -1:
            break
        b = INF
        v = snk
        while v != src:
            b = min(b, cap[p[v]][v])
            v = p[v]
        v = snk
        while v != src:
            cap[p[v]][v] -= b
            cap[v][p[v]] += b
            v = p[v]
        flow += b
    return flow


if __name__ == "__main__":
    print(st_vertex_conn(4, [(0, 1), (1, 2), (0, 3), (3, 2)], 0, 2))  # 2
```

---

### I2. Global Edge Connectivity via Flow

**Statement.** Return `λ(G)` for a connected undirected graph by fixing source 0 and taking the minimum `λ(0, t)` over all other `t`.

**Constraints.** `2 ≤ n ≤ 300`.

**Hints.**
- The global min cut must separate vertex 0 from *some* vertex.
- `n − 1` flow computations suffice; reuse B3's routine on a fresh capacity matrix each time.

#### Go

```go
package main

import "fmt"

func globalLambda(n int, edges [][2]int) int {
	best := 1 << 30
	for t := 1; t < n; t++ {
		c := stEdgeConn(n, edges, 0, t) // fresh matrix each call (from B3)
		if c < best {
			best = c
		}
	}
	return best
}

func main() {
	fmt.Println(globalLambda(6, [][2]int{{0, 1}, {1, 5}, {0, 2}, {2, 3}, {3, 4}, {4, 5}, {1, 3}})) // 2
}
```

#### Java

```java
public class GlobalLambda2 {
    static int globalLambda(int n, int[][] edges) {
        int best = Integer.MAX_VALUE;
        for (int t = 1; t < n; t++)
            best = Math.min(best, StEdgeConn.conn(n, edges, 0, t));
        return best;
    }
    public static void main(String[] a) {
        System.out.println(globalLambda(6, new int[][]{{0,1},{1,5},{0,2},{2,3},{3,4},{4,5},{1,3}})); // 2
    }
}
```

#### Python

```python
def global_lambda(n, edges):
    return min(st_edge_conn(n, edges, 0, t) for t in range(1, n))  # st_edge_conn from B3


if __name__ == "__main__":
    print(global_lambda(6, [(0,1),(1,5),(0,2),(2,3),(3,4),(4,5),(1,3)]))  # 2
```

---

### I3. Stoer–Wagner Global Min-Cut

**Statement.** Return the global minimum cut value of a weighted undirected graph given as a weight matrix.

**Constraints.** `2 ≤ n ≤ 500`, weights `0 ≤ w ≤ 10⁴`.

**Hints.**
- `n − 1` phases; each adds the max-adjacency vertex and updates weights.
- Merge the last two vertices each phase; track `alive`.

#### Go

```go
package main

import "fmt"

func stoerWagner(w [][]int) int {
	n := len(w)
	g := make([][]int, n)
	for i := range g {
		g[i] = append([]int(nil), w[i]...)
	}
	alive := make([]bool, n)
	for i := range alive {
		alive[i] = true
	}
	best := 1 << 30
	for ph := n; ph > 1; ph-- {
		weight := make([]int, n)
		added := make([]bool, n)
		prev, last := -1, -1
		for i := 0; i < ph; i++ {
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
		}
		alive[last] = false
		for v := 0; v < n; v++ {
			g[prev][v] += g[last][v]
			g[v][prev] += g[v][last]
		}
	}
	return best
}

func main() {
	w := [][]int{{0, 3, 1, 0}, {3, 0, 1, 1}, {1, 1, 0, 3}, {0, 1, 3, 0}}
	fmt.Println(stoerWagner(w)) // 3
}
```

#### Java

```java
public class StoerWagner2 {
    static int minCut(int[][] w) {
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        boolean[] alive = new boolean[n]; java.util.Arrays.fill(alive, true);
        int best = Integer.MAX_VALUE;
        for (int ph = n; ph > 1; ph--) {
            int[] weight = new int[n]; boolean[] added = new boolean[n];
            int prev = -1, last = -1;
            for (int i = 0; i < ph; i++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v] && (sel==-1||weight[v]>weight[sel])) sel = v;
                added[sel] = true; prev = last; last = sel;
                for (int v = 0; v < n; v++) if (alive[v] && !added[v]) weight[v] += g[sel][v];
            }
            best = Math.min(best, weight[last]);
            alive[last] = false;
            for (int v = 0; v < n; v++) { g[prev][v]+=g[last][v]; g[v][prev]+=g[v][last]; }
        }
        return best;
    }
    public static void main(String[] a) {
        System.out.println(minCut(new int[][]{{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}})); // 3
    }
}
```

#### Python

```python
def stoer_wagner(w):
    n = len(w)
    g = [row[:] for row in w]
    alive = [True] * n
    best = float("inf")
    for ph in range(n, 1, -1):
        weight = [0] * n
        added = [False] * n
        prev = last = -1
        for _ in range(ph):
            sel = -1
            for v in range(n):
                if alive[v] and not added[v] and (sel == -1 or weight[v] > weight[sel]):
                    sel = v
            added[sel] = True
            prev, last = last, sel
            for v in range(n):
                if alive[v] and not added[v]:
                    weight[v] += g[sel][v]
        best = min(best, weight[last])
        alive[last] = False
        for v in range(n):
            g[prev][v] += g[last][v]
            g[v][prev] += g[v][last]
    return best


if __name__ == "__main__":
    print(stoer_wagner([[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]))  # 3
```

---

### I4. Recover the Cut Edges

**Statement.** Given a weighted undirected graph, return the *set of edges* crossing the global minimum cut (not just its value), using Stoer–Wagner side recovery.

**Constraints.** `2 ≤ n ≤ 300`.

**Hints.**
- Track which original vertices merged into the last super-vertex of the best phase.
- After getting one side `S`, the cut edges are those with exactly one endpoint in `S`.

#### Go

```go
package main

import "fmt"

func minCutEdges(w [][]int) [][2]int {
	n := len(w)
	g := make([][]int, n)
	for i := range g {
		g[i] = append([]int(nil), w[i]...)
	}
	groups := make([][]int, n)
	for i := range groups {
		groups[i] = []int{i}
	}
	alive := make([]bool, n)
	for i := range alive {
		alive[i] = true
	}
	best := 1 << 30
	var side []int
	for ph := n; ph > 1; ph-- {
		weight := make([]int, n)
		added := make([]bool, n)
		prev, last := -1, -1
		for i := 0; i < ph; i++ {
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
			side = append([]int(nil), groups[last]...)
		}
		alive[last] = false
		groups[prev] = append(groups[prev], groups[last]...)
		for v := 0; v < n; v++ {
			g[prev][v] += g[last][v]
			g[v][prev] += g[v][last]
		}
	}
	inS := make([]bool, n)
	for _, v := range side {
		inS[v] = true
	}
	var res [][2]int
	for u := 0; u < n; u++ {
		for v := u + 1; v < n; v++ {
			if w[u][v] > 0 && inS[u] != inS[v] {
				res = append(res, [2]int{u, v})
			}
		}
	}
	return res
}

func main() {
	w := [][]int{{0, 3, 1, 0}, {3, 0, 1, 1}, {1, 1, 0, 3}, {0, 1, 3, 0}}
	fmt.Println(minCutEdges(w)) // edges across the {0,1}|{2,3} cut
}
```

#### Java

```java
import java.util.*;

public class CutEdges {
    static List<int[]> minCutEdges(int[][] w) {
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        List<List<Integer>> groups = new ArrayList<>();
        for (int i = 0; i < n; i++) groups.add(new ArrayList<>(List.of(i)));
        boolean[] alive = new boolean[n]; Arrays.fill(alive, true);
        int best = Integer.MAX_VALUE; List<Integer> side = new ArrayList<>();
        for (int ph = n; ph > 1; ph--) {
            int[] weight = new int[n]; boolean[] added = new boolean[n];
            int prev = -1, last = -1;
            for (int i = 0; i < ph; i++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v] && (sel==-1||weight[v]>weight[sel])) sel = v;
                added[sel] = true; prev = last; last = sel;
                for (int v = 0; v < n; v++) if (alive[v] && !added[v]) weight[v] += g[sel][v];
            }
            if (weight[last] < best) { best = weight[last]; side = new ArrayList<>(groups.get(last)); }
            alive[last] = false; groups.get(prev).addAll(groups.get(last));
            for (int v = 0; v < n; v++) { g[prev][v]+=g[last][v]; g[v][prev]+=g[v][last]; }
        }
        boolean[] inS = new boolean[n];
        for (int v : side) inS[v] = true;
        List<int[]> res = new ArrayList<>();
        for (int u = 0; u < n; u++) for (int v = u+1; v < n; v++)
            if (w[u][v] > 0 && inS[u] != inS[v]) res.add(new int[]{u, v});
        return res;
    }
    public static void main(String[] a) {
        for (int[] e : minCutEdges(new int[][]{{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}}))
            System.out.println(Arrays.toString(e));
    }
}
```

#### Python

```python
def min_cut_edges(w):
    n = len(w)
    g = [row[:] for row in w]
    groups = [[i] for i in range(n)]
    alive = [True] * n
    best, side = float("inf"), []
    for ph in range(n, 1, -1):
        weight = [0] * n
        added = [False] * n
        prev = last = -1
        for _ in range(ph):
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
            best, side = weight[last], groups[last][:]
        alive[last] = False
        groups[prev].extend(groups[last])
        for v in range(n):
            g[prev][v] += g[last][v]
            g[v][prev] += g[v][last]
    in_s = [False] * n
    for v in side:
        in_s[v] = True
    return [(u, v) for u in range(n) for v in range(u + 1, n)
            if w[u][v] > 0 and in_s[u] != in_s[v]]


if __name__ == "__main__":
    print(min_cut_edges([[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]))
```

---

### I5. k-Edge-Connectivity Test (early exit)

**Statement.** Given a connected graph and `k`, decide if `λ(G) ≥ k`. Stop each flow once it reaches `k`.

**Constraints.** `2 ≤ n ≤ 300`.

**Hints.**
- Fix source 0; for each `t`, run flow but cap iterations at `k`.
- If any `λ(0, t) < k`, return `False` immediately.

#### Go

```go
package main

import "fmt"

func stFlowLimited(n int, edges [][2]int, s, t, limit int) int {
	cap := make([][]int, n)
	for i := range cap {
		cap[i] = make([]int, n)
	}
	for _, e := range edges {
		cap[e[0]][e[1]]++
		cap[e[1]][e[0]]++
	}
	flow := 0
	for flow < limit {
		parent := make([]int, n)
		for i := range parent {
			parent[i] = -1
		}
		parent[s] = s
		q := []int{s}
		for len(q) > 0 && parent[t] == -1 {
			u := q[0]
			q = q[1:]
			for v := 0; v < n; v++ {
				if parent[v] == -1 && cap[u][v] > 0 {
					parent[v] = u
					q = append(q, v)
				}
			}
		}
		if parent[t] == -1 {
			break
		}
		for v := t; v != s; v = parent[v] {
			cap[parent[v]][v]--
			cap[v][parent[v]]++
		}
		flow++
	}
	return flow
}

func isKEdgeConnected(n int, edges [][2]int, k int) bool {
	for t := 1; t < n; t++ {
		if stFlowLimited(n, edges, 0, t, k) < k {
			return false
		}
	}
	return true
}

func main() {
	e := [][2]int{{0, 1}, {1, 2}, {2, 0}, {0, 2}}
	fmt.Println(isKEdgeConnected(3, e, 2)) // true
}
```

#### Java

```java
import java.util.*;

public class KEdge {
    static int flowLimited(int n, int[][] edges, int s, int t, int limit) {
        int[][] cap = new int[n][n];
        for (int[] e : edges) { cap[e[0]][e[1]]++; cap[e[1]][e[0]]++; }
        int flow = 0;
        while (flow < limit) {
            int[] p = new int[n]; Arrays.fill(p, -1); p[s] = s;
            Deque<Integer> q = new ArrayDeque<>(); q.add(s);
            while (!q.isEmpty() && p[t] == -1) {
                int u = q.poll();
                for (int v = 0; v < n; v++) if (p[v]==-1 && cap[u][v]>0){ p[v]=u; q.add(v); }
            }
            if (p[t] == -1) break;
            for (int v = t; v != s; v = p[v]) { cap[p[v]][v]--; cap[v][p[v]]++; }
            flow++;
        }
        return flow;
    }
    static boolean isK(int n, int[][] edges, int k) {
        for (int t = 1; t < n; t++) if (flowLimited(n, edges, 0, t, k) < k) return false;
        return true;
    }
    public static void main(String[] a) {
        System.out.println(isK(3, new int[][]{{0,1},{1,2},{2,0},{0,2}}, 2)); // true
    }
}
```

#### Python

```python
from collections import deque


def flow_limited(n, edges, s, t, limit):
    cap = [[0] * n for _ in range(n)]
    for u, v in edges:
        cap[u][v] += 1
        cap[v][u] += 1
    flow = 0
    while flow < limit:
        p = [-1] * n
        p[s] = s
        q = deque([s])
        while q and p[t] == -1:
            u = q.popleft()
            for v in range(n):
                if p[v] == -1 and cap[u][v] > 0:
                    p[v] = u
                    q.append(v)
        if p[t] == -1:
            break
        v = t
        while v != s:
            cap[p[v]][v] -= 1
            cap[v][p[v]] += 1
            v = p[v]
        flow += 1
    return flow


def is_k_edge_connected(n, edges, k):
    return all(flow_limited(n, edges, 0, t, k) >= k for t in range(1, n))


if __name__ == "__main__":
    print(is_k_edge_connected(3, [(0, 1), (1, 2), (2, 0), (0, 2)], 2))  # True
```

---

## Advanced

### A1. Global Vertex Connectivity κ(G)

**Statement.** Compute `κ(G)` for a connected undirected graph. Strategy: `κ ≤ n − 1`; fix a vertex `s`, compute `κ(s, t)` over all non-neighbors `t`, and also `κ(u, w)` over pairs of `s`'s neighbors, taking the minimum.

**Constraints.** `2 ≤ n ≤ 80` (so the `O(κ·V)`-ish flows are affordable).

**Hints.**
- The optimum separator either excludes some vertex `s` (then `s` has a non-neighbor on the far side) or surrounds `s` (covered by neighbor pairs).
- Reuse the node-split flow from I1.

#### Go

```go
package main

import "fmt"

func globalKappa(n int, edges [][2]int) int {
	adjSet := make([]map[int]bool, n)
	for i := range adjSet {
		adjSet[i] = map[int]bool{}
	}
	for _, e := range edges {
		adjSet[e[0]][e[1]] = true
		adjSet[e[1]][e[0]] = true
	}
	best := n - 1
	s := 0
	for t := 0; t < n; t++ {
		if t != s && !adjSet[s][t] {
			if c := stVertexConn(n, edges, s, t); c < best {
				best = c
			}
		}
	}
	neigh := []int{}
	for v := range adjSet[s] {
		neigh = append(neigh, v)
	}
	for i := 0; i < len(neigh); i++ {
		for j := i + 1; j < len(neigh); j++ {
			if !adjSet[neigh[i]][neigh[j]] {
				if c := stVertexConn(n, edges, neigh[i], neigh[j]); c < best {
					best = c
				}
			}
		}
	}
	return best
}

func main() {
	// 4-cycle: kappa = 2
	fmt.Println(globalKappa(4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}})) // 2
}
```

#### Java

```java
import java.util.*;

public class GlobalKappa {
    static int globalKappa(int n, int[][] edges) {
        Set<Integer>[] adj = new HashSet[n];
        for (int i = 0; i < n; i++) adj[i] = new HashSet<>();
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        int best = n - 1, s = 0;
        for (int t = 0; t < n; t++)
            if (t != s && !adj[s].contains(t))
                best = Math.min(best, StVertexConn.conn(n, edges, s, t));
        List<Integer> nb = new ArrayList<>(adj[s]);
        for (int i = 0; i < nb.size(); i++)
            for (int j = i + 1; j < nb.size(); j++)
                if (!adj[nb.get(i)].contains(nb.get(j)))
                    best = Math.min(best, StVertexConn.conn(n, edges, nb.get(i), nb.get(j)));
        return best;
    }
    public static void main(String[] a) {
        System.out.println(globalKappa(4, new int[][]{{0,1},{1,2},{2,3},{3,0}})); // 2
    }
}
```

#### Python

```python
def global_kappa(n, edges):
    adj = [set() for _ in range(n)]
    for u, v in edges:
        adj[u].add(v)
        adj[v].add(u)
    best, s = n - 1, 0
    for t in range(n):
        if t != s and t not in adj[s]:
            best = min(best, st_vertex_conn(n, edges, s, t))  # from I1
    nb = list(adj[s])
    for i in range(len(nb)):
        for j in range(i + 1, len(nb)):
            if nb[j] not in adj[nb[i]]:
                best = min(best, st_vertex_conn(n, edges, nb[i], nb[j]))
    return best


if __name__ == "__main__":
    print(global_kappa(4, [(0, 1), (1, 2), (2, 3), (3, 0)]))  # 2
```

---

### A2. Gomory–Hu Tree (Gusfield)

**Statement.** Build a Gomory–Hu tree of a weighted undirected graph and answer min `s-t` cut queries as the bottleneck edge on the tree path.

**Constraints.** `2 ≤ n ≤ 200`.

**Hints.**
- Gusfield: `parent[i] = 0` initially; for `i = 1..n-1` run max-flow `(i, parent[i])`, set tree weight, then rewire children on `i`'s side.
- A query is the minimum edge weight along the tree path.

#### Go

```go
package main

import "fmt"

func maxFlowVal(w [][]int, s, t int) int {
	n := len(w)
	cap := make([][]int, n)
	for i := range cap {
		cap[i] = append([]int(nil), w[i]...)
	}
	flow := 0
	for {
		parent := make([]int, n)
		for i := range parent {
			parent[i] = -1
		}
		parent[s] = s
		q := []int{s}
		for len(q) > 0 && parent[t] == -1 {
			u := q[0]
			q = q[1:]
			for v := 0; v < n; v++ {
				if parent[v] == -1 && cap[u][v] > 0 {
					parent[v] = u
					q = append(q, v)
				}
			}
		}
		if parent[t] == -1 {
			break
		}
		b := 1 << 30
		for v := t; v != s; v = parent[v] {
			if cap[parent[v]][v] < b {
				b = cap[parent[v]][v]
			}
		}
		for v := t; v != s; v = parent[v] {
			cap[parent[v]][v] -= b
			cap[v][parent[v]] += b
		}
		flow += b
	}
	return flow
}

func reachable(w [][]int, s, t int) []bool {
	// recompute residual side of s after a flow (re-run mincut detection)
	n := len(w)
	cap := make([][]int, n)
	for i := range cap {
		cap[i] = append([]int(nil), w[i]...)
	}
	// saturate
	for {
		parent := make([]int, n)
		for i := range parent {
			parent[i] = -1
		}
		parent[s] = s
		q := []int{s}
		for len(q) > 0 && parent[t] == -1 {
			u := q[0]
			q = q[1:]
			for v := 0; v < n; v++ {
				if parent[v] == -1 && cap[u][v] > 0 {
					parent[v] = u
					q = append(q, v)
				}
			}
		}
		if parent[t] == -1 {
			break
		}
		b := 1 << 30
		for v := t; v != s; v = parent[v] {
			if cap[parent[v]][v] < b {
				b = cap[parent[v]][v]
			}
		}
		for v := t; v != s; v = parent[v] {
			cap[parent[v]][v] -= b
			cap[v][parent[v]] += b
		}
	}
	seen := make([]bool, n)
	stack := []int{s}
	seen[s] = true
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for v := 0; v < n; v++ {
			if !seen[v] && cap[u][v] > 0 {
				seen[v] = true
				stack = append(stack, v)
			}
		}
	}
	return seen
}

func gomoryHu(w [][]int) ([]int, []int) {
	n := len(w)
	parent := make([]int, n)
	weight := make([]int, n)
	for i := 1; i < n; i++ {
		f := maxFlowVal(w, i, parent[i])
		side := reachable(w, i, parent[i])
		weight[i] = f
		for j := i + 1; j < n; j++ {
			if side[j] && parent[j] == parent[i] {
				parent[j] = i
			}
		}
		if side[parent[parent[i]]] {
			weight[i] = weight[parent[i]]
			weight[parent[i]] = f
			pp := parent[parent[i]]
			parent[i] = pp
			parent[parent[i]] = i // careful rewire
		}
	}
	return parent, weight
}

func main() {
	w := [][]int{{0, 3, 1, 0}, {3, 0, 1, 1}, {1, 1, 0, 3}, {0, 1, 3, 0}}
	p, wt := gomoryHu(w)
	fmt.Println(p, wt)
}
```

#### Java

```java
import java.util.*;

public class GomoryHu {
    static int n;
    static int maxFlow(int[][] w, int s, int t) {
        int[][] cap = new int[n][];
        for (int i = 0; i < n; i++) cap[i] = w[i].clone();
        int flow = 0;
        while (true) {
            int[] p = new int[n]; Arrays.fill(p, -1); p[s] = s;
            Deque<Integer> q = new ArrayDeque<>(); q.add(s);
            while (!q.isEmpty() && p[t] == -1) {
                int u = q.poll();
                for (int v = 0; v < n; v++) if (p[v]==-1 && cap[u][v]>0){ p[v]=u; q.add(v); }
            }
            if (p[t] == -1) break;
            int b = Integer.MAX_VALUE;
            for (int v = t; v != s; v = p[v]) b = Math.min(b, cap[p[v]][v]);
            for (int v = t; v != s; v = p[v]) { cap[p[v]][v]-=b; cap[v][p[v]]+=b; }
            flow += b;
        }
        return flow;
    }
    static boolean[] reachable(int[][] w, int s, int t) {
        int[][] cap = new int[n][];
        for (int i = 0; i < n; i++) cap[i] = w[i].clone();
        while (true) {
            int[] p = new int[n]; Arrays.fill(p, -1); p[s] = s;
            Deque<Integer> q = new ArrayDeque<>(); q.add(s);
            while (!q.isEmpty() && p[t] == -1) {
                int u = q.poll();
                for (int v = 0; v < n; v++) if (p[v]==-1 && cap[u][v]>0){ p[v]=u; q.add(v); }
            }
            if (p[t] == -1) break;
            int b = Integer.MAX_VALUE;
            for (int v = t; v != s; v = p[v]) b = Math.min(b, cap[p[v]][v]);
            for (int v = t; v != s; v = p[v]) { cap[p[v]][v]-=b; cap[v][p[v]]+=b; }
        }
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>(); st.push(s); seen[s] = true;
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int v = 0; v < n; v++) if (!seen[v] && cap[u][v] > 0){ seen[v]=true; st.push(v); }
        }
        return seen;
    }
    public static void main(String[] a) {
        int[][] w = {{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}};
        n = w.length;
        int[] parent = new int[n], weight = new int[n];
        for (int i = 1; i < n; i++) {
            int f = maxFlow(w, i, parent[i]);
            boolean[] side = reachable(w, i, parent[i]);
            weight[i] = f;
            for (int j = i + 1; j < n; j++)
                if (side[j] && parent[j] == parent[i]) parent[j] = i;
        }
        System.out.println(Arrays.toString(parent) + " " + Arrays.toString(weight));
    }
}
```

#### Python

```python
from collections import deque


def _maxflow(w, s, t):
    n = len(w)
    cap = [row[:] for row in w]
    flow = 0
    while True:
        p = [-1] * n
        p[s] = s
        q = deque([s])
        while q and p[t] == -1:
            u = q.popleft()
            for v in range(n):
                if p[v] == -1 and cap[u][v] > 0:
                    p[v] = u
                    q.append(v)
        if p[t] == -1:
            break
        b = float("inf")
        v = t
        while v != s:
            b = min(b, cap[p[v]][v])
            v = p[v]
        v = t
        while v != s:
            cap[p[v]][v] -= b
            cap[v][p[v]] += b
            v = p[v]
        flow += b
    # residual reachability from s = one side of the min cut
    seen = [False] * n
    stack = [s]
    seen[s] = True
    while stack:
        u = stack.pop()
        for v in range(n):
            if not seen[v] and cap[u][v] > 0:
                seen[v] = True
                stack.append(v)
    return flow, seen


def gomory_hu(w):
    n = len(w)
    parent = [0] * n
    weight = [0] * n
    for i in range(1, n):
        f, side = _maxflow(w, i, parent[i])
        weight[i] = f
        for j in range(i + 1, n):
            if side[j] and parent[j] == parent[i]:
                parent[j] = i
    return parent, weight


if __name__ == "__main__":
    w = [[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]
    print(gomory_hu(w))
```

---

### A3. Minimum Edges to Make 2-Edge-Connected

**Statement.** Given a connected undirected graph, return the minimum number of edges to add so it becomes 2-edge-connected (`λ ≥ 2`, no bridges). Classic result: contract every 2-edge-connected component, build the *bridge tree*; the answer is `⌈leaves / 2⌉` (and `0` if already bridgeless).

**Constraints.** `2 ≤ n ≤ 10⁵`.

**Hints.**
- Find bridges (B5); contract bridge-free components into a forest/tree.
- The tree has `L` leaves; you need `⌈L/2⌉` edges to make it 2-edge-connected.

#### Go

```go
package main

import "fmt"

func minEdgesTo2EC(n int, edges [][2]int) int {
	adj := make([][][2]int, n) // (neighbor, edgeId)
	for id, e := range edges {
		adj[e[0]] = append(adj[e[0]], [2]int{e[1], id})
		adj[e[1]] = append(adj[e[1]], [2]int{e[0], id})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	isBridge := make([]bool, len(edges))
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u] = timer
		low[u] = timer
		timer++
		for _, ne := range adj[u] {
			v, id := ne[0], ne[1]
			if id == pe {
				continue
			}
			if disc[v] == -1 {
				dfs(v, id)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] > disc[u] {
					isBridge[id] = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	dfs(0, -1)
	// component id via DFS over non-bridge edges
	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	c := 0
	for i := 0; i < n; i++ {
		if comp[i] == -1 {
			stack := []int{i}
			comp[i] = c
			for len(stack) > 0 {
				u := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				for _, ne := range adj[u] {
					v, id := ne[0], ne[1]
					if !isBridge[id] && comp[v] == -1 {
						comp[v] = c
						stack = append(stack, v)
					}
				}
			}
			c++
		}
	}
	if c == 1 {
		return 0 // already 2-edge-connected
	}
	deg := make([]int, c)
	for id, e := range edges {
		if isBridge[id] {
			deg[comp[e[0]]]++
			deg[comp[e[1]]]++
		}
	}
	leaves := 0
	for _, d := range deg {
		if d == 1 {
			leaves++
		}
	}
	return (leaves + 1) / 2
}

func main() {
	fmt.Println(minEdgesTo2EC(4, [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}})) // 1
}
```

#### Java

```java
import java.util.*;

public class TwoEC {
    static int n;
    static int[] disc, low;
    static List<int[]>[] adj;
    static boolean[] isBridge;
    static int timer;
    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] ne : adj[u]) {
            int v = ne[0], id = ne[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else low[u] = Math.min(low[u], disc[v]);
        }
    }
    static int minEdges(int nn, int[][] edges) {
        n = nn;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int id = 0; id < edges.length; id++) {
            adj[edges[id][0]].add(new int[]{edges[id][1], id});
            adj[edges[id][1]].add(new int[]{edges[id][0], id});
        }
        disc = new int[n]; low = new int[n]; Arrays.fill(disc, -1);
        isBridge = new boolean[edges.length]; timer = 0; dfs(0, -1);
        int[] comp = new int[n]; Arrays.fill(comp, -1); int c = 0;
        for (int i = 0; i < n; i++) if (comp[i] == -1) {
            Deque<Integer> st = new ArrayDeque<>(); st.push(i); comp[i] = c;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int[] ne : adj[u])
                    if (!isBridge[ne[1]] && comp[ne[0]] == -1){ comp[ne[0]]=c; st.push(ne[0]); }
            }
            c++;
        }
        if (c == 1) return 0;
        int[] deg = new int[c];
        for (int id = 0; id < edges.length; id++)
            if (isBridge[id]) { deg[comp[edges[id][0]]]++; deg[comp[edges[id][1]]]++; }
        int leaves = 0;
        for (int d : deg) if (d == 1) leaves++;
        return (leaves + 1) / 2;
    }
    public static void main(String[] a) {
        System.out.println(minEdges(4, new int[][]{{0,1},{1,2},{2,0},{1,3}})); // 1
    }
}
```

#### Python

```python
import sys


def min_edges_to_2ec(n, edges):
    sys.setrecursionlimit(1 << 20)
    adj = [[] for _ in range(n)]
    for idx, (u, v) in enumerate(edges):
        adj[u].append((v, idx))
        adj[v].append((u, idx))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    is_bridge = [False] * len(edges)

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, idx in adj[u]:
            if idx == pe:
                continue
            if disc[v] == -1:
                dfs(v, idx)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    is_bridge[idx] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    comp = [-1] * n
    c = 0
    for i in range(n):
        if comp[i] == -1:
            stack = [i]
            comp[i] = c
            while stack:
                u = stack.pop()
                for v, idx in adj[u]:
                    if not is_bridge[idx] and comp[v] == -1:
                        comp[v] = c
                        stack.append(v)
            c += 1
    if c == 1:
        return 0
    deg = [0] * c
    for idx, (u, v) in enumerate(edges):
        if is_bridge[idx]:
            deg[comp[u]] += 1
            deg[comp[v]] += 1
    leaves = sum(1 for d in deg if d == 1)
    return (leaves + 1) // 2


if __name__ == "__main__":
    print(min_edges_to_2ec(4, [(0, 1), (1, 2), (2, 0), (1, 3)]))  # 1
```

---

### A4. Weighted Min-Cut Partition Recovery

**Statement.** Given a weighted graph, return the minimum cut value *and* the two vertex sets `(A, B)` forming the cut. Reuse I4's side recovery and report both sides.

**Constraints.** `2 ≤ n ≤ 300`.

**Hints.**
- I4 already gives one side `S`; the other is its complement.
- Return `(value, S, complement)`.

#### Go

```go
package main

import "fmt"

func minCutPartition(w [][]int) (int, []int, []int) {
	n := len(w)
	g := make([][]int, n)
	for i := range g {
		g[i] = append([]int(nil), w[i]...)
	}
	groups := make([][]int, n)
	for i := range groups {
		groups[i] = []int{i}
	}
	alive := make([]bool, n)
	for i := range alive {
		alive[i] = true
	}
	best := 1 << 30
	var side []int
	for ph := n; ph > 1; ph-- {
		weight := make([]int, n)
		added := make([]bool, n)
		prev, last := -1, -1
		for i := 0; i < ph; i++ {
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
			side = append([]int(nil), groups[last]...)
		}
		alive[last] = false
		groups[prev] = append(groups[prev], groups[last]...)
		for v := 0; v < n; v++ {
			g[prev][v] += g[last][v]
			g[v][prev] += g[v][last]
		}
	}
	inS := make([]bool, n)
	for _, v := range side {
		inS[v] = true
	}
	var a, b []int
	for v := 0; v < n; v++ {
		if inS[v] {
			a = append(a, v)
		} else {
			b = append(b, v)
		}
	}
	return best, a, b
}

func main() {
	w := [][]int{{0, 3, 1, 0}, {3, 0, 1, 1}, {1, 1, 0, 3}, {0, 1, 3, 0}}
	v, a, b := minCutPartition(w)
	fmt.Println(v, a, b) // 3 with sides {2,3}|{0,1} (order may vary)
}
```

#### Java

```java
import java.util.*;

public class MinCutPartition {
    public static void main(String[] args) {
        int[][] w = {{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}};
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        List<List<Integer>> groups = new ArrayList<>();
        for (int i = 0; i < n; i++) groups.add(new ArrayList<>(List.of(i)));
        boolean[] alive = new boolean[n]; Arrays.fill(alive, true);
        int best = Integer.MAX_VALUE; List<Integer> side = new ArrayList<>();
        for (int ph = n; ph > 1; ph--) {
            int[] weight = new int[n]; boolean[] added = new boolean[n];
            int prev = -1, last = -1;
            for (int i = 0; i < ph; i++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v] && (sel==-1||weight[v]>weight[sel])) sel = v;
                added[sel] = true; prev = last; last = sel;
                for (int v = 0; v < n; v++) if (alive[v] && !added[v]) weight[v] += g[sel][v];
            }
            if (weight[last] < best) { best = weight[last]; side = new ArrayList<>(groups.get(last)); }
            alive[last] = false; groups.get(prev).addAll(groups.get(last));
            for (int v = 0; v < n; v++) { g[prev][v]+=g[last][v]; g[v][prev]+=g[v][last]; }
        }
        boolean[] inS = new boolean[n];
        for (int v : side) inS[v] = true;
        List<Integer> A = new ArrayList<>(), B = new ArrayList<>();
        for (int v = 0; v < n; v++) (inS[v] ? A : B).add(v);
        System.out.println(best + " " + A + " " + B);
    }
}
```

#### Python

```python
def min_cut_partition(w):
    n = len(w)
    g = [row[:] for row in w]
    groups = [[i] for i in range(n)]
    alive = [True] * n
    best, side = float("inf"), []
    for ph in range(n, 1, -1):
        weight = [0] * n
        added = [False] * n
        prev = last = -1
        for _ in range(ph):
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
            best, side = weight[last], groups[last][:]
        alive[last] = False
        groups[prev].extend(groups[last])
        for v in range(n):
            g[prev][v] += g[last][v]
            g[v][prev] += g[v][last]
    in_s = set(side)
    a = sorted(in_s)
    b = sorted(set(range(n)) - in_s)
    return best, a, b


if __name__ == "__main__":
    print(min_cut_partition([[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]))  # (3, [...], [...])
```

---

### A5. Karger Randomized Min-Cut

**Statement.** Implement Karger's contraction algorithm; run enough trials to find the global min-cut with high probability and return the best value seen.

**Constraints.** `2 ≤ n ≤ 100`. Multigraph weights allowed.

**Hints.**
- Use union-find or an adjacency-weight matrix and merge rows/columns.
- Run `~ n² · ln n` trials; track the minimum cut found.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

func kargerOnce(w [][]int, rng *rand.Rand) int {
	n := len(w)
	g := make([][]int, n)
	for i := range g {
		g[i] = append([]int(nil), w[i]...)
	}
	alive := make([]bool, n)
	count := n
	for i := range alive {
		alive[i] = true
	}
	for count > 2 {
		// pick a random alive edge weighted by capacity
		total := 0
		for u := 0; u < n; u++ {
			if alive[u] {
				for v := u + 1; v < n; v++ {
					if alive[v] {
						total += g[u][v]
					}
				}
			}
		}
		r := rng.Intn(total)
		var pu, pv int
		found := false
		for u := 0; u < n && !found; u++ {
			if !alive[u] {
				continue
			}
			for v := u + 1; v < n && !found; v++ {
				if !alive[v] {
					continue
				}
				r -= g[u][v]
				if r < 0 {
					pu, pv = u, v
					found = true
				}
			}
		}
		// contract pv into pu
		alive[pv] = false
		for v := 0; v < n; v++ {
			if v != pu && v != pv {
				g[pu][v] += g[pv][v]
				g[v][pu] += g[v][pv]
			}
		}
		g[pu][pv], g[pv][pu] = 0, 0
		count--
	}
	a, b := -1, -1
	for i := 0; i < n; i++ {
		if alive[i] {
			if a == -1 {
				a = i
			} else {
				b = i
			}
		}
	}
	return g[a][b]
}

func karger(w [][]int) int {
	rng := rand.New(rand.NewSource(1))
	n := len(w)
	trials := n * n
	best := 1 << 30
	for i := 0; i < trials; i++ {
		if c := kargerOnce(w, rng); c < best {
			best = c
		}
	}
	return best
}

func main() {
	w := [][]int{{0, 3, 1, 0}, {3, 0, 1, 1}, {1, 1, 0, 3}, {0, 1, 3, 0}}
	fmt.Println(karger(w)) // 3 (whp)
}
```

#### Java

```java
import java.util.*;

public class Karger {
    static int once(int[][] w, Random rng) {
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        boolean[] alive = new boolean[n]; Arrays.fill(alive, true);
        int count = n;
        while (count > 2) {
            int total = 0;
            for (int u = 0; u < n; u++) if (alive[u])
                for (int v = u+1; v < n; v++) if (alive[v]) total += g[u][v];
            int r = rng.nextInt(total), pu = -1, pv = -1;
            outer:
            for (int u = 0; u < n; u++) { if (!alive[u]) continue;
                for (int v = u+1; v < n; v++) { if (!alive[v]) continue;
                    r -= g[u][v]; if (r < 0) { pu = u; pv = v; break outer; } } }
            alive[pv] = false;
            for (int v = 0; v < n; v++) if (v != pu && v != pv) { g[pu][v]+=g[pv][v]; g[v][pu]+=g[v][pv]; }
            g[pu][pv] = 0; g[pv][pu] = 0; count--;
        }
        int a = -1, b = -1;
        for (int i = 0; i < n; i++) if (alive[i]) { if (a==-1) a=i; else b=i; }
        return g[a][b];
    }
    static int karger(int[][] w) {
        Random rng = new Random(1);
        int best = Integer.MAX_VALUE, trials = w.length * w.length;
        for (int i = 0; i < trials; i++) best = Math.min(best, once(w, rng));
        return best;
    }
    public static void main(String[] a) {
        System.out.println(karger(new int[][]{{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}})); // 3 whp
    }
}
```

#### Python

```python
import random


def _once(w, rng):
    n = len(w)
    g = [row[:] for row in w]
    alive = [True] * n
    count = n
    while count > 2:
        total = sum(g[u][v] for u in range(n) if alive[u]
                    for v in range(u + 1, n) if alive[v])
        r = rng.randrange(total)
        pu = pv = -1
        for u in range(n):
            if not alive[u]:
                continue
            for v in range(u + 1, n):
                if not alive[v]:
                    continue
                r -= g[u][v]
                if r < 0:
                    pu, pv = u, v
                    break
            if pu != -1:
                break
        alive[pv] = False
        for v in range(n):
            if v not in (pu, pv):
                g[pu][v] += g[pv][v]
                g[v][pu] += g[v][pv]
        g[pu][pv] = g[pv][pu] = 0
        count -= 1
    surv = [i for i in range(n) if alive[i]]
    return g[surv[0]][surv[1]]


def karger(w, seed=1):
    rng = random.Random(seed)
    n = len(w)
    return min(_once(w, rng) for _ in range(n * n))


if __name__ == "__main__":
    print(karger([[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]))  # 3 whp
```

---

## Benchmark

**Goal.** Compare the **global `λ` via flow** (`V − 1` `s-t` flows) against **Stoer–Wagner** (`O(V³)`) on random dense graphs, confirming both agree and observing the crossover where Stoer–Wagner wins.

**Methodology.**
- Generate random connected weighted graphs `G(n, p)` with `p = 0.5` and integer weights `1..5`.
- Run both algorithms; assert equal min-cut value.
- Time each over increasing `n`.

#### Python (driver)

```python
import random
import time


def bench(n, p=0.5, seed=0):
    rng = random.Random(seed)
    w = [[0] * n for _ in range(n)]
    for u in range(n):
        for v in range(u + 1, n):
            if rng.random() < p:
                c = rng.randint(1, 5)
                w[u][v] = w[v][u] = c
    # ensure connected: add a spanning path
    for u in range(n - 1):
        if w[u][u + 1] == 0:
            w[u][u + 1] = w[u + 1][u] = 1

    # Stoer-Wagner
    t0 = time.perf_counter()
    sw = stoer_wagner(w)
    t1 = time.perf_counter()

    # flow-based global lambda
    edges = [(u, v) for u in range(n) for v in range(u + 1, n)
             for _ in range(w[u][v])]
    t2 = time.perf_counter()
    fl = global_lambda(n, edges)  # from I2/B3
    t3 = time.perf_counter()

    assert sw == fl, f"mismatch {sw} != {fl}"
    return sw, (t1 - t0), (t3 - t2)


if __name__ == "__main__":
    for n in (20, 40, 80, 120):
        cut, sw_t, fl_t = bench(n)
        print(f"n={n:4d}  cut={cut:3d}  SW={sw_t*1e3:8.2f}ms  flow={fl_t*1e3:9.2f}ms")
```

**Expected observation.** On dense graphs Stoer–Wagner's runtime grows smoothly as `Θ(n³)`, while the flow-based approach degrades faster because each of the `n − 1` flows is itself expensive on a dense multigraph (many augmenting paths). The cut values always match — a built-in correctness check. For sparse graphs the picture reverses: adjacency-list Dinic-based flow beats the dense `O(n²)` Stoer–Wagner matrix.

**What to measure.** Min-cut value (correctness), wall-clock per algorithm, and memory (`O(n²)` matrix for SW vs `O(n + m)` residual for flow). Vary density `p` to find the crossover point on your hardware.
