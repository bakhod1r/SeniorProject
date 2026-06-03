# 0-1 BFS — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> The core engine is always the same: a deque, `push_front` for 0-weight edges, `push_back` for 1-weight edges, settle on first front-pop, skip stale entries.

---

## Beginner Tasks (5)

### Task 1 — Single-source 0-1 BFS distances

**Problem.** Given a directed graph on `n` vertices where every edge weighs 0 or 1, compute the shortest distance from a source `s` to every vertex. Output `-1` for unreachable vertices.

**Input / Output spec.**
- First line: `n m s` (vertices, edges, source).
- Next `m` lines: `u v w` with `w ∈ {0,1}`.
- Output `n` integers: `dist[0..n-1]`.

**Constraints.**
- `1 ≤ n ≤ 10^6`, `0 ≤ m ≤ 2·10^6`.
- `w ∈ {0,1}`.
- Time: `O(n + m)`.

**Hint.** Standard deque relax loop. `push_front` on weight 0, `push_back` on weight 1.

#### Go
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type Edge struct{ to, w int }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m, s int
	fmt.Fscan(in, &n, &m, &s)
	adj := make([][]Edge, n)
	for i := 0; i < m; i++ {
		var u, v, w int
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], Edge{v, w})
	}
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if dist[u]+e.w < dist[e.to] {
				dist[e.to] = dist[u] + e.w
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		if dist[i] == INF {
			fmt.Fprintln(out, -1)
		} else {
			fmt.Fprintln(out, dist[i])
		}
	}
}
```

#### Java
```java
import java.util.*;
import java.io.*;

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int s = Integer.parseInt(st.nextToken());
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            int u = Integer.parseInt(st.nextToken());
            int v = Integer.parseInt(st.nextToken());
            int w = Integer.parseInt(st.nextToken());
            adj[u].add(new int[]{v, w});
        }
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u]) {
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    if (e[1] == 0) dq.addFirst(e[0]);
                    else           dq.addLast(e[0]);
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(dist[i] == INF ? -1 : dist[i]).append('\n');
        System.out.print(sb);
    }
}
```

#### Python
```python
import sys
from collections import deque

def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx+1]); s = int(data[idx+2]); idx += 3
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = int(data[idx]), int(data[idx+1]), int(data[idx+2]); idx += 3
        adj[u].append((v, w))
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                dq.appendleft(v) if w == 0 else dq.append(v)
    out = "\n".join(str(-1 if d == INF else d) for d in dist)
    print(out)

main()
```

---

### Task 2 — Minimum obstacles in a grid (4-directional)

**Problem.** Given an `R×C` 0/1 grid (`1` = obstacle), return the minimum number of obstacles removed to go from `(0,0)` to `(R-1,C-1)` moving in the four cardinal directions. Entering an obstacle cell costs 1; entering a free cell costs 0.

**Constraints.** `1 ≤ R, C ≤ 10^3`. `O(R·C)`.

**Hint.** Vertex = `r*C + c`. Weight = value of the entered cell.

#### Go
```go
package main

import "fmt"

