# Lowest Common Ancestor (LCA) — Junior Level

> **One-line summary:** The Lowest Common Ancestor of two nodes `u` and `v` in a rooted tree is the deepest node that is an ancestor of both. The naive method climbs the tree in `O(N)` per query; **binary lifting** precomputes `2^k`-th ancestors so each query runs in `O(log N)` after an `O(N log N)` build.

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

Imagine a family tree, an organization chart, or a folder hierarchy. Two people (or two folders) sit somewhere in the structure, and you want the **closest shared parent** — the lowest point from which you can reach both by going *down*. That point is the **Lowest Common Ancestor (LCA)**.

Formally, given a tree rooted at some node `root`, the LCA of two nodes `u` and `v` is the **deepest** node `w` such that `w` is an ancestor of both `u` and `v`. ("Ancestor" includes the node itself: a node is its own ancestor.) Because a rooted tree has a unique path between any two nodes, and that path bends at exactly one node, the LCA is always unique and always exists (in the worst case it is the root).

The LCA is one of the most reused building blocks in tree algorithms:

- **Distance between two nodes:** `dist(u, v) = depth[u] + depth[v] − 2 · depth[lca(u, v)]`.
- **Path queries** (the maximum edge on the path, the sum of weights, etc.) when combined with **heavy-light decomposition** (a sibling topic).
- **k-th ancestor** of a node — "who is 5 levels above me?"
- **Auxiliary / virtual trees**, **dominator trees**, and many competitive-programming patterns.

This file teaches two **online** methods — methods that answer each query immediately, with no need to know all queries up front:

1. The **naive** equalize-then-climb method: simple, `O(N)` per query, great for understanding.
2. **Binary lifting**: the workhorse. After an `O(N log N)` preprocessing pass it answers each query in `O(log N)`.

