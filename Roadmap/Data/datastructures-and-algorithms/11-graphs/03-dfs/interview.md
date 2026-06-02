# Depth-First Search — Interview Preparation

Depth-First Search is one of the highest-leverage topics you can prepare for a coding interview. It is small enough to write on a whiteboard, yet it is the engine behind a remarkable number of "medium" and "hard" graph problems: number of islands, clone graph, course schedule, detect cycle, connected components, flood fill, and topological sort. A candidate who truly understands DFS — the visited set, the white/gray/black coloring, discovery and finish times, the recursion-vs-explicit-stack trade-off, and the parent rule for undirected graphs — can derive most of these on the spot instead of memorizing them. This file is a curated bank of questions sorted by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value | Notes |
|--------|-------|-------|
| Time (adjacency list) | **O(V + E)** | Each vertex entered once, each edge inspected a constant number of times. |
| Time (adjacency matrix) | **O(V²)** | Scanning a row to find neighbours costs `O(V)` per vertex. |
| Space | **O(V)** | Visited array plus the recursion/explicit stack. |
| Mark visited | on entry (recursive) / on pop (iterative) | Never on push — a vertex may be pushed many times. |
| Shortest path? | **No** — use BFS for unweighted | DFS finds *a* path, not the shortest. |
| Preorder | record on entry (discovery) | "Process node, then subtree." |
| Postorder | record after all children finish | Reverse of postorder of a DAG = topological order. |
| Undirected cycle | back edge to a visited **non-parent** | Thread the parent through the recursion. |
| Directed cycle | edge into a **GRAY** vertex (on the stack) | Color rule, not parent rule. |

State colors (CLRS):

```text
WHITE  not yet discovered
GRAY   discovered, still on the recursion stack (inside its [disc, fin] interval)
BLACK  finished, all descendants done
```

Edge classification (decided by the color of `v` when edge `(u, v)` is examined):

```text
v WHITE                       -> TREE edge    (discovers v)
v GRAY                        -> BACK edge    (cycle in a directed graph)
v BLACK and disc[u] < disc[v] -> FORWARD edge
v BLACK and disc[u] > disc[v] -> CROSS edge
undirected graphs have ONLY tree and back edges
```

Recursive skeleton:

```text
dfs(u):
    color[u] = GRAY; disc[u] = ++time
    for v in adj[u]:
        if color[v] == WHITE: dfs(v)
    color[u] = BLACK; fin[u] = ++time
```

---

## Junior Questions (12 Q&A)

### J1. What is Depth-First Search?
DFS is a graph traversal that explores as deep as possible along each branch before backtracking. When it arrives at a vertex it picks an unexplored neighbour and dives in, continuing until it hits a dead end, then it backtracks to the most recent vertex that still has an unexplored neighbour. It runs in `O(V + E)` time on an adjacency list and `O(V)` space. It is the backbone of cycle detection, topological sort, connected components, and flood fill.

### J2. Why does DFS need a visited set?
A graph can contain cycles, so unlike a tree you cannot blindly recurse into neighbours — you would loop forever. The visited set (a boolean array indexed by vertex id, or the three-color scheme) records every vertex the first time DFS reaches it, so any later attempt to enter it returns immediately. This guard is what bounds the work to `O(V + E)`: every vertex is entered once and every edge is examined a constant number of times.

### J3. When do you mark a vertex visited?
On entry in the recursive form (the first line of the visit function), and on pop in the iterative form. The critical rule is **never on push** in the iterative version, because the same vertex can be pushed onto the stack several times before it is first popped. Marking on entry/pop guarantees each vertex is processed exactly once.

### J4. What is the difference between DFS and BFS?
DFS uses a stack (or recursion) and goes deep first, fully exploring one branch before moving to the next. BFS uses a queue and explores level by level, nearest vertices first. Both are `O(V + E)`. The key practical difference: BFS finds the shortest path in an unweighted graph (the first time it reaches a vertex is via a shortest path), while DFS does not. DFS naturally produces discovery/finish times that power topological sort and cycle detection.

### J5. Can DFS be written without recursion?
Yes — use an explicit stack. Push the start vertex, then loop: pop a vertex, skip it if already visited, mark it visited, process it, and push its unvisited neighbours. This is functionally equivalent to the recursive form but moves the stack from the call stack to the heap, which removes the stack-overflow ceiling on deep graphs.