func minObstacles(grid [][]int) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = 0
	dq := []int{0}
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
	fmt.Println(minObstacles([][]int{{0, 1, 0}, {1, 1, 1}, {0, 1, 0}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static int minObstacles(int[][] grid) {
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
        System.out.println(minObstacles(new int[][]{{0, 1, 0}, {1, 1, 1}, {0, 1, 0}})); // 2
    }
}
```

#### Python
```python
from collections import deque

def min_obstacles(grid):
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
    print(min_obstacles([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))  # 2
```

---

### Task 3 — Undirected 0-1 graph (highway vs local roads)

**Problem.** An undirected road network on `n` cities. A "highway" road is free (weight 0); a "local" road costs one toll (weight 1). Find the minimum tolls from city `s` to every other city.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`. `O(n + m)`.

**Hint.** Add each undirected edge in both directions; otherwise identical to Task 1.

#### Go
```go
package main

import "fmt"

type Edge struct{ to, w int }

func zeroOneBFS(adj [][]Edge, n, s int) []int {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if dist[u]+e.w < dist[e.to] {
				dist[e.to] = dist[u] + e.w
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	return dist
}

func main() {
	n := 4
	adj := make([][]Edge, n)
	add := func(u, v, w int) { adj[u] = append(adj[u], Edge{v, w}); adj[v] = append(adj[v], Edge{u, w}) }
	add(0, 1, 1)
	add(1, 2, 0)
	add(2, 3, 1)
	add(0, 3, 1)
	fmt.Println(zeroOneBFS(adj, n, 0)) // [0 1 1 1]
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static int[] zeroOneBFS(List<int[]>[] adj, int n, int s) {
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u]) {
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    if (e[1] == 0) dq.addFirst(e[0]);
                    else           dq.addLast(e[0]);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] edges = {{0, 1, 1}, {1, 2, 0}, {2, 3, 1}, {0, 3, 1}};
        for (int[] e : edges) {
            adj[e[0]].add(new int[]{e[1], e[2]});
            adj[e[1]].add(new int[]{e[0], e[2]});
        }
        System.out.println(Arrays.toString(zeroOneBFS(adj, n, 0))); // [0, 1, 1, 1]
    }
}
```

#### Python
```python
from collections import deque

def zero_one_bfs(adj, n, s):
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                dq.appendleft(v) if w == 0 else dq.append(v)
    return dist


if __name__ == "__main__":
    n = 4
    adj = [[] for _ in range(n)]
    for u, v, w in [(0, 1, 1), (1, 2, 0), (2, 3, 1), (0, 3, 1)]:
        adj[u].append((v, w))
        adj[v].append((u, w))
    print(zero_one_bfs(adj, n, 0))  # [0, 1, 1, 1]
```

---

### Task 4 — Does a 0-cost path exist?

**Problem.** Given a 0/1-weighted directed graph and two vertices `s`, `t`, decide whether there is a path from `s` to `t` using **only weight-0 edges** (total cost 0).

**Constraints.** `1 ≤ n ≤ 10^5`. `O(n + m)`.

**Hint.** Run 0-1 BFS and check `dist[t] == 0`. (You could also do a plain BFS over the 0-edge subgraph, but 0-1 BFS answers it directly.)

#### Go
```go
package main

import "fmt"

type Edge struct{ to, w int }

func zeroCostReachable(adj [][]Edge, n, s, t int) bool {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if dist[u]+e.w < dist[e.to] {
				dist[e.to] = dist[u] + e.w
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	return dist[t] == 0
}

func main() {
	adj := make([][]Edge, 4)
	adj[0] = []Edge{{1, 0}, {2, 1}}
	adj[1] = []Edge{{3, 0}}
	adj[2] = []Edge{{3, 0}}
	fmt.Println(zeroCostReachable(adj, 4, 0, 3)) // true (0->1->3 all weight 0)
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    static boolean zeroCostReachable(List<int[]>[] adj, int n, int s, int t) {
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u]) {
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    if (e[1] == 0) dq.addFirst(e[0]);
                    else           dq.addLast(e[0]);
                }
            }
        }
        return dist[t] == 0;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 0}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 0});
        adj[2].add(new int[]{3, 0});
        System.out.println(zeroCostReachable(adj, n, 0, 3)); // true
    }
}
```

#### Python
```python
from collections import deque

def zero_cost_reachable(adj, n, s, t):
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                dq.appendleft(v) if w == 0 else dq.append(v)
    return dist[t] == 0


if __name__ == "__main__":
    adj = {0: [(1, 0), (2, 1)], 1: [(3, 0)], 2: [(3, 0)], 3: []}
    print(zero_cost_reachable(adj, 4, 0, 3))  # True
```

---

### Task 5 — Multi-source nearest-free-cell distance

**Problem.** Given a grid where some cells are "stations" (sources). For every cell, output the minimum cost to reach the nearest station, where stepping onto a `.` cell costs 1 and stepping onto a free-pass `0` cell costs 0. Stations are at distance 0.

**Constraints.** `1 ≤ R, C ≤ 10^3`. `O(R·C)`.

**Hint.** Seed the deque with all stations at distance 0; the two-level invariant still holds.

#### Go
```go
package main

import "fmt"

// grid value 0 => entering costs 0, value 1 => entering costs 1; stations given as a list.
func multiSource(grid [][]int, stations [][2]int) [][]int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([][]int, R)
	for i := range dist {
		dist[i] = make([]int, C)
		for j := range dist[i] {
			dist[i][j] = INF
		}
	}
	dq := []int{}
	for _, s := range stations {
		dist[s[0]][s[1]] = 0
		dq = append(dq, s[0]*C+s[1])
	}
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
			if dist[r][c]+w < dist[nr][nc] {
				dist[nr][nc] = dist[r][c] + w
				if w == 0 {
					dq = append([]int{nr*C + nc}, dq...)
				} else {
					dq = append(dq, nr*C+nc)
				}
			}
		}
	}
	return dist
}

func main() {
	g := [][]int{{0, 1, 1}, {0, 1, 0}, {0, 0, 0}}
	fmt.Println(multiSource(g, [][2]int{{0, 0}}))
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static int[][] multiSource(int[][] grid, int[][] stations) {
        int R = grid.length, C = grid[0].length, INF = Integer.MAX_VALUE / 2;
        int[][] dist = new int[R][C];
        for (int[] row : dist) Arrays.fill(row, INF);
        Deque<Integer> dq = new ArrayDeque<>();
        for (int[] s : stations) {
            dist[s[0]][s[1]] = 0;
            dq.addLast(s[0] * C + s[1]);
        }
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!dq.isEmpty()) {
            int cur = dq.pollFirst(), r = cur / C, c = cur % C;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
                int w = grid[nr][nc];
                if (dist[r][c] + w < dist[nr][nc]) {
                    dist[nr][nc] = dist[r][c] + w;
                    if (w == 0) dq.addFirst(nr * C + nc);
                    else        dq.addLast(nr * C + nc);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int[][] g = {{0, 1, 1}, {0, 1, 0}, {0, 0, 0}};
        System.out.println(Arrays.deepToString(multiSource(g, new int[][]{{0, 0}})));
    }
}
```

#### Python
```python
from collections import deque

def multi_source(grid, stations):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [[INF] * C for _ in range(R)]
    dq = deque()
    for r, c in stations:
        dist[r][c] = 0
        dq.append(r * C + c)
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while dq:
        cur = dq.popleft()
        r, c = divmod(cur, C)
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                w = grid[nr][nc]
                if dist[r][c] + w < dist[nr][nc]:
                    dist[nr][nc] = dist[r][c] + w
                    (dq.appendleft if w == 0 else dq.append)(nr * C + nc)
    return dist


if __name__ == "__main__":
    g = [[0, 1, 1], [0, 1, 0], [0, 0, 0]]
    for row in multi_source(g, [(0, 0)]):
        print(row)
```

---

## Intermediate Tasks (5)

### Task 6 — Minimum cost to make a path (rotating arrows)

**Problem.** Grid cells hold arrows `1`=right, `2`=left, `3`=down, `4`=up. From `(0,0)`, following a cell's arrow is free; rotating it (any other direction) costs 1. Minimum cost to reach `(R-1,C-1)`. (LeetCode 1368.)

**Constraints.** `1 ≤ R, C ≤ 100`. `O(R·C)`.

**Hint.** From `(r,c)`, the move equal to `grid[r][c]` is weight 0; the other three are weight 1.

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
	fmt.Println(minCost([][]int{{1, 1, 3}, {3, 2, 2}, {1, 1, 4}})) // 0
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static int minCost(int[][] grid) {
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
        System.out.println(minCost(new int[][]{{1, 1, 3}, {3, 2, 2}, {1, 1, 4}})); // 0
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
    dr = (0, 0, 0, 1, -1)
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
                    (dq.appendleft if w == 0 else dq.append)(nid)
    return dist[R * C - 1]


if __name__ == "__main__":
    print(min_cost([[1, 1, 3], [3, 2, 2], [1, 1, 4]]))  # 0
```

---

### Task 7 — Eight-directional minimum-flip maze

**Problem.** A binary grid where `0` cells are passable for free and `1` cells must be flipped (cost 1) to pass. Move in all eight directions. Return the minimum flips from `(0,0)` to `(R-1,C-1)`, counting the start cell's own value as part of the cost.

**Constraints.** `1 ≤ R, C ≤ 10^3`. `O(R·C)`.

**Hint.** Initialise `dist[0][0] = grid[0][0]` (the start cell may itself be a `1`). Eight neighbour offsets.

#### Go
```go
package main

import "fmt"

func minFlips(grid [][]int) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = grid[0][0]
	dq := []int{0}
	var dirs [][2]int
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if dr != 0 || dc != 0 {
				dirs = append(dirs, [2]int{dr, dc})
			}
		}
	}
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
	fmt.Println(minFlips([][]int{{0, 1, 0}, {0, 1, 0}, {0, 0, 0}})) // 0 (diagonal route around)
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    static int minFlips(int[][] grid) {
        int R = grid.length, C = grid[0].length, INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[R * C];
        Arrays.fill(dist, INF);
        dist[0] = grid[0][0];
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(0);
        int[][] dirs = {{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}};
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
        System.out.println(minFlips(new int[][]{{0, 1, 0}, {0, 1, 0}, {0, 0, 0}})); // 0
    }
}
```

#### Python
```python
from collections import deque

def min_flips(grid):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = grid[0][0]
    dq = deque([0])
    dirs = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
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
                    (dq.appendleft if w == 0 else dq.append)(nid)
    return dist[R * C - 1]


if __name__ == "__main__":
    print(min_flips([[0, 1, 0], [0, 1, 0], [0, 0, 0]]))  # 0
```

---

### Task 8 — Minimum direction changes (state-augmented)

**Problem.** In a grid, you start at `(0,0)` facing right. Moving straight (continuing in your current facing direction) is free; turning to a new direction before moving costs 1. Find the minimum number of turns to reach `(R-1,C-1)` (any obstacle cell `#` is impassable).

**Constraints.** `1 ≤ R, C ≤ 500`. State = `(cell, facing)`, 4 facings. `O(R·C·4)`.

**Hint.** Vertex = `(r, c, dir)`. Move in the same `dir` is weight 0; switching to a different `dir` is weight 1, then move.

#### Go
```go
package main

import "fmt"

func minTurns(grid []string) int {
	R, C := len(grid), len(grid[0])
	dr := []int{0, 0, 1, -1} // right, left, down, up
	dc := []int{1, -1, 0, 0}
	const INF = 1 << 30
	// state id = (r*C + c)*4 + dir
	dist := make([]int, R*C*4)
	for i := range dist {
		dist[i] = INF
	}
	type st struct{ r, c, d int }
	dq := []st{}
	for d := 0; d < 4; d++ {
		dist[(0*C+0)*4+d] = 0
		dq = append(dq, st{0, 0, d})
	}
	for len(dq) > 0 {
		cur := dq[0]
		dq = dq[1:]
		cid := (cur.r*C+cur.c)*4 + cur.d
		for nd := 0; nd < 4; nd++ {
			nr, nc := cur.r+dr[nd], cur.c+dc[nd]
			if nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr][nc] == '#' {
				continue
			}
			w := 0
			if nd != cur.d {
				w = 1
			}
			nid := (nr*C+nc)*4 + nd
			if dist[cid]+w < dist[nid] {
				dist[nid] = dist[cid] + w
				if w == 0 {
					dq = append([]st{{nr, nc, nd}}, dq...)
				} else {
					dq = append(dq, st{nr, nc, nd})
				}
			}
		}
	}
	best := INF
	for d := 0; d < 4; d++ {
		if dist[((R-1)*C+(C-1))*4+d] < best {
			best = dist[((R-1)*C+(C-1))*4+d]
		}
	}
	return best
}

func main() {
	fmt.Println(minTurns([]string{"...", ".#.", "..."})) // 1 (go right then one turn down)
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    static int minTurns(String[] grid) {
        int R = grid.length, C = grid[0].length(), INF = Integer.MAX_VALUE / 2;
        int[] dr = {0, 0, 1, -1}, dc = {1, -1, 0, 0};
        int[] dist = new int[R * C * 4];
        Arrays.fill(dist, INF);
        Deque<int[]> dq = new ArrayDeque<>();
        for (int d = 0; d < 4; d++) {
            dist[(0 * C) * 4 + d] = 0;
            dq.addLast(new int[]{0, 0, d});
        }
        while (!dq.isEmpty()) {
            int[] cur = dq.pollFirst();
            int r = cur[0], c = cur[1], dir = cur[2];
            int cid = (r * C + c) * 4 + dir;
            for (int nd = 0; nd < 4; nd++) {
                int nr = r + dr[nd], nc = c + dc[nd];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr].charAt(nc) == '#') continue;
                int w = nd != dir ? 1 : 0, nid = (nr * C + nc) * 4 + nd;
                if (dist[cid] + w < dist[nid]) {
                    dist[nid] = dist[cid] + w;
                    if (w == 0) dq.addFirst(new int[]{nr, nc, nd});
                    else        dq.addLast(new int[]{nr, nc, nd});
                }
            }
        }
        int best = INF;
        for (int d = 0; d < 4; d++) best = Math.min(best, dist[((R - 1) * C + (C - 1)) * 4 + d]);
        return best;
    }

    public static void main(String[] args) {
        System.out.println(minTurns(new String[]{"...", ".#.", "..."})); // 1
    }
}
```

#### Python
```python
from collections import deque

def min_turns(grid):
    R, C = len(grid), len(grid[0])
    dr = (0, 0, 1, -1)   # right, left, down, up
    dc = (1, -1, 0, 0)
    INF = float("inf")
    dist = [INF] * (R * C * 4)
    dq = deque()
    for d in range(4):
        dist[d] = 0
        dq.append((0, 0, d))
    while dq:
        r, c, dir_ = dq.popleft()
        cid = (r * C + c) * 4 + dir_
        for nd in range(4):
            nr, nc = r + dr[nd], c + dc[nd]
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] != "#":
                w = 0 if nd == dir_ else 1
                nid = (nr * C + nc) * 4 + nd
                if dist[cid] + w < dist[nid]:
                    dist[nid] = dist[cid] + w
                    (dq.appendleft if w == 0 else dq.append)((nr, nc, nd))
    return min(dist[((R - 1) * C + (C - 1)) * 4 + d] for d in range(4))


if __name__ == "__main__":
    print(min_turns(["...", ".#.", "..."]))  # 1
```

---

### Task 9 — Shortest path with free portals

**Problem.** Grid of `.` (open), `#` (wall), and lowercase letters. Walking between adjacent open/letter cells costs 1; teleporting between any two cells of the same letter is free. Minimum cost from `(0,0)` to `(R-1,C-1)`.

**Constraints.** `1 ≤ R, C ≤ 10^3`. `O(R·C)` amortised.

**Hint.** Letter cells of the same kind form free (weight-0) edges. Expand a letter group once, on first arrival, with `push_front`.

#### Go
```go
package main

import "fmt"

func shortestPortal(grid []string) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	portals := map[byte][]int{}
	for r := 0; r < R; r++ {
		for c := 0; c < C; c++ {
			if grid[r][c] >= 'a' && grid[r][c] <= 'z' {
				portals[grid[r][c]] = append(portals[grid[r][c]], r*C+c)
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
	fmt.Println(shortestPortal([]string{".a.", "###", ".a."})) // 2 (walk to 'a', free teleport, walk out)
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static int shortestPortal(String[] grid) {
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
            if (ch >= 'a' && ch <= 'z' && used.add(ch))
                for (int p : portals.get(ch))
                    if (dist[cur] < dist[p]) { dist[p] = dist[cur]; dq.addFirst(p); }
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
        System.out.println(shortestPortal(new String[]{".a.", "###", ".a."})); // 2
    }
}
```

#### Python
```python
from collections import deque, defaultdict

def shortest_portal(grid):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    portals = defaultdict(list)
    for r in range(R):
        for c in range(C):
            if grid[r][c].islower():
                portals[grid[r][c]].append(r * C + c)
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
    print(shortest_portal([".a.", "###", ".a."]))  # 2
```

---

### Task 10 — Verify 0-1 BFS against Dijkstra (property test)

**Problem.** Write a checker that, on random 0/1-weighted graphs, asserts the 0-1 BFS distance array equals a binary-heap Dijkstra distance array. This is the standard correctness harness.

**Constraints.** Random graphs up to `n = 2000`, `m = 8000`. The two outputs must match exactly on every vertex.

**Hint.** Implement both; loop many random seeds; assert equality.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
)

