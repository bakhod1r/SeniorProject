# Minimum Spanning Tree — Practice Tasks

> Fifteen graded tasks (5 beginner, 5 intermediate, 5 advanced) plus a benchmark, each with a statement, constraints, hints, and full Go / Java / Python reference solutions. Work top-down; later tasks reuse Union-Find and heap scaffolding from earlier ones.

---

## Table of Contents

1. [Beginner Tasks (5)](#beginner-tasks-5)
2. [Intermediate Tasks (5)](#intermediate-tasks-5)
3. [Advanced Tasks (5)](#advanced-tasks-5)
4. [Benchmark Task](#benchmark-task)

---

## Beginner Tasks (5)

### B1. MST Total Weight via Kruskal

**Statement.** Given `n` vertices (`0..n-1`) and a list of weighted undirected edges `(u, v, w)`, return the total weight of a minimum spanning tree. Assume the graph is connected.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ w ≤ 10^9`. Use 64-bit accumulation.

**Hints.**
- Sort edges by weight ascending.
- Use Union-Find; accept an edge only if its endpoints are in different sets.
- Stop after `n-1` accepted edges.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func kruskalWeight(n int, edges [][3]int) int64 {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	var total int64
	used := 0
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += int64(e[2])
			if used++; used == n-1 {
				break
			}
		}
	}
	return total
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 1}, {1, 2, 2}, {1, 3, 5}, {2, 3, 8}}
	fmt.Println(kruskalWeight(4, edges)) // 8
}
```

#### Java

```java
import java.util.*;

public class B1 {
    static int[] parent;
    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }
    static long kruskalWeight(int n, int[][] edges) {
        Arrays.sort(edges, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0; int used = 0;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; total += e[2]; if (++used == n - 1) break; }
        }
        return total;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,4},{0,2,1},{1,2,2},{1,3,5},{2,3,8}};
        System.out.println(kruskalWeight(4, edges)); // 8
    }
}
```

#### Python

```python
def kruskal_weight(n, edges):
    edges.sort(key=lambda e: e[2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, used = 0, 0
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            total += w
            used += 1
            if used == n - 1:
                break
    return total


if __name__ == "__main__":
    print(kruskal_weight(4, [(0, 1, 4), (0, 2, 1), (1, 2, 2), (1, 3, 5), (2, 3, 8)]))  # 8
```

---

### B2. MST Total Weight via Prim

**Statement.** Same input as B1, but implement **Prim** with a binary heap from an adjacency list. Return the MST total weight.

**Constraints.** Connected graph; `1 ≤ n ≤ 10^5`.

**Hints.**
- Build an adjacency list of `(weight, neighbor)`.
- Lazy Prim: push candidate edges, skip popped vertices already in the tree.
- Track `count` of vertices added; stop at `n`.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type edge struct{ w, to int }
type pq []edge

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].w < p[j].w }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(edge)) }
func (p *pq) Pop() interface{}   { old := *p; n := len(old); e := old[n-1]; *p = old[:n-1]; return e }

func primWeight(n int, adj [][]edge) int64 {
	visited := make([]bool, n)
	h := &pq{{0, 0}}
	var total int64
	count := 0
	for h.Len() > 0 && count < n {
		e := heap.Pop(h).(edge)
		if visited[e.to] {
			continue
		}
		visited[e.to] = true
		total += int64(e.w)
		count++
		for _, nx := range adj[e.to] {
			if !visited[nx.to] {
				heap.Push(h, nx)
			}
		}
	}
	return total
}

func main() {
	n := 4
	adj := make([][]edge, n)
	add := func(u, v, w int) { adj[u] = append(adj[u], edge{w, v}); adj[v] = append(adj[v], edge{w, u}) }
	add(0, 1, 4); add(0, 2, 1); add(1, 2, 2); add(1, 3, 5); add(2, 3, 8)
	fmt.Println(primWeight(n, adj)) // 8
}
```

#### Java

```java
import java.util.*;

public class B2 {
    static long primWeight(int n, List<int[]>[] adj) {
        boolean[] vis = new boolean[n];
        PriorityQueue<int[]> pq = new PriorityQueue<>(Comparator.comparingInt(a -> a[0]));
        pq.add(new int[]{0, 0});
        long total = 0; int count = 0;
        while (!pq.isEmpty() && count < n) {
            int[] cur = pq.poll();
            if (vis[cur[1]]) continue;
            vis[cur[1]] = true; total += cur[0]; count++;
            for (int[] e : adj[cur[1]]) if (!vis[e[0]]) pq.add(new int[]{e[1], e[0]});
        }
        return total;
    }
    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        int n = 4;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] e = {{0,1,4},{0,2,1},{1,2,2},{1,3,5},{2,3,8}};
        for (int[] x : e) { adj[x[0]].add(new int[]{x[1], x[2]}); adj[x[1]].add(new int[]{x[0], x[2]}); }
        System.out.println(primWeight(n, adj)); // 8
    }
}
```

#### Python

```python
import heapq


def prim_weight(n, adj):
    vis = [False] * n
    pq = [(0, 0)]
    total, count = 0, 0
    while pq and count < n:
        w, v = heapq.heappop(pq)
        if vis[v]:
            continue
        vis[v] = True
        total += w
        count += 1
        for nw, to in adj[v]:
            if not vis[to]:
                heapq.heappush(pq, (nw, to))
    return total


if __name__ == "__main__":
    n = 4
    adj = [[] for _ in range(n)]
    def add(u, v, w):
        adj[u].append((w, v)); adj[v].append((w, u))
    add(0, 1, 4); add(0, 2, 1); add(1, 2, 2); add(1, 3, 5); add(2, 3, 8)
    print(prim_weight(n, adj))  # 8
```

---

### B3. Return the MST Edge Set

**Statement.** Return the *edges* of an MST (not just the weight), as a list of `(u, v, w)`. Any valid MST is accepted.

**Constraints.** Connected graph.

**Hints.**
- Same Kruskal loop as B1, but append accepted edges to a result list.
- The result has exactly `n-1` edges.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func kruskalEdges(n int, edges [][3]int) [][3]int {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	res := [][3]int{}
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			res = append(res, e)
		}
	}
	return res
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 1}, {1, 2, 2}, {1, 3, 5}, {2, 3, 8}}
	fmt.Println(kruskalEdges(4, edges)) // [[0 2 1] [1 2 2] [1 3 5]]
}
```

