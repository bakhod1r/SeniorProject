# Articulation Points & Bridges — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Correctness Proofs of the Low-Link Criteria
3. Complexity O(V + E)
4. Biconnected-Component Decomposition Theorem and Block-Cut Tree
5. Connection to Menger's Theorem
6. Worked Trace — DFS Tree with disc/low
7. Reference Implementations (Go / Java / Python)
8. Cache Behavior
9. Average-Case Analysis
10. Space–Time Trade-offs
11. Comparison with Alternatives
12. Fully-Dynamic 2-Connectivity and Open Problems
13. Summary

---

## 1. Formal Definitions

Let `G = (V, E)` be a finite **undirected** graph, possibly with multiple edges but (for cuts/bridges) without loss of generality without self-loops, since a self-loop never affects connectivity. Let `c(G)` denote the number of connected components of `G`.

**Definition 1.1 (Articulation point / cut vertex).** A vertex `u ∈ V` is an *articulation point* if `c(G − u) > c(G)`, where `G − u` is the graph obtained by deleting `u` and all edges incident to it.

**Definition 1.2 (Bridge / cut edge).** An edge `e ∈ E` is a *bridge* if `c(G − e) > c(G)`, where `G − e` deletes the single edge `e` (keeping both endpoints).

**Definition 1.3 (k-vertex-connectivity).** For `|V| > k`, `G` is *k-vertex-connected* if it remains connected after deleting any `k − 1` vertices, i.e. it has no vertex cut of size `< k`. The *vertex connectivity* `κ(G)` is the size of a minimum vertex cut. A graph with `κ(G) ≥ 2` and `|V| ≥ 3` is *biconnected* — it has **no** articulation point.

**Definition 1.4 (k-edge-connectivity).** `G` is *k-edge-connected* if it remains connected after deleting any `k − 1` edges. The *edge connectivity* `λ(G)` is the size of a minimum edge cut. A graph with `λ(G) ≥ 2` and at least one edge is *2-edge-connected* — it has **no** bridge.

**Definition 1.5 (DFS tree, tree edge, back edge).** Fix a DFS of `G` starting at root `r` within its component. Let `disc: V → {0,1,…}` be the order of first visit. The DFS produces a spanning forest; an edge `(u, v) ∈ E` is a **tree edge** if it was used to first visit one endpoint from the other, otherwise a **back edge**. 

**Proposition 1.6 (No cross edges in undirected DFS).** In a DFS of an undirected graph, every non-tree edge `(u, v)` connects a vertex to one of its ancestors in the DFS tree.

*Proof.* WLOG `disc[u] < disc[v]`. When DFS first explores `u`, the edge `(u, v)` is present in `u`'s adjacency. Since `disc[v] > disc[u]`, `v` is undiscovered at that moment, so the entire subtree explored while `u` is on the stack — which includes all vertices discovered before `u` is popped — will discover `v` before `u` is finished (the edge guarantees `v` is reachable from `u` while `u` is active). Hence `v` is a descendant of `u`, making `(u, v)` a back edge from the descendant `v` to its ancestor `u`. There are no cross or forward edges. ∎

**Definition 1.7 (Low-link).** For each `u`, with `T(u)` denoting the set of vertices in the DFS subtree rooted at `u`:

```
low[u] = min( { disc[u] }
            ∪ { disc[w] : (x, w) is a back edge, x ∈ T(u), w an ancestor of x (or x itself's ancestor) }
            ∪ { low[c]  : c is a tree-edge child of u } ).
```

Equivalently, `low[u]` is the minimum `disc` over all vertices reachable from some `x ∈ T(u)` by a path that uses tree edges within `T(u)` and **at most one** back edge.

---

## 2. Correctness Proofs of the Low-Link Criteria

Throughout, fix a DFS tree on one component with root `r`. For a tree edge `u → v` (so `v` is a child of `u`), `T(v)` is the subtree rooted at `v`.

### 2.1 The cut-vertex theorem (non-root)

**Theorem 2.1.** Let `u ≠ r`. Then `u` is an articulation point **iff** there exists a tree-edge child `v` of `u` with `low[v] ≥ disc[u]`.

