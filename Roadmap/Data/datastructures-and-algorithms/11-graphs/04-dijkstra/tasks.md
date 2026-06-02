# Dijkstra's Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a complete reference solution in all three languages. Reuse the core ideas from the rest of this topic: **relaxation**, the **settled set**, the **lazy-deletion heap** (`if d > dist[u]: continue`), and the **predecessor array** for path reconstruction.
> Hard rule throughout: edge weights are non-negative. The moment a problem allows negative weights, Dijkstra is the wrong tool (use Bellman-Ford).

---

## Beginner Tasks (5)

### Task 1 — Single-source shortest distances

**Statement.** Given a directed weighted graph as an adjacency list `adj[u] = [(v, w), ...]` and a source `s`, return an array `dist` where `dist[v]` is the shortest distance from `s` to `v`, or `INF` if `v` is unreachable.

**Constraints.**
- `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 2·10^5`.
- `0 ≤ w ≤ 10^9`.
- Use a binary-heap (lazy deletion) Dijkstra; total time `O((V + E) log V)`.

**Hints.**
- Initialize `dist[*] = INF`, `dist[s] = 0`, push `(0, s)`.
- On pop, skip stale entries with `if d > dist[u]: continue`.
- Only push a neighbor when you actually improve its distance.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func dijkstra(adj [][][2]int, s int) []int {
	n := len(adj)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	h := &pq{{0, s}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue // stale
		}
		for _, e := range adj[cur.node] {
			if nd := cur.dist + e[1]; nd < dist[e[0]] {
				dist[e[0]] = nd
				heap.Push(h, item{nd, e[0]})
			}
		}
	}
	return dist
}

func main() {
	adj := [][][2]int{
		{{1, 4}, {2, 1}},
		{{3, 1}},
		{{1, 2}, {3, 5}},
		{},
	}
	fmt.Println(dijkstra(adj, 0)) // [0 3 1 4]
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] dijkstra(List<int[]>[] adj, int s) {
        int n = adj.length;
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, s});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0]; int u = (int) cur[1];
            if (d > dist[u]) continue; // stale
            for (int[] e : adj[u]) {
                long nd = d + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    pq.add(new long[]{nd, e[0]});
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 4}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{1, 2}); adj[2].add(new int[]{3, 5});
        System.out.println(Arrays.toString(dijkstra(adj, 0))); // [0, 3, 1, 4]
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def dijkstra(adj, s):
    n = len(adj)
    dist = [INF] * n
    dist[s] = 0
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue  # stale
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist


if __name__ == "__main__":
    adj = [[(1, 4), (2, 1)], [(3, 1)], [(1, 2), (3, 5)], []]
    print(dijkstra(adj, 0))  # [0, 3, 1, 4]
```

---

### Task 2 — Shortest path with reconstruction

**Statement.** Same graph format, but also return the actual shortest path (list of vertices) from `s` to a given target `t`. If `t` is unreachable, return an empty path and distance `INF`.

**Constraints.**
- `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 2·10^5`, `0 ≤ w ≤ 10^9`.

**Hints.**
- Maintain a `prev[]` array, set `prev[v] = u` on every successful relaxation.
- Reconstruct by walking `prev[]` from `t` back to `s` (stop at `-1`), then reverse.
- Initialize `prev[*] = -1`; a correct relaxation never creates a `prev` cycle.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func shortestPath(adj [][][2]int, s, t int) (int, []int) {
	n := len(adj)
	dist := make([]int, n)
	prev := make([]int, n)
	for i := range dist {
		dist[i] = INF
		prev[i] = -1
	}
	dist[s] = 0
	h := &pq{{0, s}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue
		}
		for _, e := range adj[cur.node] {
			if nd := cur.dist + e[1]; nd < dist[e[0]] {
				dist[e[0]] = nd
				prev[e[0]] = cur.node
				heap.Push(h, item{nd, e[0]})
			}
		}
	}
	if dist[t] == INF {
		return INF, nil
	}
	var path []int
	for at := t; at != -1; at = prev[at] {
		path = append([]int{at}, path...)
	}
	return dist[t], path
}

func main() {
	adj := [][][2]int{
		{{1, 4}, {2, 1}},
		{{3, 1}},
		{{1, 2}, {3, 5}},
		{},
	}
	d, p := shortestPath(adj, 0, 3)
	fmt.Println(d, p) // 4 [0 2 1 3]
}
```

#### Java
```java
import java.util.*;

public class Task2 {
    static final long INF = Long.MAX_VALUE / 4;

    static Object[] shortestPath(List<int[]>[] adj, int s, int t) {
        int n = adj.length;
        long[] dist = new long[n];
        int[] prev = new int[n];
        Arrays.fill(dist, INF);
        Arrays.fill(prev, -1);
        dist[s] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, s});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0]; int u = (int) cur[1];
            if (d > dist[u]) continue;
            for (int[] e : adj[u]) {
                long nd = d + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    prev[e[0]] = u;
                    pq.add(new long[]{nd, e[0]});
                }
            }
        }
        if (dist[t] == INF) return new Object[]{INF, new ArrayList<Integer>()};
        LinkedList<Integer> path = new LinkedList<>();
        for (int at = t; at != -1; at = prev[at]) path.addFirst(at);
        return new Object[]{dist[t], path};
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 4}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{1, 2}); adj[2].add(new int[]{3, 5});
        Object[] r = shortestPath(adj, 0, 3);
        System.out.println(r[0] + " " + r[1]); // 4 [0, 2, 1, 3]
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def shortest_path(adj, s, t):
    n = len(adj)
    dist = [INF] * n
    prev = [-1] * n
    dist[s] = 0
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if dist[t] == INF:
        return INF, []
    path, at = [], t
    while at != -1:
        path.append(at)
        at = prev[at]
    return dist[t], path[::-1]


if __name__ == "__main__":
    adj = [[(1, 4), (2, 1)], [(3, 1)], [(1, 2), (3, 5)], []]
    print(shortest_path(adj, 0, 3))  # (4, [0, 2, 1, 3])
```

---

### Task 3 — Network Delay Time

**Statement.** `n` nodes labeled `1..n`, `times[i] = (u, v, w)` is a directed edge. A signal starts at node `k`. Return the time for all nodes to receive it (the maximum finalized distance), or `-1` if any node is unreachable.

**Constraints.**
- `1 ≤ k ≤ n ≤ 100`, `1 ≤ times.length ≤ 6000`, `1 ≤ w ≤ 100`.

**Hints.**
- Plain single-source Dijkstra from `k`.
- The answer is `max(dist[1..n])`; if any is `INF`, return `-1`.
- Nodes are 1-indexed — size your arrays `n+1`.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func networkDelayTime(times [][]int, n, k int) int {
	adj := make([][][2]int, n+1)
	for _, t := range times {
		adj[t[0]] = append(adj[t[0]], [2]int{t[1], t[2]})
	}
	dist := make([]int, n+1)
	for i := range dist {
		dist[i] = INF
	}
	dist[k] = 0
	h := &pq{{0, k}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue
		}
		for _, e := range adj[cur.node] {
			if nd := cur.dist + e[1]; nd < dist[e[0]] {
				dist[e[0]] = nd
				heap.Push(h, item{nd, e[0]})
			}
		}
	}
	ans := 0
	for i := 1; i <= n; i++ {
		if dist[i] == INF {
			return -1
		}
		if dist[i] > ans {
			ans = dist[i]
		}
	}
	return ans
}

func main() {
	times := [][]int{{2, 1, 1}, {2, 3, 1}, {3, 4, 1}}
	fmt.Println(networkDelayTime(times, 4, 2)) // 2
}
```

#### Java
```java
import java.util.*;

public class Task3 {
    static final long INF = Long.MAX_VALUE / 4;

