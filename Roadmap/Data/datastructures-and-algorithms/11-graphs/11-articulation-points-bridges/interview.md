# Articulation Points & Bridges — Interview Preparation

Articulation points and bridges are a favorite interview topic because they sit on a single, elegant DFS that most candidates *almost* get right — and the "almost" is exactly what interviewers probe: the root special case, the strict-versus-non-strict inequality, the parent-edge skip, and recursion depth. LeetCode's "Critical Connections in a Network" (1192) is the bridge problem in disguise and shows up constantly. This file is a graded question bank plus end-to-end coding challenges in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Concept | Rule |
|---------|------|
| Articulation point (non-root) | child `v` with `low[v] >= disc[u]` |
| Articulation point (root) | `>= 2` DFS-tree children |
| Bridge (tree edge `u-v`) | `low[v] > disc[u]` (strict) |
| Back-edge relaxation | `low[u] = min(low[u], disc[v])` |
| Tree-edge relaxation | `low[u] = min(low[u], low[v])` |
| Skip incoming edge | `if v == parent: continue` (use edge id for multi-edges) |
| Multi-edge | a doubled edge is **never** a bridge |
| Complexity | `O(V + E)` time, `O(V)` space |

```text
disc[u] = low[u] = timer++          # first visit
tree edge (u,v): low[u] = min(low[u], low[v])
back edge (u,v): low[u] = min(low[u], disc[v])
cut vertex (non-root): low[v] >= disc[u]      # non-strict
cut vertex (root):     children >= 2
bridge:                low[v] >  disc[u]       # strict
```

---

## Junior Questions (12 Q&A)

### J1. What is an articulation point?
An articulation point (cut vertex) is a vertex whose removal — along with its incident edges — increases the number of connected components of an undirected graph. Intuitively it is a single point of failure: remove it and part of the graph can no longer reach the rest.

### J2. What is a bridge?
A bridge (cut edge) is an edge whose removal increases the number of connected components. It is a link with no redundant alternative path — the only connection between the two sides.

### J3. What does `disc[u]` mean?
`disc[u]` is the discovery time: a counter value stamped on `u` the first time DFS visits it. A smaller `disc` means earlier discovery and a position higher (closer to the root) in the DFS tree.

### J4. What does `low[u]` mean?
`low[u]` is the smallest discovery time reachable from `u`'s DFS subtree using tree edges downward and at most one back edge upward. It tells you the shallowest ancestor the subtree under `u` can "escape" to.

### J5. What is the articulation-point criterion for a non-root vertex?
A non-root vertex `u` is an articulation point if it has a DFS-tree child `v` with `low[v] >= disc[u]`. This means nothing under `v` can reach above `u`, so `u` is the only connection.

### J6. Why is the root a special case?
The non-root test would always falsely flag the root (since `disc[root] = 0` is the minimum). Instead, the root is an articulation point if and only if it has two or more DFS-tree children — meaning it is the only thing joining those subtrees.

### J7. What is the bridge criterion?
A tree edge `(u, v)` is a bridge if `low[v] > disc[u]` (strict inequality). The subtree under `v` cannot even reach `u`, so the edge is the sole connection.

### J8. Why is the bridge test strict (`>`) but the cut-vertex test non-strict (`>=`)?
`low[v] > disc[u]` means `v`'s subtree cannot reach `u` at all — only the edge connects them, so it is a bridge. `low[v] == disc[u]` means there is a back edge to `u`, providing an alternate route, so the edge is not a bridge — but `u` can still be a cut vertex, which is why that test uses `>=`.

### J9. Why do we skip the parent edge in DFS?
In an undirected graph, the edge you came in on appears in the neighbor list. If you treat it as a back edge you wrongly lower `low[u]`. You skip the edge you arrived on (by parent vertex, or by parent edge id when multi-edges exist).

### J10. What is the time complexity?
`O(V + E)` — a single DFS that examines each vertex once and each edge twice (once from each endpoint). Space is `O(V)` for the `disc`, `low`, and `visited` arrays plus the recursion stack.

### J11. Can a graph have articulation points but no bridges?
Yes. Two triangles sharing a single vertex: that shared vertex is an articulation point, but every edge lies on a cycle, so there are no bridges. Cut vertices and bridges are related but independent.

