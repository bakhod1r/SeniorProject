# Graph Representation — Interview Preparation

How you store a graph is the first decision in almost every graph interview, and it quietly decides whether the rest of your solution is fast or slow. Interviewers love this topic because it is small enough to whiteboard, yet it forces you to reason about the space-versus-speed trade-off, the operation mix of the algorithm you are about to write, and the density of the input. This file is a curated bank of questions sorted by seniority, plus behavioral prompts and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

`V` = number of vertices, `E` = number of edges, `d = degree(u)`.

| Operation | Adjacency Matrix | Adjacency List | Edge List | CSR |
|-----------|------------------|----------------|-----------|-----|
| **Space** | `O(V²)` | `O(V + E)` | `O(E)` | `O(V + E)` |
| **Has edge `u→v`?** | `O(1)` | `O(d)` | `O(E)` | `O(d)` / `O(log d)` sorted |
| **Iterate neighbors of `u`** | `O(V)` | `O(d)` | `O(E)` | `O(d)` |
| **Add edge** | `O(1)` | `O(1)` | `O(1)` | rebuild `O(V+E)` |
| **Remove edge** | `O(1)` | `O(d)` | `O(E)` | rebuild `O(V+E)` |
| **Iterate all edges** | `O(V²)` | `O(V + E)` | `O(E)` | `O(V + E)` |

Pick-the-representation rules of thumb:

```text
sparse graph (E ≈ V)         -> adjacency list (the default)
dense graph (E ≈ V²)         -> adjacency matrix
many "is there an edge?" Qs  -> adjacency matrix (or list + edge set)
sweep all edges (Kruskal,    -> edge list
   Bellman-Ford)
Floyd-Warshall / closure     -> adjacency matrix
static, hot, huge graph      -> CSR (compressed adjacency list)
grid / maze                  -> implicit graph (compute neighbors)
```

Build an adjacency list from an edge array (the single most-written graph snippet):

```text
adj = [[] for _ in range(V)]
for u, v in edges:
    adj[u].append(v)
    adj[v].append(u)   # undirected only
```

Invariants to restate before coding:

- **Directed vs undirected** — undirected means *two* insertions per edge (or symmetric matrix).
- **Weighted vs unweighted** — weighted lists store `(neighbor, weight)`; pick a "no edge" sentinel that no real weight can equal.
- **0-indexed vs 1-indexed** — convert once at read time, never mid-algorithm.

---

## Junior Questions (12 Q&A)

### J1. What is a graph?
A graph `G = (V, E)` is a set of vertices `V` and a set of edges `E`, where each edge joins two vertices. It is the most general structure for modelling relationships: social networks, road maps, web links, task dependencies. Trees, linked lists, and grids are all special cases of graphs. The definition says *what* a graph is, not *how* you store one — choosing the storage layout (matrix, list, or edge list) is a separate decision.

### J2. Name the three classic graph representations.
The **adjacency matrix** is a `V×V` grid where cell `(u, v)` records whether `u` connects to `v`. The **adjacency list** stores, for each vertex, a list of its neighbors. The **edge list** is a flat array of `(u, v)` pairs (plus a weight if weighted). All three describe the same graph; they differ only in what is cheap and what is expensive.

### J3. What is the space cost of each representation?
The matrix is `O(V²)` regardless of how many edges exist. The adjacency list is `O(V + E)`. The edge list is `O(E)`. For a sparse graph (`E ≈ V`), the list uses dramatically less memory than the matrix; for a dense graph (`E ≈ V²`) all three are `O(V²)` and the matrix's constant is smallest.

### J4. When would you use an adjacency matrix over an adjacency list?
Use the matrix when the graph is **dense** (most possible edges exist), when you need `O(1)` "is there an edge `u→v`?" lookups, or when the algorithm is matrix-shaped (Floyd-Warshall, transitive closure). For a small `V`, the `O(V²)` cost is also negligible. Otherwise, for the common sparse case, the adjacency list wins on both memory and neighbor-iteration speed.

### J5. How do you represent a directed vs undirected graph?
For **undirected**, set both `M[u][v]` and `M[v][u]` in the matrix, or append `v` to `adj[u]` *and* `u` to `adj[v]` in the list. For **directed**, set only `M[u][v]`, or append only `v` to `adj[u]`. The classic beginner bug is forgetting the second insertion for an undirected graph, which silently builds a directed graph.

### J6. How do you store edge weights?
In the **matrix**, store the weight in the cell instead of `1`, using a sentinel (`-1`, `+∞`) for "no edge" — never `0` if `0` is a legal weight. In the **list**, store `(neighbor, weight)` pairs. In the **edge list**, store `(u, v, w)` triples. Weighted algorithms like Dijkstra and Prim read the weight directly from these.

### J7. What is the degree of a vertex?
The degree is the number of edges touching a vertex. In a directed graph you distinguish **in-degree** (edges pointing in) from **out-degree** (edges pointing out). On an adjacency list, the out-degree of `u` is just `len(adj[u])`. On a matrix it is the count of nonzero cells in row `u`, which costs `O(V)` to compute.

