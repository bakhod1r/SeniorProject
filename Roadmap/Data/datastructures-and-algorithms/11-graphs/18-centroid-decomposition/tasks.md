# Centroid Decomposition — Practice Tasks

> **One-line summary:** Fifteen graded tasks (5 beginner, 5 intermediate, 5 advanced) plus a benchmark, each with statement, constraints, hints, and reference solutions in Go, Java, and Python — building from "find a centroid" up to dynamic nearest-marked-node and large-scale performance.

---

## Table of Contents

1. [Beginner Tasks (5)](#beginner-tasks-5)
2. [Intermediate Tasks (5)](#intermediate-tasks-5)
3. [Advanced Tasks (5)](#advanced-tasks-5)
4. [Benchmark Task](#benchmark-task)

---

## Beginner Tasks (5)

### B1 — Find a single centroid

**Statement.** Given a tree with `N` vertices (0-indexed) and `N-1` edges, return any centroid: a vertex whose removal leaves every component with `≤ ⌊N/2⌋` vertices.

**Constraints.** `1 ≤ N ≤ 10⁵`. Tree is connected.

**Hints.**
- Root anywhere; compute subtree sizes with one DFS.
- Descend toward the child whose subtree size `> N/2`; stop when none does.

#### Go

```go
package main

import "fmt"

var adj [][]int
var size []int
var N int

func computeSize(u, p int) int {
	size[u] = 1
	for _, v := range adj[u] {
		if v != p {
			size[u] += computeSize(v, u)
		}
	}
	return size[u]
}

func findCentroid(u, p int) int {
	for _, v := range adj[u] {
		if v != p && size[v] > N/2 {
			return findCentroid(v, u)
		}
	}
	return u
}

func main() {
	N = 7
	adj = make([][]int, N)
	size = make([]int, N)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	computeSize(0, -1)
	fmt.Println("centroid:", findCentroid(0, -1)) // 1
}
```

#### Java

```java
import java.util.*;

public class FindCentroid {
    static List<List<Integer>> adj;
    static int[] size;
    static int N;

    static int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p) size[u] += computeSize(v, u);
        return size[u];
    }

    static int findCentroid(int u, int p) {
        for (int v : adj.get(u)) if (v != p && size[v] > N / 2) return findCentroid(v, u);
        return u;
    }

    public static void main(String[] args) {
        N = 7;
        adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) { adj.get(x[0]).add(x[1]); adj.get(x[1]).add(x[0]); }
        size = new int[N];
        computeSize(0, -1);
        System.out.println("centroid: " + findCentroid(0, -1)); // 1
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)

N = 7
adj = [[] for _ in range(N)]
size = [0] * N
for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
    adj[u].append(v)
    adj[v].append(u)


def compute_size(u, p):
    size[u] = 1
    for v in adj[u]:
        if v != p:
            size[u] += compute_size(v, u)
    return size[u]


def find_centroid(u, p):
    for v in adj[u]:
        if v != p and size[v] > N // 2:
            return find_centroid(v, u)
    return u


compute_size(0, -1)
print("centroid:", find_centroid(0, -1))  # 1
```

---

### B2 — Verify a vertex is a centroid

**Statement.** Given a tree and a vertex `c`, return `true` iff every component of `T − c` has size `≤ ⌊N/2⌋`.

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Root at `c`. Each child subtree is one component; the "rest" is `N − size[c]` (which is 0 when rooted at `c`).
- Component sizes are exactly the child-subtree sizes of `c` when `c` is the root.

#### Go

```go
package main

import "fmt"

func isCentroid(adj [][]int, N, c int) bool {
	size := make([]int, N)
	var dfs func(u, p int) int
	dfs = func(u, p int) int {
		size[u] = 1
		for _, v := range adj[u] {
			if v != p {
				size[u] += dfs(v, u)
			}
		}
		return size[u]
	}
	dfs(c, -1)
	for _, v := range adj[c] {
		if size[v] > N/2 {
			return false
		}
	}
	return true
}

func main() {
	N := 7
	adj := make([][]int, N)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	fmt.Println(isCentroid(adj, N, 1)) // true
	fmt.Println(isCentroid(adj, N, 0)) // false
}
```

#### Java

```java
import java.util.*;

public class VerifyCentroid {
    static List<List<Integer>> adj;
    static int[] size;
    static int N;

    static int dfs(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p) size[u] += dfs(v, u);
        return size[u];
    }

    static boolean isCentroid(int c) {
        size = new int[N];
        dfs(c, -1);
        for (int v : adj.get(c)) if (size[v] > N / 2) return false;
        return true;
    }

    public static void main(String[] args) {
        N = 7;
        adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) { adj.get(x[0]).add(x[1]); adj.get(x[1]).add(x[0]); }
        System.out.println(isCentroid(1)); // true
        System.out.println(isCentroid(0)); // false
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


def is_centroid(adj, N, c):
    size = [0] * N

    def dfs(u, p):
        size[u] = 1
        for v in adj[u]:
            if v != p:
                size[u] += dfs(v, u)
        return size[u]

    dfs(c, -1)
    return all(size[v] <= N // 2 for v in adj[c])


N = 7
adj = [[] for _ in range(N)]
for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
    adj[u].append(v)
    adj[v].append(u)
print(is_centroid(adj, N, 1))  # True
print(is_centroid(adj, N, 0))  # False
```

---

### B3 — Build the centroid tree (return parents)

**Statement.** Build the centroid tree and return an array `cparent[]` where `cparent[c]` is the parent of `c` in the centroid tree (`-1` for the root).

**Constraints.** `1 ≤ N ≤ 2·10⁵`.

**Hints.**
- Reuse `computeSize` / `findCentroid` but respect a `removed[]` flag.
- Recompute sizes over the residual tree before each centroid choice.

#### Go

```go
package main

import "fmt"

type CT struct {
	adj             [][]int
	removed         []bool
	size, cparent   []int
}

func (c *CT) computeSize(u, p int) int {
	c.size[u] = 1
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] {
			c.size[u] += c.computeSize(v, u)
		}
	}
	return c.size[u]
}

func (c *CT) findCentroid(u, p, n int) int {
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] && c.size[v] > n/2 {
			return c.findCentroid(v, u, n)
		}
	}
	return u
}

func (c *CT) decompose(entry, par int) {
	n := c.computeSize(entry, -1)
	ce := c.findCentroid(entry, -1, n)
	c.removed[ce] = true
	c.cparent[ce] = par
	for _, v := range c.adj[ce] {
		if !c.removed[v] {
			c.decompose(v, ce)
		}
	}
}

func main() {
	N := 7
	c := &CT{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N), cparent: make([]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		c.adj[e[0]] = append(c.adj[e[0]], e[1])
		c.adj[e[1]] = append(c.adj[e[1]], e[0])
	}
	c.decompose(0, -1)
	fmt.Println(c.cparent) // root is 1 -> cparent[1] = -1
}
```

#### Java

```java
import java.util.*;

public class BuildCentroidTree {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size, cparent;

    BuildCentroidTree(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        cparent = new int[n];
        Arrays.fill(cparent, -1);
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
        return size[u];
    }

    int findCentroid(int u, int p, int n) {
        for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return findCentroid(v, u, n);
        return u;
    }

    void decompose(int entry, int par) {
        int n = computeSize(entry, -1);
        int c = findCentroid(entry, -1, n);
        removed[c] = true;
        cparent[c] = par;
        for (int v : adj.get(c)) if (!removed[v]) decompose(v, c);
    }

    public static void main(String[] args) {
        BuildCentroidTree t = new BuildCentroidTree(7);
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) t.addEdge(x[0], x[1]);
        t.decompose(0, -1);
        System.out.println(Arrays.toString(t.cparent));
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class BuildCentroidTree:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.cparent = [-1] * n

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.find_centroid(v, u, n)
        return u

    def decompose(self, entry, par):
        n = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, n)
        self.removed[c] = True
        self.cparent[c] = par
        for v in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v, c)


t = BuildCentroidTree(7)
for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
    t.add_edge(u, v)
t.decompose(0, -1)
print(t.cparent)
```

---

### B4 — Centroid-tree depth of each vertex

**Statement.** Output `level[v]` = depth of `v` in the centroid tree (root = 0). Verify the maximum level is `≤ ⌊log₂ N⌋ + 1`.

**Constraints.** `1 ≤ N ≤ 2·10⁵`.

**Hints.**
- During `decompose`, pass the current depth; set `level[centroid] = depth`.
- Or compute from `cparent[]` afterward.

#### Go

```go
package main

import "fmt"

type CT struct {
	adj           [][]int
	removed       []bool
	size, level   []int
}

func (c *CT) computeSize(u, p int) int {
	c.size[u] = 1
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] {
			c.size[u] += c.computeSize(v, u)
		}
	}
	return c.size[u]
}

func (c *CT) findCentroid(u, p, n int) int {
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] && c.size[v] > n/2 {
			return c.findCentroid(v, u, n)
		}
	}
	return u
}

func (c *CT) decompose(entry, depth int) {
	n := c.computeSize(entry, -1)
	ce := c.findCentroid(entry, -1, n)
	c.removed[ce] = true
	c.level[ce] = depth
	for _, v := range c.adj[ce] {
		if !c.removed[v] {
			c.decompose(v, depth+1)
		}
	}
}

func main() {
	N := 7
	c := &CT{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N), level: make([]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		c.adj[e[0]] = append(c.adj[e[0]], e[1])
		c.adj[e[1]] = append(c.adj[e[1]], e[0])
	}
	c.decompose(0, 0)
	fmt.Println(c.level)
}
```

#### Java

```java
import java.util.*;

public class CentroidLevels {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size, level;

    CentroidLevels(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        level = new int[n];
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
        return size[u];
    }

    int findCentroid(int u, int p, int n) {
        for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return findCentroid(v, u, n);
        return u;
    }

    void decompose(int entry, int depth) {
        int n = computeSize(entry, -1);
        int c = findCentroid(entry, -1, n);
        removed[c] = true;
        level[c] = depth;
        for (int v : adj.get(c)) if (!removed[v]) decompose(v, depth + 1);
    }

    public static void main(String[] args) {
        CentroidLevels t = new CentroidLevels(7);
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) t.addEdge(x[0], x[1]);
        t.decompose(0, 0);
        System.out.println(Arrays.toString(t.level));
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class CentroidLevels:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.level = [0] * n

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.find_centroid(v, u, n)
        return u

    def decompose(self, entry, depth):
        n = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, n)
        self.removed[c] = True
        self.level[c] = depth
        for v in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v, depth + 1)


t = CentroidLevels(7)
for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
    t.add_edge(u, v)
t.decompose(0, 0)
print(t.level)
```

---

### B5 — Count both centroids when there are two

**Statement.** Return all centroids of the tree (one or two vertices).

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Find one centroid `c`. If a child component of `c` equals exactly `N/2`, the neighbor in that direction is the second centroid.
- Equivalently: a vertex is a centroid iff `max(child sizes, N − size_subtree) ≤ ⌊N/2⌋`; collect all such.

#### Go

```go
package main

import "fmt"

func centroids(adj [][]int, N int) []int {
	size := make([]int, N)
	var dfs func(u, p int) int
	dfs = func(u, p int) int {
		size[u] = 1
		for _, v := range adj[u] {
			if v != p {
				size[u] += dfs(v, u)
			}
		}
		return size[u]
	}
	dfs(0, -1)
	var res []int
	var check func(u, p int)
	check = func(u, p int) {
		w := N - size[u]
		for _, v := range adj[u] {
			if v != p {
				if size[v] > w {
					w = size[v]
				}
			}
		}
		if w <= N/2 {
			res = append(res, u)
		}
		for _, v := range adj[u] {
			if v != p {
				check(v, u)
			}
		}
	}
	check(0, -1)
	return res
}

func main() {
	// path 0-1-2-3 has two centroids: 1 and 2
	N := 4
	adj := make([][]int, N)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {2, 3}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	fmt.Println(centroids(adj, N)) // [1 2]
}
```

#### Java

```java
import java.util.*;

public class TwoCentroids {
    static List<List<Integer>> adj;
    static int[] size;
    static int N;
    static List<Integer> res = new ArrayList<>();

    static int dfs(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p) size[u] += dfs(v, u);
        return size[u];
    }

    static void check(int u, int p) {
        int w = N - size[u];
        for (int v : adj.get(u)) if (v != p) w = Math.max(w, size[v]);
        if (w <= N / 2) res.add(u);
        for (int v : adj.get(u)) if (v != p) check(v, u);
    }

    public static void main(String[] args) {
        N = 4;
        adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int[][] e = {{0,1},{1,2},{2,3}};
        for (int[] x : e) { adj.get(x[0]).add(x[1]); adj.get(x[1]).add(x[0]); }
        size = new int[N];
        dfs(0, -1);
        check(0, -1);
        System.out.println(res); // [1, 2]
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


def centroids(adj, N):
    size = [0] * N

    def dfs(u, p):
        size[u] = 1
        for v in adj[u]:
            if v != p:
                size[u] += dfs(v, u)
        return size[u]

    dfs(0, -1)
    res = []

    def check(u, p):
        w = N - size[u]
        for v in adj[u]:
            if v != p:
                w = max(w, size[v])
        if w <= N // 2:
            res.append(u)
        for v in adj[u]:
            if v != p:
                check(v, u)

    check(0, -1)
    return res


N = 4
adj = [[] for _ in range(N)]
for u, v in [(0, 1), (1, 2), (2, 3)]:
    adj[u].append(v)
    adj[v].append(u)
print(centroids(adj, N))  # [1, 2]
```

---

## Intermediate Tasks (5)

### I1 — Count pairs at distance exactly K

**Statement.** Count unordered pairs `(u, v)` with exactly `K` edges between them.

**Constraints.** `1 ≤ N ≤ 2·10⁵`, `1 ≤ K ≤ N`.

**Hints.**
- Per centroid, register distances branch by branch; query `cnt[K − d]` before registering each branch.
- Reset only touched buckets to keep it `O(N log N)`.

This is **Challenge 2** in [`interview.md`](./interview.md); see the full Go/Java/Python solutions there. Expected answer for the test tree (`0-1-2`, `1-3-4`, `K=2`) is **4** (pairs `{0,2}, {0,3}, {2,3}, {2,4}` all have exactly 2 edges between them) — verify against brute force.

---

### I2 — Count pairs at distance ≤ K (weighted)

**Statement.** Weighted tree; count unordered pairs with path weight `≤ K`.

**Constraints.** `1 ≤ N ≤ 10⁵`, weights `≥ 0`, `K ≤ 10⁹`.

**Hints.**
- Sort each centroid's distance list, count pairs `≤ K` with two pointers, subtract per-branch over-count.

This is the **Code Example** in [`middle.md`](./middle.md) (unweighted) and **Challenge 1** in [`interview.md`](./interview.md) (weighted). Reuse those reference solutions.

---

### I3 — Distance to nearest leaf via centroid ancestors (static)

**Statement.** A set `S` of "special" vertices is fixed. For every vertex `x`, output `min_{s∈S} dist(x, s)`.

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Per centroid, store the min distance to any special vertex in its component.
- For each `x`, answer = `min over ancestors c of (dist(x,c) + minSpecial[c])`.

#### Go

```go
package main

import "fmt"

const INF = 1 << 30

type S struct {
	adj           [][]int
	removed       []bool
	size, cpar    []int
	ancDist       [][][2]int // (centroid, dist)
	best          []int
}

func (s *S) cs(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.cs(v, u)
		}
	}
	return s.size[u]
}

func (s *S) fc(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.fc(v, u, n)
		}
	}
	return u
}

func (s *S) rec(u, p, d, c int) {
	s.ancDist[u] = append(s.ancDist[u], [2]int{c, d})
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.rec(v, u, d+1, c)
		}
	}
}

func (s *S) dec(entry int) {
	n := s.cs(entry, -1)
	c := s.fc(entry, -1, n)
	s.removed[c] = true
	s.rec(c, -1, 0, c)
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.dec(v)
		}
	}
}

func main() {
	N := 7
	s := &S{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N),
		cpar: make([]int, N), ancDist: make([][][2]int, N), best: make([]int, N)}
	for i := range s.best {
		s.best[i] = INF
	}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.dec(0)
	special := []int{4, 6}
	for _, x := range special {
		for _, pr := range s.ancDist[x] {
			if pr[1] < s.best[pr[0]] {
				s.best[pr[0]] = pr[1]
			}
		}
	}
	for x := 0; x < N; x++ {
		ans := INF
		for _, pr := range s.ancDist[x] {
			if s.best[pr[0]] < INF && pr[1]+s.best[pr[0]] < ans {
				ans = pr[1] + s.best[pr[0]]
			}
		}
		fmt.Printf("dist(%d, S) = %d\n", x, ans)
	}
}
```

#### Java

```java
import java.util.*;

public class NearestSpecial {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size, best;
    List<int[]>[] ancDist;
    static final int INF = 1 << 30;

    @SuppressWarnings("unchecked")
    NearestSpecial(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        best = new int[n];
        Arrays.fill(best, INF);
        ancDist = new List[n];
        for (int i = 0; i < n; i++) ancDist[i] = new ArrayList<>();
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int cs(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += cs(v, u);
        return size[u];
    }

    int fc(int u, int p, int n) {
        for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return fc(v, u, n);
        return u;
    }

    void rec(int u, int p, int d, int c) {
        ancDist[u].add(new int[]{c, d});
        for (int v : adj.get(u)) if (v != p && !removed[v]) rec(v, u, d + 1, c);
    }

    void dec(int entry) {
        int n = cs(entry, -1);
        int c = fc(entry, -1, n);
        removed[c] = true;
        rec(c, -1, 0, c);
        for (int v : adj.get(c)) if (!removed[v]) dec(v);
    }

    public static void main(String[] args) {
        NearestSpecial s = new NearestSpecial(7);
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.dec(0);
        for (int x : new int[]{4, 6})
            for (int[] pr : s.ancDist[x]) s.best[pr[0]] = Math.min(s.best[pr[0]], pr[1]);
        for (int x = 0; x < 7; x++) {
            int ans = INF;
            for (int[] pr : s.ancDist[x])
                if (s.best[pr[0]] < INF) ans = Math.min(ans, pr[1] + s.best[pr[0]]);
            System.out.println("dist(" + x + ", S) = " + ans);
        }
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)
INF = 1 << 30


class NearestSpecial:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.best = [INF] * n
        self.anc = [[] for _ in range(n)]

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def cs(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def rec(self, u, p, d, c):
        self.anc[u].append((c, d))
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.rec(v, u, d + 1, c)

    def dec(self, entry):
        n = self.cs(entry, -1)
        c = self.fc(entry, -1, n)
        self.removed[c] = True
        self.rec(c, -1, 0, c)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.dec(v)


s = NearestSpecial(7)
for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
    s.add_edge(u, v)
s.dec(0)
for x in (4, 6):
    for c, d in s.anc[x]:
        s.best[c] = min(s.best[c], d)
for x in range(7):
    ans = INF
    for c, d in s.anc[x]:
        if s.best[c] < INF:
            ans = min(ans, d + s.best[c])
    print(f"dist({x}, S) = {ans}")
```

---

### I4 — Number of paths with length in range [L, R]

**Statement.** Count unordered pairs whose path length (edges) is in `[L, R]`.

**Constraints.** `1 ≤ N ≤ 10⁵`, `0 ≤ L ≤ R ≤ N`.

**Hints.**
- `countLeq(R) − countLeq(L − 1)` using the I2 machinery.
- Or per centroid, count distances in the complementary-range with sorted arrays + two binary searches.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Sol struct {
	adj      [][]int
	removed  []bool
	size     []int
	ans      int64
}

func (s *Sol) cs(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.cs(v, u)
		}
	}
	return s.size[u]
}
func (s *Sol) fc(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.fc(v, u, n)
		}
	}
	return u
}
func (s *Sol) gather(u, p, d int, out *[]int) {
	*out = append(*out, d)
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.gather(v, u, d+1, out)
		}
	}
}
func countLeq(d []int, K int) int64 {
	if K < 0 {
		return 0
	}
	sort.Ints(d)
	var c int64
	lo, hi := 0, len(d)-1
	for lo < hi {
		if d[lo]+d[hi] <= K {
			c += int64(hi - lo)
			lo++
		} else {
			hi--
		}
	}
	return c
}
func (s *Sol) contrib(all []int, K int) int64 { return countLeq(all, K) }

