# Minimum Spanning Tree — Middle Level

> **One-line summary:** Beyond "sort edges or grow a tree," the MST sits on two structural theorems — the **cut property** and the **cycle property** — that explain *why* every greedy MST algorithm is correct. This level covers those proofs informally, compares Kruskal / Prim / Borůvka head-to-head, and explores the family of related problems: spanning forests, second-best MST, uniqueness, maximum spanning tree, bottleneck trees, and applications in clustering and TSP approximation.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph and Tree Applications](#graph-and-tree-applications)
6. [Algorithmic Integration](#algorithmic-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At the junior level the MST is "the cheapest way to connect everything." At the middle level the interesting question is *why the greedy strategy is guaranteed optimal*, and *how the same core idea spawns a whole family of problems*: spanning forests on disconnected graphs, the second-best MST, bottleneck spanning trees, maximum spanning trees, and clustering by cutting the most expensive MST edges.

Everything rests on two theorems. The **cut property** tells you which edges are *safe to add*; the **cycle property** tells you which edges are *safe to discard*. Kruskal, Prim, and Borůvka are simply three different schedules for applying these two rules. Once you internalize them, you can invent your own MST algorithm and prove it correct, and you can answer "what happens if I change this constraint?" questions on the spot.

---

## Deeper Concepts

### The Generic Greedy MST and the Cut Property

All three classic algorithms are instances of one **generic greedy MST**:

```
A = {}                         # a growing set of MST edges (a forest)
while A is not a spanning tree:
    find a "safe" edge e
    A = A ∪ {e}
```

An edge is **safe** if adding it keeps `A` a subset of *some* MST. The cut property tells us how to find safe edges:

> **Cut property.** Let `A` be a subset of some MST. Take any cut `(S, V∖S)` that **no edge of `A` crosses**. Then the *minimum-weight* edge crossing that cut is safe.

**Why (exchange argument).** Let `T` be an MST containing `A`. Let `e = (u, v)` be the lightest edge crossing the cut. If `e ∈ T`, done. Otherwise, adding `e` to `T` creates exactly one cycle; that cycle must cross the cut a second time on some edge `e'` (it leaves `S` and must come back). Since `e` is the lightest crossing edge, `w(e) ≤ w(e')`. Swap: `T' = T − e' + e` is still a spanning tree, still contains `A`, and `w(T') ≤ w(T)`. So `T'` is also an MST and it contains `A ∪ {e}`. Hence `e` is safe. ∎

- **Prim** keeps `A` as one tree containing the start vertex; the cut is (tree, rest); the lightest crossing edge is exactly what the priority queue hands you.
- **Kruskal** keeps `A` as a forest; for the next-cheapest edge `e=(u,v)` with `u,v` in different trees, take the cut separating `u`'s tree from everything else — `e` is the lightest crossing edge among those not yet considered, so it is safe.
- **Borůvka** applies the cut property to *every* component simultaneously.

### The Cycle Property

> **Cycle property.** For any cycle `C` in the graph, if one edge `e` of `C` has *strictly greater* weight than every other edge of `C`, then `e` is in **no** MST.

**Why.** Suppose an MST `T` contained that heaviest edge `e`. Removing `e` splits `T` into two parts; the rest of cycle `C` connects those two parts via some other edge `e'` with `w(e') < w(e)`. Then `T − e + e'` is a cheaper spanning tree — contradiction. ∎

Kruskal uses this implicitly: when it skips an edge because it would close a cycle, that edge is (by ascending processing order) the heaviest on the cycle it would form, so discarding it is justified.

### Uniqueness

- If **all edge weights are distinct**, the MST is **unique**. (Every cut has a single lightest crossing edge; every cycle has a single heaviest edge; the greedy choices are forced.)
- With **ties**, multiple MSTs may exist, all with the same total weight.
- Practical test for uniqueness: compute an MST; for each non-tree edge `e=(u,v)`, find the max-weight edge on the tree path `u→v`. The MST is **unique** iff every such non-tree edge is *strictly heavier* than that max path edge. If some non-tree edge equals it, an alternative MST exists.

### Why Greedy Beats Brute Force

A graph can have exponentially many spanning trees (Cayley's formula: a complete graph on `n` vertices has `n^(n−2)` of them). Greedy never enumerates them; the cut/cycle properties prune the search to a single deterministic walk, giving near-linear time instead of exponential.

---

## Comparison with Alternatives

| Algorithm | Time | Space | Data structures | Best for | Notes |
|-----------|------|-------|-----------------|----------|-------|
| **Kruskal** | O(E log E) | O(V+E) | sort + Union-Find | sparse graphs, edge lists | Stop after V−1 edges; works on forests naturally. |
| **Prim (binary heap)** | O(E log V) | O(V+E) | adjacency list + heap | general sparse/medium | Lazy variant is simplest. |
| **Prim (array)** | O(V²) | O(V) | adjacency matrix | **dense** graphs (E≈V²) | No log factor; cache-friendly; great for complete graphs. |
| **Prim (Fibonacci heap)** | O(E + V log V) | O(V+E) | Fibonacci heap | dense, theoretical | Big constants; rarely faster in practice. |
| **Borůvka** | O(E log V) | O(V+E) | component labels | **parallel/distributed** | Each round halves components; embarrassingly parallel. |

### Dense vs Sparse — the Practical Rule

- **Sparse** (`E = O(V)`): Kruskal and heap-Prim are both `O(V log V)`. Kruskal wins if edges are pre-sorted or sortable by counting sort.
- **Dense** (`E = Θ(V²)`): heap-Prim degrades to `O(V² log V)`; **array-Prim's `O(V²)`** beats it. Kruskal must sort `Θ(V²)` edges = `O(V² log V)`. → **array-Prim is the clear winner on dense graphs.**

### MST vs Shortest-Path Tree

A common confusion: the MST is **not** the same as a shortest-path tree from a source. The MST minimizes *total edge weight of the tree*; Dijkstra's tree minimizes *distance from the root to each vertex*. They can differ dramatically. MST has no notion of a root or of path length.

---

## Advanced Patterns

### Minimum Spanning Forest (disconnected graphs)

Both Kruskal and Prim extend cleanly:

- **Kruskal** already produces a forest — it just stops accepting when no more legal edges remain; you end up with `#components` trees and `V − #components` edges.
- **Prim** finds one tree per connected component: after one run, restart from any unvisited vertex.

### Second-Best MST

The **second-best MST** is the cheapest spanning tree that differs from the MST in at least one edge. Standard approach:

1. Build the MST `T`.
2. For each **non-tree** edge `e=(u,v)` with weight `w`, find the **maximum-weight edge** `f` on the unique tree path from `u` to `v`.
3. Swapping `f` for `e` yields a spanning tree of weight `w(T) − w(f) + w(e)`. The best such swap over all non-tree edges gives the second-best MST.

Finding the max edge on every tree path efficiently uses LCA + binary lifting or heavy-light decomposition (see sibling sections *13-lca*, *14-heavy-light-decomposition*). The dedicated treatment is sibling section *31-second-best-mst*.

### MST Uniqueness Check

As above: an MST is unique iff for every non-tree edge `(u,v,w)`, `w` is strictly greater than the maximum edge weight on the tree path `u→v`. Equality means a tie that could be swapped, so an alternative MST exists.

### Maximum Spanning Tree

The spanning tree of **maximum** total weight. Just **negate the comparison** (sort descending in Kruskal, use a max-heap in Prim) — the cut/cycle properties flip symmetrically (heaviest crossing edge is safe, lightest cycle edge is useless). Used in maximum-bandwidth network design and certain clustering schemes.

### Bottleneck Spanning Tree

A **minimum bottleneck spanning tree (MBST)** minimizes the *maximum* edge weight in the tree (the "worst link"), not the sum.

> **Key fact: every MST is also a minimum bottleneck spanning tree.** (The converse is not true — an MBST need not minimize the total.)

So you can get an MBST for free from any MST algorithm. If you only need the *bottleneck value*, you can also binary-search on the edge weight threshold + connectivity check, in `O(E log E)` or even `O(E)` with Camerini's algorithm.

### Minimum Spanning Tree with a Fixed/Forbidden Edge

- **Force an edge into the MST:** add it first (union its endpoints), then run Kruskal on the rest.
- **Forbid an edge:** simply skip it in the edge list.
- These two operations are the building blocks of *critical* and *pseudo-critical* edge problems (an edge is **critical** if removing it increases the MST weight or disconnects the graph; **pseudo-critical** if it appears in *some* MST but not all).

---

## Graph and Tree Applications

### Single-Linkage Clustering

To split `n` points into `k` clusters by single-linkage:

1. Build the MST of the points (edge weight = distance).
2. **Remove the `k − 1` heaviest MST edges.**
3. The `k` resulting connected components are your clusters.

This is exactly single-linkage agglomerative clustering, and it runs in `O(E log E)`. Removing heavy edges first maximizes the minimum inter-cluster gap.

### Image Segmentation

Felzenszwalb–Huttenlocher segmentation treats pixels as graph vertices, intensity differences as edge weights, and merges regions in MST-like fashion (a Kruskal-style pass with an adaptive merge predicate). Produces fast, perceptually reasonable segments.

### Metric TSP 2-Approximation

For the metric Traveling Salesman Problem (triangle inequality holds):

1. Build the MST `T`.
2. Do a preorder DFS walk of `T`, listing vertices in first-visit order.
3. That order is a tour of cost ≤ `2 · w(T) ≤ 2 · OPT`.

Because `w(MST) ≤ w(optimal tour)` (deleting one edge of the optimal tour leaves a spanning tree), this gives a **2-approximation**; Christofides improves it to 1.5 using a matching on odd-degree vertices. See sibling section *28-np-hard-tsp-hamiltonian*.

### Network / Circuit Design

Telephone backbones, electrical grids, and VLSI routing all use MST (or Steiner-tree refinements) to minimize wiring cost while guaranteeing connectivity. Borůvka invented his algorithm in 1926 precisely for laying out an electrical network in Moravia.

---

## Algorithmic Integration

- **Union-Find** powers Kruskal and the union step of Borůvka (sibling *12-disjoint-set*).
- **Binary heap / priority queue** powers Prim (sibling *10-heaps*).
- **LCA / heavy-light decomposition** power second-best-MST and uniqueness queries (siblings *13-lca*, *14-heavy-light-decomposition*).
- **DFS** powers the MST→tour walk for TSP approximation (sibling *03-dfs*).
- **Sorting** (comparison or radix) is Kruskal's first phase (sibling sorting topics).

---

## Code Examples

### Example 1: Prim with a Dense Adjacency Matrix — O(V²)

The go-to for dense / complete graphs (e.g., "connect all points"). No heap, no log factor.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

// Prim on a dense graph given as an adjacency matrix.
// w[i][j] = weight, or math.MaxInt32 if no edge. Returns total MST weight.
func PrimDense(w [][]int) int {
	n := len(w)
	const INF = math.MaxInt32
	inTree := make([]bool, n)
	minEdge := make([]int, n)
	for i := range minEdge {
		minEdge[i] = INF
	}
	minEdge[0] = 0
	total := 0
	for iter := 0; iter < n; iter++ {
		u := -1
		for v := 0; v < n; v++ { // pick the closest non-tree vertex
			if !inTree[v] && (u == -1 || minEdge[v] < minEdge[u]) {
				u = v
			}
		}
		if minEdge[u] == INF {
			return -1 // disconnected
		}
		inTree[u] = true
		total += minEdge[u]
		for v := 0; v < n; v++ { // relax distances to the tree
			if !inTree[v] && w[u][v] < minEdge[v] {
				minEdge[v] = w[u][v]
			}
		}
	}
	return total
}

func main() {
	INF := math.MaxInt32
	w := [][]int{
		{0, 6, 3, INF, INF},
		{6, 0, 5, 8, 1},
		{3, 5, 0, INF, 7},
		{INF, 8, INF, 0, 4},
		{INF, 1, 7, 4, 0},
	}
	fmt.Println("MST weight:", PrimDense(w)) // 13
}
```

#### Java

```java
public class PrimDense {
    static final int INF = Integer.MAX_VALUE;

    static int primDense(int[][] w) {
        int n = w.length;
        boolean[] inTree = new boolean[n];
        int[] minEdge = new int[n];
        java.util.Arrays.fill(minEdge, INF);
        minEdge[0] = 0;
        int total = 0;
        for (int iter = 0; iter < n; iter++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inTree[v] && (u == -1 || minEdge[v] < minEdge[u])) u = v;
            if (minEdge[u] == INF) return -1;   // disconnected
            inTree[u] = true;
            total += minEdge[u];
            for (int v = 0; v < n; v++)
                if (!inTree[v] && w[u][v] < minEdge[v]) minEdge[v] = w[u][v];
        }
        return total;
    }

    public static void main(String[] args) {
        int[][] w = {
            {0, 6, 3, INF, INF},
            {6, 0, 5, 8, 1},
            {3, 5, 0, INF, 7},
            {INF, 8, INF, 0, 4},
            {INF, 1, 7, 4, 0}
        };
        System.out.println("MST weight: " + primDense(w)); // 13
    }
}
```

#### Python

```python
import math


def prim_dense(w):
    """w: V×V matrix, w[i][j] = weight or math.inf if no edge. Returns MST weight."""
    n = len(w)
    in_tree = [False] * n
    min_edge = [math.inf] * n
    min_edge[0] = 0
    total = 0
    for _ in range(n):
        u = -1
        for v in range(n):                       # pick closest non-tree vertex
            if not in_tree[v] and (u == -1 or min_edge[v] < min_edge[u]):
                u = v
        if min_edge[u] == math.inf:
            return -1                            # disconnected
        in_tree[u] = True
        total += min_edge[u]
        for v in range(n):                       # relax
            if not in_tree[v] and w[u][v] < min_edge[v]:
                min_edge[v] = w[u][v]
    return total


if __name__ == "__main__":
    I = math.inf
    w = [
        [0, 6, 3, I, I],
        [6, 0, 5, 8, 1],
        [3, 5, 0, I, 7],
        [I, 8, I, 0, 4],
        [I, 1, 7, 4, 0],
    ]
    print("MST weight:", prim_dense(w))           # 13
```

### Example 2: Borůvka's Algorithm

Each round, every component finds its cheapest outgoing edge; all are merged. `O(log V)` rounds, each `O(E)`.

#### Go

```go
package main

import "fmt"

type Edge struct{ u, v, w int }

func find(p []int, x int) int {
	for p[x] != x {
		p[x] = p[p[x]]
		x = p[x]
	}
	return x
}

func Boruvka(n int, edges []Edge) int {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	total, numComp := 0, n
	for numComp > 1 {
		cheapest := make([]int, n) // cheapest edge index per component
		for i := range cheapest {
			cheapest[i] = -1
		}
		for i, e := range edges {
			ru, rv := find(parent, e.u), find(parent, e.v)
			if ru == rv {
				continue
			}
			if cheapest[ru] == -1 || e.w < edges[cheapest[ru]].w {
				cheapest[ru] = i
			}
			if cheapest[rv] == -1 || e.w < edges[cheapest[rv]].w {
				cheapest[rv] = i
			}
		}
		for _, idx := range cheapest {
			if idx == -1 {
				continue
			}
			e := edges[idx]
			ru, rv := find(parent, e.u), find(parent, e.v)
			if ru != rv {
				parent[ru] = rv
				total += e.w
				numComp--
			}
		}
	}
	return total
}

func main() {
	edges := []Edge{{0, 2, 3}, {0, 1, 6}, {1, 2, 5}, {1, 4, 1}, {1, 3, 8}, {3, 4, 4}, {2, 4, 7}}
	fmt.Println("MST weight:", Boruvka(5, edges)) // 13
}
```

#### Java

```java
import java.util.*;

public class Boruvka {
    static int[] parent;
    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static int boruvka(int n, int[][] edges) { // edges[i] = {u, v, w}
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int total = 0, comp = n;
        while (comp > 1) {
            int[] cheapest = new int[n];
            Arrays.fill(cheapest, -1);
            for (int i = 0; i < edges.length; i++) {
                int ru = find(edges[i][0]), rv = find(edges[i][1]);
                if (ru == rv) continue;
                if (cheapest[ru] == -1 || edges[i][2] < edges[cheapest[ru]][2]) cheapest[ru] = i;
                if (cheapest[rv] == -1 || edges[i][2] < edges[cheapest[rv]][2]) cheapest[rv] = i;
            }
            for (int idx : cheapest) {
                if (idx == -1) continue;
                int ru = find(edges[idx][0]), rv = find(edges[idx][1]);
                if (ru != rv) { parent[ru] = rv; total += edges[idx][2]; comp--; }
            }
        }
        return total;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,2,3},{0,1,6},{1,2,5},{1,4,1},{1,3,8},{3,4,4},{2,4,7}};
        System.out.println("MST weight: " + boruvka(5, edges)); // 13
    }
}
```

#### Python

```python
def boruvka(n, edges):
    """edges: list of (u, v, w). Returns MST total weight."""
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, comp = 0, n
    while comp > 1:
        cheapest = [-1] * n                       # cheapest edge index per component
        for i, (u, v, w) in enumerate(edges):
            ru, rv = find(u), find(v)
            if ru == rv:
                continue
            if cheapest[ru] == -1 or w < edges[cheapest[ru]][2]:
                cheapest[ru] = i
            if cheapest[rv] == -1 or w < edges[cheapest[rv]][2]:
                cheapest[rv] = i
        for idx in cheapest:
            if idx == -1:
                continue
            u, v, w = edges[idx]
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
                total += w
                comp -= 1
    return total