    public int networkDelayTime(int[][] times, int n, int k) {
        List<int[]>[] adj = new List[n + 1];
        for (int i = 1; i <= n; i++) adj[i] = new ArrayList<>();
        for (int[] t : times) adj[t[0]].add(new int[]{t[1], t[2]});
        long[] dist = new long[n + 1];
        Arrays.fill(dist, INF);
        dist[k] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, k});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0]; int u = (int) cur[1];
            if (d > dist[u]) continue;
            for (int[] e : adj[u]) {
                long nd = d + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    pq.add(new long[]{nd, e[0]});
                }
            }
        }
        long ans = 0;
        for (int i = 1; i <= n; i++) {
            if (dist[i] == INF) return -1;
            ans = Math.max(ans, dist[i]);
        }
        return (int) ans;
    }

    public static void main(String[] args) {
        int[][] times = {{2, 1, 1}, {2, 3, 1}, {3, 4, 1}};
        System.out.println(new Task3().networkDelayTime(times, 4, 2)); // 2
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def network_delay_time(times, n, k):
    adj = [[] for _ in range(n + 1)]
    for u, v, w in times:
        adj[u].append((v, w))
    dist = [INF] * (n + 1)
    dist[k] = 0
    pq = [(0, k)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    ans = max(dist[1:])
    return -1 if ans == INF else ans


if __name__ == "__main__":
    print(network_delay_time([(2, 1, 1), (2, 3, 1), (3, 4, 1)], 4, 2))  # 2
```

---

### Task 4 — Grid shortest path with cell entry costs

**Statement.** Given an `R × C` grid where `grid[r][c]` is the cost to *enter* cell `(r, c)`, find the minimum total cost to travel from `(0, 0)` to `(R-1, C-1)`, moving only up/down/left/right. The cost of `(0, 0)` counts.

**Constraints.**
- `1 ≤ R, C ≤ 500`, `0 ≤ grid[r][c] ≤ 10^4`.

**Hints.**
- The vertex is `(r, c)`; neighbors are the 4 adjacent cells; the edge weight is the entry cost of the destination cell.
- No explicit adjacency list — generate neighbors on the fly.
- Use a 2-D `dist` table and the same lazy-deletion skip.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type cell struct{ d, r, c int }
type pq []cell

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(cell)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func minCost(grid [][]int) int {
	const INF = int(1e18)
	R, C := len(grid), len(grid[0])
	dist := make([][]int, R)
	for i := range dist {
		dist[i] = make([]int, C)
		for j := range dist[i] {
			dist[i][j] = INF
		}
	}
	dist[0][0] = grid[0][0]
	h := &pq{{grid[0][0], 0, 0}}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(cell)
		if cur.d > dist[cur.r][cur.c] {
			continue
		}
		if cur.r == R-1 && cur.c == C-1 {
			return cur.d
		}
		for _, dd := range dirs {
			nr, nc := cur.r+dd[0], cur.c+dd[1]
			if nr >= 0 && nr < R && nc >= 0 && nc < C {
				if nd := cur.d + grid[nr][nc]; nd < dist[nr][nc] {
					dist[nr][nc] = nd
					heap.Push(h, cell{nd, nr, nc})
				}
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{{1, 3, 1}, {1, 5, 1}, {4, 2, 1}}
	fmt.Println(minCost(grid)) // 7
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    public int minCost(int[][] grid) {
        final int INF = Integer.MAX_VALUE / 2;
        int R = grid.length, C = grid[0].length;
        int[][] dist = new int[R][C];
        for (int[] row : dist) Arrays.fill(row, INF);
        dist[0][0] = grid[0][0];
        // {d, r, c}
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{grid[0][0], 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int d = cur[0], r = cur[1], c = cur[2];
            if (d > dist[r][c]) continue;
            if (r == R - 1 && c == C - 1) return d;
            for (int[] dd : dirs) {
                int nr = r + dd[0], nc = c + dd[1];
                if (nr >= 0 && nr < R && nc >= 0 && nc < C) {
                    int nd = d + grid[nr][nc];
                    if (nd < dist[nr][nc]) {
                        dist[nr][nc] = nd;
                        pq.add(new int[]{nd, nr, nc});
                    }
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] grid = {{1, 3, 1}, {1, 5, 1}, {4, 2, 1}};
        System.out.println(new Task4().minCost(grid)); // 7
    }
}
```

#### Python
```python
import heapq


def min_cost(grid):
    INF = float("inf")
    R, C = len(grid), len(grid[0])
    dist = [[INF] * C for _ in range(R)]
    dist[0][0] = grid[0][0]
    pq = [(grid[0][0], 0, 0)]
    while pq:
        d, r, c = heapq.heappop(pq)
        if d > dist[r][c]:
            continue
        if r == R - 1 and c == C - 1:
            return d
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                nd = d + grid[nr][nc]
                if nd < dist[nr][nc]:
                    dist[nr][nc] = nd
                    heapq.heappush(pq, (nd, nr, nc))
    return -1


if __name__ == "__main__":
    print(min_cost([[1, 3, 1], [1, 5, 1], [4, 2, 1]]))  # 7
```

---

### Task 5 — Count shortest paths

**Statement.** Given a directed weighted graph and a source `s`, count for each vertex the number of distinct shortest paths from `s` to it (modulo `10^9 + 7`). `cnt[s] = 1`.

**Constraints.**
- `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 2·10^5`, `1 ≤ w ≤ 10^9`.

**Hints.**
- Run Dijkstra; alongside `dist`, keep `cnt[v]`.
- On a strict improvement (`nd < dist[v]`): set `dist[v] = nd`, `cnt[v] = cnt[u]`.
- On a tie (`nd == dist[v]`): `cnt[v] = (cnt[v] + cnt[u]) % MOD`. Do this even without pushing again.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const (
	INF = int(1e18)
	MOD = 1_000_000_007
)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func countPaths(adj [][][2]int, s int) []int {
	n := len(adj)
	dist := make([]int, n)
	cnt := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	cnt[s] = 1
	h := &pq{{0, s}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue
		}
		for _, e := range adj[cur.node] {
			v, nd := e[0], cur.dist+e[1]
			if nd < dist[v] {
				dist[v] = nd
				cnt[v] = cnt[cur.node]
				heap.Push(h, item{nd, v})
			} else if nd == dist[v] {
				cnt[v] = (cnt[v] + cnt[cur.node]) % MOD
			}
		}
	}
	return cnt
}

func main() {
	adj := [][][2]int{
		{{1, 1}, {2, 1}},
		{{3, 1}},
		{{3, 1}},
		{},
	}
	fmt.Println(countPaths(adj, 0)) // [1 1 1 2]
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    static final long INF = Long.MAX_VALUE / 4;
    static final int MOD = 1_000_000_007;

    static int[] countPaths(List<int[]>[] adj, int s) {
        int n = adj.length;
        long[] dist = new long[n];
        int[] cnt = new int[n];
        Arrays.fill(dist, INF);
        dist[s] = 0; cnt[s] = 1;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, s});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0]; int u = (int) cur[1];
            if (d > dist[u]) continue;
            for (int[] e : adj[u]) {
                int v = e[0]; long nd = d + e[1];
                if (nd < dist[v]) {
                    dist[v] = nd;
                    cnt[v] = cnt[u];
                    pq.add(new long[]{nd, v});
                } else if (nd == dist[v]) {
                    cnt[v] = (cnt[v] + cnt[u]) % MOD;
                }
            }
        }
        return cnt;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 1}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{3, 1});
        System.out.println(Arrays.toString(countPaths(adj, 0))); // [1, 1, 1, 2]
    }
}
```

#### Python
```python
import heapq

INF = float("inf")
MOD = 1_000_000_007


def count_paths(adj, s):
    n = len(adj)
    dist = [INF] * n
    cnt = [0] * n
    dist[s] = 0
    cnt[s] = 1
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                cnt[v] = cnt[u]
                heapq.heappush(pq, (nd, v))
            elif nd == dist[v]:
                cnt[v] = (cnt[v] + cnt[u]) % MOD
    return cnt


if __name__ == "__main__":
    adj = [[(1, 1), (2, 1)], [(3, 1)], [(3, 1)], []]
    print(count_paths(adj, 0))  # [1, 1, 1, 2]