**Proof (⇐).** Suppose `low[v] ≥ disc[u]` for some child `v`. By Definition 1.7, every vertex reachable from `T(v)` via tree edges and at most one back edge has `disc ≥ disc[u]`; in particular no edge leaves `T(v)` to a *proper ancestor* of `u` (such an ancestor `a` has `disc[a] < disc[u]`). Every edge of `G` is either a tree edge or, by Proposition 1.6, a back edge between a vertex and an ancestor. Consider any path `P` in `G` from a vertex `x ∈ T(v)` to a vertex `y` that is a proper ancestor of `u` (such `y` exists because `u ≠ r`, so `r` itself is a proper ancestor, and `r` is connected to `x` in `G`). Walk along `P` from `x`; to leave `T(v)` the path must use either the tree edge `(u, v)` (passing through `u`) or a back edge from `T(v)`. A back edge from `T(v)` reaches a vertex with `disc ≥ disc[u]`, i.e. `u` or a descendant of `u` — never a proper ancestor — so it cannot exit the region "`u` and below" without going through `u`. Hence every such path passes through `u`. Deleting `u` separates `x` from `y`: `c(G − u) > c(G)`. So `u` is an articulation point.

**Proof (⇒).** Suppose no child `v` satisfies `low[v] ≥ disc[u]`, i.e. every child `v` has `low[v] < disc[u]`. We show `u` is **not** an articulation point. Removing `u` could only disconnect vertices that, in the DFS tree, are separated by `u` — namely the subtrees `T(v_1), …, T(v_k)` of `u`'s children, plus the part of `G` strictly above `u`. For each child `v_i`, `low[v_i] < disc[u]` means some vertex in `T(v_i)` has a back edge to a proper ancestor `a_i` of `u` (since reachable `disc < disc[u]` forces an ancestor strictly above `u`). That back edge gives a path from `T(v_i)` to `a_i` avoiding `u` entirely. Thus every child subtree remains connected to the part above `u` after deleting `u`, and the part above `u` is internally connected (it is the rest of the DFS tree minus `u`'s subtree). Therefore `G − u` is connected within this component: `u` is not an articulation point. ∎

### 2.2 The root special case

**Theorem 2.2.** The root `r` is an articulation point **iff** it has at least two tree-edge children in the DFS tree.

**Proof.** If `r` has children `v_1, v_2` (two distinct subtrees), then by Proposition 1.6 there are no edges between `T(v_1)` and `T(v_2)` except through `r`: any such edge would be a back edge to a common ancestor, but the only common ancestor of vertices in different child subtrees is `r` itself, and an edge to `r` passes through `r`. (More precisely, an edge from `x ∈ T(v_1)` to `y ∈ T(v_2)` with neither equal to `r` would, by Proposition 1.6, force one to be an ancestor of the other, contradicting their being in disjoint subtrees.) Hence deleting `r` separates `T(v_1)` from `T(v_2)`: `r` is an articulation point. Conversely, if `r` has exactly one child `v`, then `G − r` equals `T(v)` (the whole component minus `r`), which is connected because the DFS subtree spanning `T(v)` is connected; so `r` is not an articulation point. ∎

Note the asymmetry: the non-root test `low[v] ≥ disc[u]` would *always* hold trivially for `r` if applied (because `disc[r] = 0` is the global minimum and `low[v] ≥ 0`), giving false positives — which is exactly why the root needs Theorem 2.2 instead.

### 2.3 The bridge theorem (strict inequality)

**Theorem 2.3.** A tree edge `(u, v)` (with `v` the child) is a bridge **iff** `low[v] > disc[u]`.

**Proof (⇐).** Suppose `low[v] > disc[u]`. Then every vertex reachable from `T(v)` (via tree edges and one back edge) has `disc > disc[u]`, i.e. lies strictly inside `T(v) ∪ {descendants}` — in particular, **no** edge from `T(v)` reaches `u` or any ancestor of `u`. Every edge from `T(v)` to `V ∖ T(v)` is, by Proposition 1.6, a back edge to an ancestor; but no such back edge exists (it would have `disc ≤ disc[u] < low[v]`). Therefore the **only** edge between `T(v)` and the rest of `G` is the tree edge `(u, v)`. Deleting it disconnects `T(v)`: `(u, v)` is a bridge.

**Proof (⇒).** Suppose `low[v] ≤ disc[u]`. Since `v` is a child of `u`, the tree path forces `low[v] ≥ ... ` — more carefully, consider the two cases. If `low[v] = disc[u]`: some vertex `x ∈ T(v)` has a back edge to `u` (the only vertex with `disc = disc[u]`). That back edge `(x, u)` together with the tree path from `v` to `x` forms a cycle through `(u, v)`; deleting `(u, v)` leaves `T(v)` connected to `u` via `(x, u)`, so `(u, v)` is **not** a bridge. If `low[v] < disc[u]`: some `x ∈ T(v)` has a back edge to a proper ancestor `a` of `u`; the path `a — x —(tree)— v` plus the path `a —(tree)— u — v` again puts `(u, v)` on a cycle, so it is not a bridge. In both sub-cases `(u, v)` is not a bridge. ∎