### J6. What is preorder versus postorder in DFS?
Preorder means doing work *before* recursing into children — the moment of discovery, when you first arrive at a vertex. Postorder means doing work *after* all children are fully explored — the finish moment, as you back out. A single DFS gives you both. Postorder is special: reversing the postorder of a DAG yields a valid topological order.

### J7. How do you count connected components in an undirected graph with DFS?
Loop over every vertex. Each time you find an unvisited vertex, that is the start of a brand-new component, so increment a counter and run a full DFS from it to mark everything reachable. When the loop finishes, the counter is the number of components. This is `O(V + E)` because each vertex and edge is touched once across all the DFS calls.

### J8. What is flood fill and how does DFS implement it?
Flood fill treats each grid cell as a vertex with up to four (or eight) neighbours and fills a connected region of equal value — the paint-bucket tool, or the "number of islands" problem. DFS starts at a cell, recolours or marks it, then recurses into its in-bounds same-coloured neighbours. The visited check is implicit: once a cell is recoloured it no longer matches, so it is not revisited.

### J9. Does DFS find the shortest path?
No. DFS finds *a* path between two vertices if one exists, but not necessarily the shortest one, because it commits to a branch and goes deep rather than expanding outward by distance. For the shortest path in an unweighted graph use BFS; for weighted graphs use Dijkstra or Bellman-Ford.

### J10. What is the time and space complexity of DFS?
Time is `O(V + E)` with an adjacency list — every vertex is entered once and every edge inspected a constant number of times. With an adjacency matrix it is `O(V²)` because finding a vertex's neighbours means scanning a whole row. Space is `O(V)` for the visited array plus the stack, whose depth in the worst case (a long chain) equals the number of vertices.

### J11. Why might a recursive DFS crash, and how do you fix it?
On a deep graph — for example a chain of a million vertices — the recursion descends a million frames deep and overflows the call stack (`RecursionError` in Python, `StackOverflowError` in Java, a crash in Go). The fix is the explicit-stack iterative DFS, which stores the frontier on the heap and is bounded only by available memory. Python users sometimes raise `sys.setrecursionlimit`, but that only postpones the problem.

### J12. How do you check whether a path exists from A to B?
Run DFS from A and stop the moment you reach B; if DFS finishes without seeing B, no path exists. You do not need to explore the whole graph — return early. This is a single traversal, `O(V + E)`.

---

## Middle Questions (12 Q&A)

### M1. Explain discovery and finish times.
Run a global clock that ticks each time DFS enters or leaves a vertex. Stamp `disc[u]` when DFS first colours `u` gray, and `fin[u]` when it colours `u` black after all descendants are done. Every vertex gets an interval `[disc[u], fin[u]]`. These timestamps are the raw material for topological sort, ancestor queries, and the low-link algorithms behind strongly connected components and bridges.

### M2. State the Parenthesis Theorem.
For any two vertices `u` and `v`, their intervals `[disc[u], fin[u]]` and `[disc[v], fin[v]]` are either completely disjoint or one fully contains the other — they never partially overlap, exactly like balanced parentheses. Containment encodes ancestry: `u` is an ancestor of `v` in the DFS tree iff `disc[u] < disc[v] < fin[v] < fin[u]`. This lets you answer ancestor queries in `O(1)` after one DFS.

### M3. Name the four edge classes and how you tell them apart.
When DFS at `u` examines edge `(u, v)`, the class is decided by `v`'s color: WHITE means a **tree edge** (we discover `v`); GRAY means a **back edge** (`v` is an ancestor still on the stack — a cycle); BLACK with `disc[u] < disc[v]` means a **forward edge** (a descendant reached another way); BLACK with `disc[u] > disc[v]` means a **cross edge** (a different, earlier-finished subtree).

### M4. Which edge classes can an undirected graph have?
Only tree edges and back edges. Forward and cross edges cannot occur, because the first time DFS sees an undirected edge it is always a tree or back edge — the other direction is the same physical edge. The one subtlety is that the edge back to the immediate parent is a back edge in form but must be excluded from cycle detection.

### M5. How do you detect a cycle in a directed graph?
Use the three colors. A directed graph has a cycle if and only if DFS ever finds an edge into a GRAY vertex (a back edge), because GRAY means the vertex is still on the current recursion stack, so following the edge closes a loop. Marking a vertex BLACK only after all its descendants finish is what makes this correct.

### M6. How do you detect a cycle in an undirected graph?
Thread the parent vertex through the recursion. A cycle exists iff DFS reaches an already-visited vertex that is **not** the parent it just came from. Skipping only the parent (not all visited vertices) is essential: the parent's back-edge is the same edge you just traversed, not a cycle. If the graph can have parallel edges, track edge ids instead of the parent vertex.

