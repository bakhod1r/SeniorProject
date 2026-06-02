# A* Search — Junior Level

> **One-line summary:** A* (pronounced "A-star") is a best-first graph search that finds a shortest path by always expanding the node with the smallest `f(n) = g(n) + h(n)`, where `g` is the cost spent so far and `h` is a heuristic estimate of the cost remaining to the goal. With an admissible heuristic it returns an optimal path while exploring far fewer nodes than Dijkstra.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

**A\*** is the algorithm behind almost every "find me the shortest route" feature you have ever used: the blue line your phone draws to a restaurant, the path a unit walks in a strategy game, the moves a robot vacuum plans around your couch. It was published in **1968 by Peter Hart, Nils Nilsson, and Bertram Raphael** at the Stanford Research Institute, and more than fifty years later it is still the default answer to "how do I find a shortest path *quickly* when I have some idea where the goal is?".

A* sits exactly halfway between two simpler ideas you may already know:

1. **Dijkstra's algorithm** explores outward from the start in every direction equally, like ripples in a pond. It is correct but wasteful — it has no idea where the goal is, so it expands nodes leading *away* from the goal just as eagerly as nodes leading *toward* it.
2. **Greedy best-first search** rushes straight at the goal using only a guess of remaining distance. It is fast but can be fooled into a dead end or a long detour, because it ignores how much it has already spent.

A* combines the best of both. For each node `n` it computes:

```
f(n) = g(n) + h(n)
       └─┬─┘   └─┬─┘
   cost already  estimated cost
   paid to reach  still remaining
   n from start   from n to goal
```

It always expands the node with the **smallest `f`**, balancing "what have I spent" against "how much is probably left." The estimate `h(n)` is called the **heuristic**. When that heuristic never *overestimates* the true remaining cost (a property called **admissibility**), A* is guaranteed to return a shortest path — and it usually does so after touching a small fraction of the nodes Dijkstra would.

The engine underneath A* is a **priority queue** (see sibling topic `01-binary-heap` in `10-heaps`): the "open set" of nodes waiting to be expanded, ordered by `f`. That single data structure is what makes the "always pick the smallest `f`" step fast.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Graphs** — nodes (vertices) and weighted edges; a grid is just a graph in disguise.
- **Dijkstra's algorithm** — A* is a direct generalization of it (sibling topic `04-dijkstra`).
- **Priority queues / binary heaps** — the open set is a min-heap keyed on `f` (sibling topic `01-binary-heap` in `10-heaps`).
- **Hash maps / dictionaries** — to store `g`-scores and parent pointers per node.
- **Big-O notation** — `O(E)`, `O(log V)`, branching factor `b`.
- **Basic geometry** — Manhattan and Euclidean distance for grid heuristics.

Optional but helpful:

- Having implemented **BFS** and **DFS** on a grid at least once.
- Familiarity with the idea of **path reconstruction** via parent pointers.

---

## Glossary

| Term | Meaning |
|------|---------|
| **A\*** | Best-first search that expands the node minimizing `f(n) = g(n) + h(n)`. |
| **`g(n)`** | The exact cost of the best path found *so far* from the start to node `n`. |
| **`h(n)`** | The heuristic: an estimate of the remaining cost from `n` to the goal. |
| **`f(n)`** | The estimated total cost of a path through `n`: `g(n) + h(n)`. |
| **Open set** | The frontier — nodes discovered but not yet expanded. Stored in a min-priority-queue keyed by `f`. |
| **Closed set** | Nodes already expanded (we believe their best `g` is final). |
| **Expand a node** | Remove it from the open set and relax all of its neighbors. |
| **Relax an edge `(u, v)`** | Check whether going through `u` gives `v` a smaller `g`; if so, update `g(v)` and its parent. |
| **Heuristic** | The function `h`. Different problems use different heuristics. |
| **Admissible heuristic** | One that *never overestimates* the true remaining cost. Guarantees optimality. |
| **Consistent (monotone) heuristic** | Stronger property: `h(u) ≤ cost(u, v) + h(v)` for every edge. Guarantees no node ever needs re-expanding. |
| **Path reconstruction** | Walking parent pointers backward from goal to start to recover the route. |
| **Manhattan distance** | `|dx| + |dy|` — heuristic for 4-directional grids. |
| **Euclidean distance** | `√(dx² + dy²)` — straight-line heuristic. |

---