### J12. Do these concepts apply to directed graphs?
No. Articulation points and bridges are defined for undirected graphs. For directed connectivity you use strongly connected components (Tarjan's SCC), which use the same `disc`/`low` timestamp idea but with different rules.

---

## Middle Questions (12 Q&A)

### M1. Walk through computing `low[u]`.
Initialize `low[u] = disc[u]` on first visit. For each neighbor `v`: if `v` is unvisited, recurse and set `low[u] = min(low[u], low[v])`; if `v` is visited and not the parent, it is a back edge, so `low[u] = min(low[u], disc[v])`. Skip the edge you arrived on.

### M2. Why use `disc[v]` (not `low[v]`) for a back edge?
A back edge gives a direct jump to ancestor `v`, whose discovery time is `disc[v]`. Using `low[v]` would over-credit reachability and, although it happens to give correct cut/bridge answers in the undirected case, it is conceptually wrong and breaks in the directed SCC generalization. The disciplined rule: `disc` for back edges, `low` for children.

### M3. How do you find bridges and articulation points in one pass?
They share the entire `disc`/`low` DFS. For each tree edge `(u, v)`, after recursing into `v`: apply `low[v] >= disc[u]` for the cut-vertex flag (non-root) and `low[v] > disc[u]` for the bridge. The root uses the children-count rule. No second pass is needed.

### M4. What is a biconnected component?
A maximal subgraph with no articulation point — equivalently, every pair of edges lies on a common simple cycle. Biconnected components partition the *edges* of the graph; a cut vertex belongs to multiple components.

### M5. What is a 2-edge-connected component?
A maximal subgraph with no bridge — you cannot disconnect it by removing a single edge. The 2-edge-connected components are exactly the pieces left after deleting all bridges, and they partition the *vertices*.

### M6. What is the block-cut tree?
A tree with one node per biconnected component (block) and one node per articulation point, connecting each cut vertex to every block containing it. It turns "is there a single point of failure between A and B?" into a tree-path query.

### M7. What is the bridge tree?
Contract each 2-edge-connected component to a single node; the remaining edges between them are exactly the bridges. The number of bridges on the tree path between two vertices is the number of critical edges separating them.

### M8. How do you handle multi-edges correctly for bridges?
Skip the *specific edge id* you arrived on instead of the parent vertex. Then a second parallel edge between the same pair acts as a back edge, giving `low[v] <= disc[u]` and correctly preventing the edge from being reported as a bridge. A doubled edge is never a bridge.

### M9. How do you extract biconnected components in code?
Push edges onto a stack as you traverse them. When a child `v` of `u` satisfies `low[v] >= disc[u]`, pop edges off the stack down to and including `(u, v)` — those form one biconnected component.

### M10. Can an articulation point be incident to no bridge?
Yes. A vertex shared by two cycles is a cut vertex, but each incident edge lies on a cycle, so none is a bridge. Conversely, both endpoints of a bridge are usually (but not always) cut vertices — a degree-1 endpoint of a bridge is not a cut vertex.

### M11. How would you verify your implementation?
Write a brute-force oracle that removes each vertex/edge and re-counts connected components, then compare against the fast `disc`/`low` result on many random small graphs. Mismatches usually trace to the root case or the inequality direction.

### M12. What is the connection to Tarjan's SCC?
Both use `disc`/`low` timestamps from a single DFS. SCC works on directed graphs with an on-stack membership test; cut vertices/bridges work on undirected graphs with the `>=`/`>` criteria. Learning one makes the other easy.

---

## Senior Questions (10 Q&A)

### S1. How do you avoid stack overflow on a deep graph?
Convert the recursive DFS to an iterative one with an explicit heap-allocated stack. Track an iterator index per vertex (where you left off in its neighbor list) and apply the post-processing (`low` folding and the criteria) when you pop a vertex. Same `O(V + E)`, no recursion-depth limit.

### S2. How do these concepts apply to system reliability?
In a service-dependency or network-topology graph, articulation points are services/routers whose failure partitions the system, and bridges are links with no redundancy. Running this analysis on a topology snapshot surfaces single points of failure before they cause an outage.

### S3. How would you keep the analysis fresh as topology changes?
Recompute on topology-change events or on a short schedule, and diff against the previous snapshot to alert only on *newly introduced* single points of failure. For high-churn graphs, use incremental/online bridge maintenance instead of full recompute.

### S4. Can you parallelize the algorithm?
Not a single DFS — the `low` recurrence is a dependency chain. You can parallelize across connected components (each is independent) and pipeline ingestion of the next snapshot while analyzing the current one. Forcing threads onto one traversal needs locks and usually runs slower.

### S5. How big a graph fits on one machine?
Side tables are `O(V)` (a few hundred MB at 10⁷ vertices) and a CSR adjacency for 10⁸ edges is under a GB. One fat node with an iterative DFS handles 10⁸-edge graphs in seconds. Leave a single node only for out-of-RAM graphs, many independent snapshots, or sub-second freshness needs.

### S6. What metrics would you emit?
Articulation-point count and bridge count (trend for resilience regressions), analysis duration (detect graph growth), DFS max depth (confirm you need the iterative path), new-SPOF counter (diff-based alert), and snapshot staleness (are you analyzing reality?).

### S7. How does this relate to general k-connectivity?
Articulation points and bridges are the `k = 1` cases of vertex and edge connectivity. General `k` requires max-flow (Menger's theorem), which is far more expensive; the single-DFS `disc`/`low` method is the linear-time specialization for `k = 1`.

### S8. What is a real failure mode in production?
Treating a directed service-call graph as undirected — cut vertices/bridges assume symmetric reachability. If "A depends on B" does not imply "B depends on A," you need SCCs instead. Other traps: multi-edges and self-loops from messy CMDB data, and disconnected input analyzed from a single start vertex.

### S9. How would you answer "is the A-to-B route through a single point of failure?" at scale?
Build the block-cut tree once per snapshot, preprocess it for LCA, then each query is a tree-path check in `O(log n)`. The cut vertices on the BC-tree path between A's and B's blocks are exactly the single points of failure. The bridge tree answers the edge version.

### S10. How would you recommend the single most valuable redundant link to add?
On the bridge tree, adding an edge between two nodes makes the entire tree path between them 2-edge-connected, collapsing every bridge on that path. Pick the path covering the most bridges (or the most critical ones). This is cheap because the bridge tree is small.

---

## Professional Questions (8 Q&A)

### P1. State and prove why `low[v] >= disc[u]` makes a non-root `u` a cut vertex.
`low[v]` is the shallowest vertex reachable from `v`'s subtree via one back edge. If `low[v] >= disc[u]`, no edge from the subtree reaches a proper ancestor of `u`; since undirected DFS has only tree and back edges, every path from the subtree to anything above `u` must pass through `u`. Removing `u` disconnects the subtree — so `u` is a cut vertex.

### P2. Why exactly does the strict inequality separate bridges from non-bridges?
`low[v] > disc[u]` means the subtree cannot reach `u` or above — the only connection is the edge `(u, v)`, so it is a bridge. `low[v] == disc[u]` means a back edge reaches `u`, forming a cycle through `(u, v)`, so deleting the edge keeps connectivity. The equality case is precisely "cut vertex yes, bridge no."

### P3. Prove non-tree edges can never be bridges.
A back edge `(x, w)` (with `w` an ancestor) lies on the cycle formed with the tree path from `w` down to `x`. Deleting an edge on a cycle cannot disconnect the graph, since the rest of the cycle provides an alternate path. Hence only tree edges can be bridges.

### P4. Why is the block-cut tree actually a tree?
A cycle in the block-cut graph would alternate blocks and cut vertices forming a cycle of blocks; but blocks on such a cycle could be merged into a single larger 2-connected block, contradicting the maximality of biconnected components. So the structure is acyclic, and it is connected iff the graph is.

### P5. How is this related to Menger's theorem?
Menger: max internally-disjoint paths = min vertex cut (and the edge analog). A graph is 2-vertex-connected iff every pair has 2 disjoint paths iff it has no articulation point; 2-edge-connected iff no bridge. So cut vertices and bridges are the size-1 cuts at the base of the connectivity hierarchy.

### P6. What is the space lower bound?
`Omega(V)` — you must at least remember which vertices are visited. You cannot do cut/bridge detection in `o(V)` space without multiple passes over the graph (the space-restricted streaming setting has its own results). Time is `Theta(V + E)`, optimal because the input must be read.

### P7. What is Schmidt's chain decomposition?
A 2013 method that computes the same cuts, bridges, and 2-/3-connectivity certificates using a DFS plus a partition of edges into "chains," without maintaining a `low` array. Some find it conceptually cleaner; an edge is a bridge iff it is in no chain, and a vertex is a cut vertex under a simple chain condition.

### P8. What is open in the dynamic setting?
Fully-dynamic (insert *and* delete) 2-edge-connectivity is solved with `O(log² n)` amortized updates (Holm–de Lichtenberg–Thorup), but reducing constants and achieving good worst-case (not just amortized) bounds is open, as is fully-dynamic biconnectivity with optimal factors. Insertion-only online bridges are simpler (`30-online-bridges`).

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you used graph connectivity analysis in a real system.
Look for a concrete story: the problem (e.g., finding single points of failure in a service-dependency graph), the alternatives considered (manual review, naive remove-and-check), why the single-DFS approach won (linear time, ran in CI on every topology change), and what was measured. Strong answers cite numbers and mention how the result was surfaced (a dashboard, an alert).

### B2. Design a system that detects single points of failure in a microservice topology.
Expected: ingest topology from the service mesh / CMDB, build an undirected graph (being explicit about whether dependencies are symmetric — if not, use SCCs), run an iterative `disc`/`low` DFS, produce cut vertices and bridges plus the block-cut tree, diff against the previous run, and alert on *new* SPOFs. Discuss freshness, the directed-vs-undirected subtlety, and avoiding alert storms on planned changes.

### B3. Design a network redundancy planner.
Compute bridges and the bridge tree on the current topology. A bridge is a link with no backup. To recommend the single most valuable redundant link, find the bridge-tree path covering the most (or most critical) bridges; adding one edge across it collapses all those bridges. Discuss cost weighting, what-if simulation, and presenting the trade-off to operators.

### B4. A junior asks: "Why not just remove each node and re-check connectivity?"
Explain that remove-and-check is `O(V·(V+E))`, quadratic and impractical beyond tiny graphs, whereas the single DFS finds everything in `O(V + E)`. Frame remove-and-check as a useful *test oracle* on small random graphs, not a production algorithm. Use it as a teaching moment about asymptotic thinking.

### B5. Your SPOF detector started paging everyone after a deploy. How do you investigate?
First confirm the snapshot is fresh and matches reality, not a stale or half-ingested topology. Check whether a planned change (decommissioning redundant links) legitimately increased the SPOF count. Move to diff-based alerting (alert on the *delta*, not the absolute count) with maintenance-window suppression. Then verify the graph was not accidentally symmetrized from directed data, which can fabricate cut vertices.

---

## Coding Challenges

### Challenge 1: Critical Connections in a Network (Bridges)

**Problem.** (LeetCode 1192.) There are `n` servers numbered `0..n-1` connected by undirected `connections`. A *critical connection* is a connection whose removal makes some server unreachable from some other — i.e. a **bridge**. Return all critical connections in any order.

**Example.**
```text
n = 4, connections = [[0,1],[1,2],[2,0],[1,3]]
Output: [[1,3]]   // the triangle 0-1-2 has no bridge; 1-3 is the only critical link
```

**Constraints.** `2 <= n <= 10^5`, `n-1 <= len(connections) <= 10^5`, no duplicate connections.

**Approach.** Single `disc`/`low` DFS. Edge `(u, v)` is a bridge iff `low[v] > disc[u]`. `O(V + E)`.

**Go.**
```go
package main

import "fmt"

func criticalConnections(n int, connections [][]int) [][]int {
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
	var res [][]int
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
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
					res = append(res, []int{u, v})
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
	fmt.Println(criticalConnections(4, [][]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}}))
}
```

**Java.**
```java
import java.util.*;

public class CriticalConnections {
    int timer = 0;
    int[] disc, low;
    List<List<Integer>> adj;
    List<List<Integer>> res = new ArrayList<>();

    public List<List<Integer>> criticalConnections(int n, List<List<Integer>> connections) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (List<Integer> c : connections) {
            adj.get(c.get(0)).add(c.get(1));
            adj.get(c.get(1)).add(c.get(0));
        }
        disc = new int[n];
        low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        return res;
    }

    private void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) res.add(Arrays.asList(u, v));
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    public static void main(String[] args) {
        var conns = Arrays.asList(
            Arrays.asList(0, 1), Arrays.asList(1, 2),
            Arrays.asList(2, 0), Arrays.asList(1, 3));
        System.out.println(new CriticalConnections().criticalConnections(4, conns));
    }
}
```

**Python.**
```python
import sys
from typing import List


def critical_connections(n: int, connections: List[List[int]]) -> List[List[int]]:
    adj = [[] for _ in range(n)]
    for a, b in connections:
        adj[a].append(b)
        adj[b].append(a)
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    res = []

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
                    res.append([u, v])
            else:
                low[u] = min(low[u], disc[v])

    sys.setrecursionlimit(1 << 20)
    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    return res


if __name__ == "__main__":
    print(critical_connections(4, [[0, 1], [1, 2], [2, 0], [1, 3]]))
```

**Follow-up.** If the graph were huge and deep, the recursive DFS overflows — rewrite iteratively with an explicit stack (see senior level). Duplicate connections (multi-edges) would require skipping by edge id, since a doubled edge is never a bridge.

---

### Challenge 2: Find All Articulation Points

**Problem.** Given an undirected graph with `n` vertices and an edge list, return all articulation points (cut vertices).

**Example.**
```text
n = 5, edges = [[0,1],[1,2],[2,0],[1,3],[3,4]]
Output: [1, 3]   // removing 1 splits {3,4}; removing 3 splits {4}
```

**Constraints.** `1 <= n <= 10^5`, graph may be disconnected.

**Approach.** Single DFS. Non-root `u` is a cut vertex if some child `v` has `low[v] >= disc[u]`; the root is a cut vertex if it has `>= 2` children.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func articulationPoints(n int, edges [][]int) []int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	isAP := make([]bool, n)
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		children := 0
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				children++
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if parent != -1 && low[v] >= disc[u] {
					isAP[u] = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if parent == -1 && children >= 2 {
			isAP[u] = true
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	var res []int
	for i := 0; i < n; i++ {
		if isAP[i] {
			res = append(res, i)
		}
	}
	sort.Ints(res)
	return res
}

func main() {
	fmt.Println(articulationPoints(5, [][]int{{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}}))
}
```

**Java.**
```java
import java.util.*;

public class ArticulationPoints {
    int timer = 0;
    int[] disc, low;
    boolean[] isAP;
    List<List<Integer>> adj;

    public List<Integer> find(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            adj.get(e[1]).add(e[0]);
        }
        disc = new int[n];
        low = new int[n];
        isAP = new boolean[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        List<Integer> res = new ArrayList<>();
        for (int i = 0; i < n; i++) if (isAP[i]) res.add(i);
        return res;
    }

    private void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        int children = 0;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                children++;
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (parent != -1 && low[v] >= disc[u]) isAP[u] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (parent == -1 && children >= 2) isAP[u] = true;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}};
        System.out.println(new ArticulationPoints().find(5, edges));
    }
}
```

**Python.**
```python
import sys
from typing import List


