# Bellman-Ford Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships a problem statement, constraints, hints, and a complete reference solution in all three languages.
> The unifying tool is **edge relaxation**: `if dist[u] != INF and dist[u] + w < dist[v]: dist[v] = dist[u] + w`, applied `V-1` times, with one extra round for negative-cycle detection.

---

## Beginner Tasks (5)

### Task 1 — Single-Source Shortest Paths from an Edge List

**Problem.** Given a directed weighted graph as an edge list and a source vertex, compute the shortest distance from the source to every vertex. Weights may be negative, but the graph has no negative cycle. Print `INF` for unreachable vertices.

**Input / Output spec.**
- Input: `n` (vertices), `m` (edges), `src`, then `m` lines of `u v w`.
- Output: `n` lines, `dist[i]` or `INF`.

**Constraints.**
- `1 <= n <= 10^4`, `0 <= m <= 10^5`.
- `-10^4 <= w <= 10^4`, no negative cycle.

**Hint.** Initialize `dist[src] = 0`, the rest to a large sentinel with headroom. Run `n-1` rounds; in each round, relax every edge, guarding with `dist[u] != INF`. Add an early-termination flag.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func bellmanFord(n int, edges [][3]int, src int) []int {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		changed := false
		for _, e := range edges {
			u, v, w := e[0], e[1], e[2]
			if dist[u] != INF && dist[u]+w < dist[v] {
				dist[v] = dist[u] + w
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	return dist
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}}
	for v, d := range bellmanFord(4, edges, 0) {
		if d == INF {
			fmt.Printf("%d: INF\n", v)
		} else {
			fmt.Printf("%d: %d\n", v, d)
		}
	}
}
```

**Java.**
```java
import java.util.*;

public class Task1 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] bellmanFord(int n, int[][] edges, int src) {
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round < n - 1; round++) {
            boolean changed = false;
            for (int[] e : edges) {
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                    changed = true;
                }
            }
            if (!changed) break;
        }
        return dist;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}};
        long[] d = bellmanFord(4, edges, 0);
        for (int v = 0; v < d.length; v++)
            System.out.println(v + ": " + (d[v] == INF ? "INF" : d[v]));
    }
}
```

**Python.**
```python
INF = float("inf")


def bellman_ford(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    return dist


if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 5), (1, 2, -2), (2, 3, 3)]
    for v, d in enumerate(bellman_ford(4, edges, 0)):
        print(f"{v}: {'INF' if d == INF else d}")
```

---

### Task 2 — Detect a Negative Cycle Reachable from a Source

**Problem.** Given a directed weighted graph and a source, return `true` if a negative-weight cycle is reachable from the source, else `false`.

**Constraints.**
- `1 <= n <= 2000`, `0 <= m <= 10^4`, weights fit in 32-bit signed integers.

**Hint.** Run the usual `n-1` rounds, then **one extra** round. If any edge still relaxes in that extra round, a negative cycle is reachable. Keep the `dist[u] != INF` guard so unreachable parts do not trigger a false positive.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func reachableNegCycle(n int, edges [][3]int, src int) bool {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
			}
		}
	}
	for _, e := range edges { // detection pass
		if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
			return true
		}
	}
	return false
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, -1}, {2, 1, -1}}
	fmt.Println(reachableNegCycle(3, edges, 0)) // true
}
```

**Java.**
```java
public class Task2 {
    static final long INF = Long.MAX_VALUE / 4;

    static boolean reachableNegCycle(int n, int[][] edges, int src) {
        long[] dist = new long[n];
        java.util.Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round < n - 1; round++)
            for (int[] e : edges)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]])
                    dist[e[1]] = dist[e[0]] + e[2];
        for (int[] e : edges)
            if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) return true;
        return false;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, -1}, {2, 1, -1}};
        System.out.println(reachableNegCycle(3, edges, 0)); // true
    }
}
```

**Python.**
```python
INF = float("inf")


def reachable_neg_cycle(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return any(dist[u] != INF and dist[u] + w < dist[v] for u, v, w in edges)


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, -1), (2, 1, -1)]
    print(reachable_neg_cycle(3, edges, 0))  # True
```

---

### Task 3 — Reconstruct the Shortest Path

**Problem.** Given a graph with no negative cycle, a source, and a target, return the actual shortest path as a list of vertices (or empty if the target is unreachable).

**Constraints.**
- `1 <= n <= 10^4`, `0 <= m <= 10^5`, no negative cycle.

**Hint.** Maintain `pred[v]`, set on every relaxation. After the rounds, walk `pred` backward from the target to the source, then reverse. If you never reach the source, the target is unreachable.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func shortestPath(n int, edges [][3]int, src, dst int) []int {
	dist := make([]int, n)
	pred := make([]int, n)
	for i := range dist {
		dist[i] = INF
		pred[i] = -1
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
				pred[e[1]] = e[0]
			}
		}
	}
	if dist[dst] == INF {
		return nil
	}
	path := []int{}
	for v := dst; v != -1; v = pred[v] {
		path = append(path, v)
		if v == src {
			break
		}
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}}
	fmt.Println(shortestPath(4, edges, 0, 3)) // [0 1 2 3]
}
```

**Java.**
```java
import java.util.*;

public class Task3 {
    static final long INF = Long.MAX_VALUE / 4;

    static List<Integer> shortestPath(int n, int[][] edges, int src, int dst) {
        long[] dist = new long[n];
        int[] pred = new int[n];
        Arrays.fill(dist, INF);
        Arrays.fill(pred, -1);
        dist[src] = 0;
        for (int round = 0; round < n - 1; round++)
            for (int[] e : edges)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                    pred[e[1]] = e[0];
                }
        if (dist[dst] == INF) return Collections.emptyList();
        LinkedList<Integer> path = new LinkedList<>();
        for (int v = dst; v != -1; v = pred[v]) {
            path.addFirst(v);
            if (v == src) break;
        }
        return path;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}};
        System.out.println(shortestPath(4, edges, 0, 3)); // [0, 1, 2, 3]
    }
}
```

**Python.**
```python
INF = float("inf")


def shortest_path(n, edges, src, dst):
    dist = [INF] * n
    pred = [-1] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                pred[v] = u
    if dist[dst] == INF:
        return []
    path, v = [], dst
    while v != -1:
        path.append(v)
        if v == src:
            break
        v = pred[v]
    return path[::-1]


if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 5), (1, 2, -2), (2, 3, 3)]
    print(shortest_path(4, edges, 0, 3))  # [0, 1, 2, 3]
