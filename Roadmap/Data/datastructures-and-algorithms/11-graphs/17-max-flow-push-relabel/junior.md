# Maximum Flow (Push-Relabel) — Junior Level

> **One-line summary:** Push-Relabel is a maximum-flow algorithm that works *locally*: instead of finding whole source-to-sink paths (like Edmonds-Karp or Dinic), it lets water pile up at vertices (a "preflow"), gives every vertex a *height*, and repeatedly pushes excess water *downhill* along admissible edges or *raises* a stuck vertex until all the excess has drained into the sink.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

The **maximum-flow problem** asks: given a network of pipes (a directed graph) with capacities on each pipe, a *source* `s`, and a *sink* `t`, what is the largest amount of "water" you can route from `s` to `t` without any pipe exceeding its capacity?

You may already have met the *augmenting-path* family — **Ford-Fulkerson, Edmonds-Karp, and Dinic** (see the sibling topic *max-flow-edmonds-karp-dinic*). Those algorithms maintain a *valid flow* at every step (in = out at every internal vertex) and push more flow along whole `s → t` paths in the residual graph.

**Push-Relabel** (also called **preflow-push**, introduced by Goldberg and Tarjan in 1986–1988) takes a completely different, *local* view:

1. It does **not** keep a valid flow during the run. Instead it keeps a **preflow**: an internal vertex is allowed to have more flow coming *in* than going *out*. The surplus is called **excess**.
2. Every vertex gets an integer **height** (also called a *label*). The source starts at height `n` (the number of vertices); everything else starts at `0`.
3. The two operations are tiny and local:
   - **PUSH**: if a vertex `u` has excess and there is a residual edge `u → v` whose endpoint is *exactly one step lower* (`height[u] == height[v] + 1`), shove as much excess downhill as the edge allows.
   - **RELABEL**: if `u` has excess but nothing is one step below it, *raise* `u` just high enough that some residual neighbor becomes one step below.

Water can only flow downhill, the source towers above everything, and the sink sits at the bottom. Excess that cannot reach the sink eventually gets pushed all the way back up to the source. When no internal vertex has any excess left, the preflow has become a **valid maximum flow**.

The payoff: push-relabel often **beats Dinic on dense graphs**, parallelizes far better than path-augmenting methods, and with two simple speed-ups (the *gap* and *global-relabeling* heuristics) is the fastest max-flow algorithm in practice for many inputs.

---

## Prerequisites

Before this file you should be comfortable with:

- **Directed graphs** and adjacency lists — push-relabel walks neighbor lists constantly.
- **The max-flow / min-cut idea at a basic level** — read *max-flow-edmonds-karp-dinic* first if "augmenting path" and "residual graph" are new words.
- **Residual capacity** — for an edge `u → v` with capacity `c` carrying flow `f`, the residual is `c − f` forward and `f` backward.
- **Queues (FIFO)** — the simplest fast variant processes active vertices in a queue.
- **Big-O notation** — `O(V²E)`, `O(V³)`.
- **Basic integer arithmetic and comparisons.**

Optional but helpful:

- Having traced Edmonds-Karp by hand once. The contrast makes push-relabel click.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Flow network** | Directed graph with a capacity `c(u,v) ≥ 0` on each edge, a source `s`, and a sink `t`. |
| **Flow** | Assignment `f(u,v)` with `0 ≤ f ≤ c`, antisymmetry `f(u,v) = −f(v,u)`, and conservation (in = out) at every vertex except `s`, `t`. |
| **Preflow** | Like a flow but conservation is *relaxed*: internal vertices may have `inflow ≥ outflow`. |
| **Excess** `e(u)` | `inflow(u) − outflow(u)`. For a preflow, `e(u) ≥ 0` for every vertex except `s`. |
| **Active vertex** | An internal vertex (`≠ s, t`) with `e(u) > 0`. These are the ones we still need to work on. |
| **Residual capacity** `c_f(u,v)` | Remaining room on edge `u → v`: `c(u,v) − f(u,v)`. A *residual edge* exists where this is `> 0`. |
| **Height / label** `h(u)` | Integer attached to each vertex; drives where pushes are allowed. |
| **Admissible edge** | A residual edge `u → v` with `h(u) == h(v) + 1`. Only these may receive a push. |
| **PUSH(u,v)** | Move `min(e(u), c_f(u,v))` units of excess from `u` to `v` along an admissible edge. |
| **RELABEL(u)** | Set `h(u) = 1 + min{ h(v) : c_f(u,v) > 0 }`, raising `u` so a push becomes possible. |
| **Saturating push** | A push that fills the edge (`c_f` becomes 0). |
| **Non-saturating push** | A push that empties `u`'s excess but leaves residual room on the edge. |
| **Min-cut** | The smallest-capacity set of edges whose removal disconnects `s` from `t`. Equals the max flow (max-flow min-cut theorem). |

