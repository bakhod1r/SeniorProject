# Edge & Vertex Connectivity — Interview Preparation

> **One-line summary:** Interviewers probe whether you can recognize a "min cut = max disjoint paths" problem (Menger), reduce it to max-flow, distinguish edge from vertex cuts, and know that the *global* min-cut has a flow-free `O(V³)` Stoer–Wagner solution. This file is the rapid-recall cheat sheet plus 42 Q&A, 5 behavioral, and 4 coding challenges.

---

## Table of Contents

1. [Cheat Sheet](#cheat-sheet)
2. [Junior Questions (12)](#junior-questions-12)
3. [Middle Questions (12)](#middle-questions-12)
4. [Senior Questions (10)](#senior-questions-10)
5. [Professional Questions (8)](#professional-questions-8)
6. [Behavioral Questions (5)](#behavioral-questions-5)
7. [Coding Challenges](#coding-challenges)
8. [Common Pitfalls](#common-pitfalls)
9. [What Interviewers Are Really Testing](#what-interviewers-are-really-testing)

---

## Cheat Sheet

| Concept | Recall |
|---------|--------|
| `λ(G)` | min **edges** to disconnect |
| `κ(G)` | min **vertices** to disconnect |
| `δ(G)` | min degree |
| Inequality | `κ ≤ λ ≤ δ` |
| Menger (edge) | min `s-t` edge cut = max edge-disjoint `s-t` paths |
| Menger (vertex) | min `s-t` vertex cut = max internally vertex-disjoint paths |
| `s-t` edge conn. | cap 1 per edge, max-flow |
| `s-t` vertex conn. | node-split (`v_in→v_out` cap 1; ∞ for s,t), max-flow |
| Undirected edge | capacity 1 in **both** directions |
| Global `λ` (flow) | fix `s`, min over `t` of `λ(s,t)` — `V−1` flows |
| Global `λ` (no flow) | **Stoer–Wagner** `O(V³)` |
| All-pairs cuts | **Gomory–Hu** tree, `V−1` flows |
| `λ=1` / `κ=1` | bridges / articulation, `O(V+E)` |
| Randomized | Karger `O(V²)`/trial; Karger–Stein `O(V² log³ V)` |

Quick reductions:
```
"max independent routes s→t"        → edge-disjoint paths = λ(s,t) = unit max-flow
"max node-disjoint routes s→t"      → node-split + max-flow
"cheapest way to split the graph"   → global min-cut = Stoer–Wagner
"single point of failure?"          → articulation point (κ=1) / bridge (λ=1)
"survive k failures?"               → need κ≥k+1 (vertices) / λ≥k+1 (edges)
```

---

## Junior Questions (12)

**1. What is edge connectivity `λ(G)`?**
The minimum number of edges whose removal disconnects the graph (or reduces it to a single vertex).

**2. What is vertex connectivity `κ(G)`?**
The minimum number of vertices whose removal disconnects the graph (or trivializes it).

**3. State the inequality relating `κ`, `λ`, `δ`.**
`κ(G) ≤ λ(G) ≤ δ(G)` — vertex ≤ edge ≤ min degree.

**4. Why is `λ ≤ δ`?**
The minimum-degree vertex can be isolated by deleting its `δ` incident edges, giving an edge cut of size `δ`.

**5. What is a bridge? What is its `λ`?**
An edge whose removal disconnects the graph; a graph with a bridge has `λ = 1`.

**6. What is an articulation point? Its `κ`?**
A vertex whose removal disconnects the graph; such a graph has `κ = 1`.

**7. State Menger's theorem informally.**
The minimum number of edges (vertices) to separate `s` and `t` equals the maximum number of edge-disjoint (vertex-disjoint) `s-t` paths.

**8. How do you compute `s-t` edge connectivity with max-flow?**
Give every edge capacity 1 (both directions if undirected) and run max-flow from `s` to `t`; the flow value is the answer.

**9. Why capacity 1 in both directions for undirected edges?**
An undirected edge can carry a disjoint path in either direction, so both arcs need capacity.

**10. What does the max-flow value represent here?**
Both the number of edge-disjoint `s-t` paths and the size of the min `s-t` edge cut (they are equal by Menger).

**11. Is `δ` always the answer for connectivity?**
No — `δ` is only an upper bound. A graph with a bridge has `δ ≥ 1` but `λ = 1`.

**12. What's the connectivity of a complete graph `Kₙ`?**
`κ = λ = δ = n − 1`.

---

## Middle Questions (12)

**1. How do you compute *vertex* connectivity with max-flow?**
Node-split: replace each `v` by `v_in → v_out` (capacity 1), route original edges between out/in copies (capacity ∞), give `s`/`t` internal capacity ∞, then max-flow.

**2. Why give `s` and `t` infinite internal capacity?**
Because you never "delete" the endpoints; only interior vertices can be in a separator.

**3. Why does vertex connectivity return ∞ for adjacent `s, t`?**
Adjacent vertices have no vertex separator — you cannot disconnect them by deleting interior vertices. Convention: use `n − 1`.

**4. Describe the global min-cut problem.**
Find the minimum-weight edge set whose removal splits the graph into two non-empty parts — equals `λ` for unit weights, over all pairs.

**5. What does Stoer–Wagner do and at what cost?**
Computes the global min-cut of a weighted undirected graph in `O(V³)` with no flow, via maximum-adjacency phases and vertex merging.

**6. What is a "minimum cut phase"?**
Grow a set by repeatedly adding the most tightly connected vertex; the cut isolating the last-added vertex is a min `s-t` cut for the last two vertices, which are then merged.

**7. How do you get global `λ` from `s-t` connectivity using flow?**
Fix one source `s`, compute `λ(s, t)` for every other `t`, take the minimum — `V − 1` flows suffice.

**8. What is a Gomory–Hu tree?**
A tree on the same vertices where the min `s-t` cut equals the minimum-weight edge on the tree path; built with `V − 1` flows, answers any pair quickly.

**9. How many flow computations build a Gomory–Hu tree?**
`V − 1`, not `\binom{V}{2}`.

**10. Sketch Karger's algorithm.**
Contract uniformly random edges (merging endpoints, dropping self-loops) until two vertices remain; the edges between them are a cut candidate. Repeat for high probability.

**11. How do you check `λ ≥ k` cheaply?**
Run flows that stop early once the flow value reaches `k` — no need to saturate; for `k = 2`, equivalently check no bridges.

**12. Stoer–Wagner vs flow-per-pair — when does each win?**
Stoer–Wagner (`O(V³)`) wins on dense weighted undirected graphs; flow-per-pair (sparse Dinic) wins on sparse graphs and is required for directed/per-pair queries.

---

## Senior Questions (10)

**1. How would you measure fault tolerance of a microservice dependency graph?**
Vertex connectivity `κ`: the minimum number of simultaneous service failures that partitions a critical path; `κ = 1` flags single points of failure (articulation points).

**2. Edge vs vertex connectivity — which models link vs node failure?**
Edge connectivity models *link* (channel/cable) failure; vertex connectivity models *node* (server/router/zone) failure.

**3. How do you scale connectivity analysis to a 100k-node sparse topology?**
Avoid Stoer–Wagner's `O(V²)` matrix; use sparse Dinic with early-exit `k`-testing, decompose into 2-edge-connected components, and analyze components independently.

**4. Which connectivity computations parallelize well?**
Independent `s-t` flows (fix-source/vary-sink) and Karger trials parallelize; Gomory–Hu's sequential builds and Stoer–Wagner's phases do not parallelize across phases.

**5. Why must each parallel flow have its own residual graph?**
Augmentation mutates the residual; sharing it across threads is a data race.

**6. What artifact should a connectivity job emit besides the number?**
The actual cut — which edges/vertices and the two sides — so on-call engineers can act and harden it.

**7. How does the discovered min-cut drive capacity planning?**
To survive `f` failures you need `κ ≥ f + 1` / `λ ≥ f + 1`; reinforce the reported weak cut by adding straddling links/nodes and re-run.

**8. Connectivity assumes independent failures — what breaks that?**
Correlated failures (a shared power domain killing "independent" links). Model fate-sharing by merging co-located vertices before analysis.

**9. When is the linear-time bridge/articulation DFS the right tool?**
Whenever the question is just `k = 1` — run it on every snapshot; reserve the heavier global cut for periodic deep analysis.

**10. How do you avoid silent correctness loss?**
Validate directed-vs-undirected (matrix symmetry), assert node-split ∞ capacities, and unit-test against known answers (`Kₙ`, a single bridge, a cycle).

---

## Professional Questions (8)

**1. Prove `λ ≤ δ`.**
Isolate the minimum-degree vertex by cutting its `δ` incident edges — an edge cut of size `δ` exists, so `λ ≤ δ`.

**2. Prove `κ ≤ λ`.**
From a minimum edge cut of size `λ`, choose one endpoint per cut edge to form a vertex set of size ≤ `λ`; removing it kills every cut edge, disconnecting the graph (modulo the complete-graph convention).

**3. How does Menger follow from max-flow min-cut?**
Unit-capacity (or node-split) network: integral max-flow decomposes into disjoint paths (flow = paths), and max-flow = min-cut gives flow = cut; chaining yields paths = cut.

**4. State the Stoer–Wagner min-cut-phase lemma.**
For a maximum-adjacency ordering ending in `s, t`, the cut isolating the last vertex `t` is a minimum `s-t` cut.

**5. Why does merging `s, t` preserve correctness?**
Any global min-cut either separates `s, t` (captured by this phase's `s-t` min cut) or not (survives the merge for a later phase); induction over `n − 1` phases gives the global optimum.

**6. What is Karger's single-run success probability and why?**
`2 / (V(V−1))`. At each contraction the chance of hitting a fixed min-cut edge is `≤ λ/m ≤ 2/(V−i)`; the surviving telescoping product collapses to `2/(V(V−1))`.

**7. How does Karger–Stein improve it?**
Recurse: contract to `≈ 1 + V/√2` (success ≥ ~½ to reach), then two recursive calls. `T(V) = 2T(V/√2) + O(V²) = O(V² log V)`; with `O(log² V)` repeats, `O(V² log³ V)` whp.

**8. What's a key property of the Gomory–Hu tree?**
The `V − 1` encoded min-cuts can be chosen pairwise non-crossing, so the pairwise min-cut function takes at most `V − 1` distinct cut values along any laminar family; queries are tree-path bottlenecks.

---

## Behavioral Questions (5)

**1. Tell me about a time you discovered a single point of failure in a system.**
Structure: how you *modeled* it (dependency graph), how you *found* it (articulation points / `κ = 1`), the *fix* (added a redundant path to raise `κ`), and the *verification* (re-ran and confirmed `κ ≥ 2`). Emphasize turning intuition into a measured guarantee.

**2. Describe balancing rigor vs pragmatism on a reliability analysis.**
Talk about running the cheap `O(V+E)` bridge check continuously and the expensive `O(V³)` global cut on a slower cadence — matching cost to question, not gold-plating.

**3. How did you communicate a complex connectivity finding to non-experts?**
Rendering the *actual cut* on a topology map ("these two links, if both fail, split us") rather than reporting a bare number. Make the meaning visceral.

**4. A time you caught a subtle correctness bug.**
The directed-vs-undirected or node-split `∞` mistake — a *plausible but wrong* number. Show you defend with invariant assertions and known-answer tests.

**5. How do you decide when an estimate is good enough vs exact?**
On a million-node graph you may use Karger or pure `k`-testing for an estimate; explain the risk trade-off and how you bounded the error / confidence.

---

## Coding Challenges

### Challenge 1: Max Edge-Disjoint Paths (`λ(s, t)`)

**Problem.** Given an undirected graph and two vertices `s, t`, return the maximum number of edge-disjoint paths between them.

#### Go

```go
package main

import "fmt"

func maxDisjointPaths(n int, edges [][2]int, s, t int) int {
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
	edges := [][2]int{{0, 1}, {0, 2}, {1, 2}, {2, 3}, {3, 0}}
	fmt.Println(maxDisjointPaths(4, edges, 0, 2)) // 3
}
```

#### Java

```java
import java.util.*;

public class DisjointPaths {
    static int maxDisjoint(int n, int[][] edges, int s, int t) {
        int[][] cap = new int[n][n];
        for (int[] e : edges) { cap[e[0]][e[1]]++; cap[e[1]][e[0]]++; }
        int flow = 0;
        while (true) {
            int[] parent = new int[n];
            Arrays.fill(parent, -1);
            parent[s] = s;
            Deque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty() && parent[t] == -1) {
                int u = q.poll();
                for (int v = 0; v < n; v++)
                    if (parent[v] == -1 && cap[u][v] > 0) { parent[v] = u; q.add(v); }
            }
            if (parent[t] == -1) break;
            for (int v = t; v != s; v = parent[v]) { cap[parent[v]][v]--; cap[v][parent[v]]++; }
            flow++;
        }
        return flow;
    }
    public static void main(String[] a) {
        int[][] e = {{0,1},{0,2},{1,2},{2,3},{3,0}};
        System.out.println(maxDisjoint(4, e, 0, 2)); // 3
    }
}
```

#### Python

```python
from collections import deque


def max_disjoint_paths(n, edges, s, t):
    cap = [[0] * n for _ in range(n)]
    for u, v in edges:
        cap[u][v] += 1
        cap[v][u] += 1
    flow = 0
    while True:
        parent = [-1] * n
        parent[s] = s
        q = deque([s])
        while q and parent[t] == -1:
            u = q.popleft()
            for v in range(n):
                if parent[v] == -1 and cap[u][v] > 0:
                    parent[v] = u
                    q.append(v)
        if parent[t] == -1:
            break
        v = t
        while v != s:
            cap[parent[v]][v] -= 1
            cap[v][parent[v]] += 1
            v = parent[v]
        flow += 1
    return flow


if __name__ == "__main__":
    print(max_disjoint_paths(4, [(0,1),(0,2),(1,2),(2,3),(3,0)], 0, 2))  # 3
```

### Challenge 2: Critical Connections (Bridges, `λ = 1`)

**Problem.** (LeetCode 1192) Return all bridges of an undirected graph — edges whose removal disconnects it.

#### Go

```go
package main

import "fmt"

func criticalConnections(n int, connections [][2]int) [][2]int {
	adj := make([][]int, n)
	for _, c := range connections {
		adj[c[0]] = append(adj[c[0]], c[1])
		adj[c[1]] = append(adj[c[1]], c[0])
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var res [][2]int
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
					res = append(res, [2]int{u, v})
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	return res
}

func main() {
	fmt.Println(criticalConnections(4, [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}})) // [[1 3]]
}
```

#### Java

```java
import java.util.*;

public class CriticalConnections {
    static List<int[]> res;
    static int[] disc, low;
    static List<List<Integer>> adj;
    static int timer;
    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) res.add(new int[]{u, v});
            } else low[u] = Math.min(low[u], disc[v]);
        }
    }
    static List<int[]> critical(int n, int[][] conn) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] c : conn) { adj.get(c[0]).add(c[1]); adj.get(c[1]).add(c[0]); }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        res = new ArrayList<>(); timer = 0;
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        return res;
    }
    public static void main(String[] a) {
        for (int[] e : critical(4, new int[][]{{0,1},{1,2},{2,0},{1,3}}))
            System.out.println(Arrays.toString(e)); // [1, 3]
    }
}
```

#### Python

```python
import sys


def critical_connections(n, connections):
    sys.setrecursionlimit(1 << 20)
    adj = [[] for _ in range(n)]
    for u, v in connections:
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    res = []
    timer = [0]

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
                    res.append((u, v))
            else:
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    return res


if __name__ == "__main__":
    print(critical_connections(4, [(0,1),(1,2),(2,0),(1,3)]))  # [(1, 3)]
```

### Challenge 3: Global Min-Cut (Stoer–Wagner)

**Problem.** Given a weighted undirected graph, return the value of its global minimum cut.

#### Go

```go
package main

import "fmt"

func globalMinCut(w [][]int) int {
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
	fmt.Println(globalMinCut(w)) // 3
}
```

#### Java

```java
public class GlobalMinCut {
    static int minCut(int[][] w) {
        int n = w.length;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++) g[i] = w[i].clone();
        boolean[] alive = new boolean[n];
        java.util.Arrays.fill(alive, true);
        int best = Integer.MAX_VALUE;
        for (int ph = n; ph > 1; ph--) {
            int[] weight = new int[n];
            boolean[] added = new boolean[n];
            int prev = -1, last = -1;
            for (int i = 0; i < ph; i++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (alive[v] && !added[v] && (sel == -1 || weight[v] > weight[sel])) sel = v;
                added[sel] = true; prev = last; last = sel;
                for (int v = 0; v < n; v++) if (alive[v] && !added[v]) weight[v] += g[sel][v];
            }
            best = Math.min(best, weight[last]);
            alive[last] = false;
            for (int v = 0; v < n; v++) { g[prev][v] += g[last][v]; g[v][prev] += g[v][last]; }
        }
        return best;
    }
    public static void main(String[] a) {
        int[][] w = {{0,3,1,0},{3,0,1,1},{1,1,0,3},{0,1,3,0}};
        System.out.println(minCut(w)); // 3
    }
}
```

#### Python

```python
def global_min_cut(w):
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
    w = [[0,3,1,0],[3,0,1,1],[1,1,0,3],[0,1,3,0]]
    print(global_min_cut(w))  # 3
```

### Challenge 4: Network Reliability (`κ ≥ k`?)

**Problem.** Given an undirected graph and target `k`, decide whether the graph survives any `k − 1` *vertex* failures between a critical pair `s, t` (i.e., `κ(s, t) ≥ k`). Use node-splitting + early-exit flow.

```python
from collections import deque


def st_vertex_connectivity(n, edges, s, t):
    INF = float("inf")
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
        parent = [-1] * N
        parent[src] = src
        q = deque([src])
        while q and parent[snk] == -1:
            x = q.popleft()
            for y in range(N):
                if parent[y] == -1 and cap[x][y] > 0:
                    parent[y] = x
                    q.append(y)
        if parent[snk] == -1:
            break
        b = INF
        y = snk
        while y != src:
            b = min(b, cap[parent[y]][y])
            y = parent[y]
        y = snk
        while y != src:
            cap[parent[y]][y] -= b
            cap[y][parent[y]] += b
            y = parent[y]
        flow += b
        if flow > n:  # already "infinite" (adjacent), stop
            return n - 1
    return flow


def is_k_vertex_reliable(n, edges, s, t, k):
    return st_vertex_connectivity(n, edges, s, t) >= k


if __name__ == "__main__":
    # 0-1-2 and 0-3-2: two vertex-disjoint paths
    e = [(0, 1), (1, 2), (0, 3), (3, 2)]
    print(st_vertex_connectivity(4, e, 0, 2))   # 2
    print(is_k_vertex_reliable(4, e, 0, 2, 2))  # True
```

---

## Common Pitfalls

1. **Edge vs vertex confusion** — different numbers, different constructions (`κ ≤ λ`).
2. **Undirected capacity only one way** — halves the flow, under-reports.
3. **Skipping node-splitting** for vertex connectivity — measures edges instead.
4. **Running vertex connectivity on adjacent `s, t`** — there is no separator; expect ∞ / `n − 1`.
5. **`min` over all pairs for global `λ`** — unnecessary; fix one source.
6. **Trusting `δ`** — it's only an upper bound.
7. **Feeding a directed graph to Stoer–Wagner** — it's undirected-only.
8. **Forgetting reverse residual edges** — flow never terminates / undercounts.

---

## What Interviewers Are Really Testing

- **Reduction instinct:** do you see "max independent routes" or "cheapest split" and immediately think *Menger → max-flow / min-cut*?
- **Edge vs vertex discipline:** can you keep `λ` and `κ` straight and pick the right gadget (node-splitting)?
- **Knowing the flow-free shortcut:** do you know Stoer–Wagner exists for the *global* cut so you don't run `V` flows?
- **Practical judgment:** do you reach for the linear-time bridge/articulation DFS when `k = 1`, and reserve heavy machinery for when it's warranted?
- **Correctness defense:** directed-vs-undirected, both-direction capacities, node-split ∞, known-answer tests.
- **Communication:** can you explain min-cut/max-flow duality and *why* it equals fault tolerance to a non-specialist?

The strongest signal is the reduction plus the duality explanation: "I'll give each edge capacity 1 and run max-flow; the value is the min cut by Menger — and I can certify it by exhibiting that many disjoint paths."