```

---

### Task 4 — Shortest Path in a DAG (Topological Relaxation)

**Problem.** Given a directed **acyclic** graph (possibly with negative weights) and a source, compute shortest distances in `O(V+E)` using a single relaxation pass in topological order, instead of `V-1` Bellman-Ford rounds.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`, graph is a DAG.

**Hint.** Topologically sort the vertices (Kahn's algorithm or DFS). Then process vertices in that order; for each, relax all its outgoing edges once. Because every edge goes from an earlier to a later vertex, one pass suffices.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func dagShortest(n int, adj [][][2]int, src int) []int {
	indeg := make([]int, n)
	for u := 0; u < n; u++ {
		for _, e := range adj[u] {
			indeg[e[0]]++
		}
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, e := range adj[u] {
			indeg[e[0]]--
			if indeg[e[0]] == 0 {
				queue = append(queue, e[0])
			}
		}
	}
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for _, u := range order {
		if dist[u] == INF {
			continue
		}
		for _, e := range adj[u] {
			if dist[u]+e[1] < dist[e[0]] {
				dist[e[0]] = dist[u] + e[1]
			}
		}
	}
	return dist
}

func main() {
	adj := make([][][2]int, 4)
	adj[0] = [][2]int{{1, 4}, {2, 5}}
	adj[1] = [][2]int{{2, -2}, {3, 6}}
	adj[2] = [][2]int{{3, 3}}
	fmt.Println(dagShortest(4, adj, 0)) // [0 4 2 5]
}
```

**Java.**
```java
import java.util.*;

public class Task4 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] dagShortest(int n, List<int[]>[] adj, int src) {
        int[] indeg = new int[n];
        for (int u = 0; u < n; u++)
            for (int[] e : adj[u]) indeg[e[0]]++;
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        List<Integer> order = new ArrayList<>();
        while (!q.isEmpty()) {
            int u = q.poll();
            order.add(u);
            for (int[] e : adj[u]) if (--indeg[e[0]] == 0) q.add(e[0]);
        }
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int u : order) {
            if (dist[u] == INF) continue;
            for (int[] e : adj[u])
                if (dist[u] + e[1] < dist[e[0]]) dist[e[0]] = dist[u] + e[1];
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new int[]{1, 4}); adj[0].add(new int[]{2, 5});
        adj[1].add(new int[]{2, -2}); adj[1].add(new int[]{3, 6});
        adj[2].add(new int[]{3, 3});
        System.out.println(Arrays.toString(dagShortest(n, adj, 0))); // [0, 4, 2, 5]
    }
}
```

**Python.**
```python
from collections import deque

INF = float("inf")


def dag_shortest(n, adj, src):
    indeg = [0] * n
    for u in range(n):
        for v, _ in adj[u]:
            indeg[v] += 1
    q = deque(v for v in range(n) if indeg[v] == 0)
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v, _ in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    dist = [INF] * n
    dist[src] = 0
    for u in order:
        if dist[u] == INF:
            continue
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return dist


if __name__ == "__main__":
    adj = {0: [(1, 4), (2, 5)], 1: [(2, -2), (3, 6)], 2: [(3, 3)], 3: []}
    print(dag_shortest(4, adj, 0))  # [0, 4, 2, 5]
```

---

### Task 5 — Count Rounds Until Convergence

**Problem.** Run Bellman-Ford with early termination and return the **number of rounds** actually performed before convergence (a round that makes no change does not count toward "useful" rounds). This number is one plus the hop-length of the longest realized shortest path.

**Constraints.**
- `1 <= n <= 10^4`, `0 <= m <= 10^5`, no negative cycle.

**Hint.** Increment a counter each time a round makes at least one relaxation. Stop as soon as a round changes nothing. The counter reveals how far the early-termination optimization saves you compared to the `n-1` worst case.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func roundsToConverge(n int, edges [][3]int, src int) int {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	rounds := 0
	for round := 0; round < n-1; round++ {
		changed := false
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
				changed = true
			}
		}
		if !changed {
			break
		}
		rounds++
	}
	return rounds
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 1}, {2, 3, 1}}
	fmt.Println(roundsToConverge(4, edges, 0)) // 3
}
```

**Java.**
```java
public class Task5 {
    static final long INF = Long.MAX_VALUE / 4;

    static int roundsToConverge(int n, int[][] edges, int src) {
        long[] dist = new long[n];
        java.util.Arrays.fill(dist, INF);
        dist[src] = 0;
        int rounds = 0;
        for (int round = 0; round < n - 1; round++) {
            boolean changed = false;
            for (int[] e : edges)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                    changed = true;
                }
            if (!changed) break;
            rounds++;
        }
        return rounds;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, 1}, {2, 3, 1}};
        System.out.println(roundsToConverge(4, edges, 0)); // 3
    }
}
```

**Python.**
```python
INF = float("inf")


def rounds_to_converge(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    rounds = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
        rounds += 1
    return rounds


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, 1), (2, 3, 1)]
    print(rounds_to_converge(4, edges, 0))  # 3
```

---

## Intermediate Tasks (5)

### Task 6 — Extract the Negative Cycle

**Problem.** Detect whether the graph contains a negative cycle (anywhere) and, if so, return its vertices in order around the cycle. Return an empty list if none.

**Constraints.**
- `1 <= n <= 2000`, weights fit in 32-bit signed integers.

**Hint.** Initialize all distances to 0 (virtual super-source). Run `n` rounds, tracking the last vertex `x` relaxed in the final round and `pred`. Step `pred` `n` times from `x` to guarantee landing inside the cycle, then follow `pred` until it repeats.

**Go.**
```go
package main

import "fmt"

func findNegativeCycle(n int, edges [][3]int) []int {
	dist := make([]int, n)
	pred := make([]int, n)
	for i := range pred {
		pred[i] = -1
	}
	x := -1
	for i := 0; i < n; i++ {
		x = -1
		for _, e := range edges {
			if dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
				pred[e[1]] = e[0]
				x = e[1]
			}
		}
	}
	if x == -1 {
		return nil
	}
	for i := 0; i < n; i++ {
		x = pred[x]
	}
	cycle := []int{x}
	for v := pred[x]; v != x; v = pred[v] {
		cycle = append(cycle, v)
	}
	cycle = append(cycle, x)
	for i, j := 0, len(cycle)-1; i < j; i, j = i+1, j-1 {
		cycle[i], cycle[j] = cycle[j], cycle[i]
	}
	return cycle
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, -1}, {2, 0, -1}}
	fmt.Println(findNegativeCycle(3, edges)) // a rotation of [0 1 2 0]
}
```

