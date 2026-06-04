# Rat in a Maze (Grid Path Backtracking) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the visited-matrix backtracking logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small mazes, and assert the visited matrix is all-false after the search (a leftover mark proves a missing un-mark).**

---

## Beginner Tasks (5)

### Task 1 — Validity check and one DFS step

**Problem.** Implement `canMove(maze, visited, r, c)` returning `true` iff `(r, c)` is in bounds, the cell is open (`maze[r][c] == 1`), and it is not visited. This is the gate every recursive call passes through.

**Input / Output spec.**
- Read `n`, `m`, then the maze (`n` rows of `m` ints), then a query `(r, c)`.
- Print `true` or `false`.

**Constraints.**
- `1 ≤ n, m ≤ 100`, cells are `0` or `1`.
- Bounds must be checked **before** indexing the maze.

**Hint.** Order the checks: bounds first, then `maze[r][c] == 1`, then `!visited[r][c]`.

**Starter — Go.**
```go
package main

import "fmt"

func canMove(maze [][]int, visited [][]bool, r, c int) bool {
	// TODO: bounds first, then open, then not visited
	return false
}

func main() {
	var n, m int
	fmt.Scan(&n, &m)
	maze := make([][]int, n)
	for i := range maze {
		maze[i] = make([]int, m)
		for j := range maze[i] {
			fmt.Scan(&maze[i][j])
		}
	}
	var r, c int
	fmt.Scan(&r, &c)
	visited := make([][]bool, n)
	for i := range visited {
		visited[i] = make([]bool, m)
	}
	fmt.Println(canMove(maze, visited, r, c))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean canMove(int[][] maze, boolean[][] visited, int r, int c) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt();
        int[][] maze = new int[n][m];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < m; j++) maze[i][j] = sc.nextInt();
        int r = sc.nextInt(), c = sc.nextInt();
        System.out.println(canMove(maze, new boolean[n][m], r, c));
    }
}
```

**Starter — Python.**
```python
import sys


def can_move(maze, visited, r, c):
    # TODO: bounds first, then open, then not visited
    return False


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    maze = [[int(next(data)) for _ in range(m)] for _ in range(n)]
    r, c = int(next(data)), int(next(data))
    visited = [[False] * m for _ in range(n)]
    print(str(can_move(maze, visited, r, c)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `false` for out-of-bounds coordinates without crashing.
- Returns `false` for blocked or visited cells.
- Bounds checked before indexing.

---

### Task 2 — Does a path exist?

**Problem.** Given a maze (`1`=open, `0`=wall), return `true` iff there is a path from `(0,0)` to `(n-1,m-1)` using D/L/R/U moves. Use DFS backtracking with a visited matrix.

**Input / Output spec.**
- Read `n`, `m`, then the maze.
- Print `true` or `false`.

**Constraints.** `1 ≤ n, m ≤ 30`.

**Hint.** Return `true` on reaching the goal; mark/un-mark with the visited matrix. Handle a blocked start/goal first.

**Reference oracle (Python) — use this to validate.**
```python
from collections import deque


def reachable(maze):
    n, m = len(maze), len(maze[0])
    if maze[0][0] == 0 or maze[n - 1][m - 1] == 0:
        return False
    seen = [[False] * m for _ in range(n)]
    q = deque([(0, 0)])
    seen[0][0] = True
    while q:
        r, c = q.popleft()
        if (r, c) == (n - 1, m - 1):
            return True
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < m and maze[nr][nc] == 1 and not seen[nr][nc]:
                seen[nr][nc] = True
                q.append((nr, nc))
    return False
