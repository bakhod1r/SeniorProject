# Rat in a Maze (Grid Path Backtracking) — Interview Preparation

Rat in a Maze is a favourite interview problem because it tests one crisp template — *mark → recurse over directions → un-mark* — and then probes whether you can (a) adapt it for one path, all paths, counting, and the lexicographically smallest path; (b) reconstruct and print the route; (c) recognize when the question is really a **shortest-path** problem (BFS, not backtracking); and (d) prune so the exponential search finishes. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is there a path? | DFS/BFS with visited | `O(N)` |
| One path (any) | DFS backtracking, return bool | exponential worst case |
| Lexicographically smallest path | DFS backtracking, **D,L,R,U** order | exponential worst case |
| All paths | DFS backtracking, never stop early | `O(4^N + output)` |
| Count paths (free movement) | DFS backtracking, counter | `O(4^N)` |
| Count paths (monotone D/R) | DP `dp[r][c]=dp[r-1][c]+dp[r][c-1]` | `O(N)` |
| **Shortest** path (fewest moves) | **BFS** (not backtracking) | `O(N)` |
| Path with obstacles | same template; walls are blocked cells | exponential worst case |

The visited-matrix backtracking template (memorize this):

```text
dfs(r, c):
    if out of bounds or blocked or visited[r][c]: return
    if (r, c) is goal: handle success; return
    visited[r][c] = true          # mark
    for (dr, dc) in directions:   # D,L,R,U for lexicographic order
        dfs(r + dr, c + dc)
    visited[r][c] = false         # UN-mark (the backtrack step)
```

Direction table (alphabetical → sorted output):

```text
dir  letter  (dr, dc)
Down  D       (+1,  0)
Left  L       ( 0, -1)
Right R       ( 0, +1)
Up    U       (-1,  0)
```

Key facts:
- **Length = moves**, not cells: a path of `k` cells has `k-1` moves.
- The **un-mark** is mandatory; omitting it makes the search miss paths.
- Backtracking enumerates paths and handles constraints; **BFS** finds the shortest.
- Counting simple paths in free movement is **#P-hard** — the search is exponential.

---

## Junior Questions (12 Q&A)

### J1. What is the Rat in a Maze problem?
A rat starts at the top-left cell of a grid and must reach the bottom-right cell, moving only through open (passable) cells. The task is to find a path — or all paths — using backtracking.

### J2. What is backtracking here?
DFS plus an *undo* step. You try a direction, mark the cell as visited, recurse; if it dead-ends you **un-mark** the cell and try the next direction. The undo is what makes it backtracking.

### J3. Why do we need a visited matrix?
To avoid stepping onto a cell already on the current path, which would let the rat loop forever. The visited matrix records the cells on the current trail.

### J4. What is the un-mark (backtrack) step and why does it matter?
After trying all directions from a cell without success, set `visited[r][c] = false`. This frees the cell so a *different* path may use it. Forgetting it is the most common bug and causes the search to miss valid paths.

### J5. What directions can the rat move?
In the classic version, four: Down, Left, Right, Up — offsets `(+1,0), (0,-1), (0,+1), (-1,0)`. Variants add diagonals or jumps.

### J6. How do you find just one path?
Return a boolean. On reaching the goal, return `true` and propagate it up, stopping the search immediately — no need to explore other directions.

### J7. How do you find all paths?
Never stop early. On reaching the goal, record the current path, then keep searching, and **always** un-mark on the way out so every route is explored.

### J8. What does "length" mean for a path?
The number of moves (edges). A path passing through `k` cells has `k-1` moves. Be careful when a problem says "length" — clarify cells vs moves.

### J9. How do you get the lexicographically smallest path?
Try directions in alphabetical order **D, L, R, U** and look for one path. The first complete path discovered is automatically the smallest.

### J10. What's the time complexity?
Exponential in the worst case (`O(4^N)` for `N` cells), because the number of paths can be exponential. The extra space is `O(N)` for the visited matrix and recursion.