**Java.**
```java
import java.util.*;

public class Task6 {
    static List<Integer> findNegativeCycle(int n, int[][] edges) {
        long[] dist = new long[n];
        int[] pred = new int[n];
        Arrays.fill(pred, -1);
        int x = -1;
        for (int i = 0; i < n; i++) {
            x = -1;
            for (int[] e : edges)
                if (dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2];
                    pred[e[1]] = e[0];
                    x = e[1];
                }
        }
        if (x == -1) return Collections.emptyList();
        for (int i = 0; i < n; i++) x = pred[x];
        LinkedList<Integer> cycle = new LinkedList<>();
        int v = x;
        do { cycle.addFirst(v); v = pred[v]; } while (v != x);
        cycle.addFirst(x);
        return cycle;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, -1}, {2, 0, -1}};
        System.out.println(findNegativeCycle(3, edges));
    }
}
```

**Python.**
```python
def find_negative_cycle(n, edges):
    dist = [0] * n
    pred = [-1] * n
    x = -1
    for _ in range(n):
        x = -1
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                pred[v] = u
                x = v
    if x == -1:
        return []
    for _ in range(n):
        x = pred[x]
    cycle = [x]
    v = pred[x]
    while v != x:
        cycle.append(v)
        v = pred[v]
    cycle.append(x)
    return cycle[::-1]


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, -1), (2, 0, -1)]
    print(find_negative_cycle(3, edges))
```

---

### Task 7 — Cheapest Flights Within K Stops

**Problem.** Given `n` cities and `flights[i] = [from, to, price]`, find the cheapest price from `src` to `dst` with at most `k` stops (at most `k+1` edges). Return `-1` if impossible.

**Constraints.**
- `1 <= n <= 100`, `1 <= price <= 10^4`, `0 <= k < n`.

**Hint.** Run exactly `k+1` rounds, but relax from a **snapshot** of the previous round's distances so each round adds at most one hop.

**Go.**
```go
package main

import "fmt"

func findCheapestPrice(n int, flights [][]int, src, dst, k int) int {
	const INF = 1 << 30
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round <= k; round++ {
		snap := make([]int, n)
		copy(snap, dist)
		for _, f := range flights {
			if snap[f[0]] != INF && snap[f[0]]+f[2] < dist[f[1]] {
				dist[f[1]] = snap[f[0]] + f[2]
			}
		}
	}
	if dist[dst] == INF {
		return -1
	}
	return dist[dst]
}

func main() {
	flights := [][]int{{0, 1, 100}, {1, 2, 100}, {2, 0, 100}, {1, 3, 600}, {2, 3, 200}}
	fmt.Println(findCheapestPrice(4, flights, 0, 3, 1)) // 700
}
```

**Java.**
```java
import java.util.*;

public class Task7 {
    public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
        final int INF = 1 << 30;
        int[] dist = new int[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round <= k; round++) {
            int[] snap = dist.clone();
            for (int[] f : flights)
                if (snap[f[0]] != INF && snap[f[0]] + f[2] < dist[f[1]])
                    dist[f[1]] = snap[f[0]] + f[2];
        }
        return dist[dst] == INF ? -1 : dist[dst];
    }

    public static void main(String[] args) {
        int[][] flights = {{0, 1, 100}, {1, 2, 100}, {2, 0, 100}, {1, 3, 600}, {2, 3, 200}};
        System.out.println(new Task7().findCheapestPrice(4, flights, 0, 3, 1)); // 700
    }
}
```

**Python.**
```python
def find_cheapest_price(n, flights, src, dst, k):
    INF = float("inf")
    dist = [INF] * n
    dist[src] = 0
    for _ in range(k + 1):
        snap = dist[:]
        for u, v, w in flights:
            if snap[u] + w < dist[v]:
                dist[v] = snap[u] + w
    return -1 if dist[dst] == INF else dist[dst]


if __name__ == "__main__":
    flights = [[0, 1, 100], [1, 2, 100], [2, 0, 100], [1, 3, 600], [2, 3, 200]]
    print(find_cheapest_price(4, flights, 0, 3, 1))  # 700
```

---

### Task 8 — SPFA (Queue-Based Bellman-Ford)

**Problem.** Implement SPFA: relax only the outgoing edges of vertices whose distance just improved, using a FIFO queue. Return distances, and detect a negative cycle by bailing when any vertex is relaxed into `>= n` times.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5·10^5`, weights fit in 32-bit signed integers.

**Hint.** Track an `inQueue` flag (do not enqueue a vertex already queued) and a `cnt` counter per vertex. The moment `cnt[v] >= n`, report a negative cycle.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

type Edge struct{ To, W int }

func spfa(n int, adj [][]Edge, src int) ([]int, bool) {
	dist := make([]int, n)
	cnt := make([]int, n)
	inQ := make([]bool, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	queue := []int{src}
	inQ[src] = true
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		inQ[u] = false
		for _, e := range adj[u] {
			if dist[u]+e.W < dist[e.To] {
				dist[e.To] = dist[u] + e.W
				cnt[e.To]++
				if cnt[e.To] >= n {
					return dist, true
				}
				if !inQ[e.To] {
					queue = append(queue, e.To)
					inQ[e.To] = true
				}
			}
		}
	}
	return dist, false
}

func main() {
	adj := make([][]Edge, 4)
	adj[0] = []Edge{{1, 4}, {2, 5}}
	adj[1] = []Edge{{2, -2}, {3, 6}}
	adj[2] = []Edge{{3, 3}}
	dist, neg := spfa(4, adj, 0)
	fmt.Println(dist, "neg:", neg) // [0 4 2 5] neg: false
}
```

**Java.**
```java
import java.util.*;

public class Task8 {
    static final long INF = Long.MAX_VALUE / 4;

    record E(int to, long w) {}

    static long[] spfa(int n, List<E>[] adj, int src, boolean[] neg) {
        long[] dist = new long[n];
        int[] cnt = new int[n];
        boolean[] inQ = new boolean[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        Deque<Integer> q = new ArrayDeque<>();
        q.add(src);
        inQ[src] = true;
        while (!q.isEmpty()) {
            int u = q.poll();
            inQ[u] = false;
            for (E e : adj[u]) {
                if (dist[u] + e.w() < dist[e.to()]) {
                    dist[e.to()] = dist[u] + e.w();
                    if (++cnt[e.to()] >= n) { neg[0] = true; return dist; }
                    if (!inQ[e.to()]) { q.add(e.to()); inQ[e.to()] = true; }
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int n = 4;
        List<E>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        adj[0].add(new E(1, 4)); adj[0].add(new E(2, 5));
        adj[1].add(new E(2, -2)); adj[1].add(new E(3, 6));
        adj[2].add(new E(3, 3));
        boolean[] neg = new boolean[1];
        System.out.println(Arrays.toString(spfa(n, adj, 0, neg)) + " neg: " + neg[0]);
    }
}
```

