# Eulerian Path & Circuit — Interview Preparation

Eulerian path and circuit questions are a favorite in interviews because they look intimidating ("find a route through this whole graph") but reduce to two cheap, memorable checks — degree parity and connectivity — plus one linear-time construction, Hierholzer's algorithm. They also test whether a candidate can tell *Eulerian* (every edge once, easy) apart from *Hamiltonian* (every vertex once, NP-hard), a distinction that separates the prepared from the pattern-matchers. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Undirected | Directed |
|----------|-----------|----------|
| Eulerian **circuit** exists? | all vertices even degree **and** connected (on edge-bearing vertices) | `in(v) == out(v)` for all **and** connected |
| Eulerian **path** exists? | exactly 0 or 2 odd-degree vertices **and** connected | ≤1 vertex with `out−in=+1`, ≤1 with `in−out=+1`, rest balanced **and** connected |
| Path start vertex | an odd-degree vertex (either one) | the vertex with `out−in=+1` |
| Construction | Hierholzer `O(E)` | Hierholzer `O(E)` |
| Historical / slow | Fleury `O(E²)` | Fleury `O(E²)` |
| Validity check after build | `len(trail) == E + 1` | `len(trail) == E + 1` |

```text
Iterative Hierholzer:
  stack = [start]; trail = []
  while stack:
    v = stack.top
    if v has an unused out-edge (v,w): mark used; stack.push(w)
    else: trail.append(stack.pop())
  return reverse(trail)        # Eulerian iff len(trail) == E + 1
```

Key facts to memorize:
- Number of odd-degree vertices is always **even** (handshake lemma).
- "0 or 2 odd" — never 1, never 4 for a *trail*.
- Degree check alone is **not** sufficient: you must also verify connectivity.
- Eulerian = every **edge** once (P). Hamiltonian = every **vertex** once (NP-hard).

---

## Junior Questions (12 Q&A)

### J1. What is an Eulerian circuit vs an Eulerian path?
An Eulerian circuit is a closed walk that uses every edge of the graph exactly once and returns to its starting vertex. An Eulerian path (or trail) uses every edge exactly once but starts and ends at different vertices. A circuit is a special case of a path where the endpoints coincide. Both forbid reusing an edge; vertices may be revisited.

### J2. What are the conditions for an undirected Eulerian circuit?
Two conditions: (1) every vertex has even degree, and (2) all edges belong to a single connected component (isolated vertices with no edges are ignored). Both are necessary and sufficient. If any vertex has odd degree, no circuit exists.

### J3. What are the conditions for an undirected Eulerian path?
Exactly 0 or 2 vertices have odd degree, and the graph is connected on its edge-bearing vertices. If there are 2 odd vertices, the path must start at one and end at the other. If there are 0 odd vertices you actually have a circuit (which is also a path). Any other count of odd vertices means no Eulerian trail exists.

### J4. Why must the count of odd-degree vertices be 0 or 2?
The sum of all degrees equals twice the number of edges, hence is even, so the number of odd-degree vertices is always even. As you walk a trail, each intermediate vertex pairs an entering edge with a leaving edge, needing even degree; only the start and end of an open trail can be odd. So you can have 0 (circuit) or 2 (open path) odd vertices, but never 1, 3, or any odd count.

### J5. What was the Seven Bridges of Königsberg problem?
Königsberg had four landmasses connected by seven bridges. The puzzle asked whether one could walk crossing every bridge exactly once. Euler modeled landmasses as vertices and bridges as edges, observed that all four vertices had odd degree, and concluded no such walk exists — because an Eulerian trail needs 0 or 2 odd vertices, not 4. This 1736 result founded graph theory.

### J6. What are the directed conditions?
For an Eulerian circuit, every vertex must satisfy `in-degree == out-degree`, and the graph must be connected (strongly, on edge-bearing vertices). For an Eulerian path, exactly one vertex has `out − in = +1` (the start), exactly one has `in − out = +1` (the end), and all others are balanced.

### J7. What is Hierholzer's algorithm?
It is the standard `O(E)` method to construct an Eulerian trail. Starting from a valid vertex, you follow unused edges until you get stuck, forming a cycle; then you find a vertex on that cycle with leftover edges, form another cycle, and splice it in. The iterative version uses an explicit stack: push along unused edges, and when stuck, pop the vertex into an output list. Reversing the output gives the trail.

### J8. Why is the output of Hierholzer reversed?
Because vertices are appended to the output list when they are *popped* off the stack — that is, when no more edges leave them. The deepest dead-end is popped first, so the output is built end-to-start. Reversing it yields the trail in forward order.

### J9. What is Fleury's algorithm and why is it slower?
Fleury's algorithm walks one edge at a time with the rule "never cross a bridge unless it is your only option." Detecting whether an edge is a bridge costs `O(V + E)` each time, and you do this per edge, so the whole algorithm is `O(E²)`. Hierholzer avoids bridge checks entirely and runs in `O(E)`, so it is preferred.

