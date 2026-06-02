# Breadth-First Search — Interview Preparation

Breadth-First Search is the single most frequently tested graph algorithm in coding interviews. It is short enough to write on a whiteboard in two minutes, yet it powers a huge family of disguised problems: shortest path in a maze, rotting oranges, word ladder, nearest exit, bipartite checking, level-order traversal, and "fewest steps to reach a goal." The candidates who shine are the ones who recognize *when* a problem is secretly a shortest-path-on-an-unweighted-graph question, and who get the two invariants right: a FIFO queue and an enqueue-time visited mark. This file is a curated question bank sorted by seniority, plus behavioral prompts and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Detail |
|------|--------|
| Data structures | FIFO queue + visited (or `dist`) array |
| Visited rule | Mark **on enqueue**, never on dequeue |
| Time (adjacency list) | `O(V + E)` |
| Time (grid `n×m`) | `O(n·m)` — four neighbors per cell |
| Time (adjacency matrix) | `O(V²)` — full row scan per vertex |
| Space | `O(V)` queue + `O(V)` visited |
| Shortest path | Yes — **unweighted graphs only** |
| Distance update | `dist[v] = dist[u] + 1` at discovery |
| Path rebuild | Store `parent[v] = u`, walk back, reverse |
| Multi-source | Seed the queue with all sources at dist 0 |
| Grid neighbors | `(-1,0),(1,0),(0,-1),(0,1)` (+ 4 diagonals if allowed) |
| Wrong tool for | Weighted paths → Dijkstra; 0/1 weights → 0-1 BFS; cycles/topo/SCC → DFS |

Pseudocode to memorize:

```text
visited[src] = true
q = [src]
while q not empty:
    u = q.popfront()
    for v in adj[u]:
        if not visited[v]:
            visited[v] = true
            dist[v]    = dist[u] + 1
            q.pushback(v)
```

---

## Junior Questions (12 Q&A)

### J1. What is Breadth-First Search?
BFS is a graph traversal that explores vertices in order of increasing distance from a source. It visits the source, then all of its neighbors (distance 1), then all of their neighbors (distance 2), and so on — expanding outward in concentric rings. It uses a FIFO queue to hold discovered-but-not-yet-expanded nodes and a visited set so each node is processed once. It runs in `O(V + E)` time.

### J2. Why does BFS use a queue and not a stack?
The queue's first-in-first-out order is what guarantees nodes leave it in order of increasing distance. A node discovered earlier (closer to the source) is dequeued before any node discovered later (farther). Swap the queue for a LIFO stack and you get Depth-First Search instead, which dives deep before exploring breadth and loses the shortest-path guarantee entirely.

### J3. What problem does BFS solve that DFS does not?
BFS finds the **shortest path** (fewest edges) from the source to every reachable vertex in an **unweighted** graph. The first time BFS reaches a vertex, it has reached it by a path with the minimum number of edges. DFS reaches vertices in no particular distance order, so it cannot answer "fewest steps" questions correctly.

### J4. What is the time and space complexity of BFS?
Time is `O(V + E)` on an adjacency list: each vertex is dequeued once and each edge is scanned once (twice in an undirected graph, once from each endpoint). On a grid it is `O(n·m)`. Space is `O(V)` — the queue can, in the worst case, hold an entire level of the graph, and the visited array is one flag per vertex.

### J5. Why must you mark a node visited when you enqueue it, not when you dequeue it?
If you mark on dequeue, the same node can be enqueued by several different neighbors before it is processed. That bloats the queue (up to `O(E)` entries), can produce wrong distances, and risks processing a node multiple times. Marking on enqueue guarantees each vertex enters the queue exactly once. This is the single most important BFS invariant.

### J6. How do you compute the distance from the source to every node?
Keep a `dist` array initialized to `-1` (which also serves as the "unvisited" marker). Set `dist[src] = 0`. When you discover a neighbor `v` from `u`, set `dist[v] = dist[u] + 1` and enqueue it. Because the queue is FIFO, distances are assigned in non-decreasing order and each is final and shortest.