### M7. Why does reversing the postorder of a DAG give a topological order?
For any edge `u → v` in a DAG, when DFS explores it `v` is either WHITE (so it finishes before `u`) or BLACK (already finished, again before `u`); it can never be GRAY because that would be a back edge, i.e. a cycle, which a DAG forbids. Therefore `fin[u] > fin[v]` for every edge. Sorting by decreasing finish time — reverse postorder — places every vertex before all vertices it points to.

### M8. How do you produce a postorder traversal iteratively?
Use a stack of `(vertex, child_index)` frames. Each iteration, look at the top frame: if it still has unvisited children, advance the index and push the next unvisited child; otherwise this vertex's subtree is exhausted, so record it (postorder) and pop. This mirrors the recursion's "do work after children" without the call stack. A simpler trick for some problems is to do a preorder-like traversal pushing results, then reverse — but the frame method is the general one.

### M9. What is the difference between "visited" and "on the recursion stack"?
"Visited" (BLACK or GRAY) means DFS has reached the vertex at least once. "On the recursion stack" (GRAY only) means DFS is currently inside that vertex's call — it has been discovered but not yet finished. The distinction is the heart of directed cycle detection: only an edge into a GRAY (on-stack) vertex is a cycle; an edge into a BLACK (finished) vertex is a forward or cross edge and is harmless.

### M10. How would you find all vertices reachable from a source?
Run a single DFS from the source and collect every vertex it marks visited. Those are exactly the reachable vertices. If the question is about a directed graph, reachability respects edge direction. This is the basis of impact analysis ("what depends on this?") and dead-code/garbage-collection reachability.

### M11. How do you detect a cycle and also report the actual cycle path?
Keep the current DFS stack (the chain of GRAY vertices). When you hit a back edge `(u, v)` where `v` is GRAY, the cycle is the slice of the stack from `v` up to `u`, plus the edge back to `v`. Many tools surface this to print a helpful "circular dependency: A → B → C → A" message instead of a bare "cycle detected."

### M12 (analysis). Why is iterative DFS sometimes preferred even when depth is fine?
Beyond avoiding stack overflow, the explicit stack gives you direct control: you can pause, resume, snapshot the frontier, bound memory, or interleave the traversal with other work. In a server handling untrusted input you cannot assume shallow graphs, so the iterative form is the safe default. The cost is more verbose code and the `(vertex, index)` frame bookkeeping when you need postorder.

---

## Senior Questions (10 Q&A)

### S1. Where does DFS show up disguised in real systems?
Dependency resolution (npm, Cargo, Maven, Bazel) needs topological order plus cycle detection — both DFS. Deadlock detection runs DFS cycle detection over a wait-for graph. Garbage collectors do a mark phase that is a DFS/BFS from roots, using an explicit mark stack precisely because object graphs are deep. Reachability and impact analysis ("what depends on this service?") are DFS over a dependency graph. Spreadsheet recalculation orders cells by a topological sort of their formula dependencies.