type Edge struct{ to, w int }

func zeroOne(adj [][]Edge, n, s int) []int {
	const INF = 1 << 30
	d := make([]int, n)
	for i := range d {
		d[i] = INF
	}
	d[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if d[u]+e.w < d[e.to] {
				d[e.to] = d[u] + e.w
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	return d
}

type pqItem struct{ dist, node int }
type pq []pqItem

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(pqItem)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); it := o[n-1]; *p = o[:n-1]; return it }

func dijkstra(adj [][]Edge, n, s int) []int {
	const INF = 1 << 30
	d := make([]int, n)
	for i := range d {
		d[i] = INF
	}
	d[s] = 0
	h := &pq{{0, s}}
	for h.Len() > 0 {
		it := heap.Pop(h).(pqItem)
		if it.dist > d[it.node] {
			continue
		}
		for _, e := range adj[it.node] {
			if d[it.node]+e.w < d[e.to] {
				d[e.to] = d[it.node] + e.w
				heap.Push(h, pqItem{d[e.to], e.to})
			}
		}
	}
	return d
}

func main() {
	for t := 0; t < 200; t++ {
		n := 5 + rand.Intn(50)
		adj := make([][]Edge, n)
		m := rand.Intn(4 * n)
		for i := 0; i < m; i++ {
			u, v, w := rand.Intn(n), rand.Intn(n), rand.Intn(2)
			adj[u] = append(adj[u], Edge{v, w})
		}
		a, b := zeroOne(adj, n, 0), dijkstra(adj, n, 0)
		for i := 0; i < n; i++ {
			if a[i] != b[i] {
				panic(fmt.Sprintf("mismatch at %d: %d vs %d", i, a[i], b[i]))
			}
		}
	}
	fmt.Println("all 200 random tests passed")
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static int[] zeroOne(List<int[]>[] adj, int n, int s) {
        int INF = Integer.MAX_VALUE / 2;
        int[] d = new int[n];
        Arrays.fill(d, INF);
        d[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u])
                if (d[u] + e[1] < d[e[0]]) {
                    d[e[0]] = d[u] + e[1];
                    if (e[1] == 0) dq.addFirst(e[0]); else dq.addLast(e[0]);
                }
        }
        return d;
    }

    static int[] dijkstra(List<int[]>[] adj, int n, int s) {
        int INF = Integer.MAX_VALUE / 2;
        int[] d = new int[n];
        Arrays.fill(d, INF);
        d[s] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, s});
        while (!pq.isEmpty()) {
            int[] it = pq.poll();
            if (it[0] > d[it[1]]) continue;
            for (int[] e : adj[it[1]])
                if (d[it[1]] + e[1] < d[e[0]]) {
                    d[e[0]] = d[it[1]] + e[1];
                    pq.add(new int[]{d[e[0]], e[0]});
                }
        }
        return d;
    }

    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int t = 0; t < 200; t++) {
            int n = 5 + rnd.nextInt(50);
            List<int[]>[] adj = new List[n];
            for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
            int m = rnd.nextInt(4 * n);
            for (int i = 0; i < m; i++)
                adj[rnd.nextInt(n)].add(new int[]{rnd.nextInt(n), rnd.nextInt(2)});
            int[] a = zeroOne(adj, n, 0), b = dijkstra(adj, n, 0);
            if (!Arrays.equals(a, b)) throw new AssertionError("mismatch");
        }
        System.out.println("all 200 random tests passed");
    }
}
```

#### Python
```python
import heapq
import random
from collections import deque