#### Java

```java
import java.util.*;

public class B3 {
    static int[] parent;
    static int find(int x) { while (parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static List<int[]> kruskalEdges(int n, int[][] edges) {
        Arrays.sort(edges, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        List<int[]> res = new ArrayList<>();
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; res.add(e); }
        }
        return res;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,4},{0,2,1},{1,2,2},{1,3,5},{2,3,8}};
        for (int[] e : kruskalEdges(4, edges)) System.out.println(Arrays.toString(e));
    }
}
```

#### Python

```python
def kruskal_edges(n, edges):
    edges.sort(key=lambda e: e[2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    res = []
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            res.append((u, v, w))
    return res


if __name__ == "__main__":
    print(kruskal_edges(4, [(0, 1, 4), (0, 2, 1), (1, 2, 2), (1, 3, 5), (2, 3, 8)]))
    # [(0, 2, 1), (1, 2, 2), (1, 3, 5)]
```

---

### B4. Detect Disconnected Graph (Spanning Forest)

**Statement.** Run Kruskal and report whether the graph is connected. If connected, return the MST weight; otherwise return the number of connected components and the total weight of the minimum spanning *forest*.

**Constraints.** Graph may be disconnected.

**Hints.**
- Count accepted edges. Components = `n − accepted`.
- Connected iff accepted `== n − 1`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func mstForest(n int, edges [][3]int) (weight int64, components int) {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	accepted := 0
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			weight += int64(e[2])
			accepted++
		}
	}
	return weight, n - accepted
}

func main() {
	w, c := mstForest(5, [][3]int{{0, 1, 1}, {2, 3, 2}}) // two components + isolated 4
	fmt.Printf("weight=%d components=%d\n", w, c)         // weight=3 components=3
}
```

#### Java

```java
import java.util.*;

