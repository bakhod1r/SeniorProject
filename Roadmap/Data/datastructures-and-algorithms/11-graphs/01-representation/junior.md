# Graph Representation — Junior Level

> **One-line summary:** A graph is a set of vertices connected by edges, and the three classic ways to store one in memory are the *adjacency matrix* (a `V×V` grid, `O(1)` edge lookup), the *adjacency list* (one neighbor list per vertex, `O(V+E)` space, fast to iterate neighbors), and the *edge list* (a flat array of `(u, v, w)` triples, ideal for algorithms that scan all edges).

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

A **graph** is the most general data structure for modelling *relationships*. Whenever you have a collection of things and pairs of those things are connected — friends on a social network, cities joined by roads, web pages linked by hyperlinks, tasks blocked by other tasks — you have a graph. Trees, linked lists, and grids are all special cases of graphs.

Mathematically a graph is written `G = (V, E)`: a set of **vertices** (also called nodes) `V`, and a set of **edges** `E` where each edge joins two vertices. That definition is abstract — it says *what* a graph is, not *how* you store one in a computer. Choosing the storage layout is the first decision in every graph problem, and it is the subject of this entire topic.

There are three classic representations, and the whole game is a space-versus-speed trade-off:

1. **Adjacency matrix** — a `V×V` table where cell `(u, v)` says whether (or how strongly) `u` connects to `v`. Edge lookup is `O(1)`, but the table costs `O(V²)` memory whether or not the graph has many edges.
2. **Adjacency list** — for each vertex, a list of its neighbors. Total memory is `O(V + E)`, and iterating a vertex's neighbors is as fast as it can be. Asking "is there an edge `u→v`?" costs `O(degree(u))`.
3. **Edge list** — a single flat array of edges, each an `(u, v)` pair (plus a weight if the graph is weighted). It is trivial to build and perfect for algorithms like Kruskal's MST and Bellman-Ford that sweep over *every* edge.

Almost everything you will do with graphs — breadth-first search, depth-first search, Dijkstra, topological sort — sits on top of one of these three. Pick the wrong one and a solution that should run in milliseconds can run for minutes or blow up your memory. Pick the right one and the algorithm almost writes itself.

---

## Prerequisites

Before you read this file you should be comfortable with:

- **Arrays and indexing** — every representation is built from arrays.
- **Dynamic arrays / lists** (`slice`, `ArrayList`, `list`) — adjacency lists grow at runtime.
- **Hash maps / dictionaries** — useful when vertices are labelled by strings instead of `0..V-1`.
- **Loops and nested loops** — iterating a matrix is a double loop; iterating a list is a single loop per vertex.
- **Big-O notation** — `O(1)`, `O(V)`, `O(E)`, `O(V²)`, `O(V+E)`.
- **The idea of a 2-D array** — for the adjacency matrix.

Optional but helpful:

- A first look at **BFS or DFS on paper** — the representation is what those traversals read.
- Familiarity with **trees**, since a tree is just a connected graph with no cycles.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Vertex (node)** | A single entity in the graph. Usually numbered `0 .. V-1`. |
| **Edge** | A connection between two vertices, written `(u, v)`. |
| **Directed graph (digraph)** | Edges have a direction: `u→v` does not imply `v→u`. |
| **Undirected graph** | Edges go both ways: `u—v` means you can travel either direction. |
| **Weighted graph** | Each edge carries a number (cost, distance, capacity). |
| **Degree** | Number of edges touching a vertex. In a digraph: **in-degree** and **out-degree**. |
| **Adjacent / neighbor** | Two vertices joined by an edge are adjacent; each is a neighbor of the other. |
| **Path** | A sequence of vertices each joined to the next by an edge. |
| **Cycle** | A path that starts and ends at the same vertex without reusing an edge. |
| **Connected** | An undirected graph where every vertex is reachable from every other. |
| **Dense graph** | Many edges, `E` close to `V²`. |
| **Sparse graph** | Few edges, `E` close to `V` (most real-world graphs). |
| **Self-loop** | An edge from a vertex to itself, `(v, v)`. |
| **Parallel edges (multigraph)** | Two or more edges joining the same pair of vertices. |
| **DAG** | Directed Acyclic Graph — a directed graph with no cycles (dependency graphs, build order). |
| **Adjacency matrix** | A `V×V` table; `M[u][v]` records the edge `u→v`. |
| **Adjacency list** | An array of lists; `adj[u]` holds the neighbors of `u`. |
| **Edge list** | A flat array of `(u, v)` or `(u, v, w)` records. |
| **CSR** | Compressed Sparse Row — a flat, cache-friendly packing of an adjacency list. |