def zero_one(adj, n, s):
    INF = float("inf")
    d = [INF] * n
    d[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if d[u] + w < d[v]:
                d[v] = d[u] + w
                (dq.appendleft if w == 0 else dq.append)(v)
    return d

def dijkstra(adj, n, s):
    INF = float("inf")
    d = [INF] * n
    d[s] = 0
    pq = [(0, s)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > d[u]:
            continue
        for v, w in adj[u]:
            if d[u] + w < d[v]:
                d[v] = d[u] + w
                heapq.heappush(pq, (d[v], v))
    return d

if __name__ == "__main__":
    for _ in range(200):
        n = random.randint(5, 50)
        adj = [[] for _ in range(n)]
        for _ in range(random.randint(0, 4 * n)):
            adj[random.randrange(n)].append((random.randrange(n), random.randint(0, 1)))
        assert zero_one(adj, n, 0) == dijkstra(adj, n, 0)
    print("all 200 random tests passed")
```

---

## Advanced Tasks (5)

### Task 11 — Minimum special-edges on a shortest path (threshold + 0-1 BFS)

**Problem.** Given a graph with arbitrary positive integer edge weights and a threshold `T`, find a path from `s` to `t` that uses the **fewest** edges of weight `> T` (call them "heavy"). Edges `≤ T` are "light." Light edges cost 0, heavy edges cost 1; minimise total cost.

**Constraints.** `1 ≤ n ≤ 10^5`, `m ≤ 4·10^5`. `O(n + m)`.

**Hint.** Reclassify every edge to weight 0 (light) or 1 (heavy) by comparing to `T`, then a single 0-1 BFS gives the minimum heavy-edge count.

#### Go
```go
package main

import "fmt"

type Edge struct{ to, weight int }

func minHeavyEdges(adj [][]Edge, n, s, t, T int) int {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			w := 0
			if e.weight > T {
				w = 1
			}
			if dist[u]+w < dist[e.to] {
				dist[e.to] = dist[u] + w
				if w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	return dist[t]
}

func main() {
	adj := make([][]Edge, 4)
	adj[0] = []Edge{{1, 5}, {2, 1}}
	adj[1] = []Edge{{3, 1}}
	adj[2] = []Edge{{3, 9}}
	fmt.Println(minHeavyEdges(adj, 4, 0, 3, 3)) // T=3: 0->1(heavy)->3(light)=1 ; 0->2(light)->3(heavy)=1 => 1
}
```

#### Java
```java
import java.util.*;

public class Task11 {
    static int minHeavyEdges(List<int[]>[] adj, int n, int s, int t, int T) {
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u]) {
                int w = e[1] > T ? 1 : 0;
                if (dist[u] + w < dist[e[0]]) {
                    dist[e[0]] = dist[u] + w;
                    if (w == 0) dq.addFirst(e[0]);
                    else        dq.addLast(e[0]);
                }
            }
        }
        return dist[t];
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 5}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{3, 9});
        System.out.println(minHeavyEdges(adj, n, 0, 3, 3)); // 1
    }
}
```

#### Python
```python
from collections import deque

