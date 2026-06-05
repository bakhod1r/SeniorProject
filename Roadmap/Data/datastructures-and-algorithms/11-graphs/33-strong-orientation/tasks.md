# Strong Orientation (Robbins' Theorem) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a reference solution. Validate against the evaluation criteria, and always verify your orientation with a strongly-connected check.

---

## Beginner Tasks (5)

### Task 1 — Decide if a strong orientation exists

**Problem.** Given a connected undirected graph, print `YES` if it admits a strong orientation and `NO` otherwise. By Robbins' Theorem, the answer is `YES` iff the graph is bridgeless. Count bridges with a low-link DFS.

**Input / Output spec.**
- First line: `n m` (vertices, edges).
- Next `m` lines: `u v` (an undirected edge).
- Output: `YES` or `NO`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.
- The graph is connected.
- Time: `O(n + m)`.

**Hint.** A tree edge `{u, v}` is a bridge iff `low[v] > disc[u]`. If any bridge is found, print `NO`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type E struct{ to, id int }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]E, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], E{v, i})
		adj[v] = append(adj[v], E{u, i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	bridge := false
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		// TODO: set disc/low, recurse on tree edges, update low on back edges,
		// set bridge=true when low[child] > disc[u]
	}
	dfs(0, -1)
	if bridge {
		fmt.Println("NO")
	} else {
		fmt.Println("YES")
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static List<int[]>[] adj;
    static int[] disc, low;
    static int timer = 0;
    static boolean bridge = false;

    static void dfs(int u, int pe) {
        // TODO: low-link DFS; set bridge when low[child] > disc[u]
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken()), m = Integer.parseInt(st.nextToken());
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            int u = Integer.parseInt(st.nextToken()), v = Integer.parseInt(st.nextToken());
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        dfs(0, -1);
        System.out.println(bridge ? "NO" : "YES");
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1_000_000)


def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    adj = [[] for _ in range(n)]
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    bridge = [False]

    def dfs(u, pe):
        # TODO: low-link DFS; bridge[0] = True when low[child] > disc[u]
        pass

    dfs(0, -1)
    print("NO" if bridge[0] else "YES")


main()
```

**Evaluation criteria.** Correct on a cycle (`YES`), on a tree (`NO`), on a triangle-plus-pendant (`NO`), and runs in linear time on `10^5` vertices.

---

### Task 2 — Output a concrete strong orientation

**Problem.** Given a bridgeless connected graph, output a direction `u v` for every edge so the result is strongly connected. Use tree-down / back-up.

**Input / Output spec.**
- `n m`, then `m` edges `u v`.
- Output `m` lines `a b` meaning the edge is oriented `a -> b`, in input order.

**Constraints.** `n, m` as in Task 1; the graph is guaranteed bridgeless.

**Hint.** Store each oriented edge in a `dir[id]` array; print in id order after the DFS.

**Reference — Python.**
```python
import sys
sys.setrecursionlimit(1_000_000)


def orient(n, edges):
    adj = [[] for _ in range(n)]
    dir_ = [None] * len(edges)
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    timer = [0]

    def dfs(u, pe):
        disc[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                dir_[eid] = (u, v)        # tree: down
                dfs(v, eid)
            elif disc[v] < disc[u]:
                if dir_[eid] is None:
                    dir_[eid] = (u, v)    # back: up
    dfs(0, -1)
    return dir_


if __name__ == "__main__":
    print(orient(4, [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3)]))
```

**Reference — Go.**
```go
package main

import "fmt"

func orient(n int, edges [][2]int) [][2]int {
	type E struct{ to, id int }
	adj := make([][]E, n)
	dir := make([][2]int, len(edges))
	for i := range dir {
		dir[i] = [2]int{-1, -1}
	}
	for i, e := range edges {
		adj[e[0]] = append(adj[e[0]], E{e[1], i})
		adj[e[1]] = append(adj[e[1]], E{e[0], i})
	}
	disc := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u] = timer
		timer++
		for _, e := range adj[u] {
			if e.id == pe {
				continue
			}
			if disc[e.to] == -1 {
				dir[e.id] = [2]int{u, e.to}
				dfs(e.to, e.id)
			} else if disc[e.to] < disc[u] {
				if dir[e.id] == [2]int{-1, -1} {
					dir[e.id] = [2]int{u, e.to}
				}
			}
		}
	}
	dfs(0, -1)
	return dir
}