There is also a classic **offline** method (Tarjan's, using a disjoint-set / union-find), which processes all queries together. That one has its own dedicated topic at **`12-disjoint-set / 04-offline-lca`** — we point to it and concentrate here on the online methods.

---

## Prerequisites

Before this file you should be comfortable with:

- **Rooted trees** — parent, child, root, leaf, ancestor, descendant.
- **Depth-First Search (DFS)** — we compute depths and parents with one DFS.
- **Arrays and 2-D arrays** — binary lifting stores a table `up[k][v]`.
- **Big-O notation** — `O(N)`, `O(log N)`, `O(N log N)`.
- **Bit operations** — `1 << k`, and reading the bits of a number (used to decompose a climb of length `d` into powers of two).
- **Recursion or an explicit stack** — for the preprocessing DFS.

Optional but helpful:

- Familiarity with the idea of a **sparse table** (precomputed `2^k`-jump tables) from range queries.
- Having seen **BFS** — you can compute depths with BFS instead of DFS.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Rooted tree** | A tree with one node designated the root; every other node has a unique parent. |
| **Ancestor** | `a` is an ancestor of `v` if `a` lies on the path from `v` up to the root (a node is its own ancestor). |
| **Descendant** | The inverse of ancestor. |
| **Depth / level** | Number of edges from the root to the node. The root has depth 0. |
| **LCA(u, v)** | The deepest node that is an ancestor of both `u` and `v`. |
| **k-th ancestor** | The node reached by going up `k` parent links from `v`. |
| **Binary lifting** | A technique storing `up[k][v]` = the `2^k`-th ancestor of `v`, enabling `O(log N)` jumps. |
| **Sparse table** | A precomputed table of `2^k`-sized aggregates; binary lifting is a sparse table over the parent function. |
| **Euler tour** | A DFS traversal that records nodes as it enters and leaves them, flattening the tree into an array. |
| **RMQ** | Range Minimum Query — find the minimum in a subarray; LCA reduces to this on the Euler tour. |
| **Online query** | A query answered immediately, without needing future queries. |
| **Offline query** | A query that may be reordered and answered in a batch (e.g., Tarjan's LCA). |
| **Sentinel** | A placeholder value (often `-1` or `0`) used for "the parent of the root," which does not exist. |

---

## Core Concepts

### 1. What "ancestor" and "depth" mean

Root the tree at node `0` (any node works). Run a DFS. For each node `v` record:

- `parent[v]` — the immediate parent (`parent[root] = -1`).
- `depth[v]` — the number of edges from the root.

```
            0          depth 0
          / | \
         1  2  3       depth 1
        /|     |
       4 5     6       depth 2
              /
             7         depth 3
```

`LCA(4, 5) = 1` (both hang under 1). `LCA(4, 7) = 0` (their paths only meet at the root). `LCA(7, 3) = 3` (3 is an ancestor of 7 — and an ancestor of itself).

### 2. The naive idea — equalize depth, then climb together

Two observations make the naive method work:

1. If `u` is deeper than `v`, bring `u` *up* to the same depth as `v` by following parent links. The LCA is unchanged because moving a node toward the root never skips past the LCA — as long as we do not go above it.
2. Once `u` and `v` are at the same depth, move **both** up one step at a time. The first time they land on the *same* node, that node is the LCA.

```
equalize:  while depth[u] > depth[v]: u = parent[u]
           while depth[v] > depth[u]: v = parent[v]
climb:     while u != v:
               u = parent[u]
               v = parent[v]
           return u
```

This is `O(N)` per query in the worst case (a long path tree). Correct and simple — but too slow when you have many queries.

### 3. Binary lifting — jump in powers of two

The naive climb takes single steps. Binary lifting lets you take **big jumps**. Precompute a table:

```
up[0][v] = parent[v]                    // 1 step up   = 2^0
up[k][v] = up[k-1][ up[k-1][v] ]        // 2^k steps   = two jumps of 2^(k-1)
```

`up[k][v]` is the `2^k`-th ancestor of `v`. With this table you can move any node up by any distance `d` in `O(log N)`: write `d` in binary and, for every set bit `k`, jump `2^k`.

```
kth_ancestor(v, d):
    for k in 0..LOG-1:
        if d has bit k set:
            v = up[k][v]
    return v
```

The LCA query then becomes:

1. **Lift the deeper node** up by `depth[u] − depth[v]` so both are at equal depth.
2. If they are now equal, that node is the LCA.
3. Otherwise, for `k` from high to low: if `up[k][u] != up[k][v]`, jump *both* up by `2^k`. After the loop, `u` and `v` sit exactly one step below the LCA, so the answer is `parent[u]` (= `up[0][u]`).

Building the table is `O(N log N)` time and space; each query is `O(log N)`.

### 4. Sizing the table — `LOG`

`LOG = ceil(log2(N))` (use `LOG = ceil(log2(N)) + 1` to be safe). For `N` up to `10^5`, `LOG = 17` is plenty (`2^17 = 131072`). The root's ancestors past the top must point to a **sentinel** (commonly `-1` or the root itself) so jumps that "overshoot" stop cleanly.

---

## Big-O Summary

| Method | Build time | Build space | Query time | Online? | Notes |
|--------|-----------|-------------|-----------|---------|-------|
| Naive (equalize + climb) | `O(N)` (one DFS for depth) | `O(N)` | `O(N)` worst | Yes | Simplest; fine for few queries. |
| **Binary lifting** | `O(N log N)` | `O(N log N)` | `O(log N)` | Yes | The standard online method. Also gives k-th ancestor. |
| Euler tour + sparse table RMQ | `O(N log N)` | `O(N log N)` | **`O(1)`** | Yes | Fastest queries; reduces LCA to RMQ. |
| Farach-Colton–Bender (±1 RMQ) | **`O(N)`** | `O(N)` | **`O(1)`** | Yes | Optimal asymptotics; more involved to implement. |
| Tarjan offline (union-find) | `O((N + Q) α(N))` | `O(N + Q)` | amortized near-`O(1)` | **No** | All queries known up front. See `12-disjoint-set / 04-offline-lca`. |

`N` = number of nodes, `Q` = number of queries, `α` = inverse Ackermann (effectively constant).

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| LCA in a family tree | Two cousins want to know their **most recent common ancestor** — the grandparent (or great-grandparent) from whom both descend. The "lowest" such ancestor is the closest one. |
| LCA in an org chart | Two employees in different teams ask: "who is the lowest-level manager that both of us report to?" That manager is the LCA. |
| Equalize-then-climb | Two people stand on different floors of a building's family staircase. First the one higher up walks down to the same floor; then both walk up together until they meet at a landing. |
| Binary lifting | Instead of climbing one stair at a time, you take an elevator that stops at floors `+1, +2, +4, +8, …` above you, so you reach floor `+13` in three hops (`8 + 4 + 1`). |
| Sentinel above the root | The CEO has no manager — asking "the CEO's manager" returns a "none" placeholder, not a crash. |

Where the analogy breaks: a real family tree can have two parents per person (a DAG), but LCA as defined here needs a **rooted tree** with a single parent per node. Multi-parent LCA is a harder, separate problem.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Binary lifting answers each query in `O(log N)` — fast enough for `10^5+` queries. | The table costs `O(N log N)` memory; large `N` can be heavy. |
| One preprocessing DFS gives depths, parents, and the table in one pass. | The preprocessing DFS can blow the recursion stack on deep/path-like trees. |
| Binary lifting also solves k-th ancestor and weighted path-aggregate queries for free. | Off-by-one bugs in `LOG` sizing, depth indexing, and the sentinel are common. |
| Online: handle queries as they arrive, interleaved with reads. | If you only need distances and can batch queries, Tarjan offline is simpler asymptotically. |
| Euler+RMQ gives `O(1)` queries — best when you have huge query volumes. | The tree must be **static**; updates (re-rooting, adding edges) invalidate the table. |

**When to use online LCA:** many `(u, v)` queries on a fixed rooted tree; you need distances, k-th ancestor, or path aggregates; queries arrive one at a time.

**When NOT to use it:** the tree changes between queries (use link-cut trees), or all queries are known up front and you only need plain LCA (Tarjan offline is leaner).

---

## Step-by-Step Walkthrough

Use this tree (rooted at `0`):

```
            0   depth 0
          /   \
         1     2    depth 1
        / \     \
       3   4     5  depth 2
          /
         6           depth 3
```

`parent = [-1, 0, 0, 1, 1, 2, 4]`, `depth = [0, 1, 1, 2, 2, 2, 3]`.

### Naive: `LCA(6, 3)`

```
depth[6] = 3, depth[3] = 2.   6 is deeper.
equalize: 6 -> parent[6] = 4   (now both at depth 2: u=4, v=3)
climb:    4 != 3 -> 4 -> parent=1, 3 -> parent=1   (u=1, v=1)
          1 == 1 -> stop.   LCA = 1
```

### Binary lifting: build the table (`LOG = 3`)

```
up[0] = parent              = [-1, 0, 0, 1, 1, 2, 4]
up[1][v] = up[0][up[0][v]]:
   up[1][6] = up[0][4] = 1
   up[1][3] = up[0][1] = 0
   up[1][4] = up[0][1] = 0
   ...  (overshoots become -1)
up[2][v] = up[1][up[1][v]]   (mostly -1 here — tree is shallow)
```

### Binary lifting: `LCA(6, 3)`

```
depth[6]=3, depth[3]=2.   Lift 6 up by 3-2 = 1 step:  6 -> up[0][6] = 4.
Now u=4, v=3, both depth 2, and 4 != 3.
For k = 2,1,0:
   k=1: up[1][4]=0, up[1][3]=0  -> equal, do NOT jump.
   k=0: up[0][4]=1, up[0][3]=1  -> equal, do NOT jump.
Loop ends. u=4 sits one step below the LCA -> answer = up[0][4] = 1.
LCA = 1.   (matches the naive result)
```

The rule "jump only when the ancestors differ" guarantees we stop *just below* the LCA — never overshooting past it.

---

## Code Examples

### Example A: Naive equalize-then-climb

#### Go

```go
package main

import "fmt"

type Tree struct {
	parent []int
	depth  []int
	adj    [][]int
}

func NewTree(n, root int, edges [][2]int) *Tree {
	t := &Tree{
		parent: make([]int, n),
		depth:  make([]int, n),
		adj:    make([][]int, n),
	}
	for _, e := range edges {
		t.adj[e[0]] = append(t.adj[e[0]], e[1])
		t.adj[e[1]] = append(t.adj[e[1]], e[0])
	}
	t.parent[root] = -1
	t.dfs(root, -1, 0)
	return t
}

func (t *Tree) dfs(v, p, d int) {
	t.parent[v] = p
	t.depth[v] = d
	for _, to := range t.adj[v] {
		if to != p {
			t.dfs(to, v, d+1)
		}
	}
}

func (t *Tree) LCA(u, v int) int {
	for t.depth[u] > t.depth[v] {
		u = t.parent[u]
	}
	for t.depth[v] > t.depth[u] {
		v = t.parent[v]
	}
	for u != v {
		u = t.parent[u]
		v = t.parent[v]
	}
	return u
}

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {4, 6}}
	t := NewTree(7, 0, edges)
	fmt.Println(t.LCA(6, 3)) // 1
	fmt.Println(t.LCA(6, 5)) // 0
	fmt.Println(t.LCA(3, 4)) // 1
}
```

#### Java

```java
import java.util.*;

public class NaiveLCA {
    private final int[] parent, depth;
    private final List<List<Integer>> adj;

    public NaiveLCA(int n, int root, int[][] edges) {
        parent = new int[n];
        depth = new int[n];
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            adj.get(e[1]).add(e[0]);
        }
        dfs(root, -1, 0);
    }

    private void dfs(int v, int p, int d) {
        parent[v] = p;
        depth[v] = d;
        for (int to : adj.get(v)) {
            if (to != p) dfs(to, v, d + 1);
        }
    }

    public int lca(int u, int v) {
        while (depth[u] > depth[v]) u = parent[u];
        while (depth[v] > depth[u]) v = parent[v];
        while (u != v) { u = parent[u]; v = parent[v]; }
        return u;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {4, 6}};
        NaiveLCA t = new NaiveLCA(7, 0, edges);
        System.out.println(t.lca(6, 3)); // 1
        System.out.println(t.lca(6, 5)); // 0
        System.out.println(t.lca(3, 4)); // 1
    }
}
```

#### Python

```python
import sys
from typing import List, Tuple


class NaiveLCA:
    def __init__(self, n: int, root: int, edges: List[Tuple[int, int]]):
        self.parent = [-1] * n
        self.depth = [0] * n
        self.adj: List[List[int]] = [[] for _ in range(n)]
        for a, b in edges:
            self.adj[a].append(b)
            self.adj[b].append(a)
        self._dfs_iter(root)

    def _dfs_iter(self, root: int) -> None:
        # iterative DFS to avoid recursion-depth limits on deep trees
        stack = [(root, -1, 0)]
        while stack:
            v, p, d = stack.pop()
            self.parent[v] = p
            self.depth[v] = d
            for to in self.adj[v]:
                if to != p:
                    stack.append((to, v, d + 1))

    def lca(self, u: int, v: int) -> int:
        while self.depth[u] > self.depth[v]:
            u = self.parent[u]
        while self.depth[v] > self.depth[u]:
            v = self.parent[v]
        while u != v:
            u = self.parent[u]
            v = self.parent[v]
        return u


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (4, 6)]
    t = NaiveLCA(7, 0, edges)
    print(t.lca(6, 3))  # 1
    print(t.lca(6, 5))  # 0
    print(t.lca(3, 4))  # 1
```

### Example B: Binary lifting

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

type LCA struct {
	n, log int
	up     [][]int // up[k][v] = 2^k-th ancestor of v, or -1
	depth  []int
	adj    [][]int
}

func NewLCA(n, root int, edges [][2]int) *LCA {
	log := 1
	for (1 << log) < n {
		log++
	}
	l := &LCA{n: n, log: log, depth: make([]int, n), adj: make([][]int, n)}
	l.up = make([][]int, log)
	for k := range l.up {
		l.up[k] = make([]int, n)
	}
	for _, e := range edges {
		l.adj[e[0]] = append(l.adj[e[0]], e[1])
		l.adj[e[1]] = append(l.adj[e[1]], e[0])
	}
	l.dfs(root, root, 0) // root's parent is itself (acts as sentinel)
	for k := 1; k < log; k++ {
		for v := 0; v < n; v++ {
			l.up[k][v] = l.up[k-1][l.up[k-1][v]]
		}
	}
	return l
}

func (l *LCA) dfs(v, p, d int) {
	l.up[0][v] = p
	l.depth[v] = d
	for _, to := range l.adj[v] {
		if to != p {
			l.dfs(to, v, d+1)
		}
	}
}

// KthAncestor returns the node d steps above v, or -1 if it overshoots the root.
func (l *LCA) KthAncestor(v, d int) int {
	if d > l.depth[v] {
		return -1
	}
	for d > 0 {
		k := bits.TrailingZeros(uint(d)) // lowest set bit
		v = l.up[k][v]
		d &= d - 1 // clear lowest set bit
	}
	return v
}

func (l *LCA) Query(u, v int) int {
	if l.depth[u] < l.depth[v] {
		u, v = v, u
	}
	// lift u to depth of v
	u = l.KthAncestor(u, l.depth[u]-l.depth[v])
	if u == v {
		return u
	}
	for k := l.log - 1; k >= 0; k-- {
		if l.up[k][u] != l.up[k][v] {
			u = l.up[k][u]
			v = l.up[k][v]
		}
	}
	return l.up[0][u]
}

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {4, 6}}
	l := NewLCA(7, 0, edges)
	fmt.Println(l.Query(6, 3))      // 1
	fmt.Println(l.Query(6, 5))      // 0
	fmt.Println(l.KthAncestor(6, 2)) // 1
}
```

#### Java

```java
import java.util.*;

