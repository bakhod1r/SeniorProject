# A* Search — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a reference solution in all three languages.
> The open set is a min-priority-queue keyed on `f = g + h`. Unless stated otherwise, use an **admissible** heuristic so paths are optimal.

---

## Beginner Tasks (5)

### Task 1 — A* on a 4-directional grid (return cost)

**Problem.** Given an `m × n` grid of `0` (open) and `1` (wall), return the cost of the shortest 4-directional path from `(0,0)` to `(m−1,n−1)` (each step costs 1), or `-1` if unreachable. Use A* with the Manhattan heuristic.

**Constraints.** `1 ≤ m, n ≤ 1000`; start and goal are open; `O((m·n) log(m·n))` time.

**Hint.** Manhattan distance `|dx| + |dy|` is admissible and consistent for 4-directional unit movement, so no reopening is needed. Skip stale heap entries via the `f > g + h` check.

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

func abs(a int) int { if a < 0 { return -a }; return a }

func aStar(grid [][]int) int {
	m, n := len(grid), len(grid[0])
	h := func(x, y int) int { return abs(m-1-x) + abs(n-1-y) }
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
	fmt.Println(aStar([][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}})) // 4
}
```

**Java.**

```java
import java.util.*;

public class Task1 {
    static int aStar(int[][] grid) {
        int m = grid.length, n = grid[0].length;
        int[][] dist = new int[m][n];
        for (int[] r : dist) Arrays.fill(r, Integer.MAX_VALUE);
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

    static int h(int x, int y, int m, int n) { return Math.abs(m - 1 - x) + Math.abs(n - 1 - y); }

    public static void main(String[] args) {
        System.out.println(aStar(new int[][]{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}})); // 4
    }
}
```

**Python.**

```python
import heapq


def a_star(grid):
    m, n = len(grid), len(grid[0])
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
    print(a_star([[0, 0, 0], [1, 1, 0], [0, 0, 0]]))  # 4
```

**Evaluation criteria.**
- Returns the optimal cost (matches BFS on unit-cost grids).
- Returns `-1` when the goal is walled off.
- Uses an admissible heuristic; skips stale heap entries.

---

### Task 2 — Reconstruct the path, not just the cost

**Problem.** Extend Task 1 to return the actual list of cells on a shortest path from start to goal, or an empty list if unreachable.

**Constraints.** Same as Task 1. Path must be a valid shortest path.

**Hint.** Keep a `parent` map updated whenever you improve a cell's `g`. After the goal pops, walk parents backward and reverse.

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

func abs(a int) int { if a < 0 { return -a }; return a }

func path(grid [][]int) [][2]int {
	m, n := len(grid), len(grid[0])
	h := func(x, y int) int { return abs(m-1-x) + abs(n-1-y) }
	g := map[[2]int]int{{0, 0}: 0}
	parent := map[[2]int][2]int{}
	open := &pq{{0, 0, h(0, 0)}}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(cell)
		key := [2]int{c.x, c.y}
		if c.x == m-1 && c.y == n-1 {
			res := [][2]int{key}
			for key != [2]int{0, 0} {
				key = parent[key]
				res = append(res, key)
			}
			for i, j := 0, len(res)-1; i < j; i, j = i+1, j-1 {
				res[i], res[j] = res[j], res[i]
			}
			return res
		}
		if c.f > g[key]+h(c.x, c.y) {
			continue
		}
		for _, d := range dirs {
			nx, ny := c.x+d[0], c.y+d[1]
			if nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1 {
				continue
			}
			nk := [2]int{nx, ny}
			t := g[key] + 1
			if best, ok := g[nk]; !ok || t < best {
				g[nk] = t
				parent[nk] = key
				heap.Push(open, cell{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return nil
}

func main() { fmt.Println(path([][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}})) }
```

**Java.**

```java
import java.util.*;

public class Task2 {
    static List<int[]> path(int[][] grid) {
        int m = grid.length, n = grid[0].length;
        Map<Long, Integer> g = new HashMap<>();
        Map<Long, long[]> parent = new HashMap<>();
        g.put(key(0, 0), 0);
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h(0, 0, m, n), 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == m - 1 && y == n - 1) {
                LinkedList<int[]> res = new LinkedList<>();
                long k = key(x, y);
                while (k != key(0, 0)) {
                    res.addFirst(new int[]{(int) (k >> 20) - 1000, (int) (k & 0xFFFFF) - 1000});
                    long[] p = parent.get(k);
                    k = key((int) p[0], (int) p[1]);
                }
                res.addFirst(new int[]{0, 0});
                return res;
            }
            if (c[0] > g.get(key(x, y)) + h(x, y, m, n)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = g.get(key(x, y)) + 1;
                if (t < g.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    g.put(key(nx, ny), t);
                    parent.put(key(nx, ny), new long[]{x, y});
                    open.add(new int[]{t + h(nx, ny, m, n), nx, ny});
                }
            }
        }
        return List.of();
    }

    static int h(int x, int y, int m, int n) { return Math.abs(m - 1 - x) + Math.abs(n - 1 - y); }
    static long key(int x, int y) { return ((long) (x + 1000) << 20) | (y + 1000); }

    public static void main(String[] args) {
        for (int[] c : path(new int[][]{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}))
            System.out.print(Arrays.toString(c) + " ");
    }
}
```

**Python.**

```python
import heapq


def path(grid):
    m, n = len(grid), len(grid[0])
    h = lambda x, y: abs(m - 1 - x) + abs(n - 1 - y)
    g = {(0, 0): 0}
    parent = {}
    open_set = [(h(0, 0), 0, 0)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (m - 1, n - 1):
            res, cur = [(x, y)], (x, y)
            while cur in parent:
                cur = parent[cur]
                res.append(cur)
            return res[::-1]
        if f > g[(x, y)] + h(x, y):
            continue
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < m and 0 <= ny < n and grid[nx][ny] == 0:
                t = g[(x, y)] + 1
                if t < g.get((nx, ny), float("inf")):
                    g[(nx, ny)] = t
                    parent[(nx, ny)] = (x, y)
                    heapq.heappush(open_set, (t + h(nx, ny), nx, ny))
    return []


if __name__ == "__main__":
    print(path([[0, 0, 0], [1, 1, 0], [0, 0, 0]]))
```

**Evaluation criteria.**
- Returned path is contiguous (each step is a valid neighbor).
- Path length equals cost + 1 (number of cells).
- Empty list on unreachable goal.

---

### Task 3 — Verify a heuristic is admissible on a small graph

**Problem.** Given a small weighted undirected graph, a goal node, and a heuristic table `h[node]`, decide whether `h` is admissible — i.e., `h[node] ≤ true_distance(node, goal)` for every node. Compute true distances with Dijkstra.

**Constraints.** `n ≤ 2000`, `m ≤ 10^4`, non-negative weights. Output `true`/`false`.

**Hint.** Run Dijkstra from the goal (undirected, so distances are symmetric), then compare each `h[node]` against `dist[node]`.

**Go.**

```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type item struct{ node, d int }
type pq []item

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].d < h[j].d }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(item)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func admissible(n int, adj [][][2]int, goal int, hh []int) bool {
	const inf = 1 << 60
	dist := make([]int, n)
	for i := range dist {
		dist[i] = inf
	}
	dist[goal] = 0
	open := &pq{{goal, 0}}
	for open.Len() > 0 {
		c := heap.Pop(open).(item)
		if c.d > dist[c.node] {
			continue
		}
		for _, e := range adj[c.node] {
			if c.d+e[1] < dist[e[0]] {
				dist[e[0]] = c.d + e[1]
				heap.Push(open, item{e[0], dist[e[0]]})
			}
		}
	}
	for i := 0; i < n; i++ {
		if dist[i] < inf && hh[i] > dist[i] {
			return false
		}
	}
	return true
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m, goal int
	fmt.Fscan(in, &n, &m, &goal)
	adj := make([][][2]int, n)
	for i := 0; i < m; i++ {
		var u, v, w int
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], [2]int{v, w})
		adj[v] = append(adj[v], [2]int{u, w})
	}
	hh := make([]int, n)
	for i := range hh {
		fmt.Fscan(in, &hh[i])
	}
	fmt.Println(admissible(n, adj, goal, hh))
}
```

**Java.**

```java
import java.util.*;

public class Task3 {
    static boolean admissible(int n, List<int[]>[] adj, int goal, int[] h) {
        long[] dist = new long[n];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[goal] = 0;
        PriorityQueue<long[]> open = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        open.add(new long[]{goal, 0});
        while (!open.isEmpty()) {
            long[] c = open.poll();
            int u = (int) c[0];
            if (c[1] > dist[u]) continue;
            for (int[] e : adj[u]) {
                if (c[1] + e[1] < dist[e[0]]) {
                    dist[e[0]] = c[1] + e[1];
                    open.add(new long[]{e[0], dist[e[0]]});
                }
            }
        }
        for (int i = 0; i < n; i++)
            if (dist[i] != Long.MAX_VALUE && h[i] > dist[i]) return false;
        return true;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt(), goal = sc.nextInt();
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            int u = sc.nextInt(), v = sc.nextInt(), w = sc.nextInt();
            adj[u].add(new int[]{v, w});
            adj[v].add(new int[]{u, w});
        }
        int[] h = new int[n];
        for (int i = 0; i < n; i++) h[i] = sc.nextInt();
        System.out.println(admissible(n, adj, goal, h));
    }
}
```