func main() {
	fmt.Println(orient(4, [][2]int{{0, 1}, {0, 2}, {1, 2}, {1, 3}, {2, 3}}))
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task2 {
    static List<int[]>[] adj;
    static int[] disc;
    static int[][] dir;
    static int timer = 0;

    static void dfs(int u, int pe) {
        disc[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) { dir[id] = new int[]{u, v}; dfs(v, id); }
            else if (disc[v] < disc[u] && dir[id][0] == -1) dir[id] = new int[]{u, v};
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        int n = 4;
        int[][] edges = {{0,1},{0,2},{1,2},{1,3},{2,3}};
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        dir = new int[edges.length][];
        for (int i = 0; i < edges.length; i++) {
            adj[edges[i][0]].add(new int[]{edges[i][1], i});
            adj[edges[i][1]].add(new int[]{edges[i][0], i});
            dir[i] = new int[]{-1, -1};
        }
        disc = new int[n];
        Arrays.fill(disc, -1);
        dfs(0, -1);
        for (int[] d : dir) System.out.println(d[0] + " " + d[1]);
    }
}
```

**Evaluation criteria.** The printed orientation must pass an independent SCC check (Task 4).

---

### Task 3 — Orient a cycle two ways

**Problem.** A simple cycle `0-1-2-...-(n-1)-0` has exactly two strong orientations: clockwise and counterclockwise. Print both.

**Input / Output spec.** Input `n`. Output two lines: the clockwise arc sequence and the counterclockwise one.

**Constraints.** `3 <= n <= 10^6`.

**Hint.** No DFS needed; this is a direct construction. It builds intuition that strong orientation is not unique.

**Reference — Python.**
```python
def cycle_orientations(n):
    cw = [(i, (i + 1) % n) for i in range(n)]
    ccw = [(i, (i - 1) % n) for i in range(n)]
    return cw, ccw


if __name__ == "__main__":
    cw, ccw = cycle_orientations(4)
    print("CW :", cw)
    print("CCW:", ccw)
```

**Reference — Go.**
```go
package main

import "fmt"

func main() {
	n := 4
	fmt.Print("CW : ")
	for i := 0; i < n; i++ {
		fmt.Printf("%d->%d ", i, (i+1)%n)
	}
	fmt.Print("\nCCW: ")
	for i := 0; i < n; i++ {
		fmt.Printf("%d->%d ", i, (i+n-1)%n)
	}
	fmt.Println()
}
```

**Reference — Java.**
```java
public class Task3 {
    public static void main(String[] args) {
        int n = 4;
        StringBuilder cw = new StringBuilder("CW : "), ccw = new StringBuilder("CCW: ");
        for (int i = 0; i < n; i++) {
            cw.append(i).append("->").append((i + 1) % n).append(' ');
            ccw.append(i).append("->").append((i + n - 1) % n).append(' ');
        }
        System.out.println(cw);
        System.out.println(ccw);
    }
}
```

**Evaluation criteria.** Both orientations are strongly connected; they are reverses of each other.

---

### Task 4 — Strongly-connected verifier

**Problem.** Given a directed graph, return whether it is strongly connected via forward + reverse reachability from vertex 0.

**Input / Output spec.** `n m`, then `m` directed arcs `u v`. Output `true`/`false`.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 5·10^5`.

**Hint.** Use an iterative stack to avoid recursion limits.

**Reference — Python.**
```python
def reach(n, g, s):
    seen = [False] * n
    st = [s]
    seen[s] = True
    while st:
        u = st.pop()
        for v in g[u]:
            if not seen[v]:
                seen[v] = True
                st.append(v)
    return seen


def strongly_connected(n, arcs):
    out = [[] for _ in range(n)]
    inc = [[] for _ in range(n)]
    for a, b in arcs:
        out[a].append(b)
        inc[b].append(a)
    return all(reach(n, out, 0)) and all(reach(n, inc, 0))


if __name__ == "__main__":
    print(strongly_connected(4, [(0, 1), (1, 2), (2, 3), (3, 0)]))  # True
```

**Reference — Go.**
```go
package main

import "fmt"

func reach(n int, g [][]int, s int) []bool {
	seen := make([]bool, n)
	st := []int{s}
	seen[s] = true
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		for _, v := range g[u] {
			if !seen[v] {
				seen[v] = true
				st = append(st, v)
			}
		}
	}
	return seen
}

func main() {
	n := 4
	arcs := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}}
	out := make([][]int, n)
	in := make([][]int, n)
	for _, a := range arcs {
		out[a[0]] = append(out[a[0]], a[1])
		in[a[1]] = append(in[a[1]], a[0])
	}
	f, r := reach(n, out, 0), reach(n, in, 0)
	ok := true
	for i := 0; i < n; i++ {
		if !f[i] || !r[i] {
			ok = false
		}
	}
	fmt.Println(ok)
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task4 {
    static boolean[] reach(int n, List<Integer>[] g, int s) {
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(s); seen[s] = true;
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int v : g[u]) if (!seen[v]) { seen[v] = true; st.push(v); }
        }
        return seen;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        int n = 4;
        int[][] arcs = {{0,1},{1,2},{2,3},{3,0}};
        List<Integer>[] out = new List[n], in = new List[n];
        for (int i = 0; i < n; i++) { out[i] = new ArrayList<>(); in[i] = new ArrayList<>(); }
        for (int[] a : arcs) { out[a[0]].add(a[1]); in[a[1]].add(a[0]); }
        boolean[] f = reach(n, out, 0), r = reach(n, in, 0);
        boolean ok = true;
        for (int i = 0; i < n; i++) if (!f[i] || !r[i]) ok = false;
        System.out.println(ok);
    }
}
```

**Evaluation criteria.** `true` for a directed cycle, `false` if any vertex is unreachable in either direction.

---

### Task 5 — Detect why a graph is not orientable

**Problem.** Given a connected graph, list its bridges (as `u v` pairs). These are the edges blocking a strong orientation.

**Input / Output spec.** `n m`, then `m` edges. Output each bridge on its own line; if none, output `NONE`.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.

**Hint.** Same low-link DFS as Task 1, but record the bridge endpoints instead of a boolean.

**Reference — Python.**
```python
import sys
sys.setrecursionlimit(1_000_000)


def bridges(n, edges):
    adj = [[] for _ in range(n)]
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    res = []

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    res.append((u, v))
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    return res


if __name__ == "__main__":
    b = bridges(4, [(0, 1), (1, 2), (2, 0), (2, 3)])
    print("NONE" if not b else "\n".join(f"{u} {v}" for u, v in b))
```

**Reference — Go / Java.** Reuse the bridge-counting DFS from interview Challenge 3, appending `(u, v)` instead of incrementing a counter.

**Evaluation criteria.** Correct bridge set on triangle-plus-pendant (`{2,3}`), on a tree (all edges), and `NONE` on a cycle.

---

## Intermediate Tasks (5)

### Task 6 — Orient per 2-edge-connected component

**Problem.** Given a connected graph that may contain bridges, orient every non-bridge edge so each 2-edge-connected component is strongly connected; leave bridges undirected (print them as `BRIDGE u v`).

**Constraints.** `n <= 10^5`, `m <= 2·10^5`.

**Hint.** First low-link DFS marks bridges. Then run the orientation DFS but only orient non-bridge edges; the bridge edges keep `(-1,-1)` and are printed separately.

**Reference — Python.**
```python
import sys
sys.setrecursionlimit(1_000_000)


def orient_components(n, edges):
    adj = [[] for _ in range(n)]
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * len(edges)
    dir_ = [None] * len(edges)
    timer = [0]

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                if dir_[eid] is None:
                    dir_[eid] = (u, v)         # tentative tree orientation
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    is_bridge[eid] = True
                    dir_[eid] = None           # bridges stay undirected
            elif disc[v] < disc[u]:
                if dir_[eid] is None:
                    dir_[eid] = (u, v)

    dfs(0, -1)
    return dir_, is_bridge


if __name__ == "__main__":
    edges = [(0, 1), (1, 2), (2, 0), (2, 3), (3, 4), (4, 5), (5, 3)]
    dir_, is_bridge = orient_components(6, edges)
    for i, (u, v) in enumerate(edges):
        if is_bridge[i]:
            print(f"BRIDGE {u} {v}")
        else:
            a, b = dir_[i]
            print(f"{a} -> {b}")
```

**Evaluation criteria.** Each component's oriented edges form a strongly connected subgraph; bridges are correctly identified.

---

### Task 7 — Build the bridge tree

**Problem.** Contract each 2-edge-connected component to a node and output the bridge tree as an edge list of component ids.

**Constraints.** `n <= 10^5`, `m <= 2·10^5`.

**Hint.** Label components by DFS over non-bridge edges; each bridge becomes a tree edge between two component ids.

**Reference — Go.**
```go
package main

import "fmt"

func bridgeTree(n int, edges [][2]int) [][2]int {
	type E struct{ to, id int }
	adj := make([][]E, n)
	for i, e := range edges {
		adj[e[0]] = append(adj[e[0]], E{e[1], i})
		adj[e[1]] = append(adj[e[1]], E{e[0], i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	isBridge := make([]bool, len(edges))
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u] = timer
		low[u] = timer
		timer++
		for _, e := range adj[u] {
			if e.id == pe {
				continue
			}
			if disc[e.to] == -1 {
				dfs(e.to, e.id)
				if low[e.to] < low[u] {
					low[u] = low[e.to]
				}
				if low[e.to] > disc[u] {
					isBridge[e.id] = true
				}
			} else if disc[e.to] < low[u] {
				low[u] = disc[e.to]
			}
		}
	}
	dfs(0, -1)
	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	c := 0
	for s := 0; s < n; s++ {
		if comp[s] != -1 {
			continue
		}
		st := []int{s}
		comp[s] = c
		for len(st) > 0 {
			u := st[len(st)-1]
			st = st[:len(st)-1]
			for _, e := range adj[u] {
				if !isBridge[e.id] && comp[e.to] == -1 {
					comp[e.to] = c
					st = append(st, e.to)
				}
			}
		}
		c++
	}
	var tree [][2]int
	for i, e := range edges {
		if isBridge[i] {
			tree = append(tree, [2]int{comp[e[0]], comp[e[1]]})
		}
	}
	return tree
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}
	fmt.Println(bridgeTree(6, edges)) // one edge between the two triangle components
}
```

**Evaluation criteria.** The output is a tree (acyclic) with one node per 2ECC and one edge per bridge.

---

### Task 8 — Minimum edges to make orientable

**Problem.** Compute `⌈L/2⌉` where `L` is the number of bridge-tree leaves; `0` if already 2-edge-connected.

**Constraints.** `n <= 10^5`, `m <= 2·10^5`.

**Hint.** Reuse Task 7 to get the bridge tree, count degree-1 nodes. See interview Challenge 4 for the full three-language solution.

**Reference — Python.** (See interview Challenge 4 `min_edges_to_orient` — reuse verbatim.)

**Evaluation criteria.** `0` for a cycle, `1` for two blocks joined by one bridge, `⌈L/2⌉` for a star-of-blocks.

---

### Task 9 — Orient + verify pipeline

**Problem.** Combine: read a graph, decide orientability, orient if possible, and assert the result is strongly connected. Exit with an error if the assertion fails.

**Constraints.** `n <= 10^5`, `m <= 2·10^5`.

**Hint.** Chain Task 2 (orient) and Task 4 (verify). The verify must never fail on a bridgeless input — that is the contract.

**Reference — Python.**
```python
import sys
sys.setrecursionlimit(1_000_000)
# assume orient() from Task 2 and strongly_connected() from Task 4 are imported


def pipeline(n, edges):
    # bridge check first
    from_task5 = bridges(n, edges)  # Task 5
    if from_task5:
        return "NO", None
    dir_ = orient(n, edges)         # Task 2
    arcs = list(dir_)
    assert strongly_connected(n, arcs), "verification failed!"
    return "YES", arcs
```

**Evaluation criteria.** On any bridgeless graph the assertion holds; on a bridged graph the pipeline reports `NO` without attempting orientation.

---

### Task 10 — Iterative (stack-based) orientation for deep graphs

**Problem.** Re-implement the orientation DFS using an explicit stack so it survives a path graph of `10^6` vertices without recursion overflow.

**Constraints.** `n <= 10^6`, `m <= 2·10^6`. The graph is bridgeless.

**Hint.** Emulate the recursion with an explicit stack of `(vertex, parentEdge, iterator_position)`. Compute `low` on the unwind (post-order) step.

**Reference — Python.**
```python
def orient_iter(n, edges):
    adj = [[] for _ in range(n)]
    dir_ = [None] * len(edges)
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    timer = 0
    for src in range(n):
        if disc[src] != -1:
            continue
        stack = [(src, -1, 0)]
        while stack:
            u, pe, pi = stack.pop()
            if pi == 0:
                disc[u] = timer
                timer += 1
            advanced = False
            while pi < len(adj[u]):
                v, eid = adj[u][pi]
                pi += 1
                if eid == pe:
                    continue
                if disc[v] == -1:
                    dir_[eid] = (u, v)             # tree: down
                    stack.append((u, pe, pi))      # resume later
                    stack.append((v, eid, 0))      # descend
                    advanced = True
                    break
                elif disc[v] < disc[u]:
                    if dir_[eid] is None:
                        dir_[eid] = (u, v)          # back: up
            if not advanced:
                continue
    return dir_


if __name__ == "__main__":
    print(orient_iter(4, [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3)]))
```

**Evaluation criteria.** No stack overflow on `10^6` path vertices (plus extra cycle edges to keep it bridgeless); output passes Task 4 verification.

---

## Advanced Tasks (5)

### Task 11 — Mixed-graph feasibility (small inputs)

**Problem.** Given a mixed graph (some arcs fixed, some edges undirected), decide whether a strong orientation of the undirected edges exists. For `E <= 18` undirected edges, brute-force all `2^E` orientations and test strong connectivity; this validates the Boesch–Tindell characterization on small cases.

**Constraints.** `n <= 30`, undirected edges `<= 18`, arcs `<= 100`.

**Hint.** Enumerate bitmasks over undirected edges; for each, build the digraph (fixed arcs + chosen directions) and run the Task 4 verifier. Report `YES` if any mask is strongly connected.

**Reference — Python.**
```python
from itertools import product


def mixed_feasible(n, arcs, und_edges, sc_check):
    e = len(und_edges)
    for mask in range(1 << e):
        these = list(arcs)
        for i, (u, v) in enumerate(und_edges):
            these.append((u, v) if (mask >> i) & 1 else (v, u))
        if sc_check(n, these):
            return True
    return False
```

**Evaluation criteria.** Matches the polynomial Boesch–Tindell answer on all small test cases; `NO` exactly when no orientation works.

---

### Task 12 — Count distinct strong orientations of small graphs

**Problem.** For `E <= 20`, count how many of the `2^E` orientations are strongly connected. (This is `#P`-hard in general — brute force is fine for small `E` and builds intuition that orientations are far from unique.)

**Constraints.** `n <= 12`, `E <= 20`.

**Hint.** Enumerate all orientations, count those passing the Task 4 verifier. A cycle of length `n` should yield exactly `2`.

**Reference — Go.**
```go
package main

import "fmt"

func reach(n int, g [][]int, s int) []bool {
	seen := make([]bool, n)
	st := []int{s}
	seen[s] = true
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		for _, v := range g[u] {
			if !seen[v] {
				seen[v] = true
				st = append(st, v)
			}
		}
	}
	return seen
}

func sc(n int, arcs [][2]int) bool {
	out := make([][]int, n)
	in := make([][]int, n)
	for _, a := range arcs {
		out[a[0]] = append(out[a[0]], a[1])
		in[a[1]] = append(in[a[1]], a[0])
	}
	f, r := reach(n, out, 0), reach(n, in, 0)
	for i := 0; i < n; i++ {
		if !f[i] || !r[i] {
			return false
		}
	}
	return true
}

func count(n int, edges [][2]int) int {
	e := len(edges)
	total := 0
	for mask := 0; mask < (1 << e); mask++ {
		arcs := make([][2]int, e)
		for i, ed := range edges {
			if mask>>i&1 == 1 {
				arcs[i] = [2]int{ed[0], ed[1]}
			} else {
				arcs[i] = [2]int{ed[1], ed[0]}
			}
		}
		if sc(n, arcs) {
			total++
		}
	}
	return total
}

func main() {
	// 4-cycle -> exactly 2 strong orientations
	fmt.Println(count(4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}}))
}
```

**Evaluation criteria.** Returns `2` for a cycle; matches a hand count on `K4` (which has many).

---

### Task 13 — Random bridgeless graph generator + invariant test

**Problem.** Generate random bridgeless graphs (start from a Hamiltonian cycle, add random extra edges — a cycle guarantees bridgelessness), orient them, and assert the orientation is always strongly connected. This is a property-based test of the whole algorithm.

**Constraints.** Run `1000` random trials with `n` up to `500`.

**Hint.** Cycle base ⇒ no bridges ⇒ Robbins guarantees `YES`. Any verification failure is a bug in your orientation.

**Reference — Python.**
```python
import random
# reuse orient() (Task 2) and strongly_connected() (Task 4)


def random_bridgeless(n, extra):
    edges = [(i, (i + 1) % n) for i in range(n)]  # cycle: bridgeless
    for _ in range(extra):
        a, b = random.randrange(n), random.randrange(n)
        if a != b:
            edges.append((a, b))
    return edges


def fuzz(trials=1000):
    for _ in range(trials):
        n = random.randint(3, 500)
        edges = random_bridgeless(n, random.randint(0, n))
        dir_ = orient(n, edges)
        assert strongly_connected(n, list(dir_)), "FAILED"
    print("all trials passed")
```

**Evaluation criteria.** All trials pass; introducing a deliberate bug (e.g. orienting back edges down) makes the assertion fire.

---

### Task 14 — Incremental orientability under edge insertions

**Problem.** Process a stream of edge insertions on an initially-disconnected graph. After each insertion, report whether the graph (on the vertices seen so far) is connected and bridgeless. Use a union-find for connectivity and recompute bridges lazily, or maintain a 2-edge-connectivity DSU.

**Constraints.** `n <= 10^5`, insertions `<= 2·10^5`.

**Hint.** Adding an edge can only remove bridges, never create one. A union-find over 2-edge-connected components (small-to-large path compression, sibling **21-small-to-large-merging**) maintains the answer in near-`O(α)` amortized. A simpler `O(m)` recompute per query also passes for moderate sizes.

**Reference — Python (simple recompute version).**
```python
def online_orientable(n, insertions):
    edges = []
    results = []
    for u, v in insertions:
        edges.append((u, v))
        # connected over touched vertices AND bridgeless?
        results.append(is_connected_and_bridgeless(n, edges))
    return results
# is_connected_and_bridgeless: run the Task 1/Task 5 DFS over current edges.
```

**Evaluation criteria.** The first time the graph becomes connected + bridgeless, the answer flips to `YES` and stays correct as more edges arrive.

---

### Task 15 — Orientation under a forbidden-direction constraint

**Problem.** Some edges may not be oriented in a given direction (a fixed list of forbidden `(u, v)` arcs). Decide if a strong orientation respecting all forbidden constraints exists, and produce one. For small graphs, model each constrained edge as semi-fixed and brute-force; for the general case, reduce to the mixed-graph flow formulation (Boesch–Tindell, see [`professional.md`](./professional.md)).

**Constraints.** Brute force for undirected-with-constraints `<= 18`; describe the flow reduction for larger.

**Hint.** A forbidden direction on an undirected edge effectively *fixes* it to the other direction — turning it into a pre-directed (mixed-graph) edge. Then it is exactly the mixed-graph problem.

**Reference — Python (brute force for small inputs).**
```python
from itertools import product
# reuse strongly_connected() from Task 4


def constrained_orient(n, edges, forbidden):
    # forbidden: set of (u, v) arcs that may NOT be used
    e = len(edges)
    for mask in range(1 << e):
        arcs = []
        ok = True
        for i, (u, v) in enumerate(edges):
            a = (u, v) if (mask >> i) & 1 else (v, u)
            if a in forbidden:
                ok = False
                break
            arcs.append(a)
        if ok and strongly_connected(n, arcs):
            return arcs
    return None
```

**Evaluation criteria.** Returns a valid orientation avoiding all forbidden arcs when one exists, `None` otherwise; agrees with the flow reduction on test cases.

---

## Benchmark Task

### Benchmark — Orientation throughput and scaling

**Problem.** Measure the orientation pipeline (bridge check + orient + verify) on graphs from `10^3` to `10^6` edges and confirm linear scaling. Use a cycle base plus random chords so every instance is guaranteed bridgeless.

**What to measure.**
1. Time to detect bridges (should be 0 on a cycle base).
2. Time to orient.
3. Time to verify (two reachability passes).
4. Throughput in edges/second; confirm it stays roughly flat (linear total time).

**Reference — Python.**
```python
import random, time
import sys
sys.setrecursionlimit(2_000_000)
# reuse orient() (Task 2), strongly_connected() (Task 4), bridges() (Task 5)


def make(n, extra):
    edges = [(i, (i + 1) % n) for i in range(n)]   # bridgeless cycle
    for _ in range(extra):
        a, b = random.randrange(n), random.randrange(n)
        if a != b:
            edges.append((a, b))
    return edges


def bench():
    for n in [1_000, 10_000, 100_000, 500_000]:
        edges = make(n, n)            # ~2n edges
        t0 = time.perf_counter()
        b = bridges(n, edges)
        t1 = time.perf_counter()
        dir_ = orient(n, edges)
        t2 = time.perf_counter()
        ok = strongly_connected(n, list(dir_))
        t3 = time.perf_counter()
        m = len(edges)
        print(f"n={n:>7} m={m:>8} bridges={len(b)} "
              f"bridge={t1-t0:.3f}s orient={t2-t1:.3f}s verify={t3-t2:.3f}s "
              f"sc={ok} throughput={m/(t3-t0):,.0f} edges/s")


if __name__ == "__main__":
    bench()
```

**Reference — Go (timing harness sketch).**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func makeGraph(n, extra int) [][2]int {
	edges := make([][2]int, 0, n+extra)
	for i := 0; i < n; i++ {
		edges = append(edges, [2]int{i, (i + 1) % n})
	}
	for i := 0; i < extra; i++ {
		a, b := rand.Intn(n), rand.Intn(n)
		if a != b {
			edges = append(edges, [2]int{a, b})
		}
	}
	return edges
}

func main() {
	for _, n := range []int{1000, 10000, 100000, 500000} {
		edges := makeGraph(n, n)
		start := time.Now()
		_ = orient(n, edges) // from Task 2
		fmt.Printf("n=%d m=%d orient=%v\n", n, len(edges), time.Since(start))
	}
}
```

**Expected results.**

| n | m (~2n) | bridges | orient time | verify time | scaling |
|---|---------|---------|-------------|-------------|---------|
| 10³ | ~2·10³ | 0 | ~1 ms | ~1 ms | baseline |
| 10⁴ | ~2·10⁴ | 0 | ~10 ms | ~10 ms | ~10× |
| 10⁵ | ~2·10⁵ | 0 | ~110 ms | ~100 ms | ~10× |
| 5·10⁵ | ~10⁶ | 0 | ~600 ms | ~550 ms | ~5× |

Total time grows linearly with `m`; throughput (edges/second) stays roughly constant, confirming `O(V + E)`. Go/Java are ~10–30× faster than Python for the same inputs. Bridges are always 0 because the cycle base guarantees bridgelessness — a clean invariant that makes the benchmark self-checking.

**Evaluation criteria.** Linear total time, flat throughput, zero bridges on the cycle base, and every orientation passing the strongly-connected verifier.
</content>