public class BinaryLiftingLCA {
    private final int n, log;
    private final int[][] up;   // up[k][v] = 2^k-th ancestor of v
    private final int[] depth;
    private final List<List<Integer>> adj;

    public BinaryLiftingLCA(int n, int root, int[][] edges) {
        this.n = n;
        int lg = 1;
        while ((1 << lg) < n) lg++;
        this.log = lg;
        this.up = new int[log][n];
        this.depth = new int[n];
        this.adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            adj.get(e[1]).add(e[0]);
        }
        dfs(root, root, 0);     // root's parent is itself as sentinel
        for (int k = 1; k < log; k++)
            for (int v = 0; v < n; v++)
                up[k][v] = up[k - 1][up[k - 1][v]];
    }

    private void dfs(int v, int p, int d) {
        up[0][v] = p;
        depth[v] = d;
        for (int to : adj.get(v)) {
            if (to != p) dfs(to, v, d + 1);
        }
    }

    public int kthAncestor(int v, int d) {
        if (d > depth[v]) return -1;
        for (int k = 0; k < log; k++) {
            if (((d >> k) & 1) == 1) v = up[k][v];
        }
        return v;
    }

    public int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        u = kthAncestor(u, depth[u] - depth[v]);
        if (u == v) return u;
        for (int k = log - 1; k >= 0; k--) {
            if (up[k][u] != up[k][v]) { u = up[k][u]; v = up[k][v]; }
        }
        return up[0][u];
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {4, 6}};
        BinaryLiftingLCA t = new BinaryLiftingLCA(7, 0, edges);
        System.out.println(t.lca(6, 3));        // 1
        System.out.println(t.lca(6, 5));        // 0
        System.out.println(t.kthAncestor(6, 2)); // 1
    }
}
```

#### Python

```python
import sys
from typing import List, Tuple