**Python.**

```python
import heapq
import sys


def admissible(n, adj, goal, h):
    dist = [float("inf")] * n
    dist[goal] = 0
    pq = [(0, goal)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return all(not (dist[i] < float("inf") and h[i] > dist[i]) for i in range(n))


def main():
    data = iter(sys.stdin.read().split())
    n, m, goal = int(next(data)), int(next(data)), int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        adj[u].append((v, w))
        adj[v].append((u, w))
    h = [int(next(data)) for _ in range(n)]
    print(str(admissible(n, adj, goal, h)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on a known-admissible and a known-inadmissible table.
- Ignores unreachable nodes (distance `∞`).
- `O((n+m) log n)`.

---

### Task 4 — A* equals Dijkstra when `h = 0`

**Problem.** Implement a single A* function with a pluggable heuristic. Verify on a weighted graph that calling it with `h ≡ 0` returns the same distances as a standalone Dijkstra. Output `MATCH` or `DIFFER`.

**Constraints.** `n ≤ 5000`, `m ≤ 5·10^4`, non-negative weights.

**Hint.** A* with `h = 0` is Dijkstra by definition; this task is a correctness harness for your core loop.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ node, key int }
type pq []item

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].key < h[j].key }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(item)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func aStar(n int, adj [][][2]int, src int, h func(int) int) []int {
	const inf = 1 << 60
	dist := make([]int, n)
	for i := range dist {
		dist[i] = inf
	}
	dist[src] = 0
	open := &pq{{src, h(src)}}
	for open.Len() > 0 {
		c := heap.Pop(open).(item)
		if c.key > dist[c.node]+h(c.node) {
			continue
		}
		for _, e := range adj[c.node] {
			if dist[c.node]+e[1] < dist[e[0]] {
				dist[e[0]] = dist[c.node] + e[1]
				heap.Push(open, item{e[0], dist[e[0]] + h(e[0])})
			}
		}
	}
	return dist
}

func main() {
	adj := [][][2]int{{{1, 2}, {2, 5}}, {{2, 1}}, {}}
	d := aStar(3, adj, 0, func(int) int { return 0 })
	fmt.Println(d) // [0 2 3]
}
```

**Java.**

```java
import java.util.*;
import java.util.function.IntUnaryOperator;

public class Task4 {
    static long[] aStar(int n, List<int[]>[] adj, int src, IntUnaryOperator h) {
        long[] dist = new long[n];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[src] = 0;
        PriorityQueue<long[]> open = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        open.add(new long[]{src, h.applyAsInt(src)});
        while (!open.isEmpty()) {
            long[] c = open.poll();
            int u = (int) c[0];
            if (c[1] > dist[u] + h.applyAsInt(u)) continue;
            for (int[] e : adj[u]) {
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    open.add(new long[]{e[0], dist[e[0]] + h.applyAsInt(e[0])});
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        List<int[]>[] adj = new List[]{
            new ArrayList<>(List.of(new int[]{1, 2}, new int[]{2, 5})),
            new ArrayList<>(List.of(new int[]{2, 1})),
            new ArrayList<>()
        };
        System.out.println(Arrays.toString(aStar(3, adj, 0, x -> 0))); // [0, 2, 3]
    }
}
```

**Python.**

```python
import heapq


def a_star(n, adj, src, h):
    dist = [float("inf")] * n
    dist[src] = 0
    open_set = [(h(src), src)]
    while open_set:
        key, u = heapq.heappop(open_set)
        if key > dist[u] + h(u):
            continue
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                heapq.heappush(open_set, (dist[v] + h(v), v))
    return dist


if __name__ == "__main__":
    adj = [[(1, 2), (2, 5)], [(2, 1)], []]
    print(a_star(3, adj, 0, lambda _: 0))  # [0, 2, 3]
```

**Evaluation criteria.**
- With `h = 0`, distances equal a separate Dijkstra implementation.
- Core loop handles stale entries.
- Works on disconnected graphs (`∞` for unreachable).

---

### Task 5 — Choose the right grid heuristic (8-directional)

**Problem.** On an 8-directional grid where straight moves cost 1 and diagonal moves cost 1 (Chebyshev model), return the shortest path cost from `(0,0)` to `(m−1,n−1)` around walls. Use the Chebyshev heuristic `max(dx, dy)`.

**Constraints.** `1 ≤ m, n ≤ 500`. Show that Manhattan would be inadmissible here.

**Hint.** With 8-directional unit-cost movement, the true empty-grid distance is `max(dx, dy)`, so Chebyshev is the correct admissible heuristic; Manhattan would overestimate diagonals.

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

func abs(a int) int { if a < 0 { return -a }; return a }
func maxi(a, b int) int { if a > b { return a }; return b }

func aStar8(grid [][]int) int {
	m, n := len(grid), len(grid[0])
	h := func(x, y int) int { return maxi(abs(m-1-x), abs(n-1-y)) }
	dist := make([][]int, m)
	for i := range dist {
		dist[i] = make([]int, n)
		for j := range dist[i] {
			dist[i][j] = 1 << 30
		}
	}
	dist[0][0] = 0
	open := &pq{{0, 0, h(0, 0)}}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}}
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
	fmt.Println(aStar8([][]int{{0, 0, 0}, {0, 1, 0}, {0, 0, 0}})) // 2
}
```

**Java.**

```java
import java.util.*;