func (s *Sol) dec(entry, L, R int) {
	n := s.cs(entry, -1)
	c := s.fc(entry, -1, n)
	s.removed[c] = true
	all := []int{0}
	branches := [][]int{}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			var br []int
			s.gather(v, c, 1, &br)
			all = append(all, br...)
			branches = append(branches, br)
		}
	}
	add := func(d []int) int64 { return countLeq(append([]int{}, d...), R) - countLeq(append([]int{}, d...), L-1) }
	s.ans += add(all)
	for _, br := range branches {
		s.ans -= add(br)
	}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.dec(v, L, R)
		}
	}
}

func main() {
	N := 5
	s := &Sol{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}} {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.dec(0, 2, 3)
	fmt.Println("pairs with length in [2,3]:", s.ans)
}
```

#### Java

```java
import java.util.*;

public class PathsInRange {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size;
    long ans = 0;

    PathsInRange(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
    }
    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
    int cs(int u, int p) { size[u] = 1; for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += cs(v, u); return size[u]; }
    int fc(int u, int p, int n) { for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return fc(v, u, n); return u; }
    void gather(int u, int p, int d, List<Integer> out) { out.add(d); for (int v : adj.get(u)) if (v != p && !removed[v]) gather(v, u, d + 1, out); }

    long countLeq(List<Integer> src, int K) {
        if (K < 0) return 0;
        List<Integer> d = new ArrayList<>(src);
        Collections.sort(d);
        long c = 0; int lo = 0, hi = d.size() - 1;
        while (lo < hi) { if (d.get(lo) + d.get(hi) <= K) { c += hi - lo; lo++; } else hi--; }
        return c;
    }

