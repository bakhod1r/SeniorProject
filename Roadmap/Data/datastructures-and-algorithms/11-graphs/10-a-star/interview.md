# A* Search — Interview Preparation

A* is a favorite interview topic because it sits at the intersection of three things interviewers love to probe: graph search, priority queues, and the subtle theory of *why* an algorithm is correct (admissibility and optimality). It is also disguised in many "shortest path in a grid," "sliding puzzle," "word ladder," and "minimum knight moves" problems. This file is a curated question bank sorted by seniority, behavioral and system-design prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | Detail |
|---------|--------|
| `g(n)` | Best known cost from start to `n`. |
| `h(n)` | Heuristic estimate of cost from `n` to goal. |
| `f(n) = g(n) + h(n)` | Priority used to order the open set. |
| Open set | Min-priority-queue keyed by `f`. |
| Closed set | Already-expanded nodes. |
| Admissible | `h(n) ≤ h*(n)` everywhere ⇒ A* returns an optimal path. |
| Consistent | `h(u) ≤ c(u,v) + h(v)` ⇒ no node reopening; `f` non-decreasing. |
| `h ≡ 0` | A* becomes Dijkstra. |
| `g ≡ 0` | A* becomes greedy best-first (not optimal). |
| Weighted A* (`w·h`) | Faster, returns ≤ `w × optimal`. |
| Time / Space | `O(b^d)` worst case; A* stores every generated node. |

Grid heuristics (`dx = |x−gx|`, `dy = |y−gy|`):

```text
Manhattan : dx + dy                            (4-directional)
Chebyshev : max(dx, dy)                         (8-dir, diagonal cost 1)
Octile    : max(dx,dy) + (sqrt(2)-1)*min(dx,dy) (8-dir, diagonal cost sqrt(2))
Euclidean : sqrt(dx*dx + dy*dy)                 (any-angle)
```

Core loop:

```text
push start with f = h(start)
while open not empty:
    cur = pop min f
    if cur == goal: return reconstruct(parent)
    for nb in neighbors(cur):
        t = g[cur] + cost(cur, nb)
        if t < g[nb]:
            g[nb] = t; parent[nb] = cur
            push nb with f = t + h(nb)
return failure
```

---

## Junior Questions (12 Q&A)

### J1. What is A* search?
A* is a best-first graph search that finds a shortest path from a start node to a goal by always expanding the node with the smallest `f(n) = g(n) + h(n)`, where `g(n)` is the cost already paid to reach `n` and `h(n)` is a heuristic estimate of the cost still remaining to the goal. With an admissible heuristic it returns an optimal path while typically exploring far fewer nodes than uninformed search.

### J2. What do `g`, `h`, and `f` mean?
`g(n)` is the exact cost of the best path found so far from the start to `n`. `h(n)` is the heuristic — an estimate of the remaining cost from `n` to the goal. `f(n) = g(n) + h(n)` is the algorithm's best guess of the total cost of a complete path through `n`. A* expands nodes in increasing order of `f`.

### J3. How is A* related to Dijkstra's algorithm?
A* is a generalization of Dijkstra. If you set `h(n) = 0` for every node, then `f = g` and A* behaves exactly like Dijkstra, exploring outward by accumulated cost with no sense of direction toward the goal. A* adds the heuristic `h` to bias the search toward the goal, which usually means far fewer expansions.

### J4. What is a heuristic and why does it help?
A heuristic `h(n)` estimates how far node `n` is from the goal. It helps because A* prefers nodes that appear close to the goal, so it does not waste effort exploring in directions that lead away. A good heuristic shrinks the explored region toward a nearly straight line between start and goal.

### J5. What does "admissible" mean?
A heuristic is admissible if it never overestimates the true remaining cost: `h(n) ≤ h*(n)` for all `n`. Admissibility is the key property that guarantees A* returns an optimal (shortest) path. An optimistic-but-never-pessimistic estimate keeps `f` a lower bound on the true path cost.

### J6. What happens if the heuristic overestimates?
If `h` overestimates (is inadmissible), A* may return a path that is not the shortest. The search can be fooled into committing to a worse route because it believes the better route is more expensive than it really is. The code still runs and returns *a* path — just not necessarily the optimal one — which is why this bug is dangerous.

### J7. What data structures does A* use?
A min-priority-queue (binary heap) for the open set, ordered by `f`; a hash map (or 2-D array on a grid) for the best-known `g` of each node; a parent map for path reconstruction; and a closed set (or the `g` map itself) to recognize already-settled nodes.

### J8. Which heuristic do you use on a 4-directional grid?
Manhattan distance, `|dx| + |dy|`. It equals the true shortest distance on an empty 4-directional grid, so it is admissible and maximally informed for that movement model. For 8-directional movement you would use Chebyshev or octile distance instead.

### J9. How do you reconstruct the path?
A* does not store the path directly. Each node keeps a parent pointer to whoever gave it its best `g`. When the goal is popped from the open set, you follow parent pointers backward from goal to start and reverse the list.

