# Union by Rank — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a full reference solution in all three languages.
> Unless stated otherwise, use union by rank (or union by size) plus path compression.

---

## Beginner Tasks (5)

### Task 1 — Implement union by rank from scratch

**Problem.** Build a DSU supporting `find` and `union` using **union by rank** (no path compression yet). After every union, the tie-break must be applied correctly.

**Constraints.** `1 ≤ n ≤ 10⁵`; `1 ≤ operations ≤ 10⁵`; rank starts at 0.

**Hints.**
- Compare `rank[find(a)]` vs `rank[find(b)]`, never `rank[a]` vs `rank[b]`.
- Increment rank **only** when the two roots' ranks are equal.

**Go.**

```go
package main

import "fmt"

type DSU struct {
	parent []int
	rank   []int
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), rank: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
}

func main() {
	d := NewDSU(5)
	d.Union(0, 1)
	d.Union(2, 3)
	d.Union(0, 2)
	fmt.Println(d.Find(1) == d.Find(3)) // true
	fmt.Println(d.rank[d.Find(0)])      // 2
}
```

**Java.**

```java
public class Task1 {
    static int[] parent, rank;

    static void init(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    static int find(int x) {
        while (parent[x] != x) x = parent[x];
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    public static void main(String[] args) {
        init(5);
        union(0, 1);
        union(2, 3);
        union(0, 2);
        System.out.println(find(1) == find(3)); // true
        System.out.println(rank[find(0)]);       // 2
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


if __name__ == "__main__":
    d = DSU(5)
    d.union(0, 1)
    d.union(2, 3)
    d.union(0, 2)
    print(d.find(1) == d.find(3))   # True
    print(d.rank[d.find(0)])        # 2
```

**Evaluation.** Height stays `≤ log₂ n`; rank bumps only on ties; `find(a)==find(b)` is correct after every sequence.

---

### Task 2 — Implement union by size with component sizes

**Problem.** Build a DSU using **union by size**. Expose `componentSize(x)` returning the number of elements in `x`'s set.

**Constraints.** `1 ≤ n ≤ 10⁶`; sizes start at 1.

**Hints.**
- Attach the smaller-size root under the larger; add sizes.
- `componentSize(x) = size[find(x)]`.

**Go.**

```go
package main

import "fmt"

type DSU struct {
	parent, size []int
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), size: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
		d.size[i] = 1
	}
	return d
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return
	}
	if d.size[ra] < d.size[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	d.size[ra] += d.size[rb]
}

func (d *DSU) ComponentSize(x int) int { return d.size[d.Find(x)] }

func main() {
	d := NewDSU(6)
	d.Union(0, 1)
	d.Union(1, 2)
	d.Union(3, 4)
	fmt.Println(d.ComponentSize(0)) // 3
	fmt.Println(d.ComponentSize(3)) // 2
	fmt.Println(d.ComponentSize(5)) // 1
}
```

**Java.**

```java
public class Task2 {
    static int[] parent, size;

    static void init(int n) {
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    }

    static int find(int x) {
        while (parent[x] != x) x = parent[x];
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        size[ra] += size[rb];
    }

    static int componentSize(int x) { return size[find(x)]; }

    public static void main(String[] args) {
        init(6);
        union(0, 1);
        union(1, 2);
        union(3, 4);
        System.out.println(componentSize(0)); // 3
        System.out.println(componentSize(3)); // 2
        System.out.println(componentSize(5)); // 1
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, x):
        while self.parent[x] != x:
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]

    def component_size(self, x):
        return self.size[self.find(x)]


if __name__ == "__main__":
    d = DSU(6)
    d.union(0, 1)
    d.union(1, 2)
    d.union(3, 4)
    print(d.component_size(0))  # 3
    print(d.component_size(3))  # 2
    print(d.component_size(5))  # 1
```

**Evaluation.** Sizes always sum correctly; `componentSize` reads only via `find`.

---

### Task 3 — Count connected components

**Problem.** Given `n` nodes and a list of undirected edges, return the number of connected components.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ edges ≤ 2×10⁵`.

**Hints.** Start a counter at `n`; decrement on each union that actually merges two different sets.

**Go.**

```go
package main

import "fmt"

func countComponents(n int, edges [][2]int) int {
	d := NewDSU(n) // union by size, from Task 2
	comp := n
	for _, e := range edges {
		if d.Find(e[0]) != d.Find(e[1]) {
			d.Union(e[0], e[1])
			comp--
		}
	}
	return comp
}

func main() {
	fmt.Println(countComponents(5, [][2]int{{0, 1}, {1, 2}, {3, 4}})) // 2
}
```

**Java.**

```java
public class Task3 {
    public static void main(String[] args) {
        Task2.init(5);
        int[][] edges = {{0, 1}, {1, 2}, {3, 4}};
        int comp = 5;
        for (int[] e : edges)
            if (Task2.find(e[0]) != Task2.find(e[1])) { Task2.union(e[0], e[1]); comp--; }
        System.out.println(comp); // 2
    }
}
```

**Python.**

```python
def count_components(n, edges):
    d = DSU(n)  # union by size, from Task 2
    comp = n
    for u, v in edges:
        if d.find(u) != d.find(v):
            d.union(u, v)
            comp -= 1
    return comp


if __name__ == "__main__":
    print(count_components(5, [(0, 1), (1, 2), (3, 4)]))  # 2
```

**Evaluation.** Counter never decrements on a no-op union; correct for isolated nodes.

---

### Task 4 — Detect a cycle in an undirected graph

**Problem.** Given `n` nodes and undirected edges, return `true` if the graph contains a cycle.

**Constraints.** `1 ≤ n ≤ 10⁵`, no self-loops in input.

**Hints.** For each edge `(u,v)`: if `find(u) == find(v)` before unioning, it closes a cycle.

**Go.**

```go
package main

import "fmt"

func hasCycle(n int, edges [][2]int) bool {
	d := NewDSU(n) // from Task 1 (rank) or Task 2 (size)
	for _, e := range edges {
		if d.Find(e[0]) == d.Find(e[1]) {
			return true
		}
		d.Union(e[0], e[1])
	}
	return false
}