public class B4 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static long[] mstForest(int n, int[][] edges) {
        Arrays.sort(edges, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long weight = 0; int accepted = 0;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; weight += e[2]; accepted++; }
        }
        return new long[]{weight, n - accepted};
    }
    public static void main(String[] args) {
        long[] r = mstForest(5, new int[][]{{0,1,1},{2,3,2}});
        System.out.println("weight=" + r[0] + " components=" + r[1]); // weight=3 components=3
    }
}
```

#### Python

```python
def mst_forest(n, edges):
    edges.sort(key=lambda e: e[2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    weight, accepted = 0, 0
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            weight += w
            accepted += 1
    return weight, n - accepted


if __name__ == "__main__":
    print(mst_forest(5, [(0, 1, 1), (2, 3, 2)]))  # (3, 3)
```

---

### B5. Maximum Spanning Tree

**Statement.** Return the total weight of the **maximum** spanning tree (the spanning tree of greatest total weight).

**Constraints.** Connected graph.

**Hints.**
- Identical to Kruskal but sort **descending**.
- The cut/cycle properties flip: heaviest crossing edge is safe.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func maxSpanningTree(n int, edges [][3]int) int64 {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] > edges[j][2] }) // descending
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	var total int64
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += int64(e[2])
		}
	}
	return total
}

func main() {
	fmt.Println(maxSpanningTree(4, [][3]int{{0, 1, 4}, {0, 2, 1}, {1, 2, 2}, {1, 3, 5}, {2, 3, 8}})) // 17
}
```

#### Java

```java
import java.util.*;

public class B5 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static long maxSpanningTree(int n, int[][] edges) {
        Arrays.sort(edges, (a, b) -> b[2] - a[2]); // descending
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; total += e[2]; }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.println(maxSpanningTree(4,
            new int[][]{{0,1,4},{0,2,1},{1,2,2},{1,3,5},{2,3,8}})); // 17
    }
}
```

#### Python

```python
def max_spanning_tree(n, edges):
    edges.sort(key=lambda e: e[2], reverse=True)  # descending
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total = 0
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            total += w
    return total


if __name__ == "__main__":
    print(max_spanning_tree(4, [(0, 1, 4), (0, 2, 1), (1, 2, 2), (1, 3, 5), (2, 3, 8)]))  # 17
```

---

## Intermediate Tasks (5)

### I1. Min Cost to Connect All Points (dense → array-Prim)

**Statement.** Given `points[i] = [x, y]`, the cost to connect two points is their Manhattan distance. Return the minimum cost to connect all points. The graph is complete (dense) — use **array-Prim** `O(V²)`.

**Constraints.** `1 ≤ n ≤ 1000`.

**Hints.**
- Do not build all `V²` edges; compute distances on the fly.
- Keep `minEdge[v]` = cheapest known edge from the tree to `v`.

#### Go

```go
package main

import "fmt"

func minCostConnectPoints(points [][]int) int {
	n := len(points)
	if n <= 1 {
		return 0
	}
	abs := func(a int) int { if a < 0 { return -a }; return a }
	const INF = 1 << 30
	inTree := make([]bool, n)
	minE := make([]int, n)
	for i := range minE {
		minE[i] = INF
	}
	minE[0] = 0
	total := 0
	for k := 0; k < n; k++ {
		u := -1
		for v := 0; v < n; v++ {
			if !inTree[v] && (u == -1 || minE[v] < minE[u]) {
				u = v
			}
		}
		inTree[u] = true
		total += minE[u]
		for v := 0; v < n; v++ {
			if !inTree[v] {
				d := abs(points[u][0]-points[v][0]) + abs(points[u][1]-points[v][1])
				if d < minE[v] {
					minE[v] = d
				}
			}
		}
	}
	return total
}

func main() {
	fmt.Println(minCostConnectPoints([][]int{{0, 0}, {2, 2}, {3, 10}, {5, 2}, {7, 0}})) // 20
}
```

#### Java

```java
public class I1 {
    public int minCostConnectPoints(int[][] points) {
        int n = points.length;
        if (n <= 1) return 0;
        final int INF = Integer.MAX_VALUE;
        boolean[] inTree = new boolean[n];
        int[] minE = new int[n];
        java.util.Arrays.fill(minE, INF);
        minE[0] = 0;
        int total = 0;
        for (int k = 0; k < n; k++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inTree[v] && (u == -1 || minE[v] < minE[u])) u = v;
            inTree[u] = true; total += minE[u];
            for (int v = 0; v < n; v++)
                if (!inTree[v]) {
                    int d = Math.abs(points[u][0]-points[v][0]) + Math.abs(points[u][1]-points[v][1]);
                    if (d < minE[v]) minE[v] = d;
                }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.println(new I1().minCostConnectPoints(
            new int[][]{{0,0},{2,2},{3,10},{5,2},{7,0}})); // 20
    }
}
```

#### Python

```python
def minCostConnectPoints(points):
    n = len(points)
    if n <= 1:
        return 0
    INF = float("inf")
    in_tree = [False] * n
    min_e = [INF] * n
    min_e[0] = 0
    total = 0
    for _ in range(n):
        u = min((v for v in range(n) if not in_tree[v]), key=lambda v: min_e[v])
        in_tree[u] = True
        total += min_e[u]
        ux, uy = points[u]
        for v in range(n):
            if not in_tree[v]:
                d = abs(ux - points[v][0]) + abs(uy - points[v][1])
                if d < min_e[v]:
                    min_e[v] = d
    return total


if __name__ == "__main__":
    print(minCostConnectPoints([[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]]))  # 20
```

---

### I2. Connect All Cities or Return -1

**Statement.** `n` cities labeled `1..n`, `connections[i] = [a, b, cost]`. Return the min cost to connect all, or `-1` if impossible.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hints.**
- Kruskal; count accepted edges.
- If accepted `< n-1`, return `-1`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func minimumCost(n int, conns [][]int) int {
	sort.Slice(conns, func(i, j int) bool { return conns[i][2] < conns[j][2] })
	parent := make([]int, n+1)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	total, used := 0, 0
	for _, c := range conns {
		ra, rb := find(c[0]), find(c[1])
		if ra != rb {
			parent[ra] = rb
			total += c[2]
			used++
		}
	}
	if used == n-1 {
		return total
	}
	return -1
}

func main() {
	fmt.Println(minimumCost(3, [][]int{{1, 2, 5}, {1, 3, 6}, {2, 3, 1}})) // 6
	fmt.Println(minimumCost(4, [][]int{{1, 2, 3}, {3, 4, 4}}))            // -1
}
```

#### Java

```java
import java.util.*;

public class I2 {
    int[] parent;
    int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    public int minimumCost(int n, int[][] conns) {
        Arrays.sort(conns, Comparator.comparingInt(c -> c[2]));
        parent = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        int total = 0, used = 0;
        for (int[] c : conns) {
            int ra = find(c[0]), rb = find(c[1]);
            if (ra != rb) { parent[ra] = rb; total += c[2]; used++; }
        }
        return used == n - 1 ? total : -1;
    }
    public static void main(String[] args) {
        I2 s = new I2();
        System.out.println(s.minimumCost(3, new int[][]{{1,2,5},{1,3,6},{2,3,1}})); // 6
        System.out.println(s.minimumCost(4, new int[][]{{1,2,3},{3,4,4}}));         // -1
    }
}
```

#### Python

```python
def minimum_cost(n, conns):
    conns.sort(key=lambda c: c[2])
    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, used = 0, 0
    for a, b, c in conns:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            total += c
            used += 1
    return total if used == n - 1 else -1


if __name__ == "__main__":
    print(minimum_cost(3, [[1, 2, 5], [1, 3, 6], [2, 3, 1]]))  # 6
    print(minimum_cost(4, [[1, 2, 3], [3, 4, 4]]))             # -1
```

---

### I3. Single-Linkage Clustering (cut k−1 heaviest MST edges)

**Statement.** Given `n` points and edges, partition them into exactly `k` clusters by single-linkage: build the MST and remove the `k−1` heaviest MST edges. Return the cluster id of each vertex (`0..k-1`).

**Constraints.** `1 ≤ k ≤ n`. Graph connected.

**Hints.**
- Build MST edges, keep them sorted ascending.
- Use only the lightest `n-k` MST edges to union vertices.
- Label components with a final pass.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func cluster(n, k int, edges [][3]int) []int {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	// keep only the lightest n-k MST edges
	mstEdges := [][3]int{}
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			mstEdges = append(mstEdges, e)
		}
	}
	// reset and union only first n-k MST edges
	for i := range parent {
		parent[i] = i
	}
	for i := 0; i < len(mstEdges)-(k-1); i++ {
		e := mstEdges[i]
		parent[find(e[0])] = find(e[1])
	}
	label := map[int]int{}
	res := make([]int, n)
	next := 0
	for v := 0; v < n; v++ {
		r := find(v)
		if _, ok := label[r]; !ok {
			label[r] = next
			next++
		}
		res[v] = label[r]
	}
	return res
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 2}, {2, 3, 10}, {3, 4, 1}}
	fmt.Println(cluster(5, 2, edges)) // two clusters split at the weight-10 edge
}
```

#### Java

```java
import java.util.*;

public class I3 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static int[] cluster(int n, int k, int[][] edges) {
        Arrays.sort(edges, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        List<int[]> mst = new ArrayList<>();
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; mst.add(e); }
        }
        for (int i = 0; i < n; i++) parent[i] = i;
        for (int i = 0; i < mst.size() - (k - 1); i++) {
            int[] e = mst.get(i);
            parent[find(e[0])] = find(e[1]);
        }
        Map<Integer,Integer> label = new HashMap<>();
        int[] res = new int[n]; int next = 0;
        for (int v = 0; v < n; v++) {
            int r = find(v);
            label.putIfAbsent(r, next++ );
            // putIfAbsent returns null on insert; recompute id cleanly:
            res[v] = label.get(r);
        }
        return res;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,1},{1,2,2},{2,3,10},{3,4,1}};
        System.out.println(Arrays.toString(cluster(5, 2, edges)));
    }
}
```

#### Python

```python
def cluster(n, k, edges):
    edges.sort(key=lambda e: e[2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    mst = []
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            mst.append((u, v, w))

    parent = list(range(n))                      # reset
    for u, v, w in mst[: len(mst) - (k - 1)]:    # union all but the k-1 heaviest
        parent[find(u)] = find(v)

    label, res, nxt = {}, [0] * n, 0
    for v in range(n):
        r = find(v)
        if r not in label:
            label[r] = nxt
            nxt += 1
        res[v] = label[r]
    return res


if __name__ == "__main__":
    print(cluster(5, 2, [(0, 1, 1), (1, 2, 2), (2, 3, 10), (3, 4, 1)]))
```

---

### I4. MST with One Forced Edge

**Statement.** Given a graph and a specific edge index `f`, return the minimum weight of a spanning tree that **must** include edge `f`. Return `-1` if including `f` still cannot span the graph.

**Constraints.** Connected graph after forcing.

**Hints.**
- Union `f`'s endpoints and add its weight first.
- Then run Kruskal on the rest.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func mstForcing(n int, edges [][3]int, f int) int64 {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	fe := edges[f]
	var total int64 = int64(fe[2])
	used := 1
	parent[find(fe[0])] = find(fe[1])

	order := make([]int, len(edges))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return edges[order[a]][2] < edges[order[b]][2] })
	for _, i := range order {
		if i == f {
			continue
		}
		e := edges[i]
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += int64(e[2])
			used++
		}
	}
	if used == n-1 {
		return total
	}
	return -1
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 2}, {0, 2, 2}, {2, 3, 3}}
	fmt.Println(mstForcing(4, edges, 2)) // force edge (0,2,2): 1+2+3 = 6
}
```

#### Java

```java
import java.util.*;