---

## Core Concepts

### 1. Preflow — letting water pile up

In an augmenting-path algorithm, flow conservation holds at *every* step: nothing ever accumulates. Push-relabel deliberately breaks this. We start by **saturating every edge out of the source** — pumping the maximum possible amount out of `s` all at once. That floods the neighbors of `s` with excess.

```
e(u) = (sum of flow into u) − (sum of flow out of u)   ≥ 0   for all u ≠ s
```

Now the algorithm's whole job is to *get rid of the excess*: push it toward `t` if possible, or push it back toward `s` if it cannot reach `t`. When every internal vertex has `e(u) = 0`, the preflow is again a proper flow — and it is provably maximum.

### 2. Height (label) and the valid-labeling invariant

Each vertex `u` has a height `h(u)`. We maintain one rule at all times — the **valid-labeling invariant**:

```
For every residual edge u → v :   h(u) ≤ h(v) + 1
```

In words: you can never look down more than one level along an edge that still has room. We also fix `h(s) = n` and `h(t) = 0` forever. The invariant guarantees that **water flows downhill in single steps**, which is what eventually forces all excess to the sink (or back to the source).

### 3. PUSH — moving excess downhill

```
PUSH(u, v):                       # requires e(u) > 0, c_f(u,v) > 0, h(u) == h(v)+1
    d = min(e(u), c_f(u,v))
    f(u,v) += d ;  f(v,u) -= d    # send d units; the reverse residual grows
    e(u) -= d   ;  e(v)   += d
```

Only **admissible** edges (`h(u) == h(v) + 1`) may be pushed. That single-step downhill rule keeps the labeling valid.

### 4. RELABEL — raising a stuck vertex

If `u` is active but *no* admissible edge leaves it (everything residual is at the same height or higher), we lift `u`:

```
RELABEL(u):                       # requires e(u) > 0 and no admissible edge out of u
    h(u) = 1 + min{ h(v) : c_f(u,v) > 0 }
```

This is the smallest raise that creates a new admissible edge without breaking the invariant.

### 5. The generic algorithm

```
INITIALIZE-PREFLOW(s):
    h[s] = n;  h[everything else] = 0
    for each edge (s, v): push full capacity, set e[v], e[s] accordingly

GENERIC-PUSH-RELABEL:
    while some active vertex u exists:
        if u has an admissible edge (u, v):  PUSH(u, v)
        else:                                 RELABEL(u)
```

When the loop ends (no active vertices), `f` is a maximum flow. The *order* in which you pick the active vertex is what separates the variants:

- **Generic** (any active vertex): `O(V²E)`.
- **FIFO** (process active vertices in a queue): `O(V³)`.
- **Highest-label** (always pick the active vertex with the greatest height): `O(V²√E)`.

---

## Big-O Summary

| Variant | Time | Space | Notes |
|---------|------|-------|-------|
| Generic push-relabel | **O(V²E)** | O(V²) or O(V+E) | Any active-vertex order. |
| FIFO push-relabel | **O(V³)** | O(V+E) | Process active vertices in a queue. Simple and fast. |
| Highest-label push-relabel | **O(V²√E)** | O(V+E) | Always push from the highest active vertex. |
| With gap + global-relabel heuristics | same worst case, **much** faster in practice | O(V+E) | The version you actually ship. |
| Edmonds-Karp (for contrast) | O(VE²) | O(V+E) | Augmenting paths via BFS. |
| Dinic (for contrast) | O(V²E) | O(V+E) | Blocking flows; great on unit-capacity graphs. |