The boundary between Theorem 2.1 (`≥`) and Theorem 2.3 (`>`) is precisely the case `low[v] = disc[u]`: there **is** a back edge to `u`, so `(u, v)` is not a bridge (Theorem 2.3 ⇒-direction), yet `u` *is* a cut vertex (Theorem 2.1 ⇐-direction with `low[v] = disc[u] ≥ disc[u]`). A worked instance: two triangles sharing the single vertex `u`. The edge from `u` into either triangle is not a bridge (the triangle is a cycle), but `u` is the articulation point joining them.

**Corollary 2.4 (Non-tree edges are never bridges).** A back edge lies on the cycle formed with the tree path between its endpoints, so deleting it cannot disconnect the graph. Hence only tree edges can be bridges, and Theorem 2.3 examines exactly those.

**Corollary 2.5 (Multi-edges are never bridges).** If two parallel edges join `u` and `v`, deleting one leaves the other, preserving connectivity. In the algorithm this is handled by skipping the **specific parent edge id** rather than the parent vertex, so the second parallel edge acts as a back edge with `disc[v] = disc[u]`, forcing `low[v] ≤ disc[u]` and defeating the strict test.

---

## 3. Complexity O(V + E)

**Theorem 3.1.** Articulation points and bridges (and biconnected components) are computed in `Θ(V + E)` time and `Θ(V)` auxiliary space.

**Proof.** The algorithm is a single DFS. Each vertex is pushed and popped exactly once (`Θ(V)` for the stack operations and the per-vertex `disc`/`low` initialization). Each undirected edge `{u, v}` appears in two adjacency lists and is examined a constant number of times — once from each endpoint — so the total edge work is `Θ(E)`. The criteria checks (`low[v] ≥ disc[u]`, `low[v] > disc[u]`, child counting) are `O(1)` per tree edge, contributing `O(V)` overall (there are `V − c` tree edges). The relaxations `low[u] = min(low[u], ·)` are `O(1)` per edge examination. Summing: `Θ(V + E)`. Auxiliary space is the `disc`, `low`, `visited/parent`, and (iteratively) `iter` and explicit-stack arrays, each `Θ(V)`; the edge stack for biconnected components is `Θ(E)` in the worst case but is consumed monotonically. ∎

This is **optimal**: any algorithm must at least read the graph, which is `Ω(V + E)`.

---

## 4. Biconnected-Component Decomposition Theorem and Block-Cut Tree

**Definition 4.1 (Biconnected component).** Define a relation on edges: `e_1 ~ e_2` iff `e_1 = e_2` or they lie on a common simple cycle. This is an equivalence relation, and its classes are the **biconnected components** (blocks).

**Theorem 4.2 (Edge partition).** The biconnected components partition `E`. Two distinct blocks share at most one vertex, and any shared vertex is an articulation point. Conversely, every articulation point is shared by ≥ 2 blocks.

*Proof sketch.* That `~` is an equivalence relation is the classical Harary result; transitivity follows from gluing two cycles sharing an edge into a larger 2-connected subgraph. If two blocks shared two vertices `a, b`, there would be internally-disjoint paths through each block joining `a` and `b`, forming a cycle that merges the blocks — contradiction. A vertex shared by two blocks, when removed, disconnects them (each block minus the vertex is connected to the rest only through it), hence is an articulation point; and Theorem 2.1 shows each articulation point lies in ≥ 2 blocks. ∎

**Definition 4.3 (Block-cut tree).** Form a bipartite graph `BC(G)`: one node per block, one node per articulation point, with an edge between an articulation point `a` and a block `B` iff `a ∈ B`.

**Theorem 4.4.** `BC(G)` is a forest; it is a tree iff `G` is connected.

*Proof.* A cycle in `BC(G)` would alternate blocks and cut vertices `B_1, a_1, B_2, a_2, …, B_1`, implying the blocks `B_i` and their shared cut vertices form a cycle of blocks; but two blocks sharing a cut vertex and lying on a cycle of blocks could be merged into one 2-connected block (their union would be 2-connected), contradicting maximality of blocks. So `BC(G)` is acyclic. Connectivity of `BC(G)` mirrors connectivity of `G`. ∎

**Corollary 4.5 (2-edge-connected components and the bridge tree).** Deleting all bridges splits `G` into its **2-edge-connected components**, which partition `V`. Contracting each 2ECC to a point and keeping the bridges between them yields the **bridge tree**, a forest whose edges are exactly the bridges; the number of bridges on the tree path between two vertices equals the number of edge-disjoint single-edge cuts separating them.

---

## 5. Connection to Menger's Theorem