### J10. What is the time complexity of A*?
In the worst case it is the same as Dijkstra, `O(E log V)` with a binary heap, or `O(b^d)` in terms of branching factor `b` and solution depth `d`. A good heuristic reduces the number of expansions dramatically, but the worst case (e.g., `h = 0`) is unchanged.

### J11. What is the main weakness of A*?
Memory. A* keeps every node it generates in the open and closed sets, so its space cost is `O(V)` and can blow up on large maps. Variants like IDA* trade memory for recomputation precisely to address this.

### J12 (analysis). When is A* not the right choice?
When you need shortest paths to many targets at once (the heuristic is goal-specific, so use Dijkstra), when there are negative edge weights (use Bellman–Ford), when you compute all-pairs distances (use Floyd–Warshall), or when no usable heuristic exists (use Dijkstra and set `h = 0`).

---

## Middle Questions (12 Q&A)

### M1. Explain the difference between admissible and consistent heuristics.
Admissible means `h(n) ≤ h*(n)` everywhere — it guarantees an optimal path. Consistent (monotone) means `h(u) ≤ c(u,v) + h(v)` for every edge, the triangle inequality for the heuristic. Consistency is strictly stronger: every consistent heuristic is admissible, and it additionally guarantees `f` is non-decreasing along any path, so a node's `g` is optimal the first time it is expanded and it never needs reopening.

### M2. What is node reopening and when does it happen?
Reopening means moving a node out of the closed set back into the open set because a cheaper path to it was discovered later. It happens only with admissible-but-inconsistent heuristics. With a consistent heuristic, the first expansion of a node already has its optimal `g`, so reopening never occurs. If you use an inconsistent heuristic and forget to reopen, A* can return a suboptimal path.

### M3. Why does an admissible heuristic guarantee optimality?
Because `f(n) = g(n) + h(n) ≤ g(n) + h*(n)`, so `f(n)` is a lower bound on the cost of any complete path through `n`. A* expands in increasing `f`. If a suboptimal goal were about to be returned, some node on the true optimal path would still be in the open set with `f ≤ C* <` the suboptimal goal's cost, and A* would expand it first — contradiction. So A* cannot return a suboptimal path.

### M4. What is weighted A* and what does it buy you?
Weighted A* uses `f = g + w·h` with `w ≥ 1`. Inflating the heuristic makes the search greedier: it expands fewer nodes and runs faster, and the returned path is guaranteed to cost at most `w × optimal`. It is the standard knob for trading a bounded amount of optimality for speed on large maps.

### M5. What is heuristic dominance?
If `h₂(n) ≥ h₁(n)` for all `n` and both are admissible, `h₂` dominates `h₁`: it is more informed and A* with `h₂` never expands more nodes than with `h₁`. The takeaway is that among admissible heuristics, larger is better. You can combine two admissible heuristics by taking their max, which is still admissible.

### M6. How is A* with `g = 0` different from A* with `h = 0`?
`h = 0` gives Dijkstra: optimal but uninformed, explores by accumulated cost. `g = 0` gives greedy best-first search: it expands the node that looks closest to the goal, which is fast but not optimal because it ignores how much it has already spent. A* with both terms is the optimal middle ground.

### M7. How do you choose a heuristic for an 8-directional grid?
If diagonal moves cost the same as straight moves, use Chebyshev distance `max(dx, dy)`. If diagonal moves cost `√2`, use octile distance `max(dx,dy) + (√2−1)·min(dx,dy)`. Manhattan would overestimate diagonals and break admissibility on an 8-directional grid.

### M8. What is IDA* and when do you use it?
Iterative-Deepening A* runs repeated depth-first searches, each bounded by an `f`-threshold that increases until the goal is found. It uses only `O(depth)` memory instead of `O(b^d)`, at the cost of re-expanding shallow nodes each iteration. Use it when A*'s open set would not fit in memory — classically the 15-puzzle.

### M9. How does tie-breaking affect A*?
When several nodes share the same `f`, the expansion order changes how many nodes you touch. Breaking ties toward larger `g` (equivalently smaller `h`) biases the search toward the goal and often cuts expansions noticeably on flat-cost grids. A tiny straight-line bias further reduces zig-zag fanning in open areas.

### M10. What is Jump Point Search?
JPS is an optimization for uniform-cost grids. Instead of expanding cell by cell, it "jumps" in straight lines and only stops at jump points — cells with forced neighbors caused by obstacles. It returns the same optimal path as grid A* but keeps the open set tiny, often running 10× faster. It exploits the symmetry of grid paths that plain A* wastes time on.

### M11. How would you handle a dynamic map where obstacles move?
Recomputing from scratch every change is wasteful. Incremental replanning algorithms — D* Lite and LPA* — repair the previous search by updating only the affected `g`-values along the changed frontier, reusing most prior work. They are A*'s standard relatives for robotics where sensors continuously reveal new obstacles.

### M12 (analysis). Why is A* called "optimally efficient"?
Because among all admissible best-first algorithms using the same heuristic, none expands fewer nodes than A* (Dechter–Pearl). Any such algorithm must expand every node with `f*(n) < C*`, and A* expands exactly those (plus some ties). It does not mean A* expands *few* nodes — with a weak heuristic it is still exponential — only that no competitor with the same information does better.