Counts: `V` = vertices, `E` = edges. Push-relabel does at most `O(V²)` relabels, `O(VE)` saturating pushes, and (depending on order) `O(V²E)` or fewer non-saturating pushes.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Heights and gravity | Picture every vertex as a platform at some altitude. Water only ever flows *downhill*, and only down a single step (`h(u) = h(v)+1`). The source is a mountaintop at altitude `n`; the sink is the sea at altitude `0`. |
| Preflow / excess | Each platform is a bucket. We open the source's taps fully, flooding its neighbors. Now buckets are overflowing — that overflow is the **excess**. |
| PUSH | Tip a bucket so its overflow spills onto a lower neighboring platform. You can only spill as much as fits down the pipe (`c_f`) and as much as you have (`e`). |
| RELABEL | A bucket is overflowing but every pipe leads sideways or uphill. So you put the platform on a hydraulic lift and raise it just enough that one outgoing pipe now points downhill. |
| Pushing excess back to the source | Some water gets trapped — it can never reach the sea. As those platforms keep getting relabeled, they eventually rise *above* the source (height `> n`) and the trapped water drains back to the mountaintop. |
| Termination | When every bucket (except source and sink) is empty, the water has settled. The amount that reached the sea is the maximum flow. |

Where the analogy breaks: real water flows continuously; push-relabel moves it in discrete chunks, and a vertex can be raised many times before its water finally settles.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Often the **fastest** max-flow algorithm in practice (with heuristics). | More moving parts than Edmonds-Karp; easy to get the bookkeeping wrong. |
| Beats Dinic on **dense graphs** (E ≈ V²). | The intermediate state is *not* a valid flow — confusing to debug. |
| **Local** operations — parallelizes far better than path-augmenting methods. | Worst-case `O(V³)` / `O(V²√E)` bounds need the heuristics to be realized. |
| Highest-label variant `O(V²√E)` beats generic Dinic `O(V²E)` asymptotically. | Two extra heuristics (gap, global relabel) are practically mandatory for speed. |
| Recovers the min-cut for free (residual reachability from `s`). | Needs care with capacities to avoid integer overflow on excess. |
| No need to recompute whole BFS/DFS layers between pushes. | Highest-label selection needs a bucket structure to be efficient. |

**When to use:** dense graphs, very large flow problems, settings where you can parallelize, or whenever Dinic is too slow.

**When NOT to use:** tiny graphs (just use Edmonds-Karp; the constant factors do not matter), unit-capacity bipartite matching where Hopcroft-Karp / Dinic is simpler, or when readability beats raw speed.

---

## Step-by-Step Walkthrough

Tiny network, 4 vertices: `s=0`, `a=1`, `b=2`, `t=3`. Edges (capacities):

```
0 → 1 (cap 3)
0 → 2 (cap 2)
1 → 2 (cap 1)
1 → 3 (cap 2)
2 → 3 (cap 3)
```

ASCII picture (max flow here is 4 — limited by total out of `s` = 3 + 2 = 5, but in to `t` = 2 + 3 = 5; the real bottleneck makes it 4 once `1→2→3` interplay is resolved; we trace it):

```
        (3)        (2)
   s ───────► a ───────► t
   │          │          ▲
   │(2)       │(1)        │(3)
   ▼          ▼           │
   └────────► b ──────────┘
```

`n = 4`, so `h[s] = 4`, all others `0`.

**Init (saturate source edges):**

```
push 0→1 full (3): f(0,1)=3, e(1)=3
push 0→2 full (2): f(0,2)=2, e(2)=2
heights: h = [4, 0, 0, 0]     excess: e = [_, 3, 2, 0]   (e[s] ignored)
active queue: [1, 2]
```

**Process vertex 1 (e=3, h=0):** No admissible edge yet — every residual neighbor (`2` at h0, `3` at h0, and back-edge `0` at h4) is not one below. RELABEL(1): residual neighbors are `2`(h0), `3`(h0), `0`(h4); min height = 0, so `h[1] = 1`.

```
h = [4, 1, 0, 0]
```

Now `1→3` is admissible (`h[1]=1 == h[3]+1`). PUSH(1,3): `d = min(3, cap 2) = 2`. Saturates it.

```
f(1,3)=2, e(1)=1, e(3)=2   (t collects 2)
```

`1→2` is admissible (`h[1]=1 == h[2]+1`). PUSH(1,2): `d = min(1, cap 1) = 1`. Saturates it.

```
f(1,2)=1, e(1)=0, e(2)=3
```

