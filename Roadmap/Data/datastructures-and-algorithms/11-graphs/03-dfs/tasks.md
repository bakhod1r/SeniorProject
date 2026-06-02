# Depth-First Search — Practice Tasks

> Every task must be solved in Go, Java, and Python.
> Each task gives a problem statement, constraints, hints, and a complete reference solution in all three languages.
> Graphs use the conventions from `junior.md`/`middle.md`: vertices `0..V-1`, adjacency lists `adj[u]`, the visited set, and the white/gray/black coloring with discovery/finish times.

---

## Beginner Tasks (5)

### Task 1 — Recursive DFS preorder

**Problem.** Given a directed graph as an adjacency list and a start vertex `s`, return the vertices in **preorder** (discovery order) of a recursive DFS, taking neighbours in list order.

**Constraints.**
- `1 <= V <= 10^4`, graph shallow enough that recursion is safe.
- Neighbours are explored in the order they appear in `adj[u]`.

**Hint.** Mark visited on entry, append `u` to the result before recursing into its neighbours, and guard each neighbour with the visited check.

**Reference — Go.**
```go
package main

import "fmt"

func dfsPreorder(adj [][]int, s int) []int {
	visited := make([]bool, len(adj))
	order := []int{}
	var dfs func(u int)
	dfs = func(u int) {
		visited[u] = true
		order = append(order, u) // discovery / preorder
		for _, v := range adj[u] {
			if !visited[v] {
				dfs(v)
			}
		}
	}
	dfs(s)
	return order
}

func main() {
	adj := [][]int{{1, 2}, {3}, {3}, {4}, {}}
	fmt.Println(dfsPreorder(adj, 0)) // [0 1 3 4 2]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task1 {
    static void dfs(List<List<Integer>> adj, int u, boolean[] visited, List<Integer> order) {
        visited[u] = true;
        order.add(u);                          // discovery / preorder
        for (int v : adj.get(u)) {
            if (!visited[v]) dfs(adj, v, visited, order);
        }
    }

    static List<Integer> dfsPreorder(List<List<Integer>> adj, int s) {
        boolean[] visited = new boolean[adj.size()];
        List<Integer> order = new ArrayList<>();
        dfs(adj, s, visited, order);
        return order;
    }

    public static void main(String[] args) {
        var adj = List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of());
        System.out.println(dfsPreorder(adj, 0)); // [0, 1, 3, 4, 2]
    }
}
```

**Reference — Python.**
```python
def dfs_preorder(adj, s):
    visited = [False] * len(adj)
    order = []

    def dfs(u):
        visited[u] = True
        order.append(u)            # discovery / preorder
        for v in adj[u]:
            if not visited[v]:
                dfs(v)

    dfs(s)
    return order


if __name__ == "__main__":
    adj = [[1, 2], [3], [3], [4], []]
    print(dfs_preorder(adj, 0))  # [0, 1, 3, 4, 2]
```

---

### Task 2 — Iterative DFS (overflow-proof)

**Problem.** Reimplement Task 1 using an **explicit stack** instead of recursion, returning the same preorder. Your solution must survive a chain of `10^6` vertices without a stack overflow.

**Constraints.**
- `1 <= V <= 10^6`.
- Output order must match the recursive version (push neighbours in reverse so they pop in list order).

**Hint.** Check `visited` **on pop**, not on push, because a vertex may be pushed several times before it is first popped.

**Reference — Go.**
```go
package main

import "fmt"

func dfsIterative(adj [][]int, s int) []int {
	visited := make([]bool, len(adj))
	order := []int{}
	stack := []int{s}
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if visited[u] {
			continue // check on pop
		}
		visited[u] = true
		order = append(order, u)
		for i := len(adj[u]) - 1; i >= 0; i-- { // reverse for list order
			if !visited[adj[u][i]] {
				stack = append(stack, adj[u][i])
			}
		}
	}
	return order
}

func main() {
	adj := [][]int{{1, 2}, {3}, {3}, {4}, {}}
	fmt.Println(dfsIterative(adj, 0)) // [0 1 3 4 2]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task2 {
    static List<Integer> dfsIterative(List<List<Integer>> adj, int s) {
        boolean[] visited = new boolean[adj.size()];
        List<Integer> order = new ArrayList<>();
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(s);
        while (!stack.isEmpty()) {
            int u = stack.pop();
            if (visited[u]) continue;          // check on pop
            visited[u] = true;
            order.add(u);
            List<Integer> nb = adj.get(u);
            for (int i = nb.size() - 1; i >= 0; i--) {
                if (!visited[nb.get(i)]) stack.push(nb.get(i));
            }
        }
        return order;
    }

    public static void main(String[] args) {
        var adj = List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of());
        System.out.println(dfsIterative(adj, 0)); // [0, 1, 3, 4, 2]
    }
}
```

**Reference — Python.**
```python
def dfs_iterative(adj, s):
    visited = [False] * len(adj)
    order = []
    stack = [s]
    while stack:
        u = stack.pop()
        if visited[u]:
            continue                   # check on pop
        visited[u] = True
        order.append(u)
        for v in reversed(adj[u]):     # reverse to match list order
            if not visited[v]:
                stack.append(v)
    return order


if __name__ == "__main__":
    adj = [[1, 2], [3], [3], [4], []]
    print(dfs_iterative(adj, 0))  # [0, 1, 3, 4, 2]
```

---

### Task 3 — Count connected components (undirected)

**Problem.** Given an undirected graph with `n` vertices and an edge list, return the number of connected components.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= edges <= 2·10^5`.
- The graph may be disconnected and may contain isolated vertices.

**Hint.** Loop over all vertices; each unvisited vertex starts a new component — DFS to mark its whole component, then increment the count.

**Reference — Go.**
```go
package main

import "fmt"

func countComponents(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0]) // undirected
	}
	visited := make([]bool, n)
	count := 0
	for s := 0; s < n; s++ {
		if visited[s] {
			continue
		}
		count++
		stack := []int{s}
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if visited[u] {
				continue
			}
			visited[u] = true
			for _, v := range adj[u] {
				if !visited[v] {
					stack = append(stack, v)
				}
			}
		}
	}
	return count
}