def min_heavy_edges(adj, n, s, t, T):
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, weight in adj[u]:
            w = 1 if weight > T else 0
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                (dq.appendleft if w == 0 else dq.append)(v)
    return dist[t]


if __name__ == "__main__":
    adj = {0: [(1, 5), (2, 1)], 1: [(3, 1)], 2: [(3, 9)], 3: []}
    print(min_heavy_edges(adj, 4, 0, 3, 3))  # 1
```

---

### Task 12 — 0-1 BFS with at most K free conversions (state = remaining budget)

**Problem.** Binary grid (`1` = wall). You may walk freely on `0` cells (cost 1 per step). You may also walk through a wall, which consumes one of `K` "drills." Find the minimum steps from `(0,0)` to `(R-1,C-1)` using at most `K` drills. (Here a step always costs 1; drilling does not add step cost but consumes budget — so model steps as weight 1 and we minimise steps subject to the budget.) Variant: model "drill use" as the 0/1 cost and minimise drills.

**This task version:** minimise the number of **drills used** (walls passed through) to reach the exit; walking on open cells is free (0), passing a wall is cost 1 — i.e. classic minimum-obstacles but bounded by `K`. Return `-1` if even the minimum exceeds `K`.

**Constraints.** `1 ≤ R, C ≤ 500`, `0 ≤ K ≤ R·C`. `O(R·C)`.

**Hint.** Run plain minimum-obstacles 0-1 BFS; compare the result to `K`.

#### Go
```go
package main

import "fmt"

func minDrills(grid [][]int, K int) int {
	R, C := len(grid), len(grid[0])
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = grid[0][0]
	dq := []int{0}
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
	best := dist[R*C-1]
	if best > K {
		return -1
	}
	return best
}

func main() {
	g := [][]int{{0, 1, 1}, {1, 1, 0}, {1, 1, 0}}
	fmt.Println(minDrills(g, 3)) // 2
	fmt.Println(minDrills(g, 1)) // -1
}
```

#### Java
```java
import java.util.*;

public class Task12 {
    static int minDrills(int[][] grid, int K) {
        int R = grid.length, C = grid[0].length, INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[R * C];
        Arrays.fill(dist, INF);
        dist[0] = grid[0][0];
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
        int best = dist[R * C - 1];
        return best > K ? -1 : best;
    }

    public static void main(String[] args) {
        int[][] g = {{0, 1, 1}, {1, 1, 0}, {1, 1, 0}};
        System.out.println(minDrills(g, 3)); // 2
        System.out.println(minDrills(g, 1)); // -1
    }
}
```

#### Python
```python
from collections import deque