**Python.**
```python
from collections import deque

INF = float("inf")


def spfa(n, adj, src):
    dist = [INF] * n
    cnt = [0] * n
    in_q = [False] * n
    dist[src] = 0
    q = deque([src])
    in_q[src] = True
    while q:
        u = q.popleft()
        in_q[u] = False
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                cnt[v] += 1
                if cnt[v] >= n:
                    return dist, True
                if not in_q[v]:
                    q.append(v)
                    in_q[v] = True
    return dist, False


if __name__ == "__main__":
    adj = {0: [(1, 4), (2, 5)], 1: [(2, -2), (3, 6)], 2: [(3, 3)], 3: []}
    print(spfa(4, adj, 0))  # ([0, 4, 2, 5], False)
```

---

### Task 9 — Currency Arbitrage Detection

**Problem.** Given an `n × n` matrix `rate` where `rate[i][j]` is the units of currency `j` per unit of `i`, return `true` if a profitable trading cycle (arbitrage) exists.

**Constraints.**
- `2 <= n <= 100`, rates are positive floats.

**Hint.** Edge weight `w(i→j) = -log(rate[i][j])`. A rate product `> 1` around a cycle is a negative weight sum. Initialize all distances to 0 and use an epsilon in comparisons to avoid floating-point false positives.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func hasArbitrage(rate [][]float64) bool {
	n := len(rate)
	dist := make([]float64, n)
	const eps = 1e-12
	relax := func() bool {
		any := false
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				if i == j {
					continue
				}
				w := -math.Log(rate[i][j])
				if dist[i]+w < dist[j]-eps {
					dist[j] = dist[i] + w
					any = true
				}
			}
		}
		return any
	}
	for round := 0; round < n-1; round++ {
		if !relax() {
			return false
		}
	}
	return relax()
}

func main() {
	rate := [][]float64{{1, 0.5, 0.2}, {2, 1, 0.5}, {5, 2, 1}}
	fmt.Println(hasArbitrage(rate))
}
```

**Java.**
```java
public class Task9 {
    public boolean hasArbitrage(double[][] rate) {
        int n = rate.length;
        double[] dist = new double[n];
        final double eps = 1e-12;
        for (int round = 0; round < n; round++) {
            boolean any = false;
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++) {
                    if (i == j) continue;
                    double w = -Math.log(rate[i][j]);
                    if (dist[i] + w < dist[j] - eps) { dist[j] = dist[i] + w; any = true; }
                }
            if (round == n - 1) return any;       // detection round
            if (!any) return false;
        }
        return false;
    }

    public static void main(String[] args) {
        double[][] rate = {{1, 0.5, 0.2}, {2, 1, 0.5}, {5, 2, 1}};
        System.out.println(new Task9().hasArbitrage(rate));
    }
}
```

**Python.**
```python
import math


def has_arbitrage(rate):
    n = len(rate)
    edges = [(i, j, -math.log(rate[i][j]))
             for i in range(n) for j in range(n) if i != j]
    dist = [0.0] * n
    eps = 1e-12
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] + w < dist[v] - eps:
                dist[v] = dist[u] + w
    return any(dist[u] + w < dist[v] - eps for u, v, w in edges)


if __name__ == "__main__":
    rate = [[1, 0.5, 0.2], [2, 1, 0.5], [5, 2, 1]]
    print(has_arbitrage(rate))
```

---

### Task 10 — Difference Constraints Feasibility

**Problem.** Given `m` constraints of the form `x[b] - x[a] <= c`, decide whether a feasible assignment exists and, if so, return one. Use a super-source so every variable is reachable.

**Constraints.**
- `1 <= n <= 10^4` variables, `0 <= m <= 10^5` constraints.

**Hint.** Each constraint `x[b] - x[a] <= c` is an edge `a → b` with weight `c`. Add a super-source `s` (index `n`) with 0-weight edges to all `n` variables. Run Bellman-Ford from `s`; `x[i] = dist[i]`. A reachable negative cycle means infeasible.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

// constraints: each {a, b, c} means x[b] - x[a] <= c.
func solveDifference(n int, constraints [][3]int) ([]int, bool) {
	src := n
	V := n + 1
	edges := make([][3]int, 0, len(constraints)+n)
	for _, c := range constraints {
		edges = append(edges, [3]int{c[0], c[1], c[2]})
	}
	for v := 0; v < n; v++ {
		edges = append(edges, [3]int{src, v, 0})
	}
	dist := make([]int, V)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < V-1; round++ {
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
			}
		}
	}
	for _, e := range edges {
		if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
			return nil, false // infeasible
		}
	}
	return dist[:n], true
}

func main() {
	// x1 - x0 <= 3, x2 - x1 <= -2, x0 - x2 <= 1
	cons := [][3]int{{0, 1, 3}, {1, 2, -2}, {2, 0, 1}}
	x, ok := solveDifference(3, cons)
	fmt.Println(ok, x)
}
```

**Java.**
```java
import java.util.*;

public class Task10 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] solveDifference(int n, int[][] constraints) {
        int src = n, V = n + 1;
        List<int[]> edges = new ArrayList<>();
        for (int[] c : constraints) edges.add(c);          // {a, b, c}
        for (int v = 0; v < n; v++) edges.add(new int[]{src, v, 0});
        long[] dist = new long[V];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round < V - 1; round++)
            for (int[] e : edges)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]])
                    dist[e[1]] = dist[e[0]] + e[2];
        for (int[] e : edges)
            if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) return null;
        return Arrays.copyOf(dist, n);
    }

    public static void main(String[] args) {
        int[][] cons = {{0, 1, 3}, {1, 2, -2}, {2, 0, 1}};
        long[] x = solveDifference(3, cons);
        System.out.println(x == null ? "infeasible" : Arrays.toString(x));
    }
}
```

**Python.**
```python
INF = float("inf")


def solve_difference(n, constraints):
    """constraints: list of (a, b, c) meaning x[b] - x[a] <= c."""
    src, V = n, n + 1
    edges = list(constraints) + [(src, v, 0) for v in range(n)]
    dist = [INF] * V
    dist[src] = 0
    for _ in range(V - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    for u, v, w in edges:
        if dist[u] != INF and dist[u] + w < dist[v]:
            return None  # infeasible
    return dist[:n]


if __name__ == "__main__":
    cons = [(0, 1, 3), (1, 2, -2), (2, 0, 1)]
    print(solve_difference(3, cons))
```