---

## Core Concepts

### 1. The three representations, side by side

Take this small **undirected** graph with 4 vertices `{0,1,2,3}` and edges `0—1, 0—2, 1—2, 2—3`:

```
        0 --- 1
        |   /
        | /
        2 --- 3
```

**Adjacency matrix** (`1` means "edge exists", undirected so it is symmetric):

```
     0  1  2  3
  0 [ 0  1  1  0 ]
  1 [ 1  0  1  0 ]
  2 [ 1  1  0  1 ]
  3 [ 0  0  1  0 ]
```

**Adjacency list** (each vertex maps to its neighbors):

```
  0 -> [1, 2]
  1 -> [0, 2]
  2 -> [0, 1, 3]
  3 -> [2]
```

**Edge list** (each edge once; for undirected we store each pair a single time):

```
  [ (0,1), (0,2), (1,2), (2,3) ]
```

All three describe the *same graph*. They differ only in what is cheap and what is expensive.

### 2. Directed vs undirected storage

- **Undirected:** in the matrix, set both `M[u][v]` and `M[v][u]`. In the list, append `v` to `adj[u]` *and* `u` to `adj[v]`. In the edge list, store the pair once.
- **Directed:** in the matrix, set only `M[u][v]`. In the list, append only `v` to `adj[u]`. The edge `u→v` exists; `v→u` does not unless added separately.

A common beginner bug is forgetting the *second* insertion for undirected graphs and silently building a directed graph.

### 3. Weights

For a **weighted** graph:

- **Matrix:** store the weight instead of `1`, and use a sentinel (often `0`, `+∞`, or `-1`) to mean "no edge". Be careful: if `0` is a legal weight, do not also use `0` for "no edge".
- **List:** store pairs `(neighbor, weight)` instead of bare neighbors.
- **Edge list:** store triples `(u, v, w)`.

### 4. `O(1)` edge lookup vs fast neighbor iteration

This is the heart of the trade-off:

- The **matrix** answers "is there an edge `u→v`?" in `O(1)` — one array read. But to list `u`'s neighbors you must scan an entire row of `V` cells, even if `u` has only two neighbors.
- The **list** answers "is there an edge `u→v`?" in `O(degree(u))` — you scan `u`'s neighbor list. But it iterates `u`'s neighbors in exactly `O(degree(u))`, with nothing wasted.

Most graph algorithms iterate neighbors far more than they test single edges, which is why the adjacency list is the default in practice.

### 5. Dense vs sparse decides the winner

- A graph is **dense** when `E ≈ V²` (almost every possible edge exists). Here the matrix's `O(V²)` memory is not wasteful — you would need it anyway — and the `O(1)` lookup is a bonus.
- A graph is **sparse** when `E ≈ V` (each vertex has only a handful of neighbors). Here the matrix wastes enormous memory storing `0`s, and the adjacency list's `O(V+E)` is dramatically smaller.

Real-world graphs — road networks, social graphs, the web — are almost always sparse, so the adjacency list dominates.

---

## Big-O Summary

`V` = number of vertices, `E` = number of edges, `d = degree(u)` for the relevant vertex.