### J7. How is a grid a graph?
Each cell `(r, c)` is a vertex. Its neighbors are the in-bounds, walkable cells in the four cardinal directions (sometimes eight, including diagonals). The "edges" are computed on the fly rather than stored — this is called an *implicit graph*. Everything else about BFS (queue, visited, distance layers) is identical.

### J8. What does it mean for a graph to be unweighted, and why does BFS require it?
Unweighted means every edge counts the same — one step. BFS counts edges, so its shortest path is the path with the fewest edges. If edges had different costs (weights), a path with more edges could be cheaper, and BFS's distance order would no longer match cost order. For weighted graphs you use Dijkstra.

### J9. How do you reconstruct the actual shortest path, not just its length?
Store a `parent` array: when you discover `v` from `u`, set `parent[v] = u`. After BFS, start at the target and follow `parent` pointers back to the source, then reverse the list. Always check the target is reachable (`dist[target] != -1`) before walking back.

### J10. What happens to unreachable nodes?
They are never enqueued, so their `dist` stays `-1` (or `∞`) and they never appear in the BFS tree. This is correct behavior, not a bug. In a disconnected graph, a single BFS only covers the source's connected component.

### J11. What is multi-source BFS?
Instead of seeding the queue with one source, you seed it with **all** sources at distance 0 before the loop starts. Each vertex then ends up labeled with its distance to the *nearest* source. It is the same loop with a different initialization, and it solves problems like rotting oranges and "distance to nearest gate."

### J12. Which standard library types do you use for the queue?
- Python: `collections.deque` (`popleft()` is `O(1)`; never use `list.pop(0)` which is `O(n)`).
- Java: `ArrayDeque` via `add`/`poll`.
- Go: a slice with a head index, or a slice you re-slice (`queue = queue[1:]`) for small inputs.

---

## Middle Questions (12 Q&A)

### M1. Prove informally why BFS finds the shortest path.
Two invariants hold throughout. First, the queue is distance-monotone: the distances of queued nodes are non-decreasing and span at most two consecutive values. Second, when `v` is first discovered from `u`, `dist[v] = dist[u] + 1`. Since `u` was dequeued at its true distance, and a shorter path to `v` would have had its penultimate node dequeued earlier (discovering `v` sooner), `dist[v]` is exactly the true shortest distance.

### M2. When does the shortest-path guarantee break?
The instant edges carry different weights. The monotone-queue invariant assumes every edge adds exactly 1 to the distance. With weights, a longer-in-edges path can be shorter-in-weight, so FIFO order stops matching cost order. Use Dijkstra for non-negative weights, or 0-1 BFS when weights are only 0 or 1.

### M3. How do you check if a graph is bipartite using BFS?
2-color the graph layer by layer. Color the source 0, its neighbors 1, theirs 0, alternating. If you ever try to give a vertex the same color as an already-colored neighbor, there is an odd-length cycle and the graph is not bipartite. Loop over all vertices to cover disconnected components.

### M4. What is the "process one ring at a time" pattern and when do you need it?
Snapshot the current queue size with `for _ in range(len(q))` and dequeue exactly that many nodes — one full level — before incrementing a counter. You need it when the problem asks about levels or "minutes," such as rotting oranges (one minute per ring) or binary-tree level-order traversal. The alternative is carrying `(node, dist)` pairs in the queue.

### M5. How does BFS work on an implicit state graph like word ladder?
The nodes are *states* (e.g. words) and the edges are *legal moves* (change one letter to form another valid word). You never materialize an adjacency list; you generate neighbors on demand. The visited set is keyed by the encoded state (a string, tuple, or integer). BFS then finds the fewest moves to a goal state.

### M6. Directed vs undirected: how does it change your BFS?
Only how you build the adjacency list. Undirected: store each edge twice (`adj[u]` has `v` and `adj[v]` has `u`). Directed: store each edge once and follow out-edges only. To answer "who can reach `t`?" in a directed graph, run BFS on the reversed graph.

### M7. Why is `list.pop(0)` a bug in Python BFS?
`list.pop(0)` shifts every remaining element left, costing `O(n)` per call and turning BFS into `O(V·E)` or worse. `collections.deque.popleft()` is `O(1)`. This is a classic performance trap that can make an otherwise correct solution time out.