```

---

## Intermediate Tasks (5)

### Task 6 — Cheapest Flights Within K Stops

**Statement.** `n` cities, `flights[i] = (from, to, price)`. Return the cheapest price from `src` to `dst` using at most `K` stops, or `-1`.

**Constraints.**
- `1 ≤ n ≤ 100`, `0 ≤ flights.length ≤ n·(n-1)`, `1 ≤ price ≤ 10^4`, `0 ≤ K < n`.

**Hints.**
- Expand state to `(cost, city, stops)` and run cost-ordered Dijkstra.
- The first time you pop `dst`, that cost is the answer (cost ordering).
- Stop expanding a state once `stops > K`.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type st struct{ cost, city, stops int }
type pq []st

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].cost < p[j].cost }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(st)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func findCheapestPrice(n int, flights [][]int, src, dst, k int) int {
	adj := make([][][2]int, n)
	for _, f := range flights {
		adj[f[0]] = append(adj[f[0]], [2]int{f[1], f[2]})
	}
	h := &pq{{0, src, 0}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(st)
		if cur.city == dst {
			return cur.cost
		}
		if cur.stops > k {
			continue
		}
		for _, e := range adj[cur.city] {
			heap.Push(h, st{cur.cost + e[1], e[0], cur.stops + 1})
		}
	}
	return -1
}

func main() {
	flights := [][]int{{0, 1, 100}, {1, 2, 100}, {0, 2, 500}}
	fmt.Println(findCheapestPrice(3, flights, 0, 2, 1)) // 200
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] f : flights) adj[f[0]].add(new int[]{f[1], f[2]});
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, src, 0});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int cost = cur[0], city = cur[1], stops = cur[2];
            if (city == dst) return cost;
            if (stops > k) continue;
            for (int[] e : adj[city]) pq.add(new int[]{cost + e[1], e[0], stops + 1});
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] f = {{0, 1, 100}, {1, 2, 100}, {0, 2, 500}};
        System.out.println(new Task6().findCheapestPrice(3, f, 0, 2, 1)); // 200
    }
}
```

#### Python
```python
import heapq


def find_cheapest_price(n, flights, src, dst, k):
    adj = [[] for _ in range(n)]
    for u, v, w in flights:
        adj[u].append((v, w))
    pq = [(0, src, 0)]  # (cost, city, stops)
    while pq:
        cost, city, stops = heapq.heappop(pq)
        if city == dst:
            return cost
        if stops > k:
            continue
        for v, w in adj[city]:
            heapq.heappush(pq, (cost + w, v, stops + 1))
    return -1


if __name__ == "__main__":
    print(find_cheapest_price(3, [(0, 1, 100), (1, 2, 100), (0, 2, 500)], 0, 2, 1))  # 200
```

---

### Task 7 — Path with Minimum Effort

**Statement.** Given a grid of heights, the *effort* of a path is the maximum absolute height difference between consecutive cells on it. Find the minimum effort to go from `(0,0)` to `(R-1,C-1)` (4-directional moves).

**Constraints.**
- `1 ≤ R, C ≤ 100`, `1 ≤ heights[r][c] ≤ 10^6`.

**Hints.**
- This is a minimax-path Dijkstra: the path cost is the **maximum** edge on it, and we minimize that maximum.
- Relax with `nd = max(d, abs(height diff))` instead of a sum.
- The first pop of the bottom-right cell is the answer.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

type cell struct{ effort, r, c int }
type pq []cell

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].effort < p[j].effort }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(cell)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func minimumEffortPath(h [][]int) int {
	const INF = int(1e18)
	R, C := len(h), len(h[0])
	eff := make([][]int, R)
	for i := range eff {
		eff[i] = make([]int, C)
		for j := range eff[i] {
			eff[i][j] = INF
		}
	}
	eff[0][0] = 0
	pq := &pq{{0, 0, 0}}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for pq.Len() > 0 {
		cur := heap.Pop(pq).(cell)
		if cur.effort > eff[cur.r][cur.c] {
			continue
		}
		if cur.r == R-1 && cur.c == C-1 {
			return cur.effort
		}
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < R && nc >= 0 && nc < C {
				ne := cur.effort
				if diff := abs(h[nr][nc] - h[cur.r][cur.c]); diff > ne {
					ne = diff
				}
				if ne < eff[nr][nc] {
					eff[nr][nc] = ne
					heap.Push(pq, cell{ne, nr, nc})
				}
			}
		}
	}
	return 0
}

func main() {
	fmt.Println(minimumEffortPath([][]int{{1, 2, 2}, {3, 8, 2}, {5, 3, 5}})) // 2
}
```

#### Java
```java
import java.util.*;

public class Task7 {
    public int minimumEffortPath(int[][] h) {
        int R = h.length, C = h[0].length;
        int[][] eff = new int[R][C];
        for (int[] row : eff) Arrays.fill(row, Integer.MAX_VALUE);
        eff[0][0] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, 0, 0});
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int e = cur[0], r = cur[1], c = cur[2];
            if (e > eff[r][c]) continue;
            if (r == R - 1 && c == C - 1) return e;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < R && nc >= 0 && nc < C) {
                    int ne = Math.max(e, Math.abs(h[nr][nc] - h[r][c]));
                    if (ne < eff[nr][nc]) {
                        eff[nr][nc] = ne;
                        pq.add(new int[]{ne, nr, nc});
                    }
                }
            }
        }
        return 0;
    }

    public static void main(String[] args) {
        int[][] h = {{1, 2, 2}, {3, 8, 2}, {5, 3, 5}};
        System.out.println(new Task7().minimumEffortPath(h)); // 2
    }
}
```

#### Python
```python
import heapq


def minimum_effort_path(h):
    INF = float("inf")
    R, C = len(h), len(h[0])
    eff = [[INF] * C for _ in range(R)]
    eff[0][0] = 0
    pq = [(0, 0, 0)]  # (effort, r, c)
    while pq:
        e, r, c = heapq.heappop(pq)
        if e > eff[r][c]:
            continue
        if r == R - 1 and c == C - 1:
            return e
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                ne = max(e, abs(h[nr][nc] - h[r][c]))
                if ne < eff[nr][nc]:
                    eff[nr][nc] = ne
                    heapq.heappush(pq, (ne, nr, nc))
    return 0


if __name__ == "__main__":
    print(minimum_effort_path([[1, 2, 2], [3, 8, 2], [5, 3, 5]]))  # 2
```

---

### Task 8 — Path with Maximum Probability

**Statement.** Undirected graph; edge `i` connecting `a, b` succeeds with probability `succProb[i]`. Return the maximum success probability of any path from `start` to `end`, or `0` if none exists.

**Constraints.**
- `2 ≤ n ≤ 10^4`, `0 ≤ edges.length ≤ 2·10^5`, `0 ≤ succProb[i] ≤ 1`.

**Hints.**
- Maximize a product, so use a *max*-heap and relax with `>`.
- The greedy choice holds because factors are in `[0, 1]` (analogue of non-negativity).
- Add both directions (undirected). First pop of `end` is the answer.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type pitem struct {
	prob float64
	node int
}
type maxpq []pitem

func (p maxpq) Len() int           { return len(p) }
func (p maxpq) Less(i, j int) bool { return p[i].prob > p[j].prob }
func (p maxpq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *maxpq) Push(x any)        { *p = append(*p, x.(pitem)) }
func (p *maxpq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func maxProbability(n int, edges [][]int, succProb []float64, start, end int) float64 {
	type e struct {
		to int
		p  float64
	}
	adj := make([][]e, n)
	for i, ed := range edges {
		adj[ed[0]] = append(adj[ed[0]], e{ed[1], succProb[i]})
		adj[ed[1]] = append(adj[ed[1]], e{ed[0], succProb[i]})
	}
	best := make([]float64, n)
	best[start] = 1.0
	h := &maxpq{{1.0, start}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(pitem)
		if cur.node == end {
			return cur.prob
		}
		if cur.prob < best[cur.node] {
			continue
		}
		for _, nb := range adj[cur.node] {
			if np := cur.prob * nb.p; np > best[nb.to] {
				best[nb.to] = np
				heap.Push(h, pitem{np, nb.to})
			}
		}
	}
	return 0
}

func main() {
	edges := [][]int{{0, 1}, {1, 2}, {0, 2}}
	fmt.Println(maxProbability(3, edges, []float64{0.5, 0.5, 0.2}, 0, 2)) // 0.25
}
```

