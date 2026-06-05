# Euler Tour Technique (Tree Flattening) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that order).
> Trees are rooted at node `0` unless stated otherwise; adjacency lists are undirected (skip the parent during DFS).

---

## Beginner Tasks

**Task 1:** Implement the basic flatten — compute `tin[v]` and `tout[v]` for every node with a single DFS, and print the flattened `order` array.

#### Go

```go
package main

func flatten(adj [][]int, root int) (tin, tout, order []int) {
	// implement: stamp tin on enter, tout on leave; order[tin[v]] = v
	return
}

func main() {
	// adj := [][]int{{1,2,3},{0,4,5},{0},{0,6},{1},{1},{3}}
	// print tin, tout, order
}
```

#### Java

```java
import java.util.*;

public class Task1 {
    static int[] tin, tout, order; static int timer = 0; static List<List<Integer>> adj;
    static void dfs(int v, int p) {
        // implement
    }
    public static void main(String[] args) {
        // build adj, run dfs, print tin/tout/order
    }
}
```

#### Python

```python
def flatten(adj, root):
    # implement: return tin, tout, order
    pass


if __name__ == "__main__":
    adj = [[1, 2, 3], [0, 4, 5], [0], [0, 6], [1], [1], [3]]
    # print(flatten(adj, 0))
```

- **Constraints:** one DFS, `O(n)`. Test on a single node, a chain, and a star.
- **Expected Output:** for the sample, `tin=[0,1,4,5,2,3,6]`, `tout=[6,3,4,6,2,3,6]`, `order=[0,1,4,5,2,3,6]`.
- **Evaluation:** correct timestamps, inclusive `tout`, handles root and leaves.

**Task 2:** Subtree size in `O(1)`. Using `tin`/`tout`, return `tout[v] - tin[v] + 1` for any `v`. Verify it equals a brute-force subtree count.
- Provide starter code in all 3 languages.
- Constraints: `O(1)` per query after the `O(n)` flatten.

**Task 3:** Ancestor test in `O(1)`. Implement `isAncestor(u, v)` = `tin[u] ≤ tin[v] ∧ tout[v] ≤ tout[u]`. Test root-vs-leaf, node-vs-itself, and sibling pairs.

**Task 4:** Flattened value array. Given a value per node, build `flat[tin[v]] = value(v)` and return the **plain prefix-sum** array of `flat`. Use it to answer subtree sums in `O(1)` (read-only, no updates).

**Task 5:** List subtree members. Given `v`, return all nodes in its subtree by slicing `order[tin[v] .. tout[v]]`. Confirm against a brute-force DFS of the subtree.

---

## Intermediate Tasks

**Task 6:** Subtree sum with point updates. Put a Fenwick tree over the flattened values. Support `update(v, x)` (set node value) and `query(v)` (subtree sum), each `O(log n)`. — provide starter code in all 3 languages.

#### Go

```go
package main

type ETT struct {
	tin, tout, cur, bit []int
	timer               int
	adj                 [][]int
}

func (e *ETT) Update(v, x int) { /* add(tin[v], x-cur[v]); cur[v]=x */ }
func (e *ETT) Query(v int) int { /* prefix(tout[v]) - prefix(tin[v]-1) */ return 0 }

func main() {}
```

#### Java

```java
public class Task6 {
    int[] tin, tout, cur; long[] bit;
    void update(int v, long x) { /* ... */ }
    long query(int v) { /* ... */ return 0; }
    public static void main(String[] args) {}
}
```

#### Python

```python
class ETT:
    def update(self, v, x):
        ...

    def query(self, v):
        ...
```

- Constraints: `O(log n)` per op; test interleaved updates and queries.

**Task 7:** Subtree min with point updates. Replace the Fenwick with a segment tree supporting point-update + range-min over `[tin[v], tout[v]]`. Explain in a comment why a Fenwick cannot do `min` directly.

**Task 8:** Subtree range-add + point query. Use a **difference Fenwick**: `add(tin[v], +d)`, `add(tout[v]+1, -d)`; a node's value is `base[u] + prefix(tin[u])`. Support `subtreeAdd(v, d)` and `nodeValue(u)`.

**Task 9:** Subtree range-add + subtree range-sum. Use a **lazy segment tree** over the flat array. Support `subtreeAdd(v, d)` and `subtreeSum(v)`, each `O(log n)`.