### M8. How do you find connected components with BFS?
Loop over every vertex. Whenever you find an unvisited one, run a BFS from it and label every vertex it reaches as belonging to the same component. The total work across all components is still `O(V + E)` because each vertex and edge is touched once overall.

### M9. How would you find the shortest cycle through a given node, or detect a cycle?
For an undirected graph, run BFS and watch for an edge to an already-visited vertex that is not the parent — that closes a cycle. The shortest cycle length through a node can be found by BFS from that node, tracking when two search fronts meet. (Detailed cycle classification is a DFS strength; BFS handles the "fewest edges" variants.)

### M10. What is the difference between BFS distance on a grid with 4 vs 8 directions?
With 4 directions (up/down/left/right) the distance is the Manhattan-style step count. With 8 directions (including diagonals) you add the four diagonal offsets to your direction list; diagonal moves still cost 1 step each, so BFS remains valid and gives the Chebyshev-style step count. The shortest-path-in-binary-matrix problem uses 8 directions.

### M11. How do you handle a very large or infinite state space?
Bound the search: cap the depth, detect the goal early, and prune impossible states before enqueuing them. Encode states compactly (an integer bitmask beats a list) to keep the visited set small. Without bounds, an implicit BFS over an infinite space never terminates.

### M12 (analysis). Why is multi-source BFS still `O(V + E)` and not `k · O(V + E)` for `k` sources?
Because it is a single traversal. Seeding `k` sources is equivalent to adding a virtual super-source connected to all `k` real sources by equal-length edges; the FIFO invariant still holds, and each vertex and edge is still processed exactly once. Running `k` separate BFS passes would be `k` times the work; the multi-source trick avoids that.

---

## Senior Questions (10 Q&A)

### S1. How does BFS behave when the graph does not fit in RAM?
Every neighbor lookup may become a disk seek or an RPC, so naive BFS can incur `O(V + E)` random I/Os — catastrophic at web scale. You move to external-memory BFS (Munagala–Ranade, Mehlhorn–Meyer) that processes levels by sorting and deduplicating neighbor sets, or to a distributed batch system (Pregel/Giraph/Spark GraphX). The frontier may also be spilled to disk when a level exceeds memory.

### S2. What is the defining failure mode of BFS at scale?
OOM on a wide frontier. A single level can hold `O(V)` nodes — a hub vertex with tens of millions of neighbors makes one level tens of millions of entries. Mitigations: bound the depth (most product queries need ≤ 3 hops), use direction-optimizing (bottom-up) BFS, go bidirectional, or spill the frontier to disk.

### S3. Explain bidirectional BFS and when it wins.
Run BFS from both the source and the target simultaneously, alternating, and stop when the two frontiers meet. If the branching factor is `b` and the distance is `d`, unidirectional BFS touches ~`b^d` nodes while bidirectional touches ~`2·b^(d/2)` — an exponential saving. It is the workhorse for point-to-point distance queries like degrees of separation, but it only works when you know both endpoints.

### S4. What is direction-optimizing (Beamer) BFS?
Standard top-down BFS scans every edge out of the frontier, wasting work when most neighbors are already visited. Bottom-up BFS instead has each *unvisited* vertex scan for *any* neighbor in the frontier and stop at the first hit. You switch to bottom-up when the frontier is large (mid-search on a small-world graph) and back to top-down when it shrinks. This yields 2–4× speedups on social/web graphs and underlies the Graph500 benchmark.

### S5. How do you parallelize BFS correctly?
Use level-synchronous BFS: all workers expand the current frontier in parallel, synchronize at a barrier, then swap to the next frontier. Represent visited as an atomic bitset and claim each vertex with a compare-and-swap — only the thread that flips the bit from 0→1 expands that vertex. Each thread keeps a local next-frontier buffer to avoid contention on a shared queue.

### S6. What is the cost of the per-level barrier, and which graphs suffer?
Every level-synchronous method pays one barrier (or one superstep / one I/O pass) per BFS level. The number of levels equals the eccentricity of the source, bounded by the diameter. Small-world graphs (social, web — diameter ~15–25 even at billions of nodes) have few levels and parallelize superbly. Long chains or road networks (diameter ~`√V`) have many levels and an inherent `Ω(diam)` depth lower bound, making them hard to parallelize.