#### Java
```java
import java.util.*;

public class Task8 {
    public double maxProbability(int n, int[][] edges, double[] succProb, int start, int end) {
        List<double[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < edges.length; i++) {
            adj[edges[i][0]].add(new double[]{edges[i][1], succProb[i]});
            adj[edges[i][1]].add(new double[]{edges[i][0], succProb[i]});
        }
        double[] best = new double[n];
        best[start] = 1.0;
        PriorityQueue<double[]> pq = new PriorityQueue<>((a, b) -> Double.compare(b[0], a[0]));
        pq.add(new double[]{1.0, start});
        while (!pq.isEmpty()) {
            double[] cur = pq.poll();
            double p = cur[0]; int u = (int) cur[1];
            if (u == end) return p;
            if (p < best[u]) continue;
            for (double[] nb : adj[u]) {
                int v = (int) nb[0];
                double np = p * nb[1];
                if (np > best[v]) {
                    best[v] = np;
                    pq.add(new double[]{np, v});
                }
            }
        }
        return 0.0;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {0, 2}};
        System.out.println(new Task8().maxProbability(
                3, edges, new double[]{0.5, 0.5, 0.2}, 0, 2)); // 0.25
    }
}
```

#### Python
```python
import heapq


def max_probability(n, edges, succ_prob, start, end):
    adj = [[] for _ in range(n)]
    for (a, b), p in zip(edges, succ_prob):
        adj[a].append((b, p))
        adj[b].append((a, p))
    best = [0.0] * n
    best[start] = 1.0
    pq = [(-1.0, start)]  # negate for max-heap
    while pq:
        neg_p, u = heapq.heappop(pq)
        p = -neg_p
        if u == end:
            return p
        if p < best[u]:
            continue
        for v, w in adj[u]:
            np = p * w
            if np > best[v]:
                best[v] = np
                heapq.heappush(pq, (-np, v))
    return 0.0


if __name__ == "__main__":
    print(max_probability(3, [(0, 1), (1, 2), (0, 2)], [0.5, 0.5, 0.2], 0, 2))  # 0.25
```

---

### Task 9 — Swim in Rising Water

**Statement.** `n × n` grid of elevations. From `(0,0)` to `(n-1,n-1)`, at time `t` you may step to an adjacent cell only if both cells have elevation ≤ `t`. Return the least time to reach the bottom-right.

**Constraints.**
- `1 ≤ n ≤ 50`, `0 ≤ grid[r][c] < n²`, all values distinct.

**Hints.**
- Minimax-path Dijkstra: path cost is the maximum cell on the path.
- Relax with `nt = max(t, grid[nr][nc])`.
- A simple `seen[][]` matrix is enough because the first settle of any cell is optimal.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type gitem struct{ t, r, c int }
type gpq []gitem

func (p gpq) Len() int           { return len(p) }
func (p gpq) Less(i, j int) bool { return p[i].t < p[j].t }
func (p gpq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *gpq) Push(x any)        { *p = append(*p, x.(gitem)) }
func (p *gpq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func swimInWater(grid [][]int) int {
	n := len(grid)
	seen := make([][]bool, n)
	for i := range seen {
		seen[i] = make([]bool, n)
	}
	h := &gpq{{grid[0][0], 0, 0}}
	seen[0][0] = true
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(gitem)
		if cur.r == n-1 && cur.c == n-1 {
			return cur.t
		}
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < n && !seen[nr][nc] {
				seen[nr][nc] = true
				nt := cur.t
				if grid[nr][nc] > nt {
					nt = grid[nr][nc]
				}
				heap.Push(h, gitem{nt, nr, nc})
			}
		}
	}
	return -1
}

func main() {
	grid := [][]int{{0, 2}, {1, 3}}
	fmt.Println(swimInWater(grid)) // 3
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    public int swimInWater(int[][] grid) {
        int n = grid.length;
        boolean[][] seen = new boolean[n][n];
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{grid[0][0], 0, 0});
        seen[0][0] = true;
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int t = cur[0], r = cur[1], c = cur[2];
            if (r == n - 1 && c == n - 1) return t;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n && !seen[nr][nc]) {
                    seen[nr][nc] = true;
                    pq.add(new int[]{Math.max(t, grid[nr][nc]), nr, nc});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(new Task9().swimInWater(new int[][]{{0, 2}, {1, 3}})); // 3
    }
}
```

#### Python
```python
import heapq


def swim_in_water(grid):
    n = len(grid)
    seen = [[False] * n for _ in range(n)]
    pq = [(grid[0][0], 0, 0)]  # (time, r, c)
    seen[0][0] = True
    while pq:
        t, r, c = heapq.heappop(pq)
        if r == n - 1 and c == n - 1:
            return t
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and not seen[nr][nc]:
                seen[nr][nc] = True
                heapq.heappush(pq, (max(t, grid[nr][nc]), nr, nc))
    return -1


if __name__ == "__main__":
    print(swim_in_water([[0, 2], [1, 3]]))  # 3
```

---

### Task 10 — Lexicographic shortest path (cost then hops)

**Statement.** Directed weighted graph, source `s`. For each vertex return the pair `(shortest distance, fewest edges among shortest paths)`. Minimize distance first, then break ties by the number of edges.

**Constraints.**
- `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 2·10^5`, `0 ≤ w ≤ 10^9`.

**Hints.**
- Make the heap key a tuple `(dist, hops)`; tuples compare lexicographically.
- Relax with `(d + w, hops + 1)` and compare against the stored pair.
- The stale check compares the full tuple.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type item struct{ dist, hops, node int }
type pq []item

func (p pq) Len() int { return len(p) }
func (p pq) Less(i, j int) bool {
	if p[i].dist != p[j].dist {
		return p[i].dist < p[j].dist
	}
	return p[i].hops < p[j].hops
}
func (p pq) Swap(i, j int) { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)   { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func better(d1, h1, d2, h2 int) bool {
	if d1 != d2 {
		return d1 < d2
	}
	return h1 < h2
}

func dijkstra(adj [][][2]int, s int) ([]int, []int) {
	n := len(adj)
	dist := make([]int, n)
	hops := make([]int, n)
	for i := range dist {
		dist[i] = INF
		hops[i] = INF
	}
	dist[s], hops[s] = 0, 0
	h := &pq{{0, 0, s}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if better(dist[cur.node], hops[cur.node], cur.dist, cur.hops) {
			continue // stale: stored pair is strictly better
		}
		for _, e := range adj[cur.node] {
			v := e[0]
			nd, nh := cur.dist+e[1], cur.hops+1
			if better(nd, nh, dist[v], hops[v]) {
				dist[v], hops[v] = nd, nh
				heap.Push(h, item{nd, nh, v})
			}
		}
	}
	return dist, hops
}

func main() {
	adj := [][][2]int{
		{{1, 2}, {2, 1}},
		{{3, 1}},
		{{1, 1}, {3, 2}},
		{},
	}
	d, hp := dijkstra(adj, 0)
	fmt.Println(d)  // [0 2 1 3]
	fmt.Println(hp) // [0 2 1 3]
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    static final long INF = Long.MAX_VALUE / 4;

    static boolean better(long d1, long h1, long d2, long h2) {
        if (d1 != d2) return d1 < d2;
        return h1 < h2;
    }

    static long[][] dijkstra(List<int[]>[] adj, int s) {
        int n = adj.length;
        long[] dist = new long[n], hops = new long[n];
        Arrays.fill(dist, INF);
        Arrays.fill(hops, INF);
        dist[s] = 0; hops[s] = 0;
        // {dist, hops, node}
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) ->
                a[0] != b[0] ? Long.compare(a[0], b[0]) : Long.compare(a[1], b[1]));
        pq.add(new long[]{0, 0, s});
        while (!pq.isEmpty()) {
            long[] cur = pq.poll();
            long d = cur[0], hp = cur[1]; int u = (int) cur[2];
            if (better(dist[u], hops[u], d, hp)) continue; // stale
            for (int[] e : adj[u]) {
                int v = e[0];
                long nd = d + e[1], nh = hp + 1;
                if (better(nd, nh, dist[v], hops[v])) {
                    dist[v] = nd; hops[v] = nh;
                    pq.add(new long[]{nd, nh, v});
                }
            }
        }
        return new long[][]{dist, hops};
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 2}); adj[0].add(new int[]{2, 1});
        adj[1].add(new int[]{3, 1});
        adj[2].add(new int[]{1, 1}); adj[2].add(new int[]{3, 2});
        long[][] r = dijkstra(adj, 0);
        System.out.println(Arrays.toString(r[0])); // [0, 2, 1, 3]
        System.out.println(Arrays.toString(r[1])); // [0, 2, 1, 3]
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def dijkstra(adj, s):
    n = len(adj)
    best = [(INF, INF)] * n  # (dist, hops)
    best[s] = (0, 0)
    pq = [(0, 0, s)]  # (dist, hops, node)
    while pq:
        d, hp, u = heapq.heappop(pq)
        if (d, hp) > best[u]:
            continue  # stale
        for v, w in adj[u]:
            cand = (d + w, hp + 1)
            if cand < best[v]:
                best[v] = cand
                heapq.heappush(pq, (cand[0], cand[1], v))
    return best


if __name__ == "__main__":
    adj = [[(1, 2), (2, 1)], [(3, 1)], [(1, 1), (3, 2)], []]
    print(dijkstra(adj, 0))  # [(0,0), (2,2), (1,1), (3,3)]
```