Vertex 1 is now empty. Enqueue 2 (it gained excess; already active).

**Process vertex 2 (e=3, h=0):** RELABEL needed (residual neighbors `3`(h0), back-edges `0`(h4), `1`(h1)); min = 0 → `h[2]=1`. Now `2→3` admissible. PUSH(2,3): `d = min(3, cap 3) = 3`.

```
f(2,3)=3, e(2)=0, e(3)=5   (t now holds 5)
```

But wait — vertex 2 received 2 from source + 1 from vertex 1 = 3, and pushed all 3 to `t`. Vertex 1 sent 2 to `t` directly. Total into `t`: `2 + 3 = 5`. But edge `2→3` has cap 3 and `1→3` has cap 2, so `t` can absorb at most `2 + 3 = 5`. Let us double-check the source can supply it: out of `s` is `3 + 2 = 5`. So **max flow = 5** here (the `1→2` edge let vertex 1 offload its third unit through `b`).

No internal vertex has excess. **Algorithm halts. Max flow = 5.**

> Re-checking the earlier "4" guess: the cross edge `1→2` is exactly what lets all 5 units through, which is why tracing carefully matters. The min-cut is the source edges `{0→1, 0→2}` with capacity `3 + 2 = 5`.

The key contrast with Edmonds-Karp: we never searched for an `s→t` path. We only ever compared a vertex to its immediate neighbors and either pushed down or lifted up.

---

## Code Examples

### Example: Generic / FIFO Push-Relabel (max flow value)

We use an adjacency-matrix-style `cap[u][v]` and `flow[u][v]` for clarity at junior level (fine for small/dense graphs), with a FIFO queue of active vertices.

#### Go

```go
package main

import "fmt"

type PushRelabel struct {
	n    int
	cap  [][]int
	flow [][]int
	adj  [][]int // neighbor lists (both forward and reverse residual edges)
}

func NewPR(n int) *PushRelabel {
	c := make([][]int, n)
	f := make([][]int, n)
	for i := range c {
		c[i] = make([]int, n)
		f[i] = make([]int, n)
	}
	return &PushRelabel{n: n, cap: c, flow: f, adj: make([][]int, n)}
}

func (g *PushRelabel) AddEdge(u, v, c int) {
	if g.cap[u][v] == 0 && g.cap[v][u] == 0 {
		g.adj[u] = append(g.adj[u], v)
		g.adj[v] = append(g.adj[v], u)
	}
	g.cap[u][v] += c
}

func (g *PushRelabel) MaxFlow(s, t int) int {
	n := g.n
	h := make([]int, n)      // heights
	excess := make([]int, n) // excess at each vertex
	h[s] = n

	// Saturate every edge out of the source.
	for _, v := range g.adj[s] {
		if d := g.cap[s][v]; d > 0 {
			g.flow[s][v] += d
			g.flow[v][s] -= d
			excess[v] += d
			excess[s] -= d
		}
	}

	// FIFO queue of active internal vertices.
	queue := []int{}
	inq := make([]bool, n)
	for v := 0; v < n; v++ {
		if v != s && v != t && excess[v] > 0 {
			queue = append(queue, v)
			inq[v] = true
		}
	}

	push := func(u, v int) {
		d := excess[u]
		if r := g.cap[u][v] - g.flow[u][v]; r < d {
			d = r
		}
		g.flow[u][v] += d
		g.flow[v][u] -= d
		excess[u] -= d
		excess[v] += d
	}
	relabel := func(u int) {
		mn := 1 << 30
		for _, v := range g.adj[u] {
			if g.cap[u][v]-g.flow[u][v] > 0 && h[v] < mn {
				mn = h[v]
			}
		}
		if mn < (1 << 30) {
			h[u] = mn + 1
		}
	}

	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		inq[u] = false
		for excess[u] > 0 {
			pushed := false
			for _, v := range g.adj[u] {
				if g.cap[u][v]-g.flow[u][v] > 0 && h[u] == h[v]+1 {
					push(u, v)
					if v != s && v != t && !inq[v] {
						queue = append(queue, v)
						inq[v] = true
					}
					pushed = true
					if excess[u] == 0 {
						break
					}
				}
			}
			if excess[u] == 0 {
				break
			}
			if !pushed {
				relabel(u)
			}
		}
	}

	total := 0
	for _, v := range g.adj[s] {
		total += g.flow[s][v]
	}
	return total
}

func main() {
	g := NewPR(4)
	for _, e := range [][3]int{{0, 1, 3}, {0, 2, 2}, {1, 2, 1}, {1, 3, 2}, {2, 3, 3}} {
		g.AddEdge(e[0], e[1], e[2])
	}
	fmt.Println("max flow =", g.MaxFlow(0, 3)) // 5
}
```