class BinaryLiftingLCA:
    def __init__(self, n: int, root: int, edges: List[Tuple[int, int]]):
        self.n = n
        self.log = max(1, (n - 1).bit_length())  # ceil(log2(n))
        self.depth = [0] * n
        self.up = [[0] * n for _ in range(self.log)]
        self.adj: List[List[int]] = [[] for _ in range(n)]
        for a, b in edges:
            self.adj[a].append(b)
            self.adj[b].append(a)
        self._dfs(root)
        for k in range(1, self.log):
            upk, upkm1 = self.up[k], self.up[k - 1]
            for v in range(n):
                upk[v] = upkm1[upkm1[v]]

    def _dfs(self, root: int) -> None:
        # iterative DFS; root's parent is itself (sentinel)
        stack = [(root, root, 0)]
        while stack:
            v, p, d = stack.pop()
            self.up[0][v] = p
            self.depth[v] = d
            for to in self.adj[v]:
                if to != p:
                    stack.append((to, v, d + 1))

    def kth_ancestor(self, v: int, d: int) -> int:
        if d > self.depth[v]:
            return -1
        k = 0
        while d:
            if d & 1:
                v = self.up[k][v]
            d >>= 1
            k += 1
        return v

    def lca(self, u: int, v: int) -> int:
        if self.depth[u] < self.depth[v]:
            u, v = v, u
        u = self.kth_ancestor(u, self.depth[u] - self.depth[v])
        if u == v:
            return u
        for k in range(self.log - 1, -1, -1):
            if self.up[k][u] != self.up[k][v]:
                u = self.up[k][u]
                v = self.up[k][v]
        return self.up[0][u]


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (4, 6)]
    t = BinaryLiftingLCA(7, 0, edges)
    print(t.lca(6, 3))         # 1
    print(t.lca(6, 5))         # 0
    print(t.kth_ancestor(6, 2)) # 1