| Operation | Adjacency Matrix | Adjacency List | Edge List |
|-----------|------------------|----------------|-----------|
| **Space** | `O(V²)` | `O(V + E)` | `O(E)` |
| **Has edge `u→v`?** | `O(1)` | `O(d)` | `O(E)` |
| **Iterate neighbors of `u`** | `O(V)` | `O(d)` | `O(E)` |
| **Add edge** | `O(1)` | `O(1)` (append) | `O(1)` (append) |
| **Remove edge** | `O(1)` | `O(d)` | `O(E)` |
| **Add vertex** | `O(V²)` (resize grid) | `O(1)` | `O(1)` |
| **Iterate all edges** | `O(V²)` | `O(V + E)` | `O(E)` |

Takeaways:

- The **matrix** wins for single-edge questions and dense graphs; it loses badly on memory for sparse graphs.
- The **list** wins for neighbor iteration and sparse graphs — the common case.
- The **edge list** wins when an algorithm only ever sweeps all edges (Kruskal, Bellman-Ford) and never asks about a single vertex.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Adjacency matrix | A full mileage chart printed in an old road atlas: every city listed across the top *and* down the side, with the distance in each cell. Instant lookup of any city pair, but the chart is huge even though most city pairs are not directly connected by a single road. |
| Adjacency list | The contacts app on your phone: for each person, a short list of *their* friends. To find one person's friends is instant; to ask "are Alice and Bob friends?" you flip to Alice's page and scan her (short) list. |
| Edge list | A spreadsheet of flights where every row is one flight: `from, to, price`. Perfect for "sort all flights by price" or "process every flight once", useless for "show me everything leaving JFK" without scanning the whole sheet. |
| Directed vs undirected | A one-way street (directed) versus a two-way street (undirected). On a one-way street you record traffic in a single direction only. |
| Dense vs sparse | A dense graph is a small dinner party where everyone knows everyone; a sparse graph is a city where each person knows only a few hundred of millions of residents. |

Where the analogies break: in a phone's contacts, a friendship that should be mutual can be one-sided if you only add it to one person's list — exactly the undirected-edge bug. The data structure does not enforce symmetry; you do.

---

## Pros & Cons

### Adjacency Matrix

| Pros | Cons |
|------|------|
| `O(1)` edge existence and weight lookup. | `O(V²)` memory regardless of edge count. |
| Trivial to add/remove a single edge. | Wastes space on sparse graphs (almost all real graphs). |
| Simple, index-only code — no pointers or nested containers. | Iterating one vertex's neighbors costs `O(V)`. |
| Natural for matrix algorithms (transitive closure, Floyd-Warshall). | Adding a vertex means resizing the whole grid. |

### Adjacency List

| Pros | Cons |
|------|------|
| `O(V+E)` memory — optimal for sparse graphs. | Edge lookup is `O(degree)`, not `O(1)`. |
| Iterating neighbors is `O(degree)`, nothing wasted. | Slightly more complex code (list of lists). |
| Cheap to add vertices and edges. | Removing a specific edge requires scanning a list. |
| The default for BFS, DFS, Dijkstra, topological sort. | Pointer chasing can be cache-unfriendly (CSR fixes this). |

### Edge List

| Pros | Cons |
|------|------|
| Smallest, simplest structure: one flat array. | No fast neighbor or edge queries — `O(E)` to find anything. |
| Ideal for Kruskal (sort edges) and Bellman-Ford (relax all edges). | Must convert to a list/matrix for traversal algorithms. |
| Trivial to read from a file (one edge per line). | Awkward for "neighbors of `u`" without preprocessing. |

**When to use what:** adjacency list by default; adjacency matrix for dense graphs or when you constantly test single edges; edge list when the algorithm only ever scans all edges.

---

## Step-by-Step Walkthrough

Let us build the directed graph with edges `0→1, 0→2, 1→2, 2→0, 2→3, 3→3` (note the self-loop on `3`) all three ways.