### J8. How do you check if an edge `u→v` exists in each representation?
In the **matrix**, read `M[u][v]` — `O(1)`. In the **adjacency list**, scan `adj[u]` for `v` — `O(degree(u))`. In the **edge list**, scan every edge — `O(E)`. This single-edge query is exactly where the matrix shines and the edge list is worst.

### J9. How do you list the neighbors of a vertex?
In the **list**, return `adj[u]` directly — `O(degree(u))`, nothing wasted. In the **matrix**, scan the whole row of `V` cells — `O(V)` even if `u` has two neighbors. In the **edge list**, scan all `E` edges keeping those with source `u` — `O(E)`. Most algorithms iterate neighbors far more than they test single edges, which is why the list is the default.

### J10. What is a sparse graph vs a dense graph?
A graph is **sparse** when `E` is close to `V` (each vertex has a handful of neighbors) and **dense** when `E` is close to `V²` (almost every possible edge exists). Real-world graphs — road networks, social graphs, the web — are almost always sparse, which is why the adjacency list dominates in practice.

### J11. Why is the adjacency list the default in practice?
Because most graphs are sparse, so `O(V + E)` memory is far smaller than `O(V²)`, and because most algorithms (BFS, DFS, Dijkstra, topological sort) iterate a vertex's neighbors repeatedly, which the list does in optimal `O(degree)`. The matrix wastes memory on sparse graphs and pays `O(V)` per neighbor scan.

### J12 (analysis). Why does an adjacency matrix waste memory on a sparse graph?
The matrix allocates `V²` cells whether or not edges exist. For `V = 10⁶` vertices that is `10¹²` cells — terabytes — even if the graph has only `5×10⁶` edges. The list stores exactly `V + E` entries, so it scales with the actual edge count. Always estimate `V²` before allocating a matrix; for large sparse graphs it simply will not fit.

---

## Middle Questions (12 Q&A)

### M1. How do you convert an edge list into an adjacency list?
One pass: create `V` empty buckets, then for each `(u, v)` append `v` to `adj[u]` (and `u` to `adj[v]` if undirected). It is `O(V + E)`. This is the most common preprocessing step in graph problems, and the three-line snippet appears in nearly every BFS/DFS solution.

### M2. How do you convert an adjacency matrix to an adjacency list and back?
**Matrix → list:** scan every cell, `O(V²)`, emitting `v` into `adj[u]` wherever `M[u][v]` is set — unavoidable because you must inspect every possible edge. **List → matrix:** allocate `V²` cells, zero-fill (`O(V²)`), then set `M[u][v]` for each stored neighbor (`O(E)`). The matrix conversion is lossy for multigraphs because a `0/1` cell cannot represent parallel edges.

### M3. Which conversions lose information?
Converting a multigraph to a `0/1` matrix **collapses parallel edges** into one and loses per-edge identity (you cannot attach data beyond a single weight). Converting an edge list to anything loses nothing, but note an edge list alone cannot represent an **isolated vertex** without a separate vertex count.

### M4. What is CSR and why is it faster than a plain adjacency list?
CSR (Compressed Sparse Row) stores the adjacency list as two flat arrays: `offset[]` of length `V+1` marking where each vertex's neighbors begin, and `target[]` of length `E` holding all neighbor ids concatenated. The neighbors of `u` are `target[offset[u] : offset[u+1]]`. Because there is no per-vertex object and no pointer chasing, a full traversal reads `target[]` sequentially — cache-friendly — beating a `List<List<Integer>>` whose sub-lists are scattered across the heap.

### M5. How do you build CSR from an edge list?
A counting-sort-style two-pass: (1) count out-degrees into `offset[u+1]`, (2) prefix-sum `offset` so it holds start positions, (3) place each target into its slot using a separate `cursor` copy so you never mutate `offset`. It is `O(V + E)`. The catch is that CSR is effectively immutable: inserting an edge shifts every offset, so you rebuild rather than mutate.

