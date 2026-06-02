# Breadth-First Search — Middle Level

> **Focus:** Why BFS is *correct* for unweighted shortest paths, when it is the right tool versus DFS or Dijkstra, and the advanced patterns (multi-source, bipartite, state-graph BFS) that turn the basic loop into a problem-solving Swiss-army knife.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph and Tree Applications](#graph-and-tree-applications)
6. [Algorithmic Integration](#algorithmic-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level BFS is "queue plus visited set." At middle level you start asking the questions that decide whether your solution is correct and fast:

- *Why* does BFS find the shortest path, and exactly when does that guarantee fail?
- When should I mark visited — enqueue or dequeue — and why does it actually matter for correctness, not just speed?
- How do I check bipartiteness, find connected components, or solve a puzzle (Rubik's cube, word ladder) where the "graph" is a space of states I generate on the fly?
- When does BFS beat DFS, and when must I reach for Dijkstra or 0-1 BFS instead?

These distinctions separate a candidate who recites the template from one who can adapt it to a disguised problem.

---

## Deeper Concepts

### The BFS Tree and Distance Layers

Run BFS from `s`. The edges through which each vertex is **first discovered** form the **BFS tree** rooted at `s`. Two facts make this tree special:

1. The unique tree path from `s` to any vertex `v` is a **shortest path** (fewest edges).
2. Every non-tree edge `(u, w)` connects vertices whose levels differ by **at most 1**. In an *undirected* graph there are no "long jumps" forward — an edge can only stay in a level (a **cross edge** within a level) or connect adjacent levels. There are no back edges that skip levels. (In a *directed* graph, edges may also point to already-visited vertices at any earlier level, but never produce a shorter path than already found.)

```
level 0:            s
                  /   \
level 1:        a       b
               / \     / \
level 2:     c    d   e   f
```

Any extra edge, say `c–e`, joins two level-2 nodes (same level) or a level-1 to level-2 node — never level-0 to level-2.

### Distance Proof Intuition

**Claim.** When BFS first dequeues `v`, `dist[v]` equals the true shortest (edge) distance `δ(s, v)`.

**Intuition.** Two invariants hold throughout:

- *Monotone queue:* at any moment the distances of the queued nodes are non-decreasing and span at most two consecutive values (`k` and `k+1`). FIFO never lets a farther node jump ahead of a nearer one.
- *Discovery is tight:* when `v` is discovered from `u`, we have `dist[v] = dist[u] + 1`. Since `u` was dequeued at its true distance and `v` is one edge away, `dist[v]` cannot exceed `δ(s,v)`; and it cannot be smaller because a shorter path's penultimate node would have been dequeued earlier and discovered `v` first.

The full induction (on distance layers) is in [`professional.md`](./professional.md). The takeaway: correctness rests entirely on the **FIFO** property and **equal edge weights**. Swap the queue for a stack and you get DFS (no guarantee); make edges weighted and the monotone-queue invariant breaks (use Dijkstra).

### Enqueue-Time Marking Is About Correctness, Not Just Speed

Marking visited at *dequeue* time can still produce correct distances for the *first* time a node is popped — but only if you also guard against re-processing. The robust, universally-correct rule is: **set `dist[v]`/mark visited at the instant you enqueue `v`, and never enqueue a marked node.** This makes each vertex enter the queue exactly once and each edge get relaxed exactly once, giving the clean `O(V+E)` bound. Dequeue-time marking lets a node sit in the queue multiple times, inflating space to `O(E)` and risking double-processing if you forget the second guard.

### Counting Edges: Directed vs Undirected

- **Undirected:** store each edge twice (`adj[u]` has `v`, `adj[v]` has `u`). The loop scans each edge from both ends → `2E` edge-touches → still `O(V+E)`.
- **Directed:** store each edge once. BFS follows out-edges only. Reachability is one-directional; to ask "who can reach `t`?" run BFS on the **reverse graph**.

---

## Comparison with Alternatives

| Attribute | BFS | DFS | Dijkstra | 0-1 BFS |
|-----------|-----|-----|----------|---------|
| Data structure | FIFO queue | Stack / recursion | Min-priority queue | Double-ended queue (deque) |
| Edge weights | Unweighted (all equal) | Unweighted | Non-negative reals | 0 or 1 only |
| Finds shortest path? | **Yes** (fewest edges) | No | **Yes** (min weight) | **Yes** (min weight) |
| Time | `O(V+E)` | `O(V+E)` | `O(E log V)` | `O(V+E)` |
| Space | `O(V)` (wide frontier) | `O(V)` (deep stack) | `O(V)` | `O(V)` |
| Visits order | Increasing distance | Depth-first | Increasing tentative dist | Increasing dist (0/1) |
| Natural for | Nearest / fewest steps, levels, bipartite | Topo sort, cycle/SCC, backtracking | Weighted shortest path | 0/1-weighted paths |
| Stack overflow risk | None (iterative) | Yes (deep recursion) | None | None |

**Choose BFS when:** the graph is unweighted (or all edges cost the same) and you want shortest distance, level structure, or "nearest" answers.

**Choose DFS when:** you need topological order, strongly-connected components, cycle detection, bridges/articulation points, or you're enumerating solutions via backtracking. (See sibling topic *DFS*.)

**Choose Dijkstra when:** edges have arbitrary non-negative weights. (Sibling topic *Dijkstra*.)

**Choose 0-1 BFS when:** every edge weighs 0 or 1 — a deque-based BFS gives `O(V+E)` instead of Dijkstra's log factor. (Sibling topic *0-1 BFS*.)

---

## Advanced Patterns

### Pattern: Multi-Source BFS

Seed the queue with **all** sources at distance 0. Each vertex is then labeled with its distance to the *nearest* source — for the price of a single traversal, not one BFS per source. This is the canonical solution to *rotting oranges*, *walls and gates / nearest exit*, and "distance to nearest 1 in a binary matrix."

The correctness is identical to single-source BFS on a graph with a virtual super-source connected to all real sources by zero... actually by *equal* edges, so the FIFO invariant still holds.

### Pattern: Bipartite Check (2-Coloring)

A graph is **bipartite** iff it has no odd-length cycle iff you can 2-color it so adjacent vertices differ. BFS colors each layer alternately: color the source `0`, its neighbors `1`, theirs `0`, and so on. If you ever try to give a vertex the *same* color as an already-colored neighbor, there's an odd cycle → not bipartite.

### Pattern: Shortest Path Reconstruction

Track `parent[v]` at discovery; after BFS, walk `parent` from target back to source and reverse. Combine with a `dist` array to answer both "how far?" and "by which route?"

### Pattern: BFS on a State Graph (implicit / lazily-generated)

Many puzzles have no explicit adjacency list — the *nodes are states* and *edges are legal moves*. Examples: word ladder (each word is a state; an edge changes one letter), the 8-puzzle, lock combinations, jug-pouring. You generate neighbors on demand and BFS finds the fewest moves to a goal state. The visited set is keyed by the *encoded state* (a string, tuple, or integer).

### Pattern: 0-1 BFS (forward reference)

When edges cost 0 or 1, replace the queue with a **deque**: push 0-weight transitions to the **front** and 1-weight transitions to the **back**. This keeps the deque distance-monotone and yields `O(V+E)`. Full treatment in the sibling topic *0-1 BFS*. If weights are arbitrary, escalate to Dijkstra.

---

## Graph and Tree Applications

```mermaid
graph TD
    A[BFS] --> B[Unweighted shortest path + reconstruction]
    A --> C[Connected components O(V+E)]
    A --> D[Bipartite / 2-coloring check]
    A --> E[Multi-source: rotting oranges, nearest exit]
    A --> F[State-graph search: word ladder, puzzles]
    A --> G[Level-order tree traversal]
    A --> H[Web crawl by link-distance]
```

### Connected Components

Loop over all vertices; whenever you hit an unvisited one, BFS from it and label the whole component. The total work across all components is still `O(V+E)` because each vertex and edge is touched once overall.

### Level-Order Tree Traversal

A tree is just an acyclic graph; BFS from the root yields the classic level-order traversal. The "snapshot the frontier size" trick (Pattern 3 in `junior.md`) emits one list per level.

---

## Algorithmic Integration

BFS is rarely the whole solution — it is a building block:

- **Edmonds–Karp max flow** is BFS used repeatedly to find shortest augmenting paths (sibling topic *max flow*).
- **Bipartite matching** uses BFS/DFS to find augmenting paths (sibling topic *bipartite matching*).
- **Multi-source BFS** seeds dynamic-programming-like distance fields (e.g. "distance transform" in image processing).
- **Diameter of a tree** = run BFS from any node to find the farthest node `x`, then BFS from `x`; the farthest distance is the diameter (two BFS passes).
- **BFS layering** feeds algorithms that need shortest-path *DAGs* (counting shortest paths, BFS in Dinic's blocking-flow phase).

---

## Code Examples

### Example 1: Multi-Source BFS — Rotting Oranges

Grid cells: `0` empty, `1` fresh orange, `2` rotten. Each minute, rotten oranges rot 4-adjacent fresh ones. Return minutes until none are fresh, or `-1` if impossible.

#### Go

```go
package main

import "fmt"

func orangesRotting(grid [][]int) int {
	n, m := len(grid), len(grid[0])
	type cell struct{ r, c int }
	queue := []cell{}
	fresh := 0
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			if grid[r][c] == 2 {
				queue = append(queue, cell{r, c}) // all sources, dist 0
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
	for len(queue) > 0 && fresh > 0 {
		minutes++
		var next []cell
		for _, cur := range queue { // process one full ring (minute)
			for _, d := range dirs {
				nr, nc := cur.r+d[0], cur.c+d[1]
				if nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1 {
					grid[nr][nc] = 2
					fresh--
					next = append(next, cell{nr, nc})
				}
			}
		}
		queue = next
	}
	if fresh > 0 {
		return -1
	}
	return minutes
}

func main() {
	grid := [][]int{{2, 1, 1}, {1, 1, 0}, {0, 1, 1}}
	fmt.Println(orangesRotting(grid)) // 4
}
```

#### Java

```java
import java.util.*;

public class RottingOranges {
    public static int orangesRotting(int[][] grid) {
        int n = grid.length, m = grid[0].length;
        Deque<int[]> queue = new ArrayDeque<>();
        int fresh = 0;
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++) {
                if (grid[r][c] == 2) queue.add(new int[]{r, c});
                else if (grid[r][c] == 1) fresh++;
            }
        if (fresh == 0) return 0;
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        int minutes = 0;
        while (!queue.isEmpty() && fresh > 0) {
            minutes++;
            int sz = queue.size();           // snapshot the ring
            for (int i = 0; i < sz; i++) {
                int[] cur = queue.poll();
                for (int[] d : dirs) {
                    int nr = cur[0] + d[0], nc = cur[1] + d[1];
                    if (nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1) {
                        grid[nr][nc] = 2;
                        fresh--;
                        queue.add(new int[]{nr, nc});
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
                q.append((r, c))     # every rotten cell is a source
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

### Example 2: Bipartite Check via BFS 2-Coloring

#### Go

```go
package main

import "fmt"

func isBipartite(adj [][]int) bool {
	n := len(adj)
	color := make([]int, n)
	for i := range color {
		color[i] = -1 // uncolored
	}
	for s := 0; s < n; s++ { // handle disconnected graphs
		if color[s] != -1 {
			continue
		}
		color[s] = 0
		queue := []int{s}
		for len(queue) > 0 {
			u := queue[0]
			queue = queue[1:]
			for _, v := range adj[u] {
				if color[v] == -1 {
					color[v] = color[u] ^ 1 // opposite color
					queue = append(queue, v)
				} else if color[v] == color[u] {
					return false // same color across an edge -> odd cycle
				}
			}
		}
	}
	return true
}

func main() {
	// square 0-1-2-3-0 is bipartite; add diagonal 0-2 to break it
	adj := [][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}}
	fmt.Println(isBipartite(adj)) // true
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
            Deque<Integer> queue = new ArrayDeque<>();
            queue.add(s);
            while (!queue.isEmpty()) {
                int u = queue.poll();
                for (int v : adj.get(u)) {
                    if (color[v] == -1) {
                        color[v] = color[u] ^ 1;
                        queue.add(v);
                    } else if (color[v] == color[u]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1, 3), List.of(0, 2), List.of(1, 3), List.of(0, 2));
        System.out.println(isBipartite(adj)); // true
    }
}
```

#### Python

```python
from collections import deque


def is_bipartite(adj):
    n = len(adj)
    color = [-1] * n
    for s in range(n):              # cover every component
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
                    return False    # edge inside one color class
    return True


if __name__ == "__main__":
    print(is_bipartite([[1, 3], [0, 2], [1, 3], [0, 2]]))  # True
```

### Example 3: Word Ladder (BFS on a state graph) — Python

```python
from collections import deque
from string import ascii_lowercase


def ladder_length(begin, end, word_list):
    """Fewest one-letter transformations from begin to end, else 0."""
    words = set(word_list)
    if end not in words:
        return 0
    q = deque([(begin, 1)])           # (state, distance)
    seen = {begin}
    while q:
        word, dist = q.popleft()
        if word == end:
            return dist
        for i in range(len(word)):    # generate neighbors lazily
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

The "graph" is never materialized; each word's neighbors are generated by trying every single-letter change. The visited set is keyed by the word string.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|------------------|
| Disconnected graph in bipartite/components | Only one component checked. | Loop over all vertices; start a fresh BFS on each uncolored/unvisited one. |
| State explosion in state-graph BFS | Visited set grows without bound; OOM. | Encode states compactly; bound the search; prune impossible states early. |
| Marking visited at dequeue | Same state enqueued many times. | Mark at enqueue; check before pushing. |
| Multi-source forgot a source | Some cells get wrong/`inf` distance. | Seed *every* source into the queue before the loop. |
| Mutating the grid as both input and visited | Hard-to-find aliasing bugs. | Pick one convention (e.g. overwrite `1→2` in rotting oranges) and document it. |
| Counting "minutes" off by one | Incremented before checking emptiness. | Increment per ring only when work is done, or use a `(state, dist)` queue. |

---

## Performance Analysis

| Graph shape | `V` | `E` | BFS time | Note |
|-------------|-----|-----|----------|------|
| Sparse (tree-like) | n | ~n | `O(n)` | Frontier stays small. |
| Dense | n | ~n² | `O(n²)` | Dominated by edges. |
| Grid `n×m` | n·m | ~4·n·m | `O(n·m)` | Four neighbors per cell. |
| Adjacency *matrix* | n | — | `O(n²)` | Row scan per vertex regardless of edge count. |

The **frontier width** drives memory: a wide graph (e.g. a complete bipartite layer) can queue `O(V)` nodes at once. This is the practical ceiling that the [senior file](./senior.md) discusses under "OOM on wide frontiers."

```python
# Quick demonstration that deque.popleft is O(1) while list.pop(0) is O(n):
import timeit
from collections import deque

setup_deque = "from collections import deque; q = deque(range(1_000_000))"
setup_list = "q = list(range(1_000_000))"
print("deque:", timeit.timeit("q.popleft()", setup=setup_deque, number=1_000_000))
print("list :", timeit.timeit("q.pop(0)",   setup=setup_list,  number=10_000))
# The list version is dramatically slower per call — never use list.pop(0) in BFS.
```

---

## Best Practices

- **One template, many problems.** Internalize the enqueue-time-visited loop; bolt on `dist`, `parent`, color, or multi-source seeding as needed.
- **Choose visited representation by vertex type.** Integer IDs → boolean/`dist` array; arbitrary states → hash set of encoded states.
- **Process by ring** (`for _ in range(len(q))`) when "levels" or "minutes" matter; otherwise carry `(node, dist)` in the queue.
- **Reverse the graph** to answer "who can reach `t`?" in a directed graph.
- **Reach for the right escalation:** equal weights → BFS; 0/1 weights → 0-1 BFS; non-negative weights → Dijkstra.
- **Bound implicit searches.** State graphs can be infinite; cap depth or detect goals early.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The frontier expanding ring by ring, with the queue shown explicitly.
> - Distance labels filling in, demonstrating the monotone-queue property.
> - The BFS tree edges (discovery edges) drawn distinctly from non-tree edges.

---

## Summary

BFS is correct for unweighted shortest paths because the FIFO queue processes vertices in non-decreasing distance order — a property that breaks the instant edges carry different weights. Marking visited at enqueue time keeps every vertex in the queue exactly once, giving clean `O(V+E)` time. From this single loop you get connected components, bipartite testing, multi-source distance fields (rotting oranges, nearest exit), and searches over implicit state graphs (word ladder, puzzles). Know when to escalate: DFS for structure (topo/SCC/cycles), 0-1 BFS for 0/1 weights, and Dijkstra for arbitrary non-negative weights.