---

## Advanced Tasks (5)

### Task 11 — Eager Dijkstra with an indexed heap (decrease-key)

**Statement.** Implement Dijkstra with an *indexed* binary min-heap that keeps exactly one entry per vertex and supports `decreaseKey`. Return shortest distances from `s`. No standard heap library for the indexed structure.

**Constraints.**
- `1 ≤ V ≤ 2·10^5`, `0 ≤ E ≤ 5·10^5`, `0 ≤ w ≤ 10^9`.
- Heap holds at most `O(V)` entries.

**Hints.**
- Maintain `pos[v]` (vertex → heap slot) updated on every swap.
- On relaxation: if `v` is in the heap, `decreaseKey`; else `push`.
- `decreaseKey` only ever sifts up.

#### Go
```go
package main

import "fmt"

const INF = int(1e18)

type IndexedHeap struct {
	nodes []int
	pos   []int
	key   []int
}

func NewIndexedHeap(n int) *IndexedHeap {
	pos := make([]int, n)
	key := make([]int, n)
	for i := range pos {
		pos[i] = -1
		key[i] = INF
	}
	return &IndexedHeap{pos: pos, key: key}
}

func (h *IndexedHeap) Empty() bool        { return len(h.nodes) == 0 }
func (h *IndexedHeap) Contains(v int) bool { return h.pos[v] != -1 }

func (h *IndexedHeap) Push(v, k int) {
	h.key[v] = k
	h.nodes = append(h.nodes, v)
	h.pos[v] = len(h.nodes) - 1
	h.siftUp(len(h.nodes) - 1)
}

func (h *IndexedHeap) DecreaseKey(v, k int) {
	if k >= h.key[v] {
		return
	}
	h.key[v] = k
	h.siftUp(h.pos[v])
}

func (h *IndexedHeap) Pop() int {
	top := h.nodes[0]
	last := len(h.nodes) - 1
	h.swap(0, last)
	h.nodes = h.nodes[:last]
	h.pos[top] = -1
	if last > 0 {
		h.siftDown(0)
	}
	return top
}

func (h *IndexedHeap) siftUp(i int) {
	for i > 0 {
		p := (i - 1) / 2
		if h.key[h.nodes[p]] <= h.key[h.nodes[i]] {
			return
		}
		h.swap(p, i)
		i = p
	}
}

func (h *IndexedHeap) siftDown(i int) {
	n := len(h.nodes)
	for {
		l, r, m := 2*i+1, 2*i+2, i
		if l < n && h.key[h.nodes[l]] < h.key[h.nodes[m]] {
			m = l
		}
		if r < n && h.key[h.nodes[r]] < h.key[h.nodes[m]] {
			m = r
		}
		if m == i {
			return
		}
		h.swap(i, m)
		i = m
	}
}

func (h *IndexedHeap) swap(a, b int) {
	h.nodes[a], h.nodes[b] = h.nodes[b], h.nodes[a]
	h.pos[h.nodes[a]] = a
	h.pos[h.nodes[b]] = b
}

func dijkstra(adj [][][2]int, s int) []int {
	n := len(adj)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	h := NewIndexedHeap(n)
	h.Push(s, 0)
	for !h.Empty() {
		u := h.Pop()
		for _, e := range adj[u] {
			v, nd := e[0], dist[u]+e[1]
			if nd < dist[v] {
				dist[v] = nd
				if h.Contains(v) {
					h.DecreaseKey(v, nd)
				} else {
					h.Push(v, nd)
				}
			}
		}
	}
	return dist
}

func main() {
	adj := [][][2]int{
		{{1, 2}, {2, 5}},
		{{2, 1}, {3, 7}},
		{{3, 3}, {4, 8}},
		{{4, 2}},
		{},
	}
	fmt.Println(dijkstra(adj, 0)) // [0 2 3 6 8]
}
```

#### Java
```java
import java.util.*;

public class Task11 {
    static final long INF = Long.MAX_VALUE / 4;

    static final class IndexedHeap {
        int[] nodes, pos; long[] key; int size;
        IndexedHeap(int n) {
            nodes = new int[n]; pos = new int[n]; key = new long[n];
            Arrays.fill(pos, -1); Arrays.fill(key, INF);
        }
        boolean isEmpty() { return size == 0; }
        boolean contains(int v) { return pos[v] != -1; }
        void push(int v, long k) { key[v] = k; nodes[size] = v; pos[v] = size; siftUp(size++); }
        void decreaseKey(int v, long k) { if (k >= key[v]) return; key[v] = k; siftUp(pos[v]); }
        int pop() { int t = nodes[0]; swap(0, --size); pos[t] = -1; if (size > 0) siftDown(0); return t; }
        void siftUp(int i) {
            while (i > 0) { int p = (i - 1) / 2; if (key[nodes[p]] <= key[nodes[i]]) return; swap(p, i); i = p; }
        }
        void siftDown(int i) {
            while (true) {
                int l = 2*i+1, r = 2*i+2, m = i;
                if (l < size && key[nodes[l]] < key[nodes[m]]) m = l;
                if (r < size && key[nodes[r]] < key[nodes[m]]) m = r;
                if (m == i) return; swap(i, m); i = m;
            }
        }
        void swap(int a, int b) {
            int t = nodes[a]; nodes[a] = nodes[b]; nodes[b] = t;
            pos[nodes[a]] = a; pos[nodes[b]] = b;
        }
    }

    static long[] dijkstra(List<int[]>[] adj, int s) {
        int n = adj.length;
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        IndexedHeap h = new IndexedHeap(n);
        h.push(s, 0);
        while (!h.isEmpty()) {
            int u = h.pop();
            for (int[] e : adj[u]) {
                int v = e[0]; long nd = dist[u] + e[1];
                if (nd < dist[v]) {
                    dist[v] = nd;
                    if (h.contains(v)) h.decreaseKey(v, nd);
                    else h.push(v, nd);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 5;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 2}); adj[0].add(new int[]{2, 5});
        adj[1].add(new int[]{2, 1}); adj[1].add(new int[]{3, 7});
        adj[2].add(new int[]{3, 3}); adj[2].add(new int[]{4, 8});
        adj[3].add(new int[]{4, 2});
        System.out.println(Arrays.toString(dijkstra(adj, 0))); // [0, 2, 3, 6, 8]
    }
}
```