#### Java

```java
import java.util.*;

public class PushRelabel {
    int n;
    int[][] cap, flow;
    List<List<Integer>> adj;

    PushRelabel(int n) {
        this.n = n;
        cap = new int[n][n];
        flow = new int[n][n];
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
    }

    void addEdge(int u, int v, int c) {
        if (cap[u][v] == 0 && cap[v][u] == 0) {
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        cap[u][v] += c;
    }

    int maxFlow(int s, int t) {
        int[] h = new int[n];
        int[] excess = new int[n];
        h[s] = n;

        for (int v : adj.get(s)) {
            int d = cap[s][v];
            if (d > 0) {
                flow[s][v] += d; flow[v][s] -= d;
                excess[v] += d; excess[s] -= d;
            }
        }

        Deque<Integer> q = new ArrayDeque<>();
        boolean[] inq = new boolean[n];
        for (int v = 0; v < n; v++)
            if (v != s && v != t && excess[v] > 0) { q.add(v); inq[v] = true; }

        while (!q.isEmpty()) {
            int u = q.poll();
            inq[u] = false;
            while (excess[u] > 0) {
                boolean pushed = false;
                for (int v : adj.get(u)) {
                    if (cap[u][v] - flow[u][v] > 0 && h[u] == h[v] + 1) {
                        int d = Math.min(excess[u], cap[u][v] - flow[u][v]);
                        flow[u][v] += d; flow[v][u] -= d;
                        excess[u] -= d; excess[v] += d;
                        if (v != s && v != t && !inq[v]) { q.add(v); inq[v] = true; }
                        pushed = true;
                        if (excess[u] == 0) break;
                    }
                }
                if (excess[u] == 0) break;
                if (!pushed) {
                    int mn = Integer.MAX_VALUE;
                    for (int v : adj.get(u))
                        if (cap[u][v] - flow[u][v] > 0) mn = Math.min(mn, h[v]);
                    if (mn < Integer.MAX_VALUE) h[u] = mn + 1;
                }
            }
        }

        int total = 0;
        for (int v : adj.get(s)) total += flow[s][v];
        return total;
    }

    public static void main(String[] args) {
        PushRelabel g = new PushRelabel(4);
        int[][] edges = {{0, 1, 3}, {0, 2, 2}, {1, 2, 1}, {1, 3, 2}, {2, 3, 3}};
        for (int[] e : edges) g.addEdge(e[0], e[1], e[2]);
        System.out.println("max flow = " + g.maxFlow(0, 3)); // 5
    }
}
```

#### Python

```python
from collections import deque


class PushRelabel:
    def __init__(self, n):
        self.n = n
        self.cap = [[0] * n for _ in range(n)]
        self.flow = [[0] * n for _ in range(n)]
        self.adj = [[] for _ in range(n)]

    def add_edge(self, u, v, c):
        if self.cap[u][v] == 0 and self.cap[v][u] == 0:
            self.adj[u].append(v)
            self.adj[v].append(u)
        self.cap[u][v] += c

    def max_flow(self, s, t):
        n = self.n
        h = [0] * n
        excess = [0] * n
        h[s] = n

        # Saturate edges out of the source.
        for v in self.adj[s]:
            d = self.cap[s][v]
            if d > 0:
                self.flow[s][v] += d
                self.flow[v][s] -= d
                excess[v] += d
                excess[s] -= d

        q = deque(v for v in range(n) if v != s and v != t and excess[v] > 0)
        inq = [False] * n
        for v in q:
            inq[v] = True

        def push(u, v):
            d = min(excess[u], self.cap[u][v] - self.flow[u][v])
            self.flow[u][v] += d
            self.flow[v][u] -= d
            excess[u] -= d
            excess[v] += d

        def relabel(u):
            mn = float("inf")
            for v in self.adj[u]:
                if self.cap[u][v] - self.flow[u][v] > 0:
                    mn = min(mn, h[v])
            if mn < float("inf"):
                h[u] = mn + 1

        while q:
            u = q.popleft()
            inq[u] = False
            while excess[u] > 0:
                pushed = False
                for v in self.adj[u]:
                    if self.cap[u][v] - self.flow[u][v] > 0 and h[u] == h[v] + 1:
                        push(u, v)
                        if v != s and v != t and not inq[v]:
                            q.append(v)
                            inq[v] = True
                        pushed = True
                        if excess[u] == 0:
                            break
                if excess[u] == 0:
                    break
                if not pushed:
                    relabel(u)

        return sum(self.flow[s][v] for v in self.adj[s])


if __name__ == "__main__":
    g = PushRelabel(4)
    for u, v, c in [(0, 1, 3), (0, 2, 2), (1, 2, 1), (1, 3, 2), (2, 3, 3)]:
        g.add_edge(u, v, c)
    print("max flow =", g.max_flow(0, 3))  # 5
```