if __name__ == "__main__":
    edges = [(0, 2, 3), (0, 1, 6), (1, 2, 5), (1, 4, 1), (1, 3, 8), (3, 4, 4), (2, 4, 7)]
    print("MST weight:", boruvka(5, edges))        # 13
```

**What they do:** the dense-Prim picks the closest non-tree vertex each round (`O(V²)`); Borůvka merges every component's cheapest edge each round (`O(E log V)`).
**Run:** `go run main.go` | `javac PrimDense.java && java PrimDense` | `python prim_dense.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Borůvka infinite loop | Two components both pick the *same* edge but the merge order leaves `comp` unchanged. | Re-`find` before merging and only decrement `comp` on an actual union. |
| Tie-breaking inconsistency in Borůvka | Two edges of equal weight chosen from both ends can create a cycle in one round. | Break ties by a consistent total order (e.g., edge index) so each edge is chosen once. |
| Dense-Prim returns garbage on disconnected graph | A vertex never becomes reachable; `minEdge[u] == INF`. | Detect `INF` selection and return forest / error. |
| Second-best MST equals best MST | The graph's MST is not unique (a tie exists). | That is the correct answer — they share weight; report the alternative edge set. |
| Max spanning tree using min comparator | Forgot to flip the comparison. | Sort descending / use a max-heap. |