### J10. Is checking degrees enough to know a circuit exists?
No. Degrees being all even is necessary but not sufficient. Consider two separate triangles: every vertex has degree 2 (even), but the graph is two components, so no single circuit covers all edges. You must also check connectivity of the edge-bearing vertices.

### J11. How do self-loops and parallel edges affect things?
A self-loop adds 2 to a vertex's degree (it is one edge with both endpoints at the same vertex), so it keeps parity even and is harmless. Parallel edges (a multigraph) are fine too — they each count toward degree and must each be traversed; you distinguish them with edge IDs so each is used exactly once.

### J12 (analysis). Why is Hierholzer O(E) and not O(E²)?
Because each edge is examined a constant number of times. Using a per-vertex pointer `iter[v]` into the adjacency list, you never re-scan edges you have already passed. Every edge is pushed onto the stack once and the corresponding vertex popped once, so the total work is proportional to the number of edges plus vertices: `O(V + E)`, which for connected graphs is `O(E)`.

---

## Middle Questions (12 Q&A)

### M1. Prove the degree condition is necessary for a circuit.
Walk the Eulerian circuit. Each time you visit a vertex `v` you enter on one edge and leave on another, consuming two of `v`'s incident edges. Since the circuit is closed and uses every incident edge of `v` exactly once, all of `v`'s edges pair up into in/out couples, so `deg(v)` is even. This holds for every vertex, proving necessity.

### M2. Sketch why the conditions are sufficient.
This is Hierholzer's correctness. From any start, greedily walk unused edges; because every vertex has even degree, you can always leave an intermediate vertex, so the walk can only get stuck back at the start, forming a cycle. Removing that cycle keeps all degrees even; connectivity guarantees a leftover vertex on the cycle still has edges, from which you form and splice another cycle. Repeating covers all edges, constructing the circuit.

### M3. How do you find the lexicographically smallest Eulerian path?
Sort each adjacency list ascending (or use a min-heap), then run Hierholzer always taking the smallest unused edge first. Because Hierholzer appends on pop and you reverse at the end, the greedy smallest-first choice yields the lexicographically smallest valid trail. This is the technique behind LeetCode 332, Reconstruct Itinerary.

### M4. What is a de Bruijn sequence and how does it relate?
A de Bruijn sequence `B(k, n)` is a cyclic string over a `k`-symbol alphabet containing every length-`n` string exactly once as a substring. You build a de Bruijn graph whose vertices are `(n−1)`-length strings and whose edges are `n`-length strings (overlaps). Every vertex has equal in- and out-degree, so an Eulerian circuit exists, and that circuit spells the de Bruijn sequence. This is exactly LeetCode 753, Cracking the Safe.

### M5. How does genome assembly use Eulerian paths?
Short DNA reads are split into `k`-mers. A de Bruijn graph is built with `(k−1)`-mers as vertices and `k`-mers as edges. The original genome corresponds to an Eulerian path through this graph. Assemblers run Hierholzer-style traversals (with heavy error cleanup) to reconstruct the sequence. The key win: this replaced the older Hamiltonian-path (overlap graph) formulation, which is NP-hard.

### M6. Contrast Eulerian and Hamiltonian problems.
Eulerian asks to visit every edge once; Hamiltonian asks to visit every vertex once. Eulerian existence is decidable in `O(V + E)` and constructible in `O(E)`. Hamiltonian existence is NP-complete with no known efficient characterization. The names sound similar but the complexity gap is enormous — a single word, edge vs vertex, flips easy to intractable.

### M7. What is the Chinese Postman problem?
Find the shortest closed walk that traverses every edge at least once (edges may repeat). If the graph is Eulerian, the answer is just the sum of edge weights. Otherwise, find the odd-degree vertices, compute a minimum-weight perfect matching among them using shortest-path distances, duplicate the matched paths to make all degrees even, then run Hierholzer. The cost is the total edge weight plus the matching cost.

### M8. How do you detect connectivity for the existence test efficiently?
Run one BFS or DFS from any vertex that has at least one edge, and verify it reaches all other edge-bearing vertices. For directed circuits, weak connectivity plus balance suffices; for directed paths, check reachability from the start and co-reachability to the end (or strong connectivity of edge-bearing vertices). Ignore isolated vertices entirely.

### M9. Why prefer the iterative Hierholzer over the recursive one?
The recursive version can recurse to a depth equal to the number of edges. On a long path graph with `10⁶` edges, that overflows the call stack. The iterative version uses an explicit heap-allocated stack, so it handles arbitrarily long trails. They are otherwise equivalent in correctness and asymptotic cost.

### M10. How do you handle an undirected edge so it is not used twice?
Store each undirected edge once with a unique `edge_id`, and add it to both endpoints' adjacency lists carrying that shared id. Keep a `used[edge_id]` boolean. When you traverse the edge from either side, set `used[edge_id] = true`. Checking that flag before traversing prevents the second endpoint from reusing it.