### M6. What is an implicit graph and when do you use one?
An implicit graph is never stored; the adjacency relation is a *rule*. For a **grid**, the neighbors of `(r, c)` are the up-to-four orthogonal cells, computed with offset deltas — no storage beyond the grid. For a **state-space** graph (puzzle boards, Rubik's cube), vertices are configurations and edges are legal moves generated on demand. This trades `O(V+E)` storage for `O(1)`-per-neighbor computation, the only way to handle graphs too large to materialize.

### M7. Which representation does each classic algorithm prefer?
BFS, DFS, Dijkstra, Prim, and topological sort want an **adjacency list** (or CSR) — pure neighbor iteration. **Bellman-Ford** wants an **edge list** because it relaxes every edge `V−1` times. **Kruskal** wants an **edge list** because it sorts all edges by weight. **Floyd-Warshall** wants an **adjacency matrix** because `dist[i][j] = min(dist[i][j], dist[i][k]+dist[k][j])` is inherently matrix-shaped.

### M8. How do you store a weighted graph for Dijkstra?
A weighted adjacency list of `(neighbor, weight)` pairs, so when you pop a vertex you iterate its neighbors and read each edge's cost directly. In CSR you add a parallel `weight[]` array aligned with `target[]`, so `weight[k]` is the weight of the edge ending at `target[k]` — Dijkstra reads neighbor and weight together with perfect locality.

### M9. How do you represent a graph whose vertices are strings (not 0..V-1)?
Keep one hash map `label → id` at the input boundary, assign each new label the next integer id, and work with integers internally. This keeps all the core structures array-based (fast and cache-friendly) and isolates the string handling to the read step. Reverse with an `id → label` array if you need to print results.

### M10. How do you handle self-loops and parallel edges?
A **self-loop** `(v, v)` lands on the matrix diagonal `M[v][v]`; decide whether your traversal follows it. **Parallel edges** (two edges `(u, v)`) cannot be stored in a `0/1` matrix — it collapses them — so use a count matrix, or store neighbors in a *list* (not a set, which would dedupe them). Always document your convention, e.g. an undirected self-loop adds 2 to degree.

### M11. How much memory does each representation actually use for a million-vertex graph?
For `V = 10⁶`, `E = 5×10⁶` directed edges with 4-byte ints: the matrix is `~4 TB` (infeasible), a boxed `List<List<Integer>>` is roughly `150–250 MB` due to object overhead, and CSR (two `int[]`) is about `24 MB` and contiguous. This is why large sparse graphs use CSR or a primitive adjacency list, never a matrix.

### M12 (analysis). Why does an adjacency list have optimal Big-O but still lose cache races?
Asymptotically a list traversal is `O(V + E)`, but a `List<List<Integer>>` stores neighbors in scattered heap allocations, so walking many vertices jumps all over memory and defeats the CPU prefetcher. The constant is dominated by cache misses. CSR has the same `O(V + E)` asymptotics but packs everything into two contiguous arrays, recovering the optimal constant — typically `1.2–2×` faster on a full scan, more in compiled languages.

---

## Senior Questions (10 Q&A)

### S1. How do you store a graph that does not fit in one machine's RAM?
Partition it across `P` machines. **Edge-cut partitioning** assigns vertices to machines and cuts the edges between them (Pregel/Giraph); minimizing the cut is NP-hard, so hash partitioning (`hash(vertex) mod P`) is common. **Vertex-cut partitioning** assigns edges to machines and replicates vertices (PowerGraph/GraphX), which is far better for power-law graphs because a super-hub's edges are split across machines instead of overwhelming one. Cross-partition edges are the cost — each is a potential network hop.

### S2. When should you materialize a graph in memory versus query it from a database?
**Materialize** (build a CSR once, traverse it millions of times) when the graph fits in RAM and is read far more than written — the build cost amortizes to nothing. **Query on demand** when the graph is huge, you only ever touch a small neighborhood (a 2-hop friend recommendation touches thousands of edges out of billions), or it changes faster than you can rebuild. A common hybrid materializes a CSR snapshot for the hot core and falls back to the database for the long tail and writes.

### S3. How do you make a shared graph safe for many concurrent readers?
Use an **immutable CSR**: two flat arrays with no interior mutability are trivially thread-safe, so readers never lock or contend. To handle writes, do *not* mutate in place — buffer writes to a side log, periodically rebuild a fresh CSR snapshot, and atomically swap one pointer (`atomic.Value` in Go, `AtomicReference` in Java). New readers see the new snapshot; old readers finish on the old one. This is copy-on-write at whole-graph granularity, with bounded staleness as the trade-off.

### S4. How would you store a web-scale graph that is too big even for CSR?
Compress it. Sort each vertex's neighbor ids, store first-differences (gaps), and encode gaps with a byte-aligned varint or the WebGraph framework's reference compression. Exploiting locality (neighbors have nearby ids) and similarity (adjacent vertices share neighbor sets) drops storage from 32 bits/edge to `1–4 bits/edge`, letting a graph that would need 400 GB fit in 30 GB. The cost is `O(degree)` decode per neighbor scan — usually worth it because memory, not CPU, is the bottleneck.

### S5. What is a super-hub and why does it break naive representations?
A super-hub is a vertex with enormous degree (a celebrity with `10⁸` followers) that arises in power-law graphs. Any operation that materializes `neighbors(hub)` allocates a huge slice; hash partitioning dumps the whole hub on one machine, creating a hotspot. Mitigations: vertex-cut partitioning, streaming neighbor iteration (never copy the slice), and degree-capping or two-level hub handling.

### S6. How does vertex relabelling affect performance?
Reordering vertex ids so neighbors are numerically close (BFS order, Reverse Cuthill-McKee, or a space-filling curve for spatial graphs) increases the chance that `target[k]` and the subsequently dereferenced `offset[target[k]]` share a cache line. This is a pure constant-factor optimization invisible to Big-O, yet it routinely yields `2–5×` on real traversals. Losing this locality (e.g. after a re-import renumbers ids) silently slows traversals.

### S7. How do you choose between in-memory CSR, a graph database, and a distributed engine?
**In-memory CSR** when the graph fits in RAM, is read-heavy, and latency is critical (microsecond reads). **Graph database** (Neo4j, JanusGraph, Neptune) when you need durability, transactions, and ad-hoc mutable queries (millisecond reads). **Distributed engine** (Pregel, GraphX, Giraph) only when the graph genuinely does not fit on one large machine and you run whole-graph analytics. Modern machines hold tens of billions of edges, so reach for the cluster later than instinct suggests.

### S8. What does an out-of-core graph engine need from the representation?
It needs a layout that turns random graph access into **sequential disk I/O**. CSR's flat `offset`/`target` arrays let one `seek` plus one big `read` pull an entire vertex range's edges sequentially, which is exactly how GraphChi and X-Stream stream shards from disk. A pointer-based adjacency list can never be streamed this way because its sub-lists are scattered — CSR's contiguity is the enabling property.

### S9. How do you plan capacity for a large graph?
Plan in **bytes per edge**. Primitive CSR with `int32` ids is `~4 B/edge`; a boxed Java `List<Integer>` is `~16 B/edge`; compressed web graphs are under `1 B/edge`. For a social graph of `V = 2×10⁸` users at average degree 200 (`E = 4×10¹⁰`), primitive CSR is `~161 GB` (fits a large memory-optimized instance — materialize it), the boxed list is `~640 GB` (does not fit — shard or switch to CSR), and compressed CSR is `~40 GB`. The break point is predictable; compute it before you allocate.

### S10 (analysis). Why is `O(1)` `hasEdge` impossible without `Ω(V²)` space on a dense graph?
There are `2^C(V,2)` distinct simple undirected graphs on `V` labelled vertices, so any structure distinguishing all of them needs `≥ C(V,2) = Ω(V²)` bits. If `hasEdge(u, v)` is `O(1)` for arbitrary `(u, v)` with no query preprocessing, the structure must already encode every potential edge's status — that is the adjacency matrix, which is therefore space-optimal among `O(1)`-query structures. You cannot have both `O(1)` worst-case `hasEdge` and `o(V²)` space deterministically; per-vertex hash sets give `O(1)` *expected* by paying randomization.

---

## Professional Questions (8 Q&A)

### P1. How would you design a graph store serving billions of edges with millisecond reads?
Tier it. Keep the read-hot subgraph (recent, high-traffic vertices) as an in-memory compressed CSR for microsecond traversal, and serve cold queries from a durable graph database. A cache miss promotes a vertex's neighborhood into the hot tier. This bounds RAM while keeping the common case fast. Use immutable CSR plus atomic snapshot swap for lock-free concurrent reads, and instrument `graph_bytes_resident` against your capacity plan.

### P2. How do you keep a live, mutating graph consistent under heavy concurrent reads?
Route all writes through a single path: append to a delta log, periodically fold the deltas into a fresh immutable CSR snapshot, and publish it with an atomic pointer swap. Readers always dereference one atomic pointer and traverse lock-free immutable arrays — no `ConcurrentModificationException`, no torn reads. The trade-off is bounded staleness equal to the rebuild interval. If writes must be visible immediately, fall back to a concurrent adjacency list with lock striping by vertex id, sacrificing CSR's cache benefits.

### P3. Your traversal mysteriously slowed 3–5× after a data re-import. What happened?
Almost certainly lost vertex-order locality: the re-import renumbered vertex ids, so neighbors are no longer near each other in `target[]`, and the cache-miss rate spiked. Confirm with a cache-miss metric, then relabel vertices by a locality-preserving order (BFS order, or a space-filling curve for spatial graphs) before rebuilding CSR. The asymptotics never changed — only the constant, which is exactly what these incidents are about.

### P4. How do you detect that a distributed graph is badly partitioned?
Measure `partition_cross_edge_ratio` — the fraction of edges crossing machine boundaries. A high ratio means nearly every traversal step becomes a network hop, turning local reads into a message storm. Mitigate by repartitioning with a multilevel (metis-style) partitioner, or by switching edge-cut → vertex-cut for power-law graphs so super-hubs are split rather than concentrated. This metric catches failures that raw throughput numbers hide.

### P5. How would you choose the representation given an unknown future workload?
Default to a mutable adjacency list during development because it supports both reads and writes and is cheap to build. Profile the real operation mix and density. If the graph stabilizes (built once, read many), freeze it into an immutable CSR for the cache win. If it stays small or dense, a matrix may be simpler. Resist premature commitment to a matrix — its `O(V²)` is the one choice you cannot walk back without re-architecting when the graph grows.

### P6. How do you serialize and reload a large graph quickly?
CSR is two flat primitive arrays, so you dump `offset[]` and `target[]` straight to disk and `mmap` or read them back without any rebuild — no rehashing, no rebalancing. This is a major advantage over pointer-based structures, which must be reconstructed node by node. For compressed CSR, persist the encoded byte stream plus the offset index. Validate on load with cheap invariants (`offset` monotonic, `offset[V] == len(target)`).

### P7. How would you debug a "graph traversal visits too many nodes" production incident?
Add a `traversal_neighbors_visited` histogram and compare it against the expected fan-out. A spike usually means a new super-hub appeared (a vertex whose degree exploded), so the traversal now expands a celebrity's millions of edges. Check `graph_max_degree` over time. Mitigate by capping per-vertex expansion, switching to streaming neighbor iteration so you never materialize the hub's slice, or special-casing hubs with a two-level structure.

### P8 (analysis). When does compression actually pay off, and what does it cost?
Compression pays when memory is the bottleneck — web and social graphs where gap+varint or WebGraph reach `1–3 bits/edge` versus 32 bits for primitive CSR, the difference between fitting in RAM and not. The cost is `O(degree)` decode per neighbor scan, so a CPU-bound, latency-critical kernel that re-scans neighbors constantly may prefer uncompressed CSR. The decision is driven by whether you are memory-bound or CPU-bound; at web scale you are almost always memory-bound, so compression wins.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose a graph representation and it mattered.
Look for a structured story: the problem (say, shortest paths over a road network), the candidates considered (matrix vs list vs CSR), the criteria (graph density, memory budget, read/write ratio, latency), and why one won. Strong answers cite the operation mix ("we iterated neighbors far more than we tested single edges, so the list dominated") and reflect on what was measured. Defaulting to the representation you happened to know is a weak answer.

### B2. Design the storage layer for a social graph with a billion users.
Discuss tiering: a compressed immutable CSR for the read-hot core, a durable graph database for the long tail and writes, and vertex-cut partitioning if it must span machines (to tame celebrity super-hubs). Cover the read/write split (snapshot swap for lock-free reads with bounded staleness), capacity planning in bytes-per-edge, and observability (`graph_bytes_resident`, `partition_cross_edge_ratio`, max degree). Mention that most queries are local 2-hop neighborhoods, which shapes the whole design.

### B3. Design a dependency resolver (build system / package manager).
The graph is a DAG stored as a directed adjacency list. Topological sort gives build order; cycle detection catches illegal dependencies. Discuss representing it incrementally as the manifest is parsed, mapping package names to integer ids at the boundary, and how you would report a cycle to the user (the actual chain of packages, not just "a cycle exists"). Mention that the edge list form is handy for serializing the resolved plan.

### B4. A junior asks: "Why not always use an adjacency matrix — it's simplest?" How do you respond?
Explain that the matrix is `O(V²)` memory regardless of edge count, so for a sparse graph of a million vertices it needs terabytes and simply will not fit, while the adjacency list needs only `O(V + E)`. The matrix wins only for dense graphs, `O(1)` single-edge tests, or matrix-shaped algorithms like Floyd-Warshall. Use it as a teaching moment about choosing the structure from the operation mix and the graph's density, not from apparent simplicity.

### B5. Your graph service is OOMing in production. Walk me through the investigation.
Start by checking whether someone allocated an `O(V²)` matrix on a graph that grew large and sparse — the classic blow-up. Pull `graph_vertices`, `graph_edges`, and `graph_bytes_resident` and compare against the capacity plan. Look for a new super-hub inflating per-vertex allocations, or a snapshot rebuild falling behind writes so the delta log grows unbounded. Mitigate by switching to a primitive/compressed CSR, capping hub expansion, or back-pressuring writes.

---

## Coding Challenges

### Challenge 1: Build an Adjacency List from an Edge Array

**Problem.** Given `n` vertices labelled `0..n-1` and an array of undirected `edges`, build and return the adjacency list. Then answer a batch of `neighbors(u)` queries. This is the bread-and-butter preprocessing step.

**Example.**

```text
n = 4, edges = [[0,1],[0,2],[1,2],[2,3]]
adjacency list:
  0 -> [1, 2]
  1 -> [0, 2]
  2 -> [0, 1, 3]
  3 -> [2]
neighbors(2) -> [0, 1, 3]
```

**Constraints.** `1 <= n <= 10^5`, `0 <= len(edges) <= 2*10^5`, vertices in `[0, n)`, the graph may have self-loops but no parallel edges in this version.

**Approach.** Allocate `n` empty buckets up front. For each edge `(u, v)`, append `v` to `adj[u]` and `u` to `adj[v]` (undirected). Building is `O(n + E)`; each `neighbors(u)` query is `O(1)` to return the bucket. Do not use a matrix — for `n = 10⁵` that is `10¹⁰` cells.

**Go.**

```go
package main

import "fmt"

func buildAdj(n int, edges [][2]int, directed bool) [][]int {
	adj := make([][]int, n)
	for _, e := range edges {
		u, v := e[0], e[1]
		adj[u] = append(adj[u], v)
		if !directed {
			adj[v] = append(adj[v], u)
		}
	}
	return adj
}

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 2}, {2, 3}}
	adj := buildAdj(4, edges, false)
	for u, ns := range adj {
		fmt.Printf("%d -> %v\n", u, ns)
	}
	fmt.Println("neighbors(2):", adj[2]) // [0 1 3]
}
```

**Java.**

```java
import java.util.ArrayList;
import java.util.List;

public class BuildAdj {
    static List<List<Integer>> buildAdj(int n, int[][] edges, boolean directed) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            if (!directed) adj.get(e[1]).add(e[0]);
        }
        return adj;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {0, 2}, {1, 2}, {2, 3}};
        List<List<Integer>> adj = buildAdj(4, edges, false);
        for (int u = 0; u < adj.size(); u++) {
            System.out.println(u + " -> " + adj.get(u));
        }
        System.out.println("neighbors(2): " + adj.get(2)); // [0, 1, 3]
    }
}
```

**Python.**

```python
def build_adj(n, edges, directed=False):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        if not directed:
            adj[v].append(u)
    return adj


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 2), (2, 3)]
    adj = build_adj(4, edges)
    for u, ns in enumerate(adj):
        print(u, "->", ns)
    print("neighbors(2):", adj[2])  # [0, 1, 3]
```

**Follow-up.** Make it weighted: store `(neighbor, weight)` pairs from `(u, v, w)` triples so Dijkstra can read costs directly. What if the input is 1-indexed? Subtract 1 once at read time, never mid-algorithm.

---

### Challenge 2: Convert Between Adjacency Matrix and Adjacency List

**Problem.** Implement two functions: `matrixToList(M)` converts a `V×V` `0/1` adjacency matrix into an adjacency list, and `listToMatrix(adj, V)` converts back. State the cost of each and the one case where the round trip is lossy.

**Example.**

```text
M = [[0,1,1,0],
     [1,0,1,0],
     [1,1,0,1],
     [0,0,1,0]]
matrixToList(M) -> [[1,2], [0,2], [0,1,3], [2]]
listToMatrix(adj, 4) -> the same M
```

**Constraints.** `1 <= V <= 2000` (so `V²` cells is at most `4×10⁶`), cells are `0` or `1`.

**Approach.** `matrixToList` scans every cell — `O(V²)` — because the matrix gives no hint which cells are nonzero without reading them. `listToMatrix` allocates `V²`, zero-fills, then sets `M[u][v] = 1` for each stored neighbor — `O(V²)` to allocate plus `O(E)` to fill. The round trip is **lossy for multigraphs**: a `0/1` matrix collapses parallel edges into one.

**Go.**

```go
package main

import "fmt"

func matrixToList(m [][]int) [][]int {
	n := len(m)
	adj := make([][]int, n)
	for u := 0; u < n; u++ {
		for v := 0; v < n; v++ {
			if m[u][v] != 0 {
				adj[u] = append(adj[u], v)
			}
		}
	}
	return adj
}

func listToMatrix(adj [][]int, n int) [][]int {
	m := make([][]int, n)
	for i := range m {
		m[i] = make([]int, n)
	}
	for u := 0; u < n; u++ {
		for _, v := range adj[u] {
			m[u][v] = 1
		}
	}
	return m
}

func main() {
	m := [][]int{
		{0, 1, 1, 0},
		{1, 0, 1, 0},
		{1, 1, 0, 1},
		{0, 0, 1, 0},
	}
	adj := matrixToList(m)
	fmt.Println("list:", adj) // [[1 2] [0 2] [0 1 3] [2]]
	back := listToMatrix(adj, 4)
	fmt.Println("round-trip equal:", fmt.Sprint(back) == fmt.Sprint(m))
}
```

**Java.**

```java
import java.util.ArrayList;
import java.util.List;

public class MatrixListConvert {
    static List<List<Integer>> matrixToList(int[][] m) {
        int n = m.length;
        List<List<Integer>> adj = new ArrayList<>();
        for (int u = 0; u < n; u++) {
            adj.add(new ArrayList<>());
            for (int v = 0; v < n; v++) {
                if (m[u][v] != 0) adj.get(u).add(v);
            }
        }
        return adj;
    }

    static int[][] listToMatrix(List<List<Integer>> adj, int n) {
        int[][] m = new int[n][n];
        for (int u = 0; u < n; u++) {
            for (int v : adj.get(u)) m[u][v] = 1;
        }
        return m;
    }

    public static void main(String[] args) {
        int[][] m = {
            {0, 1, 1, 0},
            {1, 0, 1, 0},
            {1, 1, 0, 1},
            {0, 0, 1, 0}
        };
        List<List<Integer>> adj = matrixToList(m);
        System.out.println("list: " + adj);
        int[][] back = listToMatrix(adj, 4);
        System.out.println("round-trip equal: " + java.util.Arrays.deepEquals(back, m));
    }
}
```

**Python.**

```python
def matrix_to_list(m):
    n = len(m)
    return [[v for v in range(n) if m[u][v]] for u in range(n)]


def list_to_matrix(adj, n):
    m = [[0] * n for _ in range(n)]
    for u in range(n):
        for v in adj[u]:
            m[u][v] = 1
    return m


if __name__ == "__main__":
    m = [
        [0, 1, 1, 0],
        [1, 0, 1, 0],
        [1, 1, 0, 1],
        [0, 0, 1, 0],
    ]
    adj = matrix_to_list(m)
    print("list:", adj)  # [[1, 2], [0, 2], [0, 1, 3], [2]]
    back = list_to_matrix(adj, 4)
    print("round-trip equal:", back == m)
```

**Follow-up.** Preserve parallel edges by using a count matrix (`int` cells) and a list (not a set) of neighbors. Preserve weights by storing the weight in the cell and `(neighbor, weight)` in the list.

---

### Challenge 3: Clone an Undirected Graph

**Problem.** Given a reference to a node in a connected undirected graph (each node has a value and a list of neighbor nodes), return a deep copy. The copy must replicate the structure exactly with all-new node objects.

**Example.**

```text
Input graph (node values shown), each node's neighbors in brackets:
  1: [2, 4]
  2: [1, 3]
  3: [2, 4]
  4: [1, 3]
Output: an isomorphic graph of brand-new nodes.
```

**Constraints.** `1 <= number of nodes <= 100`, values are unique in `[1, 100]`, the graph is connected and undirected (no self-loops, no parallel edges).

**Approach.** DFS or BFS while maintaining a hash map `original node → cloned node`. When you first see a node, create its clone and record it; then recurse/enqueue its neighbors, wiring each cloned neighbor into the clone's neighbor list. The map both prevents infinite loops on cycles and ensures each original maps to exactly one clone. Time and space are `O(V + E)`.

**Go.**

```go
package main

import "fmt"

type Node struct {
	Val       int
	Neighbors []*Node
}

func cloneGraph(node *Node) *Node {
	if node == nil {
		return nil
	}
	seen := map[*Node]*Node{}
	var dfs func(n *Node) *Node
	dfs = func(n *Node) *Node {
		if c, ok := seen[n]; ok {
			return c
		}
		clone := &Node{Val: n.Val}
		seen[n] = clone
		for _, nb := range n.Neighbors {
			clone.Neighbors = append(clone.Neighbors, dfs(nb))
		}
		return clone
	}
	return dfs(node)
}

func main() {
	// build a square: 1-2-3-4-1
	n1, n2 := &Node{Val: 1}, &Node{Val: 2}
	n3, n4 := &Node{Val: 3}, &Node{Val: 4}
	n1.Neighbors = []*Node{n2, n4}
	n2.Neighbors = []*Node{n1, n3}
	n3.Neighbors = []*Node{n2, n4}
	n4.Neighbors = []*Node{n1, n3}

	c := cloneGraph(n1)
	fmt.Println(c.Val, "neighbors:", c.Neighbors[0].Val, c.Neighbors[1].Val) // 1 neighbors: 2 4
	fmt.Println("distinct object:", c != n1)                                  // true
}
```

**Java.**

```java
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class CloneGraph {
    static class Node {
        int val;
        List<Node> neighbors = new ArrayList<>();
        Node(int v) { val = v; }
    }

    static Node cloneGraph(Node node) {
        if (node == null) return null;
        Map<Node, Node> seen = new HashMap<>();
        return dfs(node, seen);
    }

    static Node dfs(Node n, Map<Node, Node> seen) {
        if (seen.containsKey(n)) return seen.get(n);
        Node clone = new Node(n.val);
        seen.put(n, clone);
        for (Node nb : n.neighbors) clone.neighbors.add(dfs(nb, seen));
        return clone;
    }

    public static void main(String[] args) {
        Node n1 = new Node(1), n2 = new Node(2), n3 = new Node(3), n4 = new Node(4);
        n1.neighbors = List.of(n2, n4);
        n2.neighbors = List.of(n1, n3);
        n3.neighbors = List.of(n2, n4);
        n4.neighbors = List.of(n1, n3);

        Node c = cloneGraph(n1);
        System.out.println(c.val + " neighbors: "
            + c.neighbors.get(0).val + " " + c.neighbors.get(1).val); // 1 neighbors: 2 4
        System.out.println("distinct object: " + (c != n1));          // true
    }
}
```

**Python.**

```python
class Node:
    def __init__(self, val, neighbors=None):
        self.val = val
        self.neighbors = neighbors or []


def clone_graph(node):
    if node is None:
        return None
    seen = {}

    def dfs(n):
        if n in seen:
            return seen[n]
        clone = Node(n.val)
        seen[n] = clone
        clone.neighbors = [dfs(nb) for nb in n.neighbors]
        return clone

    return dfs(node)


if __name__ == "__main__":
    n1, n2, n3, n4 = Node(1), Node(2), Node(3), Node(4)
    n1.neighbors = [n2, n4]
    n2.neighbors = [n1, n3]
    n3.neighbors = [n2, n4]
    n4.neighbors = [n1, n3]

    c = clone_graph(n1)
    print(c.val, "neighbors:", c.neighbors[0].val, c.neighbors[1].val)  # 1 neighbors: 2 4
    print("distinct object:", c is not n1)                              # True
```

**Follow-up.** If the graph may be disconnected, you are given the full node array instead of one entry point — iterate every node and clone any not yet seen. The hash-map-keyed traversal is the same pattern used to detect cycles and to serialize/deserialize a graph.

---

### Challenge 4: Find the Center of a Star Graph

**Problem.** A *star graph* on `n` vertices (`n >= 2`, labelled `1..n`) has one center connected to every other vertex and no other edges, so it has exactly `n-1` edges. Given the `edges` array, return the center. Solve it in `O(1)` extra work beyond reading two edges.

**Example.**

```text
edges = [[1,2],[2,3],[4,2]]  ->  center = 2
edges = [[1,2],[5,1],[1,3],[1,4]]  ->  center = 1
```

**Constraints.** `3 <= n <= 10^5`, `edges.length == n - 1`, the input is guaranteed to form a valid star graph.

**Approach.** The center appears in *every* edge, so it must appear in the first two edges. The common vertex between `edges[0]` and `edges[1]` is the center: if `edges[0][0]` equals either endpoint of `edges[1]`, it is the center; otherwise `edges[0][1]` is. This reads exactly two edges — `O(1)` — instead of counting degrees over all `n-1` edges (`O(n)`). The degree-counting approach also works and is a good fallback to mention.

**Go.**

```go
package main

import "fmt"

func findCenter(edges [][2]int) int {
	a, b := edges[0][0], edges[0][1]
	c, d := edges[1][0], edges[1][1]
	if a == c || a == d {
		return a
	}
	return b
}

func main() {
	fmt.Println(findCenter([][2]int{{1, 2}, {2, 3}, {4, 2}}))         // 2
	fmt.Println(findCenter([][2]int{{1, 2}, {5, 1}, {1, 3}, {1, 4}})) // 1
}
```

**Java.**

```java
public class StarCenter {
    static int findCenter(int[][] edges) {
        int a = edges[0][0], b = edges[0][1];
        int c = edges[1][0], d = edges[1][1];
        return (a == c || a == d) ? a : b;
    }

    public static void main(String[] args) {
        System.out.println(findCenter(new int[][]{{1, 2}, {2, 3}, {4, 2}}));         // 2
        System.out.println(findCenter(new int[][]{{1, 2}, {5, 1}, {1, 3}, {1, 4}})); // 1
    }
}
```

**Python.**

```python
def find_center(edges):
    a, b = edges[0]
    c, d = edges[1]
    return a if a in (c, d) else b


if __name__ == "__main__":
    print(find_center([[1, 2], [2, 3], [4, 2]]))          # 2
    print(find_center([[1, 2], [5, 1], [1, 3], [1, 4]]))  # 1
```

**Follow-up.** The `O(n)` degree-count version (build a degree array, the center has degree `n-1`) generalizes to verifying that the input actually *is* a star, which the `O(1)` trick assumes. Interviewers sometimes ask you to validate the star property, which forces the full scan.

---

## Common Pitfalls in Interviews

- **Reaching for a matrix on a sparse graph.** `V = 10⁵` means `10¹⁰` cells — instant OOM. Estimate `V²` before allocating; default to an adjacency list.
- **Forgetting the reverse edge for undirected graphs.** Appending only `v` to `adj[u]` silently builds a *directed* graph and breaks every traversal. Add both directions, ideally inside one `addEdge` helper.
- **Using `0` as "no edge" when `0` is a valid weight.** This produces phantom or missing edges in a weighted matrix. Use a dedicated sentinel (`-1`, `+∞`).
- **Mixing 0-indexed and 1-indexed vertices.** Competitive inputs are often 1-indexed. Convert once at read time, never sprinkled through the algorithm.
- **Calling `hasEdge` in a hot loop on an adjacency list.** That is `O(degree)` each time; if you need many single-edge tests, keep a parallel edge `set` or switch to a matrix.
- **Deduplicating a multigraph by accident.** Storing neighbors in a `set` quietly drops parallel edges. Use a list when parallel edges are meaningful.
- **Trying to mutate a CSR.** Inserting an edge shifts every offset. CSR is effectively immutable — rebuild, or keep an adjacency list for the mutable phase.
- **Iterating all neighbors on a matrix when you only have a few.** Scanning a full row is `O(V)`; if neighbor iteration dominates your algorithm, use a list.
- **Not asking directed vs undirected, weighted vs unweighted.** Restate these before coding — they change every insertion.
- **Building the wrong representation for the algorithm.** Handing Bellman-Ford a matrix wastes `O(V²)` per pass scanning non-edges; it wants an edge list. Match the representation to the algorithm.

---

## What Interviewers Are Really Testing

A graph-representation question rarely checks whether you can recite three data structures. It probes three deeper skills. First, **can you read the operation mix and the input shape and pick the right layout?** The candidate who asks "is this dense or sparse, and do we iterate neighbors or test single edges?" before writing code is signalling exactly the judgment that separates a strong engineer from one who defaults to whatever they used last. Second, **can you reason about the space-versus-time trade-off concretely?** Knowing that the matrix is `O(V²)` regardless of edges, that the list iterates neighbors in optimal `O(degree)`, and that CSR recovers the cache constant the list loses — and being able to put rough byte numbers on a million-vertex graph — shows you understand *why*, not just *what*. Third, **can you handle the corners and the scale?** Directed versus undirected, self-loops, parallel edges, string-labelled vertices, the conversions and their lossiness, and at the senior level partitioning, immutability for concurrent reads, compression, and capacity planning. You do not need to solve every one on the spot, but you should name the right tool — adjacency list by default, matrix for dense or `O(1)` edge tests, edge list for whole-edge sweeps, CSR for static hot graphs, implicit for grids — and explain the trade-off. The representation is the foundation the rest of the interview is built on; choosing it deliberately, out loud, is the whole point.