```

**Evaluation criteria.**
- Agrees with `reachable` (BFS) on random mazes.
- Handles blocked start/goal → `false`.
- Visited matrix all-false after the call.

---

### Task 3 — Find and print one path (direction string)

**Problem.** Given a maze, print one path from `(0,0)` to `(n-1,m-1)` as a string of D/L/R/U letters, or `NO PATH`. Try directions in D,L,R,U order so the output is the lexicographically smallest path.

**Input / Output spec.**
- Read `n`, `m`, then the maze.
- Print the path string or `NO PATH`.

**Constraints.** `1 ≤ n, m ≤ 20`.

**Hint.** Append the direction letter before recursing, pop after; return `true` on first success and keep that cell marked.

**Worked check.** For `maze = [[1,1],[1,1]]` the smallest path is `DR`. For `maze = [[1,0],[0,1]]` the answer is `NO PATH`.

**Evaluation criteria.**
- Output equals the lexicographically smallest path (D,L,R,U order).
- `NO PATH` when start/goal blocked or unreachable.
- Replaying the path lands on the goal through open cells.

---

### Task 4 — Count all paths

**Problem.** Given a maze, count all simple paths from `(0,0)` to `(n-1,m-1)` with D/L/R/U moves. Use backtracking with a counter (do not store the strings).

**Input / Output spec.**
- Read `n`, `m`, then the maze.
- Print the integer count.

**Constraints.** `1 ≤ n, m ≤ 6` (free movement; the count is exponential).

**Hint.** Increment at the goal and return; always un-mark. Use 64-bit for the count.

**Worked check.** For a fully open `2×2` maze, the count of simple paths is `2` (`DR`, `RD`). For a fully open `3×3` maze with 4-direction movement, the count is `12`.

**Evaluation criteria.**
- Matches a brute-force enumeration for small mazes.
- Counts simple paths (no repeated cell), not walks.
- Visited matrix all-false after the call.

---

### Task 5 — Monotone path count (Down/Right only) via DP

**Problem.** Given a maze, count paths from `(0,0)` to `(n-1,m-1)` using **only Down and Right** moves. Use the `O(N)` DP `dp[r][c] = dp[r-1][c] + dp[r][c-1]` (zero for blocked cells), not backtracking.

**Input / Output spec.**
- Read `n`, `m`, then the maze.
- Print the count.

**Constraints.** `1 ≤ n, m ≤ 1000`.

**Hint.** `dp[0][0] = 1` if open. For an unobstructed grid, the answer equals `C(n+m-2, n-1)` — verify against that.

**Evaluation criteria.**
- Unobstructed grid matches `C(n+m-2, n-1)`.
- Blocked cells contribute `0`.
- Runs in `O(N)` (handles `1000×1000`).

---

## Intermediate Tasks (5)

### Task 6 — All paths in lexicographic order

**Problem.** Given a maze, return all paths from `(0,0)` to `(n-1,m-1)` as direction strings, sorted lexicographically. Use D,L,R,U order so they come out sorted with no extra sort step.

**Constraints.** `1 ≤ n, m ≤ 7`.

**Hint.** Never stop early; record each path at the goal; always un-mark. Assert the output list is already sorted.

**Reference oracle (Python).**
```python
def brute_all_paths(maze):
    n, m = len(maze), len(maze[0])
    res = []
    vis = [[False] * m for _ in range(n)]

    def dfs(r, c, path):
        if not (0 <= r < n and 0 <= c < m) or maze[r][c] == 0 or vis[r][c]:
            return
        if (r, c) == (n - 1, m - 1):
            res.append("".join(path)); return
        vis[r][c] = True
        for d, (dr, dc) in zip("DLRU", ((1, 0), (0, -1), (0, 1), (-1, 0))):
            path.append(d); dfs(r + dr, c + dc, path); path.pop()
        vis[r][c] = False

    if maze[0][0] == 1:
        dfs(0, 0, [])
    return res
```

**Evaluation criteria.**
- Output equals `brute_all_paths` and is already sorted.
- Always un-marks (verify visited all-false after).
- Matches the count from Task 4.

---

### Task 7 — Path with diagonal moves (8 directions)

**Problem.** Given a maze, find one path from `(0,0)` to `(n-1,m-1)` allowing all 8 moves (4 orthogonal + 4 diagonal). Return the move sequence or `NO PATH`.

**Constraints.** `1 ≤ n, m ≤ 15`.

**Hint.** Extend the move list to 8 offsets: `(+1,0),(0,-1),(0,+1),(-1,0),(+1,-1),(+1,+1),(-1,-1),(-1,+1)`. The mark/un-mark logic is unchanged. Choose a clear letter encoding for the diagonals.

**Evaluation criteria.**
- Uses 8 moves; reaches the goal through open cells.
- Replaying the moves is valid (in-bounds, open, no repeat).
- Returns `NO PATH` when unreachable even with diagonals.

---

### Task 8 — Reachability-pruned all-paths

**Problem.** Given a maze, enumerate all paths but first compute (via a reverse BFS flood from the goal) which cells can reach the goal, and prune any cell that cannot. Confirm the result equals the unpruned enumeration but is faster on walled mazes.

**Constraints.** `1 ≤ n, m ≤ 8`.

**Hint.** Flood from `(n-1,m-1)` over the same move-set, marking `canReach`. In the DFS, return immediately if `!canReach[r][c]`. Use the *same* move-set for the flood and the search.

**Evaluation criteria.**
- Path set identical to the unpruned all-paths (Task 6).
- Walled-off pockets are never entered.
- Flood is `O(N)`.

---

### Task 9 — Lexicographically smallest path with early stop

**Problem.** Return only the lexicographically smallest path (D,L,R,U), stopping at the first complete path found, or `NO PATH`. Prove (by construction) that early termination is correct.

**Constraints.** `1 ≤ n, m ≤ 20`.

**Hint.** Because D,L,R,U is alphabetical and DFS is pre-order, the first path found is the global minimum — return immediately. Do not collect all paths.

**Evaluation criteria.**
- Output equals `min(all_paths(maze))` but computed without enumerating all.
- Returns on first success (no full enumeration).
- `NO PATH` when unreachable.

---

### Task 10 — Iterative DFS (no recursion)

**Problem.** Find one path from `(0,0)` to `(n-1,m-1)` using an **iterative** DFS with an explicit stack (no recursion), so the search survives very deep grids. Tie the un-mark to the stack pop.

**Constraints.** `1 ≤ n, m ≤ 1000` (deep paths possible).

**Hint.** Each stack frame stores `(r, c, nextDirIndex)`. Mark on push, un-mark on pop. Advance `nextDirIndex` each time you try a direction.

**Reference oracle (Python) — recursive version to compare against on small mazes.**
```python
def recursive_one_path(maze):
    n, m = len(maze), len(maze[0])
    vis = [[False] * m for _ in range(n)]
    path = []

    def dfs(r, c):
        if not (0 <= r < n and 0 <= c < m) or maze[r][c] == 0 or vis[r][c]:
            return False
        path.append((r, c)); vis[r][c] = True
        if (r, c) == (n - 1, m - 1):
            return True
        for dr, dc in ((1, 0), (0, -1), (0, 1), (-1, 0)):
            if dfs(r + dr, c + dc):
                return True
        path.pop(); vis[r][c] = False
        return False

    return path if maze[0][0] == 1 and dfs(0, 0) else None