### M11. After running Hierholzer, how do you know it succeeded?
Check that the output trail has exactly `E + 1` vertices (one more than the number of edges). If it is shorter, the graph was disconnected and the trail only covered one component. This length check is essential because the degree condition alone does not rule out disconnection.

### M12 (analysis). What is the complexity of the full pipeline including the Chinese Postman?
The existence test is `O(V + E)`. Hierholzer is `O(E)`. The de Bruijn construction is `O(k^n)` because the output itself has that size. The Chinese Postman is dominated by minimum-weight perfect matching on the odd vertices, `O(V³)` with the blossom algorithm, plus all-pairs shortest paths among odd vertices. So the Euler tour is never the bottleneck; matching is.

---

## Senior Questions (10 Q&A)

### S1. How would you find an Eulerian path in a graph with billions of edges?
First compact non-branching chains into single edges (unitigs) to shrink the graph, which often makes it fit in memory. Partition into connected components, since Eulerian construction is independent per component, and process each component, possibly on different machines. Use a flat CSR adjacency layout for cache efficiency and `int32` vertex ids to halve memory. If a single component is still too large, stream its adjacency from disk with an external-memory traversal.

### S2. Can Hierholzer be parallelized?
Across connected components, yes — trivially, since they are independent. Within a single component it is hard: the `used[edge]` flags are shared mutable state that would race, and the splice order is a sequential dependency. In practice, per-component parallelism suffices. Production assemblers emit independent unitigs and stitch them with side information rather than parallelizing one global tour.

### S3. Why is the directed connectivity check subtle?
For a directed Eulerian circuit, if every vertex is balanced (`in = out`) and the edge-bearing vertices are weakly connected, then they are automatically strongly connected, so a weak check suffices. But for an open directed path, balance does not give you that guarantee, so you must check reachability from the start vertex and co-reachability to the end vertex explicitly. Getting this wrong yields a partial trail.

### S4. How would you count the number of Eulerian circuits in a directed graph?
Use the BEST theorem: the count equals the number of arborescences (directed spanning trees) rooted at any fixed vertex, times the product over vertices of `(out(v) − 1)!`. The arborescence count is a cofactor of the graph Laplacian, computable as a determinant in `O(V³)` via the Matrix-Tree theorem. So directed Eulerian circuits are counted in polynomial time — unlike the undirected case, which is #P-complete.

### S5. When is the graph "almost Eulerian" and what do you do?
In genome assembly, real graphs are rarely perfectly Eulerian due to sequencing errors, coverage gaps, and repeats. Rather than demand one global tour, you clean the graph (remove tips and bubbles), then extract maximal unambiguous paths and emit many contigs, deferring the join step to scaffolding with paired or long reads. The pure Eulerian formulation is the conceptual core; the implementation relaxes it heavily.

### S6. How do you ensure reproducible Euler tours?
Hierholzer's output depends on adjacency order, so two runs over the same graph can produce different valid trails. To make the output deterministic and reproducible — important in scientific pipelines — fix the adjacency order, for example by sorting each list. Then the same input always yields the same trail.

### S7. What metrics would you monitor in a long-running Euler-based pipeline?
Graph edge count after each compaction stage, number of connected components, the maximum component size (which drives peak memory), edges consumed versus total per component (the best progress/stall signal), balance violations (a graph-cleanup quality signal), and stage durations. A stalled `edges_consumed` ratio almost always means a non-Eulerian component or memory thrashing.

### S8. How does the mixed Chinese Postman differ from the undirected one?
The undirected Chinese Postman is polynomial (matching of odd vertices). The directed version is also polynomial (a min-cost flow). But the *mixed* version, where some edges are directed and some undirected, is NP-hard. So the tractability of route inspection depends sharply on edge orientation — a good senior-level nuance.

### S9. What is the relationship to the Euler tour technique on trees?
The "Euler tour technique" linearizes a tree by walking it in a DFS that traverses each edge twice (down and up), producing a sequence used for LCA, subtree queries, etc. It is named after Euler tours but is a different application — it deliberately uses each edge twice to capture subtree structure, whereas an Eulerian circuit uses each edge once. Do not conflate them.

### S10 (analysis). Why does directedness barely affect existence but completely change counting?
Existence depends on a local balance condition (`in = out` or degree parity) plus connectivity, which is structurally similar in both cases and checkable in linear time. Counting, however, depends on global combinatorial structure: for directed graphs the BEST theorem ties it to spanning arborescences (a determinant, polynomial), while the undirected count has no such algebraic handle and is #P-complete. The asymmetry reflects that directed spanning trees are algebraically tractable in a way undirected Eulerian structure is not.

---

## Professional Questions (8 Q&A)