```

**What it does:** builds the `2^k`-ancestor table in `O(N log N)`, then answers LCA and k-th-ancestor queries in `O(log N)`.
**Run:** `go run main.go` | `javac BinaryLiftingLCA.java && java BinaryLiftingLCA` | `python lca.py`

---

## Coding Patterns

### Pattern 1: Distance between two nodes

The single most common use of LCA:

```
dist(u, v) = depth[u] + depth[v] - 2 * depth[lca(u, v)]
```

Because the path from `u` to `v` goes up to the LCA and back down, the two "upward" segments have lengths `depth[u] − depth[lca]` and `depth[v] − depth[lca]`.

```python
def dist(self, u, v):
    return self.depth[u] + self.depth[v] - 2 * self.depth[self.lca(u, v)]
```

### Pattern 2: "Is `a` an ancestor of `b`?"

`a` is an ancestor of `b` iff lifting `b` up to `a`'s depth lands exactly on `a`:

```python
def is_ancestor(self, a, b):
    if self.depth[a] > self.depth[b]:
        return False
    return self.kth_ancestor(b, self.depth[b] - self.depth[a]) == a
```

(With an Euler-tour `tin`/`tout` you can also test this in `O(1)` — covered in `middle.md`.)

### Pattern 3: k-th node on the path from `u` to `v`

Split at the LCA. If `k ≤ depth[u] − depth[lca]`, the answer is the `k`-th ancestor of `u`; otherwise it is the `(dist − k)`-th ancestor of `v`. This is a frequent contest sub-task.

```mermaid
graph TD
    A[Root tree by DFS] --> B[Record parent and depth]
    B --> C[Build up[k][v] table]
    C --> D[Query: lift deeper node]
    D --> E[Climb both together while ancestors differ]
    E --> F[Answer = parent of stopped node]
    C --> G[k-th ancestor]
    F --> H[distance = du + dv - 2*dlca]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong LCA on equal-depth nodes | Forgot the `if u == v: return u` shortcut after equalizing. | After lifting the deeper node, check equality before the big-jump loop. |