**What it does:** computes the maximum `s → t` flow with FIFO push-relabel.
**Run:** `go run main.go` | `javac PushRelabel.java && java PushRelabel` | `python pr.py`

---

## Coding Patterns

### Pattern 1: "Saturate the source, then drain the excess"

Every push-relabel run is the same two-phase shape: (a) flood the source's neighbors, (b) loop while any active vertex remains, choosing push or relabel. Memorize this skeleton; the variants only change *which* active vertex you pick.

### Pattern 2: Discharge

A common refactor groups all the work on one vertex into a single `discharge(u)` routine: repeatedly push along admissible edges; when none remain and `u` still has excess, relabel and try again. FIFO push-relabel = "repeatedly discharge the front of the queue."

```python
def discharge(u):
    while excess[u] > 0:
        if no admissible edge out of u:
            relabel(u)
        else:
            push along an admissible edge
```

### Pattern 3: Current-arc (current-edge) pointer

Instead of rescanning a vertex's whole neighbor list every time, keep a pointer `cur[u]` into `adj[u]`. Advance it as edges become inadmissible; reset it to 0 on a relabel. This drops a lot of redundant scanning and is the standard way to hit the proven complexity.

### Pattern 4: Min-cut recovery

After max flow, run a BFS/DFS from `s` over residual edges (`c_f > 0`). Vertices reachable form set `S`; the rest form `T`. The min-cut edges are the original edges from `S` to `T`. Their total capacity equals the max flow.