### P1. State and explain the BEST theorem.
For a connected directed graph with `in(v) = out(v)` everywhere, the number of Eulerian circuits is `ec(G) = tw(G) · Π_v (out(v) − 1)!`, where `tw(G)` is the number of arborescences rooted at any vertex (root-independent for Eulerian digraphs). `tw(G)` is a Laplacian cofactor computed via the Matrix-Tree theorem. The intuition: an Eulerian circuit is determined by choosing, at each vertex, an ordering of its out-edges, constrained so the "last" out-edges form an arborescence toward the root.

### P2. Why is counting undirected Eulerian circuits #P-complete but the directed version polynomial?
The directed count factors algebraically through spanning arborescences (a determinant), giving the BEST formula. The undirected case has no such factorization; Brightwell and Winkler (2005) proved it #P-complete. Structurally, directed out-edge orderings combine with arborescences in a clean bijection that the undirected setting lacks, so the directed problem inherits the polynomial-time computability of determinants.

### P3. Prove Hierholzer runs in O(V + E).
Building adjacency and degree arrays is `O(V + E)`. In the main loop, each iteration either advances some `iter[v]` (a push) or pops a vertex. Total pushes are bounded by `Σ out(v) = E`, since `iter[v]` advances at most `out(v)` times. Pops equal pushes plus one. Each push/pop is amortized `O(1)`. So the loop is `O(E)`, and the total including setup and the final reversal is `O(V + E)`.

### P4. How does the auxiliary-edge trick reduce path-finding to circuit-finding?
If a graph has exactly two odd-degree vertices `s` and `t`, add a temporary edge between them. Now all degrees are even, so an Eulerian circuit exists; find it with Hierholzer. Remove the temporary edge from the circuit, which reopens it into an Eulerian path from `s` to `t`. This is why implementations can simply start Hierholzer at an odd vertex without special-casing paths.

### P5. Discuss cache behavior of Hierholzer at scale.
Locality is dominated by adjacency layout, not the algorithm. A CSR (compressed sparse row) layout stores each vertex's neighbors contiguously, so the `iter[v]` pointer walks sequential memory, giving roughly `O(E/B + V)` cache misses for line size `B`. Pointer-chased adjacency lists incur a miss per edge hop. The stack and output are append-only and cache-friendly; the `used[]` flag array is random-access but touched once per edge.

### P6. What changes for an out-of-core Eulerian construction?
When the graph exceeds RAM, you analyze I/O complexity. A well-ordered CSR on disk lets the edge scan proceed near-sequentially, giving about `O(E/B)` I/Os, which is near-optimal. You keep `O(V)` state (pointers, degree info) in RAM and stream edges. The per-vertex pointer pattern is naturally I/O-friendly because each edge is read exactly once.

### P7. How would you uniformly sample a random Eulerian circuit of a directed graph?
Use the BEST-theorem bijection: an Eulerian circuit corresponds to a (spanning arborescence, local out-edge orderings) pair. Sample a uniformly random arborescence in polynomial time using Wilson's algorithm (loop-erased random walks), then sample the local orderings uniformly. This yields an exact uniform sampler. No comparably clean sampler is known for undirected Eulerian circuits, consistent with their #P-complete counting.

### P8 (analysis). Why is the Eulerian-vs-Hamiltonian gap a clean illustration of P vs NP?
Eulerian existence has a local certificate — a per-vertex degree check plus connectivity, verifiable in linear time — which puts it in P. Hamiltonicity has no known local certificate: vertex degrees say almost nothing about whether a vertex-covering cycle exists, and the problem is NP-complete. The same edge-vs-vertex distinction propagates to optimization (Chinese Postman in P vs TSP NP-hard) and counting. It demonstrates that superficially similar problems can sit on opposite sides of the tractability boundary.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you reduced a hard problem to a known one.
Look for a story where the candidate recognized that a disguised problem ("shortest string containing all patterns," "route covering every street") was actually an Eulerian circuit or de Bruijn construction, and exploited the linear-time algorithm instead of brute force. Strong answers describe the reduction explicitly and quantify the speedup.

### B2. Design a system that assembles a genome from short reads.
The Eulerian-path / de Bruijn graph approach is the expected answer. Discuss `k`-mer counting and filtering, building and compacting the de Bruijn graph, error cleanup (tips and bubbles), per-component Euler/unitig extraction, and scaffolding with paired or long reads. Strong candidates note that the raw graph is rarely Eulerian and that the system emits contigs rather than one perfect tour, and they reason about memory at the hundreds-of-GB scale.

### B3. Design a route planner for a street-sweeping fleet.
This is the Chinese Postman problem, extended to multiple vehicles and constraints. Discuss modeling streets as edges, finding odd-degree intersections, minimum-weight matching to make the graph Eulerian, then Hierholzer for each vehicle's route. Bring up one-way streets (directed/mixed Postman), capacity, time windows, and how the matching dominates cost. Note the mixed version is NP-hard, so heuristics may be needed.