---

## Senior Questions (10 Q&A)

### S1. How do you scale A* to a million-cell map served at high QPS?
Plain A* scales with query count, not map size, so first parallelize across queries with a worker pool over a shared read-only graph. To scale with map size, precompute structure: hierarchical pathfinding (HPA*) turns an `O(map)` search into an `O(portals)` abstract search plus local refinement; on road networks, contraction hierarchies or landmark (ALT) heuristics answer queries in microseconds after offline preprocessing. Add a path cache because most agents reuse corridors.

### S2. How would you parallelize a single A* search?
It is hard because the next node depends on the global minimum `f`. Practical options: bidirectional parallel A* (one thread forward, one backward, meet in the middle — clean 2× on long routes), or Hash-Distributed A* (HDA*) that hashes each node to an owner thread and ships successors to owners' queues, scaling across cores at the cost of communication and careful termination detection. In most systems you avoid in-search parallelism and parallelize across queries instead.

### S3. How do you bound A*'s memory in production?
Cap the number of expansions and fail over to weighted A* or hierarchy when exceeded; bound the open set size; run searches on memory-limited workers so one pathological query (a spiral maze) cannot OOM the box. For inherently huge but shallow state spaces, switch to IDA* (`O(depth)` memory) or SMA* (uses exactly the memory available, dropping the worst leaves).

### S4. What is the landmark (ALT) heuristic?
ALT precomputes exact distances from a few chosen "landmark" nodes to all others. For a query, `|d(L, goal) − d(L, node)|` is, by the triangle inequality, an admissible lower bound on the true distance from node to goal; you take the max over landmarks. It is far more informed than straight-line distance on road networks, shrinking expansions dramatically, at the cost of a few precomputed distance tables.

### S5. How do you detect that a "consistent" heuristic is actually inconsistent in prod?
Instrument a `reopened_nodes` counter. With a genuinely consistent heuristic it must stay zero. Any nonzero reopening signals either an inconsistent heuristic or a bug in relaxation. You can also add an assertion that checks `h(u) ≤ c(u,v) + h(v)` on sampled edges during testing.

### S6. How would you design a pathfinding service for a road network?
Load the graph once, immutable and shared read-only across workers; refresh on a schedule by atomically swapping the graph pointer. Preprocess with contraction hierarchies or ALT landmarks for sub-millisecond queries. Front it with geocoding/validation, run bidirectional search, and emit metrics on expanded nodes and latency. Cache popular routes. Pin a map version per query so readers never see a partial update.

### S7. What is the effective branching factor and how is it used?
If A* expands `N` nodes to reach a solution at depth `d`, the effective branching factor `b*` is the branching factor a uniform tree of depth `d` with `N` nodes would have. `b* ≈ 1` means a near-straight search; `b* = b` means no pruning. It is the standard scalar for comparing heuristic quality across domains — e.g., Manhattan (`b* ≈ 1.24`) dominates misplaced-tiles (`b* ≈ 1.42`) on the 8-puzzle.

### S8. When would you prefer weighted A* or even greedy search in production?
When latency or memory budgets are tight and a slightly longer path is acceptable. Weighted A* with `w = 1.5` often halves expansions while staying within 50% of optimal, and frequently the path is identical. Pure greedy is acceptable only when "a path now" beats "the shortest path" — e.g., a low-stakes ambient NPC that just needs to wander roughly toward a target.

### S9. How do incremental search algorithms (D* Lite) reuse work?
They maintain, in addition to `g`, an `rhs` value (a one-step lookahead estimate). When the map changes, only nodes whose `rhs` becomes inconsistent with `g` are re-examined, and the inconsistency propagates outward only as far as the change affects shortest paths. Most of the previous search remains valid, so a small change triggers a small repair rather than a full replan.

### S10 (analysis). What are the trade-offs between A*, IDA*, and SMA*?
A* is fastest in expansions but uses `O(b^d)` memory. IDA* uses `O(depth)` memory but re-expands shallow nodes each iteration and degrades on real-valued costs because thresholds inch up slowly. SMA* uses exactly the memory you give it, dropping the highest-`f` leaves and backing up their values, degrading gracefully and staying optimal as long as memory holds the shallowest solution path. The common thread is a strict space–time trade-off: less memory means more regeneration.

---

## Professional Questions (8 Q&A)

### P1. Prove that an admissible heuristic makes A* optimal.
Suppose A* is about to expand a suboptimal goal `γ` with `g(γ) > C*` (and `f(γ) = g(γ)` since `h(γ) = 0`). Let `n` be the shallowest open node on an optimal path; its prefix is optimal so `g(n) = g*(n)`. By admissibility, `f(n) = g*(n) + h(n) ≤ g*(n) + h*(n) = C* < g(γ) = f(γ)`. So A* would expand `n` before `γ`, contradicting that `γ` was chosen. Hence the first goal expanded has cost `C*`.