### J11. Why is bounds-checking done first?
You must confirm `(r, c)` is inside the grid before reading `maze[r][c]`, otherwise you index out of bounds and crash.

### J12 (analysis). Should you use backtracking for the shortest path?
No. DFS can find a long path first. For the fewest-moves path, use **BFS**, which explores by distance layers and finds the shortest first.

---

## Middle Questions (12 Q&A)

### M1. Walk me through the difference between one path, all paths, and counting.
Same DFS skeleton. One path: return `true` on first success and stop. All paths: never stop, record each success, always un-mark. Counting: increment a counter at the goal instead of storing strings (saves memory).

### M2. Why does D,L,R,U order produce sorted output?
DFS in a fixed alphabetical move order is a pre-order traversal of the path-string trie, which visits strings in dictionary order. So paths are generated sorted, and the first is the smallest.

### M3. When does the lexicographic guarantee break?
If the move order is not alphabetical, or if "smallest" means fewest moves (that's shortest path — use BFS), or if diagonal/jump letters aren't ordered. Clarify the definition.

### M4. How do you handle a maze with obstacles?
Obstacles are just blocked cells (value 0). The template is unchanged: the validity check `open and in-bounds and not visited` skips them automatically.

### M5. How would you support diagonal moves?
Extend the move list from 4 to 8 offsets (add `(±1,±1)`). The mark/recurse/un-mark logic is identical — the engine is move-set-agnostic.

### M6. How does counting differ for monotone (Down/Right only) movement?
Monotone movement can never revisit a cell, so you drop the visited set and use DP: `dp[r][c] = dp[r-1][c] + dp[r][c-1]`, `O(N)`. No backtracking needed. Unobstructed, the count is `C(n+m-2, n-1)`.

### M7. What's the single most common bug?
Forgetting the un-mark. It leaves cells permanently marked, so sibling branches skip them and the search misses paths (or finds none).

### M8. How do you prune the search?
Pre-flood from the goal (an `O(N)` BFS) to mark cells that can reach the goal; abandon any cell not in that set. This kills walled-off pockets instantly.

### M9. How do you reconstruct and print the path?
Carry a direction string (append a letter before each recursive call, pop it after) or a coordinate list (push/pop cells). Bracket push/pop with mark/un-mark exactly.

### M10. Why can't backtracking find the shortest path efficiently?
DFS commits to one direction and goes deep; it has no notion of "closest first." BFS expands by distance, so the first time it reaches the goal is provably shortest.

### M11. How do you avoid stack overflow on large grids?
Recursion depth equals path length, up to `N`. Convert to iterative DFS with an explicit stack (tie un-mark to pop), or raise the recursion limit / depth-limit the search.

### M12 (analysis). Why is counting simple paths hard but counting monotone paths easy?
Free movement requires tracking the visited set (`2^N` states) — counting simple paths is #P-hard. Monotone movement is acyclic, so the visited set is vacuous and a linear DP works.

---

## Senior Questions (10 Q&A)

### S1. How do you decide between backtracking and BFS/Dijkstra/A* for a maze?
If you need **all** paths, **constraint** paths, or the **lexicographically smallest** path → backtracking. If you need the **shortest** path → BFS (unit cost), Dijkstra (weights), or A* (heuristic). Feasibility ("is there a path?") → either, but use a permanent-visited BFS/DFS, never enumeration.

### S2. Can memoization speed up simple-path enumeration?
No, in general. The state includes the visited set (`2^N` possibilities), so a cell-keyed cache is incorrect. Memoization only works when revisits are structurally impossible (monotone/DAG), where it collapses to `dp[r][c]`, `O(N)`.

### S3. How do you handle very deep grids without crashing?
Iterative DFS with an explicit stack removes the recursion-depth limit; un-mark on pop. Alternatively depth-limit or use iterative deepening. Python especially needs `setrecursionlimit` raised or an iterative rewrite.

### S4. What pruning matters most in production?
The `O(N)` reachability pre-flood from the goal (highest value). Then connectivity/articulation pruning for "visit-all" variants, dead-end pruning, and admissible Manhattan length bounds for bounded-length searches. None change the exponential worst case but transform typical runtime.

### S5. How do you keep "all paths" from running out of memory?
Stream paths (generator/callback/channel) instead of materializing a giant list; cap the number returned; or count-only via DP when movement is monotone. Materializing all paths of a 20×20 grid will OOM.

### S6. How would you represent visited for a small grid efficiently?
For `n·m ≤ 64`, pack the visited set into a `uint64` bitmask; mark/un-mark is a single bit flip, and passing it by value gives an implicit un-mark per branch. For larger grids, a flat array indexed `r*m+c` beats a 2D array.

### S7. How do you verify an enumeration whose output is too large to inspect?
Brute-force oracle on tiny grids (compare path sets); replay each returned direction string and assert it ends at the goal through open cells with no repeats; assert the visited matrix is all-false after the call (catches missing un-marks); for monotone mazes, compare the count to the DP / `C(n+m-2,n-1)`.

### S8. A* vs BFS on a large grid — when and why?
For a single shortest path on a large grid, A* with the Manhattan heuristic (admissible for 4-direction unit cost) guides the frontier toward the goal and explores far fewer cells than plain BFS. Use bidirectional BFS for a specific pair on a very large grid.

### S9. How do you adapt the template to "visit every open cell exactly once"?
This is a Hamiltonian-path variant. Track the count of visited open cells; succeed only when you reach the goal *and* all open cells are visited. Add connectivity pruning (abandon when remaining free cells become disconnected) — this is "Unique Paths III".

### S10 (analysis). Why is the visited matrix exactly the recursion stack?
By induction: marking happens on entry (push) and un-marking on exit (pop), so the marked set always equals the cells on the current stack. This invariant is what enforces simple paths and why the post-run matrix is all-false; a leftover mark proves a missing un-mark.

---

## Professional Questions (8 Q&A)

### P1. Design a service that returns route options between two points on a fixed warehouse grid.
Pre-flood reachability once per grid (`O(N)`). For "give me some routes", run bounded backtracking that streams the first `K` paths and stops; cap wall-clock. For "the shortest route", run A* with Manhattan heuristic — separate endpoint, never the backtracker. Cache the static grid's reachability map; invalidate on layout change.

### P2. The grid is 1000×1000 and "all paths" is requested. What do you tell the stakeholder?
That "all paths" is exponential and infeasible by definition — the *number* of paths is astronomically large. Reframe: do they want one path, the shortest path, a count (only tractable for monotone movement via DP), or the top-K paths? Offer the feasible variant.

### P3. How do you count paths when movement is restricted to Down/Right with obstacles?
`O(N)` DP: `dp[r][c] = dp[r-1][c] + dp[r][c-1]`, with `dp[r][c] = 0` for blocked cells. This is "Unique Paths II". No backtracking — monotone movement is acyclic, so the visited set is unnecessary.

### P4. How do you debug "the search misses some paths" in production?
Run the brute-force oracle on the exact small input and diff path sets. Check the un-mark (the usual culprit) via the visited-clean assertion. Verify the move-set and that pruning uses the *same* move-set. Confirm start/goal are open and the bounds check precedes the cell read.

### P5. When is min-moves the wrong objective for a maze feature?
When cells have weights (different traversal costs) — then it's Dijkstra, not BFS. When you need *all* routes for the user to choose — then it's enumeration. State whether the objective is min-moves, min-cost, or enumerate, and pick BFS/Dijkstra/backtracking accordingly.

### P6. How would you parallelize a large enumeration?
Split the search by the first move: each top-level direction is an independent subtree explored by a worker. Merge results (or counts). The reachability pre-flood is shared read-only. Note this does not beat the exponential — it only spreads the constant factor.

### P7. How do diagonals or jumps change correctness and counting?
Correctness is unchanged — the backtracking proof holds for any finite move-set. Counting changes: monotone+diagonal gives Delannoy numbers (still DAG, `O(N)` DP); free 8-direction is #P-hard simple-path counting, exponential.

### P8 (analysis). Why is simple-path counting #P-hard but shortest path polynomial?
Shortest path optimizes *one* path and marks cells permanently visited (settled once) → polynomial. Counting simple paths requires the visited-set state (`2^N`), which is #P-hard (Hamiltonian-path counting is #P-complete). The trail-scoped visited that makes enumeration correct is the non-local state that makes it hard.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used backtracking and it blew up.
Look for a concrete story: an enumeration on a larger-than-expected input, a profile showing exponential growth, and the fix — pruning (reachability pre-flood), bounding output, or recognizing the real question was shortest path (switch to BFS). Strong answers mention the brute-force oracle used to validate before scaling.

### B2. A teammate used DFS backtracking to find the shortest maze path. How do you respond?
Explain calmly that DFS may find a long path first and has no "closest first" guarantee; BFS expands by distance and finds the shortest. Give a tiny example where DFS returns a winding route. Frame it as the optimize-vs-enumerate distinction, a teaching moment.

### B3. Design a robot navigation feature on a warehouse floor.
Static obstacles → grid graph. Shortest route → A* with Manhattan heuristic; dynamic obstacles → replan or D* Lite. Discuss permanent-visited (settled cells), heuristic admissibility, and that you would *not* use backtracking for the route, only for "show me alternative routes" (bounded enumeration).

### B4. How would you explain backtracking to a junior?
Use the building analogy: walk a corridor (DFS), drop a breadcrumb in each room (mark visited), and pick it back up when a room dead-ends (un-mark) so a future route can use it. Lead with the two gotchas: always un-mark, and backtracking is for listing routes, not the shortest one.

### B5. Your maze enumeration service is using too much memory. How do you investigate?
Check whether you materialize all paths (should stream); whether the visited matrix is reused, not reallocated per call; whether output is capped. Profile allocations. The fix is usually streaming output plus buffer reuse, and possibly switching a monotone-count request to the linear DP.

---

## Coding Challenges

### Challenge 1: Find a Path (and print it)

**Problem.** Given an `n × m` maze (`1` = open, `0` = wall), find any path from `(0,0)` to `(n-1,m-1)` using D/L/R/U moves. Return the direction string, or `"NO PATH"`.

**Example.**
```text
maze = [[1,0],[1,1]], start (0,0), goal (1,1)  ->  "DR"
```

**Constraints.** `1 ≤ n, m ≤ 20`.

**Approach.** DFS backtracking; return on first success.

**Go.**
```go
package main

import "fmt"

var (
	dr   = []int{1, 0, 0, -1} // D, L, R, U
	dc   = []int{0, -1, 1, 0}
	dirs = []byte{'D', 'L', 'R', 'U'}
)

func solve(maze [][]int, r, c int, visited [][]bool, path []byte, out *string) bool {
	n, m := len(maze), len(maze[0])
	if r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || visited[r][c] {
		return false
	}
	if r == n-1 && c == m-1 {
		*out = string(path)
		return true
	}
	visited[r][c] = true
	for d := 0; d < 4; d++ {
		if solve(maze, r+dr[d], c+dc[d], visited, append(path, dirs[d]), out) {
			return true
		}
	}
	visited[r][c] = false // un-mark
	return false
}

func findPath(maze [][]int) string {
	n := len(maze)
	if maze[0][0] == 0 || maze[n-1][len(maze[0])-1] == 0 {
		return "NO PATH"
	}
	visited := make([][]bool, n)
	for i := range visited {
		visited[i] = make([]bool, len(maze[0]))
	}
	out := "NO PATH"
	solve(maze, 0, 0, visited, []byte{}, &out)
	return out
}

func main() {
	maze := [][]int{{1, 0}, {1, 1}}
	fmt.Println(findPath(maze)) // DR
}
```

**Java.**
```java
public class FindPath {
    static final int[] dr = {1, 0, 0, -1};
    static final int[] dc = {0, -1, 1, 0};
    static final char[] dirs = {'D', 'L', 'R', 'U'};

    static boolean solve(int[][] maze, int r, int c, boolean[][] vis,
                         StringBuilder path, StringBuilder out) {
        int n = maze.length, m = maze[0].length;
        if (r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || vis[r][c]) return false;
        if (r == n - 1 && c == m - 1) { out.append(path); return true; }
        vis[r][c] = true;
        for (int d = 0; d < 4; d++) {
            path.append(dirs[d]);
            if (solve(maze, r + dr[d], c + dc[d], vis, path, out)) return true;
            path.deleteCharAt(path.length() - 1);
        }
        vis[r][c] = false;   // un-mark
        return false;
    }

    static String findPath(int[][] maze) {
        int n = maze.length, m = maze[0].length;
        if (maze[0][0] == 0 || maze[n - 1][m - 1] == 0) return "NO PATH";
        boolean[][] vis = new boolean[n][m];
        StringBuilder out = new StringBuilder();
        if (!solve(maze, 0, 0, vis, new StringBuilder(), out)) return "NO PATH";
        return out.toString();
    }

    public static void main(String[] args) {
        int[][] maze = {{1, 0}, {1, 1}};
        System.out.println(findPath(maze)); // DR
    }
}
```

**Python.**
```python
DR = [1, 0, 0, -1]   # D, L, R, U
DC = [0, -1, 1, 0]
DIRS = "DLRU"


def solve(maze, r, c, vis, path, out):
    n, m = len(maze), len(maze[0])
    if r < 0 or r >= n or c < 0 or c >= m or maze[r][c] == 0 or vis[r][c]:
        return False
    if r == n - 1 and c == m - 1:
        out.append("".join(path))
        return True
    vis[r][c] = True
    for d in range(4):
        path.append(DIRS[d])
        if solve(maze, r + DR[d], c + DC[d], vis, path, out):
            return True
        path.pop()
    vis[r][c] = False     # un-mark
    return False


def find_path(maze):
    n, m = len(maze), len(maze[0])
    if maze[0][0] == 0 or maze[n - 1][m - 1] == 0:
        return "NO PATH"
    vis = [[False] * m for _ in range(n)]
    out = []
    return out[0] if solve(maze, 0, 0, vis, [], out) else "NO PATH"


if __name__ == "__main__":
    print(find_path([[1, 0], [1, 1]]))  # DR
```

---

### Challenge 2: Count and Print All Paths (lexicographic)

**Problem.** Given an `n × m` maze (`1`=open, `0`=wall), return all paths from `(0,0)` to `(n-1,m-1)` as direction strings in lexicographic order, and the total count. Use D,L,R,U order.

**Example.**
```text
maze = [[1,1],[1,1]]  ->  ["DR","RD"], count = 2
```

**Constraints.** `1 ≤ n, m ≤ 8` (output can be large).

**Approach.** DFS backtracking, never stop early, D,L,R,U order gives sorted output.

**Go.**
```go
package main

import "fmt"

var (
	dr   = []int{1, 0, 0, -1}
	dc   = []int{0, -1, 1, 0}
	dirs = []byte{'D', 'L', 'R', 'U'}
)

func allPaths(maze [][]int) []string {
	n, m := len(maze), len(maze[0])
	var res []string
	if maze[0][0] == 0 {
		return res
	}
	vis := make([][]bool, n)
	for i := range vis {
		vis[i] = make([]bool, m)
	}
	var dfs func(r, c int, path []byte)
	dfs = func(r, c int, path []byte) {
		if r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || vis[r][c] {
			return
		}
		if r == n-1 && c == m-1 {
			res = append(res, string(path))
			return
		}
		vis[r][c] = true
		for d := 0; d < 4; d++ {
			dfs(r+dr[d], c+dc[d], append(path, dirs[d]))
		}
		vis[r][c] = false
	}
	dfs(0, 0, []byte{})
	return res
}

func main() {
	maze := [][]int{{1, 1}, {1, 1}}
	paths := allPaths(maze)
	fmt.Println(paths, "count =", len(paths)) // [DR RD] count = 2
}
```

**Java.**
```java
import java.util.*;

public class AllPaths {
    static final int[] dr = {1, 0, 0, -1};
    static final int[] dc = {0, -1, 1, 0};
    static final char[] dirs = {'D', 'L', 'R', 'U'};

    static void dfs(int[][] maze, int r, int c, boolean[][] vis,
                    StringBuilder path, List<String> res) {
        int n = maze.length, m = maze[0].length;
        if (r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || vis[r][c]) return;
        if (r == n - 1 && c == m - 1) { res.add(path.toString()); return; }
        vis[r][c] = true;
        for (int d = 0; d < 4; d++) {
            path.append(dirs[d]);
            dfs(maze, r + dr[d], c + dc[d], vis, path, res);
            path.deleteCharAt(path.length() - 1);
        }
        vis[r][c] = false;
    }

    static List<String> allPaths(int[][] maze) {
        List<String> res = new ArrayList<>();
        if (maze[0][0] == 0) return res;
        boolean[][] vis = new boolean[maze.length][maze[0].length];
        dfs(maze, 0, 0, vis, new StringBuilder(), res);
        return res;
    }

    public static void main(String[] args) {
        int[][] maze = {{1, 1}, {1, 1}};
        List<String> p = allPaths(maze);
        System.out.println(p + " count = " + p.size()); // [DR, RD] count = 2
    }
}
```

**Python.**
```python
DR = [1, 0, 0, -1]
DC = [0, -1, 1, 0]
DIRS = "DLRU"


def all_paths(maze):
    n, m = len(maze), len(maze[0])
    res = []
    if maze[0][0] == 0:
        return res
    vis = [[False] * m for _ in range(n)]

    def dfs(r, c, path):
        if r < 0 or r >= n or c < 0 or c >= m or maze[r][c] == 0 or vis[r][c]:
            return
        if r == n - 1 and c == m - 1:
            res.append("".join(path))
            return
        vis[r][c] = True
        for d in range(4):
            path.append(DIRS[d])
            dfs(r + DR[d], c + DC[d], path)
            path.pop()
        vis[r][c] = False

    dfs(0, 0, [])
    return res


if __name__ == "__main__":
    paths = all_paths([[1, 1], [1, 1]])
    print(paths, "count =", len(paths))  # ['DR', 'RD'] count = 2
```

---

### Challenge 3: Lexicographically Smallest Path

**Problem.** Given a maze, return the lexicographically smallest path string from `(0,0)` to `(n-1,m-1)` (D<L<R<U), or `"NO PATH"`.

**Approach.** DFS in D,L,R,U order; the first complete path found is the smallest. Stop early.

**Go.**
```go
package main

import "fmt"

var (
	dr   = []int{1, 0, 0, -1} // D, L, R, U
	dc   = []int{0, -1, 1, 0}
	dirs = []byte{'D', 'L', 'R', 'U'}
)

func smallest(maze [][]int) string {
	n, m := len(maze), len(maze[0])
	if maze[0][0] == 0 || maze[n-1][m-1] == 0 {
		return "NO PATH"
	}
	vis := make([][]bool, n)
	for i := range vis {
		vis[i] = make([]bool, m)
	}
	var ans string
	found := false
	var dfs func(r, c int, path []byte) bool
	dfs = func(r, c int, path []byte) bool {
		if r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || vis[r][c] {
			return false
		}
		if r == n-1 && c == m-1 {
			ans = string(path)
			found = true
			return true
		}
		vis[r][c] = true
		for d := 0; d < 4; d++ { // D,L,R,U order
			if dfs(r+dr[d], c+dc[d], append(path, dirs[d])) {
				return true
			}
		}
		vis[r][c] = false
		return false
	}
	dfs(0, 0, []byte{})
	if !found {
		return "NO PATH"
	}
	return ans
}

func main() {
	maze := [][]int{{1, 1, 1}, {1, 0, 1}, {1, 1, 1}}
	fmt.Println(smallest(maze)) // DDRR
}
```

**Java.**
```java
public class SmallestPath {
    static final int[] dr = {1, 0, 0, -1};
    static final int[] dc = {0, -1, 1, 0};
    static final char[] dirs = {'D', 'L', 'R', 'U'};
    static String ans = "NO PATH";

    static boolean dfs(int[][] maze, int r, int c, boolean[][] vis, StringBuilder path) {
        int n = maze.length, m = maze[0].length;
        if (r < 0 || r >= n || c < 0 || c >= m || maze[r][c] == 0 || vis[r][c]) return false;
        if (r == n - 1 && c == m - 1) { ans = path.toString(); return true; }
        vis[r][c] = true;
        for (int d = 0; d < 4; d++) {
            path.append(dirs[d]);
            if (dfs(maze, r + dr[d], c + dc[d], vis, path)) return true;
            path.deleteCharAt(path.length() - 1);
        }
        vis[r][c] = false;
        return false;
    }

    public static void main(String[] args) {
        int[][] maze = {{1, 1, 1}, {1, 0, 1}, {1, 1, 1}};
        if (maze[0][0] == 1 && maze[2][2] == 1)
            dfs(maze, 0, 0, new boolean[3][3], new StringBuilder());
        System.out.println(ans); // DDRR
    }
}
```

**Python.**
```python
DR = [1, 0, 0, -1]   # D, L, R, U
DC = [0, -1, 1, 0]
DIRS = "DLRU"


def smallest(maze):
    n, m = len(maze), len(maze[0])
    if maze[0][0] == 0 or maze[n - 1][m - 1] == 0:
        return "NO PATH"
    vis = [[False] * m for _ in range(n)]
    ans = [None]

    def dfs(r, c, path):
        if r < 0 or r >= n or c < 0 or c >= m or maze[r][c] == 0 or vis[r][c]:
            return False
        if r == n - 1 and c == m - 1:
            ans[0] = "".join(path)
            return True
        vis[r][c] = True
        for d in range(4):           # D,L,R,U
            path.append(DIRS[d])
            if dfs(r + DR[d], c + DC[d], path):
                return True
            path.pop()
        vis[r][c] = False
        return False

    dfs(0, 0, [])
    return ans[0] if ans[0] is not None else "NO PATH"


if __name__ == "__main__":
    print(smallest([[1, 1, 1], [1, 0, 1], [1, 1, 1]]))  # DDRR
```

---

### Challenge 4: Shortest Path with Obstacles (BFS, the contrast)

**Problem.** Given a maze (`1`=open, `0`=wall), return the **minimum number of moves** from `(0,0)` to `(n-1,m-1)`, or `-1` if unreachable. This is a **shortest-path** question — use BFS, not backtracking.

**Example.**
```text
maze = [[1,1,1],[0,0,1],[1,1,1]]  ->  4   (RR D D, fewest moves)
```

**Approach.** BFS from the start; first time the goal is dequeued, its distance is minimal. Permanent visited.

**Go.**
```go
package main

import "fmt"

func shortest(maze [][]int) int {
	n, m := len(maze), len(maze[0])
	if maze[0][0] == 0 || maze[n-1][m-1] == 0 {
		return -1
	}
	dr := []int{1, -1, 0, 0}
	dc := []int{0, 0, 1, -1}
	dist := make([][]int, n)
	for i := range dist {
		dist[i] = make([]int, m)
		for j := range dist[i] {
			dist[i][j] = -1
		}
	}
	type pt struct{ r, c int }
	q := []pt{{0, 0}}
	dist[0][0] = 0
	for len(q) > 0 {
		p := q[0]
		q = q[1:]
		if p.r == n-1 && p.c == m-1 {
			return dist[p.r][p.c]
		}
		for d := 0; d < 4; d++ {
			nr, nc := p.r+dr[d], p.c+dc[d]
			if nr >= 0 && nr < n && nc >= 0 && nc < m && maze[nr][nc] == 1 && dist[nr][nc] == -1 {
				dist[nr][nc] = dist[p.r][p.c] + 1
				q = append(q, pt{nr, nc})
			}
		}
	}
	return -1
}

func main() {
	maze := [][]int{{1, 1, 1}, {0, 0, 1}, {1, 1, 1}}
	fmt.Println(shortest(maze)) // 4
}
```

**Java.**
```java
import java.util.*;

public class ShortestMaze {
    static int shortest(int[][] maze) {
        int n = maze.length, m = maze[0].length;
        if (maze[0][0] == 0 || maze[n - 1][m - 1] == 0) return -1;
        int[] dr = {1, -1, 0, 0}, dc = {0, 0, 1, -1};
        int[][] dist = new int[n][m];
        for (int[] row : dist) Arrays.fill(row, -1);
        Deque<int[]> q = new ArrayDeque<>();
        q.add(new int[]{0, 0});
        dist[0][0] = 0;
        while (!q.isEmpty()) {
            int[] p = q.poll();
            if (p[0] == n - 1 && p[1] == m - 1) return dist[p[0]][p[1]];
            for (int d = 0; d < 4; d++) {
                int nr = p[0] + dr[d], nc = p[1] + dc[d];
                if (nr >= 0 && nr < n && nc >= 0 && nc < m
                        && maze[nr][nc] == 1 && dist[nr][nc] == -1) {
                    dist[nr][nc] = dist[p[0]][p[1]] + 1;
                    q.add(new int[]{nr, nc});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] maze = {{1, 1, 1}, {0, 0, 1}, {1, 1, 1}};
        System.out.println(shortest(maze)); // 4
    }
}
```

**Python.**
```python
from collections import deque


def shortest(maze):
    n, m = len(maze), len(maze[0])
    if maze[0][0] == 0 or maze[n - 1][m - 1] == 0:
        return -1
    dr = [1, -1, 0, 0]
    dc = [0, 0, 1, -1]
    dist = [[-1] * m for _ in range(n)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        if r == n - 1 and c == m - 1:
            return dist[r][c]
        for d in range(4):
            nr, nc = r + dr[d], c + dc[d]
            if 0 <= nr < n and 0 <= nc < m and maze[nr][nc] == 1 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return -1


if __name__ == "__main__":
    print(shortest([[1, 1, 1], [0, 0, 1], [1, 1, 1]]))  # 4
```

---

## Final Tips

- Lead with the one-liner: *"DFS backtracking — mark the cell, try D/L/R/U, recurse, then un-mark on the way out."*
- Immediately flag the two gotchas: **always un-mark**, and **backtracking is not for the shortest path** (use BFS).
- For the lexicographically smallest path, try directions in **D, L, R, U** order; the first found is smallest.
- For "all paths", never stop early and always un-mark; for "one path", return on first success.
- Offer pruning (reachability pre-flood) for large mazes, and offer the `O(N)` DP for monotone path counting.
- Always offer to verify against a brute-force oracle and to assert the visited matrix is all-false after the search.
