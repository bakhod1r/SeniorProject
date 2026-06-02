# Bipartite Matching — Middle Level

> **One-line summary:** Beyond Kuhn's `O(V·E)` augmenting-path search, the middle tier is about the *duality theorems* — Berge, König, Hall — that turn a matching into a min vertex cover, a max independent set, and a minimum DAG path cover, plus the **Hopcroft-Karp** algorithm that batches augmenting paths into `O(√V)` BFS-layered phases for an `O(E√V)` bound.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Berge's Theorem in Depth](#berges-theorem-in-depth)
3. [König's Theorem and Duality](#konigs-theorem-and-duality)
4. [Hall's Marriage Theorem](#halls-marriage-theorem)
5. [Comparison Table](#comparison-table)
6. [Hopcroft-Karp Algorithm](#hopcroft-karp-algorithm)
7. [Hopcroft-Karp Code (Go / Java / Python)](#hopcroft-karp-code)
8. [Recovering Min Vertex Cover & Max Independent Set](#recovering-min-vertex-cover--max-independent-set)
9. [Application: Minimum Path Cover of a DAG](#application-minimum-path-cover-of-a-dag)
10. [Reduction to Max-Flow](#reduction-to-max-flow)
11. [Performance Analysis](#performance-analysis)
12. [Pitfalls & Best Practices](#pitfalls--best-practices)
13. [Summary](#summary)

---

## Introduction

At the junior level you learned that Kuhn's algorithm repeatedly finds augmenting paths until none remain. That is correct and complete — but it is only the *operational* half of the story. The deeper, more interview-relevant and more design-relevant half is that **maximum bipartite matching is the dual of three other classic problems**. Once you have a maximum matching you can read off, in linear time, a minimum vertex cover, a maximum independent set, and (via a clever reduction) a minimum path cover of a DAG. These equivalences are the reason matching shows up in so many disguises.

This file covers:

- The three foundational theorems — **Berge** (augmenting paths), **König** (matching = vertex cover), **Hall** (when a perfect matching exists).
- **Hopcroft-Karp**, the `O(E√V)` algorithm that every serious implementation should use on large graphs.
- How to *recover* the dual objects (cover, independent set) from a finished matching.
- The reduction to **max-flow** (see sibling `16-max-flow-edmonds-karp-dinic`).

The weighted assignment problem and the **Hungarian algorithm** are deferred to `professional.md`; here everything is *cardinality* matching.

---

## Berge's Theorem in Depth

**Theorem (Berge, 1957).** A matching `M` in a graph `G` is maximum if and only if `G` contains no `M`-augmenting path.

**Why "only if" is easy.** If an augmenting path `P` exists, flip the edges of `P` (those in `M` leave, those not in `M` enter). `P` alternates and has free endpoints, so it has one more non-matching edge than matching edge; the symmetric difference `M ⊕ P` is a valid matching with `|M|+1` edges. So `M` was not maximum.

**Why "if" holds (sketch).** Suppose `M` is *not* maximum; let `M*` be a larger matching. Consider `M ⊕ M*` (edges in exactly one of them). Every vertex has degree ≤ 2 in this symmetric difference (≤1 from each matching), so the components are **paths and even cycles** that alternate between `M` and `M*` edges. Cycles have equal numbers of `M` and `M*` edges. Since `|M*| > |M|`, at least one component must have more `M*` edges than `M` edges — that component is a path starting and ending with `M*` edges, i.e. an **`M`-augmenting path**. (The full proof appears in `professional.md`.)

The practical consequence: an algorithm that keeps finding augmenting paths and stops only when none exists is *guaranteed* to terminate at the global maximum. No greedy heuristic; no local optimum trap.

### Alternating-tree visualization

```
Free L vertex u0  ──(not in M)──  v1  ──(in M)──  u1  ──(not in M)──  v2  ... ── free R vertex
        ^ start free                 matched edge                       ^ end free
```

Flipping turns the 2 unmatched edges into matched and the 1 matched into unmatched: net +1.

---

## König's Theorem and Duality

A **vertex cover** is a set `C` of vertices such that every edge has at least one endpoint in `C`. We want the *minimum* such set.

**Theorem (König, 1931).** In a **bipartite** graph, the size of a maximum matching equals the size of a minimum vertex cover:

```
|maximum matching|  =  |minimum vertex cover|
```

This is a special case of LP-duality / max-flow min-cut, but for bipartite graphs it is exact and combinatorial. It is *false* for general graphs (a triangle has matching 1 but needs cover 2).

**Why it matters.** Minimum vertex cover is **NP-hard in general graphs** but **polynomial in bipartite graphs** precisely because of König. So whenever you can model a problem as "cover all edges with fewest vertices in a bipartite setting," you can solve it via matching.

**Complement corollary (max independent set).** An independent set is the complement of a vertex cover. Hence in a bipartite graph:

```
|maximum independent set|  =  V  −  |minimum vertex cover|
                            =  V  −  |maximum matching|
```

This is the **König–Egerváry** relationship and it gives a polynomial max-independent-set algorithm for bipartite graphs (again NP-hard in general).

We show *how to recover* the actual cover/independent set in section 8.

---

## Hall's Marriage Theorem

**Theorem (Hall, 1935).** A bipartite graph with parts `L`, `R` has a matching that **saturates every vertex of `L`** if and only if for every subset `S ⊆ L`:

```
|N(S)|  >=  |S|
```

where `N(S)` is the set of right vertices adjacent to some vertex in `S` (the "neighborhood").

In plain words: *every group of left vertices must collectively have at least as many right neighbors as its own size.* If some subset of `k` left vertices shares only `k−1` neighbors, those `k` cannot all be matched — a **bottleneck**.

**Use.** Hall's condition tells you *whether* a perfect (or `L`-saturating) matching exists, and the violating set `S` (with `|N(S)| < |S|`) is the *certificate of impossibility*. The deficiency version states:

```
max matching size  =  |L|  −  max_{S ⊆ L} ( |S| − |N(S)| )
```

The term `max(|S| − |N(S)|)` is the **deficiency**: the number of left vertices that *must* go unmatched.

**Connection to König.** Hall's theorem is provably equivalent to König's theorem; each can be derived from the other. Both are corollaries of the max-flow min-cut theorem applied to the flow reduction in section 10.

---

## Comparison Table

| Aspect | Kuhn (DFS aug.) | Hopcroft-Karp | Max-flow reduction (Dinic) | Hungarian (weighted) |
|--------|-----------------|---------------|----------------------------|----------------------|
| Solves | Max cardinality | Max cardinality | Max cardinality | Min-cost assignment |
| Time | `O(V·E)` | `O(E·√V)` | `O(E·√V)` on unit caps | `O(V³)` |
| Space | `O(V+E)` | `O(V+E)` | `O(V+E)` | `O(V²)` |
| Search unit | one path / DFS | many shortest paths / phase | blocking flow / phase | dual prices |
| Code size | ~25 lines | ~60 lines | flow lib + edges | ~70 lines |
| Best for | small/medium graphs, clarity | large/dense graphs | reuse of flow infra | costs/weights |
| Handles weights? | No | No | No (only cardinality) | Yes |
| Recovers cover? | Yes (alt-BFS) | Yes | Yes (min-cut) | n/a |

Rule of thumb: **Kuhn for readability and `V·E ≲ 10⁸`; Hopcroft-Karp when the graph is large or dense; Hungarian only when weights are involved.**

---

## Hopcroft-Karp Algorithm

Kuhn finds *one* augmenting path per DFS. **Hopcroft-Karp (1973)** finds a **maximal set of vertex-disjoint shortest augmenting paths simultaneously**, in *phases*:

1. **BFS phase.** From all free left vertices at once, BFS along alternating edges, computing the *distance layer* of each left vertex. This finds the length of the shortest augmenting path. If no free right vertex is reachable, stop — the matching is maximum.
2. **DFS phase.** Greedily find a maximal set of vertex-disjoint augmenting paths of exactly that shortest length, augmenting each.
3. Repeat. Each phase strictly increases the shortest-augmenting-path length.

**The magic:** the shortest augmenting path length strictly increases each phase, and one can prove the number of phases is `O(√V)`. Each phase is `O(E)` (one BFS + one DFS sweep). Hence total `O(E√V)`. The phase-count proof appears in `professional.md`.

```
Phase structure:
  while BFS(finds an augmenting layering):
      for each free left u:
          DFS(u) augments along a shortest path if one is still vertex-disjoint
```

Intuition for `√V`: after `√V` phases the shortest augmenting path is longer than `√V`, but augmenting paths are vertex-disjoint, so there can be at most `√V` more of them — bounding the remaining work.

---

## Hopcroft-Karp Code

Convention: left `1..nL`, right `1..nR`. `matchL[u]` / `matchR[v]` hold partners or `0` (we use `0` as NIL and `INF` as the BFS sentinel). `dist[u]` is the BFS layer of a left vertex.

```go
package main

import "fmt"

const INF = 1 << 30

type HopcroftKarp struct {
	nL, nR int
	adj    [][]int // adj[u] for u in 1..nL, lists right neighbors
	matchL []int   // matchL[u] = right partner of left u, or 0
	matchR []int   // matchR[v] = left partner of right v, or 0
	dist   []int
}

func NewHK(nL, nR int) *HopcroftKarp {
	h := &HopcroftKarp{nL: nL, nR: nR}
	h.adj = make([][]int, nL+1)
	h.matchL = make([]int, nL+1)
	h.matchR = make([]int, nR+1)
	h.dist = make([]int, nL+1)
	return h
}

func (h *HopcroftKarp) AddEdge(u, v int) { h.adj[u] = append(h.adj[u], v) }

func (h *HopcroftKarp) bfs() bool {
	queue := []int{}
	for u := 1; u <= h.nL; u++ {
		if h.matchL[u] == 0 {
			h.dist[u] = 0
			queue = append(queue, u)
		} else {
			h.dist[u] = INF
		}
	}
	found := false
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		for _, v := range h.adj[u] {
			w := h.matchR[v] // left vertex currently on v (0 if free)
			if w == 0 {
				found = true // reached a free right vertex
			} else if h.dist[w] == INF {
				h.dist[w] = h.dist[u] + 1
				queue = append(queue, w)
			}
		}
	}
	return found
}

func (h *HopcroftKarp) dfs(u int) bool {
	for _, v := range h.adj[u] {
		w := h.matchR[v]
		if w == 0 || (h.dist[w] == h.dist[u]+1 && h.dfs(w)) {
			h.matchL[u] = v
			h.matchR[v] = u
			return true
		}
	}
	h.dist[u] = INF // dead end this phase
	return false
}

func (h *HopcroftKarp) MaxMatching() int {
	matching := 0
	for h.bfs() {
		for u := 1; u <= h.nL; u++ {
			if h.matchL[u] == 0 && h.dfs(u) {
				matching++
			}
		}
	}
	return matching
}

func main() {
	h := NewHK(3, 3)
	h.AddEdge(1, 1)
	h.AddEdge(1, 2)
	h.AddEdge(2, 1)
	h.AddEdge(3, 2)
	h.AddEdge(3, 3)
	fmt.Println("Max matching:", h.MaxMatching()) // 3
}
```

```java
import java.util.*;

public class HopcroftKarp {
    static final int INF = Integer.MAX_VALUE;
    private final int nL, nR;
    private final List<List<Integer>> adj;
    private final int[] matchL, matchR, dist;

    public HopcroftKarp(int nL, int nR) {
        this.nL = nL; this.nR = nR;
        adj = new ArrayList<>();
        for (int i = 0; i <= nL; i++) adj.add(new ArrayList<>());
        matchL = new int[nL + 1];
        matchR = new int[nR + 1];
        dist = new int[nL + 1];
    }

    public void addEdge(int u, int v) { adj.get(u).add(v); }

    private boolean bfs() {
        Deque<Integer> queue = new ArrayDeque<>();
        for (int u = 1; u <= nL; u++) {
            if (matchL[u] == 0) { dist[u] = 0; queue.add(u); }
            else dist[u] = INF;
        }
        boolean found = false;
        while (!queue.isEmpty()) {
            int u = queue.poll();
            for (int v : adj.get(u)) {
                int w = matchR[v];
                if (w == 0) found = true;
                else if (dist[w] == INF) { dist[w] = dist[u] + 1; queue.add(w); }
            }
        }
        return found;
    }

    private boolean dfs(int u) {
        for (int v : adj.get(u)) {
            int w = matchR[v];
            if (w == 0 || (dist[w] == dist[u] + 1 && dfs(w))) {
                matchL[u] = v; matchR[v] = u;
                return true;
            }
        }
        dist[u] = INF;
        return false;
    }

    public int maxMatching() {
        int matching = 0;
        while (bfs()) {
            for (int u = 1; u <= nL; u++)
                if (matchL[u] == 0 && dfs(u)) matching++;
        }
        return matching;
    }

    public static void main(String[] args) {
        HopcroftKarp h = new HopcroftKarp(3, 3);
        h.addEdge(1, 1); h.addEdge(1, 2);
        h.addEdge(2, 1);
        h.addEdge(3, 2); h.addEdge(3, 3);
        System.out.println("Max matching: " + h.maxMatching()); // 3
    }
}
```

```python
import sys
from collections import deque

INF = float("inf")

class HopcroftKarp:
    def __init__(self, n_left, n_right):
        self.n_left = n_left
        self.n_right = n_right
        self.adj = [[] for _ in range(n_left + 1)]
        self.match_l = [0] * (n_left + 1)   # left u -> right partner, 0 = NIL
        self.match_r = [0] * (n_right + 1)  # right v -> left partner, 0 = NIL
        self.dist = [0] * (n_left + 1)

    def add_edge(self, u, v):
        self.adj[u].append(v)

    def _bfs(self):
        queue = deque()
        for u in range(1, self.n_left + 1):
            if self.match_l[u] == 0:
                self.dist[u] = 0
                queue.append(u)
            else:
                self.dist[u] = INF
        found = False
        while queue:
            u = queue.popleft()
            for v in self.adj[u]:
                w = self.match_r[v]
                if w == 0:
                    found = True
                elif self.dist[w] == INF:
                    self.dist[w] = self.dist[u] + 1
                    queue.append(w)
        return found

    def _dfs(self, u):
        for v in self.adj[u]:
            w = self.match_r[v]
            if w == 0 or (self.dist[w] == self.dist[u] + 1 and self._dfs(w)):
                self.match_l[u] = v
                self.match_r[v] = u
                return True
        self.dist[u] = INF
        return False

    def max_matching(self):
        matching = 0
        while self._bfs():
            for u in range(1, self.n_left + 1):
                if self.match_l[u] == 0 and self._dfs(u):
                    matching += 1
        return matching

if __name__ == "__main__":
    sys.setrecursionlimit(10**6)
    h = HopcroftKarp(3, 3)
    h.add_edge(1, 1); h.add_edge(1, 2)
    h.add_edge(2, 1)
    h.add_edge(3, 2); h.add_edge(3, 3)
    print("Max matching:", h.max_matching())  # 3
```

---

## Recovering Min Vertex Cover & Max Independent Set

After computing a **maximum matching**, recover the **minimum vertex cover** with this construction (the algorithmic proof of König's theorem):

1. Let `U` be the set of **unmatched left vertices**.
2. Run an alternating BFS/DFS from `U`: follow **non-matching edges** from left→right and **matching edges** from right→left. Mark every vertex you reach as *visited (Z)*.
3. The minimum vertex cover is:

```
C  =  (left vertices NOT in Z)  ∪  (right vertices IN Z)
```

4. The maximum independent set is the complement: `(left in Z) ∪ (right not in Z)`.

**Why it works.** No edge can have its left end in `Z\C`... (full justification in `professional.md`). The key facts: `|C| = |M|` (König holds), and `C` covers every edge.

```python
def min_vertex_cover(n_left, n_right, adj, match_l, match_r):
    # match_l, match_r as produced by Hopcroft-Karp (1-indexed, 0=NIL)
    visited_l = [False] * (n_left + 1)
    visited_r = [False] * (n_right + 1)

    def dfs(u):
        visited_l[u] = True
        for v in adj[u]:
            if not visited_r[v] and match_l[u] != v:  # non-matching edge L->R
                visited_r[v] = True
                w = match_r[v]                          # matching edge R->L
                if w != 0 and not visited_l[w]:
                    dfs(w)

    for u in range(1, n_left + 1):
        if match_l[u] == 0:   # start from unmatched left vertices
            dfs(u)

    cover_left  = [u for u in range(1, n_left + 1)  if not visited_l[u]]
    cover_right = [v for v in range(1, n_right + 1) if visited_r[v]]
    return cover_left, cover_right
```

This recovers an optimal cover in `O(V+E)` after the matching.

---

## Application: Minimum Path Cover of a DAG

A **minimum path cover** is the smallest number of vertex-disjoint directed paths that cover every vertex of a DAG. It maps directly to matching:

1. Split each DAG vertex `x` into a left copy `x_out` and a right copy `x_in`.
2. For each DAG edge `x → y`, add bipartite edge `x_out — y_in`.
3. Compute the **maximum bipartite matching** `M`.

Then:

```
minimum path cover  =  N  −  |M|
```

where `N` is the number of DAG vertices. Each matched edge "merges" two path fragments into one, reducing the path count by one. This is the classic *Dilworth / König* application and a frequent interview twist (e.g. "minimum number of taxis," "minimum number of platforms as chains").

---

## Reduction to Max-Flow

Maximum bipartite matching is a special **unit-capacity max-flow** problem:

```
        cap 1            cap 1              cap 1
 source ─────► each L ─────────► each R ─────────► sink
            (one per left)   (the bipartite edges)  (one per right)
```

- Add a **source `s`** with an edge `s → u` (capacity 1) to each left vertex.
- Keep each bipartite edge `u → v` with capacity 1.
- Add a **sink `t`** with an edge `v → t` (capacity 1) from each right vertex.
- The **max-flow value equals the maximum matching size.** Each unit of flow `s→u→v→t` is one matched pair.

Running **Dinic's algorithm** (sibling `16-max-flow-edmonds-karp-dinic`) on this unit-capacity network achieves `O(E√V)` — the same bound as Hopcroft-Karp, which is in fact Dinic specialized to this network. The **min-cut** of this network gives the **minimum vertex cover** (König via max-flow min-cut). For the *weighted* assignment problem use **min-cost max-flow** (sibling `18-min-cost-max-flow`).

---

## Performance Analysis

- **Kuhn `O(V·E)`:** `V` DFS launches, each up to `O(E)`. With greedy pre-matching the constant drops sharply on random graphs.
- **Hopcroft-Karp `O(E√V)`:** `O(√V)` phases × `O(E)` per phase. On dense graphs with `E = Θ(V²)` this is `O(V^2.5)` versus Kuhn's `O(V³)` — a full `√V` factor.
- **Memory:** all variants are `O(V+E)` except Hungarian (`O(V²)` cost matrix).
- **Constant factors:** Kuhn's recursion is cheap; Hopcroft-Karp's BFS adds queue overhead but pays off past a few thousand vertices.
- **Cache behavior:** adjacency lists give poor locality; CSR (compressed sparse row) layout improves both algorithms measurably (see `senior.md`).

Empirically, on a random bipartite graph with `V = 10⁴` per side and `E = 10⁶`, Hopcroft-Karp typically finishes in 5–15 phases — far below the `√V = 100` worst case — and beats Kuhn by an order of magnitude.

---

## Worked Trace: Hopcroft-Karp Phases

Take the graph: `L = {1,2,3,4}`, `R = {1,2,3,4}` with edges
`1-1, 1-2, 2-1, 3-2, 3-3, 4-3, 4-4`.

**Phase 1 — BFS layering.** All four left vertices are free (`dist = 0`). BFS finds that every left vertex reaches a free right vertex directly, so the shortest augmenting path has length 1. The DFS phase then greedily augments vertex-disjoint length-1 paths:

- `1 → R1` (free): match. `matchL[1]=1`.
- `2 → R1` taken by 1, but `2`'s layer only allows length-1 here; in this phase `2` tries `R1` (now owned) — no free target at distance 1 left for `2`, so `2` waits.
- `3 → R2` (free): match. `matchL[3]=2`.
- `4 → R3` (free): match. `matchL[4]=3`.

After phase 1: matching `{1-1, 3-2, 4-3}`, size 3. Free left: `{2}`.

**Phase 2 — BFS layering.** Only `2` is free (`dist[2]=0`). BFS: `2 → R1` (owned by 1) → `1` (`dist[1]=1`) → `1`'s edges `R1`(used),`R2`(owned by 3) → `3` (`dist[3]=2`) → `3`'s edges `R2`(used),`R3`(owned by 4) → `4` (`dist[4]=3`) → `4`'s edges `R3`(used),`R4`(**free!**). Shortest augmenting path length = 7 edges. DFS augments along `2 →R1→ 1 →R2→ 3 →R3→ 4 →R4`, flipping every edge:

- `matchL[2]=1, matchL[1]=2, matchL[3]=3, matchL[4]=4`.

After phase 2: matching `{2-1, 1-2, 3-3, 4-4}`, size 4 — **perfect**.

**Phase 3 — BFS** finds no free left vertex reaching a free right vertex → stop. Total phases: 3 (well under `√V = 2`-ish, illustrating the bound is a worst-case ceiling). Notice the second phase did *one long augmenting path* in a single DFS, which is exactly the layered structure Hopcroft-Karp exploits.

---

## Pitfalls & Best Practices

- **Use `0`/`NIL` consistently** in Hopcroft-Karp; mixing `-1` and `0` sentinels causes index bugs.
- **The BFS `dist` layering and the DFS guard `dist[w] == dist[u]+1`** are what restrict augmentation to *shortest* paths — do not drop the guard, or you lose the `√V` bound.
- **`dist[u] = INF` on DFS dead-end** prunes the rest of the phase; keep it.
- **Bipartiteness check still required** — Hopcroft-Karp and the flow reduction are bipartite-only.
- **Don't reach for Hungarian** unless weights exist; for pure cardinality it is slower and more complex.
- **Recover the cover via the alternating-reachability rule**, not by guessing; the rule is provably optimal.

---

## Quick Decision Guide

When you face a problem, this checklist routes you to the right tool:

1. **Are the two sides clearly defined and all edges cross between them?** If not, 2-color first; if it has an odd cycle, you need general matching (Blossom), not this topic.
2. **Do pairs have costs/weights?** Yes → Hungarian (`O(V³)`) or min-cost flow (sibling `18`). No → continue.
3. **Is the graph large or dense (`V·E` too big)?** Yes → Hopcroft-Karp. No → Kuhn for clarity.
4. **Do you actually want a cover, independent set, or path cover?** Compute the matching, then read off the dual via the recipes above.
5. **Is the question "does a complete assignment exist"?** Use Hall's condition; if it fails, the deficient set is your explanation.

---

## Summary

- **Berge:** maximum ⇔ no augmenting path. **König:** max matching = min vertex cover (bipartite). **Hall:** `L`-saturating matching ⇔ `|N(S)| ≥ |S|` for all `S`.
- **Independent set:** `V − max matching` in bipartite graphs.
- **Hopcroft-Karp** batches shortest augmenting paths into `O(√V)` phases for `O(E√V)` — the production choice for large graphs.
- **Min vertex cover / max independent set** are recovered in `O(V+E)` via alternating reachability from unmatched left vertices.
- **DAG minimum path cover** = `N − max matching` via vertex-splitting.
- Matching = unit-capacity **max-flow**; weighted matching = **min-cost flow** (sibling `18`).