    void dec(int entry, int L, int R) {
        int n = cs(entry, -1);
        int c = fc(entry, -1, n);
        removed[c] = true;
        List<Integer> all = new ArrayList<>(); all.add(0);
        List<List<Integer>> branches = new ArrayList<>();
        for (int v : adj.get(c)) if (!removed[v]) {
            List<Integer> br = new ArrayList<>();
            gather(v, c, 1, br);
            all.addAll(br); branches.add(br);
        }
        ans += countLeq(all, R) - countLeq(all, L - 1);
        for (List<Integer> br : branches) ans -= countLeq(br, R) - countLeq(br, L - 1);
        for (int v : adj.get(c)) if (!removed[v]) dec(v, L, R);
    }

    public static void main(String[] args) {
        PathsInRange s = new PathsInRange(5);
        int[][] e = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.dec(0, 2, 3);
        System.out.println("pairs with length in [2,3]: " + s.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class PathsInRange:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.ans = 0

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def cs(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def gather(self, u, p, d, out):
        out.append(d)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, d + 1, out)

    @staticmethod
    def count_leq(src, K):
        if K < 0:
            return 0
        d = sorted(src)
        c, lo, hi = 0, 0, len(d) - 1
        while lo < hi:
            if d[lo] + d[hi] <= K:
                c += hi - lo
                lo += 1
            else:
                hi -= 1
        return c

    def dec(self, entry, L, R):
        n = self.cs(entry, -1)
        c = self.fc(entry, -1, n)
        self.removed[c] = True
        all_d = [0]
        branches = []
        for v in self.adj[c]:
            if not self.removed[v]:
                br = []
                self.gather(v, c, 1, br)
                all_d.extend(br)
                branches.append(br)
        self.ans += self.count_leq(all_d, R) - self.count_leq(all_d, L - 1)
        for br in branches:
            self.ans -= self.count_leq(br, R) - self.count_leq(br, L - 1)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.dec(v, L, R)


s = PathsInRange(5)
for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
    s.add_edge(u, v)
s.dec(0, 2, 3)
print("pairs with length in [2,3]:", s.ans)
```

---

### I5 — Validate decomposition against brute force

**Statement.** Write a tester: generate random trees up to `N = 200`, run your centroid decomposition pair-distance counter, and compare against an `O(N²)` BFS-from-every-node baseline.

**Constraints.** Random trees, many seeds.

**Hints.**
- BFS from each vertex gives all distances; tally the target counts.
- Any mismatch points to stale sizes or double-counting.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

func bruteCountLeq(adj [][]int, N, K int) int64 {
	var total int64
	for s := 0; s < N; s++ {
		dist := make([]int, N)
		for i := range dist {
			dist[i] = -1
		}
		dist[s] = 0
		q := []int{s}
		for len(q) > 0 {
			u := q[0]
			q = q[1:]
			for _, v := range adj[u] {
				if dist[v] == -1 {
					dist[v] = dist[u] + 1
					q = append(q, v)
				}
			}
		}
		for t := s + 1; t < N; t++ {
			if dist[t] <= K {
				total++
			}
		}
	}
	return total
}

func main() {
	for seed := 0; seed < 5; seed++ {
		r := rand.New(rand.NewSource(int64(seed)))
		N := 2 + r.Intn(50)
		adj := make([][]int, N)
		for i := 1; i < N; i++ {
			p := r.Intn(i)
			adj[i] = append(adj[i], p)
			adj[p] = append(adj[p], i)
		}
		K := r.Intn(N)
		fmt.Printf("seed=%d N=%d K=%d brute=%d\n", seed, N, K, bruteCountLeq(adj, N, K))
		// Compare against your centroid-decomposition counter here.
	}
}
```

#### Java

```java
import java.util.*;

public class BruteTester {
    static long bruteCountLeq(List<List<Integer>> adj, int N, int K) {
        long total = 0;
        for (int s = 0; s < N; s++) {
            int[] dist = new int[N];
            Arrays.fill(dist, -1);
            dist[s] = 0;
            ArrayDeque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) if (dist[v] == -1) { dist[v] = dist[u] + 1; q.add(v); }
            }
            for (int t = s + 1; t < N; t++) if (dist[t] <= K) total++;
        }
        return total;
    }

    public static void main(String[] args) {
        for (int seed = 0; seed < 5; seed++) {
            Random r = new Random(seed);
            int N = 2 + r.nextInt(50);
            List<List<Integer>> adj = new ArrayList<>();
            for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
            for (int i = 1; i < N; i++) {
                int p = r.nextInt(i);
                adj.get(i).add(p); adj.get(p).add(i);
            }
            int K = r.nextInt(N);
            System.out.printf("seed=%d N=%d K=%d brute=%d%n", seed, N, K, bruteCountLeq(adj, N, K));
        }
    }
}
```

#### Python

```python
import random
from collections import deque


def brute_count_leq(adj, N, K):
    total = 0
    for s in range(N):
        dist = [-1] * N
        dist[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if dist[v] == -1:
                    dist[v] = dist[u] + 1
                    q.append(v)
        total += sum(1 for t in range(s + 1, N) if dist[t] <= K)
    return total


for seed in range(5):
    random.seed(seed)
    N = random.randint(2, 50)
    adj = [[] for _ in range(N)]
    for i in range(1, N):
        p = random.randint(0, i - 1)
        adj[i].append(p)
        adj[p].append(i)
    K = random.randint(0, N - 1)
    print(f"seed={seed} N={N} K={K} brute={brute_count_leq(adj, N, K)}")
    # Compare against your centroid-decomposition counter here.
```

---

## Advanced Tasks (5)

### A1 — Dynamic nearest marked node

**Statement.** Support `mark(x)`, `unmark(x)`, `query(x)` = distance to the nearest currently-marked vertex.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`.

**Hints.**
- Precompute `dist(x, ancestor)`; per centroid keep a min-structure of marked distances; query over `O(log N)` ancestors.

This is the full reference implementation in [`senior.md`](./senior.md) §7 (Go/Java/Python). Use a balanced multiset / indexed heap for `O(log N)` min.

---

### A2 — Count "good" paths (color constraint)

**Statement.** Each vertex has a color. Count unordered pairs `(u, v)` such that the path `u…v` contains **at most one** vertex of color `RED`.

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Per centroid, for each vertex track `(distance, redCountOnLegToCentroid)`.
- A path is good iff the two legs' red counts sum (minus double-counting the centroid if red) `≤ 1`. Bucket distances by red-count and combine; subtract same-branch over-counts.

#### Go

```go
package main

import "fmt"

type Sol struct {
	adj     [][]int
	color   []int // 1 = RED
	removed []bool
	size    []int
	ans     int64
}

func (s *Sol) cs(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.cs(v, u)
		}
	}
	return s.size[u]
}
func (s *Sol) fc(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.fc(v, u, n)
		}
	}
	return u
}