## Core Concepts

### 1. The three numbers: `g`, `h`, and `f`

Every node A* touches carries three numbers:

- **`g(n)`** — the real, accumulated cost of the cheapest route from the start to `n` discovered *so far*. It only ever decreases as better routes are found.
- **`h(n)`** — a fixed estimate of how far `n` still is from the goal. It depends only on `n` and the goal, never on the path taken.
- **`f(n) = g(n) + h(n)`** — the algorithm's best guess of the total cost of a complete path that passes through `n`. A* always expands the node with the smallest `f`.

If `h(n) = 0` for every node, `f = g` and A* becomes **exactly Dijkstra's algorithm** (sibling `04-dijkstra`). If `g(n) = 0` for every node, A* becomes **greedy best-first search**. A* is the sweet spot in between.

### 2. The open set (priority queue) and closed set

- The **open set** is the frontier: nodes we have *seen* but not yet *expanded*. It is a **min-heap** keyed on `f` so that "pick the most promising node" is `O(log V)`.
- The **closed set** is the set of nodes we have already expanded. Once a node leaves the open set and enters the closed set with a consistent heuristic, its `g` is final and we never look at it again.

```
loop:
    pop node `current` with smallest f from open set
    if current == goal: reconstruct and return path
    add current to closed set
    for each neighbor of current:
        tentative_g = g[current] + cost(current, neighbor)
        if tentative_g < g[neighbor]:   # found a better route
            g[neighbor] = tentative_g
            f[neighbor] = tentative_g + h(neighbor)
            parent[neighbor] = current
            push/update neighbor in open set
```

### 3. Admissibility — the key to optimality

A heuristic `h` is **admissible** if it never overestimates: for every node `n`,

```
h(n) ≤ true_cost(n, goal)
```

An admissible heuristic is *optimistic* — it may guess too low, but never too high. This single property guarantees A* returns an **optimal (shortest) path**. The intuition: because `h` never overestimates, `f(n)` is always a *lower bound* on the cost of any complete path through `n`. A* therefore cannot be tricked into returning early with a worse path while a better one is still cheaper than the current `f` of the goal.

A heuristic that *overestimates* (is inadmissible) can make A* return a non-shortest path. That is the single most important pitfall at this level.

### 4. Consistency (monotonicity) — the stronger guarantee

A heuristic is **consistent** (also called **monotone**) if for every edge `(u, v)`:

```
h(u) ≤ cost(u, v) + h(v)
```

This is the triangle inequality applied to the heuristic. Every consistent heuristic is also admissible, but not vice versa. Consistency buys you something extra: **`f` never decreases along a path**, so once a node is expanded its `g` is already optimal and it **never needs to be re-expanded**. With a merely admissible (but inconsistent) heuristic, A* may have to *reopen* nodes from the closed set, costing extra work. Most natural grid heuristics (Manhattan, Euclidean) are consistent, so reopening rarely matters in practice.

### 5. Common grid heuristics

For a grid where the goal is at `(gx, gy)` and the node is at `(x, y)`, let `dx = |x − gx|`, `dy = |y − gy|`:

| Heuristic | Formula | Use when movement is… |
|-----------|---------|------------------------|
| **Manhattan** | `dx + dy` | 4-directional (up/down/left/right). |
| **Chebyshev** | `max(dx, dy)` | 8-directional, diagonal costs the same as straight. |
| **Octile** | `max(dx,dy) + (√2 − 1)·min(dx,dy)` | 8-directional, diagonal costs `√2`. |
| **Euclidean** | `√(dx² + dy²)` | Any-angle / continuous movement. |

The rule of thumb: pick the heuristic that equals the true distance on an *empty* grid for your movement model. That makes it admissible *and* as informed as possible.

### 6. Path reconstruction

A* does not store the path directly. Instead each node keeps a **parent pointer** to whoever relaxed it best. When the goal is popped, you walk parents backward to the start and reverse the list.

---

## Big-O Summary

Let `b` be the branching factor (neighbors per node), `d` the depth of the optimal solution, `V` the number of nodes, `E` the edges.