func main() {
	fmt.Println(countComponents(5, [][]int{{0, 1}, {1, 2}, {3, 4}})) // 2
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task3 {
    static int countComponents(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            adj.get(e[1]).add(e[0]);          // undirected
        }
        boolean[] visited = new boolean[n];
        int count = 0;
        for (int s = 0; s < n; s++) {
            if (visited[s]) continue;
            count++;
            Deque<Integer> stack = new ArrayDeque<>();
            stack.push(s);
            while (!stack.isEmpty()) {
                int u = stack.pop();
                if (visited[u]) continue;
                visited[u] = true;
                for (int v : adj.get(u)) if (!visited[v]) stack.push(v);
            }
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countComponents(5, new int[][]{{0, 1}, {1, 2}, {3, 4}})); // 2
    }
}
```

**Reference — Python.**
```python
def count_components(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)               # undirected
    visited = [False] * n
    count = 0
    for s in range(n):
        if visited[s]:
            continue
        count += 1
        stack = [s]
        while stack:
            u = stack.pop()
            if visited[u]:
                continue
            visited[u] = True
            for v in adj[u]:
                if not visited[v]:
                    stack.append(v)
    return count


if __name__ == "__main__":
    print(count_components(5, [(0, 1), (1, 2), (3, 4)]))  # 2
```

---

### Task 4 — Path existence

**Problem.** Given a directed graph, a source `src`, and a destination `dst`, return whether a path from `src` to `dst` exists. Stop as soon as `dst` is reached.

**Constraints.**
- `1 <= V <= 10^5`. Return early; do not traverse the whole graph if `dst` is found.

**Hint.** DFS from `src`; if you ever pop/visit `dst`, return `true` immediately.

**Reference — Go.**
```go
package main

import "fmt"

func hasPath(adj [][]int, src, dst int) bool {
	visited := make([]bool, len(adj))
	stack := []int{src}
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if u == dst {
			return true
		}
		if visited[u] {
			continue
		}
		visited[u] = true
		for _, v := range adj[u] {
			if !visited[v] {
				stack = append(stack, v)
			}
		}
	}
	return false
}

func main() {
	adj := [][]int{{1, 2}, {3}, {3}, {4}, {}}
	fmt.Println(hasPath(adj, 0, 4)) // true
	fmt.Println(hasPath(adj, 4, 0)) // false
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task4 {
    static boolean hasPath(List<List<Integer>> adj, int src, int dst) {
        boolean[] visited = new boolean[adj.size()];
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(src);
        while (!stack.isEmpty()) {
            int u = stack.pop();
            if (u == dst) return true;
            if (visited[u]) continue;
            visited[u] = true;
            for (int v : adj.get(u)) if (!visited[v]) stack.push(v);
        }
        return false;
    }

    public static void main(String[] args) {
        var adj = List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of());
        System.out.println(hasPath(adj, 0, 4)); // true
        System.out.println(hasPath(adj, 4, 0)); // false
    }
}
```

**Reference — Python.**
```python
def has_path(adj, src, dst):
    visited = [False] * len(adj)
    stack = [src]
    while stack:
        u = stack.pop()
        if u == dst:
            return True
        if visited[u]:
            continue
        visited[u] = True
        for v in adj[u]:
            if not visited[v]:
                stack.append(v)
    return False


if __name__ == "__main__":
    adj = [[1, 2], [3], [3], [4], []]
    print(has_path(adj, 0, 4))  # True
    print(has_path(adj, 4, 0))  # False
```

---

### Task 5 — Flood fill

**Problem.** Given an `m × n` grid of integer colors, a starting cell `(sr, sc)`, and a `newColor`, flood-fill the connected region of cells (4-directionally) that share the starting cell's color, recolouring them to `newColor`. Return the grid.

**Constraints.**
- `1 <= m, n <= 50`. If `newColor` already equals the start color, return the grid unchanged (otherwise you loop forever).

**Hint.** Record the old color first. DFS from the start, recolouring only in-bounds cells whose value still equals the old color.

**Reference — Go.**
```go
package main

import "fmt"

func floodFill(grid [][]int, sr, sc, newColor int) [][]int {
	old := grid[sr][sc]
	if old == newColor {
		return grid
	}
	m, n := len(grid), len(grid[0])
	var dfs func(r, c int)
	dfs = func(r, c int) {
		if r < 0 || r >= m || c < 0 || c >= n || grid[r][c] != old {
			return
		}
		grid[r][c] = newColor
		dfs(r+1, c)
		dfs(r-1, c)
		dfs(r, c+1)
		dfs(r, c-1)
	}
	dfs(sr, sc)
	return grid
}

func main() {
	grid := [][]int{{1, 1, 1}, {1, 1, 0}, {1, 0, 1}}
	fmt.Println(floodFill(grid, 1, 1, 2)) // [[2 2 2] [2 2 0] [2 0 1]]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task5 {
    static int m, n, old, newColor;

    static void dfs(int[][] grid, int r, int c) {
        if (r < 0 || r >= m || c < 0 || c >= n || grid[r][c] != old) return;
        grid[r][c] = newColor;
        dfs(grid, r + 1, c);
        dfs(grid, r - 1, c);
        dfs(grid, r, c + 1);
        dfs(grid, r, c - 1);
    }

    static int[][] floodFill(int[][] grid, int sr, int sc, int color) {
        old = grid[sr][sc];
        newColor = color;
        if (old == newColor) return grid;
        m = grid.length;
        n = grid[0].length;
        dfs(grid, sr, sc);
        return grid;
    }

    public static void main(String[] args) {
        int[][] grid = {{1, 1, 1}, {1, 1, 0}, {1, 0, 1}};
        System.out.println(Arrays.deepToString(floodFill(grid, 1, 1, 2)));
    }
}
```

**Reference — Python.**
```python
def flood_fill(grid, sr, sc, new_color):
    old = grid[sr][sc]
    if old == new_color:
        return grid
    m, n = len(grid), len(grid[0])

    def dfs(r, c):
        if r < 0 or r >= m or c < 0 or c >= n or grid[r][c] != old:
            return
        grid[r][c] = new_color
        dfs(r + 1, c)
        dfs(r - 1, c)
        dfs(r, c + 1)
        dfs(r, c - 1)

    dfs(sr, sc)
    return grid