### S2. Why can't you trivially distribute or parallelize DFS?
DFS is inherently sequential: discovery and finish order depend on having fully explored a vertex before moving on, so the *ordering is the value*. You cannot shard the graph, DFS each piece, and stitch the orders together — the cross-shard edges break the parenthesis structure. Lexicographic DFS is in fact P-complete, meaning it is believed to have no efficient parallel algorithm. For parallelism people switch to BFS-style frontier expansion or to algorithms that tolerate any valid order (like Kahn's topological sort).

### S3. How do you DFS a graph that does not fit in RAM?
Convert recursion to an explicit stack so depth is heap-bounded, then treat the graph as external: store adjacency lists on disk or in a key-value store, keep only the visited bitset and the frontier in memory, and batch neighbour lookups to amortize I/O. If even the visited set is too large, use a compact bitset or a probabilistic structure, or partition the graph and process partitions with a semi-external traversal. Often a BFS-like, I/O-friendly traversal is chosen over strict DFS because DFS's deep, pointer-chasing access pattern is hostile to disk.

### S4. How do you DFS a graph that is being mutated concurrently?
DFS assumes a static graph; adding or removing an edge mid-traversal silently corrupts the discovery/finish invariants. The standard fix is to traverse a consistent snapshot: copy-on-write the adjacency structure, take a read lock for the duration, or use a versioned/MVCC view of the graph. For long traversals where a full snapshot is too expensive, you accept a "fuzzy" result and document that the traversal reflects the graph at some point during the scan, not a single instant.

### S5. How would you detect a deadlock in a database lock manager?
Build a wait-for graph with an edge `T1 → T2` whenever transaction `T1` is blocked waiting on a lock held by `T2`. A cycle in this directed graph is a deadlock. Run periodic DFS directed-cycle detection (color rule) over a consistent snapshot of the graph, and when a back edge is found, slice the cycle out of the current stack and choose a victim transaction to abort, breaking the cycle. Because the graph changes quickly, the snapshot and the cadence of the check both matter.

### S6. Recursive versus explicit-stack DFS: what are the real trade-offs?
Recursive DFS is shorter, reads clearly, and lets the language manage the stack — fine for small, shallow, trusted graphs. Explicit-stack DFS is overflow-proof, controllable (pause/resume/snapshot), and bounded only by heap, at the cost of verbosity and manual frame management for postorder. In production code handling unbounded or untrusted input, default to explicit-stack; reserve recursion for known-shallow inputs and readability-sensitive code.

### S7. How do DFS timestamps power the heavier graph algorithms?
Tarjan's strongly-connected-components algorithm runs a single DFS tracking a low-link value (the lowest discovery time reachable via tree and back edges); when a vertex's low-link equals its own discovery time it roots an SCC. Bridges and articulation points use the same low-link idea on undirected graphs. Kosaraju's SCC uses two DFS passes ordered by finish time. The common thread: all of these are *one* DFS plus `O(1)` bookkeeping per vertex/edge, preserving `O(V + E)`.

### S8. What observability would you add around a production DFS?
Emit the vertex and edge counts visited, the maximum stack depth reached (to catch near-overflow before it happens), the traversal wall-clock time, and, for cycle detection, the actual cycle path when one is found. Counters for "graphs with cycles rejected" and histograms of graph size and depth help you spot when input characteristics shift. For long traversals, a heartbeat with progress (visited / total) prevents a hung-looking job from being killed.

### S9. How do you give a useful error when a dependency cycle is detected?
Keep the current DFS stack of GRAY vertices. On the back edge into a GRAY vertex `v`, walk the stack back to `v` to reconstruct the exact cycle and render it as a path, e.g. `A → B → C → A`. Naming the participating nodes turns an opaque "circular dependency detected" into an actionable message a developer can fix. This is one of the clearest separators between a good tool and a frustrating one.

### S10 (analysis). When would you choose BFS over DFS at the system level?
Choose BFS when you need shortest paths or level-by-level processing in an unweighted graph, when the graph is deep but narrow (BFS keeps only a frontier, not a deep stack), when you want bounded memory on adversarial input, or when you need parallelism (frontier expansion parallelizes; DFS does not). Choose DFS for ordering and structural decomposition: topological sort, cycle detection, SCC, bridges, articulation points, and backtracking search.

---

## Professional Questions (8 Q&A)

### P1. Prove that DFS runs in O(V + E).
`DFS-VISIT` is called exactly once per vertex, because it is only called on WHITE vertices and immediately colours the vertex GRAY. Across all calls, the work inside is dominated by the loop over `Adj[u]`, which iterates `deg(u)` times. Summing over all vertices, the total loop work is `Σ deg(u) = 2|E|` for undirected (or `|E|` for directed). Adding the `O(V)` for the outer loop that finds WHITE start vertices gives `O(V + E)`.

### P2. Prove the White-Path Theorem.
The White-Path Theorem states that `v` is a descendant of `u` in the DFS tree iff, at the moment DFS discovers `u` (colours it GRAY), there is a path from `u` to `v` consisting entirely of WHITE vertices. Forward direction: if `v` is a descendant, the tree path from `u` to `v` is all WHITE at `u`'s discovery. Reverse: by induction on the white path's length, DFS will discover each vertex along it as a descendant of `u` before `u` finishes. This theorem is what justifies low-link reasoning in SCC and bridge algorithms.

### P3. Why is lexicographic DFS P-complete, and what does that imply?
Computing the DFS visit order when neighbours must be explored in a fixed (lexicographic) order is P-complete: it is in P, but it is among the "hardest" problems in P with respect to log-space reductions, meaning it is widely believed to have no efficient (NC) parallel algorithm. The practical implication is that you cannot expect to parallelize the exact DFS ordering; if you need parallelism you must relax the ordering requirement and use a different traversal or a problem-specific parallel algorithm.

### P4. How do you make DFS robust against adversarial input in a service?
Default to explicit-stack DFS so a deep graph cannot overflow the call stack. Cap the work: bound the number of vertices/edges visited and the time spent, returning a typed error if exceeded. Validate the graph size before traversing. Use a bitset for the visited set to bound memory. Avoid recursion entirely in request-handling paths. Treat "graph too large/deep" as an expected, handled condition rather than a crash.

### P5. How would you implement an incremental cycle check as edges are added?
Maintain a topological order (or a low-link structure) and, on each new edge `u → v`, check whether `v` can already reach `u`; if so the edge would create a cycle and is rejected. A naive check is a DFS from `v` looking for `u` per insertion. Production systems use incremental topological-ordering algorithms (e.g. Pearce–Kelly) that touch only the affected window of the order, amortizing the cost so a long sequence of edge insertions stays near-linear instead of `O(V + E)` per edge.

### P6. How does mark-and-sweep garbage collection relate to DFS?
The mark phase is a graph traversal from the GC roots over the object reference graph, marking every reachable object; the sweep phase reclaims the unmarked ones. It is conceptually DFS but uses an explicit mark stack (or pointer-reversal tricks like the Deutsch–Schorr–Waite algorithm) because object graphs are deep and a recursive mark would overflow. The visited set is the mark bit on each object. Tri-color marking (white/gray/black) — the same coloring as DFS — is the basis of concurrent and incremental collectors.

### P7. How do you snapshot a mutable graph for a consistent traversal?
Options in increasing cost: take a read lock for the traversal's duration (simple but blocks writers); use copy-on-write so the traversal reads an immutable version while writers fork a new one; or use an MVCC/versioned graph where the traversal pins a version number and reads only edges visible at that version. For very large graphs where copying is infeasible, persistent (functional) data structures share unchanged structure between versions, giving cheap snapshots at the cost of higher per-access constants.

### P8 (analysis). Why is DFS's memory access pattern often worse than BFS's in practice?
DFS chases a single deep path, so it jumps along pointer/edge references that scatter across memory, producing poor cache locality and, in external settings, random disk I/O. BFS expands a frontier level by level, which can be batched and processed more sequentially, giving better locality and I/O amortization. This is why large-scale or external graph processing frameworks favor BFS-style frontier expansion even for problems DFS could express, and why the in-memory DFS constant factor can be surprisingly high on huge graphs.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose DFS over BFS (or vice versa). What were the trade-offs?
Look for a structured story: the problem (e.g. detecting circular dependencies in a build graph), the alternatives (BFS, Kahn's algorithm, an off-the-shelf library), the criteria (need for a topological order, need to report the actual cycle path, input depth), and why DFS won. Strong answers mention the stack-overflow risk on deep input and how they handled it (explicit stack), plus what they measured.

### B2. Design a dependency resolver for a package manager.
The expected answer: model packages and version constraints as a directed graph, run DFS to detect cycles (rejecting with the named cycle path), and use reverse postorder to produce the install/build order. Discuss diamond dependencies, version conflict resolution, deep graphs (explicit stack), and caching the resolved order. Strong candidates call out that the cycle error message should name the actual offending path, not just say "cycle."

### B3. Design deadlock detection for a transaction system.
Build a wait-for graph (edge `T1 → T2` when `T1` waits on a lock held by `T2`), run periodic DFS directed-cycle detection over a consistent snapshot, and on detecting a cycle pick a victim to abort. Discuss how often to run the check (trade latency vs overhead), how to snapshot a fast-changing graph consistently, and how to choose the victim (youngest transaction, least work done, fewest locks held).

### B4. A junior engineer used recursion for DFS and production crashed. How do you coach them?
Explain that recursion depth equals the longest path DFS walks, so a deep or untrusted graph overflows the call stack — a crash, not a slow query. Walk them through converting to an explicit stack, marking visited on pop, and bounding the work. Frame it as a teaching moment about not trusting input depth and about choosing the iterative form as the production default. Avoid blame; pair on the fix and add a regression test with a deep chain.

### B5. Your topological sort sometimes returns a wrong order. How do you investigate?
First confirm the graph is actually a DAG — run cycle detection, because a topo order is undefined if a cycle exists; a back edge is the usual culprit. Then check that you reverse the postorder (a common bug is emitting postorder directly). Verify you DFS from every unvisited vertex, not just vertex 0, or disconnected parts get dropped. Add an invariant check that walks every edge `u → v` and asserts `u` precedes `v` in the output; log the first violating edge.

---

## Coding Challenges

### Challenge 1 — Number of Islands

Given a grid of `'1'` (land) and `'0'` (water), count the number of islands. An island is a maximal group of land cells connected horizontally or vertically. DFS each unvisited land cell, sinking the whole island so it is counted once.

#### Go
```go
package main

import "fmt"

func numIslands(grid [][]byte) int {
	if len(grid) == 0 {
		return 0
	}
	rows, cols := len(grid), len(grid[0])
	var sink func(r, c int)
	sink = func(r, c int) {
		if r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] != '1' {
			return
		}
		grid[r][c] = '0' // mark visited by sinking
		sink(r+1, c)
		sink(r-1, c)
		sink(r, c+1)
		sink(r, c-1)
	}
	count := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if grid[r][c] == '1' {
				count++
				sink(r, c)
			}
		}
	}
	return count
}

func main() {
	grid := [][]byte{
		{'1', '1', '0', '0'},
		{'1', '0', '0', '1'},
		{'0', '0', '1', '1'},
	}
	fmt.Println(numIslands(grid)) // 2
}
```

#### Java
```java
public class NumberOfIslands {
    static int rows, cols;

    static void sink(char[][] grid, int r, int c) {
        if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] != '1') return;
        grid[r][c] = '0';                 // mark visited
        sink(grid, r + 1, c);
        sink(grid, r - 1, c);
        sink(grid, r, c + 1);
        sink(grid, r, c - 1);
    }

    static int numIslands(char[][] grid) {
        if (grid.length == 0) return 0;
        rows = grid.length;
        cols = grid[0].length;
        int count = 0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (grid[r][c] == '1') {
                    count++;
                    sink(grid, r, c);
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        char[][] grid = {
            {'1', '1', '0', '0'},
            {'1', '0', '0', '1'},
            {'0', '0', '1', '1'},
        };
        System.out.println(numIslands(grid)); // 2
    }
}
```

#### Python
```python
def num_islands(grid):
    if not grid:
        return 0
    rows, cols = len(grid), len(grid[0])

    def sink(r, c):
        if r < 0 or r >= rows or c < 0 or c >= cols or grid[r][c] != "1":
            return
        grid[r][c] = "0"          # mark visited by sinking
        sink(r + 1, c)
        sink(r - 1, c)
        sink(r, c + 1)
        sink(r, c - 1)

    count = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1":
                count += 1
                sink(r, c)
    return count


if __name__ == "__main__":
    grid = [
        ["1", "1", "0", "0"],
        ["1", "0", "0", "1"],
        ["0", "0", "1", "1"],
    ]
    print(num_islands(grid))  # 2
```

**Complexity:** `O(rows · cols)` time, `O(rows · cols)` worst-case recursion depth (one long snake). For huge grids, convert to an explicit stack to avoid overflow.

---

### Challenge 2 — Detect Cycle in a Directed Graph

Return whether a directed graph contains a cycle, using the white/gray/black coloring. An edge into a GRAY vertex (one still on the recursion stack) is a back edge and proves a cycle.

#### Go
```go
package main

import "fmt"

const (
	white = 0
	gray  = 1
	black = 2
)

func hasCycle(adj [][]int) bool {
	color := make([]int, len(adj))
	var dfs func(u int) bool
	dfs = func(u int) bool {
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray {
				return true // back edge -> cycle
			}
			if color[v] == white && dfs(v) {
				return true
			}
		}
		color[u] = black
		return false
	}
	for u := range adj {
		if color[u] == white && dfs(u) {
			return true
		}
	}
	return false
}

func main() {
	acyclic := [][]int{{1, 2}, {3}, {3}, {4}, {}}
	cyclic := [][]int{{1}, {2}, {0}} // 0 -> 1 -> 2 -> 0
	fmt.Println(hasCycle(acyclic))   // false
	fmt.Println(hasCycle(cyclic))    // true
}
```

#### Java
```java
import java.util.*;

public class DirectedCycle {
    static final int WHITE = 0, GRAY = 1, BLACK = 2;
    static int[] color;
    static List<List<Integer>> adj;

    static boolean dfs(int u) {
        color[u] = GRAY;
        for (int v : adj.get(u)) {
            if (color[v] == GRAY) return true;            // back edge
            if (color[v] == WHITE && dfs(v)) return true;
        }
        color[u] = BLACK;
        return false;
    }

    static boolean hasCycle(List<List<Integer>> g) {
        adj = g;
        color = new int[g.size()];
        for (int u = 0; u < g.size(); u++) {
            if (color[u] == WHITE && dfs(u)) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        var acyclic = List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of());
        var cyclic = List.of(List.of(1), List.of(2), List.of(0));
        System.out.println(hasCycle(acyclic)); // false
        System.out.println(hasCycle(cyclic));  // true
    }
}
```

#### Python
```python
WHITE, GRAY, BLACK = 0, 1, 2


def has_cycle(adj):
    color = [WHITE] * len(adj)

    def dfs(u):
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:           # back edge -> cycle
                return True
            if color[v] == WHITE and dfs(v):
                return True
        color[u] = BLACK
        return False

    return any(color[u] == WHITE and dfs(u) for u in range(len(adj)))


if __name__ == "__main__":
    acyclic = [[1, 2], [3], [3], [4], []]
    cyclic = [[1], [2], [0]]   # 0 -> 1 -> 2 -> 0
    print(has_cycle(acyclic))  # False
    print(has_cycle(cyclic))   # True
```

**Complexity:** `O(V + E)` time, `O(V)` space. The key is marking BLACK only after all descendants finish, so GRAY precisely means "on the current stack."

---

### Challenge 3 — Clone Graph

Given a reference to a node in a connected undirected graph, return a deep copy. DFS the original, creating each clone on first visit and memoizing original → clone so shared neighbours are not duplicated.

#### Go
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
	cloned := map[*Node]*Node{}
	var dfs func(n *Node) *Node
	dfs = func(n *Node) *Node {
		if c, ok := cloned[n]; ok {
			return c // already cloned: stop recursion
		}
		copy := &Node{Val: n.Val}
		cloned[n] = copy // memoize before recursing into neighbours
		for _, nb := range n.Neighbors {
			copy.Neighbors = append(copy.Neighbors, dfs(nb))
		}
		return copy
	}
	return dfs(node)
}

func main() {
	a := &Node{Val: 1}
	b := &Node{Val: 2}
	a.Neighbors = []*Node{b}
	b.Neighbors = []*Node{a} // 1 <-> 2
	c := cloneGraph(a)
	fmt.Println(c.Val, c.Neighbors[0].Val, c != a) // 1 2 true
}
```

#### Java
```java
import java.util.*;

public class CloneGraph {
    static class Node {
        int val;
        List<Node> neighbors = new ArrayList<>();
        Node(int v) { val = v; }
    }

    static Map<Node, Node> cloned = new HashMap<>();

    static Node dfs(Node n) {
        if (n == null) return null;
        if (cloned.containsKey(n)) return cloned.get(n); // already cloned
        Node copy = new Node(n.val);
        cloned.put(n, copy);                             // memoize first
        for (Node nb : n.neighbors) {
            copy.neighbors.add(dfs(nb));
        }
        return copy;
    }

    public static void main(String[] args) {
        Node a = new Node(1), b = new Node(2);
        a.neighbors.add(b);
        b.neighbors.add(a); // 1 <-> 2
        Node c = dfs(a);
        System.out.println(c.val + " " + c.neighbors.get(0).val + " " + (c != a));
        // 1 2 true
    }
}
```

#### Python
```python
class Node:
    def __init__(self, val):
        self.val = val
        self.neighbors = []


def clone_graph(node):
    if node is None:
        return None
    cloned = {}

    def dfs(n):
        if n in cloned:
            return cloned[n]          # already cloned: stop
        copy = Node(n.val)
        cloned[n] = copy              # memoize before recursing
        for nb in n.neighbors:
            copy.neighbors.append(dfs(nb))
        return copy

    return dfs(node)


if __name__ == "__main__":
    a, b = Node(1), Node(2)
    a.neighbors.append(b)
    b.neighbors.append(a)  # 1 <-> 2
    c = clone_graph(a)
    print(c.val, c.neighbors[0].val, c is not a)  # 1 2 True
```

**Complexity:** `O(V + E)` time, `O(V)` space. Memoizing *before* recursing into neighbours is what prevents an infinite loop on the cycle `1 <-> 2`.

---

### Challenge 4 — Course Schedule (Can Finish?)

Given `numCourses` and prerequisite pairs `[a, b]` meaning "to take `a` you must first take `b`," decide whether all courses can be finished. This is exactly "is the prerequisite graph a DAG?" — directed cycle detection with the three colors.

#### Go
```go
package main

import "fmt"

func canFinish(numCourses int, prerequisites [][]int) bool {
	adj := make([][]int, numCourses)
	for _, p := range prerequisites {
		adj[p[1]] = append(adj[p[1]], p[0]) // b -> a (take b before a)
	}
	const white, gray, black = 0, 1, 2
	color := make([]int, numCourses)
	var dfs func(u int) bool
	dfs = func(u int) bool { // returns true if a cycle is found
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray || (color[v] == white && dfs(v)) {
				return true
			}
		}
		color[u] = black
		return false
	}
	for u := 0; u < numCourses; u++ {
		if color[u] == white && dfs(u) {
			return false // cycle -> cannot finish
		}
	}
	return true
}