---

## Advanced Tasks (5)

### Task 11 — Mark Vertices Reachable from a Negative Cycle as `-∞`

**Problem.** Compute shortest distances from `src`; for any vertex reachable from a negative cycle, the answer is `-∞`. Unreachable vertices are `+∞`.

**Constraints.**
- `1 <= n <= 10^4`, weights fit in 32-bit signed integers.

**Hint.** Phase 1: `n-1` standard rounds for finite distances. Phase 2: `n-1` more rounds; any vertex that still relaxes, or is reached from an already `-∞` vertex, becomes `-∞`. Two phases of `n-1` are needed so the `-∞` mark propagates fully.

**Go.**
```go
package main

import "fmt"

const INF = 1 << 60
const NEG = -(1 << 60)

func solve(n int, edges [][3]int, src int) []int {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
			}
		}
	}
	for round := 0; round < n-1; round++ {
		for _, e := range edges {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = NEG
			}
			if dist[e[0]] == NEG && dist[e[1]] != INF {
				dist[e[1]] = NEG
			}
		}
	}
	return dist
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, -1}, {2, 1, -1}, {1, 3, 5}}
	fmt.Println(solve(4, edges, 0))
}
```

**Java.**
```java
import java.util.*;

public class Task11 {
    static final long INF = 1L << 60, NEG = -(1L << 60);

    static long[] solve(int n, int[][] edges, int src) {
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int r = 0; r < n - 1; r++)
            for (int[] e : edges)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]])
                    dist[e[1]] = dist[e[0]] + e[2];
        for (int r = 0; r < n - 1; r++)
            for (int[] e : edges) {
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) dist[e[1]] = NEG;
                if (dist[e[0]] == NEG && dist[e[1]] != INF) dist[e[1]] = NEG;
            }
        return dist;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, -1}, {2, 1, -1}, {1, 3, 5}};
        System.out.println(Arrays.toString(solve(4, edges, 0)));
    }
}
```

**Python.**
```python
INF = float("inf")
NEG = float("-inf")


def solve(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = NEG
            if dist[u] == NEG and dist[v] != INF:
                dist[v] = NEG
    return dist


if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, -1), (2, 1, -1), (1, 3, 5)]
    print(solve(4, edges, 0))  # [0, -inf, -inf, -inf]
```

---

### Task 12 — Yen's Improvement (Forward/Backward Sweep)

**Problem.** Implement Yen's optimization: partition edges by vertex order into forward (`u < v`) and backward (`u > v`); each round, relax forward edges in increasing `u`, then backward edges in decreasing `u`. This roughly halves the number of rounds versus naive Bellman-Ford.

**Constraints.**
- `1 <= n <= 10^4`, `0 <= m <= 10^5`, no negative cycle.

**Hint.** Sort/partition edges once. Within a single forward sweep, all improvements that go strictly forward in the ordering propagate in one round (not one hop), and symmetrically for the backward sweep. Keep early termination.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

const INF = int(1e18)

func yenBellmanFord(n int, edges [][3]int, src int) []int {
	var fwd, bwd [][3]int
	for _, e := range edges {
		if e[0] < e[1] {
			fwd = append(fwd, e)
		} else {
			bwd = append(bwd, e)
		}
	}
	sort.Slice(fwd, func(i, j int) bool { return fwd[i][0] < fwd[j][0] })
	sort.Slice(bwd, func(i, j int) bool { return bwd[i][0] > bwd[j][0] })
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	for round := 0; round < n-1; round++ {
		changed := false
		for _, e := range fwd {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
				changed = true
			}
		}
		for _, e := range bwd {
			if dist[e[0]] != INF && dist[e[0]]+e[2] < dist[e[1]] {
				dist[e[1]] = dist[e[0]] + e[2]
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	return dist
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}}
	fmt.Println(yenBellmanFord(4, edges, 0)) // [0 4 2 5]
}
```

**Java.**
```java
import java.util.*;

public class Task12 {
    static final long INF = Long.MAX_VALUE / 4;

    static long[] yen(int n, int[][] edges, int src) {
        List<int[]> fwd = new ArrayList<>(), bwd = new ArrayList<>();
        for (int[] e : edges) (e[0] < e[1] ? fwd : bwd).add(e);
        fwd.sort((a, b) -> Integer.compare(a[0], b[0]));
        bwd.sort((a, b) -> Integer.compare(b[0], a[0]));
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        for (int round = 0; round < n - 1; round++) {
            boolean changed = false;
            for (int[] e : fwd)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2]; changed = true;
                }
            for (int[] e : bwd)
                if (dist[e[0]] != INF && dist[e[0]] + e[2] < dist[e[1]]) {
                    dist[e[1]] = dist[e[0]] + e[2]; changed = true;
                }
            if (!changed) break;
        }
        return dist;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}};
        System.out.println(Arrays.toString(yen(4, edges, 0))); // [0, 4, 2, 5]
    }
}
```

**Python.**
```python
INF = float("inf")


def yen(n, edges, src):
    fwd = sorted((e for e in edges if e[0] < e[1]), key=lambda e: e[0])
    bwd = sorted((e for e in edges if e[0] > e[1]), key=lambda e: -e[0])
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in fwd:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        for u, v, w in bwd:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    return dist


if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 5), (1, 2, -2), (2, 3, 3)]
    print(yen(4, edges, 0))  # [0, 4, 2, 5]
```

---

### Task 13 — Johnson's Reweighting Front End

**Problem.** Implement the Bellman-Ford stage of Johnson's all-pairs algorithm: add a super-source, run Bellman-Ford to get a potential `h[v]`, and return the reweighted edge weights `w'(u,v) = w(u,v) + h[u] - h[v]`, all guaranteed non-negative. Report failure if a negative cycle exists.

**Constraints.**
- `1 <= n <= 2000`, `0 <= m <= 10^4`, weights fit in 32-bit signed integers.

**Hint.** The super-source reaches every vertex with weight 0, so `h[v] = dist[v]` is finite for all `v` when there is no negative cycle. The triangle inequality `h[v] <= h[u] + w(u,v)` guarantees `w' >= 0`.