if __name__ == "__main__":
    g = [[1, 1, 1], [1, 1, 0], [1, 0, 1]]
    print(flood_fill(g, 1, 1, 2))  # [[2,2,2],[2,2,0],[2,0,1]]
```

---

## Intermediate Tasks (5)

### Task 6 — Detect cycle in a directed graph (three colors)

**Problem.** Return whether a directed graph contains a cycle, using the white/gray/black coloring. An edge into a GRAY vertex is a back edge.

**Constraints.**
- `1 <= V <= 10^5`, `0 <= E <= 2·10^5`. The graph may be disconnected — start a DFS from every WHITE vertex.

**Hint.** GRAY = on the current recursion stack. Colour BLACK only after all descendants finish, so GRAY precisely means "still on the path."

**Reference — Go.**
```go
package main

import "fmt"

func hasCycle(adj [][]int) bool {
	const white, gray, black = 0, 1, 2
	color := make([]int, len(adj))
	var dfs func(u int) bool
	dfs = func(u int) bool {
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray || (color[v] == white && dfs(v)) {
				return true
			}
		}
		color[u] = black
		return false
	}
	for u := range adj {
		if color[u] == white && dfs(u) {
			return true
		}
	}
	return false
}

func main() {
	fmt.Println(hasCycle([][]int{{1, 2}, {3}, {3}, {4}, {}})) // false
	fmt.Println(hasCycle([][]int{{1}, {2}, {0}}))             // true
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task6 {
    static int[] color;
    static List<List<Integer>> adj;

    static boolean dfs(int u) {
        color[u] = 1; // gray
        for (int v : adj.get(u)) {
            if (color[v] == 1 || (color[v] == 0 && dfs(v))) return true;
        }
        color[u] = 2; // black
        return false;
    }

    static boolean hasCycle(List<List<Integer>> g) {
        adj = g;
        color = new int[g.size()];
        for (int u = 0; u < g.size(); u++) {
            if (color[u] == 0 && dfs(u)) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(hasCycle(List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of()))); // false
        System.out.println(hasCycle(List.of(List.of(1), List.of(2), List.of(0))));                           // true
    }
}
```

**Reference — Python.**
```python
def has_cycle(adj):
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * len(adj)

    def dfs(u):
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY or (color[v] == WHITE and dfs(v)):
                return True
        color[u] = BLACK
        return False

    return any(color[u] == WHITE and dfs(u) for u in range(len(adj)))


if __name__ == "__main__":
    print(has_cycle([[1, 2], [3], [3], [4], []]))  # False
    print(has_cycle([[1], [2], [0]]))              # True
```

---

### Task 7 — Detect cycle in an undirected graph (parent rule)

**Problem.** Return whether an undirected graph contains a cycle. A cycle exists iff DFS reaches an already-visited vertex that is not the parent it came from.

**Constraints.**
- `1 <= V <= 10^5`. Assume no parallel edges (otherwise track edge ids). The graph may be disconnected.

**Hint.** Thread the parent through the recursion and skip only the parent, not all visited vertices.

**Reference — Go.**
```go
package main

import "fmt"

func hasUndirectedCycle(adj [][]int) bool {
	visited := make([]bool, len(adj))
	var dfs func(u, parent int) bool
	dfs = func(u, parent int) bool {
		visited[u] = true
		for _, v := range adj[u] {
			if !visited[v] {
				if dfs(v, u) {
					return true
				}
			} else if v != parent {
				return true // back edge to a non-parent
			}
		}
		return false
	}
	for u := range adj {
		if !visited[u] && dfs(u, -1) {
			return true
		}
	}
	return false
}

func main() {
	tree := [][]int{{1}, {0, 2}, {1}}          // 0-1-2, no cycle
	cyc := [][]int{{1, 2}, {0, 2}, {0, 1}}     // triangle
	fmt.Println(hasUndirectedCycle(tree))      // false
	fmt.Println(hasUndirectedCycle(cyc))       // true
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task7 {
    static boolean[] visited;
    static List<List<Integer>> adj;

    static boolean dfs(int u, int parent) {
        visited[u] = true;
        for (int v : adj.get(u)) {
            if (!visited[v]) {
                if (dfs(v, u)) return true;
            } else if (v != parent) {
                return true;                  // back edge to non-parent
            }
        }
        return false;
    }

    static boolean hasUndirectedCycle(List<List<Integer>> g) {
        adj = g;
        visited = new boolean[g.size()];
        for (int u = 0; u < g.size(); u++) {
            if (!visited[u] && dfs(u, -1)) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        System.out.println(hasUndirectedCycle(List.of(List.of(1), List.of(0, 2), List.of(1))));     // false
        System.out.println(hasUndirectedCycle(List.of(List.of(1, 2), List.of(0, 2), List.of(0, 1)))); // true
    }
}
```

**Reference — Python.**
```python
def has_undirected_cycle(adj):
    visited = [False] * len(adj)

    def dfs(u, parent):
        visited[u] = True
        for v in adj[u]:
            if not visited[v]:
                if dfs(v, u):
                    return True
            elif v != parent:                 # back edge to non-parent
                return True
        return False

    return any(not visited[u] and dfs(u, -1) for u in range(len(adj)))


if __name__ == "__main__":
    print(has_undirected_cycle([[1], [0, 2], [1]]))         # False
    print(has_undirected_cycle([[1, 2], [0, 2], [0, 1]]))   # True
```

---

### Task 8 — Topological sort (reverse postorder)

**Problem.** Given a DAG, return a valid topological order: every edge `u → v` must place `u` before `v`. Use DFS postorder and reverse it.

**Constraints.**
- `1 <= V <= 10^5`, the input is guaranteed acyclic. DFS from every unvisited vertex to cover all components.

**Hint.** Append a vertex to a list when it *finishes* (postorder), then reverse the list.

**Reference — Go.**
```go
package main

import "fmt"

func topoSort(adj [][]int) []int {
	visited := make([]bool, len(adj))
	post := []int{}
	var dfs func(u int)
	dfs = func(u int) {
		visited[u] = true
		for _, v := range adj[u] {
			if !visited[v] {
				dfs(v)
			}
		}
		post = append(post, u) // finish / postorder
	}
	for u := range adj {
		if !visited[u] {
			dfs(u)
		}
	}
	for i, j := 0, len(post)-1; i < j; i, j = i+1, j-1 {
		post[i], post[j] = post[j], post[i] // reverse postorder
	}
	return post
}

func main() {
	adj := [][]int{{1, 2}, {3}, {3}, {4}, {}}
	fmt.Println(topoSort(adj)) // a valid order, e.g. [0 2 1 3 4]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task8 {
    static boolean[] visited;
    static List<List<Integer>> adj;
    static List<Integer> post;

    static void dfs(int u) {
        visited[u] = true;
        for (int v : adj.get(u)) if (!visited[v]) dfs(v);
        post.add(u);                          // postorder
    }

    static List<Integer> topoSort(List<List<Integer>> g) {
        adj = g;
        visited = new boolean[g.size()];
        post = new ArrayList<>();
        for (int u = 0; u < g.size(); u++) if (!visited[u]) dfs(u);
        Collections.reverse(post);            // reverse postorder
        return post;
    }

    public static void main(String[] args) {
        var adj = List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of());
        System.out.println(topoSort(adj));
    }
}
```

**Reference — Python.**
```python
def topo_sort(adj):
    visited = [False] * len(adj)
    post = []

    def dfs(u):
        visited[u] = True
        for v in adj[u]:
            if not visited[v]:
                dfs(v)
        post.append(u)                # postorder

    for u in range(len(adj)):
        if not visited[u]:
            dfs(u)
    return post[::-1]                 # reverse postorder


if __name__ == "__main__":
    adj = [[1, 2], [3], [3], [4], []]
    print(topo_sort(adj))  # e.g. [0, 2, 1, 3, 4]
```

---

### Task 9 — Discovery and finish times

**Problem.** Run a full DFS over a directed graph and return `disc[]` and `fin[]` arrays using a single global clock. Start DFS from every unvisited vertex in increasing id order, exploring neighbours in list order.

**Constraints.**
- `1 <= V <= 10^5`. The `2V` timestamps must be a permutation of `1..2V`, with `disc[u] < fin[u]` for all `u`.

**Hint.** Increment the clock both on entry (set `disc`) and on exit (set `fin`).

**Reference — Go.**
```go
package main

import "fmt"

func timestamps(adj [][]int) (disc, fin []int) {
	n := len(adj)
	disc = make([]int, n)
	fin = make([]int, n)
	color := make([]int, n) // 0 white
	clock := 0
	var dfs func(u int)
	dfs = func(u int) {
		clock++
		disc[u] = clock
		color[u] = 1 // gray
		for _, v := range adj[u] {
			if color[v] == 0 {
				dfs(v)
			}
		}
		color[u] = 2 // black
		clock++
		fin[u] = clock
	}
	for u := 0; u < n; u++ {
		if color[u] == 0 {
			dfs(u)
		}
	}
	return
}

func main() {
	disc, fin := timestamps([][]int{{1, 2}, {3}, {3}, {4}, {}})
	fmt.Println(disc) // [1 2 8 3 4]
	fmt.Println(fin)  // [10 7 9 6 5]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task9 {
    static int[] disc, fin, color;
    static int clock = 0;
    static List<List<Integer>> adj;

    static void dfs(int u) {
        disc[u] = ++clock;
        color[u] = 1;
        for (int v : adj.get(u)) if (color[v] == 0) dfs(v);
        color[u] = 2;
        fin[u] = ++clock;
    }

    static void timestamps(List<List<Integer>> g) {
        adj = g;
        int n = g.size();
        disc = new int[n];
        fin = new int[n];
        color = new int[n];
        clock = 0;
        for (int u = 0; u < n; u++) if (color[u] == 0) dfs(u);
    }

    public static void main(String[] args) {
        timestamps(List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of()));
        System.out.println(Arrays.toString(disc)); // [1, 2, 8, 3, 4]
        System.out.println(Arrays.toString(fin));  // [10, 7, 9, 6, 5]
    }
}
```

**Reference — Python.**
```python
def timestamps(adj):
    n = len(adj)
    disc = [0] * n
    fin = [0] * n
    color = [0] * n  # 0 white, 1 gray, 2 black
    clock = 0

    def dfs(u):
        nonlocal clock
        clock += 1
        disc[u] = clock
        color[u] = 1
        for v in adj[u]:
            if color[v] == 0:
                dfs(v)
        color[u] = 2
        clock += 1
        fin[u] = clock

    for u in range(n):
        if color[u] == 0:
            dfs(u)
    return disc, fin


if __name__ == "__main__":
    d, f = timestamps([[1, 2], [3], [3], [4], []])
    print(d)  # [1, 2, 8, 3, 4]
    print(f)  # [10, 7, 9, 6, 5]
```

---

### Task 10 — Number of islands (grid DFS)

**Problem.** Given an `m × n` grid of `'1'` (land) and `'0'` (water), count islands connected 4-directionally.

**Constraints.**
- `1 <= m, n <= 300`. You may mutate the grid to mark visited (sink the land).

**Hint.** For each unvisited land cell, increment the count and DFS to sink the whole island.

**Reference — Go.**
```go
package main

import "fmt"

func numIslands(grid [][]byte) int {
	m := len(grid)
	if m == 0 {
		return 0
	}
	n := len(grid[0])
	var sink func(r, c int)
	sink = func(r, c int) {
		if r < 0 || r >= m || c < 0 || c >= n || grid[r][c] != '1' {
			return
		}
		grid[r][c] = '0'
		sink(r+1, c)
		sink(r-1, c)
		sink(r, c+1)
		sink(r, c-1)
	}
	count := 0
	for r := 0; r < m; r++ {
		for c := 0; c < n; c++ {
			if grid[r][c] == '1' {
				count++
				sink(r, c)
			}
		}
	}
	return count
}

func main() {
	grid := [][]byte{
		{'1', '1', '0', '0'},
		{'1', '0', '0', '1'},
		{'0', '0', '1', '1'},
	}
	fmt.Println(numIslands(grid)) // 2
}
```

**Reference — Java.**
```java
public class Task10 {
    static int m, n;

    static void sink(char[][] g, int r, int c) {
        if (r < 0 || r >= m || c < 0 || c >= n || g[r][c] != '1') return;
        g[r][c] = '0';
        sink(g, r + 1, c);
        sink(g, r - 1, c);
        sink(g, r, c + 1);
        sink(g, r, c - 1);
    }

    static int numIslands(char[][] g) {
        m = g.length;
        if (m == 0) return 0;
        n = g[0].length;
        int count = 0;
        for (int r = 0; r < m; r++)
            for (int c = 0; c < n; c++)
                if (g[r][c] == '1') { count++; sink(g, r, c); }
        return count;
    }

    public static void main(String[] args) {
        char[][] grid = {
            {'1', '1', '0', '0'},
            {'1', '0', '0', '1'},
            {'0', '0', '1', '1'},
        };
        System.out.println(numIslands(grid)); // 2
    }
}
```

**Reference — Python.**
```python
def num_islands(grid):
    if not grid:
        return 0
    m, n = len(grid), len(grid[0])

    def sink(r, c):
        if r < 0 or r >= m or c < 0 or c >= n or grid[r][c] != "1":
            return
        grid[r][c] = "0"
        sink(r + 1, c)
        sink(r - 1, c)
        sink(r, c + 1)
        sink(r, c - 1)

    count = 0
    for r in range(m):
        for c in range(n):
            if grid[r][c] == "1":
                count += 1
                sink(r, c)
    return count


if __name__ == "__main__":
    grid = [
        ["1", "1", "0", "0"],
        ["1", "0", "0", "1"],
        ["0", "0", "1", "1"],
    ]
    print(num_islands(grid))  # 2
```

---

## Advanced Tasks (5)

### Task 11 — Course schedule II (return a valid order)

**Problem.** Given `numCourses` and prerequisite pairs `[a, b]` ("take `b` before `a`"), return any valid order to take all courses, or an empty result if the prerequisites contain a cycle.

**Constraints.**
- `1 <= numCourses <= 10^5`. Use DFS with three colors: detect a cycle (back edge into GRAY) and otherwise emit reverse postorder.

**Hint.** Build edges `b → a`. On finishing a vertex, append it to a postorder list; reverse it at the end. If any back edge is found, return empty.

**Reference — Go.**
```go
package main

import "fmt"

func findOrder(numCourses int, prerequisites [][]int) []int {
	adj := make([][]int, numCourses)
	for _, p := range prerequisites {
		adj[p[1]] = append(adj[p[1]], p[0]) // b -> a
	}
	const white, gray, black = 0, 1, 2
	color := make([]int, numCourses)
	post := []int{}
	cyc := false
	var dfs func(u int)
	dfs = func(u int) {
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray {
				cyc = true
				return
			}
			if color[v] == white {
				dfs(v)
				if cyc {
					return
				}
			}
		}
		color[u] = black
		post = append(post, u)
	}
	for u := 0; u < numCourses && !cyc; u++ {
		if color[u] == white {
			dfs(u)
		}
	}
	if cyc {
		return []int{}
	}
	for i, j := 0, len(post)-1; i < j; i, j = i+1, j-1 {
		post[i], post[j] = post[j], post[i]
	}
	return post
}