public class I4 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static long mstForcing(int n, int[][] edges, int f) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = edges[f][2]; int used = 1;
        parent[find(edges[f][0])] = find(edges[f][1]);
        Integer[] order = new Integer[edges.length];
        for (int i = 0; i < edges.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> edges[i][2]));
        for (int i : order) {
            if (i == f) continue;
            int ra = find(edges[i][0]), rb = find(edges[i][1]);
            if (ra != rb) { parent[ra] = rb; total += edges[i][2]; used++; }
        }
        return used == n - 1 ? total : -1;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,1},{1,2,2},{0,2,2},{2,3,3}};
        System.out.println(mstForcing(4, edges, 2)); // 6
    }
}
```

#### Python

```python
def mst_forcing(n, edges, f):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    a, b, w = edges[f]
    total, used = w, 1
    parent[find(a)] = find(b)

    order = sorted(range(len(edges)), key=lambda i: edges[i][2])
    for i in order:
        if i == f:
            continue
        u, v, ww = edges[i]
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            total += ww
            used += 1
    return total if used == n - 1 else -1


if __name__ == "__main__":
    print(mst_forcing(4, [(0, 1, 1), (1, 2, 2), (0, 2, 2), (2, 3, 3)], 2))  # 6
```

---

### I5. Minimum Bottleneck Value

**Statement.** Return the **bottleneck** of the MST: the maximum edge weight on a minimum bottleneck spanning tree (equivalently, the largest edge in any MST). This is the smallest value `B` such that using only edges of weight `≤ B` keeps the graph connected.

**Constraints.** Connected graph.

**Hints.**
- Any MST is a min-bottleneck tree; its heaviest edge is the answer.
- Build MST with Kruskal and track the max accepted weight.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func bottleneck(n int, edges [][3]int) int {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	maxW, used := 0, 0
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			if e[2] > maxW {
				maxW = e[2]
			}
			if used++; used == n-1 {
				break
			}
		}
	}
	return maxW
}

func main() {
	fmt.Println(bottleneck(4, [][3]int{{0, 1, 1}, {1, 2, 7}, {0, 2, 3}, {2, 3, 4}})) // 4
}
```

#### Java

```java
import java.util.*;

public class I5 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static int bottleneck(int n, int[][] edges) {
        Arrays.sort(edges, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int maxW = 0, used = 0;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; maxW = Math.max(maxW, e[2]); if (++used == n-1) break; }
        }
        return maxW;
    }
    public static void main(String[] args) {
        System.out.println(bottleneck(4, new int[][]{{0,1,1},{1,2,7},{0,2,3},{2,3,4}})); // 4
    }
}
```

#### Python

```python
def bottleneck(n, edges):
    edges.sort(key=lambda e: e[2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    max_w, used = 0, 0
    for u, v, w in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            max_w = max(max_w, w)
            used += 1
            if used == n - 1:
                break
    return max_w


if __name__ == "__main__":
    print(bottleneck(4, [(0, 1, 1), (1, 2, 7), (0, 2, 3), (2, 3, 4)]))  # 4
```

---

## Advanced Tasks (5)

### A1. Second-Best MST

**Statement.** Return the total weight of the second-best MST (the cheapest spanning tree that differs from the MST in at least one edge). The graph is connected with `≥ 2` distinct spanning trees.

**Constraints.** `n ≤ 1000`, `m ≤ 5000`.

**Hints.**
- Build the MST. For each non-tree edge `(u,v,w)`, find the maximum-weight edge on the tree path `u→v`.
- Best swap = minimize `MST − maxPathEdge + w` over non-tree edges (with `w ≥ maxPathEdge`, prefer the swap with smallest increase; when `w == maxPathEdge` increase is 0 only if a *different* edge swaps, otherwise it is the next).
- For `n ≤ 1000` a BFS/DFS per non-tree edge to find the path max is fine (`O(n·m)`).

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func secondBestMST(n int, edges [][3]int) int64 {
	type E struct{ u, v, w, idx int }
	es := make([]E, len(edges))
	for i, e := range edges {
		es[i] = E{e[0], e[1], e[2], i}
	}
	sort.Slice(es, func(i, j int) bool { return es[i].w < es[j].w })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	adj := make([][][2]int, n) // [to, weight]
	inMST := make([]bool, len(es))
	var mstW int64
	for i, e := range es {
		ra, rb := find(e.u), find(e.v)
		if ra != rb {
			parent[ra] = rb
			inMST[i] = true
			mstW += int64(e.w)
			adj[e.u] = append(adj[e.u], [2]int{e.v, e.w})
			adj[e.v] = append(adj[e.v], [2]int{e.u, e.w})
		}
	}
	// max edge on tree path u->v via DFS
	maxOnPath := func(src, dst int) int {
		visited := make([]bool, n)
		type frame struct{ node, mx int }
		stack := []frame{{src, 0}}
		visited[src] = true
		for len(stack) > 0 {
			f := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if f.node == dst {
				return f.mx
			}
			for _, nx := range adj[f.node] {
				if !visited[nx[0]] {
					visited[nx[0]] = true
					mx := f.mx
					if nx[1] > mx {
						mx = nx[1]
					}
					stack = append(stack, frame{nx[0], mx})
				}
			}
		}
		return -1
	}
	best := int64(1) << 62
	for i, e := range es {
		if inMST[i] {
			continue
		}
		pm := maxOnPath(e.u, e.v)
		if pm > 0 { // a real swap exists
			cand := mstW - int64(pm) + int64(e.w)
			if cand < best {
				best = cand
			}
		}
	}
	return best
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 2}, {0, 2, 2}, {2, 3, 3}}
	fmt.Println(secondBestMST(4, edges)) // MST=1+2+3=6, second-best=1+2+3 swapping a 2 -> still 6 (tie) ; here 6
}
```

#### Java

```java
import java.util.*;