func main() {
	fmt.Println(hasCycle(3, [][2]int{{0, 1}, {1, 2}, {2, 0}})) // true
	fmt.Println(hasCycle(3, [][2]int{{0, 1}, {1, 2}}))         // false
}
```

**Java.**

```java
public class Task4 {
    static boolean hasCycle(int n, int[][] edges) {
        Task1.init(n);
        for (int[] e : edges) {
            if (Task1.find(e[0]) == Task1.find(e[1])) return true;
            Task1.union(e[0], e[1]);
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(hasCycle(3, new int[][]{{0, 1}, {1, 2}, {2, 0}})); // true
        System.out.println(hasCycle(3, new int[][]{{0, 1}, {1, 2}}));         // false
    }
}
```

**Python.**

```python
def has_cycle(n, edges):
    d = DSU(n)  # from Task 1 or 2
    for u, v in edges:
        if d.find(u) == d.find(v):
            return True
        d.union(u, v)
    return False


if __name__ == "__main__":
    print(has_cycle(3, [(0, 1), (1, 2), (2, 0)]))  # True
    print(has_cycle(3, [(0, 1), (1, 2)]))          # False
```

**Evaluation.** Detects the first cycle-closing edge; handles forests (no cycle).

---

### Task 5 — Track rank vs height empirically

**Problem.** Build a DSU by union by rank **with** path compression. After a sequence of unions and finds, report for each root its stored `rank` and its *actual* tree height, demonstrating that rank is an **upper bound** (rank ≥ height), and that compression can make rank strictly greater.

**Constraints.** `1 ≤ n ≤ 10⁴`.

**Hints.**
- Compute actual height by, for each node, counting parent hops to the root and taking the max within each tree.
- After compression, some root will have `rank > actualHeight`.

**Go.**

```go
package main

import "fmt"

func main() {
	d := NewDSURank(8) // rank + compression DSU (see below)
	for _, e := range [][2]int{{0, 1}, {2, 3}, {0, 2}, {4, 5}, {6, 7}, {4, 6}, {0, 4}} {
		d.Union(e[0], e[1])
	}
	for i := 0; i < 8; i++ {
		d.Find(i) // trigger compression
	}
	root := d.Find(0)
	height := 0
	for i := 0; i < 8; i++ {
		h, x := 0, i
		for d.parent[x] != x {
			x = d.parent[x]
			h++
		}
		if x == root && h > height {
			height = h
		}
	}
	fmt.Printf("rank=%d actualHeight=%d (rank >= height holds)\n", d.rank[root], height)
}
```

```go
// rank + compression DSU
type DSURank struct{ parent, rank []int }

func NewDSURank(n int) *DSURank {
	d := &DSURank{parent: make([]int, n), rank: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}
func (d *DSURank) Find(x int) int {
	root := x
	for d.parent[root] != root {
		root = d.parent[root]
	}
	for d.parent[x] != root {
		d.parent[x], x = root, d.parent[x]
	}
	return root
}
func (d *DSURank) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
}
```

**Java.**

```java
public class Task5 {
    static int[] parent, rank;