### B4. A teammate insists on Fleury's algorithm. How do you respond?
Acknowledge Fleury is intuitive and historically important, but explain that its per-edge bridge check makes it `O(E²)`, while Hierholzer achieves `O(E)` with simpler bookkeeping and no bridge detection. Suggest Hierholzer for any production or large-input use, reserving Fleury for teaching. Frame it as choosing the right tool, not dismissing a colleague.

### B5. Your Euler-tour service crashes on large inputs. How do you debug?
The most likely cause is a recursive Hierholzer overflowing the stack at depth `O(E)`. Switch to the iterative version. Also check for the disconnection bug (trail shorter than `E + 1`) and for undirected edges double-counted because they were marked used per direction instead of per edge id. Add metrics for component sizes and edges consumed to localize stalls.

---

## Coding Challenges

### Challenge 1: Reconstruct Itinerary (LeetCode 332)

**Problem.** Given a list of airline tickets `[from, to]`, reconstruct the itinerary in order. All tickets belong to a person who departs from `"JFK"`, so the itinerary must begin there. If multiple valid itineraries exist, return the lexicographically smallest. You must use all the tickets exactly once.

**Example.**

```text
tickets = [["MUC","LHR"],["JFK","MUC"],["SFO","SJC"],["LHR","SFO"]]
output  = ["JFK","MUC","LHR","SFO","SJC"]
```

**Approach.** This is a directed Eulerian path starting at `"JFK"`. Sort each adjacency list (or use a min-heap) so the smallest destination is taken first, then run iterative Hierholzer and reverse the output. `O(E log E)` for the sort, `O(E)` for the tour.

**Go.**

```go
package main

import (
	"fmt"
	"sort"
)

func findItinerary(tickets [][]string) []string {
	adj := map[string][]string{}
	for _, t := range tickets {
		adj[t[0]] = append(adj[t[0]], t[1])
	}
	for k := range adj {
		sort.Strings(adj[k])
	}
	idx := map[string]int{}
	var route, stack []string
	stack = append(stack, "JFK")
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if idx[v] < len(adj[v]) {
			next := adj[v][idx[v]]
			idx[v]++
			stack = append(stack, next)
		} else {
			route = append(route, v)
			stack = stack[:len(stack)-1]
		}
	}
	for i, j := 0, len(route)-1; i < j; i, j = i+1, j-1 {
		route[i], route[j] = route[j], route[i]
	}
	return route
}

func main() {
	tickets := [][]string{{"MUC", "LHR"}, {"JFK", "MUC"}, {"SFO", "SJC"}, {"LHR", "SFO"}}
	fmt.Println(findItinerary(tickets))
}
```

**Java.**

```java
import java.util.*;

public class Itinerary {
    public List<String> findItinerary(List<List<String>> tickets) {
        Map<String, PriorityQueue<String>> adj = new HashMap<>();
        for (List<String> t : tickets)
            adj.computeIfAbsent(t.get(0), x -> new PriorityQueue<>()).add(t.get(1));
        LinkedList<String> route = new LinkedList<>();
        Deque<String> stack = new ArrayDeque<>();
        stack.push("JFK");
        while (!stack.isEmpty()) {
            String v = stack.peek();
            PriorityQueue<String> pq = adj.get(v);
            if (pq != null && !pq.isEmpty()) stack.push(pq.poll());
            else route.addFirst(stack.pop());
        }
        return route;
    }

    public static void main(String[] args) {
        List<List<String>> t = Arrays.asList(
            Arrays.asList("MUC", "LHR"), Arrays.asList("JFK", "MUC"),
            Arrays.asList("SFO", "SJC"), Arrays.asList("LHR", "SFO"));
        System.out.println(new Itinerary().findItinerary(t));
    }
}
```

**Python.**

```python
import heapq
from collections import defaultdict


def find_itinerary(tickets):
    adj = defaultdict(list)
    for src, dst in tickets:
        heapq.heappush(adj[src], dst)
    route, stack = [], ["JFK"]
    while stack:
        v = stack[-1]
        if adj[v]:
            stack.append(heapq.heappop(adj[v]))
        else:
            route.append(stack.pop())
    return route[::-1]


if __name__ == "__main__":
    tickets = [["MUC", "LHR"], ["JFK", "MUC"], ["SFO", "SJC"], ["LHR", "SFO"]]
    print(find_itinerary(tickets))
```

**Follow-up.** Why does taking the smallest edge first plus reversing yield the lexicographically smallest itinerary, rather than just a valid one? Because a "stuck" dead-end gets pushed onto the output first (appearing last after reversal); greedily exhausting small edges keeps them early in the final order.

---

### Challenge 2: Valid Arrangement of Pairs (LeetCode 2097)

**Problem.** You are given `pairs` where `pairs[i] = [starti, endi]`. An arrangement is valid if for every `i > 0`, `end` of the previous pair equals `start` of the current pair. Return any valid arrangement using all pairs (one is guaranteed to exist).