**Theorem 5.1 (Menger, vertex form).** For non-adjacent `s, t`, the maximum number of internally vertex-disjoint `s–t` paths equals the minimum size of an `s–t` vertex cut.

**Theorem 5.2 (Menger, edge form).** The maximum number of edge-disjoint `s–t` paths equals the minimum size of an `s–t` edge cut.

**Consequences for `k = 1`.**

- A graph (with `|V| ≥ 3`) is **2-vertex-connected** iff every pair of vertices has 2 internally-disjoint paths iff it has **no articulation point**. So articulation points are precisely the size-1 vertex cuts — the degenerate `κ(G) = 1` case of Menger.
- A graph is **2-edge-connected** iff every pair has 2 edge-disjoint paths iff it has **no bridge**. So bridges are precisely the size-1 edge cuts — the `λ(G) = 1` case.

This places cut vertices and bridges at the base of the connectivity hierarchy. General `k`-vertex/edge connectivity (forward-referenced in `23-edge-vertex-connectivity`) is computed via max-flow (Menger ⇔ max-flow–min-cut), of which the single-DFS `disc`/`low` method is the specialized, linear-time `k = 1` shortcut — far cheaper than running flow. The global edge connectivity `λ(G)` for general `k` is found by Stoer–Wagner or Gomory–Hu, but for the existence of *any* bridge, `O(V + E)` suffices.

---

## 6. Worked Trace — DFS Tree with disc/low

Take the canonical "two triangles joined by a bridge" graph, the running example used across all levels of this topic:

```
edges: 0-1, 1-2, 2-0, 1-3, 3-4, 4-5, 5-3
```

A DFS started at vertex `0`, always taking the smallest unvisited neighbor first, produces this DFS tree (solid lines `│` are tree edges, the dashed `╌` arrows are back edges to ancestors):

```
            disc / low
   0   ──────  0 / 0          root
   │
   1   ──────  1 / 0          1's subtree escapes to 0 via back edge 2->0
   ├───────────────╮
   2   ─ 2 / 0      3 ─ 3 / 3 child of 1; low[3]=3
   ╎ (back 2->0)    │
   (closes 0-1-2)   4 ─ 4 / 3
                    │
                    5 ─ 5 / 3
                    ╎ (back 5->3)
                    (closes 3-4-5)

back edges:  2 ╌╌> 0   (disc 0)      5 ╌╌> 3   (disc 3)
```

**Step-by-step `disc`/`low` computation** (post-order, i.e. values finalize as DFS returns):

| step | vertex | event | disc | low after | reason |
|------|--------|-------|------|-----------|--------|
| 1 | 0 | enter | 0 | 0 | root |
| 2 | 1 | enter | 1 | 1 | tree edge 0→1 |
| 3 | 2 | enter | 2 | 2 | tree edge 1→2 |
| 4 | 2 | back edge 2→0 | 2 | **0** | `min(2, disc[0]=0)` |
| 5 | 2 | return to 1 | — | — | fold: `low[1]=min(1,low[2]=0)=0` |
| 6 | 3 | enter | 3 | 3 | tree edge 1→3 |
| 7 | 4 | enter | 4 | 4 | tree edge 3→4 |
| 8 | 5 | enter | 5 | 5 | tree edge 4→5 |
| 9 | 5 | back edge 5→3 | 5 | **3** | `min(5, disc[3]=3)` |
| 10 | 5 | return to 4 | — | — | fold: `low[4]=min(4,low[5]=3)=3` |
| 11 | 4 | return to 3 | — | — | fold: `low[3]=min(3,low[4]=3)=3` |
| 12 | 3 | return to 1 | — | — | fold: `low[1]=min(0,low[3]=3)=0` |
| 13 | 1 | return to 0 | — | — | fold: `low[0]=min(0,low[1]=0)=0` |

**Final arrays:**

| vertex | 0 | 1 | 2 | 3 | 4 | 5 |
|--------|---|---|---|---|---|---|
| `disc` | 0 | 1 | 2 | 3 | 4 | 5 |
| `low`  | 0 | 0 | 0 | 3 | 3 | 3 |

**Applying the criteria:**

