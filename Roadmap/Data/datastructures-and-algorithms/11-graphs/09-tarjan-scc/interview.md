# Tarjan's SCC — Interview Preparation

Strongly connected components are a favorite interview topic because they sit at the intersection of DFS mastery, careful invariant reasoning, and a wealth of disguised applications (cycle detection, 2-SAT, course-schedule, critical connections). A candidate who can derive the `disc`/`low` rules from scratch, explain *why* back edges use `disc` and not `low`, and connect SCCs to the condensation DAG demonstrates far more than a memorized template. This file is a graded question bank plus four end-to-end coding challenges in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Item | Value |
|------|-------|
| Problem | Decompose a directed graph into maximal mutually-reachable sets |
| Tarjan time / space | `O(V + E)` / `O(V)` |
| Kosaraju time / space | `O(V + E)` / `O(V + E)` (transpose) |
| Passes | Tarjan: 1; Kosaraju: 2 + transpose |
| SCC root test | `low[u] == disc[u]` |
| Tree-edge rule | recurse, then `low[u] = min(low[u], low[v])` |
| On-stack-edge rule | `low[u] = min(low[u], disc[v])` |
| Closed-component edge | ignore |
| Output order (Tarjan) | reverse topological order of condensation |
| Cycle exists? | any SCC of size ≥ 2, or any self-loop |
| Strongly connected? | exactly one SCC |
| Condensation | DAG of SCCs; always acyclic |

Pseudocode skeleton:

```text
dfs(u):
    disc[u] = low[u] = idx++; push u; onStack[u] = true
    for v in adj[u]:
        if disc[v] == -1:      dfs(v); low[u] = min(low[u], low[v])   # tree
        elif onStack[v]:       low[u] = min(low[u], disc[v])          # back/cross to open
    if low[u] == disc[u]:      pop stack down to u → one SCC
```

---

## Junior Questions (12 Q&A)

### J1. What is a strongly connected component?
A strongly connected component (SCC) of a directed graph is a maximal set of vertices such that every vertex can reach every other vertex in the set along directed edges. "Maximal" means you cannot add another vertex and keep mutual reachability. Every directed graph partitions uniquely into SCCs.

### J2. How is an SCC different from a connected component in an undirected graph?
In an undirected graph, connectivity is symmetric: a single path makes two vertices connected. In a directed graph you need a path **in both directions** — `u ⇝ v` and `v ⇝ u`. So undirected connectivity uses plain DFS/BFS or union-find, while SCCs require respecting edge direction, which is what Tarjan and Kosaraju handle.

### J3. What is the condensation graph?
If you contract each SCC to a single node, the resulting directed graph — with an edge between two SCC-nodes whenever an original edge crosses between them — is the condensation. It is **always a DAG**, because a cycle among SCCs would make them mutually reachable and hence one larger SCC.

### J4. What are `disc` and `low` in Tarjan's algorithm?
`disc[v]` is the discovery index — the order in which DFS first visits `v`. `low[v]` (lowlink) is the smallest `disc` value reachable from `v` using tree edges plus at most one back/cross edge into a vertex still on the stack. When `low[v] == disc[v]`, `v` is the root of an SCC.

### J5. Why does Tarjan keep an explicit stack separate from the recursion stack?
The explicit stack holds vertices that have been discovered but whose SCC has not been finalized ("open" vertices). When a root is found, everything above it on this stack is exactly its SCC and gets popped. The recursion (call) stack only tracks the current DFS path; it cannot tell you which vertices form a component.

### J6. What is the time complexity of Tarjan's algorithm and why?
`O(V + E)`. DFS visits each vertex once (`O(V)`) and examines each edge once (`O(E)`). Each vertex is pushed and popped from the explicit stack exactly once. There is no priority queue or sorting, so no log factor.

### J7. How do you detect whether a directed graph has a cycle using SCCs?
Run Tarjan (or Kosaraju). If any SCC has size ≥ 2, those vertices form a cycle. Additionally, a self-loop `v → v` is a cycle even though it is a size-1 SCC. So: cycle exists iff some SCC has size ≥ 2 **or** some vertex has a self-loop.

### J8. How do you check if an entire directed graph is strongly connected?
The graph is strongly connected iff it has exactly **one** SCC containing all vertices. Equivalently, a DFS from any vertex reaches everything, and a DFS from that vertex on the transpose graph also reaches everything.

### J9. What is the difference between Tarjan and Kosaraju at a high level?
Tarjan finds SCCs in a single DFS using `disc`/`low`/stack. Kosaraju uses two passes: a first DFS recording finish order, then a second DFS on the transpose (reversed-edge) graph in reverse finish order. Both are `O(V + E)`; Tarjan is faster (one pass, no transpose), Kosaraju is simpler to remember.

### J10. In what order does Tarjan output the SCCs?
In **reverse topological order** of the condensation DAG. The sink components (no outgoing condensation edges) are found first. If you need forward topological order, reverse the output list.