def articulation_points(n: int, edges: List[List[int]]) -> List[int]:
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    disc = [-1] * n
    low = [0] * n
    is_ap = [False] * n
    timer = [0]

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        children = 0
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                children += 1
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if parent != -1 and low[v] >= disc[u]:
                    is_ap[u] = True
            else:
                low[u] = min(low[u], disc[v])
        if parent == -1 and children >= 2:
            is_ap[u] = True

    sys.setrecursionlimit(1 << 20)
    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    return [i for i in range(n) if is_ap[i]]


if __name__ == "__main__":
    print(articulation_points(5, [[0, 1], [1, 2], [2, 0], [1, 3], [3, 4]]))
```

**Follow-up.** Note `3` is a cut vertex (its only child `4` has `low[4] = disc[3]`, satisfying `>=`) even though edge `3-4` *is* also a bridge — articulation points and bridges can coincide. A degree-1 vertex like `4` is never a cut vertex.

---

### Challenge 3: Minimum Number of Days to Disconnect Island

**Problem.** (LeetCode 1568, modeled with connectivity.) Given a binary grid where `1` is land and `0` is water, the island is connected if all land cells form one 4-connected component. Return the minimum number of days to disconnect the island, where each day you may turn one land cell into water. The answer is always `0`, `1`, or `2`.

**Key insight.** If the grid is already disconnected (0 or ≥2 land components), the answer is `0`. Otherwise, if **any land cell is an articulation point** of the land graph, removing it disconnects the island → answer `1`. Otherwise the answer is `2` (any connected land mass can be split by removing at most two cells — e.g. the two neighbors of a corner cell).

**Approach.** Count components; if not exactly 1, return 0. Else check for an articulation point in the land graph (build a graph over land cells with grid adjacency, run the cut-vertex DFS). If found, return 1, else 2.

**Go.**
```go
package main