- Tree edge `1→3`, child `3`: `low[3] = 3`, `disc[1] = 1`. Cut test `low[3] ≥ disc[1]` → `3 ≥ 1` **true** → vertex `1` is an articulation point. Bridge test `low[3] > disc[1]` → `3 > 1` **true** → edge `(1,3)` is a **bridge**.
- Tree edge `1→2`, child `2`: `low[2] = 0`, `disc[1] = 1`. Cut test `0 ≥ 1` **false**; bridge test `0 > 1` **false`. The triangle edge is neither.
- Tree edge `3→4`, child `4`: `low[4] = 3`, `disc[3] = 3`. Cut test `3 ≥ 3` **true** → vertex `3` is an articulation point. Bridge test `3 > 3` **false** → not a bridge (the back edge `5→3` saves it). This is exactly the boundary case `low[v] = disc[u]` of Theorem 2.3.
- Root `0`: has exactly **one** child (`1`) in the DFS tree → by Theorem 2.2 **not** an articulation point, even though `disc[0]=0` is the global minimum.

**Result:** articulation points `{1, 3}`; bridges `{(1,3)}`; biconnected components `{0-1, 1-2, 2-0}`, `{1-3}`, `{3-4, 4-5, 5-3}`. The single bridge `(1,3)` is its own one-edge block; the two triangles are two-vertex-connected blocks sharing the cut vertices `1` and `3` respectively. This matches Theorem 4.2 (each cut vertex lies in ≥ 2 blocks).

---

## 7. Reference Implementations (Go / Java / Python)

Three production-grade variants follow, in the canonical Go → Java → Python order:

1. **Biconnected components via an edge stack** (Go) — pops edges into a block when `low[v] ≥ disc[u]` fires.
2. **Bridge tree / 2-edge-connected components** (Java) — finds bridges, contracts 2ECCs, and emits the bridge forest.
3. **Iterative articulation-point + bridge finder** (Python) — explicit stack, no recursion-depth limit.

All three are multi-edge safe (they skip the *parent edge id*, never the parent vertex), per Corollary 2.5.

### 7.1 Go — biconnected components (edge stack)

```go
package main

import "fmt"

type Graph struct {
	n   int
	adj [][][2]int // adj[u] = list of {neighbor, edgeId}
	m   int
}

func NewGraph(n int) *Graph { return &Graph{n: n, adj: make([][][2]int, n)} }

func (g *Graph) AddEdge(u, v int) {
	g.adj[u] = append(g.adj[u], [2]int{v, g.m})
	g.adj[v] = append(g.adj[v], [2]int{u, g.m})
	g.m++
}

// BiconnectedComponents returns, for each block, its list of edge ids.
func (g *Graph) BiconnectedComponents() [][]int {
	disc := make([]int, g.n)
	low := make([]int, g.n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var edgeStack []int
	var blocks [][]int

	var dfs func(u, parentEdge int)
	dfs = func(u, parentEdge int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, e := range g.adj[u] {
			v, id := e[0], e[1]
			if id == parentEdge {
				continue // skip the exact edge we arrived on
			}
			if disc[v] == -1 {
				edgeStack = append(edgeStack, id)
				dfs(v, id)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] >= disc[u] { // cut condition: close a block
					var comp []int
					for {
						top := edgeStack[len(edgeStack)-1]
						edgeStack = edgeStack[:len(edgeStack)-1]
						comp = append(comp, top)
						if top == id {
							break
						}
					}
					blocks = append(blocks, comp)
				}
			} else if disc[v] < disc[u] { // back edge going up
				edgeStack = append(edgeStack, id)
				if disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
		}
	}

	for i := 0; i < g.n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	return blocks
}

func main() {
	g := NewGraph(6)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}} {
		g.AddEdge(e[0], e[1])
	}
	for i, b := range g.BiconnectedComponents() {
		fmt.Printf("block %d: edge ids %v\n", i, b) // 3 blocks
	}
}
```

### 7.2 Java — bridge tree / 2-edge-connected components

```java
import java.util.*;

// Computes bridges, labels each vertex with its 2-edge-connected-component id,
// and builds the bridge tree (a forest whose edges are exactly the bridges).
public class BridgeTree {
    int n, m = 0;
    List<int[]>[] adj;          // {neighbor, edgeId}
    int[] disc, low, comp;      // comp[v] = 2ECC id
    boolean[] isBridge;
    int timer = 0, numComp = 0;

    @SuppressWarnings("unchecked")
    BridgeTree(int n) {
        this.n = n;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
    }

    void addEdge(int u, int v) {
        adj[u].add(new int[]{v, m});
        adj[v].add(new int[]{u, m});
        m++;
    }

    // Phase 1: find bridges with disc/low.
    void findBridges() {
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        isBridge = new boolean[m];
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfsBridge(i, -1);
    }