### P2. Prove that a consistent heuristic prevents reopening.
With consistency, along any expanded path `f(n_{i+1}) = g(n_i) + c(n_i,n_{i+1}) + h(n_{i+1}) ≥ g(n_i) + h(n_i) = f(n_i)`, so `f` is non-decreasing. When a node `n` is first removed from the open set, any alternative path to `n` goes through some still-open ancestor `p` with `f(p) ≤ f(n)`, and consistency telescoped along `p ⇝ n` gives `g(n) ≤ g(p) + k(p,n)`, so the current `g(n)` is already optimal. No later cheaper path exists, so `n` is never reopened.

### P3. State and explain the optimal-efficiency result for A*.
Dechter & Pearl (1985): among admissible best-first algorithms using heuristic `h`, A* is optimally efficient — any such algorithm must expand every node with `f*(n) < C*`. The adversary argument: if an algorithm skips such a node `n`, one can attach a goal below `n` reachable at cost `f*(n) < C*` consistent with all comparisons made, forcing the algorithm to miss the optimal solution. Therefore it must expand `n`, just like A*.

### P4. How does heuristic error affect the number of expansions?
If the absolute error `h*(n) − h(n)` grows at most logarithmically in `h*(n)`, A* expands only polynomially (often linearly) many nodes. If the error is bounded by a constant, growth is polynomial. But if the relative error `(h*−h)/h*` is bounded below by a positive constant, A* generally expands exponentially many nodes. Sub-exponential search therefore requires heuristics with very slowly growing absolute error — pattern databases or landmarks, not merely admissible estimates.

### P5. How do you build a strong admissible heuristic for the 15-puzzle?
Start with Manhattan distance (sum over tiles of the grid distance to home), which dominates misplaced-tiles. Strengthen it with linear-conflict additions, and best of all use disjoint pattern databases: precompute exact solution costs of independent subsets of tiles and sum them. Because the subsets are disjoint, the sum is admissible and far larger than Manhattan, cutting the effective branching factor sharply.

### P6. Why might IDA* perform terribly with real-valued edge costs?
IDA* increases its `f`-threshold to the smallest `f` that exceeded the previous threshold. With many distinct real-valued costs, that increment can be tiny, so each iteration adds only a handful of new nodes and the algorithm runs an enormous number of iterations, re-expanding almost everything each time. Remedies include inflating the threshold by a small factor (IDA*_CR) or using RBFS, which tracks backed-up values to avoid the slow threshold creep.

### P7. How would you combine a learned (neural) heuristic with optimality guarantees?
Learned heuristics are usually not admissible, so using them directly forfeits optimality. Two standard approaches: focal search, which uses the learned heuristic to order a "focal list" of nodes whose `f` is within a bound `w·f_min` (the separate admissible `f` bound preserves `w`-optimality); or lower-bounding the learned value with a known admissible heuristic. Both keep a provable suboptimality bound while exploiting the learned guidance for speed.

### P8 (analysis). Why do bucket or radix queues sometimes beat a binary heap for A*'s open set?
When edge costs are small integers, `f`-values fall into a small range, so a bucket queue indexes nodes by `f` directly, giving `O(1)` insert and extract-min with excellent cache locality, versus `O(log n)` and scattered memory access for a binary heap. Radix heaps extend this to larger integer ranges. For grid A* with unit or small integer costs, this constant-factor and cache win often dominates the asymptotic advantage of any comparison-based heap.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose A* over another approach. What were the trade-offs?
Look for a structured story: the problem (e.g., NPC pathfinding on a tile map), alternatives considered (BFS/Dijkstra, flow fields, navmesh), the criteria (latency budget per frame, optimality needs, memory), and why A* (with a specific heuristic, maybe JPS) won. Strong answers cite measured expansions or per-query latency and mention what surprised them — for instance, that a path cache mattered more than the inner loop.

### B2. Design a navigation feature for a ride-sharing app.
Expect a road-network routing design: preprocess with contraction hierarchies or ALT landmarks for fast queries; account for live traffic by adjusting edge weights and re-preprocessing or using time-dependent costs; handle turn restrictions and one-way streets in the graph model; cache popular routes; and discuss consistency when the map updates. Strong candidates discuss the offline-preprocessing vs. online-query split and how often the graph changes.

### B3. Design pathfinding for an RTS game with hundreds of units.
Calling raw A* per unit per frame blows the budget. Discuss hierarchical pathfinding for coarse routes, flow fields or group movement for many units heading to the same goal, JPS for cheap grid queries, time-slicing long searches across frames, and a path cache. Talk about repathing only when the map changes and about keeping each search within the frame's time slice.

### B4. A teammate scaled the heuristic up to make A* faster and shipped it. What do you say?
Inflating `h` past `h*` makes it inadmissible, so paths may no longer be shortest — a correctness regression hiding as a "speedup." The right framing is weighted A*: if some suboptimality is acceptable, use `f = g + w·h` with an explicit, documented bound `w` and a regression test comparing against Dijkstra on samples. The conversation is about making the trade-off intentional and bounded, not accidental.