import "fmt"

func countComponents(grid [][]int) int {
	r, c := len(grid), len(grid[0])
	seen := make([][]bool, r)
	for i := range seen {
		seen[i] = make([]bool, c)
	}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	var dfs func(i, j int)
	dfs = func(i, j int) {
		seen[i][j] = true
		for _, d := range dirs {
			ni, nj := i+d[0], j+d[1]
			if ni >= 0 && ni < r && nj >= 0 && nj < c && grid[ni][nj] == 1 && !seen[ni][nj] {
				dfs(ni, nj)
			}
		}
	}
	cnt := 0
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if grid[i][j] == 1 && !seen[i][j] {
				cnt++
				dfs(i, j)
			}
		}
	}
	return cnt
}

func minDays(grid [][]int) int {
	if countComponents(grid) != 1 {
		return 0
	}
	r, c := len(grid), len(grid[0])
	// brute single-cell removal is simplest and within bounds (small grids):
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if grid[i][j] == 1 {
				grid[i][j] = 0
				if countComponents(grid) != 1 {
					grid[i][j] = 1
					return 1
				}
				grid[i][j] = 1
			}
		}
	}
	return 2
}

func main() {
	fmt.Println(minDays([][]int{{0, 1, 1, 0}, {0, 1, 1, 0}, {0, 0, 0, 0}})) // 2
	fmt.Println(minDays([][]int{{1, 1}}))                                    // 2
}
```

**Java.**
```java
public class MinDaysDisconnect {
    int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    int countComponents(int[][] g) {
        int r = g.length, c = g[0].length, cnt = 0;
        boolean[][] seen = new boolean[r][c];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                if (g[i][j] == 1 && !seen[i][j]) { cnt++; dfs(g, seen, i, j); }
        return cnt;
    }