    void dfsBridge(int u, int parentEdge) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == parentEdge) continue;       // multi-edge safe
            if (disc[v] == -1) {
                dfsBridge(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;   // strict => bridge
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    // Phase 2: flood fill not crossing bridges => 2ECC ids.
    void labelComponents() {
        comp = new int[n];
        Arrays.fill(comp, -1);
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1) continue;
            int id = numComp++;
            Deque<Integer> q = new ArrayDeque<>();
            q.push(s); comp[s] = id;
            while (!q.isEmpty()) {
                int u = q.pop();
                for (int[] e : adj[u]) {
                    if (isBridge[e[1]]) continue;            // never cross a bridge
                    if (comp[e[0]] == -1) { comp[e[0]] = id; q.push(e[0]); }
                }
            }
        }
    }

    // Phase 3: contract; bridges become the tree edges.
    List<int[]> bridgeTree() {
        List<int[]> tree = new ArrayList<>();
        boolean[] seen = new boolean[m];
        for (int u = 0; u < n; u++)
            for (int[] e : adj[u]) {
                int v = e[0], id = e[1];
                if (isBridge[id] && !seen[id]) {
                    seen[id] = true;
                    tree.add(new int[]{comp[u], comp[v]});
                }
            }
        return tree;
    }

    public static void main(String[] args) {
        BridgeTree g = new BridgeTree(6);
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}, {4, 5}, {5, 3}};
        for (int[] e : edges) g.addEdge(e[0], e[1]);
        g.findBridges();
        g.labelComponents();
        System.out.println("2ECC ids:   " + Arrays.toString(g.comp)); // [0,0,0,1,1,1]
        for (int[] t : g.bridgeTree())
            System.out.println("bridge-tree edge: " + t[0] + " - " + t[1]); // 0 - 1
    }
}
```

### 7.3 Python — iterative articulation points + bridges

```python
import sys


def analyze(n, edges):
    """Iterative disc/low. Returns (articulation_points, bridges).
    edges: list of (u, v). Multi-edge safe via parent edge id."""
    adj = [[] for _ in range(n)]   # adj[u] = list of (neighbor, edge_id)
    for eid, (u, v) in enumerate(edges):
        adj[u].append((v, eid))
        adj[v].append((u, eid))

    disc = [-1] * n
    low = [0] * n
    parent_edge = [-1] * n
    it = [0] * n
    timer = 0
    aps = set()
    bridges = []

    for s in range(n):
        if disc[s] != -1:
            continue
        disc[s] = low[s] = timer
        timer += 1
        stack = [s]
        root_children = 0
        while stack:
            u = stack[-1]
            if it[u] < len(adj[u]):
                v, eid = adj[u][it[u]]
                it[u] += 1
                if eid == parent_edge[u]:
                    continue                      # skip the exact arriving edge
                if disc[v] == -1:
                    parent_edge[v] = eid
                    disc[v] = low[v] = timer
                    timer += 1
                    if u == s:
                        root_children += 1
                    stack.append(v)
                else:
                    low[u] = min(low[u], disc[v])  # back edge relax
            else:
                stack.pop()
                if stack:
                    p = stack[-1]
                    low[p] = min(low[p], low[u])
                    if p != s and low[u] >= disc[p]:   # non-strict => cut vertex
                        aps.add(p)
                    if low[u] > disc[p]:               # strict => bridge
                        bridges.append((p, u))
        if root_children >= 2:
            aps.add(s)
    return aps, bridges


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)  # belt-and-suspenders; this code is iterative
    edges = [(0, 1), (1, 2), (2, 0), (1, 3), (3, 4), (4, 5), (5, 3)]
    aps, bridges = analyze(6, edges)
    print("articulation points:", sorted(aps))  # [1, 3]
    print("bridges:", bridges)                   # [(1, 3)]