def min_drills(grid, K):
    R, C = len(grid), len(grid[0])
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = grid[0][0]
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
                    (dq.appendleft if w == 0 else dq.append)(nid)
    best = dist[R * C - 1]
    return -1 if best > K else best


if __name__ == "__main__":
    g = [[0, 1, 1], [1, 1, 0], [1, 1, 0]]
    print(min_drills(g, 3))  # 2
    print(min_drills(g, 1))  # -1
```

---

### Task 13 — Dial's algorithm for 0..k weights

**Problem.** Generalise to integer weights `0..k`. Compute single-source shortest paths in `O(V + E + maxDist)` using a bucket queue.

**Constraints.** `1 ≤ n ≤ 10^5`, weights `0..k`, `k ≤ 10`. `maxDist ≤ (n-1)·k`.

**Hint.** Buckets indexed by distance; relaxing weight `w` from distance `d` inserts into bucket `d+w`.

#### Go
```go
package main

import "fmt"

type Edge struct{ to, w int }

func dial(adj [][]Edge, n, s, maxDist int) []int {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	buckets := make([][]int, maxDist+1)
	buckets[0] = append(buckets[0], s)
	for d := 0; d <= maxDist; d++ {
		for i := 0; i < len(buckets[d]); i++ {
			u := buckets[d][i]
			if d > dist[u] {
				continue
			}
			for _, e := range adj[u] {
				nd := dist[u] + e.w
				if nd <= maxDist && nd < dist[e.to] {
					dist[e.to] = nd
					buckets[nd] = append(buckets[nd], e.to)
				}
			}
		}
	}
	return dist
}

func main() {
	adj := make([][]Edge, 4)
	adj[0] = []Edge{{1, 2}, {2, 0}}
	adj[1] = []Edge{{3, 1}}
	adj[2] = []Edge{{1, 1}, {3, 2}}
	fmt.Println(dial(adj, 4, 0, 20)) // [0 1 0 2]
}
```

#### Java
```java
import java.util.*;

public class Task13 {
    static int[] dial(List<int[]>[] adj, int n, int s, int maxDist) {
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        List<Integer>[] buckets = new List[maxDist + 1];
        for (int i = 0; i <= maxDist; i++) buckets[i] = new ArrayList<>();
        buckets[0].add(s);
        for (int d = 0; d <= maxDist; d++) {
            for (int i = 0; i < buckets[d].size(); i++) {
                int u = buckets[d].get(i);
                if (d > dist[u]) continue;
                for (int[] e : adj[u]) {
                    int nd = dist[u] + e[1];
                    if (nd <= maxDist && nd < dist[e[0]]) {
                        dist[e[0]] = nd;
                        buckets[nd].add(e[0]);
                    }
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 2}); adj[0].add(new int[]{2, 0});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{1, 1}); adj[2].add(new int[]{3, 2});
        System.out.println(Arrays.toString(dial(adj, n, 0, 20))); // [0, 1, 0, 2]
    }
}
```

#### Python
```python
from collections import deque

def dial(adj, n, s, max_dist):
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    buckets = [deque() for _ in range(max_dist + 1)]
    buckets[0].append(s)
    for d in range(max_dist + 1):
        while buckets[d]:
            u = buckets[d].popleft()
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                nd = dist[u] + w
                if nd <= max_dist and nd < dist[v]:
                    dist[v] = nd
                    buckets[nd].append(v)
    return dist


if __name__ == "__main__":
    adj = {0: [(1, 2), (2, 0)], 1: [(3, 1)], 2: [(1, 1), (3, 2)], 3: []}
    print(dial(adj, 4, 0, 20))  # [0, 1, 0, 2]
```

---

### Task 14 — Path reconstruction in 0-1 BFS

**Problem.** Return not just the cost but the actual minimum-cost path from `s` to `t` in a 0/1-weighted graph. If unreachable, return an empty path.

**Constraints.** `1 ≤ n ≤ 10^5`. `O(n + m)`.

**Hint.** Maintain `parent[v]` set whenever `dist[v]` improves. Walk back from `t`.

#### Go
```go
package main

import "fmt"

type Edge struct{ to, w int }

func shortestPath(adj [][]Edge, n, s, t int) []int {
	const INF = 1 << 30
	dist := make([]int, n)
	parent := make([]int, n)
	for i := range dist {
		dist[i] = INF
		parent[i] = -1
	}
	dist[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if dist[u]+e.w < dist[e.to] {
				dist[e.to] = dist[u] + e.w
				parent[e.to] = u
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	if dist[t] == INF {
		return nil
	}
	var path []int
	for v := t; v != -1; v = parent[v] {
		path = append([]int{v}, path...)
	}
	return path
}

func main() {
	adj := make([][]Edge, 4)
	adj[0] = []Edge{{1, 0}, {2, 1}}
	adj[1] = []Edge{{3, 1}}
	adj[2] = []Edge{{3, 0}}
	fmt.Println(shortestPath(adj, 4, 0, 3)) // [0 1 3] or [0 2 3], both cost 1
}
```

#### Java
```java
import java.util.*;

public class Task14 {
    static List<Integer> shortestPath(List<int[]>[] adj, int n, int s, int t) {
        int INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n], parent = new int[n];
        Arrays.fill(dist, INF);
        Arrays.fill(parent, -1);
        dist[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u])
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    parent[e[0]] = u;
                    if (e[1] == 0) dq.addFirst(e[0]); else dq.addLast(e[0]);
                }
        }
        List<Integer> path = new ArrayList<>();
        if (dist[t] == INF) return path;
        for (int v = t; v != -1; v = parent[v]) path.add(v);
        Collections.reverse(path);
        return path;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 0}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{3, 0});
        System.out.println(shortestPath(adj, n, 0, 3));
    }
}
```

#### Python
```python
from collections import deque