    void dfs(int[][] g, boolean[][] seen, int i, int j) {
        seen[i][j] = true;
        for (int[] d : dirs) {
            int ni = i + d[0], nj = j + d[1];
            if (ni >= 0 && ni < g.length && nj >= 0 && nj < g[0].length
                    && g[ni][nj] == 1 && !seen[ni][nj]) dfs(g, seen, ni, nj);
        }
    }

    public int minDays(int[][] g) {
        if (countComponents(g) != 1) return 0;
        int r = g.length, c = g[0].length;
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                if (g[i][j] == 1) {
                    g[i][j] = 0;
                    if (countComponents(g) != 1) { g[i][j] = 1; return 1; }
                    g[i][j] = 1;
                }
        return 2;
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 1, 1, 0}, {0, 1, 1, 0}, {0, 0, 0, 0}};
        System.out.println(new MinDaysDisconnect().minDays(grid)); // 2
    }
}
```

**Python.**
```python
from typing import List


def count_components(grid: List[List[int]]) -> int:
    r, c = len(grid), len(grid[0])
    seen = [[False] * c for _ in range(r)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]

    def dfs(i, j):
        stack = [(i, j)]
        seen[i][j] = True
        while stack:
            x, y = stack.pop()
            for dx, dy in dirs:
                nx, ny = x + dx, y + dy
                if 0 <= nx < r and 0 <= ny < c and grid[nx][ny] == 1 and not seen[nx][ny]:
                    seen[nx][ny] = True
                    stack.append((nx, ny))

    cnt = 0
    for i in range(r):
        for j in range(c):
            if grid[i][j] == 1 and not seen[i][j]:
                cnt += 1
                dfs(i, j)
    return cnt