### S7. How does a web crawler relate to BFS?
A crawler is BFS over the hyperlink graph. The frontier is the URL queue (often a durable Kafka topic or sharded priority queue), and the visited set is a dedup store — typically a Bloom filter (memory-cheap, false positives merely skip a few real pages) backed by a persistent KV store. BFS order crawls important, close-to-seed pages first. Politeness rate-limits reshuffle strict BFS order.

### S8. How do you size the visited set for a billion-vertex graph?
A boolean array is ~1 GB for `V = 10^9`; a hash set is many GB. Use a bitset (1 bit/vertex → ~125 MB) or a Bloom filter accepting bounded false positives. The bitset is also cache-friendlier, which matters because BFS is cache-miss-bound: each adjacency jump can miss.

### S9. Which metric best tells you a long-running BFS is healthy?
Frontier size over time. It should rise, peak near the graph's "middle" levels, then fall to zero. A frontier stuck at a high plateau signals a hot region, a missing visited check, or a degenerate graph. Also track current level (versus known diameter), visited count (coverage), and edges scanned (work, with the ratio to visited revealing revisits).

### S10 (analysis). Why is non-determinism a concern in distributed BFS?
Different partitionings or message orderings can produce different `parent` trees, even though the `dist` values are invariant. If downstream code depends on a specific BFS tree (e.g. a canonical shortest path), you must pin a deterministic tie-break such as "smallest vertex id wins." Otherwise reruns give different but equally-correct trees.

---

## Professional Questions (8 Q&A)

### P1. When is reaching for distributed BFS over-engineering?
When the graph fits in RAM. A 50M-edge graph fits in ~8 GB and an in-process BFS answers in ~200 ms; launching Spark GraphX for it adds minutes of job overhead for nothing. The crossover to distributed/external-memory BFS is when the CSR graph exceeds available RAM, when you need full-graph BFS regularly under a tight SLA, or when the graph is already sharded across services.

### P2. How do you express BFS in the Pregel "think like a vertex" model?
Each vertex starts inactive except the source. In each superstep, active vertices send `level + 1` to their neighbors; a vertex that receives a smaller level than it holds updates and activates. The computation halts when no vertex is active (votes-to-halt). This is level-synchronous BFS with the visited set replaced by per-vertex state, and it scales to trillion-edge graphs because only messages cross the network.

### P3. How do stragglers hurt parallel BFS and how do you fix them?
In level-synchronous BFS, the slowest worker gates every level. A skewed partition — one worker owning a hub vertex — stalls the whole job at each barrier. Fix by partitioning on *edge* count rather than vertex count, and by work-stealing within a level so idle workers help the overloaded one.

### P4. How would you serve "2nd/3rd degree connections" at LinkedIn scale?
Bounded-depth BFS (depth ≤ 3) from the viewing user against a sharded social graph, heavily cached. The depth bound is what makes it tractable — the full frontier would be the whole network, but depth-3 from one user is a manageable neighborhood. Per-user neighborhoods change slowly, so the cache, not the algorithm, dominates the architecture.

### P5. A teammate "fixes" wrong shortest paths by re-enqueuing visited nodes. What do you say?
That is the signal they have outgrown BFS. BFS counts edges, not weights; re-enqueuing visited nodes breaks the `O(V + E)` bound and still may not give correct weighted distances. The correct fix is switching algorithms: Dijkstra for non-negative weights, 0-1 BFS for 0/1 weights, Bellman–Ford if negative edges exist.

### P6. How do you handle crawler traps and infinite URL spaces?
Auto-generated spaces (calendars, session-id links) make the frontier never empty. Mitigations: depth caps, URL canonicalization (so `?a=1&b=2` and `?b=2&a=1` dedup), per-domain budgets, and trap-detection heuristics that flag suspiciously deep or repetitive URL patterns.