    static void init(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    static int find(int x) {
        int root = x;
        while (parent[root] != root) root = parent[root];
        while (parent[x] != root) { int nx = parent[x]; parent[x] = root; x = nx; }
        return root;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    public static void main(String[] args) {
        init(8);
        int[][] e = {{0, 1}, {2, 3}, {0, 2}, {4, 5}, {6, 7}, {4, 6}, {0, 4}};
        for (int[] ed : e) union(ed[0], ed[1]);
        for (int i = 0; i < 8; i++) find(i);
        int root = find(0), height = 0;
        for (int i = 0; i < 8; i++) {
            int h = 0, x = i;
            while (parent[x] != x) { x = parent[x]; h++; }
            if (x == root) height = Math.max(height, h);
        }
        System.out.printf("rank=%d actualHeight=%d (rank >= height)%n", rank[root], height);
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


if __name__ == "__main__":
    d = DSU(8)
    for u, v in [(0, 1), (2, 3), (0, 2), (4, 5), (6, 7), (4, 6), (0, 4)]:
        d.union(u, v)
    for i in range(8):
        d.find(i)
    root = d.find(0)
    height = 0
    for i in range(8):
        h, x = 0, i
        while d.parent[x] != x:
            x = d.parent[x]
            h += 1
        if x == root:
            height = max(height, h)
    print(f"rank={d.rank[root]} actualHeight={height} (rank >= height)")
```

**Evaluation.** Output shows `rank >= height`; after compression, `rank > height` for the merged root.

---

## Intermediate Tasks (5)

### Task 6 — Kruskal's Minimum Spanning Tree

**Problem.** Given a weighted undirected graph, compute the total weight of its MST using Kruskal + DSU. Assume the graph is connected.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ m ≤ 5×10⁵`, weights fit in 32 bits.

**Hints.** Sort edges by weight; add an edge iff its endpoints are in different sets; stop after `n−1` edges.

**Go.**

```go
package main

import (
	"fmt"
	"sort"
)

func kruskal(n int, edges [][3]int) int64 {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	d := NewDSU(n) // union by size (Task 2)
	var total int64
	used := 0
	for _, e := range edges {
		if d.Find(e[0]) != d.Find(e[1]) {
			d.Union(e[0], e[1])
			total += int64(e[2])
			if used++; used == n-1 {
				break
			}
		}
	}
	return total
}

func main() {
	edges := [][3]int{{0, 1, 1}, {1, 2, 2}, {0, 2, 2}, {2, 3, 3}}
	fmt.Println(kruskal(4, edges)) // 6
}
```

**Java.**

```java
import java.util.*;

public class Task6 {
    static long kruskal(int n, int[][] edges) {
        Arrays.sort(edges, (a, b) -> Integer.compare(a[2], b[2]));
        Task2.init(n);
        long total = 0;
        int used = 0;
        for (int[] e : edges) {
            if (Task2.find(e[0]) != Task2.find(e[1])) {
                Task2.union(e[0], e[1]);
                total += e[2];
                if (++used == n - 1) break;
            }
        }
        return total;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 1}, {1, 2, 2}, {0, 2, 2}, {2, 3, 3}};
        System.out.println(kruskal(4, edges)); // 6
    }
}
```

**Python.**

```python
def kruskal(n, edges):
    edges.sort(key=lambda e: e[2])
    d = DSU(n)  # union by size, Task 2
    total, used = 0, 0
    for u, v, w in edges:
        if d.find(u) != d.find(v):
            d.union(u, v)
            total += w
            used += 1
            if used == n - 1:
                break
    return total


if __name__ == "__main__":
    print(kruskal(4, [(0, 1, 1), (1, 2, 2), (0, 2, 2), (2, 3, 3)]))  # 6
```

**Evaluation.** Total matches a reference Prim's; early-exit after `n−1` edges.

---

### Task 7 — Redundant Connection

**Problem.** A tree with `n` nodes had one extra edge added (forming exactly one cycle). Given the edge list, return the **last** edge that can be removed so the result is a tree.

**Constraints.** `3 ≤ n ≤ 1000`; nodes labeled `1..n`.

**Hints.** The first edge whose two endpoints already share a root is the redundant one.

**Go.**

```go
package main

import "fmt"

func findRedundant(edges [][2]int) [2]int {
	d := NewDSU(len(edges) + 1) // 1-indexed
	for _, e := range edges {
		if d.Find(e[0]) == d.Find(e[1]) {
			return e
		}
		d.Union(e[0], e[1])
	}
	return [2]int{}
}

func main() {
	fmt.Println(findRedundant([][2]int{{1, 2}, {1, 3}, {2, 3}})) // [2 3]
}
```

**Java.**

```java
public class Task7 {
    static int[] findRedundant(int[][] edges) {
        Task1.init(edges.length + 1);
        for (int[] e : edges) {
            if (Task1.find(e[0]) == Task1.find(e[1])) return e;
            Task1.union(e[0], e[1]);
        }
        return new int[0];
    }

    public static void main(String[] args) {
        int[] r = findRedundant(new int[][]{{1, 2}, {1, 3}, {2, 3}});
        System.out.println(r[0] + " " + r[1]); // 2 3
    }
}
```

**Python.**

```python
def find_redundant(edges):
    d = DSU(len(edges) + 1)  # 1-indexed
    for u, v in edges:
        if d.find(u) == d.find(v):
            return [u, v]
        d.union(u, v)
    return []


if __name__ == "__main__":
    print(find_redundant([(1, 2), (1, 3), (2, 3)]))  # [2, 3]
```

**Evaluation.** Returns the cycle-closing edge; matches LeetCode 684.

---

### Task 8 — Largest component size online

**Problem.** Process a stream of unions. After each union, output the current size of the largest connected component.

**Constraints.** `1 ≤ n ≤ 10⁶`, `1 ≤ unions ≤ 10⁶`.

**Hints.** Use union by size; keep a running `best` and update it with the surviving root's new size.

**Go.**

```go
package main

import "fmt"

func largestOnline(n int, ops [][2]int) []int {
	d := NewDSU(n) // union by size, Task 2
	best := 1
	res := make([]int, 0, len(ops))
	for _, e := range ops {
		ra, rb := d.Find(e[0]), d.Find(e[1])
		if ra != rb {
			d.Union(ra, rb)
			if s := d.size[d.Find(ra)]; s > best {
				best = s
			}
		}
		res = append(res, best)
	}
	return res
}

func main() {
	fmt.Println(largestOnline(5, [][2]int{{0, 1}, {2, 3}, {1, 2}})) // [2 2 4]
}
```

**Java.**

```java
import java.util.*;

public class Task8 {
    static int[] largestOnline(int n, int[][] ops) {
        Task2.init(n);
        int best = 1;
        int[] res = new int[ops.length];
        for (int i = 0; i < ops.length; i++) {
            int ra = Task2.find(ops[i][0]), rb = Task2.find(ops[i][1]);
            if (ra != rb) {
                Task2.union(ra, rb);
                best = Math.max(best, Task2.size[Task2.find(ra)]);
            }
            res[i] = best;
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            largestOnline(5, new int[][]{{0, 1}, {2, 3}, {1, 2}}))); // [2, 2, 4]
    }
}
```

**Python.**

```python
def largest_online(n, ops):
    d = DSU(n)  # union by size, Task 2
    best, res = 1, []
    for u, v in ops:
        ru, rv = d.find(u), d.find(v)
        if ru != rv:
            d.union(ru, rv)
            best = max(best, d.size[d.find(ru)])
        res.append(best)
    return res


if __name__ == "__main__":
    print(largest_online(5, [(0, 1), (2, 3), (1, 2)]))  # [2, 2, 4]
```

**Evaluation.** `best` is monotone non-decreasing and matches a brute recomputation.

---

### Task 9 — Bipartiteness check with parity DSU

**Problem.** Given an undirected graph, determine whether it is bipartite using a **parity DSU** (each edge forces the two endpoints to opposite colors). Report `false` on the first contradiction.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ m ≤ 2×10⁵`.

**Hints.** Store `rel[x]` = parity of `x` to its parent; accumulate during `find`; on union enforce `color(u) xor color(v) = 1`.

**Go.**

```go
package main

import "fmt"

type ParityDSU struct {
	parent, rank, rel []int
}

func NewParity(n int) *ParityDSU {
	d := &ParityDSU{parent: make([]int, n), rank: make([]int, n), rel: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}

// returns (root, parity of x relative to root)
func (d *ParityDSU) Find(x int) (int, int) {
	if d.parent[x] == x {
		return x, 0
	}
	root, p := d.Find(d.parent[x])
	d.rel[x] ^= p
	d.parent[x] = root
	return root, d.rel[x]
}

func (d *ParityDSU) Union(a, b int) bool { // demand color(a) != color(b)
	ra, pa := d.Find(a)
	rb, pb := d.Find(b)
	if ra == rb {
		return (pa ^ pb) == 1
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb, pa, pb = rb, ra, pb, pa
	}
	d.parent[rb] = ra
	d.rel[rb] = pa ^ pb ^ 1
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
	return true
}

func isBipartite(n int, edges [][2]int) bool {
	d := NewParity(n)
	for _, e := range edges {
		if !d.Union(e[0], e[1]) {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isBipartite(4, [][2]int{{0, 1}, {1, 2}, {2, 3}}))         // true
	fmt.Println(isBipartite(3, [][2]int{{0, 1}, {1, 2}, {2, 0}}))         // false (odd cycle)
}
```

**Java.**

```java
public class Task9 {
    static int[] parent, rank, rel;

    static void init(int n) {
        parent = new int[n];
        rank = new int[n];
        rel = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    // returns parity of x to root; root stored in find via parent chain
    static int find(int x) {
        if (parent[x] == x) return x;
        int root = find(parent[x]);
        rel[x] ^= rel[parent[x]] == x ? 0 : 0; // placeholder; see iterative note
        parent[x] = root;
        return root;
    }

    // cleaner: compute parity explicitly
    static int[] findP(int x) {
        if (parent[x] == x) return new int[]{x, 0};
        int[] r = findP(parent[x]);
        rel[x] ^= r[1];
        parent[x] = r[0];
        return new int[]{r[0], rel[x]};
    }

    static boolean union(int a, int b) {
        int[] A = findP(a), B = findP(b);
        int ra = A[0], pa = A[1], rb = B[0], pb = B[1];
        if (ra == rb) return (pa ^ pb) == 1;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; int p = pa; pa = pb; pb = p; }
        parent[rb] = ra;
        rel[rb] = pa ^ pb ^ 1;
        if (rank[ra] == rank[rb]) rank[ra]++;
        return true;
    }

    static boolean isBipartite(int n, int[][] edges) {
        init(n);
        for (int[] e : edges) if (!union(e[0], e[1])) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isBipartite(4, new int[][]{{0, 1}, {1, 2}, {2, 3}})); // true
        System.out.println(isBipartite(3, new int[][]{{0, 1}, {1, 2}, {2, 0}})); // false
    }
}
```

**Python.**

```python
import sys


class ParityDSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.rel = [0] * n

    def find(self, x):
        if self.parent[x] == x:
            return x, 0
        root, p = self.find(self.parent[x])
        self.rel[x] ^= p
        self.parent[x] = root
        return root, self.rel[x]

    def union(self, a, b):  # demand different colors
        ra, pa = self.find(a)
        rb, pb = self.find(b)
        if ra == rb:
            return (pa ^ pb) == 1
        if self.rank[ra] < self.rank[rb]:
            ra, rb, pa, pb = rb, ra, pb, pa
        self.parent[rb] = ra
        self.rel[rb] = pa ^ pb ^ 1
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True


def is_bipartite(n, edges):
    d = ParityDSU(n)
    return all(d.union(u, v) for u, v in edges)


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 25)
    print(is_bipartite(4, [(0, 1), (1, 2), (2, 3)]))   # True
    print(is_bipartite(3, [(0, 1), (1, 2), (2, 0)]))   # False
```

**Evaluation.** Returns `false` exactly on graphs with an odd cycle; balancing logic identical to plain union by rank.

---

### Task 10 — Number of Islands II (online)

**Problem.** On an `m×n` grid initially all water, process a list of `addLand(r, c)` operations. After each, report the current number of islands (4-directionally connected land cells).

**Constraints.** `1 ≤ m, n ≤ 1000`, up to `10⁴` operations.

**Hints.** Map `(r,c) → r*n + c`. On `addLand`, increment the island count, then union with each already-land neighbor (decrement on each real merge).

**Go.**

```go
package main

import "fmt"

func numIslands2(m, n int, ops [][2]int) []int {
	d := NewDSU(m * n) // union by size, Task 2
	land := make([]bool, m*n)
	count := 0
	res := make([]int, 0, len(ops))
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for _, op := range ops {
		r, c := op[0], op[1]
		id := r*n + c
		if !land[id] {
			land[id] = true
			count++
			for _, dd := range dirs {
				nr, nc := r+dd[0], c+dd[1]
				if nr >= 0 && nr < m && nc >= 0 && nc < n && land[nr*n+nc] {
					if d.Find(id) != d.Find(nr*n+nc) {
						d.Union(id, nr*n+nc)
						count--
					}
				}
			}
		}
		res = append(res, count)
	}
	return res
}

func main() {
	fmt.Println(numIslands2(3, 3, [][2]int{{0, 0}, {0, 1}, {1, 2}, {2, 1}})) // [1 1 2 3]
}
```

**Java.**

```java
import java.util.*;

public class Task10 {
    static int[] numIslands2(int m, int n, int[][] ops) {
        Task2.init(m * n);
        boolean[] land = new boolean[m * n];
        int count = 0;
        int[] res = new int[ops.length];
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        for (int i = 0; i < ops.length; i++) {
            int r = ops[i][0], c = ops[i][1], id = r * n + c;
            if (!land[id]) {
                land[id] = true;
                count++;
                for (int[] dd : dirs) {
                    int nr = r + dd[0], nc = c + dd[1];
                    if (nr >= 0 && nr < m && nc >= 0 && nc < n && land[nr * n + nc]
                        && Task2.find(id) != Task2.find(nr * n + nc)) {
                        Task2.union(id, nr * n + nc);
                        count--;
                    }
                }
            }
            res[i] = count;
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            numIslands2(3, 3, new int[][]{{0, 0}, {0, 1}, {1, 2}, {2, 1}}))); // [1, 1, 2, 3]
    }
}
```

**Python.**

```python
def num_islands2(m, n, ops):
    d = DSU(m * n)  # union by size, Task 2
    land = [False] * (m * n)
    count, res = 0, []
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    for r, c in ops:
        idx = r * n + c
        if not land[idx]:
            land[idx] = True
            count += 1
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < m and 0 <= nc < n and land[nr * n + nc]:
                    if d.find(idx) != d.find(nr * n + nc):
                        d.union(idx, nr * n + nc)
                        count -= 1
        res.append(count)
    return res


if __name__ == "__main__":
    print(num_islands2(3, 3, [(0, 0), (0, 1), (1, 2), (2, 1)]))  # [1, 1, 2, 3]
```

**Evaluation.** Count matches a brute BFS recomputation after each op; duplicate `addLand` is a no-op.

---

## Advanced Tasks (5)

### Task 11 — DSU with rollback (no compression)

**Problem.** Implement a DSU with union by size **without** path compression, supporting `rollback()` to undo the most recent union (including no-op unions).

**Constraints.** `1 ≤ n ≤ 10⁵`; up to `10⁵` unions/rollbacks interleaved.

**Hints.** Push `(child, parentRoot, oldSize)` (or a no-op marker) on each union; `rollback` pops and restores.

**Go.**

```go
package main

import "fmt"

type RollbackDSU struct {
	parent, size []int
	history      [][3]int // (child, parent, oldSize); child==-1 marks a no-op
}

func NewRollback(n int) *RollbackDSU {
	d := &RollbackDSU{parent: make([]int, n), size: make([]int, n)}
	for i := range d.parent {
		d.parent[i] = i
		d.size[i] = 1
	}
	return d
}

func (d *RollbackDSU) Find(x int) int {
	for d.parent[x] != x {
		x = d.parent[x]
	}
	return x
}

func (d *RollbackDSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		d.history = append(d.history, [3]int{-1, 0, 0})
		return false
	}
	if d.size[ra] < d.size[rb] {
		ra, rb = rb, ra
	}
	d.history = append(d.history, [3]int{rb, ra, d.size[ra]})
	d.parent[rb] = ra
	d.size[ra] += d.size[rb]
	return true
}

func (d *RollbackDSU) Rollback() {
	rec := d.history[len(d.history)-1]
	d.history = d.history[:len(d.history)-1]
	if rec[0] == -1 {
		return
	}
	child, par, old := rec[0], rec[1], rec[2]
	d.parent[child] = child
	d.size[par] = old
}

func main() {
	d := NewRollback(4)
	d.Union(0, 1)
	d.Union(2, 3)
	d.Union(0, 2)
	fmt.Println(d.Find(1) == d.Find(3)) // true
	d.Rollback()
	fmt.Println(d.Find(1) == d.Find(3)) // false
}
```

**Java.**

```java
import java.util.*;

public class Task11 {
    static int[] parent, size;
    static Deque<int[]> history = new ArrayDeque<>();

    static void init(int n) {
        parent = new int[n];
        size = new int[n];
        history.clear();
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    }

    static int find(int x) {
        while (parent[x] != x) x = parent[x];
        return x;
    }

    static boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) { history.push(new int[]{-1, 0, 0}); return false; }
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        history.push(new int[]{rb, ra, size[ra]});
        parent[rb] = ra;
        size[ra] += size[rb];
        return true;
    }