### B5. Your pathfinding service has occasional latency spikes. How do you investigate?
Latency tracks expanded nodes almost linearly, so start with an `expanded_nodes` histogram and correlate spikes with specific start/goal pairs and map regions. Likely causes: pathological maze-like areas forcing near-full-map expansion, a degraded or mis-scaled heuristic, or cache misses. Check `open_set_peak` for memory pressure and `reopened_nodes` for heuristic inconsistency. Mitigate with expansion caps, hierarchy for the hot region, or a better heuristic.

---

## Coding Challenges

### Challenge 1: Shortest Path in a Grid with Obstacles

**Problem.** Given an `m × n` grid of `0`s (open) and `1`s (walls), return the length of the shortest 4-directional path from the top-left cell to the bottom-right cell, or `-1` if no path exists. Each step costs 1.

**Example.**

```text
grid = [[0,0,0],
        [1,1,0],
        [0,0,0]]
answer = 4   # right, right, down, down
```

**Constraints.** `1 ≤ m, n ≤ 1000`, cells are `0`/`1`, start and goal are open.

**Approach.** A* with Manhattan distance. Manhattan is admissible and consistent for 4-directional unit-cost movement, so no reopening is needed. (For pure unit costs, plain BFS also works and is `h = 0` A*; A* with Manhattan expands fewer cells.)

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type cell struct{ x, y, f int }
type pq []cell

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(cell)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func shortestPath(grid [][]int) int {
	m, n := len(grid), len(grid[0])
	if grid[0][0] == 1 || grid[m-1][n-1] == 1 {
		return -1
	}
	h := func(x, y int) int {
		dx, dy := m-1-x, n-1-y
		if dx < 0 {
			dx = -dx
		}
		if dy < 0 {
			dy = -dy
		}
		return dx + dy
	}
	dist := make([][]int, m)
	for i := range dist {
		dist[i] = make([]int, n)
		for j := range dist[i] {
			dist[i][j] = 1 << 30
		}
	}
	dist[0][0] = 0
	open := &pq{{0, 0, h(0, 0)}}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(cell)
		if c.x == m-1 && c.y == n-1 {
			return dist[c.x][c.y]
		}
		if c.f > dist[c.x][c.y]+h(c.x, c.y) {
			continue
		}
		for _, d := range dirs {
			nx, ny := c.x+d[0], c.y+d[1]
			if nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1 {
				continue
			}
			t := dist[c.x][c.y] + 1
			if t < dist[nx][ny] {
				dist[nx][ny] = t
				heap.Push(open, cell{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}
	fmt.Println(shortestPath(grid)) // 4
}
```

**Java.**

```java
import java.util.*;

public class GridShortestPath {
    public int shortestPath(int[][] grid) {
        int m = grid.length, n = grid[0].length;
        if (grid[0][0] == 1 || grid[m - 1][n - 1] == 1) return -1;
        int[][] dist = new int[m][n];
        for (int[] row : dist) Arrays.fill(row, Integer.MAX_VALUE);
        dist[0][0] = 0;
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h(0, 0, m, n), 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == m - 1 && y == n - 1) return dist[x][y];
            if (c[0] > dist[x][y] + h(x, y, m, n)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = dist[x][y] + 1;
                if (t < dist[nx][ny]) {
                    dist[nx][ny] = t;
                    open.add(new int[]{t + h(nx, ny, m, n), nx, ny});
                }
            }
        }
        return -1;
    }

    private int h(int x, int y, int m, int n) {
        return Math.abs(m - 1 - x) + Math.abs(n - 1 - y);
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 0, 0}, {1, 1, 0}, {0, 0, 0}};
        System.out.println(new GridShortestPath().shortestPath(grid)); // 4
    }
}
```

**Python.**

```python
import heapq


