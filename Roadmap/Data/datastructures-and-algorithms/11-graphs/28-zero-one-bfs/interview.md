# 0-1 BFS — Interview Preparation

0-1 BFS is a favourite interview topic because it sits right between two algorithms every candidate already knows — plain BFS and Dijkstra — and tests whether you can *recognise* a special structure (weights in `{0,1}`) and exploit it for a `log V` speedup. It is small enough to whiteboard, it powers a whole family of grid problems (minimum obstacles, minimum cost to make a path, free-teleport mazes), and it has a couple of sharp gotchas (push to the right end; settle on pop, not push; skip stale entries) that separate "I memorised cp-algorithms" from "I understand why it works." This file is a graded question bank plus behavioral prompts and full Go/Java/Python coding challenges.

---

## Quick-Reference Cheat Sheet

| Concept | Rule | Why |
|---------|------|-----|
| Relax 0-weight edge | `deque.push_front(v)` | Same distance bucket — stays cheapest. |
| Relax 1-weight edge | `deque.push_back(v)` | Next distance bucket — goes behind. |
| Take next vertex | `deque.pop_front()` | Always the minimum current distance. |
| Settle a vertex | on **first front-pop** | Distance is provably optimal then. |
| Skip stale entry | `if d > dist[u]: continue` (or `settled[u]` flag) | A shorter path already settled it. |
| Complexity | `O(V + E)` time, `O(V)` space | No `log V` heap factor. |
| Applicability | every edge weight is exactly 0 or 1 | The two-bucket / deque invariant requires it. |

```text
relax(u -> v, w):                    # w in {0, 1}
    if dist[u] + w < dist[v]:
        dist[v] = dist[u] + w
        if w == 0: deque.push_front(v)
        else:      deque.push_back(v)
```

Decision rule:

```text
all weights equal  -> plain BFS            O(V+E)     (sibling 02-bfs)
weights {0,1}      -> 0-1 BFS              O(V+E)     deque
weights {0..k}     -> Dial's bucket queue  O(V+E+maxDist)
weights >= 0 any   -> Dijkstra            O(E log V) (sibling 04-dijkstra)
negative weights   -> Bellman-Ford        O(VE)      (sibling 05-bellman-ford)
```

---

## Junior Questions (12 Q&A)

### J1. What is 0-1 BFS and what problem does it solve?
0-1 BFS computes single-source shortest paths in a graph where **every edge weighs 0 or 1**. It runs in `O(V + E)` using a double-ended queue (deque) instead of the priority queue Dijkstra needs. It is the fast specialisation of Dijkstra for the binary-weight case.

### J2. How does 0-1 BFS differ from plain BFS?
Plain BFS works only on *unweighted* graphs (every edge effectively weighs 1) and uses a FIFO queue. 0-1 BFS allows weight-0 *and* weight-1 edges and uses a deque: 0-edges go to the front, 1-edges to the back. If every edge happens to weigh 1, 0-1 BFS degenerates exactly into plain BFS.

### J3. How does 0-1 BFS differ from Dijkstra?
Dijkstra handles arbitrary non-negative weights with a binary heap in `O(E log V)`. 0-1 BFS handles only weights `{0,1}` but drops the `log V` factor to reach `O(V + E)`, because with binary weights a deque can act as an `O(1)` priority queue.

### J4. What is the core rule of 0-1 BFS?
When you relax an edge of weight 0, `push_front` the neighbour; when you relax an edge of weight 1, `push_back` the neighbour. Pop always from the front.

### J5. Why push 0-edges to the front and 1-edges to the back?
A 0-edge keeps you at the same distance, so the neighbour is as cheap as the current vertex — it belongs at the front with the other cheapest vertices. A 1-edge increases distance by one, so the neighbour is one tier more expensive and belongs at the back.

### J6. What data structure is at the heart of 0-1 BFS?
A double-ended queue (deque) supporting `push_front`, `push_back`, and `pop_front` in `O(1)`. In Go a ring buffer or `container/list`; in Java `ArrayDeque`; in Python `collections.deque`.

### J7. What is the time and space complexity?
`O(V + E)` time and `O(V)` space — the same as plain BFS, and faster than Dijkstra by the `log V` factor.