**Example.**

```text
pairs  = [[5,1],[4,5],[11,9],[9,4]]
output = [[11,9],[9,4],[4,5],[5,1]]
```

**Approach.** This is a directed Eulerian path where each pair is an arc `start -> end`. Find the start vertex: a vertex with `out − in = 1` if one exists, else any vertex with an out-edge. Run Hierholzer, reverse, and emit consecutive vertex pairs as the arrangement. `O(E)`.

**Go.**

```go
package main

import "fmt"

func validArrangement(pairs [][]int) [][]int {
	adj := map[int][]int{}
	out, in := map[int]int{}, map[int]int{}
	for _, p := range pairs {
		adj[p[0]] = append(adj[p[0]], p[1])
		out[p[0]]++
		in[p[1]]++
	}
	start := pairs[0][0]
	for v := range out {
		if out[v]-in[v] == 1 {
			start = v
			break
		}
	}
	idx := map[int]int{}
	var route, stack []int
	stack = append(stack, start)
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if idx[v] < len(adj[v]) {
			next := adj[v][idx[v]]
			idx[v]++
			stack = append(stack, next)
		} else {
			route = append(route, v)
			stack = stack[:len(stack)-1]
		}
	}
	for i, j := 0, len(route)-1; i < j; i, j = i+1, j-1 {
		route[i], route[j] = route[j], route[i]
	}
	res := make([][]int, 0, len(route)-1)
	for i := 0; i+1 < len(route); i++ {
		res = append(res, []int{route[i], route[i+1]})
	}
	return res
}

func main() {
	pairs := [][]int{{5, 1}, {4, 5}, {11, 9}, {9, 4}}
	fmt.Println(validArrangement(pairs))
}
```

**Java.**

```java
import java.util.*;

public class Arrangement {
    public int[][] validArrangement(int[][] pairs) {
        Map<Integer, Deque<Integer>> adj = new HashMap<>();
        Map<Integer, Integer> out = new HashMap<>(), in = new HashMap<>();
        for (int[] p : pairs) {
            adj.computeIfAbsent(p[0], x -> new ArrayDeque<>()).push(p[1]);
            out.merge(p[0], 1, Integer::sum);
            in.merge(p[1], 1, Integer::sum);
        }
        int start = pairs[0][0];
        for (int v : out.keySet())
            if (out.get(v) - in.getOrDefault(v, 0) == 1) { start = v; break; }

        Deque<Integer> stack = new ArrayDeque<>();
        LinkedList<Integer> route = new LinkedList<>();
        stack.push(start);
        while (!stack.isEmpty()) {
            int v = stack.peek();
            Deque<Integer> nb = adj.get(v);
            if (nb != null && !nb.isEmpty()) stack.push(nb.pop());
            else route.addFirst(stack.pop());
        }
        int[][] res = new int[route.size() - 1][2];
        for (int i = 0; i < res.length; i++) {
            res[i][0] = route.get(i);
            res[i][1] = route.get(i + 1);
        }
        return res;
    }

    public static void main(String[] args) {
        int[][] pairs = {{5, 1}, {4, 5}, {11, 9}, {9, 4}};
        System.out.println(Arrays.deepToString(new Arrangement().validArrangement(pairs)));
    }
}
```

**Python.**

```python
from collections import defaultdict


def valid_arrangement(pairs):
    adj = defaultdict(list)
    out, ind = defaultdict(int), defaultdict(int)
    for s, e in pairs:
        adj[s].append(e)
        out[s] += 1
        ind[e] += 1
    start = pairs[0][0]
    for v in out:
        if out[v] - ind[v] == 1:
            start = v
            break
    idx = defaultdict(int)
    route, stack = [], [start]
    while stack:
        v = stack[-1]
        if idx[v] < len(adj[v]):
            stack.append(adj[v][idx[v]])
            idx[v] += 1
        else:
            route.append(stack.pop())
    route.reverse()
    return [[route[i], route[i + 1]] for i in range(len(route) - 1)]


if __name__ == "__main__":
    print(valid_arrangement([[5, 1], [4, 5], [11, 9], [9, 4]]))
```

**Follow-up.** The problem guarantees a valid arrangement exists, so you can skip the existence check. How would the code change if it were not guaranteed? Add the `len(route) == len(pairs) + 1` check and balance validation, returning empty on failure.

---

### Challenge 3: Cracking the Safe (LeetCode 753) — de Bruijn Sequence

**Problem.** There is a safe protected by a password that is a sequence of `n` digits, each in `[0, k)`. The safe opens if the last `n` digits entered match the password. Return any shortest string of digits that is guaranteed to open the safe regardless of the password.

**Example.**

```text
n = 2, k = 2  ->  "00110" (length 5; contains 00,01,11,10)
```