**Go.**
```go
package main

import "fmt"

const INF = int(1e18)

func reweight(n int, edges [][3]int) ([][3]int, bool) {
	V := n + 1
	src := n
	all := make([][3]int, 0, len(edges)+n)
	all = append(all, edges...)
	for v := 0; v < n; v++ {
		all = append(all, [3]int{src, v, 0})
	}
	h := make([]int, V)
	for i := range h {
		h[i] = INF
	}
	h[src] = 0
	for round := 0; round < V-1; round++ {
		for _, e := range all {
			if h[e[0]] != INF && h[e[0]]+e[2] < h[e[1]] {
				h[e[1]] = h[e[0]] + e[2]
			}
		}
	}
	for _, e := range all {
		if h[e[0]] != INF && h[e[0]]+e[2] < h[e[1]] {
			return nil, false // negative cycle
		}
	}
	out := make([][3]int, len(edges))
	for i, e := range edges {
		out[i] = [3]int{e[0], e[1], e[2] + h[e[0]] - h[e[1]]}
	}
	return out, true
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}}
	rw, ok := reweight(4, edges)
	fmt.Println(ok, rw) // all reweighted weights >= 0
}
```

**Java.**
```java
import java.util.*;

public class Task13 {
    static final long INF = Long.MAX_VALUE / 4;

    static int[][] reweight(int n, int[][] edges) {
        int V = n + 1, src = n;
        List<int[]> all = new ArrayList<>(Arrays.asList(edges));
        for (int v = 0; v < n; v++) all.add(new int[]{src, v, 0});
        long[] h = new long[V];
        Arrays.fill(h, INF);
        h[src] = 0;
        for (int round = 0; round < V - 1; round++)
            for (int[] e : all)
                if (h[e[0]] != INF && h[e[0]] + e[2] < h[e[1]])
                    h[e[1]] = h[e[0]] + e[2];
        for (int[] e : all)
            if (h[e[0]] != INF && h[e[0]] + e[2] < h[e[1]]) return null;
        int[][] out = new int[edges.length][3];
        for (int i = 0; i < edges.length; i++) {
            int[] e = edges[i];
            out[i] = new int[]{e[0], e[1], (int) (e[2] + h[e[0]] - h[e[1]])};
        }
        return out;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}};
        int[][] rw = reweight(4, edges);
        System.out.println(rw == null ? "neg cycle" : Arrays.deepToString(rw));
    }
}
```

**Python.**
```python
INF = float("inf")


def reweight(n, edges):
    src, V = n, n + 1
    all_edges = list(edges) + [(src, v, 0) for v in range(n)]
    h = [INF] * V
    h[src] = 0
    for _ in range(V - 1):
        for u, v, w in all_edges:
            if h[u] != INF and h[u] + w < h[v]:
                h[v] = h[u] + w
    for u, v, w in all_edges:
        if h[u] != INF and h[u] + w < h[v]:
            return None  # negative cycle
    return [(u, v, w + h[u] - h[v]) for u, v, w in edges]


if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 5), (1, 2, -2), (2, 3, 3)]
    print(reweight(4, edges))  # all weights >= 0
```

---

### Task 14 — Distributed Bellman-Ford with Split Horizon

**Problem.** Simulate distance-vector routing on a small network. Each node holds a distance vector and a next-hop table. Implement synchronous rounds where every node relaxes against its neighbors' vectors, applying **split horizon** (do not advertise a route back to the neighbor it was learned from). Report each node's final distance to a destination.

**Constraints.**
- `1 <= n <= 100` nodes, metric cap = 16 (RIP infinity).

**Hint.** Each round, build the vector each node advertises to each neighbor (omitting routes whose next hop is that neighbor), then have neighbors relax. Cap costs at 16. Iterate until no vector changes.

**Go.**
```go
package main

import "fmt"

const RIPINF = 16

type Node struct {
	id       int
	links    map[int]int // neighbor -> link cost
	dist     map[int]int // dest -> cost
	nextHop  map[int]int // dest -> neighbor
}

func newNode(id int) *Node {
	n := &Node{id: id, links: map[int]int{}, dist: map[int]int{}, nextHop: map[int]int{}}
	n.dist[id] = 0
	n.nextHop[id] = id
	return n
}

func (n *Node) advertiseTo(neighbor int) map[int]int {
	vec := map[int]int{}
	for dest, c := range n.dist {
		if n.nextHop[dest] == neighbor { // split horizon
			continue
		}
		vec[dest] = c
	}
	return vec
}

func (n *Node) relax(neighbor int, vec map[int]int) bool {
	changed := false
	lw := n.links[neighbor]
	for dest, c := range vec {
		cost := c + lw
		if cost > RIPINF {
			cost = RIPINF
		}
		cur, ok := n.dist[dest]
		if !ok {
			cur = RIPINF
		}
		if cost < cur {
			n.dist[dest] = cost
			n.nextHop[dest] = neighbor
			changed = true
		}
	}
	return changed
}

func main() {
	// line A(0) - B(1) - C(2)
	a, b, c := newNode(0), newNode(1), newNode(2)
	a.links = map[int]int{1: 1}
	b.links = map[int]int{0: 1, 2: 1}
	c.links = map[int]int{1: 1}
	nodes := map[int]*Node{0: a, 1: b, 2: c}
	adj := map[int][]int{0: {1}, 1: {0, 2}, 2: {1}}
	for iter := 0; iter < 10; iter++ {
		any := false
		for id, node := range nodes {
			for _, nb := range adj[id] {
				if nodes[nb].relax(id, node.advertiseTo(nb)) {
					any = true
				}
			}
		}
		if !any {
			break
		}
	}
	fmt.Println("C to A:", c.dist[0]) // 2
}
```

**Java.**
```java
import java.util.*;

public class Task14 {
    static final int RIPINF = 16;

    static class Node {
        int id;
        Map<Integer, Integer> links = new HashMap<>(), dist = new HashMap<>(), nextHop = new HashMap<>();
        Node(int id) { this.id = id; dist.put(id, 0); nextHop.put(id, id); }

        Map<Integer, Integer> advertiseTo(int neighbor) {
            Map<Integer, Integer> vec = new HashMap<>();
            for (var e : dist.entrySet())
                if (nextHop.get(e.getKey()) != neighbor) vec.put(e.getKey(), e.getValue());
            return vec;
        }

        boolean relax(int neighbor, Map<Integer, Integer> vec) {
            boolean changed = false;
            int lw = links.getOrDefault(neighbor, RIPINF);
            for (var e : vec.entrySet()) {
                int cost = Math.min(RIPINF, e.getValue() + lw);
                if (cost < dist.getOrDefault(e.getKey(), RIPINF)) {
                    dist.put(e.getKey(), cost);
                    nextHop.put(e.getKey(), neighbor);
                    changed = true;
                }
            }
            return changed;
        }
    }

    public static void main(String[] args) {
        Node a = new Node(0), b = new Node(1), c = new Node(2);
        a.links.put(1, 1);
        b.links.put(0, 1); b.links.put(2, 1);
        c.links.put(1, 1);
        Map<Integer, Node> nodes = Map.of(0, a, 1, b, 2, c);
        Map<Integer, int[]> adj = Map.of(0, new int[]{1}, 1, new int[]{0, 2}, 2, new int[]{1});
        for (int iter = 0; iter < 10; iter++) {
            boolean any = false;
            for (var entry : nodes.entrySet())
                for (int nb : adj.get(entry.getKey()))
                    if (nodes.get(nb).relax(entry.getKey(), entry.getValue().advertiseTo(nb))) any = true;
            if (!any) break;
        }
        System.out.println("C to A: " + c.dist.get(0)); // 2
    }
}
```