def shortest_path(adj, n, s, t):
    INF = float("inf")
    dist = [INF] * n
    parent = [-1] * n
    dist[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                (dq.appendleft if w == 0 else dq.append)(v)
    if dist[t] == INF:
        return []
    path, v = [], t
    while v != -1:
        path.append(v)
        v = parent[v]
    return path[::-1]


if __name__ == "__main__":
    adj = {0: [(1, 0), (2, 1)], 1: [(3, 1)], 2: [(3, 0)], 3: []}
    print(shortest_path(adj, 4, 0, 3))  # [0, 1, 3] or [0, 2, 3]
```

---

### Task 15 — Bidirectional 0-1 BFS (advanced optimisation)

**Problem.** For a single `(s, t)` query on a large undirected 0/1 graph, run 0-1 BFS from both ends and stop when the frontiers meet, to roughly halve the explored region. Return the minimum cost.

**Constraints.** `1 ≤ n ≤ 10^6`. Average case much faster than single-direction.

**Hint.** Run two deques alternately by current minimum distance; when a vertex is settled by both searches, the candidate answer is `distF[v] + distB[v]`; keep the minimum over all meeting vertices. (Careful: with 0-weight edges, you must finish settling all vertices at the current minimum level before concluding.) For clarity the reference below settles fully and combines — it is correct though not maximally pruned.

#### Go
```go
package main

import "fmt"

type Edge struct{ to, w int }

func oneSided(adj [][]Edge, n, s int) []int {
	const INF = 1 << 30
	d := make([]int, n)
	for i := range d {
		d[i] = INF
	}
	d[s] = 0
	dq := []int{s}
	for len(dq) > 0 {
		u := dq[0]
		dq = dq[1:]
		for _, e := range adj[u] {
			if d[u]+e.w < d[e.to] {
				d[e.to] = d[u] + e.w
				if e.w == 0 {
					dq = append([]int{e.to}, dq...)
				} else {
					dq = append(dq, e.to)
				}
			}
		}
	}
	return d
}

func bidirectional(adj [][]Edge, n, s, t int) int {
	df := oneSided(adj, n, s)
	db := oneSided(adj, n, t) // undirected graph, so reverse == same adj
	const INF = 1 << 30
	best := INF
	for v := 0; v < n; v++ {
		if df[v] < INF && db[v] < INF && df[v]+db[v] < best {
			best = df[v] + db[v]
		}
	}
	if best == INF {
		return -1
	}
	return best
}

func main() {
	n := 5
	adj := make([][]Edge, n)
	add := func(u, v, w int) { adj[u] = append(adj[u], Edge{v, w}); adj[v] = append(adj[v], Edge{u, w}) }
	add(0, 1, 1)
	add(1, 2, 0)
	add(2, 3, 1)
	add(3, 4, 0)
	fmt.Println(bidirectional(adj, n, 0, 4)) // 2
}
```

#### Java
```java
import java.util.*;

public class Task15 {
    static int[] oneSided(List<int[]>[] adj, int n, int s) {
        int INF = Integer.MAX_VALUE / 2;
        int[] d = new int[n];
        Arrays.fill(d, INF);
        d[s] = 0;
        Deque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(s);
        while (!dq.isEmpty()) {
            int u = dq.pollFirst();
            for (int[] e : adj[u])
                if (d[u] + e[1] < d[e[0]]) {
                    d[e[0]] = d[u] + e[1];
                    if (e[1] == 0) dq.addFirst(e[0]); else dq.addLast(e[0]);
                }
        }
        return d;
    }

    static int bidirectional(List<int[]>[] adj, int n, int s, int t) {
        int[] df = oneSided(adj, n, s), db = oneSided(adj, n, t);
        int INF = Integer.MAX_VALUE / 2, best = INF;
        for (int v = 0; v < n; v++)
            if (df[v] < INF && db[v] < INF) best = Math.min(best, df[v] + db[v]);
        return best == INF ? -1 : best;
    }

    public static void main(String[] args) {
        int n = 5;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] e = {{0, 1, 1}, {1, 2, 0}, {2, 3, 1}, {3, 4, 0}};
        for (int[] x : e) {
            adj[x[0]].add(new int[]{x[1], x[2]});
            adj[x[1]].add(new int[]{x[0], x[2]});
        }
        System.out.println(bidirectional(adj, n, 0, 4)); // 2
    }
}
```

#### Python
```python
from collections import deque

def one_sided(adj, n, s):
    INF = float("inf")
    d = [INF] * n
    d[s] = 0
    dq = deque([s])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if d[u] + w < d[v]:
                d[v] = d[u] + w
                (dq.appendleft if w == 0 else dq.append)(v)
    return d

def bidirectional(adj, n, s, t):
    df, db = one_sided(adj, n, s), one_sided(adj, n, t)
    INF = float("inf")
    best = min((df[v] + db[v] for v in range(n) if df[v] < INF and db[v] < INF), default=INF)
    return -1 if best == INF else best

if __name__ == "__main__":
    n = 5
    adj = [[] for _ in range(n)]
    for u, v, w in [(0, 1, 1), (1, 2, 0), (2, 3, 1), (3, 4, 0)]:
        adj[u].append((v, w))
        adj[v].append((u, w))
    print(bidirectional(adj, n, 0, 4))  # 2