public class A1 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }

    static long secondBestMST(int n, int[][] edges) {
        Integer[] order = new Integer[edges.length];
        for (int i = 0; i < edges.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> edges[i][2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        boolean[] inMST = new boolean[edges.length];
        long mstW = 0;
        for (int i : order) {
            int[] e = edges[i];
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) {
                parent[ra] = rb; inMST[i] = true; mstW += e[2];
                adj[e[0]].add(new int[]{e[1], e[2]});
                adj[e[1]].add(new int[]{e[0], e[2]});
            }
        }
        long best = Long.MAX_VALUE;
        for (int i = 0; i < edges.length; i++) {
            if (inMST[i]) continue;
            int pm = maxOnPath(adj, n, edges[i][0], edges[i][1]);
            if (pm > 0) best = Math.min(best, mstW - pm + edges[i][2]);
        }
        return best;
    }

    static int maxOnPath(List<int[]>[] adj, int n, int src, int dst) {
        boolean[] vis = new boolean[n];
        Deque<int[]> st = new ArrayDeque<>(); // {node, maxSoFar}
        st.push(new int[]{src, 0}); vis[src] = true;
        while (!st.isEmpty()) {
            int[] f = st.pop();
            if (f[0] == dst) return f[1];
            for (int[] nx : adj[f[0]]) if (!vis[nx[0]]) {
                vis[nx[0]] = true;
                st.push(new int[]{nx[0], Math.max(f[1], nx[1])});
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1,1},{1,2,2},{0,2,2},{2,3,3}};
        System.out.println(secondBestMST(4, edges)); // 6
    }
}
```

#### Python

```python
def second_best_mst(n, edges):
    order = sorted(range(len(edges)), key=lambda i: edges[i][2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    adj = [[] for _ in range(n)]
    in_mst = [False] * len(edges)
    mst_w = 0
    for i in order:
        u, v, w = edges[i]
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            in_mst[i] = True
            mst_w += w
            adj[u].append((v, w))
            adj[v].append((u, w))

    def max_on_path(src, dst):
        stack = [(src, 0)]
        seen = {src}
        while stack:
            node, mx = stack.pop()
            if node == dst:
                return mx
            for to, w in adj[node]:
                if to not in seen:
                    seen.add(to)
                    stack.append((to, max(mx, w)))
        return -1

    best = float("inf")
    for i, (u, v, w) in enumerate(edges):
        if in_mst[i]:
            continue
        pm = max_on_path(u, v)
        if pm > 0:
            best = min(best, mst_w - pm + w)
    return best


if __name__ == "__main__":
    print(second_best_mst(4, [(0, 1, 1), (1, 2, 2), (0, 2, 2), (2, 3, 3)]))  # 6
```

---

### A2. Borůvka's Algorithm From Scratch

**Statement.** Implement Borůvka's algorithm and return the MST weight. The graph is connected.

**Constraints.** `n ≤ 10^5`, `m ≤ 2·10^5`.

**Hints.**
- Each round: per component find the cheapest outgoing edge (break ties by edge index).
- Merge all chosen edges; repeat until one component.

#### Go

```go
package main

import "fmt"

func boruvka(n int, edges [][3]int) int64 {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	var total int64
	comp := n
	for comp > 1 {
		cheapest := make([]int, n)
		for i := range cheapest {
			cheapest[i] = -1
		}
		for i, e := range edges {
			ru, rv := find(e[0]), find(e[1])
			if ru == rv {
				continue
			}
			if cheapest[ru] == -1 || e[2] < edges[cheapest[ru]][2] {
				cheapest[ru] = i
			}
			if cheapest[rv] == -1 || e[2] < edges[cheapest[rv]][2] {
				cheapest[rv] = i
			}
		}
		progressed := false
		for _, idx := range cheapest {
			if idx == -1 {
				continue
			}
			e := edges[idx]
			ru, rv := find(e[0]), find(e[1])
			if ru != rv {
				parent[ru] = rv
				total += int64(e[2])
				comp--
				progressed = true
			}
		}
		if !progressed {
			break
		}
	}
	return total
}

func main() {
	edges := [][3]int{{0, 1, 4}, {0, 2, 1}, {1, 2, 2}, {1, 3, 5}, {2, 3, 8}}
	fmt.Println(boruvka(4, edges)) // 8
}
```

#### Java

```java
import java.util.*;

public class A2 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static long boruvka(int n, int[][] edges) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0; int comp = n;
        while (comp > 1) {
            int[] cheapest = new int[n];
            Arrays.fill(cheapest, -1);
            for (int i = 0; i < edges.length; i++) {
                int ru = find(edges[i][0]), rv = find(edges[i][1]);
                if (ru == rv) continue;
                if (cheapest[ru] == -1 || edges[i][2] < edges[cheapest[ru]][2]) cheapest[ru] = i;
                if (cheapest[rv] == -1 || edges[i][2] < edges[cheapest[rv]][2]) cheapest[rv] = i;
            }
            boolean progressed = false;
            for (int idx : cheapest) {
                if (idx == -1) continue;
                int ru = find(edges[idx][0]), rv = find(edges[idx][1]);
                if (ru != rv) { parent[ru] = rv; total += edges[idx][2]; comp--; progressed = true; }
            }
            if (!progressed) break;
        }
        return total;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,4},{0,2,1},{1,2,2},{1,3,5},{2,3,8}};
        System.out.println(boruvka(4, edges)); // 8
    }
}
```

#### Python

```python
def boruvka(n, edges):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, comp = 0, n
    while comp > 1:
        cheapest = [-1] * n
        for i, (u, v, w) in enumerate(edges):
            ru, rv = find(u), find(v)
            if ru == rv:
                continue
            if cheapest[ru] == -1 or w < edges[cheapest[ru]][2]:
                cheapest[ru] = i
            if cheapest[rv] == -1 or w < edges[cheapest[rv]][2]:
                cheapest[rv] = i
        progressed = False
        for idx in cheapest:
            if idx == -1:
                continue
            u, v, w = edges[idx]
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
                total += w
                comp -= 1
                progressed = True
        if not progressed:
            break
    return total