### J11. What is a back edge, and why does it matter here?
A back edge `u → v` points to an ancestor `v` still on the stack. Back edges are exactly what close cycles. When Tarjan sees one to an on-stack vertex, it lowers `low[u]` toward `disc[v]`, signaling that `u`'s subtree can loop back — which is how SCCs larger than one vertex are detected.

### J12 (analysis). Why must every vertex be a DFS start candidate?
A directed graph need not be reachable from a single source. If you only DFS from vertex 0, you miss components unreachable from 0. The outer loop `for u in range(V): if unvisited: dfs(u)` guarantees every vertex (and thus every SCC) is discovered.

---

## Middle Questions (12 Q&A)

### M1. Why does the on-stack edge use `disc[v]` instead of `low[v]`?
Lowlink counts paths with **at most one** non-tree edge. For a back/cross edge to an on-stack `v`, the correct contribution is `disc[v]` — the real discovery time of the endpoint. Using `low[v]` would credit `u` with reaching whatever `v` can reach (two-plus non-tree edges), and `low[v]` may still be changing; both can wrongly merge two distinct SCCs.

### M2. Why does the tree edge use `low[v]` and not `disc[v]`?
For a tree edge, `v`'s subtree is fully explored before we return, so `low[v]` is final and summarizes everything `v`'s subtree can reach back to. Inheriting `min(low[u], low[v])` propagates that information up. Using only `disc[v]` would lose the back edges found deep in `v`'s subtree.

### M3. Prove informally that `low[u] == disc[u]` means `u` is an SCC root.
All members of `u`'s SCC are reachable from `u` and reach back to `u`, so by the white-path property they sit in `u`'s DFS subtree and were pushed after `u`. If `u` were *not* the root, an older same-component ancestor would be reachable via a back edge, dragging `low[u]` below `disc[u]`. Since `low[u] == disc[u]`, no such older vertex exists, so `u` is the first-discovered member — the root.

### M4. How do you build the condensation DAG once you have SCC ids?
Assign each vertex a `comp_id`. For every edge `u → v` with `comp_id[u] != comp_id[v]`, add an edge `comp_id[u] → comp_id[v]` to the condensation, deduplicating. The result is acyclic and ready for DAG algorithms.

