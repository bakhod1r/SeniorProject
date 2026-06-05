# Minimum Spanning Tree — Interview Preparation

> Kruskal, Prim, Borůvka, the cut/cycle properties, and the classic MST coding challenges — with answers calibrated from junior screens to staff-level system design.

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (12 Q&A)](#middle-questions-12-qa)
4. [Senior Questions (10 Q&A)](#senior-questions-10-qa)
5. [Professional Questions (8 Q&A)](#professional-questions-8-qa)
6. [Behavioral / System-Design Questions (5)](#behavioral--system-design-questions-5)
7. [Coding Challenges](#coding-challenges)
8. [Common Pitfalls in Interviews](#common-pitfalls-in-interviews)
9. [What Interviewers Are Really Testing](#what-interviewers-are-really-testing)

---

## Quick-Reference Cheat Sheet

| Fact | Value |
|------|-------|
| MST definition | Min-weight set of `V−1` edges connecting all vertices, no cycle. |
| Graph type | Connected, **undirected**, weighted. |
| Kruskal | Sort edges ↑; add if endpoints in different DSU sets. `O(E log E)`. |
| Prim | Grow tree; add cheapest crossing edge via heap. `O(E log V)`. |
| Prim array | `O(V²)` — best for **dense** graphs. |
| Borůvka | Each component picks cheapest outgoing edge; `O(E log V)`, parallel. |
| Cut property | Lightest edge across any cut is in some MST. |
| Cycle property | Heaviest edge on any cycle is in no MST. |
| Disconnected | → minimum spanning **forest** (`V − c` edges). |
| Unique MST? | Iff all edge weights distinct. |
| Max spanning tree | Flip the comparator. |
| Bottleneck tree | Any MST is also a min-bottleneck spanning tree. |
| Directed analog | Minimum arborescence (Chu–Liu/Edmonds), *not* MST. |
| Kruskal needs | Union-Find (DSU). |
| Prim needs | Priority queue / heap. |

---

## Junior Questions (12 Q&A)

**1. What is a minimum spanning tree?**
The cheapest subset of edges that connects every vertex of a weighted undirected graph without forming a cycle. It always has exactly `V − 1` edges.

**2. Why exactly `V − 1` edges?**
A tree on `V` vertices has `V − 1` edges: fewer and it is disconnected; more and it contains a cycle.

**3. What two algorithms compute an MST?**
Kruskal (sort edges, add non-cycle edges using Union-Find) and Prim (grow one tree, add the cheapest crossing edge using a priority queue). Borůvka is a third.

**4. What data structure does Kruskal rely on, and why?**
Union-Find / Disjoint-Set Union. It checks in near-constant time whether two endpoints are already connected, so we can reject edges that would form a cycle.

**5. What data structure does Prim rely on?**
A priority queue (binary heap) to repeatedly extract the cheapest edge leaving the current tree.

**6. Is the MST defined for directed graphs?**
No. MST is for undirected graphs. The directed analog is the minimum spanning arborescence (Chu–Liu/Edmonds).

**7. What happens if the graph is disconnected?**
There is no single spanning tree; you get a minimum spanning *forest* — one MST per connected component, with `V − (#components)` edges total.

**8. Can MST handle negative edge weights?**
Yes. Unlike Dijkstra, MST has no problem with negative weights because there is no path/relaxation concept — greedy on weights still works.

**9. Is the MST unique?**
Only when all edge weights are distinct. With ties, multiple MSTs of equal total weight may exist.

**10. What is the time complexity of Kruskal and Prim?**
Kruskal: `O(E log E) = O(E log V)`. Prim with a binary heap: `O(E log V)`. Prim with an array: `O(V²)`.

**11. How does Kruskal decide to accept an edge?**
It processes edges in ascending weight order and accepts an edge iff its two endpoints are in *different* components (`find(u) != find(v)`); otherwise the edge would close a cycle.

**12. Does the MST give the shortest path between two vertices?**
No. The MST minimizes total tree weight, not pairwise distances. Shortest paths are Dijkstra's job.

---

## Middle Questions (12 Q&A)

**1. State and explain the cut property.**
For any cut `(S, V∖S)`, the minimum-weight edge crossing it belongs to some MST. It is the reason greedy is safe: any spanning tree must cross the cut, and if it does not use the lightest crossing edge you can swap to it without increasing weight.

**2. State the cycle property.**
On any cycle, the strictly heaviest edge belongs to no MST — you could always remove it and reconnect with a lighter cycle edge.

**3. When do you pick Prim over Kruskal?**
On **dense** graphs (`E ≈ V²`), array-Prim's `O(V²)` beats Kruskal's `O(V² log V)`. On sparse graphs or when given an edge list, Kruskal is simpler and often faster.

**4. How do you compute a maximum spanning tree?**
Flip the comparison: sort edges descending in Kruskal or use a max-heap in Prim. The cut/cycle properties flip symmetrically.

**5. What is a minimum bottleneck spanning tree, and how is it related to the MST?**
It minimizes the *maximum* edge weight rather than the sum. Every MST is also a minimum bottleneck spanning tree (the converse need not hold).

**6. How do you find the second-best MST?**
Build the MST. For each non-tree edge `(u,v,w)`, find the maximum-weight edge on the tree path `u→v`; replacing it with `(u,v)` gives a candidate. The cheapest such swap is the second-best MST.

**7. How do you test whether the MST is unique?**
For each non-tree edge, if its weight is strictly greater than the max edge on its tree path, it cannot substitute; if some non-tree edge equals that max, an alternative MST exists. Unique iff all such comparisons are strict.

**8. Why is "lazy" Prim popular?**
It avoids implementing `decrease-key`: push every candidate edge to the heap and skip popped edges whose endpoint is already in the tree. Simpler code, `O(E)` heap entries.

**9. How does Borůvka work and why is it parallel-friendly?**
Each round, every component independently selects its cheapest outgoing edge; all chosen edges are merged at once. Components at least halve per round (`O(log V)` rounds), and the per-component minimum is an independent reduction — easy to parallelize.

**10. How would you cluster points using an MST?**
Build the MST; remove the `k − 1` heaviest edges; the `k` resulting components are the clusters. This is single-linkage clustering.

**11. How does the MST give a TSP approximation?**
For metric TSP, a preorder DFS walk of the MST yields a tour of cost ≤ `2 · w(MST) ≤ 2 · OPT`, a 2-approximation (Christofides improves to 1.5).

**12. What does Kruskal do on a graph with parallel edges and self-loops?**
Self-loops are always cycles and get rejected. Among parallel edges between the same pair, only the cheapest is ever accepted; the rest are rejected as cycle edges.

---

## Senior Questions (10 Q&A)

**1. Your graph has 10M points and you need clusters. The complete graph has 10¹⁴ edges. What do you do?**
Don't materialize the complete graph. Build an approximate `k`-NN graph (HNSW/FAISS) so `E = kV`, then run Borůvka/Kruskal on that sparse graph and cut the heaviest edges. Trades a little accuracy for tractability.

**2. How do you compute an MST when edges don't fit in RAM?**
External-memory Kruskal: sort the edges on disk (external merge sort), stream them through an in-memory Union-Find holding only `O(V)` state, stopping after `V−1` edges.

**3. How do you compute an MST across a cluster of machines?**
Distributed Borůvka on MapReduce/Spark: each round emits per-component candidate min edges, reduces to the minimum, merges, and relabels. Components shrink geometrically so few rounds dominate; co-partition edges by component to cut shuffle.

**4. What is GHS and when is it the right choice?**
Gallager–Humblet–Spira: an asynchronous message-passing distributed MST where each vertex is an autonomous processor knowing only its edges. Fragments merge across their minimum-weight outgoing edge. `O(V log V)` messages. Right for sensor/ad-hoc networks with no coordinator.

**5. Why doesn't Prim parallelize well?**
It grows a single frontier; each step depends on the previous tree state, serializing the algorithm. Borůvka, which processes all components independently per round, is the parallel choice.

**6. How do you make a distributed MST reproducible?**
Break weight ties by a total order on edge ids. Otherwise different runs return different (equally optimal) trees, breaking caching and diffs. Hash the sorted MST edge set as a determinism check.

**7. A clustering job "succeeds" but every point is its own cluster. What happened?**
The graph was disconnected (or the `k`-NN graph too sparse), so the MST is a forest of singletons. The MST returned `< V−1` edges silently. Always assert connectivity / edge count.

**8. How would you maintain an MST as edges are inserted over time?**
Use link-cut trees: inserting edge `(u,v,w)`, find the max edge on the current tree path `u→v`; if `w` is smaller, swap it in — `O(log V)` per insertion. Deletion is the hard direction (fully dynamic MST is more involved).

**9. Dense `O(V²)` array-Prim vs heap-Prim — why is array-Prim often faster despite the same input?**
On dense graphs array-Prim is `O(V²)` vs heap-Prim's `O(V² log V)`, and it sweeps a contiguous `minEdge` array with great cache locality and no pointer chasing, while heap operations jump around memory.

**10. What metrics would you monitor for an MST/clustering job?**
Components-remaining per Borůvka round (should ~halve), final edge count (must be `V−1` if connected), MST total weight, bottleneck (max edge), sort-vs-union phase timing for Kruskal, and a determinism hash.

---

## Professional Questions (8 Q&A)

**1. Why is greedy optimal for MST, in matroid terms?**
Forests of a graph are the independent sets of the graphic matroid; an MST is a minimum-weight basis. The greedy algorithm computes a minimum-weight basis of *any* matroid (Rado–Edmonds), so MST greedy is a special case.

**2. Prove the cut property.**
Take an MST `T ⊇ A`. If the lightest crossing edge `e ∉ T`, adding it makes one cycle that crosses the cut a second time at some `e'` with `w(e) ≤ w(e')`. Swap `e` for `e'`: still a spanning tree, weight non-increasing, so still an MST and now contains `A ∪ {e}`. Hence `e` is safe.

**3. What is Kruskal's complexity precisely, with Union-Find?**
`O(E log E)` for the sort plus `O(E α(V))` for the Union-Find operations (path compression + union by rank), so the sort dominates: `O(E log V)`. With integer weights and radix sort, effectively `O(E α(V))`.

**4. Give Prim's complexity with each heap.**
Binary heap: `O(E log V)`. `d`-ary heap with `d ≈ E/V`: `O(E log_{E/V} V)`. Fibonacci heap: `O(E + V log V)` (`O(1)` amortized decrease-key, `O(log V)` extract-min). Array: `O(V²)`.

**5. Describe Karger–Klein–Tarjan.**
Expected `O(E)` randomized MST: Borůvka-contract to shrink vertices, randomly sample each edge with prob ½ and recursively build the sampled MSF `F`, discard `F`-heavy edges (cycle property) via linear-time MST verification (Komlós/King), recurse on the surviving light edges. A sampling lemma bounds light edges by `O(V)`.

**6. What does Chazelle's algorithm achieve and how?**
Deterministic `O(E α(E,V))` MST using soft heaps — priority queues that allow a bounded fraction of corrupted (inflated) keys to get `O(1)` amortized operations, sidestepping the comparison-sort barrier.

**7. What's the expected MST weight of `K_n` with uniform random weights?**
It tends to `ζ(3) ≈ 1.202` as `n → ∞` (Frieze's theorem) — independent of `n`.

**8. What is the biggest open problem here?**
Whether a *deterministic linear-time* MST algorithm exists. Pettie–Ramachandran give a provably optimal deterministic algorithm, but its running time equals an unknown decision-tree complexity, so whether that equals `Θ(E)` is open.

---

## Behavioral / System-Design Questions (5)

**1. "Design a service that builds nightly hierarchical clusters of 100M user-embedding vectors."**
Approximate `k`-NN graph (FAISS/HNSW) → sparse edge list → distributed Borůvka MST on Spark → store the sorted MST edges as a dendrogram → serve cluster cuts (`k`) as `O(k)` reads. Discuss determinism (tie-break by id), connectivity handling (forest = isolated users), and incremental recompute.

**2. "We use MST to plan a backbone but a single failure splits the network. How do you fix the design?"**
MST is the cost floor but is only 1-edge-connected. Add redundancy: MST plus cheapest extra edge per critical cut, or solve a survivable (2-edge-connected) network design with MST as a warm start. Quantify cost vs availability trade-off.

**3. "Tell me about a time you chose a simpler algorithm over a fancier one."**
Frame: array-Prim (`O(V²)`) over Fibonacci-Prim (`O(E + V log V)`) for a dense graph because the constants and cache locality won and the code was far simpler to maintain and test.

**4. "How do you validate an MST implementation before shipping?"**
Brute-force checker on tiny graphs (enumerate spanning trees), property tests (result has `V−1` edges if connected, removing any tree edge disconnects, every non-tree edge is the max on its cycle), and cross-check Kruskal vs Prim totals on random graphs.

**5. "A teammate's Kruskal returns weights that are too low. How do you debug?"**
Almost certainly the Union-Find cycle check is missing or broken — it's accepting cycle edges. Verify `find(u) != find(v)` gates every accept, and that `union` actually merges. Add an assertion that accepted edges never reconnect already-connected components.

---

## Coding Challenges

### Challenge 1: Min Cost to Connect All Points (LeetCode 1584)

**Problem.** Given `points[i] = [xi, yi]`, the cost to connect two points is the Manhattan distance `|xi−xj| + |yi−yj|`. Return the minimum cost to connect all points. The graph is **complete** (dense), so use **array-Prim** `O(V²)`.

#### Go

```go
package main

import "fmt"

func minCostConnectPoints(points [][]int) int {
	n := len(points)
	if n <= 1 {
		return 0
	}
	abs := func(a int) int {
		if a < 0 {
			return -a
		}
		return a
	}
	dist := func(i, j int) int {
		return abs(points[i][0]-points[j][0]) + abs(points[i][1]-points[j][1])
	}
	const INF = 1 << 30
	inTree := make([]bool, n)
	minEdge := make([]int, n)
	for i := range minEdge {
		minEdge[i] = INF
	}
	minEdge[0] = 0
	total := 0
	for k := 0; k < n; k++ {
		u := -1
		for v := 0; v < n; v++ {
			if !inTree[v] && (u == -1 || minEdge[v] < minEdge[u]) {
				u = v
			}
		}
		inTree[u] = true
		total += minEdge[u]
		for v := 0; v < n; v++ {
			if !inTree[v] {
				if d := dist(u, v); d < minEdge[v] {
					minEdge[v] = d
				}
			}
		}
	}
	return total
}

func main() {
	fmt.Println(minCostConnectPoints([][]int{{0, 0}, {2, 2}, {3, 10}, {5, 2}, {7, 0}})) // 20
}
```

#### Java

```java
public class ConnectPoints {
    public int minCostConnectPoints(int[][] points) {
        int n = points.length;
        if (n <= 1) return 0;
        final int INF = Integer.MAX_VALUE;
        boolean[] inTree = new boolean[n];
        int[] minEdge = new int[n];
        java.util.Arrays.fill(minEdge, INF);
        minEdge[0] = 0;
        int total = 0;
        for (int k = 0; k < n; k++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inTree[v] && (u == -1 || minEdge[v] < minEdge[u])) u = v;
            inTree[u] = true;
            total += minEdge[u];
            for (int v = 0; v < n; v++) {
                if (!inTree[v]) {
                    int d = Math.abs(points[u][0] - points[v][0])
                          + Math.abs(points[u][1] - points[v][1]);
                    if (d < minEdge[v]) minEdge[v] = d;
                }
            }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(new ConnectPoints().minCostConnectPoints(
            new int[][]{{0,0},{2,2},{3,10},{5,2},{7,0}})); // 20
    }
}
```

#### Python

```python
def minCostConnectPoints(points):
    n = len(points)
    if n <= 1:
        return 0
    INF = float("inf")
    in_tree = [False] * n
    min_edge = [INF] * n
    min_edge[0] = 0
    total = 0
    for _ in range(n):
        u = -1
        for v in range(n):
            if not in_tree[v] and (u == -1 or min_edge[v] < min_edge[u]):
                u = v
        in_tree[u] = True
        total += min_edge[u]
        ux, uy = points[u]
        for v in range(n):
            if not in_tree[v]:
                d = abs(ux - points[v][0]) + abs(uy - points[v][1])
                if d < min_edge[v]:
                    min_edge[v] = d
    return total


if __name__ == "__main__":
    print(minCostConnectPoints([[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]]))  # 20
```

### Challenge 2: Connecting Cities With Minimum Cost (LeetCode 1135)

**Problem.** `n` cities (`1..n`), `connections[i] = [a, b, cost]`. Return the minimum cost to connect all cities, or `-1` if impossible. Edge list → **Kruskal**.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func minimumCost(n int, connections [][]int) int {
	sort.Slice(connections, func(i, j int) bool { return connections[i][2] < connections[j][2] })
	parent := make([]int, n+1)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	total, used := 0, 0
	for _, c := range connections {
		ra, rb := find(c[0]), find(c[1])
		if ra != rb {
			parent[ra] = rb
			total += c[2]
			used++
		}
	}
	if used == n-1 {
		return total
	}
	return -1
}

func main() {
	fmt.Println(minimumCost(3, [][]int{{1, 2, 5}, {1, 3, 6}, {2, 3, 1}})) // 6
	fmt.Println(minimumCost(4, [][]int{{1, 2, 3}, {3, 4, 4}}))            // -1
}
```

#### Java

```java
import java.util.*;

public class ConnectCities {
    int[] parent;
    int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }
    public int minimumCost(int n, int[][] connections) {
        Arrays.sort(connections, Comparator.comparingInt(c -> c[2]));
        parent = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        int total = 0, used = 0;
        for (int[] c : connections) {
            int ra = find(c[0]), rb = find(c[1]);
            if (ra != rb) { parent[ra] = rb; total += c[2]; used++; }
        }
        return used == n - 1 ? total : -1;
    }

    public static void main(String[] args) {
        ConnectCities s = new ConnectCities();
        System.out.println(s.minimumCost(3, new int[][]{{1,2,5},{1,3,6},{2,3,1}})); // 6
        System.out.println(s.minimumCost(4, new int[][]{{1,2,3},{3,4,4}}));         // -1
    }
}
```

#### Python

```python
def minimumCost(n, connections):
    connections.sort(key=lambda c: c[2])
    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, used = 0, 0
    for a, b, cost in connections:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            total += cost
            used += 1
    return total if used == n - 1 else -1


if __name__ == "__main__":
    print(minimumCost(3, [[1, 2, 5], [1, 3, 6], [2, 3, 1]]))  # 6
    print(minimumCost(4, [[1, 2, 3], [3, 4, 4]]))             # -1
```

### Challenge 3: Optimize Water Distribution in a Village (LeetCode 1168)

**Problem.** `n` houses. Build a well in house `i` for `wells[i]`, or lay a pipe `pipes[j] = [a, b, cost]`. Minimize total cost so every house has water. **Trick:** add a virtual node `0` (the "water source") with an edge of weight `wells[i]` to each house `i`, then run **Kruskal** on the `(n+1)`-node graph.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func minCostToSupplyWater(n int, wells []int, pipes [][]int) int {
	edges := make([][]int, 0, n+len(pipes))
	for i, w := range wells {
		edges = append(edges, []int{0, i + 1, w}) // virtual source node 0
	}
	for _, p := range pipes {
		edges = append(edges, []int{p[0], p[1], p[2]})
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n+1)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	total := 0
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += e[2]
		}
	}
	return total
}

func main() {
	fmt.Println(minCostToSupplyWater(3, []int{1, 2, 2}, [][]int{{1, 2, 1}, {2, 3, 1}})) // 3
}
```

#### Java

```java
import java.util.*;

public class WaterDistribution {
    int[] parent;
    int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }
    public int minCostToSupplyWater(int n, int[] wells, int[][] pipes) {
        List<int[]> edges = new ArrayList<>();
        for (int i = 0; i < n; i++) edges.add(new int[]{0, i + 1, wells[i]}); // node 0 = source
        for (int[] p : pipes) edges.add(p);
        edges.sort(Comparator.comparingInt(e -> e[2]));
        parent = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        int total = 0;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; total += e[2]; }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(new WaterDistribution().minCostToSupplyWater(
            3, new int[]{1,2,2}, new int[][]{{1,2,1},{2,3,1}})); // 3
    }
}
```

#### Python

```python
def minCostToSupplyWater(n, wells, pipes):
    edges = [(w, 0, i + 1) for i, w in enumerate(wells)]   # virtual source node 0
    edges += [(c, a, b) for a, b, c in pipes]
    edges.sort()
    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total = 0
    for cost, a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            total += cost
    return total


if __name__ == "__main__":
    print(minCostToSupplyWater(3, [1, 2, 2], [[1, 2, 1], [2, 3, 1]]))  # 3
```

### Challenge 4: Critical and Pseudo-Critical Edges in an MST (LeetCode 1489)

**Problem.** Given a weighted undirected graph, classify each edge: **critical** if its removal increases the MST weight (or disconnects the graph), **pseudo-critical** if it appears in *some* MST but is not critical. Approach: compute baseline MST weight; an edge is **critical** if excluding it raises the MST weight; if not critical, it is **pseudo-critical** if forcing it in keeps the MST weight at baseline.

#### Python

```python
def findCriticalAndPseudoCriticalEdges(n, edges):
    # tag each edge with its original index
    indexed = sorted(range(len(edges)), key=lambda i: edges[i][2])

    def mst(skip=-1, force=-1):
        parent = list(range(n))
        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        total, used = 0, 0
        if force != -1:                       # pre-include the forced edge
            a, b, w = edges[force]
            parent[find(a)] = find(b)
            total += w
            used += 1
        for i in indexed:
            if i == skip:
                continue
            a, b, w = edges[i]
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
                total += w
                used += 1
        return total if used == n - 1 else float("inf")

    base = mst()
    critical, pseudo = [], []
    for i in range(len(edges)):
        if mst(skip=i) > base:                # removing it worsens (or disconnects)
            critical.append(i)
        elif mst(force=i) == base:            # forcing it keeps optimum
            pseudo.append(i)
    return [critical, pseudo]


if __name__ == "__main__":
    edges = [[0,1,1],[1,2,1],[2,3,2],[0,3,2],[0,4,3],[3,4,3],[1,4,6]]
    print(findCriticalAndPseudoCriticalEdges(5, edges))  # [[0,1],[2,3,4,5]]
```

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func mstWeight(n int, edges [][]int, order []int, skip, force int) int {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	total, used := 0, 0
	if force != -1 {
		e := edges[force]
		parent[find(e[0])] = find(e[1])
		total += e[2]
		used++
	}
	for _, i := range order {
		if i == skip {
			continue
		}
		e := edges[i]
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += e[2]
			used++
		}
	}
	if used == n-1 {
		return total
	}
	return 1 << 30
}

func findCriticalAndPseudoCriticalEdges(n int, edges [][]int) [][]int {
	order := make([]int, len(edges))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return edges[order[a]][2] < edges[order[b]][2] })
	base := mstWeight(n, edges, order, -1, -1)
	crit, pseudo := []int{}, []int{}
	for i := range edges {
		if mstWeight(n, edges, order, i, -1) > base {
			crit = append(crit, i)
		} else if mstWeight(n, edges, order, -1, i) == base {
			pseudo = append(pseudo, i)
		}
	}
	return [][]int{crit, pseudo}
}

func main() {
	edges := [][]int{{0, 1, 1}, {1, 2, 1}, {2, 3, 2}, {0, 3, 2}, {0, 4, 3}, {3, 4, 3}, {1, 4, 6}}
	fmt.Println(findCriticalAndPseudoCriticalEdges(5, edges)) // [[0 1] [2 3 4 5]]
}
```

#### Java

```java
import java.util.*;

public class CriticalEdges {
    int[] parent;
    int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }
    int mst(int n, int[][] edges, Integer[] order, int skip, int force) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int total = 0, used = 0;
        if (force != -1) {
            int[] e = edges[force];
            parent[find(e[0])] = find(e[1]);
            total += e[2]; used++;
        }
        for (int i : order) {
            if (i == skip) continue;
            int[] e = edges[i];
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; total += e[2]; used++; }
        }
        return used == n - 1 ? total : Integer.MAX_VALUE;
    }
    public List<List<Integer>> findCriticalAndPseudoCriticalEdges(int n, int[][] edges) {
        Integer[] order = new Integer[edges.length];
        for (int i = 0; i < edges.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> edges[i][2]));
        int base = mst(n, edges, order, -1, -1);
        List<Integer> crit = new ArrayList<>(), pseudo = new ArrayList<>();
        for (int i = 0; i < edges.length; i++) {
            if (mst(n, edges, order, i, -1) > base) crit.add(i);
            else if (mst(n, edges, order, -1, i) == base) pseudo.add(i);
        }
        return List.of(crit, pseudo);
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1,1},{1,2,1},{2,3,2},{0,3,2},{0,4,3},{3,4,3},{1,4,6}};
        System.out.println(new CriticalEdges()
            .findCriticalAndPseudoCriticalEdges(5, edges)); // [[0, 1], [2, 3, 4, 5]]
    }
}
```

---

## Common Pitfalls in Interviews

- **Forgetting the cycle check** in Kruskal (no Union-Find) → wrong, too-small "MST."
- **Not handling disconnected graphs** → returning a forest as if it were a tree; for "connect all" problems return `-1`.
- **Using MST where shortest path is needed** (or vice versa) — interviewers plant this confusion.
- **Choosing heap-Prim on a dense / complete graph** when array-Prim `O(V²)` is the intended optimum (the "connect all points" trap).
- **Missing the virtual-node trick** in water-distribution-style problems.
- **Skipping the lazy-Prim stale check**, double-counting vertices.
- **Int overflow** on the total weight.
- **Claiming the MST is unique** without the distinct-weights caveat.

---

## What Interviewers Are Really Testing

| Signal | What they want to see |
|--------|-----------------------|
| Algorithm selection | You pick Kruskal vs Prim vs array-Prim based on **density and input format**, and say *why*. |
| Tooling fluency | You reach for Union-Find (Kruskal) and a heap (Prim) without reinventing them. |
| Modeling | You recognize disguised MSTs: "connect all points," "minimum cost to connect," water distribution (virtual node). |
| Correctness reasoning | You can state and justify the cut/cycle properties, not just memorize the code. |
| Edge-case discipline | Disconnected → forest / `-1`, ties → non-unique, overflow, self-loops. |
| Depth on demand | You can go from coding the loop to discussing Borůvka/distributed MST and the linear-time frontier. |
| Communication | You trace a small example by hand and narrate accept/reject decisions clearly. |
