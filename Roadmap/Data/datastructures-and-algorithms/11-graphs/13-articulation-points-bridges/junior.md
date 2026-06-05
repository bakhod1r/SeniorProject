# Articulation Points & Bridges — Junior Level

> **One-line summary:** In an undirected graph, an *articulation point* (cut vertex) is a vertex whose removal disconnects the graph, and a *bridge* (cut edge) is an edge whose removal disconnects it. Both are found in a single DFS using two timestamps per vertex — `disc[u]` (when DFS first reached `u`) and `low[u]` (the earliest vertex reachable from `u`'s subtree using at most one back edge).

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

Imagine a network of routers connected by cables. Some routers and some cables are *critical*: if that one router dies, or that one cable is cut, part of the network can no longer talk to the rest. Finding those critical points before they fail is the whole point of this topic.

In graph terms, given a **connected undirected graph**:

- An **articulation point** (also called a *cut vertex*) is a vertex whose removal — together with all its incident edges — increases the number of connected components. Remove it and the graph falls apart.
- A **bridge** (also called a *cut edge*) is an edge whose removal increases the number of connected components.

The naive way to find them is brutal: remove each vertex (or edge) one at a time, run a fresh connectivity check, and see if the graph split. That is `O(V · (V + E))` for vertices and `O(E · (V + E))` for edges — fine for tiny graphs, hopeless at scale.

The elegant way, discovered by **Robert Tarjan in 1973**, finds *all* articulation points and *all* bridges in a **single depth-first search**, in `O(V + E)` total. The trick is to record, for every vertex, two numbers during the DFS:

1. `disc[u]` — the **discovery time**: a counter value stamped on `u` the moment DFS first visits it.
2. `low[u]` — the **low-link value**: the smallest discovery time reachable from `u`'s DFS subtree, where you are allowed to take tree edges downward and **at most one back edge** upward.

Once you have those two numbers at every vertex, a couple of simple inequalities tell you exactly which vertices are articulation points and which edges are bridges. That is the entire algorithm — two arrays and a comparison.

This same `disc`/`low` machinery is the foundation of several related ideas you will meet later: strongly connected components (Tarjan's SCC), biconnected components, and the block-cut tree. Master it once here and you reuse it everywhere.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Undirected graphs** and their representation as an **adjacency list**.
- **Depth-first search (DFS)** — recursion, the call stack, visiting order. This is the single most important prerequisite.
- **Connected components** — what it means for two vertices to be "connected."
- **Recursion** — DFS here is written recursively; you must understand the parent/child relationship in the DFS tree.
- **Arrays as side tables** — we keep `disc[]`, `low[]`, and `visited[]` indexed by vertex id.
- **Big-O notation** — `O(V + E)`.

Optional but helpful:

- Having seen **Tarjan's SCC** or **bipartite/cycle detection via DFS** — the timestamp idea generalizes.
- Drawing a **DFS tree** on paper, classifying edges as *tree edges* vs *back edges*.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Articulation point / cut vertex** | A vertex whose removal increases the number of connected components. |
| **Bridge / cut edge** | An edge whose removal increases the number of connected components. |
| **DFS tree** | The tree formed by the edges actually traversed during DFS. The root is where DFS started. |
| **Tree edge** | An edge `(u, v)` used by DFS to first reach `v` from `u`. Forms the DFS tree. |
| **Back edge** | A non-tree edge connecting `u` to an *ancestor* of `u` in the DFS tree. In an undirected graph, every non-tree edge is a back edge. |
| **`disc[u]` (discovery time)** | The timer value stamped on `u` when DFS first visits it. Earlier discovery = smaller number = closer to the root. |
| **`low[u]` (low-link)** | The minimum `disc` reachable from `u`'s subtree via tree edges down and at most one back edge up. |
| **Root (of DFS)** | The starting vertex of the DFS. It is treated specially in the articulation-point test. |
| **Child / subtree** | In the DFS tree, `v` is a child of `u` if the tree edge `(u, v)` was used; `v`'s subtree is everything reachable below it. |
| **Biconnected component** | A maximal subgraph with no articulation point (2-vertex-connected). Covered at middle level. |
| **2-edge-connected component** | A maximal subgraph with no bridge. Covered at middle level. |

---

## Core Concepts

### 1. The DFS tree and two kinds of edges

When you run DFS on an undirected graph, every edge ends up being one of exactly two types:

- A **tree edge** — the edge DFS used to descend into a new vertex.
- A **back edge** — an edge to a vertex that was already visited and is an *ancestor* on the current DFS path.

(Undirected graphs have no "cross edges" or "forward edges" — that is a directed-graph thing. This simplification is what makes articulation points easy.)

Drawing the DFS tree and marking back edges is the mental model for everything that follows.

```
   Graph:  0 - 1 - 2        DFS from 0:        0          (tree edges down)
           |   |   |                           |
           +---+   3                           1
                                              / \
                                             2   (back edge 2-0 goes up)
                                             |
                                             3
```

### 2. `disc[u]` — discovery time

Keep a global counter `timer`, starting at 0. The first time DFS reaches a vertex, stamp it: `disc[u] = low[u] = timer++`. A smaller `disc` means the vertex was discovered earlier and therefore sits *higher* (closer to the root) in the DFS tree.

### 3. `low[u]` — the low-link value

`low[u]` answers: *"What is the earliest-discovered vertex I can reach starting from `u`, going down through my subtree's tree edges and then taking at most one back edge upward?"*

We compute `low[u]` while the DFS unwinds. Initialize `low[u] = disc[u]`. Then for each neighbor `v` of `u`:

- If `v` is **not visited** → it becomes a tree-edge child. Recurse, then `low[u] = min(low[u], low[v])` (a child can reach high up; that pulls `u`'s low value up too).
- If `v` **is visited** and `v` is **not the parent** → edge `(u, v)` is a back edge. `low[u] = min(low[u], disc[v])`.

That single back-edge minimum is what lets a vertex "escape" upward past its parent.

### 4. The articulation-point criteria

For a **non-root** vertex `u` with a DFS-tree child `v`:

> `u` is an articulation point **if** `low[v] >= disc[u]`.

Read it in plain English: if the deepest the subtree under `v` can reach (`low[v]`) is *no higher than `u` itself* (`disc[u]`), then nothing under `v` has a way around `u`. Remove `u` and `v`'s subtree is cut off. So `u` is critical.

The **root** is special. The root has no parent and no `disc[u]` to compare against in the same way. The rule is:

> The root is an articulation point **if and only if** it has **2 or more** DFS-tree children.

If the root had only one child, removing it just removes a leaf-ish top; the rest stays connected through that one child. Two or more children means the root was the only thing joining those subtrees.

### 5. The bridge criterion

For a tree edge `(u, v)` (where `v` is the child):

> Edge `(u, v)` is a **bridge if** `low[v] > disc[u]`.

Note the **strict** `>` here, versus the **non-strict** `>=` for articulation points. That single character is the whole difference, and it matters:

- `low[v] > disc[u]` means the subtree under `v` *cannot even reach `u`* by any back edge — the only connection is the edge `(u, v)` itself. Cut it and `v`'s subtree is isolated. Bridge.
- `low[v] == disc[u]` means the subtree can reach `u` (but no higher). The edge is *not* a bridge (there is a back edge to `u` providing an alternate route), but `u` may still be an articulation point.

The root needs no special case for bridges — the `>` test already handles it correctly.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Find all articulation points | **O(V + E)** | O(V) | Single DFS, arrays `disc`, `low`, `visited`. |
| Find all bridges | **O(V + E)** | O(V) | Same DFS, different test (`>` vs `>=`). |
| Both at once | **O(V + E)** | O(V) | They share the entire DFS. |
| Naive remove-and-check (vertices) | O(V · (V + E)) | O(V + E) | Remove each vertex, re-run connectivity. |
| Naive remove-and-check (edges) | O(E · (V + E)) | O(V + E) | Remove each edge, re-run connectivity. |

Space is `O(V)` for the side tables plus `O(V)` recursion stack (which can overflow on deep graphs — see senior level for the iterative version).

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Articulation point | A single airport hub. If it closes, several regions can no longer fly to each other. The hub is a single point of failure. |
| Bridge | The only road across a river between two towns. Wash it out and the towns are cut off — there is no second route. |
| `disc[u]` | The order in which a hiker first reaches each junction on a trail map. |
| `low[u]` | The highest point on the trail you can loop back to from where you are, using at most one shortcut path. |
| `low[v] >= disc[u]` | "Everything past this junction has no shortcut back above me — so I'm the chokepoint." |
| Two-children root rule | A town square that is the *only* connector of two separate neighborhoods. Bulldoze the square and the neighborhoods are split. |

Where the analogy breaks: real road networks have weights and directions; here every edge is undirected and unweighted. The single-point-of-failure intuition, though, is exactly right — this algorithm is literally used for network reliability analysis.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Finds *all* articulation points and bridges in one `O(V + E)` pass. | Recursive DFS can stack-overflow on long path graphs (millions of vertices). |
| Tiny code — about 25 lines once you understand `disc`/`low`. | The root special case and the parent-edge skip are easy to get wrong. |
| Same machinery extends to biconnected components and the block-cut tree. | Multi-edges (two edges between the same pair) need careful handling for bridges. |
| No extra data structures beyond three integer arrays. | Only defined for undirected graphs; directed connectivity uses SCCs instead. |
| Strict vs non-strict inequality cleanly separates the two answers. | Gives a static snapshot; if the graph changes you re-run (see online/dynamic variants). |

**When to use:** network reliability, finding single points of failure, redundancy planning, decomposing a graph into 2-connected pieces, building a block-cut or bridge tree.

**When NOT to use:** directed graphs (use SCC), weighted shortest-path questions (use Dijkstra), or when the graph mutates constantly and you need incremental updates (use a dynamic-connectivity structure).

---

## Step-by-Step Walkthrough

Take this small connected graph (6 vertices). Edges:

```
0-1, 1-2, 2-0, 1-3, 3-4, 4-5, 5-3
```

Drawn:

```
        0
       / \
      1---2
      |
      3
     / \
    4   5
     \ /
      (4-5, 5-3 close a triangle)
```

Vertices `{0,1,2}` form a triangle, vertices `{3,4,5}` form a triangle, and edge `1-3` joins the two triangles.

Run DFS from vertex `0`. The `timer` starts at 0. We descend `0 → 1 → 2` (then `2-0` is a back edge), back up to `1`, then `1 → 3 → 4 → 5` (then `5-3` is a back edge).

Tracing `disc` and `low` (discovery order: 0,1,2,3,4,5):

| Vertex | `disc` | Computed `low` | Reason |
|--------|--------|----------------|--------|
| 0 | 0 | 0 | root |
| 1 | 1 | 0 | child 2 has back edge to 0 (`disc 0`), so `low[2]=0` pulls `low[1]` to 0 |
| 2 | 2 | 0 | back edge `2-0`, `disc[0]=0` |
| 3 | 3 | 3 | subtree {3,4,5} cannot reach above 3 |
| 4 | 4 | 3 | back path 4→5→3 reaches `disc[3]=3` |
| 5 | 5 | 3 | back edge `5-3`, `disc[3]=3` |

Now apply the criteria.

**Articulation points** (non-root `u`, child `v`, test `low[v] >= disc[u]`):

- `u=1`, child `v=3`: `low[3] = 3 >= disc[1] = 1`? **Yes** → `1` is an articulation point. (Makes sense: remove `1` and the two triangles split.)
- `u=1`, child `v=2`: `low[2] = 0 >= disc[1] = 1`? No.
- `u=3`, children `4`: `low[4] = 3 >= disc[3] = 3`? **Yes**, but wait — `4` reaches back to `3` and `5` also closes the triangle, so let us check carefully. Child of `3` in the DFS tree is `4` (we went `3→4→5`). `low[4]=3 >= disc[3]=3` → `3` looks like an articulation point. Indeed removing `3` disconnects... no: `4-5` still connects `4` and `5` to each other but not to the rest. So **yes, `3` is an articulation point** because `1-3` is the only link from the top triangle, and `3` is the gateway into `{4,5}`. Actually removing `3` leaves `{4,5}` connected to each other but cut from `{0,1,2}`. So `3` is an articulation point.

Hold on — re-examine `3`. The edge into `{4,5}` from above is `1-3`. The triangle `3-4-5` means `4` and `5` connect to each other and to `3`. Remove `3`: `4-5` survives but `{4,5}` loses its only link (which went through `3`) to the rest. So `3` *is* an articulation point. Confirmed by `low[4] = 3 >= disc[3] = 3`.

- **Root `0`:** how many DFS children? Just one (`1`). One child → `0` is **not** an articulation point.

So articulation points = `{1, 3}`.

**Bridges** (tree edge `(u, v)`, test `low[v] > disc[u]`):

- `(1, 3)`: `low[3] = 3 > disc[1] = 1`? **Yes** → `1-3` is a **bridge**. (The only link between the triangles.)
- `(0, 1)`: `low[1] = 0 > disc[0] = 0`? No (0 > 0 is false).
- `(1, 2)`: `low[2] = 0 > disc[1] = 1`? No.
- `(3, 4)`: `low[4] = 3 > disc[3] = 3`? No.
- `(4, 5)`: `low[5] = 3 > disc[4] = 4`? No.

So bridges = `{(1, 3)}`. Every edge inside a triangle is *not* a bridge (cycles provide redundancy); the lone connecting edge *is*.

Notice the symmetry: `1-3` is a bridge **and** both its endpoints `1` and `3` are articulation points. That is common but not a rule — a vertex can be an articulation point without touching any bridge (think of a vertex shared by two cycles).

---

## Code Examples

### Example: Find articulation points and bridges in one DFS

The graph is an adjacency list `adj[u] = [neighbors]`. We carry the **parent vertex** down the recursion to skip the edge we came in on. (For now we assume no multi-edges; we revisit that in *Edge Cases*.)

#### Go

```go
package main

import "fmt"

type Graph struct {
	n   int
	adj [][]int
}

func NewGraph(n int) *Graph {
	return &Graph{n: n, adj: make([][]int, n)}
}

func (g *Graph) AddEdge(u, v int) {
	g.adj[u] = append(g.adj[u], v)
	g.adj[v] = append(g.adj[v], u)
}

func (g *Graph) FindCutsAndBridges() (map[int]bool, [][2]int) {
	disc := make([]int, g.n)
	low := make([]int, g.n)
	visited := make([]bool, g.n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	aps := map[int]bool{}
	var bridges [][2]int

	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		visited[u] = true
		disc[u] = timer
		low[u] = timer
		timer++
		children := 0

		for _, v := range g.adj[u] {
			if v == parent {
				continue // skip the edge we came in on
			}
			if visited[v] {
				// back edge: v is an ancestor
				if disc[v] < low[u] {
					low[u] = disc[v]
				}
			} else {
				children++
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				// articulation point test (non-root)
				if parent != -1 && low[v] >= disc[u] {
					aps[u] = true
				}
				// bridge test (strict)
				if low[v] > disc[u] {
					bridges = append(bridges, [2]int{u, v})
				}
			}
		}
		// root special case
		if parent == -1 && children >= 2 {
			aps[u] = true
		}
	}

	for i := 0; i < g.n; i++ {
		if !visited[i] {
			dfs(i, -1)
		}
	}
	return aps, bridges
}

func main() {
	g := NewGraph(6)
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}}
	for _, e := range edges {
		g.AddEdge(e[0], e[1])
	}
	aps, bridges := g.FindCutsAndBridges()
	fmt.Println("articulation points:", aps) // {1, 3}
	fmt.Println("bridges:", bridges)          // [[1 3]]
}
```

#### Java

```java
import java.util.*;

public class CutsAndBridges {
    private final int n;
    private final List<List<Integer>> adj;
    private int[] disc, low;
    private boolean[] visited;
    private int timer = 0;
    private final Set<Integer> aps = new HashSet<>();
    private final List<int[]> bridges = new ArrayList<>();

    public CutsAndBridges(int n) {
        this.n = n;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
    }

    public void addEdge(int u, int v) {
        adj.get(u).add(v);
        adj.get(v).add(u);
    }

    public void run() {
        disc = new int[n];
        low = new int[n];
        visited = new boolean[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) {
            if (!visited[i]) dfs(i, -1);
        }
    }

    private void dfs(int u, int parent) {
        visited[u] = true;
        disc[u] = low[u] = timer++;
        int children = 0;
        for (int v : adj.get(u)) {
            if (v == parent) continue;           // skip the parent edge
            if (visited[v]) {
                low[u] = Math.min(low[u], disc[v]); // back edge
            } else {
                children++;
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (parent != -1 && low[v] >= disc[u]) aps.add(u);
                if (low[v] > disc[u]) bridges.add(new int[]{u, v});
            }
        }
        if (parent == -1 && children >= 2) aps.add(u); // root
    }

    public Set<Integer> articulationPoints() { return aps; }
    public List<int[]> bridges() { return bridges; }

    public static void main(String[] args) {
        CutsAndBridges g = new CutsAndBridges(6);
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}};
        for (int[] e : edges) g.addEdge(e[0], e[1]);
        g.run();
        System.out.println("articulation points: " + g.articulationPoints());
        for (int[] b : g.bridges()) System.out.println("bridge: " + b[0] + "-" + b[1]);
    }
}
```

#### Python

```python
import sys


class Graph:
    def __init__(self, n):
        self.n = n
        self.adj = [[] for _ in range(n)]

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def find_cuts_and_bridges(self):
        disc = [-1] * self.n
        low = [0] * self.n
        visited = [False] * self.n
        timer = [0]
        aps = set()
        bridges = []

        def dfs(u, parent):
            visited[u] = True
            disc[u] = low[u] = timer[0]
            timer[0] += 1
            children = 0
            for v in self.adj[u]:
                if v == parent:
                    continue                       # skip the parent edge
                if visited[v]:
                    low[u] = min(low[u], disc[v])  # back edge
                else:
                    children += 1
                    dfs(v, u)
                    low[u] = min(low[u], low[v])
                    if parent != -1 and low[v] >= disc[u]:
                        aps.add(u)
                    if low[v] > disc[u]:
                        bridges.append((u, v))
            if parent == -1 and children >= 2:
                aps.add(u)                         # root

        for i in range(self.n):
            if not visited[i]:
                dfs(i, -1)
        return aps, bridges


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    g = Graph(6)
    for u, v in [(0, 1), (1, 2), (2, 0), (1, 3), (3, 4), (4, 5), (5, 3)]:
        g.add_edge(u, v)
    aps, bridges = g.find_cuts_and_bridges()
    print("articulation points:", sorted(aps))  # [1, 3]
    print("bridges:", bridges)                   # [(1, 3)]
```

**What it does:** runs one DFS, computes `disc`/`low`, applies `low[v] >= disc[u]` for cut vertices and `low[v] > disc[u]` for bridges, with the root handled by counting children.
**Run:** `go run main.go` | `javac CutsAndBridges.java && java CutsAndBridges` | `python cuts.py`

---

## Coding Patterns

### Pattern 1: Carry the parent to skip the incoming edge

In an undirected graph, `adj[u]` contains the vertex you just came from. Without skipping it, you would treat the parent as a back edge and wrongly lower `low[u]`. The simplest fix is to pass `parent` down the recursion and `continue` when `v == parent`.

```python
def dfs(u, parent):
    for v in adj[u]:
        if v == parent:
            continue
        ...
```

This is correct as long as there are no two edges between the same pair (see *Edge Cases* for the multi-edge fix using a parent *edge id* instead of a parent *vertex*).

### Pattern 2: Initialize `low = disc`, then relax it

Always set `disc[u] = low[u] = timer++` on first visit, then only ever *lower* `low[u]` with `min(...)`. Two relaxations:

- From a child's `low` (subtree can escape high) — `low[u] = min(low[u], low[v])`.
- From a back edge's target `disc` — `low[u] = min(low[u], disc[v])`.

### Pattern 3: The "remember the strict vs non-strict" rule

```text
articulation point (non-root):  low[child] >= disc[u]     # >=
bridge (tree edge u-child):     low[child]  > disc[u]     # >
root is articulation point:     dfs-children >= 2
```

```mermaid
graph TD
    A[Start DFS at root] --> B[Stamp disc and low on first visit]
    B --> C{Neighbor v?}
    C -->|unvisited| D[Tree edge: recurse, then low[u]=min(low[u],low[v])]
    C -->|visited and not parent| E[Back edge: low[u]=min(low[u],disc[v])]
    D --> F{low[v] >= disc[u]?}
    F -->|yes, non-root| G[u is articulation point]
    D --> H{low[v] > disc[u]?}
    H -->|yes| I[u-v is a bridge]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Parent edge counted as back edge | Forgot the `v == parent` skip. | Pass `parent` (or parent edge id) and `continue`. |
| Stack overflow / `RecursionError` | Deep DFS on a long path of millions of vertices. | Raise the recursion limit (Python) or use an explicit-stack iterative DFS (senior level). |
| Wrong root result | Compared root with `disc[u]` like a normal vertex. | Handle the root by counting children `>= 2`. |
| A doubled edge reported as a bridge | Used parent *vertex* skip with multi-edges. | Skip by parent *edge id*, not vertex (see below). |
| Missing some cut vertices on a disconnected graph | DFS launched from only one vertex. | Loop over all vertices, launching DFS on each unvisited one. |
| `low`/`disc` left at 0 | Forgot to initialize `disc` to `-1` and treat `0` as "unvisited." | Use a separate `visited[]` boolean instead of overloading `0`. |

---

## Performance Tips

- **One DFS does both.** Never run two passes — articulation points and bridges share the entire `disc`/`low` computation.
- **Use an adjacency list, not a matrix.** A matrix makes the DFS `O(V²)`; a list keeps it `O(V + E)`.
- **Cache `disc[u]` in a local** inside the neighbor loop; it does not change while you scan `u`'s neighbors.
- **Prefer a `visited[]` boolean** over checking `disc[u] == -1` repeatedly — it reads cleaner and is just as fast.
- **For huge graphs, go iterative.** Recursion has per-call overhead and a hard stack-depth limit; an explicit stack avoids both.

---

## Best Practices

- Write a brute-force "remove each vertex/edge and re-check connectivity" baseline first, then test your fast version against it on random small graphs.
- Always handle **disconnected** input: loop over every vertex and start a DFS if it has not been visited.
- Be explicit in comments about **`>=` for vertices vs `>` for bridges** — future readers (and you) will second-guess it.
- Store bridges as a *set of normalized pairs* (`min(u,v), max(u,v)`) if you need to look them up or dedupe.
- Keep the root rule near the cut-vertex rule in code so the special case is obvious.

---

## Edge Cases & Pitfalls

- **The root.** A non-root test (`low[v] >= disc[u]`) gives wrong answers for the root. Count DFS children: `>= 2` means articulation point.
- **Multi-edges (two edges between the same pair).** With the simple "skip the parent *vertex*" rule, a doubled edge `u=v` would be skipped entirely, but it also means a single edge between `u` and `v` is *never* a bridge if duplicated. Correct handling: track the **edge id** you arrived on, skip only that specific edge, and let the *second* parallel edge act as a back edge. A doubled edge is **never** a bridge (there are two routes), so this matters.
- **Self-loops.** An edge `u-u` is irrelevant to cuts and bridges; skip it (`if v == u continue`).
- **Disconnected graph.** Articulation points and bridges are still well-defined per component. Run DFS from each unvisited vertex; the "increase in components" definition holds within a component.
- **Single vertex / single edge.** One vertex: no cut vertices, no bridges. One edge `u-v`: that edge *is* a bridge, neither endpoint is a cut vertex (removing a degree-1 vertex never disconnects anything).
- **Two vertices, two parallel edges.** No bridge (redundant), no cut vertex.

---

## Common Mistakes

1. **Using `low[u] = min(low[u], low[v])` for a back edge.** For a back edge you must use the *neighbor's `disc`*, not its `low`. (Using `low` happens to be correct for undirected back edges but is conceptually wrong and breaks in directed generalizations — stick to `disc` for back edges.)
2. **Forgetting the root special case.** Leads to false positives at the root.
3. **Swapping `>` and `>=`.** `>=` finds articulation points, `>` finds bridges. Mixing them up reports the wrong set.
4. **Skipping the parent by vertex when multi-edges exist.** A parallel edge gets wrongly ignored; skip by edge id instead.
5. **Not looping over all components.** You miss cut vertices and bridges in components you never visited.
6. **Comparing `low[v]` to `disc[v]` instead of `disc[u]`.** The test always compares the child's `low` against the *parent's* `disc`.
7. **Recursing without raising the stack limit** in Python on big inputs, causing a silent `RecursionError`.

---

## Cheat Sheet

| Question | Test |
|----------|------|
| Is non-root `u` an articulation point? | Some child `v` has `low[v] >= disc[u]`. |
| Is root `u` an articulation point? | `u` has `>= 2` DFS-tree children. |
| Is tree edge `(u, v)` a bridge? | `low[v] > disc[u]` (strict). |
| Back-edge relaxation | `low[u] = min(low[u], disc[v])`. |
| Tree-edge relaxation | `low[u] = min(low[u], low[v])`. |
| Skip the edge we came on | `if v == parent: continue` (or skip parent edge id for multi-edges). |

```text
disc[u] = low[u] = timer++          # on first visit
tree edge (u,v):  low[u] = min(low[u], low[v])
back edge (u,v):  low[u] = min(low[u], disc[v])
cut vertex (non-root): low[v] >= disc[u]
cut vertex (root):     children >= 2
bridge:                low[v] >  disc[u]
```

A doubled edge is **never** a bridge. Total cost: `O(V + E)`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of the DFS that finds articulation points and bridges.
>
> The animation demonstrates:
> - The DFS descending through a small undirected graph, stamping `disc` and `low` on each vertex.
> - Tree edges versus back edges, highlighted differently.
> - `low` values being relaxed as the recursion unwinds.
> - Articulation points and bridges turning red the moment their criteria (`low[v] >= disc[u]` and `low[v] > disc[u]`) fire.
> - Step / Run / Reset controls.

---

## Summary

An articulation point is a vertex whose removal disconnects the graph; a bridge is an edge whose removal does the same. Both fall out of a single `O(V + E)` DFS that records `disc[u]` (when a vertex was discovered) and `low[u]` (the highest ancestor its subtree can reach via one back edge). A non-root vertex is a cut vertex when some child satisfies `low[v] >= disc[u]`; the root is one when it has two or more DFS children; an edge is a bridge when `low[v] > disc[u]`. The strict-versus-non-strict inequality is the only subtlety, and the root and multi-edge cases are the only traps. Master `disc`/`low` here and you have the foundation for biconnected components, the block-cut tree, and beyond.

---

## Further Reading

- R. E. Tarjan, *Depth-First Search and Linear Graph Algorithms*, SIAM J. Computing 1(2), 1972 — the original.
- *Introduction to Algorithms* (CLRS), the DFS chapter and the problems on articulation points/bridges.
- *Competitive Programmer's Handbook* (Laaksonen), the graph-connectivity chapter.
- cp-algorithms.com — "Finding articulation points" and "Finding bridges in O(V+E)."
- Sibling topics in this section: `08-tarjan-scc` (same timestamp idea, directed), `23-edge-vertex-connectivity` (general k-connectivity), and `30-online-bridges` (maintaining bridges under edge insertions).