**As an adjacency matrix** (`4×4`, directed so *not* symmetric):

```
start with all zeros:
     0 1 2 3
  0 [0 0 0 0]
  1 [0 0 0 0]
  2 [0 0 0 0]
  3 [0 0 0 0]

add 0->1 : M[0][1]=1
add 0->2 : M[0][2]=1
add 1->2 : M[1][2]=1
add 2->0 : M[2][0]=1
add 2->3 : M[2][3]=1
add 3->3 : M[3][3]=1     # self-loop sits on the diagonal

result:
     0 1 2 3
  0 [0 1 1 0]
  1 [0 0 1 0]
  2 [1 0 0 1]
  3 [0 0 0 1]
```

**As an adjacency list** (directed, so append only to the source):

```
0 -> []          0 -> [1]        0 -> [1, 2]
1 -> []    ==>    ... (after all six edges) ==>
2 -> []          0 -> [1, 2]
3 -> []          1 -> [2]
                 2 -> [0, 3]
                 3 -> [3]        # self-loop
```

**As an edge list** (just append each directed edge):

```
[ (0,1), (0,2), (1,2), (2,0), (2,3), (3,3) ]
```

Now answer "is there an edge `2→3`?" in each:

- Matrix: read `M[2][3]` → `1`. **One step.**
- List: scan `adj[2] = [0, 3]`, find `3`. **Two comparisons** (= `degree(2)`).
- Edge list: scan all six edges until `(2,3)` is found. **Five comparisons.**

And "list the neighbors of `2`":

- Matrix: scan row `2 = [1,0,0,1]`, emit columns `0` and `3`. **Four cells read** (= `V`).
- List: return `adj[2] = [0, 3]`. **Two reads** (= `degree(2)`).
- Edge list: scan all six edges, keep those with source `2`. **Six reads** (= `E`).

This is the trade-off made concrete.

---

## Code Examples

### Example: A Graph type supporting both matrix and list

Below, the **matrix** version and the **list** version are each complete: build, add edge, has-edge, neighbors. We use integer vertices `0..V-1` and an undirected graph; flip the commented lines to make it directed.

#### Go