if __name__ == "__main__":
    print(boruvka(4, [(0, 1, 4), (0, 2, 1), (1, 2, 2), (1, 3, 5), (2, 3, 8)]))  # 8
```

---

### A3. Metric TSP 2-Approximation via MST

**Statement.** Given `n` points (complete metric graph, Euclidean distance), return a tour (a permutation starting and ending at vertex 0) whose length is at most twice the optimal, by building the MST and doing a preorder DFS walk.

**Constraints.** `n ≤ 2000`.

**Hints.**
- Build MST (array-Prim, dense).
- Preorder DFS from vertex 0 gives the visiting order; that order is the 2-approx tour.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func tsp2approx(pts [][2]float64) []int {
	n := len(pts)
	dist := func(i, j int) float64 {
		dx, dy := pts[i][0]-pts[j][0], pts[i][1]-pts[j][1]
		return math.Hypot(dx, dy)
	}
	inTree := make([]bool, n)
	minE := make([]float64, n)
	par := make([]int, n)
	for i := range minE {
		minE[i] = math.Inf(1)
		par[i] = -1
	}
	minE[0] = 0
	children := make([][]int, n)
	for k := 0; k < n; k++ {
		u := -1
		for v := 0; v < n; v++ {
			if !inTree[v] && (u == -1 || minE[v] < minE[u]) {
				u = v
			}
		}
		inTree[u] = true
		if par[u] != -1 {
			children[par[u]] = append(children[par[u]], u)
		}
		for v := 0; v < n; v++ {
			if !inTree[v] {
				if d := dist(u, v); d < minE[v] {
					minE[v] = d
					par[v] = u
				}
			}
		}
	}
	order := []int{}
	var dfs func(int)
	dfs = func(u int) {
		order = append(order, u)
		for _, c := range children[u] {
			dfs(c)
		}
	}
	dfs(0)
	return order
}

func main() {
	pts := [][2]float64{{0, 0}, {0, 1}, {1, 1}, {1, 0}}
	fmt.Println(tsp2approx(pts)) // a tour, e.g. [0 1 2 3]
}
```

#### Java

```java
import java.util.*;

public class A3 {
    static List<Integer> tsp2approx(double[][] pts) {
        int n = pts.length;
        boolean[] inTree = new boolean[n];
        double[] minE = new double[n];
        int[] par = new int[n];
        Arrays.fill(minE, Double.POSITIVE_INFINITY);
        Arrays.fill(par, -1);
        minE[0] = 0;
        List<Integer>[] children = new List[n];
        for (int i = 0; i < n; i++) children[i] = new ArrayList<>();
        for (int k = 0; k < n; k++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inTree[v] && (u == -1 || minE[v] < minE[u])) u = v;
            inTree[u] = true;
            if (par[u] != -1) children[par[u]].add(u);
            for (int v = 0; v < n; v++) if (!inTree[v]) {
                double dx = pts[u][0]-pts[v][0], dy = pts[u][1]-pts[v][1];
                double d = Math.hypot(dx, dy);
                if (d < minE[v]) { minE[v] = d; par[v] = u; }
            }
        }
        List<Integer> order = new ArrayList<>();
        Deque<Integer> st = new ArrayDeque<>();
        st.push(0);
        // explicit preorder using stack with reversed children
        boolean[] visited = new boolean[n];
        while (!st.isEmpty()) {
            int u = st.pop();
            if (visited[u]) continue;
            visited[u] = true;
            order.add(u);
            for (int i = children[u].size() - 1; i >= 0; i--) st.push(children[u].get(i));
        }
        return order;
    }
    public static void main(String[] args) {
        double[][] pts = {{0,0},{0,1},{1,1},{1,0}};
        System.out.println(tsp2approx(pts));
    }
}
```

#### Python

```python
import math


def tsp_2approx(pts):
    n = len(pts)

    def dist(i, j):
        return math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])

    in_tree = [False] * n
    min_e = [math.inf] * n
    par = [-1] * n
    min_e[0] = 0
    children = [[] for _ in range(n)]
    for _ in range(n):
        u = min((v for v in range(n) if not in_tree[v]), key=lambda v: min_e[v])
        in_tree[u] = True
        if par[u] != -1:
            children[par[u]].append(u)
        for v in range(n):
            if not in_tree[v]:
                d = dist(u, v)
                if d < min_e[v]:
                    min_e[v] = d
                    par[v] = u

    order = []

    def dfs(u):
        order.append(u)
        for c in children[u]:
            dfs(c)

    dfs(0)
    return order


if __name__ == "__main__":
    print(tsp_2approx([(0, 0), (0, 1), (1, 1), (1, 0)]))  # e.g. [0, 1, 2, 3]
```

---

### A4. Critical Edges in the MST

**Statement.** Return the indices of all **critical** edges: edges whose removal increases the MST weight (or disconnects the graph).

**Constraints.** `n ≤ 100`, `m ≤ 200` (the simple `O(m²)` recompute is fine).

