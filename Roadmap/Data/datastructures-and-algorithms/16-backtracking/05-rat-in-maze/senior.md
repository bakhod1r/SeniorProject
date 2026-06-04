# Rat in a Maze (Grid Path Backtracking) — Senior Level

> On a toy grid, backtracking is a five-line recursion nobody worries about. The moment the grid is large, the path count explodes, the recursion depth threatens the stack, or the search runs inside a latency-sensitive service, every decision — iterative vs recursive DFS, when to switch to BFS/A*, how to prune, how to bound output, how to test enumeration correctly — becomes a real engineering call. This document treats those calls in production terms.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Large Grids and the Exponential Reality](#2-large-grids-and-the-exponential-reality)
3. [Recursion Depth, Stack Limits, and Iterative DFS](#3-recursion-depth-stack-limits-and-iterative-dfs)
4. [Memoization: Where It Helps and Where It Cannot](#4-memoization-where-it-helps-and-where-it-cannot)
5. [When to Prefer BFS, Bidirectional BFS, or A*](#5-when-to-prefer-bfs-bidirectional-bfs-or-a)
6. [Pruning at Scale](#6-pruning-at-scale)
7. [Engineering the Search](#7-engineering-the-search)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the rat find the cheese" but "what am I actually being asked, and what breaks when I scale it?". Grid-path backtracking shows up in three guises that share one engine:

1. **Path enumeration / counting** — "list (or count) every route satisfying a constraint." The cost is intrinsically exponential because the number of simple paths is exponential; the engineering is about *bounding output* and *pruning hard*.
2. **Feasibility / reachability** — "is there *a* path?" Backtracking works, but a permanent-visited BFS/DFS is `O(N)` and never risks the exponential blowup; prefer it unless you must enumerate.
3. **Optimal single path** — "the shortest / cheapest route." This is **not** a backtracking problem at all; it is BFS (unit cost), Dijkstra (weights), or A* (with a heuristic). A senior recognizes this and does not force the recursion.

The four senior decisions are: **how to keep the search from exploding** (pruning, bounding), **how to keep the recursion from overflowing the stack** (iterative DFS, depth limits), **how to choose the right algorithm for the actual question** (enumerate vs optimal vs feasible), and **how to verify an enumeration when the output is too large to eyeball**. This document covers each.

### 1.1 The one question that determines everything

Before any code, answer two sub-questions and the algorithm is essentially decided:

1. **Optimize or enumerate?** Do you want *one optimal* path (shortest/cheapest) or *all/some* paths (and counts/constraints)? Optimize → BFS/Dijkstra/A* with permanent visited, polynomial. Enumerate → backtracking with trail-scoped visited, exponential.
2. **Cyclic or acyclic movement?** Can a cell be revisited on a valid path? Acyclic (monotone D/R) → drop the visited set, use DP, polynomial counting. Cyclic (free 4/8-direction) → visited set is mandatory, exponential.

Almost every production mistake in this space is a wrong answer to one of these two questions — most often using backtracking to optimize (decision 1) or adding a cell-keyed cache to a cyclic search (decision 2). Get these right first; the implementation details below are secondary.

---

## 2. Large Grids and the Exponential Reality

### 2.1 The number of paths is the cost

The dominant fact: in an open grid, the number of simple paths from corner to corner grows exponentially in `N = n·m`. Even with perfect pruning, *enumerating* or *counting* all of them cannot be polynomial, because the answer itself is exponential. For *monotone* paths (only Down/Right) the count is the binomial `C(n+m-2, n-1)` (see `professional.md`), already exponential; with full 4-direction freedom it is vastly larger. Any "all paths" request on a large open grid is a non-starter — the right senior response is to *challenge the requirement*: do they need all paths, the count, one path, or the shortest?

### 2.2 Counting vs enumerating

If only the **count** is needed and movement is **monotone** (Down/Right), do **not** backtrack — use dynamic programming: `dp[r][c] = dp[r-1][c] + dp[r][c-1]` over open cells, `O(N)`. Backtracking counting is `O(4^N)`; the DP is linear. Backtracking is only forced when paths may revisit-free wander in all four directions (the general simple-path count, which *is* #P-hard in general graphs and exponential here).

### 2.3 Bounding the output

When enumeration is genuinely required, bound it: cap the number of returned paths (`top-K`), cap the path length, or stream paths to the caller (a generator/iterator) instead of materializing a giant list in memory. Materializing all paths of a 20×20 grid will OOM long before it finishes.

### 2.4 The path-count explosion in numbers

To make the exponential concrete, here are exact corner-to-corner simple-path counts on fully open square grids with 4-direction movement:

| grid | monotone (D/R) paths | free 4-direction simple paths |
|------|----------------------|-------------------------------|
| 2×2 | 2 | 2 |
| 3×3 | 6 | 12 |
| 4×4 | 20 | 184 |
| 5×5 | 70 | 8,512 |
| 6×6 | 252 | 1,262,816 |
| 7×7 | 924 | 575,780,564 |

The free-movement column roughly squares every two sizes — by `8×8` it is in the hundreds of billions. No enumeration finishes, and no pruning rescues it on an *open* grid (pruning only helps when walls create doomed branches). This table is the data behind the senior reflex: when someone asks for "all paths" on a non-trivial grid, the right first move is to question the requirement, not to optimize the search.

---

## 3. Recursion Depth, Stack Limits, and Iterative DFS

### 3.1 The depth is the path length

The recursion depth equals the current path length, up to `N = n·m`. For a `1000 × 1000` grid that is up to `10^6` frames. Python's default recursion limit (~1000) overflows immediately; the JVM and Go also have finite stacks (Go grows goroutine stacks but can still hit a cap). On large grids, **deep recursion is a real crash risk**, not a theoretical one.

### 3.2 Iterative DFS with an explicit stack

Convert the recursion to an explicit stack to remove the call-stack limit. The tricky part is reproducing the **un-mark** on the way back up. Store an iterator/index of the next direction to try per frame, and un-mark when a frame is finally popped.

```text
push (start, dirIndex=0); mark(start)
while stack not empty:
    (cell, di) = top
    if cell is goal: handle; pop and un-mark; continue
    if di < numDirs:
        top.di += 1
        next = cell + dir[di]
        if valid(next) and not visited(next):
            mark(next); push(next, 0)
    else:
        pop; un-mark(cell)      # backtrack
```

This is exactly the recursive search, with the visited mark/un-mark tied to push/pop.

### 3.3 Depth-limited and iterative-deepening DFS

If you only want paths up to length `L`, a **depth-limited DFS** caps the stack at `L`. **Iterative deepening** (DFS with increasing depth caps) gives BFS-like shortest-path behavior with DFS's `O(L)` memory — occasionally useful when the grid is huge and you want the shortest path without BFS's `O(N)` frontier memory, accepting repeated work.

### 3.4 Worked iterative-DFS trace

The trickiest part of the iterative rewrite is reproducing the un-mark at the right moment. Here is a trace on the open `2 × 2` maze (move order D, L, R, U; each frame carries the next direction index `di`):

```
push (0,0,di=0); mark (0,0)
top=(0,0,0): try D -> (1,0) valid; mark; push (1,0,0); top now (1,0,0); parent di=1
top=(1,0,0): try D -> (2,0) oob; di=1
top=(1,0,1): try L -> (1,-1) oob; di=2
top=(1,0,2): try R -> (1,1) valid; mark; push (1,1,0)
top=(1,1,0): GOAL -> emit path (0,0)->(1,0)->(1,1) = "DR"
```

The un-mark fires only when a frame is finally **popped** with `di == 4` (all directions exhausted) — that is the iterative analogue of the recursive `unmark` after the `for` loop. Tie the un-mark to the pop and the iterative version is behaviorally identical to the recursive one, but immune to the call-stack limit. This is the safe rewrite for `1000 × 1000` grids where recursion would overflow.

---

## 4. Memoization: Where It Helps and Where It Cannot

A frequent senior trap: "backtracking is slow, let me add memoization." Whether that works depends entirely on the **state**.

### 4.1 Why naive memoization fails for simple-path enumeration

The state of the search is `(current cell, visited set)`. The visited set has `2^N` possibilities, so memoizing on the full state is useless (no reuse, exponential memory). **You cannot memoize away the exponential of simple-path enumeration** — the visited-set dependence is exactly what makes it hard (the same #P-hardness boundary as walk-vs-simple-path counting).

### 4.2 Where memoization *does* work

- **Monotone movement (Down/Right only):** there is no visited set — you can never revisit because you only move forward/down. The state collapses to `(r, c)` and the path *count* memoizes perfectly: `dp[r][c]`, `O(N)`. This is the unobstructed-grid DP.
- **Restricted move-sets that forbid revisits structurally:** any movement DAG (no cycles possible) lets you drop the visited set and memoize on the cell. Counting paths in a DAG is `O(V + E)`.
- **Fixed-length walk counting (revisits allowed):** if the problem counts *walks* (repeats permitted) of a fixed length, that is matrix exponentiation / layered DP, not backtracking — and it is polynomial. See the sibling `paths-fixed-length` topic.

### 4.3 The decision rule

Ask: *can a cell ever be revisited on a valid path?* If **no** (monotone / DAG), drop the visited set and memoize → polynomial. If **yes** (general 4-direction simple paths), the visited set is load-bearing and memoization cannot save you → exponential, lean on pruning instead.

### 4.4 The seductive wrong memoization

A concrete trap worth seeing: someone writes `cache[(r, c)] = count_paths_from(r, c)` for a 4-direction maze and gets *wrong* (usually too-large) counts. Why? The number of paths from `(r, c)` to the goal depends on *which cells are already on the trail* — a cell reachable on one trail may be blocked (already visited) on another. Caching by `(r, c)` alone conflates these incompatible contexts. The only correct cache key is `(r, c, visited_set)`, which has `2^N` values and reuses nothing. The lesson: before adding a cache, prove the state is fully captured by the key. For simple-path enumeration it never is (unless the movement is acyclic), and the cache silently corrupts the answer rather than just slowing things down.

### 4.5 The Held-Karp alternative for small grids

When you genuinely need a length-`k` or Hamiltonian simple-path count on a small grid (`N ≲ 20`), the principled exact method is the Bellman-Held-Karp subset DP: `dp[S][v]` = number of simple paths visiting exactly cell-set `S` ending at `v`. It is `O(2^N · N²)` time, `O(2^N · N)` space — the *visited set made explicit as the DP index*. It is faster than naive backtracking when many subproblems recur, but it is still exponential (and OOM-prone past `N ≈ 22`). It does not change the complexity class; it just trades memory for avoiding recomputation. For the rat's corner-to-corner question this is rarely worth it over pruned backtracking, but it is the right tool for dense small-grid counting.

---

## 5. When to Prefer BFS, Bidirectional BFS, or A*

| Question | Algorithm | Cost | Notes |
|----------|-----------|------|-------|
| Is there a path? | BFS/DFS (permanent visited) | `O(N)` | Never enumerate just to check existence. |
| Shortest path, unit cost | BFS | `O(N)` | First goal-dequeue is optimal. |
| Shortest path, weighted | Dijkstra | `O(E log V)` | Cell/edge weights. |
| Shortest path, with heuristic | A* | `O(E)` typical | Manhattan heuristic on grids is admissible. |
| Shortest, huge grid, single pair | Bidirectional BFS | `~O(b^{d/2})` | Search from both ends, meet in the middle. |
| All paths / constraint paths | DFS backtracking | exponential | The only tool that enumerates. |
| Lexicographically smallest path | DFS backtracking, D,L,R,U | exponential worst case | First found in order. |

### 5.1 The core distinction

**BFS/Dijkstra/A\* find *one optimal* path and mark cells permanently visited** — a cell, once settled at its best distance, is never reconsidered. **Backtracking enumerates *many* paths and un-marks** — a cell lives on countless routes. Confusing the two is the most expensive senior mistake here: using backtracking for shortest path can be exponentially slower and may return a non-optimal route.

### 5.2 A* on grids

For a single shortest path on a large grid, A* with the **Manhattan distance** heuristic (admissible and consistent for 4-direction unit-cost movement; use Chebyshev/octile for 8-direction) dramatically outperforms plain BFS by guiding the frontier toward the goal. This is the production choice for game/robot pathfinding — never a backtracker.

### 5.3 Bidirectional search

When you need the shortest path between a *specific* pair on a very large grid, bidirectional BFS searches from both endpoints and stops when the frontiers meet, cutting the explored area roughly from `b^d` to `2·b^{d/2}`. Backtracking has no analogous win because it is enumerating, not optimizing.

### 5.4 Why permanent visited is safe for optimization but not enumeration

The crux of choosing the right algorithm is the *visited semantics*, and it is worth stating precisely. In BFS/Dijkstra/A*, once a cell is **settled** (dequeued at its optimal distance), reconsidering it can only yield equal-or-worse routes, so permanently marking it loses nothing — that is *why* these algorithms are polynomial. In enumeration, *every* route through a cell matters, not just the cheapest, so a cell cannot be settled; it must be un-marked to re-enable other trails — that is *why* enumeration is exponential. The same `visited` array, two opposite policies. Using permanent-visited for enumeration **loses paths**; using trail-scoped-visited for shortest path is **exponentially slow and may return a non-optimal route**. Diagnosing a maze bug almost always starts with: which visited policy does this code use, and which does the question require?

---

## 6. Pruning at Scale

Pruning does not change the exponential worst case but is the difference between feasible and frozen on real inputs.

### 6.1 Reachability pre-flood (the highest-value prune)

Run an `O(N)` BFS/DFS from the goal (over the same move-set) marking every cell from which the goal is reachable. In the backtracking DFS, abandon any cell not in that set instantly. This eliminates all walled-off pockets and dead branches before the rat wanders into them.

### 6.2 Articulation / connectivity pruning (Hamiltonian-style)

For "visit all open cells" variants, after each move check whether the remaining free space is still **connected** (a quick flood). If the move splits the free region into pieces you cannot all cover, prune. This is the standard prune for "Unique Paths III" and Hamiltonian-grid problems and is enormously effective.

### 6.3 Degree / dead-end pruning

If a non-goal open cell has only one open neighbor (a stub), any path entering it is trapped. Detect degree-1 cells and avoid stepping into stubs that do not contain the goal. Pre-compute degrees, or check on the fly.

### 6.4 Lower-bound (admissible) pruning for bounded length

If the search has a length budget `L`, prune when `steps_so_far + manhattan(cell, goal) > L`. The Manhattan distance is an admissible lower bound on remaining steps, so this never discards a valid completion.

### 6.5 Ordering heuristics

Try the most promising direction first (e.g., toward the goal, or the "Warnsdorff rule" of moving to the lowest-degree neighbor for Hamiltonian tours). Good ordering finds a first solution faster and makes early termination pay off.

### 6.6 Soundness: a prune must never lose a solution

A prune is **sound** if it only abandons branches that provably contain no solution. The reachability, length-bound, and connectivity prunes above are all sound. The danger is an *unsound* prune — one that occasionally skips a branch that did contain a path — because it corrupts the answer *silently*: no crash, no error, just a missing path or an undercount. The most common way to make a sound prune unsound is to compute it with the **wrong move-set**: a 4-direction reachability flood paired with an 8-direction search will mark some genuinely reachable cells as unreachable and lose paths. Rule: the prune's model of "can reach the goal" must match the search's actual movement exactly. When in doubt, verify the pruned search returns the same path *set* (not just count) as the unpruned search on small mazes.

---

## 7. Engineering the Search

### 7.1 State representation

- **Visited matrix vs bitset:** for grids up to `8×8` (≤ 64 cells), pack the visited set into a single `uint64` bitmask — the mark/un-mark becomes a single bit flip and copies are cheap. For larger grids, a flat `bool`/`byte` array indexed `r*m + c` beats a 2D array (no pointer-chasing).
- **In-place marking:** mutate the maze itself (e.g., set a visited cell to a sentinel value) and restore it on backtrack, avoiding a second array — popular in interview solutions but riskier (must restore exactly).

### 7.2 Path representation

Carry a direction string (compact, sorts lexicographically) or a coordinate list (needed if you must render the path). Bracket every push with a pop, exactly parallel to mark/un-mark.

### 7.3 Avoiding per-call allocation

Reuse one visited matrix and one path buffer across the whole search; do not allocate per recursive call. In Go/Java this dodges GC churn; in Python it avoids list-construction overhead in the hot loop.

### 7.4 Streaming output

For "all paths", yield each path to the caller (generator in Python, callback/channel in Go, `Consumer` in Java) instead of building one giant list. The caller can stop early or process incrementally, and memory stays `O(N)`.

### 7.5 Choosing the visited representation: a quick guide

| Grid size | Representation | Un-mark mechanism | Notes |
|-----------|----------------|-------------------|-------|
| `N ≤ 64` | `uint64` bitmask | implicit (pass by value) | fastest; one bit per cell |
| any | flat `bool`/`byte` array, `r*m+c` | explicit `arr[i] = false` | no pointer-chasing; cache-friendly |
| any (interview) | mutate maze in place | restore prior value on exit | one array, but riskier to restore exactly |
| 2D `bool[][]` | classic | explicit | clearest, slightly slower (pointer indirection) |

The bitmask trick is especially elegant: because a primitive is copied by value into each recursive call, the parent's mask is never mutated, so there is *no explicit un-mark at all* — each branch automatically sees its own visited set. This only works while the whole state fits in a machine word (≤ 64 cells), but within that range it is both the fastest and the least bug-prone, since the most error-prone line (the un-mark) disappears.

---

## 8. Code Examples

### 8.1 Go — iterative DFS (no recursion limit) finding one path

```go
package main

import "fmt"

var (
	dr = []int{1, 0, 0, -1} // D, L, R, U
	dc = []int{0, -1, 1, 0}
)

type frame struct {
	r, c, di int
}

func findPathIter(maze [][]int) ([][2]int, bool) {
	n, m := len(maze), len(maze[0])
	if maze[0][0] == 0 || maze[n-1][m-1] == 0 {
		return nil, false
	}
	visited := make([][]bool, n)
	for i := range visited {
		visited[i] = make([]bool, m)
	}
	stack := []frame{{0, 0, 0}}
	visited[0][0] = true
	for len(stack) > 0 {
		top := &stack[len(stack)-1]
		if top.r == n-1 && top.c == m-1 {
			path := make([][2]int, len(stack))
			for i, f := range stack {
				path[i] = [2]int{f.r, f.c}
			}
			return path, true
		}
		if top.di < 4 {
			d := top.di
			top.di++
			nr, nc := top.r+dr[d], top.c+dc[d]
			if nr >= 0 && nr < n && nc >= 0 && nc < m && maze[nr][nc] == 1 && !visited[nr][nc] {
				visited[nr][nc] = true
				stack = append(stack, frame{nr, nc, 0})
			}
		} else {
			visited[top.r][top.c] = false // un-mark on pop (backtrack)
			stack = stack[:len(stack)-1]
		}
	}
	return nil, false
}

func main() {
	maze := [][]int{
		{1, 0, 0, 0},
		{1, 1, 0, 1},
		{1, 1, 0, 0},
		{0, 1, 1, 1},
	}
	if path, ok := findPathIter(maze); ok {
		fmt.Println("path cells:", path)
	} else {
		fmt.Println("no path")
	}
}
```

### 8.2 Java — bitmask visited for small grids + reachability prune

```java
import java.util.*;

public class RatBitmask {
    static final int[] dr = {1, 0, 0, -1};
    static final int[] dc = {0, -1, 1, 0};
    static int n, m;
    static int[][] maze;
    static boolean[][] canReach;
    static int paths;

    static void flood() {
        canReach = new boolean[n][m];
        if (maze[n - 1][m - 1] == 0) return;
        Deque<int[]> q = new ArrayDeque<>();
        q.add(new int[]{n - 1, m - 1});
        canReach[n - 1][m - 1] = true;
        while (!q.isEmpty()) {
            int[] p = q.poll();
            for (int d = 0; d < 4; d++) {
                int nr = p[0] + dr[d], nc = p[1] + dc[d];
                if (nr >= 0 && nr < n && nc >= 0 && nc < m
                        && maze[nr][nc] == 1 && !canReach[nr][nc]) {
                    canReach[nr][nc] = true;
                    q.add(new int[]{nr, nc});
                }
            }
        }
    }

    // visited packed into a long bitmask (requires n*m <= 64)
    static void dfs(int r, int c, long visited) {
        if (r < 0 || r >= n || c < 0 || c >= m) return;
        if (maze[r][c] == 0 || !canReach[r][c]) return;
        int bit = r * m + c;
        if ((visited & (1L << bit)) != 0) return;
        if (r == n - 1 && c == m - 1) { paths++; return; }
        visited |= (1L << bit);                 // mark
        for (int d = 0; d < 4; d++)
            dfs(r + dr[d], c + dc[d], visited);
        // no explicit un-mark: 'visited' is passed by value, so the caller's copy is unchanged
    }

    public static void main(String[] args) {
        maze = new int[][]{
            {1, 0, 0, 0},
            {1, 1, 0, 1},
            {1, 1, 0, 0},
            {0, 1, 1, 1},
        };
        n = maze.length; m = maze[0].length;
        flood();
        if (maze[0][0] == 1) dfs(0, 0, 0L);
        System.out.println("path count: " + paths);
    }
}
```

Note the elegant trick: passing the bitmask **by value** means each branch gets its own copy, so the "un-mark" is implicit — the parent's `visited` is never mutated. This only works when the state fits in a primitive (≤ 64 cells).

### 8.3 Python — streaming all paths with a generator (bounded memory)

```python
import sys

DR = [1, 0, 0, -1]   # D, L, R, U
DC = [0, -1, 1, 0]
DIRS = "DLRU"


def iter_paths(maze):
    """Yield each path string lazily; memory stays O(N) regardless of path count."""
    n, m = len(maze), len(maze[0])
    visited = [[False] * m for _ in range(n)]
    path = []

    def dfs(r, c):
        if r < 0 or r >= n or c < 0 or c >= m:
            return
        if maze[r][c] == 0 or visited[r][c]:
            return
        if r == n - 1 and c == m - 1:
            yield "".join(path)            # stream, do not store
            return
        visited[r][c] = True
        for d in range(4):
            path.append(DIRS[d])
            yield from dfs(r + DR[d], c + DC[d])
            path.pop()
        visited[r][c] = False              # un-mark

    if maze and maze[0][0] == 1:
        yield from dfs(0, 0)


if __name__ == "__main__":
    sys.setrecursionlimit(1_000_000)       # large grids need a higher limit
    maze = [
        [1, 0, 0, 0],
        [1, 1, 0, 1],
        [1, 1, 0, 0],
        [0, 1, 1, 1],
    ]
    for i, p in enumerate(iter_paths(maze)):
        print(p)
        if i >= 4:                         # bound output: stop after a few
            break
```

---

## 9. Observability and Testing

An enumeration result is hard to eyeball — one missing path looks like a complete answer. Build checks from the start.

| Check | Why |
|-------|-----|
| Brute-force oracle on tiny grids | Compare path *set* against a naive all-sequences enumeration for `n,m ≤ 4`. |
| Count vs DP (monotone case) | For Down/Right-only mazes, the count must equal `C(n+m-2, n-1)` minus blocked-path corrections. |
| Reachability cross-check | If the goal is unreachable (flood says so), the path count must be `0`. |
| Round-trip path validity | Replay each returned direction string from start; assert it ends at the goal through open cells with no repeats. |
| Idempotent visited matrix | After the search returns, every `visited[r][c]` must be `false` (all marks un-marked) — a leak signals a missing un-mark. |
| Lexicographic order | For D,L,R,U order, assert the emitted path list is sorted. |
| Determinism across languages | Same maze → identical path set/count in Go, Java, Python. |

The single most valuable test is the **visited-matrix-clean assertion**: if any cell is still marked after the top-level call returns, you forgot an un-mark somewhere — the classic correctness bug, caught automatically.

### 9.1 A property-test battery

```text
for random small maze (n,m <= 5, random walls):
    assert every returned path replays to the goal, open cells only, no repeats
    assert path set == bruteforce_all_paths(maze)
    assert count_paths(maze) == len(path set)
    assert visited matrix is all-false after the call
    if monotone(maze): assert count == dp_count(maze)
    if not reachable(start, goal): assert count == 0
```

### 9.2 Production guardrails

For a service that enumerates routes, add: a **hard cap** on returned paths and on per-search wall-clock (enumeration is exponential — never let it run unbounded); a **reachability pre-check** that returns "no path" in `O(N)` before any deep search; and a **depth limit** so a pathological grid cannot overflow the stack or run forever.

---

## 10. Failure Modes

### 10.1 Missing un-mark

Forgetting `visited[r][c] = false` leaves cells permanently blocked, so the search misses paths (or finds none). Mitigation: the visited-clean assertion (Section 9); bracket mark/un-mark like parentheses.

### 10.2 Stack overflow on deep grids

Recursion depth = path length, up to `N`. Large grids crash. Mitigation: iterative DFS with an explicit stack, raise the recursion limit (Python), or depth-limit the search.

### 10.3 Using backtracking for shortest path

Backtracking may return a long path first and is exponentially slower than BFS for the optimal route. Mitigation: recognize "shortest/cheapest" → BFS/Dijkstra/A*, never backtracking.

### 10.4 Output explosion / OOM

"All paths" on an open grid materializes exponentially many strings. Mitigation: stream (generator/callback), cap the count, or count-only via DP when movement is monotone.

### 10.5 Memoization that does not apply

Adding a `(cell)`-keyed cache to a general 4-direction simple-path search is wrong — the answer depends on the visited set, so the cache returns incorrect counts. Mitigation: only memoize when revisits are structurally impossible (monotone/DAG); otherwise drop the cache.

### 10.6 In-place marking not restored

Mutating the maze to mark visited, then failing to restore the original value on backtrack, corrupts the grid for sibling branches. Mitigation: restore the exact prior value on exit, or use a separate visited array.

### 10.7 Off-by-one between "cells" and "steps"

A path through `k` cells has `k-1` moves. Length constraints stated in *moves* vs *cells* differ by one. Mitigation: pin down whether a "length-L path" means L cells or L moves, and translate explicitly.

### 10.8 Reachability prune with the wrong move-set

If the search allows diagonals but the pre-flood used only 4 directions, the prune wrongly discards reachable cells. Mitigation: compute the prune with the *identical* move-set the search uses.

---

## 11. Summary

- Grid-path backtracking's cost is the **number of paths**, which is exponential — no algorithm enumerates all simple paths in polynomial time. Senior move #1: challenge whether the requirement is one path, all paths, count, or shortest.
- **Recursion depth = path length**, up to `N`. Large grids overflow the stack; convert to **iterative DFS** with an explicit stack (tying un-mark to pop) or depth-limit the search.
- **Memoization cannot remove the exponential** for general simple-path enumeration, because the state includes the visited set. It *does* work when revisits are structurally impossible (monotone Down/Right or any movement DAG), collapsing to `dp[r][c]` in `O(N)`.
- For **optimal single paths** use BFS (unit cost), Dijkstra (weights), A* (heuristic, Manhattan on grids), or bidirectional BFS (large single-pair). These mark cells **permanently**; backtracking un-marks. Never force backtracking into a shortest-path role.
- **Pruning** is the practical lever: an `O(N)` reachability pre-flood from the goal, connectivity/articulation prunes for "visit-all" variants, dead-end pruning, and admissible Manhattan lower bounds for bounded-length searches.
- **Engineer the state**: bitmask visited for grids ≤ 64 cells (pass by value for implicit un-mark), flat arrays otherwise, reused buffers, and streamed output to keep memory `O(N)`.
- **Test the enumeration**: brute-force oracle on tiny grids, path-replay validity, the visited-matrix-clean assertion (catches missing un-marks), monotone-count vs `C(n+m-2,n-1)`, and cross-language determinism.

### Decision summary

- **One path / feasibility** → DFS or BFS, permanent visited, `O(N)`.
- **Shortest path** → BFS / Dijkstra / A* / bidirectional — never backtracking.
- **All paths / constraint paths / lexicographically smallest** → DFS backtracking, with pruning and bounded output.
- **Count paths, monotone movement** → DP `O(N)`, not backtracking.
- **Count paths, free movement** → backtracking, exponential, lean on pruning.
- **Large grid, deep paths** → iterative DFS or depth limit to protect the stack.
- **Small grid, dense counting (length-k / Hamiltonian)** → Held-Karp subset DP (`O(2^N N²)`), still exponential but recomputation-free.
- **Visited representation** → bitmask (≤ 64 cells, implicit un-mark) or flat array (larger), never per-call allocation.

### Production checklist

```text
[ ] Confirmed: optimize-one vs enumerate-many? (decision 1)
[ ] Confirmed: cyclic vs acyclic movement?      (decision 2)
[ ] If enumerate: output bounded (top-K / stream), not materialized
[ ] If deep grid: iterative DFS or raised recursion limit
[ ] Reachability pre-flood prune, computed with the SAME move-set
[ ] No (r,c)-only cache on a cyclic search
[ ] Tests: brute-force oracle, path-replay validity, visited-all-false
[ ] Hard caps on path count and wall-clock for the service path
```

Run this list before shipping any maze search; each item maps to a failure mode in Section 10.

References to study further: A* and admissible heuristics (Hart-Nilsson-Raphael), bidirectional search, the Warnsdorff heuristic for Hamiltonian grid tours, connectivity pruning for "Unique Paths III", iterative deepening DFS, the Bellman-Held-Karp subset DP, and the sibling topics on BFS shortest path (`11-graphs`) and fixed-length walk counting (`paths-fixed-length`).