func main() {
	fmt.Println(findOrder(4, [][]int{{1, 0}, {2, 0}, {3, 1}, {3, 2}})) // e.g. [0 2 1 3]
	fmt.Println(findOrder(2, [][]int{{1, 0}, {0, 1}}))                 // []
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task11 {
    static int[] color;
    static List<List<Integer>> adj;
    static List<Integer> post;
    static boolean cyc;

    static void dfs(int u) {
        color[u] = 1;
        for (int v : adj.get(u)) {
            if (color[v] == 1) { cyc = true; return; }
            if (color[v] == 0) { dfs(v); if (cyc) return; }
        }
        color[u] = 2;
        post.add(u);
    }

    static int[] findOrder(int numCourses, int[][] prerequisites) {
        adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
        for (int[] p : prerequisites) adj.get(p[1]).add(p[0]); // b -> a
        color = new int[numCourses];
        post = new ArrayList<>();
        cyc = false;
        for (int u = 0; u < numCourses && !cyc; u++) if (color[u] == 0) dfs(u);
        if (cyc) return new int[0];
        Collections.reverse(post);
        return post.stream().mapToInt(Integer::intValue).toArray();
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(findOrder(4, new int[][]{{1,0},{2,0},{3,1},{3,2}})));
        System.out.println(Arrays.toString(findOrder(2, new int[][]{{1,0},{0,1}}))); // []
    }
}
```

**Reference — Python.**
```python
def find_order(num_courses, prerequisites):
    adj = [[] for _ in range(num_courses)]
    for a, b in prerequisites:
        adj[b].append(a)               # b -> a
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * num_courses
    post = []
    cyc = False

    def dfs(u):
        nonlocal cyc
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:
                cyc = True
                return
            if color[v] == WHITE:
                dfs(v)
                if cyc:
                    return
        color[u] = BLACK
        post.append(u)

    for u in range(num_courses):
        if cyc:
            break
        if color[u] == WHITE:
            dfs(u)
    if cyc:
        return []
    return post[::-1]