**Python.**
```python
RIPINF = 16


class Node:
    def __init__(self, nid):
        self.id = nid
        self.links = {}
        self.dist = {nid: 0}
        self.next_hop = {nid: nid}

    def advertise_to(self, neighbor):
        return {d: c for d, c in self.dist.items() if self.next_hop.get(d) != neighbor}

    def relax(self, neighbor, vec):
        changed = False
        lw = self.links.get(neighbor, RIPINF)
        for dest, c in vec.items():
            cost = min(RIPINF, c + lw)
            if cost < self.dist.get(dest, RIPINF):
                self.dist[dest] = cost
                self.next_hop[dest] = neighbor
                changed = True
        return changed


if __name__ == "__main__":
    a, b, c = Node(0), Node(1), Node(2)
    a.links = {1: 1}
    b.links = {0: 1, 2: 1}
    c.links = {1: 1}
    nodes = {0: a, 1: b, 2: c}
    adj = {0: [1], 1: [0, 2], 2: [1]}
    for _ in range(10):
        any_change = False
        for nid, node in nodes.items():
            for nb in adj[nid]:
                if nodes[nb].relax(nid, node.advertise_to(nb)):
                    any_change = True
        if not any_change:
            break
    print("C to A:", c.dist[0])  # 2
```

---

### Task 15 — Parallel Batch Bellman-Ford (Atomic Min)

**Problem.** Relax edges concurrently within each round using atomic compare-and-swap (or a language-appropriate equivalent). Verify the result matches the sequential version. Detect a negative cycle in a final sequential pass.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 10^6`, weights fit in 32-bit signed integers.

**Hint.** Within a round, edges are independent: read `dist[u]`, attempt `dist[v] = min(dist[v], dist[u] + w)` via a CAS loop. Reading a stale (larger) `dist[u]` is safe because relaxation is monotone. Barrier between rounds.

**Go.**
```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

const INF = int64(1) << 60

type Edge struct {
	From, To int
	W        int64
}

func parallelBF(n int, edges []Edge, src, workers int) ([]int64, bool) {
	dist := make([]int64, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	chunkSize := (len(edges) + workers - 1) / workers
	for round := 0; round < n-1; round++ {
		var changed int32
		var wg sync.WaitGroup
		for w := 0; w < workers; w++ {
			lo := w * chunkSize
			if lo >= len(edges) {
				break
			}
			hi := lo + chunkSize
			if hi > len(edges) {
				hi = len(edges)
			}
			wg.Add(1)
			go func(chunk []Edge) {
				defer wg.Done()
				for _, e := range chunk {
					du := atomic.LoadInt64(&dist[e.From])
					if du == INF {
						continue
					}
					nd := du + e.W
					for {
						old := atomic.LoadInt64(&dist[e.To])
						if nd >= old {
							break
						}
						if atomic.CompareAndSwapInt64(&dist[e.To], old, nd) {
							atomic.StoreInt32(&changed, 1)
							break
						}
					}
				}
			}(edges[lo:hi])
		}
		wg.Wait()
		if changed == 0 {
			break
		}
	}
	neg := false
	for _, e := range edges {
		if dist[e.From] != INF && dist[e.From]+e.W < dist[e.To] {
			neg = true
			break
		}
	}
	return dist, neg
}

func main() {
	edges := []Edge{{0, 1, 4}, {0, 2, 5}, {1, 2, -2}, {2, 3, 3}}
	dist, neg := parallelBF(4, edges, 0, 4)
	fmt.Println(dist, "neg:", neg) // [0 4 2 5] neg: false
}
```

**Java.**
```java
import java.util.concurrent.atomic.*;
import java.util.stream.IntStream;

public class Task15 {
    static final long INF = 1L << 60;
    record Edge(int from, int to, long w) {}

    static long[] parallelBF(int n, Edge[] edges, int src) {
        AtomicLongArray dist = new AtomicLongArray(n);
        for (int i = 0; i < n; i++) dist.set(i, INF);
        dist.set(src, 0);
        for (int round = 0; round < n - 1; round++) {
            AtomicBoolean changed = new AtomicBoolean(false);
            IntStream.range(0, edges.length).parallel().forEach(i -> {
                Edge e = edges[i];
                long du = dist.get(e.from());
                if (du == INF) return;
                long nd = du + e.w();
                long old;
                while (nd < (old = dist.get(e.to()))) {
                    if (dist.compareAndSet(e.to(), old, nd)) { changed.set(true); break; }
                }
            });
            if (!changed.get()) break;
        }
        long[] out = new long[n];
        for (int i = 0; i < n; i++) out[i] = dist.get(i);
        return out;
    }

    public static void main(String[] args) {
        Edge[] edges = {new Edge(0, 1, 4), new Edge(0, 2, 5), new Edge(1, 2, -2), new Edge(2, 3, 3)};
        System.out.println(java.util.Arrays.toString(parallelBF(4, edges, 0))); // [0, 4, 2, 5]
    }
}
```

**Python.**
```python
# Python's GIL makes true parallel CAS pointless; this models the algorithm
# with a snapshot-per-round, which is equivalent to a barrier between rounds.
INF = float("inf")


def parallel_bf(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        snap = dist[:]              # frozen reads = barrier; monotone, safe
        changed = False
        for u, v, w in edges:
            if snap[u] != INF and snap[u] + w < dist[v]:
                dist[v] = min(dist[v], snap[u] + w)
                changed = True
        if not changed:
            break
    neg = any(dist[u] != INF and dist[u] + w < dist[v] for u, v, w in edges)
    return dist, neg


if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 5), (1, 2, -2), (2, 3, 3)]
    print(parallel_bf(4, edges, 0))  # ([0, 4, 2, 5], False)