#### Python
```python
INF = float("inf")


class IndexedHeap:
    def __init__(self, n):
        self.nodes = []
        self.pos = [-1] * n
        self.key = [INF] * n

    def empty(self):
        return not self.nodes

    def contains(self, v):
        return self.pos[v] != -1

    def push(self, v, k):
        self.key[v] = k
        self.nodes.append(v)
        self.pos[v] = len(self.nodes) - 1
        self._up(len(self.nodes) - 1)

    def decrease_key(self, v, k):
        if k >= self.key[v]:
            return
        self.key[v] = k
        self._up(self.pos[v])

    def pop(self):
        top = self.nodes[0]
        last = len(self.nodes) - 1
        self._swap(0, last)
        self.nodes.pop()
        self.pos[top] = -1
        if self.nodes:
            self._down(0)
        return top

    def _up(self, i):
        while i > 0:
            p = (i - 1) // 2
            if self.key[self.nodes[p]] <= self.key[self.nodes[i]]:
                return
            self._swap(p, i)
            i = p

    def _down(self, i):
        n = len(self.nodes)
        while True:
            l, r, m = 2 * i + 1, 2 * i + 2, i
            if l < n and self.key[self.nodes[l]] < self.key[self.nodes[m]]:
                m = l
            if r < n and self.key[self.nodes[r]] < self.key[self.nodes[m]]:
                m = r
            if m == i:
                return
            self._swap(i, m)
            i = m

    def _swap(self, a, b):
        self.nodes[a], self.nodes[b] = self.nodes[b], self.nodes[a]
        self.pos[self.nodes[a]] = a
        self.pos[self.nodes[b]] = b


def dijkstra(adj, s):
    n = len(adj)
    dist = [INF] * n
    dist[s] = 0
    h = IndexedHeap(n)
    h.push(s, 0)
    while not h.empty():
        u = h.pop()
        for v, w in adj[u]:
            nd = dist[u] + w
            if nd < dist[v]:
                dist[v] = nd
                if h.contains(v):
                    h.decrease_key(v, nd)
                else:
                    h.push(v, nd)
    return dist


if __name__ == "__main__":
    adj = [[(1, 2), (2, 5)], [(2, 1), (3, 7)], [(3, 3), (4, 8)], [(4, 2)], []]
    print(dijkstra(adj, 0))  # [0, 2, 3, 6, 8]
```

---

### Task 12 — Bidirectional Dijkstra (single pair)

**Statement.** Given a directed graph and a single source/target pair `(s, t)`, return the shortest distance using **bidirectional** Dijkstra: a forward search from `s` and a backward search from `t` on the reverse graph, meeting in the middle. Return `INF` if unreachable.

**Constraints.**
- `1 ≤ V ≤ 2·10^5`, `0 ≤ E ≤ 5·10^5`, `0 ≤ w ≤ 10^9`.

**Hints.**
- Build the reverse adjacency list for the backward search.
- Track `best` meeting cost; whenever a vertex is settled in one direction and has a finite distance in the other, update `best = min(best, df[v] + db[v])`.
- Stopping condition: stop once `topF + topB ≥ best` (frontier minimums), not on first touch.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func biDijkstra(adj, radj [][][2]int, s, t int) int {
	n := len(adj)
	if s == t {
		return 0
	}
	df := make([]int, n)
	db := make([]int, n)
	for i := 0; i < n; i++ {
		df[i] = INF
		db[i] = INF
	}
	df[s], db[t] = 0, 0
	pf := &pq{{0, s}}
	pb := &pq{{0, t}}
	doneF := make([]bool, n)
	doneB := make([]bool, n)
	best := INF

	step := func(p *pq, dist []int, done []bool, g [][][2]int, other []int) {
		cur := heap.Pop(p).(item)
		if cur.dist > dist[cur.node] {
			return
		}
		done[cur.node] = true
		for _, e := range g[cur.node] {
			v := e[0]
			if nd := cur.dist + e[1]; nd < dist[v] {
				dist[v] = nd
				heap.Push(p, item{nd, v})
			}
		}
		if other[cur.node] < INF && dist[cur.node]+other[cur.node] < best {
			best = dist[cur.node] + other[cur.node]
		}
	}

	for pf.Len() > 0 && pb.Len() > 0 {
		if (*pf)[0].dist+(*pb)[0].dist >= best {
			break
		}
		step(pf, df, doneF, adj, db)
		step(pb, db, doneB, radj, df)
	}
	return best
}

func main() {
	// 0->1(2) 1->2(2) 0->2(5)
	adj := [][][2]int{{{1, 2}, {2, 5}}, {{2, 2}}, {}}
	radj := [][][2]int{{}, {{0, 2}}, {{1, 2}, {0, 5}}}
	fmt.Println(biDijkstra(adj, radj, 0, 2)) // 4
}
```

#### Java
```java
import java.util.*;

public class Task12 {
    static final long INF = Long.MAX_VALUE / 4;

    static long biDijkstra(List<int[]>[] adj, List<int[]>[] radj, int s, int t) {
        int n = adj.length;
        if (s == t) return 0;
        long[] df = new long[n], db = new long[n];
        Arrays.fill(df, INF); Arrays.fill(db, INF);
        df[s] = 0; db[t] = 0;
        PriorityQueue<long[]> pf = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        PriorityQueue<long[]> pb = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pf.add(new long[]{0, s}); pb.add(new long[]{0, t});
        long[] best = {INF};

        while (!pf.isEmpty() && !pb.isEmpty()) {
            if (pf.peek()[0] + pb.peek()[0] >= best[0]) break;
            step(pf, df, adj, db, best);
            step(pb, db, radj, df, best);
        }
        return best[0];
    }

    static void step(PriorityQueue<long[]> p, long[] dist, List<int[]>[] g, long[] other, long[] best) {
        long[] cur = p.poll();
        long d = cur[0]; int u = (int) cur[1];
        if (d > dist[u]) return;
        for (int[] e : g[u]) {
            int v = e[0]; long nd = d + e[1];
            if (nd < dist[v]) { dist[v] = nd; p.add(new long[]{nd, v}); }
        }
        if (other[u] < INF && dist[u] + other[u] < best[0]) best[0] = dist[u] + other[u];
    }