def min_days(grid: List[List[int]]) -> int:
    if count_components(grid) != 1:
        return 0
    r, c = len(grid), len(grid[0])
    for i in range(r):
        for j in range(c):
            if grid[i][j] == 1:
                grid[i][j] = 0
                if count_components(grid) != 1:
                    grid[i][j] = 1
                    return 1
                grid[i][j] = 1
    return 2


if __name__ == "__main__":
    print(min_days([[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]]))  # 2
```

**Follow-up.** The single-cell-removal scan is `O((rc)²)` and fine for the constraint grids. The asymptotically better version builds an articulation-point DFS over the land graph (each land cell a vertex, grid adjacency the edges) and checks for any cut vertex in one `O(rc)` pass — directly applying this topic's algorithm instead of remove-and-check.

---

### Challenge 4: Critical Routers (Articulation Points, named variant)

**Problem.** A data-center has `n` routers and a list of bidirectional `links`. A *critical router* is one whose failure disconnects some pair of still-alive routers — i.e. an **articulation point**. Return the sorted list of critical routers.

**Approach.** Identical to Challenge 2 (find all articulation points). This is the same problem under a reliability framing; interviewers often disguise the topic this way.

**Python (concise; Go/Java identical to Challenge 2).**
```python
import sys
from typing import List