| Aspect | Cost | Notes |
|--------|------|-------|
| Time (worst case) | **O(b^d)** or **O(E log V)** | Exponential in solution depth with a weak heuristic; like Dijkstra with `h ≡ 0`. |
| Time (good heuristic) | much smaller | A near-perfect `h` makes A* explore almost a straight line to the goal. |
| Pop from open set | **O(log V)** | Min-heap extract-min. |
| Push / update open set | **O(log V)** | Heap insert / decrease-key. |
| Space | **O(V)** | Open set + closed set + `g` map + parents — A* keeps every generated node in memory. |
| Path reconstruction | **O(path length)** | Walk parent pointers. |

The headline: A* has the **same worst-case bounds as Dijkstra**, but a good heuristic prunes the search dramatically. Its main practical weakness is **memory** — it stores every node it generates.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Dijkstra (`h = 0`) | Searching for a friend's house by walking outward in expanding circles from your home, checking every street equally, with no map. |
| Greedy best-first (`g = 0`) | Walking straight toward the city skyline you can see, ignoring how far you have already walked — you may hit a river and have to backtrack. |
| A* | Driving with a **GPS plus a compass**: you know exactly how far you have driven (`g`) and you have a straight-line estimate of how far the destination still is (`h`). You always advance toward the option whose *total* estimated trip is shortest. |
| Admissible heuristic | A compass that may say "the goal is at least 5 km away" but never says it is farther than it really is — optimistic but never pessimistic. |
| Inadmissible heuristic | A compass that exaggerates distances. It makes you cut corners and you may settle for a worse route, thinking the better one is too far. |
| Closed set | Streets you have fully explored and crossed off — no need to revisit. |

Where the analogy breaks: a real compass measures straight-line distance; A*'s `h` can be any optimistic estimate, including problem-specific ones (like "number of misplaced tiles" in a sliding puzzle).

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Returns an **optimal path** with an admissible heuristic. | Stores every generated node — **memory is `O(V)`** and can blow up. |
| Usually explores **far fewer nodes** than Dijkstra. | Needs a good heuristic; a poor one degrades it to Dijkstra. |
| Generalizes Dijkstra (`h = 0`) and greedy search (`g = 0`) — one framework. | An **inadmissible** heuristic silently breaks optimality. |
| Works on any weighted graph, not just grids. | With an inconsistent heuristic, nodes may be **reopened**, adding overhead. |
| Easy to tune: swap the heuristic to trade speed for optimality (weighted A*). | Heuristic and edge-cost **scales must match**, or results are wrong. |
| Clean, ~40-line implementation. | Not ideal for negative edge weights (like Dijkstra). |

**When to use:** point-to-point shortest path where you have a sensible distance estimate — game pathfinding, robot navigation, road routing, puzzle solving.

**When NOT to use:** all-pairs distances (use Floyd–Warshall), graphs with negative edges (use Bellman–Ford), or when you have no usable heuristic (use Dijkstra and skip the `h`).

---

## Step-by-Step Walkthrough

Search a 4×4 grid. Start `S = (0,0)` (top-left), goal `G = (3,3)` (bottom-right). Movement is 4-directional, each step costs 1, and there is a wall column `#` at `x = 2` for rows 0–2. Heuristic is **Manhattan distance**.

```
grid (row, col):       . = open, # = wall, S = start, G = goal
  col:  0   1   2   3
row 0:  S   .   #   .
row 1:  .   .   #   .
row 2:  .   .   #   .
row 3:  .   .   .   G
```

`h(x,y) = |3−x| + |3−y|`. So `h(S) = 6`.

We track `(g, h, f)` per node. The open set is ordered by `f`.

```
1. Push S: g=0, h=6, f=6.  Open={S(6)}
2. Pop S (f=6). Neighbors: (1,0) and (0,1).
     (1,0): g=1, h=5, f=6
     (0,1): g=1, h=5, f=6
   Open = {(1,0):6, (0,1):6}
3. Pop (0,1) (f=6). Right is wall. Down (1,1): g=2, h=4, f=6.
   Open = {(1,0):6, (1,1):6}
4. Pop (1,0) (f=6). Down (2,0): g=2, h=5, f=7. (1,1) already g=2.
   Open = {(1,1):6, (2,0):7}
5. Pop (1,1) (f=6). Down (2,1): g=3, h=3, f=6.
   Open = {(2,1):6, (2,0):7}
6. Pop (2,1) (f=6). Down (3,1): g=4, h=2, f=6.
   Open = {(3,1):6, (2,0):7, ...}
7. Pop (3,1) (f=6). Right (3,2): g=5, h=1, f=6.
8. Pop (3,2) (f=6). Right (3,3)=G: g=6, h=0, f=6.  GOAL reached!
```