```

**Evaluation criteria.**
- Returns a valid path (or none) matching the recursive version on small mazes.
- No recursion; works on a `1000×1` corridor without stack overflow.
- Un-mark correctly tied to pop.

---

## Advanced Tasks (5)

### Task 11 — Bitmask visited for small grids

**Problem.** For mazes with `n·m ≤ 64`, count all paths using a single `uint64`/`long` bitmask for the visited set instead of a 2D array. Pass the bitmask by value so the un-mark is implicit.

**Constraints.** `n·m ≤ 64`, free 4-direction movement.

**Hint.** Cell `(r, c)` maps to bit `r*m + c`. Set the bit on entry; because the bitmask is passed by value, each branch has its own copy and the parent is unchanged (no explicit un-mark needed).

**Evaluation criteria.**
- Count matches the array-based backtracking (Task 4) for all small mazes.
- Uses a single integer for visited; correct bit indexing.
- No explicit un-mark (relies on by-value copy).

---

### Task 12 — Visit every open cell (Unique Paths III)

**Problem.** Given a maze where some cells are open, count paths from `(0,0)` to `(n-1,m-1)` that visit **every** open cell exactly once (a Hamiltonian path over open cells). Use backtracking with a remaining-open-cells counter.

**Constraints.** `1 ≤ n, m ≤ 5` (Hamiltonian; small only).

**Hint.** Count the open cells up front. Succeed only when you reach the goal *and* all open cells have been visited. Optional: add connectivity pruning (abandon when the remaining free cells become disconnected).

**Worked check.** This is LeetCode "Unique Paths III"; verify against its known small examples.

**Evaluation criteria.**
- Counts only paths that cover all open cells and end at the goal.
- Matches brute force on small mazes.
- Documents the Hamiltonian (NP-hard) nature in a comment.

---

### Task 13 — Jump maze

**Problem.** Each open cell holds a positive integer `j = maze[r][c]`. From `(r, c)` the rat may jump exactly `j` cells in any of the 4 directions (landing cell must be in-bounds and not blocked/visited). Find one path from `(0,0)` to `(n-1,m-1)` or report `NO PATH`.

**Constraints.** `1 ≤ n, m ≤ 50`, `1 ≤ maze[r][c] ≤ max(n,m)`; blocked cells are `0`.

**Hint.** `next = (r + dr*j, c + dc*j)`. The template is unchanged; only the step size depends on the current cell's value. Bounds-check the *landing* cell.

**Evaluation criteria.**
- Correct jump distance per cell.
- Landing cells validated (in-bounds, open, unvisited).
- `NO PATH` when no jump sequence reaches the goal.

---

### Task 14 — Backtracking vs BFS shortest-path comparison

**Problem.** On the same maze, implement (a) backtracking that returns *a* path, and (b) BFS that returns the *shortest* path length. Show on a crafted maze that backtracking's first path is longer than BFS's shortest, demonstrating why backtracking is wrong for shortest-path.

**Constraints.** `1 ≤ n, m ≤ 30`.

**Hint.** Construct a maze with a long detour reachable early in D,L,R,U order and a short route reachable later. Print both path lengths.

**Reference oracle (Python) — BFS shortest length.**
```python
from collections import deque