```go
package main

import "fmt"

// ---------- Adjacency Matrix ----------

type MatrixGraph struct {
	n   int
	adj [][]int // adj[u][v] == 1 if edge u-v exists
}

func NewMatrixGraph(n int) *MatrixGraph {
	m := make([][]int, n)
	for i := range m {
		m[i] = make([]int, n)
	}
	return &MatrixGraph{n: n, adj: m}
}

func (g *MatrixGraph) AddEdge(u, v int) {
	g.adj[u][v] = 1
	g.adj[v][u] = 1 // omit this line for a directed graph
}

func (g *MatrixGraph) HasEdge(u, v int) bool { return g.adj[u][v] == 1 }

func (g *MatrixGraph) Neighbors(u int) []int {
	out := []int{}
	for v := 0; v < g.n; v++ {
		if g.adj[u][v] == 1 {
			out = append(out, v)
		}
	}
	return out
}

// ---------- Adjacency List ----------

type ListGraph struct {
	n   int
	adj [][]int // adj[u] = slice of neighbors
}

func NewListGraph(n int) *ListGraph {
	return &ListGraph{n: n, adj: make([][]int, n)}
}

func (g *ListGraph) AddEdge(u, v int) {
	g.adj[u] = append(g.adj[u], v)
	g.adj[v] = append(g.adj[v], u) // omit for directed
}

func (g *ListGraph) HasEdge(u, v int) bool {
	for _, w := range g.adj[u] {
		if w == v {
			return true
		}
	}
	return false
}

func (g *ListGraph) Neighbors(u int) []int { return g.adj[u] }

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 2}, {2, 3}}

	mg := NewMatrixGraph(4)
	lg := NewListGraph(4)
	for _, e := range edges {
		mg.AddEdge(e[0], e[1])
		lg.AddEdge(e[0], e[1])
	}

	fmt.Println(mg.HasEdge(2, 3), lg.HasEdge(2, 3)) // true true
	fmt.Println(mg.Neighbors(2), lg.Neighbors(2))   // [0 1 3] [0 1 3]
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class Graphs {

    // ---------- Adjacency Matrix ----------
    static class MatrixGraph {
        final int n;
        final int[][] adj;

        MatrixGraph(int n) {
            this.n = n;
            this.adj = new int[n][n];
        }

        void addEdge(int u, int v) {
            adj[u][v] = 1;
            adj[v][u] = 1; // omit for directed
        }

        boolean hasEdge(int u, int v) { return adj[u][v] == 1; }

        List<Integer> neighbors(int u) {
            List<Integer> out = new ArrayList<>();
            for (int v = 0; v < n; v++) {
                if (adj[u][v] == 1) out.add(v);
            }
            return out;
        }
    }

    // ---------- Adjacency List ----------
    static class ListGraph {
        final int n;
        final List<List<Integer>> adj;

        ListGraph(int n) {
            this.n = n;
            this.adj = new ArrayList<>();
            for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        }

        void addEdge(int u, int v) {
            adj.get(u).add(v);
            adj.get(v).add(u); // omit for directed
        }

        boolean hasEdge(int u, int v) { return adj.get(u).contains(v); }

        List<Integer> neighbors(int u) { return adj.get(u); }
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {0, 2}, {1, 2}, {2, 3}};

        MatrixGraph mg = new MatrixGraph(4);
        ListGraph lg = new ListGraph(4);
        for (int[] e : edges) {
            mg.addEdge(e[0], e[1]);
            lg.addEdge(e[0], e[1]);
        }

        System.out.println(mg.hasEdge(2, 3) + " " + lg.hasEdge(2, 3)); // true true
        System.out.println(mg.neighbors(2) + " " + lg.neighbors(2));   // [0, 1, 3] [0, 1, 3]
    }
}
```

#### Python

```python
class MatrixGraph:
    def __init__(self, n):
        self.n = n
        self.adj = [[0] * n for _ in range(n)]

    def add_edge(self, u, v):
        self.adj[u][v] = 1
        self.adj[v][u] = 1  # omit for directed

    def has_edge(self, u, v):
        return self.adj[u][v] == 1

    def neighbors(self, u):
        return [v for v in range(self.n) if self.adj[u][v] == 1]


class ListGraph:
    def __init__(self, n):
        self.n = n
        self.adj = [[] for _ in range(n)]

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)  # omit for directed

    def has_edge(self, u, v):
        return v in self.adj[u]

    def neighbors(self, u):
        return self.adj[u]


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 2), (2, 3)]
    mg, lg = MatrixGraph(4), ListGraph(4)
    for u, v in edges:
        mg.add_edge(u, v)
        lg.add_edge(u, v)

    print(mg.has_edge(2, 3), lg.has_edge(2, 3))  # True True
    print(mg.neighbors(2), lg.neighbors(2))      # [0, 1, 3] [0, 1, 3]
```

**What it does:** builds the same 4-vertex graph as a matrix and as a list, then answers the same two queries against each.
**Run:** `go run main.go` | `javac Graphs.java && java Graphs` | `python graphs.py`

---

## Coding Patterns

### Pattern 1: Build an adjacency list from an edge list

The single most common preprocessing step. You are given edges and must turn them into something you can traverse.

```python
def build_adj(n, edges, directed=False):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        if not directed:
            adj[v].append(u)
    return adj
```

The same three lines appear in nearly every BFS/DFS solution. Memorize them.

### Pattern 2: Weighted adjacency list

Store `(neighbor, weight)` pairs so Dijkstra and Prim can read the cost directly.

```python
def build_weighted_adj(n, edges, directed=False):
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
        if not directed:
            adj[v].append((u, w))
    return adj
```