    static void rollback() {
        int[] rec = history.pop();
        if (rec[0] == -1) return;
        parent[rec[0]] = rec[0];
        size[rec[1]] = rec[2];
    }

    public static void main(String[] args) {
        init(4);
        union(0, 1);
        union(2, 3);
        union(0, 2);
        System.out.println(find(1) == find(3)); // true
        rollback();
        System.out.println(find(1) == find(3)); // false
    }
}
```

**Python.**

```python
class RollbackDSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n
        self.history = []

    def find(self, x):
        while self.parent[x] != x:
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            self.history.append(None)
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.history.append((rb, ra, self.size[ra]))
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True

    def rollback(self):
        rec = self.history.pop()
        if rec is None:
            return
        child, par, old = rec
        self.parent[child] = child
        self.size[par] = old


if __name__ == "__main__":
    d = RollbackDSU(4)
    d.union(0, 1)
    d.union(2, 3)
    d.union(0, 2)
    print(d.find(1) == d.find(3))  # True
    d.rollback()
    print(d.find(1) == d.find(3))  # False
```

**Evaluation.** Every union (including no-ops) is reversible in `O(1)`; height stays `O(log n)`; partition after `rollback` exactly matches the pre-union state.

---

### Task 12 — Percolation threshold (Monte Carlo)

**Problem.** On an `n×n` grid, open sites one at a time in random order. The system **percolates** when some open site in the top row connects to some open site in the bottom row through open neighbors. Estimate the fraction of sites open at percolation, averaged over `T` trials, using union by size with two virtual nodes (a virtual top and a virtual bottom).

**Constraints.** `2 ≤ n ≤ 200`, `1 ≤ T ≤ 100`.

**Hints.** Virtual-top id `= n*n`, virtual-bottom id `= n*n+1`. Open a site → union with open neighbors; top-row sites also union with virtual-top, bottom-row with virtual-bottom. Percolates when `connected(top, bottom)`.

**Go.**

```go
package main

import (
	"fmt"
	"math/rand"
)

func percolationThreshold(n, trials int, seed int64) float64 {
	r := rand.New(rand.NewSource(seed))
	top, bottom := n*n, n*n+1
	var sum float64
	for t := 0; t < trials; t++ {
		d := NewDSU(n*n + 2) // union by size, Task 2
		open := make([]bool, n*n)
		order := r.Perm(n * n)
		count := 0
		for _, id := range order {
			open[id] = true
			count++
			row, col := id/n, id%n
			if row == 0 {
				d.Union(id, top)
			}
			if row == n-1 {
				d.Union(id, bottom)
			}
			for _, dd := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nr, nc := row+dd[0], col+dd[1]
				if nr >= 0 && nr < n && nc >= 0 && nc < n && open[nr*n+nc] {
					d.Union(id, nr*n+nc)
				}
			}
			if d.Find(top) == d.Find(bottom) {
				break
			}
		}
		sum += float64(count) / float64(n*n)
	}
	return sum / float64(trials)
}