```mermaid
graph TD
    A[Init: h[s]=n, saturate source edges] --> B{Any active vertex?}
    B -->|yes| C{Admissible edge out?}
    C -->|yes| D[PUSH downhill]
    C -->|no| E[RELABEL: raise vertex]
    D --> B
    E --> B
    B -->|no| F[Preflow is now max flow]
    F --> G[Residual BFS from s → min-cut]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong (too small) max flow | Forgot the back-edge update `flow[v][u] -= d` on push. | Always update both directions; the reverse residual is what lets water flow back. |
| Infinite loop | RELABEL set `h[u]` no higher than before (e.g., took `min` of heights but forgot the `+1`). | `h[u] = 1 + min{h[v] : c_f(u,v)>0}` — the `+1` is mandatory. |
| `IndexError` / nil slice | Pushed onto a vertex never registered in `adj`. | Register both endpoints in `adj` when you first add an edge between them. |
| Excess never clears | Counting `t` or `s` as "active". | Only internal vertices (`≠ s, t`) are active. |
| Integer overflow on excess | Excess can transiently equal the *sum* of incoming capacities. | Use 64-bit accumulators when capacities are large. |
| Min-cut wrong | Used original capacities, not residual, in the reachability BFS. | Traverse only residual edges `c_f(u,v) > 0`. |

---

## Performance Tips

- **Use the FIFO variant first.** It is `O(V³)`, simple, and fast enough for most coursework and contests.
- **Add the gap heuristic and global-relabel heuristic** (covered in *middle.md*) before worrying about anything else — they typically give a 5–20× speedup.
- **Switch to adjacency lists with explicit residual edges** for sparse graphs; the matrix version here is `O(V²)` memory and only suits small/dense inputs.
- **Use a current-arc pointer** to avoid rescanning neighbor lists.
- **For highest-label selection**, keep buckets indexed by height so you can find the highest active vertex in `O(1)` amortized.

---

## Best Practices

- Write Edmonds-Karp first as a *correctness oracle*; test push-relabel against it on random small graphs.
- After termination, assert `excess[u] == 0` for every internal vertex — a cheap invariant check.
- Assert max-flow equals min-cut capacity in tests; it is a strong end-to-end check.
- Keep `h[s] = n` and `h[t] = 0` fixed; never relabel the source or sink.
- Document whether your graph stores parallel edges by summing capacities or by keeping them separate.

---

## Edge Cases & Pitfalls

- **No `s → t` path at all** — max flow is 0; every unit of excess pushed out of `s` eventually returns to `s` (vertices rise above height `n`). The algorithm still terminates correctly.
- **Self-loops** — ignore them; they never carry useful flow.
- **Parallel edges** — either sum their capacities into `cap[u][v]` or store separate residual edges; be consistent.
- **`s == t`** — undefined / flow is `0`; guard against it.
- **Disconnected sink** — flow is `0`.
- **Capacities of 0** — harmless but pointless; skip them when saturating.
- **Huge capacities** — excess can reach the sum of all out-capacities of `s`; size your integer type accordingly.

---

## Common Mistakes

1. **Treating the intermediate preflow as a valid flow** — it is not; conservation is violated until the very end.
2. **Pushing along a non-admissible edge** — only push when `h[u] == h[v] + 1`. Pushing "downhill by more than one" breaks the invariant.
3. **Relabeling without the `+1`** — leaves the vertex stuck and loops forever.
4. **Forgetting to enqueue a vertex that just received excess** in FIFO — its excess never gets processed.
5. **Re-enqueuing `s` or `t`** — they must never be active.
6. **Summing original capacities for the min-cut** instead of crossing-edge capacities from the residual-reachable set.
7. **Relabeling the source or sink** — their heights are fixed.

---

## Cheat Sheet

| Concept | Rule |
|---------|------|
| Init heights | `h[s] = n`, all others `0`. |
| Init preflow | Saturate every edge out of `s`. |
| Active vertex | Internal vertex with `e(u) > 0`. |
| Admissible edge | Residual `u→v` with `h[u] == h[v] + 1`. |
| PUSH amount | `min(e(u), c_f(u,v))`. |
| RELABEL | `h[u] = 1 + min{ h[v] : c_f(u,v) > 0 }`. |
| Termination | No active vertices ⇒ preflow is max flow. |
| Min-cut | Residual-reachable-from-`s` set `S`; crossing edges `S→T`. |
| Generic | `O(V²E)` |
| FIFO | `O(V³)` |
| Highest-label | `O(V²√E)` |

Valid-labeling invariant (always true):

```
for every residual edge u → v :   h(u) ≤ h(v) + 1
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of push-relabel.
>
> The animation demonstrates:
> - Per-vertex **height** (as vertical position) and **excess** (as a badge).
> - **Admissible edges** highlighted in green.
> - **PUSH** (excess flowing downhill) and **RELABEL** (a vertex rising) step by step.
> - The final maximum flow and the **min-cut**.
> - Step / Run / Reset controls.

---

## Summary

Push-relabel turns max-flow on its head: instead of hunting for whole augmenting paths, it floods the source, then repeatedly does two tiny local operations — **push** excess downhill along admissible edges, and **relabel** (raise) a vertex that is stuck. A height function with the valid-labeling invariant (`h(u) ≤ h(v) + 1` on residual edges) guarantees water flows downhill one step at a time, draining either to the sink or back to the source. The generic algorithm is `O(V²E)`; FIFO selection is `O(V³)`; highest-label is `O(V²√E)`; and two heuristics make it the fastest max-flow method in practice. Master `push` and `relabel`, and you have mastered the whole family.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Chapter 26 — "Maximum Flow", §26.4 "Push-relabel algorithms".
- Goldberg & Tarjan (1988), *A new approach to the maximum-flow problem*, JACM 35(4).
- cp-algorithms.com — "Maximum flow — Push-relabel algorithm" and "Push-relabel method improvements".
- The sibling topic *max-flow-edmonds-karp-dinic* — read it for the augmenting-path contrast.
- The sibling topics *bipartite-matching* and *min-cost-max-flow* — common applications.