func main() {
	fmt.Println(canFinish(2, [][]int{{1, 0}}))           // true
	fmt.Println(canFinish(2, [][]int{{1, 0}, {0, 1}}))   // false
}
```

#### Java
```java
import java.util.*;

public class CourseSchedule {
    public static boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
        for (int[] p : prerequisites) adj.get(p[1]).add(p[0]); // b -> a

        int[] color = new int[numCourses]; // 0 white, 1 gray, 2 black
        for (int u = 0; u < numCourses; u++) {
            if (color[u] == 0 && hasCycle(u, adj, color)) return false;
        }
        return true;
    }

    static boolean hasCycle(int u, List<List<Integer>> adj, int[] color) {
        color[u] = 1; // gray
        for (int v : adj.get(u)) {
            if (color[v] == 1 || (color[v] == 0 && hasCycle(v, adj, color))) return true;
        }
        color[u] = 2; // black
        return false;
    }

    public static void main(String[] args) {
        System.out.println(canFinish(2, new int[][]{{1, 0}}));            // true
        System.out.println(canFinish(2, new int[][]{{1, 0}, {0, 1}}));    // false
    }
}
```

#### Python
```python
def can_finish(num_courses, prerequisites):
    adj = [[] for _ in range(num_courses)]
    for a, b in prerequisites:
        adj[b].append(a)               # take b before a

    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * num_courses

    def dfs(u):                        # True if a cycle is found
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY or (color[v] == WHITE and dfs(v)):
                return True
        color[u] = BLACK
        return False

    return not any(color[u] == WHITE and dfs(u) for u in range(num_courses))