func main() {
	fmt.Printf("%.3f\n", percolationThreshold(50, 30, 42)) // ~0.593
}
```

**Java.**

```java
import java.util.*;

public class Task12 {
    static double percolation(int n, int trials, long seed) {
        Random r = new Random(seed);
        int top = n * n, bottom = n * n + 1;
        double sum = 0;
        for (int t = 0; t < trials; t++) {
            Task2.init(n * n + 2);
            boolean[] open = new boolean[n * n];
            Integer[] order = new Integer[n * n];
            for (int i = 0; i < n * n; i++) order[i] = i;
            Collections.shuffle(Arrays.asList(order), r);
            int count = 0;
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int id : order) {
                open[id] = true;
                count++;
                int row = id / n, col = id % n;
                if (row == 0) Task2.union(id, top);
                if (row == n - 1) Task2.union(id, bottom);
                for (int[] dd : dirs) {
                    int nr = row + dd[0], nc = col + dd[1];
                    if (nr >= 0 && nr < n && nc >= 0 && nc < n && open[nr * n + nc])
                        Task2.union(id, nr * n + nc);
                }
                if (Task2.find(top) == Task2.find(bottom)) break;
            }
            sum += (double) count / (n * n);
        }
        return sum / trials;
    }

    public static void main(String[] args) {
        System.out.printf("%.3f%n", percolation(50, 30, 42)); // ~0.593
    }
}
```

**Python.**

```python
import random


def percolation_threshold(n, trials, seed=42):
    rng = random.Random(seed)
    top, bottom = n * n, n * n + 1
    total = 0.0
    for _ in range(trials):
        d = DSU(n * n + 2)  # union by size, Task 2
        open_ = [False] * (n * n)
        order = list(range(n * n))
        rng.shuffle(order)
        count = 0
        for idx in order:
            open_[idx] = True
            count += 1
            row, col = divmod(idx, n)
            if row == 0:
                d.union(idx, top)
            if row == n - 1:
                d.union(idx, bottom)
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = row + dr, col + dc
                if 0 <= nr < n and 0 <= nc < n and open_[nr * n + nc]:
                    d.union(idx, nr * n + nc)
            if d.find(top) == d.find(bottom):
                break
        total += count / (n * n)
    return total / trials


if __name__ == "__main__":
    print(f"{percolation_threshold(50, 30):.3f}")  # ~0.593
```

**Evaluation.** Estimate converges toward the known site-percolation constant ≈ 0.5927 as `n` and `trials` grow. (A subtle "backwash" caveat exists; here a single virtual-bottom is acceptable for the threshold estimate.)

---

### Task 13 — Weighted DSU (offset queries)

**Problem.** Maintain elements with relations `value(a) − value(b) = w`. Support `union(a, b, w)` (add the constraint; report `false` if it contradicts an existing one) and `diff(a, b)` returning `value(a) − value(b)` if `a` and `b` are connected, else `None`.

**Constraints.** `1 ≤ n ≤ 10⁵`, weights fit in 64 bits.

**Hints.** `rel[x]` = `value(x) − value(parent(x))`; accumulate along `find`; on union set the new edge's `rel` so the constraint holds.

**Go.**

```go
package main

import "fmt"

type WeightedDSU struct {
	parent, rank []int
	rel          []int64 // value(x) - value(parent(x))
}

func NewWeighted(n int) *WeightedDSU {
	d := &WeightedDSU{parent: make([]int, n), rank: make([]int, n), rel: make([]int64, n)}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}

// returns (root, value(x) - value(root))
func (d *WeightedDSU) Find(x int) (int, int64) {
	if d.parent[x] == x {
		return x, 0
	}
	root, off := d.Find(d.parent[x])
	d.rel[x] += off
	d.parent[x] = root
	return root, d.rel[x]
}

func (d *WeightedDSU) Union(a, b int, w int64) bool { // value(a) - value(b) = w
	ra, oa := d.Find(a)
	rb, ob := d.Find(b)
	if ra == rb {
		return (oa - ob) == w
	}
	// value(a)=oa+value(ra); value(b)=ob+value(rb); want oa+vra - ob - vrb = w
	if d.rank[ra] < d.rank[rb] {
		// attach ra under rb: value(ra)-value(rb) = w - oa + ob
		d.parent[ra] = rb
		d.rel[ra] = w - oa + ob
	} else {
		d.parent[rb] = ra
		d.rel[rb] = oa - ob - w
		if d.rank[ra] == d.rank[rb] {
			d.rank[ra]++
		}
	}
	return true
}

func (d *WeightedDSU) Diff(a, b int) (int64, bool) {
	ra, oa := d.Find(a)
	rb, ob := d.Find(b)
	if ra != rb {
		return 0, false
	}
	return oa - ob, true
}