def shortest_path(grid):
    m, n = len(grid), len(grid[0])
    if grid[0][0] == 1 or grid[m - 1][n - 1] == 1:
        return -1
    h = lambda x, y: abs(m - 1 - x) + abs(n - 1 - y)
    dist = {(0, 0): 0}
    open_set = [(h(0, 0), 0, 0)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (m - 1, n - 1):
            return dist[(x, y)]
        if f > dist[(x, y)] + h(x, y):
            continue
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < m and 0 <= ny < n and grid[nx][ny] == 0:
                t = dist[(x, y)] + 1
                if t < dist.get((nx, ny), float("inf")):
                    dist[(nx, ny)] = t
                    heapq.heappush(open_set, (t + h(nx, ny), nx, ny))
    return -1


if __name__ == "__main__":
    print(shortest_path([[0, 0, 0], [1, 1, 0], [0, 0, 0]]))  # 4
```

**Follow-up.** What if you may remove up to `k` walls? Extend the state to `(x, y, walls_removed)` and run A* over that 3-D state space; the heuristic stays Manhattan (still admissible because removing walls can only help).

---

### Challenge 2: Sliding 8-Puzzle (IDA* / A* with Manhattan)

**Problem.** Given a 3×3 board with tiles `1..8` and a blank `0`, return the minimum number of moves to reach the goal `[[1,2,3],[4,5,6],[7,8,0]]`. A move slides a tile adjacent to the blank into the blank.

**Constraints.** Solvable boards only; optimal depth ≤ 31 for the 8-puzzle.

**Approach.** A* (or IDA* for memory) with the **Manhattan-distance heuristic**: sum over tiles of the grid distance from each tile's current position to its home. Manhattan is admissible because each tile needs at least that many moves.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

var goal = "123456780"

func manhattan(s string) int {
	d := 0
	for i := 0; i < 9; i++ {
		c := s[i]
		if c == '0' {
			continue
		}
		home := int(c - '1')
		d += abs(i/3-home/3) + abs(i%3-home%3)
	}
	return d
}
func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

type node struct{ s string; f int }
type pq []node

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(node)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func solve(start string) int {
	g := map[string]int{start: 0}
	open := &pq{{start, manhattan(start)}}
	moves := [][]int{{1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6}, {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}}
	for open.Len() > 0 {
		cur := heap.Pop(open).(node)
		if cur.s == goal {
			return g[cur.s]
		}
		if cur.f > g[cur.s]+manhattan(cur.s) {
			continue
		}
		z := indexOf(cur.s, '0')
		for _, m := range moves[z] {
			b := []byte(cur.s)
			b[z], b[m] = b[m], b[z]
			ns := string(b)
			t := g[cur.s] + 1
			if best, ok := g[ns]; !ok || t < best {
				g[ns] = t
				heap.Push(open, node{ns, t + manhattan(ns)})
			}
		}
	}
	return -1
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func main() {
	fmt.Println(solve("123456078")) // 2
}
```

**Java.**

```java
import java.util.*;

public class EightPuzzle {
    static final String GOAL = "123456780";
    static final int[][] MOVES = {
        {1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6},
        {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}
    };

    static int manhattan(String s) {
        int d = 0;
        for (int i = 0; i < 9; i++) {
            char c = s.charAt(i);
            if (c == '0') continue;
            int home = c - '1';
            d += Math.abs(i / 3 - home / 3) + Math.abs(i % 3 - home % 3);
        }
        return d;
    }

    public int solve(String start) {
        Map<String, Integer> g = new HashMap<>();
        g.put(start, 0);
        PriorityQueue<String> open =
            new PriorityQueue<>(Comparator.comparingInt(s -> g.get(s) + manhattan(s)));
        open.add(start);
        while (!open.isEmpty()) {
            String cur = open.poll();
            if (cur.equals(GOAL)) return g.get(cur);
            int z = cur.indexOf('0');
            for (int m : MOVES[z]) {
                char[] b = cur.toCharArray();
                char tmp = b[z]; b[z] = b[m]; b[m] = tmp;
                String ns = new String(b);
                int t = g.get(cur) + 1;
                if (t < g.getOrDefault(ns, Integer.MAX_VALUE)) {
                    g.put(ns, t);
                    open.add(ns);
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(new EightPuzzle().solve("123456078")); // 2
    }
}
```

**Python.**

```python
import heapq

GOAL = "123456780"
MOVES = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6],
         [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]]


def manhattan(s):
    d = 0
    for i, c in enumerate(s):
        if c == "0":
            continue
        home = int(c) - 1
        d += abs(i // 3 - home // 3) + abs(i % 3 - home % 3)
    return d


def solve(start):
    g = {start: 0}
    open_set = [(manhattan(start), start)]
    while open_set:
        f, cur = heapq.heappop(open_set)
        if cur == GOAL:
            return g[cur]
        if f > g[cur] + manhattan(cur):
            continue
        z = cur.index("0")
        for m in MOVES[z]:
            b = list(cur)
            b[z], b[m] = b[m], b[z]
            ns = "".join(b)
            t = g[cur] + 1
            if t < g.get(ns, float("inf")):
                g[ns] = t
                heapq.heappush(open_set, (t + manhattan(ns), ns))
    return -1


if __name__ == "__main__":
    print(solve("123456078"))  # 2
```

**Follow-up.** For the 15-puzzle the state space is far larger; switch to IDA* (`O(depth)` memory) and strengthen the heuristic with disjoint pattern databases.

---

### Challenge 3: Word Ladder with a Heuristic

**Problem.** Given `begin`, `end`, and a dictionary of equal-length words, return the length of the shortest transformation sequence changing one letter at a time, where every intermediate word is in the dictionary. Return 0 if impossible.

**Approach.** A* where the heuristic `h(w) =` number of positions where `w` differs from `end`. Each differing letter needs at least one move, so `h` is admissible.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type wnode struct{ w string; f int }
type pq []wnode

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(wnode)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func diff(a, b string) int {
	d := 0
	for i := range a {
		if a[i] != b[i] {
			d++
		}
	}
	return d
}

func ladderLength(begin, end string, words []string) int {
	dict := map[string]bool{}
	for _, w := range words {
		dict[w] = true
	}
	if !dict[end] {
		return 0
	}
	g := map[string]int{begin: 1}
	open := &pq{{begin, 1 + diff(begin, end)}}
	for open.Len() > 0 {
		cur := heap.Pop(open).(wnode)
		if cur.w == end {
			return g[cur.w]
		}
		if cur.f > g[cur.w]+diff(cur.w, end) {
			continue
		}
		b := []byte(cur.w)
		for i := 0; i < len(b); i++ {
			old := b[i]
			for c := byte('a'); c <= 'z'; c++ {
				if c == old {
					continue
				}
				b[i] = c
				nw := string(b)
				if dict[nw] {
					t := g[cur.w] + 1
					if best, ok := g[nw]; !ok || t < best {
						g[nw] = t
						heap.Push(open, wnode{nw, t + diff(nw, end)})
					}
				}
			}
			b[i] = old
		}
	}
	return 0
}

func main() {
	fmt.Println(ladderLength("hit", "cog", []string{"hot", "dot", "dog", "lot", "log", "cog"})) // 5
}
```

**Java.**

```java
import java.util.*;

public class WordLadder {
    static int diff(String a, String b) {
        int d = 0;
        for (int i = 0; i < a.length(); i++) if (a.charAt(i) != b.charAt(i)) d++;
        return d;
    }

    public int ladderLength(String begin, String end, List<String> words) {
        Set<String> dict = new HashSet<>(words);
        if (!dict.contains(end)) return 0;
        Map<String, Integer> g = new HashMap<>();
        g.put(begin, 1);
        PriorityQueue<String> open =
            new PriorityQueue<>(Comparator.comparingInt(w -> g.get(w) + diff(w, end)));
        open.add(begin);
        while (!open.isEmpty()) {
            String cur = open.poll();
            if (cur.equals(end)) return g.get(cur);
            char[] b = cur.toCharArray();
            for (int i = 0; i < b.length; i++) {
                char old = b[i];
                for (char c = 'a'; c <= 'z'; c++) {
                    if (c == old) continue;
                    b[i] = c;
                    String nw = new String(b);
                    if (dict.contains(nw)) {
                        int t = g.get(cur) + 1;
                        if (t < g.getOrDefault(nw, Integer.MAX_VALUE)) {
                            g.put(nw, t);
                            open.add(nw);
                        }
                    }
                }
                b[i] = old;
            }
        }
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(new WordLadder().ladderLength(
            "hit", "cog", List.of("hot", "dot", "dog", "lot", "log", "cog"))); // 5
    }
}
```

**Python.**

```python
import heapq


def ladder_length(begin, end, words):
    dict_set = set(words)
    if end not in dict_set:
        return 0
    diff = lambda a, b: sum(1 for x, y in zip(a, b) if x != y)
    g = {begin: 1}
    open_set = [(1 + diff(begin, end), begin)]
    while open_set:
        f, cur = heapq.heappop(open_set)
        if cur == end:
            return g[cur]
        if f > g[cur] + diff(cur, end):
            continue
        for i in range(len(cur)):
            for c in "abcdefghijklmnopqrstuvwxyz":
                if c == cur[i]:
                    continue
                nw = cur[:i] + c + cur[i + 1:]
                if nw in dict_set:
                    t = g[cur] + 1
                    if t < g.get(nw, float("inf")):
                        g[nw] = t
                        heapq.heappush(open_set, (t + diff(nw, end), nw))
    return 0


if __name__ == "__main__":
    print(ladder_length("hit", "cog", ["hot", "dot", "dog", "lot", "log", "cog"]))  # 5
```

**Follow-up.** Bidirectional search (from both `begin` and `end`) is usually faster here than the heuristic alone, because the branching factor is high.

---

### Challenge 4: Minimum Knight Moves

**Problem.** On an infinite chessboard, return the minimum number of knight moves to go from `(0,0)` to `(x, y)`.

**Approach.** A* with an admissible heuristic derived from how fast a knight can close distance: roughly `ceil(max(dx,dy) / 2)` adjusted so it never overestimates. A simple admissible choice is `h = max(ceil(dx/2), ceil(dy/2), ceil((dx+dy)/3))`.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type kn struct{ x, y, f int }
type pq []kn

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(kn)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func abs(a int) int { if a < 0 { return -a }; return a }
func ceilDiv(a, b int) int { return (a + b - 1) / b }
func max3(a, b, c int) int { m := a; if b > m { m = b }; if c > m { m = c }; return m }

func minKnightMoves(tx, ty int) int {
	tx, ty = abs(tx), abs(ty)
	h := func(x, y int) int {
		dx, dy := abs(tx-x), abs(ty-y)
		return max3(ceilDiv(dx, 2), ceilDiv(dy, 2), ceilDiv(dx+dy, 3))
	}
	g := map[[2]int]int{{0, 0}: 0}
	open := &pq{{0, 0, h(0, 0)}}
	moves := [][2]int{{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(kn)
		if c.x == tx && c.y == ty {
			return g[[2]int{c.x, c.y}]
		}
		if c.f > g[[2]int{c.x, c.y}]+h(c.x, c.y) {
			continue
		}
		for _, m := range moves {
			nx, ny := c.x+m[0], c.y+m[1]
			if nx < -2 || ny < -2 || nx > tx+2 || ny > ty+2 {
				continue
			}
			key := [2]int{nx, ny}
			t := g[[2]int{c.x, c.y}] + 1
			if best, ok := g[key]; !ok || t < best {
				g[key] = t
				heap.Push(open, kn{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return -1
}

func main() {
	fmt.Println(minKnightMoves(5, 5)) // 4
}
```

**Java.**

```java
import java.util.*;

public class KnightMoves {
    public int minKnightMoves(int tx, int ty) {
        tx = Math.abs(tx); ty = Math.abs(ty);
        final int fx = tx, fy = ty;
        java.util.function.BiFunction<Integer, Integer, Integer> h = (x, y) -> {
            int dx = Math.abs(fx - x), dy = Math.abs(fy - y);
            return Math.max(Math.max(ceil(dx, 2), ceil(dy, 2)), ceil(dx + dy, 3));
        };
        Map<Long, Integer> g = new HashMap<>();
        g.put(key(0, 0), 0);
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h.apply(0, 0), 0, 0});
        int[][] moves = {{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == fx && y == fy) return g.get(key(x, y));
            if (c[0] > g.get(key(x, y)) + h.apply(x, y)) continue;
            for (int[] m : moves) {
                int nx = x + m[0], ny = y + m[1];
                if (nx < -2 || ny < -2 || nx > fx + 2 || ny > fy + 2) continue;
                int t = g.get(key(x, y)) + 1;
                if (t < g.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    g.put(key(nx, ny), t);
                    open.add(new int[]{t + h.apply(nx, ny), nx, ny});
                }
            }
        }
        return -1;
    }

    static int ceil(int a, int b) { return (a + b - 1) / b; }
    static long key(int x, int y) { return ((long) (x + 1000) << 20) | (y + 1000); }

    public static void main(String[] args) {
        System.out.println(new KnightMoves().minKnightMoves(5, 5)); // 4
    }
}
```

**Python.**

```python
import heapq
from math import ceil


def min_knight_moves(tx, ty):
    tx, ty = abs(tx), abs(ty)

    def h(x, y):
        dx, dy = abs(tx - x), abs(ty - y)
        return max(ceil(dx / 2), ceil(dy / 2), ceil((dx + dy) / 3))

    g = {(0, 0): 0}
    open_set = [(h(0, 0), 0, 0)]
    moves = [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (tx, ty):
            return g[(x, y)]
        if f > g[(x, y)] + h(x, y):
            continue
        for dx, dy in moves:
            nx, ny = x + dx, y + dy
            if nx < -2 or ny < -2 or nx > tx + 2 or ny > ty + 2:
                continue
            t = g[(x, y)] + 1
            if t < g.get((nx, ny), float("inf")):
                g[(nx, ny)] = t
                heapq.heappush(open_set, (t + h(nx, ny), nx, ny))
    return -1


if __name__ == "__main__":
    print(min_knight_moves(5, 5))  # 4
```

**Follow-up.** Bounding the explored region (the `nx > tx+2` guard) is essential on an infinite board; without it the open set grows without bound. Discuss why a small margin past the target keeps the search admissible-correct.

---

## Common Pitfalls in Interviews

- **Inadmissible heuristic.** Scaling `h` up or using a heuristic that overestimates breaks optimality silently. State explicitly why your `h` is admissible.
- **Wrong heuristic for the movement model.** Manhattan on an 8-directional grid overestimates and is wrong; use octile/Chebyshev.
- **Forgetting the unreachable case.** When the open set empties, return failure — do not loop forever.
- **Confusing A* and Dijkstra.** Be ready to say A* with `h = 0` *is* Dijkstra, and to justify when each is appropriate.
- **Not skipping stale heap entries.** In the lazy variant you must skip outdated `(f, node)` entries or you may expand — even return — an obsolete node.
- **Relaxing on `f` instead of `g`.** Improvement checks compare `tentative_g` against the stored `g`, never against `f`.
- **Unbounded search on infinite boards.** Knight-moves-style problems need a bounding box or the open set explodes.
- **Ignoring reopening with inconsistent heuristics.** If you choose an admissible-but-inconsistent heuristic, you must reopen closed nodes (or use the lazy push-and-skip approach).
- **No tie-breaking.** On flat grids, missing a tie-break makes A* fan out far more than necessary; break ties toward larger `g`.

---

## What Interviewers Are Really Testing

A heuristic-search question is rarely about reciting the loop. Interviewers probe three deeper things. First, do you understand *why* A* is correct — can you articulate admissibility and prove (or at least argue) that it implies optimality, and explain what consistency adds? This separates candidates who memorized "g plus h" from those who understand the lower-bound argument. Second, can you recognize A* in disguise? Shortest path in a grid, the sliding puzzle, word ladder, and knight moves are all A* (or BFS, its `h = 0` cousin) with a domain-specific heuristic; spotting the reduction and choosing an admissible heuristic is the real test. Third, can you reason about the engineering trade-offs — memory blow-up and the IDA*/SMA* response, weighted A* for bounded suboptimality, the right heuristic for the movement model, tie-breaking, and the relationship to Dijkstra and greedy search? The strongest answers also touch production realities: how would you bound memory, how would you scale to large maps with hierarchy or landmarks, and how would you detect a heuristic regression in a live system. A* is a small enough scope that a single conversation can surface all of these dimensions, which is exactly why interviewers like it.