if __name__ == "__main__":
    print(can_finish(2, [[1, 0]]))          # True
    print(can_finish(2, [[1, 0], [0, 1]]))  # False
```

**Complexity:** `O(V + E)` time, `O(V)` space. "Can finish" is true iff the prerequisite graph has no cycle.

---

## Common Pitfalls

1. **Forgetting the visited set** — guarantees an infinite loop on any cyclic graph.
2. **Marking visited too late** (after the neighbour loop) — a vertex can be entered twice before being marked, breaking correctness.
3. **Checking visited on push instead of on pop** in iterative DFS — leads to duplicate processing and inflated stacks.
4. **Ignoring the parent edge** in undirected cycle detection — reports a cycle on every single edge.
5. **Using "visited" where you needed "on the stack"** in directed cycle detection — a BLACK (finished) vertex is not a cycle; only GRAY is.
6. **Memoizing the clone *after* recursing** in clone-graph — infinite recursion on a cycle. Memoize before.
7. **Assuming DFS finds the shortest path** — it does not; use BFS for unweighted shortest paths.
8. **Only DFS-ing from vertex 0** on a possibly-disconnected graph — whole components get missed.
9. **Emitting postorder directly as a topo order** — you must reverse it.
10. **Recursing on deep or untrusted graphs** — stack overflow; use the explicit stack.

---

## What Interviewers Are Really Testing

- **Do you reach for the visited set automatically?** Forgetting it on a cyclic graph is the single most common DFS bug, and interviewers watch for whether you guard before recursing.
- **Do you know the recursion-vs-explicit-stack trade-off?** Bringing up stack overflow on deep graphs — unprompted — signals production maturity.
- **Can you distinguish directed from undirected cycle detection?** The parent rule versus the color rule is a clean separator between memorization and understanding.
- **Do you understand discovery/finish times and postorder?** Deriving topological sort as reverse postorder, rather than reciting Kahn's algorithm, shows you grasp *why* it works.
- **Can you generalize one pattern across problems?** Islands, flood fill, connected components, clone graph, and course schedule are all the same DFS skeleton with a different "process" hook. Interviewers love candidates who see the shared structure instead of treating each as a new problem.
- **Do you handle the disconnected case and empty input?** Looping over all vertices and guarding `V = 0` are small touches that distinguish careful candidates.