func main() {
	d := NewWeighted(5)
	d.Union(0, 1, 3) // v0 - v1 = 3
	d.Union(1, 2, 2) // v1 - v2 = 2
	if v, ok := d.Diff(0, 2); ok {
		fmt.Println(v) // 5
	}
	fmt.Println(d.Union(2, 0, 1)) // false: contradicts v0 - v2 = 5
}
```

**Java.**

```java
public class Task13 {
    static int[] parent, rank;
    static long[] rel;

    static void init(int n) {
        parent = new int[n];
        rank = new int[n];
        rel = new long[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    // returns {root, value(x)-value(root)}
    static long[] find(int x) {
        if (parent[x] == x) return new long[]{x, 0};
        long[] r = find(parent[x]);
        rel[x] += r[1];
        parent[x] = (int) r[0];
        return new long[]{r[0], rel[x]};
    }

    static boolean union(int a, int b, long w) { // value(a)-value(b)=w
        long[] A = find(a), B = find(b);
        int ra = (int) A[0], rb = (int) B[0];
        long oa = A[1], ob = B[1];
        if (ra == rb) return (oa - ob) == w;
        if (rank[ra] < rank[rb]) {
            parent[ra] = rb;
            rel[ra] = w - oa + ob;
        } else {
            parent[rb] = ra;
            rel[rb] = oa - ob - w;
            if (rank[ra] == rank[rb]) rank[ra]++;
        }
        return true;
    }

    static Long diff(int a, int b) {
        long[] A = find(a), B = find(b);
        if (A[0] != B[0]) return null;
        return A[1] - B[1];
    }

    public static void main(String[] args) {
        init(5);
        union(0, 1, 3);
        union(1, 2, 2);
        System.out.println(diff(0, 2));    // 5
        System.out.println(union(2, 0, 1)); // false
    }
}
```

**Python.**

```python
import sys


class WeightedDSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.rel = [0] * n  # value(x) - value(parent(x))

    def find(self, x):
        if self.parent[x] == x:
            return x, 0
        root, off = self.find(self.parent[x])
        self.rel[x] += off
        self.parent[x] = root
        return root, self.rel[x]

    def union(self, a, b, w):  # value(a) - value(b) = w
        ra, oa = self.find(a)
        rb, ob = self.find(b)
        if ra == rb:
            return (oa - ob) == w
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
            self.rel[ra] = w - oa + ob
        else:
            self.parent[rb] = ra
            self.rel[rb] = oa - ob - w
            if self.rank[ra] == self.rank[rb]:
                self.rank[ra] += 1
        return True

    def diff(self, a, b):
        ra, oa = self.find(a)
        rb, ob = self.find(b)
        if ra != rb:
            return None
        return oa - ob


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 25)
    d = WeightedDSU(5)
    d.union(0, 1, 3)
    d.union(1, 2, 2)
    print(d.diff(0, 2))        # 5
    print(d.union(2, 0, 1))    # False
```

**Evaluation.** `diff` matches a reference BFS over the constraint graph; contradictions are rejected; balancing keeps paths short.

---

### Task 14 — Offline dynamic connectivity (union with deletions, divide & conquer)

**Problem.** Process a list of operations: `add(u,v)`, `remove(u,v)` (only of a previously added edge), and `query(u,v)` (are they connected at this moment?). Answer all queries **offline** using a rollback DSU and a segment tree over time.

**Constraints.** `1 ≤ n ≤ 10⁴`, `1 ≤ ops ≤ 10⁴`.

**Hints.** Each edge is "alive" over a time interval; insert it into the segment-tree-on-time nodes covering that interval. DFS the time tree, unioning at each node and rolling back on exit; answer queries at the leaves.

**Go.**

```go
package main

import "fmt"

type Seg struct {
	n    int
	tree [][][2]int // edges alive on each segment node
	d    *RollbackDSU
	ans  []bool
}

func (s *Seg) add(node, l, r, ql, qr int, e [2]int) {
	if qr < l || r < ql {
		return
	}
	if ql <= l && r <= qr {
		s.tree[node] = append(s.tree[node], e)
		return
	}
	m := (l + r) / 2
	s.add(node*2, l, m, ql, qr, e)
	s.add(node*2+1, m+1, r, ql, qr, e)
}

func (s *Seg) dfs(node, l, r int, queries map[int][2]int) {
	applied := 0
	for _, e := range s.tree[node] {
		s.d.Union(e[0], e[1])
		applied++
	}
	if l == r {
		if q, ok := queries[l]; ok {
			s.ans[l] = s.d.Find(q[0]) == s.d.Find(q[1])
		}
	} else {
		m := (l + r) / 2
		s.dfs(node*2, l, m, queries)
		s.dfs(node*2+1, m+1, r, queries)
	}
	for i := 0; i < applied; i++ {
		s.d.Rollback()
	}
}

// ops: each is {kind, u, v} kind 0=add 1=remove 2=query
func solve(n int, ops [][3]int) []bool {
	T := len(ops)
	seg := &Seg{n: n, tree: make([][][2]int, 4*T), d: NewRollback(n), ans: make([]bool, T)}
	type span struct{ start int }
	alive := map[[2]int]int{}
	queries := map[int][2]int{}
	hasQuery := make([]bool, T)
	for t, op := range ops {
		key := [2]int{op[1], op[2]}
		switch op[0] {
		case 0:
			alive[key] = t
		case 1:
			seg.add(1, 0, T-1, alive[key], t-1, key)
			delete(alive, key)
		case 2:
			queries[t] = key
			hasQuery[t] = true
		}
	}
	for key, start := range alive { // edges never removed: alive till the end
		seg.add(1, 0, T-1, start, T-1, key)
	}
	seg.dfs(1, 0, T-1, queries)
	res := []bool{}
	for t := 0; t < T; t++ {
		if hasQuery[t] {
			res = append(res, seg.ans[t])
		}
	}
	return res
}

func main() {
	ops := [][3]int{
		{0, 0, 1}, // add(0,1)
		{2, 0, 1}, // query -> true
		{1, 0, 1}, // remove(0,1)
		{2, 0, 1}, // query -> false
	}
	fmt.Println(solve(2, ops)) // [true false]
}
```

**Java.**

```java
import java.util.*;

public class Task14 {
    static int n, T;
    static List<int[]>[] tree;
    static boolean[] ans;
    static Map<Integer, int[]> queries;

    static void add(int node, int l, int r, int ql, int qr, int[] e) {
        if (qr < l || r < ql) return;
        if (ql <= l && r <= qr) { tree[node].add(e); return; }
        int m = (l + r) / 2;
        add(node * 2, l, m, ql, qr, e);
        add(node * 2 + 1, m + 1, r, ql, qr, e);
    }

    static void dfs(int node, int l, int r) {
        int applied = 0;
        for (int[] e : tree[node]) { Task11.union(e[0], e[1]); applied++; }
        if (l == r) {
            int[] q = queries.get(l);
            if (q != null) ans[l] = Task11.find(q[0]) == Task11.find(q[1]);
        } else {
            int m = (l + r) / 2;
            dfs(node * 2, l, m);
            dfs(node * 2 + 1, m + 1, r);
        }
        for (int i = 0; i < applied; i++) Task11.rollback();
    }