### J8. What is a "stale entry" and why does it occur?
A stale entry is a deque element whose stored distance is larger than the current best `dist[v]`. It occurs because the same vertex can be pushed more than once when a shorter path is found later. You skip stale entries on pop (`if d > dist[u]: continue`) or use a `settled` flag.

### J9. How do you initialise 0-1 BFS?
Set `dist[src] = 0` and all others to `+∞`, then put the source in the deque. The relax loop then proceeds.

### J10. Can 0-1 BFS handle edge weights of 2?
No. The algorithm relies on the deque holding at most two adjacent distance values. A weight of 2 breaks that invariant and produces wrong answers. Use Dial's algorithm (small integer weights) or Dijkstra instead.

### J11. Give a concrete application of 0-1 BFS.
The classic "minimum number of obstacles to remove to cross a grid": moving into a free cell costs 0, moving into an obstacle cell costs 1. 0-1 BFS finds the minimum obstacles removed in `O(rows·cols)`.

### J12. What happens if all edge weights are 0?
Every reachable vertex ends at distance 0. The algorithm is still correct; the deque effectively just enumerates the reachable set.

---

## Middle Questions (12 Q&A)

### M1. Prove (informally) why the deque holds at most two distinct distance values.
Start with one value (the source at distance 0). When you pop a vertex at distance `d`, a 0-edge produces a neighbour at distance `d` pushed to the front (joining the `d`-group), and a 1-edge produces a neighbour at `d+1` pushed to the back (joining the `d+1`-group). No third value is ever introduced; the window of two values slides forward as the front `d`-group empties.

### M2. Why is the first front-pop of a vertex its optimal distance?
Because the front always holds the minimum live distance, every vertex popped before `u` had distance `≤ dist[u]`. Any shorter path to `u` would go through a predecessor that was popped earlier and would have already relaxed the edge into `u`. So no shorter path can exist when `u` is first front-popped — this is the same exchange argument that proves Dijkstra correct.

### M3. Explain "0-1 BFS is Dijkstra with a 2-bucket priority queue."
Dijkstra only needs `extract-min`. With 0/1 weights, the live tentative distances span at most two consecutive integers, so a structure with two buckets — "distance `d`" and "distance `d+1`" — is a sufficient priority queue. The deque is exactly that: the front segment is bucket `d`, the rear segment is bucket `d+1`. That removes the `log V` heap cost.

### M4. What are the two ways to handle stale entries, and which is better at scale?
(1) Store `(d, vertex)` and skip on pop if `d > dist[vertex]`. (2) Keep a `settled[]` boolean and expand each vertex only on its first pop. Both are correct and `O(V+E)`. At scale the settled-flag style is preferred because it caps each vertex to one expansion and bounds re-pushes.

### M5. Why must you settle a vertex on pop, not on push?
If you mark a vertex visited at push time, a later 0-edge could reach it with a smaller distance and you would wrongly skip the improvement. The front-pop is the moment its distance is provably final.

### M6. How do you model a grid problem as a 0-1 BFS graph?
Flatten each cell `(r, c)` to a vertex `r*C + c`. Each of the four moves is an edge; classify it as cost 0 (free move) or cost 1 (costly move) per the problem. Run the standard relax loop with bounds checks on neighbours.

### M7. What is a state-augmented 0-1 BFS and when do you need it?
When the cost of a move depends on more than position — e.g. the direction you face, a key you hold, a parity — make the vertex `(position, state)`. The 0/1 weights are unchanged; only the vertex count multiplies by the number of states. Example: "minimum cost to make a path" where moving in the cell's arrow direction is free (0) and any other direction costs a rotation (1).

### M8. Generalise 0-1 BFS to weights 0..k. What is the algorithm and its cost?
Dial's algorithm: keep an array of buckets indexed by distance; relaxing an edge of weight `w` from distance `d` inserts the neighbour into bucket `d+w`. Process buckets in increasing order. Cost: `O(V + E + maxDist)`. 0-1 BFS is the `k=1` case where only two buckets are ever live, collapsing the bucket array to a deque.

### M9. What is the danger of implementing `push_front` with an array `insert(0, x)`?
It is `O(n)` per call, turning the whole algorithm into `O(V·E)`. Use a real deque (`ArrayDeque`, `collections.deque`, ring buffer, or two-stack deque) for `O(1)` both ends.