// gather red-count on the leg from centroid to u (inclusive of u, exclusive of centroid handled by caller)
func (s *Sol) gather(u, p, red int, out *[]int) {
	r := red + s.color[u]
	*out = append(*out, r)
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.gather(v, u, r, out)
		}
	}
}

// count pairs (a in legs, b in legs) with redA + redB <= 1 ; given a centroid red flag cr
func combine(reds []int, cr int) int64 {
	// reds are red-counts of legs (each 0 or more). Path total reds = redA + redB + cr.
	// want redA + redB + cr <= 1  => redA + redB <= 1 - cr.
	limit := 1 - cr
	if limit < 0 {
		return 0
	}
	// count pairs i<j with reds[i]+reds[j] <= limit
	var cnt0, cntPos int64
	for _, r := range reds {
		if r == 0 {
			cnt0++
		} else if r == 1 {
			cntPos++
		}
	}
	var c int64
	if limit >= 0 {
		c += cnt0 * (cnt0 - 1) / 2 // 0+0 <= limit always when limit>=0
	}
	if limit >= 1 {
		c += cnt0 * cntPos // 0+1
	}
	return c
}

func (s *Sol) dec(entry int) {
	n := s.cs(entry, -1)
	c := s.fc(entry, -1, n)
	s.removed[c] = true
	cr := s.color[c]
	all := []int{0} // centroid itself, leg red 0 (centroid's own color tracked via cr)
	branches := [][]int{}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			var br []int
			s.gather(v, c, 0, &br)
			all = append(all, br...)
			branches = append(branches, br)
		}
	}
	s.ans += combine(all, cr)
	for _, br := range branches {
		s.ans -= combine(br, cr)
	}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.dec(v)
		}
	}
}