Reconstruct parents: `G ← (3,2) ← (3,1) ← (2,1) ← (1,1) ← (0,1) ← S`. Path cost = 6.

Notice A* kept `f = 6` the whole way down the optimal corridor and almost never wandered toward the dead-end column behind the wall — that is the heuristic doing its job. Dijkstra would have expanded many more nodes on the left side before reaching the goal.

---

## Code Examples

### Example: A* on a 4-directional grid

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type Point struct{ x, y int }

type Node struct {
	p     Point
	f     int
	index int
}

// Min-heap on f.
type pq []*Node

func (h pq) Len() int            { return len(h) }
func (h pq) Less(i, j int) bool  { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *pq) Push(x any)         { n := x.(*Node); n.index = len(*h); *h = append(*h, n) }
func (h *pq) Pop() any           { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

// AStar returns the shortest path cost, or -1 if unreachable.
func AStar(grid [][]int, start, goal Point) int {
	rows, cols := len(grid), len(grid[0])
	h := func(p Point) int { return abs(p.x-goal.x) + abs(p.y-goal.y) } // Manhattan
	const inf = 1 << 30
	g := make(map[Point]int)
	g[start] = 0

	open := &pq{}
	heap.Init(open)
	heap.Push(open, &Node{p: start, f: h(start)})

	dirs := []Point{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		cur := heap.Pop(open).(*Node)
		if cur.p == goal {
			return g[goal]
		}
		// Skip stale entries whose f no longer matches the best g.
		if cur.f > g[cur.p]+h(cur.p) {
			continue
		}
		for _, d := range dirs {
			nb := Point{cur.p.x + d.x, cur.p.y + d.y}
			if nb.x < 0 || nb.x >= rows || nb.y < 0 || nb.y >= cols || grid[nb.x][nb.y] == 1 {
				continue
			}
			tentative := g[cur.p] + 1
			best, ok := g[nb]
			if !ok {
				best = inf
			}
			if tentative < best {
				g[nb] = tentative
				heap.Push(open, &Node{p: nb, f: tentative + h(nb)})
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{
		{0, 0, 1, 0},
		{0, 0, 1, 0},
		{0, 0, 1, 0},
		{0, 0, 0, 0},
	}
	fmt.Println(AStar(grid, Point{0, 0}, Point{3, 3})) // 6
}
```

#### Java

```java
import java.util.*;

public class AStarGrid {
    record Point(int x, int y) {}

    public static int aStar(int[][] grid, Point start, Point goal) {
        int rows = grid.length, cols = grid[0].length;
        // h = Manhattan distance.
        java.util.function.ToIntFunction<Point> h =
            p -> Math.abs(p.x() - goal.x()) + Math.abs(p.y() - goal.y());

        Map<Point, Integer> g = new HashMap<>();
        g.put(start, 0);

        // Open set ordered by f = g + h.
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h.applyAsInt(start), start.x(), start.y()});

        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            int[] cur = open.poll();
            Point p = new Point(cur[1], cur[2]);
            if (p.equals(goal)) return g.get(p);
            if (cur[0] > g.get(p) + h.applyAsInt(p)) continue; // stale
            for (int[] d : dirs) {
                int nx = p.x() + d[0], ny = p.y() + d[1];
                if (nx < 0 || nx >= rows || ny < 0 || ny >= cols || grid[nx][ny] == 1) continue;
                Point nb = new Point(nx, ny);
                int tentative = g.get(p) + 1;
                if (tentative < g.getOrDefault(nb, Integer.MAX_VALUE)) {
                    g.put(nb, tentative);
                    open.add(new int[]{tentative + h.applyAsInt(nb), nx, ny});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] grid = {
            {0, 0, 1, 0},
            {0, 0, 1, 0},
            {0, 0, 1, 0},
            {0, 0, 0, 0}
        };
        System.out.println(aStar(grid, new Point(0, 0), new Point(3, 3))); // 6
    }
}
```

#### Python

```python
import heapq


def a_star(grid, start, goal):
    rows, cols = len(grid), len(grid[0])

    def h(p):  # Manhattan distance
        return abs(p[0] - goal[0]) + abs(p[1] - goal[1])

    g = {start: 0}
    open_set = [(h(start), start)]  # (f, point)

    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, cur = heapq.heappop(open_set)
        if cur == goal:
            return g[cur]
        if f > g[cur] + h(cur):       # stale entry, skip
            continue
        for dx, dy in dirs:
            nx, ny = cur[0] + dx, cur[1] + dy
            if not (0 <= nx < rows and 0 <= ny < cols) or grid[nx][ny] == 1:
                continue
            nb = (nx, ny)
            tentative = g[cur] + 1
            if tentative < g.get(nb, float("inf")):
                g[nb] = tentative
                heapq.heappush(open_set, (tentative + h(nb), nb))
    return -1


if __name__ == "__main__":
    grid = [
        [0, 0, 1, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 0],
    ]
    print(a_star(grid, (0, 0), (3, 3)))  # 6
```

**What it does:** finds the shortest 4-directional path cost around a wall using Manhattan-distance A*.
**Run:** `go run main.go` | `javac AStarGrid.java && java AStarGrid` | `python a_star.py`

These examples use the **lazy "skip stale entries"** trick (the same one Dijkstra uses) instead of a true `decrease-key`, because it is simpler and works well.

---

## Coding Patterns

### Pattern 1: Reconstructing the path, not just the cost

Keep a `parent` map. After the goal pops, walk it backward.

```python
def reconstruct(parent, goal):
    path = [goal]
    while goal in parent:
        goal = parent[goal]
        path.append(goal)
    path.reverse()
    return path
```

Wire it in by setting `parent[nb] = cur` whenever you improve `g[nb]`.

### Pattern 2: A* as Dijkstra with `h = 0`

Set `h(n) = 0` and A* *is* Dijkstra (sibling `04-dijkstra`). This is a great correctness check: if your A* with `h = 0` matches your Dijkstra, the core loop is right and any difference comes purely from the heuristic.

### Pattern 3: Lazy open set (no decrease-key)

Instead of updating a node's priority in place, just push a new `(f, node)` entry and skip outdated ones on pop:

```python
f, cur = heapq.heappop(open_set)
if f > g[cur] + h(cur):
    continue   # an improved entry was pushed later; this one is stale
```

This trades a slightly larger heap for much simpler code.

```mermaid
graph TD
    A[Pop node with min f] --> B{Is it the goal?}
    B -- yes --> C[Reconstruct path via parents]
    B -- no --> D[For each neighbor: relax g]
    D --> E{tentative_g < g[neighbor]?}
    E -- yes --> F[Update g, parent; push f=g+h]
    E -- no --> A
    F --> A
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Returns a non-shortest path | Heuristic overestimates (inadmissible). | Use an admissible `h`; verify `h(n) ≤ true distance` on small cases. |
| Infinite loop / never terminates | Goal unreachable and no empty-open-set check. | Return failure when the open set empties. |
| `KeyError` / nil on `g[neighbor]` | Treating an unseen node as having a `g`. | Default unseen `g` to `+∞`. |
| Wrong path on diagonal grid | Manhattan heuristic with 8-directional moves. | Use octile/Chebyshev to match the movement model. |
| Heuristic dominates cost wildly | `h` in meters, edge cost in seconds (scale mismatch). | Convert both to the same unit before combining. |
| Stale entry returned as goal | Popping an outdated `(f, node)` without a freshness check. | Skip entries where `f > g[node] + h(node)`. |

---

## Performance Tips

- **Use the most informed admissible heuristic** you can. The closer `h` is to the true remaining cost, the fewer nodes A* expands.
- **Use the lazy open-set trick** unless profiling shows the heap is your bottleneck; it avoids implementing `decrease-key`.
- **Break ties toward larger `g`** (or smaller `h`) when two nodes share `f`. This nudges A* toward the goal and cuts the number of expansions on flat-cost grids.
- **Cache neighbor lookups** on grids — precompute the four (or eight) offsets once.
- **Avoid recomputing `h`** if it is expensive: store it alongside `g`.

---

## Best Practices

- Always confirm your heuristic is **admissible** before trusting optimality — write a test that compares A* against Dijkstra on random inputs.
- State explicitly whether your problem is 4- or 8-directional and pick the matching heuristic.
- Keep `g`, `parent`, and the open set in separate maps; do not overload one structure.
- Return both the **cost** and the **path** from your function — callers usually need both.
- Document the units of cost and heuristic at the top of the function.

---

## Edge Cases & Pitfalls

- **Start equals goal** — return cost 0 and a one-node path immediately.
- **Goal unreachable** — the open set empties; return a sentinel (`-1`, `None`, exception) and document it.
- **Heuristic that overestimates** — silently returns a worse path; the most dangerous bug because the code still "works."
- **Zero heuristic** — correct but slow; you have written Dijkstra.
- **Negative edge weights** — A* (like Dijkstra) is not designed for these; use Bellman–Ford.
- **Floating-point `f` ties** — comparisons can be jittery; add a deterministic tiebreaker (e.g., a counter).
- **Disconnected grid** — make sure walls cannot wall off the goal silently without a failure return.

---

## Common Mistakes

1. **Using an inadmissible heuristic** (e.g., Euclidean distance scaled up, or "tiles out of place × 2") and being surprised the path is not shortest.
2. **Mismatched heuristic and movement model** — Manhattan on an 8-directional grid overestimates diagonals and breaks optimality.
3. **Forgetting the empty-open-set termination** — the search spins forever on unreachable goals.
4. **Treating unseen nodes as `g = 0`** instead of `+∞`, so every node looks "improvable."
5. **Comparing `tentative_g` against `f` instead of `g`** — relaxation is about `g`, never `f`.
6. **Not skipping stale heap entries** in the lazy version, so an outdated node is expanded and may even be returned as the goal.
7. **Mixing units** — heuristic in one scale, edge weights in another.

---

## Cheat Sheet

| Symbol / Step | Meaning |
|---------------|---------|
| `g(n)` | Best known cost start → `n`. |
| `h(n)` | Estimated cost `n` → goal. |
| `f(n) = g(n)+h(n)` | Priority key in the open set. |
| Open set | Min-heap keyed on `f`. |
| Closed set | Already-expanded nodes. |
| Admissible | `h ≤ true remaining` ⇒ optimal. |
| Consistent | `h(u) ≤ cost(u,v)+h(v)` ⇒ no reopening. |
| `h ≡ 0` | A* becomes Dijkstra. |
| `g ≡ 0` | A* becomes greedy best-first. |

Grid heuristics:

```
Manhattan : dx + dy                              (4-dir)
Chebyshev : max(dx, dy)                           (8-dir, diagonal cost 1)
Octile    : max(dx,dy) + (√2 − 1)·min(dx,dy)      (8-dir, diagonal cost √2)
Euclidean : sqrt(dx*dx + dy*dy)                   (any-angle)
```

Core loop:

```
push start (f = h(start))
while open not empty:
    cur = pop min f
    if cur == goal: return reconstruct()
    for nb in neighbors(cur):
        t = g[cur] + cost(cur, nb)
        if t < g[nb]:
            g[nb] = t; parent[nb] = cur
            push nb with f = t + h(nb)
return failure
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of A* search on a grid.
>
> The animation demonstrates:
> - Open (frontier) cells, closed (expanded) cells, walls, and the final path in distinct colors.
> - The `g`, `h`, and `f` values shown inside each visited cell.
> - The current node being expanded, highlighted each step.
> - A heuristic selector (Manhattan vs Euclidean) so you can watch the search shape change.
> - Step, Run, and Reset controls.

---

## Summary

A* is the shortest-path algorithm you reach for when you know roughly where the goal is. It expands nodes in order of `f(n) = g(n) + h(n)`, combining the cost already paid (`g`) with an optimistic estimate of the cost remaining (`h`). With an **admissible** heuristic it is guaranteed optimal; with a **consistent** one it never re-expands a node. It generalizes Dijkstra (`h = 0`) and greedy best-first search (`g = 0`) in one clean framework, and its engine is a priority queue ordered by `f`. Master the three numbers and the open/closed-set loop, and you have mastered the core of game pathfinding, robot navigation, and route planning.

---

## Further Reading

- Hart, Nilsson & Raphael (1968), *A Formal Basis for the Heuristic Determination of Minimum Cost Paths* — the original paper.
- *Artificial Intelligence: A Modern Approach* (Russell & Norvig), Chapter 3 — "Informed Search."
- Amit Patel, *Red Blob Games — "Introduction to A\*"* — the best interactive tutorial on the web.
- *Introduction to Algorithms* (CLRS), Chapter 24 — Dijkstra, the foundation A* builds on.
- Sibling topics: `04-dijkstra` (the `h = 0` special case) and `01-binary-heap` in `10-heaps` (the open set).