```

---

## Benchmark Task — 0-1 BFS vs Dijkstra on a large grid

**Problem.** Generate a large random 0/1-weighted grid and measure wall-clock time of 0-1 BFS against binary-heap Dijkstra computing the same single-source distances. Confirm the results match and that 0-1 BFS is faster by roughly the `log V` factor.

**What to measure.** For `N = R·C` up to a few million: time both, assert identical distance arrays, report the speedup.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"time"
)

func gridAdj(R, C int) ([][]int, []int) {
	// flatten; weight = entering cell value (0 or 1)
	w := make([]int, R*C)
	for i := range w {
		w[i] = rand.Intn(2)
	}
	return nil, w
}

func zeroOneGrid(R, C int, w []int) []int {
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = w[0]
	dq := make([]int, 0, R*C)
	dq = append(dq, 0)
	head := 0
	front := []int{} // reversed front stack for O(1) push_front
	pop := func() int {
		if len(front) > 0 {
			x := front[len(front)-1]
			front = front[:len(front)-1]
			return x
		}
		x := dq[head]
		head++
		return x
	}
	empty := func() bool { return len(front) == 0 && head >= len(dq) }
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for !empty() {
		cur := pop()
		r, c := cur/C, cur%C
		for _, d := range dirs {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= R || nc < 0 || nc >= C {
				continue
			}
			nid := nr*C + nc
			ww := w[nid]
			if dist[cur]+ww < dist[nid] {
				dist[nid] = dist[cur] + ww
				if ww == 0 {
					front = append(front, nid)
				} else {
					dq = append(dq, nid)
				}
			}
		}
	}
	return dist
}

type item struct{ d, v int }
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(item)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); it := o[n-1]; *p = o[:n-1]; return it }

func dijkstraGrid(R, C int, w []int) []int {
	const INF = 1 << 30
	dist := make([]int, R*C)
	for i := range dist {
		dist[i] = INF
	}
	dist[0] = w[0]
	h := &pq{{w[0], 0}}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for h.Len() > 0 {
		it := heap.Pop(h).(item)
		if it.d > dist[it.v] {
			continue
		}
		r, c := it.v/C, it.v%C
		for _, d := range dirs {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= R || nc < 0 || nc >= C {
				continue
			}
			nid := nr*C + nc
			if dist[it.v]+w[nid] < dist[nid] {
				dist[nid] = dist[it.v] + w[nid]
				heap.Push(h, item{dist[nid], nid})
			}
		}
	}
	return dist
}

func main() {
	R, C := 1000, 1000
	_, w := gridAdj(R, C)

	t0 := time.Now()
	a := zeroOneGrid(R, C, w)
	t1 := time.Now()
	b := dijkstraGrid(R, C, w)
	t2 := time.Now()

	for i := range a {
		if a[i] != b[i] {
			panic("mismatch")
		}
	}
	fmt.Printf("0-1 BFS:  %v\n", t1.Sub(t0))
	fmt.Printf("Dijkstra: %v\n", t2.Sub(t1))
}
```

#### Java
```java
import java.util.*;

public class Benchmark {
    static int[] zeroOne(int R, int C, int[] w) {
        int INF = Integer.MAX_VALUE / 2, N = R * C;
        int[] dist = new int[N];
        Arrays.fill(dist, INF);
        dist[0] = w[0];
        ArrayDeque<Integer> dq = new ArrayDeque<>();
        dq.addFirst(0);
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!dq.isEmpty()) {
            int cur = dq.pollFirst(), r = cur / C, c = cur % C;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
                int nid = nr * C + nc;
                if (dist[cur] + w[nid] < dist[nid]) {
                    dist[nid] = dist[cur] + w[nid];
                    if (w[nid] == 0) dq.addFirst(nid); else dq.addLast(nid);
                }
            }
        }
        return dist;
    }

    static int[] dijkstra(int R, int C, int[] w) {
        int INF = Integer.MAX_VALUE / 2, N = R * C;
        int[] dist = new int[N];
        Arrays.fill(dist, INF);
        dist[0] = w[0];
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{w[0], 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!pq.isEmpty()) {
            int[] it = pq.poll();
            if (it[0] > dist[it[1]]) continue;
            int r = it[1] / C, c = it[1] % C;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
                int nid = nr * C + nc;
                if (dist[it[1]] + w[nid] < dist[nid]) {
                    dist[nid] = dist[it[1]] + w[nid];
                    pq.add(new int[]{dist[nid], nid});
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int R = 1000, C = 1000, N = R * C;
        int[] w = new int[N];
        Random rnd = new Random(7);
        for (int i = 0; i < N; i++) w[i] = rnd.nextInt(2);

        long t0 = System.nanoTime();
        int[] a = zeroOne(R, C, w);
        long t1 = System.nanoTime();
        int[] b = dijkstra(R, C, w);
        long t2 = System.nanoTime();

        if (!Arrays.equals(a, b)) throw new AssertionError("mismatch");
        System.out.printf("0-1 BFS:  %.1f ms%n", (t1 - t0) / 1e6);
        System.out.printf("Dijkstra: %.1f ms%n", (t2 - t1) / 1e6);
    }
}
```

#### Python
```python
import heapq
import random
import time
from collections import deque

def zero_one(R, C, w):
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = w[0]
    dq = deque([0])
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while dq:
        cur = dq.popleft()
        r, c = divmod(cur, C)
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                nid = nr * C + nc
                if dist[cur] + w[nid] < dist[nid]:
                    dist[nid] = dist[cur] + w[nid]
                    (dq.appendleft if w[nid] == 0 else dq.append)(nid)
    return dist

def dijkstra(R, C, w):
    INF = float("inf")
    dist = [INF] * (R * C)
    dist[0] = w[0]
    pq = [(w[0], 0)]
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while pq:
        d, v = heapq.heappop(pq)
        if d > dist[v]:
            continue
        r, c = divmod(v, C)
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                nid = nr * C + nc
                if dist[v] + w[nid] < dist[nid]:
                    dist[nid] = dist[v] + w[nid]
                    heapq.heappush(pq, (dist[nid], nid))
    return dist

if __name__ == "__main__":
    R = C = 400
    w = [random.randint(0, 1) for _ in range(R * C)]
    t0 = time.perf_counter(); a = zero_one(R, C, w); t1 = time.perf_counter()
    b = dijkstra(R, C, w); t2 = time.perf_counter()
    assert a == b
    print(f"0-1 BFS:  {(t1 - t0) * 1000:.1f} ms")
    print(f"Dijkstra: {(t2 - t1) * 1000:.1f} ms")
```

**Expected outcome.** Identical distance arrays; 0-1 BFS roughly 2–3× faster than the heap Dijkstra at large `N`, owing to the eliminated `log V` heap operations and superior cache locality of the deque.