**Hints.**
- Compute the baseline MST weight.
- For each edge, skip it and recompute; if the new MST weight is greater (or the graph no longer spans), it is critical.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func mstSkip(n int, edges [][3]int, order []int, skip int) int {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	total, used := 0, 0
	for _, i := range order {
		if i == skip {
			continue
		}
		e := edges[i]
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			total += e[2]
			used++
		}
	}
	if used == n-1 {
		return total
	}
	return 1 << 30
}

func criticalEdges(n int, edges [][3]int) []int {
	order := make([]int, len(edges))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return edges[order[a]][2] < edges[order[b]][2] })
	base := mstSkip(n, edges, order, -1)
	res := []int{}
	for i := range edges {
		if mstSkip(n, edges, order, i) > base {
			res = append(res, i)
		}
	}
	return res
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 1}, {0, 2, 2}}
	fmt.Println(criticalEdges(3, edges)) // [0 1]
}
```

#### Java

```java
import java.util.*;

public class A4 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static int mstSkip(int n, int[][] edges, Integer[] order, int skip) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int total = 0, used = 0;
        for (int i : order) {
            if (i == skip) continue;
            int ra = find(edges[i][0]), rb = find(edges[i][1]);
            if (ra != rb) { parent[ra] = rb; total += edges[i][2]; used++; }
        }
        return used == n - 1 ? total : Integer.MAX_VALUE;
    }
    static List<Integer> criticalEdges(int n, int[][] edges) {
        Integer[] order = new Integer[edges.length];
        for (int i = 0; i < edges.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> edges[i][2]));
        int base = mstSkip(n, edges, order, -1);
        List<Integer> res = new ArrayList<>();
        for (int i = 0; i < edges.length; i++)
            if (mstSkip(n, edges, order, i) > base) res.add(i);
        return res;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1,1},{1,2,1},{0,2,2}};
        System.out.println(criticalEdges(3, edges)); // [0, 1]
    }
}
```

#### Python

```python
def critical_edges(n, edges):
    order = sorted(range(len(edges)), key=lambda i: edges[i][2])

    def mst_skip(skip):
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        total, used = 0, 0
        for i in order:
            if i == skip:
                continue
            u, v, w = edges[i]
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
                total += w
                used += 1
        return total if used == n - 1 else float("inf")

    base = mst_skip(-1)
    return [i for i in range(len(edges)) if mst_skip(i) > base]


if __name__ == "__main__":
    print(critical_edges(3, [(0, 1, 1), (1, 2, 1), (0, 2, 2)]))  # [0, 1]
```

---

### A5. MST Uniqueness Check

**Statement.** Determine whether the graph has a **unique** MST. Return `true`/`false`.

**Constraints.** `n ≤ 1000`, `m ≤ 5000`. Connected.

**Hints.**
- Build the MST and the tree adjacency.
- For each non-tree edge `(u,v,w)`, the MST is non-unique iff `w` equals the maximum edge on the tree path `u→v` (a tie that allows a swap).
- Unique iff every non-tree edge is strictly heavier than its path max.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func uniqueMST(n int, edges [][3]int) bool {
	order := make([]int, len(edges))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return edges[order[a]][2] < edges[order[b]][2] })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	adj := make([][][2]int, n)
	inMST := make([]bool, len(edges))
	for _, i := range order {
		e := edges[i]
		ra, rb := find(e[0]), find(e[1])
		if ra != rb {
			parent[ra] = rb
			inMST[i] = true
			adj[e[0]] = append(adj[e[0]], [2]int{e[1], e[2]})
			adj[e[1]] = append(adj[e[1]], [2]int{e[0], e[2]})
		}
	}
	maxOnPath := func(src, dst int) int {
		vis := make([]bool, n)
		type fr struct{ node, mx int }
		st := []fr{{src, 0}}
		vis[src] = true
		for len(st) > 0 {
			f := st[len(st)-1]
			st = st[:len(st)-1]
			if f.node == dst {
				return f.mx
			}
			for _, nx := range adj[f.node] {
				if !vis[nx[0]] {
					vis[nx[0]] = true
					mx := f.mx
					if nx[1] > mx {
						mx = nx[1]
					}
					st = append(st, fr{nx[0], mx})
				}
			}
		}
		return -1
	}
	for i, e := range edges {
		if inMST[i] {
			continue
		}
		if maxOnPath(e[0], e[1]) == e[2] {
			return false // a tie → alternative MST exists
		}
	}
	return true
}

func main() {
	fmt.Println(uniqueMST(3, [][3]int{{0, 1, 1}, {1, 2, 1}, {0, 2, 1}})) // false (all ties)
	fmt.Println(uniqueMST(3, [][3]int{{0, 1, 1}, {1, 2, 2}, {0, 2, 3}})) // true
}
```

#### Java

```java
import java.util.*;

public class A5 {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
    static boolean uniqueMST(int n, int[][] edges) {
        Integer[] order = new Integer[edges.length];
        for (int i = 0; i < edges.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> edges[i][2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        boolean[] inMST = new boolean[edges.length];
        for (int i : order) {
            int[] e = edges[i];
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) {
                parent[ra] = rb; inMST[i] = true;
                adj[e[0]].add(new int[]{e[1], e[2]});
                adj[e[1]].add(new int[]{e[0], e[2]});
            }
        }
        for (int i = 0; i < edges.length; i++) {
            if (inMST[i]) continue;
            if (maxOnPath(adj, n, edges[i][0], edges[i][1]) == edges[i][2]) return false;
        }
        return true;
    }
    static int maxOnPath(List<int[]>[] adj, int n, int src, int dst) {
        boolean[] vis = new boolean[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{src, 0}); vis[src] = true;
        while (!st.isEmpty()) {
            int[] f = st.pop();
            if (f[0] == dst) return f[1];
            for (int[] nx : adj[f[0]]) if (!vis[nx[0]]) {
                vis[nx[0]] = true;
                st.push(new int[]{nx[0], Math.max(f[1], nx[1])});
            }
        }
        return -1;
    }
    public static void main(String[] args) {
        System.out.println(uniqueMST(3, new int[][]{{0,1,1},{1,2,1},{0,2,1}})); // false
        System.out.println(uniqueMST(3, new int[][]{{0,1,1},{1,2,2},{0,2,3}})); // true
    }
}
```

#### Python