### P7. How do you precompute vs compute BFS at query time?
If many queries share a source (single-source distances to everyone), run BFS once and store the distance array. If sources vary per query, run bounded bidirectional BFS at query time. The crossover is "queries per source" — high reuse favors precompute, high source variety favors query-time.

### P8 (analysis). Estimate the memory and time for in-RAM BFS on `V = 100M`, `E = 2B`.
Memory: CSR adjacency ≈ 8–16 GB (the dominant term), visited bitset ≈ 12.5 MB, dist array ≈ 400 MB, peak frontier up to ~400 MB. Time: a single core scans ~100M–500M edges/sec (cache-bound), so `E = 2B` is ~4–20 s single-threaded, and multi-core frontier BFS scales near-linearly on a low-diameter graph until memory bandwidth saturates. This fits on one fat machine — which is why in-process BFS handles surprisingly large graphs before you need a cluster.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you recognized a problem was secretly a BFS.
Strong answers describe spotting "fewest steps / nearest / minimum moves on equal-cost transitions" phrasing, reframing the problem as an unweighted graph (often an implicit state graph), and confirming the equal-weight assumption before committing to BFS over Dijkstra.

### B2. Design a "people you may know" feature.
Bounded-depth BFS (depth 2–3) over the friendship graph from each user, cached per user, refreshed on a slow cadence. Discuss the frontier explosion on celebrity nodes, depth bounding, and why the cache dominates. Mention bidirectional BFS for pairwise "how are we connected" queries.

### B3. Design a maze/route solver for a game with millions of tiles.
Grid BFS (or multi-source BFS from all exits) precomputed into a distance field so per-agent lookups are `O(1)`. Discuss 4 vs 8 directions, memory of the distance grid, and recomputation when the map changes. Escalate to Dijkstra/A* if tiles have different traversal costs.

### B4. A junior asks "why not always use Dijkstra since it's more general?"
Explain that BFS is the `w ≡ 1` special case of Dijkstra: when all weights are equal, the priority queue's order coincides with FIFO order, so the `log` factor is wasted. BFS is simpler, faster by a constant factor, and harder to get wrong. Use the simplest correct tool.

### B5. Your crawler's frontier queue keeps growing and never drains. How do you investigate?
Check the frontier-size metric trend, look for a missing or broken dedup (visited) check causing re-enqueues, inspect for crawler traps generating infinite URLs, and verify depth caps and per-domain budgets are enforced. Confirm the Bloom filter's false-positive rate is sane and the persistent visited store is actually being consulted.

---

## Coding Challenges

### Challenge 1: Shortest Path in a Binary Matrix (8-directional grid BFS)

Given an `n×n` grid of 0s (open) and 1s (blocked), return the length of the shortest clear path from top-left to bottom-right, moving in 8 directions, where path length is the number of cells visited. Return `-1` if no path exists.

#### Go
```go
package main

import "fmt"

func shortestPathBinaryMatrix(grid [][]int) int {
	n := len(grid)
	if grid[0][0] == 1 || grid[n-1][n-1] == 1 {
		return -1
	}
	dist := make([][]int, n)
	for i := range dist {
		dist[i] = make([]int, n)
	}
	dist[0][0] = 1 // path length counts cells, so start is 1
	type cell struct{ r, c int }
	q := []cell{{0, 0}}
	dirs := [8][2]int{{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		if cur.r == n-1 && cur.c == n-1 {
			return dist[cur.r][cur.c]
		}
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < n &&
				grid[nr][nc] == 0 && dist[nr][nc] == 0 {
				dist[nr][nc] = dist[cur.r][cur.c] + 1
				q = append(q, cell{nr, nc})
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{{0, 0, 0}, {1, 1, 0}, {1, 1, 0}}
	fmt.Println(shortestPathBinaryMatrix(grid)) // 4
}
```