if __name__ == "__main__":
    print(find_order(4, [[1, 0], [2, 0], [3, 1], [3, 2]]))  # e.g. [0, 2, 1, 3]
    print(find_order(2, [[1, 0], [0, 1]]))                  # []
```

---

### Task 12 — Clone graph

**Problem.** Given a reference to a node in a connected undirected graph, return a deep copy. Each node has a value and a list of neighbours.

**Constraints.**
- `1 <= V <= 100`. The graph may contain cycles. Two different original nodes must map to two different clones, and shared neighbours must be shared in the clone too.

**Hint.** Memoize original → clone. Create and store the clone *before* recursing into neighbours, or a cycle loops forever.

**Reference — Go.**
```go
package main

import "fmt"

type Node struct {
	Val       int
	Neighbors []*Node
}

func cloneGraph(node *Node) *Node {
	if node == nil {
		return nil
	}
	seen := map[*Node]*Node{}
	var dfs func(n *Node) *Node
	dfs = func(n *Node) *Node {
		if c, ok := seen[n]; ok {
			return c
		}
		cp := &Node{Val: n.Val}
		seen[n] = cp // memoize before recursing
		for _, nb := range n.Neighbors {
			cp.Neighbors = append(cp.Neighbors, dfs(nb))
		}
		return cp
	}
	return dfs(node)
}

