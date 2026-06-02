# Heavy-Light Decomposition — Mathematical Foundations and Complexity Theory

## Table of Contents
1. [Formal Definition](#1-formal-definition)
2. [The O(log N) Light-Edge Bound — Proof](#2-the-olog-n-light-edge-bound--proof)
3. [Path-Query Complexity O(log² N) — Proof](#3-path-query-complexity-olog-n--proof)
4. [ASCII Tree With Chains, and a Worked Path-Query Trace](#4-ascii-tree-with-chains-and-a-worked-path-query-trace)
5. [Reference Implementation (Go / Java / Python)](#5-reference-implementation-go--java--python)
6. [Achieving O(log N) with the Right Base Structure](#6-achieving-olog-n-with-the-right-base-structure)
7. [Comparison with Link-Cut Trees and Centroid Decomposition](#7-comparison-with-link-cut-trees-and-centroid-decomposition)
8. [Cache Behavior](#8-cache-behavior)
9. [Average-Case Analysis](#9-average-case-analysis)
10. [Space-Time Trade-offs](#10-space-time-trade-offs)
11. [Comparison Table (asymptotics + constants)](#11-comparison-table-asymptotics--constants)
12. [Open Problems and Research Directions](#12-open-problems-and-research-directions)
13. [Summary](#13-summary)

---

## 1. Formal Definition

Let `T = (V, E)` be a tree with `|V| = N`, rooted at `r ∈ V`. For `v ∈ V` let `ch(v)` denote the set of children of `v` and `size(v) = |{u : u in subtree(v)}|` the number of nodes in the subtree rooted at `v` (with `size(v) = 1` for a leaf and `size(r) = N`).

**Definition 1.1 (Heavy child).** For a non-leaf node `v`,
```
heavy(v) = argmax_{c ∈ ch(v)} size(c),
```
ties broken by a fixed rule (e.g. smallest index). For a leaf, `heavy(v)` is undefined (`⊥`).

**Definition 1.2 (Heavy / light edge).** An edge `(v, c)` with `c ∈ ch(v)` is **heavy** iff `c = heavy(v)`; otherwise it is **light**. Each non-leaf node contributes exactly one heavy edge, so there are at most `N − 1` heavy edges, and every node has **at most one** incident heavy edge to a child.

**Definition 1.3 (Heavy path / chain).** Consider the spanning subgraph `H = (V, E_heavy)` of heavy edges. Since each node has at most one heavy child-edge and at most one heavy parent-edge (the edge to its parent is heavy iff the node *is* its parent's heavy child), `H` is a disjoint union of simple vertical **paths** called **chains**. The top of a chain is its **head**: a node that is either the root or reached from its parent by a light edge.

**Definition 1.4 (Linearization).** Let `dfs` be a depth-first traversal from `r` that, at each node, recurses into `heavy(v)` **before** any light child. Let `pos : V → {0, …, N−1}` assign each node its discovery index in this traversal. Define `base[pos(v)] = φ(v)` where `φ` is the value associated with `v` (a vertex value, or the value of the edge `(parent(v), v)` for the edge-weighted variant; `base[pos(r)] = e`, the monoid identity, in the edge variant).

**Proposition 1.5 (Two contiguity properties).**
- **(Chain contiguity.)** Every chain with head `h` and `k` nodes occupies the contiguous block `[pos(h), pos(h)+k−1]`.
- **(Subtree contiguity.)** For every `v`, `subtree(v)` occupies the contiguous block `[pos(v), pos(v)+size(v)−1]`.

*Proof of subtree contiguity.* A DFS discovers `v` and then, before backtracking past `v`, discovers exactly the `size(v)−1` other nodes of `subtree(v)` with strictly larger indices; no node outside `subtree(v)` is discovered in between. Hence the indices form `[pos(v), pos(v)+size(v)−1]`. (This holds for *any* DFS order, heavy-first or not.)

*Proof of chain contiguity.* By induction down the chain. The head `h` gets index `pos(h)`. Because the traversal recurses into `heavy(h)` first, `pos(heavy(h)) = pos(h)+1`. By the same argument `pos(heavy^j(h)) = pos(h)+j` for each successive heavy descendant, until the chain's bottom leaf. The light subtrees hanging off the chain are discovered *after* the entire heavy descent (since heavy-first means light children wait), so they receive indices strictly greater than the chain's last index. Hence the chain is exactly `[pos(h), pos(h)+k−1]`. ∎

These two facts are the entire structural payload of HLD; everything below is complexity accounting.

---

## 2. The O(log N) Light-Edge Bound — Proof

This is the load-bearing theorem.

**Lemma 2.1 (Subtree halving across a light edge).** If `(v, c)` is a light edge (i.e. `c ∈ ch(v)` and `c ≠ heavy(v)`), then
```
size(c) ≤ size(v) / 2.
```

*Proof.* Let `hc = heavy(v)`. By Definition 1.1, `size(c) ≤ size(hc)`. The subtrees of distinct children of `v` are pairwise disjoint and contained in `subtree(v) \ {v}`, so in particular
```
size(c) + size(hc) ≤ size(v).
```
Combining `size(c) ≤ size(hc)` with the displayed inequality gives `2·size(c) ≤ size(c)+size(hc) ≤ size(v)`, i.e. `size(c) ≤ size(v)/2`. ∎

**Theorem 2.2 (Light-edge bound on a root path).** For any node `u`, the number of light edges on the path from the root `r` to `u` is at most `⌊log₂ N⌋`.

*Proof.* Let the path from `r` to `u` be `r = v₀, v₁, …, v_m = u`. Consider the subsequence of indices `i` where edge `(v_{i-1}, v_i)` is **light**; call the descended-into endpoints `c₁, c₂, …, c_L` in order of increasing depth, where `L` is the number of light edges on the path. Set `c₀ = r`. Each light step strictly decreases the subtree size by at least a factor of 2 (Lemma 2.1 applied at `v_{i-1} = parent(c_j)`), while heavy steps never increase it. Therefore
```
size(c_L) ≤ size(c_{L-1})/2 ≤ … ≤ size(c_0)/2^L = N / 2^L.
```
Since `size(c_L) ≥ 1`, we get `1 ≤ N/2^L`, hence `2^L ≤ N`, hence `L ≤ log₂ N`, i.e. `L ≤ ⌊log₂ N⌋` because `L` is an integer. ∎

**Corollary 2.3 (Chains on a path).** A root-to-node path enters at most `⌊log₂ N⌋ + 1` distinct chains (one starting chain plus one new chain per light edge). A path between arbitrary `u, v` decomposes at `w = LCA(u, v)` into two root-paths, so it crosses at most `2⌊log₂ N⌋` light edges and touches at most `2⌊log₂ N⌋ + 2 = O(log N)` chains.

**Remark 2.4 (Tightness).** The bound is tight up to the constant. Consider a "caterpillar": a spine where each spine node additionally has a single extra leaf whose subtree is just large enough to keep flipping which child is heavy — more sharply, a balanced construction where every step down toward a specific leaf is forced to be light yields `Θ(log N)` light edges on that root path. So `O(log N)` chains per path cannot be improved in the worst case.

---

## 3. Path-Query Complexity O(log² N) — Proof

**Setup.** The base structure over `base[0..N−1]` is a Segment Tree supporting `query(l, r)` (and `update`) over a monoid `(M, ⊕, e)` in `O(log N)` time. A `path(u, v)` query runs the chain loop, emitting one `query(pos(head(x)), pos(x))` per chain segment plus a final same-chain segment.

**Theorem 3.1.** `path(u, v)` runs in `O(log² N)` time.

*Proof.* By Corollary 2.3 the chain loop emits `O(log N)` segment-tree range queries (one per chain touched). Each range query costs `O(log N)` on a Segment Tree of `N` leaves. The chain-loop bookkeeping (comparisons, the jump `u ← parent(head(u))`) is `O(1)` per iteration and there are `O(log N)` iterations. Total:
```
O(log N) segments × O(log N) per segment + O(log N) bookkeeping = O(log² N).
```
∎

**Why the two logs are independent.** The first `log` is *structural* — it counts how many contiguous intervals the path decomposes into, a property of the tree and the heavy/light rule (Theorem 2.2). The second `log` is *the base structure's* per-interval cost. They multiply because each of the `O(log N)` intervals is answered by an independent `O(log N)` Segment Tree query. Replacing the Segment Tree with a structure whose per-interval cost is `f(N)` changes the path-query cost to `O(log N · f(N))`:
- Fenwick (sum): `f = O(log N)` → still `O(log² N)`, smaller constant.
- Merge-sort tree / wavelet (rank queries "how many ≤ x"): `f = O(log N)` per level but the query itself is `O(log N)` internally → `O(log³ N)` overall for "count ≤ x on path."

**Subtree queries.** A subtree is a *single* interval (Proposition 1.5), so a subtree query is exactly one Segment Tree operation: `O(log N)`. No `log²`.

**Update symmetry.** A path *update* (point or, with a lazy Segment Tree, range) follows the identical decomposition: `O(log N)` intervals × `O(log N)` lazy update each = `O(log² N)`. A subtree update is one lazy range update: `O(log N)`.

---

## 4. ASCII Tree With Chains, and a Worked Path-Query Trace

To make the abstract proofs concrete, here is a fixed `N = 11` tree (root `0`) and its full decomposition. Children of each node are written left-to-right; the **heavy** child (largest subtree, ties → smaller index) is drawn with a double line `═══`, light children with single lines `───`.

```
                         ┌─────────┐
                         │  0  s=11│            size annotations: s = size(v)
                         └────┬────┘
            ═══════════════════╪════════════════
            ║                  │                │
       ┌────┴───┐        ┌─────┴──┐       ┌──────┴─┐
       │ 1  s=4 │        │ 2  s=1 │       │ 3  s=4 │
       └───┬────┘        └────────┘       └───┬────┘
       ═════╪═══════                      ═════╪══════
       ║          │                       ║         │
   ┌───┴──┐   ┌───┴──┐                ┌───┴──┐  (none)
   │4  s=2│   │5  s=2│                │6  s=3│
   └──┬───┘   └──┬───┘                └──┬───┘
   ════╪      ════╪                   ════╪═════
   ║          ║                       ║        │
 ┌─┴────┐  ┌──┴───┐                ┌──┴───┐ ┌──┴───┐
 │8 s=1 │  │7 s=1 │                │9 s=1 │ │10 s=1│
 └──────┘  └──────┘                └──────┘ └──────┘
```

**Heavy/light decisions (Definition 1.1–1.2).** Node `0` has children `{1(s4), 2(s1), 3(s4)}`; the largest is `1` (tie with `3`, broken to smaller index) → heavy edge `0═1`, light edges `0─2`, `0─3`. Node `1`: children `{4(s2), 5(s2)}` → heavy `1═4` (tie → 4), light `1─5`. Node `4`: only child `8` → heavy `4═8`. Node `3`: only child `6` → heavy `3═6`. Node `6`: children `{9(s1),10(s1)}` → heavy `6═9`, light `6─10`. Node `5`: only child `7` → heavy `5═7`.

**Chains (Definition 1.3) and the heavy-first DFS linearization (Definition 1.4).** Recursing heavy-child-first from `0` discovers nodes in this `pos` order:

| pos | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|-----|---|---|---|---|---|---|---|---|---|---|----|
| node `v` | 0 | 1 | 4 | 8 | 5 | 7 | 2 | 3 | 6 | 9 | 10 |
| value `φ(v)` | 5 | 3 | 2 | 7 | 4 | 9 | 8 | 1 | 6 | 2 | 6 |

Reading off the contiguous heavy runs (Proposition 1.5, chain contiguity):

| Chain (head → bottom) | nodes | `pos` block | color in animation |
|-----------------------|-------|-------------|--------------------|
| A: `0 ═ 1 ═ 4 ═ 8` | 0,1,4,8 | `[0..3]` | green |
| B: `5 ═ 7` | 5,7 | `[4..5]` | blue |
| C: `2` | 2 | `[6..6]` | purple |
| D: `3 ═ 6 ═ 9` | 3,6,9 | `[7..9]` | orange |
| E: `10` | 10 | `[10..10]` | pink |

Notice chain A's heavy descent `0→1→4→8` occupies **consecutive** positions `0,1,2,3`; the light subtree at `5` (chain B) only starts at `pos 4`, *after* the entire heavy descent, exactly as the chain-contiguity proof predicts.

### 4.1 Worked trace: `pathSum(8, 9)` (vertex values, include LCA)

Path in the tree is `8 → 4 → 1 → 0 → 3 → 6 → 9`; the LCA is `0`. Depths: `depth = [0,1,1,1,2,2,2,3,3,3,3]` so `head` depths matter for which side lifts. The loop always lifts the endpoint whose **chain head is deeper**.

```
state: u=8 (head 0, headDepth 0), v=9 (head 3, headDepth 1)
```

| Step | u | v | head[u] | head[v] | headDepth[u] | headDepth[v] | lift side | segment emitted (pos block → nodes) | partial sum |
|------|---|---|---------|---------|--------------|--------------|-----------|--------------------------------------|-------------|
| 1 | 8 | 9 | 0 | 3 | 0 | 1 | v deeper → query v's chain | `query[pos[head9]=7 .. pos[9]=9]` = nodes 3,6,9 = 1+6+2 | **9** |
|   |   |   |         |         |              |              | jump `v = parent(head[9]) = parent(3) = 0` | | |
| 2 | 8 | 0 | 0 | 0 | 0 | 0 | heads equal → exit loop | — | 9 |
| final | — | — | — | — | — | — | same chain, include LCA | order so `pos[u]≤pos[v]`: `u=0(pos0), v=8(pos3)` → `query[0..3]` = nodes 0,1,4,8 = 5+3+2+7 | **9 + 17 = 26** |

**Verification by hand:** path nodes `{8,4,1,0,3,6,9}` have values `7+2+3+5+1+6+2 = 26`. ✓ Two segment-tree range queries answered the whole path — that is the `O(log N)` chain count (here 2) times the `O(log N)` per-range cost.

### 4.2 Worked trace: `maxEdge(8, 7)` (edge values, **skip** LCA)

Edge variant: store the edge `(parent(c), c)` at `pos[c]`; `pos[root]` holds the monoid identity (`−∞` for max). Suppose edge weights are `w(0,1)=4, w(1,4)=7, w(4,8)=2, w(1,5)=5, w(5,7)=9`. Path `8 → 4 → 1 → 5 → 7`, LCA = `1`.

| Step | u | v | head[u] | head[v] | lift | segment (pos block, edges only) | running max |
|------|---|---|---------|---------|------|----------------------------------|-------------|
| 1 | 8 | 7 | 0 | 5 | head[7]=5 (depth 2) deeper than head[8]=0 (depth 0) → lift v | `query[pos[5]=4 .. pos[7]=5]` covers edges `(1,5)=5,(5,7)=9` → 9 | **9** |
|   |   |   |   |   | jump `v = parent(5) = 1` | | |
| 2 | 8 | 1 | 0 | 0 | heads equal → exit | — | 9 |
| final | — | — | — | — | same chain, **skip LCA=1** | order `u=1(pos1), v=8(pos3)`; edges only ⇒ `query[pos[1]+1 .. pos[8]] = [2..3]` covers `(1,4)=7,(4,8)=2` → 7 | **max(9,7)=9** |

The `[pos[lca]+1 .. pos[deeper]]` lower bound is the single line of code that separates the edge variant from the vertex variant; if `u == v` after ordering, the path has zero edges and we return the identity `−∞`. The hand-checked answer — `max{4? no, edges on path are (4,8)=2,(1,4)=7,(1,5)=5,(5,7)=9} = 9` — matches.

---

## 5. Reference Implementation (Go / Java / Python)

A complete, self-contained HLD over a **sum** Segment Tree, with `pathSum`, `subtreeSum`, point `update`, and `LCA`-via-HLD. Vertex-value semantics (the final same-chain segment **includes** the LCA). The build is the two iterative DFS passes from Definition 1.4; the recurrence used in §3 is exactly the `path` loop here.

### Go

```go
package main

import "fmt"

type SegTree struct {
	n int
	t []int64 // 1-indexed, size 2n iterative
}

func NewSegTree(base []int64) *SegTree {
	n := len(base)
	s := &SegTree{n: n, t: make([]int64, 2*n)}
	copy(s.t[n:], base)
	for i := n - 1; i >= 1; i-- {
		s.t[i] = s.t[2*i] + s.t[2*i+1]
	}
	return s
}
func (s *SegTree) Update(i int, val int64) {
	i += s.n
	s.t[i] = val
	for i >>= 1; i >= 1; i >>= 1 {
		s.t[i] = s.t[2*i] + s.t[2*i+1]
	}
}
func (s *SegTree) Query(l, r int) int64 { // inclusive [l, r]
	var res int64
	for l, r = l+s.n, r+s.n+1; l < r; l, r = l>>1, r>>1 {
		if l&1 == 1 {
			res += s.t[l]
			l++
		}
		if r&1 == 1 {
			r--
			res += s.t[r]
		}
	}
	return res
}

type HLD struct {
	n                                int
	parent, depth, size, heavy, head, pos, nodeAtPos []int
	seg                              *SegTree
	adj                              [][]int
}

func NewHLD(n, root int, adj [][]int, value []int64) *HLD {
	h := &HLD{n: n, adj: adj,
		parent: make([]int, n), depth: make([]int, n), size: make([]int, n),
		heavy: make([]int, n), head: make([]int, n), pos: make([]int, n),
		nodeAtPos: make([]int, n)}
	for i := range h.heavy {
		h.heavy[i] = -1
	}
	// Pass 1: iterative DFS for order, parent, depth; then sizes + heavy bottom-up.
	order := make([]int, 0, n)
	st := []int{root}
	vis := make([]bool, n)
	vis[root] = true
	h.parent[root] = -1
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		order = append(order, u)
		for _, w := range adj[u] {
			if !vis[w] {
				vis[w] = true
				h.parent[w] = u
				h.depth[w] = h.depth[u] + 1
				st = append(st, w)
			}
		}
	}
	for i := len(order) - 1; i >= 0; i-- {
		u := order[i]
		h.size[u] = 1
		best := 0
		for _, w := range adj[u] {
			if w != h.parent[u] {
				h.size[u] += h.size[w]
				if h.size[w] > best {
					best = h.size[w]
					h.heavy[u] = w
				}
			}
		}
	}
	// Pass 2: heads + pos, heavy child first.
	cur := 0
	type fr struct{ node, hd int }
	s2 := []fr{{root, root}}
	for len(s2) > 0 {
		f := s2[len(s2)-1]
		s2 = s2[:len(s2)-1]
		u := f.node
		h.head[u] = f.hd
		h.pos[u] = cur
		h.nodeAtPos[cur] = u
		cur++
		for _, w := range adj[u] {
			if w != h.parent[u] && w != h.heavy[u] {
				s2 = append(s2, fr{w, w})
			}
		}
		if h.heavy[u] != -1 {
			s2 = append(s2, fr{h.heavy[u], f.hd})
		}
	}
	base := make([]int64, n)
	for v := 0; v < n; v++ {
		base[h.pos[v]] = value[v]
	}
	h.seg = NewSegTree(base)
	return h
}

func (h *HLD) Update(v int, val int64) { h.seg.Update(h.pos[v], val) }

func (h *HLD) PathSum(u, v int) int64 { // vertex values, include LCA
	var res int64
	for h.head[u] != h.head[v] {
		if h.depth[h.head[u]] < h.depth[h.head[v]] {
			u, v = v, u
		}
		res += h.seg.Query(h.pos[h.head[u]], h.pos[u])
		u = h.parent[h.head[u]]
	}
	if h.depth[u] > h.depth[v] {
		u, v = v, u
	}
	res += h.seg.Query(h.pos[u], h.pos[v]) // include LCA = u
	return res
}

func (h *HLD) SubtreeSum(v int) int64 {
	return h.seg.Query(h.pos[v], h.pos[v]+h.size[v]-1)
}

func (h *HLD) LCA(u, v int) int {
	for h.head[u] != h.head[v] {
		if h.depth[h.head[u]] < h.depth[h.head[v]] {
			u, v = v, u
		}
		u = h.parent[h.head[u]]
	}
	if h.depth[u] < h.depth[v] {
		return u
	}
	return v
}

func main() {
	n := 11
	adj := make([][]int, n)
	add := func(a, b int) { adj[a] = append(adj[a], b); adj[b] = append(adj[b], a) }
	for _, e := range [][2]int{{0, 1}, {0, 2}, {0, 3}, {1, 4}, {1, 5}, {4, 8}, {3, 6}, {6, 9}, {6, 10}, {5, 7}} {
		add(e[0], e[1])
	}
	val := []int64{5, 3, 8, 1, 2, 4, 6, 9, 7, 2, 6}
	h := NewHLD(n, 0, adj, val)
	fmt.Println("LCA(8,9)      =", h.LCA(8, 9))      // 0
	fmt.Println("PathSum(8,9)  =", h.PathSum(8, 9))  // 7+2+3+5+1+6+2 = 26
	fmt.Println("SubtreeSum(1) =", h.SubtreeSum(1))  // nodes 1,4,5,7,8 = 3+2+4+9+7 = 25
}
```

### Java

```java
import java.util.*;

public class HLD {
    final int n;
    final int[] parent, depth, size, heavy, head, pos, nodeAtPos;
    final long[] t; // iterative segment tree, size 2n
    final int segN;

    @SuppressWarnings("unchecked")
    public HLD(int n, int root, List<Integer>[] adj, long[] value) {
        this.n = n; this.segN = n;
        parent = new int[n]; depth = new int[n]; size = new int[n];
        heavy = new int[n]; head = new int[n]; pos = new int[n]; nodeAtPos = new int[n];
        Arrays.fill(heavy, -1);
        int[] order = new int[n]; int c = 0; boolean[] vis = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>(); st.push(root); vis[root] = true;
        parent[root] = -1;
        while (!st.isEmpty()) {
            int u = st.pop(); order[c++] = u;
            for (int w : adj[u]) if (!vis[w]) { vis[w]=true; parent[w]=u; depth[w]=depth[u]+1; st.push(w); }
        }
        for (int i = c - 1; i >= 0; i--) {
            int u = order[i]; size[u] = 1; int best = 0;
            for (int w : adj[u]) if (w != parent[u]) {
                size[u] += size[w];
                if (size[w] > best) { best = size[w]; heavy[u] = w; }
            }
        }
        int cur = 0; Deque<int[]> s2 = new ArrayDeque<>(); s2.push(new int[]{root, root});
        while (!s2.isEmpty()) {
            int[] f = s2.pop(); int u = f[0], hd = f[1];
            head[u] = hd; pos[u] = cur; nodeAtPos[cur] = u; cur++;
            for (int w : adj[u]) if (w != parent[u] && w != heavy[u]) s2.push(new int[]{w, w});
            if (heavy[u] != -1) s2.push(new int[]{heavy[u], hd});
        }
        t = new long[2 * n];
        for (int v = 0; v < n; v++) t[n + pos[v]] = value[v];
        for (int i = n - 1; i >= 1; i--) t[i] = t[2*i] + t[2*i+1];
    }

    public void update(int v, long val) {
        int i = segN + pos[v]; t[i] = val;
        for (i >>= 1; i >= 1; i >>= 1) t[i] = t[2*i] + t[2*i+1];
    }
    private long query(int l, int r) { // inclusive
        long res = 0;
        for (l += segN, r += segN + 1; l < r; l >>= 1, r >>= 1) {
            if ((l & 1) == 1) res += t[l++];
            if ((r & 1) == 1) res += t[--r];
        }
        return res;
    }
    public long pathSum(int u, int v) { // vertex values, include LCA
        long res = 0;
        while (head[u] != head[v]) {
            if (depth[head[u]] < depth[head[v]]) { int x=u; u=v; v=x; }
            res += query(pos[head[u]], pos[u]);
            u = parent[head[u]];
        }
        if (depth[u] > depth[v]) { int x=u; u=v; v=x; }
        return res + query(pos[u], pos[v]);
    }
    public long subtreeSum(int v) { return query(pos[v], pos[v] + size[v] - 1); }
    public int lca(int u, int v) {
        while (head[u] != head[v]) {
            if (depth[head[u]] < depth[head[v]]) { int x=u; u=v; v=x; }
            u = parent[head[u]];
        }
        return depth[u] < depth[v] ? u : v;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        int n = 11;
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] e = {{0,1},{0,2},{0,3},{1,4},{1,5},{4,8},{3,6},{6,9},{6,10},{5,7}};
        for (int[] x : e) { adj[x[0]].add(x[1]); adj[x[1]].add(x[0]); }
        long[] val = {5,3,8,1,2,4,6,9,7,2,6};
        HLD h = new HLD(n, 0, adj, val);
        System.out.println("LCA(8,9)      = " + h.lca(8, 9));       // 0
        System.out.println("PathSum(8,9)  = " + h.pathSum(8, 9));   // 26
        System.out.println("SubtreeSum(1) = " + h.subtreeSum(1));   // 25
    }
}
```

### Python

```python
import sys

class HLD:
    def __init__(self, n, root, adj, value):
        self.n = n
        self.parent = [-1] * n
        self.depth = [0] * n
        self.size = [0] * n
        self.heavy = [-1] * n
        self.head = [0] * n
        self.pos = [0] * n
        self.node_at_pos = [0] * n

        order, st, vis = [], [root], [False] * n
        vis[root] = True
        while st:
            u = st.pop(); order.append(u)
            for w in adj[u]:
                if not vis[w]:
                    vis[w] = True
                    self.parent[w] = u
                    self.depth[w] = self.depth[u] + 1
                    st.append(w)
        for u in reversed(order):
            self.size[u] = 1
            best = 0
            for w in adj[u]:
                if w != self.parent[u]:
                    self.size[u] += self.size[w]
                    if self.size[w] > best:
                        best = self.size[w]; self.heavy[u] = w
        cur = 0; s2 = [(root, root)]
        while s2:
            u, hd = s2.pop()
            self.head[u] = hd; self.pos[u] = cur; self.node_at_pos[cur] = u; cur += 1
            for w in adj[u]:
                if w != self.parent[u] and w != self.heavy[u]:
                    s2.append((w, w))
            if self.heavy[u] != -1:
                s2.append((self.heavy[u], hd))

        # iterative segment tree (sum)
        self.t = [0] * (2 * n)
        for v in range(n):
            self.t[n + self.pos[v]] = value[v]
        for i in range(n - 1, 0, -1):
            self.t[i] = self.t[2 * i] + self.t[2 * i + 1]

    def update(self, v, val):
        i = self.n + self.pos[v]; self.t[i] = val
        i >>= 1
        while i >= 1:
            self.t[i] = self.t[2 * i] + self.t[2 * i + 1]; i >>= 1

    def _query(self, l, r):  # inclusive
        res = 0; l += self.n; r += self.n + 1
        while l < r:
            if l & 1: res += self.t[l]; l += 1
            if r & 1: r -= 1; res += self.t[r]
            l >>= 1; r >>= 1
        return res

    def path_sum(self, u, v):  # vertex values, include LCA
        res = 0
        while self.head[u] != self.head[v]:
            if self.depth[self.head[u]] < self.depth[self.head[v]]:
                u, v = v, u
            res += self._query(self.pos[self.head[u]], self.pos[u])
            u = self.parent[self.head[u]]
        if self.depth[u] > self.depth[v]:
            u, v = v, u
        return res + self._query(self.pos[u], self.pos[v])

    def subtree_sum(self, v):
        return self._query(self.pos[v], self.pos[v] + self.size[v] - 1)

    def lca(self, u, v):
        while self.head[u] != self.head[v]:
            if self.depth[self.head[u]] < self.depth[self.head[v]]:
                u, v = v, u
            u = self.parent[self.head[u]]
        return u if self.depth[u] < self.depth[v] else v


if __name__ == "__main__":
    n = 11
    adj = [[] for _ in range(n)]
    for a, b in [(0,1),(0,2),(0,3),(1,4),(1,5),(4,8),(3,6),(6,9),(6,10),(5,7)]:
        adj[a].append(b); adj[b].append(a)
    val = [5, 3, 8, 1, 2, 4, 6, 9, 7, 2, 6]
    h = HLD(n, 0, adj, val)
    print("LCA(8,9)      =", h.lca(8, 9))        # 0
    print("PathSum(8,9)  =", h.path_sum(8, 9))   # 26
    print("SubtreeSum(1) =", h.subtree_sum(1))   # 25
```

All three print `LCA(8,9)=0`, `PathSum(8,9)=26`, `SubtreeSum(1)=25`, matching the §4.1 hand trace. To switch to the **edge variant**, store `value[c] = w(parent(c), c)` (and the root's slot = identity), use a max/min merge, and change the final same-chain query to `query(pos[u]+1, pos[v])` with a `u == v` guard, as derived in §4.2.

---

## 6. Achieving O(log N) with the Right Base Structure

The `log²` factor is *not* intrinsic to the tree problem; it is the price of pairing HLD with a per-interval-`O(log N)` structure. Two routes lower it:

**4.1 Specialized monoids over the Euler/heavy layout.** For purely *commutative, invertible* aggregates (sum), one can sometimes reformulate path queries via prefix decompositions: define `pref(v) = ⊕` of values from `v` up to the root. Then for a path you combine `pref(u) ⊕ pref(v)` with the LCA correction. With a Fenwick storing root-prefix contributions updated over subtree ranges (the "subtree add, path query" duality), certain path-sum/point-update problems collapse to `O(log N)`. This is a base-structure trick layered on the Euler interval, not on the chain loop, and it only works for invertible monoids.

**4.2 Link-Cut Trees.** An LCT represents the *same* heavy-path idea but with **splay trees** as the per-path structure and dynamic `access` operations. Path aggregates over an LCT are `O(log N)` **amortized** (not worst-case), and the tree may change shape via `link`/`cut` in `O(log N)` amortized. The amortization comes from the splay potential argument (Sleator–Tarjan): the cost of an `access`, which exposes a root-to-node preferred path, telescopes to `O(log N)` amortized because each preferred-child change can be charged against a `log`-bounded potential drop. So LCTs achieve `O(log N)` *amortized* where static HLD pays `O(log² N)` *worst-case*.

**Bottom line.** If you need worst-case `O(log² N)` on a static tree → HLD + Segment Tree. If you need `O(log N)` amortized and/or dynamic shape → LCT. The constant factor of LCTs is substantially larger, so HLD wins in practice for static, read-heavy workloads unless the extra `log` genuinely matters.

---

## 7. Comparison with Link-Cut Trees and Centroid Decomposition

| Structure | Path query | Path update | Dynamic shape | Bound type | Per-op constant |
|-----------|-----------|-------------|---------------|-----------|-----------------|
| HLD + Segment Tree | O(log² N) | O(log² N) | ✗ (rebuild O(N)) | worst-case | moderate |
| HLD + Fenwick (invertible) | O(log N)–O(log² N) | O(log N)–O(log² N) | ✗ | worst-case | low |
| Link-Cut Tree | O(log N) | O(log N) | ✓ link/cut | **amortized** | high |
| Centroid Decomposition | n/a* | n/a* | ✗ | — | moderate |

*Centroid decomposition answers a *different* class: it decomposes the tree into `O(log N)` levels of centroids so that every path passes through the centroid of some level, enabling "count/aggregate over all pairs `(u, v)` with `dist(u, v) ≤ K`" in `O(N log N)` or `O(N log² N)` total. It does **not** answer "aggregate along one given path `u → v`" efficiently — that is HLD/LCT territory. The two are complementary, not competing.

**Amortized vs worst-case is the crucial axis.** HLD's `O(log² N)` is a *worst-case-per-operation* guarantee — important for latency-sensitive or adversarial settings. LCT's `O(log N)` is *amortized*: a single operation can cost `O(N)` while a sequence of `m` operations costs `O(m log N)`. For real-time systems with tail-latency SLOs, the worst-case guarantee can outweigh the better amortized bound.

---

## 8. Cache Behavior

- **Build pass 1 (sizes/heavy)** processes nodes in DFS/reverse-DFS order, which on an arbitrary input adjacency layout is **cache-hostile**: parent/child indices are unrelated in memory. This pass dominates build-time cache misses.
- **The `pos`-ordered `base[]` array is cache-friendly for chain queries.** A chain occupies a *contiguous* range, so a single chain's Segment Tree query walks a localized index range; the leaves of one chain are adjacent in memory. This is a genuine advantage over pointer-based tree representations.
- **Subtree queries are maximally cache-friendly** — a subtree is one contiguous interval, so the Segment Tree query touches a tight `O(log N)`-depth slice of nodes spanning a localized leaf range.
- **The chain loop itself** chases `head[·]` and `parent[·]` arrays at scattered indices (`O(log N)` random reads per query). For very large `N` these `O(log N)` pointer-like reads can cost more than the Segment Tree work; storing `head`, `parent`, `depth` in a *structure-of-arrays* layout (separate flat arrays, as shown throughout) keeps each read in its own hot cache line.

The net effect: HLD's per-query cache profile is `O(log N)` scattered reads (chain loop) plus `O(log² N)` mostly-localized reads (segment-tree queries over contiguous chain intervals). It is far friendlier than the `O(log² N)` pointer chases a naive linked-tree decomposition would incur.

---

## 9. Average-Case Analysis

The worst case is `2⌊log₂ N⌋` light edges per path, but typical trees do far better.

- **Random labeled trees (uniform over Cayley's `N^{N−2}` trees), or random recursive trees:** the expected number of light edges on a root-to-random-node path is `O(log N)` with a small constant; empirically the number of *chains touched per random path* is a handful even for `N` in the millions, because heavy edges absorb most of the depth.
- **Balanced trees (e.g. perfectly balanced binary tree):** every internal node has two equal children, so one is heavy and one is light by tie-break; a root-to-leaf path has exactly `⌊log₂ N⌋` light edges — the bound is essentially met, but the *chains are short* (length 1), so the constant in front of the Segment Tree work is what dominates.
- **Path graph (a single line):** one chain of length `N`. A path query is **one** Segment Tree query: `O(log N)`. HLD degenerates gracefully to the array case.
- **Star graph:** `N−1` chains of length 1. `path(leaf, leaf)` touches 2 chains + the center → `O(log N)` with tiny chains.

So across the spectrum, the *number of chains per query* ranges from `1` (path) to `Θ(log N)` (balanced/caterpillar), and real-world trees cluster toward the low end. The `log²` is a safe upper bound, rarely the realized cost.

---

## 10. Space-Time Trade-offs

| Choice | Space | Path query | Notes |
|--------|-------|-----------|-------|
| HLD + iterative Segment Tree (`2N`) | `Θ(N)` | O(log² N) | Smallest tree array; best cache. |
| HLD + recursive lazy Segment Tree (`4N`) | `Θ(N)` | O(log² N) | Needed for range updates / non-invertible ops. |
| HLD + Fenwick | `Θ(N)` | O(log² N) sum (or O(log N) with prefix trick) | Lowest constant for sums. |
| HLD + persistent Segment Tree | `Θ(N + Q log N)` | O(log² N) | Snapshots / version history; pairs with immutable topology. |
| HLD + merge-sort tree | `Θ(N log N)` | O(log³ N) | "k-th / count ≤ x on path." |
| Precomputed sparse table for static path-min (no updates) | `Θ(N log N)` per... | — | If *no updates*, binary-lifting jump-pointers give `O(log N)` path-min directly without HLD. |

The topology arrays (`parent, depth, size, heavy, head, pos`) are always `Θ(N)`. The base structure dictates the rest. The headline trade is: **paying one extra `log` of space (merge-sort tree) buys an extra `log` of query power (order statistics on paths)**, while **invertible monoids can shed a `log` of time** via prefix tricks.

---

## 11. Comparison Table (asymptotics + constants)

| Operation | HLD+SegTree | HLD+Fenwick | LCT | Centroid | Euler+SegTree |
|-----------|-------------|-------------|-----|----------|---------------|
| Build | O(N) | O(N) | O(N) | O(N log N) | O(N) |
| Path sum/min/max | O(log² N) | O(log² N)† | O(log N) amo | — | — |
| Path update (lazy) | O(log² N) | O(log² N) | O(log N) amo | — | — |
| Subtree query | O(log N) | O(log N) | O(log N) amo | — | O(log N) |
| LCA | O(log N) | O(log N) | O(log N) amo | O(log N) | O(1)‡ |
| Distance-≤-K pair counting | — | — | — | O(N log N) | — |
| Dynamic link/cut | — | — | O(log N) amo | — | — |
| Worst-case guarantee | ✓ | ✓ | ✗ (amortized) | ✓ | ✓ |
| Constant factor | medium | low | high | medium | low |

† `O(log N)` for sum with the subtree-add / path-query prefix duality on invertible monoids.
‡ With Euler tour + `±1` RMQ sparse table.

---

## 12. Open Problems and Research Directions

- **Worst-case `O(log N)` fully-dynamic path aggregates with low constants.** LCTs give `O(log N)` *amortized*; top trees and the Frederickson topology-tree approach give `O(log N)` *worst-case* but with notoriously large constants and intricate code. A practically fast, worst-case-`O(log N)`, easy-to-implement dynamic alternative to HLD remains a moving target.
- **Cache-oblivious / I/O-optimal tree path queries.** The `pos` layout is good but not provably I/O-optimal for arbitrary path queries; van-Emde-Boas-style recursive layouts of the chain decomposition are explored but not standard.
- **Parallel / batched HLD.** Answering a batch of `Q` path queries offline can sometimes beat `Q · log² N` (e.g. via small-to-large merging, sibling `21`, or offline LCA + sack/DSU-on-tree). The precise frontier between online HLD and offline batch techniques is problem-dependent.
- **Persistent + concurrent HLD value layers.** Combining persistent segment trees with HLD's immutable topology for lock-free, point-in-time path queries is folklore-practical but under-formalized in terms of memory reclamation and version-GC guarantees.
- **Removing the `log²` for non-invertible monoids.** For min/max (non-invertible), the prefix trick fails; whether a general static structure achieves worst-case `O(log N)` path-min *with updates* and `O(N)` space, with small constants, is the everyday open question that keeps HLD at `log²`.

---

## 13. Summary

Heavy-Light Decomposition rests on a single inequality — **a light edge at least halves the subtree size** (Lemma 2.1) — from which the `⌊log₂ N⌋` light-edge bound (Theorem 2.2) and hence the `O(log N)` chains-per-path corollary follow. Combined with chain and subtree *contiguity* (Proposition 1.5), this turns path queries into `O(log N)` independent Segment Tree range queries, giving the characteristic `O(log² N)` worst-case bound (Theorem 3.1); subtree queries are a single interval and stay `O(log N)`. The two logs are independent — one structural, one from the base structure — so the second can be shaved (Fenwick prefix tricks on invertible monoids) or replaced (LCTs for `O(log N)` *amortized* and dynamic shape, top trees for `O(log N)` *worst-case* at high constant). For static, read-heavy trees with worst-case latency requirements, HLD + Segment Tree remains the pragmatic optimum: linear build, linear space, contiguous-and-cache-friendly chains, and a free `O(log N)` LCA.