| Index out of range in `up[k][v]` | `LOG` too small for the tree height. | Use `LOG = ceil(log2(N))` (add 1 for safety). |
| `up[k][v]` reads a bad sentinel | Root's parent left as `0` while node `0` is a real node. | Set root's parent to **itself** (`up[0][root] = root`) so overshooting jumps stay at the root. |
| `RecursionError` / stack overflow in Python/Java DFS | Deep or path-like tree exceeds default recursion depth. | Use an **iterative** DFS (shown above) or raise the recursion limit. |
| Negative depth subtraction | Querying before building, or mixing 0- and 1-indexed depths. | Build first; pick one indexing and stick to it. |
| Self query `lca(u, u)` returns something odd | Not handled. | It works automatically: equalizing makes them equal, returns `u`. |

---

## Performance Tips

- **Iterate the table build cache-friendly**: loop `k` outer, `v` inner, reading `up[k-1]` sequentially.
- **Use the lowest-set-bit trick** for k-th ancestor to skip zero bits (`d &= d - 1`).
- **Flatten `adj` into CSR arrays** for very large `N` to avoid per-node slice overhead.
- **Prefer iterative DFS** in languages with shallow default stacks — it also avoids function-call overhead.
- **If you only need distances**, you do not need the Euler tour; binary lifting plus `depth[]` is enough.
- **Choose `LOG` from `N`, not a fixed constant**, so you never over-allocate the table for small trees.

---

## Best Practices

- Decide the **root** once and document it; LCA is meaningless without a fixed root.
- Initialize the root's ancestor as a clean sentinel (itself or `-1`) and handle it consistently everywhere.
- Write the naive `O(N)` LCA first and use it as an oracle to test binary lifting on random trees.
- Keep `depth[]`, `parent[]`, and `up[][]` consistent — build them in the same DFS pass.
- Separate **build** from **query** so the table is computed exactly once.
- For k-th ancestor that overshoots, return a clear sentinel (`-1`) rather than wrapping around.