### M10. When would you NOT use 0-1 BFS even though it would technically run?
On an unweighted graph (plain BFS is simpler and avoids the deque branch), and on graphs with any weight `> 1` (it would silently give wrong answers — use Dial's or Dijkstra).

### M11. How do you reconstruct the actual shortest path, not just its cost?
Maintain a `parent[]` array updated whenever `dist[v]` improves. After the BFS, walk `parent` from the target back to the source and reverse. Adds `O(V)` space and `O(path length)` time.

### M12. How do you do multi-source 0-1 BFS?
Seed the deque with all sources at distance 0 (`dist[s] = 0` for each). The two-level invariant is preserved because all sources share the front bucket. Useful for "distance to the nearest of several targets" problems.

---

## Senior Questions (10 Q&A)

### S1. Where do binary edge classes appear in real systems?
Anywhere transitions split into "free" and "costs one": intra-region vs cross-region network hops (minimise cross-region hops), staying on a layer vs a via in VLSI routing (minimise vias), moving with vs against a conveyor (minimise reorientations), identical vs single-edit document transitions (edit distance via layered graph).

### S2. How would you store a 50M-node 0-1 graph for cache-efficient 0-1 BFS?
CSR (compressed sparse row): an `offsets[V+1]` array and a `targets[E]` array. Pack the 0/1 weight into the low bit of each target id (`(to << 1) | weightBit`), so there is no separate weight array and each neighbour scan is one contiguous read. `dist` as `int32`. Use a ring-buffer deque.

### S3. Is 0-1 BFS parallelisable?
The single-query algorithm is inherently sequential — the front is one cursor processed in distance order. You parallelise *across* independent queries on a shared immutable snapshot (embarrassingly parallel), or use a level-synchronous bucketed / Δ-stepping variant: within a distance bucket, iterate the 0-edge relaxations to a fixpoint in parallel, then expand 1-edges to seed the next bucket.

### S4. What is the single most dangerous failure mode in production?
Silent weight-alphabet drift: a config or schema change introduces a weight-2 transition, and 0-1 BFS keeps running but returns plausible-but-wrong distances. Mitigation: validate that every relaxed weight is in `{0,1}` and alarm on violations; add a CI test that diffs against Dijkstra on production-shaped graphs.

### S5. How do you instrument 0-1 BFS for observability?
Track query latency, nodes expanded, deque peak size, stale-pop ratio, unreachable count, snapshot age, and a weight-alphabet-violation counter. The two highest-value signals are the violation counter (correctness) and the stale-pop ratio (performance / deque thrashing).

### S6. An edge flips from 1 to 0. Recompute or repair?
A full recompute is `O(V+E)` and always safe. Incremental repair (re-seed from the changed edge's endpoints and re-relax outward) only safely handles *improvements*; a weight increase can require invalidating a whole subtree and is subtle. For correctness-critical paths, recompute; reserve incremental repair for measured hot spots with tested invariants and use snapshot-swap for consistency.

### S7. How does the deque compare to a heap in cache behaviour?
A ring-buffer deque advances head/tail by one slot per op, so consecutive ops touch the same cache block — about `1/B` misses amortised per op. A binary heap traverses a root-to-leaf path of length `Θ(log n)` per op, with each deep level in a distinct block — `Θ(log(n/B))` misses. This cache advantage is a large part of 0-1 BFS's 2–3× speed edge.

### S8. When does Dial's algorithm stop being a good idea?
When `maxDist` is large (large weights or long paths): you allocate and sweep `O(maxDist)` buckets, most empty. Switch to a radix heap (`O(E + V log C)` for integer weights bounded by `C`) or a binary-heap Dijkstra (`O(E log V)`).

### S9. How do you bound memory for 0-1 BFS at scale?
The deque and `dist`/`settled` are `O(V)`; the CSR `targets` array (`~16·V` bytes for a 4-regular grid) dominates. For 50M nodes that is roughly 1.5 GB total — fits a single 32 GB box. Use `int32` for ids and distances; the deque should be a ring buffer to avoid per-element allocation.

### S10. How would you fail fast on unreachable queries on a huge graph?
Without a guard, an unreachable target drains the entire reachable component (`O(V+E)`). Precompute connected-component labels and reject cross-component queries immediately, or run bidirectional 0-1 BFS so failure is detected when the two frontiers exhaust without meeting.

---

## Professional / Theory Questions (8 Q&A)

### P1. State the two-level deque invariant precisely.
At any moment, reading the deque front-to-back, the associated `dist` values are non-decreasing and lie in `{d, d+1}` where `d` is the front vertex's distance: a (possibly empty) prefix all equal to `d`, then a (possibly empty) suffix all equal to `d+1`.

### P2. Prove the invariant is preserved by a push.
When expanding a popped vertex `u` at distance `d` (the current front value): a 0-edge sets the neighbour to `d` and `push_front`s it, prepending a `d` to the `d`-prefix (still uniform, values `{d, d+1}`); a 1-edge sets the neighbour to `d+1` and `push_back`s it, appending to the `d+1`-suffix (still uniform, values `{d, d+1}`). Either way no third value appears.

### P3. Prove the O(V+E) bound.
Each vertex is expanded at most once (settled flag). Expansion scans `deg(u)` edges with `O(1)` work each, including one `O(1)` deque push. Summing `O(1 + deg(u))` over all vertices gives `O(V) + O(Σ deg(u)) = O(V + E)`. Pops are bounded by pushes (`≤ E + 1`), each `O(1)`. Total `O(V + E)`.

### P4. Why exactly does the deque eliminate Dijkstra's log V factor?
The `log V` in heap-Dijkstra is the cost of `extract-min`/`decrease-key` on an arbitrary-key priority queue. With 0/1 weights the live keys span only two consecutive integers, so a two-bucket queue is an exact `O(1)` priority queue. The deque realises those two buckets as its front and rear segments.

### P5. Give the complexity of Dial's algorithm and explain each term.
`O(V + E + maxDist)`. `V` for settling each vertex once, `E` for relaxing each edge once, `maxDist` for scanning the bucket array indices (including empty buckets). Space `O(V + maxDist)`.

### P6. Show that 0-1 BFS strictly generalises plain BFS.
If every weight is 1, every relaxation does `push_back` and never `push_front`, so the deque behaves as a FIFO queue and the algorithm is byte-for-byte equivalent to plain BFS. Thus BFS is the all-ones special case of 0-1 BFS.

### P7. Why is the O(V+E) bound tight (cannot be beaten)?
Any correct shortest-path algorithm in the comparison/edge-inspection model must examine every edge at least once in the worst case to certify optimality; a single path of `V` vertices forces `Θ(V)` settles and edge scans. So `Ω(V + E)` is a lower bound, matched by 0-1 BFS.

### P8. What are the average-case frontier characteristics on a grid?
On a 2D grid (degree 4), the live frontier scales with the *perimeter* of the explored region — `Θ(√V)` for a roughly circular ball — not `Θ(V)`. This keeps the ring-buffer deque small and cache-resident, and the expected number of improving re-pushes per vertex is `O(1)`, so total work stays `Θ(V+E)` with a small constant.

---

## Behavioral Questions (5)

### B1. Describe a time you chose a simpler algorithm over a more general one.
Strong answer: explain recognising that a routing problem had only two edge cost classes, so you used 0-1 BFS (`O(V+E)`) instead of reaching for Dijkstra, with a runtime weight-validation guard to protect against the model ever changing. Emphasise the trade-off: simpler/faster, but you added a guard because the simpler algorithm is *less robust* to spec drift.

### B2. Tell me about a subtle bug you debugged in a graph algorithm.
Strong answer: a 0-1 BFS that gave wrong answers because `visited` was marked at push time, blocking a later shorter 0-edge path. Walk through how you reproduced it on a minimal grid, diffed against a Dijkstra baseline, and fixed it by settling on pop.

### B3. How do you decide when an optimisation is worth the added complexity?
Strong answer: 0-1 BFS over Dijkstra is a clean win (less code, faster, same correctness) *only* when weights are truly binary; you measured that the `log V` factor mattered for the graph size and added a CI diff test to keep the optimisation safe. Tie the decision to data, not preference.

### B4. Describe explaining a non-obvious algorithm to a teammate.
Strong answer: use the "free roads vs toll roads" analogy for the front/back rule, then show the two-level deque invariant on a small trace so they see *why* the front is always the minimum. Check understanding by asking them what breaks if a weight is 2.

### B5. Tell me about balancing correctness guarantees against performance pressure.
Strong answer: kept the `O(V+E)` 0-1 BFS but resisted dropping the stale-skip / settled-flag check under deadline pressure, because without it the deque thrashes and correctness on certain inputs degrades; instead you profiled and confirmed the check was cheap.

---

## Coding Challenges

### Challenge 1 — Minimum Obstacles to Reach the Corner

**Problem.** Given an `R×C` grid where `0` is an empty cell and `1` is an obstacle, return the minimum number of obstacles you must remove to travel from `(0,0)` to `(R-1,C-1)`, moving up/down/left/right. Entering an obstacle cell costs 1 (you remove it); entering an empty cell costs 0.

**Approach.** 0-1 BFS: cost of entering a cell = its grid value. 0-cost moves `push_front`, 1-cost moves `push_back`.

#### Go
```go
package main

import "fmt"

func minimumObstacles(grid [][]int) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = 0
	dq := []int{0} // simple deque via two-ended slice; use ring buffer in prod
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for len(dq) > 0 {
		cur := dq[0]
		dq = dq[1:]
		r, c := cur/C, cur%C
		for _, d := range dirs {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= R || nc < 0 || nc >= C {
				continue
			}
			w := grid[nr][nc]
			nid := nr*C + nc
			if dist[cur]+w < dist[nid] {
				dist[nid] = dist[cur] + w
				if w == 0 {
					dq = append([]int{nid}, dq...)
				} else {
					dq = append(dq, nid)
				}
			}
		}
	}
	return dist[R*C-1]
}

func main() {
	fmt.Println(minimumObstacles([][]int{{0, 1, 1}, {1, 1, 0}, {1, 1, 0}})) // 2
}
```

#### Java
```java
import java.util.*;

public class MinimumObstacles {
    public int minimumObstacles(int[][] grid) {
        int R = grid.length, C = grid[0].length, INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[R * C];
        Arrays.fill(dist, INF);
        dist[0] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(0);
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!dq.isEmpty()) {
            int cur = dq.pollFirst(), r = cur / C, c = cur % C;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
                int w = grid[nr][nc], nid = nr * C + nc;
                if (dist[cur] + w < dist[nid]) {
                    dist[nid] = dist[cur] + w;
                    if (w == 0) dq.addFirst(nid);
                    else        dq.addLast(nid);
                }
            }
        }
        return dist[R * C - 1];
    }

    public static void main(String[] args) {
        System.out.println(new MinimumObstacles()
            .minimumObstacles(new int[][]{{0, 1, 1}, {1, 1, 0}, {1, 1, 0}})); // 2
    }
}
```

#### Python
```python
from collections import deque

def minimum_obstacles(grid):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = 0
    dq = deque([0])
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while dq:
        cur = dq.popleft()
        r, c = divmod(cur, C)
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                w = grid[nr][nc]
                nid = nr * C + nc
                if dist[cur] + w < dist[nid]:
                    dist[nid] = dist[cur] + w
                    dq.appendleft(nid) if w == 0 else dq.append(nid)
    return dist[R * C - 1]


if __name__ == "__main__":
    print(minimum_obstacles([[0, 1, 1], [1, 1, 0], [1, 1, 0]]))  # 2
```

---

### Challenge 2 — Minimum Cost to Make a Path (Rotating Arrows)

**Problem.** Each cell of an `R×C` grid holds an arrow: `1`=right, `2`=left, `3`=down, `4`=up. Starting at `(0,0)`, you may follow a cell's own arrow for free, or pay 1 to rotate it to point elsewhere. Return the minimum cost to reach `(R-1,C-1)`. (LeetCode 1368.)

**Approach.** 0-1 BFS. From `(r,c)`, the move matching `grid[r][c]` costs 0 (`push_front`); the other three directions cost 1 (`push_back`).

#### Go
```go
package main

import "fmt"

func minCost(grid [][]int) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = 0
	dq := []int{0}
	// dir code -> (dr, dc); index by code 1..4
	dr := []int{0, 0, 0, 1, -1}
	dc := []int{0, 1, -1, 0, 0}
	for len(dq) > 0 {
		cur := dq[0]
		dq = dq[1:]
		r, c := cur/C, cur%C
		for code := 1; code <= 4; code++ {
			nr, nc := r+dr[code], c+dc[code]
			if nr < 0 || nr >= R || nc < 0 || nc >= C {
				continue
			}
			w := 1
			if grid[r][c] == code {
				w = 0
			}
			nid := nr*C + nc
			if dist[cur]+w < dist[nid] {
				dist[nid] = dist[cur] + w
				if w == 0 {
					dq = append([]int{nid}, dq...)
				} else {
					dq = append(dq, nid)
				}
			}
		}
	}
	return dist[R*C-1]
}

func main() {
	fmt.Println(minCost([][]int{{1, 1, 1, 1}, {2, 2, 2, 2}, {1, 1, 1, 1}, {2, 2, 2, 2}})) // 3
}
```

#### Java
```java
import java.util.*;

public class MinCostMakePath {
    public int minCost(int[][] grid) {
        int R = grid.length, C = grid[0].length, INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[R * C];
        Arrays.fill(dist, INF);
        dist[0] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(0);
        int[] dr = {0, 0, 0, 1, -1}, dc = {0, 1, -1, 0, 0};
        while (!dq.isEmpty()) {
            int cur = dq.pollFirst(), r = cur / C, c = cur % C;
            for (int code = 1; code <= 4; code++) {
                int nr = r + dr[code], nc = c + dc[code];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
                int w = grid[r][c] == code ? 0 : 1, nid = nr * C + nc;
                if (dist[cur] + w < dist[nid]) {
                    dist[nid] = dist[cur] + w;
                    if (w == 0) dq.addFirst(nid);
                    else        dq.addLast(nid);
                }
            }
        }
        return dist[R * C - 1];
    }

    public static void main(String[] args) {
        System.out.println(new MinCostMakePath().minCost(
            new int[][]{{1, 1, 1, 1}, {2, 2, 2, 2}, {1, 1, 1, 1}, {2, 2, 2, 2}})); // 3
    }
}
```

#### Python
```python
from collections import deque

def min_cost(grid):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = 0
    dq = deque([0])
    dr = (0, 0, 0, 1, -1)   # index by code 1..4
    dc = (0, 1, -1, 0, 0)
    while dq:
        cur = dq.popleft()
        r, c = divmod(cur, C)
        for code in range(1, 5):
            nr, nc = r + dr[code], c + dc[code]
            if 0 <= nr < R and 0 <= nc < C:
                w = 0 if grid[r][c] == code else 1
                nid = nr * C + nc
                if dist[cur] + w < dist[nid]:
                    dist[nid] = dist[cur] + w
                    dq.appendleft(nid) if w == 0 else dq.append(nid)
    return dist[R * C - 1]


if __name__ == "__main__":
    print(min_cost([[1, 1, 1, 1], [2, 2, 2, 2], [1, 1, 1, 1], [2, 2, 2, 2]]))  # 3
```

---

### Challenge 3 — Shortest Path with Free Teleporters

**Problem.** An `R×C` grid of `.` (open) and `#` (wall). You walk between adjacent open cells at cost 1 per step. Additionally, all cells of the same letter `a..z` are linked by **free** teleporters (cost 0). Return the minimum cost from `(0,0)` to `(R-1,C-1)`. Walls are impassable.

**Approach.** 0-1 BFS where walk-steps are weight 1 (`push_back`) and teleports are weight 0 (`push_front`). Build, for each letter, the list of cells carrying it; the first time you reach a letter, push all its twins at cost 0.

#### Go
```go
package main

import "fmt"

func shortestTeleport(grid []string) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	portals := map[byte][]int{}
	for r := 0; r < R; r++ {
		for c := 0; c < C; c++ {
			ch := grid[r][c]
			if ch >= 'a' && ch <= 'z' {
				portals[ch] = append(portals[ch], r*C+c)
			}
		}
	}
	used := map[byte]bool{}
	dist[0] = 0
	dq := []int{0}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for len(dq) > 0 {
		cur := dq[0]
		dq = dq[1:]
		r, c := cur/C, cur%C
		ch := grid[r][c]
		// free teleport to twins
		if ch >= 'a' && ch <= 'z' && !used[ch] {
			used[ch] = true
			for _, p := range portals[ch] {
				if dist[cur] < dist[p] {
					dist[p] = dist[cur]
					dq = append([]int{p}, dq...)
				}
			}
		}
		for _, d := range dirs {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr][nc] == '#' {
				continue
			}
			nid := nr*C + nc
			if dist[cur]+1 < dist[nid] {
				dist[nid] = dist[cur] + 1
				dq = append(dq, nid)
			}
		}
	}
	return dist[R*C-1]
}

func main() {
	fmt.Println(shortestTeleport([]string{"...a", "###.", "a..."})) // teleport shortcut
}
```

#### Java
```java
import java.util.*;

public class ShortestTeleport {
    public int shortest(String[] grid) {
        int R = grid.length, C = grid[0].length(), INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[R * C];
        Arrays.fill(dist, INF);
        Map<Character, List<Integer>> portals = new HashMap<>();
        for (int r = 0; r < R; r++)
            for (int c = 0; c < C; c++) {
                char ch = grid[r].charAt(c);
                if (ch >= 'a' && ch <= 'z')
                    portals.computeIfAbsent(ch, k -> new ArrayList<>()).add(r * C + c);
            }
        Set<Character> used = new HashSet<>();
        dist[0] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(0);
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!dq.isEmpty()) {
            int cur = dq.pollFirst(), r = cur / C, c = cur % C;
            char ch = grid[r].charAt(c);
            if (ch >= 'a' && ch <= 'z' && used.add(ch)) {
                for (int p : portals.get(ch))
                    if (dist[cur] < dist[p]) { dist[p] = dist[cur]; dq.addFirst(p); }
            }
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr].charAt(nc) == '#') continue;
                int nid = nr * C + nc;
                if (dist[cur] + 1 < dist[nid]) { dist[nid] = dist[cur] + 1; dq.addLast(nid); }
            }
        }
        return dist[R * C - 1];
    }

    public static void main(String[] args) {
        System.out.println(new ShortestTeleport().shortest(new String[]{"...a", "###.", "a..."}));
    }
}
```

#### Python
```python
from collections import deque, defaultdict

def shortest_teleport(grid):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    portals = defaultdict(list)
    for r in range(R):
        for c in range(C):
            ch = grid[r][c]
            if ch.islower():
                portals[ch].append(r * C + c)
    used = set()
    dist[0] = 0
    dq = deque([0])
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while dq:
        cur = dq.popleft()
        r, c = divmod(cur, C)
        ch = grid[r][c]
        if ch.islower() and ch not in used:
            used.add(ch)
            for p in portals[ch]:
                if dist[cur] < dist[p]:
                    dist[p] = dist[cur]
                    dq.appendleft(p)
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] != "#":
                nid = nr * C + nc
                if dist[cur] + 1 < dist[nid]:
                    dist[nid] = dist[cur] + 1
                    dq.append(nid)
    return dist[R * C - 1]


if __name__ == "__main__":
    print(shortest_teleport(["...a", "###.", "a..."]))
```

---

## Common Pitfalls

1. **Pushing 0-edges to the back.** Reverses the entire logic; you lose the "free moves are cheapest" guarantee and get FIFO behaviour. The single most common bug.
2. **Marking visited on push, not on pop.** Blocks a later, shorter 0-edge path. Always settle on the first front-pop.
3. **Using 0-1 BFS with a weight ≥ 2.** The two-level invariant breaks; answers are silently wrong. Use Dial's or Dijkstra.
4. **`O(n)` push_front.** A naive array `insert(0, x)` degrades the algorithm to `O(V·E)`. Use a real `O(1)` deque.
5. **Forgetting the stale-skip.** Re-expanding settled vertices wastes time; on adversarial inputs it can blow up.
6. **Off-by-one / missing bounds check** on grid neighbours.
7. **Confusing "cost to enter a cell" with "cost of the current cell"** in grid modelling — be explicit about which endpoint carries the weight.

## What Interviewers Are Really Testing

- **Recognition.** Can you spot that weights are binary and that this unlocks an `O(V+E)` solution instead of `O(E log V)` Dijkstra? This is the highest-signal moment of the interview.
- **The why, not the what.** Can you explain the two-level deque invariant and why the first front-pop is optimal — i.e. do you understand it as a 2-bucket Dijkstra, or did you just memorise "0 front, 1 back"?
- **Correctness discipline.** Do you settle on pop, skip stale entries, and validate the weight alphabet? These show production maturity.
- **Modelling skill.** Can you reduce a messy grid/state problem (rotating arrows, teleporters, directions) to a clean 0/1-weighted graph?
- **Complexity fluency.** Can you justify `O(V+E)`, contrast it with BFS and Dijkstra, and know when to escalate to Dial's or Dijkstra?