def bfs_shortest_len(maze):
    n, m = len(maze), len(maze[0])
    if maze[0][0] == 0 or maze[n - 1][m - 1] == 0:
        return -1
    dist = [[-1] * m for _ in range(n)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        if (r, c) == (n - 1, m - 1):
            return dist[r][c]
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < m and maze[nr][nc] == 1 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return -1
```

**Evaluation criteria.**
- BFS returns the provably minimal move count.
- On the crafted maze, backtracking's first path length > BFS length.
- Writeup explains permanent-visited (BFS) vs trail-scoped-visited (backtracking).

---

### Task 15 — Decide the right tool for a maze problem

**Problem.** Implement `classify(n, m, query_type, movement)` returning one of `BACKTRACKING`, `BFS`, `DIJKSTRA`, `DP_MONOTONE`, or `INTRACTABLE`, with justification. Encode the decision rules from `middle.md`, `senior.md`, and `professional.md`.

**Constraints / cases to handle.**
- All paths / smallest path / constraint path → `BACKTRACKING`.
- Shortest path, unit cost → `BFS`.
- Shortest path, weighted cells → `DIJKSTRA`.
- Count paths, Down/Right only → `DP_MONOTONE` (`O(N)`).
- Count simple paths, free movement, large grid → `INTRACTABLE` (#P-hard / exponential output).

**Hint.** The trap is counting simple paths under free movement on a large grid — it is #P-hard, so there is no polynomial method; enumeration is exponential.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INTRACTABLE` branch cites #P-hardness / the exponential output bound.
- Justification references the right complexity (`O(N)`, `O(E log V)`, exponential).

---

## Benchmark Task

### Task B — Pruning impact on enumeration time

**Problem.** Empirically measure how much the reachability pre-flood prune speeds up all-paths enumeration on walled mazes. Implement two versions:

- **(a) Naive backtracking:** enumerate all paths with no pruning.
- **(b) Pruned backtracking:** pre-flood from the goal, skip cells that cannot reach it.

Run both on random mazes of size `V × V` with a tunable wall density, fixed seed, and report the speedup.

**Starter — Python.**
```python
import random
import time
from typing import List

DR = [1, 0, 0, -1]
DC = [0, -1, 1, 0]


def gen_maze(v: int, density: float, seed: int) -> List[List[int]]:
    rnd = random.Random(seed)
    maze = [[1 if rnd.random() > density else 0 for _ in range(v)] for _ in range(v)]
    maze[0][0] = 1
    maze[v - 1][v - 1] = 1
    return maze


def count_naive(maze) -> int:
    # TODO: backtracking all-paths count, no pruning
    return 0


def mark_reachable(maze):
    # TODO: reverse BFS flood from goal; return canReach matrix
    return [[True] * len(maze[0]) for _ in range(len(maze))]


def count_pruned(maze) -> int:
    # TODO: same as count_naive but skip cells not in canReach
    return 0


def bench(fn, maze) -> float:
    start = time.perf_counter()
    fn(maze)
    return time.perf_counter() - start


def main() -> None:
    print("V   density   naive_ms   pruned_ms   speedup")
    for v in [6, 7, 8]:
        for density in [0.2, 0.35]:
            maze = gen_maze(v, density, 42)
            tn = bench(count_naive, maze) * 1000
            tp = bench(count_pruned, maze) * 1000
            sp = (tn / tp) if tp > 0 else float("inf")
            print(f"{v:<3d} {density:<8.2f} {tn:<10.2f} {tp:<10.2f} {sp:<.2f}x")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same maze across Go, Java, and Python.
- Both versions return the **same** path count (prune is sound).
- Pruned version is faster on walled mazes; report the measured speedup.
- Writeup notes that pruning does not change the exponential worst case — it improves typical time only.

---

## General Guidance for All Tasks

- **Always validate against the brute-force / BFS oracle first.** Many tasks ship with one. Run on small mazes, diff results, then trust the optimized version.
- **Assert the visited matrix is all-false after the search.** A leftover mark proves a missing un-mark — the single most common correctness bug.
- **Pair every mark with an un-mark**, bracketed exactly with the path push/pop.
- **Use D,L,R,U order** whenever lexicographically smallest output is required; otherwise any order works.
- **Count edges (moves), not cells**: a `k`-cell path has `k-1` moves. Translate "length" carefully.
- **Reach for BFS for shortest path, DP for monotone counting** — do not force backtracking into those roles.
- **Reuse the `dfs` / `multiply`-style helpers**: write the template once, test it hard, and vary only the success handler and move-set.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