### Pattern 3: Implicit graph on a grid (no explicit storage)

For grid problems you do **not** build a graph at all — the grid *is* the graph, and neighbors are computed on the fly.

```python
def grid_neighbors(r, c, rows, cols):
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols:
            yield nr, nc
```

This costs `O(1)` extra memory beyond the grid itself — a huge win for maze and flood-fill problems.

```mermaid
graph TD
    A[Input: list of edges] --> B[build adjacency list]
    A --> C[keep as edge list for Kruskal/Bellman-Ford]
    A --> D[fill adjacency matrix if dense]
    B --> E[BFS / DFS / Dijkstra]
    C --> F[sort edges / relax all edges]
    D --> G[Floyd-Warshall / O(1) edge tests]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| `IndexOutOfBounds` on `adj[u]` | Vertex id `>= V` or negative. | Validate `0 <= u < V` before indexing; size containers to `V`. |
| Edge appears one-way in an "undirected" graph | Forgot the second insertion `adj[v].append(u)`. | Always add both directions for undirected graphs, or wrap it in one `add_edge` method. |
| "No edge" confused with "zero-weight edge" | Used `0` as both the sentinel and a valid weight in a matrix. | Use a dedicated sentinel like `-1` or `+∞`, never a value a real weight could take. |
| `MemoryError` / OOM building a matrix | Allocated `V²` cells for a large sparse graph. | Switch to an adjacency list; the matrix is only viable for small or dense `V`. |
| Wrong neighbor count with parallel edges | Multigraph stored in a `set` deduped the parallel edge. | Use a list (not a set) when parallel edges are meaningful. |
| Self-loop double-counted in degree | Undirected self-loop added to `adj[v]` twice. | Decide a convention (a self-loop adds 2 to undirected degree) and document it. |

---

## Performance Tips

- **Default to the adjacency list.** Unless the graph is dense or you need `O(1)` single-edge tests, the list is smaller and faster for traversal.
- **Pre-size your containers** to `V` up front (`make([][]int, n)`, `new int[n][n]`, `[[] for _ in range(n)]`) so you avoid repeated reallocation.
- **Avoid `contains`/`in` on a list for hot edge tests.** If you need many `has_edge` queries on an adjacency list, keep a parallel `set` of `(u, v)` pairs or switch to a matrix.
- **Use CSR for read-only, performance-critical graphs.** Packing the adjacency list into two flat arrays (covered in `middle.md`) removes pointer chasing and is far more cache-friendly.
- **For grids, never materialize the graph.** Compute neighbors with offset deltas; it saves `O(rows·cols)` memory.

---

## Best Practices

- Wrap edge insertion in a single `add_edge` method so the undirected "add both directions" rule lives in exactly one place.
- Decide and document up front: directed or undirected, weighted or not, are self-loops and parallel edges allowed.
- Number vertices `0..V-1` internally; if the input uses string labels, keep one hash map `label → id` at the boundary and work with integers inside.
- Choose the representation from the *operation mix*, not habit: count how often you iterate neighbors versus test single edges versus scan all edges.
- Write a tiny brute-force checker (e.g. an `O(V²)` reachability) to validate your representation on small inputs before trusting it at scale.

---

## Edge Cases & Pitfalls

- **Empty graph** (`V > 0`, `E = 0`) — every neighbor list is empty; the matrix is all zeros. Code must not assume any edges exist.
- **Single vertex, no edges** — `Neighbors(0)` returns `[]`; make sure loops handle a length-0 list.
- **Self-loops** — `(v, v)`. In the matrix this lands on the diagonal `M[v][v]`. Decide whether your traversal should follow them.
- **Parallel edges** — two edges `(u, v)`. A matrix of `0/1` cannot represent them (it collapses to one); use a count, a list, or a multigraph structure.
- **Disconnected graph** — not all vertices are reachable from one another. A single BFS/DFS won't visit everything; loop over all start vertices.
- **Isolated vertex** — a vertex with degree 0. It still occupies a row/list slot and must be allocated.
- **Negative or zero weights** — fine for storage, but pick a "no edge" sentinel that no real weight can equal.

---

## Common Mistakes

1. **Building a matrix for a large sparse graph** — `V = 10⁶` needs `10¹²` cells. Always estimate `V²` before allocating.
2. **Forgetting the reverse edge** in an undirected graph — silently produces a directed graph and breaks traversals.
3. **Using `0` as "no edge" when `0` is a valid weight** — leads to phantom or missing edges.
4. **Mixing 0-indexed and 1-indexed vertices** — input is often 1-indexed; convert once at read time, not sprinkled through the code.
5. **Calling `has_edge` repeatedly on an adjacency list in a hot loop** — that is `O(degree)` each time; switch representation or add a `set`.
6. **Deduplicating a multigraph by accident** — storing neighbors in a `set` quietly drops parallel edges.
7. **Resizing a matrix to add one vertex** — `O(V²)` each time; if vertices are added dynamically, prefer a list.

---

## Cheat Sheet

| Question | Best representation |
|----------|---------------------|
| Graph is dense (`E ≈ V²`) | Adjacency matrix |
| Graph is sparse (`E ≈ V`) | Adjacency list |
| Need `O(1)` "is there an edge `u→v`?" | Adjacency matrix |
| Need fast iteration over a vertex's neighbors | Adjacency list |
| Algorithm sweeps all edges (Kruskal, Bellman-Ford) | Edge list |
| Floyd-Warshall / transitive closure | Adjacency matrix |
| BFS / DFS / Dijkstra / topological sort | Adjacency list |
| Grid / maze problem | Implicit graph (compute neighbors) |
| Read-only, performance-critical, huge | CSR (compressed adjacency list) |

Space and key operations:

```
Matrix : space O(V^2),   has-edge O(1),  neighbors O(V),  add O(1), remove O(1)
List   : space O(V+E),   has-edge O(d),  neighbors O(d),  add O(1), remove O(d)
Edge   : space O(E),     has-edge O(E),  neighbors O(E),  add O(1), remove O(E)
```

Build an adjacency list from edges (the line you will write most):

```
adj = [[] for _ in range(V)]
for u, v in edges:
    adj[u].append(v)
    adj[v].append(u)   # undirected only
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual of the three graph representations.
>
> The animation lets you:
> - Add and remove edges on a small graph and watch all three views update together.
> - Toggle between **matrix view**, **adjacency-list view**, and **edge-list view**.
> - Query a single edge and watch each representation highlight where it looks.
> - Switch between directed and undirected to see how storage changes.

---

## Summary

A graph `G = (V, E)` is the universal structure for relationships, and your first decision is always *how to store it*. The adjacency matrix gives `O(1)` edge lookup at the cost of `O(V²)` memory — great for dense graphs and matrix algorithms, terrible for sparse ones. The adjacency list costs only `O(V+E)` and iterates neighbors optimally — the default for almost every traversal algorithm. The edge list is the leanest of all and shines when an algorithm just sweeps every edge. Learn to read the operation mix (neighbor iteration vs single-edge tests vs full-edge scans) and the density of the graph, and the right representation becomes obvious.

---

## Further Reading

- *Introduction to Algorithms* (CLRS), Chapter 22 — "Elementary Graph Algorithms" — the canonical treatment of matrix vs list.
- *Algorithms* (Sedgewick & Wayne), Chapter 4 — graph representations and the `Graph` / `Digraph` APIs.
- *Competitive Programmer's Handbook* (Laaksonen), Chapter 11 — graph basics and representation choice.
- cp-algorithms.com — "Graph representation" and "Breadth-first search".
- visualgo.net — "Graph Data Structures" — interactive matrix/list visualisation.