---

## Edge Cases & Pitfalls

- **`u == v`**: the LCA is the node itself. The standard code handles it.
- **One node is an ancestor of the other**: e.g., `lca(root, x) = root`. Equalize-then-climb returns the shallower node correctly.
- **Single-node tree**: `lca(0, 0) = 0`; no table rows are needed beyond `up[0]`.
- **Path (line) tree**: height is `N − 1`; the naive method is `O(N)` per query and recursion may overflow.
- **Disconnected input**: LCA is undefined across components — validate that the input is a single tree.
- **0-indexed vs 1-indexed nodes**: the most common silent bug; align your edge list and array sizes.
- **Root with no parent**: never read `parent[root]` as a real node; use the sentinel.

---

## Common Mistakes

1. **Sizing `LOG` too small** — `2^LOG` must exceed the maximum depth, not just be near it.
2. **Forgetting to lift the deeper node first** — the big-jump loop assumes equal depth.
3. **Jumping when ancestors are equal** in the climb loop — you must jump only when `up[k][u] != up[k][v]`, otherwise you overshoot past the LCA.
4. **Returning `u` instead of `up[0][u]`** after the loop — the loop stops *one below* the LCA.
5. **Leaving the root's parent as `0`** when node `0` is a valid node — corrupts overshooting jumps.
6. **Recursive DFS on a deep tree** — stack overflow; switch to iterative.
7. **Rebuilding the table per query** — defeats the whole point; build once.

---

## Cheat Sheet

| Task | Formula / step |
|------|----------------|
| `LOG` | `ceil(log2(N))` (add 1 for safety) |
| Base table | `up[0][v] = parent[v]` (root's parent = root) |
| Doubling | `up[k][v] = up[k-1][up[k-1][v]]` |
| k-th ancestor | for each set bit `k` of `d`: `v = up[k][v]` |
| Equalize depth | lift deeper node by `|depth[u] − depth[v]|` |
| Climb loop | for `k = LOG-1..0`: if `up[k][u] != up[k][v]` jump both |
| LCA answer | `up[0][u]` after the loop (or `u` if equal after equalize) |
| Distance | `depth[u] + depth[v] − 2·depth[lca]` |

Build complexity: `O(N log N)` time and space. Query: `O(log N)`.

```
parent of root  = root (sentinel)
up[0][v]        = parent[v]
up[k][v]        = up[k-1][ up[k-1][v] ]
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization of binary-lifting LCA.
>
> The animation demonstrates:
> - The tree with each node's **depth** and **`2^k` jump pointers**.
> - A query that first **equalizes depth** by lifting the deeper node.
> - The two nodes **climbing together** in power-of-two jumps until they sit just below the LCA.
> - Step / Run / Reset controls so you can watch each jump.

---

## Summary

The Lowest Common Ancestor is the deepest shared ancestor of two nodes in a rooted tree. The **naive** equalize-then-climb method is `O(N)` per query and is the cleanest way to understand the problem. **Binary lifting** precomputes `up[k][v]`, the `2^k`-th ancestor of every node, in `O(N log N)`, and then answers each LCA (and k-th ancestor) query in `O(log N)`. Master the two ideas — *lift the deeper node to equal depth*, then *jump both up by powers of two while their ancestors differ* — and you have the most widely used online LCA tool in your kit. Faster `O(1)`-query variants (Euler tour + sparse table, and the `O(N)`/`O(1)` Farach-Colton–Bender method) appear in the higher-level files.

---

## Further Reading

- *Competitive Programmer's Handbook* (Laaksonen), chapter on tree queries — binary lifting and Euler tour.
- *Introduction to Algorithms* (CLRS) — trees, DFS, and the offline LCA exercise.
- cp-algorithms.com — "Lowest Common Ancestor: Binary Lifting" and "LCA with Euler tour / Sparse Table."
- Bender & Farach-Colton, *The LCA Problem Revisited* (2000) — the `O(N)`/`O(1)` reduction.
- Sibling topic: `12-disjoint-set / 04-offline-lca` — Tarjan's offline LCA with union-find.
- Sibling topic: `14-heavy-light-decomposition` — path queries that combine with LCA.