func main() {
	a, b := &Node{Val: 1}, &Node{Val: 2}
	a.Neighbors = []*Node{b}
	b.Neighbors = []*Node{a}
	c := cloneGraph(a)
	fmt.Println(c.Val, c.Neighbors[0].Val, c != a) // 1 2 true
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task12 {
    static class Node {
        int val;
        List<Node> neighbors = new ArrayList<>();
        Node(int v) { val = v; }
    }

    static Map<Node, Node> seen = new HashMap<>();

    static Node clone(Node n) {
        if (n == null) return null;
        if (seen.containsKey(n)) return seen.get(n);
        Node cp = new Node(n.val);
        seen.put(n, cp);                  // memoize before recursing
        for (Node nb : n.neighbors) cp.neighbors.add(clone(nb));
        return cp;
    }

    public static void main(String[] args) {
        Node a = new Node(1), b = new Node(2);
        a.neighbors.add(b);
        b.neighbors.add(a);
        Node c = clone(a);
        System.out.println(c.val + " " + c.neighbors.get(0).val + " " + (c != a));
    }
}
```

**Reference — Python.**
```python
class Node:
    def __init__(self, val):
        self.val = val
        self.neighbors = []


def clone_graph(node):
    if node is None:
        return None
    seen = {}

    def dfs(n):
        if n in seen:
            return seen[n]
        cp = Node(n.val)
        seen[n] = cp                  # memoize before recursing
        for nb in n.neighbors:
            cp.neighbors.append(dfs(nb))
        return cp

    return dfs(node)


if __name__ == "__main__":
    a, b = Node(1), Node(2)
    a.neighbors.append(b)
    b.neighbors.append(a)
    c = clone_graph(a)
    print(c.val, c.neighbors[0].val, c is not a)  # 1 2 True
```

---

### Task 13 — Find a directed cycle and return its path

**Problem.** If a directed graph contains a cycle, return the actual cycle as a list of vertices `[v, ..., u, v]`; otherwise return an empty list. Use the recursion stack to reconstruct the path.

**Constraints.**
- `1 <= V <= 10^5`. Return the first cycle found in DFS order. Track each vertex's parent in the DFS tree to rebuild the path.

**Hint.** When the back edge `(u, v)` into a GRAY vertex `v` is found, walk parents from `u` back to `v`, then append `v` again to close the loop.

**Reference — Go.**
```go
package main

import "fmt"

func findCycle(adj [][]int) []int {
	const white, gray, black = 0, 1, 2
	n := len(adj)
	color := make([]int, n)
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -1
	}
	var cycle []int
	var dfs func(u int) bool
	dfs = func(u int) bool {
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray { // back edge u -> v
				for x := u; x != v; x = parent[x] {
					cycle = append(cycle, x)
				}
				cycle = append(cycle, v)
				// reverse and close
				for i, j := 0, len(cycle)-1; i < j; i, j = i+1, j-1 {
					cycle[i], cycle[j] = cycle[j], cycle[i]
				}
				cycle = append(cycle, v)
				return true
			}
			if color[v] == white {
				parent[v] = u
				if dfs(v) {
					return true
				}
			}
		}
		color[u] = black
		return false
	}
	for u := 0; u < n; u++ {
		if color[u] == white && dfs(u) {
			return cycle
		}
	}
	return []int{}
}

func main() {
	fmt.Println(findCycle([][]int{{1}, {2}, {0}})) // [0 1 2 0]
	fmt.Println(findCycle([][]int{{1, 2}, {3}, {3}, {4}, {}})) // []
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task13 {
    static int[] color, parent;
    static List<List<Integer>> adj;
    static List<Integer> cycle;

    static boolean dfs(int u) {
        color[u] = 1;
        for (int v : adj.get(u)) {
            if (color[v] == 1) {              // back edge u -> v
                for (int x = u; x != v; x = parent[x]) cycle.add(x);
                cycle.add(v);
                Collections.reverse(cycle);
                cycle.add(v);
                return true;
            }
            if (color[v] == 0) {
                parent[v] = u;
                if (dfs(v)) return true;
            }
        }
        color[u] = 2;
        return false;
    }

    static List<Integer> findCycle(List<List<Integer>> g) {
        adj = g;
        int n = g.size();
        color = new int[n];
        parent = new int[n];
        Arrays.fill(parent, -1);
        cycle = new ArrayList<>();
        for (int u = 0; u < n; u++) if (color[u] == 0 && dfs(u)) return cycle;
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        System.out.println(findCycle(List.of(List.of(1), List.of(2), List.of(0)))); // [0, 1, 2, 0]
        System.out.println(findCycle(List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of()))); // []
    }
}
```

**Reference — Python.**
```python
def find_cycle(adj):
    WHITE, GRAY, BLACK = 0, 1, 2
    n = len(adj)
    color = [WHITE] * n
    parent = [-1] * n
    cycle = []

    def dfs(u):
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:              # back edge u -> v
                x = u
                while x != v:
                    cycle.append(x)
                    x = parent[x]
                cycle.append(v)
                cycle.reverse()
                cycle.append(v)
                return True
            if color[v] == WHITE:
                parent[v] = u
                if dfs(v):
                    return True
        color[u] = BLACK
        return False

    for u in range(n):
        if color[u] == WHITE and dfs(u):
            return cycle
    return []