    public static void main(String[] args) {
        int n = 3;
        List<int[]>[] adj = new List[n], radj = new List[n];
        for (int i = 0; i < n; i++) { adj[i] = new ArrayList<>(); radj[i] = new ArrayList<>(); }
        adj[0].add(new int[]{1, 2}); adj[0].add(new int[]{2, 5}); adj[1].add(new int[]{2, 2});
        radj[1].add(new int[]{0, 2}); radj[2].add(new int[]{1, 2}); radj[2].add(new int[]{0, 5});
        System.out.println(biDijkstra(adj, radj, 0, 2)); // 4
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def bi_dijkstra(adj, radj, s, t):
    n = len(adj)
    if s == t:
        return 0
    df = [INF] * n
    db = [INF] * n
    df[s] = 0
    db[t] = 0
    pf = [(0, s)]
    pb = [(0, t)]
    best = INF

    def step(p, dist, g, other, best):
        d, u = heapq.heappop(p)
        if d > dist[u]:
            return best
        for v, w in g[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(p, (nd, v))
        if other[u] < INF and dist[u] + other[u] < best:
            best = dist[u] + other[u]
        return best

    while pf and pb:
        if pf[0][0] + pb[0][0] >= best:
            break
        best = step(pf, df, adj, db, best)
        best = step(pb, db, radj, df, best)
    return best


if __name__ == "__main__":
    adj = [[(1, 2), (2, 5)], [(2, 2)], []]
    radj = [[], [(0, 2)], [(1, 2), (0, 5)]]
    print(bi_dijkstra(adj, radj, 0, 2))  # 4
```

---

### Task 13 — Minimum cost to reach a target with refuel/charge state

**Statement.** A traveler moves on a weighted graph but a tank holds at most `cap` units of fuel; each edge `(u, v, w)` consumes `w` fuel. Certain vertices are stations where the tank refills to `cap` (for free). Find the minimum total distance from `s` to `t` such that the tank never goes negative. (Refueling resets fuel but does not change distance.)

**Constraints.**
- `1 ≤ V ≤ 10^4`, `0 ≤ E ≤ 5·10^4`, `1 ≤ w ≤ cap ≤ 10^4`.

**Hints.**
- State is `(vertex, fuel_remaining)`; relax over this expanded space with key = total distance.
- At a station, the resulting fuel after arriving becomes `cap`.
- Use a `dist[v][fuel]` table (or a map) and the usual stale check.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

const INF = int(1e18)

type st struct{ d, v, fuel int }
type pq []st

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(st)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func minDist(adj [][][2]int, station []bool, cap, s, t int) int {
	n := len(adj)
	best := make([][]int, n)
	for i := range best {
		best[i] = make([]int, cap+1)
		for j := range best[i] {
			best[i][j] = INF
		}
	}
	startFuel := cap
	best[s][startFuel] = 0
	h := &pq{{0, s, startFuel}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(st)
		if cur.d > best[cur.v][cur.fuel] {
			continue
		}
		if cur.v == t {
			return cur.d
		}
		for _, e := range adj[cur.v] {
			nv, w := e[0], e[1]
			if cur.fuel < w {
				continue // not enough fuel for this edge
			}
			nf := cur.fuel - w
			if station[nv] {
				nf = cap // refuel on arrival
			}
			nd := cur.d + w
			if nd < best[nv][nf] {
				best[nv][nf] = nd
				heap.Push(h, st{nd, nv, nf})
			}
		}
	}
	return -1
}

func main() {
	adj := [][][2]int{
		{{1, 3}},
		{{2, 3}},
		{{3, 3}},
		{},
	}
	station := []bool{false, true, false, false}
	fmt.Println(minDist(adj, station, 4, 0, 3)) // 9
}
```

#### Java
```java
import java.util.*;

public class Task13 {
    static final int INF = Integer.MAX_VALUE / 2;

    static int minDist(List<int[]>[] adj, boolean[] station, int cap, int s, int t) {
        int n = adj.length;
        int[][] best = new int[n][cap + 1];
        for (int[] row : best) Arrays.fill(row, INF);
        best[s][cap] = 0;
        // {d, v, fuel}
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, s, cap});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int d = cur[0], v = cur[1], fuel = cur[2];
            if (d > best[v][fuel]) continue;
            if (v == t) return d;
            for (int[] e : adj[v]) {
                int nv = e[0], w = e[1];
                if (fuel < w) continue;
                int nf = station[nv] ? cap : fuel - w;
                int nd = d + w;
                if (nd < best[nv][nf]) {
                    best[nv][nf] = nd;
                    pq.add(new int[]{nd, nv, nf});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 3}); adj[1].add(new int[]{2, 3}); adj[2].add(new int[]{3, 3});
        boolean[] station = {false, true, false, false};
        System.out.println(minDist(adj, station, 4, 0, 3)); // 9
    }
}
```

#### Python
```python
import heapq

INF = float("inf")


def min_dist(adj, station, cap, s, t):
    n = len(adj)
    best = [[INF] * (cap + 1) for _ in range(n)]
    best[s][cap] = 0
    pq = [(0, s, cap)]  # (dist, vertex, fuel)
    while pq:
        d, v, fuel = heapq.heappop(pq)
        if d > best[v][fuel]:
            continue
        if v == t:
            return d
        for nv, w in adj[v]:
            if fuel < w:
                continue
            nf = cap if station[nv] else fuel - w
            nd = d + w
            if nd < best[nv][nf]:
                best[nv][nf] = nd
                heapq.heappush(pq, (nd, nv, nf))
    return -1


if __name__ == "__main__":
    adj = [[(1, 3)], [(2, 3)], [(3, 3)], []]
    station = [False, True, False, False]
    print(min_dist(adj, station, 4, 0, 3))  # 9
```

---

### Task 14 — K-th shortest path (allowing repeated vertices)

**Statement.** Directed weighted graph, source `s`, target `t`, integer `k`. Return the length of the `k`-th shortest path from `s` to `t` (paths may repeat vertices/edges), or `-1` if fewer than `k` paths exist.

**Constraints.**
- `1 ≤ V ≤ 1000`, `0 ≤ E ≤ 10^4`, `1 ≤ w ≤ 10^4`, `1 ≤ k ≤ 1000`.

**Hints.**
- Run a modified Dijkstra without a single settled set: allow each vertex to be popped up to `k` times.
- Maintain `count[v]`; expand a popped state only while `count[v] ≤ k`.
- The `k`-th time you pop `t`, that distance is the answer.

#### Go
```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct{ dist, node int }
type pq []item

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func kthShortest(adj [][][2]int, s, t, k int) int {
	n := len(adj)
	count := make([]int, n)
	h := &pq{{0, s}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		count[cur.node]++
		if cur.node == t && count[cur.node] == k {
			return cur.dist
		}
		if count[cur.node] > k {
			continue
		}
		for _, e := range adj[cur.node] {
			heap.Push(h, item{cur.dist + e[1], e[0]})
		}
	}
	return -1
}

func main() {
	adj := [][][2]int{
		{{1, 1}, {2, 4}},
		{{2, 1}},
		{},
	}
	fmt.Println(kthShortest(adj, 0, 2, 1)) // 2 (0->1->2)
	fmt.Println(kthShortest(adj, 0, 2, 2)) // 4 (0->2)
}
```

#### Java
```java
import java.util.*;

public class Task14 {
    static int kthShortest(List<int[]>[] adj, int s, int t, int k) {
        int n = adj.length;
        int[] count = new int[n];
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        pq.add(new int[]{0, s});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int d = cur[0], u = cur[1];
            count[u]++;
            if (u == t && count[u] == k) return d;
            if (count[u] > k) continue;
            for (int[] e : adj[u]) pq.add(new int[]{d + e[1], e[0]});
        }
        return -1;
    }

    public static void main(String[] args) {
        int n = 3;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 1}); adj[0].add(new int[]{2, 4});
        adj[1].add(new int[]{2, 1});
        System.out.println(kthShortest(adj, 0, 2, 1)); // 2
        System.out.println(kthShortest(adj, 0, 2, 2)); // 4
    }
}
```

#### Python
```python
import heapq


def kth_shortest(adj, s, t, k):
    n = len(adj)
    count = [0] * n
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        count[u] += 1
        if u == t and count[u] == k:
            return d
        if count[u] > k:
            continue
        for v, w in adj[u]:
            heapq.heappush(pq, (d + w, v))
    return -1


if __name__ == "__main__":
    adj = [[(1, 1), (2, 4)], [(2, 1)], []]
    print(kth_shortest(adj, 0, 2, 1))  # 2
    print(kth_shortest(adj, 0, 2, 2))  # 4
```

---

### Task 15 — Dense-graph Dijkstra: O(V²) array variant

**Statement.** Given a graph as an `V × V` adjacency *matrix* (`mat[u][v]` is the weight, or `-1` if no edge), compute shortest distances from `s` using the `O(V²)` array-scan Dijkstra. This is the variant that beats the heap on dense graphs.

**Constraints.**
- `1 ≤ V ≤ 2000`, weights `0 ≤ w ≤ 10^9`, `mat[u][v] = -1` means no edge.

**Hints.**
- No heap: each round, linearly scan all unsettled vertices to find the minimum.
- After settling `u`, relax `u`'s row of the matrix.
- `V` rounds × `O(V)` scan + `O(V)` relax = `O(V²)`.

#### Go
```go
package main

import "fmt"

const INF = int(1e18)

func dijkstraDense(mat [][]int, s int) []int {
	n := len(mat)
	dist := make([]int, n)
	done := make([]bool, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	for iter := 0; iter < n; iter++ {
		u, bestD := -1, INF
		for v := 0; v < n; v++ {
			if !done[v] && dist[v] < bestD {
				bestD = dist[v]
				u = v
			}
		}
		if u == -1 {
			break // remaining vertices unreachable
		}
		done[u] = true
		for v := 0; v < n; v++ {
			if mat[u][v] >= 0 && !done[v] {
				if nd := dist[u] + mat[u][v]; nd < dist[v] {
					dist[v] = nd
				}
			}
		}
	}
	return dist
}

func main() {
	mat := [][]int{
		{-1, 4, 1, -1},
		{-1, -1, -1, 1},
		{-1, 2, -1, 5},
		{-1, -1, -1, -1},
	}
	fmt.Println(dijkstraDense(mat, 0)) // [0 3 1 4]
}
```

#### Java
```java
import java.util.*;

public class Task15 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] dijkstraDense(int[][] mat, int s) {
        int n = mat.length;
        long[] dist = new long[n];
        boolean[] done = new boolean[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        for (int iter = 0; iter < n; iter++) {
            int u = -1; long bestD = INF;
            for (int v = 0; v < n; v++)
                if (!done[v] && dist[v] < bestD) { bestD = dist[v]; u = v; }
            if (u == -1) break;
            done[u] = true;
            for (int v = 0; v < n; v++) {
                if (mat[u][v] >= 0 && !done[v]) {
                    long nd = dist[u] + mat[u][v];
                    if (nd < dist[v]) dist[v] = nd;
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int[][] mat = {
            {-1, 4, 1, -1},
            {-1, -1, -1, 1},
            {-1, 2, -1, 5},
            {-1, -1, -1, -1},
        };
        System.out.println(Arrays.toString(dijkstraDense(mat, 0))); // [0, 3, 1, 4]
    }
}
```

#### Python
```python
INF = float("inf")


def dijkstra_dense(mat, s):
    n = len(mat)
    dist = [INF] * n
    done = [False] * n
    dist[s] = 0
    for _ in range(n):
        u, best = -1, INF
        for v in range(n):
            if not done[v] and dist[v] < best:
                best, u = dist[v], v
        if u == -1:
            break
        done[u] = True
        for v in range(n):
            if mat[u][v] >= 0 and not done[v]:
                nd = dist[u] + mat[u][v]
                if nd < dist[v]:
                    dist[v] = nd
    return dist


if __name__ == "__main__":
    mat = [
        [-1, 4, 1, -1],
        [-1, -1, -1, 1],
        [-1, 2, -1, 5],
        [-1, -1, -1, -1],
    ]
    print(dijkstra_dense(mat, 0))  # [0, 3, 1, 4]
```

---

## Benchmark Task

### Task 16 — Lazy vs eager vs dense Dijkstra on random graphs

**Statement.** Build a benchmark harness that generates random non-negative weighted graphs and times three Dijkstra implementations on the same inputs:

1. **Lazy binary heap** (`O((V+E) log V)`, the default — Task 1).
2. **Eager indexed heap** (decrease-key, one entry per vertex — Task 11).
3. **Dense array scan** (`O(V²)` — Task 15).

Measure on two regimes and report which wins:
- **Sparse:** `V = 50_000`, `E ≈ 5·V` (road-network-like).
- **Dense:** `V = 1500`, `E ≈ V²/2` (near-complete).

**Constraints.**
- Same graph instance fed to all three implementations; verify all three produce identical `dist` arrays before timing.
- Use a fixed random seed for reproducibility.

**What to observe.**
- On the **sparse** graph the lazy binary heap typically wins: simplest code, fewest cache misses, and the heap stays small relative to `V²`.
- On the **dense** graph the `O(V²)` array scan beats both heap variants, because `V²` < `(V+E) log V ≈ V² log V`.
- The eager indexed heap is rarely the outright winner on real hardware — its smaller heap is offset by index-map cache traffic — which is why the topic recommends the lazy heap as the default and reserves eager/dense for profiled bottlenecks.

**Hints.**
- Convert the same edge list into both an adjacency list (for the heap variants) and an adjacency matrix (for the dense variant).
- Warm up each implementation once before timing to avoid measuring JIT/allocation startup.
- Time several repetitions and report the median.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

// Reuse dijkstra (Task 1 lazy), dijkstra (Task 11 eager), dijkstraDense (Task 15)
// in your own module; here is the harness skeleton.

func randGraph(v, e int, seed int64) (adjList [][][2]int, mat [][]int) {
	r := rand.New(rand.NewSource(seed))
	adjList = make([][][2]int, v)
	mat = make([][]int, v)
	for i := range mat {
		mat[i] = make([]int, v)
		for j := range mat[i] {
			mat[i][j] = -1
		}
	}
	for i := 0; i < e; i++ {
		u, w := r.Intn(v), r.Intn(v)
		if u == w {
			continue
		}
		weight := r.Intn(1000) + 1
		adjList[u] = append(adjList[u], [2]int{w, weight})
		if mat[u][w] < 0 || weight < mat[u][w] {
			mat[u][w] = weight
		}
	}
	return
}

func timeIt(name string, f func()) {
	start := time.Now()
	f()
	fmt.Printf("%-20s %v\n", name, time.Since(start))
}

func main() {
	// Sparse
	adj, _ := randGraph(50000, 250000, 42)
	timeIt("sparse lazy", func() { dijkstra(adj, 0) })

	// Dense
	adjD, mat := randGraph(1500, 1500*1500/2, 7)
	timeIt("dense lazy", func() { dijkstra(adjD, 0) })
	timeIt("dense array", func() { dijkstraDense(mat, 0) })
}
```

#### Java
```java
import java.util.*;

public class Task16 {
    // Reuse dijkstra (lazy), dijkstra (eager), dijkstraDense from earlier tasks.

    static Random rnd;

    static void timeIt(String name, Runnable r) {
        long start = System.nanoTime();
        r.run();
        System.out.printf("%-20s %.2f ms%n", name, (System.nanoTime() - start) / 1e6);
    }

    static List<int[]>[] randAdj(int v, int e, long seed) {
        rnd = new Random(seed);
        List<int[]>[] adj = new List[v];
        for (int i = 0; i < v; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < e; i++) {
            int u = rnd.nextInt(v), w = rnd.nextInt(v);
            if (u == w) continue;
            adj[u].add(new int[]{w, rnd.nextInt(1000) + 1});
        }
        return adj;
    }

    public static void main(String[] args) {
        List<int[]>[] sparse = randAdj(50000, 250000, 42);
        // timeIt("sparse lazy", () -> Task1.dijkstra(sparse, 0));   // wire to your Task1
        List<int[]>[] dense = randAdj(1500, 1500 * 1500 / 2, 7);
        // timeIt("dense lazy", () -> Task1.dijkstra(dense, 0));
        // For the dense array variant, also build an int[][] matrix from the same edges.
        System.out.println("Wire timeIt() to your Task1/Task11/Task15 implementations.");
    }
}
```

#### Python
```python
import random
import time

# Reuse dijkstra (Task 1 lazy), dijkstra (Task 11 eager), dijkstra_dense (Task 15).


def rand_graph(v, e, seed):
    rnd = random.Random(seed)
    adj = [[] for _ in range(v)]
    mat = [[-1] * v for _ in range(v)]
    for _ in range(e):
        u, w = rnd.randrange(v), rnd.randrange(v)
        if u == w:
            continue
        weight = rnd.randint(1, 1000)
        adj[u].append((w, weight))
        if mat[u][w] < 0 or weight < mat[u][w]:
            mat[u][w] = weight
    return adj, mat


def time_it(name, fn):
    start = time.perf_counter()
    fn()
    print(f"{name:<20} {(time.perf_counter() - start) * 1000:.1f} ms")


if __name__ == "__main__":
    sparse_adj, _ = rand_graph(50_000, 250_000, 42)
    # time_it("sparse lazy", lambda: dijkstra(sparse_adj, 0))

    dense_adj, dense_mat = rand_graph(1500, 1500 * 1500 // 2, 7)
    # time_it("dense lazy",  lambda: dijkstra(dense_adj, 0))
    # time_it("dense array", lambda: dijkstra_dense(dense_mat, 0))
    print("Wire time_it() to your Task 1 / 11 / 15 implementations.")
```

**Expected takeaway.** Sparse → lazy binary heap wins. Dense → `O(V²)` array scan wins. The eager indexed heap is an optimization to reach for only after profiling identifies the heap as the bottleneck — exactly the guidance from `middle.md` and `senior.md`.