**Task 10:** Count nodes with value `> k` in a subtree (offline). Given queries `(v, k)`, answer how many nodes in `v`'s subtree have value `> k`. Hint: flatten, then process queries offline with a Fenwick over sorted values (or a merge-sort tree over `[tin[v], tout[v]]`).

---

## Advanced Tasks

**Task 11:** LCA via Euler tour + RMQ. Build the `2n-1` Euler tour and a sparse table over depths; answer `LCA(u, v)` in `O(1)` and `dist(u, v) = depth[u]+depth[v]-2·depth[LCA]`. — provide starter code in all 3 languages.

#### Go

```go
package main

type LCA struct {
	euler, eulerDepth, first, depth []int
	// sparse table fields
}

func (l *LCA) Query(u, v int) int { return 0 } // returns LCA node
func (l *LCA) Dist(u, v int) int  { return 0 }

func main() {}
```

#### Java

```java
public class Task11 {
    int lca(int u, int v) { return -1; }
    int dist(int u, int v) { return -1; }
    public static void main(String[] args) {}
}
```

#### Python

```python
class LCA:
    def query(self, u, v):
        ...

    def dist(self, u, v):
        ...
```

- Constraints: `O(n log n)` build, `O(1)` per query.

**Task 12:** Path sum root→v via enter/leave signs. On the `2n` Euler array, store `+value` at the enter position and `-value` at the leave position. Show that the prefix sum up to `v`'s enter index equals the sum of values on the root→`v` path. Support point value updates (`O(log n)` with a Fenwick).

**Task 13:** Combine ETT with HLD. Lay the tree out **heavy-child-first** so that both subtree ranges (`[pos[v], pos[v]+size[v]-1]`) and HLD chains live in one base array. Support a subtree-sum query (`O(log n)`) and a path-sum query `u→v` (`O(log² n)`) over a single segment tree.

**Task 14:** Re-flatten on shape change. Implement a small service: support `reparent(v, newParent)` (a shape change → full `O(n)` re-flatten + version bump) and `subtreeSum(v)` against the current version. Track and print the `shapeVersion`. Discuss in comments when an Euler-Tour Tree would be preferable.

**Task 15:** Persistent (time-travel) subtree sums. Back the value index with a persistent segment tree so each `update` returns a new version id. Support `subtreeSum(version, v)` over any past version, sharing one flattening (shape assumed stable). Verify a query against an old version returns the historical aggregate.

---

## Benchmark Task

> Compare performance across all 3 languages: build the Euler tour over a random tree of `n` nodes, then time `n` random subtree-sum queries via a Fenwick. Report build time and query throughput.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func buildRandomTree(n int) [][]int {
	adj := make([][]int, n)
	for v := 1; v < n; v++ {
		p := rand.Intn(v) // parent is an earlier node -> valid tree
		adj[v] = append(adj[v], p)
		adj[p] = append(adj[p], v)
	}
	return adj
}

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		adj := buildRandomTree(n)
		start := time.Now()
		// flatten + build Fenwick + run n subtree-sum queries
		_ = adj
		fmt.Printf("n=%7d: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random rnd = new Random(42);
        for (int n : sizes) {
            // build random tree (parent = earlier node), flatten, Fenwick, n queries
            long start = System.nanoTime();
            // ...
            System.out.printf("n=%7d: %.3f ms%n", n, (System.nanoTime() - start) / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random
import time
import sys

sys.setrecursionlimit(2_000_000)


def build_random_tree(n):
    adj = [[] for _ in range(n)]
    for v in range(1, n):
        p = random.randrange(v)
        adj[v].append(p)
        adj[p].append(v)
    return adj


if __name__ == "__main__":
    for n in [1000, 10_000, 100_000]:
        adj = build_random_tree(n)
        start = time.perf_counter()
        # flatten (use iterative DFS for large n), Fenwick, n subtree-sum queries
        elapsed = (time.perf_counter() - start) * 1000
        print(f"n={n:>7}: {elapsed:.3f} ms")
```

- **Goal:** confirm build is `O(n)` and queries are `O(log n)`; observe how Python needs iterative DFS at `n = 10^6` to avoid recursion limits, and how Go/Java stay flat as `n` grows.
- **Evaluation:** correct subtree sums, no stack overflow on deep trees, sane scaling across `n`.