if __name__ == "__main__":
    print(find_cycle([[1], [2], [0]]))                  # [0, 1, 2, 0]
    print(find_cycle([[1, 2], [3], [3], [4], []]))      # []
```

---

### Task 14 — Iterative postorder (no recursion)

**Problem.** Produce a postorder traversal of a directed graph using an **explicit stack** of `(vertex, child_index)` frames, so it never overflows on a deep graph. Cover all components.

**Constraints.**
- `1 <= V <= 10^6`. Output must equal the recursive postorder.

**Hint.** Each iteration, inspect the top frame: if it has an unvisited child, push it; otherwise record the vertex (postorder) and pop.

**Reference — Go.**
```go
package main

import "fmt"

func postorder(adj [][]int) []int {
	n := len(adj)
	visited := make([]bool, n)
	post := []int{}
	type frame struct{ u, i int }
	for s := 0; s < n; s++ {
		if visited[s] {
			continue
		}
		visited[s] = true
		stack := []frame{{s, 0}}
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			if top.i < len(adj[top.u]) {
				v := adj[top.u][top.i]
				top.i++
				if !visited[v] {
					visited[v] = true
					stack = append(stack, frame{v, 0})
				}
			} else {
				post = append(post, top.u) // finish
				stack = stack[:len(stack)-1]
			}
		}
	}
	return post
}

func main() {
	fmt.Println(postorder([][]int{{1, 2}, {3}, {3}, {4}, {}})) // [4 3 1 2 0]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task14 {
    static List<Integer> postorder(List<List<Integer>> adj) {
        int n = adj.size();
        boolean[] visited = new boolean[n];
        List<Integer> post = new ArrayList<>();
        for (int s = 0; s < n; s++) {
            if (visited[s]) continue;
            visited[s] = true;
            Deque<int[]> stack = new ArrayDeque<>(); // {vertex, childIndex}
            stack.push(new int[]{s, 0});
            while (!stack.isEmpty()) {
                int[] top = stack.peek();
                List<Integer> nb = adj.get(top[0]);
                if (top[1] < nb.size()) {
                    int v = nb.get(top[1]++);
                    if (!visited[v]) {
                        visited[v] = true;
                        stack.push(new int[]{v, 0});
                    }
                } else {
                    post.add(top[0]);          // finish
                    stack.pop();
                }
            }
        }
        return post;
    }

    public static void main(String[] args) {
        System.out.println(postorder(List.of(List.of(1, 2), List.of(3), List.of(3), List.of(4), List.of())));
        // [4, 3, 1, 2, 0]
    }
}
```

**Reference — Python.**
```python
def postorder(adj):
    n = len(adj)
    visited = [False] * n
    post = []
    for s in range(n):
        if visited[s]:
            continue
        visited[s] = True
        stack = [(s, 0)]              # (vertex, child index)
        while stack:
            u, i = stack[-1]
            if i < len(adj[u]):
                stack[-1] = (u, i + 1)
                v = adj[u][i]
                if not visited[v]:
                    visited[v] = True
                    stack.append((v, 0))
            else:
                post.append(u)        # finish
                stack.pop()
    return post


if __name__ == "__main__":
    print(postorder([[1, 2], [3], [3], [4], []]))  # [4, 3, 1, 2, 0]
```

---

### Task 15 — Bipartite check (2-coloring)

**Problem.** Given an undirected graph, decide whether it is bipartite — whether the vertices can be 2-coloured so that no edge joins two same-coloured vertices. DFS, assigning the opposite color to each neighbour; a conflict means not bipartite.

**Constraints.**
- `1 <= V <= 10^5`. The graph may be disconnected — check every component. An odd-length cycle makes it non-bipartite.

**Hint.** Keep a `side[]` array initialized to `-1`. DFS assigning `side[v] = 1 - side[u]`; if a neighbour already has the same side, fail.

**Reference — Go.**
```go
package main

import "fmt"

func isBipartite(adj [][]int) bool {
	side := make([]int, len(adj))
	for i := range side {
		side[i] = -1
	}
	var dfs func(u int) bool
	dfs = func(u int) bool {
		for _, v := range adj[u] {
			if side[v] == -1 {
				side[v] = 1 - side[u]
				if !dfs(v) {
					return false
				}
			} else if side[v] == side[u] {
				return false // same side across an edge
			}
		}
		return true
	}
	for s := range adj {
		if side[s] == -1 {
			side[s] = 0
			if !dfs(s) {
				return false
			}
		}
	}
	return true
}

func main() {
	fmt.Println(isBipartite([][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}})) // true (square)
	fmt.Println(isBipartite([][]int{{1, 2}, {0, 2}, {0, 1}}))         // false (triangle)
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task15 {
    static int[] side;
    static List<List<Integer>> adj;

    static boolean dfs(int u) {
        for (int v : adj.get(u)) {
            if (side[v] == -1) {
                side[v] = 1 - side[u];
                if (!dfs(v)) return false;
            } else if (side[v] == side[u]) {
                return false;
            }
        }
        return true;
    }

    static boolean isBipartite(List<List<Integer>> g) {
        adj = g;
        side = new int[g.size()];
        Arrays.fill(side, -1);
        for (int s = 0; s < g.size(); s++) {
            if (side[s] == -1) {
                side[s] = 0;
                if (!dfs(s)) return false;
            }
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isBipartite(List.of(List.of(1, 3), List.of(0, 2), List.of(1, 3), List.of(0, 2)))); // true
        System.out.println(isBipartite(List.of(List.of(1, 2), List.of(0, 2), List.of(0, 1))));                // false
    }
}
```

**Reference — Python.**
```python
def is_bipartite(adj):
    side = [-1] * len(adj)

    def dfs(u):
        for v in adj[u]:
            if side[v] == -1:
                side[v] = 1 - side[u]
                if not dfs(v):
                    return False
            elif side[v] == side[u]:
                return False              # same side across an edge
        return True

    for s in range(len(adj)):
        if side[s] == -1:
            side[s] = 0
            if not dfs(s):
                return False
    return True