    @SuppressWarnings("unchecked")
    static List<Boolean> solve(int nn, int[][] ops) {
        n = nn; T = ops.length;
        tree = new List[4 * T];
        for (int i = 0; i < 4 * T; i++) tree[i] = new ArrayList<>();
        ans = new boolean[T];
        queries = new HashMap<>();
        boolean[] hasQuery = new boolean[T];
        Task11.init(n);
        Map<Long, Integer> alive = new HashMap<>();
        for (int t = 0; t < T; t++) {
            int[] op = ops[t];
            long key = ((long) op[1] << 20) | op[2];
            if (op[0] == 0) alive.put(key, t);
            else if (op[0] == 1) { add(1, 0, T - 1, alive.get(key), t - 1, new int[]{op[1], op[2]}); alive.remove(key); }
            else { queries.put(t, new int[]{op[1], op[2]}); hasQuery[t] = true; }
        }
        for (var en : alive.entrySet())
            add(1, 0, T - 1, en.getValue(), T - 1, new int[]{(int) (en.getKey() >> 20), (int) (en.getKey() & ((1 << 20) - 1))});
        dfs(1, 0, T - 1);
        List<Boolean> res = new ArrayList<>();
        for (int t = 0; t < T; t++) if (hasQuery[t]) res.add(ans[t]);
        return res;
    }

    public static void main(String[] args) {
        int[][] ops = {{0, 0, 1}, {2, 0, 1}, {1, 0, 1}, {2, 0, 1}};
        System.out.println(solve(2, ops)); // [true, false]
    }
}
```

**Python.**

```python
import sys


def solve(n, ops):
    T = len(ops)
    tree = [[] for _ in range(4 * T)]
    ans = {}
    queries = {}
    d = RollbackDSU(n)  # Task 11

    def add(node, l, r, ql, qr, e):
        if qr < l or r < ql:
            return
        if ql <= l and r <= qr:
            tree[node].append(e)
            return
        m = (l + r) // 2
        add(node * 2, l, m, ql, qr, e)
        add(node * 2 + 1, m + 1, r, ql, qr, e)

    alive = {}
    for t, (kind, u, v) in enumerate(ops):
        if kind == 0:
            alive[(u, v)] = t
        elif kind == 1:
            add(1, 0, T - 1, alive[(u, v)], t - 1, (u, v))
            del alive[(u, v)]
        else:
            queries[t] = (u, v)
    for (u, v), start in alive.items():
        add(1, 0, T - 1, start, T - 1, (u, v))

    def dfs(node, l, r):
        applied = 0
        for u, v in tree[node]:
            d.union(u, v)
            applied += 1
        if l == r:
            if l in queries:
                a, b = queries[l]
                ans[l] = d.find(a) == d.find(b)
        else:
            m = (l + r) // 2
            dfs(node * 2, l, m)
            dfs(node * 2 + 1, m + 1, r)
        for _ in range(applied):
            d.rollback()

    dfs(1, 0, T - 1)
    return [ans[t] for t in sorted(queries)]


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 25)
    ops = [(0, 0, 1), (2, 0, 1), (1, 0, 1), (2, 0, 1)]
    print(solve(2, ops))  # [True, False]
```

**Evaluation.** Answers match a brute per-query BFS over the live edge set; rollback restores state exactly on segment-tree backtrack; total time `O((ops log ops) · α)`.

---

### Task 15 — Smallest equivalent string

**Problem.** Given `s1`, `s2` (equal length) declaring `s1[i] ≡ s2[i]`, and a `baseStr`, replace each character in `baseStr` with the lexicographically smallest character in its equivalence class.

**Constraints.** `1 ≤ |s1| = |s2| ≤ 1000`, `1 ≤ |baseStr| ≤ 1000`, lowercase letters.

**Hints.** A 26-node DSU where the **smallest letter is always the root** (attach by letter value, not rank/size).

**Go.**

```go
package main

import "fmt"

func smallestEquivalentString(s1, s2, baseStr string) string {
	parent := make([]int, 26)
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
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra == rb {
			return
		}
		if ra < rb {
			parent[rb] = ra
		} else {
			parent[ra] = rb
		}
	}
	for i := 0; i < len(s1); i++ {
		union(int(s1[i]-'a'), int(s2[i]-'a'))
	}
	out := []byte(baseStr)
	for i := range out {
		out[i] = byte('a' + find(int(out[i]-'a')))
	}
	return string(out)
}

func main() {
	fmt.Println(smallestEquivalentString("parker", "morris", "parser")) // makkek
}
```

**Java.**

```java
public class Task15 {
    static int[] parent = new int[26];

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
    }

    static String smallestEquivalentString(String s1, String s2, String baseStr) {
        for (int i = 0; i < 26; i++) parent[i] = i;
        for (int i = 0; i < s1.length(); i++) union(s1.charAt(i) - 'a', s2.charAt(i) - 'a');
        StringBuilder sb = new StringBuilder();
        for (char c : baseStr.toCharArray()) sb.append((char) ('a' + find(c - 'a')));
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(smallestEquivalentString("parker", "morris", "parser")); // makkek
    }
}
```

**Python.**

```python
def smallest_equivalent_string(s1, s2, base_str):
    parent = list(range(26))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if ra < rb:
            parent[rb] = ra
        else:
            parent[ra] = rb

    for a, b in zip(s1, s2):
        union(ord(a) - 97, ord(b) - 97)
    return "".join(chr(97 + find(ord(c) - 97)) for c in base_str)


if __name__ == "__main__":
    print(smallest_equivalent_string("parker", "morris", "parser"))  # makkek