```

All three terminate in `Θ(V + E)` (Theorem 3.1) and reproduce the result of the Section 6 trace: cut vertices `{1, 3}`, bridge `(1,3)`, three blocks, two 2ECCs.

---

## 8. Cache Behavior

The DFS's memory access pattern has two parts:

1. **Side-table access** (`disc[u]`, `low[u]`, `parent[u]`) is indexed by vertex id. With a CSR adjacency layout and vertices numbered by a locality-preserving order (e.g. a BFS/DFS relabeling or a space-filling-curve order on geometric graphs), these accesses are reasonably local. With adversarial labeling they are effectively random — one cache miss per vertex touch.

2. **Adjacency traversal** is sequential within a vertex's neighbor list (cache-friendly: a CSR row is contiguous) but jumps to a random neighbor's row next (cache-unfriendly).

So the realistic cost model is `Θ(V + E)` *cache misses* in the worst case (random labeling), improving toward `Θ((V + E)/B)` for a cache line holding `B` ids when the labeling is locality-preserving. The recursive version additionally pays call-stack cache traffic; the iterative version's explicit stack is contiguous and friendlier. Relabeling the graph for locality before a large analysis is a standard 1.5–3× practical speedup, the same trick used in `database-indexing`-style clustering.

---

## 9. Average-Case Analysis

On a uniformly random connected graph `G(n, m)`:

- **Expected number of bridges.** In the Erdős–Rényi model `G(n, p)` just above the connectivity threshold `p ≈ (ln n)/n`, the graph is sparse and tree-like, so a constant fraction of edges are bridges. As `p` grows past `(ln n)/n`, cycles proliferate and the expected bridge count drops sharply; for `p ≥ (1 + ε)(ln n)/n` with growing average degree, the graph becomes 2-edge-connected w.h.p. and the expected bridge count → 0.
- **Expected number of articulation points.** Similarly governed by low-degree vertices: a vertex of degree 1 is never an articulation point, but a degree-2 vertex bridging two dense regions often is. Above the 2-connectivity threshold (average degree `Θ(ln n)`), the count → 0 w.h.p.
- **DFS depth.** The *expected* DFS-tree depth on random graphs is `Θ(n)` in the worst case (random graphs can have long induced paths), so the **average** case does **not** save the recursive version from stack overflow — reinforcing the senior-level insistence on iterative DFS.

The *running time* is `Θ(V + E)` regardless of the input distribution — there is no average-case speedup, because every edge must be examined. The randomness only affects how many cuts/bridges exist, not the cost of finding them.

---

## 10. Space–Time Trade-offs

| Variant | Time | Aux space | Note |
|---------|------|-----------|------|
| Recursive DFS | `Θ(V + E)` | `Θ(V)` tables + `Θ(depth)` stack | Smallest code; stack-bounded. |
| Iterative DFS | `Θ(V + E)` | `Θ(V)` tables + `Θ(V)` explicit stack | Same time, heap-allocated stack — no overflow. |
| BCC with edge stack | `Θ(V + E)` | `Θ(V) + Θ(E)` edge stack | Extra `O(E)` for the component stack. |
| DSU-based bridges | `Θ((V+E) α(V))` | `Θ(V)` | Bridges only; near-linear with inverse-Ackermann. |
| Bit-packed `disc`/`low` | `Θ(V + E)` | `Θ(V)` with smaller constant | Pack into 32-bit ints; halves table memory vs 64-bit. |

The fundamental space lower bound is `Ω(V)` simply to remember which vertices are visited; you cannot do cut/bridge detection in `o(V)` space without re-reading the graph many times (a streaming/space-restricted setting with its own literature). The `Θ(V + E)` time is unbeatable since the input must be read.

---

## 11. Comparison with Alternatives

| Method | Cuts | Bridges | Time | Model | Comment |
|--------|------|---------|------|-------|---------|
| Tarjan `disc`/`low` DFS | ✓ | ✓ | `Θ(V+E)` | RAM | The standard; also yields BCCs. |
| Remove-and-check | ✓ | ✓ | `Θ(V(V+E))` / `Θ(E(V+E))` | RAM | Oracle for tests only. |
| Max-flow per pair (Menger) | ✓ | ✓ | polynomial, much larger | RAM | Needed for general `k`; overkill for `k=1`. |
| DSU offline (bridges) | ✗ | ✓ | `Θ((V+E)α)` | RAM | Edge-order flexible, out-of-core friendly. |
| Dynamic / online | partial | ✓ | polylog amortized | dynamic | Maintains under updates (`30-online-bridges`). |
| Chain decomposition (Schmidt) | ✓ | ✓ | `Θ(V+E)` | RAM | Single DFS + ear/chain decomposition; no `low` array, conceptually clean. |

Schmidt's **chain decomposition** (2013) deserves note: it computes the same cuts/bridges (and a certificate of 2-/3-connectivity) using a DFS and a partition of edges into chains, without the `low` array — an elegant alternative that some find easier to reason about.

---

## 12. Fully-Dynamic 2-Connectivity and Open Problems

### 12.1 The dynamic model

In the **fully-dynamic** setting the graph undergoes an intermixed sequence of `insert(e)`, `delete(e)`, and query operations (`is e a bridge?`, `are u, v 2-edge-connected?`, `is w an articulation point?`, `are u, v 2-vertex-connected?`). Recomputing the static `Θ(V+E)` DFS after every update is correct but costs `Θ(V+E)` per operation; the goal is **polylogarithmic amortized** time per update, sharing structure across updates.

The state of the art for fully-dynamic **2-edge-connectivity** is the Holm–de Lichtenberg–Thorup (HDT, 2001) framework, which maintains a hierarchy of spanning forests in **Euler-tour trees** with edge "levels": a tree edge is promoted to a higher level when it is found to be replaceable, bounding the total promotion work. HDT achieves `O(log²n)` amortized time per update and `O(log n / log log n)` per query for connectivity, and `O(log⁴n)` amortized for 2-edge-connectivity / bridge queries. The crucial invariant — each edge's level only increases, and there are `O(log n)` levels — is what amortizes the otherwise expensive replacement-edge search.

### 12.2 Insertion-only (incremental) is much easier

If edges are only **inserted**, never deleted, the bridge set shrinks monotonically (inserting an edge can only destroy bridges by creating cycles, never create new ones). This is the **incremental 2-edge-connectivity** problem, solvable with a DSU over 2ECCs plus a "small-to-large" or link-cut-tree merge, giving near-`O(α(V))` amortized per insertion. This insertion-only case is the subject of `30-online-bridges`; the contrast with the fully-dynamic `O(log⁴n)` shows how much harder deletions make the problem.

### 12.3 The decremental and vertex cases

- **Decremental (delete-only) bridges** can also be handled more cheaply than the fully-dynamic bound in some regimes, but no clean `O(α)` analogue exists; deletions split 2ECCs and the splitting work resists union-find's monotonicity.
- **Fully-dynamic 2-vertex-connectivity** (articulation points, block-cut tree) is genuinely harder than the edge case: the block-cut tree is not a simple partition of vertices (cut vertices are shared), so the Euler-tour-tree machinery does not transfer directly. Polylog bounds exist but with larger exponents, and tightening them remains open.

### 12.4 Open problems

1. **Fully-dynamic 2-edge-connectivity / bridges.** Maintaining the bridge set (and answering "is `e` a bridge now?") under **both** edge insertions and deletions in polylogarithmic amortized time per update is solved (Holm–de Lichtenberg–Thorup achieve `O(log²n)` amortized), but the constants and worst-case (vs amortized) bounds remain an active area. The insertion-only case is simpler (`30-online-bridges`).
2. **Fully-dynamic biconnectivity.** Maintaining articulation points and the block-cut tree under fully dynamic updates with optimal bounds is harder than the edge case; improving the polylog factors is open.
3. **Parallel / work-efficient cut-vertex detection.** Linear-work, polylog-depth PRAM algorithms exist (via Euler tours and tree contraction), but practical, cache-efficient parallel implementations that beat a good sequential iterative DFS on real graphs remain elusive.
4. **Streaming / semi-streaming.** Computing bridges in `O(V polylog V)` space with few passes over the edge stream, with matching lower bounds, is partially understood; tight pass/space trade-offs for biconnectivity are open.
5. **Sensitivity / certificates.** Sparse certificates of `k`-connectivity (Nagamochi–Ibaraki) give `O(kV)`-edge subgraphs preserving connectivity up to `k`; for `k = 1` this is just a spanning forest plus one extra edge per 2ECC, but optimal incremental maintenance of such certificates is still being refined.

---

## 13. Summary

- **Definitions.** A cut vertex `u` satisfies `c(G − u) > c(G)`; a bridge `e` satisfies `c(G − e) > c(G)`. They are the `k = 1` cases of vertex- and edge-connectivity (`κ = 1`, `λ = 1`).
- **Criteria (exact inequalities).** With `disc`/`low` from a DFS: a non-root `u` is a cut vertex iff some child `v` has `low[v] ≥ disc[u]` (**non-strict**); the root is a cut vertex iff it has ≥ 2 DFS children; a tree edge `(u, v)` is a bridge iff `low[v] > disc[u]` (**strict**). The boundary `low[v] = disc[u]` is exactly where `u` is a cut vertex but `(u, v)` is *not* a bridge.
- **Correctness** rests on Proposition 1.6 (undirected DFS has only tree and back edges), giving clean proofs that `low[v]` measures the shallowest escape of `T(v)`.
- **Complexity** is `Θ(V + E)` time, `Θ(V)` space — optimal, since the input must be read; no average-case speedup exists.
- **Decomposition.** Cuts and bridges induce the biconnected components (edge partition), the block-cut tree, the 2-edge-connected components (vertex partition), and the bridge tree — all extractable in the same linear pass.
- **Menger** ties it all together: cut vertices and bridges are the degenerate single-element cuts at the foundation of the connectivity hierarchy, with general `k` handled by flow (`23-edge-vertex-connectivity`).
- **Open frontiers** are the fully-dynamic and streaming versions; the insertion-only online case appears in `30-online-bridges`.

References: Tarjan (1972) *Depth-First Search and Linear Graph Algorithms*; Hopcroft–Tarjan (1973) biconnected components; Menger (1927); Schmidt (2013) chain decomposition; Holm, de Lichtenberg, Thorup (2001) fully-dynamic connectivity; Nagamochi–Ibaraki sparse certificates.