**Approach.** The answer is a de Bruijn sequence `B(k, n)`. Build the de Bruijn graph (vertices are `(n−1)`-digit strings; edges append one digit) and find an Eulerian circuit via Hierholzer. The minimum length is `k^n + n − 1`.

**Go.**

```go
package main

import (
	"fmt"
	"strings"
)

func crackSafe(n, k int) string {
	if n == 1 {
		var b strings.Builder
		for i := 0; i < k; i++ {
			b.WriteByte(byte('0' + i))
		}
		return b.String()
	}
	numV := 1
	for i := 0; i < n-1; i++ {
		numV *= k
	}
	iter := make([]int, numV)
	var edges []byte
	var nodeStack, edgeStack []int
	nodeStack = append(nodeStack, 0)
	edgeStack = append(edgeStack, -1)
	for len(nodeStack) > 0 {
		v := nodeStack[len(nodeStack)-1]
		if iter[v] < k {
			c := iter[v]
			iter[v]++
			next := (v*k + c) % numV
			nodeStack = append(nodeStack, next)
			edgeStack = append(edgeStack, c)
		} else {
			nodeStack = nodeStack[:len(nodeStack)-1]
			c := edgeStack[len(edgeStack)-1]
			edgeStack = edgeStack[:len(edgeStack)-1]
			if c >= 0 {
				edges = append(edges, byte('0'+c))
			}
		}
	}
	// edges are collected in reverse; build the sequence
	for i, j := 0, len(edges)-1; i < j; i, j = i+1, j-1 {
		edges[i], edges[j] = edges[j], edges[i]
	}
	// prefix with (n-1) zeros (the starting vertex string)
	prefix := strings.Repeat("0", n-1)
	return prefix + string(edges)
}

func main() {
	fmt.Println(crackSafe(2, 2))
}
```

**Java.**

```java
public class Safe {
    public String crackSafe(int n, int k) {
        if (n == 1) {
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < k; i++) s.append(i);
            return s.toString();
        }
        int numV = 1;
        for (int i = 0; i < n - 1; i++) numV *= k;
        int[] iter = new int[numV];
        StringBuilder edges = new StringBuilder();
        java.util.Deque<Integer> nodeStack = new java.util.ArrayDeque<>();
        java.util.Deque<Integer> edgeStack = new java.util.ArrayDeque<>();
        nodeStack.push(0);
        edgeStack.push(-1);
        while (!nodeStack.isEmpty()) {
            int v = nodeStack.peek();
            if (iter[v] < k) {
                int c = iter[v]++;
                nodeStack.push((v * k + c) % numV);
                edgeStack.push(c);
            } else {
                nodeStack.pop();
                int c = edgeStack.pop();
                if (c >= 0) edges.append(c);
            }
        }
        edges.reverse();
        StringBuilder prefix = new StringBuilder();
        for (int i = 0; i < n - 1; i++) prefix.append('0');
        return prefix.append(edges).toString();
    }

    public static void main(String[] args) {
        System.out.println(new Safe().crackSafe(2, 2));
    }
}
```

**Python.**

```python
def crack_safe(n, k):
    if n == 1:
        return "".join(str(i) for i in range(k))
    num_v = k ** (n - 1)
    it = [0] * num_v
    node_stack, edge_stack, edges = [0], [-1], []
    while node_stack:
        v = node_stack[-1]
        if it[v] < k:
            c = it[v]
            it[v] += 1
            node_stack.append((v * k + c) % num_v)
            edge_stack.append(c)
        else:
            node_stack.pop()
            c = edge_stack.pop()
            if c >= 0:
                edges.append(str(c))
    edges.reverse()
    return "0" * (n - 1) + "".join(edges)


if __name__ == "__main__":
    print(crack_safe(2, 2))
```

**Follow-up.** What is the minimum length, and why? It is `k^n + n − 1`: there are `k^n` passwords to cover, each adding one new digit after the initial `(n−1)`-digit prefix that primes the window.

---

### Challenge 4: Check if a Graph Has an Eulerian Path (existence only)

**Problem.** Given an undirected graph (as an edge list with `n` vertices), return `0` if it has neither an Eulerian path nor circuit, `1` if it has an Eulerian path but not a circuit, and `2` if it has an Eulerian circuit.

**Approach.** Count degrees, count odd-degree vertices, and check connectivity of edge-bearing vertices with a DFS/union-find. `0 odd + connected -> 2`, `2 odd + connected -> 1`, otherwise `0`.

**Go.**