```

---

## Benchmark Task

### Task 16 — Naive Bellman-Ford vs SPFA vs Yen's on Random and Adversarial Graphs

**Problem.** Build three implementations — naive Bellman-Ford with early termination, SPFA, and Yen's forward/backward sweep — and benchmark them on (a) sparse random graphs and (b) an adversarial "zigzag" graph designed to force SPFA to its `O(VE)` worst case. Report wall-clock time and relaxation counts for each. The goal is to **observe** that SPFA wins on random graphs but collapses on the adversarial one, while Yen's stays deterministic.

**Constraints.**
- Random: `V = 2000`, `E = 8000`, weights in `[-5, 20]`, no negative cycle.
- Adversarial: a layered chain where each layer's distance is repeatedly lowered, forcing many re-enqueues in SPFA.

**Hint.** Count relaxations (the number of times `dist[v]` is actually lowered) as the implementation-independent work metric. Expect SPFA's relaxation count to explode on the adversarial graph while naive and Yen's stay bounded by `~V·E`.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

const INF = int(1e18)

type Edge struct{ From, To, W int }

func naiveBF(n int, edges []Edge, src int) (int, time.Duration) {
	start := time.Now()
	dist := make([]int, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	relax := 0
	for round := 0; round < n-1; round++ {
		changed := false
		for _, e := range edges {
			if dist[e.From] != INF && dist[e.From]+e.W < dist[e.To] {
				dist[e.To] = dist[e.From] + e.W
				relax++
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	return relax, time.Since(start)
}

func spfa(n int, adj [][]Edge, src int) (int, time.Duration) {
	start := time.Now()
	dist := make([]int, n)
	inQ := make([]bool, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[src] = 0
	queue := []int{src}
	inQ[src] = true
	relax := 0
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		inQ[u] = false
		for _, e := range adj[u] {
			if dist[u]+e.W < dist[e.To] {
				dist[e.To] = dist[u] + e.W
				relax++
				if !inQ[e.To] {
					queue = append(queue, e.To)
					inQ[e.To] = true
				}
			}
		}
	}
	return relax, time.Since(start)
}

func randomGraph(n, m int) ([]Edge, [][]Edge) {
	edges := make([]Edge, m)
	adj := make([][]Edge, n)
	for i := 0; i < m; i++ {
		u, v := rand.Intn(n), rand.Intn(n)
		w := rand.Intn(26) - 5
		edges[i] = Edge{u, v, w}
		adj[u] = append(adj[u], Edge{u, v, w})
	}
	return edges, adj
}

func main() {
	rand.Seed(1)
	n, m := 2000, 8000
	edges, adj := randomGraph(n, m)
	r1, t1 := naiveBF(n, edges, 0)
	r2, t2 := spfa(n, adj, 0)
	fmt.Printf("naive: %d relaxations in %v\n", r1, t1)
	fmt.Printf("spfa:  %d relaxations in %v\n", r2, t2)
}
```

**Java.**
```java
import java.util.*;

public class Task16 {
    static final long INF = Long.MAX_VALUE / 4;
    record Edge(int from, int to, long w) {}

    static long naiveBF(int n, Edge[] edges, int src) {
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        long relax = 0;
        for (int round = 0; round < n - 1; round++) {
            boolean changed = false;
            for (Edge e : edges)
                if (dist[e.from()] != INF && dist[e.from()] + e.w() < dist[e.to()]) {
                    dist[e.to()] = dist[e.from()] + e.w(); relax++; changed = true;
                }
            if (!changed) break;
        }
        return relax;
    }

    static long spfa(int n, List<Edge>[] adj, int src) {
        long[] dist = new long[n];
        boolean[] inQ = new boolean[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        Deque<Integer> q = new ArrayDeque<>();
        q.add(src); inQ[src] = true;
        long relax = 0;
        while (!q.isEmpty()) {
            int u = q.poll(); inQ[u] = false;
            for (Edge e : adj[u])
                if (dist[u] + e.w() < dist[e.to()]) {
                    dist[e.to()] = dist[u] + e.w(); relax++;
                    if (!inQ[e.to()]) { q.add(e.to()); inQ[e.to()] = true; }
                }
        }
        return relax;
    }

    public static void main(String[] args) {
        int n = 2000, m = 8000;
        Random rnd = new Random(1);
        Edge[] edges = new Edge[m];
        List<Edge>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            int u = rnd.nextInt(n), v = rnd.nextInt(n), w = rnd.nextInt(26) - 5;
            edges[i] = new Edge(u, v, w);
            adj[u].add(new Edge(u, v, w));
        }
        long t1 = System.nanoTime(); long r1 = naiveBF(n, edges, 0); t1 = System.nanoTime() - t1;
        long t2 = System.nanoTime(); long r2 = spfa(n, adj, 0); t2 = System.nanoTime() - t2;
        System.out.printf("naive: %d relaxations in %.1f ms%n", r1, t1 / 1e6);
        System.out.printf("spfa:  %d relaxations in %.1f ms%n", r2, t2 / 1e6);
    }
}
```

**Python.**
```python
import random
import time
from collections import deque

INF = float("inf")


def naive_bf(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    relax = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                relax += 1
                changed = True
        if not changed:
            break
    return relax


def spfa(n, adj, src):
    dist = [INF] * n
    in_q = [False] * n
    dist[src] = 0
    q = deque([src])
    in_q[src] = True
    relax = 0
    while q:
        u = q.popleft()
        in_q[u] = False
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                relax += 1
                if not in_q[v]:
                    q.append(v)
                    in_q[v] = True
    return relax


if __name__ == "__main__":
    random.seed(1)
    n, m = 2000, 8000
    edges = [(random.randrange(n), random.randrange(n), random.randint(-5, 20))
             for _ in range(m)]
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))

    t = time.time(); r1 = naive_bf(n, edges, 0)
    print(f"naive: {r1} relaxations in {(time.time()-t)*1000:.1f} ms")
    t = time.time(); r2 = spfa(n, adj, 0)
    print(f"spfa:  {r2} relaxations in {(time.time()-t)*1000:.1f} ms")
```

**What to observe.** On the random sparse graph, SPFA performs far fewer relaxations and finishes faster than naive Bellman-Ford because early termination plus the active-vertex queue both help. Construct an adversarial zigzag (a chain of vertices whose distances are repeatedly lowered by a back edge) and you will see SPFA's relaxation count climb toward `V·E` while naive Bellman-Ford with early termination and Yen's halving stay deterministic. This is the concrete demonstration of why SPFA is a heuristic, not an asymptotic improvement — the lesson driven home throughout the senior and professional material.