---

## Performance Analysis

- **Kruskal:** sorting dominates → `O(E log E)`; the Union-Find passes add only `O(E α(V))`, effectively linear. If weights are bounded integers, radix-sort the edges → `O(E α(V))` total.
- **Heap-Prim:** every edge can trigger a push → `O(E log V)`. Lazy variant has up to `E` heap entries; eager variant caps at `V` but needs `decreaseKey` + an index map.
- **Array-Prim:** `O(V²)` regardless of `E`. For dense graphs (`E ≈ V²`) this is *better* than heap-Prim's `O(V² log V)` and avoids heap/pointer overhead — excellent cache locality on the contiguous `minEdge` array.
- **Borůvka:** `O(log V)` rounds × `O(E)` per round = `O(E log V)`. Its real value is parallelism: each round's per-component minimum is an independent reduction.
- **Hybrid (Karger-Klein-Tarjan):** mixing Borůvka contraction with random sampling gives *expected linear* time — covered in `professional.md`.

---

## Best Practices

- Pick the algorithm by **density**: Kruskal for sparse/edge-list, array-Prim for dense, Borůvka for parallel.
- For "connect all points" with coordinates, recognize the **dense complete graph** and use array-Prim, not Kruskal over `V²` sorted edges.
- For clustering, build the MST once and cut the `k−1` heaviest edges — do not recluster from scratch.
- Reuse a battle-tested Union-Find; do not hand-roll cycle detection with DFS in Kruskal (slower and bug-prone).
- When asked for the *bottleneck* tree, remember any MST already is one.
- Accumulate totals in 64-bit integers.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation.
>
> The animation demonstrates:
> - Kruskal: sorted edges, component coloring via Union-Find, accept/reject decisions
> - Prim: the growing tree and the crossing-edge priority queue
> - The running MST total and the `V−1` stopping condition
> - A toggle to compare both algorithms on the same graph

---

## Summary

The MST's correctness comes entirely from two theorems: the **cut property** (the lightest edge crossing any cut where the current forest has no crossing edge is safe to add) and the **cycle property** (the strictly heaviest edge on any cycle is in no MST). Kruskal, Prim, and Borůvka are three scheduling strategies over these rules — choose by density (Kruskal sparse, array-Prim dense, Borůvka parallel). The same machinery generalizes to spanning **forests** on disconnected graphs, the **second-best MST** via tree-path max-edge swaps, **uniqueness** testing, **maximum** and **bottleneck** spanning trees (every MST is an MBST), and powers applications from **single-linkage clustering** (cut the heaviest MST edges) to the **metric-TSP 2-approximation** (DFS-walk the MST).