```python
def unique_mst(n, edges):
    order = sorted(range(len(edges)), key=lambda i: edges[i][2])
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    adj = [[] for _ in range(n)]
    in_mst = [False] * len(edges)
    for i in order:
        u, v, w = edges[i]
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            in_mst[i] = True
            adj[u].append((v, w))
            adj[v].append((u, w))

    def max_on_path(src, dst):
        st = [(src, 0)]
        seen = {src}
        while st:
            node, mx = st.pop()
            if node == dst:
                return mx
            for to, w in adj[node]:
                if to not in seen:
                    seen.add(to)
                    st.append((to, max(mx, w)))
        return -1

    for i, (u, v, w) in enumerate(edges):
        if in_mst[i]:
            continue
        if max_on_path(u, v) == w:
            return False
    return True


if __name__ == "__main__":
    print(unique_mst(3, [(0, 1, 1), (1, 2, 1), (0, 2, 1)]))  # False
    print(unique_mst(3, [(0, 1, 1), (1, 2, 2), (0, 2, 3)]))  # True
```

---

## Benchmark Task

### Compare Kruskal vs Heap-Prim vs Array-Prim Across Densities

**Statement.** Generate random connected weighted graphs at several densities and measure the wall-clock time of (a) Kruskal, (b) heap-Prim, (c) array-Prim. Verify all three produce the **same MST weight** (sanity check), then report timings. The goal is to *observe* the density crossover where array-Prim overtakes the others.

**Constraints.** Test `V ∈ {200, 1000, 4000}` and densities sparse (`E ≈ 2V`), medium (`E ≈ V·√V`), dense (`E ≈ V²/2`). Use 64-bit weight accumulation.

**Hints.**
- Build the graph once; feed an edge list to Kruskal and an adjacency list/matrix to the Prims.
- Pin the RNG seed for reproducibility.
- Expect: Kruskal/heap-Prim win when sparse; array-Prim wins when dense.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

func genConnected(n, m int, seed int64) [][3]int {
	r := rand.New(rand.NewSource(seed))
	edges := [][3]int{}
	perm := r.Perm(n)
	for i := 1; i < n; i++ { // spanning path guarantees connectivity
		edges = append(edges, [3]int{perm[i-1], perm[i], 1 + r.Intn(1000)})
	}
	for len(edges) < m {
		u, v := r.Intn(n), r.Intn(n)
		if u != v {
			edges = append(edges, [3]int{u, v, 1 + r.Intn(1000)})
		}
	}
	return edges
}

func find(p []int, x int) int {
	for p[x] != x {
		p[x] = p[p[x]]
		x = p[x]
	}
	return x
}

func kruskal(n int, edges [][3]int) int64 {
	es := make([][3]int, len(edges))
	copy(es, edges)
	sort.Slice(es, func(i, j int) bool { return es[i][2] < es[j][2] })
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	var total int64
	for _, e := range es {
		ra, rb := find(p, e[0]), find(p, e[1])
		if ra != rb {
			p[ra] = rb
			total += int64(e[2])
		}
	}
	return total
}

func main() {
	for _, cfg := range []struct{ n, m int }{{1000, 2000}, {1000, 30000}, {1000, 250000}} {
		edges := genConnected(cfg.n, cfg.m, 42)
		t0 := time.Now()
		w := kruskal(cfg.n, edges)
		fmt.Printf("V=%d E=%d Kruskal weight=%d time=%v\n", cfg.n, cfg.m, w, time.Since(t0))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    static int[] parent;
    static int find(int x){ while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }

    static int[][] genConnected(int n, int m, long seed) {
        Random r = new Random(seed);
        List<int[]> edges = new ArrayList<>();
        int[] perm = new int[n];
        for (int i = 0; i < n; i++) perm[i] = i;
        for (int i = n - 1; i > 0; i--) { int j = r.nextInt(i + 1); int t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
        for (int i = 1; i < n; i++) edges.add(new int[]{perm[i-1], perm[i], 1 + r.nextInt(1000)});
        while (edges.size() < m) {
            int u = r.nextInt(n), v = r.nextInt(n);
            if (u != v) edges.add(new int[]{u, v, 1 + r.nextInt(1000)});
        }
        return edges.toArray(new int[0][]);
    }

    static long kruskal(int n, int[][] edges) {
        int[][] es = edges.clone();
        Arrays.sort(es, Comparator.comparingInt(e -> e[2]));
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0;
        for (int[] e : es) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra != rb) { parent[ra] = rb; total += e[2]; }
        }
        return total;
    }

    public static void main(String[] args) {
        int[][] cfgs = {{1000,2000},{1000,30000},{1000,250000}};
        for (int[] c : cfgs) {
            int[][] edges = genConnected(c[0], c[1], 42);
            long t0 = System.nanoTime();
            long w = kruskal(c[0], edges);
            System.out.printf("V=%d E=%d Kruskal weight=%d time=%.2fms%n",
                c[0], c[1], w, (System.nanoTime() - t0) / 1e6);
        }
    }
}
```

#### Python

```python
import random
import time


def gen_connected(n, m, seed=42):
    r = random.Random(seed)
    perm = list(range(n))
    r.shuffle(perm)
    edges = [(perm[i - 1], perm[i], r.randint(1, 1000)) for i in range(1, n)]
    while len(edges) < m:
        u, v = r.randrange(n), r.randrange(n)
        if u != v:
            edges.append((u, v, r.randint(1, 1000)))
    return edges


def kruskal(n, edges):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total = 0
    for u, v, w in sorted(edges, key=lambda e: e[2]):
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
            total += w
    return total


if __name__ == "__main__":
    for n, m in [(1000, 2000), (1000, 30000), (1000, 250000)]:
        edges = gen_connected(n, m)
        t0 = time.perf_counter()
        w = kruskal(n, edges)
        print(f"V={n} E={m} Kruskal weight={w} time={(time.perf_counter()-t0)*1000:.2f}ms")
```

**What to observe.** As `E` grows toward `V²`, Kruskal's sort cost (`O(E log E)`) dominates and array-Prim's `O(V²)` — independent of `E` — becomes the fastest; on sparse graphs Kruskal/heap-Prim win. All three must report identical MST weights on the same graph (use that as a correctness gate before trusting any timing).