```go
package main

import "fmt"

func eulerType(n int, edges [][2]int) int {
	deg := make([]int, n)
	adj := make([][]int, n)
	for _, e := range edges {
		deg[e[0]]++
		deg[e[1]]++
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	// connectivity among vertices with edges
	start := -1
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			start = v
			break
		}
	}
	if start == -1 {
		return 2 // no edges: trivially a circuit
	}
	seen := make([]bool, n)
	stack := []int{start}
	seen[start] = true
	count := 1
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, w := range adj[v] {
			if !seen[w] {
				seen[w] = true
				count++
				stack = append(stack, w)
			}
		}
	}
	withEdges := 0
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			withEdges++
		}
	}
	if count != withEdges {
		return 0 // disconnected
	}
	odd := 0
	for v := 0; v < n; v++ {
		if deg[v]%2 == 1 {
			odd++
		}
	}
	switch odd {
	case 0:
		return 2
	case 2:
		return 1
	default:
		return 0
	}
}

func main() {
	fmt.Println(eulerType(4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}})) // 1
}
```

**Java.**

```java
import java.util.*;

public class EulerType {
    public int eulerType(int n, int[][] edges) {
        int[] deg = new int[n];
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] e : edges) {
            deg[e[0]]++; deg[e[1]]++;
            adj[e[0]].add(e[1]); adj[e[1]].add(e[0]);
        }
        int start = -1;
        for (int v = 0; v < n; v++) if (deg[v] > 0) { start = v; break; }
        if (start == -1) return 2;
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(start); seen[start] = true; int count = 1;
        while (!st.isEmpty()) {
            int v = st.pop();
            for (int w : adj[v]) if (!seen[w]) { seen[w] = true; count++; st.push(w); }
        }
        int withEdges = 0;
        for (int v = 0; v < n; v++) if (deg[v] > 0) withEdges++;
        if (count != withEdges) return 0;
        int odd = 0;
        for (int v = 0; v < n; v++) if (deg[v] % 2 == 1) odd++;
        if (odd == 0) return 2;
        if (odd == 2) return 1;
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(new EulerType().eulerType(4,
            new int[][]{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}}));
    }
}
```

**Python.**

```python
def euler_type(n, edges):
    deg = [0] * n
    adj = [[] for _ in range(n)]
    for u, v in edges:
        deg[u] += 1
        deg[v] += 1
        adj[u].append(v)
        adj[v].append(u)
    start = next((v for v in range(n) if deg[v] > 0), -1)
    if start == -1:
        return 2
    seen = [False] * n
    stack = [start]
    seen[start] = True
    count = 1
    while stack:
        v = stack.pop()
        for w in adj[v]:
            if not seen[w]:
                seen[w] = True
                count += 1
                stack.append(w)
    with_edges = sum(1 for v in range(n) if deg[v] > 0)
    if count != with_edges:
        return 0
    odd = sum(1 for v in range(n) if deg[v] % 2 == 1)
    return {0: 2, 2: 1}.get(odd, 0)


if __name__ == "__main__":
    print(euler_type(4, [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2)]))  # 1
```

**Follow-up.** Extend it to directed graphs: replace parity with in/out balance, and check that all edge-bearing vertices are reachable (strong connectivity / reachability from the candidate start).

---

## Common Pitfalls in Interviews

- **Forgetting the connectivity check.** All-even degrees with two components has no Eulerian circuit. State and check connectivity explicitly.
- **Confusing Eulerian with Hamiltonian.** "Every edge once" is easy; "every vertex once" is NP-hard. Restate which one the problem wants.
- **Re-scanning adjacency from index 0** each visit, turning `O(E)` into `O(E²)`. Use the `iter[v]` forward pointer.
- **Marking undirected edges used per direction**, causing each to be traversed twice. Share one edge id.
- **Using recursion** and overflowing the stack on long trails. Use the iterative version.
- **Wrong start for a path.** With two odd vertices, start at one of them; with a directed path, start at the `out−in=+1` vertex.
- **Skipping the `len == E + 1` validity check.** It is the only thing catching disconnection after a passing degree test.
- **Reversing or not reversing the output incorrectly.** Hierholzer builds the trail backward; remember to reverse.

---

## What Interviewers Are Really Testing

A good interviewer is not checking whether you memorized "0 or 2 odd vertices." They are probing three things. First, can you **recognize the reduction**? Many problems — reconstruct itinerary, valid arrangement of pairs, cracking the safe, shortest superstring of all k-mers — are Eulerian paths or de Bruijn constructions in disguise. The candidate who sees the graph hiding in the prose stands out immediately. Second, can you **implement Hierholzer correctly under the gotchas**? The iterator pointer for linear time, edge ids for undirected graphs, the iterative stack to avoid overflow, the reverse at the end, and the `E + 1` validity check are exactly the details that separate code that passes the samples from code that passes the hidden tests. Third, do you **understand why it works and where it sits**? The degree conditions being necessary *and* sufficient, the constructive sufficiency proof being the algorithm itself, the sharp contrast with NP-hard Hamiltonicity, and the real-world payoff in genome assembly — these show depth. The best answers connect the small whiteboard problem to the big picture: this is the same idea that assembles genomes, the same idea Euler used on seven bridges in 1736, and the same idea that distinguishes a polynomial problem from an intractable one.