#### Java
```java
import java.util.*;

public class ShortestBinaryMatrix {
    public static int shortestPathBinaryMatrix(int[][] grid) {
        int n = grid.length;
        if (grid[0][0] == 1 || grid[n - 1][n - 1] == 1) return -1;
        int[][] dist = new int[n][n];
        dist[0][0] = 1;
        Deque<int[]> q = new ArrayDeque<>();
        q.add(new int[]{0, 0});
        int[][] dirs = {{-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int r = cur[0], c = cur[1];
            if (r == n - 1 && c == n - 1) return dist[r][c];
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n
                        && grid[nr][nc] == 0 && dist[nr][nc] == 0) {
                    dist[nr][nc] = dist[r][c] + 1;
                    q.add(new int[]{nr, nc});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 0, 0}, {1, 1, 0}, {1, 1, 0}};
        System.out.println(shortestPathBinaryMatrix(grid)); // 4
    }
}
```

#### Python
```python
from collections import deque


def shortest_path_binary_matrix(grid):
    n = len(grid)
    if grid[0][0] == 1 or grid[n - 1][n - 1] == 1:
        return -1
    dist = [[0] * n for _ in range(n)]
    dist[0][0] = 1  # path length counts cells
    q = deque([(0, 0)])
    dirs = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    while q:
        r, c = q.popleft()
        if r == n - 1 and c == n - 1:
            return dist[r][c]
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0 and dist[nr][nc] == 0:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return -1


if __name__ == "__main__":
    print(shortest_path_binary_matrix([[0, 0, 0], [1, 1, 0], [1, 1, 0]]))  # 4
```

**Key insight:** here `dist == 0` doubles as "unvisited," and path length counts *cells* (so the source is 1, not 0). Eight directions means eight offsets.

---

### Challenge 2: Rotting Oranges (multi-source BFS)

Grid cells: `0` empty, `1` fresh orange, `2` rotten. Each minute, every rotten orange rots its 4-adjacent fresh neighbors. Return the minutes until no fresh orange remains, or `-1` if impossible.

#### Go
```go
package main

import "fmt"

func orangesRotting(grid [][]int) int {
	n, m := len(grid), len(grid[0])
	type cell struct{ r, c int }
	var q []cell
	fresh := 0
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			if grid[r][c] == 2 {
				q = append(q, cell{r, c}) // every rotten cell is a source
			} else if grid[r][c] == 1 {
				fresh++
			}
		}
	}
	if fresh == 0 {
		return 0
	}
	dirs := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	minutes := 0
	for len(q) > 0 && fresh > 0 {
		minutes++
		var next []cell
		for _, cur := range q { // one full ring = one minute
			for _, d := range dirs {
				nr, nc := cur.r+d[0], cur.c+d[1]
				if nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1 {
					grid[nr][nc] = 2
					fresh--
					next = append(next, cell{nr, nc})
				}
			}
		}
		q = next
	}
	if fresh > 0 {
		return -1
	}
	return minutes
}

func main() {
	fmt.Println(orangesRotting([][]int{{2, 1, 1}, {1, 1, 0}, {0, 1, 1}})) // 4
}
```

#### Java
```java
import java.util.*;

public class RottingOranges {
    public static int orangesRotting(int[][] grid) {
        int n = grid.length, m = grid[0].length;
        Deque<int[]> q = new ArrayDeque<>();
        int fresh = 0;
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++) {
                if (grid[r][c] == 2) q.add(new int[]{r, c});
                else if (grid[r][c] == 1) fresh++;
            }
        if (fresh == 0) return 0;
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        int minutes = 0;
        while (!q.isEmpty() && fresh > 0) {
            minutes++;
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                int[] cur = q.poll();
                for (int[] d : dirs) {
                    int nr = cur[0] + d[0], nc = cur[1] + d[1];
                    if (nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1) {
                        grid[nr][nc] = 2;
                        fresh--;
                        q.add(new int[]{nr, nc});
                    }
                }
            }
        }
        return fresh > 0 ? -1 : minutes;
    }

    public static void main(String[] args) {
        int[][] grid = {{2, 1, 1}, {1, 1, 0}, {0, 1, 1}};
        System.out.println(orangesRotting(grid)); // 4
    }
}
```