```

**Evaluation.** Each output char is the minimum of its class; matches LeetCode 1061; demonstrates a problem-specific root rule instead of rank/size.

---

## Benchmark Task

### Task B — DSU optimization comparison across Go, Java, Python

**Problem.** For each language, benchmark four DSU variants on the same random union/find workload:

- **(a)** naive union, no compression
- **(b)** union by rank only
- **(c)** union by size only
- **(d)** union by rank + path compression (the optimized DSU)

For `n ∈ {10⁴, 10⁵, 10⁶}`, perform `m = n` random unions followed by `m` random `connected` queries. Use the same seed across all four variants and across all three languages so the input is identical. Report mean wall-clock milliseconds over 5 runs.

**Output spec.**

```text
n         a_naive_ms   b_rank_ms   c_size_ms   d_optimized_ms
10000     ...          ...         ...         ...
100000    ...          ...         ...         ...
1000000   ...          ...         ...         ...
```

**Constraints.**
- Seed: `42`. Random pairs uniform in `[0, n)`.
- Time only the workload, not data generation.
- Cap `n` for variant (a) if naive becomes pathologically slow (document the cap).

**Go.**

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

// Each variant exposes Find/Union; only the linking differs.
type Variant struct {
	parent, aux []int
	mode        int // 0 naive, 1 rank, 2 size, 3 rank+compress
}

func newVariant(n, mode int) *Variant {
	v := &Variant{parent: make([]int, n), aux: make([]int, n), mode: mode}
	for i := range v.parent {
		v.parent[i] = i
		if mode == 2 {
			v.aux[i] = 1 // size
		}
	}
	return v
}

func (v *Variant) Find(x int) int {
	if v.mode == 3 {
		root := x
		for v.parent[root] != root {
			root = v.parent[root]
		}
		for v.parent[x] != root {
			v.parent[x], x = root, v.parent[x]
		}
		return root
	}
	for v.parent[x] != x {
		x = v.parent[x]
	}
	return x
}

func (v *Variant) Union(a, b int) {
	ra, rb := v.Find(a), v.Find(b)
	if ra == rb {
		return
	}
	switch v.mode {
	case 0:
		v.parent[rb] = ra
	case 1, 3:
		if v.aux[ra] < v.aux[rb] {
			ra, rb = rb, ra
		}
		v.parent[rb] = ra
		if v.aux[ra] == v.aux[rb] {
			v.aux[ra]++
		}
	case 2:
		if v.aux[ra] < v.aux[rb] {
			ra, rb = rb, ra
		}
		v.parent[rb] = ra
		v.aux[ra] += v.aux[rb]
	}
}

func bench(n, mode int, pairsU, pairsQ [][2]int) time.Duration {
	v := newVariant(n, mode)
	start := time.Now()
	for _, p := range pairsU {
		v.Union(p[0], p[1])
	}
	for _, p := range pairsQ {
		_ = v.Find(p[0]) == v.Find(p[1])
	}
	return time.Since(start)
}

func main() {
	sizes := []int{10000, 100000, 1000000}
	fmt.Println("n         a_naive_ms   b_rank_ms   c_size_ms   d_optimized_ms")
	for _, n := range sizes {
		r := rand.New(rand.NewSource(42))
		pu := make([][2]int, n)
		pq := make([][2]int, n)
		for i := range pu {
			pu[i] = [2]int{r.Intn(n), r.Intn(n)}
		}
		for i := range pq {
			pq[i] = [2]int{r.Intn(n), r.Intn(n)}
		}
		means := [4]float64{}
		for mode := 0; mode < 4; mode++ {
			var sum time.Duration
			runs := 5
			if mode == 0 && n >= 1000000 {
				runs = 1 // naive is slow on big n
			}
			for i := 0; i < runs; i++ {
				sum += bench(n, mode, pu, pq)
			}
			means[mode] = float64(sum.Milliseconds()) / float64(runs)
		}
		fmt.Printf("%-9d %-12.1f %-11.1f %-11.1f %-14.1f\n", n, means[0], means[1], means[2], means[3])
	}
}
```

**Java.**

```java
import java.util.*;

public class TaskB {
    static int[] parent, aux;
    static int mode;

    static void init(int n, int m) {
        mode = m;
        parent = new int[n];
        aux = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; if (m == 2) aux[i] = 1; }
    }

    static int find(int x) {
        if (mode == 3) {
            int root = x;
            while (parent[root] != root) root = parent[root];
            while (parent[x] != root) { int nx = parent[x]; parent[x] = root; x = nx; }
            return root;
        }
        while (parent[x] != x) x = parent[x];
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        switch (mode) {
            case 0 -> parent[rb] = ra;
            case 1, 3 -> {
                if (aux[ra] < aux[rb]) { int t = ra; ra = rb; rb = t; }
                parent[rb] = ra;
                if (aux[ra] == aux[rb]) aux[ra]++;
            }
            case 2 -> {
                if (aux[ra] < aux[rb]) { int t = ra; ra = rb; rb = t; }
                parent[rb] = ra;
                aux[ra] += aux[rb];
            }
        }
    }

    static long bench(int n, int m, int[][] pu, int[][] pq) {
        init(n, m);
        long start = System.nanoTime();
        for (int[] p : pu) union(p[0], p[1]);
        for (int[] p : pq) { boolean ignore = find(p[0]) == find(p[1]); }
        return System.nanoTime() - start;
    }

    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        System.out.println("n         a_naive_ms   b_rank_ms   c_size_ms   d_optimized_ms");
        for (int n : sizes) {
            Random r = new Random(42);
            int[][] pu = new int[n][2], pq = new int[n][2];
            for (int i = 0; i < n; i++) { pu[i][0] = r.nextInt(n); pu[i][1] = r.nextInt(n); }
            for (int i = 0; i < n; i++) { pq[i][0] = r.nextInt(n); pq[i][1] = r.nextInt(n); }
            double[] means = new double[4];
            for (int m = 0; m < 4; m++) {
                int runs = (m == 0 && n >= 1_000_000) ? 1 : 5;
                long sum = 0;
                for (int i = 0; i < runs; i++) sum += bench(n, m, pu, pq);
                means[m] = sum / 1_000_000.0 / runs;
            }
            System.out.printf("%-9d %-12.1f %-11.1f %-11.1f %-14.1f%n",
                n, means[0], means[1], means[2], means[3]);
        }
    }
}
```

**Python.**

```python
import random
import time


def make_dsu(n, mode):
    parent = list(range(n))
    aux = [1] * n if mode == 2 else [0] * n

    def find(x):
        if mode == 3:
            root = x
            while parent[root] != root:
                root = parent[root]
            while parent[x] != root:
                parent[x], x = root, parent[x]
            return root
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if mode == 0:
            parent[rb] = ra
        elif mode in (1, 3):
            if aux[ra] < aux[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            if aux[ra] == aux[rb]:
                aux[ra] += 1
        else:  # size
            if aux[ra] < aux[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            aux[ra] += aux[rb]

    return find, union


def bench(n, mode, pu, pq):
    find, union = make_dsu(n, mode)
    t = time.perf_counter()
    for a, b in pu:
        union(a, b)
    for a, b in pq:
        _ = find(a) == find(b)
    return (time.perf_counter() - t) * 1000


def main():
    sizes = [10_000, 100_000, 1_000_000]
    print("n         a_naive_ms   b_rank_ms   c_size_ms   d_optimized_ms")
    for n in sizes:
        r = random.Random(42)
        pu = [(r.randrange(n), r.randrange(n)) for _ in range(n)]
        pq = [(r.randrange(n), r.randrange(n)) for _ in range(n)]
        means = []
        for mode in range(4):
            runs = 1 if (mode == 0 and n >= 1_000_000) else 5
            means.append(sum(bench(n, mode, pu, pq) for _ in range(runs)) / runs)
        print(f"{n:<9d} {means[0]:<12.1f} {means[1]:<11.1f} {means[2]:<11.1f} {means[3]:<14.1f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed → identical input across variants and languages.
- Variant (d) is fastest and scales almost linearly in total operations; (a) is dramatically worse (often super-linear) on large `n`.
- (b) and (c) are close to each other and noticeably slower than (d) on large `n` because trees are `log n` tall instead of nearly flat.
- Writeup: a short note on the gap between (b)/(c) and (d), and on which language showed the widest naive-vs-optimized ratio.