def critical_routers(n: int, links: List[List[int]]) -> List[int]:
    adj = [[] for _ in range(n)]
    for a, b in links:
        adj[a].append(b)
        adj[b].append(a)
    disc = [-1] * n
    low = [0] * n
    ap = set()
    timer = [0]

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        children = 0
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                children += 1
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if parent != -1 and low[v] >= disc[u]:
                    ap.add(u)
            else:
                low[u] = min(low[u], disc[v])
        if parent == -1 and children >= 2:
            ap.add(u)

    sys.setrecursionlimit(1 << 20)
    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    return sorted(ap)


if __name__ == "__main__":
    print(critical_routers(7, [[0, 1], [0, 2], [1, 3], [2, 3], [2, 5], [5, 6], [3, 4]]))
```

**Follow-up.** A common extension asks for *critical links* (bridges) instead — same DFS, swap `>=` for `>` and report the edge. Recognizing that "critical router = articulation point" and "critical link = bridge" is exactly what the interviewer is checking.

---

## Common Pitfalls in Interviews

- **Forgetting the root special case.** The non-root test mis-flags the root. Always count root children `>= 2`.
- **Mixing up `>` and `>=`.** `>=` is articulation points, `>` is bridges. Say which one you mean before coding.
- **Treating the parent edge as a back edge.** Skip the edge you arrived on; with multi-edges, skip by edge id, not vertex.
- **Using `low[v]` for a back edge.** Use `disc[v]` for back edges and `low[v]` only for tree-edge children.
- **Not handling disconnected graphs.** Loop over all vertices and start a DFS on each unvisited one.
- **Recursion depth.** On `n = 10^5` chains, the recursive DFS can overflow — raise the limit (Python) or go iterative.
- **Reporting a doubled edge as a bridge.** A multi-edge is never a bridge; the edge-id skip prevents this.
- **Assuming directed.** These are undirected concepts; for directed connectivity reach for SCCs.

---

## What Interviewers Are Really Testing

A cut-vertex/bridge question is small enough to finish on a whiteboard but rich enough to expose depth. Interviewers are checking three things. **First, do you know the single-DFS framework cold** — `disc`, `low`, the two relaxations, and the two criteria — rather than reaching for the quadratic remove-and-check? Recognizing that "Critical Connections" is just bridges, and that "critical router" is just an articulation point, is the first filter. **Second, do you get the subtleties right**: the root special case, the strict-vs-non-strict inequality (and *why* it is exactly that, not arbitrary), the parent-edge skip, and multi-edge handling? These are where most candidates stumble, and getting them right signals real understanding over memorization. **Third, can you reason about scale and correctness**: explaining the `O(V + E)` bound, knowing the recursive version overflows on deep graphs and how to make it iterative, and being able to validate against a brute-force oracle. The strongest candidates also connect the dots upward — biconnected components, the block-cut and bridge trees, the link to SCCs and to Menger's theorem — showing the topic is one node in a connected map of graph theory, not an isolated trick.