#### Python
```python
from collections import deque


def oranges_rotting(grid):
    n, m = len(grid), len(grid[0])
    q = deque()
    fresh = 0
    for r in range(n):
        for c in range(m):
            if grid[r][c] == 2:
                q.append((r, c))
            elif grid[r][c] == 1:
                fresh += 1
    if fresh == 0:
        return 0
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    minutes = 0
    while q and fresh > 0:
        minutes += 1
        for _ in range(len(q)):       # one ring = one minute
            r, c = q.popleft()
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < n and 0 <= nc < m and grid[nr][nc] == 1:
                    grid[nr][nc] = 2
                    fresh -= 1
                    q.append((nr, nc))
    return -1 if fresh > 0 else minutes


if __name__ == "__main__":
    print(oranges_rotting([[2, 1, 1], [1, 1, 0], [0, 1, 1]]))  # 4
```

**Key insight:** seed *all* rotten oranges before the loop, process one ring per minute, and track the fresh count to detect the impossible case.

---

### Challenge 3: Word Ladder (BFS on an implicit state graph)

Given `begin`, `end`, and a word list, return the number of words in the shortest transformation sequence from `begin` to `end`, changing one letter at a time, where every intermediate word is in the list. Return 0 if impossible.

#### Go
```go
package main

import "fmt"

func ladderLength(begin, end string, wordList []string) int {
	words := make(map[string]bool)
	for _, w := range wordList {
		words[w] = true
	}
	if !words[end] {
		return 0
	}
	type item struct {
		word string
		dist int
	}
	q := []item{{begin, 1}}
	seen := map[string]bool{begin: true}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		if cur.word == end {
			return cur.dist
		}
		b := []byte(cur.word)
		for i := 0; i < len(b); i++ {
			orig := b[i]
			for ch := byte('a'); ch <= 'z'; ch++ {
				b[i] = ch
				cand := string(b)
				if words[cand] && !seen[cand] {
					seen[cand] = true
					q = append(q, item{cand, cur.dist + 1})
				}
			}
			b[i] = orig
		}
	}
	return 0
}

func main() {
	fmt.Println(ladderLength("hit", "cog",
		[]string{"hot", "dot", "dog", "lot", "log", "cog"})) // 5
}
```

#### Java
```java
import java.util.*;

public class WordLadder {
    public static int ladderLength(String begin, String end, List<String> wordList) {
        Set<String> words = new HashSet<>(wordList);
        if (!words.contains(end)) return 0;
        Deque<String> q = new ArrayDeque<>();
        q.add(begin);
        Set<String> seen = new HashSet<>(List.of(begin));
        int dist = 1;
        while (!q.isEmpty()) {
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                String word = q.poll();
                if (word.equals(end)) return dist;
                char[] chars = word.toCharArray();
                for (int j = 0; j < chars.length; j++) {
                    char orig = chars[j];
                    for (char ch = 'a'; ch <= 'z'; ch++) {
                        chars[j] = ch;
                        String cand = new String(chars);
                        if (words.contains(cand) && seen.add(cand)) q.add(cand);
                    }
                    chars[j] = orig;
                }
            }
            dist++;
        }
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(ladderLength("hit", "cog",
            List.of("hot", "dot", "dog", "lot", "log", "cog"))); // 5
    }
}
```

#### Python
```python
from collections import deque
from string import ascii_lowercase


def ladder_length(begin, end, word_list):
    words = set(word_list)
    if end not in words:
        return 0
    q = deque([(begin, 1)])
    seen = {begin}
    while q:
        word, dist = q.popleft()
        if word == end:
            return dist
        for i in range(len(word)):
            for ch in ascii_lowercase:
                cand = word[:i] + ch + word[i + 1:]
                if cand in words and cand not in seen:
                    seen.add(cand)
                    q.append((cand, dist + 1))
    return 0


if __name__ == "__main__":
    print(ladder_length("hit", "cog",
                        ["hot", "dot", "dog", "lot", "log", "cog"]))  # 5
```

**Key insight:** the graph is never materialized — each word's neighbors are generated by trying every single-letter substitution. The visited set is keyed by the word string.

---

### Challenge 4: Bipartite Check (BFS 2-coloring)

Given an undirected graph as an adjacency list, return whether it is bipartite (2-colorable with no edge inside a color class). Handle disconnected graphs.