### M5. How are SCCs used to solve 2-SAT?
Build an implication graph on `2n` literals: clause `(a ∨ b)` adds `¬a → b` and `¬b → a`. The formula is satisfiable iff no variable `x` has `x` and `¬x` in the same SCC. If satisfiable, set `x = true` when `x`'s SCC comes after `¬x`'s in topological order (Tarjan's reverse-output order gives this directly).

### M6. What is Gabow's algorithm and how does it relate to Tarjan?
Gabow's path-based SCC algorithm is single-pass like Tarjan but replaces the `low[]` array with a second "boundary" stack. On an edge to an on-stack vertex `w`, it pops the boundary stack while its top has `disc > disc[w]`. Same `O(V+E)` time and `O(V)` space; many find it cleaner because there is no lowlink arithmetic.

### M7. Why is the recursive version dangerous on large graphs?
Recursion depth can reach `O(V)` — a path of a million vertices recurses a million deep, overflowing the native stack (`RecursionError`, `StackOverflowError`, or a segfault). The fix is an iterative Tarjan that simulates the call stack with an explicit structure and a per-vertex child cursor.

### M8. What does Tarjan output for a DAG with no cycles?
Every SCC has size 1; there are exactly `V` components, one per vertex. The condensation is the original graph (relabeled). This is a good sanity-check input.

### M9. How do you find the kth-or-any cycle members to report to a user?
After Tarjan, take any SCC with size ≥ 2; its vertices are mutually reachable, so a cycle exists among them. To report a concrete cycle, run a small DFS within that component to find a back edge and reconstruct the loop. Reporting just the SCC member set already tells the user which nodes are tangled.

### M10. How does Tarjan handle self-loops and parallel edges?
A self-loop `v → v` targets an on-stack vertex (`v` itself), so it sets `low[v] = min(low[v], disc[v]) = disc[v]` — harmless; `v` remains a size-1 SCC but the graph is now cyclic. Parallel edges are processed independently and do not break the on-stack logic.

### M11. Compare the memory footprint of Tarjan vs Kosaraju.
Tarjan: `O(V)` — three arrays (`disc`, `low`, `onStack`) plus a stack. Kosaraju: `O(V + E)` because it builds the transpose graph, doubling edge storage. On edge-heavy graphs this matters: Kosaraju can OOM where Tarjan fits.

### M12 (analysis). Why is the pop loop amortized O(1) per vertex rather than O(V) per root?
Each vertex is pushed onto the explicit stack exactly once and popped exactly once over the entire run. Although a single root may pop many vertices, the *total* number of pops across all roots is `V`. Summed over the algorithm, the pop work is `O(V)`, i.e. amortized `O(1)` per vertex.

---

## Senior Questions (10 Q&A)

### S1. How would you run SCC on a graph too deep for recursion?
Use iterative Tarjan: an explicit call stack of frames, each remembering the vertex and a cursor into its adjacency list. On "descend," push a child frame; on "return," relax `low[parent] = min(low[parent], low[u])`. Same `disc`/`low`/`onStack` semantics, but depth is bounded by heap memory, not the native stack.

### S2. Why can't Tarjan be parallelized, and what do you use instead?
Tarjan depends on a strict DFS order and a single shared stack; lexicographic-first DFS is P-complete, so there is no work-efficient parallel version. At scale you switch to Forward–Backward (pick a pivot, intersect forward/backward reachable sets — that intersection is one SCC, recurse on the three remainders) or the coloring algorithm, both of which parallelize via BFS.

### S3. How do you make SCC analysis incremental for a constantly-changing graph?
Full recompute is `O(V+E)` per change. For high update rates, use incremental SCC maintenance (e.g., maintaining a topological order and repairing only the affected region on insert). For most systems, **debounced full recompute** (every N edges or T seconds) on an immutable snapshot is simpler and sufficient; version the result so consumers detect staleness.

### S4. How would you detect database deadlocks with SCCs?
Model a wait-for graph: `T1 → T2` if T1 waits on a lock held by T2. A deadlock is a cycle = a non-trivial SCC. On a lock-wait timeout, snapshot the graph, run Tarjan, and if an SCC of size ≥ 2 exists, abort a victim transaction (youngest or least-work) to break it.

### S5. How do you use the condensation to schedule a staged build?
Collapse cycles into SCC-nodes to get a DAG, topologically sort it, and process SCCs in topological order. Within an SCC you must build all members together (they are mutually dependent), or report it as an error if cycles are disallowed. Tarjan's reverse-output order gives the topological order for free.

### S6. What is the minimum number of edges to make a graph strongly connected?
Build the condensation. If it has one node, the graph is already strongly connected (0 edges). Otherwise, count `s` = number of source SCCs (no in-edges) and `t` = number of sink SCCs (no out-edges); the answer is `max(s, t)`. This is a classic SCC-plus-condensation problem.

### S7. How do you test a Tarjan implementation for correctness?
Property-test against a brute-force oracle: compute all-pairs reachability (BFS/DFS from each vertex, or Floyd–Warshall on small graphs); `u, v` share an SCC iff `reach[u][v] && reach[v][u]`. Generate random directed graphs, compare the SCC partition. Also test edge cases: empty graph, single vertex, self-loops, one giant SCC, pure DAG.

### S8. How does graph layout affect SCC performance?
DFS pointer-chases through adjacency. Lists-of-lists scatter neighbors across memory; CSR (compressed sparse row) stores each vertex's neighbors contiguously, giving 2–4× speedups on large graphs. The `disc`/`low` arrays are still randomly accessed by vertex id, so locality is bounded by traversal order. BFS-based algorithms are more cache-friendly than DFS at very large scale.

### S9. When would you prefer Kosaraju in production despite being slower?
When clarity and auditability outweigh speed: two straightforward DFS passes are far easier to get right and review than the lowlink rules. Also when you already have the transpose for other reasons, or when teaching. As a test oracle for a Tarjan implementation, Kosaraju is invaluable.

### S10 (analysis). Why do real-world digraphs often have one giant SCC plus many trivial ones?
Directed random graphs `G(n,p)` show a sharp threshold at `np = 1`: above it, a unique giant SCC of size `Θ(n)` emerges. Real graphs (web, call graphs) exhibit this "bow-tie" structure. It is why **trimming** (peeling vertices with in- or out-degree 0, which are their own SCCs) is so effective before running an expensive parallel SCC — most vertices fall away cheaply, leaving one big core.

---

## Professional Questions (8 Q&A)

### P1. State the lowlink invariant precisely and why the root test follows.
`low[v]` is the minimum `disc` over all vertices reachable from `v`'s DFS subtree using tree edges plus at most one non-tree edge to an on-stack vertex. A root `r` has minimum `disc` in its SCC and all SCC members lie in `T(r)`; no member reaches an on-stack vertex older than `r` (that vertex would then be in the SCC, contradicting minimality), so `low[r] = disc[r]`. A non-root reaches its older root via a back edge, so `low < disc`. Hence `low[u] == disc[u]` iff `u` is a root.

### P2. Why is the pop set exactly the SCC, not a superset?
When root `u` finishes, all SCC members are in `T(u)`, discovered after `u`, and still on the stack (none popped, since `u` is their root). Conversely any vertex still above `u` on the stack must have `u` as its root: a proper-descendant root would have popped it earlier (DFS post-order), and a proper-ancestor root is excluded because `low[u] = disc[u]` means nothing in `T(u)` reaches an older on-stack vertex. So the popped set equals the component exactly.

### P3. How does the white-path theorem justify subtree containment?
When the root `r` is discovered, every other SCC member is still white (unvisited), because `r` has the smallest `disc` in the SCC. Since a path from `r` to each member exists entirely within the SCC, that path is all-white at `r`'s discovery time. The white-path theorem then guarantees each member becomes a descendant of `r` in the DFS forest, i.e. lies in `T(r)`.

### P4. Compare the constant factors of Tarjan, Kosaraju, and Gabow.
All three are `Θ(V+E)`. Kosaraju touches edges ~3× (forward DFS, transpose build, transpose DFS) and doubles edge memory — typically 1.5–2× slower. Tarjan does one DFS with `O(1)` min-arithmetic per edge. Gabow drops the `low[]` array for a boundary stack, doing slightly fewer comparisons on some inputs, with the same `O(V)` space and no transpose.

### P5. What is the complexity of parallel Forward–Backward SCC?
Work `O((V+E) log V)` expected — not work-optimal, paying a log factor over sequential. Span depends on graph diameter via parallel BFS. Worst case (long paths) degrades toward `O(V·(V+E))`. It trades total work for parallelizability because DFS itself does not parallelize.

### P6. How would you do SCC in external memory or streaming?
DFS is cache- and I/O-hostile, so massive-graph SCC favors BFS-based algorithms (FB/coloring) despite higher work, since BFS is far more I/O-friendly. In semi-streaming (`O(V·polylog V)` space, few passes), exact SCC trade-offs are not tight; one approximates via reachability sketches or multiple passes. Trimming trivial SCCs first reduces the working set.

### P7. Discuss dynamic SCC maintenance.
Incremental-only (edge insertions) admits efficient amortized maintenance via incremental topological order (Bender–Fineman–Gilbert–Tarjan). Decremental (deletions only) has near-linear total-time results (Łącki; Roditty–Zwick). Fully dynamic SCC with `o(m)` per update for arbitrary insert/delete is **open**. In practice, debounced recompute is the pragmatic choice unless update rates are extreme.

### P8 (analysis). Why is "is the graph strongly connected?" cheaper than full SCC?
You do not need `low[]` or the stack: pick any `s`, run one DFS reaching all vertices, then one DFS from `s` on the transpose reaching all vertices. The graph is strongly connected iff both reach everything. Same `Θ(V+E)` bound but with smaller constants and no per-vertex lowlink bookkeeping.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used cycle detection in a real system.
Look for a concrete story: a dependency graph (build targets, microservices, DB transactions), the symptom (a build that never converged, a deadlock, a circular import), how SCCs pinpointed the exact tangled set, and what was done (break the edge, abort a victim, refactor). Strong answers name the algorithm choice and why, and what was measured.

### B2. Design a build system that rejects circular dependencies.
Tarjan (iterative, to survive deep graphs) over the target graph at build time; any SCC of size > 1 is a cycle. Discuss output: print the **smallest concrete cycle**, not just "cycle found," so it is actionable. Cover performance (per-build latency budget), determinism (sort members so CI does not flake), and where it runs (PR gate vs full build).

### B3. Design a deadlock detector for a database.
Wait-for graph, periodic or timeout-triggered SCC on a snapshot, abort a victim to break non-trivial SCCs. Discuss victim selection (youngest / least work), false positives from stale snapshots, the cost of running detection too often, and observability (log the cycle of transactions).

### B4. A teammate insists Kosaraju is "good enough" and Tarjan is premature optimization. How do you respond?
Both are `O(V+E)`. Kosaraju is simpler and a great oracle, but builds the transpose (double edge memory) and does two passes — on a 10⁸-edge graph that is a real OOM and ~2× slowdown. Recommend choosing by graph size and constraints: Kosaraju for clarity/small graphs, Tarjan (iterative) for large/edge-heavy ones. Frame it as fit-to-constraints, not ego.

### B5. Your SCC job intermittently crashes on large customer graphs. How do you investigate?
The classic cause is recursion-depth overflow on deep graphs. Check the stack trace (StackOverflow/RecursionError/segfault), reproduce with a long-path graph, and switch to iterative Tarjan. Add a `recursion_depth_max` metric as early warning, and a graph-size gauge. Verify the lowlink rules with a brute-force oracle in case a subtle correctness bug coexists.

---

## Coding Challenges

### Challenge 1: Number of Strongly Connected Components

**Problem.** Given a directed graph with `n` vertices and a list of directed edges, return the number of strongly connected components.

**Example.**

```text
n = 6, edges = [[0,1],[1,2],[2,0],[2,3],[3,4],[4,5],[5,3]]
Output: 2          // {0,1,2} and {3,4,5}
```

**Constraints.** `1 <= n <= 10^5`, `0 <= edges <= 2*10^5`, vertices `0..n-1`. Use `O(V + E)`.

**Approach.** Run Tarjan; count the number of times `low[u] == disc[u]` fires (each is one SCC). Iterative to survive deep graphs.

**Go.**

```go
package main

import "fmt"

func countSCC(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	nxt := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx, count := 0, 0

	type frame struct{ u int }
	for s := 0; s < n; s++ {
		if disc[s] != -1 {
			continue
		}
		call := []int{s}
		for len(call) > 0 {
			u := call[len(call)-1]
			if nxt[u] == 0 {
				disc[u] = idx
				low[u] = idx
				idx++
				stack = append(stack, u)
				onStack[u] = true
			}
			descended := false
			for nxt[u] < len(adj[u]) {
				v := adj[u][nxt[u]]
				nxt[u]++
				if disc[v] == -1 {
					call = append(call, v)
					descended = true
					break
				} else if onStack[v] && disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
			if descended {
				continue
			}
			if low[u] == disc[u] {
				count++
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					if w == u {
						break
					}
				}
			}
			call = call[:len(call)-1]
			if len(call) > 0 {
				p := call[len(call)-1]
				if low[u] < low[p] {
					low[p] = low[u]
				}
			}
		}
	}
	return count
}

func main() {
	edges := [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}
	fmt.Println(countSCC(6, edges)) // 2
}
```

**Java.**

```java
import java.util.*;

public class CountSCC {
    public static int countSCC(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);

        int[] disc = new int[n], low = new int[n], nxt = new int[n];
        boolean[] onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Deque<Integer> stack = new ArrayDeque<>(), call = new ArrayDeque<>();
        int idx = 0, count = 0;

        for (int s = 0; s < n; s++) {
            if (disc[s] != -1) continue;
            call.push(s);
            while (!call.isEmpty()) {
                int u = call.peek();
                if (nxt[u] == 0) {
                    disc[u] = low[u] = idx++;
                    stack.push(u);
                    onStack[u] = true;
                }
                boolean descended = false;
                while (nxt[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(nxt[u]++);
                    if (disc[v] == -1) { call.push(v); descended = true; break; }
                    else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
                }
                if (descended) continue;
                if (low[u] == disc[u]) {
                    count++;
                    int w;
                    do { w = stack.pop(); onStack[w] = false; } while (w != u);
                }
                call.pop();
                if (!call.isEmpty()) {
                    int p = call.peek();
                    low[p] = Math.min(low[p], low[u]);
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}};
        System.out.println(countSCC(6, edges)); // 2
    }
}
```

**Python.**

```python
def count_scc(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    nxt = [0] * n
    stack, idx, count = [], 0, 0

    for s in range(n):
        if disc[s] != -1:
            continue
        call = [s]
        while call:
            u = call[-1]
            if nxt[u] == 0:
                disc[u] = low[u] = idx
                idx += 1
                stack.append(u)
                on_stack[u] = True
            descended = False
            while nxt[u] < len(adj[u]):
                v = adj[u][nxt[u]]
                nxt[u] += 1
                if disc[v] == -1:
                    call.append(v)
                    descended = True
                    break
                elif on_stack[v]:
                    low[u] = min(low[u], disc[v])
            if descended:
                continue
            if low[u] == disc[u]:
                count += 1
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    if w == u:
                        break
            call.pop()
            if call:
                low[call[-1]] = min(low[call[-1]], low[u])
    return count


if __name__ == "__main__":
    print(count_scc(6, [[0,1],[1,2],[2,0],[2,3],[3,4],[4,5],[5,3]]))  # 2
```

**Follow-up.** Return the components themselves, then build the condensation DAG and topologically sort it (Tarjan's output is already reverse-topo).

---

### Challenge 2: Critical Connections (Bridges via Lowlink)

**Problem.** A network of `n` servers is connected by **undirected** links. A *critical connection* (bridge) is a link whose removal disconnects some servers. Return all critical connections. This uses the same `disc`/`low` lowlink idea as Tarjan, adapted to undirected bridges.

**Example.**

```text
n = 4, connections = [[0,1],[1,2],[2,0],[1,3]]
Output: [[1,3]]    // removing 1-3 isolates server 3
```

**Constraints.** `2 <= n <= 10^5`, `n-1 <= edges <= 10^5`, no duplicate links. `O(V + E)`.

**Approach.** DFS with `disc`/`low`. For tree edge `u → v`: recurse, `low[u] = min(low[u], low[v])`; if `low[v] > disc[u]`, edge `(u,v)` is a bridge (v's subtree cannot reach u or above without it). Skip the edge back to the parent (undirected). Note: bridges use `low[v]` and the strict `>` test, the undirected analog of Tarjan's root logic.

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
	var res [][]int
	timer := 0

	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u] = timer
		low[u] = timer
		timer++
		skippedParent := false
		for _, v := range adj[u] {
			if v == parent && !skippedParent {
				skippedParent = true // skip one parent edge (handles multi-edges)
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
    static List<List<Integer>> adj;
    static int[] disc, low;
    static List<List<Integer>> res = new ArrayList<>();
    static int timer = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        boolean skipped = false;
        for (int v : adj.get(u)) {
            if (v == parent && !skipped) { skipped = true; continue; }
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) res.add(List.of(u, v));
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    public static List<List<Integer>> run(int n, List<List<Integer>> connections) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (List<Integer> c : connections) {
            adj.get(c.get(0)).add(c.get(1));
            adj.get(c.get(1)).add(c.get(0));
        }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(run(4, List.of(
            List.of(0,1), List.of(1,2), List.of(2,0), List.of(1,3))));
    }
}
```

**Python.**

```python
import sys


def critical_connections(n, connections):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in connections:
        adj[a].append(b)
        adj[b].append(a)
    disc = [-1] * n
    low = [0] * n
    res = []
    timer = 0

    def dfs(u, parent):
        nonlocal timer
        disc[u] = low[u] = timer
        timer += 1
        skipped = False
        for v in adj[u]:
            if v == parent and not skipped:
                skipped = True
                continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    res.append([u, v])
            else:
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    return res


if __name__ == "__main__":
    print(critical_connections(4, [[0, 1], [1, 2], [2, 0], [1, 3]]))
```

**Follow-up.** Articulation points use a related lowlink test (`low[v] >= disc[u]` for non-root, plus a root special case). Sibling topic covers them in full.

---

### Challenge 3: 2-SAT Feasibility

**Problem.** Given `n` boolean variables and `m` clauses, each `(literal_a OR literal_b)`, decide whether an assignment satisfies all clauses. A literal is a variable or its negation.

**Example.**

```text
n = 2, clauses = [(x0 OR x1), (NOT x0 OR x1), (NOT x1 OR x0)]
Output: satisfiable (e.g. x0 = true, x1 = true)
```

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 10^5`. `O(n + m)`.

**Approach.** Index literal `x_i` as `2i`, `¬x_i` as `2i+1`. Clause `(a ∨ b)` adds edges `¬a → b` and `¬b → a`. Run Tarjan on the `2n`-node implication graph. Satisfiable iff `comp[2i] != comp[2i+1]` for all `i`.

**Go.**

```go
package main

import "fmt"

type TwoSAT struct {
	n   int
	adj [][]int
}

func NewTwoSAT(n int) *TwoSAT { return &TwoSAT{n: n, adj: make([][]int, 2*n)} }

// literal: (variable, isTrue). node index: 2*var + (0 if true else 1)
func node(v int, val bool) int {
	if val {
		return 2 * v
	}
	return 2*v + 1
}

func (s *TwoSAT) AddClause(a int, av bool, b int, bv bool) {
	s.adj[node(a, !av)] = append(s.adj[node(a, !av)], node(b, bv))
	s.adj[node(b, !bv)] = append(s.adj[node(b, !bv)], node(a, av))
}

func (s *TwoSAT) Satisfiable() bool {
	N := 2 * s.n
	disc := make([]int, N)
	low := make([]int, N)
	comp := make([]int, N)
	onStack := make([]bool, N)
	nxt := make([]int, N)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	for st := 0; st < N; st++ {
		if disc[st] != -1 {
			continue
		}
		call := []int{st}
		for len(call) > 0 {
			u := call[len(call)-1]
			if nxt[u] == 0 {
				disc[u], low[u] = idx, idx
				idx++
				stack = append(stack, u)
				onStack[u] = true
			}
			descended := false
			for nxt[u] < len(s.adj[u]) {
				v := s.adj[u][nxt[u]]
				nxt[u]++
				if disc[v] == -1 {
					call = append(call, v)
					descended = true
					break
				} else if onStack[v] && disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
			if descended {
				continue
			}
			if low[u] == disc[u] {
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					comp[w] = cid
					if w == u {
						break
					}
				}
				cid++
			}
			call = call[:len(call)-1]
			if len(call) > 0 {
				p := call[len(call)-1]
				if low[u] < low[p] {
					low[p] = low[u]
				}
			}
		}
	}
	for i := 0; i < s.n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return false
		}
	}
	return true
}

func main() {
	s := NewTwoSAT(2)
	s.AddClause(0, true, 1, true)
	s.AddClause(0, false, 1, true)
	s.AddClause(1, false, 0, true)
	fmt.Println(s.Satisfiable()) // true
}
```

**Java.**

```java
import java.util.*;

public class TwoSAT {
    int n;
    List<List<Integer>> adj;

    TwoSAT(int n) {
        this.n = n;
        adj = new ArrayList<>();
        for (int i = 0; i < 2 * n; i++) adj.add(new ArrayList<>());
    }

    int node(int v, boolean val) { return val ? 2 * v : 2 * v + 1; }

    void addClause(int a, boolean av, int b, boolean bv) {
        adj.get(node(a, !av)).add(node(b, bv));
        adj.get(node(b, !bv)).add(node(a, av));
    }

    boolean satisfiable() {
        int N = 2 * n, idx = 0, cid = 0;
        int[] disc = new int[N], low = new int[N], comp = new int[N], nxt = new int[N];
        boolean[] onStack = new boolean[N];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        Deque<Integer> stack = new ArrayDeque<>(), call = new ArrayDeque<>();
        for (int st = 0; st < N; st++) {
            if (disc[st] != -1) continue;
            call.push(st);
            while (!call.isEmpty()) {
                int u = call.peek();
                if (nxt[u] == 0) {
                    disc[u] = low[u] = idx++;
                    stack.push(u);
                    onStack[u] = true;
                }
                boolean descended = false;
                while (nxt[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(nxt[u]++);
                    if (disc[v] == -1) { call.push(v); descended = true; break; }
                    else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
                }
                if (descended) continue;
                if (low[u] == disc[u]) {
                    int w;
                    do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
                    cid++;
                }
                call.pop();
                if (!call.isEmpty()) low[call.peek()] = Math.min(low[call.peek()], low[u]);
            }
        }
        for (int i = 0; i < n; i++) if (comp[2 * i] == comp[2 * i + 1]) return false;
        return true;
    }

    public static void main(String[] args) {
        TwoSAT s = new TwoSAT(2);
        s.addClause(0, true, 1, true);
        s.addClause(0, false, 1, true);
        s.addClause(1, false, 0, true);
        System.out.println(s.satisfiable()); // true
    }
}
```

**Python.**

```python
def two_sat_satisfiable(n, clauses):
    # clauses: list of ((a, av), (b, bv))
    N = 2 * n
    adj = [[] for _ in range(N)]

    def node(v, val):
        return 2 * v if val else 2 * v + 1

    for (a, av), (b, bv) in clauses:
        adj[node(a, not av)].append(node(b, bv))
        adj[node(b, not bv)].append(node(a, av))

    disc = [-1] * N
    low = [0] * N
    comp = [-1] * N
    on_stack = [False] * N
    nxt = [0] * N
    stack, idx, cid = [], 0, 0

    for st in range(N):
        if disc[st] != -1:
            continue
        call = [st]
        while call:
            u = call[-1]
            if nxt[u] == 0:
                disc[u] = low[u] = idx
                idx += 1
                stack.append(u)
                on_stack[u] = True
            descended = False
            while nxt[u] < len(adj[u]):
                v = adj[u][nxt[u]]
                nxt[u] += 1
                if disc[v] == -1:
                    call.append(v)
                    descended = True
                    break
                elif on_stack[v]:
                    low[u] = min(low[u], disc[v])
            if descended:
                continue
            if low[u] == disc[u]:
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp[w] = cid
                    if w == u:
                        break
                cid += 1
            call.pop()
            if call:
                low[call[-1]] = min(low[call[-1]], low[u])

    return all(comp[2 * i] != comp[2 * i + 1] for i in range(n))


if __name__ == "__main__":
    clauses = [((0, True), (1, True)),
               ((0, False), (1, True)),
               ((1, False), (0, True))]
    print(two_sat_satisfiable(2, clauses))  # True
```

**Follow-up.** To recover the assignment, set `x_i = (comp[2i] < comp[2i+1])` using Tarjan's reverse-topo component numbering: the literal whose SCC is *later* in topological order is true.

---

### Challenge 4: Redundant Connection II (Directed)

**Problem.** A rooted tree on `n` nodes has had exactly one extra directed edge added, forming either a cycle, a node with two parents, or both. Given the `n` directed edges, return the one edge that can be removed so the result is a valid rooted tree (a single root, each other node with one parent, no cycle). Return the last such edge in input order if multiple are valid.

**Example.**

```text
edges = [[1,2],[2,3],[3,4],[4,1],[1,5]]
Output: [4,1]      // removing it breaks the cycle
```

**Constraints.** `3 <= n <= 1000`, exactly `n` edges, 1-indexed nodes. The directed-cycle case is detected with union-find / cycle logic closely related to SCC reasoning.

**Approach.** Two cases: (1) a node with two parents — record the two candidate edges; (2) a cycle. If there is a two-parent node, try removing the second candidate; if the rest forms no cycle, that is the answer, else return the first candidate. If no two-parent node, the cycle edge (found via union-find) is the answer.

**Go.**

```go
package main

import "fmt"

func findRedundantDirectedConnection(edges [][]int) []int {
	n := len(edges)
	parent := make([]int, n+1)
	var cand1, cand2 []int
	for _, e := range edges {
		u, v := e[0], e[1]
		if parent[v] != 0 { // v already has a parent → two parents
			cand1 = []int{parent[v], v}
			cand2 = []int{u, v}
		} else {
			parent[v] = u
		}
	}

	uf := make([]int, n+1)
	for i := range uf {
		uf[i] = i
	}
	var find func(x int) int
	find = func(x int) int {
		for uf[x] != x {
			uf[x] = uf[uf[x]]
			x = uf[x]
		}
		return x
	}

	for _, e := range edges {
		u, v := e[0], e[1]
		if cand2 != nil && v == cand2[1] {
			continue // skip the second candidate edge
		}
		ru := find(u)
		if ru == v { // cycle detected
			if cand1 != nil {
				return cand1
			}
			return e
		}
		uf[v] = ru
	}
	return cand2
}

func main() {
	fmt.Println(findRedundantDirectedConnection([][]int{{1, 2}, {2, 3}, {3, 4}, {4, 1}, {1, 5}}))
}
```

**Java.**

```java
import java.util.*;

public class RedundantConnectionII {
    int[] uf;

    int find(int x) {
        while (uf[x] != x) { uf[x] = uf[uf[x]]; x = uf[x]; }
        return x;
    }

    public int[] findRedundantDirectedConnection(int[][] edges) {
        int n = edges.length;
        int[] parent = new int[n + 1];
        int[] cand1 = null, cand2 = null;
        for (int[] e : edges) {
            if (parent[e[1]] != 0) {
                cand1 = new int[]{parent[e[1]], e[1]};
                cand2 = new int[]{e[0], e[1]};
            } else parent[e[1]] = e[0];
        }
        uf = new int[n + 1];
        for (int i = 0; i <= n; i++) uf[i] = i;
        for (int[] e : edges) {
            if (cand2 != null && e[1] == cand2[1]) continue;
            int ru = find(e[0]);
            if (ru == e[1]) return cand1 != null ? cand1 : e;
            uf[e[1]] = ru;
        }
        return cand2;
    }

    public static void main(String[] args) {
        int[][] edges = {{1,2},{2,3},{3,4},{4,1},{1,5}};
        System.out.println(Arrays.toString(
            new RedundantConnectionII().findRedundantDirectedConnection(edges)));
    }
}
```

**Python.**

```python
def find_redundant_directed_connection(edges):
    n = len(edges)
    parent = [0] * (n + 1)
    cand1 = cand2 = None
    for u, v in edges:
        if parent[v] != 0:
            cand1 = [parent[v], v]
            cand2 = [u, v]
        else:
            parent[v] = u

    uf = list(range(n + 1))

    def find(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x

    for u, v in edges:
        if cand2 and v == cand2[1]:
            continue
        ru = find(u)
        if ru == v:                 # cycle
            return cand1 if cand1 else [u, v]
        uf[v] = ru
    return cand2


if __name__ == "__main__":
    print(find_redundant_directed_connection([[1, 2], [2, 3], [3, 4], [4, 1], [1, 5]]))
```

**Follow-up.** This problem blends cycle detection (the SCC mindset) with the two-parents constraint. A pure SCC approach would find the cycle component; the union-find here is the standard incremental-cycle technique for the specific "remove one edge" framing.

---

## Common Pitfalls in Interviews

- **Using `low[v]` for back/cross edges.** The rule is `min(low[u], disc[v])` for on-stack edges; `low[v]` is only for tree edges. Mixing them merges SCCs.
- **Forgetting the `onStack` check.** An edge into a finished SCC must be ignored, not used to update `low`.
- **Not clearing `onStack` on pop.** Leaves stale flags and corrupts later components.
- **DFS from only one vertex.** A directed graph need not be reachable from one source — loop over all vertices.
- **Recursive Tarjan on a deep graph.** Overflows the stack; mention or write the iterative version.
- **Assuming topological output order.** Tarjan emits SCCs in **reverse** topological order; reverse if you need forward.
- **Self-loop confusion.** A self-loop is a size-1 SCC but still makes the graph cyclic.
- **Confusing the two stacks.** The recursion stack and the explicit SCC stack are different; Tarjan needs the explicit one.
- **Bridge vs SCC test mix-up.** Bridges (undirected) use `low[v] > disc[u]` with `low[v]`; SCC roots (directed) use `low[u] == disc[u]`.

---

## What Interviewers Are Really Testing

A Tarjan or SCC question is a compact way to probe several skills at once. First, **DFS mastery**: can you classify tree vs back vs cross edges and reason about the recursion/explicit stacks? Second, **invariant reasoning**: the difference between `disc[v]` and `low[v]` in the update rules is subtle, and a candidate who can explain *why* back edges use `disc` shows genuine understanding rather than a memorized template. Third, **pattern recognition**: many problems are SCC in disguise — course-schedule cycle checks, 2-SAT, critical connections, deadlock detection, redundant directed edges. Recognizing the reduction is the real test. Fourth, **production awareness**: the recursion-depth pitfall, the choice between Tarjan and Kosaraju by memory and clarity, and the condensation DAG as a normalization step all distinguish a senior candidate. You do not need to write a flawless iterative Tarjan on the first try, but you should know it exists, know why it is needed, and be able to articulate the trade-offs. The strongest answers connect the algorithm to a concrete system — "this is how a build tool rejects circular dependencies" — and reflect on testing it against a brute-force reachability oracle.
