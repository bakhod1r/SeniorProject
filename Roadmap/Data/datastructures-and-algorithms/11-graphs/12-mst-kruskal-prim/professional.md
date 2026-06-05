# Minimum Spanning Tree — Professional Level

> **One-line summary:** The MST is one of the few classic problems where the gap between "easy `O(E log V)`" and "is there a deterministic linear-time algorithm?" is still partly open. This level gives the formal definition, rigorous correctness proofs of the cut and cycle properties (and that they make Kruskal and Prim optimal via a single exchange argument), exact complexity per data structure, and the modern frontier: Karger–Klein–Tarjan's expected-linear randomized MST, Chazelle's `O(E α(E,V))` deterministic algorithm, and the still-unresolved question of optimal deterministic MST.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [Correctness Proofs](#2-correctness-proofs)
3. [Generic Greedy MST (the unifying frame)](#3-generic-greedy-mst-the-unifying-frame)
4. [Worked Traces — Kruskal vs Prim](#4-worked-traces--kruskal-vs-prim)
5. [Complexity by Data Structure](#5-complexity-by-data-structure)
6. [Borůvka — Code in Three Languages](#6-borvka--code-in-three-languages)
7. [Prim Dense `O(V²)` — Code in Three Languages](#7-prim-dense-ov2--code-in-three-languages)
8. [Second-Best MST — Code in Three Languages](#8-second-best-mst--code-in-three-languages)
9. [Karger–Klein–Tarjan: Expected Linear Time](#9-kargerkleintarjan-expected-linear-time)
10. [Chazelle: Near-Linear Deterministic](#10-chazelle-near-linear-deterministic)
11. [Cache Behavior](#11-cache-behavior)
12. [Average-Case Analysis](#12-average-case-analysis)
13. [Space-Time Trade-offs](#13-space-time-trade-offs)
14. [Comparison](#14-comparison)
15. [Open Problems](#15-open-problems)
16. [Summary](#16-summary)

---

## 1. Formal Definition

Let `G = (V, E, w)` be a connected, undirected graph with a weight function `w : E → ℝ`. A **spanning tree** `T ⊆ E` is an acyclic, connected subgraph touching all of `V`; it has exactly `|V| − 1` edges. A **minimum spanning tree** is a spanning tree minimizing

```
w(T) = Σ_{e ∈ T} w(e).
```

Properties used throughout:

- The set of forests of `G` forms the independent sets of a **graphic matroid** `M(G)`. An MST is a **minimum-weight basis** of that matroid. This is *the* reason the greedy algorithm is optimal: the greedy algorithm computes a minimum-weight basis of *any* matroid, and MST is the matroid special case (Rado–Edmonds theorem).
- If `G` is disconnected, replace "tree" with "forest"; the **minimum spanning forest (MSF)** is the union of per-component MSTs and has `|V| − c` edges for `c` components.
- If all weights are distinct, the MST is **unique** (proved below).

---

## 2. Correctness Proofs

### 2.1 Cut Property (safe-edge theorem)

> **Theorem (Cut Property).** Let `A ⊆ E` be a subset of edges contained in some MST of `G`. Let `(S, V∖S)` be any cut such that no edge of `A` crosses it. Let `e` be a minimum-weight edge crossing `(S, V∖S)`. Then `A ∪ {e}` is contained in some MST.

**Proof (exchange argument).** Let `T` be an MST with `A ⊆ T`. If `e ∈ T`, then `A ∪ {e} ⊆ T` and we are done. Otherwise `T ∪ {e}` contains exactly one cycle `C`, and `e ∈ C`. Because `e` crosses the cut, traversing `C` we must cross the cut an even number of times, so there is another edge `e' ∈ C` crossing `(S, V∖S)`, `e' ≠ e`. Since no edge of `A` crosses the cut, `e' ∉ A`. The graph `T' = (T ∖ {e'}) ∪ {e}` is again a spanning tree (removing `e'` breaks the unique cycle). Its weight is

```
w(T') = w(T) − w(e') + w(e) ≤ w(T),    since w(e) ≤ w(e').
```

As `T` is minimum, `w(T') = w(T)`, so `T'` is also an MST, and `A ∪ {e} ⊆ T'`. ∎

### 2.2 Cycle Property

> **Theorem (Cycle Property).** Let `C` be a cycle in `G` and let `e` be an edge of `C` with `w(e) > w(f)` for every other edge `f ∈ C`. Then `e` belongs to no MST.

**Proof.** Suppose some MST `T` contains `e`. Removing `e` splits `T` into components `X` and `Y`. The cycle `C` minus `e` is a path connecting `e`'s endpoints, so it crosses the `(X, Y)` cut on some edge `e' ≠ e`, with `w(e') < w(e)` by hypothesis. Then `T' = (T ∖ {e}) ∪ {e'}` is a spanning tree with `w(T') = w(T) − w(e) + w(e') < w(T)`, contradicting minimality of `T`. ∎

### 2.3 Kruskal Correctness

Kruskal processes edges in nondecreasing weight order, adding `e=(u,v)` iff `u, v` are currently in different trees. **Claim:** every added edge is safe. Consider the moment Kruskal adds `e`. Let `A` be the edges added so far (a forest, contained in some MST by induction). Let `S` be the tree of `A` containing `u`. No edge of `A` crosses the cut `(S, V∖S)` (else `u` and the other side would already be merged). Among all edges crossing this cut, `e` has minimum weight: any lighter crossing edge would have been processed earlier and — joining two then-different trees — would already have merged them, contradicting that `S` is exactly `u`'s current tree. By the cut property, `e` is safe. Edges Kruskal *rejects* close a cycle and are (by ascending order) the heaviest on that cycle, hence excluded by the cycle property. ∎

### 2.4 Prim Correctness

Prim maintains a single tree `A` over a vertex set `S`. At each step it adds the minimum-weight edge crossing `(S, V∖S)`. No edge of `A` crosses that cut (all of `A` is inside `S`). By the cut property, each added edge is safe, so the invariant "`A ⊆ some MST`" is preserved; after `|V|−1` additions `A` is a spanning tree, hence an MST. ∎

### 2.5 Uniqueness

> **Theorem.** If all edge weights are distinct, the MST is unique.

**Proof.** Suppose two distinct MSTs `T₁ ≠ T₂`. Let `e` be the **minimum-weight** edge in their symmetric difference, WLOG `e ∈ T₁ ∖ T₂`. Adding `e` to `T₂` creates a cycle `C`; `C` has an edge `f ∉ T₁` (else `T₁` would contain the cycle). Then `e, f` are both in the symmetric difference, and since weights are distinct and `e` is the minimum such, `w(e) < w(f)`. Swapping gives `T₂ ∖ {f} ∪ {e}`, a spanning tree of strictly smaller weight than `T₂` — contradiction. ∎

---

## 3. Generic Greedy MST (the unifying frame)

Kruskal, Prim, and Borůvka are *the same algorithm* seen through three lenses. The unifying object is the **generic greedy** procedure on the cut property:

```
GENERIC-MST(G):
  A ← ∅                                  // A is always a subforest of some MST
  while A is not a spanning tree:
    pick any cut (S, V∖S) respected by A  // no A-edge crosses it
    e ← lightest edge crossing (S, V∖S)   // a "safe edge"
    A ← A ∪ {e}
  return A
```

By the cut property (§2.1) every edge added is safe, so the loop invariant "`A ⊆ some MST`" never breaks; after `|V|−1` additions `A` is the MST. The three classic algorithms differ only in **which cuts they choose** and **how they find the lightest crossing edge**:

| Algorithm | Cut chosen each step | How the safe edge is found | Edges added per step |
|-----------|----------------------|----------------------------|----------------------|
| **Prim** | `(S, V∖S)` where `S` = the one growing tree | min over the frontier (priority queue) | 1 |
| **Kruskal** | implied by the two endpoints of the next sorted edge | global ascending sort; first edge joining two trees | 1 |
| **Borůvka** | one cut *per component* simultaneously | each component scans for its own min outgoing edge | up to `c` (one per component) |

This is why correctness arguments do not need to be repeated per algorithm: prove the cut property once (a single exchange argument), and all three inherit optimality. Borůvka's extra wrinkle — adding many safe edges in one round — is sound because, with a fixed tie-break total order on edges, no two simultaneously chosen min-outgoing edges can form a cycle (proved in §6).

```
            generic greedy (cut property)
                       |
        +--------------+---------------+
        |              |               |
      Prim          Kruskal         Borůvka
   one growing     global sort    per-component
      tree         + Union-Find    min, parallel
```

The **anti-greedy** dual is the reverse-delete algorithm: sort edges *descending*, delete an edge iff its removal keeps the graph connected (cycle property, §2.2). It is the matroid-dual of Kruskal and also produces the MST.

---

## 4. Worked Traces — Kruskal vs Prim

Both traces use this 6-vertex graph (the same graph the animation renders):

```
            6                5
      A ---------- B ---------- C
      |          / | \          |
    5 |       3 /  |6 \5      4 |   2
      |        /   |   \        |  (C–F)
      D ----- +    E    +------ F
         (D–B)   /   \         /
              6 /     \ 6     / 6
               E ----- (E–F)-+
      edges: A-B 6, A-D 5, B-C 5, B-D 3, B-E 6, C-E 4, C-F 2, D-E 6, E-F 6
```

### 4.1 Kruskal trace (sort ascending, Union-Find)

Sorted edges: `C-F(2), B-D(3), C-E(4), A-D(5), B-C(5), A-B(6), B-E(6), D-E(6), E-F(6)`.

| Step | Edge | w | find(u), find(v) | Action | Forest (components) | Σw |
|------|------|---|------------------|--------|---------------------|----|
| 1 | C–F | 2 | C≠F | **accept** | {A}{B}{C,F}{D}{E} | 2 |
| 2 | B–D | 3 | B≠D | **accept** | {A}{B,D}{C,F}{E} | 5 |
| 3 | C–E | 4 | C≠E | **accept** | {A}{B,D}{C,E,F} | 9 |
| 4 | A–D | 5 | A≠D | **accept** | {A,B,D}{C,E,F} | 14 |
| 5 | B–C | 5 | B≠C | **accept** | {A,B,C,D,E,F} | 19 |
| — | — | — | — | done: 5 = V−1 edges | one tree | **19** |

Edges `A-B, B-E, D-E, E-F` are never examined — Kruskal stops at the `V−1`-th acceptance. Had it continued, each would be **rejected** as the heaviest edge of the cycle it closes (cycle property).

```
MST (weight 19):
      A          B ---------- C
      |          |            |
    5 |        3 |          4 |   2
      |          |            |
      D ---------+            E    F
                                   (C–F edge, weight 2)
   tree edges: C-F(2), B-D(3), C-E(4), A-D(5), B-C(5)
```

### 4.2 Prim trace (start at A, eager binary heap)

`key[v]` = lightest known edge from the tree to `v`; `∞` if unknown.

| Step | Tree S | Frontier PQ (v:key) | Extract-min | Add edge | Σw |
|------|--------|---------------------|-------------|----------|----|
| 0 | {A} | B:6, D:5 | — | — | 0 |
| 1 | {A} | D:5, B:6 | D (5) | A–D | 5 |
| 2 | {A,D} | B:3, E:6 | B (3) | B–D | 8 |
| 3 | {A,B,D} | C:5, E:6 | C (5) | B–C | 13 |
| 4 | {A,B,C,D} | E:4, F:2 | F (2) | C–F | 15 |
| 5 | {A,B,C,D,F} | E:4 | E (4) | C–E | 19 |
| — | all 6 | empty | — | — | **19** |

Note the **decrease-key** events: when D enters at step 1, edge B–D (3) relaxes B's key from 6 down to 3; when C enters at step 3, edge C–F (2) and C–E (4) relax F and E. Prim and Kruskal pick the **same edge set** here (`A-D, B-D, B-C, C-F, C-E`) because all weights that matter are distinct on the relevant cuts — but in general they may choose different equal-weight edges while achieving identical total weight.

---

## 5. Complexity by Data Structure

| Algorithm | Data structure | Time | Notes |
|-----------|----------------|------|-------|
| Kruskal | comparison sort + Union-Find (path compression + union by rank) | `O(E log E + E α(V))` = `O(E log V)` | Sort dominates; UF passes are `O(E α(V))` ≈ linear. |
| Kruskal | radix/counting sort (bounded integer weights) + UF | `O(E α(V))` | Effectively linear when weights sort in `O(E)`. |
| Prim | binary heap (lazy or eager) | `O(E log V)` | `E` decrease-key/push, each `O(log V)`. |
| Prim | `d`-ary heap | `O(E log_d V)` with `d = E/V` → `O(E log_{E/V} V)` | Tunes for density. |
| Prim | Fibonacci heap | `O(E + V log V)` | `E` decrease-keys at `O(1)` amortized, `V` extract-mins at `O(log V)`. |
| Prim | array (no heap) | `O(V²)` | Best for dense `E = Θ(V²)`. |
| Borůvka | component labels + per-round scan | `O(E log V)` | `O(log V)` rounds, `O(E)` each. |
| Borůvka + Prim hybrid | — | `O(E log log V)` | Run a few Borůvka rounds, then Prim on the contracted graph. |
| Fredman–Tarjan | Fibonacci heap, bounded-size Prim passes | `O(E log* V)` | Iterated Prim with size caps. |
| Gabow et al. | — | `O(E log β(E,V))` | `β` = min `i` with `log^{(i)} V ≤ E/V`. |
| Chazelle | soft heaps | `O(E α(E,V))` | Best known *deterministic*. |
| Karger–Klein–Tarjan | random sampling + Borůvka | `O(E)` **expected** | Best known randomized. |

The **inverse Ackermann** `α(V)` from Union-Find is ≤ 4 for any conceivable `V`, so Kruskal's non-sort work is linear for all practical purposes (Union-Find detail in sibling *12-disjoint-set*).

---

## 6. Borůvka — Code in Three Languages

Borůvka (1926, the oldest MST algorithm) runs in `O(log V)` rounds; each round every component picks its **minimum-weight outgoing edge (MWOE)** and contracts. With a *total order* on edges (break ties by index) no cycle can form within a round, because along any would-be cycle the edges' total-order ranks cannot all be the minimum of their components simultaneously.

> **Why no cycle forms.** Suppose a round produced a cycle `e₁,…,e_k`. Each `eᵢ` is the strict minimum (under the total order) of the component that chose it. Walk the cycle: each step moves to a strictly smaller chosen edge, returning to the start with a strictly smaller value than itself — impossible. Hence each round contributes a forest, all edges safe by the cut property. ∎

### Go

```go
package main

import (
	"fmt"
	"sort"
)

type edge struct{ u, v, w, id int }

type dsu struct{ p, r []int }

func newDSU(n int) *dsu {
	d := &dsu{p: make([]int, n), r: make([]int, n)}
	for i := range d.p {
		d.p[i] = i
	}
	return d
}
func (d *dsu) find(x int) int {
	for d.p[x] != x {
		d.p[x] = d.p[d.p[x]]
		x = d.p[x]
	}
	return x
}
func (d *dsu) union(a, b int) bool {
	ra, rb := d.find(a), d.find(b)
	if ra == rb {
		return false
	}
	if d.r[ra] < d.r[rb] {
		ra, rb = rb, ra
	}
	d.p[rb] = ra
	if d.r[ra] == d.r[rb] {
		d.r[ra]++
	}
	return true
}

// Boruvka returns total MST weight and number of components remaining
// (1 if connected, >1 if the graph is disconnected → minimum spanning forest).
func Boruvka(n int, edges []edge) (total int64, comps int) {
	d := newDSU(n)
	comps = n
	for comps > 1 {
		// cheapest[c] = index into edges of component c's MWOE, or -1.
		cheapest := make([]int, n)
		for i := range cheapest {
			cheapest[i] = -1
		}
		for i := range edges {
			e := edges[i]
			ru, rv := d.find(e.u), d.find(e.v)
			if ru == rv {
				continue
			}
			better := func(c int) {
				if cheapest[c] == -1 {
					cheapest[c] = i
				} else {
					b := edges[cheapest[c]]
					// total order: (w, id) breaks ties deterministically
					if e.w < b.w || (e.w == b.w && e.id < b.id) {
						cheapest[c] = i
					}
				}
			}
			better(ru)
			better(rv)
		}
		merged := 0
		for c := 0; c < n; c++ {
			if cheapest[c] == -1 {
				continue
			}
			e := edges[cheapest[c]]
			if d.union(e.u, e.v) {
				total += int64(e.w)
				merged++
			}
		}
		if merged == 0 {
			break // disconnected: no MWOE left
		}
		comps -= merged
	}
	return total, comps
}

func main() {
	es := []edge{{0, 1, 6, 0}, {0, 3, 5, 1}, {1, 2, 5, 2}, {1, 3, 3, 3},
		{1, 4, 6, 4}, {2, 4, 4, 5}, {2, 5, 2, 6}, {3, 4, 6, 7}, {4, 5, 6, 8}}
	sort.Slice(es, func(i, j int) bool { return es[i].id < es[j].id })
	w, c := Boruvka(6, es)
	fmt.Printf("MST weight=%d components=%d\n", w, c) // 19, 1
}
```

### Java

```java
import java.util.*;

public class Boruvka {
    static int[] p, rnk;
    static int find(int x) { while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; } return x; }
    static boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rnk[ra] < rnk[rb]) { int t = ra; ra = rb; rb = t; }
        p[rb] = ra; if (rnk[ra] == rnk[rb]) rnk[ra]++;
        return true;
    }

    // edges[i] = {u, v, w, id}. Returns {totalWeight, componentsRemaining}.
    static long[] boruvka(int n, int[][] edges) {
        p = new int[n]; rnk = new int[n];
        for (int i = 0; i < n; i++) p[i] = i;
        long total = 0; int comps = n;
        while (comps > 1) {
            int[] cheapest = new int[n];
            Arrays.fill(cheapest, -1);
            for (int i = 0; i < edges.length; i++) {
                int[] e = edges[i];
                int ru = find(e[0]), rv = find(e[1]);
                if (ru == rv) continue;
                for (int c : new int[]{ru, rv}) {
                    if (cheapest[c] == -1) cheapest[c] = i;
                    else {
                        int[] b = edges[cheapest[c]];
                        if (e[2] < b[2] || (e[2] == b[2] && e[3] < b[3])) cheapest[c] = i;
                    }
                }
            }
            int merged = 0;
            for (int c = 0; c < n; c++) {
                if (cheapest[c] == -1) continue;
                int[] e = edges[cheapest[c]];
                if (union(e[0], e[1])) { total += e[2]; merged++; }
            }
            if (merged == 0) break;       // disconnected → spanning forest
            comps -= merged;
        }
        return new long[]{total, comps};
    }

    public static void main(String[] args) {
        int[][] es = {{0,1,6,0},{0,3,5,1},{1,2,5,2},{1,3,3,3},
                      {1,4,6,4},{2,4,4,5},{2,5,2,6},{3,4,6,7},{4,5,6,8}};
        long[] r = boruvka(6, es);
        System.out.println("MST weight=" + r[0] + " components=" + r[1]); // 19, 1
    }
}
```

### Python

```python
def boruvka(n, edges):
    """edges: list of (u, v, w, id). Returns (total_weight, components_remaining).
    components_remaining > 1 means the graph was disconnected (spanning forest)."""
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return False
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        return True

    total, comps = 0, n
    while comps > 1:
        cheapest = [-1] * n
        for i, (u, v, w, eid) in enumerate(edges):
            ru, rv = find(u), find(v)
            if ru == rv:
                continue
            for c in (ru, rv):
                if cheapest[c] == -1:
                    cheapest[c] = i
                else:
                    _, _, bw, bid = edges[cheapest[c]]
                    if (w, eid) < (bw, bid):   # total order ⇒ deterministic, no cycles
                        cheapest[c] = i
        merged = 0
        for c in range(n):
            if cheapest[c] == -1:
                continue
            u, v, w, _ = edges[cheapest[c]]
            if union(u, v):
                total += w
                merged += 1
        if merged == 0:
            break                              # disconnected → forest
        comps -= merged
    return total, comps


if __name__ == "__main__":
    es = [(0,1,6,0),(0,3,5,1),(1,2,5,2),(1,3,3,3),
          (1,4,6,4),(2,4,4,5),(2,5,2,6),(3,4,6,7),(4,5,6,8)]
    print(boruvka(6, es))   # (19, 1)
```

---

## 7. Prim Dense `O(V²)` — Code in Three Languages

On a dense graph (`E = Θ(V²)`, e.g. a complete metric graph) the heap is a liability: it pays `O(log V)` for each of `Θ(V²)` relaxations. The array version drops the heap entirely — each of `V` iterations does an `O(V)` linear scan for the cheapest frontier vertex, then an `O(V)` relax — giving `O(V²)`, which beats `O(E log V) = O(V² log V)` for dense graphs and is far more cache-friendly (contiguous sweeps, no pointer chasing).

### Go

```go
package main

import "fmt"

const INF = 1 << 30

// PrimDense takes an adjacency matrix (g[i][j] = weight, INF if no edge).
// Returns total MST weight; -1 if the graph is disconnected.
func PrimDense(g [][]int) int {
	n := len(g)
	key := make([]int, n)
	inMST := make([]bool, n)
	for i := range key {
		key[i] = INF
	}
	key[0] = 0
	total := 0
	for it := 0; it < n; it++ {
		u := -1
		for v := 0; v < n; v++ { // O(V) scan for cheapest frontier vertex
			if !inMST[v] && (u == -1 || key[v] < key[u]) {
				u = v
			}
		}
		if key[u] == INF {
			return -1 // disconnected
		}
		inMST[u] = true
		total += key[u]
		for v := 0; v < n; v++ { // O(V) relax
			if !inMST[v] && g[u][v] < key[v] {
				key[v] = g[u][v]
			}
		}
	}
	return total
}

func main() {
	I := INF
	g := [][]int{
		{0, 6, I, 5, I, I},
		{6, 0, 5, 3, 6, I},
		{I, 5, 0, I, 4, 2},
		{5, 3, I, 0, 6, I},
		{I, 6, 4, 6, 0, 6},
		{I, I, 2, I, 6, 0},
	}
	fmt.Println("MST weight:", PrimDense(g)) // 19
}
```

### Java

```java
public class PrimDense {
    static final int INF = 1 << 30;

    // g[i][j] = weight, INF if no edge. Returns total weight; -1 if disconnected.
    static int primDense(int[][] g) {
        int n = g.length;
        int[] key = new int[n];
        boolean[] inMST = new boolean[n];
        java.util.Arrays.fill(key, INF);
        key[0] = 0;
        int total = 0;
        for (int it = 0; it < n; it++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inMST[v] && (u == -1 || key[v] < key[u])) u = v;
            if (key[u] == INF) return -1;          // disconnected
            inMST[u] = true;
            total += key[u];
            for (int v = 0; v < n; v++)
                if (!inMST[v] && g[u][v] < key[v]) key[v] = g[u][v];
        }
        return total;
    }

    public static void main(String[] args) {
        int I = INF;
        int[][] g = {
            {0,6,I,5,I,I},{6,0,5,3,6,I},{I,5,0,I,4,2},
            {5,3,I,0,6,I},{I,6,4,6,0,6},{I,I,2,I,6,0}};
        System.out.println("MST weight: " + primDense(g)); // 19
    }
}
```

### Python

```python
INF = float("inf")


def prim_dense(g):
    """g: adjacency matrix, g[i][j] = weight or INF. Returns total weight, or None if disconnected."""
    n = len(g)
    key = [INF] * n
    in_mst = [False] * n
    key[0] = 0
    total = 0
    for _ in range(n):
        u = -1
        for v in range(n):                 # O(V) min scan (no heap)
            if not in_mst[v] and (u == -1 or key[v] < key[u]):
                u = v
        if key[u] == INF:
            return None                    # disconnected
        in_mst[u] = True
        total += key[u]
        for v in range(n):                 # O(V) relax
            if not in_mst[v] and g[u][v] < key[v]:
                key[v] = g[u][v]
    return total


if __name__ == "__main__":
    I = INF
    g = [
        [0, 6, I, 5, I, I],
        [6, 0, 5, 3, 6, I],
        [I, 5, 0, I, 4, 2],
        [5, 3, I, 0, 6, I],
        [I, 6, 4, 6, 0, 6],
        [I, I, 2, I, 6, 0],
    ]
    print("MST weight:", prim_dense(g))    # 19
```

---

## 8. Second-Best MST — Code in Three Languages

The **second-best MST** is the cheapest spanning tree that differs from the MST in at least one edge. Theory: the second-best MST is obtained from the MST by **swapping exactly one** non-tree edge `(u,v)` for the **maximum-weight edge** on the unique MST path between `u` and `v` (replacing the max keeps the tree spanning and adds the least possible). So:

```
secondBest = min over non-tree edges (u,v) of
                 w(MST) − maxEdgeOnPath(u,v) + w(u,v)
```

We first build the MST (Kruskal), then for each pair compute `maxEdgeOnPath` by BFS/DFS over the tree. The `O(V²)` precompute below is simple and exact; for large graphs use LCA + sparse tables for `O(log V)` path-max queries.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

type E struct{ u, v, w int }

func secondBestMST(n int, edges []E) (best, second int64) {
	type d struct{ p, r []int }
	par := make([]int, n)
	rnk := make([]int, n)
	for i := range par {
		par[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for par[x] != x {
			par[x] = par[par[x]]
			x = par[x]
		}
		return x
	}
	es := append([]E(nil), edges...)
	sort.Slice(es, func(i, j int) bool { return es[i].w < es[j].w })

	adj := make([][][2]int, n) // tree adjacency: (neighbor, weight)
	inMST := make([]bool, len(es))
	for i, e := range es {
		ra, rb := find(e.u), find(e.v)
		if ra == rb {
			continue
		}
		if rnk[ra] < rnk[rb] {
			ra, rb = rb, ra
		}
		par[rb] = ra
		if rnk[ra] == rnk[rb] {
			rnk[ra]++
		}
		best += int64(e.w)
		inMST[i] = true
		adj[e.u] = append(adj[e.u], [2]int{e.v, e.w})
		adj[e.v] = append(adj[e.v], [2]int{e.u, e.w})
	}

	// maxOnPath[a][b] via BFS from each source over the tree.
	maxOn := make([][]int, n)
	for s := 0; s < n; s++ {
		maxOn[s] = make([]int, n)
		for i := range maxOn[s] {
			maxOn[s][i] = -1
		}
		maxOn[s][s] = 0
		queue := []int{s}
		seen := make([]bool, n)
		seen[s] = true
		for len(queue) > 0 {
			x := queue[0]
			queue = queue[1:]
			for _, nb := range adj[x] {
				y, w := nb[0], nb[1]
				if !seen[y] {
					seen[y] = true
					mx := maxOn[s][x]
					if w > mx {
						mx = w
					}
					maxOn[s][y] = mx
					queue = append(queue, y)
				}
			}
		}
	}

	second = 1 << 62
	for i, e := range es {
		if inMST[i] {
			continue
		}
		cand := best - int64(maxOn[e.u][e.v]) + int64(e.w)
		if cand < second {
			second = cand
		}
	}
	return best, second
}

func main() {
	edges := []E{{0, 1, 6}, {0, 3, 5}, {1, 2, 5}, {1, 3, 3},
		{1, 4, 6}, {2, 4, 4}, {2, 5, 2}, {3, 4, 6}, {4, 5, 6}}
	b, s := secondBestMST(6, edges)
	fmt.Printf("best=%d second-best=%d\n", b, s) // best=19 second-best=20
}
```

### Java

```java
import java.util.*;

public class SecondBestMST {
    static int[] par, rnk;
    static int find(int x) { while (par[x] != x) { par[x] = par[par[x]]; x = par[x]; } return x; }

    static long[] solve(int n, int[][] edges) {
        par = new int[n]; rnk = new int[n];
        for (int i = 0; i < n; i++) par[i] = i;
        int[][] es = edges.clone();
        Arrays.sort(es, Comparator.comparingInt(e -> e[2]));
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        boolean[] inMST = new boolean[es.length];
        long best = 0;
        for (int i = 0; i < es.length; i++) {
            int[] e = es[i];
            int ra = find(e[0]), rb = find(e[1]);
            if (ra == rb) continue;
            if (rnk[ra] < rnk[rb]) { int t = ra; ra = rb; rb = t; }
            par[rb] = ra; if (rnk[ra] == rnk[rb]) rnk[ra]++;
            best += e[2]; inMST[i] = true;
            adj[e[0]].add(new int[]{e[1], e[2]});
            adj[e[1]].add(new int[]{e[0], e[2]});
        }
        int[][] maxOn = new int[n][n];
        for (int s = 0; s < n; s++) {
            Arrays.fill(maxOn[s], -1);
            maxOn[s][s] = 0;
            boolean[] seen = new boolean[n];
            ArrayDeque<Integer> q = new ArrayDeque<>();
            q.add(s); seen[s] = true;
            while (!q.isEmpty()) {
                int x = q.poll();
                for (int[] nb : adj[x]) {
                    int y = nb[0], w = nb[1];
                    if (!seen[y]) { seen[y] = true; maxOn[s][y] = Math.max(maxOn[s][x], w); q.add(y); }
                }
            }
        }
        long second = Long.MAX_VALUE;
        for (int i = 0; i < es.length; i++) {
            if (inMST[i]) continue;
            int[] e = es[i];
            second = Math.min(second, best - maxOn[e[0]][e[1]] + e[2]);
        }
        return new long[]{best, second};
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1,6},{0,3,5},{1,2,5},{1,3,3},
                         {1,4,6},{2,4,4},{2,5,2},{3,4,6},{4,5,6}};
        long[] r = solve(6, edges);
        System.out.println("best=" + r[0] + " second-best=" + r[1]); // best=19 second-best=20
    }
}
```

### Python

```python
from collections import deque


def second_best_mst(n, edges):
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return False
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        return True

    es = sorted(edges, key=lambda e: e[2])
    adj = [[] for _ in range(n)]
    in_mst = [False] * len(es)
    best = 0
    for i, (u, v, w) in enumerate(es):
        if union(u, v):
            best += w
            in_mst[i] = True
            adj[u].append((v, w))
            adj[v].append((u, w))

    # max edge weight on the tree path between every pair, via BFS per source
    max_on = [[-1] * n for _ in range(n)]
    for s in range(n):
        max_on[s][s] = 0
        seen = [False] * n
        seen[s] = True
        q = deque([s])
        while q:
            x = q.popleft()
            for y, w in adj[x]:
                if not seen[y]:
                    seen[y] = True
                    max_on[s][y] = max(max_on[s][x], w)
                    q.append(y)

    second = float("inf")
    for i, (u, v, w) in enumerate(es):
        if in_mst[i]:
            continue
        second = min(second, best - max_on[u][v] + w)
    return best, second


if __name__ == "__main__":
    edges = [(0,1,6),(0,3,5),(1,2,5),(1,3,3),
             (1,4,6),(2,4,4),(2,5,2),(3,4,6),(4,5,6)]
    print(second_best_mst(6, edges))   # (19, 20)
```

The second-best swap on our graph: adding non-tree edge **B–E (6)** and dropping the max-weight edge on B's MST path to E (which is **B–C, 5**) gives `19 − 5 + 6 = 20`. Every other candidate swap is `≥ 20`, so the second-best MST weight is **20**.

---

## 9. Karger–Klein–Tarjan: Expected Linear Time

KKT (1995) is a **randomized** MST algorithm running in `O(E)` *expected* time. It rests on the **MST verification / sampling** machinery:

1. **Borůvka contraction:** run 2 Borůvka steps, contracting the graph; this removes at least `3/4` of the vertices and halves them at least twice, cutting `V` by `≥ 4×`.
2. **Random sampling:** include each remaining edge independently with probability `1/2`, forming subgraph `H`. Recursively compute the MSF `F` of `H`.
3. **`F`-heavy edge discard:** an edge `e=(u,v)` is **`F`-heavy** if `w(e)` exceeds the maximum weight on the `u→v` path in `F`; by the cycle property such edges are *not* in the MST and can be discarded. A key sampling lemma proves the expected number of `F`-*light* edges that survive is `O(V)`.
4. **Recurse** on the surviving (light) edges.

The verification step — testing `F`-heaviness for all edges in `O(E)` — uses **Komlós's** linear MST-verification algorithm (deciding, for each non-tree edge, the max edge on its tree path) combined with King's simplification. The recurrence solves to `O(E)` expected. KKT is the closest thing we have to "MST in linear time" and is unconditional in its randomness assumptions (it works for any input, using internal coin flips).

---

## 10. Chazelle: Near-Linear Deterministic

Chazelle (2000) gives a **deterministic** MST algorithm in `O(E · α(E,V))` time, where `α` is the inverse Ackermann function — within an inverse-Ackermann factor of linear. The engine is the **soft heap**, a priority queue that achieves `O(1)` amortized operations by allowing a controlled fraction of *corrupted* keys (keys whose stored value is artificially inflated). By tolerating bounded corruption, Chazelle bypasses the comparison lower bound that would otherwise force `Θ(E log V)`. Pettie and Ramachandran (2002) later gave a **provably optimal** deterministic MST algorithm whose running time equals the decision-tree complexity of the problem — but the *exact* asymptotic value of that complexity is unknown, which is precisely why "deterministic linear-time MST" remains open (Section 10).

These algorithms are of theoretical importance; in practice Kruskal/Prim/Borůvka dominate because their constants are tiny and `log V ≤ ~30` for any real graph.

---

## 11. Cache Behavior

- **Kruskal** is cache-friendly in its sort phase (sequential scans, good for radix/merge sort), but the **Union-Find** `find`s perform pointer-chasing with poor locality. Path compression flattens trees, improving locality over time; union by rank keeps trees shallow.
- **Array-Prim** is the most cache-friendly variant: the inner loops sweep the contiguous `minEdge[]` array linearly, with predictable prefetching and no pointer indirection — a major reason it beats heap-Prim on dense graphs even at equal asymptotic class.
- **Heap-Prim** suffers from heap sift operations that jump across the array by factors of 2 (parent/child index gaps), defeating prefetch on large heaps, plus adjacency-list pointer chasing.
- **Borůvka** streams the edge list per round — excellent sequential locality — but the per-component min-slot updates scatter writes; partitioning edges by component improves it.

For very large graphs, a **CSR (compressed sparse row)** edge layout plus Borůvka maximizes streaming bandwidth, which is why GPU MST is Borůvka-on-CSR.

---

## 12. Average-Case Analysis

- **Random weights, fixed graph:** if edge weights are i.i.d. continuous random variables, the MST's *structure* depends only on the weight *ordering*, not magnitudes — so any property invariant under monotone weight transforms is determined combinatorially.
- **Random graph `G(n, p)`:** the expected MST weight of the complete graph `K_n` with i.i.d. `Uniform(0,1)` weights tends to **`ζ(3) ≈ 1.202`** as `n → ∞` (Frieze's theorem, 1985) — a striking constant independent of `n`. Generalizes to `Σ 1/k³` style results for other weight distributions.
- **Expected Borůvka rounds:** on random graphs the component count drops faster than the worst-case halving, so the practical round count is often `< log V`.
- **Kruskal early-stop:** with random weights the `V−1`-th accepted edge typically appears well before the end of the sorted list, so the early break saves a constant fraction of union calls.

---

## 13. Space-Time Trade-offs

| Choice | Space | Time | When |
|--------|-------|------|------|
| Kruskal in-memory | `O(E)` edges + `O(V)` UF | `O(E log E)` | `E` fits in RAM. |
| Kruskal external | `O(V)` resident | `O(E log E)` (disk sort) | `E` ≫ RAM. |
| Array-Prim | `O(V²)` (matrix) or `O(V)` (+ adjacency) | `O(V²)` | Dense graphs. |
| Heap-Prim lazy | `O(E)` heap entries | `O(E log V)` | Sparse, simple. |
| Heap-Prim eager | `O(V)` heap + `O(V)` index map | `O(E log V)` | Memory-tight sparse. |
| Fibonacci-Prim | `O(E)` | `O(E + V log V)` | Theoretical dense optimum. |
| Borůvka | `O(E)` | `O(E log V)` | Parallel/distributed. |

The recurring trade is **heap entries vs decrease-key bookkeeping**: lazy Prim trades `O(E)` extra heap space (stale entries) for simplicity; eager Prim spends an index map to cap entries at `O(V)`.

---

## 14. Comparison

| Algorithm | Time | Det.? | Practical niche |
|-----------|------|-------|-----------------|
| Kruskal | `O(E log V)` | yes | sparse, edge lists, external memory |
| Prim (heap) | `O(E log V)` | yes | general sparse |
| Prim (array) | `O(V²)` | yes | dense / complete graphs |
| Prim (Fibonacci) | `O(E + V log V)` | yes | dense, theory |
| Borůvka | `O(E log V)` | yes | parallel / GPU / distributed |
| Fredman–Tarjan | `O(E log* V)` | yes | theory |
| Chazelle | `O(E α(E,V))` | yes | best deterministic, theory |
| Karger–Klein–Tarjan | `O(E)` expected | no (randomized) | best known overall, theory |

In every real benchmark, the winner among the first five is decided by **density and input format**, not by the `O(...)` — the asymptotic classes are nearly identical and the constants and cache behavior decide.

---

## 15. Open Problems

- **Deterministic linear-time MST.** Is there an `O(E)` *deterministic* MST algorithm? Chazelle's `O(E α(E,V))` and Pettie–Ramachandran's *provably optimal* algorithm bracket the answer, but the optimal algorithm's running time equals an unknown decision-tree complexity. Whether that complexity is `Θ(E)` is **open** — arguably the most famous open question in classical algorithm design.
- **Optimal parallel MST.** Tight bounds for MST in the PRAM and MPC (massively-parallel-computation) models, especially round-complexity lower bounds for sparse graphs, remain active.
- **Fully dynamic MST.** Maintaining an MST under edge insertions *and* deletions: best deterministic is `O(√E)`-ish amortized via classic results; whether `polylog` per update is achievable deterministically is open (randomized polylog exists).
- **Soft-heap derandomization.** Can the randomized KKT linear time be matched deterministically without the inverse-Ackermann slack?

---

## 16. Summary

Formally the MST is the minimum-weight basis of the graphic matroid, and a single **exchange argument** proves the **cut property** (lightest edge across an `A`-free cut is safe) and **cycle property** (strictly heaviest cycle edge is excluded), which together make Kruskal, Prim, and Borůvka optimal; distinct weights force uniqueness. Complexity is `O(E log V)` for all three classic algorithms (Kruskal's non-sort work being `O(E α(V))`, effectively linear), `O(V²)` for array-Prim on dense graphs, and `O(E + V log V)` for Fibonacci-Prim. The research frontier is **Karger–Klein–Tarjan's `O(E)` expected-time randomized** algorithm (Borůvka contraction + edge sampling + linear-time `F`-heavy verification) and **Chazelle's `O(E α(E,V))` deterministic** algorithm via soft heaps, with **deterministic linear-time MST** still the headline open problem. In practice, density, input format, and cache behavior — not the asymptotics — pick the winner, and that winner is almost always plain Kruskal, array-Prim, or Borůvka.