#### Go
```go
package main

import "fmt"

func isBipartite(adj [][]int) bool {
	n := len(adj)
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	for s := 0; s < n; s++ {
		if color[s] != -1 {
			continue
		}
		color[s] = 0
		q := []int{s}
		for len(q) > 0 {
			u := q[0]
			q = q[1:]
			for _, v := range adj[u] {
				if color[v] == -1 {
					color[v] = color[u] ^ 1
					q = append(q, v)
				} else if color[v] == color[u] {
					return false
				}
			}
		}
	}
	return true
}

func main() {
	fmt.Println(isBipartite([][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}})) // true
}
```

#### Java
```java
import java.util.*;

public class Bipartite {
    public static boolean isBipartite(List<List<Integer>> adj) {
        int n = adj.size();
        int[] color = new int[n];
        Arrays.fill(color, -1);
        for (int s = 0; s < n; s++) {
            if (color[s] != -1) continue;
            color[s] = 0;
            Deque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) {
                    if (color[v] == -1) {
                        color[v] = color[u] ^ 1;
                        q.add(v);
                    } else if (color[v] == color[u]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isBipartite(List.of(
            List.of(1, 3), List.of(0, 2), List.of(1, 3), List.of(0, 2)))); // true
    }
}
```

#### Python
```python
from collections import deque


def is_bipartite(adj):
    n = len(adj)
    color = [-1] * n
    for s in range(n):
        if color[s] != -1:
            continue
        color[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if color[v] == -1:
                    color[v] = color[u] ^ 1
                    q.append(v)
                elif color[v] == color[u]:
                    return False
    return True


if __name__ == "__main__":
    print(is_bipartite([[1, 3], [0, 2], [1, 3], [0, 2]]))  # True
```

**Key insight:** alternate colors layer by layer; a same-color edge means an odd cycle. The outer loop over all vertices covers disconnected components.

---

## Common Pitfalls in Interviews

1. **Marking visited at dequeue time.** The same node gets enqueued by several neighbors, distances become wrong, and the queue bloats. Mark when you *push*.
2. **Using `list.pop(0)` in Python.** That is `O(n)` per call and will time out. Use `collections.deque.popleft()`.
3. **Reaching for a stack.** A LIFO container turns BFS into DFS and destroys the shortest-path guarantee.
4. **Forgetting grid bounds checks.** Index a neighbor only after confirming `0 <= nr < n && 0 <= nc < m`.
5. **Applying BFS to a weighted graph.** It silently returns wrong "shortest paths." Use Dijkstra or 0-1 BFS.
6. **Off-by-one in path length.** Decide up front whether you count edges or cells; the binary-matrix problem counts cells, so the source is 1.
7. **Not seeding all sources** in multi-source problems, giving some cells wrong or infinite distances.
8. **Skipping the unreachable check** before reconstructing a path, causing a null/KeyError.
9. **Resetting a distance on revisit.** Once `dist[v]` is set it is final and shortest — never overwrite it.
10. **Only checking one component** in bipartite/components problems on a disconnected graph.

---

## What Interviewers Are Really Testing

- **Problem recognition.** Can you see that "fewest steps," "nearest," "minimum moves," or "shortest transformation" on equal-cost transitions is a BFS in disguise — often over an *implicit* state graph?
- **The two invariants.** Do you instinctively use a FIFO queue and mark visited on enqueue? These separate someone who memorized the shape from someone who understands why it is correct.
- **Knowing the boundary.** Do you know BFS fails on weighted graphs and can name the right escalation (Dijkstra, 0-1 BFS, Bellman–Ford)?
- **Complexity fluency.** Can you state `O(V + E)`, explain the `2E` edge-touches in undirected graphs, and reason about frontier-width memory?
- **Pattern range.** Multi-source, bipartite, level-by-level, state-graph, bidirectional — can you adapt the one template to each?
- **Production awareness (senior+).** Do you understand wide-frontier OOM, bitset/Bloom-filter visited sets, level-synchronous parallelism, and when distributed BFS is over-engineering?

Master the enqueue-time-visited template, recognize the disguises, and know exactly where BFS stops being the right tool — that combination is what interviewers reward.