func main() {
	N := 5
	s := &Sol{adj: make([][]int, N), color: []int{0, 1, 0, 0, 0}, removed: make([]bool, N), size: make([]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}} {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.dec(0)
	fmt.Println("good pairs (<=1 red):", s.ans)
}
```

#### Java

```java
import java.util.*;

public class GoodPaths {
    List<List<Integer>> adj;
    int[] color, size;
    boolean[] removed;
    long ans = 0;

    GoodPaths(int n, int[] color) {
        this.color = color;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
    }
    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
    int cs(int u, int p) { size[u] = 1; for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += cs(v, u); return size[u]; }
    int fc(int u, int p, int n) { for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return fc(v, u, n); return u; }
    void gather(int u, int p, int red, List<Integer> out) {
        int r = red + color[u];
        out.add(r);
        for (int v : adj.get(u)) if (v != p && !removed[v]) gather(v, u, r, out);
    }
    long combine(List<Integer> reds, int cr) {
        int limit = 1 - cr;
        if (limit < 0) return 0;
        long c0 = 0, c1 = 0;
        for (int r : reds) { if (r == 0) c0++; else if (r == 1) c1++; }
        long c = c0 * (c0 - 1) / 2;
        if (limit >= 1) c += c0 * c1;
        return c;
    }
    void dec(int entry) {
        int n = cs(entry, -1);
        int c = fc(entry, -1, n);
        removed[c] = true;
        int cr = color[c];
        List<Integer> all = new ArrayList<>(); all.add(0);
        List<List<Integer>> branches = new ArrayList<>();
        for (int v : adj.get(c)) if (!removed[v]) {
            List<Integer> br = new ArrayList<>();
            gather(v, c, 0, br);
            all.addAll(br); branches.add(br);
        }
        ans += combine(all, cr);
        for (List<Integer> br : branches) ans -= combine(br, cr);
        for (int v : adj.get(c)) if (!removed[v]) dec(v);
    }

    public static void main(String[] args) {
        GoodPaths s = new GoodPaths(5, new int[]{0,1,0,0,0});
        int[][] e = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.dec(0);
        System.out.println("good pairs (<=1 red): " + s.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class GoodPaths:
    def __init__(self, n, color):
        self.adj = [[] for _ in range(n)]
        self.color = color
        self.removed = [False] * n
        self.size = [0] * n
        self.ans = 0

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def cs(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def gather(self, u, p, red, out):
        r = red + self.color[u]
        out.append(r)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, r, out)

    @staticmethod
    def combine(reds, cr):
        limit = 1 - cr
        if limit < 0:
            return 0
        c0 = sum(1 for r in reds if r == 0)
        c1 = sum(1 for r in reds if r == 1)
        c = c0 * (c0 - 1) // 2
        if limit >= 1:
            c += c0 * c1
        return c

    def dec(self, entry):
        n = self.cs(entry, -1)
        c = self.fc(entry, -1, n)
        self.removed[c] = True
        cr = self.color[c]
        all_r = [0]
        branches = []
        for v in self.adj[c]:
            if not self.removed[v]:
                br = []
                self.gather(v, c, 0, br)
                all_r.extend(br)
                branches.append(br)
        self.ans += self.combine(all_r, cr)
        for br in branches:
            self.ans -= self.combine(br, cr)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.dec(v)


s = GoodPaths(5, [0, 1, 0, 0, 0])
for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
    s.add_edge(u, v)
s.dec(0)
print("good pairs (<=1 red):", s.ans)
```

---

### A3 — IOI "Race": shortest edge-count path with total weight exactly K

**Statement.** Weighted tree; find the **minimum number of edges** on any path whose total weight is exactly `K` (or `-1` if none).

**Constraints.** `1 ≤ N ≤ 2·10⁵`, `1 ≤ K ≤ 10⁶`.

**Hints.**
- Per centroid, maintain `best[w]` = min edges seen so far for weight `w` (reset by touched keys, size `K+1`).
- For each new vertex at `(weight w, edges e)` with `w ≤ K`, candidate answer `= e + best[K − w]`. Query before registering each branch.

#### Go

```go
package main

import "fmt"

const INF = 1 << 30

type edge struct{ to, w int }
type Race struct {
	adj     [][]edge
	removed []bool
	size    []int
	K       int
	best    []int // best[w] = min edges for weight w
	touched []int
	ans     int
}

func (r *Race) cs(u, p int) int {
	r.size[u] = 1
	for _, e := range r.adj[u] {
		if e.to != p && !r.removed[e.to] {
			r.size[u] += r.cs(e.to, u)
		}
	}
	return r.size[u]
}
func (r *Race) fc(u, p, n int) int {
	for _, e := range r.adj[u] {
		if e.to != p && !r.removed[e.to] && r.size[e.to] > n/2 {
			return r.fc(e.to, u, n)
		}
	}
	return u
}
func (r *Race) walk(u, p, w, e int, query bool) {
	if w > r.K {
		return
	}
	if query {
		if r.best[r.K-w] < INF {
			if cand := e + r.best[r.K-w]; cand < r.ans {
				r.ans = cand
			}
		}
	} else {
		if e < r.best[w] {
			r.best[w] = e
			r.touched = append(r.touched, w)
		}
	}
	for _, ed := range r.adj[u] {
		if ed.to != p && !r.removed[ed.to] {
			r.walk(ed.to, u, w+ed.w, e+1, query)
		}
	}
}
func (r *Race) dec(entry int) {
	n := r.cs(entry, -1)
	c := r.fc(entry, -1, n)
	r.removed[c] = true
	r.best[0] = 0
	r.touched = append(r.touched, 0)
	for _, ed := range r.adj[c] {
		if !r.removed[ed.to] {
			r.walk(ed.to, c, ed.w, 1, true)
			r.walk(ed.to, c, ed.w, 1, false)
		}
	}
	for _, w := range r.touched {
		r.best[w] = INF
	}
	r.touched = r.touched[:0]
	for _, ed := range r.adj[c] {
		if !r.removed[ed.to] {
			r.dec(ed.to)
		}
	}
}

func main() {
	N, K := 4, 3
	r := &Race{adj: make([][]edge, N), removed: make([]bool, N), size: make([]int, N), K: K, ans: INF}
	r.best = make([]int, K+1)
	for i := range r.best {
		r.best[i] = INF
	}
	add := func(u, v, w int) {
		r.adj[u] = append(r.adj[u], edge{v, w})
		r.adj[v] = append(r.adj[v], edge{u, w})
	}
	add(0, 1, 1); add(1, 2, 2); add(1, 3, 3)
	r.dec(0)
	if r.ans == INF {
		fmt.Println(-1)
	} else {
		fmt.Println("min edges for weight 3:", r.ans) // edge 1-3 has weight 3 -> 1 edge
	}
}
```

#### Java

```java
import java.util.*;

public class Race {
    List<int[]>[] adj; // {to, w}
    boolean[] removed;
    int[] size, best;
    int K, ans = Integer.MAX_VALUE;
    List<Integer> touched = new ArrayList<>();

    @SuppressWarnings("unchecked")
    Race(int n, int K) {
        this.K = K;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        removed = new boolean[n];
        size = new int[n];
        best = new int[K + 1];
        Arrays.fill(best, Integer.MAX_VALUE);
    }
    void addEdge(int u, int v, int w) { adj[u].add(new int[]{v, w}); adj[v].add(new int[]{u, w}); }
    int cs(int u, int p) { size[u] = 1; for (int[] e : adj[u]) if (e[0] != p && !removed[e[0]]) size[u] += cs(e[0], u); return size[u]; }
    int fc(int u, int p, int n) { for (int[] e : adj[u]) if (e[0] != p && !removed[e[0]] && size[e[0]] > n / 2) return fc(e[0], u, n); return u; }
    void walk(int u, int p, int w, int e, boolean query) {
        if (w > K) return;
        if (query) {
            if (best[K - w] != Integer.MAX_VALUE) ans = Math.min(ans, e + best[K - w]);
        } else {
            if (e < best[w]) { best[w] = e; touched.add(w); }
        }
        for (int[] ed : adj[u]) if (ed[0] != p && !removed[ed[0]]) walk(ed[0], u, w + ed[1], e + 1, query);
    }
    void dec(int entry) {
        int n = cs(entry, -1);
        int c = fc(entry, -1, n);
        removed[c] = true;
        best[0] = 0; touched.add(0);
        for (int[] ed : adj[c]) if (!removed[ed[0]]) { walk(ed[0], c, ed[1], 1, true); walk(ed[0], c, ed[1], 1, false); }
        for (int w : touched) best[w] = Integer.MAX_VALUE;
        touched.clear();
        for (int[] ed : adj[c]) if (!removed[ed[0]]) dec(ed[0]);
    }

    public static void main(String[] args) {
        Race r = new Race(4, 3);
        r.addEdge(0,1,1); r.addEdge(1,2,2); r.addEdge(1,3,3);
        r.dec(0);
        System.out.println(r.ans == Integer.MAX_VALUE ? -1 : "min edges for weight 3: " + r.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)
INF = 1 << 30


class Race:
    def __init__(self, n, K):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.K = K
        self.best = [INF] * (K + 1)
        self.touched = []
        self.ans = INF

    def add_edge(self, u, v, w):
        self.adj[u].append((v, w))
        self.adj[v].append((u, w))

    def cs(self, u, p):
        self.size[u] = 1
        for v, _ in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v, _ in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def walk(self, u, p, w, e, query):
        if w > self.K:
            return
        if query:
            if self.best[self.K - w] < INF:
                self.ans = min(self.ans, e + self.best[self.K - w])
        else:
            if e < self.best[w]:
                self.best[w] = e
                self.touched.append(w)
        for v, ww in self.adj[u]:
            if v != p and not self.removed[v]:
                self.walk(v, u, w + ww, e + 1, query)

    def dec(self, entry):
        n = self.cs(entry, -1)
        c = self.fc(entry, -1, n)
        self.removed[c] = True
        self.best[0] = 0
        self.touched.append(0)
        for v, w in self.adj[c]:
            if not self.removed[v]:
                self.walk(v, c, w, 1, True)
                self.walk(v, c, w, 1, False)
        for w in self.touched:
            self.best[w] = INF
        self.touched.clear()
        for v, _ in self.adj[c]:
            if not self.removed[v]:
                self.dec(v)


r = Race(4, 3)
for u, v, w in [(0, 1, 1), (1, 2, 2), (1, 3, 3)]:
    r.add_edge(u, v, w)
r.dec(0)
print(-1 if r.ans == INF else f"min edges for weight 3: {r.ans}")
```

---

### A4 — Count vertices within radius R of each node (static)

**Statement.** For every vertex `x`, output the number of vertices within distance `R` (including `x`).

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Per centroid, store a sorted list of distances of all component vertices, plus a per-branch sorted list.
- For query at `x`: over ancestors `c`, add `count(dist(c,·) ≤ R − dist(x,c))` from the full list, subtract the same from the branch containing `x`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type CT struct {
	adj      [][]int
	removed  []bool
	size     []int
	cpar     []int
	full     [][]int // per centroid: sorted distances of all comp vertices
	// for each vertex x and ancestor index: dist and branch sorted list reference
	ancC     [][]int // ancestor centroids of x
	ancD     [][]int // dist(x, ancestor)
	branch   [][][]int // per centroid: list of sorted-branch arrays; we store branch id per vertex
	ancB     [][][]int // for x: reference to its branch sorted array at each ancestor
}

func (c *CT) cs(u, p int) int {
	c.size[u] = 1
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] {
			c.size[u] += c.cs(v, u)
		}
	}
	return c.size[u]
}
func (c *CT) fc(u, p, n int) int {
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] && c.size[v] > n/2 {
			return c.fc(v, u, n)
		}
	}
	return u
}
func (c *CT) collect(u, p, d, cen int, arr *[]int, perVertex map[int]int) {
	*arr = append(*arr, d)
	c.ancC[u] = append(c.ancC[u], cen)
	c.ancD[u] = append(c.ancD[u], d)
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] {
			c.collect(v, u, d+1, cen, arr, perVertex)
		}
	}
}
func (c *CT) dec(entry, par int) int {
	n := c.cs(entry, -1)
	cen := c.fc(entry, -1, n)
	c.removed[cen] = true
	c.cpar[cen] = par
	full := []int{0}
	// record centroid's own distance 0 to itself
	c.ancC[cen] = append(c.ancC[cen], cen)
	c.ancD[cen] = append(c.ancD[cen], 0)
	for _, v := range c.adj[cen] {
		if !c.removed[v] {
			branch := []int{}
			c.collect(v, cen, 1, cen, &branch, nil)
			full = append(full, branch...)
			sort.Ints(branch)
			c.branch[cen] = append(c.branch[cen], branch)
		}
	}
	sort.Ints(full)
	c.full[cen] = full
	for _, v := range c.adj[cen] {
		if !c.removed[v] {
			c.dec(v, cen)
		}
	}
	return cen
}

func countLeqVal(a []int, x int) int {
	return sort.SearchInts(a, x+1)
}

func main() {
	// Demonstrates the FULL-list contribution (branch subtraction omitted for brevity;
	// a complete solution also subtracts the same-branch over-count).
	N, R := 5, 2
	c := &CT{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N),
		cpar: make([]int, N), full: make([][]int, N),
		ancC: make([][]int, N), ancD: make([][]int, N), branch: make([][][]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}} {
		c.adj[e[0]] = append(c.adj[e[0]], e[1])
		c.adj[e[1]] = append(c.adj[e[1]], e[0])
	}
	c.dec(0, -1)
	for x := 0; x < N; x++ {
		cnt := 0
		for i, cen := range c.ancC[x] {
			d := c.ancD[x][i]
			if R-d >= 0 {
				cnt += countLeqVal(c.full[cen], R-d)
			}
		}
		fmt.Printf("approx within R of %d (incl over-count): %d\n", x, cnt)
	}
}
```

> Note: the Go version above shows the full-list contribution; a complete solution subtracts, at each ancestor, the count from the branch that contains `x`. The Java/Python versions below include that subtraction.

#### Java

```java
import java.util.*;

public class WithinRadius {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size;
    List<long[]>[] full;       // per centroid: sorted distances (as long for binary search)
    // per vertex x: list of {centroid, dist, branchId}
    List<int[]>[] anc;
    Map<Integer, List<int[]>> branchSorted = new HashMap<>(); // centroid -> list of sorted branch arrays

    @SuppressWarnings("unchecked")
    WithinRadius(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        full = new List[n];
        anc = new List[n];
        for (int i = 0; i < n; i++) { anc[i] = new ArrayList<>(); }
    }
    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
    int cs(int u, int p) { size[u] = 1; for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += cs(v, u); return size[u]; }
    int fc(int u, int p, int n) { for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return fc(v, u, n); return u; }

    void collect(int u, int p, int d, int cen, int branchId, List<Integer> arr) {
        arr.add(d);
        anc[u].add(new int[]{cen, d, branchId});
        for (int v : adj.get(u)) if (v != p && !removed[v]) collect(v, u, d + 1, cen, branchId, arr);
    }

    void dec(int entry) {
        int n = cs(entry, -1);
        int cen = fc(entry, -1, n);
        removed[cen] = true;
        List<Integer> allD = new ArrayList<>(); allD.add(0);
        anc[cen].add(new int[]{cen, 0, -1});
        List<int[]> branches = new ArrayList<>();
        int bid = 0;
        for (int v : adj.get(cen)) if (!removed[v]) {
            List<Integer> br = new ArrayList<>();
            collect(v, cen, 1, cen, bid, br);
            allD.addAll(br);
            int[] arr = br.stream().mapToInt(Integer::intValue).sorted().toArray();
            branches.add(arr);
            bid++;
        }
        int[] fullArr = allD.stream().mapToInt(Integer::intValue).sorted().toArray();
        fullStore(cen, fullArr, branches);
        for (int v : adj.get(cen)) if (!removed[v]) dec(v);
    }

    Map<Integer, int[]> fullArrays = new HashMap<>();
    Map<Integer, List<int[]>> branchArrays = new HashMap<>();
    void fullStore(int cen, int[] f, List<int[]> br) { fullArrays.put(cen, f); branchArrays.put(cen, br); }

    static int countLeq(int[] a, int x) {
        if (x < 0) return 0;
        int lo = 0, hi = a.length;
        while (lo < hi) { int m = (lo + hi) / 2; if (a[m] <= x) lo = m + 1; else hi = m; }
        return lo;
    }

    int query(int x, int R) {
        int cnt = 0;
        for (int[] e : anc[x]) {
            int cen = e[0], d = e[1], bid = e[2];
            cnt += countLeq(fullArrays.get(cen), R - d);
            if (bid >= 0) cnt -= countLeq(branchArrays.get(cen).get(bid), R - d);
        }
        return cnt;
    }

    public static void main(String[] args) {
        WithinRadius s = new WithinRadius(5);
        int[][] e = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.dec(0);
        for (int x = 0; x < 5; x++) System.out.println("within 2 of " + x + ": " + s.query(x, 2));
    }
}
```

#### Python

```python
import sys
from bisect import bisect_right
sys.setrecursionlimit(1 << 20)


class WithinRadius:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.full = {}        # centroid -> sorted distance list
        self.branch = {}      # centroid -> list of sorted branch lists
        self.anc = [[] for _ in range(n)]  # (centroid, dist, branch_id)

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def cs(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def collect(self, u, p, d, cen, bid, arr):
        arr.append(d)
        self.anc[u].append((cen, d, bid))
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.collect(v, u, d + 1, cen, bid, arr)

    def dec(self, entry):
        n = self.cs(entry, -1)
        cen = self.fc(entry, -1, n)
        self.removed[cen] = True
        all_d = [0]
        self.anc[cen].append((cen, 0, -1))
        branches = []
        for bid, v in enumerate(v for v in self.adj[cen] if not self.removed[v]):
            br = []
            self.collect(v, cen, 1, cen, bid, br)
            all_d.extend(br)
            branches.append(sorted(br))
        self.full[cen] = sorted(all_d)
        self.branch[cen] = branches
        for v in self.adj[cen]:
            if not self.removed[v]:
                self.dec(v)

    def query(self, x, R):
        cnt = 0
        for cen, d, bid in self.anc[x]:
            if R - d >= 0:
                cnt += bisect_right(self.full[cen], R - d)
                if bid >= 0:
                    cnt -= bisect_right(self.branch[cen][bid], R - d)
        return cnt


s = WithinRadius(5)
for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
    s.add_edge(u, v)
s.dec(0)
for x in range(5):
    print(f"within 2 of {x}: {s.query(x, 2)}")
```

---

### A5 — Sum of distances over all pairs (decompose-and-aggregate)

**Statement.** Compute `Σ_{u<v} dist(u, v)` over all pairs (unweighted). (There is an `O(N)` rerooting DP for this; here implement it via centroid decomposition to practice the aggregation pattern.)

**Constraints.** `1 ≤ N ≤ 10⁵`.

**Hints.**
- Per centroid, every pair through it contributes `dist(u,c) + dist(v,c)`. Use `(count, sumDist)` running aggregates across branches; subtract same-branch contributions.

#### Go

```go
package main

import "fmt"

type Sol struct {
	adj     [][]int
	removed []bool
	size    []int
	ans     int64
}

func (s *Sol) cs(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.cs(v, u)
		}
	}
	return s.size[u]
}
func (s *Sol) fc(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.fc(v, u, n)
		}
	}
	return u
}
func (s *Sol) gather(u, p, d int, out *[]int) {
	*out = append(*out, d)
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.gather(v, u, d+1, out)
		}
	}
}

// sum over pairs (i<j) of d[i]+d[j] = (len-1) * sum(d)
func pairSum(d []int) int64 {
	var sum int64
	for _, x := range d {
		sum += int64(x)
	}
	return int64(len(d)-1) * sum
}

func (s *Sol) dec(entry int) {
	n := s.cs(entry, -1)
	c := s.fc(entry, -1, n)
	s.removed[c] = true
	all := []int{0}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			var br []int
			s.gather(v, c, 1, &br)
			all = append(all, br...)
			s.ans -= pairSum(br)
		}
	}
	s.ans += pairSum(all)
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.dec(v)
		}
	}
}

func main() {
	N := 5
	s := &Sol{adj: make([][]int, N), removed: make([]bool, N), size: make([]int, N)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}} {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.dec(0)
	fmt.Println("sum of all pairwise distances:", s.ans)
}
```

#### Java

```java
import java.util.*;

public class SumDistances {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size;
    long ans = 0;

    SumDistances(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
    }
    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
    int cs(int u, int p) { size[u] = 1; for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += cs(v, u); return size[u]; }
    int fc(int u, int p, int n) { for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return fc(v, u, n); return u; }
    void gather(int u, int p, int d, List<Integer> out) { out.add(d); for (int v : adj.get(u)) if (v != p && !removed[v]) gather(v, u, d + 1, out); }
    long pairSum(List<Integer> d) {
        long sum = 0; for (int x : d) sum += x;
        return (long)(d.size() - 1) * sum;
    }
    void dec(int entry) {
        int n = cs(entry, -1);
        int c = fc(entry, -1, n);
        removed[c] = true;
        List<Integer> all = new ArrayList<>(); all.add(0);
        for (int v : adj.get(c)) if (!removed[v]) {
            List<Integer> br = new ArrayList<>();
            gather(v, c, 1, br);
            all.addAll(br);
            ans -= pairSum(br);
        }
        ans += pairSum(all);
        for (int v : adj.get(c)) if (!removed[v]) dec(v);
    }

    public static void main(String[] args) {
        SumDistances s = new SumDistances(5);
        int[][] e = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.dec(0);
        System.out.println("sum of all pairwise distances: " + s.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class SumDistances:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.ans = 0

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def cs(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.cs(v, u)
        return self.size[u]

    def fc(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.fc(v, u, n)
        return u

    def gather(self, u, p, d, out):
        out.append(d)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, d + 1, out)

    @staticmethod
    def pair_sum(d):
        return (len(d) - 1) * sum(d)

    def dec(self, entry):
        n = self.cs(entry, -1)
        c = self.fc(entry, -1, n)
        self.removed[c] = True
        all_d = [0]
        for v in self.adj[c]:
            if not self.removed[v]:
                br = []
                self.gather(v, c, 1, br)
                all_d.extend(br)
                self.ans -= self.pair_sum(br)
        self.ans += self.pair_sum(all_d)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.dec(v)


s = SumDistances(5)
for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
    s.add_edge(u, v)
s.dec(0)
print("sum of all pairwise distances:", s.ans)
```

---

## Benchmark Task

**Statement.** Build the centroid tree and count pairs at distance `≤ K` for:
1. a **random tree** of `N = 10⁶`,
2. a **path graph** (line) of `N = 10⁶` — the recursion-depth stress case,
3. a **star graph** of `N = 10⁶` — the wide fan-out case.

Measure build time and total query time. Verify the centroid-tree height is `≤ ⌊log₂ N⌋ + 1 ≈ 21` in every case.

**Constraints.** `N` up to `10⁶`; you must avoid `O(N)` native recursion depth on the path graph.

**Hints.**
- Convert `computeSize` and `gather` to **iterative DFS with an explicit stack** to survive the path graph.
- Reuse buffers; avoid per-centroid allocations in hot loops.
- For the path graph, confirm the height stays logarithmic — if it explodes, you have a stale-size bug.
- Expected: build `O(N log N)` should run in a few seconds in Go/Java for `N = 10⁶`; Python will need PyPy or iterative DFS plus careful buffer reuse.

**Measurement skeleton (Go):**

```go
package main

import (
	"fmt"
	"math/bits"
	"time"
)

func buildLine(n int) [][]int {
	adj := make([][]int, n)
	for i := 0; i+1 < n; i++ {
		adj[i] = append(adj[i], i+1)
		adj[i+1] = append(adj[i+1], i)
	}
	return adj
}

func main() {
	n := 1 << 20 // ~10^6
	adj := buildLine(n)
	start := time.Now()
	// Run your iterative-DFS centroid decomposition + count here; record height.
	_ = adj
	fmt.Printf("expected max height <= %d\n", bits.Len(uint(n))) // ~21
	fmt.Println("elapsed:", time.Since(start))
}
```

**Measurement skeleton (Java):**

```java
public class Benchmark {
    public static void main(String[] args) {
        int n = 1 << 20;
        long start = System.nanoTime();
        // Build line graph + iterative-DFS centroid decomposition; record height.
        int expectedMaxHeight = 32 - Integer.numberOfLeadingZeros(n); // ~21
        System.out.println("expected max height <= " + expectedMaxHeight);
        System.out.println("elapsed ms: " + (System.nanoTime() - start) / 1_000_000);
    }
}
```

**Measurement skeleton (Python):**

```python
import time

n = 1 << 20  # ~10^6
start = time.perf_counter()
# Build line graph + iterative-DFS centroid decomposition; record height.
expected_max_height = n.bit_length()  # ~21
print("expected max height <=", expected_max_height)
print("elapsed s:", time.perf_counter() - start)
```

**What to report:** build time and query time for each of the three shapes, peak memory, and the observed maximum centroid-tree height (must be `≤ ⌊log₂ N⌋ + 1`). A height far above `21` on any shape is a definitive signal of a stale-size or `removed[]` bug.