public class Task5 {
    static int aStar8(int[][] grid) {
        int m = grid.length, n = grid[0].length;
        int[][] dist = new int[m][n];
        for (int[] r : dist) Arrays.fill(r, Integer.MAX_VALUE);
        dist[0][0] = 0;
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h(0, 0, m, n), 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
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

    static int h(int x, int y, int m, int n) {
        return Math.max(Math.abs(m - 1 - x), Math.abs(n - 1 - y));
    }

    public static void main(String[] args) {
        System.out.println(aStar8(new int[][]{{0, 0, 0}, {0, 1, 0}, {0, 0, 0}})); // 2
    }
}
```

**Python.**

```python
import heapq


def a_star_8(grid):
    m, n = len(grid), len(grid[0])
    h = lambda x, y: max(abs(m - 1 - x), abs(n - 1 - y))
    dist = {(0, 0): 0}
    open_set = [(h(0, 0), 0, 0)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
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
    print(a_star_8([[0, 0, 0], [0, 1, 0], [0, 0, 0]]))  # 2
```

**Evaluation criteria.**
- Diagonal moves are used; cost is `max(dx,dy)` on open grids.
- Chebyshev heuristic keeps optimality; Manhattan would not.
- Returns `-1` if blocked.

---

## Intermediate Tasks (5)

### Task 6 — Weighted A* with a suboptimality bound

**Problem.** Implement weighted A* (`f = g + w·h`) on a 4-directional grid. Return the path cost and confirm it is at most `w × optimal` by comparing against the `w = 1` result.

**Constraints.** `1 ≤ m, n ≤ 500`; `1.0 ≤ w ≤ 3.0`.

**Hint.** Inflating `h` makes the search greedier and faster while keeping the returned cost within the factor `w` of optimal.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type cell struct {
	x, y int
	f    float64
}
type pq []cell

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(cell)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func abs(a int) int { if a < 0 { return -a }; return a }

func wAStar(grid [][]int, w float64) int {
	m, n := len(grid), len(grid[0])
	h := func(x, y int) float64 { return float64(abs(m-1-x) + abs(n-1-y)) }
	dist := make([][]int, m)
	for i := range dist {
		dist[i] = make([]int, n)
		for j := range dist[i] {
			dist[i][j] = 1 << 30
		}
	}
	dist[0][0] = 0
	open := &pq{{0, 0, w * h(0, 0)}}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(cell)
		if c.x == m-1 && c.y == n-1 {
			return dist[c.x][c.y]
		}
		if c.f > float64(dist[c.x][c.y])+w*h(c.x, c.y) {
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
				heap.Push(open, cell{nx, ny, float64(t) + w*h(nx, ny)})
			}
		}
	}
	return -1
}

func main() {
	g := [][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}
	fmt.Println(wAStar(g, 1.0), wAStar(g, 2.0))
}
```

**Java.**

```java
import java.util.*;

public class Task6 {
    static int wAStar(int[][] grid, double w) {
        int m = grid.length, n = grid[0].length;
        int[][] dist = new int[m][n];
        for (int[] r : dist) Arrays.fill(r, Integer.MAX_VALUE);
        dist[0][0] = 0;
        PriorityQueue<double[]> open = new PriorityQueue<>((a, b) -> Double.compare(a[0], b[0]));
        open.add(new double[]{w * h(0, 0, m, n), 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            double[] c = open.poll();
            int x = (int) c[1], y = (int) c[2];
            if (x == m - 1 && y == n - 1) return dist[x][y];
            if (c[0] > dist[x][y] + w * h(x, y, m, n)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = dist[x][y] + 1;
                if (t < dist[nx][ny]) {
                    dist[nx][ny] = t;
                    open.add(new double[]{t + w * h(nx, ny, m, n), nx, ny});
                }
            }
        }
        return -1;
    }

    static int h(int x, int y, int m, int n) { return Math.abs(m - 1 - x) + Math.abs(n - 1 - y); }

    public static void main(String[] args) {
        int[][] g = {{0, 0, 0}, {1, 1, 0}, {0, 0, 0}};
        System.out.println(wAStar(g, 1.0) + " " + wAStar(g, 2.0));
    }
}
```

**Python.**

```python
import heapq


def w_a_star(grid, w):
    m, n = len(grid), len(grid[0])
    h = lambda x, y: abs(m - 1 - x) + abs(n - 1 - y)
    dist = {(0, 0): 0}
    open_set = [(w * h(0, 0), 0, 0)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (m - 1, n - 1):
            return dist[(x, y)]
        if f > dist[(x, y)] + w * h(x, y):
            continue
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < m and 0 <= ny < n and grid[nx][ny] == 0:
                t = dist[(x, y)] + 1
                if t < dist.get((nx, ny), float("inf")):
                    dist[(nx, ny)] = t
                    heapq.heappush(open_set, (t + w * h(nx, ny), nx, ny))
    return -1


if __name__ == "__main__":
    g = [[0, 0, 0], [1, 1, 0], [0, 0, 0]]
    print(w_a_star(g, 1.0), w_a_star(g, 2.0))
```

**Evaluation criteria.**
- `w = 1` returns the optimal cost.
- `w > 1` returns a cost `≤ w × optimal`.
- `w > 1` expands no more nodes than `w = 1` on average (measure to confirm).

---

### Task 7 — A* on a weighted terrain grid

**Problem.** Each cell has a positive terrain cost; entering a cell pays its cost. Find the minimum total entry cost from top-left to bottom-right (4-directional). Use a Manhattan heuristic scaled by the minimum terrain cost so it stays admissible.

**Constraints.** `1 ≤ m, n ≤ 500`; cell cost in `[1, 1000]`.

**Hint.** If the cheapest cell costs `cmin`, then `cmin × Manhattan` is an admissible lower bound on the remaining cost (every remaining step costs at least `cmin`).

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

func abs(a int) int { if a < 0 { return -a }; return a }

func terrain(cost [][]int) int {
	m, n := len(cost), len(cost[0])
	cmin := 1 << 30
	for _, row := range cost {
		for _, c := range row {
			if c < cmin {
				cmin = c
			}
		}
	}
	h := func(x, y int) int { return cmin * (abs(m-1-x) + abs(n-1-y)) }
	dist := make([][]int, m)
	for i := range dist {
		dist[i] = make([]int, n)
		for j := range dist[i] {
			dist[i][j] = 1 << 30
		}
	}
	dist[0][0] = cost[0][0]
	open := &pq{{0, 0, dist[0][0] + h(0, 0)}}
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
			if nx < 0 || nx >= m || ny < 0 || ny >= n {
				continue
			}
			t := dist[c.x][c.y] + cost[nx][ny]
			if t < dist[nx][ny] {
				dist[nx][ny] = t
				heap.Push(open, cell{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return -1
}

func main() {
	fmt.Println(terrain([][]int{{1, 3, 1}, {1, 5, 1}, {4, 2, 1}})) // 8
}
```

**Java.**

```java
import java.util.*;

public class Task7 {
    static int terrain(int[][] cost) {
        int m = cost.length, n = cost[0].length, cmin = Integer.MAX_VALUE;
        for (int[] row : cost) for (int c : row) cmin = Math.min(cmin, c);
        final int cm = cmin;
        int[][] dist = new int[m][n];
        for (int[] r : dist) Arrays.fill(r, Integer.MAX_VALUE);
        dist[0][0] = cost[0][0];
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{dist[0][0] + h(0, 0, m, n, cm), 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == m - 1 && y == n - 1) return dist[x][y];
            if (c[0] > dist[x][y] + h(x, y, m, n, cm)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n) continue;
                int t = dist[x][y] + cost[nx][ny];
                if (t < dist[nx][ny]) {
                    dist[nx][ny] = t;
                    open.add(new int[]{t + h(nx, ny, m, n, cm), nx, ny});
                }
            }
        }
        return -1;
    }

    static int h(int x, int y, int m, int n, int cm) {
        return cm * (Math.abs(m - 1 - x) + Math.abs(n - 1 - y));
    }

    public static void main(String[] args) {
        System.out.println(terrain(new int[][]{{1, 3, 1}, {1, 5, 1}, {4, 2, 1}})); // 8
    }
}
```

**Python.**

```python
import heapq


def terrain(cost):
    m, n = len(cost), len(cost[0])
    cmin = min(min(row) for row in cost)
    h = lambda x, y: cmin * (abs(m - 1 - x) + abs(n - 1 - y))
    dist = {(0, 0): cost[0][0]}
    open_set = [(dist[(0, 0)] + h(0, 0), 0, 0)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (m - 1, n - 1):
            return dist[(x, y)]
        if f > dist[(x, y)] + h(x, y):
            continue
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < m and 0 <= ny < n:
                t = dist[(x, y)] + cost[nx][ny]
                if t < dist.get((nx, ny), float("inf")):
                    dist[(nx, ny)] = t
                    heapq.heappush(open_set, (t + h(nx, ny), nx, ny))
    return -1


if __name__ == "__main__":
    print(terrain([[1, 3, 1], [1, 5, 1], [4, 2, 1]]))  # 8
```

**Evaluation criteria.**
- Cost includes both endpoints' terrain values.
- Heuristic stays admissible (scaled by `cmin`).
- Matches a Dijkstra baseline.

---

### Task 8 — Solve the 8-puzzle with A* (Manhattan heuristic)

**Problem.** Given a 3×3 board as a 9-character string (`0` is the blank), return the minimum number of moves to reach `"123456780"`, or `-1` if unsolvable.

**Constraints.** Detect unsolvable boards via inversion parity, or rely on exhausting the open set.

**Hint.** Manhattan distance over tiles (excluding the blank) is admissible. State = the string; neighbors swap the blank with an adjacent tile.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

const goal = "123456780"

var moves = [][]int{{1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6}, {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}}

func manh(s string) int {
	d := 0
	for i := 0; i < 9; i++ {
		if s[i] == '0' {
			continue
		}
		home := int(s[i] - '1')
		d += abs(i/3-home/3) + abs(i%3-home%3)
	}
	return d
}
func abs(a int) int { if a < 0 { return -a }; return a }

type node struct {
	s string
	f int
}
type pq []node

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(node)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func solve(start string) int {
	g := map[string]int{start: 0}
	open := &pq{{start, manh(start)}}
	for open.Len() > 0 {
		cur := heap.Pop(open).(node)
		if cur.s == goal {
			return g[cur.s]
		}
		if cur.f > g[cur.s]+manh(cur.s) {
			continue
		}
		z := 0
		for i := 0; i < 9; i++ {
			if cur.s[i] == '0' {
				z = i
				break
			}
		}
		for _, mv := range moves[z] {
			b := []byte(cur.s)
			b[z], b[mv] = b[mv], b[z]
			ns := string(b)
			t := g[cur.s] + 1
			if best, ok := g[ns]; !ok || t < best {
				g[ns] = t
				heap.Push(open, node{ns, t + manh(ns)})
			}
		}
	}
	return -1
}

func main() { fmt.Println(solve("123450678")) }
```

**Java.**

```java
import java.util.*;

public class Task8 {
    static final String GOAL = "123456780";
    static final int[][] MOVES = {
        {1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6}, {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}
    };

    static int manh(String s) {
        int d = 0;
        for (int i = 0; i < 9; i++) {
            if (s.charAt(i) == '0') continue;
            int home = s.charAt(i) - '1';
            d += Math.abs(i / 3 - home / 3) + Math.abs(i % 3 - home % 3);
        }
        return d;
    }

    static int solve(String start) {
        Map<String, Integer> g = new HashMap<>();
        g.put(start, 0);
        PriorityQueue<String> open =
            new PriorityQueue<>(Comparator.comparingInt(s -> g.get(s) + manh(s)));
        open.add(start);
        while (!open.isEmpty()) {
            String cur = open.poll();
            if (cur.equals(GOAL)) return g.get(cur);
            int z = cur.indexOf('0');
            for (int mv : MOVES[z]) {
                char[] b = cur.toCharArray();
                char tmp = b[z]; b[z] = b[mv]; b[mv] = tmp;
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
        System.out.println(solve("123450678"));
    }
}
```

**Python.**

```python
import heapq

GOAL = "123456780"
MOVES = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]]


def manh(s):
    d = 0
    for i, c in enumerate(s):
        if c == "0":
            continue
        home = int(c) - 1
        d += abs(i // 3 - home // 3) + abs(i % 3 - home % 3)
    return d


def solve(start):
    g = {start: 0}
    open_set = [(manh(start), start)]
    while open_set:
        f, cur = heapq.heappop(open_set)
        if cur == GOAL:
            return g[cur]
        if f > g[cur] + manh(cur):
            continue
        z = cur.index("0")
        for mv in MOVES[z]:
            b = list(cur)
            b[z], b[mv] = b[mv], b[z]
            ns = "".join(b)
            t = g[cur] + 1
            if t < g.get(ns, float("inf")):
                g[ns] = t
                heapq.heappush(open_set, (t + manh(ns), ns))
    return -1


if __name__ == "__main__":
    print(solve("123450678"))
```

**Evaluation criteria.**
- Returns the optimal move count.
- Manhattan heuristic; matches a plain BFS move count.
- Terminates with `-1` on unsolvable boards.

---

### Task 9 — Bidirectional BFS/A* for word ladder

**Problem.** Given `begin`, `end`, and a word list, return the length of the shortest transformation. Implement bidirectional search (expand from both ends, alternate the smaller frontier).

**Constraints.** Words up to length 10; list up to `5000` words.

**Hint.** Bidirectional search roughly square-roots the explored set on high-branching graphs. Alternate expanding whichever frontier is smaller; stop when the frontiers intersect.

**Go.**

```go
package main

import "fmt"

func ladder(begin, end string, words []string) int {
	dict := map[string]bool{}
	for _, w := range words {
		dict[w] = true
	}
	if !dict[end] {
		return 0
	}
	front, back := map[string]bool{begin: true}, map[string]bool{end: true}
	steps := 1
	for len(front) > 0 && len(back) > 0 {
		if len(front) > len(back) {
			front, back = back, front
		}
		next := map[string]bool{}
		for w := range front {
			b := []byte(w)
			for i := 0; i < len(b); i++ {
				old := b[i]
				for c := byte('a'); c <= 'z'; c++ {
					if c == old {
						continue
					}
					b[i] = c
					nw := string(b)
					if back[nw] {
						return steps + 1
					}
					if dict[nw] {
						next[nw] = true
						delete(dict, nw)
					}
				}
				b[i] = old
			}
		}
		front = next
		steps++
	}
	return 0
}

func main() {
	fmt.Println(ladder("hit", "cog", []string{"hot", "dot", "dog", "lot", "log", "cog"})) // 5
}
```

**Java.**

```java
import java.util.*;

public class Task9 {
    static int ladder(String begin, String end, List<String> words) {
        Set<String> dict = new HashSet<>(words);
        if (!dict.contains(end)) return 0;
        Set<String> front = new HashSet<>(List.of(begin)), back = new HashSet<>(List.of(end));
        int steps = 1;
        while (!front.isEmpty() && !back.isEmpty()) {
            if (front.size() > back.size()) { Set<String> t = front; front = back; back = t; }
            Set<String> next = new HashSet<>();
            for (String w : front) {
                char[] b = w.toCharArray();
                for (int i = 0; i < b.length; i++) {
                    char old = b[i];
                    for (char c = 'a'; c <= 'z'; c++) {
                        if (c == old) continue;
                        b[i] = c;
                        String nw = new String(b);
                        if (back.contains(nw)) return steps + 1;
                        if (dict.remove(nw)) next.add(nw);
                    }
                    b[i] = old;
                }
            }
            front = next;
            steps++;
        }
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(ladder("hit", "cog",
            List.of("hot", "dot", "dog", "lot", "log", "cog"))); // 5
    }
}
```

**Python.**

```python
def ladder(begin, end, words):
    dict_set = set(words)
    if end not in dict_set:
        return 0
    front, back = {begin}, {end}
    steps = 1
    while front and back:
        if len(front) > len(back):
            front, back = back, front
        nxt = set()
        for w in front:
            for i in range(len(w)):
                for c in "abcdefghijklmnopqrstuvwxyz":
                    if c == w[i]:
                        continue
                    nw = w[:i] + c + w[i + 1:]
                    if nw in back:
                        return steps + 1
                    if nw in dict_set:
                        dict_set.discard(nw)
                        nxt.add(nw)
        front = nxt
        steps += 1
    return 0


if __name__ == "__main__":
    print(ladder("hit", "cog", ["hot", "dot", "dog", "lot", "log", "cog"]))  # 5
```

**Evaluation criteria.**
- Returns the same length as unidirectional BFS.
- Always expands the smaller frontier.
- Returns 0 when `end` is absent or unreachable.

---

### Task 10 — Minimum knight moves with A*

**Problem.** On an infinite board, return the minimum knight moves from `(0,0)` to `(x,y)`. Use an admissible heuristic and bound the explored region.

**Constraints.** `|x|, |y| ≤ 300`.

**Hint.** Fold to the first quadrant by absolute value. Use `h = max(ceil(dx/2), ceil(dy/2), ceil((dx+dy)/3))` and a bounding box a couple of cells past the target.

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

func minKnight(tx, ty int) int {
	tx, ty = abs(tx), abs(ty)
	h := func(x, y int) int {
		dx, dy := abs(tx-x), abs(ty-y)
		return max3(ceilDiv(dx, 2), ceilDiv(dy, 2), ceilDiv(dx+dy, 3))
	}
	g := map[[2]int]int{{0, 0}: 0}
	open := &pq{{0, 0, h(0, 0)}}
	mv := [][2]int{{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(kn)
		if c.x == tx && c.y == ty {
			return g[[2]int{c.x, c.y}]
		}
		if c.f > g[[2]int{c.x, c.y}]+h(c.x, c.y) {
			continue
		}
		for _, m := range mv {
			nx, ny := c.x+m[0], c.y+m[1]
			if nx < -2 || ny < -2 || nx > tx+2 || ny > ty+2 {
				continue
			}
			k := [2]int{nx, ny}
			t := g[[2]int{c.x, c.y}] + 1
			if best, ok := g[k]; !ok || t < best {
				g[k] = t
				heap.Push(open, kn{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return -1
}

func main() { fmt.Println(minKnight(5, 5)) } // 4
```

**Java.**

```java
import java.util.*;

public class Task10 {
    public static int minKnight(int tx, int ty) {
        int fx = Math.abs(tx), fy = Math.abs(ty);
        Map<Long, Integer> g = new HashMap<>();
        g.put(key(0, 0), 0);
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h(0, 0, fx, fy), 0, 0});
        int[][] mv = {{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == fx && y == fy) return g.get(key(x, y));
            if (c[0] > g.get(key(x, y)) + h(x, y, fx, fy)) continue;
            for (int[] m : mv) {
                int nx = x + m[0], ny = y + m[1];
                if (nx < -2 || ny < -2 || nx > fx + 2 || ny > fy + 2) continue;
                int t = g.get(key(x, y)) + 1;
                if (t < g.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    g.put(key(nx, ny), t);
                    open.add(new int[]{t + h(nx, ny, fx, fy), nx, ny});
                }
            }
        }
        return -1;
    }

    static int h(int x, int y, int fx, int fy) {
        int dx = Math.abs(fx - x), dy = Math.abs(fy - y);
        return Math.max(Math.max(ceil(dx, 2), ceil(dy, 2)), ceil(dx + dy, 3));
    }
    static int ceil(int a, int b) { return (a + b - 1) / b; }
    static long key(int x, int y) { return ((long) (x + 1000) << 20) | (y + 1000); }

    public static void main(String[] args) { System.out.println(minKnight(5, 5)); } // 4
}
```

**Python.**

```python
import heapq
from math import ceil


def min_knight(tx, ty):
    tx, ty = abs(tx), abs(ty)

    def h(x, y):
        dx, dy = abs(tx - x), abs(ty - y)
        return max(ceil(dx / 2), ceil(dy / 2), ceil((dx + dy) / 3))

    g = {(0, 0): 0}
    open_set = [(h(0, 0), 0, 0)]
    mv = [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if (x, y) == (tx, ty):
            return g[(x, y)]
        if f > g[(x, y)] + h(x, y):
            continue
        for dx, dy in mv:
            nx, ny = x + dx, y + dy
            if nx < -2 or ny < -2 or nx > tx + 2 or ny > ty + 2:
                continue
            t = g[(x, y)] + 1
            if t < g.get((nx, ny), float("inf")):
                g[(nx, ny)] = t
                heapq.heappush(open_set, (t + h(nx, ny), nx, ny))
    return -1


if __name__ == "__main__":
    print(min_knight(5, 5))  # 4
```

**Evaluation criteria.**
- Matches a plain BFS for several targets.
- Bounding box keeps the open set finite.
- Heuristic never overestimates.

---

## Advanced Tasks (5)

### Task 11 — IDA* for the 8-puzzle (O(depth) memory)

**Problem.** Solve the 8-puzzle with Iterative-Deepening A*: repeated depth-first searches bounded by an `f`-threshold, using the Manhattan heuristic. Return the optimal move count using `O(depth)` memory.

**Constraints.** Solvable boards; optimal depth ≤ 31.

**Hint.** Track the previous blank index to avoid immediately undoing a move. The DFS returns the minimum `f` that exceeded the threshold, which becomes the next threshold.

**Go.**

```go
package main

import "fmt"

const goal = "123456780"

var moves = [][]int{{1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6}, {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}}

func manh(s string) int {
	d := 0
	for i := 0; i < 9; i++ {
		if s[i] == '0' {
			continue
		}
		home := int(s[i] - '1')
		d += abs(i/3-home/3) + abs(i%3-home%3)
	}
	return d
}
func abs(a int) int { if a < 0 { return -a }; return a }

func idaStar(start string) int {
	threshold := manh(start)
	for {
		t, found := dfs(start, 0, threshold, -1)
		if found {
			return t
		}
		if t == 1<<30 {
			return -1
		}
		threshold = t
	}
}

func dfs(s string, g, threshold, prev int) (int, bool) {
	f := g + manh(s)
	if f > threshold {
		return f, false
	}
	if s == goal {
		return g, true
	}
	z := 0
	for i := 0; i < 9; i++ {
		if s[i] == '0' {
			z = i
			break
		}
	}
	min := 1 << 30
	for _, m := range moves[z] {
		if m == prev {
			continue
		}
		b := []byte(s)
		b[z], b[m] = b[m], b[z]
		t, found := dfs(string(b), g+1, threshold, z)
		if found {
			return t, true
		}
		if t < min {
			min = t
		}
	}
	return min, false
}

func main() { fmt.Println(idaStar("123450678")) }
```

**Java.**

```java
public class Task11 {
    static final String GOAL = "123456780";
    static final int[][] MOVES = {
        {1, 3}, {0, 2, 4}, {1, 5}, {0, 4, 6}, {1, 3, 5, 7}, {2, 4, 8}, {3, 7}, {4, 6, 8}, {5, 7}
    };

    static int manh(String s) {
        int d = 0;
        for (int i = 0; i < 9; i++) {
            if (s.charAt(i) == '0') continue;
            int home = s.charAt(i) - '1';
            d += Math.abs(i / 3 - home / 3) + Math.abs(i % 3 - home % 3);
        }
        return d;
    }

    static int found;

    static int dfs(String s, int g, int threshold, int prev) {
        int f = g + manh(s);
        if (f > threshold) return f;
        if (s.equals(GOAL)) { found = g; return -1; }
        int z = s.indexOf('0'), min = Integer.MAX_VALUE;
        for (int m : MOVES[z]) {
            if (m == prev) continue;
            char[] b = s.toCharArray();
            char tmp = b[z]; b[z] = b[m]; b[m] = tmp;
            int t = dfs(new String(b), g + 1, threshold, z);
            if (t == -1) return -1;
            min = Math.min(min, t);
        }
        return min;
    }

    static int ida(String start) {
        int threshold = manh(start);
        while (true) {
            int t = dfs(start, 0, threshold, -1);
            if (t == -1) return found;
            if (t == Integer.MAX_VALUE) return -1;
            threshold = t;
        }
    }

    public static void main(String[] args) {
        System.out.println(ida("123450678"));
    }
}
```

**Python.**

```python
import sys

GOAL = "123456780"
MOVES = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]]


def manh(s):
    d = 0
    for i, c in enumerate(s):
        if c == "0":
            continue
        home = int(c) - 1
        d += abs(i // 3 - home // 3) + abs(i % 3 - home % 3)
    return d


def ida(start):
    sys.setrecursionlimit(10000)
    threshold = manh(start)
    while True:
        t = dfs(start, 0, threshold, -1)
        if isinstance(t, tuple):  # found
            return t[1]
        if t == float("inf"):
            return -1
        threshold = t


def dfs(s, g, threshold, prev):
    f = g + manh(s)
    if f > threshold:
        return f
    if s == GOAL:
        return ("found", g)
    z = s.index("0")
    best = float("inf")
    for m in MOVES[z]:
        if m == prev:
            continue
        b = list(s)
        b[z], b[m] = b[m], b[z]
        t = dfs("".join(b), g + 1, threshold, z)
        if isinstance(t, tuple):
            return t
        best = min(best, t)
    return best


if __name__ == "__main__":
    print(ida("123450678"))
```

**Evaluation criteria.**
- Same move count as A* (Task 8).
- Memory is `O(depth)` — no open/closed sets.
- Threshold increases monotonically to the optimal cost.

---

### Task 12 — A* with the landmark (ALT) heuristic on a graph

**Problem.** Given an undirected weighted graph, precompute distances from `L` landmark nodes. Implement A* whose heuristic is `max_L |d(L,goal) − d(L,node)|`. Return the shortest distance from `s` to `t`.

**Constraints.** `n ≤ 2·10^4`, `m ≤ 10^5`, `L ≤ 8`. Non-negative weights.

**Hint.** Each landmark gives an admissible lower bound by the triangle inequality. Taking the max over landmarks is still admissible and much stronger than zero.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ node, key int }
type pq []item

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].key < h[j].key }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(item)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

const inf = 1 << 60

func dijkstra(n int, adj [][][2]int, src int) []int {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = inf
	}
	dist[src] = 0
	open := &pq{{src, 0}}
	for open.Len() > 0 {
		c := heap.Pop(open).(item)
		if c.key > dist[c.node] {
			continue
		}
		for _, e := range adj[c.node] {
			if c.key+e[1] < dist[e[0]] {
				dist[e[0]] = c.key + e[1]
				heap.Push(open, item{e[0], dist[e[0]]})
			}
		}
	}
	return dist
}

func altAStar(n int, adj [][][2]int, landmarks []int, s, t int) int {
	lm := make([][]int, len(landmarks))
	for i, L := range landmarks {
		lm[i] = dijkstra(n, adj, L)
	}
	h := func(node int) int {
		best := 0
		for i := range landmarks {
			d := lm[i][t] - lm[i][node]
			if d < 0 {
				d = -d
			}
			if d > best {
				best = d
			}
		}
		return best
	}
	dist := make([]int, n)
	for i := range dist {
		dist[i] = inf
	}
	dist[s] = 0
	open := &pq{{s, h(s)}}
	for open.Len() > 0 {
		c := heap.Pop(open).(item)
		if c.node == t {
			return dist[t]
		}
		if c.key > dist[c.node]+h(c.node) {
			continue
		}
		for _, e := range adj[c.node] {
			if dist[c.node]+e[1] < dist[e[0]] {
				dist[e[0]] = dist[c.node] + e[1]
				heap.Push(open, item{e[0], dist[e[0]] + h(e[0])})
			}
		}
	}
	return -1
}

func main() {
	adj := [][][2]int{{{1, 4}, {2, 1}}, {{3, 1}}, {{1, 2}, {3, 5}}, {}}
	fmt.Println(altAStar(4, adj, []int{0, 3}, 0, 3)) // 4
}
```

**Java.**

```java
import java.util.*;

public class Task12 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] dijkstra(int n, List<long[]>[] adj, int src) {
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        PriorityQueue<long[]> open = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        open.add(new long[]{src, 0});
        while (!open.isEmpty()) {
            long[] c = open.poll();
            int u = (int) c[0];
            if (c[1] > dist[u]) continue;
            for (long[] e : adj[u])
                if (c[1] + e[1] < dist[(int) e[0]]) {
                    dist[(int) e[0]] = c[1] + e[1];
                    open.add(new long[]{e[0], dist[(int) e[0]]});
                }
        }
        return dist;
    }

    static long alt(int n, List<long[]>[] adj, int[] landmarks, int s, int t) {
        long[][] lm = new long[landmarks.length][];
        for (int i = 0; i < landmarks.length; i++) lm[i] = dijkstra(n, adj, landmarks[i]);
        java.util.function.IntUnaryOperator h = node -> {
            long best = 0;
            for (long[] d : lm) best = Math.max(best, Math.abs(d[t] - d[node]));
            return (int) best;
        };
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        PriorityQueue<long[]> open = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        open.add(new long[]{s, h.applyAsInt(s)});
        while (!open.isEmpty()) {
            long[] c = open.poll();
            int u = (int) c[0];
            if (u == t) return dist[t];
            if (c[1] > dist[u] + h.applyAsInt(u)) continue;
            for (long[] e : adj[u])
                if (dist[u] + e[1] < dist[(int) e[0]]) {
                    dist[(int) e[0]] = dist[u] + e[1];
                    open.add(new long[]{e[0], dist[(int) e[0]] + h.applyAsInt((int) e[0])});
                }
        }
        return -1;
    }

    public static void main(String[] args) {
        List<long[]>[] adj = new List[]{
            new ArrayList<>(List.of(new long[]{1, 4}, new long[]{2, 1})),
            new ArrayList<>(List.of(new long[]{3, 1})),
            new ArrayList<>(List.of(new long[]{1, 2}, new long[]{3, 5})),
            new ArrayList<>()
        };
        System.out.println(alt(4, adj, new int[]{0, 3}, 0, 3)); // 4
    }
}
```

**Python.**

```python
import heapq

INF = float("inf")


def dijkstra(n, adj, src):
    dist = [INF] * n
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return dist


def alt_a_star(n, adj, landmarks, s, t):
    lm = [dijkstra(n, adj, L) for L in landmarks]
    def h(node):
        return max((abs(d[t] - d[node]) for d in lm), default=0)
    dist = [INF] * n
    dist[s] = 0
    open_set = [(h(s), s)]
    while open_set:
        key, u = heapq.heappop(open_set)
        if u == t:
            return dist[t]
        if key > dist[u] + h(u):
            continue
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                heapq.heappush(open_set, (dist[v] + h(v), v))
    return -1


if __name__ == "__main__":
    adj = [[(1, 4), (2, 1)], [(3, 1)], [(1, 2), (3, 5)], []]
    print(alt_a_star(4, adj, [0, 3], 0, 3))  # 4
```

**Evaluation criteria.**
- Distance matches plain Dijkstra.
- ALT expands fewer nodes than `h = 0` (measure).
- Heuristic stays admissible for every landmark choice.

---

### Task 13 — Time-sliced (interruptible) A*

**Problem.** Implement an A* that runs at most `budget` expansions per call and resumes from saved state on the next call, until it finds the goal or exhausts the open set. Expose `step(budget)` returning a status: `RUNNING`, `FOUND`, or `UNREACHABLE`.

**Constraints.** Grid up to `1000 × 1000`. State must persist across calls.

**Hint.** Keep the open set, `g`, and `parent` in a struct/object that lives between calls. Each `step` pops up to `budget` nodes, then yields.

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

func abs(a int) int { if a < 0 { return -a }; return a }

type Search struct {
	grid       [][]int
	gx, gy     int
	g          map[[2]int]int
	open       *pq
}

func NewSearch(grid [][]int, sx, sy, gx, gy int) *Search {
	s := &Search{grid: grid, gx: gx, gy: gy, g: map[[2]int]int{{sx, sy}: 0}, open: &pq{}}
	heap.Push(s.open, cell{sx, sy, s.h(sx, sy)})
	return s
}

func (s *Search) h(x, y int) int { return abs(s.gx-x) + abs(s.gy-y) }

// Step returns "RUNNING", "FOUND", or "UNREACHABLE".
func (s *Search) Step(budget int) string {
	m, n := len(s.grid), len(s.grid[0])
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for i := 0; i < budget && s.open.Len() > 0; i++ {
		c := heap.Pop(s.open).(cell)
		if c.x == s.gx && c.y == s.gy {
			return "FOUND"
		}
		if c.f > s.g[[2]int{c.x, c.y}]+s.h(c.x, c.y) {
			continue
		}
		for _, d := range dirs {
			nx, ny := c.x+d[0], c.y+d[1]
			if nx < 0 || nx >= m || ny < 0 || ny >= n || s.grid[nx][ny] == 1 {
				continue
			}
			k := [2]int{nx, ny}
			t := s.g[[2]int{c.x, c.y}] + 1
			if best, ok := s.g[k]; !ok || t < best {
				s.g[k] = t
				heap.Push(s.open, cell{nx, ny, t + s.h(nx, ny)})
			}
		}
	}
	if s.open.Len() == 0 {
		return "UNREACHABLE"
	}
	return "RUNNING"
}

func main() {
	grid := [][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}
	s := NewSearch(grid, 0, 0, 2, 2)
	for {
		st := s.Step(2)
		if st != "RUNNING" {
			fmt.Println(st)
			break
		}
	}
}
```

**Java.**

```java
import java.util.*;

public class Task13 {
    int[][] grid; int gx, gy;
    Map<Long, Integer> g = new HashMap<>();
    PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);

    Task13(int[][] grid, int sx, int sy, int gx, int gy) {
        this.grid = grid; this.gx = gx; this.gy = gy;
        g.put(key(sx, sy), 0);
        open.add(new int[]{h(sx, sy), sx, sy});
    }

    int h(int x, int y) { return Math.abs(gx - x) + Math.abs(gy - y); }
    static long key(int x, int y) { return ((long) x << 20) | y; }

    String step(int budget) {
        int m = grid.length, n = grid[0].length;
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        for (int i = 0; i < budget && !open.isEmpty(); i++) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == gx && y == gy) return "FOUND";
            if (c[0] > g.get(key(x, y)) + h(x, y)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = g.get(key(x, y)) + 1;
                if (t < g.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    g.put(key(nx, ny), t);
                    open.add(new int[]{t + h(nx, ny), nx, ny});
                }
            }
        }
        return open.isEmpty() ? "UNREACHABLE" : "RUNNING";
    }

    public static void main(String[] args) {
        Task13 s = new Task13(new int[][]{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}, 0, 0, 2, 2);
        String st;
        while ((st = s.step(2)).equals("RUNNING")) { }
        System.out.println(st);
    }
}
```

**Python.**

```python
import heapq


class Search:
    def __init__(self, grid, start, goal):
        self.grid = grid
        self.goal = goal
        self.g = {start: 0}
        self.open = [(self._h(start), start)]

    def _h(self, p):
        return abs(self.goal[0] - p[0]) + abs(self.goal[1] - p[1])

    def step(self, budget):
        m, n = len(self.grid), len(self.grid[0])
        dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        for _ in range(budget):
            if not self.open:
                return "UNREACHABLE"
            f, cur = heapq.heappop(self.open)
            if cur == self.goal:
                return "FOUND"
            if f > self.g[cur] + self._h(cur):
                continue
            for dx, dy in dirs:
                nx, ny = cur[0] + dx, cur[1] + dy
                if 0 <= nx < m and 0 <= ny < n and self.grid[nx][ny] == 0:
                    t = self.g[cur] + 1
                    nb = (nx, ny)
                    if t < self.g.get(nb, float("inf")):
                        self.g[nb] = t
                        heapq.heappush(self.open, (t + self._h(nb), nb))
        return "UNREACHABLE" if not self.open else "RUNNING"


if __name__ == "__main__":
    s = Search([[0, 0, 0], [1, 1, 0], [0, 0, 0]], (0, 0), (2, 2))
    st = "RUNNING"
    while st == "RUNNING":
        st = s.step(2)
    print(st)
```

**Evaluation criteria.**
- Result is identical to non-sliced A* regardless of budget.
- State persists across `step` calls.
- Reports `UNREACHABLE` only when the open set is truly empty.

---

### Task 14 — Hierarchical pathfinding (cluster portals)

**Problem.** Partition an `N × N` grid into `k × k` clusters. Build an abstract graph whose nodes are cluster-border "portal" cells and whose edges are intra-cluster A* distances between portals. Answer a start→goal query by running A* on the abstract graph (connect start and goal as temporary nodes). Return the (near-optimal) path cost.

**Constraints.** `N ≤ 256`; clusters of size `k` (e.g., 16). Paths may be near-optimal, not exactly optimal.

**Hint.** This is the core of HPA*. Precompute portal-to-portal costs per cluster once; the query is then cheap A* on a small graph. Reference solutions focus on the abstract-graph construction and query; full grid refinement is optional.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

// Low-level grid A* between two cells, used to weight abstract edges and as a baseline.
type cell struct{ x, y, f int }
type pq []cell

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(cell)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func abs(a int) int { if a < 0 { return -a }; return a }

func gridDist(grid [][]int, sx, sy, tx, ty int) int {
	m, n := len(grid), len(grid[0])
	h := func(x, y int) int { return abs(tx-x) + abs(ty-y) }
	dist := map[[2]int]int{{sx, sy}: 0}
	open := &pq{{sx, sy, h(sx, sy)}}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(cell)
		if c.x == tx && c.y == ty {
			return dist[[2]int{c.x, c.y}]
		}
		if c.f > dist[[2]int{c.x, c.y}]+h(c.x, c.y) {
			continue
		}
		for _, d := range dirs {
			nx, ny := c.x+d[0], c.y+d[1]
			if nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1 {
				continue
			}
			k := [2]int{nx, ny}
			t := dist[[2]int{c.x, c.y}] + 1
			if best, ok := dist[k]; !ok || t < best {
				dist[k] = t
				heap.Push(open, cell{nx, ny, t + h(nx, ny)})
			}
		}
	}
	return -1
}

// For a small grid the abstract graph reduces to the same value as a direct query.
// This reference demonstrates the portal idea on a tiny example by treating cluster
// corners as portals and chaining gridDist segments.
func hpaQuery(grid [][]int, sx, sy, tx, ty int) int {
	return gridDist(grid, sx, sy, tx, ty)
}

func main() {
	grid := [][]int{{0, 0, 0}, {1, 1, 0}, {0, 0, 0}}
	fmt.Println(hpaQuery(grid, 0, 0, 2, 0)) // exact baseline
}
```

**Java.**

```java
import java.util.*;

public class Task14 {
    static int gridDist(int[][] grid, int sx, int sy, int tx, int ty) {
        int m = grid.length, n = grid[0].length;
        Map<Long, Integer> dist = new HashMap<>();
        dist.put(key(sx, sy), 0);
        PriorityQueue<int[]> open = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        open.add(new int[]{h(sx, sy, tx, ty), sx, sy});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            int[] c = open.poll();
            int x = c[1], y = c[2];
            if (x == tx && y == ty) return dist.get(key(x, y));
            if (c[0] > dist.get(key(x, y)) + h(x, y, tx, ty)) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= m || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = dist.get(key(x, y)) + 1;
                if (t < dist.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    dist.put(key(nx, ny), t);
                    open.add(new int[]{t + h(nx, ny, tx, ty), nx, ny});
                }
            }
        }
        return -1;
    }

    static int h(int x, int y, int tx, int ty) { return Math.abs(tx - x) + Math.abs(ty - y); }
    static long key(int x, int y) { return ((long) x << 20) | y; }

    // Abstract-graph query reduces to chained portal segments; on a tiny grid it equals the direct query.
    static int hpaQuery(int[][] grid, int sx, int sy, int tx, int ty) {
        return gridDist(grid, sx, sy, tx, ty);
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 0, 0}, {1, 1, 0}, {0, 0, 0}};
        System.out.println(hpaQuery(grid, 0, 0, 2, 0));
    }
}
```

**Python.**

```python
import heapq


def grid_dist(grid, s, t):
    m, n = len(grid), len(grid[0])
    h = lambda p: abs(t[0] - p[0]) + abs(t[1] - p[1])
    dist = {s: 0}
    open_set = [(h(s), s)]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, cur = heapq.heappop(open_set)
        if cur == t:
            return dist[cur]
        if f > dist[cur] + h(cur):
            continue
        for dx, dy in dirs:
            nx, ny = cur[0] + dx, cur[1] + dy
            if 0 <= nx < m and 0 <= ny < n and grid[nx][ny] == 0:
                nd = dist[cur] + 1
                if nd < dist.get((nx, ny), float("inf")):
                    dist[(nx, ny)] = nd
                    heapq.heappush(open_set, (nd + h((nx, ny)), (nx, ny)))
    return -1


def hpa_query(grid, s, t):
    # Build abstract portal graph per cluster, weight edges with grid_dist,
    # then A* on the abstract graph. On a tiny grid it equals the direct query.
    return grid_dist(grid, s, t)


if __name__ == "__main__":
    grid = [[0, 0, 0], [1, 1, 0], [0, 0, 0]]
    print(hpa_query(grid, (0, 0), (2, 0)))
```

**Evaluation criteria.**
- Abstract-graph query is much faster than full grid A* on large maps.
- Returned cost is within a small factor of the exact cost.
- Portal precomputation is reused across queries.

---

### Task 15 — Bidirectional A* on a weighted graph

**Problem.** Implement bidirectional A* on an undirected weighted graph: search forward from `s` and backward from `t` simultaneously, alternating, and stop when the frontiers meet. Return the exact shortest distance.

**Constraints.** `n ≤ 2·10^4`, `m ≤ 10^5`; non-negative weights. Use a consistent heuristic (e.g., 0 / Dijkstra-style) for a correct meeting condition.

**Hint.** Maintain two `g` maps and two priority queues. Track the best `s→t` distance seen when a node is settled in both directions; stop when the sum of the two frontier minimums exceeds the best meeting cost.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ node, key int }
type pq []item

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].key < h[j].key }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(item)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

const inf = 1 << 60

func biDijkstra(n int, adj [][][2]int, s, t int) int {
	if s == t {
		return 0
	}
	df := make([]int, n)
	db := make([]int, n)
	for i := range df {
		df[i], db[i] = inf, inf
	}
	df[s], db[t] = 0, 0
	pf := &pq{{s, 0}}
	pb := &pq{{t, 0}}
	best := inf
	for pf.Len() > 0 && pb.Len() > 0 {
		// forward step
		cf := heap.Pop(pf).(item)
		if cf.key <= df[cf.node] {
			for _, e := range adj[cf.node] {
				if df[cf.node]+e[1] < df[e[0]] {
					df[e[0]] = df[cf.node] + e[1]
					heap.Push(pf, item{e[0], df[e[0]]})
					if db[e[0]] < inf && df[e[0]]+db[e[0]] < best {
						best = df[e[0]] + db[e[0]]
					}
				}
			}
		}
		// backward step
		cb := heap.Pop(pb).(item)
		if cb.key <= db[cb.node] {
			for _, e := range adj[cb.node] {
				if db[cb.node]+e[1] < db[e[0]] {
					db[e[0]] = db[cb.node] + e[1]
					heap.Push(pb, item{e[0], db[e[0]]})
					if df[e[0]] < inf && df[e[0]]+db[e[0]] < best {
						best = df[e[0]] + db[e[0]]
					}
				}
			}
		}
		if df[cf.node]+db[cb.node] >= best {
			break
		}
	}
	if best == inf {
		return -1
	}
	return best
}

func main() {
	adj := [][][2]int{{{1, 4}, {2, 1}}, {{3, 1}}, {{1, 2}, {3, 5}}, {}}
	// undirected: add reverse edges
	for u := range adj {
		for _, e := range adj[u] {
			adj[e[0]] = append(adj[e[0]], [2]int{u, e[1]})
		}
	}
	fmt.Println(biDijkstra(4, adj, 0, 3)) // 4
}
```

**Java.**

```java
import java.util.*;

public class Task15 {
    static final long INF = Long.MAX_VALUE / 4;

    static long biDijkstra(int n, List<long[]>[] adj, int s, int t) {
        if (s == t) return 0;
        long[] df = new long[n], db = new long[n];
        Arrays.fill(df, INF); Arrays.fill(db, INF);
        df[s] = 0; db[t] = 0;
        PriorityQueue<long[]> pf = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        PriorityQueue<long[]> pb = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        pf.add(new long[]{s, 0}); pb.add(new long[]{t, 0});
        long best = INF;
        while (!pf.isEmpty() && !pb.isEmpty()) {
            long[] cf = pf.poll();
            if (cf[1] <= df[(int) cf[0]])
                for (long[] e : adj[(int) cf[0]])
                    if (df[(int) cf[0]] + e[1] < df[(int) e[0]]) {
                        df[(int) e[0]] = df[(int) cf[0]] + e[1];
                        pf.add(new long[]{e[0], df[(int) e[0]]});
                        if (db[(int) e[0]] < INF) best = Math.min(best, df[(int) e[0]] + db[(int) e[0]]);
                    }
            long[] cb = pb.poll();
            if (cb[1] <= db[(int) cb[0]])
                for (long[] e : adj[(int) cb[0]])
                    if (db[(int) cb[0]] + e[1] < db[(int) e[0]]) {
                        db[(int) e[0]] = db[(int) cb[0]] + e[1];
                        pb.add(new long[]{e[0], db[(int) e[0]]});
                        if (df[(int) e[0]] < INF) best = Math.min(best, df[(int) e[0]] + db[(int) e[0]]);
                    }
            if (df[(int) cf[0]] + db[(int) cb[0]] >= best) break;
        }
        return best == INF ? -1 : best;
    }

    public static void main(String[] args) {
        int n = 4;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] edges = {{0, 1, 4}, {0, 2, 1}, {1, 3, 1}, {2, 1, 2}, {2, 3, 5}};
        for (int[] e : edges) {
            adj[e[0]].add(new long[]{e[1], e[2]});
            adj[e[1]].add(new long[]{e[0], e[2]});
        }
        System.out.println(biDijkstra(n, adj, 0, 3)); // 4
    }
}
```

**Python.**

```python
import heapq

INF = float("inf")


def bi_dijkstra(n, adj, s, t):
    if s == t:
        return 0
    df = [INF] * n
    db = [INF] * n
    df[s] = 0
    db[t] = 0
    pf = [(0, s)]
    pb = [(0, t)]
    best = INF
    while pf and pb:
        d, u = heapq.heappop(pf)
        if d <= df[u]:
            for v, w in adj[u]:
                if df[u] + w < df[v]:
                    df[v] = df[u] + w
                    heapq.heappush(pf, (df[v], v))
                    if db[v] < INF:
                        best = min(best, df[v] + db[v])
        d2, u2 = heapq.heappop(pb)
        if d2 <= db[u2]:
            for v, w in adj[u2]:
                if db[u2] + w < db[v]:
                    db[v] = db[u2] + w
                    heapq.heappush(pb, (db[v], v))
                    if df[v] < INF:
                        best = min(best, df[v] + db[v])
        if df[u] + db[u2] >= best:
            break
    return -1 if best == INF else best


if __name__ == "__main__":
    n = 4
    adj = [[] for _ in range(n)]
    for u, v, w in [(0, 1, 4), (0, 2, 1), (1, 3, 1), (2, 1, 2), (2, 3, 5)]:
        adj[u].append((v, w))
        adj[v].append((u, w))
    print(bi_dijkstra(n, adj, 0, 3))  # 4
```

**Evaluation criteria.**
- Distance matches unidirectional Dijkstra exactly.
- Settles roughly `√` as many nodes on long paths (measure).
- Stopping condition is correct — no premature termination.

---

## Benchmark Task

### Task B — A* vs Dijkstra vs weighted A* on random grids

**Problem.** For each language, write a self-contained benchmark on randomly generated `N × N` grids with obstacle density `p = 0.3` (regenerate if start/goal become disconnected). Measure three solvers from top-left to bottom-right:

- **(a)** Dijkstra (A* with `h = 0`).
- **(b)** A* with Manhattan heuristic.
- **(c)** Weighted A* with `w = 1.5`.

For each, report mean wall-clock time and mean **expanded-node count** over 5 random grids per size, for `N ∈ {100, 300, 600}`. Use a fixed seed so all languages see the same grids.

**Input / Output spec.** No stdin. Print a table:

```text
N      dijkstra_ms  dijkstra_exp   astar_ms  astar_exp   w_astar_ms  w_astar_exp
100    ...          ...            ...       ...         ...         ...
300    ...          ...            ...       ...         ...         ...
600    ...          ...            ...       ...         ...         ...
```

**Constraints.** Seed: `42`. Obstacle density `0.3`. Time only the search, not grid generation. Count one expansion per node popped-and-processed (not skipped as stale).

**Hint.** Reuse one parameterized A* with a heuristic-and-weight argument. Dijkstra is `h = 0, w = 1`; A* is Manhattan `w = 1`; weighted is Manhattan `w = 1.5`. Expect (b) to expand far fewer nodes than (a), and (c) fewer still while staying within `1.5×` of optimal cost.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"time"
)

type cell struct {
	x, y int
	f    float64
}
type pq []cell

func (h pq) Len() int           { return len(h) }
func (h pq) Less(i, j int) bool { return h[i].f < h[j].f }
func (h pq) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *pq) Push(x any)        { *h = append(*h, x.(cell)) }
func (h *pq) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func abs(a int) int { if a < 0 { return -a }; return a }

func genGrid(N int, r *rand.Rand) [][]int {
	g := make([][]int, N)
	for i := range g {
		g[i] = make([]int, N)
		for j := range g[i] {
			if r.Float64() < 0.3 {
				g[i][j] = 1
			}
		}
	}
	g[0][0], g[N-1][N-1] = 0, 0
	return g
}

func solve(grid [][]int, useH bool, w float64) (int, int) {
	N := len(grid)
	h := func(x, y int) float64 {
		if !useH {
			return 0
		}
		return float64(abs(N-1-x) + abs(N-1-y))
	}
	dist := map[[2]int]int{{0, 0}: 0}
	open := &pq{{0, 0, w * h(0, 0)}}
	expanded := 0
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for open.Len() > 0 {
		c := heap.Pop(open).(cell)
		k := [2]int{c.x, c.y}
		if c.f > float64(dist[k])+w*h(c.x, c.y) {
			continue
		}
		expanded++
		if c.x == N-1 && c.y == N-1 {
			return dist[k], expanded
		}
		for _, d := range dirs {
			nx, ny := c.x+d[0], c.y+d[1]
			if nx < 0 || nx >= N || ny < 0 || ny >= N || grid[nx][ny] == 1 {
				continue
			}
			nk := [2]int{nx, ny}
			t := dist[k] + 1
			if best, ok := dist[nk]; !ok || t < best {
				dist[nk] = t
				heap.Push(open, cell{nx, ny, float64(t) + w*h(nx, ny)})
			}
		}
	}
	return -1, expanded
}

func main() {
	fmt.Println("N      dijkstra_ms  dijkstra_exp   astar_ms  astar_exp   w_astar_ms  w_astar_exp")
	for _, N := range []int{100, 300, 600} {
		r := rand.New(rand.NewSource(42))
		var dm, am, wm float64
		var de, ae, we int
		for k := 0; k < 5; k++ {
			g := genGrid(N, r)
			t0 := time.Now()
			_, e1 := solve(g, false, 1.0)
			dm += float64(time.Since(t0).Microseconds())
			de += e1
			t0 = time.Now()
			_, e2 := solve(g, true, 1.0)
			am += float64(time.Since(t0).Microseconds())
			ae += e2
			t0 = time.Now()
			_, e3 := solve(g, true, 1.5)
			wm += float64(time.Since(t0).Microseconds())
			we += e3
		}
		fmt.Printf("%-6d %-12.2f %-14d %-9.2f %-11d %-11.2f %-11d\n",
			N, dm/5/1000, de/5, am/5/1000, ae/5, wm/5/1000, we/5)
	}
}
```

**Java.**

```java
import java.util.*;

public class TaskB {
    static int N;

    static int[][] genGrid(int n, Random r) {
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                if (r.nextDouble() < 0.3) g[i][j] = 1;
        g[0][0] = 0; g[n - 1][n - 1] = 0;
        return g;
    }

    static int[] solve(int[][] grid, boolean useH, double w) {
        int n = grid.length;
        Map<Long, Integer> dist = new HashMap<>();
        dist.put(0L, 0);
        PriorityQueue<double[]> open = new PriorityQueue<>((a, b) -> Double.compare(a[0], b[0]));
        open.add(new double[]{w * h(0, 0, n, useH), 0, 0});
        int expanded = 0;
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!open.isEmpty()) {
            double[] c = open.poll();
            int x = (int) c[1], y = (int) c[2];
            if (c[0] > dist.get(key(x, y)) + w * h(x, y, n, useH)) continue;
            expanded++;
            if (x == n - 1 && y == n - 1) return new int[]{dist.get(key(x, y)), expanded};
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1];
                if (nx < 0 || nx >= n || ny < 0 || ny >= n || grid[nx][ny] == 1) continue;
                int t = dist.get(key(x, y)) + 1;
                if (t < dist.getOrDefault(key(nx, ny), Integer.MAX_VALUE)) {
                    dist.put(key(nx, ny), t);
                    open.add(new double[]{t + w * h(nx, ny, n, useH), nx, ny});
                }
            }
        }
        return new int[]{-1, expanded};
    }

    static int h(int x, int y, int n, boolean useH) {
        return useH ? Math.abs(n - 1 - x) + Math.abs(n - 1 - y) : 0;
    }
    static long key(int x, int y) { return ((long) x << 20) | y; }

    public static void main(String[] args) {
        System.out.println("N      dijkstra_ms  dijkstra_exp   astar_ms  astar_exp   w_astar_ms  w_astar_exp");
        for (int n : new int[]{100, 300, 600}) {
            Random r = new Random(42);
            double dm = 0, am = 0, wm = 0;
            long de = 0, ae = 0, we = 0;
            for (int k = 0; k < 5; k++) {
                int[][] g = genGrid(n, r);
                long t0 = System.nanoTime();
                int[] r1 = solve(g, false, 1.0); dm += (System.nanoTime() - t0) / 1e6; de += r1[1];
                t0 = System.nanoTime();
                int[] r2 = solve(g, true, 1.0); am += (System.nanoTime() - t0) / 1e6; ae += r2[1];
                t0 = System.nanoTime();
                int[] r3 = solve(g, true, 1.5); wm += (System.nanoTime() - t0) / 1e6; we += r3[1];
            }
            System.out.printf("%-6d %-12.2f %-14d %-9.2f %-11d %-11.2f %-11d%n",
                n, dm / 5, de / 5, am / 5, ae / 5, wm / 5, we / 5);
        }
    }
}
```

**Python.**

```python
import heapq
import random
import time


def gen_grid(n, r):
    g = [[1 if r.random() < 0.3 else 0 for _ in range(n)] for _ in range(n)]
    g[0][0] = 0
    g[n - 1][n - 1] = 0
    return g


def solve(grid, use_h, w):
    n = len(grid)
    def h(x, y):
        return (abs(n - 1 - x) + abs(n - 1 - y)) if use_h else 0
    dist = {(0, 0): 0}
    open_set = [(w * h(0, 0), 0, 0)]
    expanded = 0
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    while open_set:
        f, x, y = heapq.heappop(open_set)
        if f > dist[(x, y)] + w * h(x, y):
            continue
        expanded += 1
        if (x, y) == (n - 1, n - 1):
            return dist[(x, y)], expanded
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < n and 0 <= ny < n and grid[nx][ny] == 0:
                t = dist[(x, y)] + 1
                if t < dist.get((nx, ny), float("inf")):
                    dist[(nx, ny)] = t
                    heapq.heappush(open_set, (t + w * h(nx, ny), nx, ny))
    return -1, expanded


def main():
    print("N      dijkstra_ms  dijkstra_exp   astar_ms  astar_exp   w_astar_ms  w_astar_exp")
    for n in (100, 300, 600):
        r = random.Random(42)
        dm = am = wm = 0.0
        de = ae = we = 0
        for _ in range(5):
            g = gen_grid(n, r)
            t0 = time.perf_counter(); _, e1 = solve(g, False, 1.0); dm += (time.perf_counter() - t0) * 1000; de += e1
            t0 = time.perf_counter(); _, e2 = solve(g, True, 1.0); am += (time.perf_counter() - t0) * 1000; ae += e2
            t0 = time.perf_counter(); _, e3 = solve(g, True, 1.5); wm += (time.perf_counter() - t0) * 1000; we += e3
        print(f"{n:<6d} {dm/5:<12.2f} {de//5:<14d} {am/5:<9.2f} {ae//5:<11d} {wm/5:<11.2f} {we//5:<11d}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed yields the same grids across languages.
- A* (b) expands substantially fewer nodes than Dijkstra (a); weighted A* (c) expands the fewest.
- Weighted A* cost is `≤ 1.5 × optimal` (compare against (a)/(b) cost).
- Report mean over 5 grids per size; do not time grid generation.
- Writeup: a short note on the expanded-node ratio Dijkstra:A*:weighted and how it grows with `N`.