if __name__ == "__main__":
    print(is_bipartite([[1, 3], [0, 2], [1, 3], [0, 2]]))  # True (square)
    print(is_bipartite([[1, 2], [0, 2], [0, 1]]))          # False (triangle)
```

---

## Benchmark Task

### Task 16 — Recursive vs iterative DFS on a deep chain

**Problem.** Empirically demonstrate the stack-overflow ceiling of recursive DFS and the resilience of the iterative form. Build a chain graph `0 → 1 → 2 → ... → n-1` and:

1. Run recursive DFS and report whether it completes or overflows.
2. Run iterative (explicit-stack) DFS and report the wall-clock time and the number of vertices visited.

Sweep `n` over `{10^3, 10^4, 10^5, 10^6}`. Observe where recursion fails and confirm the iterative version handles all sizes.

**Constraints.**
- A chain is the worst case for DFS depth: the recursion/stack depth equals `n`.
- Measure with a monotonic clock; warm up once before timing.

**What to measure.**
- The largest `n` for which recursive DFS completes without crashing (language- and stack-size-dependent — typically `~10^4` to `10^5`).
- Iterative DFS time per size; it should scale roughly linearly in `n`.
- Peak memory of the explicit stack versus the call stack.

**Hint.** Catch the overflow: `RecursionError` in Python, `StackOverflowError` in Java, and in Go a recursion that deep will crash the goroutine — guard by capping the recursive run at a safe `n` or running it in a separate goroutine with a recovered panic only for demonstration. The iterative version should be the production default.

**Reference — Go.**
```go
package main

import (
	"fmt"
	"time"
)

func chain(n int) [][]int {
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		adj[i] = []int{i + 1}
	}
	if n > 0 {
		adj[n-1] = []int{}
	}
	return adj
}

func dfsIter(adj [][]int) int {
	visited := make([]bool, len(adj))
	stack := []int{0}
	count := 0
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if visited[u] {
			continue
		}
		visited[u] = true
		count++
		for _, v := range adj[u] {
			if !visited[v] {
				stack = append(stack, v)
			}
		}
	}
	return count
}

func main() {
	for _, n := range []int{1_000, 10_000, 100_000, 1_000_000} {
		adj := chain(n)
		start := time.Now()
		visited := dfsIter(adj)
		fmt.Printf("n=%-8d iterative: visited=%d time=%v\n", n, visited, time.Since(start))
	}
	// Recursive DFS on n=1_000_000 would overflow the goroutine stack.
}
```

**Reference — Java.**
```java
public class Task16 {
    static int[][] chain(int n) {
        int[][] adj = new int[n][];
        for (int i = 0; i < n - 1; i++) adj[i] = new int[]{i + 1};
        if (n > 0) adj[n - 1] = new int[0];
        return adj;
    }

    static int dfsIter(int[][] adj) {
        boolean[] visited = new boolean[adj.length];
        int[] stack = new int[adj.length];
        int sp = 0, count = 0;
        stack[sp++] = 0;
        while (sp > 0) {
            int u = stack[--sp];
            if (visited[u]) continue;
            visited[u] = true;
            count++;
            for (int v : adj[u]) if (!visited[v]) stack[sp++] = v;
        }
        return count;
    }

    static void dfsRec(int[][] adj, int u, boolean[] visited) {
        visited[u] = true;
        for (int v : adj[u]) if (!visited[v]) dfsRec(adj, v, visited);
    }

    public static void main(String[] args) {
        for (int n : new int[]{1_000, 10_000, 100_000, 1_000_000}) {
            int[][] adj = chain(n);
            long start = System.nanoTime();
            int visited = dfsIter(adj);
            long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("n=%-8d iterative: visited=%d time=%dms%n", n, visited, ms);
        }
        // Recursive demo: small n succeeds, large n throws StackOverflowError.
        try {
            int n = 100_000;
            dfsRec(chain(n), 0, new boolean[n]);
            System.out.println("recursive n=100000 ok");
        } catch (StackOverflowError e) {
            System.out.println("recursive overflowed (expected on a deep chain)");
        }
    }
}
```

**Reference — Python.**
```python
import sys
import time


def chain(n):
    return [[i + 1] if i + 1 < n else [] for i in range(n)]


def dfs_iter(adj):
    visited = [False] * len(adj)
    stack = [0]
    count = 0
    while stack:
        u = stack.pop()
        if visited[u]:
            continue
        visited[u] = True
        count += 1
        for v in adj[u]:
            if not visited[v]:
                stack.append(v)
    return count


def dfs_rec(adj, u, visited):
    visited[u] = True
    for v in adj[u]:
        if not visited[v]:
            dfs_rec(adj, v, visited)


if __name__ == "__main__":
    for n in (1_000, 10_000, 100_000, 1_000_000):
        adj = chain(n)
        start = time.perf_counter()
        visited = dfs_iter(adj)
        print(f"n={n:<8} iterative: visited={visited} time={time.perf_counter()-start:.4f}s")

    # Recursive demonstration of the ceiling.
    try:
        n = 50_000
        dfs_rec(chain(n), 0, [False] * n)
        print(f"recursive n={n} ok")
    except RecursionError:
        print("RecursionError: chain too deep for the call stack (expected)")
```

**Expected observations.**
- Iterative DFS completes all four sizes in roughly linear time; doubling `n` roughly doubles the time.
- Recursive DFS fails somewhere around `10^4`–`10^5` depending on language and configured stack size, confirming the production rule: **use the explicit stack for deep or untrusted input.**
